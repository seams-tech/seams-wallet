-- A host can allocate signing credit before execution. Standalone hosts retain included signing.
-- Each admitted signature consumes one allocated unit atomically with its operation claim.
CREATE TABLE wallet_signing_credit_grants (
 namespace TEXT NOT NULL, tenant_id TEXT NOT NULL, grant_id TEXT NOT NULL,
 project_id TEXT NOT NULL, env_id TEXT NOT NULL,
 capacity INTEGER NOT NULL CHECK(capacity>0), expires_at_ms INTEGER NOT NULL,
 admitted_count INTEGER NOT NULL DEFAULT 0 CHECK(admitted_count>=0 AND admitted_count<=capacity),
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)),
 PRIMARY KEY(namespace,tenant_id,grant_id)
);
CREATE TABLE wallet_signing_credit_policies (
 namespace TEXT NOT NULL, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('included','credit','blocked')),
 grant_id TEXT, revision INTEGER NOT NULL,
 PRIMARY KEY(namespace,tenant_id,project_id,env_id),
 FOREIGN KEY(namespace,tenant_id,grant_id) REFERENCES wallet_signing_credit_grants(namespace,tenant_id,grant_id),
 CHECK((mode='credit' AND grant_id IS NOT NULL) OR (mode<>'credit' AND grant_id IS NULL))
);
CREATE TABLE wallet_signing_credit_claims (
 namespace TEXT NOT NULL, tenant_id TEXT NOT NULL, authorized_operation_id TEXT NOT NULL,
 grant_id TEXT NOT NULL,
 PRIMARY KEY(namespace,tenant_id,authorized_operation_id),
 FOREIGN KEY(namespace,tenant_id,grant_id) REFERENCES wallet_signing_credit_grants(namespace,tenant_id,grant_id)
);
CREATE TRIGGER wallet_signing_credit_admission BEFORE INSERT ON authorized_operations
WHEN NEW.lifecycle_kind='claimed' AND NEW.operation_kind IN ('near.sign_transaction','near.sign_delegate_action','near.sign_nep413_message','evm.sign_transaction')
AND EXISTS(SELECT 1 FROM wallet_signing_credit_policies p WHERE p.namespace=NEW.namespace AND p.tenant_id=NEW.tenant_id
 AND p.project_id=COALESCE(NEW.owner_scope_project_id,(SELECT project_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest)) AND p.env_id=COALESCE(NEW.owner_scope_env_id,(SELECT env_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest)) AND p.mode<>'included')
BEGIN
 SELECT RAISE(ABORT,'billing_credit_exhausted') WHERE NOT EXISTS(
  SELECT 1 FROM wallet_signing_credit_policies p JOIN wallet_signing_credit_grants g USING(namespace,tenant_id,grant_id)
  WHERE p.namespace=NEW.namespace AND p.tenant_id=NEW.tenant_id AND p.project_id=COALESCE(NEW.owner_scope_project_id,(SELECT project_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest))
   AND p.env_id=COALESCE(NEW.owner_scope_env_id,(SELECT env_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest)) AND p.mode='credit' AND g.sealed=0 AND g.expires_at_ms>NEW.claimed_at_ms
   AND g.admitted_count<g.capacity);
 END ;
CREATE TRIGGER wallet_signing_credit_claim AFTER INSERT ON authorized_operations
WHEN NEW.lifecycle_kind='claimed' AND NEW.operation_kind IN ('near.sign_transaction','near.sign_delegate_action','near.sign_nep413_message','evm.sign_transaction')
BEGIN
 INSERT INTO wallet_signing_credit_claims(namespace,tenant_id,authorized_operation_id,grant_id)
 SELECT NEW.namespace,NEW.tenant_id,NEW.authorized_operation_id,p.grant_id FROM wallet_signing_credit_policies p
 WHERE p.namespace=NEW.namespace AND p.tenant_id=NEW.tenant_id AND p.project_id=COALESCE(NEW.owner_scope_project_id,(SELECT project_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest))
  AND p.env_id=COALESCE(NEW.owner_scope_env_id,(SELECT env_id FROM verified_wallet_operation_evidence_sets WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND evidence_set_digest=NEW.evidence_set_digest)) AND p.mode='credit';
 UPDATE wallet_signing_credit_grants SET admitted_count=admitted_count+1 WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id
  AND grant_id=(SELECT grant_id FROM wallet_signing_credit_claims WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND authorized_operation_id=NEW.authorized_operation_id);
 END ;
