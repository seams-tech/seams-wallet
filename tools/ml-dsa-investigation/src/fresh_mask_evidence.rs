//! Isolated private conversion experiment. The live signer still uses ExpandMask.

use crate::{
    InvestigationResult, circuit_evidence, digest, private_execution, private_keygen, require,
    signing_mask_evidence,
};
use ed25519_yao::phase5_benchmark::ml_dsa_private::{
    PrivateKernelSchedule, evaluate_private_fixture, garble_private_fixture,
};
use ed25519_yao_generator::{
    MlDsaSigningWorkloadV1, compile_ml_dsa_private_signing_circuit_v1,
    compile_ml_dsa_private_signing_mask_circuit_v1,
};
use serde_json::{Value, json};
use std::{collections::HashSet, env, ffi::OsStr, fs, io, path::Path, time::Instant};
use zeroize::Zeroizing;

pub(super) fn try_run_child() -> InvestigationResult<bool> {
    let args: Vec<String> = env::args().skip(1).collect();
    let garbler = match args.first().map(String::as_str) {
        Some("fresh-mask-role-a") => true,
        Some("fresh-mask-role-b") => false,
        _ => return Ok(false),
    };
    require(
        args.len() == 4,
        "Fresh-mask role needs schedule, own input, and result paths.",
    )?;
    let schedule_bytes = fs::read(&args[1])?;
    require(
        schedule_bytes.get(8) == Some(&0x92),
        "Fresh-mask role received another circuit.",
    )?;
    let schedule = PrivateKernelSchedule::parse(&schedule_bytes)?;
    let input = Zeroizing::new(fs::read(&args[2])?);
    require(
        input.iter().all(|value| *value <= 1),
        "Fixture input contains a non-bit.",
    )?;
    let bits = Zeroizing::new(input.iter().map(|value| *value != 0).collect::<Vec<bool>>());
    let result = if garbler {
        garble_private_fixture(&schedule, &bits, io::stdin().lock(), io::stdout().lock())?
    } else {
        evaluate_private_fixture(&schedule, &bits, io::stdin().lock(), io::stdout().lock())?
    };
    require(
        result.output.len() == if garbler { 0 } else { 736 },
        "Fresh-mask output ownership changed.",
    )?;
    private_keygen::write_private_file(
        Path::new(&args[3]),
        &serde_json::to_vec(&json!({
            "output_hex": hex::encode(result.output.as_slice()),
            "metrics": private_execution::encode_metrics(&result.metrics),
        }))?,
    )?;
    Ok(true)
}

