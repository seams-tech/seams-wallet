import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type {
  SpeakToSignClip,
  SpeakToSignHostOperations,
  SpeakToSignPaymentHooks,
  SpeakToSignProgress,
} from '@/core/transactionFeatures/hostPlugin';
import type { AuthMethodPhraseRecording } from '@/core/authMethods/hostPlugin';
import {
  createSpeakToSignHostOperations,
  enrollmentDigest,
} from '@/core/transactionFeatures/hostOperations';
import {
  isSpeakableAccount,
  parseSpeakableNear,
  renderTransfer,
  transferBorsh,
  transferDigests,
  type SpokenDigests,
  type SpokenTransferRequest,
} from '@/core/transactionFeatures/spokenTransfer';
import {
  noteActionBorsh,
  noteActionDigests,
  renderNoteAction,
  summaryRefusal,
  type SpokenNoteAction,
} from '@/core/transactionFeatures/spokenNote';
import {
  checkVoiceVerdict,
  parseVerifyOutput,
  type SignedVoiceVerdict,
  type VoiceApproval,
} from '@/core/transactionFeatures/voiceVerdict';
import { MAX_SAMPLES, pcm16Wav } from '@/core/transactionFeatures/wav';
import { sha256 } from '@shared/speakToSign/spokenRequest';
import { afterVoiceIdStepUp } from '@/core/signingEngine/stepUpConfirmation/voiceIdStepUp';
import type { Variant } from '@shared/utils/variant';
import type { ActionResult } from '@/core/types/seams';
import type { TransactionInput } from '@/core/types/actions';

const VECTORS = JSON.parse(
  readFileSync(
    path.resolve(
      import.meta.dirname,
      '../fixtures/spoken-intent/spoken_intent_vectors_v1.json',
    ),
    'utf8',
  ),
) as {
  requests: Array<{
    name: string;
    borsh_hex: string;
    display_text: string;
    spoken_text: string;
    request_digest_hex: string;
    spoken_text_digest_hex: string;
  }>;
  unsupported_accounts: Array<{ account_id: string }>;
};

// The shared signed verdicts of seams-tech/speak-to-sign (voice-verifier/testdata/
// signed_verdict_v2.json). Their audio digest is 32 bytes of 7; the key is a test key.
const SIGNED_VECTORS = {
  publicKey: 'ed25519:2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ',
  expiresAtMs: 1_762_700_120_000,
  audioDigest: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
  verdicts: [
    {
      approval: 'voice',
      amountYocto: 2n * 10n ** 24n,
      borshHex:
        '02000d0000006f776e65722e746573746e65740d000000616c6963652e746573746e657400000042db999d3784a7010000000000',
      policyText: null,
      signatureB64:
        'cBsIY3bXt0D3N7gVsDjeBBgoPzxZHtPSmA+GHlgA90KfYTqKq9tvneqfJHmkqovYNOfjaJIkISRHWuEF8LqzDQ==',
      verdictJson:
        '{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.3.1","request_digest":"uZOKUB3jJyRz6iwZ1QlcKFcBr-80sXinJ3qOIddBKws","spoken_text_digest":"mXyNIbv5LxxXrBYm8D7wwAzrBHu_o3XI0GAGdf5GNys","audio_digest":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","outcome":"accept","reason":null,"policy_rule":null,"expires_at_ms":1762700120000,"speaker_score_milli":655,"word_margin_milli":142,"heard":"send two near to alice dot testnet"}',
    },
    {
      approval: 'voice_and_passkey',
      amountYocto: 11n * 10n ** 24n,
      borshHex:
        '02000d0000006f776e65722e746573746e65740d000000616c6963652e746573746e6574000000eb35cee2315719090000000000',
      policyText: 'A voice payment above 10 NEAR needs a passkey.',
      signatureB64:
        'bB0bijTOg3XmmXKRqoP9n4qrXiES2iw6FEaKqF5n6hV3Lobp4mPE4WxqePo7MifeiHGbIFU/7iQhHRgezUNTDw==',
      verdictJson:
        '{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.3.1","request_digest":"xTpQSL__LHZZRfNdeEwE8xBW2VIiL53H0hinjaH77zs","spoken_text_digest":"KdZpMUdca0NXjyOA-Yb-xDz9T-Qho91FY8ZYpt-0AZk","audio_digest":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","outcome":"step_up","reason":null,"policy_rule":"stub_voice_amount_above_10_near","expires_at_ms":1762700120000,"speaker_score_milli":655,"word_margin_milli":142,"heard":"send eleven near to alice dot testnet"}',
    },
  ],
} as const;

const NOW_MS = 1_762_700_000_000;
const PROJECT = 'seams-v1.testnet/voice-verifier';

