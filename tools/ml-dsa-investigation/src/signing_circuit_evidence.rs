//! Independent public-fixture checks for the signing circuit components.

use crate::{InvestigationResult, circuit_evidence, garbled_execution, require};
use ed25519_yao_generator::{
    MlDsaPrivateSigningCircuitV1, MlDsaSigningWorkloadV1, compile_ml_dsa_private_signing_circuit_v1,
};
use serde_json::{Value, json};

const Q: u32 = 8_380_417;
const GAMMA2: u32 = (Q - 1) / 32;
const BETA: u32 = 196;

pub(super) fn run() -> InvestigationResult<Value> {
    for value in 0..Q {
        let approximate = (value + 127) >> 7;
        let fast = ((approximate * 1025 + (1 << 21)) >> 22) & 15;
        require(
            fast == decompose(value).0,
            "Reciprocal HighBits differs from FIPS Decompose.",
        )?;
    }
    let mut components = Vec::new();
    for workload in [
        MlDsaSigningWorkloadV1::SigningSeed,
        MlDsaSigningWorkloadV1::CommitmentHighBits,
        MlDsaSigningWorkloadV1::CommitmentHash,
        MlDsaSigningWorkloadV1::ResponseCheck,
        MlDsaSigningWorkloadV1::RowCheckAndHints,
        MlDsaSigningWorkloadV1::AggregateCheck,
    ] {
        let circuit = compile_ml_dsa_private_signing_circuit_v1(workload);
        let cases = match workload {
            MlDsaSigningWorkloadV1::SigningSeed => check_seed(&circuit)?,
            MlDsaSigningWorkloadV1::CommitmentHighBits => check_high(&circuit)?,
            MlDsaSigningWorkloadV1::CommitmentHash => check_hash(&circuit)?,
            MlDsaSigningWorkloadV1::ResponseCheck => check_response(&circuit)?,
            MlDsaSigningWorkloadV1::RowCheckAndHints => check_rows(&circuit)?,
            MlDsaSigningWorkloadV1::AggregateCheck => check_aggregate(&circuit)?,
        };
        let metrics = circuit.metrics();
        components.push(json!({"workload": format!("{workload:?}"), "a_input_bits": workload.garbler_input_bits(), "b_input_bits": workload.evaluator_input_bits(), "output_bits": workload.output_bits(), "and_gates": metrics.and_gate_count(), "table_bytes": metrics.and_gate_count() * 32, "schedule_bytes": circuit.canonical_schedule_encoding().len(), "reusable_slots": circuit.schedule_metrics().reusable_slot_count(), "public_fixture_cases": cases}));
    }
    Ok(
        json!({"scope": "Independent cleartext public-fixture validation of six signing circuits. No private execution or complete threshold signature is established by this section.", "decompose_reciprocal_exhaustive_residues": Q, "components": components}),
    )
}

fn evaluate(
    circuit: &MlDsaPrivateSigningCircuitV1,
    mut a: Vec<bool>,
    b: Vec<bool>,
) -> InvestigationResult<Vec<bool>> {
    a.extend(b);
    Ok(circuit.evaluate_public_fixture(&a)?)
}

fn bytes(values: &[u8]) -> Vec<bool> {
    garbled_execution::bytes_to_bits(values)
}
fn append_word(bits: &mut Vec<bool>, value: u32, width: usize) {
    for bit in 0..width {
        bits.push(value >> bit & 1 == 1);
    }
}
fn split_polynomial(values: &[u32; 256]) -> (Vec<bool>, Vec<bool>) {
    let mut a = Vec::with_capacity(5888);
    let mut b = Vec::with_capacity(5888);
    for (index, value) in values.iter().enumerate() {
        let mask = (index as u32 * 7919 + 42) % Q;
        append_word(&mut a, mask, 23);
        append_word(&mut b, (value + Q - mask) % Q, 23);
    }
    (a, b)
}
fn unpack(bits: &[bool]) -> u32 {
    let mut value = 0;
    for (index, bit) in bits.iter().enumerate() {
        value |= u32::from(*bit) << index;
    }
    value
}

fn check_seed(circuit: &MlDsaPrivateSigningCircuitV1) -> InvestigationResult<usize> {
    let mut a = bytes(&[0x3c; 32]);
    a.extend(bytes(&[0xaa; 32]));
    a.extend(bytes(&[0x42; 64]));
    a.extend(bytes(&[0x5a; 64]));
    let mut b = bytes(&[0xa5; 32]);
    b.extend(bytes(&[0x11; 32]));
    let actual = garbled_execution::pack_bits(&evaluate(circuit, a, b)?);
    let mut message = vec![0x3c ^ 0xa5; 32];
    message.extend_from_slice(&[0xaa ^ 0x11; 32]);
    message.extend_from_slice(&[0x42; 64]);
    let mut expected = circuit_evidence::reference_shake256(&message, 64);
    for byte in &mut expected {
        *byte ^= 0x5a;
    }
    require(
        actual == expected,
        "Private signing-seed circuit differs from SHAKE256.",
    )?;
    Ok(1)
}

