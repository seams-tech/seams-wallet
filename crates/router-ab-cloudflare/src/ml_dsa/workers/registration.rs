//! Private registration orchestration. The Gateway supplies admitted custody identities.
mod adapter;
mod engine;
mod schedules;
mod signing_stock;
use super::*;
use crate::ml_dsa::registration as core;
use ml_dsa_threshold::runtime::{
    prepared::{
        keygen::{prepare_keygen, PreparedKeygen},
        Transport,
    },
    TrustedMlDsaSchedule,
};
use ml_dsa_threshold::signing::SigningRole;
use worker::{WebSocket, WebSocketPair};
use zeroize::Zeroizing;
pub const PREPARE_PATH: &str = "/router-ab/ml-dsa/registration/prepare";
pub const REGISTER_PATH: &str = "/router-ab/ml-dsa/register";
pub const ROLE_PATH: &str = "/router-ab/ml-dsa/registration/role";
const BINDING: &str = "ML_DSA_REGISTRATION_DO";
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
    Prepare { job: core::Job },
    PreparePeer { job: core::Job },
    Execute { claim: core::Claim },
    ExecutePeer { claim: core::Claim },
    Install { claim: core::Claim },
    Result { claim: core::Claim },
}
impl Command {
    fn phase(&self) -> &'static str {
        match self {
            Self::Prepare { .. } => "prepare",
            Self::PreparePeer { .. } => "prepare_peer",
            Self::Execute { .. } => "execute",
            Self::ExecutePeer { .. } => "execute_peer",
            Self::Install { .. } => "install",
            Self::Result { .. } => "result",
        }
    }
    fn operation(&self) -> Option<[u8; 32]> {
        match self {
            Self::Prepare { .. } | Self::PreparePeer { .. } => None,
            Self::Execute { claim }
            | Self::ExecutePeer { claim }
            | Self::Install { claim }
            | Self::Result { claim } => Some(claim.request.operation),
        }
    }
    fn stamp(
        &self,
        request: &mut worker::Request,
        call: Option<crate::CloudflareTraceIdV1>,
    ) -> Result<()> {
        let headers = request.headers_mut().map_err(storage_error)?;
        headers
            .set("x-ml-dsa-job-id", &hex(&self.job().id))
            .map_err(storage_error)?;
        headers
            .set("x-ml-dsa-command", self.phase())
            .map_err(storage_error)?;
        if let Some(operation) = self.operation() {
            headers
                .set("x-ml-dsa-operation-id", &hex(&operation))
                .map_err(storage_error)?;
        }
        if let Some(call) = call {
            crate::set_cloudflare_trace_id_header_v1(headers, call)?;
        }
        Ok(())
    }
    fn dispatched(&self, call: Option<crate::CloudflareTraceIdV1>) {
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_registration_call_v1", "job": hex(&self.job().id),
                "operation": self.operation().as_ref().map(|value| hex(value)),
                "phase": self.phase(), "call_id": call.map(crate::CloudflareTraceIdV1::as_hex),
            })
        );
    }
    fn job(&self) -> &core::Job {
        match self {
            Self::Prepare { job } | Self::PreparePeer { job } => job,
            Self::Execute { claim }
            | Self::ExecutePeer { claim }
            | Self::Install { claim }
            | Self::Result { claim } => &claim.job,
        }
    }
}
fn runtime_error(_: impl std::fmt::Display) -> RouterAbProtocolError {
    invalid("ML-DSA registration execution failed")
}
async fn check(env: &Env, command: &Command) -> Result<()> {
    let command = match command {
        Command::Prepare { job } | Command::PreparePeer { job } => {
            AdmissionCommand::CheckRegistrationJob { job: job.clone() }
        }
        Command::Execute { claim }
        | Command::ExecutePeer { claim }
        | Command::Install { claim }
        | Command::Result { claim } => AdmissionCommand::CheckRegistrationClaim {
            claim: claim.clone(),
        },
    };
    let allowed: bool = service_call(env, CallAuthority::Internal, &command).await?;
    if allowed {
        Ok(())
    } else {
        Err(invalid("Registration authority is absent or expired"))
    }
}
pub(crate) async fn handle_role(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_internal_service_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    let command: Command = if request.method() == Method::Get {
        socket_input(&request).map_err(protocol_error)?
    } else {
        decode_bounded_json_request(&mut request, 32_768)
            .await
            .map_err(protocol_error)?
    };
    let namespace = env.durable_object(BINDING)?;
    let stub = namespace
        .id_from_name(&hex(&command.job().id))?
        .get_stub()?;
    let call = crate::parse_cloudflare_trace_id_from_request_v1(&request)
        .ok()
        .flatten();
    let mut forwarded = if request.method() == Method::Get {
        socket_request(env, ROLE_PATH, &command).map_err(protocol_error)?
    } else {
        object_request(env, CallAuthority::Internal, ROLE_PATH, &command).map_err(protocol_error)?
    };
    command
        .stamp(&mut forwarded, call)
        .map_err(protocol_error)?;
    stub.fetch_with_request(forwarded).await
}
async fn role_call<T: serde::de::DeserializeOwned>(
    env: &Env,
    role: &str,
    command: &Command,
) -> Result<T> {
    let call = wait_trace::call_id();
    command.dispatched(call);
    let mut response = crate::router_coordinator::post_role_request(
        env,
        role,
        "https://ml-dsa.internal",
        ROLE_PATH,
        "ML-DSA registration",
        command,
        call,
    )
    .await?;
    if response.status_code() != 200 {
        return Err(invalid("Registration participant refused the request"));
    }
    response.json().await.map_err(storage_error)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PrepareRequest {
    wallet: WalletScope,
}
pub(crate) async fn handle_prepare(
    request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    let mut trace = router_trace::RouterTrace::new(request.headers())?;
    let mut response = prepare_request(request, env, &mut trace).await;
    trace.finish(&mut response)?;
    response
}
async fn prepare_request(
    mut request: worker::Request,
    env: &Env,
    trace: &mut router_trace::RouterTrace,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("Registration preparation requires POST", 405);
    }
    let input: PrepareRequest = decode_bounded_json_request(&mut request, 4096)
        .await
        .map_err(protocol_error)?;
    let deadline = crate::cloudflare_now_unix_ms_v1()
        .map_err(protocol_error)?
        .saturating_add(300_000);
    loop {
        let status: core::queue::Status = service_call(
            env,
            CallAuthority::Gateway(request.headers()),
            &AdmissionCommand::PrepareRegistration {
                wallet: input.wallet.clone(),
                schedule: schedules::DIGEST,
                signing_schedule: signing_schedule_digest(env).map_err(protocol_error)?,
                signing_batches: policy(env)
                    .map_err(protocol_error)?
                    .minimum_ready_batches()
                    .max(2),
            },
        )
        .await
        .map_err(protocol_error)?;
        match status {
            core::queue::Status::Ready { job } => {
                trace.bind_job(job.id);
                return Response::from_json(&serde_json::json!({"ready":true,"job":job}));
            }
            core::queue::Status::Pending { retry_at_ms } => {
                let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
                if now >= deadline {
                    return Err(protocol_error(invalid(
                        "Registration preparation deadline expired",
                    )));
                }
                let delay = retry_at_ms
                    .saturating_sub(now)
                    .clamp(50, 1_000)
                    .min(deadline - now);
                worker::Delay::from(std::time::Duration::from_millis(delay)).await;
            }
        }
    }
}

