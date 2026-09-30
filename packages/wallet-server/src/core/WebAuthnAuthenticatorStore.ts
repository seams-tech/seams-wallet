import { isObject, toOptionalTrimmedString } from '@shared/utils/validation';
import {
  parseWebAuthnAuthenticatorDeviceInfo,
  parseWebAuthnAuthenticatorDeviceInfoJson,
  unknownWebAuthnAuthenticatorDeviceInfo,
  type WebAuthnAuthenticatorDeviceInfo,
} from '@shared/utils/webauthnDeviceInfo';
import {
  WebAuthnCredentialRecords,
  createWebAuthnStore,
  resolveWebAuthnStorePrefix,
  webAuthnD1Store,
  type InMemoryWebAuthnRecords,
  type WebAuthnStoreSpec,
} from './webAuthnStoreBackends';
import type { KeyValueRecords, StoreFactoryInput } from './storeBackends';
import {
  UPSERT_WEBAUTHN_AUTHENTICATOR_SQL,
  webAuthnAuthenticatorRows,
} from './webAuthnD1Statements';
import type { ScopedD1Prepare } from './emailOtpD1Statements';
import {
  D1TenantTable,
  ensureD1Schema,
  type D1SchemaOptions,
  type D1TenantStoreOptions,
} from './d1TenantStore';

export type WebAuthnAuthenticatorRecord = {
  version: 'webauthn_authenticator_v1';
  credentialIdB64u: string;
  credentialPublicKeyB64u: string;
  counter: number;
  createdAtMs: number;
  updatedAtMs: number;
  /**
   * Server-derived device metadata captured at registration verification.
   * Required so the authenticator listing can promise it; rows written before
   * device capture parse back as `Unknown device` at the store boundary.
   */
  deviceInfo: WebAuthnAuthenticatorDeviceInfo;
};

export interface WebAuthnAuthenticatorStore {
  get(userId: string, credentialIdB64u: string): Promise<WebAuthnAuthenticatorRecord | null>;
  put(userId: string, record: WebAuthnAuthenticatorRecord): Promise<void>;
  del(userId: string, credentialIdB64u: string): Promise<void>;
  /**
   * List all authenticators for a user.
   *
   * Optional because not all backing stores can efficiently enumerate keys.
   */
  list?(userId: string): Promise<WebAuthnAuthenticatorRecord[]>;
}

export interface D1WebAuthnAuthenticatorStoreSchemaOptions extends D1SchemaOptions {}

export interface D1WebAuthnAuthenticatorStoreOptions extends D1TenantStoreOptions {}

export type D1WebAuthnAuthenticatorRow = {
  readonly credential_id_b64u?: unknown;
  readonly credential_public_key_b64u?: unknown;
  readonly counter?: unknown;
  readonly created_at_ms?: unknown;
  readonly updated_at_ms?: unknown;
  readonly device_info_json?: unknown;
};

