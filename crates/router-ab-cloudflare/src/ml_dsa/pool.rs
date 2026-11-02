//! Role-local lifecycle. A take destroys ciphertext before returning it.
use super::{
    admission::Permit,
    sealing::{Binding, Sealed, StockStamp},
    *,
};
const MAX_BATCHES: usize = 20;
#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum State {
    Ready,
    Reserved {
        request_digest: [u8; 32],
        expires_at_ms: u64,
    },
    Consumed {
        request_digest: [u8; 32],
        at_ms: u64,
    },
    Burned,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    binding: Binding,
    state: State,
    encapsulated_key: [u8; 32],
    chunks: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Inventory {
    pub ready: Vec<[u8; 32]>,
    /// Untouched material held by live operations. It cannot admit another request.
    pub reserved: Vec<[u8; 32]>,
    pub retry_at_ms: u64,
    pub refill_due: bool,
}
impl Inventory {
    pub(crate) fn stock_batches(&self) -> Vec<[u8; 32]> {
        let mut stock = self.ready.clone();
        stock.extend_from_slice(&self.reserved);
        stock
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Refill {
    key: KeyScope,
    target: usize,
    due: bool,
    retry_at_ms: u64,
}

/// Durable request for the Worker preprocessing dispatcher, scoped to one key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum RefillStatus {
    Sufficient,
    Requested {
        key: KeyScope,
        target: usize,
        retry_at_ms: u64,
    },
}
pub async fn refill_status(
    store: &impl Store,
    key: &KeyScope,
    now_ms: u64,
) -> Result<RefillStatus> {
    check_key(store, key).await?;
    let record = store
        .get::<Refill>(&format!("refill/{}", key_name(&key.key_id)?))
        .await?;
    match record {
        Some(value) if value.key == *key && value.due => Ok(RefillStatus::Requested {
            key: value.key,
            target: value.target,
            retry_at_ms: value.retry_at_ms.max(now_ms.saturating_add(1_000)),
        }),
        Some(value) if value.key == *key => Ok(RefillStatus::Sufficient),
        _ => Ok(RefillStatus::Requested {
            key: key.clone(),
            target: 10,
            retry_at_ms: now_ms.saturating_add(1_000),
        }),
    }
}

fn key_name(key_id: &Identifier) -> Result<String> {
    Ok(format!("key/{}", hex(&digest(b"key-slot", key_id)?)))
}
fn fence_name(request: &SigningRequest) -> Result<String> {
    Ok(format!("closed/{}", hex(&request.digest()?)))
}
async fn require_open(store: &impl Store, request: &SigningRequest) -> Result<()> {
    if store
        .get::<bool>(&fence_name(request)?)
        .await?
        .unwrap_or(false)
    {
        return Err(invalid("ML-DSA operation is durably fenced"));
    }
    Ok(())
}
/// The first durable fence records positive evidence before any release occurs.
/// Retrying after one role released must return the same observation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FencedBatches {
    pub request_digest: [u8; 32],
    pub batches: Vec<[u8; 32]>,
    pub consumed: Vec<[u8; 32]>,
    pub unopened: Vec<[u8; 32]>,
}
fn fence_evidence_name(request_digest: &[u8; 32]) -> String {
    format!("fence_evidence/{}", hex(request_digest))
}

