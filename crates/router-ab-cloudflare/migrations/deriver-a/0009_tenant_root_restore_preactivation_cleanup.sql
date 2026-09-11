ALTER TABLE tenant_root_restore_import_sessions ADD COLUMN cleanup_grant_b64u TEXT CHECK (
    cleanup_grant_b64u IS NULL OR (
        length(cleanup_grant_b64u) BETWEEN 1 AND 32768
        AND activation_operation IS NULL
        AND activation_receipt_b64u IS NULL
        AND activation_receipt_digest_hex IS NULL
    )
);
