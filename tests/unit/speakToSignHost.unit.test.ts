import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type {
  SpeakToSignClip,
  SpeakToSignClipRequest,
  SpeakToSignHostOperations,
  SpeakToSignPayment,
  SpeakToSignPaymentHooks,
  SpeakToSignVerifyReply,
} from '@/core/transactionFeatures/hostPlugin';
import type {
  AuthMethodPhraseRecording,
  PhraseChoice,
  PhraseView,
} from '@/core/authMethods/hostPlugin';
import { createSpeakToSignHostOperations } from '@/core/transactionFeatures/hostOperations';
import {
  isSpeakableAccount,
  parseSpeakableNear,
  renderTransfer,
  requestDigest,
  sha256,
  spokenTextDigest,
  transferBorsh,
  type SpokenTransferRequest,
} from '@/core/transactionFeatures/spokenTransfer';
import {
  checkVoiceVerdict,
  parseVerifyOutput,
  type VoiceApproval,
} from '@/core/transactionFeatures/voiceVerdict';
import { MAX_SAMPLES, pcm16Wav } from '@/core/transactionFeatures/wav';
import type { Variant } from '@shared/utils/variant';
import type { ActionResult } from '@/core/types/seams';
import type { TransactionInput } from '@/core/types/actions';
import { runSpokenTransfer, type HostTransfer } from '../../packages/speak-to-sign/src/host/flow';

const VECTORS = JSON.parse(
  readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../crates/spoken-intent/fixtures/spoken_intent_vectors_v1.json',
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

// The shared signed verdicts of the verifier repository (voice-verifier/testdata/
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
        'vfrIu+yJYH164Ll3UiREYZnd/ik0X9pj9kzYZcGlI6PyJ1HcKNeBafwnC/P0FfmrbxaNQHDxrrMzFDPKYND6DA==',
      verdictJson:
        '{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.3.0","request_digest":"uZOKUB3jJyRz6iwZ1QlcKFcBr-80sXinJ3qOIddBKws","spoken_text_digest":"mXyNIbv5LxxXrBYm8D7wwAzrBHu_o3XI0GAGdf5GNys","audio_digest":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","outcome":"accept","reason":null,"policy_rule":null,"expires_at_ms":1762700120000,"speaker_score_milli":655,"word_margin_milli":142,"heard":"send two near to alice dot testnet"}',
    },
    {
      approval: 'voice_and_passkey',
      amountYocto: 11n * 10n ** 24n,
      borshHex:
        '02000d0000006f776e65722e746573746e65740d000000616c6963652e746573746e6574000000eb35cee2315719090000000000',
      policyText: 'A voice payment above 10 NEAR needs a passkey.',
      signatureB64:
        'gCXP2wB240PkUcNyAs9ed2qFgkv7GbDXBanrfeQbwoYBRhbYBkApkh3CHMLx4goD9CCZ+rvBBA1nSBtlOSaxCA==',
      verdictJson:
        '{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.3.0","request_digest":"xTpQSL__LHZZRfNdeEwE8xBW2VIiL53H0hinjaH77zs","spoken_text_digest":"KdZpMUdca0NXjyOA-Yb-xDz9T-Qho91FY8ZYpt-0AZk","audio_digest":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","outcome":"step_up","reason":null,"policy_rule":"stub_voice_amount_above_10_near","expires_at_ms":1762700120000,"speaker_score_milli":655,"word_margin_milli":142,"heard":"send eleven near to alice dot testnet"}',
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
  const rendered = renderTransfer(request);
  return JSON.stringify({
    kind: 'seams_voice_signed_verdict_v2',
    renderer: 'spoken-intent/1',
    verifier: '0.3.0',
    request_digest: b64u(await requestDigest(request)),
    spoken_text_digest: b64u(await spokenTextDigest(rendered)),
    audio_digest: b64u(audioDigest),
    outcome: 'accept',
    reason: null,
    policy_rule: null,
    expires_at_ms: NOW_MS + 120_000,
    speaker_score_milli: 612,
    word_margin_milli: 214,
    heard: rendered.spokenText,
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
    expect(hex(await requestDigest(request)), vector.name).toBe(vector.request_digest_hex);
    expect(hex(await spokenTextDigest(rendered)), vector.name).toBe(vector.spoken_text_digest_hex);
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
        request,
        verifier: { project: PROJECT, publicKey: SIGNED_VECTORS.publicKey },
        recordedAudio: new Set([SIGNED_VECTORS.audioDigest]),
        nowMs: SIGNED_VECTORS.expiresAtMs - 60_000,
      }),
      vector.approval,
    ).toEqual({ kind: 'approved', approval: vector.approval, policyText: vector.policyText });
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
      request,
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
      request,
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

