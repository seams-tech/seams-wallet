//! Private Worker routes and transactional Durable Object adapters.
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
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum AdmissionCommand {
    PrepareRegistration {
        wallet: WalletScope,
        schedule: [u8; 32],
        signing_schedule: [u8; 32],
        signing_batches: usize,
    },
    RetireRegistration {
        job: super::registration::Job,
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
        occupied: refill::OccupiedBatches,
    },
    PendingRefills {
        key: KeyScope,
    },
    WithdrawRefill {
        key: KeyScope,
    },
    CheckRefill {
        job: refill::Job,
    },
    FinishRefill {
        job: refill::Job,
        outcome: refill::Outcome,
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
    Preflight {
        request: super::SigningRequest,
    },
    DeferEmpty {
        request: super::SigningRequest,
        retry_at_ms: u64,
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
    AwaitStock {
        claim: Claim,
        retry_at_ms: u64,
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
#[derive(Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum RoleCommand {
    InitializeRegistrationStorage {
        claim: super::registration::Claim,
    },
    InstallRegistrationStock {
        claim: super::registration::Claim,
        delivery: RegistrationStockDelivery,
    },
    StartRefill {
        job: refill::Job,
    },
    WakeRefill {
        key: KeyScope,
    },
    CheckMaterial {
        activation: admission::KeyActivation,
    },
    InstallMaterial {
        record: material::Record,
    },
    LoadSigningInputs {
        permit: Permit,
    },
    PublicationRecorded {
        job: refill::Job,
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
        batches: Vec<(Binding, Sealed)>,
    },
    LiveInventory {
        key: KeyScope,
        target: usize,
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
        unopened_intersection: Vec<[u8; 32]>,
    },
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
struct TransactionStore {
    transaction: Transaction,
    trace: Option<durable_trace::DurableTrace>,
}
impl TransactionStore {
    fn untraced(transaction: Transaction) -> Self {
        Self {
            transaction,
            trace: None,
        }
    }
}
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
        durable_trace::observe(self.trace.as_ref(), "get", async {
            match self.transaction.get(key).await {
                Ok(value) => Ok(Some(value)),
                Err(worker::Error::JsError(message)) if message == "No such value in storage." => {
                    Ok(None)
                }
                Err(error) => Err(storage_error(error)),
            }
        })
        .await
    }

    async fn put<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        durable_trace::observe(self.trace.as_ref(), "put", self.transaction.put(key, value))
            .await
            .map_err(storage_error)
    }
    async fn delete(&self, key: &str) -> Result<()> {
        durable_trace::observe(self.trace.as_ref(), "delete", self.transaction.delete(key))
            .await
            .map(|_| ())
            .map_err(storage_error)
    }
    async fn put_chunk(&self, key: &str, bytes: &[u8]) -> Result<()> {
        durable_trace::observe(
            self.trace.as_ref(),
            "put_chunk",
            self.transaction.put(key, &CiphertextChunk(bytes)),
        )
        .await
        .map_err(storage_error)
    }
    async fn get_chunks(
        &self,
        keys: &[String],
        maximum_bytes: usize,
    ) -> Result<Vec<Option<Vec<u8>>>> {
        use worker::wasm_bindgen::JsCast;
        let entries = durable_trace::observe(
            self.trace.as_ref(),
            "get_chunks",
            self.transaction.get_multiple(keys.to_vec()),
        )
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
        durable_trace::observe(
            self.trace.as_ref(),
            "delete_many",
            self.transaction.delete_multiple(keys.to_vec()),
        )
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
            let value = work(TransactionStore::untraced(tx))
                .await
                .map_err(protocol_error)?;
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
#[cfg_attr(feature = "strict-worker-router-entrypoint", durable_object)]
pub struct RouterAbMlDsaAdmissionDurableObject {
    state: State,
    env: Env,
}
#[cfg(feature = "strict-worker-router-entrypoint")]
impl DurableObject for RouterAbMlDsaAdmissionDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self { state, env }
    }
    async fn fetch(&self, mut request: worker::Request) -> worker::Result<Response> {
        if request.method() != Method::Post {
            return Response::error("ML-DSA requires POST", 405);
        }
        if routing::is_path(&request.path()) {
            return routing::handle(request, &self.env, &self.state).await;
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
                    | AdmissionCommand::PendingRefills { .. }
                    | AdmissionCommand::WithdrawRefill { .. }
                    | AdmissionCommand::CheckRefill { .. }
                    | AdmissionCommand::FinishRefill { .. }
            )
        {
            return Response::error("ML-DSA read authority required", 403);
        }
        let group = routing::check_destination(&self.env, &self.state, &command)
            .await
            .map_err(protocol_error)?;
        let call = crate::parse_cloudflare_trace_id_from_request_v1(&request)
            .ok()
            .flatten();
        let trace = durable_trace::DurableTrace::admission(&self.env, &command, call)
            .map_err(protocol_error)?;
        durable_trace::mark(trace.as_ref(), "authorized");
        let callback_trace = trace.clone();
        let policy = policy(&self.env).map_err(protocol_error)?;
        let output = Rc::new(RefCell::new(None));
        let captured = Rc::clone(&output);
        durable_trace::observe(
            trace.as_ref(),
            "transaction",
            self.state
                .storage()
                .transaction(move |transaction| async move {
                    durable_trace::mark(callback_trace.as_ref(), "callback_started");
                    let store = TransactionStore {
                        transaction,
                        trace: callback_trace.clone(),
                    };
                    let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
                    let value = execute_admission(&store, &policy, group, command, now)
                        .await
                        .map_err(protocol_error)?;
                    captured.replace(Some(value));
                    durable_trace::mark(callback_trace.as_ref(), "callback_finished");
                    Ok(())
                }),
        )
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
    group: service_group::ServiceGroup,
    command: AdmissionCommand,
    now: u64,
) -> Result<serde_json::Value> {
    match command {
        AdmissionCommand::PrepareRegistration {
            wallet,
            schedule,
            signing_schedule,
            signing_batches,
        } => json(
            super::registration::prepare(
                store,
                super::registration::scope(&wallet)?,
                group,
                schedule,
                signing_schedule,
                signing_batches,
                now,
            )
            .await?,
        ),
        AdmissionCommand::RetireRegistration { job } => {
            json(super::registration::retire_preparation(store, &job).await?)
        }
        AdmissionCommand::ReadyRegistration { job, role } => {
            super::registration::ready(store, &job, role, now).await?;
            json(true)
        }
        AdmissionCommand::CheckRegistrationJob { job } => {
            json(super::registration::check_job(store, &job, now).await?)
        }
        AdmissionCommand::ClaimRegistration { request, schedule } => json(
            super::registration::claim(
                store,
                request,
                schedule,
                execution::signing_layout_digest(schedules::DIGEST, policy.candidate_group_size()),
                policy.minimum_ready_batches().max(2),
                now,
            )
            .await?,
        ),
        AdmissionCommand::CheckRegistrationClaim { claim } => {
            json(super::registration::check_claim(store, &claim, now).await?)
        }
        AdmissionCommand::FinishRegistration { claim, result } => {
            json(super::registration::finish(store, &claim, result, now).await?)
        }
        AdmissionCommand::ClaimRefill { key, occupied } => {
            json(refill::claim(store, policy, key, occupied, now).await?)
        }
        AdmissionCommand::PendingRefills { key } => json(refill::pending(store, &key, now).await?),
        AdmissionCommand::WithdrawRefill { key } => {
            refill::withdraw(store, &key).await?;
            json(true)
        }
        AdmissionCommand::CheckRefill { job } => json(refill::check(store, &job, now).await?),
        AdmissionCommand::FinishRefill { job, outcome } => {
            json(refill::finish(store, policy, &job, outcome, now).await?)
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
        AdmissionCommand::Preflight { request } => {
            json(admission::preflight(store, policy, &request, now).await?)
        }
        AdmissionCommand::DeferEmpty {
            request,
            retry_at_ms,
        } => json(admission::defer_empty(store, policy, request, retry_at_ms, now).await?),
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
        AdmissionCommand::AwaitStock { claim, retry_at_ms } => {
            admission::await_stock(store, &claim, retry_at_ms.max(now.saturating_add(1_000)))
                .await?;
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

#[cfg_attr(not(feature = "strict-worker-router-entrypoint"), durable_object)]
pub struct RouterAbMlDsaPoolDurableObject {
    state: State,
    env: Env,
}
#[cfg(not(feature = "strict-worker-router-entrypoint"))]
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
        let call = crate::parse_cloudflare_trace_id_from_request_v1(&request)
            .ok()
            .flatten();
        let durable =
            durable_trace::DurableTrace::role(&self.env, &command, call).map_err(protocol_error)?;
        durable_trace::mark(durable.as_ref(), "entered");
        let trace = match &command {
            RoleCommand::Take { permit, batch } => Some(stage_trace::StageTrace::new(
                permit.request.operation,
                role,
                stage_trace::Context::TakeStore { material: *batch },
            )),
            _ => None,
        };
        durable_trace::observe(
            durable.as_ref(),
            "authorize",
            authorize_role_command(&self.env, &command),
        )
        .await
        .map_err(protocol_error)?;
        if let Some(trace) = &trace {
            trace.mark("authorized");
        }
        if let RoleCommand::Inventory { key, .. } | RoleCommand::LiveInventory { key, .. } =
            &command
        {
            recover_expired_reservations(&self.env, &self.state, key)
                .await
                .map_err(protocol_error)?;
        }
        let wake_key = match &command {
            RoleCommand::WakeRefill { key } => Some(key.clone()),
            _ => None,
        };
        if role == Participant::A
            && wake_key.is_none()
            && preparation::refill_key(&command).is_some()
        {
            durable_trace::observe(
                durable.as_ref(),
                "schedule_alarm",
                schedule_refill_alarm(&self.state, 1_000),
            )
            .await?;
        }
        let value = durable_trace::observe(
            durable.as_ref(),
            "transaction",
            role_transaction(
                &self.state,
                policy(&self.env).map_err(protocol_error)?,
                role,
                command,
                durable.clone(),
            ),
        )
        .await?;
        if let Some(trace) = &trace {
            trace.mark("transaction_committed");
        }
        if let Some(key) = wake_key {
            // Acknowledge only after the alarm write. Producer recovery retries
            // a lost reply; scheduling never postpones an earlier alarm.
            let before = if durable.is_some() {
                self.state.storage().get_alarm().await?
            } else {
                None
            };
            let requested = crate::cloudflare_now_unix_ms_v1()
                .map_err(protocol_error)?
                .saturating_add(50);
            durable_trace::observe(
                durable.as_ref(),
                "wake_alarm",
                schedule_refill_alarm(&self.state, 50),
            )
            .await?;
            if durable.is_some() {
                let after = self.state.storage().get_alarm().await?;
                worker::console_log!(
                    "{}",
                    serde_json::json!({
                        "event": "ml_dsa_refill_alarm_v1", "actor": self.state.id().to_string(),
                        "key": hex(&key.public_key_digest), "epoch": key.epoch,
                        "call_id": call.map(crate::CloudflareTraceIdV1::as_hex),
                        "before_ms": before, "requested_ms": requested, "after_ms": after,
                        "at_ms": crate::cloudflare_now_unix_ms_v1().ok(),
                        "module_instance": signing_trace::module_identity(),
                    })
                );
            }
        }
        let response = value.into_response();
        if response.is_ok() {
            if let Some(trace) = &trace {
                trace.finish();
            }
        }
        response
    }
    async fn alarm(&self) -> worker::Result<Response> {
        preparation::alarm(&self.env, &self.state).await
    }
}
/// Network authority checks stay outside storage transactions and preserve unexposed material.
async fn recover_expired_reservations(env: &Env, state: &State, key: &KeyScope) -> Result<()> {
    let key = key.clone();
    let now = crate::cloudflare_now_unix_ms_v1()?;
    let expired = transaction(state, move |store| async move {
        pool::expired_reservations(&store, &key, now).await
    })
    .await?;
    for reservation in expired {
        let status: Option<Status> = service_call(
            env,
            CallAuthority::Internal,
            &AdmissionCommand::Lookup {
                request: reservation.request.clone(),
            },
        )
        .await?;
        let settlement = match status {
            Some(Status::Declined) => pool::Settlement::Declined,
            // Once admitted, peer consumption can be unknown. Preserve conservative retirement.
            Some(Status::Failed | Status::Succeeded { .. }) => pool::Settlement::Failed,
            _ => continue,
        };
        let operation = reservation.request.operation;
        let batches = reservation.batches.clone();
        transaction(state, move |store| async move {
            pool::settle_expired(&store, &reservation, settlement).await
        })
        .await?;
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_expired_reservation_v1", "operation": hex(&operation),
                "settlement": settlement, "batches": batches.iter().map(|id| hex(id)).collect::<Vec<_>>(),
            })
        );
    }
    Ok(())
}

async fn role_transaction(
    state: &State,
    policy: Policy,
    role: Participant,
    command: RoleCommand,
    trace: Option<durable_trace::DurableTrace>,
) -> worker::Result<RoleOutput> {
    let output = Rc::new(RefCell::new(None));
    let captured = Rc::clone(&output);
    state
        .storage()
        .transaction(move |transaction| async move {
            durable_trace::mark(trace.as_ref(), "callback_started");
            let store = TransactionStore {
                transaction,
                trace: trace.clone(),
            };
            let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
            if role == Participant::A {
                if let Some(key) = preparation::refill_key(&command) {
                    preparation::enqueue(&store, key)
                        .await
                        .map_err(protocol_error)?;
                }
            }
            let value = execute_role(&store, &policy, role, command, now)
                .await
                .map_err(protocol_error)?;
            captured.replace(Some(value));
            durable_trace::mark(trace.as_ref(), "callback_finished");
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
        RoleCommand::InstallRegistrationStock { claim, delivery } => {
            let allowed: bool = service_call(
                env,
                CallAuthority::Internal,
                &AdmissionCommand::CheckRegistrationClaim {
                    claim: claim.clone(),
                },
            )
            .await?;
            if !allowed {
                return Err(invalid("Registration signing stock lacks exact admission"));
            }
            if let RegistrationStockDelivery::Pair([first, second]) = delivery {
                if first.ordinal % 2 != 0 || first.ordinal.checked_add(1) != Some(second.ordinal) {
                    return Err(invalid("Registration stock delivery has invalid ordinals"));
                }
            }
            for batch in delivery.batches() {
                let binding = &batch.binding;
                check_signing_scope(env, &binding.key)?;
                let expected_batch =
                    super::registration::signing_batch_id(&claim.job, batch.ordinal)?;
                if batch.ordinal >= claim.job.signing_batches
                    || binding.batch != expected_batch
                    || binding.key.wallet != claim.request.wallet
                    || binding.key.key_id != claim.request.key_id
                    || binding.key.epoch != claim.request.epoch
                    || binding.key.schedule_digest != claim.job.signing_schedule
                    || binding.expires_at_ms != claim.job.expires_at
                {
                    return Err(invalid("Registration signing stock lacks exact admission"));
                }
            }
            return Ok(());
        }
        RoleCommand::StartRefill { job } | RoleCommand::Put { job, .. } => {
            return preparation::check_job(env, job).await;
        }
        RoleCommand::Reserve { claim, batches } => {
            if batches.len() > policy(env)?.refill_target_batches() {
                return Err(invalid(
                    "ML-DSA reservation exceeds configured candidate capacity",
                ));
            }
            (
                &claim.request,
                Status::Preparing {
                    claim: claim.clone(),
                },
            )
        }
        RoleCommand::Take { permit, .. } | RoleCommand::LoadSigningInputs { permit } => (
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
        RoleCommand::WakeRefill { key } => {
            check_signing_scope(env, key)?;
            let active: Option<admission::KeyActivation> = service_call(
                env,
                CallAuthority::Internal,
                &AdmissionCommand::ActiveKey { key: key.clone() },
            )
            .await?;
            return if active.as_ref().map(|activation| &activation.key) == Some(key) {
                Ok(())
            } else {
                Err(invalid("ML-DSA refill wake key is inactive"))
            };
        }
        RoleCommand::CheckMaterial { .. }
        | RoleCommand::Inventory { .. }
        | RoleCommand::LiveInventory { .. }
        | RoleCommand::RefillStatus { .. }
        | RoleCommand::PublicationRecorded { .. }
        | RoleCommand::Inspect { .. }
        | RoleCommand::RetireUnpaired { .. } => return Ok(()),
    };
    check_signing_scope(env, &request.key)?;
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
    policy: &Policy,
    role: Participant,
    command: RoleCommand,
    now: u64,
) -> Result<RoleOutput> {
    match command {
        RoleCommand::InitializeRegistrationStorage { claim } => {
            // A bounded read warms this actor without changing custody or pool state.
            let _ = pool::installed_key(store, &claim.request.key_id).await?;
            material_delivery::json(true)
        }
        RoleCommand::InstallRegistrationStock { delivery, .. } => {
            // The surrounding transaction commits every batch together or rolls back all writes.
            for batch in delivery.into_batches() {
                if batch.binding.role != role {
                    return Err(invalid("Registration stock belongs to another role"));
                }
                pool::install_registration_batch(store, batch.binding, batch.sealed, now).await?;
            }
            material_delivery::json(true)
        }
        RoleCommand::StartRefill { job } => {
            refill::start_role(store, &job, now).await?;
            // The isolated producer receives public key bytes only, never role material.
            material_delivery::json(material::get(store, &job.key).await?.public_key)
        }
        RoleCommand::InstallMaterial { record } => {
            material::put(store, record).await?;
            material_delivery::json(true)
        }
        RoleCommand::CheckMaterial { activation } => {
            material_delivery::json(material::installed(store, role, &activation).await?)
        }
        RoleCommand::LoadSigningInputs { permit } => {
            let material = material::get(store, &permit.request.key).await?;
            let batch = *permit
                .batches
                .first()
                .ok_or_else(|| invalid("ML-DSA permit has no prepared pair"))?;
            let (binding, sealed) = pool::take(store, role, &permit, batch, now).await?;
            Ok(RoleOutput::SigningInputs(
                material_delivery::SigningInputs {
                    metadata: material_delivery::SigningMetadata {
                        material,
                        batch,
                        binding,
                    },
                    sealed,
                },
            ))
        }
        RoleCommand::PublicationRecorded { job } => material_delivery::json(
            pool::publication_recorded(
                store,
                &job.key,
                &job.batch_ids(),
                job.material_expires_at_ms,
            )
            .await?,
        ),
        RoleCommand::Inspect { key, batches } => {
            material_delivery::json(pool::inspect(store, &key, &batches).await?)
        }
        RoleCommand::RetireUnpaired { key, batches } => {
            pool::retire_unpaired(store, &key, &batches).await?;
            material_delivery::json(true)
        }
        RoleCommand::Fence { request, batches } => {
            material_delivery::json(pool::fence(store, &request, &batches).await?)
        }
        RoleCommand::WakeRefill { key } => {
            if role != Participant::A {
                return Err(invalid("ML-DSA refill wake requires participant A"));
            }
            pool::check_key(store, &key).await?;
            material_delivery::json(true)
        }
        RoleCommand::RefillStatus { key } => {
            material_delivery::json(pool::refill_status(store, &key, now).await?)
        }
        RoleCommand::Install { key } => {
            pool::install_key(store, key).await?;
            material_delivery::json(true)
        }
        RoleCommand::Put { job, batches } => {
            let expected = job.batch_ids();
            if batches.len() != expected.len()
                || batches
                    .iter()
                    .zip(&expected)
                    .any(|((binding, _), id)| binding.batch != *id || binding.role != role)
            {
                return Err(invalid(
                    "ML-DSA publication differs from its complete role job",
                ));
            }
            // The transaction publishes the bounded job together or rolls back every pair.
            for (binding, sealed) in batches {
                refill::publish_role(store, policy, &job, binding, sealed, now).await?;
            }
            material_delivery::json(true)
        }
        RoleCommand::LiveInventory { key, target } => {
            if target == 0 || target > 20 {
                return Err(invalid("Invalid ML-DSA refill target"));
            }
            material_delivery::json(pool::inventory(store, &key, target, now, now).await?)
        }
        RoleCommand::Inventory {
            key,
            target,
            ready_until_ms,
        } => {
            if target == 0 || target > 20 {
                return Err(invalid("Invalid ML-DSA refill target"));
            }
            material_delivery::json(
                pool::inventory(store, &key, target, now, ready_until_ms).await?,
            )
        }
        RoleCommand::Reserve { claim, batches } => {
            pool::reserve(store, &claim.request, &batches, claim.expires_at_ms, now).await?;
            material_delivery::json(true)
        }
        RoleCommand::Take { permit, batch } => {
            let (binding, sealed) = pool::take(store, role, &permit, batch, now).await?;
            Ok(RoleOutput::Taken { binding, sealed })
        }
        RoleCommand::Release {
            request,
            batches,
            settlement,
            consumed_union,
            unopened_intersection,
        } => {
            pool::release(
                store,
                &request,
                &batches,
                settlement,
                &consumed_union,
                &unopened_intersection,
            )
            .await?;
            material_delivery::json(true)
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
    let call = crate::parse_cloudflare_trace_id_from_request_v1(&request)
        .ok()
        .flatten();
    local_call(env, &command, call)
        .await
        .map_err(protocol_error)
}
async fn local_call(
    env: &Env,
    command: &RoleCommand,
    call: Option<crate::CloudflareTraceIdV1>,
) -> Result<Response> {
    let name = format!("ml-dsa-pool-{}", hex(&digest(b"wallet", command.wallet())?));
    let namespace = env.durable_object(POOL_BINDING).map_err(storage_error)?;
    let stub = namespace
        .id_from_name(&name)
        .map_err(storage_error)?
        .get_stub()
        .map_err(storage_error)?;
    let call = call.or_else(wait_trace::call_id);
    let trace = durable_trace::DurableTrace::role(env, command, call)?;
    let mut forwarded = object_request(env, CallAuthority::Internal, ROLE_PATH, command)?;
    if let Some(call) = call {
        crate::set_cloudflare_trace_id_header_v1(
            forwarded.headers_mut().map_err(storage_error)?,
            call,
        )?;
    }
    durable_trace::observe(
        trace.as_ref(),
        "pool_dispatch",
        stub.fetch_with_request(forwarded),
    )
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
        .id_from_name(&routing::destination(env, command).await?.admission_name())
        .map_err(storage_error)?
        .get_stub()
        .map_err(storage_error)?;
    let path = if matches!(authority, CallAuthority::Gateway(_)) {
        CONTROL_PATH
    } else {
        CHECK_PATH
    };
    let call = wait_trace::call_id();
    let trace = durable_trace::DurableTrace::admission(env, command, call)?;
    let mut request = object_request(env, authority, path, command)?;
    if let Some(call) = call {
        crate::set_cloudflare_trace_id_header_v1(
            request.headers_mut().map_err(storage_error)?,
            call,
        )?;
    }
    let mut response = durable_trace::observe(
        trace.as_ref(),
        "admission_dispatch",
        stub.fetch_with_request(request),
    )
    .await
    .map_err(storage_error)?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA admission service refused the request"));
    }
    response.json().await.map_err(storage_error)
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