// ---------------------------------------------------------------- factories

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function base58(bytes: Uint8Array): string {
  let value = BigInt(`0x${hex(bytes) || '0'}`);
  let out = '';
  while (value > 0n) {
    out = B58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

type Verifier = Readonly<{ publicKey: string; sign(verdictJson: string): Promise<string> }>;

async function verifierKey(): Promise<Verifier> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey: `ed25519:${base58(raw)}`,
    async sign(verdictJson) {
      const message = await sha256(
        new TextEncoder().encode(`seams:outlayer:voice-verdict:v2${verdictJson}`),
      );
      const signature = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, message);
      return Buffer.from(signature).toString('base64');
    },
  };
}

function verifiersFor(verifier: Verifier) {
  return { testnet: { project: PROJECT, publicKey: verifier.publicKey }, mainnet: null };
}

function transferRequest(overrides: Partial<SpokenTransferRequest> = {}): SpokenTransferRequest {
  return {
    network: 'testnet',
    owner: 'owner.testnet',
    receiver: 'alice.testnet',
    amountYocto: 25n * 10n ** 24n,
    ...overrides,
  };
}

/** A verdict in the verifier's field order, with the digests of `request` and `audioDigest`. */
async function verdictJson(
  request: SpokenTransferRequest,
  audioDigest: Uint8Array,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  return await verdictJsonFor(await transferDigests(request), audioDigest, {
    heard: renderTransfer(request).spokenText,
    ...overrides,
  });
}

/** A verdict for any request kind, from its digests. */
async function verdictJsonFor(
  digests: SpokenDigests,
  audioDigest: Uint8Array,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  return JSON.stringify({
    kind: 'seams_voice_signed_verdict_v2',
    renderer: 'spoken-intent/1',
    verifier: '0.4.0',
    request_digest: b64u(digests.request),
    spoken_text_digest: b64u(digests.spokenText),
    audio_digest: b64u(audioDigest),
    outcome: 'accept',
    reason: null,
    policy_rule: null,
    expires_at_ms: NOW_MS + 120_000,
    speaker_score_milli: 612,
    word_margin_milli: 214,
    heard: null,
    ...overrides,
  });
}

async function verifyOutput(
  verifier: Verifier,
  json: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return {
    kind: 'seams_voice_verify_output_v2',
    verdict_json: json,
    signature_b64: await verifier.sign(json),
    public_key: verifier.publicKey,
    policy_text: null,
    ms: { total: 4100 },
    detail: null,
    ...extra,
  };
}

function samples(seconds = 2): Float32Array {
  const result = new Float32Array(seconds * 16_000);
  for (let index = 0; index < result.length; index += 1) result[index] = Math.sin(index / 9) / 4;
  return result;
}

function clip(seconds = 2): Variant<SpeakToSignClip, 'kind', 'captured'> {
  return {
    kind: 'captured',
    wav: pcm16Wav(samples(seconds)),
    speechMs: seconds * 1_000,
    endOfSpeechAt: 0,
  };
}

// ---------------------------------------------------------------- spoken-intent port

/** The fields of a `SpokenRequestV1::AccountTransfer` Borsh vector (tag 2). */
function decodeTransferBorsh(borshHex: string): SpokenTransferRequest {
  const bytes = Buffer.from(borshHex, 'hex');
  let at = 2;
  const text = (): string => {
    const length = bytes.readUInt32LE(at);
    const value = bytes.subarray(at + 4, at + 4 + length).toString('utf8');
    at += 4 + length;
    return value;
  };
  const network = bytes[1] === 0 ? 'testnet' : 'mainnet';
  const owner = text();
  const receiver = text();
  const amountYocto = bytes.readBigUInt64LE(at) + (bytes.readBigUInt64LE(at + 8) << 64n);
  return { network, owner, receiver, amountYocto };
}

test('the transfer port matches every account transfer vector of the spoken-intent crate', async () => {
  const transfers = VECTORS.requests.filter((vector) => vector.borsh_hex.startsWith('02'));
  expect(transfers.length).toBeGreaterThan(5);
  for (const vector of transfers) {
    const request = decodeTransferBorsh(vector.borsh_hex);
    const rendered = renderTransfer(request);
    expect(hex(transferBorsh(request)), vector.name).toBe(vector.borsh_hex);
    expect(rendered.displayText, vector.name).toBe(vector.display_text);
    expect(rendered.spokenText, vector.name).toBe(vector.spoken_text);
    const digests = await transferDigests(request);
    expect(hex(digests.request), vector.name).toBe(vector.request_digest_hex);
    expect(hex(digests.spokenText), vector.name).toBe(vector.spoken_text_digest_hex);
  }
});

test('only speakable accounts and whole hundredths of NEAR pass', () => {
  for (const { account_id } of VECTORS.unsupported_accounts) {
    expect(isSpeakableAccount(account_id), account_id).toBe(false);
  }
  expect(isSpeakableAccount('seams-v1.testnet')).toBe(true);
  expect(isSpeakableAccount('bob_1.testnet')).toBe(true);
  expect(parseSpeakableNear('2.5')).toBe(25n * 10n ** 23n);
  expect(parseSpeakableNear('0.01')).toBe(10n ** 22n);
  expect(parseSpeakableNear('1000000')).toBe(10n ** 30n);
  for (const text of ['0', '0.00', '0.001', '1000000.01', '02', '1,000', '-1', '2.', '1e3', ' 2']) {
    expect(parseSpeakableNear(text), text).toBeNull();
  }
});

