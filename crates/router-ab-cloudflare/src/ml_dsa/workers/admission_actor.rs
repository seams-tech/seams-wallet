//! Admission actor I/O. Domain admission and registration own state transitions.
use super::*;
use crate::ml_dsa::registration as registration_core;

#[cfg_attr(feature = "strict-worker-router-entrypoint", durable_object)]
pub struct RouterAbMlDsaAdmissionDurableObject {
    state: State,
    env: Env,
    storage_gate: futures::lock::Mutex<()>,
}
#[cfg(feature = "strict-worker-router-entrypoint")]
impl DurableObject for RouterAbMlDsaAdmissionDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self {
            state,
            env,
            storage_gate: futures::lock::Mutex::new(()),
        }
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
        let wake_registration = matches!(
            &command,
            AdmissionCommand::PrepareRegistration { .. }
                | AdmissionCommand::ActivateRegistration { .. }
                | AdmissionCommand::ClaimRegistration { .. }
                | AdmissionCommand::FinishRegistration { .. }
        );
        let _storage = self.storage_gate.lock().await;
        if wake_registration {
            schedule_refill_alarm(&self.state, 50).await?;
        }
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
    async fn alarm(&self) -> worker::Result<Response> {
        registration::run_preparation_queue(&self.env, &self.state, &self.storage_gate).await
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
        } => json::<admission_requests::prepare_registration::Reply>(
            registration_core::queue::request(
                store,
                wallet,
                group,
                registration_core::queue::Configuration::new(
                    schedule,
                    signing_schedule,
                    signing_batches,
                )?,
                now,
            )
            .await?,
        ),
        AdmissionCommand::ActivateRegistration {
            wallet,
            schedule,
            signing_schedule,
            signing_batches,
        } => {
            registration_core::queue::activate(
                store,
                wallet,
                group,
                registration_core::queue::Configuration::new(
                    schedule,
                    signing_schedule,
                    signing_batches,
                )?,
                now,
            )
            .await?;
            json::<admission_requests::activate_registration::Reply>(true)
        }
        AdmissionCommand::RetireRegistration { job } => {
            json::<admission_requests::retire_registration::Reply>(
                registration_core::retire_preparation(store, &job).await?,
            )
        }
        AdmissionCommand::ReadyRegistration { job, role } => {
            registration_core::ready(store, &job, role, now).await?;
            json::<admission_requests::ready_registration::Reply>(true)
        }
        AdmissionCommand::CheckRegistrationJob { job } => {
            json::<admission_requests::check_registration_job::Reply>(
                registration_core::check_job(store, &job, now).await?,
            )
        }
        AdmissionCommand::ClaimRegistration { request, schedule } => {
            let signing_schedule =
                execution::signing_layout_digest(schedules::DIGEST, policy.candidate_group_size());
            let configuration = registration_core::queue::Configuration::new(
                schedule,
                signing_schedule,
                policy.minimum_ready_batches().max(2),
            )?;
            json::<admission_requests::claim_registration::Reply>(
                registration_core::queue::claim_or_prepare(
                    store,
                    request,
                    group,
                    configuration,
                    now,
                )
                .await?,
            )
        }

        AdmissionCommand::CheckRegistrationClaim { claim } => {
            json::<admission_requests::check_registration_claim::Reply>(
                registration_core::check_claim(store, &claim, now).await?,
            )
        }
        AdmissionCommand::FinishRegistration { claim, result } => {
            json::<admission_requests::finish_registration::Reply>(
                registration_core::finish(store, &claim, result, now).await?,
            )
        }
        AdmissionCommand::ClaimRefill { key, occupied } => {
            json::<admission_requests::claim_refill::Reply>(
                refill::claim(store, policy, key, occupied, now).await?,
            )
        }
        AdmissionCommand::PendingRefills { key } => {
            json::<admission_requests::pending_refills::Reply>(
                refill::pending(store, &key, now).await?,
            )
        }
        AdmissionCommand::WithdrawRefill { key } => {
            refill::withdraw(store, &key).await?;
            json::<admission_requests::withdraw_refill::Reply>(true)
        }
        AdmissionCommand::CheckRefill { job } => {
            json::<admission_requests::check_refill::Reply>(refill::check(store, &job, now).await?)
        }
        AdmissionCommand::FinishRefill { job, outcome } => {
            json::<admission_requests::finish_refill::Reply>(
                refill::finish(store, policy, &job, outcome, now).await?,
            )
        }
        AdmissionCommand::AuthorizeKey { activation } => {
            admission::authorize_key(store, activation).await?;
            json::<admission_requests::authorize_key::Reply>(true)
        }
        AdmissionCommand::ActiveKey { key } => {
            json::<admission_requests::active_key::Reply>(admission::active_key(store, &key).await?)
        }
        AdmissionCommand::KeyState { key } => {
            json::<admission_requests::key_state::Reply>(admission::key_state(store, &key).await?)
        }
        AdmissionCommand::CommitKey { activation } => {
            json::<admission_requests::commit_key::Reply>(
                admission::commit_key(store, activation).await?,
            )
        }
        AdmissionCommand::Preflight { request } => json::<admission_requests::preflight::Reply>(
            admission::preflight(store, policy, &request, now).await?,
        ),
        AdmissionCommand::DeferEmpty {
            request,
            retry_at_ms,
        } => json::<admission_requests::defer_empty::Reply>(
            admission::defer_empty(store, policy, request, retry_at_ms, now).await?,
        ),
        AdmissionCommand::Begin { request } => json::<admission_requests::begin::Reply>(
            admission::begin(store, policy, request, now).await?,
        ),
        AdmissionCommand::Admit { claim, batches } => json::<admission_requests::admit::Reply>(
            admission::admit(store, policy, claim, batches, now).await?,
        ),
        AdmissionCommand::Cancel { claim } => {
            admission::cancel(store, &claim).await?;
            json::<admission_requests::cancel::Reply>(true)
        }
        AdmissionCommand::AwaitStock { claim, retry_at_ms } => {
            admission::await_stock(store, &claim, retry_at_ms.max(now.saturating_add(1_000)))
                .await?;
            json::<admission_requests::await_stock::Reply>(true)
        }
        AdmissionCommand::Finish { permit, completion } => {
            json::<admission_requests::finish::Reply>(
                admission::finish(store, &permit, completion, now).await?,
            )
        }
        AdmissionCommand::Settled { request } => {
            admission::settled(store, &request).await?;
            json::<admission_requests::settled::Reply>(true)
        }
        AdmissionCommand::Lookup { request } => json::<admission_requests::lookup::Reply>(
            admission::lookup(store, &request, now).await?,
        ),
    }
}
