//! Public-fixture ML-DSA hashing benchmarks using the existing half-gate engine.
//!
//! This API deliberately transfers both labels for evaluator inputs. That transfer
//! reveals the global delta and provides no two-party privacy. It measures engine
//! and bounded-stream costs only. Wallet secrets must never enter this API.

use core::{fmt, mem::size_of};
use std::{
    io::{Read, Write},
    time::Instant,
};

use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::super::runtime::{empty_arena, install_inputs, required_wire};
use super::super::{
    Evaluator, EvaluatorWire, GarbledAndGate, Garbler, GarblerWire, GateOrdinal, GlobalDelta,
    SessionDomain, WireValue, AND_GATE_BYTES, LABEL_BYTES,
};

const HEADER_BYTES: usize = 58;
pub(super) const FRAME_BYTES: usize = 64 * 1024;
const STREAM_MAGIC: &[u8; 8] = b"MLDSAG01";

/// Failure in the public-fixture benchmark or its local pipe.
#[derive(Debug)]
pub enum KernelBenchmarkError {
    /// A public schedule or stream violates the benchmark encoding.
    Invalid(&'static str),
    /// The local transport failed.
    Io(std::io::Error),
}

impl fmt::Display for KernelBenchmarkError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => formatter.write_str(message),
            Self::Io(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for KernelBenchmarkError {}

impl From<std::io::Error> for KernelBenchmarkError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

type Result<T> = std::result::Result<T, KernelBenchmarkError>;

/// Validated EYAOSC01 schedule for one fixed ML-DSA hashing workload.
pub struct PublicKernelSchedule<'a> {
    pub(super) bytes: &'a [u8],
    width: usize,
    pub(super) inputs: usize,
    pub(super) gates: usize,
    pub(super) outputs: usize,
    pub(super) slots: usize,
    pub(super) and_gates: usize,
    records_end: usize,
}

impl<'a> PublicKernelSchedule<'a> {
    /// Validates the local canonical artifact before any label operation.
    pub fn parse(bytes: &'a [u8]) -> Result<Self> {
        Self::parse_shapes(
            bytes,
            &[
                (0x82, 1600, 1600),
                (0x83, 512, 1024),
                (0x84, 512, 3848),
                (0x85, 9736, 5889),
                (0x86, 17664, 8448),
            ],
        )
    }

    pub(super) fn parse_shapes(bytes: &'a [u8], shapes: &[(u8, usize, usize)]) -> Result<Self> {
        ensure(
            bytes.len() >= HEADER_BYTES && &bytes[..8] == b"EYAOSC01",
            "Invalid schedule header.",
        )?;
        let width = usize::from(bytes[9]);
        ensure((1..=4).contains(&width), "Invalid schedule slot width.")?;
        let inputs = read_u32(&bytes[42..46]);
        let gates = read_u32(&bytes[46..50]);
        let outputs = read_u32(&bytes[50..54]);
        let slots = read_u32(&bytes[54..58]);
        ensure(
            shapes.contains(&(bytes[8], inputs, outputs)),
            "Unsupported hashing workload.",
        )?;
        ensure(
            inputs <= slots && slots <= 65536 && gates <= 5_000_000,
            "Schedule exceeds benchmark bounds.",
        )?;
        let records_end = HEADER_BYTES + gates * (1 + width * 3);
        ensure(
            bytes.len() == records_end + outputs * width,
            "Invalid schedule length.",
        )?;
        let mut schedule = Self {
            bytes,
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
            ensure(
                gate.left < slots && gate.right < slots && gate.output < slots,
                "Schedule slot exceeds arena.",
            )?;
            ensure(
                initialized[gate.left] && initialized[gate.right],
                "Schedule reads an uninitialized slot.",
            )?;
            match gate.opcode {
                1 => {}
                2 => schedule.and_gates += 1,
                3 => ensure(gate.left == gate.right, "Invalid inversion operands.")?,
                _ => return Err(KernelBenchmarkError::Invalid("Unknown schedule opcode.")),
            }
            initialized[gate.output] = true;
        }
        for slot in schedule.output_slots() {
            ensure(slot < slots && initialized[slot], "Invalid output slot.")?;
        }
        Ok(schedule)
    }

