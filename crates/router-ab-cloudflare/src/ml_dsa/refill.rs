//! One service-wide preprocessing lease with independently consumed reservations.
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Job {
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
const ACTIVE: &str = "preprocessing-active";
const WAITING: &str = "preprocessing-waiting";
const MAX_WAITING_KEYS: usize = 64;
const DEMAND_LIFETIME_MS: u64 = 30_000;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Waiting {
    key: KeyScope,
    expires_at_ms: u64,
}
pub async fn claim(store: &impl Store, key: KeyScope, groups: Groups, now: u64) -> Result<Claim> {
    if admission::active_key(store, &key)
        .await?
        .map(|value| value.key)
        .as_ref()
        != Some(&key)
    {
        return Err(invalid("ML-DSA preprocessing key is inactive"));
    }
    let active = store.get::<Job>(ACTIVE).await?;
    if let Some(job) = &active {
        if job.key == key && job.expires_at_ms > now {
            return Ok(Claim::Busy {
                retry_at_ms: job.expires_at_ms.min(now.saturating_add(5_000)),
            });
        }
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
    if let Some(active) = active {
        if active.expires_at_ms > now {
            persist_waiting(store, &original, &waiting).await?;
            return Ok(Claim::Busy {
                retry_at_ms: active.expires_at_ms.min(now.saturating_add(5_000)),
            });
        }
    }
    let mut batch = [0; 32];
    getrandom::getrandom(&mut batch)
        .map_err(|_| invalid("ML-DSA refill randomness unavailable"))?;
    let job = Job {
        key,
        batch,
        groups,
        expires_at_ms: now.saturating_add(90_000),
        material_expires_at_ms: now.saturating_add(600_000),
    };
    waiting.remove(0);
    persist_waiting(store, &original, &waiting).await?;
    store.put(ACTIVE, &job).await?;
    Ok(Claim::Acquired { job })
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
        && store.get::<Job>(ACTIVE).await?.as_ref() == Some(job)
        && admission::active_key(store, &job.key)
            .await?
            .map(|value| value.key)
            .as_ref()
            == Some(&job.key))
}
pub async fn finish(store: &impl Store, job: &Job) -> Result<()> {
    if store.get::<Job>(ACTIVE).await?.as_ref() == Some(job) {
        store.delete(ACTIVE).await?;
    }
    Ok(())
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
