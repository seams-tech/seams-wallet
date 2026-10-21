//! Resumable investigation-only private ML-DSA circuits.
//!
//! The caller pins the complete schedule digest, provides one role's inputs,
//! and transports exact messages. This module has no I/O, clock, persistence,
//! admission, or transport authentication. It reuses the existing passive OT
//! and half-gate primitives. Each invocation uses fresh random material.

use core::{fmt, mem::size_of};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::ot::{
    BaseChoices, BaseOffer, ExtensionMatrix, MaskedPayloads, MlDsaRoundingOtFamily,
    MlDsaSamplingOtFamily, MlDsaSeedOtFamily, OtError, OtSessionId, ReceiverAwaitBaseChoices,
    ReceiverAwaitMaskedPayloads, ReceiverChoices, ReceiverStart, SenderAwaitExtension,
    SenderPayloads, SenderStart,
};
use super::runtime::{empty_arena, install_inputs, required_wire};
use super::{
    Evaluator, EvaluatorWire, GarbledAndGate, Garbler, GarblerWire, GateOrdinal, GlobalDelta,
    SessionDomain, WireValue, AND_GATE_BYTES, LABEL_BYTES,
};

const SCHEDULE_HEADER_BYTES: usize = 58;
const STREAM_HEADER_BYTES: usize = 80;
const STREAM_MAGIC: &[u8; 8] = b"MLDSAP01";
/// Maximum AND-table payload, excluding its eight-byte length/ordinal envelope.
pub const TABLE_PAYLOAD_BYTES: usize = 65_536;
/// Largest exact control message among the admitted investigation workloads.
pub const MAX_MESSAGE_BYTES: usize = 188_464;

/// Recoverable failures at the fixed runtime boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeError {
    /// The artifact differs from the pinned digest.
    ScheduleDigest,
    /// The artifact uses an unsupported circuit or resource bound.
    ScheduleShape,
    /// The public schedule encoding is malformed.
    ScheduleEncoding,
    /// The role input count differs from the fixed schema.
    InputLength,
    /// A message has the wrong exact length.
    MessageLength,
    /// The session header differs from the expected circuit.
    SessionBinding,
    /// The operating system random source failed.
    Randomness,
    /// The existing passive OT state rejected a message.
    ObliviousTransfer,
    /// A table frame has the wrong ordinal or records.
    TableFrame,
    /// A scheduled wire has no initialized label.
    MissingWire,
    /// A gate index exceeds the half-gate tweak domain.
    GateOrdinal,
    /// A declared public result has an invalid encoding.
    PublicOutput,
    /// Observed runtime messages differ from the fixed byte formula.
    CounterMismatch,
}

impl fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "private ML-DSA runtime failed: {self:?}")
    }
}
impl core::error::Error for RuntimeError {}
type Result<T> = core::result::Result<T, RuntimeError>;

#[derive(Clone, Copy)]
enum Workload {
    Seed,
    Sampling,
    Rounding,
    ExpandMask,
}
impl Workload {
    const fn a_inputs(self) -> usize {
        match self {
            Self::Seed => 1024,
            Self::Sampling | Self::ExpandMask => 6400,
            Self::Rounding => 11776,
        }
    }
    const fn b_inputs(self) -> usize {
        match self {
            Self::Seed => 256,
            Self::Sampling | Self::ExpandMask => 512,
            Self::Rounding => 5888,
        }
    }
    const fn public_bytes(self) -> usize {
        match self {
            Self::Seed => 32,
            Self::Sampling => 1,
            Self::Rounding => 320,
            Self::ExpandMask => 0,
        }
    }
    fn public_output(self, output: &[u8]) -> Zeroizing<Vec<u8>> {
        Zeroizing::new(match self {
            Self::Sampling => vec![output[0] & 1],
            Self::Seed | Self::Rounding => output[..self.public_bytes()].to_vec(),
            Self::ExpandMask => Vec::new(),
        })
    }
}

