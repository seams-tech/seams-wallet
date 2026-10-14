//! Disposable client-timed registration and reusable signing pool.

#[cfg(feature = "ml-dsa-b")]
use super::prepared_storage::Layout;
use super::{
    encode_hex, failure, missing_fixture_field,
    prepared::{self, Adapter},
    prepared_storage::Tables,
    required_string, runtime_failure, wasm_linear_memory_highwater_bytes, Duplex, ROLE,
};
use ed25519_yao::{
    ml_dsa_runtime::{
        prepared::{
            keygen::{prepare_keygen, PreparedKeygen},
            Phase, Transport,
        },
        TrustedMlDsaSchedule,
    },
    ml_dsa_signing::{
        prepared_signing::gmw::{
            pool::{PoolInventory, PoolOutcome, PreparedGmwPool, ReadyGmwPool},
            GmwExhaustion,
        },
        OwnSigningShare, SigningError,
    },
};
#[cfg(feature = "ml-dsa-a")]
use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use worker::{Env, WebSocket};

const CANDIDATES: u16 = 4;

fn inventory(value: PoolInventory) -> Value {
    json!({"batches": value.batches, "private_bytes": value.private_bytes, "public_topology_bytes": value.public_topology_bytes})
}
fn counters(adapter: &Adapter<'_>) -> Value {
    json!({"role": ROLE, "offline": adapter.counts_report(0), "online": adapter.counts_report(1),
        "wasm_linear_memory_highwater_bytes": wasm_linear_memory_highwater_bytes(), "transport": adapter.duplex.measurements()})
}
fn identifier(run_id: &str, purpose: &str, ordinal: u32) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(run_id.as_bytes());
    digest.update(purpose.as_bytes());
    digest.update(ordinal.to_le_bytes());
    digest.finalize().into()
}
fn message(index: u32) -> [u8; 32] {
    identifier("seams/ml-dsa/pool-message/v1", "sign", index)
}
fn batch_count(value: u32) -> worker::Result<u16> {
    match value {
        1 => Ok(1),
        10 => Ok(10),
        _ => Err(failure("Pool benchmark batch count must be one or ten.")),
    }
}

async fn prepare<'a>(
    key_schedules: &'a [TrustedMlDsaSchedule<'static>],
    signing_schedules: &'a [TrustedMlDsaSchedule<'static>],
    run_id: &str,
    batches: u16,
    adapter: &mut Adapter<'_>,
) -> worker::Result<(PreparedKeygen<'a>, PreparedGmwPool<'a>)> {
    let keygen = prepare_keygen(prepared::role(), key_schedules, adapter)
        .await
        .map_err(|error| adapter.error(error))?;
    if let Some(tables) = &mut adapter.tables {
        tables.flush().await?;
    }
    adapter.record_progress("ml-dsa-keygen-preparation-ready", 0);
    let pool = PreparedGmwPool::prepare(
        prepared::role(),
        identifier(run_id, "initial", 0),
        CANDIDATES,
        batches,
        signing_schedules,
        adapter,
    )
    .await
    .map_err(|error| adapter.error(error))?;
    adapter.record_progress("ml-dsa-generic-preparation-ready", 0);
    Ok((keygen, pool))
}

async fn register<'a>(
    keygen: PreparedKeygen<'a>,
    generic: PreparedGmwPool<'a>,
    fixture: &Value,
    adapter: &mut Adapter<'_>,
) -> worker::Result<(ReadyGmwPool<'a>, [u8; 1952], Value)> {
    adapter.phase(Phase::Online);
    let root = prepared::own_root(fixture)?;
    let (key, _) = keygen
        .run(&root, adapter)
        .await
        .map_err(|error| adapter.error(error))?;
    if encode_hex(&key.public_key) != required_string(fixture, "public_key_hex")? {
        return Err(failure(
            "Pool registration differs from canonical wallet recovery.",
        ));
    }
    #[cfg(feature = "ml-dsa-b")]
    adapter
        .tables
        .as_ref()
        .ok_or_else(missing_fixture_field)?
        .finish_reads()?;
    let own = OwnSigningShare::parse(&key.own_material).map_err(runtime_failure)?;
    let pool = generic
        .activate(own, &key.public_key, [1; 32], adapter)
        .await
        .map_err(|error| adapter.error(error))?;
    let mut report = counters(adapter);
    report["canonical_key_verified"] = json!(true);
    report["public_key_hex"] = json!(encode_hex(&key.public_key));
    report["key_manifest_digest_hex"] = fixture["key_manifest_digest_hex"].clone();
    report["inventory"] = inventory(pool.inventory().map_err(runtime_failure)?);
    report["table_storage"] = json!(adapter.tables.as_ref().map(Tables::report));
    Ok((pool, key.public_key, report))
}

