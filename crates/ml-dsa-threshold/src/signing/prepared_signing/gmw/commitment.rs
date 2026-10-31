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

/// Independent key-bound reservations and the complete co-evaluation cost.
pub struct CommittedGmwGroup<'a> {
    /// Each reservation remains a separately consumable signing pair.
    pub reservations: Vec<CommittedGmwReservation<'a>>,
    /// Aggregate traffic and actual shared AND-layer exchanges.
    pub metrics: BatchMetrics,
    /// Largest actual logical message, including output reconstruction.
    pub maximum_message_bytes: usize,
}

struct PendingCommitment<'a> {
    role: SigningRole,
    id: [u8; 32],
    binding: [u8; 64],
    values: Vec<Zeroizing<Candidate>>,
    hashes: PreparedGmwBatch<'a>,
    bounds: PreparedGmwBatch<'a>,
    decisions: PreparedGmwBatch<'a>,
    masks: BatchMetrics,
}

/// Commits fresh independent reservations in one ordered private computation.
/// The caller must durably consume every input before this function starts.
/// Interruption destroys the entire cohort; successful outputs remain separate.
pub async fn commit_gmw_reservations<'a>(
    prepared: Vec<PreparedGmwReservation<'a>>,
    public_key: &[u8; PUBLIC_KEY_BYTES],
    epoch: [u8; 32],
    transport: &mut impl BooleanTransport,
) -> Result<CommittedGmwGroup<'a>> {
    let first = prepared.first().ok_or(SigningError::AttemptLimit)?;
    let role = first.role;
    let candidates = first.values.len();
    if candidates == 0 || prepared.len() * candidates > 32 {
        return Err(SigningError::AttemptLimit);
    }
    for (index, reservation) in prepared.iter().enumerate() {
        if reservation.role != role
            || reservation.values.len() != candidates
            || prepared[..index]
                .iter()
                .any(|previous| previous.id == reservation.id)
        {
            return Err(SigningError::RequestBinding);
        }
    }
    let twiddles = ntt_twiddles();
    let (matrix, _) = expand_a(&public_key[..32]);
    let mut pending = Vec::with_capacity(prepared.len());
    let mut requests = Vec::with_capacity(prepared.len());
    for prepared in prepared {
        let PreparedGmwReservation {
            role,
            id,
            mut values,
            commitments,
            hashes,
            bounds,
            decisions,
            masks,
        } = prepared;
        let reservation = Reservation {
            id,
            epoch,
            candidates: candidates as u16,
        };
        let key_binding = reservation_binding(public_key, &reservation, SigningEngine::Gmw);
        let binding = commitment_binding(&key_binding, &id, candidates);
        let inputs = nonce::commitment_inputs(&mut values, role, &matrix, &twiddles)?;
        requests.push(PreparedGmwRequest {
            batch: commitments,
            inputs,
            binding: shake256(&[&binding, b"gmw-nonce-commitments"]),
        });
        pending.push(PendingCommitment {
            role,
            id,
            binding,
            values,
            hashes,
            bounds,
            decisions,
            masks,
        });
    }
    let result = run_batches(requests, transport)
        .await
        .map_err(runtime_error)?;
    if result.batches.len() != pending.len() {
        return Err(SigningError::CircuitOutput);
    }
    let mut reservations = Vec::with_capacity(pending.len());
    for (pending, output) in pending.into_iter().zip(result.batches) {
        let PendingCommitment {
            role,
            id,
            binding,
            mut values,
            hashes,
            bounds,
            decisions,
            masks,
        } = pending;
        nonce::apply_commitment_outputs(&mut values, role, &output.outputs)?;
        reservations.push(CommittedGmwReservation {
            role,
            id,
            binding,
            values,
            hashes,
            bounds,
            decisions,
            nonce_batches: [masks, output.metrics],
        });
    }
    Ok(CommittedGmwGroup {
        reservations,
        metrics: result.metrics,
        maximum_message_bytes: result.maximum_message_bytes,
    })
}
