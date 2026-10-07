import type { ScopedD1Prepare } from '../../../../core/emailOtpD1Statements';
import type { RateLimitResult } from '../../../../core/authService/rateLimits';
import type { EmailOtpRateLimitPolicy } from '../auth/d1RouterApiAuthConfig';
import {
  emailOtpRateLimitExceeded,
  emailOtpRateLimitKeys,
  type D1EmailOtpRateLimitRow,
  type EmailOtpRateLimitScope,
  type EmailOtpCounterKey,
  type EmailOtpRateLimitConsumeInput,
} from './d1EmailOtpRecords';

type EmailOtpRateLimitPolicies = {
  readonly [K in EmailOtpRateLimitScope]: EmailOtpRateLimitPolicy;
};

type EmailOtpRateLimitConsumeResult = Readonly<RateLimitResult>;

export class CloudflareD1EmailOtpRateLimitStore {
  private readonly rateLimits: EmailOtpRateLimitPolicies;
  private readonly counter: D1EmailOtpRateLimitCounter;

  constructor(input: {
    readonly prepare: ScopedD1Prepare;
    readonly rateLimits: EmailOtpRateLimitPolicies;
  }) {
    this.rateLimits = input.rateLimits;
    this.counter = new D1EmailOtpRateLimitCounter(input.prepare);
  }

  async consume(input: EmailOtpRateLimitConsumeInput): Promise<EmailOtpRateLimitConsumeResult> {
    const policy = this.rateLimits[input.scope];
    const keys = emailOtpRateLimitKeys(input, policy);
    for (const key of keys) {
      const consumed = await this.counter.consume({
        counter: key,
        limit: policy.limit,
        windowMs: policy.windowMs,
      });
      if (!consumed.ok) return consumed;
    }
    return { ok: true };
  }
}

class D1EmailOtpRateLimitCounter {
  constructor(private readonly prepare: ScopedD1Prepare) {}

  async consume(input: {
    readonly counter: EmailOtpCounterKey;
    readonly limit: number;
    readonly windowMs: number;
  }): Promise<EmailOtpRateLimitConsumeResult> {
    const nowMs = Date.now();
    const resetAtMs = nowMs + input.windowMs;
    let walletId: string | null;
    switch (input.counter.kind) {
      case 'wallet':
        walletId = input.counter.walletId;
        break;
      case 'regional':
        walletId = null;
        break;
      default:
        return assertNever(input.counter);
    }
    const table = walletId === null ? 'email_otp_rate_limits' : 'wallet_email_otp_rate_limits';
    const ownerColumn = walletId === null ? '' : 'wallet_id,';
    const ownerPlaceholder = walletId === null ? '' : '?,';
    const ownerValues = walletId === null ? [] : [walletId];
    const row = await this.prepare(
      `INSERT INTO ${table} (
        namespace,
        org_id,
        project_id,
        env_id,
        ${ownerColumn}
        rate_key,
        consumed_count,
        reset_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ${ownerPlaceholder} ?, 1, ?, ?)
      ON CONFLICT (namespace, org_id, project_id, env_id, ${ownerColumn} rate_key)
      DO UPDATE SET
        consumed_count = CASE
          WHEN ${table}.reset_at_ms <= ?
            THEN 1
          ELSE ${table}.consumed_count + 1
        END,
        reset_at_ms = CASE
          WHEN ${table}.reset_at_ms <= ?
            THEN ?
          ELSE ${table}.reset_at_ms
        END,
        updated_at_ms = ?
      WHERE ${table}.reset_at_ms <= ?
         OR ${table}.consumed_count < ?
      RETURNING consumed_count, reset_at_ms`,
      [
        ...ownerValues,
        input.counter.key,
        resetAtMs,
        nowMs,
        nowMs,
        nowMs,
        resetAtMs,
        nowMs,
        nowMs,
        input.limit,
      ],
    ).first<D1EmailOtpRateLimitRow>();
    if (row) return { ok: true };
    const existing = await this.prepare(
      `SELECT consumed_count, reset_at_ms
         FROM ${table}
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          ${walletId === null ? '' : 'AND wallet_id = ?'}
          AND rate_key = ?
        LIMIT 1`,
      [...ownerValues, input.counter.key],
    ).first<D1EmailOtpRateLimitRow>();
    return emailOtpRateLimitExceeded(existing);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected OTP counter ownership: ${String(value)}`);
}
