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
  noteActionRefusal,
  noteVerifyRequest,
  renderNoteAction,
  summaryRefusal,
  type SpokenNoteAction,
} from '@/core/transactionFeatures/spokenNote';
import { parseSpeakableUsdc, type SpokenBetAction } from '@/core/transactionFeatures/spokenBet';
import {
  messageActionRefusal,
  messageDigests,
  messageVerifyRequest,
  type SpokenMessageAction,
} from '@/core/transactionFeatures/spokenMessage';
import {
  checkVoiceVerdict,
  parseVerifyOutput,
  type SignedVoiceVerdict,
  type VoiceApproval,
} from '@/core/transactionFeatures/voiceVerdict';
import { MAX_SAMPLES, pcm16Wav } from '@/core/transactionFeatures/wav';
import {
  nearTransactionActionsBorsh,
  sha256,
  spokenRequestBorsh,
  spokenRequestDigest,
  spokenTextDigest,
} from '@shared/speakToSign/spokenRequest';
import { afterVoiceIdStepUp } from '@/core/signingEngine/stepUpConfirmation/voiceIdStepUp';
import type { Variant } from '@shared/utils/variant';
import type { ActionResult } from '@/core/types/seams';
import type { TransactionInput } from '@/core/types/actions';
import { intentDigests, type SpokenIntent } from '@/core/transactionFeatures/spokenIntent';
import {
  SPOKEN_KINDS,
  SPOKEN_TYPED_KINDS,
  spokenRequestOfCall,
  spokenRequestOfFields,
  type SignedSpokenCall,
  type SpokenTypedFields,
} from '@shared/speakToSign/spokenKinds';

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
/** The audio key of the verifier's vector `sealed_audio_v1.json` (X25519, standard base64). */
const AUDIO_KEY = 'OKtmS9hvd9fma92a4HkpE6lP2LM6EmACfktGwfSITGc=';

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
  return { testnet: { project: PROJECT, publicKey: verifier.publicKey, audioKey: AUDIO_KEY }, mainnet: null };
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

