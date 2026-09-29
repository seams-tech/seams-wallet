import type { ThresholdRuntimePolicyScope } from './types';
import { isObject, toOptionalTrimmedString } from '@shared/utils/validation';
import { normalizeRuntimePolicyScope } from '@shared/threshold/signingRootScope';
import {
  WebAuthnCredentialRecords,
  createWebAuthnStore,
  resolveWebAuthnStorePrefix,
  webAuthnD1Store,
  type InMemoryWebAuthnRecords,
  type WebAuthnStoreSpec,
} from './webAuthnStoreBackends';
import type { KeyValueRecords, StoreFactoryInput } from './storeBackends';
import { webAuthnCredentialBindingRows } from './webAuthnD1Statements';
import type { ScopedD1Prepare } from './emailOtpD1Statements';
import {
  D1TenantTable,
  ensureD1Schema,
  prepareD1TenantStatement,
  type D1SchemaOptions,
  type D1TenantScope,
  type D1TenantStoreOptions,
} from './d1TenantStore';
import { parseD1JsonColumn } from '../storage/d1Sql';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../storage/tenantRoute';

/**
 * The Ed25519 facts on a credential binding are denormalized from the wallet's
 * Ed25519 signer row. A passkey wallet can exist before its Ed25519 Yao
 * ceremony has settled (non-blocking provisioning), so they are absent until
 * that signer is committed. They are written together or not at all — a
 * binding never carries a partial Ed25519 identity.
 */
type WebAuthnCredentialBindingEd25519Facts = {
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  signerSlot: number;
  /** NEAR ed25519 public key (e.g. `ed25519:...`). In threshold-signer mode, this is the group public key. */
  publicKey: string;
};

/** Present only once the wallet's Ed25519 signer is committed. */
type WebAuthnCredentialBindingEd25519Present = WebAuthnCredentialBindingEd25519Facts;

/** Absent as a set, so a partial Ed25519 identity cannot be constructed. */
type WebAuthnCredentialBindingEd25519Absent = {
  [K in keyof WebAuthnCredentialBindingEd25519Facts]?: never;
};

type WebAuthnCredentialBindingBase = {
  version: 'webauthn_credential_binding_v1';
  rpId: string;
  credentialIdB64u: string;
  userId: string;
  /** Threshold relayer key id (often equal to `publicKey`). */
  relayerKeyId?: string;
  keyVersion?: string;
  recoveryExportCapable?: boolean;
  clientParticipantId?: number;
  relayerParticipantId?: number;
  participantIds?: number[];
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
  createdAtMs: number;
  updatedAtMs: number;
};

export type WebAuthnCredentialBindingRecord = WebAuthnCredentialBindingBase &
  (WebAuthnCredentialBindingEd25519Present | WebAuthnCredentialBindingEd25519Absent);

export interface WebAuthnCredentialBindingStore {
  get(rpId: string, credentialIdB64u: string): Promise<WebAuthnCredentialBindingRecord | null>;
  put(record: WebAuthnCredentialBindingRecord): Promise<void>;
  del(rpId: string, credentialIdB64u: string): Promise<void>;
  getMaxSignerSlot?(input: { userId: string; rpId?: string }): Promise<number | null>;
  /**
   * List credential bindings for a user (optionally scoped to an RP ID).
   *
   * Optional because not all backing stores can efficiently enumerate keys.
   */
  listByUserId?(input: {
    userId: string;
    rpId?: string;
  }): Promise<WebAuthnCredentialBindingRecord[]>;
}

export interface D1WebAuthnCredentialBindingStoreSchemaOptions extends D1SchemaOptions {}

export interface D1WebAuthnCredentialBindingStoreOptions extends D1TenantStoreOptions {}

type D1WebAuthnCredentialBindingWrite = {
  readonly database: D1DatabaseLike;
  readonly scope: D1TenantScope;
  readonly record: WebAuthnCredentialBindingRecord;
};

