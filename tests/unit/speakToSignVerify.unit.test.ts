import { expect, test } from '@playwright/test';
import { buildFullOwnerPermissionsV1 } from '@shared/authorization/delegatedAuthority';
import type { NormalizedRouterLogger } from '../../packages/wallet-server/src/router/framework/logger';
import type { RouterApiRouteExtension } from '../../packages/wallet-server/src/router/framework/routeExtensions';
import type { FetchRouterRuntime } from '../../packages/wallet-server/src/router/transport/fetch/fetchRouter.types';
import {
  SPEAK_TO_SIGN_VERIFY_MAX_BODY_BYTES,
  SPEAK_TO_SIGN_VERIFY_PATH,
  createSpeakToSignVerifyRouteExtensions,
  readSpeakToSignVerifyConfig,
  type SpeakToSignVerifyConfig,
  type SpeakToSignVerifyDependencies,
} from '../../packages/wallet-server/src/router/domains/speakToSign/speakToSignVerify';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { buildMpcMaterialActivationRefFixture } from './helpers/ecdsaMaterialRef.fixtures';
import { buildLinkedDeviceManagementAuthorityFixture } from './helpers/linkedDeviceManagement.fixtures';

const PAYMENT_KEY = 'pk_outlayer_secret_do_not_leak_7f3a';
const CONFIG: SpeakToSignVerifyConfig = {
  outlayerBaseUrl: 'https://outlayer.example.test/',
  project: 'seams-v1.testnet/voice-verifier',
  versionKey: 'a'.repeat(64),
  paymentKey: PAYMENT_KEY,
  secretsRef: { profile: 'default', accountId: 'seams-v1.testnet' },
};
const VERIFIER_OUTPUT = {
  verdict_json: '{"kind":"seams_voice_verdict_v1","outcome":"accept"}',
  signature_b64: 'c2lnbmF0dXJl',
  public_key: 'ed25519:Bz1',
  ms: 4120,
};
const OWNER = 'owner-speak.testnet';
const VERIFIER_INPUT = {
  kind: 'seams_voice_verify_input_v1',
  op: 'verify',
  owner: OWNER,
  audio_b64: 'AAAA',
};

type FetchCall = { url: string; init: RequestInit };

