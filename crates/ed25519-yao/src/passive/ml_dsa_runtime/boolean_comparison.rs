//! Investigation-only GMW and Boolean ABY2.0 evaluation of the pinned circuits.
//!
//! Both engines generate their own correlations through fresh two-directional
//! OT batches. No dealer or plaintext triple generator participates. This first
//! comparison deliberately reuses the existing 16-byte-payload IKNP primitive.
//! It supplies no independent review or complete ML-DSA composition claim.

/// Fresh GMW correlations with layer-batched online evaluation.
pub mod prepared;

use core::{future::Future, mem::size_of};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use super::{check, RuntimeError, TrustedMlDsaSchedule};
use crate::passive::{
    ml_dsa_signing::SigningRole,
    ot::{
        BaseChoices, BaseOffer, ExtensionMatrix, MaskedPayloads,
        MlDsaBooleanBatchOtFamily as Batch, OtFamily, OtSessionId, ReceiverChoices, ReceiverStart,
        SenderPayloads, SenderStart,
    },
};

type Result<T> = core::result::Result<T, RuntimeError>;
/// Correlation choices per direction in each fresh-base OT extension batch.
pub const CORRELATION_BATCH_BITS: usize = Batch::OT_COUNT;

const HEADER_BYTES: usize = 74;
const HEADER_MAGIC: &[u8; 8] = b"MLDSAB01";

/// Experimental Boolean-sharing engine. This is no production backend selector.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    /// XOR shares with one private Beaver triple per AND.
    Gmw,
    /// Public masked wires and private mask shares, with one opening per AND.
    Aby2,
}

impl Engine {
    fn code(self) -> u8 {
        match self {
            Self::Gmw => 1,
            Self::Aby2 => 2,
        }
    }
}

/// Distinct phases for complete setup, input conversion, online, and output accounting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Fresh session binding before any private preprocessing.
    Binding,
    /// Both directions of fresh-base IKNP correlation generation.
    Preprocessing,
    /// ABY2.0 input-mask setup. GMW has no input conversion traffic here.
    InputSetup,
    /// Sharing the actual private inputs for ABY2.0.
    InputOnline,
    /// Dependent AND layers, including every masked opening.
    Online,
    /// Role-private output decoding and declared public results.
    Output,
}

impl Phase {
    /// Returns this phase's position in the complete traffic and timing arrays.
    pub const fn index(self) -> usize {
        match self {
            Self::Binding => 0,
            Self::Preprocessing => 1,
            Self::InputSetup => 2,
            Self::InputOnline => 3,
            Self::Online => 4,
            Self::Output => 5,
        }
    }
}

/// Exact byte transport supplied by a host or asynchronous runtime adapter.
pub trait Transport {
    /// Sends the complete message before resolving.
    fn send(&mut self, bytes: &[u8]) -> impl Future<Output = Result<()>>;
    /// Receives exactly the requested number of bytes.
    fn receive(&mut self, bytes: usize) -> impl Future<Output = Result<Vec<u8>>>;
    /// Records a public phase transition without exposing private values.
    fn phase(&mut self, phase: Phase);
}

/// Exact traffic for one public phase, from this role's perspective.
#[derive(Clone, Copy, Debug, Default)]
pub struct PhaseBytes {
    /// Bytes sent by this role.
    pub sent: usize,
    /// Bytes received by this role.
    pub received: usize,
}

/// Complete comparison counters. Padding and fresh base OTs remain included.
pub struct Metrics {
    /// Binding, preprocessing, input setup, input online, gate online, output.
    pub phases: [PhaseBytes; 6],
    /// Actual circuit AND count before batch padding.
    pub and_gates: usize,
    /// Dependent AND layers, each with a two-party exchange.
    pub and_layers: usize,
    /// Correlation batches. Each batch executes OT in both directions.
    pub preprocessing_batches: usize,
    /// OT choices per direction, including the final padded batch.
    pub padded_ots_per_direction: usize,
    /// Retained public topology allocation. This is no total peak-memory measure.
    pub topology_allocation_bytes: usize,
    /// Retained Boolean values, masks, and correlations, excluding OT temporaries.
    pub private_state_allocation_bytes: usize,
    /// Binding includes the engine, complete schedule digest, and a fresh nonce.
    pub execution_binding_sha256: [u8; 32],
}

