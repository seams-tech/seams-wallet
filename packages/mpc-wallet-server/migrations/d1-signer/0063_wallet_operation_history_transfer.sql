-- A sealed manifest cannot change its inventory during a schema upgrade.
CREATE TABLE wallet_operation_history_upgrade_guard (count INTEGER NOT NULL CHECK(count = 0));
INSERT INTO wallet_operation_history_upgrade_guard
SELECT (SELECT COUNT(*) FROM wallet_relocation_authorization_snapshots)
     + (SELECT COUNT(*) FROM wallet_relocation_authorization_imports);
DROP TABLE wallet_operation_history_upgrade_guard;

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
DROP VIEW wallet_pending_operations;
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

CREATE TRIGGER wallet_operation_audit_parent
BEFORE INSERT ON authorized_operation_audit_events
WHEN NOT EXISTS (SELECT 1 FROM authorized_operations AS operation
  WHERE operation.namespace IS NEW.namespace
    AND operation.tenant_id IS NEW.tenant_id
    AND operation.audit_event_id IS NEW.audit_event_id
    AND operation.authorized_operation_id IS NEW.authorized_operation_id
    AND operation.operation_fingerprint_digest IS NEW.operation_fingerprint_digest
    AND operation.authorization_source_kind IS NEW.authorization_source_kind
    AND operation.authorization_id IS NEW.authorization_id
    AND operation.authorization_grant_kind IS NEW.authorization_grant_kind
    AND operation.evidence_set_digest IS NEW.evidence_set_digest
    AND operation.quota_id IS NEW.quota_id
    AND operation.material_activation_id IS NEW.material_activation_id
    AND operation.material_activation_capability IS NEW.material_activation_capability
    AND operation.material_activation_owner IS NEW.material_activation_owner
    AND operation.material_activation_key_binding IS NEW.material_activation_key_binding
    AND operation.material_activation_lifecycle_binding IS NEW.material_activation_lifecycle_binding
    AND operation.material_activation_signing_worker IS NEW.material_activation_signing_worker
    AND operation.owner_scope_org_id IS NEW.owner_scope_org_id
    AND operation.owner_scope_project_id IS NEW.owner_scope_project_id
    AND operation.owner_scope_env_id IS NEW.owner_scope_env_id
    AND operation.result_kind IS NEW.result_kind
    AND operation.claimed_at_ms IS NEW.claimed_at_ms
    AND operation.completed_at_ms IS NEW.completed_at_ms)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_audit_parent_conflicts'); END;

CREATE TRIGGER wallet_operation_terminal_immutable
BEFORE UPDATE ON authorized_operations
WHEN OLD.lifecycle_kind = 'completed'
BEGIN SELECT RAISE(ABORT, 'wallet_operation_terminal_immutable'); END;
CREATE TRIGGER wallet_operation_audit_terminal_immutable
BEFORE UPDATE ON authorized_operation_audit_events
WHEN OLD.result_kind != 'pending'
BEGIN SELECT RAISE(ABORT, 'wallet_operation_terminal_immutable'); END;

CREATE TRIGGER wallet_operation_identity_immutable
BEFORE UPDATE ON authorized_operations
WHEN NEW.namespace IS NOT OLD.namespace
  OR NEW.tenant_id IS NOT OLD.tenant_id
  OR NEW.authorized_operation_id IS NOT OLD.authorized_operation_id
  OR NEW.audit_event_id IS NOT OLD.audit_event_id
  OR NEW.principal_id IS NOT OLD.principal_id
  OR NEW.capability_id IS NOT OLD.capability_id
  OR NEW.capability_kind IS NOT OLD.capability_kind
  OR NEW.operation_kind IS NOT OLD.operation_kind
  OR NEW.operation_id IS NOT OLD.operation_id
  OR NEW.operation_fingerprint_digest IS NOT OLD.operation_fingerprint_digest
  OR NEW.lane_digest IS NOT OLD.lane_digest
  OR NEW.intent_digest IS NOT OLD.intent_digest
  OR NEW.display_digest IS NOT OLD.display_digest
  OR NEW.authorization_source_kind IS NOT OLD.authorization_source_kind
  OR NEW.authorization_id IS NOT OLD.authorization_id
  OR NEW.authorization_grant_kind IS NOT OLD.authorization_grant_kind
  OR NEW.evidence_set_digest IS NOT OLD.evidence_set_digest
  OR NEW.quota_id IS NOT OLD.quota_id
  OR NEW.quota_kind IS NOT OLD.quota_kind
  OR NEW.claimed_at_ms IS NOT OLD.claimed_at_ms
  OR NEW.material_activation_id IS NOT OLD.material_activation_id
  OR NEW.material_activation_capability IS NOT OLD.material_activation_capability
  OR NEW.material_activation_owner IS NOT OLD.material_activation_owner
  OR NEW.material_activation_key_binding IS NOT OLD.material_activation_key_binding
  OR NEW.material_activation_lifecycle_binding IS NOT OLD.material_activation_lifecycle_binding
  OR NEW.material_activation_signing_worker IS NOT OLD.material_activation_signing_worker
  OR NEW.owner_scope_org_id IS NOT OLD.owner_scope_org_id
  OR NEW.owner_scope_project_id IS NOT OLD.owner_scope_project_id
  OR NEW.owner_scope_env_id IS NOT OLD.owner_scope_env_id
BEGIN SELECT RAISE(ABORT, 'wallet_operation_identity_immutable'); END;

DROP TRIGGER authorized_operation_step_up_claim_atomic;
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
