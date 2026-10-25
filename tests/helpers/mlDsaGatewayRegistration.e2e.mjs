import assert from 'node:assert/strict';
import {
  verifyMlDsaPublicSigning,
  replayPublicMlDsaSigning,
  GatewayTransport,
} from './mlDsaPublicSigning.e2e.mjs';
import { verifyMlDsaRetainedSignerLifecycle } from './mlDsaLifecycle.e2e.mjs';
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as signBytes,
  verify,
} from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';

const origin = 'https://wallet.example.test';
const otherOrigin = 'https://other.wallet.example.test';

function hash(value) {
  return createHash('sha256').update(value).digest();
}
function isSql(name) {
  return name.endsWith('.sql');
}
async function migrate(database, root, api, scope) {
  const directory = join(root, 'packages/wallet-server/migrations/d1-signer');
  for (const name of (await readdir(directory)).filter(isSql).sort()) {
    let sql = await readFile(join(directory, name), 'utf8');
    if (name === '0028_r103f_phase1_additive_schema_bridge.sql')
      sql = buildWorkerdCompatiblePhase1Bridge(sql);
    if (name === '0083_ml_dsa_operation_evidence.sql') {
      await api.seedClassicalMigrationEvidence(database, scope);
      const before = await migrationEvidence(database);
      assert.equal(before.length, 2);
      await database.batch(unstable_splitSqlQuery(sql).map(database.prepare.bind(database)));
      assert.deepEqual(await migrationEvidence(database), before);
    } else {
      await database.batch(unstable_splitSqlQuery(sql).map(database.prepare.bind(database)));
    }
  }
}

async function migrationEvidence(database) {
  return (
    await database
      .prepare(
        "SELECT * FROM verified_wallet_operation_evidence_sets WHERE wallet_id='migration-wallet' ORDER BY evidence_set_id",
      )
      .all()
  ).results;
}
export function credentialKey() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y, 'base64url'),
  ]);
  return {
    privateKey: pair.privateKey,
    credentialId: randomBytes(32).toString('base64url'),
    publicKey: cose.toString('base64url'),
  };
}
export function assertion(key, challenge, expectedOrigin = origin) {
  const client = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge, origin: expectedOrigin }),
  );
  const suffix = Buffer.alloc(5);
  suffix[0] = 5;
  if (key.counter > 0) key.counter += 1;
  suffix.writeUInt32BE(key.counter ?? 0, 1);
  const authenticator = Buffer.concat([hash('wallet.example.test'), suffix]);
  return {
    id: key.credentialId,
    rawId: key.credentialId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: client.toString('base64url'),
      authenticatorData: authenticator.toString('base64url'),
      signature: signBytes(
        'sha256',
        Buffer.concat([authenticator, hash(client)]),
        key.privateKey,
      ).toString('base64url'),
      userHandle: null,
    },
  };
}
async function next(client) {
  const line = await client.lines.next();
  assert.equal(line.done, false, 'Gateway custody client ended early');
  return JSON.parse(line.value);
}
async function phase(database, scope, walletId, slot = 1) {
  return database
    .prepare(
      `SELECT version, record_json FROM router_ab_yao_versioned_json_records WHERE namespace=? AND org_id=? AND project_id=? AND env_id=? AND record_key=?`,
    )
    .bind(
      scope.namespace,
      scope.orgId,
      scope.projectId,
      scope.envId,
      `ml-dsa-registration:${JSON.stringify([walletId, `near-ml-dsa-65:${slot}`])}`,
    )
    .first();
}
async function custodySnapshot(database, scope, walletId) {
  const rows = await database
    .prepare(
      `SELECT record_key, version, record_json FROM router_ab_yao_versioned_json_records WHERE namespace=? AND org_id=? AND project_id=? AND env_id=? AND substr(record_key,1,17)='passkey-envelope:' AND json_extract(record_json,'$.walletId')=? ORDER BY record_key`,
    )
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId)
    .all();
  return JSON.stringify(rows.results);
}
function relocationSource(api, walletId) {
  return api.WalletRelocationSessionSource.parse({
    walletId,
    moveId: `wmove_${'a'.repeat(43)}`,
    requestDigestHex: 'a'.repeat(64),
    sourceGeneration: 1,
  });
}
function writesJournal(statement) {
  return (
    statement.query.kind !== 'SELECT' &&
    statement.query.tables.includes('router_ab_yao_versioned_json_records')
  );
}

async function issueAdmission(gateway, scope, walletId, key, slot, purpose) {
  const issued = await gateway.service.walletAuthMethods.createAddSignerIntent({
    command: {
      subject: { kind: 'wallet_signer_management', walletId },
      signerSelection: { mode: 'ml_dsa_65', mlDsa: { signerSlot: slot, purpose } },
    },
    orgId: scope.orgId,
    runtimePolicyScope: {
      orgId: scope.orgId,
      projectId: scope.projectId,
      envId: 'dev',
      signingRootVersion: 'default',
    },
    expectedOrigin: origin,
  });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  const body = {
    addSignerIntentGrant: issued.addSignerIntentGrant,
    addSignerIntentDigestB64u: issued.addSignerIntentDigestB64u,
    intent: issued.intent,
    auth: {
      kind: 'webauthn_assertion',
      rpId: 'wallet.example.test',
      credential: assertion(key, issued.addSignerIntentDigestB64u),
      expectedChallengeDigestB64u: issued.addSignerIntentDigestB64u,
    },
  };
  return { issued, body };
}

