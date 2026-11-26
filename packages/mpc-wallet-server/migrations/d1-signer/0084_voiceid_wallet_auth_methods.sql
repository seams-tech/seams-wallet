-- Rebuild the canonical method table to admit wallet-bound VoiceID device keys.
-- Copy every existing row before replacing the table. Child foreign keys remain
-- valid after the original name is restored.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE wallet_auth_methods_next (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  wallet_authority_id TEXT NOT NULL,
  rp_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  wallet_auth_method_id TEXT NOT NULL,
  auth_identifier_key TEXT NOT NULL,
  credential_id_b64u TEXT,
  credential_public_key_b64u TEXT,
  email_hash_hex TEXT,
  registration_authority_id TEXT,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  activated_at_ms INTEGER,
  revoked_at_ms INTEGER,
  provider TEXT,
  provider_user_id TEXT,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_auth_method_id),
  FOREIGN KEY (
    namespace,
    org_id,
    project_id,
    env_id,
    wallet_authority_id
  ) REFERENCES wallet_authorities(
    namespace,
    org_id,
    project_id,
    env_id,
    authority_id
  ),
  CHECK (length(wallet_id) > 0),
  CHECK (length(wallet_authority_id) > 0),
  CHECK (kind IN ('passkey', 'email_otp', 'voiceid')),
  CHECK (status IN ('pending_local_install', 'active', 'revoked')),
  CHECK (length(wallet_auth_method_id) > 0),
  CHECK (length(auth_identifier_key) > 0),
  CHECK (json_valid(record_json)),
  CHECK (created_at_ms >= 0),
  CHECK (updated_at_ms >= created_at_ms),
  CHECK (
    (status = 'pending_local_install' AND activated_at_ms IS NULL AND revoked_at_ms IS NULL)
    OR
    (status = 'active' AND activated_at_ms IS NOT NULL AND revoked_at_ms IS NULL)
    OR
    (status = 'revoked' AND activated_at_ms IS NOT NULL AND revoked_at_ms IS NOT NULL)
  ),
  CHECK (
    (kind = 'passkey'
      AND length(rp_id) > 0
      AND credential_id_b64u IS NOT NULL
      AND length(credential_id_b64u) > 0
      AND credential_public_key_b64u IS NOT NULL
      AND length(credential_public_key_b64u) > 0
      AND email_hash_hex IS NULL
      AND registration_authority_id IS NULL
      AND auth_identifier_key = credential_id_b64u)
    OR
    (kind = 'email_otp'
      AND rp_id = ''
      AND credential_id_b64u IS NULL
      AND credential_public_key_b64u IS NULL
      AND email_hash_hex IS NOT NULL
      AND length(email_hash_hex) > 0
      AND registration_authority_id IS NOT NULL
      AND length(registration_authority_id) > 0
      AND auth_identifier_key = email_hash_hex)
    OR
    (kind = 'voiceid'
      AND rp_id = ''
      AND credential_id_b64u IS NULL
      AND credential_public_key_b64u IS NOT NULL
      AND length(credential_public_key_b64u) = 43
      AND email_hash_hex IS NULL
      AND registration_authority_id IS NULL
      AND provider IS NULL
      AND provider_user_id IS NULL
      AND length(auth_identifier_key) = 43
      AND COALESCE(auth_identifier_key = json_extract(record_json, '$.deviceKeyId'), 0))
  ),
  CHECK (json_extract(record_json, '$.version') = 'wallet_auth_method_v2'),
  CHECK (json_extract(record_json, '$.walletAuthMethodId') = wallet_auth_method_id),
  CHECK (json_extract(record_json, '$.walletId') = wallet_id),
  CHECK (json_extract(record_json, '$.walletAuthorityId') = wallet_authority_id),
  CHECK (json_extract(record_json, '$.kind') = kind),
  CHECK (json_extract(record_json, '$.status') = status),
  CHECK (json_extract(record_json, '$.createdAtMs') = created_at_ms),
  CHECK (json_extract(record_json, '$.updatedAtMs') = updated_at_ms),
  CHECK (
    (kind = 'passkey'
      AND json_extract(record_json, '$.rpId') = rp_id
      AND json_extract(record_json, '$.credentialIdB64u') = credential_id_b64u
      AND json_extract(record_json, '$.credentialPublicKeyB64u') = credential_public_key_b64u
      AND json_extract(record_json, '$.counter') >= 0)
    OR
    (kind = 'email_otp'
      AND json_extract(record_json, '$.emailHashHex') = email_hash_hex
      AND json_extract(record_json, '$.registrationAuthorityId') = registration_authority_id)
    OR
    (kind = 'voiceid'
      AND COALESCE(json_extract(record_json, '$.deviceKeyId') = auth_identifier_key, 0)
      AND COALESCE(json_extract(record_json, '$.devicePublicKeyB64u') = credential_public_key_b64u, 0))
  )
);