test('the WAV is 16 kHz mono PCM16 with a 44-byte header and at most 8 s', () => {
  const wav = pcm16Wav(new Float32Array([0, 1, -1, 2, -2, 0.5]));
  const view = new DataView(wav.buffer);
  expect(Buffer.from(wav.subarray(0, 4)).toString()).toBe('RIFF');
  expect(Buffer.from(wav.subarray(8, 16)).toString()).toBe('WAVEfmt ');
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(16_000);
  expect(view.getUint16(34, true)).toBe(16);
  expect(view.getUint32(40, true)).toBe(12);
  expect([0, 1, 2, 3, 4, 5].map((index) => view.getInt16(44 + index * 2, true))).toEqual([
    0, 32767, -32768, 32767, -32768, 16384,
  ]);
  expect(pcm16Wav(new Float32Array(MAX_SAMPLES + 500)).length).toBe(44 + MAX_SAMPLES * 2);
});

// ---------------------------------------------------------------- verdict check

test('the shared signed verdict vectors pass the core check as voice and voice-and-passkey', async () => {
  for (const vector of SIGNED_VECTORS.verdicts) {
    const request = transferRequest({ receiver: 'alice.testnet', amountYocto: vector.amountYocto });
    expect(hex(transferBorsh(request)), vector.approval).toBe(vector.borshHex);
    const output = parseVerifyOutput({
      kind: 'seams_voice_verify_output_v2',
      verdict_json: vector.verdictJson,
      signature_b64: vector.signatureB64,
      public_key: SIGNED_VECTORS.publicKey,
      policy_text: vector.policyText,
      ms: {},
    });
    expect(output, vector.approval).not.toBeNull();
    expect(
      await checkVoiceVerdict({
        output: output!,
        expected: await transferDigests(request),
        verifier: { project: PROJECT, publicKey: SIGNED_VECTORS.publicKey },
        recordedAudio: new Set([SIGNED_VECTORS.audioDigest]),
        nowMs: SIGNED_VECTORS.expiresAtMs - 60_000,
      }),
      vector.approval,
    ).toEqual({
      kind: 'approved',
      approval: vector.approval,
      policyText: vector.policyText,
      verdict: { verdictJson: vector.verdictJson, signatureB64: vector.signatureB64 },
    });
  }
});

test('the core check refuses a verdict that does not bind this transfer, clip, time and key', async () => {
  const verifier = await verifierKey();
  const other = await verifierKey();
  const request = transferRequest();
  const audio = await sha256(clip().wav);
  const recorded = new Set([b64u(audio)]);
  const check = async (
    output: Record<string, unknown>,
    options: { publicKey?: string; recordedAudio?: Set<string>; nowMs?: number } = {},
  ) =>
    await checkVoiceVerdict({
      output: parseVerifyOutput(output)!,
      expected: await transferDigests(request),
      verifier: { project: PROJECT, publicKey: options.publicKey ?? verifier.publicKey },
      recordedAudio: options.recordedAudio ?? recorded,
      nowMs: options.nowMs ?? NOW_MS,
    });
  const valid = await verdictJson(request, audio);
  const mismatch = (detail: string) => ({ kind: 'mismatch', detail });

  expect(await check(await verifyOutput(verifier, valid))).toEqual({
    kind: 'approved',
    approval: 'voice',
    policyText: null,
    verdict: { verdictJson: valid, signatureB64: await verifier.sign(valid) },
  });
  expect(await check(await verifyOutput(verifier, valid), { publicKey: other.publicKey })).toEqual(
    mismatch('verdict key is not the pinned verifier key'),
  );
  expect(
    await check({ ...(await verifyOutput(other, valid)), public_key: verifier.publicKey }),
  ).toEqual(mismatch('verdict signature is invalid'));
  expect(await check({ ...(await verifyOutput(verifier, valid)), signature_b64: null })).toEqual(
    mismatch('verdict key is not the pinned verifier key'),
  );
  const otherAmount = await verdictJson(transferRequest({ amountYocto: 26n * 10n ** 24n }), audio);
  expect(await check(await verifyOutput(verifier, otherAmount))).toEqual(
    mismatch('request_digest differs'),
  );
  expect(await check(await verifyOutput(verifier, valid), { recordedAudio: new Set() })).toEqual(
    mismatch('audio_digest is not a recording of this flow'),
  );
  expect(await check(await verifyOutput(verifier, valid), { nowMs: NOW_MS + 120_000 })).toEqual(
    mismatch('verdict expired or not yet valid'),
  );
  const farAhead = await verdictJson(request, audio, { expires_at_ms: NOW_MS + 151_000 });
  expect(await check(await verifyOutput(verifier, farAhead))).toEqual(
    mismatch('verdict expired or not yet valid'),
  );
  const v1 = await verdictJson(request, audio, { kind: 'seams_voice_signed_verdict_v1' });
  expect(await check(await verifyOutput(verifier, v1))).toEqual(mismatch('unknown verdict kind'));
  const extraField = JSON.stringify({ ...JSON.parse(valid), note: 'x' });
  expect(await check(await verifyOutput(verifier, extraField))).toEqual(
    mismatch('unknown verdict kind'),
  );
  const stepUpWithoutRule = await verdictJson(request, audio, { outcome: 'step_up' });
  expect(await check(await verifyOutput(verifier, stepUpWithoutRule))).toEqual(
    mismatch('unknown outcome'),
  );
  expect(parseVerifyOutput({ kind: 'seams_voice_verify_output_v1', verdict_json: valid })).toBe(
    null,
  );
});