    /// Number of public-fixture input bits required by the schedule.
    pub const fn input_wire_count(&self) -> usize {
        self.inputs
    }

    /// Number of output bits, including a final partial byte when present.
    pub const fn output_wire_count(&self) -> usize {
        self.outputs
    }

    pub(super) fn gate(&self, index: usize) -> Gate {
        let start = HEADER_BYTES + index * (1 + self.width * 3);
        let record = &self.bytes[start..start + 1 + self.width * 3];
        Gate {
            opcode: record[0],
            left: read_slot(&record[1..1 + self.width]),
            right: read_slot(&record[1 + self.width..1 + self.width * 2]),
            output: read_slot(&record[1 + self.width * 2..]),
        }
    }

    pub(super) fn output_slots(&self) -> impl Iterator<Item = usize> + '_ {
        self.bytes[self.records_end..]
            .chunks_exact(self.width)
            .map(read_slot)
    }

    pub(super) fn digest(&self) -> [u8; 32] {
        Sha256::digest(self.bytes).into()
    }
}

pub(super) struct Gate {
    pub(super) opcode: u8,
    pub(super) left: usize,
    pub(super) right: usize,
    pub(super) output: usize,
}

/// Exact counters for one role. Timings are host wall-clock measurements.
#[derive(Debug)]
pub struct KernelRoleMetrics {
    /// Number of AND-table bytes sent or received in this direction.
    pub table_bytes: usize,
    /// Number of frames with an eight-byte length and ordinal header.
    pub frame_count: usize,
    /// Total bytes sent or received, including public-fixture label transfer.
    pub directional_wire_bytes: usize,
    /// Allocation reserved for the largest table frame.
    pub table_buffer_allocation_bytes: usize,
    /// Allocation reserved for this role's reusable wire-label arena.
    pub label_arena_allocation_bytes: usize,
    /// Public canonical schedule bytes held separately from the wire arena.
    pub schedule_bytes: usize,
    /// Label setup and public-fixture transfer duration.
    pub setup_wall_ns: u128,
    /// Gate-loop duration with measured table I/O duration subtracted.
    pub gate_compute_wall_ns: u128,
    /// Time spent in table reads or writes during the gate loop.
    pub table_io_wall_ns: u128,
    /// Complete role execution, excluding schedule parsing and process startup.
    pub role_wall_ns: u128,
}

/// Evaluator output from a public fixture, with measured role counters.
pub struct PublicKernelEvaluation {
    /// Ordinary output bytes. These are public synthetic data only.
    pub output: Vec<u8>,
    /// Evaluator measurements.
    pub metrics: KernelRoleMetrics,
}

