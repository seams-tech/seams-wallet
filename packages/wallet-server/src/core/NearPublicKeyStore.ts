import type { NormalizedLogger } from './logger';
import { isObject, toOptionalTrimmedString } from '@shared/utils/validation';
import { parseWebAuthnRpId, type WebAuthnRpId } from '@shared/utils/domainIds';
import { parseD1JsonColumn, resolveD1DatabaseFromConfig } from '../storage/d1Sql';
import {
  D1TenantTable,
  d1TenantScopeFromConfig,
  ensureD1Schema,
  type D1SchemaOptions,
  type D1TenantStoreOptions,
} from './d1TenantStore';

export type NearPublicKeyKind = 'threshold' | 'local' | 'backup' | 'ephemeral';

export type NearPublicKeyAuthBinding = {
  readonly kind: 'passkey';
  readonly rpId: WebAuthnRpId;
  readonly credentialIdB64u: string;
};

export type NearPublicKeyRecord = {
  version: 'near_public_key_v1';
  userId: string;
  publicKey: string;
  kind: NearPublicKeyKind;
  signerSlot?: number;
  authBinding?: NearPublicKeyAuthBinding;
  credentialIdB64u?: never;
  rpId?: never;
  createdAtMs: number;
  updatedAtMs: number;
  addedTxHash?: string;
  removedAtMs?: number;
};

export interface NearPublicKeyStore {
  put(record: NearPublicKeyRecord): Promise<void>;
  listByUserId(userId: string): Promise<NearPublicKeyRecord[]>;
}

export interface D1NearPublicKeyStoreSchemaOptions extends D1SchemaOptions {}

export interface D1NearPublicKeyStoreOptions extends D1TenantStoreOptions {}

const NEAR_PUBLIC_KEY_D1_STORE = 'NEAR public key store';

type D1NearPublicKeyRow = {
  readonly record_json?: unknown;
};

