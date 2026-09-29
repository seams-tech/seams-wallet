use router_ab_cloudflare::{
    handle_cloudflare_signing_worker_normal_signing_finalize_private_request_v2,
    handle_cloudflare_signing_worker_normal_signing_prepare_private_request_v2,
    CloudflareEd25519YaoNormalSigningHandlerV1, CloudflareServerOutputMaterialRecordV1,
    CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
    CloudflareSigningWorkerMaterializedNormalSigningPrepareRequestV2,
    CloudflareSigningWorkerNormalSigningRound1PreparedV1,
    CloudflareSigningWorkerNormalSigningTerminalV1, CloudflareSigningWorkerRound1LookupV1,
    CloudflareSigningWorkerRound1RecordV1,
};
use router_ab_core::{
    ActiveSigningWorkerStateV1, NormalSigningRound1PrepareResponseV1, RouterAbProtocolError,
    RouterAbProtocolErrorCode, RouterAbProtocolResult,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS local_signing_worker_near_round1 (
    binding_key TEXT PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE,
    prepare_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('prepared', 'claimed', 'completed')),
    effect_operation_key TEXT UNIQUE,
    authorization_key TEXT UNIQUE,
    effect_request_digest_hex TEXT,
    terminal_json TEXT)";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PreparedNearV1 {
    request: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
    response: NormalSigningRound1PrepareResponseV1,
    record: CloudflareSigningWorkerRound1RecordV1,
}

struct NearRowV1 {
    binding_key: String,
    prepare_json: String,
    response_json: String,
    record_json: String,
    state: String,
    effect_request_digest_hex: Option<String>,
    terminal_json: Option<String>,
}

pub(crate) fn ensure_schema(connection: &Connection) -> RouterAbProtocolResult<()> {
    connection.execute_batch(SCHEMA).map_err(store_error)
}

pub(crate) fn prepare(
    connection: &Connection,
    request: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
    active: ActiveSigningWorkerStateV1,
    material: CloudflareServerOutputMaterialRecordV1,
    now_ms: u64,
) -> RouterAbProtocolResult<String> {
    request.validate()?;
    let binding = request
        .admission_candidate
        .round1_binding_digest
        .ok_or_else(|| invalid_state("SigningWorker prepare request lacks round-1 binding"))?;
    let binding_key = hex::encode(binding.as_bytes());
    if let Some(row) = read_row(connection, "binding_key", &binding_key)? {
        return replay_prepare(&request, active, material, now_ms, row);
    }
    let prepared = handle_cloudflare_signing_worker_normal_signing_prepare_private_request_v2(
        &CloudflareEd25519YaoNormalSigningHandlerV1,
        now_ms,
        request.clone(),
        active.clone(),
        material.clone(),
    )?;
    let record = PreparedNearV1 {
        request,
        response: prepared.response,
        record: prepared.record,
    };
    let inserted = connection
        .execute(
            "INSERT INTO local_signing_worker_near_round1
         (binding_key, handle, prepare_json, response_json, record_json, state)
         VALUES (?1, ?2, ?3, ?4, ?5, 'prepared') ON CONFLICT DO NOTHING",
            params![
                binding_key,
                record.record.server_round1_handle,
                encode(&record.request)?,
                encode(&record.response)?,
                encode(&record.record)?,
            ],
        )
        .map_err(store_error)?;
    if inserted == 1 {
        return encode(&record.response);
    }
    let row = read_row(connection, "binding_key", &binding_key)?
        .ok_or_else(|| invalid_state("SigningWorker round-1 write is uncertain"))?;
    replay_prepare(&record.request, active, material, now_ms, row)
}

