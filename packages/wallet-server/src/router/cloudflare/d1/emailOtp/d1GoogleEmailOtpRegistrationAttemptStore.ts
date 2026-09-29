import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import {
  registrationAttemptMatchesReplacementScope,
  registrationAttemptMatchesStartedScope,
} from '../../../../core/EmailOtpRecords';
import type {
  GoogleEmailOtpRegistrationAttemptRecord,
  NonEmptyGoogleEmailOtpRegistrationOfferCandidates,
  PendingGoogleEmailOtpRegistrationAttemptRecord,
} from '../../../../core/EmailOtpStores';
import {
  emailOtpRegistrationAttemptRows,
  type ScopedD1Prepare,
} from '../../../../core/emailOtpD1Statements';
import { d1MutationChanges } from '../auth/d1RouterApiAuthBoundary';
import {
  abandonedGoogleEmailOtpRegistrationAttemptRecord,
  parseGoogleEmailOtpRegistrationAttemptRow,
  pendingGoogleEmailOtpRegistrationAttemptWithUpdatedAt,
  type D1EmailOtpRegistrationAttemptRow,
} from './d1GoogleEmailOtpRegistrationRecords';

export class CloudflareD1GoogleEmailOtpRegistrationAttemptStore {
  private readonly prepare: ScopedD1Prepare;
  private readonly orgId: string;

  constructor(input: { readonly prepare: ScopedD1Prepare; readonly orgId: string }) {
    this.prepare = input.prepare;
    this.orgId = input.orgId;
  }

  async cleanupExpired(nowMs: number): Promise<number> {
    return d1MutationChanges(
      await emailOtpRegistrationAttemptRows.deleteExpired(this.prepare, nowMs).run(),
    );
  }

  async create(input: {
    readonly providerSubject: string;
    readonly email: string;
    readonly walletId: string;
    readonly offerId: string;
    readonly offerCandidates: NonEmptyGoogleEmailOtpRegistrationOfferCandidates;
    readonly selectedCandidateId: string;
    readonly ownerProofBindingDigest: string;
    readonly authProvider: string;
    readonly walletIdDerivationNonce: string;
    readonly collisionCounter: number;
    readonly runtimePolicyScope: RuntimePolicyScope;
  }): Promise<PendingGoogleEmailOtpRegistrationAttemptRecord> {
    const nowMs = Date.now();
    await this.cleanupExpired(nowMs);
    const attempt: PendingGoogleEmailOtpRegistrationAttemptRecord = {
      version: 'google_email_otp_registration_attempt_v1',
      attemptId: secureRandomBase64Url(18, 'google email otp registration attempt ids'),
      providerSubject: input.providerSubject,
      email: input.email,
      walletId: input.walletId,
      offerId: input.offerId,
      offerCandidates: input.offerCandidates,
      selectedCandidateId: input.selectedCandidateId,
      ownerProofBindingDigest: input.ownerProofBindingDigest,
      authProvider: input.authProvider,
      accountIdSlugVersion: 'hmac_readable_v1',
      walletIdDerivationNonce: input.walletIdDerivationNonce,
      collisionCounter: input.collisionCounter,
      state: 'started',
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      expiresAtMs: nowMs + 30 * 60_000,
      runtimePolicyScope: input.runtimePolicyScope,
    };
    await this.put(attempt);
    return attempt;
  }

  async findStarted(input: {
    readonly providerSubject: string;
    readonly email: string;
    readonly orgId: string;
    readonly ownerProofBindingDigest: string;
    readonly runtimePolicyScope: RuntimePolicyScope;
  }): Promise<PendingGoogleEmailOtpRegistrationAttemptRecord | null> {
    const nowMs = Date.now();
    await this.cleanupExpired(nowMs);
    const scope = { ...input, nowMs };
    const row = await emailOtpRegistrationAttemptRows
      .selectStarted(this.prepare, scope)
      .first<D1EmailOtpRegistrationAttemptRow>();
    const parsed = parseGoogleEmailOtpRegistrationAttemptRow(row);
    if (!parsed) {
      const malformedAttemptId = toOptionalTrimmedString(row?.attempt_id);
      if (malformedAttemptId) await this.delete(malformedAttemptId);
      return null;
    }
    if (!registrationAttemptMatchesStartedScope(parsed, scope)) return null;
    const refreshed = pendingGoogleEmailOtpRegistrationAttemptWithUpdatedAt(parsed, nowMs);
    await this.put(refreshed);
    return refreshed;
  }

  async abandonStartedExceptBinding(input: {
    readonly providerSubject: string;
    readonly email: string;
    readonly orgId: string;
    readonly ownerProofBindingDigest: string;
    readonly runtimePolicyScope: RuntimePolicyScope;
    readonly nowMs: number;
    readonly failureCode: 'owner_proof_binding_replaced';
  }): Promise<void> {
    const result = await emailOtpRegistrationAttemptRows
      .selectPending(this.prepare, input)
      .all<D1EmailOtpRegistrationAttemptRow>();
    for (const row of result.results || []) {
      const parsed = parseGoogleEmailOtpRegistrationAttemptRow(row);
      if (!parsed) {
        const malformedAttemptId = toOptionalTrimmedString(row.attempt_id);
        if (malformedAttemptId) await this.delete(malformedAttemptId);
        continue;
      }
      if (!registrationAttemptMatchesReplacementScope(parsed, input)) continue;
      await this.put(
        abandonedGoogleEmailOtpRegistrationAttemptRecord({
          record: parsed,
          failureCode: input.failureCode,
          updatedAtMs: input.nowMs,
        }),
      );
    }
  }

  async hasLiveStartedWalletAttempt(input: {
    readonly walletId: string;
    readonly nowMs: number;
  }): Promise<boolean> {
    const row = await emailOtpRegistrationAttemptRows
      .selectLiveForWallet(this.prepare, input.walletId, input.nowMs)
      .first<{ readonly found?: unknown }>();
    return Boolean(row);
  }

  async read(attemptId: string): Promise<GoogleEmailOtpRegistrationAttemptRecord | null> {
    const row = await emailOtpRegistrationAttemptRows
      .select(this.prepare, attemptId)
      .first<D1EmailOtpRegistrationAttemptRow>();
    const record = parseGoogleEmailOtpRegistrationAttemptRow(row);
    return record?.runtimePolicyScope?.orgId === this.orgId ? record : null;
  }

  async put(record: GoogleEmailOtpRegistrationAttemptRecord): Promise<void> {
    if (record.runtimePolicyScope?.orgId !== this.orgId) {
      throw new Error('Google Email OTP registration attempt org scope mismatch');
    }
    await emailOtpRegistrationAttemptRows.upsert(this.prepare, record).run();
  }

  async delete(attemptId: string): Promise<void> {
    await emailOtpRegistrationAttemptRows.delete(this.prepare, attemptId).run();
  }
}
