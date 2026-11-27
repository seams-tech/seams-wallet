//! JSON service calls between the Worker roles.

use super::*;

#[cfg(feature = "workers-rs")]
pub(crate) async fn post_service_json<TReq, TResp>(
    env: &worker::Env,
    binding_name: &str,
    url: &str,
    label: &str,
    request: &TReq,
) -> RouterAbProtocolResult<TResp>
where
    TReq: Serialize,
    TResp: serde::de::DeserializeOwned,
{
    let (response, _server_timing) = post_service_json_with_server_timing(
        env,
        None,
        binding_name,
        url,
        label,
        request,
        None,
        CloudflareServiceAuthModeV1::Shared,
    )
    .await?;
    Ok(response)
}

#[cfg(feature = "workers-rs")]
pub(super) async fn post_service_json_with_router_to_signing_worker_ecdsa_auth<TReq, TResp>(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    binding_name: &str,
    url: &str,
    label: &str,
    request: &TReq,
) -> RouterAbProtocolResult<TResp>
where
    TReq: Serialize,
    TResp: serde::de::DeserializeOwned,
{
    let (response, _server_timing) = post_service_json_with_server_timing(
        env,
        Some(wallet_objects),
        binding_name,
        url,
        label,
        request,
        None,
        CloudflareServiceAuthModeV1::RouterToSigningWorkerEcdsa,
    )
    .await?;
    Ok(response)
}

#[cfg(feature = "workers-rs")]
pub(super) enum CloudflareServiceAuthModeV1 {
    Shared,
    RouterToSigningWorkerEcdsa,
}

/// As `post_service_json`, but also returns the peer's own `Server-Timing`
/// header so the Router can fold role-local spans into its own. The header is
/// diagnostics only and never affects the response.
#[cfg(feature = "workers-rs")]
pub(super) async fn post_service_json_with_server_timing<TReq, TResp>(
    env: &worker::Env,
    wallet_objects: Option<crate::WalletObjectRoute>,
    binding_name: &str,
    url: &str,
    label: &str,
    request: &TReq,
    trace_id: Option<CloudflareTraceIdV1>,
    auth_mode: CloudflareServiceAuthModeV1,
) -> RouterAbProtocolResult<(TResp, Option<String>)>
where
    TReq: Serialize,
    TResp: serde::de::DeserializeOwned,
{
    let fetcher = env.service(binding_name).map_err(|err| {
        worker_binding_error(
            worker_binding_error_code(&err, binding_name),
            binding_name,
            "service",
            err,
        )
    })?;
    let request_body = cloudflare_service_json_request_body_v1(label, request)?;
    let headers = worker::Headers::new();
    if let Some(route) = wallet_objects { route.set_headers(&headers)?; }
    headers
        .set("content-type", "application/json")
        .map_err(|err| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{label} header construction failed: {err}"),
            )
        })?;
    match auth_mode {
        CloudflareServiceAuthModeV1::Shared => {
            set_cloudflare_internal_service_auth_header_v1(env, &headers, label)?;
        }
        CloudflareServiceAuthModeV1::RouterToSigningWorkerEcdsa => {
            set_cloudflare_router_to_signing_worker_ecdsa_auth_header_v1(env, &headers, label)?;
        }
    }
    if let Some(trace_id) = trace_id {
        set_cloudflare_trace_id_header_v1(&headers, trace_id)?;
    }
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_headers(headers)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&request_body)));
    let request_for_fetch = worker::Request::new_with_init(url, &init).map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} service request construction failed: {err}"),
        )
    })?;
    let mut io_timing = CloudflareEcdsaBoundaryTimingV1::new();
    let headers_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let mut response = fetcher
        .fetch_request(request_for_fetch)
        .await
        .map_err(|err| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{label} service request failed: {err}"),
            )
        })?;
    io_timing.mark("service_response_headers", headers_started_at_ms);
    let status = response.status_code();
    if !(200..=299).contains(&status) {
        let response_body = response.text().await.map_err(|err| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} error response body read failed: {err}"),
            )
        })?;
        return Err(RouterAbProtocolError::new(
            router_ab_peer_error_code_v1(&response_body),
            format!(
                "{label} service returned HTTP status {status}: {}",
                response_body.trim()
            ),
        ));
    }
    // Read before the body is consumed; a missing header is the normal case.
    let server_timing = response.headers().get("Server-Timing").ok().flatten();
    let body_started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let parsed = response.json::<TResp>().await.map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{label} response JSON parse failed: {err}"),
        )
    })?;
    io_timing.mark("service_response_body", body_started_at_ms);
    if matches!(
        label,
        "Router A/B ECDSA derivation prepare" | "Router A/B ECDSA derivation finalize"
    ) {
        io_timing.emit_io_diagnostic();
    }
    Ok((parsed, server_timing))
}

