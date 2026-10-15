//! Role-local lifecycle. A take destroys ciphertext before returning it.
use super::{
    admission::Permit,
    sealing::{Binding, Sealed},
    *,
};
use base64::{engine::general_purpose::STANDARD, Engine};
const CHUNK_BYTES: usize = 48 * 1024;
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
    pub retry_at_ms: u64,
    pub refill_due: bool,
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
        .get::<Refill>(&format!("refill/{}", key_name(key)?))
        .await?;
    match record {
        Some(value) if value.key == *key && value.due => Ok(RefillStatus::Requested {
            key: value.key,
            target: value.target,
            retry_at_ms: value.retry_at_ms,
        }),
        Some(value) if value.key == *key => Ok(RefillStatus::Sufficient),
        _ => Ok(RefillStatus::Requested {
            key: key.clone(),
            target: 10,
            retry_at_ms: now_ms.saturating_add(1_000),
        }),
    }
}

fn key_name(key: &KeyScope) -> Result<String> {
    Ok(format!("key/{}", hex(&digest(b"key-slot", &key.key_id)?)))
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
/// Fence both roles before reconciling consumed IDs. A delayed take cannot race
/// with returning untouched pairs to the ready pool after successful signing.
pub async fn fence(
    store: &impl Store,
    request: &SigningRequest,
    batches: &[[u8; 32]],
) -> Result<Vec<[u8; 32]>> {
    if batches.len() > MAX_BATCHES {
        return Err(invalid("Too many ML-DSA settlement batches"));
    }
    let request_digest = request.digest()?;
    store.put(&fence_name(request)?, &true).await?;
    let mut consumed = Vec::new();
    for batch in batches {
        if let Some(record) = store.get::<Record>(&batch_name(batch)).await? {
            if record.binding.key == request.key
                && matches!(record.state, State::Consumed { request_digest: owner, .. } if owner == request_digest)
            {
                consumed.push(*batch);
            }
        }
    }
    Ok(consumed)
}
fn batch_name(batch: &[u8; 32]) -> String {
    format!("batch/{}", hex(batch))
}
fn chunk_name(batch: &[u8; 32], chunk: usize) -> String {
    format!("ciphertext/{}/{chunk}", hex(batch))
}
async fn check_key(store: &impl Store, key: &KeyScope) -> Result<()> {
    if store.get::<KeyScope>(&key_name(key)?).await?.as_ref() != Some(key) {
        return Err(invalid("ML-DSA key or epoch is inactive"));
    }
    Ok(())
}
async fn index(store: &impl Store) -> Result<Vec<[u8; 32]>> {
    Ok(store.get("index").await?.unwrap_or_default())
}
async fn erase(store: &impl Store, record: &mut Record) -> Result<()> {
    for chunk in 0..record.chunks {
        store
            .delete(&chunk_name(&record.binding.batch, chunk))
            .await?;
    }
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
    let name = key_name(&key)?;
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
    for (chunk, bytes) in sealed.ciphertext.chunks(CHUNK_BYTES).enumerate() {
        store
            .put(&chunk_name(&binding.batch, chunk), &STANDARD.encode(bytes))
            .await?;
    }
    let chunks = sealed.ciphertext.len().div_ceil(CHUNK_BYTES);
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
    let mut retained = Vec::new();
    for id in index(store).await? {
        let mut record = store
            .get::<Record>(&batch_name(&id))
            .await?
            .ok_or_else(|| invalid("Missing preparation record"))?;
        if record.binding.expires_at_ms <= now_ms {
            record.state = State::Burned;
            erase(store, &mut record).await?;
            continue;
        }
        if matches!(record.state, State::Reserved { expires_at_ms, .. } if expires_at_ms <= now_ms)
        {
            // The peer may already have consumed its half. An expired pair is burned.
            record.state = State::Burned;
            erase(store, &mut record).await?;
            continue;
        }
        if record.binding.key == *key
            && matches!(record.state, State::Ready)
            && record.binding.expires_at_ms >= ready_until_ms
        {
            ready.push(id);
        }
        retained.push(id);
    }
    store.put("index", &retained).await?;
    let refill_due = ready.len() < target;
    let refill_key = format!("refill/{}", key_name(key)?);
    let previous = store.get::<Refill>(&refill_key).await?;
    let retry_at_ms = previous
        .map(|value| value.retry_at_ms)
        .unwrap_or(now_ms.saturating_add(1_000))
        .max(now_ms.saturating_add(1_000));
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
    Ok(Inventory {
        ready,
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
    let mut ciphertext = Vec::new();
    if record.chunks == 0 || record.chunks > (16usize * 1024 * 1024 + 16).div_ceil(CHUNK_BYTES) {
        return Err(invalid("Invalid ML-DSA chunk count"));
    }
    for chunk in 0..record.chunks {
        let encoded = store
            .get::<String>(&chunk_name(&batch, chunk))
            .await?
            .ok_or_else(|| invalid("Missing ML-DSA ciphertext chunk"))?;
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| invalid("Invalid ML-DSA ciphertext chunk"))?;
        if bytes.len() > CHUNK_BYTES {
            return Err(invalid("Oversized ML-DSA ciphertext chunk"));
        }
        ciphertext.extend_from_slice(&bytes);
    }
    let sealed = Sealed {
        encapsulated_key: record.encapsulated_key,
        ciphertext,
    };
    sealed.validate()?;
    record.state = State::Consumed {
        request_digest: permit.request.digest()?,
        at_ms: now_ms,
    };
    erase(store, &mut record).await?;
    let mut ids = index(store).await?;
    ids.retain(|id| *id != batch);
    store.put("index", &ids).await?;
    let refill_key = format!("refill/{}", key_name(&permit.request.key)?);
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

/// Settlement comes from the Router's authoritative terminal operation state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Settlement {
    Succeeded,
    Declined,
    Failed,
}

/// Successful sequential signing retains only unopened batches. An admitted
/// failure burns all remaining halves because peer consumption may be unknown.
pub async fn release(
    store: &impl Store,
    request: &SigningRequest,
    batches: &[[u8; 32]],
    settlement: Settlement,
    consumed_union: &[[u8; 32]],
) -> Result<()> {
    if !store
        .get::<bool>(&fence_name(request)?)
        .await?
        .unwrap_or(false)
    {
        return Err(invalid("ML-DSA settlement requires a durable fence"));
    }
    let digest = request.digest()?;
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
