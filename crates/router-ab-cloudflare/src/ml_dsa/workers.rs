//! Private Worker routes and transactional Durable Object adapters.
mod coordinator;
use super::{
    admission::{self, Claim, Completion, Decision, Permit, Status},
    policy::Policy,
    pool,
    sealing::{Binding, Sealed},
    *,
};
use crate::durable_object::tenant_root_creation::decode_bounded_json_request;
pub(crate) use coordinator::{handle_activate, handle_admit, handle_complete, handle_status};
use std::{cell::RefCell, rc::Rc};
use worker::{durable_object, DurableObject, Env, Method, Response, State, Transaction};

pub const ACTIVATE_PATH: &str = "/router-ab/ml-dsa/activate";
pub const ADMIT_PATH: &str = "/router-ab/ml-dsa/admit";
pub const COMPLETE_PATH: &str = "/router-ab/ml-dsa/complete";
pub const STATUS_PATH: &str = "/router-ab/ml-dsa/status";
pub const ROLE_PATH: &str = "/router-ab/ml-dsa/role";
const SERVICE_BINDING: &str = "ML_DSA_ADMISSION_DO";
const POOL_BINDING: &str = "ML_DSA_POOL_DO";
const SERVICE_NAME: &str = "ml-dsa-admission-v1";
const CONTROL_PATH: &str = "/control";
const CHECK_PATH: &str = "/check";

#[derive(Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum AdmissionCommand {
    AuthorizeKey {
        activation: admission::KeyActivation,
    },
    ActiveKey {
        key: KeyScope,
    },
    Begin {
        request: super::SigningRequest,
    },
    Admit {
        claim: Claim,
        batches: Vec<[u8; 32]>,
    },
    Cancel {
        claim: Claim,
    },
    Finish {
        permit: Permit,
        completion: Completion,
    },
    Lookup {
        request: super::SigningRequest,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum RoleCommand {
    Inspect {
        key: KeyScope,
        batches: Vec<[u8; 32]>,
    },
    RetireUnpaired {
        key: KeyScope,
        batches: Vec<[u8; 32]>,
    },
    Fence {
        request: super::SigningRequest,
        batches: Vec<[u8; 32]>,
    },
    RefillStatus {
        key: KeyScope,
    },
    Install {
        key: KeyScope,
    },
    Put {
        binding: Binding,
        sealed: Sealed,
    },
    Inventory {
        key: KeyScope,
        target: usize,
        ready_until_ms: u64,
    },
    Reserve {
        claim: Claim,
        batches: Vec<[u8; 32]>,
    },
    Take {
        permit: Permit,
        batch: [u8; 32],
    },
    Release {
        request: super::SigningRequest,
        batches: Vec<[u8; 32]>,
        settlement: pool::Settlement,
        consumed_union: Vec<[u8; 32]>,
    },
}
impl RoleCommand {
    fn key(&self) -> &KeyScope {
        match self {
            Self::Install { key }
            | Self::Inventory { key, .. }
            | Self::RefillStatus { key }
            | Self::Inspect { key, .. }
            | Self::RetireUnpaired { key, .. } => key,
            Self::Put { binding, .. } => &binding.key,
            Self::Reserve { claim, .. } => &claim.request.key,
            Self::Take { permit, .. } => &permit.request.key,
            Self::Release { request, .. } | Self::Fence { request, .. } => &request.key,
        }
    }
}
pub fn policy(env: &Env) -> Result<Policy> {
    match env.var("ML_DSA_ADMISSION_POLICY") {
        Ok(value) => Policy::parse(&value.to_string()),
        Err(_) => Ok(Policy::default()),
    }
}
fn protocol_error(error: RouterAbProtocolError) -> worker::Error {
    worker::Error::RustError(error.to_string())
}
fn storage_error(error: worker::Error) -> RouterAbProtocolError {
    let _ = error;
    invalid("ML-DSA storage operation failed")
}
fn json<T: Serialize>(value: T) -> Result<serde_json::Value> {
    serde_json::to_value(value).map_err(|_| invalid("ML-DSA response encoding failed"))
}
struct TransactionStore(Transaction);
impl Store for TransactionStore {
    async fn get<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        match self.0.get(key).await {
            Ok(value) => Ok(Some(value)),
            Err(worker::Error::JsError(message)) if message == "No such value in storage." => {
                Ok(None)
            }
            Err(error) => Err(storage_error(error)),
        }
    }
    async fn put<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        self.0.put(key, value).await.map_err(storage_error)
    }
    async fn delete(&self, key: &str) -> Result<()> {
        self.0.delete(key).await.map(|_| ()).map_err(storage_error)
    }
}

