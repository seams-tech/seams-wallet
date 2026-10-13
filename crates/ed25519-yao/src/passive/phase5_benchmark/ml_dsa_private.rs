//! Investigation-only passive private execution of fixed ML-DSA compositions.
//!
//! Input transfer uses the existing fresh-base Chou-Orlandi and IKNP protocol.
//! Only B receives private output translations. B returns the declared public
//! outputs to A. This facade provides no transport authentication, persistence,
//! signing protocol, production admission, or reviewed composition proof.

use core::mem::size_of;
use std::{
    io::{Read, Write},
    time::Instant,
};

use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::super::ot::{
    BaseChoices, BaseOffer, ExtensionMatrix, MaskedPayloads, MlDsaRoundingOtFamily,
    MlDsaSamplingOtFamily, MlDsaSeedOtFamily, OtError, OtFamily, OtSessionId, ReceiverChoices,
    ReceiverStart, SenderPayloads, SenderStart,
};
use super::super::runtime::{empty_arena, install_inputs, required_wire};
use super::super::{
    Evaluator, EvaluatorWire, Garbler, GarblerWire, GlobalDelta, SessionDomain, WireValue,
    AND_GATE_BYTES, LABEL_BYTES,
};
use super::ml_dsa_kernel::{
    ensure, fresh_domain, missing_wire, ordinal, write_frame, KernelBenchmarkError,
    PublicKernelSchedule, TableReader, FRAME_BYTES,
};

const STREAM_MAGIC: &[u8; 8] = b"MLDSAP01";
const STREAM_HEADER_BYTES: usize = 80;
const PRIVATE_SHAPES: &[(u8, usize, usize)] = &[
    (0x87, 1_280, 1_024),
    (0x88, 6_912, 5_889),
    (0x89, 17_664, 8_448),
    (0x8a, 6_912, 5_888),
];
type Result<T> = std::result::Result<T, KernelBenchmarkError>;

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
            Self::Seed => 1_024,
            Self::Sampling | Self::ExpandMask => 6_400,
            Self::Rounding => 11_776,
        }
    }

    const fn b_inputs(self) -> usize {
        match self {
            Self::Seed => 256,
            Self::Sampling | Self::ExpandMask => 512,
            Self::Rounding => 5_888,
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

    fn public_output(self, output: &[u8]) -> Vec<u8> {
        match self {
            Self::Sampling => vec![output[0] & 1],
            Self::ExpandMask => Vec::new(),
            Self::Seed | Self::Rounding => output[..self.public_bytes()].to_vec(),
        }
    }
}

/// A fixed private composition, distinct from the public benchmark schedule.
pub struct PrivateKernelSchedule<'a> {
    inner: PublicKernelSchedule<'a>,
    workload: Workload,
}

impl<'a> PrivateKernelSchedule<'a> {
    /// Validates one fixed composed circuit and its explicit input ownership.
    pub fn parse(bytes: &'a [u8]) -> Result<Self> {
        let inner = PublicKernelSchedule::parse_shapes(bytes, PRIVATE_SHAPES)?;
        let workload = match bytes[8] {
            0x87 => Workload::Seed,
            0x88 => Workload::Sampling,
            0x89 => Workload::Rounding,
            0x8a => Workload::ExpandMask,
            _ => unreachable!("private shape was validated"),
        };
        Ok(Self { inner, workload })
    }

    /// Exact A input bit count in the fixed private schema.
    pub const fn garbler_input_bits(&self) -> usize {
        self.workload.a_inputs()
    }

    /// Exact B input bit count in the fixed private schema.
    pub const fn evaluator_input_bits(&self) -> usize {
        self.workload.b_inputs()
    }

