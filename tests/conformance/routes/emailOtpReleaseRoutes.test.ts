import { expect, test } from '@playwright/test';
import { requireParsed } from '../../../packages/shared-ts/src/passkey-custody/primitives';
import { parseWalletId } from '../../../packages/shared-ts/src/utils/domainIds';
import { buildEmailOtpWalletAuthAuthority } from '../../../packages/shared-ts/src/utils/walletAuthAuthority';
import { APP_ORIGIN, recordedCalls, routerWith } from './routeHarness';

// The Email OTP factor release, the registration factor and the export grant. The wire is the
// device-factor design of docs/otp/email-otp.md: the device sends blinded inputs, and the answer
// carries the factor wrapped under a key that only the device can compute. The code check behind
// these routes is the part that moves to the Auth Worker; the release stays in the Wallet Gateway.

const WALLET_ID = requireParsed(parseWalletId('email-otp-wallet-1'), 'test');
const METHOD_ID = 'email-otp-method-1';
const PROVIDER_SUBJECT = 'google-subject-1';
const TENANT = 'conformance-tenant';
const AUTHORITY = buildEmailOtpWalletAuthAuthority({
  walletId: WALLET_ID,
  provider: 'google',
  providerUserId: PROVIDER_SUBJECT,
  emailHashHex: 'ab'.repeat(32),
});
const STORED_FACTOR = { factorNonceB64u: 'nonce-2', wrappedFactorB64u: 'wrapped-2' };
const ENROLLMENT = {
  ok: true,
  enrollment: {
    providerUserId: PROVIDER_SUBJECT,
    verifiedEmail: 'alice@example.test',
    enrollmentId: 'enrollment-1',
    enrollmentSealKeyVersion: 'seal-v1',
    factors: [{ factorNonceB64u: 'nonce-1', wrappedFactorB64u: 'wrapped-1' }, STORED_FACTOR],
  },
};
/** This device holds one factor the server does not know, and then the second stored factor. */
const DEVICE_FACTORS = [
  { factorNonceB64u: 'nonce-other-device', blindedElementB64u: 'blind-0' },
  { factorNonceB64u: 'nonce-2', blindedElementB64u: 'blind-2' },
];
const CODE_BODY = {
  kind: 'email_otp',
  walletId: WALLET_ID,
  walletAuthMethodId: METHOD_ID,
  challengeId: 'challenge-1',
  otpCode: '123456',
  operation: 'wallet_unlock',
  deviceFactors: DEVICE_FACTORS,
};
const GRANT_BODY = {
  kind: 'verified_grant',
  walletId: WALLET_ID,
  loginGrant: 'login-grant-1',
  operation: 'wallet_unlock',
  deviceFactors: DEVICE_FACTORS,
};
const EVALUATION = {
  ok: true,
  publicKeyB64u: 'public-key',
  evaluatedElementB64u: 'evaluated',
  proofB64u: 'proof',
};

function releaseRouter(overrides: { verify?: object; consume?: object; enrollment?: object } = {}) {
  const readEnrollment = recordedCalls(overrides.enrollment ?? ENROLLMENT);
  const resolveAuthority = recordedCalls({
    kind: 'active_authority',
    walletAuthAuthority: AUTHORITY,
  });
  const verify = recordedCalls(
    overrides.verify ?? { ok: true, challengeId: 'challenge-1', loginGrant: 'grant-from-code' },
  );
  const consume = recordedCalls(overrides.consume ?? { ok: true, challengeId: 'challenge-1' });
  const evaluate = recordedCalls(EVALUATION);
  const router = routerWith({
    emailOtp: {
      readActiveEmailOtpEnrollment: readEnrollment.answer,
      verifyEmailOtpChallenge: verify.answer,
      consumeEmailOtpGrant: consume.answer,
      evaluateEmailOtpFactor: evaluate.answer,
    },
    walletUnlock: { resolveEmailOtpAuthorityForUnlock: resolveAuthority.answer },
  });
  async function release(body: object, origin = APP_ORIGIN) {
    return await router.call('POST', '/wallet/email-otp/factor-release', {
      headers: { origin },
      body,
    });
  }
  return { release, readEnrollment, resolveAuthority, verify, consume, evaluate };
}

