import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { parseUnixMs } from '@shared/passkey-custody/primitives';
import {
  computeAuthorizedOperationResultDigest,
  parseAuthorizedOperationReplayResponse,
  type AuthorizedOperation,
  type AuthorizedOperationReplayResponse,
  type CompletedCapabilityOperationResult,
} from '../../../../authorization/domain';
import type {
  StoredWalletOperationEvidence,
  WalletOperationEvidenceLookup,
} from '../../../../authorization/service';
import type { D1TenantScope } from '../../../../core/d1TenantStore';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type { D1Row } from '../../../../storage/d1Sql';

export async function readWalletOperationEvidence(
  database: D1DatabaseLike,
  scope: D1TenantScope,
  input: WalletOperationEvidenceLookup,
): Promise<StoredWalletOperationEvidence | null> {
  const row = await database
    .prepare(
      `SELECT evidence_set_digest, verified_at_ms, expires_at_ms
       FROM verified_wallet_operation_evidence_sets
      WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
        AND tenant_id = ? AND evidence_set_id = ?`,
    )
    .bind(
      scope.namespace,
      scope.orgId,
      scope.projectId,
      scope.envId,
      input.tenantId,
      input.evidenceSetId,
    )
    .first<D1Row>();
  if (!row) return null;
  return {
    evidenceSetDigest: parseDigestB64u(row.evidence_set_digest),
    verifiedAtMs: parseUnixMs(row.verified_at_ms, 'owner evidence verification'),
    expiresAtMs: parseUnixMs(row.expires_at_ms, 'owner evidence expiry'),
  };
}

export async function prepareWalletOperationCompletion(
  database: D1DatabaseLike,
  namespace: string,
  input: {
    readonly operation: AuthorizedOperation;
    readonly result: CompletedCapabilityOperationResult;
    readonly response: AuthorizedOperationReplayResponse;
    readonly completedAtMs: number;
  },
): Promise<D1PreparedStatementLike> {
  const response = parseAuthorizedOperationReplayResponse(input.response);
  const resultDigest = await computeAuthorizedOperationResultDigest(response);
  return database
    .prepare(
      `UPDATE authorized_operations
        SET lifecycle_kind = 'completed', result_kind = ?, result_digest = ?,
            result_status = ?, result_content_type = ?, result_body_text = ?, completed_at_ms = ?
      WHERE namespace = ? AND tenant_id = ? AND authorized_operation_id = ?
        AND operation_fingerprint_digest = ? AND lifecycle_kind = 'claimed'
      RETURNING *`,
    )
    .bind(
      input.result,
      resultDigest,
      response.status,
      response.contentType,
      response.bodyText,
      parseUnixMs(input.completedAtMs, 'operation.completedAtMs'),
      namespace,
      input.operation.tenantId,
      input.operation.authorizedOperationId,
      input.operation.operationFingerprintDigest,
    );
}
