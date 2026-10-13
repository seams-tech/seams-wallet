use crate::{InvestigationResult, digest, reference::fixture_bytes, require};
use ed25519_yao_generator::{MlDsaEta4SamplingCircuitV1, compile_ml_dsa_eta4_sampling_circuit_v1};
use serde_json::{Value, json};
use sha3::{
    Shake256,
    digest::{ExtendableOutput, Update, XofReader},
};
use std::time::Instant;

const MODULUS: u32 = 8_380_417;
const PREFIX_BYTES: usize = 481;
const COEFFICIENTS: usize = 256;

pub(super) fn run(garbled_samples: usize) -> InvestigationResult<Value> {
    let start = Instant::now();
    let circuit = compile_ml_dsa_eta4_sampling_circuit_v1();
    let compile_ns = start.elapsed().as_nanos();
    let metrics = circuit.metrics();
    let schedule = circuit.schedule_metrics();
    let mut cases = Vec::new();
    for seed_name in ["zero", "incrementing", "all-ff", "alternating"] {
        let mut seed_input = fixture_bytes(seed_name, 32)?;
        seed_input.extend_from_slice(&[6, 5]);
        let expanded = shake(&seed_input, 128);
        for nonce in 0_u16..11 {
            let mut input = expanded[32..96].to_vec();
            input.extend_from_slice(&nonce.to_le_bytes());
            let prefix: [u8; PREFIX_BYTES] = shake(&input, PREFIX_BYTES).try_into().unwrap();
            cases.push(check_case(
                &circuit,
                &format!("canonical-seed:{seed_name},nonce:{nonce}"),
                &prefix,
                &mixed_masks(),
            )?);
        }
    }
    for accepted_count in [0, 1, 127, 128, 255, 256, 257, 511, 512, 961, 962] {
        for at_end in [false, true] {
            let prefix = ordered_prefix(accepted_count, at_end);
            cases.push(check_case(
                &circuit,
                &format!("accepted:{accepted_count},at-end:{at_end}"),
                &prefix,
                &mixed_masks(),
            )?);
        }
    }
    let full_prefix = ordered_prefix(PREFIX_BYTES * 2, false);
    for (name, masks) in [
        ("zero", [0; COEFFICIENTS]),
        ("q-minus-one", [MODULUS - 1; COEFFICIENTS]),
    ] {
        cases.push(check_case(&circuit, name, &full_prefix, &masks)?);
    }
    let mut invalid_masks = mixed_masks();
    invalid_masks[255] = MODULUS;
    let error = circuit
        .evaluate_public_fixture(&full_prefix, &invalid_masks)
        .err()
        .ok_or("Sampler accepted a noncanonical mask residue.")?;
    require(
        error.mask_index == 255 && error.mask_value == MODULUS,
        "Incorrect invalid-mask diagnostic.",
    )?;
    let masks = mixed_masks();
    let successful_prefix = ordered_prefix(PREFIX_BYTES * 2, false);
    let failed_prefix = [0xff; PREFIX_BYTES];
    let garbled_success =
        benchmark_sampling(&circuit, &successful_prefix, &masks, garbled_samples)?;
    let garbled_exhaustion = benchmark_sampling(&circuit, &failed_prefix, &masks, 1)?;
    Ok(json!({
        "scope": "Fixed 481-byte eta=4 sampling, stable oblivious coefficient compaction, and additive output-share conversion. Independent cleartext validation and public-fixture half-gates execution.",
        "mask_formation": "Real A inputs must be independent uniform residues below q. Fixture masks are deterministic boundary probes and have no secrecy claim.",
        "failure_contract": "Fewer than 256 accepted nibbles returns success=false and zero B-share output. A protocol must destroy all intermediate samples and both output shares on failure. It must retain xi and must not automatically reseed.",
        "and_gates": metrics.and_gate_count(),
        "xor_gates": metrics.xor_gate_count(),
        "inversion_gates": metrics.inversion_gate_count(),
        "total_gates": metrics.total_gate_count(),
        "and_depth": metrics.and_depth(),
        "input_bits": metrics.input_wire_count(),
        "output_bits": metrics.output_wire_count(),
        "reusable_schedule_slots": schedule.reusable_slot_count(),
        "canonical_ir_bytes": metrics.canonical_encoding_bytes(),
        "canonical_schedule_bytes": schedule.encoded_schedule_bytes(),
        "component_digest": hex::encode(circuit.benchmark_component_digest().expose_public_bytes()),
        "schedule_digest": hex::encode(circuit.benchmark_schedule_digest().expose_public_bytes()),
        "compile_wall_time_ns": compile_ns,
        "halfgate_table_bytes_estimate_one_polynomial": metrics.and_gate_count() * 32,
        "halfgate_table_bytes_estimate_eleven_polynomials": metrics.and_gate_count() * 32 * 11,
        "excluded_work": ["mask generation", "private seed-to-prefix composition", "oblivious transfer", "private output delivery", "local lattice arithmetic", "rounding", "signing"],
        "invalid_mask_rejected": true,
        "all_coefficients_order_and_reconstructed_residues_match": true,
        "garbled_success": garbled_success,
        "garbled_exhaustion": garbled_exhaustion,
        "cases": cases,
    }))
}

