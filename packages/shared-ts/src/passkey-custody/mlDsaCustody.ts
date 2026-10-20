import { base64UrlDecode, base64UrlEncode } from '../utils/base64';
import { requireCanonicalString, requireRecord } from '../utils/validation';
import { exactRecord } from '../utils/exactRecord';
import { parseMlDsaMaterialEpoch } from './primitives';
import { requireBytes, requireBytes32 } from '../utils/routerAbEd25519YaoDigests';
import type { ReadonlyExclusiveUnion, Variant } from '../utils/variant';
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

export type MlDsaCreateProtocolInputs = Omit<MlDsaCustodyProtocolInputs, 'continuity'> & {
  readonly continuity: { readonly kind: 'create'; readonly recordedKeyManifestDigestB64u?: never };
};

export type MlDsaRecoveryProtocolInputs = Omit<MlDsaCustodyProtocolInputs, 'continuity'> & {
  readonly continuity: Variant<MlDsaCustodyProtocolInputs['continuity'], 'kind', 'recover'>;
};

export type MlDsaSignerPurpose = ReadonlyExclusiveUnion<
  | { readonly kind: 'create' }
  | {
      readonly kind: 'restore';
      readonly publicKeyB64u: string;
      readonly keyManifestDigestB64u: string;
      readonly materialEpoch: number;
    }
>;

export function parseMlDsaSignerPurpose(raw: unknown): MlDsaSignerPurpose {
  const value = requireRecord(raw, 'ML-DSA signer purpose');
  if (value.kind === 'create') {
    exactRecord(value, ['kind'], 'ML-DSA creation purpose');
    return { kind: 'create' };
  }
  const record = exactRecord(
    value,
    ['kind', 'publicKeyB64u', 'keyManifestDigestB64u', 'materialEpoch'],
    'ML-DSA restoration purpose',
  );
  if (record.kind !== 'restore') throw new Error('Unknown ML-DSA signer purpose');
  return {
    kind: 'restore',
    publicKeyB64u: fixedEncoding(record.publicKeyB64u, 1952, 'recorded ML-DSA public key'),
    keyManifestDigestB64u: fixedEncoding(
      record.keyManifestDigestB64u,
      32,
      'recorded ML-DSA manifest',
    ),
    materialEpoch: parseMlDsaMaterialEpoch(record.materialEpoch),
  };
}

export function mlDsaProtocolMatchesPurpose(
  protocol: MlDsaCustodyProtocolInputs,
  purpose: MlDsaSignerPurpose,
): boolean {
  switch (purpose.kind) {
    case 'create':
      return protocol.continuity.kind === 'create' && protocol.materialEpoch === 1;
    case 'restore':
      return (
        protocol.continuity.kind === 'recover' &&
        protocol.continuity.recordedKeyManifestDigestB64u === purpose.keyManifestDigestB64u &&
        protocol.materialEpoch > purpose.materialEpoch
      );
  }
}

export function mlDsaSigningKeyIdForSlot(slot: number): string {
  if (!Number.isSafeInteger(slot) || slot < 1)
    throw new Error('ML-DSA signer slot must be a positive integer');
  return `near-ml-dsa-65:${slot}`;
}

export type MlDsaSealedRoleValue = {
  readonly encapsulated_key: readonly number[];
  readonly ciphertext: readonly number[];
};
export type MlDsaEncryptedInputs = {
  readonly a: MlDsaSealedRoleValue;
  readonly b: MlDsaSealedRoleValue;
};
function encryptedRoleInput(raw: unknown): MlDsaSealedRoleValue {
  const record = exactRecord(
    raw,
    ['encapsulated_key', 'ciphertext'],
    'ML-DSA encrypted role input',
  );
  return {
    encapsulated_key: requireBytes32(record.encapsulated_key, 'ML-DSA encapsulated key', true),
    ciphertext: requireBytes(record.ciphertext, 'ML-DSA encrypted root share', 80, 80),
  };
}
export function parseMlDsaEncryptedInputs(raw: unknown): MlDsaEncryptedInputs {
  const record = exactRecord(raw, ['a', 'b'], 'ML-DSA encrypted inputs');
  return { a: encryptedRoleInput(record.a), b: encryptedRoleInput(record.b) };
}

