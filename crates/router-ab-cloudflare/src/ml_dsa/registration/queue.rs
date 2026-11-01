//! Bounded, durable demand for input-independent registration preparation.
use super::*;

const KEY: &str = "registration-preparation-demand";
const MAX_PENDING: usize = 4;
const ACTIVE_SCOPES_KEY: &str = "registration-active-scopes";
/// Two scopes with one replacement each stay inside the four-job stock bound.
const MAX_ACTIVE_SCOPES: usize = 2;
const ACTIVITY_LIFETIME_MS: u64 = 3_600_000;
/// A replacement starts while the old job stays claimable. Hosted jobs took 54-108 s.
const RENEW_BEFORE_EXPIRY_MS: u64 = 150_000;
/// A failing scope stops renewal until the next activity signal.
const MAX_ACTIVE_FAILURES: u8 = 6;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Configuration {
    schedule: [u8; 32],
    signing_schedule: [u8; 32],
    signing_batches: usize,
}
impl Configuration {
    pub fn new(
        schedule: [u8; 32],
        signing_schedule: [u8; 32],
        signing_batches: usize,
    ) -> Result<Self> {
        let value = Self {
            schedule,
            signing_schedule,
            signing_batches,
        };
        value.validate()?;
        Ok(value)
    }
    fn validate(&self) -> Result<()> {
        if self.schedule == [0; 32]
            || self.signing_schedule == [0; 32]
            || !(2..=20).contains(&self.signing_batches)
        {
            return Err(invalid("Invalid registration preparation configuration"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Demand {
    wallet: WalletScope,
    group: service_group::ServiceGroup,
    configuration: Configuration,
    failures: u8,
    retry_at_ms: u64,
    expires_at_ms: u64,
}
impl Demand {
    fn same_scope(&self, other: &Self) -> Result<bool> {
        Ok(self.group == other.group && scope(&self.wallet)? == scope(&other.wallet)?)
    }
    fn same_work(&self, other: &Self) -> Result<bool> {
        Ok(self.same_scope(other)? && self.configuration == other.configuration)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum Controller {
    Queued {
        demand: Demand,
        rest: Vec<Demand>,
    },
    Running {
        demand: Demand,
        rest: Vec<Demand>,
        job: Job,
    },
}
impl Controller {
    fn demand(&self) -> &Demand {
        match self {
            Self::Queued { demand, .. } | Self::Running { demand, .. } => demand,
        }
    }
    fn rest(&self) -> &[Demand] {
        match self {
            Self::Queued { rest, .. } | Self::Running { rest, .. } => rest,
        }
    }
    fn rest_mut(&mut self) -> &mut Vec<Demand> {
        match self {
            Self::Queued { rest, .. } | Self::Running { rest, .. } => rest,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum Status {
    Ready { job: Job },
    Pending { retry_at_ms: u64 },
}

/// A scope with recent registration activity keeps one generic job ready.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ActiveScope {
    wallet: WalletScope,
    group: service_group::ServiceGroup,
    configuration: Configuration,
    active_until_ms: u64,
    failures: u8,
}
impl ActiveScope {
    fn demand(&self, now: u64) -> Demand {
        Demand {
            wallet: self.wallet.clone(),
            group: self.group,
            configuration: self.configuration.clone(),
            failures: 0,
            retry_at_ms: now,
            expires_at_ms: now.saturating_add(PREPARATION_LIFETIME_MS),
        }
    }
}
pub enum Work {
    Idle,
    Wait { retry_at_ms: u64 },
    Prepare { job: Job },
}

async fn load(store: &impl Store) -> Result<Option<Controller>> {
    let state: Option<Controller> = store.get(KEY).await?;
    if let Some(value) = &state {
        if value.rest().len() >= MAX_PENDING {
            return Err(invalid("Registration preparation queue exceeds its bound"));
        }
        value.demand().configuration.validate()?;
        if value.demand().failures > 5 || value.demand().expires_at_ms == 0 {
            return Err(invalid("Invalid registration preparation retry state"));
        }
        if let Controller::Running { demand, job, .. } = value {
            if job.scope != scope(&demand.wallet)?
                || job.service_group != demand.group
                || job.schedule != demand.configuration.schedule
                || job.signing_schedule != demand.configuration.signing_schedule
                || job.signing_batches != demand.configuration.signing_batches
            {
                return Err(invalid("Registration preparation job changed its demand"));
            }
        }
        for demand in value.rest() {
            demand.configuration.validate()?;
            if demand.failures > 5 || demand.expires_at_ms == 0 {
                return Err(invalid("Invalid queued registration retry state"));
            }
            if demand.group != value.demand().group {
                return Err(invalid("Registration preparation queue changed its group"));
            }
        }
    }
    Ok(state)
}
async fn ready_job(store: &impl Store, demand: &Demand, now: u64) -> Result<Option<Job>> {
    let pool_scope = scope(&demand.wallet)?;
    let ids: Vec<[u8; 32]> = store.get("registration-stock").await?.unwrap_or_default();
    for id in ids {
        if let Some(Stock::Ready { job }) = store.get(&job_key(&id)).await? {
            if job.scope == pool_scope
                && job.service_group == demand.group
                && job.schedule == demand.configuration.schedule
                && job.signing_schedule == demand.configuration.signing_schedule
                && job.signing_batches == demand.configuration.signing_batches
                && job.expires_at > now.saturating_add(30_000)
            {
                return Ok(Some(job));
            }
        }
    }
    Ok(None)
}
/// The latest expiry of ready stock for this demand. The oldest job stays first to claim.
async fn latest_ready_expiry(store: &impl Store, demand: &Demand) -> Result<Option<u64>> {
    let pool_scope = scope(&demand.wallet)?;
    let ids: Vec<[u8; 32]> = store.get("registration-stock").await?.unwrap_or_default();
    let mut latest = None;
    for id in ids {
        if let Some(Stock::Ready { job }) = store.get(&job_key(&id)).await? {
            if job.scope == pool_scope
                && job.service_group == demand.group
                && job.schedule == demand.configuration.schedule
                && job.signing_schedule == demand.configuration.signing_schedule
                && job.signing_batches == demand.configuration.signing_batches
            {
                latest = latest.max(Some(job.expires_at));
            }
        }
    }
    Ok(latest)
}
fn outlives_renewal(expires_at: Option<u64>, now: u64) -> bool {
    expires_at.is_some_and(|expiry| expiry > now.saturating_add(RENEW_BEFORE_EXPIRY_MS))
}
enum Trigger {
    Missing,
    Consumed { job: [u8; 32] },
}

async fn enqueue(store: &impl Store, demand: Demand, trigger: Trigger) -> Result<()> {
    match load(store).await? {
        None => {
            store
                .put(
                    KEY,
                    &Controller::Queued {
                        demand,
                        rest: Vec::new(),
                    },
                )
                .await
        }
        Some(mut state) => {
            let consumed_current = match (&state, trigger) {
                (Controller::Running { job, .. }, Trigger::Consumed { job: consumed }) => {
                    job.id == consumed
                }
                _ => false,
            };
            let current_satisfies = state.demand().same_work(&demand)? && !consumed_current;
            if current_satisfies {
                return Ok(());
            }
            for pending in state.rest() {
                if pending.same_work(&demand)? {
                    return Ok(());
                }
            }
            if state.rest().len() + 1 >= MAX_PENDING {
                return Ok(());
            }
            state.rest_mut().push(demand);
            store.put(KEY, &state).await
        }
    }
}
/// Record registration activity. The scope keeps a ready job until this window ends.
pub async fn activate(
    store: &impl Store,
    wallet: WalletScope,
    group: service_group::ServiceGroup,
    configuration: Configuration,
    now: u64,
) -> Result<()> {
    let active_scope = scope(&wallet)?;
    let mut scopes: Vec<ActiveScope> = store.get(ACTIVE_SCOPES_KEY).await?.unwrap_or_default();
    let mut failures = 0;
    let mut retained = Vec::with_capacity(scopes.len());
    for candidate in scopes.drain(..) {
        if scope(&candidate.wallet)? == active_scope {
            failures = candidate.failures;
        } else if now < candidate.active_until_ms {
            retained.push(candidate);
        }
    }
    if retained.len() >= MAX_ACTIVE_SCOPES {
        retained.sort_by_key(|candidate| candidate.active_until_ms);
        retained.remove(0);
    }
    retained.push(ActiveScope {
        wallet,
        group,
        configuration,
        active_until_ms: now.saturating_add(ACTIVITY_LIFETIME_MS),
        failures,
    });
    store.put(ACTIVE_SCOPES_KEY, &retained).await
}
async fn record_failure(store: &impl Store, demand: &Demand) -> Result<()> {
    let failed_scope = scope(&demand.wallet)?;
    let Some(mut scopes) = store.get::<Vec<ActiveScope>>(ACTIVE_SCOPES_KEY).await? else {
        return Ok(());
    };
    let mut retained = Vec::with_capacity(scopes.len());
    for mut candidate in scopes.drain(..) {
        if scope(&candidate.wallet)? == failed_scope {
            candidate.failures = candidate.failures.saturating_add(1);
            if candidate.failures >= MAX_ACTIVE_FAILURES {
                continue;
            }
        }
        retained.push(candidate);
    }
    store.put(ACTIVE_SCOPES_KEY, &retained).await
}
enum Reserve {
    Idle,
    Enqueued,
    Wake { at_ms: u64 },
}
/// Queue each active scope that needs a replacement. Otherwise name the next renewal time.
async fn reconcile_active_scopes(
    store: &impl Store,
    configuration: &Configuration,
    now: u64,
) -> Result<Reserve> {
    let Some(stored) = store.get::<Vec<ActiveScope>>(ACTIVE_SCOPES_KEY).await? else {
        return Ok(Reserve::Idle);
    };
    let previous_count = stored.len();
    let scopes: Vec<ActiveScope> = stored
        .into_iter()
        .filter(|active| now < active.active_until_ms && active.configuration == *configuration)
        .collect();
    if scopes.is_empty() {
        store.delete(ACTIVE_SCOPES_KEY).await?;
        return Ok(Reserve::Idle);
    }
    if scopes.len() != previous_count {
        store.put(ACTIVE_SCOPES_KEY, &scopes).await?;
    }
    let mut enqueued = false;
    let mut wake = u64::MAX;
    for active in scopes {
        let demand = active.demand(now);
        let expires_at = latest_ready_expiry(store, &demand).await?;
        match expires_at {
            Some(expiry) if outlives_renewal(expires_at, now) => {
                wake = wake
                    .min(expiry - RENEW_BEFORE_EXPIRY_MS)
                    .min(active.active_until_ms);
            }
            _ => {
                enqueue(store, demand, Trigger::Missing).await?;
                enqueued = true;
            }
        }
    }
    Ok(if enqueued {
        Reserve::Enqueued
    } else {
        Reserve::Wake { at_ms: wake }
    })
}
/// Claim ready stock or record durable preparation demand under the same transaction.
pub async fn claim_or_prepare(
    store: &impl Store,
    request: super::Request,
    group: service_group::ServiceGroup,
    configuration: Configuration,
    now: u64,
) -> Result<super::Decision> {
    let wallet = request.wallet.clone();
    let active_configuration = configuration.clone();
    let decision = super::claim(
        store,
        request,
        configuration.schedule,
        configuration.signing_schedule,
        configuration.signing_batches,
        now,
    )
    .await?;
    match &decision {
        super::Decision::Unavailable { .. } => {
            self::request(store, wallet.clone(), group, configuration, now).await?;
            activate(store, wallet, group, active_configuration, now).await?;
        }
        super::Decision::Admitted { claim } => {
            replenish(store, claim, now).await?;
            activate(store, wallet, group, active_configuration, now).await?;
        }
        super::Decision::Existing { .. } => {}
    }
    Ok(decision)
}

pub async fn request(
    store: &impl Store,
    wallet: WalletScope,
    group: service_group::ServiceGroup,
    configuration: Configuration,
    now: u64,
) -> Result<Status> {
    let demand = Demand {
        wallet,
        group,
        configuration,
        failures: 0,
        retry_at_ms: now,
        expires_at_ms: now.saturating_add(PREPARATION_LIFETIME_MS),
    };
    if let Some(job) = ready_job(store, &demand, now).await? {
        return Ok(Status::Ready { job });
    }
    enqueue(store, demand, Trigger::Missing).await?;
    Ok(Status::Pending {
        retry_at_ms: now.saturating_add(1_000),
    })
}
pub async fn replenish(store: &impl Store, claim: &Claim, now: u64) -> Result<()> {
    let demand = Demand {
        wallet: claim.request.wallet.clone(),
        group: claim.job.service_group,
        configuration: Configuration::new(
            claim.job.schedule,
            claim.job.signing_schedule,
            claim.job.signing_batches,
        )?,
        failures: 0,
        retry_at_ms: now,
        expires_at_ms: now.saturating_add(PREPARATION_LIFETIME_MS),
    };
    if ready_job(store, &demand, now).await?.is_none() {
        enqueue(store, demand, Trigger::Consumed { job: claim.job.id }).await?;
    }
    Ok(())
}
async fn pop(store: &impl Store, mut rest: Vec<Demand>) -> Result<()> {
    if rest.is_empty() {
        return store.delete(KEY).await;
    }
    let demand = rest.remove(0);
    store.put(KEY, &Controller::Queued { demand, rest }).await
}
async fn completed(store: &impl Store, job: &Job, now: u64) -> Result<bool> {
    match store.get::<Stock>(&job_key(&job.id)).await? {
        Some(Stock::Ready { job: expected }) if expected == *job => Ok(now < job.expires_at),
        Some(Stock::Claimed { job: expected }) if expected == *job => Ok(true),
        Some(Stock::Preparing { job: expected, .. }) if expected == *job => Ok(false),
        Some(Stock::Retired) => Ok(false),
        _ => Err(invalid(
            "Registration preparation completion identity changed",
        )),
    }
}
async fn retry(
    store: &impl Store,
    mut demand: Demand,
    mut rest: Vec<Demand>,
    job: &Job,
    now: u64,
) -> Result<u64> {
    retire_preparation(store, job).await?;
    record_failure(store, &demand).await?;
    if now >= demand.expires_at_ms {
        pop(store, rest).await?;
        return Ok(now.saturating_add(1));
    }
    demand.failures = demand.failures.saturating_add(1).min(5);
    let delay = [2_000_u64, 4_000, 8_000, 16_000, 30_000][usize::from(demand.failures - 1)];
    demand.retry_at_ms = now.saturating_add(delay);
    rest.push(demand);
    let next_at = rest
        .iter()
        .map(|pending| pending.retry_at_ms)
        .min()
        .unwrap_or(now);
    pop(store, rest).await?;
    Ok(next_at.max(now.saturating_add(1)))
}

pub async fn next(store: &impl Store, configuration: &Configuration, now: u64) -> Result<Work> {
    for _ in 0..=(MAX_PENDING * 2) {
        let Some(mut state) = load(store).await? else {
            match reconcile_active_scopes(store, configuration, now).await? {
                Reserve::Idle => return Ok(Work::Idle),
                Reserve::Enqueued => continue,
                Reserve::Wake { at_ms } => {
                    return Ok(Work::Wait {
                        retry_at_ms: at_ms.max(now.saturating_add(1)),
                    })
                }
            }
        };
        let previous_count = state.rest().len();
        state.rest_mut().retain(|pending| {
            pending.configuration == *configuration && now < pending.expires_at_ms
        });
        if state.rest().len() != previous_count {
            store.put(KEY, &state).await?;
        }
        match state {
            Controller::Running { demand, rest, job } => {
                if completed(store, &job, now).await? {
                    pop(store, rest).await?;
                } else if demand.configuration != *configuration || now >= demand.expires_at_ms {
                    retire_preparation(store, &job).await?;
                    pop(store, rest).await?;
                } else {
                    return Ok(Work::Wait {
                        retry_at_ms: retry(store, demand, rest, &job, now).await?,
                    });
                }
            }
            Controller::Queued { demand, mut rest } => {
                if demand.configuration != *configuration
                    || now >= demand.expires_at_ms
                    || outlives_renewal(latest_ready_expiry(store, &demand).await?, now)
                {
                    pop(store, rest).await?;
                    continue;
                }
                if now < demand.retry_at_ms {
                    let mut eligible = None;
                    for (index, pending) in rest.iter().enumerate() {
                        if pending.retry_at_ms <= now && now < pending.expires_at_ms {
                            eligible = Some(index);
                            break;
                        }
                    }
                    if let Some(index) = eligible {
                        let next = rest.remove(index);
                        rest.push(demand);
                        store
                            .put(KEY, &Controller::Queued { demand: next, rest })
                            .await?;
                        continue;
                    }
                    let retry_at_ms = rest
                        .iter()
                        .map(|pending| pending.retry_at_ms)
                        .min()
                        .unwrap_or(demand.retry_at_ms)
                        .min(demand.retry_at_ms);
                    return Ok(Work::Wait {
                        retry_at_ms: retry_at_ms.max(now.saturating_add(1)),
                    });
                }
                if active_until(store, now).await?.is_some()
                    || admission::active_until(store, now).await?.is_some()
                {
                    return Ok(Work::Wait {
                        retry_at_ms: now.saturating_add(1_000),
                    });
                }
                match prepare(
                    store,
                    scope(&demand.wallet)?,
                    demand.group,
                    configuration.schedule,
                    configuration.signing_schedule,
                    configuration.signing_batches,
                    now,
                )
                .await?
                {
                    PreparationAllocation::Allocated { job } => {
                        store
                            .put(
                                KEY,
                                &Controller::Running {
                                    demand,
                                    rest,
                                    job: job.clone(),
                                },
                            )
                            .await?;
                        return Ok(Work::Prepare { job });
                    }
                    PreparationAllocation::Waiting { retry_at_ms } => {
                        return Ok(Work::Wait { retry_at_ms })
                    }
                }
            }
        }
    }
    Err(invalid("Registration preparation queue did not advance"))
}
pub async fn finish(store: &impl Store, job: &Job, now: u64) -> Result<()> {
    let Some(Controller::Running {
        demand,
        rest,
        job: expected,
    }) = load(store).await?
    else {
        return Ok(());
    };
    if expected != *job {
        return Ok(());
    }
    if completed(store, job, now).await? {
        pop(store, rest).await
    } else {
        retry(store, demand, rest, job, now).await.map(|_| ())
    }
}
