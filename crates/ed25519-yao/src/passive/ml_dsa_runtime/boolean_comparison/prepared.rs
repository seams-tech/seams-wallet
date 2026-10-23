//! One-use GMW batches. Independent instances occupy lanes of u32 words.
//! Each layer exchanges masked openings in a fixed public order.

pub(crate) mod storage;

use super::silent::CorrelationStream;
use super::*;
use std::rc::Rc;

struct Group<'a> {
    schedule: &'a TrustedMlDsaSchedule<'a>,
    topology: Rc<Topology>,
    lanes: usize,
    words: usize,
    left: Zeroizing<Vec<u8>>,
    right: Zeroizing<Vec<u8>>,
    products: Zeroizing<Vec<u8>>,
}
/// Immutable circuit data shared across independent private reservations.
#[derive(Default)]
pub struct PublicTopologies {
    entries: Vec<([u8; 32], Rc<Topology>)>,
    builds: usize,
    hits: usize,
}

impl PublicTopologies {
    /// Shares only immutable public layouts; measurement counts start at zero.
    pub fn fork(&self) -> Self {
        Self {
            entries: self.entries.clone(),
            builds: 0,
            hits: 0,
        }
    }
    fn get(&mut self, schedule: &TrustedMlDsaSchedule<'_>) -> Rc<Topology> {
        if let Some((_, topology)) = self
            .entries
            .iter()
            .find(|(digest, _)| *digest == schedule.digest)
        {
            self.hits += 1;
            return Rc::clone(topology);
        }
        self.builds += 1;
        let mut topology = Topology::compile(schedule);
        reuse_wire_slots(&mut topology, schedule.inputs);
        let topology = Rc::new(topology);
        self.entries.push((schedule.digest, Rc::clone(&topology)));
        topology
    }

    /// Public layout construction and reuse counts for this cache handle.
    pub fn cache_statistics(&self) -> (usize, usize) {
        (self.builds, self.hits)
    }

    /// Distinct public allocations; private correlations are excluded.
    pub fn allocation_bytes(&self) -> usize {
        self.entries
            .iter()
            .map(|(_, topology)| topology.allocation_bytes())
            .sum()
    }
}

/// Public compiler bookkeeping. Twenty-four bits cover the runtime's limit of
/// five million gates plus inputs. The upper byte counts remaining reads.
/// Saturation pins a high-fanout wire until evaluation ends.
#[derive(Clone, Copy, Default)]
struct WireLifetime(u32);

impl WireLifetime {
    const SLOT_MASK: u32 = 0x00ff_ffff;
    const USE: u32 = 1 << 24;
    const PINNED: u32 = 0xff00_0000;

    fn retain(&mut self) {
        if self.0 < Self::PINNED {
            self.0 += Self::USE;
        }
    }
    fn pin(&mut self) {
        self.0 |= Self::PINNED;
    }
    fn assign(&mut self, slot: usize) {
        assert!(slot <= Self::SLOT_MASK as usize);
        self.0 = (self.0 & Self::PINNED) | slot as u32;
    }
    fn slot(self) -> usize {
        (self.0 & Self::SLOT_MASK) as usize
    }
    fn unused(self) -> bool {
        self.0 < Self::USE
    }
    fn release(&mut self) -> Option<usize> {
        if self.0 >= Self::PINNED {
            return None;
        }
        self.0 -= Self::USE;
        if self.unused() {
            Some(self.slot())
        } else {
            None
        }
    }
}

/// Reuses value slots using only public circuit lifetimes. AND inputs remain
/// live until every output in that layer has a distinct slot. Correlation order
/// and evaluation order stay unchanged.
fn reuse_wire_slots(topology: &mut Topology, inputs: usize) {
    let mut lifetimes = vec![WireLifetime::default(); topology.wires];
    for gate in &topology.and_gates {
        lifetimes[gate.left].retain();
        lifetimes[gate.right].retain();
    }
    for layer in &topology.layers {
        for gate in &layer.linear {
            lifetimes[gate.left].retain();
            lifetimes[gate.right].retain();
        }
    }
    for &output in &topology.outputs {
        lifetimes[output].pin();
    }
    let mut available = Vec::new();
    for input in 0..inputs {
        lifetimes[input].assign(input);
        if lifetimes[input].unused() {
            available.push(input);
        }
    }
    let mut count = inputs;
    let mut released = Vec::new();
    for layer in &mut topology.layers {
        for &index in &layer.and_indices {
            let gate = &mut topology.and_gates[index];
            let (left, right, output) = (gate.left, gate.right, gate.output);
            gate.left = lifetimes[left].slot();
            gate.right = lifetimes[right].slot();
            gate.output = allocate_wire_slot(&mut available, &mut count);
            lifetimes[output].assign(gate.output);
            release_wire_slot(left, &mut lifetimes, &mut released);
            release_wire_slot(right, &mut lifetimes, &mut released);
            if lifetimes[output].unused() {
                released.push(gate.output);
            }
        }
        available.append(&mut released);
        for gate in &mut layer.linear {
            let (left, right, output) = (gate.left, gate.right, gate.output);
            gate.left = lifetimes[left].slot();
            gate.right = lifetimes[right].slot();
            gate.output = allocate_wire_slot(&mut available, &mut count);
            lifetimes[output].assign(gate.output);
            release_wire_slot(left, &mut lifetimes, &mut available);
            release_wire_slot(right, &mut lifetimes, &mut available);
            if lifetimes[output].unused() {
                available.push(gate.output);
            }
        }
    }
    for output in &mut topology.outputs {
        *output = lifetimes[*output].slot();
    }
    topology.wires = count;
}

