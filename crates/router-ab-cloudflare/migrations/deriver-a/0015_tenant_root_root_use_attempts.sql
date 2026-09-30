-- Root-use admissions keyed by execution attempt (docs/refactor-150-admission-identity.md).
-- An Ed25519 Yao attempt is its canonical pair session, the pair stores' own
-- key, and stays on the epoch it was admitted on. An ECDSA attempt is its
-- operation on one epoch. Every other custody-binding field but the window is
-- compared through attempt_digest_hex; the first admitted binding's digest and
-- window are kept. Status moves once from 'admitted' when settlement lands.
-- Test wallets are disposable, so the table is recreated rather than migrated.
DROP TABLE tenant_root_root_use_admissions;

CREATE TABLE tenant_root_root_use_admissions (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = 'deriver_a'),
    attempt_kind TEXT NOT NULL CHECK (
        attempt_kind IN ('ed25519_yao_pair_session', 'ecdsa_operation')
    ),
    attempt_key_hex TEXT NOT NULL CHECK (
        length(attempt_key_hex) BETWEEN 32 AND 96
        AND attempt_key_hex NOT GLOB '*[^0-9a-f]*'
    ),
    tenant_root_share_epoch INTEGER NOT NULL CHECK (tenant_root_share_epoch > 0),
    activation_receipt_digest_hex TEXT NOT NULL CHECK (
        length(activation_receipt_digest_hex) = 64
        AND activation_receipt_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    attempt_digest_hex TEXT NOT NULL CHECK (
        length(attempt_digest_hex) = 64
        AND attempt_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    first_binding_digest_hex TEXT NOT NULL CHECK (
        length(first_binding_digest_hex) = 64
        AND first_binding_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms > 0),
    expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > issued_at_ms),
    status TEXT NOT NULL CHECK (status IN ('admitted', 'settled', 'cancelled')),
    admitted_at_ms INTEGER NOT NULL CHECK (admitted_at_ms > 0),
    PRIMARY KEY (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        role,
        attempt_kind,
        attempt_key_hex
    )
);

CREATE INDEX tenant_root_root_use_admissions_by_epoch
    ON tenant_root_root_use_admissions (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        tenant_root_share_epoch,
        status
    );
