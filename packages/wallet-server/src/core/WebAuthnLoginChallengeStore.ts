import { isObject, toOptionalTrimmedString } from '@shared/utils/validation';
import {
  D1WebAuthnChallengeStore,
  WEBAUTHN_CHALLENGE_STORE_D1_SCHEMA_SQL,
  createWebAuthnChallengeStore,
  ensureWebAuthnChallengeStoreD1Schema,
  type D1WebAuthnChallengeStoreOptions,
  type WebAuthnChallengeStore,
  type WebAuthnChallengeStoreSpec,
  type WebAuthnStoreInput,
} from './webAuthnStoreBackends';
import type { D1SchemaOptions } from './d1TenantStore';

export type WebAuthnLoginChallengeRecord = {
  version: 'webauthn_login_challenge_v1';
  challengeId: string;
  userId: string;
  rpId: string;
  challengeB64u: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export interface WebAuthnLoginChallengeStore extends WebAuthnChallengeStore<WebAuthnLoginChallengeRecord> {}

export interface D1WebAuthnLoginChallengeStoreSchemaOptions extends D1SchemaOptions {}

export interface D1WebAuthnLoginChallengeStoreOptions extends D1WebAuthnChallengeStoreOptions {}

// Login and sync challenges share one D1 table.
export const WEBAUTHN_LOGIN_CHALLENGE_STORE_D1_SCHEMA_SQL = WEBAUTHN_CHALLENGE_STORE_D1_SCHEMA_SQL;

export const ensureWebAuthnLoginChallengeStoreD1Schema = ensureWebAuthnChallengeStoreD1Schema;

function parseWebAuthnLoginChallengeRecord(raw: unknown): WebAuthnLoginChallengeRecord | null {
  if (!isObject(raw)) return null;
  const version = toOptionalTrimmedString(raw.version);
  const challengeId = toOptionalTrimmedString(raw.challengeId);
  const userId = toOptionalTrimmedString(raw.userId);
  const rpId = toOptionalTrimmedString(raw.rpId);
  const challengeB64u = toOptionalTrimmedString(raw.challengeB64u);
  const createdAtMs =
    typeof raw.createdAtMs === 'number' ? raw.createdAtMs : Number(raw.createdAtMs);
  const expiresAtMs =
    typeof raw.expiresAtMs === 'number' ? raw.expiresAtMs : Number(raw.expiresAtMs);
  if (version !== 'webauthn_login_challenge_v1') return null;
  if (!challengeId || !userId || !rpId || !challengeB64u) return null;
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return null;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return null;
  return {
    version: 'webauthn_login_challenge_v1',
    challengeId,
    userId,
    rpId,
    challengeB64u,
    createdAtMs: Math.floor(createdAtMs),
    expiresAtMs: Math.floor(expiresAtMs),
  };
}

const LOGIN_CHALLENGE_STORE: WebAuthnChallengeStoreSpec<WebAuthnLoginChallengeRecord> = {
  label: 'login challenge',
  prefixConfigKey: 'WEBAUTHN_LOGIN_CHALLENGE_PREFIX',
  prefixName: 'login_challenge',
  challengeKind: 'login',
  parse: parseWebAuthnLoginChallengeRecord,
  durableObjectLogSubject: 'login challenge persistence',
  connectionErrorSubject: 'webauthn login challenge store',
  unconfiguredNote: 'non-persistent',
  d1ScopeLabel: 'login challenge',
};

export class D1WebAuthnLoginChallengeStore extends D1WebAuthnChallengeStore<WebAuthnLoginChallengeRecord> {
  constructor(input: D1WebAuthnLoginChallengeStoreOptions) {
    super(input, LOGIN_CHALLENGE_STORE);
  }
}

export function createWebAuthnLoginChallengeStore(
  input: WebAuthnStoreInput,
): WebAuthnLoginChallengeStore {
  return createWebAuthnChallengeStore(
    input,
    LOGIN_CHALLENGE_STORE,
    (options) => new D1WebAuthnLoginChallengeStore(options),
  );
}
