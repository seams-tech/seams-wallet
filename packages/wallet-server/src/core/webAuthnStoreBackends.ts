import { toOptionalTrimmedString } from '@shared/utils/validation';
import { createKeyValueStore, type KeyValueRecords, type StoreFactoryInput } from './storeBackends';
import { parseD1JsonColumn } from '../storage/d1Sql';
import {
  D1TenantTable,
  ensureD1Schema,
  resolveStorePrefix,
  type D1SchemaOptions,
  type D1TenantStoreOptions,
} from './d1TenantStore';

/** What sets one WebAuthn store apart from the others. */
export type WebAuthnStoreSpec<R> = {
  /** Names the store in log lines and errors, e.g. `login challenge`. */
  readonly label: string;
  /** Config key that replaces the whole key prefix, e.g. `WEBAUTHN_LOGIN_CHALLENGE_PREFIX`. */
  readonly prefixConfigKey: string;
  /** The default prefix's last segment: `<THRESHOLD_PREFIX>:webauthn:<prefixName>:`. */
  readonly prefixName: string;
  /** Validates a record being written or read back; null when it is invalid. */
  readonly parse: (raw: unknown) => R | null;
  // The stores' existing messages differ in these words, so each store keeps its own.
  /** Ends the Durable Object log line, e.g. `login challenge persistence`. */
  readonly durableObjectLogSubject: string;
  /** Names the store in missing-connection errors, e.g. `webauthn store`. */
  readonly connectionErrorSubject: string;
  /** Qualifies the in-memory fallback's log line, e.g. `non-persistent`. */
  readonly unconfiguredNote: string;
  /** Names the store in D1 scope errors, e.g. `credential`. */
  readonly d1ScopeLabel: string;
};

/** Builds the store for the backend the config selects. */
type WebAuthnStoreBuilders<R, S> = {
  readonly d1: (options: D1TenantStoreOptions) => S;
  /** Upstash REST, Redis TCP and Durable Object backends. */
  readonly keyValue: (records: KeyValueRecords<R>, prefix: string) => S;
  readonly inMemory: (records: InMemoryWebAuthnRecords<R>, prefix: string) => S;
};

/**
 * A store's key prefix, which is also its D1 namespace: `config[spec.prefixConfigKey]` when set,
 * else `<THRESHOLD_PREFIX>:webauthn:<spec.prefixName>:`. It always ends with a colon.
 */
export function resolveWebAuthnStorePrefix(
  config: Record<string, unknown>,
  spec: Pick<WebAuthnStoreSpec<unknown>, 'prefixConfigKey' | 'prefixName'>,
): string {
  return resolveStorePrefix(config, [spec.prefixConfigKey], `webauthn:${spec.prefixName}:`);
}

/**
 * Selects a WebAuthn store's backend: the config's explicit `kind`, else Upstash or Redis from
 * env-shaped config, else in memory. The store type `S` comes from the caller's return type.
 */
export function createWebAuthnStore<R, S>(
  input: StoreFactoryInput,
  spec: WebAuthnStoreSpec<R>,
  build: WebAuthnStoreBuilders<R, NoInfer<S>>,
): S {
  return createKeyValueStore(
    input,
    {
      tag: 'webauthn',
      label: spec.label,
      connectionErrorSubject: spec.connectionErrorSubject,
      durableObjectLog: `store for ${spec.durableObjectLogSubject}`,
      durableObjectErrorName: 'WebAuthn',
      unconfiguredNote: spec.unconfiguredNote,
      d1StoreName: webAuthnD1Store(spec.d1ScopeLabel),
      resolvePrefix: (config) => resolveWebAuthnStorePrefix(config, spec),
      parse: spec.parse,
    },
    {
      d1: build.d1,
      keyValue: build.keyValue,
      inMemory: (prefix) => build.inMemory(new InMemoryWebAuthnRecords<R>(), prefix),
    },
  );
}

/** Keeps each record as it was put, without expiry; reads return the stored object. */
export class InMemoryWebAuthnRecords<R> implements KeyValueRecords<R> {
  readonly map = new Map<string, R>();

