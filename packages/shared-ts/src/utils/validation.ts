import { normalizeOptionalTrimmedString, normalizeTrimmedString } from './normalize';

// ==============================
// Normalization helpers (shared)
// ==============================

export {
  normalizeOptionalString as toOptionalString,
  normalizeOptionalTrimmedString as toOptionalTrimmedString,
  normalizeTrimmedString as toTrimmedString,
  stripTrailingSlashes,
  ensureLeadingSlash,
  toBasePath,
  toOriginOrUndefined,
  toRorOriginOrNull,
  normalizeInteger,
  normalizePositiveInteger,
} from './normalize';

export function requireTrimmedString(
  value: unknown,
  label: string,
  message = 'is required',
): string {
  const parsed = normalizeOptionalTrimmedString(value);
  if (!parsed) throw new Error(`${label} ${message}`);
  return parsed;
}

export function toOptionalTrimmedNonEmptyString(value: unknown): string | undefined {
  const parsed = normalizeOptionalTrimmedString(value);
  return parsed || undefined;
}

// requireTrimmedString's check, with an error that says a non-empty string was expected.
export function requireNonEmptyString(value: unknown, label: string): string {
  return requireTrimmedString(value, label, 'must be a non-empty string');
}

// Canonical: non-empty, with no leading or trailing whitespace. Returned unchanged.
export function requireCanonicalString(
  value: unknown,
  label: string,
  message = 'is invalid',
): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} ${message}`);
  }
  return value;
}

// Stringifies any truthy value: 42 passes as '42', while 0 and false count as missing.
export function coerceNonEmptyString(value: unknown, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

// Like coerceNonEmptyString, but only null and undefined count as missing.
export function coerceNonNullishString(value: unknown, label: string): string {
  const normalized = normalizeTrimmedString(value);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

// ===========================
// Runtime validation helpers
// ===========================

export function isObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object';
}

export function isPlainObject(x: unknown): x is Record<string, unknown> {
  return isObject(x) && !Array.isArray(x);
}

export function isString(x: unknown): x is string {
  return typeof x === 'string';
}

export function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function isFunction(x: unknown): x is (...args: unknown[]) => unknown {
  return typeof x === 'function';
}

export function isBoolean(x: unknown): x is boolean {
  return typeof x === 'boolean';
}

export function isArray<T = unknown>(x: unknown): x is T[] {
  return Array.isArray(x);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

export function asRecordOrArray(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

export function requireRecordOrArray(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

// Returns a copy with only the value's own enumerable string-keyed properties.
export function requireRecordCopy(value: unknown, label: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(requireRecord(value, label)));
}

export function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

export function assertString(val: unknown, name = 'value'): string {
  if (typeof val !== 'string') throw new Error(`Invalid ${name}: expected string`);
  return val;
}

export function stripFunctionsShallow<T extends Record<string, unknown>>(
  obj?: T,
): Partial<T> | undefined {
  if (!obj || !isObject(obj)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!isFunction(v)) out[k] = v as unknown;
  }
  return out as Partial<T>;
}

export interface PlainSignedTransactionLike {
  transaction: unknown;
  signature: unknown;
  borsh_bytes?: unknown;
  borshBytes?: unknown;
  base64Encode?: unknown;
}

export function isPlainSignedTransactionLike(x: unknown): x is PlainSignedTransactionLike {
  if (!isObject(x)) return false;
  const hasTx = 'transaction' in x;
  const hasSig = 'signature' in x;
  const bytes = x as { borsh_bytes?: unknown; borshBytes?: unknown };
  const hasBytes = Array.isArray(bytes.borsh_bytes) || bytes.borshBytes instanceof Uint8Array;
  const hasMethod = typeof (x as { base64Encode?: unknown }).base64Encode === 'function';
  return hasTx && hasSig && hasBytes && !hasMethod;
}

export function extractBorshBytesFromPlainSignedTx(x: PlainSignedTransactionLike): number[] {
  const asArray = Array.isArray(x.borsh_bytes) ? (x.borsh_bytes as number[]) : undefined;
  if (asArray) return asArray;
  const asU8 = x.borshBytes instanceof Uint8Array ? x.borshBytes : undefined;
  return Array.from(asU8 || new Uint8Array());
}
