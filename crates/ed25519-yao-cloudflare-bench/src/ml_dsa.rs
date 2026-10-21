//! Disposable public-fixture ML-DSA kernels on two isolated Worker roles.
//!
//! Each build embeds only its own fixture inputs and expected outputs. B checks
//! its output locally and sends only the check result and public measurements.
//! The runtime supplies genuine input OT. This adapter supplies a shared probe
//! credential and bounded WebSocket delivery. It supplies no wallet admission,
//! durable shares, authenticated production peers, or threshold signatures.

use std::collections::VecDeque;

#[cfg(feature = "ml-dsa-b")]
use ed25519_yao::ml_dsa_runtime::begin_evaluator;
#[cfg(feature = "ml-dsa-a")]
use ed25519_yao::ml_dsa_runtime::begin_garbler;
use ed25519_yao::ml_dsa_runtime::{RuntimeMetrics, Step, TrustedMlDsaSchedule};
use futures_util::StreamExt;
use serde_json::{json, Value};
use worker::{Env, EventStream, WebSocket, WebsocketEvent};
use zeroize::Zeroizing;

const CREDIT_WINDOW: u32 = 8;
const MAX_RUNTIME_MESSAGE_BYTES: usize = 188_464;
const MAX_COMPLETION_BYTES: usize = 16_384;
const DATA: u8 = 0;
const ACK: u8 = 1;
const COMPLETE: u8 = 2;
const SCHEMA: &str = "seams.ml-dsa-worker-kernel.v1";

#[cfg(feature = "ml-dsa-a")]
const ROLE: &str = "a";
#[cfg(feature = "ml-dsa-b")]
const ROLE: &str = "b";
#[cfg(feature = "ml-dsa-a")]
const FIXTURES: &str = include_str!("ml_dsa_schedules/fixtures-a.json");
#[cfg(feature = "ml-dsa-b")]
const FIXTURES: &str = include_str!("ml_dsa_schedules/fixtures-b.json");

#[derive(Clone, Copy)]
enum Kernel {
    Seed,
    Sampling,
    Rounding,
    ExpandMask,
}

impl Kernel {
    fn parse(name: &str) -> worker::Result<Self> {
        match name {
            "seed" => Ok(Self::Seed),
            "sampling-0" => Ok(Self::Sampling),
            "rounding" => Ok(Self::Rounding),
            "mask-0" => Ok(Self::ExpandMask),
            _ => Err(failure("Unknown ML-DSA kernel.")),
        }
    }

    const fn name(self) -> &'static str {
        match self {
            Self::Seed => "seed",
            Self::Sampling => "sampling-0",
            Self::Rounding => "rounding",
            Self::ExpandMask => "mask-0",
        }
    }

    const fn schedule(self) -> &'static [u8] {
        match self {
            Self::Seed => include_bytes!("ml_dsa_schedules/seed.bin"),
            Self::Sampling => include_bytes!("ml_dsa_schedules/sampling-0.bin"),
            Self::Rounding => include_bytes!("ml_dsa_schedules/rounding.bin"),
            Self::ExpandMask => include_bytes!("ml_dsa_schedules/mask-0.bin"),
        }
    }
}

struct Fixture {
    digest: [u8; 32],
    input: Zeroizing<Vec<bool>>,
    expected_output: Zeroizing<Vec<u8>>,
}

fn failure(message: &str) -> worker::Error {
    worker::Error::RustError(message.to_owned())
}

fn runtime_failure(error: impl std::fmt::Display) -> worker::Error {
    failure(&error.to_string())
}

fn required_string<'a>(record: &'a Value, name: &str) -> worker::Result<&'a str> {
    record
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(missing_fixture_field)
}

fn missing_fixture_field() -> worker::Error {
    failure("The generated fixture has a missing or invalid field.")
}

fn hex_digit(byte: u8) -> worker::Result<u8> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        _ => Err(failure("The generated fixture has invalid lowercase hex.")),
    }
}

fn decode_hex(encoded: &str) -> worker::Result<Vec<u8>> {
    if encoded.len() % 2 != 0 {
        return Err(failure("The generated fixture has an odd hex length."));
    }
    let mut bytes = Vec::with_capacity(encoded.len() / 2);
    for pair in encoded.as_bytes().chunks_exact(2) {
        bytes.push((hex_digit(pair[0])? << 4) | hex_digit(pair[1])?);
    }
    Ok(bytes)
}

