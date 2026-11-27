-- The signer D1 schema. It replaces migrations 0001 to 0091 of earlier releases. A new
-- database gets the whole schema here. A database that has all 91 of those migrations runs
-- this file once as a no-op and keeps its data: every CREATE is IF NOT EXISTS and every seed
-- row is INSERT OR IGNORE. Do not change this file; add the next migration instead.

-- Refuse a database that has some, but not all, of migrations 0001 to 0091. Such a database
-- has the wallets table, but its linked_device_email_otp_grants table is missing or still has
-- the base_wallet_auth_method_id column that migration 0091 removed. IF NOT EXISTS would keep
-- its older tables as they are, so it must apply migration 0091 with the 0.76 release first.
CREATE TABLE signer_baseline_guard (
  ready INTEGER NOT NULL CONSTRAINT apply_migration_0091_first CHECK (ready = 1)
);
INSERT INTO signer_baseline_guard (ready)
SELECT 0
WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'wallets')
  AND NOT EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type = 'table'
      AND name = 'linked_device_email_otp_grants'
      AND instr(sql, 'base_wallet_auth_method_id') = 0
  );
DROP TABLE signer_baseline_guard;

CREATE TABLE IF NOT EXISTS authorization_wallet_session_quotas (
  namespace TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  quota_id TEXT NOT NULL,
  wallet_session_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  remaining_uses INTEGER NOT NULL,
  lifecycle_kind TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, tenant_id, quota_id),
  UNIQUE (namespace, tenant_id, wallet_session_id),
  CHECK (remaining_uses >= 0),
  CHECK (lifecycle_kind IN ('active', 'exhausted')),
  CHECK (
    (lifecycle_kind = 'active' AND remaining_uses > 0)
    OR (lifecycle_kind = 'exhausted' AND remaining_uses = 0)
  )
);

CREATE TABLE IF NOT EXISTS "email_otp_auth_states" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  record_org_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(provider_user_id) > 0),
  CHECK (length(record_org_id) > 0),
  CHECK (json_valid(record_json)),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms >= created_at_ms),
  CHECK (COALESCE(json_extract(record_json, '$.version') = 'email_otp_auth_state_v1', 0)),
  CHECK (COALESCE(json_extract(record_json, '$.walletId') = wallet_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.providerUserId') = provider_user_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.orgId') = record_org_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.createdAtMs') = created_at_ms, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.updatedAtMs') = updated_at_ms, 0))
);

CREATE TABLE IF NOT EXISTS "email_otp_grants" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  grant_token TEXT NOT NULL,
  user_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  record_org_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  action TEXT NOT NULL,
  record_json TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, grant_token),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(grant_token) > 0),
  CHECK (length(user_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(challenge_id) > 0),
  CHECK (action IN ('wallet_email_otp_unseal', 'wallet_email_otp_device_recovery')),
  CHECK (json_valid(record_json)),
  CHECK (issued_at_ms > 0),
  CHECK (expires_at_ms > issued_at_ms),
  CHECK (COALESCE(json_extract(record_json, '$.version') = 'email_otp_grant_v1', 0)),
  CHECK (COALESCE(json_extract(record_json, '$.grantToken') = grant_token, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.userId') = user_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.walletId') = wallet_id, 0)),
  CHECK (record_org_id = '' OR COALESCE(json_extract(record_json, '$.orgId') = record_org_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.challengeId') = challenge_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.otpChannel') = 'email_otp', 0)),
  CHECK (COALESCE(json_extract(record_json, '$.action') = action, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.issuedAtMs') = issued_at_ms, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.expiresAtMs') = expires_at_ms, 0))
);

CREATE TABLE IF NOT EXISTS "email_otp_rate_limits" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  rate_key TEXT NOT NULL,
  consumed_count INTEGER NOT NULL,
  reset_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, rate_key),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(rate_key) > 0),
  CHECK (consumed_count > 0),
  CHECK (reset_at_ms > 0),
  CHECK (updated_at_ms > 0),
  CHECK (reset_at_ms > updated_at_ms)
);

CREATE TABLE IF NOT EXISTS "email_otp_unlock_challenges" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  record_org_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, challenge_id),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(challenge_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(user_id) > 0),
  CHECK (record_org_id = '' OR length(record_org_id) > 0),
  CHECK (json_valid(record_json)),
  CHECK (created_at_ms > 0),
  CHECK (expires_at_ms > created_at_ms),
  CHECK (
    COALESCE(json_extract(record_json, '$.version') = 'email_otp_unlock_challenge_v1', 0)
  ),
  CHECK (COALESCE(json_extract(record_json, '$.challengeId') = challenge_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.walletId') = wallet_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.userId') = user_id, 0)),
  CHECK (record_org_id = '' OR COALESCE(json_extract(record_json, '$.orgId') = record_org_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.createdAtMs') = created_at_ms, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.expiresAtMs') = expires_at_ms, 0))
);

CREATE TABLE IF NOT EXISTS "identity_links" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, subject),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(subject) > 0),
  CHECK (length(user_id) > 0),
  CHECK (json_valid(record_json)),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms >= created_at_ms),
  CHECK (COALESCE(json_extract(record_json, '$.version') = 'identity_subject_v1', 0)),
  CHECK (COALESCE(json_extract(record_json, '$.subject') = subject, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.userId') = user_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.createdAtMs') = created_at_ms, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.updatedAtMs') = updated_at_ms, 0))
);

CREATE TABLE IF NOT EXISTS lane_cas_guard (
  guard_id INTEGER PRIMARY KEY CHECK (guard_id = 1)
);

CREATE TABLE IF NOT EXISTS lane_enrollments (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  manifest_digest_b64u TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  lifecycle_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  command_digest_b64u TEXT NOT NULL,
  revocation_fence_command_digest_b64u TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, enrollment_id),
  UNIQUE (namespace, org_id, project_id, env_id, manifest_digest_b64u),
  CHECK (length(enrollment_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(manifest_digest_b64u) > 0),
  CHECK (json_valid(manifest_json)),
  CHECK (json_valid(lifecycle_json)),
  CHECK (version > 0),
  CHECK (created_at_ms >= 0 AND updated_at_ms >= created_at_ms)
);

CREATE TABLE IF NOT EXISTS lane_protocol_operations (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  wallet_key_id TEXT NOT NULL,
  source_lane_id TEXT NOT NULL,
  source_lane_share_epoch TEXT NOT NULL,
  source_revocation_epoch INTEGER NOT NULL,
  target_lane_id TEXT NOT NULL,
  target_lane_share_epoch TEXT NOT NULL,
  target_material_activation_id TEXT NOT NULL,
  key_family TEXT NOT NULL,
  job_json TEXT NOT NULL,
  lifecycle_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  command_digest_b64u TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, operation_id),
  UNIQUE (namespace, org_id, project_id, env_id, target_material_activation_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, enrollment_id)
    REFERENCES lane_enrollments(namespace, org_id, project_id, env_id, enrollment_id),
  CHECK (source_revocation_epoch >= 0),
  CHECK (key_family IN ('ed25519', 'ecdsa_secp256k1')),
  CHECK (json_valid(job_json)),
  CHECK (json_valid(lifecycle_json)),
  CHECK (version > 0),
  CHECK (created_at_ms >= 0 AND updated_at_ms >= created_at_ms)
);

CREATE TABLE IF NOT EXISTS lane_effect_journal (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  wallet_key_id TEXT NOT NULL,
  lane_id TEXT NOT NULL,
  lane_share_epoch TEXT NOT NULL,
  effect_kind TEXT NOT NULL,
  request_digest_b64u TEXT NOT NULL,
  status TEXT NOT NULL,
  response_digest_b64u TEXT,
  recorded_at_ms INTEGER NOT NULL,
  confirmed_at_ms INTEGER,
  version INTEGER NOT NULL,
  command_digest_b64u TEXT NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, effect_id),
  UNIQUE (namespace, org_id, project_id, env_id, operation_id, effect_kind),
  FOREIGN KEY (namespace, org_id, project_id, env_id, enrollment_id)
    REFERENCES lane_enrollments(namespace, org_id, project_id, env_id, enrollment_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, operation_id)
    REFERENCES lane_protocol_operations(namespace, org_id, project_id, env_id, operation_id),
  CHECK (effect_kind IN ('activate_server_material', 'retire_server_material', 'invalidate_holder_material')),
  CHECK (status IN ('recorded', 'confirmed')),
  CHECK (
    (status = 'recorded' AND response_digest_b64u IS NULL AND confirmed_at_ms IS NULL)
    OR (status = 'confirmed' AND response_digest_b64u IS NOT NULL AND confirmed_at_ms IS NOT NULL AND confirmed_at_ms >= recorded_at_ms)
  ),
  CHECK (version > 0),
  CHECK (recorded_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS lane_locks (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  lock_key TEXT NOT NULL,
  lock_kind TEXT NOT NULL,
  enrollment_id TEXT,
  wallet_key_id TEXT,
  lane_id TEXT,
  lock_id TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  acquired_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, lock_key),
  CHECK (lock_kind IN ('wallet_key', 'enrollment')),
  CHECK (length(lock_id) > 0),
  CHECK (expires_at_ms > acquired_at_ms),
  CHECK ((lock_kind = 'wallet_key' AND wallet_key_id IS NOT NULL AND enrollment_id IS NULL AND lane_id IS NULL) OR
         (lock_kind = 'enrollment' AND enrollment_id IS NOT NULL AND wallet_key_id IS NULL AND lane_id IS NULL))
);

CREATE TABLE IF NOT EXISTS lane_product_epochs (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  wallet_key_id TEXT NOT NULL,
  lane_id TEXT NOT NULL,
  lane_share_epoch TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  target_material_activation_id TEXT NOT NULL,
  material_activation_json TEXT NOT NULL,
  holder_participant_json TEXT NOT NULL,
  signing_worker_participant_json TEXT NOT NULL,
  participant_set_binding_digest_b64u TEXT NOT NULL,
  revocation_epoch INTEGER NOT NULL,
  lane_kind TEXT NOT NULL,
  key_family TEXT NOT NULL,
  public_identity_digest_b64u TEXT NOT NULL,
  state TEXT NOT NULL,
  product_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  command_digest_b64u TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_key_id, lane_id, lane_share_epoch),
  UNIQUE (namespace, org_id, project_id, env_id, target_material_activation_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, enrollment_id)
    REFERENCES lane_enrollments(namespace, org_id, project_id, env_id, enrollment_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, operation_id)
    REFERENCES lane_protocol_operations(namespace, org_id, project_id, env_id, operation_id),
  CHECK (json_valid(material_activation_json)),
  CHECK (json_valid(holder_participant_json)),
  CHECK (json_valid(signing_worker_participant_json)),
  CHECK (length(participant_set_binding_digest_b64u) > 0),
  CHECK (revocation_epoch >= 0),
  CHECK (json_valid(product_json)),
  CHECK (state IN ('pending_visibility', 'active', 'retired', 'revocation_pending', 'revoked')),
  CHECK (lane_kind IN ('owner_passkey', 'owner_email_otp', 'linked_device', 'delegated_execution', 'recovery', 'break_glass')),
  CHECK (length(command_digest_b64u) > 0),
  CHECK (version > 0),
  CHECK (key_family IN ('ed25519', 'ecdsa_secp256k1')),
  CHECK (created_at_ms >= 0 AND updated_at_ms >= created_at_ms)
);

CREATE TABLE IF NOT EXISTS lane_receipts (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  operation_id TEXT,
  receipt_kind TEXT NOT NULL,
  receipt_digest_b64u TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, receipt_id),
  UNIQUE (namespace, org_id, project_id, env_id, operation_id, receipt_kind),
  FOREIGN KEY (namespace, org_id, project_id, env_id, enrollment_id)
    REFERENCES lane_enrollments(namespace, org_id, project_id, env_id, enrollment_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, operation_id)
    REFERENCES lane_protocol_operations(namespace, org_id, project_id, env_id, operation_id),
  CHECK (json_valid(receipt_json)),
  CHECK (created_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS linked_device_request_proof_nonces (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  link_session_id TEXT NOT NULL,
  request_nonce_b64u TEXT NOT NULL,
  proof_digest_b64u TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER NOT NULL,
  PRIMARY KEY (
    namespace,
    org_id,
    project_id,
    env_id,
    link_session_id,
    request_nonce_b64u
  ),
  CHECK (length(link_session_id) > 0),
  CHECK (length(request_nonce_b64u) > 0),
  CHECK (length(proof_digest_b64u) > 0),
  CHECK (issued_at_ms > 0),
  CHECK (expires_at_ms > issued_at_ms),
  CHECK (consumed_at_ms >= issued_at_ms),
  CHECK (consumed_at_ms < expires_at_ms)
);

CREATE TABLE IF NOT EXISTS "linked_device_sessions" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  link_session_id TEXT NOT NULL,
  link_public_key_b64u TEXT NOT NULL,
  device_public_key_b64u TEXT NOT NULL,
  state TEXT NOT NULL,
  record_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  claim_expires_at_ms INTEGER,
  claim_digest_b64u TEXT,
  approval_digest_b64u TEXT,
  authority_id TEXT,
  package_set_digest_b64u TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, link_session_id),
  CHECK (length(link_session_id) > 0),
  CHECK (length(link_public_key_b64u) > 0),
  CHECK (length(device_public_key_b64u) > 0),
  CHECK (
    state IN (
      'displaying_qr',
      'claimed',
      'awaiting_target_factor',
      'awaiting_source_contribution',
      'provisioning',
      'authority_pending_local_install',
      'active',
      'failed_before_commit',
      'cancelled',
      'expired'
    )
  ),
  CHECK (json_valid(record_json)),
  CHECK (json_extract(record_json, '$.state.state') = state),
  CHECK (revision > 0),
  CHECK (expires_at_ms > 0),
  CHECK (claim_expires_at_ms IS NULL OR claim_expires_at_ms > 0),
  CHECK (claim_digest_b64u IS NULL OR length(claim_digest_b64u) > 0),
  CHECK (approval_digest_b64u IS NULL OR length(approval_digest_b64u) > 0),
  CHECK (
    (
      state IN ('authority_pending_local_install', 'active')
      AND authority_id IS NOT NULL
      AND length(authority_id) > 0
      AND package_set_digest_b64u IS NOT NULL
      AND length(package_set_digest_b64u) > 0
      AND json_extract(record_json, '$.authorityId') = authority_id
      AND json_extract(record_json, '$.packageSetDigestB64u') = package_set_digest_b64u
    )
    OR
    (
      state NOT IN ('authority_pending_local_install', 'active')
      AND authority_id IS NULL
      AND package_set_digest_b64u IS NULL
      AND json_extract(record_json, '$.authorityId') IS NULL
      AND json_extract(record_json, '$.packageSetDigestB64u') IS NULL
    )
  ),
  CHECK (created_at_ms > 0 AND updated_at_ms >= created_at_ms)
);

CREATE TABLE IF NOT EXISTS linked_device_target_commit_reservations (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  link_session_id TEXT NOT NULL,
  registration_digest_b64u TEXT NOT NULL,
  state TEXT NOT NULL,
  reserved_at_ms INTEGER NOT NULL,
  committed_at_ms INTEGER,
  key_manifest_digest_b64u TEXT,
  PRIMARY KEY (namespace, org_id, project_id, env_id, link_session_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, link_session_id)
    REFERENCES linked_device_sessions(namespace, org_id, project_id, env_id, link_session_id),
  CHECK (length(registration_digest_b64u) > 0),
  CHECK (state IN ('reserved', 'committed')),
  CHECK (
    (state = 'reserved' AND committed_at_ms IS NULL AND key_manifest_digest_b64u IS NULL)
    OR
    (state = 'committed' AND committed_at_ms IS NOT NULL AND length(key_manifest_digest_b64u) > 0)
  )
);

CREATE TABLE IF NOT EXISTS registration_ceremony_cas_guard (
  guard_id INTEGER PRIMARY KEY CHECK (guard_id = 1)
);

CREATE TABLE IF NOT EXISTS registration_ceremony_records (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  record_scope TEXT NOT NULL,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  record_json TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at_ms INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (namespace, org_id, project_id, env_id, record_scope, record_id),
  CHECK (version > 0),
  CHECK (expires_at_ms > 0),
  CHECK (json_valid(record_json))
);

CREATE TABLE IF NOT EXISTS router_ab_yao_versioned_json_cas_guard (
  guard_id INTEGER PRIMARY KEY CHECK (guard_id = 1)
);

CREATE TABLE IF NOT EXISTS router_ab_yao_versioned_json_records (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at_ms INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (namespace, org_id, project_id, env_id, record_key),
  CHECK (version > 0),
  CHECK (json_valid(record_json))
);