#[derive(Clone, Copy)]
enum Command {
    Sign(u32),
    Refill { group: u32, batches: u16 },
    Close,
}
impl Command {
    #[cfg(feature = "ml-dsa-a")]
    fn encode(self) -> [u8; 9] {
        let (tag, index, count) = match self {
            Self::Sign(index) => (1, index, 0),
            Self::Refill { group, batches } => (2, group, u32::from(batches)),
            Self::Close => (3, 0, 0),
        };
        let mut bytes = [0; 9];
        bytes[0] = tag;
        bytes[1..5].copy_from_slice(&index.to_le_bytes());
        bytes[5..9].copy_from_slice(&count.to_le_bytes());
        bytes
    }
    #[cfg(feature = "ml-dsa-b")]
    fn decode(bytes: &[u8]) -> worker::Result<Self> {
        if bytes.len() != 9 {
            return Err(failure("Pool command has the wrong size."));
        }
        let index = u32::from_le_bytes(bytes[1..5].try_into().map_err(runtime_failure)?);
        let count = u32::from_le_bytes(bytes[5..9].try_into().map_err(runtime_failure)?);
        match (bytes[0], index, count) {
            (1, 0..=64, 0) => Ok(Self::Sign(index)),
            (2, 1..=64, count) => Ok(Self::Refill {
                group: index,
                batches: batch_count(count)?,
            }),
            (3, 0, 0) => Ok(Self::Close),
            _ => Err(failure("Invalid pool command.")),
        }
    }
}

fn exhaustion(value: &GmwExhaustion) -> Value {
    json!({"evaluated_candidates": value.evaluated_candidates, "public_rejections": value.public_rejections,
        "batches": value.batches.iter().map(super::prepared_signing::batch_metrics).collect::<Vec<_>>(),
        "preparation_batches": value.preparation_batches.iter().map(super::prepared_signing::batch_metrics).collect::<Vec<_>>()})
}

async fn execute<'a>(
    command: Command,
    pool: &mut ReadyGmwPool<'a>,
    public_key: &[u8; 1952],
    run_id: &str,
    schedules: &'a [TrustedMlDsaSchedule<'static>],
    adapter: &mut Adapter<'_>,
) -> worker::Result<Value> {
    let mut report;
    match command {
        Command::Sign(index) => {
            adapter.phase(Phase::Online);
            let result = pool
                .sign(
                    &message(index),
                    b"",
                    identifier(run_id, "operation", index),
                    adapter,
                )
                .await;
            report = counters(adapter);
            report["operation"] = json!(index);
            report["message_hex"] = json!(encode_hex(&message(index)));
            report["public_key_hex"] = json!(encode_hex(public_key));
            match result {
                Ok(result) => {
                    report["exhausted"] =
                        json!(result.exhausted.iter().map(exhaustion).collect::<Vec<_>>());
                    match result.outcome {
                        PoolOutcome::Signed(signature) => {
                            super::pipeline::verify_standard_signature(
                                public_key,
                                &message(index),
                                &signature.signature,
                            )?;
                            report["status"] = json!("signed");
                            report["signature_hex"] = json!(encode_hex(&signature.signature));
                            report["accepted_candidate"] = json!(signature.accepted_candidate);
                            report["standard_signature_verified"] = json!(true);
                            report["signing_batches"] = json!(signature
                                .batches
                                .iter()
                                .map(super::prepared_signing::batch_metrics)
                                .collect::<Vec<_>>());
                            report["preparation_batches"] = json!(signature
                                .preparation_batches
                                .iter()
                                .map(super::prepared_signing::batch_metrics)
                                .collect::<Vec<_>>());
                        }
                        PoolOutcome::Empty => report["status"] = json!("empty"),
                    }
                }
                Err(SigningError::PreparedPoolReplay) => {
                    report["status"] = json!("replay-rejected")
                }
                Err(error) => return Err(adapter.error(error)),
            }
        }
        Command::Refill { group, batches } => {
            adapter.phase(Phase::Offline);
            let result = pool
                .replenish(
                    identifier(run_id, "refill", group),
                    batches,
                    schedules,
                    adapter,
                )
                .await;
            report = counters(adapter);
            report["group"] = json!(group);
            report["requested_batches"] = json!(batches);
            match result {
                Ok(()) => report["status"] = json!("refilled"),
                Err(SigningError::PreparedPoolReplay) => {
                    report["status"] = json!("replay-rejected")
                }
                Err(error) => return Err(adapter.error(error)),
            }
        }
        Command::Close => return Err(failure("Close is not a pool operation.")),
    }
    report["inventory"] = inventory(pool.inventory().map_err(runtime_failure)?);
    Ok(report)
}

