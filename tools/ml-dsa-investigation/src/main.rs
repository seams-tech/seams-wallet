mod circuit_evidence;
mod garbled_execution;
mod hybrid_keygen;
mod private_execution;
mod private_keygen;
mod reference;
mod rounding_evidence;
mod sampler_evidence;
mod signing_mask_evidence;
mod worker_fixtures;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{env, error::Error, fs, path::PathBuf, process::Command, time::SystemTime};

type InvestigationResult<T> = Result<T, Box<dyn Error>>;

enum Invocation {
    ExportWorkerFixtures {
        directory: PathBuf,
    },
    Report {
        output: PathBuf,
        samples: usize,
        garbled_samples: usize,
    },
    RecoverPublicFixture {
        name: String,
    },
}

fn main() {
    if let Err(error) = run() {
        eprintln!("ML-DSA investigation failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> InvestigationResult<()> {
    if signing_mask_evidence::try_run_child()? {
        return Ok(());
    }
    if private_keygen::try_run_child()? {
        return Ok(());
    }
    if garbled_execution::try_run_child()? {
        return Ok(());
    }
    match parse_invocation()? {
        Invocation::ExportWorkerFixtures { directory } => {
            println!(
                "{}",
                serde_json::to_string(&worker_fixtures::export(&directory)?)?
            );
        }
        Invocation::RecoverPublicFixture { name } => {
            let recovery = reference::recover_public_fixture(&name)?;
            println!("{}", serde_json::to_string(&recovery)?);
        }
        Invocation::Report {
            output,
            samples,
            garbled_samples,
        } => {
            require(
                !cfg!(debug_assertions),
                "Run benchmarks with cargo run --release.",
            )?;
            let report = generate_report(samples, garbled_samples, &output)?;
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&output, serde_json::to_vec_pretty(&report)?)?;
            println!("Wrote public-fixture evidence to {}", output.display());
        }
    }
    Ok(())
}

fn parse_invocation() -> InvestigationResult<Invocation> {
    let mut args = env::args().skip(1);
    if let Some(first) = args.next() {
        if first == "export-worker-fixtures" {
            let directory = PathBuf::from(
                args.next()
                    .ok_or("A fixture output directory is required.")?,
            );
            require(args.next().is_none(), "Unexpected fixture export argument.")?;
            return Ok(Invocation::ExportWorkerFixtures { directory });
        }
        if first == "recover-public-fixture" {
            let name = args.next().ok_or("A public fixture name is required.")?;
            require(args.next().is_none(), "Unexpected recovery argument.")?;
            return Ok(Invocation::RecoverPublicFixture { name });
        }
        let mut output = PathBuf::from(".artifacts/ml-dsa-investigation.json");
        let mut samples = 20;
        let mut garbled_samples = 3;
        parse_report_argument(
            &first,
            &mut args,
            &mut output,
            &mut samples,
            &mut garbled_samples,
        )?;
        while let Some(argument) = args.next() {
            parse_report_argument(
                &argument,
                &mut args,
                &mut output,
                &mut samples,
                &mut garbled_samples,
            )?;
        }
        return Ok(Invocation::Report {
            output,
            samples,
            garbled_samples,
        });
    }
    Ok(Invocation::Report {
        output: PathBuf::from(".artifacts/ml-dsa-investigation.json"),
        samples: 20,
        garbled_samples: 3,
    })
}

fn parse_report_argument(
    argument: &str,
    args: &mut impl Iterator<Item = String>,
    output: &mut PathBuf,
    samples: &mut usize,
    garbled_samples: &mut usize,
) -> InvestigationResult<()> {
    match argument {
        "--output" => *output = PathBuf::from(args.next().ok_or("--output needs a path.")?),
        "--samples" => {
            *samples = args.next().ok_or("--samples needs a number.")?.parse()?;
            require(
                (1..=1000).contains(samples),
                "--samples must be between 1 and 1000.",
            )?;
        }
        "--garbled-samples" => {
            *garbled_samples = args
                .next()
                .ok_or("--garbled-samples needs a number.")?
                .parse()?;
            require(
                (1..=100).contains(garbled_samples),
                "--garbled-samples must be between 1 and 100.",
            )?;
        }
        _ => {
            return Err(format!(
                "Unknown argument: {argument}. Only public fixtures are supported."
            )
            .into());
        }
    }
    Ok(())
}

fn generate_report(
    samples: usize,
    garbled_samples: usize,
    output: &std::path::Path,
) -> InvestigationResult<Value> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repository = manifest
        .parent()
        .and_then(std::path::Path::parent)
        .ok_or("Missing repository path.")?;
    let revision = command_text(
        Command::new("git")
            .arg("rev-parse")
            .arg("HEAD")
            .current_dir(repository),
    )?;
    let dirty = !command_text(
        Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(repository),
    )?
    .is_empty();
    let compiler = command_text(Command::new("rustc").args(["--version", "--verbose"]))?;
    let host = command_text(Command::new("uname").args(["-sm"]))?;
    let mut sources = Vec::new();
    for path in [
        "Cargo.toml",
        "Cargo.lock",
        "src/main.rs",
        "src/reference.rs",
        "src/circuit_evidence.rs",
        "src/sampler_evidence.rs",
        "src/garbled_execution.rs",
        "src/hybrid_keygen.rs",
        "src/private_execution.rs",
        "src/private_keygen.rs",
        "src/rounding_evidence.rs",
        "src/signing_mask_evidence.rs",
        "src/worker_fixtures.rs",
    ] {
        sources.push(json!({"path": path, "sha256": digest(&fs::read(manifest.join(path))?)}));
    }
    for path in [
        "tools/ed25519-yao-generator/src/circuit/keccak.rs",
        "tools/ed25519-yao-generator/src/circuit/ir.rs",
        "tools/ed25519-yao-generator/src/circuit/schedule.rs",
        "tools/ed25519-yao-generator/src/circuit/ml_dsa_sampling.rs",
        "tools/ed25519-yao-generator/src/circuit/ml_dsa_arithmetic.rs",
        "tools/ed25519-yao-generator/src/circuit/ml_dsa_rounding.rs",
        "tools/ed25519-yao-generator/src/circuit/ml_dsa_keygen.rs",
        "tools/ed25519-yao-generator/src/circuit/ml_dsa_signing_mask.rs",
        "crates/ed25519-yao/src/passive.rs",
        "crates/ed25519-yao/src/passive/gate_aes.rs",
        "crates/ed25519-yao/src/passive/runtime.rs",
        "crates/ed25519-yao/src/passive/ot.rs",
        "crates/ed25519-yao/src/passive/phase5_benchmark/ml_dsa_kernel.rs",
        "crates/ed25519-yao/src/passive/phase5_benchmark/ml_dsa_private.rs",
    ] {
        sources.push(
            json!({"repository_path": path, "sha256": digest(&fs::read(repository.join(path))?)}),
        );
    }
    Ok(json!({
        "schema": "seams.ml-dsa-investigation.v3",
        "benchmark_only": true,
        "production_eligible": false,
        "created_at_unix_ms": SystemTime::now().duration_since(SystemTime::UNIX_EPOCH)?.as_millis(),
        "scope": "Host reference interoperability, public Boolean kernel benchmarks, and private 18-kernel two-process key generation with authorized test export. No complete threshold signer exists in this tool.",
        "security_limits": [
            "This tool uses fixed public fixtures and one disposable joint-random key that becomes public only after authorized test export. It must never process wallet secrets.",
            "Reference and authorized recipient processes materialize complete private keys. Normal private key-generation roles receive only their own inputs and outputs.",
            "Reference interoperability does not prove two-party privacy, threshold signing security, or FIPS module validation.",
            "Public kernel benchmarks expose fixture labels. The separately reported private pipeline uses genuine passive OT; shared-host processes do not establish production isolation.",
            "Host timings do not measure Cloudflare CPU time, network latency, or deployed cost."
        ],
        "source": {"revision": revision, "working_tree_dirty": dirty, "files": sources},
        "environment": {"compiler": compiler, "host": host, "profile": "release", "architecture": env::consts::ARCH, "operating_system": env::consts::OS},
        "dependencies": {"ml-dsa": "=0.1.1", "sha2": "=0.10.9", "sha3": "=0.10.8", "keccak": "=0.1.6", "remaining_versions": "Cargo.lock"},
        "reproduce_argv": ["cargo", "run", "--release", "--locked", "--manifest-path", "tools/ml-dsa-investigation/Cargo.toml", "--", "--samples", samples.to_string(), "--garbled-samples", garbled_samples.to_string(), "--output", output.display().to_string()],
        "reference": reference::run(samples)?,
        "hash_circuits": circuit_evidence::run()?,
        "sampling_and_conversion": sampler_evidence::run(garbled_samples)?,
        "power2round": rounding_evidence::run(garbled_samples)?,
        "garbled_execution": garbled_execution::run(garbled_samples)?,
        "hybrid_key_generation": hybrid_keygen::run()?,
        "private_key_generation": private_keygen::run()?,
        "private_signing_mask": signing_mask_evidence::run(garbled_samples)?,
    }))
}

fn require(condition: bool, message: &str) -> InvestigationResult<()> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn command_text(command: &mut Command) -> InvestigationResult<String> {
    let output = command.output()?;
    require(
        output.status.success(),
        &String::from_utf8_lossy(&output.stderr),
    )?;
    Ok(String::from_utf8(output.stdout)?.trim().to_owned())
}
