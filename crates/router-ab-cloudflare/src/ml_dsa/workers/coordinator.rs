//! Gateway-authenticated admission. The Router never receives private preparation.
use super::super::failure::SigningFailure;
use super::*;

enum PairReservation {
    Ready { batches: Vec<[u8; 32]> },
    Empty { retry_at_ms: u64, stock: StockProgress },
}

/// Paired batches ready for one key, against the count that admission needs.
#[derive(Debug, Clone, Copy, Serialize)]
pub(super) struct StockProgress {
    ready: usize,
    needed: usize,
}
impl StockProgress {
    fn of(policy: &Policy, paired: usize) -> Self {
        let needed = policy.minimum_ready_batches();
        Self {
            ready: paired.min(needed),
            needed,
        }
    }
}
/// A decision, with the stock count when the pool was too empty to admit.
struct Admission {
    decision: Decision,
    stock: Option<StockProgress>,
}
#[derive(Serialize)]
struct UnadmittedReply<'a> {
    #[serde(flatten)]
    decision: &'a Decision,
    #[serde(skip_serializing_if = "Option::is_none")]
    stock: Option<StockProgress>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StockRequest {
    key: KeyScope,
}
/// The Gateway reads stock for a published key when its owner opens a review. The read
/// counts as signing demand, so a key that went idle refills while the owner reads.
pub(crate) async fn handle_stock(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("ML-DSA stock requires POST", 405);
    }
    let input: StockRequest = decode_bounded_json_request(&mut request, 16_384)
        .await
        .map_err(protocol_error)?;
    let progress = stock_progress(env, &input.key)
        .await
        .map_err(protocol_error)?;
    Response::from_json(&progress)
}
async fn stock_progress(env: &Env, key: &KeyScope) -> Result<StockProgress> {
    check_signing_scope(env, key)?;
    let policy = policy(env)?;
    let deadline = policy.deadline(crate::cloudflare_now_unix_ms_v1()?)?;
    let (a, b) = inventory_pair(env, &policy, key, deadline).await?;
    let paired = a.ready.iter().filter(|id| b.ready.contains(id)).count();
    Ok(StockProgress::of(&policy, paired))
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
    Response::from_json(&result.decision)
}
async fn admit(
    env: &Env,
    headers: &worker::Headers,
    input: super::super::SigningRequest,
) -> Result<Admission> {
    check_signing_scope(env, &input.key)?;
    let policy = policy(env)?;
    let preflight: admission::Preflight = service_call(
        env,
        CallAuthority::Gateway(headers),
        &admission_requests::preflight(input.clone()),
    )
    .await?;
    if let admission::Preflight::Decided { decision } = preflight {
        return Ok(Admission {
            decision,
            stock: None,
        });
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
        let decision = service_call(
            env,
            CallAuthority::Gateway(headers),
            &admission_requests::defer_empty(input, a.retry_at_ms.max(b.retry_at_ms)),
        )
        .await?;
        return Ok(Admission {
            decision,
            stock: Some(StockProgress::of(&policy, paired)),
        });
    }
    let decision: Decision = service_call(
        env,
        CallAuthority::Gateway(headers),
        &admission_requests::begin(input),
    )
    .await?;
    let Decision::Claimed { claim } = decision else {
        return Ok(Admission {
            decision,
            stock: None,
        });
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
            let outcome: admission::AdmitOutcome = service_call(
                env,
                CallAuthority::Gateway(headers),
                &admission_requests::admit(claim.clone(), batches.clone()),
            )
            .await?;
            let decision = match outcome {
                admission::AdmitOutcome::Decided { decision } => decision,
                admission::AdmitOutcome::SpentStock { batches: spent } => {
                    retire_spent_stock(env, headers, claim, batches, spent).await?
                }
            };
            Ok(Admission {
                decision,
                stock: None,
            })
        }
        Ok(PairReservation::Empty { retry_at_ms, stock }) => {
            let _: bool = service_call(
                env,
                CallAuthority::Gateway(headers),
                &admission_requests::await_stock(claim.clone(), retry_at_ms),
            )
            .await?;
            Ok(Admission {
                decision: Decision::Unavailable {
                    reason: admission::UnavailableReason::EmptyPool,
                    retry_at_ms,
                },
                stock: Some(stock),
            })
        }
        Err(error) => {
            // No permit was admitted. Cancellation prevents later admission.
            let _: bool = service_call(
                env,
                CallAuthority::Gateway(headers),
                &admission_requests::cancel(claim.clone()),
            )
            .await?;
            // A partial reservation expires without ever exposing private material.
            Err(error)
        }
    }
}
/// Both roles offered batches that Router admission recorded as spent, which means that
/// their storage went back in time. The refusal retires them, and a new operation signs.
async fn retire_spent_stock(
    env: &Env,
    headers: &worker::Headers,
    claim: Claim,
    batches: Vec<[u8; 32]>,
    spent: Vec<[u8; 32]>,
) -> Result<Decision> {
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "ml_dsa_spent_stock_refused_v1", "operation": hex(&claim.request.operation),
            "batches": spent.iter().map(|batch| hex(batch)).collect::<Vec<_>>(),
        })
    );
    let command = role_requests::retire_spent(claim.request.key.clone(), spent);
    let (a, b) = futures::join!(
        role_call(env, "DERIVER_A", &command),
        role_call(env, "DERIVER_B", &command)
    );
    if !a? || !b? {
        return Err(invalid("ML-DSA role refused spent stock retirement"));
    }
    let returned = release_pair(env, &claim.request, batches, pool::Settlement::Declined).await?;
    let _: bool = service_call(
        env,
        CallAuthority::Gateway(headers),
        &admission_requests::settled(claim.request, returned),
    )
    .await?;
    Ok(Decision::Existing {
        operation: Status::Declined {
            failure: SigningFailure::Cancelled,
        },
    })
}
async fn inventory_pair(
    env: &Env,
    policy: &Policy,
    key: &KeyScope,
    ready_until_ms: u64,
) -> Result<(pool::Inventory, pool::Inventory)> {
    let query =
        role_requests::inventory(key.clone(), policy.refill_target_batches(), ready_until_ms);
    let (a, b) = futures::join!(
        role_call(env, "DERIVER_A", &query),
        role_call(env, "DERIVER_B", &query)
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
        return Ok(PairReservation::Empty {
            retry_at_ms: retry,
            stock: StockProgress::of(policy, batches.len()),
        });
    }
    let command = role_requests::reserve(claim.clone(), batches.clone());
    let (a, b) = futures::join!(
        role_call(env, "DERIVER_A", &command),
        role_call(env, "DERIVER_B", &command)
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
) -> Result<Vec<[u8; 32]>> {
    let fence = role_requests::fence(request.clone(), batches.clone());
    let (a, b) = futures::join!(
        role_call(env, "DERIVER_A", &fence),
        role_call(env, "DERIVER_B", &fence)
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
    let unopened_intersection: Vec<[u8; 32]> = a
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
    let returned = match settlement {
        pool::Settlement::Succeeded | pool::Settlement::Declined => batches
            .iter()
            .filter(|id| !consumed_union.contains(id))
            .copied()
            .collect(),
        pool::Settlement::Failed => unopened_intersection
            .iter()
            .filter(|id| !consumed_union.contains(id))
            .copied()
            .collect(),
    };
    let command = role_requests::release(
        request.clone(),
        batches,
        settlement,
        consumed_union,
        unopened_intersection,
    );
    let (a, b) = futures::join!(
        role_call(env, "DERIVER_A", &command),
        role_call(env, "DERIVER_B", &command)
    );
    if !a? || !b? {
        return Err(invalid("ML-DSA reservation release failed"));
    }
    Ok(returned)
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
        &admission_requests::finish(input.permit.clone(), input.completion),
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
    let returned = release_pair(env, &input.permit.request, input.permit.batches, settlement)
        .await
        .map_err(protocol_error)?;
    let _: bool = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &admission_requests::settled(input.permit.request, returned),
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
        &admission_requests::lookup(input),
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
    let command = role_requests::install(activation.key.clone());
    let _: bool = service_call(
        env,
        CallAuthority::Gateway(headers),
        &admission_requests::authorize_key(activation.clone()),
    )
    .await
    .map_err(protocol_error)?;
    let (a, b) = futures::join!(
        role_call(env, "DERIVER_A", &command),
        role_call(env, "DERIVER_B", &command)
    );
    if !a.map_err(protocol_error)? || !b.map_err(protocol_error)? {
        return Response::error("ML-DSA key activation is incomplete", 503);
    }
    let check = role_requests::check_material(activation.clone());
    let (a, b) = futures::join!(
        role_call(env, "DERIVER_A", &check),
        role_call(env, "DERIVER_B", &check)
    );
    if !a.map_err(protocol_error)? || !b.map_err(protocol_error)? {
        return Response::from_json(&admission::KeyState::Installing { activation });
    }
    let state: admission::KeyState = service_call(
        env,
        CallAuthority::Gateway(headers),
        &admission_requests::commit_key(activation),
    )
    .await
    .map_err(protocol_error)?;
    // Re-enqueue after commit: an earlier alarm may have observed Installing.
    let (a, b) = futures::join!(
        role_call(env, "DERIVER_A", &command),
        role_call(env, "DERIVER_B", &command)
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
        &role_requests::inspect(key.clone(), batches.clone()),
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
            &role_requests::retire_unpaired(key.clone(), retired),
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
    let Admission { decision, stock } = admit(env, request.headers(), input.request)
        .await
        .map_err(protocol_error)?;
    trace.mark("admission_done");
    let Decision::Admitted { permit } = decision else {
        // Only an empty pool reports stock. The owner sees how much of it is ready.
        let stock = match decision {
            Decision::Unavailable {
                reason: admission::UnavailableReason::EmptyPool,
                ..
            } => stock,
            _ => None,
        };
        return Response::from_json(&UnadmittedReply {
            decision: &decision,
            stock,
        });
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
        &admission_requests::finish(permit.clone(), completion),
    )
    .await
    .map_err(protocol_error)?;
    trace.mark("completion_recorded");
    let settlement = match &status {
        Status::Succeeded { .. } => pool::Settlement::Succeeded,
        Status::Failed { .. } => pool::Settlement::Failed,
        _ => return Response::error("ML-DSA execution did not settle", 503),
    };
    let returned = release_pair(env, &permit.request, permit.batches, settlement)
        .await
        .map_err(protocol_error)?;
    trace.mark("roles_released");
    let _: bool = service_call(
        env,
        CallAuthority::Gateway(request.headers()),
        &admission_requests::settled(permit.request, returned),
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