test('each request tag of the spoken-intent crate is ported, or named as not ported', () => {
  // The tags that the tests of this file port, with their Borsh tag byte as hex.
  const ported = ['02', '04', '05', '06', '07', '08', '09'];
  // Wallet core builds no request of these tags:
  // 01 `MultisigApproval`: the voice multisig demo contract builds it, with its own digest.
  // 0a `Confirmation`: a request for an application owner (`app:<id>`), with no wallet.
  const notPorted = ['01', '0a'];
  const tags = [...new Set(VECTORS.requests.map((vector) => vector.borsh_hex.slice(0, 2)))].sort();
  expect(tags).toEqual([...ported, ...notPorted].sort());
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
        verifier: { project: PROJECT, publicKey: SIGNED_VECTORS.publicKey, audioKey: AUDIO_KEY },
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
      verifier: {
        project: PROJECT,
        publicKey: options.publicKey ?? verifier.publicKey,
        audioKey: AUDIO_KEY,
      },
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
    mismatch('verdict fields are invalid'),
  );
  const stepUpWithoutRule = await verdictJson(request, audio, { outcome: 'step_up' });
  expect(await check(await verifyOutput(verifier, stepUpWithoutRule))).toEqual(
    mismatch('verdict fields are invalid'),
  );
  const otherSentence = await verdictJson(request, audio, {
    spoken_text_digest: b64u(new Uint8Array(32)),
  });
  expect(await check(await verifyOutput(verifier, otherSentence))).toEqual(
    mismatch('spoken_text_digest differs'),
  );
  const otherRenderer = await verdictJson(request, audio, { renderer: 'spoken-intent/2' });
  expect(await check(await verifyOutput(verifier, otherRenderer))).toEqual(
    mismatch('unknown renderer'),
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
      verifier: { project: PROJECT, publicKey: verifier.publicKey, audioKey: AUDIO_KEY },
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
  /** Each message that core signed for a verdict, with the verdict it sent. */
  voiceMessages: Array<{ action: SpokenMessageAction; verdict: SignedVoiceVerdict }>;
  /** Each transaction that core signed for a verdict and did not send. */
  signedOnly: Array<{ transaction: TransactionInput; verdict: SignedVoiceVerdict }>;
  /** Each delegate action that core signed for a verdict. */
  delegates: Array<{ delegate: unknown; verdict: SignedVoiceVerdict }>;
  setSignError(error: string | null): void;
  setMessageError(error: string | null): void;
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
  let messageError: string | null = null;
  let signError: string | null = null;
  const harness: CoreHarness = {
    signed: [],
    messages: [],
    voiceMessages: [],
    signedOnly: [],
    delegates: [],
    setMessageError(next) {
      messageError = next;
    },
    setSignError(next) {
      signError = next;
    },
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
      signVoiceApprovedTransaction: async (transaction, voice, _, onBroadcast, onIncluded) => {
        harness.signed.push({ transaction, ...voice });
        onBroadcast();
        onIncluded?.('tx-included');
        return outcome;
      },
      signVoiceApprovedTransactionOnly: async (transaction, voice) => {
        if (signError !== null) throw new Error(signError);
        harness.signedOnly.push({ transaction, verdict: voice.verdict });
        return { signedTransaction: { transactionHash: 'tx-signed' }, nearAccountId: 'owner.testnet' } as never;
      },
      signVoiceApprovedDelegate: async (delegate, verdict) => {
        if (signError !== null) throw new Error(signError);
        harness.delegates.push({ delegate, verdict });
        return { hash: 'delegate-hash', signedDelegate: {}, nearAccountId: 'owner.testnet' } as never;
      },
      signVoiceApprovedMessage: async (action, verdict) => {
        if (messageError !== null) return { success: false, error: messageError };
        harness.voiceMessages.push({ action, verdict });
        return {
          success: true,
          accountId: 'owner.testnet',
          publicKey: 'ed25519:owner',
          signature: 'c2lnbmF0dXJl',
          nonce: action.nonce,
          ...(action.state === null ? {} : { state: action.state }),
        };
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
    included: (hash) => void events.push(`included:${hash}`),
  };
}

test('core seals each recording before it calls the verify route', async () => {
  const harness = coreHarness(await verifierKey());
  const signal = new AbortController().signal;
  const wav = Buffer.from(pcm16Wav(samples(1))).toString('base64');
  const sent = () => JSON.parse(String(harness.fetched.at(-1)?.init.body)).input;

  await harness.operations.verify(
    { op: 'verify', owner: 'owner.testnet', contacts: [], audio_wav_b64: wav },
    signal,
  );
  const one = sent();
  expect(Object.keys(one)).toEqual(['op', 'owner', 'contacts', 'audio_sealed_b64']);
  // The encapsulated key, the clip and the tag.
  expect(Buffer.from(one.audio_sealed_b64, 'base64').length).toBe(
    32 + Buffer.from(wav, 'base64').length + 16,
  );
  expect(String(harness.fetched.at(-1)?.init.body)).not.toContain(wav.slice(0, 64));

  await harness.operations.verify(
    { op: 'enroll', owner: 'owner.testnet', audio_wav_b64: [wav, wav, wav] },
    signal,
  );
  const three = sent();
  expect(three.audio_wav_b64).toBeUndefined();
  expect(three.audio_sealed_b64).toHaveLength(3);
  // Each clip has its own ephemeral key.
  expect(new Set(three.audio_sealed_b64).size).toBe(3);

  // A recording that core cannot seal does not leave the device.
  const calls = harness.fetched.length;
  for (const input of [
    { op: 'verify', audio_wav_b64: wav },
    { op: 'verify', owner: 'owner.testnet', audio_wav_b64: 7 },
    { op: 'verify', owner: 'owner.testnet', audio_wav_b64: 'not base64!' },
  ]) {
    expect(await harness.operations.verify(input, signal)).toEqual({
      kind: 'failed',
      code: 'recording_not_sealed',
    });
  }
  expect(harness.fetched.length).toBe(calls);
});

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
  // A plain transfer tells the card when a block holds it, before the outcome.
  expect(events).toEqual([
    'accepted',
    'broadcasting',
    'included:tx-included',
    'step_up:A voice payment above 10 NEAR needs a passkey.',
    'broadcasting',
    'included:tx-included',
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
  expect(harness.signed).toHaveLength(4);
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
  const noteEvents: string[] = [];
  expect(
    await harness.operations.signNoteWithVerdict(NOTE, accepted, signal, paymentHooks(noteEvents)),
  ).toEqual({ kind: 'executed', transactionHash: 'tx-ok', approval: 'voice' });
  // A contract call can fail in the contract, so the card waits for its outcome.
  expect(noteEvents).toEqual(['accepted', 'broadcasting']);
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

const MERGE: SpokenNoteAction = {
  kind: 'merge_approval',
  contract: 'merges.seams-v1.testnet',
  repo: 'seams-tech/seams-wallet',
  pullRequest: 42n,
  base: 'main',
  headCommit: '0123456789abcdef0123456789abcdef01234567',
};

test('a merge approval says the pull request and base, and checks every field', () => {
  expect(renderNoteAction(MERGE)).toEqual({
    displayText: 'Merge pull request 42 into main',
    spokenText: 'merge pull request forty two into main',
  });
  expect(noteActionRefusal('testnet', MERGE)).toBeNull();
  for (const repo of ['a/b', 'my-org/My.Repo_2', 'seams/...']) {
    expect(noteActionRefusal('testnet', { ...MERGE, repo }), repo).toBeNull();
  }
  for (const bad of [
    { ...MERGE, pullRequest: 0n },
    { ...MERGE, base: 'Main' },
    { ...MERGE, base: 'release-1' },
    { ...MERGE, repo: 'seams-wallet' },
    { ...MERGE, repo: '-seams/x' },
    { ...MERGE, repo: 'seams-/x' },
    { ...MERGE, repo: 'seams/.' },
    { ...MERGE, repo: 'seams/..' },
    { ...MERGE, headCommit: MERGE.headCommit.toUpperCase() },
    { ...MERGE, headCommit: MERGE.headCommit.slice(1) },
  ]) {
    expect(noteActionRefusal('testnet', bad), JSON.stringify(bad, (_, v) => (typeof v === 'bigint' ? `${v}` : v))).toBe(
      'merge_not_valid',
    );
  }
});

test('core signs one approve_merge call with no deposit for the verdict of this merge only', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const signal = new AbortController().signal;
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const audio = await sha256(captured.wav);
  const otherCommit = await noteActionDigests('testnet', 'owner.testnet', {
    ...MERGE,
    headCommit: 'f'.repeat(40),
  });
  expect(
    await harness.operations.signNoteWithVerdict(
      MERGE,
      await verifyOutput(verifier, await verdictJsonFor(otherCommit, audio)),
      signal,
      paymentHooks(),
    ),
  ).toEqual({ kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' });

  const digests = await noteActionDigests('testnet', 'owner.testnet', MERGE);
  const accepted = await verifyOutput(verifier, await verdictJsonFor(digests, audio));
  expect(
    await harness.operations.signNoteWithVerdict(MERGE, accepted, signal, paymentHooks()),
  ).toEqual({ kind: 'executed', transactionHash: 'tx-ok', approval: 'voice' });
  expect(harness.signed.at(-1)?.transaction).toEqual({
    receiverId: 'merges.seams-v1.testnet',
    actions: [
      {
        type: 'FunctionCall',
        methodName: 'approve_merge',
        args: {
          repo: 'seams-tech/seams-wallet',
          pull_request: 42,
          base: 'main',
          head_commit: '0123456789abcdef0123456789abcdef01234567',
        },
        gas: '30000000000000',
        deposit: '0',
      },
    ],
  });
});

/** The repository of every merge vector of the crate (tests/vectors.rs). */
const VECTOR_REPO = 'seams-tech/seams-wallet';

test('the merge port matches every merge approval vector of the spoken-intent crate', async () => {
  const merges = VECTORS.requests.filter((vector) => vector.borsh_hex.startsWith('06'));
  expect(merges.length).toBeGreaterThanOrEqual(3);
  for (const vector of merges) {
    const bytes = Buffer.from(vector.borsh_hex, 'hex');
    let at = 2;
    const text = (): string => {
      const length = bytes.readUInt32LE(at);
      const value = bytes.subarray(at + 4, at + 4 + length).toString('utf8');
      at += 4 + length;
      return value;
    };
    const owner = text();
    const contract = text();
    at += 32;
    const pullRequest = bytes.readBigUInt64LE(at);
    at += 8;
    const base = text();
    const headCommit = bytes.subarray(at, at + 20).toString('hex');
    const action: SpokenNoteAction = {
      kind: 'merge_approval',
      contract,
      repo: VECTOR_REPO,
      pullRequest,
      base,
      headCommit,
    };
    const rendered = renderNoteAction(action);
    expect(hex(await noteActionBorsh('testnet', owner, action)), vector.name).toBe(vector.borsh_hex);
    expect(rendered.displayText, vector.name).toBe(vector.display_text);
    expect(rendered.spokenText, vector.name).toBe(vector.spoken_text);
    const digests = await noteActionDigests('testnet', owner, action);
    expect(hex(digests.request), vector.name).toBe(vector.request_digest_hex);
    expect(hex(digests.spokenText), vector.name).toBe(vector.spoken_text_digest_hex);
  }
});

// ---------------------------------------------------------------- market bets

const USDC = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';

const BET: SpokenBetAction = {
  kind: 'market_bet',
  contract: 'pm-notes.testnet',
  token: USDC,
  marketId: 9n,
  outcome: 'yes',
  amountUnits: 500_000n,
};

function decodeBetBorsh(borshHex: string): { owner: string; action: SpokenBetAction } {
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
  const token = text();
  const marketId = bytes.readBigUInt64LE(at);
  const outcome = (['yes', 'no'] as const)[bytes[at + 8]];
  const amountUnits = BigInt(`0x${Buffer.from(bytes.subarray(at + 9, at + 25)).reverse().toString('hex')}`);
  return { owner, action: { kind: 'market_bet', contract, token, marketId, outcome, amountUnits } };
}

test('the bet port matches every market bet vector of the spoken-intent crate', async () => {
  const bets = VECTORS.requests.filter((vector) => vector.borsh_hex.startsWith('07'));
  expect(bets.map((vector) => vector.name)).toEqual([
    'market_bet_yes_half_usdc',
    'market_bet_no_one_usdc',
    'market_bet_yes_implicit_owner',
  ]);
  for (const vector of bets) {
    const { owner, action } = decodeBetBorsh(vector.borsh_hex);
    const rendered = renderNoteAction(action);
    expect(hex(await noteActionBorsh('testnet', owner, action)), vector.name).toBe(vector.borsh_hex);
    expect(rendered.displayText, vector.name).toBe(vector.display_text);
    expect(rendered.spokenText, vector.name).toBe(vector.spoken_text);
    const digests = await noteActionDigests('testnet', owner, action);
    expect(hex(digests.request), vector.name).toBe(vector.request_digest_hex);
    expect(hex(digests.spokenText), vector.name).toBe(vector.spoken_text_digest_hex);
  }
});

test('a bet is a whole number of cents in the USDC contract of the network', async () => {
  expect(parseSpeakableUsdc('0.5')).toBe(500_000n);
  expect(parseSpeakableUsdc('1250.75')).toBe(1_250_750_000n);
  expect(parseSpeakableUsdc('1000000')).toBe(10n ** 12n);
  for (const text of ['0', '0.001', '1000000.01', '1e3', '-1', '01', '']) {
    expect(parseSpeakableUsdc(text), text).toBeNull();
  }
  expect(noteActionRefusal('testnet', BET)).toBeNull();
  for (const bad of [
    // Another token can have other decimals than the sentence says.
    { ...BET, token: 'usdc.testnet' },
    { ...BET, contract: USDC },
    { ...BET, marketId: 0n },
    { ...BET, marketId: 2n ** 53n },
    { ...BET, outcome: 'maybe' as never },
    { ...BET, amountUnits: 0n },
    { ...BET, amountUnits: 5_000n },
    { ...BET, amountUnits: 10n ** 12n + 10_000n },
  ]) {
    expect(
      noteActionRefusal('testnet', bad),
      JSON.stringify(bad, (_, v) => (typeof v === 'bigint' ? `${v}` : v)),
    ).toBe('bet_not_valid');
  }
  // Mainnet has no pinned USDC contract, so it has no spoken bets.
  expect(noteActionRefusal('mainnet', BET)).toBe('bet_not_valid');
  expect(await noteVerifyRequest(BET)).toEqual({
    kind: 'market_bet',
    market: 'pm-notes.testnet',
    token: USDC,
    market_id: 9,
    outcome: 'yes',
    amount_units: '500000',
  });
});

test('core signs one ft_transfer_call that carries the verdict of this bet only', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const signal = new AbortController().signal;
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const audio = await sha256(captured.wav);

  // The verdict of the other outcome, of another amount or of another market does not pass.
  for (const other of [
    { ...BET, outcome: 'no' as const },
    { ...BET, amountUnits: 5_000_000n },
    { ...BET, marketId: 8n },
    { ...BET, contract: 'other-market.testnet' },
  ]) {
    const digests = await noteActionDigests('testnet', 'owner.testnet', other);
    expect(
      await harness.operations.signNoteWithVerdict(
        BET,
        await verifyOutput(verifier, await verdictJsonFor(digests, audio)),
        signal,
        paymentHooks(),
      ),
    ).toEqual({ kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' });
  }
  expect(
    await harness.operations.signNoteWithVerdict({ ...BET, token: 'usdc.testnet' }, {}, signal, paymentHooks()),
  ).toEqual({ kind: 'unavailable', detail: 'bet_not_valid' });
  expect(harness.signed).toEqual([]);

  const digests = await noteActionDigests('testnet', 'owner.testnet', BET);
  const accepted = await verifyOutput(verifier, await verdictJsonFor(digests, audio));
  const events: string[] = [];
  expect(
    await harness.operations.signNoteWithVerdict(BET, accepted, signal, paymentHooks(events)),
  ).toEqual({ kind: 'executed', transactionHash: 'tx-ok', approval: 'voice' });
  expect(events).toEqual(['accepted', 'broadcasting']);
  expect(harness.signed).toEqual([
    {
      transaction: {
        receiverId: USDC,
        actions: [
          {
            type: 'FunctionCall',
            methodName: 'ft_transfer_call',
            args: {
              receiver_id: 'pm-notes.testnet',
              amount: '500000',
              msg: JSON.stringify({
                action: 'bet',
                market_id: 9,
                outcome: 'yes',
                verdict_json: accepted.verdict_json,
                signature_b64: accepted.signature_b64,
              }),
            },
            gas: '100000000000000',
            deposit: '1',
          },
        ],
      },
      approval: 'voice',
      policyText: null,
      verdict: { verdictJson: accepted.verdict_json, signatureB64: accepted.signature_b64 },
    },
  ]);
});

test('a bet has no amount limit: the voice alone approves a large bet', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const bet = { ...BET, amountUnits: 10n ** 12n };
  const digests = await noteActionDigests('testnet', 'owner.testnet', bet);
  const output = await verifyOutput(verifier, await verdictJsonFor(digests, await sha256(captured.wav)));
  const events: string[] = [];
  expect(
    await harness.operations.signNoteWithVerdict(
      bet,
      output,
      new AbortController().signal,
      paymentHooks(events),
    ),
  ).toEqual({ kind: 'executed', transactionHash: 'tx-ok', approval: 'voice' });
  expect(events).toEqual(['accepted', 'broadcasting']);
});

// ---------------------------------------------------------------- general transactions

// The actions of the crate's transaction vectors: one `add_message` call with 30 Tgas.
const VECTOR_ACTIONS_HEX =
  '01000000020b0000006164645f6d657373616765100000007b2274657874223a2268656c6c6f227d00e057eb481b000000000000000000000000000000000000';

async function spokenTransaction(summary = 'Sign the guest book.'): Promise<SpokenNoteAction> {
  return {
    kind: 'transaction',
    transaction: {
      receiverId: 'guest-book.testnet',
      actions: [
        {
          type: 'FunctionCall' as never,
          methodName: 'add_message',
          args: { text: 'hello' },
          gas: '30000000000000',
          deposit: '0',
        },
      ],
    },
    actionsSha256: await sha256(new Uint8Array(Buffer.from(VECTOR_ACTIONS_HEX, 'hex'))),
    summary,
    delivery: 'send',
  };
}

test('the general kinds match the transaction and signed message vectors of the crate', async () => {
  const general = VECTORS.requests.filter(
    (vector) => vector.borsh_hex.startsWith('08') || vector.borsh_hex.startsWith('09'),
  );
  expect(general.map((vector) => vector.name)).toEqual([
    'transaction_one_call',
    'transaction_implicit_accounts',
    'signed_message',
  ]);
  const implicit = '3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29';
  const first = await spokenTransaction();
  if (first.kind !== 'transaction') throw new Error('not a transaction');
  const second: SpokenNoteAction = {
    ...first,
    transaction: { ...first.transaction, receiverId: implicit },
    summary: 'Add a new key to my account',
  };
  for (const [vector, owner, action] of [
    [general[0], 'owner.testnet', first],
    [general[1], implicit, second],
  ] as const) {
    expect(noteActionRefusal('testnet', action), vector.name).toBeNull();
    const rendered = renderNoteAction(action);
    expect(hex(await noteActionBorsh('testnet', owner, action)), vector.name).toBe(vector.borsh_hex);
    expect(rendered.displayText, vector.name).toBe(vector.display_text);
    expect(rendered.spokenText, vector.name).toBe(vector.spoken_text);
    const digests = await noteActionDigests('testnet', owner, action);
    expect(hex(digests.request), vector.name).toBe(vector.request_digest_hex);
    expect(hex(digests.spokenText), vector.name).toBe(vector.spoken_text_digest_hex);
  }
  const message = spokenRequestBorsh({
    kind: 'signed_message',
    network: 'testnet',
    owner: 'owner.testnet',
    payloadSha256: new Uint8Array(32).fill(0x41),
    summary: 'Log in to the example app',
  });
  expect(hex(message)).toBe(general[2].borsh_hex);
  expect(hex(await spokenRequestDigest(message))).toBe(general[2].request_digest_hex);
});

test('the action bytes of an unsigned transaction are the bytes after the block hash', () => {
  const actions = Buffer.from(VECTOR_ACTIONS_HEX, 'hex');
  const text = (value: string) => {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(value.length);
    return Buffer.concat([length, Buffer.from(value)]);
  };
  const unsigned = Buffer.concat([
    text('owner.testnet'),
    Buffer.from([0]),
    Buffer.alloc(32, 1),
    Buffer.alloc(8, 2),
    text('guest-book.testnet'),
    Buffer.alloc(32, 3),
    actions,
  ]);
  expect(hex(nearTransactionActionsBorsh(new Uint8Array(unsigned)))).toBe(VECTOR_ACTIONS_HEX);
  // Another key type, or bytes that end before the actions, are not this format.
  const secp = Buffer.from(unsigned);
  secp[4 + 'owner.testnet'.length] = 1;
  expect(() => nearTransactionActionsBorsh(new Uint8Array(secp))).toThrow(RangeError);
  expect(() =>
    nearTransactionActionsBorsh(new Uint8Array(unsigned.subarray(0, unsigned.length - actions.length))),
  ).toThrow(RangeError);
});

test('core signs the application transaction as it is, and sends the summary to the co-signer', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const signal = new AbortController().signal;
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const audio = await sha256(captured.wav);
  const action = await spokenTransaction();
  if (action.kind !== 'transaction') throw new Error('not a transaction');
  expect(await noteVerifyRequest(action)).toEqual({
    kind: 'transaction',
    receiver: 'guest-book.testnet',
    actions_sha256_hex: hex(action.actionsSha256),
    summary: 'Sign the guest book.',
  });

  // The verdict of another summary, another receiver or other actions does not pass.
  for (const other of [
    { ...action, summary: 'Delete the guest book.' },
    { ...action, transaction: { ...action.transaction, receiverId: 'other.testnet' } },
    { ...action, actionsSha256: new Uint8Array(32).fill(9) },
  ]) {
    const digests = await noteActionDigests('testnet', 'owner.testnet', other);
    expect(
      await harness.operations.signNoteWithVerdict(
        action,
        await verifyOutput(verifier, await verdictJsonFor(digests, audio)),
        signal,
        paymentHooks(),
      ),
    ).toEqual({ kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' });
  }
  for (const [bad, reason] of [
    [{ ...action, summary: 'Send 5 NEAR' }, 'summary_not_speakable'],
    [{ ...action, transaction: { ...action.transaction, actions: [] } }, 'transaction_not_valid'],
    [
      { ...action, transaction: { ...action.transaction, receiverId: 'Not An Account' } },
      'transaction_not_valid',
    ],
  ] as const) {
    expect(
      await harness.operations.signNoteWithVerdict(
        bad as SpokenNoteAction,
        {},
        signal,
        paymentHooks(),
      ),
    ).toEqual({ kind: 'unavailable', detail: reason });
  }
  expect(harness.signed).toEqual([]);

  const digests = await noteActionDigests('testnet', 'owner.testnet', action);
  const accepted = await verifyOutput(verifier, await verdictJsonFor(digests, audio));
  expect(
    await harness.operations.signNoteWithVerdict(action, accepted, signal, paymentHooks()),
  ).toEqual({ kind: 'executed', transactionHash: 'tx-ok', approval: 'voice' });
  expect(harness.signed).toEqual([
    {
      transaction: action.transaction,
      approval: 'voice',
      policyText: null,
      verdict: {
        verdictJson: accepted.verdict_json,
        signatureB64: accepted.signature_b64,
        summary: 'Sign the guest book.',
      },
    },
  ]);
});

// ---------------------------------------------------------------- NEP-413 messages

const MESSAGE: SpokenMessageAction = {
  message: 'Log in to example.app at 2026-11-10T09:00:00Z',
  recipient: 'example.app',
  nonce: Buffer.alloc(32, 5).toString('base64'),
  callbackUrl: null,
  state: 'login-1',
  payloadSha256: new Uint8Array(32).fill(0x41),
  summary: 'Log in to the example app',
};

test('the message port matches the signed message vector of the crate', async () => {
  const vector = VECTORS.requests.find((candidate) => candidate.name === 'signed_message');
  if (!vector) throw new Error('no signed_message vector');
  const digests = await messageDigests('testnet', 'owner.testnet', MESSAGE);
  expect(hex(digests.request)).toBe(vector.request_digest_hex);
  expect(hex(digests.spokenText)).toBe(vector.spoken_text_digest_hex);
  expect(messageVerifyRequest(MESSAGE)).toEqual({
    kind: 'signed_message',
    payload_sha256_hex: '41'.repeat(32),
    summary: 'Log in to the example app',
  });
  expect(messageActionRefusal(MESSAGE)).toBeNull();
  expect(messageActionRefusal({ ...MESSAGE, message: '' })).toBe('message_not_valid');
  expect(messageActionRefusal({ ...MESSAGE, recipient: '' })).toBe('message_not_valid');
  expect(messageActionRefusal({ ...MESSAGE, payloadSha256: new Uint8Array(31) })).toBe(
    'message_not_valid',
  );
  expect(messageActionRefusal({ ...MESSAGE, summary: 'Log in at 9' })).toBe('summary_not_speakable');
});

test('core signs one NEP-413 message for the verdict of its exact bytes and summary', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const signal = new AbortController().signal;
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const audio = await sha256(captured.wav);
  const sign = async (verdictFor: SpokenMessageAction, overrides: Record<string, unknown> = {}) =>
    await harness.operations.signMessageWithVerdict(
      MESSAGE,
      await verifyOutput(
        verifier,
        await verdictJsonFor(
          await messageDigests('testnet', 'owner.testnet', verdictFor),
          audio,
          overrides,
        ),
      ),
      signal,
      paymentHooks(),
    );

  // The verdict of other bytes or of another summary does not pass.
  for (const other of [
    { ...MESSAGE, payloadSha256: new Uint8Array(32).fill(0x42) },
    { ...MESSAGE, summary: 'Log in to another app' },
  ]) {
    expect(await sign(other)).toEqual({
      kind: 'refused',
      reason: 'verdict_mismatch',
      detail: 'request_digest differs',
    });
  }
  // The message path has no fresh approval, so a step_up verdict signs nothing.
  expect(await sign(MESSAGE, { outcome: 'step_up', policy_rule: 'rule' })).toEqual({
    kind: 'refused',
    reason: 'verdict_mismatch',
    detail: 'this request has no step-up',
  });
  expect(
    await harness.operations.signMessageWithVerdict(
      { ...MESSAGE, message: '' },
      {},
      signal,
      paymentHooks(),
    ),
  ).toEqual({ kind: 'unavailable', detail: 'message_not_valid' });
  expect(harness.voiceMessages).toEqual([]);

  // A co-signer refusal or another error signs nothing, and the flow may sign after it.
  harness.setMessageError('Speak-to-Sign verdict refused: reused');
  expect(await sign(MESSAGE)).toEqual({
    kind: 'refused',
    reason: 'cosigner_refused',
    detail: 'reused',
  });
  harness.setMessageError('network down');
  expect(await sign(MESSAGE)).toEqual({ kind: 'not_signed', error: 'network down' });
  harness.setMessageError(null);

  const events: string[] = [];
  const accepted = await verifyOutput(
    verifier,
    await verdictJsonFor(await messageDigests('testnet', 'owner.testnet', MESSAGE), audio),
  );
  expect(
    await harness.operations.signMessageWithVerdict(MESSAGE, accepted, signal, paymentHooks(events)),
  ).toEqual({
    kind: 'signed',
    approval: 'voice',
    accountId: 'owner.testnet',
    publicKey: 'ed25519:owner',
    signature: 'c2lnbmF0dXJl',
    nonce: MESSAGE.nonce,
    state: 'login-1',
  });
  expect(events).toEqual(['accepted']);
  expect(harness.voiceMessages).toEqual([
    {
      action: MESSAGE,
      verdict: {
        verdictJson: accepted.verdict_json,
        signatureB64: accepted.signature_b64,
        summary: 'Log in to the example app',
      },
    },
  ]);
  // The flow signs once.
  expect(
    await harness.operations.signMessageWithVerdict(MESSAGE, accepted, signal, paymentHooks()),
  ).toEqual({ kind: 'refused', reason: 'verdict_mismatch', detail: 'this flow already signed' });
});

test('core signs a general transaction without sending it, or as a delegate action', async () => {
  const verifier = await verifierKey();
  const signal = new AbortController().signal;
  const base = await spokenTransaction();
  if (base.kind !== 'transaction') throw new Error('not a transaction');
  const delegateFields = { nonce: '77', maxBlockHeight: '1234567', publicKey: 'ed25519:owner' };
  const run = async (action: SpokenNoteAction, overrides: Record<string, unknown> = {}) => {
    const harness = coreHarness(verifier);
    const captured = await capture(harness.operations);
    if (captured.kind !== 'captured') throw new Error('no clip');
    const output = await verifyOutput(
      verifier,
      await verdictJsonFor(
        await noteActionDigests('testnet', 'owner.testnet', action),
        await sha256(captured.wav),
        overrides,
      ),
    );
    const sign = async () =>
      await harness.operations.signNoteWithVerdict(action, output, signal, paymentHooks());
    return { harness, output, sign };
  };
  const verdictOf = (output: Record<string, unknown>) => ({
    verdictJson: output.verdict_json,
    signatureB64: output.signature_b64,
    summary: 'Sign the guest book.',
  });

  // The delivery is not part of the request: the verdict approves the actions for the receiver.
  const signOnly = await run({ ...base, delivery: 'sign' });
  expect(await signOnly.sign()).toEqual({
    kind: 'signed_transaction',
    signed: { signedTransaction: { transactionHash: 'tx-signed' }, nearAccountId: 'owner.testnet' },
    approval: 'voice',
  });
  expect(signOnly.harness.signedOnly).toEqual([
    { transaction: base.transaction, verdict: verdictOf(signOnly.output) },
  ]);
  expect(signOnly.harness.signed).toEqual([]);

  const delegated = await run({ ...base, delivery: delegateFields });
  expect(await delegated.sign()).toEqual({
    kind: 'signed_delegate',
    signed: { hash: 'delegate-hash', signedDelegate: {}, nearAccountId: 'owner.testnet' },
    approval: 'voice',
  });
  // The sender is the owner of the session, never a value from the application.
  expect(delegated.harness.delegates).toEqual([
    {
      delegate: {
        senderId: 'owner.testnet',
        receiverId: 'guest-book.testnet',
        actions: base.transaction.actions,
        ...delegateFields,
      },
      verdict: verdictOf(delegated.output),
    },
  ]);

  // A delegate action has no fresh approval, so a step_up verdict signs nothing.
  const stepUp = await run({ ...base, delivery: delegateFields }, { outcome: 'step_up', policy_rule: 'rule' });
  expect(await stepUp.sign()).toEqual({
    kind: 'refused',
    reason: 'verdict_mismatch',
    detail: 'this request has no step-up',
  });
  for (const bad of [
    { ...delegateFields, nonce: 'seven' },
    { ...delegateFields, maxBlockHeight: '' },
    { ...delegateFields, publicKey: 'secp256k1:key' },
  ]) {
    const invalid = await run({ ...base, delivery: 'send' });
    expect(
      await invalid.harness.operations.signNoteWithVerdict(
        { ...base, delivery: bad },
        invalid.output,
        signal,
        paymentHooks(),
      ),
    ).toEqual({ kind: 'unavailable', detail: 'transaction_not_valid' });
  }

  // A co-signer refusal or another error signs nothing, and the flow may sign after it.
  const failing = await run({ ...base, delivery: 'sign' });
  failing.harness.setSignError('HTTP 403: Speak-to-Sign verdict refused: request_mismatch');
  expect(await failing.sign()).toEqual({
    kind: 'refused',
    reason: 'cosigner_refused',
    detail: 'request_mismatch',
  });
  failing.harness.setSignError('offline');
  expect(await failing.sign()).toEqual({ kind: 'not_submitted', error: 'offline' });
  failing.harness.setSignError(null);
  expect(await failing.sign()).toMatchObject({ kind: 'signed_transaction' });
});

const TRANSFER: Extract<SpokenIntent, { kind: 'account_transfer' }> = {
  kind: 'account_transfer',
  receiver: 'alice.testnet',
  amountYocto: 25n * 10n ** 24n,
};
const RATING: SpokenNoteAction = {
  kind: 'note_rating',
  contract: 'community-notes.testnet',
  noteId: 3n,
  rating: 'helpful',
};

/** One intent of each kind that core signs. */
async function everyIntent(): Promise<SpokenIntent[]> {
  return [
    TRANSFER,
    NOTE,
    RATING,
    MERGE,
    BET,
    await spokenTransaction(),
    { kind: 'signed_message', message: MESSAGE },
  ];
}

/** Signs `intent` through the operation of host API 10 that takes it. */
async function signIntent(
  operations: SpeakToSignHostOperations,
  intent: SpokenIntent,
  output: unknown,
  hooks: SpeakToSignPaymentHooks = paymentHooks(),
): Promise<{ kind: string; reason?: string; detail?: string }> {
  const signal = new AbortController().signal;
  if (intent.kind === 'account_transfer') {
    return await operations.payWithVerdict(intent, output, signal, hooks);
  }
  if (intent.kind === 'signed_message') {
    return await operations.signMessageWithVerdict(intent.message, output, signal, hooks);
  }
  return await operations.signNoteWithVerdict(intent, output, signal, hooks);
}

function nothingSigned(harness: CoreHarness): void {
  expect(harness.signed).toEqual([]);
  expect(harness.signedOnly).toEqual([]);
  expect(harness.delegates).toEqual([]);
  expect(harness.voiceMessages).toEqual([]);
}

test('a verdict for one kind signs no intent of another kind', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const audio = await sha256(captured.wav);
  const intents = await everyIntent();
  for (const verdictFor of intents) {
    const digests = await intentDigests('testnet', 'owner.testnet', verdictFor);
    const output = await verifyOutput(verifier, await verdictJsonFor(digests, audio));
    for (const intent of intents) {
      if (intent === verdictFor) continue;
      expect(
        await signIntent(harness.operations, intent, output),
        `${verdictFor.kind} verdict, ${intent.kind} intent`,
      ).toEqual({ kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' });
    }
  }
  nothingSigned(harness);
});

test('a verdict with the request of the intent and other spoken words signs nothing, for each kind', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const audio = await sha256(captured.wav);
  for (const intent of await everyIntent()) {
    const digests = await intentDigests('testnet', 'owner.testnet', intent);
    const otherWords = { ...digests, spokenText: await spokenTextDigest('send all my near to mallory') };
    const output = await verifyOutput(verifier, await verdictJsonFor(otherWords, audio));
    expect(await signIntent(harness.operations, intent, output), intent.kind).toEqual({
      kind: 'refused',
      reason: 'verdict_mismatch',
      detail: 'spoken_text_digest differs',
    });
  }
  nothingSigned(harness);
});

test('core refuses a transfer that the sentence cannot say, before it reads a verdict', async () => {
  const verifier = await verifierKey();
  const harness = coreHarness(verifier);
  const captured = await capture(harness.operations);
  if (captured.kind !== 'captured') throw new Error('no clip');
  const audio = await sha256(captured.wav);
  const NEAR_HUNDREDTH = 10n ** 22n;
  const cases: Array<[Extract<SpokenIntent, { kind: 'account_transfer' }>, string]> = [
    [{ ...TRANSFER, amountYocto: 0n }, 'amount_not_speakable'],
    [{ ...TRANSFER, amountYocto: NEAR_HUNDREDTH / 2n }, 'amount_not_speakable'],
    [{ ...TRANSFER, amountYocto: NEAR_HUNDREDTH + 1n }, 'amount_not_speakable'],
    [{ ...TRANSFER, amountYocto: 100_000_001n * NEAR_HUNDREDTH }, 'amount_not_speakable'],
    [{ ...TRANSFER, receiver: 'ab'.repeat(32) }, 'receiver_not_speakable'],
  ];
  for (const [intent, detail] of cases) {
    // Even a verdict of the verifier for exactly this request signs nothing.
    const digests = await intentDigests('testnet', 'owner.testnet', intent);
    const output = await verifyOutput(verifier, await verdictJsonFor(digests, audio));
    expect(await signIntent(harness.operations, intent, output), detail).toEqual({
      kind: 'unavailable',
      detail,
    });
  }
  nothingSigned(harness);
});

test('only a plain transfer tells the card that a block holds it', async () => {
  const verifier = await verifierKey();
  for (const intent of [TRANSFER, NOTE, BET] as const) {
    const harness = coreHarness(verifier);
    const captured = await capture(harness.operations);
    if (captured.kind !== 'captured') throw new Error('no clip');
    const digests = await intentDigests('testnet', 'owner.testnet', intent);
    const output = await verifyOutput(
      verifier,
      await verdictJsonFor(digests, await sha256(captured.wav)),
    );
    const events: string[] = [];
    const result = await signIntent(harness.operations, intent, output, paymentHooks(events));
    expect(result.kind).toBe('executed');
    expect(harness.signed).toHaveLength(1);
    expect(events.includes('included:tx-included'), intent.kind).toBe(
      intent.kind === 'account_transfer',
    );
  }
});

test('the co-signer path of each typed kind gives the request of the core path', async () => {
  const typed: SpokenTypedFields[] = [TRANSFER, NOTE, RATING, MERGE, BET].filter(
    (intent): intent is SpokenTypedFields => intent.kind !== 'transaction',
  );
  expect(typed.map((fields) => fields.kind).sort()).toEqual([...SPOKEN_TYPED_KINDS].sort());
  const verdict = { verdictJson: '{"outcome":"accept"}', signatureB64: 'c2ln' };
  for (const fields of typed) {
    const call = SPOKEN_KINDS[fields.kind].call(fields as never, verdict);
    // The co-signer reads the arguments as the JSON of the signed bytes.
    const signedCall: SignedSpokenCall =
      call.kind === 'transfer'
        ? call
        : {
            kind: 'function_call',
            receiverId: call.receiverId,
            methodName: call.methodName,
            args: JSON.parse(JSON.stringify(call.args)),
            depositYocto: call.depositYocto,
          };
    const fromBytes = await spokenRequestOfCall(signedCall, 'testnet', 'owner.testnet');
    if (!fromBytes) throw new Error(`no request for the call of ${fields.kind}`);
    const fromFields = await spokenRequestOfFields(fields, 'testnet', 'owner.testnet');
    expect(hex(spokenRequestBorsh(fromBytes)), fields.kind).toBe(hex(spokenRequestBorsh(fromFields)));
    // A deposit that the kind does not have is the call of no kind.
    if (signedCall.kind === 'function_call') {
      const withDeposit = { ...signedCall, depositYocto: signedCall.depositYocto + 1n };
      expect(await spokenRequestOfCall(withDeposit, 'testnet', 'owner.testnet'), fields.kind).toBeNull();
    }
  }
});
