//! AES-128 encryption of four blocks in one pass, for the garbler's gate hash.
//!
//! The garbler hashes four labels per AND gate. The `aes` crate's portable
//! backend picks its 32-bit fixslice on `wasm32`, two blocks per pass, because
//! the target's pointers are 32 bits wide. WebAssembly has native 64-bit
//! integers, so the 64-bit fixslice does the four blocks in one pass.
//!
//! The functions between the two markers below are the 64-bit fixslice of
//! `aes` 0.8.4 (`src/soft/fixslice64.rs`, RustCrypto, MIT OR Apache-2.0),
//! reduced to AES-128 encryption: the decryption path, the other key sizes and
//! the compact variant are removed, the block types are plain arrays, and one
//! volatile write wipes the bitsliced state before `aes128_encrypt` returns.
//! The original C
//! code is by Alexandre Adomnicai, Nanyang Technological University
//! (<https://eprint.iacr.org/2020/1123.pdf>), originally MIT, relicensed as
//! Apache-2.0 and MIT with permission. The code is fully bitsliced: it uses no
//! lookup table and no branch that depends on a block.
//!
//! Every output is checked against the `aes` crate in this module's tests.

#![allow(clippy::unreadable_literal)]

use zeroize::{DefaultIsZeroes, Zeroize};

const BLOCK_BYTES: usize = 16;

type BatchBlocks = [[u8; BLOCK_BYTES]; 4];
type RoundKeys = [u64; 88];
type State = [u64; 8];

/// Four secret blocks that one volatile write wipes.
#[derive(Clone, Copy, Default)]
pub(super) struct FourBlocks(pub(super) BatchBlocks);

impl DefaultIsZeroes for FourBlocks {}

/// The bitsliced state of four blocks. One volatile write wipes it.
#[derive(Clone, Copy, Default)]
struct StateCells(State);

impl DefaultIsZeroes for StateCells {}

/// AES-128 under one key, four blocks per call.
pub(super) struct FourBlockAes128 {
    round_keys: RoundKeys,
}

impl FourBlockAes128 {
    pub(super) fn new(key: &[u8; BLOCK_BYTES]) -> Self {
        Self {
            round_keys: aes128_key_schedule(key),
        }
    }

    /// Encrypts the four blocks in place.
    pub(super) fn encrypt_four(&self, blocks: &mut FourBlocks) {
        blocks.0 = aes128_encrypt(&self.round_keys, &blocks.0);
    }
}

impl Drop for FourBlockAes128 {
    fn drop(&mut self) {
        self.round_keys.zeroize();
    }
}

// ---- begin: reduced copy of aes 0.8.4, src/soft/fixslice64.rs ----

/// Fully bitsliced AES-128 key schedule to match the fully-fixsliced representation.
fn aes128_key_schedule(key: &[u8; 16]) -> RoundKeys {
    let mut rkeys = [0u64; 88];

    bitslice(&mut rkeys[..8], key, key, key, key);

    let mut rk_off = 0;
    for rcon in 0..10 {
        memshift32(&mut rkeys, rk_off);
        rk_off += 8;

        sub_bytes(&mut rkeys[rk_off..(rk_off + 8)]);
        sub_bytes_nots(&mut rkeys[rk_off..(rk_off + 8)]);

        if rcon < 8 {
            add_round_constant_bit(&mut rkeys[rk_off..(rk_off + 8)], rcon);
        } else {
            add_round_constant_bit(&mut rkeys[rk_off..(rk_off + 8)], rcon - 8);
            add_round_constant_bit(&mut rkeys[rk_off..(rk_off + 8)], rcon - 7);
            add_round_constant_bit(&mut rkeys[rk_off..(rk_off + 8)], rcon - 5);
            add_round_constant_bit(&mut rkeys[rk_off..(rk_off + 8)], rcon - 4);
        }

        xor_columns(&mut rkeys, rk_off, 8, ror_distance(1, 3));
    }

    // Adjust to match fixslicing format
    for i in (8..72).step_by(32) {
        inv_shift_rows_1(&mut rkeys[i..(i + 8)]);
        inv_shift_rows_2(&mut rkeys[(i + 8)..(i + 16)]);
        inv_shift_rows_3(&mut rkeys[(i + 16)..(i + 24)]);
    }
    inv_shift_rows_1(&mut rkeys[72..80]);

    // Account for NOTs removed from sub_bytes
    for i in 1..11 {
        sub_bytes_nots(&mut rkeys[(i * 8)..(i * 8 + 8)]);
    }

    rkeys
}

