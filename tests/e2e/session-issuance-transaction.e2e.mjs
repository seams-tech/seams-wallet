import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';
import {
  establishRegistrationHome,
  seedRegistrationHome,
  seedExecutionGeneration,
} from './execution-generation.scenario.mjs';

class RegistrationDirectoryWithLostReply {
  calls = 0;
  sessions = [];

  async complete(input) {
    this.calls += 1;
    if (input.outcome === 'established') this.sessions.push(input.session);
    if (this.calls === 1) throw new Error('Injected lost completion reply');
    return { ok: true };
  }
}

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
  const registrationCompletion = await verifyRegistrationCompletion(database, now);
  await writeFile(
    resolve(output, 'proof.json'),
    JSON.stringify(
      {
        registrationCompletion,
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

async function verifyRegistrationCompletion(database, now) {
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'registration-session-completion',
    keyFamily: 'ed25519',
    identity: {
      walletId: 'wallet:registration-session-completion',
      authorityId: 'authority:registration-session-completion',
      walletAuthMethodId: 'method:registration-session-completion',
      rpId: 'registration-session.example.test',
      credentialIdB64u: Buffer.alloc(32, 95).toString('base64url'),
    },
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: now + 3_600_000,
  });
  const identity = {
    walletId: fixture.authority.walletId,
    ceremonyId: 'session-completion-ceremony',
  };
  const directory = new RegistrationDirectoryWithLostReply();
  const authority = new api.D1WalletExecutionAuthority(database, scope, directory);
  await seedRegistrationHome({ database, scope, ...identity });
  assert.equal((await authority.admitHome(identity)).ok, true);
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
  const service = authorizationService(database);
  const beforeWrongCeremony = await snapshot(database);
  await assert.rejects(
    service.commitDirectWalletSessionAuthorizationV2(
      input,
      { kind: 'validated_registration_authority_projection' },
      { kind: 'registration', ceremonyId: 'another-ceremony' },
    ),
  );
  assert.deepEqual(await snapshot(database), beforeWrongCeremony);
  const traced = new api.TracedD1Database(database);
  const registrationService = authorizationService(traced);
  const purpose = { kind: 'registration', ceremonyId: identity.ceremonyId };
  const race = await Promise.all([
    registrationService.commitDirectWalletSessionAuthorizationV2(
      input,
      { kind: 'validated_registration_authority_projection' },
      purpose,
    ),
    registrationService.commitDirectWalletSessionAuthorizationV2(
      input,
      { kind: 'validated_registration_authority_projection' },
      purpose,
    ),
  ]);
  assert.deepEqual(race.map(registrationResultKind).sort(), ['already_committed', 'issued']);
  const trace = JSON.parse(traced.response(new Response()).headers.get('x-benchmark-d1'));
  assert.equal(trace.calls.length, 2);
  assert.ok(trace.calls.every(isCommitBatch));
  const generation = await database
    .prepare(
      'SELECT state, registration_completion FROM wallet_execution_generations WHERE wallet_id = ?',
    )
    .bind(identity.walletId)
    .first();
  assert.deepEqual(generation, { state: 'registering', registration_completion: 'established' });
  assert.equal((await authority.admitEstablishedHome({ walletId: identity.walletId })).ok, false);
  const winner = race.find(registrationIssued);
  assert.ok(winner);
  assert.deepEqual(winner.registration, { ...identity, state: 'registering' });
  const completion = { registration: winner.registration, session: winner.publication };
  // Ordinary signing does not wait for the directory. The activation commits with
  // a pending publication, and a lost reply leaves that publication pending.
  const completionTrace = new api.TracedD1Database(database);
  const completionAuthority = new api.D1WalletExecutionAuthority(completionTrace, scope, directory);
  assert.equal(
    (await establishRegistrationHome(completionAuthority, completionTrace, completion)).ok,
    true,
  );
  const completionCalls = JSON.parse(
    completionTrace.response(new Response()).headers.get('x-benchmark-d1'),
  ).calls;
  assert.deepEqual(completionCalls.map(callMethod), ['batch', 'run']);
  assert.equal(directory.calls, 1);
  assert.equal((await authority.admitEstablishedHome({ walletId: identity.walletId })).ok, true);
  assert.deepEqual(await pendingPublications(database, identity.walletId), [
    {
      ceremony_id: identity.ceremonyId,
      session_digest: winner.publication.digest,
      session_expires_at_ms: winner.publication.expiresAtMs,
      state: 'pending',
      attempts: 1,
    },
  ]);
  await assert.rejects(authority.cancel(identity));
  assert.equal(directory.calls, 1);
  const beforeRetry = await snapshot(database);
  const retry = await service.commitDirectWalletSessionAuthorizationV2(
    input,
    { kind: 'validated_registration_authority_projection' },
    purpose,
  );
  assert.equal(retry.result.kind, 'already_committed');
  assert.deepEqual(await snapshot(database), beforeRetry);
  assert.deepEqual(retry.registration, { ...identity, state: 'active' });
  // An exact retry of an active home is local and publishes nothing.
  assert.equal(
    (
      await establishRegistrationHome(authority, database, {
        registration: retry.registration,
        session: retry.publication,
      })
    ).ok,
    true,
  );
  assert.equal(directory.calls, 1);
  // The scheduled resumption sends the original digest and expiry, then deletes the row.
  assert.deepEqual(
    await authority.resumeDirectoryPublications({ nowMs: Date.now(), limit: 10 }),
    { acknowledged: 0, deferred: 0, refused: 0 },
  );
  assert.deepEqual(
    await authority.resumeDirectoryPublications({ nowMs: Date.now() + 3_600_000, limit: 10 }),
    { acknowledged: 1, deferred: 0, refused: 0 },
  );
  assert.equal(directory.calls, 2);
  assert.deepEqual(directory.sessions[1], directory.sessions[0]);
  assert.deepEqual(directory.sessions[0], {
    kind: 'credential',
    walletId: identity.walletId,
    digest: winner.publication.digest,
    expiresAtMs: winner.publication.expiresAtMs,
  });
  assert.deepEqual(await pendingPublications(database, identity.walletId), []);
  await database
    .prepare("UPDATE wallet_execution_generations SET state = 'retired' WHERE wallet_id = ?")
    .bind(identity.walletId)
    .run();
  const retired = await snapshot(database);
  await assert.rejects(
    service.commitDirectWalletSessionAuthorizationV2(
      input,
      { kind: 'validated_registration_authority_projection' },
      purpose,
    ),
  );
  assert.deepEqual(await snapshot(database), retired);
  assert.equal(directory.calls, 2);
  return {
    wrongCeremonyRollsBackSession: true,
    concurrentIssuance: race.map(registrationResultKind).sort(),
    sessionAndDecisionShareOneBatch: true,
    publicationUsesCommittedHomeState: true,
    lostReplyLeavesPublicationPending: true,
    conflictingCancellationCannotReachDirectory: true,
    exactRetryPreservesSession: true,
    completionCalls,
    activeReplayDoesNotRepublish: true,
    resumptionSendsOriginalSession: true,
    retiredHomeCannotCommitRegistration: true,
  };
}

async function pendingPublications(database, walletId) {
  return (
    await database
      .prepare(
        `SELECT ceremony_id, session_digest, session_expires_at_ms, state, attempts
         FROM wallet_registration_directory_publications WHERE wallet_id = ?`,
      )
      .bind(walletId)
      .all()
  ).results;
}

function registrationResultKind(value) {
  return value.result.kind;
}

function registrationIssued(value) {
  return value.result.kind === 'issued';
}

function callMethod(value) {
  return value.method;
}
