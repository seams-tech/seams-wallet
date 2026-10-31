//! Prepared half-gates signing comparison. Requires `benchmarks`.
//! Production uses `super::gmw` with silent-OT correlations.
use super::*;
use crate::runtime::{
    begin_evaluator, begin_garbler,
    prepared::{prepare, PreparedCircuit},
    RuntimeMetrics, RuntimeOutput, Step,
};

/// An in-memory pool that can serve exactly one signing operation.
/// Cancellation, errors and exhaustion destroy all remaining candidate handles.
pub struct PreparedSigner<'a> {
    key: Box<SigningKeyState>,
    candidates: Vec<PreparedCandidate<'a>>,
}

struct PreparedCandidate<'a> {
    values: Zeroizing<Candidate>,
    challenge: PreparedCircuit<'a>,
    bounds: Vec<PreparedCircuit<'a>>,
    decision: PreparedCircuit<'a>,
}

/// Complete signature and every online attempt's counters.
pub struct PreparedSignature {
    /// Standard 3,309-byte signature, verified by the caller before release.
    pub signature: [u8; SIGNATURE_BYTES],
    /// Number of fresh candidates consumed before success.
    pub attempts: u16,
    /// All online circuits, including rejected attempts.
    pub circuits: Vec<(u8, RuntimeMetrics)>,
    /// Candidates that passed both secret bounds but failed public hint checks.
    pub public_rejections: u16,
}

/// Prepares fresh nonce shares, private high/low commitments, and online circuits.
/// No message or operation identifier enters preparation.
pub async fn prepare_signer<'a>(
    role: SigningRole,
    own: OwnSigningShare,
    public_key: &[u8; PUBLIC_KEY_BYTES],
    reservation: Reservation,
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    transport: &mut impl Transport,
) -> Result<PreparedSigner<'a>> {
    let key = prepare_key_state(
        role,
        own,
        public_key,
        &reservation,
        SigningEngine::HalfGates,
        transport,
    )
    .await?;
    let mut candidates = Vec::with_capacity(usize::from(reservation.candidates));
    for _ in 0..reservation.candidates {
        let values = prepare_values(role, &key.matrix, &key.twiddles, schedules, transport).await?;
        let challenge = prepare(role, schedule(schedules, 0x8d)?, transport)
            .await
            .map_err(runtime_error)?;
        let mut bounds = Vec::with_capacity(COLUMNS + ROWS);
        for index in 0..COLUMNS + ROWS {
            let id = if index < COLUMNS { 0x8e } else { 0x97 };
            bounds.push(
                prepare(role, schedule(schedules, id)?, transport)
                    .await
                    .map_err(runtime_error)?,
            );
        }
        let decision = prepare(role, schedule(schedules, 0x98)?, transport)
            .await
            .map_err(runtime_error)?;
        candidates.push(PreparedCandidate {
            values,
            challenge,
            bounds,
            decision,
        });
    }
    Ok(PreparedSigner { key, candidates })
}

