import { toOptionalTrimmedString } from '@shared/utils/validation';
import type { SigningSessionSealRouteResult } from './signingSessionSeal.types';

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

type CurrentSigningSessionSealSuccessIdempotencyResultRecord = {
  ok: true;
  ciphertext: string;
  keyVersion?: string;
  expiresAtMs?: number;
};

type CurrentSigningSessionSealFailureIdempotencyResultRecord = {
  ok: false;
  code: string;
  message: string;
};

type CurrentSigningSessionSealIdempotencyResultRecord =
  | CurrentSigningSessionSealSuccessIdempotencyResultRecord
  | CurrentSigningSessionSealFailureIdempotencyResultRecord;

type CurrentSigningSessionSealIdempotencyStoredEntry = {
  result: CurrentSigningSessionSealIdempotencyResultRecord;
  expiresAtMs: number;
};

function parseCurrentSigningSessionSealIdempotencyResultRecord(
  raw: unknown,
): CurrentSigningSessionSealIdempotencyResultRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.ok === true) {
    const ciphertext = toOptionalTrimmedString(obj.ciphertext);
    if (!ciphertext) return null;
    const keyVersion = toOptionalTrimmedString(obj.keyVersion);
    const expiresAtMs = toPositiveInt(obj.expiresAtMs);
    if (
      ('keyVersion' in obj && obj.keyVersion != null && !keyVersion) ||
      ('expiresAtMs' in obj && obj.expiresAtMs != null && expiresAtMs == null) ||
      'remainingUses' in obj
    ) {
      return null;
    }
    return {
      ok: true,
      ciphertext,
      ...(keyVersion ? { keyVersion } : {}),
      ...(expiresAtMs != null ? { expiresAtMs } : {}),
    };
  }

  if (obj.ok === false) {
    const code = toOptionalTrimmedString(obj.code);
    const message = toOptionalTrimmedString(obj.message);
    if (!code || !message) return null;
    return {
      ok: false,
      code,
      message,
    };
  }

  return null;
}

export function parseCurrentSigningSessionSealIdempotencyStoredEntry(
  raw: unknown,
): CurrentSigningSessionSealIdempotencyStoredEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const result = parseCurrentSigningSessionSealIdempotencyResultRecord(obj.result);
  const expiresAtMs = toPositiveInt(obj.expiresAtMs);
  if (!result || expiresAtMs == null) return null;
  return {
    result,
    expiresAtMs,
  };
}

export function parseCurrentSigningSessionSealIdempotencyRouteResult(
  raw: unknown,
): SigningSessionSealRouteResult | null {
  return parseCurrentSigningSessionSealIdempotencyResultRecord(raw);
}
