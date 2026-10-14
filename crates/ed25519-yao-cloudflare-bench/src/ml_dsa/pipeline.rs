//! Complete disposable key generation and signing on separate Worker roles.

use std::collections::{BTreeMap, BTreeSet};

use ed25519_yao::{
    ml_dsa_runtime::{RuntimeMetrics, TrustedMlDsaSchedule},
    ml_dsa_signing::{
        begin_signing,
        keygen::{begin_keygen, KeygenKernel, KeygenOutput, KeygenStep},
        OwnSigningShare, SigningKernel, SigningMode, SigningRole, SigningStep, ThresholdSignature,
        PUBLIC_KEY_BYTES, SIGNATURE_BYTES,
    },
};
use ml_dsa::{EncodedSignature, EncodedVerifyingKey, MlDsa65, Signature, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(feature = "ml-dsa-a")]
use worker::Env;
use worker::WebSocket;
use zeroize::Zeroizing;

use super::{
    clock_ms, decode_hex, drive_runtime, encode_hex, failure, missing_fixture_field,
    required_string, runtime_failure, wasm_linear_memory_highwater_bytes, Duplex, FIXTURES, ROLE,
};

#[derive(Clone, Copy)]
pub(super) enum Operation {
    Keygen(ThresholdMode),
    Threshold(ThresholdMode),
}

impl Operation {
    pub(super) const fn name(self) -> &'static str {
        match self {
            Self::Keygen(ThresholdMode::Fixture) => "keygen-fixture",
            Self::Keygen(ThresholdMode::Joint) => "keygen-joint",
            Self::Threshold(ThresholdMode::Fixture) => "threshold-fixture",
            Self::Threshold(ThresholdMode::Joint) => "threshold-joint",
        }
    }

    const fn mode(self) -> ThresholdMode {
        match self {
            Self::Keygen(mode) | Self::Threshold(mode) => mode,
        }
    }

    const fn schema(self) -> &'static str {
        match self {
            Self::Keygen(_) => "seams.ml-dsa-worker-keygen.v1",
            Self::Threshold(_) => "seams.ml-dsa-worker-threshold.v1",
        }
    }
}

#[derive(Clone, Copy)]
pub(super) enum ThresholdMode {
    Fixture,
    Joint,
}

impl ThresholdMode {
    const fn signing_mode(self) -> SigningMode {
        match self {
            Self::Fixture => SigningMode::Deterministic,
            Self::Joint => SigningMode::JointRandom,
        }
    }
}

#[derive(Clone, Copy)]
enum Circuit {
    Keygen(KeygenKernel),
    Signing(SigningKernel),
}

impl Circuit {
    const ALL: [Self; 10] = [
        Self::Keygen(KeygenKernel::Seed),
        Self::Keygen(KeygenKernel::Sampling),
        Self::Keygen(KeygenKernel::Rounding),
        Self::Signing(SigningKernel::SigningSeed),
        Self::Signing(SigningKernel::ExpandMask),
        Self::Signing(SigningKernel::CommitmentHighBits),
        Self::Signing(SigningKernel::CommitmentHash),
        Self::Signing(SigningKernel::ResponseCheck),
        Self::Signing(SigningKernel::RowCheckAndHints),
        Self::Signing(SigningKernel::AggregateCheck),
    ];

    const fn name(self) -> &'static str {
        match self {
            Self::Keygen(kernel) => kernel.name(),
            Self::Signing(kernel) => kernel.name(),
        }
    }

    fn bytes(self) -> &'static [u8] {
        match self {
            Self::Keygen(KeygenKernel::Seed) => super::Kernel::Seed.schedule(),
            Self::Keygen(KeygenKernel::Sampling) => super::Kernel::Sampling.schedule(),
            Self::Keygen(KeygenKernel::Rounding) => super::Kernel::Rounding.schedule(),
            Self::Signing(SigningKernel::SigningSeed) => {
                include_bytes!("../ml_dsa_schedules/signing-seed.bin")
            }
            Self::Signing(SigningKernel::ExpandMask) => super::Kernel::ExpandMask.schedule(),
            Self::Signing(SigningKernel::CommitmentHighBits) => {
                include_bytes!("../ml_dsa_schedules/commitment-high.bin")
            }
            Self::Signing(SigningKernel::CommitmentHash) => {
                include_bytes!("../ml_dsa_schedules/commitment-hash.bin")
            }
            Self::Signing(SigningKernel::ResponseCheck) => {
                include_bytes!("../ml_dsa_schedules/response-check.bin")
            }
            Self::Signing(SigningKernel::RowCheckAndHints) => {
                include_bytes!("../ml_dsa_schedules/row-check.bin")
            }
            Self::Signing(SigningKernel::AggregateCheck) => {
                include_bytes!("../ml_dsa_schedules/aggregate-check.bin")
            }
        }
    }
}