CREATE TABLE IF NOT EXISTS vault_proxy_secrets (
  namespace TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  sealed_secret_b64u TEXT NOT NULL,
  nonce_b64u TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, tenant_id, vault_id, item_id),
  CHECK (length(destination) > 0),
  CHECK (length(sealed_secret_b64u) > 0),
  CHECK (length(nonce_b64u) > 0),
  CHECK (created_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS wallet_ecdsa_pending_session_activations (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  lifecycle_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (
    namespace,
    org_id,
    project_id,
    env_id,
    wallet_id,
    lifecycle_id,
    request_id
  ),
  CHECK (json_valid(record_json)),
  CHECK (expires_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS "wallet_signers" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  signer_family TEXT NOT NULL,
  signer_id TEXT NOT NULL,
  chain_target_key TEXT,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (
    namespace,
    org_id,
    project_id,
    env_id,
    wallet_id,
    signer_family,
    signer_id
  ),
  CHECK (length(wallet_id) > 0),
  CHECK (signer_family IN ('ed25519', 'ecdsa')),
  CHECK (length(signer_id) > 0),
  CHECK (json_valid(record_json)),
  CHECK (created_at_ms >= 0),
  CHECK (updated_at_ms >= created_at_ms),
  CHECK (COALESCE(json_extract(record_json, '$.walletId') = wallet_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.signerId') = signer_id, 0)),
  CHECK (
    (
      signer_family = 'ed25519'
      AND chain_target_key IS NULL
      AND substr(signer_id, 1, 8) = 'ed25519:'
      AND COALESCE(
        json_extract(record_json, '$.version') = 'wallet_signer_ed25519_v1',
        0
      )
    )
    OR
    (
      signer_family = 'ecdsa'
      AND chain_target_key IS NOT NULL
      AND length(chain_target_key) > 0
      AND signer_id = 'ecdsa:' || chain_target_key
      AND COALESCE(
        json_extract(record_json, '$.version') = 'wallet_signer_ecdsa_v1',
        0
      )
      AND COALESCE(json_extract(record_json, '$.chainTargetKey') = chain_target_key, 0)
    )
  )
);

CREATE TABLE IF NOT EXISTS "wallets" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id),
  CHECK (length(wallet_id) > 0),
  CHECK (json_valid(record_json)),
  CHECK (created_at_ms >= 0),
  CHECK (updated_at_ms >= created_at_ms),
  CHECK (COALESCE(json_extract(record_json, '$.version') = 'wallet_v1', 0)),
  CHECK (COALESCE(json_extract(record_json, '$.walletId') = wallet_id, 0))
);

CREATE TABLE IF NOT EXISTS webauthn_authenticators (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  credential_id_b64u TEXT NOT NULL,
  credential_public_key_b64u TEXT NOT NULL,
  counter INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL, device_info_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (namespace, org_id, project_id, env_id, user_id, credential_id_b64u),
  CHECK (length(user_id) > 0),
  CHECK (length(credential_id_b64u) > 0),
  CHECK (length(credential_public_key_b64u) > 0),
  CHECK (counter >= 0),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS "webauthn_credential_bindings" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  credential_id_b64u TEXT NOT NULL,
  user_id TEXT NOT NULL,
  signer_slot INTEGER,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, rp_id, credential_id_b64u),
  CHECK (length(rp_id) > 0),
  CHECK (length(credential_id_b64u) > 0),
  CHECK (length(user_id) > 0),
  CHECK (signer_slot IS NULL OR signer_slot >= 1),
  CHECK (json_valid(record_json)),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS "authorized_operation_audit_events" (
  namespace TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  audit_event_id TEXT NOT NULL,
  authorized_operation_id TEXT NOT NULL,
  operation_fingerprint_digest TEXT NOT NULL,
  authorization_source_kind TEXT NOT NULL,
  authorization_id TEXT,
  evidence_set_digest TEXT,
  quota_id TEXT,
  material_activation_id TEXT,
  result_kind TEXT NOT NULL,
  claimed_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER, authorization_grant_kind TEXT, material_activation_capability TEXT, material_activation_owner TEXT, material_activation_key_binding TEXT, material_activation_lifecycle_binding TEXT, material_activation_signing_worker TEXT, owner_scope_org_id TEXT, owner_scope_project_id TEXT, owner_scope_env_id TEXT,
  PRIMARY KEY (namespace, tenant_id, audit_event_id),
  UNIQUE (namespace, tenant_id, authorized_operation_id),
  CHECK (authorization_source_kind IN ('authorization_grant', 'verified_step_up')),
  CHECK (
    (authorization_source_kind = 'authorization_grant'
      AND authorization_id IS NOT NULL
      AND evidence_set_digest IS NULL)
    OR (authorization_source_kind = 'verified_step_up'
      AND authorization_id IS NULL
      AND evidence_set_digest IS NOT NULL)
  ),
  CHECK (result_kind IN ('pending', 'succeeded', 'failed_before_side_effect', 'failed_after_side_effect')),
  CHECK (
    (result_kind = 'pending' AND completed_at_ms IS NULL)
    OR (result_kind != 'pending' AND completed_at_ms IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS "authorized_operations" (
  namespace TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  authorized_operation_id TEXT NOT NULL,
  audit_event_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  capability_kind TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  operation_fingerprint_digest TEXT NOT NULL,
  lane_digest TEXT NOT NULL,
  intent_digest TEXT NOT NULL,
  display_digest TEXT NOT NULL,
  authorization_source_kind TEXT NOT NULL,
  authorization_id TEXT,
  evidence_set_digest TEXT,
  quota_id TEXT,
  quota_kind TEXT NOT NULL,
  lifecycle_kind TEXT NOT NULL,
  result_kind TEXT NOT NULL,
  result_digest TEXT,
  result_status INTEGER,
  result_content_type TEXT,
  result_body_text TEXT,
  claimed_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  material_activation_id TEXT, authorization_grant_kind TEXT, material_activation_capability TEXT, material_activation_owner TEXT, material_activation_key_binding TEXT, material_activation_lifecycle_binding TEXT, material_activation_signing_worker TEXT, owner_scope_org_id TEXT, owner_scope_project_id TEXT, owner_scope_env_id TEXT, ownership_generation INTEGER
  CHECK(ownership_generation > 0 AND ownership_generation <= 9007199254740991),
  PRIMARY KEY (namespace, tenant_id, authorized_operation_id),
  UNIQUE (namespace, tenant_id, operation_fingerprint_digest),
  CHECK (authorization_source_kind IN ('authorization_grant', 'verified_step_up')),
  CHECK (
    (authorization_source_kind = 'authorization_grant'
      AND authorization_id IS NOT NULL
      AND evidence_set_digest IS NULL)
    OR (authorization_source_kind = 'verified_step_up'
      AND authorization_id IS NULL
      AND evidence_set_digest IS NOT NULL)
  ),
  CHECK (quota_kind IN ('consume_reusable_wallet_session', 'quota_neutral')),
  CHECK (
    (quota_kind = 'consume_reusable_wallet_session'
      AND authorization_source_kind = 'authorization_grant'
      AND operation_kind NOT IN ('near.export_key', 'evm.export_key')
      AND capability_kind != 'vault_access')
    OR (quota_kind = 'quota_neutral'
      AND (
        operation_kind IN ('near.export_key', 'evm.export_key')
        OR capability_kind = 'vault_access'
        OR authorization_source_kind = 'verified_step_up'
      ))
  ),
  CHECK (
    (quota_kind = 'consume_reusable_wallet_session' AND quota_id IS NOT NULL)
    OR (quota_kind = 'quota_neutral' AND quota_id IS NULL)
  ),
  CHECK (lifecycle_kind IN ('claimed', 'completed')),
  CHECK (
    (lifecycle_kind = 'claimed'
      AND result_kind = 'pending'
      AND result_digest IS NULL
      AND result_status IS NULL
      AND result_content_type IS NULL
      AND result_body_text IS NULL
      AND completed_at_ms IS NULL)
    OR (lifecycle_kind = 'completed'
      AND result_kind IN ('succeeded', 'failed_before_side_effect', 'failed_after_side_effect')
      AND result_digest IS NOT NULL
      AND result_status BETWEEN 100 AND 599
      AND result_content_type IS NOT NULL
      AND trim(result_content_type) = result_content_type
      AND length(result_content_type) BETWEEN 1 AND 255
      AND result_body_text IS NOT NULL
      AND length(CAST(result_body_text AS BLOB)) <= 65536
      AND completed_at_ms IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  challenge_kind TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, challenge_id),
  CHECK (length(challenge_id) > 0),
  CHECK (challenge_kind IN ('login', 'sync', 'recovery_registration')),
  CHECK (json_valid(record_json)),
  CHECK (created_at_ms > 0),
  CHECK (expires_at_ms > created_at_ms)
);

CREATE TABLE IF NOT EXISTS verified_owner_proof_consumptions (
  namespace TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  proof_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  method TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  authority_digest TEXT NOT NULL,
  replay_identity TEXT NOT NULL,
  consumption_scope_id TEXT NOT NULL,
  consumed_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, tenant_id, proof_id),
  UNIQUE (namespace, tenant_id, replay_identity),
  CHECK (purpose IN ('wallet_session', 'operation')),
  CHECK (method IN ('passkey', 'email_otp')),
  CHECK (consumed_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS email_otp_registration_attempts (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  state TEXT NOT NULL,
  owner_proof_binding_digest TEXT NOT NULL,
  runtime_org_id TEXT NOT NULL,
  runtime_policy_key TEXT NOT NULL,
  offer_wallet_ids_json TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL, selection_digest TEXT CHECK (selection_digest IS NULL OR length(selection_digest) > 0),
  PRIMARY KEY (namespace, org_id, project_id, env_id, attempt_id),
  CHECK (length(attempt_id) > 0),
  CHECK (length(provider_subject) > 0),
  CHECK (length(email) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (state IN ('started', 'key_finalized', 'active', 'abandoned', 'failed', 'expired')),
  CHECK (length(owner_proof_binding_digest) > 0),
  CHECK (json_valid(offer_wallet_ids_json)),
  CHECK (json_valid(record_json)),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms >= created_at_ms),
  CHECK (expires_at_ms > created_at_ms),
  CHECK (COALESCE(json_extract(record_json, '$.version') = 'google_email_otp_registration_attempt_v1', 0)),
  CHECK (COALESCE(json_extract(record_json, '$.attemptId') = attempt_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.providerSubject') = provider_subject, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.email') = email, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.walletId') = wallet_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.state') = state, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.ownerProofBindingDigest') = owner_proof_binding_digest, 0)),
  CHECK (runtime_org_id = '' OR COALESCE(json_extract(record_json, '$.runtimePolicyScope.orgId') = runtime_org_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.createdAtMs') = created_at_ms, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.updatedAtMs') = updated_at_ms, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.expiresAtMs') = expires_at_ms, 0))
);

CREATE TABLE IF NOT EXISTS "linked_device_ed25519_export_root_transfers" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  link_session_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  state TEXT NOT NULL,
  transfer_alg TEXT NOT NULL,
  recipient_public_key_b64u TEXT NOT NULL,
  recipient_json TEXT NOT NULL,
  package_json TEXT,
  ephemeral_public_key_b64u TEXT,
  ciphertext_digest_b64u TEXT,
  registered_at_ms INTEGER NOT NULL,
  sealed_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, project_id, env_id, link_session_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, link_session_id)
    REFERENCES linked_device_sessions(namespace, org_id, project_id, env_id, link_session_id),
  CHECK (length(wallet_id) > 0),
  CHECK (length(enrollment_id) > 0),
  CHECK (length(device_id) > 0),
  CHECK (state IN ('recipient_registered', 'sealed')),
  CHECK (transfer_alg = 'x25519-hkdf-sha256-chacha20poly1305-v1'),
  CHECK (length(recipient_public_key_b64u) > 0),
  CHECK (json_valid(recipient_json)),
  CHECK (registered_at_ms > 0),
  CHECK (
    COALESCE(json_extract(recipient_json, '$.recipientPublicKeyB64u')
      = recipient_public_key_b64u, 0)
  ),
  CHECK (
    (state = 'recipient_registered'
      AND package_json IS NULL
      AND ephemeral_public_key_b64u IS NULL
      AND ciphertext_digest_b64u IS NULL
      AND sealed_at_ms IS NULL)
    OR
    (state = 'sealed'
      AND json_valid(package_json)
      AND length(ephemeral_public_key_b64u) > 0
      AND length(ciphertext_digest_b64u) > 0
      AND sealed_at_ms >= registered_at_ms
      -- A package that names another recipient key would be addressed to a
      -- device this row never registered.
      AND COALESCE(json_extract(package_json, '$.recipientPublicKeyB64u')
        = recipient_public_key_b64u, 0)
      -- Republishing the recipient key as the ephemeral key is never a valid
      -- seal; it means no ephemeral key was generated.
      AND ephemeral_public_key_b64u <> recipient_public_key_b64u)
  )
);

CREATE TABLE IF NOT EXISTS linked_device_session_cas_guard (
  guard_id INTEGER PRIMARY KEY CHECK (guard_id = 1)
);

CREATE TABLE IF NOT EXISTS "linked_device_target_credentials" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  link_session_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  state TEXT NOT NULL,
  target_factor TEXT NOT NULL,
  preparation_digest_b64u TEXT NOT NULL,
  preparation_json TEXT NOT NULL,
  registration_json TEXT,
  credential_id_b64u TEXT,
  credential_public_key_b64u TEXT,
  credential_counter INTEGER,
  email_otp_grant_id TEXT,
  key_manifest_digest_b64u TEXT,
  prepared_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  registered_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, project_id, env_id, link_session_id),
  FOREIGN KEY (namespace, org_id, project_id, env_id, link_session_id)
    REFERENCES linked_device_sessions(namespace, org_id, project_id, env_id, link_session_id),
  CHECK (length(wallet_id) > 0),
  CHECK (length(enrollment_id) > 0),
  CHECK (length(device_id) > 0),
  CHECK (state IN ('prepared', 'registered')),
  CHECK (target_factor IN ('passkey_prf', 'email_otp')),
  CHECK (length(preparation_digest_b64u) > 0),
  CHECK (json_valid(preparation_json)),
  CHECK (COALESCE(json_extract(preparation_json, '$.targetFactor.kind') = target_factor, 0)),
  CHECK (expires_at_ms > prepared_at_ms),
  CHECK (
    (state = 'prepared'
      AND registration_json IS NULL
      AND credential_id_b64u IS NULL
      AND credential_public_key_b64u IS NULL
      AND credential_counter IS NULL
      AND email_otp_grant_id IS NULL
      AND key_manifest_digest_b64u IS NULL
      AND registered_at_ms IS NULL)
    OR
    (state = 'registered'
      AND target_factor = 'passkey_prf'
      AND json_valid(registration_json)
      AND COALESCE(json_extract(registration_json, '$.targetFactor.kind') = 'passkey_prf', 0)
      AND length(credential_id_b64u) > 0
      AND length(credential_public_key_b64u) > 0
      AND credential_counter >= 0
      AND email_otp_grant_id IS NULL
      AND length(key_manifest_digest_b64u) > 0
      AND registered_at_ms > 0)
    OR
    (state = 'registered'
      AND target_factor = 'email_otp'
      AND json_valid(registration_json)
      AND COALESCE(json_extract(registration_json, '$.targetFactor.kind') = 'email_otp', 0)
      AND credential_id_b64u IS NOT NULL
      AND length(credential_id_b64u) > 0
      AND credential_public_key_b64u IS NULL
      AND credential_counter IS NULL
      AND email_otp_grant_id IS NOT NULL
      AND length(email_otp_grant_id) > 0
      AND length(key_manifest_digest_b64u) > 0
      AND registered_at_ms > 0)
  )
);

CREATE TABLE IF NOT EXISTS wallet_recovery_code_locators (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  locator_b64u TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  recovery_key_id TEXT NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, locator_b64u),
  UNIQUE (namespace, org_id, project_id, env_id, wallet_id, recovery_key_id),
  CHECK (length(locator_b64u) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(recovery_key_id) > 0)
);

CREATE TABLE IF NOT EXISTS wallet_authority_cas_guard (
  guard_id INTEGER PRIMARY KEY CHECK (guard_id = 1)
);

CREATE TABLE IF NOT EXISTS linked_device_authority_installations (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  link_session_id TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  auth_method_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  package_set_digest_b64u TEXT NOT NULL,
  target_factor_verification_digest_b64u TEXT NOT NULL,
  target_factor_verified_at_ms INTEGER NOT NULL,
  source_manifest_digest_b64u TEXT NOT NULL,
  packages_json TEXT NOT NULL,
  server_reservation_ids_json TEXT NOT NULL,
  installed_record_set_digest_b64u TEXT,
  activated_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL, delivery_recipient_public_key_b64u TEXT
  CHECK (
    delivery_recipient_public_key_b64u IS NULL
    OR length(delivery_recipient_public_key_b64u) > 0
  ),
  PRIMARY KEY (namespace, org_id, project_id, env_id, link_session_id),
  UNIQUE (namespace, org_id, project_id, env_id, authority_id),
  CHECK (json_valid(packages_json)),
  CHECK (json_valid(server_reservation_ids_json)),
  CHECK (target_factor_verified_at_ms >= 0),
  CHECK (created_at_ms >= 0),
  CHECK (updated_at_ms >= created_at_ms)
);

CREATE TABLE IF NOT EXISTS linked_device_session_transcripts (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  link_session_id TEXT NOT NULL,
  transcript_kind TEXT NOT NULL,
  digest_b64u TEXT NOT NULL,
  transcript_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (
    namespace,
    org_id,
    project_id,
    env_id,
    link_session_id,
    transcript_kind
  ),
  FOREIGN KEY (namespace, org_id, project_id, env_id, link_session_id)
    REFERENCES linked_device_sessions(namespace, org_id, project_id, env_id, link_session_id),
  CHECK (transcript_kind IN ('claim', 'approval', 'source_contribution')),
  CHECK (length(digest_b64u) > 0),
  CHECK (json_valid(transcript_json)),
  CHECK (created_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS "email_otp_wallet_enrollments" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  record_org_id TEXT NOT NULL,
  verified_email TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(provider_user_id) > 0),
  CHECK (length(record_org_id) > 0),
  CHECK (length(verified_email) > 0),
  CHECK (json_valid(record_json)),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms >= created_at_ms),
  CHECK (
    COALESCE(json_extract(record_json, '$.version') = 'email_otp_wallet_enrollment_v1', 0)
  ),
  CHECK (COALESCE(json_extract(record_json, '$.walletId') = wallet_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.providerUserId') = provider_user_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.orgId') = record_org_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.verifiedEmail') = verified_email, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.createdAtMs') = created_at_ms, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.updatedAtMs') = updated_at_ms, 0))
);

CREATE TABLE IF NOT EXISTS "wallet_authorities" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  provenance_kind TEXT NOT NULL,
  enrollment_id TEXT,
  source_authority_id TEXT,
  link_session_id TEXT,
  recovery_operation_id TEXT,
  continuity_authority_id TEXT,
  lifecycle_state TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  signer_activations_json TEXT NOT NULL,
  local_install_package_set_digest_b64u TEXT,
  signer_activation_set_digest_b64u TEXT NOT NULL,
  authority_digest_b64u TEXT NOT NULL,
  revocation_epoch INTEGER NOT NULL,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  activated_at_ms INTEGER,
  revoked_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, project_id, env_id, authority_id),
  CHECK (length(authority_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(device_id) > 0),
  CHECK (provenance_kind IN ('wallet_registration', 'device_link', 'wallet_recovery')),
  CHECK (lifecycle_state IN ('pending_local_install', 'active', 'revoked')),
  CHECK (length(permissions_json) > 0 AND json_valid(permissions_json)),
  CHECK (length(signer_activations_json) > 0 AND json_valid(signer_activations_json)),
  CHECK (length(record_json) > 0 AND json_valid(record_json)),
  CHECK (length(signer_activation_set_digest_b64u) > 0),
  CHECK (length(authority_digest_b64u) > 0),
  CHECK (revocation_epoch >= 0),
  CHECK (created_at_ms >= 0),
  CHECK (updated_at_ms >= created_at_ms),
  CHECK (
    (provenance_kind = 'wallet_registration'
      AND enrollment_id IS NULL
      AND source_authority_id IS NULL
      AND link_session_id IS NULL
      AND recovery_operation_id IS NULL
      AND continuity_authority_id IS NULL)
    OR
    (provenance_kind = 'device_link'
      AND enrollment_id IS NOT NULL AND length(enrollment_id) > 0
      AND source_authority_id IS NOT NULL AND length(source_authority_id) > 0
      AND link_session_id IS NOT NULL AND length(link_session_id) > 0
      AND recovery_operation_id IS NULL
      AND continuity_authority_id IS NULL)
    OR
    (provenance_kind = 'wallet_recovery'
      AND enrollment_id IS NULL
      AND source_authority_id IS NULL
      AND link_session_id IS NULL
      AND recovery_operation_id IS NOT NULL
      AND length(recovery_operation_id) > 0
      AND continuity_authority_id IS NOT NULL
      AND length(continuity_authority_id) > 0)
  ),
  CHECK (
    (lifecycle_state = 'pending_local_install'
      AND local_install_package_set_digest_b64u IS NOT NULL
      AND length(local_install_package_set_digest_b64u) > 0
      AND activated_at_ms IS NULL
      AND revoked_at_ms IS NULL
      AND revocation_epoch = 0)
    OR
    (lifecycle_state = 'active'
      AND local_install_package_set_digest_b64u IS NULL
      AND activated_at_ms IS NOT NULL
      AND revoked_at_ms IS NULL)
    OR
    (lifecycle_state = 'revoked'
      AND local_install_package_set_digest_b64u IS NULL
      AND activated_at_ms IS NOT NULL
      AND revoked_at_ms IS NOT NULL
      AND revocation_epoch >= 1)
  ),
  CHECK (json_extract(record_json, '$.authorityId') = authority_id),
  CHECK (json_extract(record_json, '$.walletId') = wallet_id),
  CHECK (json_extract(record_json, '$.state') = lifecycle_state),
  CHECK (json_extract(record_json, '$.revocationEpoch') = revocation_epoch),
  CHECK (json_extract(record_json, '$.authorityDigestB64u') = authority_digest_b64u),
  CHECK (
    json_extract(record_json, '$.signerActivationSetDigestB64u')
      = signer_activation_set_digest_b64u
  )
);

CREATE TABLE IF NOT EXISTS "wallet_auth_methods" (
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

CREATE TABLE IF NOT EXISTS "wallet_session_authorizations_v2" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  mint_id TEXT NOT NULL,
  wallet_session_id TEXT NOT NULL,
  quota_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  wallet_auth_method_id TEXT NOT NULL,
  authority_digest_b64u TEXT NOT NULL,
  authority_revocation_epoch INTEGER NOT NULL,
  capability_subjects_json TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  retired_at_ms INTEGER,
  record_json TEXT NOT NULL,
  operation_credential_hash TEXT,
  PRIMARY KEY (namespace, org_id, project_id, env_id, tenant_id, authorization_id),
  UNIQUE (namespace, org_id, project_id, env_id, tenant_id, mint_id),
  UNIQUE (namespace, org_id, project_id, env_id, tenant_id, wallet_session_id),
  UNIQUE (namespace, org_id, project_id, env_id, tenant_id, quota_id),
  FOREIGN KEY (
    namespace, org_id, project_id, env_id, authority_id, wallet_id
  ) REFERENCES wallet_authorities(
    namespace, org_id, project_id, env_id, authority_id, wallet_id
  ),
  FOREIGN KEY (
    namespace, org_id, project_id, env_id,
    wallet_auth_method_id, wallet_id, authority_id
  ) REFERENCES wallet_auth_methods(
    namespace, org_id, project_id, env_id,
    wallet_auth_method_id, wallet_id, wallet_authority_id
  ),
  FOREIGN KEY (namespace, tenant_id, quota_id)
    REFERENCES authorization_wallet_session_quotas(namespace, tenant_id, quota_id),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(tenant_id) > 0),
  CHECK (length(authorization_id) > 0),
  CHECK (length(mint_id) > 0),
  CHECK (length(wallet_session_id) > 0),
  CHECK (length(quota_id) > 0),
  CHECK (length(principal_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(authority_id) > 0),
  CHECK (length(wallet_auth_method_id) > 0),
  CHECK (authorization_id != wallet_session_id),
  CHECK (authorization_id != quota_id),
  CHECK (wallet_session_id != quota_id),
  CHECK (length(authority_digest_b64u) > 0),
  CHECK (authority_revocation_epoch >= 0),
  CHECK (
    length(capability_subjects_json) > 0
    AND json_valid(capability_subjects_json)
    AND json_type(capability_subjects_json) = 'array'
    AND json_array_length(capability_subjects_json) > 0
  ),
  CHECK (issued_at_ms > 0),
  CHECK (expires_at_ms > issued_at_ms),
  CHECK (retired_at_ms IS NULL OR retired_at_ms >= issued_at_ms),
  CHECK (length(record_json) > 0 AND json_valid(record_json)),
  CHECK (operation_credential_hash IS NULL OR length(operation_credential_hash) > 0),
  CHECK (retired_at_ms IS NOT NULL OR operation_credential_hash IS NOT NULL),
  CHECK (COALESCE(json_extract(record_json, '$.kind') = 'wallet_session_authorization_v2', 0)),
  CHECK (COALESCE(json_extract(record_json, '$.tenantId') = tenant_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.principalId') = principal_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.walletId') = wallet_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.authorityId') = authority_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.walletAuthMethodId') = wallet_auth_method_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.authorityDigestB64u') = authority_digest_b64u, 0)),
  CHECK (
    COALESCE(
      json_extract(record_json, '$.authorityRevocationEpoch') = authority_revocation_epoch,
      0
    )
  ),
  CHECK (COALESCE(json_extract(record_json, '$.mintId') = mint_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.authorizationId') = authorization_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.walletSessionId') = wallet_session_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.quotaId') = quota_id, 0)),
  CHECK (
    json_type(record_json, '$.capabilitySubjects') = 'array'
    AND json_array_length(record_json, '$.capabilitySubjects') > 0
    AND json_extract(record_json, '$.capabilitySubjects') = json(capability_subjects_json)
  ),
  CHECK (COALESCE(json_extract(record_json, '$.createdAtMs') = issued_at_ms, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.expiresAtMs') = expires_at_ms, 0))
);

CREATE TABLE IF NOT EXISTS wallet_session_hosted_credentials_v2 (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  hosted_credential_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  wallet_session_id TEXT NOT NULL,
  quota_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  wallet_auth_method_id TEXT NOT NULL,
  credential_digest_b64u TEXT NOT NULL,
  app_origin TEXT NOT NULL,
  wallet_origin TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  lifecycle_kind TEXT NOT NULL,
  retired_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, project_id, env_id, tenant_id, hosted_credential_id),
  UNIQUE (namespace, org_id, project_id, env_id, tenant_id, credential_digest_b64u),
  FOREIGN KEY (
    namespace, org_id, project_id, env_id, tenant_id, authorization_id,
    wallet_session_id, quota_id, principal_id, wallet_id,
    authority_id, wallet_auth_method_id
  ) REFERENCES wallet_session_authorizations_v2(
    namespace, org_id, project_id, env_id, tenant_id, authorization_id,
    wallet_session_id, quota_id, principal_id, wallet_id,
    authority_id, wallet_auth_method_id
  ),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(tenant_id) > 0),
  CHECK (length(hosted_credential_id) > 0),
  CHECK (length(authorization_id) > 0),
  CHECK (length(wallet_session_id) > 0),
  CHECK (length(quota_id) > 0),
  CHECK (length(principal_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(authority_id) > 0),
  CHECK (length(wallet_auth_method_id) > 0),
  CHECK (length(credential_digest_b64u) > 0),
  CHECK (length(trim(app_origin)) > 0),
  CHECK (length(trim(wallet_origin)) > 0),
  CHECK (issued_at_ms > 0),
  CHECK (expires_at_ms > issued_at_ms),
  CHECK (lifecycle_kind IN ('active', 'retired')),
  CHECK (
    (lifecycle_kind = 'active' AND retired_at_ms IS NULL)
    OR (lifecycle_kind = 'retired' AND retired_at_ms IS NOT NULL AND retired_at_ms >= issued_at_ms)
  )
);

CREATE TABLE IF NOT EXISTS wallet_session_hosted_exchange_codes_v2 (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  exchange_code_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  wallet_session_id TEXT NOT NULL,
  quota_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  wallet_auth_method_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  nonce_digest TEXT NOT NULL,
  app_origin TEXT NOT NULL,
  wallet_origin TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  lifecycle_kind TEXT NOT NULL,
  hosted_credential_id TEXT,
  consumed_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, project_id, env_id, tenant_id, exchange_code_id),
  UNIQUE (namespace, org_id, project_id, env_id, tenant_id, code_hash),
  UNIQUE (namespace, org_id, project_id, env_id, tenant_id, nonce_digest),
  FOREIGN KEY (
    namespace, org_id, project_id, env_id, tenant_id, authorization_id,
    wallet_session_id, quota_id, principal_id, wallet_id,
    authority_id, wallet_auth_method_id
  ) REFERENCES wallet_session_authorizations_v2(
    namespace, org_id, project_id, env_id, tenant_id, authorization_id,
    wallet_session_id, quota_id, principal_id, wallet_id,
    authority_id, wallet_auth_method_id
  ),
  FOREIGN KEY (
    namespace, org_id, project_id, env_id, tenant_id, hosted_credential_id,
    authorization_id, wallet_session_id, quota_id, principal_id, wallet_id,
    authority_id, wallet_auth_method_id
  )
    REFERENCES wallet_session_hosted_credentials_v2(
      namespace, org_id, project_id, env_id, tenant_id, hosted_credential_id,
      authorization_id, wallet_session_id, quota_id, principal_id, wallet_id,
      authority_id, wallet_auth_method_id
    ),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(tenant_id) > 0),
  CHECK (length(exchange_code_id) > 0),
  CHECK (length(authorization_id) > 0),
  CHECK (length(wallet_session_id) > 0),
  CHECK (length(quota_id) > 0),
  CHECK (length(principal_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(authority_id) > 0),
  CHECK (length(wallet_auth_method_id) > 0),
  CHECK (length(code_hash) > 0),
  CHECK (length(nonce_digest) > 0),
  CHECK (length(trim(app_origin)) > 0),
  CHECK (length(trim(wallet_origin)) > 0),
  CHECK (issued_at_ms > 0),
  CHECK (expires_at_ms > issued_at_ms),
  CHECK (lifecycle_kind IN ('issued', 'consumed')),
  CHECK (
    (lifecycle_kind = 'issued' AND hosted_credential_id IS NULL AND consumed_at_ms IS NULL)
    OR (
      lifecycle_kind = 'consumed'
      AND hosted_credential_id IS NOT NULL
      AND consumed_at_ms IS NOT NULL
      AND consumed_at_ms >= issued_at_ms
      AND consumed_at_ms <= expires_at_ms
    )
  )
);

CREATE TABLE IF NOT EXISTS linked_device_authority_allocations (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  link_session_id TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, link_session_id),
  UNIQUE (namespace, org_id, project_id, env_id, authority_id),
  CHECK (created_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS "linked_device_wallet_session_credential_deliveries_v1" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  link_session_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  wallet_session_id TEXT NOT NULL,
  quota_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  wallet_auth_method_id TEXT NOT NULL,
  credential_digest_b64u TEXT NOT NULL,
  recipient_kind TEXT NOT NULL,
  recipient_public_key_b64u TEXT NOT NULL,
  recipient_binding_digest_b64u TEXT NOT NULL,
  envelope_alg TEXT NOT NULL,
  aad_digest_b64u TEXT NOT NULL,
  sealed_envelope_json TEXT,
  sealed_envelope_digest_b64u TEXT NOT NULL,
  installation_receipt_digest_b64u TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  lifecycle_kind TEXT NOT NULL,
  acknowledged_at_ms INTEGER,
  acknowledgement_receipt_json TEXT,
  cleanup_state TEXT NOT NULL,
  cleanup_receipt_json TEXT,
  cleanup_completed_at_ms INTEGER,
  acknowledgement_auth_binding_digest_b64u TEXT,
  acknowledgement_auth_package_set_digest_b64u TEXT,
  acknowledgement_auth_expires_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, project_id, env_id, link_session_id),
  UNIQUE (namespace, org_id, project_id, env_id, tenant_id, credential_digest_b64u),
  FOREIGN KEY (
    namespace, org_id, project_id, env_id, link_session_id,
    authority_id, wallet_id, wallet_auth_method_id
  )
    REFERENCES linked_device_authority_installations(
      namespace, org_id, project_id, env_id, link_session_id,
      authority_id, wallet_id, auth_method_id
    ),
  FOREIGN KEY (
    namespace, org_id, project_id, env_id, tenant_id, authorization_id,
    wallet_session_id, quota_id, principal_id, wallet_id,
    authority_id, wallet_auth_method_id
  )
    REFERENCES wallet_session_authorizations_v2(
      namespace, org_id, project_id, env_id, tenant_id, authorization_id,
      wallet_session_id, quota_id, principal_id, wallet_id,
      authority_id, wallet_auth_method_id
    ),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(link_session_id) > 0),
  CHECK (length(tenant_id) > 0),
  CHECK (length(authorization_id) > 0),
  CHECK (length(wallet_session_id) > 0),
  CHECK (length(quota_id) > 0),
  CHECK (length(principal_id) > 0),
  CHECK (length(authority_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(wallet_auth_method_id) > 0),
  CHECK (length(credential_digest_b64u) > 0),
  CHECK (recipient_kind = 'p256_ecdh'),
  CHECK (length(recipient_public_key_b64u) > 0),
  CHECK (length(recipient_binding_digest_b64u) > 0),
  CHECK (envelope_alg = 'p256-ecdh-aes256gcm-v1'),
  CHECK (length(aad_digest_b64u) > 0),
  CHECK (sealed_envelope_json IS NULL OR json_valid(sealed_envelope_json)),
  CHECK (length(sealed_envelope_digest_b64u) > 0),
  CHECK (length(installation_receipt_digest_b64u) > 0),
  CHECK (issued_at_ms > 0),
  CHECK (expires_at_ms > issued_at_ms),
  CHECK (lifecycle_kind IN ('issued', 'acknowledged', 'cleanup_complete')),
  CHECK (cleanup_state IN ('pending', 'allocation_removed', 'session_removed', 'complete')),
  CHECK (
    (
      lifecycle_kind = 'issued'
      AND sealed_envelope_json IS NOT NULL
      AND acknowledged_at_ms IS NULL
      AND acknowledgement_receipt_json IS NULL
      AND cleanup_state = 'pending'
      AND cleanup_receipt_json IS NULL
      AND cleanup_completed_at_ms IS NULL
    )
    OR (
      lifecycle_kind = 'acknowledged'
      AND sealed_envelope_json IS NULL
      AND acknowledged_at_ms IS NOT NULL
      AND acknowledged_at_ms >= issued_at_ms
      AND acknowledgement_receipt_json IS NOT NULL
      AND json_valid(acknowledgement_receipt_json)
      AND cleanup_state IN ('pending', 'allocation_removed', 'session_removed')
      AND cleanup_receipt_json IS NOT NULL
      AND json_valid(cleanup_receipt_json)
      AND cleanup_completed_at_ms IS NULL
    )
    OR (
      lifecycle_kind = 'cleanup_complete'
      AND sealed_envelope_json IS NULL
      AND acknowledged_at_ms IS NOT NULL
      AND acknowledged_at_ms >= issued_at_ms
      AND acknowledgement_receipt_json IS NOT NULL
      AND json_valid(acknowledgement_receipt_json)
      AND cleanup_state = 'complete'
      AND cleanup_receipt_json IS NOT NULL
      AND json_valid(cleanup_receipt_json)
      AND cleanup_completed_at_ms IS NOT NULL
      AND cleanup_completed_at_ms >= acknowledged_at_ms
    )
  ),
  CHECK (
    acknowledgement_auth_binding_digest_b64u IS NULL
    OR length(acknowledgement_auth_binding_digest_b64u) > 0
  ),
  CHECK (
    acknowledgement_auth_package_set_digest_b64u IS NULL
    OR length(acknowledgement_auth_package_set_digest_b64u) > 0
  ),
  CHECK (
    acknowledgement_auth_expires_at_ms IS NULL
    OR acknowledgement_auth_expires_at_ms >= issued_at_ms
  ),
  CHECK (
    (
      lifecycle_kind = 'issued'
      AND acknowledgement_auth_binding_digest_b64u IS NULL
      AND acknowledgement_auth_package_set_digest_b64u IS NULL
      AND acknowledgement_auth_expires_at_ms IS NULL
    )
    OR (
      lifecycle_kind IN ('acknowledged', 'cleanup_complete')
      AND acknowledgement_auth_binding_digest_b64u IS NOT NULL
      AND acknowledgement_auth_package_set_digest_b64u IS NOT NULL
      AND acknowledgement_auth_expires_at_ms IS NOT NULL
      AND acknowledgement_auth_expires_at_ms >= acknowledged_at_ms
      AND acknowledgement_auth_binding_digest_b64u = recipient_binding_digest_b64u
    )
  )
);

CREATE TABLE IF NOT EXISTS yao_lifecycle_decisions (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  lifecycle_id TEXT NOT NULL,
  decision_kind TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  decided_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, lifecycle_id),
  CHECK (decision_kind IN ('registration_finalized', 'add_signer_finalized')),
  CHECK (length(decision_id) > 0),
  CHECK (length(wallet_id) > 0)
);

