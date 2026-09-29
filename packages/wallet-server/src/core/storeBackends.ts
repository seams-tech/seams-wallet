// The backends a core store can use besides D1 (a Cloudflare Durable Object, Upstash's REST API,
// Redis over TCP, or memory) and how a store config picks one.
import type { NormalizedLogger } from './logger';
import type {
  CloudflareDurableObjectNamespaceLike,
  CloudflareDurableObjectStubLike,
  ThresholdStoreConfigInput,
} from './types';
import { THRESHOLD_DO_OBJECT_NAME_DEFAULT } from './defaultConfigsServer';
import { isObject, isPlainObject, toOptionalTrimmedString } from '@shared/utils/validation';
import {
  RedisTcpClient,
  UpstashRedisRestClient,
  redisDel,
  redisGetJson,
  redisGetdelJson,
  redisSetJson,
} from './ThresholdService/kv';
import { resolveD1DatabaseFromConfig } from '../storage/d1Sql';
import { d1TenantScopeFromConfig, type D1TenantStoreOptions } from './d1TenantStore';

export type StoreFactoryInput = {
  config?: ThresholdStoreConfigInput | null;
  logger: NormalizedLogger;
  isNode: boolean;
};

// ---- Durable Objects ------------------------------------------------------------------------

function isDurableObjectNamespaceLike(
  value: unknown,
): value is CloudflareDurableObjectNamespaceLike {
  return (
    isPlainObject(value) &&
    typeof value.idFromName === 'function' &&
    typeof value.get === 'function'
  );
}

/** The first of `namespace`, `durableObjectNamespace` and `THRESHOLD_DO_NAMESPACE` that is one. */
export function resolveDurableObjectNamespace(
  config: Record<string, unknown>,
): CloudflareDurableObjectNamespaceLike | null {
  const direct = config.namespace;
  if (isDurableObjectNamespaceLike(direct)) return direct;
  const alt = config.durableObjectNamespace;
  if (isDurableObjectNamespaceLike(alt)) return alt;
  const envStyle = config.THRESHOLD_DO_NAMESPACE;
  if (isDurableObjectNamespaceLike(envStyle)) return envStyle;
  return null;
}

/** The object a store config names: `objectName`, else `name`, else the default. */
export function durableObjectName(config: Record<string, unknown>): string {
  return (
    toOptionalTrimmedString(config.objectName) ||
    toOptionalTrimmedString(config.name) ||
    THRESHOLD_DO_OBJECT_NAME_DEFAULT
  );
}

export function durableObjectStub(
  namespace: CloudflareDurableObjectNamespaceLike,
  objectName: string,
): CloudflareDurableObjectStubLike {
  return namespace.get(namespace.idFromName(objectName));
}

