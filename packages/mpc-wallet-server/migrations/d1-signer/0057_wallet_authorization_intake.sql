CREATE TABLE wallet_relocation_authorization_intakes (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL, manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  next_index INTEGER NOT NULL DEFAULT 0 CHECK(next_index >= 0),
  record_count INTEGER NOT NULL DEFAULT 0 CHECK(record_count >= 0),
  digest_hex TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'receiving' CHECK(state IN ('receiving', 'verified')),
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id)
);
CREATE TABLE wallet_relocation_authorization_intake_chunks (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, chunk_index INTEGER NOT NULL CHECK(chunk_index >= 0),
  chunk_json TEXT NOT NULL CHECK(json_valid(chunk_json) AND length(CAST(chunk_json AS BLOB)) <= 131072),
  digest_hex TEXT NOT NULL,
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id, chunk_index)
);
CREATE TRIGGER wallet_authorization_intake_identity_immutable
BEFORE UPDATE ON wallet_relocation_authorization_intakes
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex OR NEW.source_generation IS NOT OLD.source_generation
  OR NEW.manifest_json IS NOT OLD.manifest_json OR OLD.state = 'verified'
  OR NEW.next_index < OLD.next_index OR NEW.next_index > OLD.next_index + 1
  OR NEW.record_count < OLD.record_count OR NEW.record_count > OLD.record_count + 1
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_intake_immutable'); END;
CREATE TRIGGER wallet_authorization_intake_retained
BEFORE DELETE ON wallet_relocation_authorization_intakes
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_intake_retained'); END;
CREATE TRIGGER wallet_authorization_intake_chunk_immutable
BEFORE UPDATE ON wallet_relocation_authorization_intake_chunks
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_intake_chunk_immutable'); END;
CREATE TRIGGER wallet_authorization_intake_chunk_retained
BEFORE DELETE ON wallet_relocation_authorization_intake_chunks
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_intake_chunk_retained'); END;
CREATE TRIGGER wallet_authorization_intake_chunk_admission
BEFORE INSERT ON wallet_relocation_authorization_intake_chunks
WHEN NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_intakes AS intake
  WHERE intake.namespace = NEW.namespace AND intake.org_id = NEW.org_id
    AND intake.project_id = NEW.project_id AND intake.env_id = NEW.env_id
    AND intake.wallet_id = NEW.wallet_id AND intake.state = 'receiving'
    AND intake.next_index = NEW.chunk_index)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_intake_chunk_out_of_order'); END;