INSERT INTO wallet_auth_methods_next (
  namespace, org_id, project_id, env_id, wallet_id, wallet_authority_id,
  rp_id, kind, status, wallet_auth_method_id, auth_identifier_key,
  credential_id_b64u, credential_public_key_b64u, email_hash_hex,
  registration_authority_id, record_json, created_at_ms, updated_at_ms,
  activated_at_ms, revoked_at_ms, provider, provider_user_id
)
SELECT
  namespace, org_id, project_id, env_id, wallet_id, wallet_authority_id,
  rp_id, kind, status, wallet_auth_method_id, auth_identifier_key,
  credential_id_b64u, credential_public_key_b64u, email_hash_hex,
  registration_authority_id, record_json, created_at_ms, updated_at_ms,
  activated_at_ms, revoked_at_ms, provider, provider_user_id
FROM wallet_auth_methods;

DROP TRIGGER authorized_operation_owner_grant_claim_atomic;
DROP TABLE wallet_auth_methods;
ALTER TABLE wallet_auth_methods_next RENAME TO wallet_auth_methods;

CREATE INDEX wallet_auth_methods_wallet_authority_status_idx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id, wallet_id, wallet_authority_id, status
  );

CREATE UNIQUE INDEX wallet_auth_methods_v2_passkey_uidx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id, rp_id, credential_id_b64u
  )
  WHERE kind = 'passkey' AND credential_id_b64u IS NOT NULL;

CREATE UNIQUE INDEX wallet_auth_methods_v2_voiceid_key_uidx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id, auth_identifier_key
  )
  WHERE kind = 'voiceid';

CREATE UNIQUE INDEX wallet_auth_methods_authority_identity_uidx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id,
    wallet_auth_method_id, wallet_id, wallet_authority_id
  );

CREATE UNIQUE INDEX wallet_auth_methods_v2_authority_email_uidx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id, wallet_id, wallet_authority_id
  )
  WHERE kind = 'email_otp' AND status = 'active';

CREATE INDEX wallet_auth_methods_v2_email_provider_idx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id, provider, provider_user_id
  )
  WHERE kind = 'email_otp' AND provider_user_id IS NOT NULL;

CREATE TRIGGER wallet_auth_methods_frozen_insert
BEFORE INSERT ON wallet_auth_methods
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_auth_methods_frozen_update
BEFORE UPDATE ON wallet_auth_methods
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id
  ) OR EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_auth_methods_frozen_delete
BEFORE DELETE ON wallet_auth_methods
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
        AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER wallet_auth_methods_inactive_import_insert
BEFORE INSERT ON wallet_auth_methods
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated') AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
        AND destination.project_id = context.project_id AND destination.env_id = context.env_id
        AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
        AND destination.request_digest_hex = context.request_digest_hex
        AND destination.source_generation = context.source_generation AND destination.state = 'importing'
      WHERE context.namespace = NEW.namespace AND context.wallet_id = NEW.wallet_id
        AND context.table_name = 'wallet_auth_methods'
        AND context.record_key = json_array(NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.wallet_auth_method_id)
    ))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER wallet_auth_methods_inactive_import_update
BEFORE UPDATE ON wallet_auth_methods
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')) OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER wallet_auth_methods_inactive_import_delete
BEFORE DELETE ON wallet_auth_methods
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

