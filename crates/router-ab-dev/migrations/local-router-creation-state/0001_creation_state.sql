-- The VM Router's tenant-root creation state. Each tenant root's rows are the
-- storage keys the Cloudflare creation Durable Object keeps under its object
-- name; values are the same records, as JSON.
CREATE TABLE local_tenant_root_creation_state (
  object_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (object_name, storage_key)
) STRICT;
