import assert from 'node:assert/strict';

export async function seedOperationHistory({ api, database, scope, session, authMethod, nowMs }) {
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  const sessionInput = api.buildSessionSigningOperationInputFixture({
    session,
    label: 'transfer-session-operation',
    nowMs,
  });
  const stepUp = await api.buildStepUpSigningOperationFixture({
    session,
    label: 'transfer-step-up-operation',
    nowMs,
    rpId: authMethod.rpId,
    credentialIdB64u: authMethod.credentialIdB64u,
  });
  await store.putVerifiedEvidenceSet(stepUp.evidence);
  const claimedSession = await store.admitAuthorizedOperation({ operation: sessionInput });
  const claimedStepUp = await store.admitAuthorizedOperation({ operation: stepUp.operation });
  assert.equal(claimedSession.kind, 'claimed');
  assert.equal(claimedStepUp.kind, 'claimed');
  const sessionResult = await store.completeAuthorizedOperation({
    operation: claimedSession.operation,
    result: 'succeeded',
    response: {
      status: 200,
      contentType: 'application/json',
      bodyText: JSON.stringify({ result: 'symbolic-signature', context: 'x'.repeat(60_000) }),
    },
    completedAtMs: nowMs + 1,
  });
  const stepUpResult = await store.completeAuthorizedOperation({
    operation: claimedStepUp.operation,
    result: 'failed_before_side_effect',
    response: {
      status: 409,
      contentType: 'application/json',
      bodyText: '{"code":"backend_rejected","details":null}',
    },
    completedAtMs: nowMs + 2,
  });
  return {
    walletId: session.walletId,
    sessionResult,
    stepUpResult,
    stepUpInput: stepUp.operation,
    evidenceSetId: stepUp.evidence.evidenceSetId,
    evidenceExpiresAtMs: stepUp.evidence.expiresAtMs,
  };
}

export async function verifyImportedOperationHistory({ api, database, scope, history }) {
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  for (const expected of [history.sessionResult, history.stepUpResult]) {
    const pinned = await store.readPinnedOwnerWalletScope({
      operation: expected,
      walletId: history.walletId,
    });
    assert.equal(pinned.ownershipGeneration, 1);
    assert.deepEqual(
      await store.readAuthorizedOperation({
        tenantId: expected.tenantId,
        operationFingerprintDigest: expected.operationFingerprintDigest,
      }),
      expected,
    );
    assert.deepEqual(
      await store.completeAuthorizedOperation({
        operation: expected,
        result: 'failed_after_side_effect',
        response: { status: 500, contentType: 'text/plain', bodyText: 'replacement' },
        completedAtMs: Date.now(),
      }),
      expected,
    );
  }
  const replay = await store.admitAuthorizedOperation({ operation: history.stepUpInput });
  assert.equal(replay.kind, 'replayed');
  assert.deepEqual(replay.operation, history.stepUpResult);
  assert.ok(
    Date.now() < history.evidenceExpiresAtMs,
    'Imported proof must still be within its original expiry',
  );
  const late = api.buildAdditionalStepUpOperationInputFixture({
    admitted: history.stepUpInput,
    label: 'new-operation-from-imported-evidence',
    nowMs: Date.now(),
  });
  assert.equal(
    (await store.admitAuthorizedOperation({ operation: late })).kind,
    'verified_step_up_rejected',
  );
  const auditCount = await database
    .prepare(
      'SELECT COUNT(*) AS count FROM authorized_operation_audit_events WHERE authorized_operation_id IN (?, ?)',
    )
    .bind(history.sessionResult.authorizedOperationId, history.stepUpResult.authorizedOperationId)
    .first('count');
  assert.equal(auditCount, 2);
  return {
    successfulAndFailedResponsesPreserved: true,
    multiChunkResponseBytes: Buffer.byteLength(history.sessionResult.response.bodyText),
    terminalResultCannotBeReplaced: true,
    importedUnexpiredEvidenceCannotAuthorizeNewOperation: true,
    exactStepUpReplayPreserved: true,
    originalOwnershipGenerationPreserved: true,
    auditCount,
  };
}

