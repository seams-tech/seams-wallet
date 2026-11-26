-- Resolve pending claims through their exact persisted Wallet Session owner.
CREATE VIEW wallet_session_pending_operations AS
SELECT session.namespace, session.org_id, session.project_id, session.env_id,
       session.wallet_id, operation.tenant_id, operation.authorized_operation_id
FROM authorized_operations AS operation
JOIN wallet_session_authorizations_v2 AS session
  ON session.namespace = operation.namespace
 AND session.tenant_id = operation.tenant_id
 AND session.authorization_id = operation.authorization_id
 AND session.org_id = operation.owner_scope_org_id
 AND session.project_id = operation.owner_scope_project_id
 AND session.env_id = operation.owner_scope_env_id
WHERE operation.authorization_source_kind = 'authorization_grant'
  AND operation.authorization_grant_kind = 'wallet_session_authorization'
  AND operation.lifecycle_kind = 'claimed';

-- The check and retirement share a transaction with claims and completion.
CREATE TRIGGER wallet_relocation_sessions_require_settled_operations
BEFORE INSERT ON wallet_relocation_session_fences
WHEN EXISTS (
  SELECT 1 FROM wallet_session_pending_operations AS operation
  WHERE operation.namespace = NEW.namespace AND operation.org_id = NEW.org_id
    AND operation.project_id = NEW.project_id AND operation.env_id = NEW.env_id
    AND operation.wallet_id = NEW.wallet_id
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_session_operations_unsettled');
END;