export const NEAR_PUBLIC_KEY_STORE_D1_SCHEMA_SQL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS near_public_keys (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      signer_slot INTEGER,
      record_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      removed_at_ms INTEGER,
      PRIMARY KEY (namespace, org_id, project_id, env_id, user_id, public_key),
      CHECK (length(user_id) > 0),
      CHECK (length(public_key) > 0),
      CHECK (kind IN ('threshold', 'local', 'backup', 'ephemeral')),
      CHECK (signer_slot IS NULL OR signer_slot >= 1),
      CHECK (json_valid(record_json)),
      CHECK (created_at_ms > 0),
      CHECK (updated_at_ms > 0),
      CHECK (removed_at_ms IS NULL OR removed_at_ms > 0)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS near_public_keys_user_idx
      ON near_public_keys (
        namespace,
        org_id,
        project_id,
        env_id,
        user_id,
        signer_slot,
        created_at_ms
      )
  `,
] as const);

export async function ensureNearPublicKeyStoreD1Schema(
  options: D1NearPublicKeyStoreSchemaOptions,
): Promise<void> {
  await ensureD1Schema(options.database, NEAR_PUBLIC_KEY_STORE_D1_SCHEMA_SQL);
}

function parseNearPublicKeyKind(input: unknown): NearPublicKeyKind | null {
  const k = toOptionalTrimmedString(input);
  if (k === 'threshold' || k === 'local' || k === 'backup' || k === 'ephemeral') return k;
  return null;
}

function parseNearPublicKeyAuthBinding(
  raw: Record<string, unknown>,
): NearPublicKeyAuthBinding | undefined | null {
  if (
    Object.prototype.hasOwnProperty.call(raw, 'rpId') ||
    Object.prototype.hasOwnProperty.call(raw, 'credentialIdB64u')
  ) {
    return null;
  }
  if (raw.authBinding === undefined) return undefined;
  if (!isObject(raw.authBinding)) return null;
  const kind = toOptionalTrimmedString(raw.authBinding.kind);
  const rpId = parseWebAuthnRpId(raw.authBinding.rpId);
  const credentialIdB64u = toOptionalTrimmedString(raw.authBinding.credentialIdB64u);
  if (kind !== 'passkey' || !rpId.ok || !credentialIdB64u) return null;
  return { kind: 'passkey', rpId: rpId.value, credentialIdB64u };
}

function parseNearPublicKeyRecord(raw: unknown): NearPublicKeyRecord | null {
  if (!isObject(raw)) return null;
  const version = toOptionalTrimmedString(raw.version);
  if (version !== 'near_public_key_v1') return null;
  const userId = toOptionalTrimmedString(raw.userId);
  const publicKey = toOptionalTrimmedString(raw.publicKey);
  const kind = parseNearPublicKeyKind(raw.kind);
  const createdAtMsRaw = raw.createdAtMs;
  const updatedAtMsRaw = raw.updatedAtMs;
  const createdAtMs = typeof createdAtMsRaw === 'number' ? createdAtMsRaw : Number(createdAtMsRaw);
  const updatedAtMs = typeof updatedAtMsRaw === 'number' ? updatedAtMsRaw : Number(updatedAtMsRaw);

  if (!userId || !publicKey || !kind) return null;
  if (!publicKey.startsWith('ed25519:')) return null;
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return null;
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return null;

  const signerSlotRaw = raw.signerSlot;
  const signerSlot =
    typeof signerSlotRaw === 'number' ? signerSlotRaw : Number(signerSlotRaw);
  const authBinding = parseNearPublicKeyAuthBinding(raw);
  if (authBinding === null) return null;
  const addedTxHash = toOptionalTrimmedString(raw.addedTxHash);
  const removedAtMsRaw = raw.removedAtMs;
  const removedAtMs = typeof removedAtMsRaw === 'number' ? removedAtMsRaw : Number(removedAtMsRaw);

  return {
    version: 'near_public_key_v1',
    userId,
    publicKey,
    kind,
    ...(Number.isFinite(signerSlot) && signerSlot >= 1
      ? { signerSlot: Math.floor(signerSlot) }
      : {}),
    ...(authBinding ? { authBinding } : {}),
    createdAtMs: Math.floor(createdAtMs),
    updatedAtMs: Math.floor(updatedAtMs),
    ...(addedTxHash ? { addedTxHash } : {}),
    ...(Number.isFinite(removedAtMs) && removedAtMs > 0
      ? { removedAtMs: Math.floor(removedAtMs) }
      : {}),
  };
}

class InMemoryNearPublicKeyStore implements NearPublicKeyStore {
  private readonly byUser = new Map<string, Map<string, NearPublicKeyRecord>>();

  async put(record: NearPublicKeyRecord): Promise<void> {
    const parsed = parseNearPublicKeyRecord(record);
    if (!parsed) throw new Error('Invalid near public key record');
    const key = parsed.userId;
    const bucket = this.byUser.get(key) || new Map<string, NearPublicKeyRecord>();
    bucket.set(parsed.publicKey, parsed);
    this.byUser.set(key, bucket);
  }

  async listByUserId(userId: string): Promise<NearPublicKeyRecord[]> {
    const uid = toOptionalTrimmedString(userId);
    if (!uid) return [];
    const bucket = this.byUser.get(uid);
    if (!bucket) return [];
    const out = Array.from(bucket.values())
      .map((r) => parseNearPublicKeyRecord(r))
      .filter(Boolean) as NearPublicKeyRecord[];
    out.sort((a, b) => (a.signerSlot || 0) - (b.signerSlot || 0));
    return out;
  }
}

/** A user's NEAR public keys, in signer-slot order; binds the scope, then the user. */
export const NEAR_PUBLIC_KEYS_BY_USER_SQL = `SELECT record_json
         FROM near_public_keys
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND user_id = ?
        ORDER BY COALESCE(signer_slot, 0) ASC, created_at_ms ASC, public_key ASC`;

export class D1NearPublicKeyStore implements NearPublicKeyStore {
  readonly adapterKind = 'd1';
  private readonly table: D1TenantTable;

  constructor(input: D1NearPublicKeyStoreOptions) {
    this.table = new D1TenantTable(
      input,
      NEAR_PUBLIC_KEY_D1_STORE,
      NEAR_PUBLIC_KEY_STORE_D1_SCHEMA_SQL,
    );
  }

  async put(record: NearPublicKeyRecord): Promise<void> {
    await this.table.ensureSchema();
    const parsed = parseNearPublicKeyRecord(record);
    if (!parsed) throw new Error('Invalid near public key record');
    await this.table
      .prepare(
        `INSERT INTO near_public_keys (
        namespace,
        org_id,
        project_id,
        env_id,
        user_id,
        public_key,
        kind,
        signer_slot,
        record_json,
        created_at_ms,
        updated_at_ms,
        removed_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, org_id, project_id, env_id, user_id, public_key)
      DO UPDATE SET
        kind = EXCLUDED.kind,
        signer_slot = EXCLUDED.signer_slot,
        record_json = EXCLUDED.record_json,
        created_at_ms = MIN(near_public_keys.created_at_ms, EXCLUDED.created_at_ms),
        updated_at_ms = MAX(near_public_keys.updated_at_ms, EXCLUDED.updated_at_ms),
        removed_at_ms = EXCLUDED.removed_at_ms`,
        [
          parsed.userId,
          parsed.publicKey,
          parsed.kind,
          parsed.signerSlot ?? null,
          JSON.stringify(parsed),
          parsed.createdAtMs,
          parsed.updatedAtMs,
          parsed.removedAtMs ?? null,
        ],
      )
      .run();
  }

  async listByUserId(userId: string): Promise<NearPublicKeyRecord[]> {
    await this.table.ensureSchema();
    const uid = toOptionalTrimmedString(userId);
    if (!uid) return [];
    const result = await this.table
      .prepare(NEAR_PUBLIC_KEYS_BY_USER_SQL, [uid])
      .all<D1NearPublicKeyRow>();
    return (result.results || [])
      .map((row) => parseNearPublicKeyRecord(parseD1JsonColumn(row.record_json)))
      .filter((record): record is NearPublicKeyRecord => Boolean(record));
  }
}

export function createNearPublicKeyStore(input: {
  config?: Record<string, unknown> | null;
  logger: NormalizedLogger;
  isNode: boolean;
}): NearPublicKeyStore {
  const config = (isObject(input.config) ? input.config : {}) as Record<string, unknown>;
  const namespace =
    toOptionalTrimmedString(config.NEAR_PUBLIC_KEY_NAMESPACE) ||
    toOptionalTrimmedString(config.THRESHOLD_PREFIX) ||
    '';
  const kind = toOptionalTrimmedString(config.kind);

  if (kind === 'd1') {
    const database = resolveD1DatabaseFromConfig(config);
    if (!database) {
      throw new Error(
        '[near-public-keys] D1 store selected but no D1 database was provided',
      );
    }
    input.logger.info('[near-public-keys] Using D1 store for NEAR public key metadata');
    return new D1NearPublicKeyStore({
      database,
      ...d1TenantScopeFromConfig(config, namespace, NEAR_PUBLIC_KEY_D1_STORE),
    });
  }

  if (kind) throw new Error(`[near-public-keys] Unknown NEAR public key store kind: ${kind}`);

  input.logger.info('[near-public-keys] Using in-memory store for NEAR public key metadata');
  return new InMemoryNearPublicKeyStore();
}
