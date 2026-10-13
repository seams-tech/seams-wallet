use crate::{InvestigationResult, digest, reference::fixture_bytes, require};
use ed25519_yao_generator::{MlDsaHashWorkloadV1, compile_ml_dsa_hash_circuit_v1};
use serde_json::{Value, json};
use sha3::{
    Shake256,
    digest::{ExtendableOutput, Update, XofReader},
};
use std::time::Instant;

const PATTERNS: [&str; 4] = ["zero", "incrementing", "all-ff", "alternating"];

pub(super) fn run() -> InvestigationResult<Value> {
    let mut workloads = Vec::new();
    workloads.push(measure(MlDsaHashWorkloadV1::KeccakF1600)?);
    workloads.push(measure(MlDsaHashWorkloadV1::SeedExpansion)?);
    for nonce in 0..11 {
        workloads.push(measure(MlDsaHashWorkloadV1::ExpandSPolynomial { nonce })?);
    }
    let mut hashing_and_count = 0_u64;
    let mut hashing_ir_bytes = 0_u64;
    let mut hashing_schedule_bytes = 0_u64;
    for workload in workloads.iter().skip(1) {
        hashing_and_count += integer(workload, "and_gates")?;
        hashing_ir_bytes += integer(workload, "canonical_ir_bytes")?;
        hashing_schedule_bytes += integer(workload, "canonical_schedule_bytes")?;
    }
    Ok(json!({
        "scope": "Compiled Boolean hashing kernels and cleartext fixture evaluation. No garbling, oblivious transfer, two-party execution, or secure output sharing occurs.",
        "oracles": {"keccak_permutation": "keccak::f1600 =0.1.6", "shake256": "sha3::Shake256 =0.10.8"},
        "count_method": "Counts and encodings come from the finalized generator IR and liveness schedule. Half-gate table bytes estimate 32 bytes per AND for 128-bit labels.",
        "fixed_expand_s_prefix": "Each polynomial kernel emits 481 SHAKE256 bytes. Sampling and exceptional prefix exhaustion remain unimplemented. This fixed prefix is not a complete ExpandS algorithm.",
        "excluded_from_traffic_estimate": ["ExpandS rejection sampler", "arithmetic operations", "Power2Round", "Boolean/arithmetic conversions", "input/output labels", "oblivious transfer", "authentication and framing"],
        "seed_and_11_polynomial_prefixes": {
            "and_gates": hashing_and_count,
            "halfgate_table_bytes_estimate": hashing_and_count * 32,
            "canonical_ir_bytes_sum": hashing_ir_bytes,
            "canonical_schedule_bytes_sum": hashing_schedule_bytes,
            "limit": "The sum is for hashing alone. IR and schedule bytes describe local compiled artifacts. They are not network payload measurements."
        },
        "workloads": workloads,
    }))
}

fn integer(value: &Value, field: &str) -> InvestigationResult<u64> {
    value[field]
        .as_u64()
        .ok_or_else(|| format!("Missing integer field: {field}").into())
}

