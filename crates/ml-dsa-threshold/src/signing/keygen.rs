//! Resumable canonical key generation with role-private material outputs.

use core::fmt;
use zeroize::{Zeroize, Zeroizing};

use super::arithmetic::{
    add_mod, encode_public_key, expand_a, matrix_product_plus_error, ntt_twiddles, subtract_mod,
    Polynomial, SecretVector, COLUMNS, N, Q, ROWS,
};
use super::{
    append_bytes, append_word, fill_uniform, CircuitMetrics, SigningRole, MATERIAL_BYTES,
    PUBLIC_KEY_BYTES,
};
use crate::runtime::{begin_evaluator, begin_garbler, RuntimeOutput, Step, TrustedMlDsaSchedule};

/// Public prefix choice. Only the final bound can terminate with exhaustion.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SamplingPrefix {
    /// Two SHAKE blocks, sufficient for almost every polynomial.
    TwoBlocks,
    /// Same stream extended through three blocks.
    ThreeBlocks,
    /// Same stream extended through the FIPS 481-byte cap.
    FinalBound,
}
impl SamplingPrefix {
    /// Canonical byte count, always from the start of the same stream.
    pub const fn bytes(self) -> usize {
        match self {
            Self::TwoBlocks => 272,
            Self::ThreeBlocks => 408,
            Self::FinalBound => 481,
        }
    }
    const fn public_bits(self) -> usize {
        (self.bytes() * 2).div_ceil(8) * 8
    }
    fn next(self) -> Result<Self> {
        match self {
            Self::TwoBlocks => Ok(Self::ThreeBlocks),
            Self::ThreeBlocks => Ok(Self::FinalBound),
            Self::FinalBound => Err(KeygenError::SamplerPrefix),
        }
    }
}

/// Canonical seed expansion and adaptive public-decision samplers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeygenKernel {
    /// XOR seed shares to public rho and masked rho-prime/K outputs.
    Seed,
    /// Shared rho-prime to public decisions and private candidate shares.
    Sampling(SamplingPrefix),
}
impl KeygenKernel {
    /// All schedules, including both prepared continuation branches.
    pub const ALL: [Self; 4] = [
        Self::Seed,
        Self::Sampling(SamplingPrefix::TwoBlocks),
        Self::Sampling(SamplingPrefix::ThreeBlocks),
        Self::Sampling(SamplingPrefix::FinalBound),
    ];
    /// Public schedule filename stem.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Seed => "seed",
            Self::Sampling(SamplingPrefix::TwoBlocks) => "sampling-two-blocks",
            Self::Sampling(SamplingPrefix::ThreeBlocks) => "sampling-three-blocks",
            Self::Sampling(SamplingPrefix::FinalBound) => "sampling-final-bound",
        }
    }
    /// Exact circuit identifier admitted for this transition.
    pub const fn circuit_id(self) -> u8 {
        match self {
            Self::Seed => 0x87,
            Self::Sampling(SamplingPrefix::TwoBlocks) => 0x93,
            Self::Sampling(SamplingPrefix::ThreeBlocks) => 0x94,
            Self::Sampling(SamplingPrefix::FinalBound) => 0x95,
        }
    }
    const fn output_bits(self, role: SigningRole) -> usize {
        match (self, role) {
            (Self::Seed, SigningRole::A) => 256,
            (Self::Seed, SigningRole::B) => 1024,
            (Self::Sampling(prefix), SigningRole::A) => prefix.public_bits(),
            (Self::Sampling(prefix), SigningRole::B) => {
                prefix.public_bits() + prefix.bytes() * 2 * 23
            }
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
        write!(formatter, "ML-DSA key generation failed: {self:?}")
    }
}
impl core::error::Error for KeygenError {}
type Result<T> = core::result::Result<T, KeygenError>;

/// One role's standard public key and private persistent-share encoding.
pub struct KeygenOutput {
    /// Ordinary FIPS ML-DSA-65 public-key bytes.
    pub public_key: [u8; PUBLIC_KEY_BYTES],
    /// This role's seed/K/s1/s2 shares and additive public t0 encoding. Wiped on drop.
    pub own_material: Zeroizing<Vec<u8>>,
    /// Public measurements for the circuits actually evaluated.
    pub circuits: Vec<(KeygenKernel, usize, CircuitMetrics)>,
}

