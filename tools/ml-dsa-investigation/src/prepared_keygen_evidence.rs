//! Separate native roles benchmark offline preparation and online canonical keygen.

use crate::{
    InvestigationResult, boolean_engine_evidence::run_ready, circuit_evidence::reference_shake256,
    digest, material_storage_evidence, private_execution, private_keygen, private_signing, require,
    wallet_recovery_evidence,
};
use ml_dsa_threshold::{
    ml_dsa_runtime::{
        RuntimeError, TrustedMlDsaSchedule,
        prepared::{Phase, Transport, keygen::prepare_keygen},
    },
    ml_dsa_signing::SigningRole,
};
use ml_dsa::{Keypair, MlDsa65, SigningKey};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    env,
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const SCHEDULES: [&str; 5] = [
    "wallet-seed",
    "seed",
    "sampling-two-blocks",
    "sampling-three-blocks",
    "sampling-final-bound",
];

#[derive(Default)]
pub(super) struct Counts {
    sent: usize,
    received: usize,
    sends: usize,
    receives: usize,
    table_bytes_written: usize,
    table_bytes_read: usize,
    table_reads: usize,
}
impl Counts {
    pub(super) fn table_write(&mut self, bytes: usize) { self.table_bytes_written += bytes; }
    pub(super) fn table_read(&mut self, bytes: usize) { self.table_bytes_read += bytes; self.table_reads += 1; }

    pub(super) fn json(&self) -> Value {
        json!({"sent_bytes": self.sent, "received_bytes": self.received, "sent_messages": self.sends, "received_messages": self.receives, "table_bytes_written": self.table_bytes_written, "table_bytes_read": self.table_bytes_read, "table_frame_reads": self.table_reads})
    }
}

pub(super) struct HostTransport {
    directory: PathBuf,
    pub(super) counts: [Counts; 2],
    phase: usize,
    one_way_delay_us: u64,
}
impl HostTransport {
    pub(super) fn new(directory: PathBuf, one_way_delay_us: u64) -> Self {
        Self {
            directory,
            counts: Default::default(),
            phase: 0,
            one_way_delay_us,
        }
    }
}
impl Transport for HostTransport {
    async fn send(&mut self, bytes: &[u8]) -> Result<(), RuntimeError> {
        if self.phase == 1 && self.one_way_delay_us > 0 {
            std::thread::sleep(Duration::from_micros(self.one_way_delay_us));
        }
        io::stdout().write_all(bytes).map_err(io_failure)?;
        io::stdout().flush().map_err(io_failure)?;
        self.counts[self.phase].sent += bytes.len();
        self.counts[self.phase].sends += 1;
        Ok(())
    }
    async fn receive(&mut self, length: usize) -> Result<Vec<u8>, RuntimeError> {
        let mut bytes = vec![0; length];
        io::stdin().read_exact(&mut bytes).map_err(io_failure)?;
        self.counts[self.phase].received += length;
        self.counts[self.phase].receives += 1;
        Ok(bytes)
    }
    async fn store(
        &mut self,
        binding: [u8; 32],
        _ordinal: usize,
        bytes: &[u8],
    ) -> Result<(), RuntimeError> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.directory.join(hex::encode(binding)))
            .map_err(io_failure)?;
        file.write_all(bytes).map_err(io_failure)?;
        self.counts[self.phase].table_write(bytes.len());
        Ok(())
    }
    async fn load(
        &mut self,
        binding: [u8; 32],
        ordinal: usize,
        length: usize,
    ) -> Result<Vec<u8>, RuntimeError> {
        let mut file =
            fs::File::open(self.directory.join(hex::encode(binding))).map_err(io_failure)?;
        file.seek(SeekFrom::Start((ordinal * 65544) as u64))
            .map_err(io_failure)?;
        let mut bytes = vec![0; length];
        file.read_exact(&mut bytes).map_err(io_failure)?;
        self.counts[self.phase].table_read(length);
        Ok(bytes)
    }
    fn phase(&mut self, phase: Phase) {
        self.phase = match phase {
            Phase::Offline => 0,
            Phase::Online => 1,
        };
    }
}
fn io_failure(_: io::Error) -> RuntimeError {
    RuntimeError::MessageLength
}

