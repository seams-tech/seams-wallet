use crate::*;

/// Handles SigningWorker's private normal-signing round-1 prepare route.
#[cfg(feature = "workers-rs")]
#[cfg(feature = "strict-worker-signing-worker-entrypoint")]
pub async fn handle_cloudflare_signing_worker_normal_signing_round1_prepare_private_fetch_v1<
    Handler,
>(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    handler: &Handler,
    now_unix_ms: u64,
) -> worker::Result<worker::Response>
where
    Handler: CloudflareSigningWorkerNormalSigningPrepareHandlerV2,
{
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "Router A/B normal-signing round-1 prepare route requires POST",
            405,
        );
    }
    if request.path() != CLOUDFLARE_SIGNING_WORKER_NORMAL_SIGNING_ROUND1_PREPARE_PATH {
        return worker::Response::error(
            format!(
                "Router A/B normal-signing round-1 prepare must be served at {}",
                CLOUDFLARE_SIGNING_WORKER_NORMAL_SIGNING_ROUND1_PREPARE_PATH
            ),
            404,
        );
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2>()
        .await
    {
        Ok(parsed) => parsed,
        Err(err) => {
            return worker::Response::error(
                format!("Router A/B normal-signing round-1 prepare JSON parse failed: {err}"),
                400,
            );
        }
    };
    if let Err(err) = parsed.validate() {
        return worker::Response::error(
            format!("{:?}: {}", err.code(), err.message()),
            cloudflare_router_error_status(err.code()),
        );
    }
    #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
    if matches!(
        &parsed.material_source,
        CloudflareSigningWorkerNormalSigningMaterialSourceV1::RegistrationActivation { .. }
    ) {
        let scope = parsed.wallet_scope.clone();
        return crate::durable_object::call_signing_worker_wallet_do_v1(
            env,
            wallet_objects,
            crate::durable_object::SigningWorkerWalletDoRequestV1::PrepareNear {
                scope,
                request: parsed,
                now_unix_ms,
            },
        )
        .await
        .map_err(|error| worker::Error::RustError(error.to_string()));
    }
    let (active_signing_worker, material) =
        match load_cloudflare_signing_worker_normal_signing_material_v1(
            env,
            runtime,
            &parsed.scope,
            &parsed.material_source,
            now_unix_ms,
        )
        .await
        {
            Ok(value) => value,
            Err(err) => {
                return worker::Response::error(
                    format!("{:?}: {}", err.code(), err.message()),
                    cloudflare_router_error_status(err.code()),
                );
            }
        };
    let prepared = match handle_cloudflare_signing_worker_normal_signing_prepare_private_request_v2(
        handler,
        now_unix_ms,
        parsed,
        active_signing_worker,
        material,
    ) {
        Ok(prepared) => prepared,
        Err(err) => {
            return worker::Response::error(
                format!("{:?}: {}", err.code(), err.message()),
                cloudflare_router_error_status(err.code()),
            );
        }
    };
    let put_call = match runtime.signing_worker_round1_put_request(prepared.record.clone()) {
        Ok(call) => call,
        Err(err) => {
            return worker::Response::error(
                format!("{:?}: {}", err.code(), err.message()),
                cloudflare_router_error_status(err.code()),
            );
        }
    };
    let put_response =
        match execute_cloudflare_signing_worker_private_d1_request_v1(env, &put_call).await {
            Ok(response) => response,
            Err(err) => {
                return worker::Response::error(
                    format!("{:?}: {}", err.code(), err.message()),
                    cloudflare_router_error_status(err.code()),
                );
            }
        };
    let put_receipt = match require_signing_worker_round1_put_response_v1(&put_call, put_response) {
        Ok(receipt) => receipt,
        Err(err) => {
            return worker::Response::error(
                format!("{:?}: {}", err.code(), err.message()),
                cloudflare_router_error_status(err.code()),
            );
        }
    };
    if !put_receipt.stored {
        return worker::Response::error(
            "SigningWorker round-1 prepare handle already exists",
            cloudflare_router_error_status(RouterAbProtocolErrorCode::ReplayedLocalRequest),
        );
    }
    worker::Response::from_json(&prepared.response)
}

