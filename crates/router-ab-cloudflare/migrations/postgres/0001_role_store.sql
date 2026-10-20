-- PostgreSQL role-private schema. Apply once to an empty database.
CREATE TABLE tenant_root_command_replays (
    replay_key_digest_hex TEXT PRIMARY KEY CHECK (
        length(replay_key_digest_hex) = 64
        AND replay_key_digest_hex !~ '[^0-9a-f]'
    ),
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex !~ '[^0-9a-f]'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    session_id_hex TEXT NOT NULL CHECK (
        length(session_id_hex) = 32
        AND session_id_hex !~ '[^0-9a-f]'
    ),
    nonce_hex TEXT NOT NULL CHECK (
        length(nonce_hex) = 64
        AND nonce_hex !~ '[^0-9a-f]'
    ),
    role TEXT NOT NULL CHECK (role = public.tenant_root_store_role()),
    command_digest_hex TEXT NOT NULL CHECK (
        length(command_digest_hex) = 64
        AND command_digest_hex !~ '[^0-9a-f]'
    ),
    status TEXT NOT NULL CHECK (status IN ('reserved', 'executed', 'completed', 'failed')),
    receipt_b64u TEXT,
    receipt_digest_hex TEXT CHECK (
        receipt_digest_hex IS NULL OR (
            length(receipt_digest_hex) = 64
            AND receipt_digest_hex !~ '[^0-9a-f]'
        )
    ),
    reserved_at_ms BIGINT NOT NULL CHECK (reserved_at_ms > 0),
    executed_at_ms BIGINT,
    terminal_at_ms BIGINT,
    admission_digest_hex TEXT CHECK (
        admission_digest_hex IS NULL OR (
            length(admission_digest_hex) = 64
            AND admission_digest_hex !~ '[^0-9a-f]'
        )
    ),
    refresh_state_b64u TEXT CHECK (
        refresh_state_b64u IS NULL OR (
            length(refresh_state_b64u) > 0
            AND length(refresh_state_b64u) <= 174764
            AND refresh_state_b64u !~ '[^A-Za-z0-9_-]'
        )
    ),
    refresh_state_digest_hex TEXT CHECK (
        refresh_state_digest_hex IS NULL OR (
            length(refresh_state_digest_hex) = 64
            AND refresh_state_digest_hex !~ '[^0-9a-f]'
        )
    ),
    CHECK (
        (status = 'reserved' AND receipt_b64u IS NULL
            AND receipt_digest_hex IS NULL AND executed_at_ms IS NULL
            AND terminal_at_ms IS NULL)
        OR (status = 'executed' AND receipt_b64u IS NULL
            AND receipt_digest_hex IS NULL AND executed_at_ms IS NOT NULL
            AND executed_at_ms >= reserved_at_ms
            AND terminal_at_ms IS NULL)
        OR (status = 'completed' AND receipt_b64u IS NOT NULL
            AND length(receipt_b64u) > 0
            AND receipt_digest_hex IS NOT NULL
            AND executed_at_ms IS NOT NULL
            AND executed_at_ms >= reserved_at_ms
            AND terminal_at_ms IS NOT NULL
            AND terminal_at_ms >= executed_at_ms)
        OR (status = 'failed' AND receipt_b64u IS NOT NULL
            AND length(receipt_b64u) > 0
            AND receipt_digest_hex IS NOT NULL AND executed_at_ms IS NULL
            AND terminal_at_ms IS NOT NULL
            AND terminal_at_ms >= reserved_at_ms)
    )
);

CREATE TABLE tenant_root_creation_tombstones (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex !~ '[^0-9a-f]'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = public.tenant_root_store_role()),
    session_id_hex TEXT NOT NULL CHECK (
        length(session_id_hex) = 32
        AND session_id_hex !~ '[^0-9a-f]'
    ),
    created_at_ms BIGINT NOT NULL CHECK (created_at_ms > 0),
    PRIMARY KEY (tenant_identity_digest_hex, custody_lineage_b64u, role)
);

CREATE TABLE tenant_root_recovery_attempts (
    recovery_set_id_b64u TEXT PRIMARY KEY CHECK (length(recovery_set_id_b64u) = 22),
    tenant_identity_digest_hex TEXT NOT NULL CHECK (length(tenant_identity_digest_hex) = 64),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = public.tenant_root_store_role()),
    command_b64u TEXT NOT NULL CHECK (length(command_b64u) BETWEEN 1 AND 21846),
    admitted_at_ms BIGINT NOT NULL CHECK (admitted_at_ms > 0),
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('provisioning', 'pending', 'packaged', 'destroying', 'destruction_scheduled', 'destroyed')),
    encrypted_material_b64u TEXT,
    encrypted_package_b64u TEXT,
    package_digest_b64u TEXT,
    destruction_receipt TEXT,
    descriptor_b64u TEXT,
    package_length BIGINT,
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

