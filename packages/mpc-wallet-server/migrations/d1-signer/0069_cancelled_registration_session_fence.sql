-- A previously admitted registration cannot publish a session after cancellation.
CREATE TRIGGER cancelled_registration_session_insert_fence
BEFORE INSERT ON wallet_session_authorizations_v2
WHEN EXISTS (
  SELECT 1 FROM wallet_execution_generations AS execution
  WHERE execution.namespace = NEW.namespace AND execution.org_id = NEW.org_id
    AND execution.project_id = NEW.project_id AND execution.env_id = NEW.env_id
    AND execution.wallet_id = NEW.wallet_id
    AND execution.registration_completion = 'cancelled'
)
BEGIN SELECT RAISE(ABORT, 'registration_cancelled'); END;
