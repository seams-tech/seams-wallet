-- Add exact ML-DSA transaction evidence. Preserve existing evidence and all
-- authorization, relocation, replay, and ownership guards during replacement.

DROP TRIGGER wallet_relocation_sessions_require_settled_operations;

DROP TRIGGER verified_wallet_operation_evidence_sets_capacity_insert;

DROP TRIGGER wallet_operations_write_block;

DROP TRIGGER wallet_relocation_authorization_fences_retired;

DROP TRIGGER wallet_operation_execution_generation_required;

DROP TRIGGER wallet_relocation_authorization_imports_operation_history_complete;

DROP TRIGGER wallet_relocation_authorization_fences_operation_history_complete;

DROP TRIGGER authorized_operation_step_up_claim_atomic;

DROP TRIGGER wallet_operations_owner_required;

DROP TRIGGER wallet_operation_audits_historical_insert;

DROP TRIGGER wallet_operation_audits_inactive_insert;

DROP TRIGGER wallet_operation_audits_frozen_delete;

DROP TRIGGER wallet_operation_audits_frozen_insert;

DROP TRIGGER wallet_operations_historical_insert;

DROP TRIGGER wallet_operations_inactive_insert;

DROP TRIGGER wallet_operations_frozen_delete;

DROP TRIGGER wallet_operations_frozen_insert;

DROP TRIGGER wallet_operation_evidence_inactive_insert;

DROP TRIGGER wallet_operation_evidence_frozen_delete;

DROP VIEW wallet_pending_operations;

DROP VIEW wallet_operation_owners;

DROP VIEW wallet_operation_authorizations;

DROP TRIGGER wallet_operation_evidence_replace_identity;

DROP TRIGGER wallet_operation_evidence_retired_insert;

DROP TRIGGER wallet_operation_evidence_referenced_retained;

DROP TRIGGER wallet_operation_evidence_immutable;

CREATE TABLE ml_dsa_wallet_operation_evidence_sets (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL CHECK(length(org_id) > 0),
  project_id TEXT NOT NULL CHECK(length(project_id) > 0),
  env_id TEXT NOT NULL CHECK(length(env_id) > 0),
  tenant_id TEXT NOT NULL,
  evidence_set_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  authority_digest TEXT NOT NULL,
  request_origin TEXT NOT NULL,
  audience TEXT NOT NULL,
  evidence_set_digest TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  capability_kind TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  lane_digest TEXT NOT NULL,
  intent_digest TEXT NOT NULL,
  display_digest TEXT NOT NULL,
  assurance TEXT NOT NULL,
  verified_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, tenant_id, evidence_set_id),
  UNIQUE (namespace, tenant_id, evidence_set_digest),
  CHECK (json_valid(evidence_json)),
  CHECK (assurance = 'step_up'),
  CHECK (expires_at_ms > verified_at_ms),
  CHECK (
    (capability_kind = 'near_ed25519_mpc_signing'
      AND operation_kind IN (
        'near.sign_transaction',
        'near.sign_delegate_action',
        'near.sign_nep413_message',
        'near.export_key'
      ))
    OR (capability_kind = 'near_ml_dsa_65_mpc_signing'
      AND operation_kind = 'near.sign_transaction')
    OR (capability_kind = 'evm_ecdsa_mpc_signing'
      AND operation_kind IN ('evm.sign_transaction', 'evm.export_key'))
    OR (capability_kind = 'vault_access'
      AND operation_kind IN ('vault.proxy_use', 'vault.reveal'))
  )
);

INSERT INTO ml_dsa_wallet_operation_evidence_sets (namespace, org_id, project_id, env_id, tenant_id, evidence_set_id, principal_id, wallet_id, authority_digest, request_origin, audience, evidence_set_digest, evidence_json, capability_kind, operation_kind, lane_digest, intent_digest, display_digest, assurance, verified_at_ms, expires_at_ms)
SELECT namespace, org_id, project_id, env_id, tenant_id, evidence_set_id, principal_id, wallet_id, authority_digest, request_origin, audience, evidence_set_digest, evidence_json, capability_kind, operation_kind, lane_digest, intent_digest, display_digest, assurance, verified_at_ms, expires_at_ms FROM verified_wallet_operation_evidence_sets;