/// A validated fixed circuit whose exact bytes match the caller's trusted digest.
pub struct TrustedMlDsaSchedule<'a> {
    bytes: &'a [u8],
    digest: [u8; 32],
    workload: Workload,
    width: usize,
    inputs: usize,
    gates: usize,
    outputs: usize,
    slots: usize,
    and_gates: usize,
    records_end: usize,
}
impl<'a> TrustedMlDsaSchedule<'a> {
    /// Checks the complete artifact digest before admitting its fixed topology.
    pub fn parse(bytes: &'a [u8], expected_digest: [u8; 32]) -> Result<Self> {
        let digest: [u8; 32] = Sha256::digest(bytes).into();
        check(digest == expected_digest, RuntimeError::ScheduleDigest)?;
        check(
            bytes.len() >= SCHEDULE_HEADER_BYTES && &bytes[..8] == b"EYAOSC01",
            RuntimeError::ScheduleEncoding,
        )?;
        let width = usize::from(bytes[9]);
        check((1..=4).contains(&width), RuntimeError::ScheduleEncoding)?;
        let inputs = read_u32(&bytes[42..46]);
        let gates = read_u32(&bytes[46..50]);
        let outputs = read_u32(&bytes[50..54]);
        let slots = read_u32(&bytes[54..58]);
        let workload = match (bytes[8], inputs, outputs) {
            (0x87, 1280, 1024) => Workload::Seed,
            (0x88, 6912, 5889) => Workload::Sampling,
            (0x89, 17664, 8448) => Workload::Rounding,
            (0x8a, 6912, 5888) => Workload::ExpandMask,
            _ => return Err(RuntimeError::ScheduleShape),
        };
        check(
            inputs <= slots && slots <= 65536 && gates <= 5_000_000,
            RuntimeError::ScheduleShape,
        )?;
        let records_end = SCHEDULE_HEADER_BYTES + gates * (1 + width * 3);
        check(
            bytes.len() == records_end + outputs * width,
            RuntimeError::ScheduleEncoding,
        )?;
        let mut schedule = Self {
            bytes,
            digest,
            workload,
            width,
            inputs,
            gates,
            outputs,
            slots,
            and_gates: 0,
            records_end,
        };
        let mut initialized = vec![false; slots];
        initialized[..inputs].fill(true);
        for index in 0..gates {
            let gate = schedule.gate(index);
            check(
                gate.left < slots && gate.right < slots && gate.output < slots,
                RuntimeError::ScheduleEncoding,
            )?;
            check(
                initialized[gate.left] && initialized[gate.right],
                RuntimeError::ScheduleEncoding,
            )?;
            match gate.opcode {
                1 => {}
                2 => schedule.and_gates += 1,
                3 => check(gate.left == gate.right, RuntimeError::ScheduleEncoding)?,
                _ => return Err(RuntimeError::ScheduleEncoding),
            }
            initialized[gate.output] = true;
        }
        for slot in schedule.output_slots() {
            check(
                slot < slots && initialized[slot],
                RuntimeError::ScheduleEncoding,
            )?;
        }
        Ok(schedule)
    }
    /// Returns the admitted fixed circuit identifier.
    pub const fn circuit_id(&self) -> u8 {
        self.bytes[8]
    }
    /// Returns the exact A input count.
    pub const fn garbler_input_bits(&self) -> usize {
        self.workload.a_inputs()
    }
    /// Returns the exact B input count.
    pub const fn evaluator_input_bits(&self) -> usize {
        self.workload.b_inputs()
    }
    /// Returns the full B output count, including public bits.
    pub const fn evaluator_output_bits(&self) -> usize {
        self.outputs
    }
    /// Returns the number of AND records in the trusted schedule.
    pub const fn and_gate_count(&self) -> usize {
        self.and_gates
    }
    /// Returns the pinned digest of the complete schedule.
    pub const fn schedule_digest(&self) -> [u8; 32] {
        self.digest
    }
    /// Returns the public schedule byte length.
    pub const fn schedule_bytes(&self) -> usize {
        self.bytes.len()
    }
    fn gate(&self, index: usize) -> Gate {
        let start = SCHEDULE_HEADER_BYTES + index * (1 + self.width * 3);
        let record = &self.bytes[start..start + 1 + self.width * 3];
        Gate {
            opcode: record[0],
            left: read_slot(&record[1..1 + self.width]),
            right: read_slot(&record[1 + self.width..1 + self.width * 2]),
            output: read_slot(&record[1 + self.width * 2..]),
        }
    }
    fn output_slots(&self) -> impl Iterator<Item = usize> + '_ {
        self.bytes[self.records_end..]
            .chunks_exact(self.width)
            .map(read_slot)
    }
}
struct Gate {
    opcode: u8,
    left: usize,
    right: usize,
    output: usize,
}

/// Message identity required by the current state, independent of transport.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageKind {
    /// Fresh gate domain, schedule digest, and session nonce.
    Header,
    /// B sends the fresh base-OT offer.
    BaseOffer,
    /// A sends the fresh base-OT receiver response.
    BaseChoices,
    /// A sends one selected label for each A input.
    DirectLabels,
    /// B sends the IKNP correction matrix.
    ExtensionMatrix,
    /// A sends both OT-masked labels for each B input.
    MaskedPayloads,
    /// A sends one bounded table payload with its length and ordinal.
    TableFrame,
    /// A sends packed output permutation bits only to B.
    OutputTranslation,
    /// B returns declared public bytes only.
    PublicOutput,
}
impl MessageKind {
    fn is_ot(self) -> bool {
        matches!(
            self,
            Self::BaseOffer | Self::BaseChoices | Self::ExtensionMatrix | Self::MaskedPayloads
        )
    }
}
/// Work classification for external timing of one synchronous transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimePhase {
    /// Input label generation and the complete OT setup.
    Setup,
    /// Bounded table generation or evaluation.
    Gates,
    /// Output translation and declared public output processing.
    Output,
}

/// Counts generated by the runtime. Adapters must also count actual transport I/O.
#[derive(Debug, Clone)]
pub struct RuntimeMetrics {
    /// Total AND-table payload bytes.
    pub table_bytes: usize,
    /// Number of table frames.
    pub frame_count: usize,
    /// Total exact A-to-B message bytes.
    pub garbler_to_evaluator_wire_bytes: usize,
    /// Total exact B-to-A message bytes.
    pub evaluator_to_garbler_wire_bytes: usize,
    /// Combined bytes of the four encoded OT flights.
    pub ot_wire_bytes: usize,
    /// Selected A input label bytes.
    pub direct_label_bytes: usize,
    /// Packed permutation bits delivered only to B.
    pub output_translation_bytes: usize,
    /// Declared public result bytes returned to A.
    pub public_return_bytes: usize,
    /// Actual wire arena capacity times its element size.
    pub label_arena_allocation_bytes: usize,
    /// Largest table message, including its eight-byte envelope.
    pub table_buffer_allocation_bytes: usize,
    /// Largest control message length, excluding retained OT state.
    pub largest_control_buffer_bytes: usize,
    /// Public schedule byte length.
    pub schedule_bytes: usize,
    /// Digest of the fresh header that binds this execution.
    pub execution_binding_sha256: [u8; 32],
}
/// A's result contains declared public bytes only. B's result contains its output shares.
pub struct RuntimeOutput {
    /// Permitted role result bytes, wiped when dropped.
    pub output: Zeroizing<Vec<u8>>,
    /// Exact runtime message and arena counters.
    pub metrics: RuntimeMetrics,
}

