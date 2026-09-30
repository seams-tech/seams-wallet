-- R150: the committed answer to one auth-method revocation.
--
-- A revocation commits its method, session and envelope writes in one batch,
-- and this row with them: the exact answer the request received, bound to the
-- operation it named and to a digest of the proof that authorized it, never
-- the proof itself. An exact retry after a lost answer is answered from this
-- row instead of presenting its single-use proof again. A method is revoked
-- once, so the row is keyed by the method, and it never changes.
CREATE TABLE wallet_auth_method_revocation_replays (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  target_wallet_auth_method_id TEXT NOT NULL,
  operation_fingerprint_digest_b64u TEXT NOT NULL,
  source_wallet_auth_method_id TEXT NOT NULL,
  source_proof_digest_b64u TEXT NOT NULL,
  response_json TEXT NOT NULL,
  committed_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, target_wallet_auth_method_id),
  CHECK (length(operation_fingerprint_digest_b64u) > 0),
  CHECK (length(source_proof_digest_b64u) > 0),
  CHECK (json_valid(response_json)),
  CHECK (committed_at_ms >= 0)
);