DROP TABLE verified_wallet_operation_evidence_sets;

ALTER TABLE ml_dsa_wallet_operation_evidence_sets RENAME TO verified_wallet_operation_evidence_sets;

CREATE INDEX idx_verified_wallet_operation_evidence_expiry
  ON verified_wallet_operation_evidence_sets(namespace, tenant_id, expires_at_ms);

CREATE INDEX wallet_operation_evidence_by_wallet
  ON verified_wallet_operation_evidence_sets(namespace, org_id, project_id, env_id, wallet_id);

CREATE TRIGGER wallet_operation_evidence_immutable
BEFORE UPDATE ON verified_wallet_operation_evidence_sets
BEGIN SELECT RAISE(ABORT, 'wallet_operation_evidence_immutable'); END;

CREATE TRIGGER wallet_operation_evidence_referenced_retained
BEFORE DELETE ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM authorized_operations AS operation
  WHERE operation.namespace = OLD.namespace AND operation.tenant_id = OLD.tenant_id
    AND operation.evidence_set_digest = OLD.evidence_set_digest
)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_evidence_referenced'); END;

CREATE TRIGGER wallet_operation_evidence_retired_insert
BEFORE INSERT ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'authorization_evidence_claim_rejected'); END;

CREATE TRIGGER wallet_operation_evidence_replace_identity
BEFORE INSERT ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM verified_wallet_operation_evidence_sets AS existing
  WHERE existing.namespace = NEW.namespace AND existing.tenant_id = NEW.tenant_id
    AND (existing.evidence_set_id = NEW.evidence_set_id OR existing.evidence_set_digest = NEW.evidence_set_digest)
    AND (existing.namespace, existing.org_id, existing.project_id,
         existing.env_id, existing.tenant_id, existing.evidence_set_id,
         existing.principal_id, existing.wallet_id, existing.authority_digest,
         existing.request_origin, existing.audience, existing.evidence_set_digest,
         existing.evidence_json, existing.capability_kind, existing.operation_kind,
         existing.lane_digest, existing.intent_digest, existing.display_digest,
         existing.assurance, existing.verified_at_ms, existing.expires_at_ms) IS NOT
        (NEW.namespace, NEW.org_id, NEW.project_id,
         NEW.env_id, NEW.tenant_id, NEW.evidence_set_id,
         NEW.principal_id, NEW.wallet_id, NEW.authority_digest,
         NEW.request_origin, NEW.audience, NEW.evidence_set_digest,
         NEW.evidence_json, NEW.capability_kind, NEW.operation_kind,
         NEW.lane_digest, NEW.intent_digest, NEW.display_digest,
         NEW.assurance, NEW.verified_at_ms, NEW.expires_at_ms)
)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_evidence_immutable'); END;

CREATE VIEW wallet_operation_authorizations AS
SELECT namespace, org_id, project_id, env_id, wallet_id, tenant_id,
       'authorization_grant' AS source_kind, authorization_id AS source_id
FROM wallet_session_authorizations_v2
UNION ALL
SELECT namespace, org_id, project_id, env_id, wallet_id, tenant_id,
       'verified_step_up' AS source_kind, evidence_set_digest AS source_id
FROM verified_wallet_operation_evidence_sets;

CREATE VIEW wallet_operation_owners AS
SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id,
       operation.tenant_id, operation.authorized_operation_id
FROM wallet_operation_authorizations AS owner
JOIN authorized_operations AS operation
  ON owner.namespace = operation.namespace AND owner.tenant_id = operation.tenant_id
 AND owner.source_kind = operation.authorization_source_kind
 AND owner.source_id = CASE operation.authorization_source_kind
   WHEN 'authorization_grant' THEN operation.authorization_id ELSE operation.evidence_set_digest END
 AND (operation.authorization_source_kind = 'verified_step_up' OR
   (operation.authorization_grant_kind = 'wallet_session_authorization'
    AND owner.org_id = operation.owner_scope_org_id AND owner.project_id = operation.owner_scope_project_id
    AND owner.env_id = operation.owner_scope_env_id));