/// Garbles one public fixture with fresh OS labels, delta, and session domain.
///
/// A owns the first half of the schedule input. Both labels for each B input
/// are sent openly. That shortcut excludes oblivious transfer and all privacy.
pub fn garble_public_fixture<W: Write>(
    schedule: &PublicKernelSchedule<'_>,
    public_fixture_bits: &[bool],
    mut writer: W,
) -> Result<KernelRoleMetrics> {
    let started = Instant::now();
    let domain = fresh_domain()?;
    let delta = GlobalDelta::random()
        .map_err(|_| KernelBenchmarkError::Invalid("OS randomness failed."))?;
    let garbler = Garbler::new(delta, domain);
    let inputs = GarblerWire::random_batch(schedule.inputs)
        .map_err(|_| KernelBenchmarkError::Invalid("OS randomness failed."))?;
    ensure(
        public_fixture_bits.len() == schedule.inputs / 2,
        "Wrong public A fixture bit count.",
    )?;
    write_input_labels(
        schedule,
        public_fixture_bits,
        &garbler,
        &inputs,
        domain,
        &mut writer,
    )?;
    let mut arena = empty_arena(schedule.slots);
    install_inputs(&mut arena, inputs);
    let arena_bytes = arena.capacity() * size_of::<Option<GarblerWire>>();
    let mut frame = Zeroizing::new(Vec::with_capacity(FRAME_BYTES));
    let setup_wall_ns = started.elapsed().as_nanos();
    let gate_started = Instant::now();
    let mut table_io_wall_ns = 0;
    let mut table_bytes = 0;
    let mut frame_count = 0;
    for index in 0..schedule.gates {
        let gate = schedule.gate(index);
        let left = required_wire(&arena, gate.left).map_err(missing_wire)?;
        let right = required_wire(&arena, gate.right).map_err(missing_wire)?;
        let output = match gate.opcode {
            1 => garbler.xor(left, right),
            2 => {
                let (output, table) = garbler.garble_and(ordinal(index)?, left, right);
                table.append_encoded(&mut frame);
                if frame.len() == FRAME_BYTES {
                    table_io_wall_ns += write_frame(&mut writer, &frame, frame_count)?;
                    table_bytes += frame.len();
                    frame_count += 1;
                    frame.clear();
                }
                output
            }
            3 => garbler.invert(left),
            _ => unreachable!("schedule opcode was validated"),
        };
        arena[gate.output] = Some(output);
    }
    if !frame.is_empty() {
        table_io_wall_ns += write_frame(&mut writer, &frame, frame_count)?;
        table_bytes += frame.len();
        frame_count += 1;
    }
    let gate_compute_wall_ns = gate_started
        .elapsed()
        .as_nanos()
        .saturating_sub(table_io_wall_ns);
    let mut translation = Zeroizing::new(Vec::with_capacity(schedule.outputs));
    for slot in schedule.output_slots() {
        let wire = required_wire(&arena, slot).map_err(missing_wire)?;
        translation.push(wire.zero.selection_bit().0);
    }
    writer.write_all(&translation)?;
    writer.flush()?;
    Ok(metrics(
        schedule,
        arena_bytes,
        frame.capacity(),
        table_bytes,
        frame_count,
        setup_wall_ns,
        gate_compute_wall_ns,
        table_io_wall_ns,
        started,
    ))
}

/// Evaluates one public fixture from a bounded garbler stream.
///
/// B owns the second half of the schedule input. This function receives both
/// input labels and therefore provides no private input-transfer guarantee.
pub fn evaluate_public_fixture<R: Read>(
    schedule: &PublicKernelSchedule<'_>,
    public_fixture_bits: &[bool],
    mut reader: R,
) -> Result<PublicKernelEvaluation> {
    let started = Instant::now();
    let mut header = [0_u8; 48];
    reader.read_exact(&mut header)?;
    ensure(
        &header[..8] == STREAM_MAGIC && header[16..] == schedule.digest(),
        "Wrong benchmark stream or schedule.",
    )?;
    let domain_value = u64::from_be_bytes(header[8..16].try_into().expect("fixed domain width"));
    let domain = SessionDomain::from_protocol_value(domain_value)
        .ok_or(KernelBenchmarkError::Invalid("Zero session domain."))?;
    let evaluator = Evaluator::new(domain);
    let mut arena = empty_arena(schedule.slots);
    ensure(
        public_fixture_bits.len() == schedule.inputs / 2,
        "Wrong public B fixture bit count.",
    )?;
    read_input_labels(schedule, public_fixture_bits, &mut reader, &mut arena)?;
    let arena_bytes = arena.capacity() * size_of::<Option<EvaluatorWire>>();
    let mut frames = TableReader::new(schedule.and_gates * AND_GATE_BYTES);
    let setup_wall_ns = started.elapsed().as_nanos();
    let gate_started = Instant::now();
    for index in 0..schedule.gates {
        let gate = schedule.gate(index);
        let left = required_wire(&arena, gate.left).map_err(missing_wire)?;
        let right = required_wire(&arena, gate.right).map_err(missing_wire)?;
        let output = match gate.opcode {
            1 => evaluator.xor(left, right),
            2 => evaluator.evaluate_and(ordinal(index)?, left, right, &frames.next(&mut reader)?),
            3 => evaluator.invert(left),
            _ => unreachable!("schedule opcode was validated"),
        };
        arena[gate.output] = Some(output);
    }
    let gate_compute_wall_ns = gate_started
        .elapsed()
        .as_nanos()
        .saturating_sub(frames.io_wall_ns);
    ensure(
        frames.consumed == frames.expected_bytes && frames.cursor == frames.length,
        "Incomplete table consumption.",
    )?;
    let mut translation = Zeroizing::new(vec![0; schedule.outputs]);
    reader.read_exact(&mut translation)?;
    let mut output = vec![0; schedule.outputs.div_ceil(8)];
    for (index, slot) in schedule.output_slots().enumerate() {
        ensure(translation[index] <= 1, "Invalid output translation bit.")?;
        let wire = required_wire(&arena, slot).map_err(missing_wire)?;
        let bit = wire.active.selection_bit().0 ^ translation[index];
        output[index / 8] |= bit << (index % 8);
    }
    let mut trailing = [0];
    ensure(
        reader.read(&mut trailing)? == 0,
        "Trailing benchmark stream bytes.",
    )?;
    let metrics = metrics(
        schedule,
        arena_bytes,
        frames.bytes.capacity(),
        frames.consumed,
        frames.count,
        setup_wall_ns,
        gate_compute_wall_ns,
        frames.io_wall_ns,
        started,
    );
    Ok(PublicKernelEvaluation { output, metrics })
}

