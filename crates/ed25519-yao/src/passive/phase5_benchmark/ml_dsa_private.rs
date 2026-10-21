//! Host I/O and wall-clock adapter for the resumable private ML-DSA runtime.
//!
//! Crypto, fixed schemas, and role output ownership live in ml_dsa_runtime.
//! This adapter trusts locally compiled schedules. Deployed adapters must pin
//! their expected digest separately. It provides no production admission.
//! Timing method 2 sums synchronous gate transitions separately from table I/O.
//! Table buffer counts include the existing eight-byte envelope.

use super::super::ml_dsa_runtime::{
    begin_evaluator, begin_garbler, MessageKind, RuntimeError, RuntimeMetrics, RuntimePhase, Step,
    TrustedMlDsaSchedule, TABLE_PAYLOAD_BYTES,
};
use core::fmt;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    time::Instant,
};
use zeroize::Zeroizing;

/// Failure from the core runtime or the host transport.
#[derive(Debug)]
pub enum PrivateBenchmarkError {
    /// The resumable runtime rejected an input or protocol transition.
    Runtime(RuntimeError),
    /// The host reader or writer failed.
    Io(std::io::Error),
}
impl fmt::Display for PrivateBenchmarkError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Runtime(error) => error.fmt(formatter),
            Self::Io(error) => error.fmt(formatter),
        }
    }
}
impl std::error::Error for PrivateBenchmarkError {}
impl From<RuntimeError> for PrivateBenchmarkError {
    fn from(error: RuntimeError) -> Self {
        Self::Runtime(error)
    }
}
impl From<std::io::Error> for PrivateBenchmarkError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}
type Result<T> = std::result::Result<T, PrivateBenchmarkError>;

/// A locally compiled private schedule used by the host investigation harness.
pub struct PrivateKernelSchedule<'a> {
    inner: TrustedMlDsaSchedule<'a>,
}
impl<'a> PrivateKernelSchedule<'a> {
    /// Validates the local artifact against its complete locally calculated digest.
    pub fn parse(bytes: &'a [u8]) -> Result<Self> {
        let digest: [u8; 32] = Sha256::digest(bytes).into();
        Ok(Self {
            inner: TrustedMlDsaSchedule::parse(bytes, digest)?,
        })
    }
    /// Returns the exact A input bit count.
    pub const fn garbler_input_bits(&self) -> usize {
        self.inner.garbler_input_bits()
    }
    /// Returns the exact B input bit count.
    pub const fn evaluator_input_bits(&self) -> usize {
        self.inner.evaluator_input_bits()
    }
    /// Returns the full packed B output bit count.
    pub const fn evaluator_output_bits(&self) -> usize {
        self.inner.evaluator_output_bits()
    }
}

/// Host measurements from one separated role with genuine passive OT.
#[derive(Debug)]
pub struct PrivateRoleMetrics {
    /// AND-table payload bytes in the A-to-B direction.
    pub table_bytes: usize,
    /// Number of bounded table frames.
    pub frame_count: usize,
    /// Exact A-to-B bytes, including OT, input labels, and output translations.
    pub garbler_to_evaluator_wire_bytes: usize,
    /// Exact B-to-A bytes, including OT and declared public outputs.
    pub evaluator_to_garbler_wire_bytes: usize,
    /// All four encoded OT flights across both directions.
    pub ot_wire_bytes: usize,
    /// A's selected direct input labels.
    pub direct_label_bytes: usize,
    /// Packed zero-label permutation bits delivered only to B.
    pub output_translation_bytes: usize,
    /// Ordinary declared public result bytes returned by B.
    pub public_return_bytes: usize,
    /// Actual reusable wire arena capacity times its element size.
    pub label_arena_allocation_bytes: usize,
    /// Largest table message buffer, including its eight-byte envelope.
    pub table_buffer_allocation_bytes: usize,
    /// Largest encoded control-flight or direct-label allocation.
    pub largest_control_buffer_bytes: usize,
    /// Public schedule bytes held outside the arena.
    pub schedule_bytes: usize,
    /// Wall duration before the first gate transition or table request.
    pub setup_wall_ns: u128,
    /// Sum of synchronous gate-transition durations, excluding transport I/O.
    pub gate_compute_wall_ns: u128,
    /// Measured table I/O duration.
    pub table_io_wall_ns: u128,
    /// Complete role duration, excluding schedule parsing and process startup.
    pub role_wall_ns: u128,
    /// Public binding of the fresh nonce, schedule identity, and gate domain.
    pub execution_binding_sha256: [u8; 32],
}

/// Role result from this investigation-only execution boundary.
pub struct PrivateKernelEvaluation {
    /// A receives declared public bytes only, or an empty result for ExpandMask.
    /// B receives its full packed output.
    /// The benchmark recipient may inspect B's public-fixture shares separately.
    pub output: Zeroizing<Vec<u8>>,
    /// Exact transport and host resource measurements.
    pub metrics: PrivateRoleMetrics,
}

/// Drives A's resumable role with only A's fixed-schema fixture inputs.
pub fn garble_private_fixture<R: Read, W: Write>(
    schedule: &PrivateKernelSchedule<'_>,
    bits: &[bool],
    reader: R,
    writer: W,
) -> Result<PrivateKernelEvaluation> {
    let started = Instant::now();
    let step = begin_garbler(&schedule.inner, bits)?;
    drive(step, Role::A, reader, writer, started)
}

