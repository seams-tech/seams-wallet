import { expect, test } from '@playwright/test';
import { sealAudio } from '@/core/transactionFeatures/audioEnvelope';

// The verifier's shared vector `crates/voice-verifier/testdata/sealed_audio_v1.json` (the
// speak-to-sign repository): one clip sealed with a fixed ephemeral key. The verifier's own tests
// write it and open it, so equal bytes here mean that the verifier opens what the Wallet seals.
const VECTOR = {
  op: 'verify',
  owner: 'owner.testnet',
  audioPublicKeyHex: '38ab664bd86f77d7e66bdd9ae0792913a94fd8b33a1260027e4b46c1f4884c67',
  ephemeralIkmHex: '66'.repeat(32),
  plaintext: Uint8Array.from({ length: 100 }, (_, index) => index),
  sealedHex:
    '840e0eae611c970a92cea2e745c9f3f6ae69b67d75bac5eba11add350cd58f68c8d839052c74ee7b97074492' +
    'a24e06413b11fc66093d7d325046a50999c76c5c444c6b75ab5a64e2ace637e7b0b493d8f81464b3a7cb8b8f' +
    'd8bed5bed5d711370d0f815c7f585efa225f49c3641bd12785b0ee4e355b6a475f5a6d9d6b2375090636fc9d' +
    '6a917de499f7439fb44c7aa4b46105b9',
};

const fromHex = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'));
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const audioKey = fromHex(VECTOR.audioPublicKeyHex);

test('seals the vector clip to the vector bytes', async () => {
  const sealed = await sealAudio(
    audioKey,
    VECTOR.op,
    VECTOR.owner,
    VECTOR.plaintext,
    fromHex(VECTOR.ephemeralIkmHex),
  );
  expect(toHex(sealed)).toBe(VECTOR.sealedHex);
});

test('a seal has a new ephemeral key, and the operation and the owner change the tag', async () => {
  const seal = (op: string, owner: string, ikm?: Uint8Array) =>
    sealAudio(audioKey, op, owner, VECTOR.plaintext, ikm);
  const [first, second] = await Promise.all([seal('verify', 'o.testnet'), seal('verify', 'o.testnet')]);
  expect(first.length).toBe(VECTOR.plaintext.length + 48);
  expect(toHex(first.subarray(0, 32))).not.toBe(toHex(second.subarray(0, 32)));

  const ikm = fromHex(VECTOR.ephemeralIkmHex);
  const tag = async (op: string, owner: string) => toHex((await seal(op, owner, ikm)).subarray(-16));
  const base = await tag('verify', 'owner.testnet');
  expect(base).toBe(VECTOR.sealedHex.slice(-32));
  expect(await tag('enroll', 'owner.testnet')).not.toBe(base);
  expect(await tag('verify', 'other.testnet')).not.toBe(base);
});

test('refuses an audio key that is not 32 bytes', async () => {
  await expect(sealAudio(new Uint8Array(31), 'verify', 'o.testnet', VECTOR.plaintext)).rejects.toThrow(
    '32 bytes',
  );
});
