import type { EcdsaMaterialReadSnapshot } from '../../../../core/ecdsaMaterialReadSnapshot';
import type { AuthorizedOperation } from '../../../../authorization/domain';
import type { AuthorizedOperationMaterialScope, EcdsaMaterialActivationScope } from '../../../../authorization/service';
import type { D1WalletStoreScope } from '../../../../core/d1WalletStore';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type { TenantId } from '@shared/authorization/capabilityKinds';
import type { CapabilityOperationFingerprintDigest } from '@shared/authorization/operationFingerprint';

const ECDSA_SIGNER_MATCH = `
  EXISTS (
    SELECT 1
      FROM wallet_signers AS signer
     WHERE signer.namespace = ?
       AND signer.org_id = ?
       AND signer.project_id = ?
       AND signer.env_id = ?
       AND signer.wallet_id = ?
       AND signer.signer_family = 'ecdsa'
       AND json_extract(signer.record_json, '$.walletKey.publicCapability.material_activation.material_owner') = signer.wallet_id
       AND json_extract(signer.record_json, '$.walletKey.keyHandle') = ?
       AND json_extract(signer.record_json, '$.walletKey.publicCapability.material_activation.kind') = ?
       AND json_extract(signer.record_json, '$.walletKey.publicCapability.material_activation.activation_id') = ?
       AND json_extract(signer.record_json, '$.walletKey.publicCapability.material_activation.capability') = ?
       AND json_extract(signer.record_json, '$.walletKey.publicCapability.material_activation.material_owner') = ?
       AND json_extract(signer.record_json, '$.walletKey.publicCapability.material_activation.key_binding') = ?
       AND json_extract(signer.record_json, '$.walletKey.publicCapability.material_activation.lifecycle_binding') = ?
       AND json_extract(signer.record_json, '$.walletKey.publicCapability.material_activation.signing_worker') = ?
  )`;

function ecdsaSignerMatchBindings(
  walletSignerScope: D1WalletStoreScope,
  material: EcdsaMaterialActivationScope,
): readonly unknown[] {
  const activation = material.materialActivation;
  return [
    walletSignerScope.namespace,
    walletSignerScope.orgId,
    walletSignerScope.projectId,
    walletSignerScope.envId,
    material.walletId,
    material.keyHandle,
    activation.kind,
    activation.activation_id,
    activation.capability,
    activation.material_owner,
    activation.key_binding,
    activation.lifecycle_binding,
    activation.signing_worker,
  ];
}

const PINNED_OWNER_WALLET = `
  (SELECT session.wallet_id
     FROM wallet_session_authorizations_v2 AS session
    WHERE session.namespace = operation.namespace
      AND session.tenant_id = operation.tenant_id
      AND session.authorization_id = operation.authorization_id
      AND session.org_id = operation.linked_scope_org_id
      AND session.project_id = operation.linked_scope_project_id
      AND session.env_id = operation.linked_scope_env_id
      AND operation.authorization_source_kind = 'authorization_grant'
    LIMIT 1) AS pinned_owner_wallet_id`;

export function prepareAuthorizedOperationCommittedRead(
  database: D1DatabaseLike,
  namespace: string,
  input: {
    readonly tenantId: TenantId;
    readonly operationFingerprintDigest: CapabilityOperationFingerprintDigest;
  },
): D1PreparedStatementLike {
  return database.prepare(
    `SELECT operation.*, ${PINNED_OWNER_WALLET}
       FROM authorized_operations AS operation
      WHERE operation.namespace = ? AND operation.tenant_id = ?
        AND operation.operation_fingerprint_digest = ?
      LIMIT 1`,
  ).bind(namespace, input.tenantId, input.operationFingerprintDigest);
}

export function prepareAuthorizedOperationRead(
  database: D1DatabaseLike,
  namespace: string,
  input: {
    readonly tenantId: TenantId;
    readonly operationFingerprintDigest: CapabilityOperationFingerprintDigest;
  },
): D1PreparedStatementLike {
  return database.prepare(
    `SELECT * FROM authorized_operations
      WHERE namespace = ? AND tenant_id = ? AND operation_fingerprint_digest = ?
      LIMIT 1`,
  ).bind(namespace, input.tenantId, input.operationFingerprintDigest);
}

