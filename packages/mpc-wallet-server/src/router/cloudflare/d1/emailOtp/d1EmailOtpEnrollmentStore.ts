import {
  EMAIL_OTP_ENROLLMENT_FACTOR_LIMIT,
  type EmailOtpAuthStateRecord,
  type EmailOtpEnrollmentFactorRecord,
  type EmailOtpWalletEnrollmentRecord,
} from '../../../../core/EmailOtpStores';
import {
  emailOtpAuthStateRows,
  emailOtpWalletEnrollmentRows,
  type ScopedD1Prepare,
} from '../../../../core/emailOtpD1Statements';
import type { D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type { EmailOtpAuthStateReadResult as CoreEmailOtpAuthStateReadResult } from '../../../../core/authService/emailOtpEnrollment';
import {
  emailOtpAuthStateRecord,
  parseEmailOtpAuthStateRow,
  parseEmailOtpWalletEnrollmentRow,
  type D1EmailOtpAuthStateRow,
  type D1EmailOtpEnrollmentRow,
  type EmailOtpAuthStatePatch,
} from './d1EmailOtpRecords';

export type EmailOtpAuthStateReadResult = Readonly<CoreEmailOtpAuthStateReadResult>;

export class CloudflareD1EmailOtpEnrollmentStore {
  private readonly prepare: ScopedD1Prepare;

  constructor(input: { readonly prepare: ScopedD1Prepare }) {
    this.prepare = input.prepare;
  }

  async readEnrollment(walletId: string): Promise<EmailOtpWalletEnrollmentRecord | null> {
    const row = await this.prepare(
      `SELECT record_json, updated_at_ms
         FROM email_otp_wallet_enrollments
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND wallet_id = ?
        LIMIT 1`,
      [walletId],
    ).first<D1EmailOtpEnrollmentRow>();
    return parseEmailOtpWalletEnrollmentRow(row);
  }

  async readEnrollmentByProviderUserId(input: {
    readonly providerUserId: string;
    readonly orgId: string;
  }): Promise<EmailOtpWalletEnrollmentRecord | null> {
    const row = await this.prepare(
      `SELECT record_json, updated_at_ms
         FROM email_otp_wallet_enrollments
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND provider_user_id = ?
          AND record_org_id = ?
        ORDER BY updated_at_ms DESC
        LIMIT 1`,
      [input.providerUserId, input.orgId],
    ).first<D1EmailOtpEnrollmentRow>();
    return parseEmailOtpWalletEnrollmentRow(row);
  }

  async signerWalletExists(walletId: string): Promise<boolean> {
    const row = await this.prepare(
      `SELECT 1 AS found
         FROM wallets
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND wallet_id = ?
        LIMIT 1`,
      [walletId],
    ).first<{ readonly found?: unknown }>();
    return Boolean(row);
  }

  async deleteEnrollment(walletId: string): Promise<void> {
    await this.prepareDeleteEnrollmentStatement(walletId).run();
  }

  /**
   * The statements that follow the revocation of an Email OTP method, in the
   * same batch: remove the method's factor, then delete the enrollment once it
   * has no factor or no unrevoked Email OTP method.
   *
   * The enrollment is shared: every Email OTP method of the wallet checks its
   * codes through it, and each method keeps its own factor in it. So revoking
   * one method removes only its factor. The delete tests its predicate inside
   * the statement rather than in a read taken beforehand, so a method that
   * activates at the same time cannot lose its enrollment between the check
   * and the delete. Sequenced after the method revocation, the revoked method
   * already reads as revoked here.
   */
  prepareRevokedMethodStatements(input: {
    readonly walletId: string;
    readonly walletAuthMethodId: string;
    readonly revokedAtMs: number;
  }): readonly D1PreparedStatementLike[] {
    return [
      emailOtpWalletEnrollmentRows.removeMethodFactor(this.prepare, {
        walletId: input.walletId,
        walletAuthMethodId: input.walletAuthMethodId,
        nowMs: input.revokedAtMs,
      }),
      this.prepare(
        `DELETE FROM email_otp_wallet_enrollments
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND wallet_id = ?
            AND (
              json_array_length(record_json, '$.factors') = 0
              OR NOT EXISTS (
                SELECT 1
                  FROM wallet_auth_methods
                 WHERE wallet_auth_methods.namespace = email_otp_wallet_enrollments.namespace
                   AND wallet_auth_methods.org_id = email_otp_wallet_enrollments.org_id
                   AND wallet_auth_methods.project_id = email_otp_wallet_enrollments.project_id
                   AND wallet_auth_methods.env_id = email_otp_wallet_enrollments.env_id
                   AND wallet_auth_methods.wallet_id = email_otp_wallet_enrollments.wallet_id
                   AND wallet_auth_methods.kind = 'email_otp'
                   AND wallet_auth_methods.status <> 'revoked'
              )
            )`,
        [input.walletId],
      ),
    ];
  }

  prepareDeleteEnrollmentStatement(walletId: string): D1PreparedStatementLike {
    return emailOtpWalletEnrollmentRows.delete(this.prepare, walletId);
  }

  async putEnrollment(record: EmailOtpWalletEnrollmentRecord): Promise<void> {
    await this.preparePutEnrollmentStatement(record).run();
  }

  preparePutEnrollmentStatement(
    record: EmailOtpWalletEnrollmentRecord,
  ): D1PreparedStatementLike {
    return emailOtpWalletEnrollmentRows.upsert(this.prepare, record);
  }

  /**
   * Adds a method's factor to the enrollment `expected` names. The guard after the update fails
   * the caller's batch when that enrollment changed, so the factor is never lost silently.
   */
  prepareAddMethodFactorStatements(input: {
    readonly expected: EmailOtpWalletEnrollmentRecord;
    readonly factor: EmailOtpEnrollmentFactorRecord;
    readonly nowMs: number;
  }): readonly D1PreparedStatementLike[] {
    return [
      emailOtpWalletEnrollmentRows.addMethodFactor(this.prepare, {
        enrollment: input.expected,
        factor: input.factor,
        factorLimit: EMAIL_OTP_ENROLLMENT_FACTOR_LIMIT,
        nowMs: input.nowMs,
      }),
      emailOtpWalletEnrollmentRows.batchGuard(this.prepare),
    ];
  }

  /** Inserts the first enrollment without turning a concurrent winner into an update. */
  prepareInsertEnrollmentStatement(
    record: EmailOtpWalletEnrollmentRecord,
  ): D1PreparedStatementLike {
    return emailOtpWalletEnrollmentRows.insert(this.prepare, record);
  }

  async readAuthState(walletId: string): Promise<EmailOtpAuthStateRecord | null> {
    const row = await emailOtpAuthStateRows
      .select(this.prepare, walletId)
      .first<D1EmailOtpAuthStateRow>();
    return parseEmailOtpAuthStateRow(row);
  }

  async readAuthStateForEnrollment(
    enrollment: EmailOtpWalletEnrollmentRecord,
  ): Promise<EmailOtpAuthStateReadResult> {
    const state = await this.readAuthState(enrollment.walletId);
    if (!state) return { ok: true, state: null };
    if (state.orgId !== enrollment.orgId || state.providerUserId !== enrollment.providerUserId) {
      return {
        ok: false,
        code: 'auth_state_enrollment_mismatch',
        message: 'Email OTP auth state does not match the active enrollment',
      };
    }
    return { ok: true, state };
  }

  async putAuthStateForEnrollment(
    enrollment: EmailOtpWalletEnrollmentRecord,
    patch: EmailOtpAuthStatePatch,
  ): Promise<EmailOtpAuthStateRecord> {
    const nowMs = Date.now();
    const existing = await this.readAuthState(enrollment.walletId);
    if (
      existing &&
      (existing.orgId !== enrollment.orgId || existing.providerUserId !== enrollment.providerUserId)
    ) {
      throw new Error('Email OTP auth state does not match the active enrollment');
    }
    const next = emailOtpAuthStateRecord({
      enrollment,
      existing,
      updatedAtMs: nowMs,
      patch,
    });
    await this.putAuthState(next);
    return next;
  }

  prepareResetAuthStateForEnrollment(input: {
    readonly enrollment: EmailOtpWalletEnrollmentRecord;
    readonly existingState: EmailOtpAuthStateRecord | null;
    readonly updatedAtMs: number;
  }): {
    readonly record: EmailOtpAuthStateRecord;
    readonly statement: D1PreparedStatementLike;
  } {
    const reusableExisting =
      input.existingState &&
      input.existingState.providerUserId === input.enrollment.providerUserId &&
      input.existingState.orgId === input.enrollment.orgId
        ? input.existingState
        : null;
    const next = emailOtpAuthStateRecord({
      enrollment: input.enrollment,
      existing: reusableExisting,
      updatedAtMs: input.updatedAtMs,
      patch: {
        otpFailureCount: 0,
        lastOtpFailureAtMs: null,
        otpLockedUntilMs: null,
      },
    });
    return {
      record: next,
      statement: this.preparePutAuthStateStatement(next),
    };
  }

  async resetFailureState(input: {
    readonly enrollment: EmailOtpWalletEnrollmentRecord;
    readonly authState: EmailOtpAuthStateRecord | null;
  }): Promise<void> {
    const hasFailureState =
      Number(input.authState?.otpFailureCount || 0) > 0 ||
      input.authState?.lastOtpFailureAtMs != null ||
      input.authState?.otpLockedUntilMs != null;
    if (!hasFailureState) return;
    await this.putAuthStateForEnrollment(input.enrollment, {
      otpFailureCount: 0,
      lastOtpFailureAtMs: null,
      otpLockedUntilMs: null,
    });
  }

  private async putAuthState(record: EmailOtpAuthStateRecord): Promise<void> {
    await this.preparePutAuthStateStatement(record).run();
  }

  private preparePutAuthStateStatement(record: EmailOtpAuthStateRecord): D1PreparedStatementLike {
    return emailOtpAuthStateRows.upsert(this.prepare, record);
  }
}
