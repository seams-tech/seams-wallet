import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { isPlainObject } from '@shared/utils/validation';

// A sign-in from another login provider: Google, or the app's own login through a trusted
// application issuer. Each one gives a login session for an identity (the provider, the issuer
// and the subject). It gives no method and no wallet access. An email address in the credential
// never selects an account.

/** The provider that the operator trusts for one project environment, with a revision. */
export type IdentityTrust = { readonly revision: number } & (
  | { readonly kind: 'disabled' }
  | { readonly kind: 'google'; readonly clientId: string }
  | { readonly kind: 'application'; readonly issuer: string; readonly publicKeyB64u: string }
);

export type ExternalIdentity = {
  readonly provider: 'google' | 'application';
  readonly issuer: string;
  readonly subject: string;
};

const HANDOFF_TTL_SECONDS = 120;
const CLOCK_ALLOWANCE_SECONDS = 30;
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function handoffAudience(environmentId: string): string {
  return `seams:auth:handoff:${environmentId}`;
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

type TokenParts = {
  readonly header: Record<string, unknown>;
  readonly claims: Record<string, unknown>;
  readonly signed: Uint8Array<ArrayBuffer>;
  readonly signature: Uint8Array<ArrayBuffer>;
};

function splitToken(token: string): TokenParts | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, claimsPart, signaturePart] = parts as [string, string, string];
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const header: unknown = JSON.parse(decoder.decode(base64UrlDecode(headerPart)));
    const claims: unknown = JSON.parse(decoder.decode(base64UrlDecode(claimsPart)));
    if (!isPlainObject(header) || !isPlainObject(claims)) return null;
    return {
      header,
      claims,
      signed: new TextEncoder().encode(`${headerPart}.${claimsPart}`),
      signature: base64UrlDecode(signaturePart),
    };
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.trim() === value ? value : null;
}

/** True when the times of a token are whole seconds and the token is valid now. */
function validNow(claims: Record<string, unknown>, nowMs: number, maxLifeSeconds: number): boolean {
  const { iat, exp } = claims;
  const nowSeconds = Math.floor(nowMs / 1000);
  return (
    Number.isSafeInteger(iat) &&
    Number.isSafeInteger(exp) &&
    (iat as number) <= nowSeconds + CLOCK_ALLOWANCE_SECONDS &&
    (exp as number) > nowSeconds &&
    (exp as number) > (iat as number) &&
    (exp as number) - (iat as number) <= maxLifeSeconds
  );
}

/**
 * Signs a login handoff. Only the backend of the app calls this, after its own login, with the
 * Ed25519 key that the operator trusts for its issuer. `challenge` is the sign-in challenge of
 * the Auth Worker, so a handoff signs one user in once.
 */
export async function createLoginHandoff(input: {
  readonly privateKey: CryptoKey;
  /** The canonical HTTPS origin of the app's login. */
  readonly issuer: string;
  /** The stable ID of the user at the issuer. */
  readonly subject: string;
  readonly environmentId: string;
  readonly challenge: string;
  readonly nowMs: number;
}): Promise<string> {
  if (input.privateKey.type !== 'private' || input.privateKey.algorithm.name !== 'Ed25519') {
    throw new Error('A login handoff requires an Ed25519 signing key');
  }
  const iat = Math.floor(input.nowMs / 1000);
  const signed = `${encodeJson({ alg: 'EdDSA', typ: 'JWT' })}.${encodeJson({
    iss: input.issuer,
    sub: input.subject,
    aud: handoffAudience(input.environmentId),
    nonce: input.challenge,
    iat,
    exp: iat + HANDOFF_TTL_SECONDS,
  })}`;
  const signature = await crypto.subtle.sign(
    'Ed25519',
    input.privateKey,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64UrlEncode(signature)}`;
}

/** Checks a login handoff against the trusted issuer. Null: the handoff is refused. */
export async function verifyLoginHandoff(input: {
  readonly trust: Extract<IdentityTrust, { kind: 'application' }>;
  readonly assertion: string;
  readonly environmentId: string;
  readonly challenge: string;
  readonly nowMs: number;
}): Promise<ExternalIdentity | null> {
  const token = splitToken(input.assertion);
  if (!token || token.header.alg !== 'EdDSA' || token.header.typ !== 'JWT') return null;
  if ('crit' in token.header) return null;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      base64UrlDecode(input.trust.publicKeyB64u),
      'Ed25519',
      false,
      ['verify'],
    );
    if (!(await crypto.subtle.verify('Ed25519', key, token.signature, token.signed))) return null;
  } catch {
    return null;
  }
  const { claims } = token;
  const subject = text(claims.sub);
  if (
    !subject ||
    claims.iss !== input.trust.issuer ||
    claims.aud !== handoffAudience(input.environmentId) ||
    claims.nonce !== input.challenge ||
    !validNow(claims, input.nowMs, HANDOFF_TTL_SECONDS)
  ) {
    return null;
  }
  return { provider: 'application', issuer: input.trust.issuer, subject };
}

type GoogleKey = { readonly kid: string; readonly key: CryptoKey };

let googleKeys: { readonly keys: readonly GoogleKey[]; readonly expiresAtMs: number } | null = null;

async function loadGoogleKeys(
  fetchKeys: (url: string, init: RequestInit) => Promise<Response>,
  nowMs: number,
): Promise<readonly GoogleKey[]> {
  if (googleKeys && googleKeys.expiresAtMs > nowMs) return googleKeys.keys;
  const response = await fetchKeys(GOOGLE_KEYS_URL, { method: 'GET' });
  const body: unknown = await response.json();
  if (!response.ok || !isPlainObject(body) || !Array.isArray(body.keys)) {
    throw new Error('The Google key set is not available');
  }
  const keys: GoogleKey[] = [];
  for (const jwk of body.keys) {
    if (!isPlainObject(jwk) || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
    keys.push({
      kid: jwk.kid,
      key: await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: String(jwk.n), e: String(jwk.e), alg: 'RS256' },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    });
  }
  googleKeys = { keys, expiresAtMs: nowMs + 3_600_000 };
  return keys;
}

/**
 * Checks a Google ID token for the operator's client ID. The token must carry the sign-in
 * challenge as its `nonce`. Null: the token is refused.
 */
export async function verifyGoogleIdToken(input: {
  readonly trust: Extract<IdentityTrust, { kind: 'google' }>;
  readonly idToken: string;
  readonly challenge: string;
  readonly nowMs: number;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<ExternalIdentity | null> {
  const token = splitToken(input.idToken);
  if (!token || token.header.alg !== 'RS256') return null;
  try {
    const keys = await loadGoogleKeys(input.fetch, input.nowMs);
    const key = keys.find((candidate) => candidate.kid === token.header.kid);
    if (!key) return null;
    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key.key,
      token.signature,
      token.signed,
    );
    if (!verified) return null;
  } catch {
    return null;
  }
  const { claims } = token;
  const subject = text(claims.sub);
  if (
    !subject ||
    typeof claims.iss !== 'string' ||
    !GOOGLE_ISSUERS.includes(claims.iss) ||
    claims.aud !== input.trust.clientId ||
    claims.nonce !== input.challenge ||
    !validNow(claims, input.nowMs, 24 * 3600)
  ) {
    return null;
  }
  return { provider: 'google', issuer: 'https://accounts.google.com', subject };
}
