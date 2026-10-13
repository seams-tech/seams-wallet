use core::fmt;

use super::ir::{BuilderBit, CanonicalBooleanCircuitV1, CircuitBuilder};
use super::keccak::{append_constant_byte, shake256};
use super::ml_dsa_arithmetic::{add_conditional_modulus, subtract_bits, MODULUS, RESIDUE_BITS};
use super::schedule::CanonicalLivenessScheduleV1;
use super::{
    BooleanCircuitMetricsV1, ProvisionalBenchmarkComponentDigest32V1,
    ProvisionalBenchmarkScheduleDigest32V1, ProvisionalScheduleMetricsV1,
};

const SEED_BYTES: usize = 64;
const SEED_BITS: usize = SEED_BYTES * 8;
const COEFFICIENTS: usize = 256;
const ENCODED_COEFFICIENT_BITS: usize = 20;
const STREAM_BYTES: usize = COEFFICIENTS * ENCODED_COEFFICIENT_BITS / 8;
const GAMMA1: u32 = 1 << 19;
const MASK_BITS: usize = COEFFICIENTS * RESIDUE_BITS;
const A_INPUT_BITS: usize = SEED_BITS + MASK_BITS;

const INPUT_SCHEMA: &[u8] = b"seams/ml-dsa-investigation/private-signing-mask/input/v1:A:rho-double-prime-share[64]:byte-major-lsb0,mask[256]:residue23-lsb0;B:rho-double-prime-share[64]:byte-major-lsb0:nonce-public-le16";
const OUTPUT_SCHEMA: &[u8] =
    b"seams/ml-dsa-investigation/private-signing-mask/output/v1:B:y-share[256]:residue23-lsb0";

/// A public ExpandMask fixture contains a mask outside the ML-DSA modulus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MlDsaSigningMaskFixtureErrorV1 {
    /// Position of the invalid public mask residue.
    pub mask_index: usize,
    /// Invalid public mask residue supplied by the caller.
    pub mask_value: u32,
}

impl fmt::Display for MlDsaSigningMaskFixtureErrorV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "ExpandMask fixture mask {} must be below {}, received {}",
            self.mask_index, MODULUS, self.mask_value
        )
    }
}

impl std::error::Error for MlDsaSigningMaskFixtureErrorV1 {}

/// Cleartext output of one fixed public ExpandMask polynomial fixture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlDsaSigningMaskFixtureOutputV1 {
    /// B's additive residues, masked by A's independently supplied residues.
    pub deriver_b_shares: [u32; COEFFICIENTS],
}

/// Host-only ML-DSA-65 ExpandMask circuit with private additive outputs.
///
/// The circuit XORs two 64-byte seed shares and computes the first 640 bytes of
/// SHAKE256(seed || LE16(nonce)). It decodes 256 little-endian 20-bit values.
/// Each coefficient equals `2^19 - value`, in the interval [-524287, 524288].
/// The circuit returns only B's residues `(coefficient - mask_a) mod q`.
/// A retains its 256 input masks as its additive output share.
///
/// A must supply fresh independent uniform mask residues below q. The passive
/// investigation profile assumes honest input formation. The fixed Boolean
/// topology never branches or indexes memory from a private input value.
///
/// Private inputs require a secure executor with private input transfer and
/// B-only output delivery. This type implements no production signing protocol.
pub struct MlDsaPrivateSigningMaskCircuitV1 {
    circuit: CanonicalBooleanCircuitV1,
    schedule: CanonicalLivenessScheduleV1,
    nonce: u16,
}

impl MlDsaPrivateSigningMaskCircuitV1 {
    /// Returns the public polynomial nonce compiled into this circuit.
    pub const fn nonce(&self) -> u16 {
        self.nonce
    }

    /// Returns counts measured from the finalized Boolean circuit.
    pub const fn metrics(&self) -> BooleanCircuitMetricsV1 {
        self.circuit.metrics()
    }

    /// Returns counts measured from the reusable-slot evaluation schedule.
    pub const fn schedule_metrics(&self) -> ProvisionalScheduleMetricsV1 {
        self.schedule.metrics()
    }

    /// Returns the identity of the exact canonical Boolean circuit bytes.
    pub const fn benchmark_component_digest(&self) -> ProvisionalBenchmarkComponentDigest32V1 {
        ProvisionalBenchmarkComponentDigest32V1(self.circuit.digest())
    }

    /// Returns the identity of the exact canonical evaluation schedule bytes.
    pub const fn benchmark_schedule_digest(&self) -> ProvisionalBenchmarkScheduleDigest32V1 {
        ProvisionalBenchmarkScheduleDigest32V1(self.schedule.digest())
    }

    /// Returns the exact canonical Boolean circuit encoding.
    pub fn canonical_encoding(&self) -> &[u8] {
        self.circuit.canonical_encoding()
    }

    /// Returns the host benchmark schedule for two-party execution.
    pub fn canonical_schedule_encoding(&self) -> &[u8] {
        self.schedule.canonical_encoding()
    }

