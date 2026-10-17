-- An active registration home whose directory write has no acknowledgement yet.
-- The batch that completes the registration operation and activates the home
-- inserts the row; the acknowledgement deletes it. A refused row stays for an operator.
CREATE TABLE wallet_registration_directory_publications (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  ceremony_id TEXT NOT NULL CHECK(length(ceremony_id) > 0),
  session_digest TEXT NOT NULL CHECK(length(session_digest) > 0),
  session_expires_at_ms INTEGER NOT NULL
    CHECK(session_expires_at_ms > 0 AND session_expires_at_ms <= 9007199254740991),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'refused')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at_ms INTEGER NOT NULL CHECK(next_attempt_at_ms > 0),
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id)
);

CREATE INDEX wallet_registration_directory_publications_due
  ON wallet_registration_directory_publications(namespace, org_id, project_id, env_id, state, next_attempt_at_ms);

CREATE TRIGGER wallet_registration_directory_publication_identity
BEFORE UPDATE ON wallet_registration_directory_publications
WHEN NEW.wallet_id IS NOT OLD.wallet_id OR NEW.ceremony_id IS NOT OLD.ceremony_id
  OR NEW.session_digest IS NOT OLD.session_digest
  OR NEW.session_expires_at_ms IS NOT OLD.session_expires_at_ms
  OR (OLD.state = 'refused' AND NEW.state != 'refused')
BEGIN SELECT RAISE(ABORT, 'wallet_registration_directory_publication_conflicts'); END;
