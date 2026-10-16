use super::*;

/// Local only: the Gateway's terminal-failure fault asks a dev Router to end a
/// registration burned instead of running it.
#[cfg(feature = "local-intended-router-burn")]
const LOCAL_INTENDED_ROUTER_BURN_HEADER_V1: &str = "x-seams-local-intended-router-burn-v1";

/// Handles one authenticated Gateway-to-Router Yao execution request.
pub async fn handle_cloudflare_router_ed25519_yao_execute_private_fetch_v1(
    mut request: Request,
    env: &Env,
) -> worker::Result<Response> {
    let RouterExecuteRequestHeadV1 {
        wallet_route,
        parse_started_at_ms,
        trace_id,
        replay,
    } = match read_router_execute_request_head_v1(&request, env, "Router Yao execute route requires POST") {
        Ok(head) => head,
        Err(response) => return response,
    };
    #[cfg(feature = "local-intended-router-burn")]
    let burn = matches!(
        request.headers().get(LOCAL_INTENDED_ROUTER_BURN_HEADER_V1),
        Ok(Some(_))
    );
    let gateway_envelope = match request
        .json::<CloudflareRouterEd25519YaoExecuteRequestV2>()
        .await
    {
        Ok(request) => request,
        Err(error) => {
            return protocol_error_response(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("Router Yao execute request JSON is malformed: {error}"),
            ))
        }
    };
    if let Err(error) = gateway_envelope.validate() {
        return protocol_error_response(error);
    }
    let registration = match crate::RouterWalletRegistrationV1::from_request(&gateway_envelope) {
        Ok(registration) => registration,
        Err(error) => return protocol_error_response(error),
    };
    if let Some(registration) = registration {
        if replay {
            return protocol_error_response(crate::router_wallet_registration_replay_refused_v1());
        }
        return crate::durable_object::forward_router_wallet_execution(
            env,
            &registration,
            WalletRegistrationExecution {
                wallet_route,
                request: gateway_envelope,
                trace_id: trace_id.map(crate::CloudflareTraceIdV1::as_hex),
                #[cfg(feature = "local-intended-router-burn")]
                burn,
            },
        )
        .await;
    }
    if let Some(admission) = crate::RouterWalletRequestV1::settlement_admission(&gateway_envelope) {
        match crate::durable_object::call_router_wallet_v1(env, wallet_route, &admission).await {
            Ok(crate::RouterWalletResponseV1::SettlementAdmitted) => {}
            Ok(_) => {
                return protocol_error_response(invalid_coordinator("Invalid settlement admission"))
            }
            Err(error) => return protocol_error_response(error),
        }
    }
    execute_request(
        env,
        wallet_route,
        gateway_envelope,
        trace_id,
        replay,
        None,
        parse_started_at_ms,
        #[cfg(feature = "local-intended-router-burn")]
        burn,
    )
    .await
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WalletRegistrationExecution {
    pub(crate) wallet_route: crate::WalletObjectRoute,
    request: CloudflareRouterEd25519YaoExecuteRequestV2,
    trace_id: Option<String>,
    #[cfg(feature = "local-intended-router-burn")]
    burn: bool,
}

struct ClaimedRegistration<'a> {
    state: &'a worker::State,
    registration: crate::RouterWalletRegistrationV1,
    generation: u64,
    lapses_at_ms: u64,
}

