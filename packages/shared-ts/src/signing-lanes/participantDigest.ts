import { base64UrlDecode } from '../utils/base64';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import { concat } from '../utils/digestEncoding';

function u32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('canonical u32 must be an integer between 0 and 4294967295');
  }
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

/** LP32(UTF8(value)) from the canonical lane encoding. */
export function encodeLaneCanonicalTextV1(value: string): Uint8Array {
  if (typeof value !== 'string') throw new Error('canonical text must be a string');
  const bytes = new TextEncoder().encode(value);
  return concat([u32(bytes.length), bytes]);
}

/** LP32(BASE64URL_DECODE_CANONICAL_32(value)) from the canonical lane encoding. */
export function encodeLaneCanonicalDigestV1(value: DigestB64u): Uint8Array {
  const parsed = parseDigestB64u(value);
  return concat([u32(32), base64UrlDecode(parsed)]);
}

/** U64(value), encoded as unsigned big-endian bytes. */
export function encodeLaneCanonicalU64V1(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('canonical u64 must be a non-negative safe integer');
  }
  const output = new Uint8Array(8);
  const remaining = BigInt(value);
  for (let shift = 56; shift >= 0; shift -= 8) {
    output[7 - shift / 8] = Number((remaining >> BigInt(shift)) & 0xffn);
  }
  return output;
}