fn encode_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(DIGITS[usize::from(byte >> 4)]));
        encoded.push(char::from(DIGITS[usize::from(byte & 15)]));
    }
    encoded
}

fn fixture(kernel: Kernel) -> worker::Result<Fixture> {
    let root: Value = serde_json::from_str(FIXTURES).map_err(runtime_failure)?;
    if required_string(&root, "schema")? != "seams.ml-dsa-worker-fixtures.v1" {
        return Err(failure("The generated fixture schema is incorrect."));
    }
    let kernels = root
        .get("kernels")
        .and_then(Value::as_object)
        .ok_or_else(missing_fixture_field)?;
    let record = kernels
        .get(kernel.name())
        .ok_or_else(missing_fixture_field)?;
    if root.get("public_fixtures_only") != Some(&Value::Bool(true)) {
        return Err(failure("The fixture is not marked as public test data."));
    }
    let digest = decode_hex(required_string(record, "schedule_sha256")?)?
        .try_into()
        .map_err(invalid_digest)?;
    let input_bits = record
        .get("input_bits")
        .and_then(Value::as_u64)
        .and_then(convert_usize)
        .ok_or_else(missing_fixture_field)?;
    let packed = Zeroizing::new(decode_hex(required_string(record, "input_hex")?)?);
    if packed.len() != input_bits.div_ceil(8) {
        return Err(failure("The fixture input byte length is incorrect."));
    }
    if input_bits % 8 != 0 && packed[packed.len() - 1] >> (input_bits % 8) != 0 {
        return Err(failure("The fixture input has nonzero padding bits."));
    }
    let mut input = Zeroizing::new(Vec::with_capacity(input_bits));
    for index in 0..input_bits {
        input.push((packed[index / 8] >> (index % 8)) & 1 != 0);
    }
    Ok(Fixture {
        digest,
        input,
        expected_output: Zeroizing::new(decode_hex(required_string(
            record,
            "expected_output_hex",
        )?)?),
    })
}

fn invalid_digest(_: Vec<u8>) -> worker::Error {
    failure("The schedule digest must contain 32 bytes.")
}

fn convert_usize(value: u64) -> Option<usize> {
    usize::try_from(value).ok()
}

fn clock_ms() -> f64 {
    worker::js_sys::Date::now()
}

#[derive(Default)]
struct DeliveryMetrics {
    sent_messages: u32,
    received_messages: u32,
    sent_runtime_bytes: usize,
    received_runtime_bytes: usize,
    sent_ack_bytes: usize,
    received_ack_bytes: usize,
    first_send_ms: Option<f64>,
    last_send_ms: Option<f64>,
    first_receive_ms: Option<f64>,
    last_receive_ms: Option<f64>,
    largest_runtime_message_bytes: usize,
    largest_pending_messages: usize,
}

struct Duplex<'a> {
    socket: &'a WebSocket,
    events: EventStream<'a>,
    started_ms: f64,
    acknowledged: u32,
    next_received: u32,
    pending: VecDeque<Vec<u8>>,
    completion: Option<Value>,
    metrics: DeliveryMetrics,
}

impl<'a> Duplex<'a> {
    fn new(socket: &'a WebSocket) -> worker::Result<Self> {
        let events = socket.events()?;
        socket.accept()?;
        Ok(Self {
            socket,
            events,
            started_ms: clock_ms(),
            acknowledged: 0,
            next_received: 0,
            pending: VecDeque::with_capacity(CREDIT_WINDOW as usize),
            completion: None,
            metrics: DeliveryMetrics::default(),
        })
    }

    async fn send(&mut self, bytes: &[u8]) -> worker::Result<()> {
        if bytes.len() > MAX_RUNTIME_MESSAGE_BYTES {
            return Err(failure("The runtime message exceeds the transport bound."));
        }
        while self.metrics.sent_messages - self.acknowledged >= CREDIT_WINDOW {
            self.poll().await?;
        }
        let mut envelope = Vec::with_capacity(bytes.len() + 5);
        envelope.push(DATA);
        envelope.extend_from_slice(&self.metrics.sent_messages.to_le_bytes());
        envelope.extend_from_slice(bytes);
        self.socket.send_with_bytes(envelope)?;
        let observed = clock_ms() - self.started_ms;
        if self.metrics.first_send_ms.is_none() {
            self.metrics.first_send_ms = Some(observed);
        }
        self.metrics.last_send_ms = Some(observed);
        self.metrics.sent_messages += 1;
        self.metrics.sent_runtime_bytes += bytes.len();
        self.metrics.largest_runtime_message_bytes =
            self.metrics.largest_runtime_message_bytes.max(bytes.len());
        Ok(())
    }

