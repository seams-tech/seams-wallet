//! Bounded passive silent-OT correlations for the experimental GMW signer.
//!
//! The ExConv7x24 encoder comes from the pinned CryProt dependency. PPRF
//! expansion follows CryProt/libOTe, with fixed dimensions and oblivious
//! receiver recovery. Every call uses real fresh 128-bit base correlations.

mod correlation_aes;
mod pprf;
use correlation_aes::{CorrelationAes, SecretBlockBatch};

use super::*;
use cryprot_codes::ExConvCode;
use cryprot_core::Block;
use ed25519_yao::primitives::ot::MlDsaSilentBaseOtFamily as BaseBatch;

/// Every chunk supplies this many independent one-use AND correlations.
pub const CHUNK_TRIPLES: usize = 262_144;
const OT_COUNT: usize = 2 * CHUNK_TRIPLES;
const SPARSE_BLOCKS: usize = 2 * OT_COUNT;
const PARTITIONS: usize = 256;
const DOMAIN: usize = SPARSE_BLOCKS / PARTITIONS;
const DEPTH: usize = 12;
const TREES: usize = 4;

/// Role-private random shares. Each entry is (left, right, product).
/// These values must never enter logs or a shared store.
pub struct TripleChunk {
    shares: Zeroizing<Vec<[u8; 3]>>,
    /// Complete binding and preprocessing counters for this role.
    pub phases: [PhaseBytes; 6],
}

impl TripleChunk {
    /// Exposes only this role's disposable correlations to its local evaluator.
    pub fn shares(&self) -> &[[u8; 3]] {
        &self.shares
    }
}

/// One reservation's consuming stream. Unused final correlations are wiped.
/// The caller binds a fresh preparation identifier and the complete circuit set.
/// Key-independent preparation binds the key and epoch later, at activation.
pub struct CorrelationStream {
    role: SigningRole,
    binding: [u8; 32],
    next_chunk: u64,
    state: StreamState,
}

enum StreamState {
    Empty,
    Failed,
    Ready { chunk: TripleChunk, position: usize },
}

impl CorrelationStream {
    /// Starts an empty one-use stream for an authenticated reservation.
    pub fn new(role: SigningRole, binding: [u8; 32]) -> Self {
        Self {
            role,
            binding,
            next_chunk: 0,
            state: StreamState::Empty,
        }
    }

    pub(super) async fn take(
        &mut self,
        context: &mut Context<'_, impl Transport>,
    ) -> Result<[u8; 3]> {
        check(self.role == context.role, RuntimeError::SessionBinding)?;
        check(
            !matches!(self.state, StreamState::Failed),
            RuntimeError::SessionBinding,
        )?;
        if matches!(self.state, StreamState::Empty) {
            self.state = StreamState::Failed;
            let mut hash = Sha256::new();
            hash.update(b"seams/ml-dsa/silent-stream/v1");
            hash.update(self.binding);
            hash.update(self.next_chunk.to_le_bytes());
            let binding: [u8; 32] = hash.finalize().into();
            self.next_chunk = self
                .next_chunk
                .checked_add(1)
                .ok_or(RuntimeError::CounterMismatch)?;
            let chunk = generate_chunk(self.role, &binding, context.transport).await?;
            for (total, phase) in context.bytes.iter_mut().zip(chunk.phases) {
                total.sent += phase.sent;
                total.received += phase.received;
            }
            context.set_phase(Phase::Preprocessing);
            self.state = StreamState::Ready { chunk, position: 0 };
        }
        let StreamState::Ready { chunk, position } = &mut self.state else {
            unreachable!("chunk generated")
        };
        let result = core::mem::take(&mut chunk.shares[*position]);
        *position += 1;
        if *position == CHUNK_TRIPLES {
            self.state = StreamState::Empty;
        }
        Ok(result)
    }
}

struct SecretBlocks(Vec<Block>);

impl SecretBlocks {
    fn zeroed(length: usize) -> Self {
        Self(vec![Block::ZERO; length])
    }
}

impl Drop for SecretBlocks {
    fn drop(&mut self) {
        self.0.as_mut_slice().zeroize();
    }
}