  async get(key: string): Promise<R | null> {
    return this.map.get(key) ?? null;
  }

  async take(key: string): Promise<R | null> {
    const record = this.map.get(key) ?? null;
    this.map.delete(key);
    return record;
  }

  async set(key: string, record: R): Promise<void> {
    this.map.set(key, record);
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/**
 * Per-credential records under `${prefix}${ownerId}:${credentialIdB64u}`, where the owner is the
 * user for authenticators and the RP ID for credential bindings. A blank id reads as missing.
 */
export class WebAuthnCredentialRecords<R> {
  constructor(
    private readonly records: KeyValueRecords<R>,
    private readonly prefix: string,
  ) {}

  async get(ownerId: string, credentialIdB64u: string): Promise<R | null> {
    const key = this.trimmedKey(ownerId, credentialIdB64u);
    return key ? this.records.get(key) : null;
  }

  async set(ownerId: string, credentialIdB64u: string, record: R): Promise<void> {
    await this.records.set(this.key(ownerId, credentialIdB64u), record);
  }

  async del(ownerId: string, credentialIdB64u: string): Promise<void> {
    const key = this.trimmedKey(ownerId, credentialIdB64u);
    if (key) await this.records.del(key);
  }

  private key(ownerId: string, credentialIdB64u: string): string {
    return `${this.prefix}${ownerId}:${credentialIdB64u}`;
  }

  private trimmedKey(ownerId: string, credentialIdB64u: string): string | null {
    const owner = toOptionalTrimmedString(ownerId);
    const credential = toOptionalTrimmedString(credentialIdB64u);
    return owner && credential ? this.key(owner, credential) : null;
  }
}

/** Names a WebAuthn store in D1 scope errors, e.g. `WebAuthn credential store`. */
export function webAuthnD1Store(d1ScopeLabel: string): string {
  return `WebAuthn ${d1ScopeLabel} store`;
}

type WebAuthnChallengeRecord = {
  readonly challengeId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
};

/** Holds each challenge until it is consumed once or expires. */
export interface WebAuthnChallengeStore<R> {
  put(record: R): Promise<void>;
  consume(challengeId: string): Promise<R | null>;
  del(challengeId: string): Promise<void>;
}

export type WebAuthnChallengeStoreSpec<R> = WebAuthnStoreSpec<R> & {
  /** The `challenge_kind` that tells this store's rows apart in the shared D1 table. */
  readonly challengeKind: 'login' | 'sync';
};

export interface D1WebAuthnChallengeStoreOptions extends D1TenantStoreOptions {
  readonly now?: () => Date;
}

export const WEBAUTHN_CHALLENGE_STORE_D1_SCHEMA_SQL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      challenge_id TEXT NOT NULL,
      challenge_kind TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, org_id, project_id, env_id, challenge_id),
      CHECK (length(challenge_id) > 0),
      CHECK (challenge_kind IN ('login', 'sync', 'recovery_registration')),
      CHECK (json_valid(record_json)),
      CHECK (created_at_ms > 0),
      CHECK (expires_at_ms > created_at_ms)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS webauthn_challenges_expiry_idx
      ON webauthn_challenges (
        namespace,
        org_id,
        project_id,
        env_id,
        challenge_kind,
        expires_at_ms
      )
  `,
] as const);

export async function ensureWebAuthnChallengeStoreD1Schema(
  options: D1SchemaOptions,
): Promise<void> {
  await ensureD1Schema(options.database, WEBAUTHN_CHALLENGE_STORE_D1_SCHEMA_SQL);
}

export function createWebAuthnChallengeStore<R extends WebAuthnChallengeRecord>(
  input: StoreFactoryInput,
  spec: WebAuthnChallengeStoreSpec<R>,
  d1: (options: D1TenantStoreOptions) => WebAuthnChallengeStore<R>,
): WebAuthnChallengeStore<R> {
  const keyValue = (records: KeyValueRecords<R>, prefix: string): WebAuthnChallengeStore<R> =>
    new KeyValueWebAuthnChallengeStore(records, prefix, spec);
  return createWebAuthnStore(input, spec, { d1, keyValue, inMemory: keyValue });
}

class KeyValueWebAuthnChallengeStore<R extends WebAuthnChallengeRecord>
  implements WebAuthnChallengeStore<R>
{
  constructor(
    private readonly records: KeyValueRecords<R>,
    private readonly prefix: string,
    private readonly spec: WebAuthnChallengeStoreSpec<R>,
  ) {}

  async put(record: R): Promise<void> {
    const parsed = this.spec.parse(record);
    if (!parsed) throw new Error(`Invalid ${this.spec.label} record`);
    const ttlMs = Math.max(1, parsed.expiresAtMs - Date.now());
    await this.records.set(`${this.prefix}${parsed.challengeId}`, parsed, ttlMs);
  }

  async consume(challengeId: string): Promise<R | null> {
    const id = toOptionalTrimmedString(challengeId);
    if (!id) return null;
    const record = await this.records.take(`${this.prefix}${id}`);
    if (!record) return null;
    if (Date.now() > record.expiresAtMs) return null;
    return record;
  }

  async del(challengeId: string): Promise<void> {
    const id = toOptionalTrimmedString(challengeId);
    if (!id) return;
    await this.records.del(`${this.prefix}${id}`);
  }
}

export class D1WebAuthnChallengeStore<R extends WebAuthnChallengeRecord>
  implements WebAuthnChallengeStore<R>
{
  readonly adapterKind = 'd1';
  private readonly table: D1TenantTable;
  private readonly now: () => Date;

  constructor(
    input: D1WebAuthnChallengeStoreOptions,
    private readonly spec: WebAuthnChallengeStoreSpec<R>,
  ) {
    this.table = new D1TenantTable(
      input,
      webAuthnD1Store(spec.d1ScopeLabel),
      WEBAUTHN_CHALLENGE_STORE_D1_SCHEMA_SQL,
    );
    this.now = input.now || (() => new Date());
  }

  async put(record: R): Promise<void> {
    await this.table.ensureSchema();
    const parsed = this.spec.parse(record);
    if (!parsed) throw new Error(`Invalid ${this.spec.label} record`);
    await this.table
      .prepare(
        `INSERT INTO webauthn_challenges (
          namespace,
          org_id,
          project_id,
          env_id,
          challenge_id,
          challenge_kind,
          record_json,
          created_at_ms,
          expires_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (namespace, org_id, project_id, env_id, challenge_id)
        DO UPDATE SET
          challenge_kind = EXCLUDED.challenge_kind,
          record_json = EXCLUDED.record_json,
          created_at_ms = EXCLUDED.created_at_ms,
          expires_at_ms = EXCLUDED.expires_at_ms`,
        [
          parsed.challengeId,
          this.spec.challengeKind,
          JSON.stringify(parsed),
          parsed.createdAtMs,
          parsed.expiresAtMs,
        ],
      )
      .run();
  }

  async consume(challengeId: string): Promise<R | null> {
    await this.table.ensureSchema();
    const id = toOptionalTrimmedString(challengeId);
    if (!id) return null;
    const row = await this.table
      .prepare(
        `DELETE FROM webauthn_challenges
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND challenge_id = ?
            AND challenge_kind = ?
            AND expires_at_ms > ?
          RETURNING record_json`,
        [id, this.spec.challengeKind, this.now().getTime()],
      )
      .first<{ readonly record_json?: unknown }>();
    return this.spec.parse(parseD1JsonColumn(row?.record_json));
  }

  async del(challengeId: string): Promise<void> {
    await this.table.ensureSchema();
    const id = toOptionalTrimmedString(challengeId);
    if (!id) return;
    await this.table
      .prepare(
        `DELETE FROM webauthn_challenges
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND challenge_id = ?
            AND challenge_kind = ?`,
        [id, this.spec.challengeKind],
      )
      .run();
  }
}
