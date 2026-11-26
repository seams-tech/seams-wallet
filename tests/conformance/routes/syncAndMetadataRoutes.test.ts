import { expect, test } from '@playwright/test';
import { secureRandomBase64Url } from '../../../packages/shared-ts/src/utils/secureRandomId';
import { WalletLifecycleLocator } from '../../../packages/mpc-wallet-server/src/authorization/lifecycleRouting';
import { webAuthnCredentialIdB64uFromCredential } from '../../../packages/mpc-wallet-server/src/router/auth/webAuthnCredentialCodecs';
import {
  APP_ORIGIN,
  SIGNING_ONLY_SESSION_TOKEN,
  WALLET_ID,
  bearer,
  recordedCalls,
  routerWith,
  webAuthnAssertion,
} from './routeHarness';

// Sync account, the WebAuthn metadata routes, and the passkey challenge ID that seams-monorepo
// parses to find a wallet's home region. A full sync verify that mints a Wallet Session needs a
// registered wallet; the old-API journeys cover it.

const SYNC_OPTIONS = {
  ok: true,
  challengeId: 'AAAAAAAAAAAAAAAAAAAAAA',
  challengeB64u: 'challenge-bytes',
  credentialIds: ['Y3JlZGVudGlhbC0x'],
  expiresAtMs: 1_900_000_000_000,
};
const SYNC_VERIFY_BODY = {
  challengeId: SYNC_OPTIONS.challengeId,
  webauthn_authentication: webAuthnAssertion(),
};

function syncRouter(optionsResult: object, verifyResult: object = { ok: true }) {
  const createOptions = recordedCalls(optionsResult);
  const verifySync = recordedCalls(verifyResult);
  const router = routerWith({
    webAuthn: {
      createWebAuthnSyncAccountOptions: createOptions.answer,
      verifyWebAuthnSyncAccount: verifySync.answer,
    },
  });
  return { router, createOptions, verifySync };
}

const SYNC_FAILURE_STATUSES = {
  wallet_home_unavailable: 503,
  wallet_home_conflict: 409,
  ed25519_not_provisioned: 409,
  internal: 500,
  unknown_credential: 400,
};

test('POST /sync-account/options passes rp_id, account_id and ttl_ms and returns the challenge', async () => {
  const fake = syncRouter(SYNC_OPTIONS);
  expect(
    await fake.router.call('POST', '/sync-account/options', {
      body: { rp_id: 'wallet.example.test', account_id: WALLET_ID, ttl_ms: 30_000 },
    }),
  ).toEqual({ status: 200, body: SYNC_OPTIONS });
  // Without account_id the options are discoverable, and seams-monorepo routes them locally.
  await fake.router.call('POST', '/sync-account/options', {
    body: { rp_id: 'wallet.example.test' },
  });
  expect(fake.createOptions.calls).toEqual([
    { rp_id: 'wallet.example.test', account_id: WALLET_ID, ttl_ms: 30_000 },
    { rp_id: 'wallet.example.test' },
  ]);
});

test('the sync routes map each service failure to its status', async () => {
  for (const [code, status] of Object.entries(SYNC_FAILURE_STATUSES)) {
    const failure = { ok: false, code, message: code };
    const fake = syncRouter(failure, failure);
    expect(
      await fake.router.call('POST', '/sync-account/options', {
        body: { rp_id: 'wallet.example.test' },
      }),
    ).toEqual({ status, body: failure });
    expect(
      await fake.router.call('POST', '/sync-account/verify', {
        headers: { origin: APP_ORIGIN },
        body: SYNC_VERIFY_BODY,
      }),
    ).toEqual({ status, body: failure });
  }
});

test('the sync bodies are exact, and verify needs an Origin header', async () => {
  const fake = syncRouter(SYNC_OPTIONS);
  const cases = [
    ['/sync-account/options', { account_id: WALLET_ID }, 'rp_id is required'],
    [
      '/sync-account/options',
      { rp_id: 'wallet.example.test', user_id: WALLET_ID },
      'Unsupported sync-account options field: user_id',
    ],
    [
      '/sync-account/verify',
      { ...SYNC_VERIFY_BODY, walletId: WALLET_ID },
      'Unsupported sync-account verify field: walletId',
    ],
    ['/sync-account/verify', { challengeId: 'c' }, 'webauthn_authentication is required'],
  ] as const;
  for (const [path, body, message] of cases) {
    expect(await fake.router.call('POST', path, { headers: { origin: APP_ORIGIN }, body })).toEqual(
      { status: 400, body: { ok: false, code: 'invalid_body', message } },
    );
  }
  expect(
    await fake.router.call('POST', '/sync-account/verify', { body: SYNC_VERIFY_BODY }),
  ).toEqual({
    status: 400,
    body: { ok: false, code: 'invalid_body', message: 'Origin header is required' },
  });
  expect(fake.verifySync.calls).toEqual([]);
});

test('a verified sync with no key manifest is a server error, not a client error', async () => {
  const fake = syncRouter(SYNC_OPTIONS, {
    ok: true,
    verified: true,
    thresholdEd25519: { kind: 'present' },
  });
  expect(
    await fake.router.call('POST', '/sync-account/verify', {
      headers: { origin: APP_ORIGIN },
      body: SYNC_VERIFY_BODY,
    }),
  ).toEqual({
    status: 500,
    body: {
      ok: false,
      code: 'internal',
      message: 'Sync verification did not resolve the wallet key manifest',
    },
  });
});

