//! Persistent role-process key generation for disposable investigation keys.
//!
//! The parent handles public schedules and results. Each role retains its own
//! seed, K, and lattice shares. A separate authorized recipient reconstructs
//! the test seed only after both roles finish. Shared-host files provide no
//! operating-system isolation or production export authorization.

use crate::{
    InvestigationResult, circuit_evidence::reference_shake256, digest, hybrid_keygen,
    private_execution, reference, require,
};
use ed25519_yao::phase5_benchmark::ml_dsa_private::{
    PrivateKernelEvaluation, PrivateKernelSchedule, evaluate_private_fixture,
    garble_private_fixture,
};
use ed25519_yao_generator::{
    MlDsaPrivateKeygenCircuitV1, compile_ml_dsa_private_rounding_circuit_v1,
    compile_ml_dsa_private_sampling_circuit_v1, compile_ml_dsa_private_seed_circuit_v1,
};
use ml_dsa::{Keypair, MlDsa65, SigningKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
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
use zeroize::{Zeroize, Zeroizing};

const MODULUS: u32 = 8_380_417;
const COEFFICIENTS: usize = 256;
const SECRET_POLYNOMIALS: usize = 11;
const ROWS: usize = 6;
const MATERIAL_BYTES: usize = 17_472;
const MATERIAL_FILENAME: &str = "ephemeral-test-material.bin";
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
    FixedPublicShare { share: [u8; 32] },
    JointRandom,
}

impl Drop for SeedInput {
    fn drop(&mut self) {
        if let Self::FixedPublicShare { share } = self {
            share.zeroize();
        }
    }
}

