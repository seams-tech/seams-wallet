-- Existing evidence must resolve to one persisted wallet signer scope.
-- Do not discard history or guess a project when the persisted owner is ambiguous.
CREATE VIEW wallet_operation_evidence_scope_candidates AS
SELECT DISTINCT evidence.namespace, evidence.tenant_id, evidence.evidence_set_id,
       signer.org_id, signer.project_id, signer.env_id
FROM verified_wallet_operation_evidence_sets AS evidence
JOIN wallet_signers AS signer
  ON signer.namespace = evidence.namespace AND signer.wallet_id = evidence.wallet_id;
CREATE TABLE wallet_operation_evidence_scope_guard (
  candidate_count INTEGER NOT NULL
    CONSTRAINT wallet_operation_evidence_requires_unique_scope CHECK(candidate_count = 1)
);
INSERT INTO wallet_operation_evidence_scope_guard
SELECT (SELECT COUNT(*) FROM wallet_operation_evidence_scope_candidates AS candidate
        WHERE candidate.namespace = evidence.namespace AND candidate.tenant_id = evidence.tenant_id
          AND candidate.evidence_set_id = evidence.evidence_set_id)
FROM verified_wallet_operation_evidence_sets AS evidence;
INSERT INTO wallet_operation_evidence_scope_guard
SELECT 0 FROM authorized_operations AS operation
WHERE operation.authorization_source_kind = 'verified_step_up' AND NOT EXISTS (
  SELECT 1 FROM verified_wallet_operation_evidence_sets AS evidence
  WHERE evidence.namespace = operation.namespace AND evidence.tenant_id = operation.tenant_id
    AND evidence.evidence_set_digest = operation.evidence_set_digest
);

CREATE TABLE scoped_wallet_operation_evidence_sets (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL CHECK(length(org_id) > 0),
  project_id TEXT NOT NULL CHECK(length(project_id) > 0),
  env_id TEXT NOT NULL CHECK(length(env_id) > 0),
  tenant_id TEXT NOT NULL,
  evidence_set_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  authority_digest TEXT NOT NULL,
  request_origin TEXT NOT NULL,
  audience TEXT NOT NULL,
  evidence_set_digest TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  capability_kind TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  lane_digest TEXT NOT NULL,
  intent_digest TEXT NOT NULL,
  display_digest TEXT NOT NULL,
  assurance TEXT NOT NULL,
  verified_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, tenant_id, evidence_set_id),
  UNIQUE (namespace, tenant_id, evidence_set_digest),
  CHECK (json_valid(evidence_json)),
  CHECK (assurance = 'step_up'),
  CHECK (expires_at_ms > verified_at_ms),
  CHECK (
    (capability_kind = 'near_ed25519_mpc_signing'
      AND operation_kind IN (
        'near.sign_transaction',
        'near.sign_delegate_action',
        'near.sign_nep413_message',
        'near.export_key'
      ))
    OR (capability_kind = 'evm_ecdsa_mpc_signing'
      AND operation_kind IN ('evm.sign_transaction', 'evm.export_key'))
    OR (capability_kind = 'vault_access'
      AND operation_kind IN ('vault.proxy_use', 'vault.reveal'))
  )
);

INSERT INTO scoped_wallet_operation_evidence_sets (
  org_id, project_id, env_id, namespace,
  tenant_id, evidence_set_id, principal_id, wallet_id,
  authority_digest, request_origin, audience, evidence_set_digest,
  evidence_json, capability_kind, operation_kind, lane_digest,
  intent_digest, display_digest, assurance, verified_at_ms,
  expires_at_ms
)
SELECT candidate.org_id, candidate.project_id, candidate.env_id,
       evidence.namespace, evidence.tenant_id, evidence.evidence_set_id,
       evidence.principal_id, evidence.wallet_id, evidence.authority_digest,
       evidence.request_origin, evidence.audience, evidence.evidence_set_digest,
       evidence.evidence_json, evidence.capability_kind, evidence.operation_kind,
       evidence.lane_digest, evidence.intent_digest, evidence.display_digest,
       evidence.assurance, evidence.verified_at_ms, evidence.expires_at_ms
FROM verified_wallet_operation_evidence_sets AS evidence
JOIN wallet_operation_evidence_scope_candidates AS candidate
  USING(namespace, tenant_id, evidence_set_id);
DROP VIEW wallet_operation_evidence_scope_candidates;
DROP TABLE wallet_operation_evidence_scope_guard;
DROP TRIGGER authorized_operation_step_up_claim_atomic;
DROP TABLE verified_wallet_operation_evidence_sets;
ALTER TABLE scoped_wallet_operation_evidence_sets RENAME TO verified_wallet_operation_evidence_sets;
CREATE INDEX idx_verified_wallet_operation_evidence_expiry
  ON verified_wallet_operation_evidence_sets(namespace, tenant_id, expires_at_ms);
CREATE INDEX wallet_operation_evidence_by_wallet
  ON verified_wallet_operation_evidence_sets(namespace, org_id, project_id, env_id, wallet_id);

