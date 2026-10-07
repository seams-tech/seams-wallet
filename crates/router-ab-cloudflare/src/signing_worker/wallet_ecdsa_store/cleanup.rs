use super::relocation::Fence;
use super::*;

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    // The authenticated coordinator supplies the destination's Activated receipt.
    // The host commits each bounded deletion with its source fence in one transaction.
    pub(super) fn cleanup_ecdsa_source(
        &self,
        activation: SigningWorkerPoolFreezeReceiptV1,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaTransferResponseV1> {
        import::validate_receipt(&activation)?;
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
                WHERE COALESCE(json_extract(authority_json, '$.authority.wallet_scope.org_id'), json_extract(authority_json, '$.wallet_scope.org_id')) = ?
                  AND COALESCE(json_extract(authority_json, '$.authority.wallet_scope.project_id'), json_extract(authority_json, '$.wallet_scope.project_id')) = ?
                  AND COALESCE(json_extract(authority_json, '$.authority.wallet_scope.project_environment_id'), json_extract(authority_json, '$.wallet_scope.project_environment_id')) = ?
                  AND COALESCE(json_extract(authority_json, '$.authority.wallet_scope.wallet_id'), json_extract(authority_json, '$.wallet_scope.wallet_id')) = ?
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
