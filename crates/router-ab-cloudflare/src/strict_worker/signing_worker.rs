use super::*;

#[cfg(feature = "strict-worker-signing-worker-entrypoint")]
pub(super) async fn handle_strict_signing_worker_fetch_v1(
    request: Request,
    env: Env,
    ctx: Context,
) -> worker::Result<Response> {
    let path = request.path();
    let auth = if path
        == CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_INIT_PATH
        || path
            == CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_PRESIGNATURE_SESSION_STEP_PATH
    {
        require_cloudflare_gateway_to_signing_worker_presign_auth_request_v1(&request, &env)
    } else if path == crate::SIGNING_WORKER_RELOCATION_CONTEXT_PATH_V1
        || path == crate::SIGNING_WORKER_ED25519_SNAPSHOT_PATH_V1
        || path == crate::SIGNING_WORKER_ED25519_SETTLE_PATH_V1
        || path == crate::SIGNING_WORKER_ED25519_FENCE_PATH_V1
        || path == crate::SIGNING_WORKER_POOL_FREEZE_PATH_V1
        || path == crate::durable_object::presign_session_relocation::FENCE_PATH
        || path == crate::durable_object::presign_session_relocation::FREEZE_PATH
        || path == crate::durable_object::presign_session_relocation::EXPORT_PATH
        || path == crate::durable_object::presign_session_relocation::import::PATH
        || path == crate::SIGNING_WORKER_ECDSA_EXPORT_PATH_V1
        || path == crate::SIGNING_WORKER_LINKED_PRESIGN_INVENTORY_PATH_V1
        || path == crate::SIGNING_WORKER_LINKED_PRESIGN_PREPARATION_INVENTORY_PATH_V1
        || path == crate::SIGNING_WORKER_ECDSA_TRANSFER_PATH_V1
        || path == CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PATH
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
        crate::SIGNING_WORKER_RELOCATION_CONTEXT_PATH_V1 => {
            if request.method() != Method::Post {
                return Response::error("SigningWorker relocation context requires POST", 405);
            }
            let mut request = request;
            if let Err(error) = crate::durable_object::tenant_root_creation::decode_bounded_json_request::<crate::SigningWorkerRelocationContextRequestV1>(&mut request, 8192).await {
                return cloudflare_protocol_error_response_v1(error);
            }
            match crate::signing_worker_relocation_context_v1(&crate::CloudflareWorkerEnvReaderV1::new(&env)) {
                Ok(context) => Response::from_json(&context),
                Err(error) => cloudflare_protocol_error_response_v1(error),
            }
        }
        #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
        crate::SIGNING_WORKER_LINKED_PRESIGN_PREPARATION_INVENTORY_PATH_V1 => {
            if request.method() != Method::Post {
                return Response::error("Linked presign preparation inventory requires POST", 405);
            }
            let mut request = request;
            let command = match crate::durable_object::tenant_root_creation::decode_bounded_json_request::<crate::SigningWorkerLinkedPresignPreparationInventoryRequestV1>(
                &mut request, 8192,
            ).await {
                Ok(command) => command,
                Err(error) => return cloudflare_protocol_error_response_v1(error),
            };
            match crate::durable_object::call_signing_worker_wallet_do_v1(&env,
                crate::durable_object::SigningWorkerWalletDoRequestV1::ListPreparingLinkedPresignSessions(command)).await {
                Ok(response) => Ok(response),
                Err(error) => cloudflare_protocol_error_response_v1(error),
            }
        }
        #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
        crate::SIGNING_WORKER_LINKED_PRESIGN_INVENTORY_PATH_V1 => {
            if request.method() != Method::Post {
                return Response::error("Linked presign inventory requires POST", 405);
            }
            let mut request = request;
            let command = match request.json::<crate::SigningWorkerLinkedPresignInventoryRequestV1>().await {
                Ok(command) => command,
                Err(_) => return Response::error("Linked presign inventory request is malformed", 400),
            };
            match crate::durable_object::call_signing_worker_wallet_do_v1(&env,
                crate::durable_object::SigningWorkerWalletDoRequestV1::ListLinkedPresignSessions(command)).await {
                Ok(response) => Ok(response),
                Err(error) => cloudflare_protocol_error_response_v1(error),
            }
        }
        crate::durable_object::presign_session_relocation::import::PATH => {
            crate::durable_object::presign_session_relocation::import::forward(request, &env, &runtime).await
        }
        crate::durable_object::presign_session_relocation::EXPORT_PATH => {
            crate::durable_object::presign_session_relocation::forward_export(request, &env, &runtime).await
        }
        crate::durable_object::presign_session_relocation::FREEZE_PATH => {
            crate::durable_object::presign_session_relocation::forward_freeze(request, &env, &runtime).await
        }
        crate::durable_object::presign_session_relocation::FENCE_PATH => {
            crate::durable_object::presign_session_relocation::forward_fence(request, &env, &runtime).await
        }
        #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
        crate::SIGNING_WORKER_ECDSA_TRANSFER_PATH_V1 => {
            if request.method() != Method::Post {
                return Response::error("ECDSA transfer requires POST", 405);
            }
            let mut request = request;
            let command = match request.json::<crate::SigningWorkerEcdsaTransferRequestV1>().await {
                Ok(command) => command,
                Err(_) => return Response::error("ECDSA transfer request is malformed", 400),
            };
            match crate::durable_object::call_signing_worker_wallet_do_v1(
                &env,
                crate::durable_object::SigningWorkerWalletDoRequestV1::TransferEcdsaSnapshot(command),
            ).await {
                Ok(response) => Ok(response),
                Err(error) => cloudflare_protocol_error_response_v1(error),
            }
        }
        #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
        crate::SIGNING_WORKER_ECDSA_EXPORT_PATH_V1 => {
            if request.method() != Method::Post {
                return Response::error("ECDSA export requires POST", 405);
            }
            let mut request = request;
            let command = match request.json::<crate::SigningWorkerEcdsaExportRequestV1>().await {
                Ok(command) => command,
                Err(_) => return Response::error("ECDSA export request is malformed", 400),
            };
            match crate::durable_object::call_signing_worker_wallet_do_v1(
                &env,
                crate::durable_object::SigningWorkerWalletDoRequestV1::ExportEcdsaSnapshot(command),
            ).await {
                Ok(response) => Ok(response),
                Err(error) => cloudflare_protocol_error_response_v1(error),
            }
        }
        #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
        crate::SIGNING_WORKER_ED25519_SNAPSHOT_PATH_V1 => {
            if request.method() != Method::Post {
                return Response::error("Ed25519 snapshot requires POST", 405);
            }
            let mut request = request;
            let request = match request.json::<crate::SigningWorkerEd25519SnapshotCommandV1>().await {
                Ok(request) => request,
                Err(_) => return Response::error("Ed25519 snapshot request is malformed", 400),
            };
            match crate::durable_object::call_signing_worker_wallet_do_v1(&env,
                crate::durable_object::SigningWorkerWalletDoRequestV1::Ed25519Snapshot { request }).await {
                Ok(response) => Ok(response),
                Err(error) => cloudflare_protocol_error_response_v1(error),
            }
        }
        #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
        crate::SIGNING_WORKER_ED25519_FENCE_PATH_V1 | crate::SIGNING_WORKER_ED25519_SETTLE_PATH_V1 => {
            if request.method() != Method::Post {
                return Response::error("Ed25519 fence requires POST", 405);
            }
            let mut request = request;
            let command = match request.json::<crate::SigningWorkerEd25519FenceCommandV1>().await {
                Ok(command) => command,
                Err(_) => return Response::error("Ed25519 fence request is malformed", 400),
            };
            let request = if path == crate::SIGNING_WORKER_ED25519_SETTLE_PATH_V1 {
                crate::durable_object::SigningWorkerWalletDoRequestV1::SettleEd25519(command)
            } else {
                crate::durable_object::SigningWorkerWalletDoRequestV1::FenceEd25519(command)
            };
            match crate::durable_object::call_signing_worker_wallet_do_v1(&env, request).await {
                Ok(response) => Ok(response),
                Err(error) => cloudflare_protocol_error_response_v1(error),
            }
        }
        #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
        crate::SIGNING_WORKER_POOL_FREEZE_PATH_V1 => {
            if request.method() != Method::Post {
                return Response::error("Pool freeze requires POST", 405);
            }
            let mut request = request;
            let command = match request.json::<crate::SigningWorkerPoolFreezeCommandV1>().await {
                Ok(command) => command,
                Err(_) => return Response::error("Pool freeze request is malformed", 400),
            };
            match crate::durable_object::call_signing_worker_wallet_do_v1(&env,
                crate::durable_object::SigningWorkerWalletDoRequestV1::FreezeEcdsaPool(command)).await {
                Ok(response) => Ok(response),
                Err(error) => cloudflare_protocol_error_response_v1(error),
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
                request, &env, &runtime, &ctx,
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
