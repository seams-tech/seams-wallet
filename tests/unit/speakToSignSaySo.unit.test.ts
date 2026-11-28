// The SaySo backend: the checker of a `sayso_verdict_v1` that Wallet core and the co-signer share,
// the Gateway module that calls SaySo through its service binding, and the lane's backend choice.
// Verdicts are signed by test keys (helpers/saysoVerdict.ts).

import { expect, test } from '@playwright/test';
import { verdictMessage } from '@seams/sayso-verdict';
import { evidenceChecker, VERDICT_KEYS, type ExpectedEvidence } from '@shared/speakToSign/evidence';
import {
  SAYSO_VERDICT_KEYS,
  saysoIntent,
  saysoIntentFields,
} from '@shared/speakToSign/evidence/saysoVerdictV1';
import {
  spokenRequestBorsh,
  spokenRequestDigest,
  type SpokenRequest,
} from '@shared/speakToSign/spokenRequest';
import type { NormalizedRouterLogger } from '../../packages/mpc-wallet-server/src/router/framework/logger';
import type { SpeakToSignBackendCall } from '../../packages/mpc-wallet-server/src/router/domains/speakToSign/backend';
import {
  createSaySoBackend,
  SAYSO_ENROLLMENT_FRESH_MS,
} from '../../packages/mpc-wallet-server/src/router/domains/speakToSign/backends/sayso/saysoBackend';
import { createSpeakToSignBackend } from '../../packages/mpc-wallet-server/src/router/domains/speakToSign/backends/select';
import { deleteVoiceTemplate } from '@/core/transactionFeatures/voiceTemplate';
import { OUTLAYER_VERIFIER } from '@/core/transactionFeatures/verifiers/outlayer/outlayerVerifier';
import { SAYSO_VERIFIER } from '@/core/transactionFeatures/verifiers/sayso/saysoVerifier';
import {
  b64u,
  saysoKey,
  saysoVerdict,
  startNodeHeardWords,
  type SaySoKey,
} from './helpers/saysoVerdict';

const NOW_MS = 1_762_700_000_000;
const NEAR = 10n ** 24n;
const OWNER = 'owner.testnet';
const CHECKER = evidenceChecker('sayso_verdict_v1');

test.beforeAll(() => startNodeHeardWords());

function transfer(amountNear: bigint, receiver = 'bob.testnet'): SpokenRequest {
  return {
    kind: 'account_transfer',
    network: 'testnet',
    owner: OWNER,
    receiver,
    amountYocto: amountNear * NEAR,
  };
}

async function expectation(
  request: SpokenRequest,
  recordedAudio?: ReadonlySet<string>,
): Promise<ExpectedEvidence> {
  return {
    request,
    requestDigest: await spokenRequestDigest(spokenRequestBorsh(request)),
    ...(recordedAudio ? { recordedAudio } : {}),
  };
}

/** Opens a SaySo verdict for `request`, heard as `heard`, and checks its binding. */
async function check(
  key: SaySoKey,
  request: SpokenRequest,
  heard: string | null,
  options: {
    overrides?: Record<string, unknown>;
    expected?: ExpectedEvidence;
    keys?: string[];
  } = {},
) {
  const digest = await spokenRequestDigest(spokenRequestBorsh(request));
  const signed = await saysoVerdict(key, request, digest, {
    heard,
    expiresAtMs: NOW_MS + 120_000,
    overrides: options.overrides,
  });
  const opened = await CHECKER.open(
    { verdictJson: signed.verdict_json, signatureB64: signed.signature_b64 },
    { publicKeys: options.keys ?? [key.publicKeyHex], nowMs: NOW_MS },
  );
  if (!opened.ok) return { opened: opened.refusal, binding: null, signed };
  const binding = await opened.evidence.bindingRefusal(
    options.expected ?? (await expectation(request)),
  );
  return { opened: null, binding, evidence: opened.evidence, signed };
}

// ---------------------------------------------------------------- the intent