#[cfg(feature = "workers-rs")]
pub(super) async fn execute_cloudflare_router_ab_ecdsa_derivation_deriver_registration_service_call_v1(
    env: &worker::Env,
    peer: &CloudflarePeerBindingV1,
    private_request: &CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1,
    trace_id: Option<CloudflareTraceIdV1>,
) -> RouterAbProtocolResult<(
    CloudflareSignerRecipientProofBundleResponseV1,
    Option<String>,
)> {
    peer.validate()?;
    private_request.validate_for_worker_role(peer.peer_role)?;
    let label = format!(
        "{} Router A/B ECDSA derivation registration service request",
        peer.peer_role.as_str()
    );
    post_service_json_with_server_timing(
        env,
        None,
        &peer.binding_name,
        cloudflare_router_ab_ecdsa_derivation_deriver_registration_service_url(peer)?,
        &label,
        private_request,
        trace_id,
        CloudflareServiceAuthModeV1::Shared,
    )
    .await
}

#[cfg(feature = "workers-rs")]
pub(super) async fn execute_cloudflare_router_ab_ecdsa_derivation_deriver_export_service_call_v1(
    env: &worker::Env,
    peer: &CloudflarePeerBindingV1,
    private_request: &CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1,
) -> RouterAbProtocolResult<CloudflareSignerClientRecipientProofBundleResponseV1> {
    peer.validate()?;
    let label = format!(
        "{} Router A/B ECDSA derivation export service request",
        peer.peer_role.as_str()
    );
    post_service_json(
        env,
        &peer.binding_name,
        cloudflare_router_ab_ecdsa_derivation_deriver_export_service_url(peer)?,
        &label,
        private_request,
    )
    .await
}

#[cfg(feature = "workers-rs")]
pub(super) async fn execute_cloudflare_router_ab_ecdsa_derivation_deriver_activation_refresh_service_call_v1(
    env: &worker::Env,
    peer: &CloudflarePeerBindingV1,
    refresh_request: &RouterAbEcdsaDerivationActivationRefreshRequestV1,
    public_request: &EcdsaThresholdPrfRequestV1,
    message: &WireMessageV1,
    tenant_root_custody_binding: &CloudflareTenantRootCustodyBindingWireV1,
) -> RouterAbProtocolResult<CloudflareSignerRecipientProofBundleResponseV1> {
    peer.validate()?;
    validate_cloudflare_signer_private_request_v1(peer.peer_role, message)?;
    let signer_bootstrap = cloudflare_signer_private_bootstrap_from_public_request_v1(
        peer.peer_role,
        public_request,
        message.clone(),
    )?;
    let private_request =
        CloudflareRouterAbEcdsaDerivationDeriverActivationRefreshPrivateRequestV1::new(
            peer.peer_role,
            refresh_request.clone(),
            signer_bootstrap,
            tenant_root_custody_binding.clone(),
        )?;
    let label = format!(
        "{} Router A/B ECDSA derivation activation-refresh service request",
        peer.peer_role.as_str()
    );
    let response: CloudflareSignerRecipientProofBundleResponseV1 = post_service_json(
        env,
        &peer.binding_name,
        cloudflare_router_ab_ecdsa_derivation_deriver_refresh_service_url(peer)?,
        &label,
        &private_request,
    )
    .await?;
    validate_cloudflare_signer_recipient_proof_bundle_private_response_v1(
        peer.peer_role,
        message,
        &response,
    )?;
    Ok(response)
}

#[cfg(feature = "workers-rs")]
pub(super) async fn execute_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_service_call_v1(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    peer: &CloudflarePeerBindingV1,
    request: &CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1,
    trace_id: Option<CloudflareTraceIdV1>,
) -> RouterAbProtocolResult<(
    CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1,
    Option<String>,
)> {
    peer.validate()?;
    if peer.peer_role != CloudflareWorkerRoleV1::SigningWorker {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "strict Router A/B ECDSA derivation SigningWorker activation must target SigningWorker",
        ));
    }
    request.validate()?;
    let (receipt, server_timing): (
        CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1,
        _,
    ) = post_service_json_with_server_timing(
        env,
        Some(wallet_objects),
        &peer.binding_name,
        cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_service_url(peer)?,
        "Router A/B ECDSA derivation SigningWorker activation request",
        request,
        trace_id,
        CloudflareServiceAuthModeV1::RouterToSigningWorkerEcdsa,
    )
    .await?;
    receipt.validate()?;
    Ok((receipt, server_timing))
}

#[cfg(feature = "workers-rs")]
pub(super) async fn execute_cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_refresh_service_call_v1(
    env: &worker::Env,
    peer: &CloudflarePeerBindingV1,
    request: &CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1> {
    peer.validate()?;
    if peer.peer_role != CloudflareWorkerRoleV1::SigningWorker {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "strict Router A/B ECDSA derivation SigningWorker activation refresh must target SigningWorker",
        ));
    }
    request.validate()?;
    let receipt: CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1 =
        post_service_json(
            env,
            &peer.binding_name,
            cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_refresh_service_url(
                peer,
            )?,
            "Router A/B ECDSA derivation SigningWorker activation-refresh request",
            request,
        )
        .await?;
    receipt.validate()?;
    Ok(receipt)
}

