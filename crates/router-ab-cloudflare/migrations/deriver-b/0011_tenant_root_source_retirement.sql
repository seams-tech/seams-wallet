CREATE TABLE tenant_root_source_retirements (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (length(tenant_identity_digest_hex) = 64),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = 'deriver_b'),
    active_receipt_digest_b64u TEXT NOT NULL CHECK (length(active_receipt_digest_b64u) = 43),
    destination_receipt_digest_b64u TEXT NOT NULL CHECK (length(destination_receipt_digest_b64u) = 43),
    retired_at_ms INTEGER NOT NULL CHECK (retired_at_ms > 0),
    PRIMARY KEY (tenant_identity_digest_hex, custody_lineage_b64u)
);

CREATE TRIGGER tenant_root_role_shares_source_retired_insert
BEFORE INSERT ON tenant_root_role_shares
WHEN EXISTS (SELECT 1 FROM tenant_root_source_retirements
    WHERE tenant_identity_digest_hex = NEW.tenant_identity_digest_hex
      AND custody_lineage_b64u = NEW.custody_lineage_b64u)
BEGIN
    SELECT RAISE(ABORT, 'tenant root source lineage is retired');
END;

CREATE TRIGGER tenant_root_role_shares_source_retired_update
BEFORE UPDATE ON tenant_root_role_shares
WHEN EXISTS (SELECT 1 FROM tenant_root_source_retirements
    WHERE tenant_identity_digest_hex = NEW.tenant_identity_digest_hex
      AND custody_lineage_b64u = NEW.custody_lineage_b64u)
BEGIN
    SELECT RAISE(ABORT, 'tenant root source lineage is retired');
END;

CREATE TRIGGER tenant_root_command_replays_source_retired_insert
BEFORE INSERT ON tenant_root_command_replays
WHEN EXISTS (SELECT 1 FROM tenant_root_source_retirements
    WHERE tenant_identity_digest_hex = NEW.tenant_identity_digest_hex
      AND custody_lineage_b64u = NEW.custody_lineage_b64u)
BEGIN
    SELECT RAISE(ABORT, 'tenant root source lineage is retired');
END;

CREATE TRIGGER tenant_root_command_replays_source_retired_update
BEFORE UPDATE ON tenant_root_command_replays
WHEN EXISTS (SELECT 1 FROM tenant_root_source_retirements
    WHERE tenant_identity_digest_hex = NEW.tenant_identity_digest_hex
      AND custody_lineage_b64u = NEW.custody_lineage_b64u)
BEGIN
    SELECT RAISE(ABORT, 'tenant root source lineage is retired');
END;

CREATE TRIGGER tenant_root_restore_import_keys_source_retired_insert
BEFORE INSERT ON tenant_root_restore_import_keys
WHEN EXISTS (SELECT 1 FROM tenant_root_source_retirements
    WHERE tenant_identity_digest_hex = NEW.tenant_identity_digest_hex
      AND custody_lineage_b64u = NEW.custody_lineage_b64u)
BEGIN
    SELECT RAISE(ABORT, 'tenant root source lineage is retired');
END;

CREATE TRIGGER tenant_root_restore_import_keys_source_retired_update
BEFORE UPDATE ON tenant_root_restore_import_keys
WHEN EXISTS (SELECT 1 FROM tenant_root_source_retirements
    WHERE tenant_identity_digest_hex = NEW.tenant_identity_digest_hex
      AND custody_lineage_b64u = NEW.custody_lineage_b64u)
BEGIN
    SELECT RAISE(ABORT, 'tenant root source lineage is retired');
END;

CREATE TRIGGER tenant_root_restore_refresh_attempts_source_retired_insert
BEFORE INSERT ON tenant_root_restore_refresh_attempts
WHEN EXISTS (SELECT 1 FROM tenant_root_source_retirements
    WHERE tenant_identity_digest_hex = NEW.tenant_identity_digest_hex
      AND custody_lineage_b64u = NEW.custody_lineage_b64u)
BEGIN
    SELECT RAISE(ABORT, 'tenant root source lineage is retired');
END;

CREATE TRIGGER tenant_root_restore_refresh_attempts_source_retired_update
BEFORE UPDATE ON tenant_root_restore_refresh_attempts
WHEN EXISTS (SELECT 1 FROM tenant_root_source_retirements
    WHERE tenant_identity_digest_hex = NEW.tenant_identity_digest_hex
      AND custody_lineage_b64u = NEW.custody_lineage_b64u)
BEGIN
    SELECT RAISE(ABORT, 'tenant root source lineage is retired');
END;

CREATE TRIGGER tenant_root_recovery_attempts_source_retired_insert
BEFORE INSERT ON tenant_root_recovery_attempts
WHEN EXISTS (SELECT 1 FROM tenant_root_source_retirements
    WHERE tenant_identity_digest_hex = NEW.tenant_identity_digest_hex
      AND custody_lineage_b64u = NEW.custody_lineage_b64u) AND NEW.lifecycle IN ('provisioning','pending','packaged')
BEGIN
    SELECT RAISE(ABORT, 'tenant root source lineage is retired');
END;

CREATE TRIGGER tenant_root_recovery_attempts_source_retired_update
BEFORE UPDATE ON tenant_root_recovery_attempts
WHEN EXISTS (SELECT 1 FROM tenant_root_source_retirements
    WHERE tenant_identity_digest_hex = NEW.tenant_identity_digest_hex
      AND custody_lineage_b64u = NEW.custody_lineage_b64u) AND NEW.lifecycle IN ('provisioning','pending','packaged')
BEGIN
    SELECT RAISE(ABORT, 'tenant root source lineage is retired');
END;

