// Run from the repository root: node tests/e2e/step-up-expiry.e2e.mjs
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';

const output = '.artifacts/tla-signing/admission-e2e';
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
      export { handleThresholdEcdsa } from './packages/wallet-server/src/router/transport/fetch/routes/thresholdEcdsa';
      export { AuthorizationService } from './packages/wallet-server/src/authorization/service';
      export { CloudflareD1AuthorizationStore } from './packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
      export { createSyncSqliteDatabase } from './packages/wallet-server/src/storage/syncSqlite';
      export { nodeSqliteConnection } from './packages/wallet-server/src/router/node/nodeSqlite';
      export { applySignerSqlMigrationsV1 } from './packages/wallet-server/src/router/node/signerSqlMigrations';
      export { listenNodeFetchHandler } from './packages/wallet-server/src/router/node/nodeHttp';
      export { buildEcdsaSigningRequestFixture } from './tests/unit/helpers/ecdsaSigningRequest.fixtures';
      export { buildRouterAbEcdsaDerivationEvmDigestSigningRequestV1, ROUTER_AB_ECDSA_DERIVATION_OPERATION_STEP_UP_PATH } from './packages/shared-ts/src/utils/routerAbEcdsaDerivation';
      export { buildRouterAbEcdsaOwnerOperationStepUpPreparation } from './packages/wallet-server/src/router/domains/signingOperations/routerAbEcdsaDerivationNormalSigningRoute';
      export { buildPasskeyWalletAuthAuthority, buildEmailOtpWalletAuthAuthority } from './packages/shared-ts/src/utils/walletAuthAuthority';
      export { parseTenantId } from './packages/shared-ts/src/authorization/capabilityKinds';
    `,
  },
});
await writeFile(`${output}/fixture.mjs`, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(`${process.cwd()}/${output}/fixture.mjs`));

async function waitPast(deadline) {
  while (Date.now() <= deadline) await delay(Math.max(1, deadline - Date.now() + 10));
}

async function handleD1Request(request, env) {
  const input = await request.json();
  try {
    const statements = [];
    for (const statement of input.statements) {
      statements.push(env.DB.prepare(statement.sql).bind(...statement.values));
    }
    if (input.kind === 'batch') return Response.json(await env.DB.batch(statements));
    return Response.json(await statements[0].all());
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

class D1HttpDatabase {
  constructor(worker) {
    this.worker = worker;
  }

  async send(input) {
    const response = await this.worker.dispatchFetch('http://database/', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }

  prepare(sql) {
    return new D1HttpStatement(this, sql, []);
  }

  async batch(statements) {
    const values = [];
    for (const statement of statements)
      values.push({ sql: statement.sql, values: statement.values });
    return await this.send({ kind: 'batch', statements: values });
  }

  async exec(sql) {
    const statements = [];
    for (const query of unstable_splitSqlQuery(sql)) statements.push(this.prepare(query));
    return await this.batch(statements);
  }
}

class D1HttpStatement {
  constructor(database, sql, values) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1HttpStatement(this.database, this.sql, values);
  }

  async all() {
    return await this.database.send({
      kind: 'query',
      statements: [{ sql: this.sql, values: this.values }],
    });
  }

  async run() {
    return await this.all();
  }

  async first(column) {
    const result = await this.all();
    const row = result.results[0] ?? null;
    return column === undefined ? row : (row?.[column] ?? null);
  }
}

async function openDatabase(host) {
  if (host === 'vm_sqlite') {
    const sqlite = new DatabaseSync(':memory:');
    const connection = api.nodeSqliteConnection(sqlite);
    const migrations = api.applySignerSqlMigrationsV1(
      connection,
      'packages/wallet-server/migrations/d1-signer',
      Date.now(),
    );
    return {
      database: api.createSyncSqliteDatabase(connection),
      migrations: migrations.applied,
      close: sqlite.close.bind(sqlite),
    };
  }
  const worker = new Miniflare({
    modules: true,
    script: `export default { fetch: ${handleD1Request.toString()} };`,
    d1Databases: ['DB'],
    compatibilityDate: '2026-04-17',
    port: 0,
  });
  try {
    await worker.ready;
    const database = new D1HttpDatabase(worker);
    const folder = 'packages/wallet-server/migrations/d1-signer';
    const migrations = (await readdir(folder)).filter(isSqlMigration).sort();
    for (const name of migrations) {
      let sql = await readFile(`${folder}/${name}`, 'utf8');
      if (name === '0028_r103f_phase1_additive_schema_bridge.sql')
        sql = buildWorkerdCompatiblePhase1Bridge(sql);
      await database.exec(sql);
    }
    return { database, migrations, close: worker.dispose.bind(worker) };
  } catch (error) {
    await worker.dispose();
    throw error;
  }
}

function isSqlMigration(name) {
  return name.endsWith('.sql');
}

class DelayedAuthorizationStore extends api.CloudflareD1AuthorizationStore {
  constructor(database, scenario) {
    super({
      database,
      namespace: 'expiry-e2e',
      walletSignerScope: {
        namespace: 'expiry-e2e',
        orgId: 'tenant:expiry-e2e',
        projectId: 'expiry-e2e',
        envId: 'test',
      },
    });
    this.scenario = scenario;
  }

  async putVerifiedEvidenceSet(evidence) {
    await super.putVerifiedEvidenceSet(evidence);
    if (this.scenario.pause === 'evidence') await waitPast(evidence.expiresAtMs);
  }

  async admitAuthorizedOperation(input) {
    this.scenario.claimInput = input;
    if (this.scenario.pause === 'admission') await waitPast(this.scenario.deadline);
    const result = await super.admitAuthorizedOperation(input);
    this.scenario.admission = result;
    return result;
  }
}

class ExpiryRoute {
  constructor(service, scenario, material) {
    this.service = service;
    this.scenario = scenario;
    this.material = material;
    this.factorCalls = 0;
    this.grantConsumed = false;
  }

  async verifyAuthority() {
    return { ok: true };
  }

  async resolveMaterial() {
    return this.material;
  }

  async verifyFactor() {
    this.factorCalls += 1;
    this.scenario.verificationStartedAtMs = Date.now();
    if (this.scenario.pause === 'verification') await waitPast(this.scenario.deadline);
    this.scenario.verificationFinishedAtMs = Date.now();
    if (this.scenario.pause === 'failed-factor') {
      return { success: false, verified: false, code: 'not_verified' };
    }
    return { success: true, verified: true };
  }

  async verifyOtp() {
    await this.verifyFactor();
    if (this.scenario.pause === 'failed-factor') return { ok: false, code: 'not_verified' };
    if (this.scenario.pause === 'grant-expiry') {
      await waitPast(this.scenario.grantDeadline);
      this.scenario.verificationFinishedAtMs = Date.now();
    }
    return {
      ok: true,
      loginGrant: 'fixture-grant',
      challengeId: 'fixture-challenge',
      grantExpiresAtMs: this.scenario.grantDeadline,
    };
  }

  async consumeOtp() {
    assert.equal(this.grantConsumed, false);
    this.grantConsumed = true;
    return { ok: true, challengeId: 'fixture-challenge' };
  }

  async handle(request) {
    const url = new URL(request.url);
    // Factor verification and material discovery are trusted inputs in this boundary E2E.
    return await api.handleThresholdEcdsa({
      request,
      url,
      pathname: url.pathname,
      method: request.method,
      runtime: { kind: 'inline' },
      opts: {},
      logger: console,
      routeDefinitions: [],
      service: {
        authorizedOperations: this.service,
        walletRegistration: { resolveEcdsaMaterialActivation: this.resolveMaterial.bind(this) },
        walletAuthMethods: {
          verifyActivePasskeyAuthority: this.verifyAuthority.bind(this),
          verifyActiveEmailOtpAuthority: this.verifyAuthority.bind(this),
        },
        webAuthn: { verifyWebAuthnAuthenticationLite: this.verifyFactor.bind(this) },
        emailOtp: {
          verifyEmailOtpChallenge: this.verifyOtp.bind(this),
          consumeEmailOtpGrant: this.consumeOtp.bind(this),
        },
      },
    });
  }
}

function proofFor(method, walletId) {
  if (method === 'passkey') {
    const credentialIdB64u = Buffer.alloc(32, 7).toString('base64url');
    return {
      kind: 'passkey',
      authority: api.buildPasskeyWalletAuthAuthority({
        walletId,
        rpId: 'wallet.example.test',
        credentialIdB64u,
      }),
      webauthn_authentication: {
        id: credentialIdB64u,
        rawId: credentialIdB64u,
        type: 'public-key',
        authenticatorAttachment: null,
        clientExtensionResults: {},
        response: {
          clientDataJSON: 'e30',
          authenticatorData: 'AQ',
          signature: 'AQ',
          userHandle: null,
        },
      },
    };
  }
  return {
    kind: 'email_otp',
    authority: api.buildEmailOtpWalletAuthAuthority({
      walletId,
      provider: 'google',
      providerUserId: 'expiry-e2e-user',
      emailHashHex: 'a'.repeat(64),
    }),
    challenge_id: 'fixture-challenge',
    otp_code: '123456',
  };
}

async function scenario(host, method, pause) {
  const opened = await openDatabase(host);
  const database = opened.database;
  const base = await api.buildEcdsaSigningRequestFixture();
  const state = {
    method,
    pause,
    deadline: Date.now() + (pause === 'none' || pause === 'grant-expiry' ? 2_000 : 500),
    grantDeadline: Date.now() + (pause === 'none' ? 2_000 : 500),
  };
  const signing = api.buildRouterAbEcdsaDerivationEvmDigestSigningRequestV1({
    scope: base.scope,
    requestId: `request:${method}:${pause}`,
    operationId: `operation:${method}:${pause}`,
    operationDigests: base.operation_digests,
    authorization: { kind: 'operation_step_up' },
    materialActivation: base.material_activation,
    clientPresignatureId: base.client_presignature_id,
    expiresAtMs: state.deadline,
    signingDigest32: new Uint8Array(32).fill(1),
    clientRerandomizationCommitment32: new Uint8Array(32).fill(2),
  });
  const operation = api.buildRouterAbEcdsaOwnerOperationStepUpPreparation({
    request: signing,
    keyHandle: 'key:expiry-e2e',
    relayerKeyId: 'relayer:expiry-e2e',
    participantIds: [1, 2],
  });
  assert.ok(operation);
  const material = {
    ok: true,
    materialActivation: operation.material_activation,
    keyHandle: operation.key_handle,
    relayerKeyId: operation.relayer_key_id,
    participantIds: operation.participant_ids,
    runtimePolicyScope: {
      orgId: 'tenant:expiry-e2e',
      projectId: 'expiry-e2e',
      envId: 'test',
      signingRootVersion: 'v1',
    },
  };
  const record = {
    version: 'wallet_signer_ecdsa_v1',
    walletId: operation.wallet_id,
    signerId: 'ecdsa:expiry-e2e',
    chainTargetKey: 'expiry-e2e',
    walletKey: {
      keyHandle: material.keyHandle,
      publicCapability: { material_activation: material.materialActivation },
    },
  };
  await database
    .prepare(
      `INSERT INTO wallet_signers
    (namespace, org_id, project_id, env_id, wallet_id, signer_family, signer_id, chain_target_key, record_json, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, 'ecdsa', ?, ?, ?, 1, 1)`,
    )
    .bind(
      'expiry-e2e',
      'tenant:expiry-e2e',
      'expiry-e2e',
      'test',
      operation.wallet_id,
      record.signerId,
      record.chainTargetKey,
      JSON.stringify(record),
    )
    .run();
  await database
    .prepare(
      `INSERT INTO authorization_wallet_session_quotas
    (namespace, tenant_id, quota_id, wallet_session_id, principal_id, remaining_uses, lifecycle_kind, expires_at_ms)
    VALUES ('expiry-e2e', 'tenant:expiry-e2e', 'quota:expiry-e2e', 'session:expiry-e2e', 'principal:expiry-e2e', 0, 'exhausted', ?)`,
    )
    .bind(state.deadline)
    .run();
  const store = new DelayedAuthorizationStore(database, state);
  const service = new api.AuthorizationService({
    sessions: store,
    evidence: store,
    grants: store,
    authorizedOperations: store,
    audit: {},
  });
  const tenant = api.parseTenantId('tenant:expiry-e2e');
  assert.equal(tenant.ok, true);
  service.tenantId = tenant.value;
  const route = new ExpiryRoute(service, state, material);
  const server = await api.listenNodeFetchHandler({
    host: '127.0.0.1',
    port: 0,
    handle: route.handle.bind(route),
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${api.ROUTER_AB_ECDSA_DERIVATION_OPERATION_STEP_UP_PATH}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://wallet.example.test' },
        body: JSON.stringify({
          kind: 'router_ab_ecdsa_operation_step_up_v1',
          operation,
          proof: proofFor(method, operation.wallet_id),
        }),
      },
    );
    const body = await response.json();
    const claims = (
      await database
        .prepare(
          'SELECT authorized_operation_id, claimed_at_ms, lifecycle_kind FROM authorized_operations',
        )
        .all()
    ).results;
    const evidence = (
      await database
        .prepare(
          'SELECT verified_at_ms, expires_at_ms FROM verified_wallet_operation_evidence_sets',
        )
        .all()
    ).results;
    const audits = (
      await database
        .prepare('SELECT COUNT(*) AS count FROM authorized_operation_audit_events')
        .first()
    ).count;
    const quota = await database
      .prepare('SELECT * FROM authorization_wallet_session_quotas')
      .first();
    const result = {
      host,
      method,
      pause,
      deadline: state.deadline,
      status: response.status,
      code: body.code ?? body.kind,
      verificationStartedAtMs: state.verificationStartedAtMs,
      verificationFinishedAtMs: state.verificationFinishedAtMs,
      claims,
      evidence,
      audits,
      quota,
      grantConsumed: route.grantConsumed,
      migrations: opened.migrations,
    };
    assert.equal(route.factorCalls, 1, JSON.stringify(body));
    assert.equal(quota.remaining_uses, 0);
    assert.equal(quota.wallet_session_id, 'session:expiry-e2e');
    assert.equal(quota.lifecycle_kind, 'exhausted');
    assert.equal(quota.expires_at_ms, state.deadline);
    assert.equal(route.grantConsumed, method === 'email_otp' && pause !== 'failed-factor');
    if (pause === 'none') {
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(claims.length, 1);
      assert.equal(audits, 1);
      const retry = await store.admitAuthorizedOperation(state.claimInput);
      assert.equal(retry.kind, 'operation_in_progress');
      assert.equal(
        (await database.prepare('SELECT COUNT(*) AS count FROM authorized_operations').first())
          .count,
        1,
      );
      result.exactRetry = retry.kind;
      await waitPast(state.deadline);
      const expiredRetry = await store.admitAuthorizedOperation(state.claimInput);
      assert.equal(expiredRetry.kind, 'verified_step_up_rejected');
      result.pendingRetryAfterExpiry = expiredRetry.kind;
      const completed = await store.completeAuthorizedOperation({
        operation: retry.operation,
        result: 'succeeded',
        response: {
          status: 200,
          contentType: 'application/json',
          bodyText: '{"result":"symbolic-signature"}',
        },
        completedAtMs: Date.now(),
      });
      const replay = await store.admitAuthorizedOperation(state.claimInput);
      assert.equal(replay.kind, 'replayed');
      assert.deepEqual(replay.operation, completed);
      const preserved = await store.completeAuthorizedOperation({
        operation: completed,
        result: 'failed_after_side_effect',
        response: { status: 500, contentType: 'text/plain', bodyText: 'replacement' },
        completedAtMs: Date.now(),
      });
      assert.deepEqual(preserved, completed);
      result.completedReplayAfterExpiry = replay.kind;
      assert.deepEqual(
        await database.prepare('SELECT * FROM authorization_wallet_session_quotas').first(),
        quota,
      );
    } else if (pause === 'failed-factor') {
      assert.equal(response.status, 401);
      assert.equal(body.code, 'not_verified');
      assert.equal(claims.length, 0);
      assert.equal(evidence.length, 0);
      assert.equal(audits, 0);
    } else {
      assert.equal(response.status, 403, JSON.stringify(result));
      assert.equal(body.code, 'verified_step_up_rejected');
      assert.equal(claims.length, 0);
      assert.equal(audits, 0);
    }
    for (const item of evidence) {
      assert.ok(item.verified_at_ms >= state.verificationFinishedAtMs);
    }
    return result;
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await opened.close();
  }
}

const evidence = [];
for (const host of ['vm_sqlite', 'local_cloudflare_d1']) {
  for (const method of ['passkey', 'email_otp']) {
    for (const pause of ['none', 'failed-factor', 'verification', 'evidence', 'admission']) {
      evidence.push(await scenario(host, method, pause));
    }
  }
  evidence.push(await scenario(host, 'email_otp', 'grant-expiry'));
}
const artifact = `${output}/after.json`;
await writeFile(
  artifact,
  `${JSON.stringify({ command: 'node tests/e2e/step-up-expiry.e2e.mjs', trustedBoundary: 'factor verification and material discovery', evidence }, null, 2)}\n`,
);
console.log(`Step-up expiry E2E passed: ${artifact}`);
