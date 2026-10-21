-- One row for each successful signature, until the deployment that owns this database
-- delivers it to its Console usage count and deletes it. The completion of the signing
-- operation writes the row in the same statement, so a signature is counted once.
-- Key exports and failed operations write nothing; a copied operation history row is
-- inserted, not completed, so a relocation does not count it again.
CREATE TABLE wallet_signature_completions (
  namespace TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  authorized_operation_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK(operation_kind IN (
    'near.sign_transaction', 'near.sign_delegate_action', 'near.sign_nep413_message',
    'evm.sign_transaction')),
  org_id TEXT,
  project_id TEXT,
  env_id TEXT,
  completed_at_ms INTEGER NOT NULL CHECK(completed_at_ms > 0),
  PRIMARY KEY(namespace, tenant_id, authorized_operation_id)
);

CREATE INDEX wallet_signature_completions_due
  ON wallet_signature_completions(namespace, tenant_id, completed_at_ms);

CREATE TRIGGER wallet_signature_completion_record
AFTER UPDATE OF lifecycle_kind ON authorized_operations
WHEN OLD.lifecycle_kind = 'claimed' AND NEW.lifecycle_kind = 'completed'
  AND NEW.result_kind = 'succeeded'
  AND NEW.operation_kind IN (
    'near.sign_transaction', 'near.sign_delegate_action', 'near.sign_nep413_message',
    'evm.sign_transaction')
BEGIN
  INSERT INTO wallet_signature_completions (
    namespace, tenant_id, authorized_operation_id, operation_kind, org_id, project_id,
    env_id, completed_at_ms
  ) VALUES (
    NEW.namespace, NEW.tenant_id, NEW.authorized_operation_id, NEW.operation_kind,
    NEW.owner_scope_org_id, NEW.owner_scope_project_id, NEW.owner_scope_env_id,
    NEW.completed_at_ms
  ) ON CONFLICT DO NOTHING;
END;