#[cfg(feature = "workers-rs")]
pub(super) async fn execute_cloudflare_router_ab_ecdsa_derivation_signing_worker_export_share_service_call_v1(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    peer: &CloudflarePeerBindingV1,
    request: &CloudflareSigningWorkerEcdsaExportShareRequestV1,
) -> RouterAbProtocolResult<EcdsaSigningWorkerExportShareEnvelopeV1> {
    peer.validate()?;
    if peer.peer_role != CloudflareWorkerRoleV1::SigningWorker {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "strict Router A/B ECDSA export-share redemption must target SigningWorker",
        ));
    }
    request
        .export_authority
        .validate_for_request(&request.request)?;
    request
        .material_source
        .validate_for_ecdsa_scope(&request.export_authority.normal_signing_scope)?;
    let envelope: EcdsaSigningWorkerExportShareEnvelopeV1 = post_service_json_with_server_timing(
        env,
        Some(wallet_objects),
        &peer.binding_name,
        cloudflare_router_ab_ecdsa_derivation_signing_worker_export_share_service_url(peer)?,
        "Router A/B ECDSA SigningWorker export-share request",
        request,
        None,
        CloudflareServiceAuthModeV1::Shared,
    )
    .await?.0;
    validate_cloudflare_signing_worker_ecdsa_export_share_envelope_v1(envelope)
}

#[cfg(feature = "workers-rs")]
pub(super) async fn execute_cloudflare_router_ab_ecdsa_derivation_signing_worker_export_preflight_service_call_v1(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    peer: &CloudflarePeerBindingV1,
    request: &CloudflareSigningWorkerEcdsaExportShareRequestV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaExportPreflightResponseV1> {
    peer.validate()?;
    if peer.peer_role != CloudflareWorkerRoleV1::SigningWorker {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "strict Router A/B ECDSA export preflight must target SigningWorker",
        ));
    }
    request
        .export_authority
        .validate_for_request(&request.request)?;
    request
        .material_source
        .validate_for_ecdsa_scope(&request.export_authority.normal_signing_scope)?;
    let response: CloudflareSigningWorkerEcdsaExportPreflightResponseV1 = post_service_json_with_server_timing(
        env,
        Some(wallet_objects),
        &peer.binding_name,
        cloudflare_router_ab_ecdsa_derivation_signing_worker_export_preflight_service_url(peer)?,
        "Router A/B ECDSA SigningWorker export preflight",
        request,
        None,
        CloudflareServiceAuthModeV1::Shared,
    )
    .await?.0;
    if !response.ready {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "SigningWorker rejected active ECDSA export material preflight",
        ));
    }
    Ok(response)
}

/// Sends one Router A/B ECDSA derivation normal-signing prepare request from Router to SigningWorker.
#[cfg(feature = "workers-rs")]
pub async fn execute_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_prepare_service_call_v1(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    peer: &CloudflarePeerBindingV1,
    request: CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
) -> RouterAbProtocolResult<CloudflareEcdsaPrepareResponseV1> {
    let mut transport =
        ecdsa_normal_signing_transport::CloudflareWorkerEcdsaNormalSigningServiceTransportV1::new(
            env, wallet_objects,
        );
    ecdsa_normal_signing_transport::execute_cloudflare_router_ab_ecdsa_normal_signing_prepare_with_transport_v1(
        &mut transport,
        peer,
        request,
    )
    .await
}

/// Sends one Router A/B ECDSA derivation normal-signing finalize request from Router to SigningWorker.
#[cfg(feature = "workers-rs")]
pub async fn execute_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_service_call_v1(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    peer: &CloudflarePeerBindingV1,
    request: CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationEvmDigestSigningResponseV1> {
    let mut transport =
        ecdsa_normal_signing_transport::CloudflareWorkerEcdsaNormalSigningServiceTransportV1::new(
            env, wallet_objects,
        );
    ecdsa_normal_signing_transport::execute_cloudflare_router_ab_ecdsa_normal_signing_finalize_with_transport_v1(
        &mut transport,
        peer,
        request,
    )
    .await
}

/// Sends one admitted linked-device ECDSA finalize request to SigningWorker.
#[cfg(feature = "workers-rs")]
pub(crate) async fn execute_cloudflare_signing_worker_linked_device_ecdsa_finalize_service_call_v1(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    peer: &CloudflarePeerBindingV1,
    request: CloudflareSigningWorkerAdmittedLinkedDeviceEcdsaFinalizeRequestV1,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationLinkedDeviceEvmDigestSigningResponseV1> {
    peer.validate()?;
    if peer.peer_role != CloudflareWorkerRoleV1::SigningWorker {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "linked ECDSA finalize must target SigningWorker",
        ));
    }
    request.validate()?;
    let (response, _): (RouterAbEcdsaDerivationLinkedDeviceEvmDigestSigningResponseV1, _) =
        post_service_json_with_server_timing(
            env,
            Some(wallet_objects),
            &peer.binding_name,
            cloudflare_signing_worker_linked_device_ecdsa_finalize_service_url(peer)?,
            "linked ECDSA finalize",
            &request,
            None,
            CloudflareServiceAuthModeV1::Shared,
        )
        .await?;
    response.validate_for_request(&request.request)?;
    Ok(response)
}
