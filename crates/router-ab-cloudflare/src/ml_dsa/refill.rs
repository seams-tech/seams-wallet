//! Bounded preprocessing leases. Waiting keys have priority over spare-slot borrowing.
use super::*;
use std::{collections::BTreeSet, num::NonZeroU8};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Groups {
    One,
    Two,
}
impl Groups {
    pub fn count(self) -> usize {
        match self {
            Self::One => 1,
            Self::Two => 2,
        }
    }
}
/// Public identities already visible or promised by live preparation jobs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OccupiedBatches(BTreeSet<[u8; 32]>);
impl OccupiedBatches {
    pub fn new(batches: impl IntoIterator<Item = [u8; 32]>) -> Self {
        Self(batches.into_iter().collect())
    }
    pub fn from_inventories(a: &pool::Inventory, b: &pool::Inventory) -> Self {
        Self::new(a.stock_batches().into_iter().chain(b.stock_batches()))
    }
    pub fn include_pending(mut self, jobs: &[Job]) -> Self {
        for job in jobs {
            self.0.extend(job.batch_ids());
        }
        self
    }
    pub fn contains(&self, batch: &[u8; 32]) -> bool {
        self.0.contains(batch)
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProducerSlot {
    #[default]
    Primary,
    Secondary,
}
impl ProducerSlot {
    const ALL: [Self; 2] = [Self::Primary, Self::Secondary];

    fn storage_key(self) -> &'static str {
        match self {
            Self::Primary => "preprocessing-active",
            Self::Secondary => "preprocessing-active-secondary",
        }
    }

    fn backoff_key(self) -> &'static str {
        match self {
            Self::Primary => "preprocessing-backoff",
            Self::Secondary => "preprocessing-backoff-secondary",
        }
    }

