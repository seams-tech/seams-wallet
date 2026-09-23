//! Encrypted completion state for an exact, already prepared activation request.

use chacha20poly1305::{
    aead::{Aead, Payload},
    ChaCha20Poly1305, KeyInit, Nonce,
};
use hkdf::Hkdf;
use router_ab_core::RouterAbEd25519YaoActivationExecuteRequestV1;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::{ClientActivationContinuityV1, ClientActivationError, ClientActivationStateV1};

const PURPOSE: &[u8] = b"seams/router-ab/ed25519-yao/activation-checkpoint/v1";
// Version, two participant IDs, recipient key, continuity tag, expected public key.
const PLAINTEXT_LEN: usize = 1 + 4 + 32 + 1 + 32;

fn checkpoint_key_and_aad(
    wrapping_secret: &[u8; 32],
    context: &[u8],
    request: &RouterAbEd25519YaoActivationExecuteRequestV1,
) -> Result<(Zeroizing<[u8; 32]>, [u8; 32]), ClientActivationError> {
    if context.is_empty() || context.len() > 4096 {
        return Err(ClientActivationError::BindingMismatch);
    }
    let request_bytes =
        serde_json::to_vec(request).map_err(|_| ClientActivationError::EncodingFailed)?;
    let mut digest = Sha256::new();
    digest.update(PURPOSE);
    digest.update((context.len() as u64).to_be_bytes());
    digest.update(context);
    digest.update(request_bytes);
    let aad: [u8; 32] = digest.finalize().into();
    let mut key = Zeroizing::new([0; 32]);
    Hkdf::<Sha256>::new(Some(PURPOSE), wrapping_secret)
        .expand(&aad, &mut key[..])
        .map_err(|_| ClientActivationError::InvalidCheckpoint)?;
    Ok((key, aad))
}

impl ClientActivationStateV1 {
    /// Seals completion state under a custody-derived wrapping secret. Only ciphertext
    /// may cross the client boundary; the caller generates a fresh 12-byte nonce.
    pub fn seal_checkpoint(
        &self,
        request: &RouterAbEd25519YaoActivationExecuteRequestV1,
        wrapping_secret: &[u8; 32],
        context: &[u8],
        nonce: &[u8; 12],
    ) -> Result<Vec<u8>, ClientActivationError> {
        if request.binding() != &self.binding {
            return Err(ClientActivationError::BindingMismatch);
        }
        let (key, aad) = checkpoint_key_and_aad(wrapping_secret, context, request)?;
        let mut plaintext = Zeroizing::new([0; PLAINTEXT_LEN]);
        plaintext[0] = 1;
        plaintext[1..3].copy_from_slice(&self.participant_ids[0].to_be_bytes());
        plaintext[3..5].copy_from_slice(&self.participant_ids[1].to_be_bytes());
        plaintext[5..37].copy_from_slice(&self.recipient_private_key);
        match self.continuity {
            ClientActivationContinuityV1::Establish => {}
            ClientActivationContinuityV1::Preserve(public_key) => {
                plaintext[37] = 1;
                plaintext[38..70].copy_from_slice(&public_key);
            }
        }
        ChaCha20Poly1305::new_from_slice(&key[..])
            .map_err(|_| ClientActivationError::InvalidCheckpoint)?
            .encrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: &plaintext[..],
                    aad: &aad,
                },
            )
            .map_err(|_| ClientActivationError::InvalidCheckpoint)
    }

    /// Restores the same prepared exchange after authenticated custody unlock.
    /// This restores local completion state and grants no server execution authority.
    pub fn open_checkpoint(
        request: &RouterAbEd25519YaoActivationExecuteRequestV1,
        wrapping_secret: &[u8; 32],
        context: &[u8],
        nonce: &[u8; 12],
        ciphertext: &[u8],
    ) -> Result<Self, ClientActivationError> {
        if ciphertext.len() != PLAINTEXT_LEN + 16 {
            return Err(ClientActivationError::InvalidCheckpoint);
        }
        let (key, aad) = checkpoint_key_and_aad(wrapping_secret, context, request)?;
        let plaintext = Zeroizing::new(
            ChaCha20Poly1305::new_from_slice(&key[..])
                .map_err(|_| ClientActivationError::InvalidCheckpoint)?
                .decrypt(
                    Nonce::from_slice(nonce),
                    Payload {
                        msg: ciphertext,
                        aad: &aad,
                    },
                )
                .map_err(|_| ClientActivationError::InvalidCheckpoint)?,
        );
        if plaintext[0] != 1 {
            return Err(ClientActivationError::InvalidCheckpoint);
        }
        let continuity = match plaintext[37] {
            0 => ClientActivationContinuityV1::Establish,
            1 => ClientActivationContinuityV1::Preserve(
                plaintext[38..70]
                    .try_into()
                    .map_err(|_| ClientActivationError::InvalidCheckpoint)?,
            ),
            _ => return Err(ClientActivationError::InvalidCheckpoint),
        };
        Ok(Self {
            binding: request.binding().clone(),
            participant_ids: [
                u16::from_be_bytes([plaintext[1], plaintext[2]]),
                u16::from_be_bytes([plaintext[3], plaintext[4]]),
            ],
            recipient_private_key: plaintext[5..37]
                .try_into()
                .map_err(|_| ClientActivationError::InvalidCheckpoint)?,
            continuity,
        })
    }

    /// Public participant ordering authenticated by the checkpoint.
    pub const fn participant_ids(&self) -> [u16; 2] {
        self.participant_ids
    }
}
