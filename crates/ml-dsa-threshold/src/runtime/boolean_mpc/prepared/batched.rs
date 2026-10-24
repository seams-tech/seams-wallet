//! Co-evaluation preserves each consumed batch's lanes and correlations.
use super::*;

pub(crate) struct PreparedGmwRequest<'a> {
    pub batch: PreparedGmwBatch<'a>,
    pub inputs: Vec<Zeroizing<Vec<bool>>>,
    pub binding: [u8; 32],
}

pub(crate) struct BatchedOutput {
    pub batches: Vec<BatchOutput>,
    pub metrics: BatchMetrics,
    pub maximum_message_bytes: usize,
}

/// All inputs must already be durably consumed. The ordered bindings cover the
/// entire cohort. Shared binding traffic and each layer's exchange are charged
/// to its first participating batch; byte and exchange totals remain exact.
pub(crate) async fn run_batches(
    requests: Vec<PreparedGmwRequest<'_>>,
    transport: &mut impl Transport,
) -> Result<BatchedOutput> {
    let role = requests
        .first()
        .ok_or(RuntimeError::InputLength)?
        .batch
        .role;
    let count: usize = requests
        .iter()
        .map(|request| request.batch.instances.len())
        .sum();
    check(count > 0 && count <= 352, RuntimeError::InputLength)?;
    let mut digest = Sha256::new();
    digest.update(b"seams/ml-dsa/prepared-gmw-cohort/v1");
    digest.update((requests.len() as u64).to_le_bytes());
    let mut combined = PreparedGmwBatch {
        role,
        groups: Vec::new(),
        instances: Vec::with_capacity(count),
        bytes: [PhaseBytes::default(); 6],
    };
    let mut inputs = Vec::with_capacity(count);
    let mut accounting = Vec::with_capacity(requests.len());
    let mut layer_owners = Vec::new();
    for (index, request) in requests.into_iter().enumerate() {
        let PreparedGmwRequest {
            batch,
            inputs: own_inputs,
            binding,
        } = request;
        check(batch.role == role, RuntimeError::SessionBinding)?;
        check(
            own_inputs.len() == batch.instances.len(),
            RuntimeError::InputLength,
        )?;
        digest.update((batch.instances.len() as u64).to_le_bytes());
        digest.update(binding);
        let mut metrics = batch_metrics(&batch);
        for group in &batch.groups {
            for (depth, layer) in group.topology.layers.iter().enumerate() {
                if layer.and_indices.is_empty() {
                    continue;
                }
                if layer_owners.len() <= depth {
                    layer_owners.resize(depth + 1, None);
                }
                if layer_owners[depth].is_none() {
                    layer_owners[depth] = Some(index);
                }
            }
        }
        if index == 0 {
            metrics.phases[Phase::InputOnline.index()].sent += 32;
            metrics.phases[Phase::InputOnline.index()].received += 32;
        }
        accounting.push(metrics);
        for (total, own) in combined.bytes.iter_mut().zip(batch.bytes) {
            total.sent += own.sent;
            total.received += own.received;
        }
        let group_offset = combined.groups.len();
        combined.groups.extend(batch.groups);
        for mut instance in batch.instances {
            instance.group += group_offset;
            combined.instances.push(instance);
        }
        inputs.extend(own_inputs);
    }
    for owner in layer_owners.into_iter().flatten() {
        accounting[owner].and_exchanges += 1;
    }
    let bound = maximum_message_bytes(&combined);
    check(
        bound <= super::super::super::MAX_MESSAGE_BYTES,
        RuntimeError::MessageLength,
    )?;
    let original_sent: usize = combined.bytes.iter().map(|phase| phase.sent).sum();
    let original_received: usize = combined.bytes.iter().map(|phase| phase.received).sum();
    let binding = digest.finalize().into();
    let mut observed = ObservedTransport {
        inner: transport,
        sent: 0,
        received: 0,
        maximum: 0,
    };
    let result = combined.run(&inputs, &binding, &mut observed).await?;
    check(
        observed.maximum == bound
            && result
                .metrics
                .phases
                .iter()
                .map(|phase| phase.sent)
                .sum::<usize>()
                == original_sent + observed.sent
            && result
                .metrics
                .phases
                .iter()
                .map(|phase| phase.received)
                .sum::<usize>()
                == original_received + observed.received,
        RuntimeError::MessageLength,
    )?;
    for phase in 0..6 {
        check(
            accounting
                .iter()
                .map(|metrics| metrics.phases[phase].sent)
                .sum::<usize>()
                == result.metrics.phases[phase].sent
                && accounting
                    .iter()
                    .map(|metrics| metrics.phases[phase].received)
                    .sum::<usize>()
                    == result.metrics.phases[phase].received,
            RuntimeError::MessageLength,
        )?;
    }
    check(
        accounting
            .iter()
            .map(|metrics| metrics.and_exchanges)
            .sum::<usize>()
            == result.metrics.and_exchanges,
        RuntimeError::ScheduleShape,
    )?;
    let mut outputs = result.outputs.into_iter();
    let mut batches = Vec::with_capacity(accounting.len());
    for metrics in accounting {
        let own_outputs = outputs.by_ref().take(metrics.instances).collect::<Vec<_>>();
        check(
            own_outputs.len() == metrics.instances,
            RuntimeError::InputLength,
        )?;
        batches.push(BatchOutput {
            outputs: own_outputs,
            metrics,
        });
    }
    check(outputs.next().is_none(), RuntimeError::InputLength)?;
    Ok(BatchedOutput {
        batches,
        metrics: result.metrics,
        maximum_message_bytes: observed.maximum,
    })
}

