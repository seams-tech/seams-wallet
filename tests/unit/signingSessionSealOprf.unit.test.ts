import { expect, test } from '@playwright/test';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/encoders';
import { signingSessionSealOprfInfo } from '@shared/utils/signingSessionSeal';
import {
  createSigningSessionSealEvaluator,
  warmSigningSessionSealRuntime,
} from '../../packages/wallet-server/src/threshold/session/signingSessionSeal/crypto/oprf';
import { createSigningSessionSealService } from '../../packages/wallet-server/src/threshold/session/signingSessionSeal/service';
import { parseSigningSessionSealEvaluateBody } from '../../packages/wallet-server/src/threshold/session/signingSessionSeal/transport/shared';
import type { SigningSessionSealAuthContext } from '../../packages/wallet-server/src/threshold/session/signingSessionSeal/signingSessionSeal.types';
import {
  oprf_client_blind,
  oprf_client_finalize,
} from '../../wasm/oprf_runtime/pkg/oprf_runtime.js';

const rootSecretB64u = Buffer.alloc(32, 7).toString('base64url');
const keyVersion = 'signing-session-seal-test-r1';
const sessionA = { walletId: 'wallet-a', thresholdSessionId: 'threshold-session-a' };
const sessionB = { walletId: 'wallet-a', thresholdSessionId: 'threshold-session-b' };

function evaluator() {
  return createSigningSessionSealEvaluator({
    rootSecretB64u,
    currentKeyVersion: keyVersion,
    acceptedKeyVersions: [keyVersion],
  });
}

function authFor(scope: typeof sessionA, expiresAtMs: number): SigningSessionSealAuthContext {
  return {
    userId: scope.walletId,
    session: {
      kind: 'exact_wallet_session_operation_credential',
      curve: 'ed25519',
      thresholdSessionId: scope.thresholdSessionId,
      userId: scope.walletId,
      expiresAtMs,
    },
  };
}

// The Gateway warm-up starts the shared WASM module; the client calls below use it too.
test.beforeAll(async () => {
  await warmSigningSessionSealRuntime();
});

/** Runs the blinded protocol for one device input and returns the 64-byte output, or throws. */
async function deviceOutput(input: {
  readonly oprfInput: Uint8Array;
  readonly evaluatedFor: typeof sessionA;
  readonly finalizedFor: typeof sessionA;
}): Promise<Uint8Array> {
  const blind = oprf_client_blind(input.oprfInput);
  const evaluation = await evaluator().evaluate({
    ...input.evaluatedFor,
    keyVersion,
    blindedElementB64u: base64UrlEncode(blind.blindedElement),
  });
  if (!evaluation.ok) throw new Error(evaluation.message);
  expect(evaluation.keyVersion).toBe(keyVersion);
  return oprf_client_finalize(
    blind.handle,
    input.oprfInput,
    base64UrlDecode(evaluation.evaluatedElementB64u),
    base64UrlDecode(evaluation.proofB64u),
    base64UrlDecode(evaluation.publicKeyB64u),
    signingSessionSealOprfInfo(input.finalizedFor),
  );
}

test('the device gets the same seal key for each restore of one session', async () => {
  const oprfInput = new Uint8Array(32).fill(9);
  const first = await deviceOutput({ oprfInput, evaluatedFor: sessionA, finalizedFor: sessionA });
  const second = await deviceOutput({ oprfInput, evaluatedFor: sessionA, finalizedFor: sessionA });
  expect(first).toHaveLength(64);
  expect(second).toEqual(first);
});

test('an evaluation for another threshold session fails the proof', async () => {
  const oprfInput = new Uint8Array(32).fill(9);
  await expect(
    deviceOutput({ oprfInput, evaluatedFor: sessionB, finalizedFor: sessionA }),
  ).rejects.toThrow();
});

test('another session gives another output for the same input', async () => {
  const oprfInput = new Uint8Array(32).fill(9);
  const a = await deviceOutput({ oprfInput, evaluatedFor: sessionA, finalizedFor: sessionA });
  const b = await deviceOutput({ oprfInput, evaluatedFor: sessionB, finalizedFor: sessionB });
  expect(b).not.toEqual(a);
});

test('the evaluator refuses an unknown key version and a value that is no element', async () => {
  const blinded = base64UrlEncode(oprf_client_blind(new Uint8Array(32).fill(3)).blindedElement);
  await expect(
    evaluator().evaluate({ ...sessionA, keyVersion: 'retired', blindedElementB64u: blinded }),
  ).resolves.toMatchObject({ ok: false, code: 'invalid_key_version' });
  await expect(
    evaluator().evaluate({
      ...sessionA,
      keyVersion,
      blindedElementB64u: base64UrlEncode(new Uint8Array(32).fill(0xff)),
    }),
  ).resolves.toMatchObject({ ok: false, code: 'invalid_blinded_element' });
  await expect(
    evaluator().evaluate({ ...sessionA, keyVersion, blindedElementB64u: 'short' }),
  ).resolves.toMatchObject({ ok: false, code: 'invalid_blinded_element' });
});

test('the route takes info from the admitted session, not from the request', async () => {
  const service = createSigningSessionSealService({ evaluator: evaluator() });
  const blindedElementB64u = base64UrlEncode(
    oprf_client_blind(new Uint8Array(32).fill(4)).blindedElement,
  );
  const expiresAtMs = Date.now() + 60_000;
  await expect(
    service.evaluate(
      { thresholdSessionId: sessionB.thresholdSessionId, blindedElementB64u },
      authFor(sessionA, expiresAtMs),
    ),
  ).resolves.toMatchObject({ ok: false, code: 'forbidden' });
  await expect(
    service.evaluate(
      { thresholdSessionId: sessionA.thresholdSessionId, blindedElementB64u },
      authFor(sessionA, Date.now() - 1),
    ),
  ).resolves.toMatchObject({ ok: false, code: 'expired' });
  const evaluated = await service.evaluate(
    { thresholdSessionId: sessionA.thresholdSessionId, blindedElementB64u },
    authFor(sessionA, expiresAtMs),
  );
  expect(evaluated).toMatchObject({ ok: true, keyVersion, expiresAtMs });
});

test('the evaluate body names the session and one blinded element only', () => {
  const thresholdSessionId = 'threshold-session-a';
  expect(
    parseSigningSessionSealEvaluateBody({ thresholdSessionId, blindedElementB64u: 'AA' }),
  ).toMatchObject({ ok: true });
  expect(
    parseSigningSessionSealEvaluateBody({
      thresholdSessionId,
      blindedElementB64u: 'AA',
      walletId: 'wallet-b',
    }),
  ).toMatchObject({ ok: false, code: 'invalid_body' });
  expect(
    parseSigningSessionSealEvaluateBody({ thresholdSessionId, ciphertext: 'AA' }),
  ).toMatchObject({ ok: false, code: 'invalid_body' });
});