/// Decoded role output and complete comparison measurements.
pub struct Output {
    /// A receives declared public bytes only. B receives all circuit outputs.
    pub own_output: Zeroizing<Vec<u8>>,
    /// Full preprocessing, conversion, online, and output counters.
    pub metrics: Metrics,
}

#[derive(Clone, Copy)]
struct AndGate {
    left: usize,
    right: usize,
    output: usize,
}
struct LinearGate {
    left: usize,
    right: usize,
    output: usize,
    invert: bool,
}
#[derive(Default)]
struct Layer {
    and_indices: Vec<usize>,
    linear: Vec<LinearGate>,
}
#[derive(Default)]
struct LayerCounts {
    and_gates: usize,
    linear_gates: usize,
}
impl Layer {
    fn with_capacity(counts: LayerCounts) -> Self {
        Self {
            and_indices: Vec::with_capacity(counts.and_gates),
            linear: Vec::with_capacity(counts.linear_gates),
        }
    }
}
struct Topology {
    layers: Vec<Layer>,
    and_gates: Vec<AndGate>,
    outputs: Vec<usize>,
    wires: usize,
}

impl Topology {
    fn compile(schedule: &TrustedMlDsaSchedule<'_>) -> Self {
        // Count public layer sizes first. Geometric Vec growth otherwise retains
        // substantial spare topology capacity for large SHAKE circuits.
        let mut depth = vec![0; schedule.slots];
        let mut counts = vec![LayerCounts::default()];
        for ordinal in 0..schedule.gates {
            let gate = schedule.gate(ordinal);
            let layer = depth[gate.left].max(depth[gate.right]) + usize::from(gate.opcode == 2);
            while counts.len() <= layer {
                counts.push(LayerCounts::default());
            }
            if gate.opcode == 2 {
                counts[layer].and_gates += 1;
            } else {
                counts[layer].linear_gates += 1;
            }
            depth[gate.output] = layer;
        }
        let layers = counts.into_iter().map(Layer::with_capacity).collect();
        depth.fill(0);
        let mut current_wire: Vec<usize> = (0..schedule.slots).collect();
        let mut topology = Self {
            layers,
            and_gates: Vec::with_capacity(schedule.and_gates),
            outputs: Vec::new(),
            wires: schedule.inputs + schedule.gates,
        };
        for ordinal in 0..schedule.gates {
            let gate = schedule.gate(ordinal);
            let layer = depth[gate.left].max(depth[gate.right]) + usize::from(gate.opcode == 2);
            let left = current_wire[gate.left];
            let right = current_wire[gate.right];
            let output = schedule.inputs + ordinal;
            if gate.opcode == 2 {
                topology.layers[layer]
                    .and_indices
                    .push(topology.and_gates.len());
                topology.and_gates.push(AndGate {
                    left,
                    right,
                    output,
                });
            } else {
                topology.layers[layer].linear.push(LinearGate {
                    left,
                    right,
                    output,
                    invert: gate.opcode == 3,
                });
            }
            current_wire[gate.output] = output;
            depth[gate.output] = layer;
        }
        topology.outputs = schedule
            .output_slots()
            .map(|slot| current_wire[slot])
            .collect();
        topology
    }

    fn allocation_bytes(&self) -> usize {
        self.and_gates.capacity() * size_of::<AndGate>()
            + self.outputs.capacity() * size_of::<usize>()
            + self.layers.capacity() * size_of::<Layer>()
            + self
                .layers
                .iter()
                .map(|layer| {
                    layer.and_indices.capacity() * size_of::<usize>()
                        + layer.linear.capacity() * size_of::<LinearGate>()
                })
                .sum::<usize>()
    }
}

#[derive(Clone, Copy, Default, Zeroize)]
struct BooleanTriple {
    left_mask: u8,
    right_mask: u8,
    product_share: u8,
}

enum Correlations {
    Gmw(Zeroizing<Vec<BooleanTriple>>),
    Aby2 {
        masks: Zeroizing<Vec<u8>>,
        products: Zeroizing<Vec<u8>>,
    },
}

