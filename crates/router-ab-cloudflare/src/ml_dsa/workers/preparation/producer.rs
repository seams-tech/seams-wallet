//! Durable dispatch. Heavy preparation runs in an independent alarm invocation.
use super::*;
use std::cell::Cell;
use std::sync::atomic::{AtomicU32, Ordering};

const PENDING: &str = "producer-pending";
const PRODUCER_NAME: &str = "ml-dsa-producer-v1";
const MAX_PENDING: usize = 2;
const RECOVERY_CHECK_MS: u64 = 5_000;
static CONSTRUCTIONS: AtomicU32 = AtomicU32::new(0);

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum ProducerState {
    Queued { job: refill::Job },
    Running { job: refill::Job },
    Published { job: refill::Job },
    Failed { job: refill::Job },
    Interrupted { job: refill::Job },
}
impl ProducerState {
    fn job(&self) -> &refill::Job {
        match self {
            Self::Queued { job }
            | Self::Running { job }
            | Self::Published { job }
            | Self::Failed { job }
            | Self::Interrupted { job } => job,
        }
    }
}
enum AlarmWork {
    Run(refill::Job),
    Abandon(refill::Job),
    Settle(ProducerState),
    Idle,
}

pub(super) async fn dispatch(env: &Env, job: &refill::Job) -> Result<()> {
    let stub = env
        .durable_object(job.producer_slot.namespace())
        .map_err(storage_error)?
        .id_from_name(PRODUCER_NAME)
        .map_err(storage_error)?
        .get_stub()
        .map_err(storage_error)?;
    let request = object_request(env, CallAuthority::Internal, START_PATH, job)?;
    let mut response = stub
        .fetch_with_request(request)
        .await
        .map_err(storage_error)?;
    if response.status_code() != 202 {
        return Err(invalid("ML-DSA durable preparation queue refused the job"));
    }
    if !response.json::<bool>().await.map_err(storage_error)? {
        return Err(invalid("ML-DSA producer queue was not acknowledged"));
    }
    Ok(())
}

