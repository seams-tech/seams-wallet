use super::{pair_error, Preparation, ReservationRow, WalletOwner};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worker::{Env, Method, Request, Response, SqlStorage, SqlStorageValue};

const SEGMENT_BYTES: u32 = 4096;
const STATE_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_relocation_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL)";
const SEGMENT_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_relocation_snapshot_segments (
    segment_index INTEGER PRIMARY KEY, segment_json TEXT NOT NULL)";

#[derive(Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Command<Owner> {
    Capture {
        source: Preparation<Owner>,
    },
    Export {
        source: Preparation<Owner>,
        segment_index: u32,
    },
}

impl<Owner> Command<Owner> {
    pub(crate) fn source(&self) -> &Preparation<Owner> {
        match self {
            Self::Capture { source } | Self::Export { source, .. } => source,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum State<Owner> {
    Capturing {
        source: Preparation<Owner>,
        progress: Progress,
    },
    Frozen {
        receipt: Receipt<Owner>,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt<Owner> {
    source: Preparation<Owner>,
    source_object: String,
    record_count: u32,
    segment_count: u32,
    digest_hex: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Progress {
    family: Family,
    after_key: String,
    part_index: u32,
    record_count: u32,
    segment_count: u32,
    digest_hex: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Family {
    Pair,
    AdmissionFence,
    Complete,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Segment {
    segment_index: u32,
    record_index: u32,
    part_index: u32,
    part_count: u32,
    data_b64u: String,
}

#[derive(Deserialize)]
struct StateRow {
    state_json: String,
}
#[derive(Deserialize)]
struct SegmentRow {
    segment_json: String,
}
#[derive(Deserialize)]
struct RecordPart {
    session_hex: String,
    byte_count: u32,
    data_hex: String,
}

pub(crate) async fn forward<Owner: WalletOwner>(
    mut request: Request,
    env: &Env,
    binding: &str,
    path: &str,
) -> worker::Result<Response> {
    if request.method() != Method::Post {
        return Response::error("Deriver snapshot requires POST", 405);
    }
    let command: Command<Owner> =
        match crate::durable_object::tenant_root_creation::decode_bounded_json_request(
            &mut request,
            8192,
        )
        .await
        {
            Ok(command) => command,
            Err(error) => return crate::router_coordinator::protocol_error_response(error),
        };
    command.source().validate()?;
    if !command.source().context_matches(env)? {
        return Response::error("Deriver encryption context differs from source", 409);
    }
    let namespace = env.durable_object(binding)?;
    let stub = namespace.get_by_name(&command.source().owner.object_name()?)?;
    let body = encode(&command)?;
    let forwarded = Request::new_with_init(
        &format!("https://router-ab-do.internal{path}"),
        &worker::RequestInit::new()
            .with_method(Method::Post)
            .with_body(Some(body.into())),
    )?;
    stub.fetch_with_request(forwarded).await
}

pub(crate) fn execute<Owner: WalletOwner>(
    sql: &SqlStorage,
    command: Command<Owner>,
) -> worker::Result<Response> {
    let source_json = encode(command.source())?;
    let rows = sql
        .exec(
            "SELECT request_json FROM wallet_relocation_source WHERE id = 1",
            None,
        )?
        .to_array::<ReservationRow>()?;
    if !matches!(rows.as_slice(), [row] if row.request_json == source_json) {
        return Response::error("Deriver snapshot requires its exact source fence", 409);
    }
    sql.exec(STATE_SCHEMA, None)?;
    sql.exec(SEGMENT_SCHEMA, None)?;
    let rows = sql
        .exec(
            "SELECT state_json FROM wallet_relocation_snapshot WHERE id = 1",
            None,
        )?
        .to_array::<StateRow>()?;
    let state: Option<State<Owner>> = rows
        .first()
        .map(|row| serde_json::from_str(&row.state_json))
        .transpose()
        .map_err(encoding_error)?;
    if let Some(state) = &state {
        let stored = match state {
            State::Capturing { source, .. } => source,
            State::Frozen { receipt } => &receipt.source,
        };
        if encode(stored)? != source_json {
            return Response::error("Deriver snapshot move differs", 409);
        }
    }
    match command {
        Command::Capture { source } => capture(sql, source, state),
        Command::Export { segment_index, .. } => export(sql, state, segment_index),
    }
}

fn capture<Owner: WalletOwner>(
    sql: &SqlStorage,
    source: Preparation<Owner>,
    state: Option<State<Owner>>,
) -> worker::Result<Response> {
    let mut progress = match state {
        Some(State::Frozen { receipt }) => {
            return Response::from_json(&serde_json::json!({"kind": "frozen", "receipt": receipt}))
        }
        Some(State::Capturing { progress, .. }) => progress,
        None => Progress {
            family: Family::Pair,
            after_key: String::new(),
            part_index: 0,
            record_count: 0,
            segment_count: 0,
            digest_hex: digest::<Owner>(encode(&source)?.as_bytes()),
        },
    };
    // One bounded segment per command. The source tables remain fenced throughout capture.
    let query = match progress.family {
        Family::Pair => Some(("yao_pair_sessions", Owner::PAIR_SNAPSHOT_JSON)),
        Family::AdmissionFence => Some(("yao_pair_admission_fences", "json_object('kind', 'admission_fence', 'session_hex', session_hex, 'fenced_at_ms', CAST(fenced_at_ms AS TEXT))")),
        Family::Complete => None,
    };
    if let Some((table, record)) = query {
        let offset = u64::from(progress.part_index) * u64::from(SEGMENT_BYTES);
        let rows = sql.exec(&format!("SELECT session_hex, length(CAST({record} AS BLOB)) AS byte_count, hex(substr(CAST({record} AS BLOB), ?, ?)) AS data_hex FROM {table} WHERE session_hex > ? ORDER BY session_hex LIMIT 1"),
            vec![SqlStorageValue::Integer((offset + 1) as i64), SqlStorageValue::Integer(i64::from(SEGMENT_BYTES)), SqlStorageValue::String(progress.after_key.clone())])?
            .to_array::<RecordPart>()?;
        match rows.as_slice() {
            [row] => {
                let bytes = decode_part(&row.data_hex)?;
                if bytes.is_empty()
                    || bytes.len() > SEGMENT_BYTES as usize
                    || offset >= u64::from(row.byte_count)
                {
                    return Err(pair_error("Deriver snapshot record part is invalid"));
                }
                let part_count = row.byte_count.div_ceil(SEGMENT_BYTES);
                let segment = Segment {
                    segment_index: progress.segment_count,
                    record_index: progress.record_count,
                    part_index: progress.part_index,
                    part_count,
                    data_b64u: crate::encode_base64url_bytes_v1(&bytes),
                };
                let encoded = encode(&segment)?;
                // A retry after a partial command must preserve the previously stored segment.
                sql.exec("INSERT INTO wallet_relocation_snapshot_segments (segment_index, segment_json) VALUES (?, ?) ON CONFLICT DO NOTHING",
                    vec![SqlStorageValue::Integer(i64::from(segment.segment_index)), SqlStorageValue::String(encoded.clone())])?;
                let stored = read_segment(sql, segment.segment_index)?;
                if stored != encoded {
                    return Err(pair_error("Deriver snapshot segment conflicts"));
                }
                progress.digest_hex =
                    digest::<Owner>(encode(&(&progress.digest_hex, &segment))?.as_bytes());
                progress.segment_count = increment(progress.segment_count)?;
                progress.part_index = increment(progress.part_index)?;
                if progress.part_index == part_count {
                    progress.after_key = row.session_hex.clone();
                    progress.part_index = 0;
                    progress.record_count = increment(progress.record_count)?;
                }
            }
            [] => {
                if progress.part_index != 0 {
                    return Err(pair_error("Deriver snapshot source record disappeared"));
                }
                progress.family = match progress.family {
                    Family::Pair => Family::AdmissionFence,
                    Family::AdmissionFence | Family::Complete => Family::Complete,
                };
                progress.after_key.clear();
            }
            _ => return Err(pair_error("Deriver snapshot record is duplicated")),
        }
    }
    let state = if matches!(progress.family, Family::Complete) {
        State::Frozen {
            receipt: Receipt {
                source_object: source.owner.object_name()?,
                source,
                record_count: progress.record_count,
                segment_count: progress.segment_count,
                digest_hex: progress.digest_hex,
            },
        }
    } else {
        State::Capturing { source, progress }
    };
    sql.exec("INSERT INTO wallet_relocation_snapshot (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json",
        vec![SqlStorageValue::String(encode(&state)?)])?;
    match state {
        State::Frozen { receipt } => {
            Response::from_json(&serde_json::json!({"kind": "frozen", "receipt": receipt}))
        }
        State::Capturing { progress, .. } => Response::from_json(
            &serde_json::json!({"kind": "capturing", "segment_count": progress.segment_count}),
        ),
    }
}

fn export<Owner: WalletOwner>(
    sql: &SqlStorage,
    state: Option<State<Owner>>,
    index: u32,
) -> worker::Result<Response> {
    let Some(State::Frozen { receipt }) = state else {
        return Response::error("Deriver snapshot is not sealed", 409);
    };
    if index >= receipt.segment_count {
        return Response::error("Deriver snapshot segment is absent", 409);
    }
    let segment: Segment =
        serde_json::from_str(&read_segment(sql, index)?).map_err(encoding_error)?;
    Response::from_json(
        &serde_json::json!({"kind": "segment", "receipt": receipt, "segment": segment}),
    )
}

fn read_segment(sql: &SqlStorage, index: u32) -> worker::Result<String> {
    let rows = sql
        .exec(
            "SELECT segment_json FROM wallet_relocation_snapshot_segments WHERE segment_index = ?",
            vec![SqlStorageValue::Integer(i64::from(index))],
        )?
        .to_array::<SegmentRow>()?;
    match rows.into_iter().next() {
        Some(row) => Ok(row.segment_json),
        None => Err(pair_error("Deriver snapshot segment is missing")),
    }
}

fn increment(value: u32) -> worker::Result<u32> {
    value
        .checked_add(1)
        .ok_or_else(|| pair_error("Deriver snapshot is too large"))
}

fn decode_part(value: &str) -> worker::Result<Vec<u8>> {
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair)
                .map_err(|_| pair_error("Deriver snapshot hex is invalid"))?;
            u8::from_str_radix(text, 16).map_err(|_| pair_error("Deriver snapshot hex is invalid"))
        })
        .collect()
}

fn digest<Owner: WalletOwner>(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(b"seams/deriver/wallet-snapshot/v1");
    hash.update(Owner::LABEL.as_bytes());
    hash.update(bytes);
    crate::ed25519_yao_lifecycle::role_d1::encode_hex_slice(&hash.finalize())
}

fn encode(value: &impl Serialize) -> worker::Result<String> {
    serde_json::to_string(value).map_err(encoding_error)
}

fn encoding_error(error: serde_json::Error) -> worker::Error {
    pair_error(error.to_string())
}