pub(super) fn try_run_child() -> InvestigationResult<bool> {
    let args: Vec<String> = env::args().skip(1).collect();
    let role = match args.first().map(String::as_str) {
        Some("prepared-keygen-role-a") => SigningRole::A,
        Some("prepared-keygen-role-b") => SigningRole::B,
        _ => return Ok(false),
    };
    require(
        args.len() == 6,
        "Prepared role needs schedules, own root, table directory, report, and one-way delay.",
    )?;
    let schedule_bytes = SCHEDULES
        .iter()
        .map(|name| fs::read(Path::new(&args[1]).join(format!("{name}.bin"))))
        .collect::<Result<Vec<_>, _>>()?;
    let schedules = schedule_bytes
        .iter()
        .map(parse_schedule)
        .collect::<Result<Vec<_>, _>>()?;
    let own_root = Zeroizing::new(fs::read(&args[2])?);
    let own_root: &[u8; 32] = own_root.as_slice().try_into()?;
    let host = HostTransport {
        directory: PathBuf::from(&args[3]),
        counts: Default::default(),
        phase: 0,
        one_way_delay_us: args[5].parse()?,
    };
    let mut transport = crate::registration_tables_evidence::RegistrationTransport::new(
        host, role, &schedules, Path::new(&args[3]),
    )?;
    let started = Instant::now();
    let prepared = run_ready(prepare_keygen(role, &schedules, &mut transport))??;
    transport.check_before_consume()?;
    let (prepared, preparation_storage) = crate::keygen_storage_evidence::roundtrip(
        prepared, role, &schedules, Path::new(&args[3]), &transport.binding, &transport.seed,
    )?;
    transport.check_after_consume()?;
    run_ready(barrier(role, &mut transport))??;
    let offline_ns = started.elapsed().as_nanos();
    transport.phase(Phase::Online);
    let started = Instant::now();
    let (key, wallet) = run_ready(prepared.run(own_root, &mut transport))??;
    let online_ns = started.elapsed().as_nanos();
    let table_storage = transport.cleanup()?;
    let sealing_started = Instant::now();
    let material_storage = material_storage_evidence::persist(
        Path::new(&args[3]),
        material_storage_evidence::canonical_fixture_binding()?,
        role,
        &key.public_key,
        &key.own_material,
    )?;
    let post_timer_sealing_ns = sealing_started.elapsed().as_nanos();

    fs::write(
        &args[4],
        serde_json::to_vec_pretty(&json!({
            "public_key_hex": hex::encode(key.public_key), "own_material_bytes": key.own_material.len(),
            "offline_ns": offline_ns, "online_ns": online_ns,
        "post_timer_sealing_ns": post_timer_sealing_ns, "material_storage": material_storage,
        "preparation_storage": preparation_storage, "table_storage": table_storage,
            "offline": transport.inner.counts[0].json(), "online": transport.inner.counts[1].json(),
            "circuits": key.circuits.len() + 1, "wallet_seed_table_bytes": wallet.table_bytes,
        }))?,
    )?;
    Ok(true)
}
fn parse_schedule(bytes: &Vec<u8>) -> Result<TrustedMlDsaSchedule<'_>, RuntimeError> {
    TrustedMlDsaSchedule::parse(bytes, Sha256::digest(bytes).into())
}

async fn barrier(role: SigningRole, transport: &mut impl Transport) -> Result<(), RuntimeError> {
    match role {
        SigningRole::A => {
            transport.send(&[1]).await?;
            if transport.receive(1).await? != [2] {
                return Err(RuntimeError::SessionBinding);
            }
        }
        SigningRole::B => {
            if transport.receive(1).await? != [1] {
                return Err(RuntimeError::SessionBinding);
            }
            transport.send(&[2]).await?;
        }
    }
    Ok(())
}

