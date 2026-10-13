use crate::{InvestigationResult, digest, reference::fixture_bytes, require};
use ed25519_yao::phase5_benchmark::ml_dsa_kernel::{
    KernelRoleMetrics, PublicKernelSchedule, evaluate_public_fixture, garble_public_fixture,
};
use ed25519_yao_generator::{MlDsaHashWorkloadV1, compile_ml_dsa_hash_circuit_v1};
use serde_json::{Value, json};
use std::{
    env, fs, io,
    path::Path,
    process::{Command, Stdio},
    time::Instant,
};

const PATTERNS: [&str; 4] = ["zero", "incrementing", "all-ff", "alternating"];

pub(super) fn try_run_child() -> InvestigationResult<bool> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let Some(role) = arguments.first() else {
        return Ok(false);
    };
    if role != "public-kernel-garbler" && role != "public-kernel-evaluator" {
        return Ok(false);
    }
    require(
        arguments.len() == 4,
        "Public kernel child requires schedule, public fixture bits, and result paths.",
    )?;
    let bytes = fs::read(&arguments[1])?;
    let schedule = PublicKernelSchedule::parse(&bytes)?;
    let public_fixture_bits: Vec<bool> = serde_json::from_slice(&fs::read(&arguments[2])?)?;
    let result = match role.as_str() {
        "public-kernel-garbler" => {
            let metrics =
                garble_public_fixture(&schedule, &public_fixture_bits, io::stdout().lock())?;
            json!({"metrics": encode_metrics(&metrics)})
        }
        "public-kernel-evaluator" => {
            let evaluation =
                evaluate_public_fixture(&schedule, &public_fixture_bits, io::stdin().lock())?;
            json!({"metrics": encode_metrics(&evaluation.metrics), "public_output_hex": hex::encode(&evaluation.output)})
        }
        _ => unreachable!("child role was checked"),
    };
    fs::write(&arguments[3], serde_json::to_vec(&result)?)?;
    Ok(true)
}

pub(super) fn run(samples: usize) -> InvestigationResult<Value> {
    require(
        (1..=1000).contains(&samples),
        "Garbled sample count must be between 1 and 1000.",
    )?;
    let mut workloads = vec![
        MlDsaHashWorkloadV1::KeccakF1600,
        MlDsaHashWorkloadV1::SeedExpansion,
    ];
    for nonce in 0..11 {
        workloads.push(MlDsaHashWorkloadV1::ExpandSPolynomial { nonce });
    }
    let mut measurements = Vec::new();
    for workload in workloads {
        measurements.push(measure_workload(workload, samples)?);
    }
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repository = manifest
        .parent()
        .and_then(Path::parent)
        .ok_or("Missing repository path.")?;
    let mut engine_sources = Vec::new();
    for path in [
        "crates/ed25519-yao/src/passive.rs",
        "crates/ed25519-yao/src/passive/gate_aes.rs",
        "crates/ed25519-yao/src/passive/phase5_benchmark/ml_dsa_kernel.rs",
    ] {
        engine_sources.push(
            json!({"repository_path": path, "sha256": digest(&fs::read(repository.join(path))?)}),
        );
    }
    Ok(json!({
        "scope": "Actual half-gate execution in separate local OS processes with fixed public fixtures. The evaluator receives bounded table frames through a direct pipe.",
        "production_eligible": false,
        "two_party_privacy": false,
        "input_transfer": "Both labels for each evaluator input are sent openly. This reveals the global delta. Oblivious transfer and private input security are excluded.",
        "output_policy": "All output bytes are opened as public fixtures. Private output sharing is excluded.",
        "randomness": "Fresh OS input labels, global delta, and nonzero session domain for every workload sample. No secret garbling material is reused.",
        "transport": "Direct child stdout-to-stdin OS pipe; 65,536-byte table frame bound and eight-byte frame headers. These are host measurements, not Cloudflare network measurements.",
        "timing_method": "Role wall duration excludes schedule parsing and process startup. Gate compute wall duration subtracts measured table read/write time. Scheduling and timer overhead remain; these are not CPU-time or billing estimates.",
        "memory_method": "The reusable label arena and table buffer use actual Vec capacities times element size. The public schedule allocation is reported separately. Process RSS, initialization scratch, input-label transfer buffers, allocator overhead, and executable memory are excluded.",
        "engine_sources": engine_sources,
        "samples_per_workload": samples,
        "workloads": measurements,
    }))
}

