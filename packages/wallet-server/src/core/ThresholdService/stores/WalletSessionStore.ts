import type { NormalizedLogger } from '../../logger';
import type {
  ThresholdEd25519AuthorityScope,
  ThresholdEcdsaSigningRootMetadata,
  ThresholdStoreConfigInput,
} from '../../types';
import { RedisTcpClient, UpstashRedisRestClient, redisGetJson, redisSetJson } from '../kv';
import {
  EXPORT_REPLAY_GUARD_CLOCK_SKEW_MS,
  EXPORT_REPLAY_GUARD_MIN_RETENTION_MS,
} from './exportReplayGuard';
import { toOptionalTrimmedString, isPlainObject } from '@shared/utils/validation';
import {
  WALLET_SESSION_FAILURE_CODES,
  type WalletSessionFailureCode,
} from '@shared/utils/walletSessionFailure';
import { failure } from '@shared/utils/failure';
import {
  toThresholdEcdsaWalletSessionPrefix,
  toThresholdEcdsaPrefixFromBase,
  toThresholdEd25519WalletSessionPrefix,
  toThresholdEd25519PrefixFromBase,
  parseEd25519WalletSessionRecord,
  parseEcdsaWalletSessionRecord,
} from '../validation';
import {
  createCloudflareDurableObjectThresholdEcdsaStores,
  createCloudflareDurableObjectThresholdEd25519Stores,
} from './CloudflareDurableObjectStore';
import { readNonDurableObjectThresholdStoreKind } from './StoreConfig';
import type { EcdsaKeyHandle } from '../../keyMaterialBrands';

export type Ed25519WalletSessionRecord = {
  expiresAtMs: number;
  relayerKeyId: string;
  userId: string;
  walletId: string;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  authorityScope: ThresholdEd25519AuthorityScope;
  participantIds: number[];
} & Partial<ThresholdEcdsaSigningRootMetadata>;

export type EcdsaWalletSessionRecordCore = {
  expiresAtMs: number;
  relayerKeyId: string;
  walletId: string;
  keyHandle: EcdsaKeyHandle;
  participantIds: number[];
};

export type EcdsaWalletSessionRecord = EcdsaWalletSessionRecordCore &
  (
    | {
        signingRootId?: never;
        signingRootVersion?: never;
        walletKeyVersion?: never;
        derivationVersion?: never;
      }
    | ThresholdEcdsaSigningRootMetadata
  );

export type WalletSessionRecord = Ed25519WalletSessionRecord | EcdsaWalletSessionRecord;

export type WalletSessionConsumeUsesResult =
  | { ok: true; remainingUses: number }
  | { ok: false; code: string; message: string };

type WalletSessionConsumedUseResult =
  | { ok: true; consumed: boolean }
  | { ok: false; code: string; message: string };

export type WalletSessionReplayGuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export type WalletSessionStatus<TRecord extends WalletSessionRecord> = {
  record: TRecord;
  expiresAtMs: number;
  remainingUses: number;
};

export type WalletSessionStatusLookupResult<TRecord extends WalletSessionRecord> =
  | { ok: true; status: WalletSessionStatus<TRecord> }
  | {
      ok: false;
      code: Extract<
        WalletSessionFailureCode,
        | typeof WALLET_SESSION_FAILURE_CODES.missing
        | typeof WALLET_SESSION_FAILURE_CODES.expired
        | typeof WALLET_SESSION_FAILURE_CODES.unavailable
      >;
    };

type WalletSessionStoreConfigRecord = Record<string, unknown>;

export interface WalletSessionStore<TRecord extends WalletSessionRecord> {
  putSession(
    id: string,
    record: TRecord,
    opts: { ttlMs: number; remainingUses: number },
  ): Promise<void>;
  getSession(id: string): Promise<TRecord | null>;
  getSessionStatus(id: string): Promise<WalletSessionStatusLookupResult<TRecord>>;
  /**
   * Consume one use from the session counter without fetching the session record.
   *
   * This enables session-token-only authorization flows where scope/expiry are enforced from
   * signed JWT claims instead of a KV-stored record, reducing KV read-after-write consistency issues.
   */
  consumeUseCount(id: string): Promise<WalletSessionConsumeUsesResult>;
  consumeUseCountOnce(id: string, idempotencyKey: string): Promise<WalletSessionConsumeUsesResult>;
  hasConsumedUseCountOnce(
    id: string,
    idempotencyKey: string,
  ): Promise<WalletSessionConsumedUseResult>;
  reserveReplayGuard(
    scopeId: string,
    replayKey: string,
    expiresAtMs: number,
  ): Promise<WalletSessionReplayGuardResult>;
}

