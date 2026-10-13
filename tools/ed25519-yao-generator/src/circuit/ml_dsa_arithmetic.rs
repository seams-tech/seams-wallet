use super::ir::{BuilderBit, CircuitBuilder};

pub(super) const ZERO: BuilderBit = BuilderBit::Constant(false);
pub(super) const RESIDUE_BITS: usize = 23;
pub(super) const MODULUS: u32 = 8_380_417;

pub(super) fn add_conditional_modulus(
    builder: &mut CircuitBuilder,
    word: &[BuilderBit],
    condition: BuilderBit,
) -> Vec<BuilderBit> {
    let mut addend = Vec::with_capacity(RESIDUE_BITS);
    for bit in 0..RESIDUE_BITS {
        addend.push(if MODULUS >> bit & 1 == 1 {
            condition
        } else {
            ZERO
        });
    }
    add_bits(builder, word, &addend, RESIDUE_BITS)
}

pub(super) fn add_bits(
    builder: &mut CircuitBuilder,
    left: &[BuilderBit],
    right: &[BuilderBit],
    width: usize,
) -> Vec<BuilderBit> {
    let mut carry = ZERO;
    let mut output = Vec::with_capacity(width);
    for bit in 0..width {
        let left_bit = left.get(bit).copied().unwrap_or(ZERO);
        let right_bit = right.get(bit).copied().unwrap_or(ZERO);
        let parity = builder.xor(left_bit, right_bit);
        output.push(builder.xor(parity, carry));
        if bit + 1 < width {
            let both = builder.and(left_bit, right_bit);
            let carried = builder.and(parity, carry);
            carry = builder.xor(both, carried);
        }
    }
    output
}

pub(super) fn subtract_bits(
    builder: &mut CircuitBuilder,
    left: &[BuilderBit],
    right: &[BuilderBit],
) -> (Vec<BuilderBit>, BuilderBit) {
    assert_eq!(left.len(), right.len());
    let mut borrow = ZERO;
    let mut output = Vec::with_capacity(left.len());
    for (left_bit, right_bit) in left.iter().copied().zip(right.iter().copied()) {
        let parity = builder.xor(left_bit, right_bit);
        output.push(builder.xor(parity, borrow));
        let inverted_left = builder.inv(left_bit);
        let direct_borrow = builder.and(inverted_left, right_bit);
        let equal = builder.inv(parity);
        let carried_borrow = builder.and(equal, borrow);
        borrow = builder.xor(direct_borrow, carried_borrow);
    }
    (output, borrow)
}

pub(super) fn select_bit(
    builder: &mut CircuitBuilder,
    condition: BuilderBit,
    when_true: BuilderBit,
    when_false: BuilderBit,
) -> BuilderBit {
    let difference = builder.xor(when_true, when_false);
    let selected_difference = builder.and(condition, difference);
    builder.xor(when_false, selected_difference)
}

pub(super) fn or_bits(
    builder: &mut CircuitBuilder,
    left: BuilderBit,
    right: BuilderBit,
) -> BuilderBit {
    let parity = builder.xor(left, right);
    let both = builder.and(left, right);
    builder.xor(parity, both)
}
