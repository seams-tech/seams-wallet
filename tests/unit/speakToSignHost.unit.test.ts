import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type {
  SpeakToSignClip,
  SpeakToSignClipRequest,
  SpeakToSignHostOperations,
  SpeakToSignSubmission,
  SpeakToSignVaultTransferArgs,
  SpeakToSignVerifyReply,
} from '@/core/transactionFeatures/hostPlugin';
import type { AuthMethodPhraseRecording } from '@/core/authMethods/hostPlugin';
import { createSpeakToSignHostOperations } from '@/core/transactionFeatures/hostOperations';
import { MAX_SAMPLES, pcm16Wav } from '@/core/transactionFeatures/wav';
import type { Variant } from '@shared/utils/variant';
import type { ActionResult } from '@/core/types/seams';
import type { TransactionInput } from '@/core/types/actions';
import { runSpokenTransfer, type HostTransfer } from '../../packages/speak-to-sign/src/host/flow';
import {
  isSpeakableAccount,
  parseSpeakableNear,
  renderTransfer,
  requestDigest,
  sha256,
  spokenTextDigest,
  transferBorsh,
  type VaultTransferRequest,
} from '../../packages/speak-to-sign/src/host/intent';
import {
  parseVaultState,
  transferArgs,
  verifyInput,
} from '../../packages/speak-to-sign/src/host/request';
import { checkVerdict, parseVerifyOutput } from '../../packages/speak-to-sign/src/host/verdict';

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

// The shared signed verdict of the verifier repository (voice-verifier/testdata/signed_verdict_v1.json).
// Its audio digest is 32 bytes of 7; the key is a test key.
const SIGNED_VECTOR = {
  request: {
    network: 'testnet',
    vault: 'voicevault.testnet',
    owner: 'owner.testnet',
    receiver: 'alice.testnet',
    amountYocto: 2n * 10n ** 24n,
    nonce: 0n,
  } satisfies VaultTransferRequest,
  publicKey: 'ed25519:2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ',
  signatureB64:
    '3nCw5BVsbZ1fJfBPX1vISaytZeceqEJ+ZF0TysHlmp8Lx0cG+/ywT4lD5Pdl4998jLGZ1oJhEgvkauKOUo0gBg==',
  verdictJson:
    '{"kind":"seams_voice_signed_verdict_v1","renderer":"spoken-intent/1","verifier":"0.2.0","request_digest":"ga8UThNF5zyPNbqEK43J91KzMRLJwZ9tuuRNtcmvYXQ","spoken_text_digest":"mXyNIbv5LxxXrBYm8D7wwAzrBHu_o3XI0GAGdf5GNys","audio_digest":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","outcome":"accept","reason":null,"speaker_score_milli":655,"word_margin_milli":142,"heard":"send two near to alice dot testnet"}',
};

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
        new TextEncoder().encode(`seams:outlayer:voice-verdict:v1${verdictJson}`),
      );
      const signature = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, message);
      return Buffer.from(signature).toString('base64');
    },
  };
}

function transferRequest(overrides: Partial<VaultTransferRequest> = {}): VaultTransferRequest {
  return {
    network: 'testnet',
    vault: 'voicevault.testnet',
    owner: 'owner.testnet',
    receiver: 'alice.testnet',
    amountYocto: 25n * 10n ** 24n,
    nonce: 4n,
    ...overrides,
  };
}

/** A verdict in the verifier's field order, with the digests of `request` and `audioDigest`. */
async function verdictJson(
  request: VaultTransferRequest,
  audioDigest: Uint8Array,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const rendered = renderTransfer(request);
  return JSON.stringify({
    kind: 'seams_voice_signed_verdict_v1',
    renderer: 'spoken-intent/1',
    verifier: '0.2.0',
    request_digest: b64u(await requestDigest(request)),
    spoken_text_digest: b64u(await spokenTextDigest(rendered)),
    audio_digest: b64u(audioDigest),
    outcome: 'accept',
    reason: null,
    speaker_score_milli: 612,
    word_margin_milli: 214,
    heard: rendered.spokenText,
    ...overrides,
  });
}

