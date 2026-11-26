CREATE TABLE wallet_relocation_authorization_cleanups (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  command_digest TEXT NOT NULL CHECK(length(command_digest) = 64 AND command_digest NOT GLOB '*[^a-f0-9]*'),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  state TEXT NOT NULL CHECK(state IN ('cleaning', 'cleaned')),
  completed_at_ms INTEGER,
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id, move_id),
  CHECK((state = 'cleaning' AND completed_at_ms IS NULL)
    OR (state = 'cleaned' AND completed_at_ms > 0 AND completed_at_ms IS NOT NULL))
);
CREATE TRIGGER wallet_authorization_cleanup_frozen
BEFORE INSERT ON wallet_relocation_authorization_cleanups
WHEN NEW.state != 'cleaning' OR NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_snapshots AS snapshot
  JOIN wallet_relocation_authorization_fences AS fence
    USING(namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE snapshot.namespace = NEW.namespace AND snapshot.org_id = NEW.org_id
    AND snapshot.project_id = NEW.project_id AND snapshot.env_id = NEW.env_id
    AND snapshot.wallet_id = NEW.wallet_id AND snapshot.move_id = NEW.move_id
    AND snapshot.request_digest_hex = NEW.request_digest_hex AND snapshot.source_generation = NEW.source_generation
    AND snapshot.state = 'sealed' AND snapshot.digest_hex = json_extract(NEW.manifest_json, '$.digestHex')
    AND snapshot.schema_json = json_extract(NEW.manifest_json, '$.schemaJson')
    AND snapshot.chunk_count = json_extract(NEW.manifest_json, '$.chunkCount')
    AND snapshot.record_count = json_extract(NEW.manifest_json, '$.recordCount')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_cleanup_requires_frozen_snapshot'); END;
CREATE TRIGGER wallet_authorization_cleanup_identity
BEFORE UPDATE ON wallet_relocation_authorization_cleanups
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex OR NEW.source_generation IS NOT OLD.source_generation
  OR NEW.command_digest IS NOT OLD.command_digest OR NEW.manifest_json IS NOT OLD.manifest_json
  OR (OLD.state = 'cleaned' AND (NEW.state IS NOT OLD.state OR NEW.completed_at_ms IS NOT OLD.completed_at_ms))
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_cleanup_immutable'); END;
CREATE TRIGGER wallet_authorization_cleanup_retained
BEFORE DELETE ON wallet_relocation_authorization_cleanups
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_cleanup_retained'); END;

DROP TRIGGER wallet_relocation_authorization_receipt_retain;
CREATE TRIGGER wallet_relocation_authorization_receipt_retain
BEFORE DELETE ON wallet_relocation_authorization_import_receipts
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
  WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
    AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
    AND cleanup.wallet_id = OLD.wallet_id AND cleanup.state = 'cleaning'
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_receipt_retained'); END;

DROP TRIGGER wallet_authorities_frozen_delete;
CREATE TRIGGER wallet_authorities_frozen_delete
BEFORE DELETE ON wallet_authorities
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
        AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

DROP TRIGGER wallet_auth_methods_frozen_delete;
CREATE TRIGGER wallet_auth_methods_frozen_delete
BEFORE DELETE ON wallet_auth_methods
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
        AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

DROP TRIGGER wallet_session_authorizations_v2_frozen_delete;
CREATE TRIGGER wallet_session_authorizations_v2_frozen_delete
BEFORE DELETE ON wallet_session_authorizations_v2
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
        AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

DROP TRIGGER wallet_session_hosted_credentials_v2_frozen_delete;
CREATE TRIGGER wallet_session_hosted_credentials_v2_frozen_delete
BEFORE DELETE ON wallet_session_hosted_credentials_v2
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
        AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

DROP TRIGGER wallet_session_hosted_exchange_codes_v2_frozen_delete;
CREATE TRIGGER wallet_session_hosted_exchange_codes_v2_frozen_delete
BEFORE DELETE ON wallet_session_hosted_exchange_codes_v2
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
    AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id
    AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
      WHERE cleanup.namespace = fence.namespace AND cleanup.org_id = fence.org_id
        AND cleanup.project_id = fence.project_id AND cleanup.env_id = fence.env_id
        AND cleanup.wallet_id = fence.wallet_id AND cleanup.move_id = fence.move_id
        AND cleanup.request_digest_hex = fence.request_digest_hex AND cleanup.source_generation = fence.source_generation
        AND cleanup.state = 'cleaning')
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_history_frozen'); END;

DROP TRIGGER wallet_authorization_chunk_delete;
CREATE TRIGGER wallet_authorization_chunk_delete
BEFORE DELETE ON wallet_relocation_authorization_chunks
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
  WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
    AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
    AND cleanup.wallet_id = OLD.wallet_id AND cleanup.state = 'cleaning'
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_chunk_retained'); END;

DROP TRIGGER wallet_authorization_intake_chunk_retained;
CREATE TRIGGER wallet_authorization_intake_chunk_retained
BEFORE DELETE ON wallet_relocation_authorization_intake_chunks
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_cleanups AS cleanup
  WHERE cleanup.namespace = OLD.namespace AND cleanup.org_id = OLD.org_id
    AND cleanup.project_id = OLD.project_id AND cleanup.env_id = OLD.env_id
    AND cleanup.wallet_id = OLD.wallet_id AND cleanup.state = 'cleaning'
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_chunk_retained'); END;
