import { base64UrlDecode, base64UrlEncode } from '../utils/base64';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import { exactRecord } from '../utils/exactRecord';
import { requireCanonicalString, requireRecord } from '../utils/validation';
import {
  parseWalletId,
  parseWalletAuthMethodId,
  type WalletAuthMethodId,
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
export type MlDsaSigningActor = ReadonlyExclusiveUnion<
  | {
      readonly kind: 'passkey';
      readonly rpId: WebAuthnRpId;
      readonly credentialIdB64u: WebAuthnCredentialIdB64u;
    }
  | { readonly kind: 'email_otp'; readonly walletAuthMethodId: WalletAuthMethodId }
>;
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
  readonly actor: MlDsaSigningActor;
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
export type MlDsaTerminalFailureCode =
  | 'candidates_exhausted'
  | 'deadline_exceeded'
  | 'transport_interrupted'
  | 'participant_rejected'
  | 'participant_unavailable'
  | 'invalid_participant_response'
  | 'admission_rejected'
  | 'material_unavailable'
  | 'invalid_material'
  | 'configuration_invalid'
  | 'clock_unavailable'
  | 'key_changed'
  | 'cancelled'
  | 'protocol_failed';

export type MlDsaSigningFailureCode =
  | MlDsaTerminalFailureCode
  | 'not_configured'
  | 'invalid_body'
  | 'unauthorized'
  | 'not_found'
  | 'idempotency_conflict'
  | 'expired'
  | 'conflict'
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
      /** Relative, because the browser clock can differ from the server clock. */
      readonly retryAfterMs: number;
      readonly reason: 'empty_pool' | 'service_capacity' | 'wallet_cooldown' | 'running';
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
    ['walletId', 'signingKeyId', 'operationIdB64u', 'unsignedTransactionBorshB64u', 'actor'],
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
    actor: parseMlDsaSigningActor(r.actor),
  };
}
function parseMlDsaSigningActor(raw: unknown): MlDsaSigningActor {
  const record = requireRecord(raw, 'ML-DSA signing actor');
  switch (record.kind) {
    case 'passkey': {
      const actor = exactRecord(raw, ['kind', 'rpId', 'credentialIdB64u'], 'ML-DSA Passkey actor');
      return {
        kind: 'passkey',
        rpId: requireParsed(parseWebAuthnRpId(actor.rpId), 'rpId'),
        credentialIdB64u: requireParsed(
          parseWebAuthnCredentialIdB64u(actor.credentialIdB64u),
          'credentialIdB64u',
        ),
      };
    }
    case 'email_otp': {
      const actor = exactRecord(raw, ['kind', 'walletAuthMethodId'], 'ML-DSA Email OTP actor');
      return {
        kind: 'email_otp',
        walletAuthMethodId: requireParsed(
          parseWalletAuthMethodId(actor.walletAuthMethodId),
          'walletAuthMethodId',
        ),
      };
    }
    default:
      throw new Error('Unsupported ML-DSA signing actor');
  }
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
function signingFailureCode(raw: unknown): MlDsaSigningFailureCode {
  if (isTerminalFailureCode(raw)) return raw;
  switch (raw) {
    case 'not_configured':
    case 'invalid_body':
    case 'unauthorized':
    case 'not_found':
    case 'idempotency_conflict':
    case 'expired':
    case 'conflict':
    case 'invalid_signature':
      return raw;
    default:
      throw new Error('Unknown ML-DSA signing refusal');
  }
}

export function parseMlDsaSigningFailure(raw: unknown): MlDsaSigningFailure {
  const r = exactRecord(raw, ['kind', 'code', 'message'], 'ML-DSA signing refusal');
  if (r.kind !== 'refused') throw new Error('Invalid ML-DSA refusal');
  return {
    kind: 'refused',
    code: signingFailureCode(r.code),
    message: requireCanonicalString(r.message, 'message'),
  };
}

export function isMlDsaSigningErrorCode(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.startsWith('ml_dsa_signing_')) return false;
  try {
    signingFailureCode(raw.slice('ml_dsa_signing_'.length));
    return true;
  } catch {
    return false;
  }
}

/** A terminal refusal keeps its stable code through Wallet-origin RPC errors. */
export class MlDsaSigningError extends Error {
  readonly code: `ml_dsa_signing_${MlDsaSigningFailureCode}`;
  constructor(readonly failure: MlDsaSigningFailure) {
    super(failure.message);
    this.name = 'MlDsaSigningError';
    this.code = `ml_dsa_signing_${failure.code}`;
  }
}

const TERMINAL_MESSAGES: Record<MlDsaTerminalFailureCode, string> = {
  candidates_exhausted:
    'Signing could not complete. Please try again.',
  deadline_exceeded: 'The signing operation exceeded its deadline.',
  transport_interrupted: 'Signing was interrupted. Please try again.',
  participant_rejected: 'A signing participant rejected this operation.',
  participant_unavailable: 'A signing participant is unavailable.',
  invalid_participant_response: 'A signing participant returned an invalid response.',
  admission_rejected: 'The signing permit is no longer valid.',
  material_unavailable: 'Signing could not start. Please try again.',
  invalid_material: 'Stored signing material could not be authenticated.',
  configuration_invalid: 'The signing service configuration is invalid.',
  clock_unavailable: 'The signing service clock is unavailable.',
  key_changed: 'The signing key was restored or replaced during this operation.',
  cancelled: 'Signing admission was cancelled.',
  protocol_failed: 'The signing protocol could not complete.',
};

function isTerminalFailureCode(value: unknown): value is MlDsaTerminalFailureCode {
  return typeof value === 'string' && Object.hasOwn(TERMINAL_MESSAGES, value);
}

/** Decode the authenticated Router's public cause once at the Gateway boundary. */
export function parseMlDsaRouterFailure(raw: unknown): MlDsaSigningFailure {
  const value = requireRecord(raw, 'ML-DSA terminal failure');
  if (!isTerminalFailureCode(value.reason)) throw new Error('Unknown ML-DSA terminal failure');
  switch (value.reason) {
    case 'candidates_exhausted': {
      const failure = exactRecord(
        raw,
        ['reason', 'consumed_batches', 'evaluated_candidates'],
        'ML-DSA exhaustion',
      );
      if (
        typeof failure.consumed_batches !== 'number' ||
        !Number.isSafeInteger(failure.consumed_batches) ||
        failure.consumed_batches < 1 ||
        failure.consumed_batches > 20 ||
        typeof failure.evaluated_candidates !== 'number' ||
        !Number.isSafeInteger(failure.evaluated_candidates) ||
        failure.evaluated_candidates < failure.consumed_batches ||
        failure.evaluated_candidates > 640
      )
        throw new Error('Invalid ML-DSA exhaustion counts');
      return { kind: 'refused', code: value.reason, message: TERMINAL_MESSAGES[value.reason] };
    }
    case 'participant_rejected':
    case 'participant_unavailable': {
      const failure = exactRecord(raw, ['reason', 'status'], 'ML-DSA participant failure');
      if (
        typeof failure.status !== 'number' ||
        !Number.isInteger(failure.status) ||
        failure.status < 100 ||
        failure.status > 599
      )
        throw new Error('Invalid participant HTTP status');
      return { kind: 'refused', code: value.reason, message: TERMINAL_MESSAGES[value.reason] };
    }
    default:
      exactRecord(raw, ['reason'], 'ML-DSA terminal failure');
      return { kind: 'refused', code: value.reason, message: TERMINAL_MESSAGES[value.reason] };
  }
}