/// Fully-fixsliced AES-128 encryption (the ShiftRows is completely omitted).
///
/// Encrypts four blocks in-place and in parallel.
fn aes128_encrypt(rkeys: &RoundKeys, blocks: &BatchBlocks) -> BatchBlocks {
    let mut state = StateCells::default();

    bitslice(&mut state.0, &blocks[0], &blocks[1], &blocks[2], &blocks[3]);

    add_round_key(&mut state.0, &rkeys[..8]);

    let mut rk_off = 8;
    loop {
        sub_bytes(&mut state.0);
        mix_columns_1(&mut state.0);
        add_round_key(&mut state.0, &rkeys[rk_off..(rk_off + 8)]);
        rk_off += 8;

        if rk_off == 80 {
            break;
        }

        sub_bytes(&mut state.0);
        mix_columns_2(&mut state.0);
        add_round_key(&mut state.0, &rkeys[rk_off..(rk_off + 8)]);
        rk_off += 8;

        sub_bytes(&mut state.0);
        mix_columns_3(&mut state.0);
        add_round_key(&mut state.0, &rkeys[rk_off..(rk_off + 8)]);
        rk_off += 8;

        sub_bytes(&mut state.0);
        mix_columns_0(&mut state.0);
        add_round_key(&mut state.0, &rkeys[rk_off..(rk_off + 8)]);
        rk_off += 8;
    }

    shift_rows_2(&mut state.0);

    sub_bytes(&mut state.0);
    add_round_key(&mut state.0, &rkeys[80..]);

    let output = inv_bitslice(&state.0);
    // Not in the original: the bitsliced state holds the block values.
    state.zeroize();
    output
}