test('a verifier refusal passes through with its reason and what was heard', async () => {
  const verifier = await verifierKey();
  const request = transferRequest();
  const refusal = await verdictJson(request, new Uint8Array(32), {
    outcome: 'refuse',
    reason: 'words',
    heard: 'send fifty five near to alice dot testnet',
  });
  expect(
    await checkVoiceVerdict({
      output: parseVerifyOutput(await verifyOutput(verifier, refusal))!,
      expected: await transferDigests(request),
      verifier: { project: PROJECT, publicKey: verifier.publicKey },
      recordedAudio: new Set(),
      nowMs: NOW_MS,
    }),
  ).toEqual({
    kind: 'refused',
    reason: 'words',
    detail: 'heard: send fifty five near to alice dot testnet',
  });
});

// ---------------------------------------------------------------- core host operations

type CoreHarness = {
  operations: SpeakToSignHostOperations;
  signed: Array<{
    transaction: TransactionInput;
    approval: VoiceApproval;
    policyText: unknown;
    verdict: SignedVoiceVerdict;
  }>;
  messages: Array<{ message: string; recipient: string }>;
  fetched: Array<{ url: string; init: RequestInit }>;
  progress: SpeakToSignProgress[];
  /** How many times core started the signing preparation. */
  prepared: number;
  setVerifyResponse(response: () => Response): void;
  setOutcome(outcome: ActionResult): void;
  setRecording(recording: () => Promise<AuthMethodPhraseRecording>): void;
};

/** The verify route's answer: `text/event-stream` with these events in order. */
function verifyStream(events: ReadonlyArray<readonly [string, unknown]>): Response {
  const text = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return new Response(text.join(''), { headers: { 'content-type': 'text/event-stream' } });
}

const VERIFIER_OUTPUT = { verdict_json: '{}', ms: { speaker: 1_400, transcribe: 750, note: 'x' } };

function coreHarness(verifier: Verifier): CoreHarness {
  let verifyResponse = () =>
    verifyStream([
      ['verifier_running', {}],
      ['verdict', { ok: true, output: VERIFIER_OUTPUT, timing: {} }],
    ]);
  let outcome: ActionResult = {
    success: true,
    transactionId: 'tx-ok',
    result: { status: { SuccessValue: '' }, receipts_outcome: [] } as never,
  };
  let recording: () => Promise<AuthMethodPhraseRecording> = async () => ({
    kind: 'recorded',
    samples: samples(2),
    endOfSpeechAt: 3,
  });
  const harness: CoreHarness = {
    signed: [],
    messages: [],
    fetched: [],
    progress: [],
    prepared: 0,
    setVerifyResponse(next) {
      verifyResponse = next;
    },
    setOutcome(next) {
      outcome = next;
    },
    setRecording(next) {
      recording = next;
    },
    operations: createSpeakToSignHostOperations({
      feature: { kind: 'speak_to_sign', network: 'testnet' },
      ownerAccountId: 'owner.testnet',
      serverUrl: 'https://relay.example.test/',
      nearClient: {
        async viewAccount(accountId) {
          if (accountId === 'carol.testnet') throw new Error('UNKNOWN_ACCOUNT carol.testnet');
          return {} as never;
        },
      },
      operationCredential: async () => 'credential-1',
      signVoiceApprovedTransaction: async (transaction, voice, _, onBroadcast) => {
        harness.signed.push({ transaction, ...voice });
        onBroadcast();
        return outcome;
      },
      signMessage: async (params) => {
        harness.messages.push({ ...params });
        return {
          success: true,
          accountId: 'owner.testnet',
          publicKey: 'ed25519:owner',
          signature: 'c2lnbmF0dXJl',
          nonce: 'bm9uY2U=',
        };
      },
      openPhrase: async () => ({
        record: () => recording(),
        show: async () => 'closed',
        close: () => undefined,
      }),
      prepareSigning: async () => {
        harness.prepared += 1;
      },
      progress: (progress) => void harness.progress.push(progress),
      fetch: (async (url: URL, init: RequestInit) => {
        harness.fetched.push({ url: String(url), init });
        return verifyResponse();
      }) as typeof fetch,
      now: () => NOW_MS,
      verifiers: verifiersFor(verifier),
    }),
  };
  return harness;
}

