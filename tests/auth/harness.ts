import { webcrypto } from 'node:crypto';
import { webauthnChallengeB64u } from '../../packages/auth/src/proofs/audience';
import {
  generateTokenSigningJwk,
  importTokenSigner,
  type AuthJwks,
} from '../../packages/auth/src/proofs/tokens';
import {
  importCodeKey,
  type AuthAudienceConfig,
  type SignedIn,
} from '../../packages/auth/src/worker/core';
import type { IdentityTrust } from '../../packages/auth/src/worker/identities';
import type { AuthDatabase } from '../../packages/auth/src/worker/store';
import { createAuthWorkerHandler } from '../../packages/host/src/authWorker';
import {
  assertionResponse,
  createSoftwarePasskey,
  registrationResponse,
  type SoftwarePasskey,
} from '../conformance/ceremonies/passkeyCredentials';
import { openAuthD1 } from '../fixtures/signer-d1.mjs';

// An Auth Worker for the checks: the real routes, the real credential checks and a real D1
// database, with a key store, an email sender and a removal subscriber that the check controls.

export const ISSUER = 'https://auth.example.test';
export const ACCOUNT_ORIGIN = 'https://account.example.test';
export const APP_ORIGIN = 'https://shop.example.test';
export const RP_ID = 'account.example.test';
export const PUBLISHABLE_KEY = 'pk_test_auth_1';
export const ENVIRONMENT_ID = 'project-1:production';
export const PROJECT_ID = 'project-1';
const PASSKEY_SCOPE = { rpId: RP_ID, origin: ACCOUNT_ORIGIN } as const;

export const AUDIENCES: Record<string, AuthAudienceConfig> = {
  // The checkout has no key of its own for a customer, so it takes a statement for each factor.
  checkout: { statementFactors: ['webauthn', 'email_code', 'device_key'], purposes: {} },
  // The wallet server pins the key of a passkey and of a device, and it checks them itself.
  wallet: {
    statementFactors: ['email_code'],
    purposes: {
      wallet_unlock: { en: 'unlock your wallet', ja: 'ウォレットのロック解除' },
      export_key: { en: 'export a wallet key', ja: 'ウォレットの鍵のエクスポート' },
    },
  },
};

type Call = { status: number; body: Record<string, unknown> };

export type CallOptions = {
  readonly session?: string;
  readonly origin?: string | null;
  readonly appOrigin?: string | null;
  readonly key?: string | null;
  readonly environmentId?: string | null;
};

export type SubscriberAnswer = { status: number; body: unknown } | 'unreachable';

type WorkerOrigins = {
  readonly issuer: string;
  readonly accountOrigin: string;
  readonly appOrigin: string;
  readonly rpId: string;
};

