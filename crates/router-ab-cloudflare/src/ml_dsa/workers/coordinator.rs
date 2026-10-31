//! Gateway-authenticated admission. The Router never receives private preparation.
use super::super::failure::SigningFailure;
use super::*;

enum PairReservation {
    Ready { batches: Vec<[u8; 32]> },
    Empty { retry_at_ms: u64 },
}

pub(crate) async fn handle_admit(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("ML-DSA admission requires POST", 405);
    }
    let input: super::super::SigningRequest = decode_bounded_json_request(&mut request, 16_384)
        .await
        .map_err(protocol_error)?;
    let result = admit(env, request.headers(), input)
        .await
        .map_err(protocol_error)?;
    Response::from_json(&result)
}
async fn admit(
    env: &Env,
    headers: &worker::Headers,
    input: super::super::SigningRequest,
) -> Result<Decision> {
    check_signing_scope(env, &input.key)?;
    let policy = policy(env)?;
    let preflight: admission::Preflight = service_call(
        env,
        CallAuthority::Gateway(headers),
        &AdmissionCommand::Preflight {
            request: input.clone(),
        },
    )
    .await?;
    if let admission::Preflight::Decided { decision } = preflight {
        return Ok(decision);
    }
    let (a, b) = inventory_pair(
        env,
        &policy,
        &input.key,
        policy.deadline(crate::cloudflare_now_unix_ms_v1()?)?,
    )
    .await?;
    let paired = a.ready.iter().filter(|id| b.ready.contains(id)).count();
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "ml_dsa_admission_stock_v1", "operation": hex(&input.operation),
            "paired": paired, "minimum": policy.minimum_ready_batches(), "stage": "preflight",
        })
    );
    if paired < policy.minimum_ready_batches() {
        return service_call(
            env,
            CallAuthority::Gateway(headers),
            &AdmissionCommand::DeferEmpty {
                request: input,
                retry_at_ms: a.retry_at_ms.max(b.retry_at_ms),
            },
        )
        .await;
    }
    let decision: Decision = service_call(
        env,
        CallAuthority::Gateway(headers),
        &AdmissionCommand::Begin { request: input },
    )
    .await?;
    let Decision::Claimed { claim } = decision else {
        return Ok(decision);
    };
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "ml_dsa_admission_stock_v1", "operation": hex(&claim.request.operation),
            "paired": paired, "minimum": policy.minimum_ready_batches(), "stage": "claimed",
        })
    );
    let outcome = reserve_pair(env, &policy, &claim).await;
    match outcome {
        Ok(PairReservation::Ready { batches }) => {
            // A lost reply can follow durable admission. Keep the reservations.
            service_call(
                env,
                CallAuthority::Gateway(headers),
                &AdmissionCommand::Admit { claim, batches },
            )
            .await
        }
        Ok(PairReservation::Empty { retry_at_ms }) => {
            let _: bool = service_call(
                env,
                CallAuthority::Gateway(headers),
                &AdmissionCommand::AwaitStock {
                    claim: claim.clone(),
                    retry_at_ms,
                },
            )
            .await?;
            Ok(Decision::Unavailable {
                reason: admission::UnavailableReason::EmptyPool,
                retry_at_ms,
            })
        }
        Err(error) => {
            // No permit was admitted. Cancellation prevents later admission.
            let _: bool = service_call(
                env,
                CallAuthority::Gateway(headers),
                &AdmissionCommand::Cancel {
                    claim: claim.clone(),
                },
            )
            .await?;
            // A partial reservation expires without ever exposing private material.
            Err(error)
        }
    }
}
async fn inventory_pair(
    env: &Env,
    policy: &Policy,
    key: &KeyScope,
    ready_until_ms: u64,
) -> Result<(pool::Inventory, pool::Inventory)> {
    let query = RoleCommand::Inventory {
        key: key.clone(),
        target: policy.refill_target_batches(),
        ready_until_ms: ready_until_ms,
    };
    let (a, b) = futures::join!(
        role_call::<pool::Inventory>(env, "DERIVER_A", &query),
        role_call::<pool::Inventory>(env, "DERIVER_B", &query)
    );
    let (a, b) = (a?, b?);
    preparation::log_inventory(key, &a, &b);
    Ok((a, b))
}
async fn reserve_pair(env: &Env, policy: &Policy, claim: &Claim) -> Result<PairReservation> {
    // Repeat the inventory check under the exclusive claim. Preflight is only a hint.
    let (a, b) = inventory_pair(env, policy, &claim.request.key, claim.expires_at_ms).await?;
    let only_a: Vec<_> = a
        .ready
        .iter()
        .filter(|id| !b.ready.contains(id))
        .copied()
        .collect();
    let only_b: Vec<_> = b
        .ready
        .iter()
        .filter(|id| !a.ready.contains(id))
        .copied()
        .collect();
    let (retire_a, retire_b) = futures::join!(
        reconcile_unpaired(env, &claim.request.key, "DERIVER_A", "DERIVER_B", only_a),
        reconcile_unpaired(env, &claim.request.key, "DERIVER_B", "DERIVER_A", only_b),
    );
    retire_a?;
    retire_b?;

    let batches: Vec<_> = a
        .ready
        .iter()
        .filter(|id| b.ready.contains(id))
        .copied()
        .collect();
    let retry = a.retry_at_ms.max(b.retry_at_ms);
    if batches.len() < policy.minimum_ready_batches() {
        return Ok(PairReservation::Empty { retry_at_ms: retry });
    }
    let command = RoleCommand::Reserve {
        claim: claim.clone(),
        batches: batches.clone(),
    };
    let (a, b) = futures::join!(
        role_call::<bool>(env, "DERIVER_A", &command),
        role_call::<bool>(env, "DERIVER_B", &command)
    );
    if !a? || !b? {
        return Err(invalid("ML-DSA role refused reservation"));
    }
    Ok(PairReservation::Ready { batches })
}
async fn release_pair(
    env: &Env,
    request: &super::super::SigningRequest,
    batches: Vec<[u8; 32]>,
    settlement: pool::Settlement,
) -> Result<()> {
    let fence = RoleCommand::Fence {
        request: request.clone(),
        batches: batches.clone(),
    };
    let (a, b) = futures::join!(
        role_call::<pool::FencedBatches>(env, "DERIVER_A", &fence),
        role_call::<pool::FencedBatches>(env, "DERIVER_B", &fence)
    );
    let a = a?;
    let b = b?;
    let digest = request.digest()?;
    if a.request_digest != digest
        || b.request_digest != digest
        || a.batches != batches
        || b.batches != batches
    {
        return Err(invalid("ML-DSA fence scope changed"));
    }
    let unopened_intersection = a
        .unopened
        .iter()
        .filter(|id| b.unopened.contains(id))
        .copied()
        .collect();
    let mut consumed_union = a.consumed;
    for id in b.consumed {
        if !consumed_union.contains(&id) {
            consumed_union.push(id);
        }
    }
    let command = RoleCommand::Release {
        request: request.clone(),
        batches,
        settlement,
        consumed_union,
        unopened_intersection,
    };
    let (a, b) = futures::join!(
        role_call::<bool>(env, "DERIVER_A", &command),
        role_call::<bool>(env, "DERIVER_B", &command)
    );
    if !a? || !b? {
        return Err(invalid("ML-DSA reservation release failed"));
    }
    Ok(())
}
pub(super) async fn role_call<T: serde::de::DeserializeOwned>(
    env: &Env,
    binding: &str,
    command: &RoleCommand,
) -> Result<T> {
    let operation = match command {
        RoleCommand::InitializeRegistrationStorage { .. } => {
            "ML-DSA registration storage initialization"
        }
        RoleCommand::Inventory { .. } => "ML-DSA inventory",
        RoleCommand::Reserve { .. } => "ML-DSA reservation",
        RoleCommand::Fence { .. } => "ML-DSA settlement fence",
        RoleCommand::Release { .. } => "ML-DSA settlement release",
        _ => "ML-DSA role storage",
    };
    let call = wait_trace::call_id();
    let trace = durable_trace::DurableTrace::role(env, command, call)?;
    let mut response = durable_trace::observe(
        trace.as_ref(),
        "role_dispatch",
        crate::router_coordinator::post_role_request(
            env,
            binding,
            "https://ml-dsa-role.internal",
            ROLE_PATH,
            operation,
            command,
            call,
        ),
    )
    .await?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA role storage refused the request"));
    }
    response.json().await.map_err(storage_error)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteRequest {
    permit: Permit,
    completion: Completion,
}
pub(crate) async fn handle_complete(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("ML-DSA completion requires POST", 405);
    }
    let input: CompleteRequest = decode_bounded_json_request(&mut request, 131_072)
        .await
        .map_err(protocol_error)?;
    let result: Status = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::Finish {
            permit: input.permit.clone(),
            completion: input.completion,
        },
    )
    .await
    .map_err(protocol_error)?;
    let settlement = match result {
        Status::Succeeded { .. } => pool::Settlement::Succeeded,
        Status::Failed { .. } => pool::Settlement::Failed,
        Status::Declined { .. } => pool::Settlement::Declined,
        Status::AwaitingStock { .. } | Status::Preparing { .. } | Status::Running { .. } => {
            return Response::error("ML-DSA completion is not terminal", 409)
        }
    };
    release_pair(env, &input.permit.request, input.permit.batches, settlement)
        .await
        .map_err(protocol_error)?;
    let _: bool = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::Settled {
            request: input.permit.request,
        },
    )
    .await
    .map_err(protocol_error)?;
    Response::from_json(&result)
}
pub(crate) async fn handle_status(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("ML-DSA status requires POST", 405);
    }
    let input: super::super::SigningRequest = decode_bounded_json_request(&mut request, 16_384)
        .await
        .map_err(protocol_error)?;
    let result: Option<Status> = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::Lookup { request: input },
    )
    .await
    .map_err(protocol_error)?;
    Response::from_json(&result)
}