fn allocate_wire_slot(available: &mut Vec<usize>, count: &mut usize) -> usize {
    match available.pop() {
        Some(slot) => slot,
        None => {
            let slot = *count;
            *count += 1;
            slot
        }
    }
}

fn release_wire_slot(wire: usize, lifetimes: &mut [WireLifetime], available: &mut Vec<usize>) {
    if let Some(slot) = lifetimes[wire].release() {
        available.push(slot);
    }
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

/// Generates independent correlations through the consuming silent-OT stream.
/// Equal schedules share public topology. Private bits remain independent lanes.
pub async fn prepare_batch<'a>(
    role: SigningRole,
    schedules: &[&'a TrustedMlDsaSchedule<'a>],
    correlations: &mut CorrelationStream,
    topologies: &mut PublicTopologies,
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
    let (mut groups, mut instances) = build_layout(schedules, topologies);

    for instance in &mut instances {
        let group = &mut groups[instance.group];
        context.set_phase(Phase::Binding);
        instance.binding = bind(Engine::Gmw, group.schedule, &mut context).await?;
        context.set_phase(Phase::Preprocessing);
        let byte = instance.lane / 8;
        let shift = instance.lane % 8;
        for gate in 0..group.topology.and_gates.len() {
            let mut triple = correlations.take(&mut context).await?;
            let index = gate * group.lanes.div_ceil(8) + byte;
            group.left[index] |= triple[0] << shift;
            group.right[index] |= triple[1] << shift;
            group.products[index] |= triple[2] << shift;
            triple.zeroize();
        }
    }
    Ok(PreparedGmwBatch {
        role,
        groups,
        instances,
        bytes: context.bytes,
    })
}

fn build_layout<'a>(
    schedules: &[&'a TrustedMlDsaSchedule<'a>],
    topologies: &mut PublicTopologies,
) -> (Vec<Group<'a>>, Vec<Instance>) {
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
                    topology: topologies.get(schedule),
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
        let length = group.lanes.div_ceil(8) * group.topology.and_gates.len();
        group.left.resize(length, 0);
        group.right.resize(length, 0);
        group.products.resize(length, 0);
    }

    (groups, instances)
}

impl PreparedGmwBatch<'_> {
    /// Retained private correlation bytes, excluding online scratch space.
    pub fn private_bytes(&self) -> usize {
        self.groups
            .iter()
            .map(|group| group.left.capacity() + group.right.capacity() + group.products.capacity())
            .sum()
    }

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
        let private_bytes =
            4 * values.iter().map(|own| own.capacity()).sum::<usize>() + self.private_bytes();
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
#[inline(always)]
fn word_bytes(group: &Group<'_>, word: usize) -> usize {
    (group.lanes - word * 32).min(32).div_ceil(8)
}
#[inline(always)]
fn read_word(bytes: &[u8]) -> u32 {
    // Width is a public lane count. Direct loads avoid a temporary copy.
    match bytes {
        [] => 0,
        [a] => u32::from(*a),
        [a, b] => u32::from(*a) | (u32::from(*b) << 8),
        [a, b, c] => u32::from(*a) | (u32::from(*b) << 8) | (u32::from(*c) << 16),
        [a, b, c, d] => {
            u32::from(*a) | (u32::from(*b) << 8) | (u32::from(*c) << 16) | (u32::from(*d) << 24)
        }
        _ => unreachable!("Packed GMW word exceeds four bytes"),
    }
}

#[inline(always)]
fn correlation_word(bytes: &[u8], group: &Group<'_>, gate: usize, word: usize) -> u32 {
    let start = gate * group.lanes.div_ceil(8) + word * 4;
    read_word(&bytes[start..start + word_bytes(group, word)])
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
                let d = own[gate.left * group.words + word]
                    ^ correlation_word(&group.left, group, index, word);
                let e = own[gate.right * group.words + word]
                    ^ correlation_word(&group.right, group, index, word);
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
                own[gate.output * group.words + word] =
                    correlation_word(&group.products, group, index, word)
                        ^ (d & correlation_word(&group.right, group, index, word))
                        ^ (e & correlation_word(&group.left, group, index, word))
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
