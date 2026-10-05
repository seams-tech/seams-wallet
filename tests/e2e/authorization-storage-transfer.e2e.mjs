import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
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
      export { CloudflareD1WebAuthnStore } from './packages/wallet-server/src/router/cloudflare/d1/webauthn/d1WebAuthnStore';
      export { walletRelocationEmailOtpBinding, verifyWalletRelocationEmailOtp } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationEmailOtp';
      export { CloudflareD1EmailOtpChallengeStore } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpChallengeStore';
      export { CloudflareD1EmailOtpChallengeVerifier } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpChallengeVerifier';
      export { CloudflareD1EmailOtpEnrollmentStore } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpEnrollmentStore';
      export { CloudflareD1EmailOtpRateLimitStore } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpRateLimitStore';
      export { emailOtpChallengeRecord } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpRecords';
      export { prepareD1TenantStatement } from './packages/wallet-server/src/core/d1TenantStore';
      export { buildEmailOtpEnrollmentFixture } from './tests/unit/helpers/emailOtpAuthMethod.fixtures';
      export { WalletRelocationOwnerRequest } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationOwnerRequest';
      export { D1WalletRelocationApprovals } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationApprovals';
      export { verifyWalletRelocationPasskey } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationPasskey';
      export { AuthorizationService } from './packages/wallet-server/src/authorization/service';
      export { D1WalletRelocationChallenges, WalletRelocationChallengeBinding } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationChallenges';
      export { capabilityPolicyPort } from './packages/wallet-server/src/authorization/capabilityPolicy';
      export { parseSessionOrigin } from './packages/wallet-server/src/authorization/domain';
      export { CloudflareD1AuthorizationStore } from './packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
      export { D1WalletAuthorityStore, prepareD1WalletAuthorityPutStatement } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
      export { prepareD1WalletAuthMethodV2PutStatement } from './packages/wallet-server/src/core/d1WalletAuthMethodStore';
      export { buildLinkedDeviceManagementAuthorityFixture, buildEmailOtpEcdsaWalletSessionFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';
      export { buildFullOwnerPermissionsV1, buildSigningOnlyDelegatedWalletAuthorityV1 } from './packages/shared-ts/src/authorization/delegatedAuthority';
      export { routerAbMpcMaterialActivationRefToWire } from './packages/shared-ts/src/utils/routerAbNormalSigningIdentity';
      export { readWalletSessionSigningCandidate } from './packages/wallet-server/src/router/cloudflare/d1/auth/walletSessionCredentialReaders';
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
    keyFamily: 'ecdsa_secp256k1',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: issuedAtMs + 3_600_000,
  });
  const issued = await issueDeviceSession(source, sourceService, fixture, issuedAtMs);
  const relocationChallenges = await verifyRelocationChallenges(source, fixture, issued, issuedAtMs);
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
  const activation = fixture.authority.signerActivations.ecdsa?.materialActivation;
  assert.ok(activation);
  const signingInput = {
    tenantId: primaryInput.tenantId,
    token: primaryInput.token,
    nowMs: primaryInput.nowMs,
    materialActivation: api.routerAbMpcMaterialActivationRefToWire(activation),
  };
  assert.equal(
    (await api.readWalletSessionSigningCandidate(sourceService, signingInput)).kind,
    'active',
  );
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
    await api.readWalletSessionSigningCandidate(destinationService, signingInput),
    null,
    'Retired signing credentials are rejected without an availability exception',
  );
  assert.equal(
    await destinationService.readHostedWalletSessionOperationCredentialV2(hostedInput),
    null,
  );
  assert.deepEqual(
    await destinationService.readWalletSessionAdmissionSnapshotByOperationCredential(offlineInput),
    offlineBefore,
  );

  const relocationPasskey = await verifyRelocationPasskey(source);
  const relocationEmailOtp = await verifyRelocationEmailOtp(source);
  const relocationOwnerRequest = await verifyRelocationOwnerRequest(source);
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
      relocationChallenges,
      relocationPasskey,
      relocationEmailOtp,
      relocationOwnerRequest,
      existingPrimaryCredentialAcceptedAtIndependentDatabase: true,
      secondDeviceCredentialAndAuthorityPreservedWithoutReissuance: true,
      directConsumedExchangeImportRejected: true,
      isolatedTerminalRestoreReinstatedInsertGuard: true,
      exactAuthorityCapabilityAndQuotaPreserved: true,
      existingHostedCredentialAcceptedAtIndependentDatabase: true,
      consumedExchangeRemainedConsumed: true,
      changedTenantAndOrganizationRejected: true,
      changedWalletOriginRejected: true,
      retiredSigningCredentialReturnsInvalid: true,
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
    const preservedChallenge = name === '0051_wallet_relocation_email_otp.sql'
      ? api.emailOtpChallengeRecord({
          challengeId: 'otp:migration', challengeSubjectId: 'google:migration',
          walletId: 'wallet:migration', orgId: scope.orgId, email: 'migration@example.test',
          otpCode: '135790', ownerProofBindingDigest: 'migration-binding',
          action: 'wallet_email_otp_login', operation: 'wallet_unlock',
          createdAtMs: 100, expiresAtMs: 200, maxAttempts: 5,
        })
      : null;
    const challengeStore = new api.CloudflareD1EmailOtpChallengeStore({ database, ...scope });
    if (preservedChallenge) await challengeStore.put(preservedChallenge);
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
    if (preservedChallenge) assert.deepEqual(await challengeStore.read(preservedChallenge.challengeId), preservedChallenge);
    migrations.push({ name, sha256: digest(original), ...(preservedChallenge ? { existingOtpChallengePreserved: true } : {}) });
  }
  return migrations;
}

