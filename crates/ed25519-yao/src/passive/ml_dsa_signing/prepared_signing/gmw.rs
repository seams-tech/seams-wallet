//! Complete prepared signing with all online candidates evaluated in three batches.

use super::*;
use crate::passive::ml_dsa_runtime::boolean_comparison::{
    prepared::{prepare_batch, BatchMetrics, PreparedGmwBatch},
    Transport as BooleanTransport,
};

/// One-use candidate batch with private commitments and independent correlations.
pub struct PreparedGmwSigner<'a> {
    key: Box<SigningKeyState>,
    values: Vec<Zeroizing<Candidate>>,
    hashes: PreparedGmwBatch<'a>,
    bounds: PreparedGmwBatch<'a>,
    decisions: PreparedGmwBatch<'a>,
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
    /// Candidates opened after private checks and rejected by public hint checks.
    pub public_rejections: u16,
}

/// Prepares fresh masks and commitments, then all three private GMW batches.
/// The same canonical key and disclosure boundary apply as for prepared Yao.
pub async fn prepare_gmw_signer<'a, T: Transport + BooleanTransport>(
    role: SigningRole,
    own: OwnSigningShare,
    public_key: &[u8; PUBLIC_KEY_BYTES],
    reservation: Reservation,
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    transport: &mut T,
) -> Result<PreparedGmwSigner<'a>> {
    if reservation.candidates == 0 || reservation.candidates > 32 {
        return Err(SigningError::AttemptLimit);
    }
    let key = prepare_key_state(
        role,
        own,
        public_key,
        &reservation,
        SigningEngine::Gmw,
        transport,
    )
    .await?;
    let count = usize::from(reservation.candidates);
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        values.push(prepare_values(role, &key.matrix, &key.twiddles, schedules, transport).await?);
    }
    let hash_schedules = vec![schedule(schedules, 0x8d)?; count];
    let hashes = prepare_batch(role, &hash_schedules, transport)
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
    let bounds = prepare_batch(role, &bound_schedules, transport)
        .await
        .map_err(runtime_error)?;
    let decision_schedules = vec![schedule(schedules, 0x98)?; count];
    let decisions = prepare_batch(role, &decision_schedules, transport)
        .await
        .map_err(runtime_error)?;
    Ok(PreparedGmwSigner {
        key,
        values,
        hashes,
        bounds,
        decisions,
    })
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
    ) -> Result<GmwSignature> {
        let Self {
            key,
            mut values,
            hashes,
            bounds,
            decisions,
        } = self;
        let count = values.len();
        let context_length =
            u8::try_from(context.len()).map_err(|_| SigningError::ContextLength)?;
        let tr: [u8; 64] = shake256(&[&key.public_key]);
        let mu: [u8; 64] = shake256(&[&tr, &[0, context_length], context, message]);
        let operation: [u8; 64] = shake256(&[
            b"seams/ml-dsa-65/prepared-signing/operation/v1",
            &key.binding,
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
            return Ok(GmwSignature {
                signature,
                accepted_candidate: (candidate + 1) as u16,
                evaluated_candidates: count as u16,
                batches: [hashes.metrics, bounds.metrics, decisions.metrics],
                public_rejections,
            });
        }
        Err(SigningError::PreparedPoolExhausted)
    }
}
