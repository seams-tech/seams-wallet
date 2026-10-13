use crate::{InvestigationResult, digest, require};
use ed25519_yao_generator::{
    MlDsaPower2RoundCircuitV1, MlDsaPower2RoundFixtureFieldV1,
    compile_ml_dsa_power2round_circuit_v1,
};
use serde_json::{Value, json};
use std::time::Instant;

const MODULUS: u32 = 8_380_417;
const COEFFICIENTS: usize = 256;
const BOUNDARIES: [u32; 7] = [0, 4095, 4096, 4097, 8191, 8192, MODULUS - 1];

struct RoundingFixture {
    t_a: [u32; COEFFICIENTS],
    t_b: [u32; COEFFICIENTS],
    masks: [u32; COEFFICIENTS],
}

pub(super) fn run(garbled_samples: usize) -> InvestigationResult<Value> {
    require(
        (1..=100).contains(&garbled_samples),
        "Rounding garbled sample count must be between 1 and 100.",
    )?;
    let started = Instant::now();
    let circuit = compile_ml_dsa_power2round_circuit_v1();
    let compile_ns = started.elapsed().as_nanos();
    let mut cases = Vec::new();
    for t in BOUNDARIES {
        for wrap in [false, true] {
            for mask in [0, MODULUS - 1] {
                let fixture = uniform_boundary_fixture(t, wrap, mask);
                cases.push(check_case(
                    &circuit,
                    &format!("t:{t},wrapped-split:{wrap},mask:{mask}"),
                    &fixture,
                )?);
            }
        }
    }
    // Sweep all high-coefficient transitions in batches. The three low values
    // probe the positive tie, its successor, and its predecessor independently.
    for batch in 0..12 {
        let fixture = transition_fixture(batch);
        cases.push(check_case(
            &circuit,
            &format!("all-high-transitions:batch:{batch}"),
            &fixture,
        )?);
    }
    let invalid_inputs = check_invalid_residues(&circuit)?;
    let fixture = mixed_boundary_fixture();
    cases.push(check_case(&circuit, "mixed-boundaries", &fixture)?);
    let garbled = crate::garbled_execution::benchmark_public_circuit(
        circuit.canonical_schedule_encoding(),
        &fixture_input_bits(&fixture),
        &fixture_expected_bits(&fixture),
        garbled_samples,
    )?;
    let metrics = circuit.metrics();
    let schedule = circuit.schedule_metrics();
    Ok(json!({
        "scope": "Fixed shared-input Power2Round with d=13 and masked additive low outputs. Public synthetic fixtures only.",
        "oracle": "Center t modulo8192 into(-4096,4096], then derive high=(t-low)/8192. This scalar oracle does not use the circuit's biased-shift algorithm.",
        "output_policy": "Only public t1 and masked B low shares are circuit outputs. Full t and unmasked t0 remain internal circuit wires.",
        "mask_formation": "Real A masks must be independent uniform canonical residues. Deterministic fixture masks provide no secrecy.",
        "boundary_t_values": BOUNDARIES,
        "positive_tie_4096_verified": true,
        "all_high_coefficient_transitions_verified": true,
        "additive_share_wrap_verified": true,
        "mask_boundaries_verified": [0, MODULUS - 1],
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
        "halfgate_table_bytes_estimate_six_polynomials": metrics.and_gate_count() * 32 * 6,
        "all_high_coefficients_and_reconstructed_low_residues_match": true,
        "excluded_work": ["uniform mask generation", "private input transfer", "private output delivery", "Cloudflare transport", "threshold signing"],
        "invalid_inputs": invalid_inputs,
        "garbled_execution": garbled,
        "cases": cases,
    }))
}

