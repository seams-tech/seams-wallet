//! Resumable canonical key generation with role-private material outputs.

use core::fmt;
use zeroize::{Zeroize, Zeroizing};

use super::arithmetic::{
    encode_public_key, expand_a, matrix_product_plus_error, ntt_twiddles, Polynomial, SecretVector,
    COLUMNS, N, ROWS,
};
use super::{
    append_bytes, append_polynomial, append_word, decode_polynomial, fill_uniform, SigningRole,
    MATERIAL_BYTES, PUBLIC_KEY_BYTES,
};
use crate::passive::ml_dsa_runtime::{
    begin_evaluator, begin_garbler, RuntimeMetrics, RuntimeOutput, Step, TrustedMlDsaSchedule,
};

/// Fixed canonical key-generation circuit set.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeygenKernel {
    /// XOR seed shares to public rho and masked rho-prime/K outputs.
    Seed,
    /// Shared rho-prime and public nonce to masked eta=4 samples.
    Sampling,
    /// Shared A*s1+s2 to public high bits and masked low bits.
    Rounding,
}

impl KeygenKernel {
    /// All key-generation schedules, loaded once per operation.
    pub const ALL: [Self; 3] = [Self::Seed, Self::Sampling, Self::Rounding];

    /// Returns the public schedule filename stem.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Seed => "seed",
            Self::Sampling => "sampling",
            Self::Rounding => "rounding",
        }
    }

    /// Returns the only admitted circuit identifier.
    pub const fn circuit_id(self) -> u8 {
        match self {
            Self::Seed => 0x87,
            Self::Sampling => 0x88,
            Self::Rounding => 0x89,
        }
    }

    const fn output_bits(self, role: SigningRole) -> usize {
        match (self, role) {
            (Self::Seed, SigningRole::A) => 256,
            (Self::Seed, SigningRole::B) => 1024,
            (Self::Sampling, SigningRole::A) => 1,
            (Self::Sampling, SigningRole::B) => 5889,
            (Self::Rounding, SigningRole::A) => 2560,
            (Self::Rounding, SigningRole::B) => 8448,
        }
    }
}

/// Recoverable failures at the key-generation boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeygenError {
    /// A pinned schedule has the wrong circuit identity.
    Schedule,
    /// The private runtime rejected its inputs or a protocol message.
    CircuitRuntime,
    /// An output violates its role's exact encoding.
    CircuitOutput,
    /// The fixed canonical sample prefix has fewer than 256 accepted values.
    SamplerPrefix,
    /// The operating-system random source failed.
    Randomness,
}

impl fmt::Display for KeygenError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "experimental ML-DSA key generation failed: {self:?}"
        )
    }
}
impl core::error::Error for KeygenError {}
type Result<T> = core::result::Result<T, KeygenError>;

/// One role's standard public key and private persistent-share encoding.
pub struct KeygenOutput {
    /// Ordinary FIPS ML-DSA-65 public-key bytes.
    pub public_key: [u8; PUBLIC_KEY_BYTES],
    /// Only this role's seed, K, s1, s2, and t0 shares. Wiped when dropped.
    pub own_material: Zeroizing<Vec<u8>>,
    /// Public measurements for all eighteen circuit invocations.
    pub circuits: Vec<(KeygenKernel, usize, RuntimeMetrics)>,
}

/// Each role advances only through the prescribed private circuit sequence.
pub enum KeygenStep {
    /// Execute one private circuit with this role's inputs.
    Circuit(KeygenCircuit),
    /// The canonical public key and this role's private material are complete.
    Complete(Box<KeygenOutput>),
}

/// A consuming request for one private key-generation circuit.
pub struct KeygenCircuit {
    machine: Box<Machine>,
    kernel: KeygenKernel,
    ordinal: usize,
    input: Zeroizing<Vec<bool>>,
}

impl KeygenCircuit {
    /// Returns the exact circuit required by this transition.
    pub const fn kernel(&self) -> KeygenKernel {
        self.kernel
    }

    /// Returns the public polynomial ordinal within this stage.
    pub const fn ordinal(&self) -> usize {
        self.ordinal
    }

    /// Starts the shared runtime with this role's private inputs only.
    pub fn begin<'a>(&self, schedule: &'a TrustedMlDsaSchedule<'a>) -> Result<Step<'a>> {
        if schedule.circuit_id() != self.kernel.circuit_id() {
            return Err(KeygenError::Schedule);
        }
        match self.machine.role {
            SigningRole::A => begin_garbler(schedule, &self.input),
            SigningRole::B => begin_evaluator(schedule, &self.input),
        }
        .map_err(|_| KeygenError::CircuitRuntime)
    }

    /// Consumes the permitted output and advances without revealing other shares.
    pub fn accept(mut self, output: RuntimeOutput) -> Result<KeygenStep> {
        let bits = self.kernel.output_bits(self.machine.role);
        if output.output.len() != bits.div_ceil(8)
            || (!bits.is_multiple_of(8)
                && output.output[output.output.len() - 1] >> (bits % 8) != 0)
        {
            return Err(KeygenError::CircuitOutput);
        }
        self.machine
            .circuits
            .push((self.kernel, self.ordinal, output.metrics));
        self.machine.accept_circuit(&output.output)?;
        self.machine.next()
    }
}

#[derive(Zeroize)]
struct PrivateMaterial {
    seed: [u8; 32],
    rho_prime: [u8; 64],
    k: [u8; 32],
    samples: SecretVector,
    t: [Polynomial; ROWS],
    t0: [Polynomial; ROWS],
}

