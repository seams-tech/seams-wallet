//! Prepared half-gates with fresh random OT and delayed private inputs.
//!
//! No wallet inputs enter preparation. Each consuming handle is single-use in
//! memory. Durable reservation, replay protection, and storage authentication
//! are adapter responsibilities and are not implemented by this prototype.

/// Complete wallet-derived key-generation preparation.
pub mod keygen;

use core::future::Future;
use subtle::{Choice, ConditionallySelectable};
use zeroize::Zeroize;

use super::*;
use crate::passive::ml_dsa_signing::SigningRole;

/// Public measurement phase. Both roles finish preparation before online work.
#[derive(Clone, Copy)]
pub enum Phase {
    /// Garbling, random OT, and transfer to evaluator storage.
    Offline,
    /// Actual input selection, evaluation, and declared public outputs.
    Online,
}

/// Exact-message channel and role-local table storage for the experiment.
pub trait Transport {
    /// Sends one complete protocol message.
    fn send(&mut self, bytes: &[u8]) -> impl Future<Output = Result<()>>;
    /// Receives one message with this exact length.
    fn receive(&mut self, length: usize) -> impl Future<Output = Result<Vec<u8>>>;
    /// Stores a table frame at B, indexed only by public coordinates.
    fn store(
        &mut self,
        binding: [u8; 32],
        ordinal: usize,
        bytes: &[u8],
    ) -> impl Future<Output = Result<()>>;
    /// Reads a previously stored frame. This does not contact A.
    fn load(
        &mut self,
        binding: [u8; 32],
        ordinal: usize,
        length: usize,
    ) -> impl Future<Output = Result<Vec<u8>>>;
    /// Records a measurement boundary after both roles reach it.
    fn phase(&mut self, phase: Phase);
}

/// A single-use preparation bound to one circuit and role.
pub struct PreparedCircuit<'a> {
    common: Common<'a>,
    secret: Secret,
    offline_sent: usize,
    offline_received: usize,
}

enum Secret {
    A {
        input_pairs: Zeroizing<Vec<([u8; 16], [u8; 16])>>,
        ot_pairs: Zeroizing<Vec<([u8; 16], [u8; 16])>>,
    },
    B {
        choices: Zeroizing<Vec<u8>>,
        selected_pads: Zeroizing<Vec<[u8; 16]>>,
        translation: Zeroizing<Vec<u8>>,
    },
}

/// Prepares a fixed circuit without accessing either participant's real inputs.
pub async fn prepare<'a>(
    role: SigningRole,
    schedule: &'a TrustedMlDsaSchedule<'a>,
    transport: &mut impl Transport,
) -> Result<PreparedCircuit<'a>> {
    match role {
        SigningRole::A => prepare_a(schedule, transport).await,
        SigningRole::B => prepare_b(schedule, transport).await,
    }
}

async fn prepare_a<'a>(
    schedule: &'a TrustedMlDsaSchedule<'a>,
    transport: &mut impl Transport,
) -> Result<PreparedCircuit<'a>> {
    let domain = fresh_domain()?;
    let header = fresh_header(schedule, domain)?;
    let (_, session, binding) = parse_header(schedule, &header)?;
    transport.send(&header).await?;
    let garbler = Garbler::new(
        GlobalDelta::random().map_err(|_| RuntimeError::Randomness)?,
        domain,
    );
    let inputs =
        GarblerWire::random_batch(schedule.inputs).map_err(|_| RuntimeError::Randomness)?;
    let input_pairs = Zeroizing::new(
        inputs
            .iter()
            .map(|wire| garbler.encoded_pair(wire))
            .collect(),
    );
    let mut ot_pairs = Zeroizing::new(vec![([0; 16], [0; 16]); schedule.evaluator_input_bits()]);
    for (zero, one) in ot_pairs.iter_mut() {
        getrandom::getrandom(zero).map_err(|_| RuntimeError::Randomness)?;
        getrandom::getrandom(one).map_err(|_| RuntimeError::Randomness)?;
    }
    let offer = transport.receive(4144).await?;
    let (sender, choices) =
        sender_begin_payloads(schedule.workload, session, &offer, ot_pairs.to_vec())?;
    transport.send(&choices).await?;
    let matrix = transport
        .receive(ot_matrix_bytes(schedule.workload))
        .await?;
    let masked = sender_accept(sender, &matrix)?;
    transport.send(&masked).await?;
    let mut sent = header.len() + choices.len() + masked.len();
    let received = offer.len() + matrix.len();
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
    let mut step = advance_garbler(
        running,
        Zeroizing::new(Vec::with_capacity(TABLE_PAYLOAD_BYTES + 8)),
    )?;
    let common = loop {
        let Step::Send(outgoing) = step else {
            return Err(RuntimeError::TableFrame);
        };
        sent += outgoing.bytes.len();
        transport.send(&outgoing.bytes).await?;
        if outgoing.kind == MessageKind::OutputTranslation {
            let SendNext::GarblerPublic(common) = outgoing.next else {
                return Err(RuntimeError::TableFrame);
            };
            break common;
        }
        check(
            outgoing.kind == MessageKind::TableFrame,
            RuntimeError::TableFrame,
        )?;
        step = outgoing.resume()?;
    };
    Ok(PreparedCircuit {
        common,
        secret: Secret::A {
            input_pairs,
            ot_pairs,
        },
        offline_sent: sent,
        offline_received: received,
    })
}

