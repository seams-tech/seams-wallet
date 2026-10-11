-- Reject unfinished transfers. Completed receipts remain immutable.
CREATE TABLE wallet_recovery_relocation_upgrade_guard (count INTEGER NOT NULL CHECK (count = 0));
INSERT INTO wallet_recovery_relocation_upgrade_guard
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
DROP TABLE wallet_recovery_relocation_upgrade_guard;

CREATE TRIGGER wallet_recovery_code_locators_relocation_frozen_insert
BEFORE INSERT ON wallet_recovery_code_locators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER wallet_recovery_code_locators_relocation_frozen_update
BEFORE UPDATE ON wallet_recovery_code_locators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER wallet_recovery_code_locators_relocation_frozen_delete
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

CREATE TRIGGER wallet_recovery_code_locators_relocation_inactive_insert
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

CREATE TRIGGER wallet_recovery_code_locators_relocation_inactive_update
BEFORE UPDATE ON wallet_recovery_code_locators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER wallet_recovery_code_locators_relocation_inactive_delete
BEFORE DELETE ON wallet_recovery_code_locators
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER wallet_recovery_code_locators_relocation_owner_immutable
BEFORE UPDATE ON wallet_recovery_code_locators
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;

