-- A linked Email OTP device enrolls its own factor, and the server releases no factor of another
-- Email OTP method. So a device-link grant no longer names a base method, and the table loses
-- its base_wallet_auth_method_id column. A grant lives for minutes, so the open grants are
-- dropped: such a device link asks for a new code. The indexes, and the relocation and
-- capacity triggers of migrations 0072 and 0076, are created again without change.
DROP TABLE linked_device_email_otp_grants;

CREATE TABLE linked_device_email_otp_grants (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  grant_token_digest_b64u TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  link_session_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  target_factor TEXT NOT NULL,
  target_preparation_digest_b64u TEXT NOT NULL,
  target_email TEXT NOT NULL,
  enrollment_kind TEXT NOT NULL,
  email_hash_hex TEXT NOT NULL,
  registration_authority_id TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  linked_owner_auth_method_id TEXT NOT NULL,
  authority_digest_b64u TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  state TEXT NOT NULL,
  record_json TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, project_id, env_id, grant_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, link_session_id)
    REFERENCES linked_device_sessions(namespace, org_id, project_id, env_id, link_session_id),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(grant_id) > 0),
  CHECK (length(grant_token_digest_b64u) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(link_session_id) > 0),
  CHECK (length(enrollment_id) > 0),
  CHECK (length(device_id) > 0),
  CHECK (target_factor = 'email_otp'),
  CHECK (length(target_preparation_digest_b64u) > 0),
  CHECK (length(target_email) > 0),
  CHECK (enrollment_kind IN ('existing_enrollment', 'new_enrollment')),
  CHECK (length(email_hash_hex) > 0),
  CHECK (length(registration_authority_id) > 0),
  CHECK (length(provider_user_id) > 0),
  CHECK (length(linked_owner_auth_method_id) > 0),
  CHECK (length(authority_digest_b64u) > 0),
  CHECK (length(challenge_id) > 0),
  CHECK (state IN ('issued', 'consumed')),
  CHECK (json_valid(record_json)),
  CHECK (issued_at_ms > 0),
  CHECK (expires_at_ms > issued_at_ms),
  CHECK (
    (state = 'issued' AND consumed_at_ms IS NULL)
    OR (state = 'consumed' AND consumed_at_ms >= issued_at_ms)
  ),
  CHECK (COALESCE(json_extract(record_json, '$.kind') = 'linked_device_email_otp_grant_record_v1', 0)),
  CHECK (COALESCE(json_extract(record_json, '$.grantId') = grant_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.grantTokenDigestB64u') = grant_token_digest_b64u, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.walletId') = wallet_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.linkSessionId') = link_session_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.enrollmentId') = enrollment_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.deviceId') = device_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.targetFactor.kind') = target_factor, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.targetPreparationDigestB64u') = target_preparation_digest_b64u, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.targetEmail') = target_email, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.enrollment.kind') = enrollment_kind, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.emailHashHex') = email_hash_hex, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.registrationAuthorityId') = registration_authority_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.providerUserId') = provider_user_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.linkedOwnerAuthMethodId') = linked_owner_auth_method_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.authorityDigestB64u') = authority_digest_b64u, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.challengeId') = challenge_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.state.kind') = state, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.issuedAtMs') = issued_at_ms, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.expiresAtMs') = expires_at_ms, 0)),
  CHECK (
    consumed_at_ms IS NULL
    OR COALESCE(json_extract(record_json, '$.state.consumedAtMs') = consumed_at_ms, 0)
  )
);

CREATE INDEX linked_device_email_otp_grants_session_idx
  ON linked_device_email_otp_grants (
    namespace, org_id, project_id, env_id, link_session_id, state, expires_at_ms
  );
CREATE INDEX linked_device_email_otp_grants_expiry_idx
  ON linked_device_email_otp_grants (namespace, org_id, project_id, env_id, expires_at_ms);

CREATE TRIGGER linked_device_email_otp_grants_relocation_insert
BEFORE INSERT ON linked_device_email_otp_grants
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated') AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = NEW.wallet_id
      AND context.table_name = 'linked_device_email_otp_grants' AND context.record_key = json_array(NEW.env_id, NEW.grant_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER linked_device_email_otp_grants_relocation_update
BEFORE UPDATE ON linked_device_email_otp_grants
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_email_otp_grants' AND receipt.record_key = json_array(OLD.env_id, OLD.grant_id, OLD.namespace, OLD.org_id, OLD.project_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
      AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
      AND receipt.wallet_id = NEW.wallet_id AND receipt.table_name = 'linked_device_email_otp_grants' AND receipt.record_key = json_array(NEW.env_id, NEW.grant_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER linked_device_email_otp_grants_relocation_delete
BEFORE DELETE ON linked_device_email_otp_grants
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = OLD.wallet_id AND cleanup.state = 'cleaning'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_email_otp_grants' AND receipt.record_key = json_array(OLD.env_id, OLD.grant_id, OLD.namespace, OLD.org_id, OLD.project_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = OLD.wallet_id AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER linked_device_email_otp_grants_capacity_insert BEFORE INSERT ON linked_device_email_otp_grants
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_email_otp_grants_capacity_update BEFORE UPDATE ON linked_device_email_otp_grants
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_email_otp_grants_capacity_delete BEFORE DELETE ON linked_device_email_otp_grants
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;
