// Exercise the production credential reservation and wallet commit against D1.
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';
import { seedRegistrationHome } from './execution-generation.scenario.mjs';

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
  external: ['bs58'],
  write: false,
  tsconfig: 'packages/wallet-server/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
      export { CloudflareD1WalletRegistrationCommitStore } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationCommitStore';
      export { buildD1WalletRecord } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1RegistrationCeremonyRecords';
      export { buildPasskeyRegistrationAuthorityFixture } from './tests/unit/helpers/nearRegistration.fixtures';
      export { buildNearRegistrationSignerFixture } from './tests/unit/helpers/nearRegistrationSigner.fixtures';
      export { buildLinkedDeviceManagementAuthorityFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';
      export { buildFullOwnerPermissionsV1 } from './packages/shared-ts/src/authorization/delegatedAuthority';
      export { AuthorizationService } from './packages/wallet-server/src/authorization/service';
      export { capabilityPolicyPort } from './packages/wallet-server/src/authorization/capabilityPolicy';
      export { CloudflareD1AuthorizationStore } from './packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
      export { registrationEstablishedMintId } from './packages/wallet-server/src/router/cloudflare/d1/registration/walletRegistrationSessionCommitReceipt';
      export { TracedD1Database } from './tests/r150-hosted/gateway/d1Trace';
    `,
  },
});
const bundlePath = resolve(output, 'production-api.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));

class ConcurrentWalletDatabase extends api.TracedD1Database {
  pendingCommit = null;

  async batch(statements) {
    if (this.pendingCommit && statements.some(writesWallet)) {
      const competingCommit = this.pendingCommit;
      this.pendingCommit = null;
      await competingCommit();
    }
    return super.batch(statements);
  }
}

class DelayedFoundingDatabase extends api.TracedD1Database {
  capabilityRead = Promise.withResolvers();
  readsOverlapped = false;

  async measure(method, queries, execute) {
    if (queries.some(readsFoundingAuthority)) {
      const timeout = setTimeout(
        this.capabilityRead.reject,
        5_000,
        new Error('Capability read waited for the delayed founding-record read'),
      );
      try {
        await this.capabilityRead.promise;
        this.readsOverlapped = true;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (queries.some(readsCapability)) this.capabilityRead.resolve();
    return await super.measure(method, queries, execute);
  }
}

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
  const traced = new ConcurrentWalletDatabase(database);
  const store = new api.CloudflareD1WalletRegistrationCommitStore({
    database: traced,
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
    walletSigners: [await api.buildNearRegistrationSignerFixture('claim-overlap', now)],
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
  await assert.rejects(
    commit({
      ...input,
      wallet: api.buildD1WalletRecord({ walletId: other.walletId, now }),
    }),
    /walletId does not match/,
  );
  assert.deepEqual(await snapshot(database), before);

  // A failed local write remains atomic, and its successful claim can retry.
  await assert.rejects(
    commit({
      ...input,
      decisionStatements: [traced.prepare('INSERT INTO missing_registration_table VALUES (1)')],
    }),
  );
  assert.deepEqual(await snapshot(database), before);
  const callsBeforeCommit = trace(traced).length;
  await commit(input);
  const commitCalls = trace(traced).slice(callsBeforeCommit);
  assert.equal(
    commitCalls.length,
    2,
    'Fresh wallet and capability commit uses one read and one batch',
  );
  const tables = new Set(commitCalls[1].statements.flatMap(statementTables));
  for (const table of ['wallets', 'wallet_signers', 'router_ab_yao_versioned_json_records']) {
    assert.ok(tables.has(table), `${table} must commit in the same batch`);
  }
  const committed = await snapshot(database);
  assert.equal(committed.wallets.length, 1);
  assert.equal(committed.wallet_signers.length, 1);
  assert.equal(committed.capabilities.length, 1);
  assert.equal(committed.webauthn_authenticators.length, 1);
  assert.equal(committed.webauthn_credential_bindings.length, 1);
  await commit(input);
  assert.deepEqual(await snapshot(database), committed);
  assert.deepEqual(
    directory.requests,
    Array(3).fill({
      walletId: authority.walletId,
      rpId: authority.rpId,
      credentialIdB64u: authority.credentialIdB64u,
    }),
  );

  // Another wallet wins the cache version after our read, before our write.
  const otherStore = new api.CloudflareD1WalletRegistrationCommitStore({
    database,
    credentialClaims: { claim: acceptCredential },
    namespace: 'claim-overlap',
    orgId: 'org',
    projectId: 'project',
    envId: 'test',
  });
  const commitOther = await otherStore.reserveAuthority(other);
  traced.pendingCommit = commitOther.bind(undefined, {
    kind: 'passkey_wallet_registration_commit_v1',
    wallet: api.buildD1WalletRecord({ walletId: other.walletId, now }),
    walletSigners: [await api.buildNearRegistrationSignerFixture('other-wallet', now)],
    now,
    decisionStatements: [],
  });
  const beforeRace = trace(traced).length;
  await commit(input);
  const raceCalls = trace(traced).slice(beforeRace);
  const walletWrites = raceCalls.filter(writesWalletBatch);
  assert.equal(walletWrites.length, 2);
  assert.equal(walletWrites[0].outcome, 'error');
  assert.equal(walletWrites[1].outcome, 'ok');
  const afterRace = await snapshot(database);
  assert.equal(afterRace.wallets.length, 2);
  assert.equal(afterRace.wallet_signers.length, 2);
  const cached = JSON.stringify(afterRace.capabilities);
  assert.ok(cached.includes(authority.walletId));
  assert.ok(cached.includes(other.walletId));

  const overlap = await verifyIndependentCommitReads(database, now);
  const evidence = {
    refusedClaimLeavesNoWallet: true,
    lostClaimReplyLeavesNoWallet: true,
    commitRetainsClaimedWalletIdentity: true,
    failedLocalWriteRollsBack: true,
    exactCommitReplayPreservesRows: true,
    commitDoesNotRepeatDirectoryClaim: true,
    directoryCalls: directory.requests.length,
    walletAndCapabilityCommitD1Calls: commitCalls.length,
    walletAndCapabilityCommitTrace: commitCalls,
    concurrentWalletPreserved: true,
    concurrentWalletWriteAttempts: walletWrites.length,
    concurrentCommitTrace: raceCalls,
    independentCommitReads: overlap,
  };
  await writeFile(resolve(output, 'proof.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Credential reservation evidence: ${resolve(output, 'proof.json')}`);
} finally {
  await runtime.dispose();
}