const clipRequest = {
  sentence: 'Send 25 NEAR to alice.testnet',
  signal: new AbortController().signal,
  surfaceMeasurementBinding: { kind: 'disabled' },
} as const;

/** Opens the prompt, records one clip and closes it. */
async function capture(operations: SpeakToSignHostOperations): Promise<SpeakToSignClip> {
  const opened = await operations.openPrompt(clipRequest);
  if (opened.kind === 'unavailable') return opened;
  try {
    return await opened.prompt.record();
  } finally {
    opened.prompt.close();
  }
}

/** Payment hooks that approve a step-up and note what core told the card. */
function paymentHooks(events: string[] = []): SpeakToSignPaymentHooks {
  return {
    accepted: () => void events.push('accepted'),
    approveStepUp: async (policyText) => {
      events.push(`step_up:${policyText}`);
      return true;
    },
    broadcasting: () => void events.push('broadcasting'),
  };
}

test('core records clips, checks receivers and calls only the Seams verify route', async () => {
  const harness = coreHarness(await verifierKey());
  const signal = new AbortController().signal;
  harness.setRecording(async () => ({ kind: 'recorded', samples: samples(10), endOfSpeechAt: 3 }));
  expect(await capture(harness.operations)).toEqual({
    kind: 'captured',
    wav: pcm16Wav(samples(8)),
    speechMs: 8_000,
    endOfSpeechAt: 3,
  });
  harness.setRecording(async () => ({ kind: 'cancelled' }));
  expect(await capture(harness.operations)).toEqual({ kind: 'cancelled' });
  harness.setRecording(async () => {
    throw new Error('VoiceID is missing from this Wallet host.');
  });
  expect(await capture(harness.operations)).toEqual({
    kind: 'unavailable',
    detail: 'VoiceID is missing from this Wallet host.',
  });

  expect(await harness.operations.receiverExists('alice.testnet', signal)).toBe(true);
  expect(await harness.operations.receiverExists('carol.testnet', signal)).toBe(false);

  expect(await harness.operations.verify({ op: 'verify' }, signal)).toEqual({
    kind: 'output',
    output: VERIFIER_OUTPUT,
  });
  expect(harness.fetched[0].url).toBe('https://relay.example.test/speak-to-sign/v1/verify');
  expect(harness.fetched[0].init.body).toBe('{"input":{"op":"verify"}}');
  const headers = new Headers(harness.fetched[0].init.headers);
  expect(headers.get('authorization')).toBe('Bearer credential-1');
  expect(headers.get('accept')).toBe('text/event-stream');
  // The signing preparation runs beside the verifier, and the app hears each stage.
  expect(harness.prepared).toBe(1);
  expect(harness.progress).toEqual([
    { stage: 'recording_sent' },
    { stage: 'verifier_running' },
    { stage: 'verdict', ms: { speaker: 1_400, transcribe: 750 } },
  ]);

  // An enrollment signs nothing, so it starts no signing preparation.
  await harness.operations.verify({ op: 'enroll' }, signal);
  expect(harness.prepared).toBe(1);

  // A failure after the verifier started comes as a `failed` event; a refusal before it as JSON.
  harness.setVerifyResponse(() =>
    verifyStream([
      ['verifier_running', {}],
      ['failed', { ok: false, code: 'verifier_timeout' }],
    ]),
  );
  expect(await harness.operations.verify({ op: 'verify' }, signal)).toEqual({
    kind: 'failed',
    code: 'verifier_timeout',
  });
  harness.setVerifyResponse(() =>
    Response.json({ ok: false, code: 'unauthorized' }, { status: 401 }),
  );
  expect(await harness.operations.verify({ op: 'verify' }, signal)).toEqual({
    kind: 'failed',
    code: 'unauthorized',
  });
  harness.setVerifyResponse(() => verifyStream([['verifier_running', {}]]));
  expect(await harness.operations.verify({ op: 'verify' }, signal)).toEqual({
    kind: 'failed',
    code: 'verify_stream_ended',
  });
  // Events may arrive split across chunks.
  harness.setVerifyResponse(() => {
    const text = `event: verifier_running\ndata: {}\n\nevent: verdict\ndata: ${JSON.stringify({ ok: true, output: VERIFIER_OUTPUT })}\n\n`;
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 7) controller.enqueue(bytes.slice(at, at + 7));
        controller.close();
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  expect(await harness.operations.verify({ op: 'verify' }, signal)).toEqual({
    kind: 'output',
    output: VERIFIER_OUTPUT,
  });
});

test('core pays once per flow, from the owner, with the approval the verdict names', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const signal = new AbortController().signal;
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const audio = await sha256(captured.wav);
  const transfer = { receiver: 'alice.testnet', amountYocto: 25n * 10n ** 24n };
  const accept = await verifyOutput(verifier, await verdictJson(transferRequest(), audio));
  const events: string[] = [];
  const pay = (output: unknown) =>
    harness.operations.payWithVerdict(transfer, output, signal, paymentHooks(events));

  expect(await pay(accept)).toEqual({
    kind: 'executed',
    transactionHash: 'tx-ok',
    approval: 'voice',
  });
  expect(harness.signed).toEqual([
    {
      transaction: {
        receiverId: 'alice.testnet',
        actions: [{ type: 'Transfer', amount: '25000000000000000000000000' }],
      },
      approval: 'voice',
      policyText: null,
      // The signing request carries the checked verdict to the co-signer.
      verdict: { verdictJson: accept.verdict_json, signatureB64: accept.signature_b64 },
    },
  ]);
  expect(harness.progress).toEqual([
    { stage: 'transaction_sent' },
    { stage: 'settled', transactionHash: 'tx-ok' },
  ]);
  // A second accepted verdict of the same flow, such as one after "Try again", pays nothing.
  const again = await verifyOutput(
    verifier,
    await verdictJson(transferRequest(), audio, { speaker_score_milli: 650 }),
  );
  for (const output of [accept, again]) {
    expect(await pay(output)).toEqual({
      kind: 'refused',
      reason: 'verdict_mismatch',
      detail: 'this flow already signed',
    });
  }

  const stepUpFlow = coreHarness(verifier);
  await capture(stepUpFlow.operations);
  const stepUpJson = await verdictJson(transferRequest(), audio, {
    outcome: 'step_up',
    policy_rule: 'stub_voice_amount_above_10_near',
    speaker_score_milli: 700,
  });
  const stepUp = await verifyOutput(verifier, stepUpJson, {
    policy_text: 'A voice payment above 10 NEAR needs a passkey.',
  });
  stepUpFlow.setOutcome({
    success: true,
    transactionId: 'tx-bad',
    result: {
      status: { SuccessValue: '' },
      receipts_outcome: [{ outcome: { status: { Failure: { error: 'NotEnoughBalance' } } } }],
    } as never,
  });
  expect(
    await stepUpFlow.operations.payWithVerdict(transfer, stepUp, signal, paymentHooks(events)),
  ).toEqual({
    kind: 'reverted',
    transactionHash: 'tx-bad',
    error: '{"error":"NotEnoughBalance"}',
  });
  expect(stepUpFlow.signed.at(-1)).toMatchObject({
    approval: 'voice_and_passkey',
    policyText: 'A voice payment above 10 NEAR needs a passkey.',
  });
  expect(stepUpFlow.progress).toEqual([
    { stage: 'step_up', policyText: 'A voice payment above 10 NEAR needs a passkey.' },
    { stage: 'transaction_sent' },
    { stage: 'settled', transactionHash: 'tx-bad' },
  ]);
  expect(events).toEqual([
    'accepted',
    'broadcasting',
    'step_up:A voice payment above 10 NEAR needs a passkey.',
    'broadcasting',
  ]);

  // Another transfer than the verdict names, or a clip that core did not record, pays nothing.
  const signedBefore = harness.signed.length;
  const fresh = await verifyOutput(
    verifier,
    await verdictJson(transferRequest(), audio, { speaker_score_milli: 701 }),
  );
  expect(
    await harness.operations.payWithVerdict(
        { ...transfer, receiver: 'bob.testnet' },
        fresh,
        signal,
        paymentHooks(),
      ),
  ).toMatchObject({ kind: 'refused', reason: 'verdict_mismatch' });
  const foreign = await verifyOutput(
    verifier,
    await verdictJson(transferRequest(), new Uint8Array(32).fill(9)),
  );
  expect(await pay(foreign)).toEqual({
    kind: 'refused',
    reason: 'verdict_mismatch',
    detail: 'audio_digest is not a recording of this flow',
  });
  expect(await pay({ kind: 'other' })).toEqual({
    kind: 'unavailable',
    detail: 'invalid verifier output',
  });
  expect(harness.signed).toHaveLength(signedBefore);
});