#[durable_object]
pub struct RouterAbMlDsaAdmissionDurableObject {
    state: State,
    env: Env,
}
impl DurableObject for RouterAbMlDsaAdmissionDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self { state, env }
    }
    async fn fetch(&self, mut request: worker::Request) -> worker::Result<Response> {
        if request.method() != Method::Post {
            return Response::error("ML-DSA requires POST", 405);
        }
        let checking = request.path() == CHECK_PATH;
        if !checking && request.path() != CONTROL_PATH {
            return Response::error("Unknown ML-DSA route", 404);
        }
        if checking {
            if let Err(error) =
                crate::require_cloudflare_internal_service_auth_request_v1(&request, &self.env)
            {
                return crate::cloudflare_private_service_auth_error_response_v1(error);
            }
        } else {
            if let Err(error) =
                crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, &self.env)
            {
                return crate::cloudflare_private_service_auth_error_response_v1(error);
            }
        }
        let command: AdmissionCommand = decode_bounded_json_request(&mut request, 131_072)
            .await
            .map_err(protocol_error)?;
        if checking
            && !matches!(
                command,
                AdmissionCommand::Lookup { .. } | AdmissionCommand::ActiveKey { .. }
            )
        {
            return Response::error("ML-DSA read authority required", 403);
        }
        let policy = policy(&self.env).map_err(protocol_error)?;
        let output = Rc::new(RefCell::new(None));
        let captured = Rc::clone(&output);
        self.state
            .storage()
            .transaction(move |transaction| async move {
                let store = TransactionStore(transaction);
                let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
                let value = execute_admission(&store, &policy, command, now)
                    .await
                    .map_err(protocol_error)?;
                captured.replace(Some(value));
                Ok(())
            })
            .await?;
        let value = output.borrow_mut().take().ok_or_else(|| {
            worker::Error::RustError("ML-DSA transaction returned no result".into())
        })?;
        Response::from_json(&value)
    }
}
async fn execute_admission(
    store: &impl Store,
    policy: &Policy,
    command: AdmissionCommand,
    now: u64,
) -> Result<serde_json::Value> {
    match command {
        AdmissionCommand::AuthorizeKey { activation } => {
            admission::authorize_key(store, activation).await?;
            json(true)
        }
        AdmissionCommand::ActiveKey { key } => json(admission::active_key(store, &key).await?),
        AdmissionCommand::Begin { request } => {
            json(admission::begin(store, policy, request, now).await?)
        }
        AdmissionCommand::Admit { claim, batches } => {
            json(admission::admit(store, policy, claim, batches, now).await?)
        }
        AdmissionCommand::Cancel { claim } => {
            admission::cancel(store, &claim).await?;
            json(true)
        }
        AdmissionCommand::Finish { permit, completion } => {
            json(admission::finish(store, &permit, completion, now).await?)
        }
        AdmissionCommand::Lookup { request } => {
            json(admission::lookup(store, &request, now).await?)
        }
    }
}