test('the transcript-only intent of the plan vector has its pinned digest', async () => {
  const built = await saysoIntent({
    network: 'testnet',
    owner: 'alice.testnet',
    action: 'seams.near.transfer',
    payloadSha256: '42'.repeat(32),
    sentence: 'send ten near to bob dot testnet',
  });
  expect(Buffer.from(built.intentDigest).toString('hex')).toBe(
    '7f0d21a683dbffa7dd0678670db1a8d339e510c36548eb823408e3cca3100d9f',
  );
  expect(built.intent).toEqual({
    user_id: 'near:testnet:alice.testnet',
    action: 'seams.near.transfer',
    payload_sha256_hex: '42'.repeat(32),
    sentence: 'send ten near to bob dot testnet',
    transcript_only: true,
  });
  // The request gives the same fields: the owner's user, the action of its kind, its words.
  const fields = saysoIntentFields(
    { ...transfer(10n), owner: 'alice.testnet' },
    new Uint8Array(32).fill(0x42),
  );
  expect({ ...fields, payloadSha256: b64u(fields.payloadSha256 as Uint8Array) }).toEqual({
    network: 'testnet',
    owner: 'alice.testnet',
    action: 'seams.near.transfer',
    payloadSha256: b64u(new Uint8Array(32).fill(0x42)),
    sentence: 'send ten near to bob dot testnet',
  });
});

test('the staging-testnet verdict key is pinned for testnet, and mainnet has no SaySo key', () => {
  expect(SAYSO_VERDICT_KEYS).toEqual({
    testnet: ['3d96c3d21be6b7864cadfe1d5e57366e45774d7513972710e2569aa33a0d6895'],
    mainnet: [],
  });
  expect(VERDICT_KEYS.sayso_verdict_v1).toBe(SAYSO_VERDICT_KEYS);
  expect(CHECKER.reachesContracts).toBe(false);
});

test('a sentence above SaySo limits has no intent', async () => {
  const request = transfer(999_999n, 'alice.testnet');
  const fields = saysoIntentFields(
    { ...request, amountYocto: 99_999_999n * 10n ** 22n } as SpokenRequest,
    new Uint8Array(32),
  );
  expect(fields.sentence.split(' ')).toHaveLength(18);
  await expect(saysoIntent(fields)).rejects.toThrow(RangeError);
});

// ---------------------------------------------------------------- the checker

test('a SaySo verdict passes when its transcript reads as the request, in Whisper spelling', async () => {
  const key = await saysoKey();
  for (const heard of [
    'Send 10 NEAR to bob.testnet.',
    'send ten near to bob dot testnet',
    'Sent 10 NIR to bob.testnet',
    'Send 10 NEAR to bob.',
  ]) {
    const result = await check(key, transfer(10n), heard);
    expect(result.opened, heard).toBeNull();
    expect(result.binding, heard).toBeNull();
  }
  const { evidence, signed } = await check(key, transfer(10n), 'Send 10 NEAR to bob.testnet.');
  expect(evidence).toMatchObject({
    stepUp: false,
    expiresAtMs: NOW_MS + 120_000,
    signedAtMs: NOW_MS,
    verdictId: b64u(await verdictMessage(signed.verdict_json)),
  });
});

test('a transcript of another receiver, amount, verb or more words is refused as words', async () => {
  const key = await saysoKey();
  for (const heard of [
    'Send 10 NEAR to mallory.testnet.',
    'Send 11 NEAR to bob.testnet.',
    'Send 1.0 NEAR to bob.testnet.',
    'Approve 10 NEAR to bob.testnet.',
    'Send 10 NEAR to bob.testnet and 5 NEAR to eve.testnet.',
    'Do not send 10 NEAR to bob.testnet.',
    '',
  ]) {
    const { binding } = await check(key, transfer(10n), heard);
    expect(binding?.code, heard).toBe('words');
  }
  expect((await check(key, transfer(10n), null)).binding).toEqual({
    code: 'words',
    detail: 'no transcript',
  });
  // The rating has no recipient: its words must be the request's words.
  const rating: SpokenRequest = {
    kind: 'note_rating',
    network: 'testnet',
    owner: OWNER,
    contract: 'notes.testnet',
    noteId: 4n,
    rating: 'not_helpful',
  };
  expect((await check(key, rating, 'This note is not helpful.')).binding).toBeNull();
  expect((await check(key, rating, 'This note is helpful.')).binding?.code).toBe('words');
});

