//! Durable dispatch. Heavy preparation runs in an independent alarm invocation.
use super::*;
use crate::ml_dsa::producer::{self as producer_core, Terminal, Work as AlarmWork};
use std::cell::Cell;
use std::sync::atomic::{AtomicU32, Ordering};

const RECOVERY_CHECK_MS: u64 = 5_000;
static CONSTRUCTIONS: AtomicU32 = AtomicU32::new(0);

/// The producer's own answer. A lost reply is an error instead, because the job can still run.
pub(super) enum Dispatched {
    Queued,
    Refused,
}

pub(super) async fn dispatch(env: &Env, job: &refill::Job) -> Result<Dispatched> {
    let stub = env
        .durable_object(job.producer_slot.namespace())
        .map_err(storage_error)?
        .id_from_name(
            &routing::resolve(env, &job.key.wallet)
                .await?
                .producer_name(),
        )
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
    Ok(if response.json::<bool>().await.map_err(storage_error)? {
        Dispatched::Queued
    } else {
        Dispatched::Refused
    })
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
        routing::check_producer(&self.env, &self.state, &job)
            .await
            .map_err(protocol_error)?;
        log_stage(&job, Participant::A, job.batch, "producer_received");
        // Nothing is queued yet, so the controller can release the lease on this answer.
        if let Err(error) = check_job(&self.env, &job).await {
            worker::console_log!(
                "{}",
                serde_json::json!({
                    "event": "ml_dsa_producer_refused_v1", "batch": hex(&job.batch),
                    "error": error.to_string(),
                })
            );
            return Ok(Response::from_json(&false)?.with_status(202));
        }
        log_stage(&job, Participant::A, job.batch, "producer_authorized");
        self.log_job(&job, "queued");
        let receipt_job = job.clone();
        {
            // This gate covers local storage and the actual alarm update only.
            // Arm first so a crash after queue persistence retains a wake-up.
            let _guard = self.storage_gate.lock().await;
            schedule_refill_alarm(&self.state, 50).await?;
            transaction(&self.state, move |store| async move {
                producer_core::enqueue(&store, job, crate::cloudflare_now_unix_ms_v1()?).await
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
        // Defer before Running, role claims, or peer dispatch. Preserve the queued job and its lease.
        let Some(_compute) = compute_slot().try_lock_owned() else {
            self.log_entry("compute_deferred");
            let _guard = self.storage_gate.lock().await;
            schedule_refill_alarm(&self.state, 1_000).await?;
            return Response::empty();
        };
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_producer_entered_v1", "producer": self.state.id().to_string(),
            })
        );
        let action = {
            let _guard = self.storage_gate.lock().await;
            schedule_refill_alarm(&self.state, RECOVERY_CHECK_MS).await?;
            transaction(&self.state, move |store| async move {
                producer_core::next_work(&store).await
            })
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
                let terminal = match result {
                    Ok(PreparationOutcome::Published) => Terminal::Published { job },
                    Ok(PreparationOutcome::Unused) => Terminal::Unused { job },
                    Err(_) => {
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
                            Terminal::Published { job }
                        } else {
                            Terminal::Failed { job }
                        }
                    }
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
                    Terminal::Published { job }
                } else {
                    log_recovery(&job, "deadline_reached");
                    Terminal::Interrupted { job }
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
                .put(&producer_core::record_key(terminal.job().batch), &terminal)
                .await?;
        }
        let outcome = terminal.outcome();
        let published = match outcome {
            refill::Outcome::Published => Some(true),
            refill::Outcome::Failed => Some(false),
            refill::Outcome::Interrupted | refill::Outcome::Unused => None,
        };
        let (candidates, batches) = if matches!(outcome, refill::Outcome::Unused) {
            (0, Vec::new())
        } else {
            let candidates = usize::from(
                policy(&self.env)
                    .map_err(protocol_error)?
                    .candidate_group_size(),
            ) * terminal.job().groups.count();
            (candidates, terminal.job().batch_ids())
        };
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_refill_completed_v1", "batch": hex(&terminal.job().batch),
                "published": published, "outcome": outcome, "elapsed_ms": elapsed,
                "candidates": candidates,
                "batches": batches.iter().map(|id| hex(id)).collect::<Vec<_>>(),
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
        let queue: Vec<[u8; 32]> = self
            .state
            .storage()
            .get(producer_core::PENDING)
            .await?
            .unwrap_or_default();
        if queue.is_empty() {
            self.state.storage().delete_alarm().await
        } else {
            schedule_refill_alarm(&self.state, 50).await
        }
    }
    async fn settle(&self, terminal: &Terminal) -> worker::Result<Response> {
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
            transaction(&self.state, move |store| async move {
                producer_core::remove_head(&store, batch).await
            })
            .await
            .map_err(protocol_error)?;
            self.schedule_pending().await?;
        }
        Response::from_json(&matches!(terminal, Terminal::Published { .. }))
    }
}

async fn settle_remote(env: &Env, terminal: &Terminal) -> Result<()> {
    let job = terminal.job();
    let outcome = terminal.outcome();
    let wake: Vec<KeyScope> = service_call(
        env,
        CallAuthority::Internal,
        &admission_requests::finish_refill(job.clone(), outcome),
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
        let response = local_call(env, &role_requests::wake_refill(key.clone()), None).await?;
        if !response {
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
    let command = role_requests::publication_recorded(job.clone());
    let (a, b) = futures::join!(
        local_call(env, &command, None),
        rpc::role_call(env, "DERIVER_B", &command)
    );
    Ok(a? && b?)
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
