//! Real Worker preparation and client-timed signing on a wallet-derived key.

use super::prepared::{self, Adapter};
#[cfg(feature = "ml-dsa-b")]
use super::prepared_storage::Layout;
use super::prepared_storage::Tables;
use super::{
    decode_hex, encode_hex, failure, missing_fixture_field, required_string, runtime_failure,
    wasm_linear_memory_highwater_bytes, Duplex, ROLE,
};
use ed25519_yao::{
    ml_dsa_runtime::{
        prepared::{Phase, Transport},
        TrustedMlDsaSchedule,
    },
    ml_dsa_signing::{
        prepared_signing::{
            gmw::{prepare_gmw_reservation, GmwSignature, PreparedGmwReservation},
            prepare_signer, PreparedSignature, PreparedSigner, Reservation,
        },
        OwnSigningShare, SigningError,
    },
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use worker::{Env, WebSocket};

#[derive(Clone, Copy)]
pub(super) enum Backend {
    HalfGates,
    Gmw,
}
impl Backend {
    fn capacity(self) -> u16 {
        match self {
            Self::HalfGates => 12,
            Self::Gmw => 4,
        }
    }
    #[cfg(feature = "ml-dsa-a")]
    fn kernel(self) -> &'static str {
        match self {
            Self::HalfGates => "prepared-signing",
            Self::Gmw => "prepared-gmw-signing",
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::HalfGates => "half-gates",
            Self::Gmw => "gmw",
        }
    }
}
enum PreparedOperation<'a> {
    HalfGates(PreparedSigner<'a>),
    Gmw {
        reservation: PreparedGmwReservation<'a>,
        own: OwnSigningShare,
        public_key: [u8; 1952],
        epoch: [u8; 32],
        preparation_ms: f64,
    },
}
enum Output {
    HalfGates(PreparedSignature),
    Gmw(GmwSignature),
}
impl PreparedOperation<'_> {
    fn preparation_report(&self) -> Value {
        match self {
            Self::HalfGates(_) => json!({"kind": "key-specific"}),
            Self::Gmw { preparation_ms, .. } => json!({
                "kind": "generic-then-client-activation",
                "generic_preparation_ms": preparation_ms,
                "activation_in_client_online": true,
                "prepared_before_key_generation": true,
            }),
        }
    }

    async fn sign(
        self,
        message: &[u8],
        context: &[u8],
        operation: &[u8; 32],
        adapter: &mut Adapter<'_>,
    ) -> Result<Output, SigningError> {
        match self {
            Self::HalfGates(signer) => signer
                .sign(message, context, operation, adapter)
                .await
                .map(Output::HalfGates),
            Self::Gmw {
                reservation,
                own,
                public_key,
                epoch,
                ..
            } => {
                let signer = reservation
                    .activate(own, &public_key, epoch, adapter)
                    .await?;
                match signer.sign(message, context, operation, adapter).await? {
                    ed25519_yao::ml_dsa_signing::prepared_signing::gmw::GmwBatchResult::Signed(signature) => Ok(Output::Gmw(signature)),
                    ed25519_yao::ml_dsa_signing::prepared_signing::gmw::GmwBatchResult::Exhausted(_) => Err(SigningError::PreparedPoolExhausted),
                }
            }
        }
    }
}
impl Output {
    fn signature(&self) -> &[u8; 3309] {
        match self {
            Self::HalfGates(value) => &value.signature,
            Self::Gmw(value) => &value.signature,
        }
    }
    fn accepted_candidate(&self) -> u16 {
        match self {
            Self::HalfGates(value) => value.attempts,
            Self::Gmw(value) => value.accepted_candidate,
        }
    }
    fn public_rejections(&self) -> u16 {
        match self {
            Self::HalfGates(value) => value.public_rejections,
            Self::Gmw(value) => value.public_rejections,
        }
    }
}
pub(super) fn batch_metrics(
    metrics: &ed25519_yao::ml_dsa_runtime::boolean_comparison::prepared::BatchMetrics,
) -> Value {
    let phases: Vec<_> = metrics
        .phases
        .iter()
        .map(|phase| json!({"sent_bytes": phase.sent, "received_bytes": phase.received}))
        .collect();
    json!({"phases": phases, "instances": metrics.instances, "and_gates": metrics.and_gates, "and_exchanges": metrics.and_exchanges,
        "topology_allocation_bytes": metrics.topology_allocation_bytes, "private_state_allocation_bytes": metrics.private_state_allocation_bytes})
}

