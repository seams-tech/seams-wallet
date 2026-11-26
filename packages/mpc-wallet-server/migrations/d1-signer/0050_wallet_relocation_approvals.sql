CREATE TABLE wallet_relocation_approvals (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  binding_json TEXT NOT NULL CHECK (json_valid(binding_json)),
  authority_digest_b64u TEXT NOT NULL,
  authority_revocation_epoch INTEGER NOT NULL CHECK (authority_revocation_epoch >= 0),
  approved_at_ms INTEGER NOT NULL CHECK (approved_at_ms > 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > approved_at_ms),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, move_id)
);