#[durable_object]
pub struct RouterAbMlDsaPoolDurableObject {
    state: State,
    env: Env,
}
impl DurableObject for RouterAbMlDsaPoolDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self { state, env }
    }
    async fn fetch(&self, mut request: worker::Request) -> worker::Result<Response> {
        if request.method() != Method::Post || request.path() != ROLE_PATH {
            return Response::error("Unknown ML-DSA pool route", 404);
        }
        if let Err(error) =
            crate::require_cloudflare_internal_service_auth_request_v1(&request, &self.env)
        {
            return crate::cloudflare_private_service_auth_error_response_v1(error);
        }
        let role = configured_role(&self.env)?;
        let command: RoleCommand = decode_bounded_json_request(&mut request, 24 * 1024 * 1024)
            .await
            .map_err(protocol_error)?;
        authorize_role_command(&self.env, &command)
            .await
            .map_err(protocol_error)?;
        let output = Rc::new(RefCell::new(None));
        let captured = Rc::clone(&output);
        self.state
            .storage()
            .transaction(move |transaction| async move {
                let store = TransactionStore(transaction);
                let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
                let value = execute_role(&store, role, command, now)
                    .await
                    .map_err(protocol_error)?;
                captured.replace(Some(value));
                Ok(())
            })
            .await?;
        let value = output.borrow_mut().take().ok_or_else(|| {
            worker::Error::RustError("ML-DSA pool transaction returned no result".into())
        })?;
        Response::from_json(&value)
    }
}
fn configured_role(env: &Env) -> worker::Result<Participant> {
    match env
        .var("DERIVER_ROLE_PRIVATE_D1_ROLE")?
        .to_string()
        .as_str()
    {
        "deriver_a" => Ok(Participant::A),
        "deriver_b" => Ok(Participant::B),
        _ => Err(worker::Error::RustError(
            "ML-DSA pool requires a participant role".into(),
        )),
    }
}
async fn authorize_role_command(env: &Env, command: &RoleCommand) -> Result<()> {
    let (request, expected) = match command {
        RoleCommand::Reserve { claim, .. } => (
            &claim.request,
            Status::Preparing {
                claim: claim.clone(),
            },
        ),
        RoleCommand::Take { permit, .. } => (
            &permit.request,
            Status::Running {
                permit: permit.clone(),
            },
        ),
        RoleCommand::Fence { request, .. } => {
            let actual: Option<Status> = service_call(
                env,
                CallAuthority::Internal,
                &AdmissionCommand::Lookup {
                    request: request.clone(),
                },
            )
            .await?;
            return match actual {
                Some(Status::Succeeded { .. } | Status::Failed | Status::Declined) => Ok(()),
                _ => Err(invalid("ML-DSA operation is still active")),
            };
        }
        RoleCommand::Release {
            request,
            settlement,
            ..
        } => {
            let actual: Option<Status> = service_call(
                env,
                CallAuthority::Internal,
                &AdmissionCommand::Lookup {
                    request: request.clone(),
                },
            )
            .await?;
            let expected = match actual {
                Some(Status::Succeeded { .. }) => pool::Settlement::Succeeded,
                Some(Status::Failed) => pool::Settlement::Failed,
                Some(Status::Declined) => pool::Settlement::Declined,
                _ => return Err(invalid("ML-DSA operation is still active")),
            };
            return if *settlement == expected {
                Ok(())
            } else {
                Err(invalid("ML-DSA settlement changed"))
            };
        }
        RoleCommand::Install { key } => {
            let actual: Option<admission::KeyActivation> = service_call(
                env,
                CallAuthority::Internal,
                &AdmissionCommand::ActiveKey { key: key.clone() },
            )
            .await?;
            if actual.map(|value| value.key).as_ref() != Some(key) {
                return Err(invalid(
                    "ML-DSA installation lacks Gateway custody authorization",
                ));
            }
            return Ok(());
        }
        RoleCommand::Put { .. }
        | RoleCommand::Inventory { .. }
        | RoleCommand::RefillStatus { .. }
        | RoleCommand::Inspect { .. }
        | RoleCommand::RetireUnpaired { .. } => return Ok(()),
    };
    let actual: Option<Status> = service_call(
        env,
        CallAuthority::Internal,
        &AdmissionCommand::Lookup {
            request: request.clone(),
        },
    )
    .await?;
    if actual.as_ref() != Some(&expected) {
        return Err(invalid("ML-DSA Router admission is absent or stale"));
    }
    Ok(())
}
async fn execute_role(
    store: &impl Store,
    role: Participant,
    command: RoleCommand,
    now: u64,
) -> Result<serde_json::Value> {
    match command {
        RoleCommand::Inspect { key, batches } => json(pool::inspect(store, &key, &batches).await?),
        RoleCommand::RetireUnpaired { key, batches } => {
            pool::retire_unpaired(store, &key, &batches).await?;
            json(true)
        }
        RoleCommand::Fence { request, batches } => {
            json(pool::fence(store, &request, &batches).await?)
        }
        RoleCommand::RefillStatus { key } => json(pool::refill_status(store, &key, now).await?),
        RoleCommand::Install { key } => {
            pool::install_key(store, key).await?;
            json(true)
        }
        RoleCommand::Put { binding, sealed } => {
            if binding.role != role {
                return Err(invalid("ML-DSA material belongs to another role"));
            }
            pool::put(store, binding, sealed, now).await?;
            json(true)
        }
        RoleCommand::Inventory {
            key,
            target,
            ready_until_ms,
        } => {
            if target == 0 || target > 20 {
                return Err(invalid("Invalid ML-DSA refill target"));
            }
            json(pool::inventory(store, &key, target, now, ready_until_ms).await?)
        }
        RoleCommand::Reserve { claim, batches } => {
            pool::reserve(store, &claim.request, &batches, claim.expires_at_ms, now).await?;
            json(true)
        }
        RoleCommand::Take { permit, batch } => {
            json(pool::take(store, role, &permit, batch, now).await?)
        }
        RoleCommand::Release {
            request,
            batches,
            settlement,
            consumed_union,
        } => {
            pool::release(store, &request, &batches, settlement, &consumed_union).await?;
            json(true)
        }
    }
}

