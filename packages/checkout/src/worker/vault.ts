import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { hmacSha256Hex, timingSafeEqual } from '../shared/signature';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SEAL_VERSION = 'v1';

function importAesKey(keyB64u: string): Promise<CryptoKey> {
  const raw = base64UrlDecode(keyB64u);
  if (raw.length !== 32) throw new Error('An encryption key of the checkout is 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Encrypts a secret for the database with AES-256-GCM. `slot` names the row and the field, and
 * it is bound to the ciphertext, so a sealed value that moves to another row does not open.
 */
export async function seal(keyB64u: string, slot: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(slot) },
    await importAesKey(keyB64u),
    encoder.encode(plaintext),
  );
  return `${SEAL_VERSION}.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

export async function unseal(keyB64u: string, slot: string, sealed: string): Promise<string> {
  const [version, iv, ciphertext] = sealed.split('.');
  if (version !== SEAL_VERSION || !iv || !ciphertext) {
    throw new Error('The sealed value has an unknown form');
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(iv), additionalData: encoder.encode(slot) },
    await importAesKey(keyB64u),
    base64UrlDecode(ciphertext),
  );
  return decoder.decode(plaintext);
}

const CLIENT_TOKEN_PREFIX = 'cot_';

/**
 * The client token of an order: the order ID and a MAC of it. The Worker stores no token, so a
 * repeated `createOrder` with the same reference gives the same token.
 */
export async function mintClientToken(tokenKey: string, orderId: string): Promise<string> {
  return `${CLIENT_TOKEN_PREFIX}${orderId}.${await hmacSha256Hex(tokenKey, orderId)}`;
}

/** The order ID of a valid client token, or null. */
export async function readClientToken(tokenKey: string, token: string): Promise<string | null> {
  if (!token.startsWith(CLIENT_TOKEN_PREFIX)) return null;
  const separator = token.lastIndexOf('.');
  if (separator < 0) return null;
  const orderId = token.slice(CLIENT_TOKEN_PREFIX.length, separator);
  const expected = await hmacSha256Hex(tokenKey, orderId);
  return timingSafeEqual(token.slice(separator + 1), expected) ? orderId : null;
}
