-- Existing history has no proven execution generation. Preserve it without
-- inventing one. Every new claim must pin the active local generation.
CREATE TABLE wallet_operation_generation_upgrade_guard (count INTEGER NOT NULL CHECK(count = 0));
INSERT INTO wallet_operation_generation_upgrade_guard
SELECT (SELECT COUNT(*) FROM wallet_relocation_authorization_snapshots)
     + (SELECT COUNT(*) FROM wallet_relocation_authorization_imports);
DROP TABLE wallet_operation_generation_upgrade_guard;

ALTER TABLE authorized_operations ADD COLUMN ownership_generation INTEGER
  CHECK(ownership_generation > 0 AND ownership_generation <= 9007199254740991);

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

CREATE TRIGGER wallet_operation_execution_generation_immutable
BEFORE UPDATE ON authorized_operations
WHEN NEW.ownership_generation IS NOT OLD.ownership_generation
BEGIN SELECT RAISE(ABORT, 'wallet_operation_execution_generation_immutable'); END;
