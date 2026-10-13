use core::fmt;

use super::ir::{BuilderBit, CanonicalBooleanCircuitV1, CircuitBuilder};
use super::ml_dsa_arithmetic::{
    add_bits, add_conditional_modulus, select_bit, subtract_bits, MODULUS, RESIDUE_BITS, ZERO,
};
use super::schedule::CanonicalLivenessScheduleV1;
use super::{
    BooleanCircuitMetricsV1, ProvisionalBenchmarkComponentDigest32V1,
    ProvisionalBenchmarkScheduleDigest32V1, ProvisionalScheduleMetricsV1,
};

const COEFFICIENTS: usize = 256;
const ROUNDING_BITS: usize = 13;
const HIGH_BITS: usize = 10;

pub(super) const INPUT_SCHEMA: &[u8] =
    b"seams/ml-dsa-investigation/power2round/input/v1:t-a[256],t-b[256],mask-a[256]:residue23-lsb0";
pub(super) const OUTPUT_SCHEMA: &[u8] = b"seams/ml-dsa-investigation/power2round/output/v1:t1[256]:uint10-lsb0,t0-share-b[256]:residue23-lsb0";

/// The input field that contains an invalid public fixture residue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MlDsaPower2RoundFixtureFieldV1 {
    /// A's additive share of the unrounded coefficient polynomial.
    TShareA,
    /// B's additive share of the unrounded coefficient polynomial.
    TShareB,
    /// A's retained additive share of the rounded low coefficient polynomial.
    MaskA,
}

/// A public Power2Round fixture contains a residue outside the ML-DSA modulus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MlDsaPower2RoundFixtureErrorV1 {
    /// Input field containing the invalid residue.
    pub field: MlDsaPower2RoundFixtureFieldV1,
    /// Position of the invalid residue within that input field.
    pub residue_index: usize,
    /// Invalid public residue supplied by the caller.
    pub residue_value: u32,
}

impl fmt::Display for MlDsaPower2RoundFixtureErrorV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Power2Round fixture {:?} residue {} must be below {}, received {}",
            self.field, self.residue_index, MODULUS, self.residue_value
        )
    }
}

impl std::error::Error for MlDsaPower2RoundFixtureErrorV1 {}

/// Cleartext output of one fixed public Power2Round polynomial fixture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlDsaPower2RoundFixtureOutputV1 {
    /// Public high coefficients after FIPS 204 Power2Round with d=13.
    pub t1: [u16; COEFFICIENTS],
    /// B's additive residues for the low coefficients, masked by A's input.
    pub t0_b_shares: [u32; COEFFICIENTS],
}

/// Host-only shared-input Power2Round and additive low-output-sharing circuit.
///
/// The circuit reconstructs each coefficient only as Boolean wires. It computes
/// `t = (t_a + t_b) mod q`, `t1 = (t + 4095) >> 13`, and `t0 = t - t1 * 8192`.
/// Thus an exact half-way value rounds to the positive low value 4096.
/// Only t1 and the masked B low share are outputs. The full t polynomial and
/// the unmasked low coefficients are never circuit outputs.
///
/// A retains the supplied masks as its low share. Independent uniform mask
/// residues below q are required for additive sharing. This passive benchmark
/// assumes honest input formation and does not generate or validate randomness.
/// It provides no production signing, key-generation, or secure transport API.
pub struct MlDsaPower2RoundCircuitV1 {
    circuit: CanonicalBooleanCircuitV1,
    schedule: CanonicalLivenessScheduleV1,
}

impl MlDsaPower2RoundCircuitV1 {
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

    /// Returns the exact canonical reusable-slot schedule encoding.
    pub fn canonical_schedule_encoding(&self) -> &[u8] {
        self.schedule.canonical_encoding()
    }

    /// Evaluates public fixtures in cleartext through the Boolean schedule.
    ///
    /// Inputs contain all A t shares, then B t shares, then A low masks.
    /// Each residue uses 23 least-significant-bit-first wires. This method
    /// provides no privacy or native constant-time guarantee and must never
    /// receive secrets.
    pub fn evaluate_public_fixture(
        &self,
        t_a: &[u32; COEFFICIENTS],
        t_b: &[u32; COEFFICIENTS],
        masks: &[u32; COEFFICIENTS],
    ) -> Result<MlDsaPower2RoundFixtureOutputV1, MlDsaPower2RoundFixtureErrorV1> {
        let mut inputs = Vec::with_capacity(COEFFICIENTS * RESIDUE_BITS * 3);
        append_fixture_residues(&mut inputs, t_a, MlDsaPower2RoundFixtureFieldV1::TShareA)?;
        append_fixture_residues(&mut inputs, t_b, MlDsaPower2RoundFixtureFieldV1::TShareB)?;
        append_fixture_residues(&mut inputs, masks, MlDsaPower2RoundFixtureFieldV1::MaskA)?;
        let outputs = self
            .schedule
            .evaluate(&inputs)
            .expect("fixed validated rounding fixture has the compiled input count");
        let mut t1 = [0_u16; COEFFICIENTS];
        let mut t0_b_shares = [0_u32; COEFFICIENTS];
        for (index, high) in t1.iter_mut().enumerate() {
            for bit in 0..HIGH_BITS {
                *high |= u16::from(outputs[index * HIGH_BITS + bit]) << bit;
            }
        }
        for (index, low_share) in t0_b_shares.iter_mut().enumerate() {
            for bit in 0..RESIDUE_BITS {
                *low_share |=
                    u32::from(outputs[COEFFICIENTS * HIGH_BITS + index * RESIDUE_BITS + bit])
                        << bit;
            }
        }
        Ok(MlDsaPower2RoundFixtureOutputV1 { t1, t0_b_shares })
    }
}