pub(super) fn run(output: &Path) -> InvestigationResult<()> {
    let directory = tempfile::tempdir()?;
    let schedule_dir = directory.path().join("schedules");
    fs::create_dir(&schedule_dir)?;
    let mut identities = private_keygen::compile_schedules(&schedule_dir)?;
    identities.push(wallet_recovery_evidence::compile_wallet_seed_schedule(
        &schedule_dir,
    )?);
    let signing_schedules = private_signing::compile_schedules(&schedule_dir)?;
    let prepared_signing_schedules =
        crate::prepared_signing_evidence::compile_schedules(&schedule_dir)?;
    let sampler_evidence = crate::public_sampling_evidence::run(&schedule_dir)?;
    let prepared_components = crate::signing_circuit_evidence::prepared_components()?;
    let root = [0x42u8; 32];
    let mut seed_input = b"seams/ml-dsa-65/canonical-seed/v1".to_vec();
    seed_input.extend_from_slice(&root);
    let seed: [u8; 32] = reference_shake256(&seed_input, 32)
        .try_into()
        .expect("fixed seed");
    let expected = SigningKey::<MlDsa65>::from_seed(&seed.into())
        .verifying_key()
        .encode();
    let mut cases = Vec::new();
    for (index, rtt_ms) in [0, 0, 0, 0, 5, 20].into_iter().enumerate() {
        let case = directory.path().join(format!("case-{index}"));
        let a = case.join("a");
        let b = case.join("b");
        fs::create_dir_all(&a)?;
        fs::create_dir_all(&b)?;
        let mut share_a = Zeroizing::new([0; 32]);
        getrandom::getrandom(share_a.as_mut())?;
        let mut share_b = Zeroizing::new(root);
        for index in 0..32 {
            share_b[index] ^= share_a[index];
        }
        let input_a = a.join("root");
        let input_b = b.join("root");
        private_keygen::write_private_file(&input_a, share_a.as_ref())?;
        private_keygen::write_private_file(&input_b, share_b.as_ref())?;
        let result_a = a.join("result.json");
        let result_b = b.join("result.json");
        let delay = (rtt_ms * 500).to_string();
        private_execution::run_duplex_children(
            &[
                OsStr::new("prepared-keygen-role-a"),
                schedule_dir.as_os_str(),
                input_a.as_os_str(),
                a.as_os_str(),
                result_a.as_os_str(),
                OsStr::new(&delay),
            ],
            &[
                OsStr::new("prepared-keygen-role-b"),
                schedule_dir.as_os_str(),
                input_b.as_os_str(),
                b.as_os_str(),
                result_b.as_os_str(),
                OsStr::new(&delay),
            ],
        )?;
        let role_a_directory = a.clone();
        let role_b_directory = b.clone();
        let a: Value = serde_json::from_slice(&fs::read(result_a)?)?;
        let b: Value = serde_json::from_slice(&fs::read(result_b)?)?;
        require(
            a["public_key_hex"] == b["public_key_hex"]
                && a["public_key_hex"] == hex::encode(expected.as_slice()),
            "Prepared keygen differs from canonical FIPS recovery.",
        )?;
        for phase in ["offline", "online"] {
            require(
                a[phase]["sent_bytes"] == b[phase]["received_bytes"]
                    && b[phase]["sent_bytes"] == a[phase]["received_bytes"],
                "Prepared role counters disagree.",
            )?;
        }
        require(
            a["circuits"] == b["circuits"]
                && (13..=35).contains(&a["circuits"].as_u64().ok_or("Missing circuit count")?),
            "Prepared keygen missed a circuit.",
        )?;
        eprintln!(
            "Prepared keygen native case {index}, injected RTT {rtt_ms} ms: B online {} ms",
            b["online_ns"].as_u64().ok_or("Missing time")? / 1_000_000
        );

        let prepared_key_validation = if index == 1 {
            let public_path = case.join("public-key.bin");
            fs::write(&public_path, expected.as_slice())?;
            let material_a = role_a_directory.join(material_storage_evidence::MATERIAL_FILENAME);
            let material_b = role_b_directory.join(material_storage_evidence::MATERIAL_FILENAME);
            let signed = private_signing::run_case(
                &schedule_dir,
                &material_a,
                &material_b,
                &public_path,
                "prepared-wallet-key",
                crate::complete_engine_evidence::Engine::HalfGates,
            )?;
            let prepared_signing = crate::prepared_signing_evidence::run_operation(
                &schedule_dir,
                &material_a,
                &material_b,
                &public_path,
            )?;
            let signing_report = case.join("signing.json");
            fs::write(&signing_report, serde_json::to_vec(&signed)?)?;
            let recovered_path = case.join("authorized-recovery.json");
            let child = std::process::Command::new(env::current_exe()?)
                .arg("private-keygen-authorized-test-recipient")
                .arg(&material_a)
                .arg(&material_b)
                .arg(&public_path)
                .arg(&signing_report)
                .arg(&recovered_path)
                .output()?;
            require(
                child.status.success(),
                &String::from_utf8_lossy(&child.stderr),
            )?;
            let recovered: Value = serde_json::from_slice(&fs::read(recovered_path)?)?;
            require(
                recovered["public_test_seed_hex"] == hex::encode(seed),
                "Prepared key export changed the canonical seed.",
            )?;
            json!({"threshold_signing": signed, "prepared_signing": prepared_signing, "authorized_recovery": recovered})
        } else {
            Value::Null
        };
        cases.push(json!({"warmup": index == 0, "injected_rtt_ms": rtt_ms, "post_timer_key_validation": prepared_key_validation, "canonical_key_verified": true, "a": a, "b": b}));
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or("Missing repository root")?;
    let mut sources = Vec::new();
    for path in [
        "crates/router-ab-cloudflare/src/ml_dsa/mod.rs",
        "crates/router-ab-cloudflare/src/ml_dsa/execution.rs",
        "crates/router-ab-cloudflare/src/ml_dsa/registration_tables.rs",
        "crates/router-ab-cloudflare/src/ml_dsa/registration_preparation.rs",
        "crates/router-ab-cloudflare/src/ml_dsa/sealing.rs",
        "tools/ml-dsa-investigation/src/registration_tables_evidence.rs",
        "tools/ml-dsa-investigation/src/keygen_storage_evidence.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/prepared.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/prepared/keygen.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_signing/keygen.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_signing/wallet_seed.rs",
        "tools/ml-dsa-investigation/src/prepared_keygen_evidence.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_signing/prepared_signing.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_signing/prepared_signing/gmw.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_signing/prepared_signing/gmw/commitment.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_signing/prepared_signing/gmw/nonce.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/boolean_comparison/silent.rs",
        "crates/ed25519-yao/vendor/cryprot-codes/src/ex_conv.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/boolean_comparison/silent/pprf.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/boolean_comparison/silent/correlation_aes.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/boolean_comparison.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/boolean_comparison/prepared.rs",
        "crates/ed25519-yao/src/passive/ot.rs",
        "tools/ml-dsa-investigation/src/prepared_signing_evidence.rs",
        "tools/ml-dsa-investigation/src/pool_evidence.rs",
        "tools/ml-dsa-investigation/src/durable_preparation_evidence.rs",
        "tools/ml-dsa-investigation/src/durable_execution_evidence.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_signing/prepared_signing/gmw/storage.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/boolean_comparison/prepared/storage.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_signing/prepared_signing/gmw/pool.rs",
        "tools/ed25519-yao-generator/src/circuit/ml_dsa_signing.rs",
        "tools/ml-dsa-investigation/src/public_sampling_evidence.rs",
        "tools/ed25519-yao-generator/src/circuit/ml_dsa_public_sampling.rs",
    ] {
        sources.push(json!({"path": path, "sha256": digest(&fs::read(root.join(path))?)}));
    }
    directory.close()?;
    fs::write(
        output,
        serde_json::to_vec_pretty(&json!({
            "schema": "seams.ml-dsa-prepared-keygen-native.v1", "production_eligible": false, "prepared_signing_schedules": prepared_signing_schedules, "prepared_component_checks": prepared_components,
            "scope": "Input-independent fresh garbling and random OT, followed by wallet-derived canonical keygen. Separate native roles, role-local disk tables, and private input correction. No production storage or hosted latency claim.",
            "cases": cases, "sampler_evidence": sampler_evidence, "schedules": identities, "signing_schedules": signing_schedules, "sources": sources,
            "executable_sha256": digest(&fs::read(env::current_exe()?)?), "temporary_files_removed": true,
            "limits": ["Three zero-delay measured samples follow warm-up. Delay cases inject half the declared RTT before each outgoing online message; they do not emulate a real network.", "Native timings do not predict Wasm or Cloudflare latency. Tables are read from local disk, not remote object storage.", "The consuming handles enforce single use in memory. No durable pool, rollback protection, peer authentication, or admission is implemented."]
        }))?,
    )?;
    Ok(())
}

impl ml_dsa_threshold::ml_dsa_runtime::boolean_comparison::Transport for HostTransport {
    async fn send(&mut self, bytes: &[u8]) -> Result<(), RuntimeError> {
        Transport::send(self, bytes).await
    }
    async fn receive(&mut self, length: usize) -> Result<Vec<u8>, RuntimeError> {
        Transport::receive(self, length).await
    }
    fn phase(&mut self, _: ml_dsa_threshold::ml_dsa_runtime::boolean_comparison::Phase) {
        // The complete operation owns the offline/online measurement boundary.
    }
}