CREATE TABLE tenant_root_recovery_retention_keys (
    recovery_set_id_b64u TEXT NOT NULL CHECK (length(recovery_set_id_b64u) = 22),
    role TEXT NOT NULL CHECK (role = public.tenant_root_store_role()),
    key_version BIGINT NOT NULL CHECK (key_version > 0),
    sealed_key_json TEXT NOT NULL CHECK (length(sealed_key_json) BETWEEN 1 AND 4096),
    PRIMARY KEY (recovery_set_id_b64u, key_version)
);

CREATE TABLE tenant_root_refresh_supersessions (
    replay_key_digest_hex TEXT PRIMARY KEY CHECK (
        length(replay_key_digest_hex) = 64
        AND replay_key_digest_hex !~ '[^0-9a-f]'
    ),
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex !~ '[^0-9a-f]'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = public.tenant_root_store_role()),
    superseded_by_replay_key_digest_hex TEXT NOT NULL CHECK (
        length(superseded_by_replay_key_digest_hex) = 64
        AND superseded_by_replay_key_digest_hex !~ '[^0-9a-f]'
    ),
    superseded_at_ms BIGINT NOT NULL CHECK (superseded_at_ms > 0)
);

CREATE TABLE tenant_root_restore_import_keys (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex !~ '[^0-9a-f]'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    restore_session_id_hex TEXT NOT NULL CHECK (
        length(restore_session_id_hex) = 32
        AND restore_session_id_hex !~ '[^0-9a-f]'
    ),
    role TEXT NOT NULL CHECK (role = public.tenant_root_store_role()),
    generation BIGINT NOT NULL CHECK (generation > 0),
    import_key_id TEXT NOT NULL CHECK (length(import_key_id) > 0),
    replay_key_digest_hex TEXT NOT NULL CHECK (
        length(replay_key_digest_hex) = 64
        AND replay_key_digest_hex !~ '[^0-9a-f]'
    ),
    command_digest_hex TEXT NOT NULL CHECK (
        length(command_digest_hex) = 64
        AND command_digest_hex !~ '[^0-9a-f]'
    ),
    operation_digest_hex TEXT NOT NULL CHECK (
        length(operation_digest_hex) = 64
        AND operation_digest_hex !~ '[^0-9a-f]'
    ),
    recovery_set_id_b64u TEXT NOT NULL CHECK (length(recovery_set_id_b64u) = 22),
    manifest_digest_hex TEXT NOT NULL CHECK (
        length(manifest_digest_hex) = 64
        AND manifest_digest_hex !~ '[^0-9a-f]'
    ),
    stable_root_commitment_b64u TEXT NOT NULL CHECK (length(stable_root_commitment_b64u) > 0),
    share_commitment_b64u TEXT NOT NULL CHECK (length(share_commitment_b64u) = 46),
    destination_fingerprint_hex TEXT NOT NULL CHECK (
        length(destination_fingerprint_hex) = 64
        AND destination_fingerprint_hex !~ '[^0-9a-f]'
    ),
    public_key_b64u TEXT NOT NULL CHECK (length(public_key_b64u) > 0),
    encrypted_ikm_json TEXT CHECK (
        encrypted_ikm_json IS NULL OR (encrypted_ikm_json IS JSON)
    ),
    envelope_digest_hex TEXT CHECK (
        envelope_digest_hex IS NULL OR (
            length(envelope_digest_hex) = 64
            AND envelope_digest_hex !~ '[^0-9a-f]'
        )
    ),
    encrypted_imported_share_json TEXT CHECK (
        encrypted_imported_share_json IS NULL OR (encrypted_imported_share_json IS JSON)
    ),
    issued_at_ms BIGINT NOT NULL CHECK (issued_at_ms > 0),
    expires_at_ms BIGINT NOT NULL CHECK (expires_at_ms > issued_at_ms),
    lifecycle TEXT NOT NULL CHECK (
        lifecycle IN ('issued', 'superseded', 'installed', 'expired', 'closed')
    ),
    installed_at_ms BIGINT,
    receipt_digest_hex TEXT CHECK (
        receipt_digest_hex IS NULL OR (
            length(receipt_digest_hex) = 64
            AND receipt_digest_hex !~ '[^0-9a-f]'
        )
    ),
    created_at_ms BIGINT NOT NULL CHECK (created_at_ms > 0),
    updated_at_ms BIGINT NOT NULL CHECK (updated_at_ms >= created_at_ms),
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

CREATE TABLE tenant_root_restore_import_sessions (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex !~ '[^0-9a-f]'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    restore_session_id_hex TEXT NOT NULL CHECK (
        length(restore_session_id_hex) = 32
        AND restore_session_id_hex !~ '[^0-9a-f]'
    ),
    closed_at_ms BIGINT NOT NULL CHECK (closed_at_ms > 0), role TEXT NOT NULL DEFAULT 'deriver_a' CHECK (
    role = public.tenant_root_store_role()
), activation_operation TEXT CHECK (
    activation_operation IS NULL OR activation_operation = 'initial_creation'
), activation_receipt_b64u TEXT CHECK (
    activation_receipt_b64u IS NULL OR length(activation_receipt_b64u) BETWEEN 1 AND 32768
), activation_receipt_digest_hex TEXT CHECK (
    activation_receipt_digest_hex IS NULL OR (
        length(activation_receipt_digest_hex) = 64
        AND activation_receipt_digest_hex !~ '[^0-9a-f]'
    )
), cleanup_receipt_b64u TEXT CHECK (
    cleanup_receipt_b64u IS NULL OR length(cleanup_receipt_b64u) BETWEEN 1 AND 32768
), cleanup_receipt_digest_hex TEXT CHECK (
    cleanup_receipt_digest_hex IS NULL OR (
        length(cleanup_receipt_digest_hex) = 64
        AND cleanup_receipt_digest_hex !~ '[^0-9a-f]'
    )
), cleanup_grant_b64u TEXT CHECK (
    cleanup_grant_b64u IS NULL OR (
        length(cleanup_grant_b64u) BETWEEN 1 AND 32768
        AND activation_operation IS NULL
        AND activation_receipt_b64u IS NULL
        AND activation_receipt_digest_hex IS NULL
    )
),
    PRIMARY KEY (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        restore_session_id_hex
    )
);

CREATE TABLE tenant_root_restore_refresh_attempts (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex !~ '[^0-9a-f]'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    restore_session_id_hex TEXT NOT NULL CHECK (
        length(restore_session_id_hex) = 32
        AND restore_session_id_hex !~ '[^0-9a-f]'
    ),
    role TEXT NOT NULL CHECK (role = public.tenant_root_store_role()),
    generation BIGINT NOT NULL CHECK (generation > 0),
    import_key_id TEXT NOT NULL CHECK (length(import_key_id) BETWEEN 1 AND 128),
    import_replay_key_digest_hex TEXT NOT NULL CHECK (
        length(import_replay_key_digest_hex) = 64
        AND import_replay_key_digest_hex !~ '[^0-9a-f]'
    ),
    import_command_digest_hex TEXT NOT NULL CHECK (
        length(import_command_digest_hex) = 64
        AND import_command_digest_hex !~ '[^0-9a-f]'
    ),
    import_operation_digest_hex TEXT NOT NULL CHECK (
        length(import_operation_digest_hex) = 64
        AND import_operation_digest_hex !~ '[^0-9a-f]'
    ),
    recovery_set_id_b64u TEXT NOT NULL CHECK (length(recovery_set_id_b64u) = 22),
    manifest_digest_hex TEXT NOT NULL CHECK (
        length(manifest_digest_hex) = 64
        AND manifest_digest_hex !~ '[^0-9a-f]'
    ),
    stable_root_commitment_b64u TEXT NOT NULL CHECK (length(stable_root_commitment_b64u) = 43),
    share_commitment_b64u TEXT NOT NULL CHECK (length(share_commitment_b64u) = 46),
    destination_fingerprint_hex TEXT NOT NULL CHECK (
        length(destination_fingerprint_hex) = 64
        AND destination_fingerprint_hex !~ '[^0-9a-f]'
    ),
    import_public_key_b64u TEXT NOT NULL CHECK (length(import_public_key_b64u) = 43),
    import_issued_at_ms BIGINT NOT NULL CHECK (import_issued_at_ms > 0),
    import_expires_at_ms BIGINT NOT NULL CHECK (import_expires_at_ms > import_issued_at_ms),
    refresh_command_digest_hex TEXT NOT NULL CHECK (
        length(refresh_command_digest_hex) = 64
        AND refresh_command_digest_hex !~ '[^0-9a-f]'
    ),
    refresh_issued_at_ms BIGINT NOT NULL CHECK (refresh_issued_at_ms > 0),
    refresh_expires_at_ms BIGINT NOT NULL CHECK (refresh_expires_at_ms > refresh_issued_at_ms),
    admitted_at_ms BIGINT NOT NULL CHECK (admitted_at_ms > 0),
    encrypted_seed_json TEXT CHECK (
        encrypted_seed_json IS NULL OR (encrypted_seed_json IS JSON)
    ),
    encrypted_refreshed_share_json TEXT CHECK (
        encrypted_refreshed_share_json IS NULL OR (encrypted_refreshed_share_json IS JSON)
    ),
    installation_evidence_b64u TEXT CHECK (
        installation_evidence_b64u IS NULL OR length(installation_evidence_b64u) BETWEEN 1 AND 8192
    ),
    installation_evidence_digest_hex TEXT CHECK (
        installation_evidence_digest_hex IS NULL OR (
            length(installation_evidence_digest_hex) = 64
            AND installation_evidence_digest_hex !~ '[^0-9a-f]'
        )
    ),
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('pending', 'refreshed', 'closed')),
    refreshed_at_ms BIGINT CHECK (refreshed_at_ms IS NULL OR refreshed_at_ms >= admitted_at_ms),
    created_at_ms BIGINT NOT NULL CHECK (created_at_ms > 0),
    updated_at_ms BIGINT NOT NULL CHECK (updated_at_ms >= created_at_ms), promotion_lifecycle TEXT NOT NULL DEFAULT 'unstarted' CHECK (
    promotion_lifecycle IN ('unstarted', 'reserved', 'completed')
), promotion_reserved_at_ms BIGINT CHECK (
    promotion_reserved_at_ms IS NULL OR promotion_reserved_at_ms > 0
), encrypted_online_role_share_json TEXT CHECK (
    encrypted_online_role_share_json IS NULL OR (encrypted_online_role_share_json IS JSON)
), provider_canary_receipt_b64u TEXT CHECK (
    provider_canary_receipt_b64u IS NULL OR length(provider_canary_receipt_b64u) BETWEEN 1 AND 32768
), promotion_completed_at_ms BIGINT CHECK (
    promotion_completed_at_ms IS NULL OR promotion_completed_at_ms > 0
),
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

CREATE TABLE tenant_root_role_shares (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex !~ '[^0-9a-f]'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    tenant_root_share_epoch BIGINT NOT NULL CHECK (tenant_root_share_epoch > 0),
    role TEXT NOT NULL CHECK (role = public.tenant_root_store_role()),
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('pending', 'active', 'retired')),
    ciphertext_json TEXT NOT NULL CHECK ((ciphertext_json IS JSON)),
    revision BIGINT NOT NULL CHECK (revision > 0),
    created_at_ms BIGINT NOT NULL CHECK (created_at_ms > 0),
    updated_at_ms BIGINT NOT NULL CHECK (updated_at_ms >= created_at_ms),
    PRIMARY KEY (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        tenant_root_share_epoch,
        role
    )
);

