-- Abandoned tenant-root creation ceremonies. When the Router abandons an
-- uncommitted creation, this role's pending initial material for the
-- ceremony is removed and a tombstone is written in the same batch. The
-- initial pending insert refuses a lineage with a tombstone, so a creation
-- command admitted before the ceremony window closed cannot write its row
-- after the cleanup.
CREATE TABLE tenant_root_creation_tombstones (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = 'deriver_a'),
    session_id_hex TEXT NOT NULL CHECK (
        length(session_id_hex) = 32
        AND session_id_hex NOT GLOB '*[^0-9a-f]*'
    ),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
    PRIMARY KEY (tenant_identity_digest_hex, custody_lineage_b64u, role)
);