async function verifyOutput(verifier: Verifier, json: string, publicKey = verifier.publicKey) {
  return {
    kind: 'seams_voice_verify_output_v1',
    verdict_json: json,
    signature_b64: await verifier.sign(json),
    public_key: publicKey,
    ms: { total: 4100 },
    detail: null,
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

type FakeVault = {
  operations: SpeakToSignHostOperations;
  sentences: string[];
  verifyInputs: Array<Readonly<Record<string, unknown>>>;
  submitted: SpeakToSignVaultTransferArgs[];
};

function fakeVault(input: {
  verifier: Verifier;
  reply: (verifierInput: Readonly<Record<string, unknown>>) => Promise<SpeakToSignVerifyReply>;
  submission?: SpeakToSignSubmission;
  contacts?: Array<{ account_id: string; active: boolean }>;
  clip?: SpeakToSignClip;
}): FakeVault {
  const vault: FakeVault = {
    sentences: [],
    verifyInputs: [],
    submitted: [],
    operations: {
      async captureClip(request: SpeakToSignClipRequest) {
        vault.sentences.push(request.sentence);
        return input.clip ?? clip();
      },
      async viewVault(view) {
        if (view === 'get_vault') return { next_nonce: '4', limit_yocto: '0' };
        if (view === 'get_contacts') {
          return (
            input.contacts ?? [
              { account_id: 'alice.testnet', active: true },
              { account_id: 'bob.testnet', active: false },
            ]
          );
        }
        return { verifier_public_key: input.verifier.publicKey };
      },
      async verify(verifierInput) {
        vault.verifyInputs.push(verifierInput);
        return await input.reply(verifierInput);
      },
      async submitTransfer(args) {
        vault.submitted.push(args);
        return input.submission ?? { kind: 'executed', transactionHash: 'tx-hash' };
      },
      async authorizeEnrollment() {
        throw new Error('A spoken payment authorizes no enrollment.');
      },
    },
  };
  return vault;
}

function hostTransfer(vault: FakeVault, overrides: Partial<HostTransfer> = {}): HostTransfer {
  return {
    ownerAccountId: 'owner.testnet',
    receiver: 'alice.testnet',
    amount: '25',
    surfaceMeasurementBinding: { kind: 'disabled' },
    operations: vault.operations,
    ...overrides,
  };
}

function transferInput(transfer: HostTransfer) {
  return {
    walletId: 'owner.testnet' as never,
    vault: 'voicevault.testnet',
    network: 'testnet' as const,
    signal: new AbortController().signal,
    transfer,
  };
}

/** Signs an accepted verdict for whatever request and audio the verify input names. */
function acceptingVerifier(verifier: Verifier) {
  return async (
    verifierInput: Readonly<Record<string, unknown>>,
  ): Promise<SpeakToSignVerifyReply> => {
    const wav = Buffer.from(String(verifierInput.audio_wav_b64), 'base64');
    const request = transferRequest({
      receiver: String(verifierInput.receiver),
      amountYocto: BigInt(String(verifierInput.amount_yocto)),
      nonce: BigInt(Number(verifierInput.nonce)),
    });
    const json = await verdictJson(request, await sha256(new Uint8Array(wav)));
    return { kind: 'output', output: await verifyOutput(verifier, json) };
  };
}

/** The fields of a `SpokenRequestV1::VaultTransfer` Borsh vector. */
function decodeTransferBorsh(borshHex: string): VaultTransferRequest {
  const bytes = Buffer.from(borshHex, 'hex');
  let at = 2;
  const text = (): string => {
    const length = bytes.readUInt32LE(at);
    const value = bytes.subarray(at + 4, at + 4 + length).toString('utf8');
    at += 4 + length;
    return value;
  };
  const network = bytes[1] === 0 ? 'testnet' : 'mainnet';
  const vault = text();
  const owner = text();
  const receiver = text();
  const amountYocto = bytes.readBigUInt64LE(at) + (bytes.readBigUInt64LE(at + 8) << 64n);
  const nonce = bytes.readBigUInt64LE(at + 16);
  return { network, vault, owner, receiver, amountYocto, nonce };
}

// ---------------------------------------------------------------- spoken-intent port

test('the transfer port matches every vault transfer vector of the spoken-intent crate', async () => {
  const transfers = VECTORS.requests.filter((vector) => vector.borsh_hex.startsWith('00'));
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

test('the shared signed verdict vector passes the local check', async () => {
  const output = parseVerifyOutput({
    verdict_json: SIGNED_VECTOR.verdictJson,
    signature_b64: SIGNED_VECTOR.signatureB64,
    public_key: SIGNED_VECTOR.publicKey,
    ms: {},
  });
  expect(output).not.toBeNull();
  const check = await checkVerdict({
    output: output!,
    request: SIGNED_VECTOR.request,
    audioDigest: new Uint8Array(32).fill(7),
    pinnedVerifierKey: SIGNED_VECTOR.publicKey,
  });
  expect(check).toEqual({
    kind: 'accepted',
    verdictJson: SIGNED_VECTOR.verdictJson,
    signatureB64: SIGNED_VECTOR.signatureB64,
  });
});

test('the local check refuses a verdict that does not bind this request, audio and key', async () => {
  const verifier = await verifierKey();
  const other = await verifierKey();
  const request = transferRequest();
  const audioDigest = await sha256(clip().wav);
  const check = async (output: unknown, pinned = verifier.publicKey, digest = audioDigest) =>
    await checkVerdict({
      output: parseVerifyOutput(output)!,
      request,
      audioDigest: digest,
      pinnedVerifierKey: pinned,
    });
  const valid = await verdictJson(request, audioDigest);

  expect((await check(await verifyOutput(verifier, valid))).kind).toBe('accepted');
  expect(await check(await verifyOutput(verifier, valid), other.publicKey)).toEqual({
    kind: 'mismatch',
    detail: 'verdict key is not the vault verifier key',
  });
  expect(await check(await verifyOutput(other, valid, verifier.publicKey))).toEqual({
    kind: 'mismatch',
    detail: 'verdict signature is invalid',
  });
  expect(await check({ ...(await verifyOutput(verifier, valid)), signature_b64: null })).toEqual({
    kind: 'mismatch',
    detail: 'verdict key is not the vault verifier key',
  });
  const nextNonce = await verdictJson(transferRequest({ nonce: 5n }), audioDigest);
  expect(await check(await verifyOutput(verifier, nextNonce))).toEqual({
    kind: 'mismatch',
    detail: 'request_digest differs',
  });
  expect(
    await check(await verifyOutput(verifier, valid), verifier.publicKey, new Uint8Array(32)),
  ).toEqual({ kind: 'mismatch', detail: 'audio_digest differs' });
  const unsigned = await verdictJson(request, audioDigest, { kind: 'seams_voice_verdict_v1' });
  expect(await check(await verifyOutput(verifier, unsigned))).toEqual({
    kind: 'mismatch',
    detail: 'unknown verdict kind',
  });
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
    await checkVerdict({
      output: parseVerifyOutput(await verifyOutput(verifier, refusal))!,
      request,
      audioDigest: new Uint8Array(32),
      pinnedVerifierKey: verifier.publicKey,
    }),
  ).toEqual({
    kind: 'refused',
    reason: 'words',
    detail: 'heard: send fifty five near to alice dot testnet',
  });
  expect(parseVerifyOutput({ signature_b64: 'x' })).toBeNull();
});

// ---------------------------------------------------------------- request building

test('the verify input and the vault call match the demo client', () => {
  const request = transferRequest();
  const wav = Uint8Array.of(1, 2, 3);
  expect(verifyInput(request, ['alice.testnet', 'bob.testnet'], wav)).toEqual({
    op: 'verify',
    vault: 'voicevault.testnet',
    owner: 'owner.testnet',
    receiver: 'alice.testnet',
    amount_yocto: '25000000000000000000000000',
    nonce: 4,
    contacts: ['alice.testnet', 'bob.testnet'],
    audio_wav_b64: 'AQID',
  });
  expect(transferArgs(request, '{"kind":"v"}', 'c2ln')).toEqual({
    receiver_id: 'alice.testnet',
    amount: '25000000000000000000000000',
    nonce: '4',
    verdict_json: '{"kind":"v"}',
    signature_b64: 'c2ln',
  });
});

test('the vault state keeps every contact for the confusion set and marks the active ones', () => {
  const state = parseVaultState({
    vault: { next_nonce: '7' },
    contacts: [
      { account_id: 'alice.testnet', active: true },
      { account_id: 'bob.testnet', active: false },
    ],
    verifier: { verifier_public_key: 'ed25519:abc' },
  });
  expect(state).toEqual({
    nonce: 7n,
    contacts: ['alice.testnet', 'bob.testnet'],
    activeContacts: new Set(['alice.testnet']),
    verifierPublicKey: 'ed25519:abc',
  });
  expect(
    parseVaultState({
      vault: { next_nonce: '-1' },
      contacts: [],
      verifier: { verifier_public_key: 'ed25519:a' },
    }),
  ).toBeNull();
  expect(
    parseVaultState({
      vault: { next_nonce: 1 },
      contacts: {},
      verifier: { verifier_public_key: 'ed25519:a' },
    }),
  ).toBeNull();
});

// ---------------------------------------------------------------- flow

test('an accepted spoken payment sends one transfer_with_verdict with the signed verdict', async () => {
  const verifier = await verifierKey();
  const vault = fakeVault({ verifier, reply: acceptingVerifier(verifier) });
  const result = await runSpokenTransfer(transferInput(hostTransfer(vault)));
  expect(result).toMatchObject({ kind: 'sent', transactionHash: 'tx-hash' });
  expect(vault.sentences).toEqual(['Send 25 NEAR to alice.testnet']);
  expect(vault.verifyInputs).toHaveLength(1);
  expect(vault.verifyInputs[0]).toMatchObject({
    op: 'verify',
    receiver: 'alice.testnet',
    nonce: 4,
    contacts: ['alice.testnet', 'bob.testnet'],
  });
  expect(vault.submitted).toHaveLength(1);
  expect(vault.submitted[0]).toMatchObject({ receiver_id: 'alice.testnet', nonce: '4' });
  expect(JSON.parse(vault.submitted[0].verdict_json).outcome).toBe('accept');
});

test('nothing reaches the vault unless the verdict passes the local check', async () => {
  const verifier = await verifierKey();
  const impostor = await verifierKey();
  const cases: Array<[string, Parameters<typeof fakeVault>[0], Partial<HostTransfer>, object]> = [
    [
      'inactive contact',
      { verifier, reply: acceptingVerifier(verifier) },
      { receiver: 'bob.testnet' },
      { kind: 'refused', reason: 'receiver_not_contact' },
    ],
    [
      'unspeakable amount',
      { verifier, reply: acceptingVerifier(verifier) },
      { amount: '0.001' },
      { kind: 'refused', reason: 'amount_not_speakable' },
    ],
    [
      'key not pinned',
      { verifier, reply: acceptingVerifier(impostor) },
      {},
      { kind: 'refused', reason: 'verdict_mismatch' },
    ],
    [
      'verify route failure',
      { verifier, reply: async () => ({ kind: 'failed', code: 'verifier_timeout' }) },
      {},
      { kind: 'unavailable', reason: 'verifier_unavailable', detail: 'verifier_timeout' },
    ],
  ];
  for (const [name, vaultInput, overrides, expected] of cases) {
    const vault = fakeVault(vaultInput);
    const result = await runSpokenTransfer(transferInput(hostTransfer(vault, overrides)));
    expect(result, name).toMatchObject(expected);
    expect(vault.submitted, name).toEqual([]);
  }
});

test('a cancelled or unavailable recording verifies nothing, and a vault revert is a refusal', async () => {
  const verifier = await verifierKey();
  const cancelled = fakeVault({
    verifier,
    reply: acceptingVerifier(verifier),
    clip: { kind: 'cancelled' },
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(cancelled)))).toEqual({
    kind: 'cancelled',
  });
  expect(cancelled.verifyInputs).toEqual([]);

  const missing = fakeVault({
    verifier,
    reply: acceptingVerifier(verifier),
    clip: { kind: 'unavailable', detail: 'VoiceID is missing from this Wallet host.' },
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(missing)))).toEqual({
    kind: 'unavailable',
    reason: 'voiceid_unavailable',
    detail: 'VoiceID is missing from this Wallet host.',
  });
  expect(missing.verifyInputs).toEqual([]);

  const reverted = fakeVault({
    verifier,
    reply: acceptingVerifier(verifier),
    submission: { kind: 'reverted', transactionHash: 'tx', error: 'AudioReused' },
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(reverted)))).toEqual({
    kind: 'refused',
    reason: 'vault_rejected',
    detail: 'AudioReused',
  });
});

