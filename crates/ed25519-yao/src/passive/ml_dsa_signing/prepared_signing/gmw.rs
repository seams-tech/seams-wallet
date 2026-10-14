//! Key-independent preparation and one-use signing with private commitments.

mod nonce;
/// Bounded ready reservations with automatic rollover and consuming lifecycle.
pub mod pool;

use std::rc::Rc;

use super::*;
use crate::passive::ml_dsa_runtime::boolean_comparison::{
    prepared::{prepare_batch, BatchMetrics, PreparedGmwBatch, PublicTopologies},
    silent::CorrelationStream,
    Transport as BooleanTransport,
};

/// One-use candidate batch bound to a key and epoch.
pub struct PreparedGmwSigner<'a> {
    key: Rc<Box<SigningKeyState>>,
    binding: [u8; 64],
    values: Vec<Zeroizing<Candidate>>,
    hashes: PreparedGmwBatch<'a>,
    bounds: PreparedGmwBatch<'a>,
    decisions: PreparedGmwBatch<'a>,
    nonce_batches: [BatchMetrics; 2],
}

/// Preparation that contains no key, epoch, message, or wallet seed.
/// Activation consumes this handle and binds it to exactly one key and epoch.
pub struct PreparedGmwReservation<'a> {
    role: SigningRole,
    id: [u8; 32],
    values: Vec<Zeroizing<Candidate>>,
    commitments: PreparedGmwBatch<'a>,
    hashes: PreparedGmwBatch<'a>,
    bounds: PreparedGmwBatch<'a>,
    decisions: PreparedGmwBatch<'a>,
    masks: BatchMetrics,
}

/// A standard signature with every evaluated candidate included in its metrics.
pub struct GmwSignature {
    /// Standard ML-DSA-65 encoding.
    pub signature: [u8; SIGNATURE_BYTES],
    /// Index of the first fully accepted candidate, plus one.
    pub accepted_candidate: u16,
    /// All evaluated candidates are consumed, including later unused candidates.
    pub evaluated_candidates: u16,
    /// Challenge, private bounds, and combined-decision batch measurements.
    pub batches: [BatchMetrics; 3],
    /// Complete nonce conversion and decomposition measurements.
    pub preparation_batches: [BatchMetrics; 2],
    /// Candidates opened after private checks and rejected by public hint checks.
    pub public_rejections: u16,
}

/// Complete private-check work from an exhausted reservation.
pub struct GmwExhaustion {
    /// Every candidate consumed by this batch.
    pub evaluated_candidates: u16,
    /// Online challenge, bounds, and decision measurements.
    pub batches: [BatchMetrics; 3],
    /// Nonce conversion and commitment activation measurements.
    pub preparation_batches: [BatchMetrics; 2],
    /// Opened candidates rejected by public hint checks.
    pub public_rejections: u16,
}

/// Every consumed batch returns its measurements, including rejection.
pub enum GmwBatchResult {
    /// A standard signature passed all private and public checks.
    Signed(GmwSignature),
    /// No candidate passed; all private handles have been destroyed.
    Exhausted(GmwExhaustion),
}

