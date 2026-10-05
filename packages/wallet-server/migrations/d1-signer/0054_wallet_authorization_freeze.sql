-- Freeze authorization history only after wallet-wide session retirement.
CREATE TABLE wallet_relocation_authorization_fences (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  frozen_at_ms INTEGER NOT NULL CHECK (frozen_at_ms > 0),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id)
);

CREATE TRIGGER wallet_relocation_authorization_fences_retired
BEFORE INSERT ON wallet_relocation_authorization_fences
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_fences AS existing
  WHERE existing.namespace = NEW.namespace AND existing.org_id = NEW.org_id
    AND existing.project_id = NEW.project_id AND existing.env_id = NEW.env_id
    AND existing.wallet_id = NEW.wallet_id
) OR NOT EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS retired
  WHERE retired.namespace = NEW.namespace AND retired.org_id = NEW.org_id
    AND retired.project_id = NEW.project_id AND retired.env_id = NEW.env_id
    AND retired.wallet_id = NEW.wallet_id AND retired.move_id = NEW.move_id
    AND retired.request_digest_hex = NEW.request_digest_hex
    AND retired.source_generation = NEW.source_generation
    AND retired.retired_at_ms <= NEW.frozen_at_ms
) OR EXISTS (
  SELECT 1 FROM wallet_session_authorizations_v2 AS session
  WHERE session.namespace = NEW.namespace AND session.org_id = NEW.org_id
    AND session.project_id = NEW.project_id AND session.env_id = NEW.env_id
    AND session.wallet_id = NEW.wallet_id AND session.retired_at_ms IS NULL
) OR EXISTS (
  SELECT 1 FROM wallet_session_hosted_credentials_v2 AS credential
  WHERE credential.namespace = NEW.namespace AND credential.org_id = NEW.org_id
    AND credential.project_id = NEW.project_id AND credential.env_id = NEW.env_id
    AND credential.wallet_id = NEW.wallet_id AND credential.lifecycle_kind = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_freeze_requires_retirement');
END;

CREATE TRIGGER wallet_relocation_authorization_fences_immutable
BEFORE UPDATE ON wallet_relocation_authorization_fences
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex
  OR NEW.source_generation IS NOT OLD.source_generation OR NEW.frozen_at_ms IS NOT OLD.frozen_at_ms
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_fence_immutable');
END;

CREATE TRIGGER wallet_relocation_authorization_fences_retain
BEFORE DELETE ON wallet_relocation_authorization_fences
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_fence_retained');
END;

CREATE TRIGGER wallet_authorities_frozen_insert
BEFORE INSERT ON wallet_authorities
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_authorities_frozen_update
BEFORE UPDATE ON wallet_authorities
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id
  ) OR EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_authorities_frozen_delete
BEFORE DELETE ON wallet_authorities
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_auth_methods_frozen_insert
BEFORE INSERT ON wallet_auth_methods
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_auth_methods_frozen_update
BEFORE UPDATE ON wallet_auth_methods
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id
  ) OR EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_auth_methods_frozen_delete
BEFORE DELETE ON wallet_auth_methods
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_session_authorizations_v2_frozen_insert
BEFORE INSERT ON wallet_session_authorizations_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_session_authorizations_v2_frozen_update
BEFORE UPDATE ON wallet_session_authorizations_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id
  ) OR EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_session_authorizations_v2_frozen_delete
BEFORE DELETE ON wallet_session_authorizations_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_session_hosted_credentials_v2_frozen_insert
BEFORE INSERT ON wallet_session_hosted_credentials_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_session_hosted_credentials_v2_frozen_update
BEFORE UPDATE ON wallet_session_hosted_credentials_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id
  ) OR EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_session_hosted_credentials_v2_frozen_delete
BEFORE DELETE ON wallet_session_hosted_credentials_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_session_hosted_exchange_codes_v2_frozen_insert
BEFORE INSERT ON wallet_session_hosted_exchange_codes_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_session_hosted_exchange_codes_v2_frozen_update
BEFORE UPDATE ON wallet_session_hosted_exchange_codes_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id
  ) OR EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
      AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id
      AND fence.wallet_id = NEW.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER wallet_session_hosted_exchange_codes_v2_frozen_delete
BEFORE DELETE ON wallet_session_hosted_exchange_codes_v2
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    WHERE fence.namespace = OLD.namespace AND fence.org_id = OLD.org_id
      AND fence.project_id = OLD.project_id AND fence.env_id = OLD.env_id
      AND fence.wallet_id = OLD.wallet_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER authorization_wallet_session_quotas_frozen_insert
BEFORE INSERT ON authorization_wallet_session_quotas
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    JOIN wallet_session_authorizations_v2 AS session
      ON session.namespace = fence.namespace AND session.org_id = fence.org_id
      AND session.project_id = fence.project_id AND session.env_id = fence.env_id
      AND session.wallet_id = fence.wallet_id
    WHERE session.namespace = NEW.namespace AND session.tenant_id = NEW.tenant_id
      AND session.quota_id = NEW.quota_id AND session.wallet_session_id = NEW.wallet_session_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER authorization_wallet_session_quotas_frozen_update
BEFORE UPDATE ON authorization_wallet_session_quotas
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    JOIN wallet_session_authorizations_v2 AS session
      ON session.namespace = fence.namespace AND session.org_id = fence.org_id
      AND session.project_id = fence.project_id AND session.env_id = fence.env_id
      AND session.wallet_id = fence.wallet_id
    WHERE session.namespace = OLD.namespace AND session.tenant_id = OLD.tenant_id
      AND session.quota_id = OLD.quota_id AND session.wallet_session_id = OLD.wallet_session_id
  ) OR EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    JOIN wallet_session_authorizations_v2 AS session
      ON session.namespace = fence.namespace AND session.org_id = fence.org_id
      AND session.project_id = fence.project_id AND session.env_id = fence.env_id
      AND session.wallet_id = fence.wallet_id
    WHERE session.namespace = NEW.namespace AND session.tenant_id = NEW.tenant_id
      AND session.quota_id = NEW.quota_id AND session.wallet_session_id = NEW.wallet_session_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;

CREATE TRIGGER authorization_wallet_session_quotas_frozen_delete
BEFORE DELETE ON authorization_wallet_session_quotas
WHEN EXISTS (
    SELECT 1 FROM wallet_relocation_authorization_fences AS fence
    JOIN wallet_session_authorizations_v2 AS session
      ON session.namespace = fence.namespace AND session.org_id = fence.org_id
      AND session.project_id = fence.project_id AND session.env_id = fence.env_id
      AND session.wallet_id = fence.wallet_id
    WHERE session.namespace = OLD.namespace AND session.tenant_id = OLD.tenant_id
      AND session.quota_id = OLD.quota_id AND session.wallet_session_id = OLD.wallet_session_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet_authorization_history_frozen');
END;