#[derive(Clone, Copy)]
enum Role {
    A,
    B,
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
                arguments.len() == 4,
                "Key generation role needs schedule, input, and public result paths.",
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
            )?;
        }
        "private-keygen-authorized-test-recipient" => {
            require(
                arguments.len() == 5,
                "Test recipient needs two material paths, a public key path, and a public result path.",
            )?;
            run_authorized_recipient(
                Path::new(&arguments[1]),
                Path::new(&arguments[2]),
                Path::new(&arguments[3]),
                Path::new(&arguments[4]),
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
    let compile_wall_ns = compile_started.elapsed().as_nanos();
    let mut cases = Vec::with_capacity(FIXTURE_NAMES.len() + 1);
    for name in FIXTURE_NAMES {
        cases.push(run_case(schedules.path(), Some(name))?);
    }
    cases.push(run_case(schedules.path(), None)?);
    Ok(json!({
        "scope": "Two persistent passive role processes execute one private seed circuit, eleven private sampling circuits, and six private rounding circuits over disposable test keys.",
        "production_eligible": false,
        "security_limits": [
            "This is a shared-host benchmark. File permissions and process separation provide no operating-system isolation claim.",
            "The parent passes each role only public schedule paths, its own seed input path, and its public result path. The normal parent never reads private material files.",
            "An explicitly separate authorized test recipient reconstructs the seed after key generation and then creates the ordinary private key. Every test seed becomes public in this artifact.",
            "The kernels use genuine passive OT and fresh execution domains. Composition privacy remains subject to review.",
            "Local arithmetic has no native constant-time guarantee. Transport authentication, production admission, durable storage, and recipient authorization remain unimplemented.",
            "A bounded sampler failure stops both roles on the same public success bit. Temporary outputs are destroyed. The investigation never changes the canonical seed or retries a different seed.",
            "Host pipes and host wall times do not measure Cloudflare bandwidth, CPU charges, or deployed latency."
        ],
        "implementation_source_sha256": digest(&fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/src/private_keygen.rs"))?),
        "schedule_compile_wall_ns": compile_wall_ns,
        "compiled_unique_schedules": 13,
        "executed_kernels_per_case": 18,
        "schedule_identities": identities,
        "material_shape_per_role": {"bytes": MATERIAL_BYTES, "seed_xor_share_bytes": 32, "k_xor_share_bytes": 32, "s1_s2_additive_residues": SECRET_POLYNOMIALS * COEFFICIENTS, "t0_additive_residues": ROWS * COEFFICIENTS, "residue_encoding": "u32 little-endian, reduced modulo 8380417", "persistence": "Ephemeral role-local file with mode 0600, deleted with the case temporary directory."},
        "cases": cases,
        "total_wall_ns_including_compile_processes_and_authorized_recovery": started.elapsed().as_nanos(),
    }))
}

fn compile_schedules(directory: &Path) -> InvestigationResult<Vec<Value>> {
    let mut identities = Vec::with_capacity(13);
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
    for nonce in 0..SECRET_POLYNOMIALS as u16 {
        let started = Instant::now();
        let sampling = compile_ml_dsa_private_sampling_circuit_v1(nonce);
        identities.push(save_schedule(
            directory,
            &sampling_filename(nonce),
            "expand-s-and-sampling",
            &sampling,
            started,
        )?);
    }
    let started = Instant::now();
    let rounding = compile_ml_dsa_private_rounding_circuit_v1();
    identities.push(save_schedule(
        directory,
        "rounding.bin",
        "power2round",
        &rounding,
        started,
    )?);
    Ok(identities)
}

fn save_schedule(
    directory: &Path,
    filename: &str,
    component: &str,
    circuit: &MlDsaPrivateKeygenCircuitV1,
    started: Instant,
) -> InvestigationResult<Value> {
    let bytes = circuit.canonical_schedule_encoding();
    PrivateKernelSchedule::parse(bytes)?;
    fs::write(directory.join(filename), bytes)?;
    Ok(json!({
        "component": component,
        "schedule_filename": filename,
        "schedule_bytes": bytes.len(),
        "and_gates": circuit.metrics().and_gate_count(),
        "half_gate_table_bytes": circuit.metrics().and_gate_count() * 32,
        "component_sha256": hex::encode(circuit.benchmark_component_digest().expose_public_bytes()),
        "schedule_sha256": hex::encode(circuit.benchmark_schedule_digest().expose_public_bytes()),
        "compile_parse_and_cache_wall_ns": started.elapsed().as_nanos(),
    }))
}

fn sampling_filename(nonce: u16) -> String {
    format!("sampling-{nonce}.bin")
}

fn run_case(schedules: &Path, fixture: Option<&str>) -> InvestigationResult<Value> {
    let case = tempfile::tempdir()?;
    let role_a = case.path().join("role-a");
    let role_b = case.path().join("role-b");
    for path in [&role_a, &role_b] {
        fs::create_dir(path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    let input_a = role_a.join("own-seed-input.json");
    let input_b = role_b.join("own-seed-input.json");
    write_seed_inputs(fixture, &input_a, &input_b)?;
    let result_a = role_a.join("public-result.json");
    let result_b = role_b.join("public-result.json");
    let started = Instant::now();
    private_execution::run_duplex_children(
        &[
            OsStr::new(Role::A.argument()),
            schedules.as_os_str(),
            input_a.as_os_str(),
            result_a.as_os_str(),
        ],
        &[
            OsStr::new(Role::B.argument()),
            schedules.as_os_str(),
            input_b.as_os_str(),
            result_b.as_os_str(),
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
    let public_key = hex::decode(a["public_key_hex"].as_str().ok_or("Missing public key.")?)?;
    let public_path = case.path().join("public-key.bin");
    fs::write(&public_path, &public_key)?;
    let recipient_result = case.path().join("authorized-test-recipient-result.json");
    let started = Instant::now();
    let recipient = Command::new(env::current_exe()?)
        .arg("private-keygen-authorized-test-recipient")
        .arg(role_a.join(MATERIAL_FILENAME))
        .arg(role_b.join(MATERIAL_FILENAME))
        .arg(&public_path)
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
    if let Some(name) = fixture {
        require(
            recovered["public_test_seed_hex"] == hex::encode(reference::fixture_bytes(name, 32)?),
            "Authorized recovery returned the wrong public fixture seed.",
        )?;
    }
    Ok(json!({
        "case": fixture.unwrap_or("joint-random-disposable-key"),
        "seed_generation": if fixture.is_some() { "Known public fixture, split with a fresh random XOR mask before role launch." } else { "Each role independently generates one OS-random 32-byte coin. No parent receives a full seed before authorized test export." },
        "public_key_bytes": public_key.len(),
        "public_key_sha256": digest(&public_key),
        "keygen_process_wall_ns_including_schedule_reads_and_startup": keygen_process_wall_ns,
        "authorized_recipient_process_wall_ns": recipient_process_wall_ns,
        "role_a": a,
        "role_b": b,
        "authorized_test_recipient": recovered,
    }))
}

fn write_seed_inputs(fixture: Option<&str>, a: &Path, b: &Path) -> InvestigationResult<()> {
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
    Ok(())
}

fn write_private_file(path: &Path, bytes: &[u8]) -> InvestigationResult<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    Ok(())
}

fn own_seed(input: &Path) -> InvestigationResult<Zeroizing<[u8; 32]>> {
    let bytes = Zeroizing::new(fs::read(input)?);
    let parsed: SeedInput = serde_json::from_slice(&bytes)?;
    let mut share = Zeroizing::new([0; 32]);
    match &parsed {
        SeedInput::FixedPublicShare { share: input_share } => share.copy_from_slice(input_share),
        SeedInput::JointRandom => getrandom::getrandom(share.as_mut())?,
    }
    Ok(share)
}

fn execute_kernel<R: Read, W: Write>(
    role: Role,
    path: &Path,
    bits: &[bool],
    reader: &mut R,
    writer: &mut W,
) -> InvestigationResult<PrivateKernelEvaluation> {
    let bytes = fs::read(path)?;
    let schedule = PrivateKernelSchedule::parse(&bytes)?;
    Ok(match role {
        Role::A => garble_private_fixture(&schedule, bits, reader, writer)?,
        Role::B => evaluate_private_fixture(&schedule, bits, reader, writer)?,
    })
}

fn run_role(role: Role, schedules: &Path, input: &Path, result: &Path) -> InvestigationResult<()> {
    let started = Instant::now();
    let seed = own_seed(input)?;
    let mut rho_prime = Zeroizing::new([0; 64]);
    let mut k = Zeroizing::new([0; 32]);
    let mut samples = Zeroizing::new([[0; COEFFICIENTS]; SECRET_POLYNOMIALS]);
    let mut t0 = Zeroizing::new([[0; COEFFICIENTS]; ROWS]);
    let mut reader = io::stdin().lock();
    let mut writer = io::stdout().lock();
    let mut stages = Vec::with_capacity(18);
    let mut seed_input = Zeroizing::new(Vec::from(seed.as_slice()));
    if let Role::A = role {
        getrandom::getrandom(rho_prime.as_mut())?;
        getrandom::getrandom(k.as_mut())?;
        seed_input.extend_from_slice(rho_prime.as_slice());
        seed_input.extend_from_slice(k.as_slice());
    }
    let seed_bits = bytes_to_bits(&seed_input);
    let expansion = execute_kernel(
        role,
        &schedules.join("seed.bin"),
        &seed_bits,
        &mut reader,
        &mut writer,
    )?;
    let rho: [u8; 32] = expansion.output[..32].try_into()?;
    if let Role::B = role {
        rho_prime.copy_from_slice(&expansion.output[32..96]);
        k.copy_from_slice(&expansion.output[96..128]);
    }
    stages.push(stage_evidence("seed-expansion", 0, &expansion));
    drop(expansion);
    drop(seed_bits);
    drop(seed_input);
    for nonce in 0..SECRET_POLYNOMIALS {
        let mut bits = bytes_to_bits(rho_prime.as_slice());
        if let Role::A = role {
            fill_uniform_residues(&mut samples[nonce])?;
            append_residue_bits(&mut bits, &samples[nonce]);
        }
        let evaluation = execute_kernel(
            role,
            &schedules.join(sampling_filename(nonce as u16)),
            &bits,
            &mut reader,
            &mut writer,
        )?;
        require(
            evaluation.output[0] & 1 == 1,
            "Bounded sampler exhausted its canonical prefix. Both roles must discard all intermediate shares.",
        )?;
        if let Role::B = role {
            samples[nonce] = decode_polynomial(&evaluation.output, 1, 23, MODULUS)?;
        }
        stages.push(stage_evidence("expand-s-and-sampling", nonce, &evaluation));
    }
    drop(rho_prime);
    let expand_started = Instant::now();
    let (matrix, rejected_candidates) = hybrid_keygen::expand_a(&rho);
    let expand_a_wall_ns = expand_started.elapsed().as_nanos();
    let arithmetic_started = Instant::now();
    let t = Zeroizing::new(hybrid_keygen::matrix_product_plus_error(
        &matrix,
        &samples,
        &hybrid_keygen::ntt_twiddles(),
    ));
    let arithmetic_wall_ns = arithmetic_started.elapsed().as_nanos();
    let mut t1 = [[0; COEFFICIENTS]; ROWS];
    for row in 0..ROWS {
        let mut bits = Zeroizing::new(Vec::new());
        append_residue_bits(&mut bits, &t[row]);
        if let Role::A = role {
            fill_uniform_residues(&mut t0[row])?;
            append_residue_bits(&mut bits, &t0[row]);
        }
        let evaluation = execute_kernel(
            role,
            &schedules.join("rounding.bin"),
            &bits,
            &mut reader,
            &mut writer,
        )?;
        t1[row] = decode_polynomial(&evaluation.output, 0, 10, 1024)?;
        if let Role::B = role {
            t0[row] = decode_polynomial(&evaluation.output, COEFFICIENTS * 10, 23, MODULUS)?;
        }
        stages.push(stage_evidence("power2round", row, &evaluation));
    }
    let public_key = hybrid_keygen::encode_public_key(&rho, &t1)?;
    let directory = result
        .parent()
        .ok_or("Role result has no parent directory.")?;
    persist_material(&directory.join(MATERIAL_FILENAME), &seed, &k, &samples, &t0)?;
    fs::write(
        result,
        serde_json::to_vec(&json!({
            "role": role.argument(),
            "public_key_hex": hex::encode(&public_key),
            "public_key_sha256": digest(&public_key),
            "material_bytes": MATERIAL_BYTES,
            "expand_a_wall_ns": expand_a_wall_ns,
            "expand_a_rejected_public_candidates": rejected_candidates,
            "local_ntt_matrix_product_wall_ns": arithmetic_wall_ns,
            "role_pipeline_wall_ns_including_schedule_reads": started.elapsed().as_nanos(),
            "stages": stages,
        }))?,
    )?;
    Ok(())
}

fn persist_material(
    path: &Path,
    seed: &[u8; 32],
    k: &[u8; 32],
    samples: &hybrid_keygen::SecretVector,
    t0: &[hybrid_keygen::Polynomial; ROWS],
) -> InvestigationResult<()> {
    let mut bytes = Zeroizing::new(Vec::with_capacity(MATERIAL_BYTES));
    bytes.extend_from_slice(seed);
    bytes.extend_from_slice(k);
    for polynomial in samples.iter().chain(t0) {
        for coefficient in polynomial {
            bytes.extend_from_slice(&coefficient.to_le_bytes());
        }
    }
    require(
        bytes.len() == MATERIAL_BYTES,
        "Role material length differs from its declared schema.",
    )?;
    write_private_file(path, &bytes)
}

fn stage_evidence(component: &str, ordinal: usize, evaluation: &PrivateKernelEvaluation) -> Value {
    json!({"component": component, "ordinal": ordinal, "metrics": private_execution::encode_metrics(&evaluation.metrics)})
}

fn bytes_to_bits(bytes: &[u8]) -> Zeroizing<Vec<bool>> {
    let mut bits = Zeroizing::new(Vec::with_capacity(bytes.len() * 8));
    for byte in bytes {
        for bit in 0..8 {
            bits.push((byte >> bit) & 1 != 0);
        }
    }
    bits
}

fn append_residue_bits(bits: &mut Vec<bool>, polynomial: &hybrid_keygen::Polynomial) {
    for coefficient in polynomial {
        for bit in 0..23 {
            bits.push((coefficient >> bit) & 1 != 0);
        }
    }
}

fn fill_uniform_residues(polynomial: &mut hybrid_keygen::Polynomial) -> InvestigationResult<()> {
    // Rejection depends only on fresh independent masks, never on key material.
    let mut bytes = Zeroizing::new([0; 3]);
    for coefficient in polynomial {
        loop {
            getrandom::getrandom(bytes.as_mut())?;
            let candidate = u32::from(bytes[0])
                | (u32::from(bytes[1]) << 8)
                | (u32::from(bytes[2] & 0x7f) << 16);
            if candidate < MODULUS {
                *coefficient = candidate;
                break;
            }
        }
    }
    Ok(())
}

fn decode_polynomial(
    bytes: &[u8],
    offset: usize,
    width: usize,
    limit: u32,
) -> InvestigationResult<hybrid_keygen::Polynomial> {
    require(
        offset + COEFFICIENTS * width <= bytes.len() * 8,
        "Private polynomial output is truncated.",
    )?;
    let mut polynomial = [0; COEFFICIENTS];
    for (index, coefficient) in polynomial.iter_mut().enumerate() {
        for bit in 0..width {
            let position = offset + index * width + bit;
            *coefficient |= u32::from((bytes[position / 8] >> (position % 8)) & 1) << bit;
        }
        require(
            *coefficient < limit,
            "Private polynomial output contains a noncanonical coefficient.",
        )?;
    }
    Ok(polynomial)
}

fn verify_public_metrics(a: &Value, b: &Value) -> InvestigationResult<()> {
    let stages_a = a["stages"].as_array().ok_or("Missing A stages.")?;
    let stages_b = b["stages"].as_array().ok_or("Missing B stages.")?;
    require(
        stages_a.len() == 18 && stages_b.len() == 18,
        "Persistent role stage count differs from eighteen.",
    )?;
    for (a, b) in stages_a.iter().zip(stages_b) {
        require(
            a["component"] == b["component"] && a["ordinal"] == b["ordinal"],
            "Persistent role stage identities disagree.",
        )?;
        for field in [
            "table_bytes",
            "frame_count",
            "garbler_to_evaluator_wire_bytes",
            "evaluator_to_garbler_wire_bytes",
            "ot_wire_bytes",
            "execution_binding_sha256",
        ] {
            require(
                a["metrics"][field] == b["metrics"][field],
                "Persistent role transport counters or execution bindings disagree.",
            )?;
        }
    }
    Ok(())
}

fn read_authorized_material(path: &Path) -> InvestigationResult<AuthorizedTestMaterial> {
    let metadata = fs::metadata(path)?;
    require(
        metadata.len() == MATERIAL_BYTES as u64,
        "Authorized test material has an invalid length.",
    )?;
    require(
        metadata.permissions().mode() & 0o777 == 0o600,
        "Authorized test material must use mode 0600.",
    )?;
    let bytes = Zeroizing::new(fs::read(path)?);
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
    result: &Path,
) -> InvestigationResult<()> {
    let started = Instant::now();
    let share_a = read_authorized_material(a)?;
    let share_b = read_authorized_material(b)?;
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
            "threshold_signing_exercised": false,
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