fn check_case(
    circuit: &MlDsaPower2RoundCircuitV1,
    name: &str,
    fixture: &RoundingFixture,
) -> InvestigationResult<Value> {
    let started = Instant::now();
    let actual = circuit.evaluate_public_fixture(&fixture.t_a, &fixture.t_b, &fixture.masks)?;
    let elapsed_ns = started.elapsed().as_nanos();
    let mut high_bytes = Vec::with_capacity(COEFFICIENTS * 2);
    let mut low_share_bytes = Vec::with_capacity(COEFFICIENTS * 4);
    let mut wrapped_count = 0;
    for index in 0..COEFFICIENTS {
        let sum = u64::from(fixture.t_a[index]) + u64::from(fixture.t_b[index]);
        wrapped_count += usize::from(sum >= u64::from(MODULUS));
        let t = (sum % u64::from(MODULUS)) as u32;
        let (expected_high, expected_low) = scalar_power2round(t);
        let expected_b = (i64::from(expected_low) - i64::from(fixture.masks[index]))
            .rem_euclid(i64::from(MODULUS)) as u32;
        require(
            actual.t1[index] == expected_high,
            &format!("Power2Round high differs for {name}, coefficient {index}."),
        )?;
        require(
            actual.t0_b_shares[index] == expected_b,
            &format!("Power2Round masked low differs for {name}, coefficient {index}."),
        )?;
        require(
            actual.t0_b_shares[index] < MODULUS,
            "Power2Round returned a noncanonical low share.",
        )?;
        let reconstructed_low = (u64::from(fixture.masks[index])
            + u64::from(actual.t0_b_shares[index]))
            % u64::from(MODULUS);
        require(
            reconstructed_low == i64::from(expected_low).rem_euclid(i64::from(MODULUS)) as u64,
            "Power2Round low reconstruction differs from the scalar oracle.",
        )?;
        require(
            (u64::from(actual.t1[index]) * 8192 + reconstructed_low) % u64::from(MODULUS)
                == u64::from(t),
            "Power2Round high and low do not reconstruct the input coefficient.",
        )?;
        high_bytes.extend_from_slice(&actual.t1[index].to_le_bytes());
        low_share_bytes.extend_from_slice(&actual.t0_b_shares[index].to_le_bytes());
    }
    Ok(json!({
        "case": name,
        "fixture_sha256": digest(&fixture_input_bytes(fixture)),
        "high_coefficients_sha256": digest(&high_bytes),
        "b_low_share_sha256": digest(&low_share_bytes),
        "coefficients_verified": COEFFICIENTS,
        "input_additions_that_wrap_mod_q": wrapped_count,
        "cleartext_boolean_evaluation_wall_time_ns": elapsed_ns,
    }))
}

fn check_invalid_residues(circuit: &MlDsaPower2RoundCircuitV1) -> InvestigationResult<Value> {
    let mut cases = Vec::new();
    for field in [
        MlDsaPower2RoundFixtureFieldV1::TShareA,
        MlDsaPower2RoundFixtureFieldV1::TShareB,
        MlDsaPower2RoundFixtureFieldV1::MaskA,
    ] {
        for residue_value in [MODULUS, (1 << 23) - 1, u32::MAX] {
            let mut fixture = mixed_boundary_fixture();
            let residue_index = COEFFICIENTS - 1;
            match field {
                MlDsaPower2RoundFixtureFieldV1::TShareA => {
                    fixture.t_a[residue_index] = residue_value
                }
                MlDsaPower2RoundFixtureFieldV1::TShareB => {
                    fixture.t_b[residue_index] = residue_value
                }
                MlDsaPower2RoundFixtureFieldV1::MaskA => {
                    fixture.masks[residue_index] = residue_value
                }
            }
            let error = circuit
                .evaluate_public_fixture(&fixture.t_a, &fixture.t_b, &fixture.masks)
                .err()
                .ok_or("Power2Round accepted a noncanonical input residue.")?;
            require(
                error.field == field
                    && error.residue_index == residue_index
                    && error.residue_value == residue_value,
                "Power2Round invalid-input diagnostic differs from the supplied residue.",
            )?;
            cases.push(json!({
                "field": format!("{field:?}"),
                "residue_index": residue_index,
                "residue_value": residue_value,
                "rejected": true,
            }));
        }
    }
    Ok(json!({"all_rejected": true, "cases": cases}))
}