    pub fn namespace(self) -> &'static str {
        match self {
            Self::Primary => "ML_DSA_PRODUCER_DO",
            Self::Secondary => "ML_DSA_SECONDARY_PRODUCER_DO",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Job {
    // Stored jobs and requests predating multiple slots belong to the primary slot.
    #[serde(default)]
    pub producer_slot: ProducerSlot,
    pub key: KeyScope,
    pub batch: [u8; 32],
    pub groups: Groups,
    pub expires_at_ms: u64,
    pub material_expires_at_ms: u64,
    /// Stock when this lease started. Settlement uses it to keep a key's priority.
    #[serde(default)]
    pub occupied_batches: usize,
}
impl Job {
    pub fn batch_ids(&self) -> Vec<[u8; 32]> {
        let mut ids = vec![self.batch];
        if self.groups == Groups::Two {
            let mut hash = Sha256::new();
            hash.update(b"seams/ml-dsa/preparation-second-pair/v1");
            hash.update(self.batch);
            ids.push(hash.finalize().into());
        }
        ids
    }
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum Claim {
    Acquired { job: Job },
    Busy { retry_at_ms: u64 },
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Published,
    Unused,
    Failed,
    Interrupted,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RetryBackoff {
    consecutive_failures: NonZeroU8,
    retry_at_ms: u64,
}
const RETRY_DELAYS_MS: [u64; 5] = [2_000, 4_000, 8_000, 16_000, 30_000];
const WAITING: &str = "preprocessing-waiting";
const MAX_WAITING_KEYS: usize = 64;
const DEMAND_LIFETIME_MS: u64 = 30_000;
// Untouched material remains key/epoch-bound and single-use. Producer and operation
// leases stay short; this deadline only limits encrypted stock retention.
pub(super) const MATERIAL_LIFETIME_MS: u64 = 60 * 60 * 1_000;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Waiting {
    key: KeyScope,
    expires_at_ms: u64,
    #[serde(default)]
    below_minimum: bool,
}
/// A key below the signing minimum cannot sign, so it goes ahead of keys that can.
/// The sort is stable, so each group keeps its queue order.
fn order_waiting(waiting: &mut [Waiting]) {
    waiting.sort_by_key(|entry| !entry.below_minimum);
}
pub async fn claim(
    store: &impl Store,
    policy: &policy::Policy,
    key: KeyScope,
    occupied: OccupiedBatches,
    now: u64,
) -> Result<Claim> {
    if admission::active_key(store, &key)
        .await?
        .map(|value| value.key)
        .as_ref()
        != Some(&key)
    {
        return Err(invalid("ML-DSA preprocessing key is inactive"));
    }
    let active = active_jobs(store, now).await?;
    let owns_producer = active.iter().any(|job| job.key == key);
    let own_jobs: Vec<Job> = active
        .iter()
        .filter(|job| job.key == key)
        .cloned()
        .collect();
    let occupied_batches = occupied.include_pending(&own_jobs).len();
    let below_minimum = occupied_batches < policy.minimum_ready_batches();
    let remaining = policy
        .refill_target_batches()
        .saturating_sub(occupied_batches);
    if remaining == 0 {
        withdraw(store, &key).await?;
        return Ok(Claim::Busy {
            retry_at_ms: now.saturating_add(5_000),
        });
    }
    let groups = policy.preparation_groups(remaining);
    let original: Vec<Waiting> = store.get(WAITING).await?.unwrap_or_default();
    let mut waiting = Vec::new();
    let mut queued = false;
    for mut entry in original.iter().cloned() {
        if entry.expires_at_ms <= now {
            continue;
        }
        if entry.key == key {
            if owns_producer {
                continue;
            }
            entry.expires_at_ms = now.saturating_add(DEMAND_LIFETIME_MS);
            entry.below_minimum = below_minimum;
            queued = true;
        } else if admission::active_key(store, &entry.key)
            .await?
            .map(|value| value.key)
            .as_ref()
            != Some(&entry.key)
        {
            continue;
        }
        waiting.push(entry);
    }
    if !owns_producer && !queued && waiting.len() < MAX_WAITING_KEYS {
        waiting.push(Waiting {
            key: key.clone(),
            expires_at_ms: now.saturating_add(DEMAND_LIFETIME_MS),
            below_minimum,
        });
    }
    order_waiting(&mut waiting);
    let busy = Claim::Busy {
        retry_at_ms: now.saturating_add(5_000),
    };
    let has_priority = if owns_producer {
        waiting.is_empty()
    } else {
        waiting.first().map(|entry| &entry.key) == Some(&key)
    };
    if !has_priority {
        persist_waiting(store, &original, &waiting).await?;
        return Ok(busy);
    }
    let foreground = admission::active_until(store, now)
        .await?
        .max(registration::active_until(store, now).await?);
    if let Some(retry_at_ms) = foreground {
        persist_waiting(store, &original, &waiting).await?;
        return Ok(Claim::Busy {
            retry_at_ms: retry_at_ms.min(now.saturating_add(5_000)),
        });
    }
    if active.len() >= policy.max_active_preparations {
        persist_waiting(store, &original, &waiting).await?;
        return Ok(busy);
    }
    let mut available = Vec::new();
    for slot in ProducerSlot::ALL[..policy.max_active_preparations]
        .iter()
        .copied()
    {
        if active.iter().any(|job| job.producer_slot == slot) {
            continue;
        }
        let backoff: Option<RetryBackoff> = store.get(slot.backoff_key()).await?;
        let retry_at_ms = backoff.map_or(now, |backoff| backoff.retry_at_ms);
        available.push((slot, retry_at_ms));
    }
    let producer_slot = match available.iter().find(|(_, retry_at)| *retry_at <= now) {
        Some((slot, _)) => *slot,
        None => {
            let retry_at_ms = available
                .iter()
                .map(|(_, retry_at)| *retry_at)
                .min()
                .ok_or_else(|| invalid("ML-DSA preprocessing capacity is inconsistent"))?;
            // A claimant that follows this retry time must retain its queue turn.
            // The active-owner and full-queue paths never reach this branch.
            if let Some(entry) = waiting.iter_mut().find(|entry| entry.key == key) {
                entry.expires_at_ms = entry
                    .expires_at_ms
                    .max(retry_at_ms.saturating_add(DEMAND_LIFETIME_MS));
            }
            persist_waiting(store, &original, &waiting).await?;
            return Ok(Claim::Busy { retry_at_ms });
        }
    };
    let mut batch = [0; 32];
    getrandom::getrandom(&mut batch)
        .map_err(|_| invalid("ML-DSA refill randomness unavailable"))?;
    let job = Job {
        producer_slot,
        key,
        batch,
        groups,
        expires_at_ms: now.saturating_add(90_000),
        material_expires_at_ms: now.saturating_add(MATERIAL_LIFETIME_MS),
        occupied_batches,
    };
    if !owns_producer {
        waiting.remove(0);
    }
    persist_waiting(store, &original, &waiting).await?;
    store.put(producer_slot.storage_key(), &job).await?;
    Ok(Claim::Acquired { job })
}

async fn active_jobs(store: &impl Store, now: u64) -> Result<Vec<Job>> {
    let mut active = Vec::with_capacity(ProducerSlot::ALL.len());
    for slot in ProducerSlot::ALL {
        if let Some(job) = store.get::<Job>(slot.storage_key()).await? {
            if job.producer_slot != slot {
                return Err(invalid(
                    "ML-DSA producer slot differs from its stored lease",
                ));
            }
            if job.expires_at_ms > now {
                active.push(job);
            } else {
                // Retire once in this transaction. A late settlement cannot reset
                // this failure or change a replacement producer's retry deadline.
                record_failure(store, slot, now).await?;
                store.delete(slot.storage_key()).await?;
            }
        }
    }
    Ok(active)
}

/// Snapshot before role reads so a settling producer's output stays accounted.
pub async fn pending(store: &impl Store, key: &KeyScope, now: u64) -> Result<Vec<Job>> {
    if !key_is_active(store, key).await? {
        return Err(invalid("ML-DSA preprocessing key is inactive"));
    }
    Ok(active_jobs(store, now)
        .await?
        .into_iter()
        .filter(|job| job.key == *key)
        .collect())
}

async fn persist_waiting(
    store: &impl Store,
    original: &[Waiting],
    waiting: &[Waiting],
) -> Result<()> {
    if waiting != original {
        store.put(WAITING, &waiting).await?;
    }
    Ok(())
}

/// Full or inactive keys relinquish only their own pending turn, never a lease.
pub async fn withdraw(store: &impl Store, key: &KeyScope) -> Result<()> {
    let original: Vec<Waiting> = store.get(WAITING).await?.unwrap_or_default();
    let mut waiting = Vec::new();
    for entry in &original {
        if entry.key != *key {
            waiting.push(entry.clone());
        }
    }
    persist_waiting(store, &original, &waiting).await
}
pub async fn check(store: &impl Store, job: &Job, now: u64) -> Result<bool> {
    Ok(now < job.expires_at_ms
        && store
            .get::<Job>(job.producer_slot.storage_key())
            .await?
            .as_ref()
            == Some(job)
        && admission::active_key(store, &job.key)
            .await?
            .map(|value| value.key)
            .as_ref()
            == Some(&job.key))
}
/// Release only this lease and return bounded wake hints in queue order.
/// An idle replay recomputes hints after a lost reply. A newer lease wins.
pub async fn finish(
    store: &impl Store,
    policy: &policy::Policy,
    job: &Job,
    outcome: Outcome,
    now: u64,
) -> Result<Vec<KeyScope>> {
    match store.get::<Job>(job.producer_slot.storage_key()).await? {
        Some(active) if active != *job => return Ok(Vec::new()),
        Some(_) => {
            match outcome {
                Outcome::Published => store.delete(job.producer_slot.backoff_key()).await?,
                Outcome::Unused => {}
                Outcome::Failed | Outcome::Interrupted => {
                    record_failure(store, job.producer_slot, now).await?;
                }
            }
            store.delete(job.producer_slot.storage_key()).await?;
            keep_turn_below_minimum(store, policy, job, outcome, now).await?;
        }
        None => {}
    }
    let waiting: Vec<Waiting> = store.get(WAITING).await?.unwrap_or_default();
    let active = active_jobs(store, now).await?;
    let available = policy.max_active_preparations.saturating_sub(active.len());
    let mut wake = Vec::with_capacity(available + 1);
    for entry in waiting {
        if wake.len() >= available {
            break;
        }
        if entry.expires_at_ms > now
            && key_is_active(store, &entry.key).await?
            && !active.iter().any(|job| job.key == entry.key)
        {
            wake.push(entry.key);
        }
    }
    if !wake.contains(&job.key) && key_is_active(store, &job.key).await? {
        wake.push(job.key.clone());
    }
    Ok(wake)
}

/// Wake hints follow queue order, so a key that still cannot sign must queue before
/// settlement returns them. Otherwise a key that can sign takes the free slot first.
async fn keep_turn_below_minimum(
    store: &impl Store,
    policy: &policy::Policy,
    job: &Job,
    outcome: Outcome,
    now: u64,
) -> Result<()> {
    let added = match outcome {
        Outcome::Published => job.batch_ids().len(),
        Outcome::Unused | Outcome::Failed | Outcome::Interrupted => 0,
    };
    if job.occupied_batches.saturating_add(added) >= policy.minimum_ready_batches()
        || !key_is_active(store, &job.key).await?
    {
        return Ok(());
    }
    let original: Vec<Waiting> = store.get(WAITING).await?.unwrap_or_default();
    if original.len() >= MAX_WAITING_KEYS || original.iter().any(|entry| entry.key == job.key) {
        return Ok(());
    }
    let mut waiting = original.clone();
    waiting.push(Waiting {
        key: job.key.clone(),
        expires_at_ms: now.saturating_add(DEMAND_LIFETIME_MS),
        below_minimum: true,
    });
    order_waiting(&mut waiting);
    persist_waiting(store, &original, &waiting).await
}

async fn record_failure(store: &impl Store, slot: ProducerSlot, now: u64) -> Result<()> {
    let previous: Option<RetryBackoff> = store.get(slot.backoff_key()).await?;
    let failures = previous
        .map_or(1, |backoff| {
            backoff.consecutive_failures.get().saturating_add(1)
        })
        .min(RETRY_DELAYS_MS.len() as u8);
    let backoff = RetryBackoff {
        consecutive_failures: NonZeroU8::new(failures)
            .ok_or_else(|| invalid("ML-DSA retry count must be positive"))?,
        retry_at_ms: now.saturating_add(RETRY_DELAYS_MS[usize::from(failures - 1)]),
    };
    store.put(slot.backoff_key(), &backoff).await
}

async fn key_is_active(store: &impl Store, key: &KeyScope) -> Result<bool> {
    Ok(admission::active_key(store, key)
        .await?
        .map(|activation| activation.key)
        .as_ref()
        == Some(key))
}
/// Each participant claims the batch ID before any OT or nonce generation.
pub async fn start_role(store: &impl Store, job: &Job, now: u64) -> Result<()> {
    pool::check_key(store, &job.key).await?;
    let name = format!("preprocessing/{}", hex(&job.batch));
    if now >= job.expires_at_ms || store.get::<Job>(&name).await?.is_some() {
        return Err(invalid(
            "ML-DSA preprocessing is expired or already started",
        ));
    }
    store.put(&name, job).await
}

/// Publishes under the exact role-local start marker and unexpired producer lease.
/// The caller must also authenticate the job against Router admission.
pub async fn publish_role(
    store: &impl Store,
    policy: &policy::Policy,
    job: &Job,
    binding: sealing::Binding,
    sealed: sealing::Sealed,
    now: u64,
) -> Result<()> {
    let name = format!("preprocessing/{}", hex(&job.batch));
    if now >= job.expires_at_ms
        || binding.key != job.key
        || !job.batch_ids().contains(&binding.batch)
        || binding.expires_at_ms != job.material_expires_at_ms
        || store.get::<Job>(&name).await?.as_ref() != Some(job)
    {
        return Err(invalid("ML-DSA publication lacks a live producer claim"));
    }
    let inventory =
        pool::inventory(store, &job.key, policy.refill_target_batches(), now, now).await?;
    if inventory.stock_batches().len() >= policy.refill_target_batches() {
        return Err(invalid("ML-DSA publication exceeds ready capacity"));
    }
    pool::put(store, binding, sealed, now).await
}
