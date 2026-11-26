CREATE TABLE namespace_home_challenges (
  namespace TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  proof TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, challenge_id),
  CHECK (length(challenge_id) = 64),
  CHECK (length(proof) = 64),
  CHECK (issued_at_ms > 0),
  CHECK (expires_at_ms > issued_at_ms AND expires_at_ms <= issued_at_ms + 300000)
);

CREATE INDEX namespace_home_challenges_expiry_idx ON namespace_home_challenges(expires_at_ms);
