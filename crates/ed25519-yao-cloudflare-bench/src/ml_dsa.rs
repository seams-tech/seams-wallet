//! Disposable prepared ML-DSA protocols on two isolated Worker roles.
//!
//! Each build embeds only its own fixture inputs and expected outputs. B checks
//! its output locally and sends only the check result and public measurements.
//! The runtime supplies genuine input OT. This adapter supplies a shared probe
//! credential and bounded WebSocket delivery. It supplies no wallet admission,
//! durable shares or authenticated production peers. The complete pipeline
//! remains a disposable investigation with no production eligibility claim.

mod pipeline;
mod pool;
mod prepared;
mod prepared_signing;
mod prepared_storage;

use std::collections::VecDeque;

use futures_util::StreamExt;
use ml_dsa_threshold::runtime::{RuntimeOutput, Step, MAX_MESSAGE_BYTES};
use serde_json::{json, Value};
use wasm_bindgen::JsCast;
use worker::{Env, EventStream, WebSocket, WebsocketEvent};
use zeroize::Zeroizing;

const CREDIT_WINDOW: u32 = 8;
const MAX_COMPLETION_BYTES: usize = 262_144;
const DATA: u8 = 0;
const ACK: u8 = 1;
const COMPLETE: u8 = 2;
static COMMITMENT_HASH_SCHEDULE: &[u8] = include_bytes!("ml_dsa_schedules/commitment-hash.bin");
static RESPONSE_CHECK_SCHEDULE: &[u8] = include_bytes!("ml_dsa_schedules/response-check.bin");
static SEED_SCHEDULE: &[u8] = include_bytes!("ml_dsa_schedules/seed.bin");
static SAMPLING_TWO_BLOCKS_SCHEDULE: &[u8] =
    include_bytes!("ml_dsa_schedules/sampling-two-blocks.bin");
static SAMPLING_THREE_BLOCKS_SCHEDULE: &[u8] =
    include_bytes!("ml_dsa_schedules/sampling-three-blocks.bin");
static SAMPLING_FINAL_BOUND_SCHEDULE: &[u8] =
    include_bytes!("ml_dsa_schedules/sampling-final-bound.bin");
