-- A cleaned location can host a later generation without erasing old cleanup receipts.
CREATE TABLE wallet_relocation_authorization_returns (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  previous_move_id TEXT NOT NULL, previous_request_digest_hex TEXT NOT NULL,
  retired_generation INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, move_id),
  UNIQUE (namespace, org_id, project_id, env_id, wallet_id, retired_generation),
  CHECK (retired_generation > 0 AND source_generation > retired_generation)
);

CREATE TRIGGER wallet_authorization_return_cleaned
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

CREATE TRIGGER wallet_authorization_return_immutable
BEFORE UPDATE ON wallet_relocation_authorization_returns
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_return_immutable'); END;
CREATE TRIGGER wallet_authorization_return_retained
BEFORE DELETE ON wallet_relocation_authorization_returns
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_return_retained'); END;

DROP TRIGGER wallet_relocation_authorization_import_retain;
CREATE TRIGGER wallet_relocation_authorization_import_retain
BEFORE DELETE ON wallet_relocation_authorization_imports
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_returns AS returned
  WHERE returned.namespace = OLD.namespace AND returned.org_id = OLD.org_id
    AND returned.project_id = OLD.project_id AND returned.env_id = OLD.env_id
    AND returned.wallet_id = OLD.wallet_id
    AND OLD.source_generation + 1 = returned.retired_generation AND OLD.state = 'activated'
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_import_retained'); END;

DROP TRIGGER wallet_authorization_intake_retained;
CREATE TRIGGER wallet_authorization_intake_retained
BEFORE DELETE ON wallet_relocation_authorization_intakes
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_returns AS returned
  WHERE returned.namespace = OLD.namespace AND returned.org_id = OLD.org_id
    AND returned.project_id = OLD.project_id AND returned.env_id = OLD.env_id
    AND returned.wallet_id = OLD.wallet_id
    AND OLD.source_generation + 1 = returned.retired_generation AND OLD.state = 'verified'
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_intake_retained'); END;

DROP TRIGGER wallet_authorization_snapshot_delete;
CREATE TRIGGER wallet_authorization_snapshot_delete
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

DROP TRIGGER wallet_relocation_authorization_fences_retain;
CREATE TRIGGER wallet_relocation_authorization_fences_retain
BEFORE DELETE ON wallet_relocation_authorization_fences
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_returns AS returned
  WHERE returned.namespace = OLD.namespace AND returned.org_id = OLD.org_id
    AND returned.project_id = OLD.project_id AND returned.env_id = OLD.env_id
    AND returned.wallet_id = OLD.wallet_id AND OLD.source_generation = returned.retired_generation
    AND OLD.move_id = returned.previous_move_id
    AND OLD.request_digest_hex = returned.previous_request_digest_hex
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_fence_retained'); END;

DROP TRIGGER wallet_relocation_session_fences_retain;
CREATE TRIGGER wallet_relocation_session_fences_retain
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

DROP TRIGGER wallet_execution_retained;
CREATE TRIGGER wallet_execution_retained
BEFORE DELETE ON wallet_execution_generations
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_returns AS returned
  WHERE returned.namespace = OLD.namespace AND returned.org_id = OLD.org_id
    AND returned.project_id = OLD.project_id AND returned.env_id = OLD.env_id
    AND returned.wallet_id = OLD.wallet_id
    AND OLD.generation = returned.retired_generation AND OLD.state = 'retired'
)
BEGIN SELECT RAISE(ABORT, 'wallet_execution_identity_retained'); END;