/// Bitsliced implementation of the AES Sbox based on Boyar, Peralta and Calik.
///
/// See: <http://www.cs.yale.edu/homes/peralta/CircuitStuff/SLP_AES_113.txt>
///
/// Note that the 4 bitwise NOT (^= 0xffffffffffffffff) are moved to the key schedule.
fn sub_bytes(state: &mut [u64]) {
    debug_assert_eq!(state.len(), 8);

    // Scheduled using https://github.com/Ko-/aes-armcortexm/tree/public/scheduler
    // Inline "stack" comments reflect suggested stores and loads (ARM Cortex-M3 and M4)

    let u7 = state[0];
    let u6 = state[1];
    let u5 = state[2];
    let u4 = state[3];
    let u3 = state[4];
    let u2 = state[5];
    let u1 = state[6];
    let u0 = state[7];

    let y14 = u3 ^ u5;
    let y13 = u0 ^ u6;
    let y12 = y13 ^ y14;
    let t1 = u4 ^ y12;
    let y15 = t1 ^ u5;
    let t2 = y12 & y15;
    let y6 = y15 ^ u7;
    let y20 = t1 ^ u1;
    // y12 -> stack
    let y9 = u0 ^ u3;
    // y20 -> stack
    let y11 = y20 ^ y9;
    // y9 -> stack
    let t12 = y9 & y11;
    // y6 -> stack
    let y7 = u7 ^ y11;
    let y8 = u0 ^ u5;
    let t0 = u1 ^ u2;
    let y10 = y15 ^ t0;
    // y15 -> stack
    let y17 = y10 ^ y11;
    // y14 -> stack
    let t13 = y14 & y17;
    let t14 = t13 ^ t12;
    // y17 -> stack
    let y19 = y10 ^ y8;
    // y10 -> stack
    let t15 = y8 & y10;
    let t16 = t15 ^ t12;
    let y16 = t0 ^ y11;
    // y11 -> stack
    let y21 = y13 ^ y16;
    // y13 -> stack
    let t7 = y13 & y16;
    // y16 -> stack
    let y18 = u0 ^ y16;
    let y1 = t0 ^ u7;
    let y4 = y1 ^ u3;
    // u7 -> stack
    let t5 = y4 & u7;
    let t6 = t5 ^ t2;
    let t18 = t6 ^ t16;
    let t22 = t18 ^ y19;
    let y2 = y1 ^ u0;
    let t10 = y2 & y7;
    let t11 = t10 ^ t7;
    let t20 = t11 ^ t16;
    let t24 = t20 ^ y18;
    let y5 = y1 ^ u6;
    let t8 = y5 & y1;
    let t9 = t8 ^ t7;
    let t19 = t9 ^ t14;
    let t23 = t19 ^ y21;
    let y3 = y5 ^ y8;
    // y6 <- stack
    let t3 = y3 & y6;
    let t4 = t3 ^ t2;
    // y20 <- stack
    let t17 = t4 ^ y20;
    let t21 = t17 ^ t14;
    let t26 = t21 & t23;
    let t27 = t24 ^ t26;
    let t31 = t22 ^ t26;
    let t25 = t21 ^ t22;
    // y4 -> stack
    let t28 = t25 & t27;
    let t29 = t28 ^ t22;
    let z14 = t29 & y2;
    let z5 = t29 & y7;
    let t30 = t23 ^ t24;
    let t32 = t31 & t30;
    let t33 = t32 ^ t24;
    let t35 = t27 ^ t33;
    let t36 = t24 & t35;
    let t38 = t27 ^ t36;
    let t39 = t29 & t38;
    let t40 = t25 ^ t39;
    let t43 = t29 ^ t40;
    // y16 <- stack
    let z3 = t43 & y16;
    let tc12 = z3 ^ z5;
    // tc12 -> stack
    // y13 <- stack
    let z12 = t43 & y13;
    let z13 = t40 & y5;
    let z4 = t40 & y1;
    let tc6 = z3 ^ z4;
    let t34 = t23 ^ t33;
    let t37 = t36 ^ t34;
    let t41 = t40 ^ t37;
    // y10 <- stack
    let z8 = t41 & y10;
    let z17 = t41 & y8;
    let t44 = t33 ^ t37;
    // y15 <- stack
    let z0 = t44 & y15;
    // z17 -> stack
    // y12 <- stack
    let z9 = t44 & y12;
    let z10 = t37 & y3;
    let z1 = t37 & y6;
    let tc5 = z1 ^ z0;
    let tc11 = tc6 ^ tc5;
    // y4 <- stack
    let z11 = t33 & y4;
    let t42 = t29 ^ t33;
    let t45 = t42 ^ t41;
    // y17 <- stack
    let z7 = t45 & y17;
    let tc8 = z7 ^ tc6;
    // y14 <- stack
    let z16 = t45 & y14;
    // y11 <- stack
    let z6 = t42 & y11;
    let tc16 = z6 ^ tc8;
    // z14 -> stack
    // y9 <- stack
    let z15 = t42 & y9;
    let tc20 = z15 ^ tc16;
    let tc1 = z15 ^ z16;
    let tc2 = z10 ^ tc1;
    let tc21 = tc2 ^ z11;
    let tc3 = z9 ^ tc2;
    let s0 = tc3 ^ tc16;
    let s3 = tc3 ^ tc11;
    let s1 = s3 ^ tc16;
    let tc13 = z13 ^ tc1;
    // u7 <- stack
    let z2 = t33 & u7;
    let tc4 = z0 ^ z2;
    let tc7 = z12 ^ tc4;
    let tc9 = z8 ^ tc7;
    let tc10 = tc8 ^ tc9;
    // z14 <- stack
    let tc17 = z14 ^ tc10;
    let s5 = tc21 ^ tc17;
    let tc26 = tc17 ^ tc20;
    // z17 <- stack
    let s2 = tc26 ^ z17;
    // tc12 <- stack
    let tc14 = tc4 ^ tc12;
    let tc18 = tc13 ^ tc14;
    let s6 = tc10 ^ tc18;
    let s7 = z12 ^ tc18;
    let s4 = tc14 ^ s3;

    state[0] = s7;
    state[1] = s6;
    state[2] = s5;
    state[3] = s4;
    state[4] = s3;
    state[5] = s2;
    state[6] = s1;
    state[7] = s0;
}

