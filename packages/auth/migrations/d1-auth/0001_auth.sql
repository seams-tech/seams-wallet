-- The database of the Auth Worker: accounts, sign-in methods, challenges, email codes and login
-- sessions. It holds no custody material, no signing share and no Email OTP factor key.
-- Each row belongs to one project environment (org_id, project_id, env_id).

CREATE TABLE IF NOT EXISTS auth_accounts (
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (org_id, project_id, env_id, account_id),
  CHECK (length(account_id) > 0),
  CHECK (created_at_ms >= 0)
);

-- identifier is the passkey credential ID, the SHA-256 digest (hex) of the email address, or
-- the ID of the device key. public_key_b64u is the COSE key of a passkey or the raw Ed25519 key
-- of a device.
CREATE TABLE IF NOT EXISTS auth_methods (
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  method_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  identifier TEXT NOT NULL,
  public_key_b64u TEXT,
  counter INTEGER NOT NULL DEFAULT 0,
  rp_id TEXT NOT NULL DEFAULT '',
  email TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  PRIMARY KEY (org_id, project_id, env_id, method_id),
  FOREIGN KEY (org_id, project_id, env_id, account_id)
    REFERENCES auth_accounts (org_id, project_id, env_id, account_id),
  CHECK (length(method_id) > 0),
  CHECK (kind IN ('passkey', 'email_otp', 'voiceid')),
  CHECK (status IN ('active', 'revoked')),
  CHECK (length(identifier) > 0),
  CHECK (counter >= 0),
  CHECK ((status = 'revoked') = (revoked_at_ms IS NOT NULL)),
  CHECK (
    (kind = 'passkey' AND length(rp_id) > 0 AND public_key_b64u IS NOT NULL AND email IS NULL)
    OR (kind = 'email_otp' AND rp_id = '' AND public_key_b64u IS NULL AND email IS NOT NULL)
    OR (kind = 'voiceid' AND rp_id = '' AND length(public_key_b64u) = 43 AND email IS NULL)
  )
);

-- One active passkey or device key belongs to one account. An email address can be a method
-- of more than one account, so it has no such rule.
CREATE UNIQUE INDEX IF NOT EXISTS auth_methods_active_key
  ON auth_methods (org_id, project_id, env_id, kind, identifier)
  WHERE status = 'active' AND kind IN ('passkey', 'voiceid');

CREATE INDEX IF NOT EXISTS auth_methods_by_identifier
  ON auth_methods (org_id, project_id, env_id, kind, identifier);

CREATE INDEX IF NOT EXISTS auth_methods_by_account
  ON auth_methods (org_id, project_id, env_id, account_id);

-- A challenge of the Auth Worker itself. A row is deleted when it is used, so it is used once.
-- binding names what the challenge is for: an account for a passkey registration, a method for
-- a removal.
CREATE TABLE IF NOT EXISTS auth_challenges (
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  challenge TEXT NOT NULL,
  account_id TEXT,
  binding TEXT NOT NULL DEFAULT '',
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (org_id, project_id, env_id, challenge_id),
  CHECK (length(challenge_id) > 0),
  CHECK (length(audience) > 0),
  CHECK (length(challenge) > 0)
);

-- code_mac is an HMAC of the code under a secret of the Worker, so a copy of this table does
-- not give the codes. method_id names the method that the code proves; it is null for a
-- sign-in and for a new address. source_hash is a digest of the client address, for the send
-- limit.
CREATE TABLE IF NOT EXISTS auth_email_codes (
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  code_id TEXT NOT NULL,
  email TEXT NOT NULL,
  email_hash_hex TEXT NOT NULL,
  audience TEXT NOT NULL,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  method_id TEXT,
  code_mac TEXT NOT NULL,
  source_hash TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (org_id, project_id, env_id, code_id),
  CHECK (length(code_id) > 0),
  CHECK (length(email) > 0),
  CHECK (length(email_hash_hex) = 64),
  CHECK (attempts >= 0),
  CHECK (expires_at_ms > created_at_ms)
);

CREATE INDEX IF NOT EXISTS auth_email_codes_by_email
  ON auth_email_codes (org_id, project_id, env_id, email_hash_hex, created_at_ms);

-- The Worker stores the SHA-256 digest of a session token, not the token.
CREATE TABLE IF NOT EXISTS auth_sessions (
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  account_id TEXT NOT NULL,
  method_id TEXT,
  method_kind TEXT,
  email TEXT,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  PRIMARY KEY (org_id, project_id, env_id, session_id),
  FOREIGN KEY (org_id, project_id, env_id, account_id)
    REFERENCES auth_accounts (org_id, project_id, env_id, account_id),
  CHECK (length(session_id) > 0),
  CHECK (length(token_hash) = 43),
  CHECK (expires_at_ms > created_at_ms)
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_by_token ON auth_sessions (token_hash);

CREATE INDEX IF NOT EXISTS auth_sessions_by_account
  ON auth_sessions (org_id, project_id, env_id, account_id);
