//! Public-fixture evidence for private ML-DSA ExpandMask execution.
//!
//! Each child receives only its own input share. The common parent acts as an
//! authorized test recipient after execution and checks B's disposable shares.
//! Shared-host files and processes provide no production isolation claim.

use crate::{InvestigationResult, digest, private_execution, require};
use ed25519_yao::phase5_benchmark::ml_dsa_private::{
    PrivateKernelSchedule, evaluate_private_fixture, garble_private_fixture,
};
use ed25519_yao_generator::{
    MlDsaPrivateSigningMaskCircuitV1, compile_ml_dsa_private_signing_mask_circuit_v1,
};
use serde_json::{Value, json};
use sha3::{
    Shake256,
    digest::{ExtendableOutput, Update, XofReader},
};
use std::{
    collections::HashSet,
    env,
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::{self, Write},
    os::unix::fs::OpenOptionsExt,
    path::Path,
    time::Instant,
};
use zeroize::Zeroizing;

const MODULUS: u32 = 8_380_417;
const COEFFICIENTS: usize = 256;
const SEED_SHARE_BYTES: usize = 64;
const A_INPUT_BYTES: usize = SEED_SHARE_BYTES + COEFFICIENTS * 4;
const OUTPUT_BITS: usize = COEFFICIENTS * 23;
const OUTPUT_BYTES: usize = OUTPUT_BITS / 8;
const MASK_BYTES: usize = 640;
const NONCES: [u16; 5] = [0, 4, 5, 4_104, u16::MAX];

#[derive(Clone, Copy)]
enum Role {
    A,
    B,
}

impl Role {
    const fn argument(self) -> &'static str {
        match self {
            Self::A => "private-mask-role-a",
            Self::B => "private-mask-role-b",
        }
    }
}

pub(super) fn try_run_child() -> InvestigationResult<bool> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let Some(mode) = arguments.first() else {
        return Ok(false);
    };
    let role = match mode.as_str() {
        "private-mask-role-a" => Role::A,
        "private-mask-role-b" => Role::B,
        _ => return Ok(false),
    };
    require(
        arguments.len() == 4,
        "Private mask role needs schedule, own input, and result paths.",
    )?;
    run_role(
        role,
        Path::new(&arguments[1]),
        Path::new(&arguments[2]),
        Path::new(&arguments[3]),
    )?;
    Ok(true)
}

pub(super) fn run(samples: usize) -> InvestigationResult<Value> {
    require(
        (1..=100).contains(&samples),
        "Private mask sample count must be between 1 and 100.",
    )?;
    let started = Instant::now();
    let mut rho_double_prime = [0; SEED_SHARE_BYTES];
    for (index, byte) in rho_double_prime.iter_mut().enumerate() {
        *byte = index as u8;
    }
    let mut cases = Vec::with_capacity(NONCES.len());
    let mut bindings = HashSet::new();
    for nonce in NONCES {
        let sample_count = if nonce == 0 { samples } else { 1 };
        cases.push(run_case(
            nonce,
            &rho_double_prime,
            sample_count,
            &mut bindings,
        )?);
    }
    Ok(json!({
        "scope": "Separated passive A and B role processes execute private ExpandMask with genuine fresh OT. A receives no decoded output. The parent checks only disposable public-fixture shares after execution.",
        "production_eligible": false,
        "security_limits": [
            "The fixed rhoDoublePrime is public test data. Neither role input file contains both seed shares.",
            "The common parent is an authorized public-fixture test recipient. It reads B's masked output only after both role processes finish.",
            "File permissions and process separation on one host provide no operating-system or Cloudflare isolation claim.",
            "This experiment provides no signing protocol, transport authentication, production admission, durable storage, or reviewed composition proof.",
            "Fresh OT uses the existing classical OT construction. It provides no post-quantum transcript confidentiality claim.",
            "Host pipe timings measure host wall time. They do not measure Cloudflare CPU charges or deployed signing latency."
        ],
        "canonical_mapping": {
            "input": "rhoDoublePrime[64] followed by a two-byte little-endian nonce",
            "shake256_output_bytes": MASK_BYTES,
            "bit_order": "256 contiguous 20-bit little-endian integers in coefficient order",
            "signed_coefficient": "524288 minus the decoded integer",
            "signed_range_inclusive": [-524287, 524288],
            "share_modulus": MODULUS,
            "a_input_bits": 6400,
            "b_input_bits": 512,
            "b_output_bits": OUTPUT_BITS,
            "a_public_output_bytes": 0,
            "nonce_4104_meaning": "The last polynomial nonce for 821 attempts with five polynomials per attempt, starting at nonce zero."
        },
        "public_fixture_rho_double_prime_hex": hex::encode(rho_double_prime),
        "implementation_sources": source_identities()?,
        "fresh_execution_bindings": bindings.len(),
        "cases": cases,
        "total_wall_ns_including_compilation_and_child_processes": started.elapsed().as_nanos(),
    }))
}