fn measure_workload(workload: MlDsaHashWorkloadV1, samples: usize) -> InvestigationResult<Value> {
    let circuit = compile_ml_dsa_hash_circuit_v1(workload);
    let directory = tempfile::tempdir()?;
    let schedule_path = directory.path().join("schedule.bin");
    fs::write(&schedule_path, circuit.canonical_schedule_encoding())?;
    let mut measured = Vec::new();
    for sample in 0..samples {
        let name_a = PATTERNS[sample % PATTERNS.len()];
        let name_b = PATTERNS[(sample + 1) % PATTERNS.len()];
        let (input, expected) = fixture_and_expected(workload, name_a, name_b)?;
        require(
            circuit.evaluate_public_fixture(&input)? == expected,
            "Clear schedule differs from independent hash oracle.",
        )?;
        let started = Instant::now();
        let (garbler, evaluator) =
            run_process_pair(&schedule_path, &bytes_to_bits(&input), directory.path())?;
        let pair_wall_ns = started.elapsed().as_nanos();
        let actual = hex::decode(
            evaluator["public_output_hex"]
                .as_str()
                .ok_or("Missing public evaluator output.")?,
        )?;
        require(
            actual == expected,
            "Garbled output differs from independent hash oracle.",
        )?;
        for field in ["table_bytes", "frame_count", "directional_wire_bytes"] {
            require(
                garbler["metrics"][field] == evaluator["metrics"][field],
                "Role transport counters disagree.",
            )?;
        }
        require(
            garbler["metrics"]["table_bytes"].as_u64()
                == Some(circuit.metrics().and_gate_count() * 32),
            "Measured tables differ from generated AND count.",
        )?;
        measured.push(json!({
            "sample": sample,
            "public_pattern_a": name_a,
            "public_pattern_b": name_b,
            "input_sha256": digest(&input),
            "output_sha256": digest(&actual),
            "matches_independent_hash_oracle": true,
            "pair_wall_ns_including_process_startup_and_schedule_parsing": pair_wall_ns,
            "garbler": garbler["metrics"],
            "evaluator": evaluator["metrics"],
            "garbler_to_evaluator_table_bytes": garbler["metrics"]["table_bytes"],
            "evaluator_to_garbler_bytes": 0,
        }));
    }
    Ok(json!({
        "workload": workload_name(workload),
        "public_nonce": match workload { MlDsaHashWorkloadV1::ExpandSPolynomial { nonce } => Some(nonce), _ => None },
        "component_digest": hex::encode(circuit.benchmark_component_digest().expose_public_bytes()),
        "schedule_digest": hex::encode(circuit.benchmark_schedule_digest().expose_public_bytes()),
        "schedule_bytes": circuit.canonical_schedule_encoding().len(),
        "and_gates": circuit.metrics().and_gate_count(),
        "all_outputs_match_independent_hash_oracle": true,
        "samples": measured,
    }))
}

fn run_process_pair(
    schedule_path: &Path,
    public_fixture_bits: &[bool],
    directory: &Path,
) -> InvestigationResult<(Value, Value)> {
    require(
        public_fixture_bits.len().is_multiple_of(2),
        "Public input partition requires an even bit count.",
    )?;
    let middle = public_fixture_bits.len() / 2;
    let fixture_a_path = directory.join("public-fixture-a.json");
    let fixture_b_path = directory.join("public-fixture-b.json");
    fs::write(
        &fixture_a_path,
        serde_json::to_vec(&public_fixture_bits[..middle])?,
    )?;
    fs::write(
        &fixture_b_path,
        serde_json::to_vec(&public_fixture_bits[middle..])?,
    )?;
    let executable = env::current_exe()?;
    let garbler_result_path = directory.join("garbler.json");
    let evaluator_result_path = directory.join("evaluator.json");
    let mut garbler = Command::new(&executable)
        .arg("public-kernel-garbler")
        .arg(schedule_path)
        .arg(&fixture_a_path)
        .arg(&garbler_result_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = garbler
        .stdout
        .take()
        .ok_or("Missing garbler output pipe.")?;
    let evaluator = Command::new(&executable)
        .arg("public-kernel-evaluator")
        .arg(schedule_path)
        .arg(&fixture_b_path)
        .arg(&evaluator_result_path)
        .stdin(Stdio::from(stdout))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn();
    let evaluator = match evaluator {
        Ok(child) => child,
        Err(error) => {
            garbler.kill()?;
            garbler.wait()?;
            return Err(error.into());
        }
    };
    let evaluator_output = evaluator.wait_with_output()?;
    let garbler_output = garbler.wait_with_output()?;
    require(
        garbler_output.status.success(),
        &format!(
            "Garbler child failed: {}",
            String::from_utf8_lossy(&garbler_output.stderr)
        ),
    )?;
    require(
        evaluator_output.status.success(),
        &format!(
            "Evaluator child failed: {}",
            String::from_utf8_lossy(&evaluator_output.stderr)
        ),
    )?;
    Ok((
        serde_json::from_slice(&fs::read(garbler_result_path)?)?,
        serde_json::from_slice(&fs::read(evaluator_result_path)?)?,
    ))
}

fn fixture_and_expected(
    workload: MlDsaHashWorkloadV1,
    name_a: &str,
    name_b: &str,
) -> InvestigationResult<(Vec<u8>, Vec<u8>)> {
    let half = match workload {
        MlDsaHashWorkloadV1::KeccakF1600 => 100,
        _ => 32,
    };
    let a = fixture_bytes(name_a, half)?;
    let b = fixture_bytes(name_b, half)?;
    let mut input = a.clone();
    input.extend_from_slice(&b);
    let expected = match workload {
        MlDsaHashWorkloadV1::KeccakF1600 => crate::circuit_evidence::reference_keccak(&input)?,
        MlDsaHashWorkloadV1::SeedExpansion => {
            let mut seed = Vec::with_capacity(34);
            for index in 0..32 {
                seed.push(a[index] ^ b[index]);
            }
            seed.extend_from_slice(&[6, 5]);
            crate::circuit_evidence::reference_shake256(&seed, 128)
        }
        MlDsaHashWorkloadV1::ExpandSPolynomial { nonce } => {
            let mut hash_input = input.clone();
            hash_input.extend_from_slice(&nonce.to_le_bytes());
            crate::circuit_evidence::reference_shake256(&hash_input, 481)
        }
    };
    Ok((input, expected))
}

fn workload_name(workload: MlDsaHashWorkloadV1) -> &'static str {
    match workload {
        MlDsaHashWorkloadV1::KeccakF1600 => "Keccak-f[1600]",
        MlDsaHashWorkloadV1::SeedExpansion => "ML-DSA-65 seed expansion",
        MlDsaHashWorkloadV1::ExpandSPolynomial { .. } => "ExpandS SHAKE256 481-byte prefix",
    }
}

