//! Reference message-bound nonce signing. Available only with `benchmarks`.
//! The deployed prepared signer lives in `super::prepared_signing::gmw`.
use super::*;
use crate::runtime::{begin_evaluator, begin_garbler, RuntimeOutput, Step, TrustedMlDsaSchedule};

const BINDING_BYTES: usize = 73;
const BINDING_MAGIC: &[u8; 8] = b"MLDSAS01";

/// FIPS signing randomness policy for this investigation operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SigningMode {
    /// Both roles contribute zero to FIPS rnd. Used for exact reference checks.
    Deterministic,
    /// Both roles independently draw 32 bytes. Their XOR stays inside 2PC.
    JointRandom,
}

/// One fixed signing circuit. Nonces enter ExpandMask as public inputs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SigningKernel {
    /// K and joint rnd to shared rho-double-prime.
    SigningSeed,
    /// One shared mask polynomial.
    ExpandMask,
    /// One shared commitment's high bits.
    CommitmentHighBits,
    /// Shared encoded high bits to a public challenge hash.
    CommitmentHash,
    /// One private response norm check.
    ResponseCheck,
    /// One private low/correction check and masked hints.
    RowCheckAndHints,
    /// Private checks and hint count to one public acceptance bit.
    AggregateCheck,
}

impl SigningKernel {
    /// Complete circuit set that both adapters load before an operation.
    pub const ALL: [Self; 7] = [
        Self::SigningSeed,
        Self::ExpandMask,
        Self::CommitmentHighBits,
        Self::CommitmentHash,
        Self::ResponseCheck,
        Self::RowCheckAndHints,
        Self::AggregateCheck,
    ];

    /// Returns the schedule filename stem used by both adapters.
    pub const fn name(self) -> &'static str {
        match self {
            Self::SigningSeed => "signing-seed",
            Self::ExpandMask => "signing-mask",
            Self::CommitmentHighBits => "commitment-high",
            Self::CommitmentHash => "commitment-hash",
            Self::ResponseCheck => "response-check",
            Self::RowCheckAndHints => "row-check",
            Self::AggregateCheck => "aggregate-check",
        }
    }

    /// Returns the exact admitted circuit identifier.
    pub const fn circuit_id(self) -> u8 {
        match self {
            Self::SigningSeed => 0x8b,
            Self::ExpandMask => 0x8a,
            Self::CommitmentHighBits => 0x8c,
            Self::CommitmentHash => 0x8d,
            Self::ResponseCheck => 0x8e,
            Self::RowCheckAndHints => 0x8f,
            Self::AggregateCheck => 0x90,
        }
    }

    const fn output_bits(self) -> usize {
        match self {
            Self::SigningSeed => 512,
            Self::ExpandMask => 5888,
            Self::CommitmentHighBits => 1024,
            Self::CommitmentHash => 384,
            Self::ResponseCheck | Self::AggregateCheck => 1,
            Self::RowCheckAndHints => 257,
        }
    }

    const fn is_public(self) -> bool {
        matches!(self, Self::CommitmentHash | Self::AggregateCheck)
    }
}

/// Public operation counters. Every attempted candidate remains in accounting.
#[derive(Default)]
pub struct SigningMetrics {
    /// Public request agreement bytes in each direction.
    pub binding_bytes_per_direction: usize,
    /// Exact metrics for every fresh private circuit invocation.
    pub circuits: Vec<(SigningKernel, CircuitMetrics)>,
    /// Public challenge hash for each candidate, including rejections.
    pub challenge_hashes: Vec<[u8; 48]>,
    /// Final accepted-share message bytes, excluding transport framing.
    pub accepted_share_bytes: usize,
    /// Standard signature return bytes, excluding transport framing.
    pub signature_return_bytes: usize,
}

/// A complete standard signature and public investigation measurements.
pub struct ThresholdSignature {
    /// Standard FIPS encoding. An independent verifier must validate it.
    pub signature: [u8; SIGNATURE_BYTES],
    /// Number of candidates, including the accepted candidate.
    pub attempts: u16,
    /// Complete circuit and final-message accounting.
    pub metrics: SigningMetrics,
}

