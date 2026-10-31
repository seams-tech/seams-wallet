//! Shared role material and signing primitives for passive two-party ML-DSA-65.
//!
//! The deployed signer uses `prepared_signing::gmw`. Its fresh joint masks differ
//! from FIPS 204's message-bound nonce derivation. Key derivation and encodings
//! remain canonical. The host owns admission, authenticated transport, and durable
//! single use. Complete protocol and deployment qualification remain separate.

/// Message-bound nonce signing for reference comparisons. Requires `benchmarks`.
#[cfg(feature = "benchmarks")]
pub mod reference;

pub mod arithmetic;
pub mod keygen;
/// Single-use preparation with private rejected commitments.
pub mod prepared_signing;
/// Private canonical-seed derivation from shares of a wallet-derived owner root.
pub mod wallet_seed;

use core::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::runtime::RuntimeMetrics;
use arithmetic::{
    add_mod, expand_a, matrix_product_plus_error, ntt, ntt_twiddles, product_from_ntt,
    sample_in_ball, shake256, subtract_mod, Polynomial, PublicMatrix, COLUMNS, N, Q, ROWS,
};

const MATERIAL_BYTES: usize = 17_472;
const ACCEPTED_SHARE_BYTES: usize = COLUMNS * N * 4 + ROWS * N / 8;
const MAX_ATTEMPTS: u16 = 821;
const GAMMA1: u32 = 1 << 19;
const BETA: u32 = 196;

/// Measurements retain the identity of the engine that produced them.
pub enum CircuitMetrics {
    /// Streaming half-gates execution.
    HalfGates(RuntimeMetrics),
    /// Investigation-only Boolean sharing, including private preprocessing.
    #[cfg(feature = "benchmarks")]
    Boolean {
        /// The Boolean engine used for this invocation.
        engine: super::runtime::boolean_mpc::comparison::Engine,
        /// Directional phase counters from this role's execution.
        metrics: super::runtime::boolean_mpc::comparison::Metrics,
    },
}

/// Exact standard ML-DSA-65 public-key size.
pub const PUBLIC_KEY_BYTES: usize = 1952;
/// Exact standard ML-DSA-65 signature size.
pub const SIGNATURE_BYTES: usize = 3309;

/// One participant's fixed signing role.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SigningRole {
    /// Participant A; garbler for half-gates circuits.
    A,
    /// Participant B; evaluator for half-gates circuits.
    B,
}

/// Boundary and protocol failures. A failure produces no partial signature.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SigningError {
    /// The role-local material has the wrong size or an invalid residue.
    KeyMaterial,
    /// The FIPS context exceeds 255 bytes.
    ContextLength,
    /// The operating-system random source failed.
    Randomness,
    /// The requested circuit differs from the admitted schedule.
    Schedule,
    /// A circuit returned a result outside its role's schema.
    CircuitOutput,
    /// Generic registration stock was supplied where key-bound material is required.
    PreparationState,
    /// The private circuit runtime failed.
    CircuitRuntime,
    /// A peer message has an invalid exact encoding.
    MessageEncoding,
    /// The peer supplied a different signing request or the wrong role.
    RequestBinding,
    /// The candidate count or attempt bound exceeds its permitted limit.
    AttemptLimit,
    #[cfg(feature = "benchmarks")]
    /// The single-use prepared reservation ran out of fresh candidates.
    PreparedPoolExhausted,
    #[cfg(feature = "benchmarks")]
    /// This operation identifier has already consumed a pool reservation.
    PreparedPoolReplay,
    #[cfg(feature = "benchmarks")]
    /// A failed or canceled pool operation destroyed its remaining reservations.
    PreparedPoolUnavailable,
    /// The accepted candidate cannot use the standard signature encoding.
    SignatureEncoding,
}

impl fmt::Display for SigningError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "ML-DSA signing failed: {self:?}")
    }
}
impl core::error::Error for SigningError {}
type Result<T> = core::result::Result<T, SigningError>;

/// Parsed signing fields from one participant's private material file.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct OwnSigningShare {
    #[cfg(feature = "benchmarks")]
    k: [u8; 32],
    polynomial_ntt: [Polynomial; COLUMNS + ROWS + ROWS],
}

impl OwnSigningShare {
    /// Parses exactly one role's material. No peer material enters this API.
    /// The first 32 bytes retain the seed share in storage, outside this object.
    /// K is loaded only by the benchmark reference signer.
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != MATERIAL_BYTES {
            return Err(SigningError::KeyMaterial);
        }
        let mut share = Self {
            #[cfg(feature = "benchmarks")]
            k: bytes[32..64].try_into().expect("fixed K share"),
            polynomial_ntt: [[0; N]; COLUMNS + ROWS + ROWS],
        };
        let twiddles = ntt_twiddles();
        for (polynomial, encoded) in share
            .polynomial_ntt
            .iter_mut()
            .zip(bytes[64..].chunks_exact(N * 4))
        {
            for (coefficient, chunk) in polynomial.iter_mut().zip(encoded.chunks_exact(4)) {
                let value = u32::from_le_bytes(chunk.try_into().expect("fixed residue"));
                if value >= Q {
                    return Err(SigningError::KeyMaterial);
                }
                *coefficient = value;
            }
            *polynomial = ntt(*polynomial, &twiddles);
        }
        Ok(share)
    }
}

