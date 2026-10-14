//! Hosted prepared keygen with R2 streaming and a client-controlled online start.

use ed25519_yao::{
    ml_dsa_runtime::{
        prepared::{keygen::prepare_keygen, Phase, Transport},
        RuntimeError, TrustedMlDsaSchedule,
    },
    ml_dsa_signing::{keygen::KeygenOutput, SigningRole},
};
#[cfg(feature = "ml-dsa-a")]
use futures_util::StreamExt;
use serde_json::{json, Value};
use worker::{Env, WebSocket};
#[cfg(feature = "ml-dsa-a")]
use worker::{EventStream, WebsocketEvent};
use zeroize::Zeroizing;

use super::prepared_storage::Tables;
use super::{
    clock_ms, decode_hex, encode_hex, failure, missing_fixture_field, required_string,
    runtime_failure, wasm_linear_memory_highwater_bytes, Duplex, ROLE,
};

#[cfg(feature = "ml-dsa-a")]
const BOOK: &str = include_str!("../ml_dsa_schedules/prepared-a.json");
#[cfg(feature = "ml-dsa-b")]
const BOOK: &str = include_str!("../ml_dsa_schedules/prepared-b.json");

fn role() -> SigningRole {
    #[cfg(feature = "ml-dsa-a")]
    {
        SigningRole::A
    }
    #[cfg(feature = "ml-dsa-b")]
    {
        SigningRole::B
    }
}
fn schedules(book: &Value) -> worker::Result<Vec<TrustedMlDsaSchedule<'static>>> {
    let records = book["schedules"]
        .as_array()
        .ok_or_else(missing_fixture_field)?;
    let mut output = Vec::new();
    for (filename, bytes) in [
        (
            "wallet-seed.bin",
            include_bytes!("../ml_dsa_schedules/wallet-seed.bin").as_slice(),
        ),
        ("seed.bin", super::SEED_SCHEDULE),
        (
            "sampling-two-blocks.bin",
            super::SAMPLING_TWO_BLOCKS_SCHEDULE,
        ),
        (
            "sampling-three-blocks.bin",
            super::SAMPLING_THREE_BLOCKS_SCHEDULE,
        ),
        (
            "sampling-final-bound.bin",
            super::SAMPLING_FINAL_BOUND_SCHEDULE,
        ),
    ] {
        let record = records
            .iter()
            .find(|record| record["schedule_filename"] == filename)
            .ok_or_else(missing_fixture_field)?;
        let digest: [u8; 32] = decode_hex(required_string(record, "schedule_sha256")?)?
            .try_into()
            .map_err(|_| missing_fixture_field())?;
        output.push(TrustedMlDsaSchedule::parse(bytes, digest).map_err(runtime_failure)?);
    }
    Ok(output)
}
fn fixture(book: &Value, index: usize) -> worker::Result<&Value> {
    book["cases"]
        .as_array()
        .and_then(|cases| cases.get(index))
        .ok_or_else(missing_fixture_field)
}
fn own_root(record: &Value) -> worker::Result<Zeroizing<[u8; 32]>> {
    let bytes = Zeroizing::new(decode_hex(required_string(record, "own_root_share_hex")?)?);
    Ok(Zeroizing::new(
        bytes.as_slice().try_into().map_err(runtime_failure)?,
    ))
}
#[derive(Default)]
struct Counts {
    sent: usize,
    received: usize,
    sends: usize,
    receives: usize,
}
impl Counts {
    fn report(&self) -> Value {
        json!({"sent_bytes": self.sent, "received_bytes": self.received, "sent_messages": self.sends, "received_messages": self.receives})
    }
}
struct Adapter<'a> {
    duplex: Duplex<'a>,
    tables: Option<Tables>,
    phase: usize,
    counts: [Counts; 2],
    last_error: Option<String>,
}
impl Adapter<'_> {
    fn failure(&mut self, error: worker::Error) -> RuntimeError {
        self.last_error = Some(error.to_string());
        RuntimeError::MessageLength
    }
    fn error(&self, error: impl std::fmt::Display) -> worker::Error {
        match &self.last_error {
            Some(message) => failure(message),
            None => runtime_failure(error),
        }
    }
    fn report(
        &self,
        fixture: &Value,
        key: &KeygenOutput,
        offline_ms: f64,
        online_ms: f64,
    ) -> worker::Result<Value> {
        if encode_hex(&key.public_key) != required_string(fixture, "public_key_hex")? {
            return Err(failure(
                "Prepared keygen differs from the canonical wallet fixture.",
            ));
        }
        Ok(
            json!({"role": ROLE, "fixture_index": fixture["index"], "wallet_id": fixture["wallet_id"],
            "signing_key_id": fixture["signing_key_id"], "public_key_hex": encode_hex(&key.public_key),
            "key_manifest_digest_hex": fixture["key_manifest_digest_hex"], "canonical_key_verified": true,
            "executed_circuits": key.circuits.iter().map(|(kernel, ordinal, _)| json!({"name": kernel.name(), "ordinal": ordinal})).collect::<Vec<_>>(),
            "offline_observed_ms": offline_ms, "online_observed_ms": online_ms,
            "offline": self.counts[0].report(), "online": self.counts[1].report(),
            "table_storage": self.tables.as_ref().map(Tables::report),
            "wasm_linear_memory_highwater_bytes": wasm_linear_memory_highwater_bytes(),
            "transport": self.duplex.measurements()}),
        )
    }
}
impl Transport for Adapter<'_> {
    async fn send(&mut self, bytes: &[u8]) -> Result<(), RuntimeError> {
        self.duplex
            .send(bytes)
            .await
            .map_err(|error| self.failure(error))?;
        self.counts[self.phase].sent += bytes.len();
        self.counts[self.phase].sends += 1;
        Ok(())
    }
    async fn receive(&mut self, length: usize) -> Result<Vec<u8>, RuntimeError> {
        let bytes = self
            .duplex
            .receive(length)
            .await
            .map_err(|error| self.failure(error))?;
        self.counts[self.phase].received += bytes.len();
        self.counts[self.phase].receives += 1;
        Ok(bytes)
    }
    async fn store(
        &mut self,
        binding: [u8; 32],
        ordinal: usize,
        bytes: &[u8],
    ) -> Result<(), RuntimeError> {
        let tables = self.tables.as_mut().ok_or(RuntimeError::TableFrame)?;
        tables
            .store(binding, ordinal, bytes)
            .await
            .map_err(|error| self.failure(error))
    }
    async fn load(
        &mut self,
        binding: [u8; 32],
        ordinal: usize,
        length: usize,
    ) -> Result<Vec<u8>, RuntimeError> {
        let tables = self.tables.as_mut().ok_or(RuntimeError::TableFrame)?;
        tables
            .load(binding, ordinal, length)
            .await
            .map_err(|error| self.failure(error))
    }
    fn phase(&mut self, phase: Phase) {
        self.phase = match phase {
            Phase::Offline => 0,
            Phase::Online => 1,
        };
    }
}

