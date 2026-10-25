//! Bounded service-wide preprocessing leases with one active producer per key.
use super::*;
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
const WAITING: &str = "preprocessing-waiting";
const MAX_WAITING_KEYS: usize = 64;
const DEMAND_LIFETIME_MS: u64 = 30_000;
// Untouched material remains key/epoch-bound and single-use. Producer and operation
// leases stay short; this deadline only limits encrypted stock retention.
const MATERIAL_LIFETIME_MS: u64 = 60 * 60 * 1_000;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Waiting {
    key: KeyScope,
    expires_at_ms: u64,
}
pub async fn claim(
    store: &impl Store,
    policy: &policy::Policy,
    key: KeyScope,
    groups: Groups,
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
    if let Some(job) = active.iter().find(|job| job.key == key) {
        return Ok(Claim::Busy {
            retry_at_ms: job.expires_at_ms.min(now.saturating_add(5_000)),
        });
    }
    let original: Vec<Waiting> = store.get(WAITING).await?.unwrap_or_default();
    let mut waiting = Vec::new();
    let mut queued = false;
    for mut entry in original.iter().cloned() {
        if entry.expires_at_ms <= now {
            continue;
        }
        if entry.key == key {
            entry.expires_at_ms = now.saturating_add(DEMAND_LIFETIME_MS);
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
    if !queued && waiting.len() < MAX_WAITING_KEYS {
        waiting.push(Waiting {
            key: key.clone(),
            expires_at_ms: now.saturating_add(DEMAND_LIFETIME_MS),
        });
    }
    let busy = Claim::Busy {
        retry_at_ms: now.saturating_add(5_000),
    };
    if waiting.first().map(|entry| &entry.key) != Some(&key) {
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
    let producer_slot = ProducerSlot::ALL[..policy.max_active_preparations]
        .iter()
        .copied()
        .find(|slot| !active.iter().any(|job| job.producer_slot == *slot))
        .ok_or_else(|| invalid("ML-DSA preprocessing capacity is inconsistent"))?;
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
    };
    waiting.remove(0);
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
            }
        }
    }
    Ok(active)
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
    now: u64,
) -> Result<Vec<KeyScope>> {
    match store.get::<Job>(job.producer_slot.storage_key()).await? {
        Some(active) if active != *job => return Ok(Vec::new()),
        Some(_) => store.delete(job.producer_slot.storage_key()).await?,
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
    pool::put(store, binding, sealed, now).await
}