// ---------------------------------------------------------------- flow

type FakeCore = {
  operations: SpeakToSignHostOperations;
  sentences: string[];
  verifyInputs: Array<Readonly<Record<string, unknown>>>;
  payments: Array<{ receiver: string; amountYocto: bigint; output: unknown }>;
  /** Each view the flow showed, as `kind:label:headline or caption`. */
  views: string[];
  closed: number;
};

function fakeCore(input: {
  reply?: SpeakToSignVerifyReply;
  payment?: SpeakToSignPayment;
  /** Payments after the first one, for a flow that records again. */
  payments?: readonly SpeakToSignPayment[];
  missing?: readonly string[];
  clip?: SpeakToSignClip;
  /** The owner's answers to result views, in order. The default closes the card. */
  choices?: PhraseChoice[];
}): FakeCore {
  const choices = [...(input.choices ?? [])];
  const payments = [...(input.payments ?? [])];
  const core: FakeCore = {
    sentences: [],
    verifyInputs: [],
    payments: [],
    views: [],
    closed: 0,
    operations: {
      async openPrompt(request: SpeakToSignClipRequest) {
        core.sentences.push(request.sentence);
        return {
          kind: 'opened',
          prompt: {
            record: async () => input.clip ?? clip(),
            show: async (view: PhraseView) => {
              core.views.push(viewName(view));
              return view.kind === 'check' ? 'replaced' : (choices.shift() ?? 'closed');
            },
            close: () => {
              core.closed += 1;
            },
          },
        };
      },
      async receiverExists(accountId) {
        return !input.missing?.includes(accountId);
      },
      async verify(verifierInput) {
        core.verifyInputs.push(verifierInput);
        return input.reply ?? { kind: 'output', output: { verdict: 'opaque' } };
      },
      async payWithVerdict(transfer, output, _signal, hooks) {
        const payment =
          (core.payments.length > 0 ? payments.shift() : undefined) ??
          input.payment ??
          ({ kind: 'executed', transactionHash: 'tx-hash', approval: 'voice' } as const);
        core.payments.push({ ...transfer, output });
        if (payment.kind === 'executed' && payment.approval === 'voice') hooks.accepted();
        if (payment.kind === 'executed' && payment.approval === 'voice_and_passkey') {
          if (!(await hooks.approveStepUp('A voice payment above 10 NEAR needs a passkey.'))) {
            return { kind: 'cancelled' };
          }
          hooks.broadcasting();
        }
        return payment;
      },
      async authorizeEnrollment() {
        throw new Error('A spoken payment authorizes no enrollment.');
      },
    },
  };
  return core;
}

function viewName(view: PhraseView): string {
  return view.kind === 'check'
    ? `check:${view.caption}`
    : `result:${view.label}:${view.headline}:${view.action.label}`;
}

function hostTransfer(core: FakeCore, overrides: Partial<HostTransfer> = {}): HostTransfer {
  return {
    ownerAccountId: 'owner.testnet',
    receiver: 'alice.testnet',
    amount: '25',
    surfaceMeasurementBinding: { kind: 'disabled' },
    operations: core.operations,
    ...overrides,
  };
}

function transferInput(transfer: HostTransfer) {
  return {
    walletId: 'owner.testnet' as never,
    network: 'testnet' as const,
    signal: new AbortController().signal,
    transfer,
  };
}

