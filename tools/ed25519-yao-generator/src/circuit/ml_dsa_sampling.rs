use core::fmt;

use super::ir::{BuilderBit, CanonicalBooleanCircuitV1, CircuitBuilder};
use super::ml_dsa_arithmetic::{
    add_bits, add_conditional_modulus, or_bits, select_bit, subtract_bits, MODULUS, RESIDUE_BITS,
    ZERO,
};
use super::schedule::CanonicalLivenessScheduleV1;
use super::{
    BooleanCircuitMetricsV1, ProvisionalBenchmarkComponentDigest32V1,
    ProvisionalBenchmarkScheduleDigest32V1, ProvisionalScheduleMetricsV1,
};

const COEFFICIENTS: usize = 256;
const PREFIX_BYTES: usize = 481;

pub(super) const INPUT_SCHEMA: &[u8] = b"seams/ml-dsa-investigation/eta4-sampling/input/v1:prefix[481]:byte-major-lsb0,mask-a[256]:residue23-lsb0";
pub(super) const OUTPUT_SCHEMA: &[u8] = b"seams/ml-dsa-investigation/eta4-sampling/output/v1:success[1],share-b[256]:residue23-lsb0:zero-on-failure";

type Nibble = [BuilderBit; 4];

struct CompactedNibbles {
    values: Vec<Nibble>,
    accepted_count: Vec<BuilderBit>,
}

/// A public sampling fixture contains a residue outside the ML-DSA modulus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MlDsaEta4SamplingFixtureErrorV1 {
    /// Position of the invalid public mask residue.
    pub mask_index: usize,
    /// Invalid public mask residue supplied by the caller.
    pub mask_value: u32,
}

impl fmt::Display for MlDsaEta4SamplingFixtureErrorV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "sampling fixture mask {} must be below {}, received {}",
            self.mask_index, MODULUS, self.mask_value
        )
    }
}

impl std::error::Error for MlDsaEta4SamplingFixtureErrorV1 {}

/// Cleartext output of the fixed public eta=4 sampling fixture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlDsaEta4SamplingFixtureOutputV1 {
    /// Whether the fixed prefix contains at least 256 accepted nibbles.
    pub success: bool,
    /// The 256 residues `(4 - accepted_nibble - mask_a) mod q` on success.
    /// All residues are zero on failure and must then be discarded.
    pub deriver_b_shares: [u32; COEFFICIENTS],
}

/// Host-only eta=4 sampling and additive output-sharing circuit.
///
/// The circuit reads low nibbles before high nibbles. It accepts values below
/// nine and retains the first 256 accepted values in their original order.
/// Its topology does not depend on the prefix or mask values.
///
/// A must supply 256 independent uniform residues below q. A retains these
/// residues as its additive share. The circuit only converts shares; it does
/// not generate the masks or enforce their distribution. Honest input formation
/// is required by this passive benchmark's security profile.
///
/// The fixed 481-byte bound permits failure as described in FIPS 204 Appendix C.
/// A protocol must destroy intermediate samples and both output shares on failure.
/// It must retain the canonical seed; it must never discard or replace that seed
/// automatically. This public-fixture component implements no retry protocol.
pub struct MlDsaEta4SamplingCircuitV1 {
    circuit: CanonicalBooleanCircuitV1,
    schedule: CanonicalLivenessScheduleV1,
}

impl MlDsaEta4SamplingCircuitV1 {
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

    /// Evaluates fixed public fixtures through the Boolean schedule in cleartext.
    ///
    /// The 481 prefix bytes precede 256 mask residues. Each byte and each 23-bit
    /// residue use least-significant-bit-first order. This method provides no
    /// privacy or native constant-time guarantee and must never receive secrets.
    pub fn evaluate_public_fixture(
        &self,
        prefix: &[u8; PREFIX_BYTES],
        a_masks: &[u32; COEFFICIENTS],
    ) -> Result<MlDsaEta4SamplingFixtureOutputV1, MlDsaEta4SamplingFixtureErrorV1> {
        let mut inputs = Vec::with_capacity(PREFIX_BYTES * 8 + COEFFICIENTS * RESIDUE_BITS);
        for byte in prefix {
            for bit in 0..8 {
                inputs.push((byte >> bit) & 1 == 1);
            }
        }
        for (mask_index, mask_value) in a_masks.iter().copied().enumerate() {
            if mask_value >= MODULUS {
                return Err(MlDsaEta4SamplingFixtureErrorV1 {
                    mask_index,
                    mask_value,
                });
            }
            for bit in 0..RESIDUE_BITS {
                inputs.push((mask_value >> bit) & 1 == 1);
            }
        }
        let outputs = self
            .schedule
            .evaluate(&inputs)
            .expect("fixed validated sampling fixture has the compiled input count");
        let mut deriver_b_shares = [0_u32; COEFFICIENTS];
        for (coefficient, residue) in deriver_b_shares.iter_mut().enumerate() {
            for bit in 0..RESIDUE_BITS {
                *residue |= u32::from(outputs[1 + coefficient * RESIDUE_BITS + bit]) << bit;
            }
        }
        Ok(MlDsaEta4SamplingFixtureOutputV1 {
            success: outputs[0],
            deriver_b_shares,
        })
    }
}

