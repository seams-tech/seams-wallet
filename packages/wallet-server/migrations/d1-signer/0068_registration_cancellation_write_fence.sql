-- Cancellation closes outstanding ceremony writes while permitting cleanup deletes.
CREATE TRIGGER registration_cancelled_insert_fence
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

CREATE TRIGGER registration_cancelled_update_fence
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