fn run_case(
    nonce: u16,
    rho_double_prime: &[u8; SEED_SHARE_BYTES],
    samples: usize,
    bindings: &mut HashSet<String>,
) -> InvestigationResult<Value> {
    let compile_started = Instant::now();
    let circuit = compile_ml_dsa_private_signing_mask_circuit_v1(nonce);
    let schedule_bytes = circuit.canonical_schedule_encoding();
    let schedule = PrivateKernelSchedule::parse(schedule_bytes)?;
    require(
        schedule.garbler_input_bits() == 6_400
            && schedule.evaluator_input_bits() == 512
            && schedule.evaluator_output_bits() == OUTPUT_BITS,
        "Private mask circuit dimensions differ from their role schema.",
    )?;
    let compile_parse_wall_ns = compile_started.elapsed().as_nanos();
    let invalid_masks = check_invalid_masks(&circuit)?;
    let expected = reference_coefficients(rho_double_prime, nonce);
    check_mask_boundaries(&circuit, rho_double_prime, &expected)?;
    let directory = tempfile::tempdir()?;
    let schedule_path = directory.path().join("private-mask-schedule.bin");
    fs::write(&schedule_path, schedule_bytes)?;
    let mut executions = Vec::with_capacity(samples);
    for sample in 0..samples {
        executions.push(run_sample(
            directory.path(),
            &schedule_path,
            &circuit,
            rho_double_prime,
            &expected,
            sample,
            bindings,
        )?);
    }
    Ok(json!({
        "nonce": nonce,
        "nonce_little_endian_hex": hex::encode(nonce.to_le_bytes()),
        "samples": samples,
        "and_gates": circuit.metrics().and_gate_count(),
        "half_gate_table_bytes": circuit.metrics().and_gate_count() * 32,
        "scheduled_gates": circuit.schedule_metrics().scheduled_gate_count(),
        "reusable_wire_slots": circuit.schedule_metrics().reusable_slot_count(),
        "schedule_bytes": schedule_bytes.len(),
        "component_sha256": hex::encode(circuit.benchmark_component_digest().expose_public_bytes()),
        "schedule_sha256": hex::encode(circuit.benchmark_schedule_digest().expose_public_bytes()),
        "compile_and_parse_wall_ns": compile_parse_wall_ns,
        "reference_coefficient_sha256": polynomial_digest(&expected),
        "invalid_mask_boundary_checks": invalid_masks,
        "valid_mask_boundary_checks": {"all_zero_masks_match": true, "all_modulus_minus_one_masks_match": true},
        "executions": executions,
    }))
}

fn check_invalid_masks(circuit: &MlDsaPrivateSigningMaskCircuitV1) -> InvestigationResult<Value> {
    let a = [0; SEED_SHARE_BYTES];
    let b = [0; SEED_SHARE_BYTES];
    for (index, value) in [(0, u32::MAX), (COEFFICIENTS - 1, MODULUS)] {
        let mut masks = [0; COEFFICIENTS];
        masks[index] = value;
        let error = circuit
            .evaluate_public_fixture(&a, &b, &masks)
            .err()
            .ok_or("Private mask clear fixture accepted an invalid residue.")?;
        require(
            error.mask_index == index && error.mask_value == value,
            "Private mask clear fixture returned the wrong invalid-residue error.",
        )?;
    }
    Ok(
        json!({"rejected_modulus_at_final_coefficient": true, "rejected_u32_max_at_first_coefficient": true}),
    )
}

