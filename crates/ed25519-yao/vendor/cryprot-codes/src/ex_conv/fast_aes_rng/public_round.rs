//! One AES encryption round for the public matrix generator only.
//!
//! Table addresses depend on this generator's public state. This module must
//! never encrypt private PPRF, OT, triple-hash, or shared-RNG inputs.
use cryprot_core::Block;

const TABLE: [u32; 256] = round_table();

pub(super) fn apply(blocks: &mut [Block; 8], keys: &[Block; 8]) {
    for (block, key) in blocks.iter_mut().zip(keys) {
        let input = *block.as_bytes();
        let key = key.as_bytes();
        let mut output = [0u8; 16];
        for column in 0..4 {
            let start = column * 4;
            let word = TABLE[usize::from(input[start])]
                ^ TABLE[usize::from(input[((column + 1) % 4) * 4 + 1])].rotate_left(8)
                ^ TABLE[usize::from(input[((column + 2) % 4) * 4 + 2])].rotate_left(16)
                ^ TABLE[usize::from(input[((column + 3) % 4) * 4 + 3])].rotate_left(24)
                ^ u32::from_le_bytes(key[start..start + 4].try_into().expect("AES column"));
            output[start..start + 4].copy_from_slice(&word.to_le_bytes());
        }
        *block = Block::new(output);
    }
}

// Build the AES substitution and MixColumns table at compile time. The row
// rotations in apply implement ShiftRows and the other three column terms.
const fn round_table() -> [u32; 256] {
    let mut table = [0; 256];
    let mut value = 0;
    while value < table.len() {
        let mut inverse = 1u8;
        let mut power = value as u8;
        let mut exponent = 254;
        while exponent != 0 {
            if exponent & 1 != 0 {
                inverse = multiply(inverse, power);
            }
            power = multiply(power, power);
            exponent >>= 1;
        }
        let substituted = inverse
            ^ inverse.rotate_left(1)
            ^ inverse.rotate_left(2)
            ^ inverse.rotate_left(3)
            ^ inverse.rotate_left(4)
            ^ 0x63;
        let twice = multiply(substituted, 2);
        table[value] = u32::from_le_bytes([twice, substituted, substituted, twice ^ substituted]);
        value += 1;
    }
    table
}

const fn multiply(mut left: u8, mut right: u8) -> u8 {
    let mut product = 0;
    let mut bit = 0;
    while bit < 8 {
        if right & 1 != 0 {
            product ^= left;
        }
        left = (left << 1) ^ if left & 0x80 != 0 { 0x1b } else { 0 };
        right >>= 1;
        bit += 1;
    }
    product
}