class Gateway {
  constructor(api, database, scope, proxy) {
    this.protocolHeader = {
      [api.WALLET_MANAGEMENT_PROTOCOL_HEADER]: api.WALLET_MANAGEMENT_PROTOCOL_VERSION,
    };
    this.service = api.createCloudflareD1RouterApiAuthService({
      database,
      ...scope,
      mlDsaRegistrationProxy: proxy,
      mlDsaSignerWasmModuleOrPath: api.signingWasmModule(),
    });
    this.fetch = api.createFetchRouter(
      this.service,
      {
        corsOrigins: [origin, otherOrigin],
        hostedWalletOrigins: [origin, otherOrigin],
        logger: console,
      },
      { kind: 'inline' },
    );
  }
  async post(wallet, action, body, requestOrigin = origin) {
    const response = await this.fetch(
      new Request(
        `https://gateway.example.test/wallets/${encodeURIComponent(wallet)}/signers/${action}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Origin: requestOrigin,
            ...this.protocolHeader,
          },
          body: JSON.stringify(body),
        },
      ),
    );
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text) };
  }
}

class CompletionLossProxy {
  constructor(proxy) {
    this.proxy = proxy;
    this.internalServiceAuthSecret = proxy.internalServiceAuthSecret;
    this.loseKeyId = null;
    this.completion = null;
  }
  async fetch(request) {
    const input =
      this.loseKeyId && new URL(request.url).pathname === '/router-ab/ml-dsa/register'
        ? await request.clone().json()
        : null;
    const response = await this.proxy.fetch(request);
    if (input?.key_id !== this.loseKeyId || !this.loseKeyId || response.status !== 200)
      return response;
    const body = await response.clone().json();
    if (body.operation?.state !== 'complete') return response;
    this.completion = body.operation.result;
    this.loseKeyId = null;
    return new Response('Injected lost Router completion', { status: 503 });
  }
}

class PublicationDatabase {
  mode = 'none';
  paused = Promise.withResolvers();
  resume = Promise.withResolvers();
  constructor(api, database, scope, walletId) {
    this.api = api;
    this.traced = new api.TracedD1Database(database);
    this.database = database;
    this.scope = scope;
    this.walletId = walletId;
  }
  prepare(sql) {
    return this.traced.prepare(sql);
  }
  exec(sql) {
    return this.traced.exec(sql);
  }
  async batch(statements) {
    if (this.mode !== 'none' && statements.some(writesJournal)) {
      const mode = this.mode;
      this.mode = 'none';
      if (mode === 'pause') {
        this.paused.resolve();
        await this.resume.promise;
      }

      const result = await this.traced.batch(statements);
      if (mode === 'lost_reply') throw new Error('Injected lost D1 publication acknowledgement');
      return result;
    }
    return this.traced.batch(statements);
  }
}

function databaseRuntime(directory) {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ML-DSA Gateway D1"); } };',
    d1Databases: ['GATEWAY'],
    d1Persist: join(directory, 'gateway-d1'),
    compatibilityDate: '2026-06-12',
  });
}

export async function verifyMlDsaGatewayRegistration({
  root,
  directory,
  wallet,
  proxy,
  privatePost,
  loseParticipantMaterial,
}) {
  const delivery = new CompletionLossProxy(proxy);
  const folder = join(directory, 'gateway');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const bundlePath = join(folder, 'gateway-api.mjs');
  await build({
    entryPoints: [join(root, 'tests/helpers/mlDsaGatewayRegistration.fixtures.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundlePath,
    tsconfig: join(root, 'packages/wallet/tsconfig.json'),
    loader: { '.wasm': 'file' },
  });
  const api = await import(pathToFileURL(bundlePath).href);
  await api.initializeSigningCodec(
    await readFile(join(root, 'wasm/near_signer/pkg-ml-dsa/ml_dsa_signer_bg.wasm')),
  );
  const scope = {
    namespace: 'ml-dsa-gateway',
    orgId: wallet.org,
    projectId: wallet.project,
    envId: wallet.environment,
  };
  const walletId = `gateway-${wallet.wallet}`;
  const key = credentialKey();
  const owner = await api.gatewayOwner({
    walletId,
    label: 'ml-dsa-gateway-owner',
    credentialIdB64u: key.credentialId,
    credentialPublicKeyB64u: key.publicKey,
  });
  const backupKey = credentialKey();
  const backup = await api.gatewayOwner({
    walletId,
    label: 'ml-dsa-gateway-backup',
    credentialIdB64u: backupKey.credentialId,
    credentialPublicKeyB64u: backupKey.publicKey,
  });
  let runtime = databaseRuntime(folder);
  let client;
  const checks = {};
  try {
    let database = await runtime.getD1Database('GATEWAY');
    await migrate(database, root, api, scope);
    checks.migrationPreservesClassicalEvidence = true;
    await api.seedOwner(database, scope, owner);
    await api.seedOwner(database, scope, backup);
    await database
      .prepare(
        `INSERT INTO wallet_execution_generations (namespace,org_id,project_id,env_id,wallet_id,generation,origin,origin_id,state,registration_completion) VALUES (?,?,?,?,?,1,'registration','gateway-fixture','active','established')`,
      )
      .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId)
      .run();
    const sourcePath = join(folder, 'source.json');
    await writeFile(
      sourcePath,
      JSON.stringify({
        wallet_id: walletId,
        wallet_auth_method_id: owner.authMethod.walletAuthMethodId,
        rp_id: 'wallet.example.test',
        credential_id_b64u: key.credentialId,
      }),
      { mode: 0o600 },
    );
    const child = spawn(
      join(root, 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation'),
      ['gateway-registration-client', sourcePath],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    );
    client = {
      process: child,
      lines: createInterface({ input: child.stdout })[Symbol.asyncIterator](),
    };
    const ready = await next(client);
    assert.equal(ready.ready, true);
    await api.seedCustody(database, scope, owner, ready);
    const custodyBefore = await custodySnapshot(database, scope, walletId);
    assert.equal(
      JSON.parse(custodyBefore).length,
      2,
      'Fixture must contain one seed envelope and one recovery set',
    );

    let traced = new PublicationDatabase(api, database, scope, walletId);
    let gateway = new Gateway(api, traced, scope, delivery);
    const { issued, body } = await issueAdmission(gateway, scope, walletId, key, 1, {
      kind: 'create',
    });
    const invalid = structuredClone(body);
    invalid.auth.credential.response.signature = randomBytes(70).toString('base64url');
    assert.equal((await gateway.post(walletId, 'start', invalid)).status, 401);
    checks.invalidAssertionRejected = true;
    assert.equal((await gateway.post('other-wallet', 'start', body)).status, 400);
    checks.wrongWalletRejected = true;
    const wrongOrigin = structuredClone(body);
    wrongOrigin.auth.credential = assertion(key, issued.addSignerIntentDigestB64u, otherOrigin);
    assert.equal((await gateway.post(walletId, 'start', wrongOrigin, otherOrigin)).body.ok, false);
    checks.approvalOriginBound = true;
    assert.equal(await phase(database, scope, walletId), null);
    const startedResponse = await gateway.post(walletId, 'start', body);
    assert.equal(startedResponse.status, 200, JSON.stringify(startedResponse.body));
    const started = api.parseWalletAddSignerStartResponse({
      value: startedResponse.body,
      expectedIntent: issued.intent,
    });
    assert.equal(started.kind, 'near_ml_dsa_65');
    assert.deepEqual((await gateway.post(walletId, 'start', body)).body, startedResponse.body);
    checks.exactAdmissionReplay = true;
    const altered = structuredClone(body);
    altered.intent.signerSelection.mlDsa.signerSlot = 2;
    altered.addSignerIntentDigestB64u = await api.computeAddSignerIntentDigestB64u(altered.intent);
    altered.auth.expectedChallengeDigestB64u = altered.addSignerIntentDigestB64u;
    altered.auth.credential = assertion(key, altered.addSignerIntentDigestB64u);
    assert.equal((await gateway.post(walletId, 'start', altered)).body.ok, false);
    checks.grantCannotSelectAnotherSlot = true;
    const context = started.mlDsa.protocolInputs;
    const relocation = new api.D1WalletRelocationWriteBlock(database, scope);
    const move = relocationSource(api, walletId);
    assert.equal(await relocation.check(move, Date.now()), 'draining');

    const registry = new api.D1WalletMlDsaRegistration({ database, scope, proxy });
    assert.equal(await registry.readPublished(walletId, context.signingKeyId), null);
    const premature = {
      custodyAction: 'joined',
      key: {
        walletId,
        signingKeyId: context.signingKeyId,
        keySet: 'near_ml_dsa_65_v1',
        publicKeyB64u: Buffer.alloc(1952).toString('base64url'),
        keyManifestDigestB64u: randomBytes(32).toString('base64url'),
        operationIdB64u: context.operationIdB64u,
        materialEpoch: context.materialEpoch,
      },
    };
    assert.equal(
      (
        await gateway.post(walletId, 'ml-dsa/publish', {
          addSignerCeremonyId: started.addSignerCeremonyId,
          custodyCommit: premature,
        })
      ).body.code,
      'not_ready',
    );
    checks.noPublicationBeforeInstallation = true;
    checks.canonicalEnvironmentDiffersFromIntentEnvironmentKey =
      started.intent.runtimePolicyScope.envId !== scope.envId;
    assert.equal(checks.canonicalEnvironmentDiffersFromIntentEnvironmentKey, true);
    client.process.stdin.write(
      JSON.stringify({
        signing_key_id: context.signingKeyId,
        operation: Array.from(Buffer.from(context.operationIdB64u, 'base64url')),
        epoch: context.materialEpoch,
        continuity: { kind: 'create' },
        holder_public_keys: [
          Array.from(Buffer.from(context.roleAPublicKeyB64u, 'base64url')),
          Array.from(Buffer.from(context.roleBPublicKeyB64u, 'base64url')),
        ],
      }) + '\n',
    );
    const encrypted = await next(client);
    const execution = {
      addSignerCeremonyId: started.addSignerCeremonyId,
      encryptedInputs: encrypted.inputs,
    };
    const empty = await gateway.post(walletId, 'ml-dsa/execute', execution);
    assert.equal(empty.body.code, 'pool_unavailable', JSON.stringify(empty.body));
    assert.ok(empty.body.retryAtMs > 0);
    checks.emptyPoolReturnsRetryTime = true;
    const changed = structuredClone(execution);
    changed.encryptedInputs.a.ciphertext[0] ^= 1;
    assert.equal(
      (await gateway.post(walletId, 'ml-dsa/execute', changed)).body.code,
      'idempotency_conflict',
    );
    checks.encryptedInputsPinnedBeforeDispatch = true;
    const walletScope = {
      org: scope.orgId,
      project: scope.projectId,
      environment: scope.envId,
      wallet: walletId,
    };
    const prepared = await privatePost('/router-ab/ml-dsa/registration/prepare', {
      wallet: walletScope,
    });
    assert.equal(prepared.ready, true);
    const installed = await gateway.post(walletId, 'ml-dsa/execute', execution);
    assert.equal(installed.status, 200, JSON.stringify(installed.body));
    assert.deepEqual(
      (await gateway.post(walletId, 'ml-dsa/execute', execution)).body,
      installed.body,
    );
    checks.installedExecutionReplays = true;
    client.process.stdin.write(installed.body.protocolResultJson + '\n');
    const finished = await next(client);
    assert.equal(finished.canonicalKeyVerified, true);
    assert.equal(finished.holderResultsAuthenticated, true);
    assert.equal(finished.commit.custodyAction, 'joined');
    const publication = {
      addSignerCeremonyId: started.addSignerCeremonyId,
      custodyCommit: finished.commit,
    };
    const bad = structuredClone(publication);
    bad.custodyCommit.key.keyManifestDigestB64u = randomBytes(32).toString('base64url');
    assert.equal(
      (await gateway.post(walletId, 'ml-dsa/publish', bad)).body.code,
      'custody_mismatch',
    );
    const beforePublish = await phase(database, scope, walletId);
    assert.equal(await registry.readPublished(walletId, context.signingKeyId), null);
    await assert.rejects(
      new api.D1WalletRelocationWriteBlock(database, scope).check(
        relocationSource(api, walletId),
        Date.now(),
      ),
      /ML-DSA participant relocation is not supported/,
    );
    assert.deepEqual(await phase(database, scope, walletId), beforePublish);
    checks.relocationCannotOmitInstalledMlDsa = true;
    await expireRegistration(database, scope, walletId, 1);
    traced.mode = 'lost_reply';
    const recoveredPublication = await gateway.post(walletId, 'ml-dsa/publish', publication);
    assert.equal(recoveredPublication.status, 200, JSON.stringify(recoveredPublication.body));
    assert.deepEqual(recoveredPublication.body.key, finished.commit.key);
    assert.equal(traced.mode, 'none', 'The lost acknowledgement must be injected');
    const committed = await phase(database, scope, walletId);
    assert.equal(JSON.parse(committed.record_json).phase.kind, 'published');
    await runtime.dispose();
    runtime = databaseRuntime(folder);
    database = await runtime.getD1Database('GATEWAY');
    traced = new PublicationDatabase(api, database, scope, walletId);
    gateway = new Gateway(api, traced, scope, delivery);
    const replay = await gateway.post(walletId, 'ml-dsa/publish', publication);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.deepEqual(replay.body.key, finished.commit.key);
    assert.deepEqual(await phase(database, scope, walletId), committed);
    checks.publicationSurvivesLostAcknowledgementAndRestart = true;
    checks.completedPublicationSurvivesExpiredRequest = true;
    checks.admittedOperationSettlesDuringDraining = true;
    await new api.D1WalletRelocationWriteBlock(database, scope).release(move, Date.now());
    const published = await new api.D1WalletMlDsaRegistration({
      database,
      scope,
      proxy,
    }).readPublished(walletId, context.signingKeyId);
    assert.equal(published.key.registeredPublicKeyB64u, finished.commit.key.publicKeyB64u);
    assert.equal(await custodySnapshot(database, scope, walletId), custodyBefore);
    checks.existingEnvelopeAndRecoverySetUnchanged = true;
    const publicSigning = await verifyMlDsaPublicSigning({
      api,
      gateway,
      key,
      walletId,
      signingKeyId: context.signingKeyId,
      publicKeyB64u: published.key.registeredPublicKeyB64u,
      unsignedTransactionBorshB64u: finished.unsignedTransactionBorshB64u,
      database,
      claimDatabase: traced,
      scope,
    });
    key.counter = publicSigning.lastCounter;
    const signature = publicSigning.signature;
    checks.publishedKeySignsStandardSignature = true;
    await runtime.dispose();
    runtime = databaseRuntime(folder);
    database = await runtime.getD1Database('GATEWAY');
    traced = new PublicationDatabase(api, database, scope, walletId);
    gateway = new Gateway(api, traced, scope, delivery);
    await replayPublicMlDsaSigning(api, gateway, publicSigning.replay, 'signed');
    publicSigning.evidence.checks.completedSigningSurvivesD1Restart = true;
    const lifecycle = await verifyMlDsaRetainedSignerLifecycle({
      api,
      gateway,
      database,
      scope,
      owner,
      walletId,
      credentialKey,
      signingKeyId: context.signingKeyId,
      publicKeyB64u: published.key.registeredPublicKeyB64u,
      unsignedTransactionBorshB64u: finished.unsignedTransactionBorshB64u,
    });
    assert.equal(await custodySnapshot(database, scope, walletId), custodyBefore);
    assert.deepEqual(await phase(database, scope, walletId), committed);
    checks.recoveryAndDeviceSigningPreserveCustodyAndPublication = true;
    const unused = await issueAdmission(gateway, scope, walletId, key, 2, { kind: 'create' });
    const unusedStart = await gateway.post(walletId, 'start', unused.body);
    assert.equal(unusedStart.body.ok, true, JSON.stringify(unusedStart.body));
    const unusedRecord = await phase(database, scope, walletId, 2);
    traced.mode = 'pause';
    const staleExecute = gateway.post(walletId, 'ml-dsa/execute', {
      addSignerCeremonyId: unusedStart.body.addSignerCeremonyId,
      encryptedInputs: execution.encryptedInputs,
    });
    await traced.paused.promise;
    // Simulate the expiry cutoff through the production cleanup, while a previously
    // prepared transaction is delayed before D1 executes it.
    await api.expireUnusedMlDsaAdmissions(
      database,
      scope,
      walletId,
      JSON.parse(unusedRecord.record_json).expiresAtMs + 1,
    );
    const expired = await phase(database, scope, walletId, 2);
    assert.equal(JSON.parse(expired.record_json).phase.kind, 'expired_admission');
    assert.ok(expired.version > unusedRecord.version);
    const replacement = await issueAdmission(gateway, scope, walletId, key, 2, { kind: 'create' });
    const replaced = await gateway.post(walletId, 'start', replacement.body);
    assert.equal(replaced.body.ok, true, JSON.stringify(replaced.body));
    const replacementRecord = await phase(database, scope, walletId, 2);
    traced.resume.resolve();
    assert.equal((await staleExecute).body.code, 'conflict');
    assert.deepEqual(await phase(database, scope, walletId, 2), replacementRecord);
    checks.expiredAdmissionReleasesSlotWithoutVersionReuse = true;
    checks.delayedExecuteCannotOverwriteReplacement = true;
    const restoration = await verifyPublicRestoration({
      root,
      sourcePath,
      api,
      gateway,
      scope,
      walletId,
      key,
      walletScope,
      published: finished.commit.key,
      originalExecution: execution,
      privatePost,
      loseParticipantMaterial,
      originalSigning: publicSigning.replay,
      database,
    });
    const restoredRecord = await phase(database, scope, walletId);
    assert.equal(await custodySnapshot(database, scope, walletId), custodyBefore);
    checks.restorationPreservesCustody = true;
    const interruptedCreation = await verifyInterruptedCreation({
      api,
      root,
      sourcePath,
      gateway,
      database,
      scope,
      walletId,
      key,
      walletScope,
      privatePost,
      delivery,
    });
    assert.equal(await custodySnapshot(database, scope, walletId), custodyBefore);
    checks.interruptedCreationRestartsWithFreshMaterial = true;
    const revoked = await new api.D1WalletAuthorityStore({
      database,
      scope,
    }).revokeWalletAuthMethod({
      walletId,
      authorityId: owner.authority.authorityId,
      walletAuthMethodId: owner.authMethod.walletAuthMethodId,
      expectedAuthorityRevocationEpoch: owner.authority.revocationEpoch,
      requestedAtMs: Date.now(),
    });
    assert.equal(revoked.kind, 'revoked_method');
    assert.equal(
      (await gateway.post(walletId, 'ml-dsa/publish', restoration.publicationRequest)).body.code,
      'unauthorized',
    );
    assert.equal((await gateway.post(walletId, 'start', body)).body.ok, false);
    checks.revokedOwnerCannotResume = true;
    await replayPublicMlDsaSigning(api, gateway, publicSigning.replay, 'refused');
    publicSigning.evidence.checks.revokedOwnerCannotReadCachedSignature = true;
    assert.deepEqual(await phase(database, scope, walletId), restoredRecord);
    const sources = {};
    for (const path of [
      'packages/shared-ts/src/passkey-custody/mlDsaCustody.ts',
      'packages/shared-ts/src/utils/registrationSignerPlan.ts',
      'packages/shared-ts/src/utils/registrationIntent.ts',
      'packages/wallet-server/src/router/domains/walletRegistration/mlDsaAddSigner.ts',
      'packages/wallet-server/src/router/transport/fetch/routes/mlDsaRegistration.ts',
      'packages/wallet/src/SeamsWeb/operations/registration/restoreMlDsaNearSigner.ts',
      'packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletMlDsaRegistration.ts',
      'packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletMlDsaSigning.ts',
      'packages/wallet-server/src/router/cloudflare/d1/wallet/mlDsaSigningRecord.ts',
      'packages/wallet-server/src/router/cloudflare/d1/wallet/d1MlDsaWebAuthnVerification.ts',
      'packages/wallet-server/src/router/transport/fetch/routes/mlDsaPublicSigning.ts',
      'packages/wallet-server/migrations/d1-signer/0083_ml_dsa_operation_evidence.sql',
      'packages/wallet/src/core/rpcClients/relayer/mlDsaSigning.ts',
      'packages/shared-ts/src/near/mlDsaSigning.ts',
      'wasm/near_signer/src/ml_dsa_transaction.rs',
      'tests/helpers/mlDsaPublicSigning.e2e.mjs',
      'tests/helpers/mlDsaLifecycle.e2e.mjs',
      'packages/shared-ts/src/near/mlDsaInventory.ts',
      'packages/wallet/src/core/rpcClients/relayer/mlDsaInventory.ts',
      'packages/wallet/src/core/signingEngine/walletCustody/mlDsaEnrollment.ts',
      'packages/wallet/src/SeamsWeb/operations/registration/mlDsaNearSigner.ts',
      'packages/wallet-server/src/router/cloudflare/d1/wallet/d1MlDsaRegistrationExpiry.ts',
      'packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAddSignerService.ts',
      'packages/wallet-server/migrations/d1-signer/0082_ml_dsa_relocation_boundary.sql',
      'packages/wallet/src/core/signingEngine/walletCustody/mlDsaAddSigner.ts',
      'tests/helpers/mlDsaGatewayRegistration.e2e.mjs',
      'tools/ml-dsa-investigation/src/gateway_registration_client.rs',
    ])
      sources[path] = hash(await readFile(join(root, path))).toString('hex');
    return {
      sources,
      gatewayBundleSha256: hash(await readFile(bundlePath)).toString('hex'),
      signingWasmSha256: hash(
        await readFile(join(root, 'wasm/near_signer/pkg-ml-dsa/ml_dsa_signer_bg.wasm')),
      ).toString('hex'),
      nativeBinarySha256: hash(
        await readFile(
          join(root, 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation'),
        ),
      ).toString('hex'),
      checks,
      canonicalKeyVerified: true,
      signature,
      publicSigning: publicSigning.evidence,
      lifecycle,
      restoration,
      interruptedCreation,
      publication: replay.body,
      scope:
        'Real Gateway routes, fresh P-256 WebAuthn verification, local D1, and prepared Worker key generation. Existing wallet ownership is seeded with shared factories. No ML-DSA-only wallet creation or public transaction-signing route is tested.',
    };
  } finally {
    client?.process.kill();
    await runtime.dispose();
    await rm(folder, { recursive: true, force: true });
  }
}

async function verifyPublicRestoration(input) {
  const { gateway, scope, walletId, key, published } = input;
  const purpose = {
    kind: 'restore',
    publicKeyB64u: published.publicKeyB64u,
    keyManifestDigestB64u: published.keyManifestDigestB64u,
    materialEpoch: published.materialEpoch,
  };
  const wrong = { ...purpose, keyManifestDigestB64u: randomBytes(32).toString('base64url') };
  const badIntent = await issueAdmission(gateway, scope, walletId, key, 1, wrong);
  const bad = await gateway.post(walletId, 'start', badIntent.body);
  assert.equal(bad.body.code, 'signer_conflict');
  const loss = await input.loseParticipantMaterial(input.walletScope);
  const intent = await issueAdmission(gateway, scope, walletId, key, 1, purpose);
  const firstAttempt = await gateway.post(walletId, 'start', intent.body);
  assert.equal(firstAttempt.body.ok, true, JSON.stringify(firstAttempt.body));
  assert.equal(firstAttempt.body.mlDsa.protocolInputs.materialEpoch, published.materialEpoch + 1);
  await verifyRestoringInventory(input, purpose);
  const started = await replaceExpiredRestoration(input, purpose, firstAttempt.body);
  const protocol = started.body.mlDsa.protocolInputs;
  assert.equal(protocol.continuity.kind, 'recover');
  assert.equal(protocol.materialEpoch, published.materialEpoch + 2);
  const staleExecution = await gateway.post(walletId, 'ml-dsa/execute', input.originalExecution);
  assert.equal(staleExecution.body.ok, false);
  await replayPublicMlDsaSigning(input.api, gateway, input.originalSigning, 'refused');
  const child = spawn(
    join(input.root, 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation'),
    ['gateway-registration-client', input.sourcePath],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const client = {
    process: child,
    lines: createInterface({ input: child.stdout })[Symbol.asyncIterator](),
  };
  try {
    await next(client);
    child.stdin.write(
      JSON.stringify({
        signing_key_id: protocol.signingKeyId,
        operation: Array.from(Buffer.from(protocol.operationIdB64u, 'base64url')),
        epoch: protocol.materialEpoch,
        continuity: {
          kind: 'recover',
          recorded_manifest_digest: Array.from(
            Buffer.from(published.keyManifestDigestB64u, 'base64url'),
          ),
        },
        holder_public_keys: [
          Array.from(Buffer.from(protocol.roleAPublicKeyB64u, 'base64url')),
          Array.from(Buffer.from(protocol.roleBPublicKeyB64u, 'base64url')),
        ],
      }) + '\n',
    );
    const encrypted = await next(client);
    const prepared = await input.privatePost('/router-ab/ml-dsa/registration/prepare', {
      wallet: input.walletScope,
    });
    assert.equal(prepared.ready, true);
    const execution = {
      addSignerCeremonyId: started.body.addSignerCeremonyId,
      encryptedInputs: encrypted.inputs,
    };
    const installed = await gateway.post(walletId, 'ml-dsa/execute', execution);
    assert.equal(installed.body.ok, true, JSON.stringify(installed.body));
    child.stdin.write(installed.body.protocolResultJson + '\n');
    const finish = await next(client);
    assert.equal(finish.canonicalKeyVerified, true);
    assert.equal(finish.commit.key.publicKeyB64u, published.publicKeyB64u);
    assert.equal(finish.commit.key.keyManifestDigestB64u, published.keyManifestDigestB64u);
    const publication = {
      addSignerCeremonyId: started.body.addSignerCeremonyId,
      custodyCommit: finish.commit,
    };
    const result = await gateway.post(walletId, 'ml-dsa/publish', publication);
    assert.equal(result.body.ok, true, JSON.stringify(result.body));
    assert.deepEqual(
      (await gateway.post(walletId, 'ml-dsa/publish', publication)).body,
      result.body,
    );
    await replayPublicMlDsaSigning(input.api, gateway, input.originalSigning, 'refused');
    const signature = await verifyRestoredSigning(
      input,
      finish.commit.key,
      finish.unsignedTransactionBorshB64u,
    );
    return {
      lostParticipant: 'a',
      deletedEncryptedMaterialRecords: loss.deleted,
      materialEpoch: finish.commit.key.materialEpoch,
      checks: {
        wrongManifestRefused: true,
        staleExecutionRefused: true,
        staleSigningRefused: true,
        ordinaryFipsKeyReproduced: true,
        samePublicKey: true,
        sameManifest: true,
        publicationReplays: true,
        pendingInventoryPreservesRecordedKey: true,
        interruptedRestorationAdvancesEpoch: true,
        expiredRestorationCannotBecomeCreation: true,
      },
      publication: result.body,
      publicationRequest: publication,
      signature,
    };
  } finally {
    child.kill();
  }
}

async function verifyRestoredSigning(input, restored, unsignedTransactionBorshB64u) {
  const previous = globalThis.fetch;
  const transport = new GatewayTransport(input.gateway);
  globalThis.fetch = transport.fetch.bind(transport);
  try {
    const prepared = await input.api.prepareMlDsaNearSigning({
      access: { kind: 'public' },
      relayerUrl: 'https://gateway.example.test',
      publicKeyB64u: restored.publicKeyB64u,
      request: {
        walletId: input.walletId,
        signingKeyId: restored.signingKeyId,
        operationIdB64u: randomBytes(32).toString('base64url'),
        unsignedTransactionBorshB64u,
        actor: {
          kind: 'passkey',
          rpId: 'wallet.example.test',
          credentialIdB64u: input.key.credentialId,
        },
      },
    });
    assert.equal(prepared.kind, 'prepared', JSON.stringify(prepared));
    const request = {
      relayerUrl: 'https://gateway.example.test',
      preparation: prepared.preparation,
      authorization: {
        kind: 'passkey',
        credential: assertion(input.key, prepared.preparation.challengeB64u),
      },
    };
    let signed = await input.api.executeMlDsaNearSigning(request);
    let attempts = 1;
    while (signed.kind === 'retry') {
      assert.ok(attempts++ < 30 && signed.retryAtMs < prepared.preparation.expiresAtMs);
      await new Promise(waitUntil.bind(undefined, signed.retryAtMs));
      signed = await input.api.executeMlDsaNearSigning(request);
    }
    assert.equal(signed.kind, 'signed', JSON.stringify(signed));
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
        Buffer.from(restored.publicKeyB64u, 'base64url'),
      ]),
      format: 'der',
      type: 'spki',
    });
    assert.equal(
      verify(
        null,
        hash(Buffer.from(unsignedTransactionBorshB64u, 'base64url')),
        key,
        Buffer.from(signed.transaction.signatureB64u, 'base64url'),
      ),
      true,
    );
    return signed.transaction;
  } finally {
    globalThis.fetch = previous;
  }
}
function waitUntil(atMs, resolve) {
  setTimeout(resolve, Math.max(100, atMs - Date.now()));
}

async function verifyRestoringInventory(input, expected) {
  const original = globalThis.fetch;
  const transport = new GatewayTransport(input.gateway);
  globalThis.fetch = transport.fetch.bind(transport);
  try {
    const prepared = await input.api.prepareMlDsaSignerInventory({
      relayerUrl: 'https://gateway.example.test',
      walletId: input.walletId,
      rpId: 'wallet.example.test',
      credentialIdB64u: input.key.credentialId,
      origin,
    });
    assert.equal(prepared.kind, 'prepared');
    const inventory = await input.api.fetchMlDsaSignerInventory({
      relayerUrl: 'https://gateway.example.test',
      preparation: prepared.preparation,
      credential: assertion(input.key, prepared.challengeB64u),
    });
    assert.equal(inventory.kind, 'inventory');
    const entry = inventory.entries.find(isRestoringEntry);
    assert.equal(entry.kind, 'restoring');
    assert.equal(entry.recordedKey.publicKeyB64u, expected.publicKeyB64u);
    assert.equal(entry.recordedKey.keyManifestDigestB64u, expected.keyManifestDigestB64u);
    assert.equal(entry.recordedKey.materialEpoch, expected.materialEpoch);
    assert.ok(entry.retryAtMs > Date.now());
  } finally {
    globalThis.fetch = original;
  }
}
function isRestoringEntry(entry) {
  return entry.kind === 'restoring';
}

async function expireRegistration(database, scope, walletId, slot) {
  const installed = await phase(database, scope, walletId, slot);
  const result = await database
    .prepare(
      `UPDATE router_ab_yao_versioned_json_records
    SET version=version+1, record_json=json_set(record_json,'$.expiresAtMs',?)
    WHERE namespace=? AND org_id=? AND project_id=? AND env_id=? AND record_key=? AND version=?`,
    )
    .bind(
      Date.now() - 1000,
      scope.namespace,
      scope.orgId,
      scope.projectId,
      scope.envId,
      `ml-dsa-registration:${JSON.stringify([walletId, JSON.parse(installed.record_json).preparation.protocolInputs.signingKeyId])}`,
      installed.version,
    )
    .run();
  assert.equal(result.meta.changes, 1);
}

async function replaceExpiredRestoration(input, purpose, interrupted) {
  await expireRegistration(input.database, input.scope, input.walletId, 1);
  await input.api.expireUnusedMlDsaAdmissions(
    input.database,
    input.scope,
    input.walletId,
    Date.now(),
  );
  const expired = await phase(input.database, input.scope, input.walletId);
  assert.equal(JSON.parse(expired.record_json).phase.kind, 'expired_admission');
  const creation = await issueAdmission(input.gateway, input.scope, input.walletId, input.key, 1, {
    kind: 'create',
  });
  assert.equal(
    (await input.gateway.post(input.walletId, 'start', creation.body)).body.code,
    'signer_conflict',
  );
  const next = await issueAdmission(
    input.gateway,
    input.scope,
    input.walletId,
    input.key,
    1,
    purpose,
  );
  const started = await input.gateway.post(input.walletId, 'start', next.body);
  assert.equal(started.body.ok, true, JSON.stringify(started.body));
  assert.notEqual(started.body.addSignerCeremonyId, interrupted.addSignerCeremonyId);
  return started;
}

async function creationClient(input) {
  const process = spawn(
    join(input.root, 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation'),
    ['gateway-registration-client', input.sourcePath],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const client = {
    process,
    lines: createInterface({ input: process.stdout })[Symbol.asyncIterator](),
  };
  return { client, ready: await next(client) };
}

async function creationInputs(client, protocol) {
  client.process.stdin.write(
    JSON.stringify({
      signing_key_id: protocol.signingKeyId,
      operation: Array.from(Buffer.from(protocol.operationIdB64u, 'base64url')),
      epoch: protocol.materialEpoch,
      continuity: { kind: 'create' },
      holder_public_keys: [
        Array.from(Buffer.from(protocol.roleAPublicKeyB64u, 'base64url')),
        Array.from(Buffer.from(protocol.roleBPublicKeyB64u, 'base64url')),
      ],
    }) + '\n',
  );
  return next(client);
}

async function verifyInterruptedCreation(input) {
  const { gateway, scope, database, api } = input;
  const walletId = `${input.walletId}-interrupted`;
  const walletScope = { ...input.walletScope, wallet: walletId };
  const key = credentialKey();
  const owner = await api.gatewayOwner({
    walletId,
    label: 'interrupted-creation-owner',
    credentialIdB64u: key.credentialId,
    credentialPublicKeyB64u: key.publicKey,
  });
  await api.seedOwner(database, scope, owner);
  await database
    .prepare(
      `INSERT INTO wallet_execution_generations
     (namespace,org_id,project_id,env_id,wallet_id,generation,origin,origin_id,state,registration_completion)
     VALUES (?,?,?,?,?,1,'registration','interrupted-fixture','active','established')`,
    )
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId)
    .run();
  const sourcePath = join(dirname(input.sourcePath), 'interrupted-source.json');
  await writeFile(
    sourcePath,
    JSON.stringify({
      wallet_id: walletId,
      wallet_auth_method_id: owner.authMethod.walletAuthMethodId,
      rp_id: 'wallet.example.test',
      credential_id_b64u: key.credentialId,
    }),
    { mode: 0o600 },
  );
  const original = await creationClient({ root: input.root, sourcePath });
  let replacement = null;
  try {
    await api.seedCustody(database, scope, owner, original.ready);
    const custodyBefore = await custodySnapshot(database, scope, walletId);
    const intent = await issueAdmission(gateway, scope, walletId, key, 1, { kind: 'create' });
    const first = await gateway.post(walletId, 'start', intent.body);
    assert.equal(first.body.ok, true, JSON.stringify(first.body));
    const originalInputs = await creationInputs(original.client, first.body.mlDsa.protocolInputs);
    const initialStock = await input.privatePost('/router-ab/ml-dsa/registration/prepare', {
      wallet: walletScope,
    });
    assert.equal(initialStock.ready, true);
    const oldExecution = {
      addSignerCeremonyId: first.body.addSignerCeremonyId,
      encryptedInputs: originalInputs.inputs,
    };
    input.delivery.loseKeyId = first.body.mlDsa.protocolInputs.signingKeyId;
    const lost = await gateway.post(walletId, 'ml-dsa/execute', oldExecution);
    assert.equal(lost.body.code, 'ml_dsa_refused', JSON.stringify(lost.body));
    const completion = input.delivery.completion;
    assert.ok(completion);
    assert.equal(
      JSON.parse((await phase(database, scope, walletId, 1)).record_json).phase.kind,
      'executing',
    );
    // Discard the live client. No verified public custody completion survives.
    original.client.process.kill();
    const blockedIntent = await issueAdmission(gateway, scope, walletId, key, 1, {
      kind: 'create',
    });
    assert.equal(
      (await gateway.post(walletId, 'start', blockedIntent.body)).body.code,
      'signer_conflict',
    );
    await expireRegistration(database, scope, walletId, 1);
    assert.equal(
      (await gateway.post(walletId, 'ml-dsa/execute', oldExecution)).body.code,
      'expired',
    );
    const freshIntent = await issueAdmission(gateway, scope, walletId, key, 1, { kind: 'create' });
    const fresh = await gateway.post(walletId, 'start', freshIntent.body);
    assert.equal(fresh.body.ok, true, JSON.stringify(fresh.body));
    const protocol = fresh.body.mlDsa.protocolInputs;
    assert.equal(protocol.materialEpoch, first.body.mlDsa.protocolInputs.materialEpoch + 1);
    assert.notEqual(protocol.operationIdB64u, first.body.mlDsa.protocolInputs.operationIdB64u);
    replacement = await creationClient({ root: input.root, sourcePath });
    const replacementInputs = await creationInputs(replacement.client, protocol);
    assert.notDeepEqual(replacementInputs.inputs, originalInputs.inputs);
    const stock = await input.privatePost('/router-ab/ml-dsa/registration/prepare', {
      wallet: walletScope,
    });
    assert.equal(stock.ready, true);
    assert.notDeepEqual(stock.job.id, initialStock.job.id);
    const installed = await gateway.post(walletId, 'ml-dsa/execute', {
      addSignerCeremonyId: fresh.body.addSignerCeremonyId,
      encryptedInputs: replacementInputs.inputs,
    });
    assert.equal(installed.body.ok, true, JSON.stringify(installed.body));
    replacement.client.process.stdin.write(installed.body.protocolResultJson + '\n');
    const finished = await next(replacement.client);
    assert.equal(finished.canonicalKeyVerified, true);
    assert.equal(
      finished.commit.key.publicKeyB64u,
      Buffer.from(completion.a.public_key).toString('base64url'),
    );
    assert.equal(
      finished.commit.key.keyManifestDigestB64u,
      Buffer.from(completion.a.activation.manifest_digest).toString('base64url'),
    );
    assert.equal((await gateway.post(walletId, 'ml-dsa/execute', oldExecution)).body.ok, false);
    const publication = await gateway.post(walletId, 'ml-dsa/publish', {
      addSignerCeremonyId: fresh.body.addSignerCeremonyId,
      custodyCommit: finished.commit,
    });
    assert.equal(publication.body.ok, true, JSON.stringify(publication.body));
    const overwriteIntent = await issueAdmission(gateway, scope, walletId, key, 1, {
      kind: 'create',
    });
    assert.equal(
      (await gateway.post(walletId, 'start', overwriteIntent.body)).body.code,
      'signer_conflict',
    );
    assert.equal(await custodySnapshot(database, scope, walletId), custodyBefore);
    return {
      materialEpoch: protocol.materialEpoch,
      checks: {
        lostCompletionLeavesExecutingJournal: true,
        unexpiredCreationCannotBeReplaced: true,
        oldExecutionExpires: true,
        freshApprovalAndEpochRequired: true,
        newInputsAndPreparation: true,
        canonicalKeyAndManifestPreserved: true,
        delayedExecutionCannotOverwriteReplacement: true,
        publishedCreationCannotBeReplaced: true,
      },
    };
  } finally {
    original.client.process.kill();
    replacement?.client.process.kill();
  }
}
