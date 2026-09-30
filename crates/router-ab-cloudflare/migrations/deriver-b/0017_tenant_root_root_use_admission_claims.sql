-- Root-use admissions gain the executor's claim and the pair's owner
-- (docs/refactor-150-admission-identity.md).
-- - 'claimed': Deriver A's executor claimed its pair, the last durable step
--   before its first protocol message. A claimed admission settles only when
--   its pair completes. Recovery never cancels it.
-- - pair_object_name: the wallet object that holds the attempt's pair.
--   NULL when the pair is in this role store; ECDSA admissions have no pair.
-- Test wallets are disposable, so the table is recreated rather than migrated.
DROP TABLE tenant_root_root_use_admissions;

CREATE TABLE tenant_root_root_use_admissions (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = 'deriver_b'),
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
    status TEXT NOT NULL CHECK (status IN ('admitted', 'claimed', 'settled', 'cancelled')),
    admitted_at_ms INTEGER NOT NULL CHECK (admitted_at_ms > 0),
    pair_object_name TEXT CHECK (
        pair_object_name IS NULL
        OR (attempt_kind = 'ed25519_yao_pair_session' AND length(pair_object_name) BETWEEN 1 AND 128)
    ),
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

CREATE INDEX tenant_root_root_use_admissions_by_attempt
    ON tenant_root_root_use_admissions (role, attempt_kind, attempt_key_hex);