// Continuations stay inline to avoid a new allocation at every table boundary.
#[allow(clippy::large_enum_variant)]
/// One resumable boundary action for exactly one role.
pub enum Step<'a> {
    /// Transport the exact message, then consume its continuation.
    Send(SendStep<'a>),
    /// Receive the exact message, then consume its continuation.
    Receive(ReceiveStep<'a>),
    /// This role completed with its permitted output and counters.
    Complete(RuntimeOutput),
}
/// An outgoing message and its private consuming continuation.
pub struct SendStep<'a> {
    bytes: Zeroizing<Vec<u8>>,
    kind: MessageKind,
    next: SendNext<'a>,
}
/// An exact incoming message request and its private continuation.
pub struct ReceiveStep<'a> {
    bytes: usize,
    kind: MessageKind,
    next: ReceiveNext<'a>,
}
impl<'a> SendStep<'a> {
    /// Borrows this exact outgoing message.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    /// Returns the message identity required by this state.
    pub const fn kind(&self) -> MessageKind {
        self.kind
    }
    /// Classifies the computation that resume will execute.
    pub fn resume_phase(&self) -> RuntimePhase {
        match &self.next {
            SendNext::GarblerFrame(_) | SendNext::GarblerStart(_) => RuntimePhase::Gates,
            SendNext::Complete(_) | SendNext::GarblerPublic(_) => RuntimePhase::Output,
            _ => RuntimePhase::Setup,
        }
    }
    /// Consumes this outgoing step after the caller transmits its bytes.
    pub fn resume(self) -> Result<Step<'a>> {
        match self.next {
            SendNext::GarblerOffer(setup) => receive(
                MessageKind::BaseOffer,
                4144,
                ReceiveNext::GarblerOffer(setup),
            ),
            SendNext::GarblerDirect(running, sender, direct) => send(
                MessageKind::DirectLabels,
                direct,
                SendNext::GarblerExtension(running, sender),
            ),
            SendNext::GarblerExtension(running, sender) => {
                let length = ot_matrix_bytes(running.common.schedule.workload);
                receive(
                    MessageKind::ExtensionMatrix,
                    length,
                    ReceiveNext::GarblerExtension(running, sender),
                )
            }
            SendNext::GarblerStart(running) => advance_garbler(
                running,
                Zeroizing::new(Vec::with_capacity(TABLE_PAYLOAD_BYTES + 8)),
            ),
            SendNext::GarblerFrame(running) => advance_garbler(running, self.bytes),
            SendNext::GarblerPublic(common) => {
                let bytes = common.schedule.workload.public_bytes();
                if bytes == 0 {
                    complete(common, Zeroizing::new(Vec::new()))
                } else {
                    receive(
                        MessageKind::PublicOutput,
                        bytes,
                        ReceiveNext::GarblerPublic(common),
                    )
                }
            }
            SendNext::EvaluatorChoices(common, receiver) => receive(
                MessageKind::BaseChoices,
                4144,
                ReceiveNext::EvaluatorChoices(common, receiver),
            ),
            SendNext::EvaluatorMasked(common, receiver, direct) => {
                let bytes = ot_masked_bytes(common.schedule.workload);
                receive(
                    MessageKind::MaskedPayloads,
                    bytes,
                    ReceiveNext::EvaluatorMasked(common, receiver, direct),
                )
            }
            SendNext::Complete(output) => Ok(Step::Complete(output)),
        }
    }
}
impl<'a> ReceiveStep<'a> {
    /// Returns the exact incoming message byte count.
    pub const fn expected_bytes(&self) -> usize {
        self.bytes
    }
    /// Returns the message identity required by this state.
    pub const fn kind(&self) -> MessageKind {
        self.kind
    }
    /// Classifies the computation that accept will execute.
    pub fn phase(&self) -> RuntimePhase {
        match &self.next {
            ReceiveNext::EvaluatorTable(_) => RuntimePhase::Gates,
            ReceiveNext::EvaluatorTranslation(_) | ReceiveNext::GarblerPublic(_) => {
                RuntimePhase::Output
            }
            _ => RuntimePhase::Setup,
        }
    }
    /// Consumes this incoming step after validating its exact message length.
    pub fn accept(self, bytes: &[u8]) -> Result<Step<'a>> {
        check(bytes.len() == self.bytes, RuntimeError::MessageLength)?;
        match self.next {
            ReceiveNext::GarblerOffer(mut setup) => {
                setup.running.common.received(self.kind, bytes.len());
                let (sender, choices) = sender_begin(
                    setup.running.common.schedule.workload,
                    setup.running.common.session,
                    bytes,
                    &setup.running.garbler,
                    &setup.running.arena,
                )?;
                send(
                    MessageKind::BaseChoices,
                    choices,
                    SendNext::GarblerDirect(setup.running, sender, setup.direct),
                )
            }
            ReceiveNext::GarblerExtension(mut running, sender) => {
                running.common.received(self.kind, bytes.len());
                let masked = sender_accept(sender, bytes)?;
                send(
                    MessageKind::MaskedPayloads,
                    masked,
                    SendNext::GarblerStart(running),
                )
            }
            ReceiveNext::GarblerPublic(mut common) => {
                common.received(self.kind, bytes.len());
                if matches!(common.schedule.workload, Workload::Sampling) {
                    check(bytes[0] <= 1, RuntimeError::PublicOutput)?;
                }
                complete(common, Zeroizing::new(bytes.to_vec()))
            }
            ReceiveNext::EvaluatorHeader(schedule, choices) => {
                let (domain, session, binding) = parse_header(schedule, bytes)?;
                let mut common = Common::new(schedule, Role::B, domain, session, binding);
                common.received(self.kind, bytes.len());
                let (receiver, offer) = receiver_begin(schedule.workload, session, choices)?;
                send(
                    MessageKind::BaseOffer,
                    offer,
                    SendNext::EvaluatorChoices(common, receiver),
                )
            }
            ReceiveNext::EvaluatorChoices(mut common, receiver) => {
                common.received(self.kind, bytes.len());
                let (receiver, extension) = receiver_accept_choices(receiver, bytes)?;
                let length = common.schedule.garbler_input_bits() * LABEL_BYTES;
                receive(
                    MessageKind::DirectLabels,
                    length,
                    ReceiveNext::EvaluatorDirect(common, receiver, extension),
                )
            }
            ReceiveNext::EvaluatorDirect(mut common, receiver, extension) => {
                common.received(self.kind, bytes.len());
                let mut direct = Vec::with_capacity(common.schedule.inputs);
                for label in bytes.chunks_exact(LABEL_BYTES) {
                    direct.push(EvaluatorWire::from_secret_bytes(
                        label.try_into().expect("fixed label width"),
                    ));
                }
                send(
                    MessageKind::ExtensionMatrix,
                    extension,
                    SendNext::EvaluatorMasked(common, receiver, direct),
                )
            }
            ReceiveNext::EvaluatorMasked(mut common, receiver, mut inputs) => {
                common.received(self.kind, bytes.len());
                receiver_accept_masked(receiver, bytes, &mut inputs)?;
                let mut arena = empty_arena(common.schedule.slots);
                install_inputs(&mut arena, inputs);
                common.metrics.label_arena_allocation_bytes =
                    arena.capacity() * size_of::<Option<EvaluatorWire>>();
                next_evaluator_frame(EvaluatorRunning {
                    common,
                    arena,
                    gate_index: 0,
                })
            }
            ReceiveNext::EvaluatorTable(mut running) => {
                running.common.received(self.kind, bytes.len());
                evaluate_frame(&mut running, bytes)?;
                next_evaluator_frame(running)
            }
            ReceiveNext::EvaluatorTranslation(mut running) => {
                running.common.received(self.kind, bytes.len());
                let mut output =
                    Zeroizing::new(vec![0_u8; running.common.schedule.outputs.div_ceil(8)]);
                for (index, slot) in running.common.schedule.output_slots().enumerate() {
                    let wire = required_wire(&running.arena, slot)
                        .map_err(|_| RuntimeError::MissingWire)?;
                    let bit =
                        wire.active.selection_bit().0 ^ ((bytes[index / 8] >> (index % 8)) & 1);
                    output[index / 8] |= bit << (index % 8);
                }
                let public_output = running.common.schedule.workload.public_output(&output);
                let mut common = running.common;
                if public_output.is_empty() {
                    complete(common, output)
                } else {
                    common.sent(MessageKind::PublicOutput, public_output.len());
                    let result = finish(common, output)?;
                    Ok(Step::Send(SendStep {
                        bytes: public_output,
                        kind: MessageKind::PublicOutput,
                        next: SendNext::Complete(result),
                    }))
                }
            }
        }
    }
}

