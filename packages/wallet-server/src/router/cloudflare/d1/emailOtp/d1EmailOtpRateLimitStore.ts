import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '../../../../storage/tenantRoute';
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
  constructor(
    private readonly input: {
      readonly prepare: ScopedD1Prepare;
      readonly batch: D1DatabaseLike['batch'];
      readonly rateLimits: EmailOtpRateLimitPolicies;
    },
  ) {}

  async consume(input: EmailOtpRateLimitConsumeInput): Promise<EmailOtpRateLimitConsumeResult> {
    const policy = this.input.rateLimits[input.scope];
    const keys = emailOtpRateLimitKeys(input, policy);
    if (keys.length === 0) return { ok: true };
    const nowMs = Date.now();
    const statements: D1PreparedStatementLike[] = [];
    for (const [index, counter] of keys.entries()) {
      statements.push(this.prepareConsume(counter, policy, nowMs, index === 0));
    }
    // changes() stops later counters after the first exhausted allowance.
    // The first statement ignores the preceding deployment-fence result.
    const results = await this.input.batch<D1ResultLike<D1EmailOtpRateLimitRow>>(statements);
    if (results.length !== keys.length) throw new Error('OTP counter batch omitted results');
    for (const [index, result] of results.entries()) {
      if (!result.success) throw new Error('OTP counter batch failed');
      if (result.results?.length) continue;
      return emailOtpRateLimitExceeded(await this.readCounter(keys[index]));
    }
    return { ok: true };
  }

  private prepareConsume(
    counter: EmailOtpCounterKey,
    policy: EmailOtpRateLimitPolicy,
    nowMs: number,
    first: boolean,
  ): D1PreparedStatementLike {
    const resetAtMs = nowMs + policy.windowMs;
    let walletId: string | null;
    switch (counter.kind) {
      case 'wallet':
        walletId = counter.walletId;
        break;
      case 'regional':
        walletId = null;
        break;
      default:
        return assertNever(counter);
    }
    const table = walletId === null ? 'email_otp_rate_limits' : 'wallet_email_otp_rate_limits';
    const ownerColumn = walletId === null ? '' : 'wallet_id,';
    const ownerPlaceholder = walletId === null ? '' : '?,';
    const ownerValues = walletId === null ? [] : [walletId];
    return this.input.prepare(
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
      SELECT ?, ?, ?, ?, ${ownerPlaceholder} ?, 1, ?, ?
      WHERE ? OR changes() > 0
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
        counter.key,
        resetAtMs,
        nowMs,
        first ? 1 : 0,
        nowMs,
        nowMs,
        resetAtMs,
        nowMs,
        nowMs,
        policy.limit,
      ],
    );
  }

  private async readCounter(counter: EmailOtpCounterKey): Promise<D1EmailOtpRateLimitRow | null> {
    const walletId = counter.kind === 'wallet' ? counter.walletId : null;
    const table = walletId === null ? 'email_otp_rate_limits' : 'wallet_email_otp_rate_limits';
    const ownerValues = walletId === null ? [] : [walletId];
    return this.input
      .prepare(
        `SELECT consumed_count, reset_at_ms
         FROM ${table}
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          ${walletId === null ? '' : 'AND wallet_id = ?'}
          AND rate_key = ?
        LIMIT 1`,
        [...ownerValues, counter.key],
      )
      .first<D1EmailOtpRateLimitRow>();
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected OTP counter ownership: ${String(value)}`);
}