fn write_input_labels<W: Write>(
    schedule: &PublicKernelSchedule<'_>,
    public_fixture_bits: &[bool],
    garbler: &Garbler,
    inputs: &[GarblerWire],
    domain: SessionDomain,
    writer: &mut W,
) -> Result<()> {
    let mut labels = Zeroizing::new(Vec::with_capacity(
        48 + schedule.inputs * LABEL_BYTES * 3 / 2,
    ));
    labels.extend_from_slice(STREAM_MAGIC);
    labels.extend_from_slice(&domain.0.to_be_bytes());
    labels.extend_from_slice(&schedule.digest());
    for (index, input) in inputs.iter().enumerate() {
        if index < schedule.inputs / 2 {
            garbler
                .encode(
                    input,
                    WireValue::from_secret_bit(u8::from(public_fixture_bits[index])),
                )
                .append_secret_bytes(&mut labels);
        } else {
            let (zero, one) = garbler.encoded_pair(input);
            labels.extend_from_slice(&zero);
            labels.extend_from_slice(&one);
        }
    }
    writer.write_all(&labels)?;
    Ok(())
}

fn read_input_labels<R: Read>(
    schedule: &PublicKernelSchedule<'_>,
    public_fixture_bits: &[bool],
    reader: &mut R,
    arena: &mut [Option<EvaluatorWire>],
) -> Result<()> {
    for (index, slot) in arena.iter_mut().enumerate().take(schedule.inputs) {
        let mut active = Zeroizing::new([0; LABEL_BYTES]);
        reader.read_exact(active.as_mut())?;
        if index >= schedule.inputs / 2 {
            let mut one = Zeroizing::new([0; LABEL_BYTES]);
            reader.read_exact(one.as_mut())?;
            let mask =
                0_u8.wrapping_sub(u8::from(public_fixture_bits[index - schedule.inputs / 2]));
            for byte in 0..LABEL_BYTES {
                active[byte] ^= (active[byte] ^ one[byte]) & mask;
            }
        }
        *slot = Some(EvaluatorWire::from_secret_bytes(*active));
    }
    Ok(())
}

pub(super) struct TableReader {
    pub(super) bytes: Zeroizing<Vec<u8>>,
    pub(super) cursor: usize,
    pub(super) length: usize,
    pub(super) consumed: usize,
    pub(super) expected_bytes: usize,
    pub(super) count: usize,
    pub(super) io_wall_ns: u128,
}

