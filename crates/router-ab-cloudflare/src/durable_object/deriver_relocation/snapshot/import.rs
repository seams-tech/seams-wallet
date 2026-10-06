use super::*;
use serde::de::DeserializeOwned;

const STATE_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_relocation_import (
    id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL)";
const SEGMENT_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_relocation_import_segments (
    segment_index INTEGER PRIMARY KEY,
    segment_json TEXT NOT NULL, acknowledgement_json TEXT NOT NULL)";

pub(crate) trait Pair<Owner>: Serialize + DeserializeOwned {
    fn key(&self) -> &str;
    fn restore(&self, sql: &SqlStorage, env: &Env, owner: &Owner) -> worker::Result<()>;
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum ImportState<Owner> {
    Receiving {
        receipt: Receipt<Owner>,
        progress: ImportProgress,
    },
    Received {
        receipt: Receipt<Owner>,
    },
    Verified {
        receipt: Receipt<Owner>,
    },
}

impl<Owner> ImportState<Owner> {
    fn receipt(&self) -> &Receipt<Owner> {
        match self {
            Self::Receiving { receipt, .. }
            | Self::Received { receipt }
            | Self::Verified { receipt } => receipt,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ImportProgress {
    next_segment: u32,
    position: Position,
    last_key: RecordKey,
    digest_hex: String,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Position {
    RecordStart {
        record_index: u32,
    },
    RecordPart {
        record_index: u32,
        part_index: u32,
        part_count: u32,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum RecordKey {
    Start,
    Pair { key: String },
    AdmissionFence { key: String },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Record<P> {
    Pair(P),
    AdmissionFence {
        session_hex: String,
        fenced_at_ms: String,
    },
}

#[derive(Deserialize)]
struct ImportedSegment {
    segment_json: String,
    acknowledgement_json: String,
}
#[derive(Deserialize)]
struct Count {
    count: u32,
}

pub(super) fn receive<Owner: WalletOwner>(
    sql: &SqlStorage,
    env: &Env,
    receipt: Receipt<Owner>,
    segment: Segment,
) -> worker::Result<Response> {
    let state = load(sql, &receipt)?;
    let bytes = segment_bytes(&receipt, &segment)?;
    let encoded = encode(&segment)?;
    let existing = sql.exec("SELECT segment_json, acknowledgement_json FROM wallet_relocation_import_segments WHERE segment_index = ?",
        vec![SqlStorageValue::Integer(i64::from(segment.segment_index))])?.to_array::<ImportedSegment>()?;
    if let [stored] = existing.as_slice() {
        if stored.segment_json != encoded {
            return Err(pair_error("Deriver imported segment conflicts"));
        }
        return Response::from_json(
            &serde_json::from_str::<serde_json::Value>(&stored.acknowledgement_json)
                .map_err(encoding_error)?,
        );
    }
    let mut progress = match state {
        None => initial_progress(&receipt)?,
        Some(ImportState::Receiving { progress, .. }) => progress,
        Some(_) => return Err(pair_error("Deriver import no longer accepts new segments")),
    };
    let expected = match progress.position {
        Position::RecordStart { record_index } => (record_index, 0, segment.part_count),
        Position::RecordPart {
            record_index,
            part_index,
            part_count,
        } => (record_index, part_index, part_count),
    };
    if progress.next_segment != segment.segment_index
        || expected != (segment.record_index, segment.part_index, segment.part_count)
    {
        return Err(pair_error("Deriver import segment is out of order"));
    }
    progress.next_segment = increment(progress.next_segment)?;
    progress.position = if segment.part_index + 1 == segment.part_count {
        Position::RecordStart {
            record_index: increment(segment.record_index)?,
        }
    } else {
        Position::RecordPart {
            record_index: segment.record_index,
            part_index: segment.part_index + 1,
            part_count: segment.part_count,
        }
    };
    progress.digest_hex = digest::<Owner>(encode(&(&progress.digest_hex, &segment))?.as_bytes());
    let complete = progress.next_segment == receipt.segment_count;
    if complete
        && (!matches!(progress.position, Position::RecordStart { record_index } if record_index == receipt.record_count)
            || progress.digest_hex != receipt.digest_hex)
    {
        return Err(pair_error(
            "Deriver snapshot digest or record count differs",
        ));
    }
    if segment.part_index + 1 == segment.part_count {
        let mut record_bytes = Vec::new();
        let first_segment = segment
            .segment_index
            .checked_sub(segment.part_index)
            .ok_or_else(|| pair_error("Deriver staged record starts before its snapshot"))?;
        let rows = sql.exec("SELECT segment_json FROM wallet_relocation_import_segments WHERE segment_index >= ? AND segment_index < ? ORDER BY segment_index",
            vec![SqlStorageValue::Integer(i64::from(first_segment)), SqlStorageValue::Integer(i64::from(segment.segment_index))])?.to_array::<SegmentRow>()?;
        if rows.len() != segment.part_index as usize {
            return Err(pair_error("Deriver staged record is incomplete"));
        }
        for row in rows {
            let prior: Segment = serde_json::from_str(&row.segment_json).map_err(encoding_error)?;
            record_bytes.extend_from_slice(&segment_bytes(&receipt, &prior)?);
        }
        record_bytes.extend_from_slice(&bytes);
        if record_bytes.len() > MAX_RECORD_BYTES {
            return Err(pair_error("Deriver imported record exceeds its byte bound"));
        }
        let record: Record<Owner::Pair> =
            serde_json::from_slice(&record_bytes).map_err(encoding_error)?;
        progress.last_key = restore(sql, env, &receipt.source, &progress.last_key, record)?;
        require_exact_record::<Owner>(sql, &progress.last_key, &record_bytes)?;
    }
    let acknowledgement = serde_json::json!({"kind": "imported", "segment_index": segment.segment_index,
        "input_digest_hex": digest::<Owner>(encoded.as_bytes())});
    sql.exec("INSERT INTO wallet_relocation_import_segments (segment_index, segment_json, acknowledgement_json) VALUES (?, ?, ?)",
        vec![SqlStorageValue::Integer(i64::from(segment.segment_index)),
            SqlStorageValue::String(encoded), SqlStorageValue::String(encode(&acknowledgement)?)])?;
    let state = if complete {
        require_count(sql, receipt.record_count)?;
        ImportState::Received { receipt }
    } else {
        ImportState::Receiving { receipt, progress }
    };
    save(sql, &state)?;
    Response::from_json(&acknowledgement)
}

fn restore<Owner: WalletOwner>(
    sql: &SqlStorage,
    env: &Env,
    source: &Preparation<Owner>,
    last: &RecordKey,
    record: Record<Owner::Pair>,
) -> worker::Result<RecordKey> {
    let next = match &record {
        Record::Pair(row) => RecordKey::Pair {
            key: row.key().to_owned(),
        },
        Record::AdmissionFence { session_hex, .. } => RecordKey::AdmissionFence {
            key: session_hex.clone(),
        },
    };
    let ordered = match (last, &next) {
        (RecordKey::Start, _) | (RecordKey::Pair { .. }, RecordKey::AdmissionFence { .. }) => true,
        (RecordKey::Pair { key: before }, RecordKey::Pair { key: after })
        | (RecordKey::AdmissionFence { key: before }, RecordKey::AdmissionFence { key: after }) => {
            before < after
        }
        _ => false,
    };
    if !ordered {
        return Err(pair_error("Deriver snapshot record order differs"));
    }
    // The reservation opens only inside this synchronous transaction. Errors roll back
    // the restored record, reservation, cursor and acknowledgement together.
    sql.exec(
        "DELETE FROM wallet_relocation_preparation WHERE id = 1",
        None,
    )?;
    match record {
        Record::Pair(row) => row.restore(sql, env, &source.owner)?,
        Record::AdmissionFence {
            session_hex,
            fenced_at_ms,
        } => {
            require_digest(&session_hex)?;
            let timestamp = decimal::<i64>(&fenced_at_ms)?;
            if timestamp < 0 {
                return Err(pair_error("Deriver admission fence timestamp is invalid"));
            }
            sql.exec(
                "INSERT INTO yao_pair_admission_fences (session_hex, fenced_at_ms) VALUES (?, CAST(? AS INTEGER))",
                vec![
                    SqlStorageValue::String(session_hex),
                    SqlStorageValue::String(fenced_at_ms),
                ],
            )?;
        }
    }
    sql.exec(
        "INSERT INTO wallet_relocation_preparation (id, request_json) VALUES (1, ?)",
        vec![SqlStorageValue::String(encode(source)?)],
    )?;
    Ok(next)
}

pub(super) fn status<Owner: WalletOwner>(
    sql: &SqlStorage,
    receipt: Receipt<Owner>,
) -> worker::Result<Response> {
    let state = load(sql, &receipt)?;
    let (kind, next_segment) = match state {
        None => ("prepared", 0),
        Some(ImportState::Receiving { progress, .. }) => ("receiving", progress.next_segment),
        Some(ImportState::Received { .. }) => ("received", receipt.segment_count),
        Some(ImportState::Verified { .. }) => ("verified", receipt.segment_count),
    };
    Response::from_json(
        &serde_json::json!({"kind": kind, "receipt": receipt, "next_segment": next_segment}),
    )
}

pub(super) fn verify<Owner: WalletOwner>(
    sql: &SqlStorage,
    receipt: Receipt<Owner>,
) -> worker::Result<Response> {
    match load(sql, &receipt)? {
        Some(ImportState::Received { .. }) | Some(ImportState::Verified { .. }) => {}
        None if receipt.segment_count == 0
            && receipt.digest_hex == initial_progress(&receipt)?.digest_hex => {}
        _ => {
            return Err(pair_error(
                "Deriver destination has not received its complete snapshot",
            ))
        }
    }
    require_count(sql, receipt.record_count)?;
    save(
        sql,
        &ImportState::Verified {
            receipt: receipt.clone(),
        },
    )?;
    Response::from_json(&serde_json::json!({"kind": "verified", "receipt": receipt}))
}

fn load<Owner: WalletOwner>(
    sql: &SqlStorage,
    receipt: &Receipt<Owner>,
) -> worker::Result<Option<ImportState<Owner>>> {
    receipt.source.validate()?;
    require_digest(&receipt.digest_hex)?;
    if receipt.source_object != receipt.source.owner.object_name()?
        || receipt.record_count > receipt.segment_count
        || (receipt.record_count == 0) != (receipt.segment_count == 0)
    {
        return Err(pair_error("Deriver snapshot receipt is invalid"));
    }
    let prepared = sql
        .exec(
            "SELECT request_json FROM wallet_relocation_preparation WHERE id = 1",
            None,
        )?
        .to_array::<ReservationRow>()?;
    let source_json = encode(&receipt.source)?;
    if !matches!(prepared.as_slice(), [row] if row.request_json == source_json) {
        return Err(pair_error(
            "Deriver import requires its exact destination reservation",
        ));
    }
    sql.exec(STATE_SCHEMA, None)?;
    sql.exec(SEGMENT_SCHEMA, None)?;
    let rows = sql
        .exec(
            "SELECT state_json FROM wallet_relocation_import WHERE id = 1",
            None,
        )?
        .to_array::<StateRow>()?;
    let state: Option<ImportState<Owner>> = rows
        .first()
        .map(|row| serde_json::from_str(&row.state_json))
        .transpose()
        .map_err(encoding_error)?;
    if let Some(state) = &state {
        if encode(state.receipt())? != encode(receipt)? {
            return Err(pair_error("Deriver imported snapshot receipt differs"));
        }
    }
    Ok(state)
}

fn save<Owner: WalletOwner>(sql: &SqlStorage, state: &ImportState<Owner>) -> worker::Result<()> {
    sql.exec("INSERT INTO wallet_relocation_import (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json",
        vec![SqlStorageValue::String(encode(state)?)])?;
    Ok(())
}

fn initial_progress<Owner: WalletOwner>(
    receipt: &Receipt<Owner>,
) -> worker::Result<ImportProgress> {
    Ok(ImportProgress {
        next_segment: 0,
        position: Position::RecordStart { record_index: 0 },
        last_key: RecordKey::Start,
        digest_hex: digest::<Owner>(encode(&receipt.source)?.as_bytes()),
    })
}

fn segment_bytes<Owner: WalletOwner>(
    receipt: &Receipt<Owner>,
    segment: &Segment,
) -> worker::Result<Vec<u8>> {
    if segment.data_b64u.len() > (SEGMENT_BYTES as usize * 4).div_ceil(3)
        || segment.segment_index >= receipt.segment_count
        || segment.record_index >= receipt.record_count
        || segment.part_count == 0
        || segment.part_count as usize > MAX_RECORD_BYTES.div_ceil(SEGMENT_BYTES as usize)
        || segment.part_index >= segment.part_count
    {
        return Err(pair_error("Deriver import segment bounds are invalid"));
    }
    let bytes = crate::decode_base64url_bytes_v1("Deriver snapshot segment", &segment.data_b64u)
        .map_err(|error| pair_error(error.to_string()))?;
    if bytes.is_empty()
        || bytes.len() > SEGMENT_BYTES as usize
        || (segment.part_index + 1 != segment.part_count && bytes.len() != SEGMENT_BYTES as usize)
        || crate::encode_base64url_bytes_v1(&bytes) != segment.data_b64u
    {
        return Err(pair_error("Deriver import segment encoding is invalid"));
    }
    Ok(bytes)
}

fn require_count(sql: &SqlStorage, expected: u32) -> worker::Result<()> {
    let row = sql.exec("SELECT (SELECT COUNT(*) FROM yao_pair_sessions) + (SELECT COUNT(*) FROM yao_pair_admission_fences) AS count", None)?.one::<Count>()?;
    if row.count != expected {
        return Err(pair_error("Deriver restored inventory differs"));
    }
    Ok(())
}

pub(crate) fn require_digest(value: &str) -> worker::Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(pair_error("Deriver snapshot digest is invalid"));
    }
    Ok(())
}

pub(crate) fn decimal<T: std::str::FromStr + ToString>(value: &str) -> worker::Result<T> {
    let parsed = value
        .parse::<T>()
        .map_err(|_| pair_error("Deriver snapshot integer is invalid"))?;
    if parsed.to_string() != value {
        return Err(pair_error("Deriver snapshot integer is not canonical"));
    }
    Ok(parsed)
}

fn require_exact_record<Owner: WalletOwner>(
    sql: &SqlStorage,
    key: &RecordKey,
    bytes: &[u8],
) -> worker::Result<()> {
    let (table, expression, key) = match key {
        RecordKey::Pair { key } => ("yao_pair_sessions", Owner::PAIR_SNAPSHOT_JSON, key),
        RecordKey::AdmissionFence { key } => {
            ("yao_pair_admission_fences", FENCE_SNAPSHOT_JSON, key)
        }
        RecordKey::Start => return Err(pair_error("Deriver restored record key is absent")),
    };
    #[derive(Deserialize)]
    struct RestoredRecord {
        record_json: String,
    }
    let row = sql
        .exec(
            &format!("SELECT {expression} AS record_json FROM {table} WHERE session_hex = ?"),
            vec![SqlStorageValue::String(key.clone())],
        )?
        .one::<RestoredRecord>()?;
    if row.record_json.as_bytes() != bytes {
        return Err(pair_error(
            "Deriver restored record differs from snapshot bytes",
        ));
    }
    Ok(())
}
