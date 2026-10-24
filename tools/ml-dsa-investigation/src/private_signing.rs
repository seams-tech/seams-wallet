//! Complete threshold signatures from role-local disposable key material.

use crate::boolean_engine_evidence::{PipeTransport, run_ready};
use crate::complete_engine_evidence::{self, Engine};
use crate::signing_lifecycle_evidence::{RoleExecution, WireFault};
use crate::{InvestigationResult, digest, private_execution, reference, require};
use ed25519_yao_generator::{
    MlDsaSigningWorkloadV1, compile_ml_dsa_private_signing_circuit_v1,
    compile_ml_dsa_private_signing_mask_circuit_v1,
};
use ml_dsa::{MlDsa65, SigningKey};
use ml_dsa_threshold::{
    runtime::{RuntimeOutput, Step, TrustedMlDsaSchedule},
    signing::{
        OwnSigningShare, PUBLIC_KEY_BYTES, SigningKernel, SigningMode, SigningRole, SigningStep,
        ThresholdSignature, begin_signing,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    env,
    ffi::OsStr,
    fs,
    io::{self, Read, Write},
    path::Path,
    process::Command,
    time::Instant,
};
use zeroize::Zeroizing;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum Randomness {
    Deterministic,
    JointRandom,
}

impl Randomness {
    const fn mode(self) -> SigningMode {
        match self {
            Self::Deterministic => SigningMode::Deterministic,
            Self::JointRandom => SigningMode::JointRandom,
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Operation {
    pub operation_id: [u8; 32],
    pub engine: Engine,
    pub message: [u8; 32],
    pub context: Vec<u8>,
    pub randomness: Randomness,
}

pub(super) fn fresh_operation_id() -> InvestigationResult<[u8; 32]> {
    let mut id = [0; 32];
    getrandom::getrandom(&mut id)?;
    Ok(id)
}

pub(super) fn try_run_child() -> InvestigationResult<bool> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let Some(mode) = arguments.first() else {
        return Ok(false);
    };
    let execution = match mode.as_str() {
        "private-signing-role-a" => RoleExecution::Complete(SigningRole::A),
        "private-signing-role-b" => RoleExecution::Complete(SigningRole::B),
        "private-signing-interrupt-role-a" => RoleExecution::InterruptAfterMask,
        "private-signing-replay-role-a" => RoleExecution::ReplayBaseChoices,
        _ => return Ok(false),
    };
    require(
        arguments.len() == 6,
        "Signing role needs schedules, own material, public key, public operation, and public result paths.",
    )?;
    run_role(
        execution,
        Path::new(&arguments[1]),
        Path::new(&arguments[2]),
        Path::new(&arguments[3]),
        Path::new(&arguments[4]),
        Path::new(&arguments[5]),
    )?;
    Ok(true)
}

pub(super) fn compile_schedules(directory: &Path) -> InvestigationResult<Vec<Value>> {
    let mut identities = Vec::with_capacity(SigningKernel::ALL.len());
    let mask = compile_ml_dsa_private_signing_mask_circuit_v1();
    identities.push(save_schedule(
        directory,
        SigningKernel::ExpandMask,
        mask.canonical_schedule_encoding(),
        mask.metrics().and_gate_count(),
    )?);
    drop(mask);
    for (kernel, workload) in [
        (
            SigningKernel::SigningSeed,
            MlDsaSigningWorkloadV1::SigningSeed,
        ),
        (
            SigningKernel::CommitmentHighBits,
            MlDsaSigningWorkloadV1::CommitmentHighBits,
        ),
        (
            SigningKernel::CommitmentHash,
            MlDsaSigningWorkloadV1::CommitmentHash,
        ),
        (
            SigningKernel::ResponseCheck,
            MlDsaSigningWorkloadV1::ResponseCheck,
        ),
        (
            SigningKernel::RowCheckAndHints,
            MlDsaSigningWorkloadV1::RowCheckAndHints,
        ),
        (
            SigningKernel::AggregateCheck,
            MlDsaSigningWorkloadV1::AggregateCheck,
        ),
    ] {
        let circuit = compile_ml_dsa_private_signing_circuit_v1(workload);
        identities.push(save_schedule(
            directory,
            kernel,
            circuit.canonical_schedule_encoding(),
            circuit.metrics().and_gate_count(),
        )?);
    }
    Ok(identities)
}

fn save_schedule(
    directory: &Path,
    kernel: SigningKernel,
    bytes: &[u8],
    and_gates: u64,
) -> InvestigationResult<Value> {
    let digest_bytes: [u8; 32] = Sha256::digest(bytes).into();
    TrustedMlDsaSchedule::parse(bytes, digest_bytes)?;
    fs::write(directory.join(format!("{}.bin", kernel.name())), bytes)?;
    Ok(
        json!({"kernel": kernel.name(), "schedule_bytes": bytes.len(), "schedule_sha256": hex::encode(digest_bytes), "and_gates": and_gates, "table_bytes": and_gates * 32}),
    )
}

pub(super) fn run_case(
    schedules: &Path,
    own_a: &Path,
    own_b: &Path,
    public_key: &Path,
    case_name: &str,
    engine: Engine,
) -> InvestigationResult<Value> {
    let operation = Operation {
        operation_id: fresh_operation_id()?,
        engine,
        message: reference::public_message(),
        context: match case_name {
            "incrementing" | "alternating" => reference::CONTEXTS[1].to_vec(),
            _ => Vec::new(),
        },
        randomness: match case_name {
            "all-ff" | "alternating" => Randomness::JointRandom,
            _ => Randomness::Deterministic,
        },
    };
    run_operation(schedules, own_a, own_b, public_key, operation)
}

pub(super) fn run_operation(
    schedules: &Path,
    own_a: &Path,
    own_b: &Path,
    public_key: &Path,
    operation: Operation,
) -> InvestigationResult<Value> {
    let directory = tempfile::tempdir()?;
    let operation_path = directory.path().join("public-operation.json");
    fs::write(&operation_path, serde_json::to_vec(&operation)?)?;
    let result_a = directory.path().join("public-result-a.json");
    let result_b = directory.path().join("public-result-b.json");
    let started = Instant::now();
    private_execution::run_duplex_children(
        &[
            OsStr::new("private-signing-role-a"),
            schedules.as_os_str(),
            own_a.as_os_str(),
            public_key.as_os_str(),
            operation_path.as_os_str(),
            result_a.as_os_str(),
        ],
        &[
            OsStr::new("private-signing-role-b"),
            schedules.as_os_str(),
            own_b.as_os_str(),
            public_key.as_os_str(),
            operation_path.as_os_str(),
            result_b.as_os_str(),
        ],
    )?;
    let process_pair_wall_ns = started.elapsed().as_nanos();
    let a: Value = serde_json::from_slice(&fs::read(result_a)?)?;
    let b: Value = serde_json::from_slice(&fs::read(result_b)?)?;
    require(
        a["signature_hex"] == b["signature_hex"]
            && a["attempts"] == b["attempts"]
            && a["circuits"] == b["circuits"]
            && a["challenge_hashes_hex"] == b["challenge_hashes_hex"],
        "Signing roles returned different public results or runtime counters.",
    )?;
    let circuits = a["circuits"]
        .as_array()
        .ok_or("Missing signing circuit counters.")?;
    let mut bindings = HashSet::new();
    for circuit in circuits {
        require(
            bindings.insert(
                circuit["execution_binding_sha256"]
                    .as_str()
                    .ok_or("Missing signing binding.")?,
            ),
            "Threshold signing reused a circuit execution binding.",
        )?;
    }
    let signature = hex::decode(
        a["signature_hex"]
            .as_str()
            .ok_or("Missing threshold signature.")?,
    )?;
    let public = fs::read(public_key)?;
    let verification = reference::verify_threshold_signature(
        &public,
        &operation.message,
        &operation.context,
        &signature,
    )?;
    let missing_a = check_missing_peer(
        SigningRole::B,
        schedules,
        own_b,
        public_key,
        &operation_path,
        directory.path(),
    )?;
    let missing_b = check_missing_peer(
        SigningRole::A,
        schedules,
        own_a,
        public_key,
        &operation_path,
        directory.path(),
    )?;
    Ok(json!({
        "scope": "Two separate role processes sign before authorized test recovery. Neither role reads peer material or reconstructs a seed or expanded key.",
        "production_eligible": false,
        "randomness": operation.randomness,
        "operation_id_hex": hex::encode(operation.operation_id),
        "message_hex": hex::encode(operation.message),
        "context_hex": hex::encode(&operation.context),
        "signature_hex": hex::encode(&signature),
        "signature_sha256": digest(&signature),
        "signature_bytes": signature.len(),
        "process_pair_wall_ns_including_schedule_reads_and_independent_role_verification": process_pair_wall_ns,
        "independent_verification": verification,
        "missing_a_fails_without_signature": missing_a,
        "missing_b_fails_without_signature": missing_b,
        "fresh_execution_bindings": bindings.len(),
        "role_a": a,
        "role_b": b,
        "security_limits": [
            "Public rejected challenge hashes rely on the proposed random-oracle composition. A complete security proof and independent cryptographic review remain open.",
            "Rejected w1, masks, z, low coefficients, hints, and individual validity checks remain shared. Only aggregate acceptance and retry count become public.",
            "Shared-host files and processes provide no operating-system isolation or production admission claim.",
            "The linear arithmetic has no target-specific constant-time qualification. Classical OT provides no post-quantum transcript confidentiality claim."
        ],
    }))
}

fn check_missing_peer(
    role: SigningRole,
    schedules: &Path,
    own: &Path,
    public_key: &Path,
    operation: &Path,
    directory: &Path,
) -> InvestigationResult<bool> {
    let name = role_argument(role);
    let result = directory.join(format!("{name}-missing-peer-result.json"));
    let output = Command::new(env::current_exe()?)
        .args([
            OsStr::new(name),
            schedules.as_os_str(),
            own.as_os_str(),
            public_key.as_os_str(),
            operation.as_os_str(),
            result.as_os_str(),
        ])
        .output()?;
    require(
        !output.status.success() && !result.exists(),
        "A signing role produced a result without its peer.",
    )?;
    Ok(true)
}

fn role_argument(role: SigningRole) -> &'static str {
    match role {
        SigningRole::A => "private-signing-role-a",
        SigningRole::B => "private-signing-role-b",
    }
}

fn run_role(
    execution: RoleExecution,
    schedules: &Path,
    own_material: &Path,
    public_key_path: &Path,
    operation_path: &Path,
    result_path: &Path,
) -> InvestigationResult<()> {
    let role = execution.role();
    let started = Instant::now();
    let public_key: [u8; PUBLIC_KEY_BYTES] = fs::read(public_key_path)?
        .try_into()
        .map_err(|_| "Signing public key has the wrong size.")?;
    let material = match crate::material_storage_evidence::open(own_material, role, &public_key) {
        Ok(material) => material,
        Err(error) => {
            fs::write(
                result_path.with_extension("failure.json"),
                serde_json::to_vec(&json!({
                    "error": "MaterialOpen",
                    "completed_private_circuits": 0,
                    "non_circuit_sent_bytes": 0,
                    "non_circuit_received_bytes": 0,
                }))?,
            )?;
            return Err(error);
        }
    };
    let own = OwnSigningShare::parse(&material)?;
    drop(material);
    let operation: Operation = serde_json::from_slice(&fs::read(operation_path)?)?;
    require(
        matches!(execution, RoleExecution::Complete(_))
            || matches!(operation.engine, Engine::HalfGates),
        "Fault-injection commands require the half-gates engine.",
    )?;
    let mut artifact_bytes = Vec::with_capacity(SigningKernel::ALL.len());
    for kernel in SigningKernel::ALL {
        artifact_bytes.push(fs::read(schedules.join(format!("{}.bin", kernel.name())))?);
    }
    let mut trusted = Vec::with_capacity(artifact_bytes.len());
    for bytes in &artifact_bytes {
        trusted.push(TrustedMlDsaSchedule::parse(
            bytes,
            Sha256::digest(bytes).into(),
        )?);
    }
    let schedule_preparation_wall_ns = started.elapsed().as_nanos();
    let mut current = begin_signing(
        role,
        own,
        &public_key,
        &operation.message,
        &operation.context,
        operation.randomness.mode(),
        &operation.operation_id,
    )?;
    let mut reader = io::stdin().lock();
    let mut writer = io::stdout().lock();
    let mut circuit_wall_ns = Vec::new();
    let mut observations = Vec::new();
    let mut final_message_bytes = (0, 0);
    let mut fault = execution.wire_fault(result_path);
    let signature = loop {
        current = match current {
            SigningStep::Circuit(request) => {
                let kernel = request.kernel();
                let schedule = trusted
                    .iter()
                    .find(|entry| entry.circuit_id() == kernel.circuit_id())
                    .ok_or("Missing signing schedule.")?;
                let circuit_started = Instant::now();
                fault.start_kernel(kernel);
                let (next, observation) = match operation.engine.boolean() {
                    None => {
                        let (output, observation) = drive_runtime(
                            request.begin(schedule)?,
                            &mut reader,
                            &mut writer,
                            &mut fault,
                        )?;
                        (request.accept(output)?, observation)
                    }
                    Some(engine) => {
                        let mut transport = PipeTransport::new(&mut reader, &mut writer);
                        let next =
                            run_ready(request.run_boolean(engine, schedule, &mut transport))??;
                        (next, transport.finish())
                    }
                };
                observations.push(observation);
                circuit_wall_ns.push(circuit_started.elapsed().as_nanos());
                execution.after_kernel(kernel, result_path)?;
                next
            }
            SigningStep::Send(send) => {
                writer.write_all(send.bytes())?;
                writer.flush()?;
                final_message_bytes.0 += send.bytes().len();
                send.resume()?
            }
            SigningStep::Receive(receive) => {
                let mut bytes = Zeroizing::new(vec![0; receive.expected_bytes()]);
                reader.read_exact(&mut bytes)?;
                final_message_bytes.1 += bytes.len();
                match receive.accept(&bytes) {
                    Ok(next) => next,
                    Err(error) => {
                        fs::write(
                            result_path.with_extension("failure.json"),
                            serde_json::to_vec(&json!({
                                "error": format!("{error:?}"),
                                "completed_private_circuits": observations.len(),
                                "non_circuit_sent_bytes": final_message_bytes.0,
                                "non_circuit_received_bytes": final_message_bytes.1,
                            }))?,
                        )?;
                        return Err(error.into());
                    }
                }
            }
            SigningStep::Complete(signature) => break signature,
        };
    };
    let role_protocol_wall_ns = started.elapsed().as_nanos();
    require(
        reference::verify_signature_rustcrypto(
            &public_key,
            &operation.message,
            &operation.context,
            &signature.signature,
        )?,
        "A role rejected the final standard threshold signature.",
    )?;
    fs::write(
        result_path,
        serde_json::to_vec(&encode_result(
            role,
            &signature,
            circuit_wall_ns,
            observations,
            final_message_bytes,
            schedule_preparation_wall_ns,
            role_protocol_wall_ns,
        )?)?,
    )?;
    Ok(())
}

pub(super) fn drive_runtime<R: Read, W: Write>(
    mut current: Step<'_>,
    reader: &mut R,
    writer: &mut W,
    fault: &mut WireFault,
) -> InvestigationResult<(RuntimeOutput, Value)> {
    let mut sent = 0;
    let mut received = 0;
    loop {
        current = match current {
            Step::Send(send) => {
                fault.write_message(send.kind(), send.bytes(), writer)?;
                writer.flush()?;
                sent += send.bytes().len();
                send.resume()?
            }
            Step::Receive(receive) => {
                let mut bytes = Zeroizing::new(vec![0; receive.expected_bytes()]);
                reader.read_exact(&mut bytes)?;
                received += bytes.len();
                receive.accept(&bytes)?
            }
            Step::Complete(output) => {
                return Ok((
                    output,
                    json!({"actual_pipe_sent_bytes": sent, "actual_pipe_received_bytes": received}),
                ));
            }
        };
    }
}

fn encode_result(
    role: SigningRole,
    signature: &ThresholdSignature,
    circuit_wall_ns: Vec<u128>,
    observations: Vec<Value>,
    final_message_bytes: (usize, usize),
    preparation_wall_ns: u128,
    protocol_wall_ns: u128,
) -> InvestigationResult<Value> {
    let mut circuits = Vec::with_capacity(signature.metrics.circuits.len());
    let mut table_bytes = 0;
    let binding_bytes = signature.metrics.binding_bytes_per_direction;
    let mut a_to_b = signature.metrics.accepted_share_bytes + binding_bytes;
    let mut b_to_a = signature.metrics.signature_return_bytes + binding_bytes;
    let expected_final_bytes = match role {
        SigningRole::A => (a_to_b, b_to_a),
        SigningRole::B => (b_to_a, a_to_b),
    };
    require(
        final_message_bytes == expected_final_bytes,
        "Signing binding and final messages disagree with actual pipe traffic.",
    )?;
    require(
        signature.metrics.circuits.len() == observations.len(),
        "Signing measurements lost a circuit observation.",
    )?;
    for ((kernel, metrics), observation) in signature.metrics.circuits.iter().zip(&observations) {
        if let ml_dsa_threshold::signing::CircuitMetrics::HalfGates(metrics) = metrics {
            table_bytes += metrics.table_bytes;
        }
        let mut metrics = complete_engine_evidence::encode_metrics(metrics, role);
        complete_engine_evidence::verify_observation(&metrics, observation, role)?;
        a_to_b += metrics["a_to_b_wire_bytes"]
            .as_u64()
            .ok_or("Missing A-to-B counter.")? as usize;
        b_to_a += metrics["b_to_a_wire_bytes"]
            .as_u64()
            .ok_or("Missing B-to-A counter.")? as usize;
        metrics["kernel"] = json!(kernel.name());
        circuits.push(metrics);
    }
    Ok(json!({
        "role": role_argument(role),
        "signature_hex": hex::encode(signature.signature),
        "attempts": signature.attempts,
        "retry_count": signature.attempts - 1,
        "challenge_hashes_hex": signature.metrics.challenge_hashes.iter().map(hex::encode).collect::<Vec<_>>(),
        "table_bytes": table_bytes,
        "a_to_b_wire_bytes": a_to_b,
        "b_to_a_wire_bytes": b_to_a,
        "accepted_share_bytes": signature.metrics.accepted_share_bytes,
        "binding_bytes_per_direction": binding_bytes,
        "signature_return_bytes": signature.metrics.signature_return_bytes,
        "circuits": circuits,
        "circuit_wall_ns": circuit_wall_ns,
        "circuit_observations": observations,
        "binding_and_final_message_observation": {"actual_pipe_sent_bytes": final_message_bytes.0, "actual_pipe_received_bytes": final_message_bytes.1},
        "schedule_preparation_wall_ns": preparation_wall_ns,
        "role_protocol_wall_ns_before_independent_verification": protocol_wall_ns,
        "ordinary_rustcrypto_verification": true,
    }))
}

pub(super) fn compare_authorized_reference(
    key: &SigningKey<MlDsa65>,
    public_report: &Value,
) -> InvestigationResult<Value> {
    let signature = hex::decode(
        public_report["signature_hex"]
            .as_str()
            .ok_or("Missing recovery comparison signature.")?,
    )?;
    let message = hex::decode(
        public_report["message_hex"]
            .as_str()
            .ok_or("Missing recovery comparison message.")?,
    )?;
    let context = hex::decode(
        public_report["context_hex"]
            .as_str()
            .ok_or("Missing recovery comparison context.")?,
    )?;
    match public_report["randomness"].as_str() {
        Some("deterministic") => {
            let expected = key
                .expanded_key()
                .sign_deterministic(&message, &context)?
                .encode();
            require(
                signature == expected.as_slice(),
                "Threshold deterministic signature differs from the authorized ordinary reference.",
            )?;
            Ok(
                json!({"mode": "deterministic", "exact_reference_bytes_match": true, "reference_signature_sha256": digest(expected.as_slice())}),
            )
        }
        Some("joint-random") => Ok(
            json!({"mode": "joint-random", "standard_signature_verified": true, "byte_equality_requirement": "Hedged signing has no equality requirement with deterministic reference bytes."}),
        ),
        _ => Err("Invalid public signing randomness mode.".into()),
    }
}
