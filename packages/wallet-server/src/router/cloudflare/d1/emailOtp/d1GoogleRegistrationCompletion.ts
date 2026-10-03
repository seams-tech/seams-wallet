import type { D1DatabaseLike, D1ResultLike } from '../../../../storage/tenantRoute';
import type { ScopedD1Prepare } from '../../../../core/emailOtpD1Statements';

export type GoogleRegistrationCompletionResult =
  | { readonly ok: true; readonly code?: never; readonly message?: never }
  | { readonly ok: false; readonly code: 'registration_incomplete'; readonly message: string };

const PENDING_OFFER = `SELECT * FROM email_otp_registration_attempts
  WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
    AND attempt_id = ? AND wallet_id = ? AND selection_digest IS NOT NULL
    AND state IN ('started', 'key_finalized')`;

export async function completeGoogleRegistration(
  prepare: ScopedD1Prepare,
  batch: D1DatabaseLike['batch'],
  input:
    | {
        readonly kind: 'live_offer';
        readonly attemptId: string;
        readonly walletId: string;
        readonly intentDigest?: never;
      }
    | {
        readonly kind: 'committed_wallet';
        readonly attemptId: string;
        readonly walletId: string;
        readonly intentDigest: string;
      },
): Promise<GoogleRegistrationCompletionResult> {
  const nowMs = Date.now();
  const eligibility =
    input.kind === 'live_offer'
      ? `${PENDING_OFFER} AND expires_at_ms > ?`
      : `${PENDING_OFFER} AND selection_digest = ?`;
  const scopeValues = [
    input.attemptId,
    input.walletId,
    input.kind === 'live_offer' ? nowMs : input.intentDigest,
  ];
  const results = await batch<D1ResultLike<{ readonly completed: number }>>([
    prepare(
      `WITH offer AS (${eligibility})
      INSERT INTO identity_links (
        namespace, org_id, project_id, env_id, subject, user_id, record_json,
        created_at_ms, updated_at_ms
      )
      SELECT namespace, org_id, project_id, env_id, 'wallet:' || provider_subject,
        wallet_id, json_object('version', 'identity_subject_v1',
          'subject', 'wallet:' || provider_subject, 'userId', wallet_id,
          'createdAtMs', ?, 'updatedAtMs', ?), ?, ?
      FROM offer WHERE 1
      ON CONFLICT (namespace, org_id, project_id, env_id, subject) DO UPDATE SET
        user_id = excluded.user_id,
        record_json = json_set(identity_links.record_json,
          '$.userId', excluded.user_id,
          '$.updatedAtMs', MAX(identity_links.updated_at_ms, excluded.updated_at_ms)),
        updated_at_ms = MAX(identity_links.updated_at_ms, excluded.updated_at_ms)
      WHERE identity_links.user_id = excluded.user_id OR (
        SELECT COUNT(*) FROM identity_links old
        WHERE old.namespace = identity_links.namespace AND old.org_id = identity_links.org_id
          AND old.project_id = identity_links.project_id AND old.env_id = identity_links.env_id
          AND old.user_id = identity_links.user_id
      ) = 1`,
      [...scopeValues, nowMs, nowMs, nowMs, nowMs],
    ),
    prepare(
      `WITH offer AS (${eligibility})
      UPDATE email_otp_registration_attempts AS attempt
      SET state = 'active', updated_at_ms = MAX(updated_at_ms, ?),
        record_json = json_set(record_json, '$.state', 'active', '$.updatedAtMs', MAX(updated_at_ms, ?))
      WHERE EXISTS (SELECT 1 FROM offer
        JOIN identity_links link ON link.namespace = offer.namespace AND link.org_id = offer.org_id
          AND link.project_id = offer.project_id AND link.env_id = offer.env_id
          AND link.subject = 'wallet:' || offer.provider_subject AND link.user_id = offer.wallet_id
        WHERE attempt.namespace = offer.namespace AND attempt.org_id = offer.org_id
          AND attempt.project_id = offer.project_id AND attempt.env_id = offer.env_id
          AND attempt.attempt_id = offer.attempt_id)`,
      [...scopeValues, nowMs, nowMs],
    ),
    prepare(
      `SELECT 1 AS completed FROM email_otp_registration_attempts offer
      JOIN identity_links link ON link.namespace = offer.namespace AND link.org_id = offer.org_id
        AND link.project_id = offer.project_id AND link.env_id = offer.env_id
        AND link.subject = 'wallet:' || offer.provider_subject AND link.user_id = offer.wallet_id
      WHERE offer.namespace = ? AND offer.org_id = ? AND offer.project_id = ? AND offer.env_id = ?
        AND offer.attempt_id = ? AND offer.wallet_id = ?
        AND offer.selection_digest IS NOT NULL AND offer.state = 'active'
        ${input.kind === 'committed_wallet' ? 'AND offer.selection_digest = ?' : ''}`,
      input.kind === 'committed_wallet'
        ? [input.attemptId, input.walletId, input.intentDigest]
        : [input.attemptId, input.walletId],
    ),
  ]);
  if (results.some(batchFailed)) throw new Error('Registration completion transaction failed');
  const completion = results[2];
  if (completion?.results?.[0]?.completed === 1) return { ok: true };
  return {
    ok: false,
    code: 'registration_incomplete',
    message: 'Registration offer or identity link is unavailable for completion',
  };
}

function batchFailed(result: D1ResultLike): boolean {
  return !result.success;
}