CREATE VIEW wallet_pending_operations AS
SELECT owner.* FROM wallet_operation_owners AS owner
JOIN authorized_operations AS operation USING(namespace, tenant_id, authorized_operation_id)
WHERE operation.lifecycle_kind = 'claimed';

CREATE TRIGGER wallet_operation_evidence_frozen_delete
BEFORE DELETE ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN (SELECT OLD.namespace, OLD.org_id, OLD.project_id, OLD.env_id, OLD.wallet_id) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id AND NOT EXISTS (
        SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
        WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id AND cleanup.project_id = fence.project_id
    AND cleanup.env_id = fence.env_id AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
    AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
          AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER wallet_operation_evidence_inactive_insert
BEFORE INSERT ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  JOIN (SELECT NEW.namespace, NEW.org_id, NEW.project_id, NEW.env_id, NEW.wallet_id) AS selected ON selected.namespace = destination.namespace
    AND selected.org_id = destination.org_id AND selected.project_id = destination.project_id
    AND selected.env_id = destination.env_id AND selected.wallet_id = destination.wallet_id
  WHERE destination.state != 'activated'
) AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
    AND destination.project_id = context.project_id AND destination.env_id = context.env_id
    AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
    AND destination.request_digest_hex = context.request_digest_hex AND destination.source_generation = context.source_generation
      JOIN (SELECT NEW.namespace, NEW.org_id, NEW.project_id, NEW.env_id, NEW.wallet_id) AS selected ON selected.namespace = context.namespace
    AND selected.org_id = context.org_id AND selected.project_id = context.project_id AND selected.env_id = context.env_id
    AND selected.wallet_id = context.wallet_id
      WHERE destination.state = 'importing' AND context.table_name = 'verified_wallet_operation_evidence_sets'
        AND context.record_key = json_array(NEW.evidence_set_id, NEW.namespace, NEW.tenant_id)
    )
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER wallet_operations_frozen_insert
BEFORE INSERT ON authorized_operations
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id))) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id
)
BEGIN
  SELECT CASE WHEN NEW.authorization_source_kind = 'verified_step_up'
    THEN RAISE(ABORT, 'authorization_evidence_claim_rejected')
    ELSE RAISE(ABORT, 'authorization_wallet_session_rejected') END;
END;

CREATE TRIGGER wallet_operations_frozen_delete
BEFORE DELETE ON authorized_operations
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = OLD.namespace AND owner.tenant_id = OLD.tenant_id
            AND owner.source_kind = OLD.authorization_source_kind
            AND owner.source_id = CASE OLD.authorization_source_kind
              WHEN 'authorization_grant' THEN OLD.authorization_id ELSE OLD.evidence_set_digest END
            AND (OLD.authorization_source_kind = 'verified_step_up' OR
              (OLD.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = OLD.owner_scope_org_id AND owner.project_id = OLD.owner_scope_project_id
                AND owner.env_id = OLD.owner_scope_env_id))) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id AND NOT EXISTS (
        SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
        WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id AND cleanup.project_id = fence.project_id
    AND cleanup.env_id = fence.env_id AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
    AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
          AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER wallet_operations_inactive_insert
BEFORE INSERT ON authorized_operations
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id))) AS selected ON selected.namespace = destination.namespace
    AND selected.org_id = destination.org_id AND selected.project_id = destination.project_id
    AND selected.env_id = destination.env_id AND selected.wallet_id = destination.wallet_id
  WHERE destination.state != 'activated'
) AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
    AND destination.project_id = context.project_id AND destination.env_id = context.env_id
    AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
    AND destination.request_digest_hex = context.request_digest_hex AND destination.source_generation = context.source_generation
      JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id))) AS selected ON selected.namespace = context.namespace
    AND selected.org_id = context.org_id AND selected.project_id = context.project_id AND selected.env_id = context.env_id
    AND selected.wallet_id = context.wallet_id
      WHERE destination.state = 'importing' AND context.table_name = 'authorized_operations'
        AND context.record_key = json_array(NEW.authorized_operation_id, NEW.namespace, NEW.tenant_id)
    )