CREATE TRIGGER authorized_operation_step_up_claim_atomic
AFTER INSERT ON authorized_operations
WHEN NEW.lifecycle_kind = 'claimed'
  AND NEW.authorization_source_kind = 'verified_step_up'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
        SELECT 1
          FROM verified_wallet_operation_evidence_sets AS evidence
         WHERE evidence.namespace = NEW.namespace
           AND evidence.tenant_id = NEW.tenant_id
           AND evidence.evidence_set_digest = NEW.evidence_set_digest
           AND evidence.principal_id = NEW.principal_id
           AND evidence.capability_kind = NEW.capability_kind
           AND evidence.operation_kind = NEW.operation_kind
           AND evidence.lane_digest = NEW.lane_digest
           AND evidence.intent_digest = NEW.intent_digest
           AND evidence.display_digest = NEW.display_digest
           AND evidence.assurance = 'step_up'
           AND NOT EXISTS (
             SELECT 1 FROM wallet_relocation_session_fences AS fence
             WHERE fence.namespace = evidence.namespace AND fence.org_id = evidence.org_id
               AND fence.project_id = evidence.project_id AND fence.env_id = evidence.env_id
               AND fence.wallet_id = evidence.wallet_id
           )
           AND evidence.expires_at_ms > NEW.claimed_at_ms
           -- The database clock closes delays between verification and this write.
           AND evidence.expires_at_ms > CAST(round(unixepoch('subsec') * 1000) AS INTEGER)
      )
    THEN RAISE(ABORT, 'authorization_evidence_claim_rejected')
  END;
END;

DROP TRIGGER wallet_relocation_sessions_require_settled_operations;
DROP VIEW wallet_session_pending_operations;
CREATE VIEW wallet_pending_operations AS
SELECT session.namespace, session.org_id, session.project_id, session.env_id,
       session.wallet_id, operation.tenant_id, operation.authorized_operation_id
FROM authorized_operations AS operation
JOIN wallet_session_authorizations_v2 AS session
  ON session.namespace = operation.namespace AND session.tenant_id = operation.tenant_id
 AND session.authorization_id = operation.authorization_id
 AND session.org_id = operation.owner_scope_org_id
 AND session.project_id = operation.owner_scope_project_id AND session.env_id = operation.owner_scope_env_id
WHERE operation.authorization_source_kind = 'authorization_grant'
  AND operation.authorization_grant_kind = 'wallet_session_authorization'
  AND operation.lifecycle_kind = 'claimed'
UNION ALL
SELECT evidence.namespace, evidence.org_id, evidence.project_id, evidence.env_id,
       evidence.wallet_id, operation.tenant_id, operation.authorized_operation_id
FROM authorized_operations AS operation
JOIN verified_wallet_operation_evidence_sets AS evidence
  ON evidence.namespace = operation.namespace AND evidence.tenant_id = operation.tenant_id
 AND evidence.evidence_set_digest = operation.evidence_set_digest
WHERE operation.authorization_source_kind = 'verified_step_up' AND operation.lifecycle_kind = 'claimed';

CREATE TRIGGER wallet_relocation_sessions_require_settled_operations
BEFORE INSERT ON wallet_relocation_session_fences
WHEN EXISTS (
  SELECT 1 FROM wallet_pending_operations AS operation
  WHERE operation.namespace = NEW.namespace AND operation.org_id = NEW.org_id
    AND operation.project_id = NEW.project_id AND operation.env_id = NEW.env_id
    AND operation.wallet_id = NEW.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'wallet_operations_unsettled'); END;

-- Evidence identity remains the owner of its claimed operation and replay history.
CREATE TRIGGER wallet_operation_evidence_immutable
BEFORE UPDATE ON verified_wallet_operation_evidence_sets
BEGIN SELECT RAISE(ABORT, 'wallet_operation_evidence_immutable'); END;
CREATE TRIGGER wallet_operation_evidence_referenced_retained
BEFORE DELETE ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM authorized_operations AS operation
  WHERE operation.namespace = OLD.namespace AND operation.tenant_id = OLD.tenant_id
    AND operation.evidence_set_digest = OLD.evidence_set_digest
)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_evidence_referenced'); END;
CREATE TRIGGER wallet_operation_evidence_retired_insert
BEFORE INSERT ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM wallet_relocation_session_fences AS fence
  WHERE fence.namespace = NEW.namespace AND fence.org_id = NEW.org_id
    AND fence.project_id = NEW.project_id AND fence.env_id = NEW.env_id AND fence.wallet_id = NEW.wallet_id
)
BEGIN SELECT RAISE(ABORT, 'authorization_evidence_claim_rejected'); END;

CREATE TRIGGER wallet_operation_evidence_replace_identity
BEFORE INSERT ON verified_wallet_operation_evidence_sets
WHEN EXISTS (
  SELECT 1 FROM verified_wallet_operation_evidence_sets AS existing
  WHERE existing.namespace = NEW.namespace AND existing.tenant_id = NEW.tenant_id
    AND (existing.evidence_set_id = NEW.evidence_set_id OR existing.evidence_set_digest = NEW.evidence_set_digest)
    AND (existing.namespace, existing.org_id, existing.project_id,
         existing.env_id, existing.tenant_id, existing.evidence_set_id,
         existing.principal_id, existing.wallet_id, existing.authority_digest,
         existing.request_origin, existing.audience, existing.evidence_set_digest,
         existing.evidence_json, existing.capability_kind, existing.operation_kind,
         existing.lane_digest, existing.intent_digest, existing.display_digest,
         existing.assurance, existing.verified_at_ms, existing.expires_at_ms) IS NOT
        (NEW.namespace, NEW.org_id, NEW.project_id,
         NEW.env_id, NEW.tenant_id, NEW.evidence_set_id,
         NEW.principal_id, NEW.wallet_id, NEW.authority_digest,
         NEW.request_origin, NEW.audience, NEW.evidence_set_digest,
         NEW.evidence_json, NEW.capability_kind, NEW.operation_kind,
         NEW.lane_digest, NEW.intent_digest, NEW.display_digest,
         NEW.assurance, NEW.verified_at_ms, NEW.expires_at_ms)
)
BEGIN SELECT RAISE(ABORT, 'wallet_operation_evidence_immutable'); END;