struct FixedResult {
    public_key: [u8; PUBLIC_KEY_BYTES],
    signature: [u8; SIGNATURE_BYTES],
}

enum ExpectedResult {
    Fixed(Box<FixedResult>),
    Joint,
}

struct Inputs {
    own_seed_share: Zeroizing<[u8; 32]>,
    message: [u8; 32],
    expected: ExpectedResult,
}

fn fixed_bytes<const N: usize>(record: &Value, name: &str) -> worker::Result<[u8; N]> {
    let decoded = Zeroizing::new(decode_hex(required_string(record, name)?)?);
    decoded
        .as_slice()
        .try_into()
        .map_err(|_| failure("A generated fixture field has the wrong exact length."))
}

fn inputs(mode: ThresholdMode) -> worker::Result<Inputs> {
    let root: Value = serde_json::from_str(FIXTURES).map_err(runtime_failure)?;
    let fixture = root
        .get("threshold_fixture")
        .ok_or_else(missing_fixture_field)?;
    let message = fixed_bytes(fixture, "message_hex")?;
    if !required_string(fixture, "context_hex")?.is_empty() {
        return Err(failure(
            "The NEAR-shaped pipeline requires an empty FIPS context.",
        ));
    }
    match mode {
        ThresholdMode::Fixture => Ok(Inputs {
            own_seed_share: Zeroizing::new(fixed_bytes(fixture, "own_seed_share_hex")?),
            message,
            expected: ExpectedResult::Fixed(Box::new(FixedResult {
                public_key: fixed_bytes(fixture, "public_key_hex")?,
                signature: fixed_bytes(fixture, "deterministic_signature_hex")?,
            })),
        }),
        ThresholdMode::Joint => {
            let mut own_seed_share = Zeroizing::new([0; 32]);
            getrandom::getrandom(own_seed_share.as_mut()).map_err(runtime_failure)?;
            Ok(Inputs {
                own_seed_share,
                message,
                expected: ExpectedResult::Joint,
            })
        }
    }
}

fn schedules(operation: Operation) -> worker::Result<Vec<TrustedMlDsaSchedule<'static>>> {
    let root: Value = serde_json::from_str(FIXTURES).map_err(runtime_failure)?;
    let records = root
        .get("schedules")
        .and_then(Value::as_object)
        .ok_or_else(missing_fixture_field)?;
    let mut schedules = Vec::with_capacity(Circuit::ALL.len());
    for circuit in Circuit::ALL {
        if matches!(operation, Operation::Keygen(_)) && matches!(circuit, Circuit::Signing(_)) {
            continue;
        }
        let record = records
            .get(circuit.name())
            .ok_or_else(missing_fixture_field)?;
        let digest = fixed_bytes(record, "sha256")?;
        schedules
            .push(TrustedMlDsaSchedule::parse(circuit.bytes(), digest).map_err(runtime_failure)?);
    }
    Ok(schedules)
}

fn own_role() -> SigningRole {
    #[cfg(feature = "ml-dsa-a")]
    {
        SigningRole::A
    }
    #[cfg(feature = "ml-dsa-b")]
    {
        SigningRole::B
    }
}

#[derive(Default)]
struct KernelTotals {
    calls: usize,
    table_bytes: u64,
    a_to_b_bytes: u64,
    b_to_a_bytes: u64,
    ot_bytes: u64,
}