CREATE TABLE tenant_root_root_use_admissions (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (
        length(tenant_identity_digest_hex) = 64
        AND tenant_identity_digest_hex !~ '[^0-9a-f]'
    ),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = public.tenant_root_store_role()),
    attempt_kind TEXT NOT NULL CHECK (
        attempt_kind IN ('ed25519_yao_pair_session', 'ecdsa_operation')
    ),
    attempt_key_hex TEXT NOT NULL CHECK (
        length(attempt_key_hex) BETWEEN 32 AND 96
        AND attempt_key_hex !~ '[^0-9a-f]'
    ),
    tenant_root_share_epoch BIGINT NOT NULL CHECK (tenant_root_share_epoch > 0),
    activation_receipt_digest_hex TEXT NOT NULL CHECK (
        length(activation_receipt_digest_hex) = 64
        AND activation_receipt_digest_hex !~ '[^0-9a-f]'
    ),
    attempt_digest_hex TEXT NOT NULL CHECK (
        length(attempt_digest_hex) = 64
        AND attempt_digest_hex !~ '[^0-9a-f]'
    ),
    first_binding_digest_hex TEXT NOT NULL CHECK (
        length(first_binding_digest_hex) = 64
        AND first_binding_digest_hex !~ '[^0-9a-f]'
    ),
    issued_at_ms BIGINT NOT NULL CHECK (issued_at_ms > 0),
    expires_at_ms BIGINT NOT NULL CHECK (expires_at_ms > issued_at_ms),
    status TEXT NOT NULL CHECK (status IN ('admitted', 'claimed', 'settled', 'cancelled')),
    admitted_at_ms BIGINT NOT NULL CHECK (admitted_at_ms > 0),
    pair_object_id TEXT CHECK (
        pair_object_id IS NULL
        OR (attempt_kind = 'ed25519_yao_pair_session' AND length(pair_object_id) = 64 AND pair_object_id !~ '[^0-9a-f]')
    ),
    preparation_digest_hex TEXT
        CHECK (preparation_digest_hex IS NULL OR (
        length(preparation_digest_hex) = 64
        AND preparation_digest_hex !~ '[^0-9a-f]'
    )),
    PRIMARY KEY (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        role,
        attempt_kind,
        attempt_key_hex
    )
);

