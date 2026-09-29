-- A pair store settles an admission by its attempt when the pair's record
-- becomes terminal (docs/refactor-150-admission-identity.md). The lookup names
-- role, attempt kind and key; this index serves it.
CREATE INDEX tenant_root_root_use_admissions_by_attempt
    ON tenant_root_root_use_admissions (role, attempt_kind, attempt_key_hex);
