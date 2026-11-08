import { expect, test } from '@playwright/test';
import type {
  SpeakToSignClip,
  SpeakToSignHostEnrollment,
  SpeakToSignHostOperations,
  SpeakToSignSubmission,
  SpeakToSignVerifyReply,
} from '@/core/transactionFeatures/hostPlugin';
import { pcm16Wav } from '@/core/transactionFeatures/wav';
import {
  ENROLLMENT_PHRASES,
  enrollmentDigest,
  readEnrollmentOutput,
  runEnrollment,
} from '../../packages/speak-to-sign/src/host/enroll';

// The shared vector of the verifier repository (voice-verifier/testdata/enrollment_digest_v1.json).
// Each audio digest there is the SHA-256 of "seams enrollment clip N".
const DIGEST_VECTOR = {
  vault: 'voicevault.testnet',
  owner: 'owner.testnet',
  clips: ['seams enrollment clip 1', 'seams enrollment clip 2', 'seams enrollment clip 3'],
  enrollmentDigest: 'rV0hf72rcVJB1g6W1LvANkrETIpuIt2uloIUW8CCJQo',
};
const ACCEPTED_OUTPUT = {
  kind: 'seams_voice_enrollment_v2',
  verifier: '0.2.0',
  vault: 'voicevault.testnet',
  owner: 'owner.testnet',
  outcome: 'accept',
  reason: null,
  agreement_milli: 812,
  audio_digests: [],
  enrollment_digest: 'x',
  template_epoch: 1,
  verifier_public_key: 'ed25519:Bz1',
  ms: { total: 3900 },
  detail: null,
};

function clip(index: number): Extract<SpeakToSignClip, { kind: 'captured' }> {
  const samples = new Float32Array(16_000);
  for (let at = 0; at < samples.length; at += 1) samples[at] = Math.sin(at / (7 + index)) / 4;
  return { kind: 'captured', wav: pcm16Wav(samples), speechMs: 1_000, endOfSpeechAt: 0 };
}

type FakeEnrollment = {
  input: SpeakToSignHostEnrollment;
  sentences: string[];
  authorized: string[];
  verifyInputs: Array<Readonly<Record<string, unknown>>>;
};

function fakeEnrollment(options: {
  vault?: unknown;
  clips?: SpeakToSignClip[];
  submission?: SpeakToSignSubmission;
  /** The pending views in order; the last one repeats. */
  pending?: (authorized: string | undefined) => unknown[];
  reply?: SpeakToSignVerifyReply;
}): FakeEnrollment {
  const fake: FakeEnrollment = {
    sentences: [],
    authorized: [],
    verifyInputs: [],
    input: undefined as never,
  };
  const pendingViews: unknown[] = [];
  const operations: SpeakToSignHostOperations = {
    async captureClip(request) {
      fake.sentences.push(request.sentence);
      return options.clips?.[fake.sentences.length - 1] ?? clip(fake.sentences.length);
    },
    async viewVault(view) {
      if (view === 'get_vault') return 'vault' in options ? options.vault : { next_nonce: '0' };
      if (view !== 'get_pending_enrollment') throw new Error(`unexpected view ${view}`);
      if (pendingViews.length === 0) {
        const authorized = fake.authorized.at(-1);
        pendingViews.push(
          ...(options.pending?.(authorized) ?? [
            { enrollment_digest: authorized, expires_at_ns: '1' },
          ]),
        );
      }
      return pendingViews.length > 1 ? pendingViews.shift() : pendingViews[0];
    },
    async verify(verifierInput) {
      fake.verifyInputs.push(verifierInput);
      return options.reply ?? { kind: 'output', output: ACCEPTED_OUTPUT };
    },
    async submitTransfer() {
      throw new Error('An enrollment sends no transfer.');
    },
    async authorizeEnrollment(digest) {
      fake.authorized.push(digest);
      return options.submission ?? { kind: 'executed', transactionHash: 'tx-auth' };
    },
  };
  fake.input = {
    walletId: 'wallet:owner' as never,
    vault: 'voicevault.testnet',
    network: 'testnet',
    signal: new AbortController().signal,
    ownerAccountId: 'owner.testnet',
    surfaceMeasurementBinding: { kind: 'disabled' },
    operations,
  };
  return fake;
}

