//! Private signing components for uniformly masked ML-DSA-65 keys.

use super::ir::{BuilderBit, CanonicalBooleanCircuitV1, CircuitBuilder};
use super::keccak::shake256;
use super::ml_dsa_arithmetic::{
    add_bits, add_conditional_modulus, or_bits, select_bit, subtract_bits, MODULUS, ZERO,
};
use super::schedule::CanonicalLivenessScheduleV1;
use super::{BooleanCircuitMetricsV1, ProvisionalScheduleMetricsV1};

const POLYNOMIAL_BITS: usize = 256 * 23;
const GAMMA2: u32 = (MODULUS - 1) / 32;
const BETA: u32 = 49 * 4;

/// A fixed private component in the experimental signing composition.
#[derive(Clone, Copy, Debug)]
pub enum MlDsaSigningWorkloadV1 {
    /// Derive the signing seed from shared K, joint randomness, and public mu.
    SigningSeed,
    /// Convert one shared commitment into masked high-bit shares.
    CommitmentHighBits,
    /// Hash shared high bits and public mu into a public challenge hash.
    CommitmentHash,
    /// Check one response polynomial and mask its validity bit.
    ResponseCheck,
    /// Check one low polynomial and correction, then mask its hint bits.
    RowCheckAndHints,
    /// Combine private validity bits and hint counts into one public decision.
    AggregateCheck,
}

impl MlDsaSigningWorkloadV1 {
    /// Returns the exact A input count.
    pub const fn garbler_input_bits(self) -> usize {
        match self {
            Self::SigningSeed => 1536,
            Self::CommitmentHighBits => 6912,
            Self::CommitmentHash => 6656,
            Self::ResponseCheck => 5889,
            Self::RowCheckAndHints => 12033,
            Self::AggregateCheck => 1664,
        }
    }
    /// Returns the exact B input count, including fixed zero padding.
    pub const fn evaluator_input_bits(self) -> usize {
        match self {
            Self::SigningSeed => 512,
            Self::CommitmentHighBits | Self::ResponseCheck => 5888,
            Self::CommitmentHash => 6144,
            Self::RowCheckAndHints => 11776,
            Self::AggregateCheck => 1664,
        }
    }
    /// Returns B's complete output count.
    pub const fn output_bits(self) -> usize {
        match self {
            Self::SigningSeed => 512,
            Self::CommitmentHighBits => 1024,
            Self::CommitmentHash => 384,
            Self::ResponseCheck | Self::AggregateCheck => 1,
            Self::RowCheckAndHints => 257,
        }
    }
    fn component(self) -> u8 {
        match self {
            Self::SigningSeed => 0x8b,
            Self::CommitmentHighBits => 0x8c,
            Self::CommitmentHash => 0x8d,
            Self::ResponseCheck => 0x8e,
            Self::RowCheckAndHints => 0x8f,
            Self::AggregateCheck => 0x90,
        }
    }
    fn input_schema(self) -> &'static [u8] {
        match self {
            Self::SigningSeed => b"ml-dsa65/sign-seed/input/v1:A:K-xor[256],rnd-xor[256],public-mu[512],seed-mask[512];B:K-xor[256],rnd-xor[256]:lsb0",
            Self::CommitmentHighBits => b"ml-dsa65/high/input/v1:A:w[256]:residue23,high-mask[256]:uint4;B:w[256]:residue23:lsb0",
            Self::CommitmentHash => b"ml-dsa65/challenge/input/v1:A:high-xor[6144],public-mu[512];B:high-xor[6144]:lsb0",
            Self::ResponseCheck => b"ml-dsa65/z-check/input/v1:A:z[256]:residue23,valid-mask[1];B:z[256]:residue23:lsb0",
            Self::RowCheckAndHints => b"ml-dsa65/row-check/input/v1:A:r[256],ct0[256]:residue23,valid-mask[1],hint-mask[256];B:r[256],ct0[256]:residue23:lsb0",
            Self::AggregateCheck => b"ml-dsa65/accept/input/v1:A:valid-xor[11],hint-xor[1536],zero-padding[117];B:same:lsb0",
        }
    }
    fn output_schema(self) -> &'static [u8] {
        match self {
            Self::SigningSeed => b"ml-dsa65/sign-seed/output/v1:B:seed-xor[512]:lsb0",
            Self::CommitmentHighBits => b"ml-dsa65/high/output/v1:B:high-xor[1024]:lsb0",
            Self::CommitmentHash => b"ml-dsa65/challenge/output/v1:public:challenge[384]:lsb0",
            Self::ResponseCheck => b"ml-dsa65/z-check/output/v1:B:valid-xor[1]:lsb0",
            Self::RowCheckAndHints => {
                b"ml-dsa65/row-check/output/v1:B:valid-xor[1],hint-xor[256]:lsb0"
            }
            Self::AggregateCheck => b"ml-dsa65/accept/output/v1:public:accept[1]:lsb0",
        }
    }
}