test('a SaySo verdict of another user, action, request or recording does not bind', async () => {
  const key = await saysoKey();
  const request = transfer(10n);
  const mismatch = (detail: string) => ({ code: 'mismatch', detail });
  expect(
    (await check(key, request, 'x', { overrides: { user_id: 'near:testnet:eve.testnet' } }))
      .binding,
  ).toEqual(mismatch('user_id is not the owner'));
  expect(
    (await check(key, request, 'x', { overrides: { user_id: 'near:mainnet:owner.testnet' } }))
      .binding,
  ).toEqual(mismatch('user_id is not the owner'));
  expect(
    (await check(key, request, 'x', { overrides: { action: 'seams.near.transaction' } })).binding,
  ).toEqual(mismatch('action differs'));
  // A verdict for 10 NEAR binds no transfer of 11 NEAR, with any transcript.
  expect(
    (
      await check(key, request, 'Send 11 NEAR to bob.testnet.', {
        expected: await expectation(transfer(11n)),
      })
    ).binding,
  ).toEqual(mismatch('intent_digest differs'));
  // Core holds the recordings of this flow; the co-signer does not.
  const notRecorded = await check(key, request, 'Send 10 NEAR to bob.testnet.', {
    expected: await expectation(request, new Set([b64u(new Uint8Array(32).fill(1))])),
  });
  expect(notRecorded.binding).toEqual(mismatch('audio_digest is not a recording of this flow'));
  const recorded = await check(key, request, 'Send 10 NEAR to bob.testnet.', {
    expected: await expectation(request, new Set([b64u(new Uint8Array(32).fill(7))])),
  });
  expect(recorded.binding).toBeNull();
});

test('a SaySo verdict opens only with a pinned key, a real build, an accept and a valid time', async () => {
  const key = await saysoKey();
  const other = await saysoKey();
  const request = transfer(10n);
  const heard = 'Send 10 NEAR to bob.testnet.';
  expect((await check(key, request, heard, { keys: [other.publicKeyHex] })).opened?.code).toBe(
    'signature_invalid',
  );
  expect((await check(key, request, heard, { keys: [] })).opened?.code).toBe('signature_invalid');
  // A new key can come before the old one goes: either pinned key opens.
  expect(
    (await check(key, request, heard, { keys: [other.publicKeyHex, key.publicKeyHex] })).opened,
  ).toBeNull();
  expect(
    (await check(key, request, heard, { overrides: { verifier: 'sayso/0.2.0+mock' } })).opened,
  ).toEqual({
    code: 'invalid',
    detail: 'unknown verifier',
  });
  expect(
    (await check(key, request, heard, { overrides: { expires_at_ms: NOW_MS } })).opened?.code,
  ).toBe('expired');
  expect(
    (await check(key, request, heard, { overrides: { expires_at_ms: NOW_MS + 200_000 } })).opened
      ?.code,
  ).toBe('expired');
  expect(
    (await check(key, request, null, { overrides: { outcome: 'refuse', reason: 'speaker' } }))
      .opened?.code,
  ).toBe('invalid');
  expect(
    (await check(key, request, heard, { overrides: { kind: 'seams_voice_signed_verdict_v2' } }))
      .opened?.code,
  ).toBe('invalid');
});

test('the checker reads a SaySo refusal as it is, and a v2 verdict as unreadable', async () => {
  const key = await saysoKey();
  const digest = await spokenRequestDigest(spokenRequestBorsh(transfer(10n)));
  const refusal = await saysoVerdict(key, transfer(10n), digest, {
    heard: null,
    expiresAtMs: NOW_MS + 120_000,
    overrides: { outcome: 'refuse', reason: 'speaker' },
  });
  expect(CHECKER.read(refusal.verdict_json)).toEqual({
    kind: 'refused',
    reason: 'speaker',
    heard: null,
  });
  expect(CHECKER.read('{"kind":"seams_voice_signed_verdict_v2"}')).toMatchObject({
    kind: 'unreadable',
  });
});

// ---------------------------------------------------------------- the Gateway module

type BindingCall = { url: string; headers: Headers; body: Record<string, unknown> };

