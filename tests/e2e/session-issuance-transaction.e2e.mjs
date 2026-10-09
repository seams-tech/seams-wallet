import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';
import { seedExecutionGeneration } from './execution-generation.scenario.mjs';

const output = resolve('.artifacts/session-issuance-transaction');
const scope = { namespace: 'issuance', orgId: 'org', projectId: 'project', envId: 'test' };
const sessionTables = [
  'wallet_session_authorizations_v2',
  'authorization_wallet_session_quotas',
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
      export { D1WalletExecutionAuthority } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
      export { prepareD1WalletAuthorityPutStatement } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
      export { prepareD1WalletAuthMethodV2PutStatement } from './packages/wallet-server/src/core/d1WalletAuthMethodStore';
      export { buildLinkedDeviceManagementAuthorityFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';
      export { buildFullOwnerPermissionsV1 } from './packages/shared-ts/src/authorization/delegatedAuthority';
      export { buildWalletAuthMethodRecordV2 } from './packages/shared-ts/src/utils/walletAuthMethodRecord';
      export { TracedD1Database } from './tests/r150-hosted/gateway/d1Trace';
    `,
  },
});
const bundlePath = resolve(output, 'production-api.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));
const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("session issuance"); } };',
  d1Databases: ['SIGNER_DB'],
  compatibilityDate: '2026-06-12',
  port: 0,
});
try {
  const database = await runtime.getD1Database('SIGNER_DB');
  await migrate(database);
  const now = Date.now();
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'issuance-race',
    keyFamily: 'ed25519',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: now + 3_600_000,
  });
  await seedExecutionGeneration({ api, database, scope, walletId: fixture.authority.walletId });
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: fixture.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: fixture.authMethod }),
  ]);
  const input = {
    tenantId: fixture.issuedSession.session.tenantId,
    principalId: fixture.issuedSession.session.principalId,
    walletId: fixture.authority.walletId,
    authority: fixture.authority,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    mintId: fixture.issuedSession.session.mintId,
    remainingUses: 7,
    issuedAtMs: now,
    expiresAtMs: now + 3_600_000,
  };
  const traced = new api.TracedD1Database(database);
  const service = authorizationService(traced);
  const race = await Promise.all([
    service.issueDirectWalletSessionAuthorizationV2(input),
    service.issueDirectWalletSessionAuthorizationV2(input),
  ]);
  assert.deepEqual(race.map(resultKind).sort(), ['already_committed', 'issued']);
  const winner = race.find(isIssued);
  assert.ok(winner);
  assert.equal(winner.operationCredential.ownershipGeneration, 1);
  const raceTrace = JSON.parse(traced.response(new Response()).headers.get('x-benchmark-d1'));
  assert.equal(raceTrace.calls.length, 2);
  assert.ok(raceTrace.calls.every(isCommitBatch));
  const appOrigin = api.parseSessionOrigin('https://app.example.test');
  const walletOrigin = api.parseSessionOrigin('https://wallet.example.test');
  await service.mintHostedWalletSeamsSessionExchange({
    authorization: winner,
    appOrigin,
    walletOrigin,
    issuedAtMs: now,
    expiresAtMs: input.expiresAtMs,
  });
  const beforeReplay = await snapshot(database);
  assert.equal(
    (await service.issueDirectWalletSessionAuthorizationV2(input)).kind,
    'already_committed',
  );
  assert.deepEqual(await snapshot(database), beforeReplay);
  const replacement = await service.issueDirectWalletSessionAuthorizationV2({
    ...input,
    mintId: 'wallet-mint:replacement',
    issuedAtMs: now + 1,
  });
  assert.equal(replacement.kind, 'issued');
  const exchange = await service.mintHostedWalletSeamsSessionExchange({
    authorization: replacement,
    appOrigin,
    walletOrigin,
    issuedAtMs: now + 1,
    expiresAtMs: input.expiresAtMs,
  });
  const hosted = await service.redeemHostedWalletSeamsSessionExchange({
    exchangeCode: exchange.exchangeCode,
    nonce: exchange.nonce,
    appOrigin,
    walletOrigin,
    redeemedAtMs: now + 2,
  });
  assert.equal(hosted.kind, 'redeemed');
  await service.mintHostedWalletSeamsSessionExchange({
    authorization: replacement,
    appOrigin,
    walletOrigin,
    issuedAtMs: now + 2,
    expiresAtMs: input.expiresAtMs,
  });
  const beforeRetiredReplay = await snapshot(database);
  assert.equal(
    (await service.issueDirectWalletSessionAuthorizationV2(input)).kind,
    'already_committed',
  );
  assert.deepEqual(await snapshot(database), beforeRetiredReplay);
  const method = fixture.authMethod;
  const revoked = api.buildWalletAuthMethodRecordV2({
    version: method.version,
    kind: 'passkey',
    status: 'revoked',
    walletAuthMethodId: method.walletAuthMethodId,
    walletId: method.walletId,
    walletAuthorityId: method.walletAuthorityId,
    rpId: method.rpId,
    credentialIdB64u: method.credentialIdB64u,
    credentialPublicKeyB64u: method.credentialPublicKeyB64u,
    counter: method.counter,
    createdAtMs: method.createdAtMs,
    updatedAtMs: now + 3,
    activatedAtMs: method.activatedAtMs,
    revokedAtMs: now + 3,
  });
  await api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: revoked }).run();
  await assert.rejects(
    service.issueDirectWalletSessionAuthorizationV2({
      ...input,
      mintId: 'wallet-mint:revoked-method',
      issuedAtMs: now + 3,
    }),
  );
  assert.deepEqual(await snapshot(database), beforeRetiredReplay);
  const closedFixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'closed-generation',
    keyFamily: 'ed25519',
    identity: {
      walletId: 'wallet:closed-generation',
      authorityId: 'authority:closed-generation',
      walletAuthMethodId: 'method:closed-generation',
      rpId: 'closed-generation.example.test',
      credentialIdB64u: Buffer.alloc(32, 94).toString('base64url'),
    },
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: now + 3_600_000,
  });
  await seedExecutionGeneration({
    api,
    database,
    scope,
    walletId: closedFixture.authority.walletId,
  });
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({
      database,
      scope,
      authority: closedFixture.authority,
    }),
    api.prepareD1WalletAuthMethodV2PutStatement({
      database,
      scope,
      record: closedFixture.authMethod,
    }),
  ]);
  const closedInput = {
    tenantId: closedFixture.issuedSession.session.tenantId,
    principalId: closedFixture.issuedSession.session.principalId,
    walletId: closedFixture.authority.walletId,
    authority: closedFixture.authority,
    walletAuthMethodId: closedFixture.authMethod.walletAuthMethodId,
    mintId: closedFixture.issuedSession.session.mintId,
    remainingUses: 7,
    issuedAtMs: now,
    expiresAtMs: now + 3_600_000,
  };
  assert.equal((await service.issueDirectWalletSessionAuthorizationV2(closedInput)).kind, 'issued');
  const beforeClosedGeneration = await snapshot(database);
  await database
    .prepare("UPDATE wallet_execution_generations SET state = 'retired' WHERE wallet_id = ?")
    .bind(closedInput.walletId)
    .run();
  await assert.rejects(
    service.issueDirectWalletSessionAuthorizationV2({
      ...closedInput,
      mintId: 'wallet-mint:closed-generation',
      issuedAtMs: now + 4,
    }),
    /open execution generation/,
  );
  assert.deepEqual(await snapshot(database), beforeClosedGeneration);
  assert.equal(
    (await service.issueDirectWalletSessionAuthorizationV2(closedInput)).kind,
    'already_committed',
  );
  assert.deepEqual(await snapshot(database), beforeClosedGeneration);
  await writeFile(
    resolve(output, 'proof.json'),
    JSON.stringify(
      {
        concurrentIssuance: race.map(resultKind).sort(),
        ownershipGeneration: winner.operationCredential.ownershipGeneration,
        d1CallsPerIssuance: 1,
        raceTrace,
        activeMintReplayPreservesAllSessionRows: true,
        retiredMintReplayPreservesSuccessorAndHostedChildren: true,
        revokedMethodCannotMintOrRetireExistingSessions: true,
        closedGenerationCannotMintOrRetireExistingSessions: true,
        closedGenerationReplayRemainsCredentialFree: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Session issuance evidence:', resolve(output, 'proof.json'));
} finally {
  await runtime.dispose();
}

function authorizationService(database) {
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
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
async function migrate(database) {
  const directory = 'packages/wallet-server/migrations/d1-signer';
  for (const name of (await readdir(directory)).filter(isSql).sort()) {
    let sql = await readFile(`${directory}/${name}`, 'utf8');
    if (name === '0028_r103f_phase1_additive_schema_bridge.sql') {
      sql = buildWorkerdCompatiblePhase1Bridge(sql);
    }
    const statements = [];
    for (const query of unstable_splitSqlQuery(sql)) statements.push(database.prepare(query));
    await database.batch(statements);
  }
}
async function snapshot(database) {
  const rows = {};
  for (const table of sessionTables) {
    rows[table] = (await database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
  }
  return rows;
}
function isSql(name) {
  return name.endsWith('.sql');
}
function resultKind(result) {
  return result.kind;
}
function isIssued(result) {
  return result.kind === 'issued';
}
function isCommitBatch(call) {
  return call.method === 'batch';
}
