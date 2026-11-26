-- A terminal registration decision survives an uncertain directory reply.
ALTER TABLE wallet_execution_generations ADD COLUMN registration_completion TEXT NOT NULL
  DEFAULT 'pending' CHECK(registration_completion IN ('pending', 'established', 'cancelled'));

CREATE TRIGGER wallet_registration_completion_immutable
BEFORE UPDATE ON wallet_execution_generations
WHEN (OLD.registration_completion != 'pending'
      AND NEW.registration_completion != OLD.registration_completion)
  OR (NEW.registration_completion != 'pending' AND NEW.origin != 'registration')
  OR (NEW.registration_completion = 'cancelled' AND NEW.state != 'retired')
  OR (NEW.registration_completion = 'established' AND NEW.state = 'inactive')
BEGIN SELECT RAISE(ABORT, 'wallet_registration_completion_conflicts'); END;
