//! The VM Router's wallet objects: the records the Cloudflare Router wallet
//! Durable Object keeps, in the Router's SQLite under each wallet's object
//! name. Commands run one at a time, each in one transaction, as a Durable
//! Object runs them.

use std::cell::RefCell;
use std::path::Path;

use router_ab_cloudflare::{
    freeze_router_wallet_v1, router_wallet_serve_v1, transfer_router_wallet_v1,
    RouterWalletFreezeRequestV1, RouterWalletFreezeResponseV1, RouterWalletRegistrationRecordV1,
    RouterWalletRequestV1, RouterWalletResponseV1, RouterWalletStoreV1,
    RouterWalletTransferRequestV1, RouterWalletTransferResponseV1,
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
    with_store(
        storage_path,
        request.owner.object_name(request.ownership_generation)?,
        |store| futures::executor::block_on(router_wallet_serve_v1(store, request)),
    )
}

pub(crate) fn freeze_local_router_wallet_v1(
    storage_path: &Path,
    request: RouterWalletFreezeRequestV1,
) -> RouterAbProtocolResult<RouterWalletFreezeResponseV1> {
    with_store(
        storage_path,
        request.owner.object_name(request.source_generation)?,
        |store| futures::executor::block_on(freeze_router_wallet_v1(store, request)),
    )
}

pub(crate) fn transfer_local_router_wallet_v1(
    storage_path: &Path,
    request: RouterWalletTransferRequestV1,
) -> RouterAbProtocolResult<RouterWalletTransferResponseV1> {
    with_store(
        storage_path,
        request.owner().object_name(request.ownership_generation())?,
        |store| futures::executor::block_on(transfer_router_wallet_v1(store, request)),
    )
}

fn with_store<T>(
    storage_path: &Path,
    object_name: String,
    operation: impl FnOnce(&LocalRouterWalletStoreV1<'_>) -> RouterAbProtocolResult<T>,
) -> RouterAbProtocolResult<T> {
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
    let result = operation(&store);
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
    async fn delete_key(&self, key: &str) -> RouterAbProtocolResult<()> {
        self.transaction.execute(
            "DELETE FROM local_router_wallet_objects WHERE object_name = ?1 AND storage_key = ?2",
            rusqlite::params![self.object_name, key],
        ).map_err(|error| self.record(error))?;
        Ok(())
    }

    async fn list_keys(&self, prefix: &str, limit: u32) -> RouterAbProtocolResult<Vec<String>> {
        let mut statement = self
            .transaction
            .prepare(
                "SELECT storage_key FROM local_router_wallet_objects
             WHERE object_name = ?1 AND substr(storage_key, 1, length(?2)) = ?2
             ORDER BY storage_key LIMIT ?3",
            )
            .map_err(|error| self.record(error))?;
        let rows = statement
            .query_map(rusqlite::params![self.object_name, prefix, limit], |row| {
                row.get(0)
            })
            .map_err(|error| self.record(error))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| self.record(error))
    }

    async fn list_registrations(
        &self,
    ) -> RouterAbProtocolResult<Vec<(String, RouterWalletRegistrationRecordV1)>> {
        let mut statement = self
            .transaction
            .prepare(
                "SELECT storage_key, value_json FROM local_router_wallet_objects
             WHERE object_name = ?1 AND storage_key LIKE 'yao-registration/%' ORDER BY storage_key",
            )
            .map_err(|error| self.record(error))?;
        let rows = statement
            .query_map([&self.object_name], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| self.record(error))?;
        let mut records = Vec::new();
        for row in rows {
            let (key, value) = row.map_err(|error| self.record(error))?;
            records.push((
                key,
                serde_json::from_str(&value).map_err(|error| self.record(error))?,
            ));
        }
        Ok(records)
    }
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
