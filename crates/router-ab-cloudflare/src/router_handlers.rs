//! Router handlers for ECDSA registration, activation, export and refresh, normal signing, linked devices, step-up and SigningWorker output activation.

use super::*;

/// Handles an authenticated public Router Router A/B ECDSA derivation registration/bootstrap request.
// The eighth parameter is the diagnostics-only span collector; folding it into
// a params struct would churn every caller for something that carries no state.
#[allow(clippy::too_many_arguments)]
#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_router_ab_ecdsa_derivation_registration_bootstrap_authenticated_public_request_v1<
    Verifier,
>(
    env: &worker::Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    tenant_root_custody_binding: &CloudflareTenantRootCustodyBindingWireV1,
    authorization: CloudflareRouterBearerAuthorizationV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
    timing: &mut CloudflareEcdsaBoundaryTimingV1,
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationRegistrationAdmissionResponseV1>
where
    Verifier: CloudflareRouterJwtVerifierV1,
{
    let total_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let admission = admit_cloudflare_router_ab_ecdsa_derivation_registration_v1(
        runtime.admission_bindings(),
        &CloudflareWorkerEnvReaderV1::new(env),
        now_unix_ms,
        request,
        tenant_root_custody_binding,
        authorization,
        trusted_source_digest,
        verifier,
    )?;
    timing.mark("ecdsa_rt_authorize", total_started_at_ms);
    let forward = match admission {
        CloudflareRouterAbEcdsaRegistrationAdmissionV1::Forward(forward) => forward,
        CloudflareRouterAbEcdsaRegistrationAdmissionV1::Stopped(response) => {
            timing.mark("ecdsa_rt_total", total_started_at_ms);
            return Ok(response);
        }
    };
    let derivers_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let (deriver_a_result, deriver_b_result) = futures::join!(
        async {
            let started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
            let result =
                execute_cloudflare_router_ab_ecdsa_derivation_deriver_registration_service_call_v1(
                    env,
                    runtime.deriver_a_peer(),
                    &forward.deriver_a,
                    timing.trace_id(),
                )
                .await;
            (
                result,
                CloudflareEcdsaBoundaryTimingV1::now_ms().saturating_sub(started_at_ms),
            )
        },
        async {
            let started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
            let result =
                execute_cloudflare_router_ab_ecdsa_derivation_deriver_registration_service_call_v1(
                    env,
                    runtime.deriver_b_peer(),
                    &forward.deriver_b,
                    timing.trace_id(),
                )
                .await;
            (
                result,
                CloudflareEcdsaBoundaryTimingV1::now_ms().saturating_sub(started_at_ms),
            )
        },
    );
    let (deriver_a_response, deriver_a_elapsed_ms) = deriver_a_result;
    let (deriver_b_response, deriver_b_elapsed_ms) = deriver_b_result;
    timing.push("ecdsa_rt_deriver_a", deriver_a_elapsed_ms);
    timing.push("ecdsa_rt_deriver_b", deriver_b_elapsed_ms);
    timing.mark("ecdsa_rt_derivers", derivers_started_at_ms);
    /* Both role headers are folded in before the `?`s below, so a
    failing deriver still reports where its time went. */
    timing.merge_role(
        "ecdsa_a",
        deriver_a_response
            .as_ref()
            .ok()
            .and_then(|response| response.1.clone()),
    );
    timing.merge_role(
        "ecdsa_b",
        deriver_b_response
            .as_ref()
            .ok()
            .and_then(|response| response.1.clone()),
    );
    let result =
        forward.finish_with_deriver_responses(deriver_a_response?.0, deriver_b_response?.0)?;
    timing.mark("ecdsa_rt_total", total_started_at_ms);
    Ok(result)
}

/// Completes strict Router A/B ECDSA registration after the client verifies both proof bundles.
// See the registration handler above: the eighth parameter is span collection.
#[allow(clippy::too_many_arguments)]
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_router_ab_ecdsa_derivation_activation_authenticated_public_request_v1<
    Verifier,
>(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    command: CloudflareRouterAbEcdsaDerivationActivationCommandV1,
    authorization: CloudflareRouterBearerAuthorizationV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
    timing: &mut CloudflareEcdsaBoundaryTimingV1,
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1>
where
    Verifier: CloudflareRouterJwtVerifierV1,
{
    let total_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let request = admit_cloudflare_router_ab_ecdsa_derivation_activation_v1(
        runtime.admission_bindings(),
        now_unix_ms,
        command,
        authorization,
        trusted_source_digest,
        verifier,
    )?;
    timing.mark("ecdsa_rt_act_session", total_started_at_ms);
    let worker_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let call =
        execute_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_service_call_v1(
            env,
            wallet_objects,
            runtime.signing_worker_peer(),
            &request,
            timing.trace_id(),
        )
        .await;
    timing.mark("ecdsa_rt_act_worker", worker_started_at_ms);
    timing.merge_role(
        "ecdsa_sw",
        call.as_ref().ok().and_then(|call| call.1.clone()),
    );
    let receipt = call?.0;
    timing.mark("ecdsa_rt_act_total", total_started_at_ms);
    Ok(receipt)
}

/// Parses one strict second-phase ECDSA registration activation request.
pub(crate) fn parse_cloudflare_router_ab_ecdsa_derivation_activation_request_v1_json(
    bytes: &[u8],
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationActivationCommandV1> {
    let request: CloudflareRouterAbEcdsaDerivationActivationCommandV1 =
        serde_json::from_slice(bytes).map_err(|err| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("Router A/B ECDSA derivation activation request JSON parse failed: {err}"),
            )
        })?;
    request.validate()?;
    Ok(request)
}

/// Parses one strict ECDSA activation-refresh request.
#[cfg(feature = "workers-rs")]
pub(crate) fn parse_cloudflare_router_ab_ecdsa_derivation_activation_refresh_command_v1_json(
    bytes: &[u8],
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationActivationRefreshCommandV1> {
    let command: CloudflareRouterAbEcdsaDerivationActivationRefreshCommandV1 =
        serde_json::from_slice(bytes).map_err(|err| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("Router A/B ECDSA activation-refresh command JSON parse failed: {err}"),
            )
        })?;
    command.refresh_request.validate()?;
    command.tenant_root.resolve()?;
    Ok(command)
}

/// Parses one strict ECDSA explicit-export command.
pub(crate) fn parse_cloudflare_router_ab_ecdsa_derivation_export_command_v1_json(
    bytes: &[u8],
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationExportCommandV1> {
    let command: CloudflareRouterAbEcdsaDerivationExportCommandV1 = serde_json::from_slice(bytes)
        .map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Router A/B ECDSA export command JSON parse failed: {error}"),
        )
    })?;
    command.request.validate()?;
    command
        .export_authority
        .validate_for_request(&command.request)?;
    command
        .material_source
        .validate_for_ecdsa_scope(&command.export_authority.normal_signing_scope)?;
    command
        .private_authorization
        .validate_for_request(&command.request)?;
    Ok(command)
}

/// Handles an authenticated public Router Router A/B ECDSA derivation explicit export request.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_router_ab_ecdsa_derivation_explicit_export_authenticated_public_request_v1<
    Verifier,