/// A consuming signing transition. Each adapter supplies only transport and schedules.
pub enum SigningStep {
    /// Execute the requested private circuit through the shared runtime.
    Circuit(SigningCircuit),
    /// Send a public request binding, accepted share, or standard signature.
    Send(SigningSend),
    /// Receive the next exact request-binding or accepted-candidate message.
    Receive(SigningReceive),
    /// Both participants contributed and produced the standard signature.
    Complete(Box<ThresholdSignature>),
}

/// Own private inputs for the next circuit. This request is not cloneable.
pub struct SigningCircuit {
    machine: Box<Machine>,
    kernel: SigningKernel,
    input: Zeroizing<Vec<bool>>,
}

impl SigningCircuit {
    /// Returns the only permitted circuit for this transition.
    pub const fn kernel(&self) -> SigningKernel {
        self.kernel
    }

    /// Starts the existing private runtime with this participant's inputs only.
    pub fn begin<'a>(&self, schedule: &'a TrustedMlDsaSchedule<'a>) -> Result<Step<'a>> {
        if schedule.circuit_id() != self.kernel.circuit_id() {
            return Err(SigningError::Schedule);
        }
        match self.machine.role {
            SigningRole::A => begin_garbler(schedule, &self.input),
            SigningRole::B => begin_evaluator(schedule, &self.input),
        }
        .map_err(|_| SigningError::CircuitRuntime)
    }

    /// Consumes the decoded role output and advances the signing state.
    pub fn accept(self, output: RuntimeOutput) -> Result<SigningStep> {
        self.accept_output(output.output, CircuitMetrics::HalfGates(output.metrics))
    }

    /// Executes the same transition with an investigation-only Boolean engine.
    #[cfg(feature = "benchmarks")]
    pub async fn run_boolean(
        self,
        engine: crate::runtime::boolean_mpc::comparison::Engine,
        schedule: &TrustedMlDsaSchedule<'_>,
        transport: &mut impl crate::runtime::boolean_mpc::Transport,
    ) -> Result<SigningStep> {
        if schedule.circuit_id() != self.kernel.circuit_id() {
            return Err(SigningError::Schedule);
        }
        let output = crate::runtime::boolean_mpc::comparison::run(
            engine,
            self.machine.role,
            schedule,
            &self.input,
            transport,
        )
        .await
        .map_err(|_| SigningError::CircuitRuntime)?;
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
    ) -> Result<SigningStep> {
        let expected_bits = if self.machine.role == SigningRole::A && !self.kernel.is_public() {
            0
        } else {
            self.kernel.output_bits()
        };
        if output.len() != expected_bits.div_ceil(8)
            || (!expected_bits.is_multiple_of(8)
                && output[output.len() - 1] >> (expected_bits % 8) != 0)
        {
            return Err(SigningError::CircuitOutput);
        }
        self.machine.metrics.circuits.push((self.kernel, metrics));
        self.machine.accept_circuit(&output)?;
        self.machine.next()
    }
}

/// One outbound message. Candidate shares leave only after acceptance.
pub struct SigningSend {
    machine: Box<Machine>,
    bytes: Zeroizing<Vec<u8>>,
    next: SendNext,
}

enum SendNext {
    ReceiveBinding,
    StartSigning,
    ReceiveSignature,
    Complete(Box<[u8; SIGNATURE_BYTES]>),
}

impl SigningSend {
    /// Returns the exact next payload.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Advances after the adapter has sent the complete message.
    pub fn resume(self) -> Result<SigningStep> {
        match self.next {
            SendNext::ReceiveBinding => Ok(SigningStep::Receive(SigningReceive {
                machine: self.machine,
                next: ReceiveNext::Binding,
            })),
            SendNext::StartSigning => self.machine.next(),
            SendNext::ReceiveSignature => Ok(SigningStep::Receive(SigningReceive {
                machine: self.machine,
                next: ReceiveNext::Signature,
            })),
            SendNext::Complete(signature) => Ok(self.machine.complete(*signature)),
        }
    }
}

/// One inbound message with an exact schema.
pub struct SigningReceive {
    machine: Box<Machine>,
    next: ReceiveNext,
}

enum ReceiveNext {
    Binding,
    AcceptedShare,
    Signature,
}

impl SigningReceive {
    /// Returns the required exact payload length.
    pub const fn expected_bytes(&self) -> usize {
        match self.next {
            ReceiveNext::Binding => BINDING_BYTES,
            ReceiveNext::AcceptedShare => ACCEPTED_SHARE_BYTES,
            ReceiveNext::Signature => SIGNATURE_BYTES,
        }
    }

