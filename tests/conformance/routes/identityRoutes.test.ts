import { expect, test } from '@playwright/test';
import {
  APP_ORIGIN,
  OWNER_SESSION_TOKEN,
  SIGNING_ONLY_SESSION_TOKEN,
  WALLET_AUTHORITY_ID,
  WALLET_AUTH_METHOD_ID,
  WALLET_ID,
  bearer,
  recordedCalls,
  routerWith,
  webAuthnAssertion,
} from './routeHarness';

// Google identity list, link and unlink. A link or an unlink needs a full-owner Wallet Session
// and a passkey step-up of the method that opened that session.

const GOOGLE_SUBJECT = 'wallet:google:subject-1';
const STEP_UP = {
  step_up_challenge_id: 'step-up-challenge-1',
  webauthn_authentication: webAuthnAssertion(),
};

function verifiedStepUp(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    verified: true,
    userId: WALLET_ID,
    walletAuthMethodId: WALLET_AUTH_METHOD_ID,
    walletAuthorityId: WALLET_AUTHORITY_ID,
    ...overrides,
  };
}

function identityRouter(stepUpResult: Record<string, unknown> = verifiedStepUp()) {
  const listIdentities = recordedCalls({ ok: true, subjects: [GOOGLE_SUBJECT] });
  const verifyWebAuthnLogin = recordedCalls(stepUpResult);
  const verifyGoogleLogin = recordedCalls({
    ok: true,
    verified: true,
    providerSubject: GOOGLE_SUBJECT,
  });
  const linkIdentity = recordedCalls({ ok: true, movedFromUserId: 'previous-wallet' });
  const unlinkIdentity = recordedCalls({ ok: true });
  const markStrongAuth = recordedCalls({ ok: true, walletId: WALLET_ID });
  const router = routerWith({
    identity: {
      listIdentities: listIdentities.answer,
      verifyGoogleLogin: verifyGoogleLogin.answer,
      linkIdentity: linkIdentity.answer,
      unlinkIdentity: unlinkIdentity.answer,
    },
    webAuthn: { verifyWebAuthnLogin: verifyWebAuthnLogin.answer },
    emailOtp: { markEmailOtpStrongAuthSatisfied: markStrongAuth.answer },
  });
  return {
    router,
    listIdentities,
    verifyWebAuthnLogin,
    verifyGoogleLogin,
    linkIdentity,
    unlinkIdentity,
    markStrongAuth,
  };
}

test('GET /auth/identities lists the subjects of the Wallet Session wallet', async () => {
  const fake = identityRouter();
  const listed = await fake.router.call('GET', '/auth/identities', {
    headers: bearer(SIGNING_ONLY_SESSION_TOKEN),
  });
  expect(listed).toEqual({ status: 200, body: { ok: true, subjects: [GOOGLE_SUBJECT] } });
  expect(fake.listIdentities.calls).toEqual([{ userId: WALLET_ID }]);
});

test('GET /auth/identities refuses a request with no valid Wallet Session', async () => {
  const fake = identityRouter();
  const refused = { ok: false, code: 'unauthorized', message: 'No valid Wallet Session' };
  expect(await fake.router.call('GET', '/auth/identities')).toEqual({ status: 401, body: refused });
  expect(
    await fake.router.call('GET', '/auth/identities', { headers: bearer('unknown-token') }),
  ).toEqual({ status: 401, body: refused });
  expect(fake.listIdentities.calls).toEqual([]);
});

test('POST /auth/link checks the step-up, links the Google subject and lists the identities', async () => {
  const fake = identityRouter();
  const linked = await fake.router.call('POST', '/auth/link', {
    headers: bearer(OWNER_SESSION_TOKEN),
    body: { provider: 'google', id_token: 'google-id-token', ...STEP_UP },
  });
  expect(linked).toEqual({
    status: 200,
    body: {
      ok: true,
      linked: true,
      subject: GOOGLE_SUBJECT,
      movedFromUserId: 'previous-wallet',
      identities: [GOOGLE_SUBJECT],
    },
  });
  expect(fake.verifyWebAuthnLogin.calls).toEqual([
    {
      challengeId: STEP_UP.step_up_challenge_id,
      webauthn_authentication: {
        ...webAuthnAssertion(),
        authenticatorAttachment: null,
        clientExtensionResults: null,
      },
      expected_origin: APP_ORIGIN,
    },
  ]);
  expect(fake.markStrongAuth.calls).toEqual([{ walletId: WALLET_ID }]);
  expect(fake.verifyGoogleLogin.calls).toEqual([{ idToken: 'google-id-token' }]);
  expect(fake.linkIdentity.calls).toEqual([
    { userId: WALLET_ID, subject: GOOGLE_SUBJECT, allowMoveIfSoleIdentity: true },
  ]);
});