#[derive(Default)]
struct Accounting {
    kernels: BTreeMap<&'static str, KernelTotals>,
    bindings: BTreeSet<[u8; 32]>,
    binding_hash: Sha256,
    circuits: usize,
    table_bytes: u64,
    a_to_b_bytes: u64,
    b_to_a_bytes: u64,
    ot_bytes: u64,
    frames: usize,
    largest_arena_bytes: usize,
    largest_control_bytes: usize,
    accepted_share_bytes: usize,
    binding_bytes_per_direction: usize,
    signature_return_bytes: usize,
}

impl Accounting {
    fn record(&mut self, name: &'static str, metrics: &RuntimeMetrics) -> worker::Result<()> {
        if !self.bindings.insert(metrics.execution_binding_sha256) {
            return Err(failure("The pipeline reused a circuit execution binding."));
        }
        self.binding_hash.update(metrics.execution_binding_sha256);
        self.circuits += 1;
        self.table_bytes += metrics.table_bytes as u64;
        self.a_to_b_bytes += metrics.garbler_to_evaluator_wire_bytes as u64;
        self.b_to_a_bytes += metrics.evaluator_to_garbler_wire_bytes as u64;
        self.ot_bytes += metrics.ot_wire_bytes as u64;
        self.frames += metrics.frame_count;
        self.largest_arena_bytes = self
            .largest_arena_bytes
            .max(metrics.label_arena_allocation_bytes);
        self.largest_control_bytes = self
            .largest_control_bytes
            .max(metrics.maximum_control_message_bytes);
        let entry = self.kernels.entry(name).or_default();
        entry.calls += 1;
        entry.table_bytes += metrics.table_bytes as u64;
        entry.a_to_b_bytes += metrics.garbler_to_evaluator_wire_bytes as u64;
        entry.b_to_a_bytes += metrics.evaluator_to_garbler_wire_bytes as u64;
        entry.ot_bytes += metrics.ot_wire_bytes as u64;
        Ok(())
    }

    fn check_transport(&self, transport: &Duplex<'_>) -> worker::Result<()> {
        let (sent, received) = match own_role() {
            SigningRole::A => (self.a_to_b_bytes, self.b_to_a_bytes),
            SigningRole::B => (self.b_to_a_bytes, self.a_to_b_bytes),
        };
        if sent != transport.metrics.sent_runtime_bytes
            || received != transport.metrics.received_runtime_bytes
        {
            return Err(failure(
                "Complete pipeline bytes differ from transport accounting.",
            ));
        }
        Ok(())
    }

    fn report(&self) -> Value {
        let mut kernels = Vec::with_capacity(self.kernels.len());
        for (name, metrics) in &self.kernels {
            kernels.push(json!({"kernel": name, "calls": metrics.calls, "table_bytes": metrics.table_bytes, "a_to_b_wire_bytes": metrics.a_to_b_bytes, "b_to_a_wire_bytes": metrics.b_to_a_bytes, "ot_wire_bytes": metrics.ot_bytes}));
        }
        json!({
            "circuit_count": self.circuits,
            "fresh_execution_bindings": self.bindings.len(),
            "execution_bindings_sha256": encode_hex(&self.binding_hash.clone().finalize()),
            "table_bytes": self.table_bytes,
            "a_to_b_wire_bytes": self.a_to_b_bytes,
            "b_to_a_wire_bytes": self.b_to_a_bytes,
            "ot_wire_bytes": self.ot_bytes,
            "table_frame_count": self.frames,
            "largest_label_arena_allocation_bytes": self.largest_arena_bytes,
            "largest_control_message_bytes": self.largest_control_bytes,
            "accepted_share_bytes": self.accepted_share_bytes,
            "binding_bytes_per_direction": self.binding_bytes_per_direction,
            "signature_return_bytes": self.signature_return_bytes,
            "per_kernel": kernels,
        })
    }
}

struct PipelineResult {
    public_key: [u8; PUBLIC_KEY_BYTES],
    outcome: Outcome,
    keygen_observed_ms: f64,
    accounting: Accounting,
    reference_result: &'static str,
}