export const WEBAUTHN_AUTHENTICATOR_STORE_D1_SCHEMA_SQL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS webauthn_authenticators (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      credential_id_b64u TEXT NOT NULL,
      credential_public_key_b64u TEXT NOT NULL,
      counter INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      device_info_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (namespace, org_id, project_id, env_id, user_id, credential_id_b64u),
      CHECK (length(user_id) > 0),
      CHECK (length(credential_id_b64u) > 0),
      CHECK (length(credential_public_key_b64u) > 0),
      CHECK (counter >= 0),
      CHECK (created_at_ms > 0),
      CHECK (updated_at_ms > 0)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS webauthn_authenticators_user_idx
      ON webauthn_authenticators (
        namespace,
        org_id,
        project_id,
        env_id,
        user_id,
        created_at_ms
      )
  `,
] as const);

export async function ensureWebAuthnAuthenticatorStoreD1Schema(
  options: D1WebAuthnAuthenticatorStoreSchemaOptions,
): Promise<void> {
  await ensureD1Schema(options.database, WEBAUTHN_AUTHENTICATOR_STORE_D1_SCHEMA_SQL);
}

const AUTHENTICATOR_STORE: WebAuthnStoreSpec<WebAuthnAuthenticatorRecord> = {
  label: 'authenticator',
  prefixConfigKey: 'WEBAUTHN_AUTHENTICATOR_PREFIX',
  prefixName: 'authenticator',
  parse: parseWebAuthnAuthenticatorRecord,
  durableObjectLogSubject: 'authenticator persistence',
  connectionErrorSubject: 'webauthn store',
  unconfiguredNote: 'non-persistent',
  d1ScopeLabel: 'authenticator',
};

export function resolveWebAuthnAuthenticatorStoreNamespace(
  config: Record<string, unknown>,
): string {
  return resolveWebAuthnStorePrefix(config, AUTHENTICATOR_STORE);
}

function parseWebAuthnAuthenticatorRecord(raw: unknown): WebAuthnAuthenticatorRecord | null {
  if (!isObject(raw)) return null;
  const version = toOptionalTrimmedString(raw.version);
  const credentialIdB64u = toOptionalTrimmedString(raw.credentialIdB64u);
  const credentialPublicKeyB64u = toOptionalTrimmedString(raw.credentialPublicKeyB64u);
  const counter = typeof raw.counter === 'number' ? raw.counter : Number(raw.counter);
  const createdAtMs =
    typeof raw.createdAtMs === 'number' ? raw.createdAtMs : Number(raw.createdAtMs);
  const updatedAtMs =
    typeof raw.updatedAtMs === 'number' ? raw.updatedAtMs : Number(raw.updatedAtMs);
  if (version !== 'webauthn_authenticator_v1') return null;
  if (!credentialIdB64u || !credentialPublicKeyB64u) return null;
  if (!Number.isFinite(counter) || counter < 0) return null;
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return null;
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return null;
  return {
    version: 'webauthn_authenticator_v1',
    credentialIdB64u,
    credentialPublicKeyB64u,
    counter: Math.floor(counter),
    createdAtMs: Math.floor(createdAtMs),
    updatedAtMs: Math.floor(updatedAtMs),
    deviceInfo:
      parseWebAuthnAuthenticatorDeviceInfo(raw.deviceInfo) ??
      unknownWebAuthnAuthenticatorDeviceInfo(),
  };
}

function parseD1WebAuthnAuthenticatorRow(
  row: D1WebAuthnAuthenticatorRow | null,
): WebAuthnAuthenticatorRecord | null {
  if (!row) return null;
  return parseWebAuthnAuthenticatorRecord({
    version: 'webauthn_authenticator_v1',
    credentialIdB64u: row.credential_id_b64u,
    credentialPublicKeyB64u: row.credential_public_key_b64u,
    counter: row.counter,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    deviceInfo: parseWebAuthnAuthenticatorDeviceInfoJson(row.device_info_json),
  });
}

class KeyValueWebAuthnAuthenticatorStore implements WebAuthnAuthenticatorStore {
  private readonly records: WebAuthnCredentialRecords<WebAuthnAuthenticatorRecord>;

  constructor(records: KeyValueRecords<WebAuthnAuthenticatorRecord>, prefix: string) {
    this.records = new WebAuthnCredentialRecords(records, prefix);
  }

  async get(userId: string, credentialIdB64u: string): Promise<WebAuthnAuthenticatorRecord | null> {
    return this.records.get(userId, credentialIdB64u);
  }

  async put(userId: string, record: WebAuthnAuthenticatorRecord): Promise<void> {
    const uid = toOptionalTrimmedString(userId);
    if (!uid) throw new Error('Missing userId');
    const parsed = parseWebAuthnAuthenticatorRecord(record);
    if (!parsed) throw new Error('Invalid authenticator record');
    await this.records.set(uid, parsed.credentialIdB64u, parsed);
  }

  async del(userId: string, credentialIdB64u: string): Promise<void> {
    await this.records.del(userId, credentialIdB64u);
  }
}

/** Only the in-memory backend can enumerate a user's authenticators. */
class InMemoryWebAuthnAuthenticatorStore extends KeyValueWebAuthnAuthenticatorStore {
  constructor(
    private readonly memory: InMemoryWebAuthnRecords<WebAuthnAuthenticatorRecord>,
    private readonly prefix: string,
  ) {
    super(memory, prefix);
  }

  async list(userId: string): Promise<WebAuthnAuthenticatorRecord[]> {
    const uid = toOptionalTrimmedString(userId);
    if (!uid) return [];
    const keyPrefix = `${this.prefix}${uid}:`;
    const out: WebAuthnAuthenticatorRecord[] = [];
    for (const [k, v] of this.memory.map.entries()) {
      if (!k.startsWith(keyPrefix)) continue;
      const parsed = parseWebAuthnAuthenticatorRecord(v);
      if (parsed) out.push(parsed);
    }
    out.sort((a, b) => a.createdAtMs - b.createdAtMs);
    return out;
  }
}

export class D1WebAuthnAuthenticatorStore implements WebAuthnAuthenticatorStore {
  readonly adapterKind = 'd1';
  private readonly table: D1TenantTable;
  private readonly prepare: ScopedD1Prepare = (sql, values) => this.table.prepare(sql, values);

  constructor(input: D1WebAuthnAuthenticatorStoreOptions) {
    this.table = new D1TenantTable(
      input,
      webAuthnD1Store(AUTHENTICATOR_STORE.d1ScopeLabel),
      WEBAUTHN_AUTHENTICATOR_STORE_D1_SCHEMA_SQL,
    );
  }

  async get(userId: string, credentialIdB64u: string): Promise<WebAuthnAuthenticatorRecord | null> {
    await this.table.ensureSchema();
    const uid = toOptionalTrimmedString(userId);
    const cid = toOptionalTrimmedString(credentialIdB64u);
    if (!uid || !cid) return null;
    const row = await webAuthnAuthenticatorRows
      .select(this.prepare, uid, cid)
      .first<D1WebAuthnAuthenticatorRow>();
    return parseD1WebAuthnAuthenticatorRow(row);
  }

  async put(userId: string, record: WebAuthnAuthenticatorRecord): Promise<void> {
    await this.table.ensureSchema();
    const uid = toOptionalTrimmedString(userId);
    if (!uid) throw new Error('Missing userId');
    const parsed = parseWebAuthnAuthenticatorRecord(record);
    if (!parsed) throw new Error('Invalid authenticator record');
    await this.table
      .prepare(UPSERT_WEBAUTHN_AUTHENTICATOR_SQL, [
        uid,
        parsed.credentialIdB64u,
        parsed.credentialPublicKeyB64u,
        parsed.counter,
        parsed.createdAtMs,
        parsed.updatedAtMs,
        JSON.stringify(parsed.deviceInfo),
      ])
      .run();
  }

  async del(userId: string, credentialIdB64u: string): Promise<void> {
    await this.table.ensureSchema();
    const uid = toOptionalTrimmedString(userId);
    const cid = toOptionalTrimmedString(credentialIdB64u);
    if (!uid || !cid) return;
    await this.table
      .prepare(
        `DELETE FROM webauthn_authenticators
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND user_id = ?
            AND credential_id_b64u = ?`,
        [uid, cid],
      )
      .run();
  }

  async list(userId: string): Promise<WebAuthnAuthenticatorRecord[]> {
    await this.table.ensureSchema();
    const uid = toOptionalTrimmedString(userId);
    if (!uid) return [];
    const result = await this.table
      .prepare(
        `SELECT credential_id_b64u, credential_public_key_b64u, counter, created_at_ms, updated_at_ms, device_info_json
           FROM webauthn_authenticators
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND user_id = ?
          ORDER BY created_at_ms ASC`,
        [uid],
      )
      .all<D1WebAuthnAuthenticatorRow>();
    const records: WebAuthnAuthenticatorRecord[] = [];
    for (const row of result.results || []) {
      const parsed = parseD1WebAuthnAuthenticatorRow(row);
      if (parsed) records.push(parsed);
    }
    return records;
  }
}

export function createWebAuthnAuthenticatorStore(
  input: StoreFactoryInput,
): WebAuthnAuthenticatorStore {
  return createWebAuthnStore(input, AUTHENTICATOR_STORE, {
    d1: (options) => new D1WebAuthnAuthenticatorStore(options),
    keyValue: (records, prefix) => new KeyValueWebAuthnAuthenticatorStore(records, prefix),
    inMemory: (records, prefix) => new InMemoryWebAuthnAuthenticatorStore(records, prefix),
  });
}
