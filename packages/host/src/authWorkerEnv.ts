import { isPlainObject } from '@shared/utils/validation';
import { importTokenSigner, parseAuthJwks } from '../../auth/src/proofs/tokens';
import {
  importCodeKey,
  type AuthAudienceConfig,
  type AuthServicePorts,
} from '../../auth/src/worker/core';
import type { AuthDatabase } from '../../auth/src/worker/store';
import { createAuthWorkerHandler } from './authWorker';
import {
  createStaticWalletConsoleBindingV1,
  parseStaticWalletConsoleBindingConfigV1,
} from './credentials/staticWalletConsoleBinding';
import {
  createWalletConsoleOpsClient,
  type WalletConsoleServiceBinding,
} from './credentials/walletConsoleOpsClient';

// The Auth Worker from its bindings and variables. An operator deploys it beside the Wallet
// Gateway, with its own D1 database. The key store is the Wallet Console service binding, or a
// static configuration for a deployment with one environment.

export interface AuthWorkerEnv {
  readonly AUTH_DB: AuthDatabase;
  readonly WALLET_CONSOLE?: WalletConsoleServiceBinding;
  /** The static deployment configuration of the Wallet Gateway, when no Console is bound. */
  readonly WALLET_LOCAL_DEPLOYMENT_JSON?: string;
  /** The public URL of this Worker: the `iss` of each token and the base of the JWKS path. */
  readonly AUTH_ISSUER: string;
  readonly AUTH_APP_NAME: string;
  readonly AUTH_RP_ID: string;
  /** The account origin and its related origins, separated by commas. */
  readonly AUTH_ACCOUNT_ORIGINS: string;
  /** Secret: a P-256 private JWK. `generateTokenSigningJwk` makes one. */
  readonly AUTH_TOKEN_SIGNING_JWK: string;
  /** A JWKS of older public keys, so that a token from before a key change still verifies. */
  readonly AUTH_TOKEN_OLDER_JWKS?: string;
  /** Secret: 32 characters or more. */
  readonly AUTH_EMAIL_CODE_SECRET: string;
  /** The audiences other than `login`, as JSON: `{ "<name>": { statementFactors, purposes } }`. */
  readonly AUTH_AUDIENCES_JSON?: string;
  /** The URLs that must agree before a method is removed, separated by commas. */
  readonly AUTH_REMOVAL_SUBSCRIBERS?: string;
  /** `dev_outbox` keeps each email in the database for a local run. It sends no email. */
  readonly AUTH_EMAIL_DELIVERY_MODE?: string;
}

/** The parts that an operator's own Worker can replace: the email sender and the outbound fetch. */
export type AuthWorkerOverrides = Partial<Pick<AuthServicePorts, 'sendEmail' | 'fetch'>>;

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function requireVariable(env: AuthWorkerEnv, name: keyof AuthWorkerEnv): string {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function parseAudiences(json: string | undefined): Record<string, AuthAudienceConfig> {
  if (!json) return {};
  const parsed: unknown = JSON.parse(json);
  if (!isPlainObject(parsed)) throw new Error('AUTH_AUDIENCES_JSON must be an object');
  const audiences: Record<string, AuthAudienceConfig> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!isPlainObject(value) || !Array.isArray(value.statementFactors)) {
      throw new Error(`AUTH_AUDIENCES_JSON.${name} needs statementFactors`);
    }
    audiences[name] = {
      statementFactors: value.statementFactors as AuthAudienceConfig['statementFactors'],
      purposes: (isPlainObject(value.purposes)
        ? value.purposes
        : {}) as AuthAudienceConfig['purposes'],
    };
  }
  return audiences;
}

const DEV_OUTBOX_MODE = 'dev_outbox';
export const DEV_OUTBOX_PATH = '/dev/email-outbox';

function devOutbox(database: AuthDatabase) {
  return {
    async sendEmail(message: { to: string; subject: string; text: string }): Promise<void> {
      await database
        .prepare(
          `INSERT INTO auth_dev_email_outbox (email, subject, body, created_at_ms)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(message.to, message.subject, message.text, Date.now())
        .run();
    },
    /** The last email to an address. Only a local run has this route. */
    async read(request: Request): Promise<Response> {
      const body: unknown = await request.json().catch(() => null);
      const email = isPlainObject(body) && typeof body.email === 'string' ? body.email : '';
      const row = await database
        .prepare(
          `SELECT subject, body FROM auth_dev_email_outbox WHERE email = ?
           ORDER BY created_at_ms DESC, rowid DESC LIMIT 1`,
        )
        .bind(email.trim().toLowerCase())
        .first<{ subject: string; body: string }>();
      return Response.json(
        row ? { ok: true, subject: row.subject, text: row.body } : { ok: false, code: 'not_found' },
        { status: row ? 200 : 404 },
      );
    },
  };
}

export async function createAuthWorker(
  env: AuthWorkerEnv,
  overrides: AuthWorkerOverrides = {},
): Promise<(request: Request) => Promise<Response>> {
  const console =
    env.WALLET_CONSOLE ??
    createStaticWalletConsoleBindingV1(
      parseStaticWalletConsoleBindingConfigV1(
        JSON.parse(requireVariable(env, 'WALLET_LOCAL_DEPLOYMENT_JSON')),
      ),
    );
  const keyStore = createWalletConsoleOpsClient(console);
  const signer = await importTokenSigner(
    JSON.parse(requireVariable(env, 'AUTH_TOKEN_SIGNING_JWK')),
  );
  const older = env.AUTH_TOKEN_OLDER_JWKS
    ? parseAuthJwks(JSON.parse(env.AUTH_TOKEN_OLDER_JWKS))
    : { keys: [] };
  if (!older) throw new Error('AUTH_TOKEN_OLDER_JWKS is not a valid key set');
  const outbox = env.AUTH_EMAIL_DELIVERY_MODE === DEV_OUTBOX_MODE ? devOutbox(env.AUTH_DB) : null;
  const sendEmail = overrides.sendEmail ?? outbox?.sendEmail;
  if (!sendEmail) throw new Error('The Auth Worker has no email sender');
  const handler = createAuthWorkerHandler({
    config: {
      issuer: requireVariable(env, 'AUTH_ISSUER'),
      appName: requireVariable(env, 'AUTH_APP_NAME'),
      passkeys: {
        rpId: requireVariable(env, 'AUTH_RP_ID'),
        origins: list(requireVariable(env, 'AUTH_ACCOUNT_ORIGINS')),
      },
      signer,
      jwks: { keys: [signer.publicJwk, ...older.keys] },
      codeKey: await importCodeKey(requireVariable(env, 'AUTH_EMAIL_CODE_SECRET')),
      audiences: parseAudiences(env.AUTH_AUDIENCES_JSON),
      removalSubscribers: list(env.AUTH_REMOVAL_SUBSCRIBERS),
    },
    ports: {
      database: env.AUTH_DB,
      sendEmail,
      fetch: overrides.fetch ?? ((url, init) => fetch(url, init)),
      now: Date.now,
    },
    publishableKeyAuth: keyStore.publishableKeyAuth,
    projectEnvironments: keyStore.projectEnvironments,
  });
  if (!outbox) return handler;
  return async function handleWithDevOutbox(request: Request): Promise<Response> {
    const isOutboxRead =
      request.method === 'POST' && new URL(request.url).pathname === DEV_OUTBOX_PATH;
    return isOutboxRead ? await outbox.read(request) : await handler(request);
  };
}
