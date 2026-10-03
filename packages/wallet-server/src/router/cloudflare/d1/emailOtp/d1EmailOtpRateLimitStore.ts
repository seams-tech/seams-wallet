import type { ScopedD1Prepare } from '../../../../core/emailOtpD1Statements';
import type { RateLimitResult } from '../../../../core/authService/rateLimits';
import type { EmailOtpRateLimitPolicy } from '../auth/d1RouterApiAuthConfig';
import {
  emailOtpRateLimitExceeded,
  emailOtpRateLimitKeys,
  type D1EmailOtpRateLimitRow,
  type EmailOtpRateLimitScope,
} from './d1EmailOtpRecords';

type EmailOtpRateLimitPolicies = {
  readonly [K in EmailOtpRateLimitScope]: EmailOtpRateLimitPolicy;
};

type EmailOtpRateLimitConsumeInput = {
  readonly scope: EmailOtpRateLimitScope;
  readonly action?: string;
  readonly userId?: string;
  readonly walletId?: string;
  readonly providerSubject?: string;
  readonly orgId?: string;
  readonly clientIp?: string;
};

type EmailOtpRateLimitConsumeResult = Readonly<RateLimitResult>;

export class CloudflareD1EmailOtpRateLimitStore {
  private readonly rateLimits: EmailOtpRateLimitPolicies;
  private readonly counter: EmailOtpRateLimitCounter;

  constructor(input: {
    readonly prepare: ScopedD1Prepare;
    readonly rateLimits: EmailOtpRateLimitPolicies;
    readonly counter?: EmailOtpRateLimitCounter;
  }) {
    this.rateLimits = input.rateLimits;
    this.counter = input.counter ?? new D1EmailOtpRateLimitCounter(input.prepare);
  }

  async consume(input: EmailOtpRateLimitConsumeInput): Promise<EmailOtpRateLimitConsumeResult> {
    const policy = this.rateLimits[input.scope];
    const keys = emailOtpRateLimitKeys({ ...input, policy });
    for (const key of keys) {
      const consumed = await this.counter.consume({
        key,
        limit: policy.limit,
        windowMs: policy.windowMs,
      });
      if (!consumed.ok) return consumed;
    }
    return { ok: true };
  }
}

export interface EmailOtpRateLimitCounter {
  consume(input: {
    readonly key: string;
    readonly limit: number;
    readonly windowMs: number;
  }): Promise<EmailOtpRateLimitConsumeResult>;
}

export class D1EmailOtpRateLimitCounter implements EmailOtpRateLimitCounter {
  constructor(private readonly prepare: ScopedD1Prepare) {}

  async consume(input: {
    readonly key: string;
    readonly limit: number;
    readonly windowMs: number;
  }): Promise<EmailOtpRateLimitConsumeResult> {
    const nowMs = Date.now();
    const resetAtMs = nowMs + input.windowMs;
    const row = await this.prepare(
      `INSERT INTO email_otp_rate_limits (
        namespace,
        org_id,
        project_id,
        env_id,
        rate_key,
        consumed_count,
        reset_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT (namespace, org_id, project_id, env_id, rate_key)
      DO UPDATE SET
        consumed_count = CASE
          WHEN email_otp_rate_limits.reset_at_ms <= ?
            THEN 1
          ELSE email_otp_rate_limits.consumed_count + 1
        END,
        reset_at_ms = CASE
          WHEN email_otp_rate_limits.reset_at_ms <= ?
            THEN ?
          ELSE email_otp_rate_limits.reset_at_ms
        END,
        updated_at_ms = ?
      WHERE email_otp_rate_limits.reset_at_ms <= ?
         OR email_otp_rate_limits.consumed_count < ?
      RETURNING consumed_count, reset_at_ms`,
      [input.key, resetAtMs, nowMs, nowMs, nowMs, resetAtMs, nowMs, nowMs, input.limit],
    ).first<D1EmailOtpRateLimitRow>();
    if (row) return { ok: true };
    const existing = await this.prepare(
      `SELECT consumed_count, reset_at_ms
         FROM email_otp_rate_limits
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND rate_key = ?
        LIMIT 1`,
      [input.key],
    ).first<D1EmailOtpRateLimitRow>();
    return emailOtpRateLimitExceeded(existing);
  }
}
