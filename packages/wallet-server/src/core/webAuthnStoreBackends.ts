import type { NormalizedLogger } from './logger';
import type {
  CloudflareDurableObjectNamespaceLike,
  CloudflareDurableObjectStubLike,
  ThresholdStoreConfigInput,
} from './types';
import { THRESHOLD_DO_OBJECT_NAME_DEFAULT, THRESHOLD_PREFIX_DEFAULT } from './defaultConfigsServer';
import { isObject, toOptionalTrimmedString } from '@shared/utils/validation';
import {
  RedisTcpClient,
  UpstashRedisRestClient,
  redisDel,
  redisGetJson,
  redisGetdelJson,
  redisSetJson,
} from './ThresholdService/kv';
import { toPrefixWithColon } from './ThresholdService/validation';
import {
  formatD1ExecStatement,
  parseD1JsonColumn,
  resolveD1DatabaseFromConfig,
} from '../storage/d1Sql';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../storage/tenantRoute';

export type WebAuthnStoreInput = {
  config?: ThresholdStoreConfigInput | null;
  logger: NormalizedLogger;
  isNode: boolean;
};

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
  readonly d1: (options: D1WebAuthnStoreOptions) => S;
  /** Upstash REST, Redis TCP and Durable Object backends. */
  readonly keyValue: (records: WebAuthnRecords<R>, prefix: string) => S;
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
  const explicit = toOptionalTrimmedString(config[spec.prefixConfigKey]);
  if (explicit) return toPrefixWithColon(explicit, '');

  const base = toOptionalTrimmedString(config.THRESHOLD_PREFIX) || THRESHOLD_PREFIX_DEFAULT;
  const baseWithColon = toPrefixWithColon(base, `${THRESHOLD_PREFIX_DEFAULT}:`);
  return `${baseWithColon}webauthn:${spec.prefixName}:`;
}

/**
 * Selects a WebAuthn store's backend: the config's explicit `kind`, else Upstash or Redis from
 * env-shaped config, else in memory. The store type `S` comes from the caller's return type.
 */
export function createWebAuthnStore<R, S>(
  input: WebAuthnStoreInput,
  spec: WebAuthnStoreSpec<R>,
  build: WebAuthnStoreBuilders<R, NoInfer<S>>,
): S {
  const { label, connectionErrorSubject, parse } = spec;
  const config = (isObject(input.config) ? input.config : {}) as Record<string, unknown>;
  const prefix = resolveWebAuthnStorePrefix(config, spec);
  const inMemory = () => build.inMemory(new InMemoryWebAuthnRecords<R>(), prefix);
  const upstash = (url: string, token: string) =>
    build.keyValue(upstashRecords(new UpstashRedisRestClient({ url, token }), parse), prefix);
  const redisTcp = (redisUrl: string) =>
    build.keyValue(redisTcpRecords(new RedisTcpClient(redisUrl), parse), prefix);

  const kind = toOptionalTrimmedString(config.kind);
  if (kind === 'd1') {
    const database = resolveD1DatabaseFromConfig(config);
    if (!database) {
      throw new Error(`[webauthn] D1 ${label} store selected but no D1 database was provided`);
    }
    input.logger.info(`[webauthn] Using D1 ${label} store`);
    const scope = requireWebAuthnD1Scope(
      {
        namespace: prefix,
        orgId: config.orgId || config.ORG_ID,
        projectId: config.projectId || config.PROJECT_ID,
        envId: config.envId || config.ENV_ID,
      },
      spec.d1ScopeLabel,
    );
    return build.d1({ database, ...scope });
  }
  if (kind === 'cloudflare-do') {
    const namespace = resolveDoNamespaceFromConfig(config);
    if (!namespace) {
      throw new Error(
        'cloudflare-do webauthn store selected but no Durable Object namespace was provided (expected config.namespace)',
      );
    }
    const objectName =
      toOptionalTrimmedString(config.objectName) ||
      toOptionalTrimmedString(config.name) ||
      THRESHOLD_DO_OBJECT_NAME_DEFAULT;
    input.logger.info(
      `[webauthn] Using Cloudflare Durable Object store for ${spec.durableObjectLogSubject}`,
    );
    return build.keyValue(durableObjectRecords(namespace, objectName, parse), prefix);
  }

  if (kind === 'in-memory') {
    input.logger.info(`[webauthn] Using in-memory ${label} store (non-persistent)`);
    return inMemory();
  }

  if (kind === 'upstash-redis-rest') {
    const url =
      toOptionalTrimmedString(config.url) || toOptionalTrimmedString(config.UPSTASH_REDIS_REST_URL);
    const token =
      toOptionalTrimmedString(config.token) ||
      toOptionalTrimmedString(config.UPSTASH_REDIS_REST_TOKEN);
    if (!url || !token) {
      throw new Error(`Upstash ${connectionErrorSubject} enabled but url/token are not both set`);
    }
    input.logger.info(`[webauthn] Using Upstash REST ${label} store`);
    return upstash(url, token);
  }

  if (kind === 'redis-tcp') {
    if (!input.isNode) {
      input.logger.warn(
        `[webauthn] redis-tcp ${label} store is not supported in this runtime; falling back to in-memory`,
      );
      return inMemory();
    }
    const redisUrl =
      toOptionalTrimmedString(config.redisUrl) || toOptionalTrimmedString(config.REDIS_URL);
    if (!redisUrl) {
      throw new Error(`redis-tcp ${connectionErrorSubject} enabled but redisUrl is not set`);
    }
    input.logger.info(`[webauthn] Using redis-tcp ${label} store`);
    return redisTcp(redisUrl);
  }

  if (kind) throw new Error(`[webauthn] Unknown ${label} store kind: ${kind}`);

  // Env-shaped config: prefer Redis/Upstash.
  const upstashUrl = toOptionalTrimmedString(config.UPSTASH_REDIS_REST_URL);
  const upstashToken = toOptionalTrimmedString(config.UPSTASH_REDIS_REST_TOKEN);
  if (upstashUrl || upstashToken) {
    if (!upstashUrl || !upstashToken) {
      throw new Error(
        `Upstash ${connectionErrorSubject} enabled but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not both set`,
      );
    }
    input.logger.info(`[webauthn] Using Upstash REST ${label} store`);
    return upstash(upstashUrl, upstashToken);
  }

  const redisUrl = toOptionalTrimmedString(config.REDIS_URL);
  if (redisUrl) {
    if (!input.isNode) {
      input.logger.warn(
        '[webauthn] REDIS_URL is set but TCP Redis is not supported in this runtime; falling back to in-memory',
      );
      return inMemory();
    }
    input.logger.info(`[webauthn] Using redis-tcp ${label} store`);
    return redisTcp(redisUrl);
  }

  input.logger.info(`[webauthn] Using in-memory ${label} store (${spec.unconfiguredNote})`);
  return inMemory();
}

