import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { hasExactKeys } from '@shared/utils/exactKeys';
import { isPlainObject } from '@shared/utils/validation';

// The signed tokens of the Auth Worker: ES256 JSON Web Tokens with a public key set (JWKS), so
// that a backend checks them with a standard library. Each kind of token has its own `typ`
// header, and a check accepts one kind only. So a login token is never a proof.

/** A login token says who the user is. An app backend checks it. It gives no wallet permission. */
export const LOGIN_TOKEN_TYPE = 'seams-login+jwt';
/** A proof statement says that one method proved itself to one audience for one challenge. */
export const PROOF_STATEMENT_TYPE = 'seams-proof+jwt';
/** A removal notice asks a subscriber to agree to the removal of one method. */
export const REMOVAL_NOTICE_TYPE = 'seams-method-removal+jwt';

type TokenType = typeof LOGIN_TOKEN_TYPE | typeof PROOF_STATEMENT_TYPE | typeof REMOVAL_NOTICE_TYPE;

export type AuthPublicJwk = {
  readonly kty: 'EC';
  readonly crv: 'P-256';
  readonly x: string;
  readonly y: string;
  readonly kid: string;
  readonly alg: 'ES256';
  readonly use: 'sig';
};

export type AuthJwks = { readonly keys: readonly AuthPublicJwk[] };

export type TokenSigner = {
  readonly kid: string;
  readonly publicJwk: AuthPublicJwk;
  sign(bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
};

const ES256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ES256_SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const;

function requireCoordinate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error(`The token signing key has no valid ${label}`);
  }
  return value;
}

/** The key ID of a public key: the RFC 7638 thumbprint, so each party derives the same ID. */
async function jwkThumbprint(x: string, y: string): Promise<string> {
  const canonical = `{"crv":"P-256","kty":"EC","x":"${x}","y":"${y}"}`;
  return base64UrlEncode(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)),
  );
}

/** Makes a signer from the private key (a P-256 JWK) that the operator keeps as a secret. */
export async function importTokenSigner(privateJwk: unknown): Promise<TokenSigner> {
  if (!isPlainObject(privateJwk) || privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256') {
    throw new Error('The token signing key must be a P-256 private JWK');
  }
  const x = requireCoordinate(privateJwk.x, 'x');
  const y = requireCoordinate(privateJwk.y, 'y');
  const d = requireCoordinate(privateJwk.d, 'd');
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d },
    ES256,
    false,
    ['sign'],
  );
  const kid = await jwkThumbprint(x, y);
  return {
    kid,
    publicJwk: { kty: 'EC', crv: 'P-256', x, y, kid, alg: 'ES256', use: 'sig' },
    sign: (bytes) => crypto.subtle.sign(ES256_SIGNATURE, privateKey, bytes),
  };
}