enum Outcome {
    Keygen {
        own_material_bytes: usize,
    },
    Signing {
        signature: Box<ThresholdSignature>,
        message: [u8; 32],
        observed_ms: f64,
    },
}

async fn execute(
    operation: Operation,
    run_id: &str,
    transport: &mut Duplex<'_>,
) -> worker::Result<PipelineResult> {
    let mode = operation.mode();
    let inputs = inputs(mode)?;
    let schedules = schedules(operation)?;
    let mut accounting = Accounting::default();
    let started_keygen = clock_ms();
    let key = generate_key(
        &inputs.own_seed_share,
        &schedules,
        transport,
        &mut accounting,
    )
    .await?;
    let keygen_observed_ms = clock_ms() - started_keygen;
    let public_key = key.public_key;
    if matches!(operation, Operation::Keygen(_)) {
        accounting.check_transport(transport)?;
        let reference_result = match inputs.expected {
            ExpectedResult::Fixed(expected) => {
                if public_key != expected.public_key {
                    return Err(failure("The Worker key differs from its canonical reference."));
                }
                "The complete public key matches the independent canonical fixture."
            }
            ExpectedResult::Joint => "Both roles generated independent seed contributions. No seed reconstruction occurs in this pipeline.",
        };
        return Ok(PipelineResult {
            public_key,
            outcome: Outcome::Keygen {
                own_material_bytes: key.own_material.len(),
            },
            keygen_observed_ms,
            accounting,
            reference_result,
        });
    }
    let own = OwnSigningShare::parse(&key.own_material).map_err(runtime_failure)?;
    drop(key);
    let started_signing = clock_ms();
    let mut signing = begin_signing(
        own_role(),
        own,
        &public_key,
        &inputs.message,
        b"",
        mode.signing_mode(),
        &Sha256::digest(run_id.as_bytes()).into(),
    )
    .map_err(runtime_failure)?;
    let signature = loop {
        signing = match signing {
            SigningStep::Circuit(request) => {
                let kernel = request.kernel();
                let schedule = find_schedule(&schedules, kernel.circuit_id())?;
                let output =
                    drive_runtime(request.begin(schedule).map_err(runtime_failure)?, transport)
                        .await?;
                accounting.record(kernel.name(), &output.metrics)?;
                request.accept(output).map_err(runtime_failure)?
            }
            SigningStep::Send(send) => {
                transport.send(send.bytes()).await?;
                send.resume().map_err(runtime_failure)?
            }
            SigningStep::Receive(receive) => {
                let bytes = Zeroizing::new(transport.receive(receive.expected_bytes()).await?);
                receive.accept(&bytes).map_err(runtime_failure)?
            }
            SigningStep::Complete(signature) => break signature,
        };
    };
    accounting.binding_bytes_per_direction = signature.metrics.binding_bytes_per_direction;
    accounting.a_to_b_bytes += (signature.metrics.accepted_share_bytes
        + signature.metrics.binding_bytes_per_direction) as u64;
    accounting.b_to_a_bytes += (signature.metrics.signature_return_bytes
        + signature.metrics.binding_bytes_per_direction) as u64;
    accounting.accepted_share_bytes = signature.metrics.accepted_share_bytes;
    accounting.signature_return_bytes = signature.metrics.signature_return_bytes;
    accounting.check_transport(transport)?;
    verify_standard_signature(&public_key, &inputs.message, &signature.signature)?;
    let reference_result = match inputs.expected {
        ExpectedResult::Fixed(expected) => {
            if public_key != expected.public_key || signature.signature != expected.signature {
                return Err(failure("The complete Worker pipeline differs from its independent canonical fixture."));
            }
            "Canonical public key and deterministic signature match the independent reference bytes."
        }
        ExpectedResult::Joint => "Each role generated its own independent seed contribution. The standard signature verifies; no seed reconstruction occurs in this pipeline.",
    };
    Ok(PipelineResult {
        public_key,
        outcome: Outcome::Signing {
            signature,
            message: inputs.message,
            observed_ms: clock_ms() - started_signing,
        },
        keygen_observed_ms,
        accounting,
        reference_result,
    })
}