    /// Evaluates a public fixture through the Boolean schedule in cleartext.
    ///
    /// Inputs contain A's seed share, A's masks, then B's seed share.
    /// Each byte and each 23-bit residue use least-significant-bit-first order.
    /// This method provides no privacy or native constant-time guarantee.
    /// It must never receive secrets.
    pub fn evaluate_public_fixture(
        &self,
        rho_double_prime_a: &[u8; SEED_BYTES],
        rho_double_prime_b: &[u8; SEED_BYTES],
        a_masks: &[u32; COEFFICIENTS],
    ) -> Result<MlDsaSigningMaskFixtureOutputV1, MlDsaSigningMaskFixtureErrorV1> {
        let mut inputs = Vec::with_capacity(A_INPUT_BITS + SEED_BITS);
        append_fixture_bytes(&mut inputs, rho_double_prime_a);
        for (mask_index, mask_value) in a_masks.iter().copied().enumerate() {
            if mask_value >= MODULUS {
                return Err(MlDsaSigningMaskFixtureErrorV1 {
                    mask_index,
                    mask_value,
                });
            }
            for bit in 0..RESIDUE_BITS {
                inputs.push(mask_value >> bit & 1 == 1);
            }
        }
        append_fixture_bytes(&mut inputs, rho_double_prime_b);
        let outputs = self
            .schedule
            .evaluate(&inputs)
            .expect("validated ExpandMask fixture has the compiled input count");
        let mut deriver_b_shares = [0_u32; COEFFICIENTS];
        for (coefficient, residue) in deriver_b_shares.iter_mut().enumerate() {
            for bit in 0..RESIDUE_BITS {
                *residue |= u32::from(outputs[coefficient * RESIDUE_BITS + bit]) << bit;
            }
        }
        Ok(MlDsaSigningMaskFixtureOutputV1 { deriver_b_shares })
    }
}

/// Compiles one FIPS 204 ExpandMask polynomial for a fixed public nonce.
///
/// A's first 6,400 bits contain its 64-byte rho-double-prime XOR share and 256
/// independent mask residues below q. B's final 512 bits contain its XOR share.
/// Only B receives the 5,888 output bits. No seed or SHAKE stream is an output.
pub fn compile_ml_dsa_private_signing_mask_circuit_v1(
    nonce: u16,
) -> MlDsaPrivateSigningMaskCircuitV1 {
    let mut builder = CircuitBuilder::new((A_INPUT_BITS + SEED_BITS) as u32)
        .expect("fixed private ExpandMask circuit has inputs");
    let inputs = builder.input_bits();
    let mut message = Vec::with_capacity((SEED_BYTES + 2) * 8);
    for bit in 0..SEED_BITS {
        message.push(builder.xor(inputs[bit], inputs[A_INPUT_BITS + bit]));
    }
    for byte in nonce.to_le_bytes() {
        append_constant_byte(&mut message, byte);
    }
    let stream = shake256(&mut builder, &message, STREAM_BYTES);
    let outputs = signing_mask_bits(&mut builder, &stream, &inputs[SEED_BITS..A_INPUT_BITS]);
    let circuit = builder
        .finish_ml_dsa_private_signing_mask_component(outputs, INPUT_SCHEMA, OUTPUT_SCHEMA)
        .expect("fixed private ExpandMask topology is canonical");
    let schedule = CanonicalLivenessScheduleV1::derive(&circuit);
    MlDsaPrivateSigningMaskCircuitV1 {
        circuit,
        schedule,
        nonce,
    }
}

fn signing_mask_bits(
    builder: &mut CircuitBuilder,
    stream_bits: &[BuilderBit],
    mask_bits: &[BuilderBit],
) -> Vec<BuilderBit> {
    assert_eq!(stream_bits.len(), COEFFICIENTS * ENCODED_COEFFICIENT_BITS);
    assert_eq!(mask_bits.len(), MASK_BITS);
    let gamma1 = constant_bits(GAMMA1, ENCODED_COEFFICIENT_BITS);
    let mut outputs = Vec::with_capacity(MASK_BITS);
    for coefficient in 0..COEFFICIENTS {
        let stream_start = coefficient * ENCODED_COEFFICIENT_BITS;
        let encoded = &stream_bits[stream_start..stream_start + ENCODED_COEFFICIENT_BITS];
        let (mut signed_coefficient, negative) = subtract_bits(builder, &gamma1, encoded);
        // The borrow gives the sign. Bit 19 is also set for positive gamma1.
        signed_coefficient.resize(RESIDUE_BITS, negative);
        let residue = add_conditional_modulus(builder, &signed_coefficient, negative);
        let mask_start = coefficient * RESIDUE_BITS;
        let mask = &mask_bits[mask_start..mask_start + RESIDUE_BITS];
        let (difference, borrow) = subtract_bits(builder, &residue, mask);
        outputs.extend(add_conditional_modulus(builder, &difference, borrow));
    }
    outputs
}

fn append_fixture_bytes(inputs: &mut Vec<bool>, bytes: &[u8; SEED_BYTES]) {
    for byte in bytes {
        for bit in 0..8 {
            inputs.push(byte >> bit & 1 == 1);
        }
    }
}

fn constant_bits(value: u32, width: usize) -> Vec<BuilderBit> {
    let mut bits = Vec::with_capacity(width);
    for bit in 0..width {
        bits.push(BuilderBit::Constant(value >> bit & 1 == 1));
    }
    bits
}
