//! Complete kernel comparisons with separately generated role-private correlations.

use crate::{
    InvestigationResult, command_text, digest, garbled_execution, private_execution, require,
};
use ml_dsa_threshold::{
    ml_dsa_runtime::{
        RuntimeError, TrustedMlDsaSchedule,
        boolean_comparison::{self, Engine, Phase, Transport},
    },
    ml_dsa_signing::SigningRole,
};
use serde_json::{Value, json};
use std::{
    env,
    ffi::OsStr,
    fs,
    future::Future,
    io::{self, Read, Write},
    path::Path,
    pin::pin,
    process::Command,
    task::{Context, Poll, Waker},
    time::Instant,
};
use zeroize::Zeroizing;

const KERNELS: [&str; 4] = ["seed", "sampling", "rounding", "signing-mask"];
const PHASES: [&str; 6] = [
    "binding",
    "preprocessing",
    "input_setup",
    "input_online",
    "online",
    "output",
];

pub(super) fn try_run_child() -> InvestigationResult<bool> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let role = match arguments.first().map(String::as_str) {
        Some("boolean-comparison-role-a") => SigningRole::A,
        Some("boolean-comparison-role-b") => SigningRole::B,
        _ => return Ok(false),
    };
    require(
        arguments.len() == 5,
        "Boolean comparison role needs engine, kernel, fixtures, and result paths.",
    )?;
    let engine = parse_engine(&arguments[1])?;
    require(
        KERNELS.contains(&arguments[2].as_str()),
        "Unknown comparison kernel.",
    )?;
    run_role(
        role,
        engine,
        &arguments[2],
        Path::new(&arguments[3]),
        Path::new(&arguments[4]),
    )?;
    Ok(true)
}

fn parse_engine(value: &str) -> InvestigationResult<Engine> {
    match value {
        "gmw" => Ok(Engine::Gmw),
        "aby2" => Ok(Engine::Aby2),
        _ => Err("Unknown Boolean comparison engine.".into()),
    }
}

pub(super) fn run(output: &Path) -> InvestigationResult<()> {
    require(
        !cfg!(debug_assertions),
        "Run engine comparisons with the release profile.",
    )?;
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or("Missing repository path.")?;
    let fixtures = repository.join("crates/ed25519-yao-cloudflare-bench/src/ml_dsa_schedules");
    let mut cases = Vec::new();
    for kernel in KERNELS {
        for engine in ["gmw", "aby2"] {
            let warmup = run_pair(engine, kernel, &fixtures)?;
            let mut samples = Vec::new();
            for _ in 0..3 {
                samples.push(run_pair(engine, kernel, &fixtures)?);
            }
            eprintln!(
                "Verified {engine} {kernel}: three complete measured executions after warm-up."
            );
            cases.push(json!({"engine": engine, "kernel": kernel, "warmup_excluded": warmup, "samples": samples}));
        }
    }
    let mut sources = Vec::new();
    for path in [
        "crates/ml-dsa-threshold/src/ml_dsa_runtime.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/boolean_comparison.rs",
        "crates/ed25519-yao/src/passive/ot.rs",
        "crates/ed25519-yao/Cargo.toml",
        "tools/ml-dsa-investigation/src/worker_fixtures.rs",
        "tools/ml-dsa-investigation/src/boolean_engine_evidence.rs",
        "tools/ml-dsa-investigation/src/private_execution.rs",
        "tools/ml-dsa-investigation/Cargo.toml",
        "tools/ml-dsa-investigation/Cargo.lock",
    ] {
        sources.push(json!({"path": path, "sha256": digest(&fs::read(repository.join(path))?)}));
    }
    let mut fixture_identities = Vec::new();
    for role in ["a", "b"] {
        let bytes = fs::read(fixtures.join(format!("fixtures-{role}.json")))?;
        fixture_identities
            .push(json!({"role": role, "bytes": bytes.len(), "sha256": digest(&bytes)}));
    }
    let report = json!({
        "schema": "seams.ml-dsa-boolean-engine-kernels.v1",
        "source_revision": command_text(Command::new("git").args(["rev-parse", "HEAD"]).current_dir(repository))?,
        "working_tree_dirty": !command_text(Command::new("git").args(["status", "--porcelain"]).current_dir(repository))?.is_empty(),
        "compiler": command_text(Command::new("rustc").args(["--version", "--verbose"]))?,
        "host": command_text(Command::new("uname").args(["-sm"]))?,
        "executable_sha256": digest(&fs::read(env::current_exe()?)?),
        "fixture_identities": fixture_identities,
        "sources": sources,
        "scope": "Four pinned private kernels evaluated by separate role processes, with genuine two-directional fresh-base IKNP preprocessing, exact conversion and output traffic, and independent generated fixture checks.",
        "production_eligible": false,
        "cases": cases,
        "limits": [
            "This experiment executes kernels, not a complete alternative ML-DSA key-generation or signing pipeline.",
            "Boolean preprocessing uses one-byte messages with full 128-bit OT security parameters. Packed-bit messages, silent OT, and reusable base OTs remain separate unmeasured alternatives.",
            "Every measured execution starts with an empty correlation pool. Recorded online phases consume freshly prepared correlations within that execution.",
            "No persistent preprocessing pool, sustained refill, preprocessing storage, target peak memory, or Cloudflare performance claim follows from these measurements.",
            "The public fixtures contain no wallet secrets. The new comparison engines require independent cryptographic review.",
            "The ABY2.0 comparison uses Boolean sharing throughout each circuit. Existing sampling and rounding conversions remain inside the identical pinned Boolean topology. It implements no mixed-ring conversion shortcut."
        ],
        "reproduce_argv": ["cargo", "run", "--release", "--locked", "--manifest-path", "tools/ml-dsa-investigation/Cargo.toml", "--", "compare-boolean-engines", output.display().to_string()]
    });
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, serde_json::to_vec_pretty(&report)?)?;
    println!(
        "Wrote complete Boolean kernel comparisons to {}",
        output.display()
    );
    Ok(())
}