>(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    command: CloudflareRouterAbEcdsaDerivationExportCommandV1,
    authorization: CloudflareRouterBearerAuthorizationV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationExportAdmissionResponseV1>
where
    Verifier: CloudflareRouterJwtVerifierV1,
{
    command.validate_at(now_unix_ms)?;
    let (identity_digest, custody_lineage) = command.tenant_root.resolve()?;
    let active_receipt = crate::tenant_root_refresh_coordinator::execute_cloudflare_router_tenant_root_admission_receipt_v1(
        env,
        identity_digest,
        custody_lineage,
    )
    .await?;
    let mut audit = |line: &str| worker::console_log!("{line}");
    let forward = match admit_cloudflare_router_ab_ecdsa_derivation_export_v1(
        runtime.admission_bindings(),
        now_unix_ms,
        command,
        &active_receipt,
        authorization,
        trusted_source_digest,
        verifier,
        &mut audit,
    )? {
        CloudflareRouterAbEcdsaExportAdmissionV1::Forward(forward) => forward,
        CloudflareRouterAbEcdsaExportAdmissionV1::Stopped(response) => return Ok(response),
    };
    execute_cloudflare_router_ab_ecdsa_derivation_signing_worker_export_preflight_service_call_v1(
        env,
        wallet_objects,
        runtime.signing_worker_peer(),
        &forward.signing_worker,
    )
    .await?;
    let (deriver_a_result, deriver_b_result) = futures::join!(
        execute_cloudflare_router_ab_ecdsa_derivation_deriver_export_service_call_v1(
            env,
            runtime.deriver_a_peer(),
            &forward.deriver_a,
        ),
        execute_cloudflare_router_ab_ecdsa_derivation_deriver_export_service_call_v1(
            env,
            runtime.deriver_b_peer(),
            &forward.deriver_b,
        ),
    );
    let deriver_a_response =
        forward.accept_deriver_result(CloudflareWorkerRoleV1::DeriverA, deriver_a_result, &mut audit)?;
    let deriver_b_response =
        forward.accept_deriver_result(CloudflareWorkerRoleV1::DeriverB, deriver_b_result, &mut audit)?;
    let response = forward.client_bundles(deriver_a_response, deriver_b_response, &mut audit)?;
    let signing_worker_export =
        execute_cloudflare_router_ab_ecdsa_derivation_signing_worker_export_share_service_call_v1(
            env,
            wallet_objects,
            runtime.signing_worker_peer(),
            &forward.signing_worker,
        )
        .await?;
    CloudflareRouterAbEcdsaDerivationExportAdmissionResponseV1::forwarded(
        response,
        signing_worker_export,
    )
}

/// Handles an authenticated public Router Router A/B ECDSA derivation activation-refresh request.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_router_ab_ecdsa_derivation_activation_refresh_authenticated_public_request_v1<
    Verifier,
>(
    env: &worker::Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    command: CloudflareRouterAbEcdsaDerivationActivationRefreshCommandV1,
    authorization: CloudflareRouterBearerAuthorizationV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationActivationRefreshAdmissionResponseV1>
where
    Verifier: CloudflareRouterJwtVerifierV1,
{
    command.validate_at(now_unix_ms)?;
    let CloudflareRouterAbEcdsaDerivationActivationRefreshCommandV1 {
        refresh_request: request,
        tenant_root,
    } = command;
    let (identity_digest, custody_lineage) = tenant_root.resolve()?;
    let active_receipt = crate::tenant_root_refresh_coordinator::execute_cloudflare_router_tenant_root_admission_receipt_v1(
        env,
        identity_digest,
        custody_lineage,
    )
    .await?;
    let tenant_root_custody_binding =
        cloudflare_tenant_root_refresh_binding_wire_v1(&request, &active_receipt)?;
    tenant_root_custody_binding.authenticate_for_refresh(
        &CloudflareWorkerEnvReaderV1::new(env),
        &request,
        now_unix_ms,
    )?;
    let public_request = request.to_threshold_prf_request()?;
    let public_request_for_derivers = public_request.clone();
    let trusted_admission = derive_cloudflare_router_trusted_admission_from_worker_jwt_v1(
        runtime,
        now_unix_ms,
        &public_request,
        request.request_digest()?,
        authorization,
        trusted_source_digest,
        verifier,
    )?;
    let plan =
        runtime.public_request_admission_plan_at(now_unix_ms, public_request, trusted_admission)?;
    match &plan {
        CloudflareRouterPublicAdmissionPlanV1::Forward {
            deriver_a_message,
            deriver_b_message,
            ..
        } => {
            let (deriver_a_result, deriver_b_result) = futures::join!(
                execute_cloudflare_router_ab_ecdsa_derivation_deriver_activation_refresh_service_call_v1(
                    env,
                    runtime.deriver_a_peer(),
                    &request,
                    &public_request_for_derivers,
                    deriver_a_message,
                    &tenant_root_custody_binding,
                ),
                execute_cloudflare_router_ab_ecdsa_derivation_deriver_activation_refresh_service_call_v1(
                    env,
                    runtime.deriver_b_peer(),
                    &request,
                    &public_request_for_derivers,
                    deriver_b_message,
                    &tenant_root_custody_binding,
                ),
            );
            let deriver_a_response = deriver_a_result?;
            let deriver_b_response = deriver_b_result?;
            let router_payload =
                decode_router_to_signer_payload_v1(deriver_a_message.payload.as_bytes())?;
            let response = CloudflareRouterRecipientProofBundleResponseV1::new(
                deriver_a_response.client_bundle.clone(),
                deriver_b_response.client_bundle.clone(),
            )?;
            response.validate_for_router_payload(&router_payload)?;
            let activation =
                CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRefreshRequestV1::new(
                    request.clone(),
                    router_payload,
                    CloudflareSigningWorkerRecipientProofBundleActivationV1::new(
                        deriver_a_response.server_bundle,
                        deriver_b_response.server_bundle,
                    )?,
                    request.material_activation.clone(),
                    tenant_root_custody_binding,
                )?;
            let signing_worker_activation =
                execute_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_refresh_service_call_v1(
                    env,
                    runtime.signing_worker_peer(),
                    &activation,
                )
                .await?;
            CloudflareRouterAbEcdsaDerivationActivationRefreshAdmissionResponseV1::forwarded(
                response,
                signing_worker_activation,
            )
        }
        CloudflareRouterPublicAdmissionPlanV1::Stop {
            trusted_admission, ..
        } => CloudflareRouterAbEcdsaDerivationActivationRefreshAdmissionResponseV1::stopped(
            trusted_admission.decision.clone(),
        ),
    }
}

pub fn parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_prepare_request_v1_json(
    bytes: &[u8],
) -> RouterAbProtocolResult<(
    RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    CloudflareEcdsaPrepareSourceV1,
)> {
    let value = serde_json::from_slice::<serde_json::Value>(bytes).map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Router A/B ECDSA derivation prepare request JSON parse failed: {err}"),
        )
    })?;
    let mut object = match value {
        serde_json::Value::Object(object) => object,
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Router A/B ECDSA derivation prepare request must be a JSON object",
            ));
        }
    };
    let presign_source = match object.remove("presign_source") {
        Some(value) => {
            if value.get("kind").and_then(serde_json::Value::as_str) == Some("final_presign_batch")
            {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "Bundled final presign batch is gated until its producer authority is verified",
                ));
            }
            serde_json::from_value::<CloudflareEcdsaPrepareSourceV1>(value).map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    error.to_string(),
                )
            })?
        }
        None => CloudflareEcdsaPrepareSourceV1::AvailablePool,
    };
    let authorized_operation_value = object.remove("authorized_operation").ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "authorized_operation is required",
        )
    })?;
    let authorized_operation = serde_json::from_value::<
        CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    >(authorized_operation_value)
    .map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("ECDSA authorized operation JSON parse failed: {err}"),
        )
    })?;
    authorized_operation.validate()?;
    let request = serde_json::from_value::<RouterAbEcdsaDerivationEvmDigestSigningRequestV1>(
        serde_json::Value::Object(object),
    )
    .map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Router A/B ECDSA derivation prepare request JSON parse failed: {err}"),
        )
    })?;
    request.validate()?;
    authorized_operation
        .authorized_operation
        .validate_for_prepare_request(&request)?;
    presign_source.validate_for_request(&request)?;
    Ok((request, authorized_operation, presign_source))
}

