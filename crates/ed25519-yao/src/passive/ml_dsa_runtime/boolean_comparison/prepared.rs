//! One-use GMW batches. Independent instances occupy lanes of u32 words.
//! Each layer exchanges masked openings in a fixed public order.

use super::*;

struct Group<'a> {
    schedule: &'a TrustedMlDsaSchedule<'a>,
    topology: Topology,
    lanes: usize,
    words: usize,
    left: Zeroizing<Vec<u32>>,
    right: Zeroizing<Vec<u32>>,
    products: Zeroizing<Vec<u32>>,
}
struct Instance {
    group: usize,
    lane: usize,
    binding: [u8; 32],
}

/// Fresh private correlations for an ordered batch. Setup receives no real inputs.
/// Consuming the handle burns every instance, including unused outputs.
pub struct PreparedGmwBatch<'a> {
    role: SigningRole,
    groups: Vec<Group<'a>>,
    instances: Vec<Instance>,
    bytes: [PhaseBytes; 6],
}

/// Public measurements, including every circuit and protocol phase.
pub struct BatchMetrics {
    /// Binding, preprocessing, input setup, online inputs, online gates, output.
    pub phases: [PhaseBytes; 6],
    /// Independent circuit instances consumed.
    pub instances: usize,
    /// Total AND count before correlation padding.
    pub and_gates: usize,
    /// Actual batched AND-layer exchanges.
    pub and_exchanges: usize,
    /// Allocation for distinct immutable topologies.
    pub topology_allocation_bytes: usize,
    /// Retained packed correlations and online values, excluding temporaries.
    pub private_state_allocation_bytes: usize,
}

/// Outputs preserve the schedules' role ownership and public prefixes.
pub struct BatchOutput {
    /// Outputs in the agreed instance order.
    pub outputs: Vec<Zeroizing<Vec<u8>>>,
    /// Complete phase accounting.
    pub metrics: BatchMetrics,
}

/// Generates independent correlations through the existing bidirectional OT.
/// Equal schedules share public topology. Private bits remain independent lanes.
pub async fn prepare_batch<'a>(
    role: SigningRole,
    schedules: &[&'a TrustedMlDsaSchedule<'a>],
    transport: &mut impl Transport,
) -> Result<PreparedGmwBatch<'a>> {
    check(
        !schedules.is_empty() && schedules.len() <= 352,
        RuntimeError::ScheduleShape,
    )?;
    let mut context = Context {
        transport,
        role,
        phase: Phase::Binding,
        bytes: [PhaseBytes::default(); 6],
    };
    context.set_phase(Phase::Binding);
    let mut digest = Sha256::new();
    digest.update(b"seams/ml-dsa/prepared-gmw-layout/v1");
    digest.update((schedules.len() as u64).to_le_bytes());
    for schedule in schedules {
        digest.update(schedule.digest);
    }
    let layout: [u8; 32] = digest.finalize().into();
    let peer = context.exchange(&layout, layout.len()).await?;
    check(peer.as_slice() == layout, RuntimeError::SessionBinding)?;
    let mut groups: Vec<Group<'a>> = Vec::new();
    let mut instances = Vec::with_capacity(schedules.len());
    for schedule in schedules {
        let index = match groups
            .iter()
            .position(|group| group.schedule.digest == schedule.digest)
        {
            Some(index) => index,
            None => {
                groups.push(Group {
                    schedule,
                    topology: Topology::compile(schedule),
                    lanes: 0,
                    words: 0,
                    left: Zeroizing::new(Vec::new()),
                    right: Zeroizing::new(Vec::new()),
                    products: Zeroizing::new(Vec::new()),
                });
                groups.len() - 1
            }
        };
        let lane = groups[index].lanes;
        groups[index].lanes += 1;
        instances.push(Instance {
            group: index,
            lane,
            binding: [0; 32],
        });
    }
    for group in &mut groups {
        group.words = group.lanes.div_ceil(32);
        let length = group.words * group.topology.and_gates.len();
        group.left.resize(length, 0);
        group.right.resize(length, 0);
        group.products.resize(length, 0);
    }

    for instance in &mut instances {
        let group = &mut groups[instance.group];
        context.set_phase(Phase::Binding);
        instance.binding = bind(Engine::Gmw, group.schedule, &mut context).await?;
        context.set_phase(Phase::Preprocessing);
        let correlations =
            preprocess(Engine::Gmw, &group.topology, instance.binding, &mut context).await?;
        let Correlations::Gmw(triples) = correlations else {
            unreachable!("GMW-only preparation");
        };
        let word = instance.lane / 32;
        let shift = instance.lane % 32;
        for (gate, triple) in triples.iter().enumerate() {
            let index = gate * group.words + word;
            group.left[index] |= u32::from(triple.left_mask) << shift;
            group.right[index] |= u32::from(triple.right_mask) << shift;
            group.products[index] |= u32::from(triple.product_share) << shift;
        }
    }
    Ok(PreparedGmwBatch {
        role,
        groups,
        instances,
        bytes: context.bytes,
    })
}

