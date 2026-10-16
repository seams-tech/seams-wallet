import { toOptionalTrimmedString } from '@shared/utils/validation';
import { UpstashRedisRestClient } from '../../../../core/ThresholdService/kv';
import type { SigningSessionSealRateLimiter } from './index';

const WINDOW_COUNTER_LUA = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1]) or 1
if window_ms < 1 then
  window_ms = 1
end
local current = redis.call('INCR', key)
if current == 1 then
  redis.call('PEXPIRE', key, window_ms)
end
local ttl = redis.call('PTTL', key)
if ttl < 0 then
  redis.call('PEXPIRE', key, window_ms)
  ttl = window_ms
end
return tostring(current) .. ":" .. tostring(ttl)
`.trim();

function parseCounterWindow(raw: unknown): { count: number; ttlMs: number } | null {
  if (typeof raw !== 'string') return null;
  const [countText, ttlText] = raw.split(':');
  const count = Number(countText);
  const ttlMs = Number(ttlText);
  if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) return null;
  return {
    count: Math.max(0, Math.floor(count)),
    ttlMs: Math.max(0, Math.floor(ttlMs)),
  };
}

function finalizeConsume(input: { count: number; ttlMs: number; limit: number; nowMs: number }) {
  const remaining = Math.max(0, input.limit - input.count);
  const resetAtMs = input.nowMs + Math.max(0, input.ttlMs);
  if (input.count > input.limit) {
    return {
      ok: false as const,
      code: 'rate_limited',
      message: 'Rate limit exceeded',
      remaining: 0,
      resetAtMs,
      retryAfterMs: Math.max(0, resetAtMs - input.nowMs),
    };
  }
  return {
    ok: true as const,
    remaining,
    resetAtMs,
  };
}

export interface CreateUpstashSigningSessionSealRateLimiterOptions {
  url: string;
  token: string;
  keyPrefix?: string;
}

class UpstashSigningSessionSealRateLimiter implements SigningSessionSealRateLimiter {
  private readonly client: UpstashRedisRestClient;
  private readonly keyPrefix: string;

  constructor(input: CreateUpstashSigningSessionSealRateLimiterOptions) {
    this.client = new UpstashRedisRestClient({ url: input.url, token: input.token });
    this.keyPrefix = toOptionalTrimmedString(input.keyPrefix);
  }

  private withPrefix(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}${key}` : key;
  }

  async consume(input: { key: string; limit: number; windowMs: number; nowMs: number }) {
    const key = this.withPrefix(toOptionalTrimmedString(input.key));
    if (!key) {
      return {
        ok: false as const,
        code: 'invalid_rate_limit_key',
        message: 'Rate-limit key is required',
      };
    }
    try {
      const evalResult = await this.client.eval(
        WINDOW_COUNTER_LUA,
        [key],
        [String(Math.max(1, Math.floor(Number(input.windowMs) || 0)))],
      );
      const parsed = parseCounterWindow(evalResult);
      if (!parsed) {
        return {
          ok: false as const,
          code: 'internal',
          message: 'Invalid Upstash rate-limit response',
        };
      }
      return finalizeConsume({
        count: parsed.count,
        ttlMs: parsed.ttlMs,
        limit: Math.max(1, Math.floor(Number(input.limit) || 0)),
        nowMs: Math.floor(Number(input.nowMs) || 0),
      });
    } catch (error: unknown) {
      return {
        ok: false as const,
        code: 'internal',
        message:
          error instanceof Error ? error.message : String(error || 'Upstash rate-limit failed'),
      };
    }
  }
}

export function createUpstashSigningSessionSealRateLimiter(
  options: CreateUpstashSigningSessionSealRateLimiterOptions,
): SigningSessionSealRateLimiter {
  return new UpstashSigningSessionSealRateLimiter(options);
}