pub(super) async fn prepare_job(env: &Env, job: &core::Job) -> Result<bool> {
    role_call(env, "DERIVER_A", &Command::Prepare { job: job.clone() }).await
}

pub(super) async fn run_preparation_queue(
    env: &Env,
    state: &State,
    storage_gate: &futures::lock::Mutex<()>,
) -> worker::Result<Response> {
    let configured = policy(env).map_err(protocol_error)?;
    let configuration = core::queue::Configuration::new(
        schedules::DIGEST,
        signing_schedule_digest(env).map_err(protocol_error)?,
        configured.minimum_ready_batches().max(2),
    )
    .map_err(protocol_error)?;
    let work = {
        let _storage = storage_gate.lock().await;
        schedule_refill_alarm(state, 5_000).await?;
        let work = transaction(state, move |store| async move {
            core::queue::next(&store, &configuration, crate::cloudflare_now_unix_ms_v1()?).await
        })
        .await
        .map_err(protocol_error)?;
        match &work {
            core::queue::Work::Idle => state.storage().delete_alarm().await?,
            core::queue::Work::Wait { retry_at_ms } => {
                let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
                schedule_refill_alarm(state, retry_at_ms.saturating_sub(now).max(1)).await?;
            }
            core::queue::Work::Prepare { .. } => {}
        }
        work
    };
    if let core::queue::Work::Prepare { job } = work {
        let expected = env
            .durable_object(SERVICE_BINDING)?
            .id_from_name(&job.service_group.admission_name())?
            .to_string();
        if expected != state.id().to_string() {
            return Err(protocol_error(invalid(
                "Registration preparation reached the wrong group",
            )));
        }
        worker::console_log!(
            "{}",
            serde_json::json!({"event":"ml_dsa_generic_preparation_v1","job":hex(&job.id),"stage":"started"})
        );
        let outcome = before_deadline(job.prepare_until, prepare_job(env, &job)).await;
        let completed_job = job.clone();
        let _storage = storage_gate.lock().await;
        transaction(state, move |store| async move {
            core::queue::finish(&store, &completed_job, crate::cloudflare_now_unix_ms_v1()?).await
        })
        .await
        .map_err(protocol_error)?;
        schedule_refill_alarm(state, 50).await?;
        worker::console_log!(
            "{}",
            serde_json::json!({"event":"ml_dsa_generic_preparation_v1","job":hex(&job.id),"stage":"settled","transport_succeeded":matches!(outcome,Ok(true))})
        );
    }
    Response::from_json(&true)
}