    async fn receive(&mut self, expected_bytes: usize) -> worker::Result<Vec<u8>> {
        loop {
            if let Some(bytes) = self.pending.pop_front() {
                if bytes.len() != expected_bytes {
                    return Err(failure("The peer message byte length is incorrect."));
                }
                return Ok(bytes);
            }
            if self.completion.is_some() {
                return Err(failure("The peer completed before the runtime message."));
            }
            self.poll().await?;
        }
    }

    async fn poll(&mut self) -> worker::Result<()> {
        let event = self.events.next().await.ok_or_else(peer_closed)??;
        let WebsocketEvent::Message(message) = event else {
            return Err(peer_closed());
        };
        let envelope = message.bytes().ok_or_else(binary_required)?;
        let Some(kind) = envelope.first() else {
            return Err(failure("The transport envelope is empty."));
        };
        match *kind {
            DATA => self.accept_data(&envelope),
            ACK => self.accept_ack(&envelope),
            COMPLETE => self.accept_completion(&envelope),
            _ => Err(failure("The transport envelope kind is invalid.")),
        }
    }

    fn accept_data(&mut self, envelope: &[u8]) -> worker::Result<()> {
        if envelope.len() < 5 || envelope.len() > MAX_RUNTIME_MESSAGE_BYTES + 5 {
            return Err(failure("The transport data length is invalid."));
        }
        let sequence = u32::from_le_bytes(envelope[1..5].try_into().map_err(runtime_failure)?);
        if sequence != self.next_received || self.pending.len() >= CREDIT_WINDOW as usize {
            return Err(failure(
                "The transport sequence or credit bound is invalid.",
            ));
        }
        self.next_received += 1;
        self.pending.push_back(envelope[5..].to_vec());
        let mut acknowledgement = [ACK; 5];
        acknowledgement[1..].copy_from_slice(&self.next_received.to_le_bytes());
        self.socket.send_with_bytes(acknowledgement)?;
        self.metrics.sent_ack_bytes += acknowledgement.len();
        let observed = clock_ms() - self.started_ms;
        if self.metrics.first_receive_ms.is_none() {
            self.metrics.first_receive_ms = Some(observed);
        }
        self.metrics.last_receive_ms = Some(observed);
        self.metrics.received_messages += 1;
        self.metrics.received_runtime_bytes += envelope.len() - 5;
        self.metrics.largest_runtime_message_bytes = self
            .metrics
            .largest_runtime_message_bytes
            .max(envelope.len() - 5);
        self.metrics.largest_pending_messages = self
            .metrics
            .largest_pending_messages
            .max(self.pending.len());
        Ok(())
    }

    fn accept_ack(&mut self, envelope: &[u8]) -> worker::Result<()> {
        if envelope.len() != 5 {
            return Err(failure("The transport acknowledgement length is invalid."));
        }
        let acknowledged = u32::from_le_bytes(envelope[1..].try_into().map_err(runtime_failure)?);
        if acknowledged != self.acknowledged + 1 || acknowledged > self.metrics.sent_messages {
            return Err(failure(
                "The transport acknowledgement sequence is invalid.",
            ));
        }
        self.acknowledged = acknowledged;
        self.metrics.received_ack_bytes += envelope.len();
        Ok(())
    }

    fn accept_completion(&mut self, envelope: &[u8]) -> worker::Result<()> {
        if envelope.len() > MAX_COMPLETION_BYTES || self.completion.is_some() {
            return Err(failure("The peer completion is duplicated or too large."));
        }
        self.completion = Some(serde_json::from_slice(&envelope[1..]).map_err(runtime_failure)?);
        Ok(())
    }

    async fn flush(&mut self) -> worker::Result<()> {
        while self.acknowledged != self.metrics.sent_messages {
            self.poll().await?;
        }
        if !self.pending.is_empty() {
            return Err(failure("The peer sent an unexpected runtime message."));
        }
        Ok(())
    }

    async fn peer_completion(&mut self) -> worker::Result<Value> {
        self.flush().await?;
        loop {
            if let Some(completion) = self.completion.take() {
                return Ok(completion);
            }
            self.poll().await?;
        }
    }

