CREATE TABLE tenant_root_recovery_attempts (
    recovery_set_id_b64u TEXT PRIMARY KEY CHECK (length(recovery_set_id_b64u) = 22),
    tenant_identity_digest_hex TEXT NOT NULL CHECK (length(tenant_identity_digest_hex) = 64),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = 'deriver_a'),
    command_b64u TEXT NOT NULL CHECK (length(command_b64u) BETWEEN 1 AND 21846),
    admitted_at_ms INTEGER NOT NULL CHECK (admitted_at_ms > 0),
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('provisioning', 'pending', 'packaged', 'destroying', 'destruction_scheduled', 'destroyed')),
    encrypted_material_b64u TEXT,
    encrypted_package_b64u TEXT,
    package_digest_b64u TEXT,
    destruction_receipt TEXT,
    descriptor_b64u TEXT,
    package_length INTEGER,
    CHECK (
        (lifecycle = 'packaged' AND descriptor_b64u IS NOT NULL AND length(descriptor_b64u) BETWEEN 1 AND 21846 AND package_length IS NOT NULL AND package_length BETWEEN 1 AND 16384)
        OR (lifecycle <> 'packaged' AND descriptor_b64u IS NULL AND package_length IS NULL)
    ),
    CHECK (
        (lifecycle IN ('provisioning', 'destroying') AND encrypted_material_b64u IS NULL AND encrypted_package_b64u IS NULL AND package_digest_b64u IS NULL AND destruction_receipt IS NULL)
        OR (lifecycle = 'pending' AND encrypted_material_b64u IS NOT NULL AND encrypted_package_b64u IS NULL AND package_digest_b64u IS NULL AND destruction_receipt IS NULL)
        OR (lifecycle = 'packaged' AND encrypted_material_b64u IS NULL AND encrypted_package_b64u IS NOT NULL AND package_digest_b64u IS NOT NULL AND length(package_digest_b64u) = 43 AND destruction_receipt IS NULL)
        OR (lifecycle IN ('destruction_scheduled', 'destroyed') AND encrypted_material_b64u IS NULL AND encrypted_package_b64u IS NULL AND package_digest_b64u IS NULL AND destruction_receipt IS NOT NULL)
    )
);
CREATE INDEX tenant_root_recovery_attempts_lineage ON tenant_root_recovery_attempts (tenant_identity_digest_hex, custody_lineage_b64u);
