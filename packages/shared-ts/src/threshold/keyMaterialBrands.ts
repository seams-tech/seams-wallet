export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type SigningSessionSealKeyVersion = Brand<string, 'SigningSessionSealKeyVersion'>;
export type EcdsaClientVerifyingShareB64u = Brand<string, 'EcdsaClientVerifyingShareB64u'>;
export type EcdsaRelayerKeyId = Brand<string, 'EcdsaRelayerKeyId'>;
export type EcdsaKeyHandle = Brand<string, 'EcdsaKeyHandle'>;

export function parseNonEmptyBrand<T extends string>(
  value: unknown,
  label: string,
): Brand<string, T> {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return normalized as Brand<string, T>;
}

export function parseSigningSessionSealKeyVersion(value: unknown): SigningSessionSealKeyVersion {
  return parseNonEmptyBrand<'SigningSessionSealKeyVersion'>(
    value,
    'signing-session seal key version',
  );
}

export function parseEcdsaClientVerifyingShareB64u(value: unknown): EcdsaClientVerifyingShareB64u {
  return parseNonEmptyBrand<'EcdsaClientVerifyingShareB64u'>(value, 'ECDSA client verifying share');
}

export function parseEcdsaRelayerKeyId(value: unknown): EcdsaRelayerKeyId {
  return parseNonEmptyBrand<'EcdsaRelayerKeyId'>(value, 'ECDSA relayer key id');
}

export function parseEcdsaKeyHandle(value: unknown): EcdsaKeyHandle {
  return parseNonEmptyBrand<'EcdsaKeyHandle'>(value, 'ECDSA key handle');
}

export function formatSigningSessionSealKeyVersionForWire(
  value: SigningSessionSealKeyVersion,
): string {
  return value;
}

export function formatEcdsaKeyHandleForWire(value: EcdsaKeyHandle): string {
  return value;
}