export type Ed25519WalletSessionStore = WalletSessionStore<Ed25519WalletSessionRecord>;
export type EcdsaWalletSessionStore = WalletSessionStore<EcdsaWalletSessionRecord>;
export type WalletSessionRecordParser<TRecord extends WalletSessionRecord> = (
  raw: unknown,
) => TRecord | null;

/** A wallet session store's keys: record, use counter, consume-once markers, replay guards. */
class WalletSessionKeys {
  private readonly prefix: string;

  constructor(keyPrefix: string | undefined) {
    this.prefix = toThresholdEd25519WalletSessionPrefix(keyPrefix);
  }

  meta(id: string): string {
    return `${this.prefix}${id}`;
  }

  uses(id: string): string {
    return `${this.prefix}${id}:uses`;
  }

  consumeOnce(id: string, idempotencyKey: string): string {
    return `${this.uses(id)}:once:${normalizeConsumeOnceKey(idempotencyKey)}`;
  }

  replayGuard(scopeId: string, replayKey: string): string {
    return `${this.prefix}replay:${normalizeConsumeOnceKey(scopeId)}:${normalizeConsumeOnceKey(replayKey)}`;
  }
}

type WalletSessionStoreFailure = { ok: false; code: string; message: string };

type InMemoryWalletSessionEntry<TRecord extends WalletSessionRecord> = {
  record: TRecord;
  remainingUses: number;
  expiresAtMs: number;
  consumedIdempotencyKeys: Set<string>;
};

class InMemoryWalletSessionStore<
  TRecord extends WalletSessionRecord,
