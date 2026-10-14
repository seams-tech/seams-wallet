//! Canonical SHAKE prefixes with public decisions and private candidate shares.

use super::ir::CircuitBuilder;
use super::keccak::shake256;
use super::ml_dsa_arithmetic::{add_conditional_modulus, or_bits, subtract_bits};
use super::ml_dsa_keygen::{MlDsaPrivateKeygenCircuitV1, finish_private_circuit};
use super::ml_dsa_sampling::coefficient_residue;

/// Fixed adaptive prefixes. Only the final prefix permits exhaustion.
#[derive(Clone, Copy)]
pub enum MlDsaSamplingPrefixV1 {
    /// First two SHAKE256 output blocks.
    TwoBlocks,
    /// Same stream through its third block.
    ThreeBlocks,
    /// Same stream through the FIPS 481-byte bound.
    FinalBound,
}
impl MlDsaSamplingPrefixV1 {
    /// Prefix bytes consumed in canonical order.
    pub const fn bytes(self) -> usize {
        match self {
            Self::TwoBlocks => 272,
            Self::ThreeBlocks => 408,
            Self::FinalBound => 481,
        }
    }
    const fn id(self) -> u8 {
        match self {
            Self::TwoBlocks => 0x93,
            Self::ThreeBlocks => 0x94,
            Self::FinalBound => 0x95,
        }
    }
}

/// Opens only candidate acceptance bits. A keeps fresh uniform field masks;
/// B receives one additive share per candidate. Public positions select shares
/// outside the circuit. The bitmap has explicit zero padding before B's bits.
/// Larger branches recompute the identical prefix with new masks and sessions.
pub fn compile_ml_dsa_public_sampling_circuit_v1(
    prefix: MlDsaSamplingPrefixV1,
) -> MlDsaPrivateKeygenCircuitV1 {
    let count = prefix.bytes() * 2;
    let a_bits = 512 + count * 23 + 16;
    let mut builder = CircuitBuilder::new((a_bits + 512) as u32).expect("fixed sampler inputs");
    let inputs = builder.input_bits();
    let mut message = Vec::with_capacity(528);
    for bit in 0..512 {
        message.push(builder.xor(inputs[bit], inputs[a_bits + bit]));
    }
    message.extend_from_slice(&inputs[a_bits - 16..a_bits]);
    let stream = shake256(&mut builder, &message, prefix.bytes());
    let mut outputs = Vec::with_capacity(count.div_ceil(8) * 8 + count * 23);
    for nibble in stream.chunks_exact(4) {
        let pair = or_bits(&mut builder, nibble[0], nibble[1]);
        let low = or_bits(&mut builder, pair, nibble[2]);
        let rejected = builder.and(nibble[3], low);
        outputs.push(builder.inv(rejected));
    }
    for input in inputs.iter().take(count.div_ceil(8) * 8 - count) {
        // Each output needs a distinct wire, including public zero padding.
        let inverse = builder.inv(*input);
        outputs.push(builder.and(*input, inverse));
    }
    for (index, nibble) in stream.chunks_exact(4).enumerate() {
        let value = coefficient_residue(&mut builder, nibble.try_into().expect("four bits"));
        let start = 512 + index * 23;
        let (difference, borrow) = subtract_bits(&mut builder, &value, &inputs[start..start + 23]);
        outputs.extend(add_conditional_modulus(&mut builder, &difference, borrow));
    }
    finish_private_circuit(
        builder,
        outputs,
        prefix.id(),
        b"seams/ml-dsa-65/public-sampler/input/v1:A:rho-prime-xor[64],independent-mask[candidates]:residue23,nonce:le16;B:rho-prime-xor[64]:lsb0",
        b"seams/ml-dsa-65/public-sampler/output/v1:public:accept[candidates]:lsb0,zero-padding-to-byte;B:coefficient-minus-mask[candidates]:residue23-lsb0",
    )
}
