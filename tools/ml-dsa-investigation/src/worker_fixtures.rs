//! Generated public schedules and role-specific fixtures for Worker benchmarks.

use crate::{InvestigationResult, circuit_evidence, digest, garbled_execution, require};
use ed25519_yao_generator::{
    compile_ml_dsa_eta4_sampling_circuit_v1, compile_ml_dsa_power2round_circuit_v1,
    compile_ml_dsa_private_rounding_circuit_v1, compile_ml_dsa_private_sampling_circuit_v1,
    compile_ml_dsa_private_seed_circuit_v1, compile_ml_dsa_private_signing_mask_circuit_v1,
};
use serde_json::{Map, Value, json};
use std::{fs, path::Path};

const MODULUS: u32 = 8_380_417;

struct RoleFixture<'a> {
    input: &'a [bool],
    output: &'a [u8],
}

pub(super) fn export(directory: &Path) -> InvestigationResult<Value> {
    fs::create_dir_all(directory)?;
    let mut role_a = Map::new();
    let mut role_b = Map::new();
    let seed_share = [0xa5; 32];
    let rho_share_a = [0x3c; 64];
    let k_share_a = [0x5a; 32];
    let mut canonical_seed_message = vec![0; 32];
    canonical_seed_message.extend_from_slice(&[6, 5]);
    let expanded = circuit_evidence::reference_shake256(&canonical_seed_message, 128);
    let mut rho_share_b = [0; 64];
    for index in 0..64 {
        rho_share_b[index] = expanded[32 + index] ^ rho_share_a[index];
    }
    let mut seed_input_a = Vec::from(seed_share);
    seed_input_a.extend_from_slice(&rho_share_a);
    seed_input_a.extend_from_slice(&k_share_a);
    let mut seed_output_b = expanded[..32].to_vec();
    seed_output_b.extend_from_slice(&rho_share_b);
    for index in 0..32 {
        seed_output_b.push(expanded[96 + index] ^ k_share_a[index]);
    }
    let seed_circuit = compile_ml_dsa_private_seed_circuit_v1();
    save_kernel(
        directory,
        "seed",
        seed_circuit.canonical_schedule_encoding(),
        RoleFixture { input: &garbled_execution::bytes_to_bits(&seed_input_a), output: &expanded[..32] },
        RoleFixture { input: &garbled_execution::bytes_to_bits(&seed_share), output: &seed_output_b },
        &mut role_a,
        &mut role_b,
    )?;
    drop(seed_circuit);

    let masks = fixture_masks();
    let mut sampling_message = expanded[32..96].to_vec();
    sampling_message.extend_from_slice(&0_u16.to_le_bytes());
    let prefix = circuit_evidence::reference_shake256(&sampling_message, 481);
    let sampling_oracle = compile_ml_dsa_eta4_sampling_circuit_v1();
    let sampled = sampling_oracle.evaluate_public_fixture(prefix.as_slice().try_into()?, &masks)?;
    require(
        sampled.success,
        "Worker public sampling fixture exhausted its fixed prefix.",
    )?;
    let mut sampling_a = garbled_execution::bytes_to_bits(&rho_share_a);
    append_residues(&mut sampling_a, &masks, 23);
    let mut sampling_output_b = vec![true];
    append_residues(&mut sampling_output_b, &sampled.deriver_b_shares, 23);
    drop(sampling_oracle);
    let sampling_circuit = compile_ml_dsa_private_sampling_circuit_v1(0);
    save_kernel(
        directory,
        "sampling-0",
        sampling_circuit.canonical_schedule_encoding(),
        RoleFixture { input: &sampling_a, output: &[1] },
        RoleFixture { input: &garbled_execution::bytes_to_bits(&rho_share_b), output: &garbled_execution::pack_bits(&sampling_output_b) },
        &mut role_a,
        &mut role_b,
    )?;
    drop(sampling_circuit);

    let mut t_a = [0; 256];
    let mut t_b = [0; 256];
    for index in 0..256 {
        t_a[index] = (index as u32 * 2_347 + 218) % MODULUS;
        let target = (index as u32 * 32_761 + 4_096) % MODULUS;
        t_b[index] = (target + MODULUS - t_a[index]) % MODULUS;
    }
    let rounding_oracle = compile_ml_dsa_power2round_circuit_v1();
    let rounded = rounding_oracle.evaluate_public_fixture(&t_a, &t_b, &masks)?;
    let mut rounding_a = Vec::new();
    append_residues(&mut rounding_a, &t_a, 23);
    append_residues(&mut rounding_a, &masks, 23);
    let mut rounding_b = Vec::new();
    append_residues(&mut rounding_b, &t_b, 23);
    let mut rounding_public = Vec::new();
    for high in rounded.t1 {
        append_unsigned(&mut rounding_public, u32::from(high), 10);
    }
    let mut rounding_output_b = rounding_public.clone();
    append_residues(&mut rounding_output_b, &rounded.t0_b_shares, 23);
    drop(rounding_oracle);
    let rounding_circuit = compile_ml_dsa_private_rounding_circuit_v1();
    save_kernel(
        directory,
        "rounding",
        rounding_circuit.canonical_schedule_encoding(),
        RoleFixture { input: &rounding_a, output: &garbled_execution::pack_bits(&rounding_public) },
        RoleFixture { input: &rounding_b, output: &garbled_execution::pack_bits(&rounding_output_b) },
        &mut role_a,
        &mut role_b,
    )?;
    drop(rounding_circuit);

    let mask_seed_a = [0x8d; 64];
    let mut mask_seed_b = [0; 64];
    for index in 0..64 {
        mask_seed_b[index] = index as u8 ^ mask_seed_a[index];
    }
    let mask_circuit = compile_ml_dsa_private_signing_mask_circuit_v1(0);
    let mask_output = mask_circuit.evaluate_public_fixture(&mask_seed_a, &mask_seed_b, &masks)?;
    let mut mask_a = garbled_execution::bytes_to_bits(&mask_seed_a);
    append_residues(&mut mask_a, &masks, 23);
    let mut mask_output_b = Vec::new();
    append_residues(&mut mask_output_b, &mask_output.deriver_b_shares, 23);
    save_kernel(
        directory,
        "mask-0",
        mask_circuit.canonical_schedule_encoding(),
        RoleFixture { input: &mask_a, output: &[] },
        RoleFixture { input: &garbled_execution::bytes_to_bits(&mask_seed_b), output: &garbled_execution::pack_bits(&mask_output_b) },
        &mut role_a,
        &mut role_b,
    )?;
    for (role, kernels) in [("a", role_a), ("b", role_b)] {
        let fixtures = json!({"schema": "seams.ml-dsa-worker-fixtures.v1", "public_fixtures_only": true, "kernels": kernels});
        fs::write(
            directory.join(format!("fixtures-{role}.json")),
            serde_json::to_vec_pretty(&fixtures)?,
        )?;
    }
    Ok(
        json!({"directory": directory, "public_fixtures_only": true, "schedules": ["seed", "sampling-0", "rounding", "mask-0"], "reproduction": "cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- export-worker-fixtures <directory>"}),
    )
}

