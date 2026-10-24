import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

/** Real Gateway and D1 admission. The existing wallet cooldown stays in effect. */
export async function verifyMlDsaSigningSessions(input) {
  const { api, key, signingRequest, relayerUrl, signingAssertion } = input;
  const first = await prepareOperation(input);
  const tokenB64u = randomBytes(32).toString('base64url');
  const request = {
    walletId: signingRequest.walletId,
    operationIdB64u: first.request.operationIdB64u,
    tokenDigestB64u: createHash('sha256')
      .update(`seams/ml-dsa/session-token/v1|${tokenB64u}`)
      .digest('base64url'),
    maxOperations: 2,
    durationMs: 600000,
  };
  const grant = await api.prepareMlDsaSigningSession({ relayerUrl, request });
  assert.equal(grant.kind, 'prepared', 'The scoped session challenge must be issued');
  assert.deepEqual(await api.prepareMlDsaSigningSession({ relayerUrl, request }), grant);
  const changed = await api.prepareMlDsaSigningSession({
    relayerUrl,
    request: { ...request, maxOperations: 3 },
  });
  assert.equal(changed.code, 'idempotency_conflict');
  const oversized = await api.prepareMlDsaSigningSession({
    relayerUrl,
    request: { ...request, maxOperations: 33 },
  });
  assert.equal(oversized.code, 'invalid_body');
  const sessionIdB64u = grant.preparation.sessionIdB64u;
  const unauthorized = await api.executeMlDsaNearSigning({
    relayerUrl,
    preparation: first,
    authorization: {
      kind: 'session',
      sessionIdB64u,
      tokenB64u: randomBytes(32).toString('base64url'),
    },
  });
  assert.equal(unauthorized.code, 'unauthorized');
  const credential = signingAssertion(key, grant.preparation.challengeB64u, input.counter);
  const start = {
    relayerUrl,
    preparation: first,
    authorization: { kind: 'session_start', sessionIdB64u, tokenB64u, credential },
  };
  const wrongApproval = structuredClone(start);
  wrongApproval.authorization.credential = signingAssertion(
    key,
    first.challengeB64u,
    input.counter,
  );
  assert.equal((await api.executeMlDsaNearSigning(wrongApproval)).code, 'unauthorized');
  const firstOutcome = await api.executeMlDsaNearSigning(start);
  assert.notEqual(
    firstOutcome.kind,
    'refused',
    'Initial approval must admit the exact first operation',
  );
  const second = await prepareOperation(input);
  const competing = await prepareOperation(input);
  const authorization = { kind: 'session', sessionIdB64u, tokenB64u };
  const results = await Promise.all([
    api.executeMlDsaNearSigning({ relayerUrl, preparation: second, authorization }),
    api.executeMlDsaNearSigning({ relayerUrl, preparation: competing, authorization }),
  ]);
  assert.equal(
    results.filter(admitted).length,
    1,
    'One remaining use must admit exactly one concurrent operation',
  );
  const losing = results.find(refused);
  assert.ok(losing && (losing.code === 'conflict' || losing.code === 'unauthorized'));
  const excess = await prepareOperation(input);
  assert.equal(
    (await api.executeMlDsaNearSigning({ relayerUrl, preparation: excess, authorization })).code,
    'unauthorized',
  );
  assert.notEqual(
    (await api.executeMlDsaNearSigning(start)).kind,
    'refused',
    'Exact retries must survive an exhausted session budget',
  );
  const revoked = await api.revokeMlDsaSigningSession({
    relayerUrl,
    credential: { walletId: signingRequest.walletId, sessionIdB64u, tokenB64u },
  });
  assert.equal(revoked.kind, 'revoked');
  assert.deepEqual(
    await api.revokeMlDsaSigningSession({
      relayerUrl,
      credential: { walletId: signingRequest.walletId, sessionIdB64u, tokenB64u },
    }),
    revoked,
  );
  assert.equal((await api.executeMlDsaNearSigning(start)).code, 'unauthorized');
  return {
    exactPreparationReplay: true,
    changedBudgetRejected: true,
    oversizedBudgetRejected: true,
    wrongCredentialRejected: true,
    ordinaryTransactionAssertionCannotAuthorizeSession: true,
    initialOperationAdmitted: true,
    atomicConcurrentBudget: true,
    exhaustedBudgetRejected: true,
    exactRetryDoesNotChargeAgain: true,
    sessionRevocationIsIdempotent: true,
    revokedSessionCannotReadOperation: true,
  };
}
function admitted(outcome) {
  return outcome.kind !== 'refused';
}
function refused(outcome) {
  return outcome.kind === 'refused';
}
async function prepareOperation(input) {
  const prepared = await input.api.prepareMlDsaNearSigning({
    access: { kind: 'public' },
    relayerUrl: input.relayerUrl,
    publicKeyB64u: input.publicKeyB64u,
    request: { ...input.signingRequest, operationIdB64u: randomBytes(32).toString('base64url') },
  });
  assert.equal(prepared.kind, 'prepared');
  return prepared.preparation;
}
