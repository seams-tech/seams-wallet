-- Wallet admissions retain the exact object address for later reconciliation.
-- Existing named-address wallets must be discarded before activating this release.
ALTER TABLE tenant_root_root_use_admissions RENAME COLUMN pair_object_name TO pair_object_id;
CREATE TRIGGER tenant_root_pair_object_id_insert
BEFORE INSERT ON tenant_root_root_use_admissions
WHEN NEW.pair_object_id IS NOT NULL
 AND (length(NEW.pair_object_id) != 64 OR NEW.pair_object_id GLOB '*[^0-9a-f]*')
BEGIN
  SELECT RAISE(ABORT, 'wallet pair admission requires a Durable Object ID');
END;