async fn prepare_b<'a>(
    schedule: &'a TrustedMlDsaSchedule<'a>,
    transport: &mut impl Transport,
) -> Result<PreparedCircuit<'a>> {
    let header = transport.receive(STREAM_HEADER_BYTES).await?;
    let (domain, session, binding) = parse_header(schedule, &header)?;
    let mut choices = Zeroizing::new(vec![0; schedule.evaluator_input_bits() / 8]);
    getrandom::getrandom(&mut choices).map_err(|_| RuntimeError::Randomness)?;
    let (receiver, offer) = receiver_begin(schedule.workload, session, choices.clone())
        .map_err(|_| RuntimeError::ObliviousTransfer)?;
    transport.send(&offer).await?;
    let base = transport.receive(4144).await?;
    let (receiver, matrix) = receiver_accept_choices(receiver, &base)?;
    transport.send(&matrix).await?;
    let masked = transport
        .receive(ot_masked_bytes(schedule.workload))
        .await?;
    let selected_pads = receiver_accept_masked_bytes(receiver, &masked)?;
    let sent = offer.len() + matrix.len();
    let mut received = header.len() + base.len() + masked.len();
    let table_bytes = schedule.and_gates * AND_GATE_BYTES;
    let frame_count = table_bytes.div_ceil(TABLE_PAYLOAD_BYTES);
    for ordinal in 0..frame_count {
        let length = (table_bytes - ordinal * TABLE_PAYLOAD_BYTES).min(TABLE_PAYLOAD_BYTES) + 8;
        let frame = transport.receive(length).await?;
        check(
            read_u32(&frame[..4]) == length - 8 && read_u32(&frame[4..8]) == ordinal,
            RuntimeError::TableFrame,
        )?;
        transport.store(binding, ordinal, &frame).await?;
        received += frame.len();
    }
    let translation = Zeroizing::new(transport.receive(schedule.outputs.div_ceil(8)).await?);
    received += translation.len();
    Ok(PreparedCircuit {
        common: Common::new(schedule, Role::B, domain, session, binding),
        secret: Secret::B {
            choices,
            selected_pads,
            translation,
        },
        offline_sent: sent,
        offline_received: received,
    })
}