    fn send_completion(&self, completion: &Value) -> worker::Result<()> {
        let mut envelope = vec![COMPLETE];
        envelope.extend_from_slice(&serde_json::to_vec(completion).map_err(runtime_failure)?);
        if envelope.len() > MAX_COMPLETION_BYTES {
            return Err(failure("The completion exceeds its transport bound."));
        }
        self.socket.send_with_bytes(envelope)
    }

    fn measurements(&self) -> Value {
        json!({
            "credit_window_messages": CREDIT_WINDOW,
            "maximum_runtime_message_bytes": MAX_RUNTIME_MESSAGE_BYTES,
            "sent_messages": self.metrics.sent_messages,
            "received_messages": self.metrics.received_messages,
            "sent_runtime_bytes": self.metrics.sent_runtime_bytes,
            "received_runtime_bytes": self.metrics.received_runtime_bytes,
            "sent_ack_bytes": self.metrics.sent_ack_bytes,
            "received_ack_bytes": self.metrics.received_ack_bytes,
            "data_envelope_bytes": 5,
            "first_send_ms": self.metrics.first_send_ms,
            "last_send_ms": self.metrics.last_send_ms,
            "first_receive_ms": self.metrics.first_receive_ms,
            "last_receive_ms": self.metrics.last_receive_ms,
            "largest_runtime_message_bytes": self.metrics.largest_runtime_message_bytes,
            "largest_pending_messages": self.metrics.largest_pending_messages,
            "worker_observed_elapsed_ms": clock_ms() - self.started_ms,
            "clock": "Worker Date.now; IO can advance this clock. These values are elapsed observations, not CPU billing measurements.",
        })
    }
}

fn peer_closed() -> worker::Error {
    failure("The peer closed before completion.")
}

fn binary_required() -> worker::Error {
    failure("The peer sent a non-binary message.")
}

async fn drive(
    step: Step<'_>,
    transport: &mut Duplex<'_>,
    expected: &[u8],
) -> worker::Result<(bool, RuntimeMetrics)> {
    let mut current = step;
    loop {
        current = match current {
            Step::Send(send) => {
                transport.send(send.bytes()).await?;
                send.resume().map_err(runtime_failure)?
            }
            Step::Receive(receive) => {
                let message = Zeroizing::new(transport.receive(receive.expected_bytes()).await?);
                receive.accept(&message).map_err(runtime_failure)?
            }
            Step::Complete(output) => {
                let matched = output.output.as_slice() == expected;
                if !matched {
                    return Err(failure("The role fixture output check failed."));
                }
                return Ok((matched, output.metrics));
            }
        };
    }
}

fn role_report(
    kernel: Kernel,
    digest: &[u8; 32],
    matched: bool,
    metrics: RuntimeMetrics,
    transport: &Duplex<'_>,
    colo: Option<String>,
    run_id: &str,
) -> Value {
    json!({
        "schema": SCHEMA,
        "role": ROLE,
        "kernel": kernel.name(),
        "run_id": run_id,
        "schedule_sha256": encode_hex(digest),
        "public_fixture_only": true,
        "fixture_output_matches": matched,
        "incoming_colo": colo,
        "runtime": metrics_json(metrics),
        "transport": transport.measurements(),
    })
}

fn metrics_json(metrics: RuntimeMetrics) -> Value {
    json!({
        "table_bytes": metrics.table_bytes,
        "and_gates": metrics.table_bytes / 32,
        "frame_count": metrics.frame_count,
        "garbler_to_evaluator_wire_bytes": metrics.garbler_to_evaluator_wire_bytes,
        "evaluator_to_garbler_wire_bytes": metrics.evaluator_to_garbler_wire_bytes,
        "ot_wire_bytes": metrics.ot_wire_bytes,
        "direct_label_bytes": metrics.direct_label_bytes,
        "output_translation_bytes": metrics.output_translation_bytes,
        "public_return_bytes": metrics.public_return_bytes,
        "label_arena_allocation_bytes": metrics.label_arena_allocation_bytes,
        "table_buffer_allocation_bytes": metrics.table_buffer_allocation_bytes,
        "largest_control_buffer_bytes": metrics.largest_control_buffer_bytes,
        "schedule_bytes": metrics.schedule_bytes,
        "execution_binding_sha256": encode_hex(&metrics.execution_binding_sha256),
        "memory_scope": "Explicit runtime arenas and buffers only. Retained OT matrices, Wasm linear memory, and host WebSocket queues are excluded.",
    })
}

