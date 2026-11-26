-- Unowned receipts cannot be attributed from capability hashes. Require the
-- disposable-wallet reset before replacing a populated receipt table.
CREATE TABLE capability_receipt_reset_guard (
  receipt_count INTEGER NOT NULL CHECK (receipt_count = 0)
);
INSERT INTO capability_receipt_reset_guard
SELECT COUNT(*) FROM router_ab_yao_capability_replacements;
DROP TABLE capability_receipt_reset_guard;
DROP TABLE router_ab_yao_capability_replacements;
CREATE TABLE router_ab_yao_capability_replacements (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL CHECK (length(wallet_id) > 0),
  operation_id TEXT NOT NULL,
  operation_fingerprint TEXT NOT NULL,
  previous_capability_binding_json TEXT NOT NULL,
  next_capability_binding_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, operation_id),
  CHECK (length(operation_id) > 0),
  CHECK (length(operation_fingerprint) > 0),
  CHECK (json_valid(previous_capability_binding_json)),
  CHECK (json_valid(next_capability_binding_json)),
  CHECK (created_at_ms >= 0)
);
CREATE INDEX capability_replacements_wallet ON router_ab_yao_capability_replacements
  (namespace, org_id, project_id, env_id, wallet_id);