BEGIN
  SELECT CASE WHEN NEW.lifecycle_kind != 'claimed'
    THEN RAISE(ABORT, 'wallet_authorization_destination_inactive')
    WHEN NEW.authorization_source_kind = 'verified_step_up'
    THEN RAISE(ABORT, 'authorization_evidence_claim_rejected')
    ELSE RAISE(ABORT, 'authorization_wallet_session_rejected') END;
END;

CREATE TRIGGER wallet_operations_historical_insert
BEFORE INSERT ON authorized_operations
WHEN NEW.lifecycle_kind = 'completed' AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
    AND destination.project_id = context.project_id AND destination.env_id = context.env_id
    AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
    AND destination.request_digest_hex = context.request_digest_hex AND destination.source_generation = context.source_generation
      JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id))) AS selected ON selected.namespace = context.namespace
    AND selected.org_id = context.org_id AND selected.project_id = context.project_id AND selected.env_id = context.env_id
    AND selected.wallet_id = context.wallet_id
      WHERE destination.state = 'importing' AND context.table_name = 'authorized_operations'
        AND context.record_key = json_array(NEW.authorized_operation_id, NEW.namespace, NEW.tenant_id)
    )
BEGIN SELECT RAISE(ABORT, 'wallet_operation_history_import_required'); END;

CREATE TRIGGER wallet_operation_audits_frozen_insert
BEFORE INSERT ON authorized_operation_audit_events
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_owners AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.authorized_operation_id = NEW.authorized_operation_id) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER wallet_operation_audits_frozen_delete
BEFORE DELETE ON authorized_operation_audit_events
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_owners AS owner
          WHERE owner.namespace = OLD.namespace AND owner.tenant_id = OLD.tenant_id
            AND owner.authorized_operation_id = OLD.authorized_operation_id) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id AND NOT EXISTS (
        SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
        WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id AND cleanup.project_id = fence.project_id
    AND cleanup.env_id = fence.env_id AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
    AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
          AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER wallet_operation_audits_inactive_insert
BEFORE INSERT ON authorized_operation_audit_events
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_owners AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id

    AND owner.authorized_operation_id = NEW.authorized_operation_id) AS selected ON selected.namespace = destination.namespace
    AND selected.org_id = destination.org_id AND selected.project_id = destination.project_id
    AND selected.env_id = destination.env_id AND selected.wallet_id = destination.wallet_id
  WHERE destination.state != 'activated'
) AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
    AND destination.project_id = context.project_id AND destination.env_id = context.env_id
    AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
    AND destination.request_digest_hex = context.request_digest_hex AND destination.source_generation = context.source_generation
      JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_owners AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.authorized_operation_id = NEW.authorized_operation_id) AS selected ON selected.namespace = context.namespace
    AND selected.org_id = context.org_id AND selected.project_id = context.project_id AND selected.env_id = context.env_id
    AND selected.wallet_id = context.wallet_id
      WHERE destination.state = 'importing' AND context.table_name = 'authorized_operation_audit_events'
        AND context.record_key = json_array(NEW.audit_event_id, NEW.namespace, NEW.tenant_id)
    )
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER wallet_operation_audits_historical_insert
BEFORE INSERT ON authorized_operation_audit_events
WHEN NEW.result_kind != 'pending' AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
    AND destination.project_id = context.project_id AND destination.env_id = context.env_id
    AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
    AND destination.request_digest_hex = context.request_digest_hex AND destination.source_generation = context.source_generation
      JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_owners AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.authorized_operation_id = NEW.authorized_operation_id) AS selected ON selected.namespace = context.namespace
    AND selected.org_id = context.org_id AND selected.project_id = context.project_id AND selected.env_id = context.env_id
    AND selected.wallet_id = context.wallet_id
      WHERE destination.state = 'importing' AND context.table_name = 'authorized_operation_audit_events'
        AND context.record_key = json_array(NEW.audit_event_id, NEW.namespace, NEW.tenant_id)
    )