> implements WalletSessionStore<TRecord> {
  private readonly keys: WalletSessionKeys;
  private readonly map = new Map<string, InMemoryWalletSessionEntry<TRecord>>();
  private readonly replayGuards = new Map<string, number>();

  constructor(input: { keyPrefix?: string }) {
    this.keys = new WalletSessionKeys(input.keyPrefix);
  }

  /** The session's entry, or why it cannot be used: missing, or expired (and dropped). */
  private liveEntry(id: string): InMemoryWalletSessionEntry<TRecord> | WalletSessionStoreFailure {
    const key = this.keys.meta(id);
    const entry = this.map.get(key);
    if (!entry) {
      return failure('wallet_session_missing', 'Wallet Session is missing');
    }
    if (entry.expiresAtMs <= Date.now()) {
      this.map.delete(key);
      return failure('wallet_session_expired', 'Wallet Session expired');
    }
    return entry;
  }

  async putSession(
    id: string,
    record: TRecord,
    opts: { ttlMs: number; remainingUses: number },
  ): Promise<void> {
    const key = this.keys.meta(id);
    const ttlMs = Math.max(0, Number(opts.ttlMs) || 0);
    const expiresAtMs = Date.now() + ttlMs;
    this.map.set(key, {
      record,
      remainingUses: Math.max(0, Number(opts.remainingUses) || 0),
      expiresAtMs,
      consumedIdempotencyKeys: new Set(),
    });
  }

  async getSession(id: string): Promise<TRecord | null> {
    const key = this.keys.meta(id);
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.record;
  }

  async getSessionStatus(id: string): Promise<WalletSessionStatusLookupResult<TRecord>> {
    const key = this.keys.meta(id);
    const entry = this.map.get(key);
    if (!entry) return { ok: false, code: 'wallet_session_missing' };
    if (entry.expiresAtMs <= Date.now()) {
      this.map.delete(key);
      return { ok: false, code: 'wallet_session_expired' };
    }
    return {
      ok: true,
      status: {
        record: entry.record,
        expiresAtMs: entry.expiresAtMs,
        remainingUses: entry.remainingUses,
      },
    };
  }

  async consumeUseCount(id: string): Promise<WalletSessionConsumeUsesResult> {
    const entry = this.liveEntry(id);
    if ('ok' in entry) return entry;
    if (entry.remainingUses <= 0) {
      return failure('wallet_budget_exhausted', 'Wallet Session exhausted');
    }
    entry.remainingUses -= 1;
    return { ok: true, remainingUses: entry.remainingUses };
  }

  async consumeUseCountOnce(
    id: string,
    idempotencyKey: string,
  ): Promise<WalletSessionConsumeUsesResult> {
    const entry = this.liveEntry(id);
    if ('ok' in entry) return entry;
    const consumeKey = String(idempotencyKey || '').trim();
    if (consumeKey && entry.consumedIdempotencyKeys.has(consumeKey)) {
      return { ok: true, remainingUses: entry.remainingUses };
    }
    if (entry.remainingUses <= 0) {
      return failure('wallet_budget_exhausted', 'Wallet Session exhausted');
    }
    entry.remainingUses -= 1;
    if (consumeKey) entry.consumedIdempotencyKeys.add(consumeKey);
    return { ok: true, remainingUses: entry.remainingUses };
  }

  async hasConsumedUseCountOnce(
    id: string,
    idempotencyKey: string,
  ): Promise<WalletSessionConsumedUseResult> {
    const entry = this.liveEntry(id);
    if ('ok' in entry) return entry;
    const consumeKey = String(idempotencyKey || '').trim();
    return { ok: true, consumed: !!consumeKey && entry.consumedIdempotencyKeys.has(consumeKey) };
  }

  async reserveReplayGuard(
    scopeId: string,
    replayKey: string,
    expiresAtMs: number,
  ): Promise<WalletSessionReplayGuardResult> {
    const key = this.keys.replayGuard(scopeId, replayKey);
    if (!key) return replayGuardInvalid();
    const nowMs = Date.now();
    const existingExpiresAtMs = this.replayGuards.get(key);
    if (existingExpiresAtMs !== undefined && existingExpiresAtMs > nowMs) {
      return replayGuardDuplicate();
    }
    if (existingExpiresAtMs !== undefined) this.replayGuards.delete(key);
    const ttlMs = replayGuardTtlMs(expiresAtMs, nowMs);
    if (ttlMs <= 0) return replayGuardExpired();
    this.replayGuards.set(key, nowMs + ttlMs);
    return { ok: true };
  }
}

/** A backend failure as an `internal` result: the error's message, else `fallback`. */
function walletSessionStoreFailure(error: unknown, fallback: string): WalletSessionStoreFailure {
  const message = String(
    error && typeof error === 'object' && 'message' in error
      ? (error as { message?: unknown }).message
      : error || fallback,
  );
  return failure('internal', message);
}

/**
 * A remote store's session status: the parsed record while it is live, with its remaining uses.
 * A backend failure, or a use count that is not a non-negative integer, reads as unavailable.
 */
async function readWalletSessionStatus<TRecord extends WalletSessionRecord>(input: {
  readonly readRecord: () => Promise<TRecord | null>;
  readonly readRemainingUses: () => Promise<unknown>;
}): Promise<WalletSessionStatusLookupResult<TRecord>> {
  try {
    const record = await input.readRecord();
    if (!record) return { ok: false, code: 'wallet_session_missing' };
    if (record.expiresAtMs <= Date.now()) {
      return { ok: false, code: 'wallet_session_expired' };
    }
    const remainingUses = Number(await input.readRemainingUses());
    if (!Number.isSafeInteger(remainingUses) || remainingUses < 0) {
      return { ok: false, code: 'wallet_session_unavailable' };
    }
    return {
      ok: true,
      status: {
        record,
        expiresAtMs: record.expiresAtMs,
        remainingUses,
      },
    };
  } catch {
    return { ok: false, code: 'wallet_session_unavailable' };
  }
}

function normalizeConsumeOnceKey(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._:-]/g, '_')
    .slice(0, 512);
}

