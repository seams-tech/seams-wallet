//! Bounded in-memory pool. Persistent adapters must burn state before use.

use super::*;
use std::collections::{BTreeSet, VecDeque};

const MAX_REFILL_BATCHES: u16 = 10;
const MAX_READY_BATCHES: usize = 20;
const MAX_OPERATIONS: usize = 1024;

/// Generic independent reservations prepared before a wallet key exists.
pub struct PreparedGmwPool<'a> {
    role: SigningRole,
    id: [u8; 32],
    candidates: u16,
    reservations: VecDeque<PreparedGmwReservation<'a>>,
    topologies: PublicTopologies,
}

/// One key and epoch, with untouched reservations available for later requests.
/// Failed or canceled operations poison the whole pool and destroy its secrets.
pub struct ReadyGmwPool<'a> {
    state: State<'a>,
    topologies: PublicTopologies,
}

enum State<'a> {
    Ready(ActivePool<'a>),
    Failed,
}

struct ActivePool<'a> {
    key: Rc<Box<SigningKeyState>>,
    candidates: u16,
    reservations: VecDeque<PreparedGmwReservation<'a>>,
    operations: BTreeSet<[u8; 32]>,
    refill_ids: BTreeSet<[u8; 32]>,
}

/// Explicit pool result; exhaustion never counts as a successful signature.
pub enum PoolOutcome {
    /// A standard signature from the final consumed batch.
    Signed(GmwSignature),
    /// Every available reservation was exhausted, or none was available.
    Empty,
}

/// Includes all failed batches consumed before success or exhaustion.
pub struct PoolResult {
    /// Final public outcome.
    pub outcome: PoolOutcome,
    /// Every exhausted batch, in consumption order.
    pub exhausted: Vec<GmwExhaustion>,
    /// Untouched reservations retained for later messages.
    pub remaining_batches: usize,
}

/// Retained allocations, excluding allocator overhead and transient scratch space.
pub struct PoolInventory {
    /// Independent untouched candidate batches.
    pub batches: usize,
    /// Private candidate and correlation allocations.
    pub private_bytes: usize,
    /// Distinct shared public circuit allocations.
    pub public_topology_bytes: usize,
}

fn inventory(
    reservations: &VecDeque<PreparedGmwReservation<'_>>,
    topologies: &PublicTopologies,
) -> PoolInventory {
    PoolInventory {
        batches: reservations.len(),
        private_bytes: reservations
            .iter()
            .map(PreparedGmwReservation::private_bytes)
            .sum(),
        public_topology_bytes: topologies.allocation_bytes(),
    }
}

async fn prepare_group<'a, T: Transport + BooleanTransport>(
    role: SigningRole,
    group: &[u8; 32],
    candidates: u16,
    batches: u16,
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    topologies: &mut PublicTopologies,
    transport: &mut T,
) -> Result<VecDeque<PreparedGmwReservation<'a>>> {
    let binding = shake256(&[
        b"seams/ml-dsa/gmw-preparation-group/v1",
        group,
        &candidates.to_le_bytes(),
        &batches.to_le_bytes(),
    ]);
    agree(role, &binding, transport).await?;
    let mut reservations = VecDeque::with_capacity(usize::from(batches));
    for index in 0..batches {
        let id = shake256(&[&binding, &index.to_le_bytes()]);
        reservations.push_back(
            prepare_gmw_reservation(role, id, candidates, schedules, topologies, transport).await?,
        );
    }
    Ok(reservations)
}

impl<'a> PreparedGmwPool<'a> {
    /// Prepares one to ten batches with shared public topology and fresh secrets.
    /// A group is sequential; this API makes no parallel speedup claim.
    pub async fn prepare<T: Transport + BooleanTransport>(
        role: SigningRole,
        id: [u8; 32],
        candidates: u16,
        batches: u16,
        schedules: &'a [TrustedMlDsaSchedule<'a>],
        transport: &mut T,
    ) -> Result<Self> {
        if batches == 0 || batches > MAX_REFILL_BATCHES || candidates == 0 || candidates > 32 {
            return Err(SigningError::AttemptLimit);
        }
        let mut topologies = PublicTopologies::default();
        let reservations = prepare_group(
            role,
            &id,
            candidates,
            batches,
            schedules,
            &mut topologies,
            transport,
        )
        .await?;
        Ok(Self {
            role,
            id,
            candidates,
            reservations,
            topologies,
        })
    }

    /// Reports retained state before key creation without exposing private values.
    pub fn inventory(&self) -> PoolInventory {
        inventory(&self.reservations, &self.topologies)
    }

    /// Consumes this generic pool and binds it to one canonical key and epoch.
    /// Individual commitment activation remains inside the signing interval.
    /// A persistent adapter must burn the generic handle before this call.
    pub async fn activate<T: Transport + BooleanTransport>(
        self,
        own: OwnSigningShare,
        public_key: &[u8; PUBLIC_KEY_BYTES],
        epoch: [u8; 32],
        transport: &mut T,
    ) -> Result<ReadyGmwPool<'a>> {
        let reservation = Reservation {
            id: self.id,
            epoch,
            candidates: self.candidates,
        };
        let key = prepare_key_state(
            self.role,
            own,
            public_key,
            &reservation,
            SigningEngine::Gmw,
            transport,
        )
        .await?;
        Ok(ReadyGmwPool {
            state: State::Ready(ActivePool {
                key: Rc::new(key),
                candidates: self.candidates,
                reservations: self.reservations,
                operations: BTreeSet::new(),
                refill_ids: BTreeSet::from([self.id]),
            }),
            topologies: self.topologies,
        })
    }
}

