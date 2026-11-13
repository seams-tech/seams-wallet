import { readFileSync } from 'node:fs';
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
import {
  readSpeakToSignSummaryConfig,
  SPEAK_TO_SIGN_SUMMARY_PATH,
  type SpeakToSignSummaryConfig,
} from '../../packages/wallet-server/src/router/domains/speakToSign/speakToSignSummary';
import type {
  VerifierAttestation,
  VerifierAttestationCall,
} from '../../packages/wallet-server/src/router/domains/speakToSign/speakToSignAttestation';
import type { TranscriberChoice } from '../../packages/wallet-server/src/router/domains/speakToSign/speakToSignTranscriber';
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
const VENICE_KEY = 'b'.repeat(64);
const VENICE_CONFIG: SpeakToSignVerifyConfig = { ...CONFIG, veniceVersionKey: VENICE_KEY };
const VERIFIER_OUTPUT = {
  kind: 'seams_voice_verify_output_v2',
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

const CALL_ID = '304f41ef-1c01-42df-90b6-11bee354ae75';
const ATTESTATION_URL = `/attestations/by-call/${CALL_ID}`;

type FetchCall = { url: string; init: RequestInit };

async function buildHarness(
  outlayer: (call: FetchCall) => Promise<Response> | Response,
  options: {
    readonly ownerResolvable?: boolean;
    /** The NEAR AI config of the summary route. Without it, the route set has no summary route. */
    readonly summary?: SpeakToSignSummaryConfig;
    /** `server`: the server's own TDX quote check. Default: a check that passes. */
    readonly attestation?: Pick<VerifierAttestation, 'check'> | 'server';
    /** Default: CONFIG, with no `venice` build. */
    readonly config?: SpeakToSignVerifyConfig;
    /** The choice of the speech-to-text service. Default: the server's own choice. */
    readonly transcriber?: Pick<TranscriberChoice, 'choose'>;
  } = {},
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
  const attested: VerifierAttestationCall[] = [];
  const passingAttestation: Pick<VerifierAttestation, 'check'> = {
    async check(call) {
      attested.push(call);
      return { ok: true, tcbStatus: 'UpToDate', recordMs: 1_200, attestationMs: 1_450 };
    },
  };
  let allow = true;
  const extensions = createSpeakToSignVerifyRouteExtensions(options.config ?? CONFIG, {
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
    ...(options.attestation === 'server'
      ? {}
      : { attestation: options.attestation ?? passingAttestation }),
    ...(options.transcriber ? { transcriber: options.transcriber } : {}),
  }, options.summary ?? null);
  expect(extensions).toHaveLength(1);
  const extension = extensions[0] as RouterApiRouteExtension;
  async function send(
    body: string,
    token: string | null = fixture.operationCredential.token,
    path: string = SPEAK_TO_SIGN_VERIFY_PATH,
  ) {
    const route = extension.routes.find((candidate) => candidate.path === path);
    if (!route) throw new Error(`The route set has no ${path}`);
    const request = new Request(`https://relay.example.test${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
    });
    const response = await extension.handleFetchRoute({
      request,
      route,
      pathname: path,
      method: 'POST',
      logger,
      runtime: {} as FetchRouterRuntime,
    });
    const text = await response.text();
    if (response.headers.get('content-type') !== 'text/event-stream') {
      const json = JSON.parse(text) as Record<string, unknown>;
      return { status: response.status, text, events: null, json };
    }
    // A verifier call answers with a stream; `json` is the data of its last event.
    const events = verifyEvents(text);
    return { status: response.status, text, events, json: events.at(-1)?.data ?? {} };
  }
  return {
    send,
    routes: extension.routes.map((route) => route.path),
    calls,
    logs,
    rateLimited,
    ownerReads,
    attested,
    walletId: session.walletId,
    denyRateLimit: () => void (allow = false),
  };
}

/** The events of a `text/event-stream` answer, in order. */
function verifyEvents(text: string): Array<{ event: string; data: Record<string, unknown> }> {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');
      expect(eventLine.startsWith('event: ') && dataLine.startsWith('data: '), block).toBe(true);
      return {
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>,
      };
    });
}

const okOutlayer = () =>
  Response.json({
    status: 'completed',
    output: VERIFIER_OUTPUT,
    error: null,
    job_id: 7,
    call_id: CALL_ID,
    attestation_url: ATTESTATION_URL,
  });

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
  // The `venice` build is optional, apart from the set of six.
  expect(
    readSpeakToSignVerifyConfig((name) =>
      name === 'SPEAK_TO_SIGN_OUTLAYER_VENICE_VERSION_KEY' ? VENICE_KEY : env[name],
    ),
  ).toEqual(VENICE_CONFIG);
  // A venice key that is not another WASM hash stops the server at start.
  for (const veniceVersionKey of ['venice', CONFIG.versionKey]) {
    expect(() =>
      createSpeakToSignVerifyRouteExtensions(
        { ...CONFIG, veniceVersionKey },
        { authorizationSessions: {} as never, walletRegistration: {} as never, fetch },
      ),
    ).toThrow(/venice version key/);
  }
});

test('a Venice call runs the venice build, and its quote must name that build', async () => {
  const harness = await buildHarness(okOutlayer, {
    config: VENICE_CONFIG,
    transcriber: { choose: async () => 'venice' },
  });
  const response = await harness.send(JSON.stringify({ input: VERIFIER_INPUT }));
  expect(response.events?.map((entry) => entry.event)).toEqual(['verifier_running', 'verdict']);
  expect(response.json.transcriber).toBe('venice');
  const forwarded = JSON.parse(String(harness.calls[0].init.body)) as Record<string, unknown>;
  expect(forwarded.version_key).toBe(VENICE_KEY);
  expect(forwarded.input).toEqual(VERIFIER_INPUT);
  expect(harness.attested.map((call) => call.versionKey)).toEqual([VENICE_KEY]);
  expect(JSON.stringify(harness.logs)).toContain('"transcriber":"venice"');

  // NEAR AI, with the same config: the default build and its own hash.
  const nearAi = await buildHarness(okOutlayer, {
    config: VENICE_CONFIG,
    transcriber: { choose: async () => 'nearai' },
  });
  const usual = await nearAi.send(JSON.stringify({ input: VERIFIER_INPUT }));
  expect(usual.json.transcriber).toBe('nearai');
  expect(JSON.parse(String(nearAi.calls[0].init.body)).version_key).toBe(CONFIG.versionKey);
  expect(nearAi.attested.map((call) => call.versionKey)).toEqual([CONFIG.versionKey]);
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

test('an operation other than verify and enroll is refused before OutLayer', async () => {
  const harness = await buildHarness(okOutlayer);
  const operations = ['transcribe', 'select', 'detect', 'audio_key', undefined, ['verify']];
  for (const op of operations) {
    const response = await harness.send(JSON.stringify({ input: { ...VERIFIER_INPUT, op } }));
    expect(response.status, String(op)).toBe(400);
    expect(response.json).toEqual({ ok: false, code: 'unsupported_operation' });
  }
  expect(harness.calls).toHaveLength(0);
  expect(harness.ownerReads).toHaveLength(0);
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

test('the verdict names the full URL of the OutLayer attestation record of the call', async () => {
  const call = '357b87bb-c366-4327-8f09-eff79a722877';
  const harness = await buildHarness(() =>
    Response.json({
      status: 'completed',
      output: VERIFIER_OUTPUT,
      error: null,
      job_id: 7,
      attestation_url: `/attestations/by-call/${call}`,
    }),
  );
  const response = await harness.send(JSON.stringify({ input: VERIFIER_INPUT }));
  expect(response.json.attestationUrl).toBe(`https://outlayer.example.test/attestations/by-call/${call}`);
  // Any other path is not a record of a call.
  const other = await buildHarness(() =>
    Response.json({ status: 'completed', output: VERIFIER_OUTPUT, error: null, attestation_url: 'https://elsewhere.test/x' }),
  );
  expect((await other.send(JSON.stringify({ input: VERIFIER_INPUT }))).json.attestationUrl).toBeNull();
});

test('the call forwards the exact OutLayer shape and returns the output unchanged', async () => {
  const harness = await buildHarness(okOutlayer);
  const response = await harness.send(JSON.stringify({ input: VERIFIER_INPUT }));
  expect(response.status).toBe(200);
  expect(response.events?.map((entry) => entry.event)).toEqual(['verifier_running', 'verdict']);
  expect(response.events?.[0].data).toEqual({});
  expect(response.json.ok).toBe(true);
  expect(response.json.output).toEqual(VERIFIER_OUTPUT);
  expect(Object.keys(response.json).sort()).toEqual([
    'attestationUrl',
    'ok',
    'output',
    'timing',
    'transcriber',
  ]);
  // Without a `venice` build, NEAR AI serves each call.
  expect(response.json.transcriber).toBe('nearai');
  expect(response.json.attestationUrl).toBe(`https://outlayer.example.test${ATTESTATION_URL}`);
  const timing = response.json.timing as Record<string, unknown>;
  expect(typeof timing.outlayerMs).toBe('number');
  expect(timing.attestationMs).toBe(1_450);
  expect(typeof timing.serverMs).toBe('number');
  // The route checks the quote of this call before it sends the output.
  expect(harness.attested).toEqual([
    { output: VERIFIER_OUTPUT, attestationUrl: ATTESTATION_URL, versionKey: CONFIG.versionKey },
  ]);
  expect(JSON.stringify(harness.logs)).toContain('verifier attestation checked');

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
  // The stream has started when the verifier fails, so each failure is a `failed` event.
  const cases: Array<[() => Response | Promise<Response>, string]> = [
    [() => new Response(`bad key ${PAYMENT_KEY}`, { status: 401 }), 'verifier_payment_unavailable'],
    [() => new Response('no credit', { status: 402 }), 'verifier_payment_unavailable'],
    [() => new Response('slow down', { status: 429 }), 'verifier_busy'],
    [() => new Response('bad input', { status: 400 }), 'verifier_rejected_request'],
    [() => new Response('boom', { status: 500 }), 'verifier_failed'],
    [() => Response.json({ status: 'failed', output: null, error: `trap ${PAYMENT_KEY}` }), 'verifier_failed'],
    [() => new Response('<html>', { status: 200 }), 'verifier_failed'],
    // An error output of the verifier is no verdict: the route does not forward it.
    [
      () => Response.json({ status: 'completed', output: { kind: 'seams_voice_error_v1', detail: 'no op' } }),
      'verifier_failed',
    ],
    [() => Promise.reject(new TypeError(`connect ${PAYMENT_KEY}`)), 'verifier_unreachable'],
    [() => Promise.reject(new DOMException('timed out', 'TimeoutError')), 'verifier_timeout'],
  ];
  for (const [outlayer, code] of cases) {
    const harness = await buildHarness(outlayer);
    const response = await harness.send(JSON.stringify({ input: VERIFIER_INPUT }));
    expect(response.status, code).toBe(200);
    expect(response.events?.map((entry) => entry.event), code).toEqual(['verifier_running', 'failed']);
    expect(response.json).toEqual({ ok: false, code });
    expectNoKey(harness, response.text);
  }
});

test('the server check refuses an output that the TDX quote of the call does not bind', async () => {
  // A real record of OutLayer testnet. Its quote binds another output than VERIFIER_OUTPUT.
  const { record } = JSON.parse(
    readFileSync(
      new URL('../fixtures/outlayer-attestation/outlayer_attestation_0_11_0.json', import.meta.url),
      'utf8',
    ),
  ) as { record: Record<string, unknown> };
  const cases: Array<[() => Response, string]> = [
    [okOutlayer, 'attestation_output_mismatch'],
    [() => Response.json({ status: 'completed', output: VERIFIER_OUTPUT }), 'attestation_missing'],
  ];
  for (const [reply, code] of cases) {
    const harness = await buildHarness(
      ({ url }) => (url.endsWith(ATTESTATION_URL) ? Response.json(record) : reply()),
      { attestation: 'server' },
    );
    const response = await harness.send(JSON.stringify({ input: VERIFIER_INPUT }));
    expect(response.events?.map((entry) => entry.event), code).toEqual(['verifier_running', 'failed']);
    expect(response.json).toEqual({ ok: false, code });
    expect(response.text).not.toContain('verdict_json');
    // The record read carries no payment key.
    for (const call of harness.calls.slice(1)) {
      expect(call.url).toBe(`https://outlayer.example.test${ATTESTATION_URL}`);
      expect(new Headers(call.init.headers).get('x-payment-key')).toBeNull();
    }
    const refusal = harness.logs.find((entry) => entry[0] === '[speak-to-sign] verifier attestation refused');
    expect(Object.keys(refusal?.[1] as object).sort()).toEqual([
      'attestationMs',
      'code',
      'recordMs',
      'transcriber',
    ]);
    expectNoKey(harness, response.text);
  }
});

test('a refused attestation sends a failed event with its code and no verdict', async () => {
  const harness = await buildHarness(okOutlayer, {
    attestation: {
      check: async () => ({
        ok: false,
        code: 'attestation_wasm_not_accepted',
        recordMs: 900,
        attestationMs: 950,
      }),
    },
  });
  const response = await harness.send(JSON.stringify({ input: VERIFIER_INPUT }));
  expect(response.events?.map((entry) => entry.event)).toEqual(['verifier_running', 'failed']);
  expect(response.json).toEqual({ ok: false, code: 'attestation_wasm_not_accepted' });
  expect(response.text).not.toContain(VERIFIER_OUTPUT.verdict_json);
  expect(harness.logs).toContainEqual([
    '[speak-to-sign] verifier attestation refused',
    {
      code: 'attestation_wasm_not_accepted',
      transcriber: 'nearai',
      recordMs: 900,
      attestationMs: 950,
    },
  ]);
  expectNoKey(harness, response.text);
});

const NEAR_AI_KEY = 'nearai_secret_do_not_leak_91c2';
const SUMMARY: SpeakToSignSummaryConfig = { apiKey: NEAR_AI_KEY, model: 'Qwen/Qwen3.8-27B' };
const NOTE = 'The bridge is not closed. One lane closes for two weeks in March, says the city.';
const chat = (content: string) => Response.json({ choices: [{ message: { content } }] });

test('the summary route exists only with a NEAR AI key, and its model has a default', async () => {
  expect(readSpeakToSignSummaryConfig(() => undefined)).toBeNull();
  expect(readSpeakToSignSummaryConfig((name) => (name === 'SPEAK_TO_SIGN_NEAR_AI_API_KEY' ? NEAR_AI_KEY : undefined))).toEqual(SUMMARY);
  expect(
    readSpeakToSignSummaryConfig((name) =>
      name === 'SPEAK_TO_SIGN_NEAR_AI_API_KEY' ? NEAR_AI_KEY : 'Qwen/Qwen3.6-35B-A3B-FP8',
    ),
  ).toEqual({ apiKey: NEAR_AI_KEY, model: 'Qwen/Qwen3.6-35B-A3B-FP8' });
  expect((await buildHarness(okOutlayer)).routes).toEqual([SPEAK_TO_SIGN_VERIFY_PATH]);
  expect((await buildHarness(okOutlayer, { summary: SUMMARY })).routes).toEqual([
    SPEAK_TO_SIGN_VERIFY_PATH,
    SPEAK_TO_SIGN_SUMMARY_PATH,
  ]);
});

test('the summary route writes a speakable summary of the note with the model, thinking off', async () => {
  const harness = await buildHarness(() => chat('Summary: "One lane of the bridge closes in March."'), {
    summary: SUMMARY,
  });
  const answer = await harness.send(JSON.stringify({ text: NOTE }), undefined, SPEAK_TO_SIGN_SUMMARY_PATH);
  expect(answer).toMatchObject({ status: 200, json: { ok: true, summary: 'One lane of the bridge closes in March' } });
  expect(harness.calls).toHaveLength(1);
  const [call] = harness.calls;
  expect(call.url).toBe('https://cloud-api.near.ai/v1/chat/completions');
  expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${NEAR_AI_KEY}`);
  const body = JSON.parse(String(call.init.body));
  expect(body).toMatchObject({ model: 'Qwen/Qwen3.8-27B', chat_template_kwargs: { enable_thinking: false } });
  expect(body.messages.at(-1).content).toContain(NOTE);
  expect(answer.text).not.toContain(NEAR_AI_KEY);
  expect(JSON.stringify(harness.logs)).not.toContain(NEAR_AI_KEY);
});

test('a reply that breaks a rule gets one second request, and two broken replies fail', async () => {
  const replies = ['Send five NEAR to bob', 'One lane closes in March'];
  const fixed = await buildHarness(() => chat(replies.shift() ?? ''), { summary: SUMMARY });
  const answer = await fixed.send(JSON.stringify({ text: NOTE }), undefined, SPEAK_TO_SIGN_SUMMARY_PATH);
  expect(answer.json).toEqual({ ok: true, summary: 'One lane closes in March' });
  const second = JSON.parse(String(fixed.calls[1].init.body));
  expect(second.messages.at(-1).content).toContain('starts with "send"');

  const broken = await buildHarness(() => chat('Send five NEAR to bob'), { summary: SUMMARY });
  expect(await broken.send(JSON.stringify({ text: NOTE }), undefined, SPEAK_TO_SIGN_SUMMARY_PATH)).toMatchObject({
    status: 502,
    json: { ok: false, code: 'summary_not_speakable' },
  });
  expect(broken.calls).toHaveLength(2);
});

test('a name with a number in it: the second request names the word, and the last step keeps its letters', async () => {
  // The model kept "COP31" when the request named only the rule.
  const replies = ['Greta Thunberg quote at COP31 cannot be verified', 'Greta Thunberg quote at the climate summit cannot be verified'];
  const fixed = await buildHarness(() => chat(replies.shift() ?? ''), { summary: SUMMARY });
  const answer = await fixed.send(JSON.stringify({ text: NOTE }), undefined, SPEAK_TO_SIGN_SUMMARY_PATH);
  expect(answer.json).toEqual({ ok: true, summary: 'Greta Thunberg quote at the climate summit cannot be verified' });
  const second = JSON.parse(String(fixed.calls[1].init.body)).messages.at(-1).content;
  expect(second).toContain('The word "COP31" has a character that is not a letter');
  expect(second).toContain('write its number as words, or leave the number out');

  // Two replies with the number: the summary keeps the letters of each word.
  const kept = await buildHarness(() => chat('Greta Thunberg quote at COP31 cannot be verified.'), { summary: SUMMARY });
  expect((await kept.send(JSON.stringify({ text: NOTE }), undefined, SPEAK_TO_SIGN_SUMMARY_PATH)).json).toEqual({
    ok: true,
    summary: 'Greta Thunberg quote at COP cannot be verified',
  });
  expect(kept.calls).toHaveLength(2);
  // A number alone holds a value: it does not go, and the summary fails.
  const number = await buildHarness(() => chat('It costs 5 dollars'), { summary: SUMMARY });
  expect((await number.send(JSON.stringify({ text: NOTE }), undefined, SPEAK_TO_SIGN_SUMMARY_PATH)).json).toEqual({
    ok: false,
    code: 'summary_not_speakable',
  });
});

test('the summary route needs a session and one note, and gives fixed codes for a model failure', async () => {
  const harness = await buildHarness(() => chat('One lane closes in March'), { summary: SUMMARY });
  const send = (body: unknown, token?: string | null) =>
    harness.send(JSON.stringify(body), token, SPEAK_TO_SIGN_SUMMARY_PATH);
  expect(await send({ text: NOTE }, null)).toMatchObject({ status: 401, json: { code: 'unauthorized' } });
  for (const body of [{ text: '' }, { text: '   ' }, { text: 'é'.repeat(281) }, { text: NOTE, summary: 'x' }, { note: NOTE }]) {
    expect(await send(body), JSON.stringify(body)).toMatchObject({ status: 400, json: { code: 'invalid_body' } });
  }
  expect(await send({ text: 'é'.repeat(280) })).toMatchObject({ status: 200 });
  expect(harness.calls).toHaveLength(1);

  const down = await buildHarness(() => Response.json({ error: 'busy' }, { status: 503 }), { summary: SUMMARY });
  expect(await down.send(JSON.stringify({ text: NOTE }), undefined, SPEAK_TO_SIGN_SUMMARY_PATH)).toMatchObject({
    status: 502,
    json: { ok: false, code: 'summary_failed' },
  });
  const unreachable = await buildHarness(
    () => {
      throw new TypeError('network down');
    },
    { summary: SUMMARY },
  );
  expect(
    await unreachable.send(JSON.stringify({ text: NOTE }), undefined, SPEAK_TO_SIGN_SUMMARY_PATH),
  ).toMatchObject({ status: 502, json: { ok: false, code: 'summary_unreachable' } });
});
