//! The VM SigningWorker's wallet store: the shared wallet-store code over the
//! SigningWorker's role-private SQLite file.
//!
//! On Cloudflare each wallet's rows live in its own Durable Object, which
//! runs one request at a time. Here every store operation runs in one
//! IMMEDIATE transaction on the role's file, so operations on a wallet are
//! serialized the same way, and a claim and the presignature it consumes
//! commit together.

use router_ab_cloudflare::{
    CloudflareSigningWorkerEcdsaPresignAuthorityV1,
    CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1, SigningWorkerWalletEcdsaStoreV1,
    SigningWorkerWalletSqlV1, SigningWorkerWalletSqlValueV1,
};
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use rusqlite::{types::ValueRef, Connection, TransactionBehavior};
use serde::de::DeserializeOwned;
use std::time::Duration;

use super::LocalSigningWorkerConfigV1;

/// One SQLite connection as the wallet store's statement executor.
pub(crate) struct LocalWalletSqlV1<'a>(&'a Connection);

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

const PRESIGN_AUTHORITY_SCHEMA: &str =
    "CREATE TABLE IF NOT EXISTS signing_worker_presign_authorities (
    presign_session_id TEXT PRIMARY KEY,
    authority_json TEXT NOT NULL,
    ceremony_expires_at_ms INTEGER NOT NULL)";

#[derive(serde::Deserialize)]
struct PresignAuthorityRowV1 {
    authority_json: String,
}

#[derive(serde::Deserialize)]
struct ClaimedPresignAuthorityV1 {
    #[allow(dead_code)]
    presign_session_id: String,
}

/// Claims one presignature session's authority before any server message.
///
/// On Cloudflare the session's Durable Object makes this one-use claim in its
/// own storage and deletes it when the ceremony expires. A retry, or a second
/// start of the same session, is refused; a failed or interrupted ceremony
/// also burns its session id.
pub(crate) fn claim_local_presign_authority_v1(
    sql: &LocalWalletSqlV1<'_>,
    request: &CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<()> {
    sql.query::<serde::de::IgnoredAny>(PRESIGN_AUTHORITY_SCHEMA, Vec::new())?;
    sql.query::<serde::de::IgnoredAny>(
        "DELETE FROM signing_worker_presign_authorities WHERE ceremony_expires_at_ms <= ?",
        vec![integer(now_unix_ms)?],
    )?;
    let authority_json = serde_json::to_string(&request.authority)
        .map_err(|error| store_error(format!("presign authority is invalid: {error}")))?;
    let claimed = sql.query::<ClaimedPresignAuthorityV1>(
        "INSERT INTO signing_worker_presign_authorities
         (presign_session_id, authority_json, ceremony_expires_at_ms)
         VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING presign_session_id",
        vec![
            SigningWorkerWalletSqlValueV1::Text(request.presign_session_id.clone()),
            SigningWorkerWalletSqlValueV1::Text(authority_json),
            integer(request.ceremony_expires_at_ms)?,
        ],
    )?;
    if claimed.len() != 1 {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ReplayedLocalRequest,
            "SigningWorker ECDSA presign identity was already initialized",
        ));
    }
    Ok(())
}

/// The authority one presignature session was started with.
pub(crate) fn load_local_presign_authority_v1(
    sql: &LocalWalletSqlV1<'_>,
    presign_session_id: &str,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPresignAuthorityV1> {
    sql.query::<serde::de::IgnoredAny>(PRESIGN_AUTHORITY_SCHEMA, Vec::new())?;
    let rows = sql.query::<PresignAuthorityRowV1>(
        "SELECT authority_json FROM signing_worker_presign_authorities
         WHERE presign_session_id = ? AND ceremony_expires_at_ms > ?",
        vec![
            SigningWorkerWalletSqlValueV1::Text(presign_session_id.to_owned()),
            integer(now_unix_ms)?,
        ],
    )?;
    let [row] = rows.as_slice() else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            "SigningWorker ECDSA presign authority is unavailable",
        ));
    };
    serde_json::from_str(&row.authority_json)
        .map_err(|error| store_error(format!("stored presign authority is invalid: {error}")))
}

fn integer(value: u64) -> RouterAbProtocolResult<SigningWorkerWalletSqlValueV1> {
    i64::try_from(value)
        .map(SigningWorkerWalletSqlValueV1::Integer)
        .map_err(|_| store_error("timestamp exceeds the SQLite integer range"))
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