impl<'a> ReadyGmwPool<'a> {
    /// Reports untouched reservations; a poisoned pool is explicitly unavailable.
    pub fn inventory(&self) -> Result<PoolInventory> {
        match &self.state {
            State::Ready(active) => Ok(inventory(&active.reservations, &self.topologies)),
            State::Failed => Err(SigningError::PreparedPoolUnavailable),
        }
    }

    /// Consumes fresh batches until a signature succeeds or the pool empties.
    /// Replays fail before private work. An empty request also consumes its ID.
    /// The adapter must durably burn state before calling this method.
    pub async fn sign<T: Transport + BooleanTransport>(
        &mut self,
        message: &[u8],
        context: &[u8],
        operation_id: [u8; 32],
        transport: &mut T,
    ) -> Result<PoolResult> {
        let context_length =
            u8::try_from(context.len()).map_err(|_| SigningError::ContextLength)?;
        let State::Ready(mut active) = core::mem::replace(&mut self.state, State::Failed) else {
            return Err(SigningError::PreparedPoolUnavailable);
        };
        let replay = active.operations.contains(&operation_id);
        let mut queue = Vec::with_capacity(active.reservations.len() * 32);
        for reservation in &active.reservations {
            queue.extend_from_slice(&reservation.id);
        }
        let binding = shake256(&[
            b"seams/ml-dsa/gmw-pool-request/v1",
            &active.key.binding,
            &operation_id,
            &[context_length],
            context,
            &shake256::<64>(&[message]),
            &queue,
            &[u8::from(replay)],
            &(active.operations.len() as u64).to_le_bytes(),
        ]);
        agree(active.key.role, &binding, transport).await?;
        if replay || active.operations.len() == MAX_OPERATIONS {
            self.state = State::Ready(active);
            return Err(if replay {
                SigningError::PreparedPoolReplay
            } else {
                SigningError::AttemptLimit
            });
        }
        active.operations.insert(operation_id);
        let mut exhausted = Vec::new();
        let mut outcome = PoolOutcome::Empty;
        while let Some(reservation) = active.reservations.pop_front() {
            let signer = reservation
                .activate_for_key(Rc::clone(&active.key), transport)
                .await?;
            match signer
                .sign(message, context, &operation_id, transport)
                .await?
            {
                GmwBatchResult::Signed(signature) => {
                    outcome = PoolOutcome::Signed(signature);
                    break;
                }
                GmwBatchResult::Exhausted(batch) => exhausted.push(batch),
            }
        }
        let remaining_batches = active.reservations.len();
        self.state = State::Ready(active);
        Ok(PoolResult {
            outcome,
            exhausted,
            remaining_batches,
        })
    }

    /// Adds one to ten new batches while retaining untouched older batches.
    /// The same key and epoch remain bound. Group IDs cannot repeat.
    /// Failure or cancellation poisons the pool; refill never restores consumed state.
    pub async fn replenish<T: Transport + BooleanTransport>(
        &mut self,
        id: [u8; 32],
        batches: u16,
        schedules: &'a [TrustedMlDsaSchedule<'a>],
        transport: &mut T,
    ) -> Result<()> {
        let State::Ready(mut active) = core::mem::replace(&mut self.state, State::Failed) else {
            return Err(SigningError::PreparedPoolUnavailable);
        };
        let duplicate = active.refill_ids.contains(&id);
        let invalid = batches == 0
            || batches > MAX_REFILL_BATCHES
            || active.reservations.len() + usize::from(batches) > MAX_READY_BATCHES
            || active.refill_ids.len() >= MAX_OPERATIONS;
        let binding = shake256(&[
            b"seams/ml-dsa/gmw-pool-refill/v1",
            &active.key.binding,
            &id,
            &batches.to_le_bytes(),
            &(active.reservations.len() as u64).to_le_bytes(),
            &[u8::from(duplicate), u8::from(invalid)],
        ]);
        agree(active.key.role, &binding, transport).await?;
        if duplicate || invalid {
            self.state = State::Ready(active);
            return Err(if duplicate {
                SigningError::PreparedPoolReplay
            } else {
                SigningError::AttemptLimit
            });
        }
        active.refill_ids.insert(id);
        let group = prepare_group(
            active.key.role,
            &id,
            active.candidates,
            batches,
            schedules,
            &mut self.topologies,
            transport,
        )
        .await?;
        active.reservations.extend(group);
        self.state = State::Ready(active);
        Ok(())
    }
}
