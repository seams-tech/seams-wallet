// Run from the repository root: node tests/e2e/signer-rows-read.e2e.mjs
//
// The rows that the session, signing and registration statements read must not
// grow with the number of wallets in the Gateway database. A lookup without a
// usable index reads every session or every wallet of the tenant, also inside a
// trigger, and D1 reports those rows in `meta.rows_read`.
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';
import { seedExecutionGeneration } from './execution-generation.scenario.mjs';

const output = resolve('.artifacts/signer-rows-read');
const scope = { namespace: 'rows-read', orgId: 'org', projectId: 'project', envId: 'test' };
// A lookup without a usable index reads a row for each added wallet, or for
// each second one when it stops at its match. The rows that a statement reads
// also vary by a few with the position of its keys in their index pages.
const ADDED_WALLETS = 24;
const ALLOWED_GROWTH = ADDED_WALLETS / 2 - 1;
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
      export { CloudflareD1AuthorizationStore } from './packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
      export { D1WalletExecutionAuthority } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
      export { D1RegistrationCeremonyRecordStore } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1RegistrationCeremonyRecordStore';
      export { prepareD1WalletAuthorityPutStatement } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
      export { prepareD1WalletAuthMethodV2PutStatement } from './packages/wallet-server/src/core/d1WalletAuthMethodStore';
      export { buildLinkedDeviceManagementAuthorityFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';
      export { buildSessionSigningOperationInputFixture } from './tests/unit/helpers/authorizedOperation.fixtures';
      export { buildFullOwnerPermissionsV1 } from './packages/shared-ts/src/authorization/delegatedAuthority';
      export { TracedD1Database } from './tests/r150-hosted/gateway/d1Trace';
    `,
  },
});
const bundlePath = resolve(output, 'production-api.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));
const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("signer rows read"); } };',
  d1Databases: ['SIGNER_DB'],
  compatibilityDate: '2026-06-12',
  port: 0,
});
try {
  const database = await runtime.getD1Database('SIGNER_DB');
  await migrate(database);
  const now = Date.now();
  await useWallet(database, 0, now);
  const small = await useWallet(database, 1, now);
  for (let index = 2; index < ADDED_WALLETS + 1; index += 1) await useWallet(database, index, now);
  const large = await useWallet(database, ADDED_WALLETS + 1, now);
  const growth = {};
  for (const step of Object.keys(small)) growth[step] = large[step] - small[step];
  await writeFile(
    resolve(output, 'proof.json'),
    JSON.stringify({ addedWallets: ADDED_WALLETS, small, large, growth }, null, 2) + '\n',
  );
  for (const step of Object.keys(small)) {
    assert.ok(
      growth[step] <= ALLOWED_GROWTH,
      `${step} read ${growth[step]} more rows after ${ADDED_WALLETS} more wallets`,
    );
  }
  console.log('Signer rows read evidence:', resolve(output, 'proof.json'));
} finally {
  await runtime.dispose();
}

/**
 * Registers one wallet and runs each measured statement once for it.
 * Returns the rows that each step read.
 */
async function useWallet(database, index, now) {
  const label = `rows-read-${String(index).padStart(3, '0')}`;
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label,
    keyFamily: 'ed25519',
    identity: {
      walletId: `wallet:${label}`,
      authorityId: `authority:${label}`,
      walletAuthMethodId: `method:${label}`,
      rpId: `${label}.example.test`,
      credentialIdB64u: Buffer.alloc(32, index + 1).toString('base64url'),
    },
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: now + 3_600_000,
  });
  const walletId = fixture.authority.walletId;
  await seedExecutionGeneration({ api, database, scope, walletId });
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: fixture.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: fixture.authMethod }),
  ]);
  const rows = {};

  const ceremonyTrace = new api.TracedD1Database(database);
  const ceremonies = new api.D1RegistrationCeremonyRecordStore({
    database: ceremonyTrace,
    scope,
    keyPrefix: 'rows-read',
  });
  const ceremony = { registrationCeremonyId: `ceremony:${label}` };
  const expiresAtMs = now + 3_600_000;
  await ceremonies.putExact({ scope: 'ceremony', id: label, value: ceremony, expiresAtMs });
  assert.equal(
    await ceremonies.updateExpectedVersion({
      scope: 'ceremony',
      id: label,
      expectedVersion: 1,
      next: { ...ceremony, step: 'updated' },
      expiresAtMs,
    }),
    2,
  );
  rows.ceremonyRecord = rowsRead(ceremonyTrace);

  const sessionTrace = new api.TracedD1Database(database);
  const issued = await authorizationService(sessionTrace).issueDirectWalletSessionAuthorizationV2({
    tenantId: fixture.issuedSession.session.tenantId,
    principalId: fixture.issuedSession.session.principalId,
    walletId,
    authority: fixture.authority,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    mintId: fixture.issuedSession.session.mintId,
    remainingUses: 7,
    issuedAtMs: now,
    expiresAtMs,
  });
  assert.equal(issued.kind, 'issued');
  rows.sessionIssuance = rowsRead(sessionTrace);

  const operationTrace = new api.TracedD1Database(database);
  const operations = new api.CloudflareD1AuthorizationStore({
    database: operationTrace,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  const claimed = await operations.admitAuthorizedOperation({
    operation: api.buildSessionSigningOperationInputFixture({
      session: issued.session,
      label,
      nowMs: now + 1,
    }),
  });
  assert.equal(claimed.kind, 'claimed');
  rows.operationClaim = rowsRead(operationTrace);

  // The hosted Gateway admission resolves a registration continuation with
  // this lookup on every request.
  const continuation = await database
    .prepare(
      `SELECT wallet_id FROM wallet_execution_generations
        WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
          AND origin = 'registration' AND origin_id = ?`,
    )
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, `absent:${label}`)
    .run();
  rows.registrationContinuation = continuation.meta.rows_read;
  return rows;
}

function rowsRead(traced) {
  let total = 0;
  const trace = JSON.parse(traced.response(new Response()).headers.get('x-benchmark-d1'));
  for (const call of trace.calls) {
    for (const statement of call.statements) total += statement.rowsRead ?? 0;
  }
  return total;
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

function isSql(name) {
  return name.endsWith('.sql');
}
