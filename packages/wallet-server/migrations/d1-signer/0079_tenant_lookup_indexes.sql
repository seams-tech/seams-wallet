-- Lookups that had no usable index and read every session or every wallet of
-- a tenant. Each index below serves statements that already exist; no
-- statement changes its result.
--
-- Without statistics the planner expects about ten rows behind the first
-- column of any index. An index that covers a lookup therefore wins over a
-- narrower one that needs the table row, although its first column is the
-- namespace, which every row shares. The two session indexes carry the columns
-- that their lookups read so that the planner selects them.

-- The operation triggers find the session that owns an operation through
-- wallet_operation_authorizations with the namespace, the tenant and the
-- authorization only. The primary key has org_id, project_id and env_id before
-- tenant_id, and the triggers compare those three inside an OR, so the key
-- gave a namespace prefix and the triggers read every session.
CREATE INDEX wallet_session_authorizations_v2_tenant_authorization_idx
  ON wallet_session_authorizations_v2 (
    namespace, tenant_id, authorization_id, org_id, project_id, env_id, wallet_id
  );

-- The quota freeze triggers find the session of a quota with the namespace,
-- the tenant, the quota and the wallet session only.
CREATE INDEX wallet_session_authorizations_v2_tenant_quota_idx
  ON wallet_session_authorizations_v2 (
    namespace, tenant_id, quota_id, wallet_session_id, org_id, project_id, env_id, wallet_id
  );

-- The registration cancellation fences and the Gateway admission find a wallet
-- by its registration ceremony. wallet_id is last so that the first match is
-- the one the primary key order gave, and so that the admission reads the
-- index only.
CREATE INDEX wallet_execution_generations_origin_idx
  ON wallet_execution_generations (namespace, org_id, project_id, env_id, origin, origin_id, wallet_id);
