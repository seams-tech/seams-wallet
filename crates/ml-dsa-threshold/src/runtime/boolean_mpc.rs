//! GMW transport, topology, and silent-OT preparation for the deployed signer.
//! The host owns authenticated transport and durable single use.
//! `comparison` contains the benchmark-only GMW/ABY2.0 engine selector.

/// Fresh-base GMW and ABY2.0 comparisons. Requires `benchmarks`.
#[cfg(feature = "benchmarks")]
pub mod comparison;

/// Fresh GMW correlations with layer-batched online evaluation.
pub mod prepared;

/// Bounded silent-OT correlations for the prepared signer.
pub mod silent;

use core::{future::Future, mem::size_of};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use super::{check, RuntimeError, TrustedMlDsaSchedule};
use crate::signing::SigningRole;
use two_party_primitives::ot::{
    BaseChoices, BaseOffer, ExtensionMatrix, MaskedPayloads, OtFamily, OtSessionId,
    ReceiverChoices, ReceiverStart, SenderPayloads, SenderStart,
};

type Result<T> = core::result::Result<T, RuntimeError>;

// Pinned wire identifier shared by prepared GMW and its reference comparison.
const GMW_ENGINE_CODE: u8 = 1;
const HEADER_BYTES: usize = 74;
const HEADER_MAGIC: &[u8; 8] = b"MLDSAB01";

/// Distinct phases for complete setup, input conversion, online, and output accounting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Fresh session binding before any private preprocessing.
    Binding,
    /// Role-private correlation generation.
    Preprocessing,
    /// Input-mask setup for the ABY2.0 comparison. Prepared GMW records zero.
    InputSetup,
    /// Message-bound private input sharing and conversion.
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

async fn bind(
    engine_code: u8,
    schedule: &TrustedMlDsaSchedule<'_>,
    context: &mut Context<'_, impl Transport>,
) -> Result<[u8; 32]> {
    let header = match context.role {
        SigningRole::A => {
            let mut bytes = vec![0; HEADER_BYTES];
            bytes[..8].copy_from_slice(HEADER_MAGIC);
            bytes[8] = engine_code;
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
            && header[8] == engine_code
            && header[9] == schedule.circuit_id()
            && header[10..42] == schedule.digest,
        RuntimeError::SessionBinding,
    )?;
    Ok(Sha256::digest(header.as_slice()).into())
}

fn pack(bits: &[u8]) -> Vec<u8> {
    let mut bytes = vec![0; bits.len().div_ceil(8)];
    for (index, bit) in bits.iter().enumerate() {
        bytes[index / 8] |= (*bit & 1) << (index % 8);
    }
    bytes
}