function replayGuardTtlMs(expiresAtMs: number, nowMs = Date.now()): number {
  const expires = Number(expiresAtMs);
  if (!Number.isFinite(expires)) return 0;
  const retainUntilMs = expires + EXPORT_REPLAY_GUARD_CLOCK_SKEW_MS;
  if (retainUntilMs <= nowMs) return 0;
  return Math.max(EXPORT_REPLAY_GUARD_MIN_RETENTION_MS, Math.floor(retainUntilMs - nowMs));
}

function replayGuardInvalid(): WalletSessionReplayGuardResult {
  return failure('invalid_body', 'Invalid replay guard key');
}

function replayGuardExpired(): WalletSessionReplayGuardResult {
  return failure('export_authorization_expired', 'Export authorization expired');
}

function replayGuardDuplicate(): WalletSessionReplayGuardResult {
  return failure('export_nonce_replay', 'Export authorization nonce already used');
}

function parseRedisReplayGuardResult(raw: unknown): WalletSessionReplayGuardResult {
  const text = String(raw ?? '').trim();
  if (text === 'ok') return { ok: true };
  if (text === 'duplicate') return replayGuardDuplicate();
  if (text === 'expired') return replayGuardExpired();
  return failure('internal', 'Redis replay guard returned invalid response');
}

function parseRedisConsumeOnceResult(raw: unknown): WalletSessionConsumeUsesResult {
  const text = String(raw ?? '').trim();
  if (text.startsWith('ok:')) {
    const remainingUses = Number(text.slice(3));
    if (!Number.isFinite(remainingUses)) {
      return failure('internal', 'Redis consume-once returned invalid uses');
    }
    return { ok: true, remainingUses };
  }
  if (text === 'wallet_session_missing') {
    return failure('wallet_session_missing', 'Wallet Session is missing');
  }
  if (text === 'wallet_budget_exhausted') {
    return failure('wallet_budget_exhausted', 'Wallet Session signing budget is exhausted');
  }
  return failure('internal', 'Redis consume-once returned invalid response');
}

function parseRedisConsumedUseResult(raw: unknown): WalletSessionConsumedUseResult {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(value)) {
    return failure('internal', 'Redis consumed-use check returned invalid response');
  }
  return { ok: true, consumed: value > 0 };
}

function redisRawValue(resp: { type: string; value?: unknown }): unknown {
  if (resp.type === 'integer') return String(resp.value);
  return resp.value;
}

const CONSUME_ONCE_EXISTS_LUA = `
local marker_key = KEYS[1]
return redis.call('EXISTS', marker_key)
`;

const CONSUME_USE_COUNT_LUA = `
local uses_key = KEYS[1]
local current = tonumber(redis.call('GET', uses_key) or '')
if current == nil then
  return 'wallet_session_missing'
end
if current <= 0 then
  return 'wallet_budget_exhausted'
end
return 'ok:' .. tostring(redis.call('INCRBY', uses_key, -1))
`;

const CONSUME_ONCE_LUA = `
local uses_key = KEYS[1]
local marker_key = KEYS[2]
if redis.call('EXISTS', marker_key) == 1 then
  local current = redis.call('GET', uses_key)
  if not current then
    return 'wallet_session_missing'
  end
  return 'ok:' .. tostring(current)
end
local current = tonumber(redis.call('GET', uses_key) or '')
if current == nil then
  return 'wallet_session_missing'
end
if current <= 0 then
  return 'wallet_budget_exhausted'
end
local remaining = redis.call('INCRBY', uses_key, -1)
local ttl = redis.call('TTL', uses_key)
if ttl and ttl > 0 then
  redis.call('SET', marker_key, '1', 'EX', ttl)
else
  redis.call('SET', marker_key, '1', 'EX', 60)
end
return 'ok:' .. tostring(remaining)
`;

const REPLAY_GUARD_LUA = `
local key = KEYS[1]
local ttl_seconds = tonumber(ARGV[1] or '')
if ttl_seconds == nil or ttl_seconds <= 0 then
  return 'expired'
end
if redis.call('EXISTS', key) == 1 then
  return 'duplicate'
end
redis.call('SET', key, '1', 'EX', ttl_seconds)
return 'ok'
`;

