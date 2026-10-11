-- Snapshot inventories must not change during an in-progress transfer.
CREATE TABLE wallet_linked_relocation_upgrade_guard (count INTEGER NOT NULL CHECK (count = 0));
INSERT INTO wallet_linked_relocation_upgrade_guard
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
DROP TABLE wallet_linked_relocation_upgrade_guard;

-- Transfer linked-device enrollment and delivery history with its retired sessions.
-- The existing import context authorizes one exact record. Imported history cannot resume.

CREATE TRIGGER linked_device_sessions_relocation_insert
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

CREATE TRIGGER linked_device_sessions_relocation_update
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

CREATE TRIGGER linked_device_sessions_relocation_delete
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

CREATE TRIGGER linked_device_authority_allocations_relocation_insert
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

CREATE TRIGGER linked_device_authority_allocations_relocation_update
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

CREATE TRIGGER linked_device_authority_allocations_relocation_delete
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

CREATE TRIGGER linked_device_authority_installations_relocation_insert
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

CREATE TRIGGER linked_device_authority_installations_relocation_update
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

CREATE TRIGGER linked_device_authority_installations_relocation_delete
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

CREATE TRIGGER linked_device_target_credentials_relocation_insert
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

CREATE TRIGGER linked_device_target_credentials_relocation_update
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

CREATE TRIGGER linked_device_target_credentials_relocation_delete
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

CREATE TRIGGER linked_device_target_commit_reservations_relocation_insert
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

CREATE TRIGGER linked_device_target_commit_reservations_relocation_update
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

CREATE TRIGGER linked_device_target_commit_reservations_relocation_delete
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

CREATE TRIGGER linked_device_session_transcripts_relocation_insert
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

CREATE TRIGGER linked_device_session_transcripts_relocation_update
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

CREATE TRIGGER linked_device_session_transcripts_relocation_delete
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

CREATE TRIGGER linked_device_ed25519_export_root_transfers_relocation_insert
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

CREATE TRIGGER linked_device_ed25519_export_root_transfers_relocation_update
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

CREATE TRIGGER linked_device_ed25519_export_root_transfers_relocation_delete
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

CREATE TRIGGER linked_device_request_proof_nonces_relocation_insert
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

CREATE TRIGGER linked_device_request_proof_nonces_relocation_update
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

CREATE TRIGGER linked_device_request_proof_nonces_relocation_delete
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

CREATE TRIGGER linked_device_bootstrap_imports_relocation_insert
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

CREATE TRIGGER linked_device_bootstrap_imports_relocation_update
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

CREATE TRIGGER linked_device_bootstrap_imports_relocation_delete
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

CREATE TRIGGER linked_device_wallet_session_credential_deliveries_v1_relocation_insert
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

CREATE TRIGGER linked_device_wallet_session_credential_deliveries_v1_relocation_update
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

CREATE TRIGGER linked_device_wallet_session_credential_deliveries_v1_relocation_delete
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

DROP TRIGGER linked_device_wallet_session_credential_delivery_insert_lifecycle_guard;
CREATE TRIGGER linked_device_wallet_session_credential_delivery_insert_lifecycle_guard
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

DROP TRIGGER linked_device_wallet_session_credential_delivery_parent_guard;
CREATE TRIGGER linked_device_wallet_session_credential_delivery_parent_guard
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
