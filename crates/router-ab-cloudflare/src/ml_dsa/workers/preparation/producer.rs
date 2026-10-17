//! Durable dispatch. Heavy preparation runs in an independent alarm invocation.
use super::*;

const STATE: &str = "producer-job";
const NAMESPACE: &str = "ML_DSA_PRODUCER_DO";
const RECOVERY_CHECK_MS: u64 = 5_000;

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

pub(crate) async fn handle_start(
    mut request: worker::Request,
    env: Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_internal_service_auth_request_v1(&request, &env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post || configured_role(&env)? != Participant::A {
        return Response::error("ML-DSA preparation requires participant A POST", 400);
    }
    let job: refill::Job = decode_bounded_json_request(&mut request, 16_384)
        .await
        .map_err(protocol_error)?;
    let stub = env
        .durable_object(NAMESPACE)?
        .id_from_name(&hex(&job.batch))?
        .get_stub()?;
    let forwarded =
        object_request(&env, CallAuthority::Internal, START_PATH, &job).map_err(protocol_error)?;
    stub.fetch_with_request(forwarded).await
}

#[durable_object]
pub struct RouterAbMlDsaProducerDurableObject {
    state: State,
    env: Env,
}
impl DurableObject for RouterAbMlDsaProducerDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self { state, env }
    }
    async fn fetch(&self, mut request: worker::Request) -> worker::Result<Response> {
        if let Err(error) =
            crate::require_cloudflare_internal_service_auth_request_v1(&request, &self.env)
        {
            return crate::cloudflare_private_service_auth_error_response_v1(error);
        }
        if request.method() != Method::Post
            || request.path() != START_PATH
            || configured_role(&self.env)? != Participant::A
        {
            return Response::error("Invalid ML-DSA producer request", 400);
        }
        let job: refill::Job = decode_bounded_json_request(&mut request, 16_384)
            .await
            .map_err(protocol_error)?;
        check_job(&self.env, &job).await.map_err(protocol_error)?;
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
        if queued {
            schedule_refill_alarm(&self.state, 50).await?;
        }
        Ok(Response::from_json(&true)?.with_status(202))
    }
    async fn alarm(&self) -> worker::Result<Response> {
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
                let start = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
                // Alarm handlers are serialized per object. This timer cannot
                // interrupt healthy work; it wakes an interrupted invocation.
                self.schedule_recovery(&job, start).await?;
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
            AlarmWork::Settle(terminal) => return self.settle(&terminal).await,
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
                "published": published, "elapsed_ms": elapsed, "candidates": executor::CANDIDATES,
            })
        );
        self.settle(&terminal).await
    }
}
impl RouterAbMlDsaProducerDurableObject {
    async fn schedule_recovery(&self, job: &refill::Job, now: u64) -> worker::Result<()> {
        let delay = job
            .expires_at_ms
            .saturating_sub(now)
            .clamp(1, RECOVERY_CHECK_MS);
        schedule_refill_alarm(&self.state, delay).await
    }
    async fn settle(&self, terminal: &ProducerState) -> worker::Result<Response> {
        let _: bool = service_call(
            &self.env,
            CallAuthority::Internal,
            &AdmissionCommand::FinishRefill {
                job: terminal.job().clone(),
            },
        )
        .await
        .map_err(protocol_error)?;
        self.state.storage().delete_alarm().await?;
        Response::from_json(&matches!(terminal, ProducerState::Published { .. }))
    }
}

async fn paired_publication(env: &Env, job: &refill::Job) -> Result<bool> {
    let command = RoleCommand::Inspect {
        key: job.key.clone(),
        batches: vec![job.batch],
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
    Ok(publication_present(&a) && publication_present(&b))
}

fn publication_present(states: &[pool::BatchAvailability]) -> bool {
    matches!(
        states,
        [pool::BatchAvailability::Ready | pool::BatchAvailability::Reserved]
    )
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