fn check_high(circuit: &MlDsaPrivateSigningCircuitV1) -> InvestigationResult<usize> {
    let mut boundaries = vec![0, Q - 1];
    for high in 1..=16 {
        let tie = high * (GAMMA2 * 2) - GAMMA2;
        for delta in [-1_i64, 0, 1] {
            boundaries.push((i64::from(tie) + delta) as u32);
        }
    }
    let mut polynomial = [0; 256];
    for (index, value) in polynomial.iter_mut().enumerate() {
        *value = boundaries[index % boundaries.len()];
    }
    let (mut a, b) = split_polynomial(&polynomial);
    for index in 0..256 {
        append_word(&mut a, (index % 16) as u32, 4);
    }
    let output = evaluate(circuit, a, b)?;
    for index in 0..256 {
        let reconstructed = unpack(&output[index * 4..index * 4 + 4]) ^ (index % 16) as u32;
        require(
            reconstructed == decompose(polynomial[index]).0,
            "Private HighBits boundary differs from FIPS.",
        )?;
    }
    Ok(boundaries.len())
}

fn check_hash(circuit: &MlDsaPrivateSigningCircuitV1) -> InvestigationResult<usize> {
    let mut encoded = [0; 768];
    let mut b = [0; 768];
    for index in 0..768 {
        encoded[index] = index as u8;
        b[index] = encoded[index] ^ 0x69;
    }
    let mut a_bits = bytes(&[0x69; 768]);
    a_bits.extend(bytes(&[0x42; 64]));
    let output = garbled_execution::pack_bits(&evaluate(circuit, a_bits, bytes(&b))?);
    let mut message = vec![0x42; 64];
    message.extend_from_slice(&encoded);
    require(
        output == circuit_evidence::reference_shake256(&message, 48),
        "Commitment hash must absorb mu before encoded w1.",
    )?;
    Ok(1)
}

fn check_response(circuit: &MlDsaPrivateSigningCircuitV1) -> InvestigationResult<usize> {
    let bound = (1 << 19) - BETA;
    let targets = [
        0,
        bound - 1,
        bound,
        bound + 1,
        Q - bound - 1,
        Q - bound,
        Q - bound + 1,
        Q - 1,
    ];
    for target in targets {
        let (mut a, b) = split_polynomial(&[target; 256]);
        a.push(true);
        let output = evaluate(circuit, a, b)?;
        require(
            (output[0] ^ true) == norm_below(target, bound),
            "Response norm boundary differs from FIPS.",
        )?;
    }
    Ok(targets.len())
}

fn check_rows(circuit: &MlDsaPrivateSigningCircuitV1) -> InvestigationResult<usize> {
    let low_bound = GAMMA2 - BETA;
    let pairs = [
        (0, 0),
        (low_bound - 1, 0),
        (low_bound, 0),
        (Q - low_bound + 1, 0),
        (Q - low_bound, 0),
        (0, GAMMA2 - 1),
        (0, GAMMA2),
        (0, Q - GAMMA2 + 1),
        (0, Q - GAMMA2),
        (low_bound - 1, BETA + 3),
        (Q - low_bound + 1, Q - BETA - 3),
        (Q - 1, 0),
    ];
    for (r, correction) in pairs {
        let (mut a, mut b) = split_polynomial(&[r; 256]);
        let (a_correction, b_correction) = split_polynomial(&[correction; 256]);
        a.extend(a_correction);
        b.extend(b_correction);
        a.push(true);
        for index in 0..256 {
            a.push(index % 3 == 0);
        }
        let output = evaluate(circuit, a, b)?;
        let valid = decompose(r).1.unsigned_abs() < low_bound && norm_below(correction, GAMMA2);
        require(
            (output[0] ^ true) == valid,
            "Private low/correction norm check differs from FIPS.",
        )?;
        let expected_hint = decompose(r).0 != decompose((r + correction) % Q).0;
        for index in 0..256 {
            require(
                (output[index + 1] ^ (index % 3 == 0)) == expected_hint,
                "Private MakeHint differs from FIPS.",
            )?;
        }
    }
    Ok(pairs.len())
}

fn check_aggregate(circuit: &MlDsaPrivateSigningCircuitV1) -> InvestigationResult<usize> {
    let counts = [0, 1, 54, 55, 56, 1536];
    for count in counts {
        check_aggregate_case(circuit, count, None)?;
    }
    for invalid in 0..11 {
        check_aggregate_case(circuit, 55, Some(invalid))?;
    }
    Ok(counts.len() + 11)
}
fn check_aggregate_case(
    circuit: &MlDsaPrivateSigningCircuitV1,
    hints: usize,
    invalid: Option<usize>,
) -> InvestigationResult<()> {
    let mut a = vec![false; 1664];
    let mut b = vec![false; 1664];
    for bit in 0..1547 {
        a[bit] = bit % 3 == 0;
        let value = if bit < 11 {
            Some(bit) != invalid
        } else {
            bit - 11 < hints
        };
        b[bit] = value ^ a[bit];
    }
    let output = evaluate(circuit, a, b)?;
    require(
        output[0] == (invalid.is_none() && hints <= 55),
        "Aggregate check disclosed an invalid candidate as accepted.",
    )
}

fn decompose(value: u32) -> (u32, i32) {
    let alpha = GAMMA2 * 2;
    let remainder = value % alpha;
    let low = if remainder > GAMMA2 {
        remainder as i32 - alpha as i32
    } else {
        remainder as i32
    };
    if value as i32 - low == Q as i32 - 1 {
        (0, low - 1)
    } else {
        (((value as i32 - low) / alpha as i32) as u32, low)
    }
}
fn norm_below(value: u32, bound: u32) -> bool {
    value < bound || value > Q - bound
}
