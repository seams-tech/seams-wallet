-- Require completed snapshot cleanup before changing the transfer inventory.
CREATE TABLE wallet_passkey_relocation_upgrade_guard (count INTEGER NOT NULL CHECK (count = 0));
INSERT INTO wallet_passkey_relocation_upgrade_guard
SELECT (SELECT COUNT(*) FROM wallet_relocation_authorization_snapshots)
     + (SELECT COUNT(*) FROM wallet_relocation_authorization_imports);
DROP TABLE wallet_passkey_relocation_upgrade_guard;

CREATE TRIGGER router_ab_yao_versioned_json_records_relocation_frozen_insert
BEFORE INSERT ON router_ab_yao_versioned_json_records
WHEN (substr(NEW.record_key, 1, 17) = 'passkey-envelope:' OR substr(NEW.record_key, 1, 28) = 'passkey-credential-activity:') AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = json_extract(NEW.record_json, '$.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER router_ab_yao_versioned_json_records_relocation_frozen_update
BEFORE UPDATE ON router_ab_yao_versioned_json_records
WHEN (substr(OLD.record_key, 1, 17) = 'passkey-envelope:' OR substr(OLD.record_key, 1, 28) = 'passkey-credential-activity:') AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = json_extract(OLD.record_json, '$.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER router_ab_yao_versioned_json_records_relocation_frozen_delete
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

CREATE TRIGGER router_ab_yao_versioned_json_records_relocation_inactive_insert
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

CREATE TRIGGER router_ab_yao_versioned_json_records_relocation_inactive_update
BEFORE UPDATE ON router_ab_yao_versioned_json_records
WHEN (substr(OLD.record_key, 1, 17) = 'passkey-envelope:' OR substr(OLD.record_key, 1, 28) = 'passkey-credential-activity:') AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = json_extract(OLD.record_json, '$.walletId') AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER router_ab_yao_versioned_json_records_relocation_inactive_delete
BEFORE DELETE ON router_ab_yao_versioned_json_records
WHEN (substr(OLD.record_key, 1, 17) = 'passkey-envelope:' OR substr(OLD.record_key, 1, 28) = 'passkey-credential-activity:') AND EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = json_extract(OLD.record_json, '$.walletId') AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER router_ab_yao_versioned_json_records_relocation_owner_immutable
BEFORE UPDATE ON router_ab_yao_versioned_json_records
WHEN (substr(OLD.record_key, 1, 17) = 'passkey-envelope:' OR substr(OLD.record_key, 1, 28) = 'passkey-credential-activity:') AND (NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR json_extract(NEW.record_json, '$.walletId') IS NOT json_extract(OLD.record_json, '$.walletId'))
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER wallets_relocation_frozen_insert
BEFORE INSERT ON wallets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER wallets_relocation_frozen_update
BEFORE UPDATE ON wallets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER wallets_relocation_frozen_delete
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

CREATE TRIGGER wallets_relocation_inactive_insert
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

CREATE TRIGGER wallets_relocation_inactive_update
BEFORE UPDATE ON wallets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER wallets_relocation_inactive_delete
BEFORE DELETE ON wallets
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER wallets_relocation_owner_immutable
BEFORE UPDATE ON wallets
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER wallet_signers_relocation_frozen_insert
BEFORE INSERT ON wallet_signers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER wallet_signers_relocation_frozen_update
BEFORE UPDATE ON wallet_signers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER wallet_signers_relocation_frozen_delete
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

CREATE TRIGGER wallet_signers_relocation_inactive_insert
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

CREATE TRIGGER wallet_signers_relocation_inactive_update
BEFORE UPDATE ON wallet_signers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER wallet_signers_relocation_inactive_delete
BEFORE DELETE ON wallet_signers
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER wallet_signers_relocation_owner_immutable
BEFORE UPDATE ON wallet_signers
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER webauthn_credential_bindings_relocation_frozen_insert
BEFORE INSERT ON webauthn_credential_bindings
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER webauthn_credential_bindings_relocation_frozen_update
BEFORE UPDATE ON webauthn_credential_bindings
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.user_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER webauthn_credential_bindings_relocation_frozen_delete
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

CREATE TRIGGER webauthn_credential_bindings_relocation_inactive_insert
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

CREATE TRIGGER webauthn_credential_bindings_relocation_inactive_update
BEFORE UPDATE ON webauthn_credential_bindings
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.user_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER webauthn_credential_bindings_relocation_inactive_delete
BEFORE DELETE ON webauthn_credential_bindings
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.user_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER webauthn_credential_bindings_relocation_owner_immutable
BEFORE UPDATE ON webauthn_credential_bindings
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.user_id IS NOT OLD.user_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

CREATE TRIGGER webauthn_authenticators_relocation_frozen_insert
BEFORE INSERT ON webauthn_authenticators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER webauthn_authenticators_relocation_frozen_update
BEFORE UPDATE ON webauthn_authenticators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.user_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER webauthn_authenticators_relocation_frozen_delete
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

CREATE TRIGGER webauthn_authenticators_relocation_inactive_insert
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

CREATE TRIGGER webauthn_authenticators_relocation_inactive_update
BEFORE UPDATE ON webauthn_authenticators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.user_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER webauthn_authenticators_relocation_inactive_delete
BEFORE DELETE ON webauthn_authenticators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.user_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER webauthn_authenticators_relocation_owner_immutable
BEFORE UPDATE ON webauthn_authenticators
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.user_id IS NOT OLD.user_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;
