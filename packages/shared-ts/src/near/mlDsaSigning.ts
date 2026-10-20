import { base64UrlDecode, base64UrlEncode } from '../utils/base64';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import { exactRecord } from '../utils/exactRecord';
import { requireCanonicalString } from '../utils/validation';
import {
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type WalletId,
  type WebAuthnCredentialIdB64u,
  type WebAuthnRpId,
} from '../utils/domainIds';
import { parseMlDsaSigningKeyId } from '../signing-lanes/recordParsers';
import { requireParsed } from '../passkey-custody/primitives';
import type { ReadonlyExclusiveUnion } from '../utils/variant';

export type MlDsaTransactionInspection = {
  readonly transactionHashB64u: DigestB64u;
  readonly displayJson: string;
  readonly signerId: string;
  readonly receiverId: string;
  readonly nonce: string;
  readonly publicKeyB64u: string;
};
export type MlDsaSigningRequest = {
  readonly materialEpoch?: never;
  readonly publicKeyB64u?: never;
  readonly keyManifestDigestB64u?: never;
  readonly scheduleDigestB64u?: never;
  readonly transactionHashB64u?: never;
  readonly context?: never;
  readonly walletCustodySeed?: never;
  readonly walletId: WalletId;
  readonly signingKeyId: string;
  readonly operationIdB64u: DigestB64u;
  readonly unsignedTransactionBorshB64u: string;
  readonly rpId: WebAuthnRpId;
  readonly credentialIdB64u: WebAuthnCredentialIdB64u;
};
export type MlDsaSigningPreparation = {
  readonly request: MlDsaSigningRequest;
  readonly transaction: MlDsaTransactionInspection;
  readonly challengeB64u: DigestB64u;
  readonly expiresAtMs: number;
};
export type MlDsaSignedTransaction = {
  readonly signedTransactionBorshB64u: string;
  readonly transactionHash: string;
  readonly signatureB64u: string;
};
export type MlDsaSigningFailureCode =
  | 'not_configured'
  | 'invalid_body'
  | 'unauthorized'
  | 'not_found'
  | 'idempotency_conflict'
  | 'expired'
  | 'conflict'
  | 'protocol_failed'
  | 'invalid_signature';
export type MlDsaSigningFailure = {
  readonly kind: 'refused';
  readonly code: MlDsaSigningFailureCode;
  readonly message: string;
};
export type MlDsaSigningOutcome = ReadonlyExclusiveUnion<
  | { readonly kind: 'signed'; readonly transaction: MlDsaSignedTransaction }
  | {
      readonly kind: 'retry';
      readonly retryAtMs: number;
      readonly reason: 'unavailable' | 'running';
    }
  | MlDsaSigningFailure
>;
export type MlDsaSigningPreparationOutcome = ReadonlyExclusiveUnion<
  { readonly kind: 'prepared'; readonly preparation: MlDsaSigningPreparation } | MlDsaSigningFailure
>;

function mlDsaSigningBytes(raw: unknown, field: string, minimum: number, maximum: number): string {
  const text = requireCanonicalString(raw, field);
  if (text.length > Math.ceil((maximum * 4) / 3) + 2) throw new Error(`${field} is too large`);
  const bytes = base64UrlDecode(text);
  if (bytes.length < minimum || bytes.length > maximum || base64UrlEncode(bytes) !== text)
    throw new Error(`Invalid ${field}`);
  return text;
}
export function parseMlDsaSigningRequest(raw: unknown): MlDsaSigningRequest {
  const r = exactRecord(
    raw,
    [
      'walletId',
      'signingKeyId',
      'operationIdB64u',
      'unsignedTransactionBorshB64u',
      'rpId',
      'credentialIdB64u',
    ],
    'ML-DSA signing request',
  );
  return {
    walletId: requireParsed(parseWalletId(r.walletId), 'walletId'),
    signingKeyId: parseMlDsaSigningKeyId(r.signingKeyId),
    operationIdB64u: parseDigestB64u(r.operationIdB64u),
    unsignedTransactionBorshB64u: mlDsaSigningBytes(
      r.unsignedTransactionBorshB64u,
      'unsigned transaction',
      1,
      32 * 1024,
    ),
    rpId: requireParsed(parseWebAuthnRpId(r.rpId), 'rpId'),
    credentialIdB64u: requireParsed(
      parseWebAuthnCredentialIdB64u(r.credentialIdB64u),
      'credentialIdB64u',
    ),
  };
}
export function parseMlDsaTransactionInspection(raw: unknown): MlDsaTransactionInspection {
  const r = exactRecord(
    raw,
    ['transactionHashB64u', 'displayJson', 'signerId', 'receiverId', 'nonce', 'publicKeyB64u'],
    'ML-DSA transaction inspection',
  );
  return {
    transactionHashB64u: parseDigestB64u(r.transactionHashB64u),
    displayJson: requireCanonicalString(r.displayJson, 'displayJson'),
    signerId: requireCanonicalString(r.signerId, 'signerId'),
    receiverId: requireCanonicalString(r.receiverId, 'receiverId'),
    nonce: requireCanonicalString(r.nonce, 'nonce'),
    publicKeyB64u: mlDsaSigningBytes(r.publicKeyB64u, 'public key', 1952, 1952),
  };
}
export function parseMlDsaSigningPreparation(raw: unknown): MlDsaSigningPreparation {
  const r = exactRecord(
    raw,
    ['request', 'transaction', 'challengeB64u', 'expiresAtMs'],
    'ML-DSA signing preparation',
  );
  if (
    typeof r.expiresAtMs !== 'number' ||
    !Number.isSafeInteger(r.expiresAtMs) ||
    r.expiresAtMs <= 0
  )
    throw new Error('Invalid signing expiry');
  return {
    request: parseMlDsaSigningRequest(r.request),
    transaction: parseMlDsaTransactionInspection(r.transaction),
    challengeB64u: parseDigestB64u(r.challengeB64u),
    expiresAtMs: r.expiresAtMs,
  };
}
export function parseMlDsaSignedTransaction(raw: unknown): MlDsaSignedTransaction {
  const r = exactRecord(
    raw,
    ['signedTransactionBorshB64u', 'transactionHash', 'signatureB64u'],
    'ML-DSA signed transaction',
  );
  return {
    signedTransactionBorshB64u: mlDsaSigningBytes(
      r.signedTransactionBorshB64u,
      'signed transaction',
      3310,
      32 * 1024 + 3310,
    ),
    transactionHash: requireCanonicalString(r.transactionHash, 'transactionHash'),
    signatureB64u: mlDsaSigningBytes(r.signatureB64u, 'signature', 3309, 3309),
  };
}
export function parseMlDsaSigningFailure(raw: unknown): MlDsaSigningFailure {
  const r = exactRecord(raw, ['kind', 'code', 'message'], 'ML-DSA signing refusal');
  if (r.kind !== 'refused') throw new Error('Invalid ML-DSA refusal');
  switch (r.code) {
    case 'not_configured':
    case 'invalid_body':
    case 'unauthorized':
    case 'not_found':
    case 'idempotency_conflict':
    case 'expired':
    case 'conflict':
    case 'protocol_failed':
    case 'invalid_signature':
      return {
        kind: 'refused',
        code: r.code,
        message: requireCanonicalString(r.message, 'message'),
      };
    default:
      throw new Error('Unknown ML-DSA signing refusal');
  }
}