#[cfg(feature = "ml-dsa-a")]
pub(super) fn accept_a(
    env: Env,
    context: worker::Context,
    run_id: String,
    colo: Option<String>,
) -> worker::Result<worker::Response> {
    let pair = worker::WebSocketPair::new()?;
    let client = pair.server;
    client.accept()?;
    let on_error = client.clone();
    context.wait_until(async move {
        if let Err(error) = run_a(&env, &client, &run_id, colo).await {
            let _ = on_error
                .send_with_str(json!({"type": "error", "error": error.to_string()}).to_string());
            let _ = on_error.close(Some(1011), Some("prepared keygen failed"));
        }
    });
    worker::Response::from_websocket(pair.client)
}

#[cfg(feature = "ml-dsa-a")]
async fn run_a(
    env: &Env,
    client: &WebSocket,
    run_id: &str,
    colo: Option<String>,
) -> worker::Result<()> {
    let mut client_events = client.events()?;
    let book: Value = serde_json::from_str(BOOK).map_err(runtime_failure)?;
    let schedules = schedules(&book)?;
    let started = clock_ms();
    let socket = super::connect_b(env, "prepared-keygen", run_id).await?;
    let mut adapter = Adapter {
        duplex: Duplex::new(&socket)?,
        tables: None,
        phase: 0,
        counts: Default::default(),
        last_error: None,
    };
    let prepared = prepare_keygen(role(), &schedules, &mut adapter)
        .await
        .map_err(|error| adapter.error(error))?;
    if adapter
        .receive(1)
        .await
        .map_err(|error| adapter.error(error))?
        != [2]
    {
        return Err(failure("Peer preparation is incomplete."));
    }
    adapter.duplex.flush().await?;
    let offline_ms = clock_ms() - started;
    client.send_with_str(json!({"type": "ready", "run_id": run_id, "offline_observed_ms": offline_ms, "incoming_colo": colo}).to_string())?;
    let index = receive_start(&mut client_events).await?;
    let current = fixture(&book, index)?;
    adapter.phase(Phase::Online);
    let started = clock_ms();
    adapter
        .send(&(index as u32).to_be_bytes())
        .await
        .map_err(|error| adapter.error(error))?;
    let root = own_root(current)?;
    let (key, _) = prepared
        .run(&root, &mut adapter)
        .await
        .map_err(|error| adapter.error(error))?;
    let peer = adapter.duplex.peer_completion().await?;
    let online_ms = clock_ms() - started;
    let a = adapter.report(current, &key, offline_ms, online_ms)?;
    if peer["public_key_hex"] != a["public_key_hex"] {
        return Err(failure("Prepared roles returned different keys."));
    }
    client.send_with_str(json!({"type": "complete", "run_id": run_id, "incoming_colo": colo, "roles": {"a": a, "b": peer}, "production_eligible": false}).to_string())?;
    // Cleanup stays outside the client online interval and is acknowledged.
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
        return Err(failure("Table cleanup was not acknowledged."));
    }
    client.send_with_str(json!({"type": "cleaned", "run_id": run_id}).to_string())?;
    socket.close(Some(1000), Some("prepared complete"))?;
    client.close(Some(1000), Some("prepared complete"))?;
    Ok(())
}
#[cfg(feature = "ml-dsa-a")]
async fn receive_start(events: &mut EventStream<'_>) -> worker::Result<usize> {
    let event = events.next().await.ok_or_else(super::peer_closed)??;
    let WebsocketEvent::Message(message) = event else {
        return Err(super::peer_closed());
    };
    let text = message
        .text()
        .ok_or_else(|| failure("Start requires a text message."))?;
    let value: Value = serde_json::from_str(&text).map_err(runtime_failure)?;
    let object = value.as_object().ok_or_else(missing_fixture_field)?;
    if object.len() != 2 || value["type"] != "start" {
        return Err(failure("Invalid prepared start message."));
    }
    let index = value["fixture_index"]
        .as_u64()
        .ok_or_else(missing_fixture_field)?;
    if index >= 9 {
        return Err(failure("Fixture index is outside the disposable book."));
    }
    Ok(index as usize)
}

