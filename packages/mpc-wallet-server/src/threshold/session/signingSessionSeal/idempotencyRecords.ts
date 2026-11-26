import { readSigningSessionSealEvaluation } from '@shared/utils/signingSessionSeal';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import { failure } from '@shared/utils/failure';
import type { SigningSessionSealRouteResult } from './signingSessionSeal.types';

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

type CurrentSigningSessionSealIdempotencyStoredEntry = {
  result: SigningSessionSealRouteResult;
  expiresAtMs: number;
};

export function parseCurrentSigningSessionSealIdempotencyResultRecord(
  raw: unknown,
): SigningSessionSealRouteResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.ok === true) {
    const evaluation = readSigningSessionSealEvaluation(obj);
    const expiresAtMs = toPositiveInt(obj.expiresAtMs);
    if (!evaluation || expiresAtMs == null || 'remainingUses' in obj) return null;
    return { ok: true, ...evaluation, expiresAtMs };
  }

  if (obj.ok === false) {
    const code = toOptionalTrimmedString(obj.code);
    const message = toOptionalTrimmedString(obj.message);
    if (!code || !message) return null;
    return failure(code, message);
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