pub(crate) async fn handle_register(
    request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    let mut trace = router_trace::RouterTrace::new(request.headers())?;
    let mut response = register_request(request, env, &mut trace).await;
    trace.finish(&mut response)?;
    response
}
async fn register_request(
    mut request: worker::Request,
    env: &Env,
    trace: &mut router_trace::RouterTrace,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("Registration requires POST", 405);
    }
    let input: core::Request = decode_bounded_json_request(&mut request, 32_768)
        .await
        .map_err(protocol_error)?;
    trace.bind(input.operation);
    let decision: core::Decision = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::ClaimRegistration {
            request: input,
            schedule: schedules::DIGEST,
        },
    )
    .await
    .map_err(protocol_error)?;
    trace.mark("admission_done");
    let claim = match decision {
        core::Decision::Admitted { claim } => claim,
        core::Decision::Existing {
            operation: core::Operation::Running { claim },
        } => claim,
        other => return Response::from_json(&other),
    };
    trace.bind_job(claim.job.id);
    let execution = execute_with_storage_initialization(env, &claim)
        .await
        .map_err(protocol_error)?;
    trace.mark("execution_done");
    let result = match execution {
        core::ExecutionReply::Complete { result } => result,
        core::ExecutionReply::Running => {
            return Response::from_json(&core::Decision::Existing {
                operation: core::Operation::Running { claim },
            })
        }
    };
    if result.a.activation != result.b.activation || result.a.public_key != result.b.public_key {
        return Response::error("Registration participant results disagree", 409);
    }
    let activation = result.a.activation.clone();
    let started = coordinator::activate(env, request.headers(), activation.clone()).await?;
    trace.mark("activation_started");
    if started.status_code() != 200 {
        return Ok(started);
    }
    let install = Command::Install {
        claim: claim.clone(),
    };
    let (a, b) = futures::join!(
        role_call::<bool>(env, "DERIVER_A", &install),
        role_call::<bool>(env, "DERIVER_B", &install)
    );
    trace.mark("installation_done");
    if !a.map_err(protocol_error)? || !b.map_err(protocol_error)? {
        return Response::error("Registration installation is incomplete", 503);
    }
    let mut activated = coordinator::activate(env, request.headers(), activation).await?;
    if activated.status_code() != 200 {
        return Ok(activated);
    }
    let state: admission::KeyState = activated.json().await?;
    trace.mark("activation_done");
    if !matches!(state, admission::KeyState::Active { .. }) {
        return Response::error("Registration activation is incomplete", 503);
    }
    let operation: core::Operation = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::FinishRegistration { claim, result },
    )
    .await
    .map_err(protocol_error)?;
    trace.mark("completion_recorded");
    Response::from_json(&core::Decision::Existing { operation })
}