CREATE TABLE IF NOT EXISTS wallet_auth_method_revocation_replays (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  target_wallet_auth_method_id TEXT NOT NULL,
  operation_fingerprint_digest_b64u TEXT NOT NULL,
  source_wallet_auth_method_id TEXT NOT NULL,
  source_proof_digest_b64u TEXT NOT NULL,
  response_json TEXT NOT NULL,
  committed_at_ms INTEGER NOT NULL, answer_kind TEXT NOT NULL DEFAULT 'wallet_auth_method_revocation_v1',
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, target_wallet_auth_method_id),
  CHECK (length(operation_fingerprint_digest_b64u) > 0),
  CHECK (length(source_proof_digest_b64u) > 0),
  CHECK (json_valid(response_json)),
  CHECK (committed_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS "deployment_resource_challenges" (
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

CREATE TABLE IF NOT EXISTS linked_device_bootstrap_imports (
 namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
 link_session_id TEXT NOT NULL,
 PRIMARY KEY (namespace, org_id, project_id, env_id, link_session_id)
);

CREATE TABLE IF NOT EXISTS router_ab_yao_capability_replacements (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL CHECK (length(wallet_id) > 0),
  operation_id TEXT NOT NULL,
  operation_fingerprint TEXT NOT NULL,
  previous_capability_binding_json TEXT NOT NULL,
  next_capability_binding_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, operation_id),
  CHECK (length(operation_id) > 0),
  CHECK (length(operation_fingerprint) > 0),
  CHECK (json_valid(previous_capability_binding_json)),
  CHECK (json_valid(next_capability_binding_json)),
  CHECK (created_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS router_ab_normal_signing_admission_records (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  signing_root_version TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('project_policy', 'abuse')),
  record_key TEXT NOT NULL,
  wallet_id TEXT,
  decision TEXT NOT NULL,
  retry_after_ms INTEGER,
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  PRIMARY KEY (
    namespace, org_id, project_id, env_id, signing_root_version, record_kind, record_key
  ),
  CHECK (
    (record_kind = 'project_policy' AND wallet_id IS NULL
      AND decision IN ('allowed', 'rejected')
      AND record_key = org_id || char(31) || project_id || char(31) || env_id || char(31) || signing_root_version)
    OR
    (record_kind = 'abuse' AND wallet_id IS NOT NULL AND length(wallet_id) > 0
      AND decision IN ('allowed', 'rate_limited', 'rejected')
      AND instr(record_key, org_id || char(31) || project_id || char(31) || env_id || char(31) ||
        signing_root_version || char(31) || wallet_id || char(31)) = 1)
  ),
  CHECK (
    (decision IN ('rejected', 'rate_limited') AND retry_after_ms IS NOT NULL AND retry_after_ms > 0)
    OR (decision = 'allowed' AND retry_after_ms IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS wallet_relocation_challenges (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  binding_json TEXT NOT NULL CHECK (json_valid(binding_json)),
  challenge_b64u TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, move_id),
  CHECK (expires_at_ms > created_at_ms AND expires_at_ms - created_at_ms <= 300000),
  CHECK (consumed_at_ms IS NULL OR (consumed_at_ms >= created_at_ms AND consumed_at_ms < expires_at_ms))
);

CREATE TABLE IF NOT EXISTS wallet_relocation_approvals (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  binding_json TEXT NOT NULL CHECK (json_valid(binding_json)),
  authority_digest_b64u TEXT NOT NULL,
  authority_revocation_epoch INTEGER NOT NULL CHECK (authority_revocation_epoch >= 0),
  approved_at_ms INTEGER NOT NULL CHECK (approved_at_ms > 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > approved_at_ms),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, move_id)
);

CREATE TABLE IF NOT EXISTS wallet_relocation_session_fences (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL CHECK (source_generation > 0 AND source_generation < 9007199254740991),
  retired_at_ms INTEGER NOT NULL CHECK (retired_at_ms > 0),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id),
  CHECK (length(move_id) = 49 AND substr(move_id, 1, 6) = 'wmove_' AND substr(move_id, 7) NOT GLOB '*[^A-Za-z0-9_-]*'),
  CHECK (length(request_digest_hex) = 64 AND request_digest_hex NOT GLOB '*[^a-f0-9]*')
);

CREATE TABLE IF NOT EXISTS wallet_relocation_authorization_fences (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  frozen_at_ms INTEGER NOT NULL CHECK (frozen_at_ms > 0),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id)
);

CREATE TABLE IF NOT EXISTS wallet_relocation_authorization_snapshots (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  schema_json TEXT NOT NULL CHECK (json_valid(schema_json)),
  state TEXT NOT NULL CHECK (state IN ('building', 'sealed')),
  chunk_count INTEGER,
  record_count INTEGER,
  digest_hex TEXT,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id),
  CHECK (
    (state = 'building' AND chunk_count IS NULL AND record_count IS NULL AND digest_hex IS NULL)
    OR (state = 'sealed' AND chunk_count IS NOT NULL AND chunk_count >= 0
      AND record_count IS NOT NULL AND record_count >= 0
      AND digest_hex IS NOT NULL AND length(digest_hex) = 64 AND digest_hex NOT GLOB '*[^a-f0-9]*')
  )
);

CREATE TABLE IF NOT EXISTS wallet_relocation_authorization_chunks (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  record_count INTEGER NOT NULL CHECK (record_count >= 0 AND record_count <= chunk_index + 1),
  chunk_json TEXT NOT NULL CHECK (json_valid(chunk_json) AND length(CAST(chunk_json AS BLOB)) <= 131072),
  digest_hex TEXT NOT NULL CHECK (length(digest_hex) = 64 AND digest_hex NOT GLOB '*[^a-f0-9]*'),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS wallet_relocation_authorization_imports (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL CHECK (source_generation > 0 AND source_generation < 9007199254740991),
  state TEXT NOT NULL CHECK (state IN ('importing', 'closed', 'activated')),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id)
);

CREATE TABLE IF NOT EXISTS wallet_relocation_authorization_import_context (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL, source_generation INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  record_key TEXT NOT NULL CHECK (json_valid(record_key)),
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64 AND record_digest NOT GLOB '*[^a-f0-9]*'),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id)
);

CREATE TABLE IF NOT EXISTS wallet_relocation_authorization_import_receipts (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL, source_generation INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  record_key TEXT NOT NULL CHECK (json_valid(record_key)),
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64 AND record_digest NOT GLOB '*[^a-f0-9]*'),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, move_id, table_name, record_key)
);

CREATE TABLE IF NOT EXISTS wallet_relocation_authorization_intakes (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL, manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  next_index INTEGER NOT NULL DEFAULT 0 CHECK(next_index >= 0),
  record_count INTEGER NOT NULL DEFAULT 0 CHECK(record_count >= 0),
  digest_hex TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'receiving' CHECK(state IN ('receiving', 'verified')),
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id)
);

CREATE TABLE IF NOT EXISTS wallet_relocation_authorization_intake_chunks (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, chunk_index INTEGER NOT NULL CHECK(chunk_index >= 0),
  chunk_json TEXT NOT NULL CHECK(json_valid(chunk_json) AND length(CAST(chunk_json AS BLOB)) <= 131072),
  digest_hex TEXT NOT NULL,
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS wallet_ceremony_activity (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  settled INTEGER NOT NULL CHECK (settled IN (0, 1)),
  PRIMARY KEY (namespace, org_id, project_id, env_id, record_key),
  FOREIGN KEY (namespace, org_id, project_id, env_id, record_key)
    REFERENCES router_ab_yao_versioned_json_records (namespace, org_id, project_id, env_id, record_key)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wallet_relocation_authorization_activations (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  command_digest TEXT NOT NULL CHECK(length(command_digest) = 64 AND command_digest NOT GLOB '*[^a-f0-9]*'),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  activated_at_ms INTEGER NOT NULL CHECK(activated_at_ms > 0),
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id, move_id)
);

CREATE TABLE IF NOT EXISTS wallet_relocation_authorization_cleanups (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  command_digest TEXT NOT NULL CHECK(length(command_digest) = 64 AND command_digest NOT GLOB '*[^a-f0-9]*'),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  state TEXT NOT NULL CHECK(state IN ('cleaning', 'cleaned')),
  completed_at_ms INTEGER,
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id, move_id),
  CHECK((state = 'cleaning' AND completed_at_ms IS NULL)
    OR (state = 'cleaned' AND completed_at_ms > 0 AND completed_at_ms IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "verified_wallet_operation_evidence_sets" (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL CHECK(length(org_id) > 0),
  project_id TEXT NOT NULL CHECK(length(project_id) > 0),
  env_id TEXT NOT NULL CHECK(length(env_id) > 0),
  tenant_id TEXT NOT NULL,
  evidence_set_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  authority_digest TEXT NOT NULL,
  request_origin TEXT NOT NULL,
  audience TEXT NOT NULL,
  evidence_set_digest TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  capability_kind TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  lane_digest TEXT NOT NULL,
  intent_digest TEXT NOT NULL,
  display_digest TEXT NOT NULL,
  assurance TEXT NOT NULL,
  verified_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, tenant_id, evidence_set_id),
  UNIQUE (namespace, tenant_id, evidence_set_digest),
  CHECK (json_valid(evidence_json)),
  CHECK (assurance = 'step_up'),
  CHECK (expires_at_ms > verified_at_ms),
  CHECK (
    (capability_kind = 'near_ed25519_mpc_signing'
      AND operation_kind IN (
        'near.sign_transaction',
        'near.sign_delegate_action',
        'near.sign_nep413_message',
        'near.export_key'
      ))
    OR (capability_kind = 'evm_ecdsa_mpc_signing'
      AND operation_kind IN ('evm.sign_transaction', 'evm.export_key'))
    OR (capability_kind = 'vault_access'
      AND operation_kind IN ('vault.proxy_use', 'vault.reveal'))
  )
);

CREATE TABLE IF NOT EXISTS wallet_execution_generations (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0 AND generation <= 9007199254740991),
  origin TEXT NOT NULL CHECK(origin IN ('registration', 'relocation')),
  origin_id TEXT NOT NULL CHECK(length(origin_id) > 0),
  state TEXT NOT NULL CHECK(state IN ('registering', 'inactive', 'active', 'retired')), registration_completion TEXT NOT NULL
  DEFAULT 'pending' CHECK(registration_completion IN ('pending', 'established', 'cancelled')),
  CHECK((origin = 'registration' AND state != 'inactive') OR
        (origin = 'relocation' AND state != 'registering')),
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id)
);

CREATE TABLE IF NOT EXISTS regional_deployment_admissions (
  deployment_lane TEXT NOT NULL,
  namespace TEXT NOT NULL,
  account_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  activation_sequence INTEGER NOT NULL CHECK(activation_sequence > 0 AND activation_sequence <= 9007199254740991),
  binding_revision TEXT NOT NULL,
  binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
  resource_verifications_json TEXT NOT NULL CHECK(json_valid(resource_verifications_json)),
  state TEXT NOT NULL CHECK(state IN ('prepared', 'active')),
  PRIMARY KEY(deployment_lane, namespace, account_id, database_id)
);

CREATE TABLE IF NOT EXISTS regional_deployment_write_checks (
  deployment_lane TEXT NOT NULL,
  namespace TEXT NOT NULL,
  account_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  binding_revision TEXT NOT NULL,
  writer_role TEXT NOT NULL CHECK(writer_role IN ('gateway', 'walletRuntime')),
  writer_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_email_otp_rate_limits (
  namespace TEXT NOT NULL CHECK (length(namespace) > 0),
  org_id TEXT NOT NULL CHECK (length(org_id) > 0),
  project_id TEXT NOT NULL CHECK (length(project_id) > 0),
  env_id TEXT NOT NULL CHECK (length(env_id) > 0),
  wallet_id TEXT NOT NULL CHECK (length(wallet_id) > 0),
  rate_key TEXT NOT NULL CHECK (length(rate_key) > 0),
  consumed_count INTEGER NOT NULL CHECK (consumed_count > 0),
  reset_at_ms INTEGER NOT NULL CHECK (reset_at_ms > 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms > 0 AND reset_at_ms > updated_at_ms),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, rate_key)
);

CREATE TABLE IF NOT EXISTS wallet_relocation_authorization_returns (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  previous_move_id TEXT NOT NULL, previous_request_digest_hex TEXT NOT NULL,
  retired_generation INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, move_id),
  UNIQUE (namespace, org_id, project_id, env_id, wallet_id, retired_generation),
  CHECK (retired_generation > 0 AND source_generation > retired_generation)
);

CREATE TABLE IF NOT EXISTS wallet_relocation_write_blocks (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draining', 'checked', 'released', 'frozen')),
  started_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, move_id)
);

CREATE TABLE IF NOT EXISTS wallet_object_addresses (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  ownership_generation INTEGER NOT NULL
    CHECK (ownership_generation > 0 AND ownership_generation <= 9007199254740991),
  router TEXT NOT NULL CHECK (length(router) = 64 AND router NOT GLOB '*[^a-f0-9]*'),
  deriver_a TEXT NOT NULL CHECK (length(deriver_a) = 64 AND deriver_a NOT GLOB '*[^a-f0-9]*'),
  deriver_b TEXT NOT NULL CHECK (length(deriver_b) = 64 AND deriver_b NOT GLOB '*[^a-f0-9]*'),
  signing_worker TEXT NOT NULL CHECK (length(signing_worker) = 64 AND signing_worker NOT GLOB '*[^a-f0-9]*'),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, ownership_generation)
);

CREATE TABLE IF NOT EXISTS registration_passkey_claims (
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

CREATE TABLE IF NOT EXISTS registration_setup_rate_limits (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    env_id TEXT NOT NULL,
    rate_key TEXT NOT NULL,
    consumed_count INTEGER NOT NULL CHECK (consumed_count BETWEEN 1 AND 30),
    reset_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, org_id, project_id, env_id, rate_key)
);

CREATE TABLE IF NOT EXISTS wallet_signature_completions (
  namespace TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  authorized_operation_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK(operation_kind IN (
    'near.sign_transaction', 'near.sign_delegate_action', 'near.sign_nep413_message',
    'evm.sign_transaction')),
  org_id TEXT,
  project_id TEXT,
  env_id TEXT,
  completed_at_ms INTEGER NOT NULL CHECK(completed_at_ms > 0), wallet_id TEXT, credit_grant_id TEXT, outcome TEXT NOT NULL DEFAULT 'succeeded' CHECK(outcome IN ('succeeded','failed')),
  PRIMARY KEY(namespace, tenant_id, authorized_operation_id)
);

CREATE TABLE IF NOT EXISTS voiceid_wallet_session_challenges (
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

CREATE TABLE IF NOT EXISTS external_auth_associations (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  association_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  PRIMARY KEY (namespace, org_id, project_id, env_id, association_id)
);

CREATE TABLE IF NOT EXISTS external_auth_rate_limits (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  rate_key TEXT NOT NULL, consumed_count INTEGER NOT NULL, reset_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, rate_key)
);

CREATE TABLE IF NOT EXISTS external_auth_attempts (
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

CREATE TABLE IF NOT EXISTS wallet_registration_directory_publications (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  ceremony_id TEXT NOT NULL CHECK(length(ceremony_id) > 0),
  session_json TEXT NOT NULL CHECK(json_valid(session_json) AND json_extract(session_json, '$.kind') IN ('none', 'credential')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'refused')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at_ms INTEGER NOT NULL CHECK(next_attempt_at_ms > 0),
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id)
);

CREATE TABLE IF NOT EXISTS wallet_signing_credit_grants (
 namespace TEXT NOT NULL, tenant_id TEXT NOT NULL, grant_id TEXT NOT NULL,
 project_id TEXT NOT NULL, env_id TEXT NOT NULL,
 capacity INTEGER NOT NULL CHECK(capacity>0), expires_at_ms INTEGER NOT NULL,
 admitted_count INTEGER NOT NULL DEFAULT 0 CHECK(admitted_count>=0 AND admitted_count<=capacity),
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)),
 PRIMARY KEY(namespace,tenant_id,grant_id)
);

CREATE TABLE IF NOT EXISTS wallet_signing_credit_policies (
 namespace TEXT NOT NULL, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('included','credit','blocked')),
 grant_id TEXT, revision INTEGER NOT NULL,
 PRIMARY KEY(namespace,tenant_id,project_id,env_id),
 FOREIGN KEY(namespace,tenant_id,grant_id) REFERENCES wallet_signing_credit_grants(namespace,tenant_id,grant_id),
 CHECK((mode='credit' AND grant_id IS NOT NULL) OR (mode<>'credit' AND grant_id IS NULL))
);

CREATE TABLE IF NOT EXISTS wallet_signing_credit_claims (
 namespace TEXT NOT NULL, tenant_id TEXT NOT NULL, authorized_operation_id TEXT NOT NULL,
 grant_id TEXT NOT NULL,
 PRIMARY KEY(namespace,tenant_id,authorized_operation_id),
 FOREIGN KEY(namespace,tenant_id,grant_id) REFERENCES wallet_signing_credit_grants(namespace,tenant_id,grant_id)
);

CREATE TABLE IF NOT EXISTS speak_to_sign_voice_verdicts (
 namespace TEXT NOT NULL, verdict_id TEXT NOT NULL,
 wallet_id TEXT NOT NULL, request_id TEXT NOT NULL,
 voice_hundredths INTEGER NOT NULL CHECK(voice_hundredths>=0),
 accepted_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL,
 PRIMARY KEY(namespace,verdict_id)
);

CREATE TABLE IF NOT EXISTS email_otp_challenges (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  challenge_subject_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  record_org_id TEXT NOT NULL,
  otp_channel TEXT NOT NULL,
  owner_proof_binding_digest TEXT NOT NULL,
  action TEXT NOT NULL,
  operation TEXT NOT NULL,
  otp_code_sealed TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, challenge_id),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(project_id) > 0),
  CHECK (length(env_id) > 0),
  CHECK (length(challenge_id) > 0),
  CHECK (length(challenge_subject_id) > 0),
  CHECK (length(wallet_id) > 0),
  CHECK (length(record_org_id) > 0),
  CHECK (otp_channel = 'email_otp'),
  CHECK (length(owner_proof_binding_digest) > 0),
  CHECK (
    action IN (
      'wallet_email_otp_login',
      'wallet_email_otp_registration',
      'wallet_email_otp_device_recovery',
      'wallet_email_otp_device_link',
      'wallet_email_otp_recovery_bootstrap',
      'wallet_email_otp_relocation'
    )
  ),
  CHECK (operation IN ('wallet_unlock', 'transaction_sign', 'export_key', 'registration', 'device_link', 'wallet_relocation')),
  CHECK ((action = 'wallet_email_otp_relocation') = (operation = 'wallet_relocation')),
  CHECK (length(otp_code_sealed) > 0),
  CHECK (json_valid(record_json)),
  CHECK (created_at_ms > 0),
  CHECK (expires_at_ms > created_at_ms),
  CHECK (COALESCE(json_extract(record_json, '$.version') = 'email_otp_challenge_v2', 0)),
  CHECK (COALESCE(json_extract(record_json, '$.challengeId') = challenge_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.challengeSubjectId') = challenge_subject_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.walletId') = wallet_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.orgId') = record_org_id, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.otpChannel') = otp_channel, 0)),
  CHECK (
    COALESCE(json_extract(record_json, '$.ownerProofBindingDigest') = owner_proof_binding_digest, 0)
  ),
  CHECK (COALESCE(json_extract(record_json, '$.action') = action, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.operation') = operation, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.otpCodeSealedB64u') = otp_code_sealed, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.createdAtMs') = created_at_ms, 0)),
  CHECK (COALESCE(json_extract(record_json, '$.expiresAtMs') = expires_at_ms, 0))
);

CREATE TABLE IF NOT EXISTS linked_device_email_otp_grants (
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

CREATE INDEX IF NOT EXISTS email_otp_grants_expires_idx
  ON email_otp_grants (
    namespace,
    org_id,
    project_id,
    env_id,
    expires_at_ms
  );

CREATE INDEX IF NOT EXISTS email_otp_rate_limits_reset_idx
  ON email_otp_rate_limits (
    namespace,
    org_id,
    project_id,
    env_id,
    reset_at_ms
  );

CREATE INDEX IF NOT EXISTS email_otp_unlock_challenges_expires_idx
  ON email_otp_unlock_challenges (
    namespace,
    org_id,
    project_id,
    env_id,
    expires_at_ms
  );

CREATE INDEX IF NOT EXISTS identity_links_user_idx
  ON identity_links (
    namespace,
    org_id,
    project_id,
    env_id,
    user_id,
    created_at_ms
  );

CREATE INDEX IF NOT EXISTS idx_registration_ceremony_records_expiry
  ON registration_ceremony_records (
    namespace,
    org_id,
    project_id,
    env_id,
    expires_at_ms
  );

CREATE INDEX IF NOT EXISTS idx_router_ab_yao_versioned_json_records_updated
  ON router_ab_yao_versioned_json_records (
    namespace,
    org_id,
    project_id,
    env_id,
    updated_at_ms
  );

CREATE INDEX IF NOT EXISTS lane_enrollments_wallet_idx
  ON lane_enrollments(namespace, org_id, project_id, env_id, wallet_id, updated_at_ms);

CREATE UNIQUE INDEX IF NOT EXISTS lane_product_epochs_one_active_idx
  ON lane_product_epochs(namespace, org_id, project_id, env_id, wallet_key_id, lane_id)
  WHERE state = 'active';

CREATE INDEX IF NOT EXISTS lane_product_epochs_wallet_active_idx
  ON lane_product_epochs(namespace, org_id, project_id, env_id, wallet_id, state, updated_at_ms);

CREATE INDEX IF NOT EXISTS lane_protocol_operations_enrollment_idx
  ON lane_protocol_operations(namespace, org_id, project_id, env_id, enrollment_id, operation_id);

CREATE INDEX IF NOT EXISTS linked_device_request_proof_nonces_expiry_idx
  ON linked_device_request_proof_nonces(
    namespace,
    org_id,
    project_id,
    env_id,
    expires_at_ms
  );

CREATE INDEX IF NOT EXISTS wallet_signers_chain_target_idx
  ON wallet_signers (
    namespace,
    org_id,
    project_id,
    env_id,
    signer_family,
    chain_target_key
  );

CREATE INDEX IF NOT EXISTS wallet_signers_wallet_idx
  ON wallet_signers (namespace, org_id, project_id, env_id, wallet_id, signer_family);

CREATE INDEX IF NOT EXISTS webauthn_authenticators_user_idx
  ON webauthn_authenticators (
    namespace,
    org_id,
    project_id,
    env_id,
    user_id,
    created_at_ms
  );

CREATE INDEX IF NOT EXISTS webauthn_credential_bindings_user_idx
  ON webauthn_credential_bindings (
    namespace,
    org_id,
    project_id,
    env_id,
    user_id,
    rp_id,
    signer_slot
  );

CREATE INDEX IF NOT EXISTS authorized_operation_audit_fingerprint_idx
  ON authorized_operation_audit_events(namespace, tenant_id, operation_fingerprint_digest);

CREATE INDEX IF NOT EXISTS authorized_operations_tenant_fingerprint_idx
  ON authorized_operations(namespace, tenant_id, operation_fingerprint_digest);

CREATE INDEX IF NOT EXISTS authorized_operations_tenant_lifecycle_idx
  ON authorized_operations(namespace, tenant_id, lifecycle_kind);

CREATE INDEX IF NOT EXISTS webauthn_challenges_expiry_idx
  ON webauthn_challenges (
    namespace,
    org_id,
    project_id,
    env_id,
    challenge_kind,
    expires_at_ms
  );

CREATE INDEX IF NOT EXISTS email_otp_registration_attempts_subject_idx
  ON email_otp_registration_attempts (
    namespace, org_id, project_id, env_id, provider_subject, email, state,
    expires_at_ms, owner_proof_binding_digest, runtime_org_id, runtime_policy_key,
    updated_at_ms
  );

CREATE INDEX IF NOT EXISTS email_otp_registration_attempts_wallet_idx
  ON email_otp_registration_attempts (
    namespace, org_id, project_id, env_id, wallet_id, state, expires_at_ms
  );

CREATE UNIQUE INDEX IF NOT EXISTS linked_device_target_credentials_credential_idx
  ON linked_device_target_credentials(
    namespace,
    org_id,
    project_id,
    env_id,
    credential_id_b64u
  )
  WHERE credential_id_b64u IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS linked_device_ed25519_export_root_transfers_enrollment_idx
  ON linked_device_ed25519_export_root_transfers (
    namespace, org_id, project_id, env_id, wallet_id, enrollment_id, device_id
  );

CREATE INDEX IF NOT EXISTS idx_wallet_recovery_code_locators_wallet
  ON wallet_recovery_code_locators (
    namespace, org_id, project_id, env_id, wallet_id
  );

CREATE INDEX IF NOT EXISTS linked_device_sessions_state_idx
  ON linked_device_sessions(namespace, org_id, project_id, env_id, state, updated_at_ms);

CREATE INDEX IF NOT EXISTS linked_device_authority_installations_authority_idx
  ON linked_device_authority_installations (
    namespace, org_id, project_id, env_id, authority_id
  );

CREATE INDEX IF NOT EXISTS linked_device_session_transcripts_digest_idx
  ON linked_device_session_transcripts(
    namespace,
    org_id,
    project_id,
    env_id,
    digest_b64u
  );

CREATE INDEX IF NOT EXISTS email_otp_wallet_enrollments_provider_idx
  ON email_otp_wallet_enrollments (
    namespace, org_id, project_id, env_id, record_org_id,
    provider_user_id, updated_at_ms
  );

CREATE UNIQUE INDEX IF NOT EXISTS wallet_authorities_active_device_uidx
  ON wallet_authorities (
    namespace, org_id, project_id, env_id, wallet_id, device_id
  )
  WHERE lifecycle_state <> 'revoked';

CREATE UNIQUE INDEX IF NOT EXISTS wallet_authorities_enrollment_uidx
  ON wallet_authorities (
    namespace, org_id, project_id, env_id, wallet_id, enrollment_id
  )
  WHERE enrollment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS wallet_authorities_inventory_idx
  ON wallet_authorities (
    namespace, org_id, project_id, env_id, wallet_id, lifecycle_state,
    updated_at_ms, authority_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS wallet_authorities_wallet_identity_uidx
  ON wallet_authorities (
    namespace, org_id, project_id, env_id, authority_id, wallet_id
  );

CREATE INDEX IF NOT EXISTS wallet_session_hosted_credentials_v2_parent_idx
  ON wallet_session_hosted_credentials_v2 (
    namespace, org_id, project_id, env_id, tenant_id,
    authorization_id, lifecycle_kind, expires_at_ms
  );

CREATE INDEX IF NOT EXISTS wallet_session_hosted_credentials_v2_expiry_idx
  ON wallet_session_hosted_credentials_v2 (
    namespace, org_id, project_id, env_id, tenant_id, expires_at_ms, lifecycle_kind
  );

CREATE UNIQUE INDEX IF NOT EXISTS wallet_session_hosted_credentials_v2_exact_identity_uidx
  ON wallet_session_hosted_credentials_v2 (
    namespace, org_id, project_id, env_id, tenant_id, hosted_credential_id,
    authorization_id, wallet_session_id, quota_id, principal_id, wallet_id,
    authority_id, wallet_auth_method_id
  );

CREATE INDEX IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_parent_idx
  ON wallet_session_hosted_exchange_codes_v2 (
    namespace, org_id, project_id, env_id, tenant_id,
    authorization_id, lifecycle_kind, expires_at_ms
  );

CREATE INDEX IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_expiry_idx
  ON wallet_session_hosted_exchange_codes_v2 (
    namespace, org_id, project_id, env_id, tenant_id, expires_at_ms, lifecycle_kind
  );

CREATE UNIQUE INDEX IF NOT EXISTS linked_device_authority_installations_exact_identity_uidx
  ON linked_device_authority_installations (
    namespace, org_id, project_id, env_id, link_session_id,
    authority_id, wallet_id, auth_method_id
  );

CREATE INDEX IF NOT EXISTS authorization_wallet_session_quotas_lifecycle_idx
  ON authorization_wallet_session_quotas (
    namespace, tenant_id, lifecycle_kind, expires_at_ms
  );

CREATE INDEX IF NOT EXISTS registration_completion_credential_inventory_idx
  ON router_ab_yao_versioned_json_records (
    namespace, org_id, project_id, env_id, record_key, updated_at_ms
  )
  WHERE record_key LIKE 'wallet-registration-activate:%'
     OR record_key LIKE 'wallet-registration-near-provisioning:%';

CREATE INDEX IF NOT EXISTS linked_device_authority_allocations_authority_idx
  ON linked_device_authority_allocations (
    namespace, org_id, project_id, env_id, authority_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS wallet_session_authorizations_v2_exact_identity_uidx
  ON wallet_session_authorizations_v2 (
    namespace, org_id, project_id, env_id, tenant_id, authorization_id,
    wallet_session_id, quota_id, principal_id, wallet_id,
    authority_id, wallet_auth_method_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS wallet_session_authorizations_v2_active_exact_tuple_uidx
  ON wallet_session_authorizations_v2 (
    namespace, org_id, project_id, env_id, tenant_id,
    wallet_id, authority_id, wallet_auth_method_id
  )
  WHERE retired_at_ms IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_session_authorizations_v2_operation_credential_uidx
  ON wallet_session_authorizations_v2 (
    namespace, org_id, project_id, env_id, tenant_id, operation_credential_hash
  )
  WHERE operation_credential_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS wallet_session_authorizations_v2_authority_idx
  ON wallet_session_authorizations_v2 (
    namespace, org_id, project_id, env_id, tenant_id,
    wallet_id, authority_id, wallet_auth_method_id, retired_at_ms
  );

CREATE INDEX IF NOT EXISTS wallet_session_authorizations_v2_method_idx
  ON wallet_session_authorizations_v2 (
    namespace, org_id, project_id, env_id, tenant_id,
    wallet_id, wallet_auth_method_id, retired_at_ms
  );

CREATE INDEX IF NOT EXISTS wallet_session_authorizations_v2_wallet_idx
  ON wallet_session_authorizations_v2 (
    namespace, org_id, project_id, env_id, tenant_id,
    wallet_id, retired_at_ms, expires_at_ms
  );

CREATE INDEX IF NOT EXISTS wallet_session_authorizations_v2_expiry_idx
  ON wallet_session_authorizations_v2 (
    namespace, org_id, project_id, env_id, tenant_id,
    expires_at_ms, retired_at_ms
  );

CREATE INDEX IF NOT EXISTS wallet_session_authorizations_v2_credential_lifecycle_idx
  ON wallet_session_authorizations_v2 (
    namespace, org_id, project_id, env_id, tenant_id,
    wallet_id, authority_id, wallet_auth_method_id,
    retired_at_ms, expires_at_ms, operation_credential_hash
  );

CREATE INDEX IF NOT EXISTS linked_device_wallet_session_credential_deliveries_v1_lifecycle_idx
  ON linked_device_wallet_session_credential_deliveries_v1 (
    namespace, org_id, project_id, env_id, lifecycle_kind, cleanup_state, expires_at_ms
  );

CREATE INDEX IF NOT EXISTS linked_device_wallet_session_credential_deliveries_v1_parent_idx
  ON linked_device_wallet_session_credential_deliveries_v1 (
    namespace, org_id, project_id, env_id, tenant_id, authorization_id, wallet_id
  );

CREATE INDEX IF NOT EXISTS deployment_resource_challenges_expiry_idx
  ON deployment_resource_challenges(expires_at_ms);

CREATE INDEX IF NOT EXISTS capability_replacements_wallet ON router_ab_yao_capability_replacements
  (namespace, org_id, project_id, env_id, wallet_id);

CREATE INDEX IF NOT EXISTS signing_abuse_wallet ON router_ab_normal_signing_admission_records
  (namespace, org_id, project_id, env_id, wallet_id) WHERE record_kind = 'abuse';

CREATE INDEX IF NOT EXISTS wallet_ceremony_activity_by_wallet
  ON wallet_ceremony_activity (namespace, org_id, project_id, env_id, wallet_id, settled);

CREATE INDEX IF NOT EXISTS idx_verified_wallet_operation_evidence_expiry
  ON verified_wallet_operation_evidence_sets(namespace, tenant_id, expires_at_ms);

CREATE INDEX IF NOT EXISTS wallet_operation_evidence_by_wallet
  ON verified_wallet_operation_evidence_sets(namespace, org_id, project_id, env_id, wallet_id);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_relocation_write_block_active ON wallet_relocation_write_blocks
  (namespace, org_id, project_id, env_id, wallet_id) WHERE state IN ('draining', 'checked');

CREATE INDEX IF NOT EXISTS wallet_session_authorizations_v2_tenant_authorization_idx
  ON wallet_session_authorizations_v2 (
    namespace, tenant_id, authorization_id, org_id, project_id, env_id, wallet_id
  );

CREATE INDEX IF NOT EXISTS wallet_session_authorizations_v2_tenant_quota_idx
  ON wallet_session_authorizations_v2 (
    namespace, tenant_id, quota_id, wallet_session_id, org_id, project_id, env_id, wallet_id
  );

CREATE INDEX IF NOT EXISTS wallet_execution_generations_origin_idx
  ON wallet_execution_generations (namespace, org_id, project_id, env_id, origin, origin_id, wallet_id);

CREATE INDEX IF NOT EXISTS registration_setup_rate_limits_expiry ON registration_setup_rate_limits (reset_at_ms);

CREATE INDEX IF NOT EXISTS wallet_signature_completions_due
  ON wallet_signature_completions(namespace, tenant_id, completed_at_ms);

CREATE INDEX IF NOT EXISTS voiceid_wallet_session_challenges_expiry
  ON voiceid_wallet_session_challenges(
    namespace, org_id, project_id, env_id, expires_at_ms
  );

CREATE INDEX IF NOT EXISTS wallet_auth_methods_wallet_authority_status_idx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id, wallet_id, wallet_authority_id, status
  );

CREATE UNIQUE INDEX IF NOT EXISTS wallet_auth_methods_v2_passkey_uidx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id, rp_id, credential_id_b64u
  )
  WHERE kind = 'passkey' AND credential_id_b64u IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_auth_methods_v2_voiceid_key_uidx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id, auth_identifier_key
  )
  WHERE kind = 'voiceid';

CREATE UNIQUE INDEX IF NOT EXISTS wallet_auth_methods_authority_identity_uidx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id,
    wallet_auth_method_id, wallet_id, wallet_authority_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS wallet_auth_methods_v2_authority_email_uidx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id, wallet_id, wallet_authority_id
  )
  WHERE kind = 'email_otp' AND status = 'active';