#[cfg(feature = "ml-dsa-a")]
const ROLE: &str = "a";
#[cfg(feature = "ml-dsa-b")]
const ROLE: &str = "b";
fn operation(name: &str) -> worker::Result<prepared::Operation> {
    match name {
        "prepared-gmw-pool" => Ok(prepared::Operation::Pool),
        "prepared-keygen" => Ok(prepared::Operation::Keygen),
        "prepared-signing" => Ok(prepared::Operation::Signing(
            prepared_signing::Backend::HalfGates,
        )),
        "prepared-gmw-signing" => Ok(prepared::Operation::Signing(prepared_signing::Backend::Gmw)),
        _ => Err(failure("Unknown prepared ML-DSA operation.")),
    }
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
    if !encoded.len().is_multiple_of(2) {
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

fn clock_ms() -> f64 {
    worker::js_sys::Date::now()
}

#[derive(Default)]
struct DeliveryMetrics {
    sent_messages: u32,
    received_messages: u32,
    sent_runtime_bytes: u64,
    received_runtime_bytes: u64,
    sent_ack_bytes: u64,
    received_ack_bytes: u64,
    received_completion_bytes: u64,
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
        socket
            .as_ref()
            .set_binary_type(worker::web_sys::BinaryType::Arraybuffer);
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
        if bytes.len() > MAX_MESSAGE_BYTES {
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
        self.metrics.sent_runtime_bytes += bytes.len() as u64;
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
        if envelope.len() < 5 || envelope.len() > MAX_MESSAGE_BYTES + 5 {
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
        self.metrics.sent_ack_bytes += acknowledgement.len() as u64;
        let observed = clock_ms() - self.started_ms;
        if self.metrics.first_receive_ms.is_none() {
            self.metrics.first_receive_ms = Some(observed);
        }
        self.metrics.last_receive_ms = Some(observed);
        self.metrics.received_messages += 1;
        self.metrics.received_runtime_bytes += (envelope.len() - 5) as u64;
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
        self.metrics.received_ack_bytes += envelope.len() as u64;
        Ok(())
    }

    fn accept_completion(&mut self, envelope: &[u8]) -> worker::Result<()> {
        if envelope.len() > MAX_COMPLETION_BYTES || self.completion.is_some() {
            return Err(failure("The peer completion is duplicated or too large."));
        }
        self.metrics.received_completion_bytes += envelope.len() as u64;
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

    #[cfg(feature = "ml-dsa-a")]
    async fn peer_completion(&mut self) -> worker::Result<Value> {
        self.flush().await?;
        loop {
            if let Some(completion) = self.completion.take() {
                return Ok(completion);
            }
            self.poll().await?;
        }
    }

    #[cfg(feature = "ml-dsa-b")]
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
            "maximum_runtime_message_bytes": MAX_MESSAGE_BYTES,
            "sent_messages": self.metrics.sent_messages,
            "received_messages": self.metrics.received_messages,
            "sent_runtime_bytes": self.metrics.sent_runtime_bytes,
            "received_runtime_bytes": self.metrics.received_runtime_bytes,
            "sent_ack_bytes": self.metrics.sent_ack_bytes,
            "received_ack_bytes": self.metrics.received_ack_bytes,
            "sent_data_envelope_bytes": self.metrics.sent_messages * 5,
            "received_data_envelope_bytes": self.metrics.received_messages * 5,
            "received_completion_bytes": self.metrics.received_completion_bytes,
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

async fn drive_runtime(
    step: Step<'_>,
    transport: &mut Duplex<'_>,
) -> worker::Result<RuntimeOutput> {
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
            Step::Complete(output) => return Ok(output),
        };
    }
}

fn wasm_linear_memory_highwater_bytes() -> u32 {
    let memory = wasm_bindgen::memory()
        .dyn_into::<worker::js_sys::WebAssembly::Memory>()
        .expect("wasm_bindgen exposes this module's linear memory");
    worker::js_sys::Uint8Array::new(&memory.buffer()).byte_length()
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
) -> worker::Result<(prepared::Operation, String, Option<String>)> {
    let url = url::Url::parse(&request.url()).map_err(runtime_failure)?;
    if request.method() != "GET" || url.path() != path {
        return Err(failure("The ML-DSA benchmark endpoint is unknown."));
    }
    let mut kernel = None;
    let mut run_id = None;
    for (name, value) in url.query_pairs() {
        match name.as_ref() {
            "kernel" if kernel.is_none() => kernel = Some(operation(&value)?),
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
    let parsed = worker::Request::from(request.clone().map_err(worker::Error::from)?);
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
async fn connect_b(env: &Env, operation: &str, run_id: &str) -> worker::Result<WebSocket> {
    let token = Zeroizing::new(env.secret("PROBE_TOKEN")?.to_string());
    let request = http::Request::builder()
        .method("GET")
        .uri(format!(
            "https://ml-dsa-b.internal/peer?kernel={operation}&run_id={run_id}"
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

/// Runs a disposable prepared protocol for this build's fixed role.
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
        let (operation, run_id, colo) = request_parameters(&request, "/benchmark")?;
        if request.headers().get("upgrade")?.as_deref() != Some("websocket") {
            return json_response(
                &json!({"ok": false, "error": "WebSocket upgrade required."}),
                426,
            );
        }
        prepared::accept_a(env, context, run_id, colo, operation)
    }
    #[cfg(feature = "ml-dsa-b")]
    {
        let (operation, run_id, colo) = request_parameters(&request, "/peer")?;
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
            let result = match operation {
                prepared::Operation::Pool => Box::pin(pool::run_b(env, server, run_id, colo)).await,
                prepared::Operation::Keygen => prepared::run_b(env, server, run_id, colo).await,
                prepared::Operation::Signing(backend) => {
                    Box::pin(prepared_signing::run_b(env, server, run_id, colo, backend)).await
                }
            };
            if let Err(error) = result {
                worker::console_error!("ML-DSA probe failed: {}", error);
                let _ = for_error.close(Some(1011), Some("probe failed"));
            }
        });
        let headers = worker::Headers::new();
        headers.set("cache-control", "no-store")?;
        Ok(worker::Response::from_websocket(pair.client)?.with_headers(headers))
    }
}
