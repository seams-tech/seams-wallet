use router_ab_cloudflare::{
    apply_cloudflare_signing_worker_ecdsa_pool_command_v1,
    CloudflareSigningWorkerEcdsaPoolCommandV1, CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1,
    CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1,
};
use router_ab_core::{
    RouterAbEcdsaDerivationEvmDigestSigningResponseV1, RouterAbEcdsaDerivationNormalSigningScopeV1,
    RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};

use super::{
    encode_base64url_bytes_v1, require_non_empty,
    LocalSigningWorkerAdmittedRouterAbEcdsaDerivationFinalizeRequestV1, LocalSigningWorkerConfigV1,
};

const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS local_signing_worker_ecdsa_pool (
    record_key TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0)
);
CREATE TABLE IF NOT EXISTS local_signing_worker_ecdsa_effect (
    operation_key TEXT PRIMARY KEY,
    presignature_key TEXT NOT NULL UNIQUE,
    request_digest_hex TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('claimed', 'completed')),
    terminal_json TEXT,
    CHECK ((state = 'claimed' AND terminal_json IS NULL)
        OR (state = 'completed' AND terminal_json IS NOT NULL))
)";

fn local_signing_worker_ecdsa_pool_store_key_v1(
    command: &CloudflareSigningWorkerEcdsaPoolCommandV1,
) -> RouterAbProtocolResult<String> {
    command.validate()?;
    ecdsa_presignature_key(command.scope(), command.server_presignature_id())
}

fn ecdsa_presignature_key(
    scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
    server_presignature_id: &str,
) -> RouterAbProtocolResult<String> {
    let scope_bytes = scope.canonical_scope_bytes()?;
    let mut hasher = Sha256::new();
    hasher.update(b"router-ab-dev/signing-worker-ecdsa-pool/v1");
    hasher.update((scope_bytes.len() as u64).to_be_bytes());
    hasher.update(scope_bytes);
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
    let mut connection = open_connection(config)?;
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

pub(crate) fn local_signing_worker_ecdsa_effect_claim_v1(
    config: &LocalSigningWorkerConfigV1,
    admitted: &LocalSigningWorkerAdmittedRouterAbEcdsaDerivationFinalizeRequestV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<Option<String>> {
    admitted.validate()?;
    let operation_key = ecdsa_effect_operation_key(admitted)?;
    let presignature_key = ecdsa_presignature_key(
        &admitted.request.scope,
        &admitted.request.server_presignature_id,
    )?;
    let request_digest_hex = ecdsa_effect_request_digest_hex(admitted)?;
    let mut connection = open_connection(config)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let existing = transaction
        .query_row(
            "SELECT request_digest_hex, state, terminal_json FROM local_signing_worker_ecdsa_effect WHERE operation_key = ?1",
            params![operation_key],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?)),
        )
        .optional()
        .map_err(sqlite_error)?;
    if let Some((stored_digest, state, terminal_json)) = existing {
        if stored_digest != request_digest_hex {
            return Err(replay_error(
                "SigningWorker ECDSA operation has different request material",
            ));
        }
        return match (state.as_str(), terminal_json) {
            ("claimed", None) => Err(replay_error("SigningWorker ECDSA effect is still pending")),
            ("completed", Some(json)) => {
                let response: RouterAbEcdsaDerivationEvmDigestSigningResponseV1 =
                    serde_json::from_str(&json).map_err(|error| {
                        store_error(format!(
                            "stored ECDSA terminal response is invalid: {error}"
                        ))
                    })?;
                response.validate_for_request(&admitted.request)?;
                Ok(Some(json))
            }
            _ => Err(store_error("stored ECDSA effect has an invalid lifecycle")),
        };
    }
    admitted.request.validate_at(now_unix_ms)?;
    let other_operation = transaction
        .query_row(
            "SELECT operation_key FROM local_signing_worker_ecdsa_effect WHERE presignature_key = ?1",
            params![presignature_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sqlite_error)?;
    if other_operation.is_some() {
        return Err(replay_error(
            "SigningWorker ECDSA presignature belongs to another effect",
        ));
    }
    let inserted = transaction
        .execute(
            "INSERT INTO local_signing_worker_ecdsa_effect (operation_key, presignature_key, request_digest_hex, state) VALUES (?1, ?2, ?3, 'claimed')",
            params![operation_key, presignature_key, request_digest_hex],
        )
        .map_err(sqlite_error)?;
    if inserted != 1 {
        return Err(store_error("ECDSA effect claim write is uncertain"));
    }
    transaction.commit().map_err(sqlite_error)?;
    Ok(None)
}

pub(crate) fn local_signing_worker_ecdsa_effect_complete_v1(
    config: &LocalSigningWorkerConfigV1,
    admitted: &LocalSigningWorkerAdmittedRouterAbEcdsaDerivationFinalizeRequestV1,
    response: &RouterAbEcdsaDerivationEvmDigestSigningResponseV1,
) -> RouterAbProtocolResult<String> {
    admitted.validate()?;
    response.validate_for_request(&admitted.request)?;
    let operation_key = ecdsa_effect_operation_key(admitted)?;
    let request_digest_hex = ecdsa_effect_request_digest_hex(admitted)?;
    let response_json = serde_json::to_string(response)
        .map_err(|error| store_error(format!("ECDSA terminal serialization failed: {error}")))?;
    let connection = open_connection(config)?;
    let updated = connection
        .execute(
            "UPDATE local_signing_worker_ecdsa_effect SET state = 'completed', terminal_json = ?1
             WHERE operation_key = ?2 AND request_digest_hex = ?3 AND state = 'claimed'",
            params![response_json, operation_key, request_digest_hex],
        )
        .map_err(sqlite_error)?;
    if updated != 1 {
        return Err(store_error("ECDSA terminal write is uncertain"));
    }
    Ok(response_json)
}

fn ecdsa_effect_operation_key(
    admitted: &LocalSigningWorkerAdmittedRouterAbEcdsaDerivationFinalizeRequestV1,
) -> RouterAbProtocolResult<String> {
    let scope_bytes = admitted.request.scope.canonical_scope_bytes()?;
    let mut hasher = Sha256::new();
    hasher.update(b"router-ab-dev/signing-worker-ecdsa-effect/v1");
    hasher.update((scope_bytes.len() as u64).to_be_bytes());
    hasher.update(scope_bytes);
    Ok(format!(
        "{}:{}",
        encode_base64url_bytes_v1(&hasher.finalize()),
        admitted.request.operation_id
    ))
}

fn ecdsa_effect_request_digest_hex(
    admitted: &LocalSigningWorkerAdmittedRouterAbEcdsaDerivationFinalizeRequestV1,
) -> RouterAbProtocolResult<String> {
    let encoded = serde_json::to_vec(admitted)
        .map_err(|error| store_error(format!("ECDSA effect request is invalid: {error}")))?;
    let mut hasher = Sha256::new();
    hasher.update(b"router-ab-dev/signing-worker-ecdsa-effect-request/v1");
    hasher.update(encoded);
    Ok(hex::encode(hasher.finalize()))
}

fn open_connection(config: &LocalSigningWorkerConfigV1) -> RouterAbProtocolResult<Connection> {
    let path = Path::new(&config.role_private_storage_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| store_error(error.to_string()))?;
    }
    let connection = Connection::open(path).map_err(sqlite_error)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(sqlite_error)?;
    connection.execute_batch(SCHEMA).map_err(sqlite_error)?;
    Ok(connection)
}

fn replay_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ReplayedLocalRequest, message)
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
