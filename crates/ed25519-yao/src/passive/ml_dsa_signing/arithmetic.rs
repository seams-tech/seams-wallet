//! Fixed-size public expansion and linear arithmetic for the investigation.
//!
//! NTT loops use public indices. Modular arithmetic has no target-specific
//! constant-time qualification. Rejection loops consume public hash streams.

use sha3::{
    digest::{ExtendableOutput, Update, XofReader},
    Shake128, Shake256,
};

pub(super) const Q: u32 = 8_380_417;
pub(super) const N: usize = 256;
pub(super) const ROWS: usize = 6;
pub(super) const COLUMNS: usize = 5;

/// One reduced polynomial in the ML-DSA ring.
pub type Polynomial = [u32; N];
/// Five s1 polynomials followed by six s2 polynomials.
pub type SecretVector = [Polynomial; COLUMNS + ROWS];
/// Public matrix coefficients in the NTT representation.
pub type PublicMatrix = [[Polynomial; COLUMNS]; ROWS];

/// Expands the public matrix and counts rejected public candidates.
pub fn expand_a(rho: &[u8]) -> (PublicMatrix, usize) {
    let mut matrix = [[[0; N]; COLUMNS]; ROWS];
    let mut rejected = 0;
    for (row, polynomials) in matrix.iter_mut().enumerate() {
        for (column, polynomial) in polynomials.iter_mut().enumerate() {
            let mut hash = Shake128::default();
            hash.update(rho);
            hash.update(&[column as u8, row as u8]);
            let mut reader = hash.finalize_xof();
            let mut count = 0;
            while count < N {
                let mut bytes = [0; 3];
                reader.read(&mut bytes);
                let candidate = u32::from(bytes[0])
                    | (u32::from(bytes[1]) << 8)
                    | (u32::from(bytes[2] & 0x7f) << 16);
                if candidate < Q {
                    polynomial[count] = candidate;
                    count += 1;
                } else {
                    rejected += 1;
                }
            }
        }
    }
    (matrix, rejected)
}

/// Computes A*s1+s2 on one participant's reduced shares.
pub fn matrix_product_plus_error(
    matrix: &PublicMatrix,
    samples: &SecretVector,
    twiddles: &Polynomial,
) -> [Polynomial; ROWS] {
    let mut s1_ntt = [[0; N]; COLUMNS];
    for column in 0..COLUMNS {
        s1_ntt[column] = ntt(samples[column], twiddles);
    }
    let mut output = [[0; N]; ROWS];
    for row in 0..ROWS {
        let mut product_ntt = [0; N];
        for (column, s1_polynomial) in s1_ntt.iter().enumerate() {
            for coefficient in 0..N {
                product_ntt[coefficient] = add_mod(
                    product_ntt[coefficient],
                    multiply_mod(matrix[row][column][coefficient], s1_polynomial[coefficient]),
                );
            }
        }
        let product = inverse_ntt(product_ntt, twiddles);
        for coefficient in 0..N {
            output[row][coefficient] =
                add_mod(product[coefficient], samples[COLUMNS + row][coefficient]);
        }
    }
    output
}

/// Returns the fixed powers of the public root of unity.
pub fn ntt_twiddles() -> Polynomial {
    let mut powers = [0; N];
    powers[0] = 1;
    for index in 1..N {
        powers[index] = multiply_mod(powers[index - 1], 1753);
    }
    let mut twiddles = [0; N];
    for (index, twiddle) in twiddles.iter_mut().enumerate().skip(1) {
        *twiddle = powers[usize::from((index as u8).reverse_bits())];
    }
    twiddles
}

pub(super) fn ntt(mut polynomial: Polynomial, twiddles: &Polynomial) -> Polynomial {
    let mut twiddle_index = 0;
    let mut length = N / 2;
    while length > 0 {
        for start in (0..N).step_by(2 * length) {
            twiddle_index += 1;
            let twiddle = twiddles[twiddle_index];
            for index in start..start + length {
                let product = multiply_mod(twiddle, polynomial[index + length]);
                polynomial[index + length] = subtract_mod(polynomial[index], product);
                polynomial[index] = add_mod(polynomial[index], product);
            }
        }
        length /= 2;
    }
    polynomial
}

fn inverse_ntt(mut polynomial: Polynomial, twiddles: &Polynomial) -> Polynomial {
    let mut twiddle_index = N;
    let mut length = 1;
    while length < N {
        for start in (0..N).step_by(2 * length) {
            twiddle_index -= 1;
            let twiddle = Q - twiddles[twiddle_index];
            for index in start..start + length {
                let lower = polynomial[index];
                polynomial[index] = add_mod(lower, polynomial[index + length]);
                polynomial[index + length] =
                    multiply_mod(twiddle, subtract_mod(lower, polynomial[index + length]));
            }
        }
        length *= 2;
    }
    for coefficient in &mut polynomial {
        *coefficient = multiply_mod(*coefficient, 8_347_681);
    }
    polynomial
}

pub(super) fn product_from_ntt(
    public_ntt: &Polynomial,
    own_ntt: &Polynomial,
    twiddles: &Polynomial,
) -> Polynomial {
    let mut product = [0; N];
    for index in 0..N {
        product[index] = multiply_mod(public_ntt[index], own_ntt[index]);
    }
    inverse_ntt(product, twiddles)
}

/// Adds two reduced residues modulo the ML-DSA modulus.
pub fn add_mod(left: u32, right: u32) -> u32 {
    (left + right) % Q
}

/// Subtracts two reduced residues modulo the ML-DSA modulus.
pub fn subtract_mod(left: u32, right: u32) -> u32 {
    (left + Q - right) % Q
}

fn multiply_mod(left: u32, right: u32) -> u32 {
    (u64::from(left) * u64::from(right) % u64::from(Q)) as u32
}

pub(super) fn shake256<const OUTPUT: usize>(parts: &[&[u8]]) -> [u8; OUTPUT] {
    let mut hash = Shake256::default();
    for part in parts {
        hash.update(part);
    }
    let mut output = [0; OUTPUT];
    hash.finalize_xof().read(&mut output);
    output
}

pub(super) fn sample_in_ball(challenge: &[u8; 48]) -> Polynomial {
    let mut hash = Shake256::default();
    hash.update(challenge);
    let mut reader = hash.finalize_xof();
    let mut sign_bytes = [0; 8];
    reader.read(&mut sign_bytes);
    let mut signs = u64::from_le_bytes(sign_bytes);
    let mut polynomial = [0; N];
    for index in N - 49..N {
        let selected = loop {
            let mut byte = [0];
            reader.read(&mut byte);
            if usize::from(byte[0]) <= index {
                break usize::from(byte[0]);
            }
        };
        polynomial[index] = polynomial[selected];
        polynomial[selected] = if signs & 1 == 0 { 1 } else { Q - 1 };
        signs >>= 1;
    }
    polynomial
}
