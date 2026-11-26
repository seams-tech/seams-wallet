import { toOptionalTrimmedString } from '@shared/utils/validation';
import { UpstashRedisRestClient } from '../../../core/ThresholdService/kv';
import {
  parseCurrentSigningSessionSealIdempotencyResultRecord,
  parseCurrentSigningSessionSealIdempotencyStoredEntry,
} from './idempotencyRecords';
import type {
  SigningSessionSealIdempotencyStore,
  SigningSessionSealRouteResult,
} from './signingSessionSeal.types';

const DEFAULT_KEY_PREFIX = 'threshold:signing-session-seal:idempotency:';

function toPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function prefixedKey(prefix: string, keyRaw: string): string {
  const key = toOptionalTrimmedString(keyRaw);
  if (!key) return '';
  return prefix ? `${prefix}${key}` : key;
}

function ttlMsUntilExpiry(expiresAtMs: number, nowMs: number): number {
  const ttlMs = Math.floor(expiresAtMs - nowMs);
  return ttlMs > 0 ? ttlMs : 0;
}

export interface CreateUpstashSigningSessionSealIdempotencyStoreOptions {
  url: string;
  token: string;
  keyPrefix?: string;
  nowMs?: () => number;
}

class UpstashSigningSessionSealIdempotencyStore implements SigningSessionSealIdempotencyStore {
  private readonly client: UpstashRedisRestClient;
  private readonly keyPrefix: string;
  private readonly nowMs: () => number;

  constructor(options: CreateUpstashSigningSessionSealIdempotencyStoreOptions) {
    this.client = new UpstashRedisRestClient({
      url: options.url,
      token: options.token,
    });
    this.keyPrefix = toOptionalTrimmedString(options.keyPrefix) || DEFAULT_KEY_PREFIX;
    this.nowMs = options.nowMs || Date.now;
  }

  async get(input: { key: string; nowMs: number }): Promise<SigningSessionSealRouteResult | null> {
    const key = prefixedKey(this.keyPrefix, input.key);
    if (!key) return null;
    const raw = await this.client.getJson(key);
    const entry = parseCurrentSigningSessionSealIdempotencyStoredEntry(raw);
    if (!entry) return null;
    if (entry.expiresAtMs <= input.nowMs) {
      try {
        await this.client.del(key);
      } catch {}
      return null;
    }
    return entry.result;
  }

  async set(input: { key: string; result: SigningSessionSealRouteResult; expiresAtMs: number }): Promise<void> {
    const key = prefixedKey(this.keyPrefix, input.key);
    if (!key) return;
    const expiresAtMs = toPositiveInt(input.expiresAtMs);
    if (expiresAtMs === undefined) return;
    const normalizedResult = parseCurrentSigningSessionSealIdempotencyResultRecord(input.result);
    if (!normalizedResult) return;
    const ttlMs = ttlMsUntilExpiry(expiresAtMs, this.nowMs());
    if (ttlMs <= 0) return;
    await this.client.setJson(
      key,
      {
        result: normalizedResult,
        expiresAtMs,
      },
      ttlMs,
    );
  }
}

export function createUpstashSigningSessionSealIdempotencyStore(
  options: CreateUpstashSigningSessionSealIdempotencyStoreOptions,
): SigningSessionSealIdempotencyStore {
  return new UpstashSigningSessionSealIdempotencyStore(options);
}
