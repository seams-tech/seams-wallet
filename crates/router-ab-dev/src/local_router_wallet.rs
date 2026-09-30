//! The VM Router's wallet objects: the records the Cloudflare Router wallet
//! Durable Object keeps, in the Router's SQLite under each wallet's object
//! name. Commands run one at a time, each in one transaction, as a Durable
//! Object runs them.

use std::cell::RefCell;
use std::path::Path;

use router_ab_cloudflare::{
    router_wallet_serve_v1, RouterWalletRequestV1, RouterWalletResponseV1, RouterWalletStoreV1,
};
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use rusqlite::{OptionalExtension, TransactionBehavior};
use serde::{de::DeserializeOwned, Serialize};

use crate::local_tenant_root::{open_sqlite, sqlite_error};

static LOCAL_ROUTER_WALLET_OPERATION_LOCK_V1: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Runs one command against its wallet's object in the Router's SQLite.
pub(crate) fn serve_local_router_wallet_v1(
    storage_path: &Path,
    request: RouterWalletRequestV1,
) -> RouterAbProtocolResult<RouterWalletResponseV1> {
    let object_name = request.owner.object_name()?;
    let _serialized = LOCAL_ROUTER_WALLET_OPERATION_LOCK_V1
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut connection = open_sqlite(storage_path)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let store = LocalRouterWalletStoreV1 {
        transaction: &transaction,
        object_name,
        storage_error: RefCell::new(None),
    };
    let result = futures::executor::block_on(router_wallet_serve_v1(&store, request));
    if let Some(error) = store.storage_error.take() {
        return Err(storage_failure(error));
    }
    drop(store);
    transaction.commit().map_err(sqlite_error)?;
    result
}

struct LocalRouterWalletStoreV1<'t> {
    transaction: &'t rusqlite::Transaction<'t>,
    object_name: String,
    storage_error: RefCell<Option<String>>,
}

impl LocalRouterWalletStoreV1<'_> {
    fn record(&self, error: impl std::fmt::Display) -> RouterAbProtocolError {
        let message = error.to_string();
        self.storage_error.replace(Some(message.clone()));
        storage_failure(message)
    }
}

impl RouterWalletStoreV1 for LocalRouterWalletStoreV1<'_> {
    async fn get_json<T: DeserializeOwned>(&self, key: &str) -> RouterAbProtocolResult<Option<T>> {
        let value: Option<String> = self
            .transaction
            .query_row(
                "SELECT value_json FROM local_router_wallet_objects
                 WHERE object_name = ?1 AND storage_key = ?2",
                rusqlite::params![self.object_name, key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| self.record(error))?;
        value
            .map(|json| serde_json::from_str(&json).map_err(|error| self.record(error)))
            .transpose()
    }

    async fn put_json<T: Serialize>(&self, key: &str, value: &T) -> RouterAbProtocolResult<()> {
        let json = serde_json::to_string(value).map_err(|error| self.record(error))?;
        self.transaction
            .execute(
                "INSERT INTO local_router_wallet_objects (object_name, storage_key, value_json)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT (object_name, storage_key) DO UPDATE SET value_json = excluded.value_json",
                rusqlite::params![self.object_name, key, json],
            )
            .map_err(|error| self.record(error))?;
        Ok(())
    }
}

fn storage_failure(message: impl std::fmt::Display) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!("Router wallet object storage failed: {message}"),
    )
}