pub(super) fn run(output: &Path) -> InvestigationResult<()> {
    let workload = MlDsaSigningWorkloadV1::FreshMaskConversion;
    let circuit = compile_ml_dsa_private_signing_circuit_v1(workload);
    let baseline = compile_ml_dsa_private_signing_mask_circuit_v1();
    let directory = tempfile::tempdir()?;
    let schedule_path = directory.path().join("fresh-mask.bin");
    fs::write(&schedule_path, circuit.canonical_schedule_encoding())?;
    let seed = [0x5a; 64];
    let mut cases = Vec::new();
    let mut bindings = HashSet::new();
    // The test recipient knows disposable SHAKE streams. Each child sees only
    // its XOR share. This checks FIPS coefficient mapping, not a signing proof.
    for nonce in [0u16, 4, 5, 4104, u16::MAX] {
        let mut message = seed.to_vec();
        message.extend_from_slice(&nonce.to_le_bytes());
        let stream = circuit_evidence::reference_shake256(&message, 640);
        let expected = signing_mask_evidence::reference_coefficients(&seed, nonce);
        cases.push(run_case(
            directory.path(),
            &schedule_path,
            &format!("nonce-{nonce}"),
            &stream,
            &expected,
            &mut bindings,
        )?);
    }
    for (name, byte, value) in [("all-zero", 0, 524288), ("all-one", 255, 8380417 - 524287)] {
        cases.push(run_case(
            directory.path(),
            &schedule_path,
            name,
            &[byte; 640],
            &[value; 256],
            &mut bindings,
        )?);
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or("Missing repository root.")?;
    let mut sources = Vec::new();
    for path in [
        "tools/ml-dsa-investigation/src/fresh_mask_evidence.rs",
        "tools/ml-dsa-investigation/src/signing_mask_evidence.rs",
        "tools/ed25519-yao-generator/src/circuit/ml_dsa_signing.rs",
        "tools/ed25519-yao-generator/src/circuit/ml_dsa_signing_mask.rs",
        "tools/ed25519-yao-generator/src/circuit/ir.rs",
        "crates/ed25519-yao/src/passive/ml_dsa_runtime.rs",
        "crates/ed25519-yao/src/passive/ot.rs",
    ] {
        sources.push(json!({"path": path, "sha256": digest(&fs::read(root.join(path))?)}));
    }
    let temporary_path = directory.path().to_owned();
    directory.close()?;
    require(
        !temporary_path.exists(),
        "Fresh-mask fixture cleanup failed.",
    )?;
    let report = json!({
        "schema": "seams.ml-dsa-fresh-mask-conversion.v1",
        "production_eligible": false,
        "scope": "Seven separate-process private conversion cases with fresh OT and independent FIPS mapping checks. No alternative complete signer, preprocessing pool, or hosted latency is measured.",
        "limits": [
            "Fresh independent entropy would replace the message-bound signing-mask derivation. Exact deterministic FIPS signing bytes and the existing hedged derivation are not preserved by that proposed change.",
            "This primitive does not alter canonical key generation, seed export, or wallet-seed recovery.",
            "The live signer does not call this circuit. A composition argument and one-use state are required before adopting the alternative signing construction.",
            "The test recipient knows synthetic input streams and checks output shares after execution. Shared-host fixture files provide no isolation claim.",
            "Host timings include fresh OT and process startup. They are not Cloudflare latency predictions."
        ],
        "sources": sources,
        "executable_sha256": digest(&fs::read(env::current_exe()?)?),
        "schedule_sha256": digest(circuit.canonical_schedule_encoding()),
        "baseline_schedule_sha256": digest(baseline.canonical_schedule_encoding()),
        "baseline_mask_and_gates": baseline.metrics().and_gate_count(),
        "conversion_and_gates": circuit.metrics().and_gate_count(),
        "baseline_table_bytes": baseline.metrics().and_gate_count() * 32,
        "conversion_table_bytes": circuit.metrics().and_gate_count() * 32,
        "a_input_bits": workload.garbler_input_bits(), "b_input_bits": workload.evaluator_input_bits(),
        "fresh_execution_bindings": bindings.len(), "temporary_files_removed": true,
        "cases": cases,
    });
    fs::write(output, serde_json::to_vec_pretty(&report)?)?;
    println!("Wrote private fresh-mask evidence to {}", output.display());
    Ok(())
}

fn run_case(
    directory: &Path,
    schedule: &Path,
    name: &str,
    stream: &[u8],
    expected: &[u32; 256],
    bindings: &mut HashSet<String>,
) -> InvestigationResult<Value> {
    let mut contribution = Zeroizing::new([0; 640]);
    getrandom::getrandom(contribution.as_mut())?;
    let masks = signing_mask_evidence::uniform_masks()?;
    let mut a = Zeroizing::new(Vec::with_capacity(11008));
    let mut b = Zeroizing::new(Vec::with_capacity(5120));
    for index in 0..640 {
        for bit in 0..8 {
            a.push((contribution[index] >> bit) & 1);
            b.push(((contribution[index] ^ stream[index]) >> bit) & 1);
        }
    }
    for mask in masks.iter() {
        for bit in 0..23 {
            a.push(((mask >> bit) & 1) as u8);
        }
    }
    let input_a = directory.join(format!("{name}-a.bin"));
    let input_b = directory.join(format!("{name}-b.bin"));
    let result_a = directory.join(format!("{name}-a.json"));
    let result_b = directory.join(format!("{name}-b.json"));
    private_keygen::write_private_file(&input_a, &a)?;
    private_keygen::write_private_file(&input_b, &b)?;
    let started = Instant::now();
    private_execution::run_duplex_children(
        &[
            OsStr::new("fresh-mask-role-a"),
            schedule.as_os_str(),
            input_a.as_os_str(),
            result_a.as_os_str(),
        ],
        &[
            OsStr::new("fresh-mask-role-b"),
            schedule.as_os_str(),
            input_b.as_os_str(),
            result_b.as_os_str(),
        ],
    )?;
    let elapsed = started.elapsed().as_nanos();
    let a: Value = serde_json::from_slice(&fs::read(&result_a)?)?;
    let b: Value = serde_json::from_slice(&fs::read(&result_b)?)?;
    require(a["output_hex"] == "", "A received a decoded mask.")?;
    let bytes = hex::decode(b["output_hex"].as_str().ok_or("B output missing.")?)?;
    let own_b = signing_mask_evidence::decode_output(&bytes)?;
    signing_mask_evidence::check_shares(&masks, &own_b, expected)?;
    for field in [
        "table_bytes",
        "ot_wire_bytes",
        "garbler_to_evaluator_wire_bytes",
        "evaluator_to_garbler_wire_bytes",
        "execution_binding_sha256",
    ] {
        require(
            a["metrics"][field] == b["metrics"][field],
            "Role counters disagree.",
        )?;
    }
    let binding = a["metrics"]["execution_binding_sha256"]
        .as_str()
        .ok_or("Execution binding missing.")?;
    require(
        bindings.insert(binding.into()),
        "Conversion reused an execution binding.",
    )?;
    Ok(
        json!({"case": name, "mapping_verified": true, "a_decoded_output_bytes": 0, "b_decoded_output_bytes": bytes.len(), "process_pair_wall_ns": elapsed, "role_a": a["metrics"], "role_b": b["metrics"]}),
    )
}