CREATE INDEX IF NOT EXISTS wallet_auth_methods_v2_email_provider_idx
  ON wallet_auth_methods (
    namespace, org_id, project_id, env_id, provider, provider_user_id
  )
  WHERE kind = 'email_otp' AND provider_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS external_auth_active_association
  ON external_auth_associations(namespace, org_id, project_id, env_id, wallet_id, provider_subject)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS external_auth_rate_expiry ON external_auth_rate_limits(reset_at_ms);

CREATE UNIQUE INDEX IF NOT EXISTS external_auth_session_token
  ON external_auth_attempts(namespace, org_id, project_id, env_id, session_token_hash);

CREATE INDEX IF NOT EXISTS external_auth_attempt_expiry ON external_auth_attempts(expires_at_ms);

CREATE INDEX IF NOT EXISTS wallet_registration_directory_publications_due
  ON wallet_registration_directory_publications(namespace, org_id, project_id, env_id, state, next_attempt_at_ms);

CREATE INDEX IF NOT EXISTS speak_to_sign_voice_verdicts_by_wallet
 ON speak_to_sign_voice_verdicts(namespace,wallet_id,accepted_at_ms);

CREATE INDEX IF NOT EXISTS email_otp_challenges_context_idx
  ON email_otp_challenges (
    namespace, org_id, project_id, env_id, challenge_subject_id, wallet_id,
    record_org_id, otp_channel, owner_proof_binding_digest, action, operation,
    expires_at_ms, created_at_ms
  );

CREATE INDEX IF NOT EXISTS email_otp_challenges_expires_idx
  ON email_otp_challenges (namespace, org_id, project_id, env_id, expires_at_ms);

CREATE INDEX IF NOT EXISTS linked_device_email_otp_grants_session_idx
  ON linked_device_email_otp_grants (
    namespace, org_id, project_id, env_id, link_session_id, state, expires_at_ms
  );

CREATE INDEX IF NOT EXISTS linked_device_email_otp_grants_expiry_idx
  ON linked_device_email_otp_grants (namespace, org_id, project_id, env_id, expires_at_ms);

CREATE VIEW IF NOT EXISTS wallet_operation_authorizations AS
SELECT namespace, org_id, project_id, env_id, wallet_id, tenant_id,
       'authorization_grant' AS source_kind, authorization_id AS source_id
FROM wallet_session_authorizations_v2
UNION ALL
SELECT namespace, org_id, project_id, env_id, wallet_id, tenant_id,
       'verified_step_up' AS source_kind, evidence_set_digest AS source_id
FROM verified_wallet_operation_evidence_sets;

CREATE VIEW IF NOT EXISTS wallet_operation_owners AS
SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id,
       operation.tenant_id, operation.authorized_operation_id
FROM wallet_operation_authorizations AS owner
JOIN authorized_operations AS operation
  ON owner.namespace = operation.namespace AND owner.tenant_id = operation.tenant_id
 AND owner.source_kind = operation.authorization_source_kind
 AND owner.source_id = CASE operation.authorization_source_kind
   WHEN 'authorization_grant' THEN operation.authorization_id ELSE operation.evidence_set_digest END
 AND (operation.authorization_source_kind = 'verified_step_up' OR
   (operation.authorization_grant_kind = 'wallet_session_authorization'
    AND owner.org_id = operation.owner_scope_org_id AND owner.project_id = operation.owner_scope_project_id
    AND owner.env_id = operation.owner_scope_env_id));

CREATE VIEW IF NOT EXISTS wallet_pending_operations AS
SELECT owner.* FROM wallet_operation_owners AS owner
JOIN authorized_operations AS operation USING(namespace, tenant_id, authorized_operation_id)
WHERE operation.lifecycle_kind = 'claimed';

CREATE TRIGGER IF NOT EXISTS lane_cas_guard_no_delete
BEFORE DELETE ON lane_cas_guard
BEGIN
  SELECT RAISE(ABORT, 'lane_cas_guard is immutable');
END;

CREATE TRIGGER IF NOT EXISTS registration_ceremony_cas_guard_no_delete
BEFORE DELETE ON registration_ceremony_cas_guard
BEGIN
  SELECT RAISE(ABORT, 'registration_ceremony_cas_guard is immutable');
END;

CREATE TRIGGER IF NOT EXISTS router_ab_yao_versioned_json_cas_guard_no_delete
BEFORE DELETE ON router_ab_yao_versioned_json_cas_guard
BEGIN
  SELECT RAISE(ABORT, 'router_ab_yao_versioned_json_cas_guard is immutable');
END;

CREATE TRIGGER IF NOT EXISTS authorized_operation_audit_complete
AFTER UPDATE OF lifecycle_kind ON authorized_operations
WHEN OLD.lifecycle_kind = 'claimed' AND NEW.lifecycle_kind = 'completed'
BEGIN
  UPDATE authorized_operation_audit_events
     SET result_kind = NEW.result_kind,
         completed_at_ms = NEW.completed_at_ms
   WHERE namespace = NEW.namespace
     AND tenant_id = NEW.tenant_id
     AND authorized_operation_id = NEW.authorized_operation_id;

  SELECT CASE
    WHEN changes() != 1
    THEN RAISE(ABORT, 'authorized_operation_audit_completion_rejected')
  END;
END;

CREATE TRIGGER IF NOT EXISTS authorized_operation_complete_atomic
BEFORE UPDATE OF lifecycle_kind ON authorized_operations
WHEN OLD.lifecycle_kind = 'completed' OR NEW.lifecycle_kind != 'completed'
BEGIN
  SELECT RAISE(ABORT, 'authorized_operation_lifecycle_transition_rejected');
END;

CREATE TRIGGER IF NOT EXISTS linked_device_session_cas_guard_no_delete
BEFORE DELETE ON linked_device_session_cas_guard
BEGIN
  SELECT RAISE(ABORT, 'linked_device_session_cas_guard row is required');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_identity_guard
BEFORE UPDATE OF
  namespace, org_id, project_id, env_id, tenant_id, hosted_credential_id,
  authorization_id, wallet_session_id, quota_id, principal_id, wallet_id,
  authority_id, wallet_auth_method_id, credential_digest_b64u, app_origin,
  wallet_origin, issued_at_ms, expires_at_ms
ON wallet_session_hosted_credentials_v2
WHEN OLD.namespace IS NOT NEW.namespace
  OR OLD.org_id IS NOT NEW.org_id
  OR OLD.project_id IS NOT NEW.project_id
  OR OLD.env_id IS NOT NEW.env_id
  OR OLD.tenant_id IS NOT NEW.tenant_id
  OR OLD.hosted_credential_id IS NOT NEW.hosted_credential_id
  OR OLD.authorization_id IS NOT NEW.authorization_id
  OR OLD.wallet_session_id IS NOT NEW.wallet_session_id
  OR OLD.quota_id IS NOT NEW.quota_id
  OR OLD.principal_id IS NOT NEW.principal_id
  OR OLD.wallet_id IS NOT NEW.wallet_id
  OR OLD.authority_id IS NOT NEW.authority_id
  OR OLD.wallet_auth_method_id IS NOT NEW.wallet_auth_method_id
  OR OLD.credential_digest_b64u IS NOT NEW.credential_digest_b64u
  OR OLD.app_origin IS NOT NEW.app_origin
  OR OLD.wallet_origin IS NOT NEW.wallet_origin
  OR OLD.issued_at_ms IS NOT NEW.issued_at_ms
  OR OLD.expires_at_ms IS NOT NEW.expires_at_ms
BEGIN
  SELECT RAISE(ABORT, 'wallet_session_hosted_credential_identity_rejected');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_lifecycle_guard
BEFORE UPDATE OF lifecycle_kind
ON wallet_session_hosted_credentials_v2
WHEN (OLD.lifecycle_kind = 'retired' AND NEW.lifecycle_kind != 'retired')
  OR (OLD.lifecycle_kind = 'active' AND NEW.lifecycle_kind NOT IN ('active', 'retired'))
BEGIN
  SELECT RAISE(ABORT, 'wallet_session_hosted_credential_transition_rejected');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_retirement_guard