const INSERT_CREDENTIAL_BINDING_SQL = `INSERT INTO webauthn_credential_bindings (
        namespace,
        org_id,
        project_id,
        env_id,
        rp_id,
        credential_id_b64u,
        user_id,
        signer_slot,
        record_json,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function prepareCredentialBindingWrite(
  input: D1WebAuthnCredentialBindingWrite,
  sql: string,
): D1PreparedStatementLike {
  const parsed = parseWebAuthnCredentialBindingRecord(input.record);
  if (!parsed) throw new Error('Invalid credential binding record');
  return prepareD1TenantStatement(input.database, input.scope, sql, [
    parsed.rpId,
    parsed.credentialIdB64u,
    parsed.userId,
    parsed.signerSlot ?? null,
    JSON.stringify(parsed),
    parsed.createdAtMs,
    parsed.updatedAtMs,
  ]);
}

export function prepareD1WebAuthnCredentialBindingPutStatement(
  input: D1WebAuthnCredentialBindingWrite,
): D1PreparedStatementLike {
  return prepareCredentialBindingWrite(
    input,
    `${INSERT_CREDENTIAL_BINDING_SQL}
      ON CONFLICT (namespace, org_id, project_id, env_id, rp_id, credential_id_b64u)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        signer_slot = EXCLUDED.signer_slot,
        -- Reads parse record_json, not the columns, so the JSON has to carry
        -- the same reconciled timestamps the columns do. Replacing it wholesale
        -- let a second write (the Ed25519 commit, or an out-of-order replay)
        -- appear to reset createdAtMs and regress updatedAtMs while the columns
        -- stayed correct.
        record_json = json_set(
          EXCLUDED.record_json,
          '$.createdAtMs',
          MIN(webauthn_credential_bindings.created_at_ms, EXCLUDED.created_at_ms),
          '$.updatedAtMs',
          MAX(webauthn_credential_bindings.updated_at_ms, EXCLUDED.updated_at_ms)
        ),
        created_at_ms = MIN(
          webauthn_credential_bindings.created_at_ms,
          EXCLUDED.created_at_ms
        ),
        updated_at_ms = MAX(
          webauthn_credential_bindings.updated_at_ms,
          EXCLUDED.updated_at_ms
        )`,
  );
}

/** Insert-only binding write for credential promotion. */
export function prepareD1WebAuthnCredentialBindingInsertStatement(
  input: D1WebAuthnCredentialBindingWrite,
): D1PreparedStatementLike {
  return prepareCredentialBindingWrite(input, INSERT_CREDENTIAL_BINDING_SQL);
}

type D1WebAuthnCredentialBindingRow = {
  readonly record_json?: unknown;
  readonly max_signer_slot?: unknown;
};

export const WEBAUTHN_CREDENTIAL_BINDING_STORE_D1_SCHEMA_SQL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS webauthn_credential_bindings (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      rp_id TEXT NOT NULL,
      credential_id_b64u TEXT NOT NULL,
      user_id TEXT NOT NULL,
      -- Nullable until the wallet's Ed25519 Yao ceremony settles.
      signer_slot INTEGER,
      record_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, org_id, project_id, env_id, rp_id, credential_id_b64u),
      CHECK (length(rp_id) > 0),
      CHECK (length(credential_id_b64u) > 0),
      CHECK (length(user_id) > 0),
      CHECK (signer_slot IS NULL OR signer_slot >= 1),
      CHECK (json_valid(record_json)),
      CHECK (created_at_ms > 0),
      CHECK (updated_at_ms > 0)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS webauthn_credential_bindings_user_idx
      ON webauthn_credential_bindings (
        namespace,
        org_id,
        project_id,
        env_id,
        user_id,
        rp_id,
        signer_slot
      )
  `,
] as const);

export async function ensureWebAuthnCredentialBindingStoreD1Schema(
  options: D1WebAuthnCredentialBindingStoreSchemaOptions,
): Promise<void> {
  await ensureD1Schema(options.database, WEBAUTHN_CREDENTIAL_BINDING_STORE_D1_SCHEMA_SQL);
}

const CREDENTIAL_BINDING_STORE: WebAuthnStoreSpec<WebAuthnCredentialBindingRecord> = {
  label: 'credential binding',
  prefixConfigKey: 'WEBAUTHN_CREDENTIAL_BINDING_PREFIX',
  prefixName: 'credential_binding',
  parse: parseWebAuthnCredentialBindingRecord,
  durableObjectLogSubject: 'credential bindings',
  connectionErrorSubject: 'webauthn store',
  unconfiguredNote: 'no persistence configured',
  d1ScopeLabel: 'credential',
};

