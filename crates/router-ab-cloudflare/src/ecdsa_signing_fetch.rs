use crate::*;

use crate::worker_route::{BodyRefusalV1, PathRefusalV1, PostRouteV1};

/// Handles SigningWorker's production Router A/B ECDSA derivation prepare route using the presignature pool.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_prepare_private_fetch_from_pool_v1(
    mut request: worker::Request,
    env: &worker::Env,
    now_unix_ms: u64,
) -> worker::Result<worker::Response> {
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    let mut timing = CloudflareEcdsaBoundaryTimingV1::new();
    let started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    const ROUTE: PostRouteV1 = PostRouteV1 {
        path: CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PATH,
        method_refusal: "Router A/B ECDSA derivation prepare route requires POST",
        path_refusal: PathRefusalV1::ServedAt("Router A/B ECDSA derivation prepare"),
        body_refusal: BodyRefusalV1::ParseFailed("Router A/B ECDSA derivation prepare"),
    };
    let parsed = match ROUTE
        .read::<CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1>(
            &mut request,
        )
        .await
    {
        Ok(parsed) => parsed,
        Err(response) => return response,
    };
    timing.mark("worker_prepare_request_body", started_at_ms);
    if let Err(err) = parsed.validate() {
        return crate::cloudflare_protocol_error_response_v1(&err);
    }
    let response = durable_object::call_signing_worker_wallet_do_v1(
        env,
        wallet_objects,
        durable_object::SigningWorkerWalletDoRequestV1::PrepareEcdsa {
            request: parsed,
            now_unix_ms,
        },
    )
    .await;
    timing.mark("worker_prepare_total", started_at_ms);
    timing.emit_io_diagnostic();
    match response {
        Ok(response) => Ok(response),
        Err(error) => cloudflare_signing_worker_presign_error_response_v1(error),
    }
}


/// Handles SigningWorker's private Router A/B ECDSA derivation normal-signing finalize route.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_private_fetch_v1<
    Handler,
>(
    request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    handler: &Handler,
    now_unix_ms: u64,
) -> worker::Result<worker::Response>
where
    Handler: CloudflareSigningWorkerRouterAbEcdsaDerivationEvmDigestFinalizeHandlerV1,
{
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    let mut timing = CloudflareEcdsaBoundaryTimingV1::new();
    let started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let result =
        finalize_ecdsa_signing(request, env, wallet_objects, runtime, handler, now_unix_ms, &mut timing).await;
    timing.mark("worker_finalize_total", started_at_ms);
    timing.emit_io_diagnostic();
    result
}