/// Handles SigningWorker's private normal-signing route.
#[cfg(feature = "workers-rs")]
#[cfg(feature = "strict-worker-signing-worker-entrypoint")]
pub async fn handle_cloudflare_signing_worker_normal_signing_private_fetch_v1<Handler>(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    handler: &Handler,
    now_unix_ms: u64,
) -> worker::Result<worker::Response>
where
    Handler: CloudflareSigningWorkerNormalSigningFinalizeHandlerV2,
{
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    if request.method() != worker::Method::Post {
        return worker::Response::error("Router A/B normal-signing route requires POST", 405);
    }
    if request.path() != CLOUDFLARE_SIGNING_WORKER_NORMAL_SIGNING_PATH {
        return worker::Response::error(
            format!(
                "Router A/B normal-signing request must be served at {}",
                CLOUDFLARE_SIGNING_WORKER_NORMAL_SIGNING_PATH
            ),
            404,
        );
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2>()
        .await
    {
        Ok(parsed) => parsed,
        Err(err) => {
            return worker::Response::error(
                format!("Router A/B normal-signing request JSON parse failed: {err}"),
                400,
            );
        }
    };
    if let Err(err) = parsed.validate() {
        return worker::Response::error(
            format!("{:?}: {}", err.code(), err.message()),
            cloudflare_router_error_status(err.code()),
        );
    }
    #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
    if matches!(
        &parsed.material_source,
        CloudflareSigningWorkerNormalSigningMaterialSourceV1::RegistrationActivation { .. }
    ) {
        let scope = parsed.wallet_scope.clone();
        return crate::durable_object::call_signing_worker_wallet_do_v1(
            env,
            wallet_objects,
            crate::durable_object::SigningWorkerWalletDoRequestV1::FinalizeNear {
                scope,
                request: parsed,
                now_unix_ms,
            },
        )
        .await
        .map_err(|error| worker::Error::RustError(error.to_string()));
    }
    let effect_operation_key = match parsed.effect_operation_key() {
        Ok(value) => value,
        Err(err) => {
            return worker::Response::error(
                format!("{:?}: {}", err.code(), err.message()),
                cloudflare_router_error_status(err.code()),
            );
        }
    };
    let effect_request_digest = match parsed.effect_request_digest() {
        Ok(value) => value,
        Err(err) => {
            return worker::Response::error(
                format!("{:?}: {}", err.code(), err.message()),
                cloudflare_router_error_status(err.code()),
            );
        }
    };
    match replay_cloudflare_signing_worker_near_terminal_v1(env, &parsed).await {
        Ok(Some(terminal_json)) => {
            return match parse_cloudflare_signing_worker_normal_signing_terminal_v1(
                &parsed,
                &terminal_json,
            ) {
                Ok(terminal) => {
                    cloudflare_signing_worker_normal_signing_terminal_response_v1(terminal)
                }
                Err(error) => worker::Response::error(
                    format!("{:?}: {}", error.code(), error.message()),
                    cloudflare_router_error_status(error.code()),
                ),
            };
        }
        Ok(None) => {}
        Err(error) => {
            return worker::Response::error(
                format!("{:?}: {}", error.code(), error.message()),
                cloudflare_router_error_status(error.code()),
            );
        }
    }
    // Before expiry: a delayed request for a retired activation is refused as
    // retired, while a signature it already made answers above.
    if let CloudflareSigningWorkerNormalSigningMaterialSourceV1::RegistrationActivation { lookup } =
        &parsed.material_source
    {
        if let Err(error) =
            require_cloudflare_signing_worker_activation_not_retired_v1(env, lookup).await
        {
            return worker::Response::error(
                format!("{:?}: {}", error.code(), error.message()),
                cloudflare_router_error_status(error.code()),
            );
        }
    }
    if let Err(error) = parsed.request.validate_at(now_unix_ms) {
        return worker::Response::error(
            format!("{:?}: {}", error.code(), error.message()),
            cloudflare_router_error_status(error.code()),
        );
    }
    match claim_cloudflare_signing_worker_near_effect_v1(env, &parsed, now_unix_ms).await {
        Ok(CloudflareSigningWorkerNearEffectClaimV1::Claimed) => {}
        Ok(CloudflareSigningWorkerNearEffectClaimV1::Replay { terminal_json }) => {
            return match parse_cloudflare_signing_worker_normal_signing_terminal_v1(
                &parsed,
                &terminal_json,
            ) {
                Ok(terminal) => {
                    cloudflare_signing_worker_normal_signing_terminal_response_v1(terminal)
                }
                Err(error) => worker::Response::error(
                    format!("{:?}: {}", error.code(), error.message()),
                    cloudflare_router_error_status(error.code()),
                ),
            };
        }
        Ok(CloudflareSigningWorkerNearEffectClaimV1::InProgress) => {
            let error = RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "SigningWorker normal-signing effect is already in progress",
            );
            return worker::Response::error(
                format!("{:?}: {}", error.code(), error.message()),
                cloudflare_router_error_status(error.code()),
            );
        }
        Err(error) => {
            return worker::Response::error(
                format!("{:?}: {}", error.code(), error.message()),
                cloudflare_router_error_status(error.code()),
            );
        }
    }
    let terminal = CloudflareSigningWorkerNormalSigningTerminalV1::from_result(
        execute_claimed_cloudflare_signing_worker_normal_signing_v1(
            env,
            runtime,
            handler,
            now_unix_ms,
            parsed.clone(),
        )
        .await,
    );
    if let Err(error) = terminal.validate_for_request(&parsed) {
        return worker::Response::error(
            format!("{:?}: {}", error.code(), error.message()),
            cloudflare_router_error_status(error.code()),
        );
    }
    let terminal_json = match serde_json::to_string(&terminal) {
        Ok(value) => value,
        Err(error) => {
            return worker::Response::error(
                format!("SigningWorker terminal outcome serialization failed: {error}"),
                500,
            );
        }
    };
    // The terminal commits only while the activation that signed it is
    // unretired: a recovery may have promoted since the material loaded.
    let activation = match &parsed.material_source {
        CloudflareSigningWorkerNormalSigningMaterialSourceV1::RegistrationActivation { lookup } => {
            Some(lookup)
        }
        CloudflareSigningWorkerNormalSigningMaterialSourceV1::RotatableLane { .. } => None,
    };
    match commit_cloudflare_signing_worker_terminal_response_v1(
        env,
        &effect_operation_key,
        effect_request_digest,
        &terminal_json,
        now_unix_ms,
        activation,
    )
    .await
    {
        Ok(CloudflareSigningWorkerTerminalResponseCommitV1::Committed) => {
            cloudflare_signing_worker_normal_signing_terminal_response_v1(terminal)
        }
        Ok(CloudflareSigningWorkerTerminalResponseCommitV1::Replay { response_json }) => {
            match parse_cloudflare_signing_worker_normal_signing_terminal_v1(
                &parsed,
                &response_json,
            ) {
                Ok(terminal) => {
                    cloudflare_signing_worker_normal_signing_terminal_response_v1(terminal)
                }
                Err(error) => worker::Response::error(
                    format!("{:?}: {}", error.code(), error.message()),
                    cloudflare_router_error_status(error.code()),
                ),
            }
        }
        Err(err) => worker::Response::error(
            format!("{:?}: {}", err.code(), err.message()),
            cloudflare_router_error_status(err.code()),
        ),
    }
}