export function resolveWebAuthnCredentialBindingStoreNamespace(
  config: Record<string, unknown>,
): string {
  return resolveWebAuthnStorePrefix(config, CREDENTIAL_BINDING_STORE);
}

function parseWebAuthnCredentialBindingRecord(
  raw: unknown,
): WebAuthnCredentialBindingRecord | null {
  if (!isObject(raw)) return null;
  const version = toOptionalTrimmedString(raw.version);
  const rpId = toOptionalTrimmedString(raw.rpId);
  const credentialIdB64u = toOptionalTrimmedString(raw.credentialIdB64u);
  const userId = toOptionalTrimmedString(raw.userId);
  const nearAccountId = toOptionalTrimmedString(raw.nearAccountId);
  const nearEd25519SigningKeyId = toOptionalTrimmedString(raw.nearEd25519SigningKeyId);
  const publicKey = toOptionalTrimmedString(raw.publicKey);
  const signerSlotRaw = (raw as { signerSlot?: unknown }).signerSlot;
  const signerSlot =
    typeof signerSlotRaw === 'number' ? signerSlotRaw : Number(signerSlotRaw);
  const createdAtMsRaw = (raw as { createdAtMs?: unknown }).createdAtMs;
  const updatedAtMsRaw = (raw as { updatedAtMs?: unknown }).updatedAtMs;
  const createdAtMs = typeof createdAtMsRaw === 'number' ? createdAtMsRaw : Number(createdAtMsRaw);
  const updatedAtMs = typeof updatedAtMsRaw === 'number' ? updatedAtMsRaw : Number(updatedAtMsRaw);

  if (version !== 'webauthn_credential_binding_v1') return null;
  if (!rpId || !credentialIdB64u || !userId) return null;
  /* Ed25519 facts are all-or-nothing. Absent means the wallet's Yao ceremony
     has not settled; a partial set means a corrupt record and is rejected.
     Resolved into one typed value so the record type's union stays the only
     way to express presence. */
  const hasAnyEd25519Fact =
    Boolean(nearAccountId || nearEd25519SigningKeyId || publicKey) || Number.isFinite(signerSlot);
  let ed25519Facts: WebAuthnCredentialBindingEd25519Facts | null = null;
  if (hasAnyEd25519Fact) {
    if (!nearAccountId || !nearEd25519SigningKeyId || !publicKey) return null;
    if (!Number.isFinite(signerSlot) || signerSlot < 1) return null;
    ed25519Facts = {
      nearAccountId,
      nearEd25519SigningKeyId,
      signerSlot: Math.floor(signerSlot),
      publicKey,
    };
  }
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return null;
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return null;

  const relayerKeyId = toOptionalTrimmedString((raw as { relayerKeyId?: unknown }).relayerKeyId);
  const keyVersion = toOptionalTrimmedString((raw as { keyVersion?: unknown }).keyVersion);
  const recoveryExportCapable =
    typeof (raw as { recoveryExportCapable?: unknown }).recoveryExportCapable === 'boolean'
      ? Boolean((raw as { recoveryExportCapable?: unknown }).recoveryExportCapable)
      : undefined;
  const clientParticipantIdRaw = (raw as { clientParticipantId?: unknown }).clientParticipantId;
  const relayerParticipantIdRaw = (raw as { relayerParticipantId?: unknown }).relayerParticipantId;
  const clientParticipantId =
    typeof clientParticipantIdRaw === 'number'
      ? clientParticipantIdRaw
      : Number(clientParticipantIdRaw);
  const relayerParticipantId =
    typeof relayerParticipantIdRaw === 'number'
      ? relayerParticipantIdRaw
      : Number(relayerParticipantIdRaw);
  const participantIdsRaw = (raw as { participantIds?: unknown }).participantIds;
  const participantIds = Array.isArray(participantIdsRaw)
    ? participantIdsRaw
        .map((v) => (typeof v === 'number' ? v : Number(v)))
        .filter((n) => Number.isFinite(n) && n >= 1)
        .map((n) => Math.floor(n))
    : null;
  const runtimePolicyScopeRaw = (raw as { runtimePolicyScope?: unknown }).runtimePolicyScope;
  const runtimePolicyScope = isObject(runtimePolicyScopeRaw)
    ? (() => {
        try {
          return normalizeRuntimePolicyScope(runtimePolicyScopeRaw) satisfies ThresholdRuntimePolicyScope;
        } catch {
          return null;
        }
      })()
    : null;

  const base: WebAuthnCredentialBindingBase = {
    version: 'webauthn_credential_binding_v1',
    rpId,
    credentialIdB64u,
    userId,
    ...(relayerKeyId ? { relayerKeyId } : {}),
    ...(keyVersion ? { keyVersion } : {}),
    ...(typeof recoveryExportCapable === 'boolean' ? { recoveryExportCapable } : {}),
    ...(Number.isFinite(clientParticipantId) && clientParticipantId >= 1
      ? { clientParticipantId: Math.floor(clientParticipantId) }
      : {}),
    ...(Number.isFinite(relayerParticipantId) && relayerParticipantId >= 1
      ? { relayerParticipantId: Math.floor(relayerParticipantId) }
      : {}),
    ...(participantIds && participantIds.length ? { participantIds } : {}),
    ...(runtimePolicyScope ? { runtimePolicyScope } : {}),
    createdAtMs: Math.floor(createdAtMs),
    updatedAtMs: Math.floor(updatedAtMs),
  };
  // Spreading the facts selects the union's present branch; omitting them
  // selects the absent branch. A partial spread cannot type-check.
  return ed25519Facts ? { ...base, ...ed25519Facts } : base;
}