fn own_inputs_match(schedule: &TrustedMlDsaSchedule<'_>, fixture: &Fixture) -> worker::Result<()> {
    #[cfg(feature = "ml-dsa-a")]
    let expected = schedule.garbler_input_bits();
    #[cfg(feature = "ml-dsa-b")]
    let expected = schedule.evaluator_input_bits();
    if fixture.input.len() != expected {
        return Err(failure("The fixture has the wrong role input bit count."));
    }
    Ok(())
}

fn authenticated(request: &worker::web_sys::Request, env: &Env) -> worker::Result<bool> {
    let configured = Zeroizing::new(env.secret("PROBE_TOKEN")?.to_string());
    if configured.len() != 64 {
        return Err(failure("PROBE_TOKEN must contain 64 characters."));
    }
    let Some(supplied) = request.headers().get("authorization")? else {
        return Ok(false);
    };
    let Some(token) = supplied.strip_prefix("Bearer ") else {
        return Ok(false);
    };
    if token.len() != configured.len() {
        return Ok(false);
    }
    let mut difference = 0_u8;
    for (left, right) in token.bytes().zip(configured.bytes()) {
        difference |= left ^ right;
    }
    Ok(difference == 0)
}

fn request_parameters(
    request: &worker::web_sys::Request,
    path: &str,
) -> worker::Result<(Kernel, String, Option<String>)> {
    let url = url::Url::parse(&request.url()).map_err(runtime_failure)?;
    if request.method() != "GET" || url.path() != path {
        return Err(failure("The ML-DSA benchmark endpoint is unknown."));
    }
    let mut kernel = None;
    let mut run_id = None;
    for (name, value) in url.query_pairs() {
        match name.as_ref() {
            "kernel" if kernel.is_none() => kernel = Some(Kernel::parse(&value)?),
            "run_id" if run_id.is_none() => run_id = Some(value.into_owned()),
            _ => return Err(failure("The benchmark query is invalid.")),
        }
    }
    let kernel = kernel.ok_or_else(missing_fixture_field)?;
    let run_id = run_id.ok_or_else(missing_fixture_field)?;
    if run_id.len() != 32 || !run_id.bytes().all(is_lower_hex) {
        return Err(failure(
            "The run ID must contain 32 lowercase hex characters.",
        ));
    }
    let parsed = worker::Request::from(request.clone());
    let colo = parsed.cf().map(incoming_colo);
    Ok((kernel, run_id, colo))
}

fn is_lower_hex(byte: u8) -> bool {
    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
}

fn incoming_colo(cf: &worker::Cf) -> String {
    cf.colo()
}

fn json_response(value: &Value, status: u16) -> worker::Result<worker::Response> {
    let headers = worker::Headers::new();
    headers.set("cache-control", "no-store")?;
    Ok(worker::Response::from_json(value)?
        .with_headers(headers)
        .with_status(status))
}

#[cfg(feature = "ml-dsa-a")]
async fn connect_b(env: &Env, kernel: Kernel, run_id: &str) -> worker::Result<WebSocket> {
    let token = Zeroizing::new(env.secret("PROBE_TOKEN")?.to_string());
    let request = http::Request::builder()
        .method("GET")
        .uri(format!(
            "https://ml-dsa-b.internal/peer?kernel={}&run_id={run_id}",
            kernel.name()
        ))
        .header("upgrade", "websocket")
        .header("authorization", format!("Bearer {}", token.as_str()))
        .body(worker::Body::empty())
        .map_err(runtime_failure)?;
    let mut response = env.service("ML_DSA_B")?.fetch_request(request).await?;
    if response.status() != http::StatusCode::SWITCHING_PROTOCOLS {
        return Err(failure("The peer rejected the WebSocket connection."));
    }
    response
        .extensions_mut()
        .remove::<WebSocket>()
        .ok_or_else(peer_closed)
}

