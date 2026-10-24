//! AES-128 with the private four-block and eight-block Wasm backends.
use two_party_primitives::gate_aes::FourBlocks;
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
use two_party_primitives::gate_aes::{EightBlockAes128, EightBlocks};
use zeroize::{DefaultIsZeroes, Zeroizing};

/// Flat secret bytes erased with one volatile whole-value write and barrier.
#[derive(Clone, Copy)]
pub(super) struct SecretBlockBatch<const N: usize>(pub(super) [[u8; 16]; N]);

impl<const N: usize> Default for SecretBlockBatch<N> {
    fn default() -> Self {
        Self([[0; 16]; N])
    }
}
impl<const N: usize> DefaultIsZeroes for SecretBlockBatch<N> {}

pub(super) struct CorrelationAes {
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    wide: EightBlockAes128,
    #[cfg(target_arch = "wasm32")]
    cipher: two_party_primitives::gate_aes::FourBlockAes128,
    #[cfg(not(target_arch = "wasm32"))]
    cipher: aes09::Aes128,
}

impl CorrelationAes {
    pub(super) fn new(key: &[u8; 16]) -> Self {
        #[cfg(target_arch = "wasm32")]
        let cipher = two_party_primitives::gate_aes::FourBlockAes128::new(key);
        #[cfg(not(target_arch = "wasm32"))]
        let cipher = {
            use aes09::cipher::KeyInit;
            aes09::Aes128::new(key.into())
        };
        Self {
            #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
            wide: EightBlockAes128::from_four(&cipher),
            cipher,
        }
    }

    pub(super) fn encrypt(&self, blocks: &mut [[u8; 16]]) {
        // Length and padding depend only on the public circuit dimensions.
        let width = if cfg!(all(target_arch = "wasm32", target_feature = "simd128")) {
            8
        } else {
            4
        };
        for chunk in blocks.chunks_mut(width) {
            #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
            if chunk.len() == 8 {
                // The caller owns and erases this buffer. Avoid a second secret copy.
                let blocks = chunk.try_into().expect("eight-block chunk");
                self.wide.encrypt_eight(blocks);
                continue;
            }
            #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
            if chunk.len() > 4 {
                let mut batch = Zeroizing::new(EightBlocks::default());
                batch.0[..chunk.len()].copy_from_slice(chunk);
                self.wide.encrypt_eight(&mut batch.0);
                chunk.copy_from_slice(&batch.0[..chunk.len()]);
                continue;
            }
            let mut batch = Zeroizing::new(FourBlocks::default());
            batch.0[..chunk.len()].copy_from_slice(chunk);
            #[cfg(target_arch = "wasm32")]
            self.cipher.encrypt_four(&mut batch);
            #[cfg(not(target_arch = "wasm32"))]
            {
                use aes09::cipher::BlockCipherEncrypt;
                let mut native =
                    Zeroizing::new([aes09::cipher::Block::<aes09::Aes128>::default(); 4]);
                for (output, input) in native.iter_mut().zip(batch.0.iter()) {
                    output.copy_from_slice(input);
                }
                self.cipher.encrypt_blocks(&mut native[..]);
                for (output, input) in batch.0.iter_mut().zip(native.iter()) {
                    output.copy_from_slice(input);
                }
            }
            chunk.copy_from_slice(&batch.0[..chunk.len()]);
        }
    }
}