fn check_mask_boundaries(
    circuit: &MlDsaPrivateSigningMaskCircuitV1,
    seed: &[u8; SEED_SHARE_BYTES],
    expected: &[u32; COEFFICIENTS],
) -> InvestigationResult<()> {
    let a = [0; SEED_SHARE_BYTES];
    for mask in [0, MODULUS - 1] {
        let masks = [mask; COEFFICIENTS];
        let output = circuit.evaluate_public_fixture(&a, seed, &masks)?;
        check_shares(&masks, &output.deriver_b_shares, expected)?;
    }
    Ok(())
}

fn run_sample(
    directory: &Path,
    schedule: &Path,
    circuit: &MlDsaPrivateSigningMaskCircuitV1,
    rho_double_prime: &[u8; SEED_SHARE_BYTES],
    expected: &[u32; COEFFICIENTS],
    sample: usize,
    bindings: &mut HashSet<String>,
) -> InvestigationResult<Value> {
    let mut a_share = Zeroizing::new([0; SEED_SHARE_BYTES]);
    getrandom::getrandom(a_share.as_mut())?;
    let mut b_share = Zeroizing::new([0; SEED_SHARE_BYTES]);
    for index in 0..SEED_SHARE_BYTES {
        b_share[index] = rho_double_prime[index] ^ a_share[index];
    }
    let masks = uniform_masks()?;
    let clear_started = Instant::now();
    let clear = circuit.evaluate_public_fixture(&a_share, &b_share, &masks)?;
    check_shares(&masks, &clear.deriver_b_shares, expected)?;
    let clear_fixture_wall_ns = clear_started.elapsed().as_nanos();
    let input_a = directory.join(format!("sample-{sample}-a-input.bin"));
    let input_b = directory.join(format!("sample-{sample}-b-input.bin"));
    let result_a = directory.join(format!("sample-{sample}-a-result.json"));
    let result_b = directory.join(format!("sample-{sample}-b-result.json"));
    let mut a_bytes = Zeroizing::new(Vec::with_capacity(A_INPUT_BYTES));
    a_bytes.extend_from_slice(a_share.as_slice());
    for mask in masks.iter() {
        a_bytes.extend_from_slice(&mask.to_le_bytes());
    }
    write_private_file(&input_a, &a_bytes)?;
    write_private_file(&input_b, b_share.as_slice())?;
    let started = Instant::now();
    private_execution::run_duplex_children(
        &[
            OsStr::new(Role::A.argument()),
            schedule.as_os_str(),
            input_a.as_os_str(),
            result_a.as_os_str(),
        ],
        &[
            OsStr::new(Role::B.argument()),
            schedule.as_os_str(),
            input_b.as_os_str(),
            result_b.as_os_str(),
        ],
    )?;
    let process_pair_wall_ns = started.elapsed().as_nanos();
    let a: Value = serde_json::from_slice(&fs::read(&result_a)?)?;
    let b_bytes = Zeroizing::new(fs::read(&result_b)?);
    let b: Value = serde_json::from_slice(&b_bytes)?;
    require(
        a["output_hex"] == "" && a["output_bytes"] == 0,
        "Private mask A received decoded output bytes.",
    )?;
    let output = Zeroizing::new(hex::decode(
        b["output_hex"]
            .as_str()
            .ok_or("Missing private mask B fixture output.")?,
    )?);
    let b_shares = decode_output(&output)?;
    check_shares(&masks, &b_shares, expected)?;
    require(
        *b_shares == clear.deriver_b_shares,
        "Private OT mask output differs from its clear fixture evaluation.",
    )?;
    validate_metrics(&a["metrics"], &b["metrics"], bindings)?;
    Ok(json!({
        "sample": sample,
        "clear_fixture_wall_ns": clear_fixture_wall_ns,
        "process_pair_wall_ns_including_startup_and_schedule_reads": process_pair_wall_ns,
        "coefficients_checked": COEFFICIENTS,
        "standard_expand_mask_oracle_matches": true,
        "clear_fixture_matches_private_ot": true,
        "b_share_sha256": polynomial_digest(&b_shares),
        "role_a": {"output_bytes": 0, "metrics": a["metrics"]},
        "role_b": {"output_bytes": output.len(), "metrics": b["metrics"]},
    }))
}