fn run_pair(engine: &str, kernel: &str, fixtures: &Path) -> InvestigationResult<Value> {
    let directory = tempfile::tempdir()?;
    let a = directory.path().join("public-a.json");
    let b = directory.path().join("public-b.json");
    let started = Instant::now();
    private_execution::run_duplex_children(
        &[
            OsStr::new("boolean-comparison-role-a"),
            OsStr::new(engine),
            OsStr::new(kernel),
            fixtures.as_os_str(),
            a.as_os_str(),
        ],
        &[
            OsStr::new("boolean-comparison-role-b"),
            OsStr::new(engine),
            OsStr::new(kernel),
            fixtures.as_os_str(),
            b.as_os_str(),
        ],
    )?;
    let wall = started.elapsed().as_nanos();
    let a: Value = serde_json::from_slice(&fs::read(a)?)?;
    let b: Value = serde_json::from_slice(&fs::read(b)?)?;
    for field in [
        "execution_binding_sha256",
        "and_gates",
        "and_layers",
        "preprocessing_batches",
        "padded_ots_per_direction",
        "schedule_sha256",
    ] {
        require(
            a[field] == b[field],
            "Boolean roles disagree on circuit or preprocessing identity.",
        )?;
    }
    for phase in PHASES {
        require(
            a["phases"][phase]["sent"] == b["phases"][phase]["received"]
                && b["phases"][phase]["sent"] == a["phases"][phase]["received"],
            "Boolean role traffic counters disagree.",
        )?;
    }
    Ok(
        json!({"process_pair_wall_ns_including_startup_topology_and_verification": wall, "role_a": a, "role_b": b}),
    )
}

pub(super) struct PipeTransport<R, W> {
    reader: R,
    writer: W,
    phase: Phase,
    started: Instant,
    times: [u128; 6],
    sent: usize,
    received: usize,
}
impl<R, W> PipeTransport<R, W> {
    pub(super) fn new(reader: R, writer: W) -> Self {
        Self {
            reader,
            writer,
            phase: Phase::Binding,
            started: Instant::now(),
            times: [0; 6],
            sent: 0,
            received: 0,
        }
    }

    pub(super) fn finish(mut self) -> Value {
        self.times[self.phase.index()] += self.started.elapsed().as_nanos();
        json!({"phase_wall_ns_including_peer_wait": self.times, "actual_pipe_sent_bytes": self.sent, "actual_pipe_received_bytes": self.received})
    }
}
impl<R: Read, W: Write> Transport for PipeTransport<R, W> {
    async fn send(&mut self, bytes: &[u8]) -> Result<(), RuntimeError> {
        self.writer
            .write_all(bytes)
            .map_err(|_| RuntimeError::MessageLength)?;
        self.writer
            .flush()
            .map_err(|_| RuntimeError::MessageLength)?;
        self.sent += bytes.len();
        Ok(())
    }
    async fn receive(&mut self, bytes: usize) -> Result<Vec<u8>, RuntimeError> {
        let mut received = vec![0; bytes];
        self.reader
            .read_exact(&mut received)
            .map_err(|_| RuntimeError::MessageLength)?;
        self.received += received.len();
        Ok(received)
    }
    fn phase(&mut self, phase: Phase) {
        self.times[self.phase.index()] += self.started.elapsed().as_nanos();
        self.phase = phase;
        self.started = Instant::now();
    }
}