/// Both roles must commit a fence before the coordinator can return untouched pairs.
pub async fn fence(
    store: &impl Store,
    request: &SigningRequest,
    batches: &[[u8; 32]],
) -> Result<FencedBatches> {
    if batches.len() > MAX_BATCHES {
        return Err(invalid("Too many ML-DSA settlement batches"));
    }
    let request_digest = request.digest()?;
    let evidence_name = fence_evidence_name(&request_digest);
    if let Some(evidence) = store.get::<FencedBatches>(&evidence_name).await? {
        if evidence.request_digest != request_digest || evidence.batches != batches {
            return Err(invalid("ML-DSA fence batches changed"));
        }
        return Ok(evidence);
    }
    store.put(&fence_name(request)?, &true).await?;
    let mut evidence = FencedBatches {
        request_digest,
        batches: batches.to_vec(),
        consumed: Vec::new(),
        unopened: Vec::new(),
    };
    for batch in batches {
        if let Some(record) = store.get::<Record>(&batch_name(batch)).await? {
            if record.binding.key != request.key {
                continue;
            }
            match record.state {
                State::Consumed {
                    request_digest: owner,
                    ..
                } if owner == request_digest => evidence.consumed.push(*batch),
                State::Reserved {
                    request_digest: owner,
                    ..
                } if owner == request_digest => evidence.unopened.push(*batch),
                _ => {}
            }
        }
    }
    store.put(&evidence_name, &evidence).await?;
    Ok(evidence)
}
fn reservation_name(request_digest: &[u8; 32]) -> String {
    format!("reservation/{}", hex(request_digest))
}

pub struct ExpiredReservation {
    pub request: SigningRequest,
    pub batches: Vec<[u8; 32]>,
}

/// Recovery uses the exact request to distinguish an unadmitted claim from signing.
pub async fn expired_reservations(
    store: &impl Store,
    key: &KeyScope,
    now: u64,
) -> Result<Vec<ExpiredReservation>> {
    check_key(store, key).await?;
    let mut expired: Vec<ExpiredReservation> = Vec::new();
    for id in index(store).await? {
        let record = store
            .get::<Record>(&batch_name(&id))
            .await?
            .ok_or_else(|| invalid("Missing preparation record"))?;
        let State::Reserved {
            request_digest,
            expires_at_ms,
        } = record.state
        else {
            continue;
        };
        if record.binding.key != *key || expires_at_ms > now {
            continue;
        }
        let Some(request) = store
            .get::<SigningRequest>(&reservation_name(&request_digest))
            .await?
        else {
            // Persisted reservations without a request retain conservative retirement.
            continue;
        };
        if request.key != *key || request.digest()? != request_digest {
            return Err(invalid("ML-DSA reservation request changed"));
        }
        if let Some(existing) = expired.iter_mut().find(|item| item.request == request) {
            existing.batches.push(id);
        } else {
            expired.push(ExpiredReservation {
                request,
                batches: vec![id],
            });
        }
    }
    Ok(expired)
}

/// The host first obtains an authoritative terminal status. Declined means no permit existed.
pub async fn settle_expired(
    store: &impl Store,
    reservation: &ExpiredReservation,
    settlement: Settlement,
) -> Result<()> {
    // Expiry recovery observes only the remaining reservations, not the full permit.
    // Close the request without creating or redefining the paired fence evidence.
    store.put(&fence_name(&reservation.request)?, &true).await?;
    release(
        store,
        &reservation.request,
        &reservation.batches,
        settlement,
        &[],
        &[],
    )
    .await
}