pub(crate) fn finalize(
    connection: &Connection,
    request: CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    active: ActiveSigningWorkerStateV1,
    material: CloudflareServerOutputMaterialRecordV1,
    now_ms: u64,
) -> RouterAbProtocolResult<String> {
    request.validate()?;
    let operation_key = request.effect_operation_key()?;
    let effect_digest = hex::encode(request.effect_request_digest()?.as_bytes());
    if let Some(response) = read_terminal(connection, &request)? {
        return Ok(response);
    }
    request.request.validate_at(now_ms)?;
    let authorization_key = authorization_key(&request)?;
    if read_row(connection, "authorization_key", &authorization_key)?.is_some() {
        return Err(replayed(
            "SigningWorker authorization already claimed another effect",
        ));
    }
    let handle = request.request.server_round1_handle();
    let row = read_row(connection, "handle", handle)?.ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingLocalBinding,
            "SigningWorker round-1 material is missing",
        )
    })?;
    if row.state != "prepared" {
        return Err(replayed(
            "SigningWorker round-1 material is already consumed",
        ));
    }
    let binding_key = row.binding_key.clone();
    let prepared = decode_prepared(row)?;
    let lookup = CloudflareSigningWorkerRound1LookupV1::new(
        active.clone(),
        handle,
        request.request.round1_binding_digest(),
        now_ms,
    )?;
    prepared.record.validate_for_lookup(&lookup)?;
    if prepared.request.scope != request.request.scope {
        return Err(replayed(
            "SigningWorker finalize scope differs from prepared round-1",
        ));
    }
    let claimed = connection
        .execute(
            "UPDATE local_signing_worker_near_round1
         SET state = 'claimed', effect_operation_key = ?1, authorization_key = ?2,
             effect_request_digest_hex = ?3
         WHERE handle = ?4 AND binding_key = ?5 AND state = 'prepared'",
            params![
                operation_key,
                authorization_key,
                effect_digest,
                handle,
                binding_key
            ],
        )
        .map_err(store_error)?;
    if claimed != 1 {
        return Err(replayed(
            "SigningWorker round-1 claim lost to another execution",
        ));
    }
    let terminal = CloudflareSigningWorkerNormalSigningTerminalV1::from_result(
        handle_cloudflare_signing_worker_normal_signing_finalize_private_request_v2(
            &CloudflareEd25519YaoNormalSigningHandlerV1,
            now_ms,
            request.clone(),
            active,
            material,
            prepared.record,
        ),
    );
    terminal.validate_for_request(&request)?;
    let committed = connection
        .execute(
            "UPDATE local_signing_worker_near_round1 SET state = 'completed', terminal_json = ?1
         WHERE handle = ?2 AND state = 'claimed' AND effect_operation_key = ?3
           AND effect_request_digest_hex = ?4",
            params![encode(&terminal)?, handle, operation_key, effect_digest],
        )
        .map_err(store_error)?;
    if committed == 1 {
        return terminal_result(terminal);
    }
    let row = read_row(connection, "effect_operation_key", &operation_key)?
        .ok_or_else(|| invalid_state("SigningWorker terminal write is uncertain"))?;
    replay_terminal(&request, &effect_digest, row)
}

pub(crate) fn read_terminal(
    connection: &Connection,
    request: &CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
) -> RouterAbProtocolResult<Option<String>> {
    let operation_key = request.effect_operation_key()?;
    let effect_digest = hex::encode(request.effect_request_digest()?.as_bytes());
    read_row(connection, "effect_operation_key", &operation_key)?
        .map(|row| replay_terminal(request, &effect_digest, row))
        .transpose()
}

fn read_row(
    connection: &Connection,
    column: &str,
    key: &str,
) -> RouterAbProtocolResult<Option<NearRowV1>> {
    let statement = match column {
        "binding_key" => {
            "SELECT binding_key, prepare_json, response_json, record_json, state,
            effect_request_digest_hex, terminal_json FROM local_signing_worker_near_round1
            WHERE binding_key = ?1"
        }
        "handle" => {
            "SELECT binding_key, prepare_json, response_json, record_json, state,
            effect_request_digest_hex, terminal_json FROM local_signing_worker_near_round1
            WHERE handle = ?1"
        }
        "effect_operation_key" => {
            "SELECT binding_key, prepare_json, response_json, record_json, state,
            effect_request_digest_hex, terminal_json FROM local_signing_worker_near_round1
            WHERE effect_operation_key = ?1"
        }
        "authorization_key" => {
            "SELECT binding_key, prepare_json, response_json, record_json, state,
            effect_request_digest_hex, terminal_json FROM local_signing_worker_near_round1
            WHERE authorization_key = ?1"
        }
        _ => unreachable!("fixed SigningWorker lookup column"),
    };
    connection
        .query_row(statement, [key], |row| {
            Ok(NearRowV1 {
                binding_key: row.get(0)?,
                prepare_json: row.get(1)?,
                response_json: row.get(2)?,
                record_json: row.get(3)?,
                state: row.get(4)?,
                effect_request_digest_hex: row.get(5)?,
                terminal_json: row.get(6)?,
            })
        })
        .optional()
        .map_err(store_error)
}

