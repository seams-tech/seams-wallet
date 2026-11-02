//! Private Worker routes and transactional Durable Object adapters.
mod storage;
use storage::{transaction, TransactionStore};
mod admission_actor;
pub use admission_actor::RouterAbMlDsaAdmissionDurableObject;
mod pool_actor;
pub use pool_actor::RouterAbMlDsaPoolDurableObject;
use pool_actor::{recover_expired_reservations, role_transaction};
mod role_authorization;
use role_authorization::authorize_role_command;
mod rpc;
pub(crate) use rpc::handle_role;
use rpc::{local_call, object_request, role_call, service_call, CallAuthority};
mod commands;
use commands::{admission_requests, role_requests};
use commands::{AdmissionCommand, Codec, Json, Request, RoleCommand};
mod coordinator;
mod durable_trace;
mod executor;
mod material_delivery;
mod routing;
use material_delivery::RoleOutput;
mod preparation;
pub(crate) mod recipient_keys;
pub(crate) mod registration;
mod router_trace;
mod schedules;
mod signing_trace;
mod stage_trace;
mod transport;
mod wait_trace;
use super::{
    admission::{self, Claim, Completion, Decision, Permit, Status},
    policy::Policy,
    pool,
    sealing::{Binding, Sealed},
    *,
};
use crate::durable_object::tenant_root_creation::decode_bounded_json_request;
pub(crate) use coordinator::{
    handle_activate, handle_admit, handle_complete, handle_sign, handle_status,
};
use executor::{handle_execute, is_execution_path, EXECUTE_PATH};
pub use preparation::RouterAbMlDsaProducerDurableObject;
use preparation::{handle_prepare, PREPARE_PATH};
use std::future::Future;
use std::{cell::RefCell, rc::Rc};
use worker::{durable_object, DurableObject, Env, Method, Response, State, Transaction};

pub const SIGN_PATH: &str = "/router-ab/ml-dsa/sign";
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
#[serde(deny_unknown_fields)]
pub struct RegistrationStockBatch {
    ordinal: usize,
    binding: Binding,
    sealed: Sealed,
}
#[derive(Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "batches",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum RegistrationStockDelivery {
    Single([RegistrationStockBatch; 1]),
    Pair([RegistrationStockBatch; 2]),
}
impl RegistrationStockDelivery {
    fn batches(&self) -> &[RegistrationStockBatch] {
        match self {
            Self::Single(batches) => batches,
            Self::Pair(batches) => batches,
        }
    }
    fn into_batches(self) -> Vec<RegistrationStockBatch> {
        match self {
            Self::Single(batches) => Vec::from(batches),
            Self::Pair(batches) => Vec::from(batches),
        }
    }
}

impl RoleCommand {
    fn wallet(&self) -> &super::WalletScope {
        match self {
            Self::InitializeRegistrationStorage { claim }
            | Self::InstallRegistrationStock { claim, .. } => &claim.request.wallet,
            Self::Put { job, .. }
            | Self::StartRefill { job }
            | Self::PublicationRecorded { job } => &job.key.wallet,
            Self::CheckMaterial { activation } => &activation.key.wallet,
            Self::InstallMaterial { record } => &record.activation.key.wallet,
            Self::LoadSigningInputs { permit } | Self::Take { permit, .. } => {
                &permit.request.key.wallet
            }
            Self::Install { key }
            | Self::Inventory { key, .. }
            | Self::LiveInventory { key, .. }
            | Self::RefillStatus { key }
            | Self::WakeRefill { key }
            | Self::Inspect { key, .. }
            | Self::RetireSpent { key, .. }
            | Self::RetireUnpaired { key, .. } => &key.wallet,
            Self::Reserve { claim, .. } => &claim.request.key.wallet,
            Self::Release { request, .. } | Self::Fence { request, .. } => &request.key.wallet,
        }
    }
}

