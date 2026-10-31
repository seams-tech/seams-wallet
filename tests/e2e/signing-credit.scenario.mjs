import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function verifySigningCredit({
  api,
  database,
  scope,
  session,
  authMethod,
  nowMs,
  output,
}) {
  const traced = new api.TracedD1Database(database);
  const store = new api.CloudflareD1AuthorizationStore({
    database: traced,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  await database
    .prepare(
      `INSERT INTO wallet_signing_credit_grants(namespace,tenant_id,grant_id,project_id,env_id,capacity,expires_at_ms)
    VALUES(?,?,'credit-grant-a',?,?,1,?)`,
    )
    .bind(scope.namespace, session.tenantId, scope.projectId, scope.envId, nowMs + 10000)
    .run();
  await database
    .prepare(
      `INSERT INTO wallet_signing_credit_policies(namespace,tenant_id,project_id,env_id,mode,grant_id,revision)
    VALUES(?,?,?,?,'credit','credit-grant-a',1)`,
    )
    .bind(scope.namespace, session.tenantId, scope.projectId, scope.envId)
    .run();
  const first = await api.buildStepUpSigningOperationFixture({
    session,
    label: 'credit-a',
    nowMs,
    rpId: authMethod.rpId,
    credentialIdB64u: authMethod.credentialIdB64u,
  });
  const second = await api.buildStepUpSigningOperationFixture({
    session,
    label: 'credit-b',
    nowMs,
    rpId: authMethod.rpId,
    credentialIdB64u: authMethod.credentialIdB64u,
  });
  await store.putVerifiedEvidenceSet(first.evidence);
  await store.putVerifiedEvidenceSet(second.evidence);
  const race = await Promise.all([
    store.admitAuthorizedOperation({ operation: first.operation }),
    store.admitAuthorizedOperation({ operation: second.operation }),
  ]);
  assert.deepEqual(race.map(resultKind).sort(), ['billing_credit_exhausted', 'claimed']);
  const winningIndex = race.findIndex(isClaimed);
  const winning = race[winningIndex];
  const original = winningIndex === 0 ? first.operation : second.operation;
  assert.equal(
    (await store.admitAuthorizedOperation({ operation: original })).kind,
    'operation_in_progress',
  );
  await database
    .prepare("UPDATE wallet_signing_credit_policies SET mode='blocked',grant_id=NULL,revision=2")
    .run();
  await store.completeAuthorizedOperation({
    operation: winning.operation,
    result: 'succeeded',
    response: {
      status: 200,
      contentType: 'application/json',
      bodyText: '{"signature":"accepted-result"}',
    },
    completedAtMs: nowMs + 20000,
  });
  assert.equal((await store.admitAuthorizedOperation({ operation: original })).kind, 'replayed');
  const completions = (
    await database
      .prepare(
        'SELECT credit_grant_id,outcome FROM wallet_signature_completions WHERE credit_grant_id IS NOT NULL',
      )
      .all()
  ).results;
  assert.deepEqual(completions, [{ credit_grant_id: 'credit-grant-a', outcome: 'succeeded' }]);
  const claims = (await database.prepare('SELECT * FROM wallet_signing_credit_claims').all())
    .results;
  assert.equal(claims.length, 1);
  await database
    .prepare(
      `INSERT INTO wallet_signing_credit_grants(namespace,tenant_id,grant_id,project_id,env_id,capacity,expires_at_ms)
    VALUES(?,?,'credit-grant-b',?,?,2,?)`,
    )
    .bind(scope.namespace, session.tenantId, scope.projectId, scope.envId, nowMs + 10000)
    .run();
  await database
    .prepare(
      "UPDATE wallet_signing_credit_policies SET mode='credit',grant_id='credit-grant-b',revision=3",
    )
    .run();
  for (const outcome of ['failed_before_side_effect', 'failed_after_side_effect']) {
    const attempt = await api.buildStepUpSigningOperationFixture({
      session,
      label: outcome,
      nowMs: nowMs + 1,
      rpId: authMethod.rpId,
      credentialIdB64u: authMethod.credentialIdB64u,
    });
    await store.putVerifiedEvidenceSet(attempt.evidence);
    const admitted = await store.admitAuthorizedOperation({ operation: attempt.operation });
    assert.equal(admitted.kind, 'claimed');
    await store.completeAuthorizedOperation({
      operation: admitted.operation,
      result: outcome,
      response: {
        status: 503,
        contentType: 'application/json',
        bodyText: '{"code":"provider_unavailable"}',
      },
      completedAtMs: nowMs + 20000,
    });
  }
  const failed = (
    await database
      .prepare(
        "SELECT outcome FROM wallet_signature_completions WHERE credit_grant_id='credit-grant-b'",
      )
      .all()
  ).results;
  assert.deepEqual(failed, [{ outcome: 'failed' }]);
  assert.equal(
    (
      await database
        .prepare(
          "SELECT admitted_count FROM wallet_signing_credit_grants WHERE grant_id='credit-grant-b'",
        )
        .first()
    ).admitted_count,
    2,
  );
  const trace = JSON.parse(traced.response(new Response()).headers.get('x-benchmark-d1'));
  await writeFile(
    resolve(output, 'signing-credit.json'),
    JSON.stringify(
      {
        command: 'node tests/e2e/signing-credit.e2e.mjs',
        concurrentResults: race.map(resultKind),
        exactReplay: true,
        acceptedCompletionAfterBlock: true,
        indeterminateCreditRetained: true,
        confirmedFailureReleased: true,
        completions,
        claims,
        trace,
      },
      null,
      2,
    ),
  );
}
function resultKind(result) {
  return result.kind;
}
function isClaimed(result) {
  return result.kind === 'claimed';
}