/// NOT operations that are omitted in S-box
#[inline]
fn sub_bytes_nots(state: &mut [u64]) {
    debug_assert_eq!(state.len(), 8);
    state[0] ^= 0xffffffffffffffff;
    state[1] ^= 0xffffffffffffffff;
    state[5] ^= 0xffffffffffffffff;
    state[6] ^= 0xffffffffffffffff;
}

/// Computation of the MixColumns transformation in the fixsliced representation, with different
/// rotations used according to the round number mod 4.
///
/// Based on Käsper-Schwabe, similar to https://github.com/Ko-/aes-armcortexm.
macro_rules! define_mix_columns {
    (
        $name:ident,
        $first_rotate:path,
        $second_rotate:path
    ) => {
        #[rustfmt::skip]
        fn $name(state: &mut State) {
            let (a0, a1, a2, a3, a4, a5, a6, a7) = (
                state[0], state[1], state[2], state[3], state[4], state[5], state[6], state[7]
            );
            let (b0, b1, b2, b3, b4, b5, b6, b7) = (
                $first_rotate(a0),
                $first_rotate(a1),
                $first_rotate(a2),
                $first_rotate(a3),
                $first_rotate(a4),
                $first_rotate(a5),
                $first_rotate(a6),
                $first_rotate(a7),
            );
            let (c0, c1, c2, c3, c4, c5, c6, c7) = (
                a0 ^ b0,
                a1 ^ b1,
                a2 ^ b2,
                a3 ^ b3,
                a4 ^ b4,
                a5 ^ b5,
                a6 ^ b6,
                a7 ^ b7,
            );
            state[0] = b0      ^ c7 ^ $second_rotate(c0);
            state[1] = b1 ^ c0 ^ c7 ^ $second_rotate(c1);
            state[2] = b2 ^ c1      ^ $second_rotate(c2);
            state[3] = b3 ^ c2 ^ c7 ^ $second_rotate(c3);
            state[4] = b4 ^ c3 ^ c7 ^ $second_rotate(c4);
            state[5] = b5 ^ c4      ^ $second_rotate(c5);
            state[6] = b6 ^ c5      ^ $second_rotate(c6);
            state[7] = b7 ^ c6      ^ $second_rotate(c7);
        }
    }
}

define_mix_columns!(mix_columns_0, rotate_rows_1, rotate_rows_2);
define_mix_columns!(
    mix_columns_1,
    rotate_rows_and_columns_1_1,
    rotate_rows_and_columns_2_2
);
define_mix_columns!(mix_columns_2, rotate_rows_and_columns_1_2, rotate_rows_2);
define_mix_columns!(
    mix_columns_3,
    rotate_rows_and_columns_1_3,
    rotate_rows_and_columns_2_2
);

#[inline]
fn delta_swap_1(a: &mut u64, shift: u32, mask: u64) {
    let t = (*a ^ ((*a) >> shift)) & mask;
    *a ^= t ^ (t << shift);
}

#[inline]
fn delta_swap_2(a: &mut u64, b: &mut u64, shift: u32, mask: u64) {
    let t = (*a ^ ((*b) >> shift)) & mask;
    *a ^= t;
    *b ^= t << shift;
}

/// Applies ShiftRows once on an AES state (or key).
#[inline]
fn shift_rows_1(state: &mut [u64]) {
    debug_assert_eq!(state.len(), 8);
    for x in state.iter_mut() {
        delta_swap_1(x, 8, 0x00f000ff000f0000);
        delta_swap_1(x, 4, 0x0f0f00000f0f0000);
    }
}

/// Applies ShiftRows twice on an AES state (or key).
#[inline]
fn shift_rows_2(state: &mut [u64]) {
    debug_assert_eq!(state.len(), 8);
    for x in state.iter_mut() {
        delta_swap_1(x, 8, 0x00ff000000ff0000);
    }
}

/// Applies ShiftRows three times on an AES state (or key).
#[inline]
fn shift_rows_3(state: &mut [u64]) {
    debug_assert_eq!(state.len(), 8);
    for x in state.iter_mut() {
        delta_swap_1(x, 8, 0x000f00ff00f00000);
        delta_swap_1(x, 4, 0x0f0f00000f0f0000);
    }
}

