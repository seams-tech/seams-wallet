//! Bounded generic pool and exact registration claims. Commands are transactional.
use super::*;
use signer_core::ml_dsa_custody::{SealedMlDsaRoleInputV1, SealedMlDsaRoleResultV1};
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Job {
    #[serde(default)]
    pub service_group: service_group::ServiceGroup,
    pub id: [u8; 32],
    pub scope: [u8; 32],
    pub schedule: [u8; 32],
    pub signing_schedule: [u8; 32],
    pub signing_batches: usize,
    pub prepare_until: u64,
    pub expires_at: u64,
}
/// Protocol identity stays independent of the stored envelope's cipher version.
pub(super) fn signing_batch_id(job: &Job, ordinal: usize) -> Result<[u8; 32]> {
    digest(
        b"seams/ml-dsa/registration-signing-stock/v1",
        &(job.id, ordinal),
    )
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Continuity {
    Create,
    Recover {
        public_key_digest: [u8; 32],
        manifest_digest: [u8; 32],
    },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub wallet: WalletScope,
    pub key_id: Identifier,
    pub epoch: u64,
    pub operation: [u8; 32],
    pub continuity: Continuity,
    pub input_a: SealedMlDsaRoleInputV1,
    pub input_b: SealedMlDsaRoleInputV1,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Claim {
    pub job: Job,
    pub request: Request,
    pub deadline: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoleResult {
    pub public_key: Vec<u8>,
    pub activation: admission::KeyActivation,
    pub reply: SealedMlDsaRoleResultV1,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum ExecutionReply {
    Running,
    Complete { result: Completed },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Completed {
    pub a: RoleResult,
    pub b: RoleResult,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum Operation {
    Running { claim: Claim },
    Complete { result: Completed },
    Failed,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum Stock {
    Preparing {
        job: Job,
        first: Option<Participant>,
    },
    Ready {
        job: Job,
    },
    Claimed {
        job: Job,
    },
    Retired,
}
#[derive(Serialize, Deserialize)]
struct StoredOperation {
    fingerprint: [u8; 32],
    state: Operation,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum Decision {
    Admitted { claim: Claim },
    Existing { operation: Operation },
    Unavailable { retry_at_ms: u64 },
}
pub fn scope(wallet: &WalletScope) -> Result<[u8; 32]> {
    digest(
        b"seams/ml-dsa/registration-scope/v1",
        &(&wallet.org, &wallet.project, &wallet.environment),
    )
}
fn job_key(id: &[u8; 32]) -> String {
    format!("registration-job/{}", hex(id))
}
fn operation_key(request: &Request) -> Result<String> {
    Ok(format!(
        "registration-operation/{}/{}",
        hex(&digest(b"wallet", &request.wallet)?),
        hex(&request.operation)
    ))
}
pub async fn prepare(
    store: &impl Store,
    scope: [u8; 32],
    service_group: service_group::ServiceGroup,
    schedule: [u8; 32],
    signing_schedule: [u8; 32],
    signing_batches: usize,
    now: u64,
) -> Result<Job> {
    if scope == [0; 32]
        || schedule == [0; 32]
        || signing_schedule == [0; 32]
        || !(2..=20).contains(&signing_batches)
    {
        return Err(invalid("Invalid registration pool identity"));
    }
    let ids: Vec<[u8; 32]> = store.get("registration-stock").await?.unwrap_or_default();
    let mut retained = Vec::new();
    for id in ids {
        match store.get::<Stock>(&job_key(&id)).await? {
            Some(Stock::Preparing { job, .. }) if now < job.prepare_until => {
                return Err(invalid("Registration preprocessing is already running"));
            }
            Some(Stock::Ready { job }) if now < job.expires_at => retained.push(id),
            _ => {
                store.put(&job_key(&id), &Stock::Retired).await?;
            }
        }
    }
    if retained.len() >= 4 {
        return Err(invalid("Registration ready pool is full"));
    }
    let mut id = [0; 32];
    getrandom::getrandom(&mut id).map_err(|_| invalid("Registration randomness unavailable"))?;
    let job = Job {
        service_group,
        id,
        scope,
        schedule,
        signing_schedule,
        signing_batches,
        prepare_until: now.saturating_add(300_000),
        expires_at: now.saturating_add(900_000),
    };
    store
        .put(
            &job_key(&id),
            &Stock::Preparing {
                job: job.clone(),
                first: None,
            },
        )
        .await?;
    retained.push(id);
    store.put("registration-stock", &retained).await?;
    Ok(job)
}
pub async fn ready(store: &impl Store, job: &Job, role: Participant, now: u64) -> Result<()> {
    let current = store.get::<Stock>(&job_key(&job.id)).await?;
    match current {
        Some(Stock::Preparing {
            job: expected,
            first,
        }) if expected == *job && now < job.prepare_until => {
            let next = match first {
                None => Stock::Preparing {
                    job: job.clone(),
                    first: Some(role),
                },
                Some(other) if other == role => Stock::Preparing {
                    job: job.clone(),
                    first: Some(role),
                },
                Some(_) => Stock::Ready { job: job.clone() },
            };
            store.put(&job_key(&job.id), &next).await
        }
        Some(Stock::Ready { job: expected }) if expected == *job && now < job.expires_at => Ok(()),
        _ => Err(invalid("Registration preparation is stale")),
    }
}
/// A failed reply can race a claim. Retirement must never revoke that claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreparationRetirement {
    Retired,
    AlreadyRetired,
    Claimed,
}
pub async fn retire_preparation(store: &impl Store, job: &Job) -> Result<PreparationRetirement> {
    match store.get::<Stock>(&job_key(&job.id)).await? {
        Some(Stock::Preparing { job: expected, .. } | Stock::Ready { job: expected })
            if expected == *job => {}
        Some(Stock::Claimed { job: expected }) if expected == *job => {
            return Ok(PreparationRetirement::Claimed);
        }
        // Existing tombstones retain only the ID. A retry makes no state change.
        Some(Stock::Retired) => return Ok(PreparationRetirement::AlreadyRetired),
        _ => return Err(invalid("Registration retirement identity changed")),
    }
    let mut ids: Vec<[u8; 32]> = store.get("registration-stock").await?.unwrap_or_default();
    ids.retain(|id| *id != job.id);
    store.put(&job_key(&job.id), &Stock::Retired).await?;
    store.put("registration-stock", &ids).await?;
    Ok(PreparationRetirement::Retired)
}
pub async fn check_job(store: &impl Store, job: &Job, now: u64) -> Result<bool> {
    Ok(
        matches!(store.get::<Stock>(&job_key(&job.id)).await?, Some(Stock::Preparing{job: expected,..}) if expected==*job && now<job.prepare_until),
    )
}
pub async fn claim(
    store: &impl Store,
    request: Request,
    schedule: [u8; 32],
    signing_schedule: [u8; 32],
    signing_batches: usize,
    now: u64,
) -> Result<Decision> {
    if request.operation == [0; 32] || request.epoch == 0 {
        return Err(invalid("Invalid registration identity"));
    }
    let key = operation_key(&request)?;
    let fingerprint = digest(b"registration-request", &request)?;
    if let Some(mut existing) = store.get::<StoredOperation>(&key).await? {
        if existing.fingerprint != fingerprint {
            return Err(invalid("Registration operation was changed"));
        }
        if matches!(&existing.state,Operation::Running{claim} if now>=claim.deadline) {
            existing.state = Operation::Failed;
            store.put(&key, &existing).await?;
        }
        return Ok(Decision::Existing {
            operation: existing.state,
        });
    }
    if let Some(active) = store.get::<Claim>("registration-active").await? {
        if now < active.deadline {
            return Ok(Decision::Unavailable {
                retry_at_ms: active.deadline,
            });
        }
    }
    let expected = admission::current_key(store, &request.wallet, &request.key_id).await?;
    match (&request.continuity, expected) {
        (Continuity::Create, None) => (),
        // The Gateway permits this only for an expired unpublished creation.
        // authorize_key and both role pools still require the same public key.
        (Continuity::Create, Some(state)) if request.epoch > state.activation().key.epoch => {}
        (
            Continuity::Recover {
                public_key_digest,
                manifest_digest,
            },
            Some(state),
        ) if state.activation().key.public_key_digest == *public_key_digest
            && state.activation().manifest_digest == *manifest_digest
            && request.epoch > state.activation().key.epoch =>
        {
            ()
        }
        _ => return Err(invalid("Registration custody continuity changed")),
    }
    let pool_scope = scope(&request.wallet)?;
    let mut ids: Vec<[u8; 32]> = store.get("registration-stock").await?.unwrap_or_default();
    for (index, id) in ids.iter().enumerate() {
        if let Some(Stock::Ready { job }) = store.get(&job_key(id)).await? {
            if job.scope == pool_scope
                && job.schedule == schedule
                && job.signing_schedule == signing_schedule
                && job.signing_batches == signing_batches
                && job.expires_at > now.saturating_add(30_000)
            {
                let claim = Claim {
                    job: job.clone(),
                    request,
                    deadline: now.saturating_add(30_000),
                };
                store.put(&job_key(id), &Stock::Claimed { job }).await?;
                store
                    .put(
                        &key,
                        &StoredOperation {
                            fingerprint,
                            state: Operation::Running {
                                claim: claim.clone(),
                            },
                        },
                    )
                    .await?;
                store.put("registration-active", &claim).await?;
                ids.remove(index);
                store.put("registration-stock", &ids).await?;
                return Ok(Decision::Admitted { claim });
            }
        }
    }
    Ok(Decision::Unavailable {
        retry_at_ms: now.saturating_add(5_000),
    })
}
pub(super) async fn active_until(store: &impl Store, now: u64) -> Result<Option<u64>> {
    Ok(store
        .get::<Claim>("registration-active")
        .await?
        .map(|claim| claim.deadline)
        .filter(|deadline| *deadline > now))
}
pub async fn check_claim(store: &impl Store, claim: &Claim, now: u64) -> Result<bool> {
    Ok(now < claim.deadline
        && match store
            .get::<StoredOperation>(&operation_key(&claim.request)?)
            .await?
        {
            Some(StoredOperation {
                state: Operation::Running { claim: expected },
                ..
            }) => digest(b"claim", &expected)? == digest(b"claim", claim)?,
            _ => false,
        })
}
pub async fn finish(
    store: &impl Store,
    claim: &Claim,
    result: Completed,
    now: u64,
) -> Result<Operation> {
    if !check_claim(store, claim, now).await? {
        return Err(invalid("Registration claim is stale"));
    }
    if result.a.activation != result.b.activation || result.a.public_key != result.b.public_key {
        return Err(invalid("Registration role results disagree"));
    }
    let activation = &result.a.activation;
    if activation.key.wallet != claim.request.wallet
        || activation.key.key_id != claim.request.key_id
        || activation.key.epoch != claim.request.epoch
        || activation.ceremony_id != claim.request.operation
        || result.a.public_key.len() != 1952
        || <[u8; 32]>::from(Sha256::digest(&result.a.public_key))
            != activation.key.public_key_digest
    {
        return Err(invalid("Registration completion binding changed"));
    }
    let active = admission::active_key(store, &result.a.activation.key).await?;
    if active.as_ref() != Some(&result.a.activation) {
        return Err(invalid("Registration material is not active"));
    }
    let state = Operation::Complete { result };
    store
        .put(
            &operation_key(&claim.request)?,
            &StoredOperation {
                fingerprint: digest(b"registration-request", &claim.request)?,
                state: state.clone(),
            },
        )
        .await?;
    store.delete("registration-active").await?;
    Ok(state)
}
