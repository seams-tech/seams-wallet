//! Persistent role-process key generation for disposable investigation keys.
//!
//! The parent handles public schedules and results. Each role retains its own
//! seed, K, and lattice shares. A separate authorized recipient reconstructs
//! the test seed only after both roles finish. Shared-host files provide no
//! operating-system isolation or production export authorization.

use crate::boolean_engine_evidence::{PipeTransport, run_ready};
use crate::complete_engine_evidence::{self, Engine};
use crate::custody_delivery_evidence::WalletRecoveryCase;
use crate::material_storage_evidence::{self, MATERIAL_FILENAME};
use crate::{
    InvestigationResult, circuit_evidence::reference_shake256, digest, hybrid_keygen,
    private_execution, private_signing, reference, require,
};
use ed25519_yao::{
    ml_dsa_runtime::TrustedMlDsaSchedule,
    ml_dsa_signing::{
        SigningRole,
        keygen::{KeygenKernel, KeygenStep, begin_keygen},
    },
};
use ed25519_yao_generator::{
    MlDsaPrivateKeygenCircuitV1, MlDsaSamplingPrefixV1, compile_ml_dsa_private_seed_circuit_v1,
    compile_ml_dsa_public_sampling_circuit_v1,
};
use ml_dsa::{Keypair, MlDsa65, SigningKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use signer_core::ml_dsa_custody::{
    MlDsaCeremonyBindingV1, MlDsaRoleReplyV1, MlDsaRoleV1, SealedMlDsaRoleInputV1,
    SealedMlDsaRoleResultV1, open_ml_dsa_role_input_v1,
};
use std::{
    env,
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    process::Command,
    time::Instant,
};
use wallet_custody_ceremony::ceremony::ml_dsa::MlDsaCeremonyPreparedV1;
use zeroize::{Zeroize, Zeroizing};

const MODULUS: u32 = 8_380_417;
const COEFFICIENTS: usize = 256;
const SECRET_POLYNOMIALS: usize = 11;
const ROWS: usize = 6;
const MATERIAL_BYTES: usize = 17_472;
const FIXTURE_NAMES: [&str; 4] = ["zero", "incrementing", "all-ff", "alternating"];

struct AuthorizedTestMaterial {
    seed: Zeroizing<[u8; 32]>,
    k: Zeroizing<[u8; 32]>,
    samples: Zeroizing<hybrid_keygen::SecretVector>,
    t0: Zeroizing<[hybrid_keygen::Polynomial; ROWS]>,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum SeedInput {
    FixedPublicShare {
        share: [u8; 32],
    },
    JointRandom,
    SealedWalletOwnerRoot {
        binding: MlDsaCeremonyBindingV1,
        sealed_input: SealedMlDsaRoleInputV1,
        holder_secret: [u8; 32],
    },
}

impl Drop for SeedInput {
    fn drop(&mut self) {
        if let Self::FixedPublicShare { share }
        | Self::SealedWalletOwnerRoot {
            holder_secret: share,
            ..
        } = self
        {
            share.zeroize();
        }
    }
}

#[derive(Clone, Copy)]
enum Role {
    A,
    B,
}

#[derive(Clone, Copy)]
pub(super) enum Campaign<'a> {
    CoreEvidence,
    EngineComparison(Engine),
    NearTestnet(&'a Path),
    WalletRecovery(&'a WalletRecoveryCase<'a>),
}

impl Campaign<'_> {
    const fn engine(self) -> Engine {
        match self {
            Self::CoreEvidence | Self::NearTestnet(_) | Self::WalletRecovery(_) => {
                Engine::HalfGates
            }
            Self::EngineComparison(engine) => engine,
        }
    }
}

impl Role {
    const fn argument(self) -> &'static str {
        match self {
            Self::A => "private-keygen-role-a",
            Self::B => "private-keygen-role-b",
        }
    }
}