function bindingFor(answer: (call: BindingCall) => Response | Promise<Response>) {
  const calls: BindingCall[] = [];
  return {
    calls,
    binding: {
      async fetch(request: Request) {
        const call = {
          url: request.url,
          headers: request.headers,
          body: (await request.json()) as Record<string, unknown>,
        };
        calls.push(call);
        return await answer(call);
      },
    },
  };
}

const logs: unknown[][] = [];
const LOGGER: NormalizedRouterLogger = {
  debug: () => {},
  info: () => {},
  warn: (...args: unknown[]) => void logs.push(args),
  error: () => {},
};

function backendCall(
  input: Record<string, unknown>,
  session: SpeakToSignBackendCall['session'] = {
    authMethodKind: 'passkey',
    issuedAtMs: NOW_MS - 10_000,
  },
): SpeakToSignBackendCall {
  return { input, session, logger: LOGGER, startedAtMs: NOW_MS };
}

const VERIFY_INPUT = {
  op: 'verify',
  network: 'testnet',
  owner: OWNER,
  intent: {
    action: 'seams.near.transfer',
    payload_sha256_hex: '42'.repeat(32),
    sentence: 'send ten near to bob dot testnet',
  },
  audio_wav_b64: 'UklGRg==',
};
const VERIFY_OUTPUT = {
  kind: 'sayso_verify_output_v1',
  verdict_json: '{}',
  signature_b64: 'c2ln',
  ms: {},
};
const ENROLL_OUTPUT = {
  kind: 'sayso_enrollment_v1',
  outcome: 'accept',
  template_epoch: 1,
  agreement_milli: 812,
};

test('the Gateway calls SaySo through its binding with the key and a transcript-only intent of the session owner', async () => {
  const sayso = bindingFor(() => Response.json(VERIFY_OUTPUT));
  const backend = createSaySoBackend(
    { binding: sayso.binding, apiKey: 'sk_sayso_test' },
    { now: () => NOW_MS },
  );
  const result = await backend.run(backendCall(VERIFY_INPUT));
  expect(result).toEqual({
    ok: true,
    output: VERIFY_OUTPUT,
    attestationUrl: null,
    transcriber: 'workers_ai_whisper_large_v3_turbo',
    timing: { saysoMs: 0, serverMs: 0 },
  });
  expect(sayso.calls).toHaveLength(1);
  expect(sayso.calls[0].url).toBe('https://sayso/v1/verify');
  expect(sayso.calls[0].headers.get('authorization')).toBe('Bearer sk_sayso_test');
  expect(sayso.calls[0].body).toEqual({
    intent: {
      user_id: 'near:testnet:owner.testnet',
      action: 'seams.near.transfer',
      payload_sha256_hex: '42'.repeat(32),
      sentence: 'send ten near to bob dot testnet',
      transcript_only: true,
    },
    audio_wav_b64: 'UklGRg==',
  });
});

test('the Gateway refuses an input of another form before it calls SaySo', async () => {
  const sayso = bindingFor(() => Response.json(VERIFY_OUTPUT));
  const backend = createSaySoBackend({ binding: sayso.binding, apiKey: 'k' });
  for (const input of [
    { ...VERIFY_INPUT, network: 'betanet' },
    { ...VERIFY_INPUT, extra: 1 },
    { ...VERIFY_INPUT, intent: { ...VERIFY_INPUT.intent, user_id: 'near:testnet:eve.testnet' } },
    { op: 'verify', owner: OWNER, request: {}, contacts: [], audio_sealed_b64: 'x' },
  ]) {
    expect(await backend.run(backendCall(input))).toEqual({ ok: false, code: 'invalid_input' });
  }
  const long = {
    ...VERIFY_INPUT,
    intent: { ...VERIFY_INPUT.intent, sentence: 'word '.repeat(17).trim() },
  };
  expect(await backend.run(backendCall(long))).toEqual({ ok: false, code: 'request_unsupported' });
  expect(sayso.calls).toEqual([]);
});

