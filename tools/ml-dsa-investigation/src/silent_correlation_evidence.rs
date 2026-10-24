//! Separate-process silent correlations with disposable post-timer verification.

use crate::{
    InvestigationResult,
    boolean_engine_evidence::{PipeTransport, run_ready},
    digest, private_execution, require,
};
use ml_dsa_threshold::{
    ml_dsa_runtime::{
        RuntimeError,
        boolean_comparison::silent::{CHUNK_TRIPLES, generate_chunk},
    },
    ml_dsa_signing::SigningRole,
};
use serde_json::{Value, json};
use std::{env, ffi::OsStr, fs, io, path::Path, time::Instant};
use zeroize::Zeroizing;

pub(super) fn try_run_child() -> InvestigationResult<bool> {
    let args: Vec<_> = env::args().skip(1).collect();
    let role = match args.first().map(String::as_str) {
        Some("silent-role-a") => SigningRole::A,
        Some("silent-role-b") => SigningRole::B,
        _ => return Ok(false),
    };
    require(
        args.len() == 4,
        "Silent role needs binding, share-output, and report paths",
    )?;
    let value: u8 = args[1].parse()?;
    let mut transport = PipeTransport::new(io::stdin().lock(), io::stdout().lock());
    let started = Instant::now();
    let chunk = run_ready(generate_chunk(role, &[value; 32], &mut transport))?;
    let elapsed = started.elapsed().as_nanos();
    let transport_stats = transport.finish();
    let report = match chunk {
        Ok(chunk) => {
            let mut bytes = Zeroizing::new(Vec::with_capacity(CHUNK_TRIPLES * 3));
            for share in chunk.shares() {
                bytes.extend_from_slice(share);
            }
            fs::write(&args[2], bytes.as_slice())?;
            json!({"status":"prepared", "elapsed_ns":elapsed, "triples":chunk.shares().len(), "own_share_sha256":digest(&bytes), "transport":transport_stats})
        }
        Err(RuntimeError::SessionBinding) => {
            json!({"status":"binding-rejected", "elapsed_ns":elapsed, "transport":transport_stats})
        }
        Err(error) => return Err(error.into()),
    };
    fs::write(&args[3], serde_json::to_vec_pretty(&report)?)?;
    Ok(true)
}

fn pair(directory: &Path, mismatch: bool) -> InvestigationResult<Value> {
    let share_a = directory.join("a-shares.bin");
    let share_b = directory.join("b-shares.bin");
    let report_a = directory.join("a.json");
    let report_b = directory.join("b.json");
    private_execution::run_duplex_children(
        &[
            OsStr::new("silent-role-a"),
            OsStr::new("71"),
            share_a.as_os_str(),
            report_a.as_os_str(),
        ],
        &[
            OsStr::new("silent-role-b"),
            OsStr::new(if mismatch { "72" } else { "71" }),
            share_b.as_os_str(),
            report_b.as_os_str(),
        ],
    )?;
    let a_report: Value = serde_json::from_slice(&fs::read(report_a)?)?;
    let b_report: Value = serde_json::from_slice(&fs::read(report_b)?)?;
    if mismatch {
        require(
            a_report["status"] == "binding-rejected" && b_report["status"] == "binding-rejected",
            "Mismatched reservation accepted",
        )?;
        return Ok(json!({"binding_rejected":true,"a":a_report,"b":b_report}));
    }
    let a = Zeroizing::new(fs::read(&share_a)?);
    let b = Zeroizing::new(fs::read(&share_b)?);
    require(
        a.len() == CHUNK_TRIPLES * 3 && b.len() == a.len(),
        "Wrong correlation count",
    )?;
    let mut ones = [0; 6];
    for (index, (a, b)) in a.chunks_exact(3).zip(b.chunks_exact(3)).enumerate() {
        require(
            a.iter().chain(b).all(|value| *value <= 1),
            "Nonbinary correlation",
        )?;
        require(
            (a[0] ^ b[0]) & (a[1] ^ b[1]) == a[2] ^ b[2],
            "Silent triple product differs",
        )?;
        for bit in 0..3 {
            ones[bit] += usize::from(a[bit]);
            ones[3 + bit] += usize::from(b[bit]);
        }
        // Independent public fixture inputs exercise the online AND identity.
        let x0 = (index & 1) as u8;
        let x1 = ((index >> 1) & 1) as u8;
        let y0 = ((index >> 2) & 1) as u8;
        let y1 = ((index >> 3) & 1) as u8;
        let d = x0 ^ a[0] ^ x1 ^ b[0];
        let e = y0 ^ a[1] ^ y1 ^ b[1];
        let z0 = a[2] ^ (d & a[1]) ^ (e & a[0]) ^ (d & e);
        let z1 = b[2] ^ (d & b[1]) ^ (e & b[0]);
        require(z0 ^ z1 == (x0 ^ x1) & (y0 ^ y1), "Shared AND differs")?;
    }
    require(
        ones.iter()
            .all(|count| *count > CHUNK_TRIPLES / 4 && *count < CHUNK_TRIPLES * 3 / 4),
        "Degenerate correlation output",
    )?;
    fs::remove_file(share_a)?;
    fs::remove_file(share_b)?;
    Ok(
        json!({"a":a_report,"b":b_report,"all_triples_verified":true,"all_shared_ands_verified":true,"ones_per_private_component":ones}),
    )
}

