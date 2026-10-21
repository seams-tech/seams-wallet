import { exactRecord } from '../utils/exactRecord';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import { parseWalletId, type WalletId } from '../utils/domainIds';
import { requireParsed } from '../passkey-custody/primitives';
import type { ReadonlyExclusiveUnion } from '../utils/variant';

export type MlDsaSigningAuthorization<Credential> = ReadonlyExclusiveUnion<
  | { readonly kind: 'passkey'; readonly credential: Credential }
  | {
      readonly kind: 'session_start';
      readonly credential: Credential;
      readonly sessionIdB64u: DigestB64u;
      readonly tokenB64u: DigestB64u;
    }
  | { readonly kind: 'session'; readonly sessionIdB64u: DigestB64u; readonly tokenB64u: DigestB64u }
>;

export type MlDsaSigningSessionPolicy = {
  readonly maxOperations: number;
  readonly durationMs: number;
};
export type MlDsaSigningSessionCredential = {
  readonly walletId: WalletId;
  readonly sessionIdB64u: DigestB64u;
  readonly tokenB64u: DigestB64u;
};
export function parseMlDsaSigningSessionCredential(raw: unknown): MlDsaSigningSessionCredential {
  const record = exactRecord(
    raw,
    ['walletId', 'sessionIdB64u', 'tokenB64u'],
    'ML-DSA session credential',
  );
  return {
    walletId: requireParsed(parseWalletId(record.walletId), 'walletId'),
    sessionIdB64u: parseDigestB64u(record.sessionIdB64u),
    tokenB64u: parseDigestB64u(record.tokenB64u),
  };
}
export type MlDsaSigningSessionRequest = MlDsaSigningSessionPolicy & {
  readonly walletId: WalletId;
  readonly operationIdB64u: DigestB64u;
  readonly tokenDigestB64u: DigestB64u;
};
export type MlDsaSigningSessionPreparation = {
  readonly sessionIdB64u: DigestB64u;
  readonly challengeB64u: DigestB64u;
  readonly expiresAtMs: number;
  readonly maxOperations: number;
};

export function parseMlDsaSigningSessionPolicy(raw: unknown): MlDsaSigningSessionPolicy {
  const record = exactRecord(raw, ['maxOperations', 'durationMs'], 'ML-DSA session policy');
  if (
    typeof record.maxOperations !== 'number' ||
    !Number.isSafeInteger(record.maxOperations) ||
    record.maxOperations < 1 ||
    record.maxOperations > 32
  )
    throw new Error('ML-DSA sessions require between 1 and 32 operations');
  if (
    typeof record.durationMs !== 'number' ||
    !Number.isSafeInteger(record.durationMs) ||
    record.durationMs < 60_000 ||
    record.durationMs > 900_000
  )
    throw new Error('ML-DSA sessions require a duration between one and fifteen minutes');
  return { maxOperations: record.maxOperations, durationMs: record.durationMs };
}

export function parseMlDsaSigningSessionRequest(raw: unknown): MlDsaSigningSessionRequest {
  const record = exactRecord(
    raw,
    ['walletId', 'operationIdB64u', 'tokenDigestB64u', 'maxOperations', 'durationMs'],
    'ML-DSA session request',
  );
  const policy = parseMlDsaSigningSessionPolicy({
    maxOperations: record.maxOperations,
    durationMs: record.durationMs,
  });
  return {
    walletId: requireParsed(parseWalletId(record.walletId), 'walletId'),
    operationIdB64u: parseDigestB64u(record.operationIdB64u),
    tokenDigestB64u: parseDigestB64u(record.tokenDigestB64u),
    maxOperations: policy.maxOperations,
    durationMs: policy.durationMs,
  };
}

export function parseMlDsaSigningSessionPreparation(raw: unknown): MlDsaSigningSessionPreparation {
  const record = exactRecord(
    raw,
    ['sessionIdB64u', 'challengeB64u', 'expiresAtMs', 'maxOperations'],
    'ML-DSA session preparation',
  );
  if (
    typeof record.expiresAtMs !== 'number' ||
    !Number.isSafeInteger(record.expiresAtMs) ||
    record.expiresAtMs <= 0
  )
    throw new Error('Invalid ML-DSA session expiry');
  const policy = parseMlDsaSigningSessionPolicy({
    maxOperations: record.maxOperations,
    durationMs: 60_000,
  });
  return {
    sessionIdB64u: parseDigestB64u(record.sessionIdB64u),
    challengeB64u: parseDigestB64u(record.challengeB64u),
    expiresAtMs: record.expiresAtMs,
    maxOperations: policy.maxOperations,
  };
}
