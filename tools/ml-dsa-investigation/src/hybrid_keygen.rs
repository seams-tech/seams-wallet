//! Complete canonical key generation over public fixtures only.
//!
//! The Boolean components execute in cleartext. This composition materializes
//! every fixture secret, and it must never receive wallet material. Its scalar
//! arithmetic and rejection loops have no native constant-time guarantee.

use crate::{
    InvestigationResult, circuit_evidence::reference_shake256, digest, reference, require,
};
use ed25519_yao_generator::{
    MlDsaHashWorkloadV1, compile_ml_dsa_eta4_sampling_circuit_v1, compile_ml_dsa_hash_circuit_v1,
    compile_ml_dsa_power2round_circuit_v1,
};
use ml_dsa::{Keypair, MlDsa65, SigningKey};
use serde_json::{Value, json};
use sha3::{
    Shake128,
    digest::{ExtendableOutput, Update, XofReader},
};
use std::{fs, time::Instant};

const MODULUS: u32 = 8_380_417;
const COEFFICIENTS: usize = 256;
const SECRET_POLYNOMIALS: usize = 11;
const ROWS: usize = 6;
const COLUMNS: usize = 5;
const PREFIX_BYTES: usize = 481;
const FIXTURE_NAMES: [&str; 4] = ["zero", "incrementing", "all-ff", "alternating"];

pub(super) type Polynomial = [u32; COEFFICIENTS];
pub(super) type SecretVector = [Polynomial; SECRET_POLYNOMIALS];
pub(super) type PublicMatrix = [[Polynomial; COLUMNS]; ROWS];

struct PublicFixture {
    name: &'static str,
    seed: [u8; 32],
    seed_share_a: [u8; 32],
    seed_share_b: [u8; 32],
    expanded: [u8; 128],
    samples_a: SecretVector,
    samples_b: SecretVector,
    seed_evaluation_ns: u128,
    prefix_evaluation_ns: u128,
    sampler_evaluation_ns: u128,
}