/// Sends one v2 normal-signing finalize request from Router to SigningWorker.
#[cfg(feature = "workers-rs")]
pub async fn execute_cloudflare_signing_worker_normal_signing_finalize_service_call_v2(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    peer: &CloudflarePeerBindingV1,
    request: CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
) -> RouterAbProtocolResult<NormalSigningResponseV1> {
    peer.validate()?;
    if peer.peer_role != CloudflareWorkerRoleV1::SigningWorker {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "normal-signing v2 finalize must target SigningWorker",
        ));
    }
    request.validate()?;
    let response: NormalSigningResponseV1 = post_service_json_with_server_timing(
        env,
        Some(wallet_objects),
        &peer.binding_name,
        &cloudflare_signing_worker_normal_signing_service_url(peer)?,
        "normal-signing v2 finalize",
        &request,
        None,
        CloudflareServiceAuthModeV1::Shared,
    )
    .await?
    .0;
    require_signing_worker_normal_signing_finalize_response_v2(&request, response)
}

/// Accepts a SigningWorker finalize response only for the admitted request.
pub fn require_signing_worker_normal_signing_finalize_response_v2(
    request: &CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    response: NormalSigningResponseV1,
) -> RouterAbProtocolResult<NormalSigningResponseV1> {
    response.validate()?;
    if response.scope == request.request.scope
        && response.signing_payload_digest == request.request.signing_payload_digest()
        && response.signature_scheme == request.request.protocol.signature_scheme()
    {
        return Ok(response);
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        "normal-signing v2 finalize response does not match admitted request",
    ))
}