/// A signing circuit requiring private input transfer and declared output ownership.
pub struct MlDsaPrivateSigningCircuitV1 {
    circuit: CanonicalBooleanCircuitV1,
    schedule: CanonicalLivenessScheduleV1,
}
impl MlDsaPrivateSigningCircuitV1 {
    /// Returns measured Boolean gate counts.
    pub const fn metrics(&self) -> BooleanCircuitMetricsV1 {
        self.circuit.metrics()
    }
    /// Returns measured schedule resource counts.
    pub const fn schedule_metrics(&self) -> ProvisionalScheduleMetricsV1 {
        self.schedule.metrics()
    }
    /// Returns the exact public schedule encoding.
    pub fn canonical_schedule_encoding(&self) -> &[u8] {
        self.schedule.canonical_encoding()
    }
    /// Evaluates public fixture bits only. This method supplies no privacy.
    pub fn evaluate_public_fixture(&self, inputs: &[bool]) -> Result<Vec<bool>, &'static str> {
        self.schedule
            .evaluate(inputs)
            .map_err(|_| "Signing fixture input length differs from its schema.")
    }
}

/// Compiles one fixed signing component without receiving secret values.
pub fn compile_ml_dsa_private_signing_circuit_v1(
    workload: MlDsaSigningWorkloadV1,
) -> MlDsaPrivateSigningCircuitV1 {
    let count = workload.garbler_input_bits() + workload.evaluator_input_bits();
    let mut builder = CircuitBuilder::new(count as u32).expect("fixed signing input count");
    let inputs = builder.input_bits();
    let (a, b) = inputs.split_at(workload.garbler_input_bits());
    let outputs = match workload {
        MlDsaSigningWorkloadV1::SigningSeed => signing_seed(&mut builder, a, b),
        MlDsaSigningWorkloadV1::CommitmentHighBits => commitment_high(&mut builder, a, b),
        MlDsaSigningWorkloadV1::CommitmentHash => commitment_hash(&mut builder, a, b),
        MlDsaSigningWorkloadV1::ResponseCheck => response_check(&mut builder, a, b),
        MlDsaSigningWorkloadV1::RowCheckAndHints => row_check(&mut builder, a, b),
        MlDsaSigningWorkloadV1::AggregateCheck => aggregate_check(&mut builder, a, b),
    };
    let circuit = builder
        .finish_ml_dsa_private_signing_component(
            outputs,
            workload.component(),
            workload.input_schema(),
            workload.output_schema(),
        )
        .expect("fixed signing topology");
    let schedule = CanonicalLivenessScheduleV1::derive(&circuit);
    MlDsaPrivateSigningCircuitV1 { circuit, schedule }
}

fn signing_seed(
    builder: &mut CircuitBuilder,
    a: &[BuilderBit],
    b: &[BuilderBit],
) -> Vec<BuilderBit> {
    let mut message = Vec::with_capacity(1024);
    for bit in 0..512 {
        message.push(builder.xor(a[bit], b[bit]));
    }
    message.extend_from_slice(&a[512..1024]);
    let expanded = shake256(builder, &message, 64);
    let mut output = Vec::with_capacity(512);
    for bit in 0..512 {
        output.push(builder.xor(expanded[bit], a[1024 + bit]));
    }
    output
}

fn commitment_high(
    builder: &mut CircuitBuilder,
    a: &[BuilderBit],
    b: &[BuilderBit],
) -> Vec<BuilderBit> {
    let mut output = Vec::with_capacity(1024);
    for coefficient in 0..256 {
        let value = sum_residue(builder, residue(a, coefficient), residue(b, coefficient));
        let high = high_bits(builder, &value);
        for bit in 0..4 {
            output.push(builder.xor(high[bit], a[POLYNOMIAL_BITS + coefficient * 4 + bit]));
        }
    }
    output
}

fn commitment_hash(
    builder: &mut CircuitBuilder,
    a: &[BuilderBit],
    b: &[BuilderBit],
) -> Vec<BuilderBit> {
    let mut message = Vec::with_capacity(6656);
    message.extend_from_slice(&a[6144..]);
    for bit in 0..6144 {
        message.push(builder.xor(a[bit], b[bit]));
    }
    shake256(builder, &message, 48)
}

fn response_check(
    builder: &mut CircuitBuilder,
    a: &[BuilderBit],
    b: &[BuilderBit],
) -> Vec<BuilderBit> {
    let mut valid = Vec::with_capacity(256);
    for coefficient in 0..256 {
        let value = sum_residue(builder, residue(a, coefficient), residue(b, coefficient));
        valid.push(norm_below(builder, &value, (1 << 19) - BETA));
    }
    let all_valid = and_all(builder, valid);
    vec![builder.xor(all_valid, a[POLYNOMIAL_BITS])]
}