struct Context<'a, T> {
    transport: &'a mut T,
    role: SigningRole,
    phase: Phase,
    bytes: [PhaseBytes; 6],
}
impl<T: Transport> Context<'_, T> {
    fn set_phase(&mut self, phase: Phase) {
        self.phase = phase;
        self.transport.phase(phase);
    }
    async fn send(&mut self, bytes: &[u8]) -> Result<()> {
        if !bytes.is_empty() {
            self.transport.send(bytes).await?;
        }
        self.bytes[self.phase.index()].sent += bytes.len();
        Ok(())
    }
    async fn receive(&mut self, length: usize) -> Result<Zeroizing<Vec<u8>>> {
        let bytes = if length == 0 {
            Vec::new()
        } else {
            self.transport.receive(length).await?
        };
        check(bytes.len() == length, RuntimeError::MessageLength)?;
        self.bytes[self.phase.index()].received += length;
        Ok(Zeroizing::new(bytes))
    }
    async fn exchange(&mut self, bytes: &[u8], incoming: usize) -> Result<Zeroizing<Vec<u8>>> {
        match self.role {
            SigningRole::A => {
                self.send(bytes).await?;
                self.receive(incoming).await
            }
            SigningRole::B => {
                let peer = self.receive(incoming).await?;
                self.send(bytes).await?;
                Ok(peer)
            }
        }
    }
}

/// Evaluates one pinned circuit with genuine input-independent preprocessing.
/// Each caller supplies exactly its own input bits and its own transport endpoint.
pub async fn run(
    engine: Engine,
    role: SigningRole,
    schedule: &TrustedMlDsaSchedule<'_>,
    own_input: &[bool],
    transport: &mut impl Transport,
) -> Result<Output> {
    let expected = match role {
        SigningRole::A => schedule.garbler_input_bits(),
        SigningRole::B => schedule.evaluator_input_bits(),
    };
    check(own_input.len() == expected, RuntimeError::InputLength)?;
    let topology = Topology::compile(schedule);
    let mut context = Context {
        transport,
        role,
        phase: Phase::Binding,
        bytes: [PhaseBytes::default(); 6],
    };
    context.set_phase(Phase::Binding);
    let binding = bind(engine, schedule, &mut context).await?;
    context.set_phase(Phase::Preprocessing);
    let mut correlations = preprocess(engine, &topology, binding, &mut context).await?;
    let mut values = Zeroizing::new(vec![0; topology.wires]);
    initialize_inputs(
        schedule,
        own_input,
        &mut values,
        &mut correlations,
        &mut context,
    )
    .await?;
    context.set_phase(Phase::Online);
    for layer in &topology.layers {
        evaluate_layer(layer, &topology, &correlations, &mut values, &mut context).await?;
    }
    context.set_phase(Phase::Output);
    let output = decode_outputs(schedule, &topology, &values, &correlations, &mut context).await?;
    let private_state_allocation_bytes = values.capacity()
        + match &correlations {
            Correlations::Gmw(triples) => triples.capacity() * size_of::<BooleanTriple>(),
            Correlations::Aby2 { masks, products } => masks.capacity() + products.capacity(),
        };
    let batches = topology.and_gates.len().div_ceil(Batch::OT_COUNT);
    Ok(Output {
        own_output: output,
        metrics: Metrics {
            phases: context.bytes,
            and_gates: topology.and_gates.len(),
            and_layers: topology.layers.len() - 1,
            preprocessing_batches: batches,
            padded_ots_per_direction: batches * Batch::OT_COUNT,
            topology_allocation_bytes: topology.allocation_bytes(),
            private_state_allocation_bytes,
            execution_binding_sha256: binding,
        },
    })
}

async fn bind(
    engine: Engine,
    schedule: &TrustedMlDsaSchedule<'_>,
    context: &mut Context<'_, impl Transport>,
) -> Result<[u8; 32]> {
    let header = match context.role {
        SigningRole::A => {
            let mut bytes = vec![0; HEADER_BYTES];
            bytes[..8].copy_from_slice(HEADER_MAGIC);
            bytes[8] = engine.code();
            bytes[9] = schedule.circuit_id();
            bytes[10..42].copy_from_slice(&schedule.digest);
            getrandom::getrandom(&mut bytes[42..]).map_err(|_| RuntimeError::Randomness)?;
            context.send(&bytes).await?;
            Zeroizing::new(bytes)
        }
        SigningRole::B => context.receive(HEADER_BYTES).await?,
    };
    check(
        &header[..8] == HEADER_MAGIC
            && header[8] == engine.code()
            && header[9] == schedule.circuit_id()
            && header[10..42] == schedule.digest,
        RuntimeError::SessionBinding,
    )?;
    Ok(Sha256::digest(header.as_slice()).into())
}

