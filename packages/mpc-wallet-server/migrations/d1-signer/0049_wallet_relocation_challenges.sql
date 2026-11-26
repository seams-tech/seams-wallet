CREATE TABLE wallet_relocation_challenges (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  binding_json TEXT NOT NULL CHECK (json_valid(binding_json)),
  challenge_b64u TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, move_id),
  CHECK (expires_at_ms > created_at_ms AND expires_at_ms - created_at_ms <= 300000),
  CHECK (consumed_at_ms IS NULL OR (consumed_at_ms >= created_at_ms AND consumed_at_ms < expires_at_ms))
);
