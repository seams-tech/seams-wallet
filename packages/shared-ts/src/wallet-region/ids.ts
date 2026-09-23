import { base64UrlDecode, base64UrlEncode } from '../utils/base64';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import { hasWhitespaceOrControlCharacters, parseWalletId, type WalletId } from '../utils/domainIds';

type WalletRegionBrand<TName extends string> = {
  readonly __walletRegionBrand: TName;
};

export type WalletHomeLaneId<TValue extends string = string> = TValue &
  WalletRegionBrand<'WalletHomeLaneId'>;
export type WalletLaneEpoch = number & WalletRegionBrand<'WalletLaneEpoch'>;
export type WalletRegionMigrationId = string & WalletRegionBrand<'WalletRegionMigrationId'>;
export type WalletDirectoryRevision = number & WalletRegionBrand<'WalletDirectoryRevision'>;
export type UnixTimestamp = number & WalletRegionBrand<'UnixTimestamp'>;
export type WalletRegionMigrationGrantDigest = DigestB64u &
  WalletRegionBrand<'WalletRegionMigrationGrantDigest'>;
export type WalletRegionReceiptDigest = DigestB64u & WalletRegionBrand<'WalletRegionReceiptDigest'>;
export type WalletRegionReceiptSignerKeyId = string &
  WalletRegionBrand<'WalletRegionReceiptSignerKeyId'>;
export type WalletRegionReceiptSignatureB64u = string &
  WalletRegionBrand<'WalletRegionReceiptSignatureB64u'>;
export type WalletRegionPolicyVersion = string & WalletRegionBrand<'WalletRegionPolicyVersion'>;
export type WalletRegionRequestNonceB64u = string &
  WalletRegionBrand<'WalletRegionRequestNonceB64u'>;
export type WalletRegionStepUpChallengeDigest = DigestB64u &
  WalletRegionBrand<'WalletRegionStepUpChallengeDigest'>;

export const MANAGED_WALLET_HOME_LANE_IDS = {
  northAmerica: 'managed-na-v1',
  europe: 'managed-eu-v1',
  asiaPacific: 'managed-apac-v1',
} as const;

export type ManagedWalletHomeLaneIdValue =
  (typeof MANAGED_WALLET_HOME_LANE_IDS)[keyof typeof MANAGED_WALLET_HOME_LANE_IDS];
export type ManagedWalletHomeLaneId = WalletHomeLaneId<ManagedWalletHomeLaneIdValue>;

export type WalletRegionBoundaryError = {
  readonly code: 'missing' | 'invalid';
  readonly message: string;
};

export type WalletRegionBoundaryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WalletRegionBoundaryError };

const LANE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MIGRATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const SIGNER_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const POLICY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

function missing(label: string): WalletRegionBoundaryResult<never> {
  return {
    ok: false,
    error: { code: 'missing', message: `${label} is required` },
  };
}

function invalid(label: string, requirement: string): WalletRegionBoundaryResult<never> {
  return {
    ok: false,
    error: { code: 'invalid', message: `${label} ${requirement}` },
  };
}

function parseIdentifier<T>(
  raw: unknown,
  label: string,
  pattern: RegExp,
): WalletRegionBoundaryResult<T> {
  if (raw == null || raw === '') return missing(label);
  if (typeof raw !== 'string') return invalid(label, 'must be a string');
  if (raw.trim() !== raw || hasWhitespaceOrControlCharacters(raw) || !pattern.test(raw)) {
    return invalid(label, 'has an invalid canonical value');
  }
  return { ok: true, value: raw as T };
}

export function parseWalletHomeLaneId<const TValue extends string>(
  raw: TValue,
): WalletRegionBoundaryResult<WalletHomeLaneId<TValue>>;
export function parseWalletHomeLaneId(raw: unknown): WalletRegionBoundaryResult<WalletHomeLaneId>;
export function parseWalletHomeLaneId(raw: unknown): WalletRegionBoundaryResult<WalletHomeLaneId> {
  return parseIdentifier(raw, 'laneId', LANE_ID_PATTERN);
}

export function parseManagedWalletHomeLaneId(
  raw: unknown,
): WalletRegionBoundaryResult<ManagedWalletHomeLaneId> {
  const parsed = parseWalletHomeLaneId(raw);
  if (!parsed.ok) return parsed;
  if (
    !Object.values(MANAGED_WALLET_HOME_LANE_IDS).includes(
      parsed.value as ManagedWalletHomeLaneIdValue,
    )
  ) {
    return invalid('laneId', 'is not a managed wallet lane');
  }
  return { ok: true, value: parsed.value as ManagedWalletHomeLaneId };
}