impl PreparedGmwBatch<'_> {
    /// Binds the ordered batch to the request before actual-input evaluation.
    /// The adapter must durably consume its reservation before calling this method.
    pub async fn run(
        self,
        own_inputs: &[Zeroizing<Vec<bool>>],
        request_binding: &[u8; 32],
        transport: &mut impl Transport,
    ) -> Result<BatchOutput> {
        check(
            own_inputs.len() == self.instances.len(),
            RuntimeError::InputLength,
        )?;
        let mut digest = Sha256::new();
        digest.update(b"seams/ml-dsa/prepared-gmw-batch/v1");
        digest.update(request_binding);
        digest.update((self.instances.len() as u64).to_le_bytes());
        for instance in &self.instances {
            digest.update(instance.binding);
            digest.update(self.groups[instance.group].schedule.digest);
        }
        let binding: [u8; 32] = digest.finalize().into();
        let mut context = Context {
            transport,
            role: self.role,
            phase: Phase::InputOnline,
            bytes: self.bytes,
        };
        context.set_phase(Phase::InputOnline);
        let peer = context.exchange(&binding, binding.len()).await?;
        check(peer.as_slice() == binding, RuntimeError::SessionBinding)?;
        let mut values: Vec<Zeroizing<Vec<u32>>> = self.groups.iter().map(empty_values).collect();
        for (instance, input) in self.instances.iter().zip(own_inputs) {
            let group = &self.groups[instance.group];
            let (offset, expected) = match self.role {
                SigningRole::A => (0, group.schedule.garbler_input_bits()),
                SigningRole::B => (
                    group.schedule.garbler_input_bits(),
                    group.schedule.evaluator_input_bits(),
                ),
            };
            check(input.len() == expected, RuntimeError::InputLength)?;
            for (index, bit) in input.iter().enumerate() {
                values[instance.group][(offset + index) * group.words + instance.lane / 32] |=
                    u32::from(*bit) << (instance.lane % 32);
            }
        }
        context.set_phase(Phase::Online);
        let depth = self
            .groups
            .iter()
            .map(|group| group.topology.layers.len())
            .max()
            .unwrap_or(0);
        let mut exchanges = 0;
        for layer in 0..depth {
            exchanges +=
                usize::from(evaluate_layer(layer, &self.groups, &mut values, &mut context).await?);
        }
        context.set_phase(Phase::Output);
        let outputs = outputs(&self.groups, &self.instances, &values, &mut context).await?;
        let private_bytes = 4
            * (values.iter().map(|own| own.capacity()).sum::<usize>()
                + self
                    .groups
                    .iter()
                    .map(|group| {
                        group.left.capacity() + group.right.capacity() + group.products.capacity()
                    })
                    .sum::<usize>());
        Ok(BatchOutput {
            outputs,
            metrics: BatchMetrics {
                phases: context.bytes,
                instances: self.instances.len(),
                and_gates: self
                    .groups
                    .iter()
                    .map(|group| group.lanes * group.topology.and_gates.len())
                    .sum(),
                and_exchanges: exchanges,
                topology_allocation_bytes: self
                    .groups
                    .iter()
                    .map(|group| group.topology.allocation_bytes())
                    .sum(),
                private_state_allocation_bytes: private_bytes,
            },
        })
    }
}

fn empty_values(group: &Group<'_>) -> Zeroizing<Vec<u32>> {
    Zeroizing::new(vec![0; group.topology.wires * group.words])
}
fn word_bytes(group: &Group<'_>, word: usize) -> usize {
    (group.lanes - word * 32).min(32).div_ceil(8)
}
fn read_word(bytes: &[u8]) -> u32 {
    let mut word = [0; 4];
    word[..bytes.len()].copy_from_slice(bytes);
    u32::from_le_bytes(word)
}