#[inline(always)]
fn inv_shift_rows_1(state: &mut [u64]) {
    shift_rows_3(state);
}

#[inline(always)]
fn inv_shift_rows_2(state: &mut [u64]) {
    shift_rows_2(state);
}

#[inline(always)]
fn inv_shift_rows_3(state: &mut [u64]) {
    shift_rows_1(state);
}

/// XOR the columns after the S-box during the key schedule round function.
///
/// The `idx_xor` parameter refers to the index of the previous round key that is
/// involved in the XOR computation (should be 8 and 16 for AES-128 and AES-256,
/// respectively).
///
/// The `idx_ror` parameter refers to the rotation value, which varies between the
/// different key schedules.
fn xor_columns(rkeys: &mut [u64], offset: usize, idx_xor: usize, idx_ror: u32) {
    for i in 0..8 {
        let off_i = offset + i;
        let rk = rkeys[off_i - idx_xor] ^ (0x000f000f000f000f & ror(rkeys[off_i], idx_ror));
        rkeys[off_i] = rk
            ^ (0xfff0fff0fff0fff0 & (rk << 4))
            ^ (0xff00ff00ff00ff00 & (rk << 8))
            ^ (0xf000f000f000f000 & (rk << 12));
    }
}

/// Bitslice four 128-bit input blocks input0, input1, input2, input3 into a 512-bit internal state.
fn bitslice(output: &mut [u64], input0: &[u8], input1: &[u8], input2: &[u8], input3: &[u8]) {
    debug_assert_eq!(output.len(), 8);
    debug_assert_eq!(input0.len(), 16);
    debug_assert_eq!(input1.len(), 16);
    debug_assert_eq!(input2.len(), 16);
    debug_assert_eq!(input3.len(), 16);

    // Bitslicing is a bit index manipulation. 512 bits of data means each bit is positioned at a
    // 9-bit index. AES data is 4 blocks, each one a 4x4 column-major matrix of bytes, so the
    // index is initially ([b]lock, [c]olumn, [r]ow, [p]osition):
    //     b1 b0 c1 c0 r1 r0 p2 p1 p0
    //
    // The desired bitsliced data groups first by bit position, then row, column, block:
    //     p2 p1 p0 r1 r0 c1 c0 b1 b0

    #[rustfmt::skip]
    fn read_reordered(input: &[u8]) -> u64 {
        (u64::from(input[0x0])        ) |
        (u64::from(input[0x1]) << 0x10) |
        (u64::from(input[0x2]) << 0x20) |
        (u64::from(input[0x3]) << 0x30) |
        (u64::from(input[0x8]) << 0x08) |
        (u64::from(input[0x9]) << 0x18) |
        (u64::from(input[0xa]) << 0x28) |
        (u64::from(input[0xb]) << 0x38)
    }

    // Reorder each block's bytes on input
    //     __ __ c1 c0 r1 r0 __ __ __ => __ __ c0 r1 r0 c1 __ __ __
    // Reorder by relabeling (note the order of input)
    //     b1 b0 c0 __ __ __ __ __ __ => c0 b1 b0 __ __ __ __ __ __
    let mut t0 = read_reordered(&input0[0x00..0x0c]);
    let mut t4 = read_reordered(&input0[0x04..0x10]);
    let mut t1 = read_reordered(&input1[0x00..0x0c]);
    let mut t5 = read_reordered(&input1[0x04..0x10]);
    let mut t2 = read_reordered(&input2[0x00..0x0c]);
    let mut t6 = read_reordered(&input2[0x04..0x10]);
    let mut t3 = read_reordered(&input3[0x00..0x0c]);
    let mut t7 = read_reordered(&input3[0x04..0x10]);

    // Bit Index Swap 6 <-> 0:
    //     __ __ b0 __ __ __ __ __ p0 => __ __ p0 __ __ __ __ __ b0
    let m0 = 0x5555555555555555;
    delta_swap_2(&mut t1, &mut t0, 1, m0);
    delta_swap_2(&mut t3, &mut t2, 1, m0);
    delta_swap_2(&mut t5, &mut t4, 1, m0);
    delta_swap_2(&mut t7, &mut t6, 1, m0);

    // Bit Index Swap 7 <-> 1:
    //     __ b1 __ __ __ __ __ p1 __ => __ p1 __ __ __ __ __ b1 __
    let m1 = 0x3333333333333333;
    delta_swap_2(&mut t2, &mut t0, 2, m1);
    delta_swap_2(&mut t3, &mut t1, 2, m1);
    delta_swap_2(&mut t6, &mut t4, 2, m1);
    delta_swap_2(&mut t7, &mut t5, 2, m1);

    // Bit Index Swap 8 <-> 2:
    //     c0 __ __ __ __ __ p2 __ __ => p2 __ __ __ __ __ c0 __ __
    let m2 = 0x0f0f0f0f0f0f0f0f;
    delta_swap_2(&mut t4, &mut t0, 4, m2);
    delta_swap_2(&mut t5, &mut t1, 4, m2);
    delta_swap_2(&mut t6, &mut t2, 4, m2);
    delta_swap_2(&mut t7, &mut t3, 4, m2);

    // Final bitsliced bit index, as desired:
    //     p2 p1 p0 r1 r0 c1 c0 b1 b0
    output[0] = t0;
    output[1] = t1;
    output[2] = t2;
    output[3] = t3;
    output[4] = t4;
    output[5] = t5;
    output[6] = t6;
    output[7] = t7;
}

