use super::*;
mod capture;
mod restore;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PoolSnapshotRow {
    pool_key: String,
    owner_json: String,
    ciphertext_json: String,
    #[serde(with = "sql_integer")]
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
    #[serde(with = "sql_integer")]
    claimed_at_ms: i64,
    terminal_json: String,
    #[serde(with = "sql_integer")]
    committed_at_ms: i64,
}

pub(super) fn snapshot_hasher() -> Sha256 {
    let mut digest = Sha256::new();
    digest.update(b"seams/signing-worker/wallet-ecdsa-snapshot/v1");
    digest
}

struct SnapshotDigestWriter(Sha256);

impl std::io::Write for SnapshotDigestWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    fn restore_pool_record(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        row: PoolSnapshotRow,
    ) -> RouterAbProtocolResult<()> {
        let owner = owner_json(scope, "ECDSA restore")?;
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
        Ok(())
    }

    fn restore_activation_record(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        row: ActivationSnapshotRow,
    ) -> RouterAbProtocolResult<()> {
        let owner = owner_json(scope, "ECDSA restore")?;
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
        Ok(())
    }

    fn restore_linked_reservation(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        row: LinkedSnapshotRow,
    ) -> RouterAbProtocolResult<()> {
        let owner = owner_json(scope, "ECDSA restore")?;
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
        Ok(())
    }

    fn restore_effect_record(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        row: EffectSnapshotRow,
    ) -> RouterAbProtocolResult<()> {
        let owner = owner_json(scope, "ECDSA restore")?;
        let terminal: RouterAbEcdsaDerivationEvmDigestSigningResponseV1 =
            serde_json::from_str(&row.terminal_json)
                .map_err(|error| wallet_error(error.to_string()))?;
        terminal.validate()?;
        let claim: crate::CloudflareSigningWorkerNormalSigningEffectClaimV1 =
            serde_json::from_str(&row.authorization_json)
                .map_err(|error| wallet_error(error.to_string()))?;
        let operation_id = match &claim {
            crate::CloudflareSigningWorkerNormalSigningEffectClaimV1::ReusableWalletSession {
                claim,
            } => {
                claim.validate()?;
                &claim.operation_id
            }
            crate::CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
                operation_id,
                ..
            } => operation_id,
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
        Ok(())
    }
}