BEFORE UPDATE OF retired_at_ms
ON wallet_session_hosted_credentials_v2
WHEN OLD.retired_at_ms IS NOT NEW.retired_at_ms
  AND NOT (
    OLD.lifecycle_kind = 'active'
    AND NEW.lifecycle_kind = 'retired'
    AND OLD.retired_at_ms IS NULL
    AND NEW.retired_at_ms IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_session_hosted_credential_retirement_rejected');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_child_update_guard
BEFORE UPDATE OF lifecycle_kind, hosted_credential_id
ON wallet_session_hosted_exchange_codes_v2
WHEN NEW.hosted_credential_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM wallet_session_hosted_credentials_v2 AS credential
     WHERE credential.namespace = NEW.namespace
       AND credential.org_id = NEW.org_id
       AND credential.project_id = NEW.project_id
       AND credential.env_id = NEW.env_id
       AND credential.tenant_id = NEW.tenant_id
       AND credential.hosted_credential_id = NEW.hosted_credential_id
       AND credential.authorization_id = NEW.authorization_id
       AND credential.wallet_session_id = NEW.wallet_session_id
       AND credential.quota_id = NEW.quota_id
       AND credential.principal_id = NEW.principal_id
       AND credential.wallet_id = NEW.wallet_id
       AND credential.authority_id = NEW.authority_id
       AND credential.wallet_auth_method_id = NEW.wallet_auth_method_id
       AND credential.lifecycle_kind = 'active'
       AND credential.retired_at_ms IS NULL
       AND credential.expires_at_ms >= NEW.expires_at_ms
       AND credential.expires_at_ms > COALESCE(NEW.consumed_at_ms, NEW.issued_at_ms)
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_session_hosted_exchange_child_rejected');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_identity_guard
BEFORE UPDATE OF
  namespace, org_id, project_id, env_id, tenant_id, exchange_code_id,
  authorization_id, wallet_session_id, quota_id, principal_id, wallet_id,
  authority_id, wallet_auth_method_id, code_hash, nonce_digest, app_origin,
  wallet_origin, issued_at_ms, expires_at_ms
ON wallet_session_hosted_exchange_codes_v2
WHEN OLD.namespace IS NOT NEW.namespace
  OR OLD.org_id IS NOT NEW.org_id
  OR OLD.project_id IS NOT NEW.project_id
  OR OLD.env_id IS NOT NEW.env_id
  OR OLD.tenant_id IS NOT NEW.tenant_id
  OR OLD.exchange_code_id IS NOT NEW.exchange_code_id
  OR OLD.authorization_id IS NOT NEW.authorization_id
  OR OLD.wallet_session_id IS NOT NEW.wallet_session_id
  OR OLD.quota_id IS NOT NEW.quota_id
  OR OLD.principal_id IS NOT NEW.principal_id
  OR OLD.wallet_id IS NOT NEW.wallet_id
  OR OLD.authority_id IS NOT NEW.authority_id
  OR OLD.wallet_auth_method_id IS NOT NEW.wallet_auth_method_id
  OR OLD.code_hash IS NOT NEW.code_hash
  OR OLD.nonce_digest IS NOT NEW.nonce_digest
  OR OLD.app_origin IS NOT NEW.app_origin
  OR OLD.wallet_origin IS NOT NEW.wallet_origin
  OR OLD.issued_at_ms IS NOT NEW.issued_at_ms
  OR OLD.expires_at_ms IS NOT NEW.expires_at_ms
BEGIN
  SELECT RAISE(ABORT, 'wallet_session_hosted_exchange_identity_rejected');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_lifecycle_guard
BEFORE UPDATE OF lifecycle_kind, hosted_credential_id, consumed_at_ms
ON wallet_session_hosted_exchange_codes_v2
WHEN (
  OLD.lifecycle_kind IS NOT NEW.lifecycle_kind
  OR OLD.hosted_credential_id IS NOT NEW.hosted_credential_id
  OR OLD.consumed_at_ms IS NOT NEW.consumed_at_ms
)
AND NOT (
  OLD.lifecycle_kind = 'issued'
  AND NEW.lifecycle_kind = 'consumed'
  AND OLD.hosted_credential_id IS NULL
  AND NEW.hosted_credential_id IS NOT NULL
  AND OLD.consumed_at_ms IS NULL
  AND NEW.consumed_at_ms IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_session_hosted_exchange_transition_rejected');
END;

CREATE TRIGGER IF NOT EXISTS authorized_operation_grant_shape_guard
BEFORE INSERT ON authorized_operations
WHEN NEW.lifecycle_kind = 'claimed'
  AND (
    NEW.authorization_source_kind NOT IN ('authorization_grant', 'verified_step_up')
    OR (
      NEW.authorization_source_kind = 'authorization_grant'
      AND (
        NEW.authorization_grant_kind IS NULL
        OR NEW.authorization_grant_kind NOT IN ('wallet_session_authorization')
        OR NEW.owner_scope_org_id IS NULL
        OR NEW.owner_scope_project_id IS NULL
        OR NEW.owner_scope_env_id IS NULL
        OR length(NEW.owner_scope_org_id) = 0
        OR length(NEW.owner_scope_project_id) = 0
        OR length(NEW.owner_scope_env_id) = 0
      )
    )
    OR (
      NEW.authorization_source_kind = 'verified_step_up'
      AND (
        NEW.authorization_grant_kind IS NOT NULL
        OR NEW.owner_scope_org_id IS NOT NULL
        OR NEW.owner_scope_project_id IS NOT NULL
        OR NEW.owner_scope_env_id IS NOT NULL
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'authorization_grant_kind_rejected');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_parent_update_guard
BEFORE UPDATE OF lifecycle_kind
ON wallet_session_hosted_credentials_v2
WHEN NOT EXISTS (
  SELECT 1
    FROM wallet_session_authorizations_v2 AS session
   WHERE session.namespace = NEW.namespace
     AND session.org_id = NEW.org_id
     AND session.project_id = NEW.project_id
     AND session.env_id = NEW.env_id
     AND session.tenant_id = NEW.tenant_id
     AND session.authorization_id = NEW.authorization_id
     AND session.wallet_session_id = NEW.wallet_session_id
     AND session.quota_id = NEW.quota_id
     AND session.principal_id = NEW.principal_id
     AND session.wallet_id = NEW.wallet_id
     AND session.authority_id = NEW.authority_id
     AND session.wallet_auth_method_id = NEW.wallet_auth_method_id
     AND session.operation_credential_hash IS NOT NULL
     AND session.retired_at_ms IS NULL
     AND session.expires_at_ms >= NEW.expires_at_ms
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_session_hosted_credential_parent_rejected');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_parent_update_guard
BEFORE UPDATE OF lifecycle_kind, hosted_credential_id
ON wallet_session_hosted_exchange_codes_v2
WHEN NOT EXISTS (
  SELECT 1
    FROM wallet_session_authorizations_v2 AS session
   WHERE session.namespace = NEW.namespace
     AND session.org_id = NEW.org_id
     AND session.project_id = NEW.project_id
     AND session.env_id = NEW.env_id
     AND session.tenant_id = NEW.tenant_id
     AND session.authorization_id = NEW.authorization_id
     AND session.wallet_session_id = NEW.wallet_session_id
     AND session.quota_id = NEW.quota_id
     AND session.principal_id = NEW.principal_id
     AND session.wallet_id = NEW.wallet_id
     AND session.authority_id = NEW.authority_id
     AND session.wallet_auth_method_id = NEW.wallet_auth_method_id
     AND session.operation_credential_hash IS NOT NULL
     AND session.retired_at_ms IS NULL
     AND session.expires_at_ms >= NEW.expires_at_ms
     AND session.expires_at_ms > COALESCE(NEW.consumed_at_ms, NEW.issued_at_ms)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_session_hosted_exchange_parent_rejected');
END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_delivery_identity_guard
BEFORE UPDATE OF
  namespace, org_id, project_id, env_id, link_session_id, tenant_id,
  authorization_id, wallet_session_id, quota_id, principal_id, authority_id,
  wallet_id, wallet_auth_method_id, credential_digest_b64u, recipient_kind,
  recipient_public_key_b64u, recipient_binding_digest_b64u, envelope_alg,
  aad_digest_b64u, sealed_envelope_digest_b64u, installation_receipt_digest_b64u,
  issued_at_ms, expires_at_ms
ON linked_device_wallet_session_credential_deliveries_v1
WHEN OLD.namespace IS NOT NEW.namespace
  OR OLD.org_id IS NOT NEW.org_id
  OR OLD.project_id IS NOT NEW.project_id
  OR OLD.env_id IS NOT NEW.env_id
  OR OLD.link_session_id IS NOT NEW.link_session_id
  OR OLD.tenant_id IS NOT NEW.tenant_id
  OR OLD.authorization_id IS NOT NEW.authorization_id
  OR OLD.wallet_session_id IS NOT NEW.wallet_session_id
  OR OLD.quota_id IS NOT NEW.quota_id
  OR OLD.principal_id IS NOT NEW.principal_id
  OR OLD.authority_id IS NOT NEW.authority_id
  OR OLD.wallet_id IS NOT NEW.wallet_id
  OR OLD.wallet_auth_method_id IS NOT NEW.wallet_auth_method_id
  OR OLD.credential_digest_b64u IS NOT NEW.credential_digest_b64u
  OR OLD.recipient_kind IS NOT NEW.recipient_kind
  OR OLD.recipient_public_key_b64u IS NOT NEW.recipient_public_key_b64u
  OR OLD.recipient_binding_digest_b64u IS NOT NEW.recipient_binding_digest_b64u
  OR OLD.envelope_alg IS NOT NEW.envelope_alg
  OR OLD.aad_digest_b64u IS NOT NEW.aad_digest_b64u
  OR OLD.sealed_envelope_digest_b64u IS NOT NEW.sealed_envelope_digest_b64u
  OR OLD.installation_receipt_digest_b64u IS NOT NEW.installation_receipt_digest_b64u
  OR OLD.issued_at_ms IS NOT NEW.issued_at_ms
  OR OLD.expires_at_ms IS NOT NEW.expires_at_ms
BEGIN
  SELECT RAISE(ABORT, 'linked_device_wallet_session_credential_delivery_identity_rejected');
END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_delivery_envelope_guard
BEFORE UPDATE OF sealed_envelope_json
ON linked_device_wallet_session_credential_deliveries_v1
WHEN NOT (
  OLD.lifecycle_kind = 'issued'
  AND NEW.lifecycle_kind = 'acknowledged'
  AND OLD.sealed_envelope_json IS NOT NULL
  AND NEW.sealed_envelope_json IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'linked_device_wallet_session_credential_delivery_envelope_rejected');
END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_delivery_acknowledgement_guard
BEFORE UPDATE OF
  acknowledged_at_ms, acknowledgement_receipt_json,
  acknowledgement_auth_binding_digest_b64u,
  acknowledgement_auth_package_set_digest_b64u,
  acknowledgement_auth_expires_at_ms
ON linked_device_wallet_session_credential_deliveries_v1
WHEN (
  OLD.acknowledged_at_ms IS NOT NEW.acknowledged_at_ms
  OR OLD.acknowledgement_receipt_json IS NOT NEW.acknowledgement_receipt_json
  OR OLD.acknowledgement_auth_binding_digest_b64u IS NOT NEW.acknowledgement_auth_binding_digest_b64u
  OR OLD.acknowledgement_auth_package_set_digest_b64u IS NOT NEW.acknowledgement_auth_package_set_digest_b64u
  OR OLD.acknowledgement_auth_expires_at_ms IS NOT NEW.acknowledgement_auth_expires_at_ms
)
AND NOT (
  OLD.lifecycle_kind = 'issued'
  AND NEW.lifecycle_kind = 'acknowledged'
  AND OLD.acknowledged_at_ms IS NULL
  AND OLD.acknowledgement_receipt_json IS NULL
  AND OLD.acknowledgement_auth_binding_digest_b64u IS NULL
  AND OLD.acknowledgement_auth_package_set_digest_b64u IS NULL
  AND OLD.acknowledgement_auth_expires_at_ms IS NULL
  AND NEW.acknowledged_at_ms IS NOT NULL
  AND NEW.acknowledgement_receipt_json IS NOT NULL
  AND NEW.acknowledgement_auth_binding_digest_b64u IS NOT NULL
  AND NEW.acknowledgement_auth_package_set_digest_b64u IS NOT NULL
  AND NEW.acknowledgement_auth_expires_at_ms IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'linked_device_wallet_session_credential_delivery_acknowledgement_rejected');
END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_delivery_cleanup_receipt_guard
BEFORE UPDATE OF cleanup_receipt_json
ON linked_device_wallet_session_credential_deliveries_v1
WHEN OLD.cleanup_receipt_json IS NOT NEW.cleanup_receipt_json
  AND NOT (
    OLD.lifecycle_kind = 'issued'
    AND NEW.lifecycle_kind = 'acknowledged'
    AND OLD.cleanup_receipt_json IS NULL
    AND NEW.cleanup_receipt_json IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'linked_device_wallet_session_credential_delivery_cleanup_receipt_rejected');
END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_delivery_cleanup_completion_guard
BEFORE UPDATE OF cleanup_completed_at_ms
ON linked_device_wallet_session_credential_deliveries_v1
WHEN OLD.cleanup_completed_at_ms IS NOT NEW.cleanup_completed_at_ms
  AND NOT (
    OLD.lifecycle_kind = 'acknowledged'
    AND NEW.lifecycle_kind = 'cleanup_complete'
    AND OLD.cleanup_completed_at_ms IS NULL
    AND NEW.cleanup_completed_at_ms IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'linked_device_wallet_session_credential_delivery_cleanup_completion_rejected');
END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_delivery_lifecycle_guard
BEFORE UPDATE OF lifecycle_kind, cleanup_state, sealed_envelope_json,
  acknowledged_at_ms, acknowledgement_receipt_json, cleanup_receipt_json,
  cleanup_completed_at_ms
ON linked_device_wallet_session_credential_deliveries_v1
WHEN (
  (OLD.lifecycle_kind = 'issued' AND NEW.lifecycle_kind NOT IN ('issued', 'acknowledged'))
  OR (OLD.lifecycle_kind = 'acknowledged' AND NEW.lifecycle_kind NOT IN ('acknowledged', 'cleanup_complete'))
  OR (OLD.lifecycle_kind = 'cleanup_complete' AND NEW.lifecycle_kind != 'cleanup_complete')
  OR (
    CASE OLD.cleanup_state
      WHEN 'pending' THEN 0
      WHEN 'allocation_removed' THEN 1
      WHEN 'session_removed' THEN 2
      WHEN 'complete' THEN 3
    END
    != CASE NEW.cleanup_state
      WHEN 'pending' THEN 0
      WHEN 'allocation_removed' THEN 1
      WHEN 'session_removed' THEN 2
      WHEN 'complete' THEN 3
    END
    AND (
      CASE NEW.cleanup_state
        WHEN 'pending' THEN 0
        WHEN 'allocation_removed' THEN 1
        WHEN 'session_removed' THEN 2
        WHEN 'complete' THEN 3
      END
      NOT IN (
        CASE OLD.cleanup_state
          WHEN 'pending' THEN 0
          WHEN 'allocation_removed' THEN 1
          WHEN 'session_removed' THEN 2
          WHEN 'complete' THEN 3
        END + 1
      )
    )
  )
  OR (
    OLD.lifecycle_kind = 'issued'
    AND NEW.lifecycle_kind = 'acknowledged'
    AND NEW.cleanup_state != 'pending'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'linked_device_wallet_session_credential_delivery_transition_rejected');
END;

CREATE TRIGGER IF NOT EXISTS authorized_operation_audit_claim
AFTER INSERT ON authorized_operations
WHEN NEW.lifecycle_kind = 'claimed'
BEGIN
  INSERT INTO authorized_operation_audit_events (
    namespace, tenant_id, audit_event_id, authorized_operation_id,
    operation_fingerprint_digest, authorization_source_kind, authorization_id,
    authorization_grant_kind, evidence_set_digest, quota_id, material_activation_id,
    material_activation_capability, material_activation_owner,
    material_activation_key_binding, material_activation_lifecycle_binding,
    material_activation_signing_worker, owner_scope_org_id, owner_scope_project_id,
    owner_scope_env_id, result_kind, claimed_at_ms, completed_at_ms
  ) VALUES (
    NEW.namespace, NEW.tenant_id, NEW.audit_event_id, NEW.authorized_operation_id,
    NEW.operation_fingerprint_digest, NEW.authorization_source_kind, NEW.authorization_id,
    NEW.authorization_grant_kind, NEW.evidence_set_digest, NEW.quota_id,
    NEW.material_activation_id, NEW.material_activation_capability,
    NEW.material_activation_owner, NEW.material_activation_key_binding,
    NEW.material_activation_lifecycle_binding, NEW.material_activation_signing_worker,
    NEW.owner_scope_org_id, NEW.owner_scope_project_id,
    NEW.owner_scope_env_id, NEW.result_kind, NEW.claimed_at_ms, NEW.completed_at_ms
  );
END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_session_fences_immutable
BEFORE UPDATE ON wallet_relocation_session_fences
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex
  OR NEW.source_generation IS NOT OLD.source_generation OR NEW.retired_at_ms IS NOT OLD.retired_at_ms
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_fence_immutable');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_authorizations_v2_relocation_insert_guard
BEFORE INSERT ON wallet_session_authorizations_v2
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_authorizations_v2_relocation_update_guard
BEFORE UPDATE ON wallet_session_authorizations_v2
WHEN (NEW.retired_at_ms IS NULL) AND EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id) OR (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_relocation_insert_guard
BEFORE INSERT ON wallet_session_hosted_credentials_v2
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_relocation_update_guard
BEFORE UPDATE ON wallet_session_hosted_credentials_v2
WHEN (NEW.lifecycle_kind = 'active') AND EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id) OR (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_relocation_insert_guard
BEFORE INSERT ON wallet_session_hosted_exchange_codes_v2
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_relocation_update_guard
BEFORE UPDATE ON wallet_session_hosted_exchange_codes_v2
WHEN (NEW.lifecycle_kind IN ('issued', 'consumed')) AND EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id) OR (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_authorization_fences_immutable
BEFORE UPDATE ON wallet_relocation_authorization_fences
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex
  OR NEW.source_generation IS NOT OLD.source_generation OR NEW.frozen_at_ms IS NOT OLD.frozen_at_ms
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_fence_immutable');
END;

CREATE TRIGGER IF NOT EXISTS wallet_authorities_frozen_insert
BEFORE INSERT ON wallet_authorities
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER IF NOT EXISTS wallet_authorities_frozen_update
BEFORE UPDATE ON wallet_authorities
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

CREATE TRIGGER IF NOT EXISTS wallet_session_authorizations_v2_frozen_insert
BEFORE INSERT ON wallet_session_authorizations_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_authorizations_v2_frozen_update
BEFORE UPDATE ON wallet_session_authorizations_v2
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

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_frozen_insert
BEFORE INSERT ON wallet_session_hosted_credentials_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_frozen_update
BEFORE UPDATE ON wallet_session_hosted_credentials_v2
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

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_frozen_insert
BEFORE INSERT ON wallet_session_hosted_exchange_codes_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_frozen_update
BEFORE UPDATE ON wallet_session_hosted_exchange_codes_v2
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

CREATE TRIGGER IF NOT EXISTS authorization_wallet_session_quotas_frozen_insert
BEFORE INSERT ON authorization_wallet_session_quotas
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    JOIN wallet_session_authorizations_v2 AS session
      ON session.namespace = fence.namespace AND session.org_id = fence.org_id
      AND session.project_id = fence.project_id AND session.env_id = fence.env_id
      AND session.wallet_id = fence.wallet_id
    WHERE session.namespace = NEW.namespace AND session.tenant_id = NEW.tenant_id
      AND session.quota_id = NEW.quota_id AND session.wallet_session_id = NEW.wallet_session_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER IF NOT EXISTS authorization_wallet_session_quotas_frozen_update
BEFORE UPDATE ON authorization_wallet_session_quotas
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    JOIN wallet_session_authorizations_v2 AS session
      ON session.namespace = fence.namespace AND session.org_id = fence.org_id
      AND session.project_id = fence.project_id AND session.env_id = fence.env_id
      AND session.wallet_id = fence.wallet_id
    WHERE session.namespace = OLD.namespace AND session.tenant_id = OLD.tenant_id
      AND session.quota_id = OLD.quota_id AND session.wallet_session_id = OLD.wallet_session_id
  ) OR EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    JOIN wallet_session_authorizations_v2 AS session
      ON session.namespace = fence.namespace AND session.org_id = fence.org_id
      AND session.project_id = fence.project_id AND session.env_id = fence.env_id
      AND session.wallet_id = fence.wallet_id
    WHERE session.namespace = NEW.namespace AND session.tenant_id = NEW.tenant_id
      AND session.quota_id = NEW.quota_id AND session.wallet_session_id = NEW.wallet_session_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER IF NOT EXISTS authorization_wallet_session_quotas_frozen_delete
BEFORE DELETE ON authorization_wallet_session_quotas
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    JOIN wallet_session_authorizations_v2 AS session
      ON session.namespace = fence.namespace AND session.org_id = fence.org_id
      AND session.project_id = fence.project_id AND session.env_id = fence.env_id
      AND session.wallet_id = fence.wallet_id
    WHERE session.namespace = OLD.namespace AND session.tenant_id = OLD.tenant_id
      AND session.quota_id = OLD.quota_id AND session.wallet_session_id = OLD.wallet_session_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_snapshot_insert
BEFORE INSERT ON wallet_relocation_authorization_snapshots
WHEN NEW.state != 'building' OR EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_snapshots AS existing
  WHERE existing.namespace = NEW.namespace AND existing.org_id = NEW.org_id
    AND existing.project_id = NEW.project_id AND existing.env_id = NEW.env_id AND existing.wallet_id = NEW.wallet_id
) OR NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id
    AND fence.move_id = NEW.move_id AND fence.request_digest_hex = NEW.request_digest_hex
    AND fence.source_generation = NEW.source_generation
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_snapshot_requires_frozen_source');
END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_snapshot_update
BEFORE UPDATE ON wallet_relocation_authorization_snapshots
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex OR NEW.source_generation IS NOT OLD.source_generation
  OR NEW.schema_json IS NOT OLD.schema_json
  OR (OLD.state = 'sealed' AND (NEW.state IS NOT OLD.state OR NEW.chunk_count IS NOT OLD.chunk_count
      OR NEW.record_count IS NOT OLD.record_count OR NEW.digest_hex IS NOT OLD.digest_hex))
  OR (NEW.state = 'sealed' AND NEW.chunk_count != (
    SELECT COUNT(*) FROM wallet_relocation_authorization_chunks AS chunk
    WHERE chunk.namespace = OLD.namespace AND chunk.org_id = OLD.org_id
      AND chunk.project_id = OLD.project_id AND chunk.env_id = OLD.env_id AND chunk.wallet_id = OLD.wallet_id
  ))
  OR (NEW.state = 'sealed' AND NEW.record_count != COALESCE((
    SELECT record_count FROM wallet_relocation_authorization_chunks AS chunk
    WHERE chunk.namespace = OLD.namespace AND chunk.org_id = OLD.org_id
      AND chunk.project_id = OLD.project_id AND chunk.env_id = OLD.env_id AND chunk.wallet_id = OLD.wallet_id
      AND chunk.chunk_index = NEW.chunk_count - 1
  ), 0))
  OR (NEW.state = 'sealed' AND NEW.chunk_count > 0 AND NEW.digest_hex IS NOT (
    SELECT digest_hex FROM wallet_relocation_authorization_chunks AS chunk
    WHERE chunk.namespace = OLD.namespace AND chunk.org_id = OLD.org_id
      AND chunk.project_id = OLD.project_id AND chunk.env_id = OLD.env_id AND chunk.wallet_id = OLD.wallet_id
      AND chunk.chunk_index = NEW.chunk_count - 1
  ))
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_snapshot_conflict');
END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_chunk_insert
BEFORE INSERT ON wallet_relocation_authorization_chunks
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_snapshots AS snapshot
  WHERE snapshot.namespace = NEW.namespace AND snapshot.org_id = NEW.org_id
    AND snapshot.project_id = NEW.project_id AND snapshot.env_id = NEW.env_id AND snapshot.wallet_id = NEW.wallet_id
    AND snapshot.state = 'building'
) OR NEW.chunk_index != (
  SELECT COALESCE(MAX(chunk_index), -1) + 1 FROM wallet_relocation_authorization_chunks AS chunk
  WHERE chunk.namespace = NEW.namespace AND chunk.org_id = NEW.org_id
    AND chunk.project_id = NEW.project_id AND chunk.env_id = NEW.env_id AND chunk.wallet_id = NEW.wallet_id
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_chunk_out_of_order');
END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_chunk_update
BEFORE UPDATE ON wallet_relocation_authorization_chunks
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
  OR NEW.chunk_index IS NOT OLD.chunk_index OR NEW.record_count IS NOT OLD.record_count
  OR NEW.chunk_json IS NOT OLD.chunk_json OR NEW.digest_hex IS NOT OLD.digest_hex
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_chunk_immutable');
END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_authorization_import_identity_guard
BEFORE UPDATE ON wallet_relocation_authorization_imports
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex OR NEW.source_generation IS NOT OLD.source_generation
  OR (OLD.state = 'closed' AND NEW.state = 'importing')
  OR (OLD.state = 'activated' AND NEW.state != 'activated')
  OR (OLD.state = 'importing' AND NEW.state = 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_import_transition_rejected'); END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_authorization_receipt_immutable
BEFORE UPDATE ON wallet_relocation_authorization_import_receipts
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_receipt_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_insert_lifecycle_guard
BEFORE INSERT ON wallet_session_hosted_credentials_v2
WHEN (NEW.lifecycle_kind != 'active' OR NEW.retired_at_ms IS NOT NULL) AND NOT (NEW.lifecycle_kind = 'retired' AND NEW.retired_at_ms IS NOT NULL AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = NEW.wallet_id AND context.table_name = 'wallet_session_hosted_credentials_v2'
      AND context.record_key = json_array(NEW.env_id, NEW.hosted_credential_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.tenant_id)))
BEGIN SELECT RAISE(ABORT, 'wallet_session_hosted_credential_initial_state_rejected'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_parent_guard
BEFORE INSERT ON wallet_session_hosted_credentials_v2
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_session_authorizations_v2 AS session
  WHERE session.namespace = NEW.namespace AND session.org_id = NEW.org_id
    AND session.project_id = NEW.project_id AND session.env_id = NEW.env_id
    AND session.tenant_id = NEW.tenant_id AND session.authorization_id = NEW.authorization_id
    AND session.wallet_session_id = NEW.wallet_session_id AND session.quota_id = NEW.quota_id
    AND session.principal_id = NEW.principal_id AND session.wallet_id = NEW.wallet_id
    AND session.authority_id = NEW.authority_id AND session.wallet_auth_method_id = NEW.wallet_auth_method_id
    AND session.operation_credential_hash IS NOT NULL AND session.expires_at_ms >= NEW.expires_at_ms
    AND (session.retired_at_ms IS NULL OR (NEW.lifecycle_kind = 'retired' AND NEW.retired_at_ms IS NOT NULL AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = NEW.wallet_id AND context.table_name = 'wallet_session_hosted_credentials_v2'
      AND context.record_key = json_array(NEW.env_id, NEW.hosted_credential_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.tenant_id))))
)
BEGIN SELECT RAISE(ABORT, 'wallet_session_hosted_credential_parent_rejected'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_insert_lifecycle_guard
BEFORE INSERT ON wallet_session_hosted_exchange_codes_v2
WHEN (NEW.lifecycle_kind != 'issued' OR NEW.hosted_credential_id IS NOT NULL OR NEW.consumed_at_ms IS NOT NULL) AND NOT ((NEW.lifecycle_kind = 'issued' OR (NEW.lifecycle_kind = 'consumed' AND EXISTS (
      SELECT 1 FROM wallet_session_hosted_credentials_v2 AS child
      WHERE child.namespace = NEW.namespace AND child.org_id = NEW.org_id
        AND child.project_id = NEW.project_id AND child.env_id = NEW.env_id
        AND child.tenant_id = NEW.tenant_id AND child.hosted_credential_id = NEW.hosted_credential_id
        AND child.wallet_id = NEW.wallet_id AND child.lifecycle_kind = 'retired'))) AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = NEW.wallet_id AND context.table_name = 'wallet_session_hosted_exchange_codes_v2'
      AND context.record_key = json_array(NEW.env_id, NEW.exchange_code_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.tenant_id)))
BEGIN SELECT RAISE(ABORT, 'wallet_session_hosted_exchange_initial_state_rejected'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_parent_guard
BEFORE INSERT ON wallet_session_hosted_exchange_codes_v2
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_session_authorizations_v2 AS session
  WHERE session.namespace = NEW.namespace AND session.org_id = NEW.org_id
    AND session.project_id = NEW.project_id AND session.env_id = NEW.env_id
    AND session.tenant_id = NEW.tenant_id AND session.authorization_id = NEW.authorization_id
    AND session.wallet_session_id = NEW.wallet_session_id AND session.quota_id = NEW.quota_id
    AND session.principal_id = NEW.principal_id AND session.wallet_id = NEW.wallet_id
    AND session.authority_id = NEW.authority_id AND session.wallet_auth_method_id = NEW.wallet_auth_method_id
    AND session.operation_credential_hash IS NOT NULL AND session.expires_at_ms >= NEW.expires_at_ms
    AND (session.retired_at_ms IS NULL OR ((NEW.lifecycle_kind = 'issued' OR (NEW.lifecycle_kind = 'consumed' AND EXISTS (
      SELECT 1 FROM wallet_session_hosted_credentials_v2 AS child
      WHERE child.namespace = NEW.namespace AND child.org_id = NEW.org_id
        AND child.project_id = NEW.project_id AND child.env_id = NEW.env_id
        AND child.tenant_id = NEW.tenant_id AND child.hosted_credential_id = NEW.hosted_credential_id
        AND child.wallet_id = NEW.wallet_id AND child.lifecycle_kind = 'retired'))) AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = NEW.wallet_id AND context.table_name = 'wallet_session_hosted_exchange_codes_v2'
      AND context.record_key = json_array(NEW.env_id, NEW.exchange_code_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.tenant_id))))
)
BEGIN SELECT RAISE(ABORT, 'wallet_session_hosted_exchange_parent_rejected'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorities_inactive_import_insert
BEFORE INSERT ON wallet_authorities
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
        AND context.table_name = 'wallet_authorities'
        AND context.record_key = json_array(NEW.authority_id, NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id)
    ))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorities_inactive_import_update
BEFORE UPDATE ON wallet_authorities
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')) OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorities_inactive_import_delete
BEFORE DELETE ON wallet_authorities
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS authorization_wallet_session_quotas_inactive_import_insert
BEFORE INSERT ON authorization_wallet_session_quotas
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = NEW.namespace AND (
      EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt
        WHERE receipt.namespace = destination.namespace AND receipt.org_id = destination.org_id
          AND receipt.project_id = destination.project_id AND receipt.env_id = destination.env_id
          AND receipt.wallet_id = destination.wallet_id AND receipt.table_name = 'authorization_wallet_session_quotas'
          AND receipt.record_key = json_array(NEW.namespace, NEW.quota_id, NEW.tenant_id))
      OR EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
        WHERE session.namespace = destination.namespace AND session.org_id = destination.org_id
          AND session.project_id = destination.project_id AND session.env_id = destination.env_id
          AND session.wallet_id = destination.wallet_id AND session.namespace = NEW.namespace
          AND session.tenant_id = NEW.tenant_id AND session.quota_id = NEW.quota_id
          AND session.wallet_session_id = NEW.wallet_session_id)
    ) AND destination.state != 'activated') AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
        AND destination.project_id = context.project_id AND destination.env_id = context.env_id
        AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
        AND destination.request_digest_hex = context.request_digest_hex
        AND destination.source_generation = context.source_generation AND destination.state = 'importing'
      WHERE context.namespace = NEW.namespace AND context.table_name = 'authorization_wallet_session_quotas'
        AND context.record_key = json_array(NEW.namespace, NEW.quota_id, NEW.tenant_id)
    ))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS authorization_wallet_session_quotas_inactive_import_update
BEFORE UPDATE ON authorization_wallet_session_quotas
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND (
      EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt
        WHERE receipt.namespace = destination.namespace AND receipt.org_id = destination.org_id
          AND receipt.project_id = destination.project_id AND receipt.env_id = destination.env_id
          AND receipt.wallet_id = destination.wallet_id AND receipt.table_name = 'authorization_wallet_session_quotas'
          AND receipt.record_key = json_array(OLD.namespace, OLD.quota_id, OLD.tenant_id))
      OR EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
        WHERE session.namespace = destination.namespace AND session.org_id = destination.org_id
          AND session.project_id = destination.project_id AND session.env_id = destination.env_id
          AND session.wallet_id = destination.wallet_id AND session.namespace = OLD.namespace
          AND session.tenant_id = OLD.tenant_id AND session.quota_id = OLD.quota_id
          AND session.wallet_session_id = OLD.wallet_session_id)
    ) AND destination.state != 'activated')) OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = NEW.namespace AND (
      EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt
        WHERE receipt.namespace = destination.namespace AND receipt.org_id = destination.org_id
          AND receipt.project_id = destination.project_id AND receipt.env_id = destination.env_id
          AND receipt.wallet_id = destination.wallet_id AND receipt.table_name = 'authorization_wallet_session_quotas'
          AND receipt.record_key = json_array(NEW.namespace, NEW.quota_id, NEW.tenant_id))
      OR EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
        WHERE session.namespace = destination.namespace AND session.org_id = destination.org_id
          AND session.project_id = destination.project_id AND session.env_id = destination.env_id
          AND session.wallet_id = destination.wallet_id AND session.namespace = NEW.namespace
          AND session.tenant_id = NEW.tenant_id AND session.quota_id = NEW.quota_id
          AND session.wallet_session_id = NEW.wallet_session_id)
    ) AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS authorization_wallet_session_quotas_inactive_import_delete
BEFORE DELETE ON authorization_wallet_session_quotas
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND (
      EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt
        WHERE receipt.namespace = destination.namespace AND receipt.org_id = destination.org_id
          AND receipt.project_id = destination.project_id AND receipt.env_id = destination.env_id
          AND receipt.wallet_id = destination.wallet_id AND receipt.table_name = 'authorization_wallet_session_quotas'
          AND receipt.record_key = json_array(OLD.namespace, OLD.quota_id, OLD.tenant_id))
      OR EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
        WHERE session.namespace = destination.namespace AND session.org_id = destination.org_id
          AND session.project_id = destination.project_id AND session.env_id = destination.env_id
          AND session.wallet_id = destination.wallet_id AND session.namespace = OLD.namespace
          AND session.tenant_id = OLD.tenant_id AND session.quota_id = OLD.quota_id
          AND session.wallet_session_id = OLD.wallet_session_id)
    ) AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_authorizations_v2_inactive_import_insert
BEFORE INSERT ON wallet_session_authorizations_v2
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
        AND context.table_name = 'wallet_session_authorizations_v2'
        AND context.record_key = json_array(NEW.authorization_id, NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.tenant_id)
    ))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_authorizations_v2_inactive_import_update
BEFORE UPDATE ON wallet_session_authorizations_v2
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')) OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_authorizations_v2_inactive_import_delete
BEFORE DELETE ON wallet_session_authorizations_v2
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_inactive_import_insert
BEFORE INSERT ON wallet_session_hosted_credentials_v2
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
        AND context.table_name = 'wallet_session_hosted_credentials_v2'
        AND context.record_key = json_array(NEW.env_id, NEW.hosted_credential_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.tenant_id)
    ))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_inactive_import_update
BEFORE UPDATE ON wallet_session_hosted_credentials_v2
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')) OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_inactive_import_delete
BEFORE DELETE ON wallet_session_hosted_credentials_v2
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_inactive_import_insert
BEFORE INSERT ON wallet_session_hosted_exchange_codes_v2
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
        AND context.table_name = 'wallet_session_hosted_exchange_codes_v2'
        AND context.record_key = json_array(NEW.env_id, NEW.exchange_code_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.tenant_id)
    ))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_inactive_import_update
BEFORE UPDATE ON wallet_session_hosted_exchange_codes_v2
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')) OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_inactive_import_delete
BEFORE DELETE ON wallet_session_hosted_exchange_codes_v2
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_intake_identity_immutable
BEFORE UPDATE ON wallet_relocation_authorization_intakes
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex OR NEW.source_generation IS NOT OLD.source_generation
  OR NEW.manifest_json IS NOT OLD.manifest_json OR OLD.state = 'verified'
  OR NEW.next_index < OLD.next_index OR NEW.next_index > OLD.next_index + 1
  OR NEW.record_count < OLD.record_count OR NEW.record_count > OLD.record_count + 1
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_intake_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_intake_chunk_immutable
BEFORE UPDATE ON wallet_relocation_authorization_intake_chunks
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_intake_chunk_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_intake_chunk_admission
BEFORE INSERT ON wallet_relocation_authorization_intake_chunks
WHEN NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_intakes AS intake
  WHERE intake.namespace = NEW.namespace AND intake.org_id = NEW.org_id
    AND intake.project_id = NEW.project_id AND intake.env_id = NEW.env_id
    AND intake.wallet_id = NEW.wallet_id AND intake.state = 'receiving'
    AND intake.next_index = NEW.chunk_index)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_intake_chunk_out_of_order'); END;

CREATE TRIGGER IF NOT EXISTS wallet_ceremony_activity_owner_immutable
BEFORE UPDATE ON wallet_ceremony_activity
WHEN NEW.wallet_id IS NOT OLD.wallet_id
BEGIN
  SELECT RAISE(ABORT, 'wallet_ceremony_owner_changed');
END;

CREATE TRIGGER IF NOT EXISTS wallet_ceremony_activity_retired_insert
BEFORE INSERT ON wallet_ceremony_activity
WHEN NEW.settled = 0 AND EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_ceremony_admission_closed');
END;

