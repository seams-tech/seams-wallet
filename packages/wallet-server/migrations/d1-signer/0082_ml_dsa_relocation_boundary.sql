-- Participant transfer is not implemented for ML-DSA. Never freeze a snapshot
-- that would omit an installed key or an operation with an uncertain outcome.
CREATE TRIGGER wallet_ml_dsa_relocation_unsupported
BEFORE INSERT ON wallet_relocation_authorization_fences
WHEN EXISTS (
  SELECT 1 FROM router_ab_yao_versioned_json_records AS registration
  WHERE registration.namespace=NEW.namespace AND registration.org_id=NEW.org_id
    AND registration.project_id=NEW.project_id AND registration.env_id=NEW.env_id
    AND substr(registration.record_key,1,20)='ml-dsa-registration:'
    AND json_extract(registration.record_json,'$.preparation.identity.walletId')=NEW.wallet_id
    AND json_extract(registration.record_json,'$.phase.kind')NOT IN ('admitted','expired_admission')
)
BEGIN SELECT RAISE(ABORT, 'wallet_ml_dsa_relocation_unsupported'); END;