pub(crate) async fn execute_in_wallet(
    state: &worker::State,
    env: &Env,
    execution: WalletRegistrationExecution,
) -> worker::Result<Response> {
    let parse_started_at_ms = cloudflare_now_unix_ms_v1().unwrap_or_default();
    let trace_id = match execution
        .trace_id
        .as_deref()
        .map(crate::CloudflareTraceIdV1::parse)
        .transpose()
    {
        Ok(trace_id) => trace_id,
        Err(error) => return protocol_error_response(error),
    };
    if execution.wallet_route.addresses.router.as_str() != state.id().to_string() {
        return protocol_error_response(invalid_coordinator(
            "Registration addresses another Router object",
        ));
    }
    if let Err(error) = execution.request.validate() {
        return protocol_error_response(error);
    }
    let registration = match crate::RouterWalletRegistrationV1::from_request(&execution.request) {
        Ok(Some(registration)) => registration,
        Ok(None) => {
            return protocol_error_response(invalid_coordinator(
                "Wallet execution requires registration",
            ))
        }
        Err(error) => return protocol_error_response(error),
    };
    let now_ms =
        cloudflare_now_unix_ms_v1().map_err(|error| worker::Error::RustError(error.to_string()))?;
    let lease_ms = match crate::parse_router_yao_registration_lease_ms_v1(
        &CloudflareWorkerEnvReaderV1::new(env),
    ) {
        Ok(lease) => lease,
        Err(error) => return protocol_error_response(error),
    };
    let answer = crate::durable_object::execute_router_wallet_command(
        state,
        registration.claim(now_ms, lease_ms),
    )
    .await;
    let (pinned, replay, generation) = match answer {
        Ok(crate::RouterWalletResponseV1::Run {
            request_json,
            replay,
            generation,
        }) => match crate::router_wallet::decode_stored_registration_request(&request_json) {
            Ok(request) => (request, replay, generation),
            Err(error) => return protocol_error_response(error),
        },
        Ok(answer) => return router_wallet_answer_response(answer),
        Err(error) => return protocol_error_response(error),
    };
    // The storage transaction has ended. The DO output gate keeps outbound
    // requests behind confirmation of the claim write.
    execute_request(
        env,
        execution.wallet_route,
        pinned,
        trace_id,
        replay,
        Some(ClaimedRegistration {
            state,
            registration,
            generation,
            lapses_at_ms: now_ms.saturating_add(lease_ms),
        }),
        parse_started_at_ms,
        #[cfg(feature = "local-intended-router-burn")]
        execution.burn,
    )
    .await
}

async fn execute_request(
    env: &Env,
    wallet_route: crate::WalletObjectRoute,
    gateway_envelope: CloudflareRouterEd25519YaoExecuteRequestV2,
    trace_id: Option<crate::CloudflareTraceIdV1>,
    replay: bool,
    claimed: Option<ClaimedRegistration<'_>>,
    parse_started_at_ms: u64,
    #[cfg(feature = "local-intended-router-burn")] burn: bool,
) -> worker::Result<Response> {
    let ownership_generation = gateway_envelope.target.ownership_generation();
    let claim_lapses_at_ms = claimed.as_ref().map(|claim| claim.lapses_at_ms);
    let CloudflareRouterEd25519YaoExecuteRequestV2 {
        tenant_root,
        application,
        participant_ids,
        target: gateway_request,
    } = gateway_envelope;
    let now_ms = match cloudflare_now_unix_ms_v1() {
        Ok(now_ms) => now_ms,
        Err(error) => return protocol_error_response(error),
    };
    let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(env) {
        Ok(runtime) => runtime,
        Err(error) => return protocol_error_response(error),
    };
    let recipient_set_digest = match router_recipient_set_digest_v1(env) {
        Ok(digest) => digest,
        Err(error) => return protocol_error_response(error),
    };
    let execute_request = match gateway_request.into_execute_request(
        recipient_set_digest,
        now_ms,
        now_ms.saturating_add(ROUTER_AUTHORITY_TTL_MS),
    ) {
        Ok(request) => request,
        Err(error) => return protocol_error_response(error),
    };
    // Local only, in dev builds: the claimed registration ends burned, as a
    // run that burned its pair would, and its answer is recorded like one.
    #[cfg(feature = "local-intended-router-burn")]
    if burn && claimed.is_some() {
        let result = router_execution_id(execute_request.pair_binding()).map(|execution_id| {
            RouterEd25519YaoExecuteResultV1::burned(
                execution_id,
                router_ab_core::RouterEd25519YaoBurnReasonV1::ProtocolFailure,
            )
        });
        return finish_router_execution_response(claimed.as_ref(), result).await;
    }
    #[cfg(feature = "strict-worker-router-entrypoint")]
    if replay && execute_request.operation() == Ed25519YaoOperationV1::Registration {
        // A run that took over a lapsed claim answers from what the earlier
        // run left. It executes the registration itself only when that run
        // started no execution.
        if let Some(result) = execute_historical_registration_replay_v1(
            env,
            wallet_route,
            ownership_generation,
            &runtime,
            &execute_request,
            &tenant_root,
            &application,
            participant_ids,
            now_ms,
            trace_id,
        )
        .await
        .transpose()
        {
            return finish_router_execution_response(claimed.as_ref(), result).await;
        }
    }
    let tenant_root = match resolve_ed25519_yao_tenant_root_context_v2(
        env,
        wallet_route,
        ownership_generation,
        tenant_root,
        application,
        participant_ids,
        execute_request.pair_binding(),
        now_ms,
    )
    .await
    {
        Ok(context) => context,
        Err(error) => return protocol_error_response(error),
    };
    let operation = execute_request.operation();
    emit_span(
        trace_id,
        "router.parse_and_authorize",
        operation_label(operation),
        parse_started_at_ms,
        "success",
    );
    let started_at_ms = now_ms;
    let mut timing = RouterExecutionTimingV1::default();
    let result = execute_router_ceremony_v1(
        env,
        &runtime,
        execute_request,
        tenant_root,
        now_ms,
        trace_id,
        replay,
        run_deadline_ms(now_ms, claim_lapses_at_ms),
        &mut timing,
    )
    .await;
    emit_span(
        trace_id,
        "router.yao_execute",
        operation_label(operation),
        started_at_ms,
        if result.is_ok() { "success" } else { "failure" },
    );
    let response = finish_router_execution_response(claimed.as_ref(), result).await?;
    response
        .headers()
        .set("Server-Timing", &timing.server_timing())?;
    Ok(response)
}