export async function openAuthWorker(
  options: { removalSubscribers?: string[]; origins?: WorkerOrigins } = {},
) {
  const origins = options.origins ?? {
    issuer: ISSUER,
    accountOrigin: ACCOUNT_ORIGIN,
    appOrigin: APP_ORIGIN,
    rpId: RP_ID,
  };
  const d1 = await openAuthD1();
  const signer = await importTokenSigner(await generateTokenSigningJwk());
  const jwks: AuthJwks = { keys: [signer.publicJwk] };
  const outbox: { to: string; subject: string; text: string }[] = [];
  const notices: { url: string; notice: string }[] = [];
  const clock = { nowMs: Date.now() };
  const subscriber: { answer: SubscriberAnswer } = { answer: { status: 200, body: { ok: true } } };
  /** The login provider that the operator trusts for the environment. A check can change it. */
  const environment: { externalAuth: IdentityTrust } = {
    externalAuth: { kind: 'disabled', revision: 0 },
  };
  /** The key set that the fake Google answers with. */
  const google: { jwks: object } = { jwks: { keys: [] } };

  const handler = createAuthWorkerHandler({
    config: {
      issuer: origins.issuer,
      appName: 'Example Shop',
      passkeys: { rpId: origins.rpId, origins: [origins.accountOrigin] },
      signer,
      jwks,
      codeKey: await importCodeKey('conformance-email-code-secret-0123456789'),
      audiences: AUDIENCES,
      removalSubscribers: options.removalSubscribers ?? [],
    },
    ports: {
      database: d1.database as unknown as AuthDatabase,
      sendEmail: async (message) => {
        outbox.push(message);
      },
      fetch: async (url, init) => {
        if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
          return new Response(JSON.stringify(google.jwks));
        }
        const body: unknown = JSON.parse(String(init.body));
        notices.push({ url, notice: (body as { notice: string }).notice });
        if (subscriber.answer === 'unreachable') throw new Error('The subscriber did not answer');
        return new Response(JSON.stringify(subscriber.answer.body), {
          status: subscriber.answer.status,
        });
      },
      now: () => clock.nowMs,
    },
    publishableKeyAuth: {
      async authenticate(input) {
        if (input.secret !== PUBLISHABLE_KEY) {
          return { ok: false, status: 401, code: 'publishable_key_invalid', message: 'invalid' };
        }
        if (input.environmentId !== ENVIRONMENT_ID) {
          return {
            ok: false,
            status: 403,
            code: 'publishable_key_environment_mismatch',
            message: 'another environment',
          };
        }
        if (input.origin !== origins.accountOrigin && input.origin !== origins.appOrigin) {
          return {
            ok: false,
            status: 403,
            code: 'publishable_key_origin_blocked',
            message: 'origin not allowed',
          };
        }
        return {
          ok: true,
          principal: {
            apiKeyId: 'key-1',
            orgId: 'org-1',
            environmentId: ENVIRONMENT_ID,
            scopes: [],
          },
        };
      },
    },
    projectEnvironments: {
      listEnvironments: async () => [
        {
          id: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          key: 'production',
          signingRootVersion: 'v1',
          status: 'ACTIVE',
          externalAuth: environment.externalAuth as never,
        },
      ],
    },
  });

  async function send(method: string, path: string, body: unknown, options: CallOptions = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const origin = options.origin === undefined ? ACCOUNT_ORIGIN : options.origin;
    const appOrigin = options.appOrigin === undefined ? APP_ORIGIN : options.appOrigin;
    const key = options.key === undefined ? PUBLISHABLE_KEY : options.key;
    const environmentId =
      options.environmentId === undefined ? ENVIRONMENT_ID : options.environmentId;
    if (origin) headers.origin = origin;
    if (appOrigin) headers['x-seams-app-origin'] = appOrigin;
    if (key) headers.authorization = `Bearer ${key}`;
    if (environmentId) headers['x-seams-environment-id'] = environmentId;
    if (options.session) headers['x-seams-session'] = options.session;
    return await handler(
      new Request(`${ISSUER}${path}`, {
        method,
        headers,
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }

  async function call(path: string, body: unknown = {}, options: CallOptions = {}): Promise<Call> {
    const response = await send('POST', path, body, options);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  function requireOk<Body>(result: Call): Body {
    if (result.status !== 200) throw new Error(`Expected 200: ${JSON.stringify(result)}`);
    return result.body as Body;
  }

  /** The last code that the email sender got for an address. */
  function emailCode(to: string): string {
    const message = outbox.filter((sent) => sent.to === to.toLowerCase()).at(-1);
    const code = message?.text.match(/\b[0-9]{6}\b/)?.[0];
    if (!code) throw new Error(`No email code was sent to ${to}`);
    return code;
  }

  /** Makes an account with a new passkey, and signs it in. */
  async function signUpWithPasskey(): Promise<{ passkey: SoftwarePasskey; session: SignedIn }> {
    const passkey = createSoftwarePasskey();
    const options = requireOk<{ challengeId: string; challengeB64u: string }>(
      await call('/v1/passkeys/options'),
    );
    const session = requireOk<SignedIn>(
      await call('/v1/passkeys', {
        challengeId: options.challengeId,
        registration: registrationResponse(passkey, PASSKEY_SCOPE, options.challengeB64u),
      }),
    );
    return { passkey, session };
  }

  /** A passkey assertion for an audience and a challenge, as the account origin makes it. */
  async function passkeyProof(
    passkey: SoftwarePasskey,
    audience: string,
    challenge: string,
    overrides: Parameters<typeof assertionResponse>[3] = {},
  ) {
    return {
      factor: 'webauthn',
      assertion: assertionResponse(
        passkey,
        PASSKEY_SCOPE,
        await webauthnChallengeB64u(audience, challenge),
        overrides,
      ),
    };
  }

  async function signInWithPasskey(passkey: SoftwarePasskey): Promise<Call> {
    const start = requireOk<{ challengeId: string; challenge: string }>(
      await call('/v1/sign-in/start'),
    );
    return await call('/v1/sign-in', {
      challengeId: start.challengeId,
      proof: await passkeyProof(passkey, 'login', start.challenge),
    });
  }

  /** Signs in with an email code. A new address makes a new account. */
  async function signInWithEmail(email: string, accountId?: string): Promise<Call> {
    const sent = requireOk<{ codeId: string }>(
      await call('/v1/email-codes', { audience: 'login', email }),
    );
    return await call('/v1/sign-in', {
      proof: { factor: 'email_code', codeId: sent.codeId, code: emailCode(email) },
      ...(accountId ? { accountId } : {}),
    });
  }

  return {
    call,
    send,
    requireOk,
    emailCode,
    signUpWithPasskey,
    signInWithPasskey,
    signInWithEmail,
    passkeyProof,
    outbox,
    notices,
    handler,
    clock,
    subscriber,
    environment,
    google,
    jwks,
    database: d1.database,
    close: d1.close,
  };
}

export type AuthWorkerHarness = Awaited<ReturnType<typeof openAuthWorker>>;

/** A device key as VoiceID keeps it: an Ed25519 key pair that signs a proof message. */
export async function createDeviceKey() {
  const pair = (await webcrypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKeyB64u: Buffer.from(publicKey).toString('base64url'),
    async sign(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
      const signature = await webcrypto.subtle.sign('Ed25519', pair.privateKey, bytes);
      return Buffer.from(signature).toString('base64url');
    },
  };
}