pub(super) fn run(output: &Path) -> InvestigationResult<()> {
    require(
        !cfg!(debug_assertions),
        "Run silent correlations in release mode",
    )?;
    let directory = tempfile::tempdir()?;
    let mut cases = Vec::new();
    for index in 0..4 {
        let mut result = pair(directory.path(), false)?;
        result["warmup"] = json!(index == 0);
        cases.push(result);
        eprintln!("Verified silent correlation chunk {index}");
    }
    let rejected = pair(directory.path(), true)?;
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or("Missing repository")?;
    let mut sources = Vec::new();
    for name in [
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/boolean_comparison/silent.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/boolean_comparison/silent/pprf.rs",
        "crates/ml-dsa-threshold/src/ml_dsa_runtime/boolean_comparison/silent/correlation_aes.rs",
        "crates/ed25519-yao/src/passive/ot.rs",
        "tools/ml-dsa-investigation/src/silent_correlation_evidence.rs",
        "tools/ml-dsa-investigation/Cargo.lock",
        "tools/ml-dsa-investigation/src/boolean_engine_evidence.rs",
        "tools/ml-dsa-investigation/src/private_execution.rs",
        "crates/ed25519-yao/Cargo.toml",
        "crates/ed25519-yao/vendor/cryprot-core/Cargo.toml",
        "crates/ed25519-yao/vendor/cryprot-codes/Cargo.toml",
    ] {
        sources.push(json!({"path":name,"sha256":digest(&fs::read(root.join(name))?)}));
    }
    for package in ["cryprot-core", "cryprot-codes"] {
        collect_sources(
            &root
                .join("crates/ed25519-yao/vendor")
                .join(package)
                .join("src"),
            root,
            &mut sources,
        )?;
    }
    let compiler = std::process::Command::new("rustc").arg("-Vv").output()?;
    require(
        compiler.status.success(),
        "Rust compiler metadata unavailable",
    )?;
    let report = json!({
        "schema":"seams.ml-dsa-silent-correlations.v1", "production_eligible":false,
        "profile":{"triples":CHUNK_TRIPLES,"partitions":256,"domain":4096,"parallel_trees":4,"base_ot_choices":3072,"base_payload_bytes":16,"encoder":"CryProt ExConv7x24","minimum_distance_ratio_for_noise_choice":0.15},
        "cases":cases,"mismatched_binding":rejected,"sources":sources,
        "executable_sha256":digest(&fs::read(env::current_exe()?)?),
        "rustc":String::from_utf8(compiler.stdout)?, "host_os":env::consts::OS, "host_arch":env::consts::ARCH,
        "scope":"Separate native roles with fresh real IKNP and fixed-width PPRF. Disposable private correlations are reconstructed only after timing. No dealer supplies them. No complete signing or Worker performance claim.",
        "temporary_private_outputs_removed":true
    });
    fs::write(output, serde_json::to_vec_pretty(&report)?)?;
    Ok(())
}

fn collect_sources(
    directory: &Path,
    root: &Path,
    sources: &mut Vec<Value>,
) -> InvestigationResult<()> {
    let mut paths = fs::read_dir(directory)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort();
    for path in paths {
        if path.is_dir() {
            collect_sources(&path, root, sources)?;
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            sources.push(json!({"path":path.strip_prefix(root)?.to_string_lossy(), "sha256":digest(&fs::read(&path)?)}));
        }
    }
    Ok(())
}
