//! Single-use prepared signing with commitments private until both bounds pass.
//!
//! Direct jointly random masks produce ordinary verifiable ML-DSA signatures.
//! They replace FIPS 204's message-bound hedged nonce derivation. Canonical key
//! generation and recovery remain unchanged. The host enforces durable single use.

/// Batched GMW online evaluation with the same conservative disclosure boundary.
pub mod gmw;
/// Prepared half-gates comparison. Requires `benchmarks`.
#[cfg(feature = "benchmarks")]
pub mod half_gates;

use super::*;
use crate::runtime::{prepared::Transport, RuntimeError, TrustedMlDsaSchedule};

const GAMMA2: u32 = (Q - 1) / 32;
const PUBLIC_T0_BYTES: usize = ROWS * N * 4;
const RESPONSE_BYTES: usize = COLUMNS * N * 4;

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

#[derive(Clone, Copy)]
enum SigningEngine {
    #[cfg(feature = "benchmarks")]
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
    #[cfg(feature = "benchmarks")]
    binding: [u8; 64],
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
        #[cfg(feature = "benchmarks")]
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
            #[cfg(feature = "benchmarks")]
            SigningEngine::HalfGates => 0,
            SigningEngine::Gmw => 1,
        }],
    ])
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
