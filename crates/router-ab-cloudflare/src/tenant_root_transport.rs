//! Tenant-root private calls between roles, independent of their host.
//!
//! The Router, the tenant-root control plane and both Derivers exchange typed
//! JSON over private, role-authenticated calls. On Cloudflare each call is a
//! Service Binding fetch; a VM role posts the same JSON over HTTP to the
//! peer's configured origin. The requests, their size bounds and the checks
//! applied to each response live here once, so both hosts run the same
//! protocol.

use router_ab_core::{TenantRootCommandTerminalReceiptV1, TwoPartyDeriverRole};
use serde::{de::DeserializeOwned, Serialize};

use crate::tenant_root_control_plane::{
    CloudflareTenantRootControlPlaneCleanupCommandRequestV1,
    CloudflareTenantRootControlPlaneCleanupCommandResponseV1,
    CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
    CloudflareTenantRootControlPlaneCreateTenantRootResponseV1,
    CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1,
    CloudflareTenantRootControlPlaneInitialActivationRequestV1,
    CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1,
    CloudflareTenantRootControlPlaneRoleCreationCommandResponseV1,
    TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_RESPONSE_MAX_BYTES_V1,
};
use crate::tenant_root_role_runtime::{
    CloudflareDeriverTenantRootCleanupRequestV1, CloudflareDeriverTenantRootCleanupResponseV1,
    CloudflareDeriverTenantRootCreateRoleShareRequestV1,
    CloudflareDeriverTenantRootCreateRoleShareResponseV1,
    CloudflareDeriverTenantRootInitialActivationRequestV1,
    CloudflareDeriverTenantRootInitialActivationResponseV1, CloudflareTenantRootCreateRoleV1,
};
use crate::{
    decode_base64url_bytes_v1, RouterAbProtocolError, RouterAbProtocolErrorCode,
    RouterAbProtocolResult, CLOUDFLARE_DERIVER_TENANT_ROOT_CLEANUP_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_DERIVER_TENANT_ROOT_CREATE_ROLE_SHARE_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_DERIVER_TENANT_ROOT_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CREATE_TENANT_ROOT_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_ROLE_CREATION_COMMAND_PRIVATE_REQUEST_PATH,
};

/// The role a tenant-root private call is addressed to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TenantRootServiceTargetV1 {
    ControlPlane,
    Deriver(TwoPartyDeriverRole),
}

/// Size bounds a call enforces on its serialized request and its response.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TenantRootCallBoundsV1 {
    pub request_max_bytes: usize,
    pub response_max_bytes: usize,
}

/// Sends one tenant-root private call with the role-shared service credential.
#[allow(async_fn_in_trait)]
pub trait TenantRootServiceTransportV1 {
    /// POSTs `request` as JSON to `path` on `target` and decodes a 2xx JSON
    /// response. A non-2xx status is an error carrying the peer's body.
    async fn post_private_json<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        target: TenantRootServiceTargetV1,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        bounds: Option<TenantRootCallBoundsV1>,
    ) -> RouterAbProtocolResult<TResponse>;
}

/// Asks the control plane to verify a creation grant and start, or report, its
/// creation journal.
pub async fn tenant_root_control_plane_create_tenant_root_call_v1(
    transport: &impl TenantRootServiceTransportV1,
    request: &CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneCreateTenantRootResponseV1> {
    transport
        .post_private_json(
            TenantRootServiceTargetV1::ControlPlane,
            CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CREATE_TENANT_ROOT_PRIVATE_REQUEST_PATH,
            "tenant-root control-plane genesis request",
            request,
            None,
        )
        .await
}

/// Requests one Deriver's issuer-signed role-creation command.
pub async fn tenant_root_control_plane_role_creation_command_call_v1(
    transport: &impl TenantRootServiceTransportV1,
    request: &CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneRoleCreationCommandResponseV1> {
    let response: CloudflareTenantRootControlPlaneRoleCreationCommandResponseV1 = transport
        .post_private_json(
            TenantRootServiceTargetV1::ControlPlane,
            CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_ROLE_CREATION_COMMAND_PRIVATE_REQUEST_PATH,
            "tenant-root control-plane role-command request",
            request,
            None,
        )
        .await?;
    if response.role != request.role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root control-plane role-command response names the wrong role",
        ));
    }
    Ok(response)
}

