import { base64UrlDecode, base64UrlEncode } from '@shared/utils/encoders';
import { SessionService } from '../../../core/SessionService';
import type { SessionAdapter } from '../../framework/routerApi';
import {
  CrossSiteSessionCookieAdapter,
  encodeSessionJsonSegment,
  normalizeSessionString,
  normalizeSessionTtlSeconds,
  parseSessionJwt,
  requireNormalizedSessionString,
  sessionJwtTimeClaims,
  toSessionArrayBufferCopy,
} from './sessionAdapterRuntime';

export interface Ed25519SessionAdapterOptions {
  readonly privateJwk: JsonWebKey & {
    readonly kty: 'OKP';
    readonly crv: 'Ed25519';
    readonly x: string;
    readonly d: string;
  };
  readonly keyId: string;
  readonly cookieName?: string;
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds?: number;
}

class Ed25519SessionJwtAdapter {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly keyId: string;
  private readonly ttlSeconds: number;
  private readonly signingKey: Promise<CryptoKey>;
  private readonly verifyingKey: Promise<CryptoKey>;

  constructor(private readonly options: Ed25519SessionAdapterOptions) {
    this.issuer = requireNormalizedSessionString(options.issuer, 'Ed25519 session issuer');
    this.audience = requireNormalizedSessionString(options.audience, 'Ed25519 session audience');
    this.keyId = requireNormalizedSessionString(options.keyId, 'Ed25519 session key id');
    this.ttlSeconds = normalizeSessionTtlSeconds(options.ttlSeconds);
    this.signingKey = this.importSigningKey();
    this.verifyingKey = this.importVerifyingKey();
  }

  async signToken(input: {
    readonly header: Record<string, unknown>;
    readonly payload: Record<string, unknown>;
  }): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const timeClaims = sessionJwtTimeClaims(input.payload, nowSeconds, this.ttlSeconds);
    const headerB64u = encodeSessionJsonSegment({
      ...input.header,
      typ: 'JWT',
      alg: 'EdDSA',
      kid: this.keyId,
    });
    const payloadB64u = encodeSessionJsonSegment({
      ...input.payload,
      ...routerWalletSessionScopeClaims(input.payload),
      ...timeClaims,
      iss: this.issuer,
      aud: this.audience,
    });
    const signingInput = `${headerB64u}.${payloadB64u}`;
    const signature = await crypto.subtle.sign(
      { name: 'Ed25519' },
      await this.signingKey,
      new TextEncoder().encode(signingInput),
    );
    return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  }

  async verifyToken(
    token: string,
  ): Promise<{ readonly valid: boolean; readonly payload?: unknown }> {
    const parsed = parseSessionJwt(token);
    if (!parsed.ok) return { valid: false };
    if (
      normalizeSessionString(parsed.header.alg) !== 'EdDSA' ||
      normalizeSessionString(parsed.header.kid) !== this.keyId ||
      normalizeSessionString(parsed.payload.iss) !== this.issuer ||
      !payloadMatchesAudience(parsed.payload, this.audience)
    ) {
      return { valid: false };
    }
    let signature: Uint8Array;
    try {
      signature = base64UrlDecode(parsed.signatureB64u);
    } catch {
      return { valid: false };
    }
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      await this.verifyingKey,
      toSessionArrayBufferCopy(signature),
      new TextEncoder().encode(`${parsed.headerB64u}.${parsed.payloadB64u}`),
    );
    return valid ? { valid: true, payload: parsed.payload } : { valid: false };
  }

  private async importSigningKey(): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
      'jwk',
      this.options.privateJwk,
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
  }

  private async importVerifyingKey(): Promise<CryptoKey> {
    const { crv, kty, x } = this.options.privateJwk;
    return await crypto.subtle.importKey(
      'jwk',
      { alg: 'EdDSA', crv, kty, use: 'sig', x },
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
  }
}

function payloadMatchesAudience(payload: Record<string, unknown>, audience: string): boolean {
  const value = payload.aud;
  if (typeof value === 'string') return value === audience;
  return Array.isArray(value) && value.includes(audience);
}

function routerWalletSessionScopeClaims(payload: Record<string, unknown>): Record<string, unknown> {
  const kind = normalizeSessionString(payload.kind);
  if (
    kind !== 'router_ab_ed25519_wallet_session_v1' &&
    kind !== 'router_ab_ecdsa_derivation_wallet_session_v1'
  ) {
    return {};
  }
  if (payload.authorizationKind === 'linked_device_wallet_session') return {};
  const scope =
    payload.runtimePolicyScope &&
    typeof payload.runtimePolicyScope === 'object' &&
    !Array.isArray(payload.runtimePolicyScope)
      ? (payload.runtimePolicyScope as Record<string, unknown>)
      : null;
  const claims = {
    org_id: requireNormalizedSessionString(scope?.orgId, 'Wallet Session org id'),
    project_id: requireNormalizedSessionString(scope?.projectId, 'Wallet Session project id'),
    environment: requireNormalizedSessionString(scope?.envId, 'Wallet Session environment'),
    account_id: requireNormalizedSessionString(
      payload.walletId ?? payload.sub,
      'Wallet Session account id',
    ),
  };
  if (payload.sid === undefined) return claims;
  return {
    ...claims,
    sid: requireNormalizedSessionString(payload.sid, 'Wallet Session Seams session id'),
  };
}

export function createEd25519SessionAdapter(options: Ed25519SessionAdapterOptions): SessionAdapter {
  const jwt = new Ed25519SessionJwtAdapter(options);
  const cookieName = normalizeSessionString(options.cookieName) || 'seams-jwt';
  const ttlSeconds = normalizeSessionTtlSeconds(options.ttlSeconds);
  const cookie = new CrossSiteSessionCookieAdapter(cookieName, ttlSeconds);
  return new SessionService({
    jwt: {
      signToken: jwt.signToken.bind(jwt),
      verifyToken: jwt.verifyToken.bind(jwt),
      refreshWindowSec: ttlSeconds,
    },
    cookie: {
      name: cookieName,
      buildSetHeader: cookie.buildSetHeader.bind(cookie),
      buildClearHeader: cookie.buildClearHeader.bind(cookie),
    },
  });
}