class UpstashRedisRestWalletSessionStore<
  TRecord extends WalletSessionRecord,
> implements WalletSessionStore<TRecord> {
  private readonly client: UpstashRedisRestClient;
  private readonly keys: WalletSessionKeys;
  private readonly parseRecord: WalletSessionRecordParser<TRecord>;

  constructor(input: {
    url: string;
    token: string;
    keyPrefix?: string;
    parseRecord: WalletSessionRecordParser<TRecord>;
  }) {
    const url = toOptionalTrimmedString(input.url);
    const token = toOptionalTrimmedString(input.token);
    if (!url) throw new Error('Upstash wallet session store missing url');
    if (!token) throw new Error('Upstash wallet session store missing token');
    this.client = new UpstashRedisRestClient({ url, token });
    this.keys = new WalletSessionKeys(input.keyPrefix);
    this.parseRecord = input.parseRecord;
  }

  async putSession(
    id: string,
    record: TRecord,
    opts: { ttlMs: number; remainingUses: number },
  ): Promise<void> {
    const ttlMs = Math.max(0, Number(opts.ttlMs) || 0);
    await this.client.setJson(this.keys.meta(id), record, ttlMs);
    await this.client.setRaw(
      this.keys.uses(id),
      String(Math.max(0, Number(opts.remainingUses) || 0)),
      ttlMs,
    );
  }

  async getSession(id: string): Promise<TRecord | null> {
    const raw = await this.client.getJson(this.keys.meta(id));
    return this.parseRecord(raw);
  }

  async getSessionStatus(id: string): Promise<WalletSessionStatusLookupResult<TRecord>> {
    return readWalletSessionStatus({
      readRecord: async () => this.parseRecord(await this.client.getJson(this.keys.meta(id))),
      readRemainingUses: () => this.client.getRaw(this.keys.uses(id)),
    });
  }

  async consumeUseCount(id: string): Promise<WalletSessionConsumeUsesResult> {
    try {
      const raw = await this.client.eval(CONSUME_USE_COUNT_LUA, [this.keys.uses(id)], []);
      return parseRedisConsumeOnceResult(raw);
    } catch (e: unknown) {
      return walletSessionStoreFailure(e, 'Failed to consume threshold session');
    }
  }

  async consumeUseCountOnce(
    id: string,
    idempotencyKey: string,
  ): Promise<WalletSessionConsumeUsesResult> {
    try {
      const raw = await this.client.eval(
        CONSUME_ONCE_LUA,
        [this.keys.uses(id), this.keys.consumeOnce(id, idempotencyKey)],
        [],
      );
      return parseRedisConsumeOnceResult(raw);
    } catch (e: unknown) {
      return walletSessionStoreFailure(e, 'Failed to consume threshold session');
    }
  }

  async hasConsumedUseCountOnce(
    id: string,
    idempotencyKey: string,
  ): Promise<WalletSessionConsumedUseResult> {
    const consumeKey = normalizeConsumeOnceKey(idempotencyKey);
    if (!consumeKey) return { ok: true, consumed: false };
    try {
      const raw = await this.client.eval(
        CONSUME_ONCE_EXISTS_LUA,
        [this.keys.consumeOnce(id, consumeKey)],
        [],
      );
      return parseRedisConsumedUseResult(raw);
    } catch (e: unknown) {
      return walletSessionStoreFailure(e, 'Failed to check consumed threshold session operation');
    }
  }

  async reserveReplayGuard(
    scopeId: string,
    replayKey: string,
    expiresAtMs: number,
  ): Promise<WalletSessionReplayGuardResult> {
    try {
      const ttlMs = replayGuardTtlMs(expiresAtMs);
      if (ttlMs <= 0) return replayGuardExpired();
      const raw = await this.client.eval(
        REPLAY_GUARD_LUA,
        [this.keys.replayGuard(scopeId, replayKey)],
        [String(Math.max(1, Math.ceil(ttlMs / 1000)))],
      );
      return parseRedisReplayGuardResult(raw);
    } catch (e: unknown) {
      return walletSessionStoreFailure(e, 'Failed to reserve replay guard');
    }
  }
}