/// Answers one run. A registration's terminal answer is recorded in the
/// Router's wallet object under the claim generation the run holds, and the
/// recorded answer is the one sent. A run whose lapsed claim another run took
/// over is answered that the execution is in progress. A recoverable answer
/// leaves the claim to lapse.
async fn finish_router_execution_response(
    claimed: Option<&ClaimedRegistration<'_>>,
    result: RouterAbProtocolResult<RouterEd25519YaoExecuteResultV1>,
) -> worker::Result<Response> {
    let result = match result {
        Ok(result) => result,
        Err(error) => return protocol_error_response(error),
    };
    let Some(claim) = claimed else {
        return Response::from_json(&result);
    };
    let finish = match cloudflare_now_unix_ms_v1()
        .and_then(|now_ms| claim.registration.finish(&result, claim.generation, now_ms))
    {
        Ok(Some(finish)) => finish,
        Ok(None) => return Response::from_json(&result),
        Err(error) => return protocol_error_response(error),
    };
    match crate::durable_object::execute_router_wallet_command(claim.state, finish).await {
        Ok(answer) => router_wallet_answer_response(answer),
        Err(error) => protocol_error_response(error),
    }
}

/// The Router's answer from its wallet object's response to a registration
/// claim or finish.
fn router_wallet_answer_response(
    answer: crate::RouterWalletResponseV1,
) -> worker::Result<Response> {
    let result = match answer {
        crate::RouterWalletResponseV1::Answered { response_json } => {
            let response = Response::ok(response_json)?;
            response.headers().set("content-type", "application/json")?;
            return Ok(response);
        }
        crate::RouterWalletResponseV1::InProgress { retry_after_ms } => {
            RouterEd25519YaoExecuteResultV1::recoverable(
                router_ab_core::RouterEd25519YaoExecuteFailureCodeV1::ExecutionInProgress,
                retry_after_ms,
            )
        }
        crate::RouterWalletResponseV1::Mismatch => Ok(RouterEd25519YaoExecuteResultV1::rejected(
            router_ab_core::RouterEd25519YaoExecuteFailureCodeV1::ExecutionMismatch,
        )),
        _ => Err(invalid_coordinator(
            "Router wallet object answered a registration execute with another command's response",
        )),
    };
    match result {
        Ok(result) => Response::from_json(&result),
        Err(error) => protocol_error_response(error),
    }
}
