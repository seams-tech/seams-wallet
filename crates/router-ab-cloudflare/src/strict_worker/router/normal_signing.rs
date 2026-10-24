use super::*;

#[cfg(feature = "strict-worker-router-entrypoint")]
pub(super) async fn execute_strict_router_normal_signing_request_v1(
    parsed: StrictRouterNormalSigningRequestV1,
    request: &Request,
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    trusted_source_digest: PublicDigest32,
    verifier: CloudflareRouterEd25519JwksJwtVerifierV1,
) -> worker::Result<Response> {
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    let mut timing = CloudflareBoundaryTimingV1::with_trace_id(
        parse_cloudflare_trace_id_from_request_v1(request)
            .ok()
            .flatten(),
    );
    let operation_step_up = parsed.is_operation_step_up();
    let gateway_linked_device_wallet_session = parsed.is_gateway_linked_device_wallet_session();
    match parsed {
        StrictRouterNormalSigningRequestV1::Ed25519Prepare {
            request: signing_request,
            authorized_operation,
        } if gateway_linked_device_wallet_session => {
            let response =
                handle_cloudflare_router_normal_signing_prepare_internal_linked_device_request_v2(
                    env,
                    wallet_objects,
                    &mut timing,
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    trusted_source_digest,
                )
                .await;
            router_timed_json_cors_response_v1(response, &timing, request, env)
        }
        StrictRouterNormalSigningRequestV1::Ed25519Prepare {
            request: signing_request,
            authorized_operation,
        } if operation_step_up => {
            let response =
                handle_cloudflare_router_normal_signing_prepare_internal_step_up_request_v2(
                    env,
                    wallet_objects,
                    &mut timing,
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    trusted_source_digest,
                )
                .await;
            router_timed_json_cors_response_v1(response, &timing, request, env)
        }
        StrictRouterNormalSigningRequestV1::Ed25519Prepare {
            request: signing_request,
            authorized_operation,
        } => {
            let credential = match authorized_operation
                .gateway_owner_wallet_session_credential(trusted_source_digest)
            {
                Ok(credential) => credential,
                Err(err) => {
                    return router_json_cors_response_v1::<serde_json::Value>(
                        Err(err),
                        request,
                        env,
                    )
                }
            };
            let response =
                handle_cloudflare_router_normal_signing_prepare_authenticated_public_request_v2(
                    env,
                    wallet_objects,
                    &mut timing,
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    credential,
                    trusted_source_digest,
                    verifier,
                )
                .await;
            router_timed_json_cors_response_v1(response, &timing, request, env)
        }
        StrictRouterNormalSigningRequestV1::Ed25519Finalize {
            request: signing_request,
            authorized_operation,
        } if gateway_linked_device_wallet_session => {
            let response =
                handle_cloudflare_router_normal_signing_finalize_internal_linked_device_request_v2(
                    env,
                    wallet_objects,
                    &mut timing,
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    trusted_source_digest,
                )
                .await;
            router_timed_json_cors_response_v1(response, &timing, request, env)
        }
        StrictRouterNormalSigningRequestV1::Ed25519Finalize {
            request: signing_request,
            authorized_operation,
        } if operation_step_up => {
            let response =
                handle_cloudflare_router_normal_signing_finalize_internal_step_up_request_v2(
                    env,
                    wallet_objects,
                    &mut timing,
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    trusted_source_digest,
                )
                .await;
            router_timed_json_cors_response_v1(response, &timing, request, env)
        }
        StrictRouterNormalSigningRequestV1::Ed25519Finalize {
            request: signing_request,
            authorized_operation,
        } => {
            let credential = match authorized_operation
                .gateway_owner_wallet_session_credential(trusted_source_digest)
            {
                Ok(credential) => credential,
                Err(err) => {
                    return router_json_cors_response_v1::<serde_json::Value>(
                        Err(err),
                        request,
                        env,
                    )
                }
            };
            let response =
                handle_cloudflare_router_normal_signing_finalize_authenticated_public_request_v2(
                    env,
                    wallet_objects,
                    &mut timing,
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    credential,
                    trusted_source_digest,
                    verifier,
                )
                .await;
            router_timed_json_cors_response_v1(response, &timing, request, env)
        }
        StrictRouterNormalSigningRequestV1::EcdsaPrepare {
            request: signing_request,
            presign_source,
            authorized_operation,
        } if operation_step_up => {
            let response = handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_prepare_internal_step_up_request_v1(
                env,
                wallet_objects,
                runtime,
                now_unix_ms,
                signing_request,
                authorized_operation,
                presign_source,
                trusted_source_digest,
            )
            .await;
            router_timed_json_cors_response_v1(response, &timing, request, env)
        }
        StrictRouterNormalSigningRequestV1::EcdsaPrepare {
            request: signing_request,
            presign_source,
            authorized_operation,
        } => {
            let credential = match authorized_operation
                .gateway_owner_wallet_session_credential(trusted_source_digest)
            {
                Ok(credential) => credential,
                Err(err) => {
                    return router_json_cors_response_v1::<serde_json::Value>(
                        Err(err),
                        request,
                        env,
                    )
                }
            };
            let response = handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_prepare_authenticated_public_request_v1(
                env,
                wallet_objects,
                runtime,
                now_unix_ms,
                signing_request,
                authorized_operation,
                presign_source,
                credential,
                trusted_source_digest,
                verifier,
            )
            .await;
            router_timed_json_cors_response_v1(response, &timing, request, env)
        }
        StrictRouterNormalSigningRequestV1::EcdsaFinalize {
            request: signing_request,
            authorized_operation,
        } if operation_step_up => {
            let response = handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_finalize_internal_step_up_request_v1(
                env,
                wallet_objects,
                runtime,
                now_unix_ms,
                signing_request,
                authorized_operation,
                trusted_source_digest,
            )
            .await;
            router_timed_json_cors_response_v1(response, &timing, request, env)
        }
        StrictRouterNormalSigningRequestV1::EcdsaFinalize {
            request: signing_request,
            authorized_operation,
        } => {
            let credential = match authorized_operation
                .gateway_owner_wallet_session_credential(trusted_source_digest)
            {
                Ok(credential) => credential,
                Err(err) => {
                    return router_json_cors_response_v1::<serde_json::Value>(
                        Err(err),
                        request,
                        env,
                    )
                }
            };
            let response = handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_finalize_authenticated_public_request_v1(
                env,
                wallet_objects,
                runtime,
                now_unix_ms,
                signing_request,
                authorized_operation,
                credential,
                trusted_source_digest,
                verifier,
            )
            .await;
            router_timed_json_cors_response_v1(response, &timing, request, env)
        }
    }
}
