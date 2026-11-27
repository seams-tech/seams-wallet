import { expect, test } from '@playwright/test';
import type { RouterApiPublishableKeyAuthResult } from '../../../packages/mpc-wallet-server/src/router/framework/apiCredentialPorts';
import {
  APP_ORIGIN,
  WALLET_ID,
  recordedCalls,
  routerWith,
  webAuthnAssertion,
} from './routeHarness';

// The passkey and Google login routes. seams-monorepo forwards each of them to the wallet's
// home region: it reads user_id from passkey options, challengeId from passkey verify, and
// account_mode, wallet_id and id_token from Google verify. These checks keep those fields,
// the statuses and the codes.

const PASSKEY_OPTIONS = {
  ok: true,
  challengeId: 'AAAAAAAAAAAAAAAAAAAAAA',
  challengeB64u: 'challenge-bytes',
  credentialIds: ['Y3JlZGVudGlhbC0x'],
  expiresAtMs: 1_900_000_000_000,
};
const ENVIRONMENT_ID = 'project-1:production';
const PUBLISHABLE_KEY = 'pk_live_conformance';

function passkeyRouter(optionsResult: object, verifyResult: object = { ok: true }) {
  const createOptions = recordedCalls(optionsResult);
  const verifyLogin = recordedCalls(verifyResult);
  const router = routerWith({
    webAuthn: {
      createWebAuthnLoginOptions: createOptions.answer,
      verifyWebAuthnLogin: verifyLogin.answer,
    },
  });
  return { router, createOptions, verifyLogin };
}

test('POST /auth/passkey/options passes user_id, rp_id and ttl_ms and returns the challenge', async () => {
  const fake = passkeyRouter(PASSKEY_OPTIONS);
  const response = await fake.router.call('POST', '/auth/passkey/options', {
    body: { user_id: ` ${WALLET_ID} `, rp_id: 'wallet.example.test', ttl_ms: 60_000.7 },
  });
  expect(response).toEqual({ status: 200, body: PASSKEY_OPTIONS });
  expect(fake.createOptions.calls).toEqual([
    { user_id: WALLET_ID, rp_id: 'wallet.example.test', ttl_ms: 60_000 },
  ]);
});

test('POST /auth/passkey/options maps the home and service failures to their statuses', async () => {
  const statuses = {
    wallet_home_unavailable: 503,
    wallet_home_conflict: 409,
    internal: 500,
    unknown_credential: 400,
  };
  for (const [code, status] of Object.entries(statuses)) {
    const failure = { ok: false, code, message: code };
    const fake = passkeyRouter(failure);
    const response = await fake.router.call('POST', '/auth/passkey/options', {
      body: { user_id: WALLET_ID, rp_id: 'wallet.example.test' },
    });
    expect(response).toEqual({ status, body: failure });
  }
});

test('POST /auth/passkey/options refuses a body that is not exact', async () => {
  const fake = passkeyRouter(PASSKEY_OPTIONS);
  const cases = [
    [{ rp_id: 'wallet.example.test' }, 'user_id is required'],
    [{ user_id: WALLET_ID }, 'rp_id is required'],
    [
      { user_id: WALLET_ID, rp_id: 'wallet.example.test', ttl_ms: 0 },
      'ttl_ms must be a positive number',
    ],
    [
      { userId: WALLET_ID, rp_id: 'wallet.example.test' },
      'Unsupported passkey login options field: userId',
    ],
  ] as const;
  for (const [body, message] of cases) {
    expect(await fake.router.call('POST', '/auth/passkey/options', { body })).toEqual({
      status: 400,
      body: { ok: false, code: 'invalid_body', message },
    });
  }
  expect(fake.createOptions.calls).toEqual([]);
});

test('POST /auth/passkey/verify returns only ok and verified, whatever the service returns', async () => {
  const verified = {
    ok: true,
    verified: true,
    userId: WALLET_ID,
    rpId: 'wallet.example.test',
    credentialIdB64u: 'Y3JlZGVudGlhbC0x',
  };
  const fake = passkeyRouter(PASSKEY_OPTIONS, verified);
  const response = await fake.router.call('POST', '/auth/passkey/verify', {
    headers: { origin: APP_ORIGIN },
    body: {
      challengeId: PASSKEY_OPTIONS.challengeId,
      webauthn_authentication: webAuthnAssertion(),
    },
  });
  expect(response).toEqual({ status: 200, body: { ok: true, verified: true } });
  expect(fake.verifyLogin.calls).toEqual([
    {
      challengeId: PASSKEY_OPTIONS.challengeId,
      webauthn_authentication: {
        ...webAuthnAssertion(),
        authenticatorAttachment: null,
        clientExtensionResults: null,
      },
      expected_origin: APP_ORIGIN,
    },
  ]);
});

test('POST /auth/passkey/verify passes a refusal through and needs an Origin header', async () => {
  const refusal = { ok: false, code: 'challenge_expired_or_invalid', message: 'expired' };
  const fake = passkeyRouter(PASSKEY_OPTIONS, refusal);
  const body = {
    challengeId: PASSKEY_OPTIONS.challengeId,
    webauthn_authentication: webAuthnAssertion(),
  };
  expect(
    await fake.router.call('POST', '/auth/passkey/verify', {
      headers: { origin: APP_ORIGIN },
      body,
    }),
  ).toEqual({ status: 400, body: refusal });
  expect(await fake.router.call('POST', '/auth/passkey/verify', { body })).toEqual({
    status: 400,
    body: { ok: false, code: 'invalid_body', message: 'Origin header is required' },
  });
});