/** A store's records in a key-value backend, under keys the store builds. */
export interface WebAuthnRecords<R> {
  get(key: string): Promise<R | null>;
  /** Reads and deletes, so a one-time record is used at most once. */
  take(key: string): Promise<R | null>;
  set(key: string, record: R, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** Keeps each record as it was put, without expiry; reads return the stored object. */
export class InMemoryWebAuthnRecords<R> implements WebAuthnRecords<R> {
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

// Remote backends hold JSON; a value that does not parse reads as missing.

function upstashRecords<R>(
  client: UpstashRedisRestClient,
  parse: (raw: unknown) => R | null,
): WebAuthnRecords<R> {
  return {
    get: async (key) => parse(await client.getJson(key)),
    take: async (key) => parse(await client.getdelJson(key)),
    set: (key, record, ttlMs) => client.setJson(key, record, ttlMs),
    del: (key) => client.del(key),
  };
}

function redisTcpRecords<R>(
  client: RedisTcpClient,
  parse: (raw: unknown) => R | null,
): WebAuthnRecords<R> {
  return {
    get: async (key) => parse(await redisGetJson(client, key)),
    take: async (key) => parse(await redisGetdelJson(client, key)),
    set: (key, record, ttlMs) => redisSetJson(client, key, record, ttlMs),
    del: (key) => redisDel(client, key),
  };
}

type DoResp<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

type DoRequest =
  | { op: 'get' | 'getdel' | 'del'; key: string }
  | { op: 'set'; key: string; value: unknown; ttlMs?: number };

function isDurableObjectNamespaceLike(v: unknown): v is CloudflareDurableObjectNamespaceLike {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as CloudflareDurableObjectNamespaceLike).idFromName === 'function' &&
    typeof (v as CloudflareDurableObjectNamespaceLike).get === 'function'
  );
}

function resolveDoNamespaceFromConfig(
  config: Record<string, unknown>,
): CloudflareDurableObjectNamespaceLike | null {
  const candidates = [
    config.namespace,
    config.durableObjectNamespace,
    config.THRESHOLD_DO_NAMESPACE,
  ];
  return candidates.find(isDurableObjectNamespaceLike) ?? null;
}

async function callDo<T>(
  stub: CloudflareDurableObjectStubLike,
  req: DoRequest,
): Promise<DoResp<T>> {
  const resp = await stub.fetch('https://threshold-store.invalid/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`WebAuthn DO store HTTP ${resp.status}: ${text}`);
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`WebAuthn DO store returned non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!isObject(json)) {
    throw new Error('WebAuthn DO store returned invalid JSON shape');
  }
  if (json.ok === true) return json as DoResp<T>;
  const code = toOptionalTrimmedString(json.code);
  const message = toOptionalTrimmedString(json.message);
  return { ok: false, code: code || 'internal', message: message || 'WebAuthn DO store error' };
}

function durableObjectRecords<R>(
  namespace: CloudflareDurableObjectNamespaceLike,
  objectName: string,
  parse: (raw: unknown) => R | null,
): WebAuthnRecords<R> {
  const stub = namespace.get(namespace.idFromName(objectName));
  const read = async (op: 'get' | 'getdel', key: string) => {
    const resp = await callDo<unknown>(stub, { op, key });
    return parse(resp.ok ? resp.value : null);
  };
  const write = async (req: DoRequest) => {
    const resp = await callDo<void>(stub, req);
    if (!resp.ok) throw new Error(resp.message);
  };
  return {
    get: (key) => read('get', key),
    take: (key) => read('getdel', key),
    set: (key, record, ttlMs) => write({ op: 'set', key, value: record, ttlMs }),
    del: (key) => write({ op: 'del', key }),
  };
}

/**
 * Per-credential records under `${prefix}${ownerId}:${credentialIdB64u}`, where the owner is the
 * user for authenticators and the RP ID for credential bindings. A blank id reads as missing.
 */
export class WebAuthnCredentialRecords<R> {
  constructor(
    private readonly records: WebAuthnRecords<R>,
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

export interface D1WebAuthnStoreSchemaOptions {
  readonly database: D1DatabaseLike;
}

export interface D1WebAuthnStoreOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
  readonly ensureSchema?: boolean;
}

/** The tenant scope that leads the key of every WebAuthn table. */
export type WebAuthnD1Scope = {
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
};

function requireWebAuthnD1Scope(
  input: { readonly [K in keyof WebAuthnD1Scope]: unknown },
  label: string,
): WebAuthnD1Scope {
  const field = (value: unknown, name: string): string => {
    const normalized = toOptionalTrimmedString(value);
    if (!normalized) throw new Error(`${name} is required for D1 WebAuthn ${label} store`);
    return normalized;
  };
  return {
    namespace: field(input.namespace, 'namespace'),
    orgId: field(input.orgId, 'orgId'),
    projectId: field(input.projectId, 'projectId'),
    envId: field(input.envId, 'envId'),
  };
}

export async function ensureWebAuthnD1Schema(
  database: D1DatabaseLike,
  statements: readonly string[],
): Promise<void> {
  for (const statement of statements) {
    await database.exec(formatD1ExecStatement(statement));
  }
}

/** Prepares `sql` with the scope bound to its first four parameters and `values` after them. */
export function prepareWebAuthnD1Statement(
  database: D1DatabaseLike,
  scope: WebAuthnD1Scope,
  sql: string,
  ...values: unknown[]
): D1PreparedStatementLike {
  return database
    .prepare(sql)
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, ...values);
}

/**
 * A store's D1 table in one tenant scope. The store's schema is created on first use unless the
 * caller manages it (`ensureSchema: false`).
 */
export class WebAuthnD1Table {
  readonly database: D1DatabaseLike;
  readonly scope: WebAuthnD1Scope;
  private readonly ensureSchemaOnUse: boolean;
  private schemaReady = false;

  constructor(
    input: D1WebAuthnStoreOptions,
    label: string,
    private readonly schema: readonly string[],
  ) {
    this.database = input.database;
    this.scope = requireWebAuthnD1Scope(input, label);
    this.ensureSchemaOnUse = input.ensureSchema !== false;
  }

  async ensureSchema(): Promise<void> {
    if (!this.ensureSchemaOnUse || this.schemaReady) return;
    await ensureWebAuthnD1Schema(this.database, this.schema);
    this.schemaReady = true;
  }

  prepare(sql: string, ...values: unknown[]): D1PreparedStatementLike {
    return prepareWebAuthnD1Statement(this.database, this.scope, sql, ...values);
  }
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

export interface D1WebAuthnChallengeStoreOptions extends D1WebAuthnStoreOptions {
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
  options: D1WebAuthnStoreSchemaOptions,
): Promise<void> {
  await ensureWebAuthnD1Schema(options.database, WEBAUTHN_CHALLENGE_STORE_D1_SCHEMA_SQL);
}

export function createWebAuthnChallengeStore<R extends WebAuthnChallengeRecord>(
  input: WebAuthnStoreInput,
  spec: WebAuthnChallengeStoreSpec<R>,
  d1: (options: D1WebAuthnStoreOptions) => WebAuthnChallengeStore<R>,
): WebAuthnChallengeStore<R> {
  const keyValue = (records: WebAuthnRecords<R>, prefix: string): WebAuthnChallengeStore<R> =>
    new KeyValueWebAuthnChallengeStore(records, prefix, spec);
  return createWebAuthnStore(input, spec, { d1, keyValue, inMemory: keyValue });
}

class KeyValueWebAuthnChallengeStore<R extends WebAuthnChallengeRecord>
  implements WebAuthnChallengeStore<R>
{
  constructor(
    private readonly records: WebAuthnRecords<R>,
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
  private readonly table: WebAuthnD1Table;
  private readonly now: () => Date;

  constructor(
    input: D1WebAuthnChallengeStoreOptions,
    private readonly spec: WebAuthnChallengeStoreSpec<R>,
  ) {
    this.table = new WebAuthnD1Table(
      input,
      spec.d1ScopeLabel,
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
        parsed.challengeId,
        this.spec.challengeKind,
        JSON.stringify(parsed),
        parsed.createdAtMs,
        parsed.expiresAtMs,
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
        id,
        this.spec.challengeKind,
        this.now().getTime(),
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
        id,
        this.spec.challengeKind,
      )
      .run();
  }
}