/// Generates one fresh chunk. The caller binds the session, epoch, reservation,
/// and ordered circuit layout in `binding` before consuming any correlations.
pub async fn generate_chunk(
    role: SigningRole,
    binding: &[u8; 32],
    transport: &mut impl Transport,
) -> Result<TripleChunk> {
    let mut context = Context {
        role,
        transport,
        phase: Phase::Binding,
        bytes: [PhaseBytes::default(); 6],
    };
    context.set_phase(Phase::Binding);
    let mut own_nonce = [0; 32];
    getrandom::getrandom(&mut own_nonce).map_err(|_| RuntimeError::Randomness)?;
    let peer_nonce = context.exchange(&own_nonce, 32).await?;
    let mut digest = Sha256::new();
    digest.update(b"seams/ml-dsa/silent-exconv7x24-256x4096-width4/v1");
    digest.update(binding);
    match role {
        SigningRole::A => {
            digest.update(own_nonce);
            digest.update(peer_nonce.as_slice());
        }
        SigningRole::B => {
            digest.update(peer_nonce.as_slice());
            digest.update(own_nonce);
        }
    }
    let session_bytes: [u8; 32] = digest.finalize().into();
    let peer = context.exchange(&session_bytes, 32).await?;
    check(
        peer.as_slice() == session_bytes,
        RuntimeError::SessionBinding,
    )?;
    let session = OtSessionId::new(session_bytes).map_err(|_| RuntimeError::SessionBinding)?;
    context.set_phase(Phase::Preprocessing);
    let mut sparse = SecretBlocks::zeroed(SPARSE_BLOCKS);
    let mut delta = Zeroizing::new([0; 16]);
    match role {
        SigningRole::A => {
            getrandom::getrandom(delta.as_mut()).map_err(|_| RuntimeError::Randomness)?;
            let pairs = sender_base(session, &mut context).await?;
            pprf::send(&pairs, &delta, &mut sparse, &mut context).await?;
            for block in &mut sparse.0 {
                block.as_mut_bytes()[0] &= 0xfe;
            }
        }
        SigningRole::B => {
            let mut point_bytes = Zeroizing::new([0; PARTITIONS * 2]);
            getrandom::getrandom(point_bytes.as_mut()).map_err(|_| RuntimeError::Randomness)?;
            let mut points = Zeroizing::new([0u16; PARTITIONS]);
            for (index, point) in points.iter_mut().enumerate() {
                *point =
                    u16::from_le_bytes([point_bytes[2 * index], point_bytes[2 * index + 1]]) & 4095;
            }
            let selected = receiver_base(session, &points, &mut context).await?;
            pprf::receive(&selected, &points, &mut sparse, &mut context).await?;
        }
    }
    // All sparse coordinates participate. The profile has no truncated tail.
    ExConvCode::new(OT_COUNT).dual_encode(&mut sparse.0);
    let shares = triples(role, &sparse.0[..OT_COUNT], &delta);
    Ok(TripleChunk {
        shares,
        phases: context.bytes,
    })
}

async fn sender_base(
    session: OtSessionId,
    context: &mut Context<'_, impl Transport>,
) -> Result<Zeroizing<Vec<[[u8; 16]; 2]>>> {
    let mut pairs = Zeroizing::new(vec![[[0; 16]; 2]; BaseBatch::OT_COUNT]);
    let mut payloads = Zeroizing::new(Vec::with_capacity(BaseBatch::OT_COUNT));
    for pair in pairs.iter_mut() {
        getrandom::getrandom(&mut pair[0]).map_err(|_| RuntimeError::Randomness)?;
        getrandom::getrandom(&mut pair[1]).map_err(|_| RuntimeError::Randomness)?;
        payloads.push((pair[0], pair[1]));
    }
    let payloads = SenderPayloads::<BaseBatch>::new(core::mem::take(&mut *payloads))
        .map_err(|_| RuntimeError::ObliviousTransfer)?;
    let offer = context
        .receive(BaseOffer::<BaseBatch>::wire_bytes())
        .await?;
    let offer = BaseOffer::<BaseBatch>::decode_for_session(&offer, session)
        .map_err(|_| RuntimeError::ObliviousTransfer)?;
    let (sender, choices) = SenderStart::<BaseBatch>::new()
        .begin_os(offer, payloads)
        .map_err(|_| RuntimeError::ObliviousTransfer)?;
    context.send(&choices.encode()).await?;
    let extension = context
        .receive(ExtensionMatrix::<BaseBatch>::wire_bytes())
        .await?;
    let extension = ExtensionMatrix::<BaseBatch>::decode(&extension)
        .map_err(|_| RuntimeError::ObliviousTransfer)?;
    let masked = sender
        .accept(extension)
        .map_err(|_| RuntimeError::ObliviousTransfer)?;
    context.send(&masked.encode()).await?;
    Ok(pairs)
}

