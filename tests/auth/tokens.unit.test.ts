import { expect, test } from '@playwright/test';
import {
  generateTokenSigningJwk,
  importTokenSigner,
  issueLoginToken,
  parseAuthJwks,
  verifyLoginTokenWithJwks,
} from '../../packages/auth/src/proofs/tokens';

// The login token as an app backend checks it: an ES256 JWT with the key set of its issuer.

const ISSUER = 'https://auth.example.test';
const NOW_MS = 1_800_000_000_000;

async function issued() {
  const signer = await importTokenSigner(await generateTokenSigningJwk());
  const { token } = await issueLoginToken(signer, {
    issuer: ISSUER,
    nowMs: NOW_MS,
    ttlMs: 600_000,
    accountId: 'acct_1',
    projectId: 'project-1',
    envId: 'production',
    sessionId: 'sess_1',
    method: 'passkey',
    email: null,
  });
  const check = {
    jwks: { keys: [signer.publicJwk] },
    issuer: ISSUER,
    audience: 'project-1',
    nowMs: NOW_MS,
  };
  return { signer, token, check };
}

function replacePart(token: string, index: number, value: object): string {
  const parts = token.split('.');
  parts[index] = Buffer.from(JSON.stringify(value)).toString('base64url');
  return parts.join('.');
}

test('a login token verifies with the key set of its issuer and gives the user', async () => {
  const { token, check } = await issued();
  expect(await verifyLoginTokenWithJwks(token, check)).toEqual({
    ok: true,
    accountId: 'acct_1',
    projectId: 'project-1',
    envId: 'production',
    sessionId: 'sess_1',
    method: 'passkey',
    email: null,
    expiresAtMs: NOW_MS + 600_000,
  });
});

test('the header of a login token is that of a standard ES256 JWT', async () => {
  const { signer, token } = await issued();
  const [header = ''] = token.split('.');
  expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
    alg: 'ES256',
    typ: 'seams-login+jwt',
    kid: signer.kid,
  });
  // The key ID is the RFC 7638 thumbprint of the public key.
  expect(signer.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(parseAuthJwks({ keys: [signer.publicJwk] })).toEqual({ keys: [signer.publicJwk] });
  expect(parseAuthJwks({ keys: [{ ...signer.publicJwk, d: 'private' }] })).toBeNull();
});

test('a login token is refused for a changed claim, another key, another issuer and after its end', async () => {
  const { token, check } = await issued();
  const other = await issued();
  const [, claimsPart = ''] = token.split('.');
  const claims = JSON.parse(Buffer.from(claimsPart, 'base64url').toString());
  const refused = [
    await verifyLoginTokenWithJwks(replacePart(token, 1, { ...claims, sub: 'acct_2' }), check),
    await verifyLoginTokenWithJwks(token, { ...check, jwks: other.check.jwks }),
    await verifyLoginTokenWithJwks(other.token, check),
    await verifyLoginTokenWithJwks(token, { ...check, issuer: 'https://auth.other.test' }),
    await verifyLoginTokenWithJwks(token, { ...check, nowMs: NOW_MS + 600_000 }),
    await verifyLoginTokenWithJwks(token, { ...check, nowMs: NOW_MS - 60_000 }),
    await verifyLoginTokenWithJwks(`${token}.extra`, check),
    await verifyLoginTokenWithJwks(null, check),
  ];
  expect(refused.map((result) => result.ok)).toEqual(refused.map(() => false));
  // A token with no signature algorithm is refused, whatever its signature part holds.
  const [headerPart = ''] = token.split('.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString());
  expect(
    await verifyLoginTokenWithJwks(replacePart(token, 0, { ...header, alg: 'none' }), check),
  ).toMatchObject({ ok: false });
});