pub(super) fn try_run_child() -> InvestigationResult<bool> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let Some(mode) = arguments.first() else {
        return Ok(false);
    };
    match mode.as_str() {
        "private-keygen-role-a" | "private-keygen-role-b" => {
            require(
                arguments.len() == 5,
                "Key generation role needs schedule, input, public result paths, and engine.",
            )?;
            let role = if mode == Role::A.argument() {
                Role::A
            } else {
                Role::B
            };
            run_role(
                role,
                Path::new(&arguments[1]),
                Path::new(&arguments[2]),
                Path::new(&arguments[3]),
                Engine::parse(&arguments[4])?,
            )?;
        }
        "private-keygen-authorized-test-recipient" => {
            require(
                arguments.len() == 6,
                "Test recipient needs two material paths, a public key, a public signing report, and a public result path.",
            )?;
            run_authorized_recipient(
                Path::new(&arguments[1]),
                Path::new(&arguments[2]),
                Path::new(&arguments[3]),
                Path::new(&arguments[4]),
                Path::new(&arguments[5]),
            )?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

pub(super) fn run() -> InvestigationResult<Value> {
    let started = Instant::now();
    let schedules = tempfile::tempdir()?;
    let compile_started = Instant::now();
    let identities = compile_schedules(schedules.path())?;
    let signing_identities = private_signing::compile_schedules(schedules.path())?;
    let compile_wall_ns = compile_started.elapsed().as_nanos();
    let mut cases = Vec::with_capacity(FIXTURE_NAMES.len() + 1);
    for name in FIXTURE_NAMES {
        cases.push(run_case(
            schedules.path(),
            Some(name),
            Campaign::CoreEvidence,
        )?);
    }
    cases.push(run_case(schedules.path(), None, Campaign::CoreEvidence)?);
    Ok(json!({
        "scope": "Two persistent passive role processes execute private seed expansion, adaptive public-decision samplers, and public Power2Round over disposable test keys.",
        "production_eligible": false,
        "security_limits": [
            "This is a shared-host benchmark. File permissions and process separation provide no operating-system isolation claim.",
            "The parent passes each role only public schedule paths, its own seed input path, and its public result path. The normal parent never reads private material files.",
            "An explicitly separate authorized test recipient reconstructs the seed after threshold signing and then creates the ordinary private key. Every test seed becomes public in this artifact.",
            "The kernels use genuine passive OT and fresh execution domains. Composition privacy remains subject to review.",
            "Local arithmetic has no native constant-time guarantee. Transport authentication, production admission, durable storage, and recipient authorization remain unimplemented.",
            "A bounded sampler failure stops both roles on the same public success bit. Temporary outputs are destroyed. The investigation never changes the canonical seed or retries a different seed.",
            "Host pipes and host wall times do not measure Cloudflare bandwidth, CPU charges, or deployed latency."
        ],
        "implementation_source_sha256": digest(&fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/src/private_keygen.rs"))?),
        "schedule_compile_wall_ns": compile_wall_ns,
        "compiled_unique_schedules": 4,
        "executed_kernels_per_case": "12 normally, up to 34 with same-seed continuation",
        "schedule_identities": identities,
        "signing_schedule_identities": signing_identities,
        "material_shape_per_role": {"bytes": MATERIAL_BYTES, "seed_xor_share_bytes": 32, "k_xor_share_bytes": 32, "s1_s2_additive_residues": SECRET_POLYNOMIALS * COEFFICIENTS, "t0_additive_residues": ROWS * COEFFICIENTS, "residue_encoding": "u32 little-endian, reduced modulo 8380417", "persistence": "HPKE-authenticated role-local ciphertext. Separate disposable wrapping key and public context files. All files are deleted with the case temporary directory."},
        "cases": cases,
        "total_wall_ns_including_compile_processes_and_authorized_recovery": started.elapsed().as_nanos(),
    }))
}

pub(super) fn compile_schedules(directory: &Path) -> InvestigationResult<Vec<Value>> {
    let mut identities = Vec::with_capacity(4);
    let started = Instant::now();
    let seed = compile_ml_dsa_private_seed_circuit_v1();
    identities.push(save_schedule(
        directory,
        "seed.bin",
        "seed-expansion",
        &seed,
        started,
    )?);
    drop(seed);
    for (prefix, name) in [
        (MlDsaSamplingPrefixV1::TwoBlocks, "sampling-two-blocks"),
        (MlDsaSamplingPrefixV1::ThreeBlocks, "sampling-three-blocks"),
        (MlDsaSamplingPrefixV1::FinalBound, "sampling-final-bound"),
    ] {
        let started = Instant::now();
        let circuit = compile_ml_dsa_public_sampling_circuit_v1(prefix);
        identities.push(save_schedule(
            directory,
            &format!("{name}.bin"),
            name,
            &circuit,
            started,
        )?);
    }
    Ok(identities)
}

pub(super) fn save_schedule(
    directory: &Path,
    filename: &str,
    component: &str,
    circuit: &MlDsaPrivateKeygenCircuitV1,
    started: Instant,
) -> InvestigationResult<Value> {
    let bytes = circuit.canonical_schedule_encoding();
    let parsed = TrustedMlDsaSchedule::parse(bytes, Sha256::digest(bytes).into())?;
    fs::write(directory.join(filename), bytes)?;
    Ok(json!({
        "component": component,
        "schedule_filename": filename,
        "schedule_bytes": bytes.len(),
        "and_gates": circuit.metrics().and_gate_count(),
        "half_gate_table_bytes": circuit.metrics().and_gate_count() * 32,
        "garbler_input_bits": parsed.garbler_input_bits(),
        "evaluator_input_bits": parsed.evaluator_input_bits(),
        "public_output_bytes": parsed.public_output_bytes(),
        "component_sha256": hex::encode(circuit.benchmark_component_digest().expose_public_bytes()),
        "schedule_sha256": hex::encode(circuit.benchmark_schedule_digest().expose_public_bytes()),
        "compile_parse_and_cache_wall_ns": started.elapsed().as_nanos(),
    }))
}

pub(super) fn run_case(
    schedules: &Path,
    fixture: Option<&str>,
    campaign: Campaign<'_>,
) -> InvestigationResult<Value> {
    let engine = campaign.engine();
    let (case_name, seed_generation) = match (campaign, fixture) {
        (Campaign::WalletRecovery(_), Some(name)) => (
            name,
            "Public wallet fixture opened inside the custody ceremony. Encrypted role inputs carry fresh owner-root shares.",
        ),
        (Campaign::WalletRecovery(_), None) => (
            "fresh-wallet-custody",
            "The custody ceremony generates a fresh wallet seed. Only encrypted owner-root shares leave it before authorized test recovery.",
        ),
        (_, Some(name)) => (
            name,
            "Known public canonical seed, split with a fresh random XOR mask before role launch.",
        ),
        (_, None) => (
            "joint-random-disposable-key",
            "Each role independently generates one OS-random 32-byte coin. The parent receives no full canonical seed before authorized test export.",
        ),
    };
    let case = tempfile::tempdir()?;
    let role_a = case.path().join("role-a");
    let role_b = case.path().join("role-b");
    for path in [&role_a, &role_b] {
        fs::create_dir(path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    let input_a = role_a.join("own-seed-input.json");
    let input_b = role_b.join("own-seed-input.json");
    let client = write_seed_inputs(fixture, campaign, &input_a, &input_b)?;
    let result_a = role_a.join("public-result.json");
    let result_b = role_b.join("public-result.json");
    let started = Instant::now();
    private_execution::run_duplex_children(
        &[
            OsStr::new(Role::A.argument()),
            schedules.as_os_str(),
            input_a.as_os_str(),
            result_a.as_os_str(),
            OsStr::new(engine.name()),
        ],
        &[
            OsStr::new(Role::B.argument()),
            schedules.as_os_str(),
            input_b.as_os_str(),
            result_b.as_os_str(),
            OsStr::new(engine.name()),
        ],
    )?;
    let keygen_process_wall_ns = started.elapsed().as_nanos();
    let a: Value = serde_json::from_slice(&fs::read(&result_a)?)?;
    let b: Value = serde_json::from_slice(&fs::read(&result_b)?)?;
    require(
        a["public_key_hex"] == b["public_key_hex"],
        "Persistent roles returned different public keys.",
    )?;
    verify_public_metrics(&a, &b)?;
    require(
        a["wallet_seed_stage"]["metrics"] == b["wallet_seed_stage"]["metrics"],
        "Wallet-seed role counters or bindings disagree.",
    )?;
    if matches!(campaign, Campaign::WalletRecovery(_)) {
        require(
            a["wallet_seed_stage"].is_object() && b["wallet_seed_stage"].is_object(),
            "Wallet recovery requires the private derivation stage.",
        )?;
    }
    let public_key = hex::decode(a["public_key_hex"].as_str().ok_or("Missing public key.")?)?;
    let client_completion = match client {
        KeygenClient::Canonical => Value::Null,
        KeygenClient::Wallet(client) => {
            let sealed_a: SealedMlDsaRoleResultV1 =
                serde_json::from_value(a["sealed_keygen_result"].clone())?;
            let sealed_b: SealedMlDsaRoleResultV1 =
                serde_json::from_value(b["sealed_keygen_result"].clone())?;
            let verified = client
                .complete(&sealed_a, &sealed_b)
                .map_err(|error| error.message().to_string())?;
            require(
                verified.key().public_key().as_slice() == public_key,
                "Authenticated holder result differs from the public key.",
            )?;
            let mut completion = json!({"holder_replies_authenticated": true, "key_set": verified.key().manifest().key_set().as_str(), "manifest_digest_hex": hex::encode(verified.key().manifest().digest()), "material_epoch": verified.key().binding().material_epoch()});
            let recovering = matches!(campaign, Campaign::WalletRecovery(case) if matches!(case.continuity, signer_core::ml_dsa_custody::MlDsaKeyContinuityV1::Recover { .. }));
            completion["custody_commit"] = crate::custody_delivery_evidence::finish_ceremony(
                verified,
                recovering,
                fixture.is_none(),
            )?;
            completion
        }
    };
    let public_path = case.path().join("public-key.bin");
    fs::write(&public_path, &public_key)?;
    let threshold_signing = private_signing::run_case(
        schedules,
        &role_a.join(MATERIAL_FILENAME),
        &role_b.join(MATERIAL_FILENAME),
        &public_path,
        case_name,
        engine,
    )?;
    let lifecycle = match (campaign, fixture) {
        (Campaign::CoreEvidence, Some("zero")) => crate::signing_lifecycle_evidence::run(
            schedules,
            &role_a.join(MATERIAL_FILENAME),
            &role_b.join(MATERIAL_FILENAME),
            &public_path,
        )?,
        _ => serde_json::Value::Null,
    };
    let near_transaction = match (campaign, fixture) {
        (Campaign::CoreEvidence, Some("zero")) => crate::near_transaction_evidence::run(
            schedules,
            &role_a.join(MATERIAL_FILENAME),
            &role_b.join(MATERIAL_FILENAME),
            &public_path,
        )?,
        _ => serde_json::Value::Null,
    };
    let signing_path = case.path().join("public-threshold-signing.json");
    let testnet_transaction = match campaign {
        Campaign::NearTestnet(request) => crate::near_testnet_evidence::sign(
            request,
            schedules,
            &role_a.join(MATERIAL_FILENAME),
            &role_b.join(MATERIAL_FILENAME),
            &public_path,
        )?,
        _ => serde_json::Value::Null,
    };
    fs::write(&signing_path, serde_json::to_vec(&threshold_signing)?)?;
    eprintln!(
        "Verified threshold signature for {} in {} attempts.",
        case_name, threshold_signing["role_a"]["attempts"]
    );
    let recipient_result = case.path().join("authorized-test-recipient-result.json");
    let started = Instant::now();
    let recipient = Command::new(env::current_exe()?)
        .arg("private-keygen-authorized-test-recipient")
        .arg(role_a.join(MATERIAL_FILENAME))
        .arg(role_b.join(MATERIAL_FILENAME))
        .arg(&public_path)
        .arg(&signing_path)
        .arg(&recipient_result)
        .output()?;
    require(
        recipient.status.success(),
        &format!(
            "Authorized test recovery failed: {}",
            String::from_utf8_lossy(&recipient.stderr)
        ),
    )?;
    let recipient_process_wall_ns = started.elapsed().as_nanos();
    let recovered: Value = serde_json::from_slice(&fs::read(&recipient_result)?)?;
    let custody_export = if matches!(campaign, Campaign::WalletRecovery(_)) {
        crate::custody_delivery_evidence::verify_custody_export(
            &client_completion,
            &recovered,
            fixture,
        )?
    } else {
        Value::Null
    };
    if let Some(name) = fixture {
        require(
            recovered["public_test_seed_hex"]
                == hex::encode(match campaign {
                    Campaign::WalletRecovery(case) => {
                        crate::wallet_recovery_evidence::canonical_seed(
                            name,
                            &case.application_binding()?,
                        )?
                    }
                    _ => reference::fixture_bytes(name, 32)?,
                }),
            "Authorized recovery returned the wrong public fixture seed.",
        )?;
    }
    let case_path = case.path().to_owned();
    case.close()?;
    require(
        !case_path.exists(),
        "Disposable role files survived cleanup.",
    )?;
    Ok(json!({
        "temporary_role_files_removed": true,
        "case": case_name,
        "client_completion": client_completion,
        "custody_export_verification": custody_export,
        "wallet_seed_derivation": matches!(campaign, Campaign::WalletRecovery(_)),
        "seed_generation": seed_generation,
        "public_key_bytes": public_key.len(),
        "public_key_sha256": digest(&public_key),
        "keygen_process_wall_ns_including_schedule_reads_and_startup": keygen_process_wall_ns,
        "authorized_recipient_process_wall_ns": recipient_process_wall_ns,
        "role_a": a,
        "role_b": b,
        "threshold_signing": threshold_signing,
        "host_signing_lifecycle": lifecycle,
        "offline_sdk_near_transaction": near_transaction,
        "testnet_transaction": testnet_transaction,
        "authorized_test_recipient": recovered,
    }))
}

enum KeygenClient {
    Canonical,
    Wallet(Box<MlDsaCeremonyPreparedV1>),
}

fn write_seed_inputs(
    fixture: Option<&str>,
    campaign: Campaign<'_>,
    a: &Path,
    b: &Path,
) -> InvestigationResult<KeygenClient> {
    if let Campaign::WalletRecovery(case) = campaign {
        let (client, holder_secrets) =
            crate::custody_delivery_evidence::prepare_delivery(fixture, case)?;
        for (role, path, secret) in [
            (MlDsaRoleV1::A, a, &holder_secrets[0]),
            (MlDsaRoleV1::B, b, &holder_secrets[1]),
        ] {
            let input = SeedInput::SealedWalletOwnerRoot {
                binding: client.binding().clone(),
                sealed_input: client.input(role).clone(),
                holder_secret: *secret,
            };
            write_private_file(path, &Zeroizing::new(serde_json::to_vec(&input)?))?;
        }
        return Ok(KeygenClient::Wallet(Box::new(client)));
    }
    let (input_a, input_b) = match fixture {
        Some(name) => {
            let seed = reference::fixture_bytes(name, 32)?;
            let mut share_a = [0; 32];
            getrandom::getrandom(&mut share_a)?;
            let mut share_b = [0; 32];
            for index in 0..32 {
                share_b[index] = seed[index] ^ share_a[index];
            }
            (
                SeedInput::FixedPublicShare { share: share_a },
                SeedInput::FixedPublicShare { share: share_b },
            )
        }
        None => (SeedInput::JointRandom, SeedInput::JointRandom),
    };
    write_private_file(a, &Zeroizing::new(serde_json::to_vec(&input_a)?))?;
    write_private_file(b, &Zeroizing::new(serde_json::to_vec(&input_b)?))?;
    Ok(KeygenClient::Canonical)
}

enum RoleCompletion {
    Canonical,
    Wallet {
        reply: MlDsaRoleReplyV1,
        holder_secret: Zeroizing<[u8; 32]>,
    },
}

pub(super) fn write_private_file(path: &Path, bytes: &[u8]) -> InvestigationResult<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    Ok(())
}

fn run_role(
    role: Role,
    schedules: &Path,
    input: &Path,
    result: &Path,
    engine: Engine,
) -> InvestigationResult<()> {
    let started = Instant::now();
    let input_bytes = Zeroizing::new(fs::read(input)?);
    let input: SeedInput = serde_json::from_slice(&input_bytes)?;
    let role = match role {
        Role::A => SigningRole::A,
        Role::B => SigningRole::B,
    };
    let mut artifacts = Vec::with_capacity(KeygenKernel::ALL.len());
    for kernel in KeygenKernel::ALL {
        artifacts.push(fs::read(schedules.join(format!("{}.bin", kernel.name())))?);
    }
    let mut trusted = Vec::with_capacity(artifacts.len());
    for bytes in &artifacts {
        trusted.push(TrustedMlDsaSchedule::parse(
            bytes,
            Sha256::digest(bytes).into(),
        )?);
    }
    let schedule_preparation_wall_ns = started.elapsed().as_nanos();
    let mut reader = io::stdin().lock();
    let mut writer = io::stdout().lock();
    let (mut current, wallet_seed_stage, completion) = match &input {
        SeedInput::FixedPublicShare { share } => (
            begin_keygen(role, share)?,
            Value::Null,
            RoleCompletion::Canonical,
        ),
        SeedInput::JointRandom => {
            let mut seed = Zeroizing::new([0; 32]);
            getrandom::getrandom(seed.as_mut())?;
            (
                begin_keygen(role, &seed)?,
                Value::Null,
                RoleCompletion::Canonical,
            )
        }
        SeedInput::SealedWalletOwnerRoot {
            binding,
            sealed_input,
            holder_secret,
        } => {
            require(
                engine.boolean().is_none(),
                "Wallet derivation uses the selected half-gates engine.",
            )?;
            let holder_role = match role {
                SigningRole::A => MlDsaRoleV1::A,
                SigningRole::B => MlDsaRoleV1::B,
            };
            let opened =
                open_ml_dsa_role_input_v1(sealed_input, binding, holder_role, holder_secret)?;
            let (root_share, reply) = opened.into_parts();
            let (next, stage) = crate::wallet_recovery_evidence::begin_role(
                role,
                &root_share,
                schedules,
                &mut reader,
                &mut writer,
            )?;
            (
                next,
                stage,
                RoleCompletion::Wallet {
                    reply,
                    holder_secret: Zeroizing::new(*holder_secret),
                },
            )
        }
    };
    let storage_binding = match &input {
        SeedInput::SealedWalletOwnerRoot { binding, .. } => binding.clone(),
        SeedInput::FixedPublicShare { .. } | SeedInput::JointRandom => {
            material_storage_evidence::canonical_fixture_binding()?
        }
    };
    drop(input);
    drop(input_bytes);
    let mut circuit_wall_ns = Vec::with_capacity(12);
    let mut observations = Vec::with_capacity(12);
    let mut public_t_exchange = Value::Null;
    let output = loop {
        current = match current {
            KeygenStep::Circuit(request) => {
                let kernel = request.kernel();
                let schedule = trusted
                    .iter()
                    .find(|entry| entry.circuit_id() == kernel.circuit_id())
                    .ok_or("Missing canonical key-generation schedule.")?;
                let circuit_started = Instant::now();
                let (next, observation) = match engine.boolean() {
                    None => {
                        let (output, observation) = private_signing::drive_runtime(
                            request.begin(schedule)?,
                            &mut reader,
                            &mut writer,
                            &mut crate::signing_lifecycle_evidence::WireFault::Direct,
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
                next
            }
            KeygenStep::OpenPublicT(opening) => {
                let started = Instant::now();
                let own = opening.own_message();
                let mut peer = vec![0; own.len()];
                match role {
                    SigningRole::A => {
                        writer.write_all(&own)?;
                        writer.flush()?;
                        reader.read_exact(&mut peer)?;
                    }
                    SigningRole::B => {
                        reader.read_exact(&mut peer)?;
                        writer.write_all(&own)?;
                        writer.flush()?;
                    }
                }
                public_t_exchange = json!({"sent_bytes": own.len(), "received_bytes": peer.len(), "wall_ns": started.elapsed().as_nanos()});
                opening.accept(&peer)?
            }
            KeygenStep::Complete(output) => break output,
        };
    };
    require(
        output.circuits.len() == circuit_wall_ns.len(),
        "Key-generation measurements lost a circuit transition.",
    )?;
    let mut stages = Vec::with_capacity(output.circuits.len());
    for (((kernel, ordinal, metrics), elapsed), observation) in output
        .circuits
        .iter()
        .zip(circuit_wall_ns)
        .zip(observations)
    {
        let metrics = complete_engine_evidence::encode_metrics(metrics, role);
        complete_engine_evidence::verify_observation(&metrics, &observation, role)?;
        stages.push(json!({"component": kernel.name(), "ordinal": ordinal, "circuit_wall_ns": elapsed, "metrics": metrics, "observation": observation}));
    }
    let sealed_keygen_result = match completion {
        RoleCompletion::Canonical => Value::Null,
        RoleCompletion::Wallet {
            reply,
            holder_secret,
        } => serde_json::to_value(reply.seal_result(&holder_secret, &output.public_key)?)?,
    };
    let directory = result
        .parent()
        .ok_or("Role result has no parent directory.")?;
    let material_storage = material_storage_evidence::persist(
        directory,
        storage_binding,
        role,
        &output.public_key,
        &output.own_material,
    )?;
    fs::write(
        result,
        serde_json::to_vec(&json!({
            "role": match role { SigningRole::A => "private-keygen-role-a", SigningRole::B => "private-keygen-role-b" },
            "public_key_hex": hex::encode(output.public_key),
            "public_key_sha256": digest(&output.public_key),
            "material_bytes": output.own_material.len(),
            "material_storage": material_storage,
            "schedule_preparation_wall_ns": schedule_preparation_wall_ns,
            "role_pipeline_wall_ns_including_schedule_reads": started.elapsed().as_nanos(),
            "stages": stages,
            "public_t_exchange": public_t_exchange,
            "wallet_seed_stage": wallet_seed_stage,
            "sealed_keygen_result": sealed_keygen_result,
        }))?,
    )?;
    Ok(())
}

fn verify_public_metrics(a: &Value, b: &Value) -> InvestigationResult<()> {
    let stages_a = a["stages"].as_array().ok_or("Missing A stages.")?;
    let stages_b = b["stages"].as_array().ok_or("Missing B stages.")?;
    require(
        stages_a.len() == stages_b.len() && (12..=34).contains(&stages_a.len()),
        "Persistent role adaptive stage counts disagree.",
    )?;
    for (a, b) in stages_a.iter().zip(stages_b) {
        require(
            a["component"] == b["component"] && a["ordinal"] == b["ordinal"],
            "Persistent role stage identities disagree.",
        )?;
        require(
            a["metrics"] == b["metrics"],
            "Persistent role engine counters or execution bindings disagree.",
        )?;
    }
    Ok(())
}

fn read_authorized_material(
    path: &Path,
    role: SigningRole,
    public_key: &[u8; 1952],
) -> InvestigationResult<AuthorizedTestMaterial> {
    let metadata = fs::metadata(path)?;
    require(
        metadata.permissions().mode() & 0o777 == 0o600,
        "Authorized test material must use mode 0600.",
    )?;
    let bytes = material_storage_evidence::open(path, role, public_key)?;
    let seed = Zeroizing::new(bytes[..32].try_into()?);
    let k = Zeroizing::new(bytes[32..64].try_into()?);
    let mut samples = Zeroizing::new([[0; COEFFICIENTS]; SECRET_POLYNOMIALS]);
    let mut t0 = Zeroizing::new([[0; COEFFICIENTS]; ROWS]);
    let mut encoded_residues = bytes[64..].chunks_exact(4);
    for polynomial in samples.iter_mut().chain(t0.iter_mut()) {
        for coefficient in polynomial {
            let encoded = encoded_residues
                .next()
                .ok_or("Authorized material is truncated.")?;
            *coefficient = u32::from_le_bytes(encoded.try_into()?);
            require(
                *coefficient < MODULUS,
                "Authorized material contains a noncanonical residue.",
            )?;
        }
    }
    require(
        encoded_residues.next().is_none(),
        "Authorized material contains trailing residues.",
    )?;
    Ok(AuthorizedTestMaterial {
        seed,
        k,
        samples,
        t0,
    })
}

fn run_authorized_recipient(
    a: &Path,
    b: &Path,
    public: &Path,
    public_signing_report: &Path,
    result: &Path,
) -> InvestigationResult<()> {
    let started = Instant::now();
    let expected_public: [u8; 1952] = fs::read(public)?
        .try_into()
        .map_err(|_| "Invalid export public key.")?;
    let share_a = read_authorized_material(a, SigningRole::A, &expected_public)?;
    let share_b = read_authorized_material(b, SigningRole::B, &expected_public)?;
    let mut seed = Zeroizing::new([0; 32]);
    for index in 0..32 {
        seed[index] = share_a.seed[index] ^ share_b.seed[index];
    }
    let key = SigningKey::<MlDsa65>::from_seed(&(*seed).into());
    let public_key = key.verifying_key().encode();
    require(
        public_key.as_slice() == fs::read(public)?,
        "Authorized seed recovery differs from the private pipeline public key.",
    )?;
    verify_authorized_private_material(&seed, public_key.as_slice(), &share_a, &share_b)?;
    let threshold_report: Value = serde_json::from_slice(&fs::read(public_signing_report)?)?;
    let threshold_reference =
        private_signing::compare_authorized_reference(&key, &threshold_report)?;
    let message = [0x5a; 32];
    let context = b"seams.ml-dsa-authorized-test-export.v1";
    let signature = key.expanded_key().sign_deterministic(&message, context)?;
    require(
        key.verifying_key()
            .verify_with_context(&message, context, &signature),
        "Authorized recovered ordinary key failed standard signature verification.",
    )?;
    fs::write(
        result,
        serde_json::to_vec(&json!({
        "scope": "Authorized disposable-test export after both role processes finish. This recipient reconstructs the canonical seed and complete private material, compares the expanded FIPS encoding with OpenSSL, and signs with the recovered ordinary key.",
        "public_test_seed_hex": hex::encode(seed.as_slice()),
        "canonical_recovery_public_key_matches": true,
        "reconstructed_k_s1_s2_t0_match_openssl_expanded_private_key": true,
        "expanded_private_key_bytes": 4032,
            "public_key_sha256": digest(public_key.as_slice()),
            "ordinary_signature_bytes": signature.encode().len(),
            "ordinary_signature_sha256": digest(signature.encode().as_slice()),
            "ordinary_signature_verified": true,
            "message_hex": hex::encode(message),
            "context_hex": hex::encode(context),
            "recipient_wall_ns": started.elapsed().as_nanos(),
            "threshold_signature_before_export": threshold_reference,
        }))?,
    )?;
    Ok(())
}

fn verify_authorized_private_material(
    seed: &[u8; 32],
    public_key: &[u8],
    a: &AuthorizedTestMaterial,
    b: &AuthorizedTestMaterial,
) -> InvestigationResult<()> {
    let mut k = Zeroizing::new([0; 32]);
    for index in 0..32 {
        k[index] = a.k[index] ^ b.k[index];
    }
    let s1 = Zeroizing::new(hybrid_keygen::reconstruct_vector(
        &a.samples[..5],
        &b.samples[..5],
    ));
    let s2 = Zeroizing::new(hybrid_keygen::reconstruct_vector(
        &a.samples[5..],
        &b.samples[5..],
    ));
    let t0 = Zeroizing::new(hybrid_keygen::reconstruct_vector(
        a.t0.as_slice(),
        b.t0.as_slice(),
    ));
    let mut expanded = Zeroizing::new(Vec::with_capacity(4032));
    expanded.extend_from_slice(&public_key[..32]);
    expanded.extend_from_slice(k.as_slice());
    expanded.extend_from_slice(&reference_shake256(public_key, 64));
    hybrid_keygen::pack_signed_vector(&s1, 4, 4, &mut expanded)?;
    hybrid_keygen::pack_signed_vector(&s2, 4, 4, &mut expanded)?;
    hybrid_keygen::pack_signed_vector(&t0, 4096, 13, &mut expanded)?;
    let expected = Zeroizing::new(reference::expanded_authorized_test_key(seed)?);
    require(
        expanded.len() == 4032,
        "Reconstructed private material has the wrong FIPS encoding length.",
    )?;
    require(
        expanded.as_slice() == expected.as_slice(),
        "Reconstructed K, s1, s2, or t0 differs from independent OpenSSL key generation.",
    )
}
