import { isObject, toOptionalTrimmedString } from '@shared/utils/validation';
import {
  D1WebAuthnChallengeStore,
  WEBAUTHN_CHALLENGE_STORE_D1_SCHEMA_SQL,
  createWebAuthnChallengeStore,
  ensureWebAuthnChallengeStoreD1Schema,
  type D1WebAuthnChallengeStoreOptions,
  type WebAuthnChallengeStore,
  type WebAuthnChallengeStoreSpec,
} from './webAuthnStoreBackends';
import type { StoreFactoryInput } from './storeBackends';
import type { D1SchemaOptions } from './d1TenantStore';

export type WebAuthnSyncChallengeRecord = {
  version: 'webauthn_sync_challenge_v1';
  challengeId: string;
  rpId: string;
  expectedUserId?: string;
  challengeB64u: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export interface WebAuthnSyncChallengeStore extends WebAuthnChallengeStore<WebAuthnSyncChallengeRecord> {}

export interface D1WebAuthnSyncChallengeStoreSchemaOptions extends D1SchemaOptions {}

export interface D1WebAuthnSyncChallengeStoreOptions extends D1WebAuthnChallengeStoreOptions {}

// Login and sync challenges share one D1 table.
export const WEBAUTHN_SYNC_CHALLENGE_STORE_D1_SCHEMA_SQL = WEBAUTHN_CHALLENGE_STORE_D1_SCHEMA_SQL;

export const ensureWebAuthnSyncChallengeStoreD1Schema = ensureWebAuthnChallengeStoreD1Schema;

function parseWebAuthnSyncChallengeRecord(raw: unknown): WebAuthnSyncChallengeRecord | null {
  if (!isObject(raw)) return null;
  const version = toOptionalTrimmedString(raw.version);
  const challengeId = toOptionalTrimmedString(raw.challengeId);
  const rpId = toOptionalTrimmedString(raw.rpId);
  const expectedUserId = toOptionalTrimmedString(
    (raw as { expectedUserId?: unknown }).expectedUserId,
  );
  const challengeB64u = toOptionalTrimmedString(raw.challengeB64u);
  const createdAtMsRaw = (raw as { createdAtMs?: unknown }).createdAtMs;
  const expiresAtMsRaw = (raw as { expiresAtMs?: unknown }).expiresAtMs;
  const createdAtMs = typeof createdAtMsRaw === 'number' ? createdAtMsRaw : Number(createdAtMsRaw);
  const expiresAtMs = typeof expiresAtMsRaw === 'number' ? expiresAtMsRaw : Number(expiresAtMsRaw);
  if (version !== 'webauthn_sync_challenge_v1') return null;
  if (!challengeId || !rpId || !challengeB64u) return null;
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return null;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return null;
  return {
    version: 'webauthn_sync_challenge_v1',
    challengeId,
    rpId,
    ...(expectedUserId ? { expectedUserId } : {}),
    challengeB64u,
    createdAtMs: Math.floor(createdAtMs),
    expiresAtMs: Math.floor(expiresAtMs),
  };
}

const SYNC_CHALLENGE_STORE: WebAuthnChallengeStoreSpec<WebAuthnSyncChallengeRecord> = {
  label: 'sync challenge',
  prefixConfigKey: 'WEBAUTHN_SYNC_CHALLENGE_PREFIX',
  prefixName: 'sync_challenge',
  challengeKind: 'sync',
  parse: parseWebAuthnSyncChallengeRecord,
  durableObjectLogSubject: 'sync challenges',
  connectionErrorSubject: 'webauthn store',
  unconfiguredNote: 'no persistence configured',
  d1ScopeLabel: 'sync challenge',
};

export class D1WebAuthnSyncChallengeStore extends D1WebAuthnChallengeStore<WebAuthnSyncChallengeRecord> {
  constructor(input: D1WebAuthnSyncChallengeStoreOptions) {
    super(input, SYNC_CHALLENGE_STORE);
  }
}

export function createWebAuthnSyncChallengeStore(
  input: StoreFactoryInput,
): WebAuthnSyncChallengeStore {
  return createWebAuthnChallengeStore(
    input,
    SYNC_CHALLENGE_STORE,
    (options) => new D1WebAuthnSyncChallengeStore(options),
  );
}
