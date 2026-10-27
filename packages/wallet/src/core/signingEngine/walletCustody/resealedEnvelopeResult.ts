import {
  parseDigestField,
  parseEnvelopeCiphertextB64u,
  parseEnvelopeNonceB64u,
  type EnvelopeCiphertextB64u,
  type EnvelopeNonceB64u,
} from '@shared/passkey-custody';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import { rejectUnknownFields } from '@shared/utils/exactRecord';
import { requireRecord } from '@shared/utils/validation';

export type ResealedEnvelopeResult = Readonly<{
  nonceB64u: EnvelopeNonceB64u;
  sealedCustodySecretB64u: EnvelopeCiphertextB64u;
  aadHashB64u: DigestB64u;
  ciphertextDigestB64u: DigestB64u;
}>;

export function parseResealedEnvelopeResult(raw: unknown): ResealedEnvelopeResult {
  const record = requireRecord(raw, 'wallet custody worker reseal');
  rejectUnknownFields(
    record,
    ['nonceB64u', 'sealedCustodySecretB64u', 'aadHashB64u', 'ciphertextDigestB64u'],
    'wallet custody worker reseal',
  );
  return {
    nonceB64u: parseEnvelopeNonceB64u(record.nonceB64u),
    sealedCustodySecretB64u: parseEnvelopeCiphertextB64u(record.sealedCustodySecretB64u),
    aadHashB64u: parseDigestField(record.aadHashB64u, 'aadHashB64u'),
    ciphertextDigestB64u: parseDigestField(record.ciphertextDigestB64u, 'ciphertextDigestB64u'),
  };
}