/// Prepares nonce shares and correlations before a wallet key exists.
/// Both roles must use the same fresh preparation identifier.
pub async fn prepare_gmw_reservation<'a>(
    role: SigningRole,
    id: [u8; 32],
    candidates: u16,
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    topologies: &mut PublicTopologies,
    transport: &mut impl BooleanTransport,
) -> Result<PreparedGmwReservation<'a>> {
    if candidates == 0 || candidates > 32 {
        return Err(SigningError::AttemptLimit);
    }
    let count = usize::from(candidates);
    let mut circuit_set = Vec::with_capacity(schedules.len() * 32);
    for schedule in schedules {
        circuit_set.extend_from_slice(&schedule.schedule_digest());
    }
    let correlation_binding: [u8; 32] = shake256(&[
        b"seams/ml-dsa/gmw-generic-preparation/v1",
        &id,
        &candidates.to_le_bytes(),
        &circuit_set,
    ]);
    let mut correlations = CorrelationStream::new(role, correlation_binding);
    let (values, masks) = nonce::prepare_masks(
        role,
        count,
        &correlation_binding,
        schedules,
        &mut correlations,
        topologies,
        transport,
    )
    .await?;
    let commitment_schedules = vec![schedule(schedules, 0x96)?; count * ROWS];
    let commitments = prepare_batch(
        role,
        &commitment_schedules,
        &mut correlations,
        topologies,
        transport,
    )
    .await
    .map_err(runtime_error)?;
    let hash_schedules = vec![schedule(schedules, 0x8d)?; count];
    let hashes = prepare_batch(
        role,
        &hash_schedules,
        &mut correlations,
        topologies,
        transport,
    )
    .await
    .map_err(runtime_error)?;
    let mut bound_schedules = Vec::with_capacity(count * (COLUMNS + ROWS));
    for _ in 0..count {
        for index in 0..COLUMNS + ROWS {
            bound_schedules.push(schedule(
                schedules,
                if index < COLUMNS { 0x8e } else { 0x97 },
            )?);
        }
    }
    let bounds = prepare_batch(
        role,
        &bound_schedules,
        &mut correlations,
        topologies,
        transport,
    )
    .await
    .map_err(runtime_error)?;
    let decision_schedules = vec![schedule(schedules, 0x98)?; count];
    let decisions = prepare_batch(
        role,
        &decision_schedules,
        &mut correlations,
        topologies,
        transport,
    )
    .await
    .map_err(runtime_error)?;
    Ok(PreparedGmwReservation {
        role,
        id,
        values,
        commitments,
        hashes,
        bounds,
        decisions,
        masks,
    })
}

impl<'a> PreparedGmwReservation<'a> {
    /// Consumes preparation before opening public t0 or evaluating commitments.
    /// A persistent adapter must durably burn this reservation before activation.
    /// Errors and cancellation destroy all private handles in this reservation.
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
        let key = prepare_key_state(
            self.role,
            own,
            public_key,
            &reservation,
            SigningEngine::Gmw,
            transport,
        )
        .await?;
        self.activate_for_key(Rc::new(key), transport).await
    }

    fn private_bytes(&self) -> usize {
        self.values.capacity() * core::mem::size_of::<Zeroizing<Candidate>>()
            + self.commitments.private_bytes()
            + self.hashes.private_bytes()
            + self.bounds.private_bytes()
            + self.decisions.private_bytes()
    }

    async fn activate_for_key<T: Transport + BooleanTransport>(
        self,
        key: Rc<Box<SigningKeyState>>,
        transport: &mut T,
    ) -> Result<PreparedGmwSigner<'a>> {
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
        if role != key.role {
            return Err(SigningError::RequestBinding);
        }
        let binding = shake256(&[
            b"seams/ml-dsa/gmw-activated-reservation/v1",
            &key.binding,
            &id,
            &(values.len() as u16).to_le_bytes(),
        ]);
        let commitments =
            nonce::activate_values(&mut values, &key, &binding, commitments, transport).await?;
        Ok(PreparedGmwSigner {
            key,
            binding,
            values,
            hashes,
            bounds,
            decisions,
            nonce_batches: [masks, commitments],
        })
    }
}

