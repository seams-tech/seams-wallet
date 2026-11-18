import { expect, test } from '@playwright/test';
import { base64UrlDecode } from '@shared/utils/encoders';
import { emailOtpFactorOprfInfo } from '@shared/utils/emailOtpDomain';
import { createEmailOtpFactorOprf } from '../../packages/wallet-server/src/core/authService/emailOtpFactorOprf';
import { createEmailOtpCodeSeal } from '../../packages/wallet-server/src/core/authService/emailOtpCodeSeal';
import { CloudflareD1EmailOtpServerSealRuntime } from '../../packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpServerSealRuntime';
import {
  oprf_client_blind,
  oprf_client_finalize,
} from '../../wasm/oprf_runtime/pkg/oprf_runtime.js';

const rootSecretB64u = Buffer.alloc(32, 11).toString('base64url');
const keyVersion = 'email-otp-seal-v1';
const walletA = {
  walletId: 'wallet-a',
  enrollmentId: 'email-otp-device-enrollment-v1:wallet-a:s1',
  factorNonceB64u: Buffer.alloc(32, 1).toString('base64url'),
};

function factorOprf() {
  return createEmailOtpFactorOprf({
    rootSecretB64u,
    currentKeyVersion: keyVersion,
    acceptedKeyVersions: [keyVersion],
  });
}

// The server module starts the shared WASM module on first use; the client calls below use it too.
test.beforeAll(async () => {
  await factorOprf().publicKey(keyVersion);
});

/** Runs the blinded protocol for one device input and returns the 64-byte output, or throws. */
async function deviceOutput(input: {
  readonly oprfInput: Uint8Array;
  readonly evaluatedFor: typeof walletA;
  readonly finalizedFor: typeof walletA;
}): Promise<Uint8Array> {
  const oprf = factorOprf();
  const blind = oprf_client_blind(input.oprfInput);
  const evaluation = await oprf.evaluate({
    keyVersion,
    ...input.evaluatedFor,
    blindedElement: blind.blindedElement,
  });
  return oprf_client_finalize(
    blind.handle,
    input.oprfInput,
    evaluation.evaluatedElement,
    evaluation.proof,
    await oprf.publicKey(keyVersion),
    emailOtpFactorOprfInfo(input.finalizedFor),
  );
}

test('the device gets the same factor key each time, and the server never sees it', async () => {
  const oprfInput = new Uint8Array(32).fill(5);
  const first = await deviceOutput({ oprfInput, evaluatedFor: walletA, finalizedFor: walletA });
  const second = await deviceOutput({ oprfInput, evaluatedFor: walletA, finalizedFor: walletA });
  expect(first).toHaveLength(64);
  expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
});

test('an evaluation for another wallet, enrollment or nonce does not give this factor', async () => {
  const oprfInput = new Uint8Array(32).fill(5);
  for (const other of [
    { ...walletA, walletId: 'wallet-b' },
    { ...walletA, enrollmentId: 'email-otp-device-enrollment-v1:wallet-a:s2' },
    { ...walletA, factorNonceB64u: Buffer.alloc(32, 2).toString('base64url') },
  ]) {
    // A valid code for wallet B makes the server evaluate under wallet B's info. The proof then
    // fails against wallet A's info, so a stolen device input of wallet A stays closed.
    await expect(
      deviceOutput({ oprfInput, evaluatedFor: other, finalizedFor: walletA }),
    ).rejects.toThrow();
  }
});

test('an unknown key version is refused', async () => {
  await expect(factorOprf().publicKey('email-otp-seal-v0')).rejects.toThrow('Unknown');
});

test('each enrollment gets a fresh factor nonce from the server', async () => {
  const runtime = new CloudflareD1EmailOtpServerSealRuntime({
    configured: true,
    factorOprf: factorOprf(),
    codeSeal: createEmailOtpCodeSeal(rootSecretB64u),
  });
  const blind = oprf_client_blind(new Uint8Array(32).fill(7));
  const blindedElementB64u = Buffer.from(blind.blindedElement).toString('base64url');
  const scope = { walletId: walletA.walletId, enrollmentId: walletA.enrollmentId };
  const first = await runtime.enrollEmailOtpFactor({ ...scope, blindedElementB64u });
  const second = await runtime.enrollEmailOtpFactor({ ...scope, blindedElementB64u });
  if (!first.ok || !second.ok) throw new Error('enrollment failed');
  expect(base64UrlDecode(first.factorNonceB64u)).toHaveLength(32);
  expect(second.factorNonceB64u).not.toBe(first.factorNonceB64u);
  // The same blinded element under a new nonce is a different function, so this
  // unauthenticated route never reproduces the evaluation of an existing enrollment.
  expect(second.evaluatedElementB64u).not.toBe(first.evaluatedElementB64u);
  expect(
    await runtime.enrollEmailOtpFactor({ ...scope, blindedElementB64u: 'AAAA' }),
  ).toMatchObject({ ok: false, code: 'invalid_body' });
});
