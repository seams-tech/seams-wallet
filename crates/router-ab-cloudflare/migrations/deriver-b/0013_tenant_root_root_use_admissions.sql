-- Root-using work admitted on an exact tenant-root epoch. An operation,
-- named by its authenticated custody binding, is admitted only while the
-- binding's epoch is active in this store: the insert is conditional on the
-- active row, so it is ordered exactly against the refresh swap that
-- retires the epoch. After the swap the retired share is readable only for
-- an operation admitted here before it, and an unused binding for the
-- retired epoch starts nothing. Admissions are the obligations a later
-- retirement must see settled before any erasure.
CREATE TABLE tenant_root_root_use_admissions (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = 'deriver_b'),
    custody_binding_digest_hex TEXT NOT NULL CHECK (
        length(custody_binding_digest_hex) = 64
        AND custody_binding_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    tenant_root_share_epoch INTEGER NOT NULL CHECK (tenant_root_share_epoch > 0),
    activation_receipt_digest_hex TEXT NOT NULL CHECK (
        length(activation_receipt_digest_hex) = 64
        AND activation_receipt_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    admitted_at_ms INTEGER NOT NULL CHECK (admitted_at_ms > 0),
    PRIMARY KEY (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        role,
        custody_binding_digest_hex
    )
);
