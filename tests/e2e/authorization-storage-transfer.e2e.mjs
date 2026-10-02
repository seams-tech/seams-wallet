import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';

const output = resolve('.artifacts/r153/authorization-storage-transfer');
const scope = {
  namespace: 'transfer-probe',
  orgId: 'transfer-org',
  projectId: 'transfer-project',
  envId: 'production',
};
const tables = [
  'wallet_authorities',
  'wallet_auth_methods',
  'authorization_wallet_session_quotas',
  'wallet_session_authorizations_v2',
  'wallet_session_hosted_credentials_v2',
  'wallet_session_hosted_exchange_codes_v2',
];
await mkdir(output, { recursive: true });
const bundle = await build({
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  tsconfig: 'packages/wallet-server/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
      export { AuthorizationService } from './packages/wallet-server/src/authorization/service';
      export { capabilityPolicyPort } from './packages/wallet-server/src/authorization/capabilityPolicy';
      export { parseSessionOrigin } from './packages/wallet-server/src/authorization/domain';
      export { CloudflareD1AuthorizationStore } from './packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
      export { prepareD1WalletAuthorityPutStatement } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
      export { prepareD1WalletAuthMethodV2PutStatement } from './packages/wallet-server/src/core/d1WalletAuthMethodStore';
      export { buildLinkedDeviceManagementAuthorityFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';
      export { buildFullOwnerPermissionsV1 } from './packages/shared-ts/src/authorization/delegatedAuthority';
      export { parseTenantId } from './packages/shared-ts/src/authorization/capabilityKinds';
    `,
  },
});
const bundlePath = resolve(output, 'production-api.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));
const worker = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("local authorization probe"); } };',
  d1Databases: { SOURCE: 'authorization-source', DESTINATION: 'authorization-destination' },
  compatibilityDate: '2026-06-12',
  port: 0,
});

try {
  const source = await worker.getD1Database('SOURCE');
  const destination = await worker.getD1Database('DESTINATION');
  const migrations = await migrate(source);
  assert.deepEqual(await migrate(destination), migrations);
  const sourceService = service(source, scope);
  const issuedAtMs = Date.now();
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'storage-transfer-owner',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: issuedAtMs + 3_600_000,
  });
  const issued = await issueDeviceSession(source, sourceService, fixture, issuedAtMs);
  const offlineFixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'storage-transfer-offline-device',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'device_link',
    sourceAuthorityId: fixture.authority.authorityId,
    expiresAtMs: issuedAtMs + 3_600_000,
    identity: {
      walletId: fixture.authority.walletId,
      authorityId: 'authority:offline-transfer-device',
      walletAuthMethodId: 'auth-method:offline-transfer-device',
      rpId: fixture.authMethod.rpId,
      credentialIdB64u: Buffer.alloc(32, 55).toString('base64url'),
    },
  });
  const offlineIssued = await issueDeviceSession(source, sourceService, offlineFixture, issuedAtMs);
  const offlineInput = {
    tenantId: offlineIssued.session.tenantId,
    token: offlineIssued.operationCredential.token,
    nowMs: issuedAtMs + 2,
  };
  const offlineBefore =
    await sourceService.readWalletSessionAdmissionSnapshotByOperationCredential(offlineInput);
  assert.equal(offlineBefore.kind, 'active');
  const appOrigin = api.parseSessionOrigin('https://app.example.test');
  const walletOrigin = api.parseSessionOrigin('https://wallet.example.test');
  const exchange = await sourceService.mintHostedWalletSeamsSessionExchange({
    authorization: issued,
    appOrigin,
    walletOrigin,
    issuedAtMs,
    expiresAtMs: issued.session.expiresAtMs,
  });
  const redeemInput = {
    exchangeCode: exchange.exchangeCode,
    nonce: exchange.nonce,
    appOrigin,
    walletOrigin,
    redeemedAtMs: issuedAtMs + 1,
  };
  const hosted = await sourceService.redeemHostedWalletSeamsSessionExchange(redeemInput);
  assert.equal(hosted.kind, 'redeemed');
  const primaryInput = {
    tenantId: issued.session.tenantId,
    token: issued.operationCredential.token,
    nowMs: issuedAtMs + 2,
  };
  const hostedInput = {
    tenantId: issued.session.tenantId,
    token: hosted.operationCredential.token,
    requestOrigin: walletOrigin,
    nowMs: issuedAtMs + 2,
  };
  const before =
    await sourceService.readWalletSessionAdmissionSnapshotByOperationCredential(primaryInput);
  assert.equal(before.kind, 'active');
  assert.equal(before.authorization.quota.remainingUses, 7);
  const hostedBefore =
    await sourceService.readHostedWalletSessionOperationCredentialV2(hostedInput);
  assert.ok(hostedBefore);

  const copied = [];
  for (const table of tables) {
    const result = await source
      .prepare(`SELECT * FROM ${table} WHERE namespace = ?`)
      .bind(scope.namespace)
      .all();
    const statements = [];
    for (const row of result.results) {
      const columns = Object.keys(row);
      const placeholders = Array(columns.length).fill('?').join(', ');
      statements.push(
        destination
          .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
          .bind(...Object.values(row)),
      );
    }
    if (table === 'wallet_session_hosted_exchange_codes_v2') {
      await assert.rejects(
        destination.batch(statements),
        /wallet_session_hosted_exchange_initial_state_rejected/u,
      );
      const guardName = 'wallet_session_hosted_exchange_codes_v2_insert_lifecycle_guard';
      const guard = await destination
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .bind(guardName)
        .first();
      assert.ok(guard);
      // Restore terminal history only in this isolated, inactive destination, then reinstate its insert guard.
      await destination.batch([
        destination.prepare(`DROP TRIGGER ${guardName}`),
        ...statements,
        destination.prepare(guard.sql),
      ]);
      await assert.rejects(
        destination.batch(statements),
        /wallet_session_hosted_exchange_initial_state_rejected/u,
      );
    } else if (statements.length > 0) {
      await destination.batch(statements);
    }
    copied.push({ table, rows: statements.length });
  }

  const destinationService = service(destination, scope);
  assert.deepEqual(
    await destinationService.readWalletSessionAdmissionSnapshotByOperationCredential(primaryInput),
    before,
  );
  assert.deepEqual(
    await destinationService.readHostedWalletSessionOperationCredentialV2(hostedInput),
    hostedBefore,
  );
  assert.deepEqual(
    await destinationService.readWalletSessionAdmissionSnapshotByOperationCredential(offlineInput),
    offlineBefore,
  );
  assert.equal(
    (await destinationService.redeemHostedWalletSeamsSessionExchange(redeemInput)).kind,
    'already_consumed',
  );
  const otherTenant = api.parseTenantId('tenant:other');
  assert.equal(otherTenant.ok, true);
  assert.equal(
    await destinationService.readWalletSessionAdmissionSnapshotByOperationCredential({
      tenantId: otherTenant.value,
      token: primaryInput.token,
      nowMs: primaryInput.nowMs,
    }),
    null,
  );
  const otherScopeService = service(destination, {
    namespace: scope.namespace,
    orgId: 'another-org',
    projectId: scope.projectId,
    envId: scope.envId,
  });
  assert.equal(
    await otherScopeService.readWalletSessionAdmissionSnapshotByOperationCredential(primaryInput),
    null,
  );
  assert.equal(
    await destinationService.readHostedWalletSessionOperationCredentialV2({
      tenantId: hostedInput.tenantId,
      token: hostedInput.token,
      requestOrigin: api.parseSessionOrigin('https://changed-wallet.example.test'),
      nowMs: hostedInput.nowMs,
    }),
    null,
  );
  await assert.rejects(
    destinationService.readWalletSessionAdmissionSnapshotByOperationCredential({
      tenantId: primaryInput.tenantId,
      token: primaryInput.token,
      nowMs: issued.session.expiresAtMs + 1,
    }),
    /authorization has expired/u,
  );
  await destinationService.retireWalletSessionAuthorizationsForAuthMethod({
    tenantId: issued.session.tenantId,
    walletId: issued.session.walletId,
    walletAuthMethodId: issued.session.walletAuthMethodId,
    nowMs: issuedAtMs + 3,
  });
  await assert.rejects(
    destinationService.readWalletSessionAdmissionSnapshotByOperationCredential(primaryInput),
    /authorization is retired/u,
  );
  assert.equal(
    await destinationService.readHostedWalletSessionOperationCredentialV2(hostedInput),
    null,
  );
  assert.deepEqual(
    await destinationService.readWalletSessionAdmissionSnapshotByOperationCredential(offlineInput),
    offlineBefore,
  );

  const artifact = {
    kind: 'wallet_authorization_storage_transfer_evidence_v1',
    recordedAt: new Date().toISOString(),
    walletRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runnerSha256: digest(await readFile(new URL(import.meta.url))),
    productionBundleSha256: digest(bundle.outputFiles[0].text),
    nodeVersion: process.version,
    miniflareVersion: JSON.parse(await readFile('node_modules/miniflare/package.json', 'utf8'))
      .version,
    migrations,
    copied,
    authorizationId: issued.session.authorizationId,
    observations: {
      existingPrimaryCredentialAcceptedAtIndependentDatabase: true,
      secondDeviceCredentialAndAuthorityPreservedWithoutReissuance: true,
      directConsumedExchangeImportRejected: true,
      isolatedTerminalRestoreReinstatedInsertGuard: true,
      exactAuthorityCapabilityAndQuotaPreserved: true,
      existingHostedCredentialAcceptedAtIndependentDatabase: true,
      consumedExchangeRemainedConsumed: true,
      changedTenantAndOrganizationRejected: true,
      changedWalletOriginRejected: true,
      expiredSessionRejected: true,
      retirementInvalidatedBothCredentialsAtDestination: true,
      retiringFirstDeviceSessionLeftSecondDeviceSessionActive: true,
    },
    scope:
      'Production authorization service and D1 stores with canonical fixture authority; no signing execution, cryptographic material copy, browser, physical geography, or source-fencing proof.',
    reproduce: 'node tests/e2e/authorization-storage-transfer.e2e.mjs',
  };
  await writeFile(resolve(output, 'evidence.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Authorization transfer passed. Evidence: ${resolve(output, 'evidence.json')}`);
} finally {
  await worker.dispose();
}

function service(database, walletScope) {
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: walletScope.namespace,
    walletSignerScope: walletScope,
  });
  return new api.AuthorizationService({
    policy: api.capabilityPolicyPort,
    sessions: store,
    grants: store,
    evidence: store,
    authorizedOperations: store,
    audit: {},
  });
}

