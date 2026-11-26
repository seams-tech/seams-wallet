export type RateLimitResult =
  | { ok: true }
  | {
      ok: false;
      code: 'rate_limited';
      message: string;
      retryAfterMs?: number;
      resetAtMs?: number;
    };
