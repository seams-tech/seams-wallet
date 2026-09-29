export type SignerSlot = number & { readonly __brand: 'SignerSlot' };

export function parseSignerSlot(
  value: unknown,
  options: { min?: number } = {},
): SignerSlot | null {
  const signerSlot = Number(value);
  const minRaw = options.min;
  const min = Number.isSafeInteger(minRaw) && Number(minRaw) >= 1 ? Number(minRaw) : 1;
  if (!Number.isSafeInteger(signerSlot) || signerSlot < min) {
    return null;
  }
  return signerSlot as SignerSlot;
}

