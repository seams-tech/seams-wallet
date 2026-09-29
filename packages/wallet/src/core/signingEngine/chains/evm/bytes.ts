export function hexToBytes(hex: string): Uint8Array {
  const raw = String(hex || '');
  const normalized = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (normalized.length === 0) return new Uint8Array();
  if (normalized.length % 2 !== 0) {
    throw new Error(`Invalid hex (odd length): ${hex}`);
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = normalized.slice(i * 2, i * 2 + 2);
    const value = Number.parseInt(byte, 16);
    if (!Number.isFinite(value)) throw new Error(`Invalid hex: ${hex}`);
    bytes[i] = value;
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
}