fn batch_metrics(batch: &PreparedGmwBatch<'_>) -> BatchMetrics {
    let mut phases = batch.bytes;
    let openings: usize = batch.groups.iter().map(group_opening_bytes).sum();
    phases[Phase::Online.index()].sent += openings;
    phases[Phase::Online.index()].received += openings;
    let mut output = 0;
    let mut public = 0;
    for instance in &batch.instances {
        let group = &batch.groups[instance.group];
        output += group.topology.outputs.len().div_ceil(8);
        public += group.schedule.workload.public_bytes();
    }
    let (sent, received) = match batch.role {
        SigningRole::A => (output, public),
        SigningRole::B => (public, output),
    };
    phases[Phase::Output.index()].sent += sent;
    phases[Phase::Output.index()].received += received;
    BatchMetrics {
        phases,
        instances: batch.instances.len(),
        and_gates: batch.groups.iter().map(group_and_gates).sum(),
        and_exchanges: 0,
        topology_allocation_bytes: topology_allocation_bytes(&batch.groups),
        private_state_allocation_bytes: batch.private_bytes()
            + 4 * batch.groups.iter().map(group_value_words).sum::<usize>(),
    }
}

fn group_opening_bytes(group: &Group<'_>) -> usize {
    2 * group.lanes.div_ceil(8) * group.topology.and_gates.len()
}

fn group_and_gates(group: &Group<'_>) -> usize {
    group.lanes * group.topology.and_gates.len()
}

fn group_value_words(group: &Group<'_>) -> usize {
    group.topology.wires * group.words
}

fn maximum_message_bytes(batch: &PreparedGmwBatch<'_>) -> usize {
    let depth = batch
        .groups
        .iter()
        .map(|group| group.topology.layers.len())
        .max()
        .unwrap_or(0);
    let openings = opening_capacity(&batch.groups, depth);
    let output: usize = batch
        .instances
        .iter()
        .map(|instance| {
            batch.groups[instance.group]
                .topology
                .outputs
                .len()
                .div_ceil(8)
        })
        .sum();
    let public: usize = batch
        .instances
        .iter()
        .map(|instance| {
            batch.groups[instance.group]
                .schedule
                .workload
                .public_bytes()
        })
        .sum();
    openings.max(output).max(public).max(32)
}

struct ObservedTransport<'a, T> {
    inner: &'a mut T,
    sent: usize,
    received: usize,
    maximum: usize,
}
impl<T: Transport> Transport for ObservedTransport<'_, T> {
    async fn send(&mut self, bytes: &[u8]) -> Result<()> {
        self.inner.send(bytes).await?;
        self.sent += bytes.len();
        self.maximum = self.maximum.max(bytes.len());
        Ok(())
    }
    async fn receive(&mut self, length: usize) -> Result<Vec<u8>> {
        let bytes = self.inner.receive(length).await?;
        self.received += bytes.len();
        self.maximum = self.maximum.max(bytes.len());
        Ok(bytes)
    }
    fn phase(&mut self, phase: Phase) {
        self.inner.phase(phase);
    }
}