BEGIN SELECT RAISE(ABORT, 'wallet_operation_history_import_required'); END;

CREATE TRIGGER wallet_operations_owner_required
BEFORE INSERT ON authorized_operations
WHEN NOT EXISTS (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id)))
BEGIN SELECT RAISE(ABORT, 'wallet_operation_owner_missing'); END;

CREATE TRIGGER authorized_operation_step_up_claim_atomic
AFTER INSERT ON authorized_operations
WHEN NEW.lifecycle_kind = 'claimed'
  AND NEW.authorization_source_kind = 'verified_step_up'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
        SELECT 1
          FROM verified_wallet_operation_evidence_sets AS evidence
         WHERE evidence.namespace = NEW.namespace
           AND evidence.tenant_id = NEW.tenant_id
           AND evidence.evidence_set_digest = NEW.evidence_set_digest
           AND evidence.principal_id = NEW.principal_id
           AND evidence.capability_kind = NEW.capability_kind
           AND evidence.operation_kind = NEW.operation_kind
           AND evidence.lane_digest = NEW.lane_digest
           AND evidence.intent_digest = NEW.intent_digest
           AND evidence.display_digest = NEW.display_digest
           AND evidence.assurance = 'step_up'
           AND NOT EXISTS (
             SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt
             WHERE receipt.namespace = evidence.namespace AND receipt.org_id = evidence.org_id
               AND receipt.project_id = evidence.project_id AND receipt.env_id = evidence.env_id
               AND receipt.wallet_id = evidence.wallet_id AND receipt.table_name = 'verified_wallet_operation_evidence_sets'
               AND receipt.record_key = json_array(evidence.evidence_set_id, evidence.namespace, evidence.tenant_id)
           )
           AND NOT EXISTS (
             SELECT 1 FROM wallet_relocation_session_fences AS fence
             WHERE fence.namespace = evidence.namespace AND fence.org_id = evidence.org_id
               AND fence.project_id = evidence.project_id AND fence.env_id = evidence.env_id
               AND fence.wallet_id = evidence.wallet_id
           )
           AND evidence.expires_at_ms > NEW.claimed_at_ms
           -- The database clock closes delays between verification and this write.
           AND evidence.expires_at_ms > CAST(round(unixepoch('subsec') * 1000) AS INTEGER)
      )
    THEN RAISE(ABORT, 'authorization_evidence_claim_rejected')
  END;
END;

CREATE TRIGGER wallet_relocation_authorization_fences_operation_history_complete
BEFORE INSERT ON wallet_relocation_authorization_fences
WHEN 1 AND EXISTS (
  SELECT 1 FROM wallet_operation_owners AS owner
  JOIN authorized_operations AS operation USING(namespace, tenant_id, authorized_operation_id)
  WHERE owner.namespace = NEW.namespace AND owner.org_id = NEW.org_id AND owner.project_id = NEW.project_id
    AND owner.env_id = NEW.env_id AND owner.wallet_id = NEW.wallet_id
    AND (operation.lifecycle_kind != 'completed' OR NOT EXISTS (
      SELECT 1 FROM authorized_operation_audit_events AS audit
      WHERE audit.namespace IS operation.namespace
        AND audit.tenant_id IS operation.tenant_id
        AND audit.audit_event_id IS operation.audit_event_id
        AND audit.authorized_operation_id IS operation.authorized_operation_id
        AND audit.operation_fingerprint_digest IS operation.operation_fingerprint_digest
        AND audit.authorization_source_kind IS operation.authorization_source_kind
        AND audit.authorization_id IS operation.authorization_id
        AND audit.authorization_grant_kind IS operation.authorization_grant_kind
        AND audit.evidence_set_digest IS operation.evidence_set_digest
        AND audit.quota_id IS operation.quota_id
        AND audit.material_activation_id IS operation.material_activation_id
        AND audit.material_activation_capability IS operation.material_activation_capability
        AND audit.material_activation_owner IS operation.material_activation_owner
        AND audit.material_activation_key_binding IS operation.material_activation_key_binding
        AND audit.material_activation_lifecycle_binding IS operation.material_activation_lifecycle_binding
        AND audit.material_activation_signing_worker IS operation.material_activation_signing_worker
        AND audit.owner_scope_org_id IS operation.owner_scope_org_id
        AND audit.owner_scope_project_id IS operation.owner_scope_project_id
        AND audit.owner_scope_env_id IS operation.owner_scope_env_id
        AND audit.result_kind IS operation.result_kind
        AND audit.claimed_at_ms IS operation.claimed_at_ms
        AND audit.completed_at_ms IS operation.completed_at_ms
    ))
)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_history_incomplete'); END;

