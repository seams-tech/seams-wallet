CREATE TABLE IF NOT EXISTS managed_wallet_lanes (
  lane_id TEXT NOT NULL,
  product_region TEXT NOT NULL,
  status TEXT NOT NULL,
  router_binding TEXT NOT NULL,
  deriver_a_binding TEXT NOT NULL,
  deriver_b_binding TEXT NOT NULL,
  signing_worker_binding TEXT NOT NULL,
  placement_evidence_json TEXT NOT NULL,
  configuration_version INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (lane_id, configuration_version),
  CHECK (lane_id IN ('managed-na-v1', 'managed-eu-v1', 'managed-apac-v1')),
  CHECK (product_region IN ('north_america', 'europe', 'asia_pacific')),
  CHECK (
    (lane_id = 'managed-na-v1' AND product_region = 'north_america') OR
    (lane_id = 'managed-eu-v1' AND product_region = 'europe') OR
    (lane_id = 'managed-apac-v1' AND product_region = 'asia_pacific')
  ),
  CHECK (status IN ('provisioning', 'available', 'draining', 'unavailable')),
  CHECK (json_valid(placement_evidence_json)),
  CHECK (configuration_version > 0),
  CHECK (created_at_ms > 0),
  CHECK (
    status NOT IN ('available', 'draining') OR
    json_extract(placement_evidence_json, '$.kind') = 'verified'
  )
);