    /// Exact B output bit count, including its declared public prefix.
    pub const fn evaluator_output_bits(&self) -> usize {
        self.inner.outputs
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
    /// Actual table buffer capacity.
    pub table_buffer_allocation_bytes: usize,
    /// Largest encoded control-flight or direct-label allocation.
    pub largest_control_buffer_bytes: usize,
    /// Public schedule bytes held outside the arena.
    pub schedule_bytes: usize,
    /// Input label generation and complete OT setup duration.
    pub setup_wall_ns: u128,
    /// Gate loop duration after subtracting measured table I/O duration.
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

/// Executes A with only A's fixed-schema fixture inputs and a duplex transport.
///
/// A retains its masks outside this function. No B private output labels or
/// bytes return to A. Caller-supplied residues must follow the honest schema.
pub fn garble_private_fixture<R: Read, W: Write>(
    schedule: &PrivateKernelSchedule<'_>,
    fixture_bits_a: &[bool],
    reader: R,
    writer: W,
) -> Result<PrivateKernelEvaluation> {
    let mut reader = CountingReader {
        inner: reader,
        bytes: 0,
    };
    let mut writer = CountingWriter {
        inner: writer,
        bytes: 0,
    };
    let evaluation = match schedule.workload {
        Workload::Seed => {
            garble::<MlDsaSeedOtFamily, _, _>(schedule, fixture_bits_a, &mut reader, &mut writer)
        }
        Workload::Sampling | Workload::ExpandMask => garble::<MlDsaSamplingOtFamily, _, _>(
            schedule,
            fixture_bits_a,
            &mut reader,
            &mut writer,
        ),
        Workload::Rounding => garble::<MlDsaRoundingOtFamily, _, _>(
            schedule,
            fixture_bits_a,
            &mut reader,
            &mut writer,
        ),
    }?;
    ensure(
        evaluation.metrics.garbler_to_evaluator_wire_bytes == writer.bytes
            && evaluation.metrics.evaluator_to_garbler_wire_bytes == reader.bytes,
        "Observed private A byte counts differ from the fixed schema.",
    )?;
    Ok(evaluation)
}

/// Executes B with only B's fixed-schema fixture inputs and a duplex transport.
///
/// B receives one selected label per input through OT. The public-fixture
/// recipient can inspect the returned B shares for independent verification.
pub fn evaluate_private_fixture<R: Read, W: Write>(
    schedule: &PrivateKernelSchedule<'_>,
    fixture_bits_b: &[bool],
    reader: R,
    writer: W,
) -> Result<PrivateKernelEvaluation> {
    let mut reader = CountingReader {
        inner: reader,
        bytes: 0,
    };
    let mut writer = CountingWriter {
        inner: writer,
        bytes: 0,
    };
    let evaluation = match schedule.workload {
        Workload::Seed => {
            evaluate::<MlDsaSeedOtFamily, _, _>(schedule, fixture_bits_b, &mut reader, &mut writer)
        }
        Workload::Sampling | Workload::ExpandMask => evaluate::<MlDsaSamplingOtFamily, _, _>(
            schedule,
            fixture_bits_b,
            &mut reader,
            &mut writer,
        ),
        Workload::Rounding => evaluate::<MlDsaRoundingOtFamily, _, _>(
            schedule,
            fixture_bits_b,
            &mut reader,
            &mut writer,
        ),
    }?;
    ensure(
        evaluation.metrics.garbler_to_evaluator_wire_bytes == reader.bytes
            && evaluation.metrics.evaluator_to_garbler_wire_bytes == writer.bytes,
        "Observed private B byte counts differ from the fixed schema.",
    )?;
    Ok(evaluation)
}

struct CountingReader<R> {
    inner: R,
    bytes: usize,
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let bytes = self.inner.read(buffer)?;
        self.bytes += bytes;
        Ok(bytes)
    }
}

struct CountingWriter<W> {
    inner: W,
    bytes: usize,
}

impl<W: Write> Write for CountingWriter<W> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let bytes = self.inner.write(buffer)?;
        self.bytes += bytes;
        Ok(bytes)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

fn garble<F: OtFamily, R: Read, W: Write>(
    private: &PrivateKernelSchedule<'_>,
    fixture_bits: &[bool],
    mut reader: R,
    mut writer: W,
) -> Result<PrivateKernelEvaluation> {
    let started = Instant::now();
    let schedule = &private.inner;
    ensure(
        fixture_bits.len() == private.garbler_input_bits(),
        "Wrong private A input count.",
    )?;
    let domain = fresh_domain()?;
    let (header, session, binding) = fresh_header(schedule, domain)?;
    writer.write_all(&header)?;
    writer.flush()?;
    let garbler = Garbler::new(
        GlobalDelta::random()
            .map_err(|_| KernelBenchmarkError::Invalid("OS randomness failed."))?,
        domain,
    );
    let inputs = GarblerWire::random_batch(schedule.inputs)
        .map_err(|_| KernelBenchmarkError::Invalid("OS randomness failed."))?;
    let mut direct = Zeroizing::new(Vec::with_capacity(fixture_bits.len() * LABEL_BYTES));
    for (input, bit) in inputs.iter().zip(fixture_bits) {
        garbler
            .encode(input, WireValue::from_secret_bit(u8::from(*bit)))
            .append_secret_bytes(&mut direct);
    }
    let mut pairs = Vec::with_capacity(F::OT_COUNT);
    for input in &inputs[fixture_bits.len()..] {
        pairs.push(garbler.encoded_pair(input));
    }
    let payloads = SenderPayloads::<F>::new(pairs).map_err(ot_error)?;
    let offer_bytes = read_control(&mut reader, BaseOffer::<F>::wire_bytes())?;
    let offer = BaseOffer::<F>::decode_for_session(&offer_bytes, session).map_err(ot_error)?;
    let (sender, choices) = SenderStart::<F>::new()
        .begin_os(offer, payloads)
        .map_err(ot_error)?;
    let choices_bytes = Zeroizing::new(choices.encode());
    writer.write_all(&choices_bytes)?;
    writer.write_all(&direct)?;
    writer.flush()?;
    let extension_bytes = read_control(&mut reader, ExtensionMatrix::<F>::wire_bytes())?;
    let extension = ExtensionMatrix::<F>::decode(&extension_bytes).map_err(ot_error)?;
    let masked = sender.accept(extension).map_err(ot_error)?;
    let masked_bytes = Zeroizing::new(masked.encode());
    writer.write_all(&masked_bytes)?;
    writer.flush()?;
    let largest_control_buffer_bytes = direct
        .capacity()
        .max(masked_bytes.capacity())
        .max(extension_bytes.capacity());
    drop(direct);
    drop(offer_bytes);
    drop(choices_bytes);
    drop(extension_bytes);
    drop(masked_bytes);
    drop(masked);
    let mut arena = empty_arena(schedule.slots);
    install_inputs(&mut arena, inputs);
    let arena_bytes = arena.capacity() * size_of::<Option<GarblerWire>>();
    let mut frame = Zeroizing::new(Vec::with_capacity(FRAME_BYTES));
    let setup_wall_ns = started.elapsed().as_nanos();
    let gate_started = Instant::now();
    let mut table_io_wall_ns = 0;
    let mut frame_count = 0;
    let mut table_bytes = 0;
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
            _ => unreachable!("validated opcode"),
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
    let mut translation = Zeroizing::new(vec![0_u8; schedule.outputs.div_ceil(8)]);
    for (index, slot) in schedule.output_slots().enumerate() {
        let wire = required_wire(&arena, slot).map_err(missing_wire)?;
        translation[index / 8] |= wire.zero.selection_bit().0 << (index % 8);
    }
    writer.write_all(&translation)?;
    writer.flush()?;
    let output = read_control(&mut reader, private.workload.public_bytes())?;
    if matches!(private.workload, Workload::Sampling) {
        ensure(output[0] <= 1, "Invalid public sampling result.")?;
    }
    let metrics = metrics::<F>(
        private,
        arena_bytes,
        frame.capacity(),
        largest_control_buffer_bytes,
        table_bytes,
        frame_count,
        setup_wall_ns,
        gate_compute_wall_ns,
        table_io_wall_ns,
        started,
        binding,
    );
    Ok(PrivateKernelEvaluation { output, metrics })
}

fn evaluate<F: OtFamily, R: Read, W: Write>(
    private: &PrivateKernelSchedule<'_>,
    fixture_bits: &[bool],
    mut reader: R,
    mut writer: W,
) -> Result<PrivateKernelEvaluation> {
    let started = Instant::now();
    let schedule = &private.inner;
    ensure(
        fixture_bits.len() == private.evaluator_input_bits(),
        "Wrong private B input count.",
    )?;
    let mut header = [0_u8; STREAM_HEADER_BYTES];
    reader.read_exact(&mut header)?;
    let (domain, session, binding) = parse_header(schedule, &header)?;
    let choices =
        ReceiverChoices::<F>::from_packed_bytes(pack_bits(fixture_bits)).map_err(ot_error)?;
    let (receiver, offer) = ReceiverStart::<F>::new()
        .begin_os(session, choices)
        .map_err(ot_error)?;
    let offer_bytes = Zeroizing::new(offer.encode());
    writer.write_all(&offer_bytes)?;
    writer.flush()?;
    let choices_bytes = read_control(&mut reader, BaseChoices::<F>::wire_bytes())?;
    let choices =
        BaseChoices::<F>::decode_for_session(&choices_bytes, session).map_err(ot_error)?;
    let mut direct = read_control(&mut reader, private.garbler_input_bits() * LABEL_BYTES)?;
    let (receiver, extension) = receiver.accept(choices).map_err(ot_error)?;
    let extension_bytes = Zeroizing::new(extension.encode());
    writer.write_all(&extension_bytes)?;
    writer.flush()?;
    let masked_bytes = read_control(&mut reader, MaskedPayloads::<F>::wire_bytes())?;
    let masked = MaskedPayloads::<F>::decode(&masked_bytes).map_err(ot_error)?;
    let selected = receiver.accept(masked).map_err(ot_error)?;
    let largest_control_buffer_bytes = direct
        .capacity()
        .max(masked_bytes.capacity())
        .max(extension_bytes.capacity());
    let mut inputs = Vec::with_capacity(schedule.inputs);
    for label in direct.chunks_exact_mut(LABEL_BYTES) {
        let active: [u8; LABEL_BYTES] = label.try_into().expect("fixed label width");
        inputs.push(EvaluatorWire::from_secret_bytes(active));
    }
    for label in selected.as_slice() {
        inputs.push(EvaluatorWire::from_secret_bytes(*label));
    }
    drop(selected);
    drop(direct);
    drop(masked_bytes);
    drop(extension_bytes);
    drop(extension);
    drop(choices_bytes);
    drop(offer_bytes);
    let evaluator = Evaluator::new(domain);
    let mut arena = empty_arena(schedule.slots);
    install_inputs(&mut arena, inputs);
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
            _ => unreachable!("validated opcode"),
        };
        arena[gate.output] = Some(output);
    }
    let gate_compute_wall_ns = gate_started
        .elapsed()
        .as_nanos()
        .saturating_sub(frames.io_wall_ns);
    ensure(
        frames.consumed == frames.expected_bytes && frames.cursor == frames.length,
        "Incomplete private table stream.",
    )?;
    let translation = read_control(&mut reader, schedule.outputs.div_ceil(8))?;
    let mut output = Zeroizing::new(vec![0_u8; schedule.outputs.div_ceil(8)]);
    for (index, slot) in schedule.output_slots().enumerate() {
        let wire = required_wire(&arena, slot).map_err(missing_wire)?;
        let bit = wire.active.selection_bit().0 ^ ((translation[index / 8] >> (index % 8)) & 1);
        output[index / 8] |= bit << (index % 8);
    }
    let public_output = private.workload.public_output(&output);
    writer.write_all(&public_output)?;
    writer.flush()?;
    let metrics = metrics::<F>(
        private,
        arena_bytes,
        frames.bytes.capacity(),
        largest_control_buffer_bytes,
        frames.consumed,
        frames.count,
        setup_wall_ns,
        gate_compute_wall_ns,
        frames.io_wall_ns,
        started,
        binding,
    );
    Ok(PrivateKernelEvaluation { output, metrics })
}