#[allow(clippy::large_enum_variant)]
enum SendNext<'a> {
    GarblerOffer(GarblerSetup<'a>),
    GarblerDirect(GarblerRunning<'a>, Sender, Zeroizing<Vec<u8>>),
    GarblerExtension(GarblerRunning<'a>, Sender),
    GarblerStart(GarblerRunning<'a>),
    GarblerFrame(GarblerRunning<'a>),
    GarblerPublic(Common<'a>),
    EvaluatorChoices(Common<'a>, ReceiverBase),
    EvaluatorMasked(Common<'a>, ReceiverMasked, Vec<EvaluatorWire>),
    Complete(RuntimeOutput),
}
#[allow(clippy::large_enum_variant)]
enum ReceiveNext<'a> {
    GarblerOffer(GarblerSetup<'a>),
    GarblerExtension(GarblerRunning<'a>, Sender),
    GarblerPublic(Common<'a>),
    EvaluatorHeader(&'a TrustedMlDsaSchedule<'a>, Zeroizing<Vec<u8>>),
    EvaluatorChoices(Common<'a>, ReceiverBase),
    EvaluatorDirect(Common<'a>, ReceiverMasked, Zeroizing<Vec<u8>>),
    EvaluatorMasked(Common<'a>, ReceiverMasked, Vec<EvaluatorWire>),
    EvaluatorTable(EvaluatorRunning<'a>),
    EvaluatorTranslation(EvaluatorRunning<'a>),
}
struct GarblerSetup<'a> {
    running: GarblerRunning<'a>,
    direct: Zeroizing<Vec<u8>>,
}
struct GarblerRunning<'a> {
    common: Common<'a>,
    garbler: Garbler,
    arena: Vec<Option<GarblerWire>>,
    gate_index: usize,
}
struct EvaluatorRunning<'a> {
    common: Common<'a>,
    arena: Vec<Option<EvaluatorWire>>,
    gate_index: usize,
}
#[derive(Clone, Copy)]
enum Role {
    A,
    B,
}
struct Common<'a> {
    schedule: &'a TrustedMlDsaSchedule<'a>,
    role: Role,
    domain: SessionDomain,
    session: OtSessionId,
    metrics: RuntimeMetrics,
}
impl<'a> Common<'a> {
    fn new(
        schedule: &'a TrustedMlDsaSchedule<'a>,
        role: Role,
        domain: SessionDomain,
        session: OtSessionId,
        binding: [u8; 32],
    ) -> Self {
        Self {
            schedule,
            role,
            domain,
            session,
            metrics: RuntimeMetrics {
                table_bytes: 0,
                frame_count: 0,
                garbler_to_evaluator_wire_bytes: 0,
                evaluator_to_garbler_wire_bytes: 0,
                ot_wire_bytes: 0,
                direct_label_bytes: schedule.garbler_input_bits() * LABEL_BYTES,
                output_translation_bytes: schedule.outputs.div_ceil(8),
                public_return_bytes: schedule.workload.public_bytes(),
                label_arena_allocation_bytes: 0,
                table_buffer_allocation_bytes: 0,
                largest_control_buffer_bytes: 0,
                schedule_bytes: schedule.bytes.len(),
                execution_binding_sha256: binding,
            },
        }
    }
    fn sent(&mut self, kind: MessageKind, bytes: usize) {
        self.record(kind, bytes, matches!(self.role, Role::A));
    }
    fn received(&mut self, kind: MessageKind, bytes: usize) {
        self.record(kind, bytes, matches!(self.role, Role::B));
    }
    fn record(&mut self, kind: MessageKind, bytes: usize, a_to_b: bool) {
        if a_to_b {
            self.metrics.garbler_to_evaluator_wire_bytes += bytes;
        } else {
            self.metrics.evaluator_to_garbler_wire_bytes += bytes;
        }
        if kind.is_ot() {
            self.metrics.ot_wire_bytes += bytes;
        }
        if kind == MessageKind::TableFrame {
            self.metrics.table_buffer_allocation_bytes =
                self.metrics.table_buffer_allocation_bytes.max(bytes);
        } else {
            self.metrics.largest_control_buffer_bytes =
                self.metrics.largest_control_buffer_bytes.max(bytes);
        }
    }
}

/// Starts A with only A's fixed-schema inputs. Fresh randomness never comes from the caller.
pub fn begin_garbler<'a>(
    schedule: &'a TrustedMlDsaSchedule<'a>,
    bits: &[bool],
) -> Result<Step<'a>> {
    check(
        bits.len() == schedule.garbler_input_bits(),
        RuntimeError::InputLength,
    )?;
    let domain = fresh_domain()?;
    let header = fresh_header(schedule, domain)?;
    let (_, session, binding) = parse_header(schedule, &header)?;
    let garbler = Garbler::new(
        GlobalDelta::random().map_err(|_| RuntimeError::Randomness)?,
        domain,
    );
    let inputs =
        GarblerWire::random_batch(schedule.inputs).map_err(|_| RuntimeError::Randomness)?;
    let mut direct = Zeroizing::new(Vec::with_capacity(bits.len() * LABEL_BYTES));
    for (wire, bit) in inputs.iter().zip(bits) {
        garbler
            .encode(wire, WireValue::from_secret_bit(u8::from(*bit)))
            .append_secret_bytes(&mut direct);
    }
    let mut arena = empty_arena(schedule.slots);
    install_inputs(&mut arena, inputs);
    let mut common = Common::new(schedule, Role::A, domain, session, binding);
    common.metrics.label_arena_allocation_bytes =
        arena.capacity() * size_of::<Option<GarblerWire>>();
    let running = GarblerRunning {
        common,
        garbler,
        arena,
        gate_index: 0,
    };
    send(
        MessageKind::Header,
        Zeroizing::new(header),
        SendNext::GarblerOffer(GarblerSetup { running, direct }),
    )
}
/// Starts B with only B's fixed-schema inputs. It first requests A's fresh binding header.
pub fn begin_evaluator<'a>(
    schedule: &'a TrustedMlDsaSchedule<'a>,
    bits: &[bool],
) -> Result<Step<'a>> {
    check(
        bits.len() == schedule.evaluator_input_bits(),
        RuntimeError::InputLength,
    )?;
    receive(
        MessageKind::Header,
        STREAM_HEADER_BYTES,
        ReceiveNext::EvaluatorHeader(schedule, Zeroizing::new(pack_bits(bits))),
    )
}

fn send<'a>(
    kind: MessageKind,
    bytes: Zeroizing<Vec<u8>>,
    mut next: SendNext<'a>,
) -> Result<Step<'a>> {
    check(
        bytes.len() <= MAX_MESSAGE_BYTES,
        RuntimeError::MessageLength,
    )?;
    match &mut next {
        SendNext::GarblerOffer(setup) => setup.running.common.sent(kind, bytes.len()),
        SendNext::GarblerDirect(running, _, _)
        | SendNext::GarblerExtension(running, _)
        | SendNext::GarblerStart(running)
        | SendNext::GarblerFrame(running) => running.common.sent(kind, bytes.len()),
        SendNext::GarblerPublic(common)
        | SendNext::EvaluatorChoices(common, _)
        | SendNext::EvaluatorMasked(common, _, _) => common.sent(kind, bytes.len()),
        SendNext::Complete(_) => return Err(RuntimeError::CounterMismatch),
    }
    Ok(Step::Send(SendStep { bytes, kind, next }))
}
fn receive(kind: MessageKind, bytes: usize, next: ReceiveNext<'_>) -> Result<Step<'_>> {
    check(
        bytes > 0 && bytes <= MAX_MESSAGE_BYTES,
        RuntimeError::MessageLength,
    )?;
    Ok(Step::Receive(ReceiveStep { bytes, kind, next }))
}
fn complete(common: Common<'_>, output: Zeroizing<Vec<u8>>) -> Result<Step<'_>> {
    Ok(Step::Complete(finish(common, output)?))
}
fn finish(common: Common<'_>, output: Zeroizing<Vec<u8>>) -> Result<RuntimeOutput> {
    let m = &common.metrics;
    let b = common.schedule.evaluator_input_bits();
    let ot_bytes = 8384 + 48 * b;
    let a_to_b = STREAM_HEADER_BYTES
        + 4144
        + m.direct_label_bytes
        + (48 + 32 * b)
        + m.table_bytes
        + m.frame_count * 8
        + m.output_translation_bytes;
    let b_to_a = 4144 + (48 + 16 * b) + m.public_return_bytes;
    check(
        m.table_bytes == common.schedule.and_gates * AND_GATE_BYTES
            && m.ot_wire_bytes == ot_bytes
            && m.garbler_to_evaluator_wire_bytes == a_to_b
            && m.evaluator_to_garbler_wire_bytes == b_to_a,
        RuntimeError::CounterMismatch,
    )?;
    Ok(RuntimeOutput {
        output,
        metrics: common.metrics,
    })
}

fn advance_garbler<'a>(
    mut running: GarblerRunning<'a>,
    mut frame: Zeroizing<Vec<u8>>,
) -> Result<Step<'a>> {
    frame.clear();
    frame.resize(8, 0);
    while running.gate_index < running.common.schedule.gates {
        let index = running.gate_index;
        let gate = running.common.schedule.gate(index);
        let left =
            required_wire(&running.arena, gate.left).map_err(|_| RuntimeError::MissingWire)?;
        let right =
            required_wire(&running.arena, gate.right).map_err(|_| RuntimeError::MissingWire)?;
        let output = match gate.opcode {
            1 => running.garbler.xor(left, right),
            2 => {
                let (output, table) = running.garbler.garble_and(ordinal(index)?, left, right);
                table.append_encoded(&mut frame);
                output
            }
            3 => running.garbler.invert(left),
            _ => unreachable!("validated opcode"),
        };
        running.arena[gate.output] = Some(output);
        running.gate_index += 1;
        if frame.len() == TABLE_PAYLOAD_BYTES + 8 {
            return emit_garbler_frame(running, frame);
        }
    }
    if frame.len() > 8 {
        return emit_garbler_frame(running, frame);
    }
    let mut translation = Zeroizing::new(vec![0_u8; running.common.schedule.outputs.div_ceil(8)]);
    for (index, slot) in running.common.schedule.output_slots().enumerate() {
        let wire = required_wire(&running.arena, slot).map_err(|_| RuntimeError::MissingWire)?;
        translation[index / 8] |= wire.zero.selection_bit().0 << (index % 8);
    }
    send(
        MessageKind::OutputTranslation,
        translation,
        SendNext::GarblerPublic(running.common),
    )
}
fn emit_garbler_frame(
    mut running: GarblerRunning<'_>,
    mut frame: Zeroizing<Vec<u8>>,
) -> Result<Step<'_>> {
    let payload = frame.len() - 8;
    frame[..4].copy_from_slice(&(payload as u32).to_be_bytes());
    frame[4..8].copy_from_slice(&(running.common.metrics.frame_count as u32).to_be_bytes());
    running.common.metrics.table_bytes += payload;
    running.common.metrics.frame_count += 1;
    send(
        MessageKind::TableFrame,
        frame,
        SendNext::GarblerFrame(running),
    )
}
fn next_evaluator_frame(running: EvaluatorRunning<'_>) -> Result<Step<'_>> {
    let remaining =
        running.common.schedule.and_gates * AND_GATE_BYTES - running.common.metrics.table_bytes;
    if remaining > 0 {
        let length = remaining.min(TABLE_PAYLOAD_BYTES) + 8;
        receive(
            MessageKind::TableFrame,
            length,
            ReceiveNext::EvaluatorTable(running),
        )
    } else {
        let mut running = running;
        evaluate_remaining_linear(&mut running)?;
        let length = running.common.schedule.outputs.div_ceil(8);
        receive(
            MessageKind::OutputTranslation,
            length,
            ReceiveNext::EvaluatorTranslation(running),
        )
    }
}
fn evaluate_frame(running: &mut EvaluatorRunning<'_>, bytes: &[u8]) -> Result<()> {
    let payload = bytes.len() - 8;
    check(
        read_u32(&bytes[..4]) == payload
            && read_u32(&bytes[4..8]) == running.common.metrics.frame_count,
        RuntimeError::TableFrame,
    )?;
    let evaluator = Evaluator::new(running.common.domain);
    let mut cursor = 8;
    while cursor < bytes.len() {
        check(
            running.gate_index < running.common.schedule.gates,
            RuntimeError::TableFrame,
        )?;
        let index = running.gate_index;
        let gate = running.common.schedule.gate(index);
        let left =
            required_wire(&running.arena, gate.left).map_err(|_| RuntimeError::MissingWire)?;
        let right =
            required_wire(&running.arena, gate.right).map_err(|_| RuntimeError::MissingWire)?;
        let output = match gate.opcode {
            1 => evaluator.xor(left, right),
            2 => {
                let table = GarbledAndGate::decode(
                    bytes[cursor..cursor + AND_GATE_BYTES]
                        .try_into()
                        .expect("whole table record"),
                );
                cursor += AND_GATE_BYTES;
                evaluator.evaluate_and(ordinal(index)?, left, right, &table)
            }
            3 => evaluator.invert(left),
            _ => unreachable!("validated opcode"),
        };
        running.arena[gate.output] = Some(output);
        running.gate_index += 1;
    }
    running.common.metrics.table_bytes += payload;
    running.common.metrics.frame_count += 1;
    Ok(())
}
fn evaluate_remaining_linear(running: &mut EvaluatorRunning<'_>) -> Result<()> {
    let evaluator = Evaluator::new(running.common.domain);
    while running.gate_index < running.common.schedule.gates {
        let gate = running.common.schedule.gate(running.gate_index);
        let left =
            required_wire(&running.arena, gate.left).map_err(|_| RuntimeError::MissingWire)?;
        let right =
            required_wire(&running.arena, gate.right).map_err(|_| RuntimeError::MissingWire)?;
        let output = match gate.opcode {
            1 => evaluator.xor(left, right),
            3 => evaluator.invert(left),
            _ => return Err(RuntimeError::TableFrame),
        };
        running.arena[gate.output] = Some(output);
        running.gate_index += 1;
    }
    Ok(())
}

// OT states retain the existing family-specific type constraints internally.
enum Sender {
    Seed(SenderAwaitExtension<MlDsaSeedOtFamily>),
    Medium(SenderAwaitExtension<MlDsaSamplingOtFamily>),
    Rounding(SenderAwaitExtension<MlDsaRoundingOtFamily>),
}
enum ReceiverBase {
    Seed(ReceiverAwaitBaseChoices<MlDsaSeedOtFamily>),
    Medium(ReceiverAwaitBaseChoices<MlDsaSamplingOtFamily>),
    Rounding(ReceiverAwaitBaseChoices<MlDsaRoundingOtFamily>),
}
enum ReceiverMasked {
    Seed(ReceiverAwaitMaskedPayloads<MlDsaSeedOtFamily>),
    Medium(ReceiverAwaitMaskedPayloads<MlDsaSamplingOtFamily>),
    Rounding(ReceiverAwaitMaskedPayloads<MlDsaRoundingOtFamily>),
}
fn sender_begin(
    workload: Workload,
    session: OtSessionId,
    bytes: &[u8],
    garbler: &Garbler,
    arena: &[Option<GarblerWire>],
) -> Result<(Sender, Zeroizing<Vec<u8>>)> {
    let mut pairs = Vec::with_capacity(workload.b_inputs());
    for index in workload.a_inputs()..workload.a_inputs() + workload.b_inputs() {
        pairs.push(
            garbler
                .encoded_pair(required_wire(arena, index).map_err(|_| RuntimeError::MissingWire)?),
        );
    }
    macro_rules! begin {
        ($family:ty,$variant:ident) => {{
            let offer =
                BaseOffer::<$family>::decode_for_session(bytes, session).map_err(ot_error)?;
            let payloads = SenderPayloads::<$family>::new(pairs).map_err(ot_error)?;
            let (sender, choices) = SenderStart::<$family>::new()
                .begin_os(offer, payloads)
                .map_err(ot_error)?;
            Ok((Sender::$variant(sender), Zeroizing::new(choices.encode())))
        }};
    }
    match workload {
        Workload::Seed => begin!(MlDsaSeedOtFamily, Seed),
        Workload::Sampling | Workload::ExpandMask => begin!(MlDsaSamplingOtFamily, Medium),
        Workload::Rounding => begin!(MlDsaRoundingOtFamily, Rounding),
    }
}
fn sender_accept(sender: Sender, bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    macro_rules! accept {
        ($sender:expr,$family:ty) => {{
            let matrix = ExtensionMatrix::<$family>::decode(bytes).map_err(ot_error)?;
            Ok(Zeroizing::new(
                $sender.accept(matrix).map_err(ot_error)?.encode(),
            ))
        }};
    }
    match sender {
        Sender::Seed(s) => accept!(s, MlDsaSeedOtFamily),
        Sender::Medium(s) => accept!(s, MlDsaSamplingOtFamily),
        Sender::Rounding(s) => accept!(s, MlDsaRoundingOtFamily),
    }
}
fn receiver_begin(
    workload: Workload,
    session: OtSessionId,
    mut choices: Zeroizing<Vec<u8>>,
) -> Result<(ReceiverBase, Zeroizing<Vec<u8>>)> {
    macro_rules! begin {
        ($family:ty,$variant:ident) => {{
            let choices =
                ReceiverChoices::<$family>::from_packed_bytes(core::mem::take(&mut *choices))
                    .map_err(ot_error)?;
            let (receiver, offer) = ReceiverStart::<$family>::new()
                .begin_os(session, choices)
                .map_err(ot_error)?;
            Ok((
                ReceiverBase::$variant(receiver),
                Zeroizing::new(offer.encode()),
            ))
        }};
    }
    match workload {
        Workload::Seed => begin!(MlDsaSeedOtFamily, Seed),
        Workload::Sampling | Workload::ExpandMask => begin!(MlDsaSamplingOtFamily, Medium),
        Workload::Rounding => begin!(MlDsaRoundingOtFamily, Rounding),
    }
}
fn receiver_accept_choices(
    receiver: ReceiverBase,
    bytes: &[u8],
) -> Result<(ReceiverMasked, Zeroizing<Vec<u8>>)> {
    macro_rules! accept {
        ($receiver:expr,$family:ty,$variant:ident) => {{
            let choices = BaseChoices::<$family>::decode(bytes).map_err(ot_error)?;
            let (receiver, matrix) = $receiver.accept(choices).map_err(ot_error)?;
            Ok((
                ReceiverMasked::$variant(receiver),
                Zeroizing::new(matrix.encode()),
            ))
        }};
    }
    match receiver {
        ReceiverBase::Seed(r) => accept!(r, MlDsaSeedOtFamily, Seed),
        ReceiverBase::Medium(r) => accept!(r, MlDsaSamplingOtFamily, Medium),
        ReceiverBase::Rounding(r) => accept!(r, MlDsaRoundingOtFamily, Rounding),
    }
}
fn receiver_accept_masked(
    receiver: ReceiverMasked,
    bytes: &[u8],
    inputs: &mut Vec<EvaluatorWire>,
) -> Result<()> {
    macro_rules! accept {
        ($receiver:expr,$family:ty) => {{
            let masked = MaskedPayloads::<$family>::decode(bytes).map_err(ot_error)?;
            let selected = $receiver.accept(masked).map_err(ot_error)?;
            for label in selected.as_slice() {
                inputs.push(EvaluatorWire::from_secret_bytes(*label));
            }
            Ok(())
        }};
    }
    match receiver {
        ReceiverMasked::Seed(r) => accept!(r, MlDsaSeedOtFamily),
        ReceiverMasked::Medium(r) => accept!(r, MlDsaSamplingOtFamily),
        ReceiverMasked::Rounding(r) => accept!(r, MlDsaRoundingOtFamily),
    }
}
fn ot_matrix_bytes(workload: Workload) -> usize {
    48 + 16 * workload.b_inputs()
}
fn ot_masked_bytes(workload: Workload) -> usize {
    48 + 32 * workload.b_inputs()
}
fn ot_error(_: OtError) -> RuntimeError {
    RuntimeError::ObliviousTransfer
}
fn ordinal(index: usize) -> Result<GateOrdinal> {
    GateOrdinal::from_schedule_index(index as u64).ok_or(RuntimeError::GateOrdinal)
}
fn fresh_domain() -> Result<SessionDomain> {
    loop {
        let mut bytes = [0_u8; 8];
        getrandom::getrandom(&mut bytes).map_err(|_| RuntimeError::Randomness)?;
        if let Some(domain) = SessionDomain::from_protocol_value(u64::from_be_bytes(bytes)) {
            return Ok(domain);
        }
    }
}
fn fresh_header(schedule: &TrustedMlDsaSchedule<'_>, domain: SessionDomain) -> Result<Vec<u8>> {
    let mut header = vec![0_u8; STREAM_HEADER_BYTES];
    header[..8].copy_from_slice(STREAM_MAGIC);
    header[8..16].copy_from_slice(&domain.0.to_be_bytes());
    header[16..48].copy_from_slice(&schedule.digest);
    getrandom::getrandom(&mut header[48..]).map_err(|_| RuntimeError::Randomness)?;
    Ok(header)
}
fn parse_header(
    schedule: &TrustedMlDsaSchedule<'_>,
    header: &[u8],
) -> Result<(SessionDomain, OtSessionId, [u8; 32])> {
    check(
        header.len() == STREAM_HEADER_BYTES
            && &header[..8] == STREAM_MAGIC
            && header[16..48] == schedule.digest,
        RuntimeError::SessionBinding,
    )?;
    let domain = SessionDomain::from_protocol_value(u64::from_be_bytes(
        header[8..16].try_into().expect("fixed domain"),
    ))
    .ok_or(RuntimeError::SessionBinding)?;
    let binding: [u8; 32] = Sha256::digest(header).into();
    Ok((
        domain,
        OtSessionId::new(binding).map_err(ot_error)?,
        binding,
    ))
}
fn pack_bits(bits: &[bool]) -> Vec<u8> {
    let mut packed = vec![0_u8; bits.len().div_ceil(8)];
    for (index, bit) in bits.iter().enumerate() {
        packed[index / 8] |= u8::from(*bit) << (index % 8);
    }
    packed
}
fn read_u32(bytes: &[u8]) -> usize {
    u32::from_be_bytes(bytes.try_into().expect("fixed public width")) as usize
}
fn read_slot(bytes: &[u8]) -> usize {
    let mut result = 0;
    for byte in bytes {
        result = (result << 8) | usize::from(*byte);
    }
    result
}
fn check(condition: bool, error: RuntimeError) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(error)
    }
}