CREATE TABLE IF NOT EXISTS active_managed_wallet_lanes (
  lane_id TEXT PRIMARY KEY,
  configuration_version INTEGER NOT NULL,
  activated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (lane_id, configuration_version)
    REFERENCES managed_wallet_lanes(lane_id, configuration_version),
  CHECK (activated_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS wallet_home_lanes (
  wallet_id TEXT PRIMARY KEY,
  lane_id TEXT NOT NULL,
  lane_epoch INTEGER NOT NULL,
  directory_revision INTEGER NOT NULL,
  migration_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (length(wallet_id) > 0),
  CHECK (length(lane_id) > 0),
  CHECK (lane_epoch > 0),
  CHECK (directory_revision > 0),
  CHECK (migration_id IS NULL OR length(migration_id) > 0),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms >= created_at_ms)
);

CREATE INDEX IF NOT EXISTS wallet_home_lanes_lane_lookup
  ON wallet_home_lanes (lane_id, lane_epoch, wallet_id);

CREATE TABLE IF NOT EXISTS wallet_region_migration_grants (
  grant_digest_b64u TEXT PRIMARY KEY,
  migration_id TEXT NOT NULL UNIQUE,
  wallet_id TEXT NOT NULL,
  grant_json TEXT NOT NULL,
  status TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  CHECK (json_valid(grant_json)),
  CHECK (json_extract(grant_json, '$.grantDigest') = grant_digest_b64u),
  CHECK (json_extract(grant_json, '$.migrationId') = migration_id),
  CHECK (json_extract(grant_json, '$.walletId') = wallet_id),
  CHECK (status IN ('issued', 'consumed')),
  CHECK (expires_at > issued_at),
  CHECK (
    (status = 'issued' AND consumed_at_ms IS NULL) OR
    (status = 'consumed' AND consumed_at_ms IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS wallet_region_migrations (
  migration_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  state_kind TEXT NOT NULL,
  record_json TEXT NOT NULL,
  record_revision INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (wallet_id) REFERENCES wallet_home_lanes(wallet_id),
  CHECK (state_kind IN (
    'authorized',
    'source_frozen',
    'target_verified',
    'cutover_committed',
    'completed'
  )),
  CHECK (json_valid(record_json)),
  CHECK (json_extract(record_json, '$.migrationId') = migration_id),
  CHECK (json_extract(record_json, '$.walletId') = wallet_id),
  CHECK (json_extract(record_json, '$.kind') = state_kind),
  CHECK (record_revision > 0),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms >= created_at_ms)
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_region_migrations_active_wallet
  ON wallet_region_migrations (wallet_id)
  WHERE state_kind <> 'completed';

CREATE TABLE IF NOT EXISTS wallet_region_cutovers (
  migration_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  source_lane_id TEXT NOT NULL,
  source_epoch INTEGER NOT NULL,
  target_lane_id TEXT NOT NULL,
  target_epoch INTEGER NOT NULL,
  directory_revision INTEGER NOT NULL,
  receipt_json TEXT NOT NULL,
  committed_at_ms INTEGER NOT NULL,
  FOREIGN KEY (migration_id) REFERENCES wallet_region_migrations(migration_id),
  FOREIGN KEY (wallet_id) REFERENCES wallet_home_lanes(wallet_id),
  CHECK (source_lane_id <> target_lane_id),
  CHECK (target_epoch = source_epoch + 1),
  CHECK (directory_revision > 1),
  CHECK (json_valid(receipt_json)),
  CHECK (committed_at_ms > 0)
);

CREATE TRIGGER IF NOT EXISTS managed_wallet_lanes_immutable_update
BEFORE UPDATE ON managed_wallet_lanes
BEGIN
  SELECT RAISE(ABORT, 'managed wallet lane configurations are immutable');
END;

CREATE TRIGGER IF NOT EXISTS managed_wallet_lanes_immutable_delete
BEFORE DELETE ON managed_wallet_lanes
BEGIN
  SELECT RAISE(ABORT, 'managed wallet lane configurations are immutable');
END;

CREATE TRIGGER IF NOT EXISTS wallet_home_lanes_valid_update
BEFORE UPDATE ON wallet_home_lanes
WHEN NOT (
  NEW.wallet_id = OLD.wallet_id AND
  NEW.created_at_ms = OLD.created_at_ms AND
  NEW.updated_at_ms >= OLD.updated_at_ms AND
  (
    (
      NEW.lane_id = OLD.lane_id AND
      NEW.lane_epoch = OLD.lane_epoch AND
      NEW.directory_revision = OLD.directory_revision AND
      OLD.migration_id IS NULL AND
      NEW.migration_id IS NOT NULL
    ) OR
    (
      NEW.lane_id <> OLD.lane_id AND
      NEW.lane_epoch = OLD.lane_epoch + 1 AND
      NEW.directory_revision = OLD.directory_revision + 1 AND
      OLD.migration_id IS NOT NULL AND
      NEW.migration_id = OLD.migration_id
    ) OR
    (
      NEW.lane_id = OLD.lane_id AND
      NEW.lane_epoch = OLD.lane_epoch AND
      NEW.directory_revision = OLD.directory_revision AND
      OLD.migration_id IS NOT NULL AND
      NEW.migration_id IS NULL
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'wallet Home lane update violates the migration lifecycle');
END;

CREATE TRIGGER IF NOT EXISTS wallet_home_lanes_immutable_delete
BEFORE DELETE ON wallet_home_lanes
BEGIN
  SELECT RAISE(ABORT, 'wallet Home lane assignments are durable');
END;

CREATE TRIGGER IF NOT EXISTS wallet_region_grants_valid_update
BEFORE UPDATE ON wallet_region_migration_grants
WHEN NOT (
  NEW.grant_digest_b64u = OLD.grant_digest_b64u AND
  NEW.migration_id = OLD.migration_id AND
  NEW.wallet_id = OLD.wallet_id AND
  NEW.grant_json = OLD.grant_json AND
  NEW.issued_at = OLD.issued_at AND
  NEW.expires_at = OLD.expires_at AND
  OLD.status = 'issued' AND
  OLD.consumed_at_ms IS NULL AND
  NEW.status = 'consumed' AND
  NEW.consumed_at_ms IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'wallet region migration grant update is invalid');
END;

CREATE TRIGGER IF NOT EXISTS wallet_region_grants_immutable_delete
BEFORE DELETE ON wallet_region_migration_grants
BEGIN
  SELECT RAISE(ABORT, 'wallet region migration grants are durable audit records');
END;

CREATE TRIGGER IF NOT EXISTS wallet_region_migrations_valid_update
BEFORE UPDATE ON wallet_region_migrations
WHEN NOT (
  NEW.migration_id = OLD.migration_id AND
  NEW.wallet_id = OLD.wallet_id AND
  NEW.record_revision = OLD.record_revision + 1 AND
  NEW.created_at_ms = OLD.created_at_ms AND
  NEW.updated_at_ms >= OLD.updated_at_ms AND
  (
    (OLD.state_kind = 'authorized' AND NEW.state_kind = 'source_frozen') OR
    (OLD.state_kind = 'source_frozen' AND NEW.state_kind = 'target_verified') OR
    (OLD.state_kind = 'target_verified' AND NEW.state_kind = 'cutover_committed') OR
    (OLD.state_kind = 'cutover_committed' AND NEW.state_kind = 'completed')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'wallet region migration transition is invalid');
END;

CREATE TRIGGER IF NOT EXISTS wallet_region_migrations_immutable_delete
BEFORE DELETE ON wallet_region_migrations
BEGIN
  SELECT RAISE(ABORT, 'wallet region migrations are durable audit records');
END;

CREATE TRIGGER IF NOT EXISTS wallet_region_cutovers_immutable_update
BEFORE UPDATE ON wallet_region_cutovers
BEGIN
  SELECT RAISE(ABORT, 'wallet region cutover receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS wallet_region_cutovers_immutable_delete
BEFORE DELETE ON wallet_region_cutovers
BEGIN
  SELECT RAISE(ABORT, 'wallet region cutover receipts are immutable');
END;
