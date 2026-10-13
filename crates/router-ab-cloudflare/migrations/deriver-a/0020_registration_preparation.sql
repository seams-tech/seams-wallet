-- A preparation reserves an epoch before the client supplies its encrypted input.
-- Binding the input clears this marker in the same transaction that reads the share.
ALTER TABLE tenant_root_root_use_admissions ADD COLUMN preparation_digest_hex TEXT
    CHECK (preparation_digest_hex IS NULL OR (
        length(preparation_digest_hex) = 64
        AND preparation_digest_hex NOT GLOB '*[^0-9a-f]*'
    ));