CREATE TRIGGER wallet_relocation_authorization_imports_operation_history_complete
BEFORE UPDATE ON wallet_relocation_authorization_imports
WHEN NEW.state = 'closed' AND OLD.state = 'importing' AND EXISTS (
  SELECT 1 FROM wallet_operation_owners AS owner
  JOIN authorized_operations AS operation USING(namespace, tenant_id, authorized_operation_id)
  WHERE owner.namespace = NEW.namespace AND owner.org_id = NEW.org_id AND owner.project_id = NEW.project_id
    AND owner.env_id = NEW.env_id AND owner.wallet_id = NEW.wallet_id
    AND (operation.lifecycle_kind != 'completed' OR NOT EXISTS (
      SELECT 1 FROM authorized_operation_audit_events AS audit
      WHERE audit.namespace IS operation.namespace
        AND audit.tenant_id IS operation.tenant_id
        AND audit.audit_event_id IS operation.audit_event_id
        AND audit.authorized_operation_id IS operation.authorized_operation_id
        AND audit.operation_fingerprint_digest IS operation.operation_fingerprint_digest
        AND audit.authorization_source_kind IS operation.authorization_source_kind
        AND audit.authorization_id IS operation.authorization_id
        AND audit.authorization_grant_kind IS operation.authorization_grant_kind
        AND audit.evidence_set_digest IS operation.evidence_set_digest
        AND audit.quota_id IS operation.quota_id
        AND audit.material_activation_id IS operation.material_activation_id
        AND audit.material_activation_capability IS operation.material_activation_capability
        AND audit.material_activation_owner IS operation.material_activation_owner
        AND audit.material_activation_key_binding IS operation.material_activation_key_binding
        AND audit.material_activation_lifecycle_binding IS operation.material_activation_lifecycle_binding
        AND audit.material_activation_signing_worker IS operation.material_activation_signing_worker
        AND audit.owner_scope_org_id IS operation.owner_scope_org_id
        AND audit.owner_scope_project_id IS operation.owner_scope_project_id
        AND audit.owner_scope_env_id IS operation.owner_scope_env_id
        AND audit.result_kind IS operation.result_kind
        AND audit.claimed_at_ms IS operation.claimed_at_ms
        AND audit.completed_at_ms IS operation.completed_at_ms
    ))
)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_history_incomplete'); END;

CREATE TRIGGER wallet_operation_execution_generation_required
BEFORE INSERT ON authorized_operations
WHEN NEW.lifecycle_kind = 'claimed' AND NOT EXISTS (
  SELECT 1 FROM wallet_operation_authorizations AS owner
  JOIN wallet_execution_generations AS execution
    USING(namespace, org_id, project_id, env_id, wallet_id)
  WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
    AND owner.source_kind = NEW.authorization_source_kind
    AND owner.source_id = CASE NEW.authorization_source_kind
      WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
    AND (NEW.authorization_source_kind = 'verified_step_up' OR
      (NEW.authorization_grant_kind = 'wallet_session_authorization'
       AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
       AND owner.env_id = NEW.owner_scope_env_id))
    AND execution.state = 'active' AND execution.generation = NEW.ownership_generation
)
BEGIN
  SELECT CASE WHEN NEW.authorization_source_kind = 'verified_step_up'
    THEN RAISE(ABORT, 'authorization_evidence_claim_rejected')
    ELSE RAISE(ABORT, 'authorization_wallet_session_rejected') END;
END;