fn validate_metrics(
    a: &Value,
    b: &Value,
    bindings: &mut HashSet<String>,
) -> InvestigationResult<()> {
    for field in [
        "table_bytes",
        "frame_count",
        "garbler_to_evaluator_wire_bytes",
        "evaluator_to_garbler_wire_bytes",
        "ot_wire_bytes",
        "direct_label_bytes",
        "output_translation_bytes",
        "public_return_bytes",
        "execution_binding_sha256",
    ] {
        require(a[field] == b[field], "Private mask role metrics disagree.")?;
    }
    let ot_bytes = a["ot_wire_bytes"]
        .as_u64()
        .ok_or("Missing private mask OT byte count.")?;
    require(
        a["public_return_bytes"] == 0
            && a["output_translation_bytes"] == OUTPUT_BYTES
            && ot_bytes > 0,
        "Private mask transfer metrics differ from the private schema.",
    )?;
    let binding = a["execution_binding_sha256"]
        .as_str()
        .ok_or("Missing private mask execution binding.")?;
    require(
        bindings.insert(binding.to_owned()),
        "Private mask execution reused a session binding.",
    )
}

fn run_role(
    role: Role,
    schedule_path: &Path,
    input: &Path,
    result: &Path,
) -> InvestigationResult<()> {
    let schedule_bytes = fs::read(schedule_path)?;
    require(
        schedule_bytes.get(8) == Some(&0x8a),
        "Private mask role received a different kernel schema.",
    )?;
    let schedule = PrivateKernelSchedule::parse(&schedule_bytes)?;
    let input_bytes = Zeroizing::new(fs::read(input)?);
    let bits = role_input_bits(role, &input_bytes)?;
    let reader = io::stdin().lock();
    let writer = io::stdout().lock();
    let evaluation = match role {
        Role::A => garble_private_fixture(&schedule, &bits, reader, writer)?,
        Role::B => evaluate_private_fixture(&schedule, &bits, reader, writer)?,
    };
    let expected_bytes = match role {
        Role::A => 0,
        Role::B => OUTPUT_BYTES,
    };
    require(
        evaluation.output.len() == expected_bytes,
        "Private mask result violates output ownership.",
    )?;
    let bytes = Zeroizing::new(serde_json::to_vec(&json!({
        "output_hex": hex::encode(evaluation.output.as_slice()),
        "output_bytes": evaluation.output.len(),
        "metrics": private_execution::encode_metrics(&evaluation.metrics),
    }))?);
    write_private_file(result, &bytes)
}

fn role_input_bits(role: Role, bytes: &[u8]) -> InvestigationResult<Zeroizing<Vec<bool>>> {
    let expected_bytes = match role {
        Role::A => A_INPUT_BYTES,
        Role::B => SEED_SHARE_BYTES,
    };
    require(
        bytes.len() == expected_bytes,
        "Private mask role input has the wrong length.",
    )?;
    let mut bits = Zeroizing::new(Vec::with_capacity(match role {
        Role::A => 6_400,
        Role::B => 512,
    }));
    for byte in &bytes[..SEED_SHARE_BYTES] {
        for bit in 0..8 {
            bits.push((byte >> bit) & 1 != 0);
        }
    }
    if let Role::A = role {
        for chunk in bytes[SEED_SHARE_BYTES..].chunks_exact(4) {
            let residue = u32::from_le_bytes(chunk.try_into()?);
            require(
                residue < MODULUS,
                "Private mask A supplied an invalid residue.",
            )?;
            for bit in 0..23 {
                bits.push((residue >> bit) & 1 != 0);
            }
        }
    }
    Ok(bits)
}

