use super::*;

impl RouterAbSigningWorkerWalletDurableObject {
    // The authenticated coordinator supplies the destination's Activated receipt.
    pub(super) fn cleanup_ed25519_source(
        &self,
        activation: SigningWorkerEd25519SnapshotReceiptV1,
    ) -> Result<SigningWorkerEd25519SnapshotResponseV1, RouterAbProtocolError> {
        import::validate_receipt(&activation)?;
        let owner = serde_json::to_string(&activation.source.scope)
            .map_err(snapshot_encoding_error)?;
        let history = self.sql.exec(
            "SELECT state_json FROM wallet_ed25519_completed_cleanup WHERE owner_json = ? AND move_id = ?",
            vec![SqlStorageValue::String(owner.clone()), SqlStorageValue::String(activation.source.request.move_id.clone())],
        ).map_err(sql_error)?.to_array::<StateRow>().map_err(sql_error)?;
        if let [row] = history.as_slice() {
            let stored: SigningWorkerEd25519SnapshotReceiptV1 = serde_json::from_str(&row.state_json).map_err(snapshot_encoding_error)?;
            if stored != activation {
                return Err(wallet_error("Ed25519 completed cleanup receipt changed"));
            }
            return Ok(SigningWorkerEd25519SnapshotResponseV1::Cleaned { receipt: stored });
        }
        match self.read_ed25519_snapshot(&owner)? {
            Some(SnapshotState::Cleaned { receipt }) if receipt == activation => {
                return Ok(SigningWorkerEd25519SnapshotResponseV1::Cleaned { receipt });
            }
            Some(SnapshotState::Frozen { receipt } | SnapshotState::Cleaning { receipt })
                if receipt == activation => {}
            _ => return Err(wallet_error("Ed25519 cleanup requires the exact frozen source")),
        }
        let sql = DurableObjectWalletSqlV1(&self.sql);
        crate::SigningWorkerEd25519ExecutionStoreV1::new(&sql)
            .require_settlement(&activation.source)?;
        // Each object belongs to one wallet. Keep its execution authority and fence.
        for table in [
            "wallet_round1",
            "wallet_linked_ed25519",
            "wallet_retired_activations",
            "wallet_registrations",
            "wallet_ed25519_import_segments",
            "wallet_ed25519_import",
            "wallet_ed25519_snapshot_segments",
        ] {
            let deleted = self.sql.exec(
                &format!("DELETE FROM {table} WHERE rowid IN (SELECT rowid FROM {table} ORDER BY rowid LIMIT 16) RETURNING rowid"),
                None,
            ).map_err(sql_error)?.to_array::<serde::de::IgnoredAny>().map_err(sql_error)?;
            if !deleted.is_empty() {
                self.save_ed25519_cleanup(&owner, &SnapshotState::Cleaning {
                    receipt: activation.clone(),
                })?;
                return Ok(SigningWorkerEd25519SnapshotResponseV1::Cleaning {
                    receipt: activation,
                });
            }
        }
        self.save_ed25519_cleanup(&owner, &SnapshotState::Cleaned {
            receipt: activation.clone(),
        })?;
        Ok(SigningWorkerEd25519SnapshotResponseV1::Cleaned { receipt: activation })
    }

    fn save_ed25519_cleanup(
        &self,
        owner: &str,
        state: &SnapshotState,
    ) -> Result<(), RouterAbProtocolError> {
        self.sql.exec(
            "UPDATE wallet_ed25519_snapshot SET state_json = ? WHERE owner_json = ?",
            vec![
                SqlStorageValue::String(serde_json::to_string(state).map_err(snapshot_encoding_error)?),
                SqlStorageValue::String(owner.to_owned()),
            ],
        ).map_err(sql_error)?;
        Ok(())
    }
}
