import { seedExecutionGeneration } from './execution-generation.scenario.mjs';
// Run from the repository root: node tests/e2e/step-up-expiry.e2e.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { applySignerD1Migrations, openSignerD1 } from '../fixtures/signer-d1.mjs';

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
      export { D1WalletExecutionAuthority } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
      export { D1WalletRelocationSessions, WalletRelocationSessionSource } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationSessions';
      export { buildAdditionalStepUpOperationInputFixture } from './tests/unit/helpers/authorizedOperation.fixtures';
      export { handleThresholdEcdsa } from './packages/wallet-server/src/router/transport/fetch/routes/thresholdEcdsa';
      export { AuthorizationService } from './packages/wallet-server/src/authorization/service';
      export { CloudflareD1AuthorizationStore } from './packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
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
  while (Date.now() <= deadline) {
    await delay(Math.max(1, deadline - Date.now() + 10));
  }
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
    this.scenario.evidenceSet = evidence;
    if (this.scenario.pause === 'evidence') {
      await waitPast(evidence.expiresAtMs);
    }
  }

  async admitAuthorizedOperation(input) {
    this.scenario.claimInput = input;
    if (this.scenario.pause === 'admission') {
      await waitPast(this.scenario.deadline);
    }
    return await super.admitAuthorizedOperation(input);
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
    if (this.scenario.pause === 'verification') {
      await waitPast(this.scenario.deadline);
    }
    this.scenario.verificationFinishedAtMs = Date.now();
    if (this.scenario.pause === 'failed-factor') {
      return { success: false, verified: false, code: 'not_verified' };
    }
    return { success: true, verified: true };
  }

  async verifyOtp() {
    await this.verifyFactor();
    if (this.scenario.pause === 'failed-factor') {
      return { ok: false, code: 'not_verified' };
    }
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
  const opened = await openSignerD1();
  try {
    return await exerciseStepUpExpiry(opened, host, method, pause);
  } finally {
    await opened.close();
  }
}