pub(super) fn schedules(book: &Value) -> worker::Result<Vec<TrustedMlDsaSchedule<'static>>> {
    let records = book["signing_schedules"]
        .as_array()
        .ok_or_else(missing_fixture_field)?;
    let mut schedules = Vec::new();
    for (name, bytes) in [
        (
            "fresh-mask",
            include_bytes!("../ml_dsa_schedules/fresh-mask.bin").as_slice(),
        ),
        (
            "prepared-commitment",
            include_bytes!("../ml_dsa_schedules/prepared-commitment.bin"),
        ),
        ("commitment-hash", super::COMMITMENT_HASH_SCHEDULE),
        ("response-check", super::RESPONSE_CHECK_SCHEDULE),
        (
            "low-response-check",
            include_bytes!("../ml_dsa_schedules/low-response-check.bin"),
        ),
        (
            "bounds-decision",
            include_bytes!("../ml_dsa_schedules/bounds-decision.bin"),
        ),
    ] {
        let record = records
            .iter()
            .find(|record| record["name"] == name)
            .ok_or_else(missing_fixture_field)?;
        let digest: [u8; 32] = decode_hex(required_string(record, "schedule_sha256")?)?
            .as_slice()
            .try_into()
            .map_err(runtime_failure)?;
        schedules.push(TrustedMlDsaSchedule::parse(bytes, digest).map_err(runtime_failure)?);
    }
    Ok(schedules)
}

async fn prepare<'a>(
    book: &Value,
    schedules: &'a [TrustedMlDsaSchedule<'static>],
    run_id: &str,
    adapter: &mut Adapter<'_>,
    backend: Backend,
) -> worker::Result<PreparedOperation<'a>> {
    let reservation = Reservation {
        id: Sha256::digest(run_id.as_bytes()).into(),
        epoch: [1; 32],
        candidates: backend.capacity(),
    };
    match backend {
        Backend::HalfGates => {
            let key = generate_key(book, adapter).await?;
            let own = OwnSigningShare::parse(&key.own_material).map_err(runtime_failure)?;
            prepare_signer(
                prepared::role(),
                own,
                &key.public_key,
                reservation,
                schedules,
                adapter,
            )
            .await
            .map(PreparedOperation::HalfGates)
            .map_err(|error| adapter.error(error))
        }
        Backend::Gmw => {
            let started = super::clock_ms();
            let generic = prepare_gmw_reservation(
                prepared::role(),
                reservation.id,
                reservation.candidates,
                schedules,
                &mut Default::default(),
                adapter,
            )
            .await
            .map_err(|error| adapter.error(error))?;
            let preparation_ms = super::clock_ms() - started;
            adapter.record_progress("ml-dsa-generic-preparation-ready", 0);
            let key = generate_key(book, adapter).await?;
            let own = OwnSigningShare::parse(&key.own_material).map_err(runtime_failure)?;
            Ok(PreparedOperation::Gmw {
                reservation: generic,
                own,
                public_key: key.public_key,
                epoch: reservation.epoch,
                preparation_ms,
            })
        }
    }
}

async fn generate_key(
    book: &Value,
    adapter: &mut Adapter<'_>,
) -> worker::Result<Box<ed25519_yao::ml_dsa_signing::keygen::KeygenOutput>> {
    let key_schedules = prepared::schedules(book)?;
    let fixture = prepared::fixture(book, 0)?;
    let root = prepared::own_root(fixture)?;
    let key =
        super::pipeline::generate_wallet_key(&root, &key_schedules, &mut adapter.duplex).await?;
    if encode_hex(&key.public_key) != required_string(fixture, "public_key_hex")? {
        return Err(failure(
            "Signing fixture differs from canonical wallet recovery.",
        ));
    }
    adapter.record_progress("ml-dsa-signing-key-ready", 0);
    Ok(key)
}

fn message(index: usize) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"seams/ml-dsa/prepared-worker-message/v1");
    hash.update((index as u32).to_le_bytes());
    hash.finalize().into()
}

