DROP TRIGGER authorized_operation_audit_claim;
ALTER TABLE authorized_operations DROP COLUMN linked_wallet_id;
ALTER TABLE authorized_operations DROP COLUMN linked_enrollment_id;
ALTER TABLE authorized_operations DROP COLUMN linked_device_id;
ALTER TABLE authorized_operations DROP COLUMN linked_wallet_key_id;
ALTER TABLE authorized_operations DROP COLUMN linked_lane_id;
ALTER TABLE authorized_operations DROP COLUMN linked_lane_share_epoch;
ALTER TABLE authorized_operations DROP COLUMN linked_revocation_epoch;
ALTER TABLE authorized_operations RENAME COLUMN linked_scope_org_id TO owner_scope_org_id;
ALTER TABLE authorized_operations RENAME COLUMN linked_scope_project_id TO owner_scope_project_id;
ALTER TABLE authorized_operations RENAME COLUMN linked_scope_env_id TO owner_scope_env_id;
ALTER TABLE authorized_operation_audit_events DROP COLUMN linked_wallet_id;
ALTER TABLE authorized_operation_audit_events DROP COLUMN linked_enrollment_id;
ALTER TABLE authorized_operation_audit_events DROP COLUMN linked_device_id;
ALTER TABLE authorized_operation_audit_events DROP COLUMN linked_wallet_key_id;
ALTER TABLE authorized_operation_audit_events DROP COLUMN linked_lane_id;
ALTER TABLE authorized_operation_audit_events DROP COLUMN linked_lane_share_epoch;
ALTER TABLE authorized_operation_audit_events DROP COLUMN linked_revocation_epoch;
ALTER TABLE authorized_operation_audit_events RENAME COLUMN linked_scope_org_id TO owner_scope_org_id;
ALTER TABLE authorized_operation_audit_events RENAME COLUMN linked_scope_project_id TO owner_scope_project_id;
ALTER TABLE authorized_operation_audit_events RENAME COLUMN linked_scope_env_id TO owner_scope_env_id;

CREATE TRIGGER authorized_operation_audit_claim
AFTER INSERT ON authorized_operations
WHEN NEW.lifecycle_kind = 'claimed'
BEGIN
  INSERT INTO authorized_operation_audit_events (
    namespace, tenant_id, audit_event_id, authorized_operation_id,
    operation_fingerprint_digest, authorization_source_kind, authorization_id,
    authorization_grant_kind, evidence_set_digest, quota_id, material_activation_id,
    material_activation_capability, material_activation_owner,
    material_activation_key_binding, material_activation_lifecycle_binding,
    material_activation_signing_worker, owner_scope_org_id, owner_scope_project_id,
    owner_scope_env_id, result_kind, claimed_at_ms, completed_at_ms
  ) VALUES (
    NEW.namespace, NEW.tenant_id, NEW.audit_event_id, NEW.authorized_operation_id,
    NEW.operation_fingerprint_digest, NEW.authorization_source_kind, NEW.authorization_id,
    NEW.authorization_grant_kind, NEW.evidence_set_digest, NEW.quota_id,
    NEW.material_activation_id, NEW.material_activation_capability,
    NEW.material_activation_owner, NEW.material_activation_key_binding,
    NEW.material_activation_lifecycle_binding, NEW.material_activation_signing_worker,
    NEW.owner_scope_org_id, NEW.owner_scope_project_id,
    NEW.owner_scope_env_id, NEW.result_kind, NEW.claimed_at_ms, NEW.completed_at_ms
  );
END;
