use super::*;

impl RouterAbSigningWorkerWalletDurableObject {
    pub(super) fn require_ed25519_unfenced(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> Result<(), RouterAbProtocolError> {
        let sql = DurableObjectWalletSqlV1(&self.sql);
        crate::SigningWorkerEd25519ExecutionStoreV1::new(&sql).require_unfenced(scope)
    }

    pub(super) async fn with_ecdsa_transaction<T: Serialize + 'static>(
        &self,
        operation: impl FnOnce(
                &crate::SigningWorkerWalletEcdsaStoreV1<'_, DurableObjectWalletSqlV1<'_>>,
            ) -> Result<T, RouterAbProtocolError>
            + 'static,
    ) -> Result<Response, RouterAbProtocolError> {
        let outcome = self
            .with_wallet_transaction(move |wallet| {
                let sql = DurableObjectWalletSqlV1(&wallet.sql);
                let store = crate::SigningWorkerWalletEcdsaStoreV1::open(
                    &sql,
                    &crate::CloudflareWorkerEnvReaderV1::new(&wallet.env),
                )?;
                operation(&store)
            })
            .await?;
        Response::from_json(&outcome).map_err(sql_error)
    }

    pub(super) async fn with_wallet_transaction<T: 'static>(
        &self,
        operation: impl FnOnce(&Self) -> Result<T, RouterAbProtocolError> + 'static,
    ) -> Result<T, RouterAbProtocolError> {
        let wallet = Self {
            state: Rc::clone(&self.state),
            timing: self.timing.clone(),
            sql: self.sql.clone(),
            storage: self.storage.clone(),
            env: self.env.clone(),
        };
        let result = Rc::new(RefCell::new(None));
        let transaction_result = Rc::clone(&result);
        let committed = self
            .storage
            .transaction(move |_| async move {
                let attempt = operation(&wallet);
                match attempt {
                    Ok(outcome) => {
                        *transaction_result.borrow_mut() = Some(Ok(outcome));
                        Ok(())
                    }
                    Err(error) => {
                        let message = error.to_string();
                        *transaction_result.borrow_mut() = Some(Err(error));
                        Err(worker::Error::RustError(message))
                    }
                }
            })
            .await;
        let outcome = result.borrow_mut().take();
        match (committed, outcome) {
            (Ok(()), Some(Ok(outcome))) => Ok(outcome),
            (Err(_), Some(Err(error))) => Err(error),
            (Err(error), _) => Err(sql_error(error)),
            (Ok(()), _) => Err(wallet_error("Wallet transaction returned no outcome")),
        }
    }
}