#[cfg_attr(not(feature = "strict-worker-router-entrypoint"), durable_object)]
pub struct RouterAbMlDsaProducerDurableObject {
    state: State,
    env: Env,
    construction: u32,
    invocation: Cell<u32>,
    created_at_ms: Option<u64>,
    storage_gate: futures::lock::Mutex<()>,
}
#[cfg(not(feature = "strict-worker-router-entrypoint"))]
impl DurableObject for RouterAbMlDsaProducerDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self {
            state,
            env,
            construction: CONSTRUCTIONS.fetch_add(1, Ordering::Relaxed),
            invocation: Cell::new(0),
            created_at_ms: crate::cloudflare_now_unix_ms_v1().ok(),
            storage_gate: futures::lock::Mutex::new(()),
        }
    }
    async fn fetch(&self, mut request: worker::Request) -> worker::Result<Response> {
        self.invocation.set(self.invocation.get().saturating_add(1));
        self.log_entry("fetch_entered");
        if let Err(error) =
            crate::require_cloudflare_internal_service_auth_request_v1(&request, &self.env)
        {
            return crate::cloudflare_private_service_auth_error_response_v1(error);
        }
        self.log_entry("authenticated");
        if request.method() != Method::Post
            || request.path() != START_PATH
            || configured_role(&self.env)? != Participant::A
        {
            return Response::error("Invalid ML-DSA producer request", 400);
        }
        let job: refill::Job = decode_bounded_json_request(&mut request, 16_384)
            .await
            .map_err(protocol_error)?;
        log_stage(&job, Participant::A, job.batch, "producer_received");
        check_job(&self.env, &job).await.map_err(protocol_error)?;
        log_stage(&job, Participant::A, job.batch, "producer_authorized");
        self.log_job(&job, "queued");
        let receipt_job = job.clone();
        {
            // This gate covers local storage and the actual alarm update only.
            // Arm first so a crash after queue persistence retains a wake-up.
            let _guard = self.storage_gate.lock().await;
            schedule_refill_alarm(&self.state, 50).await?;
            transaction(&self.state, move |store| async move {
                enqueue(&store, job).await
            })
            .await
            .map_err(protocol_error)?;
        }
        log_stage(
            &receipt_job,
            Participant::A,
            receipt_job.batch,
            "queue_checked",
        );
        log_stage(
            &receipt_job,
            Participant::A,
            receipt_job.batch,
            "receipt_ready",
        );
        Ok(Response::from_json(&true)?.with_status(202))
    }
    async fn alarm(&self) -> worker::Result<Response> {
        self.invocation.set(self.invocation.get().saturating_add(1));
        self.log_entry("alarm_entered");
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_producer_entered_v1", "producer": self.state.id().to_string(),
            })
        );
        let action = {
            let _guard = self.storage_gate.lock().await;
            schedule_refill_alarm(&self.state, RECOVERY_CHECK_MS).await?;
            transaction(&self.state, next_work)
                .await
                .map_err(protocol_error)?
        };
        let (terminal, elapsed) = match action {
            AlarmWork::Idle => {
                let _guard = self.storage_gate.lock().await;
                self.schedule_pending().await?;
                return Response::empty();
            }
            AlarmWork::Run(job) => {
                self.log_job(&job, "running");
                log_stage(&job, Participant::A, job.batch, "producer_running");
                let start = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
                // Alarm handlers are serialized per object. This timer cannot
                // interrupt healthy work; it wakes an interrupted invocation.
                self.schedule_recovery(&job, start).await?;
                log_stage(&job, Participant::A, job.batch, "recovery_armed");
                let result = before_deadline(job.expires_at_ms, produce_a(&self.env, &job)).await;
                let elapsed = crate::cloudflare_now_unix_ms_v1()
                    .ok()
                    .and_then(|now| now.checked_sub(start));
                let published = if result.is_ok() {
                    true
                } else {
                    let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
                    // Publication precedes the final transport acknowledgement.
                    // An inspection error leaves Running and its recovery alarm intact.
                    let confirmed = before_deadline(
                        job.expires_at_ms.min(now.saturating_add(RECOVERY_CHECK_MS)),
                        paired_publication(&self.env, &job),
                    )
                    .await
                    .map_err(protocol_error)?;
                    if confirmed {
                        log_recovery(&job, "paired_publication_confirmed");
                    }
                    confirmed
                };
                let terminal = if published {
                    ProducerState::Published { job }
                } else {
                    ProducerState::Failed { job }
                };
                (terminal, elapsed)
            }
            AlarmWork::Abandon(job) => {
                self.log_job(&job, "recovering");
                let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
                let terminal = if now < job.expires_at_ms {
                    self.schedule_recovery(&job, now).await?;
                    if !before_deadline(
                        now.saturating_add(RECOVERY_CHECK_MS),
                        paired_publication(&self.env, &job),
                    )
                    .await
                    .map_err(protocol_error)?
                    {
                        log_recovery(&job, "waiting_for_publication");
                        return Response::from_json(&false);
                    }
                    log_recovery(&job, "paired_publication_confirmed");
                    ProducerState::Published { job }
                } else {
                    log_recovery(&job, "deadline_reached");
                    ProducerState::Interrupted { job }
                };
                (terminal, None)
            }
            AlarmWork::Settle(terminal) => {
                self.log_job(terminal.job(), "settling");
                return self.settle(&terminal).await;
            }
        };
        // Commit the local outcome before releasing the service-wide lease. A
        // settlement retry must never start fresh preparation or rewrite success.
        {
            let _guard = self.storage_gate.lock().await;
            self.state
                .storage()
                .put(&job_record(terminal.job().batch), &terminal)
                .await?;
        }
        let published = match &terminal {
            ProducerState::Published { .. } => Some(true),
            ProducerState::Failed { .. } => Some(false),
            ProducerState::Interrupted { .. } => None,
            ProducerState::Queued { .. } | ProducerState::Running { .. } => unreachable!(),
        };
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_refill_completed_v1", "batch": hex(&terminal.job().batch),
                "published": published, "elapsed_ms": elapsed,
                "candidates": usize::from(policy(&self.env).map_err(protocol_error)?.candidate_group_size()) * terminal.job().groups.count(),
                "batches": terminal.job().batch_ids().iter().map(|id| hex(id)).collect::<Vec<_>>(),
            })
        );
        self.settle(&terminal).await
    }
}
impl RouterAbMlDsaProducerDurableObject {
    fn log_entry(&self, stage: &'static str) {
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_producer_entry_v1",
                "producer": self.state.id().to_string(),
                "module_instance": signing_trace::module_identity(),
                "construction": self.construction,
                "invocation": self.invocation.get(),
                "created_at_ms": self.created_at_ms,
                "at_ms": crate::cloudflare_now_unix_ms_v1().ok(),
                "schedule_cache_hit": schedules::is_loaded(),
                "stage": stage,
            })
        );
    }
    fn log_job(&self, job: &refill::Job, stage: &'static str) {
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_producer_job_v1", "producer": self.state.id().to_string(),
                "batch": hex(&job.batch), "batches": job.batch_ids().iter().map(|id| hex(id)).collect::<Vec<_>>(),
                "key": hex(&job.key.public_key_digest), "epoch": job.key.epoch, "stage": stage,
            })
        );
    }
    async fn schedule_recovery(&self, job: &refill::Job, now: u64) -> worker::Result<()> {
        let _guard = self.storage_gate.lock().await;
        let delay = job
            .expires_at_ms
            .saturating_sub(now)
            .clamp(1, RECOVERY_CHECK_MS);
        schedule_refill_alarm(&self.state, delay).await
    }
    async fn schedule_pending(&self) -> worker::Result<()> {
        // Caller holds storage_gate until the alarm mutation completes.
        let queue: Vec<[u8; 32]> = self.state.storage().get(PENDING).await?.unwrap_or_default();
        if queue.is_empty() {
            self.state.storage().delete_alarm().await
        } else {
            schedule_refill_alarm(&self.state, 50).await
        }
    }
    async fn settle(&self, terminal: &ProducerState) -> worker::Result<Response> {
        {
            let _guard = self.storage_gate.lock().await;
            schedule_refill_alarm(&self.state, RECOVERY_CHECK_MS).await?;
        }
        let deadline = crate::cloudflare_now_unix_ms_v1()
            .map_err(protocol_error)?
            .saturating_add(RECOVERY_CHECK_MS);
        before_deadline(deadline, settle_remote(&self.env, terminal))
            .await
            .map_err(protocol_error)?;
        let batch = terminal.job().batch;
        {
            let _guard = self.storage_gate.lock().await;
            transaction(&self.state, move |store| remove_head(store, batch))
                .await
                .map_err(protocol_error)?;
            self.schedule_pending().await?;
        }
        Response::from_json(&matches!(terminal, ProducerState::Published { .. }))
    }
}