fn save_kernel(
    directory: &Path,
    name: &str,
    schedule: &[u8],
    fixture_a: RoleFixture<'_>,
    fixture_b: RoleFixture<'_>,
    role_a: &mut Map<String, Value>,
    role_b: &mut Map<String, Value>,
) -> InvestigationResult<()> {
    fs::write(directory.join(format!("{name}.bin")), schedule)?;
    for (fixture, fixtures) in [(fixture_a, role_a), (fixture_b, role_b)] {
        fixtures.insert(name.into(), json!({"schedule_sha256": digest(schedule), "input_bits": fixture.input.len(), "input_hex": hex::encode(garbled_execution::pack_bits(fixture.input)), "expected_output_hex": hex::encode(fixture.output)}));
    }
    Ok(())
}

fn fixture_masks() -> [u32; 256] {
    let mut masks = [0; 256];
    for (index, mask) in masks.iter_mut().enumerate() {
        *mask = (index as u32 * 7_919 + 42) % MODULUS;
    }
    masks
}

fn append_residues(bits: &mut Vec<bool>, residues: &[u32; 256], width: usize) {
    for residue in residues {
        append_unsigned(bits, *residue, width);
    }
}

fn append_unsigned(bits: &mut Vec<bool>, value: u32, width: usize) {
    for bit in 0..width {
        bits.push(value >> bit & 1 == 1);
    }
}