#[cfg(feature = "ml-dsa-a")]
async fn client_message(events: &mut worker::EventStream<'_>) -> worker::Result<Value> {
    let event = events.next().await.ok_or_else(super::peer_closed)??;
    let worker::WebsocketEvent::Message(message) = event else {
        return Err(super::peer_closed());
    };
    let text = message
        .text()
        .ok_or_else(|| failure("Pool commands require JSON text."))?;
    serde_json::from_str(&text).map_err(runtime_failure)
}
#[cfg(feature = "ml-dsa-a")]
async fn client_command(events: &mut worker::EventStream<'_>) -> worker::Result<Command> {
    let value = client_message(events).await?;
    let object = value.as_object().ok_or_else(missing_fixture_field)?;
    match value["type"].as_str() {
        Some("sign") if object.len() == 2 => {
            let index = value["operation"]
                .as_u64()
                .filter(|index| *index <= 64)
                .ok_or_else(missing_fixture_field)?;
            Ok(Command::Sign(index as u32))
        }
        Some("refill") if object.len() == 3 => {
            let group = value["group"]
                .as_u64()
                .filter(|index| (1..=64).contains(index))
                .ok_or_else(missing_fixture_field)?;
            let batches = value["batches"]
                .as_u64()
                .and_then(|count| u32::try_from(count).ok())
                .ok_or_else(missing_fixture_field)?;
            Ok(Command::Refill {
                group: group as u32,
                batches: batch_count(batches)?,
            })
        }
        Some("close") if object.len() == 1 => Ok(Command::Close),
        _ => Err(failure("Invalid pool client command.")),
    }
}

#[cfg(feature = "ml-dsa-a")]
pub(super) async fn run_a(
    env: &Env,
    client: &WebSocket,
    run_id: &str,
    colo: Option<String>,
) -> worker::Result<()> {
    let mut events = client.events()?;
    let config = client_message(&mut events).await?;
    if config.as_object().map(|object| object.len()) != Some(2) || config["type"] != "configure" {
        return Err(failure("Pool configuration is required."));
    }
    let count = config["batches"]
        .as_u64()
        .and_then(|count| u32::try_from(count).ok())
        .ok_or_else(missing_fixture_field)?;
    let batches = batch_count(count)?;
    let socket = super::connect_b(env, "prepared-gmw-pool", run_id).await?;
    let mut adapter = Adapter::new(Duplex::new(&socket)?, None);
    adapter.attach_progress(client.clone(), run_id);
    let result = run_a_session(client, &mut events, run_id, colo, batches, &mut adapter).await;
    let _ = socket.close(
        Some(if result.is_ok() { 1000 } else { 1011 }),
        Some("pool session ended"),
    );
    result
}
#[cfg(feature = "ml-dsa-a")]
async fn run_a_session(
    client: &WebSocket,
    events: &mut worker::EventStream<'_>,
    run_id: &str,
    colo: Option<String>,
    batches: u16,
    adapter: &mut Adapter<'_>,
) -> worker::Result<()> {
    adapter.duplex.send(&batches.to_le_bytes()).await?;
    let book: Value = serde_json::from_str(prepared::BOOK).map_err(runtime_failure)?;
    let key_schedules = prepared::schedules(&book)?;
    let signing_schedules = super::prepared_signing::schedules(&book)?;
    let (keygen, generic) =
        prepare(&key_schedules, &signing_schedules, run_id, batches, adapter).await?;
    let b = adapter.duplex.peer_completion().await?;
    let mut a = counters(adapter);
    a["inventory"] = inventory(generic.inventory());
    client.send_with_str(
        json!({"type":"pool-ready", "run_id":run_id, "roles":{"a":a,"b":b}, "incoming_colo":colo})
            .to_string(),
    )?;
    let index = prepared::receive_start(events).await?;
    adapter.duplex.send(&(index as u32).to_le_bytes()).await?;
    let (mut pool, public_key, a) =
        register(keygen, generic, prepared::fixture(&book, index)?, adapter).await?;
    let b = adapter.duplex.peer_completion().await?;
    if a["public_key_hex"] != b["public_key_hex"] {
        return Err(failure("Pool registration keys disagree."));
    }
    client.send_with_str(
        json!({"type":"registered", "run_id":run_id, "roles":{"a":a,"b":b}}).to_string(),
    )?;
    for _ in 0..64 {
        let command = client_command(events).await?;
        adapter.duplex.send(&command.encode()).await?;
        if matches!(command, Command::Close) {
            if adapter.duplex.receive(1).await? != [4] {
                return Err(failure("Pool cleanup was not acknowledged."));
            }
            client.send_with_str(json!({"type":"cleaned", "run_id":run_id}).to_string())?;
            client.close(Some(1000), Some("pool complete"))?;
            return Ok(());
        }
        let a = execute(
            command,
            &mut pool,
            &public_key,
            run_id,
            &signing_schedules,
            adapter,
        )
        .await?;
        let b = adapter.duplex.peer_completion().await?;
        for field in ["status", "signature_hex", "operation", "group", "inventory"] {
            if a[field] != b[field] {
                return Err(failure("Pool participants disagree."));
            }
        }
        client.send_with_str(
            json!({"type":"pool-result", "run_id":run_id, "roles":{"a":a,"b":b}}).to_string(),
        )?;
    }
    Err(failure("Pool session command limit reached."))
}

