CREATE TABLE wallet_relocation_authorization_activations (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL, move_id TEXT NOT NULL, request_digest_hex TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  command_digest TEXT NOT NULL CHECK(length(command_digest) = 64 AND command_digest NOT GLOB '*[^a-f0-9]*'),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  activated_at_ms INTEGER NOT NULL CHECK(activated_at_ms > 0),
  PRIMARY KEY(namespace, org_id, project_id, env_id, wallet_id, move_id)
);

CREATE TRIGGER wallet_authorization_activation_verified
BEFORE INSERT ON wallet_relocation_authorization_activations
WHEN NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_intakes AS intake
  JOIN wallet_relocation_authorization_imports AS imported
    USING(namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation)
  WHERE intake.namespace = NEW.namespace AND intake.org_id = NEW.org_id
    AND intake.project_id = NEW.project_id AND intake.env_id = NEW.env_id
    AND intake.wallet_id = NEW.wallet_id AND intake.move_id = NEW.move_id
    AND intake.request_digest_hex = NEW.request_digest_hex AND intake.source_generation = NEW.source_generation
    AND intake.state = 'verified' AND imported.state = 'closed' AND intake.manifest_json = NEW.manifest_json
) OR EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_activation_requires_verified_destination'); END;

CREATE TRIGGER wallet_authorization_activation_immutable
BEFORE UPDATE ON wallet_relocation_authorization_activations
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_activation_immutable'); END;
CREATE TRIGGER wallet_authorization_activation_retained
BEFORE DELETE ON wallet_relocation_authorization_activations
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_activation_retained'); END;

CREATE TRIGGER wallet_authorization_import_activation_receipt
BEFORE UPDATE ON wallet_relocation_authorization_imports
WHEN NEW.state = 'activated' AND OLD.state != 'activated' AND NOT EXISTS (
  SELECT 1 FROM wallet_relocation_authorization_activations AS receipt
  WHERE receipt.namespace = NEW.namespace AND receipt.org_id = NEW.org_id
    AND receipt.project_id = NEW.project_id AND receipt.env_id = NEW.env_id
    AND receipt.wallet_id = NEW.wallet_id AND receipt.move_id = NEW.move_id
    AND receipt.request_digest_hex = NEW.request_digest_hex AND receipt.source_generation = NEW.source_generation
)
BEGIN SELECT RAISE(ABORT, 'wallet_authorization_activation_receipt_required'); END;