test('a transfer that never left the Wallet lets another verdict of the flow pay', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const signal = new AbortController().signal;
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const audio = await sha256(captured.wav);
  const transfer = { receiver: 'alice.testnet', amountYocto: 25n * 10n ** 24n };
  harness.setOutcome({ success: false, kind: 'not_submitted', error: 'closed' } as never);
  const first = await verifyOutput(verifier, await verdictJson(transferRequest(), audio));
  expect(await harness.operations.payWithVerdict(transfer, first, signal, paymentHooks())).toEqual({
    kind: 'not_submitted',
    error: 'closed',
  });
  harness.setOutcome({
    success: true,
    transactionId: 'tx-ok',
    result: { status: { SuccessValue: '' }, receipts_outcome: [] } as never,
  });
  const second = await verifyOutput(
    verifier,
    await verdictJson(transferRequest(), audio, { speaker_score_milli: 650 }),
  );
  expect(await harness.operations.payWithVerdict(transfer, second, signal, paymentHooks())).toEqual(
    { kind: 'executed', transactionHash: 'tx-ok', approval: 'voice' },
  );
});

test('a co-signer refusal returns its typed reason, and another verdict of the flow may pay', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const signal = new AbortController().signal;
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const audio = await sha256(captured.wav);
  const transfer = { receiver: 'alice.testnet', amountYocto: 25n * 10n ** 24n };
  const refusedBy = (reason: string) =>
    harness.setOutcome({
      success: false,
      kind: 'not_submitted',
      error: `Router A/B signing /router-ab/ed25519/sign/prepare returned HTTP 403: Speak-to-Sign verdict refused: ${reason}`,
    } as never);
  const pay = async (speakerScore: number) =>
    await harness.operations.payWithVerdict(
      transfer,
      await verifyOutput(
        verifier,
        await verdictJson(transferRequest(), audio, { speaker_score_milli: speakerScore }),
      ),
      signal,
      paymentHooks(),
    );
  for (const [reason, expected] of [
    ['over_payment_limit', 'voice_limit'],
    ['over_daily_limit', 'voice_limit'],
    ['reused', 'cosigner_refused'],
    ['step_up_required', 'cosigner_refused'],
  ] as const) {
    refusedBy(reason);
    expect(await pay(600), reason).toEqual({ kind: 'refused', reason: expected, detail: reason });
  }
  // An unknown reason in the message stays a plain signing failure.
  refusedBy('something_else');
  expect(await pay(601)).toMatchObject({ kind: 'not_submitted' });
  harness.setOutcome({
    success: true,
    transactionId: 'tx-ok',
    result: { status: { SuccessValue: '' }, receipts_outcome: [] } as never,
  });
  expect(await pay(602)).toEqual({ kind: 'executed', transactionHash: 'tx-ok', approval: 'voice' });
  expect(harness.signed).toHaveLength(6);
});

