//! Durable dispatch. Heavy preparation runs in an independent alarm invocation.
use super::*;
use std::cell::Cell;
use std::sync::atomic::{AtomicU32, Ordering};

const STATE: &str = "producer-job";
const NAMESPACE: &str = "ML_DSA_PRODUCER_DO";
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
}

pub(super) async fn dispatch(env: &Env, job: &refill::Job) -> Result<()> {
    let stub = env
        .durable_object(NAMESPACE)
        .map_err(storage_error)?
        .id_from_name(&hex(&job.batch))
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

#[durable_object]
pub struct RouterAbMlDsaProducerDurableObject {
    state: State,
    env: Env,
    construction: u32,
    invocation: Cell<u32>,
    created_at_ms: Option<u64>,
}
impl DurableObject for RouterAbMlDsaProducerDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self {
            state,
            env,
            construction: CONSTRUCTIONS.fetch_add(1, Ordering::Relaxed),
            invocation: Cell::new(0),
            created_at_ms: crate::cloudflare_now_unix_ms_v1().ok(),
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
        let queued = transaction(&self.state, move |store| async move {
            match store.get::<ProducerState>(STATE).await? {
                None => {
                    store.put(STATE, &ProducerState::Queued { job }).await?;
                    Ok(true)
                }
                Some(state) if state.job() == &job => {
                    Ok(matches!(state, ProducerState::Queued { .. }))
                }
                Some(_) => Err(invalid("ML-DSA producer identity changed")),
            }
        })
        .await
        .map_err(protocol_error)?;
        log_stage(
            &receipt_job,
            Participant::A,
            receipt_job.batch,
            "queue_checked",
        );
        if queued {
            schedule_refill_alarm(&self.state, 50).await?;
        }
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
        let action = transaction(&self.state, |store| async move {
            match store.get::<ProducerState>(STATE).await? {
                Some(ProducerState::Queued { job }) => {
                    store
                        .put(STATE, &ProducerState::Running { job: job.clone() })
                        .await?;
                    Ok(AlarmWork::Run(job))
                }
                Some(ProducerState::Running { job }) => Ok(AlarmWork::Abandon(job)),
                Some(
                    state @ (ProducerState::Published { .. }
                    | ProducerState::Failed { .. }
                    | ProducerState::Interrupted { .. }),
                ) => Ok(AlarmWork::Settle(state)),
                None => Err(invalid("ML-DSA producer has no queued job")),
            }
        })
        .await
        .map_err(protocol_error)?;
        let (terminal, elapsed) = match action {
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
                let terminal = if result.is_ok() {
                    ProducerState::Published { job }
                } else {
                    ProducerState::Failed { job }
                };
                (terminal, elapsed)
            }
            AlarmWork::Abandon(job) => {
                self.log_job(&job, "recovering");
                let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
                if now < job.expires_at_ms {
                    self.schedule_recovery(&job, now).await?;
                    if !paired_publication(&self.env, &job)
                        .await
                        .map_err(protocol_error)?
                    {
                        log_recovery(&job, "waiting_for_publication");
                        return Response::from_json(&false);
                    }
                    log_recovery(&job, "paired_publication_confirmed");
                } else {
                    log_recovery(&job, "deadline_reached");
                }
                (ProducerState::Interrupted { job }, None)
            }
            AlarmWork::Settle(terminal) => {
                self.log_job(terminal.job(), "settling");
                return self.settle(&terminal).await;
            }
        };
        // Commit the local outcome before releasing the service-wide lease. A
        // settlement retry must never start fresh preparation or rewrite success.
        self.state.storage().put(STATE, &terminal).await?;
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
        let delay = job
            .expires_at_ms
            .saturating_sub(now)
            .clamp(1, RECOVERY_CHECK_MS);
        schedule_refill_alarm(&self.state, delay).await
    }
    async fn settle(&self, terminal: &ProducerState) -> worker::Result<Response> {
        // Preserve an explicit retry even when settlement is entered by a
        // recovery alarm rather than by the original preparation invocation.
        schedule_refill_alarm(&self.state, RECOVERY_CHECK_MS).await?;
        let wake: Vec<KeyScope> = service_call(
            &self.env,
            CallAuthority::Internal,
            &AdmissionCommand::FinishRefill {
                job: terminal.job().clone(),
            },
        )
        .await
        .map_err(protocol_error)?;
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_refill_settled_v1", "batch": hex(&terminal.job().batch),
                "wake_count": wake.len(), "at_ms": crate::cloudflare_now_unix_ms_v1().ok(),
            })
        );
        for key in wake {
            let response = local_call(&self.env, &RoleCommand::WakeRefill { key: key.clone() })
                .await
                .map_err(protocol_error)?;
            if response.status_code() != 200 {
                return Err(protocol_error(invalid(
                    "ML-DSA refill wake was not acknowledged",
                )));
            }
            worker::console_log!(
                "{}",
                serde_json::json!({
                    "event": "ml_dsa_refill_woken_v1", "batch": hex(&terminal.job().batch),
                    "key": hex(&key.public_key_digest), "epoch": key.epoch,
                    "at_ms": crate::cloudflare_now_unix_ms_v1().ok(),
                })
            );
        }
        self.state.storage().delete_alarm().await?;
        Response::from_json(&matches!(terminal, ProducerState::Published { .. }))
    }
}

async fn paired_publication(env: &Env, job: &refill::Job) -> Result<bool> {
    let command = RoleCommand::Inspect {
        key: job.key.clone(),
        batches: job.batch_ids(),
    };
    let (a, b) = futures::join!(
        local_call(env, &command),
        coordinator::role_call::<Vec<pool::BatchAvailability>>(env, "DERIVER_B", &command)
    );
    let mut response = a?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA recovery inventory refused the request"));
    }
    let a: Vec<pool::BatchAvailability> = response.json().await.map_err(storage_error)?;
    let b = b?;
    // Ready/reserved records prove publication. Retired also covers missing-key
    // and burned records, so it cannot establish this early-release condition.
    Ok(a.len() == job.groups.count()
        && b.len() == job.groups.count()
        && publication_present(&a)
        && publication_present(&b))
}

fn publication_present(states: &[pool::BatchAvailability]) -> bool {
    !states.is_empty()
        && states.iter().all(|state| {
            matches!(
                state,
                pool::BatchAvailability::Ready | pool::BatchAvailability::Reserved
            )
        })
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