impl TableReader {
    pub(super) fn new(expected_bytes: usize) -> Self {
        Self {
            bytes: Zeroizing::new(vec![0; FRAME_BYTES]),
            cursor: 0,
            length: 0,
            consumed: 0,
            expected_bytes,
            count: 0,
            io_wall_ns: 0,
        }
    }

    pub(super) fn next<R: Read>(&mut self, reader: &mut R) -> Result<GarbledAndGate> {
        if self.cursor == self.length {
            let started = Instant::now();
            let mut header = [0; 8];
            reader.read_exact(&mut header)?;
            let length = read_u32(&header[..4]);
            let index = read_u32(&header[4..]);
            let expected_length = FRAME_BYTES.min(self.expected_bytes - self.consumed);
            ensure(
                length == expected_length && length != 0 && index == self.count,
                "Invalid table frame length or ordinal.",
            )?;
            reader.read_exact(&mut self.bytes[..length])?;
            self.length = length;
            self.cursor = 0;
            self.count += 1;
            self.io_wall_ns += started.elapsed().as_nanos();
        }
        let encoded = self.bytes[self.cursor..self.cursor + AND_GATE_BYTES]
            .try_into()
            .expect("whole table record");
        self.cursor += AND_GATE_BYTES;
        self.consumed += AND_GATE_BYTES;
        Ok(GarbledAndGate::decode(encoded))
    }
}

pub(super) fn write_frame<W: Write>(writer: &mut W, frame: &[u8], index: usize) -> Result<u128> {
    let started = Instant::now();
    writer.write_all(&(frame.len() as u32).to_be_bytes())?;
    writer.write_all(&(index as u32).to_be_bytes())?;
    writer.write_all(frame)?;
    Ok(started.elapsed().as_nanos())
}

#[allow(clippy::too_many_arguments)]
fn metrics(
    schedule: &PublicKernelSchedule<'_>,
    arena_bytes: usize,
    table_buffer_bytes: usize,
    table_bytes: usize,
    frame_count: usize,
    setup_wall_ns: u128,
    gate_compute_wall_ns: u128,
    table_io_wall_ns: u128,
    started: Instant,
) -> KernelRoleMetrics {
    KernelRoleMetrics {
        table_bytes,
        frame_count,
        directional_wire_bytes: 48
            + schedule.inputs * LABEL_BYTES * 3 / 2
            + table_bytes
            + frame_count * 8
            + schedule.outputs,
        table_buffer_allocation_bytes: table_buffer_bytes,
        label_arena_allocation_bytes: arena_bytes,
        schedule_bytes: schedule.bytes.len(),
        setup_wall_ns,
        gate_compute_wall_ns,
        table_io_wall_ns,
        role_wall_ns: started.elapsed().as_nanos(),
    }
}

pub(super) fn fresh_domain() -> Result<SessionDomain> {
    loop {
        let mut bytes = [0; 8];
        getrandom::getrandom(&mut bytes)
            .map_err(|_| KernelBenchmarkError::Invalid("OS randomness failed."))?;
        if let Some(domain) = SessionDomain::from_protocol_value(u64::from_be_bytes(bytes)) {
            return Ok(domain);
        }
    }
}

pub(super) fn ordinal(index: usize) -> Result<GateOrdinal> {
    GateOrdinal::from_schedule_index(index as u64).ok_or(KernelBenchmarkError::Invalid(
        "Gate ordinal exceeds tweak domain.",
    ))
}

pub(super) fn missing_wire(_: super::super::runtime::CircuitRunError) -> KernelBenchmarkError {
    KernelBenchmarkError::Invalid("Missing initialized schedule wire.")
}

fn read_u32(bytes: &[u8]) -> usize {
    u32::from_be_bytes(bytes.try_into().expect("fixed u32 width")) as usize
}

fn read_slot(bytes: &[u8]) -> usize {
    let mut result = 0;
    for byte in bytes {
        result = (result << 8) | usize::from(*byte);
    }
    result
}

pub(super) fn ensure(condition: bool, message: &'static str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(KernelBenchmarkError::Invalid(message))
    }
}