CREATE TRIGGER IF NOT EXISTS wallet_ceremony_activity_retired_update
BEFORE UPDATE ON wallet_ceremony_activity
WHEN NEW.settled = 0 AND EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_ceremony_admission_closed');
END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_sessions_require_settled_ceremonies
BEFORE INSERT ON wallet_relocation_session_fences
WHEN EXISTS (
  SELECT 1 FROM wallet_ceremony_activity AS activity
  WHERE activity.namespace = NEW.namespace AND activity.org_id = NEW.org_id
    AND activity.project_id = NEW.project_id AND activity.env_id = NEW.env_id
    AND activity.wallet_id = NEW.wallet_id AND activity.settled = 0
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_ceremonies_unsettled');
END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_activation_verified
BEFORE INSERT ON wallet_relocation_authorization_activations
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_intakes AS intake
  JOIN wallet_relocation_authorization_imports AS imported
    USING(namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE intake.namespace = NEW.namespace AND intake.org_id = NEW.org_id
    AND intake.project_id = NEW.project_id AND intake.env_id = NEW.env_id
    AND intake.wallet_id = NEW.wallet_id AND intake.move_id = NEW.move_id
    AND intake.request_digest_hex = NEW.request_digest_hex AND intake.source_generation = NEW.source_generation
    AND intake.state = 'verified' AND imported.state = 'closed' AND intake.manifest_json = NEW.manifest_json
) OR EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_activation_requires_verified_destination'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_activation_immutable
BEFORE UPDATE ON wallet_relocation_authorization_activations
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_activation_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_activation_retained
BEFORE DELETE ON wallet_relocation_authorization_activations
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_activation_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_import_activation_receipt
BEFORE UPDATE ON wallet_relocation_authorization_imports
WHEN NEW.state = 'activated' AND OLD.state != 'activated' AND NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_activations AS receipt
  WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
    AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
    AND receipt.wallet_id = NEW.wallet_id AND receipt.move_id = NEW.move_id
    AND receipt.request_digest_hex = NEW.request_digest_hex AND receipt.source_generation = NEW.source_generation
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_activation_receipt_required'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_cleanup_frozen
BEFORE INSERT ON wallet_relocation_authorization_cleanups
WHEN NEW.state != 'cleaning' OR NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_snapshots AS snapshot
  JOIN wallet_relocation_authorization_fences AS fence
    USING(namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE snapshot.namespace = NEW.namespace AND snapshot.org_id = NEW.org_id
    AND snapshot.project_id = NEW.project_id AND snapshot.env_id = NEW.env_id
    AND snapshot.wallet_id = NEW.wallet_id AND snapshot.move_id = NEW.move_id
    AND snapshot.request_digest_hex = NEW.request_digest_hex AND snapshot.source_generation = NEW.source_generation
    AND snapshot.state = 'sealed' AND snapshot.digest_hex = json_extract(NEW.manifest_json, '$.digestHex')
    AND snapshot.schema_json = json_extract(NEW.manifest_json, '$.schemaJson')
    AND snapshot.chunk_count = json_extract(NEW.manifest_json, '$.chunkCount')
    AND snapshot.record_count = json_extract(NEW.manifest_json, '$.recordCount')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_cleanup_requires_frozen_snapshot'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_cleanup_identity
BEFORE UPDATE ON wallet_relocation_authorization_cleanups
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex OR NEW.source_generation IS NOT OLD.source_generation
  OR NEW.command_digest IS NOT OLD.command_digest OR NEW.manifest_json IS NOT OLD.manifest_json
  OR (OLD.state = 'cleaned' AND (NEW.state IS NOT OLD.state OR NEW.completed_at_ms IS NOT OLD.completed_at_ms))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_cleanup_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_cleanup_retained
BEFORE DELETE ON wallet_relocation_authorization_cleanups
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_cleanup_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_authorization_receipt_retain
BEFORE DELETE ON wallet_relocation_authorization_import_receipts
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
  WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
    AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
    AND cleanup.wallet_id = OLD.wallet_id AND cleanup.state = 'cleaning'
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_receipt_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorities_frozen_delete
BEFORE DELETE ON wallet_authorities
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

CREATE TRIGGER IF NOT EXISTS wallet_session_authorizations_v2_frozen_delete
BEFORE DELETE ON wallet_session_authorizations_v2
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

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_credentials_v2_frozen_delete
BEFORE DELETE ON wallet_session_hosted_credentials_v2
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

CREATE TRIGGER IF NOT EXISTS wallet_session_hosted_exchange_codes_v2_frozen_delete
BEFORE DELETE ON wallet_session_hosted_exchange_codes_v2
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

CREATE TRIGGER IF NOT EXISTS wallet_authorization_chunk_delete
BEFORE DELETE ON wallet_relocation_authorization_chunks
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
  WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
    AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
    AND cleanup.wallet_id = OLD.wallet_id AND cleanup.state = 'cleaning'
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_chunk_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_intake_chunk_retained
BEFORE DELETE ON wallet_relocation_authorization_intake_chunks
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
  WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
    AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
    AND cleanup.wallet_id = OLD.wallet_id AND cleanup.state = 'cleaning'
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_chunk_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_sessions_require_settled_operations
BEFORE INSERT ON wallet_relocation_session_fences
WHEN EXISTS (
  SELECT 1 FROM wallet_pending_operations AS operation
  WHERE operation.namespace = NEW.namespace AND operation.org_id = NEW.org_id
    AND operation.project_id = NEW.project_id AND operation.env_id = NEW.env_id
    AND operation.wallet_id = NEW.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'wallet_operations_unsettled'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_evidence_immutable
BEFORE UPDATE ON verified_wallet_operation_evidence_sets
BEGIN SELECT RAISE(ABORT, 'wallet_operation_evidence_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_evidence_referenced_retained
BEFORE DELETE ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM authorized_operations AS operation
  WHERE operation.namespace = OLD.namespace AND operation.tenant_id = OLD.tenant_id
    AND operation.evidence_set_digest = OLD.evidence_set_digest
)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_evidence_referenced'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_evidence_retired_insert
BEFORE INSERT ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'authorization_evidence_claim_rejected'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_evidence_replace_identity
BEFORE INSERT ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM verified_wallet_operation_evidence_sets AS existing
  WHERE existing.namespace = NEW.namespace AND existing.tenant_id = NEW.tenant_id
    AND (existing.evidence_set_id = NEW.evidence_set_id OR existing.evidence_set_digest = NEW.evidence_set_digest)
    AND (existing.namespace, existing.org_id, existing.project_id,
         existing.env_id, existing.tenant_id, existing.evidence_set_id,
         existing.principal_id, existing.wallet_id, existing.authority_digest,
         existing.request_origin, existing.audience, existing.evidence_set_digest,
         existing.evidence_json, existing.capability_kind, existing.operation_kind,
         existing.lane_digest, existing.intent_digest, existing.display_digest,
         existing.assurance, existing.verified_at_ms, existing.expires_at_ms) IS NOT
        (NEW.namespace, NEW.org_id, NEW.project_id,
         NEW.env_id, NEW.tenant_id, NEW.evidence_set_id,
         NEW.principal_id, NEW.wallet_id, NEW.authority_digest,
         NEW.request_origin, NEW.audience, NEW.evidence_set_digest,
         NEW.evidence_json, NEW.capability_kind, NEW.operation_kind,
         NEW.lane_digest, NEW.intent_digest, NEW.display_digest,
         NEW.assurance, NEW.verified_at_ms, NEW.expires_at_ms)
)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_evidence_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_evidence_frozen_delete
BEFORE DELETE ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN (SELECT OLD.namespace, OLD.org_id, OLD.project_id, OLD.env_id, OLD.wallet_id) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id AND NOT EXISTS (
        SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
        WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id AND cleanup.project_id = fence.project_id
    AND cleanup.env_id = fence.env_id AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
    AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
          AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_evidence_inactive_insert
BEFORE INSERT ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  JOIN (SELECT NEW.namespace, NEW.org_id, NEW.project_id, NEW.env_id, NEW.wallet_id) AS selected ON selected.namespace = destination.namespace
    AND selected.org_id = destination.org_id AND selected.project_id = destination.project_id
    AND selected.env_id = destination.env_id AND selected.wallet_id = destination.wallet_id
  WHERE destination.state != 'activated'
) AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
    AND destination.project_id = context.project_id AND destination.env_id = context.env_id
    AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
    AND destination.request_digest_hex = context.request_digest_hex AND destination.source_generation = context.source_generation
      JOIN (SELECT NEW.namespace, NEW.org_id, NEW.project_id, NEW.env_id, NEW.wallet_id) AS selected ON selected.namespace = context.namespace
    AND selected.org_id = context.org_id AND selected.project_id = context.project_id AND selected.env_id = context.env_id
    AND selected.wallet_id = context.wallet_id
      WHERE destination.state = 'importing' AND context.table_name = 'verified_wallet_operation_evidence_sets'
        AND context.record_key = json_array(NEW.evidence_set_id, NEW.namespace, NEW.tenant_id)
    )
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operations_frozen_insert
BEFORE INSERT ON authorized_operations
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id))) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id
)
BEGIN
  SELECT CASE WHEN NEW.authorization_source_kind = 'verified_step_up'
    THEN RAISE(ABORT, 'authorization_evidence_claim_rejected')
    ELSE RAISE(ABORT, 'authorization_wallet_session_rejected') END;
END;

CREATE TRIGGER IF NOT EXISTS wallet_operations_frozen_delete
BEFORE DELETE ON authorized_operations
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = OLD.namespace AND owner.tenant_id = OLD.tenant_id
            AND owner.source_kind = OLD.authorization_source_kind
            AND owner.source_id = CASE OLD.authorization_source_kind
              WHEN 'authorization_grant' THEN OLD.authorization_id ELSE OLD.evidence_set_digest END
            AND (OLD.authorization_source_kind = 'verified_step_up' OR
              (OLD.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = OLD.owner_scope_org_id AND owner.project_id = OLD.owner_scope_project_id
                AND owner.env_id = OLD.owner_scope_env_id))) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id AND NOT EXISTS (
        SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
        WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id AND cleanup.project_id = fence.project_id
    AND cleanup.env_id = fence.env_id AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
    AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
          AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operations_inactive_insert
BEFORE INSERT ON authorized_operations
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id))) AS selected ON selected.namespace = destination.namespace
    AND selected.org_id = destination.org_id AND selected.project_id = destination.project_id
    AND selected.env_id = destination.env_id AND selected.wallet_id = destination.wallet_id
  WHERE destination.state != 'activated'
) AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
    AND destination.project_id = context.project_id AND destination.env_id = context.env_id
    AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
    AND destination.request_digest_hex = context.request_digest_hex AND destination.source_generation = context.source_generation
      JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id))) AS selected ON selected.namespace = context.namespace
    AND selected.org_id = context.org_id AND selected.project_id = context.project_id AND selected.env_id = context.env_id
    AND selected.wallet_id = context.wallet_id
      WHERE destination.state = 'importing' AND context.table_name = 'authorized_operations'
        AND context.record_key = json_array(NEW.authorized_operation_id, NEW.namespace, NEW.tenant_id)
    )
BEGIN
  SELECT CASE WHEN NEW.lifecycle_kind != 'claimed'
    THEN RAISE(ABORT, 'wallet_authorization_destination_inactive')
    WHEN NEW.authorization_source_kind = 'verified_step_up'
    THEN RAISE(ABORT, 'authorization_evidence_claim_rejected')
    ELSE RAISE(ABORT, 'authorization_wallet_session_rejected') END;
END;

CREATE TRIGGER IF NOT EXISTS wallet_operations_historical_insert
BEFORE INSERT ON authorized_operations
WHEN NEW.lifecycle_kind = 'completed' AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
    AND destination.project_id = context.project_id AND destination.env_id = context.env_id
    AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
    AND destination.request_digest_hex = context.request_digest_hex AND destination.source_generation = context.source_generation
      JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id))) AS selected ON selected.namespace = context.namespace
    AND selected.org_id = context.org_id AND selected.project_id = context.project_id AND selected.env_id = context.env_id
    AND selected.wallet_id = context.wallet_id
      WHERE destination.state = 'importing' AND context.table_name = 'authorized_operations'
        AND context.record_key = json_array(NEW.authorized_operation_id, NEW.namespace, NEW.tenant_id)
    )
BEGIN SELECT RAISE(ABORT, 'wallet_operation_history_import_required'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_audits_frozen_insert
BEFORE INSERT ON authorized_operation_audit_events
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_owners AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.authorized_operation_id = NEW.authorized_operation_id) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_audits_frozen_delete
BEFORE DELETE ON authorized_operation_audit_events
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_owners AS owner
          WHERE owner.namespace = OLD.namespace AND owner.tenant_id = OLD.tenant_id
            AND owner.authorized_operation_id = OLD.authorized_operation_id) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id AND NOT EXISTS (
        SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
        WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id AND cleanup.project_id = fence.project_id
    AND cleanup.env_id = fence.env_id AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
    AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
          AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_audits_inactive_insert
BEFORE INSERT ON authorized_operation_audit_events
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_owners AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id

    AND owner.authorized_operation_id = NEW.authorized_operation_id) AS selected ON selected.namespace = destination.namespace
    AND selected.org_id = destination.org_id AND selected.project_id = destination.project_id
    AND selected.env_id = destination.env_id AND selected.wallet_id = destination.wallet_id
  WHERE destination.state != 'activated'
) AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
    AND destination.project_id = context.project_id AND destination.env_id = context.env_id
    AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
    AND destination.request_digest_hex = context.request_digest_hex AND destination.source_generation = context.source_generation
      JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_owners AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.authorized_operation_id = NEW.authorized_operation_id) AS selected ON selected.namespace = context.namespace
    AND selected.org_id = context.org_id AND selected.project_id = context.project_id AND selected.env_id = context.env_id
    AND selected.wallet_id = context.wallet_id
      WHERE destination.state = 'importing' AND context.table_name = 'authorized_operation_audit_events'
        AND context.record_key = json_array(NEW.audit_event_id, NEW.namespace, NEW.tenant_id)
    )
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_audits_historical_insert
BEFORE INSERT ON authorized_operation_audit_events
WHEN NEW.result_kind != 'pending' AND NOT EXISTS (
      SELECT 1 FROM wallet_relocation_authorization_import_context AS context
      JOIN wallet_relocation_authorization_imports AS destination
        ON destination.namespace = context.namespace AND destination.org_id = context.org_id
    AND destination.project_id = context.project_id AND destination.env_id = context.env_id
    AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
    AND destination.request_digest_hex = context.request_digest_hex AND destination.source_generation = context.source_generation
      JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_owners AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.authorized_operation_id = NEW.authorized_operation_id) AS selected ON selected.namespace = context.namespace
    AND selected.org_id = context.org_id AND selected.project_id = context.project_id AND selected.env_id = context.env_id
    AND selected.wallet_id = context.wallet_id
      WHERE destination.state = 'importing' AND context.table_name = 'authorized_operation_audit_events'
        AND context.record_key = json_array(NEW.audit_event_id, NEW.namespace, NEW.tenant_id)
    )
BEGIN SELECT RAISE(ABORT, 'wallet_operation_history_import_required'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operations_owner_required
BEFORE INSERT ON authorized_operations
WHEN NOT EXISTS (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id)))
BEGIN SELECT RAISE(ABORT, 'wallet_operation_owner_missing'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_audit_parent
BEFORE INSERT ON authorized_operation_audit_events
WHEN NOT EXISTS (SELECT 1 FROM authorized_operations AS operation
  WHERE operation.namespace IS NEW.namespace
    AND operation.tenant_id IS NEW.tenant_id
    AND operation.audit_event_id IS NEW.audit_event_id
    AND operation.authorized_operation_id IS NEW.authorized_operation_id
    AND operation.operation_fingerprint_digest IS NEW.operation_fingerprint_digest
    AND operation.authorization_source_kind IS NEW.authorization_source_kind
    AND operation.authorization_id IS NEW.authorization_id
    AND operation.authorization_grant_kind IS NEW.authorization_grant_kind
    AND operation.evidence_set_digest IS NEW.evidence_set_digest
    AND operation.quota_id IS NEW.quota_id
    AND operation.material_activation_id IS NEW.material_activation_id
    AND operation.material_activation_capability IS NEW.material_activation_capability
    AND operation.material_activation_owner IS NEW.material_activation_owner
    AND operation.material_activation_key_binding IS NEW.material_activation_key_binding
    AND operation.material_activation_lifecycle_binding IS NEW.material_activation_lifecycle_binding
    AND operation.material_activation_signing_worker IS NEW.material_activation_signing_worker
    AND operation.owner_scope_org_id IS NEW.owner_scope_org_id
    AND operation.owner_scope_project_id IS NEW.owner_scope_project_id
    AND operation.owner_scope_env_id IS NEW.owner_scope_env_id
    AND operation.result_kind IS NEW.result_kind
    AND operation.claimed_at_ms IS NEW.claimed_at_ms
    AND operation.completed_at_ms IS NEW.completed_at_ms)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_audit_parent_conflicts'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_terminal_immutable
BEFORE UPDATE ON authorized_operations
WHEN OLD.lifecycle_kind = 'completed'
BEGIN SELECT RAISE(ABORT, 'wallet_operation_terminal_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_audit_terminal_immutable
BEFORE UPDATE ON authorized_operation_audit_events
WHEN OLD.result_kind != 'pending'
BEGIN SELECT RAISE(ABORT, 'wallet_operation_terminal_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_identity_immutable
BEFORE UPDATE ON authorized_operations
WHEN NEW.namespace IS NOT OLD.namespace
  OR NEW.tenant_id IS NOT OLD.tenant_id
  OR NEW.authorized_operation_id IS NOT OLD.authorized_operation_id
  OR NEW.audit_event_id IS NOT OLD.audit_event_id
  OR NEW.principal_id IS NOT OLD.principal_id
  OR NEW.capability_id IS NOT OLD.capability_id
  OR NEW.capability_kind IS NOT OLD.capability_kind
  OR NEW.operation_kind IS NOT OLD.operation_kind
  OR NEW.operation_id IS NOT OLD.operation_id
  OR NEW.operation_fingerprint_digest IS NOT OLD.operation_fingerprint_digest
  OR NEW.lane_digest IS NOT OLD.lane_digest
  OR NEW.intent_digest IS NOT OLD.intent_digest
  OR NEW.display_digest IS NOT OLD.display_digest
  OR NEW.authorization_source_kind IS NOT OLD.authorization_source_kind
  OR NEW.authorization_id IS NOT OLD.authorization_id
  OR NEW.authorization_grant_kind IS NOT OLD.authorization_grant_kind
  OR NEW.evidence_set_digest IS NOT OLD.evidence_set_digest
  OR NEW.quota_id IS NOT OLD.quota_id
  OR NEW.quota_kind IS NOT OLD.quota_kind
  OR NEW.claimed_at_ms IS NOT OLD.claimed_at_ms
  OR NEW.material_activation_id IS NOT OLD.material_activation_id
  OR NEW.material_activation_capability IS NOT OLD.material_activation_capability
  OR NEW.material_activation_owner IS NOT OLD.material_activation_owner
  OR NEW.material_activation_key_binding IS NOT OLD.material_activation_key_binding
  OR NEW.material_activation_lifecycle_binding IS NOT OLD.material_activation_lifecycle_binding
  OR NEW.material_activation_signing_worker IS NOT OLD.material_activation_signing_worker
  OR NEW.owner_scope_org_id IS NOT OLD.owner_scope_org_id
  OR NEW.owner_scope_project_id IS NOT OLD.owner_scope_project_id
  OR NEW.owner_scope_env_id IS NOT OLD.owner_scope_env_id
BEGIN SELECT RAISE(ABORT, 'wallet_operation_identity_immutable'); END;

CREATE TRIGGER IF NOT EXISTS authorized_operation_step_up_claim_atomic
AFTER INSERT ON authorized_operations
WHEN NEW.lifecycle_kind = 'claimed'
  AND NEW.authorization_source_kind = 'verified_step_up'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
        SELECT 1
          FROM verified_wallet_operation_evidence_sets AS evidence
         WHERE evidence.namespace = NEW.namespace
           AND evidence.tenant_id = NEW.tenant_id
           AND evidence.evidence_set_digest = NEW.evidence_set_digest
           AND evidence.principal_id = NEW.principal_id
           AND evidence.capability_kind = NEW.capability_kind
           AND evidence.operation_kind = NEW.operation_kind
           AND evidence.lane_digest = NEW.lane_digest
           AND evidence.intent_digest = NEW.intent_digest
           AND evidence.display_digest = NEW.display_digest
           AND evidence.assurance = 'step_up'
           AND NOT EXISTS (
             SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt
             WHERE receipt.namespace = evidence.namespace AND receipt.org_id = evidence.org_id
               AND receipt.project_id = evidence.project_id AND receipt.env_id = evidence.env_id
               AND receipt.wallet_id = evidence.wallet_id AND receipt.table_name = 'verified_wallet_operation_evidence_sets'
               AND receipt.record_key = json_array(evidence.evidence_set_id, evidence.namespace, evidence.tenant_id)
           )
           AND NOT EXISTS (
             SELECT 1 FROM wallet_relocation_session_fences AS fence
             WHERE fence.namespace = evidence.namespace AND fence.org_id = evidence.org_id
               AND fence.project_id = evidence.project_id AND fence.env_id = evidence.env_id
               AND fence.wallet_id = evidence.wallet_id
           )
           AND evidence.expires_at_ms > NEW.claimed_at_ms
           -- The database clock closes delays between verification and this write.
           AND evidence.expires_at_ms > CAST(round(unixepoch('subsec') * 1000) AS INTEGER)
      )
    THEN RAISE(ABORT, 'authorization_evidence_claim_rejected')
  END;
END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_authorization_fences_operation_history_complete
BEFORE INSERT ON wallet_relocation_authorization_fences
WHEN 1 AND EXISTS (
  SELECT 1 FROM wallet_operation_owners AS owner
  JOIN authorized_operations AS operation USING(namespace, tenant_id, authorized_operation_id)
  WHERE owner.namespace = NEW.namespace AND owner.org_id = NEW.org_id AND owner.project_id = NEW.project_id
    AND owner.env_id = NEW.env_id AND owner.wallet_id = NEW.wallet_id
    AND (operation.lifecycle_kind != 'completed' OR NOT EXISTS (
      SELECT 1 FROM authorized_operation_audit_events AS audit
      WHERE audit.namespace IS operation.namespace
        AND audit.tenant_id IS operation.tenant_id
        AND audit.audit_event_id IS operation.audit_event_id
        AND audit.authorized_operation_id IS operation.authorized_operation_id
        AND audit.operation_fingerprint_digest IS operation.operation_fingerprint_digest
        AND audit.authorization_source_kind IS operation.authorization_source_kind
        AND audit.authorization_id IS operation.authorization_id
        AND audit.authorization_grant_kind IS operation.authorization_grant_kind
        AND audit.evidence_set_digest IS operation.evidence_set_digest
        AND audit.quota_id IS operation.quota_id
        AND audit.material_activation_id IS operation.material_activation_id
        AND audit.material_activation_capability IS operation.material_activation_capability
        AND audit.material_activation_owner IS operation.material_activation_owner
        AND audit.material_activation_key_binding IS operation.material_activation_key_binding
        AND audit.material_activation_lifecycle_binding IS operation.material_activation_lifecycle_binding
        AND audit.material_activation_signing_worker IS operation.material_activation_signing_worker
        AND audit.owner_scope_org_id IS operation.owner_scope_org_id
        AND audit.owner_scope_project_id IS operation.owner_scope_project_id
        AND audit.owner_scope_env_id IS operation.owner_scope_env_id
        AND audit.result_kind IS operation.result_kind
        AND audit.claimed_at_ms IS operation.claimed_at_ms
        AND audit.completed_at_ms IS operation.completed_at_ms
    ))
)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_history_incomplete'); END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_authorization_imports_operation_history_complete
BEFORE UPDATE ON wallet_relocation_authorization_imports
WHEN NEW.state = 'closed' AND OLD.state = 'importing' AND EXISTS (
  SELECT 1 FROM wallet_operation_owners AS owner
  JOIN authorized_operations AS operation USING(namespace, tenant_id, authorized_operation_id)
  WHERE owner.namespace = NEW.namespace AND owner.org_id = NEW.org_id AND owner.project_id = NEW.project_id
    AND owner.env_id = NEW.env_id AND owner.wallet_id = NEW.wallet_id
    AND (operation.lifecycle_kind != 'completed' OR NOT EXISTS (
      SELECT 1 FROM authorized_operation_audit_events AS audit
      WHERE audit.namespace IS operation.namespace
        AND audit.tenant_id IS operation.tenant_id
        AND audit.audit_event_id IS operation.audit_event_id
        AND audit.authorized_operation_id IS operation.authorized_operation_id
        AND audit.operation_fingerprint_digest IS operation.operation_fingerprint_digest
        AND audit.authorization_source_kind IS operation.authorization_source_kind
        AND audit.authorization_id IS operation.authorization_id
        AND audit.authorization_grant_kind IS operation.authorization_grant_kind
        AND audit.evidence_set_digest IS operation.evidence_set_digest
        AND audit.quota_id IS operation.quota_id
        AND audit.material_activation_id IS operation.material_activation_id
        AND audit.material_activation_capability IS operation.material_activation_capability
        AND audit.material_activation_owner IS operation.material_activation_owner
        AND audit.material_activation_key_binding IS operation.material_activation_key_binding
        AND audit.material_activation_lifecycle_binding IS operation.material_activation_lifecycle_binding
        AND audit.material_activation_signing_worker IS operation.material_activation_signing_worker
        AND audit.owner_scope_org_id IS operation.owner_scope_org_id
        AND audit.owner_scope_project_id IS operation.owner_scope_project_id
        AND audit.owner_scope_env_id IS operation.owner_scope_env_id
        AND audit.result_kind IS operation.result_kind
        AND audit.claimed_at_ms IS operation.claimed_at_ms
        AND audit.completed_at_ms IS operation.completed_at_ms
    ))
)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_history_incomplete'); END;

CREATE TRIGGER IF NOT EXISTS wallet_execution_identity_immutable
BEFORE UPDATE ON wallet_execution_generations
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.generation IS NOT OLD.generation
  OR NEW.origin IS NOT OLD.origin OR NEW.origin_id IS NOT OLD.origin_id
  OR (NEW.state != OLD.state AND NOT (
    (OLD.state = 'registering' AND NEW.state IN ('active', 'retired')) OR
    (OLD.state = 'inactive' AND NEW.state = 'active') OR
    (OLD.state = 'active' AND NEW.state = 'retired')))
BEGIN SELECT RAISE(ABORT, 'wallet_execution_identity_conflicts'); END;

CREATE TRIGGER IF NOT EXISTS wallet_execution_activation_receipt
BEFORE UPDATE ON wallet_execution_generations
WHEN OLD.state = 'inactive' AND NEW.state = 'active' AND NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_imports AS imported
  JOIN wallet_relocation_authorization_activations AS receipt
    USING(namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE imported.namespace = NEW.namespace AND imported.org_id = NEW.org_id
    AND imported.project_id = NEW.project_id AND imported.env_id = NEW.env_id
    AND imported.wallet_id = NEW.wallet_id AND imported.move_id = NEW.origin_id
    AND imported.source_generation + 1 = NEW.generation AND imported.state = 'activated'
)
BEGIN SELECT RAISE(ABORT, 'wallet_execution_activation_receipt_required'); END;

CREATE TRIGGER IF NOT EXISTS wallet_execution_source_closed
BEFORE INSERT ON wallet_execution_generations
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'wallet_execution_source_closed'); END;

CREATE TRIGGER IF NOT EXISTS wallet_execution_destination_prepare
AFTER INSERT ON wallet_relocation_authorization_imports
BEGIN
  INSERT INTO wallet_execution_generations
    (namespace, org_id, project_id, env_id, wallet_id, generation, origin, origin_id, state)
  VALUES (NEW.namespace, NEW.org_id, NEW.project_id, NEW.env_id, NEW.wallet_id,
    NEW.source_generation + 1, 'relocation', NEW.move_id, 'inactive');
END;

CREATE TRIGGER IF NOT EXISTS wallet_execution_destination_activate
AFTER UPDATE ON wallet_relocation_authorization_imports
WHEN NEW.state = 'activated' AND OLD.state != 'activated'
BEGIN
  UPDATE wallet_execution_generations SET state = 'active'
  WHERE namespace = NEW.namespace AND org_id = NEW.org_id AND project_id = NEW.project_id
    AND env_id = NEW.env_id AND wallet_id = NEW.wallet_id
    AND generation = NEW.source_generation + 1 AND origin = 'relocation'
    AND origin_id = NEW.move_id AND state = 'inactive';
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'wallet_execution_destination_conflicts') END;
END;