async function buildHarness(
  outlayer: (call: FetchCall) => Promise<Response> | Response,
  options: { readonly ownerResolvable?: boolean } = {},
) {
  const walletId = 'wallet:speak-to-sign';
  const materialActivation = buildMpcMaterialActivationRefFixture('speak-to-sign', walletId);
  const fixture = await buildLinkedDeviceManagementAuthorityFixture({
    label: 'speak-to-sign',
    permissions: buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    materialActivation,
    identity: {
      walletId,
      authorityId: 'authority:speak-to-sign',
      walletAuthMethodId: 'wallet-auth-method:speak-to-sign',
      rpId: 'wallet.example.test',
    },
    expiresAtMs: Date.now() + 60_000,
  });
  const session = fixture.issuedSession.session;
  const calls: FetchCall[] = [];
  const logs: unknown[][] = [];
  const record = (...args: unknown[]) => void logs.push(args);
  const logger: NormalizedRouterLogger = { debug: record, info: record, warn: record, error: record };
  const rateLimited: string[] = [];
  const ownerReads: unknown[] = [];
  let allow = true;
  const extensions = createSpeakToSignVerifyRouteExtensions(CONFIG, {
    authorizationSessions: {
      tenantId: session.tenantId,
      async readWalletSessionExactOperationContextByCredential(input) {
        if (input.token !== fixture.operationCredential.token) return null;
        return {
          session,
          authority: fixture.authority,
          authMethod: fixture.authMethod,
          retiredAtMs: null,
          ownerWalletScope: {
            ownershipGeneration: 1,
            orgId: 'org',
            projectId: 'project',
            projectEnvironmentId: 'project:dev',
            walletId: session.walletId,
          },
        };
      },
    },
    walletRegistration: {
      async resolveEd25519MaterialActivation(input) {
        ownerReads.push(input);
        const known =
          options.ownerResolvable !== false &&
          input.walletId === walletId &&
          JSON.stringify(input.materialActivation) ===
            JSON.stringify(routerAbMpcMaterialActivationRefToWire(materialActivation));
        if (!known) return { ok: false, code: 'not_found', message: 'unknown activation' };
        return { ok: true, nearAccountId: OWNER } as Awaited<
          ReturnType<SpeakToSignVerifyDependencies['walletRegistration']['resolveEd25519MaterialActivation']>
        >;
      },
    },
    fetch: (async (url: string, init: RequestInit) => {
      const call = { url: String(url), init };
      calls.push(call);
      return await outlayer(call);
    }) as typeof fetch,
    rateLimit: async ({ walletId }) => {
      rateLimited.push(walletId);
      return { allowed: allow };
    },
  });
  expect(extensions).toHaveLength(1);
  const extension = extensions[0] as RouterApiRouteExtension;
  async function send(body: string, token: string | null = fixture.operationCredential.token) {
    const request = new Request(`https://relay.example.test${SPEAK_TO_SIGN_VERIFY_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
    });
    const response = await extension.handleFetchRoute({
      request,
      route: extension.routes[0],
      pathname: SPEAK_TO_SIGN_VERIFY_PATH,
      method: 'POST',
      logger,
      runtime: {} as FetchRouterRuntime,
    });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) as Record<string, unknown> };
  }
  return {
    send,
    calls,
    logs,
    rateLimited,
    ownerReads,
    walletId: session.walletId,
    denyRateLimit: () => void (allow = false),
  };
}

const okOutlayer = () =>
  Response.json({ status: 'completed', output: VERIFIER_OUTPUT, error: null, job_id: 7 });

function expectNoKey(harness: { logs: unknown[][] }, ...texts: string[]) {
  for (const text of texts) expect(text).not.toContain(PAYMENT_KEY);
  expect(JSON.stringify(harness.logs)).not.toContain(PAYMENT_KEY);
}

test('the route set is absent without config and refuses a partial env', () => {
  expect(readSpeakToSignVerifyConfig(() => undefined)).toBeNull();
  expect(
    createSpeakToSignVerifyRouteExtensions(null, {
      authorizationSessions: {} as never,
      walletRegistration: {} as never,
      fetch: fetch,
    }),
  ).toEqual([]);
  expect(() =>
    readSpeakToSignVerifyConfig((name) =>
      name === 'SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY' ? PAYMENT_KEY : undefined,
    ),
  ).toThrow(/SPEAK_TO_SIGN_OUTLAYER_BASE_URL/);
  const env: Record<string, string> = {
    SPEAK_TO_SIGN_OUTLAYER_BASE_URL: CONFIG.outlayerBaseUrl,
    SPEAK_TO_SIGN_OUTLAYER_PROJECT: CONFIG.project,
    SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY: CONFIG.versionKey,
    SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY: PAYMENT_KEY,
    SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE: 'default',
    SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID: 'seams-v1.testnet',
  };
  expect(readSpeakToSignVerifyConfig((name) => env[name])).toEqual(CONFIG);
});

test('a call without a live Wallet Session never reaches OutLayer', async () => {
  const harness = await buildHarness(okOutlayer);
  const body = JSON.stringify({ input: VERIFIER_INPUT });
  for (const token of [null, 'wst_unknown']) {
    const response = await harness.send(body, token);
    expect(response.status).toBe(401);
    expect(response.json).toEqual({ ok: false, code: 'unauthorized' });
  }
  expect(harness.calls).toHaveLength(0);
  expect(harness.rateLimited).toHaveLength(0);
});

test('the per-wallet limiter runs after auth and can refuse', async () => {
  const harness = await buildHarness(okOutlayer);
  harness.denyRateLimit();
  const response = await harness.send(JSON.stringify({ input: VERIFIER_INPUT }));
  expect(response.status).toBe(429);
  expect(harness.rateLimited).toEqual([harness.walletId]);
  expect(harness.calls).toHaveLength(0);
});

test('a verify input for another owner is refused before OutLayer', async () => {
  const harness = await buildHarness(okOutlayer);
  const others = [
    { ...VERIFIER_INPUT, owner: 'victim.testnet' },
    { ...VERIFIER_INPUT, owner: `${OWNER} ` },
    { ...VERIFIER_INPUT, owner: undefined },
    { ...VERIFIER_INPUT, owner: [OWNER] },
  ];
  for (const input of others) {
    const response = await harness.send(JSON.stringify({ input }));
    expect(response.status).toBe(403);
    expect(response.json).toEqual({ ok: false, code: 'owner_mismatch' });
  }
  expect(harness.calls).toHaveLength(0);
  expect(harness.ownerReads).toHaveLength(others.length);
  expect(harness.ownerReads[0]).toMatchObject({ walletId: harness.walletId });
});

test('a session without a resolvable NEAR account is refused before OutLayer', async () => {
  const harness = await buildHarness(okOutlayer, { ownerResolvable: false });
  const response = await harness.send(JSON.stringify({ input: VERIFIER_INPUT }));
  expect(response.status).toBe(403);
  expect(response.json).toEqual({ ok: false, code: 'owner_unavailable' });
  expect(harness.ownerReads).toHaveLength(1);
  expect(harness.calls).toHaveLength(0);
});

test('an enrollment of three 8 s clips fits the body cap and reaches OutLayer unchanged', async () => {
  const harness = await buildHarness(okOutlayer);
  // 8 s of 16 kHz PCM16 plus the 44-byte header, in standard base64.
  const clip = Buffer.alloc(8 * 16_000 * 2 + 44, 1).toString('base64');
  const authorization = {
    public_key: `ed25519:${'1'.repeat(44)}`,
    signature_b64: 'A'.repeat(86) + '==',
    nonce_b64: 'A'.repeat(43) + '=',
  };
  const input = { op: 'enroll', owner: OWNER, audio_wav_b64: [clip, clip, clip], authorization };
  const response = await harness.send(JSON.stringify({ input }));
  expect(response.status).toBe(200);
  expect(harness.calls).toHaveLength(1);
  expect(JSON.parse(String(harness.calls[0].init.body)).input).toEqual(input);
});

test('a body above the cap or with other fields is refused before OutLayer', async () => {
  const harness = await buildHarness(okOutlayer);
  const padding = 'A'.repeat(SPEAK_TO_SIGN_VERIFY_MAX_BODY_BYTES);
  const tooLarge = await harness.send(JSON.stringify({ input: { audio_b64: padding } }));
  expect(tooLarge.status).toBe(413);
  for (const body of ['not json', '{}', '{"input":"x"}', JSON.stringify({ input: {}, extra: 1 })]) {
    expect((await harness.send(body)).status).toBe(400);
  }
  expect(harness.calls).toHaveLength(0);
});

test('the call forwards the exact OutLayer shape and returns the output unchanged', async () => {
  const harness = await buildHarness(okOutlayer);
  const response = await harness.send(JSON.stringify({ input: VERIFIER_INPUT }));
  expect(response.status).toBe(200);
  expect(response.json.ok).toBe(true);
  expect(response.json.output).toEqual(VERIFIER_OUTPUT);
  expect(Object.keys(response.json).sort()).toEqual(['ok', 'output', 'timing']);
  const timing = response.json.timing as Record<string, unknown>;
  expect(typeof timing.outlayerMs).toBe('number');
  expect(typeof timing.serverMs).toBe('number');

  expect(harness.calls).toHaveLength(1);
  const [call] = harness.calls;
  expect(call.url).toBe('https://outlayer.example.test/call/seams-v1.testnet/voice-verifier');
  expect(call.init.method).toBe('POST');
  const headers = new Headers(call.init.headers);
  expect(headers.get('x-payment-key')).toBe(PAYMENT_KEY);
  expect(headers.get('authorization')).toBeNull();
  const forwarded = JSON.parse(String(call.init.body)) as Record<string, unknown>;
  expect(Object.keys(forwarded).sort()).toEqual([
    'async',
    'input',
    'resource_limits',
    'secrets_ref',
    'version_key',
  ]);
  expect(forwarded.input).toEqual(VERIFIER_INPUT);
  expect(forwarded.async).toBe(false);
  expect(forwarded.version_key).toBe(CONFIG.versionKey);
  expect(forwarded.secrets_ref).toEqual({ profile: 'default', account_id: 'seams-v1.testnet' });
  expect(String(call.init.body)).not.toContain(PAYMENT_KEY);
  expectNoKey(harness, response.text);
});

test('OutLayer failures map to fixed codes without upstream text or the key', async () => {
  const cases: Array<[() => Response | Promise<Response>, number, string]> = [
    [() => new Response(`bad key ${PAYMENT_KEY}`, { status: 401 }), 503, 'verifier_payment_unavailable'],
    [() => new Response('no credit', { status: 402 }), 503, 'verifier_payment_unavailable'],
    [() => new Response('slow down', { status: 429 }), 503, 'verifier_busy'],
    [() => new Response('bad input', { status: 400 }), 502, 'verifier_rejected_request'],
    [() => new Response('boom', { status: 500 }), 502, 'verifier_failed'],
    [() => Response.json({ status: 'failed', output: null, error: `trap ${PAYMENT_KEY}` }), 502, 'verifier_failed'],
    [() => new Response('<html>', { status: 200 }), 502, 'verifier_failed'],
    [() => Promise.reject(new TypeError(`connect ${PAYMENT_KEY}`)), 502, 'verifier_unreachable'],
    [
      () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
      504,
      'verifier_timeout',
    ],
  ];
  for (const [outlayer, status, code] of cases) {
    const harness = await buildHarness(outlayer);
    const response = await harness.send(JSON.stringify({ input: VERIFIER_INPUT }));
    expect(response.status, code).toBe(status);
    expect(response.json).toEqual({ ok: false, code });
    expectNoKey(harness, response.text);
  }
});
