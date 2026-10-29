-- Reject unfinished transfers. Completed receipts remain immutable.
CREATE TABLE registration_publication_relocation_upgrade_guard (count INTEGER NOT NULL CHECK (count = 0));
INSERT INTO registration_publication_relocation_upgrade_guard
SELECT (SELECT COUNT(*) FROM wallet_relocation_authorization_snapshots AS snapshot
        WHERE NOT EXISTS (
          SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
          WHERE cleanup.namespace = snapshot.namespace AND cleanup.org_id = snapshot.org_id
            AND cleanup.project_id = snapshot.project_id AND cleanup.env_id = snapshot.env_id
            AND cleanup.wallet_id = snapshot.wallet_id AND cleanup.move_id = snapshot.move_id
            AND cleanup.request_digest_hex = snapshot.request_digest_hex
            AND cleanup.source_generation = snapshot.source_generation
            AND cleanup.state = 'cleaned'))
     + (SELECT COUNT(*) FROM wallet_relocation_authorization_imports WHERE state != 'activated');
DROP TABLE registration_publication_relocation_upgrade_guard;


-- Keep the retryable registration publication independent of session issuance.
DROP TRIGGER wallet_registration_directory_publication_identity;
ALTER TABLE wallet_registration_directory_publications RENAME TO registration_publications_with_session;
CREATE TABLE wallet_registration_directory_publications (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  ceremony_id TEXT NOT NULL CHECK(length(ceremony_id) > 0),
  session_json TEXT NOT NULL CHECK(json_valid(session_json) AND json_extract(session_json, '$.kind') IN ('none', 'credential')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'refused')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at_ms INTEGER NOT NULL CHECK(next_attempt_at_ms > 0),
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id)
);
INSERT INTO wallet_registration_directory_publications
SELECT namespace, org_id, project_id, env_id, wallet_id, ceremony_id,
  json_object('kind', 'credential', 'walletId', wallet_id, 'digest', session_digest, 'expiresAtMs', session_expires_at_ms),
  state, attempts, next_attempt_at_ms
FROM registration_publications_with_session;
DROP TABLE registration_publications_with_session;
CREATE INDEX wallet_registration_directory_publications_due
  ON wallet_registration_directory_publications(namespace, org_id, project_id, env_id, state, next_attempt_at_ms);
CREATE TRIGGER wallet_registration_directory_publication_identity
BEFORE UPDATE ON wallet_registration_directory_publications
WHEN NEW.wallet_id IS NOT OLD.wallet_id OR NEW.ceremony_id IS NOT OLD.ceremony_id
  OR NEW.session_json IS NOT OLD.session_json
  OR (OLD.state = 'refused' AND NEW.state != 'refused')
BEGIN SELECT RAISE(ABORT, 'wallet_registration_directory_publication_conflicts'); END;
