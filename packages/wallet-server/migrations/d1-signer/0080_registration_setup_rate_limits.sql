CREATE TABLE registration_setup_rate_limits (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    env_id TEXT NOT NULL,
    rate_key TEXT NOT NULL,
    consumed_count INTEGER NOT NULL CHECK (consumed_count BETWEEN 1 AND 30),
    reset_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, org_id, project_id, env_id, rate_key)
);
CREATE INDEX registration_setup_rate_limits_expiry ON registration_setup_rate_limits (reset_at_ms);