CREATE TRIGGER IF NOT EXISTS wallet_execution_source_retire
AFTER INSERT ON wallet_relocation_session_fences
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM wallet_execution_generations
    WHERE namespace = NEW.namespace AND org_id = NEW.org_id AND project_id = NEW.project_id
      AND env_id = NEW.env_id AND wallet_id = NEW.wallet_id
      AND (generation != NEW.source_generation OR state != 'active')
  ) THEN RAISE(ABORT, 'wallet_execution_source_conflicts') END;
  UPDATE wallet_execution_generations SET state = 'retired'
  WHERE namespace = NEW.namespace AND org_id = NEW.org_id AND project_id = NEW.project_id
    AND env_id = NEW.env_id AND wallet_id = NEW.wallet_id;
END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_execution_generation_required
BEFORE INSERT ON authorized_operations
WHEN NEW.lifecycle_kind = 'claimed' AND NOT EXISTS (
  SELECT 1 FROM wallet_operation_authorizations AS owner
  JOIN wallet_execution_generations AS execution
    USING(namespace, org_id, project_id, env_id, wallet_id)
  WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
    AND owner.source_kind = NEW.authorization_source_kind
    AND owner.source_id = CASE NEW.authorization_source_kind
      WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
    AND (NEW.authorization_source_kind = 'verified_step_up' OR
      (NEW.authorization_grant_kind = 'wallet_session_authorization'
       AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
       AND owner.env_id = NEW.owner_scope_env_id))
    AND execution.state = 'active' AND execution.generation = NEW.ownership_generation
)
BEGIN
  SELECT CASE WHEN NEW.authorization_source_kind = 'verified_step_up'
    THEN RAISE(ABORT, 'authorization_evidence_claim_rejected')
    ELSE RAISE(ABORT, 'authorization_wallet_session_rejected') END;
END;

CREATE TRIGGER IF NOT EXISTS wallet_operation_execution_generation_immutable
BEFORE UPDATE ON authorized_operations
WHEN NEW.ownership_generation IS NOT OLD.ownership_generation
BEGIN SELECT RAISE(ABORT, 'wallet_operation_execution_generation_immutable'); END;

CREATE TRIGGER IF NOT EXISTS regional_deployment_admission_monotonic
BEFORE UPDATE ON regional_deployment_admissions
WHEN NEW.deployment_lane IS NOT OLD.deployment_lane OR NEW.namespace IS NOT OLD.namespace
  OR NEW.account_id IS NOT OLD.account_id OR NEW.database_id IS NOT OLD.database_id
  OR NEW.activation_sequence < OLD.activation_sequence
  OR (NEW.activation_sequence = OLD.activation_sequence AND OLD.state = 'active' AND (
    NEW.state != 'active' OR NEW.binding_revision IS NOT OLD.binding_revision
    OR NEW.binding_json IS NOT OLD.binding_json
    OR NEW.resource_verifications_json IS NOT OLD.resource_verifications_json))
  OR (NEW.activation_sequence > OLD.activation_sequence AND NEW.state != 'prepared')
BEGIN SELECT RAISE(ABORT, 'regional_deployment_admission_conflict'); END;

CREATE TRIGGER IF NOT EXISTS regional_deployment_admission_retained
BEFORE DELETE ON regional_deployment_admissions
BEGIN SELECT RAISE(ABORT, 'regional_deployment_admission_retained'); END;

CREATE TRIGGER IF NOT EXISTS regional_deployment_write_authorized
BEFORE INSERT ON regional_deployment_write_checks
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM regional_deployment_admissions AS admission,
      json_each(admission.resource_verifications_json) AS proof
    WHERE admission.deployment_lane = NEW.deployment_lane
      AND admission.namespace = NEW.namespace
      AND admission.account_id = NEW.account_id AND admission.database_id = NEW.database_id
      AND admission.binding_revision = NEW.binding_revision AND admission.state = 'active'
      AND json_extract(proof.value, '$.resource.accountId') = NEW.account_id
      AND json_extract(proof.value, '$.resource.databaseId') = NEW.database_id
      AND json_extract(proof.value, '$.authority.kind') = 'cloudflare'
      AND json_extract(proof.value, '$.authority.' || NEW.writer_role || '.versionId') = NEW.writer_version
  ) THEN RAISE(ABORT, 'regional_deployment_writer_retired') END;
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER IF NOT EXISTS wallet_registration_completion_immutable
BEFORE UPDATE ON wallet_execution_generations
WHEN (OLD.registration_completion != 'pending'
      AND NEW.registration_completion != OLD.registration_completion)
  OR (NEW.registration_completion != 'pending' AND NEW.origin != 'registration')
  OR (NEW.registration_completion = 'cancelled' AND NEW.state != 'retired')
  OR (NEW.registration_completion = 'established' AND NEW.state = 'inactive')
BEGIN SELECT RAISE(ABORT, 'wallet_registration_completion_conflicts'); END;

CREATE TRIGGER IF NOT EXISTS registration_cancelled_insert_fence
BEFORE INSERT ON registration_ceremony_records
WHEN NEW.record_scope IN ('ceremony', 'setup-ceremony') AND EXISTS (
  SELECT 1 FROM wallet_execution_generations AS execution
  WHERE execution.namespace = NEW.namespace AND execution.org_id = NEW.org_id
    AND execution.project_id = NEW.project_id AND execution.env_id = NEW.env_id
    AND execution.origin = 'registration'
    AND execution.origin_id = json_extract(NEW.record_json, '$.registrationCeremonyId')
    AND execution.registration_completion = 'cancelled'
)
BEGIN SELECT RAISE(ABORT, 'registration_cancelled'); END;

CREATE TRIGGER IF NOT EXISTS registration_cancelled_update_fence
BEFORE UPDATE ON registration_ceremony_records
WHEN OLD.record_scope IN ('ceremony', 'setup-ceremony') AND EXISTS (
  SELECT 1 FROM wallet_execution_generations AS execution
  WHERE execution.namespace = OLD.namespace AND execution.org_id = OLD.org_id
    AND execution.project_id = OLD.project_id AND execution.env_id = OLD.env_id
    AND execution.origin = 'registration'
    AND execution.origin_id = json_extract(OLD.record_json, '$.registrationCeremonyId')
    AND execution.registration_completion = 'cancelled'
)
BEGIN SELECT RAISE(ABORT, 'registration_cancelled'); END;

CREATE TRIGGER IF NOT EXISTS cancelled_registration_session_insert_fence
BEFORE INSERT ON wallet_session_authorizations_v2
WHEN EXISTS (
  SELECT 1 FROM wallet_execution_generations AS execution
  WHERE execution.namespace = NEW.namespace AND execution.org_id = NEW.org_id
    AND execution.project_id = NEW.project_id AND execution.env_id = NEW.env_id
    AND execution.wallet_id = NEW.wallet_id
    AND execution.registration_completion = 'cancelled'
)
BEGIN SELECT RAISE(ABORT, 'registration_cancelled'); END;

CREATE TRIGGER IF NOT EXISTS router_ab_yao_versioned_json_records_relocation_frozen_insert
BEFORE INSERT ON router_ab_yao_versioned_json_records
WHEN (substr(NEW.record_key, 1, 17) = 'passkey-envelope:' OR substr(NEW.record_key, 1, 28) = 'passkey-credential-activity:') AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = json_extract(NEW.record_json, '$.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS router_ab_yao_versioned_json_records_relocation_frozen_update
BEFORE UPDATE ON router_ab_yao_versioned_json_records
WHEN (substr(OLD.record_key, 1, 17) = 'passkey-envelope:' OR substr(OLD.record_key, 1, 28) = 'passkey-credential-activity:') AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = json_extract(OLD.record_json, '$.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS router_ab_yao_versioned_json_records_relocation_frozen_delete
BEFORE DELETE ON router_ab_yao_versioned_json_records
WHEN (substr(OLD.record_key, 1, 17) = 'passkey-envelope:' OR substr(OLD.record_key, 1, 28) = 'passkey-credential-activity:') AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = json_extract(OLD.record_json, '$.walletId')
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex
        AND cleanup.source_generation = fence.source_generation AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS router_ab_yao_versioned_json_records_relocation_inactive_insert
BEFORE INSERT ON router_ab_yao_versioned_json_records
WHEN (substr(NEW.record_key, 1, 17) = 'passkey-envelope:' OR substr(NEW.record_key, 1, 28) = 'passkey-credential-activity:') AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = json_extract(NEW.record_json, '$.walletId') AND destination.state != 'activated')
  AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
    AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
    AND context.wallet_id = json_extract(NEW.record_json, '$.walletId')
      AND destination.state = 'importing' AND context.table_name = 'router_ab_yao_versioned_json_records'
      AND context.record_key = json_array(NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.record_key))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS router_ab_yao_versioned_json_records_relocation_inactive_update
BEFORE UPDATE ON router_ab_yao_versioned_json_records
WHEN (substr(OLD.record_key, 1, 17) = 'passkey-envelope:' OR substr(OLD.record_key, 1, 28) = 'passkey-credential-activity:') AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = json_extract(OLD.record_json, '$.walletId') AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS router_ab_yao_versioned_json_records_relocation_inactive_delete
BEFORE DELETE ON router_ab_yao_versioned_json_records
WHEN (substr(OLD.record_key, 1, 17) = 'passkey-envelope:' OR substr(OLD.record_key, 1, 28) = 'passkey-credential-activity:') AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = json_extract(OLD.record_json, '$.walletId') AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS router_ab_yao_versioned_json_records_relocation_owner_immutable
BEFORE UPDATE ON router_ab_yao_versioned_json_records
WHEN (substr(OLD.record_key, 1, 17) = 'passkey-envelope:' OR substr(OLD.record_key, 1, 28) = 'passkey-credential-activity:') AND (NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR json_extract(NEW.record_json, '$.walletId') IS NOT json_extract(OLD.record_json, '$.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER IF NOT EXISTS wallets_relocation_frozen_insert
BEFORE INSERT ON wallets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallets_relocation_frozen_update
BEFORE UPDATE ON wallets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallets_relocation_frozen_delete
BEFORE DELETE ON wallets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex
        AND cleanup.source_generation = fence.source_generation AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallets_relocation_inactive_insert
BEFORE INSERT ON wallets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated')
  AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
    AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
    AND context.wallet_id = NEW.wallet_id
      AND destination.state = 'importing' AND context.table_name = 'wallets'
      AND context.record_key = json_array(NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.wallet_id))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallets_relocation_inactive_update
BEFORE UPDATE ON wallets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallets_relocation_inactive_delete
BEFORE DELETE ON wallets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallets_relocation_owner_immutable
BEFORE UPDATE ON wallets
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER IF NOT EXISTS wallet_signers_relocation_frozen_insert
BEFORE INSERT ON wallet_signers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_signers_relocation_frozen_update
BEFORE UPDATE ON wallet_signers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_signers_relocation_frozen_delete
BEFORE DELETE ON wallet_signers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex
        AND cleanup.source_generation = fence.source_generation AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_signers_relocation_inactive_insert
BEFORE INSERT ON wallet_signers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated')
  AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
    AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
    AND context.wallet_id = NEW.wallet_id
      AND destination.state = 'importing' AND context.table_name = 'wallet_signers'
      AND context.record_key = json_array(NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.signer_family, NEW.signer_id, NEW.wallet_id))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_signers_relocation_inactive_update
BEFORE UPDATE ON wallet_signers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_signers_relocation_inactive_delete
BEFORE DELETE ON wallet_signers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_signers_relocation_owner_immutable
BEFORE UPDATE ON wallet_signers
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_credential_bindings_relocation_frozen_insert
BEFORE INSERT ON webauthn_credential_bindings
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_credential_bindings_relocation_frozen_update
BEFORE UPDATE ON webauthn_credential_bindings
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.user_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_credential_bindings_relocation_frozen_delete
BEFORE DELETE ON webauthn_credential_bindings
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.user_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex
        AND cleanup.source_generation = fence.source_generation AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_credential_bindings_relocation_inactive_insert
BEFORE INSERT ON webauthn_credential_bindings
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = NEW.user_id AND destination.state != 'activated')
  AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
    AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
    AND context.wallet_id = NEW.user_id
      AND destination.state = 'importing' AND context.table_name = 'webauthn_credential_bindings'
      AND context.record_key = json_array(NEW.credential_id_b64u, NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.rp_id))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_credential_bindings_relocation_inactive_update
BEFORE UPDATE ON webauthn_credential_bindings
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.user_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_credential_bindings_relocation_inactive_delete
BEFORE DELETE ON webauthn_credential_bindings
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.user_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_credential_bindings_relocation_owner_immutable
BEFORE UPDATE ON webauthn_credential_bindings
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.user_id IS NOT OLD.user_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_authenticators_relocation_frozen_insert
BEFORE INSERT ON webauthn_authenticators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_authenticators_relocation_frozen_update
BEFORE UPDATE ON webauthn_authenticators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.user_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_authenticators_relocation_frozen_delete
BEFORE DELETE ON webauthn_authenticators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.user_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex
        AND cleanup.source_generation = fence.source_generation AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_authenticators_relocation_inactive_insert
BEFORE INSERT ON webauthn_authenticators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = NEW.user_id AND destination.state != 'activated')
  AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
    AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
    AND context.wallet_id = NEW.user_id
      AND destination.state = 'importing' AND context.table_name = 'webauthn_authenticators'
      AND context.record_key = json_array(NEW.credential_id_b64u, NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.user_id))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_authenticators_relocation_inactive_update
BEFORE UPDATE ON webauthn_authenticators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.user_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_authenticators_relocation_inactive_delete
BEFORE DELETE ON webauthn_authenticators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.user_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS webauthn_authenticators_relocation_owner_immutable
BEFORE UPDATE ON webauthn_authenticators
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.user_id IS NOT OLD.user_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER IF NOT EXISTS wallet_email_otp_rate_limits_relocation_frozen_insert
BEFORE INSERT ON wallet_email_otp_rate_limits
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_email_otp_rate_limits_relocation_frozen_update
BEFORE UPDATE ON wallet_email_otp_rate_limits
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_email_otp_rate_limits_relocation_frozen_delete
BEFORE DELETE ON wallet_email_otp_rate_limits
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex
        AND cleanup.source_generation = fence.source_generation AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_email_otp_rate_limits_relocation_inactive_insert
BEFORE INSERT ON wallet_email_otp_rate_limits
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated')
  AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
    AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
    AND context.wallet_id = NEW.wallet_id
      AND destination.state = 'importing' AND context.table_name = 'wallet_email_otp_rate_limits'
      AND context.record_key = json_array(NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.rate_key, NEW.wallet_id))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_email_otp_rate_limits_relocation_inactive_update
BEFORE UPDATE ON wallet_email_otp_rate_limits
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_email_otp_rate_limits_relocation_inactive_delete
BEFORE DELETE ON wallet_email_otp_rate_limits
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_email_otp_rate_limits_relocation_owner_immutable
BEFORE UPDATE ON wallet_email_otp_rate_limits
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.rate_key IS NOT OLD.rate_key
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_sessions_relocation_insert
BEFORE INSERT ON linked_device_sessions
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = json_extract(NEW.record_json, '$.claimTranscript.value.walletId')))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = json_extract(NEW.record_json, '$.claimTranscript.value.walletId') AND destination.state != 'activated') AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = json_extract(NEW.record_json, '$.claimTranscript.value.walletId')
      AND context.table_name = 'linked_device_sessions' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_sessions_relocation_update
BEFORE UPDATE ON linked_device_sessions
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId')))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId') AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId') AND receipt.table_name = 'linked_device_sessions' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = json_extract(NEW.record_json, '$.claimTranscript.value.walletId')))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = json_extract(NEW.record_json, '$.claimTranscript.value.walletId') AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
      AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
      AND receipt.wallet_id = json_extract(NEW.record_json, '$.claimTranscript.value.walletId') AND receipt.table_name = 'linked_device_sessions' AND receipt.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_sessions_relocation_delete
BEFORE DELETE ON linked_device_sessions
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId')) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId') AND cleanup.state = 'cleaning'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId') AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId') AND receipt.table_name = 'linked_device_sessions' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId') AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_authority_allocations_relocation_insert
BEFORE INSERT ON linked_device_authority_allocations
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
      AND context.table_name = 'linked_device_authority_allocations' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_authority_allocations_relocation_update
BEFORE UPDATE ON linked_device_authority_allocations
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_authority_allocations' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
      AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
      AND receipt.wallet_id = NEW.wallet_id AND receipt.table_name = 'linked_device_authority_allocations' AND receipt.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_authority_allocations_relocation_delete
BEFORE DELETE ON linked_device_authority_allocations
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
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_authority_allocations' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
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

CREATE TRIGGER IF NOT EXISTS linked_device_authority_installations_relocation_insert
BEFORE INSERT ON linked_device_authority_installations
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
      AND context.table_name = 'linked_device_authority_installations' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_authority_installations_relocation_update
BEFORE UPDATE ON linked_device_authority_installations
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_authority_installations' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
      AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
      AND receipt.wallet_id = NEW.wallet_id AND receipt.table_name = 'linked_device_authority_installations' AND receipt.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_authority_installations_relocation_delete
BEFORE DELETE ON linked_device_authority_installations
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
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_authority_installations' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
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

CREATE TRIGGER IF NOT EXISTS linked_device_target_credentials_relocation_insert
BEFORE INSERT ON linked_device_target_credentials
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
      AND context.table_name = 'linked_device_target_credentials' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_target_credentials_relocation_update
BEFORE UPDATE ON linked_device_target_credentials
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_target_credentials' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
      AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
      AND receipt.wallet_id = NEW.wallet_id AND receipt.table_name = 'linked_device_target_credentials' AND receipt.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_target_credentials_relocation_delete
BEFORE DELETE ON linked_device_target_credentials
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
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_target_credentials' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
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

CREATE TRIGGER IF NOT EXISTS linked_device_target_commit_reservations_relocation_insert
BEFORE INSERT ON linked_device_target_commit_reservations
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND destination.state != 'activated') AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)
      AND context.table_name = 'linked_device_target_commit_reservations' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_target_commit_reservations_relocation_update
BEFORE UPDATE ON linked_device_target_commit_reservations
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND receipt.table_name = 'linked_device_target_commit_reservations' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
      AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND receipt.table_name = 'linked_device_target_commit_reservations' AND receipt.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_target_commit_reservations_relocation_delete
BEFORE DELETE ON linked_device_target_commit_reservations
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND cleanup.state = 'cleaning'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND receipt.table_name = 'linked_device_target_commit_reservations' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_session_transcripts_relocation_insert
BEFORE INSERT ON linked_device_session_transcripts
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND destination.state != 'activated') AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)
      AND context.table_name = 'linked_device_session_transcripts' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.transcript_kind)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_session_transcripts_relocation_update
BEFORE UPDATE ON linked_device_session_transcripts
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND receipt.table_name = 'linked_device_session_transcripts' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id, OLD.transcript_kind)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
      AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND receipt.table_name = 'linked_device_session_transcripts' AND receipt.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.transcript_kind)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_session_transcripts_relocation_delete
BEFORE DELETE ON linked_device_session_transcripts
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND cleanup.state = 'cleaning'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND receipt.table_name = 'linked_device_session_transcripts' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id, OLD.transcript_kind)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_ed25519_export_root_transfers_relocation_insert
BEFORE INSERT ON linked_device_ed25519_export_root_transfers
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
      AND context.table_name = 'linked_device_ed25519_export_root_transfers' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_ed25519_export_root_transfers_relocation_update
BEFORE UPDATE ON linked_device_ed25519_export_root_transfers
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_ed25519_export_root_transfers' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
      AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
      AND receipt.wallet_id = NEW.wallet_id AND receipt.table_name = 'linked_device_ed25519_export_root_transfers' AND receipt.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_ed25519_export_root_transfers_relocation_delete
BEFORE DELETE ON linked_device_ed25519_export_root_transfers
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
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_ed25519_export_root_transfers' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
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

CREATE TRIGGER IF NOT EXISTS linked_device_request_proof_nonces_relocation_insert
BEFORE INSERT ON linked_device_request_proof_nonces
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND destination.state != 'activated') AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)
      AND context.table_name = 'linked_device_request_proof_nonces' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.request_nonce_b64u)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_request_proof_nonces_relocation_update
BEFORE UPDATE ON linked_device_request_proof_nonces
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND receipt.table_name = 'linked_device_request_proof_nonces' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id, OLD.request_nonce_b64u)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
      AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND receipt.table_name = 'linked_device_request_proof_nonces' AND receipt.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.request_nonce_b64u)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_request_proof_nonces_relocation_delete
BEFORE DELETE ON linked_device_request_proof_nonces
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND cleanup.state = 'cleaning'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND receipt.table_name = 'linked_device_request_proof_nonces' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id, OLD.request_nonce_b64u)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_bootstrap_imports_relocation_insert
BEFORE INSERT ON linked_device_bootstrap_imports
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND destination.state != 'activated') AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)
      AND context.table_name = 'linked_device_bootstrap_imports' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_bootstrap_imports_relocation_update
BEFORE UPDATE ON linked_device_bootstrap_imports
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND receipt.table_name = 'linked_device_bootstrap_imports' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
      AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id) AND receipt.table_name = 'linked_device_bootstrap_imports' AND receipt.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_bootstrap_imports_relocation_delete
BEFORE DELETE ON linked_device_bootstrap_imports
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND cleanup.state = 'cleaning'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND receipt.table_name = 'linked_device_bootstrap_imports' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
    JOIN wallet_relocation_authorization_fences AS fence
      ON cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
      AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
      AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
      AND cleanup.request_digest_hex = fence.request_digest_hex
      AND cleanup.source_generation = fence.source_generation
    WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
      AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
      AND cleanup.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id) AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_deliveries_v1_relocation_insert
BEFORE INSERT ON linked_device_wallet_session_credential_deliveries_v1
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
      AND context.table_name = 'linked_device_wallet_session_credential_deliveries_v1' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_deliveries_v1_relocation_update
BEFORE UPDATE ON linked_device_wallet_session_credential_deliveries_v1
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = OLD.namespace AND receipt.org_id = OLD.org_id
      AND receipt.project_id = OLD.project_id AND receipt.env_id = OLD.env_id
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_wallet_session_credential_deliveries_v1' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS fence WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
  OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_receipts AS receipt WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
      AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
      AND receipt.wallet_id = NEW.wallet_id AND receipt.table_name = 'linked_device_wallet_session_credential_deliveries_v1' AND receipt.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'linked_device_relocation_fenced'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_deliveries_v1_relocation_delete
BEFORE DELETE ON linked_device_wallet_session_credential_deliveries_v1
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
      AND receipt.wallet_id = OLD.wallet_id AND receipt.table_name = 'linked_device_wallet_session_credential_deliveries_v1' AND receipt.record_key = json_array(OLD.env_id, OLD.link_session_id, OLD.namespace, OLD.org_id, OLD.project_id)) AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
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

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_delivery_insert_lifecycle_guard
BEFORE INSERT ON linked_device_wallet_session_credential_deliveries_v1
WHEN (NEW.lifecycle_kind != 'issued'
  OR NEW.acknowledged_at_ms IS NOT NULL
  OR NEW.acknowledgement_receipt_json IS NOT NULL
  OR NEW.cleanup_state != 'pending'
  OR NEW.cleanup_receipt_json IS NOT NULL
  OR NEW.cleanup_completed_at_ms IS NOT NULL
  OR NEW.acknowledgement_auth_binding_digest_b64u IS NOT NULL
  OR NEW.acknowledgement_auth_package_set_digest_b64u IS NOT NULL
  OR NEW.acknowledgement_auth_expires_at_ms IS NOT NULL) AND NOT (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = NEW.wallet_id
      AND context.table_name = 'linked_device_wallet_session_credential_deliveries_v1' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)) AND EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
    WHERE session.namespace = NEW.namespace AND session.org_id = NEW.org_id
      AND session.project_id = NEW.project_id AND session.env_id = NEW.env_id
      AND session.wallet_id = NEW.wallet_id AND session.tenant_id = NEW.tenant_id
      AND session.authorization_id = NEW.authorization_id AND session.retired_at_ms IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'linked_device_wallet_session_credential_delivery_initial_state_rejected');
END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_delivery_parent_guard
BEFORE INSERT ON linked_device_wallet_session_credential_deliveries_v1
WHEN NOT EXISTS (
  SELECT 1
    FROM wallet_session_authorizations_v2 AS session
    JOIN linked_device_authority_installations AS installation
      ON installation.namespace = NEW.namespace
     AND installation.org_id = NEW.org_id
     AND installation.project_id = NEW.project_id
     AND installation.env_id = NEW.env_id
     AND installation.link_session_id = NEW.link_session_id
   WHERE session.namespace = NEW.namespace
     AND session.org_id = NEW.org_id
     AND session.project_id = NEW.project_id
     AND session.env_id = NEW.env_id
     AND session.tenant_id = NEW.tenant_id
     AND session.authorization_id = NEW.authorization_id
     AND session.wallet_session_id = NEW.wallet_session_id
     AND session.quota_id = NEW.quota_id
     AND session.principal_id = NEW.principal_id
     AND session.wallet_id = NEW.wallet_id
     AND session.authority_id = NEW.authority_id
     AND session.wallet_auth_method_id = NEW.wallet_auth_method_id
     AND session.operation_credential_hash IS NOT NULL
     AND session.retired_at_ms IS NULL
     AND session.expires_at_ms >= NEW.expires_at_ms
     AND installation.authority_id = NEW.authority_id
     AND installation.wallet_id = NEW.wallet_id
     AND installation.auth_method_id = NEW.wallet_auth_method_id
) AND NOT (EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = NEW.wallet_id
      AND context.table_name = 'linked_device_wallet_session_credential_deliveries_v1' AND context.record_key = json_array(NEW.env_id, NEW.link_session_id, NEW.namespace, NEW.org_id, NEW.project_id)) AND EXISTS (SELECT 1 FROM wallet_session_authorizations_v2 AS session
    WHERE session.namespace = NEW.namespace AND session.org_id = NEW.org_id
      AND session.project_id = NEW.project_id AND session.env_id = NEW.env_id
      AND session.wallet_id = NEW.wallet_id AND session.tenant_id = NEW.tenant_id
      AND session.authorization_id = NEW.authorization_id AND session.retired_at_ms IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'linked_device_wallet_session_credential_delivery_parent_rejected');
END;

