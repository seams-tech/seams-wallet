use super::*;

impl RouterAbSigningWorkerWalletDurableObject {
    pub(super) fn settle_ed25519(
        &self,
        command: crate::SigningWorkerEd25519FenceCommandV1,
    ) -> Result<Response, RouterAbProtocolError> {
        let sql = DurableObjectWalletSqlV1(&self.sql);
        let execution = crate::SigningWorkerEd25519ExecutionStoreV1::new(&sql);
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let mut after = String::new();
        let mut pending_rounds = 0;
        loop {
            let rows = self
                .sql
                .exec(
                    "SELECT * FROM wallet_round1 WHERE state != 'completed'
                 AND binding_key > ? ORDER BY binding_key LIMIT 16",
                    vec![SqlStorageValue::String(after.clone())],
                )
                .map_err(sql_error)?
                .to_array::<Round1RowV1>()
                .map_err(sql_error)?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                after = row.binding_key.clone();
                row.validate()?;
                let stored = self.open_round1(&command.scope, &row)?;
                if row.state == "claimed" || now_ms < stored.record.expires_at_ms {
                    pending_rounds += 1;
                }
            }
        }
        let receipt = execution.settle(command, pending_rounds)?;
        Response::from_json(&receipt).map_err(sql_error)
    }
}
