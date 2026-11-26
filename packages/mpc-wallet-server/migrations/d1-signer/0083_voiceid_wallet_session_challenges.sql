CREATE TABLE voiceid_wallet_session_challenges (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  wallet_auth_method_id TEXT NOT NULL,
  challenge_json TEXT NOT NULL CHECK(json_valid(challenge_json)),
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms > 0 AND issued_at_ms <= 9007199254740991),
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  PRIMARY KEY(namespace, org_id, project_id, env_id, challenge_id),
  CHECK(length(challenge_id) > 0 AND length(wallet_id) > 0 AND length(wallet_auth_method_id) > 0),
  CHECK(expires_at_ms > issued_at_ms AND expires_at_ms - issued_at_ms <= 60000),
  CHECK(consumed_at_ms IS NULL OR
    (consumed_at_ms >= issued_at_ms AND consumed_at_ms < expires_at_ms)),
  CHECK(COALESCE(json_extract(challenge_json, '$.kind') = 'voiceid_wallet_session_challenge_v1', 0)),
  CHECK(COALESCE(json_extract(challenge_json, '$.challengeId') = challenge_id, 0)),
  CHECK(COALESCE(json_extract(challenge_json, '$.walletId') = wallet_id, 0)),
  CHECK(COALESCE(json_extract(challenge_json, '$.walletAuthMethodId') = wallet_auth_method_id, 0)),
  CHECK(COALESCE(json_extract(challenge_json, '$.issuedAtMs') = issued_at_ms, 0)),
  CHECK(COALESCE(json_extract(challenge_json, '$.expiresAtMs') = expires_at_ms, 0))
);

CREATE INDEX voiceid_wallet_session_challenges_expiry
  ON voiceid_wallet_session_challenges(
    namespace, org_id, project_id, env_id, expires_at_ms
  );