pub fn parse_cloudflare_router_authorized_ed25519_prepare_request_v2_json(
    bytes: &[u8],
) -> RouterAbProtocolResult<(
    RouterAbEd25519NormalSigningPrepareRequestV2,
    CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
)> {
    let value = serde_json::from_slice::<serde_json::Value>(bytes).map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Ed25519 prepare request JSON parse failed: {err}"),
        )
    })?;
    let mut object = match value {
        serde_json::Value::Object(object) => object,
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Ed25519 prepare request must be a JSON object",
            ));
        }
    };
    let authorized_operation_value = object.remove("authorized_operation").ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "authorized_operation is required",
        )
    })?;
    let authorized_operation = serde_json::from_value::<
        CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    >(authorized_operation_value)
    .map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Ed25519 authorized operation JSON parse failed: {err}"),
        )
    })?;
    authorized_operation.validate()?;
    let request = serde_json::from_value::<RouterAbEd25519NormalSigningPrepareRequestV2>(
        serde_json::Value::Object(object),
    )
    .map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Ed25519 prepare request JSON parse failed: {err}"),
        )
    })?;
    request.validate()?;
    authorized_operation
        .authorized_operation
        .validate_for_prepare_request(&request)?;
    Ok((request, authorized_operation))
}

pub fn parse_cloudflare_router_authorized_ed25519_finalize_request_v2_json(
    bytes: &[u8],
) -> RouterAbProtocolResult<(
    RouterAbEd25519NormalSigningFinalizeRequestV2,
    CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
)> {
    let value = serde_json::from_slice::<serde_json::Value>(bytes).map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Ed25519 finalize request JSON parse failed: {err}"),
        )
    })?;
    let mut object = match value {
        serde_json::Value::Object(object) => object,
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Ed25519 finalize request must be a JSON object",
            ));
        }
    };
    let authorized_operation_value = object.remove("authorized_operation").ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "authorized_operation is required",
        )
    })?;
    let authorized_operation = serde_json::from_value::<
        CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    >(authorized_operation_value)
    .map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Ed25519 authorized operation JSON parse failed: {err}"),
        )
    })?;
    authorized_operation.validate()?;
    let request = serde_json::from_value::<RouterAbEd25519NormalSigningFinalizeRequestV2>(
        serde_json::Value::Object(object),
    )
    .map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Ed25519 finalize request JSON parse failed: {err}"),
        )
    })?;
    request.validate()?;
    let authorization = match (
        &authorized_operation.binding,
        &authorized_operation.authorized_operation,
    ) {
        (
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::ReusableWalletSession {
                authorization_id,
                wallet_session_id,
                ..
            }
            | CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                authorization_id,
                wallet_session_id,
                ..
            }
            | CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession {
                authorization_id,
                wallet_session_id,
                ..
            },
            CloudflareRouterEd25519AuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                ..
            },
        ) => CloudflareRouterNormalSigningAuthorizationV2::reusable_wallet_session(
            authorization_id.clone(),
            wallet_session_id.clone(),
        )?,
        (
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::OperationStepUp {
                authorization_session_id,
                ..
            },
            CloudflareRouterEd25519AuthorizedOperationV1::VerifiedStepUpAuthorizedOperationV1 {
                evidence_set_digest,
                ..
            },
        ) => CloudflareRouterNormalSigningAuthorizationV2::operation_step_up(
            authorization_session_id.clone(),
            evidence_set_digest.clone(),
        )?,
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "accepted Ed25519 capability binding does not match authorized operation",
            ));
        }
    };
    authorized_operation
        .authorized_operation
        .validate_for_finalize_request(&request, &authorization)?;
    Ok((request, authorized_operation))
}

pub fn parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_finalize_request_v1_json(
    bytes: &[u8],
) -> RouterAbProtocolResult<(
    RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
)> {
    let value = serde_json::from_slice::<serde_json::Value>(bytes).map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Router A/B ECDSA derivation finalize request JSON parse failed: {err}"),
        )
    })?;
    let mut object = match value {
        serde_json::Value::Object(object) => object,
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Router A/B ECDSA derivation finalize request must be a JSON object",
            ));
        }
    };
    let authorized_operation_value = object.remove("authorized_operation").ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "authorized_operation is required",
        )
    })?;
    let authorized_operation = serde_json::from_value::<
        CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    >(authorized_operation_value)
    .map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("ECDSA authorized operation JSON parse failed: {err}"),
        )
    })?;
    authorized_operation.validate()?;
    let request =
        serde_json::from_value::<RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1>(
            serde_json::Value::Object(object),
        )
        .map_err(|err| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("Router A/B ECDSA derivation finalize request JSON parse failed: {err}"),
            )
        })?;
    request.validate()?;
    authorized_operation
        .authorized_operation
        .validate_for_finalize_request_with_session(&request, None)?;
    Ok((request, authorized_operation))
}

pub fn parse_cloudflare_router_authorized_linked_device_ecdsa_finalize_request_v1_json(
    bytes: &[u8],
) -> RouterAbProtocolResult<CloudflareSigningWorkerAdmittedLinkedDeviceEcdsaFinalizeRequestV1> {
    let value = serde_json::from_slice::<serde_json::Value>(bytes).map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("linked ECDSA finalize request JSON parse failed: {err}"),
        )
    })?;
    let mut object = match value {
        serde_json::Value::Object(object) => object,
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "linked ECDSA finalize request must be a JSON object",
            ));
        }
    };
    let authorized_operation = serde_json::from_value::<
        CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    >(object.remove("authorized_operation").ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "linked ECDSA authorized_operation is required",
        )
    })?)
    .map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("linked ECDSA authorized operation JSON parse failed: {err}"),
        )
    })?;
    let material_source = serde_json::from_value::<
        CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    >(object.remove("material_source").ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "linked ECDSA material_source is required",
        )
    })?)
    .map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("linked ECDSA material source JSON parse failed: {err}"),
        )
    })?;
    let request = serde_json::from_value::<
        router_ab_core::RouterAbEcdsaDerivationLinkedDeviceEvmDigestSigningFinalizeRequestV1,
    >(serde_json::Value::Object(object))
    .map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("linked ECDSA finalize request JSON parse failed: {err}"),
        )
    })?;
    CloudflareSigningWorkerAdmittedLinkedDeviceEcdsaFinalizeRequestV1::new(
        request,
        authorized_operation,
        material_source,
    )
}

pub(super) fn decode_public_digest_b64u_v1(
    field: &str,
    encoded: &str,
) -> RouterAbProtocolResult<PublicDigest32> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded.as_bytes())
        .map_err(|err| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{field} is not valid base64url: {err}"),
            )
        })?;
    let digest: [u8; 32] = bytes.try_into().map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{field} must decode to 32 bytes"),
        )
    })?;
    Ok(PublicDigest32::new(digest))
}