function isSql(name) {
  return name.endsWith('.sql');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function verifyRelocationChallenges(database, fixture, session, nowMs) {
  const store = new api.D1WalletRelocationChallenges(database, scope);
  const input = {
    walletId: fixture.authority.walletId,
    moveId: `wmove_${Buffer.alloc(32, 93).toString('base64url')}`,
    requestDigestHex: 'ab'.repeat(32),
    sourceGeneration: 1,
    destinationRegion: 'APAC',
    authorityId: fixture.authority.authorityId,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    credentialDigestHex: digest(Buffer.from(session.operationCredential.token)),
    credentialExpiresAtMs: session.session.expiresAtMs,
    origin: 'https://wallet.example.test',
  };
  const binding = api.WalletRelocationChallengeBinding.parse(input);
  const [issued, concurrent] = await Promise.all([
    store.issue(binding, nowMs, nowMs + 600_000),
    store.issue(binding, nowMs + 1, nowMs + 600_000),
  ]);
  assert.deepEqual(concurrent, issued);
  assert.equal(issued.state, 'issued');
  assert.equal(issued.expiresAtMs, issued.createdAtMs + 300_000);
  assert.equal(Buffer.from(issued.challengeB64u, 'base64url').length, 32);
  assert.deepEqual(await store.issue(binding, nowMs + 1, nowMs + 900_000), issued);
  await assert.rejects(store.issue(api.WalletRelocationChallengeBinding.parse({ ...input, destinationRegion: 'US' }), nowMs + 1, nowMs + 600_000), /binding changed/);
  assert.equal(await new api.D1WalletRelocationChallenges(database, { ...scope, envId: 'other' }).read(binding), null);
  assert.throws(() => store.prepareConsume(issued, nowMs - 1), /invalid or expired/);
  assert.throws(() => store.prepareConsume(issued, issued.expiresAtMs), /invalid or expired/);
  await assert.rejects(database.batch([
    ...store.prepareConsume(issued, nowMs + 2),
    database.prepare('INSERT INTO router_ab_yao_versioned_json_cas_guard (guard_id) VALUES (1)'),
  ]));
  assert.deepEqual(await store.read(binding), issued);
  await database.batch(store.prepareConsume(issued, nowMs + 3));
  const consumed = await store.read(binding);
  assert.equal(consumed.state, 'consumed');
  assert.equal(consumed.consumedAtMs, nowMs + 3);
  await assert.rejects(database.batch(store.prepareConsume(issued, nowMs + 4)));
  assert.deepEqual(await store.issue(binding, nowMs + 1_000_000, nowMs), consumed);
  const factorBound = api.WalletRelocationChallengeBinding.parse({ ...input, moveId: `wmove_${Buffer.alloc(32, 94).toString('base64url')}` });
  const shorter = await store.issue(factorBound, nowMs, nowMs + 30_000);
  assert.equal(shorter.expiresAtMs, nowMs + 30_000);
  const credentialBound = api.WalletRelocationChallengeBinding.parse({ ...input, moveId: `wmove_${Buffer.alloc(32, 95).toString('base64url')}`, credentialExpiresAtMs: nowMs + 10_000 });
  assert.equal((await store.issue(credentialBound, nowMs, nowMs + 30_000)).expiresAtMs, nowMs + 10_000);
  return {
    scope: 'Challenge persistence only; excludes factor verification, full-owner approval, and Console admission',
    fiveMinuteMaximum: true,
    factorExpiryCapsChallenge: true,
    credentialExpiryCapsChallenge: true,
    concurrentIssueReturnsOneChallenge: true,
    exactIssueRetryPreservesChallengeAndExpiry: true,
    changedDestinationRejected: true,
    tenantScopeIsolated: true,
    failedBatchPreservesUnspentChallenge: true,
    exactConsumptionRequiredAndSingleUse: true,
    consumedChallengeNeverReissued: true,
  };
}

async function authenticateRelocationOwner(authorizationSessions, issued, nowMs) {
  const origin = api.parseSessionOrigin('https://wallet.example.test');
  const owner = await api.WalletRelocationOwnerRequest.authenticate({
    request: relocationOwnerHttpRequest(issued.operationCredential.token, origin),
    walletId: issued.session.walletId,
    tenantId: issued.session.tenantId,
    scope,
    allowedOrigins: [origin],
    authorizationSessions,
    nowMs,
  });
  assert.ok(owner);
  return owner;
}

async function verifyRelocationPasskey(database) {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x, 'base64url');
  // COSE OKP key: kty=1, alg=-8, crv=6, x=32-byte Ed25519 public key.
  const cose = Buffer.concat([Buffer.from('a4010103272006215820', 'hex'), publicKey]);
  const nowMs = Date.now();
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'relocation-passkey',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    credentialPublicKeyB64u: cose.toString('base64url'),
    expiresAtMs: nowMs + 60_000,
    identity: {
      walletId: 'wallet:relocation-passkey',
      authorityId: 'authority:relocation-passkey',
      walletAuthMethodId: 'auth-method:relocation-passkey',
      rpId: 'wallet.example.test',
    },
  });
  const authorizationSessions = service(database, scope);
  const issued = await issueDeviceSession(database, authorizationSessions, fixture, nowMs);
  const owner = await authenticateRelocationOwner(authorizationSessions, issued, nowMs);
  const authenticators = new api.CloudflareD1WebAuthnStore({ database, ...scope });
  await authenticators.writeAuthenticator({
    userId: fixture.authority.walletId,
    record: {
      credentialIdB64u: fixture.authMethod.credentialIdB64u,
      credentialPublicKeyB64u: fixture.authMethod.credentialPublicKeyB64u,
      counter: 0,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      deviceInfo: {
        label: 'Test authenticator',
        browser: 'other',
        os: 'other',
        synced: false,
        transports: [],
      },
    },
  });
  const bindingInput = {
    walletId: fixture.authority.walletId,
    moveId: `wmove_${Buffer.alloc(32, 96).toString('base64url')}`,
    requestDigestHex: 'cd'.repeat(32),
    sourceGeneration: 1,
    destinationRegion: 'APAC',
    authorityId: fixture.authority.authorityId,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    credentialDigestHex: digest(Buffer.from(issued.operationCredential.token)),
    credentialExpiresAtMs: nowMs + 60_000,
    origin: 'https://wallet.example.test',
  };
  const binding = api.WalletRelocationChallengeBinding.parse(bindingInput);
  const store = new api.D1WalletRelocationChallenges(database, scope);
  const challenge = await store.issue(binding, nowMs, nowMs + 60_000);
  const input = { database, scope, binding, nowMs: nowMs + 1 };
  const credential = relocationAssertion(
    keys.privateKey,
    fixture.authMethod,
    challenge.challengeB64u,
    binding.origin,
    5,
  );
  assert.equal(
    (
      await api.verifyWalletRelocationPasskey({
        ...input,
        credential: relocationAssertion(
          keys.privateKey,
          fixture.authMethod,
          challenge.challengeB64u,
          binding.origin,
          1,
        ),
      })
    ).kind,
    'denied',
  );
  assert.equal(
    (
      await api.verifyWalletRelocationPasskey({
        ...input,
        credential: relocationAssertion(
          keys.privateKey,
          fixture.authMethod,
          'different-purpose',
          binding.origin,
          5,
        ),
      })
    ).kind,
    'denied',
  );
  assert.equal(
    (
      await api.verifyWalletRelocationPasskey({
        ...input,
        credential: relocationAssertion(
          keys.privateKey,
          fixture.authMethod,
          challenge.challengeB64u,
          'https://other.example.test',
          5,
        ),
      })
    ).kind,
    'denied',
  );
  assert.equal(
    (
      await api.verifyWalletRelocationPasskey({
        ...input,
        credential,
        nowMs: challenge.expiresAtMs,
      })
    ).kind,
    'denied',
  );
  const verified = await api.verifyWalletRelocationPasskey({ ...input, credential });
  assert.equal(verified.kind, 'verified');
  assert.equal((await store.read(binding)).state, 'issued');
  const approvals = new api.D1WalletRelocationApprovals(database, scope);
  await database.exec(
    "CREATE TRIGGER fail_relocation_approval BEFORE INSERT ON wallet_relocation_approvals BEGIN SELECT RAISE(ABORT, 'injected approval failure'); END;",
  );
  await assert.rejects(
    approvals.approvePasskey({ owner, binding, credential, nowMs: input.nowMs }),
    /injected approval failure/,
  );
  assert.equal((await store.read(binding)).state, 'issued');
  assert.equal(await approvals.read(binding), null);
  assert.equal(
    (
      await authenticators.readAuthenticator({
        userId: binding.walletId,
        credentialIdB64u: fixture.authMethod.credentialIdB64u,
      })
    ).counter,
    0,
  );
  await database.exec('DROP TRIGGER fail_relocation_approval;');
  const [approved, concurrent] = await Promise.all([
    approvals.approvePasskey({ owner, binding, credential, nowMs: input.nowMs }),
    approvals.approvePasskey({ owner, binding, credential, nowMs: input.nowMs + 1 }),
  ]);
  assert.equal(approved.kind, 'approved');
  assert.deepEqual(concurrent, approved);
  assert.equal(approved.approval.expiresAtMs, challenge.expiresAtMs);
  assert.equal(approved.approval.authorityDigestB64u, fixture.authority.authorityDigestB64u);
  assert.equal(approved.approval.authorityRevocationEpoch, fixture.authority.revocationEpoch);
  const reopenedApprovals = new api.D1WalletRelocationApprovals(database, scope);
  assert.deepEqual(
    await reopenedApprovals.approvePasskey({
      owner,
      binding,
      credential: null,
      nowMs: challenge.expiresAtMs + 1,
    }),
    approved,
  );
  await assert.rejects(
    reopenedApprovals.approvePasskey({
      owner,
      binding: api.WalletRelocationChallengeBinding.parse({
        ...bindingInput,
        destinationRegion: 'US',
      }),
      credential,
      nowMs: input.nowMs,
    }),
    /binding changed/,
  );
  assert.equal(
    await new api.D1WalletRelocationApprovals(database, { ...scope, envId: 'foreign' }).read(
      binding,
    ),
    null,
  );
  assert.equal(
    (
      await authenticators.readAuthenticator({
        userId: binding.walletId,
        credentialIdB64u: fixture.authMethod.credentialIdB64u,
      })
    ).counter,
    1,
  );
  assert.equal((await store.read(binding)).state, 'consumed');
  assert.equal((await api.verifyWalletRelocationPasskey({ ...input, credential })).kind, 'denied');
  const expiredBinding = api.WalletRelocationChallengeBinding.parse({
    ...bindingInput,
    moveId: `wmove_${Buffer.alloc(32, 99).toString('base64url')}`,
  });
  const expired = await store.issue(expiredBinding, nowMs - 120_000, nowMs - 60_000);
  await assert.rejects(
    approvals.approvePasskey({
      owner,
      binding: expiredBinding,
      credential: relocationAssertion(
        keys.privateKey,
        fixture.authMethod,
        expired.challengeB64u,
        binding.origin,
        5,
        2,
      ),
      nowMs: nowMs - 90_000,
    }),
  );
  assert.equal(await approvals.read(expiredBinding), null);
  assert.equal((await store.read(expiredBinding)).state, 'issued');
  const retiredBinding = owner.bindMove({
    moveId: `wmove_${Buffer.alloc(32, 104).toString('base64url')}`,
    requestDigestHex: 'fa'.repeat(32),
    sourceGeneration: 1,
    destinationRegion: 'APAC',
  });
  const retiredChallenge = await store.issue(retiredBinding, nowMs, nowMs + 60_000);
  await authorizationSessions.retireWalletSessionAuthorizationsForAuthMethod({
    tenantId: issued.session.tenantId,
    walletId: issued.session.walletId,
    walletAuthMethodId: issued.session.walletAuthMethodId,
    nowMs: nowMs + 3,
  });
  await assert.rejects(
    approvals.approvePasskey({
      owner,
      binding: retiredBinding,
      credential: relocationAssertion(
        keys.privateKey,
        fixture.authMethod,
        retiredChallenge.challengeB64u,
        binding.origin,
        5,
        2,
      ),
      nowMs: nowMs + 4,
    }),
  );
  assert.equal(await approvals.read(retiredBinding), null);
  assert.equal((await store.read(retiredBinding)).state, 'issued');
  assert.equal(
    (
      await authenticators.readAuthenticator({
        userId: binding.walletId,
        credentialIdB64u: fixture.authMethod.credentialIdB64u,
      })
    ).counter,
    1,
  );
  assert.deepEqual(await approvals.read(binding), approved.approval);

  assert.equal(
    (
      await authenticators.readAuthenticator({
        userId: binding.walletId,
        credentialIdB64u: fixture.authMethod.credentialIdB64u,
      })
    ).counter,
    1,
  );
  const secondBinding = api.WalletRelocationChallengeBinding.parse({
    walletId: binding.walletId,
    moveId: `wmove_${Buffer.alloc(32, 97).toString('base64url')}`,
    requestDigestHex: binding.requestDigestHex,
    sourceGeneration: binding.sourceGeneration,
    destinationRegion: binding.destinationRegion,
    authorityId: binding.authorityId,
    walletAuthMethodId: binding.walletAuthMethodId,
    credentialDigestHex: binding.credentialDigestHex,
    credentialExpiresAtMs: binding.credentialExpiresAtMs,
    origin: binding.origin,
  });
  const second = await store.issue(secondBinding, nowMs, nowMs + 60_000);
  const secondInput = {
    database,
    scope,
    binding: secondBinding,
    nowMs: nowMs + 2,
    credential: relocationAssertion(
      keys.privateKey,
      fixture.authMethod,
      second.challengeB64u,
      binding.origin,
      5,
      2,
    ),
  };
  const beforeCounterChange = await api.verifyWalletRelocationPasskey(secondInput);
  assert.equal(beforeCounterChange.kind, 'verified');
  await authenticators.updateAuthenticatorCounter({
    userId: binding.walletId,
    credentialIdB64u: fixture.authMethod.credentialIdB64u,
    newCounter: 2,
    updatedAtMs: nowMs + 2,
  });
  await assert.rejects(database.batch(beforeCounterChange.commitPrerequisites));
  assert.equal((await store.read(secondBinding)).state, 'issued');
  assert.equal((await api.verifyWalletRelocationPasskey(secondInput)).kind, 'denied');
  const freshInput = {
    ...secondInput,
    credential: relocationAssertion(
      keys.privateKey,
      fixture.authMethod,
      second.challengeB64u,
      binding.origin,
      5,
      3,
    ),
  };
  const beforeRevocation = await api.verifyWalletRelocationPasskey(freshInput);
  assert.equal(beforeRevocation.kind, 'verified');
  const backup = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'relocation-backup',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'device_link',
    sourceAuthorityId: fixture.authority.authorityId,
    identity: {
      walletId: binding.walletId,
      authorityId: 'authority:relocation-backup',
      walletAuthMethodId: 'auth-method:relocation-backup',
      credentialIdB64u: Buffer.alloc(32, 98).toString('base64url'),
      rpId: 'wallet.example.test',
    },
  });
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: backup.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: backup.authMethod }),
  ]);
  const revoked = await new api.D1WalletAuthorityStore({ database, scope }).revokeWalletAuthMethod({
    walletId: binding.walletId,
    authorityId: binding.authorityId,
    walletAuthMethodId: binding.walletAuthMethodId,
    expectedAuthorityRevocationEpoch: fixture.authority.revocationEpoch,
    requestedAtMs: nowMs + 3,
  });
  assert.equal(revoked.kind, 'revoked_method');
  await assert.rejects(database.batch(beforeRevocation.commitPrerequisites));
  assert.equal((await store.read(secondBinding)).state, 'issued');
  assert.equal((await api.verifyWalletRelocationPasskey(freshInput)).kind, 'denied');
  return {
    retiredInitiatingSessionRejectsApprovalWithoutConsumingProof: true,
    scope:
      'Real initiating-session authentication, passkey approval persistence and transactional guards; excludes HTTP admission and transfer',
    expiryCheckedAtTransactionCommit: true,
    exactApprovalRecordedWithProofConsumption: true,
    concurrentApprovalReturnsOriginalOutcome: true,
    lostReplyReplayAfterExpiryPreservesOutcome: true,
    changedApprovalBindingRejected: true,
    approvalTenantScopeIsolated: true,
    signedAssertionVerified: true,
    userVerificationRequired: true,
    wrongPurposeOriginAndExpiryRejected: true,
    verificationDoesNotConsumeChallenge: true,
    authenticatorCounterCommitsWithChallenge: true,
    competingCounterChangeRejectsStaleCommit: true,
    failedApprovalBatchPreservesChallenge: true,
    revocationAfterVerificationRejectsCommit: true,
    committedChallengeCannotReplayAsFreshProof: true,
  };
}

