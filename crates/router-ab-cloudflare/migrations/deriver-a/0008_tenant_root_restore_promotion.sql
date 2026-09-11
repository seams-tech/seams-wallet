ALTER TABLE tenant_root_restore_refresh_attempts ADD COLUMN promotion_lifecycle TEXT NOT NULL DEFAULT 'unstarted' CHECK (
    promotion_lifecycle IN ('unstarted', 'reserved', 'completed')
);
ALTER TABLE tenant_root_restore_refresh_attempts ADD COLUMN promotion_reserved_at_ms INTEGER CHECK (
    promotion_reserved_at_ms IS NULL OR promotion_reserved_at_ms > 0
);
ALTER TABLE tenant_root_restore_refresh_attempts ADD COLUMN encrypted_online_role_share_json TEXT CHECK (
    encrypted_online_role_share_json IS NULL OR json_valid(encrypted_online_role_share_json)
);
ALTER TABLE tenant_root_restore_refresh_attempts ADD COLUMN provider_canary_receipt_b64u TEXT CHECK (
    provider_canary_receipt_b64u IS NULL OR length(provider_canary_receipt_b64u) BETWEEN 1 AND 32768
);
ALTER TABLE tenant_root_restore_refresh_attempts ADD COLUMN promotion_completed_at_ms INTEGER CHECK (
    promotion_completed_at_ms IS NULL OR promotion_completed_at_ms > 0
);

ALTER TABLE tenant_root_restore_import_sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'deriver_a' CHECK (
    role = 'deriver_a'
);
ALTER TABLE tenant_root_restore_import_sessions ADD COLUMN activation_operation TEXT CHECK (
    activation_operation IS NULL OR activation_operation = 'initial_creation'
);
ALTER TABLE tenant_root_restore_import_sessions ADD COLUMN activation_receipt_b64u TEXT CHECK (
    activation_receipt_b64u IS NULL OR length(activation_receipt_b64u) BETWEEN 1 AND 32768
);
ALTER TABLE tenant_root_restore_import_sessions ADD COLUMN activation_receipt_digest_hex TEXT CHECK (
    activation_receipt_digest_hex IS NULL OR (
        length(activation_receipt_digest_hex) = 64
        AND activation_receipt_digest_hex NOT GLOB '*[^0-9a-f]*'
    )
);
ALTER TABLE tenant_root_restore_import_sessions ADD COLUMN cleanup_receipt_b64u TEXT CHECK (
    cleanup_receipt_b64u IS NULL OR length(cleanup_receipt_b64u) BETWEEN 1 AND 32768
);
ALTER TABLE tenant_root_restore_import_sessions ADD COLUMN cleanup_receipt_digest_hex TEXT CHECK (
    cleanup_receipt_digest_hex IS NULL OR (
        length(cleanup_receipt_digest_hex) = 64
        AND cleanup_receipt_digest_hex NOT GLOB '*[^0-9a-f]*'
    )
);