const ML_DSA_FAILURE_CODES = [
  'unauthorized',
  'expired',
  'signer_conflict',
  'unavailable',
  'conflict',
  'not_found',
  'idempotency_conflict',
  'pending',
  'ml_dsa_transport',
  'ml_dsa_refused',
  'ml_dsa_invalid_response',
  'ml_dsa_terminal',
  'custody_mismatch',
  'not_ready',
  'not_configured',
  'invalid_body',
] as const;
export type MlDsaRegistrationFailureCode = (typeof ML_DSA_FAILURE_CODES)[number];
export type MlDsaRegistrationFailure = {
  readonly ok: false;
  readonly message: string;
} & ReadonlyExclusiveUnion<
  | { readonly code: MlDsaRegistrationFailureCode }
  | { readonly code: 'pool_unavailable'; readonly retryAtMs: number }
>;

function isMlDsaFailureCode(value: unknown): value is MlDsaRegistrationFailureCode {
  for (const code of ML_DSA_FAILURE_CODES) if (value === code) return true;
  return false;
}
export function parseMlDsaRegistrationFailure(raw: unknown): MlDsaRegistrationFailure {
  const value = requireRecord(raw, 'ML-DSA registration failure');
  const record = exactRecord(
    value,
    value.code === 'pool_unavailable'
      ? ['ok', 'code', 'message', 'retryAtMs']
      : ['ok', 'code', 'message'],
    'ML-DSA registration failure',
  );
  if (record.ok !== false) throw new Error('Expected an ML-DSA refusal');
  const message = requireCanonicalString(record.message, 'ML-DSA failure message');
  if (record.code === 'pool_unavailable') {
    if (
      typeof record.retryAtMs !== 'number' ||
      !Number.isSafeInteger(record.retryAtMs) ||
      record.retryAtMs < 0
    )
      throw new Error('Invalid ML-DSA retry time');
    return { ok: false, code: 'pool_unavailable', message, retryAtMs: record.retryAtMs };
  }
  if (!isMlDsaFailureCode(record.code)) throw new Error('Unknown ML-DSA failure');
  return { ok: false, code: record.code, message };
}

/** Boundary parser for the server-persisted add-signer preparation. */
export function parseMlDsaCustodyProtocolInputs(value: unknown): MlDsaCustodyProtocolInputs {
  const record = exactRecord(
    value,
    [
      'walletId',
      'signingKeyId',
      'operationIdB64u',
      'materialEpoch',
      'roleAPublicKeyB64u',
      'roleBPublicKeyB64u',
      'continuity',
    ],
    'ML-DSA protocol inputs',
  );
  const rawContinuity = requireRecord(record.continuity, 'ML-DSA continuity');
  const continuity =
    rawContinuity.kind === 'create'
      ? exactRecord(rawContinuity, ['kind'], 'ML-DSA creation continuity')
      : exactRecord(
          rawContinuity,
          ['kind', 'recordedKeyManifestDigestB64u'],
          'ML-DSA recovery continuity',
        );
  if (continuity.kind !== 'create' && continuity.kind !== 'recover')
    throw new Error('Unknown ML-DSA continuity');
  const roleA = fixedEncoding(record.roleAPublicKeyB64u, 32, 'roleAPublicKeyB64u');
  const roleB = fixedEncoding(record.roleBPublicKeyB64u, 32, 'roleBPublicKeyB64u');
  if (roleA === roleB) throw new Error('ML-DSA participants must use separate recipient keys');
  return {
    walletId: requireCanonicalString(record.walletId, 'walletId'),
    signingKeyId: requireCanonicalString(record.signingKeyId, 'signingKeyId'),
    operationIdB64u: fixedEncoding(record.operationIdB64u, 32, 'operationIdB64u'),
    materialEpoch: parseMlDsaMaterialEpoch(record.materialEpoch),
    roleAPublicKeyB64u: roleA,
    roleBPublicKeyB64u: roleB,
    continuity:
      continuity.kind === 'create'
        ? { kind: 'create' }
        : {
            kind: 'recover',
            recordedKeyManifestDigestB64u: fixedEncoding(
              continuity.recordedKeyManifestDigestB64u,
              32,
              'recorded ML-DSA manifest',
            ),
          },
  };
}

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