/// Router admission for a Gateway Wallet Session NEAR prepare. Returns the
/// exact SigningWorker request; both the Cloudflare Router and the VM Router
/// send only what this admits.
pub(crate) fn admit_cloudflare_router_normal_signing_prepare_v2<Verifier>(
    admission_bindings: &CloudflareRouterAdmissionBindingsV1,
    now_unix_ms: u64,
    request: RouterAbEd25519NormalSigningPrepareRequestV2,
    authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    credential: CloudflareRouterWalletSessionCredentialV1,
    trusted_source_digest: PublicDigest32,
    mut verifier: Verifier,
) -> RouterAbProtocolResult<CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2>
where
    Verifier: CloudflareRouterWalletSessionVerifierV1,
{
    request.validate_at(now_unix_ms)?;
    let wallet_session = verifier.verify_wallet_session(
        &admission_bindings.jwt,
        &credential,
        trusted_source_digest,
        now_unix_ms,
    )?;
    wallet_session.validate_for_normal_signing_prepare_request_v2(&request, now_unix_ms)?;
    authorized_operation.validate_for_wallet_session(&wallet_session)?;
    authorized_operation
        .authorized_operation
        .validate_for_prepare_request(&request)?;
    let admission = CloudflareRouterNormalSigningPrepareAdmissionCandidateV2::from_prepare_request(
        &wallet_session,
        &request,
        now_unix_ms,
    )?;
    let trusted_admission = admission_bindings.apply_project_policy_to_normal_signing_admission_v1(
        &request.scope.request_id,
        derive_cloudflare_router_normal_signing_prepare_trusted_admission_v2(&request, &admission)?,
    )?;
    if !trusted_admission.allows_signing_worker_forwarding()? {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "normal-signing v2 prepare Router admission did not allow SigningWorker forwarding",
        ));
    }
    let wallet_scope = authorized_operation.wallet_scope()?;
    CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2::new(
        authorized_operation.ownership_generation()?,
        wallet_scope,
        request.scope.clone(),
        request.expires_at_ms,
        admission,
        trusted_admission,
    )
}

/// Handles an authenticated public Router normal-signing v2 prepare request.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_router_normal_signing_prepare_authenticated_public_request_v2<
    Verifier,
>(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: RouterAbEd25519NormalSigningPrepareRequestV2,
    authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    credential: CloudflareRouterWalletSessionCredentialV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
) -> RouterAbProtocolResult<NormalSigningRound1PrepareResponseV1>
where
    Verifier: CloudflareRouterWalletSessionVerifierV1,
{
    let admitted = admit_cloudflare_router_normal_signing_prepare_v2(
        runtime.admission_bindings(),
        now_unix_ms,
        request,
        authorized_operation,
        credential,
        trusted_source_digest,
        verifier,
    )?;
    execute_cloudflare_signing_worker_normal_signing_prepare_service_call_v2(
        env,
        wallet_objects,
        runtime.signing_worker_peer(),
        admitted,
    )
    .await
}

#[cfg(feature = "workers-rs")]
pub(super) struct CloudflareRouterEd25519LinkedDeviceBindingV1<'a> {
    pub(super) subject_id: &'a str,
    pub(super) account_id: &'a str,
    pub(super) authorization_id: &'a str,
    pub(super) wallet_session_id: &'a str,
    pub(super) org_id: &'a str,
    pub(super) project_id: &'a str,
    pub(super) environment: &'a str,
    pub(super) signing_worker_id: &'a str,
    pub(super) expires_at_ms: u64,
    pub(super) material_source: &'a CloudflareSigningWorkerNormalSigningMaterialSourceV1,
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_router_ed25519_linked_device_binding_v1(
    authorized_operation: &CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
) -> RouterAbProtocolResult<CloudflareRouterEd25519LinkedDeviceBindingV1<'_>> {
    authorized_operation.validate()?;
    match (
        &authorized_operation.binding,
        &authorized_operation.authorized_operation,
    ) {
        (
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession {
                subject_id,
                account_id,
                authorization_id,
                wallet_session_id,
                org_id,
                project_id,
                environment,
                signing_worker_id,
                expires_at_ms,
                material_source,
                ..
            },
            CloudflareRouterEd25519AuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                ..
            },
        ) => Ok(CloudflareRouterEd25519LinkedDeviceBindingV1 {
            subject_id,
            account_id,
            authorization_id,
            wallet_session_id,
            org_id,
            project_id,
            environment,
            signing_worker_id,
            expires_at_ms: *expires_at_ms,
            material_source,
        }),
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Ed25519 linked-device admission requires a Gateway linked-device Wallet Session binding",
        )),
    }
}

