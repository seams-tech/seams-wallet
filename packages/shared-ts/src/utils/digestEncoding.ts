// Byte encoders for the canonical digest encodings: big-endian integers and u32 length-prefixed
// fields. Every digest built from them depends on their exact output, so a change here changes
// those digests.

import { base64UrlDecode, base64UrlEncode } from './base64';
import { parseDigestB64u, type DigestB64u } from './canonicalPrimitives';

const TEXT_ENCODER = new TextEncoder();

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function u32(value: number, label: string): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be a non-negative u32`);
  }
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

export function u64(value: number, label: string): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  let remaining = BigInt(value);
  const output = new Uint8Array(8);
  for (let index = 7; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}

export function lp32(value: Uint8Array, label: string): Uint8Array {
  return concat([u32(value.length, `${label}.length`), value]);
}

export function text(value: string, label: string): Uint8Array {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return lp32(TEXT_ENCODER.encode(value), label);
}

export function rawDigest(value: DigestB64u, label: string): Uint8Array {
  try {
    const decoded = base64UrlDecode(parseDigestB64u(value));
    if (decoded.length !== 32) throw new Error('must decode to 32 bytes');
    return decoded;
  } catch (error) {
    throw new Error(`${label} ${error instanceof Error ? error.message : 'is invalid'}`);
  }
}

export function rawPublicKey(value: string, label: string): Uint8Array {
  try {
    const decoded = base64UrlDecode(value);
    if (decoded.length === 0 || base64UrlEncode(decoded) !== value) {
      throw new Error('must be canonical base64url');
    }
    return decoded;
  } catch (error) {
    throw new Error(`${label} ${error instanceof Error ? error.message : 'is invalid'}`);
  }
}