impl PreparedGmwSigner<'_> {
    /// Consumes every candidate before any message-bound input evaluation.
    /// Individual checks stay shared. Commitments stay private until both bounds pass.
    pub async fn sign<T: Transport + BooleanTransport>(
        self,
        message: &[u8],
        context: &[u8],
        operation_id: &[u8; 32],
        transport: &mut T,
    ) -> Result<GmwBatchResult> {
        let Self {
            key,
            binding,
            mut values,
            hashes,
            bounds,
            decisions,
            nonce_batches,
        } = self;
        let count = values.len();
        let context_length =
            u8::try_from(context.len()).map_err(|_| SigningError::ContextLength)?;
        let tr: [u8; 64] = shake256(&[&key.public_key]);
        let mu: [u8; 64] = shake256(&[&tr, &[0, context_length], context, message]);
        let operation: [u8; 64] = shake256(&[
            b"seams/ml-dsa-65/prepared-signing/operation/v1",
            &binding,
            operation_id,
            &mu,
        ]);
        agree(key.role, &operation, transport).await?;
        let request: [u8; 32] = shake256(&[&operation]);
        let mut inputs = Vec::with_capacity(count);
        for value in &values {
            let mut input = Zeroizing::new(Vec::new());
            append_bytes(&mut input, &value.high);
            if key.role == SigningRole::A {
                append_bytes(&mut input, &mu);
            }
            inputs.push(input);
        }
        let hashes = hashes
            .run(&inputs, &request, transport)
            .await
            .map_err(runtime_error)?;
        inputs.clear();
        for (value, output) in values.iter_mut().zip(&hashes.outputs) {
            if output.len() != 48 {
                return Err(SigningError::CircuitOutput);
            }
            value.challenge.copy_from_slice(output);
            responses(value, &key.own, &key.twiddles);
            for index in 0..COLUMNS + ROWS {
                let mut input = Zeroizing::new(Vec::new());
                let polynomial = if index < COLUMNS {
                    &value.z[index]
                } else {
                    &value.r[index - COLUMNS]
                };
                append_polynomial(&mut input, polynomial);
                if key.role == SigningRole::A {
                    let mut mask = [0];
                    random_bytes(&mut mask)?;
                    value.valid[index] = mask[0] & 1 == 1;
                    input.push(value.valid[index]);
                }
                inputs.push(input);
            }
        }
        let bounds = bounds
            .run(&inputs, &request, transport)
            .await
            .map_err(runtime_error)?;
        inputs.clear();
        for (candidate, value) in values.iter_mut().enumerate() {
            if key.role == SigningRole::B {
                for index in 0..COLUMNS + ROWS {
                    let output = &bounds.outputs[candidate * (COLUMNS + ROWS) + index];
                    if output.len() != 1 || output[0] > 1 {
                        return Err(SigningError::CircuitOutput);
                    }
                    value.valid[index] = output[0] == 1;
                }
            }
            let mut input = Zeroizing::new(value.valid.to_vec());
            input.resize(1664, false);
            inputs.push(input);
        }
        let decisions = decisions
            .run(&inputs, &request, transport)
            .await
            .map_err(runtime_error)?;
        inputs.clear();
        let mut public_rejections = 0;
        for (candidate, (mut value, decision)) in
            values.into_iter().zip(&decisions.outputs).enumerate()
        {
            if decision.len() != 1 || decision[0] > 1 {
                return Err(SigningError::CircuitOutput);
            }
            if decision[0] == 0 {
                continue;
            }
            open_response(key.role, &mut value, transport).await?;
            if !public_hints(
                &mut value,
                &key.public_t,
                &key.public_t0_ntt,
                &key.matrix,
                &key.twiddles,
            )? {
                public_rejections += 1;
                continue;
            }
            let signature = encode_accepted_signature(&value, &[0; ACCEPTED_SHARE_BYTES])?;
            let completed: [u8; 64] = shake256(&[&operation, &signature]);
            agree(key.role, &completed, transport).await?;
            return Ok(GmwBatchResult::Signed(GmwSignature {
                signature,
                accepted_candidate: (candidate + 1) as u16,
                evaluated_candidates: count as u16,
                batches: [hashes.metrics, bounds.metrics, decisions.metrics],
                preparation_batches: nonce_batches,
                public_rejections,
            }));
        }
        Ok(GmwBatchResult::Exhausted(GmwExhaustion {
            evaluated_candidates: count as u16,
            batches: [hashes.metrics, bounds.metrics, decisions.metrics],
            preparation_batches: nonce_batches,
            public_rejections,
        }))
    }
}