/// Compiles the fixed shared-input Power2Round circuit without reading fixtures.
pub fn compile_ml_dsa_power2round_circuit_v1() -> MlDsaPower2RoundCircuitV1 {
    let input_count = (COEFFICIENTS * RESIDUE_BITS * 3) as u32;
    let mut builder = CircuitBuilder::new(input_count).expect("fixed rounding circuit has inputs");
    let inputs = builder.input_bits();
    let field_bits = COEFFICIENTS * RESIDUE_BITS;
    let outputs = rounding_bits(
        &mut builder,
        &inputs[..field_bits],
        &inputs[field_bits..field_bits * 2],
        &inputs[field_bits * 2..],
    );
    let circuit = builder
        .finish_ml_dsa_power2round_component(outputs)
        .expect("fixed rounding topology is canonical");
    let schedule = CanonicalLivenessScheduleV1::derive(&circuit);
    MlDsaPower2RoundCircuitV1 { circuit, schedule }
}

pub(super) fn rounding_bits(
    builder: &mut CircuitBuilder,
    t_a_bits: &[BuilderBit],
    t_b_bits: &[BuilderBit],
    mask_bits: &[BuilderBit],
) -> Vec<BuilderBit> {
    assert_eq!(t_a_bits.len(), COEFFICIENTS * RESIDUE_BITS);
    assert_eq!(t_b_bits.len(), COEFFICIENTS * RESIDUE_BITS);
    assert_eq!(mask_bits.len(), COEFFICIENTS * RESIDUE_BITS);
    let mut high_outputs = Vec::with_capacity(COEFFICIENTS * HIGH_BITS);
    let mut low_share_outputs = Vec::with_capacity(COEFFICIENTS * RESIDUE_BITS);
    let modulus = constant_bits(MODULUS, RESIDUE_BITS + 1);
    let rounding_bias = constant_bits((1 << (ROUNDING_BITS - 1)) - 1, RESIDUE_BITS);
    for coefficient in 0..COEFFICIENTS {
        let t_a = input_residue(t_a_bits, coefficient);
        let t_b = input_residue(t_b_bits, coefficient);
        let mask = input_residue(mask_bits, coefficient);
        let sum = add_bits(builder, t_a, t_b, RESIDUE_BITS + 1);
        let (reduced_sum, below_modulus) = subtract_bits(builder, &sum, &modulus);
        let mut t = Vec::with_capacity(RESIDUE_BITS);
        for bit in 0..RESIDUE_BITS {
            t.push(select_bit(
                builder,
                below_modulus,
                sum[bit],
                reduced_sum[bit],
            ));
        }
        let rounded = add_bits(builder, &t, &rounding_bias, RESIDUE_BITS);
        let high = &rounded[ROUNDING_BITS..];
        high_outputs.extend_from_slice(high);
        let mut high_multiple = vec![ZERO; ROUNDING_BITS];
        high_multiple.extend_from_slice(high);
        let (low_signed, negative) = subtract_bits(builder, &t, &high_multiple);
        let low_residue = add_conditional_modulus(builder, &low_signed, negative);
        let (masked_low, borrow) = subtract_bits(builder, &low_residue, mask);
        low_share_outputs.extend(add_conditional_modulus(builder, &masked_low, borrow));
    }
    high_outputs.extend(low_share_outputs);
    high_outputs
}

fn append_fixture_residues(
    inputs: &mut Vec<bool>,
    residues: &[u32; COEFFICIENTS],
    field: MlDsaPower2RoundFixtureFieldV1,
) -> Result<(), MlDsaPower2RoundFixtureErrorV1> {
    for (residue_index, residue_value) in residues.iter().copied().enumerate() {
        if residue_value >= MODULUS {
            return Err(MlDsaPower2RoundFixtureErrorV1 {
                field,
                residue_index,
                residue_value,
            });
        }
        for bit in 0..RESIDUE_BITS {
            inputs.push(residue_value >> bit & 1 == 1);
        }
    }
    Ok(())
}

fn input_residue(inputs: &[BuilderBit], coefficient: usize) -> &[BuilderBit] {
    let start = coefficient * RESIDUE_BITS;
    &inputs[start..start + RESIDUE_BITS]
}

fn constant_bits(value: u32, width: usize) -> Vec<BuilderBit> {
    let mut bits = Vec::with_capacity(width);
    for bit in 0..width {
        bits.push(BuilderBit::Constant(value >> bit & 1 == 1));
    }
    bits
}