impl PreparedCircuit<'_> {
    /// The sole role allowed to consume this preparation.
    pub fn role(&self) -> SigningRole {
        match self.common.role {
            Role::A => SigningRole::A,
            Role::B => SigningRole::B,
        }
    }

    /// The exact prepared circuit identifier.
    pub fn circuit_id(&self) -> u8 {
        self.common.schedule.circuit_id()
    }

    /// Consumes preparation and supplies actual inputs. No handle can run twice.
    pub async fn run(self, bits: &[bool], transport: &mut impl Transport) -> Result<RuntimeOutput> {
        let Self {
            common,
            secret,
            offline_sent,
            offline_received,
        } = self;
        let schedule = common.schedule;
        let binding = common.metrics.execution_binding_sha256;
        match secret {
            Secret::A {
                input_pairs,
                ot_pairs,
            } => {
                check(
                    bits.len() == schedule.garbler_input_bits(),
                    RuntimeError::InputLength,
                )?;
                let correction = transport
                    .receive(32 + schedule.evaluator_input_bits() / 8)
                    .await?;
                check(correction[..32] == binding, RuntimeError::SessionBinding)?;
                let mut labels = Zeroizing::new(Vec::with_capacity(
                    32 + bits.len() * 16 + ot_pairs.len() * 32,
                ));
                labels.extend_from_slice(&binding);
                for (pair, bit) in input_pairs.iter().zip(bits) {
                    let mut selected = select_label(pair, u8::from(*bit));
                    labels.extend_from_slice(&selected);
                    selected.zeroize();
                }
                for (index, (zero, one)) in input_pairs[bits.len()..].iter().enumerate() {
                    let swap = (correction[32 + index / 8] >> (index % 8)) & 1;
                    let mut pad_zero = select_label(&ot_pairs[index], swap);
                    let mut pad_one = select_label(&ot_pairs[index], swap ^ 1);
                    for byte in 0..16 {
                        pad_zero[byte] ^= zero[byte];
                        pad_one[byte] ^= one[byte];
                    }
                    labels.extend_from_slice(&pad_zero);
                    labels.extend_from_slice(&pad_one);
                    pad_zero.zeroize();
                    pad_one.zeroize();
                }
                transport.send(&labels).await?;
                let returned = transport
                    .receive(32 + schedule.workload.public_bytes())
                    .await?;
                check(returned[..32] == binding, RuntimeError::SessionBinding)?;
                if matches!(
                    schedule.workload,
                    Workload::Sampling | Workload::AggregateCheck
                ) {
                    check(returned[32] <= 1, RuntimeError::PublicOutput)?;
                }
                let output = Zeroizing::new(returned[32..].to_vec());
                Ok(finish_prepared(
                    common,
                    output,
                    offline_sent + labels.len(),
                    offline_received + correction.len() + returned.len(),
                ))
            }
            Secret::B {
                mut choices,
                selected_pads,
                translation,
            } => {
                check(
                    bits.len() == schedule.evaluator_input_bits(),
                    RuntimeError::InputLength,
                )?;
                let mut correction = Zeroizing::new(binding.to_vec());
                for (index, bit) in bits.iter().enumerate() {
                    choices[index / 8] ^= u8::from(*bit) << (index % 8);
                }
                correction.extend_from_slice(&choices);
                transport.send(&correction).await?;
                let labels = Zeroizing::new(
                    transport
                        .receive(32 + schedule.garbler_input_bits() * 16 + bits.len() * 32)
                        .await?,
                );
                check(labels[..32] == binding, RuntimeError::SessionBinding)?;
                let split = 32 + schedule.garbler_input_bits() * 16;
                let mut inputs = Vec::with_capacity(schedule.inputs);
                for label in labels[32..split].chunks_exact(16) {
                    inputs.push(EvaluatorWire::from_secret_bytes(
                        label.try_into().expect("fixed label"),
                    ));
                }
                for (index, bit) in bits.iter().enumerate() {
                    let start = split + index * 32;
                    let pair = (
                        labels[start..start + 16].try_into().expect("fixed label"),
                        labels[start + 16..start + 32]
                            .try_into()
                            .expect("fixed label"),
                    );
                    let mut active = select_label(&pair, u8::from(*bit));
                    for byte in 0..16 {
                        active[byte] ^= selected_pads[index][byte];
                    }
                    inputs.push(EvaluatorWire::from_secret_bytes(active));
                    active.zeroize();
                }
                let mut arena = empty_arena(schedule.slots);
                install_inputs(&mut arena, inputs);
                let mut running = EvaluatorRunning {
                    common,
                    arena,
                    gate_index: 0,
                };
                running.common.metrics.label_arena_allocation_bytes =
                    running.arena.capacity() * size_of::<Option<EvaluatorWire>>();
                let table_bytes = schedule.and_gates * AND_GATE_BYTES;
                for ordinal in 0..table_bytes.div_ceil(TABLE_PAYLOAD_BYTES) {
                    let length =
                        (table_bytes - ordinal * TABLE_PAYLOAD_BYTES).min(TABLE_PAYLOAD_BYTES) + 8;
                    let frame = transport.load(binding, ordinal, length).await?;
                    check(frame.len() == length, RuntimeError::TableFrame)?;
                    evaluate_frame(&mut running, &frame)?;
                }
                evaluate_remaining_linear(&mut running)?;
                let mut output = Zeroizing::new(vec![0; schedule.outputs.div_ceil(8)]);
                for (index, slot) in schedule.output_slots().enumerate() {
                    let wire = required_wire(&running.arena, slot)
                        .map_err(|_| RuntimeError::MissingWire)?;
                    output[index / 8] |= (wire.active.selection_bit().0
                        ^ ((translation[index / 8] >> (index % 8)) & 1))
                        << (index % 8);
                }
                let mut returned = binding.to_vec();
                returned.extend_from_slice(&schedule.workload.public_output(&output));
                transport.send(&returned).await?;
                Ok(finish_prepared(
                    running.common,
                    output,
                    offline_sent + correction.len() + returned.len(),
                    offline_received + labels.len(),
                ))
            }
        }
    }
}

fn select_label(pair: &([u8; 16], [u8; 16]), bit: u8) -> [u8; 16] {
    let mut selected = [0; 16];
    for (index, byte) in selected.iter_mut().enumerate() {
        *byte = u8::conditional_select(&pair.0[index], &pair.1[index], Choice::from(bit));
    }
    selected
}

fn finish_prepared(
    mut common: Common<'_>,
    output: Zeroizing<Vec<u8>>,
    sent: usize,
    received: usize,
) -> RuntimeOutput {
    let metrics = &mut common.metrics;
    metrics.table_bytes = common.schedule.and_gates * AND_GATE_BYTES;
    metrics.frame_count = metrics.table_bytes.div_ceil(TABLE_PAYLOAD_BYTES);
    metrics.ot_wire_bytes = 8384 + 48 * common.schedule.evaluator_input_bits();
    metrics.maximum_table_message_bytes = (metrics.table_bytes.min(TABLE_PAYLOAD_BYTES)) + 8;
    metrics.maximum_control_message_bytes = (32
        + 16 * common.schedule.garbler_input_bits()
        + 32 * common.schedule.evaluator_input_bits())
    .max(ot_masked_bytes(common.schedule.workload));
    match common.role {
        Role::A => {
            metrics.garbler_to_evaluator_wire_bytes = sent;
            metrics.evaluator_to_garbler_wire_bytes = received;
        }
        Role::B => {
            metrics.garbler_to_evaluator_wire_bytes = received;
            metrics.evaluator_to_garbler_wire_bytes = sent;
        }
    }
    RuntimeOutput {
        output,
        metrics: common.metrics,
    }
}
