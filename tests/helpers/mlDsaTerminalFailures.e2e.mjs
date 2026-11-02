import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

export async function verifyMlDsaTerminalFailures(input) {
  const results = [];
  let counter = input.counter;
  for (const reason of ['candidates_exhausted', 'transport_interrupted']) {
    const prepared = await input.api.prepareMlDsaNearSigning({
      access: { kind: 'public' },
      relayerUrl: input.relayerUrl,
      publicKeyB64u: input.publicKeyB64u,
      request: { ...input.signingRequest, operationIdB64u: randomBytes(32).toString('base64url') },
    });
    assert.equal(prepared.kind, 'prepared');
    const request = {
      relayerUrl: input.relayerUrl,
      preparation: prepared.preparation,
      authorization: {
        kind: 'passkey',
        credential: input.signingAssertion(
          input.key,
          prepared.preparation.challengeB64u,
          ++counter,
        ),
      },
    };
    input.delivery.signingFault = {
      kind: 'armed',
      reason,
      consume: input.consumePreparedForFailure,
    };
    let outcome = await input.api.executeMlDsaNearSigning(request);
    let waits = 0;
    while (outcome.kind === 'retry') {
      assert.ok(
        waits++ < 30 && Date.now() + outcome.retryAfterMs < prepared.preparation.expiresAtMs,
      );
      await new Promise(waitFor.bind(undefined, outcome.retryAfterMs));
      outcome = await input.api.executeMlDsaNearSigning(request);
    }
    assert.equal(outcome.kind, 'refused');
    assert.equal(outcome.code, reason);
    assert.equal(input.delivery.signingFault.kind, 'idle');
    const replay = await input.api.executeMlDsaNearSigning(request);
    assert.deepEqual(replay, outcome);
    const error = new input.api.MlDsaSigningError(outcome);
    assert.equal(
      input.api.resolveWalletBoundaryErrorCode({
        requestType: 'PM_SIGN_TX_WITH_ACTIONS',
        rawCode: error.code,
        message: error.message,
      }),
      'ml_dsa_signing_' + reason,
    );
    const result = input.api.nearTransactionFailure(error, 'not_submitted');
    const decoded = input.api.parseNearTransactionResult(JSON.parse(JSON.stringify(result)));
    assert.equal(decoded.kind, 'not_submitted');
    assert.deepEqual(decoded.cause, { kind: 'ml_dsa', failure: outcome });
    const uncertain = input.api.nearTransactionFailure(error, 'submission_unknown');
    assert.equal(
      uncertain.kind,
      'submission_unknown',
      'A failure code cannot prove that submission did not occur',
    );
    assert.deepEqual(input.api.parseNearTransactionResult(uncertain).cause, decoded.cause);
    const hookCodes = [];
    await input.api.notifyNearTransactionResult(
      { onError: recordError.bind(undefined, hookCodes) },
      decoded,
    );
    assert.deepEqual(hookCodes, ['ml_dsa_signing_' + reason]);
    results.push({
      reason,
      operationIdB64u: prepared.preparation.request.operationIdB64u,
      exactReplay: true,
      publicResultAndHookPreserveCause: true,
      submissionUncertaintyPreserved: true,
    });
  }
  return {
    lastCounter: counter,
    cases: results,
    scope:
      'Public Gateway/SDK with WebAuthn and real Worker admission, paired material consumption, completion, and exact replay. Terminal causes are injected at the authenticated completion boundary. Cryptographic rejection is not simulated as a successful signature.',
  };
}
function waitFor(delayMs, resolve) {
  setTimeout(resolve, Math.max(100, delayMs));
}
function recordError(codes, error) {
  codes.push(error.code);
}