CREATE TABLE tenant_root_source_retirements (
    tenant_identity_digest_hex TEXT NOT NULL CHECK (length(tenant_identity_digest_hex) = 64),
    custody_lineage_b64u TEXT NOT NULL CHECK (length(custody_lineage_b64u) = 22),
    role TEXT NOT NULL CHECK (role = public.tenant_root_store_role()),
    active_receipt_digest_b64u TEXT NOT NULL CHECK (length(active_receipt_digest_b64u) = 43),
    destination_receipt_digest_b64u TEXT NOT NULL CHECK (length(destination_receipt_digest_b64u) = 43),
    retired_at_ms BIGINT NOT NULL CHECK (retired_at_ms > 0),
    PRIMARY KEY (tenant_identity_digest_hex, custody_lineage_b64u)
);

CREATE INDEX tenant_root_command_replays_tenant_status
    ON tenant_root_command_replays (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        role,
        status
    );

CREATE INDEX tenant_root_recovery_attempts_lineage ON tenant_root_recovery_attempts (tenant_identity_digest_hex, custody_lineage_b64u);

CREATE INDEX tenant_root_restore_import_keys_current
    ON tenant_root_restore_import_keys (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        restore_session_id_hex,
        role,
        generation DESC
    );

CREATE INDEX tenant_root_restore_refresh_attempts_session
    ON tenant_root_restore_refresh_attempts (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        restore_session_id_hex,
        role,
        lifecycle
    );