fn encode_metrics(metrics: &KernelRoleMetrics) -> Value {
    json!({
        "table_bytes": metrics.table_bytes,
        "frame_count": metrics.frame_count,
        "directional_wire_bytes": metrics.directional_wire_bytes,
        "table_buffer_allocation_bytes": metrics.table_buffer_allocation_bytes,
        "label_arena_allocation_bytes": metrics.label_arena_allocation_bytes,
        "schedule_bytes": metrics.schedule_bytes,
        "setup_wall_ns": metrics.setup_wall_ns,
        "gate_compute_wall_ns": metrics.gate_compute_wall_ns,
        "table_io_wall_ns": metrics.table_io_wall_ns,
        "role_wall_ns": metrics.role_wall_ns,
    })
}

fn bytes_to_bits(bytes: &[u8]) -> Vec<bool> {
    let mut bits = Vec::with_capacity(bytes.len() * 8);
    for byte in bytes {
        for bit in 0..8 {
            bits.push((byte >> bit) & 1 == 1);
        }
    }
    bits
}

fn pack_bits(bits: &[bool]) -> Vec<u8> {
    let mut output = vec![0; bits.len().div_ceil(8)];
    for (index, bit) in bits.iter().enumerate() {
        output[index / 8] |= u8::from(*bit) << (index % 8);
    }
    output
}

pub(super) fn benchmark_public_circuit(
    schedule_bytes: &[u8],
    fixture_bits: &[bool],
    expected_bits: &[bool],
    samples: usize,
) -> InvestigationResult<Value> {
    require(
        (1..=1000).contains(&samples),
        "Garbled sample count must be between 1 and 1000.",
    )?;
    let schedule = PublicKernelSchedule::parse(schedule_bytes)?;
    require(
        fixture_bits.len() == schedule.input_wire_count(),
        "Wrong public fixture input bit count.",
    )?;
    require(
        expected_bits.len() == schedule.output_wire_count(),
        "Wrong public oracle output bit count.",
    )?;
    let expected = pack_bits(expected_bits);
    let directory = tempfile::tempdir()?;
    let schedule_path = directory.path().join("schedule.bin");
    fs::write(&schedule_path, schedule_bytes)?;
    let mut measured = Vec::new();
    for sample in 0..samples {
        let started = Instant::now();
        let (garbler, evaluator) =
            run_process_pair(&schedule_path, fixture_bits, directory.path())?;
        let pair_wall_ns = started.elapsed().as_nanos();
        let actual = hex::decode(
            evaluator["public_output_hex"]
                .as_str()
                .ok_or("Missing public evaluator output.")?,
        )?;
        require(
            actual == expected,
            "Garbled output differs from the public fixture oracle.",
        )?;
        for field in ["table_bytes", "frame_count", "directional_wire_bytes"] {
            require(
                garbler["metrics"][field] == evaluator["metrics"][field],
                "Role transport counters disagree.",
            )?;
        }
        measured.push(json!({
            "sample": sample,
            "pair_wall_ns_including_process_startup_and_schedule_parsing": pair_wall_ns,
            "output_sha256": digest(&actual),
            "matches_public_fixture_oracle": true,
            "garbler": garbler["metrics"],
            "evaluator": evaluator["metrics"],
        }));
    }
    Ok(json!({
        "scope": "Separate-process public-fixture half-gates benchmark; open label-pair input transfer provides no privacy.",
        "input_partition": "Each child receives one half of the public bit fixture. This synthetic partition is not a production share-ownership design.",
        "output_bit_count": expected_bits.len(),
        "input_bit_count": fixture_bits.len(),
        "public_input_packed_sha256": digest(&pack_bits(fixture_bits)),
        "schedule_sha256": digest(schedule_bytes),
        "packed_output_bytes": expected.len(),
        "all_outputs_match_public_fixture_oracle": true,
        "samples": measured,
    }))
}