#[cfg(feature = "ml-dsa-b")]
pub(super) async fn run_b(
    env: Env,
    socket: WebSocket,
    run_id: String,
    colo: Option<String>,
) -> worker::Result<()> {
    let book: Value = serde_json::from_str(BOOK).map_err(runtime_failure)?;
    let schedules = schedules(&book)?;
    let mut adapter = Adapter {
        duplex: Duplex::new(&socket)?,
        tables: Some(Tables::new(env.bucket("PREPARED_TABLES")?, &run_id)),
        phase: 0,
        counts: Default::default(),
        last_error: None,
    };
    let result = run_b_session(&book, &schedules, &mut adapter, colo).await;
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
    schedules: &[TrustedMlDsaSchedule<'_>],
    adapter: &mut Adapter<'_>,
    colo: Option<String>,
) -> worker::Result<()> {
    let started = clock_ms();
    let prepared = prepare_keygen(role(), schedules, adapter)
        .await
        .map_err(|error| adapter.error(error))?;
    adapter
        .tables
        .as_mut()
        .ok_or_else(missing_fixture_field)?
        .flush()
        .await?;
    let offline_ms = clock_ms() - started;
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
    let started = clock_ms();
    let current = fixture(book, index)?;
    let root = own_root(current)?;
    let (key, _) = prepared
        .run(&root, adapter)
        .await
        .map_err(|error| adapter.error(error))?;
    adapter.duplex.flush().await?;
    let mut report = adapter.report(current, &key, offline_ms, clock_ms() - started)?;
    report["incoming_colo"] = json!(colo);
    adapter.duplex.send_completion(&report)?;
    if adapter
        .receive(1)
        .await
        .map_err(|error| adapter.error(error))?
        != [3]
    {
        return Err(failure("Cleanup command is missing."));
    }
    adapter
        .tables
        .as_ref()
        .ok_or_else(missing_fixture_field)?
        .cleanup()
        .await?;
    adapter
        .send(&[4])
        .await
        .map_err(|error| adapter.error(error))?;
    Ok(())
}