/// Un-bitslice a 512-bit internal state into four 128-bit blocks of output.
fn inv_bitslice(input: &[u64]) -> BatchBlocks {
    debug_assert_eq!(input.len(), 8);

    // Unbitslicing is a bit index manipulation. 512 bits of data means each bit is positioned at
    // a 9-bit index. AES data is 4 blocks, each one a 4x4 column-major matrix of bytes, so the
    // desired index for the output is ([b]lock, [c]olumn, [r]ow, [p]osition):
    //     b1 b0 c1 c0 r1 r0 p2 p1 p0
    //
    // The initially bitsliced data groups first by bit position, then row, column, block:
    //     p2 p1 p0 r1 r0 c1 c0 b1 b0

    let mut t0 = input[0];
    let mut t1 = input[1];
    let mut t2 = input[2];
    let mut t3 = input[3];
    let mut t4 = input[4];
    let mut t5 = input[5];
    let mut t6 = input[6];
    let mut t7 = input[7];

    // TODO: these bit index swaps are identical to those in 'packing'

    // Bit Index Swap 6 <-> 0:
    //     __ __ p0 __ __ __ __ __ b0 => __ __ b0 __ __ __ __ __ p0
    let m0 = 0x5555555555555555;
    delta_swap_2(&mut t1, &mut t0, 1, m0);
    delta_swap_2(&mut t3, &mut t2, 1, m0);
    delta_swap_2(&mut t5, &mut t4, 1, m0);
    delta_swap_2(&mut t7, &mut t6, 1, m0);

    // Bit Index Swap 7 <-> 1:
    //     __ p1 __ __ __ __ __ b1 __ => __ b1 __ __ __ __ __ p1 __
    let m1 = 0x3333333333333333;
    delta_swap_2(&mut t2, &mut t0, 2, m1);
    delta_swap_2(&mut t3, &mut t1, 2, m1);
    delta_swap_2(&mut t6, &mut t4, 2, m1);
    delta_swap_2(&mut t7, &mut t5, 2, m1);

    // Bit Index Swap 8 <-> 2:
    //     p2 __ __ __ __ __ c0 __ __ => c0 __ __ __ __ __ p2 __ __
    let m2 = 0x0f0f0f0f0f0f0f0f;
    delta_swap_2(&mut t4, &mut t0, 4, m2);
    delta_swap_2(&mut t5, &mut t1, 4, m2);
    delta_swap_2(&mut t6, &mut t2, 4, m2);
    delta_swap_2(&mut t7, &mut t3, 4, m2);

    #[rustfmt::skip]
    fn write_reordered(columns: u64, output: &mut [u8]) {
        output[0x0] = (columns        ) as u8;
        output[0x1] = (columns >> 0x10) as u8;
        output[0x2] = (columns >> 0x20) as u8;
        output[0x3] = (columns >> 0x30) as u8;
        output[0x8] = (columns >> 0x08) as u8;
        output[0x9] = (columns >> 0x18) as u8;
        output[0xa] = (columns >> 0x28) as u8;
        output[0xb] = (columns >> 0x38) as u8;
    }

    let mut output: BatchBlocks = [[0_u8; BLOCK_BYTES]; 4];
    // Reorder by relabeling (note the order of output)
    //     c0 b1 b0 __ __ __ __ __ __ => b1 b0 c0 __ __ __ __ __ __
    // Reorder each block's bytes on output
    //     __ __ c0 r1 r0 c1 __ __ __ => __ __ c1 c0 r1 r0 __ __ __
    write_reordered(t0, &mut output[0][0x00..0x0c]);
    write_reordered(t4, &mut output[0][0x04..0x10]);
    write_reordered(t1, &mut output[1][0x00..0x0c]);
    write_reordered(t5, &mut output[1][0x04..0x10]);
    write_reordered(t2, &mut output[2][0x00..0x0c]);
    write_reordered(t6, &mut output[2][0x04..0x10]);
    write_reordered(t3, &mut output[3][0x00..0x0c]);
    write_reordered(t7, &mut output[3][0x04..0x10]);

    // Final AES bit index, as desired:
    //     b1 b0 c1 c0 r1 r0 p2 p1 p0
    output
}

