import { bytesToUnprefixedHex } from '@shared/utils/digests';

const encoder = new TextEncoder();

/** HMAC-SHA256 of `message` as lower-case hex, with WebCrypto. */
export async function hmacSha256Hex(key: string | Uint8Array, message: string): Promise<string> {
  const keyBytes = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return bytesToUnprefixedHex(new Uint8Array(signature));
}

/** Compares two strings in a time that depends only on their lengths. */
export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * A signature header of the form `t=<unix seconds>,v1=<hex>`. The signature covers
 * `<t>.<body>`, so a receiver can refuse an old message. Stripe signs its webhooks this way, and
 * the checkout signs its events for a merchant the same way.
 */
export async function signTimestamped(
  secret: string,
  body: string,
  nowMs: number,
): Promise<string> {
  const timestamp = Math.floor(nowMs / 1000);
  return `t=${timestamp},v1=${await hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

type TimestampedCheck = {
  readonly secret: string;
  readonly body: string;
  readonly header: string | null;
  readonly nowMs: number;
  readonly toleranceSeconds: number;
};

export async function verifyTimestamped(check: TimestampedCheck): Promise<boolean> {
  const parts = (check.header ?? '').split(',').map((part) => part.trim().split('='));
  const timestamp = parts.find(([name]) => name === 't')?.[1] ?? '';
  const signatures = parts.filter(([name]) => name === 'v1').map(([, value]) => value ?? '');
  if (!/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;
  const ageSeconds = Math.abs(check.nowMs / 1000 - Number(timestamp));
  if (ageSeconds > check.toleranceSeconds) return false;
  const expected = await hmacSha256Hex(check.secret, `${timestamp}.${check.body}`);
  // A provider sends two signatures while it rolls a secret, so each one is tried.
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}