/// Sends one v2 normal-signing prepare request from Router to SigningWorker.
#[cfg(feature = "workers-rs")]
pub async fn execute_cloudflare_signing_worker_normal_signing_prepare_service_call_v2(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    peer: &CloudflarePeerBindingV1,
    request: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
) -> RouterAbProtocolResult<NormalSigningRound1PrepareResponseV1> {
    peer.validate()?;
    if peer.peer_role != CloudflareWorkerRoleV1::SigningWorker {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "normal-signing v2 prepare must target SigningWorker",
        ));
    }
    request.validate()?;
    let response: NormalSigningRound1PrepareResponseV1 = post_service_json_with_server_timing(
        env,
        Some(wallet_objects),
        &peer.binding_name,
        &cloudflare_signing_worker_normal_signing_round1_prepare_service_url(peer)?,
        "normal-signing v2 prepare",
        &request,
        None,
        CloudflareServiceAuthModeV1::Shared,
    )
    .await?
    .0;
    require_signing_worker_normal_signing_prepare_response_v2(&request, response)
}

/// SigningWorker's owner check for NEAR signing: the Router-pinned wallet
/// scope must be the scope the wallet was registered under, and must agree
/// with the trusted admission for the signing wallet.
pub fn require_signing_worker_normal_signing_wallet_scope_v1(
    registered: &CloudflareSigningWorkerWalletScopeV1,
    pinned: &CloudflareSigningWorkerWalletScopeV1,
    metadata: &CloudflareRouterNormalSigningTrustedMetadataV1,
    wallet_id: &str,
) -> RouterAbProtocolResult<()> {
    registered.validate()?;
    metadata.validate()?;
    if pinned != registered {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "SigningWorker normal-signing wallet scope differs from the registered wallet",
        ));
    }
    if registered.org_id != metadata.org_id
        || registered.project_id != metadata.project_id
        || registered.wallet_id != wallet_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "SigningWorker wallet scope differs from trusted admission",
        ));
    }
    Ok(())
}

/// Accepts a SigningWorker prepare response only for the admitted request.
pub fn require_signing_worker_normal_signing_prepare_response_v2(
    request: &CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
    response: NormalSigningRound1PrepareResponseV1,
) -> RouterAbProtocolResult<NormalSigningRound1PrepareResponseV1> {
    response.validate()?;
    if response.scope == request.scope
        && response.signing_payload_digest == request.admission_candidate.signing_payload_digest
        && response.round1_binding_digest == request.round1_binding_digest()?
        && response.expires_at_ms == request.expires_at_ms
    {
        return Ok(response);
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        "normal-signing v2 prepare response does not match admitted request",
    ))
}
