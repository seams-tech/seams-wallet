use super::relocation::Fence;
use super::*;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ecdsa_completed_cleanup (
    owner_json TEXT NOT NULL,
    move_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    PRIMARY KEY (owner_json, move_id))";

#[derive(Deserialize)]
struct CleanupRow {
    receipt_json: String,
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    // The authenticated coordinator supplies the destination's Activated receipt.
    // The host commits each bounded deletion with its source fence in one transaction.
    pub(super) fn cleanup_ecdsa_source(
        &self,
        activation: SigningWorkerPoolFreezeReceiptV1,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaTransferResponseV1> {
        import::validate_receipt(&activation)?;
        if self.completed_cleanup(&activation)? {
            return Ok(SigningWorkerEcdsaTransferResponseV1::Cleaned {
                receipt: activation,
            });
        }
        let scope = &activation.scope;
        match self.pool_fence(scope)? {
            Some(Fence::Cleaned { receipt }) if receipt == activation => {
                return Ok(SigningWorkerEcdsaTransferResponseV1::Cleaned { receipt });
            }
            Some(Fence::Cleaning { receipt }) if receipt == activation => {}
            Some(Fence::Frozen { receipt }) if receipt == activation => {
                self.save_pool_fence(scope, &Fence::Cleaning { receipt })?;
            }
            _ => {
                return Err(wallet_error(
                    "ECDSA cleanup requires the exact frozen source",
                ))
            }
        }
        let owner = owner_json(scope, "ECDSA source cleanup")?;
        for table in [
            "wallet_ecdsa_effects",
            "wallet_ecdsa_pool",
            "wallet_linked_ecdsa",
            "wallet_ecdsa_activations",
            "wallet_linked_presign_sessions",
            "wallet_ecdsa_import_chunks",
            "wallet_ecdsa_snapshot_pages",
            "wallet_ecdsa_snapshot_manifest",
        ] {
            let deleted = self.sql.query::<serde::de::IgnoredAny>(
                &format!("DELETE FROM {table} WHERE rowid IN (SELECT rowid FROM {table} WHERE owner_json = ? ORDER BY rowid LIMIT 16) RETURNING rowid"),
                vec![text(owner.clone())],
            )?;
            if !deleted.is_empty() {
                return Ok(SigningWorkerEcdsaTransferResponseV1::Cleaning {
                    receipt: activation,
                });
            }
        }
        let deleted = self.sql.query::<serde::de::IgnoredAny>(
            "DELETE FROM signing_worker_presign_authorities WHERE presign_session_id IN (
                SELECT presign_session_id FROM signing_worker_presign_authorities
                WHERE json_extract(authority_json, '$.wallet_scope.org_id') = ?
                  AND json_extract(authority_json, '$.wallet_scope.project_id') = ?
                  AND json_extract(authority_json, '$.wallet_scope.project_environment_id') = ?
                  AND json_extract(authority_json, '$.wallet_scope.wallet_id') = ?
                ORDER BY presign_session_id LIMIT 16) RETURNING presign_session_id",
            vec![
                text(scope.org_id.clone()),
                text(scope.project_id.clone()),
                text(scope.project_environment_id.clone()),
                text(scope.wallet_id.clone()),
            ],
        )?;
        if !deleted.is_empty() {
            return Ok(SigningWorkerEcdsaTransferResponseV1::Cleaning {
                receipt: activation,
            });
        }
        let encoded =
            serde_json::to_string(&activation).map_err(|error| wallet_error(error.to_string()))?;
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_ecdsa_completed_cleanup (owner_json, move_id, receipt_json) VALUES (?, ?, ?)",
            vec![text(owner), text(activation.request.move_id.clone()), text(encoded)],
        )?;
        self.save_pool_fence(
            scope,
            &Fence::Cleaned {
                receipt: activation.clone(),
            },
        )?;
        Ok(SigningWorkerEcdsaTransferResponseV1::Cleaned {
            receipt: activation,
        })
    }
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    pub(super) fn completed_cleanup(
        &self,
        receipt: &SigningWorkerPoolFreezeReceiptV1,
    ) -> RouterAbProtocolResult<bool> {
        let rows = self.sql.query::<CleanupRow>(
            "SELECT receipt_json FROM wallet_ecdsa_completed_cleanup WHERE owner_json = ? AND move_id = ?",
            vec![text(owner_json(&receipt.scope, "ECDSA cleanup history")?), text(receipt.request.move_id.clone())],
        )?;
        match rows.as_slice() {
            [] => Ok(false),
            [row] => {
                let stored: SigningWorkerPoolFreezeReceiptV1 =
                    serde_json::from_str(&row.receipt_json)
                        .map_err(|error| wallet_error(error.to_string()))?;
                if stored != *receipt {
                    return Err(wallet_error("ECDSA completed cleanup receipt changed"));
                }
                Ok(true)
            }
            _ => Err(wallet_error("ECDSA completed cleanup is duplicated")),
        }
    }
}