/// Copy 32-bytes within the provided slice to an 8-byte offset
fn memshift32(buffer: &mut [u64], src_offset: usize) {
    debug_assert_eq!(src_offset % 8, 0);

    let dst_offset = src_offset + 8;
    debug_assert!(dst_offset + 8 <= buffer.len());

    for i in (0..8).rev() {
        buffer[dst_offset + i] = buffer[src_offset + i];
    }
}

/// XOR the round key to the internal state. The round keys are expected to be
/// pre-computed and to be packed in the fixsliced representation.
#[inline]
fn add_round_key(state: &mut State, rkey: &[u64]) {
    debug_assert_eq!(rkey.len(), 8);
    for (a, b) in state.iter_mut().zip(rkey) {
        *a ^= b;
    }
}

#[inline(always)]
fn add_round_constant_bit(state: &mut [u64], bit: usize) {
    state[bit] ^= 0x00000000f0000000;
}

#[inline(always)]
fn ror(x: u64, y: u32) -> u64 {
    x.rotate_right(y)
}

#[inline(always)]
fn ror_distance(rows: u32, cols: u32) -> u32 {
    (rows << 4) + (cols << 2)
}

#[inline(always)]
fn rotate_rows_1(x: u64) -> u64 {
    ror(x, ror_distance(1, 0))
}

#[inline(always)]
fn rotate_rows_2(x: u64) -> u64 {
    ror(x, ror_distance(2, 0))
}

#[inline(always)]
#[rustfmt::skip]
fn rotate_rows_and_columns_1_1(x: u64) -> u64 {
    (ror(x, ror_distance(1, 1)) & 0x0fff0fff0fff0fff) |
    (ror(x, ror_distance(0, 1)) & 0xf000f000f000f000)
}

#[inline(always)]
#[rustfmt::skip]
fn rotate_rows_and_columns_1_2(x: u64) -> u64 {
    (ror(x, ror_distance(1, 2)) & 0x00ff00ff00ff00ff) |
    (ror(x, ror_distance(0, 2)) & 0xff00ff00ff00ff00)
}

#[inline(always)]
#[rustfmt::skip]
fn rotate_rows_and_columns_1_3(x: u64) -> u64 {
    (ror(x, ror_distance(1, 3)) & 0x000f000f000f000f) |
    (ror(x, ror_distance(0, 3)) & 0xfff0fff0fff0fff0)
}

#[inline(always)]
#[rustfmt::skip]
fn rotate_rows_and_columns_2_2(x: u64) -> u64 {
    (ror(x, ror_distance(2, 2)) & 0x00ff00ff00ff00ff) |
    (ror(x, ror_distance(1, 2)) & 0xff00ff00ff00ff00)
}

