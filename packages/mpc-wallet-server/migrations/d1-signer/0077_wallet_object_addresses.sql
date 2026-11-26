CREATE TABLE wallet_object_addresses (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  ownership_generation INTEGER NOT NULL
    CHECK (ownership_generation > 0 AND ownership_generation <= 9007199254740991),
  router TEXT NOT NULL CHECK (length(router) = 64 AND router NOT GLOB '*[^a-f0-9]*'),
  deriver_a TEXT NOT NULL CHECK (length(deriver_a) = 64 AND deriver_a NOT GLOB '*[^a-f0-9]*'),
  deriver_b TEXT NOT NULL CHECK (length(deriver_b) = 64 AND deriver_b NOT GLOB '*[^a-f0-9]*'),
  signing_worker TEXT NOT NULL CHECK (length(signing_worker) = 64 AND signing_worker NOT GLOB '*[^a-f0-9]*'),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, ownership_generation)
);

-- A retry must use the winning allocation. Changing or deleting it would allow
-- two sets of custody objects to execute for the same ownership generation.
CREATE TRIGGER wallet_object_addresses_immutable
BEFORE UPDATE ON wallet_object_addresses
BEGIN SELECT RAISE(ABORT, 'wallet_object_addresses_immutable'); END;

CREATE TRIGGER wallet_object_addresses_retained
BEFORE DELETE ON wallet_object_addresses
BEGIN SELECT RAISE(ABORT, 'wallet_object_addresses_retained'); END;
