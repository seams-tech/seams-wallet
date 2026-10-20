import assert from 'node:assert/strict';
import { verifyMlDsaPublicSigning, replayPublicMlDsaSigning } from './mlDsaPublicSigning.e2e.mjs';
import { createHash, generateKeyPairSync, randomBytes, sign as signBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
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
function credentialKey() {
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
function assertion(key, challenge, expectedOrigin = origin) {
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

async function issueAdmission(gateway, scope, walletId, key, slot) {
  const issued = await gateway.service.walletAuthMethods.createAddSignerIntent({
    command: {
      subject: { kind: 'wallet_signer_management', walletId },
      signerSelection: { mode: 'ml_dsa_65', mlDsa: { signerSlot: slot } },
    },
    orgId: scope.orgId,
    runtimePolicyScope: {
      orgId: scope.orgId,
      projectId: scope.projectId,
      envId: scope.envId,
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
      signerWasmModuleOrPath: api.signingWasmModule(),
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
}) {
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
    await readFile(join(root, 'wasm/near_signer/pkg/wasm_signer_worker_bg.wasm')),
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
    let gateway = new Gateway(api, traced, scope, proxy);
    const { issued, body } = await issueAdmission(gateway, scope, walletId, key, 1);
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
    client.process.stdin.write(
      JSON.stringify({
        signing_key_id: context.signingKeyId,
        operation: Array.from(Buffer.from(context.operationIdB64u, 'base64url')),
        epoch: context.materialEpoch,
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
    traced.mode = 'lost_reply';
    assert.equal(
      (await gateway.post(walletId, 'ml-dsa/publish', publication)).body.code,
      'conflict',
    );
    const committed = await phase(database, scope, walletId);
    assert.equal(JSON.parse(committed.record_json).phase.kind, 'published');
    await runtime.dispose();
    runtime = databaseRuntime(folder);
    database = await runtime.getD1Database('GATEWAY');
    traced = new PublicationDatabase(api, database, scope, walletId);
    gateway = new Gateway(api, traced, scope, proxy);
    const replay = await gateway.post(walletId, 'ml-dsa/publish', publication);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.deepEqual(replay.body.key, finished.commit.key);
    assert.deepEqual(await phase(database, scope, walletId), committed);
    checks.publicationSurvivesLostAcknowledgementAndRestart = true;
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
    gateway = new Gateway(api, traced, scope, proxy);
    await replayPublicMlDsaSigning(api, gateway, publicSigning.replay, 'signed');
    publicSigning.evidence.checks.completedSigningSurvivesD1Restart = true;
    const unused = await issueAdmission(gateway, scope, walletId, key, 2);
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
    const replacement = await issueAdmission(gateway, scope, walletId, key, 2);
    const replaced = await gateway.post(walletId, 'start', replacement.body);
    assert.equal(replaced.body.ok, true, JSON.stringify(replaced.body));
    const replacementRecord = await phase(database, scope, walletId, 2);
    traced.resume.resolve();
    assert.equal((await staleExecute).body.code, 'conflict');
    assert.deepEqual(await phase(database, scope, walletId, 2), replacementRecord);
    checks.expiredAdmissionReleasesSlotWithoutVersionReuse = true;
    checks.delayedExecuteCannotOverwriteReplacement = true;
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
      (await gateway.post(walletId, 'ml-dsa/publish', publication)).body.code,
      'unauthorized',
    );
    assert.equal((await gateway.post(walletId, 'start', body)).body.ok, false);
    checks.revokedOwnerCannotResume = true;
    await replayPublicMlDsaSigning(api, gateway, publicSigning.replay, 'refused');
    publicSigning.evidence.checks.revokedOwnerCannotReadCachedSignature = true;
    assert.deepEqual(await phase(database, scope, walletId), committed);
    const sources = {};
    for (const path of [
      'packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletMlDsaRegistration.ts',
      'packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletMlDsaSigning.ts',
      'packages/wallet-server/src/router/cloudflare/d1/wallet/d1MlDsaWebAuthnVerification.ts',
      'packages/wallet-server/src/router/transport/fetch/routes/mlDsaPublicSigning.ts',
      'packages/wallet-server/migrations/d1-signer/0083_ml_dsa_operation_evidence.sql',
      'packages/wallet/src/core/rpcClients/relayer/mlDsaSigning.ts',
      'packages/shared-ts/src/near/mlDsaSigning.ts',
      'wasm/near_signer/src/ml_dsa_transaction.rs',
      'tests/helpers/mlDsaPublicSigning.e2e.mjs',
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
      signingWasmSha256: hash(
        await readFile(join(root, 'wasm/near_signer/pkg/wasm_signer_worker_bg.wasm')),
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