fn random_bits(length: usize) -> Result<Zeroizing<Vec<u8>>> {
    let mut bytes = Zeroizing::new(vec![0; length]);
    getrandom::getrandom(&mut bytes).map_err(|_| RuntimeError::Randomness)?;
    for byte in bytes.iter_mut() {
        *byte &= 1;
    }
    Ok(bytes)
}

async fn preprocess(
    engine: Engine,
    topology: &Topology,
    binding: [u8; 32],
    context: &mut Context<'_, impl Transport>,
) -> Result<Correlations> {
    let mut correlations = match engine {
        Engine::Gmw => {
            let coins = random_bits(topology.and_gates.len() * 2)?;
            let mut triples =
                Zeroizing::new(vec![BooleanTriple::default(); topology.and_gates.len()]);
            for (index, triple) in triples.iter_mut().enumerate() {
                *triple = BooleanTriple {
                    left_mask: coins[2 * index],
                    right_mask: coins[2 * index + 1],
                    product_share: coins[2 * index] & coins[2 * index + 1],
                };
            }
            Correlations::Gmw(triples)
        }
        Engine::Aby2 => {
            let mut masks = random_bits(topology.wires)?;
            for layer in &topology.layers {
                for gate in &layer.linear {
                    masks[gate.output] = if gate.invert {
                        masks[gate.left]
                    } else {
                        masks[gate.left] ^ masks[gate.right]
                    };
                }
            }
            let products = topology
                .and_gates
                .iter()
                .map(|gate| masks[gate.left] & masks[gate.right])
                .collect();
            Correlations::Aby2 {
                masks,
                products: Zeroizing::new(products),
            }
        }
    };
    for (batch, gates) in topology.and_gates.chunks(Batch::OT_COUNT).enumerate() {
        let mut left = Zeroizing::new(vec![0; Batch::OT_COUNT]);
        let mut right = Zeroizing::new(vec![0; Batch::OT_COUNT]);
        for (offset, gate) in gates.iter().enumerate() {
            match &correlations {
                Correlations::Gmw(triples) => {
                    left[offset] = triples[batch * Batch::OT_COUNT + offset].left_mask;
                    right[offset] = triples[batch * Batch::OT_COUNT + offset].right_mask;
                }
                Correlations::Aby2 { masks, .. } => {
                    left[offset] = masks[gate.left];
                    right[offset] = masks[gate.right];
                }
            }
        }
        for sender in [SigningRole::A, SigningRole::B] {
            let mut hash = Sha256::new();
            hash.update(b"seams/ml-dsa/boolean-comparison/ot/v1");
            hash.update(binding);
            hash.update((batch as u64).to_be_bytes());
            hash.update([u8::from(sender == SigningRole::B)]);
            let session = OtSessionId::new(hash.finalize().into())
                .map_err(|_| RuntimeError::SessionBinding)?;
            let cross = cross_product(sender, session, &left, &right, context).await?;
            for offset in 0..gates.len() {
                let index = batch * Batch::OT_COUNT + offset;
                match &mut correlations {
                    Correlations::Gmw(triples) => triples[index].product_share ^= cross[offset],
                    Correlations::Aby2 { products, .. } => products[index] ^= cross[offset],
                }
            }
        }
    }
    Ok(correlations)
}

