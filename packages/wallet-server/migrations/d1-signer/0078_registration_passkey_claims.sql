-- A passkey ownership claim that shared authority granted for one registration
-- ceremony before its finalization. Finalization reads the row and skips its
-- own claim request. A missing row means only that finalization claims again.
CREATE TABLE registration_passkey_claims (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  registration_ceremony_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  credential_id_b64u TEXT NOT NULL,
  claimed_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, registration_ceremony_id)
);

-- Shared authority never reassigns a claim, so a recorded claim never changes.
CREATE TRIGGER registration_passkey_claims_immutable
BEFORE UPDATE ON registration_passkey_claims
BEGIN SELECT RAISE(ABORT, 'registration_passkey_claims_immutable'); END;
