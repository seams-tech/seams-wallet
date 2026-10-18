//! Eight independent AES blocks in byte-wide bit-plane cells.
//! Shuffle indices depend only on the public AES layout. Private substitutions
//! reuse the parent module's Boolean circuit, without secret table lookups.
use super::{encrypt_state, FourBlockAes128, PlaneWord};
use zeroize::{DefaultIsZeroes, Zeroize};

impl PlaneWord for wide::u8x16 {
    #[inline(always)]
    fn rotate_rows_columns<const ROWS: u32, const COLUMNS: u32>(self) -> Self {
        let mut indices = [0u8; 16];
        for (index, byte) in indices.iter_mut().enumerate() {
            let row = (index + 4 * ROWS as usize) & 12;
            let column = (index + COLUMNS as usize) & 3;
            *byte = (row | column) as u8;
        }
        self.shuffle(Self::new(indices))
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
    pub(in crate::passive) fn encrypt_eight(&self, blocks: &mut [[u8; 16]; 8]) {
        let mut state = zeroize::Zeroizing::new(WideState::default());
        let transpose = wide::u8x16::new([0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15]);
        for (word, block) in state.0.iter_mut().zip(&*blocks) {
            *word = wide::u8x16::new(*block).shuffle(transpose);
        }
        orthogonalize(&mut state.0);
        encrypt_state(&self.keys.0, &mut state.0);
        orthogonalize(&mut state.0);
        for (block, word) in blocks.iter_mut().zip(&state.0) {
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
    // Transpose eight bit planes independently at each AES byte position.
    swap_planes::<0, 1, 1, 0x55>(state);
    swap_planes::<2, 3, 1, 0x55>(state);
    swap_planes::<4, 5, 1, 0x55>(state);
    swap_planes::<6, 7, 1, 0x55>(state);
    swap_planes::<0, 2, 2, 0x33>(state);
    swap_planes::<1, 3, 2, 0x33>(state);
    swap_planes::<4, 6, 2, 0x33>(state);
    swap_planes::<5, 7, 2, 0x33>(state);
    swap_planes::<0, 4, 4, 0x0f>(state);
    swap_planes::<1, 5, 4, 0x0f>(state);
    swap_planes::<2, 6, 4, 0x0f>(state);
    swap_planes::<3, 7, 4, 0x0f>(state);
}

#[inline(always)]
fn swap_planes<const LOWER: usize, const UPPER: usize, const SHIFT: u32, const MASK: u8>(
    state: &mut [wide::u8x16; 8],
) {
    let swap = (state[UPPER] ^ (state[LOWER] >> SHIFT)) & wide::u8x16::splat(MASK);
    state[UPPER] ^= swap;
    state[LOWER] ^= swap << SHIFT;
}

#[inline(always)]
fn expand_four_block_word(value: u64, bytes: &mut [u8; 16]) {
    for (index, byte) in bytes.iter_mut().enumerate() {
        let nibble = ((value >> (index * 4)) & 15) as u8;
        *byte = nibble | (nibble << 4);
    }
}
