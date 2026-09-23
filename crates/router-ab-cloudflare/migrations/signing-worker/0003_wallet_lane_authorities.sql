CREATE TABLE wallet_lane_authorities (
    wallet_id TEXT PRIMARY KEY CHECK (length(wallet_id) > 0),
    lane_id TEXT NOT NULL CHECK (length(lane_id) > 0),
    lane_epoch INTEGER NOT NULL CHECK (lane_epoch > 0),
    directory_revision INTEGER NOT NULL CHECK (directory_revision > 0),
    lifecycle TEXT NOT NULL CHECK (
        lifecycle IN ('active', 'source_frozen', 'target_prepared', 'retired')
    ),
    migration_id TEXT,
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms > 0),
    CHECK (
        (lifecycle = 'active' AND migration_id IS NULL)
        OR (
            lifecycle <> 'active'
            AND migration_id IS NOT NULL
            AND length(migration_id) > 0
        )
    )
);
