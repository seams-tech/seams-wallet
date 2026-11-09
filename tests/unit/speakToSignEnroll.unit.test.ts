import { expect, test } from '@playwright/test';
import type {
  SpeakToSignClip,
  SpeakToSignEnrollmentAuthorization,
  SpeakToSignHostEnrollment,
  SpeakToSignHostOperations,
  SpeakToSignVerifyReply,
} from '@/core/transactionFeatures/hostPlugin';
import { enrollmentDigest } from '@/core/transactionFeatures/hostOperations';
import { pcm16Wav } from '@/core/transactionFeatures/wav';
import {
  ENROLLMENT_PHRASES,
  readEnrollmentOutput,
  runEnrollment,
} from '../../packages/speak-to-sign/src/host/enroll';

// The shared vectors of the verifier repository (voice-verifier/testdata/enrollment_digest_v2.json
// and enrollment_authorization_v1.json). Each audio digest is the SHA-256 of
// "seams enrollment clip N".
const DIGEST_VECTOR = {
  owner: 'owner.testnet',
  clips: ['seams enrollment clip 1', 'seams enrollment clip 2', 'seams enrollment clip 3'],
  enrollmentDigest: 'IyW72Dqz05KV9arXO7CqCdmAzz4isRopE3BDZslJwFY',
  message: 'Speak-to-Sign voice enrollment IyW72Dqz05KV9arXO7CqCdmAzz4isRopE3BDZslJwFY',
  recipient: 'seams-v1.testnet/voice-verifier',
};
const AUTHORIZATION = {
  public_key: 'ed25519:9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj',
  signature_b64:
    'En0KfB6HYRZT/TDie6POI4AUECLQfqud3vfZQZg1xGLGFxLsis6SdJGynVlytmrunBgodrkpePoD6KuCXnfjBQ==',
  nonce_b64: 'KysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKys=',
};
const ACCEPTED_OUTPUT = {
  kind: 'seams_voice_enrollment_v3',
  verifier: '0.3.0',
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
  authorized: Array<readonly Uint8Array[]>;
  verifyInputs: Array<Readonly<Record<string, unknown>>>;
};

function fakeEnrollment(options: {
  clips?: SpeakToSignClip[];
  authorization?: SpeakToSignEnrollmentAuthorization;
  reply?: SpeakToSignVerifyReply;
}): FakeEnrollment {
  const fake: FakeEnrollment = {
    sentences: [],
    authorized: [],
    verifyInputs: [],
    input: undefined as never,
  };
  const operations: SpeakToSignHostOperations = {
    async captureClip(request) {
      fake.sentences.push(request.sentence);
      return options.clips?.[fake.sentences.length - 1] ?? clip(fake.sentences.length);
    },
    async receiverExists() {
      throw new Error('An enrollment checks no receiver.');
    },
    async verify(verifierInput) {
      fake.verifyInputs.push(verifierInput);
      return options.reply ?? { kind: 'output', output: ACCEPTED_OUTPUT };
    },
    async payWithVerdict() {
      throw new Error('An enrollment sends no transfer.');
    },
    async authorizeEnrollment(clips) {
      fake.authorized.push(clips);
      return options.authorization ?? { kind: 'signed', authorization: AUTHORIZATION };
    },
  };
  fake.input = {
    walletId: 'wallet:owner' as never,
    network: 'testnet',
    signal: new AbortController().signal,
    ownerAccountId: 'owner.testnet',
    surfaceMeasurementBinding: { kind: 'disabled' },
    operations,
  };
  return fake;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
}

test('the enrollment digest and message match the shared verifier vectors', async () => {
  const digests = await Promise.all(
    DIGEST_VECTOR.clips.map((text) => sha256(new TextEncoder().encode(text))),
  );
  const digest = await enrollmentDigest(DIGEST_VECTOR.owner, digests);
  expect(digest).toBe(DIGEST_VECTOR.enrollmentDigest);
  expect(`Speak-to-Sign voice enrollment ${digest}`).toBe(DIGEST_VECTOR.message);
});

test('an enrollment records three phrases, authorizes exactly them, then enrolls', async () => {
  const fake = fakeEnrollment({});
  const result = await runEnrollment(fake.input);
  expect(result).toEqual({ kind: 'enrolled', templateEpoch: 1, agreementMilli: 812 });
  expect(fake.sentences).toEqual([...ENROLLMENT_PHRASES]);
  const clips = [clip(1), clip(2), clip(3)].map((captured) => captured.wav);
  expect(fake.authorized).toEqual([clips]);
  expect(fake.verifyInputs).toEqual([
    {
      op: 'enroll',
      owner: 'owner.testnet',
      audio_wav_b64: clips.map((wav) => Buffer.from(wav).toString('base64')),
      authorization: AUTHORIZATION,
    },
  ]);
});

test('a cancel, an unsigned message or a route failure enrolls nothing', async () => {
  const cancelled = fakeEnrollment({ clips: [clip(1), { kind: 'cancelled' }] });
  expect(await runEnrollment(cancelled.input)).toEqual({ kind: 'cancelled' });
  expect(cancelled.sentences).toHaveLength(2);
  expect(cancelled.authorized).toEqual([]);

  const unsigned = fakeEnrollment({
    authorization: { kind: 'not_signed', error: 'The owner closed the confirm.' },
  });
  expect(await runEnrollment(unsigned.input)).toEqual({
    kind: 'unavailable',
    reason: 'not_submitted',
    detail: 'The owner closed the confirm.',
  });
  expect(unsigned.verifyInputs).toEqual([]);

  const failed = fakeEnrollment({ reply: { kind: 'failed', code: 'verifier_timeout' } });
  expect(await runEnrollment(failed.input)).toEqual({
    kind: 'unavailable',
    reason: 'verifier_unavailable',
    detail: 'verifier_timeout',
  });
});

test('a verifier refusal keeps its reason, and an unknown output is unavailable', () => {
  const refused = { ...ACCEPTED_OUTPUT, outcome: 'refuse', reason: 'speaker', detail: 'low' };
  expect(readEnrollmentOutput(refused)).toEqual({
    kind: 'refused',
    reason: 'speaker',
    detail: 'low',
  });
  expect(readEnrollmentOutput({ ...refused, reason: 'not_authorized', detail: null })).toEqual({
    kind: 'refused',
    reason: 'not_authorized',
  });
  for (const bad of [
    null,
    { ...ACCEPTED_OUTPUT, kind: 'seams_voice_enrollment_v2' },
    { ...ACCEPTED_OUTPUT, template_epoch: 0 },
    { ...refused, reason: 'words' },
  ]) {
    expect(readEnrollmentOutput(bad), JSON.stringify(bad)).toEqual({
      kind: 'unavailable',
      reason: 'verifier_unavailable',
      detail: 'invalid output',
    });
  }
});
