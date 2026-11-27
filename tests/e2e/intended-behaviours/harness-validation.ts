export function requireRecord(raw: unknown, label: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  return Object.fromEntries(Object.entries(raw));
}

export function requireString(raw: unknown, label: string): string {
  if (typeof raw !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  const value = raw.trim();
  if (!value) {
    throw new Error(`${label} must be non-empty`);
  }
  return value;
}

export function requireAuthenticatedKind(raw: unknown, label: string): 'authenticated' {
  const value = requireString(raw, label);
  if (value !== 'authenticated') {
    throw new Error(`${label} must be authenticated`);
  }
  return value;
}

export function requireHexString(raw: unknown, label: string): `0x${string}` {
  const value = requireString(raw, label);
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} must be 0x-prefixed hex`);
  }
  return value as `0x${string}`;
}

export function requirePositiveInteger(raw: unknown, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

export function requireNonNegativeInteger(raw: unknown, label: string): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return raw;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected intended e2e value: ${String(value)}`);
}
