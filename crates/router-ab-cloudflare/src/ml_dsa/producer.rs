//! Durable producer queue decisions. The host owns clocks, alarms, RPCs and execution.
use super::*;

pub const PENDING: &str = "producer-pending";
const MAX_PENDING: usize = 2;

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum Pending {
    Queued { job: refill::Job },
    Running { job: refill::Job },
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum Terminal {
    Published { job: refill::Job },
    Unused { job: refill::Job },
    Failed { job: refill::Job },
    Interrupted { job: refill::Job },
}
impl Terminal {
    pub fn job(&self) -> &refill::Job {
        match self {
            Self::Published { job }
            | Self::Unused { job }
            | Self::Failed { job }
            | Self::Interrupted { job } => job,
        }
    }
    pub fn outcome(&self) -> refill::Outcome {
        match self {
            Self::Published { .. } => refill::Outcome::Published,
            Self::Unused { .. } => refill::Outcome::Unused,
            Self::Failed { .. } => refill::Outcome::Failed,
            Self::Interrupted { .. } => refill::Outcome::Interrupted,
        }
    }
}
#[derive(Deserialize)]
#[serde(untagged)]
enum StoredState {
    Pending(Pending),
    Terminal(Terminal),
}
impl StoredState {
    fn job(&self) -> &refill::Job {
        match self {
            Self::Pending(Pending::Queued { job } | Pending::Running { job }) => job,
            Self::Terminal(state) => state.job(),
        }
    }
}
pub enum Work {
    Run(refill::Job),
    Abandon(refill::Job),
    Settle(Terminal),
    Idle,
}

pub fn record_key(batch: [u8; 32]) -> String {
    format!("producer-job/{}", hex(&batch))
}

pub async fn enqueue(store: &impl Store, job: refill::Job, now: u64) -> Result<()> {
    if now >= job.expires_at_ms {
        return Err(invalid(
            "ML-DSA preprocessing lease expired before queueing",
        ));
    }
    let name = record_key(job.batch);
    if let Some(existing) = store.get::<StoredState>(&name).await? {
        return if existing.job() == &job {
            Ok(())
        } else {
            Err(invalid("ML-DSA producer identity changed"))
        };
    }
    let queued: Vec<[u8; 32]> = store.get(PENDING).await?.unwrap_or_default();
    let mut pending = Vec::new();
    for batch in queued {
        let name = record_key(batch);
        let state: StoredState = store
            .get(&name)
            .await?
            .ok_or_else(|| invalid("ML-DSA producer queue lost a job"))?;
        match state {
            StoredState::Pending(Pending::Queued { job }) if job.expires_at_ms <= now => {
                store.put(&name, &Terminal::Interrupted { job }).await?;
            }
            _ => pending.push(batch),
        }
    }
    if pending.len() >= MAX_PENDING {
        return Err(invalid("ML-DSA producer queue is occupied"));
    }
    pending.push(job.batch);
    store.put(&name, &Pending::Queued { job }).await?;
    store.put(PENDING, &pending).await
}

pub async fn next_work(store: &impl Store) -> Result<Work> {
    let queue: Vec<[u8; 32]> = store.get(PENDING).await?.unwrap_or_default();
    let Some(batch) = queue.first() else {
        return Ok(Work::Idle);
    };
    let name = record_key(*batch);
    match store.get::<StoredState>(&name).await? {
        Some(StoredState::Pending(Pending::Queued { job })) => {
            store
                .put(&name, &Pending::Running { job: job.clone() })
                .await?;
            Ok(Work::Run(job))
        }
        Some(StoredState::Pending(Pending::Running { job })) => Ok(Work::Abandon(job)),
        Some(StoredState::Terminal(state)) => Ok(Work::Settle(state)),
        None => Err(invalid("ML-DSA producer queue lost a job")),
    }
}

pub async fn remove_head(store: &impl Store, batch: [u8; 32]) -> Result<()> {
    let mut queue: Vec<[u8; 32]> = store.get(PENDING).await?.unwrap_or_default();
    if queue.first() != Some(&batch) {
        return Err(invalid("ML-DSA settlement changed producer queue order"));
    }
    queue.remove(0);
    store.put(PENDING, &queue).await
}