/// Each role advances only through the prescribed private circuit sequence.
pub enum KeygenStep {
    /// Execute one private circuit with this role's inputs.
    Circuit(KeygenCircuit),
    /// Open t and perform canonical Power2Round outside secure computation.
    OpenPublicT(KeygenPublicT),
    /// The canonical public key and this role's private material are complete.
    Complete(Box<KeygenOutput>),
}

/// Consuming opening of the permitted public t vector on the ordered role channel.
pub struct KeygenPublicT {
    machine: Box<Machine>,
}
impl KeygenPublicT {
    /// Exactly this role's t share with a phase, role, and public-rho binding.
    pub fn own_message(&self) -> Zeroizing<Vec<u8>> {
        let mut message = Zeroizing::new(Vec::with_capacity(41 + ROWS * N * 4));
        message.extend_from_slice(b"MLDSAT01");
        message.push(match self.machine.role {
            SigningRole::A => 0,
            SigningRole::B => 1,
        });
        message.extend_from_slice(&self.machine.rho);
        for polynomial in &self.machine.private.t {
            for value in polynomial {
                message.extend_from_slice(&value.to_le_bytes());
            }
        }
        message
    }
    /// Reconstructs public t, rounds it, and keeps the standard public-key format.
    pub fn accept(mut self, peer: &[u8]) -> Result<KeygenStep> {
        let peer_role = match self.machine.role {
            SigningRole::A => 1,
            SigningRole::B => 0,
        };
        if peer.len() != 41 + ROWS * N * 4
            || &peer[..8] != b"MLDSAT01"
            || peer[8] != peer_role
            || peer[9..41] != self.machine.rho
        {
            return Err(KeygenError::CircuitOutput);
        }
        for row in 0..ROWS {
            for index in 0..N {
                let offset = 41 + (row * N + index) * 4;
                let value = u32::from_le_bytes(
                    peer[offset..offset + 4]
                        .try_into()
                        .map_err(|_| KeygenError::CircuitOutput)?,
                );
                if value >= Q {
                    return Err(KeygenError::CircuitOutput);
                }
                let t = add_mod(self.machine.private.t[row][index], value);
                let high = (t + 4095) >> 13;
                self.machine.t1[row][index] = high;
                self.machine.private.t0[row][index] = match self.machine.role {
                    SigningRole::A => subtract_mod(t, high << 13),
                    SigningRole::B => 0,
                };
            }
        }
        self.machine.private.t.zeroize();
        self.machine.stage = Stage::Complete;
        self.machine.next()
    }
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

    /// Executes this step with one matching, consumed preprocessing item.
    pub async fn run_prepared(
        self,
        prepared: crate::runtime::prepared::PreparedCircuit<'_>,
        transport: &mut impl crate::runtime::prepared::Transport,
    ) -> Result<KeygenStep> {
        if prepared.circuit_id() != self.kernel.circuit_id() || prepared.role() != self.machine.role
        {
            return Err(KeygenError::Schedule);
        }
        let output = prepared
            .run(&self.input, transport)
            .await
            .map_err(|_| KeygenError::CircuitRuntime)?;
        self.accept(output)
    }

    /// Consumes the permitted output and advances without revealing other shares.
    pub fn accept(self, output: RuntimeOutput) -> Result<KeygenStep> {
        self.accept_output(output.output, CircuitMetrics::HalfGates(output.metrics))
    }

    /// Executes the same transition with an investigation-only Boolean engine.
    #[cfg(feature = "benchmarks")]
    pub async fn run_boolean(
        self,
        engine: crate::runtime::boolean_mpc::comparison::Engine,
        schedule: &TrustedMlDsaSchedule<'_>,
        transport: &mut impl crate::runtime::boolean_mpc::Transport,
    ) -> Result<KeygenStep> {
        if schedule.circuit_id() != self.kernel.circuit_id() {
            return Err(KeygenError::Schedule);
        }
        let output = crate::runtime::boolean_mpc::comparison::run(
            engine,
            self.machine.role,
            schedule,
            &self.input,
            transport,
        )
        .await
        .map_err(|_| KeygenError::CircuitRuntime)?;
        self.accept_output(
            output.own_output,
            CircuitMetrics::Boolean {
                engine,
                metrics: output.metrics,
            },
        )
    }