class RedisTcpWalletSessionStore<
  TRecord extends WalletSessionRecord,
> implements WalletSessionStore<TRecord> {
  private readonly client: RedisTcpClient;
  private readonly keys: WalletSessionKeys;
  private readonly parseRecord: WalletSessionRecordParser<TRecord>;

  constructor(input: {
    redisUrl: string;
    keyPrefix?: string;
    parseRecord: WalletSessionRecordParser<TRecord>;
  }) {
    const url = toOptionalTrimmedString(input.redisUrl);
    if (!url) throw new Error('redis-tcp wallet session store missing redisUrl');
    this.client = new RedisTcpClient(url);
    this.keys = new WalletSessionKeys(input.keyPrefix);
    this.parseRecord = input.parseRecord;
  }

  async putSession(
    id: string,
    record: TRecord,
    opts: { ttlMs: number; remainingUses: number },
  ): Promise<void> {
    const ttlMs = Math.max(0, Number(opts.ttlMs) || 0);
    await redisSetJson(this.client, this.keys.meta(id), record, ttlMs);
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const uses = String(Math.max(0, Number(opts.remainingUses) || 0));
    const resp = await this.client.send([
      'SET',
      this.keys.uses(id),
      uses,
      'EX',
      String(ttlSeconds),
    ]);
    if (resp.type === 'error') throw new Error(`Redis SET error: ${resp.value}`);
  }

  async getSession(id: string): Promise<TRecord | null> {
    const raw = await redisGetJson(this.client, this.keys.meta(id));
    return this.parseRecord(raw);
  }

  async getSessionStatus(id: string): Promise<WalletSessionStatusLookupResult<TRecord>> {
    return readWalletSessionStatus({
      readRecord: async () => this.parseRecord(await redisGetJson(this.client, this.keys.meta(id))),
      // An error reply reads as no count, which is unavailable.
      readRemainingUses: async () => {
        const usesResponse = await this.client.send(['GET', this.keys.uses(id)]);
        return usesResponse.type === 'error' ? undefined : redisRawValue(usesResponse);
      },
    });
  }

  async consumeUseCount(id: string): Promise<WalletSessionConsumeUsesResult> {
    try {
      const resp = await this.client.send(['EVAL', CONSUME_USE_COUNT_LUA, '1', this.keys.uses(id)]);
      if (resp.type === 'error') return failure('internal', `Redis EVAL error: ${resp.value}`);
      return parseRedisConsumeOnceResult(redisRawValue(resp));
    } catch (e: unknown) {
      return walletSessionStoreFailure(e, 'Failed to consume threshold session');
    }
  }

  async consumeUseCountOnce(
    id: string,
    idempotencyKey: string,
  ): Promise<WalletSessionConsumeUsesResult> {
    try {
      const resp = await this.client.send([
        'EVAL',
        CONSUME_ONCE_LUA,
        '2',
        this.keys.uses(id),
        this.keys.consumeOnce(id, idempotencyKey),
      ]);
      if (resp.type === 'error') {
        return failure('internal', `Redis EVAL error: ${resp.value}`);
      }
      const raw = resp.type === 'integer' ? String(resp.value) : resp.value;
      return parseRedisConsumeOnceResult(raw);
    } catch (e: unknown) {
      return walletSessionStoreFailure(e, 'Failed to consume threshold session');
    }
  }

  async hasConsumedUseCountOnce(
    id: string,
    idempotencyKey: string,
  ): Promise<WalletSessionConsumedUseResult> {
    const consumeKey = normalizeConsumeOnceKey(idempotencyKey);
    if (!consumeKey) return { ok: true, consumed: false };
    try {
      const resp = await this.client.send(['EXISTS', this.keys.consumeOnce(id, consumeKey)]);
      if (resp.type === 'error') {
        return failure('internal', `Redis EXISTS error: ${resp.value}`);
      }
      return parseRedisConsumedUseResult(resp.value);
    } catch (e: unknown) {
      return walletSessionStoreFailure(e, 'Failed to check consumed threshold session operation');
    }
  }

  async reserveReplayGuard(
    scopeId: string,
    replayKey: string,
    expiresAtMs: number,
  ): Promise<WalletSessionReplayGuardResult> {
    try {
      const ttlMs = replayGuardTtlMs(expiresAtMs);
      if (ttlMs <= 0) return replayGuardExpired();
      const resp = await this.client.send([
        'SET',
        this.keys.replayGuard(scopeId, replayKey),
        '1',
        'NX',
        'EX',
        String(Math.max(1, Math.ceil(ttlMs / 1000))),
      ]);
      if (resp.type === 'error') {
        return failure('internal', `Redis SET error: ${resp.value}`);
      }
      if (resp.type === 'bulk' && resp.value === null) return replayGuardDuplicate();
      if (resp.type === 'simple' && resp.value === 'OK') return { ok: true };
      return failure('internal', 'Redis replay guard returned invalid response');
    } catch (e: unknown) {
      return walletSessionStoreFailure(e, 'Failed to reserve replay guard');
    }
  }
}

