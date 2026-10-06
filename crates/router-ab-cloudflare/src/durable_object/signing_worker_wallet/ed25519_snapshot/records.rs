use super::*;
use serde::de::DeserializeOwned;

pub(super) trait SnapshotRow: Serialize + DeserializeOwned {
    const SELECT: &'static str;
    fn key(&self) -> &str;
    fn validate(
        &self,
        wallet: &RouterAbSigningWorkerWalletDurableObject,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> Result<(), RouterAbProtocolError>;
    fn into_record(self) -> SnapshotRecord;
}

#[derive(Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "row",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub(super) enum SnapshotRecord {
    Registration(RegistrationSnapshotRow),
    RetiredActivation(RetiredSnapshotRow),
    LinkedDevice(LinkedSnapshotRow),
    Round1(Round1RowV1),
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RegistrationSnapshotRow {
    registration_key: String,
    active_key: String,
    owner_json: String,
    ciphertext_json: String,
}

impl SnapshotRow for RegistrationSnapshotRow {
    const SELECT: &'static str = "SELECT * FROM wallet_registrations
        WHERE registration_key > ? ORDER BY registration_key LIMIT 16";
    fn key(&self) -> &str {
        &self.registration_key
    }
    fn validate(
        &self,
        wallet: &RouterAbSigningWorkerWalletDurableObject,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> Result<(), RouterAbProtocolError> {
        let stored = wallet.decode_registration_row(
            scope,
            &RegistrationRowV1 {
                registration_key: self.registration_key.clone(),
                owner_json: self.owner_json.clone(),
                ciphertext_json: self.ciphertext_json.clone(),
            },
        )?;
        stored.activation.validate()?;
        if !matches!(
            stored.lifecycle,
            SigningWorkerYaoDurableStateV1::Active { .. }
        ) || active_key(stored.activation.active_signing_worker_state()) != self.active_key
        {
            return Err(wallet_error(
                "Ed25519 snapshot registration is unsettled or misindexed",
            ));
        }
        Ok(())
    }
    fn into_record(self) -> SnapshotRecord {
        SnapshotRecord::Registration(self)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RetiredSnapshotRow {
    active_key: String,
    registration_key: String,
}

impl SnapshotRow for RetiredSnapshotRow {
    const SELECT: &'static str = "SELECT * FROM wallet_retired_activations
        WHERE active_key > ? ORDER BY active_key LIMIT 16";
    fn key(&self) -> &str {
        &self.active_key
    }
    fn validate(
        &self,
        wallet: &RouterAbSigningWorkerWalletDurableObject,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> Result<(), RouterAbProtocolError> {
        wallet
            .read_registration(scope, &self.registration_key)?
            .ok_or_else(|| wallet_error("Retired Ed25519 activation has no registration"))?;
        Ok(())
    }
    fn into_record(self) -> SnapshotRecord {
        SnapshotRecord::RetiredActivation(self)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LinkedSnapshotRow {
    record_key: String,
    active_key: Option<String>,
    owner_json: String,
    ciphertext_json: String,
}

impl SnapshotRow for LinkedSnapshotRow {
    const SELECT: &'static str = "SELECT * FROM wallet_linked_ed25519
        WHERE record_key > ? ORDER BY record_key LIMIT 16";
    fn key(&self) -> &str {
        &self.record_key
    }
    fn validate(
        &self,
        wallet: &RouterAbSigningWorkerWalletDurableObject,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> Result<(), RouterAbProtocolError> {
        let stored = wallet.decode_linked_row(
            scope,
            &LinkedRowV1 {
                record_key: self.record_key.clone(),
                owner_json: self.owner_json.clone(),
                ciphertext_json: self.ciphertext_json.clone(),
            },
        )?;
        let expected_key = match stored.activation {
            Some(activation) => {
                activation.validate()?;
                Some(active_key(activation.active_signing_worker_state()))
            }
            None => None,
        };
        if expected_key != self.active_key {
            return Err(wallet_error(
                "Linked Ed25519 snapshot activation index differs",
            ));
        }
        Ok(())
    }
    fn into_record(self) -> SnapshotRecord {
        SnapshotRecord::LinkedDevice(self)
    }
}

impl SnapshotRow for Round1RowV1 {
    const SELECT: &'static str = "SELECT * FROM wallet_round1
        WHERE binding_key > ? ORDER BY binding_key LIMIT 16";
    fn key(&self) -> &str {
        &self.binding_key
    }
    fn validate(
        &self,
        wallet: &RouterAbSigningWorkerWalletDurableObject,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> Result<(), RouterAbProtocolError> {
        self.validate()?;
        wallet.open_round1(scope, self)?;
        if self.state == "claimed" {
            return Err(wallet_error(
                "Claimed Ed25519 round cannot enter a snapshot",
            ));
        }
        Ok(())
    }
    fn into_record(self) -> SnapshotRecord {
        SnapshotRecord::Round1(self)
    }
}
