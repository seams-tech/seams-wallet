// The Email OTP statements the Cloudflare D1 stores (router/cloudflare/d1/emailOtp) run. Each binds
// the tenant scope first, through the caller's `prepare`, and the statement's own values after it.
import { EMAIL_OTP_CHANNEL } from '@shared/utils/emailOtpDomain';
import type { D1PreparedStatementLike } from '../storage/tenantRoute';
import { runtimePolicyScopeKey } from './EmailOtpRecords';
import type {
  EmailOtpAuthStateRecord,
  EmailOtpChallengeRecord,
  EmailOtpGrantRecord,
  EmailOtpUnlockChallengeRecord,
  EmailOtpWalletEnrollmentRecord,
  GoogleEmailOtpRegistrationAttemptRecord,
  GoogleEmailOtpRegistrationAttemptScopeInput,
  NonEmptyGoogleEmailOtpRegistrationOfferCandidates,
} from './EmailOtpStores';

/** Prepares `sql` with the tenant scope bound to its first four parameters and `values` after. */
export type ScopedD1Prepare = (sql: string, values: readonly unknown[]) => D1PreparedStatementLike;

const INSERT_CHALLENGE_SQL = `INSERT INTO email_otp_challenges (
        namespace,
        org_id,
        project_id,
        env_id,
        challenge_id,
        challenge_subject_id,
        wallet_id,
        record_org_id,
        otp_channel,
        owner_proof_binding_digest,
        action,
        operation,
        otp_code,
        record_json,
        created_at_ms,
        expires_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

// Binds a parsed record, whose channel is always EMAIL_OTP_CHANNEL.
function challengeValues(record: EmailOtpChallengeRecord): readonly unknown[] {
  return [
    record.challengeId,
    record.challengeSubjectId,
    record.walletId,
    record.orgId || '',
    EMAIL_OTP_CHANNEL,
    record.ownerProofBindingDigest,
    record.action,
    record.operation,
    record.otpCode,
    JSON.stringify(record),
    record.createdAtMs,
    record.expiresAtMs,
  ];
}

/** Statements on `email_otp_challenges`. */
export const emailOtpChallengeRows = {
  insert: (prepare: ScopedD1Prepare, record: EmailOtpChallengeRecord) =>
    prepare(INSERT_CHALLENGE_SQL, challengeValues(record)),

  delete: (prepare: ScopedD1Prepare, challengeId: string) =>
    prepare(
      `DELETE FROM email_otp_challenges
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND challenge_id = ?`,
      [challengeId],
    ),
};

const INSERT_GRANT_SQL = `INSERT INTO email_otp_grants (
        namespace,
        org_id,
        project_id,
        env_id,
        grant_token,
        user_id,
        wallet_id,
        record_org_id,
        challenge_id,
        action,
        record_json,
        issued_at_ms,
        expires_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function grantValues(record: EmailOtpGrantRecord): readonly unknown[] {
  return [
    record.grantToken,
    record.userId,
    record.walletId,
    record.orgId || '',
    record.challengeId,
    record.action,
    JSON.stringify(record),
    record.issuedAtMs,
    record.expiresAtMs,
  ];
}

/** Statements on `email_otp_grants`. */
export const emailOtpGrantRows = {
  insert: (prepare: ScopedD1Prepare, record: EmailOtpGrantRecord) =>
    prepare(INSERT_GRANT_SQL, grantValues(record)),

  consume: (prepare: ScopedD1Prepare, grantToken: string) =>
    prepare(
      `DELETE FROM email_otp_grants
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND grant_token = ?
      RETURNING record_json, expires_at_ms`,
      [grantToken],
    ),
};

const INSERT_WALLET_ENROLLMENT_SQL = `INSERT INTO email_otp_wallet_enrollments (
        namespace,
        org_id,
        project_id,
        env_id,
        wallet_id,
        provider_user_id,
        record_org_id,
        verified_email,
        record_json,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function walletEnrollmentValues(record: EmailOtpWalletEnrollmentRecord): readonly unknown[] {
  return [
    record.walletId,
    record.providerUserId,
    record.orgId,
    record.verifiedEmail,
    JSON.stringify(record),
    record.createdAtMs,
    record.updatedAtMs,
  ];
}

/** Statements on `email_otp_wallet_enrollments`. */
export const emailOtpWalletEnrollmentRows = {
  insert: (prepare: ScopedD1Prepare, record: EmailOtpWalletEnrollmentRecord) =>
    prepare(INSERT_WALLET_ENROLLMENT_SQL, walletEnrollmentValues(record)),

  upsert: (prepare: ScopedD1Prepare, record: EmailOtpWalletEnrollmentRecord) =>
    prepare(
      `${INSERT_WALLET_ENROLLMENT_SQL}
      ON CONFLICT (namespace, org_id, project_id, env_id, wallet_id)
      DO UPDATE SET
        provider_user_id = EXCLUDED.provider_user_id,
        record_org_id = EXCLUDED.record_org_id,
        verified_email = EXCLUDED.verified_email,
        record_json = EXCLUDED.record_json,
        created_at_ms = EXCLUDED.created_at_ms,
        updated_at_ms = EXCLUDED.updated_at_ms`,
      walletEnrollmentValues(record),
    ),

  delete: (prepare: ScopedD1Prepare, walletId: string) =>
    prepare(
      `DELETE FROM email_otp_wallet_enrollments
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND wallet_id = ?`,
      [walletId],
    ),
};

/** Statements on `email_otp_auth_states`. */
export const emailOtpAuthStateRows = {
  select: (prepare: ScopedD1Prepare, walletId: string) =>
    prepare(
      `SELECT record_json, updated_at_ms
         FROM email_otp_auth_states
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND wallet_id = ?
        LIMIT 1`,
      [walletId],
    ),

  upsert: (prepare: ScopedD1Prepare, record: EmailOtpAuthStateRecord) =>
    prepare(
      `INSERT INTO email_otp_auth_states (
        namespace,
        org_id,
        project_id,
        env_id,
        wallet_id,
        provider_user_id,
        record_org_id,
        record_json,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, org_id, project_id, env_id, wallet_id)
      DO UPDATE SET
        provider_user_id = EXCLUDED.provider_user_id,
        record_org_id = EXCLUDED.record_org_id,
        record_json = EXCLUDED.record_json,
        created_at_ms = EXCLUDED.created_at_ms,
        updated_at_ms = EXCLUDED.updated_at_ms`,
      [
        record.walletId,
        record.providerUserId,
        record.orgId,
        JSON.stringify(record),
        record.createdAtMs,
        record.updatedAtMs,
      ],
    ),
};

const INSERT_UNLOCK_CHALLENGE_SQL = `INSERT INTO email_otp_unlock_challenges (
        namespace,
        org_id,
        project_id,
        env_id,
        challenge_id,
        wallet_id,
        user_id,
        record_org_id,
        record_json,
        created_at_ms,
        expires_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function unlockChallengeValues(record: EmailOtpUnlockChallengeRecord): readonly unknown[] {
  return [
    record.challengeId,
    record.walletId,
    record.userId,
    record.orgId || '',
    JSON.stringify(record),
    record.createdAtMs,
    record.expiresAtMs,
  ];
}

/** Statements on `email_otp_unlock_challenges`. */
export const emailOtpUnlockChallengeRows = {
  insert: (prepare: ScopedD1Prepare, record: EmailOtpUnlockChallengeRecord) =>
    prepare(INSERT_UNLOCK_CHALLENGE_SQL, unlockChallengeValues(record)),

  consume: (prepare: ScopedD1Prepare, challengeId: string) =>
    prepare(
      `DELETE FROM email_otp_unlock_challenges
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND challenge_id = ?
      RETURNING record_json, expires_at_ms`,
      [challengeId],
    ),
};

function offerWalletIdsJson(candidates: NonEmptyGoogleEmailOtpRegistrationOfferCandidates): string {
  const walletIds: string[] = [];
  for (const candidate of candidates) walletIds.push(candidate.walletId);
  return JSON.stringify(walletIds);
}

// Live attempts for one subject and email; binds the subject, the email and the time.
const PENDING_ATTEMPTS_SQL = `SELECT record_json, expires_at_ms, updated_at_ms, attempt_id
         FROM email_otp_registration_attempts
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND provider_subject = ?
          AND email = ?
          AND state IN ('started', 'key_finalized')
          AND expires_at_ms > ?`;

/** Statements on `email_otp_registration_attempts`. */
export const emailOtpRegistrationAttemptRows = {
  insertPendingIfAbsent: (
    prepare: ScopedD1Prepare,
    record: GoogleEmailOtpRegistrationAttemptRecord,
  ) =>
    prepare(
      `WITH candidate (
        namespace, org_id, project_id, env_id, attempt_id, provider_subject, email,
        wallet_id, state, owner_proof_binding_digest, runtime_org_id, runtime_policy_key,
        offer_wallet_ids_json, record_json, created_at_ms, updated_at_ms, expires_at_ms
      ) AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?))
      INSERT INTO email_otp_registration_attempts (
        namespace, org_id, project_id, env_id, attempt_id, provider_subject, email,
        wallet_id, state, owner_proof_binding_digest, runtime_org_id, runtime_policy_key,
        offer_wallet_ids_json, record_json, created_at_ms, updated_at_ms, expires_at_ms
      )
      SELECT * FROM candidate
      WHERE NOT EXISTS (
        SELECT 1 FROM email_otp_registration_attempts existing
        WHERE existing.namespace = candidate.namespace
          AND existing.org_id = candidate.org_id
          AND existing.project_id = candidate.project_id
          AND existing.env_id = candidate.env_id
          AND existing.provider_subject = candidate.provider_subject
          AND existing.email = candidate.email
          AND existing.owner_proof_binding_digest = candidate.owner_proof_binding_digest
          AND existing.runtime_org_id = candidate.runtime_org_id
          AND existing.runtime_policy_key = candidate.runtime_policy_key
          AND existing.state IN ('started', 'key_finalized')
          AND (existing.expires_at_ms > candidate.created_at_ms OR existing.selection_digest IS NOT NULL)
      )`,
      registrationAttemptValues(record),
    ),

  claimCandidate: (
    prepare: ScopedD1Prepare,
    input: {
      readonly attemptId: string;
      readonly candidateId: string;
      readonly walletId: string;
      readonly intentDigest: string;
      readonly nowMs: number;
    },
  ) =>
    prepare(
      `WITH scope AS (SELECT ? AS namespace, ? AS org_id, ? AS project_id, ? AS env_id)
    UPDATE email_otp_registration_attempts
    SET wallet_id = ?, selection_digest = ?,
      record_json = json_set(record_json,
        '$.walletId', ?, '$.selectedCandidateId', ?,
        '$.collisionCounter', (
          SELECT json_extract(value, '$.collisionCounter')
          FROM json_each(record_json, '$.offerCandidates')
          WHERE json_extract(value, '$.candidateId') = ?
        ), '$.updatedAtMs', MAX(updated_at_ms, ?)),
      updated_at_ms = MAX(updated_at_ms, ?)
    WHERE namespace = (SELECT namespace FROM scope)
      AND org_id = (SELECT org_id FROM scope)
      AND project_id = (SELECT project_id FROM scope)
      AND env_id = (SELECT env_id FROM scope)
      AND attempt_id = ? AND state IN ('started', 'key_finalized') AND expires_at_ms > ?
      AND EXISTS (
        SELECT 1 FROM json_each(record_json, '$.offerCandidates')
        WHERE json_extract(value, '$.candidateId') = ? AND json_extract(value, '$.walletId') = ?
      )
      AND (selection_digest IS NULL OR (
        selection_digest = ? AND wallet_id = ? AND json_extract(record_json, '$.selectedCandidateId') = ?
      ))`,
      [
        input.walletId,
        input.intentDigest,
        input.walletId,
        input.candidateId,
        input.candidateId,
        input.nowMs,
        input.nowMs,
        input.attemptId,
        input.nowMs,
        input.candidateId,
        input.walletId,
        input.intentDigest,
        input.walletId,
        input.candidateId,
      ],
    ),

  updatePending: (prepare: ScopedD1Prepare, record: GoogleEmailOtpRegistrationAttemptRecord) =>
    prepare(
      `WITH scope AS (SELECT ? AS namespace, ? AS org_id, ? AS project_id, ? AS env_id)
      UPDATE email_otp_registration_attempts
      SET wallet_id = ?, state = ?, record_json = ?, updated_at_ms = ?
      WHERE namespace = (SELECT namespace FROM scope)
        AND org_id = (SELECT org_id FROM scope)
        AND project_id = (SELECT project_id FROM scope)
        AND env_id = (SELECT env_id FROM scope)
        AND attempt_id = ?
        AND state IN ('started', 'key_finalized')
        AND wallet_id = ?
        AND json_extract(record_json, '$.selectedCandidateId') = ?
        AND NOT (state = 'key_finalized' AND ? = 'started')
        AND (? NOT IN ('abandoned', 'expired') OR selection_digest IS NULL)
        AND ? <> 'active'
        AND updated_at_ms <= ?`,
      [
        record.walletId,
        record.state,
        JSON.stringify(record),
        record.updatedAtMs,
        record.attemptId,
        record.walletId,
        record.selectedCandidateId,
        record.state,
        record.state,
        record.state,
        record.updatedAtMs,
      ],
    ),

  select: (prepare: ScopedD1Prepare, attemptId: string) =>
    prepare(
      `SELECT record_json, expires_at_ms, updated_at_ms, attempt_id
         FROM email_otp_registration_attempts
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND attempt_id = ?
        LIMIT 1`,
      [attemptId],
    ),

  /** The latest live attempt for the subject, email, owner binding and runtime scope. */
  selectStarted: (
    prepare: ScopedD1Prepare,
    input: Readonly<GoogleEmailOtpRegistrationAttemptScopeInput>,
  ) =>
    prepare(
      `${PENDING_ATTEMPTS_SQL}
          AND owner_proof_binding_digest = ?
          AND runtime_org_id = ?
          AND runtime_policy_key = ?
        ORDER BY updated_at_ms DESC
        LIMIT 1`,
      [
        input.providerSubject,
        input.email,
        input.nowMs,
        input.ownerProofBindingDigest,
        input.orgId,
        runtimePolicyScopeKey(input.runtimePolicyScope),
      ],
    ),

  /** Every live attempt for the subject and email, whatever its binding. */
  selectPending: (
    prepare: ScopedD1Prepare,
    input: { readonly providerSubject: string; readonly email: string; readonly nowMs: number },
  ) => prepare(PENDING_ATTEMPTS_SQL, [input.providerSubject, input.email, input.nowMs]),

  /** Deletes the attempts that have expired or were marked expired. */
  deleteExpired: (prepare: ScopedD1Prepare, nowMs: number) =>
    prepare(
      `DELETE FROM email_otp_registration_attempts
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND state <> 'active' AND selection_digest IS NULL
          AND (expires_at_ms <= ? OR state = 'expired')`,
      [nowMs],
    ),

  /** Finds a live attempt that selected or offered the wallet. */
  selectLiveForWallet: (prepare: ScopedD1Prepare, walletId: string, nowMs: number) =>
    prepare(
      `SELECT 1 AS found
         FROM email_otp_registration_attempts
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND state IN ('started', 'key_finalized')
          AND expires_at_ms > ?
          AND (
            wallet_id = ?
            OR EXISTS (
              SELECT 1
                FROM json_each(offer_wallet_ids_json)
               WHERE value = ?
            )
          )
        LIMIT 1`,
      [nowMs, walletId, walletId],
    ),

  delete: (prepare: ScopedD1Prepare, attemptId: string) =>
    prepare(
      `DELETE FROM email_otp_registration_attempts
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND attempt_id = ?`,
      [attemptId],
    ),
};

function registrationAttemptValues(
  record: GoogleEmailOtpRegistrationAttemptRecord,
): readonly unknown[] {
  return [
    record.attemptId,
    record.providerSubject,
    record.email,
    record.walletId,
    record.state,
    record.ownerProofBindingDigest,
    record.runtimePolicyScope?.orgId || '',
    runtimePolicyScopeKey(record.runtimePolicyScope),
    offerWalletIdsJson(record.offerCandidates),
    JSON.stringify(record),
    record.createdAtMs,
    record.updatedAtMs,
    record.expiresAtMs,
  ];
}