/** One user's bindings, on one RP ID when given. The scope binds ahead of `values`. */
function userBindingsFilter(userId: string, rpId: string): { where: string; values: string[] } {
  const clauses = ['namespace = ?', 'org_id = ?', 'project_id = ?', 'env_id = ?', 'user_id = ?'];
  const values = [userId];
  if (rpId) {
    clauses.push('rp_id = ?');
    values.push(rpId);
  }
  return { where: clauses.join(' AND '), values };
}

class KeyValueWebAuthnCredentialBindingStore implements WebAuthnCredentialBindingStore {
  private readonly records: WebAuthnCredentialRecords<WebAuthnCredentialBindingRecord>;

  constructor(records: KeyValueRecords<WebAuthnCredentialBindingRecord>, prefix: string) {
    this.records = new WebAuthnCredentialRecords(records, prefix);
  }

  async get(
    rpId: string,
    credentialIdB64u: string,
  ): Promise<WebAuthnCredentialBindingRecord | null> {
    return this.records.get(rpId, credentialIdB64u);
  }

  async put(record: WebAuthnCredentialBindingRecord): Promise<void> {
    const parsed = parseWebAuthnCredentialBindingRecord(record);
    if (!parsed) throw new Error('Invalid credential binding record');
    await this.records.set(parsed.rpId, parsed.credentialIdB64u, parsed);
  }

  async del(rpId: string, credentialIdB64u: string): Promise<void> {
    await this.records.del(rpId, credentialIdB64u);
  }
}

/** Only the in-memory backend can enumerate a user's bindings. */
class InMemoryWebAuthnCredentialBindingStore extends KeyValueWebAuthnCredentialBindingStore {
  constructor(
    private readonly memory: InMemoryWebAuthnRecords<WebAuthnCredentialBindingRecord>,
    prefix: string,
  ) {
    super(memory, prefix);
  }

  async listByUserId(input: {
    userId: string;
    rpId?: string;
  }): Promise<WebAuthnCredentialBindingRecord[]> {
    const uid = toOptionalTrimmedString(input.userId);
    const rpId = toOptionalTrimmedString(input.rpId);
    if (!uid) return [];
    const out: WebAuthnCredentialBindingRecord[] = [];
    for (const v of this.memory.map.values()) {
      const parsed = parseWebAuthnCredentialBindingRecord(v);
      if (!parsed) continue;
      if (parsed.userId !== uid) continue;
      if (rpId && parsed.rpId !== rpId) continue;
      out.push(parsed);
    }
    // Bindings without an Ed25519 signer yet sort last; their slot is unknown.
    out.sort((a, b) => (a.signerSlot ?? Number.MAX_SAFE_INTEGER) - (b.signerSlot ?? Number.MAX_SAFE_INTEGER));
    return out;
  }
}