#[cfg_attr(not(feature = "strict-worker-router-entrypoint"), durable_object)]
pub struct RouterAbMlDsaRegistrationDurableObject {
    state: Rc<State>,
    env: Env,
    installation_gate: futures::lock::Mutex<()>,
}
impl RouterAbMlDsaRegistrationDurableObject {
    async fn install(&self, claim: &core::Claim) -> worker::Result<Response> {
        let command = Command::Install {
            claim: claim.clone(),
        };
        check(&self.env, &command).await.map_err(protocol_error)?;
        // Exact concurrent retries share one bounded delivery window.
        let _guard = self.installation_gate.lock().await;
        let trace = stage_trace::StageTrace::new(
            claim.request.operation,
            configured_role(&self.env)?,
            stage_trace::Context::RegistrationInstall { job: claim.job.id },
        );
        if self
            .state
            .storage()
            .get::<bool>("installed")
            .await?
            .unwrap_or(false)
        {
            trace.finish();
            return Response::from_json(&true);
        }
        // The claim can expire while this request waits for the gate.
        check(&self.env, &command).await.map_err(protocol_error)?;
        trace.mark("installation_checked");
        let record: material::Record = self
            .state
            .storage()
            .get("material")
            .await?
            .ok_or_else(|| protocol_error(invalid("Registration material is absent")))?;
        if record.activation.ceremony_id != claim.request.operation {
            return Response::error("Registration material changed", 409);
        }
        trace.mark("material_loaded");
        let key = record.activation.key.clone();
        let response = local_call(&self.env, &RoleCommand::InstallMaterial { record }, None)
            .await
            .map_err(protocol_error)?;
        if response.status_code() != 200 {
            return Ok(response);
        }
        trace.mark("material_installed");
        signing_stock::install(&self.env, &self.state, claim, &key)
            .await
            .map_err(protocol_error)?;
        trace.mark("stock_installed");
        transaction(&self.state, move |store| async move {
            store.put("installed", &true).await?;
            store.delete("material").await
        })
        .await
        .map_err(protocol_error)?;
        trace.finish();
        Response::from_json(&true)
    }
}
#[cfg(not(feature = "strict-worker-router-entrypoint"))]
impl DurableObject for RouterAbMlDsaRegistrationDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self {
            state: Rc::new(state),
            env,
            installation_gate: futures::lock::Mutex::new(()),
        }
    }
    async fn fetch(&self, mut request: worker::Request) -> worker::Result<Response> {
        if let Err(error) =
            crate::require_cloudflare_internal_service_auth_request_v1(&request, &self.env)
        {
            return crate::cloudflare_private_service_auth_error_response_v1(error);
        }
        let command: Command = if request.method() == Method::Get {
            socket_input(&request).map_err(protocol_error)?
        } else {
            decode_bounded_json_request(&mut request, 32_768)
                .await
                .map_err(protocol_error)?
        };
        let call = crate::parse_cloudflare_trace_id_from_request_v1(&request)
            .ok()
            .flatten();
        let waits = wait_trace::WaitTrace::new(
            &self.env,
            command.job().id,
            command.operation(),
            configured_role(&self.env)?,
            call,
        )
        .map_err(protocol_error)?;
        if let Command::Install { claim } = &command {
            return before_deadline(claim.deadline, async {
                self.install(claim).await.map_err(storage_error)
            })
            .await
            .map_err(protocol_error);
        }
        check(&self.env, &command).await.map_err(protocol_error)?;
        let preparation_guard = if matches!(
            &command,
            Command::Prepare { .. } | Command::PreparePeer { .. }
        ) {
            let guard = before_deadline(command.job().prepare_until, async {
                Ok(super::preparation::compute_slot().lock_owned().await)
            })
            .await
            .map_err(protocol_error)?;
            check(&self.env, &command).await.map_err(protocol_error)?;
            Some(guard)
        } else {
            None
        };
        if matches!(
            &command,
            Command::PreparePeer { .. } | Command::ExecutePeer { .. }
        ) {
            if configured_role(&self.env)? != Participant::B {
                return Response::error("Registration peer requires B", 400);
            }
            let pair = WebSocketPair::new()?;
            let state = Rc::clone(&self.state);
            let env = self.env.clone();
            self.state.wait_until(async move {
                let _preparation = preparation_guard;
                let result = engine::connected(&env, &state, &command, &pair.server, waits).await;
                let _ = pair.server.close(
                    Some(if result.is_ok() { 1000 } else { 1011 }),
                    Some("Registration peer ended"),
                );
            });
            return Response::from_websocket(pair.client);
        }
        let _preparation = preparation_guard;
        let value = match &command {
            Command::Result { .. } => {
                let value: Option<core::RoleResult> =
                    self.state.storage().get("own-result").await?;
                serde_json::to_value(value)
                    .map_err(|_| protocol_error(invalid("Registration result encoding failed")))?
            }
            _ => {
                if configured_role(&self.env)? != Participant::A {
                    return Response::error("Registration coordinator requires A", 400);
                }
                if let Command::Execute { claim } = &command {
                    if let Some(result) = self
                        .state
                        .storage()
                        .get::<core::Completed>("pair-result")
                        .await?
                    {
                        return Response::from_json(&core::ExecutionReply::Complete { result });
                    }
                    if let Some(own) = self
                        .state
                        .storage()
                        .get::<core::RoleResult>("own-result")
                        .await?
                    {
                        let peer: Option<core::RoleResult> = role_call(
                            &self.env,
                            "DERIVER_B",
                            &Command::Result {
                                claim: claim.clone(),
                            },
                        )
                        .await
                        .map_err(protocol_error)?;
                        let Some(peer) = peer else {
                            return Response::from_json(&core::ExecutionReply::Running);
                        };
                        let result = engine::pair(own, peer).map_err(protocol_error)?;
                        self.state.storage().put("pair-result", &result).await?;
                        return Response::from_json(&core::ExecutionReply::Complete { result });
                    }
                }
                if matches!(&command, Command::Execute { .. }) {
                    let fresh = transaction(&self.state, move |store| async move {
                        if store.get::<bool>("execution-dispatched").await?.is_some() {
                            return Ok(false);
                        }
                        store.put("execution-dispatched", &true).await?;
                        Ok(true)
                    })
                    .await
                    .map_err(protocol_error)?;
                    if !fresh {
                        return Response::from_json(&core::ExecutionReply::Running);
                    }
                }
                let peer = match &command {
                    Command::Prepare { job } => Command::PreparePeer { job: job.clone() },
                    Command::Execute { claim } => Command::ExecutePeer {
                        claim: claim.clone(),
                    },
                    _ => return Response::error("Invalid registration command", 400),
                };
                let peer_call = wait_trace::call_id();
                peer.dispatched(peer_call);
                let mut peer_request =
                    socket_request(&self.env, ROLE_PATH, &peer).map_err(protocol_error)?;
                peer.stamp(&mut peer_request, peer_call)
                    .map_err(protocol_error)?;
                let service = self.env.service("DERIVER_B")?;
                let response = wait_trace::observe(
                    waits.as_deref(),
                    wait_trace::Kind::PeerConnect,
                    service.fetch_request(peer_request),
                )
                .await?;
                if response.status_code() != 101 {
                    return Response::error("Registration peer connection failed", 503);
                }
                let socket = response
                    .websocket()
                    .ok_or_else(|| protocol_error(invalid("Registration socket absent")))?;
                let result =
                    engine::connected(&self.env, &self.state, &command, &socket, waits).await;
                let _ = socket.close(
                    Some(if result.is_ok() { 1000 } else { 1011 }),
                    Some("Registration ended"),
                );
                let value = result.map_err(protocol_error)?;
                if matches!(&command, Command::Execute { .. }) {
                    let result: core::Completed = serde_json::from_value(value).map_err(|_| {
                        protocol_error(invalid("Invalid registration execution result"))
                    })?;
                    serde_json::to_value(core::ExecutionReply::Complete { result })
                        .map_err(|_| protocol_error(invalid("Invalid registration result")))?
                } else {
                    value
                }
            }
        };
        Response::from_json(&value)
    }
    async fn alarm(&self) -> worker::Result<Response> {
        let binding: registration_preparation::Binding =
            match self.state.storage().get("binding").await? {
                Some(value) => value,
                None => return Response::from_json(&true),
            };
        let done = transaction(&self.state, move |store| async move {
            registration_preparation::retire(&store, &binding).await?;
            registration_tables::retire_next(&store, &binding).await
        })
        .await
        .map_err(protocol_error)?;
        let done = if done {
            let job: Option<core::Job> = self.state.storage().get("job").await?;
            match job {
                Some(job) => signing_stock::retire_next(&self.state, job.signing_batches)
                    .await
                    .map_err(protocol_error)?,
                None => true,
            }
        } else {
            false
        };
        if !done {
            schedule_refill_alarm(&self.state, 1_000).await?;
        }
        Response::from_json(&done)
    }
}

