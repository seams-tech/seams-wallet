import {
  parseAuthJwks,
  verifyLoginTokenWithJwks,
  type AuthJwks,
  type LoginTokenUser,
} from '../proofs/tokens';

export { createLoginHandoff } from '../worker/identities';
export type { LoginTokenUser } from '../proofs/tokens';

// Seams Auth for the backend of an app: the check of a login token, and the login handoff for
// an app with its own login. This path has no browser code.

const JWKS_PATH = '/.well-known/jwks.json';
const JWKS_TTL_MS = 5 * 60_000;

type CachedKeys = { readonly jwks: AuthJwks; readonly loadedAtMs: number };
const keySets = new Map<string, CachedKeys>();

async function loadKeys(issuer: string, load: typeof fetch): Promise<AuthJwks> {
  const response = await load(`${issuer}${JWKS_PATH}`);
  const jwks = response.ok ? parseAuthJwks(await response.json()) : null;
  if (!jwks) throw new Error(`The key set of ${issuer} is not available`);
  keySets.set(issuer, { jwks, loadedAtMs: Date.now() });
  return jwks;
}

export type VerifyLoginTokenOptions = {
  /** The ID of the app's project. A token of another project is refused. */
  readonly projectId: string;
  /** The URL of the Auth Worker that issued the token. Its key set is at `/.well-known/jwks.json`. */
  readonly issuer: string;
  /** Replaces the global `fetch` for the key set. */
  readonly fetch?: typeof fetch;
};

/**
 * Checks a login token from the app page. It gives the user, or null for a token that is not
 * valid: a bad signature, another project, another issuer, an expired token, or a token of
 * another kind. It throws only when the key set cannot be loaded.
 *
 * A login token says who the user is. It gives no wallet permission.
 */
export async function verifyLoginToken(
  token: string,
  options: VerifyLoginTokenOptions,
): Promise<LoginTokenUser | null> {
  const issuer = options.issuer.replace(/\/+$/, '');
  const load = options.fetch ?? fetch;
  const nowMs = Date.now();
  const cached = keySets.get(issuer);
  const check = { issuer, audience: options.projectId, nowMs };
  if (cached && nowMs - cached.loadedAtMs < JWKS_TTL_MS) {
    const verified = await verifyLoginTokenWithJwks(token, { ...check, jwks: cached.jwks });
    if (verified.ok) return userOf(verified);
  }
  // The key set is loaded again for a token that the cached keys refuse: the issuer can have a
  // new key. One load for each minute at most keeps a stream of bad tokens from the issuer.
  if (cached && nowMs - cached.loadedAtMs < 60_000) return null;
  const verified = await verifyLoginTokenWithJwks(token, {
    ...check,
    jwks: await loadKeys(issuer, load),
  });
  return verified.ok ? userOf(verified) : null;
}

function userOf(verified: { ok: true } & LoginTokenUser): LoginTokenUser {
  const { ok: _ok, ...user } = verified;
  return user;
}