#[cfg(feature = "ml-dsa-a")]
async fn run_a(
    env: &Env,
    kernel: Kernel,
    run_id: &str,
    colo: Option<String>,
) -> worker::Result<Value> {
    let started_ms = clock_ms();
    let fixture = fixture(kernel)?;
    let schedule =
        TrustedMlDsaSchedule::parse(kernel.schedule(), fixture.digest).map_err(runtime_failure)?;
    own_inputs_match(&schedule, &fixture)?;
    let schedule_prepared_ms = clock_ms() - started_ms;
    let socket = connect_b(env, kernel, run_id).await?;
    let mut transport = Duplex::new(&socket)?;
    let step = begin_garbler(&schedule, &fixture.input).map_err(runtime_failure)?;
    let (matched, metrics) = drive(step, &mut transport, &fixture.expected_output).await?;
    let a = role_report(
        kernel,
        &fixture.digest,
        matched,
        metrics,
        &transport,
        colo,
        run_id,
    );
    let b = transport.peer_completion().await?;
    socket.close(Some(1000), Some("completed"))?;
    if b.get("fixture_output_matches") != Some(&Value::Bool(true)) {
        return Err(failure("The peer fixture output check failed."));
    }
    worker::console_log!(
        "{}",
        json!({"event": "ml-dsa-kernel-complete", "role": ROLE, "run_id": run_id, "kernel": kernel.name()})
    );
    Ok(json!({
        "schema": SCHEMA,
        "ok": true,
        "public_fixture_only": true,
        "run_id": run_id,
        "kernel": kernel.name(),
        "schedule_prepared_ms": schedule_prepared_ms,
        "worker_observed_total_ms": clock_ms() - started_ms,
        "placement": "Incoming colo identifies the request entry point. It does not prove equal physical placement of both Workers.",
        "scope": "One private kernel, genuine OT, disposable public fixtures. This is not a threshold signing protocol.",
        "roles": { "a": a, "b": b },
    }))
}

#[cfg(feature = "ml-dsa-b")]
async fn run_b(
    socket: WebSocket,
    kernel: Kernel,
    run_id: String,
    colo: Option<String>,
) -> worker::Result<()> {
    let fixture = fixture(kernel)?;
    let schedule =
        TrustedMlDsaSchedule::parse(kernel.schedule(), fixture.digest).map_err(runtime_failure)?;
    own_inputs_match(&schedule, &fixture)?;
    let mut transport = Duplex::new(&socket)?;
    let step = begin_evaluator(&schedule, &fixture.input).map_err(runtime_failure)?;
    let (matched, metrics) = drive(step, &mut transport, &fixture.expected_output).await?;
    transport.flush().await?;
    let report = role_report(
        kernel,
        &fixture.digest,
        matched,
        metrics,
        &transport,
        colo,
        &run_id,
    );
    transport.send_completion(&report)?;
    worker::console_log!(
        "{}",
        json!({"event": "ml-dsa-kernel-complete", "role": ROLE, "run_id": run_id, "kernel": kernel.name()})
    );
    Ok(())
}

/// Runs one disposable ML-DSA kernel for this build's fixed role.
#[worker::event(fetch)]
pub async fn main(
    request: worker::web_sys::Request,
    env: Env,
    context: worker::Context,
) -> worker::Result<worker::Response> {
    if !authenticated(&request, &env)? {
        return json_response(
            &json!({"ok": false, "error": "Unauthorized probe request."}),
            401,
        );
    }
    #[cfg(feature = "ml-dsa-a")]
    {
        let _ = context;
        let (kernel, run_id, colo) = request_parameters(&request, "/benchmark")?;
        match run_a(&env, kernel, &run_id, colo).await {
            Ok(report) => json_response(&report, 200),
            Err(error) => json_response(
                &json!({"ok": false, "error": error.to_string(), "run_id": run_id}),
                500,
            ),
        }
    }
    #[cfg(feature = "ml-dsa-b")]
    {
        let (kernel, run_id, colo) = request_parameters(&request, "/peer")?;
        if request.headers().get("upgrade")?.as_deref() != Some("websocket") {
            return json_response(
                &json!({"ok": false, "error": "WebSocket upgrade required."}),
                426,
            );
        }
        let pair = worker::WebSocketPair::new()?;
        let server = pair.server;
        let for_error = server.clone();
        context.wait_until(async move {
            if let Err(error) = run_b(server, kernel, run_id, colo).await {
                worker::console_error!("ML-DSA kernel failed: {}", error);
                let _ = for_error.close(Some(1011), Some("kernel failed"));
            }
        });
        let headers = worker::Headers::new();
        headers.set("cache-control", "no-store")?;
        Ok(worker::Response::from_websocket(pair.client)?.with_headers(headers))
    }
}