type WalletSessionStoreFactoryInput = {
  config?: ThresholdStoreConfigInput | null;
  logger: NormalizedLogger;
  isNode: boolean;
};

/** What sets the Ed25519 and ECDSA wallet session stores apart. */
type WalletSessionStoreSpec<TRecord extends WalletSessionRecord> = {
  /** Tags log lines and errors, `[<tag>] …`. */
  readonly tag: 'threshold-ed25519' | 'threshold-ecdsa';
  /** The Durable Object store when the config selects Durable Objects, else null. */
  readonly durableObjectStore: (
    input: WalletSessionStoreFactoryInput,
  ) => WalletSessionStore<TRecord> | null;
  /** The key prefix env-shaped config gives, or '' for the store's default. */
  readonly envPrefix: (config: WalletSessionStoreConfigRecord) => string;
  readonly parseRecord: WalletSessionRecordParser<TRecord>;
};

/**
 * Selects a wallet session store: Durable Objects, else the config's explicit `kind`, else Upstash
 * or Redis from env-shaped config, else in memory where the runtime allows it.
 */
function createWalletSessionStore<TRecord extends WalletSessionRecord>(
  input: WalletSessionStoreFactoryInput,
  spec: WalletSessionStoreSpec<TRecord>,
): WalletSessionStore<TRecord> {
  const durableObjectStore = spec.durableObjectStore(input);
  if (durableObjectStore) return durableObjectStore;

  const { tag, parseRecord } = spec;
  const config = (
    isPlainObject(input.config) ? input.config : {}
  ) as WalletSessionStoreConfigRecord;
  const allowInMemory = toOptionalTrimmedString(config.THRESHOLD_ALLOW_IN_MEMORY_STORES) === '1';
  const requirePersistent = !input.isNode && !allowInMemory;
  const envPrefix = spec.envPrefix(config);
  const inMemory = () =>
    new InMemoryWalletSessionStore<TRecord>({ keyPrefix: envPrefix || undefined });

  const kind = readNonDurableObjectThresholdStoreKind(config, tag);
  if (kind === 'in-memory') {
    if (requirePersistent) {
      throw new Error(
        `[${tag}] In-memory wallet session store is not supported in this runtime; configure Upstash/Redis or Durable Objects`,
      );
    }
    return inMemory();
  }
  if (kind === 'upstash-redis-rest') {
    return new UpstashRedisRestWalletSessionStore<TRecord>({
      url:
        toOptionalTrimmedString(config.url) ||
        toOptionalTrimmedString(config.UPSTASH_REDIS_REST_URL),
      token:
        toOptionalTrimmedString(config.token) ||
        toOptionalTrimmedString(config.UPSTASH_REDIS_REST_TOKEN),
      keyPrefix: toOptionalTrimmedString(config.keyPrefix) || envPrefix,
      parseRecord,
    });
  }
  if (kind === 'redis-tcp') {
    if (!input.isNode) {
      if (requirePersistent) {
        throw new Error(
          `[${tag}] redis-tcp wallet session store is not supported in this runtime; configure Upstash/Redis REST or Durable Objects`,
        );
      }
      input.logger.warn(
        `[${tag}] redis-tcp wallet session store is not supported in this runtime; falling back to in-memory`,
      );
      return inMemory();
    }
    return new RedisTcpWalletSessionStore<TRecord>({
      redisUrl:
        toOptionalTrimmedString(config.redisUrl) || toOptionalTrimmedString(config.REDIS_URL),
      keyPrefix: toOptionalTrimmedString(config.keyPrefix) || envPrefix,
      parseRecord,
    });
  }
  // Env-shaped config: prefer Redis/Upstash for wallet session storage (TTL + counters).
  const upstashUrl = toOptionalTrimmedString(config.UPSTASH_REDIS_REST_URL);
  const upstashToken = toOptionalTrimmedString(config.UPSTASH_REDIS_REST_TOKEN);
  if (upstashUrl || upstashToken) {
    if (!upstashUrl || !upstashToken) {
      throw new Error(
        'Upstash wallet session store enabled but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not both set',
      );
    }
    input.logger.info(`[${tag}] Using Upstash REST store for Wallet Session records`);
    return new UpstashRedisRestWalletSessionStore<TRecord>({
      url: upstashUrl,
      token: upstashToken,
      keyPrefix: envPrefix || undefined,
      parseRecord,
    });
  }

  const redisUrl = toOptionalTrimmedString(config.REDIS_URL);
  if (redisUrl) {
    if (!input.isNode) {
      if (requirePersistent) {
        throw new Error(
          `[${tag}] REDIS_URL is set but TCP Redis is not supported in this runtime; use Upstash/Redis REST or Durable Objects`,
        );
      }
      input.logger.warn(
        `[${tag}] REDIS_URL is set but TCP Redis is not supported in this runtime; falling back to in-memory`,
      );
      return inMemory();
    }
    input.logger.info(`[${tag}] Using redis-tcp store for Wallet Session records`);
    return new RedisTcpWalletSessionStore<TRecord>({
      redisUrl,
      keyPrefix: envPrefix || undefined,
      parseRecord,
    });
  }

  if (requirePersistent) {
    throw new Error(
      `[${tag}] Wallet Session records require persistent storage in this runtime; configure UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or Durable Objects`,
    );
  }
  input.logger.info(`[${tag}] Using in-memory Wallet Session store (non-persistent)`);
  return inMemory();
}

