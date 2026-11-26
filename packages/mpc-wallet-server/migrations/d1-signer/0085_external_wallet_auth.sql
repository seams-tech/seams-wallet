-- Reject unfinished transfers. Completed receipts remain immutable.
CREATE TABLE external_auth_relocation_upgrade_guard (count INTEGER NOT NULL CHECK (count = 0));
INSERT INTO external_auth_relocation_upgrade_guard
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
DROP TABLE external_auth_relocation_upgrade_guard;


-- External identity sessions grant settings reads only. Signing tables remain separate.
CREATE TABLE external_auth_associations (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  association_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  PRIMARY KEY (namespace, org_id, project_id, env_id, association_id)
);
CREATE UNIQUE INDEX external_auth_active_association
  ON external_auth_associations(namespace, org_id, project_id, env_id, wallet_id, provider_subject)
  WHERE status = 'active';

CREATE TABLE external_auth_attempts (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  -- Canonical JSON pair: wallet request origin and embedding application origin.
  origin TEXT NOT NULL,
  binding_hash TEXT NOT NULL,
  session_token_hash TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'verified', 'consumed', 'revoked')),
  association_id TEXT,
  trust_revision INTEGER,
  code_hash TEXT,
  session_expires_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, project_id, env_id, attempt_id),
  CHECK (status IN ('prepared', 'revoked') OR
    (association_id IS NOT NULL AND trust_revision IS NOT NULL AND code_hash IS NOT NULL
      AND session_expires_at_ms IS NOT NULL))
);
CREATE UNIQUE INDEX external_auth_session_token
  ON external_auth_attempts(namespace, org_id, project_id, env_id, session_token_hash);
CREATE INDEX external_auth_attempt_expiry ON external_auth_attempts(expires_at_ms);

CREATE TABLE external_auth_rate_limits (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  rate_key TEXT NOT NULL, consumed_count INTEGER NOT NULL, reset_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, project_id, env_id, rate_key)
);
CREATE INDEX external_auth_rate_expiry ON external_auth_rate_limits(reset_at_ms);

CREATE TRIGGER external_auth_associations_capacity_insert BEFORE INSERT ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER external_auth_associations_capacity_update BEFORE UPDATE ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER external_auth_associations_capacity_delete BEFORE DELETE ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  JOIN wallet_relocation_write_blocks AS block USING (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE block.state IN ('draining', 'checked') AND fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_relocation_write_blocked'); END;

CREATE TRIGGER external_auth_associations_relocation_frozen_insert
BEFORE INSERT ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
    AND fence.wallet_id = NEW.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER external_auth_associations_relocation_frozen_update
BEFORE UPDATE ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
    AND fence.wallet_id = OLD.wallet_id)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

CREATE TRIGGER external_auth_associations_relocation_frozen_delete
BEFORE DELETE ON external_auth_associations
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

CREATE TRIGGER external_auth_associations_relocation_inactive_insert
BEFORE INSERT ON external_auth_associations
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
      AND destination.state = 'importing' AND context.table_name = 'external_auth_associations'
      AND context.record_key = json_array(NEW.association_id, NEW.env_id, NEW.namespace, NEW.org_id, NEW.project_id))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER external_auth_associations_relocation_inactive_update
BEFORE UPDATE ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER external_auth_associations_relocation_inactive_delete
BEFORE DELETE ON external_auth_associations
WHEN EXISTS (SELECT 1 FROM wallet_relocation_authorization_imports AS destination
  WHERE destination.namespace = OLD.namespace AND destination.org_id = OLD.org_id
    AND destination.project_id = OLD.project_id AND destination.env_id = OLD.env_id
    AND destination.wallet_id = OLD.wallet_id AND destination.state != 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_destination_inactive'); END;

CREATE TRIGGER external_auth_associations_relocation_owner_immutable
BEFORE UPDATE ON external_auth_associations
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
BEGIN SELECT RAISE(ABORT, 'wallet_record_owner_changed'); END;