#[cfg(feature = "ml-dsa-b")]
pub(super) async fn run_b(
    env: Env,
    socket: WebSocket,
    run_id: String,
    colo: Option<String>,
) -> worker::Result<()> {
    let tables = Tables::new(env.bucket("PREPARED_TABLES")?, &run_id, Layout::Keygen);
    let mut adapter = Adapter::new(Duplex::new(&socket)?, Some(tables));
    let result = run_b_session(&run_id, colo, &mut adapter).await;
    if result.is_err() {
        if let Some(tables) = &adapter.tables {
            tables.cleanup().await?;
        }
    }
    result
}
#[cfg(feature = "ml-dsa-b")]
async fn run_b_session(
    run_id: &str,
    colo: Option<String>,
    adapter: &mut Adapter<'_>,
) -> worker::Result<()> {
    let bytes = adapter.duplex.receive(2).await?;
    let batches = batch_count(u32::from(u16::from_le_bytes(
        bytes.as_slice().try_into().map_err(runtime_failure)?,
    )))?;
    let book: Value = serde_json::from_str(prepared::BOOK).map_err(runtime_failure)?;
    let key_schedules = prepared::schedules(&book)?;
    let signing_schedules = super::prepared_signing::schedules(&book)?;
    let (keygen, generic) =
        prepare(&key_schedules, &signing_schedules, run_id, batches, adapter).await?;
    adapter.duplex.flush().await?;
    let mut report = counters(adapter);
    report["inventory"] = inventory(generic.inventory());
    report["incoming_colo"] = json!(colo);
    adapter.duplex.send_completion(&report)?;
    let index = u32::from_le_bytes(
        adapter
            .duplex
            .receive(4)
            .await?
            .as_slice()
            .try_into()
            .map_err(runtime_failure)?,
    ) as usize;
    let (mut pool, public_key, report) =
        register(keygen, generic, prepared::fixture(&book, index)?, adapter).await?;
    adapter.duplex.flush().await?;
    adapter.duplex.send_completion(&report)?;
    for _ in 0..64 {
        let command = Command::decode(&adapter.duplex.receive(9).await?)?;
        if matches!(command, Command::Close) {
            adapter
                .tables
                .as_ref()
                .ok_or_else(missing_fixture_field)?
                .cleanup()
                .await?;
            adapter.duplex.send(&[4]).await?;
            adapter.duplex.flush().await?;
            return Ok(());
        }
        let report = execute(
            command,
            &mut pool,
            &public_key,
            run_id,
            &signing_schedules,
            adapter,
        )
        .await?;
        adapter.duplex.flush().await?;
        adapter.duplex.send_completion(&report)?;
    }
    Err(failure("Pool session command limit reached."))
}