test('a spoken payment verifies the typed transfer and lets core pay with the verdict', async () => {
  const core = fakeCore({});
  const result = await runSpokenTransfer(transferInput(hostTransfer(core)));
  expect(result).toMatchObject({ kind: 'sent', transactionHash: 'tx-hash', approval: 'voice' });
  expect(core.sentences).toEqual(['Send 25 NEAR to alice.testnet']);
  expect(core.verifyInputs).toEqual([
    {
      op: 'verify',
      owner: 'owner.testnet',
      request: {
        kind: 'transfer',
        receiver: 'alice.testnet',
        amount_yocto: '25000000000000000000000000',
      },
      contacts: [],
      audio_wav_b64: Buffer.from(clip().wav).toString('base64'),
    },
  ]);
  expect(core.payments).toEqual([
    { receiver: 'alice.testnet', amountYocto: 25n * 10n ** 24n, output: { verdict: 'opaque' } },
  ]);

  expect(core.views).toEqual([
    'check:Checking your voice and words',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);
  expect(core.closed).toBe(1);

  const stepUp = fakeCore({
    payment: { kind: 'executed', transactionHash: 'tx-2', approval: 'voice_and_passkey' },
    choices: ['action'],
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(stepUp)))).toMatchObject({
    kind: 'sent',
    approval: 'voice_and_passkey',
  });
  expect(stepUp.views).toEqual([
    'check:Checking your voice and words',
    'result:Not sent yet:Confirm with your passkey:Confirm with passkey',
    'result:Not sent yet:Confirm with your passkey:Confirm with passkey',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);

  // Closing the step-up question signs nothing.
  const declined = fakeCore({
    payment: { kind: 'executed', transactionHash: 'tx-3', approval: 'voice_and_passkey' },
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(declined)))).toEqual({
    kind: 'cancelled',
  });
});

test('a refusal shows on the card, and "Try again" records the sentence again', async () => {
  const core = fakeCore({
    payment: { kind: 'refused', reason: 'words', detail: 'heard: send 0.1 near to alice.testnet' },
    payments: [{ kind: 'executed', transactionHash: 'tx-4', approval: 'voice' }],
    choices: ['action'],
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(core)))).toMatchObject({
    kind: 'sent',
    transactionHash: 'tx-4',
  });
  expect(core.views).toEqual([
    'check:Checking your voice and words',
    'result:Nothing was sent:The words did not match:Try again',
    'check:Checking your voice and words',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);
  expect(core.verifyInputs).toHaveLength(2);
  expect(core.closed).toBe(1);
});

test('nothing is paid for a bad request, a missing receiver, a refusal or a failed route', async () => {
  const cases: Array<[string, Parameters<typeof fakeCore>[0], Partial<HostTransfer>, object]> = [
    ['implicit receiver', {}, { receiver: 'a'.repeat(64) }, { reason: 'receiver_not_speakable' }],
    [
      'missing receiver',
      { missing: ['carol.testnet'] },
      { receiver: 'carol.testnet' },
      { kind: 'refused', reason: 'receiver_missing' },
    ],
    ['unspeakable amount', {}, { amount: '0.001' }, { reason: 'amount_not_speakable' }],
    [
      'verify route failure',
      { reply: { kind: 'failed', code: 'verifier_timeout' } },
      {},
      { kind: 'unavailable', reason: 'verifier_unavailable', detail: 'verifier_timeout' },
    ],
  ];
  for (const [name, coreInput, overrides, expected] of cases) {
    const core = fakeCore(coreInput);
    const result = await runSpokenTransfer(transferInput(hostTransfer(core, overrides)));
    expect(result, name).toMatchObject(expected);
    expect(core.payments, name).toEqual([]);
  }
});

