CREATE TABLE wallet_relocation_session_fences (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL CHECK (source_generation > 0 AND source_generation < 9007199254740991),
  retired_at_ms INTEGER NOT NULL CHECK (retired_at_ms > 0),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id),
  CHECK (length(move_id) = 49 AND substr(move_id, 1, 6) = 'wmove_' AND substr(move_id, 7) NOT GLOB '*[^A-Za-z0-9_-]*'),
  CHECK (length(request_digest_hex) = 64 AND request_digest_hex NOT GLOB '*[^a-f0-9]*')
);

CREATE TRIGGER wallet_relocation_session_fences_immutable
BEFORE UPDATE ON wallet_relocation_session_fences
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex
  OR NEW.source_generation IS NOT OLD.source_generation OR NEW.retired_at_ms IS NOT OLD.retired_at_ms
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_fence_immutable');
END;

CREATE TRIGGER wallet_relocation_session_fences_retain
BEFORE DELETE ON wallet_relocation_session_fences
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_fence_retained');
END;

CREATE TRIGGER wallet_session_authorizations_v2_relocation_insert_guard
BEFORE INSERT ON wallet_session_authorizations_v2
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;

CREATE TRIGGER wallet_session_authorizations_v2_relocation_update_guard
BEFORE UPDATE ON wallet_session_authorizations_v2
WHEN (NEW.retired_at_ms IS NULL) AND EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id) OR (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;

CREATE TRIGGER wallet_session_hosted_credentials_v2_relocation_insert_guard
BEFORE INSERT ON wallet_session_hosted_credentials_v2
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;

CREATE TRIGGER wallet_session_hosted_credentials_v2_relocation_update_guard
BEFORE UPDATE ON wallet_session_hosted_credentials_v2
WHEN (NEW.lifecycle_kind = 'active') AND EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id) OR (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;

CREATE TRIGGER wallet_session_hosted_exchange_codes_v2_relocation_insert_guard
BEFORE INSERT ON wallet_session_hosted_exchange_codes_v2
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;

CREATE TRIGGER wallet_session_hosted_exchange_codes_v2_relocation_update_guard
BEFORE UPDATE ON wallet_session_hosted_exchange_codes_v2
WHEN (NEW.lifecycle_kind IN ('issued', 'consumed')) AND EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE (fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id AND fence.wallet_id = OLD.wallet_id) OR (fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_relocation_session_admission_closed');
END;