/// Existing Deriver entrypoints authenticate before dispatch, and this route checks again.
pub(crate) async fn handle_role(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if request.method() != Method::Post {
        return Response::error("ML-DSA requires POST", 405);
    }
    if let Err(error) = crate::require_cloudflare_internal_service_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    let command: RoleCommand = decode_bounded_json_request(&mut request, 24 * 1024 * 1024)
        .await
        .map_err(protocol_error)?;
    let name = format!(
        "ml-dsa-pool-{}",
        hex(&digest(b"wallet", &command.key().wallet).map_err(protocol_error)?)
    );
    let namespace = env.durable_object(POOL_BINDING)?;
    let stub = namespace.id_from_name(&name)?.get_stub()?;
    let forwarded = object_request(env, CallAuthority::Internal, ROLE_PATH, &command)
        .map_err(protocol_error)?;
    stub.fetch_with_request(forwarded).await
}
#[derive(Clone, Copy)]
enum CallAuthority<'a> {
    Gateway(&'a worker::Headers),
    Internal,
}
fn object_request(
    env: &Env,
    authority: CallAuthority<'_>,
    path: &str,
    body: &impl Serialize,
) -> Result<worker::Request> {
    let headers = worker::Headers::new();
    if let CallAuthority::Gateway(gateway) = authority {
        let credential = zeroize::Zeroizing::new(
            gateway
                .get(crate::ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1)
                .map_err(storage_error)?
                .ok_or_else(|| invalid("Missing Gateway credential"))?,
        );
        headers
            .set(
                crate::ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                &credential,
            )
            .map_err(storage_error)?;
    } else {
        crate::set_cloudflare_internal_service_auth_header_v1(
            env,
            &headers,
            "ML-DSA durable command",
        )?;
    }
    headers
        .set("content-type", "application/json")
        .map_err(storage_error)?;
    let encoded =
        serde_json::to_string(body).map_err(|_| invalid("Cannot encode ML-DSA command"))?;
    let mut init = worker::RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&encoded)));
    worker::Request::new_with_init(&format!("https://ml-dsa.internal{path}"), &init)
        .map_err(storage_error)
}
async fn service_call<T: serde::de::DeserializeOwned>(
    env: &Env,
    authority: CallAuthority<'_>,
    command: &AdmissionCommand,
) -> Result<T> {
    let namespace = env.durable_object(SERVICE_BINDING).map_err(storage_error)?;
    let stub = namespace
        .id_from_name(SERVICE_NAME)
        .map_err(storage_error)?
        .get_stub()
        .map_err(storage_error)?;
    let path = if matches!(authority, CallAuthority::Gateway(_)) {
        CONTROL_PATH
    } else {
        CHECK_PATH
    };
    let request = object_request(env, authority, path, command)?;
    let mut response = stub
        .fetch_with_request(request)
        .await
        .map_err(storage_error)?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA admission service refused the request"));
    }
    response.json().await.map_err(storage_error)
}