export function prepareAuthorizedOperationAdmissionRead(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly walletSignerScope: D1WalletStoreScope;
  readonly tenantId: TenantId;
  readonly operationFingerprintDigest: CapabilityOperationFingerprintDigest;
  readonly nowMs: number;
  readonly materialSnapshot: EcdsaMaterialReadSnapshot | null;
}): D1PreparedStatementLike {
  const material = input.materialSnapshot?.condition(input.walletSignerScope) ?? { sql: '1', bindings: [] };
  return input.database.prepare(
    `SELECT operation.*, ${PINNED_OWNER_WALLET}, (${material.sql}) AS material_snapshot_active,
            CASE operation.authorization_source_kind
              WHEN 'authorization_grant' THEN EXISTS (
                SELECT 1
                  FROM wallet_session_authorizations_v2 AS session
                  JOIN wallet_authorities AS authority
                    ON authority.namespace = session.namespace
                   AND authority.org_id = session.org_id
                   AND authority.project_id = session.project_id
                   AND authority.env_id = session.env_id
                   AND authority.authority_id = session.authority_id
                   AND authority.wallet_id = session.wallet_id
                  JOIN wallet_auth_methods AS auth_method
                    ON auth_method.namespace = session.namespace
                   AND auth_method.org_id = session.org_id
                   AND auth_method.project_id = session.project_id
                   AND auth_method.env_id = session.env_id
                   AND auth_method.wallet_auth_method_id = session.wallet_auth_method_id
                   AND auth_method.wallet_id = session.wallet_id
                   AND auth_method.wallet_authority_id = session.authority_id
                 WHERE session.namespace = operation.namespace
                   AND session.org_id = operation.linked_scope_org_id
                   AND session.project_id = operation.linked_scope_project_id
                   AND session.env_id = operation.linked_scope_env_id
                   AND session.org_id = ? AND session.project_id = ? AND session.env_id = ?
                   AND session.tenant_id = operation.tenant_id
                   AND session.authorization_id = operation.authorization_id
                   AND session.principal_id = operation.principal_id
                   AND (operation.quota_kind = 'quota_neutral' OR session.quota_id = operation.quota_id)
                   AND session.retired_at_ms IS NULL
                   AND session.expires_at_ms > ?
                   AND authority.lifecycle_state = 'active'
                   AND authority.authority_digest_b64u = session.authority_digest_b64u
                   AND authority.revocation_epoch = session.authority_revocation_epoch
                   AND auth_method.status = 'active'
              )
              WHEN 'verified_step_up' THEN EXISTS (
                SELECT 1
                  FROM verified_wallet_operation_evidence_sets AS evidence
                 WHERE evidence.namespace = operation.namespace
                   AND evidence.tenant_id = operation.tenant_id
                   AND evidence.evidence_set_digest = operation.evidence_set_digest
                   AND evidence.principal_id = operation.principal_id
                   AND evidence.capability_kind = operation.capability_kind
                   AND evidence.operation_kind = operation.operation_kind
                   AND evidence.lane_digest = operation.lane_digest
                   AND evidence.intent_digest = operation.intent_digest
                   AND evidence.display_digest = operation.display_digest
                   AND evidence.assurance = 'step_up'
                   AND evidence.expires_at_ms > MAX(
                     ?, CAST(round(unixepoch('subsec') * 1000) AS INTEGER)
                   )
              )
              ELSE 0
            END AS authorization_source_active
       FROM authorized_operations AS operation
      WHERE operation.namespace = ? AND operation.tenant_id = ?
        AND operation.operation_fingerprint_digest = ?
      LIMIT 1`,
  ).bind(
    ...material.bindings,
    input.walletSignerScope.orgId,
    input.walletSignerScope.projectId,
    input.walletSignerScope.envId,
    input.nowMs,
    input.nowMs,
    input.namespace,
    input.tenantId,
    input.operationFingerprintDigest,
  );
}