async fn generate_key(
    own_seed_share: &[u8; 32],
    schedules: &[TrustedMlDsaSchedule<'static>],
    transport: &mut Duplex<'_>,
    accounting: &mut Accounting,
) -> worker::Result<Box<KeygenOutput>> {
    let mut keygen = begin_keygen(own_role(), own_seed_share).map_err(runtime_failure)?;
    loop {
        keygen = match keygen {
            KeygenStep::Circuit(request) => {
                let kernel = request.kernel();
                let schedule = find_schedule(schedules, kernel.circuit_id())?;
                let output =
                    drive_runtime(request.begin(schedule).map_err(runtime_failure)?, transport)
                        .await?;
                accounting.record(kernel.name(), &output.metrics)?;
                request.accept(output).map_err(runtime_failure)?
            }
            KeygenStep::Complete(key) => return Ok(key),
        };
    }
}

fn find_schedule<'a>(
    schedules: &'a [TrustedMlDsaSchedule<'static>],
    circuit_id: u8,
) -> worker::Result<&'a TrustedMlDsaSchedule<'static>> {
    for schedule in schedules {
        if schedule.circuit_id() == circuit_id {
            return Ok(schedule);
        }
    }
    Err(failure(
        "The complete pipeline has no schedule for its next circuit.",
    ))
}

fn verify_standard_signature(
    public_key: &[u8; PUBLIC_KEY_BYTES],
    message: &[u8; 32],
    signature: &[u8; SIGNATURE_BYTES],
) -> worker::Result<()> {
    let encoded_key: EncodedVerifyingKey<MlDsa65> =
        public_key.as_slice().try_into().map_err(runtime_failure)?;
    let encoded_signature: EncodedSignature<MlDsa65> =
        signature.as_slice().try_into().map_err(runtime_failure)?;
    let decoded =
        Signature::<MlDsa65>::decode(&encoded_signature).ok_or_else(invalid_standard_signature)?;
    if !VerifyingKey::<MlDsa65>::decode(&encoded_key).verify_with_context(message, b"", &decoded) {
        return Err(invalid_standard_signature());
    }
    Ok(())
}

fn invalid_standard_signature() -> worker::Error {
    failure("An independent standard verifier rejected the threshold signature.")
}

fn role_report(
    result: &PipelineResult,
    operation: Operation,
    transport: &Duplex<'_>,
    run_id: &str,
    colo: Option<String>,
) -> Value {
    let mut report = json!({
        "schema": operation.schema(),
        "role": ROLE,
        "kernel": operation.name(),
        "run_id": run_id,
        "disposable_test_key": true,
        "public_fixture_only": matches!(operation.mode(), ThresholdMode::Fixture),
        "public_key_hex": encode_hex(&result.public_key),
        "reference_result": result.reference_result,
        "keygen_observed_ms": result.keygen_observed_ms,
        "incoming_colo": colo,
        "wasm_linear_memory_highwater_bytes": wasm_linear_memory_highwater_bytes(),
        "linear_memory_scope": "Current isolate-wide Wasm linear memory. JavaScript buffers and total Worker memory are excluded.",
        "runtime": result.accounting.report(),
        "transport": transport.measurements(),
    });
    match &result.outcome {
        Outcome::Keygen { own_material_bytes } => {
            report["own_material_bytes"] = json!(own_material_bytes);
        }
        Outcome::Signing {
            signature,
            message,
            observed_ms,
        } => {
            let mut challenges = Vec::with_capacity(signature.metrics.challenge_hashes.len());
            for challenge in &signature.metrics.challenge_hashes {
                challenges.push(encode_hex(challenge));
            }
            report["signature_hex"] = json!(encode_hex(&signature.signature));
            report["message_hex"] = json!(encode_hex(message));
            report["context_hex"] = json!("");
            report["standard_signature_verified"] = json!(true);
            report["signing_observed_ms"] = json!(observed_ms);
            report["attempts"] = json!(signature.attempts);
            report["retry_count"] = json!(signature.attempts - 1);
            report["challenge_hashes_hex"] = json!(challenges);
        }
    }
    report
}