fn benchmark_sampling(
    circuit: &MlDsaEta4SamplingCircuitV1,
    prefix: &[u8; PREFIX_BYTES],
    masks: &[u32; COEFFICIENTS],
    samples: usize,
) -> InvestigationResult<Value> {
    let mut inputs = Vec::with_capacity(PREFIX_BYTES * 8 + COEFFICIENTS * 23);
    for byte in prefix {
        for bit in 0..8 {
            inputs.push(byte >> bit & 1 == 1);
        }
    }
    for mask in masks {
        for bit in 0..23 {
            inputs.push(mask >> bit & 1 == 1);
        }
    }
    let coefficients = reference_coefficients(prefix);
    let success = coefficients.len() == COEFFICIENTS;
    let mut expected = Vec::with_capacity(1 + COEFFICIENTS * 23);
    expected.push(success);
    for (index, mask) in masks.iter().copied().enumerate() {
        let share_b = if success {
            (i64::from(coefficients[index]) - i64::from(mask)).rem_euclid(i64::from(MODULUS)) as u32
        } else {
            0
        };
        for bit in 0..23 {
            expected.push(share_b >> bit & 1 == 1);
        }
    }
    crate::garbled_execution::benchmark_public_circuit(
        circuit.canonical_schedule_encoding(),
        &inputs,
        &expected,
        samples,
    )
}

fn check_case(
    circuit: &MlDsaEta4SamplingCircuitV1,
    name: &str,
    prefix: &[u8; PREFIX_BYTES],
    masks: &[u32; COEFFICIENTS],
) -> InvestigationResult<Value> {
    let expected = reference_coefficients(prefix);
    let start = Instant::now();
    let actual = circuit.evaluate_public_fixture(prefix, masks)?;
    let elapsed_ns = start.elapsed().as_nanos();
    let success = expected.len() == COEFFICIENTS;
    require(
        actual.success == success,
        &format!("Sampler success differs for {name}."),
    )?;
    if success {
        for (index, coefficient) in expected.iter().copied().enumerate() {
            let expected_b = (i64::from(coefficient) - i64::from(masks[index]))
                .rem_euclid(i64::from(MODULUS)) as u32;
            require(
                actual.deriver_b_shares[index] == expected_b,
                &format!("Sampler B share differs for {name}, coefficient {index}."),
            )?;
            require(
                actual.deriver_b_shares[index] < MODULUS,
                "Sampler returned a noncanonical residue.",
            )?;
            let reconstructed = (u64::from(masks[index])
                + u64::from(actual.deriver_b_shares[index]))
                % u64::from(MODULUS);
            require(
                reconstructed == i64::from(coefficient).rem_euclid(i64::from(MODULUS)) as u64,
                "Sampler reconstruction differs.",
            )?;
        }
    } else {
        require(
            actual.deriver_b_shares == [0; COEFFICIENTS],
            "Sampler failure exposed a nonzero B share.",
        )?;
    }
    let mut output_bytes = Vec::with_capacity(COEFFICIENTS * 4);
    for share in actual.deriver_b_shares {
        output_bytes.extend_from_slice(&share.to_le_bytes());
    }
    Ok(json!({
        "case": name,
        "prefix_sha256": digest(prefix),
        "accepted_count_capped_at_256": expected.len(),
        "success": success,
        "b_share_sha256": digest(&output_bytes),
        "cleartext_boolean_evaluation_wall_time_ns": elapsed_ns,
    }))
}

fn reference_coefficients(prefix: &[u8; PREFIX_BYTES]) -> Vec<i32> {
    let mut coefficients = Vec::with_capacity(COEFFICIENTS);
    for byte in prefix {
        for nibble in [byte & 15, byte >> 4] {
            if nibble < 9 && coefficients.len() < COEFFICIENTS {
                coefficients.push(4 - i32::from(nibble));
            }
        }
    }
    coefficients
}

fn ordered_prefix(accepted_count: usize, at_end: bool) -> [u8; PREFIX_BYTES] {
    let mut prefix = [0xff; PREFIX_BYTES];
    let start = if at_end {
        PREFIX_BYTES * 2 - accepted_count
    } else {
        0
    };
    for index in 0..accepted_count {
        let position = start + index;
        let value = (index % 9) as u8;
        if position % 2 == 0 {
            prefix[position / 2] = (prefix[position / 2] & 0xf0) | value;
        } else {
            prefix[position / 2] = (prefix[position / 2] & 0x0f) | (value << 4);
        }
    }
    prefix
}

fn mixed_masks() -> [u32; COEFFICIENTS] {
    let mut masks = [0; COEFFICIENTS];
    for (index, mask) in masks.iter_mut().enumerate() {
        *mask = match index % 4 {
            0 => 0,
            1 => MODULUS - 1,
            2 => 4,
            _ => (index as u32 * 32_749) % MODULUS,
        };
    }
    masks
}

fn shake(input: &[u8], length: usize) -> Vec<u8> {
    let mut hash = Shake256::default();
    hash.update(input);
    let mut output = vec![0; length];
    hash.finalize_xof().read(&mut output);
    output
}
