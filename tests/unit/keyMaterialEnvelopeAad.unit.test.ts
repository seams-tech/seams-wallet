import { expect, test } from '@playwright/test';
import {
  buildEnvelopeAAD,
  normalizePayloadEnvelope,
} from '../../packages/wallet/src/core/indexedDB/keyMaterialEnvelope';

const expectedAAD = buildEnvelopeAAD({
  profileId: 'wallet-1',
  signerSlot: 1,
  chainIdKey: 'near:testnet',
  accountAddress: 'alice.testnet',
  keyKind: 'ed25519_yao_local_material_v1',
  schemaVersion: 1,
  signerId: 'signer-1',
});

function envelope(aad: unknown): Record<string, unknown> {
  return { encVersion: 1, alg: 'aes-gcm', nonce: 'bm9uY2U', ciphertext: 'Y2lwaGVy', aad };
}

test.describe('key material envelope AAD', () => {
  test('accepts the AAD that names the same row', () => {
    const parsed = normalizePayloadEnvelope(envelope({ ...expectedAAD }), expectedAAD, 'row');
    expect(parsed?.aad).toEqual(expectedAAD);
  });

  test('refuses a missing AAD instead of filling it from the row', () => {
    expect(() => normalizePayloadEnvelope(envelope(undefined), expectedAAD, 'row')).toThrow(
      'payloadEnvelope.aad is missing',
    );
  });

  test('refuses an AAD with a missing field instead of filling it from the row', () => {
    const { signerId: _omitted, ...partial } = expectedAAD;
    expect(() => normalizePayloadEnvelope(envelope(partial), expectedAAD, 'row')).toThrow(
      'payloadEnvelope.aad mismatch (signerId)',
    );
  });

  test('refuses an AAD of another signer slot or a bad slot', () => {
    expect(() =>
      normalizePayloadEnvelope(envelope({ ...expectedAAD, signerSlot: 2 }), expectedAAD, 'row'),
    ).toThrow('payloadEnvelope.aad mismatch (signerSlot)');
    expect(() =>
      normalizePayloadEnvelope(envelope({ ...expectedAAD, signerSlot: '1' }), expectedAAD, 'row'),
    ).toThrow('payloadEnvelope.aad mismatch (signerSlot)');
  });
});
