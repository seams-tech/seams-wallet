//! One service-wide preprocessing lease. Retries always use fresh batch IDs.
use super::*;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Job {
    pub key: KeyScope,
    pub batch: [u8; 32],
    pub expires_at_ms: u64,
    pub material_expires_at_ms: u64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum Claim {
    Acquired { job: Job },
    Busy { retry_at_ms: u64 },
}
const ACTIVE: &str = "preprocessing-active";
pub async fn claim(store: &impl Store, key: KeyScope, now: u64) -> Result<Claim> {
    if admission::active_key(store, &key)
        .await?
        .map(|value| value.key)
        .as_ref()
        != Some(&key)
    {
        return Err(invalid("ML-DSA preprocessing key is inactive"));
    }
    let foreground = admission::active_until(store, now)
        .await?
        .max(registration::active_until(store, now).await?);
    if let Some(retry_at_ms) = foreground {
        return Ok(Claim::Busy { retry_at_ms });
    }
    if let Some(active) = store.get::<Job>(ACTIVE).await? {
        if active.expires_at_ms > now {
            return Ok(Claim::Busy {
                retry_at_ms: active.expires_at_ms,
            });
        }
    }
    let mut batch = [0; 32];
    getrandom::getrandom(&mut batch)
        .map_err(|_| invalid("ML-DSA refill randomness unavailable"))?;
    let job = Job {
        key,
        batch,
        expires_at_ms: now.saturating_add(90_000),
        material_expires_at_ms: now.saturating_add(600_000),
    };
    store.put(ACTIVE, &job).await?;
    Ok(Claim::Acquired { job })
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
    if now >= job.expires_at_ms || store.get::<bool>(&name).await?.is_some() {
        return Err(invalid(
            "ML-DSA preprocessing is expired or already started",
        ));
    }
    store.put(&name, &true).await
}