fn fresh_header(
    schedule: &PublicKernelSchedule<'_>,
    domain: SessionDomain,
) -> Result<([u8; STREAM_HEADER_BYTES], OtSessionId, [u8; 32])> {
    let mut header = [0_u8; STREAM_HEADER_BYTES];
    header[..8].copy_from_slice(STREAM_MAGIC);
    header[8..16].copy_from_slice(&domain.0.to_be_bytes());
    header[16..48].copy_from_slice(&schedule.digest());
    getrandom::getrandom(&mut header[48..])
        .map_err(|_| KernelBenchmarkError::Invalid("OS randomness failed."))?;
    let (_, session, binding) = parse_header(schedule, &header)?;
    Ok((header, session, binding))
}

fn parse_header(
    schedule: &PublicKernelSchedule<'_>,
    header: &[u8; STREAM_HEADER_BYTES],
) -> Result<(SessionDomain, OtSessionId, [u8; 32])> {
    ensure(
        &header[..8] == STREAM_MAGIC && header[16..48] == schedule.digest(),
        "Wrong private stream or schedule.",
    )?;
    let domain = SessionDomain::from_protocol_value(u64::from_be_bytes(
        header[8..16].try_into().expect("fixed domain"),
    ))
    .ok_or(KernelBenchmarkError::Invalid("Zero gate domain."))?;
    let binding: [u8; 32] = Sha256::digest(header).into();
    let session = OtSessionId::new(binding).map_err(ot_error)?;
    Ok((domain, session, binding))
}

