CREATE TABLE tenant_root_restore_import_sessions (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    restore_session_id_hex TEXT NOT NULL CHECK (
        length(restore_session_id_hex) = 32
        AND restore_session_id_hex NOT GLOB '*[^0-9a-f]*'
    ),
    closed_at_ms INTEGER NOT NULL CHECK (closed_at_ms > 0),
    PRIMARY KEY (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        restore_session_id_hex
    )
);

CREATE TABLE tenant_root_restore_import_keys (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    restore_session_id_hex TEXT NOT NULL CHECK (
        length(restore_session_id_hex) = 32
        AND restore_session_id_hex NOT GLOB '*[^0-9a-f]*'
    ),
    role TEXT NOT NULL CHECK (role = 'deriver_a'),
    generation INTEGER NOT NULL CHECK (generation > 0),
    import_key_id TEXT NOT NULL CHECK (length(import_key_id) > 0),
    replay_key_digest_hex TEXT NOT NULL CHECK (
        length(replay_key_digest_hex) = 64
        AND replay_key_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    command_digest_hex TEXT NOT NULL CHECK (
        length(command_digest_hex) = 64
        AND command_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    operation_digest_hex TEXT NOT NULL CHECK (
        length(operation_digest_hex) = 64
        AND operation_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    recovery_set_id_b64u TEXT NOT NULL CHECK (length(recovery_set_id_b64u) = 22),
    manifest_digest_hex TEXT NOT NULL CHECK (
        length(manifest_digest_hex) = 64
        AND manifest_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    stable_root_commitment_b64u TEXT NOT NULL CHECK (length(stable_root_commitment_b64u) > 0),
    share_commitment_b64u TEXT NOT NULL CHECK (length(share_commitment_b64u) = 46),
    destination_fingerprint_hex TEXT NOT NULL CHECK (
        length(destination_fingerprint_hex) = 64
        AND destination_fingerprint_hex NOT GLOB '*[^0-9a-f]*'
    ),
    public_key_b64u TEXT NOT NULL CHECK (length(public_key_b64u) > 0),
    encrypted_ikm_json TEXT CHECK (
        encrypted_ikm_json IS NULL OR json_valid(encrypted_ikm_json)
    ),
    envelope_digest_hex TEXT CHECK (
        envelope_digest_hex IS NULL OR (
            length(envelope_digest_hex) = 64
            AND envelope_digest_hex NOT GLOB '*[^0-9a-f]*'
        )
    ),
    encrypted_imported_share_json TEXT CHECK (
        encrypted_imported_share_json IS NULL OR json_valid(encrypted_imported_share_json)
    ),
    issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms > 0),
    expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > issued_at_ms),
    lifecycle TEXT NOT NULL CHECK (
        lifecycle IN ('issued', 'superseded', 'installed', 'expired', 'closed')
    ),
    installed_at_ms INTEGER,
    receipt_digest_hex TEXT CHECK (
        receipt_digest_hex IS NULL OR (
            length(receipt_digest_hex) = 64
            AND receipt_digest_hex NOT GLOB '*[^0-9a-f]*'
        )
    ),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
    PRIMARY KEY (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        restore_session_id_hex,
        role,
        generation
    ),
    UNIQUE (replay_key_digest_hex),
    UNIQUE (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        restore_session_id_hex,
        role,
        import_key_id
    ),
    CHECK (
        (lifecycle IN ('issued', 'superseded', 'expired', 'closed')
            AND installed_at_ms IS NULL AND receipt_digest_hex IS NULL
            AND envelope_digest_hex IS NULL AND encrypted_imported_share_json IS NULL
            AND (lifecycle = 'closed') = (encrypted_ikm_json IS NULL))
        OR (lifecycle = 'installed'
            AND installed_at_ms IS NOT NULL
            AND installed_at_ms >= issued_at_ms
            AND receipt_digest_hex IS NOT NULL
            AND envelope_digest_hex IS NOT NULL
            AND encrypted_imported_share_json IS NOT NULL
            AND encrypted_ikm_json IS NOT NULL)
    )
);

CREATE INDEX tenant_root_restore_import_keys_current
    ON tenant_root_restore_import_keys (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        restore_session_id_hex,
        role,
        generation DESC
    );
