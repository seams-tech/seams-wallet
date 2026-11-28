import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { verifyLoginTokenWithJwks } from '../../packages/auth/src/proofs/tokens';
import type { SignedIn } from '../../packages/auth/src/worker/core';
import { createLoginHandoff } from '../../packages/auth/src/worker/identities';
import {
  ENVIRONMENT_ID,
  ISSUER,
  PROJECT_ID,
  openAuthWorker,
  type AuthWorkerHarness,
} from './harness';

// A sign-in from another login provider: the app's own login through a trusted application
// issuer, and Google. Each one gives a login session for an identity. It gives no method.

const APP_ISSUER = 'https://login.shop.example.test';
let worker: AuthWorkerHarness;
let issuerKey: CryptoKeyPair;

test.beforeAll(async () => {
  worker = await openAuthWorker();
  issuerKey = (await webcrypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
});

test.afterAll(async () => {
  await worker.close();
});

async function trustApplication(revision: number, key = issuerKey) {
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', key.publicKey));
  worker.environment.externalAuth = {
    kind: 'application',
    issuer: APP_ISSUER,
    publicKeyB64u: Buffer.from(publicKey).toString('base64url'),
    revision,
  };
}

async function start() {
  return worker.requireOk<{ challengeId: string; challenge: string }>(
    await worker.call('/v1/sign-in/start'),
  );
}

async function handoff(
  subject: string,
  overrides: Partial<Parameters<typeof createLoginHandoff>[0]> & { challengeId?: string } = {},
) {
  const challenge = await start();
  const credential = await createLoginHandoff({
    privateKey: issuerKey.privateKey,
    issuer: APP_ISSUER,
    subject,
    environmentId: ENVIRONMENT_ID,
    challenge: challenge.challenge,
    nowMs: worker.clock.nowMs,
    ...overrides,
  });
  return {
    credential,
    challenge,
    result: await worker.call('/v1/sign-in', {
      challengeId: overrides.challengeId ?? challenge.challengeId,
      proof: { factor: 'identity', provider: 'application', credential },
    }),
  };
}

test('a handoff from the trusted issuer gives a login session with no method', async () => {
  await trustApplication(1);
  const first = worker.requireOk<SignedIn>((await handoff('user-1')).result);
  expect(first.methods).toEqual([]);
  expect(
    await verifyLoginTokenWithJwks(first.loginToken, {
      jwks: worker.jwks,
      issuer: ISSUER,
      audience: PROJECT_ID,
      nowMs: worker.clock.nowMs,
    }),
  ).toMatchObject({ ok: true, accountId: first.accountId, method: null, email: null });
  // The same subject signs in to the same account, and another subject to another account.
  const again = worker.requireOk<SignedIn>((await handoff('user-1')).result);
  expect(again.accountId).toBe(first.accountId);
  const other = worker.requireOk<SignedIn>((await handoff('user-2')).result);
  expect(other.accountId).not.toBe(first.accountId);
});

test('a handoff is refused with a bad signature, another issuer, environment or challenge, and when it is used again', async () => {
  await trustApplication(1);
  const otherKey = (await webcrypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const refused = [
    await handoff('user-1', { privateKey: otherKey.privateKey }),
    await handoff('user-1', { issuer: 'https://login.other.example.test' }),
    await handoff('user-1', { environmentId: 'project-1:staging' }),
    await handoff('user-1', { challenge: 'another-challenge-0123456789' }),
    await handoff('user-1', { nowMs: worker.clock.nowMs - 10 * 60_000 }),
  ];
  for (const attempt of refused) {
    expect(attempt.result).toMatchObject({ status: 401, body: { code: 'invalid_proof' } });
  }
  // A valid handoff signs in once: its challenge is used.
  const valid = await handoff('user-1');
  expect(valid.result.status).toBe(200);
  expect(
    await worker.call('/v1/sign-in', {
      challengeId: valid.challenge.challengeId,
      proof: { factor: 'identity', provider: 'application', credential: valid.credential },
    }),
  ).toMatchObject({ status: 401, body: { code: 'challenge_expired_or_invalid' } });
});

test('a change of the issuer trust ends the login sessions of that issuer', async () => {
  await trustApplication(1);
  const session = worker.requireOk<SignedIn>((await handoff('user-3')).result);
  expect(await worker.call('/v1/account', {}, { session: session.sessionToken })).toMatchObject({
    status: 200,
  });
  await trustApplication(2);
  expect(await worker.call('/v1/account', {}, { session: session.sessionToken })).toMatchObject({
    status: 401,
    body: { code: 'unauthorized' },
  });
  // A session from a passkey does not depend on the issuer trust.
  const { session: passkeySession } = await worker.signUpWithPasskey();
  worker.environment.externalAuth = { kind: 'disabled', revision: 3 };
  expect(
    await worker.call('/v1/account', {}, { session: passkeySession.sessionToken }),
  ).toMatchObject({ status: 200 });
  expect((await handoff('user-3')).result).toMatchObject({
    status: 503,
    body: { code: 'not_configured' },
  });
});

test('a session from a handoff gives no proof for the wallet', async () => {
  await trustApplication(4);
  const session = worker.requireOk<SignedIn>((await handoff('user-4')).result);
  // The account has no method, so no email code and no statement exist for it.
  expect(
    await worker.call(
      '/v1/email-codes',
      { audience: 'wallet', challenge: 'wallet-challenge-0123456789', methodId: 'email_none' },
      { session: session.sessionToken },
    ),
  ).toMatchObject({ status: 404 });
  // The user adds a method before the first wallet: a passkey for the same account.
  const options = worker.requireOk<{ user: { idB64u: string } }>(
    await worker.call('/v1/passkeys/options', {}, { session: session.sessionToken }),
  );
  expect(Buffer.from(options.user.idB64u, 'base64url').toString()).toBe(session.accountId);
});

function googleIdToken(
  key: ReturnType<typeof generateKeyPairSync>,
  claims: Record<string, unknown>,
): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signed = `${encode({ alg: 'RS256', kid: 'google-key-1', typ: 'JWT' })}.${encode(claims)}`;
  const signature = sign('RSA-SHA256', Buffer.from(signed), key.privateKey);
  return `${signed}.${signature.toString('base64url')}`;
}

test('a Google ID token for the operator client signs in, and each other token is refused', async () => {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  worker.google.jwks = {
    keys: [{ ...key.publicKey.export({ format: 'jwk' }), kid: 'google-key-1', alg: 'RS256' }],
  };
  worker.environment.externalAuth = { kind: 'google', clientId: 'client-1', revision: 5 };
  const nowSeconds = Math.floor(worker.clock.nowMs / 1000);
  async function attempt(claims: Record<string, unknown>, signingKey = key) {
    const challenge = await start();
    return await worker.call('/v1/sign-in', {
      challengeId: challenge.challengeId,
      proof: {
        factor: 'identity',
        provider: 'google',
        credential: googleIdToken(signingKey, {
          iss: 'https://accounts.google.com',
          aud: 'client-1',
          sub: 'google-subject-1',
          email: 'owner@example.test',
          nonce: challenge.challenge,
          iat: nowSeconds,
          exp: nowSeconds + 3600,
          ...claims,
        }),
      },
    });
  }
  const first = worker.requireOk<SignedIn>(await attempt({}));
  expect(worker.requireOk<SignedIn>(await attempt({})).accountId).toBe(first.accountId);
  // An email address in the token never selects an account.
  const emailAccount = worker.requireOk<SignedIn>(
    await worker.signInWithEmail('owner@example.test'),
  );
  expect(emailAccount.accountId).not.toBe(first.accountId);
  for (const refused of [
    await attempt({ aud: 'client-2' }),
    await attempt({ iss: 'https://accounts.example.test' }),
    await attempt({ nonce: 'another-challenge-0123456789' }),
    await attempt({ exp: nowSeconds - 1 }),
    await attempt({}, otherKey),
  ]) {
    expect(refused).toMatchObject({ status: 401, body: { code: 'invalid_proof' } });
  }
});