fn batch_name(batch: &[u8; 32]) -> String {
    format!("batch/{}", hex(batch))
}
fn chunk_prefix(batch: &[u8; 32]) -> String {
    format!("ciphertext/{}", hex(batch))
}
pub async fn installed_key(store: &impl Store, key_id: &Identifier) -> Result<Option<KeyScope>> {
    store.get(&key_name(key_id)?).await
}
pub(super) async fn check_key(store: &impl Store, key: &KeyScope) -> Result<()> {
    if installed_key(store, &key.key_id).await?.as_ref() != Some(key) {
        return Err(invalid("ML-DSA key or epoch is inactive"));
    }
    Ok(())
}
async fn index(store: &impl Store) -> Result<Vec<[u8; 32]>> {
    Ok(store.get("index").await?.unwrap_or_default())
}
async fn erase(store: &impl Store, record: &mut Record) -> Result<()> {
    sealing::erase_chunks(store, &chunk_prefix(&record.binding.batch), record.chunks).await?;
    record.chunks = 0;
    record.encapsulated_key = [0; 32];
    store.put(&batch_name(&record.binding.batch), record).await
}
/// Called by the authenticated custody completion path. Recovery advances the epoch.
/// Cooldown lives in the Router service and is unaffected by key replacement.
pub async fn install_key(store: &impl Store, key: KeyScope) -> Result<()> {
    if let Some(owner) = store.get::<WalletScope>("owner").await? {
        if owner != key.wallet {
            return Err(invalid("ML-DSA pool belongs to another wallet"));
        }
    } else {
        store.put("owner", &key.wallet).await?;
    }
    let name = key_name(&key.key_id)?;
    if let Some(current) = store.get::<KeyScope>(&name).await? {
        if current == key {
            return Ok(());
        }
        if current.public_key_digest != key.public_key_digest {
            return Err(invalid(
                "ML-DSA recovery must preserve the canonical public key",
            ));
        }
        if current.wallet != key.wallet || key.epoch <= current.epoch {
            return Err(invalid("ML-DSA key activation must advance its epoch"));
        }
        let mut retained = Vec::new();
        for id in index(store).await? {
            let mut record = store
                .get::<Record>(&batch_name(&id))
                .await?
                .ok_or_else(|| invalid("Missing preparation record"))?;
            if record.binding.key.key_id == key.key_id {
                record.state = State::Burned;
                erase(store, &mut record).await?;
            } else {
                retained.push(id);
            }
        }
        store.put("index", &retained).await?;
    }
    store.delete(&format!("refill/{name}")).await?;
    store.put(&name, &key).await
}
/// Duplicate IDs are permanent refusals, including after consumption or recovery.
pub async fn put(store: &impl Store, binding: Binding, sealed: Sealed, now_ms: u64) -> Result<()> {
    check_key(store, &binding.key).await?;
    sealed.validate()?;
    if binding.expires_at_ms <= now_ms
        || store
            .get::<Record>(&batch_name(&binding.batch))
            .await?
            .is_some()
    {
        return Err(invalid("Expired or duplicate ML-DSA preparation"));
    }
    let mut ids = index(store).await?;
    if ids.len() >= MAX_BATCHES {
        return Err(invalid("ML-DSA pool capacity reached"));
    }
    let chunks = sealed
        .store_chunks(store, &chunk_prefix(&binding.batch))
        .await?;
    let batch = binding.batch;
    store
        .put(
            &batch_name(&batch),
            &Record {
                binding,
                state: State::Ready,
                encapsulated_key: sealed.encapsulated_key,
                chunks,
            },
        )
        .await?;
    ids.push(batch);
    store.put("index", &ids).await
}
/// A restore, a wrapping key change or a format change makes older stock unusable.
/// Burning it here also frees its capacity for fresh stock.
pub async fn burn_stale(store: &impl Store, stamp: &StockStamp) -> Result<usize> {
    let original = index(store).await?;
    let mut retained = Vec::with_capacity(original.len());
    for &id in &original {
        let mut record = store
            .get::<Record>(&batch_name(&id))
            .await?
            .ok_or_else(|| invalid("Missing preparation record"))?;
        if stamp.is_current(&record.binding) {
            retained.push(id);
        } else {
            record.state = State::Burned;
            erase(store, &mut record).await?;
        }
    }
    if retained != original {
        store.put("index", &retained).await?;
    }
    Ok(original.len() - retained.len())
}
pub async fn inventory(
    store: &impl Store,
    key: &KeyScope,
    target: usize,
    now_ms: u64,
    ready_until_ms: u64,
) -> Result<Inventory> {
    check_key(store, key).await?;
    if ready_until_ms < now_ms {
        return Err(invalid("ML-DSA readiness window is expired"));
    }
    let mut ready = Vec::new();
    let mut reserved = Vec::new();
    let mut retained = Vec::new();
    let original = index(store).await?;
    for &id in &original {
        let mut record = store
            .get::<Record>(&batch_name(&id))
            .await?
            .ok_or_else(|| invalid("Missing preparation record"))?;
        if record.binding.expires_at_ms <= now_ms {
            record.state = State::Burned;
            erase(store, &mut record).await?;
            continue;
        }
        if let State::Reserved {
            request_digest,
            expires_at_ms,
        } = &record.state
        {
            if *expires_at_ms <= now_ms {
                if store
                    .get::<SigningRequest>(&reservation_name(request_digest))
                    .await?
                    .is_some()
                {
                    // Keep ciphertext unavailable until authoritative recovery settles it.
                    // This also covers a claim that expires after the recovery snapshot.
                    if record.binding.key == *key && record.binding.expires_at_ms >= ready_until_ms
                    {
                        reserved.push(id);
                    }
                    retained.push(id);
                    continue;
                }
                // Old persisted reservations lack the request needed for safe recovery.
                record.state = State::Burned;
                erase(store, &mut record).await?;
                continue;
            }
        }
        if record.binding.key == *key && record.binding.expires_at_ms >= ready_until_ms {
            match record.state {
                State::Ready => ready.push(id),
                State::Reserved { .. } => reserved.push(id),
                State::Consumed { .. } | State::Burned => {}
            }
        }
        retained.push(id);
    }
    if retained != original {
        store.put("index", &retained).await?;
    }
    let refill_due = ready.len() + reserved.len() < target;
    let refill_key = format!("refill/{}", key_name(&key.key_id)?);
    let previous = store.get::<Refill>(&refill_key).await?;
    let retry_at_ms = match &previous {
        Some(value) => value.retry_at_ms,
        None => now_ms.saturating_add(1_000),
    }
    .max(now_ms.saturating_add(1_000));
    let changed = match &previous {
        Some(value) => value.key != *key || value.target != target || value.due != refill_due,
        None => true,
    };
    // Query time is clamped in the response. Persist only a lifecycle change.
    if changed {
        store
            .put(
                &refill_key,
                &Refill {
                    key: key.clone(),
                    target,
                    due: refill_due,
                    retry_at_ms,
                },
            )
            .await?;
    }
    Ok(Inventory {
        ready,
        reserved,
        retry_at_ms,
        refill_due,
    })
}
/// Reserves only encrypted, untouched batches. No key material is opened here.
pub async fn reserve(
    store: &impl Store,
    request: &SigningRequest,
    batches: &[[u8; 32]],
    expires_at_ms: u64,
    now_ms: u64,
) -> Result<()> {
    require_open(store, request).await?;
    check_key(store, &request.key).await?;
    if batches.is_empty()
        || batches.len() > MAX_BATCHES
        || expires_at_ms <= now_ms
        || batches
            .iter()
            .enumerate()
            .any(|(i, id)| batches[..i].contains(id))
    {
        return Err(invalid("Invalid ML-DSA reservation"));
    }
    let binding = request.digest()?;
    store.put(&reservation_name(&binding), request).await?;
    for id in batches {
        let name = batch_name(id);
        let mut record = store
            .get::<Record>(&name)
            .await?
            .ok_or_else(|| invalid("ML-DSA pool is empty"))?;
        if record.binding.key != request.key || record.binding.expires_at_ms < expires_at_ms {
            return Err(invalid("ML-DSA preparation scope or lifetime changed"));
        }
        match record.state {
            State::Ready => {}
            State::Reserved {
                request_digest,
                expires_at_ms: deadline,
            } if request_digest == binding && deadline == expires_at_ms => continue,
            _ => return Err(invalid("ML-DSA preparation is unavailable")),
        }
        record.state = State::Reserved {
            request_digest: binding,
            expires_at_ms,
        };
        store.put(&name, &record).await?;
    }
    Ok(())
}
/// The host verifies the live Router permit before entering this transaction.
/// Lost responses burn material. A repeated take never returns its ciphertext.
pub async fn take(
    store: &impl Store,
    role: Participant,
    permit: &Permit,
    batch: [u8; 32],
    now_ms: u64,
) -> Result<(Binding, Sealed)> {
    require_open(store, &permit.request).await?;
    check_key(store, &permit.request.key).await?;
    if now_ms >= permit.expires_at_ms || !permit.batches.contains(&batch) {
        return Err(invalid("Expired or substituted ML-DSA permit"));
    }
    let mut record = store
        .get::<Record>(&batch_name(&batch))
        .await?
        .ok_or_else(|| invalid("Missing ML-DSA reservation"))?;
    let valid = matches!(record.state, State::Reserved { request_digest, expires_at_ms } if request_digest == permit.request.digest()? && permit.expires_at_ms <= expires_at_ms);
    if !valid
        || record.binding.key != permit.request.key
        || record.binding.role != role
        || record.binding.expires_at_ms <= now_ms
    {
        return Err(invalid("ML-DSA reservation was consumed or substituted"));
    }
    let sealed = Sealed::load_chunks(
        store,
        &chunk_prefix(&batch),
        record.chunks,
        record.encapsulated_key,
    )
    .await?;
    record.state = State::Consumed {
        request_digest: permit.request.digest()?,
        at_ms: now_ms,
    };
    erase(store, &mut record).await?;
    let mut ids = index(store).await?;
    ids.retain(|id| *id != batch);
    store.put("index", &ids).await?;
    let refill_key = format!("refill/{}", key_name(&permit.request.key.key_id)?);
    let target = store
        .get::<Refill>(&refill_key)
        .await?
        .map(|value| value.target)
        .unwrap_or(10);
    store
        .put(
            &refill_key,
            &Refill {
                key: permit.request.key.clone(),
                target,
                due: true,
                retry_at_ms: now_ms.saturating_add(20_000),
            },
        )
        .await?;
    Ok((record.binding, sealed))
}
/// Public lifecycle status used to remove unmatched halves after interruption.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BatchAvailability {
    Missing,
    Ready,
    Reserved,
    Retired,
}
pub async fn inspect(
    store: &impl Store,
    key: &KeyScope,
    batches: &[[u8; 32]],
) -> Result<Vec<BatchAvailability>> {
    check_key(store, key).await?;
    if batches.len() > MAX_BATCHES {
        return Err(invalid("Too many ML-DSA batches"));
    }
    let mut states = Vec::with_capacity(batches.len());
    for batch in batches {
        let state = match store.get::<Record>(&batch_name(batch)).await? {
            None => BatchAvailability::Missing,
            Some(record) if record.binding.key != *key => BatchAvailability::Retired,
            Some(record) => match record.state {
                State::Ready => BatchAvailability::Ready,
                State::Reserved { .. } => BatchAvailability::Reserved,
                State::Consumed { .. } | State::Burned => BatchAvailability::Retired,
            },
        };
        states.push(state);
    }
    Ok(states)
}
/// Publication evidence survives consumption and retirement. It grants no use rights.
pub async fn publication_recorded(
    store: &impl Store,
    key: &KeyScope,
    batches: &[[u8; 32]],
    expires_at_ms: u64,
) -> Result<bool> {
    check_key(store, key).await?;
    if batches.is_empty() || batches.len() > MAX_BATCHES {
        return Err(invalid("Invalid ML-DSA publication batch count"));
    }
    for batch in batches {
        let Some(record) = store.get::<Record>(&batch_name(batch)).await? else {
            return Ok(false);
        };
        if record.binding.key != *key
            || record.binding.batch != *batch
            || record.binding.expires_at_ms != expires_at_ms
        {
            return Ok(false);
        }
    }
    Ok(true)
}

