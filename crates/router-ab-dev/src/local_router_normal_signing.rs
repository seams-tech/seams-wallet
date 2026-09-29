//! VM Router NEAR normal signing.
//!
//! The Gateway forwards an owner-lane request carrying its authorized
//! operation: an owner Wallet Session or a verified operation step-up.
//! Admission is the Cloudflare Router's own
//! `admit_cloudflare_router_normal_signing_*_v2`, so the VM Router forwards
//! to SigningWorker exactly what the Cloudflare Router would, and accepts only
//! a response that matches that admitted request.

use router_ab_cloudflare::{
    admit_cloudflare_router_normal_signing_finalize_v2,
    admit_cloudflare_router_normal_signing_prepare_v2,
    admit_cloudflare_router_normal_signing_step_up_finalize_v2,
    admit_cloudflare_router_normal_signing_step_up_prepare_v2,
    build_cloudflare_router_ed25519_jwks_jwt_verifier_v1,
    parse_cloudflare_router_authorized_ed25519_finalize_request_v2_json,
    parse_cloudflare_router_authorized_ed25519_prepare_request_v2_json,
    require_signing_worker_normal_signing_finalize_response_v2,
    require_signing_worker_normal_signing_prepare_response_v2, router_trusted_source_digest_v1,
    CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    CloudflareRouterEd25519AcceptedCapabilityBindingV1,
};
use router_ab_core::{
    NormalSigningResponseV1, NormalSigningRound1PrepareResponseV1, RouterAbProtocolError,
    RouterAbProtocolErrorCode, RouterAbProtocolResult,
};
use std::time::{SystemTime, UNIX_EPOCH};

use super::{
    LocalDevHttpRequestPartsV1, LocalHttpServiceBindingClientV1, LocalRouterWorkerConfigV1,
    LocalServiceRoleV1, LOCAL_ROUTER_NORMAL_SIGNING_PATH,
    LOCAL_ROUTER_NORMAL_SIGNING_PREPARE_PATH, LOCAL_SIGNING_WORKER_NORMAL_SIGNING_PATH,
    LOCAL_SIGNING_WORKER_NORMAL_SIGNING_PREPARE_PATH,
};

/// True for the two Router NEAR signing routes this module serves.
pub(crate) fn is_local_router_normal_signing_path_v1(path: &str) -> bool {
    path == LOCAL_ROUTER_NORMAL_SIGNING_PREPARE_PATH || path == LOCAL_ROUTER_NORMAL_SIGNING_PATH
}

/// Serves one Gateway-forwarded NEAR prepare or finalize and returns the
/// SigningWorker response JSON.
pub(crate) fn serve_local_router_normal_signing_v1(
    client: &LocalHttpServiceBindingClientV1,
    config: &LocalRouterWorkerConfigV1,
    request: &LocalDevHttpRequestPartsV1,
) -> RouterAbProtocolResult<String> {
    let now_unix_ms = local_now_ms_v1()?;
    // A VM Router has no edge source metadata; the digest still binds the
    // Gateway-owner credential to this admission exactly as on Cloudflare.
    let trusted_source_digest = router_trusted_source_digest_v1(None, None);
    let verifier = build_cloudflare_router_ed25519_jwks_jwt_verifier_v1(
        &config.admission_bindings.jwt,
    )?;
    if request.path == LOCAL_ROUTER_NORMAL_SIGNING_PREPARE_PATH {
        let (signing_request, authorized_operation) =
            parse_cloudflare_router_authorized_ed25519_prepare_request_v2_json(&request.body)?;
        let admitted = match gateway_near_authorization(&authorized_operation, request)? {
            GatewayNearAuthorizationV1::OwnerWalletSession => {
                let credential = authorized_operation
                    .gateway_owner_wallet_session_credential(trusted_source_digest)?;
                admit_cloudflare_router_normal_signing_prepare_v2(
                    &config.admission_bindings,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    credential,
                    trusted_source_digest,
                    verifier,
                )?
            }
            GatewayNearAuthorizationV1::OperationStepUp => {
                admit_cloudflare_router_normal_signing_step_up_prepare_v2(
                    &config.admission_bindings,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    trusted_source_digest,
                )?
            }
        };
        let response = client.post_json_authenticated_v1::<_, NormalSigningRound1PrepareResponseV1>(
            &config.signing_worker_url,
            LocalServiceRoleV1::SigningWorker,
            LOCAL_SIGNING_WORKER_NORMAL_SIGNING_PREPARE_PATH,
            &config.internal_service_auth,
            &admitted,
        )?;
        let response = require_signing_worker_normal_signing_prepare_response_v2(&admitted, response)?;
        return encode(&response);
    }
    let (signing_request, authorized_operation) =
        parse_cloudflare_router_authorized_ed25519_finalize_request_v2_json(&request.body)?;
    let admitted = match gateway_near_authorization(&authorized_operation, request)? {
        GatewayNearAuthorizationV1::OwnerWalletSession => {
            let credential = authorized_operation
                .gateway_owner_wallet_session_credential(trusted_source_digest)?;
            admit_cloudflare_router_normal_signing_finalize_v2(
                &config.admission_bindings,
                now_unix_ms,
                signing_request,
                authorized_operation,
                credential,
                trusted_source_digest,
                verifier,
            )?
        }
        GatewayNearAuthorizationV1::OperationStepUp => {
            admit_cloudflare_router_normal_signing_step_up_finalize_v2(
                &config.admission_bindings,
                now_unix_ms,
                signing_request,
                authorized_operation,
                trusted_source_digest,
            )?
        }
    };
    let response = client.post_json_authenticated_v1::<_, NormalSigningResponseV1>(
        &config.signing_worker_url,
        LocalServiceRoleV1::SigningWorker,
        LOCAL_SIGNING_WORKER_NORMAL_SIGNING_PATH,
        &config.internal_service_auth,
        &admitted,
    )?;
    let response = require_signing_worker_normal_signing_finalize_response_v2(&admitted, response)?;
    encode(&response)
}

/// How the Gateway authorized one forwarded NEAR signing request. The VM
/// Router serves an owner Wallet Session and a verified operation step-up;
/// linked-device signing fails closed.
enum GatewayNearAuthorizationV1 {
    OwnerWalletSession,
    OperationStepUp,
}

fn gateway_near_authorization(
    authorized_operation: &CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    request: &LocalDevHttpRequestPartsV1,
) -> RouterAbProtocolResult<GatewayNearAuthorizationV1> {
    match &authorized_operation.binding {
        CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession { .. } => {
            // The Gateway strips the user's bearer token; a Wallet Session
            // request that still carries one did not come through its proxy.
            if request.authorization.is_some() {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
                    "Gateway Wallet Session requests must omit Authorization",
                ));
            }
            Ok(GatewayNearAuthorizationV1::OwnerWalletSession)
        }
        CloudflareRouterEd25519AcceptedCapabilityBindingV1::OperationStepUp { .. } => {
            Ok(GatewayNearAuthorizationV1::OperationStepUp)
        }
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "VM Router normal signing serves Gateway owner Wallet Sessions and verified step-up",
        )),
    }
}

fn encode<T: serde::Serialize>(value: &T) -> RouterAbProtocolResult<String> {
    serde_json::to_string(value).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("normal-signing response encoding failed: {error}"),
        )
    })
}

fn local_now_ms_v1() -> RouterAbProtocolResult<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
        .map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "local system clock predates the Unix epoch",
            )
        })
}