async fn cross_product(
    sender: SigningRole,
    session: OtSessionId,
    left: &[u8],
    right: &[u8],
    context: &mut Context<'_, impl Transport>,
) -> Result<Zeroizing<Vec<u8>>> {
    if context.role == sender {
        let coins = random_bits(Batch::OT_COUNT)?;
        let mut pairs = Vec::with_capacity(Batch::OT_COUNT);
        for index in 0..Batch::OT_COUNT {
            let mut zero = [0; 16];
            let mut one = [0; 16];
            zero[0] = coins[index];
            one[0] = coins[index] ^ left[index];
            pairs.push((zero, one));
        }
        let payloads =
            SenderPayloads::<Batch>::new(pairs).map_err(|_| RuntimeError::ObliviousTransfer)?;
        let offer = context.receive(BaseOffer::<Batch>::wire_bytes()).await?;
        let offer = BaseOffer::<Batch>::decode_for_session(&offer, session)
            .map_err(|_| RuntimeError::ObliviousTransfer)?;
        let (sender, choices) = SenderStart::<Batch>::new()
            .begin_os(offer, payloads)
            .map_err(|_| RuntimeError::ObliviousTransfer)?;
        context.send(&choices.encode()).await?;
        let extension = context
            .receive(ExtensionMatrix::<Batch>::wire_bytes())
            .await?;
        let extension = ExtensionMatrix::<Batch>::decode(&extension)
            .map_err(|_| RuntimeError::ObliviousTransfer)?;
        let payloads = sender
            .accept(extension)
            .map_err(|_| RuntimeError::ObliviousTransfer)?;
        context.send(&payloads.encode()).await?;
        Ok(coins)
    } else {
        let choices = ReceiverChoices::<Batch>::from_packed_bytes(pack(right))
            .map_err(|_| RuntimeError::ObliviousTransfer)?;
        let (receiver, offer) = ReceiverStart::<Batch>::new()
            .begin_os(session, choices)
            .map_err(|_| RuntimeError::ObliviousTransfer)?;
        context.send(&offer.encode()).await?;
        let choices = context.receive(BaseChoices::<Batch>::wire_bytes()).await?;
        let choices =
            BaseChoices::<Batch>::decode(&choices).map_err(|_| RuntimeError::ObliviousTransfer)?;
        let (receiver, extension) = receiver
            .accept(choices)
            .map_err(|_| RuntimeError::ObliviousTransfer)?;
        context.send(&extension.encode()).await?;
        let payloads = context
            .receive(MaskedPayloads::<Batch>::wire_bytes())
            .await?;
        let payloads = MaskedPayloads::<Batch>::decode(&payloads)
            .map_err(|_| RuntimeError::ObliviousTransfer)?;
        let selected = receiver
            .accept(payloads)
            .map_err(|_| RuntimeError::ObliviousTransfer)?;
        Ok(Zeroizing::new(
            selected
                .as_slice()
                .iter()
                .map(|payload| payload[0])
                .collect(),
        ))
    }
}

async fn initialize_inputs(
    schedule: &TrustedMlDsaSchedule<'_>,
    own: &[bool],
    values: &mut [u8],
    correlations: &mut Correlations,
    context: &mut Context<'_, impl Transport>,
) -> Result<()> {
    let a = schedule.garbler_input_bits();
    let b = schedule.evaluator_input_bits();
    let (offset, own_count, peer_count) = match context.role {
        SigningRole::A => (0, a, b),
        SigningRole::B => (a, b, a),
    };
    match correlations {
        Correlations::Gmw(_) => {
            for (index, bit) in own.iter().enumerate() {
                values[offset + index] = u8::from(*bit);
            }
        }
        Correlations::Aby2 { masks, .. } => {
            context.set_phase(Phase::InputSetup);
            let peer_masks = match context.role {
                SigningRole::A => &masks[a..a + b],
                SigningRole::B => &masks[..a],
            };
            let received = context
                .exchange(&pack(peer_masks), own_count.div_ceil(8))
                .await?;
            for (index, bit) in own.iter().enumerate() {
                values[offset + index] =
                    u8::from(*bit) ^ masks[offset + index] ^ bit_at(&received, index);
            }
            context.set_phase(Phase::InputOnline);
            let received = context
                .exchange(
                    &pack(&values[offset..offset + own_count]),
                    peer_count.div_ceil(8),
                )
                .await?;
            let peer_offset = if offset == 0 { a } else { 0 };
            for index in 0..peer_count {
                values[peer_offset + index] = bit_at(&received, index);
            }
        }
    }
    Ok(())
}