pub fn policy(env: &Env) -> Result<Policy> {
    match env.var("ML_DSA_ADMISSION_POLICY") {
        Ok(value) => Policy::parse(&value.to_string()),
        Err(_) => Ok(Policy::default()),
    }
}
fn signing_schedule_digest(env: &Env) -> Result<[u8; 32]> {
    Ok(execution::signing_layout_digest(
        schedules::DIGEST,
        policy(env)?.candidate_group_size(),
    ))
}
fn check_signing_scope(env: &Env, key: &KeyScope) -> Result<()> {
    if key.schedule_digest != signing_schedule_digest(env)? {
        return Err(invalid("ML-DSA signing group or circuit schedule changed"));
    }
    Ok(())
}
fn protocol_error(error: impl Into<RouterAbProtocolError>) -> worker::Error {
    worker::Error::RustError(error.into().to_string())
}
fn storage_error(error: worker::Error) -> RouterAbProtocolError {
    // Callers receive one fixed message. The host's own text stays in the Worker log.
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "ml_dsa_host_error_v1",
            "kind": <&'static str>::from(&error),
            "error": error.to_string(),
        })
    );
    invalid("ML-DSA storage operation failed")
}
fn json<T: Serialize>(value: T) -> Result<serde_json::Value> {
    serde_json::to_value(value).map_err(|_| invalid("ML-DSA response encoding failed"))
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
pub(crate) fn is_role_path(path: &str) -> bool {
    path == ROLE_PATH
        || path == PREPARE_PATH
        || is_execution_path(path)
        || path == registration::ROLE_PATH
        || path == recipient_keys::ROLE_PATH
}
pub(crate) async fn handle_role_request(
    request: worker::Request,
    env: Env,
    context: worker::Context,
) -> worker::Result<Response> {
    match request.path().as_str() {
        recipient_keys::ROLE_PATH => recipient_keys::handle_role(request, &env).await,
        registration::ROLE_PATH => registration::handle_role(request, &env).await,
        ROLE_PATH => handle_role(request, &env).await,
        PREPARE_PATH => handle_prepare(request, env, context).await,
        _ => handle_execute(request, env, context).await,
    }
}

const SOCKET_INPUT_HEADER: &str = "x-ml-dsa-input";
const MAX_SOCKET_INPUT: usize = 80_000;
fn socket_request(env: &Env, path: &str, input: &impl Serialize) -> Result<worker::Request> {
    use base64::Engine;
    let bytes = serde_json::to_vec(input).map_err(|_| invalid("Invalid ML-DSA socket input"))?;
    if bytes.len() > MAX_SOCKET_INPUT {
        return Err(invalid("ML-DSA socket input is too large"));
    }
    let mut request =
        worker::Request::new(&format!("https://ml-dsa-role.internal{path}"), Method::Get)
            .map_err(storage_error)?;
    let headers = request.headers_mut().map_err(storage_error)?;
    headers.set("upgrade", "websocket").map_err(storage_error)?;
    headers
        .set(
            SOCKET_INPUT_HEADER,
            &base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes),
        )
        .map_err(storage_error)?;
    crate::set_cloudflare_internal_service_auth_header_v1(env, headers, "ML-DSA peer socket")?;
    Ok(request)
}
fn socket_input<T: serde::de::DeserializeOwned>(request: &worker::Request) -> Result<T> {
    use base64::Engine;
    if request.method() != Method::Get
        || request
            .headers()
            .get("upgrade")
            .map_err(storage_error)?
            .as_deref()
            != Some("websocket")
    {
        return Err(invalid("ML-DSA peer requires a GET WebSocket upgrade"));
    }
    let encoded = request
        .headers()
        .get(SOCKET_INPUT_HEADER)
        .map_err(storage_error)?
        .ok_or_else(|| invalid("Missing ML-DSA socket input"))?;
    if encoded.len() > MAX_SOCKET_INPUT.div_ceil(3) * 4 {
        return Err(invalid("ML-DSA socket input is too large"));
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| invalid("Invalid ML-DSA socket input"))?;
    if bytes.len() > MAX_SOCKET_INPUT {
        return Err(invalid("ML-DSA socket input is too large"));
    }
    serde_json::from_slice(&bytes).map_err(|_| invalid("Invalid ML-DSA socket input"))
}

enum DeadlineFailure {
    Expired,
    ClockUnavailable,
}
impl From<DeadlineFailure> for RouterAbProtocolError {
    fn from(value: DeadlineFailure) -> Self {
        match value {
            DeadlineFailure::Expired => invalid("ML-DSA operation deadline expired"),
            DeadlineFailure::ClockUnavailable => invalid("ML-DSA clock is unavailable"),
        }
    }
}
impl From<DeadlineFailure> for super::failure::SigningFailure {
    fn from(value: DeadlineFailure) -> Self {
        match value {
            DeadlineFailure::Expired => Self::DeadlineExceeded,
            DeadlineFailure::ClockUnavailable => Self::ClockUnavailable,
        }
    }
}
async fn before_deadline<T, E: From<DeadlineFailure>>(
    deadline: u64,
    future: impl core::future::Future<Output = core::result::Result<T, E>>,
) -> core::result::Result<T, E> {
    use futures::future::{select, Either};
    let now = crate::cloudflare_now_unix_ms_v1().map_err(|_| DeadlineFailure::ClockUnavailable)?;
    if now >= deadline {
        return Err(DeadlineFailure::Expired.into());
    }
    let timeout = worker::Delay::from(std::time::Duration::from_millis(deadline - now));
    let result = match select(Box::pin(future), Box::pin(timeout)).await {
        Either::Left((result, _)) => result,
        Either::Right(_) => return Err(DeadlineFailure::Expired.into()),
    };
    if crate::cloudflare_now_unix_ms_v1().map_err(|_| DeadlineFailure::ClockUnavailable)?
        >= deadline
    {
        return Err(DeadlineFailure::Expired.into());
    }
    result
}

// Storage input gates keep this read/update together. Never postpone demand
// that arrived while a producer awaited its peer's inventory or publication.
async fn schedule_refill_alarm(state: &State, delay_ms: u64) -> worker::Result<()> {
    let scheduled = state.storage().get_alarm().await?;
    let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
    let next = now.saturating_add(delay_ms);
    let now =
        i64::try_from(now).map_err(|_| protocol_error(invalid("ML-DSA alarm time overflow")))?;
    let next =
        i64::try_from(next).map_err(|_| protocol_error(invalid("ML-DSA alarm time overflow")))?;
    // A delayed handler must not replace an urgent overdue wake with its
    // longer maintenance delay. Keep overdue work prompt and future work early.
    let next = match scheduled {
        Some(current) if current <= now => now.saturating_add(1),
        Some(current) => current.min(next),
        None => next,
    };
    if scheduled != Some(next) {
        let date = worker::Date::new(worker::DateInit::Millis(next as u64));
        state
            .storage()
            .set_alarm(worker::ScheduledTime::new(date.into()))
            .await?;
    }
    Ok(())
}