async function issueDeviceSession(database, authorizationService, fixture, issuedAtMs) {
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: fixture.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: fixture.authMethod }),
  ]);
  const issued = await authorizationService.issueDirectWalletSessionAuthorizationV2({
    tenantId: fixture.issuedSession.session.tenantId,
    principalId: fixture.issuedSession.session.principalId,
    walletId: fixture.authority.walletId,
    authority: fixture.authority,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    mintId: fixture.issuedSession.session.mintId,
    remainingUses: 7,
    issuedAtMs,
    expiresAtMs: fixture.issuedSession.session.expiresAtMs,
  });
  assert.equal(issued.kind, 'issued');
  return issued;
}

async function migrate(database) {
  const directory = 'packages/wallet-server/migrations/d1-signer';
  const migrations = [];
  for (const name of (await readdir(directory)).filter(isSql).sort()) {
    const original = await readFile(`${directory}/${name}`, 'utf8');
    let sql = original;
    if (name === '0028_r103f_phase1_additive_schema_bridge.sql') {
      sql = buildWorkerdCompatiblePhase1Bridge(sql);
    }
    const statements = [];
    for (const query of unstable_splitSqlQuery(sql)) {
      statements.push(database.prepare(query));
    }
    await database.batch(statements);
    migrations.push({ name, sha256: digest(original) });
  }
  return migrations;
}

function isSql(name) {
  return name.endsWith('.sql');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}