async fn require_live_execution(
    store: &impl Store,
    claim: &core::Claim,
    binding: &registration_preparation::Binding,
) -> Result<()> {
    let now = crate::cloudflare_now_unix_ms_v1()?;
    if now >= claim.deadline {
        return Err(invalid("Registration signing commitment deadline expired"));
    }
    registration_preparation::require_consumed(store, binding, claim.request.operation, now).await
}

async fn execute_with_storage_initialization(
    env: &Env,
    claim: &core::Claim,
) -> Result<core::ExecutionReply> {
    let command = Command::Execute {
        claim: claim.clone(),
    };
    let execution = before_deadline(claim.deadline, role_call(env, "DERIVER_A", &command));
    let initialization = before_deadline(claim.deadline, initialize_storage(env, claim));
    futures::pin_mut!(execution, initialization);
    match futures::future::select(execution, initialization).await {
        futures::future::Either::Left((result, _)) => result,
        futures::future::Either::Right((initialized, execution)) => {
            if initialized.is_err() {
                worker::console_warn!("Optional ML-DSA storage initialization failed");
            }
            execution.await
        }
    }
}
async fn initialize_storage(env: &Env, claim: &core::Claim) -> Result<()> {
    let command = RoleCommand::InitializeRegistrationStorage {
        claim: claim.clone(),
    };
    let (a, b) = futures::join!(
        coordinator::role_call::<bool>(env, "DERIVER_A", &command),
        coordinator::role_call::<bool>(env, "DERIVER_B", &command),
    );
    if !a? || !b? {
        return Err(invalid("ML-DSA storage initialization was refused"));
    }
    Ok(())
}
