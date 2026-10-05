use super::*;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
struct PoolSnapshotRow {
    pool_key: String,
    owner_json: String,
    ciphertext_json: String,
    version: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ActivationSnapshotRow {
    material_key: String,
    active_key: String,
    owner_json: String,
    ciphertext_json: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LinkedSnapshotRow {
    record_key: String,
    active_key: Option<String>,
    owner_json: String,
    ciphertext_json: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    /// Restores historical rows inside verification's transaction; ordinary admission stays closed.
    pub(super) fn restore_ecdsa_snapshot(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        snapshot: EcdsaSnapshot,
    ) -> RouterAbProtocolResult<()> {
        let owner = owner_json(scope, "ECDSA restore")?;
        for row in snapshot.pools {
            let record: CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1 = self.cipher.open(
                "ecdsa_pool",
                &wallet_row_identity(scope, &row.pool_key)?,
                &row.ciphertext_json,
            )?;
            record.validate()?;
            let key = crate::ecdsa_pool_lifecycle::ecdsa_pool_storage_key(
                &record.scope,
                &record.server_presignature_id,
            )?;
            if row.owner_json != owner
                || record.scope.wallet_id != scope.wallet_id
                || row.pool_key != key
                || row.version < 0
                || !matches!(
                    record.lifecycle,
                    router_ab_ecdsa_pool::PoolRecord::Consumed(_)
                        | router_ab_ecdsa_pool::PoolRecord::Tombstone(_)
                )
            {
                return Err(wallet_error(
                    "ECDSA restore contains live or mismatched pool material",
                ));
            }
            self.sql.query::<serde::de::IgnoredAny>(
                "INSERT INTO wallet_ecdsa_pool (pool_key, owner_json, ciphertext_json, version) VALUES (?, ?, ?, ?)",
                vec![text(row.pool_key), text(row.owner_json), text(row.ciphertext_json), SigningWorkerWalletSqlValueV1::Integer(row.version)],
            )?;
        }
        for row in snapshot.activations {
            let record: CloudflareSigningWorkerOutputActivationRecordV1 = self.cipher.open(
                "ecdsa_activation",
                &wallet_row_identity(scope, &row.material_key)?,
                &row.ciphertext_json,
            )?;
            record.validate()?;
            let active = record.active_signing_worker_state();
            if row.owner_json != owner
                || active.account_id != scope.wallet_id
                || active.signing_worker_material_handle != row.material_key
                || linked::active_output_key_v1(&active.material_activation) != row.active_key
            {
                return Err(wallet_error(
                    "ECDSA restore activation identity is inconsistent",
                ));
            }
            self.sql.query::<serde::de::IgnoredAny>(
                "INSERT INTO wallet_ecdsa_activations (material_key, active_key, owner_json, ciphertext_json) VALUES (?, ?, ?, ?)",
                vec![text(row.material_key), text(row.active_key), text(row.owner_json), text(row.ciphertext_json)],
            )?;
        }
        for row in snapshot.linked_reservations {
            let stored: WalletLinkedEcdsaV1 = self.cipher.open(
                "linked_ecdsa",
                &wallet_row_identity(scope, &row.record_key)?,
                &row.ciphertext_json,
            )?;
            stored.state.validate()?;
            if row.owner_json != owner {
                return Err(wallet_error(
                    "ECDSA restore linked reservation owner changed",
                ));
            }
            match (&stored.activation, &row.active_key) {
                (Some(material), Some(active_key)) => {
                    material.active.validate()?;
                    material.material.validate()?;
                    if material.active.account_id != scope.wallet_id
                        || linked::active_output_key_v1(&material.active.material_activation)
                            != *active_key
                        || linked::reservation_record_key_v1(&material.active.material_activation)?
                            != row.record_key
                    {
                        return Err(wallet_error(
                            "ECDSA restore linked activation identity changed",
                        ));
                    }
                }
                (None, None) => {}
                _ => {
                    return Err(wallet_error(
                        "ECDSA restore linked activation index is inconsistent",
                    ))
                }
            }
            self.sql.query::<serde::de::IgnoredAny>(
                "INSERT INTO wallet_linked_ecdsa (record_key, active_key, owner_json, ciphertext_json) VALUES (?, ?, ?, ?)",
                vec![text(row.record_key), row.active_key.map(text).unwrap_or(SigningWorkerWalletSqlValueV1::Null), text(row.owner_json), text(row.ciphertext_json)],
            )?;
        }
        for row in snapshot.effects {
            let terminal: RouterAbEcdsaDerivationEvmDigestSigningResponseV1 =
                serde_json::from_str(&row.terminal_json)
                    .map_err(|error| wallet_error(error.to_string()))?;
            terminal.validate()?;
            let claim: crate::CloudflareSigningWorkerNormalSigningEffectClaimV1 =
                serde_json::from_str(&row.authorization_json)
                    .map_err(|error| wallet_error(error.to_string()))?;
            let operation_id = match &claim {
                crate::CloudflareSigningWorkerNormalSigningEffectClaimV1::ReusableWalletSession { claim } => {
                    claim.validate()?;
                    &claim.operation_id
                }
                crate::CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp { operation_id, .. } => operation_id,
            };
            let operation_key = format!(
                "evm-ecdsa/{}/{}/{}",
                scope.wallet_id, terminal.scope.material_activation.activation_id, operation_id
            );
            if row.owner_json != owner
                || terminal.scope.wallet_id != scope.wallet_id
                || row.operation_key != operation_key
                || row.authorization_key != format!("ecdsa-{}", claim.near_authorization_key())
                || row.claimed_at_ms <= 0
                || row.committed_at_ms < row.claimed_at_ms
            {
                return Err(wallet_error(
                    "ECDSA restore effect identity or history is inconsistent",
                ));
            }
            self.sql.query::<serde::de::IgnoredAny>(
                "INSERT INTO wallet_ecdsa_effects
                 (operation_key, authorization_key, owner_json, request_digest_hex, authorization_json, claimed_at_ms, terminal_json, committed_at_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                vec![text(row.operation_key), text(row.authorization_key), text(row.owner_json), text(row.request_digest_hex), text(row.authorization_json),
                     SigningWorkerWalletSqlValueV1::Integer(row.claimed_at_ms), text(row.terminal_json), SigningWorkerWalletSqlValueV1::Integer(row.committed_at_ms)],
            )?;
        }
        Ok(())
    }
}
