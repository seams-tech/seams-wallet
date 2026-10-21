import type { NearTransactionSignerSelection } from '@/core/types/seams';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireRecord } from '@shared/utils/validation';
import { parseMlDsaSigningKeyId } from '@shared/signing-lanes/recordParsers';
import {
  parseMlDsa65PublicKeyB64u,
  parseMlDsaMaterialEpoch,
} from '@shared/passkey-custody/primitives';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';

/** Normalize public and iframe inputs before selecting a signing protocol. */
export function parseNearTransactionSigner(raw: unknown): NearTransactionSignerSelection {
  const record = requireRecord(raw, 'NEAR transaction signer');
  switch (record.kind) {
    case 'ed25519':
      exactRecord(record, ['kind'], 'Ed25519 transaction signer');
      return { kind: 'ed25519' };
    case 'near_ml_dsa_65': {
      const signer = exactRecord(
        record,
        ['kind', 'signingKeyId', 'publicKeyB64u', 'keyManifestDigestB64u', 'materialEpoch'],
        'ML-DSA transaction signer',
      );
      return {
        kind: 'near_ml_dsa_65',
        signingKeyId: parseMlDsaSigningKeyId(signer.signingKeyId),
        publicKeyB64u: parseMlDsa65PublicKeyB64u(signer.publicKeyB64u),
        keyManifestDigestB64u: parseDigestB64u(signer.keyManifestDigestB64u),
        materialEpoch: parseMlDsaMaterialEpoch(signer.materialEpoch),
      };
    }
    default:
      throw new Error('Unsupported NEAR transaction signer');
  }
}
