use super::*;

#[cfg(feature = "strict-worker-signing-worker-entrypoint")]
pub(super) async fn handle_strict_signing_worker_fetch_v1(
    request: Request,
    env: Env,
) -> worker::Result<Response> {
    let path = request.path();
    let auth = if path
        == CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_INIT_PATH
        || path
            == CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_STEP_PATH
        || local_intended_gateway_path(&path)
    {
        require_cloudflare_gateway_to_signing_worker_presign_auth_request_v1(&request, &env)
    } else if path == CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PATH
        || path == CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PATH
        || path == CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PATH
    {
        require_cloudflare_router_to_signing_worker_ecdsa_auth_request_v1(&request, &env)
    } else {
        require_cloudflare_internal_service_auth_request_v1(&request, &env)
    };
    if let Err(err) = auth {
        return cloudflare_private_service_auth_error_response_v1(err);
    }
    if path == CLOUDFLARE_INTERNAL_PREWARM_PATH {
        if request.method() != Method::Post {
            return cloudflare_prewarm_response_v1(&request);
        }
        if let Err(err) = CloudflareSigningWorkerRuntimeV1::from_worker_env(&env) {
            return cloudflare_protocol_error_response_v1(err);
        }
        return cloudflare_prewarm_response_v1(&request);
    }
    let runtime = match CloudflareSigningWorkerRuntimeV1::from_worker_env(&env) {
        Ok(runtime) => runtime,
        Err(err) => return cloudflare_protocol_error_response_v1(err),
    };
    match path.as_str() {
        #[cfg(feature = "local-intended-signing-hold")]
        crate::CLOUDFLARE_SIGNING_WORKER_LOCAL_INTENDED_HOLD_PATH => {
            match crate::handle_cloudflare_signing_worker_local_intended_hold_v1(request, &env).await
            {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_PACKAGES_PATH => {
            match handle_cloudflare_signing_worker_ed25519_yao_packages_v1(request, &env).await {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_INITIAL_REGISTRATION_FINALIZATION_LOOKUP_PATH => {
            if request.method() != Method::Post {
                return Response::error(
                    "initial-registration finalization lookup requires POST",
                    405,
                );
            }
            match handle_cloudflare_signing_worker_ed25519_yao_initial_registration_finalization_lookup_v1(
                request, &env,
            )
            .await
            {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RESERVE_INACTIVE_PATH => {
            match handle_cloudflare_signing_worker_ed25519_yao_reserve_inactive_v1(request, &env)
                .await
            {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RESERVE_INACTIVE_SOURCE_PRESERVING_PATH => {
            match handle_cloudflare_signing_worker_ed25519_yao_reserve_inactive_source_preserving_v1(
                request, &env,
            )
            .await
            {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_ACTIVATE_RESERVATION_PATH => {
            match handle_cloudflare_signing_worker_ed25519_yao_activate_reservation_v1(request, &env)
                .await
            {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_DEACTIVATE_RESERVATION_PATH => {
            match handle_cloudflare_signing_worker_ed25519_yao_deactivate_reservation_v1(
                request, &env,
            )
            .await
            {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_ECDSA_RESERVE_INACTIVE_PATH => {
            match handle_cloudflare_signing_worker_ecdsa_reserve_inactive_v1(request, &env).await {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_ECDSA_RESERVE_INACTIVE_SOURCE_PRESERVING_PATH => {
            match handle_cloudflare_signing_worker_ecdsa_reserve_inactive_source_preserving_v1(
                request, &env,
            )
            .await
            {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_ECDSA_ACTIVATE_RESERVATION_PATH => {
            match handle_cloudflare_signing_worker_ecdsa_activate_reservation_v1(
                request, &env, &runtime,
            )
            .await
            {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_ECDSA_DEACTIVATE_RESERVATION_PATH => {
            match handle_cloudflare_signing_worker_ecdsa_deactivate_reservation_v1(request, &env)
                .await
            {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RECOVERY_PROMOTE_PATH => {
            match handle_cloudflare_signing_worker_ed25519_yao_recovery_promote_v1(
                request, &env,
            )
            .await
            {
                Ok(response) => Ok(response),
                Err(err) => cloudflare_protocol_error_response_v1(err),
            }
        }
        CLOUDFLARE_SIGNING_WORKER_LANE_MATERIAL_COMMAND_PATH => {
            handle_cloudflare_signing_worker_lane_material_command_private_fetch_v1(request, &env)
                .await
        }
        CLOUDFLARE_SIGNING_WORKER_ECDSA_LANE_EXECUTE_PATH => {
            handle_cloudflare_signing_worker_ecdsa_lane_execute_private_fetch_v1(
                request, &env, &runtime,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ECDSA_LANE_ACTIVATE_PATH => {
            handle_cloudflare_signing_worker_ecdsa_lane_activate_private_fetch_v1(
                request, &env, &runtime,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_LANE_ACTIVATE_PATH => {
            handle_cloudflare_signing_worker_ed25519_lane_activate_private_fetch_v1(
                request, &env, &runtime,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_LANE_RETIRE_PATH => {
            handle_cloudflare_signing_worker_ed25519_lane_retire_private_fetch_v1(request, &env)
                .await
        }
        CLOUDFLARE_SIGNING_WORKER_ECDSA_LANE_RETIRE_PATH => {
            handle_cloudflare_signing_worker_ecdsa_lane_retire_private_fetch_v1(request, &env)
                .await
        }
        CLOUDFLARE_SIGNING_WORKER_PROOF_BUNDLE_ACTIVATION_PATH => {
            handle_cloudflare_signing_worker_recipient_proof_bundle_activation_fetch_v1(
                request, &env, &runtime,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PATH => {
            handle_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_fetch_v1(
                request, &env, &runtime,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_REFRESH_PATH => {
            handle_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_refresh_fetch_v1(
                request, &env, &runtime,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_SHARE_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            handle_cloudflare_signing_worker_ecdsa_export_share_private_fetch_v1(
                request,
                &env,
                &runtime,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_LINKED_ECDSA_EXPORT_SHARE_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            handle_cloudflare_signing_worker_linked_ecdsa_export_share_private_fetch_v1(
                request,
                &env,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PREFLIGHT_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            handle_cloudflare_signing_worker_ecdsa_export_preflight_private_fetch_v1(
                request,
                &env,
                &runtime,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_NORMAL_SIGNING_ROUND1_PREPARE_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            let handler = CloudflareEd25519YaoNormalSigningHandlerV1;
            handle_cloudflare_signing_worker_normal_signing_round1_prepare_private_fetch_v1(
                request,
                &env,
                &runtime,
                &handler,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_NORMAL_SIGNING_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            let handler = CloudflareEd25519YaoNormalSigningHandlerV1;
            handle_cloudflare_signing_worker_normal_signing_private_fetch_v1(
                request,
                &env,
                &runtime,
                &handler,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_PUT_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_presignature_pool_put_private_fetch_v1(
                request,
                &env,
                &runtime,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_INIT_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            handle_cloudflare_signing_worker_ecdsa_presign_session_init_private_fetch_v1(
                request,
                &env,
                &runtime,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_STEP_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            handle_cloudflare_signing_worker_ecdsa_presign_session_step_private_fetch_v1(
                request,
                &env,
                &runtime,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_LINKED_PRESIGNATURE_SESSION_INIT_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            handle_cloudflare_signing_worker_linked_ecdsa_presign_session_init_private_fetch_v1(
                request,
                &env,
                &runtime,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_LINKED_PRESIGNATURE_SESSION_STEP_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            handle_cloudflare_signing_worker_linked_ecdsa_presign_session_step_private_fetch_v1(
                request,
                &env,
                &runtime,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_LINKED_SIGNING_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            let handler = CloudflareRoleSeparatedRouterAbEcdsaDerivationEvmDigestFinalizeHandlerV1;
            handle_cloudflare_signing_worker_linked_ecdsa_finalize_private_fetch_v1(
                request,
                &env,
                &runtime,
                &handler,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_prepare_private_fetch_from_pool_v1(
                request,
                &env,
                &runtime,
                now_unix_ms,
            )
            .await
        }
        CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PATH => {
            let now_unix_ms = match cloudflare_now_unix_ms_v1() {
                Ok(now_unix_ms) => now_unix_ms,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
            let handler = CloudflareRoleSeparatedRouterAbEcdsaDerivationEvmDigestFinalizeHandlerV1;
            handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_private_fetch_v1(
                request,
                &env,
                &runtime,
                &handler,
                now_unix_ms,
            )
            .await
        }
        _ => Response::error(
            format!(
                "SigningWorker strict Worker route must be served at {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, or {}",
                CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_PACKAGES_PATH,
                CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RECOVERY_PROMOTE_PATH,
                CLOUDFLARE_SIGNING_WORKER_LANE_MATERIAL_COMMAND_PATH,
                CLOUDFLARE_SIGNING_WORKER_PROOF_BUNDLE_ACTIVATION_PATH,
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PATH,
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_REFRESH_PATH,
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_SHARE_PATH,
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PREFLIGHT_PATH,
                CLOUDFLARE_SIGNING_WORKER_NORMAL_SIGNING_ROUND1_PREPARE_PATH,
                CLOUDFLARE_SIGNING_WORKER_NORMAL_SIGNING_PATH,
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_POOL_PUT_PATH,
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_INIT_PATH,
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_STEP_PATH,
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PATH,
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PATH,
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_LINKED_SIGNING_PATH
            ),
            404,
        ),
    }
}

/// A local-only route the local Gateway calls with its own credential.
#[cfg(feature = "strict-worker-signing-worker-entrypoint")]
fn local_intended_gateway_path(path: &str) -> bool {
    #[cfg(feature = "local-intended-signing-hold")]
    if path == crate::CLOUDFLARE_SIGNING_WORKER_LOCAL_INTENDED_HOLD_PATH {
        return true;
    }
    let _ = path;
    false
}