    /// Consumes the next peer payload and preserves accepted-only disclosure.
    pub fn accept(self, bytes: &[u8]) -> Result<SigningStep> {
        if bytes.len() != self.expected_bytes() {
            return Err(SigningError::MessageEncoding);
        }
        match self.next {
            ReceiveNext::Binding => {
                let expected_role = match self.machine.role {
                    SigningRole::A => 1,
                    SigningRole::B => 0,
                };
                if &bytes[..8] != BINDING_MAGIC
                    || bytes[8] != expected_role
                    || bytes[9..] != self.machine.request_binding
                {
                    return Err(SigningError::RequestBinding);
                }
                match self.machine.role {
                    SigningRole::A => self.machine.next(),
                    SigningRole::B => Ok(self.machine.send_binding(SendNext::StartSigning)),
                }
            }
            ReceiveNext::Signature => Ok(self
                .machine
                .complete(bytes.try_into().expect("validated standard signature size"))),
            ReceiveNext::AcceptedShare => {
                let signature = encode_accepted_signature(&self.machine.candidate, bytes)?;
                Ok(SigningStep::Send(SigningSend {
                    machine: self.machine,
                    bytes: Zeroizing::new(signature.to_vec()),
                    next: SendNext::Complete(Box::new(signature)),
                }))
            }
        }
    }
}

#[derive(Clone, Copy)]
enum Stage {
    Seed,
    Mask(usize),
    High(usize),
    Hash,
    Response(usize),
    Row(usize),
    Aggregate,
    Accepted,
}

struct Machine {
    role: SigningRole,
    request_binding: [u8; 64],
    own: OwnSigningShare,
    matrix: PublicMatrix,
    twiddles: Polynomial,
    mu: [u8; 64],
    rnd: Zeroizing<[u8; 32]>,
    rho_double_prime: Zeroizing<[u8; 64]>,
    candidate: Zeroizing<Candidate>,
    stage: Stage,
    attempt: u16,
    metrics: SigningMetrics,
}

/// Starts one complete passive signing operation on one participant's shares.
/// Both roles check their public requests before the first private circuit.
/// The caller must authenticate the operation ID and bind it to the wallet,
/// key, material epoch, and trusted circuit set. This exchange is no admission
/// check or durable replay ledger. It requires authenticated peer transport.
pub fn begin_signing(
    role: SigningRole,
    own: OwnSigningShare,
    public_key: &[u8; PUBLIC_KEY_BYTES],
    message: &[u8],
    context: &[u8],
    mode: SigningMode,
    operation_id: &[u8; 32],
) -> Result<SigningStep> {
    let context_length = u8::try_from(context.len()).map_err(|_| SigningError::ContextLength)?;
    let tr: [u8; 64] = shake256(&[public_key]);
    let mu = shake256(&[&tr, &[0, context_length], context, message]);
    let mode_byte = match mode {
        SigningMode::Deterministic => 0,
        SigningMode::JointRandom => 1,
    };
    let request_binding = shake256(&[
        b"seams/ml-dsa-65/signing-request/v1",
        operation_id,
        &mu,
        &[mode_byte],
    ]);
    let mut rnd = Zeroizing::new([0; 32]);
    if mode == SigningMode::JointRandom {
        random_bytes(rnd.as_mut())?;
    }
    let (matrix, _) = expand_a(&public_key[..32]);
    let machine = Box::new(Machine {
        role,
        request_binding,
        own,
        matrix,
        twiddles: ntt_twiddles(),
        mu,
        rnd,
        rho_double_prime: Zeroizing::new([0; 64]),
        candidate: Zeroizing::new(Candidate::empty()),
        stage: Stage::Seed,
        attempt: 1,
        metrics: SigningMetrics {
            binding_bytes_per_direction: BINDING_BYTES,
            ..SigningMetrics::default()
        },
    });
    Ok(match role {
        SigningRole::A => machine.send_binding(SendNext::ReceiveBinding),
        SigningRole::B => SigningStep::Receive(SigningReceive {
            machine,
            next: ReceiveNext::Binding,
        }),
    })
}