test('POST /auth/google/options and /auth/github/options return the public client config', async () => {
  const router = routerWith({
    identity: {
      getGoogleOidcPublicConfig: () => ({ configured: true, clientId: 'google-client' }),
      getGithubOAuthPublicConfig: () => ({ configured: false }),
    },
  });
  expect(await router.call('POST', '/auth/google/options')).toEqual({
    status: 200,
    body: { ok: true, configured: true, clientId: 'google-client' },
  });
  expect(await router.call('POST', '/auth/github/options')).toEqual({
    status: 200,
    body: { ok: true, configured: false },
  });
});

function googleRouter(resolution: object) {
  const authenticate = recordedCalls<RouterApiPublishableKeyAuthResult>({
    ok: true,
    principal: { apiKeyId: 'key-1', orgId: 'org-1', environmentId: ENVIRONMENT_ID, scopes: [] },
  });
  const verifyGoogleLogin = recordedCalls({
    ok: true,
    verified: true,
    providerSubject: 'google-subject-1',
    email: 'alice@example.test',
  });
  const resolveSession = recordedCalls(resolution);
  const router = routerWith(
    {
      identity: {
        verifyGoogleLogin: verifyGoogleLogin.answer,
        resolveGoogleEmailOtpSession: resolveSession.answer,
      },
    },
    {
      publishableKeyAuth: { authenticate: authenticate.answer },
      orgProjectEnv: {
        listEnvironments: async () => [
          {
            id: ENVIRONMENT_ID,
            projectId: 'project-1',
            key: 'production',
            signingRootVersion: 'v1',
          },
        ],
      },
    },
  );
  return { router, authenticate, verifyGoogleLogin, resolveSession };
}

const GOOGLE_LOGIN = {
  id_token: 'google-id-token',
  account_mode: 'login',
  project_environment_id: ENVIRONMENT_ID,
  wallet_id: WALLET_ID,
};

// Only the request fields that seams-monorepo reads and the key scope are fixed here. What the
// resolution answers for an Email OTP wallet is not.
test('POST /auth/google/verify reads id_token, account_mode and wallet_id inside the key environment', async () => {
  const resolution = { ok: true, answer: 'passed through unchanged' };
  const fake = googleRouter(resolution);
  const response = await fake.router.call('POST', '/auth/google/verify', {
    headers: { authorization: `Bearer ${PUBLISHABLE_KEY}`, origin: APP_ORIGIN },
    body: GOOGLE_LOGIN,
  });
  expect(response).toEqual({ status: 200, body: resolution });
  expect(fake.authenticate.calls).toEqual([
    { secret: PUBLISHABLE_KEY, origin: APP_ORIGIN, environmentId: ENVIRONMENT_ID },
  ]);
  expect(fake.verifyGoogleLogin.calls).toEqual([
    expect.objectContaining({ idToken: 'google-id-token' }),
  ]);
  expect(fake.resolveSession.calls).toEqual([
    expect.objectContaining({
      accountMode: 'login',
      loginWalletId: WALLET_ID,
      runtimePolicyScope: {
        orgId: 'org-1',
        projectId: 'project-1',
        envId: 'production',
        signingRootVersion: 'v1',
      },
    }),
  ]);
});

test('POST /auth/google/verify maps a wallet ID collision to 409 and other refusals to 400', async () => {
  for (const [code, status] of [
    ['wallet_id_collision', 409],
    ['wallet_identity_mismatch', 400],
  ] as const) {
    const refusal = { ok: false, code, message: code };
    const fake = googleRouter(refusal);
    const response = await fake.router.call('POST', '/auth/google/verify', {
      headers: { authorization: `Bearer ${PUBLISHABLE_KEY}`, origin: APP_ORIGIN },
      body: GOOGLE_LOGIN,
    });
    expect(response).toEqual({ status, body: refusal });
  }
});

test('POST /auth/google/verify needs a publishable key for its environment', async () => {
  const fake = googleRouter({ ok: true });
  expect(
    await fake.router.call('POST', '/auth/google/verify', {
      headers: { origin: APP_ORIGIN },
      body: GOOGLE_LOGIN,
    }),
  ).toEqual({
    status: 401,
    body: {
      ok: false,
      code: 'unauthorized',
      message: 'Managed runtime scope bootstrap requires a publishable key',
    },
  });
  expect(
    await fake.router.call('POST', '/auth/google/verify', {
      headers: { authorization: `Bearer ${PUBLISHABLE_KEY}` },
      body: GOOGLE_LOGIN,
    }),
  ).toEqual({
    status: 403,
    body: {
      ok: false,
      code: 'forbidden',
      message: 'Managed runtime scope bootstrap requires an Origin header',
    },
  });
  expect(fake.verifyGoogleLogin.calls).toEqual([]);
});

test('POST /auth/google/verify keeps the account mode rules of its body', async () => {
  const fake = googleRouter({ ok: true });
  const cases = [
    [{ ...GOOGLE_LOGIN, account_mode: 'signup' }, 'account_mode must be login or register'],
    [
      { ...GOOGLE_LOGIN, account_mode: 'register' },
      'wallet_id is only valid with account_mode login',
    ],
    [
      { ...GOOGLE_LOGIN, restart_registration_offer: true },
      'restart_registration_offer is only valid with account_mode register',
    ],
    [{ id_token: 'token', account_mode: 'login' }, 'project_environment_id is required'],
  ] as const;
  for (const [body, message] of cases) {
    expect(await fake.router.call('POST', '/auth/google/verify', { body })).toEqual({
      status: 400,
      body: { ok: false, code: 'invalid_body', message },
    });
  }
});