/// Requests the issuer-signed initial activation receipt for one creation.
pub async fn tenant_root_control_plane_initial_activation_call_v1(
    transport: &impl TenantRootServiceTransportV1,
    request: &CloudflareTenantRootControlPlaneInitialActivationRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1> {
    let response: CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1 = transport
        .post_private_json(
            TenantRootServiceTargetV1::ControlPlane,
            CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH,
            "tenant-root control-plane initial activation request",
            request,
            Some(TenantRootCallBoundsV1 {
                request_max_bytes: TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
                response_max_bytes: TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_RESPONSE_MAX_BYTES_V1,
            }),
        )
        .await?;
    crate::tenant_root_control_plane::require_initial_activation_receipt_response_v1(&response)?;
    Ok(response)
}

/// Requests one issuer-signed role cleanup command from the control plane.
pub async fn tenant_root_control_plane_cleanup_command_call_v1(
    transport: &impl TenantRootServiceTransportV1,
    request: &CloudflareTenantRootControlPlaneCleanupCommandRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneCleanupCommandResponseV1> {
    transport
        .post_private_json(
            TenantRootServiceTargetV1::ControlPlane,
            CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_PRIVATE_REQUEST_PATH,
            "tenant-root control-plane cleanup-command request",
            request,
            None,
        )
        .await
}

/// Sends one authorized role-share cleanup to its owning Deriver and checks
/// the Deriver's role.
pub async fn tenant_root_deriver_cleanup_call_v1(
    transport: &impl TenantRootServiceTransportV1,
    role: TwoPartyDeriverRole,
    request: &CloudflareDeriverTenantRootCleanupRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootCleanupResponseV1> {
    let response: CloudflareDeriverTenantRootCleanupResponseV1 = transport
        .post_private_json(
            TenantRootServiceTargetV1::Deriver(role),
            CLOUDFLARE_DERIVER_TENANT_ROOT_CLEANUP_PRIVATE_REQUEST_PATH,
            "tenant-root cleanup request",
            request,
            None,
        )
        .await?;
    if response.role() != CloudflareTenantRootCreateRoleV1::from_protocol(role) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root cleanup response names the wrong role",
        ));
    }
    Ok(response)
}

/// Asks one Deriver to create, or complete, its tenant-root role share.
pub async fn tenant_root_deriver_create_role_share_call_v1(
    transport: &impl TenantRootServiceTransportV1,
    role: TwoPartyDeriverRole,
    request: &CloudflareDeriverTenantRootCreateRoleShareRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootCreateRoleShareResponseV1> {
    transport
        .post_private_json(
            TenantRootServiceTargetV1::Deriver(role),
            CLOUDFLARE_DERIVER_TENANT_ROOT_CREATE_ROLE_SHARE_PRIVATE_REQUEST_PATH,
            "tenant-root role creation peer request",
            request,
            None,
        )
        .await
}

/// Sends one initial activation receipt to its owning Deriver and checks the
/// Deriver's role and terminal receipt.
pub async fn tenant_root_deriver_initial_activation_call_v1(
    transport: &impl TenantRootServiceTransportV1,
    role: TwoPartyDeriverRole,
    request: &CloudflareDeriverTenantRootInitialActivationRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootInitialActivationResponseV1> {
    let response: CloudflareDeriverTenantRootInitialActivationResponseV1 = transport
        .post_private_json(
            TenantRootServiceTargetV1::Deriver(role),
            CLOUDFLARE_DERIVER_TENANT_ROOT_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH,
            "tenant-root initial activation request",
            request,
            None,
        )
        .await?;
    if response.role != CloudflareTenantRootCreateRoleV1::from_protocol(role) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root initial-activation response names the wrong role",
        ));
    }
    let receipt_bytes = decode_base64url_bytes_v1(
        "tenant-root initial-activation terminal receipt",
        &response.activation_terminal_receipt_b64u,
    )?;
    TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .map_err(crate::map_root_share_to_protocol)?;
    Ok(response)
}

