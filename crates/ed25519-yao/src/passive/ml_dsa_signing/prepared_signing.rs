//! Single-use prepared signing with commitments private until both bounds pass.
//!
//! Direct jointly random masks produce ordinary verifiable ML-DSA signatures.
//! They replace FIPS 204's message-bound hedged nonce derivation. Canonical key
//! generation and recovery remain unchanged. This is an investigation backend.

/// Batched GMW online evaluation with the same conservative disclosure boundary.
pub mod gmw;

use super::*;
use crate::passive::ml_dsa_runtime::{
    prepared::{prepare, PreparedCircuit, Transport},
    RuntimeError,
};

const GAMMA2: u32 = (Q - 1) / 32;
const PUBLIC_T0_BYTES: usize = ROWS * N * 4;
const RESPONSE_BYTES: usize = COLUMNS * N * 4;

/// Fixed circuit set for the conservative prepared signer.
pub const SCHEDULES: [(&str, u8); 6] = [
    ("fresh-mask", 0x92),
    ("prepared-commitment", 0x96),
    ("commitment-hash", 0x8d),
    ("response-check", 0x8e),
    ("low-response-check", 0x97),
    ("bounds-decision", 0x98),
];

/// One key/epoch reservation. The adapter authenticates these identifiers.
/// A production adapter must durably burn the reservation before calling sign.
pub struct Reservation {
    /// Unique, jointly agreed reservation identifier.
    pub id: [u8; 32],
    /// Authenticated key-material epoch identifier.
    pub epoch: [u8; 32],
    /// Number of independent candidates to prepare, between 1 and 821.
    pub candidates: u16,
}

/// An in-memory pool that can serve exactly one signing operation.
/// Cancellation, errors and exhaustion destroy all remaining candidate handles.
pub struct PreparedSigner<'a> {
    key: Box<SigningKeyState>,
    candidates: Vec<PreparedCandidate<'a>>,
}

#[derive(Clone, Copy)]
enum SigningEngine {
    HalfGates,
    Gmw,
}