CREATE TRIGGER IF NOT EXISTS wallet_recovery_code_locators_relocation_frozen_insert
BEFORE INSERT ON wallet_recovery_code_locators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_recovery_code_locators_relocation_frozen_update
BEFORE UPDATE ON wallet_recovery_code_locators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_recovery_code_locators_relocation_frozen_delete
BEFORE DELETE ON wallet_recovery_code_locators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex
        AND cleanup.source_generation = fence.source_generation AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS wallet_recovery_code_locators_relocation_inactive_insert
BEFORE INSERT ON wallet_recovery_code_locators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated')
  AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
    AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
    AND context.wallet_id = NEW.wallet_id
      AND destination.state = 'importing' AND context.table_name = 'wallet_recovery_code_locators'
      AND context.record_key = json_array(NEW.env_id, NEW.locator_b64u, NEW.namespace, NEW.org_id, NEW.project_id))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_recovery_code_locators_relocation_inactive_update
BEFORE UPDATE ON wallet_recovery_code_locators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_recovery_code_locators_relocation_inactive_delete
BEFORE DELETE ON wallet_recovery_code_locators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_recovery_code_locators_relocation_owner_immutable
BEFORE UPDATE ON wallet_recovery_code_locators
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_wallet_enrollments_relocation_frozen_insert
BEFORE INSERT ON email_otp_wallet_enrollments
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_wallet_enrollments_relocation_frozen_update
BEFORE UPDATE ON email_otp_wallet_enrollments
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_wallet_enrollments_relocation_frozen_delete
BEFORE DELETE ON email_otp_wallet_enrollments
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex
        AND cleanup.source_generation = fence.source_generation AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_wallet_enrollments_relocation_inactive_insert
BEFORE INSERT ON email_otp_wallet_enrollments
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated')
  AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
    AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
    AND context.wallet_id = NEW.wallet_id
      AND destination.state = 'importing' AND context.table_name = 'email_otp_wallet_enrollments'
      AND context.record_key = json_array(NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.wallet_id))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_wallet_enrollments_relocation_inactive_update
BEFORE UPDATE ON email_otp_wallet_enrollments
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_wallet_enrollments_relocation_inactive_delete
BEFORE DELETE ON email_otp_wallet_enrollments
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_wallet_enrollments_relocation_owner_immutable
BEFORE UPDATE ON email_otp_wallet_enrollments
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_auth_states_relocation_frozen_insert
BEFORE INSERT ON email_otp_auth_states
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_auth_states_relocation_frozen_update
BEFORE UPDATE ON email_otp_auth_states
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_auth_states_relocation_frozen_delete
BEFORE DELETE ON email_otp_auth_states
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex
        AND cleanup.source_generation = fence.source_generation AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_auth_states_relocation_inactive_insert
BEFORE INSERT ON email_otp_auth_states
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated')
  AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
    AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
    AND context.wallet_id = NEW.wallet_id
      AND destination.state = 'importing' AND context.table_name = 'email_otp_auth_states'
      AND context.record_key = json_array(NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id, NEW.wallet_id))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_auth_states_relocation_inactive_update
BEFORE UPDATE ON email_otp_auth_states
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_auth_states_relocation_inactive_delete
BEFORE DELETE ON email_otp_auth_states
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS email_otp_auth_states_relocation_owner_immutable
BEFORE UPDATE ON email_otp_auth_states
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_return_cleaned
BEFORE INSERT ON wallet_relocation_authorization_returns
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
  JOIN wallet_execution_generations AS execution USING (namespace, org_id, project_id, env_id, wallet_id)
  WHERE cleanup.namespace = NEW.namespace AND cleanup.org_id = NEW.org_id
    AND cleanup.project_id = NEW.project_id AND cleanup.env_id = NEW.env_id
    AND cleanup.wallet_id = NEW.wallet_id AND cleanup.move_id = NEW.previous_move_id
    AND cleanup.request_digest_hex = NEW.previous_request_digest_hex
    AND cleanup.source_generation = NEW.retired_generation AND cleanup.state = 'cleaned'
    AND execution.generation = NEW.retired_generation AND execution.state = 'retired'
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_return_requires_cleanup'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_return_immutable
BEFORE UPDATE ON wallet_relocation_authorization_returns
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_return_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_return_retained
BEFORE DELETE ON wallet_relocation_authorization_returns
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_return_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_authorization_import_retain
BEFORE DELETE ON wallet_relocation_authorization_imports
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_returns AS returned
  WHERE returned.namespace = OLD.namespace AND returned.org_id = OLD.org_id
    AND returned.project_id = OLD.project_id AND returned.env_id = OLD.env_id
    AND returned.wallet_id = OLD.wallet_id
    AND OLD.source_generation + 1 = returned.retired_generation AND OLD.state = 'activated'
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_import_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_intake_retained
BEFORE DELETE ON wallet_relocation_authorization_intakes
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_returns AS returned
  WHERE returned.namespace = OLD.namespace AND returned.org_id = OLD.org_id
    AND returned.project_id = OLD.project_id AND returned.env_id = OLD.env_id
    AND returned.wallet_id = OLD.wallet_id
    AND OLD.source_generation + 1 = returned.retired_generation AND OLD.state = 'verified'
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_intake_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_authorization_snapshot_delete
BEFORE DELETE ON wallet_relocation_authorization_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_returns AS returned
  WHERE returned.namespace = OLD.namespace AND returned.org_id = OLD.org_id
    AND returned.project_id = OLD.project_id AND returned.env_id = OLD.env_id
    AND returned.wallet_id = OLD.wallet_id AND OLD.source_generation = returned.retired_generation
    AND OLD.move_id = returned.previous_move_id
    AND OLD.request_digest_hex = returned.previous_request_digest_hex
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_snapshot_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_session_fences_retain
BEFORE DELETE ON wallet_relocation_session_fences
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_returns AS returned
  WHERE returned.namespace = OLD.namespace AND returned.org_id = OLD.org_id
    AND returned.project_id = OLD.project_id AND returned.env_id = OLD.env_id
    AND returned.wallet_id = OLD.wallet_id AND OLD.source_generation = returned.retired_generation
    AND OLD.move_id = returned.previous_move_id
    AND OLD.request_digest_hex = returned.previous_request_digest_hex
)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_session_fence_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_execution_retained
BEFORE DELETE ON wallet_execution_generations
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_returns AS returned
  WHERE returned.namespace = OLD.namespace AND returned.org_id = OLD.org_id
    AND returned.project_id = OLD.project_id AND returned.env_id = OLD.env_id
    AND returned.wallet_id = OLD.wallet_id
    AND OLD.generation = returned.retired_generation AND OLD.state = 'retired'
)
BEGIN SELECT RAISE(ABORT, 'wallet_execution_identity_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_authorization_fences_retired
BEFORE INSERT ON wallet_relocation_authorization_fences
WHEN (EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS existing
  WHERE existing.namespace = NEW.namespace AND existing.org_id = NEW.org_id
    AND existing.project_id = NEW.project_id AND existing.env_id = NEW.env_id
    AND existing.wallet_id = NEW.wallet_id
) OR NOT EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS retired
  WHERE retired.namespace = NEW.namespace AND retired.org_id = NEW.org_id
    AND retired.project_id = NEW.project_id AND retired.env_id = NEW.env_id
    AND retired.wallet_id = NEW.wallet_id AND retired.move_id = NEW.move_id
    AND retired.request_digest_hex = NEW.request_digest_hex
    AND retired.source_generation = NEW.source_generation
    AND retired.retired_at_ms <= NEW.frozen_at_ms
) OR EXISTS (
  SELECT 1 FROM wallet_session_authorizations_v2 AS session
  WHERE session.namespace = NEW.namespace AND session.org_id = NEW.org_id
    AND session.project_id = NEW.project_id AND session.env_id = NEW.env_id
    AND session.wallet_id = NEW.wallet_id AND session.retired_at_ms IS NULL
) OR EXISTS (
  SELECT 1 FROM wallet_session_hosted_credentials_v2 AS credential
  WHERE credential.namespace = NEW.namespace AND credential.org_id = NEW.org_id
    AND credential.project_id = NEW.project_id AND credential.env_id = NEW.env_id
    AND credential.wallet_id = NEW.wallet_id AND credential.lifecycle_kind = 'active'
)) AND NOT EXISTS (
  SELECT 1 FROM wallet_relocation_write_blocks AS block
  JOIN wallet_execution_generations AS execution USING (namespace, org_id, project_id, env_id, wallet_id)
  WHERE block.namespace = NEW.namespace AND block.org_id = NEW.org_id
    AND block.project_id = NEW.project_id AND block.env_id = NEW.env_id
    AND block.wallet_id = NEW.wallet_id AND block.move_id = NEW.move_id
    AND block.request_digest_hex = NEW.request_digest_hex AND block.source_generation = NEW.source_generation
    AND block.state = 'draining' AND execution.state = 'active' AND execution.generation = block.source_generation
    AND NOT EXISTS (SELECT 1 FROM wallet_pending_operations AS pending
      WHERE pending.namespace = block.namespace AND pending.org_id = block.org_id
        AND pending.project_id = block.project_id AND pending.env_id = block.env_id AND pending.wallet_id = block.wallet_id)
    AND NOT EXISTS (SELECT 1 FROM wallet_ceremony_activity AS pending
      WHERE pending.namespace = block.namespace AND pending.org_id = block.org_id
        AND pending.project_id = block.project_id AND pending.env_id = block.env_id
        AND pending.wallet_id = block.wallet_id AND pending.settled = 0)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_freeze_requires_retirement');
END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_authorization_fences_retain
BEFORE DELETE ON wallet_relocation_authorization_fences
WHEN (NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_returns AS returned
  WHERE returned.namespace = OLD.namespace AND returned.org_id = OLD.org_id
    AND returned.project_id = OLD.project_id AND returned.env_id = OLD.env_id
    AND returned.wallet_id = OLD.wallet_id AND OLD.source_generation = returned.retired_generation
    AND OLD.move_id = returned.previous_move_id
    AND OLD.request_digest_hex = returned.previous_request_digest_hex
)) AND NOT EXISTS (
  SELECT 1 FROM wallet_relocation_write_blocks AS block
  WHERE block.namespace = OLD.namespace AND block.org_id = OLD.org_id
    AND block.project_id = OLD.project_id AND block.env_id = OLD.env_id AND block.wallet_id = OLD.wallet_id
    AND block.move_id = OLD.move_id AND block.request_digest_hex = OLD.request_digest_hex
    AND block.source_generation = OLD.source_generation AND block.state IN ('released', 'checked')
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_session_fences AS retired
      WHERE retired.namespace = block.namespace AND retired.org_id = block.org_id
        AND retired.project_id = block.project_id AND retired.env_id = block.env_id AND retired.wallet_id = block.wallet_id)
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_fence_retained'); END;

CREATE TRIGGER IF NOT EXISTS wallet_ceremony_activity_relocation_write_block BEFORE INSERT ON wallet_ceremony_activity
WHEN EXISTS (SELECT 1 FROM wallet_relocation_write_blocks block
  WHERE block.namespace = NEW.namespace AND block.org_id = NEW.org_id
    AND block.project_id = NEW.project_id AND block.env_id = NEW.env_id AND block.wallet_id = NEW.wallet_id
    AND block.state IN ('draining', 'checked')) AND NEW.settled = 0 AND NOT EXISTS (SELECT 1 FROM wallet_ceremony_activity existing WHERE existing.namespace = NEW.namespace AND existing.org_id = NEW.org_id AND existing.project_id = NEW.project_id AND existing.env_id = NEW.env_id AND existing.record_key = NEW.record_key AND existing.wallet_id = NEW.wallet_id AND existing.settled = 0)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS wallet_operations_write_block
BEFORE INSERT ON authorized_operations
WHEN EXISTS (
  SELECT 1 FROM (SELECT * FROM wallet_relocation_write_blocks WHERE state IN ('draining', 'checked')) AS fence
  JOIN (SELECT owner.namespace, owner.org_id, owner.project_id, owner.env_id, owner.wallet_id
          FROM wallet_operation_authorizations AS owner
          WHERE owner.namespace = NEW.namespace AND owner.tenant_id = NEW.tenant_id
            AND owner.source_kind = NEW.authorization_source_kind
            AND owner.source_id = CASE NEW.authorization_source_kind
              WHEN 'authorization_grant' THEN NEW.authorization_id ELSE NEW.evidence_set_digest END
            AND (NEW.authorization_source_kind = 'verified_step_up' OR
              (NEW.authorization_grant_kind = 'wallet_session_authorization'
                AND owner.org_id = NEW.owner_scope_org_id AND owner.project_id = NEW.owner_scope_project_id
                AND owner.env_id = NEW.owner_scope_env_id))) AS selected ON selected.namespace = fence.namespace
    AND selected.org_id = fence.org_id AND selected.project_id = fence.project_id AND selected.env_id = fence.env_id
    AND selected.wallet_id = fence.wallet_id
)
BEGIN
  SELECT RAISE(ABORT, 'authorization_evidence_claim_rejected')
    WHERE NEW.authorization_source_kind = 'verified_step_up';
  SELECT RAISE(ABORT, 'authorization_wallet_session_rejected')
    WHERE NEW.authorization_source_kind IS NOT 'verified_step_up';
END;

CREATE TRIGGER IF NOT EXISTS linked_device_sessions_capacity_insert BEFORE INSERT ON linked_device_sessions
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = json_extract(NEW.record_json, '$.claimTranscript.value.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_sessions_capacity_update BEFORE UPDATE ON linked_device_sessions
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_sessions_capacity_delete BEFORE DELETE ON linked_device_sessions
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_authority_allocations_capacity_insert BEFORE INSERT ON linked_device_authority_allocations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_authority_allocations_capacity_update BEFORE UPDATE ON linked_device_authority_allocations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_authority_allocations_capacity_delete BEFORE DELETE ON linked_device_authority_allocations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_authority_installations_capacity_insert BEFORE INSERT ON linked_device_authority_installations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_authority_installations_capacity_update BEFORE UPDATE ON linked_device_authority_installations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_authority_installations_capacity_delete BEFORE DELETE ON linked_device_authority_installations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_target_credentials_capacity_insert BEFORE INSERT ON linked_device_target_credentials
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_target_credentials_capacity_update BEFORE UPDATE ON linked_device_target_credentials
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_target_credentials_capacity_delete BEFORE DELETE ON linked_device_target_credentials
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_target_commit_reservations_capacity_insert BEFORE INSERT ON linked_device_target_commit_reservations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_target_commit_reservations_capacity_update BEFORE UPDATE ON linked_device_target_commit_reservations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_target_commit_reservations_capacity_delete BEFORE DELETE ON linked_device_target_commit_reservations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_session_transcripts_capacity_insert BEFORE INSERT ON linked_device_session_transcripts
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_session_transcripts_capacity_update BEFORE UPDATE ON linked_device_session_transcripts
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_session_transcripts_capacity_delete BEFORE DELETE ON linked_device_session_transcripts
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_ed25519_export_root_transfers_capacity_insert BEFORE INSERT ON linked_device_ed25519_export_root_transfers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_ed25519_export_root_transfers_capacity_update BEFORE UPDATE ON linked_device_ed25519_export_root_transfers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_ed25519_export_root_transfers_capacity_delete BEFORE DELETE ON linked_device_ed25519_export_root_transfers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_request_proof_nonces_capacity_insert BEFORE INSERT ON linked_device_request_proof_nonces
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_request_proof_nonces_capacity_update BEFORE UPDATE ON linked_device_request_proof_nonces
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_request_proof_nonces_capacity_delete BEFORE DELETE ON linked_device_request_proof_nonces
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_bootstrap_imports_capacity_insert BEFORE INSERT ON linked_device_bootstrap_imports
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_bootstrap_imports_capacity_update BEFORE UPDATE ON linked_device_bootstrap_imports
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_bootstrap_imports_capacity_delete BEFORE DELETE ON linked_device_bootstrap_imports
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_deliveries_v1_capacity_insert BEFORE INSERT ON linked_device_wallet_session_credential_deliveries_v1
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_deliveries_v1_capacity_update BEFORE UPDATE ON linked_device_wallet_session_credential_deliveries_v1
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_wallet_session_credential_deliveries_v1_capacity_delete BEFORE DELETE ON linked_device_wallet_session_credential_deliveries_v1
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_approvals_capacity_insert BEFORE INSERT ON wallet_relocation_approvals
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace
    AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id
    AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_approvals_capacity_update BEFORE UPDATE ON wallet_relocation_approvals
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace
    AND fence.org_id = OLD.org_id AND fence.project_id = OLD.project_id
    AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS wallet_relocation_approvals_capacity_delete BEFORE DELETE ON wallet_relocation_approvals
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace
    AND fence.org_id = OLD.org_id AND fence.project_id = OLD.project_id
    AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS verified_wallet_operation_evidence_sets_capacity_insert BEFORE INSERT ON verified_wallet_operation_evidence_sets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace
    AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id
    AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS wallet_object_addresses_immutable
BEFORE UPDATE ON wallet_object_addresses
BEGIN SELECT RAISE(ABORT, 'wallet_object_addresses_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_object_addresses_retained
BEFORE DELETE ON wallet_object_addresses
BEGIN SELECT RAISE(ABORT, 'wallet_object_addresses_retained'); END;

CREATE TRIGGER IF NOT EXISTS registration_passkey_claims_immutable
BEFORE UPDATE ON registration_passkey_claims
BEGIN SELECT RAISE(ABORT, 'registration_passkey_claims_immutable'); END;

CREATE TRIGGER IF NOT EXISTS wallet_auth_methods_frozen_insert
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

CREATE TRIGGER IF NOT EXISTS wallet_auth_methods_frozen_update
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

CREATE TRIGGER IF NOT EXISTS wallet_auth_methods_frozen_delete
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

CREATE TRIGGER IF NOT EXISTS wallet_auth_methods_inactive_import_insert
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

CREATE TRIGGER IF NOT EXISTS wallet_auth_methods_inactive_import_update
BEFORE UPDATE ON wallet_auth_methods
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')) OR (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
      AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
      AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS wallet_auth_methods_inactive_import_delete
BEFORE DELETE ON wallet_auth_methods
WHEN (EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
    WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
      AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
      AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS authorized_operation_owner_grant_claim_atomic
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

CREATE TRIGGER IF NOT EXISTS external_auth_associations_capacity_insert BEFORE INSERT ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS external_auth_associations_capacity_update BEFORE UPDATE ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS external_auth_associations_capacity_delete BEFORE DELETE ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS external_auth_associations_relocation_frozen_insert
BEFORE INSERT ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS external_auth_associations_relocation_frozen_update
BEFORE UPDATE ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS external_auth_associations_relocation_frozen_delete
BEFORE DELETE ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex
        AND cleanup.source_generation = fence.source_generation AND cleanup.state = 'cleaning'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER IF NOT EXISTS external_auth_associations_relocation_inactive_insert
BEFORE INSERT ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated')
  AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_import_context AS context
    JOIN wallet_relocation_authorization_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
    AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
    AND context.wallet_id = NEW.wallet_id
      AND destination.state = 'importing' AND context.table_name = 'external_auth_associations'
      AND context.record_key = json_array(NEW.association_id, NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS external_auth_associations_relocation_inactive_update
BEFORE UPDATE ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS external_auth_associations_relocation_inactive_delete
BEFORE DELETE ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER IF NOT EXISTS external_auth_associations_relocation_owner_immutable
BEFORE UPDATE ON external_auth_associations
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER IF NOT EXISTS wallet_registration_directory_publication_identity
BEFORE UPDATE ON wallet_registration_directory_publications
WHEN NEW.wallet_id IS NOT OLD.wallet_id OR NEW.ceremony_id IS NOT OLD.ceremony_id
  OR NEW.session_json IS NOT OLD.session_json
  OR (OLD.state = 'refused' AND NEW.state != 'refused')
BEGIN SELECT RAISE(ABORT, 'wallet_registration_directory_publication_conflicts'); END;

CREATE TRIGGER IF NOT EXISTS wallet_signing_credit_admission BEFORE INSERT ON authorized_operations
WHEN NEW.lifecycle_kind='claimed' AND NEW.operation_kind IN ('near.sign_transaction','near.sign_delegate_action','near.sign_nep413_message','evm.sign_transaction')
AND EXISTS(SELECT 1 FROM wallet_signing_credit_policies p WHERE p.namespace=NEW.namespace AND p.tenant_id=NEW.tenant_id
 AND p.project_id=COALESCE(NEW.owner_scope_project_id,(SELECT project_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest)) AND p.env_id=COALESCE(NEW.owner_scope_env_id,(SELECT env_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest)) AND p.mode<>'included')
BEGIN
 SELECT RAISE(ABORT,'billing_credit_exhausted') WHERE NOT EXISTS(
  SELECT 1 FROM wallet_signing_credit_policies p JOIN wallet_signing_credit_grants g USING(namespace,tenant_id,grant_id)
  WHERE p.namespace=NEW.namespace AND p.tenant_id=NEW.tenant_id AND p.project_id=COALESCE(NEW.owner_scope_project_id,(SELECT project_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest))
   AND p.env_id=COALESCE(NEW.owner_scope_env_id,(SELECT env_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest)) AND p.mode='credit' AND g.sealed=0 AND g.expires_at_ms>NEW.claimed_at_ms
   AND g.admitted_count<g.capacity);
 END;

CREATE TRIGGER IF NOT EXISTS wallet_signing_credit_claim AFTER INSERT ON authorized_operations
WHEN NEW.lifecycle_kind='claimed' AND NEW.operation_kind IN ('near.sign_transaction','near.sign_delegate_action','near.sign_nep413_message','evm.sign_transaction')
BEGIN
 INSERT INTO wallet_signing_credit_claims(namespace,tenant_id,authorized_operation_id,grant_id)
 SELECT NEW.namespace,NEW.tenant_id,NEW.authorized_operation_id,p.grant_id FROM wallet_signing_credit_policies p
 WHERE p.namespace=NEW.namespace AND p.tenant_id=NEW.tenant_id AND p.project_id=COALESCE(NEW.owner_scope_project_id,(SELECT project_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest))
  AND p.env_id=COALESCE(NEW.owner_scope_env_id,(SELECT env_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest)) AND p.mode='credit';
 UPDATE wallet_signing_credit_grants SET admitted_count=admitted_count+1 WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id
  AND grant_id=(SELECT grant_id FROM wallet_signing_credit_claims WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND authorized_operation_id=NEW.authorized_operation_id);
 END;

CREATE TRIGGER IF NOT EXISTS wallet_signing_credit_grant_identity BEFORE UPDATE ON wallet_signing_credit_grants
WHEN NEW.namespace<>OLD.namespace OR NEW.tenant_id<>OLD.tenant_id OR NEW.grant_id<>OLD.grant_id
 OR NEW.project_id<>OLD.project_id OR NEW.env_id<>OLD.env_id OR NEW.capacity<>OLD.capacity OR NEW.expires_at_ms<>OLD.expires_at_ms
 OR NEW.admitted_count<OLD.admitted_count OR NEW.sealed<OLD.sealed
BEGIN SELECT RAISE(ABORT,'signing_credit_grant_immutable');  END;

CREATE TRIGGER IF NOT EXISTS wallet_signing_credit_claim_immutable BEFORE UPDATE ON wallet_signing_credit_claims
BEGIN SELECT RAISE(ABORT,'signing_credit_claim_immutable');  END;

CREATE TRIGGER IF NOT EXISTS wallet_signing_credit_claim_retained BEFORE DELETE ON wallet_signing_credit_claims
BEGIN SELECT RAISE(ABORT,'signing_credit_claim_retained');  END;

CREATE TRIGGER IF NOT EXISTS wallet_signature_completion_record AFTER UPDATE OF lifecycle_kind ON authorized_operations
WHEN OLD.lifecycle_kind='claimed' AND NEW.lifecycle_kind='completed'
 AND NEW.operation_kind IN ('near.sign_transaction','near.sign_delegate_action','near.sign_nep413_message','evm.sign_transaction')
 AND (NEW.result_kind='succeeded' OR (NEW.result_kind='failed_before_side_effect' AND EXISTS(SELECT 1 FROM wallet_signing_credit_claims c
  WHERE c.namespace=NEW.namespace AND c.tenant_id=NEW.tenant_id AND c.authorized_operation_id=NEW.authorized_operation_id)))
BEGIN
 INSERT INTO wallet_signature_completions(namespace,tenant_id,authorized_operation_id,operation_kind,org_id,project_id,env_id,completed_at_ms,wallet_id,credit_grant_id,outcome)
 VALUES(NEW.namespace,NEW.tenant_id,NEW.authorized_operation_id,NEW.operation_kind,NEW.owner_scope_org_id,NEW.owner_scope_project_id,NEW.owner_scope_env_id,NEW.completed_at_ms,
 (SELECT wallet_id FROM wallet_operation_authorizations WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND source_kind=NEW.authorization_source_kind AND source_id=COALESCE(NEW.authorization_id,NEW.evidence_set_digest)),
 (SELECT grant_id FROM wallet_signing_credit_claims WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND authorized_operation_id=NEW.authorized_operation_id),
  CASE  NEW.result_kind WHEN 'succeeded' THEN 'succeeded' ELSE 'failed'  END ) ON CONFLICT DO NOTHING;
 END;

CREATE TRIGGER IF NOT EXISTS wallet_signing_credit_grant_conflict BEFORE INSERT ON wallet_signing_credit_grants
WHEN EXISTS(SELECT 1 FROM wallet_signing_credit_grants g WHERE g.namespace=NEW.namespace AND g.tenant_id=NEW.tenant_id AND g.grant_id=NEW.grant_id
 AND (g.project_id<>NEW.project_id OR g.env_id<>NEW.env_id OR g.capacity<>NEW.capacity OR g.expires_at_ms<>NEW.expires_at_ms))
BEGIN SELECT RAISE(ABORT,'signing_credit_grant_conflict');  END;

CREATE TRIGGER IF NOT EXISTS wallet_signing_credit_grant_retained BEFORE DELETE ON wallet_signing_credit_grants
BEGIN SELECT RAISE(ABORT,'signing_credit_grant_retained');  END;

CREATE TRIGGER IF NOT EXISTS linked_device_email_otp_grants_relocation_insert
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

CREATE TRIGGER IF NOT EXISTS linked_device_email_otp_grants_relocation_update
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

CREATE TRIGGER IF NOT EXISTS linked_device_email_otp_grants_relocation_delete
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

CREATE TRIGGER IF NOT EXISTS linked_device_email_otp_grants_capacity_insert BEFORE INSERT ON linked_device_email_otp_grants
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_email_otp_grants_capacity_update BEFORE UPDATE ON linked_device_email_otp_grants
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER IF NOT EXISTS linked_device_email_otp_grants_capacity_delete BEFORE DELETE ON linked_device_email_otp_grants
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

-- Each compare-and-swap guard table holds its one row. A write that loses a race inserts
-- the row again and fails.
INSERT OR IGNORE INTO lane_cas_guard (guard_id) VALUES (1);
INSERT OR IGNORE INTO registration_ceremony_cas_guard (guard_id) VALUES (1);
INSERT OR IGNORE INTO router_ab_yao_versioned_json_cas_guard (guard_id) VALUES (1);
INSERT OR IGNORE INTO linked_device_session_cas_guard (guard_id) VALUES (1);
INSERT OR IGNORE INTO wallet_authority_cas_guard (guard_id) VALUES (1);
