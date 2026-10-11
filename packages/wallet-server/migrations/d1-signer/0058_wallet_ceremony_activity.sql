-- Ceremony state and its wallet activity projection commit in one transaction.
CREATE TABLE wallet_ceremony_activity (
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
CREATE INDEX wallet_ceremony_activity_by_wallet
  ON wallet_ceremony_activity (namespace, org_id, project_id, env_id, wallet_id, settled);

CREATE TRIGGER wallet_ceremony_activity_owner_immutable
BEFORE UPDATE ON wallet_ceremony_activity
WHEN NEW.wallet_id IS NOT OLD.wallet_id
BEGIN
  SELECT RAISE(ABORT, 'wallet_ceremony_owner_changed');
END;

CREATE TRIGGER wallet_ceremony_activity_retired_insert
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

CREATE TRIGGER wallet_ceremony_activity_retired_update
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

CREATE TRIGGER wallet_relocation_sessions_require_settled_ceremonies
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