test('after a VoiceID step-up, the new unlock meets a fresh-approval policy and no other', () => {
  const args = { transaction: 'tx', sensitivePolicy: 'require_fresh_same_method' } as const;
  expect(afterVoiceIdStepUp(args)).toEqual({ transaction: 'tx', sensitivePolicy: undefined });
  for (const sensitivePolicy of ['require_passkey', 'deny_email_otp', 'inherit_session_policy']) {
    const other = { transaction: 'tx', sensitivePolicy };
    expect(afterVoiceIdStepUp(other), sensitivePolicy).toBe(other);
  }
  const none = { transaction: 'tx' };
  expect(afterVoiceIdStepUp(none)).toBe(none);
});

test('core signs the enrollment message only for three clips it recorded', async () => {
  const harness = coreHarness(await verifierKey());
  const signal = new AbortController().signal;
  const clips: Uint8Array<ArrayBuffer>[] = [];
  for (const seconds of [1, 2, 3]) {
    harness.setRecording(async () => ({
      kind: 'recorded',
      samples: samples(seconds),
      endOfSpeechAt: 0,
    }));
    const captured = await capture(harness.operations);
    if (captured.kind !== 'captured') throw new Error('no clip');
    clips.push(captured.wav);
  }

  expect(await harness.operations.authorizeEnrollment(clips, signal)).toEqual({
    kind: 'signed',
    authorization: {
      public_key: 'ed25519:owner',
      signature_b64: 'c2lnbmF0dXJl',
      nonce_b64: 'bm9uY2U=',
    },
  });
  expect(harness.messages).toHaveLength(1);
  expect(harness.messages[0].recipient).toBe(PROJECT);
  expect(harness.messages[0].message).toMatch(
    /^Speak-to-Sign voice enrollment [A-Za-z0-9_-]{43}$/,
  );

  expect(await harness.operations.authorizeEnrollment(clips.slice(0, 2), signal)).toEqual({
    kind: 'not_signed',
    error: 'An enrollment needs exactly three recordings.',
  });
  expect(
    await harness.operations.authorizeEnrollment([clips[0], clips[1], pcm16Wav(samples(4))], signal),
  ).toEqual({
    kind: 'not_signed',
    error: 'Only recordings of this enrollment can be authorized.',
  });
  expect(harness.messages).toHaveLength(1);
});

// The shared vector of seams-tech/speak-to-sign (voice-verifier/testdata/enrollment_digest_v2.json).
// Each audio digest is the SHA-256 of "seams enrollment clip N".
const ENROLLMENT_DIGEST_VECTOR = {
  owner: 'owner.testnet',
  clips: ['seams enrollment clip 1', 'seams enrollment clip 2', 'seams enrollment clip 3'],
  enrollmentDigest: 'IyW72Dqz05KV9arXO7CqCdmAzz4isRopE3BDZslJwFY',
  message: 'Speak-to-Sign voice enrollment IyW72Dqz05KV9arXO7CqCdmAzz4isRopE3BDZslJwFY',
};

test('the enrollment digest and message match the shared verifier vectors', async () => {
  const digests = await Promise.all(
    ENROLLMENT_DIGEST_VECTOR.clips.map((text) => sha256(new TextEncoder().encode(text))),
  );
  const digest = await enrollmentDigest(ENROLLMENT_DIGEST_VECTOR.owner, digests);
  expect(digest).toBe(ENROLLMENT_DIGEST_VECTOR.enrollmentDigest);
  expect(`Speak-to-Sign voice enrollment ${digest}`).toBe(ENROLLMENT_DIGEST_VECTOR.message);
});

