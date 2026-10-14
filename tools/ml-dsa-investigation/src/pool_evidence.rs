//! Separate-process pool drain, rollover, refill, replay, and cancellation E2E.

use crate::{
    InvestigationResult, boolean_engine_evidence::run_ready,
    prepared_keygen_evidence::HostTransport, reference, require,
};
use ed25519_yao::{
    ml_dsa_runtime::{
        RuntimeError, TrustedMlDsaSchedule,
        prepared::{Phase, Transport},
    },
    ml_dsa_signing::{
        OwnSigningShare, SigningError, SigningRole,
        prepared_signing::gmw::pool::{PoolOutcome, PreparedGmwPool, ReadyGmwPool},
    },
};
use serde_json::{Value, json};
use std::{
    future::{Future, pending},
    task::{Context, Poll, Waker},
    time::Instant,
};

fn operation_id(index: u32) -> [u8; 32] {
    let mut id = [0x70; 32];
    id[..4].copy_from_slice(&index.to_le_bytes());
    id
}

pub(super) fn run(
    role: SigningRole,
    own: OwnSigningShare,
    public_key: &[u8; 1952],
    schedules: &[TrustedMlDsaSchedule<'_>],
    id: [u8; 32],
    transport: &mut HostTransport,
) -> InvestigationResult<Value> {
    let total = Instant::now();
    let started = Instant::now();
    let generic = run_ready(PreparedGmwPool::prepare(
        role, id, 4, 1, schedules, transport,
    ))??;
    let first_preparation_ns = started.elapsed().as_nanos();
    let initial = generic.inventory();
    let started = Instant::now();
    let mut pool = run_ready(generic.activate(own, public_key, [1; 32], transport))??;
    let activation_ns = started.elapsed().as_nanos();
    let mut operations = Vec::new();
    let mut ordinal = 0;
    transport.phase(Phase::Online);
    drain(
        &mut pool,
        public_key,
        transport,
        &mut ordinal,
        &mut operations,
    )?;
    let empty = run_ready(pool.sign(b"empty", b"", operation_id(ordinal), transport))??;
    require(
        matches!(empty.outcome, PoolOutcome::Empty) && empty.exhausted.is_empty(),
        "Empty pool performed private work",
    )?;
    ordinal += 1;
    transport.phase(Phase::Offline);
    let mut refill_id = id;
    refill_id[0] ^= 1;
    let started = Instant::now();
    run_ready(pool.replenish(refill_id, 10, schedules, transport))??;
    let ten_preparation_ns = started.elapsed().as_nanos();
    let ten = pool.inventory()?;
    require(
        ten.batches == 10 && ten.public_topology_bytes == initial.public_topology_bytes,
        "Refill duplicated public topology",
    )?;
    let duplicate = run_ready(pool.replenish(refill_id, 10, schedules, transport))?;
    require(
        matches!(duplicate, Err(SigningError::PreparedPoolReplay)),
        "Refill ID replay accepted",
    )?;
    require(
        pool.inventory()?.batches == 10,
        "Rejected refill changed the pool",
    )?;
    transport.phase(Phase::Online);
    drain(
        &mut pool,
        public_key,
        transport,
        &mut ordinal,
        &mut operations,
    )?;
    transport.phase(Phase::Offline);
    refill_id[0] ^= 2;
    run_ready(pool.replenish(refill_id, 1, schedules, transport))??;
    let mut suspended = SuspendedTransport;
    {
        let mut future = Box::pin(pool.sign(b"cancel", b"", operation_id(ordinal), &mut suspended));
        let mut context = Context::from_waker(Waker::noop());
        require(
            matches!(future.as_mut().poll(&mut context), Poll::Pending),
            "Cancellation fixture did not suspend",
        )?;
    }
    require(
        matches!(pool.inventory(), Err(SigningError::PreparedPoolUnavailable)),
        "Cancellation restored the pool",
    )?;
    let retry = run_ready(pool.sign(b"retry", b"", operation_id(ordinal + 1), &mut suspended))?;
    require(
        matches!(retry, Err(SigningError::PreparedPoolUnavailable)),
        "Poisoned pool allowed retry",
    )?;
    Ok(json!({
        "result": {"status": "pool-complete", "operations": operations, "empty_pool_checked": true,
            "operation_replay_rejected": true, "refill_replay_rejected": true, "cancellation_poisoned_pool": true},
        "initial_batch_preparation_ns": first_preparation_ns, "ten_batch_refill_ns": ten_preparation_ns,
        "activation_ns": activation_ns, "whole_ns": total.elapsed().as_nanos(),
        "initial_inventory": {"batches": initial.batches, "private_bytes": initial.private_bytes, "public_bytes": initial.public_topology_bytes},
        "ten_inventory": {"batches": ten.batches, "private_bytes": ten.private_bytes, "public_bytes": ten.public_topology_bytes},
        "offline": transport.counts[0].json(), "online": transport.counts[1].json(),
    }))
}

fn drain(
    pool: &mut ReadyGmwPool<'_>,
    public_key: &[u8; 1952],
    transport: &mut HostTransport,
    ordinal: &mut u32,
    operations: &mut Vec<Value>,
) -> InvestigationResult<()> {
    while pool.inventory()?.batches != 0 {
        let id = operation_id(*ordinal);
        let message = format!("pool-message-{ordinal}").into_bytes();
        let before = pool.inventory()?.batches;
        let started = Instant::now();
        let result = run_ready(pool.sign(&message, b"pool-e2e", id, transport))??;
        let elapsed_ns = started.elapsed().as_nanos();
        let mut report = json!({"operation": ordinal, "elapsed_ns": elapsed_ns,
            "exhausted_batches": result.exhausted.len(), "remaining_batches": result.remaining_batches,
            "message_hex": hex::encode(&message), "context_hex": hex::encode(b"pool-e2e")});
        let consumed = match result.outcome {
            PoolOutcome::Signed(signature) => {
                reference::verify_signature_rustcrypto(
                    public_key,
                    &message,
                    b"pool-e2e",
                    &signature.signature,
                )?;
                report["status"] = json!("signed");
                report["signature_hex"] = json!(hex::encode(signature.signature));
                result.exhausted.len() + 1
            }
            PoolOutcome::Empty => {
                report["status"] = json!("empty");
                result.exhausted.len()
            }
        };
        require(
            before - result.remaining_batches == consumed && consumed > 0,
            "Pool lost reservation accounting",
        )?;
        let replay = run_ready(pool.sign(b"different message", b"pool-e2e", id, transport))?;
        require(
            matches!(replay, Err(SigningError::PreparedPoolReplay)),
            "Operation replay accepted",
        )?;
        require(
            pool.inventory()?.batches == result.remaining_batches,
            "Replay consumed a fresh batch",
        )?;
        operations.push(report);
        *ordinal += 1;
    }
    Ok(())
}

pub(super) fn verify(public_key: &[u8], a: &Value, b: &Value) -> InvestigationResult<Value> {
    let operations = a["result"]["operations"]
        .as_array()
        .ok_or("Missing pool operations")?;
    let peer = b["result"]["operations"]
        .as_array()
        .ok_or("Missing peer operations")?;
    require(
        operations.len() == peer.len(),
        "Pool roles disagree on operations",
    )?;
    let mut signatures = 0;
    let mut rollovers = 0;
    for (own, peer) in operations.iter().zip(peer) {
        for field in [
            "status",
            "signature_hex",
            "remaining_batches",
            "exhausted_batches",
        ] {
            require(own[field] == peer[field], "Pool roles disagree")?;
        }
        if own["status"] == "signed" {
            reference::verify_threshold_signature(
                public_key,
                &hex::decode(own["message_hex"].as_str().ok_or("Missing message")?)?,
                &hex::decode(own["context_hex"].as_str().ok_or("Missing context")?)?,
                &hex::decode(own["signature_hex"].as_str().ok_or("Missing signature")?)?,
            )?;
            signatures += 1;
            rollovers += usize::from(
                own["exhausted_batches"]
                    .as_u64()
                    .ok_or("Missing exhaustion count")?
                    > 0,
            );
        }
    }
    require(signatures > 0, "No pool signature verified")?;
    Ok(json!({"verified_signatures": signatures, "successful_automatic_rollovers": rollovers}))
}

struct SuspendedTransport;
impl Transport for SuspendedTransport {
    async fn send(&mut self, _: &[u8]) -> Result<(), RuntimeError> {
        pending().await
    }
    async fn receive(&mut self, _: usize) -> Result<Vec<u8>, RuntimeError> {
        pending().await
    }
    async fn store(&mut self, _: [u8; 32], _: usize, _: &[u8]) -> Result<(), RuntimeError> {
        pending().await
    }
    async fn load(&mut self, _: [u8; 32], _: usize, _: usize) -> Result<Vec<u8>, RuntimeError> {
        pending().await
    }
    fn phase(&mut self, _: Phase) {}
}
impl ed25519_yao::ml_dsa_runtime::boolean_comparison::Transport for SuspendedTransport {
    async fn send(&mut self, _: &[u8]) -> Result<(), RuntimeError> {
        pending().await
    }
    async fn receive(&mut self, _: usize) -> Result<Vec<u8>, RuntimeError> {
        pending().await
    }
    fn phase(&mut self, _: ed25519_yao::ml_dsa_runtime::boolean_comparison::Phase) {}
}
