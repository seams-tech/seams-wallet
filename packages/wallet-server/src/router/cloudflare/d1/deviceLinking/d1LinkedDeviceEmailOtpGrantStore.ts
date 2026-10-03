/**
 * D1 persistence for linked-device Email OTP verification grants.
 *
 * A grant is issued once, after the emailed code verifies against the exact
 * link-session binding, and consumed exactly once. The CAS guard makes a lost
 * consumption fail that whole batch, so a grant can never authorize two
 * completions.
 */
import {
  parseLinkedDeviceEmailOtpGrantRecordV1,
  type LinkedDeviceEmailOtpGrantRecordV1,
} from '../../../../core/deviceLinking/linkedDeviceEmailOtpGrant';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import { d1ChangedRows } from '../../../../storage/d1Sql';
import {
  SESSION_CAS_GUARD_SQL,
  type D1LinkedDeviceSessionScopeV1,
} from './d1LinkedDeviceSessionStore';

const GRANT_TABLE = 'linked_device_email_otp_grants';

export class D1LinkedDeviceEmailOtpGrantStoreV1 {
  private readonly database: D1DatabaseLike;
  private readonly scope: D1LinkedDeviceSessionScopeV1;

  constructor(input: {
    readonly database: D1DatabaseLike;
    readonly scope: D1LinkedDeviceSessionScopeV1;
  }) {
    this.database = input.database;
    this.scope = input.scope;
  }

  async issueV1(record: LinkedDeviceEmailOtpGrantRecordV1): Promise<
    | { readonly kind: 'issued' }
    | { readonly kind: 'refused'; readonly code: 'link_session_inactive'; readonly message: string }
  > {
    const parsed = parseLinkedDeviceEmailOtpGrantRecordV1(record);
    if (parsed.state.kind !== 'issued') {
      throw new Error('a linked-device email OTP grant is only ever inserted as issued');
    }
    const issued = await this.database
      .prepare(
        `INSERT INTO ${GRANT_TABLE} (
           namespace, org_id, project_id, env_id, grant_id,
           grant_token_digest_b64u, wallet_id, link_session_id, enrollment_id,
           device_id, target_factor, target_preparation_digest_b64u,
           target_email, enrollment_kind, email_hash_hex,
           registration_authority_id, provider_user_id,
           base_wallet_auth_method_id, linked_owner_auth_method_id,
           authority_digest_b64u, challenge_id, state, record_json,
           issued_at_ms, expires_at_ms, consumed_at_ms
         ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'email_otp',
                  ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, 'issued', ?21, ?22, ?23, NULL
             FROM linked_device_sessions
            WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
              AND link_session_id = ?8 AND state = 'awaiting_target_factor'`,
      )
      .bind(
        ...scopeValues(this.scope),
        parsed.grantId,
        parsed.grantTokenDigestB64u,
        String(parsed.walletId),
        String(parsed.linkSessionId),
        String(parsed.enrollmentId),
        String(parsed.deviceId),
        parsed.targetPreparationDigestB64u,
        parsed.targetEmail,
        parsed.enrollment.kind,
        parsed.emailHashHex,
        parsed.registrationAuthorityId,
        parsed.providerUserId,
        parsed.baseWalletAuthMethodId ?? null,
        String(parsed.walletAuthMethodId),
        parsed.authorityDigestB64u,
        parsed.challengeId,
        serializeGrantForD1(parsed),
        parsed.issuedAtMs,
        parsed.expiresAtMs,
      )
      .run();
    if (d1ChangedRows(issued) === 1) return { kind: 'issued' };
    return {
      kind: 'refused',
      code: 'link_session_inactive',
      message: 'linked-device session no longer accepts Email OTP grants',
    };
  }

  async readByIdV1(grantId: string): Promise<LinkedDeviceEmailOtpGrantRecordV1 | null> {
    const row = await this.database
      .prepare(
        `SELECT json_set(
                  json_remove(record_json, '$.linkedOwnerAuthMethodId'),
                  '$.walletAuthMethodId',
                  linked_owner_auth_method_id
                ) AS record_json FROM ${GRANT_TABLE}
          WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
            AND grant_id = ? LIMIT 1`,
      )
      .bind(...scopeValues(this.scope), grantId)
      .first<{ readonly record_json?: unknown }>();
    if (!row) return null;
    if (typeof row.record_json !== 'string') {
      throw new Error('linked-device email OTP grant record is invalid');
    }
    return parseLinkedDeviceEmailOtpGrantRecordV1(JSON.parse(row.record_json));
  }

  /**
   * The consumption as statements: a CAS flip from `issued` to `consumed`
   * followed by the guard, so a batch that includes them either consumed the
   * grant exactly now or did not commit at all.
   */
  buildConsumeStatementsV1(input: {
    readonly grantId: string;
    readonly consumedAtMs: number;
  }): readonly D1PreparedStatementLike[] {
    return [
      this.database
        .prepare(
          `UPDATE ${GRANT_TABLE}
              SET state = 'consumed', consumed_at_ms = ?,
                  record_json = json_set(
                    record_json,
                    '$.state', json_object('kind', 'consumed', 'consumedAtMs', ?)
                  )
            WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
              AND grant_id = ? AND state = 'issued' AND expires_at_ms > ?`,
        )
        .bind(
          input.consumedAtMs,
          input.consumedAtMs,
          ...scopeValues(this.scope),
          input.grantId,
          input.consumedAtMs,
        ),
      this.database.prepare(SESSION_CAS_GUARD_SQL),
    ];
  }
}

function serializeGrantForD1(record: LinkedDeviceEmailOtpGrantRecordV1): string {
  const { walletAuthMethodId, ...persisted } = record;
  return JSON.stringify({ ...persisted, linkedOwnerAuthMethodId: walletAuthMethodId });
}

function scopeValues(scope: D1LinkedDeviceSessionScopeV1): readonly string[] {
  return [scope.namespace, scope.orgId, scope.projectId, scope.envId];
}
