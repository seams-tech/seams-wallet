//! Key-specific private commitments need public key data and fresh nonce shares only.

use super::*;

pub(super) fn commitment_binding(
    key_binding: &[u8; 64],
    id: &[u8; 32],
    candidates: usize,
) -> [u8; 64] {
    shake256(&[
        b"seams/ml-dsa/gmw-activated-reservation/v1",
        key_binding,
        id,
        &(candidates as u16).to_le_bytes(),
    ])
}

impl<'a> PreparedGmwReservation<'a> {
    /// Consumes fresh generic material to prepare private commitments for one key.
    /// No long-term share enters this computation. Persist only the sealed result.
    /// An interrupted call destroys the handle; its input must never be reused.
    pub async fn commit(
        self,
        public_key: &[u8; PUBLIC_KEY_BYTES],
        epoch: [u8; 32],
        transport: &mut impl BooleanTransport,
    ) -> Result<CommittedGmwReservation<'a>> {
        let reservation = Reservation {
            id: self.id,
            epoch,
            candidates: self.values.len() as u16,
        };
        let key_binding = reservation_binding(public_key, &reservation, SigningEngine::Gmw);
        let binding = commitment_binding(&key_binding, &self.id, self.values.len());
        let twiddles = ntt_twiddles();
        let (matrix, _) = expand_a(&public_key[..32]);
        self.commit_values(&matrix, &twiddles, binding, transport)
            .await
    }

    pub(super) async fn commit_values(
        self,
        matrix: &PublicMatrix,
        twiddles: &Polynomial,
        binding: [u8; 64],
        transport: &mut impl BooleanTransport,
    ) -> Result<CommittedGmwReservation<'a>> {
        let Self {
            role,
            id,
            mut values,
            commitments,
            hashes,
            bounds,
            decisions,
            masks,
        } = self;
        let commitments = nonce::activate_values(
            &mut values,
            role,
            matrix,
            twiddles,
            &binding,
            commitments,
            transport,
        )
        .await?;
        Ok(CommittedGmwReservation {
            role,
            id,
            binding,
            values,
            hashes,
            bounds,
            decisions,
            nonce_batches: [masks, commitments],
        })
    }
}

impl<'a> CommittedGmwReservation<'a> {
    /// Binds an already committed, durably consumed reservation to the signing share.
    /// A wrong key or epoch fails before any transport message.
    pub async fn activate<T: Transport + BooleanTransport>(
        self,
        own: OwnSigningShare,
        public_key: &[u8; PUBLIC_KEY_BYTES],
        epoch: [u8; 32],
        transport: &mut T,
    ) -> Result<PreparedGmwSigner<'a>> {
        let reservation = Reservation {
            id: self.id,
            epoch,
            candidates: self.values.len() as u16,
        };
        let key_binding = reservation_binding(public_key, &reservation, SigningEngine::Gmw);
        if self.binding != commitment_binding(&key_binding, &self.id, self.values.len()) {
            return Err(SigningError::RequestBinding);
        }
        let key = prepare_key_state(
            self.role,
            own,
            public_key,
            &reservation,
            SigningEngine::Gmw,
            transport,
        )
        .await?;
        Ok(PreparedGmwSigner {
            key: Rc::new(key),
            preparation: self,
        })
    }
}

impl<'a> ConsumedGmwPreparation<'a> {
    /// Consumes either valid storage state and produces one message-ready signer.
    pub async fn activate<T: Transport + BooleanTransport>(
        self,
        own: OwnSigningShare,
        public_key: &[u8; PUBLIC_KEY_BYTES],
        epoch: [u8; 32],
        transport: &mut T,
    ) -> Result<PreparedGmwSigner<'a>> {
        match self {
            Self::Generic(prepared) => prepared.activate(own, public_key, epoch, transport).await,
            Self::Committed(prepared) => prepared.activate(own, public_key, epoch, transport).await,
        }
    }
}
