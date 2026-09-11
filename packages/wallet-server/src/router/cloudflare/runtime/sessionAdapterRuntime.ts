import { base64UrlDecode, base64UrlEncode } from '@shared/utils/encoders';

export type ParsedSessionJwt =
  | {
      readonly ok: true;
      readonly headerB64u: string;
      readonly payloadB64u: string;
      readonly signatureB64u: string;
      readonly header: Record<string, unknown>;
      readonly payload: Record<string, unknown>;
    }
  | { readonly ok: false };

export class CrossSiteSessionCookieAdapter {
  constructor(
    private readonly cookieName: string,
    private readonly ttlSeconds: number,
  ) {}

  buildSetHeader(token: string): string {
    const expires = new Date(Date.now() + this.ttlSeconds * 1000).toUTCString();
    return [
      `${this.cookieName}=${token}`,
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=None',
      `Max-Age=${this.ttlSeconds}`,
      `Expires=${expires}`,
    ].join('; ');
  }

  buildClearHeader(): string {
    return [
      `${this.cookieName}=`,
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=None',
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ].join('; ');
  }
}

export function requireNormalizedSessionString(value: unknown, label: string): string {
  const normalized = normalizeSessionString(value);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function sessionJwtTimeClaims(
  payload: Record<string, unknown>,
  nowSeconds: number,
  ttlSeconds: number,
): { readonly iat: number; readonly exp: number } {
  if (!isRouterWalletSessionPayload(payload)) {
    return { iat: nowSeconds, exp: nowSeconds + ttlSeconds };
  }
  const iat = Number(payload.iat);
  const exp = Number(payload.exp);
  if (
    !Number.isSafeInteger(iat) ||
    iat < 0 ||
    iat > nowSeconds ||
    !Number.isSafeInteger(exp) ||
    exp <= nowSeconds ||
    exp > nowSeconds + ttlSeconds
  ) {
    throw new Error('Wallet Session JWT lifetime exceeds the session signing policy');
  }
  return { iat, exp };
}

export function normalizeSessionTtlSeconds(input: number | undefined): number {
  const ttl = Number(input || 24 * 60 * 60);
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 30 * 24 * 60 * 60) {
    throw new Error('staging session ttlSeconds must be between 60 seconds and 30 days');
  }
  return ttl;
}

export function encodeSessionJsonSegment(input: Record<string, unknown>): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(input)));
}

export function parseSessionJwt(token: string): ParsedSessionJwt {
  const parts = normalizeSessionString(token).split('.');
  if (parts.length !== 3) return { ok: false };
  const header = parseJsonSegment(parts[0] || '');
  const payload = parseJsonSegment(parts[1] || '');
  if (!header || !payload) return { ok: false };
  return {
    ok: true,
    headerB64u: parts[0] || '',
    payloadB64u: parts[1] || '',
    signatureB64u: parts[2] || '',
    header,
    payload,
  };
}

export function toSessionArrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

export function normalizeSessionString(input: unknown): string {
  return String(input || '').trim();
}

function isRouterWalletSessionPayload(payload: Record<string, unknown>): boolean {
  return (
    payload.kind === 'router_ab_ed25519_wallet_session_v1' ||
    payload.kind === 'router_ab_ecdsa_derivation_wallet_session_v1'
  );
}

function parseJsonSegment(input: string): Record<string, unknown> | null {
  let decoded: Uint8Array;
  try {
    decoded = base64UrlDecode(input);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decoded));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
