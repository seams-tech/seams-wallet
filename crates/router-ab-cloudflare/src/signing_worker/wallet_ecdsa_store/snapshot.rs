use super::*;

#[derive(Serialize)]
pub(super) struct EcdsaSnapshot {
    pools: Vec<PoolSnapshotRow>,
    activations: Vec<ActivationSnapshotRow>,
    linked_reservations: Vec<LinkedSnapshotRow>,
    effects: Vec<EffectSnapshotRow>,
}

impl EcdsaSnapshot {
    pub(super) fn encode(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        request: &SigningWorkerPoolFreezeRequestV1,
    ) -> RouterAbProtocolResult<Vec<u8>> {
        serde_json::to_vec(&(scope, request, self)).map_err(|error| wallet_error(error.to_string()))
    }

    pub(super) fn record_count(&self) -> u64 {
        (self.pools.len()
            + self.activations.len()
            + self.linked_reservations.len()
            + self.effects.len()) as u64
    }
}

#[derive(Serialize, Deserialize)]
struct PoolSnapshotRow {
    pool_key: String,
    owner_json: String,
    ciphertext_json: String,
    version: i64,
}

#[derive(Serialize, Deserialize)]
struct ActivationSnapshotRow {
    material_key: String,
    active_key: String,
    owner_json: String,
    ciphertext_json: String,
}

#[derive(Serialize, Deserialize)]
struct LinkedSnapshotRow {
    record_key: String,
    active_key: Option<String>,
    owner_json: String,
    ciphertext_json: String,
}

#[derive(Serialize, Deserialize)]
struct EffectSnapshotRow {
    operation_key: String,
    authorization_key: String,
    owner_json: String,
    request_digest_hex: String,
    authorization_json: String,
    claimed_at_ms: i64,
    terminal_json: String,
    committed_at_ms: i64,
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    /// Reads exact durable bytes after the caller drains effects and closes mutation admission.
    pub(super) fn ecdsa_snapshot(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<EcdsaSnapshot> {
        let owner = owner_json(scope, "wallet ECDSA snapshot")?;
        let pools = self.sql.query::<PoolSnapshotRow>(
            "SELECT pool_key, owner_json, ciphertext_json, version
             FROM wallet_ecdsa_pool WHERE owner_json = ? ORDER BY pool_key",
            vec![text(owner.clone())],
        )?;
        let activations = self.sql.query::<ActivationSnapshotRow>(
            "SELECT material_key, active_key, owner_json, ciphertext_json
             FROM wallet_ecdsa_activations WHERE owner_json = ? ORDER BY material_key",
            vec![text(owner.clone())],
        )?;
        for row in &activations {
            self.read_activation(scope, ActivationColumnV1::MaterialKey, &row.material_key)?
                .ok_or_else(|| wallet_error("Frozen ECDSA activation is missing"))?;
        }
        let linked_reservations = self.sql.query::<LinkedSnapshotRow>(
            "SELECT record_key, active_key, owner_json, ciphertext_json
             FROM wallet_linked_ecdsa WHERE owner_json = ? ORDER BY record_key",
            vec![text(owner.clone())],
        )?;
        for row in &linked_reservations {
            self.read_linked(scope, &row.record_key)?
                .ok_or_else(|| wallet_error("Frozen linked ECDSA reservation is missing"))?;
        }
        let effects = self.sql.query::<EffectSnapshotRow>(
            "SELECT operation_key, authorization_key, owner_json, request_digest_hex,
                    authorization_json, claimed_at_ms, terminal_json, committed_at_ms
             FROM wallet_ecdsa_effects WHERE owner_json = ? ORDER BY operation_key",
            vec![text(owner)],
        )?;
        Ok(EcdsaSnapshot {
            pools,
            activations,
            linked_reservations,
            effects,
        })
    }
}

pub(super) fn snapshot_digest(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"seams/signing-worker/wallet-ecdsa-snapshot/v1");
    digest.update(bytes);
    hex_slice(&digest.finalize())
}