// ---------------------------------------------------------------- community notes

/** The note text of every community note vector of the crate (tests/vectors.rs `NOTE_TEXT`). */
const VECTOR_NOTE_TEXT =
  'The city closes one lane for two weeks of repairs. The bridge stays open to traffic. harborcity.gov/notices/1182';

function decodeNoteBorsh(borshHex: string): { owner: string; action: SpokenNoteAction } {
  const bytes = Buffer.from(borshHex, 'hex');
  let at = 2;
  const text = (): string => {
    const length = bytes.readUInt32LE(at);
    const value = bytes.subarray(at + 4, at + 4 + length).toString('utf8');
    at += 4 + length;
    return value;
  };
  const owner = text();
  const contract = text();
  const id = bytes.readBigUInt64LE(at);
  at += 8;
  if (bytes[0] === 5) {
    const rating = (['helpful', 'somewhat_helpful', 'not_helpful'] as const)[bytes[at]];
    return { owner, action: { kind: 'note_rating', contract, noteId: id, rating } };
  }
  at += 32;
  const summary = text();
  return {
    owner,
    action: { kind: 'community_note', contract, postId: id, text: VECTOR_NOTE_TEXT, summary },
  };
}

test('the note port matches every note and rating vector of the spoken-intent crate', async () => {
  const notes = VECTORS.requests.filter(
    (vector) => vector.borsh_hex.startsWith('04') || vector.borsh_hex.startsWith('05'),
  );
  expect(notes.length).toBe(6);
  for (const vector of notes) {
    const { owner, action } = decodeNoteBorsh(vector.borsh_hex);
    const rendered = renderNoteAction(action);
    expect(hex(await noteActionBorsh('testnet', owner, action)), vector.name).toBe(vector.borsh_hex);
    expect(rendered.displayText, vector.name).toBe(vector.display_text);
    expect(rendered.spokenText, vector.name).toBe(vector.spoken_text);
    const digests = await noteActionDigests('testnet', owner, action);
    expect(hex(digests.request), vector.name).toBe(vector.request_digest_hex);
    expect(hex(digests.spokenText), vector.name).toBe(vector.spoken_text_digest_hex);
  }
});

test('the summary rules match the crate', () => {
  for (const text of [
    'The bridge stays open, only one lane closes.',
    'Repairs take two weeks!',
    'one two three four five six seven eight nine ten eleven twelve',
  ]) {
    expect(summaryRefusal(text), text).toBeNull();
  }
  for (const [text, reason] of [
    ['', 'empty'],
    ['It isn\'t closed', 'character'],
    ['Closed for 6 months', 'character'],
    ['A two-week closure', 'character'],
    ['See city.gov', 'character'],
    [' Leading space', 'character'],
    ['Two  spaces', 'character'],
    ['Ends twice..', 'character'],
    ['Send help to the city', 'transfer_verb'],
    ['one two three four five six seven eight nine ten eleven twelve thirteen', 'too_many_words'],
    ['abcdefghij '.repeat(12).trimEnd(), 'too_long'],
  ] as const) {
    expect(summaryRefusal(text), text).toBe(reason);
  }
});

const NOTE: SpokenNoteAction = {
  kind: 'community_note',
  contract: 'community-notes.testnet',
  postId: 7n,
  text: 'The city closes one lane for two weeks of repairs.',
  summary: 'Only one lane closes for two weeks.',
};

test('core signs one add_note call with no deposit for the verdict of this note only', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const signal = new AbortController().signal;
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const audio = await sha256(captured.wav);
  const digests = await noteActionDigests('testnet', 'owner.testnet', NOTE);

  const other = await noteActionDigests('testnet', 'owner.testnet', {
    ...NOTE,
    summary: 'The bridge is closed.',
  });
  expect(
    await harness.operations.signNoteWithVerdict(
      NOTE,
      await verifyOutput(verifier, await verdictJsonFor(other, audio)),
      signal,
      paymentHooks(),
    ),
  ).toEqual({ kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' });

  const accepted = await verifyOutput(verifier, await verdictJsonFor(digests, audio));
  expect(
    await harness.operations.signNoteWithVerdict(NOTE, accepted, signal, paymentHooks()),
  ).toEqual({ kind: 'executed', transactionHash: 'tx-ok', approval: 'voice' });
  expect(harness.signed).toEqual([
    {
      transaction: {
        receiverId: 'community-notes.testnet',
        actions: [
          {
            type: 'FunctionCall',
            methodName: 'add_note',
            args: { post_id: 7, text: NOTE.text, summary: NOTE.summary },
            gas: '30000000000000',
            deposit: '0',
          },
        ],
      },
      approval: 'voice',
      policyText: null,
      verdict: { verdictJson: accepted.verdict_json, signatureB64: accepted.signature_b64 },
    },
  ]);
});