CREATE TRIGGER wallet_signing_credit_grant_identity BEFORE UPDATE ON wallet_signing_credit_grants
WHEN NEW.namespace<>OLD.namespace OR NEW.tenant_id<>OLD.tenant_id OR NEW.grant_id<>OLD.grant_id
 OR NEW.project_id<>OLD.project_id OR NEW.env_id<>OLD.env_id OR NEW.capacity<>OLD.capacity OR NEW.expires_at_ms<>OLD.expires_at_ms
 OR NEW.admitted_count<OLD.admitted_count OR NEW.sealed<OLD.sealed
BEGIN SELECT RAISE(ABORT,'signing_credit_grant_immutable');  END ;
CREATE TRIGGER wallet_signing_credit_claim_immutable BEFORE UPDATE ON wallet_signing_credit_claims
BEGIN SELECT RAISE(ABORT,'signing_credit_claim_immutable');  END ;
CREATE TRIGGER wallet_signing_credit_claim_retained BEFORE DELETE ON wallet_signing_credit_claims
BEGIN SELECT RAISE(ABORT,'signing_credit_claim_retained');  END ;
ALTER TABLE wallet_signature_completions ADD COLUMN wallet_id TEXT;
ALTER TABLE wallet_signature_completions ADD COLUMN credit_grant_id TEXT;
ALTER TABLE wallet_signature_completions ADD COLUMN outcome TEXT NOT NULL DEFAULT 'succeeded' CHECK(outcome IN ('succeeded','failed'));
DROP TRIGGER wallet_signature_completion_record;
CREATE TRIGGER wallet_signature_completion_record AFTER UPDATE OF lifecycle_kind ON authorized_operations
WHEN OLD.lifecycle_kind='claimed' AND NEW.lifecycle_kind='completed'
 AND NEW.operation_kind IN ('near.sign_transaction','near.sign_delegate_action','near.sign_nep413_message','evm.sign_transaction')
 AND (NEW.result_kind='succeeded' OR (NEW.result_kind='failed_before_side_effect' AND EXISTS(SELECT 1 FROM wallet_signing_credit_claims c
  WHERE c.namespace=NEW.namespace AND c.tenant_id=NEW.tenant_id AND c.authorized_operation_id=NEW.authorized_operation_id)))
BEGIN
 INSERT INTO wallet_signature_completions(namespace,tenant_id,authorized_operation_id,operation_kind,org_id,project_id,env_id,completed_at_ms,wallet_id,credit_grant_id,outcome)
 VALUES(NEW.namespace,NEW.tenant_id,NEW.authorized_operation_id,NEW.operation_kind,NEW.owner_scope_org_id,NEW.owner_scope_project_id,NEW.owner_scope_env_id,NEW.completed_at_ms,
 (SELECT wallet_id FROM wallet_operation_authorizations WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND source_kind=NEW.authorization_source_kind AND source_id=COALESCE(NEW.authorization_id,NEW.evidence_set_digest)),
 (SELECT grant_id FROM wallet_signing_credit_claims WHERE namespace=NEW.namespace AND tenant_id=NEW.tenant_id AND authorized_operation_id=NEW.authorized_operation_id),
  CASE  NEW.result_kind WHEN 'succeeded' THEN 'succeeded' ELSE 'failed'  END ) ON CONFLICT DO NOTHING;
 END ;

CREATE TRIGGER wallet_signing_credit_grant_conflict BEFORE INSERT ON wallet_signing_credit_grants
WHEN EXISTS(SELECT 1 FROM wallet_signing_credit_grants g WHERE g.namespace=NEW.namespace AND g.tenant_id=NEW.tenant_id AND g.grant_id=NEW.grant_id
 AND (g.project_id<>NEW.project_id OR g.env_id<>NEW.env_id OR g.capacity<>NEW.capacity OR g.expires_at_ms<>NEW.expires_at_ms))
BEGIN SELECT RAISE(ABORT,'signing_credit_grant_conflict');  END ;
CREATE TRIGGER wallet_signing_credit_grant_retained BEFORE DELETE ON wallet_signing_credit_grants
BEGIN SELECT RAISE(ABORT,'signing_credit_grant_retained');  END ;