/// The authenticated coordinator calls this only for a permanent peer tombstone.
/// A missing or temporarily reserved peer is never enough to retire a ready half.
pub async fn retire_unpaired(
    store: &impl Store,
    key: &KeyScope,
    batches: &[[u8; 32]],
) -> Result<()> {
    check_key(store, key).await?;
    if batches.len() > MAX_BATCHES {
        return Err(invalid("Too many ML-DSA batches"));
    }
    let mut ids = index(store).await?;
    for batch in batches {
        if let Some(mut record) = store.get::<Record>(&batch_name(batch)).await? {
            if record.binding.key == *key && matches!(record.state, State::Ready) {
                record.state = State::Burned;
                erase(store, &mut record).await?;
                ids.retain(|id| id != batch);
            }
        }
    }
    store.put("index", &ids).await
}

/// Router admission recorded these batches as spent, so a role that still holds them was
/// restored from an earlier state. They must never open again.
pub async fn retire_spent(store: &impl Store, key: &KeyScope, batches: &[[u8; 32]]) -> Result<()> {
    check_key(store, key).await?;
    if batches.len() > MAX_BATCHES {
        return Err(invalid("Too many ML-DSA batches"));
    }
    let mut ids = index(store).await?;
    for batch in batches {
        if let Some(mut record) = store.get::<Record>(&batch_name(batch)).await? {
            if record.binding.key == *key {
                record.state = State::Burned;
                erase(store, &mut record).await?;
                ids.retain(|id| id != batch);
            }
        }
    }
    store.put("index", &ids).await
}

