-- A recovery set's retention key for this role, kept in the role store and
-- sealed to the role's own key, by a host without a destructible key provider
-- (the VM). Cloudflare keeps the key in Google Cloud KMS, and this table stays
-- empty there. Deleting a row is the only destruction such a host offers: a
-- snapshot or backup of the store may still hold it.
CREATE TABLE tenant_root_recovery_retention_keys (
    recovery_set_id_b64u TEXT NOT NULL CHECK (length(recovery_set_id_b64u) = 22),
    role TEXT NOT NULL CHECK (role = 'deriver_b'),
    key_version INTEGER NOT NULL CHECK (key_version > 0),
    sealed_key_json TEXT NOT NULL CHECK (length(sealed_key_json) BETWEEN 1 AND 4096),
    PRIMARY KEY (recovery_set_id_b64u, key_version)
);