test('a passkey challenge ID is 22 base64url characters, as seams-monorepo parses it', () => {
  const challengeId = secureRandomBase64Url(16, 'WebAuthn login challenge id');
  expect(challengeId).toMatch(/^[A-Za-z0-9_-]{22}$/u);
  const locator = WalletLifecycleLocator.parse({ kind: 'passkey_challenge', value: challengeId });
  expect(locator.value).toBe(challengeId);
  for (const value of [challengeId.slice(1), `${challengeId}=`, 'A'.repeat(23)]) {
    expect(() => WalletLifecycleLocator.parse({ kind: 'passkey_challenge', value })).toThrow();
  }
});

test('the sync discovery credential ID prefers rawId and is always base64url', () => {
  expect(webAuthnCredentialIdB64uFromCredential({ id: 'aWQ', rawId: 'cmF3+/8=' })).toEqual({
    ok: true,
    credentialIdB64u: 'cmF3-_8',
  });
  expect(webAuthnCredentialIdB64uFromCredential({ id: 'aWQ' })).toEqual({
    ok: true,
    credentialIdB64u: 'aWQ',
  });
  expect(webAuthnCredentialIdB64uFromCredential({})).toEqual({
    ok: false,
    code: 'invalid_body',
    message: 'Missing webauthn_authentication.id/rawId',
  });
});

test('GET /.well-known/webauthn lists the related origins of the RP ID', async () => {
  const askedFor: unknown[] = [];
  const router = routerWith(
    {},
    {
      ror: {
        rpIdByHost: { 'gateway.example.test': 'wallet.example.test' },
        provider: {
          async getAllowedOrigins(input) {
            askedFor.push(input);
            return [APP_ORIGIN, `${APP_ORIGIN}/`, 'not an origin', 'https://other.example.test'];
          },
        },
      },
    },
  );
  for (const path of ['/.well-known/webauthn', '/.well-known/webauthn/']) {
    const response = await router.send('GET', path);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('max-age=60, stale-while-revalidate=600');
    expect(await response.json()).toEqual({
      origins: [APP_ORIGIN, 'https://other.example.test'],
      capabilities: { signingSessionSeal: { mode: 'none' } },
    });
  }
  expect(askedFor[0]).toEqual({ rpId: 'wallet.example.test', host: 'gateway.example.test' });
});

test('GET /.well-known/webauthn answers an empty list with no ROR config or a failed provider', async () => {
  const empty = { origins: [], capabilities: { signingSessionSeal: { mode: 'none' } } };
  expect(await routerWith({}).call('GET', '/.well-known/webauthn')).toEqual({
    status: 200,
    body: empty,
  });
  const failing = routerWith(
    {},
    {
      ror: {
        rpId: 'wallet.example.test',
        provider: {
          getAllowedOrigins: async () => {
            throw new Error('Console unavailable');
          },
        },
      },
    },
  );
  expect(await failing.call('GET', '/.well-known/webauthn')).toEqual({ status: 200, body: empty });
});

function authenticatorsRouter(result: object | Error) {
  const list = recordedCalls(result);
  const router = routerWith({
    webAuthn: {
      async listWebAuthnAuthenticatorsForUser(input: unknown) {
        const answer = await list.answer(input);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  });
  return { router, list };
}

test('GET /webauthn/authenticators lists the passkeys of the Wallet Session wallet', async () => {
  const listed = {
    ok: true,
    authenticators: [
      {
        credentialIdB64u: 'Y3JlZGVudGlhbC0x',
        signerSlot: 1,
        device: { kind: 'unknown', label: 'Unknown device' },
      },
    ],
  };
  const fake = authenticatorsRouter(listed);
  const headers = bearer(SIGNING_ONLY_SESSION_TOKEN);
  expect(await fake.router.call('GET', '/webauthn/authenticators', { headers })).toEqual({
    status: 200,
    body: listed,
  });
  await fake.router.call('GET', '/webauthn/authenticators?rp_id=wallet.example.test', { headers });
  await fake.router.call('GET', '/webauthn/authenticators?rpId=a.example.test&rp_id=b', {
    headers,
  });
  expect(fake.list.calls).toEqual([
    { userId: WALLET_ID },
    { userId: WALLET_ID, rpId: 'wallet.example.test' },
    { userId: WALLET_ID, rpId: 'a.example.test' },
  ]);
});

test('GET /webauthn/authenticators refusals and failures keep their statuses', async () => {
  const fake = authenticatorsRouter({ ok: true, authenticators: [] });
  expect(await fake.router.call('GET', '/webauthn/authenticators')).toEqual({
    status: 401,
    body: { ok: false, code: 'unauthorized', message: 'No valid Wallet Session' },
  });
  const failures = [
    [{ ok: false, code: 'not_supported', message: 'm' }, 501],
    [{ ok: false, code: 'invalid_args', message: 'm' }, 400],
    [{ ok: false, code: 'store_error', message: 'm' }, 500],
  ] as const;
  const headers = bearer(SIGNING_ONLY_SESSION_TOKEN);
  for (const [failure, status] of failures) {
    const failed = authenticatorsRouter(failure);
    expect(await failed.router.call('GET', '/webauthn/authenticators', { headers })).toEqual({
      status,
      body: failure,
    });
  }
  const thrown = authenticatorsRouter(new Error('D1 unavailable'));
  expect(await thrown.router.call('GET', '/webauthn/authenticators', { headers })).toEqual({
    status: 500,
    body: { ok: false, code: 'internal', message: 'D1 unavailable' },
  });
});