export function createEd25519WalletSessionStore(input: {
  config?: ThresholdStoreConfigInput | null;
  logger: NormalizedLogger;
  isNode: boolean;
}): Ed25519WalletSessionStore {
  return createWalletSessionStore(input, {
    tag: 'threshold-ed25519',
    durableObjectStore: ({ config, logger }) =>
      createCloudflareDurableObjectThresholdEd25519Stores({ config, logger })?.walletSessionStore ??
      null,
    envPrefix: (config) => {
      const basePrefix = toOptionalTrimmedString(config.THRESHOLD_PREFIX);
      return (
        toOptionalTrimmedString(config.THRESHOLD_ED25519_WALLET_SESSION_PREFIX) ||
        toThresholdEd25519PrefixFromBase(basePrefix, 'wallet-session') ||
        ''
      );
    },
    parseRecord: parseEd25519WalletSessionRecord,
  });
}

export function createEcdsaWalletSessionStore(input: {
  config?: ThresholdStoreConfigInput | null;
  logger: NormalizedLogger;
  isNode: boolean;
}): EcdsaWalletSessionStore {
  return createWalletSessionStore(input, {
    tag: 'threshold-ecdsa',
    durableObjectStore: ({ config, logger }) =>
      createCloudflareDurableObjectThresholdEcdsaStores({ config, logger })?.walletSessionStore ??
      null,
    envPrefix: (config) => {
      const basePrefix = toOptionalTrimmedString(config.THRESHOLD_PREFIX);
      return toThresholdEcdsaWalletSessionPrefix(
        toOptionalTrimmedString(config.THRESHOLD_ECDSA_WALLET_SESSION_PREFIX) ||
          toThresholdEcdsaPrefixFromBase(basePrefix, 'wallet-session'),
      );
    },
    parseRecord: parseEcdsaWalletSessionRecord,
  });
}