pub(super) fn run() -> InvestigationResult<Value> {
    let started = Instant::now();
    let compile_start = Instant::now();
    let seed_circuit = compile_ml_dsa_hash_circuit_v1(MlDsaHashWorkloadV1::SeedExpansion);
    let seed_compile_ns = compile_start.elapsed().as_nanos();
    let mut circuit_identities = vec![json!({
        "component": "seed-expansion",
        "digest": hex::encode(seed_circuit.benchmark_component_digest().expose_public_bytes()),
        "and_gates": seed_circuit.metrics().and_gate_count(),
        "compile_wall_time_ns": seed_compile_ns,
    })];
    let mut fixtures = Vec::with_capacity(FIXTURE_NAMES.len());
    for name in FIXTURE_NAMES {
        let seed: [u8; 32] = reference::fixture_bytes(name, 32)?.try_into().unwrap();
        let seed_share_a: [u8; 32] = reference::fixture_bytes("alternating", 32)?
            .try_into()
            .unwrap();
        let mut seed_share_b = [0; 32];
        for index in 0..32 {
            seed_share_b[index] = seed[index] ^ seed_share_a[index];
        }
        let mut input = seed_share_a.to_vec();
        input.extend_from_slice(&seed_share_b);
        let evaluate_start = Instant::now();
        let expanded: [u8; 128] = seed_circuit
            .evaluate_public_fixture(&input)?
            .try_into()
            .unwrap();
        let seed_evaluation_ns = evaluate_start.elapsed().as_nanos();
        let mut oracle_input = seed.to_vec();
        oracle_input.extend_from_slice(&[6, 5]);
        require(
            expanded.as_slice() == reference_shake256(&oracle_input, 128),
            "Hybrid fixture seed expansion differs from SHAKE256.",
        )?;
        fixtures.push(PublicFixture {
            name,
            seed,
            seed_share_a,
            seed_share_b,
            expanded,
            samples_a: [[0; COEFFICIENTS]; SECRET_POLYNOMIALS],
            samples_b: [[0; COEFFICIENTS]; SECRET_POLYNOMIALS],
            seed_evaluation_ns,
            prefix_evaluation_ns: 0,
            sampler_evaluation_ns: 0,
        });
    }
    drop(seed_circuit);

    let compile_start = Instant::now();
    let sampler = compile_ml_dsa_eta4_sampling_circuit_v1();
    let sampler_compile_ns = compile_start.elapsed().as_nanos();
    circuit_identities.push(json!({
        "component": "eta4-sampler-and-additive-output-conversion",
        "digest": hex::encode(sampler.benchmark_component_digest().expose_public_bytes()),
        "and_gates": sampler.metrics().and_gate_count(),
        "compile_wall_time_ns": sampler_compile_ns,
    }));
    let mut prefix_compile_ns = 0;
    for nonce in 0_u16..SECRET_POLYNOMIALS as u16 {
        let compile_start = Instant::now();
        let prefix_circuit =
            compile_ml_dsa_hash_circuit_v1(MlDsaHashWorkloadV1::ExpandSPolynomial { nonce });
        let compile_ns = compile_start.elapsed().as_nanos();
        prefix_compile_ns += compile_ns;
        circuit_identities.push(json!({
            "component": "expand-s-prefix",
            "nonce": nonce,
            "digest": hex::encode(prefix_circuit.benchmark_component_digest().expose_public_bytes()),
            "and_gates": prefix_circuit.metrics().and_gate_count(),
            "compile_wall_time_ns": compile_ns,
        }));
        for (fixture_index, fixture) in fixtures.iter_mut().enumerate() {
            let evaluate_start = Instant::now();
            let prefix: [u8; PREFIX_BYTES] = prefix_circuit
                .evaluate_public_fixture(&fixture.expanded[32..96])?
                .try_into()
                .unwrap();
            fixture.prefix_evaluation_ns += evaluate_start.elapsed().as_nanos();
            let masks = fixture_masks(usize::from(nonce), fixture_index);
            let evaluate_start = Instant::now();
            let output = sampler.evaluate_public_fixture(&prefix, &masks)?;
            fixture.sampler_evaluation_ns += evaluate_start.elapsed().as_nanos();
            require(
                output.success,
                "Public canonical fixture exhausted its fixed ExpandS prefix.",
            )?;
            fixture.samples_a[usize::from(nonce)] = masks;
            fixture.samples_b[usize::from(nonce)] = output.deriver_b_shares;
        }
    }
    drop(sampler);

    let compile_start = Instant::now();
    let rounding = compile_ml_dsa_power2round_circuit_v1();
    let rounding_compile_ns = compile_start.elapsed().as_nanos();
    circuit_identities.push(json!({
        "component": "power2round-and-additive-output-conversion",
        "digest": hex::encode(rounding.benchmark_component_digest().expose_public_bytes()),
        "and_gates": rounding.metrics().and_gate_count(),
        "compile_wall_time_ns": rounding_compile_ns,
    }));
    let twiddles = ntt_twiddles();
    let mut cases = Vec::with_capacity(fixtures.len());
    for (fixture_index, fixture) in fixtures.iter().enumerate() {
        cases.push(complete_fixture(
            fixture,
            fixture_index,
            &rounding,
            &twiddles,
        )?);
    }
    Ok(json!({
        "scope": "Complete public-fixture hybrid canonical ML-DSA-65 key generation. Boolean seed expansion, bounded sampling, additive shares, local NTT arithmetic, and Boolean Power2Round compose to the ordinary FIPS encodings.",
        "security_limit": "All fixture seeds, rho-prime values, K values, coefficients, and shares exist in this one process. Boolean execution is cleartext. This composition proves arithmetic interoperability only.",
        "fixed_prefix_contract": "The composition stops if any 481-byte sampler prefix fails. It retains the original canonical seed. A secure retry or continuation protocol remains separate work.",
        "mask_distribution_limit": "A protocol requires independent uniform masks below q. These deterministic public boundary masks check conversion and arithmetic only. Their generation has no entropy or timing claim.",
        "native_arithmetic_limit": "Public-fixture modular reductions and public matrix rejection loops are variable-time reference code. This implementation provides no native constant-time guarantee.",
        "implementation_source_sha256": digest(&fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/src/hybrid_keygen.rs"))?),
        "compile_wall_time_ns": {
            "seed": seed_compile_ns,
            "eleven_prefixes": prefix_compile_ns,
            "sampler": sampler_compile_ns,
            "rounding": rounding_compile_ns,
        },
        "total_wall_time_ns_including_compilation_and_oracles": started.elapsed().as_nanos(),
        "circuit_identities": circuit_identities,
        "share_shape_per_role": {
            "canonical_seed_xor_share_bytes": 32,
            "k_xor_share_bytes": 32,
            "s1_additive_residues": COLUMNS * COEFFICIENTS,
            "s2_additive_residues": ROWS * COEFFICIENTS,
            "t0_additive_residues": ROWS * COEFFICIENTS,
            "residue_modulus": MODULUS,
            "residue_bits": 23,
            "private_polynomial_output_to_a": "A retains its input masks.",
            "private_polynomial_output_to_b": "Sampler and rounding return B residues. This public fixture receives them in cleartext.",
            "public_output": "rho and six t1 polynomials, encoded as an ordinary 1952-byte public key.",
        },
        "fixtures": cases,
    }))
}

fn complete_fixture(
    fixture: &PublicFixture,
    fixture_index: usize,
    rounding: &ed25519_yao_generator::MlDsaPower2RoundCircuitV1,
    twiddles: &Polynomial,
) -> InvestigationResult<Value> {
    let total_start = Instant::now();
    let expand_start = Instant::now();
    let (matrix, rejected_candidates) = expand_a(&fixture.expanded[..32]);
    let expand_a_ns = expand_start.elapsed().as_nanos();
    let arithmetic_start = Instant::now();
    let t_a = matrix_product_plus_error(&matrix, &fixture.samples_a, twiddles);
    let arithmetic_a_ns = arithmetic_start.elapsed().as_nanos();
    let arithmetic_start = Instant::now();
    let t_b = matrix_product_plus_error(&matrix, &fixture.samples_b, twiddles);
    let arithmetic_b_ns = arithmetic_start.elapsed().as_nanos();
    let mut t1 = [[0; COEFFICIENTS]; ROWS];
    let mut t0_a = [[0; COEFFICIENTS]; ROWS];
    let mut t0_b = [[0; COEFFICIENTS]; ROWS];
    let rounding_start = Instant::now();
    for row in 0..ROWS {
        t0_a[row] = fixture_masks(SECRET_POLYNOMIALS + row, fixture_index);
        let output = rounding.evaluate_public_fixture(&t_a[row], &t_b[row], &t0_a[row])?;
        for (coefficient, high) in output.t1.into_iter().enumerate() {
            t1[row][coefficient] = u32::from(high);
        }
        t0_b[row] = output.t0_b_shares;
    }
    let rounding_evaluation_ns = rounding_start.elapsed().as_nanos();
    let public_key = encode_public_key(&fixture.expanded[..32], &t1)?;
    let key = SigningKey::<MlDsa65>::from_seed(&fixture.seed.into());
    require(
        public_key == key.verifying_key().encode().as_slice(),
        "Hybrid public key differs from the canonical RustCrypto key.",
    )?;

    // Reconstruction belongs only to this public validation recipient.
    let s1 = reconstruct_vector(&fixture.samples_a[..COLUMNS], &fixture.samples_b[..COLUMNS]);
    let s2 = reconstruct_vector(&fixture.samples_a[COLUMNS..], &fixture.samples_b[COLUMNS..]);
    let t0 = reconstruct_vector(&t0_a, &t0_b);
    let mut expanded_private = fixture.expanded[..32].to_vec();
    expanded_private.extend_from_slice(&fixture.expanded[96..128]);
    expanded_private.extend_from_slice(&reference_shake256(&public_key, 64));
    let mut encoded_s1 = Vec::new();
    let mut encoded_s2 = Vec::new();
    let mut encoded_t0 = Vec::new();
    pack_signed_vector(&s1, 4, 4, &mut encoded_s1)?;
    pack_signed_vector(&s2, 4, 4, &mut encoded_s2)?;
    pack_signed_vector(&t0, 4096, 13, &mut encoded_t0)?;
    expanded_private.extend_from_slice(&encoded_s1);
    expanded_private.extend_from_slice(&encoded_s2);
    expanded_private.extend_from_slice(&encoded_t0);
    let openssl_expanded = reference::expanded_public_fixture_key(fixture.name)?;
    require(
        expanded_private == openssl_expanded,
        "Hybrid expanded private encoding differs from OpenSSL.",
    )?;
    let mut recovered = [0; 32];
    for (index, recovered_byte) in recovered.iter_mut().enumerate() {
        *recovered_byte = fixture.seed_share_a[index] ^ fixture.seed_share_b[index];
    }
    let recovered_key = SigningKey::<MlDsa65>::from_seed(&recovered.into());
    require(
        recovered == fixture.seed
            && recovered_key.verifying_key().encode().as_slice() == public_key,
        "Hybrid seed recovery differs from the canonical key.",
    )?;
    let k_share_a = reference::fixture_bytes("incrementing", 32)?;
    let mut k_share_b = [0; 32];
    for (index, share) in k_share_b.iter_mut().enumerate() {
        *share = k_share_a[index] ^ fixture.expanded[96 + index];
    }
    Ok(json!({
        "fixture": fixture.name,
        "public_seed_hex": hex::encode(fixture.seed),
        "public_key_sha256": digest(&public_key),
        "expanded_private_sha256_public_fixture_only": digest(&expanded_private),
        "private_components_sha256_public_fixture_only": {
            "rho": digest(&fixture.expanded[..32]),
            "rho_prime": digest(&fixture.expanded[32..96]),
            "k": digest(&fixture.expanded[96..128]),
            "s1_fips_encoding": digest(&encoded_s1),
            "s2_fips_encoding": digest(&encoded_s2),
            "t0_fips_encoding": digest(&encoded_t0),
        },
        "role_a_share_sha256_public_fixture_only": digest(&share_bytes(&fixture.samples_a, &t0_a, &k_share_a)),
        "role_b_share_sha256_public_fixture_only": digest(&share_bytes(&fixture.samples_b, &t0_b, &k_share_b)),
        "public_matrix_rejected_candidates": rejected_candidates,
        "canonical_public_key_matches_rustcrypto": true,
        "complete_expanded_private_encoding_matches_openssl": true,
        "reconstructed_original_seed_reproduces_public_key": true,
        "wall_time_ns": {
            "seed_boolean_evaluation": fixture.seed_evaluation_ns,
            "eleven_prefix_boolean_evaluations": fixture.prefix_evaluation_ns,
            "eleven_sampler_boolean_evaluations": fixture.sampler_evaluation_ns,
            "public_matrix_expansion_once_shared_by_roles": expand_a_ns,
            "role_a_local_ntt_matrix_arithmetic": arithmetic_a_ns,
            "role_b_local_ntt_matrix_arithmetic": arithmetic_b_ns,
            "six_rounding_boolean_evaluations": rounding_evaluation_ns,
            "completion_including_encoding_oracles_and_recovery": total_start.elapsed().as_nanos(),
        },
    }))
}

fn fixture_masks(polynomial: usize, fixture: usize) -> Polynomial {
    let mut masks = [0; COEFFICIENTS];
    for (index, mask) in masks.iter_mut().enumerate() {
        *mask = match index % 4 {
            0 => 0,
            1 => MODULUS - 1,
            2 => 4,
            _ => ((index + polynomial * COEFFICIENTS + fixture * 4096) as u32 * 32_749) % MODULUS,
        };
    }
    masks
}

pub(super) fn expand_a(rho: &[u8]) -> (PublicMatrix, usize) {
    let mut matrix = [[[0; COEFFICIENTS]; COLUMNS]; ROWS];
    let mut rejected = 0;
    for (row, polynomials) in matrix.iter_mut().enumerate() {
        for (column, polynomial) in polynomials.iter_mut().enumerate() {
            let mut hash = Shake128::default();
            hash.update(rho);
            hash.update(&[column as u8, row as u8]);
            let mut reader = hash.finalize_xof();
            let mut count = 0;
            while count < COEFFICIENTS {
                let mut bytes = [0; 3];
                reader.read(&mut bytes);
                let candidate = u32::from(bytes[0])
                    | (u32::from(bytes[1]) << 8)
                    | (u32::from(bytes[2] & 0x7f) << 16);
                if candidate < MODULUS {
                    polynomial[count] = candidate;
                    count += 1;
                } else {
                    rejected += 1;
                }
            }
        }
    }
    (matrix, rejected)
}

/// Applies the linear lattice operations separately to one role's residues.
///
/// The NTT uses fixed loop bounds and public indices. Modular divisors are
/// constant q. This benchmark helper has no native constant-time guarantee.
pub(super) fn matrix_product_plus_error(
    matrix: &PublicMatrix,
    samples: &SecretVector,
    twiddles: &Polynomial,
) -> [Polynomial; ROWS] {
    let mut s1_ntt = [[0; COEFFICIENTS]; COLUMNS];
    for column in 0..COLUMNS {
        s1_ntt[column] = ntt(samples[column], twiddles);
    }
    let mut output = [[0; COEFFICIENTS]; ROWS];
    for row in 0..ROWS {
        let mut product_ntt = [0; COEFFICIENTS];
        for (column, s1_polynomial) in s1_ntt.iter().enumerate() {
            for coefficient in 0..COEFFICIENTS {
                product_ntt[coefficient] = add_mod(
                    product_ntt[coefficient],
                    multiply_mod(matrix[row][column][coefficient], s1_polynomial[coefficient]),
                );
            }
        }
        let product = inverse_ntt(product_ntt, twiddles);
        for coefficient in 0..COEFFICIENTS {
            output[row][coefficient] =
                add_mod(product[coefficient], samples[COLUMNS + row][coefficient]);
        }
    }
    output
}

pub(super) fn ntt_twiddles() -> Polynomial {
    let mut powers = [0; COEFFICIENTS];
    powers[0] = 1;
    for index in 1..COEFFICIENTS {
        powers[index] = multiply_mod(powers[index - 1], 1753);
    }
    let mut twiddles = [0; COEFFICIENTS];
    for (index, twiddle) in twiddles.iter_mut().enumerate().skip(1) {
        *twiddle = powers[usize::from((index as u8).reverse_bits())];
    }
    twiddles
}

fn ntt(mut polynomial: Polynomial, twiddles: &Polynomial) -> Polynomial {
    let mut twiddle_index = 0;
    let mut length = COEFFICIENTS / 2;
    while length > 0 {
        for start in (0..COEFFICIENTS).step_by(2 * length) {
            twiddle_index += 1;
            let twiddle = twiddles[twiddle_index];
            for index in start..start + length {
                let product = multiply_mod(twiddle, polynomial[index + length]);
                polynomial[index + length] = subtract_mod(polynomial[index], product);
                polynomial[index] = add_mod(polynomial[index], product);
            }
        }
        length /= 2;
    }
    polynomial
}

fn inverse_ntt(mut polynomial: Polynomial, twiddles: &Polynomial) -> Polynomial {
    let mut twiddle_index = COEFFICIENTS;
    let mut length = 1;
    while length < COEFFICIENTS {
        for start in (0..COEFFICIENTS).step_by(2 * length) {
            twiddle_index -= 1;
            let twiddle = MODULUS - twiddles[twiddle_index];
            for index in start..start + length {
                let lower = polynomial[index];
                polynomial[index] = add_mod(lower, polynomial[index + length]);
                polynomial[index + length] =
                    multiply_mod(twiddle, subtract_mod(lower, polynomial[index + length]));
            }
        }
        length *= 2;
    }
    for coefficient in &mut polynomial {
        *coefficient = multiply_mod(*coefficient, 8_347_681);
    }
    polynomial
}

fn add_mod(left: u32, right: u32) -> u32 {
    (left + right) % MODULUS
}

fn subtract_mod(left: u32, right: u32) -> u32 {
    (left + MODULUS - right) % MODULUS
}

fn multiply_mod(left: u32, right: u32) -> u32 {
    (u64::from(left) * u64::from(right) % u64::from(MODULUS)) as u32
}

pub(super) fn reconstruct_vector(a: &[Polynomial], b: &[Polynomial]) -> Vec<Polynomial> {
    let mut reconstructed = Vec::with_capacity(a.len());
    for (polynomial_a, polynomial_b) in a.iter().zip(b) {
        let mut polynomial = [0; COEFFICIENTS];
        for index in 0..COEFFICIENTS {
            polynomial[index] = add_mod(polynomial_a[index], polynomial_b[index]);
        }
        reconstructed.push(polynomial);
    }
    reconstructed
}

pub(super) fn pack_signed_vector(
    polynomials: &[Polynomial],
    maximum: u32,
    bits: usize,
    output: &mut Vec<u8>,
) -> InvestigationResult<()> {
    for polynomial in polynomials {
        let mut encoded = [0; COEFFICIENTS];
        for (index, coefficient) in polynomial.iter().copied().enumerate() {
            encoded[index] = subtract_mod(maximum, coefficient);
        }
        pack_unsigned(&encoded, bits, output)?;
    }
    Ok(())
}

pub(super) fn encode_public_key(
    rho: &[u8],
    t1: &[Polynomial; ROWS],
) -> InvestigationResult<Vec<u8>> {
    require(rho.len() == 32, "Public key rho must contain 32 bytes.")?;
    let mut public_key = rho.to_vec();
    for polynomial in t1 {
        pack_unsigned(polynomial, 10, &mut public_key)?;
    }
    require(
        public_key.len() == 1952,
        "Hybrid public key has the wrong size.",
    )?;
    Ok(public_key)
}

fn pack_unsigned(
    polynomial: &Polynomial,
    bits: usize,
    output: &mut Vec<u8>,
) -> InvestigationResult<()> {
    let start = output.len();
    output.resize(start + COEFFICIENTS * bits / 8, 0);
    for (index, coefficient) in polynomial.iter().copied().enumerate() {
        require(
            coefficient < 1 << bits,
            "FIPS coefficient exceeds its encoding range.",
        )?;
        for bit in 0..bits {
            let position = index * bits + bit;
            output[start + position / 8] |= ((coefficient >> bit) as u8 & 1) << (position % 8);
        }
    }
    Ok(())
}

fn share_bytes(samples: &[Polynomial], t0: &[Polynomial], k: &[u8]) -> Vec<u8> {
    let mut bytes = k.to_vec();
    for polynomial in samples.iter().chain(t0) {
        for coefficient in polynomial {
            bytes.extend_from_slice(&coefficient.to_le_bytes());
        }
    }
    bytes
}