#[derive(Zeroize)]
struct Candidate {
    y: arithmetic::SecretVector,
    w: [Polynomial; ROWS],
    high: [u8; ROWS * N / 2],
    z: [Polynomial; COLUMNS],
    r: [Polynomial; ROWS],
    correction: [Polynomial; ROWS],
    valid: [bool; COLUMNS + ROWS],
    hints: [bool; ROWS * N],
    challenge: [u8; 48],
}

impl Candidate {
    const fn empty() -> Self {
        Self {
            y: [[0; N]; COLUMNS + ROWS],
            w: [[0; N]; ROWS],
            high: [0; ROWS * N / 2],
            z: [[0; N]; COLUMNS],
            r: [[0; N]; ROWS],
            correction: [[0; N]; ROWS],
            valid: [false; COLUMNS + ROWS],
            hints: [false; ROWS * N],
            challenge: [0; 48],
        }
    }
}

fn random_bytes(bytes: &mut [u8]) -> Result<()> {
    getrandom::getrandom(bytes).map_err(|_| SigningError::Randomness)
}

fn fill_uniform(polynomial: &mut [u32]) -> Result<()> {
    for coefficient in polynomial {
        loop {
            let mut bytes = [0; 4];
            random_bytes(&mut bytes)?;
            let candidate = u32::from_le_bytes(bytes) & 0x7f_ffff;
            if candidate < Q {
                *coefficient = candidate;
                break;
            }
        }
    }
    Ok(())
}

fn append_bytes(bits: &mut Vec<bool>, bytes: &[u8]) {
    for byte in bytes {
        append_word(bits, u32::from(*byte), 8);
    }
}

fn append_word(bits: &mut Vec<bool>, word: u32, width: usize) {
    for index in 0..width {
        bits.push(word >> index & 1 == 1);
    }
}

fn append_polynomial(bits: &mut Vec<bool>, polynomial: &Polynomial) {
    for value in polynomial {
        append_word(bits, *value, 23);
    }
}

fn decode_polynomial(bytes: &[u8], offset: usize) -> Result<Polynomial> {
    let mut polynomial = [0; N];
    for (index, value) in polynomial.iter_mut().enumerate() {
        for bit in 0..23 {
            let position = offset + index * 23 + bit;
            *value |= u32::from((bytes[position / 8] >> (position % 8)) & 1) << bit;
        }
        if *value >= Q {
            return Err(SigningError::CircuitOutput);
        }
    }
    Ok(polynomial)
}

fn packed_bit(bytes: &[u8], bit: usize) -> bool {
    bytes[bit / 8] >> (bit % 8) & 1 == 1
}

fn encode_accepted_signature(
    candidate: &Candidate,
    a_share: &[u8],
) -> Result<[u8; SIGNATURE_BYTES]> {
    let mut signature = [0; SIGNATURE_BYTES];
    signature[..48].copy_from_slice(&candidate.challenge);
    for column in 0..COLUMNS {
        for index in 0..N {
            let coefficient = column * N + index;
            let start = coefficient * 4;
            let a = u32::from_le_bytes(
                a_share[start..start + 4]
                    .try_into()
                    .expect("validated accepted share size"),
            );
            if a >= Q {
                return Err(SigningError::MessageEncoding);
            }
            let value = add_mod(a, candidate.z[column][index]);
            let centered = if value <= Q / 2 {
                i64::from(value)
            } else {
                i64::from(value) - i64::from(Q)
            };
            if centered.unsigned_abs() >= u64::from(GAMMA1 - BETA) {
                return Err(SigningError::SignatureEncoding);
            }
            let encoded = (i64::from(GAMMA1) - centered) as u32;
            for bit in 0..20 {
                let position = coefficient * 20 + bit;
                signature[48 + position / 8] |= ((encoded >> bit) as u8 & 1) << (position % 8);
            }
        }
    }
    let a_hints = &a_share[COLUMNS * N * 4..];
    let mut count = 0;
    for row in 0..ROWS {
        for index in 0..N {
            let bit = row * N + index;
            if candidate.hints[bit] ^ packed_bit(a_hints, bit) {
                if count == 55 {
                    return Err(SigningError::SignatureEncoding);
                }
                signature[3248 + count] = index as u8;
                count += 1;
            }
        }
        signature[3303 + row] = count as u8;
    }
    Ok(signature)
}
