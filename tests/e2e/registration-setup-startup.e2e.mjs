// Registration setup starts the reserved wallet's custody objects once, and a
// replayed setup starts nothing again. The setup runs through the assembled
// Gateway service, so the starter must survive every layer between the
// composition and the setup itself.
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';

const output = resolve('.artifacts/registration-setup-startup');
const scope = { namespace: 'setup-startup', orgId: 'org', projectId: 'project', envId: 'test' };
await mkdir(output, { recursive: true });
const bundle = await build({
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['*.wasm', 'bs58'],
  tsconfig: 'packages/wallet-server/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
      export { createCloudflareD1RouterApiAuthService } from './packages/wallet-server/src/router/cloudflare/d1/auth/d1RouterApiAuthService';
      export { LocalRegistrationSetupAuthority } from './packages/wallet-server/src/localRegistrationSetupAuthority';
      export { createRegistrationSetupOperationId } from './packages/shared-ts/src/utils/registrationSetupOperation';
      export { implicitNearAccountProvisioning, REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION } from './packages/shared-ts/src/utils/registrationSignerPlan';
      export { THRESHOLD_ED25519_2P_PARTICIPANT_IDS } from './packages/shared-ts/src/threshold/participants';
    `,
  },
});
const bundlePath = resolve(output, 'production-api.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));
const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("registration setup"); } };',
  d1Databases: ['SIGNER_DB'],
  compatibilityDate: '2026-06-12',
  port: 0,
});
try {
  const database = await runtime.getD1Database('SIGNER_DB');
  await migrate(database);
  const started = [];
  const options = {
    database,
    ...scope,
    registrationAuthority: new api.LocalRegistrationSetupAuthority(database, scope),
  };
  const registration = api.createCloudflareD1RouterApiAuthService({
    ...options,
    startRegistrationWallets: started.push.bind(started),
  }).walletRegistration;
  const runtimePolicyScope = {
    orgId: scope.orgId,
    projectId: scope.projectId,
    envId: scope.envId,
    signingRootVersion: 'default',
  };
  const input = {
    request: {
      registrationOperationId: api.createRegistrationSetupOperationId(),
      signerSelection: {
        kind: 'signer_set',
        signers: [
          {
            kind: 'near_ed25519',
            accountProvisioning: api.implicitNearAccountProvisioning(),
            signerSlot: 1,
            participantIds: [...api.THRESHOLD_ED25519_2P_PARTICIPANT_IDS],
            derivationVersion: api.REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION,
          },
        ],
      },
      authMethod: { kind: 'passkey', rpId: 'wallet.example.test' },
    },
    orgId: scope.orgId,
    expectedOrigin: 'https://app.example.test',
    signer: { signJwt },
    runtimePolicyScope,
    signingRootId: `${scope.projectId}:${scope.envId}`,
    signingRootVersion: runtimePolicyScope.signingRootVersion,
  };

  const first = await setup(registration, input);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.kind, 'near_ed25519');
  // The local authority never relocates a wallet, so the reserved generation is the first.
  assert.deepEqual(started, [{ walletId: first.walletId, ownershipGeneration: 1 }]);

  const replay = await setup(registration, input);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.registrationCeremonyId, first.registrationCeremonyId);
  assert.equal(started.length, 1, 'A replayed setup must not start the wallet again');

  const other = await setup(registration, {
    ...input,
    request: { ...input.request, registrationOperationId: api.createRegistrationSetupOperationId() },
  });
  assert.equal(other.ok, true, JSON.stringify(other));
  assert.notEqual(other.walletId, first.walletId);
  assert.deepEqual(started[1], { walletId: other.walletId, ownershipGeneration: 1 });
  assert.equal(started.length, 2);

  // Startup is optional: a host with no starter still completes setup.
  const unstarted = await setup(api.createCloudflareD1RouterApiAuthService(options).walletRegistration, {
    ...input,
    request: { ...input.request, registrationOperationId: api.createRegistrationSetupOperationId() },
  });
  assert.equal(unstarted.ok, true, JSON.stringify(unstarted));
  assert.equal(started.length, 2);
  await writeFile(
    resolve(output, 'result.json'),
    `${JSON.stringify({ firstSetupStarts: 1, replayedSetupStarts: 0, secondWalletStarts: 1, hostWithoutStarterCompletes: true }, null, 2)}\n`,
  );
  console.log('registration setup startup: passed');
} finally {
  await runtime.dispose();
}

async function setup(registration, input) {
  const response = await registration.setupWalletRegistration(input);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

async function signJwt(sub, extra) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub, ...extra })}.${encode('fixture')}`;
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