    fn accept_output(
        mut self,
        output: Zeroizing<Vec<u8>>,
        metrics: CircuitMetrics,
    ) -> Result<KeygenStep> {
        let bits = self.kernel.output_bits(self.machine.role);
        if output.len() != bits.div_ceil(8)
            || (!bits.is_multiple_of(8) && output[output.len() - 1] >> (bits % 8) != 0)
        {
            return Err(KeygenError::CircuitOutput);
        }
        self.machine
            .circuits
            .push((self.kernel, self.ordinal, metrics));
        self.machine.accept_circuit(&output)?;
        self.machine.next()
    }
}

#[derive(Zeroize)]
struct PrivateMaterial {
    seed: [u8; 32],
    rho_prime: [u8; 64],
    k: [u8; 32],
    samples: SecretVector,
    candidate_masks: Vec<u32>,
    t: [Polynomial; ROWS],
    t0: [Polynomial; ROWS],
}

#[derive(Clone, Copy)]
enum Stage {
    Seed,
    Sampling {
        index: usize,
        prefix: SamplingPrefix,
    },
    OpenT,
    Complete,
}

struct Machine {
    role: SigningRole,
    private: Zeroizing<PrivateMaterial>,
    rho: [u8; 32],
    t1: [Polynomial; ROWS],
    stage: Stage,
    circuits: Vec<(KeygenKernel, usize, CircuitMetrics)>,
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
            candidate_masks: Vec::new(),
            t: [[0; N]; ROWS],
            t0: [[0; N]; ROWS],
        }),
        rho: [0; 32],
        t1: [[0; N]; ROWS],
        stage: Stage::Seed,
        circuits: Vec::with_capacity(12),
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
            Stage::Sampling { index, prefix } => {
                append_bytes(&mut input, &self.private.rho_prime);
                if self.role == SigningRole::A {
                    self.private.candidate_masks.resize(prefix.bytes() * 2, 0);
                    fill_uniform(&mut self.private.candidate_masks)
                        .map_err(|_| KeygenError::Randomness)?;
                    for value in &self.private.candidate_masks {
                        append_word(&mut input, *value, 23);
                    }
                    append_word(&mut input, index as u32, 16);
                }
                (KeygenKernel::Sampling(prefix), index)
            }
            Stage::OpenT => return Ok(KeygenStep::OpenPublicT(KeygenPublicT { machine: self })),
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
                Stage::Sampling {
                    index: 0,
                    prefix: SamplingPrefix::TwoBlocks,
                }
            }
            Stage::Sampling { index, prefix } => {
                let count = prefix.bytes() * 2;
                // Padding separates public bitmap bytes from private output bits.
                if !count.is_multiple_of(8) && output[count / 8] >> (count % 8) != 0 {
                    return Err(KeygenError::CircuitOutput);
                }
                let mut selected = 0;
                for candidate in 0..count {
                    let accepted = output[candidate / 8] >> (candidate % 8) & 1 == 1;
                    if accepted && selected < N {
                        let value = match self.role {
                            SigningRole::A => self.private.candidate_masks[candidate],
                            SigningRole::B => {
                                let offset = prefix.public_bits() + candidate * 23;
                                let mut value = 0;
                                for bit in 0..23 {
                                    value |= u32::from(
                                        (output[(offset + bit) / 8] >> ((offset + bit) % 8)) & 1,
                                    ) << bit;
                                }
                                if value >= Q {
                                    return Err(KeygenError::CircuitOutput);
                                }
                                value
                            }
                        };
                        self.private.samples[index][selected] = value;
                        selected += 1;
                    }
                }
                self.private.candidate_masks.zeroize();
                if selected != N {
                    self.private.samples[index].zeroize();
                    Stage::Sampling {
                        index,
                        prefix: prefix.next()?,
                    }
                } else if index + 1 == COLUMNS + ROWS {
                    self.private.rho_prime.zeroize();
                    let (matrix, _) = expand_a(&self.rho);
                    self.private.t =
                        matrix_product_plus_error(&matrix, &self.private.samples, &ntt_twiddles());
                    Stage::OpenT
                } else {
                    Stage::Sampling {
                        index: index + 1,
                        prefix: SamplingPrefix::TwoBlocks,
                    }
                }
            }
            Stage::OpenT => return Err(KeygenError::CircuitOutput),
            Stage::Complete => return Err(KeygenError::CircuitOutput),
        };
        Ok(())
    }
}