/// Drives B's resumable role with only B's fixed-schema fixture inputs.
pub fn evaluate_private_fixture<R: Read, W: Write>(
    schedule: &PrivateKernelSchedule<'_>,
    bits: &[bool],
    reader: R,
    writer: W,
) -> Result<PrivateKernelEvaluation> {
    let started = Instant::now();
    let step = begin_evaluator(&schedule.inner, bits)?;
    drive(step, Role::B, reader, writer, started)
}

#[derive(Clone, Copy)]
enum Role {
    A,
    B,
}
enum SetupTiming {
    Running,
    Complete(u128),
}
struct Timings {
    setup: SetupTiming,
    gate_compute_ns: u128,
    table_io_ns: u128,
}
impl Timings {
    fn begin(&mut self, phase: RuntimePhase, started: Instant) {
        if phase == RuntimePhase::Gates && matches!(self.setup, SetupTiming::Running) {
            self.setup = SetupTiming::Complete(started.elapsed().as_nanos());
        }
    }
    fn record(&mut self, phase: RuntimePhase, elapsed: u128) {
        if phase == RuntimePhase::Gates {
            self.gate_compute_ns += elapsed;
        }
    }
}
struct InputBuffers {
    control: Zeroizing<Vec<u8>>,
    table: Zeroizing<Vec<u8>>,
}
impl InputBuffers {
    fn read<R: Read>(
        &mut self,
        kind: MessageKind,
        length: usize,
        reader: &mut R,
    ) -> std::io::Result<&[u8]> {
        let buffer = if kind == MessageKind::TableFrame {
            &mut self.table
        } else {
            &mut self.control
        };
        if buffer.capacity() < length {
            buffer.reserve_exact(length.saturating_sub(buffer.len()));
        }
        buffer.resize(length, 0);
        reader.read_exact(buffer)?;
        Ok(buffer)
    }
}

fn drive<R: Read, W: Write>(
    mut step: Step<'_>,
    role: Role,
    mut reader: R,
    mut writer: W,
    started: Instant,
) -> Result<PrivateKernelEvaluation> {
    let mut timings = Timings {
        setup: SetupTiming::Running,
        gate_compute_ns: 0,
        table_io_ns: 0,
    };
    let mut buffers = InputBuffers {
        control: Zeroizing::new(Vec::new()),
        table: Zeroizing::new(Vec::with_capacity(TABLE_PAYLOAD_BYTES + 8)),
    };
    let mut sent = 0;
    let mut received = 0;
    loop {
        step = match step {
            Step::Send(outgoing) => {
                let io_started = Instant::now();
                writer.write_all(outgoing.bytes())?;
                writer.flush()?;
                sent += outgoing.bytes().len();
                if outgoing.kind() == MessageKind::TableFrame {
                    timings.table_io_ns += io_started.elapsed().as_nanos();
                }
                let phase = outgoing.resume_phase();
                timings.begin(phase, started);
                let transition_started = Instant::now();
                let step = outgoing.resume()?;
                timings.record(phase, transition_started.elapsed().as_nanos());
                step
            }
            Step::Receive(incoming) => {
                let phase = incoming.phase();
                timings.begin(phase, started);
                let io_started = Instant::now();
                let bytes =
                    buffers.read(incoming.kind(), incoming.expected_bytes(), &mut reader)?;
                received += bytes.len();
                if incoming.kind() == MessageKind::TableFrame {
                    timings.table_io_ns += io_started.elapsed().as_nanos();
                }
                let transition_started = Instant::now();
                let step = incoming.accept(bytes)?;
                timings.record(phase, transition_started.elapsed().as_nanos());
                step
            }
            Step::Complete(result) => {
                let (a_to_b, b_to_a) = match role {
                    Role::A => (sent, received),
                    Role::B => (received, sent),
                };
                if result.metrics.garbler_to_evaluator_wire_bytes != a_to_b
                    || result.metrics.evaluator_to_garbler_wire_bytes != b_to_a
                {
                    return Err(RuntimeError::CounterMismatch.into());
                }
                let metrics = host_metrics(result.metrics, timings, started);
                return Ok(PrivateKernelEvaluation {
                    output: result.output,
                    metrics,
                });
            }
        };
    }
}

fn host_metrics(metrics: RuntimeMetrics, timings: Timings, started: Instant) -> PrivateRoleMetrics {
    let setup_wall_ns = match timings.setup {
        SetupTiming::Complete(elapsed) => elapsed,
        SetupTiming::Running => started.elapsed().as_nanos(),
    };
    PrivateRoleMetrics {
        table_bytes: metrics.table_bytes,
        frame_count: metrics.frame_count,
        garbler_to_evaluator_wire_bytes: metrics.garbler_to_evaluator_wire_bytes,
        evaluator_to_garbler_wire_bytes: metrics.evaluator_to_garbler_wire_bytes,
        ot_wire_bytes: metrics.ot_wire_bytes,
        direct_label_bytes: metrics.direct_label_bytes,
        output_translation_bytes: metrics.output_translation_bytes,
        public_return_bytes: metrics.public_return_bytes,
        label_arena_allocation_bytes: metrics.label_arena_allocation_bytes,
        table_buffer_allocation_bytes: metrics.table_buffer_allocation_bytes,
        largest_control_buffer_bytes: metrics.largest_control_buffer_bytes,
        schedule_bytes: metrics.schedule_bytes,
        setup_wall_ns,
        gate_compute_wall_ns: timings.gate_compute_ns,
        table_io_wall_ns: timings.table_io_ns,
        role_wall_ns: started.elapsed().as_nanos(),
        execution_binding_sha256: metrics.execution_binding_sha256,
    }
}