/** A new signing key as a private JWK. An operator stores it as the secret of the Auth Worker. */
export async function generateTokenSigningJwk(): Promise<JsonWebKey> {
  const pair = await crypto.subtle.generateKey(ES256, true, ['sign', 'verify']);
  return await crypto.subtle.exportKey('jwk', pair.privateKey);
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

async function signToken(
  signer: TokenSigner,
  typ: TokenType,
  claims: Record<string, unknown>,
): Promise<string> {
  const signingInput = `${encodeJson({ alg: 'ES256', typ, kid: signer.kid })}.${encodeJson(claims)}`;
  const signature = await signer.sign(new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseAuthJwks(value: unknown): AuthJwks | null {
  if (!isPlainObject(value) || !Array.isArray(value.keys)) return null;
  const keys: AuthPublicJwk[] = [];
  for (const key of value.keys) {
    if (
      !hasExactKeys(key, ['kty', 'crv', 'x', 'y', 'kid', 'alg', 'use']) ||
      key.kty !== 'EC' ||
      key.crv !== 'P-256' ||
      key.alg !== 'ES256' ||
      key.use !== 'sig' ||
      typeof key.x !== 'string' ||
      typeof key.y !== 'string' ||
      typeof key.kid !== 'string'
    ) {
      return null;
    }
    keys.push({
      kty: 'EC',
      crv: 'P-256',
      x: key.x,
      y: key.y,
      kid: key.kid,
      alg: 'ES256',
      use: 'sig',
    });
  }
  return { keys };
}

type TokenCheck = {
  readonly jwks: AuthJwks;
  readonly issuer: string;
  readonly audience: string;
  readonly nowMs: number;
};

/** A refusal says only that the token is not valid. The reason is for a log, not for a user. */
type TokenRefusal = { readonly ok: false; readonly reason: string };

function refused(reason: string): TokenRefusal {
  return { ok: false, reason };
}

/** A small allowance for a clock that differs between two servers. */
const CLOCK_ALLOWANCE_SECONDS = 30;

async function verifyToken(
  token: unknown,
  typ: TokenType,
  check: TokenCheck,
): Promise<{ readonly ok: true; readonly claims: Record<string, unknown> } | TokenRefusal> {
  if (typeof token !== 'string') return refused('The token is not text');
  const parts = token.split('.');
  if (parts.length !== 3) return refused('The token does not have three parts');
  const [headerPart, claimsPart, signaturePart] = parts as [string, string, string];
  const header = decodeJson(headerPart);
  const claims = decodeJson(claimsPart);
  if (!header || !claims) return refused('The token is not valid JSON');
  if (header.alg !== 'ES256' || header.typ !== typ) return refused('The token is of another kind');
  const jwk = check.jwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) return refused('The token names an unknown key');
  let verified: boolean;
  try {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      ES256,
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify(
      ES256_SIGNATURE,
      publicKey,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${claimsPart}`),
    );
  } catch {
    verified = false;
  }
  if (!verified) return refused('The token signature is not valid');
  const nowSeconds = Math.floor(check.nowMs / 1000);
  if (claims.iss !== check.issuer) return refused('The token has another issuer');
  if (claims.aud !== check.audience) return refused('The token has another audience');
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
    return refused('The token has expired');
  }
  if (typeof claims.iat !== 'number' || claims.iat > nowSeconds + CLOCK_ALLOWANCE_SECONDS) {
    return refused('The token is from the future');
  }
  return { ok: true, claims };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The sign-in methods. The names are the stored `kind` values of a method record. */
export const AUTH_METHOD_KINDS = ['passkey', 'email_otp', 'voiceid'] as const;
export type AuthMethodKind = (typeof AUTH_METHOD_KINDS)[number];

export function parseAuthMethodKind(value: unknown): AuthMethodKind | null {
  return AUTH_METHOD_KINDS.find((kind) => kind === value) ?? null;
}

type IssuedAt = { readonly issuer: string; readonly nowMs: number; readonly ttlMs: number };

function timeClaims(input: IssuedAt): { iss: string; iat: number; exp: number } {
  const iat = Math.floor(input.nowMs / 1000);
  return { iss: input.issuer, iat, exp: iat + Math.ceil(input.ttlMs / 1000) };
}

export type LoginTokenUser = {
  readonly accountId: string;
  readonly projectId: string;
  readonly envId: string;
  readonly sessionId: string;
  /** The method of the sign-in. Null for a sign-in from another login provider. */
  readonly method: AuthMethodKind | null;
  /** The email address, when the user signed in with one. */
  readonly email: string | null;
  readonly expiresAtMs: number;
};

export async function issueLoginToken(
  signer: TokenSigner,
  input: IssuedAt & Omit<LoginTokenUser, 'expiresAtMs'>,
): Promise<{ readonly token: string; readonly expiresAtMs: number }> {
  const time = timeClaims(input);
  const token = await signToken(signer, LOGIN_TOKEN_TYPE, {
    ...time,
    sub: input.accountId,
    aud: input.projectId,
    env: input.envId,
    sid: input.sessionId,
    ...(input.method ? { amr: [input.method] } : {}),
    ...(input.email ? { email: input.email } : {}),
  });
  return { token, expiresAtMs: time.exp * 1000 };
}

/**
 * Checks a login token against the key set of its issuer. `audience` is the project ID. A proof
 * statement or a token of another project is refused.
 */
export async function verifyLoginTokenWithJwks(
  token: unknown,
  check: TokenCheck,
): Promise<({ readonly ok: true } & LoginTokenUser) | TokenRefusal> {
  const verified = await verifyToken(token, LOGIN_TOKEN_TYPE, check);
  if (!verified.ok) return verified;
  const { claims } = verified;
  const accountId = text(claims.sub);
  const envId = text(claims.env);
  const sessionId = text(claims.sid);
  if (!accountId || !envId || !sessionId) return refused('The login token has no subject');
  const amr = Array.isArray(claims.amr) ? claims.amr[0] : undefined;
  return {
    ok: true,
    accountId,
    projectId: check.audience,
    envId,
    sessionId,
    method: parseAuthMethodKind(amr),
    email: text(claims.email),
    expiresAtMs: Number(claims.exp) * 1000,
  };
}

/** The factors that a server can check. A method has one factor. */
export const AUTH_FACTORS = ['webauthn', 'email_code', 'device_key'] as const;
export type AuthFactor = (typeof AUTH_FACTORS)[number];

export type ProofStatement = {
  readonly accountId: string;
  readonly methodId: string;
  readonly method: AuthMethodKind;
  readonly factor: AuthFactor;
  readonly audience: string;
  readonly challenge: string;
  /** The purpose that the user saw, from the operator's list for the audience. */
  readonly purpose: string | null;
  /** For an email code: the SHA-256 digest (hex) of the address that received the code. */
  readonly emailHashHex: string | null;
  readonly expiresAtMs: number;
};

function statementAudience(audience: string): string {
  return `seams:proof:${audience}`;
}

export async function issueProofStatement(
  signer: TokenSigner,
  input: IssuedAt & Omit<ProofStatement, 'expiresAtMs'>,
): Promise<string> {
  return await signToken(signer, PROOF_STATEMENT_TYPE, {
    ...timeClaims(input),
    sub: input.accountId,
    aud: statementAudience(input.audience),
    challenge: input.challenge,
    method_id: input.methodId,
    method: input.method,
    factor: input.factor,
    ...(input.purpose ? { purpose: input.purpose } : {}),
    ...(input.emailHashHex ? { email_hash: input.emailHashHex } : {}),
  });
}

/**
 * Checks a proof statement for one audience and one challenge. The server of the audience
 * issued the challenge, and it must use each challenge once.
 */
export async function verifyProofStatement(
  statement: unknown,
  check: Omit<TokenCheck, 'audience'> & { readonly audience: string; readonly challenge: string },
): Promise<({ readonly ok: true } & ProofStatement) | TokenRefusal> {
  const verified = await verifyToken(statement, PROOF_STATEMENT_TYPE, {
    ...check,
    audience: statementAudience(check.audience),
  });
  if (!verified.ok) return verified;
  const { claims } = verified;
  if (claims.challenge !== check.challenge) return refused('The statement has another challenge');
  const accountId = text(claims.sub);
  const methodId = text(claims.method_id);
  const method = parseAuthMethodKind(claims.method);
  const factor = AUTH_FACTORS.find((name) => name === claims.factor);
  if (!accountId || !methodId || !method || !factor) {
    return refused('The statement names no method');
  }
  return {
    ok: true,
    accountId,
    methodId,
    method,
    factor,
    audience: check.audience,
    challenge: check.challenge,
    purpose: text(claims.purpose),
    emailHashHex: text(claims.email_hash),
    expiresAtMs: Number(claims.exp) * 1000,
  };
}

export type RemovalNotice = {
  readonly accountId: string;
  readonly methodId: string;
  readonly method: AuthMethodKind;
  /** One ID for each removal, so that a subscriber answers a repeated notice the same way. */
  readonly removalId: string;
};

export async function issueRemovalNotice(
  signer: TokenSigner,
  input: IssuedAt & RemovalNotice & { readonly subscriberUrl: string },
): Promise<string> {
  return await signToken(signer, REMOVAL_NOTICE_TYPE, {
    ...timeClaims(input),
    sub: input.accountId,
    aud: input.subscriberUrl,
    method_id: input.methodId,
    method: input.method,
    jti: input.removalId,
  });
}

/** A removal subscriber checks the notice with this function. `audience` is its own URL. */
export async function verifyRemovalNotice(
  notice: unknown,
  check: TokenCheck,
): Promise<({ readonly ok: true } & RemovalNotice) | TokenRefusal> {
  const verified = await verifyToken(notice, REMOVAL_NOTICE_TYPE, check);
  if (!verified.ok) return verified;
  const { claims } = verified;
  const accountId = text(claims.sub);
  const methodId = text(claims.method_id);
  const method = parseAuthMethodKind(claims.method);
  const removalId = text(claims.jti);
  if (!accountId || !methodId || !method || !removalId) {
    return refused('The removal notice names no method');
  }
  return { ok: true, accountId, methodId, method, removalId };
}
