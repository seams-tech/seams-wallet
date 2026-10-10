// Exercise the production credential reservation and wallet commit against D1.
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';

class CredentialDirectory {
  requests = [];
  pending = [];

  claim(input) {
    this.requests.push(input);
    const pending = Promise.withResolvers();
    this.pending.push(pending);
    return pending.promise;
  }

  answer(accepted) {
    assert.ok(this.pending.length > 0);
    this.pending.shift().resolve(accepted);
  }

  loseReply() {
    assert.ok(this.pending.length > 0);
    this.pending.shift().reject(new Error('Injected lost credential claim reply'));
  }
}

const output = resolve('.artifacts/registration-credential-reservation');
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
      export { CloudflareD1WalletRegistrationCommitStore } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationCommitStore';
      export { buildD1WalletRecord } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1RegistrationCeremonyRecords';
      export { buildPasskeyRegistrationAuthorityFixture } from './tests/unit/helpers/nearRegistration.fixtures';
    `,
  },
});
const bundlePath = resolve(output, 'production-api.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));
const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("credential reservation"); } };',
  d1Databases: ['SIGNER_DB'],
  compatibilityDate: '2026-06-12',
  port: 0,
});
try {
  const database = await runtime.getD1Database('SIGNER_DB');
  await migrate(database);
  const directory = new CredentialDirectory();
  const store = new api.CloudflareD1WalletRegistrationCommitStore({
    database,
    credentialClaims: directory,
    namespace: 'claim-overlap',
    orgId: 'org',
    projectId: 'project',
    envId: 'test',
  });
  const authority = api.buildPasskeyRegistrationAuthorityFixture('claim-overlap');
  const now = Date.now();
  const input = {
    kind: 'passkey_wallet_registration_commit_v1',
    wallet: api.buildD1WalletRecord({ walletId: authority.walletId, now }),
    walletSigners: [],
    now,
    decisionStatements: [],
  };
  const before = await snapshot(database);
  const denied = store.reserveAuthority(authority);
  const rejection = assert.rejects(denied, /belongs to another wallet/);
  assert.equal(directory.requests.length, 1);
  assert.deepEqual(await snapshot(database), before);
  directory.answer(false);
  await rejection;
  assert.deepEqual(await snapshot(database), before);

  const lost = store.reserveAuthority(authority);
  const lostReply = assert.rejects(lost, /lost credential claim reply/);
  directory.loseReply();
  await lostReply;
  assert.deepEqual(await snapshot(database), before);

  const retry = store.reserveAuthority(authority);
  directory.answer(true);
  const commit = await retry;
  const other = api.buildPasskeyRegistrationAuthorityFixture('other-wallet');
  await assert.rejects(commit({
    ...input,
    wallet: api.buildD1WalletRecord({ walletId: other.walletId, now }),
  }), /walletId does not match/);
  assert.deepEqual(await snapshot(database), before);

  // A failed local write remains atomic, and its successful claim can retry.
  await assert.rejects(commit({
    ...input,
    decisionStatements: [database.prepare('INSERT INTO missing_registration_table VALUES (1)')],
  }));
  assert.deepEqual(await snapshot(database), before);
  await commit(input);
  const committed = await snapshot(database);
  assert.equal(committed.wallets.length, 1);
  assert.equal(committed.webauthn_authenticators.length, 1);
  assert.equal(committed.webauthn_credential_bindings.length, 1);
  await commit(input);
  assert.deepEqual(await snapshot(database), committed);
  assert.deepEqual(directory.requests, Array(3).fill({
    walletId: authority.walletId,
    rpId: authority.rpId,
    credentialIdB64u: authority.credentialIdB64u,
  }));
  const evidence = {
    refusedClaimLeavesNoWallet: true,
    lostClaimReplyLeavesNoWallet: true,
    commitRetainsClaimedWalletIdentity: true,
    failedLocalWriteRollsBack: true,
    exactCommitReplayPreservesRows: true,
    commitDoesNotRepeatDirectoryClaim: true,
    directoryCalls: directory.requests.length,
  };
  await writeFile(resolve(output, 'proof.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Credential reservation evidence: ${resolve(output, 'proof.json')}`);
} finally {
  await runtime.dispose();
}

async function migrate(database) {
  const directory = 'packages/wallet-server/migrations/d1-signer';
  for (const name of (await readdir(directory)).filter(isSql).sort()) {
    let sql = await readFile(`${directory}/${name}`, 'utf8');
    if (name === '0028_r103f_phase1_additive_schema_bridge.sql') {
      sql = buildWorkerdCompatiblePhase1Bridge(sql);
    }
    await database.batch(unstable_splitSqlQuery(sql).map(database.prepare.bind(database)));
  }
}

function isSql(name) {
  return name.endsWith('.sql');
}

async function snapshot(database) {
  const rows = {};
  for (const table of ['wallets', 'webauthn_authenticators', 'webauthn_credential_bindings']) {
    rows[table] = (await database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
  }
  return rows;
}
