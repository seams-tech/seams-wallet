use crate::*;

/// Handles SigningWorker's production Router A/B ECDSA derivation prepare route using the presignature pool.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_prepare_private_fetch_from_pool_v1(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    now_unix_ms: u64,
) -> worker::Result<worker::Response> {
    let mut timing = CloudflareEcdsaBoundaryTimingV1::new();
    let started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "Router A/B ECDSA derivation prepare route requires POST",
            405,
        );
    }
    if request.path() != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PATH {
        return worker::Response::error(
            format!(
                "Router A/B ECDSA derivation prepare must be served at {}",
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PATH
            ),
            404,
        );
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1>()
        .await
    {
        Ok(parsed) => parsed,
        Err(err) => {
            return worker::Response::error(
                format!("Router A/B ECDSA derivation prepare JSON parse failed: {err}"),
                400,
            );
        }
    };
    timing.mark("worker_prepare_request_body", started_at_ms);
    if let Err(err) = parsed.validate() {
        return worker::Response::error(
            format!("{:?}: {}", err.code(), err.message()),
            cloudflare_router_error_status(err.code()),
        );
    }
    #[cfg(feature = "wallet-do-signing-worker-harness")]
    {
        let response = durable_object::call_signing_worker_wallet_do_v1(
            env,
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
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    {
        let client_presignature_id = parsed.request.client_presignature_id.clone();
        let material_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
        let (active_signing_worker, material) =
            match load_cloudflare_signing_worker_ecdsa_normal_signing_material_v1(
                env,
                runtime,
                &parsed.request.scope,
                &parsed.material_source,
                Some(&parsed.wallet_scope),
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
        timing.mark("worker_prepare_material", material_started_at_ms);
        let materialized =
        match CloudflareSigningWorkerMaterializedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
            parsed,
            active_signing_worker.clone(),
            material,
            now_unix_ms,
        ) {
            Ok(materialized) => materialized,
            Err(err) => {
                return worker::Response::error(
                    format!("{:?}: {}", err.code(), err.message()),
                    cloudflare_router_error_status(err.code()),
                );
            }
        };
        let signing_worker_rerandomization_contribution32_b64u =
            match cloudflare_random_bytes_v1(32) {
                Ok(bytes) => encode_base64url_bytes_v1(&bytes),
                Err(err) => {
                    return worker::Response::error(
                        format!("{:?}: {}", err.code(), err.message()),
                        cloudflare_router_error_status(err.code()),
                    );
                }
            };
        let prepare_request_digest = match materialized.request.request.request_digest() {
            Ok(digest) => digest,
            Err(err) => {
                return worker::Response::error(
                    format!("{:?}: {}", err.code(), err.message()),
                    cloudflare_router_error_status(err.code()),
                );
            }
        };
        let signing_digest = match materialized.request.request.signing_digest() {
            Ok(digest) => digest,
            Err(err) => {
                return worker::Response::error(
                    format!("{:?}: {}", err.code(), err.message()),
                    cloudflare_router_error_status(err.code()),
                );
            }
        };
        let (reserve_command, final_messages, reserved_at_ms) =
            match &materialized.request.presign_source {
                CloudflareEcdsaPrepareSourceV1::AvailablePool => {
                    let command = CloudflareSigningWorkerEcdsaPoolCommandV1::Reserve {
                        scope: materialized.request.request.scope.clone(),
                        server_presignature_id: client_presignature_id.clone(),
                        expected_revision: 0,
                        request_digest: prepare_request_digest,
                        admitted_signing_digest: signing_digest,
                        signing_worker_rerandomization_contribution32_b64u,
                        reserved_at_ms: now_unix_ms,
                        request_expires_at_ms: materialized.request.request.expires_at_ms,
                    };
                    (command, None, now_unix_ms)
                }
                CloudflareEcdsaPrepareSourceV1::FinalPresignBatch { batch } => {
                    if let Err(error) = batch.validate_at(now_unix_ms) {
                        return cloudflare_signing_worker_presign_error_response_v1(error);
                    }
                    let progress =
                        match durable_object::execute_cloudflare_durable_object_custom_json_call_v1(
                            env,
                            &runtime.bindings().presign_session,
                            CLOUDFLARE_SIGNING_WORKER_ECDSA_PRESIGN_SESSION_DO_STEP_PATH,
                            &batch.presign_session_id,
                            batch,
                        )
                        .await
                        {
                            Ok(progress) => progress,
                            Err(error) => {
                                return cloudflare_signing_worker_presign_error_response_v1(error)
                            }
                        };
                    let CloudflareSigningWorkerEcdsaPresignSessionDoProgressV1::Complete {
                        authority: _,
                        pool_put_request,
                        outgoing_messages_b64u,
                    } = progress
                    else {
                        return worker::Response::error(
                            "Signing prepare requires the final presign batch",
                            409,
                        );
                    };
                    if pool_put_request.scope != materialized.request.request.scope
                        || pool_put_request.server_presignature_id != client_presignature_id
                    {
                        return worker::Response::error(
                            "Completed presign identity does not match admitted prepare",
                            409,
                        );
                    }
                    let reserved_at_ms = match cloudflare_now_unix_ms_v1() {
                        Ok(now) => now,
                        Err(error) => {
                            return cloudflare_signing_worker_presign_error_response_v1(error)
                        }
                    };
                    let record = match pool_put_request.to_pool_record(
                        active_signing_worker,
                        &materialized.material,
                        reserved_at_ms,
                    ) {
                        Ok(record) => record,
                        Err(error) => {
                            return cloudflare_signing_worker_presign_error_response_v1(error)
                        }
                    };
                    (
                        CloudflareSigningWorkerEcdsaPoolCommandV1::PutReserved {
                            material: record,
                            request_digest: prepare_request_digest,
                            admitted_signing_digest: signing_digest,
                            signing_worker_rerandomization_contribution32_b64u,
                            reserved_at_ms,
                            request_expires_at_ms: materialized.request.request.expires_at_ms,
                        },
                        Some(outgoing_messages_b64u),
                        reserved_at_ms,
                    )
                }
            };
        let reserve_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
        let reserve_outcome =
            match execute_cloudflare_signing_worker_ecdsa_pool_mutation_for_wallet_v1(
                env,
                runtime,
                Some(&materialized.request.wallet_scope),
                reserve_command,
            )
            .await
            {
                Ok(outcome) => outcome,
                Err(err) => {
                    return worker::Response::error(
                        format!("{:?}: {}", err.code(), err.message()),
                        cloudflare_router_error_status(err.code()),
                    );
                }
            };
        timing.mark("worker_prepare_reserve", reserve_started_at_ms);
        let CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Reserved { record } =
            reserve_outcome
        else {
            return worker::Response::error(
                "SigningWorker ECDSA pool reserve returned the wrong lifecycle outcome",
                cloudflare_router_error_status(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                ),
            );
        };
        let reserved_material = match record.reserved_material() {
            Ok(material) => material.clone(),
            Err(err) => {
                return burn_cloudflare_signing_worker_ecdsa_reservation_after_prepare_failure_v1(
                    env,
                    runtime,
                    Some(&materialized.request.wallet_scope),
                    materialized.request.request.scope.clone(),
                    client_presignature_id.clone(),
                    prepare_request_digest,
                    reserved_at_ms,
                    err,
                )
                .await;
            }
        };
        let response =
            match RouterAbEcdsaDerivationEvmDigestSigningPrepareResponseV1::new_for_request(
                &materialized.request.request,
                reserved_material.server_presignature_id.clone(),
                reserved_material.server_big_r33_b64u.clone(),
                reserved_material
                    .signing_worker_rerandomization_contribution32_b64u
                    .clone(),
                reserved_material.created_at_ms,
            ) {
                Ok(response) => response,
                Err(err) => {
                    return burn_cloudflare_signing_worker_ecdsa_reservation_after_prepare_failure_v1(
                env,
                runtime,
                Some(&materialized.request.wallet_scope),
                materialized.request.request.scope.clone(),
                client_presignature_id.clone(),
                prepare_request_digest,
                reserved_at_ms,
                err,
            )
            .await;
                }
            };
        let prepared = match CloudflareSigningWorkerRouterAbEcdsaDerivationEvmDigestPreparedV1::new(
            response,
            reserved_material,
            &materialized,
        ) {
            Ok(prepared) => prepared,
            Err(err) => {
                return burn_cloudflare_signing_worker_ecdsa_reservation_after_prepare_failure_v1(
                    env,
                    runtime,
                    Some(&materialized.request.wallet_scope),
                    materialized.request.request.scope.clone(),
                    client_presignature_id.clone(),
                    prepare_request_digest,
                    reserved_at_ms,
                    err,
                )
                .await;
            }
        };
        timing.mark("worker_prepare_total", started_at_ms);
        timing.emit_io_diagnostic();
        let response = match final_messages {
            Some(outgoing_messages_b64u) => CloudflareEcdsaPrepareResponseV1::FinalPresignBatch {
                prepared_response: prepared.response,
                outgoing_messages_b64u,
            },
            None => CloudflareEcdsaPrepareResponseV1::AvailablePool(prepared.response),
        };
        match worker::Response::from_json(&response) {
            Ok(response) => Ok(response),
            Err(err) => {
                burn_cloudflare_signing_worker_ecdsa_reservation_after_prepare_failure_v1(
                    env,
                    runtime,
                    Some(&materialized.request.wallet_scope),
                    materialized.request.request.scope,
                    client_presignature_id,
                    prepare_request_digest,
                    reserved_at_ms,
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        format!("SigningWorker ECDSA prepare response encoding failed: {err}"),
                    ),
                )
                .await
            }
        }
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
    let mut timing = CloudflareEcdsaBoundaryTimingV1::new();
    let started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let result =
        finalize_ecdsa_signing(request, env, runtime, handler, now_unix_ms, &mut timing).await;
    timing.mark("worker_finalize_total", started_at_ms);
    timing.emit_io_diagnostic();
    result
}

async fn finalize_ecdsa_signing<Handler>(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    handler: &Handler,
    now_unix_ms: u64,
    timing: &mut CloudflareEcdsaBoundaryTimingV1,
) -> worker::Result<worker::Response>
where
    Handler: CloudflareSigningWorkerRouterAbEcdsaDerivationEvmDigestFinalizeHandlerV1,
{
    let body_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    if request.method() != worker::Method::Post {
        return worker::Response::error(
            "Router A/B ECDSA derivation finalize route requires POST",
            405,
        );
    }
    if request.path() != CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PATH {
        return worker::Response::error(
            format!(
                "Router A/B ECDSA derivation finalize must be served at {}",
                CLOUDFLARE_SIGNING_WORKER_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PATH
            ),
            404,
        );
    }
    let parsed = match request
        .json::<CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1>()
        .await
    {
        Ok(parsed) => parsed,
        Err(err) => {
            return worker::Response::error(
                format!("Router A/B ECDSA derivation finalize JSON parse failed: {err}"),
                400,
            );
        }
    };
    timing.mark("worker_finalize_request_body", body_started_at_ms);
    if let Err(err) = parsed.validate() {
        return worker::Response::error(
            format!("{:?}: {}", err.code(), err.message()),
            cloudflare_router_error_status(err.code()),
        );
    }
    let claim_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let claimed = prepare_ecdsa_finalize(env, runtime, &parsed, now_unix_ms).await;
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
                return worker::Response::error(
                    format!("{:?}: {}", error.code(), error.message()),
                    cloudflare_router_error_status(error.code()),
                );
            }
            return worker::Response::from_json(&response);
        }
        Ok(EcdsaFinalizePreparation::InProgress) => {
            let error = RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                SIGNING_WORKER_ECDSA_EFFECT_IN_PROGRESS_V1,
            );
            return worker::Response::error(
                format!("{:?}: {}", error.code(), error.message()),
                cloudflare_router_error_status(error.code()),
            );
        }
        Ok(EcdsaFinalizePreparation::Burned) => {
            return worker::Response::error(
                "SigningWorker ECDSA reservation was terminally burned before finalization",
                cloudflare_router_error_status(RouterAbProtocolErrorCode::ReplayedLocalRequest),
            );
        }
        Err(error) => {
            return worker::Response::error(
                format!("{:?}: {}", error.code(), error.message()),
                cloudflare_router_error_status(error.code()),
            );
        }
    };
    #[cfg(feature = "wallet-do-signing-worker-harness")]
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
                return worker::Response::error(
                    format!("{:?}: {}", error.code(), error.message()),
                    cloudflare_router_error_status(error.code()),
                );
            }
            let terminal_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
            let committed = commit_cloudflare_signing_worker_ecdsa_terminal_for_wallet_v1(
                env,
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
                        return worker::Response::error(
                            format!("{:?}: {}", error.code(), error.message()),
                            cloudflare_router_error_status(error.code()),
                        );
                    }
                    worker::Response::from_json(&stored)
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

async fn prepare_ecdsa_finalize(
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    request: &CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<EcdsaFinalizePreparation> {
    #[cfg(feature = "wallet-do-signing-worker-harness")]
    {
        let (active, material) = load_cloudflare_signing_worker_ecdsa_normal_signing_material_v1(
            env,
            runtime,
            &request.request.scope,
            &request.material_source,
            Some(&request.wallet_scope),
            now_unix_ms,
        )
        .await?;
        let scope = &request.wallet_scope;
        let response = durable_object::call_signing_worker_wallet_do_v1(
            env,
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
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    prepare_cloudflare_signing_worker_ecdsa_finalize_v1(env, runtime, request, now_unix_ms).await
}