// ---- end: reduced copy of aes 0.8.4, src/soft/fixslice64.rs ----

#[cfg(test)]
mod tests {
    use super::*;
    use aes::cipher::{BlockEncrypt, KeyInit};
    use aes::Aes128;

    /// A fixed generator, so a failure names its inputs.
    struct Stream(u64);

    impl Stream {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }

        fn block(&mut self) -> [u8; BLOCK_BYTES] {
            let mut block = [0_u8; BLOCK_BYTES];
            block[..8].copy_from_slice(&self.next().to_be_bytes());
            block[8..].copy_from_slice(&self.next().to_be_bytes());
            block
        }
    }

    fn reference(key: &[u8; BLOCK_BYTES], block: &[u8; BLOCK_BYTES]) -> [u8; BLOCK_BYTES] {
        let mut output = (*block).into();
        Aes128::new(&(*key).into()).encrypt_block(&mut output);
        output.into()
    }

    #[test]
    fn fips_197_appendix_c1_vector_in_every_lane() {
        let key: [u8; BLOCK_BYTES] = core::array::from_fn(|index| index as u8);
        let plaintext: [u8; BLOCK_BYTES] = core::array::from_fn(|index| (index as u8) * 0x11);
        let ciphertext = [
            0x69, 0xc4, 0xe0, 0xd8, 0x6a, 0x7b, 0x04, 0x30, 0xd8, 0xcd, 0xb7, 0x80, 0x70, 0xb4,
            0xc5, 0x5a,
        ];
        let cipher = FourBlockAes128::new(&key);
        for lane in 0..4 {
            let mut blocks = FourBlocks([[0xa5_u8; BLOCK_BYTES]; 4]);
            blocks.0[lane] = plaintext;
            cipher.encrypt_four(&mut blocks);
            assert_eq!(blocks.0[lane], ciphertext, "lane {lane}");
        }
    }

    #[test]
    fn zero_key_matches_the_aes_crate_on_edge_blocks() {
        let key = [0_u8; BLOCK_BYTES];
        let cipher = FourBlockAes128::new(&key);
        let mut single_bit = [0_u8; BLOCK_BYTES];
        for bit in 0..128 {
            single_bit.fill(0);
            single_bit[bit / 8] = 0x80 >> (bit % 8);
            let inverted: [u8; BLOCK_BYTES] = core::array::from_fn(|index| !single_bit[index]);
            let mut blocks = FourBlocks([
                single_bit,
                inverted,
                [0_u8; BLOCK_BYTES],
                [0xff_u8; BLOCK_BYTES],
            ]);
            let expected = blocks.0.map(|block| reference(&key, &block));
            cipher.encrypt_four(&mut blocks);
            assert_eq!(blocks.0, expected, "bit {bit}");
        }
    }

    #[test]
    fn matches_the_aes_crate_on_generated_keys_and_blocks() {
        let mut stream = Stream(0x9e37_79b9_7f4a_7c15);
        for round in 0..2_000 {
            let key = if round % 2 == 0 {
                [0_u8; BLOCK_BYTES]
            } else {
                stream.block()
            };
            let cipher = FourBlockAes128::new(&key);
            let mut blocks = FourBlocks([
                stream.block(),
                stream.block(),
                stream.block(),
                stream.block(),
            ]);
            let expected = blocks.0.map(|block| reference(&key, &block));
            cipher.encrypt_four(&mut blocks);
            assert_eq!(blocks.0, expected, "round {round}");
        }
    }

    #[test]
    fn lanes_do_not_affect_each_other() {
        let key = [0_u8; BLOCK_BYTES];
        let cipher = FourBlockAes128::new(&key);
        let mut stream = Stream(7);
        let target = stream.block();
        let expected = reference(&key, &target);
        for lane in 0..4 {
            for _ in 0..50 {
                let mut blocks = FourBlocks([
                    stream.block(),
                    stream.block(),
                    stream.block(),
                    stream.block(),
                ]);
                blocks.0[lane] = target;
                cipher.encrypt_four(&mut blocks);
                assert_eq!(blocks.0[lane], expected, "lane {lane}");
            }
        }
    }
}