pub(super) fn run_ready<F: Future>(future: F) -> InvestigationResult<F::Output> {
    let mut future = pin!(future);
    match future
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
    {
        Poll::Ready(result) => Ok(result),
        Poll::Pending => Err("The synchronous host comparison unexpectedly yielded.".into()),
    }
}

fn run_role(
    role: SigningRole,
    engine: Engine,
    kernel: &str,
    fixtures: &Path,
    result: &Path,
) -> InvestigationResult<()> {
    let started = Instant::now();
    let role_name = match role {
        SigningRole::A => "a",
        SigningRole::B => "b",
    };
    let fixture: Value = serde_json::from_slice(&fs::read(
        fixtures.join(format!("fixtures-{role_name}.json")),
    )?)?;
    require(
        fixture["public_fixtures_only"] == true,
        "The comparison accepts public fixtures only.",
    )?;
    let raw = &fixture["kernels"][kernel];
    let expected = hex::decode(
        raw["expected_output_hex"]
            .as_str()
            .ok_or("Missing expected output.")?,
    )?;
    let input = Zeroizing::new(hex::decode(
        raw["input_hex"].as_str().ok_or("Missing role input.")?,
    )?);
    let input_bits = usize::try_from(
        raw["input_bits"]
            .as_u64()
            .ok_or("Missing input bit count.")?,
    )?;
    require(
        input.len() == input_bits.div_ceil(8),
        "The fixture input length is invalid.",
    )?;
    let mut bits = Zeroizing::new(garbled_execution::bytes_to_bits(&input));
    bits.truncate(input_bits);
    let digest_bytes: [u8; 32] = hex::decode(
        raw["schedule_sha256"]
            .as_str()
            .ok_or("Missing pinned schedule digest.")?,
    )?
    .try_into()
    .map_err(|_| "Invalid schedule digest size.")?;
    let artifact = fs::read(fixtures.join(format!("{kernel}.bin")))?;
    let schedule = TrustedMlDsaSchedule::parse(&artifact, digest_bytes)?;
    let mut transport = PipeTransport::new(io::stdin().lock(), io::stdout().lock());
    let output = run_ready(boolean_comparison::run(
        engine,
        role,
        &schedule,
        &bits,
        &mut transport,
    ))??;
    transport.times[transport.phase.index()] += transport.started.elapsed().as_nanos();
    require(
        output.own_output.as_slice() == expected,
        "Boolean comparison differs from the independent generated fixture.",
    )?;
    require(
        output
            .metrics
            .phases
            .iter()
            .map(|phase| phase.sent)
            .sum::<usize>()
            == transport.sent
            && output
                .metrics
                .phases
                .iter()
                .map(|phase| phase.received)
                .sum::<usize>()
                == transport.received,
        "Boolean runtime and actual pipe traffic disagree.",
    )?;
    let preprocessing_bytes = output.metrics.phases[Phase::Preprocessing.index()].sent
        + output.metrics.phases[Phase::Preprocessing.index()].received;
    require(
        preprocessing_bytes
            == output.metrics.preprocessing_batches
                * 2
                * (2 * 4144
                    + 48
                    + 16 * boolean_comparison::CORRELATION_BATCH_BITS
                    + 48
                    + boolean_comparison::CORRELATION_BATCH_BITS * 2),
        "Complete fresh-base OT traffic differs from the fixed batch formula.",
    )?;
    let mut phases = serde_json::Map::new();
    for (index, name) in PHASES.iter().enumerate() {
        phases.insert((*name).to_owned(), json!({"sent": output.metrics.phases[index].sent, "received": output.metrics.phases[index].received,
            "wall_ns_including_peer_wait": transport.times[index]}));
    }
    fs::write(
        result,
        serde_json::to_vec(&json!({
            "role": role_name, "schedule_sha256": hex::encode(digest_bytes), "output_matches": true,
            "output_bytes": output.own_output.len(), "output_sha256": digest(&output.own_output),
            "and_gates": output.metrics.and_gates, "and_layers": output.metrics.and_layers,
            "preprocessing_batches": output.metrics.preprocessing_batches,
            "padded_ots_per_direction": output.metrics.padded_ots_per_direction,
            "topology_allocation_bytes": output.metrics.topology_allocation_bytes,
            "retained_private_state_allocation_bytes": output.metrics.private_state_allocation_bytes,
            "execution_binding_sha256": hex::encode(output.metrics.execution_binding_sha256),
            "phases": phases, "actual_pipe_sent_bytes": transport.sent, "actual_pipe_received_bytes": transport.received,
            "role_wall_ns_including_load_topology_and_fixture_check": started.elapsed().as_nanos(),
        }))?,
    )?;
    Ok(())
}
