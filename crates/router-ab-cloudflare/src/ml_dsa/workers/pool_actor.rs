//! Role-private pool actor I/O and typed storage dispatch.
use super::*;

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
            dispatch_role_transaction(
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
pub(super) async fn recover_expired_reservations(
    env: &Env,
    state: &State,
    key: &KeyScope,
) -> Result<()> {
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
            &admission_requests::lookup(reservation.request.clone()),
        )
        .await?;
        let settlement = match status {
            Some(Status::Declined { .. }) => pool::Settlement::Declined,
            // Once admitted, peer consumption can be unknown. Preserve conservative retirement.
            Some(Status::Failed { .. } | Status::Succeeded { .. }) => pool::Settlement::Failed,
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

pub(super) async fn role_transaction<R, C: Codec<R>>(
    state: &State,
    policy: Policy,
    role: Participant,
    command: Request<RoleCommand, R, C>,
    trace: Option<durable_trace::DurableTrace>,
) -> Result<R> {
    let output = dispatch_role_transaction(state, policy, role, command.into_wire(), trace)
        .await
        .map_err(storage_error)?;
    C::local(output)
}

async fn dispatch_role_transaction(
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
                    if preparation::signals_demand(&command) {
                        preparation::record_demand(&store, key, now)
                            .await
                            .map_err(protocol_error)?;
                    }
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
            material_delivery::json::<role_requests::initialize_registration_storage::Reply>(true)
        }
        RoleCommand::InstallRegistrationStock { delivery, .. } => {
            // The surrounding transaction commits every batch together or rolls back all writes.
            for batch in delivery.into_batches() {
                if batch.binding.role != role {
                    return Err(invalid("Registration stock belongs to another role"));
                }
                pool::install_registration_batch(store, batch.binding, batch.sealed, now).await?;
            }
            material_delivery::json::<role_requests::install_registration_stock::Reply>(true)
        }
        RoleCommand::StartRefill { job } => {
            refill::start_role(store, &job, now).await?;
            // The isolated producer receives public key bytes only, never role material.
            material_delivery::json::<role_requests::start_refill::Reply>(
                material::get(store, &job.key).await?.public_key,
            )
        }
        RoleCommand::InstallMaterial { record } => {
            material::put(store, record).await?;
            material_delivery::json::<role_requests::install_material::Reply>(true)
        }
        RoleCommand::CheckMaterial { activation } => {
            material_delivery::json::<role_requests::check_material::Reply>(
                material::installed(store, role, &activation).await?,
            )
        }
        RoleCommand::LoadSigningInputs { permit } => {
            let material = material::get(store, &permit.request.key).await?;
            let batch = *permit
                .batches
                .first()
                .ok_or_else(|| invalid("ML-DSA permit has no prepared pair"))?;
            let (binding, sealed): role_requests::take::Reply =
                pool::take(store, role, &permit, batch, now).await?;
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
        RoleCommand::PublicationRecorded { job } => {
            material_delivery::json::<role_requests::publication_recorded::Reply>(
                pool::publication_recorded(
                    store,
                    &job.key,
                    &job.batch_ids(),
                    job.material_expires_at_ms,
                )
                .await?,
            )
        }
        RoleCommand::Inspect { key, batches } => {
            material_delivery::json::<role_requests::inspect::Reply>(
                pool::inspect(store, &key, &batches).await?,
            )
        }
        RoleCommand::RetireUnpaired { key, batches } => {
            pool::retire_unpaired(store, &key, &batches).await?;
            material_delivery::json::<role_requests::retire_unpaired::Reply>(true)
        }
        RoleCommand::Fence { request, batches } => {
            material_delivery::json::<role_requests::fence::Reply>(
                pool::fence(store, &request, &batches).await?,
            )
        }
        RoleCommand::WakeRefill { key } => {
            if role != Participant::A {
                return Err(invalid("ML-DSA refill wake requires participant A"));
            }
            pool::check_key(store, &key).await?;
            material_delivery::json::<role_requests::wake_refill::Reply>(true)
        }
        RoleCommand::RefillStatus { key } => material_delivery::json::<
            role_requests::refill_status::Reply,
        >(pool::refill_status(store, &key, now).await?),
        RoleCommand::Install { key } => {
            pool::install_key(store, key).await?;
            material_delivery::json::<role_requests::install::Reply>(true)
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
            material_delivery::json::<role_requests::put::Reply>(true)
        }
        RoleCommand::LiveInventory { key, target } => {
            if target == 0 || target > 20 {
                return Err(invalid("Invalid ML-DSA refill target"));
            }
            material_delivery::json::<role_requests::live_inventory::Reply>(
                pool::inventory(store, &key, target, now, now).await?,
            )
        }
        RoleCommand::Inventory {
            key,
            target,
            ready_until_ms,
        } => {
            if target == 0 || target > 20 {
                return Err(invalid("Invalid ML-DSA refill target"));
            }
            material_delivery::json::<role_requests::inventory::Reply>(
                pool::inventory(store, &key, target, now, ready_until_ms).await?,
            )
        }
        RoleCommand::Reserve { claim, batches } => {
            pool::reserve(store, &claim.request, &batches, claim.expires_at_ms, now).await?;
            material_delivery::json::<role_requests::reserve::Reply>(true)
        }
        RoleCommand::Take { permit, batch } => {
            let (binding, sealed): role_requests::take::Reply =
                pool::take(store, role, &permit, batch, now).await?;
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
            material_delivery::json::<role_requests::release::Reply>(true)
        }
    }
}