impl Machine {
    fn send_binding(self: Box<Self>, next: SendNext) -> SigningStep {
        let mut bytes = Zeroizing::new(Vec::with_capacity(BINDING_BYTES));
        bytes.extend_from_slice(BINDING_MAGIC);
        bytes.push(match self.role {
            SigningRole::A => 0,
            SigningRole::B => 1,
        });
        bytes.extend_from_slice(&self.request_binding);
        SigningStep::Send(SigningSend {
            machine: self,
            bytes,
            next,
        })
    }

    fn next(mut self: Box<Self>) -> Result<SigningStep> {
        if matches!(self.stage, Stage::Accepted) {
            self.metrics.accepted_share_bytes = ACCEPTED_SHARE_BYTES;
            self.metrics.signature_return_bytes = SIGNATURE_BYTES;
            return Ok(match self.role {
                SigningRole::A => {
                    let bytes = accepted_share(&self.candidate);
                    SigningStep::Send(SigningSend {
                        machine: self,
                        bytes,
                        next: SendNext::ReceiveSignature,
                    })
                }
                SigningRole::B => SigningStep::Receive(SigningReceive {
                    machine: self,
                    next: ReceiveNext::AcceptedShare,
                }),
            });
        }
        let mut bits = Zeroizing::new(Vec::new());
        let kernel = match self.stage {
            Stage::Seed => {
                append_bytes(&mut bits, &self.own.k);
                append_bytes(&mut bits, self.rnd.as_slice());
                if self.role == SigningRole::A {
                    append_bytes(&mut bits, &self.mu);
                    random_bytes(self.rho_double_prime.as_mut())?;
                    append_bytes(&mut bits, self.rho_double_prime.as_slice());
                }
                SigningKernel::SigningSeed
            }
            Stage::Mask(index) => {
                append_bytes(&mut bits, self.rho_double_prime.as_slice());
                if self.role == SigningRole::A {
                    fill_uniform(&mut self.candidate.y[index])?;
                    append_polynomial(&mut bits, &self.candidate.y[index]);
                    let nonce = (self.attempt - 1) * COLUMNS as u16 + index as u16;
                    append_word(&mut bits, u32::from(nonce), 16);
                }
                SigningKernel::ExpandMask
            }
            Stage::High(row) => {
                append_polynomial(&mut bits, &self.candidate.w[row]);
                if self.role == SigningRole::A {
                    let mask = &mut self.candidate.high[row * 128..(row + 1) * 128];
                    random_bytes(mask)?;
                    append_bytes(&mut bits, mask);
                }
                SigningKernel::CommitmentHighBits
            }
            Stage::Hash => {
                append_bytes(&mut bits, &self.candidate.high);
                if self.role == SigningRole::A {
                    append_bytes(&mut bits, &self.mu);
                }
                SigningKernel::CommitmentHash
            }
            Stage::Response(index) => {
                append_polynomial(&mut bits, &self.candidate.z[index]);
                if self.role == SigningRole::A {
                    let mut mask = [0];
                    random_bytes(&mut mask)?;
                    self.candidate.valid[index] = mask[0] & 1 == 1;
                    bits.push(self.candidate.valid[index]);
                }
                SigningKernel::ResponseCheck
            }
            Stage::Row(row) => {
                append_polynomial(&mut bits, &self.candidate.r[row]);
                append_polynomial(&mut bits, &self.candidate.correction[row]);
                if self.role == SigningRole::A {
                    let mut masks = Zeroizing::new([0; 33]);
                    random_bytes(masks.as_mut())?;
                    self.candidate.valid[COLUMNS + row] = masks[0] & 1 == 1;
                    bits.push(self.candidate.valid[COLUMNS + row]);
                    for index in 0..N {
                        let hint = packed_bit(&masks[1..], index);
                        self.candidate.hints[row * N + index] = hint;
                        bits.push(hint);
                    }
                }
                SigningKernel::RowCheckAndHints
            }
            Stage::Aggregate => {
                bits.extend_from_slice(&self.candidate.valid);
                bits.extend_from_slice(&self.candidate.hints);
                bits.resize(1664, false);
                SigningKernel::AggregateCheck
            }
            Stage::Accepted => unreachable!("accepted state returns before circuit construction"),
        };
        Ok(SigningStep::Circuit(SigningCircuit {
            machine: self,
            kernel,
            input: bits,
        }))
    }

