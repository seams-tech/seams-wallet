-- Regional deployment admission is installed through the private control binding.
CREATE TABLE regional_deployment_admissions (
  deployment_lane TEXT NOT NULL,
  namespace TEXT NOT NULL,
  account_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  activation_sequence INTEGER NOT NULL CHECK(activation_sequence > 0 AND activation_sequence <= 9007199254740991),
  binding_revision TEXT NOT NULL,
  binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
  resource_verifications_json TEXT NOT NULL CHECK(json_valid(resource_verifications_json)),
  state TEXT NOT NULL CHECK(state IN ('prepared', 'active')),
  PRIMARY KEY(deployment_lane, namespace, account_id, database_id)
);

CREATE TRIGGER regional_deployment_admission_monotonic
BEFORE UPDATE ON regional_deployment_admissions
WHEN NEW.deployment_lane IS NOT OLD.deployment_lane OR NEW.namespace IS NOT OLD.namespace
  OR NEW.account_id IS NOT OLD.account_id OR NEW.database_id IS NOT OLD.database_id
  OR NEW.activation_sequence < OLD.activation_sequence
  OR (NEW.activation_sequence = OLD.activation_sequence AND OLD.state = 'active' AND (
    NEW.state != 'active' OR NEW.binding_revision IS NOT OLD.binding_revision
    OR NEW.binding_json IS NOT OLD.binding_json
    OR NEW.resource_verifications_json IS NOT OLD.resource_verifications_json))
  OR (NEW.activation_sequence > OLD.activation_sequence AND NEW.state != 'prepared')
BEGIN SELECT RAISE(ABORT, 'regional_deployment_admission_conflict'); END;

CREATE TRIGGER regional_deployment_admission_retained
BEFORE DELETE ON regional_deployment_admissions
BEGIN SELECT RAISE(ABORT, 'regional_deployment_admission_retained'); END;

-- Each runtime batch checks its admitted writer in the same transaction as its effects.
-- Successful checks leave no rows behind.
CREATE TABLE regional_deployment_write_checks (
  deployment_lane TEXT NOT NULL,
  namespace TEXT NOT NULL,
  account_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  binding_revision TEXT NOT NULL,
  writer_role TEXT NOT NULL CHECK(writer_role IN ('gateway', 'walletRuntime')),
  writer_version TEXT NOT NULL
);

CREATE TRIGGER regional_deployment_write_authorized
BEFORE INSERT ON regional_deployment_write_checks
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM regional_deployment_admissions AS admission,
      json_each(admission.resource_verifications_json) AS proof
    WHERE admission.deployment_lane = NEW.deployment_lane
      AND admission.namespace = NEW.namespace
      AND admission.account_id = NEW.account_id AND admission.database_id = NEW.database_id
      AND admission.binding_revision = NEW.binding_revision AND admission.state = 'active'
      AND json_extract(proof.value, '$.resource.accountId') = NEW.account_id
      AND json_extract(proof.value, '$.resource.databaseId') = NEW.database_id
      AND json_extract(proof.value, '$.authority.kind') = 'cloudflare'
      AND json_extract(proof.value, '$.authority.' || NEW.writer_role || '.versionId') = NEW.writer_version
  ) THEN RAISE(ABORT, 'regional_deployment_writer_retired') END;
  SELECT RAISE(IGNORE);
END;
