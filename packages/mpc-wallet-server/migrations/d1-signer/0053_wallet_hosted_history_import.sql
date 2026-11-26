CREATE TABLE wallet_relocation_hosted_imports (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL CHECK (source_generation > 0 AND source_generation < 9007199254740991),
  state TEXT NOT NULL CHECK (state IN ('importing', 'closed', 'activated')),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id)
);

CREATE TABLE wallet_relocation_hosted_import_context (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('credential', 'exchange')),
  tenant_id TEXT NOT NULL, record_id TEXT NOT NULL,
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64 AND record_digest NOT GLOB '*[^a-f0-9]*'),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, kind, tenant_id, record_id)
);

CREATE TABLE wallet_relocation_hosted_import_receipts (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('credential', 'exchange')),
  tenant_id TEXT NOT NULL, record_id TEXT NOT NULL,
  record_digest TEXT NOT NULL CHECK (length(record_digest) = 64 AND record_digest NOT GLOB '*[^a-f0-9]*'),
  PRIMARY KEY (namespace, org_id, project_id, env_id, wallet_id, move_id, kind, tenant_id, record_id)
);

CREATE TRIGGER wallet_relocation_hosted_import_identity_guard
BEFORE UPDATE ON wallet_relocation_hosted_imports
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.org_id IS NOT OLD.org_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.env_id IS NOT OLD.env_id
  OR NEW.wallet_id IS NOT OLD.wallet_id OR NEW.move_id IS NOT OLD.move_id
  OR NEW.request_digest_hex IS NOT OLD.request_digest_hex OR NEW.source_generation IS NOT OLD.source_generation
  OR (OLD.state = 'closed' AND NEW.state = 'importing')
  OR (OLD.state = 'activated' AND NEW.state != 'activated')
  OR (OLD.state = 'importing' AND NEW.state = 'activated')
BEGIN SELECT RAISE(ABORT, 'wallet_hosted_history_import_transition_rejected'); END;

CREATE TRIGGER wallet_relocation_hosted_import_retain
BEFORE DELETE ON wallet_relocation_hosted_imports
BEGIN SELECT RAISE(ABORT, 'wallet_hosted_history_import_retained'); END;

CREATE TRIGGER wallet_relocation_hosted_receipt_immutable
BEFORE UPDATE ON wallet_relocation_hosted_import_receipts
BEGIN SELECT RAISE(ABORT, 'wallet_hosted_history_receipt_immutable'); END;

CREATE TRIGGER wallet_relocation_hosted_receipt_retain
BEFORE DELETE ON wallet_relocation_hosted_import_receipts
BEGIN SELECT RAISE(ABORT, 'wallet_hosted_history_receipt_retained'); END;

CREATE TRIGGER wallet_session_authorizations_v2_import_insert_guard
BEFORE INSERT ON wallet_session_authorizations_v2
WHEN NEW.retired_at_ms IS NULL AND EXISTS (
  SELECT 1 FROM wallet_relocation_hosted_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'
)
BEGIN SELECT RAISE(ABORT, 'wallet_hosted_history_destination_inactive'); END;

CREATE TRIGGER wallet_session_authorizations_v2_import_update_guard
BEFORE UPDATE ON wallet_session_authorizations_v2
WHEN NEW.retired_at_ms IS NULL AND EXISTS (
  SELECT 1 FROM wallet_relocation_hosted_imports AS destination
  WHERE destination.namespace = NEW.namespace AND destination.org_id = NEW.org_id
    AND destination.project_id = NEW.project_id AND destination.env_id = NEW.env_id
    AND destination.wallet_id = NEW.wallet_id AND destination.state != 'activated'
)
BEGIN SELECT RAISE(ABORT, 'wallet_hosted_history_destination_inactive'); END;

DROP TRIGGER wallet_session_hosted_credentials_v2_insert_lifecycle_guard;
CREATE TRIGGER wallet_session_hosted_credentials_v2_insert_lifecycle_guard
BEFORE INSERT ON wallet_session_hosted_credentials_v2
WHEN (NEW.lifecycle_kind != 'active' OR NEW.retired_at_ms IS NOT NULL) AND NOT (NEW.lifecycle_kind = 'retired' AND NEW.retired_at_ms IS NOT NULL AND EXISTS (SELECT 1 FROM wallet_relocation_hosted_import_context AS context
    JOIN wallet_relocation_hosted_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = NEW.wallet_id AND context.tenant_id = NEW.tenant_id
      AND context.kind = 'credential' AND context.record_id = NEW.hosted_credential_id))
BEGIN SELECT RAISE(ABORT, 'wallet_session_hosted_credential_initial_state_rejected'); END;

