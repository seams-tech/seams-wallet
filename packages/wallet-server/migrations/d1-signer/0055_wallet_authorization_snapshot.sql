CREATE TABLE wallet_relocation_authorization_snapshots (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  schema_json TEXT NOT NULL CHECK (json_valid(schema_json)),
  state TEXT NOT NULL CHECK (state IN ('building', 'sealed')),
  chunk_count INTEGER,
  record_count INTEGER,
  digest_hex TEXT,
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id),
  CHECK (
    (state = 'building' AND chunk_count IS NULL AND record_count IS NULL AND digest_hex IS NULL)
    OR (state = 'sealed' AND chunk_count IS NOT NULL AND chunk_count >= 0
      AND record_count IS NOT NULL AND record_count >= 0
      AND digest_hex IS NOT NULL AND length(digest_hex) = 64 AND digest_hex NOT GLOB '*[^a-f0-9]*')
  )
);

CREATE TABLE wallet_relocation_authorization_chunks (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  record_count INTEGER NOT NULL CHECK (record_count >= 0 AND record_count <= chunk_index + 1),
  chunk_json TEXT NOT NULL CHECK (json_valid(chunk_json) AND length(CAST(chunk_json AS BLOB)) <= 131072),
  digest_hex TEXT NOT NULL CHECK (length(digest_hex) = 64 AND digest_hex NOT GLOB '*[^a-f0-9]*'),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, chunk_index)
);

CREATE TRIGGER wallet_authorization_snapshot_insert
BEFORE INSERT ON wallet_relocation_authorization_snapshots
WHEN NEW.state != 'building' OR EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_snapshots AS existing
  WHERE existing.namespace = NEW.namespace AND existing.org_id = NEW.org_id
    AND existing.project_id = NEW.project_id AND existing.env_id = NEW.env_id AND existing.wallet_id = NEW.wallet_id
) OR NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id
    AND fence.move_id = NEW.move_id AND fence.request_digest_hex = NEW.request_digest_hex
    AND fence.source_generation = NEW.source_generation
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_snapshot_requires_frozen_source');
END;

CREATE TRIGGER wallet_authorization_snapshot_update
BEFORE UPDATE ON wallet_relocation_authorization_snapshots
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex OR NEW.source_generation IS NOT OLD.source_generation
  OR NEW.schema_json IS NOT OLD.schema_json
  OR (OLD.state = 'sealed' AND (NEW.state IS NOT OLD.state OR NEW.chunk_count IS NOT OLD.chunk_count
      OR NEW.record_count IS NOT OLD.record_count OR NEW.digest_hex IS NOT OLD.digest_hex))
  OR (NEW.state = 'sealed' AND NEW.chunk_count != (
    SELECT COUNT(*) FROM wallet_relocation_authorization_chunks AS chunk
    WHERE chunk.namespace = OLD.namespace AND chunk.org_id = OLD.org_id
      AND chunk.project_id = OLD.project_id AND chunk.env_id = OLD.env_id AND chunk.wallet_id = OLD.wallet_id
  ))
  OR (NEW.state = 'sealed' AND NEW.record_count != COALESCE((
    SELECT record_count FROM wallet_relocation_authorization_chunks AS chunk
    WHERE chunk.namespace = OLD.namespace AND chunk.org_id = OLD.org_id
      AND chunk.project_id = OLD.project_id AND chunk.env_id = OLD.env_id AND chunk.wallet_id = OLD.wallet_id
      AND chunk.chunk_index = NEW.chunk_count - 1
  ), 0))
  OR (NEW.state = 'sealed' AND NEW.chunk_count > 0 AND NEW.digest_hex IS NOT (
    SELECT digest_hex FROM wallet_relocation_authorization_chunks AS chunk
    WHERE chunk.namespace = OLD.namespace AND chunk.org_id = OLD.org_id
      AND chunk.project_id = OLD.project_id AND chunk.env_id = OLD.env_id AND chunk.wallet_id = OLD.wallet_id
      AND chunk.chunk_index = NEW.chunk_count - 1
  ))
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_snapshot_conflict');
END;

CREATE TRIGGER wallet_authorization_snapshot_delete
BEFORE DELETE ON wallet_relocation_authorization_snapshots
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_snapshot_retained');
END;

CREATE TRIGGER wallet_authorization_chunk_insert
BEFORE INSERT ON wallet_relocation_authorization_chunks
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_snapshots AS snapshot
  WHERE snapshot.namespace = NEW.namespace AND snapshot.org_id = NEW.org_id
    AND snapshot.project_id = NEW.project_id AND snapshot.env_id = NEW.env_id AND snapshot.wallet_id = NEW.wallet_id
    AND snapshot.state = 'building'
) OR NEW.chunk_index != (
  SELECT COALESCE(MAX(chunk_index), -1) + 1 FROM wallet_relocation_authorization_chunks AS chunk
  WHERE chunk.namespace = NEW.namespace AND chunk.org_id = NEW.org_id
    AND chunk.project_id = NEW.project_id AND chunk.env_id = NEW.env_id AND chunk.wallet_id = NEW.wallet_id
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_chunk_out_of_order');
END;

CREATE TRIGGER wallet_authorization_chunk_update
BEFORE UPDATE ON wallet_relocation_authorization_chunks
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id OR NEW.wallet_id IS NOT OLD.wallet_id
  OR NEW.chunk_index IS NOT OLD.chunk_index OR NEW.record_count IS NOT OLD.record_count
  OR NEW.chunk_json IS NOT OLD.chunk_json OR NEW.digest_hex IS NOT OLD.digest_hex
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_chunk_immutable');
END;

CREATE TRIGGER wallet_authorization_chunk_delete
BEFORE DELETE ON wallet_relocation_authorization_chunks
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_chunk_retained');
END;
