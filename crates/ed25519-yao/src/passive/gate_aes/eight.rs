//! Eight independent AES blocks in byte-wide bit-plane cells.
//! Shuffle indices depend only on the public AES layout. Private substitutions
//! reuse the parent module's Boolean circuit, without secret table lookups.
use super::{encrypt_state, FourBlockAes128, PlaneWord};
use zeroize::{DefaultIsZeroes, Zeroize};

impl PlaneWord for wide::u8x16 {
    #[inline(always)]
    fn from_four_block_word(value: u64) -> Self {
        let mut bytes = [0u8; 16];
        expand_four_block_word(value, &mut bytes);
        Self::new(bytes)
    }
    #[inline(always)]
    fn rotate_cells(self, cells: u32) -> Self {
        let mut indices = [0u8; 16];
        for (index, byte) in indices.iter_mut().enumerate() {
            *byte = ((index + cells as usize) % 16) as u8;
        }
        self.shuffle(Self::new(indices))
    }
    #[inline(always)]
    fn shift_rows_twice(self) -> Self {
        self.shuffle(Self::new([
            0, 1, 2, 3, 6, 7, 4, 5, 8, 9, 10, 11, 14, 15, 12, 13,
        ]))
    }
}

#[derive(Clone, Copy, Default)]
pub(in crate::passive) struct EightBlocks(pub(in crate::passive) [[u8; 16]; 8]);
impl DefaultIsZeroes for EightBlocks {}
#[derive(Clone, Copy, Default)]
struct KeyBytes([u8; 16]);
impl DefaultIsZeroes for KeyBytes {}
#[derive(Clone, Copy, Default)]
struct WideState([wide::u8x16; 8]);
impl DefaultIsZeroes for WideState {}
#[derive(Clone, Copy)]
struct WideKeys([wide::u8x16; 88]);
impl Default for WideKeys {
    fn default() -> Self {
        Self([wide::u8x16::ZERO; 88])
    }
}
impl DefaultIsZeroes for WideKeys {}
pub(in crate::passive) struct EightBlockAes128 {
    keys: WideKeys,
}
impl EightBlockAes128 {
    pub(in crate::passive) fn from_four(cipher: &FourBlockAes128) -> Self {
        let mut keys = WideKeys::default();
        let mut bytes = zeroize::Zeroizing::new(KeyBytes::default());
        for (target, source) in keys.0.iter_mut().zip(&cipher.round_keys) {
            expand_four_block_word(*source, &mut bytes.0);
            *target = wide::u8x16::new(bytes.0);
        }
        Self { keys }
    }
    pub(in crate::passive) fn encrypt_eight(&self, blocks: &mut EightBlocks) {
        let mut state = zeroize::Zeroizing::new(WideState::default());
        let transpose = wide::u8x16::new([0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15]);
        for (word, block) in state.0.iter_mut().zip(&blocks.0) {
            *word = wide::u8x16::new(*block).shuffle(transpose);
        }
        orthogonalize(&mut state.0);
        encrypt_state(&self.keys.0, &mut state.0);
        orthogonalize(&mut state.0);
        for (block, word) in blocks.0.iter_mut().zip(&state.0) {
            *block = word.shuffle(transpose).to_array();
        }
    }
}
impl Drop for EightBlockAes128 {
    fn drop(&mut self) {
        self.keys.zeroize();
    }
}

#[inline(always)]
fn orthogonalize(state: &mut [wide::u8x16; 8]) {
    for (shift, mask) in [(1, 0x55), (2, 0x33), (4, 0x0f)] {
        for index in 0..8 {
            if index & shift != 0 {
                let lower = index ^ shift;
                let swap = (state[index] ^ (state[lower] >> shift)) & wide::u8x16::splat(mask);
                state[index] ^= swap;
                state[lower] ^= swap << shift;
            }
        }
    }
}

#[inline(always)]
fn expand_four_block_word(value: u64, bytes: &mut [u8; 16]) {
    for (index, byte) in bytes.iter_mut().enumerate() {
        let nibble = ((value >> (index * 4)) & 15) as u8;
        *byte = nibble | (nibble << 4);
    }
}
