// Limits every tenant-root identifier shares: identity fields and creation-grant key ids.
export const TENANT_ROOT_IDENTITY_MAX_IDENTIFIER_BYTES_V1 = 256;

export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}
