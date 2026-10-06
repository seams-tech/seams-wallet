-- Execution location is metadata. It is not part of a wallet's cipher identity.
CREATE TABLE wallet_execution_upgrade_guard (count INTEGER NOT NULL CHECK(count = 0));
INSERT INTO wallet_execution_upgrade_guard
SELECT (SELECT COUNT(*) FROM wallet_relocation_authorization_snapshots)
     + (SELECT COUNT(*) FROM wallet_relocation_authorization_imports);
DROP TABLE wallet_execution_upgrade_guard;

CREATE TABLE wallet_execution_generations (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0 AND generation <= 9007199254740991),
  origin TEXT NOT NULL CHECK(origin IN ('registration', 'relocation')),
  origin_id TEXT NOT NULL CHECK(length(origin_id) > 0),
  state TEXT NOT NULL CHECK(state IN ('registering', 'inactive', 'active', 'retired')),
  CHECK((origin = 'registration' AND state != 'inactive') OR
        (origin = 'relocation' AND state != 'registering')),
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id)
);

CREATE TRIGGER wallet_execution_identity_immutable
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

CREATE TRIGGER wallet_execution_retained
BEFORE DELETE ON wallet_execution_generations
BEGIN SELECT RAISE(ABORT, 'wallet_execution_identity_retained'); END;

CREATE TRIGGER wallet_execution_activation_receipt
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

CREATE TRIGGER wallet_execution_source_closed
BEFORE INSERT ON wallet_execution_generations
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'wallet_execution_source_closed'); END;

CREATE TRIGGER wallet_execution_destination_prepare
AFTER INSERT ON wallet_relocation_authorization_imports
BEGIN
  INSERT INTO wallet_execution_generations
    (namespace, org_id, project_id, env_id, wallet_id, generation, origin, origin_id, state)
  VALUES (NEW.namespace, NEW.org_id, NEW.project_id, NEW.env_id, NEW.wallet_id,
    NEW.source_generation + 1, 'relocation', NEW.move_id, 'inactive');
END;

CREATE TRIGGER wallet_execution_destination_activate
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

CREATE TRIGGER wallet_execution_source_retire
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