test('core refusals, a failed transfer and recording problems map to results', async () => {
  const outcomes: Array<[SpeakToSignPayment, object]> = [
    [
      { kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' },
      { kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' },
    ],
    [{ kind: 'refused', reason: 'speaker' }, { kind: 'refused', reason: 'speaker' }],
    [
      { kind: 'reverted', transactionHash: 'tx', error: 'NotEnoughBalance' },
      { kind: 'refused', reason: 'transaction_failed', detail: 'NotEnoughBalance' },
    ],
    [
      { kind: 'not_submitted', error: 'closed' },
      { kind: 'unavailable', reason: 'not_submitted', detail: 'closed' },
    ],
    [
      { kind: 'unavailable', detail: 'This network has no verifier.' },
      {
        kind: 'unavailable',
        reason: 'verifier_unavailable',
        detail: 'This network has no verifier.',
      },
    ],
  ];
  for (const [payment, expected] of outcomes) {
    const core = fakeCore({ payment });
    expect(await runSpokenTransfer(transferInput(hostTransfer(core))), payment.kind).toEqual(
      expected,
    );
  }

  const cancelled = fakeCore({ clip: { kind: 'cancelled' } });
  expect(await runSpokenTransfer(transferInput(hostTransfer(cancelled)))).toEqual({
    kind: 'cancelled',
  });
  expect(cancelled.verifyInputs).toEqual([]);
  const missing = fakeCore({
    clip: { kind: 'unavailable', detail: 'VoiceID is missing from this Wallet host.' },
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(missing)))).toEqual({
    kind: 'unavailable',
    reason: 'voiceid_unavailable',
    detail: 'VoiceID is missing from this Wallet host.',
  });
});

// ---------------------------------------------------------------- core host operations

type CoreHarness = {
  operations: SpeakToSignHostOperations;
  signed: Array<{ transaction: TransactionInput; approval: VoiceApproval; policyText: unknown }>;
  messages: Array<{ message: string; recipient: string }>;
  fetched: Array<{ url: string; init: RequestInit }>;
  setOutcome(outcome: ActionResult): void;
  setRecording(recording: () => Promise<AuthMethodPhraseRecording>): void;
};

function coreHarness(verifier: Verifier): CoreHarness {
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
      signVoiceApprovedTransaction: async (transaction, approval, policyText, _, onBroadcast) => {
        harness.signed.push({ transaction, approval, policyText });
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
      fetch: (async (url: URL, init: RequestInit) => {
        harness.fetched.push({ url: String(url), init });
        return Response.json({ ok: true, output: { verdict_json: '{}' }, timing: {} });
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
    output: { verdict_json: '{}' },
  });
  expect(harness.fetched[0].url).toBe('https://relay.example.test/speak-to-sign/v1/verify');
  expect(harness.fetched[0].init.body).toBe('{"input":{"op":"verify"}}');
  expect(new Headers(harness.fetched[0].init.headers).get('authorization')).toBe(
    'Bearer credential-1',
  );
});

test('core pays an approved verdict once, from the owner, with the approval it names', async () => {
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
    },
  ]);
  expect(await pay(accept)).toEqual({
    kind: 'refused',
    reason: 'verdict_mismatch',
    detail: 'verdict already used',
  });

  const stepUpJson = await verdictJson(transferRequest(), audio, {
    outcome: 'step_up',
    policy_rule: 'stub_voice_amount_above_10_near',
    speaker_score_milli: 700,
  });
  const stepUp = await verifyOutput(verifier, stepUpJson, {
    policy_text: 'A voice payment above 10 NEAR needs a passkey.',
  });
  harness.setOutcome({
    success: true,
    transactionId: 'tx-bad',
    result: {
      status: { SuccessValue: '' },
      receipts_outcome: [{ outcome: { status: { Failure: { error: 'NotEnoughBalance' } } } }],
    } as never,
  });
  expect(await pay(stepUp)).toEqual({
    kind: 'reverted',
    transactionHash: 'tx-bad',
    error: '{"error":"NotEnoughBalance"}',
  });
  expect(harness.signed.at(-1)).toMatchObject({
    approval: 'voice_and_passkey',
    policyText: 'A voice payment above 10 NEAR needs a passkey.',
  });
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