/// The Cloudflare transport: Service Bindings to the control plane and the
/// Derivers this Worker is bound to.
#[cfg(feature = "workers-rs")]
pub(crate) struct CloudflareTenantRootServiceTransportV1<'a> {
    env: &'a worker::Env,
    deriver_a: Option<&'a crate::CloudflarePeerBindingV1>,
    deriver_b: Option<&'a crate::CloudflarePeerBindingV1>,
}

#[cfg(feature = "workers-rs")]
impl<'a> CloudflareTenantRootServiceTransportV1<'a> {
    pub(crate) const fn new(
        env: &'a worker::Env,
        deriver_a: Option<&'a crate::CloudflarePeerBindingV1>,
        deriver_b: Option<&'a crate::CloudflarePeerBindingV1>,
    ) -> Self {
        Self {
            env,
            deriver_a,
            deriver_b,
        }
    }

    /// A transport that reaches one peer Deriver only.
    pub(crate) fn peer(env: &'a worker::Env, peer: &'a crate::CloudflarePeerBindingV1) -> Self {
        match peer.peer_role {
            crate::CloudflareWorkerRoleV1::DeriverA => Self::new(env, Some(peer), None),
            _ => Self::new(env, None, Some(peer)),
        }
    }

    fn binding_and_origin(
        &self,
        target: TenantRootServiceTargetV1,
    ) -> RouterAbProtocolResult<(&str, &'static str)> {
        let (peer, expected, origin) = match target {
            TenantRootServiceTargetV1::ControlPlane => {
                return Ok((
                    crate::TENANT_ROOT_CONTROL_PLANE_SERVICE_BINDING_V1,
                    "https://router-ab-tenant-root-control-plane.internal",
                ))
            }
            TenantRootServiceTargetV1::Deriver(TwoPartyDeriverRole::DeriverA) => (
                self.deriver_a,
                crate::CloudflareWorkerRoleV1::DeriverA,
                "https://router-ab-deriver-a.internal",
            ),
            TenantRootServiceTargetV1::Deriver(TwoPartyDeriverRole::DeriverB) => (
                self.deriver_b,
                crate::CloudflareWorkerRoleV1::DeriverB,
                "https://router-ab-deriver-b.internal",
            ),
        };
        let peer = peer.ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingLocalBinding,
                "this Worker has no Service Binding to the addressed Deriver",
            )
        })?;
        peer.validate()?;
        if peer.peer_role != expected {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "Deriver Service Binding names the wrong peer role",
            ));
        }
        Ok((peer.binding_name.as_str(), origin))
    }
}

#[cfg(feature = "workers-rs")]
impl TenantRootServiceTransportV1 for CloudflareTenantRootServiceTransportV1<'_> {
    async fn post_private_json<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        target: TenantRootServiceTargetV1,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        bounds: Option<TenantRootCallBoundsV1>,
    ) -> RouterAbProtocolResult<TResponse> {
        let (binding_name, origin) = self.binding_and_origin(target)?;
        let url = format!("{origin}{path}");
        match bounds {
            None => crate::post_service_json(self.env, binding_name, &url, label, request).await,
            Some(bounds) => {
                crate::tenant_root_control_plane::post_bounded_service_json_v1(
                    self.env,
                    binding_name,
                    &url,
                    label,
                    request,
                    bounds,
                )
                .await
            }
        }
    }
}
