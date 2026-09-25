-- A VM Deriver's signed managed backups, one immutable artifact per role and
-- epoch, keyed by the same object key the Cloudflare R2 bucket uses.
CREATE TABLE local_tenant_root_managed_backups (
  object_key TEXT PRIMARY KEY NOT NULL,
  canonical_bytes BLOB NOT NULL
) STRICT;