struct SigningKeyState {
    role: SigningRole,
    own: OwnSigningShare,
    public_key: [u8; PUBLIC_KEY_BYTES],
    public_t: [Polynomial; ROWS],
    public_t0_ntt: [Polynomial; ROWS],
    matrix: PublicMatrix,
    twiddles: Polynomial,
    binding: [u8; 64],
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

async fn prepare_key_state(
    role: SigningRole,
    own: OwnSigningShare,
    public_key: &[u8; PUBLIC_KEY_BYTES],
    reservation: &Reservation,
    engine: SigningEngine,
    transport: &mut impl Transport,
) -> Result<Box<SigningKeyState>> {
    if reservation.candidates == 0 || reservation.candidates > MAX_ATTEMPTS {
        return Err(SigningError::AttemptLimit);
    }
    let binding = reservation_binding(public_key, reservation, engine);
    agree(role, &binding, transport).await?;
    let twiddles = ntt_twiddles();
    let (matrix, _) = expand_a(&public_key[..32]);
    let public_t0_ntt = open_t0(role, &own, transport).await?;
    let public_t = decode_public_t(public_key, &public_t0_ntt, &twiddles);
    Ok(Box::new(SigningKeyState {
        role,
        own,
        public_key: *public_key,
        public_t,
        public_t0_ntt,
        matrix,
        twiddles,
        binding,
    }))
}

fn reservation_binding(
    public_key: &[u8; PUBLIC_KEY_BYTES],
    reservation: &Reservation,
    engine: SigningEngine,
) -> [u8; 64] {
    shake256(&[
        b"seams/ml-dsa-65/prepared-signing/reservation/v1",
        public_key,
        &reservation.id,
        &reservation.epoch,
        &reservation.candidates.to_le_bytes(),
        &[match engine {
            SigningEngine::HalfGates => 0,
            SigningEngine::Gmw => 1,
        }],
    ])
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

fn responses(values: &mut Candidate, own: &OwnSigningShare, twiddles: &Polynomial) {
    let challenge = ntt(sample_in_ball(&values.challenge), twiddles);
    for column in 0..COLUMNS {
        let product = Zeroizing::new(product_from_ntt(
            &challenge,
            &own.polynomial_ntt[column],
            twiddles,
        ));
        for index in 0..N {
            values.z[column][index] = add_mod(values.y[column][index], product[index]);
        }
    }
    for row in 0..ROWS {
        let product = Zeroizing::new(product_from_ntt(
            &challenge,
            &own.polynomial_ntt[COLUMNS + row],
            twiddles,
        ));
        for index in 0..N {
            values.r[row][index] = subtract_mod(values.r[row][index], product[index]);
        }
    }
    values.y.zeroize();
    values.high.zeroize();
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

async fn exchange(
    role: SigningRole,
    own: &[u8],
    transport: &mut impl Transport,
) -> Result<Vec<u8>> {
    match role {
        SigningRole::A => {
            transport.send(own).await.map_err(runtime_error)?;
            transport.receive(own.len()).await.map_err(runtime_error)
        }
        SigningRole::B => {
            let peer = transport.receive(own.len()).await.map_err(runtime_error)?;
            transport.send(own).await.map_err(runtime_error)?;
            Ok(peer)
        }
    }
}

async fn agree(role: SigningRole, digest: &[u8; 64], transport: &mut impl Transport) -> Result<()> {
    let peer = exchange(role, digest, transport).await?;
    if peer != digest {
        return Err(SigningError::RequestBinding);
    }
    Ok(())
}

async fn open_t0(
    role: SigningRole,
    own: &OwnSigningShare,
    transport: &mut impl Transport,
) -> Result<[Polynomial; ROWS]> {
    let mut bytes = Vec::with_capacity(PUBLIC_T0_BYTES);
    for polynomial in &own.polynomial_ntt[COLUMNS + ROWS..] {
        for value in polynomial {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    let peer = exchange(role, &bytes, transport).await?;
    let mut full = [[0; N]; ROWS];
    for (row, polynomial) in full.iter_mut().enumerate() {
        for (index, value) in polynomial.iter_mut().enumerate() {
            let offset = (row * N + index) * 4;
            let other = u32::from_le_bytes(
                peer[offset..offset + 4]
                    .try_into()
                    .expect("exact public t0 length"),
            );
            if other >= Q {
                return Err(SigningError::MessageEncoding);
            }
            *value = add_mod(other, own.polynomial_ntt[COLUMNS + ROWS + row][index]);
        }
    }
    Ok(full)
}

fn decode_public_t(
    pk: &[u8; PUBLIC_KEY_BYTES],
    t0_ntt: &[Polynomial; ROWS],
    twiddles: &Polynomial,
) -> [Polynomial; ROWS] {
    let mut full = [[0; N]; ROWS];
    for row in 0..ROWS {
        let low = arithmetic::inverse_ntt(t0_ntt[row], twiddles);
        for index in 0..N {
            let coefficient = row * N + index;
            let mut high = 0;
            for bit in 0..10 {
                let position = coefficient * 10 + bit;
                high |= u32::from((pk[32 + position / 8] >> (position % 8)) & 1) << bit;
            }
            // Only public decoded values reach this division.
            full[row][index] = ((high << 13) + low[index]) % Q;
        }
    }
    full
}

async fn open_response(
    role: SigningRole,
    values: &mut Candidate,
    transport: &mut impl Transport,
) -> Result<()> {
    let mut own = Vec::with_capacity(RESPONSE_BYTES);
    for polynomial in &values.z {
        for value in polynomial {
            own.extend_from_slice(&value.to_le_bytes());
        }
    }
    let peer = exchange(role, &own, transport).await?;
    for column in 0..COLUMNS {
        for index in 0..N {
            let offset = (column * N + index) * 4;
            let other = u32::from_le_bytes(
                peer[offset..offset + 4]
                    .try_into()
                    .expect("exact response length"),
            );
            if other >= Q {
                return Err(SigningError::MessageEncoding);
            }
            values.z[column][index] = add_mod(values.z[column][index], other);
        }
    }
    Ok(())
}

fn public_hints(
    values: &mut Candidate,
    t: &[Polynomial; ROWS],
    t0_ntt: &[Polynomial; ROWS],
    matrix: &PublicMatrix,
    twiddles: &Polynomial,
) -> Result<bool> {
    let mut response = [[0; N]; COLUMNS + ROWS];
    response[..COLUMNS].copy_from_slice(&values.z);
    let az = matrix_product_plus_error(matrix, &response, twiddles);
    let challenge = ntt(sample_in_ball(&values.challenge), twiddles);
    let mut count = 0;
    let mut correction_valid = true;
    for row in 0..ROWS {
        let ct = product_from_ntt(&challenge, &ntt(t[row], twiddles), twiddles);
        let ct0 = product_from_ntt(&challenge, &t0_ntt[row], twiddles);
        for index in 0..N {
            correction_valid &= ct0[index] < GAMMA2 || ct0[index] > Q - GAMMA2;
            let r = subtract_mod(az[row][index], ct[index]);
            let corrected = add_mod(r, ct0[index]);
            let hint = public_high(r) != public_high(corrected);
            values.hints[row * N + index] = hint;
            count += usize::from(hint);
        }
    }
    Ok(correction_valid && count <= 55)
}

fn public_high(value: u32) -> u32 {
    ((((value + 127) >> 7) * 1025 + (1 << 21)) >> 22) & 15
}

fn schedule<'a>(
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    id: u8,
) -> Result<&'a TrustedMlDsaSchedule<'a>> {
    schedules
        .iter()
        .find(|schedule| schedule.circuit_id() == id)
        .ok_or(SigningError::Schedule)
}

fn runtime_error(_: RuntimeError) -> SigningError {
    SigningError::CircuitRuntime
}