impl PreparedSigner<'_> {
    /// Consumes the whole reservation before any message-bound inputs leave.
    /// Commitments stay private until both secret bounds pass. Only their conjunction opens.
    pub async fn sign(
        self,
        message: &[u8],
        context: &[u8],
        operation_id: &[u8; 32],
        transport: &mut impl Transport,
    ) -> Result<PreparedSignature> {
        let Self { key, candidates } = self;
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
        let mut circuits = Vec::new();
        let mut public_rejections = 0;
        for (ordinal, candidate) in candidates.into_iter().enumerate() {
            let PreparedCandidate {
                mut values,
                challenge,
                bounds,
                decision,
            } = candidate;
            let mut input = Zeroizing::new(Vec::new());
            append_bytes(&mut input, &values.high);
            if key.role == SigningRole::A {
                append_bytes(&mut input, &mu);
            }
            let result = challenge
                .run(&input, transport)
                .await
                .map_err(runtime_error)?;
            if result.output.len() != 48 {
                return Err(SigningError::CircuitOutput);
            }
            values.challenge.copy_from_slice(&result.output);
            circuits.push((0x8d, result.metrics));
            responses(&mut values, &key.own, &key.twiddles);
            for (index, prepared) in bounds.into_iter().enumerate() {
                input.clear();
                let polynomial = if index < COLUMNS {
                    &values.z[index]
                } else {
                    &values.r[index - COLUMNS]
                };
                append_polynomial(&mut input, polynomial);
                if key.role == SigningRole::A {
                    let mut mask = [0];
                    random_bytes(&mut mask)?;
                    values.valid[index] = mask[0] & 1 == 1;
                    input.push(values.valid[index]);
                }
                let id = prepared.circuit_id();
                let output = prepared
                    .run(&input, transport)
                    .await
                    .map_err(runtime_error)?;
                if key.role == SigningRole::B {
                    if output.output.len() != 1 || output.output[0] > 1 {
                        return Err(SigningError::CircuitOutput);
                    }
                    values.valid[index] = output.output[0] == 1;
                }
                circuits.push((id, output.metrics));
            }
            input.clear();
            input.extend_from_slice(&values.valid);
            input.resize(1664, false);
            let output = decision
                .run(&input, transport)
                .await
                .map_err(runtime_error)?;
            circuits.push((0x98, output.metrics));
            if output.output.len() != 1 || output.output[0] > 1 {
                return Err(SigningError::CircuitOutput);
            }
            if output.output[0] == 0 {
                continue;
            }
            open_response(key.role, &mut values, transport).await?;
            if !public_hints(
                &mut values,
                &key.public_t,
                &key.public_t0_ntt,
                &key.matrix,
                &key.twiddles,
            )? {
                public_rejections += 1;
                continue;
            }
            let signature = encode_accepted_signature(&values, &[0; ACCEPTED_SHARE_BYTES])?;
            // Both roles reconstruct the same signature and acknowledge its digest.
            // This acknowledgement remains inside the online completion interval.
            let completed: [u8; 64] = shake256(&[&operation, &signature]);
            agree(key.role, &completed, transport).await?;
            return Ok(PreparedSignature {
                signature,
                attempts: (ordinal + 1) as u16,
                circuits,
                public_rejections,
            });
        }
        Err(SigningError::PreparedPoolExhausted)
    }
}

async fn prepare_values(
    role: SigningRole,
    matrix: &PublicMatrix,
    twiddles: &Polynomial,
    schedules: &[TrustedMlDsaSchedule<'_>],
    transport: &mut impl Transport,
) -> Result<Zeroizing<Candidate>> {
    let mut values = Zeroizing::new(Candidate::empty());
    for column in 0..COLUMNS {
        let mut entropy = Zeroizing::new([0; 640]);
        random_bytes(entropy.as_mut())?;
        let mut bits = Zeroizing::new(Vec::new());
        append_bytes(&mut bits, entropy.as_slice());
        if role == SigningRole::A {
            fill_uniform(&mut values.y[column])?;
            append_polynomial(&mut bits, &values.y[column]);
        }
        let output = execute(role, schedule(schedules, 0x92)?, &bits, transport).await?;
        if role == SigningRole::B {
            values.y[column] = decode_polynomial(&output.output, 0)?;
        }
    }
    values.w = matrix_product_plus_error(matrix, &values.y, twiddles);
    for row in 0..ROWS {
        let mut bits = Zeroizing::new(Vec::new());
        append_polynomial(&mut bits, &values.w[row]);
        if role == SigningRole::A {
            let high = &mut values.high[row * 128..(row + 1) * 128];
            random_bytes(high)?;
            append_bytes(&mut bits, high);
            fill_uniform(&mut values.r[row])?;
            append_polynomial(&mut bits, &values.r[row]);
        }
        let output = execute(role, schedule(schedules, 0x96)?, &bits, transport).await?;
        if role == SigningRole::B {
            if output.output.len() != 864 {
                return Err(SigningError::CircuitOutput);
            }
            values.high[row * 128..(row + 1) * 128].copy_from_slice(&output.output[..128]);
            values.r[row] = decode_polynomial(&output.output, 1024)?;
        }
    }
    values.w.zeroize();
    Ok(values)
}

async fn execute(
    role: SigningRole,
    schedule: &TrustedMlDsaSchedule<'_>,
    bits: &[bool],
    transport: &mut impl Transport,
) -> Result<RuntimeOutput> {
    let mut step = match role {
        SigningRole::A => begin_garbler(schedule, bits),
        SigningRole::B => begin_evaluator(schedule, bits),
    }
    .map_err(runtime_error)?;
    loop {
        step = match step {
            Step::Send(message) => {
                transport
                    .send(message.bytes())
                    .await
                    .map_err(runtime_error)?;
                message.resume().map_err(runtime_error)?
            }
            Step::Receive(message) => {
                let bytes = transport
                    .receive(message.expected_bytes())
                    .await
                    .map_err(runtime_error)?;
                message.accept(&bytes).map_err(runtime_error)?
            }
            Step::Complete(output) => return Ok(output),
        };
    }
}