export async function verifyOperationHistoryCleanup({ database, scope, history }) {
  for (const table of ['authorized_operations', 'authorized_operation_audit_events']) {
    const count = await database
      .prepare(
        `SELECT COUNT(*) AS count FROM ${table}
      WHERE namespace = ? AND tenant_id = ? AND authorized_operation_id IN (?, ?)`,
      )
      .bind(
        scope.namespace,
        history.sessionResult.tenantId,
        history.sessionResult.authorizedOperationId,
        history.stepUpResult.authorizedOperationId,
      )
      .first('count');
    assert.equal(count, 0);
  }
  assert.equal(
    await database
      .prepare(
        `SELECT COUNT(*) AS count FROM verified_wallet_operation_evidence_sets
    WHERE namespace = ? AND tenant_id = ? AND evidence_set_id = ?`,
      )
      .bind(scope.namespace, history.stepUpResult.tenantId, history.evidenceSetId)
      .first('count'),
    0,
  );
  return { sourceOperationsRemoved: true, sourceAuditsRemoved: true, sourceEvidenceRemoved: true };
}

export async function verifyDestinationOperationGeneration({
  api,
  database,
  scope,
  service,
  fixture,
  nowMs,
}) {
  const issued = await service.issueDirectWalletSessionAuthorizationV2({
    tenantId: fixture.issuedSession.session.tenantId,
    principalId: fixture.issuedSession.session.principalId,
    walletId: fixture.authority.walletId,
    authority: fixture.authority,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    mintId: 'wallet-mint:destination-operation-generation',
    remainingUses: 5,
    issuedAtMs: nowMs,
    expiresAtMs: fixture.issuedSession.session.expiresAtMs,
  });
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  const input = api.buildSessionSigningOperationInputFixture({
    session: issued.session,
    label: 'destination-generation-operation',
    nowMs,
  });
  const walletId = issued.session.walletId;
  // The admission pins the scope from its own read-back. A separate read agrees.
  const claimed = await store.admitEd25519WalletSessionOperation({ operation: input, walletId });
  assert.equal(claimed.kind, 'claimed');
  assert.equal(claimed.ownerScope.ownershipGeneration, 2);
  assert.deepEqual(
    claimed.ownerScope,
    await store.readPinnedOwnerWalletScope({ operation: claimed.operation, walletId }),
  );
  const retry = await store.admitEd25519WalletSessionOperation({ operation: input, walletId });
  assert.equal(retry.kind, 'operation_in_progress');
  assert.deepEqual(retry.ownerScope, claimed.ownerScope);
  // A finalize request finds the prepared operation and its scope in one read.
  const resolution = {
    tenantId: input.tenantId,
    operationFingerprintDigest: claimed.operation.operationFingerprintDigest,
    walletId,
    nowMs,
  };
  const resolved = await store.resolveEd25519WalletSessionOperation(resolution);
  assert.equal(resolved.kind, 'operation_in_progress');
  assert.deepEqual(resolved.operation, claimed.operation);
  assert.deepEqual(resolved.ownerScope, claimed.ownerScope);
  await assert.rejects(
    store.resolveEd25519WalletSessionOperation({ ...resolution, walletId: `${walletId}-other` }),
    /Pinned owner Wallet Session scope is unavailable/,
  );
  assert.deepEqual(
    await store.resolveEd25519WalletSessionOperation({
      ...resolution,
      operationFingerprintDigest: 'never-claimed-fingerprint',
    }),
    { kind: 'authorized_operation_missing' },
  );
  const remaining = await database
    .prepare(
      `SELECT remaining_uses FROM authorization_wallet_session_quotas
    WHERE namespace = ? AND tenant_id = ? AND quota_id = ?`,
    )
    .bind(scope.namespace, issued.session.tenantId, issued.session.quotaId)
    .first('remaining_uses');
  assert.equal(remaining, 4);
  await store.completeAuthorizedOperation({
    operation: claimed.operation,
    result: 'failed_before_side_effect',
    response: {
      status: 409,
      contentType: 'application/json',
      bodyText: '{"code":"symbolic_backend_rejected"}',
    },
    completedAtMs: nowMs + 1,
  });
  // A completed operation replays its stored response and pins no scope.
  const replayed = await store.resolveEd25519WalletSessionOperation(resolution);
  assert.equal(replayed.kind, 'replayed');
  assert.equal(replayed.operation.lifecycle, 'completed');
  assert.equal(replayed.ownerScope, undefined);
  return { newClaimGeneration: 2, exactRetryGeneration: 2, quotaChargedOnce: true };
}