fn measure(workload: MlDsaHashWorkloadV1) -> InvestigationResult<Value> {
    let start = Instant::now();
    let circuit = compile_ml_dsa_hash_circuit_v1(workload);
    let compilation_ns = start.elapsed().as_nanos();
    let metrics = circuit.metrics();
    let schedule = circuit.schedule_metrics();
    let mut fixtures = Vec::new();
    match workload {
        MlDsaHashWorkloadV1::KeccakF1600 => {
            for name in PATTERNS {
                let input = fixture_bytes(name, 200)?;
                let expected = reference_keccak(&input)?;
                fixtures.push(evaluate(&circuit, name, &input, &expected)?);
            }
        }
        MlDsaHashWorkloadV1::SeedExpansion => {
            for name_a in PATTERNS {
                for name_b in PATTERNS {
                    let a = fixture_bytes(name_a, 32)?;
                    let b = fixture_bytes(name_b, 32)?;
                    let mut input = a.clone();
                    input.extend_from_slice(&b);
                    let mut seed_input = Vec::with_capacity(34);
                    for index in 0..32 {
                        seed_input.push(a[index] ^ b[index]);
                    }
                    seed_input.extend_from_slice(&[6, 5]);
                    let expected = reference_shake256(&seed_input, 128);
                    fixtures.push(evaluate(
                        &circuit,
                        &format!("share-a:{name_a},share-b:{name_b}"),
                        &input,
                        &expected,
                    )?);
                }
            }
        }
        MlDsaHashWorkloadV1::ExpandSPolynomial { nonce } => {
            for name in PATTERNS {
                let input = fixture_bytes(name, 64)?;
                let mut hash_input = input.clone();
                hash_input.extend_from_slice(&nonce.to_le_bytes());
                let expected = reference_shake256(&hash_input, 481);
                fixtures.push(evaluate(&circuit, name, &input, &expected)?);
            }
        }
    }
    let expected_input_bytes = (metrics.input_wire_count() / 8) as usize;
    let mut malformed_lengths = Vec::new();
    for actual_bytes in [0, expected_input_bytes - 1, expected_input_bytes + 1] {
        let error = circuit
            .evaluate_public_fixture(&vec![0; actual_bytes])
            .err()
            .ok_or("Malformed fixture length was accepted.")?;
        require(
            error.expected_bytes == expected_input_bytes && error.actual_bytes == actual_bytes,
            "Malformed fixture length returned incorrect diagnostics.",
        )?;
        malformed_lengths.push(json!({
            "actual_bytes": actual_bytes,
            "expected_bytes": error.expected_bytes,
            "rejected": true,
        }));
    }
    let (name, nonce, permutations) = match workload {
        MlDsaHashWorkloadV1::KeccakF1600 => ("Keccak-f[1600], full 24 rounds", None, 1),
        MlDsaHashWorkloadV1::SeedExpansion => {
            ("SHAKE256((share_a XOR share_b) || [6,5],128)", None, 1)
        }
        MlDsaHashWorkloadV1::ExpandSPolynomial { nonce } => {
            ("SHAKE256(rho_prime || LE16(nonce),481)", Some(nonce), 4)
        }
    };
    Ok(json!({
        "workload": name,
        "public_nonce": nonce,
        "keccak_f1600_permutations": permutations,
        "input_bytes": expected_input_bytes,
        "output_bytes": metrics.output_wire_count() / 8,
        "and_gates": metrics.and_gate_count(),
        "xor_gates": metrics.xor_gate_count(),
        "inversion_gates": metrics.inversion_gate_count(),
        "total_gates": metrics.total_gate_count(),
        "wires": metrics.wire_count(),
        "circuit_depth": metrics.circuit_depth(),
        "and_depth": metrics.and_depth(),
        "reusable_schedule_slots": schedule.reusable_slot_count(),
        "label_slot_memory_bytes_estimate": schedule.reusable_slot_count() * 16,
        "canonical_ir_bytes": metrics.canonical_encoding_bytes(),
        "canonical_schedule_bytes": schedule.encoded_schedule_bytes(),
        "halfgate_table_bytes_estimate": metrics.and_gate_count() * 32,
        "component_digest": hex::encode(circuit.benchmark_component_digest().expose_public_bytes()),
        "schedule_digest": hex::encode(circuit.benchmark_schedule_digest().expose_public_bytes()),
        "compile_wall_time_ns": compilation_ns,
        "all_fixture_outputs_match_independent_hash_oracle": true,
        "malformed_fixture_lengths": malformed_lengths,
        "fixtures": fixtures,
    }))
}

fn evaluate(
    circuit: &ed25519_yao_generator::MlDsaHashCircuitV1,
    name: &str,
    input: &[u8],
    expected: &[u8],
) -> InvestigationResult<Value> {
    let start = Instant::now();
    let actual = circuit.evaluate_public_fixture(input)?;
    let elapsed_ns = start.elapsed().as_nanos();
    require(
        actual == expected,
        &format!("Circuit output differs from hash oracle for {name}."),
    )?;
    Ok(json!({
        "public_pattern": name,
        "input_sha256": digest(input),
        "output_sha256": digest(&actual),
        "output_bytes": actual.len(),
        "cleartext_boolean_evaluation_wall_time_ns": elapsed_ns,
    }))
}

fn reference_shake256(input: &[u8], length: usize) -> Vec<u8> {
    let mut hash = Shake256::default();
    hash.update(input);
    let mut output = vec![0; length];
    hash.finalize_xof().read(&mut output);
    output
}

fn reference_keccak(input: &[u8]) -> InvestigationResult<Vec<u8>> {
    require(input.len() == 200, "Keccak fixture requires 200 bytes.")?;
    let mut lanes = [0_u64; 25];
    for (index, bytes) in input.chunks_exact(8).enumerate() {
        lanes[index] = u64::from_le_bytes(bytes.try_into()?);
    }
    keccak::f1600(&mut lanes);
    let mut output = Vec::with_capacity(200);
    for lane in lanes {
        output.extend_from_slice(&lane.to_le_bytes());
    }
    Ok(output)
}
