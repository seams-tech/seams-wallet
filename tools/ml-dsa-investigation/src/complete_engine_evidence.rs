//! Complete native compositions with explicit engine identity and full setup costs.

use crate::{
    InvestigationResult, command_text, digest, private_execution, private_keygen, private_signing,
    require,
};
use ml_dsa_threshold::{
    runtime::boolean_mpc::comparison::Engine as BooleanEngine,
    signing::{CircuitMetrics, SigningRole},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashSet, env, fs, path::Path, process::Command};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum Engine {
    HalfGates,
    Gmw,
    Aby2,
}

impl Engine {
    pub(super) const fn name(self) -> &'static str {
        match self {
            Self::HalfGates => "half-gates",
            Self::Gmw => "gmw",
            Self::Aby2 => "aby2",
        }
    }

    pub(super) fn parse(value: &str) -> InvestigationResult<Self> {
        match value {
            "half-gates" => Ok(Self::HalfGates),
            "gmw" => Ok(Self::Gmw),
            "aby2" => Ok(Self::Aby2),
            _ => Err("Unknown complete-comparison engine.".into()),
        }
    }

    pub(super) const fn boolean(self) -> Option<BooleanEngine> {
        match self {
            Self::HalfGates => None,
            Self::Gmw => Some(BooleanEngine::Gmw),
            Self::Aby2 => Some(BooleanEngine::Aby2),
        }
    }
}

/// Keep engine-specific measurements separate while normalizing wire directions.
pub(super) fn encode_metrics(metrics: &CircuitMetrics, role: SigningRole) -> Value {
    match metrics {
        CircuitMetrics::HalfGates(metrics) => {
            let mut value = private_execution::encode_runtime_metrics(metrics);
            value["engine"] = json!("half-gates");
            value["a_to_b_wire_bytes"] = json!(metrics.garbler_to_evaluator_wire_bytes);
            value["b_to_a_wire_bytes"] = json!(metrics.evaluator_to_garbler_wire_bytes);
            value
        }
        CircuitMetrics::Boolean { engine, metrics } => {
            let mut phases = Vec::with_capacity(metrics.phases.len());
            let mut a_to_b = 0;
            let mut b_to_a = 0;
            for phase in &metrics.phases {
                let (forward, reverse) = match role {
                    SigningRole::A => (phase.sent, phase.received),
                    SigningRole::B => (phase.received, phase.sent),
                };
                a_to_b += forward;
                b_to_a += reverse;
                phases.push(json!({"a_to_b_bytes": forward, "b_to_a_bytes": reverse}));
            }
            json!({
                "engine": match engine { BooleanEngine::Gmw => "gmw", BooleanEngine::Aby2 => "aby2" },
                "a_to_b_wire_bytes": a_to_b, "b_to_a_wire_bytes": b_to_a,
                "phases": phases, "and_gates": metrics.and_gates, "and_layers": metrics.and_layers,
                "preprocessing_batches": metrics.preprocessing_batches,
                "padded_ots_per_direction": metrics.padded_ots_per_direction,
                "topology_allocation_bytes": metrics.topology_allocation_bytes,
                "retained_private_state_allocation_bytes": metrics.private_state_allocation_bytes,
                "execution_binding_sha256": hex::encode(metrics.execution_binding_sha256),
            })
        }
    }
}

pub(super) fn verify_observation(
    metrics: &Value,
    observation: &Value,
    role: SigningRole,
) -> InvestigationResult<()> {
    let (sent, received) = match role {
        SigningRole::A => (&metrics["a_to_b_wire_bytes"], &metrics["b_to_a_wire_bytes"]),
        SigningRole::B => (&metrics["b_to_a_wire_bytes"], &metrics["a_to_b_wire_bytes"]),
    };
    require(
        sent == &observation["actual_pipe_sent_bytes"]
            && received == &observation["actual_pipe_received_bytes"],
        "Complete runtime counters disagree with actual directional pipe traffic.",
    )
}