    fn accept_circuit(&mut self, output: &[u8]) -> Result<()> {
        self.stage = match self.stage {
            Stage::Seed => {
                if self.role == SigningRole::B {
                    self.rho_double_prime.copy_from_slice(output);
                }
                self.rnd.zeroize();
                Stage::Mask(0)
            }
            Stage::Mask(index) => {
                if self.role == SigningRole::B {
                    self.candidate.y[index] = decode_polynomial(output, 0)?;
                }
                if index + 1 == COLUMNS {
                    self.candidate.w =
                        matrix_product_plus_error(&self.matrix, &self.candidate.y, &self.twiddles);
                    Stage::High(0)
                } else {
                    Stage::Mask(index + 1)
                }
            }
            Stage::High(row) => {
                if self.role == SigningRole::B {
                    self.candidate.high[row * 128..(row + 1) * 128].copy_from_slice(output);
                }
                if row + 1 == ROWS {
                    Stage::Hash
                } else {
                    Stage::High(row + 1)
                }
            }
            Stage::Hash => {
                self.candidate.challenge.copy_from_slice(output);
                self.metrics.challenge_hashes.push(self.candidate.challenge);
                self.compute_responses();
                Stage::Response(0)
            }
            Stage::Response(index) => {
                if self.role == SigningRole::B {
                    self.candidate.valid[index] = output[0] == 1;
                }
                if index + 1 == COLUMNS {
                    Stage::Row(0)
                } else {
                    Stage::Response(index + 1)
                }
            }
            Stage::Row(row) => {
                if self.role == SigningRole::B {
                    self.candidate.valid[COLUMNS + row] = packed_bit(output, 0);
                    for index in 0..N {
                        self.candidate.hints[row * N + index] = packed_bit(output, index + 1);
                    }
                }
                if row + 1 == ROWS {
                    Stage::Aggregate
                } else {
                    Stage::Row(row + 1)
                }
            }
            Stage::Aggregate => {
                if output[0] == 1 {
                    Stage::Accepted
                } else {
                    if self.attempt == MAX_ATTEMPTS {
                        return Err(SigningError::AttemptLimit);
                    }
                    self.candidate.zeroize();
                    self.attempt += 1;
                    Stage::Mask(0)
                }
            }
            Stage::Accepted => return Err(SigningError::CircuitOutput),
        };
        Ok(())
    }

    fn compute_responses(&mut self) {
        let challenge_ntt = ntt(sample_in_ball(&self.candidate.challenge), &self.twiddles);
        for column in 0..COLUMNS {
            let product = Zeroizing::new(product_from_ntt(
                &challenge_ntt,
                &self.own.polynomial_ntt[column],
                &self.twiddles,
            ));
            for index in 0..N {
                self.candidate.z[column][index] =
                    add_mod(self.candidate.y[column][index], product[index]);
            }
        }
        for row in 0..ROWS {
            let s2_product = Zeroizing::new(product_from_ntt(
                &challenge_ntt,
                &self.own.polynomial_ntt[COLUMNS + row],
                &self.twiddles,
            ));
            self.candidate.correction[row] = product_from_ntt(
                &challenge_ntt,
                &self.own.polynomial_ntt[COLUMNS + ROWS + row],
                &self.twiddles,
            );
            for index in 0..N {
                self.candidate.r[row][index] =
                    subtract_mod(self.candidate.w[row][index], s2_product[index]);
            }
        }
        self.candidate.y.zeroize();
        self.candidate.w.zeroize();
        self.candidate.high.zeroize();
    }

    fn complete(mut self: Box<Self>, signature: [u8; SIGNATURE_BYTES]) -> SigningStep {
        SigningStep::Complete(Box::new(ThresholdSignature {
            signature,
            attempts: self.attempt,
            metrics: core::mem::take(&mut self.metrics),
        }))
    }
}

fn accepted_share(candidate: &Candidate) -> Zeroizing<Vec<u8>> {
    let mut bytes = Zeroizing::new(Vec::with_capacity(ACCEPTED_SHARE_BYTES));
    for polynomial in &candidate.z {
        for coefficient in polynomial {
            bytes.extend_from_slice(&coefficient.to_le_bytes());
        }
    }
    let hint_start = bytes.len();
    bytes.resize(ACCEPTED_SHARE_BYTES, 0);
    for (index, hint) in candidate.hints.iter().enumerate() {
        bytes[hint_start + index / 8] |= u8::from(*hint) << (index % 8);
    }
    bytes
}
