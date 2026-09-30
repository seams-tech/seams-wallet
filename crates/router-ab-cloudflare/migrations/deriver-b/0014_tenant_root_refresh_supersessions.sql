-- Refresh attempts replaced by a later attempt of the same epoch transition.
-- The Router abandons an attempt whose ceremony window closed before it was
-- committed, and reserves the next one. That next attempt, confirmed as the
-- Router's current attempt, records each older attempt here in the same batch
-- that replaces the pending row the older attempt left. A superseded attempt's
-- own checkpoints refuse from then on, so it cannot write that row back, and
-- only its exact backup and canary may be replaced at the epoch's coordinates.
CREATE TABLE tenant_root_refresh_supersessions (
    replay_key_digest_hex TEXT PRIMARY KEY CHECK (
        length(replay_key_digest_hex) = 64
        AND replay_key_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = 'deriver_b'),
    superseded_by_replay_key_digest_hex TEXT NOT NULL CHECK (
        length(superseded_by_replay_key_digest_hex) = 64
        AND superseded_by_replay_key_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    superseded_at_ms INTEGER NOT NULL CHECK (superseded_at_ms > 0)
);