function relocationAssertion(privateKey, method, challenge, origin, flags, counter = 1) {
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
  const authenticatorFlags = Buffer.alloc(5);
  authenticatorFlags[0] = flags;
  authenticatorFlags.writeUInt32BE(counter, 1);
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(method.rpId).digest(),
    authenticatorFlags,
  ]);
  const signed = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(clientData).digest(),
  ]);
  return {
    id: method.credentialIdB64u,
    rawId: method.credentialIdB64u,
    type: 'public-key',
    response: {
      clientDataJSON: clientData.toString('base64url'),
      authenticatorData: authenticatorData.toString('base64url'),
      signature: sign(null, signed, privateKey).toString('base64url'),
      userHandle: null,
    },
  };
}

async function verifyRelocationEmailOtp(database) {
  const nowMs = Date.now();
  const email = 'relocation@example.test';
  const providerUserId = 'google:relocation-otp';
  const fixture = await api.buildEmailOtpEcdsaWalletSessionFixture({
    label: 'relocation-otp',
    walletId: 'wallet:relocation-otp',
    providerUserId,
    emailHashHex: digest(Buffer.from(email)),
    expiresAtMs: nowMs + 60_000,
  });
  const authorizationSessions = service(database, scope);
  const issued = await issueDeviceSession(database, authorizationSessions, fixture, nowMs);
  const owner = await authenticateRelocationOwner(authorizationSessions, issued, nowMs);
  const prepare = api.prepareD1TenantStatement.bind(null, database, scope);
  const emailOtpEnrollments = new api.CloudflareD1EmailOtpEnrollmentStore({ prepare });
  const enrollment = api.buildEmailOtpEnrollmentFixture({
    walletId: fixture.authority.walletId,
    orgId: scope.orgId,
    providerUserId,
    email,
    nowMs,
  });
  await emailOtpEnrollments.putEnrollment(enrollment);
  const emailOtpChallenges = new api.CloudflareD1EmailOtpChallengeStore({ database, ...scope });
  const policy = { limit: 100, windowMs: 60_000 };
  const emailOtpRateLimits = new api.CloudflareD1EmailOtpRateLimitStore({
    prepare,
    rateLimits: {
      challenge: policy,
      verify: policy,
      grant: policy,
      googleRegistrationAttempt: policy,
    },
  });
  const verifier = new api.CloudflareD1EmailOtpChallengeVerifier({
    emailOtpChallenges,
    emailOtpEnrollments,
    emailOtpRateLimits,
    lockoutTtlMs: 60_000,
  });
  const binding = api.WalletRelocationChallengeBinding.parse({
    walletId: fixture.authority.walletId,
    moveId: `wmove_${Buffer.alloc(32, 100).toString('base64url')}`,
    requestDigestHex: 'de'.repeat(32),
    sourceGeneration: 1,
    destinationRegion: 'APAC',
    authorityId: fixture.authority.authorityId,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    credentialDigestHex: digest(Buffer.from(issued.operationCredential.token)),
    credentialExpiresAtMs: nowMs + 60_000,
    origin: 'https://wallet.example.test',
  });
  const challenges = new api.D1WalletRelocationChallenges(database, scope);
  const challenge = await challenges.issue(binding, nowMs, nowMs + 30_000);
  const ownerProofBindingDigest = await api.walletRelocationEmailOtpBinding(
    scope,
    binding,
    challenge.challengeB64u,
  );
  const otpInput = {
    challengeId: 'otp:relocation',
    challengeSubjectId: providerUserId,
    walletId: binding.walletId,
    orgId: scope.orgId,
    email,
    otpCode: '483920',
    ownerProofBindingDigest,
    action: 'wallet_email_otp_relocation',
    operation: 'wallet_relocation',
    createdAtMs: nowMs,
    expiresAtMs: nowMs + 30_000,
    maxAttempts: 5,
  };
  await emailOtpChallenges.put(api.emailOtpChallengeRecord(otpInput));
  await emailOtpChallenges.put(
    api.emailOtpChallengeRecord({
      ...otpInput,
      challengeId: 'otp:signing',
      action: 'wallet_email_otp_login',
      operation: 'transaction_sign',
    }),
  );
  const approvals = new api.D1WalletRelocationApprovals(database, scope);
  const input = {
    owner,
    binding,
    challengeId: otpInput.challengeId,
    otpCode: otpInput.otpCode,
    nowMs: nowMs + 1,
    verifier,
    emailOtpChallenges,
  };
  assert.equal(
    (await approvals.approveEmailOtp({ ...input, challengeId: 'otp:signing' })).kind,
    'denied',
  );
  assert.ok(await emailOtpChallenges.read('otp:signing'));
  assert.equal((await approvals.approveEmailOtp({ ...input, otpCode: '000000' })).kind, 'denied');
  assert.equal((await emailOtpChallenges.read(otpInput.challengeId)).attemptCount, 1);
  const beforeEnrollmentRemoval = await api.verifyWalletRelocationEmailOtp({
    database,
    scope,
    ...input,
  });
  assert.equal(beforeEnrollmentRemoval.kind, 'verified');
  await emailOtpEnrollments.deleteEnrollment(binding.walletId);
  await assert.rejects(database.batch(beforeEnrollmentRemoval.commitPrerequisites));
  assert.ok(await emailOtpChallenges.read(otpInput.challengeId));
  assert.equal((await challenges.read(binding)).state, 'issued');
  await emailOtpEnrollments.putEnrollment(enrollment);
  await database.exec(
    "CREATE TRIGGER fail_relocation_approval BEFORE INSERT ON wallet_relocation_approvals BEGIN SELECT RAISE(ABORT, 'injected OTP approval failure'); END;",
  );
  await assert.rejects(approvals.approveEmailOtp(input), /injected OTP approval failure/);
  assert.ok(await emailOtpChallenges.read(otpInput.challengeId));
  assert.equal((await challenges.read(binding)).state, 'issued');
  assert.equal(await approvals.read(binding), null);
  await database.exec('DROP TRIGGER fail_relocation_approval;');
  const approved = await approvals.approveEmailOtp(input);
  assert.equal(approved.kind, 'approved');
  assert.equal(approved.approval.expiresAtMs, nowMs + 30_000);
  assert.equal(await emailOtpChallenges.read(otpInput.challengeId), null);
  assert.equal((await challenges.read(binding)).state, 'consumed');
  assert.deepEqual(
    await approvals.approveEmailOtp({ ...input, otpCode: '000000', nowMs: nowMs + 90_000 }),
    approved,
  );
  assert.ok(await emailOtpChallenges.read('otp:signing'));
  return {
    scope:
      'OTP verification and atomic approval through production stores; excludes email delivery, factor unsealing, owner HTTP authentication and Console admission',
    initiatingSessionGuardUsesIssuedCredential: true,
    enrollmentRemovalRejectsStaleCommit: true,
    distinctRelocationPurpose: true,
    signingChallengeRejectedAndPreserved: true,
    wrongCodeUsesExistingAttemptLimit: true,
    failedApprovalPreservesBothChallenges: true,
    approvalConsumesOtpAndRelocationChallengeTogether: true,
    approvalExpiryCappedByOtp: true,
    exactReplayRequiresNoSecondOtp: true,
  };
}