fn job_record(batch: [u8; 32]) -> String {
    format!("producer-job/{}", hex(&batch))
}

async fn enqueue(store: &TransactionStore, job: refill::Job) -> Result<()> {
    let now = crate::cloudflare_now_unix_ms_v1()?;
    if now >= job.expires_at_ms {
        return Err(invalid(
            "ML-DSA preprocessing lease expired before queueing",
        ));
    }
    let name = job_record(job.batch);
    if let Some(existing) = store.get::<ProducerState>(&name).await? {
        return if existing.job() == &job {
            Ok(())
        } else {
            Err(invalid("ML-DSA producer identity changed"))
        };
    }
    let queued: Vec<[u8; 32]> = store.get(PENDING).await?.unwrap_or_default();
    let mut pending = Vec::new();
    for batch in queued {
        let name = job_record(batch);
        let state: ProducerState = store
            .get(&name)
            .await?
            .ok_or_else(|| invalid("ML-DSA producer queue lost a job"))?;
        match state {
            ProducerState::Queued { job } if job.expires_at_ms <= now => {
                store
                    .put(&name, &ProducerState::Interrupted { job })
                    .await?;
            }
            _ => pending.push(batch),
        }
    }
    if pending.len() >= MAX_PENDING {
        return Err(invalid("ML-DSA producer queue is occupied"));
    }
    pending.push(job.batch);
    store.put(&name, &ProducerState::Queued { job }).await?;
    store.put(PENDING, &pending).await
}

