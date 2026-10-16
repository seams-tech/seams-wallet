//! Private Worker routes and transactional Durable Object adapters.
mod coordinator;
mod executor;
mod preparation;
pub(crate) mod registration;
mod schedules;
mod signing_trace;
mod transport;
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
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum AdmissionCommand {
    PrepareRegistration {
        scope: [u8; 32],
        schedule: [u8; 32],
        signing_schedule: [u8; 32],
        signing_batches: usize,
    },
    ReadyRegistration {
        job: super::registration::Job,
        role: Participant,
    },
    CheckRegistrationJob {
        job: super::registration::Job,
    },
    ClaimRegistration {
        request: super::registration::Request,
        schedule: [u8; 32],
    },
    CheckRegistrationClaim {
        claim: super::registration::Claim,
    },
    FinishRegistration {
        claim: super::registration::Claim,
        result: super::registration::Completed,
    },
    ClaimRefill {
        key: KeyScope,
    },
    CheckRefill {
        job: refill::Job,
    },
    FinishRefill {
        job: refill::Job,
    },
    AuthorizeKey {
        activation: admission::KeyActivation,
    },
    KeyState {
        key: KeyScope,
    },
    CommitKey {
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
    Settled {
        request: super::SigningRequest,
    },
    Lookup {
        request: super::SigningRequest,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum RoleCommand {
    InitializeRegistrationStorage {
        claim: super::registration::Claim,
    },
    InstallRegistrationBatch {
        claim: super::registration::Claim,
        ordinal: usize,
        binding: Binding,
        sealed: Sealed,
    },
    StartRefill {
        job: refill::Job,
    },
    CheckMaterial {
        activation: admission::KeyActivation,
    },
    InstallMaterial {
        record: material::Record,
    },
    LoadMaterial {
        permit: Permit,
    },
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
        job: refill::Job,
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
    fn wallet(&self) -> &super::WalletScope {
        match self {
            Self::InitializeRegistrationStorage { claim } => &claim.request.wallet,
            Self::InstallRegistrationBatch { binding, .. } | Self::Put { binding, .. } => {
                &binding.key.wallet
            }
            Self::StartRefill { job } => &job.key.wallet,
            Self::CheckMaterial { activation } => &activation.key.wallet,
            Self::InstallMaterial { record } => &record.activation.key.wallet,
            Self::LoadMaterial { permit } | Self::Take { permit, .. } => &permit.request.key.wallet,
            Self::Install { key }
            | Self::Inventory { key, .. }
            | Self::RefillStatus { key }
            | Self::Inspect { key, .. }
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
struct CiphertextChunk<'a>(&'a [u8]);
impl Serialize for CiphertextChunk<'_> {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> core::result::Result<S::Ok, S::Error> {
        serializer.serialize_bytes(self.0)
    }
}
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
    async fn put_chunk(&self, key: &str, bytes: &[u8]) -> Result<()> {
        self.0
            .put(key, &CiphertextChunk(bytes))
            .await
            .map_err(storage_error)
    }
    async fn get_chunks(
        &self,
        keys: &[String],
        maximum_bytes: usize,
    ) -> Result<Vec<Option<Vec<u8>>>> {
        use worker::wasm_bindgen::JsCast;
        let entries = self
            .0
            .get_multiple(keys.to_vec())
            .await
            .map_err(storage_error)?;
        let mut values = Vec::with_capacity(keys.len());
        for key in keys {
            let value = entries.get(&worker::wasm_bindgen::JsValue::from_str(key));
            values.push(if value.is_undefined() {
                None
            } else {
                let bytes = value
                    .dyn_into::<worker::js_sys::Uint8Array>()
                    .map_err(|_| invalid("Invalid ML-DSA stored ciphertext"))?;
                if bytes.length() as usize > maximum_bytes {
                    return Err(invalid("Oversized ML-DSA ciphertext chunk"));
                }
                Some(bytes.to_vec())
            });
        }
        Ok(values)
    }
    async fn delete_many(&self, keys: &[String]) -> Result<()> {
        self.0
            .delete_multiple(keys.to_vec())
            .await
            .map(|_| ())
            .map_err(storage_error)
    }
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
                AdmissionCommand::Lookup { .. }
                    | AdmissionCommand::ReadyRegistration { .. }
                    | AdmissionCommand::CheckRegistrationJob { .. }
                    | AdmissionCommand::CheckRegistrationClaim { .. }
                    | AdmissionCommand::ActiveKey { .. }
                    | AdmissionCommand::KeyState { .. }
                    | AdmissionCommand::ClaimRefill { .. }
                    | AdmissionCommand::CheckRefill { .. }
                    | AdmissionCommand::FinishRefill { .. }
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
        AdmissionCommand::PrepareRegistration {
            scope,
            schedule,
            signing_schedule,
            signing_batches,
        } => json(
            super::registration::prepare(
                store,
                scope,
                schedule,
                signing_schedule,
                signing_batches,
                now,
            )
            .await?,
        ),
        AdmissionCommand::ReadyRegistration { job, role } => {
            super::registration::ready(store, &job, role, now).await?;
            json(true)
        }
        AdmissionCommand::CheckRegistrationJob { job } => {
            json(super::registration::check_job(store, &job, now).await?)
        }
        AdmissionCommand::ClaimRegistration { request, schedule } => {
            json(super::registration::claim(store, request, schedule, now).await?)
        }
        AdmissionCommand::CheckRegistrationClaim { claim } => {
            json(super::registration::check_claim(store, &claim, now).await?)
        }
        AdmissionCommand::FinishRegistration { claim, result } => {
            json(super::registration::finish(store, &claim, result, now).await?)
        }
        AdmissionCommand::ClaimRefill { key } => json(refill::claim(store, key, now).await?),
        AdmissionCommand::CheckRefill { job } => json(refill::check(store, &job, now).await?),
        AdmissionCommand::FinishRefill { job } => {
            refill::finish(store, &job).await?;
            json(true)
        }
        AdmissionCommand::AuthorizeKey { activation } => {
            admission::authorize_key(store, activation).await?;
            json(true)
        }
        AdmissionCommand::ActiveKey { key } => json(admission::active_key(store, &key).await?),
        AdmissionCommand::KeyState { key } => json(admission::key_state(store, &key).await?),
        AdmissionCommand::CommitKey { activation } => {
            json(admission::commit_key(store, activation).await?)
        }
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
        AdmissionCommand::Settled { request } => {
            admission::settled(store, &request).await?;
            json(true)
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
        if role == Participant::A && preparation::refill_key(&command).is_some() {
            schedule_refill_alarm(&self.state, 1_000).await?;
        }
        let value = role_transaction(&self.state, role, command).await?;
        Response::from_json(&value)
    }
    async fn alarm(&self) -> worker::Result<Response> {
        preparation::alarm(&self.env, &self.state).await
    }
}
async fn role_transaction(
    state: &State,
    role: Participant,
    command: RoleCommand,
) -> worker::Result<serde_json::Value> {
    let output = Rc::new(RefCell::new(None));
    let captured = Rc::clone(&output);
    state
        .storage()
        .transaction(move |transaction| async move {
            let store = TransactionStore(transaction);
            let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
            if role == Participant::A {
                if let Some(key) = preparation::refill_key(&command) {
                    preparation::enqueue(&store, key)
                        .await
                        .map_err(protocol_error)?;
                }
            }
            let value = execute_role(&store, role, command, now)
                .await
                .map_err(protocol_error)?;
            captured.replace(Some(value));
            Ok(())
        })
        .await?;
    let value = output
        .borrow_mut()
        .take()
        .ok_or_else(|| protocol_error(invalid("ML-DSA pool transaction returned no result")))?;
    Ok(value)
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
        RoleCommand::InitializeRegistrationStorage { claim } => {
            let allowed: bool = service_call(
                env,
                CallAuthority::Internal,
                &AdmissionCommand::CheckRegistrationClaim {
                    claim: claim.clone(),
                },
            )
            .await?;
            return if allowed {
                Ok(())
            } else {
                Err(invalid(
                    "Storage initialization requires a live registration",
                ))
            };
        }
        RoleCommand::InstallRegistrationBatch {
            claim,
            ordinal,
            binding,
            ..
        } => {
            let allowed: bool = service_call(
                env,
                CallAuthority::Internal,
                &AdmissionCommand::CheckRegistrationClaim {
                    claim: claim.clone(),
                },
            )
            .await?;
            let expected_batch = super::registration::signing_batch_id(&claim.job, *ordinal)?;
            if !allowed
                || *ordinal >= claim.job.signing_batches
                || binding.batch != expected_batch
                || binding.key.wallet != claim.request.wallet
                || binding.key.key_id != claim.request.key_id
                || binding.key.epoch != claim.request.epoch
                || binding.key.schedule_digest != claim.job.signing_schedule
                || binding.expires_at_ms != claim.job.expires_at
            {
                return Err(invalid("Registration signing stock lacks exact admission"));
            }
            return Ok(());
        }
        RoleCommand::StartRefill { job } | RoleCommand::Put { job, .. } => {
            return preparation::check_job(env, job).await;
        }
        RoleCommand::Reserve { claim, .. } => (
            &claim.request,
            Status::Preparing {
                claim: claim.clone(),
            },
        ),
        RoleCommand::Take { permit, .. } | RoleCommand::LoadMaterial { permit } => (
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
        RoleCommand::InstallMaterial { record } => {
            let actual: Option<admission::KeyState> = service_call(
                env,
                CallAuthority::Internal,
                &AdmissionCommand::KeyState {
                    key: record.activation.key.clone(),
                },
            )
            .await?;
            if actual.as_ref().map(admission::KeyState::activation) != Some(&record.activation) {
                return Err(invalid("ML-DSA role material lacks custody authorization"));
            }
            let secrets = executor::wrapping_key(env)?;
            drop(record.open(
                configured_role(env).map_err(storage_error)?,
                &secrets.0,
                &secrets.1,
            )?);
            return Ok(());
        }
        RoleCommand::Install { key } => {
            let actual: Option<admission::KeyState> = service_call(
                env,
                CallAuthority::Internal,
                &AdmissionCommand::KeyState { key: key.clone() },
            )
            .await?;
            if actual.as_ref().map(|value| &value.activation().key) != Some(key) {
                return Err(invalid(
                    "ML-DSA installation lacks Gateway custody authorization",
                ));
            }
            return Ok(());
        }
        RoleCommand::CheckMaterial { .. }
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
        RoleCommand::InitializeRegistrationStorage { claim } => {
            // A bounded read warms this actor without changing custody or pool state.
            let _ = pool::installed_key(store, &claim.request.key_id).await?;
            json(true)
        }
        RoleCommand::InstallRegistrationBatch {
            binding, sealed, ..
        } => {
            if binding.role != role {
                return Err(invalid("Registration stock belongs to another role"));
            }
            pool::install_registration_batch(store, binding, sealed, now).await?;
            json(true)
        }
        RoleCommand::StartRefill { job } => {
            refill::start_role(store, &job, now).await?;
            json(true)
        }
        RoleCommand::InstallMaterial { record } => {
            material::put(store, record).await?;
            json(true)
        }
        RoleCommand::CheckMaterial { activation } => {
            json(material::installed(store, role, &activation).await?)
        }
        RoleCommand::LoadMaterial { permit } => {
            json(material::get(store, &permit.request.key).await?)
        }
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
        RoleCommand::Put {
            job,
            binding,
            sealed,
        } => {
            if binding.role != role {
                return Err(invalid("ML-DSA material belongs to another role"));
            }
            refill::publish_role(store, &job, binding, sealed, now).await?;
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
    local_call(env, &command).await.map_err(protocol_error)
}
async fn local_call(env: &Env, command: &RoleCommand) -> Result<Response> {
    let name = format!("ml-dsa-pool-{}", hex(&digest(b"wallet", command.wallet())?));
    let namespace = env.durable_object(POOL_BINDING).map_err(storage_error)?;
    let stub = namespace
        .id_from_name(&name)
        .map_err(storage_error)?
        .get_stub()
        .map_err(storage_error)?;
    let forwarded = object_request(env, CallAuthority::Internal, ROLE_PATH, command)?;
    stub.fetch_with_request(forwarded)
        .await
        .map_err(storage_error)
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

pub(crate) fn is_role_path(path: &str) -> bool {
    path == ROLE_PATH
        || path == preparation::START_PATH
        || path == PREPARE_PATH
        || is_execution_path(path)
        || path == registration::ROLE_PATH
}
pub(crate) async fn handle_role_request(
    request: worker::Request,
    env: Env,
    context: worker::Context,
) -> worker::Result<Response> {
    match request.path().as_str() {
        registration::ROLE_PATH => registration::handle_role(request, &env).await,
        ROLE_PATH => handle_role(request, &env).await,
        PREPARE_PATH => handle_prepare(request, env, context).await,
        preparation::START_PATH => preparation::handle_start(request, env).await,
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

async fn before_deadline<T>(
    deadline: u64,
    future: impl core::future::Future<Output = Result<T>>,
) -> Result<T> {
    use futures::future::{select, Either};
    let now = crate::cloudflare_now_unix_ms_v1()?;
    if now >= deadline {
        return Err(invalid("ML-DSA operation deadline expired"));
    }
    let timeout = worker::Delay::from(std::time::Duration::from_millis(deadline - now));
    let result = match select(Box::pin(future), Box::pin(timeout)).await {
        Either::Left((result, _)) => result,
        Either::Right(_) => return Err(invalid("ML-DSA operation deadline expired")),
    };
    if crate::cloudflare_now_unix_ms_v1()? >= deadline {
        return Err(invalid("ML-DSA operation deadline expired"));
    }
    result
}

// Storage input gates keep this read/update together. Never postpone demand
// that arrived while a producer awaited its peer's inventory or publication.
async fn schedule_refill_alarm(state: &State, delay_ms: u64) -> worker::Result<()> {
    let next = crate::cloudflare_now_unix_ms_v1()
        .map_err(protocol_error)?
        .saturating_add(delay_ms);
    let next =
        i64::try_from(next).map_err(|_| protocol_error(invalid("ML-DSA alarm time overflow")))?;
    let scheduled = state.storage().get_alarm().await?;
    if scheduled.is_none_or(|current| current > next) {
        let date = worker::Date::new(worker::DateInit::Millis(next as u64));
        state
            .storage()
            .set_alarm(worker::ScheduledTime::new(date.into()))
            .await?;
    }
    Ok(())
}