const RELEASED = {
  status: 200,
  body: {
    ok: true,
    kind: 'email_otp_factor_evaluation_v1',
    challengeId: 'challenge-1',
    enrollmentId: 'enrollment-1',
    enrollmentSealKeyVersion: 'seal-v1',
    factorNonceB64u: 'nonce-2',
    publicKeyB64u: 'public-key',
    evaluatedElementB64u: 'evaluated',
    proofB64u: 'proof',
    wrappedFactorB64u: 'wrapped-2',
  },
};

test('a factor release with a code checks the code, uses its grant once and evaluates the device factor', async () => {
  const fake = releaseRouter();
  expect(await fake.release(CODE_BODY)).toEqual(RELEASED);
  expect(fake.readEnrollment.calls).toEqual([{ walletId: WALLET_ID, orgId: TENANT }]);
  expect(fake.resolveAuthority.calls).toEqual([
    {
      walletId: WALLET_ID,
      orgId: TENANT,
      walletAuthMethodId: METHOD_ID,
      providerUserId: PROVIDER_SUBJECT,
    },
  ]);
  expect(fake.verify.calls).toEqual([
    {
      userId: PROVIDER_SUBJECT,
      walletId: WALLET_ID,
      orgId: TENANT,
      challengeId: 'challenge-1',
      otpCode: '123456',
      otpChannel: 'email_otp',
      ownerProofBindingDigest: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      operation: 'wallet_unlock',
    },
  ]);
  expect(fake.consume.calls).toEqual([
    {
      subject: {
        kind: 'provider_identity',
        orgId: TENANT,
        providerSubject: PROVIDER_SUBJECT,
        walletId: WALLET_ID,
      },
      loginGrant: 'grant-from-code',
      otpChannel: 'email_otp',
      operation: 'wallet_unlock',
    },
  ]);
  // The server evaluates only the blinded input of the factor that this device holds.
  expect(fake.evaluate.calls).toEqual([
    {
      walletId: WALLET_ID,
      enrollmentId: 'enrollment-1',
      factorNonceB64u: 'nonce-2',
      enrollmentSealKeyVersion: 'seal-v1',
      blindedElementB64u: 'blind-2',
    },
  ]);
});

test('a factor release with a verified grant checks no code and uses the grant once', async () => {
  const fake = releaseRouter();
  expect(await fake.release(GRANT_BODY)).toEqual(RELEASED);
  expect(fake.verify.calls).toEqual([]);
  expect(fake.resolveAuthority.calls).toEqual([]);
  expect(fake.consume.calls).toEqual([
    expect.objectContaining({ loginGrant: 'login-grant-1', operation: 'wallet_unlock' }),
  ]);
});

test('the code check binds the operation and the origin of the request', async () => {
  const digests = new Set<unknown>();
  for (const [operation, origin] of [
    ['wallet_unlock', APP_ORIGIN],
    ['transaction_sign', APP_ORIGIN],
    ['wallet_unlock', 'https://other.example.test'],
  ] as const) {
    const fake = releaseRouter();
    await fake.release({ ...CODE_BODY, operation }, origin);
    const [call] = fake.verify.calls as { ownerProofBindingDigest: string }[];
    digests.add(call?.ownerProofBindingDigest);
  }
  expect(digests.size).toBe(3);
});

test('the export grant: a release for export_key uses a grant for export_key only', async () => {
  const fake = releaseRouter();
  expect(await fake.release({ ...CODE_BODY, operation: 'export_key' })).toEqual(RELEASED);
  expect(fake.verify.calls).toEqual([expect.objectContaining({ operation: 'export_key' })]);
  expect(fake.consume.calls).toEqual([expect.objectContaining({ operation: 'export_key' })]);

  // A grant that another operation made is refused by the grant store, and nothing is released.
  const mismatch = {
    ok: false,
    code: 'challenge_purpose_mismatch',
    message: 'Email OTP grant is for another operation',
  };
  const refused = releaseRouter({ consume: mismatch });
  expect(await refused.release({ ...GRANT_BODY, operation: 'export_key' })).toEqual({
    status: 401,
    body: mismatch,
  });
  expect(refused.evaluate.calls).toEqual([]);
});

test('a device with no factor for the wallet is refused before the code is used', async () => {
  const fake = releaseRouter();
  const response = await fake.release({
    ...CODE_BODY,
    deviceFactors: [{ factorNonceB64u: 'nonce-other-device', blindedElementB64u: 'blind-0' }],
  });
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ ok: false, code: 'email_otp_device_factor_missing' });
  expect(fake.verify.calls).toEqual([]);
  expect(fake.consume.calls).toEqual([]);
  expect(fake.evaluate.calls).toEqual([]);
});

