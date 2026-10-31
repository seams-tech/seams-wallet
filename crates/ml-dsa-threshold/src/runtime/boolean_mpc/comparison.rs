//! GMW and ABY2.0 reference comparison with fresh-base IKNP correlations.
//! Available only with `benchmarks`. Production uses `super::prepared` and `super::silent`.
use super::*;
use two_party_primitives::ot::MlDsaBooleanBatchOtFamily as Batch;

/// Correlation choices per direction in each fresh-base OT extension batch.
pub const CORRELATION_BATCH_BITS: usize = Batch::OT_COUNT;

/// Engine for the fresh-base OT comparison. The deployed signer has no selector.
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
            Self::Gmw => GMW_ENGINE_CODE,
            Self::Aby2 => 2,
        }
    }
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
    let binding = bind(engine.code(), schedule, &mut context).await?;
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

fn bit_at(bytes: &[u8], index: usize) -> u8 {
    (bytes[index / 8] >> (index % 8)) & 1
}
