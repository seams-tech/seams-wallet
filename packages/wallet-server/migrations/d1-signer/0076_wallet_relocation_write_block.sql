-- A temporary wallet-local fence protects the final capacity check.
CREATE TABLE wallet_relocation_write_blocks (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draining', 'checked', 'released', 'frozen')),
  started_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, move_id)
);
CREATE UNIQUE INDEX wallet_relocation_write_block_active ON wallet_relocation_write_blocks
  (namespace, org_id, project_id, env_id, wallet_id) WHERE state IN ('draining', 'checked');

DROP TRIGGER wallet_relocation_authorization_fences_retired;
CREATE TRIGGER wallet_relocation_authorization_fences_retired
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

DROP TRIGGER wallet_relocation_authorization_fences_retain;
CREATE TRIGGER wallet_relocation_authorization_fences_retain
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

CREATE TRIGGER wallet_ceremony_activity_relocation_write_block BEFORE INSERT ON wallet_ceremony_activity
WHEN EXISTS (SELECT 1 FROM wallet_relocation_write_blocks block
  WHERE block.namespace = NEW.namespace AND block.org_id = NEW.org_id
    AND block.project_id = NEW.project_id AND block.env_id = NEW.env_id AND block.wallet_id = NEW.wallet_id
    AND block.state IN ('draining', 'checked')) AND NEW.settled = 0 AND NOT EXISTS (SELECT 1 FROM wallet_ceremony_activity existing WHERE existing.namespace = NEW.namespace AND existing.org_id = NEW.org_id AND existing.project_id = NEW.project_id AND existing.env_id = NEW.env_id AND existing.record_key = NEW.record_key AND existing.wallet_id = NEW.wallet_id AND existing.settled = 0)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER wallet_operations_write_block
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
  SELECT CASE WHEN NEW.authorization_source_kind = 'verified_step_up'
    THEN RAISE(ABORT, 'authorization_evidence_claim_rejected')
    ELSE RAISE(ABORT, 'authorization_wallet_session_rejected') END;
END;

CREATE TRIGGER linked_device_sessions_capacity_insert BEFORE INSERT ON linked_device_sessions
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = json_extract(NEW.record_json, '$.claimTranscript.value.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_sessions_capacity_update BEFORE UPDATE ON linked_device_sessions
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_sessions_capacity_delete BEFORE DELETE ON linked_device_sessions
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = json_extract(OLD.record_json, '$.claimTranscript.value.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_authority_allocations_capacity_insert BEFORE INSERT ON linked_device_authority_allocations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_authority_allocations_capacity_update BEFORE UPDATE ON linked_device_authority_allocations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_authority_allocations_capacity_delete BEFORE DELETE ON linked_device_authority_allocations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_authority_installations_capacity_insert BEFORE INSERT ON linked_device_authority_installations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_authority_installations_capacity_update BEFORE UPDATE ON linked_device_authority_installations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_authority_installations_capacity_delete BEFORE DELETE ON linked_device_authority_installations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_target_credentials_capacity_insert BEFORE INSERT ON linked_device_target_credentials
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_target_credentials_capacity_update BEFORE UPDATE ON linked_device_target_credentials
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_target_credentials_capacity_delete BEFORE DELETE ON linked_device_target_credentials
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_target_commit_reservations_capacity_insert BEFORE INSERT ON linked_device_target_commit_reservations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_target_commit_reservations_capacity_update BEFORE UPDATE ON linked_device_target_commit_reservations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_target_commit_reservations_capacity_delete BEFORE DELETE ON linked_device_target_commit_reservations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_session_transcripts_capacity_insert BEFORE INSERT ON linked_device_session_transcripts
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_session_transcripts_capacity_update BEFORE UPDATE ON linked_device_session_transcripts
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_session_transcripts_capacity_delete BEFORE DELETE ON linked_device_session_transcripts
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_ed25519_export_root_transfers_capacity_insert BEFORE INSERT ON linked_device_ed25519_export_root_transfers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_ed25519_export_root_transfers_capacity_update BEFORE UPDATE ON linked_device_ed25519_export_root_transfers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_ed25519_export_root_transfers_capacity_delete BEFORE DELETE ON linked_device_ed25519_export_root_transfers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

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

CREATE TRIGGER linked_device_request_proof_nonces_capacity_insert BEFORE INSERT ON linked_device_request_proof_nonces
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_request_proof_nonces_capacity_update BEFORE UPDATE ON linked_device_request_proof_nonces
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_request_proof_nonces_capacity_delete BEFORE DELETE ON linked_device_request_proof_nonces
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_bootstrap_imports_capacity_insert BEFORE INSERT ON linked_device_bootstrap_imports
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = NEW.namespace AND parent.org_id = NEW.org_id AND parent.project_id = NEW.project_id AND parent.env_id = NEW.env_id AND parent.link_session_id = NEW.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_bootstrap_imports_capacity_update BEFORE UPDATE ON linked_device_bootstrap_imports
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_bootstrap_imports_capacity_delete BEFORE DELETE ON linked_device_bootstrap_imports
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = (SELECT json_extract(parent.record_json, '$.claimTranscript.value.walletId') FROM linked_device_sessions AS parent WHERE parent.namespace = OLD.namespace AND parent.org_id = OLD.org_id AND parent.project_id = OLD.project_id AND parent.env_id = OLD.env_id AND parent.link_session_id = OLD.link_session_id))
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_wallet_session_credential_deliveries_v1_capacity_insert BEFORE INSERT ON linked_device_wallet_session_credential_deliveries_v1
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_wallet_session_credential_deliveries_v1_capacity_update BEFORE UPDATE ON linked_device_wallet_session_credential_deliveries_v1
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER linked_device_wallet_session_credential_deliveries_v1_capacity_delete BEFORE DELETE ON linked_device_wallet_session_credential_deliveries_v1
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER wallet_relocation_approvals_capacity_insert BEFORE INSERT ON wallet_relocation_approvals
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace
    AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id
    AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER wallet_relocation_approvals_capacity_update BEFORE UPDATE ON wallet_relocation_approvals
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace
    AND fence.org_id = OLD.org_id AND fence.project_id = OLD.project_id
    AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER wallet_relocation_approvals_capacity_delete BEFORE DELETE ON wallet_relocation_approvals
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace
    AND fence.org_id = OLD.org_id AND fence.project_id = OLD.project_id
    AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER verified_wallet_operation_evidence_sets_capacity_insert BEFORE INSERT ON verified_wallet_operation_evidence_sets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace
    AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id
    AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;