fn row_check(builder: &mut CircuitBuilder, a: &[BuilderBit], b: &[BuilderBit]) -> Vec<BuilderBit> {
    let mut valid = Vec::with_capacity(512);
    let mut hints = Vec::with_capacity(256);
    for coefficient in 0..256 {
        let r = sum_residue(builder, residue(a, coefficient), residue(b, coefficient));
        let correction = sum_residue(
            builder,
            residue(&a[POLYNOMIAL_BITS..], coefficient),
            residue(&b[POLYNOMIAL_BITS..], coefficient),
        );
        let r_high = high_bits(builder, &r);
        let low = low_bits(builder, &r, &r_high);
        valid.push(norm_below(builder, &low, GAMMA2 - BETA));
        valid.push(norm_below(builder, &correction, GAMMA2));
        let corrected = sum_residue(builder, &r, &correction);
        let corrected_high = high_bits(builder, &corrected);
        let mut difference = ZERO;
        for bit in 0..4 {
            let changed = builder.xor(r_high[bit], corrected_high[bit]);
            difference = or_bits(builder, difference, changed);
        }
        hints.push(builder.xor(difference, a[POLYNOMIAL_BITS * 2 + 1 + coefficient]));
    }
    let all_valid = and_all(builder, valid);
    let mut output = vec![builder.xor(all_valid, a[POLYNOMIAL_BITS * 2])];
    output.extend(hints);
    output
}

fn aggregate_check(
    builder: &mut CircuitBuilder,
    a: &[BuilderBit],
    b: &[BuilderBit],
) -> Vec<BuilderBit> {
    let mut validity = Vec::with_capacity(12);
    for bit in 0..11 {
        validity.push(builder.xor(a[bit], b[bit]));
    }
    let mut counts = Vec::with_capacity(1536);
    for bit in 11..1547 {
        counts.push(vec![builder.xor(a[bit], b[bit])]);
    }
    while counts.len() > 1 {
        let mut next = Vec::with_capacity(counts.len().div_ceil(2));
        for pair in counts.chunks(2) {
            next.push(if pair.len() == 2 {
                add_bits(builder, &pair[0], &pair[1], 11)
            } else {
                pair[0].clone()
            });
        }
        counts = next;
    }
    validity.push(less_than(builder, &counts[0], 56));
    vec![and_all(builder, validity)]
}

fn residue(bits: &[BuilderBit], index: usize) -> &[BuilderBit] {
    &bits[index * 23..(index + 1) * 23]
}
fn constants(value: u32, width: usize) -> Vec<BuilderBit> {
    let mut output = Vec::with_capacity(width);
    for bit in 0..width {
        output.push(BuilderBit::Constant(value >> bit & 1 == 1));
    }
    output
}
fn sum_residue(
    builder: &mut CircuitBuilder,
    a: &[BuilderBit],
    b: &[BuilderBit],
) -> Vec<BuilderBit> {
    let sum = add_bits(builder, a, b, 24);
    let (reduced, below_q) = subtract_bits(builder, &sum, &constants(MODULUS, 24));
    let mut output = Vec::with_capacity(23);
    for bit in 0..23 {
        output.push(select_bit(builder, below_q, sum[bit], reduced[bit]));
    }
    output
}
fn high_bits(builder: &mut CircuitBuilder, value: &[BuilderBit]) -> Vec<BuilderBit> {
    // Reciprocal formula from pq-crystals/dilithium/ref/rounding.c, gamma2=(q-1)/32.
    let biased = add_bits(builder, value, &constants(127, 23), 23);
    let approximate = &biased[7..];
    let mut shifted = vec![ZERO; 10];
    shifted.extend_from_slice(approximate);
    let product = add_bits(builder, approximate, &shifted, 26);
    let rounded = add_bits(builder, &product, &constants(1 << 21, 26), 26);
    rounded[22..26].to_vec()
}
fn low_bits(
    builder: &mut CircuitBuilder,
    value: &[BuilderBit],
    high: &[BuilderBit],
) -> Vec<BuilderBit> {
    let mut large = vec![ZERO; 19];
    large.extend_from_slice(high);
    let mut small = vec![ZERO; 9];
    small.extend_from_slice(high);
    small.resize(23, ZERO);
    let (multiple, _) = subtract_bits(builder, &large, &small);
    let (difference, negative) = subtract_bits(builder, value, &multiple);
    add_conditional_modulus(builder, &difference, negative)
}
fn less_than(builder: &mut CircuitBuilder, value: &[BuilderBit], bound: u32) -> BuilderBit {
    subtract_bits(builder, value, &constants(bound, value.len())).1
}
fn norm_below(builder: &mut CircuitBuilder, value: &[BuilderBit], bound: u32) -> BuilderBit {
    let positive = less_than(builder, value, bound);
    let below_negative = less_than(builder, value, MODULUS - bound + 1);
    let negative = builder.inv(below_negative);
    or_bits(builder, positive, negative)
}
fn and_all(builder: &mut CircuitBuilder, mut values: Vec<BuilderBit>) -> BuilderBit {
    assert!(!values.is_empty());
    while values.len() > 1 {
        let mut next = Vec::with_capacity(values.len().div_ceil(2));
        for pair in values.chunks(2) {
            next.push(if pair.len() == 2 {
                builder.and(pair[0], pair[1])
            } else {
                pair[0]
            });
        }
        values = next;
    }
    values[0]
}