/// The Gateway must complete its custody verification before calling this route.
/// The Router pins exact activation authority before either role can install it.
pub(crate) async fn handle_activate(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("ML-DSA activation requires POST", 405);
    }
    let activation: admission::KeyActivation = decode_bounded_json_request(&mut request, 16_384)
        .await
        .map_err(protocol_error)?;
    activate(env, request.headers(), activation).await
}
pub(super) async fn activate(
    env: &Env,
    headers: &worker::Headers,
    activation: admission::KeyActivation,
) -> worker::Result<Response> {
    let command = RoleCommand::Install {
        key: activation.key.clone(),
    };
    let _: bool = service_call(
        env,
        CallAuthority::Gateway(headers),
        &AdmissionCommand::AuthorizeKey {
            activation: activation.clone(),
        },
    )
    .await
    .map_err(protocol_error)?;
    let (a, b) = futures::join!(
        role_call::<bool>(env, "DERIVER_A", &command),
        role_call::<bool>(env, "DERIVER_B", &command)
    );
    if !a.map_err(protocol_error)? || !b.map_err(protocol_error)? {
        return Response::error("ML-DSA key activation is incomplete", 503);
    }
    let check = RoleCommand::CheckMaterial {
        activation: activation.clone(),
    };
    let (a, b) = futures::join!(
        role_call::<bool>(env, "DERIVER_A", &check),
        role_call::<bool>(env, "DERIVER_B", &check)
    );
    if !a.map_err(protocol_error)? || !b.map_err(protocol_error)? {
        return Response::from_json(&admission::KeyState::Installing { activation });
    }
    let state: admission::KeyState = service_call(
        env,
        CallAuthority::Gateway(headers),
        &AdmissionCommand::CommitKey { activation },
    )
    .await
    .map_err(protocol_error)?;
    // Re-enqueue after commit: an earlier alarm may have observed Installing.
    let (a, b) = futures::join!(
        role_call::<bool>(env, "DERIVER_A", &command),
        role_call::<bool>(env, "DERIVER_B", &command)
    );
    if !a.map_err(protocol_error)? || !b.map_err(protocol_error)? {
        return Response::error("ML-DSA activation refill scheduling is incomplete", 503);
    }
    Response::from_json(&state)
}