#[cfg(feature = "ml-dsa-a")]
pub(super) async fn run_a(
    env: &Env,
    operation: Operation,
    run_id: &str,
    colo: Option<String>,
) -> worker::Result<Value> {
    let started_ms = clock_ms();
    let socket = super::connect_b(env, operation.name(), run_id).await?;
    let result = run_a_session(&socket, operation, run_id, colo).await;
    let closed = socket.close(
        Some(if result.is_ok() { 1000 } else { 1011 }),
        Some("pipeline ended"),
    );
    let roles = match result {
        Ok(roles) => {
            closed?;
            roles
        }
        Err(error) => return Err(error),
    };
    Ok(json!({
        "schema": operation.schema(),
        "ok": true,
        "kernel": operation.name(),
        "run_id": run_id,
        "disposable_test_key": true,
        "public_fixture_only": matches!(operation.mode(), ThresholdMode::Fixture),
        "production_eligible": false,
        "worker_observed_total_ms": clock_ms() - started_ms,
        "scope": match operation {
            Operation::Keygen(_) => "Complete eighteen-circuit canonical key generation on separate Workers. Each role completes its own private signing material and discards it after this disposable benchmark. No signature is generated.",
            Operation::Threshold(_) => "Complete eighteen-circuit canonical key generation, followed by threshold signing and independent standard verification on separate Workers. All private material is ephemeral and role-local."
        },
        "security_limits": [
            "Passive honest execution only. The public-challenge and aggregate-acceptance composition requires independent cryptographic review.",
            "No wallet admission, durable share storage, production peer authentication, or authorized export flow is implemented by this probe.",
            "Classical OT does not provide post-quantum transcript confidentiality. The linear arithmetic has no target-specific constant-time qualification.",
            "Incoming colo does not establish equal physical Worker placement. Elapsed clock observations do not establish CPU charges or total isolate memory."
        ],
        "roles": roles,
    }))
}

#[cfg(feature = "ml-dsa-a")]
async fn run_a_session(
    socket: &WebSocket,
    operation: Operation,
    run_id: &str,
    colo: Option<String>,
) -> worker::Result<Value> {
    let mut transport = Duplex::new(socket)?;
    let result = execute(operation, run_id, &mut transport).await?;
    let b = transport.peer_completion().await?;
    let a = role_report(&result, operation, &transport, run_id, colo);
    for field in ["schema", "kernel", "run_id", "public_key_hex"] {
        if a[field] != b[field] {
            return Err(failure(
                "The Worker roles returned different public key results.",
            ));
        }
    }
    let result_fields = match operation {
        Operation::Keygen(_) => &["own_material_bytes"][..],
        Operation::Threshold(_) => &[
            "signature_hex",
            "attempts",
            "challenge_hashes_hex",
            "standard_signature_verified",
        ][..],
    };
    for field in result_fields {
        if a[*field] != b[*field] {
            return Err(failure(
                "The Worker roles returned different completion results.",
            ));
        }
    }
    for field in [
        "execution_bindings_sha256",
        "circuit_count",
        "table_bytes",
        "a_to_b_wire_bytes",
        "b_to_a_wire_bytes",
        "ot_wire_bytes",
    ] {
        if a["runtime"][field] != b["runtime"][field] {
            return Err(failure(
                "The Worker pipeline counters or session bindings disagree.",
            ));
        }
    }
    Ok(json!({"a": a, "b": b}))
}

#[cfg(feature = "ml-dsa-b")]
pub(super) async fn run_b(
    socket: WebSocket,
    operation: Operation,
    run_id: String,
    colo: Option<String>,
) -> worker::Result<()> {
    let mut transport = Duplex::new(&socket)?;
    let result = execute(operation, &run_id, &mut transport).await?;
    transport.flush().await?;
    let report = role_report(&result, operation, &transport, &run_id, colo);
    transport.send_completion(&report)?;
    socket.close(Some(1000), Some("pipeline complete"))?;
    worker::console_log!(
        "{}",
        json!({"event": "ml-dsa-pipeline-complete", "role": ROLE, "run_id": run_id, "kernel": operation.name()})
    );
    Ok(())
}