test('the enrollment digest matches the shared verifier vector', async () => {
  const clips = DIGEST_VECTOR.clips.map((text) => new TextEncoder().encode(text));
  expect(await enrollmentDigest(DIGEST_VECTOR.vault, DIGEST_VECTOR.owner, clips)).toBe(
    DIGEST_VECTOR.enrollmentDigest,
  );
});

test('an enrollment records three phrases, authorizes exactly them, then enrolls', async () => {
  const fake = fakeEnrollment({});
  const result = await runEnrollment(fake.input);
  expect(result).toEqual({
    kind: 'enrolled',
    templateEpoch: 1,
    agreementMilli: 812,
    transactionHash: 'tx-auth',
  });
  expect(fake.sentences).toEqual([...ENROLLMENT_PHRASES]);
  const clips = [clip(1), clip(2), clip(3)].map((captured) => captured.wav);
  expect(fake.authorized).toEqual([
    await enrollmentDigest('voicevault.testnet', 'owner.testnet', clips),
  ]);
  expect(fake.verifyInputs).toEqual([
    {
      op: 'enroll',
      vault: 'voicevault.testnet',
      owner: 'owner.testnet',
      audio_wav_b64: clips.map((wav) => Buffer.from(wav).toString('base64')),
    },
  ]);
});

test('the enrollment waits until the vault shows this authorization', async () => {
  const fake = fakeEnrollment({
    pending: (authorized) => [null, { enrollment_digest: authorized, expires_at_ns: '1' }],
  });
  expect((await runEnrollment(fake.input)).kind).toBe('enrolled');
  expect(fake.verifyInputs).toHaveLength(1);
});

test('nothing is recorded without a vault, and a cancel or revert enrolls nothing', async () => {
  const missing = fakeEnrollment({ vault: null });
  expect(await runEnrollment(missing.input)).toEqual({
    kind: 'unavailable',
    reason: 'vault_missing',
  });
  expect(missing.sentences).toEqual([]);

  const cancelled = fakeEnrollment({ clips: [clip(1), { kind: 'cancelled' }] });
  expect(await runEnrollment(cancelled.input)).toEqual({ kind: 'cancelled' });
  expect(cancelled.sentences).toHaveLength(2);
  expect(cancelled.authorized).toEqual([]);

  const reverted = fakeEnrollment({
    submission: { kind: 'reverted', transactionHash: 'tx-bad', error: '{"error":"NoVault"}' },
  });
  expect(await runEnrollment(reverted.input)).toEqual({
    kind: 'refused',
    reason: 'vault_rejected',
    detail: '{"error":"NoVault"}',
  });
  expect(reverted.verifyInputs).toEqual([]);

  const failed = fakeEnrollment({ reply: { kind: 'failed', code: 'verifier_timeout' } });
  expect(await runEnrollment(failed.input)).toEqual({
    kind: 'unavailable',
    reason: 'verifier_unavailable',
    detail: 'verifier_timeout',
  });
});

test('a verifier refusal keeps its reason, and an unknown output is unavailable', () => {
  const refused = { ...ACCEPTED_OUTPUT, outcome: 'refuse', reason: 'speaker', detail: 'low' };
  expect(readEnrollmentOutput(refused, 'tx')).toEqual({
    kind: 'refused',
    reason: 'speaker',
    detail: 'low',
  });
  expect(
    readEnrollmentOutput({ ...refused, reason: 'not_authorized', detail: null }, 'tx'),
  ).toEqual({
    kind: 'refused',
    reason: 'not_authorized',
  });
  for (const bad of [
    null,
    { ...ACCEPTED_OUTPUT, kind: 'seams_voice_enrollment_v1' },
    { ...ACCEPTED_OUTPUT, template_epoch: 0 },
    { ...refused, reason: 'words' },
  ]) {
    expect(readEnrollmentOutput(bad, 'tx'), JSON.stringify(bad)).toEqual({
      kind: 'unavailable',
      reason: 'verifier_unavailable',
      detail: 'invalid output',
    });
  }
});