/// Settlement comes from the Router's authoritative terminal operation state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Settlement {
    Succeeded,
    Declined,
    Failed,
}

/// Failed signing retains only pairs positively observed unopened at both roles.
/// Uncertain or consumed material remains unavailable.
pub async fn release(
    store: &impl Store,
    request: &SigningRequest,
    batches: &[[u8; 32]],
    settlement: Settlement,
    consumed_union: &[[u8; 32]],
    unopened_intersection: &[[u8; 32]],
) -> Result<()> {
    if !store
        .get::<bool>(&fence_name(request)?)
        .await?
        .unwrap_or(false)
    {
        return Err(invalid("ML-DSA settlement requires a durable fence"));
    }
    let digest = request.digest()?;
    if !unopened_intersection.is_empty() {
        let evidence = store
            .get::<FencedBatches>(&fence_evidence_name(&digest))
            .await?
            .ok_or_else(|| invalid("ML-DSA unopened evidence is missing"))?;
        if evidence.request_digest != digest
            || evidence.batches != batches
            || unopened_intersection
                .iter()
                .any(|id| !evidence.unopened.contains(id) || consumed_union.contains(id))
        {
            return Err(invalid("ML-DSA unopened evidence changed"));
        }
    }
    let mut ids = index(store).await?;
    for id in batches {
        if let Some(mut record) = store.get::<Record>(&batch_name(id)).await? {
            if matches!(record.state, State::Reserved { request_digest, .. } if request_digest == digest)
            {
                match settlement {
                    Settlement::Succeeded | Settlement::Declined
                        if !consumed_union.contains(id) =>
                    {
                        record.state = State::Ready;
                        store.put(&batch_name(id), &record).await?;
                    }
                    Settlement::Failed
                        if unopened_intersection.contains(id) && !consumed_union.contains(id) =>
                    {
                        record.state = State::Ready;
                        store.put(&batch_name(id), &record).await?;
                    }
                    _ => {
                        record.state = State::Burned;
                        erase(store, &mut record).await?;
                        ids.retain(|entry| entry != id);
                    }
                }
            }
        }
    }
    store.put("index", &ids).await
}

/// Registration may retry an identical delivery before activation enables signing.
/// Consumed, reserved, burned, or changed records remain permanent refusals.
pub async fn install_registration_batch(
    store: &impl Store,
    binding: Binding,
    sealed: Sealed,
    now: u64,
) -> Result<()> {
    check_key(store, &binding.key).await?;
    if binding.expires_at_ms <= now {
        return Err(invalid("Registration signing stock expired"));
    }
    if let Some(record) = store.get::<Record>(&batch_name(&binding.batch)).await? {
        if record.binding != binding || !matches!(record.state, State::Ready) {
            return Err(invalid("Registration signing stock is consumed or changed"));
        }
        let stored = Sealed::load_chunks(
            store,
            &chunk_prefix(&binding.batch),
            record.chunks,
            record.encapsulated_key,
        )
        .await?;
        if digest(b"registration-batch-delivery", &stored)?
            != digest(b"registration-batch-delivery", &sealed)?
        {
            return Err(invalid("Registration signing ciphertext changed"));
        }
        return Ok(());
    }
    put(store, binding, sealed, now).await
}
