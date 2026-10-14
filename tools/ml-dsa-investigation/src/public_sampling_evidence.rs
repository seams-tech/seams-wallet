//! Separate-role E2E for every adaptive prefix, including final public padding.

use crate::{
    InvestigationResult, circuit_evidence::reference_shake256, digest, garbled_execution,
    private_execution, private_keygen, require,
};
use ed25519_yao::phase5_benchmark::ml_dsa_private::{
    PrivateKernelSchedule, evaluate_private_fixture, garble_private_fixture,
};
use serde_json::{Value, json};
use std::{env, ffi::OsStr, fs, io, path::Path};
use zeroize::Zeroizing;

pub(super) fn try_run_child() -> InvestigationResult<bool> {
    let args: Vec<String> = env::args().skip(1).collect();
    let garbler = match args.first().map(String::as_str) {
        Some("public-sampling-role-a") => true,
        Some("public-sampling-role-b") => false,
        _ => return Ok(false),
    };
    require(
        args.len() == 4,
        "Sampler role needs schedule, input, and result paths",
    )?;
    let encoded = fs::read(&args[1])?;
    require(
        matches!(encoded.get(8), Some(0x93..=0x95)),
        "Wrong adaptive sampler circuit",
    )?;
    let schedule = PrivateKernelSchedule::parse(&encoded)?;
    let input = Zeroizing::new(fs::read(&args[2])?);
    require(
        input.iter().all(|bit| *bit <= 1),
        "Fixture has a non-bit input",
    )?;
    let bits = Zeroizing::new(input.iter().map(|bit| *bit != 0).collect::<Vec<bool>>());
    let result = if garbler {
        garble_private_fixture(&schedule, &bits, io::stdin().lock(), io::stdout().lock())?
    } else {
        evaluate_private_fixture(&schedule, &bits, io::stdin().lock(), io::stdout().lock())?
    };
    private_keygen::write_private_file(
        Path::new(&args[3]),
        &serde_json::to_vec(&json!({
            "output_hex": hex::encode(result.output.as_slice()),
            "metrics": private_execution::encode_metrics(&result.metrics),
        }))?,
    )?;
    Ok(true)
}

pub(super) fn run(schedules: &Path) -> InvestigationResult<Value> {
    let directory = tempfile::tempdir()?;
    let mut cases = Vec::new();
    for (name, prefix) in [
        ("sampling-two-blocks", 272),
        ("sampling-three-blocks", 408),
        ("sampling-final-bound", 481),
    ] {
        for nonce in [0_u16, 10] {
            let case_dir = directory.path().join(format!("{name}-{nonce}"));
            fs::create_dir(&case_dir)?;
            let rho_prime = [0x5a; 64];
            let mut message = rho_prime.to_vec();
            message.extend_from_slice(&nonce.to_le_bytes());
            let stream = reference_shake256(&message, prefix);
            let candidates: Vec<u8> = stream
                .iter()
                .flat_map(|byte| [byte & 15, byte >> 4])
                .collect();
            let mut a = garbled_execution::bytes_to_bits(&[0xa5; 64]);
            let b = garbled_execution::bytes_to_bits(&[0xff; 64]);
            let mut masks = Vec::with_capacity(candidates.len());
            for _ in &candidates {
                let mask = random_residue()?;
                masks.push(mask);
                append_word(&mut a, mask, 23);
            }
            append_word(&mut a, u32::from(nonce), 16);
            let mut expected_a: Vec<bool> = candidates.iter().map(|value| *value < 9).collect();
            expected_a.resize(candidates.len().div_ceil(8) * 8, false);
            let mut expected_b = expected_a.clone();
            for (value, mask) in candidates.iter().zip(&masks) {
                let share =
                    (4_i64 - i64::from(*value) - i64::from(*mask)).rem_euclid(8_380_417) as u32;
                append_word(&mut expected_b, share, 23);
            }
            let input_a = case_dir.join("input-a");
            let input_b = case_dir.join("input-b");
            let result_a = case_dir.join("result-a");
            let result_b = case_dir.join("result-b");
            private_keygen::write_private_file(
                &input_a,
                &a.iter().map(|bit| u8::from(*bit)).collect::<Vec<_>>(),
            )?;
            private_keygen::write_private_file(
                &input_b,
                &b.iter().map(|bit| u8::from(*bit)).collect::<Vec<_>>(),
            )?;
            let schedule = schedules.join(format!("{name}.bin"));
            private_execution::run_duplex_children(
                &[
                    OsStr::new("public-sampling-role-a"),
                    schedule.as_os_str(),
                    input_a.as_os_str(),
                    result_a.as_os_str(),
                ],
                &[
                    OsStr::new("public-sampling-role-b"),
                    schedule.as_os_str(),
                    input_b.as_os_str(),
                    result_b.as_os_str(),
                ],
            )?;
            let a: Value = serde_json::from_slice(&fs::read(result_a)?)?;
            let b: Value = serde_json::from_slice(&fs::read(result_b)?)?;
            let a_output = hex::decode(a["output_hex"].as_str().ok_or("Missing A output")?)?;
            let b_output = hex::decode(b["output_hex"].as_str().ok_or("Missing B output")?)?;
            require(
                a_output == garbled_execution::pack_bits(&expected_a),
                "Sampler public bitmap or zero padding differs",
            )?;
            require(
                b_output == garbled_execution::pack_bits(&expected_b),
                "Sampler shares differ from independent SHAKE oracle",
            )?;
            require(
                a["metrics"]["table_bytes"] == b["metrics"]["table_bytes"],
                "Sampler table counts disagree",
            )?;
            cases.push(json!({"schedule": name, "schedule_sha256": digest(&fs::read(schedule)?), "prefix_bytes": prefix, "nonce": nonce,
                "all_candidates_match_reference": true, "public_padding_verified": true,
                "a_output_sha256": digest(&a_output), "b_output_sha256": digest(&b_output), "metrics": a["metrics"]}));
        }
    }
    directory.close()?;
    Ok(
        json!({"scope": "Disposable known rho-prime fixtures through real separate-role GC and OT. Every prefix, every candidate, output ownership, low-nibble order, and final bitmap padding are checked against an independent SHAKE oracle.", "cases": cases, "temporary_files_removed": true}),
    )
}

fn append_word(bits: &mut Vec<bool>, value: u32, width: usize) {
    for bit in 0..width {
        bits.push(value >> bit & 1 != 0);
    }
}
fn random_residue() -> InvestigationResult<u32> {
    loop {
        let mut bytes = [0; 4];
        getrandom::getrandom(&mut bytes)?;
        let candidate = u32::from_le_bytes(bytes) & 0x7f_ffff;
        if candidate < 8_380_417 {
            return Ok(candidate);
        }
    }
}