async fn reconcile_unpaired(
    env: &Env,
    key: &KeyScope,
    owner: &str,
    peer: &str,
    batches: Vec<[u8; 32]>,
) -> Result<()> {
    if batches.is_empty() {
        return Ok(());
    }
    let states: Vec<pool::BatchAvailability> = role_call(
        env,
        peer,
        &RoleCommand::Inspect {
            key: key.clone(),
            batches: batches.clone(),
        },
    )
    .await?;
    if states.len() != batches.len() {
        return Err(invalid("ML-DSA peer inventory length changed"));
    }
    let mut retired = Vec::new();
    for (batch, state) in batches.into_iter().zip(states) {
        if state == pool::BatchAvailability::Retired {
            retired.push(batch);
        }
    }
    if !retired.is_empty() {
        let accepted: bool = role_call(
            env,
            owner,
            &RoleCommand::RetireUnpaired {
                key: key.clone(),
                batches: retired,
            },
        )
        .await?;
        if !accepted {
            return Err(invalid("ML-DSA orphan retirement failed"));
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SignRequest {
    request: super::super::SigningRequest,
    message: Vec<u8>,
    context: Vec<u8>,
}
pub(crate) async fn handle_sign(request: worker::Request, env: &Env) -> worker::Result<Response> {
    let mut trace = router_trace::RouterTrace::new(request.headers())?;
    let mut response = sign_request(request, env, &mut trace).await;
    trace.finish(&mut response)?;
    response
}
async fn sign_request(
    mut request: worker::Request,
    env: &Env,
    trace: &mut router_trace::RouterTrace,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("ML-DSA signing requires POST", 405);
    }
    let input: SignRequest = decode_bounded_json_request(&mut request, 131_072)
        .await
        .map_err(protocol_error)?;
    if input.message.len() > 16384
        || input.context.len() > 255
        || <[u8; 32]>::from(Sha256::digest(&input.message)) != input.request.message_digest
        || <[u8; 32]>::from(Sha256::digest(&input.context)) != input.request.context_digest
    {
        return Response::error("ML-DSA message differs from authorization", 400);
    }
    trace.bind(input.request.operation);
    let decision = admit(env, request.headers(), input.request)
        .await
        .map_err(protocol_error)?;
    trace.mark("admission_done");
    let Decision::Admitted { permit } = decision else {
        return Response::from_json(&decision);
    };
    let execution = execution::Request {
        permit: permit.clone(),
        message: input.message,
        context: input.context,
    };
    let result = before_deadline(permit.expires_at_ms, dispatch_response(env, &execution)).await;
    trace.mark("execution_done");
    log_execution(&permit.request.operation, &result);
    let completion = match result {
        Ok((public_key, execution::Outcome::Signed { signature, .. })) => Completion::Succeeded {
            public_key,
            message: execution.message,
            context: execution.context,
            signature,
        },
        Ok((
            _,
            execution::Outcome::Exhausted {
                consumed_batches,
                evaluated_candidates,
            },
        )) => Completion::Failed {
            failure: SigningFailure::CandidatesExhausted {
                consumed_batches,
                evaluated_candidates,
            },
        },
        Err(failure) => Completion::Failed { failure },
    };
    let status: Status = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::Finish {
            permit: permit.clone(),
            completion,
        },
    )
    .await
    .map_err(protocol_error)?;
    trace.mark("completion_recorded");
    let settlement = match &status {
        Status::Succeeded { .. } => pool::Settlement::Succeeded,
        Status::Failed { .. } => pool::Settlement::Failed,
        _ => return Response::error("ML-DSA execution did not settle", 503),
    };
    release_pair(env, &permit.request, permit.batches, settlement)
        .await
        .map_err(protocol_error)?;
    trace.mark("roles_released");
    let _: bool = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &AdmissionCommand::Settled {
            request: permit.request,
        },
    )
    .await
    .map_err(protocol_error)?;
    trace.mark("settled");
    Response::from_json(&Decision::Existing { operation: status })
}
type DispatchResult = core::result::Result<(Vec<u8>, execution::Outcome), SigningFailure>;