async fn receiver_base(
    session: OtSessionId,
    points: &[u16; PARTITIONS],
    context: &mut Context<'_, impl Transport>,
) -> Result<Zeroizing<Vec<[u8; 16]>>> {
    let mut bits = Zeroizing::new(vec![0; BaseBatch::OT_COUNT]);
    for (tree, point) in points.iter().enumerate() {
        for depth in 0..DEPTH {
            bits[tree * DEPTH + depth] = ((point >> depth) & 1) as u8;
        }
    }
    let choices = ReceiverChoices::<BaseBatch>::from_packed_bytes(pack(&bits))
        .map_err(|_| RuntimeError::ObliviousTransfer)?;
    let (receiver, offer) = ReceiverStart::<BaseBatch>::new()
        .begin_os(session, choices)
        .map_err(|_| RuntimeError::ObliviousTransfer)?;
    context.send(&offer.encode()).await?;
    let choices = context
        .receive(BaseChoices::<BaseBatch>::wire_bytes())
        .await?;
    let choices =
        BaseChoices::<BaseBatch>::decode(&choices).map_err(|_| RuntimeError::ObliviousTransfer)?;
    let (receiver, extension) = receiver
        .accept(choices)
        .map_err(|_| RuntimeError::ObliviousTransfer)?;
    context.send(&extension.encode()).await?;
    let masked = context
        .receive(MaskedPayloads::<BaseBatch>::wire_bytes())
        .await?;
    let masked = MaskedPayloads::<BaseBatch>::decode(&masked)
        .map_err(|_| RuntimeError::ObliviousTransfer)?;
    let selected = receiver
        .accept(masked)
        .map_err(|_| RuntimeError::ObliviousTransfer)?;
    Ok(Zeroizing::new(selected.as_slice().to_vec()))
}

fn hash_cipher() -> CorrelationAes {
    CorrelationAes::new(&193502124791825095790518994062991136444_u128.to_le_bytes())
}

fn hash(aes: &CorrelationAes, input: &[u8; 16]) -> Zeroizing<[u8; 16]> {
    let mut output = Zeroizing::new(*input);
    aes.encrypt(core::slice::from_mut(&mut *output));
    for (out, input) in output.iter_mut().zip(input) {
        *out ^= input;
    }
    output
}

fn triples(role: SigningRole, encoded: &[Block], delta: &[u8; 16]) -> Zeroizing<Vec<[u8; 3]>> {
    let aes = hash_cipher();
    let mut shares = Zeroizing::new(vec![[0; 3]; CHUNK_TRIPLES]);
    let mut masked_delta = Zeroizing::new(*delta);
    masked_delta[0] &= 0xfe;
    for offset in (0..CHUNK_TRIPLES).step_by(4) {
        let count = match role {
            SigningRole::A => 16,
            SigningRole::B => 8,
        };
        let mut inputs = Zeroizing::new(SecretBlockBatch::<16>::default());
        let mut blocks = Zeroizing::new(SecretBlockBatch::<16>::default());
        for index in 0..8 {
            let input_index = match role {
                SigningRole::A => 2 * index,
                SigningRole::B => index,
            };
            inputs.0[input_index].copy_from_slice(encoded[2 * offset + index].as_bytes());
            inputs.0[input_index][0] &= 0xfe;
            if role == SigningRole::A {
                inputs.0[input_index + 1] = inputs.0[input_index];
                for byte in 0..16 {
                    inputs.0[input_index + 1][byte] ^= masked_delta[byte];
                }
            }
        }
        for index in 0..count {
            blocks.0[index].copy_from_slice(&inputs.0[index]);
        }
        aes.encrypt(&mut blocks.0[..count]);
        for index in 0..count {
            for byte in 0..16 {
                blocks.0[index][byte] ^= inputs.0[index][byte];
            }
        }
        for index in 0..4 {
            let mut triple = Zeroizing::new([0; 3]);
            match role {
                SigningRole::A => {
                    triple[0] = (blocks.0[4 * index][0] ^ blocks.0[4 * index + 1][0]) & 1;
                    triple[1] = (blocks.0[4 * index + 2][0] ^ blocks.0[4 * index + 3][0]) & 1;
                    triple[2] = (blocks.0[4 * index][0] ^ blocks.0[4 * index + 2][0]) & 1;
                }
                SigningRole::B => {
                    triple[0] = encoded[2 * (offset + index) + 1].as_bytes()[0] & 1;
                    triple[1] = encoded[2 * (offset + index)].as_bytes()[0] & 1;
                    triple[2] = (blocks.0[2 * index][0] ^ blocks.0[2 * index + 1][0]) & 1;
                }
            }
            triple[2] ^= triple[0] & triple[1];
            shares[offset + index] = *triple;
        }
    }
    shares
}