#[cfg(feature = "workers-rs")]
pub(super) fn validate_cloudflare_router_ed25519_linked_device_request_v1(
    account_id: &str,
    signing_worker_id: &str,
    binding_expires_at_ms: u64,
    request_account_id: &str,
    request_signing_worker_id: &str,
    request_expires_at_ms: u64,
) -> RouterAbProtocolResult<()> {
    if request_account_id != account_id || request_signing_worker_id != signing_worker_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Ed25519 linked-device Gateway admission identity does not match the request",
        ));
    }
    if request_expires_at_ms > binding_expires_at_ms {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Ed25519 linked-device request outlives its Wallet Session",
        ));
    }
    Ok(())
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_router_ed25519_linked_device_prepare_admission_v2(
    request: &RouterAbEd25519NormalSigningPrepareRequestV2,
    authorized_operation: &CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<(
    CloudflareRouterNormalSigningPrepareAdmissionCandidateV2,
    CloudflareRouterNormalSigningTrustedAdmissionV1,
)> {
    let binding = cloudflare_router_ed25519_linked_device_binding_v1(authorized_operation)?;
    validate_cloudflare_router_ed25519_linked_device_request_v1(
        binding.account_id,
        binding.signing_worker_id,
        binding.expires_at_ms,
        &request.scope.account_id,
        &request.scope.signing_worker_id,
        request.expires_at_ms,
    )?;
    authorized_operation
        .authorized_operation
        .validate_for_prepare_request(request)?;
    let material = request.admission_material()?;
    let admission = CloudflareRouterNormalSigningPrepareAdmissionCandidateV2::new(
        binding.org_id.to_owned(),
        binding.project_id.to_owned(),
        binding.environment.to_owned(),
        binding.account_id.to_owned(),
        binding.subject_id.to_owned(),
        CloudflareRouterNormalSigningAuthorizationV2::reusable_wallet_session(
            binding.authorization_id.to_owned(),
            binding.wallet_session_id.to_owned(),
        )?,
        binding.signing_worker_id.to_owned(),
        request.scope.request_id.clone(),
        material.intent_digest,
        material.signing_payload_digest,
        material.admitted_signing_digest,
        Some(request.round1_binding_digest()?),
        trusted_source_digest,
        request.expires_at_ms,
    )?;
    let trusted_admission =
        derive_cloudflare_router_normal_signing_prepare_trusted_admission_v2(request, &admission)?;
    Ok((admission, trusted_admission))
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_router_ed25519_linked_device_finalize_admission_v2(
    request: &RouterAbEd25519NormalSigningFinalizeRequestV2,
    authorized_operation: &CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<(
    CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2,
    CloudflareRouterNormalSigningTrustedAdmissionV1,
)> {
    let binding = cloudflare_router_ed25519_linked_device_binding_v1(authorized_operation)?;
    validate_cloudflare_router_ed25519_linked_device_request_v1(
        binding.account_id,
        binding.signing_worker_id,
        binding.expires_at_ms,
        &request.scope.account_id,
        &request.scope.signing_worker_id,
        request.expires_at_ms,
    )?;
    let authorization = CloudflareRouterNormalSigningAuthorizationV2::reusable_wallet_session(
        binding.authorization_id.to_owned(),
        binding.wallet_session_id.to_owned(),
    )?;
    authorized_operation
        .authorized_operation
        .validate_for_finalize_request(request, &authorization)?;
    let admission = CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::new(
        binding.org_id.to_owned(),
        binding.project_id.to_owned(),
        binding.environment.to_owned(),
        binding.account_id.to_owned(),
        binding.subject_id.to_owned(),
        authorization,
        binding.signing_worker_id.to_owned(),
        request.scope.request_id.clone(),
        request.intent_digest(),
        request.signing_payload_digest(),
        request.round1_binding_digest(),
        trusted_source_digest,
        request.expires_at_ms,
    )?;
    let trusted_admission =
        derive_cloudflare_router_normal_signing_finalize_trusted_admission_v2(request, &admission)?;
    Ok((admission, trusted_admission))
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_router_normal_signing_prepare_internal_linked_device_request_v2(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: RouterAbEd25519NormalSigningPrepareRequestV2,
    authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<NormalSigningRound1PrepareResponseV1> {
    request.validate_at(now_unix_ms)?;
    let material_source =
        cloudflare_router_ed25519_linked_device_binding_v1(&authorized_operation)?
            .material_source
            .clone();
    let (admission, trusted_admission) =
        cloudflare_router_ed25519_linked_device_prepare_admission_v2(
            &request,
            &authorized_operation,
            trusted_source_digest,
        )?;
    material_source.validate_for_normal_scope(&request.scope)?;
    let trusted_admission = runtime.apply_project_policy_to_normal_signing_admission_v1(
        &request.scope.request_id,
        trusted_admission,
    )?;
    if !trusted_admission.allows_signing_worker_forwarding()? {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "linked-device normal-signing prepare admission did not allow SigningWorker forwarding",
        ));
    }
    let admitted =
        CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2::new_with_material_source(
            authorized_operation.ownership_generation()?,
            authorized_operation.wallet_scope()?,
            request.scope.clone(),
            request.expires_at_ms,
            admission,
            trusted_admission,
            material_source,
        )?;
    execute_cloudflare_signing_worker_normal_signing_prepare_service_call_v2(
        env,
        wallet_objects,
        runtime.signing_worker_peer(),
        admitted,
    )
    .await
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_router_normal_signing_finalize_internal_linked_device_request_v2(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: RouterAbEd25519NormalSigningFinalizeRequestV2,
    authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<NormalSigningResponseV1> {
    request.validate_at(now_unix_ms)?;
    let binding = cloudflare_router_ed25519_linked_device_binding_v1(&authorized_operation)?;
    let authorization_id = binding.authorization_id.to_owned();
    let wallet_session_id = binding.wallet_session_id.to_owned();
    let material_source = binding.material_source.clone();
    let (admission, trusted_admission) =
        cloudflare_router_ed25519_linked_device_finalize_admission_v2(
            &request,
            &authorized_operation,
            trusted_source_digest,
        )?;
    let trusted_admission = runtime.apply_project_policy_to_normal_signing_admission_v1(
        &request.scope.request_id,
        trusted_admission,
    )?;
    if !trusted_admission.allows_signing_worker_forwarding()? {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "linked-device normal-signing finalize admission did not allow SigningWorker forwarding",
        ));
    }
    let authorized_operation_identity =
        authorized_operation.into_signing_worker_authorized_operation_identity()?;
    let ownership_generation = authorized_operation.ownership_generation()?;
    let wallet_scope = authorized_operation.wallet_scope()?;
    let effect_claim = authorized_operation
        .authorized_operation
        .into_signing_worker_effect_claim(wallet_session_id, authorization_id)?;
    material_source.validate_for_normal_scope(&request.scope)?;
    let admitted =
        CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2::new_with_material_source(
            ownership_generation,
            wallet_scope,
            request,
            admission,
            trusted_admission,
            authorized_operation_identity,
            effect_claim,
            material_source,
        )?;
    execute_cloudflare_signing_worker_normal_signing_finalize_service_call_v2(
        env,
        wallet_objects,
        runtime.signing_worker_peer(),
        admitted,
    )
    .await
}

pub(super) fn cloudflare_router_ed25519_step_up_binding_v1(
    authorized_operation: &CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
) -> RouterAbProtocolResult<(&str, &str, &str, &str, &str, &str)> {
    authorized_operation.validate()?;
    match (
        &authorized_operation.binding,
        &authorized_operation.authorized_operation,
    ) {
        (
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::OperationStepUp {
                authorization_session_id,
                org_id,
                project_id,
                environment,
                subject_id,
                ..
            },
            CloudflareRouterEd25519AuthorizedOperationV1::VerifiedStepUpAuthorizedOperationV1 {
                evidence_set_digest,
                ..
            },
        ) => Ok((
            authorization_session_id,
            evidence_set_digest,
            org_id,
            project_id,
            environment,
            subject_id,
        )),
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Ed25519 reusable Wallet Session authorized operation cannot use the operation step-up admission path",
        )),
    }
}

pub(super) fn cloudflare_router_ed25519_step_up_prepare_admission_v2(
    request: &RouterAbEd25519NormalSigningPrepareRequestV2,
    authorized_operation: &CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<(
    CloudflareRouterNormalSigningPrepareAdmissionCandidateV2,
    CloudflareRouterNormalSigningTrustedAdmissionV1,
)> {
    let (
        authorization_session_id,
        evidence_set_digest,
        org_id,
        project_id,
        environment,
        subject_id,
    ) = cloudflare_router_ed25519_step_up_binding_v1(authorized_operation)?;
    authorized_operation
        .authorized_operation
        .validate_for_prepare_request(request)?;
    let material = request.admission_material()?;
    let admission = CloudflareRouterNormalSigningPrepareAdmissionCandidateV2::new(
        org_id.to_owned(),
        project_id.to_owned(),
        environment.to_owned(),
        request.scope.account_id.clone(),
        subject_id.to_owned(),
        CloudflareRouterNormalSigningAuthorizationV2::operation_step_up(
            authorization_session_id.to_owned(),
            evidence_set_digest.to_owned(),
        )?,
        request.scope.signing_worker_id.clone(),
        request.scope.request_id.clone(),
        material.intent_digest,
        material.signing_payload_digest,
        material.admitted_signing_digest,
        Some(request.round1_binding_digest()?),
        trusted_source_digest,
        request.expires_at_ms,
    )?;
    let trusted_admission =
        derive_cloudflare_router_normal_signing_prepare_trusted_admission_v2(request, &admission)?;
    Ok((admission, trusted_admission))
}

pub(super) fn cloudflare_router_ed25519_step_up_finalize_admission_v2(
    request: &RouterAbEd25519NormalSigningFinalizeRequestV2,
    authorized_operation: &CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<(
    CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2,
    CloudflareRouterNormalSigningTrustedAdmissionV1,
)> {
    let (
        authorization_session_id,
        evidence_set_digest,
        org_id,
        project_id,
        environment,
        subject_id,
    ) = cloudflare_router_ed25519_step_up_binding_v1(authorized_operation)?;
    let authorization = CloudflareRouterNormalSigningAuthorizationV2::operation_step_up(
        authorization_session_id.to_owned(),
        evidence_set_digest.to_owned(),
    )?;
    authorized_operation
        .authorized_operation
        .validate_for_finalize_request(request, &authorization)?;
    let admission = CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::new(
        org_id.to_owned(),
        project_id.to_owned(),
        environment.to_owned(),
        request.scope.account_id.clone(),
        subject_id.to_owned(),
        authorization,
        request.scope.signing_worker_id.clone(),
        request.scope.request_id.clone(),
        request.intent_digest(),
        request.signing_payload_digest(),
        request.round1_binding_digest(),
        trusted_source_digest,
        request.expires_at_ms,
    )?;
    let trusted_admission =
        derive_cloudflare_router_normal_signing_finalize_trusted_admission_v2(request, &admission)?;
    Ok((admission, trusted_admission))
}

/// Router admission for a Gateway-verified operation step-up NEAR prepare.
/// Both the Cloudflare Router and the VM Router send only what this admits.
pub(crate) fn admit_cloudflare_router_normal_signing_step_up_prepare_v2(
    admission_bindings: &CloudflareRouterAdmissionBindingsV1,
    now_unix_ms: u64,
    request: RouterAbEd25519NormalSigningPrepareRequestV2,
    authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2> {
    request.validate_at(now_unix_ms)?;
    let (admission, trusted_admission) = cloudflare_router_ed25519_step_up_prepare_admission_v2(
        &request,
        &authorized_operation,
        trusted_source_digest,
    )?;
    let wallet_scope = require_step_up_wallet_scope_v1(
        authorized_operation.wallet_scope()?,
        &request.scope.account_id,
    )?;
    let trusted_admission = admission_bindings.apply_project_policy_to_normal_signing_admission_v1(
        &request.scope.request_id,
        trusted_admission,
    )?;
    if !trusted_admission.allows_signing_worker_forwarding()? {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "normal-signing v2 prepare Router admission did not allow SigningWorker forwarding",
        ));
    }
    CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2::new(
        authorized_operation.ownership_generation()?,
        wallet_scope,
        request.scope.clone(),
        request.expires_at_ms,
        admission,
        trusted_admission,
    )
}

/// Router admission for a Gateway-verified operation step-up NEAR finalize,
/// with the effect claim the SigningWorker records before it signs.
pub(crate) fn admit_cloudflare_router_normal_signing_step_up_finalize_v2(
    admission_bindings: &CloudflareRouterAdmissionBindingsV1,
    now_unix_ms: u64,
    request: RouterAbEd25519NormalSigningFinalizeRequestV2,
    authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2> {
    request.validate_at(now_unix_ms)?;
    let (admission, trusted_admission) = cloudflare_router_ed25519_step_up_finalize_admission_v2(
        &request,
        &authorized_operation,
        trusted_source_digest,
    )?;
    let wallet_scope = require_step_up_wallet_scope_v1(
        authorized_operation.wallet_scope()?,
        &request.scope.account_id,
    )?;
    let trusted_admission = admission_bindings.apply_project_policy_to_normal_signing_admission_v1(
        &request.scope.request_id,
        trusted_admission,
    )?;
    if !trusted_admission.allows_signing_worker_forwarding()? {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "normal-signing v2 finalize Router admission did not allow SigningWorker forwarding",
        ));
    }
    let authorized_operation_identity =
        authorized_operation.into_signing_worker_authorized_operation_identity()?;
    let ownership_generation = authorized_operation.ownership_generation()?;
    let effect_claim = authorized_operation
        .authorized_operation
        .into_step_up_signing_worker_effect_claim()?;
    CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2::new(
        ownership_generation,
        wallet_scope,
        request,
        admission,
        trusted_admission,
        authorized_operation_identity,
        effect_claim,
    )
}

/// A step-up binding's wallet must be the wallet the request signs for.
pub(super) fn require_step_up_wallet_scope_v1(
    wallet_scope: CloudflareSigningWorkerWalletScopeV1,
    request_wallet_id: &str,
) -> RouterAbProtocolResult<CloudflareSigningWorkerWalletScopeV1> {
    if wallet_scope.wallet_id != request_wallet_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "operation step-up wallet does not match the signing request",
        ));
    }
    Ok(wallet_scope)
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_router_normal_signing_prepare_internal_step_up_request_v2(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: RouterAbEd25519NormalSigningPrepareRequestV2,
    authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<NormalSigningRound1PrepareResponseV1> {
    let admitted = admit_cloudflare_router_normal_signing_step_up_prepare_v2(
        runtime.admission_bindings(),
        now_unix_ms,
        request,
        authorized_operation,
        trusted_source_digest,
    )?;
    execute_cloudflare_signing_worker_normal_signing_prepare_service_call_v2(
        env,
        wallet_objects,
        runtime.signing_worker_peer(),
        admitted,
    )
    .await
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_router_normal_signing_finalize_internal_step_up_request_v2(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: RouterAbEd25519NormalSigningFinalizeRequestV2,
    authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<NormalSigningResponseV1> {
    let admitted = admit_cloudflare_router_normal_signing_step_up_finalize_v2(
        runtime.admission_bindings(),
        now_unix_ms,
        request,
        authorized_operation,
        trusted_source_digest,
    )?;
    execute_cloudflare_signing_worker_normal_signing_finalize_service_call_v2(
        env,
        wallet_objects,
        runtime.signing_worker_peer(),
        admitted,
    )
    .await
}

pub(super) fn cloudflare_router_ab_ecdsa_step_up_binding_v1(
    authorized_operation: &CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
) -> RouterAbProtocolResult<(&str, &str, &str, &str, &str, &str)> {
    authorized_operation.validate()?;
    match (
        &authorized_operation.binding,
        &authorized_operation.authorized_operation,
    ) {
        (
            CloudflareRouterEcdsaAcceptedCapabilityBindingV1::OperationStepUp {
                authorization_session_id,
                org_id,
                project_id,
                environment,
                subject_id,
                ..
            },
            CloudflareRouterEcdsaAuthorizedOperationV1::VerifiedStepUpAuthorizedOperationV1 {
                evidence_set_digest,
                ..
            },
        ) => Ok((
            authorization_session_id,
            evidence_set_digest,
            org_id,
            project_id,
            environment,
            subject_id,
        )),
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "ECDSA reusable Wallet Session authorized operation cannot use the operation step-up admission path",
        )),
    }
}

pub(super) fn cloudflare_router_ab_ecdsa_step_up_prepare_admission_v1(
    request: &RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    authorized_operation: &CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<CloudflareRouterNormalSigningTrustedAdmissionV1> {
    let (
        authorization_session_id,
        evidence_set_digest,
        org_id,
        project_id,
        environment,
        subject_id,
    ) = cloudflare_router_ab_ecdsa_step_up_binding_v1(authorized_operation)?;
    authorized_operation
        .authorized_operation
        .validate_for_prepare_request(request)?;
    let admission = CloudflareRouterAbEcdsaDerivationEvmDigestPrepareAdmissionCandidateV1::new(
        org_id.to_owned(),
        project_id.to_owned(),
        environment.to_owned(),
        request.scope.wallet_id.clone(),
        subject_id.to_owned(),
        CloudflareRouterNormalSigningAuthorizationV2::operation_step_up(
            authorization_session_id.to_owned(),
            evidence_set_digest.to_owned(),
        )?,
        request.scope.signing_worker.server_id.clone(),
        request.request_id.clone(),
        request.client_presignature_id.clone(),
        request.scope.scope_digest()?,
        request.request_digest()?,
        request.signing_digest()?,
        trusted_source_digest,
        request.expires_at_ms,
    )?;
    derive_cloudflare_router_ab_ecdsa_derivation_evm_digest_prepare_trusted_admission_v1(
        request, &admission,
    )
}

pub(super) fn cloudflare_router_ab_ecdsa_step_up_finalize_admission_v1(
    request: &RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    authorized_operation: &CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<CloudflareRouterNormalSigningTrustedAdmissionV1> {
    let (
        authorization_session_id,
        evidence_set_digest,
        org_id,
        project_id,
        environment,
        subject_id,
    ) = cloudflare_router_ab_ecdsa_step_up_binding_v1(authorized_operation)?;
    authorized_operation
        .authorized_operation
        .validate_for_finalize_request_with_session(request, Some(authorization_session_id))?;
    let admission = CloudflareRouterAbEcdsaDerivationEvmDigestFinalizeAdmissionCandidateV1::new(
        org_id.to_owned(),
        project_id.to_owned(),
        environment.to_owned(),
        request.scope.wallet_id.clone(),
        subject_id.to_owned(),
        CloudflareRouterNormalSigningAuthorizationV2::operation_step_up(
            authorization_session_id.to_owned(),
            evidence_set_digest.to_owned(),
        )?,
        request.scope.signing_worker.server_id.clone(),
        request.request_id.clone(),
        request.scope.scope_digest()?,
        request.prepare_request_digest()?,
        request.request_digest()?,
        request.signing_digest()?,
        request.server_presignature_id.clone(),
        trusted_source_digest,
        request.expires_at_ms,
    )?;
    derive_cloudflare_router_ab_ecdsa_derivation_evm_digest_finalize_trusted_admission_v1(
        request, &admission,
    )
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_prepare_internal_step_up_request_v1(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    authorized_operation: CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    presign_source: CloudflareEcdsaPrepareSourceV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<CloudflareEcdsaPrepareResponseV1> {
    let admitted = admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_step_up_prepare_v1(
        runtime.admission_bindings(),
        now_unix_ms,
        request,
        authorized_operation,
        presign_source,
        trusted_source_digest,
    )?;
    execute_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_prepare_service_call_v1(
        env,
        wallet_objects,
        runtime.signing_worker_peer(),
        admitted,
    )
    .await
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_finalize_internal_step_up_request_v1(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    authorized_operation: CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationEvmDigestSigningResponseV1> {
    let admitted = admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_step_up_finalize_v1(
        runtime.admission_bindings(),
        now_unix_ms,
        request,
        authorized_operation,
        trusted_source_digest,
    )?;
    execute_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_service_call_v1(
        env,
        wallet_objects,
        runtime.signing_worker_peer(),
        admitted,
    )
    .await
}

/// Handles an authenticated public Router Router A/B ECDSA derivation prepare request.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_prepare_authenticated_public_request_v1<
    Verifier,
>(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    authorized_operation: CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    presign_source: CloudflareEcdsaPrepareSourceV1,
    credential: CloudflareRouterWalletSessionCredentialV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
) -> RouterAbProtocolResult<CloudflareEcdsaPrepareResponseV1>
where
    Verifier: CloudflareRouterWalletSessionVerifierV1,
{
    let admitted = admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_prepare_v1(
        runtime.admission_bindings(),
        now_unix_ms,
        request,
        authorized_operation,
        presign_source,
        credential,
        trusted_source_digest,
        verifier,
    )?;
    execute_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_prepare_service_call_v1(
        env,
        wallet_objects,
        runtime.signing_worker_peer(),
        admitted,
    )
    .await
}

/// Handles an authenticated public Router Router A/B ECDSA derivation finalize request.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_finalize_authenticated_public_request_v1<
    Verifier,
>(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    authorized_operation: CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    credential: CloudflareRouterWalletSessionCredentialV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationEvmDigestSigningResponseV1>
where
    Verifier: CloudflareRouterWalletSessionVerifierV1,
{
    let admitted = admit_cloudflare_router_ab_ecdsa_derivation_evm_digest_finalize_v1(
        runtime.admission_bindings(),
        now_unix_ms,
        request,
        authorized_operation,
        credential,
        trusted_source_digest,
        verifier,
    )?;
    execute_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_service_call_v1(
        env,
        wallet_objects,
        runtime.signing_worker_peer(),
        admitted,
    )
    .await
}

/// Router admission for a Gateway Wallet Session NEAR finalize, including the
/// exact authorized-operation identity and one-use effect claim SigningWorker
/// must record. Shared by the Cloudflare and VM Routers.
pub(crate) fn admit_cloudflare_router_normal_signing_finalize_v2<Verifier>(
    admission_bindings: &CloudflareRouterAdmissionBindingsV1,
    now_unix_ms: u64,
    request: RouterAbEd25519NormalSigningFinalizeRequestV2,
    authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    credential: CloudflareRouterWalletSessionCredentialV1,
    trusted_source_digest: PublicDigest32,
    mut verifier: Verifier,
) -> RouterAbProtocolResult<CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2>
where
    Verifier: CloudflareRouterWalletSessionVerifierV1,
{
    request.validate_at(now_unix_ms)?;
    let wallet_session = verifier.verify_wallet_session(
        &admission_bindings.jwt,
        &credential,
        trusted_source_digest,
        now_unix_ms,
    )?;
    wallet_session.validate_for_normal_signing_finalize_request_v2(&request, now_unix_ms)?;
    let admission =
        CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::from_finalize_request(
            &wallet_session,
            &request,
            now_unix_ms,
        )?;
    let trusted_admission = admission_bindings.apply_project_policy_to_normal_signing_admission_v1(
        &request.scope.request_id,
        derive_cloudflare_router_normal_signing_finalize_trusted_admission_v2(
            &request, &admission,
        )?,
    )?;
    if !trusted_admission.allows_signing_worker_forwarding()? {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "normal-signing v2 finalize Router admission did not allow SigningWorker forwarding",
        ));
    }
    authorized_operation.validate_for_wallet_session(&wallet_session)?;
    authorized_operation
        .authorized_operation
        .validate_for_finalize_request(&request, &admission.authorization)?;
    let authorized_operation_identity =
        authorized_operation.into_signing_worker_authorized_operation_identity()?;
    let authorization_id = authorized_operation.reusable_authorization_id()?.to_owned();
    let wallet_scope = authorized_operation.wallet_scope()?;
    let ownership_generation = authorized_operation.ownership_generation()?;
    let effect_claim = authorized_operation
        .authorized_operation
        .into_signing_worker_effect_claim(
            wallet_session.wallet_session_id.clone(),
            authorization_id,
        )?;
    CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2::new(
        ownership_generation,
        wallet_scope,
        request,
        admission,
        trusted_admission,
        authorized_operation_identity,
        effect_claim,
    )
}

/// Handles an authenticated public Router normal-signing v2 finalize request.
#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_router_normal_signing_finalize_authenticated_public_request_v2<
    Verifier,
>(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    request: RouterAbEd25519NormalSigningFinalizeRequestV2,
    authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    credential: CloudflareRouterWalletSessionCredentialV1,
    trusted_source_digest: PublicDigest32,
    verifier: Verifier,
) -> RouterAbProtocolResult<NormalSigningResponseV1>
where
    Verifier: CloudflareRouterWalletSessionVerifierV1,
{
    let admitted = admit_cloudflare_router_normal_signing_finalize_v2(
        runtime.admission_bindings(),
        now_unix_ms,
        request,
        authorized_operation,
        credential,
        trusted_source_digest,
        verifier,
    )?;
    execute_cloudflare_signing_worker_normal_signing_finalize_service_call_v2(
        env,
        wallet_objects,
        runtime.signing_worker_peer(),
        admitted,
    )
    .await
}

/// Activates server-output material through SigningWorker-private D1.
#[cfg(feature = "workers-rs")]
pub(crate) async fn activate_cloudflare_signing_worker_server_output_v1(
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    activation: CloudflareSigningWorkerRecipientProofBundleActivationRequestV1,
    activated_at_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerOutputActivationReceiptV1> {
    let selected_server = activation
        .activation_context
        .signer_set()
        .selected_server
        .clone();
    runtime
        .server_output_decrypt_key()
        .validate_matches_server(&selected_server)?;
    let mut private_key_bytes = load_cloudflare_server_output_hpke_private_key_bytes_v1(
        env,
        runtime.server_output_decrypt_key(),
    )?;
    let material = cloudflare_server_output_material_record_from_activation_request_v1(
        &activation,
        &private_key_bytes,
    );
    private_key_bytes.zeroize();
    let call = runtime.signing_worker_output_activate_request(
        activation.clone(),
        material?,
        activated_at_ms,
    )?;
    let response = execute_cloudflare_signing_worker_private_d1_request_v1(env, &call).await?;
    require_signing_worker_output_activate_response_v1(&call, response)
}

/// Activates Router A/B ECDSA derivation SigningWorker material.
#[cfg(feature = "workers-rs")]
#[cfg(feature = "strict-worker-signing-worker-entrypoint")]
pub(crate) async fn activate_cloudflare_router_ab_ecdsa_derivation_signing_worker_output_v1(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    activation: CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1,
    activated_at_ms: u64,
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1> {
    let opened = open_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_v1(
        runtime,
        &CloudflareWorkerEnvReaderV1::new(env),
        activation,
        activated_at_ms,
    )?;
    let (generic_activation, material) = opened.stored_parts();
    let signing_worker_output: CloudflareSigningWorkerOutputActivationReceiptV1 = {
        let response = durable_object::call_signing_worker_wallet_do_v1(
            env,
            wallet_objects,
            durable_object::SigningWorkerWalletDoRequestV1::ActivateEcdsa {
                ownership_generation: opened.ownership_generation(),
                scope: opened.wallet_scope().clone(),
                activation: generic_activation.clone(),
                material: material.clone(),
                activated_at_ms,
            },
        )
        .await?;
        parse_cloudflare_signing_worker_wallet_do_json_response_v1(
            response,
            "SigningWorker wallet-DO ECDSA activation",
        )
        .await?
    };
    opened.receipt(signing_worker_output)
}

/// Refreshes Router A/B ECDSA derivation SigningWorker material through SigningWorker-private D1.
#[cfg(feature = "workers-rs")]
pub(crate) async fn refresh_cloudflare_router_ab_ecdsa_derivation_signing_worker_output_v1(
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    activation: CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRefreshRequestV1,
    activated_at_ms: u64,
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1> {
    activation.validate()?;
    let selected_server = activation
        .activation_context
        .signer_set()
        .selected_server
        .clone();
    runtime
        .server_output_decrypt_key()
        .validate_matches_server(&selected_server)?;
    let generic_activation = activation.to_recipient_proof_bundle_activation_request()?;
    let custody_binding = activation
        .tenant_root_custody_binding
        .authenticate_for_refresh(
            &CloudflareWorkerEnvReaderV1::new(env),
            &activation.refresh_request,
            activated_at_ms,
        )?;
    let mut private_key_bytes = load_cloudflare_server_output_hpke_private_key_bytes_v1(
        env,
        runtime.server_output_decrypt_key(),
    )?;
    let material = cloudflare_server_output_material_record_from_ecdsa_refresh_request_v2(
        &activation,
        &custody_binding,
        &private_key_bytes,
    );
    private_key_bytes.zeroize();
    let material = material?;
    let call = runtime.signing_worker_output_activate_request(
        generic_activation,
        material.clone(),
        activated_at_ms,
    )?;
    let response = execute_cloudflare_signing_worker_private_d1_request_v1(env, &call).await?;
    let signing_worker_output =
        require_signing_worker_output_activate_response_v1(&call, response)?;
    let ecdsa_receipt =
        cloudflare_router_ab_ecdsa_derivation_activation_refresh_receipt_from_material_v1(
            &activation,
            &material,
            signing_worker_output
                .active_signing_worker_state
                .activated_at_ms,
        )?;
    CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1::new(
        ecdsa_receipt,
        signing_worker_output,
    )
}

/// Handles a SigningWorker v2 prepare request after active-state lookup.
pub fn handle_cloudflare_signing_worker_normal_signing_prepare_private_request_v2<Handler>(
    handler: &Handler,
    now_unix_ms: u64,
    request: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
    active_signing_worker: ActiveSigningWorkerStateV1,
    material: CloudflareServerOutputMaterialRecordV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerNormalSigningRound1PreparedV1>
where
    Handler: CloudflareSigningWorkerNormalSigningPrepareHandlerV2,
{
    request.validate()?;
    if now_unix_ms >= request.expires_at_ms {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            "normal-signing v2 prepare request expired",
        ));
    }
    let materialized = CloudflareSigningWorkerMaterializedNormalSigningPrepareRequestV2::new(
        request,
        active_signing_worker,
        material,
        now_unix_ms,
    )?;
    handler.handle_normal_signing_prepare_request_v2(materialized)
}

/// Handles a SigningWorker v2 finalize request after active-state and round-1 lookup.
pub fn handle_cloudflare_signing_worker_normal_signing_finalize_private_request_v2<Handler>(
    handler: &Handler,
    now_unix_ms: u64,
    request: CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    active_signing_worker: ActiveSigningWorkerStateV1,
    material: CloudflareServerOutputMaterialRecordV1,
    server_round1: CloudflareSigningWorkerRound1RecordV1,
) -> RouterAbProtocolResult<NormalSigningResponseV1>
where
    Handler: CloudflareSigningWorkerNormalSigningFinalizeHandlerV2,
{
    request.validate()?;
    request.request.validate_at(now_unix_ms)?;
    let expected_scope = request.request.scope.clone();
    let expected_signing_payload_digest = request.request.signing_payload_digest();
    let expected_signature_scheme = request.request.protocol.signature_scheme();
    let materialized = CloudflareSigningWorkerMaterializedNormalSigningFinalizeRequestV2::new(
        request,
        active_signing_worker,
        material,
        server_round1,
        now_unix_ms,
    )?;
    let response = handler.handle_normal_signing_finalize_request_v2(materialized)?;
    response.validate()?;
    if response.scope == expected_scope
        && response.signing_payload_digest == expected_signing_payload_digest
        && response.signature_scheme == expected_signature_scheme
    {
        return Ok(response);
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        "normal-signing v2 finalize response does not match admitted request",
    ))
}
