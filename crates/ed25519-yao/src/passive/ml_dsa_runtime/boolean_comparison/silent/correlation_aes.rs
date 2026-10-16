//! Same AES-128 permutation, using the existing four-block Wasm backend.
use crate::passive::gate_aes::FourBlocks;
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
    #[cfg(target_arch = "wasm32")]
    cipher: crate::passive::gate_aes::FourBlockAes128,
    #[cfg(not(target_arch = "wasm32"))]
    cipher: aes09::Aes128,
}

impl CorrelationAes {
    pub(super) fn new(key: &[u8; 16]) -> Self {
        #[cfg(target_arch = "wasm32")]
        let cipher = crate::passive::gate_aes::FourBlockAes128::new(key);
        #[cfg(not(target_arch = "wasm32"))]
        let cipher = {
            use aes09::cipher::KeyInit;
            aes09::Aes128::new(key.into())
        };
        Self { cipher }
    }

    pub(super) fn encrypt(&self, blocks: &mut [[u8; 16]]) {
        // Length and padding depend only on the public circuit dimensions.
        for chunk in blocks.chunks_mut(4) {
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