async function verifyRelocationOwnerRequest(database) {
  const nowMs = Date.now();
  const authorizationSessions = service(database, scope);
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'relocation-owner-request',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: nowMs + 60_000,
    identity: {
      walletId: 'wallet:owner-request',
      authorityId: 'authority:owner-request',
      walletAuthMethodId: 'auth-method:owner-request',
      rpId: 'wallet.example.test',
      credentialIdB64u: Buffer.alloc(32, 101).toString('base64url'),
    },
  });
  const issued = await issueDeviceSession(database, authorizationSessions, fixture, nowMs);
  const origin = api.parseSessionOrigin('https://wallet.example.test');
  const request = relocationOwnerHttpRequest(issued.operationCredential.token, origin);
  const input = {
    request,
    walletId: fixture.authority.walletId,
    tenantId: issued.session.tenantId,
    scope,
    allowedOrigins: [origin],
    authorizationSessions,
    nowMs: nowMs + 1,
  };
  const owner = await api.WalletRelocationOwnerRequest.authenticate(input);
  assert.ok(owner);
  const move = {
    moveId: `wmove_${Buffer.alloc(32, 102).toString('base64url')}`,
    requestDigestHex: 'be'.repeat(32),
    sourceGeneration: 1,
    destinationRegion: 'APAC',
  };
  const binding = owner.bindMove(move);
  assert.equal(binding.walletId, issued.session.walletId);
  assert.equal(binding.authorityId, issued.session.authorityId);
  assert.equal(binding.walletAuthMethodId, issued.session.walletAuthMethodId);
  assert.equal(binding.credentialExpiresAtMs, issued.session.expiresAtMs);
  assert.equal(binding.credentialDigestHex, digest(Buffer.from(issued.operationCredential.token)));
  assert.equal(binding.origin, origin);
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({ ...input, allowedOrigins: [] }),
    null,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({
      ...input,
      request: relocationOwnerHttpRequest(
        issued.operationCredential.token,
        'https://foreign.example.test',
      ),
    }),
    null,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({
      ...input,
      request: relocationOwnerHttpRequest('', origin),
    }),
    null,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({ ...input, walletId: 'wallet:foreign' }),
    null,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({
      ...input,
      scope: { ...scope, envId: 'foreign' },
    }),
    null,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({
      ...input,
      nowMs: issued.session.expiresAtMs,
    }),
    null,
  );
  await database
    .prepare(
      `UPDATE authorization_wallet_session_quotas SET remaining_uses = 0, lifecycle_kind = 'exhausted'
    WHERE namespace = ? AND tenant_id = ? AND quota_id = ?`,
    )
    .bind(scope.namespace, issued.session.tenantId, issued.session.quotaId)
    .run();
  const exhausted = await api.WalletRelocationOwnerRequest.authenticate(input);
  assert.ok(exhausted);
  assert.equal(exhausted.bindMove(move).encoded(), binding.encoded());
  await authorizationSessions.retireWalletSessionAuthorizationsForAuthMethod({
    tenantId: issued.session.tenantId,
    walletId: issued.session.walletId,
    walletAuthMethodId: issued.session.walletAuthMethodId,
    nowMs: nowMs + 2,
  });
  assert.equal(await api.WalletRelocationOwnerRequest.authenticate(input), null);
  const delegated = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'relocation-delegated-request',
    permissions: api.buildSigningOnlyDelegatedWalletAuthorityV1().permissions,
    provenance: 'device_link',
    sourceAuthorityId: fixture.authority.authorityId,
    expiresAtMs: nowMs + 60_000,
    identity: {
      walletId: fixture.authority.walletId,
      authorityId: 'authority:delegated-request',
      walletAuthMethodId: 'auth-method:delegated-request',
      rpId: 'wallet.example.test',
      credentialIdB64u: Buffer.alloc(32, 103).toString('base64url'),
    },
  });
  const delegatedIssued = await issueDeviceSession(
    database,
    authorizationSessions,
    delegated,
    nowMs,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({
      ...input,
      request: relocationOwnerHttpRequest(delegatedIssued.operationCredential.token, origin),
    }),
    null,
  );
  return {
    scope:
      'Initiating primary credential and move binding only; excludes move-only status, owner routes and Console admission',
    credentialAndAuthorityBoundToMove: true,
    originAllowlistRequired: true,
    foreignWalletAndDeploymentRejected: true,
    expiredAndRetiredCredentialsRejected: true,
    exhaustedSigningQuotaAllowsOwnerAuthentication: true,
    delegatedAuthorityRejected: true,
  };
}

function relocationOwnerHttpRequest(token, origin) {
  return new Request('https://gateway.example.test/wallet/placement/v1/relocations', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin },
    body: '{}',
  });
}