fn replay_prepare(
    request: &CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
    active: ActiveSigningWorkerStateV1,
    material: CloudflareServerOutputMaterialRecordV1,
    now_ms: u64,
    row: NearRowV1,
) -> RouterAbProtocolResult<String> {
    if row.state != "prepared" {
        return Err(replayed(
            "SigningWorker round-1 material is already consumed",
        ));
    }
    let stored: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2 =
        decode(&row.prepare_json)?;
    let record: CloudflareSigningWorkerRound1RecordV1 = decode(&row.record_json)?;
    if stored != *request || now_ms >= record.expires_at_ms {
        return Err(replayed(
            "SigningWorker round-1 retry is changed or expired",
        ));
    }
    let response: NormalSigningRound1PrepareResponseV1 = decode(&row.response_json)?;
    let materialized = CloudflareSigningWorkerMaterializedNormalSigningPrepareRequestV2::new(
        stored,
        active,
        material,
        record.created_at_ms,
    )?;
    CloudflareSigningWorkerNormalSigningRound1PreparedV1 { response, record }
        .validate_for_v2_request(&materialized)?;
    Ok(row.response_json)
}

fn replay_terminal(
    request: &CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    effect_digest: &str,
    row: NearRowV1,
) -> RouterAbProtocolResult<String> {
    if row.effect_request_digest_hex.as_deref() != Some(effect_digest) {
        return Err(replayed(
            "SigningWorker operation key has different request material",
        ));
    }
    if row.state != "completed" {
        return Err(replayed(
            "SigningWorker normal-signing effect is still pending",
        ));
    }
    let terminal: CloudflareSigningWorkerNormalSigningTerminalV1 =
        decode(row.terminal_json.as_deref().ok_or_else(|| {
            invalid_state("SigningWorker completed effect has no terminal outcome")
        })?)?;
    terminal.validate_for_request(request)?;
    terminal_result(terminal)
}

fn terminal_result(
    terminal: CloudflareSigningWorkerNormalSigningTerminalV1,
) -> RouterAbProtocolResult<String> {
    encode(&terminal.into_result()?)
}

fn decode_prepared(row: NearRowV1) -> RouterAbProtocolResult<PreparedNearV1> {
    Ok(PreparedNearV1 {
        request: decode(&row.prepare_json)?,
        response: decode(&row.response_json)?,
        record: decode(&row.record_json)?,
    })
}

fn authorization_key(
    request: &CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
) -> RouterAbProtocolResult<String> {
    let mut hash = Sha256::new();
    hash.update(b"seams/signing-worker/vm-authorization/v1");
    hash.update(serde_json::to_vec(&request.effect_claim).map_err(encoding_error)?);
    Ok(hex::encode(hash.finalize()))
}

fn encode<T: Serialize>(value: &T) -> RouterAbProtocolResult<String> {
    serde_json::to_string(value).map_err(encoding_error)
}

fn decode<T: for<'de> Deserialize<'de>>(value: &str) -> RouterAbProtocolResult<T> {
    serde_json::from_str(value).map_err(encoding_error)
}

fn encoding_error(error: serde_json::Error) -> RouterAbProtocolError {
    invalid_state(format!("SigningWorker SQLite record is invalid: {error}"))
}

fn store_error(error: rusqlite::Error) -> RouterAbProtocolError {
    invalid_state(format!("SigningWorker SQLite operation failed: {error}"))
}

fn invalid_state(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}

fn replayed(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ReplayedLocalRequest, message)
}