test('a SaySo enrollment needs a session that a passkey or Email OTP issued in the last two minutes', async () => {
  const sayso = bindingFor(() => Response.json(ENROLL_OUTPUT));
  const backend = createSaySoBackend({ binding: sayso.binding, apiKey: 'k' });
  const enroll = { op: 'enroll', network: 'testnet', owner: OWNER, audio_wav_b64: ['a', 'b', 'c'] };
  const refused = { ok: false, code: 'fresh_approval_required' };
  expect(
    await backend.run(backendCall(enroll, { authMethodKind: 'voiceid', issuedAtMs: NOW_MS })),
  ).toEqual(refused);
  expect(
    await backend.run(
      backendCall(enroll, {
        authMethodKind: 'passkey',
        issuedAtMs: NOW_MS - SAYSO_ENROLLMENT_FRESH_MS - 1,
      }),
    ),
  ).toEqual(refused);
  expect(sayso.calls).toEqual([]);
  for (const authMethodKind of ['passkey', 'email_otp']) {
    const result = await backend.run(
      backendCall(enroll, { authMethodKind, issuedAtMs: NOW_MS - 5_000 }),
    );
    expect(result).toMatchObject({ ok: true, output: ENROLL_OUTPUT, attestationUrl: null });
  }
  expect(sayso.calls.map((call) => [call.url, call.body])).toEqual([
    [
      'https://sayso/v1/enroll',
      { user_id: 'near:testnet:owner.testnet', audio_wav_b64: ['a', 'b', 'c'] },
    ],
    [
      'https://sayso/v1/enroll',
      { user_id: 'near:testnet:owner.testnet', audio_wav_b64: ['a', 'b', 'c'] },
    ],
  ]);
  expect(await backend.run(backendCall({ ...enroll, audio_wav_b64: ['a'] }))).toEqual({
    ok: false,
    code: 'invalid_input',
  });
});

test('a SaySo failure is a fixed code without its text, and an output of another kind is a failure', async () => {
  const answers: Array<[() => Response | Promise<Response>, string]> = [
    [() => new Response('unauthorized_verify secret', { status: 401 }), 'verifier_unauthorized'],
    [() => new Response('{}', { status: 429 }), 'verifier_busy'],
    [() => new Response('{}', { status: 413 }), 'verifier_rejected_request'],
    [() => new Response('{}', { status: 503 }), 'verifier_failed'],
    [() => Response.json({ kind: 'seams_voice_verify_output_v2' }), 'verifier_failed'],
    [() => new Response('not json'), 'verifier_failed'],
    [
      () => {
        throw new TypeError('network down');
      },
      'verifier_unreachable',
    ],
  ];
  for (const [answer, code] of answers) {
    const backend = createSaySoBackend({ binding: bindingFor(answer).binding, apiKey: 'k' });
    expect(await backend.run(backendCall(VERIFY_INPUT)), code).toEqual({ ok: false, code });
  }
  expect(JSON.stringify(logs)).not.toContain('secret');
});

test('the lane names its backend: SaySo needs its key and binding, and settings without a name stop the start', () => {
  const sayso = bindingFor(() => Response.json(VERIFY_OUTPUT));
  const env = (values: Record<string, string>) => (name: string) => values[name];
  const dependencies = { fetch, nearAiApiKey: null, saysoBinding: sayso.binding };
  expect(createSpeakToSignBackend(env({}), { ...dependencies, saysoBinding: null })).toBeNull();
  expect(
    createSpeakToSignBackend(
      env({ SPEAK_TO_SIGN_BACKEND: 'sayso', SAYSO_API_KEY: 'k' }),
      dependencies,
    )?.id,
  ).toBe('sayso');
  expect(() => createSpeakToSignBackend(env({ SAYSO_API_KEY: 'k' }), dependencies)).toThrow(
    'SPEAK_TO_SIGN_BACKEND must name the backend',
  );
  expect(() =>
    createSpeakToSignBackend(env({ SPEAK_TO_SIGN_BACKEND: 'sayso', SAYSO_API_KEY: 'k' }), {
      ...dependencies,
      saysoBinding: null,
    }),
  ).toThrow('Speak-to-Sign SaySo needs the SAYSO service binding');
  expect(() =>
    createSpeakToSignBackend(env({ SPEAK_TO_SIGN_BACKEND: 'sayso' }), dependencies),
  ).toThrow('Speak-to-Sign SaySo needs SAYSO_API_KEY');
  expect(() =>
    createSpeakToSignBackend(env({ SPEAK_TO_SIGN_BACKEND: 'outlayer' }), {
      ...dependencies,
      saysoBinding: null,
    }),
  ).toThrow('Speak-to-Sign OutLayer needs its settings');
  expect(() =>
    createSpeakToSignBackend(env({ SPEAK_TO_SIGN_BACKEND: 'tee' }), dependencies),
  ).toThrow('SPEAK_TO_SIGN_BACKEND must be one of sayso, outlayer');
});