async fn finalize_ecdsa_signing<Handler>(
    mut request: worker::Request,
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    handler: &Handler,
    now_unix_ms: u64,
    timing: &mut CloudflareEcdsaBoundaryTimingV1,
) -> worker::Result<worker::Response>
where
    Handler: CloudflareSigningWorkerRouterAbEcdsaDerivationEvmDigestFinalizeHandlerV1,
{
    let body_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    const ROUTE: PostRouteV1 = PostRouteV1 {
        path: CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PATH,
        method_refusal: "Router A/B ECDSA derivation finalize route requires POST",
        path_refusal: PathRefusalV1::ServedAt("Router A/B ECDSA derivation finalize"),
        body_refusal: BodyRefusalV1::ParseFailed("Router A/B ECDSA derivation finalize"),
    };
    let parsed = match ROUTE
        .read::<CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1>(
            &mut request,
        )
        .await
    {
        Ok(parsed) => parsed,
        Err(response) => return response,
    };
    timing.mark("worker_finalize_request_body", body_started_at_ms);
    if let Err(err) = parsed.validate() {
        return crate::cloudflare_protocol_error_response_v1(&err);
    }
    let claim_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let claimed = prepare_ecdsa_finalize(env, wallet_objects, runtime, &parsed, now_unix_ms).await;
    timing.mark("worker_finalize_snapshot_claim", claim_started_at_ms);
    let (active_signing_worker, material, server_presignature) = match claimed {
        Ok(EcdsaFinalizePreparation::Claimed {
            active,
            material,
            presignature,
        }) => (active, material, presignature),
        Ok(EcdsaFinalizePreparation::Replay { terminal_json }) => {
            let response = match serde_json::from_str::<
                RouterAbEcdsaDerivationEvmDigestSigningResponseV1,
            >(&terminal_json)
            {
                Ok(response) => response,
                Err(error) => {
                    return worker::Response::error(
                        format!("SigningWorker ECDSA terminal response JSON is invalid: {error}"),
                        500,
                    );
                }
            };
            if let Err(error) = response.validate_for_request(&parsed.request) {
                return crate::cloudflare_protocol_error_response_v1(&error);
            }
            return worker::Response::from_json(&response);
        }
        Ok(EcdsaFinalizePreparation::InProgress) => {
            let error = RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                SIGNING_WORKER_ECDSA_EFFECT_IN_PROGRESS_V1,
            );
            return crate::cloudflare_protocol_error_response_v1(&error);
        }
        Ok(EcdsaFinalizePreparation::Burned) => {
            return worker::Response::error(
                "SigningWorker ECDSA reservation was terminally burned before finalization",
                cloudflare_router_error_status(RouterAbProtocolErrorCode::ReplayedLocalRequest),
            );
        }
        Err(error) => {
            return crate::cloudflare_protocol_error_response_v1(&error);
        }
    };
    if let Ok(flag) = env.var("R150_TEST_ECDSA_INTERRUPT_AFTER_CLAIM") {
        if flag.to_string() == "enabled" {
            return worker::Response::error("R150 test interrupted after ECDSA claim", 503);
        }
    }
    let expected_request = parsed.request.clone();
    let admitted_for_terminal = parsed.clone();
    let compute_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let signing_result =
        handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_private_request_v1(
            handler,
            now_unix_ms,
            parsed,
            active_signing_worker,
            material,
            server_presignature,
        );
    timing.mark("worker_finalize_compute", compute_started_at_ms);
    match signing_result {
        Ok(response) => {
            if let Err(error) = response.validate_for_request(&expected_request) {
                return crate::cloudflare_protocol_error_response_v1(&error);
            }
            let terminal_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
            let committed = commit_cloudflare_signing_worker_ecdsa_terminal_for_wallet_v1(
                env,
                wallet_objects,
                &admitted_for_terminal,
                &response,
                now_unix_ms,
            )
            .await;
            timing.mark("worker_finalize_terminal", terminal_started_at_ms);
            match committed {
                Ok(CloudflareSigningWorkerTerminalResponseCommitV1::Committed) => {
                    worker::Response::from_json(&response)
                }
                Ok(CloudflareSigningWorkerTerminalResponseCommitV1::Replay { response_json }) => {
                    let stored = serde_json::from_str::<
                        RouterAbEcdsaDerivationEvmDigestSigningResponseV1,
                    >(&response_json)
                    .map_err(|error| {
                        worker::Error::RustError(format!(
                            "SigningWorker ECDSA replay response is invalid: {error}"
                        ))
                    })?;
                    if let Err(error) = stored.validate_for_request(&expected_request) {
                        return crate::cloudflare_protocol_error_response_v1(&error);
                    }
                    worker::Response::from_json(&stored)
                }
                Err(error) => crate::cloudflare_protocol_error_response_v1(&error),
            }
        }
        Err(err) => crate::cloudflare_protocol_error_response_v1(&err),
    }
}

enum EcdsaFinalizePreparation {
    Claimed {
        active: ActiveSigningWorkerStateV1,
        material: CloudflareServerOutputMaterialRecordV1,
        presignature: CloudflareSigningWorkerEcdsaPresignatureRecordV1,
    },
    Replay {
        terminal_json: String,
    },
    InProgress,
    Burned,
}

async fn prepare_ecdsa_finalize(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    request: &CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<EcdsaFinalizePreparation> {
    let (active, material) = load_cloudflare_signing_worker_ecdsa_normal_signing_material_v1(
        env,
        runtime,
        &request.request.scope,
        &request.material_source,
        Some(crate::SigningWorkerWalletRoute { objects: wallet_objects, scope: &request.wallet_scope, ownership_generation: request.ownership_generation }),
        now_unix_ms,
    )
    .await?;
    let scope = &request.wallet_scope;
    let response = durable_object::call_signing_worker_wallet_do_v1(
        env,
        wallet_objects,
        durable_object::SigningWorkerWalletDoRequestV1::ClaimAndConsumeEcdsaEffect {
            scope: scope.clone(),
            request: request.clone(),
            now_unix_ms,
        },
    )
    .await?;
    let result = parse_cloudflare_signing_worker_wallet_do_json_response_v1(
        response,
        "SigningWorker wallet-DO ECDSA claim and consume",
    )
    .await?;
    return Ok(match result {
        CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Claimed {
            material: presignature,
        } => EcdsaFinalizePreparation::Claimed {
            active,
            material,
            presignature,
        },
        CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Replay { terminal_json } => {
            EcdsaFinalizePreparation::Replay { terminal_json }
        }
        CloudflareSigningWorkerEcdsaClaimAndConsumeV1::InProgress => {
            EcdsaFinalizePreparation::InProgress
        }
        CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Burned => {
            EcdsaFinalizePreparation::Burned
        }
    });
}