fn report(
    book: &Value,
    index: usize,
    result: Result<Output, SigningError>,
    adapter: &Adapter<'_>,
    backend: Backend,
) -> worker::Result<Value> {
    let mut report = json!({"role": ROLE, "fixture_index": index, "pool_capacity": backend.capacity(), "engine": backend.name(),
        "public_key_hex": book["cases"][0]["public_key_hex"], "canonical_key_verified": true,
        "message_hex": encode_hex(&message(index)), "context_hex": "", "offline": adapter.counts_report(0),
        "online": adapter.counts_report(1), "table_storage": adapter.tables.as_ref().map(Tables::report),
        "wasm_linear_memory_highwater_bytes": wasm_linear_memory_highwater_bytes(), "transport": adapter.duplex.measurements()});
    match result {
        Ok(output) => {
            let key: [u8; 1952] = decode_hex(required_string(&report, "public_key_hex")?)?
                .as_slice()
                .try_into()
                .map_err(runtime_failure)?;
            super::pipeline::verify_standard_signature(&key, &message(index), output.signature())?;
            report["status"] = json!("signed");
            report["signature_hex"] = json!(encode_hex(output.signature()));
            report["standard_signature_verified"] = json!(true);
            report["attempts"] = json!(output.accepted_candidate());
            report["public_rejections"] = json!(output.public_rejections());
            match output {
                Output::HalfGates(output) => {
                    report["online_and_gates"] = json!(output
                        .circuits
                        .iter()
                        .map(|(_, metrics)| metrics.table_bytes / 32)
                        .sum::<usize>());
                }
                Output::Gmw(output) => {
                    report["evaluated_candidates"] = json!(output.evaluated_candidates);
                    report["gmw_preparation_batches"] = json!(output
                        .preparation_batches
                        .iter()
                        .map(batch_metrics)
                        .collect::<Vec<_>>());
                    report["gmw_batches"] =
                        json!(output.batches.iter().map(batch_metrics).collect::<Vec<_>>());
                    report["online_and_gates"] = json!(
                        output.preparation_batches[1].and_gates
                            + output
                                .batches
                                .iter()
                                .map(|metrics| metrics.and_gates)
                                .sum::<usize>()
                    );
                    report["online_and_exchanges"] = json!(
                        output.preparation_batches[1].and_exchanges
                            + output
                                .batches
                                .iter()
                                .map(|metrics| metrics.and_exchanges)
                                .sum::<usize>()
                    );
                }
            }
        }
        Err(SigningError::PreparedPoolExhausted) => {
            report["status"] = json!("exhausted");
            report["attempts"] = json!(backend.capacity());
        }
        Err(error) => return Err(adapter.error(error)),
    }
    Ok(report)
}

#[cfg(feature = "ml-dsa-a")]
pub(super) async fn run_a(
    env: &Env,
    client: &WebSocket,
    run_id: &str,
    colo: Option<String>,
    backend: Backend,
) -> worker::Result<()> {
    let mut events = client.events()?;
    let book: Value = serde_json::from_str(prepared::BOOK).map_err(runtime_failure)?;
    let schedules = schedules(&book)?;
    let socket = super::connect_b(env, backend.kernel(), run_id).await?;
    let mut adapter = Adapter::new(Duplex::new(&socket)?, None);
    adapter.attach_progress(client.clone(), run_id);
    let prepared = prepare(&book, &schedules, run_id, &mut adapter, backend).await?;
    if adapter
        .receive(1)
        .await
        .map_err(|error| adapter.error(error))?
        != [2]
    {
        return Err(failure("Signing preparation is incomplete."));
    }
    adapter.duplex.flush().await?;
    client.send_with_str(json!({"type": "ready", "run_id": run_id, "pool_capacity": backend.capacity(), "engine": backend.name(), "incoming_colo": colo}).to_string())?;
    let index = prepared::receive_start(&mut events).await?;
    adapter.phase(Phase::Online);
    adapter
        .send(&(index as u32).to_be_bytes())
        .await
        .map_err(|error| adapter.error(error))?;
    let operation: [u8; 32] = Sha256::digest(format!("{run_id}/{index}").as_bytes()).into();
    let preparation = prepared.preparation_report();
    let result = prepared
        .sign(&message(index), b"", &operation, &mut adapter)
        .await;
    let mut a = report(&book, index, result, &adapter, backend)?;
    a["preparation"] = preparation;
    let b = adapter.duplex.peer_completion().await?;
    for field in [
        "status",
        "signature_hex",
        "attempts",
        "message_hex",
        "public_key_hex",
    ] {
        if a[field] != b[field] {
            return Err(failure("Prepared signers disagree."));
        }
    }
    client.send_with_str(json!({"type": "complete", "run_id": run_id, "roles": {"a": a, "b": b}, "production_eligible": false}).to_string())?;
    adapter
        .send(&[3])
        .await
        .map_err(|error| adapter.error(error))?;
    if adapter
        .receive(1)
        .await
        .map_err(|error| adapter.error(error))?
        != [4]
    {
        return Err(failure("Signing cleanup was not acknowledged."));
    }
    client.send_with_str(json!({"type": "cleaned", "run_id": run_id}).to_string())?;
    socket.close(Some(1000), Some("prepared signing complete"))?;
    client.close(Some(1000), Some("prepared signing complete"))?;
    Ok(())
}