async fn evaluate_layer(
    depth: usize,
    groups: &[Group<'_>],
    values: &mut [Zeroizing<Vec<u32>>],
    context: &mut Context<'_, impl Transport>,
) -> Result<bool> {
    let mut outgoing = Zeroizing::new(Vec::new());
    for (group, own) in groups.iter().zip(values.iter()) {
        let Some(layer) = group.topology.layers.get(depth) else {
            continue;
        };
        for &index in &layer.and_indices {
            let gate = group.topology.and_gates[index];
            for word in 0..group.words {
                let width = word_bytes(group, word);
                let d =
                    own[gate.left * group.words + word] ^ group.left[index * group.words + word];
                let e =
                    own[gate.right * group.words + word] ^ group.right[index * group.words + word];
                outgoing.extend_from_slice(&d.to_le_bytes()[..width]);
                outgoing.extend_from_slice(&e.to_le_bytes()[..width]);
            }
        }
    }
    let exchanged = !outgoing.is_empty();
    let received = if exchanged {
        context.exchange(&outgoing, outgoing.len()).await?
    } else {
        Zeroizing::new(Vec::new())
    };
    let mut position = 0;
    let a_mask = 0u32.wrapping_sub(u32::from(context.role == SigningRole::A));
    for (group, own) in groups.iter().zip(values.iter_mut()) {
        let Some(layer) = group.topology.layers.get(depth) else {
            continue;
        };
        for &index in &layer.and_indices {
            let gate = group.topology.and_gates[index];
            for word in 0..group.words {
                let width = word_bytes(group, word);
                let d = read_word(&outgoing[position..position + width])
                    ^ read_word(&received[position..position + width]);
                position += width;
                let e = read_word(&outgoing[position..position + width])
                    ^ read_word(&received[position..position + width]);
                position += width;
                let correlation = index * group.words + word;
                own[gate.output * group.words + word] = group.products[correlation]
                    ^ (d & group.right[correlation])
                    ^ (e & group.left[correlation])
                    ^ (a_mask & d & e);
            }
        }
        for gate in &layer.linear {
            for word in 0..group.words {
                let left = own[gate.left * group.words + word];
                own[gate.output * group.words + word] = if gate.invert {
                    left ^ a_mask
                } else {
                    left ^ own[gate.right * group.words + word]
                };
            }
        }
    }
    Ok(exchanged)
}

async fn outputs(
    groups: &[Group<'_>],
    instances: &[Instance],
    values: &[Zeroizing<Vec<u32>>],
    context: &mut Context<'_, impl Transport>,
) -> Result<Vec<Zeroizing<Vec<u8>>>> {
    let mut own = Zeroizing::new(Vec::new());
    let mut public_length = 0;
    for instance in instances {
        let group = &groups[instance.group];
        let start = own.len();
        own.resize(start + group.topology.outputs.len().div_ceil(8), 0);
        for (bit, &wire) in group.topology.outputs.iter().enumerate() {
            let value = (values[instance.group][wire * group.words + instance.lane / 32]
                >> (instance.lane % 32))
                & 1;
            own[start + bit / 8] |= (value as u8) << (bit % 8);
        }
        public_length += group.schedule.workload.public_bytes();
    }
    match context.role {
        SigningRole::A => {
            context.send(&own).await?;
            let peer = context.receive(public_length).await?;
            let mut position = 0;
            let mut outputs = Vec::with_capacity(instances.len());
            for instance in instances {
                let length = groups[instance.group].schedule.workload.public_bytes();
                outputs.push(Zeroizing::new(peer[position..position + length].to_vec()));
                position += length;
            }
            Ok(outputs)
        }
        SigningRole::B => {
            let peer = context.receive(own.len()).await?;
            for (byte, other) in own.iter_mut().zip(peer.iter()) {
                *byte ^= other;
            }
            let mut returned = Zeroizing::new(Vec::with_capacity(public_length));
            let mut position = 0;
            let mut outputs = Vec::with_capacity(instances.len());
            for instance in instances {
                let group = &groups[instance.group];
                let length = group.topology.outputs.len().div_ceil(8);
                let decoded = Zeroizing::new(own[position..position + length].to_vec());
                returned.extend_from_slice(&group.schedule.workload.public_output(&decoded));
                outputs.push(decoded);
                position += length;
            }
            context.send(&returned).await?;
            Ok(outputs)
        }
    }
}
