import { expect, test } from '@playwright/test';
import {
  generateTokenSigningJwk,
  parseAuthJwks,
  verifyLoginTokenWithJwks,
} from '../../packages/auth/src/proofs/tokens';
import type { AuthDatabase } from '../../packages/auth/src/worker/store';
import {
  DEV_OUTBOX_PATH,
  createAuthWorker,
  type AuthWorkerEnv,
} from '../../packages/host/src/authWorkerEnv';
import { openAuthD1 } from '../fixtures/signer-d1.mjs';

// The Auth Worker as a deployment makes it: from its variables, with the static key store of a
// deployment that has one environment and the email outbox of a local run.

const ISSUER = 'http://localhost:4400';
const ACCOUNT_ORIGIN = 'http://localhost:4401';
const APP_ORIGIN = 'http://localhost:4402';
const DEPLOYMENT = {
  credential: {
    apiKeyId: 'key-local',
    publishableKey: 'pk_local_1',
    allowedOrigins: [ACCOUNT_ORIGIN, APP_ORIGIN],
    scopes: ['accounts.create'],
  },
  deployment: {
    orgId: 'org-local',
    projectId: 'project-local',
    environmentId: 'project-local:dev',
    environmentKey: 'dev',
    signingRootVersion: 'v1',
  },
  tenantRoot: {
    identityDigestB64u: 'identity-digest',
    custodyLineageB64u: 'custody-lineage',
    signingRootId: 'project-local:dev',
  },
};

async function localEnv(database: AuthDatabase): Promise<AuthWorkerEnv> {
  return {
    AUTH_DB: database,
    WALLET_LOCAL_DEPLOYMENT_JSON: JSON.stringify(DEPLOYMENT),
    AUTH_ISSUER: ISSUER,
    AUTH_APP_NAME: 'Seams local',
    AUTH_RP_ID: 'localhost',
    AUTH_ACCOUNT_ORIGINS: `${ACCOUNT_ORIGIN}, http://localhost:4403`,
    AUTH_TOKEN_SIGNING_JWK: JSON.stringify(await generateTokenSigningJwk()),
    AUTH_EMAIL_CODE_SECRET: 'local-email-code-secret-0123456789abcdef',
    AUTH_EMAIL_DELIVERY_MODE: 'dev_outbox',
  };
}

test('a local Auth Worker signs in with an email code from its outbox', async () => {
  const d1 = await openAuthD1();
  try {
    const worker = await createAuthWorker(await localEnv(d1.database as unknown as AuthDatabase));
    async function post(path: string, body: object) {
      const response = await worker(
        new Request(`${ISSUER}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: ACCOUNT_ORIGIN,
            authorization: 'Bearer pk_local_1',
            'x-seams-environment-id': 'project-local:dev',
            'x-seams-app-origin': APP_ORIGIN,
          },
          body: JSON.stringify(body),
        }),
      );
      return { status: response.status, body: (await response.json()) as Record<string, string> };
    }
    const sent = await post('/v1/email-codes', { audience: 'login', email: 'Owner@Example.test' });
    expect(sent.status).toBe(200);
    const mail = await post(DEV_OUTBOX_PATH, { email: 'owner@example.test' });
    const code = mail.body.text?.match(/\b[0-9]{6}\b/)?.[0];
    const signedIn = await post('/v1/sign-in', {
      proof: { factor: 'email_code', codeId: sent.body.codeId, code },
    });
    expect(signedIn.status).toBe(200);

    const jwks = parseAuthJwks(
      await (await worker(new Request(`${ISSUER}/.well-known/jwks.json`))).json(),
    );
    if (!jwks) throw new Error('The Worker gave no key set');
    expect(
      await verifyLoginTokenWithJwks(signedIn.body.loginToken, {
        jwks,
        issuer: ISSUER,
        audience: 'project-local',
        nowMs: Date.now(),
      }),
    ).toMatchObject({ ok: true, envId: 'dev', method: 'email_otp', email: 'owner@example.test' });
  } finally {
    await d1.close();
  }
});

test('an Auth Worker with no email sender or no signing key does not start', async () => {
  const d1 = await openAuthD1();
  try {
    const env = await localEnv(d1.database as unknown as AuthDatabase);
    await expect(createAuthWorker({ ...env, AUTH_EMAIL_DELIVERY_MODE: undefined })).rejects.toThrow(
      'The Auth Worker has no email sender',
    );
    await expect(createAuthWorker({ ...env, AUTH_TOKEN_SIGNING_JWK: '' })).rejects.toThrow(
      'AUTH_TOKEN_SIGNING_JWK is required',
    );
    await expect(createAuthWorker({ ...env, AUTH_EMAIL_CODE_SECRET: 'too-short' })).rejects.toThrow(
      '32 characters',
    );
    // An operator's own sender replaces the outbox, and then the outbox route does not exist.
    const worker = await createAuthWorker(
      { ...env, AUTH_EMAIL_DELIVERY_MODE: undefined },
      { sendEmail: async () => {} },
    );
    const response = await worker(
      new Request(`${ISSUER}${DEV_OUTBOX_PATH}`, { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(404);
  } finally {
    await d1.close();
  }
});