CREATE TRIGGER wallet_relocation_authorization_fences_retired
BEFORE INSERT ON wallet_relocation_authorization_fences
WHEN (EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS existing
  WHERE existing.namespace = NEW.namespace AND existing.org_id = NEW.org_id
    AND existing.project_id = NEW.project_id AND existing.env_id = NEW.env_id
    AND existing.wallet_id = NEW.wallet_id
) OR NOT EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS retired
  WHERE retired.namespace = NEW.namespace AND retired.org_id = NEW.org_id
    AND retired.project_id = NEW.project_id AND retired.env_id = NEW.env_id
    AND retired.wallet_id = NEW.wallet_id AND retired.move_id = NEW.move_id
    AND retired.request_digest_hex = NEW.request_digest_hex
    AND retired.source_generation = NEW.source_generation
    AND retired.retired_at_ms <= NEW.frozen_at_ms
) OR EXISTS (
  SELECT 1 FROM wallet_session_authorizations_v2 AS session
  WHERE session.namespace = NEW.namespace AND session.org_id = NEW.org_id
    AND session.project_id = NEW.project_id AND session.env_id = NEW.env_id
    AND session.wallet_id = NEW.wallet_id AND session.retired_at_ms IS NULL
) OR EXISTS (
  SELECT 1 FROM wallet_session_hosted_credentials_v2 AS credential
  WHERE credential.namespace = NEW.namespace AND credential.org_id = NEW.org_id
    AND credential.project_id = NEW.project_id AND credential.env_id = NEW.env_id
    AND credential.wallet_id = NEW.wallet_id AND credential.lifecycle_kind = 'active'
)) AND NOT EXISTS (
  SELECT 1 FROM wallet_relocation_write_blocks AS block
  JOIN wallet_execution_generations AS execution USING (namespace, org_id, project_id, env_id, wallet_id)
  WHERE block.namespace = NEW.namespace AND block.org_id = NEW.org_id
    AND block.project_id = NEW.project_id AND block.env_id = NEW.env_id
    AND block.wallet_id = NEW.wallet_id AND block.move_id = NEW.move_id
    AND block.request_digest_hex = NEW.request_digest_hex AND block.source_generation = NEW.source_generation
    AND block.state = 'draining' AND execution.state = 'active' AND execution.generation = block.source_generation
    AND NOT EXISTS (SELECT 1 FROM wallet_pending_operations AS pending
      WHERE pending.namespace = block.namespace AND pending.org_id = block.org_id
        AND pending.project_id = block.project_id AND pending.env_id = block.env_id AND pending.wallet_id = block.wallet_id)
    AND NOT EXISTS (SELECT 1 FROM wallet_ceremony_activity AS pending
      WHERE pending.namespace = block.namespace AND pending.org_id = block.org_id
        AND pending.project_id = block.project_id AND pending.env_id = block.env_id
        AND pending.wallet_id = block.wallet_id AND pending.settled = 0)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_freeze_requires_retirement');
END;

CREATE TRIGGER wallet_operations_write_block
BEFORE INSERT ON authorized_operations
WHEN EXISTS (
  SELECT 1 FROM (SELECT * FROM wallet_relocation_write_blocks WHERE state IN ('draining', 'checked')) AS fence
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id))) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id
)
BEGIN
  SELECT RAISE(ABORT, 'authorization_evidence_claim_rejected')
    WHERE NEW.authorization_source_kind = 'verified_step_up';
  SELECT RAISE(ABORT, 'authorization_wallet_session_rejected')
    WHERE NEW.authorization_source_kind IS NOT 'verified_step_up';
END;

CREATE TRIGGER verified_wallet_operation_evidence_sets_capacity_insert BEFORE INSERT ON verified_wallet_operation_evidence_sets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace
    AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id
    AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER wallet_relocation_sessions_require_settled_operations
BEFORE INSERT ON wallet_relocation_session_fences
WHEN EXISTS (
  SELECT 1 FROM wallet_pending_operations AS operation
  WHERE operation.namespace = NEW.namespace AND operation.org_id = NEW.org_id
    AND operation.project_id = NEW.project_id AND operation.env_id = NEW.env_id
    AND operation.wallet_id = NEW.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'wallet_operations_unsettled'); END;
