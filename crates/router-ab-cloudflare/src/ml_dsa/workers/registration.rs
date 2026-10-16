//! Private registration orchestration. The Gateway supplies admitted custody identities.
mod adapter;
mod engine;
mod schedules;
mod signing_stock;
use super::*;
use crate::ml_dsa::registration as core;
use ed25519_yao::ml_dsa_runtime::{
    prepared::{
        keygen::{prepare_keygen, PreparedKeygen},
        Transport,
    },
    TrustedMlDsaSchedule,
};
use ed25519_yao::ml_dsa_signing::SigningRole;
use std::future::Future;
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
async fn transaction<T, F, Fut>(state: &State, work: F) -> Result<T>
where
    T: 'static,
    F: FnOnce(TransactionStore) -> Fut + 'static,
    Fut: Future<Output = Result<T>> + 'static,
{
    let output = Rc::new(RefCell::new(None));
    let captured = Rc::clone(&output);
    state
        .storage()
        .transaction(move |tx| async move {
            let value = work(TransactionStore(tx)).await.map_err(protocol_error)?;
            captured.replace(Some(value));
            Ok(())
        })
        .await
        .map_err(storage_error)?;
    let result = output
        .borrow_mut()
        .take()
        .ok_or_else(|| invalid("Registration transaction returned no result"));
    result
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
    let forwarded = if request.method() == Method::Get {
        socket_request(env, ROLE_PATH, &command).map_err(protocol_error)?
    } else {
        object_request(env, CallAuthority::Internal, ROLE_PATH, &command).map_err(protocol_error)?
    };
    stub.fetch_with_request(forwarded).await
}
async fn role_call<T: serde::de::DeserializeOwned>(
    env: &Env,
    role: &str,
    command: &Command,
) -> Result<T> {
    let mut response = crate::router_coordinator::post_role_request(
        env,
        role,
        "https://ml-dsa.internal",
        ROLE_PATH,
        "ML-DSA registration",
        command,
        None,
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
    mut request: worker::Request,
    env: &Env,
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
    let job: core::Job = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::PrepareRegistration {
            scope: core::scope(&input.wallet).map_err(protocol_error)?,
            schedule: execution::schedule_digest(&schedules::load().map_err(protocol_error)?),
            signing_schedule: execution::schedule_digest(
                &super::schedules::load().map_err(protocol_error)?,
            ),
            signing_batches: policy(env).map_err(protocol_error)?.refill_target_batches(),
        },
    )
    .await
    .map_err(protocol_error)?;
    let ready: bool = role_call(env, "DERIVER_A", &Command::Prepare { job: job.clone() })
        .await
        .map_err(protocol_error)?;
    Response::from_json(&serde_json::json!({"ready":ready,"job":job}))
}
pub(crate) async fn handle_register(
    mut request: worker::Request,
    env: &Env,
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
    let decision: core::Decision = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::ClaimRegistration {
            request: input,
            schedule: execution::schedule_digest(&schedules::load().map_err(protocol_error)?),
        },
    )
    .await
    .map_err(protocol_error)?;
    let claim = match decision {
        core::Decision::Admitted { claim } => claim,
        core::Decision::Existing {
            operation: core::Operation::Running { claim },
        } => claim,
        other => return Response::from_json(&other),
    };
    let execution = execute_with_storage_initialization(env, &claim)
        .await
        .map_err(protocol_error)?;
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
    if !a.map_err(protocol_error)? || !b.map_err(protocol_error)? {
        return Response::error("Registration installation is incomplete", 503);
    }
    let mut activated = coordinator::activate(env, request.headers(), activation).await?;
    if activated.status_code() != 200 {
        return Ok(activated);
    }
    let state: admission::KeyState = activated.json().await?;
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
    Response::from_json(&core::Decision::Existing { operation })
}

#[durable_object]
pub struct RouterAbMlDsaRegistrationDurableObject {
    state: Rc<State>,
    env: Env,
}
impl DurableObject for RouterAbMlDsaRegistrationDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self {
            state: Rc::new(state),
            env,
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
        check(&self.env, &command).await.map_err(protocol_error)?;
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
                let result = engine::connected(&env, &state, &command, &pair.server).await;
                let _ = pair.server.close(
                    Some(if result.is_ok() { 1000 } else { 1011 }),
                    Some("Registration peer ended"),
                );
            });
            return Response::from_websocket(pair.client);
        }
        let value = match &command {
            Command::Install { claim } => {
                if self
                    .state
                    .storage()
                    .get::<bool>("installed")
                    .await?
                    .unwrap_or(false)
                {
                    return Response::from_json(&true);
                }
                let record: material::Record =
                    self.state.storage().get("material").await?.ok_or_else(|| {
                        protocol_error(invalid("Registration material is absent"))
                    })?;
                if record.activation.ceremony_id != claim.request.operation {
                    return Response::error("Registration material changed", 409);
                }
                let key = record.activation.key.clone();
                let response = local_call(&self.env, &RoleCommand::InstallMaterial { record })
                    .await
                    .map_err(protocol_error)?;
                if response.status_code() != 200 {
                    return Ok(response);
                }
                signing_stock::install(&self.env, &self.state, claim, &key)
                    .await
                    .map_err(protocol_error)?;
                transaction(&self.state, move |store| async move {
                    store.put("installed", &true).await?;
                    store.delete("material").await
                })
                .await
                .map_err(protocol_error)?;
                serde_json::json!(true)
            }
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
                let response = self
                    .env
                    .service("DERIVER_B")?
                    .fetch_request(
                        socket_request(&self.env, ROLE_PATH, &peer).map_err(protocol_error)?,
                    )
                    .await?;
                if response.status_code() != 101 {
                    return Response::error("Registration peer connection failed", 503);
                }
                let socket = response
                    .websocket()
                    .ok_or_else(|| protocol_error(invalid("Registration socket absent")))?;
                let result = engine::connected(&self.env, &self.state, &command, &socket).await;
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
