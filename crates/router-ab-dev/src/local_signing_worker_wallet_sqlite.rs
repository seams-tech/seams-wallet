//! The VM SigningWorker's wallet store: the shared wallet-store code over the
//! SigningWorker's role-private SQLite file.
//!
//! On Cloudflare each wallet's rows live in its own Durable Object, which
//! runs one request at a time. Here every store operation runs in one
//! IMMEDIATE transaction on the role's file, so operations on a wallet are
//! serialized the same way, and a claim and the presignature it consumes
//! commit together.

use router_ab_cloudflare::{
    SigningWorkerWalletEcdsaStoreV1, SigningWorkerWalletSqlV1, SigningWorkerWalletSqlValueV1,
};
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use rusqlite::{types::ValueRef, Connection, TransactionBehavior};
use serde::de::DeserializeOwned;
use std::time::Duration;

use super::LocalSigningWorkerConfigV1;

/// One SQLite connection as the wallet store's statement executor.
pub(crate) struct LocalWalletSqlV1<'a>(pub(crate) &'a Connection);

impl SigningWorkerWalletSqlV1 for LocalWalletSqlV1<'_> {
    fn query<T: DeserializeOwned>(
        &self,
        statement: &str,
        params: Vec<SigningWorkerWalletSqlValueV1>,
    ) -> RouterAbProtocolResult<Vec<T>> {
        let mut prepared = self.0.prepare(statement).map_err(sqlite_error)?;
        let columns = prepared
            .column_names()
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let params = params
            .into_iter()
            .map(|value| match value {
                SigningWorkerWalletSqlValueV1::Null => rusqlite::types::Value::Null,
                SigningWorkerWalletSqlValueV1::Text(value) => rusqlite::types::Value::Text(value),
                SigningWorkerWalletSqlValueV1::Integer(value) => {
                    rusqlite::types::Value::Integer(value)
                }
            })
            .collect::<Vec<_>>();
        let mut rows = prepared
            .query(rusqlite::params_from_iter(params))
            .map_err(sqlite_error)?;
        let mut decoded = Vec::new();
        while let Some(row) = rows.next().map_err(sqlite_error)? {
            let mut object = serde_json::Map::with_capacity(columns.len());
            for (index, column) in columns.iter().enumerate() {
                let value = match row.get_ref(index).map_err(sqlite_error)? {
                    ValueRef::Null => serde_json::Value::Null,
                    ValueRef::Integer(value) => value.into(),
                    ValueRef::Text(value) => {
                        serde_json::Value::String(String::from_utf8(value.to_vec()).map_err(
                            |_| store_error("SigningWorker wallet column is not UTF-8 text"),
                        )?)
                    }
                    ValueRef::Real(_) | ValueRef::Blob(_) => {
                        return Err(store_error(
                            "SigningWorker wallet column has an unexpected type",
                        ))
                    }
                };
                object.insert(column.clone(), value);
            }
            decoded.push(
                serde_json::from_value(serde_json::Value::Object(object)).map_err(|error| {
                    store_error(format!("SigningWorker wallet row is invalid: {error}"))
                })?,
            );
        }
        Ok(decoded)
    }
}

/// Runs one wallet-store operation in its own IMMEDIATE transaction on the
/// SigningWorker's role-private SQLite file. The transaction commits only if
/// the operation succeeds. The operation also gets the transaction's
/// executor, for the VM's own rows that must commit with it.
pub(crate) fn with_local_signing_worker_wallet_store_v1<T>(
    config: &LocalSigningWorkerConfigV1,
    operation: impl FnOnce(
        &SigningWorkerWalletEcdsaStoreV1<'_, LocalWalletSqlV1<'_>>,
        &LocalWalletSqlV1<'_>,
    ) -> RouterAbProtocolResult<T>,
) -> RouterAbProtocolResult<T> {
    let mut connection =
        Connection::open(&config.role_private_storage_path).map_err(sqlite_error)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(sqlite_error)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let result = {
        let sql = LocalWalletSqlV1(&transaction);
        let store = SigningWorkerWalletEcdsaStoreV1::open(&sql, &config.cloudflare_env)?;
        store.ensure_schema()?;
        operation(&store, &sql)?
    };
    transaction.commit().map_err(sqlite_error)?;
    Ok(result)
}

/// Creates the tables the SigningWorker's wallet store and its presignature
/// authority claims use, if they are missing, as the role does on first use.
pub(crate) fn ensure_local_signing_worker_wallet_schema_v1(
    connection: &Connection,
    config: &LocalSigningWorkerConfigV1,
) -> RouterAbProtocolResult<()> {
    let sql = LocalWalletSqlV1(connection);
    SigningWorkerWalletEcdsaStoreV1::open(&sql, &config.cloudflare_env)?.ensure_schema()?;
    Ok(())
}

fn store_error(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        message,
    )
}

fn sqlite_error(error: rusqlite::Error) -> RouterAbProtocolError {
    store_error(format!("SigningWorker wallet SQLite failed: {error}"))
}