async function exerciseStepUpExpiry({ database, migrations }, host, method, pause) {
  const base = await api.buildEcdsaSigningRequestFixture();
  await seedExecutionGeneration({
    api,
    database,
    walletId: base.scope.wallet_id,
    scope: {
      namespace: 'expiry-e2e',
      orgId: 'tenant:expiry-e2e',
      projectId: 'expiry-e2e',
      envId: 'test',
    },
  });
  const nowMs = Date.now();
  let evidenceLifetimeMs = 500;
  let grantLifetimeMs = 500;
  if (pause === 'relocation') {
    evidenceLifetimeMs = 60_000;
    grantLifetimeMs = 60_000;
  } else {
    if (pause === 'none' || pause === 'grant-expiry') evidenceLifetimeMs = 2_000;
    if (pause === 'none') grantLifetimeMs = 2_000;
  }
  const state = {
    pause,
    deadline: nowMs + evidenceLifetimeMs,
    grantDeadline: nowMs + grantLifetimeMs,
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
  const response = await route.handle(
    new Request(
      `https://wallet.example.test${api.ROUTER_AB_ECDSA_DERIVATION_OPERATION_STEP_UP_PATH}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://wallet.example.test' },
        body: JSON.stringify({
          kind: 'router_ab_ecdsa_operation_step_up_v1',
          operation,
          proof: proofFor(method, operation.wallet_id),
        }),
      },
    ),
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
      .prepare('SELECT verified_at_ms, expires_at_ms FROM verified_wallet_operation_evidence_sets')
      .all()
  ).results;
  const audits = (
    await database
      .prepare('SELECT COUNT(*) AS count FROM authorized_operation_audit_events')
      .first()
  ).count;
  const quota = await database.prepare('SELECT * FROM authorization_wallet_session_quotas').first();
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
    migrations,
  };
  assert.equal(route.factorCalls, 1, JSON.stringify(body));
  assert.equal(quota.remaining_uses, 0);
  assert.equal(quota.wallet_session_id, 'session:expiry-e2e');
  assert.equal(quota.lifecycle_kind, 'exhausted');
  assert.equal(quota.expires_at_ms, state.deadline);
  assert.equal(route.grantConsumed, method === 'email_otp' && pause !== 'failed-factor');
  // A claimed or refused operation has produced no signature yet.
  assert.equal(
    (await database.prepare('SELECT COUNT(*) AS count FROM wallet_signature_completions').first())
      .count,
    0,
  );
  if (pause === 'none' || pause === 'relocation') {
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(claims.length, 1);
    assert.equal(audits, 1);
    const retry = await store.admitAuthorizedOperation(state.claimInput);
    assert.equal(retry.kind, 'operation_in_progress');
    assert.equal(
      (await database.prepare('SELECT COUNT(*) AS count FROM authorized_operations').first()).count,
      1,
    );
    result.exactRetry = retry.kind;
    if (pause === 'relocation') {
      result.relocation = await verifyStepUpRelocation(database, store, state, retry.operation);
      return result;
    }
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
    // The successful completion records one signature; the rejected rewrite records none.
    const claim = await database
      .prepare('SELECT owner_scope_org_id, owner_scope_project_id, owner_scope_env_id FROM authorized_operations')
      .first();
    const signatures = (
      await database.prepare('SELECT * FROM wallet_signature_completions').all()
    ).results;
    assert.deepEqual(signatures, [
      {
        namespace: 'expiry-e2e',
        tenant_id: String(completed.tenantId),
        authorized_operation_id: String(completed.authorizedOperationId),
        operation_kind: 'evm.sign_transaction',
        org_id: claim.owner_scope_org_id,
        project_id: claim.owner_scope_project_id,
        env_id: claim.owner_scope_env_id,
        completed_at_ms: completed.completedAtMs,
      },
    ]);
    result.signatureCompletions = signatures;
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
}

async function verifyStepUpRelocation(database, store, state, operation) {
  const claimInput = state.claimInput;
  const scope = {
    namespace: 'expiry-e2e',
    orgId: 'tenant:expiry-e2e',
    projectId: 'expiry-e2e',
    envId: 'test',
  };
  const source = api.WalletRelocationSessionSource.parse({
    walletId: state.evidenceSet.walletId,
    moveId: `wmove_${'p'.repeat(43)}`,
    requestDigestHex: '2'.repeat(64),
    sourceGeneration: 1,
  });
  const sessions = new api.D1WalletRelocationSessions(database, scope);
  assert.equal(
    (await store.readPinnedOwnerWalletScope({ operation, walletId: source.walletId }))
      .ownershipGeneration,
    1,
  );
  await assert.rejects(
    database.prepare('UPDATE authorized_operations SET ownership_generation = 2').run(),
    /wallet_operation_execution_generation_immutable/u,
  );
  assert.equal(await sessions.hasPendingOperations(source.walletId), true);
  await assert.rejects(sessions.retire(source, Date.now()), /wallet_operations_unsettled/u);
  const foreignScope = { ...scope, envId: 'foreign' };
  assert.equal(
    await new api.D1WalletRelocationSessions(database, foreignScope).hasPendingOperations(
      source.walletId,
    ),
    false,
  );
  const foreignStore = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: foreignScope,
  });
  await assert.rejects(
    foreignStore.readPinnedOwnerWalletScope({ operation, walletId: source.walletId }),
    /Verified step-up operation is not claimed/u,
  );
  assert.equal(
    (await foreignStore.admitAuthorizedOperation(claimInput)).kind,
    'verified_step_up_rejected',
  );
  await assert.rejects(
    database.prepare('DELETE FROM verified_wallet_operation_evidence_sets').run(),
    /wallet_operation_evidence_referenced/u,
  );
  await assert.rejects(
    database.prepare("UPDATE verified_wallet_operation_evidence_sets SET env_id = 'foreign'").run(),
    /wallet_operation_evidence_immutable/u,
  );
  const persisted = await database
    .prepare('SELECT * FROM verified_wallet_operation_evidence_sets')
    .first();
  const changedScope = { ...persisted, env_id: 'foreign' };
  const columns = Object.keys(changedScope);
  await assert.rejects(
    database
      .prepare(
        `INSERT OR REPLACE INTO verified_wallet_operation_evidence_sets
    (${columns.join(', ')}) VALUES (${columns.map(sqlParameter).join(', ')})`,
      )
      .bind(...Object.values(changedScope))
      .run(),
    /wallet_operation_evidence_immutable/u,
  );
  await store.putVerifiedEvidenceSet(state.evidenceSet);
  const scopeMigration = await verifyStepUpScopeMigration(database, scope, operation);
  const completed = await store.completeAuthorizedOperation({
    operation,
    result: 'succeeded',
    response: {
      status: 200,
      contentType: 'application/json',
      bodyText: '{"result":"settled-before-relocation"}',
    },
    completedAtMs: Date.now(),
  });
  assert.equal(await sessions.hasPendingOperations(source.walletId), false);
  const retiredAtMs = await sessions.retire(source, Date.now());
  assert.equal(
    await new api.D1WalletRelocationSessions(database, scope).retire(source, Date.now()),
    retiredAtMs,
  );
  assert.ok(
    Date.now() < state.evidenceSet.expiresAtMs,
    'Retirement must reject still-valid evidence',
  );
  const lateOperation = api.buildAdditionalStepUpOperationInputFixture({
    admitted: claimInput.operation,
    label: 'late-step-up',
    nowMs: Date.now(),
  });
  assert.equal(
    (
      await store.admitAuthorizedOperation({
        operation: lateOperation,
        material: claimInput.material,
      })
    ).kind,
    'verified_step_up_rejected',
  );
  await assert.rejects(
    store.putVerifiedEvidenceSet(state.evidenceSet),
    /authorization_evidence_claim_rejected/u,
  );
  const replay = await store.admitAuthorizedOperation(claimInput);
  assert.equal(replay.kind, 'replayed');
  assert.deepEqual(replay.operation, completed);
  assert.equal(
    (await database.prepare('SELECT COUNT(*) AS count FROM authorized_operations').first()).count,
    1,
  );
  return {
    scopeMigration,
    pendingStepUpBlocksRetirement: true,
    storedScopeRejectsOtherEnvironment: true,
    pendingEvidenceCannotDisappearOrChangeOwner: true,
    retiredSourceRejectsUnexpiredEvidence: true,
    completedResultReplaysAfterRetirement: true,
    retiredAtMs,
  };
}

async function insertStoredRow(database, table, row) {
  const columns = Object.keys(row);
  for (const column of columns) assert.match(column, /^[a-z_]+$/u);
  await database
    .prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(sqlParameter).join(', ')})`,
    )
    .bind(...Object.values(row))
    .run();
}

function sqlParameter() {
  return '?';
}

async function verifyStepUpScopeMigration(database, scope, operation) {
  const opened = await openSignerD1('0062_wallet_step_up_operation_settlement.sql');
  try {
    const historical = opened.database;
    const stored = await database
      .prepare('SELECT * FROM verified_wallet_operation_evidence_sets')
      .first();
    const { org_id, project_id, env_id, ...oldEvidence } = stored;
    assert.deepEqual([org_id, project_id, env_id], [scope.orgId, scope.projectId, scope.envId]);
    const signer = await database.prepare('SELECT * FROM wallet_signers').first();
    await insertStoredRow(historical, 'verified_wallet_operation_evidence_sets', oldEvidence);
    await insertStoredRow(historical, 'wallet_signers', signer);
    const { ownership_generation, ...oldOperation } = await database
      .prepare('SELECT * FROM authorized_operations')
      .first();
    assert.equal(ownership_generation, 1);
    await insertStoredRow(historical, 'authorized_operations', oldOperation);
    await insertStoredRow(historical, 'wallet_signers', { ...signer, env_id: 'ambiguous-scope' });
    await assert.rejects(
      applySignerD1Migrations(historical, opened.pendingMigrations),
      /wallet_operation_evidence_requires_unique_scope/u,
    );
    assert.deepEqual(
      Object.entries(
        await historical.prepare('SELECT * FROM verified_wallet_operation_evidence_sets').first(),
      ),
      Object.entries(oldEvidence),
    );
    await historical.prepare("DELETE FROM wallet_signers WHERE env_id = 'ambiguous-scope'").run();
    await historical.prepare('DELETE FROM verified_wallet_operation_evidence_sets').run();
    await assert.rejects(
      applySignerD1Migrations(historical, opened.pendingMigrations),
      /wallet_operation_evidence_requires_unique_scope/u,
    );
    await insertStoredRow(historical, 'verified_wallet_operation_evidence_sets', oldEvidence);
    await applySignerD1Migrations(historical, opened.pendingMigrations);
    assert.deepEqual(
      Object.entries(
        await historical.prepare('SELECT * FROM verified_wallet_operation_evidence_sets').first(),
      ),
      Object.entries(stored),
    );
    const reader = new api.CloudflareD1AuthorizationStore({
      database: historical,
      namespace: scope.namespace,
      walletSignerScope: scope,
    });
    assert.deepEqual(
      await reader.readAuthorizedOperation({
        tenantId: operation.tenantId,
        operationFingerprintDigest: operation.operationFingerprintDigest,
      }),
      operation,
    );
    assert.equal(
      await new api.D1WalletRelocationSessions(historical, scope).hasPendingOperations(
        stored.wallet_id,
      ),
      true,
    );
    return {
      ambiguousScopeRollsBackMigration: true,
      missingEvidenceRollsBackMigration: true,
      uniqueScopePreservesEvidenceAndClaim: true,
      migratedPendingClaimBlocksRetirement: true,
    };
  } finally {
    await opened.close();
  }
}

const evidence = [];
for (const host of ['local_cloudflare_d1']) {
  for (const method of ['passkey', 'email_otp']) {
    for (const pause of ['none', 'failed-factor', 'verification', 'evidence', 'admission']) {
      evidence.push(await scenario(host, method, pause));
    }
  }
  evidence.push(await scenario(host, 'email_otp', 'grant-expiry'));
  evidence.push(await scenario(host, 'passkey', 'relocation'));
}
const artifact = `${output}/after.json`;
await writeFile(
  artifact,
  `${JSON.stringify({ command: 'node tests/e2e/step-up-expiry.e2e.mjs', trustedBoundary: 'factor verification and material discovery', evidence }, null, 2)}\n`,
);
console.log(`Step-up expiry E2E passed: ${artifact}`);
