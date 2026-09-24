use router_ab_cloudflare::{
    apply_cloudflare_signing_worker_ecdsa_pool_command_v1,
    CloudflareSigningWorkerEcdsaPoolCommandV1, CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1,
    CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1,
};
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};

use super::{encode_base64url_bytes_v1, require_non_empty, LocalSigningWorkerConfigV1};

const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS local_signing_worker_ecdsa_pool (
    record_key TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0)
)";

fn local_signing_worker_ecdsa_pool_store_key_v1(
    command: &CloudflareSigningWorkerEcdsaPoolCommandV1,
) -> RouterAbProtocolResult<String> {
    command.validate()?;
    let scope_bytes = command.scope().canonical_scope_bytes()?;
    let mut hasher = Sha256::new();
    hasher.update(b"router-ab-dev/signing-worker-ecdsa-pool/v1");
    hasher.update((scope_bytes.len() as u64).to_be_bytes());
    hasher.update(scope_bytes);
    let server_presignature_id = command.server_presignature_id();
    require_non_empty(
        "local SigningWorker ECDSA pool server_presignature_id",
        server_presignature_id,
    )?;
    Ok(format!(
        "{}:{}",
        encode_base64url_bytes_v1(&hasher.finalize()),
        server_presignature_id
    ))
}

pub(crate) fn local_signing_worker_ecdsa_pool_mutate_v1(
    config: &LocalSigningWorkerConfigV1,
    command: CloudflareSigningWorkerEcdsaPoolCommandV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1> {
    let key = local_signing_worker_ecdsa_pool_store_key_v1(&command)?;
    let path = Path::new(&config.role_private_storage_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| store_error(error.to_string()))?;
    }
    let mut connection = Connection::open(path).map_err(sqlite_error)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(sqlite_error)?;
    connection.execute_batch(SCHEMA).map_err(sqlite_error)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let selected = transaction
        .query_row(
            "SELECT record_json, version FROM local_signing_worker_ecdsa_pool WHERE record_key = ?1",
            params![key],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(sqlite_error)?;
    let current = selected
        .as_ref()
        .map(|(json, _)| {
            serde_json::from_str::<CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1>(json)
        })
        .transpose()
        .map_err(|error| store_error(format!("stored ECDSA pool record is invalid: {error}")))?;
    if let Some(record) = &current {
        record.validate()?;
    }
    let outcome = apply_cloudflare_signing_worker_ecdsa_pool_command_v1(current, command)?;
    outcome.validate()?;
    if matches!(
        &outcome,
        CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Available { stored: false, .. }
    ) {
        return Ok(outcome);
    }
    let record_json = serde_json::to_string(outcome.record())
        .map_err(|error| store_error(format!("ECDSA pool record serialization failed: {error}")))?;
    let written = match selected {
        None => transaction.execute(
            "INSERT INTO local_signing_worker_ecdsa_pool (record_key, record_json, version) VALUES (?1, ?2, 1)",
            params![key, record_json],
        ),
        Some((_, version)) => transaction.execute(
            "UPDATE local_signing_worker_ecdsa_pool SET record_json = ?1, version = version + 1 WHERE record_key = ?2 AND version = ?3",
            params![record_json, key, version],
        ),
    }
    .map_err(sqlite_error)?;
    if written != 1 {
        return Err(store_error("ECDSA pool conditional write is uncertain"));
    }
    transaction.commit().map_err(sqlite_error)?;
    Ok(outcome)
}

fn sqlite_error(error: rusqlite::Error) -> RouterAbProtocolError {
    store_error(format!(
        "SigningWorker ECDSA pool SQLite operation failed: {error}"
    ))
}

fn store_error(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        message,
    )
}