async fn next_work(store: TransactionStore) -> Result<AlarmWork> {
    let queue: Vec<[u8; 32]> = store.get(PENDING).await?.unwrap_or_default();
    let Some(batch) = queue.first() else {
        return Ok(AlarmWork::Idle);
    };
    let name = job_record(*batch);
    match store.get::<ProducerState>(&name).await? {
        Some(ProducerState::Queued { job }) => {
            store
                .put(&name, &ProducerState::Running { job: job.clone() })
                .await?;
            Ok(AlarmWork::Run(job))
        }
        Some(ProducerState::Running { job }) => Ok(AlarmWork::Abandon(job)),
        Some(state) => Ok(AlarmWork::Settle(state)),
        None => Err(invalid("ML-DSA producer queue lost a job")),
    }
}

async fn remove_head(store: TransactionStore, batch: [u8; 32]) -> Result<()> {
    let mut queue: Vec<[u8; 32]> = store.get(PENDING).await?.unwrap_or_default();
    if queue.first() != Some(&batch) {
        return Err(invalid("ML-DSA settlement changed producer queue order"));
    }
    queue.remove(0);
    store.put(PENDING, &queue).await
}

async fn settle_remote(env: &Env, terminal: &ProducerState) -> Result<()> {
    let (job, outcome) = match terminal {
        ProducerState::Published { job } => (job, refill::Outcome::Published),
        ProducerState::Failed { job } => (job, refill::Outcome::Failed),
        ProducerState::Interrupted { job } => (job, refill::Outcome::Interrupted),
        ProducerState::Queued { .. } | ProducerState::Running { .. } => {
            return Err(invalid("ML-DSA producer has no terminal outcome"));
        }
    };
    let wake: Vec<KeyScope> = service_call(
        env,
        CallAuthority::Internal,
        &AdmissionCommand::FinishRefill {
            job: job.clone(),
            outcome,
        },
    )
    .await?;
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "ml_dsa_refill_settled_v1", "batch": hex(&job.batch),
            "outcome": outcome, "wake_count": wake.len(), "at_ms": crate::cloudflare_now_unix_ms_v1().ok(),
        })
    );
    for key in wake {
        let response = local_call(env, &RoleCommand::WakeRefill { key: key.clone() }, None).await?;
        if response.status_code() != 200 {
            return Err(invalid("ML-DSA refill wake was not acknowledged"));
        }
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_refill_woken_v1", "batch": hex(&job.batch),
                "key": hex(&key.public_key_digest), "epoch": key.epoch,
                "at_ms": crate::cloudflare_now_unix_ms_v1().ok(),
            })
        );
    }
    Ok(())
}

async fn paired_publication(env: &Env, job: &refill::Job) -> Result<bool> {
    let command = RoleCommand::PublicationRecorded { job: job.clone() };
    let (a, b) = futures::join!(
        local_call(env, &command, None),
        coordinator::role_call::<bool>(env, "DERIVER_B", &command)
    );
    let mut response = a?;
    if response.status_code() != 200 {
        return Err(invalid(
            "ML-DSA recovery publication check refused the request",
        ));
    }
    let a: bool = response.json().await.map_err(storage_error)?;
    Ok(a && b?)
}

fn log_recovery(job: &refill::Job, stage: &str) {
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "ml_dsa_refill_recovery_v1",
            "batch": hex(&job.batch),
            "stage": stage,
            "expires_at_ms": job.expires_at_ms,
        })
    );
}