// ---------------------------------------------------------------- the template delete

test('turning voice off deletes the template at SaySo through the Gateway; OutLayer has no delete', async () => {
  const sayso = bindingFor(() =>
    Response.json({ kind: 'sayso_template_delete_v1', deleted: true }),
  );
  const backend = createSaySoBackend({ binding: sayso.binding, apiKey: 'k' });
  // The owner's own template: no fresh approval, as the delete can only stop spoken approvals.
  const deleted = await backend.run(
    backendCall(
      { op: 'delete', network: 'testnet', owner: OWNER },
      { authMethodKind: 'voiceid', issuedAtMs: 0 },
    ),
  );
  expect(deleted).toMatchObject({
    ok: true,
    output: { kind: 'sayso_template_delete_v1', deleted: true },
  });
  expect(sayso.calls.map((call) => [call.url, call.body])).toEqual([
    ['https://sayso/v1/template/delete', { user_id: 'near:testnet:owner.testnet' }],
  ]);
  expect(
    await backend.run(backendCall({ op: 'delete', network: 'testnet', owner: OWNER, x: 1 })),
  ).toEqual({
    ok: false,
    code: 'invalid_input',
  });
  expect([...backend.operations]).toEqual(['verify', 'enroll', 'delete']);
});

test('the Wallet asks the verify route to delete the template, and reads its answer', async () => {
  const sent: Array<{ url: string; init: RequestInit }> = [];
  const stream = (event: string, data: unknown) =>
    new Response(
      `event: verifier_running\ndata: {}\n\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      {
        headers: { 'content-type': 'text/event-stream' },
      },
    );
  let answer = () =>
    stream('verdict', {
      ok: true,
      output: { kind: 'sayso_template_delete_v1', deleted: false },
      attestationUrl: null,
    });
  const input = {
    serverUrl: 'https://relay.example.test/',
    operationCredential: 'wst_credential',
    network: 'testnet' as const,
    owner: OWNER,
    fetch: (async (url: URL, init: RequestInit) => {
      sent.push({ url: String(url), init });
      return answer();
    }) as typeof fetch,
    backend: SAYSO_VERIFIER,
  };
  expect(await deleteVoiceTemplate(input)).toEqual({ kind: 'deleted', hadTemplate: false });
  expect(sent[0].url).toBe('https://relay.example.test/speak-to-sign/v1/verify');
  expect(JSON.parse(String(sent[0].init.body))).toEqual({
    backend: 'sayso',
    input: { op: 'delete', network: 'testnet', owner: OWNER },
  });
  expect(new Headers(sent[0].init.headers).get('authorization')).toBe('Bearer wst_credential');
  answer = () => stream('failed', { ok: false, code: 'verifier_unreachable' });
  expect(await deleteVoiceTemplate(input)).toEqual({
    kind: 'failed',
    code: 'verifier_unreachable',
  });
  answer = () => Response.json({ ok: false, code: 'unauthorized' }, { status: 401 });
  expect(await deleteVoiceTemplate(input)).toEqual({ kind: 'failed', code: 'http_401' });
  // A lane with no verify route, or with another backend, keeps no template of this Wallet.
  answer = () => new Response('Not Found', { status: 404 });
  expect(await deleteVoiceTemplate(input)).toEqual({ kind: 'unsupported' });
  answer = () => Response.json({ ok: false, code: 'backend_mismatch' }, { status: 409 });
  expect(await deleteVoiceTemplate(input)).toEqual({ kind: 'unsupported' });
  expect(await deleteVoiceTemplate({ ...input, backend: OUTLAYER_VERIFIER })).toEqual({
    kind: 'unsupported',
  });
  expect(sent).toHaveLength(5);
});