#[derive(Clone, Copy)]
enum Stage {
    Seed,
    Sampling(usize),
    Rounding(usize),
    Complete,
}

struct Machine {
    role: SigningRole,
    private: Zeroizing<PrivateMaterial>,
    rho: [u8; 32],
    t1: [Polynomial; ROWS],
    stage: Stage,
    circuits: Vec<(KeygenKernel, usize, RuntimeMetrics)>,
}

/// Starts canonical generation from exactly one role's 32-byte contribution.
/// Each server must draw its own independent contribution for a fresh joint seed.
pub fn begin_keygen(role: SigningRole, own_seed_share: &[u8; 32]) -> Result<KeygenStep> {
    Box::new(Machine {
        role,
        private: Zeroizing::new(PrivateMaterial {
            seed: *own_seed_share,
            rho_prime: [0; 64],
            k: [0; 32],
            samples: [[0; N]; COLUMNS + ROWS],
            t: [[0; N]; ROWS],
            t0: [[0; N]; ROWS],
        }),
        rho: [0; 32],
        t1: [[0; N]; ROWS],
        stage: Stage::Seed,
        circuits: Vec::with_capacity(18),
    })
    .next()
}

impl Machine {
    fn next(mut self: Box<Self>) -> Result<KeygenStep> {
        let mut input = Zeroizing::new(Vec::new());
        let (kernel, ordinal) = match self.stage {
            Stage::Seed => {
                append_bytes(&mut input, &self.private.seed);
                if self.role == SigningRole::A {
                    super::random_bytes(&mut self.private.rho_prime)
                        .map_err(|_| KeygenError::Randomness)?;
                    super::random_bytes(&mut self.private.k)
                        .map_err(|_| KeygenError::Randomness)?;
                    append_bytes(&mut input, &self.private.rho_prime);
                    append_bytes(&mut input, &self.private.k);
                }
                (KeygenKernel::Seed, 0)
            }
            Stage::Sampling(index) => {
                append_bytes(&mut input, &self.private.rho_prime);
                if self.role == SigningRole::A {
                    fill_uniform(&mut self.private.samples[index])
                        .map_err(|_| KeygenError::Randomness)?;
                    append_polynomial(&mut input, &self.private.samples[index]);
                    append_word(&mut input, index as u32, 16);
                }
                (KeygenKernel::Sampling, index)
            }
            Stage::Rounding(row) => {
                append_polynomial(&mut input, &self.private.t[row]);
                if self.role == SigningRole::A {
                    fill_uniform(&mut self.private.t0[row]).map_err(|_| KeygenError::Randomness)?;
                    append_polynomial(&mut input, &self.private.t0[row]);
                }
                (KeygenKernel::Rounding, row)
            }
            Stage::Complete => {
                let public_key = encode_public_key(&self.rho, &self.t1)
                    .map_err(|_| KeygenError::CircuitOutput)?;
                let mut material = Zeroizing::new(Vec::with_capacity(MATERIAL_BYTES));
                material.extend_from_slice(&self.private.seed);
                material.extend_from_slice(&self.private.k);
                for polynomial in self.private.samples.iter().chain(&self.private.t0) {
                    for coefficient in polynomial {
                        material.extend_from_slice(&coefficient.to_le_bytes());
                    }
                }
                return Ok(KeygenStep::Complete(Box::new(KeygenOutput {
                    public_key,
                    own_material: material,
                    circuits: core::mem::take(&mut self.circuits),
                })));
            }
        };
        Ok(KeygenStep::Circuit(KeygenCircuit {
            machine: self,
            kernel,
            ordinal,
            input,
        }))
    }

    fn accept_circuit(&mut self, output: &[u8]) -> Result<()> {
        self.stage = match self.stage {
            Stage::Seed => {
                self.rho.copy_from_slice(&output[..32]);
                if self.role == SigningRole::B {
                    self.private.rho_prime.copy_from_slice(&output[32..96]);
                    self.private.k.copy_from_slice(&output[96..128]);
                }
                Stage::Sampling(0)
            }
            Stage::Sampling(index) => {
                if output[0] & 1 != 1 {
                    return Err(KeygenError::SamplerPrefix);
                }
                if self.role == SigningRole::B {
                    self.private.samples[index] =
                        decode_polynomial(output, 1).map_err(|_| KeygenError::CircuitOutput)?;
                }
                if index + 1 == COLUMNS + ROWS {
                    self.private.rho_prime.zeroize();
                    let (matrix, _) = expand_a(&self.rho);
                    self.private.t =
                        matrix_product_plus_error(&matrix, &self.private.samples, &ntt_twiddles());
                    Stage::Rounding(0)
                } else {
                    Stage::Sampling(index + 1)
                }
            }
            Stage::Rounding(row) => {
                for index in 0..N {
                    let mut value = 0;
                    for bit in 0..10 {
                        let position = index * 10 + bit;
                        value |= u32::from((output[position / 8] >> (position % 8)) & 1) << bit;
                    }
                    self.t1[row][index] = value;
                }
                if self.role == SigningRole::B {
                    self.private.t0[row] = decode_polynomial(output, N * 10)
                        .map_err(|_| KeygenError::CircuitOutput)?;
                }
                if row + 1 == ROWS {
                    Stage::Complete
                } else {
                    Stage::Rounding(row + 1)
                }
            }
            Stage::Complete => return Err(KeygenError::CircuitOutput),
        };
        Ok(())
    }
}