async function verifyIndependentCommitReads(database, now) {
  const authority = api.buildPasskeyRegistrationAuthorityFixture('independent-reads');
  const signer = await api.buildNearRegistrationSignerFixture('independent-reads', now);
  const founding = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'independent-reads',
    keyFamily: 'ed25519',
    provenance: 'wallet_registration',
    permissions: api.buildFullOwnerPermissionsV1(),
    identity: {
      walletId: authority.walletId,
      authorityId: 'authority:independent-reads',
      walletAuthMethodId: 'auth-method:independent-reads',
      rpId: authority.rpId,
      credentialIdB64u: authority.credentialIdB64u,
    },
    credentialPublicKeyB64u: authority.credentialPublicKeyB64u,
    ed25519Signer: {
      walletKeyId: signer.nearEd25519SigningKeyId,
      registeredPublicKeyB64u: Buffer.from(
        signer.activeYaoCapability.activationResult.public_receipt.registered_public_key,
      ).toString('base64url'),
    },
  });
  const traced = new DelayedFoundingDatabase(database);
  const scope = {
    namespace: 'independent-reads',
    orgId: 'org',
    projectId: 'project',
    envId: 'test',
  };
  const store = new api.CloudflareD1WalletRegistrationCommitStore({
    database: traced,
    credentialClaims: { claim: acceptCredential },
    ...scope,
  });
  const commit = await store.reserveAuthority(authority);
  const walletInput = {
    kind: 'passkey_wallet_registration_commit_v1',
    wallet: api.buildD1WalletRecord({ walletId: authority.walletId, now }),
    walletSigners: [signer],
    foundingAuthority: founding.authority,
    foundingAuthMethod: founding.authMethod,
    now,
    decisionStatements: [],
  };
  const sessionStore = new api.CloudflareD1AuthorizationStore({
    database: traced,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  const service = new api.AuthorizationService({
    policy: api.capabilityPolicyPort,
    sessions: sessionStore,
    grants: sessionStore,
    evidence: sessionStore,
    authorizedOperations: sessionStore,
    audit: {},
  });
  const ceremonyId = 'registration:combined-session';
  await seedRegistrationHome({ database, scope, walletId: authority.walletId, ceremonyId });
  const sessionInput = {
    tenantId: founding.issuedSession.session.tenantId,
    principalId: founding.issuedSession.session.principalId,
    walletId: authority.walletId,
    authority: founding.authority,
    walletAuthMethodId: founding.authMethod.walletAuthMethodId,
    mintId: api.registrationEstablishedMintId(ceremonyId),
    remainingUses: 7,
    issuedAtMs: now,
    expiresAtMs: now + 3_600_000,
  };
  const commitWithSession = service.commitDirectWalletSessionAuthorizationV2.bind(
    service,
    sessionInput,
    { kind: 'validated_registration_authority_projection' },
    { kind: 'registration', ceremonyId },
    sessionStore.commitRegistrationWalletSessionAuthorizationV2.bind(
      sessionStore,
      commit.bind(undefined, walletInput),
    ),
  );
  const beforeSessionFailure = await snapshot(database);
  await database
    .prepare(
      `CREATE TRIGGER reject_initial_session
    BEFORE INSERT ON wallet_session_authorizations_v2
    BEGIN SELECT RAISE(ABORT, 'injected_initial_session_failure'); END`,
    )
    .run();
  await assert.rejects(commitWithSession(), /injected_initial_session_failure/);
  assert.deepEqual(await snapshot(database), beforeSessionFailure);
  await database.prepare('DROP TRIGGER reject_initial_session').run();

  const callsBefore = trace(traced).length;
  const issued = await commitWithSession();
  assert.equal(issued.result.kind, 'issued');
  assert.deepEqual(issued.registration, {
    ceremonyId,
    walletId: authority.walletId,
    state: 'registering',
  });
  assert.equal(traced.readsOverlapped, true);
  const calls = trace(traced).slice(callsBefore);
  assert.equal(calls.length, 3);
  assert.ok(writesWalletBatch(calls[2]));
  const tables = new Set(calls[2].statements.flatMap(statementTables));
  for (const table of [
    'wallets',
    'wallet_signers',
    'wallet_authorities',
    'wallet_auth_methods',
    'router_ab_yao_versioned_json_records',
    'wallet_session_authorizations_v2',
    'authorization_wallet_session_quotas',
    'wallet_execution_generations',
  ]) {
    assert.ok(tables.has(table), `${table} must share the wallet/session transaction`);
  }
  const committed = await snapshot(database);
  // Ignore the successful response. Two retries must preserve its credential and quota.
  const replay = await Promise.all([commitWithSession(), commitWithSession()]);
  assert.ok(replay.every(sessionWasAlreadyCommitted));
  assert.deepEqual(await snapshot(database), committed);
  return {
    delayedFoundingReadDidNotBlockCapabilityRead: true,
    initialSessionFailureRollsBackWalletAndCapability: true,
    concurrentLostReplyRetriesPreserveCredentialAndQuota: true,
    walletCapabilityAndSessionD1Calls: calls.length,
    calls,
  };
}

function sessionWasAlreadyCommitted(commit) {
  return commit.result.kind === 'already_committed';
}

function readsFoundingAuthority(query) {
  return query.kind === 'SELECT' && query.tables.includes('wallet_authorities');
}

function readsCapability(query) {
  return query.kind === 'SELECT' && query.tables.includes('router_ab_yao_versioned_json_records');
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
  for (const table of [
    'wallets',
    'wallet_signers',
    'webauthn_authenticators',
    'webauthn_credential_bindings',
    'wallet_authorities',
    'wallet_auth_methods',
    'wallet_session_authorizations_v2',
    'authorization_wallet_session_quotas',
    'wallet_execution_generations',
  ]) {
    rows[table] = (await database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
  }
  rows.capabilities = (
    await database
      .prepare(
        'SELECT record_key, record_json FROM router_ab_yao_versioned_json_records ORDER BY record_key',
      )
      .all()
  ).results;
  return rows;
}

function trace(database) {
  const recorded = JSON.parse(database.response(new Response()).headers.get('X-Benchmark-D1'));
  assert.equal(recorded.pending, 0);
  assert.equal(recorded.dropped, 0);
  return recorded.calls;
}

function statementTables(statement) {
  return statement.query.tables;
}

function writesWallet(statement) {
  return statement.query.kind !== 'SELECT' && statement.query.tables.includes('wallets');
}

function writesWalletBatch(call) {
  return call.statements.some(writesWallet);
}

async function acceptCredential() {
  return true;
}