/** Posts one JSON request to a store's Durable Object. */
export function postDurableObjectRequest(
  stub: CloudflareDurableObjectStubLike,
  body: unknown,
): Promise<Response> {
  return stub.fetch('https://threshold-store.invalid/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Posts a request and parses the object's JSON reply; an empty reply reads as null. An HTTP error
 * or a reply that is not JSON throws, naming the store: `<storeName> DO store …`.
 */
export async function requestDurableObjectJson(
  stub: CloudflareDurableObjectStubLike,
  body: unknown,
  storeName: string,
): Promise<unknown> {
  const resp = await postDurableObjectRequest(stub, body);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`${storeName} DO store HTTP ${resp.status}: ${text}`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${storeName} DO store returned non-JSON response: ${text.slice(0, 200)}`);
  }
}

type DoResp<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

type DoRequest =
  | { op: 'get' | 'getdel' | 'del'; key: string }
  | { op: 'set'; key: string; value: unknown; ttlMs?: number };

async function callDo<T>(
  stub: CloudflareDurableObjectStubLike,
  req: DoRequest,
  storeName: string,
): Promise<DoResp<T>> {
  const json = await requestDurableObjectJson(stub, req, storeName);
  if (!isObject(json)) {
    throw new Error(`${storeName} DO store returned invalid JSON shape`);
  }
  if (json.ok === true) return json as DoResp<T>;
  const code = toOptionalTrimmedString(json.code);
  const message = toOptionalTrimmedString(json.message);
  return { ok: false, code: code || 'internal', message: message || `${storeName} DO store error` };
}

// ---- Key-value records ----------------------------------------------------------------------

/** A store's records in a key-value backend, under keys the store builds. */
export interface KeyValueRecords<R> {
  get(key: string): Promise<R | null>;
  /** Reads and deletes, so a one-time record is used at most once. */
  take(key: string): Promise<R | null>;
  set(key: string, record: R, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
}

// Remote backends hold JSON; a value that does not parse reads as missing.

function upstashRecords<R>(
  client: UpstashRedisRestClient,
  parse: (raw: unknown) => R | null,
): KeyValueRecords<R> {
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
): KeyValueRecords<R> {
  return {
    get: async (key) => parse(await redisGetJson(client, key)),
    take: async (key) => parse(await redisGetdelJson(client, key)),
    set: (key, record, ttlMs) => redisSetJson(client, key, record, ttlMs),
    del: (key) => redisDel(client, key),
  };
}

function durableObjectRecords<R>(
  stub: CloudflareDurableObjectStubLike,
  parse: (raw: unknown) => R | null,
  storeName: string,
): KeyValueRecords<R> {
  const read = async (op: 'get' | 'getdel', key: string) => {
    const resp = await callDo<unknown>(stub, { op, key }, storeName);
    return parse(resp.ok ? resp.value : null);
  };
  const write = async (req: DoRequest) => {
    const resp = await callDo<void>(stub, req, storeName);
    if (!resp.ok) throw new Error(resp.message);
  };
  return {
    get: (key) => read('get', key),
    take: (key) => read('getdel', key),
    set: (key, record, ttlMs) => write({ op: 'set', key, value: record, ttlMs }),
    del: (key) => write({ op: 'del', key }),
  };
}

// ---- Backend selection ----------------------------------------------------------------------

/** How a key-value store names itself in the log lines and errors of its backend selection. */
export type KeyValueStoreSpec<R> = {
  /** Tags log lines, `[<tag>] …`, and names the store in Durable Object namespace errors. */
  readonly tag: string;
  /** Names the store in log lines and in D1, Upstash and Redis errors, e.g. `login challenge`. */
  readonly label: string;
  /** Names the store in missing-connection errors, e.g. `webauthn store`. */
  readonly connectionErrorSubject: string;
  /** Ends the Durable Object log line, after `Using Cloudflare Durable Object `. */
  readonly durableObjectLog: string;
  /** Leads Durable Object request errors, as in `<name> DO store HTTP 500`. */
  readonly durableObjectErrorName: string;
  /** Qualifies the in-memory fallback's log line when nothing is configured. */
  readonly unconfiguredNote: string;
  /** Names the store in D1 scope errors. */
  readonly d1StoreName: string;
  /** The store's key prefix, which is also its D1 namespace. */
  readonly resolvePrefix: (config: Record<string, unknown>) => string;
  /** Validates a record read back from a remote backend; null when it is invalid. */
  readonly parse: (raw: unknown) => R | null;
};

/** Builds the store for the backend the config selects. */
type KeyValueStoreBuilders<R, S> = {
  readonly d1: (options: D1TenantStoreOptions) => S;
  /** Upstash REST, Redis TCP and Durable Object backends. */
  readonly keyValue: (records: KeyValueRecords<R>, prefix: string) => S;
  readonly inMemory: (prefix: string) => S;
};

/**
 * Selects a key-value store's backend: the config's explicit `kind`, else Upstash or Redis from
 * env-shaped config, else in memory. The store type `S` comes from the caller's return type.
 */
export function createKeyValueStore<R, S>(
  input: StoreFactoryInput,
  spec: KeyValueStoreSpec<R>,
  build: KeyValueStoreBuilders<R, NoInfer<S>>,
): S {
  const { tag, label, connectionErrorSubject, parse } = spec;
  const config = (isObject(input.config) ? input.config : {}) as Record<string, unknown>;
  const prefix = spec.resolvePrefix(config);
  const inMemory = () => build.inMemory(prefix);
  const upstash = (url: string, token: string) =>
    build.keyValue(upstashRecords(new UpstashRedisRestClient({ url, token }), parse), prefix);
  const redisTcp = (redisUrl: string) =>
    build.keyValue(redisTcpRecords(new RedisTcpClient(redisUrl), parse), prefix);

  const kind = toOptionalTrimmedString(config.kind);
  if (kind === 'd1') {
    const database = resolveD1DatabaseFromConfig(config);
    if (!database) {
      throw new Error(`[${tag}] D1 ${label} store selected but no D1 database was provided`);
    }
    input.logger.info(`[${tag}] Using D1 ${label} store`);
    const scope = d1TenantScopeFromConfig(config, prefix, spec.d1StoreName);
    return build.d1({ database, ...scope });
  }
  if (kind === 'cloudflare-do') {
    const namespace = resolveDurableObjectNamespace(config);
    if (!namespace) {
      throw new Error(
        `cloudflare-do ${tag} store selected but no Durable Object namespace was provided (expected config.namespace)`,
      );
    }
    const objectName = durableObjectName(config);
    input.logger.info(`[${tag}] Using Cloudflare Durable Object ${spec.durableObjectLog}`);
    const stub = durableObjectStub(namespace, objectName);
    return build.keyValue(durableObjectRecords(stub, parse, spec.durableObjectErrorName), prefix);
  }

  if (kind === 'in-memory') {
    input.logger.info(`[${tag}] Using in-memory ${label} store (non-persistent)`);
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
    input.logger.info(`[${tag}] Using Upstash REST ${label} store`);
    return upstash(url, token);
  }

  if (kind === 'redis-tcp') {
    if (!input.isNode) {
      input.logger.warn(
        `[${tag}] redis-tcp ${label} store is not supported in this runtime; falling back to in-memory`,
      );
      return inMemory();
    }
    const redisUrl =
      toOptionalTrimmedString(config.redisUrl) || toOptionalTrimmedString(config.REDIS_URL);
    if (!redisUrl) {
      throw new Error(`redis-tcp ${connectionErrorSubject} enabled but redisUrl is not set`);
    }
    input.logger.info(`[${tag}] Using redis-tcp ${label} store`);
    return redisTcp(redisUrl);
  }

  if (kind) throw new Error(`[${tag}] Unknown ${label} store kind: ${kind}`);

  // Env-shaped config: prefer Redis/Upstash.
  const upstashUrl = toOptionalTrimmedString(config.UPSTASH_REDIS_REST_URL);
  const upstashToken = toOptionalTrimmedString(config.UPSTASH_REDIS_REST_TOKEN);
  if (upstashUrl || upstashToken) {
    if (!upstashUrl || !upstashToken) {
      throw new Error(
        `Upstash ${connectionErrorSubject} enabled but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not both set`,
      );
    }
    input.logger.info(`[${tag}] Using Upstash REST ${label} store`);
    return upstash(upstashUrl, upstashToken);
  }

  const redisUrl = toOptionalTrimmedString(config.REDIS_URL);
  if (redisUrl) {
    if (!input.isNode) {
      input.logger.warn(
        `[${tag}] REDIS_URL is set but TCP Redis is not supported in this runtime; falling back to in-memory`,
      );
      return inMemory();
    }
    input.logger.info(`[${tag}] Using redis-tcp ${label} store`);
    return redisTcp(redisUrl);
  }

  input.logger.info(`[${tag}] Using in-memory ${label} store (${spec.unconfiguredNote})`);
  return inMemory();
}

/** How a store on D1, a Durable Object or memory names itself in its selection's logs and errors. */
export type DurableObjectStoreSpec = {
  /** Tags log lines and D1 errors, `[<tag>] …`. */
  readonly tag: string;
  /** Names the store in kind errors, e.g. `wallet` in `Unknown wallet store kind`. */
  readonly name: string;
  /** The in-memory fallback's log line, after the tag. */
  readonly inMemoryLog: string;
  /** Names the store in D1 scope errors. */
  readonly d1StoreName: string;
  /** The store's key prefix, which is also its D1 namespace. */
  readonly resolvePrefix: (config: Record<string, unknown>) => string;
};

type DurableObjectStoreBuilders<S> = {
  readonly d1: (options: D1TenantStoreOptions) => S;
  readonly durableObject: (stub: CloudflareDurableObjectStubLike, prefix: string) => S;
  readonly inMemory: (prefix: string) => S;
};

/** Selects the backend the config's `kind` names: D1, a Durable Object, or else memory. */
export function createDurableObjectStore<S>(
  input: StoreFactoryInput,
  spec: DurableObjectStoreSpec,
  build: DurableObjectStoreBuilders<NoInfer<S>>,
): S {
  const { tag } = spec;
  const config = (isPlainObject(input.config) ? input.config : {}) as Record<string, unknown>;
  const prefix = spec.resolvePrefix(config);
  const kind = toOptionalTrimmedString(config.kind);
  if (kind === 'd1') {
    const database = resolveD1DatabaseFromConfig(config);
    if (!database) {
      throw new Error(`[${tag}] D1 store selected but no D1 database was provided`);
    }
    input.logger.info(`[${tag}] Using D1 store`);
    return build.d1({
      database,
      ...d1TenantScopeFromConfig(config, prefix, spec.d1StoreName),
    });
  }
  if (kind === 'cloudflare-do') {
    const namespace = resolveDurableObjectNamespace(config);
    if (!namespace) {
      throw new Error(
        `cloudflare-do ${spec.name} store selected but no Durable Object namespace was provided`,
      );
    }
    const objectName = durableObjectName(config);
    input.logger.info(`[${tag}] Using Cloudflare Durable Object store`);
    return build.durableObject(durableObjectStub(namespace, objectName), prefix);
  }
  if (kind) throw new Error(`[${tag}] Unknown ${spec.name} store kind: ${kind}`);
  input.logger.info(`[${tag}] ${spec.inMemoryLog}`);
  return build.inMemory(prefix);
}