// ---------------------------------------------------------------- core host operations

test('core host operations stay scoped to the configured vault and its two methods', async () => {
  const views: Array<{ account: string; method: string; args: unknown }> = [];
  const fetched: Array<{ url: string; init: RequestInit }> = [];
  const transactions: TransactionInput[] = [];
  let outcome: ActionResult = {
    success: true,
    transactionId: 'tx-ok',
    result: { status: { SuccessValue: '' }, receipts_outcome: [] } as never,
  };
  let recording: () => Promise<AuthMethodPhraseRecording> = async () => ({
    kind: 'recorded',
    samples: samples(10),
    endOfSpeechAt: 3,
  });
  const operations = createSpeakToSignHostOperations({
    feature: { kind: 'speak_to_sign', vault: 'voicevault.testnet', network: 'testnet' },
    ownerAccountId: 'owner.testnet',
    serverUrl: 'https://relay.example.test/',
    nearClient: {
      async view(params) {
        views.push({ account: params.account, method: params.method, args: params.args });
        return params.decodeResult({ ok: params.method }) as never;
      },
    },
    operationCredential: async () => 'credential-1',
    signAndSendTransaction: async (transaction) => {
      transactions.push(transaction);
      return outcome;
    },
    recordPhrase: () => recording(),
    fetch: (async (url: URL, init: RequestInit) => {
      fetched.push({ url: String(url), init });
      return Response.json({ ok: true, output: { verdict_json: '{}' }, timing: {} });
    }) as typeof fetch,
  });
  const signal = new AbortController().signal;

  // A 10 s recording becomes the verifier's 8 s canonical WAV.
  const clipRequest = {
    sentence: 'Send 25 NEAR',
    signal,
    surfaceMeasurementBinding: { kind: 'disabled' },
  } as const;
  expect(await operations.captureClip(clipRequest)).toEqual({
    kind: 'captured',
    wav: pcm16Wav(samples(8)),
    speechMs: 8_000,
    endOfSpeechAt: 3,
  });
  recording = async () => ({ kind: 'cancelled' });
  expect(await operations.captureClip(clipRequest)).toEqual({ kind: 'cancelled' });
  recording = async () => {
    throw new Error('VoiceID is missing from this Wallet host.');
  };
  expect(await operations.captureClip(clipRequest)).toEqual({
    kind: 'unavailable',
    detail: 'VoiceID is missing from this Wallet host.',
  });

  expect(await operations.viewVault('get_contacts', signal)).toEqual({ ok: 'get_contacts' });
  await operations.viewVault('get_verifier', signal);
  expect(views).toEqual([
    { account: 'voicevault.testnet', method: 'get_contacts', args: { owner_id: 'owner.testnet' } },
    { account: 'voicevault.testnet', method: 'get_verifier', args: {} },
  ]);

  expect(await operations.verify({ op: 'verify' }, signal)).toEqual({
    kind: 'output',
    output: { verdict_json: '{}' },
  });
  expect(fetched[0].url).toBe('https://relay.example.test/speak-to-sign/v1/verify');
  expect(fetched[0].init.body).toBe('{"input":{"op":"verify"}}');
  expect(new Headers(fetched[0].init.headers).get('authorization')).toBe('Bearer credential-1');

  const args = transferArgs(transferRequest(), '{}', 'c2ln');
  expect(await operations.submitTransfer(args, signal)).toEqual({
    kind: 'executed',
    transactionHash: 'tx-ok',
  });
  expect(transactions).toEqual([
    {
      receiverId: 'voicevault.testnet',
      actions: [
        {
          type: 'FunctionCall',
          methodName: 'transfer_with_verdict',
          args: { ...args },
          gas: '50000000000000',
          deposit: '0',
        },
      ],
    },
  ]);

  outcome = {
    success: true,
    transactionId: 'tx-bad',
    result: {
      status: { SuccessValue: '' },
      receipts_outcome: [{ outcome: { status: { Failure: { error: 'AudioReused' } } } }],
    } as never,
  };
  expect(await operations.submitTransfer(args, signal)).toEqual({
    kind: 'reverted',
    transactionHash: 'tx-bad',
    error: '{"error":"AudioReused"}',
  });
  outcome = { success: false, kind: 'not_submitted', error: 'cancelled by owner' };
  expect(await operations.submitTransfer(args, signal)).toEqual({
    kind: 'not_submitted',
    error: 'cancelled by owner',
  });

  // The enrollment authorization is one call with a 32-byte base64url digest and no deposit.
  outcome = {
    success: true,
    transactionId: 'tx-auth',
    result: { status: { SuccessValue: '' }, receipts_outcome: [] } as never,
  };
  transactions.length = 0;
  const digest = b64u(new Uint8Array(32).fill(5));
  expect(await operations.authorizeEnrollment(digest, signal)).toEqual({
    kind: 'executed',
    transactionHash: 'tx-auth',
  });
  expect(await operations.authorizeEnrollment('not a digest', signal)).toEqual({
    kind: 'not_submitted',
    error: 'The enrollment digest is invalid.',
  });
  expect(transactions).toEqual([
    {
      receiverId: 'voicevault.testnet',
      actions: [
        {
          type: 'FunctionCall',
          methodName: 'authorize_enrollment',
          args: { enrollment_digest: digest },
          gas: '30000000000000',
          deposit: '0',
        },
      ],
    },
  ]);
  await operations.viewVault('get_pending_enrollment', signal);
  expect(views.at(-1)).toEqual({
    account: 'voicevault.testnet',
    method: 'get_pending_enrollment',
    args: { owner_id: 'owner.testnet' },
  });
});
