import { base64UrlDecode, base64UrlEncode } from '../utils/base64';
import { requireCanonicalString, requireRecord } from '../utils/validation';
import type { ReadonlyExclusiveUnion } from '../utils/variant';
import {
  parseWalletCustodyGeneratedEstablishedCustody,
  parseWalletCustodyGeneratedRecoveryReplacementEnvelope,
  type EstablishedCustodyRecordsPayload,
  type RecoveryReplacementEnvelopePayload,
} from './ceremonyCommitPayload';

export type MlDsaCustodyProtocolInputs = {
  readonly walletId: string;
  readonly signingKeyId: string;
  readonly operationIdB64u: string;
  readonly materialEpoch: number;
  readonly roleAPublicKeyB64u: string;
  readonly roleBPublicKeyB64u: string;
  readonly continuity: ReadonlyExclusiveUnion<
    | { readonly kind: 'create' }
    | { readonly kind: 'recover'; readonly recordedKeyManifestDigestB64u: string }
  >;
  readonly walletCustodySeed?: never;
  readonly ownerRoot?: never;
  readonly canonicalSeed?: never;
  readonly recipientPrivateKey?: never;
};

type MlDsaPublicKeyManifest = {
  readonly walletId: string;
  readonly signingKeyId: string;
  readonly keySet: 'near_ml_dsa_65_v1';
  readonly publicKeyB64u: string;
  readonly keyManifestDigestB64u: string;
  readonly operationIdB64u: string;
  readonly materialEpoch: number;
};

/** Proposed records. This type grants no durable activation or signing authority. */
export type MlDsaCustodyCommit = ReadonlyExclusiveUnion<
  | {
      readonly custodyAction: 'established';
      readonly key: MlDsaPublicKeyManifest;
      readonly custody: EstablishedCustodyRecordsPayload;
    }
  | { readonly custodyAction: 'joined'; readonly key: MlDsaPublicKeyManifest }
  | {
      readonly custodyAction: 'recovered';
      readonly key: MlDsaPublicKeyManifest;
      readonly replacement: RecoveryReplacementEnvelopePayload;
    }
>;

function fixedEncoding(value: unknown, bytes: number, label: string): string {
  const encoded = requireCanonicalString(value, label);
  const decoded = base64UrlDecode(encoded);
  if (decoded.length !== bytes || base64UrlEncode(decoded) !== encoded) {
    throw new Error(`${label} must contain ${bytes} bytes in canonical base64url`);
  }
  return encoded;
}

function parseManifest(value: unknown): MlDsaPublicKeyManifest {
  const record = requireRecord(value, 'ML-DSA manifest');
  const fields = [
    'walletId',
    'signingKeyId',
    'keySet',
    'publicKeyB64u',
    'keyManifestDigestB64u',
    'operationIdB64u',
    'materialEpoch',
  ];
  if (Object.keys(record).length !== fields.length)
    throw new Error('ML-DSA manifest has unexpected fields');
  for (const field of Object.keys(record)) {
    if (!fields.includes(field)) throw new Error('ML-DSA manifest has unexpected fields');
  }
  if (record.keySet !== 'near_ml_dsa_65_v1')
    throw new Error('ML-DSA manifest names a different key set');
  if (
    typeof record.materialEpoch !== 'number' ||
    !Number.isSafeInteger(record.materialEpoch) ||
    record.materialEpoch < 0
  ) {
    throw new Error('ML-DSA material epoch must be a nonnegative safe integer');
  }
  return {
    walletId: requireCanonicalString(record.walletId, 'walletId'),
    signingKeyId: requireCanonicalString(record.signingKeyId, 'signingKeyId'),
    keySet: 'near_ml_dsa_65_v1',
    publicKeyB64u: fixedEncoding(record.publicKeyB64u, 1952, 'publicKeyB64u'),
    keyManifestDigestB64u: fixedEncoding(record.keyManifestDigestB64u, 32, 'keyManifestDigestB64u'),
    operationIdB64u: fixedEncoding(record.operationIdB64u, 32, 'operationIdB64u'),
    materialEpoch: record.materialEpoch,
  };
}

/** Normalize the Wasm response once before it enters the SDK worker protocol. */
export function parseMlDsaCustodyCommit(value: unknown): MlDsaCustodyCommit {
  const record = requireRecord(value, 'ML-DSA custody commit');
  const key = parseManifest(record.key);
  const fields = ['custodyAction', 'key'];
  if (record.custodyAction === 'established') fields.push('custody');
  if (record.custodyAction === 'recovered') fields.push('replacement');
  if (Object.keys(record).length !== fields.length)
    throw new Error('ML-DSA custody commit has unexpected fields');
  for (const field of Object.keys(record)) {
    if (!fields.includes(field)) throw new Error('ML-DSA custody commit has unexpected fields');
  }
  switch (record.custodyAction) {
    case 'established':
      return {
        custodyAction: 'established',
        key,
        custody: parseWalletCustodyGeneratedEstablishedCustody(record.custody),
      };
    case 'joined':
      return { custodyAction: 'joined', key };
    case 'recovered':
      return {
        custodyAction: 'recovered',
        key,
        replacement: parseWalletCustodyGeneratedRecoveryReplacementEnvelope(record.replacement),
      };
    default:
      throw new Error('Unsupported ML-DSA custody action');
  }
}