export function prepareAuthorizedOperationInsert(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly walletSignerScope: D1WalletStoreScope;
  readonly operation: AuthorizedOperation;
  readonly material: AuthorizedOperationMaterialScope | null;
  readonly materialSnapshot: EcdsaMaterialReadSnapshot | null;
  readonly existingOperation: 'reject' | 'preserve';
}): D1PreparedStatementLike {
  const { database, namespace, walletSignerScope, operation, material } = input;
  const claimedAtMs = Number(operation.claimedAtMs);
  if (!Number.isSafeInteger(claimedAtMs)) {
    throw new Error('operation.claimedAtMs must be a safe integer');
  }
  if (claimedAtMs <= 0) {
    throw new Error('operation.claimedAtMs must be positive');
  }
  const source = operation.authorization;
  const quota = operation.quota;
  const materialActivationId = material?.materialActivation.activation_id ?? null;
  const values = [
    namespace,
    operation.tenantId,
    operation.authorizedOperationId,
    operation.auditEventId,
    operation.operation.principalId,
    operation.operation.capabilityId,
    operation.operation.operation.capabilityKind,
    operation.operation.operation.operationKind,
    operation.operation.operationId,
    operation.operationFingerprintDigest,
    operation.operation.digests.laneDigest,
    operation.operation.digests.intentDigest,
    operation.operation.digests.displayDigest,
    source.kind,
    source.kind === 'authorization_grant' ? source.authorizationGrantRef.authorizationId : null,
    source.kind === 'verified_step_up' ? source.evidenceSetDigest : null,
    quota.kind === 'consume_reusable_wallet_session' ? quota.quotaId : null,
    quota.kind,
    source.kind === 'authorization_grant' ? source.authorizationGrantRef.kind : null,
    claimedAtMs,
    materialActivationId,
    material?.materialActivation.capability ?? null,
    material?.materialActivation.material_owner ?? null,
    material?.materialActivation.key_binding ?? null,
    material?.materialActivation.lifecycle_binding ?? null,
    material?.materialActivation.signing_worker ?? null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    source.kind === 'authorization_grant' ? walletSignerScope.orgId : null,
    source.kind === 'authorization_grant' ? walletSignerScope.projectId : null,
    source.kind === 'authorization_grant' ? walletSignerScope.envId : null,
  ] as const;
  let condition = input.materialSnapshot?.condition(walletSignerScope) ?? null;
  if (condition === null) {
    condition = material?.kind === 'ecdsa_material_activation'
      ? { sql: ECDSA_SIGNER_MATCH, bindings: ecdsaSignerMatchBindings(walletSignerScope, material) }
      : { sql: '1', bindings: [] };
  }
  const absence = input.existingOperation === 'preserve'
    ? {
        sql: `NOT EXISTS (SELECT 1 FROM authorized_operations
               WHERE namespace = ? AND tenant_id = ? AND operation_fingerprint_digest = ?)`,
        bindings: [namespace, operation.tenantId, operation.operationFingerprintDigest],
      }
    : { sql: '1', bindings: [] };
  return database.prepare(
    `INSERT INTO authorized_operations (
          namespace, tenant_id, authorized_operation_id, audit_event_id,
          principal_id, capability_id, capability_kind, operation_kind, operation_id,
          operation_fingerprint_digest, lane_digest, intent_digest, display_digest,
          authorization_source_kind, authorization_id, evidence_set_digest,
          quota_id, quota_kind, authorization_grant_kind, lifecycle_kind, result_kind,
          result_digest, result_status, result_content_type, result_body_text,
          claimed_at_ms, completed_at_ms,
          material_activation_id, material_activation_capability,
          material_activation_owner, material_activation_key_binding,
          material_activation_lifecycle_binding, material_activation_signing_worker,
          linked_wallet_id, linked_enrollment_id, linked_device_id,
          linked_wallet_key_id, linked_lane_id, linked_lane_share_epoch,
          linked_revocation_epoch, linked_scope_org_id, linked_scope_project_id,
          linked_scope_env_id
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  'claimed', 'pending', NULL, NULL, NULL, NULL, ?, NULL, ?,
                  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE (${condition.sql}) AND (${absence.sql})`,
  ).bind(...values, ...condition.bindings, ...absence.bindings);
}