-- Restore the operation claim guard after the canonical method name exists again.
CREATE TRIGGER authorized_operation_owner_grant_claim_atomic
AFTER INSERT ON authorized_operations
WHEN NEW.lifecycle_kind = 'claimed'
  AND NEW.authorization_source_kind = 'authorization_grant'
  AND NEW.authorization_grant_kind = 'wallet_session_authorization'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM wallet_session_authorizations_v2 AS session
        JOIN authorization_wallet_session_quotas AS quota
          ON quota.namespace = session.namespace
         AND quota.tenant_id = session.tenant_id
         AND quota.quota_id = session.quota_id
         AND quota.wallet_session_id = session.wallet_session_id
         AND quota.principal_id = session.principal_id
        JOIN wallet_authorities AS authority
          ON authority.namespace = session.namespace
         AND authority.org_id = session.org_id
         AND authority.project_id = session.project_id
         AND authority.env_id = session.env_id
         AND authority.authority_id = session.authority_id
         AND authority.wallet_id = session.wallet_id
        JOIN wallet_auth_methods AS auth_method
          ON auth_method.namespace = session.namespace
         AND auth_method.org_id = session.org_id
         AND auth_method.project_id = session.project_id
         AND auth_method.env_id = session.env_id
         AND auth_method.wallet_auth_method_id = session.wallet_auth_method_id
         AND auth_method.wallet_id = session.wallet_id
         AND auth_method.wallet_authority_id = session.authority_id
       WHERE session.namespace = NEW.namespace
         AND session.org_id = NEW.owner_scope_org_id
         AND session.project_id = NEW.owner_scope_project_id
         AND session.env_id = NEW.owner_scope_env_id
         AND session.tenant_id = NEW.tenant_id
         AND session.authorization_id = NEW.authorization_id
         AND session.principal_id = NEW.principal_id
         AND (NEW.quota_kind = 'quota_neutral' OR session.quota_id = NEW.quota_id)
         AND session.operation_credential_hash IS NOT NULL
         AND session.retired_at_ms IS NULL
         AND session.expires_at_ms > NEW.claimed_at_ms
         AND authority.lifecycle_state = 'active'
         AND authority.authority_digest_b64u = session.authority_digest_b64u
         AND authority.revocation_epoch = session.authority_revocation_epoch
         AND auth_method.status = 'active'
    )
    THEN RAISE(ABORT, 'authorization_wallet_session_rejected')
  END;

  UPDATE authorization_wallet_session_quotas
     SET remaining_uses = remaining_uses - 1,
         lifecycle_kind = CASE WHEN remaining_uses = 1 THEN 'exhausted' ELSE 'active' END
   WHERE NEW.quota_kind = 'consume_reusable_wallet_session'
     AND namespace = NEW.namespace
     AND tenant_id = NEW.tenant_id
     AND quota_id = NEW.quota_id
     AND principal_id = NEW.principal_id
     AND lifecycle_kind = 'active'
     AND remaining_uses > 0
     AND expires_at_ms > NEW.claimed_at_ms
     AND wallet_session_id = (
       SELECT session.wallet_session_id
         FROM wallet_session_authorizations_v2 AS session
         JOIN authorization_wallet_session_quotas AS quota
           ON quota.namespace = session.namespace
          AND quota.tenant_id = session.tenant_id
          AND quota.quota_id = session.quota_id
          AND quota.wallet_session_id = session.wallet_session_id
          AND quota.principal_id = session.principal_id
         JOIN wallet_authorities AS authority
           ON authority.namespace = session.namespace
          AND authority.org_id = session.org_id
          AND authority.project_id = session.project_id
          AND authority.env_id = session.env_id
          AND authority.authority_id = session.authority_id
          AND authority.wallet_id = session.wallet_id
         JOIN wallet_auth_methods AS auth_method
           ON auth_method.namespace = session.namespace
          AND auth_method.org_id = session.org_id
          AND auth_method.project_id = session.project_id
          AND auth_method.env_id = session.env_id
          AND auth_method.wallet_auth_method_id = session.wallet_auth_method_id
          AND auth_method.wallet_id = session.wallet_id
          AND auth_method.wallet_authority_id = session.authority_id
        WHERE session.namespace = NEW.namespace
          AND session.org_id = NEW.owner_scope_org_id
          AND session.project_id = NEW.owner_scope_project_id
          AND session.env_id = NEW.owner_scope_env_id
          AND session.tenant_id = NEW.tenant_id
          AND session.authorization_id = NEW.authorization_id
          AND session.principal_id = NEW.principal_id
          AND session.quota_id = NEW.quota_id
          AND session.operation_credential_hash IS NOT NULL
          AND session.retired_at_ms IS NULL
          AND session.expires_at_ms > NEW.claimed_at_ms
          AND authority.lifecycle_state = 'active'
          AND authority.authority_digest_b64u = session.authority_digest_b64u
          AND authority.revocation_epoch = session.authority_revocation_epoch
          AND auth_method.status = 'active'
        LIMIT 1
     );

  SELECT CASE
    WHEN NEW.quota_kind = 'consume_reusable_wallet_session' AND changes() != 1
    THEN RAISE(ABORT, 'authorization_wallet_session_quota_rejected')
  END;
END;

-- Abort if a referenced method was lost during the rebuild.
CREATE TABLE voiceid_wallet_auth_method_fk_guard (
  guard_id INTEGER PRIMARY KEY CHECK (guard_id = 1)
);
INSERT INTO voiceid_wallet_auth_method_fk_guard (guard_id)
SELECT 0 FROM pragma_foreign_key_check LIMIT 1;
DROP TABLE voiceid_wallet_auth_method_fk_guard;

-- SQLite remembers deferred DROP TABLE violations until this switch. The guard
-- above verifies that all references point to the restored canonical table.
PRAGMA defer_foreign_keys = OFF;
