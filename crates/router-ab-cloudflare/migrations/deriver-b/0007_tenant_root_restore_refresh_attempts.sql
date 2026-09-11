CREATE TABLE tenant_root_restore_refresh_attempts (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    restore_session_id_hex TEXT NOT NULL CHECK (
        length(restore_session_id_hex) = 32
        AND restore_session_id_hex NOT GLOB '*[^0-9a-f]*'
    ),
    role TEXT NOT NULL CHECK (role = 'deriver_b'),
    generation INTEGER NOT NULL CHECK (generation > 0),
    import_key_id TEXT NOT NULL CHECK (length(import_key_id) BETWEEN 1 AND 128),
    import_replay_key_digest_hex TEXT NOT NULL CHECK (
        length(import_replay_key_digest_hex) = 64
        AND import_replay_key_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    import_command_digest_hex TEXT NOT NULL CHECK (
        length(import_command_digest_hex) = 64
        AND import_command_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    import_operation_digest_hex TEXT NOT NULL CHECK (
        length(import_operation_digest_hex) = 64
        AND import_operation_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    recovery_set_id_b64u TEXT NOT NULL CHECK (length(recovery_set_id_b64u) = 22),
    manifest_digest_hex TEXT NOT NULL CHECK (
        length(manifest_digest_hex) = 64
        AND manifest_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    stable_root_commitment_b64u TEXT NOT NULL CHECK (length(stable_root_commitment_b64u) = 43),
    share_commitment_b64u TEXT NOT NULL CHECK (length(share_commitment_b64u) = 46),
    destination_fingerprint_hex TEXT NOT NULL CHECK (
        length(destination_fingerprint_hex) = 64
        AND destination_fingerprint_hex NOT GLOB '*[^0-9a-f]*'
    ),
    import_public_key_b64u TEXT NOT NULL CHECK (length(import_public_key_b64u) = 43),
    import_issued_at_ms INTEGER NOT NULL CHECK (import_issued_at_ms > 0),
    import_expires_at_ms INTEGER NOT NULL CHECK (import_expires_at_ms > import_issued_at_ms),
    refresh_command_digest_hex TEXT NOT NULL CHECK (
        length(refresh_command_digest_hex) = 64
        AND refresh_command_digest_hex NOT GLOB '*[^0-9a-f]*'
    ),
    refresh_issued_at_ms INTEGER NOT NULL CHECK (refresh_issued_at_ms > 0),
    refresh_expires_at_ms INTEGER NOT NULL CHECK (refresh_expires_at_ms > refresh_issued_at_ms),
    admitted_at_ms INTEGER NOT NULL CHECK (admitted_at_ms > 0),
    encrypted_seed_json TEXT CHECK (
        encrypted_seed_json IS NULL OR json_valid(encrypted_seed_json)
    ),
    encrypted_refreshed_share_json TEXT CHECK (
        encrypted_refreshed_share_json IS NULL OR json_valid(encrypted_refreshed_share_json)
    ),
    installation_evidence_b64u TEXT CHECK (
        installation_evidence_b64u IS NULL OR length(installation_evidence_b64u) BETWEEN 1 AND 8192
    ),
    installation_evidence_digest_hex TEXT CHECK (
        installation_evidence_digest_hex IS NULL OR (
            length(installation_evidence_digest_hex) = 64
            AND installation_evidence_digest_hex NOT GLOB '*[^0-9a-f]*'
        )
    ),
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('pending', 'refreshed', 'closed')),
    refreshed_at_ms INTEGER CHECK (refreshed_at_ms IS NULL OR refreshed_at_ms >= admitted_at_ms),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
    PRIMARY KEY (import_replay_key_digest_hex),
    UNIQUE (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        restore_session_id_hex,
        role,
        generation
    ),
    CHECK (
        (lifecycle = 'pending'
            AND encrypted_seed_json IS NOT NULL
            AND encrypted_refreshed_share_json IS NULL
            AND installation_evidence_b64u IS NULL
            AND installation_evidence_digest_hex IS NULL
            AND refreshed_at_ms IS NULL)
        OR (lifecycle = 'refreshed'
            AND encrypted_seed_json IS NOT NULL
            AND encrypted_refreshed_share_json IS NOT NULL
            AND installation_evidence_b64u IS NOT NULL
            AND installation_evidence_digest_hex IS NOT NULL
            AND refreshed_at_ms IS NOT NULL)
        OR (lifecycle = 'closed'
            AND encrypted_seed_json IS NULL
            AND encrypted_refreshed_share_json IS NULL
            AND installation_evidence_b64u IS NULL
            AND installation_evidence_digest_hex IS NULL
            AND refreshed_at_ms IS NULL)
    )
);

CREATE INDEX tenant_root_restore_refresh_attempts_session
    ON tenant_root_restore_refresh_attempts (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        restore_session_id_hex,
        role,
        lifecycle
    );
