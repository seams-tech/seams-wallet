import { expect, test } from '@playwright/test';
import { APP_ORIGIN, recordedCalls, routerWith } from './routeHarness';

// The Email OTP challenge send and the dev outbox. seams-monorepo reads walletId from both
// bodies to find the wallet's home region. The factor release and the seal routes are left out
// on purpose: the Email OTP device-factor change (docs/refactor-252-email-otp-device-factor.md)
// changes their wire.

const WALLET_ID = 'email-otp-wallet-1';
const CHALLENGE_BODY = {
  walletId: WALLET_ID,
  walletAuthMethodId: 'email-otp-method-1',
  otpChannel: 'email_otp',
  operation: 'wallet_unlock',
};

function challengeRouter(enrollment: object) {
  const readEnrollment = recordedCalls(enrollment);
  const router = routerWith({
    emailOtp: { readActiveEmailOtpEnrollment: readEnrollment.answer },
  });
  return { router, readEnrollment };
}

test('POST /wallet/email-otp/challenge looks up the enrollment of the body walletId', async () => {
  const refusal = { ok: false, code: 'not_found', message: 'No Email OTP enrollment' };
  const fake = challengeRouter(refusal);
  expect(
    await fake.router.call('POST', '/wallet/email-otp/challenge', {
      headers: { origin: APP_ORIGIN },
      body: CHALLENGE_BODY,
    }),
  ).toEqual({ status: 404, body: refusal });
  expect(fake.readEnrollment.calls).toEqual([{ walletId: WALLET_ID, orgId: 'conformance-tenant' }]);
});

test('POST /wallet/email-otp/challenge maps an enrollment refusal to its status', async () => {
  const statuses = {
    internal: 500,
    not_configured: 503,
    rate_limited: 429,
    stronger_auth_required: 403,
    reenrollment_required: 409,
    challenge_expired_or_invalid: 401,
    invalid_body: 400,
  };
  for (const [code, status] of Object.entries(statuses)) {
    const refusal = { ok: false, code, message: code };
    const fake = challengeRouter(refusal);
    expect(
      await fake.router.call('POST', '/wallet/email-otp/challenge', {
        headers: { origin: APP_ORIGIN },
        body: CHALLENGE_BODY,
      }),
    ).toEqual({ status, body: refusal });
  }
});

test('POST /wallet/email-otp/challenge refuses a body without a valid walletId or Origin', async () => {
  const fake = challengeRouter({ ok: false, code: 'not_found', message: 'unused' });
  for (const [headers, body] of [
    [{}, CHALLENGE_BODY],
    [{ origin: APP_ORIGIN }, { ...CHALLENGE_BODY, walletId: 'two words' }],
    [{ origin: APP_ORIGIN }, { ...CHALLENGE_BODY, otpChannel: 'sms' }],
    [{ origin: APP_ORIGIN }, { ...CHALLENGE_BODY, operation: 'registration' }],
    [{ origin: APP_ORIGIN }, { ...CHALLENGE_BODY, email: 'alice@example.test' }],
  ] as const) {
    const response = await fake.router.call('POST', '/wallet/email-otp/challenge', {
      headers,
      body,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, code: 'invalid_body' });
  }
  expect(fake.readEnrollment.calls).toEqual([]);
});

function outboxRouter(google: object, entry: object = { ok: true }) {
  const verifyGoogleLogin = recordedCalls(google);
  const readOutbox = recordedCalls(entry);
  const router = routerWith({
    emailOtp: {
      verifyGoogleLogin: verifyGoogleLogin.answer,
      readEmailOtpOutboxEntry: readOutbox.answer,
    },
  });
  return { router, verifyGoogleLogin, readOutbox };
}

const GOOGLE_VERIFIED = {
  ok: true,
  verified: true,
  userId: 'google-user',
  providerSubject: 'google-subject-1',
};

test('POST /wallet/email-otp/dev/otp-outbox reads the entry of the wallet and the Google subject', async () => {
  const entry = { ok: true, entry: { challengeId: 'challenge-1' } };
  const fake = outboxRouter(GOOGLE_VERIFIED, entry);
  expect(
    await fake.router.call('POST', '/wallet/email-otp/dev/otp-outbox', {
      body: { idToken: 'google-id-token', walletId: WALLET_ID },
    }),
  ).toEqual({ status: 200, body: entry });
  // A test harness may name the exact challenge and its subject.
  await fake.router.call('POST', '/wallet/email-otp/dev/otp-outbox', {
    body: {
      idToken: 'google-id-token',
      walletId: WALLET_ID,
      challengeId: 'challenge-2',
      challengeSubjectId: 'alice@example.test',
    },
  });
  expect(fake.verifyGoogleLogin.calls).toEqual([
    { idToken: 'google-id-token' },
    { idToken: 'google-id-token' },
  ]);
  expect(fake.readOutbox.calls).toEqual([
    { userId: 'google-subject-1', walletId: WALLET_ID },
    { userId: 'alice@example.test', walletId: WALLET_ID, challengeId: 'challenge-2' },
  ]);
});

test('POST /wallet/email-otp/dev/otp-outbox refusals keep their statuses', async () => {
  const fake = outboxRouter(GOOGLE_VERIFIED);
  const invalid = [
    [{ idToken: 'token', walletId: WALLET_ID, email: 'a' }, 'Unsupported field: email'],
    [{ idToken: 'token' }, 'Missing idToken or walletId'],
    [
      { idToken: 'token', walletId: WALLET_ID, challengeSubjectId: 'alice@example.test' },
      'challengeSubjectId requires the exact challengeId it belongs to',
    ],
  ] as const;
  for (const [body, message] of invalid) {
    expect(await fake.router.call('POST', '/wallet/email-otp/dev/otp-outbox', { body })).toEqual({
      status: 400,
      body: { ok: false, code: 'invalid_body', message },
    });
  }
  expect(fake.verifyGoogleLogin.calls).toEqual([]);

  for (const [code, status] of [
    ['internal', 500],
    ['not_configured', 501],
    ['invalid_token', 401],
  ] as const) {
    const refused = outboxRouter({ ok: false, code, message: code });
    expect(
      await refused.router.call('POST', '/wallet/email-otp/dev/otp-outbox', {
        body: { idToken: 'token', walletId: WALLET_ID },
      }),
    ).toEqual({ status, body: { ok: false, code, message: code } });
  }
});