fn uniform_masks() -> InvestigationResult<Zeroizing<[u32; COEFFICIENTS]>> {
    let mut masks = Zeroizing::new([0; COEFFICIENTS]);
    for mask in masks.iter_mut() {
        loop {
            let mut bytes = [0; 4];
            getrandom::getrandom(&mut bytes)?;
            let candidate = u32::from_le_bytes(bytes) & 0x7f_ffff;
            if candidate < MODULUS {
                *mask = candidate;
                break;
            }
        }
    }
    Ok(masks)
}

fn reference_coefficients(seed: &[u8; SEED_SHARE_BYTES], nonce: u16) -> [u32; COEFFICIENTS] {
    let mut shake = Shake256::default();
    shake.update(seed);
    shake.update(&nonce.to_le_bytes());
    let mut bytes = [0; MASK_BYTES];
    shake.finalize_xof().read(&mut bytes);
    let mut coefficients = [0; COEFFICIENTS];
    for (index, coefficient) in coefficients.iter_mut().enumerate() {
        let mut value = 0u32;
        for bit in 0..20 {
            let position = index * 20 + bit;
            value |= u32::from((bytes[position / 8] >> (position % 8)) & 1) << bit;
        }
        let signed = 524_288 - i64::from(value);
        *coefficient = signed.rem_euclid(i64::from(MODULUS)) as u32;
    }
    coefficients
}

fn decode_output(bytes: &[u8]) -> InvestigationResult<Zeroizing<[u32; COEFFICIENTS]>> {
    require(
        bytes.len() == OUTPUT_BYTES,
        "Private mask B output has the wrong length.",
    )?;
    let mut coefficients = Zeroizing::new([0; COEFFICIENTS]);
    for (index, coefficient) in coefficients.iter_mut().enumerate() {
        for bit in 0..23 {
            let position = index * 23 + bit;
            *coefficient |= u32::from((bytes[position / 8] >> (position % 8)) & 1) << bit;
        }
        require(
            *coefficient < MODULUS,
            "Private mask B returned an invalid residue.",
        )?;
    }
    Ok(coefficients)
}

fn check_shares(
    a: &[u32; COEFFICIENTS],
    b: &[u32; COEFFICIENTS],
    expected: &[u32; COEFFICIENTS],
) -> InvestigationResult<()> {
    for index in 0..COEFFICIENTS {
        require(
            a[index] < MODULUS && b[index] < MODULUS,
            "Private mask output contains an invalid residue.",
        )?;
        require(
            (u64::from(a[index]) + u64::from(b[index])) % u64::from(MODULUS)
                == u64::from(expected[index]),
            "Private mask shares differ from the independent SHAKE256 oracle.",
        )?;
    }
    Ok(())
}

fn polynomial_digest(polynomial: &[u32; COEFFICIENTS]) -> String {
    let mut bytes = Vec::with_capacity(COEFFICIENTS * 4);
    for coefficient in polynomial {
        bytes.extend_from_slice(&coefficient.to_le_bytes());
    }
    digest(&bytes)
}

fn write_private_file(path: &Path, bytes: &[u8]) -> InvestigationResult<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    Ok(())
}

fn source_identities() -> InvestigationResult<Vec<Value>> {
    let sources = [
        "src/signing_mask_evidence.rs",
        "src/private_execution.rs",
        "../ed25519-yao-generator/src/circuit/ml_dsa_signing_mask.rs",
        "../ed25519-yao-generator/src/circuit/keccak.rs",
        "../ed25519-yao-generator/src/circuit/ml_dsa_arithmetic.rs",
        "../ed25519-yao-generator/src/circuit/ir.rs",
        "../ed25519-yao-generator/src/circuit/schedule.rs",
        "../../crates/ed25519-yao/src/passive/phase5_benchmark/ml_dsa_private.rs",
        "../../crates/ed25519-yao/src/passive/ot.rs",
    ];
    let mut identities = Vec::with_capacity(sources.len());
    for source in sources {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(source);
        identities.push(json!({"path_from_tool": source, "sha256": digest(&fs::read(path)?)}));
    }
    Ok(identities)
}