export function parseWalletLaneEpoch(raw: unknown): WalletRegionBoundaryResult<WalletLaneEpoch> {
  if (raw == null || raw === '') return missing('laneEpoch');
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    return invalid('laneEpoch', 'must be a positive safe integer');
  }
  return { ok: true, value: raw as WalletLaneEpoch };
}

export function nextWalletLaneEpoch(current: WalletLaneEpoch): WalletLaneEpoch {
  const next = Number(current) + 1;
  const parsed = parseWalletLaneEpoch(next);
  if (!parsed.ok) throw new Error('wallet lane epoch cannot advance beyond the safe integer range');
  return parsed.value;
}

export function parseWalletRegionMigrationId(
  raw: unknown,
): WalletRegionBoundaryResult<WalletRegionMigrationId> {
  return parseIdentifier(raw, 'migrationId', MIGRATION_ID_PATTERN);
}

export function parseWalletDirectoryRevision(
  raw: unknown,
): WalletRegionBoundaryResult<WalletDirectoryRevision> {
  if (raw == null || raw === '') return missing('directoryRevision');
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    return invalid('directoryRevision', 'must be a positive safe integer');
  }
  return { ok: true, value: raw as WalletDirectoryRevision };
}

export function parseUnixTimestamp(raw: unknown): WalletRegionBoundaryResult<UnixTimestamp> {
  if (raw == null || raw === '') return missing('timestamp');
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    return invalid('timestamp', 'must be a positive safe integer');
  }
  return { ok: true, value: raw as UnixTimestamp };
}

function parseDigest<T extends DigestB64u>(
  raw: unknown,
  label: string,
): WalletRegionBoundaryResult<T> {
  try {
    return { ok: true, value: parseDigestB64u(raw) as T };
  } catch (error) {
    return invalid(label, error instanceof Error ? error.message : 'must be a digest');
  }
}

export function parseWalletRegionMigrationGrantDigest(
  raw: unknown,
): WalletRegionBoundaryResult<WalletRegionMigrationGrantDigest> {
  return parseDigest(raw, 'grantDigest');
}

export function parseWalletRegionReceiptDigest(
  raw: unknown,
): WalletRegionBoundaryResult<WalletRegionReceiptDigest> {
  return parseDigest(raw, 'receiptDigestB64u');
}

export function parseWalletRegionReceiptSignerKeyId(
  raw: unknown,
): WalletRegionBoundaryResult<WalletRegionReceiptSignerKeyId> {
  return parseIdentifier(raw, 'receiptSignerKeyId', SIGNER_KEY_ID_PATTERN);
}

export function parseWalletRegionReceiptSignatureB64u(
  raw: unknown,
): WalletRegionBoundaryResult<WalletRegionReceiptSignatureB64u> {
  if (raw == null || raw === '') return missing('receiptSignatureB64u');
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    return invalid('receiptSignatureB64u', 'must be unpadded base64url');
  }
  try {
    const decoded = base64UrlDecode(raw);
    if (decoded.length !== 64 || base64UrlEncode(decoded) !== raw) {
      return invalid('receiptSignatureB64u', 'must be canonical base64url for 64 bytes');
    }
  } catch {
    return invalid('receiptSignatureB64u', 'must be valid base64url');
  }
  return { ok: true, value: raw as WalletRegionReceiptSignatureB64u };
}

export function parseWalletRegionPolicyVersion(
  raw: unknown,
): WalletRegionBoundaryResult<WalletRegionPolicyVersion> {
  return parseIdentifier(raw, 'policyVersion', POLICY_VERSION_PATTERN);
}

export function parseWalletRegionRequestNonceB64u(
  raw: unknown,
): WalletRegionBoundaryResult<WalletRegionRequestNonceB64u> {
  if (raw == null || raw === '') return missing('requestNonceB64u');
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    return invalid('requestNonceB64u', 'must be unpadded base64url');
  }
  try {
    const decoded = base64UrlDecode(raw);
    if (decoded.length !== 32 || base64UrlEncode(decoded) !== raw) {
      return invalid('requestNonceB64u', 'must be canonical base64url for 32 bytes');
    }
  } catch {
    return invalid('requestNonceB64u', 'must be valid base64url');
  }
  return { ok: true, value: raw as WalletRegionRequestNonceB64u };
}

export function parseWalletRegionStepUpChallengeDigest(
  raw: unknown,
): WalletRegionBoundaryResult<WalletRegionStepUpChallengeDigest> {
  return parseDigest(raw, 'stepUpChallengeDigestB64u');
}

export function requireWalletId(raw: unknown, label = 'walletId'): WalletId {
  const parsed = parseWalletId(raw);
  if (!parsed.ok) throw new Error(`${label}: ${parsed.error.message}`);
  return parsed.value;
}

export function requireWalletRegionBoundary<T>(
  result: WalletRegionBoundaryResult<T>,
  label: string,
): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.value;
}