#[cfg(feature = "ml-dsa-b")]
pub(super) async fn run_b(
    env: Env,
    socket: WebSocket,
    run_id: String,
    colo: Option<String>,
    backend: Backend,
) -> worker::Result<()> {
    let book: Value = serde_json::from_str(prepared::BOOK).map_err(runtime_failure)?;
    let schedules = schedules(&book)?;
    let tables = match backend {
        Backend::HalfGates => Some(Tables::new(
            env.bucket("PREPARED_TABLES")?,
            &run_id,
            Layout::Signing,
        )),
        Backend::Gmw => None,
    };
    let mut adapter = Adapter::new(Duplex::new(&socket)?, tables);
    let result = run_b_session(&book, &schedules, &run_id, &mut adapter, colo, backend).await;
    if result.is_err() {
        if let Some(tables) = &adapter.tables {
            tables.cleanup().await?;
        }
    }
    result
}

#[cfg(feature = "ml-dsa-b")]
async fn run_b_session(
    book: &Value,
    schedules: &[TrustedMlDsaSchedule<'static>],
    run_id: &str,
    adapter: &mut Adapter<'_>,
    colo: Option<String>,
    backend: Backend,
) -> worker::Result<()> {
    let started = super::clock_ms();
    let prepared = prepare(book, schedules, run_id, adapter, backend).await?;
    if let Some(tables) = &mut adapter.tables {
        tables.flush().await?;
        tables.preload_first().await?;
    }
    adapter
        .send(&[2])
        .await
        .map_err(|error| adapter.error(error))?;
    adapter.phase(Phase::Online);
    let go = adapter
        .receive(4)
        .await
        .map_err(|error| adapter.error(error))?;
    let index = u32::from_be_bytes(go.as_slice().try_into().map_err(runtime_failure)?) as usize;
    if index >= 9 {
        return Err(failure("Signing fixture index is invalid."));
    }
    adapter.phase(Phase::Online);
    let operation: [u8; 32] = Sha256::digest(format!("{run_id}/{index}").as_bytes()).into();
    let preparation = prepared.preparation_report();
    let result = prepared
        .sign(&message(index), b"", &operation, adapter)
        .await;
    if let Some(tables) = &adapter.tables {
        tables.finish_reads()?;
    }
    adapter.duplex.flush().await?;
    let mut report = report(book, index, result, adapter, backend)?;
    report["preparation"] = preparation;
    report["incoming_colo"] = json!(colo);
    report["whole_observed_ms"] = json!(super::clock_ms() - started);
    adapter.duplex.send_completion(&report)?;
    if adapter
        .receive(1)
        .await
        .map_err(|error| adapter.error(error))?
        != [3]
    {
        return Err(failure("Signing cleanup command is missing."));
    }
    if let Some(tables) = &adapter.tables {
        tables.cleanup().await?;
    }
    adapter
        .send(&[4])
        .await
        .map_err(|error| adapter.error(error))?;
    Ok(())
}