DROP TRIGGER wallet_session_hosted_credentials_v2_parent_guard;
CREATE TRIGGER wallet_session_hosted_credentials_v2_parent_guard
BEFORE INSERT ON wallet_session_hosted_credentials_v2
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_session_authorizations_v2 AS session
  WHERE session.namespace = NEW.namespace AND session.org_id = NEW.org_id
    AND session.project_id = NEW.project_id AND session.env_id = NEW.env_id
    AND session.tenant_id = NEW.tenant_id AND session.authorization_id = NEW.authorization_id
    AND session.wallet_session_id = NEW.wallet_session_id AND session.quota_id = NEW.quota_id
    AND session.principal_id = NEW.principal_id AND session.wallet_id = NEW.wallet_id
    AND session.authority_id = NEW.authority_id AND session.wallet_auth_method_id = NEW.wallet_auth_method_id
    AND session.operation_credential_hash IS NOT NULL AND session.expires_at_ms >= NEW.expires_at_ms
    AND (session.retired_at_ms IS NULL OR (NEW.lifecycle_kind = 'retired' AND NEW.retired_at_ms IS NOT NULL AND EXISTS (SELECT 1 FROM wallet_relocation_hosted_import_context AS context
    JOIN wallet_relocation_hosted_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = NEW.wallet_id AND context.tenant_id = NEW.tenant_id
      AND context.kind = 'credential' AND context.record_id = NEW.hosted_credential_id)))
)
BEGIN SELECT RAISE(ABORT, 'wallet_session_hosted_credential_parent_rejected'); END;

DROP TRIGGER wallet_session_hosted_exchange_codes_v2_insert_lifecycle_guard;
CREATE TRIGGER wallet_session_hosted_exchange_codes_v2_insert_lifecycle_guard
BEFORE INSERT ON wallet_session_hosted_exchange_codes_v2
WHEN (NEW.lifecycle_kind != 'issued' OR NEW.hosted_credential_id IS NOT NULL OR NEW.consumed_at_ms IS NOT NULL) AND NOT ((NEW.lifecycle_kind = 'issued' OR (NEW.lifecycle_kind = 'consumed' AND EXISTS (
      SELECT 1 FROM wallet_session_hosted_credentials_v2 AS child
      WHERE child.namespace = NEW.namespace AND child.org_id = NEW.org_id
        AND child.project_id = NEW.project_id AND child.env_id = NEW.env_id
        AND child.tenant_id = NEW.tenant_id AND child.hosted_credential_id = NEW.hosted_credential_id
        AND child.wallet_id = NEW.wallet_id AND child.lifecycle_kind = 'retired'))) AND EXISTS (SELECT 1 FROM wallet_relocation_hosted_import_context AS context
    JOIN wallet_relocation_hosted_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = NEW.wallet_id AND context.tenant_id = NEW.tenant_id
      AND context.kind = 'exchange' AND context.record_id = NEW.exchange_code_id))
BEGIN SELECT RAISE(ABORT, 'wallet_session_hosted_exchange_initial_state_rejected'); END;

DROP TRIGGER wallet_session_hosted_exchange_codes_v2_parent_guard;
CREATE TRIGGER wallet_session_hosted_exchange_codes_v2_parent_guard
BEFORE INSERT ON wallet_session_hosted_exchange_codes_v2
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_session_authorizations_v2 AS session
  WHERE session.namespace = NEW.namespace AND session.org_id = NEW.org_id
    AND session.project_id = NEW.project_id AND session.env_id = NEW.env_id
    AND session.tenant_id = NEW.tenant_id AND session.authorization_id = NEW.authorization_id
    AND session.wallet_session_id = NEW.wallet_session_id AND session.quota_id = NEW.quota_id
    AND session.principal_id = NEW.principal_id AND session.wallet_id = NEW.wallet_id
    AND session.authority_id = NEW.authority_id AND session.wallet_auth_method_id = NEW.wallet_auth_method_id
    AND session.operation_credential_hash IS NOT NULL AND session.expires_at_ms >= NEW.expires_at_ms
    AND (session.retired_at_ms IS NULL OR ((NEW.lifecycle_kind = 'issued' OR (NEW.lifecycle_kind = 'consumed' AND EXISTS (
      SELECT 1 FROM wallet_session_hosted_credentials_v2 AS child
      WHERE child.namespace = NEW.namespace AND child.org_id = NEW.org_id
        AND child.project_id = NEW.project_id AND child.env_id = NEW.env_id
        AND child.tenant_id = NEW.tenant_id AND child.hosted_credential_id = NEW.hosted_credential_id
        AND child.wallet_id = NEW.wallet_id AND child.lifecycle_kind = 'retired'))) AND EXISTS (SELECT 1 FROM wallet_relocation_hosted_import_context AS context
    JOIN wallet_relocation_hosted_imports AS destination
      ON destination.namespace = context.namespace AND destination.org_id = context.org_id
      AND destination.project_id = context.project_id AND destination.env_id = context.env_id
      AND destination.wallet_id = context.wallet_id AND destination.move_id = context.move_id
      AND destination.request_digest_hex = context.request_digest_hex
      AND destination.source_generation = context.source_generation AND destination.state = 'importing'
    WHERE context.namespace = NEW.namespace AND context.org_id = NEW.org_id
      AND context.project_id = NEW.project_id AND context.env_id = NEW.env_id
      AND context.wallet_id = NEW.wallet_id AND context.tenant_id = NEW.tenant_id
      AND context.kind = 'exchange' AND context.record_id = NEW.exchange_code_id)))
)
BEGIN SELECT RAISE(ABORT, 'wallet_session_hosted_exchange_parent_rejected'); END;