fn read_control<R: Read>(reader: &mut R, bytes: usize) -> Result<Zeroizing<Vec<u8>>> {
    let mut encoded = Zeroizing::new(vec![0_u8; bytes]);
    reader.read_exact(&mut encoded)?;
    Ok(encoded)
}

fn pack_bits(bits: &[bool]) -> Vec<u8> {
    let mut packed = vec![0_u8; bits.len().div_ceil(8)];
    for (index, bit) in bits.iter().enumerate() {
        packed[index / 8] |= u8::from(*bit) << (index % 8);
    }
    packed
}

fn ot_error(_: OtError) -> KernelBenchmarkError {
    KernelBenchmarkError::Invalid("Passive input-transfer protocol failed.")
}

#[allow(clippy::too_many_arguments)]
fn metrics<F: OtFamily>(
    private: &PrivateKernelSchedule<'_>,
    arena_bytes: usize,
    table_buffer_bytes: usize,
    control_buffer_bytes: usize,
    table_bytes: usize,
    frame_count: usize,
    setup_wall_ns: u128,
    gate_compute_wall_ns: u128,
    table_io_wall_ns: u128,
    started: Instant,
    binding: [u8; 32],
) -> PrivateRoleMetrics {
    let direct_label_bytes = private.garbler_input_bits() * LABEL_BYTES;
    let output_translation_bytes = private.inner.outputs.div_ceil(8);
    let public_return_bytes = private.workload.public_bytes();
    let garbler_to_evaluator_wire_bytes = STREAM_HEADER_BYTES
        + BaseChoices::<F>::wire_bytes()
        + direct_label_bytes
        + MaskedPayloads::<F>::wire_bytes()
        + table_bytes
        + frame_count * 8
        + output_translation_bytes;
    let evaluator_to_garbler_wire_bytes =
        BaseOffer::<F>::wire_bytes() + ExtensionMatrix::<F>::wire_bytes() + public_return_bytes;
    PrivateRoleMetrics {
        table_bytes,
        frame_count,
        garbler_to_evaluator_wire_bytes,
        evaluator_to_garbler_wire_bytes,
        ot_wire_bytes: BaseOffer::<F>::wire_bytes()
            + BaseChoices::<F>::wire_bytes()
            + ExtensionMatrix::<F>::wire_bytes()
            + MaskedPayloads::<F>::wire_bytes(),
        direct_label_bytes,
        output_translation_bytes,
        public_return_bytes,
        label_arena_allocation_bytes: arena_bytes,
        table_buffer_allocation_bytes: table_buffer_bytes,
        largest_control_buffer_bytes: control_buffer_bytes,
        schedule_bytes: private.inner.bytes.len(),
        setup_wall_ns,
        gate_compute_wall_ns,
        table_io_wall_ns,
        role_wall_ns: started.elapsed().as_nanos(),
        execution_binding_sha256: binding,
    }
}