/// Compiles the fixed bounded sampler without inspecting fixture input values.
pub fn compile_ml_dsa_eta4_sampling_circuit_v1() -> MlDsaEta4SamplingCircuitV1 {
    let input_count = (PREFIX_BYTES * 8 + COEFFICIENTS * RESIDUE_BITS) as u32;
    let mut builder = CircuitBuilder::new(input_count).expect("fixed sampler has inputs");
    let inputs = builder.input_bits();
    let outputs = sampling_bits(
        &mut builder,
        &inputs[..PREFIX_BYTES * 8],
        &inputs[PREFIX_BYTES * 8..],
    );
    let circuit = builder
        .finish_ml_dsa_eta4_sampling_component(outputs)
        .expect("fixed sampler topology is canonical");
    let schedule = CanonicalLivenessScheduleV1::derive(&circuit);
    MlDsaEta4SamplingCircuitV1 { circuit, schedule }
}

pub(super) fn sampling_bits(
    builder: &mut CircuitBuilder,
    candidate_bits: &[BuilderBit],
    mask_bits: &[BuilderBit],
) -> Vec<BuilderBit> {
    assert_eq!(candidate_bits.len(), PREFIX_BYTES * 8);
    assert_eq!(mask_bits.len(), COEFFICIENTS * RESIDUE_BITS);
    let mut nibbles = Vec::with_capacity(PREFIX_BYTES * 2);
    for bits in candidate_bits.chunks_exact(4) {
        nibbles.push(bits.try_into().expect("each nibble has four wires"));
    }
    let compacted = compact_nibbles(builder, &nibbles);
    let success = compacted.accepted_count[8];
    let mut outputs = Vec::with_capacity(1 + COEFFICIENTS * RESIDUE_BITS);
    outputs.push(success);
    for (coefficient, nibble) in compacted.values.into_iter().enumerate() {
        let offset = coefficient * RESIDUE_BITS;
        let a_mask = &mask_bits[offset..offset + RESIDUE_BITS];
        let residue = coefficient_residue(builder, nibble);
        let (difference, borrow) = subtract_bits(builder, &residue, a_mask);
        let share_b = add_conditional_modulus(builder, &difference, borrow);
        for bit in share_b {
            outputs.push(builder.and(success, bit));
        }
    }
    outputs
}

fn compact_nibbles(builder: &mut CircuitBuilder, nibbles: &[Nibble]) -> CompactedNibbles {
    if nibbles.len() == 1 {
        let nibble = nibbles[0];
        let low_pair_nonzero = or_bits(builder, nibble[0], nibble[1]);
        let low_nonzero = or_bits(builder, low_pair_nonzero, nibble[2]);
        let rejected = builder.and(nibble[3], low_nonzero);
        let accepted = builder.inv(rejected);
        let mut value = [ZERO; 4];
        for bit in 0..4 {
            value[bit] = builder.and(nibble[bit], accepted);
        }
        return CompactedNibbles {
            values: vec![value],
            accepted_count: vec![accepted],
        };
    }
    let middle = nibbles.len() / 2;
    let left = compact_nibbles(builder, &nibbles[..middle]);
    let right = compact_nibbles(builder, &nibbles[middle..]);
    merge_compacted_nibbles(builder, left, right)
}

fn merge_compacted_nibbles(
    builder: &mut CircuitBuilder,
    left: CompactedNibbles,
    right: CompactedNibbles,
) -> CompactedNibbles {
    let combined_capacity = left.values.len() + right.values.len();
    let output_capacity = combined_capacity.min(COEFFICIENTS);
    let mut shifted_right = right.values;
    shifted_right.resize(output_capacity, [ZERO; 4]);
    for (bit, condition) in left.accepted_count.iter().copied().enumerate() {
        let distance = 1_usize << bit;
        let mut shifted = vec![[ZERO; 4]; output_capacity];
        for position in 0..output_capacity {
            for value_bit in 0..4 {
                let shifted_bit = if position >= distance {
                    shifted_right[position - distance][value_bit]
                } else {
                    ZERO
                };
                shifted[position][value_bit] = select_bit(
                    builder,
                    condition,
                    shifted_bit,
                    shifted_right[position][value_bit],
                );
            }
        }
        shifted_right = shifted;
    }
    // Both compact lists have zero tails. Their nonzero supports cannot overlap
    // after the shift, so XOR combines them without another selection network.
    for (position, value) in left.values.into_iter().take(output_capacity).enumerate() {
        for bit in 0..4 {
            shifted_right[position][bit] = builder.xor(value[bit], shifted_right[position][bit]);
        }
    }
    let count_width = bit_width(combined_capacity);
    let sum = add_bits(
        builder,
        &left.accepted_count,
        &right.accepted_count,
        count_width,
    );
    let accepted_count = if combined_capacity > COEFFICIENTS {
        let mut saturated = sum[8];
        for bit in sum.iter().copied().skip(9) {
            saturated = or_bits(builder, saturated, bit);
        }
        let below_bound = builder.inv(saturated);
        let mut count = Vec::with_capacity(9);
        for bit in sum.iter().copied().take(8) {
            count.push(builder.and(bit, below_bound));
        }
        count.push(saturated);
        count
    } else {
        sum
    };
    CompactedNibbles {
        values: shifted_right,
        accepted_count,
    }
}

fn coefficient_residue(builder: &mut CircuitBuilder, nibble: Nibble) -> Vec<BuilderBit> {
    let four = [ZERO, ZERO, BuilderBit::Constant(true), ZERO];
    let (mut signed_coefficient, negative) = subtract_bits(builder, &four, &nibble);
    signed_coefficient.resize(RESIDUE_BITS, negative);
    add_conditional_modulus(builder, &signed_coefficient, negative)
}

fn bit_width(value: usize) -> usize {
    (usize::BITS - value.leading_zeros()) as usize
}