export class D1WebAuthnCredentialBindingStore implements WebAuthnCredentialBindingStore {
  readonly adapterKind = 'd1';
  private readonly table: D1TenantTable;
  private readonly prepare: ScopedD1Prepare = (sql, values) => this.table.prepare(sql, values);

  constructor(input: D1WebAuthnCredentialBindingStoreOptions) {
    this.table = new D1TenantTable(
      input,
      webAuthnD1Store(CREDENTIAL_BINDING_STORE.d1ScopeLabel),
      WEBAUTHN_CREDENTIAL_BINDING_STORE_D1_SCHEMA_SQL,
    );
  }

  async get(
    rpId: string,
    credentialIdB64u: string,
  ): Promise<WebAuthnCredentialBindingRecord | null> {
    await this.table.ensureSchema();
    const r = toOptionalTrimmedString(rpId);
    const c = toOptionalTrimmedString(credentialIdB64u);
    if (!r || !c) return null;
    const row = await webAuthnCredentialBindingRows
      .select(this.prepare, r, c)
      .first<D1WebAuthnCredentialBindingRow>();
    return parseWebAuthnCredentialBindingRecord(parseD1JsonColumn(row?.record_json));
  }

  async put(record: WebAuthnCredentialBindingRecord): Promise<void> {
    await this.table.ensureSchema();
    await prepareD1WebAuthnCredentialBindingPutStatement({
      database: this.table.database,
      scope: this.table.scope,
      record,
    }).run();
  }

  async del(rpId: string, credentialIdB64u: string): Promise<void> {
    await this.table.ensureSchema();
    const r = toOptionalTrimmedString(rpId);
    const c = toOptionalTrimmedString(credentialIdB64u);
    if (!r || !c) return;
    await this.table
      .prepare(
        `DELETE FROM webauthn_credential_bindings
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND rp_id = ?
            AND credential_id_b64u = ?`,
        [r, c],
      )
      .run();
  }

  async getMaxSignerSlot(input: { userId: string; rpId?: string }): Promise<number | null> {
    await this.table.ensureSchema();
    const userId = toOptionalTrimmedString(input.userId);
    if (!userId) return null;
    const filter = userBindingsFilter(userId, toOptionalTrimmedString(input.rpId));
    const row = await this.table
      .prepare(
        `SELECT MAX(signer_slot) AS max_signer_slot
           FROM webauthn_credential_bindings
          WHERE ${filter.where}`,
        filter.values,
      )
      .first<D1WebAuthnCredentialBindingRow>();
    const maxSignerSlot = Number(row?.max_signer_slot);
    return Number.isFinite(maxSignerSlot) && maxSignerSlot > 0
      ? Math.floor(maxSignerSlot)
      : null;
  }

  async listByUserId(input: {
    userId: string;
    rpId?: string;
  }): Promise<WebAuthnCredentialBindingRecord[]> {
    await this.table.ensureSchema();
    const userId = toOptionalTrimmedString(input.userId);
    if (!userId) return [];
    const filter = userBindingsFilter(userId, toOptionalTrimmedString(input.rpId));
    const result = await this.table
      .prepare(
        `SELECT record_json
           FROM webauthn_credential_bindings
          WHERE ${filter.where}
          ORDER BY signer_slot ASC`,
        filter.values,
      )
      .all<D1WebAuthnCredentialBindingRow>();
    const records: WebAuthnCredentialBindingRecord[] = [];
    for (const row of result.results || []) {
      const parsed = parseWebAuthnCredentialBindingRecord(parseD1JsonColumn(row.record_json));
      if (parsed) records.push(parsed);
    }
    return records;
  }
}

export function createWebAuthnCredentialBindingStore(
  input: StoreFactoryInput,
): WebAuthnCredentialBindingStore {
  return createWebAuthnStore(input, CREDENTIAL_BINDING_STORE, {
    d1: (options) => new D1WebAuthnCredentialBindingStore(options),
    keyValue: (records, prefix) => new KeyValueWebAuthnCredentialBindingStore(records, prefix),
    inMemory: (records, prefix) => new InMemoryWebAuthnCredentialBindingStore(records, prefix),
  });
}
