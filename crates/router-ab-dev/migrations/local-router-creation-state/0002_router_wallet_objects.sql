-- The VM Router's wallet objects. Each wallet's rows are the storage keys the
-- Cloudflare Router wallet Durable Object keeps under its object name; values
-- are the same records, as JSON.
CREATE TABLE local_router_wallet_objects (
  object_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (object_name, storage_key)
) STRICT;