fn uniform_boundary_fixture(t: u32, wrap: bool, mask: u32) -> RoundingFixture {
    let a = if wrap { MODULUS - 1 } else { 0 };
    let b = (u64::from(t) + u64::from(MODULUS) - u64::from(a)) % u64::from(MODULUS);
    RoundingFixture {
        t_a: [a; COEFFICIENTS],
        t_b: [b as u32; COEFFICIENTS],
        masks: [mask; COEFFICIENTS],
    }
}

fn mixed_boundary_fixture() -> RoundingFixture {
    let mut fixture = uniform_boundary_fixture(0, false, 0);
    for index in 0..COEFFICIENTS {
        let t = BOUNDARIES[index % BOUNDARIES.len()];
        let a = (index as u32 * 32_749) % MODULUS;
        fixture.t_a[index] = a;
        fixture.t_b[index] =
            ((u64::from(t) + u64::from(MODULUS) - u64::from(a)) % u64::from(MODULUS)) as u32;
        fixture.masks[index] = if index % 2 == 0 { 0 } else { MODULUS - 1 };
    }
    fixture
}

fn transition_fixture(batch: usize) -> RoundingFixture {
    let mut fixture = uniform_boundary_fixture(0, false, 0);
    for index in 0..COEFFICIENTS {
        let probe = batch * COEFFICIENTS + index;
        let high = probe / 3;
        let offset = probe % 3;
        let t = ((high * 8192 + 4095 + offset) as u32).min(MODULUS - 1);
        let a = MODULUS - 1 - index as u32;
        fixture.t_a[index] = a;
        fixture.t_b[index] =
            ((u64::from(t) + u64::from(MODULUS) - u64::from(a)) % u64::from(MODULUS)) as u32;
        fixture.masks[index] = if index % 2 == 0 { 0 } else { MODULUS - 1 };
    }
    fixture
}

fn scalar_power2round(t: u32) -> (u16, i32) {
    let mut low = (t % 8192) as i32;
    if low > 4096 {
        low -= 8192;
    }
    let high = (i64::from(t) - i64::from(low)) / 8192;
    (high as u16, low)
}

fn fixture_input_bits(fixture: &RoundingFixture) -> Vec<bool> {
    let mut bits = Vec::with_capacity(COEFFICIENTS * 23 * 3);
    for residues in [&fixture.t_a, &fixture.t_b, &fixture.masks] {
        for residue in residues {
            for bit in 0..23 {
                bits.push(residue >> bit & 1 == 1);
            }
        }
    }
    bits
}

fn fixture_input_bytes(fixture: &RoundingFixture) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(COEFFICIENTS * 4 * 3);
    for residues in [&fixture.t_a, &fixture.t_b, &fixture.masks] {
        for residue in residues {
            bytes.extend_from_slice(&residue.to_le_bytes());
        }
    }
    bytes
}

fn fixture_expected_bits(fixture: &RoundingFixture) -> Vec<bool> {
    let mut high_bits = Vec::with_capacity(COEFFICIENTS * 10);
    let mut low_bits = Vec::with_capacity(COEFFICIENTS * 23);
    for index in 0..COEFFICIENTS {
        let t = ((u64::from(fixture.t_a[index]) + u64::from(fixture.t_b[index]))
            % u64::from(MODULUS)) as u32;
        let (high, low) = scalar_power2round(t);
        let low_b = (i64::from(low) - i64::from(fixture.masks[index]))
            .rem_euclid(i64::from(MODULUS)) as u32;
        for bit in 0..10 {
            high_bits.push(high >> bit & 1 == 1);
        }
        for bit in 0..23 {
            low_bits.push(low_b >> bit & 1 == 1);
        }
    }
    high_bits.extend(low_bits);
    high_bits
}
