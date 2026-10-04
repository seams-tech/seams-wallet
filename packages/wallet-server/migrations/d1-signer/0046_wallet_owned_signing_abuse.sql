-- Require disposable-state cleanup before replacing unowned policy records.
CREATE TABLE signing_admission_reset_guard (
  record_count INTEGER NOT NULL CHECK (record_count = 0)
);
INSERT INTO signing_admission_reset_guard
SELECT COUNT(*) FROM router_ab_normal_signing_admission_records;
DROP TABLE signing_admission_reset_guard;
DROP TABLE router_ab_normal_signing_admission_records;

CREATE TABLE router_ab_normal_signing_admission_records (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  env_id TEXT NOT NULL,
  signing_root_version TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('project_policy', 'abuse')),
  record_key TEXT NOT NULL,
  wallet_id TEXT,
  decision TEXT NOT NULL,
  retry_after_ms INTEGER,
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  PRIMARY KEY (
    namespace, org_id, project_id, env_id, signing_root_version, record_kind, record_key
  ),
  CHECK (
    (record_kind = 'project_policy' AND wallet_id IS NULL
      AND decision IN ('allowed', 'rejected')
      AND record_key = org_id || char(31) || project_id || char(31) || env_id || char(31) || signing_root_version)
    OR
    (record_kind = 'abuse' AND wallet_id IS NOT NULL AND length(wallet_id) > 0
      AND decision IN ('allowed', 'rate_limited', 'rejected')
      AND instr(record_key, org_id || char(31) || project_id || char(31) || env_id || char(31) ||
        signing_root_version || char(31) || wallet_id || char(31)) = 1)
  ),
  CHECK (
    (decision IN ('rejected', 'rate_limited') AND retry_after_ms IS NOT NULL AND retry_after_ms > 0)
    OR (decision = 'allowed' AND retry_after_ms IS NULL)
  )
);
CREATE INDEX signing_abuse_wallet ON router_ab_normal_signing_admission_records
  (namespace, org_id, project_id, env_id, wallet_id) WHERE record_kind = 'abuse';
