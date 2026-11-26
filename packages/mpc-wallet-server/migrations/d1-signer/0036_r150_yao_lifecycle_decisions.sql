-- R150: one finalization decision per Ed25519 Yao lifecycle.
--
-- The Router's wallet object records each registration's execution and binds
-- the first finalization that consumes it. The decision is the Gateway's fact:
-- a row here commits in the same batch as the writes that make the
-- finalization visible (the wallet's signer rows), so the result is visible if
-- and only if its decision exists. A row is written once and never changes.
CREATE TABLE yao_lifecycle_decisions (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  lifecycle_id TEXT NOT NULL,
  decision_kind TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  decided_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, lifecycle_id),
  CHECK (decision_kind IN ('registration_finalized', 'add_signer_finalized')),
  CHECK (length(decision_id) > 0),
  CHECK (length(wallet_id) > 0)
);