test('POST /auth/unlink removes the subject and lists the identities that stay', async () => {
  const fake = identityRouter();
  const unlinked = await fake.router.call('POST', '/auth/unlink', {
    headers: bearer(OWNER_SESSION_TOKEN),
    body: { subject: GOOGLE_SUBJECT, ...STEP_UP },
  });
  expect(unlinked).toEqual({
    status: 200,
    body: { ok: true, unlinked: true, subject: GOOGLE_SUBJECT, identities: [GOOGLE_SUBJECT] },
  });
  expect(fake.unlinkIdentity.calls).toEqual([{ userId: WALLET_ID, subject: GOOGLE_SUBJECT }]);

  const near = await fake.router.call('POST', '/auth/unlink', {
    headers: bearer(OWNER_SESSION_TOKEN),
    body: { subject: 'near:alice.testnet', ...STEP_UP },
  });
  expect(near).toEqual({
    status: 400,
    body: { ok: false, code: 'not_supported', message: 'near: subjects cannot be unlinked' },
  });
});

test('a link or an unlink needs a full-owner Wallet Session', async () => {
  const fake = identityRouter();
  for (const [path, body] of [
    ['/auth/link', { provider: 'google', id_token: 'google-id-token', ...STEP_UP }],
    ['/auth/unlink', { subject: GOOGLE_SUBJECT, ...STEP_UP }],
  ] as const) {
    expect(await fake.router.call('POST', path, { headers: { origin: APP_ORIGIN }, body })).toEqual(
      {
        status: 401,
        body: { ok: false, code: 'unauthorized', message: 'No valid Wallet Session' },
      },
    );
    expect(
      await fake.router.call('POST', path, { headers: bearer(SIGNING_ONLY_SESSION_TOKEN), body }),
    ).toEqual({
      status: 403,
      body: {
        ok: false,
        code: 'forbidden',
        message: 'Full owner authority is required to manage identities',
      },
    });
  }
  expect(fake.verifyWebAuthnLogin.calls).toEqual([]);
  expect(fake.linkIdentity.calls).toEqual([]);
  expect(fake.unlinkIdentity.calls).toEqual([]);
});

test('the step-up must name the Wallet Session wallet, method and authority', async () => {
  const cases = [
    {
      stepUp: verifiedStepUp({ userId: 'another-wallet' }),
      status: 403,
      body: { ok: false, code: 'forbidden', message: 'Step-up user mismatch' },
    },
    {
      stepUp: verifiedStepUp({ walletAuthMethodId: 'another-method' }),
      status: 403,
      body: { ok: false, code: 'forbidden', message: 'Step-up authority mismatch' },
    },
    {
      stepUp: { ok: false, code: 'challenge_expired_or_invalid', message: 'expired' },
      status: 400,
      body: { ok: false, code: 'challenge_expired_or_invalid', message: 'expired' },
    },
    {
      stepUp: { ok: false, code: 'internal', message: 'store down' },
      status: 500,
      body: { ok: false, code: 'internal', message: 'store down' },
    },
  ];
  for (const testCase of cases) {
    const fake = identityRouter(testCase.stepUp);
    const response = await fake.router.call('POST', '/auth/unlink', {
      headers: bearer(OWNER_SESSION_TOKEN),
      body: { subject: GOOGLE_SUBJECT, ...STEP_UP },
    });
    expect(response).toEqual({ status: testCase.status, body: testCase.body });
    expect(fake.markStrongAuth.calls).toEqual([]);
    expect(fake.unlinkIdentity.calls).toEqual([]);
  }
});

test('the link and unlink bodies are exact and need an Origin header', async () => {
  const fake = identityRouter();
  const cases = [
    {
      path: '/auth/link',
      body: { provider: 'github', id_token: 'token', ...STEP_UP },
      message: 'provider must be: google',
    },
    {
      path: '/auth/link',
      body: { provider: 'google', id_token: 'token', wallet_id: WALLET_ID, ...STEP_UP },
      message: 'Unsupported auth link field: wallet_id',
    },
    {
      path: '/auth/unlink',
      body: { subject: GOOGLE_SUBJECT, step_up_challenge_id: 'step-up-challenge-1' },
      message: 'webauthn_authentication is required for step-up',
    },
  ];
  for (const testCase of cases) {
    expect(
      await fake.router.call('POST', testCase.path, {
        headers: bearer(OWNER_SESSION_TOKEN),
        body: testCase.body,
      }),
    ).toEqual({
      status: 400,
      body: { ok: false, code: 'invalid_body', message: testCase.message },
    });
  }
  expect(
    await fake.router.call('POST', '/auth/unlink', {
      headers: { authorization: `Bearer ${OWNER_SESSION_TOKEN}` },
      body: { subject: GOOGLE_SUBJECT, ...STEP_UP },
    }),
  ).toEqual({
    status: 400,
    body: { ok: false, code: 'invalid_body', message: 'Origin header is required' },
  });
});