async fn evaluate_layer(
    layer: &Layer,
    topology: &Topology,
    correlations: &Correlations,
    values: &mut [u8],
    context: &mut Context<'_, impl Transport>,
) -> Result<()> {
    if !layer.and_indices.is_empty() {
        let width = if matches!(correlations, Correlations::Gmw(_)) {
            2
        } else {
            1
        };
        let mut outgoing = Zeroizing::new(vec![0; layer.and_indices.len() * width]);
        for (offset, &index) in layer.and_indices.iter().enumerate() {
            let gate = topology.and_gates[index];
            match correlations {
                Correlations::Gmw(triples) => {
                    outgoing[2 * offset] = values[gate.left] ^ triples[index].left_mask;
                    outgoing[2 * offset + 1] = values[gate.right] ^ triples[index].right_mask;
                }
                Correlations::Aby2 { masks, products } => {
                    outgoing[offset] = products[index]
                        ^ masks[gate.output]
                        ^ (values[gate.left] & masks[gate.right])
                        ^ (values[gate.right] & masks[gate.left]);
                    if context.role == SigningRole::A {
                        outgoing[offset] ^= values[gate.left] & values[gate.right];
                    }
                }
            }
        }
        let received = context
            .exchange(&pack(&outgoing), outgoing.len().div_ceil(8))
            .await?;
        for (offset, &index) in layer.and_indices.iter().enumerate() {
            let gate = topology.and_gates[index];
            values[gate.output] = match correlations {
                Correlations::Gmw(triples) => {
                    let d = outgoing[2 * offset] ^ bit_at(&received, 2 * offset);
                    let e = outgoing[2 * offset + 1] ^ bit_at(&received, 2 * offset + 1);
                    triples[index].product_share
                        ^ (d & triples[index].right_mask)
                        ^ (e & triples[index].left_mask)
                        ^ (u8::from(context.role == SigningRole::A) & d & e)
                }
                Correlations::Aby2 { .. } => outgoing[offset] ^ bit_at(&received, offset),
            };
        }
    }
    for gate in &layer.linear {
        values[gate.output] = if gate.invert {
            values[gate.left]
                ^ u8::from(
                    matches!(correlations, Correlations::Aby2 { .. })
                        || context.role == SigningRole::A,
                )
        } else {
            values[gate.left] ^ values[gate.right]
        };
    }
    Ok(())
}

async fn decode_outputs(
    schedule: &TrustedMlDsaSchedule<'_>,
    topology: &Topology,
    values: &[u8],
    correlations: &Correlations,
    context: &mut Context<'_, impl Transport>,
) -> Result<Zeroizing<Vec<u8>>> {
    let own: Zeroizing<Vec<u8>> = Zeroizing::new(
        topology
            .outputs
            .iter()
            .map(|&wire| match correlations {
                Correlations::Gmw(_) => values[wire],
                Correlations::Aby2 { masks, .. } => masks[wire],
            })
            .collect(),
    );
    match context.role {
        SigningRole::A => {
            context.send(&pack(&own)).await?;
            context.receive(schedule.workload.public_bytes()).await
        }
        SigningRole::B => {
            let peer = context.receive(own.len().div_ceil(8)).await?;
            let decoded: Zeroizing<Vec<u8>> = Zeroizing::new(
                topology
                    .outputs
                    .iter()
                    .enumerate()
                    .map(|(index, &wire)| {
                        let value = own[index] ^ bit_at(&peer, index);
                        value
                            ^ if matches!(correlations, Correlations::Aby2 { .. }) {
                                values[wire]
                            } else {
                                0
                            }
                    })
                    .collect(),
            );
            let output = Zeroizing::new(pack(&decoded));
            context
                .send(&schedule.workload.public_output(&output))
                .await?;
            Ok(output)
        }
    }
}

fn pack(bits: &[u8]) -> Vec<u8> {
    let mut bytes = vec![0; bits.len().div_ceil(8)];
    for (index, bit) in bits.iter().enumerate() {
        bytes[index / 8] |= (*bit & 1) << (index % 8);
    }
    bytes
}
fn bit_at(bytes: &[u8], index: usize) -> u8 {
    (bytes[index / 8] >> (index % 8)) & 1
}
