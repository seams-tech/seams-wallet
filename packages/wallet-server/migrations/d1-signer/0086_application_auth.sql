-- Reject unfinished transfers. Completed receipts remain immutable.
CREATE TABLE external_auth_relocation_upgrade_guard (count INTEGER NOT NULL CHECK (count = 0));
INSERT INTO external_auth_relocation_upgrade_guard
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
DROP TABLE external_auth_relocation_upgrade_guard;


-- Identity domains remain distinct across Google and application-issued subjects.
UPDATE external_auth_associations
SET provider_subject = json_array('google', 'https://accounts.google.com', provider_subject);

ALTER TABLE external_auth_attempts RENAME TO external_auth_attempts_before_application;
CREATE TABLE external_auth_attempts (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL, wallet_id TEXT NOT NULL, origin TEXT NOT NULL,
  binding_hash TEXT NOT NULL, session_token_hash TEXT NOT NULL, expires_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'verified', 'consumed', 'revoked')),
  purpose TEXT NOT NULL CHECK (purpose IN ('authenticate', 'associate', 'unlink')),
  association_id TEXT, trust_revision INTEGER, code_hash TEXT, session_expires_at_ms INTEGER,
  identity_subject TEXT, owner_challenge_expires_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, project_id, env_id, attempt_id),
  CHECK (
    status = 'revoked' OR
    (status = 'prepared' AND purpose IN ('authenticate', 'associate')
      AND association_id IS NULL AND trust_revision IS NULL AND code_hash IS NULL
      AND session_expires_at_ms IS NULL AND identity_subject IS NULL
      AND owner_challenge_expires_at_ms IS NULL) OR
    (status IN ('verified', 'consumed') AND trust_revision IS NOT NULL AND code_hash IS NOT NULL
      AND identity_subject IS NOT NULL AND (
        (purpose = 'authenticate' AND association_id IS NOT NULL
          AND session_expires_at_ms IS NOT NULL AND owner_challenge_expires_at_ms IS NULL) OR
        (purpose = 'associate' AND session_expires_at_ms IS NOT NULL
          AND (status = 'verified' OR owner_challenge_expires_at_ms IS NOT NULL)) OR
        (purpose = 'unlink' AND association_id IS NOT NULL AND session_expires_at_ms IS NULL
          AND (status = 'verified' OR owner_challenge_expires_at_ms IS NOT NULL))
      ))
  )
);
INSERT INTO external_auth_attempts
  (namespace, org_id, project_id, env_id, attempt_id, wallet_id, origin, binding_hash,
   session_token_hash, expires_at_ms, status, purpose, association_id, trust_revision,
   code_hash, session_expires_at_ms, identity_subject)
SELECT attempt.namespace, attempt.org_id, attempt.project_id, attempt.env_id, attempt.attempt_id,
  attempt.wallet_id, attempt.origin, attempt.binding_hash, attempt.session_token_hash,
  attempt.expires_at_ms,
  CASE WHEN attempt.status IN ('verified', 'consumed') AND association.association_id IS NULL
    THEN 'revoked' ELSE attempt.status END,
  'authenticate', attempt.association_id, attempt.trust_revision, attempt.code_hash,
  attempt.session_expires_at_ms, association.provider_subject
FROM external_auth_attempts_before_application attempt
LEFT JOIN external_auth_associations association
  ON association.namespace = attempt.namespace AND association.org_id = attempt.org_id
  AND association.project_id = attempt.project_id AND association.env_id = attempt.env_id
  AND association.association_id = attempt.association_id;
DROP TABLE external_auth_attempts_before_application;
CREATE UNIQUE INDEX external_auth_session_token
  ON external_auth_attempts(namespace, org_id, project_id, env_id, session_token_hash);
CREATE INDEX external_auth_attempt_expiry ON external_auth_attempts(expires_at_ms);