CREATE UNIQUE INDEX tenant_root_role_shares_active
    ON tenant_root_role_shares (tenant_identity_digest_hex, role)
    WHERE lifecycle = 'active';

CREATE INDEX tenant_root_role_shares_lifecycle
    ON tenant_root_role_shares (
        tenant_identity_digest_hex,
        role,
        lifecycle,
        tenant_root_share_epoch
    );

CREATE INDEX tenant_root_root_use_admissions_by_attempt
    ON tenant_root_root_use_admissions (role, attempt_kind, attempt_key_hex);

CREATE INDEX tenant_root_root_use_admissions_by_epoch
    ON tenant_root_root_use_admissions (
        tenant_identity_digest_hex,
        custody_lineage_b64u,
        tenant_root_share_epoch,
        status
    );

-- A retired lineage cannot regain live role or recovery material.
CREATE FUNCTION public.reject_retired_tenant_root_lineage() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'tenant_root_recovery_attempts' THEN
        IF NEW.lifecycle NOT IN ('provisioning', 'pending', 'packaged') THEN
            RETURN NEW;
        END IF;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.tenant_root_source_retirements
        WHERE tenant_identity_digest_hex = NEW.tenant_identity_digest_hex
          AND custody_lineage_b64u = NEW.custody_lineage_b64u
    ) THEN
        RAISE EXCEPTION 'tenant root source lineage is retired' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_root_role_shares_source_retired
BEFORE INSERT OR UPDATE ON tenant_root_role_shares
FOR EACH ROW EXECUTE FUNCTION public.reject_retired_tenant_root_lineage();

CREATE TRIGGER tenant_root_command_replays_source_retired
BEFORE INSERT OR UPDATE ON tenant_root_command_replays
FOR EACH ROW EXECUTE FUNCTION public.reject_retired_tenant_root_lineage();

CREATE TRIGGER tenant_root_restore_import_keys_source_retired
BEFORE INSERT OR UPDATE ON tenant_root_restore_import_keys
FOR EACH ROW EXECUTE FUNCTION public.reject_retired_tenant_root_lineage();

CREATE TRIGGER tenant_root_restore_refresh_attempts_source_retired
BEFORE INSERT OR UPDATE ON tenant_root_restore_refresh_attempts
FOR EACH ROW EXECUTE FUNCTION public.reject_retired_tenant_root_lineage();

CREATE TRIGGER tenant_root_recovery_attempts_source_retired
BEFORE INSERT OR UPDATE ON tenant_root_recovery_attempts
FOR EACH ROW EXECUTE FUNCTION public.reject_retired_tenant_root_lineage();
