import { exactRecord } from '@shared/utils/exactRecord';
import { requireRecord } from '@shared/utils/validation';
import { parseMlDsaSigningKeyId } from '@shared/signing-lanes/recordParsers';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import type { NearTransactionSignerSelection } from './seams';

export type NearSignerPreference = ReadonlyExclusiveUnion<
  { readonly kind: 'ed25519' } | { readonly kind: 'near_ml_dsa_65'; readonly signingKeyId: string }
>;
export type NearTransactionSignerRequest = ReadonlyExclusiveUnion<
  NearTransactionSignerSelection | { readonly kind: 'wallet_default' }
>;
export function parseNearSignerPreference(value: unknown): NearSignerPreference {
  const raw = requireRecord(value, 'NEAR signing key preference');
  switch (raw.kind) {
    case 'ed25519':
      exactRecord(raw, ['kind'], 'Ed25519 preference');
      return { kind: 'ed25519' };
    case 'near_ml_dsa_65':
      exactRecord(raw, ['kind', 'signingKeyId'], 'ML-DSA preference');
      return { kind: 'near_ml_dsa_65', signingKeyId: parseMlDsaSigningKeyId(raw.signingKeyId) };
    default:
      throw new Error('Invalid signing key preference');
  }
}