pub(super) fn run(output: &Path) -> InvestigationResult<()> {
    require(
        !cfg!(debug_assertions),
        "Run complete comparisons with the release profile.",
    )?;
    let schedules = tempfile::tempdir()?;
    let keygen_schedules = private_keygen::compile_schedules(schedules.path())?;
    let signing_schedules = private_signing::compile_schedules(schedules.path())?;
    let mut cases = Vec::new();
    let mut bindings = HashSet::new();
    let mut expected_key = None;
    let mut expected_signature = None;
    for engine in [Engine::HalfGates, Engine::Gmw, Engine::Aby2] {
        let mut samples = Vec::new();
        for sample in 0..2 {
            eprintln!(
                "Starting {} complete composition, {}.",
                engine.name(),
                if sample == 0 {
                    "excluded warm-up"
                } else {
                    "measured sample"
                }
            );
            let result = private_keygen::run_case(
                schedules.path(),
                Some("zero"),
                private_keygen::Campaign::EngineComparison(engine),
            )?;
            let key = result["public_key_sha256"].clone();
            let signature = result["threshold_signing"]["signature_sha256"].clone();
            if let (Some(expected_key), Some(expected_signature)) =
                (&expected_key, &expected_signature)
            {
                require(
                    &key == expected_key && &signature == expected_signature,
                    "Complete engines disagree on the canonical key or deterministic signature.",
                )?;
            } else {
                expected_key = Some(key);
                expected_signature = Some(signature);
            }
            for stage in result["role_a"]["stages"]
                .as_array()
                .ok_or("Missing key-generation stages.")?
            {
                insert_binding(&mut bindings, &stage["metrics"])?;
            }
            for circuit in result["threshold_signing"]["role_a"]["circuits"]
                .as_array()
                .ok_or("Missing signing stages.")?
            {
                insert_binding(&mut bindings, circuit)?;
            }
            eprintln!(
                "Verified {} complete composition, sample {}.",
                engine.name(),
                sample
            );
            samples.push(result);
        }
        let measured = samples.pop().ok_or("Missing measured sample.")?;
        let warmup = samples.pop().ok_or("Missing warm-up sample.")?;
        cases.push(json!({"engine": engine, "warmup_excluded": warmup, "samples": [measured]}));
    }
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or("Missing repository path.")?;
    let mut sources = Vec::new();
    for path in [
        "tools/ml-dsa-investigation/Cargo.toml",
        "tools/ml-dsa-investigation/Cargo.lock",
        "tools/ml-dsa-investigation/src/main.rs",
        "tools/ml-dsa-investigation/src/complete_engine_evidence.rs",
        "tools/ml-dsa-investigation/src/boolean_engine_evidence.rs",
        "tools/ml-dsa-investigation/src/private_execution.rs",
        "tools/ml-dsa-investigation/src/private_keygen.rs",
        "tools/ml-dsa-investigation/src/private_signing.rs",
        "tools/ml-dsa-investigation/src/reference.rs",
        "tools/ml-dsa-investigation/src/hybrid_keygen.rs",
        "crates/ml-dsa-threshold/src/signing.rs",
        "crates/ml-dsa-threshold/src/signing/keygen.rs",
        "crates/ml-dsa-threshold/src/signing/arithmetic.rs",
        "crates/ml-dsa-threshold/src/runtime.rs",
        "crates/ml-dsa-threshold/src/runtime/boolean_mpc.rs",
        "crates/two-party-primitives/src/ot.rs",
        "crates/two-party-primitives/src/lib.rs",
        "crates/two-party-primitives/src/decoding.rs",
        "crates/two-party-primitives/src/gate_aes.rs",
        "crates/ed25519-yao/src/passive/runtime.rs",
    ] {
        sources.push(json!({"path": path, "sha256": digest(&fs::read(repository.join(path))?)}));
    }
    let report = json!({
        "schema": "seams.ml-dsa-complete-engine-comparison.v1", "production_eligible": false,
        "source_revision": command_text(Command::new("git").args(["rev-parse", "HEAD"]).current_dir(repository))?,
        "working_tree_dirty": !command_text(Command::new("git").args(["status", "--porcelain"]).current_dir(repository))?.is_empty(),
        "compiler": command_text(Command::new("rustc").args(["--version", "--verbose"]))?,
        "host": command_text(Command::new("uname").args(["-sm"]))?,
        "executable_sha256": digest(&fs::read(env::current_exe()?)?), "sources": sources,
        "keygen_schedules": keygen_schedules, "signing_schedules": signing_schedules,
        "phase_order": ["binding", "preprocessing", "input_setup", "input_online", "online", "output"],
        "scope": "Separate role processes run identical canonical key-generation and signing state machines with fresh private preprocessing. Independent verification precedes authorized disposable-test recovery.",
        "canonical_key_and_deterministic_signature_equal_across_engines": true,
        "globally_distinct_execution_bindings": bindings.len(), "cases": cases,
        "limits": [
            "One measured fixed-key sample after one excluded complete warm-up per engine establishes no percentile or sustained throughput.",
            "Each circuit prepares fresh correlations. No persistent pool, reusable base OT, packed-bit OT, or batched polynomial execution is included.",
            "This is a native sequential pipeline measurement. Network latency, Cloudflare placement, admission, storage, and deployed costs remain unmeasured.",
            "Source and compiled target review remain incomplete. Standard output agreement establishes no cryptographic composition proof.",
            "Recovery uses public disposable fixtures and an explicit test recipient. It establishes no production export authorization."
        ],
        "reproduce_argv": ["cargo", "run", "--release", "--locked", "--manifest-path", "tools/ml-dsa-investigation/Cargo.toml", "--", "compare-complete-engines", output.display().to_string()]
    });
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, serde_json::to_vec_pretty(&report)?)?;
    println!("Wrote complete engine evidence to {}", output.display());
    Ok(())
}

fn insert_binding(bindings: &mut HashSet<String>, metrics: &Value) -> InvestigationResult<()> {
    let binding = metrics["execution_binding_sha256"]
        .as_str()
        .ok_or("Missing complete comparison binding.")?;
    require(
        bindings.insert(binding.to_owned()),
        "Complete comparison reused a circuit execution binding.",
    )
}