test('a factor release refuses a body with other fields, another kind or another operation', async () => {
  const fake = releaseRouter();
  for (const body of [
    { ...CODE_BODY, kind: 'session' },
    { ...CODE_BODY, loginGrant: 'login-grant-1' },
    { ...GRANT_BODY, otpCode: '123456' },
    { ...CODE_BODY, operation: 'registration' },
    { ...CODE_BODY, walletId: 'two words' },
    { ...CODE_BODY, deviceFactors: [{ factorNonceB64u: 'nonce-2' }] },
    { ...CODE_BODY, deviceFactors: [DEVICE_FACTORS[1], DEVICE_FACTORS[1]] },
  ]) {
    const response = await fake.release(body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, code: 'invalid_body' });
  }
  expect(fake.readEnrollment.calls).toEqual([]);

  for (const body of [
    { ...CODE_BODY, otpCode: ' ' },
    { ...CODE_BODY, walletAuthMethodId: '' },
    { ...GRANT_BODY, loginGrant: ' ' },
  ]) {
    const response = await fake.release(body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, code: 'invalid_body' });
  }
  expect(fake.verify.calls).toEqual([]);
  expect(fake.consume.calls).toEqual([]);
});

test('a factor release keeps the status of each refusal', async () => {
  const noEnrollment = { ok: false, code: 'not_found', message: 'No Email OTP enrollment' };
  expect(await releaseRouter({ enrollment: noEnrollment }).release(CODE_BODY)).toEqual({
    status: 404,
    body: noEnrollment,
  });
  for (const [code, status] of [
    ['invalid_otp', 401],
    ['challenge_expired_or_invalid', 401],
    ['rate_limited', 429],
    ['otp_locked_out', 400],
  ] as const) {
    const refusal = { ok: false, code, message: code };
    const fake = releaseRouter({ verify: refusal });
    expect(await fake.release(CODE_BODY)).toEqual({ status, body: refusal });
    expect(fake.consume.calls).toEqual([]);
    expect(fake.evaluate.calls).toEqual([]);
  }
});

function registrationFactorRouter(result: object) {
  const enroll = recordedCalls(result);
  const router = routerWith({ emailOtp: { enrollEmailOtpFactor: enroll.answer } });
  async function call(body: unknown) {
    return await router.call('POST', '/wallet/email-otp/registration/factor', { body });
  }
  return { call, enroll };
}

test('POST /wallet/email-otp/registration/factor enrolls a new factor for the blinded input', async () => {
  const enrolled = { ok: true, factorNonceB64u: 'nonce-new', evaluatedElementB64u: 'evaluated' };
  const fake = registrationFactorRouter(enrolled);
  const body = { walletId: WALLET_ID, enrollmentId: 'enrollment-1', blindedElementB64u: 'blind' };
  expect(await fake.call(body)).toEqual({
    status: 200,
    body: { ...enrolled, walletId: WALLET_ID },
  });
  expect(fake.enroll.calls).toEqual([body]);
});

test('POST /wallet/email-otp/registration/factor refusals keep their statuses', async () => {
  const fake = registrationFactorRouter({ ok: true });
  for (const [body, message] of [
    [
      { walletId: WALLET_ID, enrollmentId: 'enrollment-1', factorNonceB64u: 'nonce-1' },
      'Unsupported field: factorNonceB64u',
    ],
    [{ walletId: WALLET_ID }, 'Missing walletId or enrollmentId'],
    [{ enrollmentId: 'enrollment-1' }, 'Missing walletId or enrollmentId'],
  ] as const) {
    expect(await fake.call(body)).toEqual({
      status: 400,
      body: { ok: false, code: 'invalid_body', message },
    });
  }
  expect(fake.enroll.calls).toEqual([]);

  for (const [code, status] of [
    ['invalid_body', 400],
    ['not_configured', 503],
    ['rate_limited', 429],
    ['internal', 500],
  ] as const) {
    const refusal = { ok: false, code, message: code };
    expect(
      await registrationFactorRouter(refusal).call({
        walletId: WALLET_ID,
        enrollmentId: 'enrollment-1',
        blindedElementB64u: 'blind',
      }),
    ).toEqual({ status, body: refusal });
  }
});