async fn dispatch_response(env: &Env, input: &execution::Request) -> DispatchResult {
    let mut response = crate::router_coordinator::post_role_request(
        env,
        "DERIVER_A",
        "https://ml-dsa-role.internal",
        EXECUTE_PATH,
        "ML-DSA admitted signing",
        input,
        None,
    )
    .await
    .map_err(|_| SigningFailure::TransportInterrupted)?;
    if response.status_code() != 200 {
        let status = response.status_code();
        return Err(response
            .json::<SigningFailure>()
            .await
            .unwrap_or_else(|_| SigningFailure::from_http_status(status)));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| SigningFailure::TransportInterrupted)?;
    serde_json::from_slice(&bytes).map_err(|_| SigningFailure::InvalidParticipantResponse)
}

fn log_execution(operation: &[u8; 32], result: &DispatchResult) {
    let outcome = match result {
        Ok((
            _,
            execution::Outcome::Signed {
                consumed_batches,
                evaluated_candidates,
                ..
            },
        )) => {
            serde_json::json!({"status": "signed", "consumed_batches": consumed_batches, "evaluated_candidates": evaluated_candidates})
        }
        Ok((
            _,
            execution::Outcome::Exhausted {
                consumed_batches,
                evaluated_candidates,
            },
        )) => {
            serde_json::json!({"status": "exhausted", "consumed_batches": consumed_batches, "evaluated_candidates": evaluated_candidates})
        }
        Err(failure) => serde_json::json!({"status": "failed", "failure": failure}),
    };
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "ml_dsa_signing_outcome_v1",
            "operation": hex(operation),
            "outcome": outcome,
        })
    );
}
