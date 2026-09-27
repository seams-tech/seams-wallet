use super::cors::{
    cloudflare_router_normal_signing_preflight_response_v1,
    cloudflare_router_normal_signing_response_v1,
    cloudflare_router_public_keyset_preflight_response_v1,
    cloudflare_router_public_keyset_response_v1,
};
use super::*;
use crate::durable_object::tenant_root_creation::{
    decode_bounded_json_request,
    execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1,
    tenant_root_scheduled_refresh_next_at_ms_v1,
    CloudflareTenantRootDestinationBootstrapRequestV1, CloudflareTenantRootRefreshJobReadV1,
    TENANT_ROOT_DESTINATION_BOOTSTRAP_REQUEST_MAX_BYTES_V1,
};
#[cfg(feature = "strict-worker-router-entrypoint")]
use crate::post_service_json;
use crate::tenant_root_creation_coordinator::CloudflareRouterTenantRootCreationHostV1;
#[cfg(feature = "strict-worker-router-entrypoint")]
use crate::tenant_root_managed_restore_coordinator::decode_exact_tenant_root_wire_v1;
use crate::tenant_root_refresh_coordinator::{
    CloudflareRouterTenantRootRefreshRequestV1, CloudflareRouterTenantRootRefreshResponseV1,
    CloudflareRouterTenantRootRefreshResultV1,
};
use crate::tenant_root_control_plane::{
    CloudflareTenantRootControlPlaneRegisterManifestRequestV1,
    CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1,
    CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1,
    TENANT_ROOT_CONTROL_PLANE_REGISTER_MANIFEST_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_RESTORE_REFRESH_COMMANDS_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_REQUEST_MAX_BYTES_V1,
};
use crate::tenant_root_role_runtime::{
    CloudflareDeriverTenantRootStatusRequestV1, CloudflareDeriverTenantRootStatusResponseV1,
    CloudflareTenantRootCreateRoleV1,
};
#[cfg(feature = "strict-worker-router-entrypoint")]
use crate::{
    execute_cloudflare_signing_worker_linked_device_ecdsa_finalize_service_call_v1,
    handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_finalize_internal_step_up_request_v1,
    handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_prepare_internal_step_up_request_v1,
    handle_cloudflare_router_normal_signing_finalize_internal_linked_device_request_v2,
    handle_cloudflare_router_normal_signing_finalize_internal_step_up_request_v2,
    handle_cloudflare_router_normal_signing_prepare_internal_linked_device_request_v2,
    handle_cloudflare_router_normal_signing_prepare_internal_step_up_request_v2,
    parse_cloudflare_router_authorized_ed25519_prepare_request_v2_json,
    parse_cloudflare_router_authorized_linked_device_ecdsa_finalize_request_v1_json,
    require_cloudflare_gateway_to_router_auth_request_v1, CloudflarePeerBindingV1,
    CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    CloudflareRouterEcdsaAcceptedCapabilityBindingV1,
    CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    CloudflareRouterEd25519AcceptedCapabilityBindingV1, CloudflareRouterEd25519JwksJwtVerifierV1,
    CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
    CloudflareTenantRootControlPlaneCreateTenantRootResponseV1,
    CLOUDFLARE_ROUTER_TENANT_ROOT_CREATION_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_ROUTER_TENANT_ROOT_DESTINATION_BOOTSTRAP_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_ROUTER_TENANT_ROOT_DESTINATION_BOOTSTRAP_TOKEN_HEADER_V1,
    CLOUDFLARE_ROUTER_TENANT_ROOT_MANAGED_RESTORE_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_ROUTER_TENANT_ROOT_REFRESH_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ACTIVATION_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_REGISTER_MANIFEST_PRIVATE_REQUEST_PATH,
    CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_KEY_PRIVATE_REQUEST_PATH,
    TENANT_ROOT_CONTROL_PLANE_CREATE_TENANT_ROOT_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_REFRESH_COMMANDS_REQUEST_MAX_BYTES_V1,
};
#[cfg(feature = "strict-worker-router-entrypoint")]
use std::time::Duration;
#[cfg(feature = "strict-worker-router-entrypoint")]
use worker::Delay;

#[cfg(feature = "strict-worker-router-entrypoint")]
const TENANT_ROOT_DERIVER_STATUS_TIMEOUT: Duration = Duration::from_secs(2);

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct CloudflareRouterTenantRootStatusRequestV1 {
    identity_digest_b64u: String,
    custody_lineage_b64u: String,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum CloudflareRouterTenantRootDeriverHealthV1 {
    Healthy,
    Degraded,
    Unavailable,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(serde::Serialize)]
struct CloudflareRouterTenantRootStatusResponseV1 {
    identity_digest_b64u: String,
    custody_lineage_b64u: String,
    lifecycle_revision: u64,
    active_epoch: u64,
    root_commitment_b64u: String,
    activation_receipt_digest_b64u: String,
    last_refresh_completed_at_ms: Option<u64>,
    next_scheduled_rotation_at_ms: u64,
    job: Option<CloudflareTenantRootRefreshJobReadV1>,
    deriver_a_status: CloudflareRouterTenantRootDeriverHealthV1,
    deriver_b_status: CloudflareRouterTenantRootDeriverHealthV1,
}

// Restore into a new deployment: see crate::tenant_root_restore_coordinator.

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn probe_cloudflare_deriver_tenant_root_status_v1(
    env: &Env,
    peer: &CloudflarePeerBindingV1,
    request: &CloudflareDeriverTenantRootStatusRequestV1,
) -> Option<CloudflareDeriverTenantRootStatusResponseV1> {
    peer.validate().ok()?;
    let url = crate::paths::cloudflare_deriver_tenant_root_status_service_url(peer).ok()?;
    let probe = post_service_json(
        env,
        &peer.binding_name,
        url,
        "tenant-root Deriver status readback",
        request,
    );
    match futures::future::select(
        Box::pin(probe),
        Box::pin(Delay::from(TENANT_ROOT_DERIVER_STATUS_TIMEOUT)),
    )
    .await
    {
        futures::future::Either::Left((result, _)) => result.ok(),
        futures::future::Either::Right((_, _)) => None,
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn classify_cloudflare_deriver_tenant_root_status_v1(
    observed: Option<CloudflareDeriverTenantRootStatusResponseV1>,
    expected_identity_digest_b64u: &str,
    expected_custody_lineage_b64u: &str,
    expected_active_epoch: u64,
    expected_role: CloudflareTenantRootCreateRoleV1,
    expected_share_commitment_b64u: &str,
    expected_activation_receipt_digest_b64u: &str,
) -> CloudflareRouterTenantRootDeriverHealthV1 {
    let Some(observed) = observed else {
        return CloudflareRouterTenantRootDeriverHealthV1::Unavailable;
    };
    if observed.identity_digest_b64u == expected_identity_digest_b64u
        && observed.custody_lineage_b64u == expected_custody_lineage_b64u
        && observed.active_epoch == expected_active_epoch
        && observed.role == expected_role
        && observed.share_commitment_b64u == expected_share_commitment_b64u
        && observed.activation_receipt_digest_b64u == expected_activation_receipt_digest_b64u
    {
        CloudflareRouterTenantRootDeriverHealthV1::Healthy
    } else {
        CloudflareRouterTenantRootDeriverHealthV1::Degraded
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn read_cloudflare_router_tenant_root_status_v1(
    env: &Env,
    request: CloudflareRouterTenantRootStatusRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootStatusResponseV1> {
    let identity_bytes = decode_exact_tenant_root_wire_v1(
        "tenant-root status identity digest",
        &request.identity_digest_b64u,
    )?;
    let identity_digest =
        TenantRootIdentityDigestV1::from_bytes(identity_bytes.try_into().map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "tenant-root status identity digest must contain exactly 32 bytes",
            )
        })?);
    let custody_lineage = TenantRootCustodyLineageId::from_base64url(&request.custody_lineage_b64u)
        .map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "tenant-root status custody lineage is invalid",
            )
        })?;
    let active =
        execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1(
            env,
            identity_digest,
            custody_lineage,
        )
        .await?;
    let (epoch, commitments) = match active.activation_receipt.binding() {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => {
            (binding.epoch(), binding.commitments())
        }
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => {
            (binding.next_epoch(), binding.next_commitments())
        }
    };
    let identity_digest_b64u = crate::encode_base64url_bytes_v1(identity_digest.as_bytes());
    let custody_lineage_b64u = custody_lineage.to_base64url();
    let active_epoch = epoch.get().get();
    let activation_receipt_digest_b64u =
        crate::encode_base64url_bytes_v1(active.activation_receipt.digest().as_bytes());
    let probe_request = CloudflareDeriverTenantRootStatusRequestV1 {
        identity_digest_b64u: identity_digest_b64u.clone(),
        custody_lineage_b64u: custody_lineage_b64u.clone(),
        active_epoch,
    };
    let (deriver_a_observed, deriver_b_observed) =
        match CloudflareRouterWorkerRuntimeV1::from_worker_env(env) {
            Ok(runtime) => futures::join!(
                probe_cloudflare_deriver_tenant_root_status_v1(
                    env,
                    runtime.deriver_a_peer(),
                    &probe_request,
                ),
                probe_cloudflare_deriver_tenant_root_status_v1(
                    env,
                    runtime.deriver_b_peer(),
                    &probe_request,
                ),
            ),
            Err(_) => (None, None),
        };
    let deriver_a_status = classify_cloudflare_deriver_tenant_root_status_v1(
        deriver_a_observed,
        &identity_digest_b64u,
        &custody_lineage_b64u,
        active_epoch,
        CloudflareTenantRootCreateRoleV1::DeriverA,
        &crate::encode_base64url_bytes_v1(commitments.deriver_a().as_bytes()),
        &activation_receipt_digest_b64u,
    );
    let deriver_b_status = classify_cloudflare_deriver_tenant_root_status_v1(
        deriver_b_observed,
        &identity_digest_b64u,
        &custody_lineage_b64u,
        active_epoch,
        CloudflareTenantRootCreateRoleV1::DeriverB,
        &crate::encode_base64url_bytes_v1(commitments.deriver_b().as_bytes()),
        &activation_receipt_digest_b64u,
    );
    Ok(CloudflareRouterTenantRootStatusResponseV1 {
        identity_digest_b64u,
        custody_lineage_b64u,
        lifecycle_revision: active.lifecycle_revision,
        active_epoch,
        root_commitment_b64u: crate::encode_base64url_bytes_v1(commitments.root_commitment()),
        activation_receipt_digest_b64u,
        last_refresh_completed_at_ms: active.last_refresh_completed_at_ms,
        next_scheduled_rotation_at_ms: tenant_root_scheduled_refresh_next_at_ms_v1(
            identity_digest,
            active.activation_receipt.activated_at_ms(),
            active.last_refresh_completed_at_ms,
            crate::durable_object::tenant_root_creation::refresh_schedule_v1(env)?
                .scheduled_interval_ms,
        ),
        job: active.job,
        deriver_a_status,
        deriver_b_status,
    })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn refresh_http_response_v1(
    result: CloudflareRouterTenantRootRefreshResultV1,
) -> worker::Result<Response> {
    let (status, body) = result.http_status_and_body();
    Ok(Response::from_json(&body)?.with_status(status))
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn coordinate_cloudflare_router_tenant_root_creation_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneCreateTenantRootResponseV1> {
    crate::tenant_root_router_coordinate_creation_v1(
        &CloudflareRouterTenantRootCreationHostV1::new(env, runtime),
        request,
    )
    .await
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn coordinate_cloudflare_router_tenant_root_refresh_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: CloudflareRouterTenantRootRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRefreshResultV1> {
    crate::tenant_root_router_coordinate_refresh_v1(
        &CloudflareRouterTenantRootCreationHostV1::new(env, runtime),
        request,
    )
    .await
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn coordinate_cloudflare_router_tenant_root_managed_restore_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: crate::CloudflareRouterTenantRootManagedRestoreRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRefreshResponseV1> {
    crate::tenant_root_router_coordinate_managed_restore_v1(
        &CloudflareRouterTenantRootCreationHostV1::new(env, runtime),
        request,
    )
    .await
}
use router_ab_core::{
    PublicDigest32, RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    RouterAbEd25519NormalSigningFinalizeRequestV2, RouterAbEd25519NormalSigningPrepareRequestV2,
    RouterAbProtocolErrorCode, RouterAbProtocolResult, TenantRootActivationReceiptBindingV1,
    TenantRootCustodyLineageId, TenantRootIdentityDigestV1,
};

#[cfg(feature = "strict-worker-router-entrypoint")]
enum StrictRouterNormalSigningRequestV1 {
    Ed25519Prepare {
        request: RouterAbEd25519NormalSigningPrepareRequestV2,
        authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    },
    Ed25519Finalize {
        request: RouterAbEd25519NormalSigningFinalizeRequestV2,
        authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    },
    EcdsaPrepare {
        request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
        presign_source: crate::CloudflareEcdsaPrepareSourceV1,
        authorized_operation: CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    },
    EcdsaFinalize {
        request: RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
        authorized_operation: CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    },
}

#[cfg(feature = "strict-worker-router-entrypoint")]
impl StrictRouterNormalSigningRequestV1 {
    fn is_operation_step_up(&self) -> bool {
        match self {
            Self::Ed25519Prepare {
                authorized_operation,
                ..
            }
            | Self::Ed25519Finalize {
                authorized_operation,
                ..
            } => matches!(
                &authorized_operation.binding,
                CloudflareRouterEd25519AcceptedCapabilityBindingV1::OperationStepUp { .. }
            ),
            Self::EcdsaPrepare {
                authorized_operation,
                ..
            }
            | Self::EcdsaFinalize {
                authorized_operation,
                ..
            } => matches!(
                &authorized_operation.binding,
                CloudflareRouterEcdsaAcceptedCapabilityBindingV1::OperationStepUp { .. }
            ),
        }
    }

    fn is_gateway_wallet_session(&self) -> bool {
        matches!(
            self,
            Self::EcdsaPrepare {
                authorized_operation:
                    CloudflareRouterEcdsaAcceptedAuthorizedOperationV1 {
                        binding: CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession { .. },
                        ..
                    },
                ..
            }
                | Self::EcdsaFinalize {
                    authorized_operation:
                        CloudflareRouterEcdsaAcceptedAuthorizedOperationV1 {
                            binding: CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession { .. },
                            ..
                        },
                    ..
                }
                | Self::Ed25519Prepare {
                    authorized_operation:
                        CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
                            binding: CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession { .. },
                            ..
                        },
                    ..
                }
                | Self::Ed25519Finalize {
                    authorized_operation:
                        CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
                            binding: CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession { .. },
                            ..
                    },
                    ..
                }
                | Self::EcdsaPrepare {
                    authorized_operation:
                        CloudflareRouterEcdsaAcceptedAuthorizedOperationV1 {
                            binding: CloudflareRouterEcdsaAcceptedCapabilityBindingV1::ReusableWalletSession { .. },
                            ..
                        },
                    ..
                }
                | Self::EcdsaFinalize {
                    authorized_operation:
                        CloudflareRouterEcdsaAcceptedAuthorizedOperationV1 {
                            binding: CloudflareRouterEcdsaAcceptedCapabilityBindingV1::ReusableWalletSession { .. },
                            ..
                        },
                    ..
                }
                | Self::Ed25519Prepare {
                    authorized_operation:
                        CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
                        binding: CloudflareRouterEd25519AcceptedCapabilityBindingV1::ReusableWalletSession { .. },
                            ..
                        },
                    ..
                }
                | Self::Ed25519Finalize {
                    authorized_operation:
                        CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
                            binding: CloudflareRouterEd25519AcceptedCapabilityBindingV1::ReusableWalletSession { .. },
                            ..
                        },
                    ..
                }
                | Self::Ed25519Prepare {
                    authorized_operation:
                        CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
                            binding: CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession { .. },
                            ..
                        },
                    ..
                }
                | Self::Ed25519Finalize {
                    authorized_operation:
                        CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
                            binding: CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession { .. },
                            ..
                        },
                    ..
                }
        )
    }

    fn is_gateway_linked_device_wallet_session(&self) -> bool {
        matches!(
            self,
            Self::Ed25519Prepare {
                authorized_operation:
                    CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
                        binding: CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession { .. },
                        ..
                    },
                ..
            } | Self::Ed25519Finalize {
                authorized_operation:
                    CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
                        binding: CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession { .. },
                        ..
                    },
                ..
            }
        )
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
pub(super) async fn handle_strict_router_fetch_v1(
    mut request: Request,
    env: Env,
) -> worker::Result<Response> {
    let path = request.path();
    if path == CLOUDFLARE_INTERNAL_PREWARM_PATH {
        return handle_router_prewarm_v1(&request, &env).await;
    }
    if path == CLOUDFLARE_ROUTER_TENANT_ROOT_DESTINATION_BOOTSTRAP_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error("tenant-root destination bootstrap route requires POST", 405);
        }
        let content_type = match request.headers().get("content-type") {
            Ok(Some(value)) => value,
            Ok(None) => {
                return Response::error(
                    "tenant-root destination bootstrap route requires JSON",
                    415,
                )
            }
            Err(err) => {
                return cloudflare_protocol_error_response_v1(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
                    format!(
                        "tenant-root destination bootstrap content-type header read failed: {err}"
                    ),
                ));
            }
        };
        if !content_type
            .split(';')
            .next()
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
        {
            return Response::error("tenant-root destination bootstrap route requires JSON", 415);
        }
        let parsed: CloudflareTenantRootDestinationBootstrapRequestV1 =
            match decode_bounded_json_request(
                &mut request,
                TENANT_ROOT_DESTINATION_BOOTSTRAP_REQUEST_MAX_BYTES_V1,
            )
            .await
            {
                Ok(value) => value,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
        let token_header = match &parsed {
            CloudflareTenantRootDestinationBootstrapRequestV1::Read { .. } => None,
            CloudflareTenantRootDestinationBootstrapRequestV1::Authenticate { .. } => match request
                .headers()
                .get(CLOUDFLARE_ROUTER_TENANT_ROOT_DESTINATION_BOOTSTRAP_TOKEN_HEADER_V1)
            {
                Ok(value) => value,
                Err(err) => {
                    return cloudflare_protocol_error_response_v1(RouterAbProtocolError::new(
                            RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
                            format!(
                                "tenant-root destination bootstrap credential header read failed: {err}"
                            ),
                        ));
                }
            },
        };
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        return match crate::tenant_root_router_destination_bootstrap_v1(
            &CloudflareRouterTenantRootCreationHostV1::new(&env, &runtime),
            parsed,
            token_header.as_deref(),
        )
        .await
        {
            Ok(response) => Response::from_json(&response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_REGISTER_MANIFEST_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error(
                "tenant-root control-plane register-manifest route requires POST",
                405,
            );
        }
        let parsed: CloudflareTenantRootControlPlaneRegisterManifestRequestV1 =
            match decode_bounded_json_request(
                &mut request,
                TENANT_ROOT_CONTROL_PLANE_REGISTER_MANIFEST_REQUEST_MAX_BYTES_V1,
            )
            .await
            {
                Ok(value) => value,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        return match crate::tenant_root_router_register_manifest_v1(
            &CloudflareRouterTenantRootCreationHostV1::new(&env, &runtime),
            parsed,
        )
        .await
        {
            Ok(response) => Response::from_json(&response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == crate::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ROLE_IMPORT_ACCEPT_PRIVATE_REQUEST_PATH
    {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error(
                "tenant-root restore role-import acceptance requires POST",
                405,
            );
        }
        let parsed: crate::CloudflareRouterTenantRootRestoreRoleImportAcceptRequestV1 =
            match decode_bounded_json_request(
                &mut request,
                TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_REQUEST_MAX_BYTES_V1 + 32 * 1024,
            )
            .await
            {
                Ok(value) => value,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        return match crate::tenant_root_router_restore_role_import_accept_v1(
            &CloudflareRouterTenantRootCreationHostV1::new(&env, &runtime),
            parsed,
        )
        .await
        {
            Ok(response) => Response::from_json(&response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_KEY_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error(
                "tenant-root restore role-import key route requires POST",
                405,
            );
        }
        let parsed: CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1 =
            match decode_bounded_json_request(
                &mut request,
                TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_REQUEST_MAX_BYTES_V1,
            )
            .await
            {
                Ok(value) => value,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        return match crate::tenant_root_router_restore_role_import_key_v1(
            &CloudflareRouterTenantRootCreationHostV1::new(&env, &runtime),
            parsed,
        )
        .await
        {
            Ok(response) => Response::from_json(&response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == CLOUDFLARE_ROUTER_TENANT_ROOT_CREATION_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error("tenant-root creation route requires POST", 405);
        }
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        let parsed: CloudflareTenantRootControlPlaneCreateTenantRootRequestV1 =
            match decode_bounded_json_request(
                &mut request,
                TENANT_ROOT_CONTROL_PLANE_CREATE_TENANT_ROOT_REQUEST_MAX_BYTES_V1,
            )
            .await
            {
                Ok(value) => value,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
        return match coordinate_cloudflare_router_tenant_root_creation_v1(&env, &runtime, parsed)
            .await
        {
            Ok(response) => Response::from_json(&response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == crate::CLOUDFLARE_ROUTER_TENANT_ROOT_CREATION_SWEEP_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error("tenant-root creation sweep route requires POST", 405);
        }
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        let parsed = match decode_bounded_json_request::<
            crate::durable_object::tenant_root_creation::CloudflareTenantRootCreationJournalReadRequestV1,
        >(&mut request, 1024)
        .await
        {
            Ok(value) => value,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        return match crate::tenant_root_router_sweep_abandoned_creation_v1(
            &CloudflareRouterTenantRootCreationHostV1::new(&env, &runtime),
            parsed,
        )
        .await
        {
            Ok(response) => Response::from_json(&response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == crate::CLOUDFLARE_ROUTER_TENANT_ROOT_STATUS_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error("tenant-root status route requires POST", 405);
        }
        let parsed = match decode_bounded_json_request::<CloudflareRouterTenantRootStatusRequestV1>(
            &mut request,
            1024,
        )
        .await
        {
            Ok(value) => value,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        return match read_cloudflare_router_tenant_root_status_v1(&env, parsed).await {
            Ok(response) => Response::from_json(&response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == CLOUDFLARE_ROUTER_TENANT_ROOT_REFRESH_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error("tenant-root refresh route requires POST", 405);
        }
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        let parsed: CloudflareRouterTenantRootRefreshRequestV1 = match decode_bounded_json_request(
            &mut request,
            TENANT_ROOT_CONTROL_PLANE_REFRESH_COMMANDS_REQUEST_MAX_BYTES_V1,
        )
        .await
        {
            Ok(value) => value,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        return match coordinate_cloudflare_router_tenant_root_refresh_v1(&env, &runtime, parsed)
            .await
        {
            Ok(response) => refresh_http_response_v1(response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error("tenant-root restore-refresh route requires POST", 405);
        }
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        let parsed: CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1 =
            match decode_bounded_json_request(
                &mut request,
                TENANT_ROOT_CONTROL_PLANE_RESTORE_REFRESH_COMMANDS_REQUEST_MAX_BYTES_V1,
            )
            .await
            {
                Ok(value) => value,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
        return match crate::tenant_root_router_restore_refresh_v1(
            &CloudflareRouterTenantRootCreationHostV1::new(&env, &runtime),
            parsed,
        )
        .await
        .and_then(|outcome| outcome.into_response_body())
        {
            Ok(body) => Response::from_json(&body),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == crate::paths::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_CLEANUP_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error("restore cleanup requires POST", 405);
        }
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        let parsed = match decode_bounded_json_request::<
            crate::CloudflareRouterTenantRootRestoreCleanupRequestV1,
        >(&mut request, 64 * 1024)
        .await
        {
            Ok(parsed) => parsed,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        return match crate::tenant_root_router_restore_cleanup_v1(
            &CloudflareRouterTenantRootCreationHostV1::new(&env, &runtime),
            parsed,
        )
        .await
        {
            Ok(response) => Response::from_json(&response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ACTIVATION_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error("tenant-root restore activation route requires POST", 405);
        }
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        let parsed: CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1 =
            match decode_bounded_json_request(
                &mut request,
                TENANT_ROOT_CONTROL_PLANE_RESTORE_REFRESH_COMMANDS_REQUEST_MAX_BYTES_V1,
            )
            .await
            {
                Ok(value) => value,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
        return match crate::tenant_root_router_restore_activation_v1(
            &CloudflareRouterTenantRootCreationHostV1::new(&env, &runtime),
            parsed,
        )
        .await
        {
            Ok(response) => Response::from_json(&response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == CLOUDFLARE_ROUTER_TENANT_ROOT_MANAGED_RESTORE_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        if request.method() != Method::Post {
            return Response::error("tenant-root managed-restore route requires POST", 405);
        }
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        let parsed: crate::CloudflareRouterTenantRootManagedRestoreRequestV1 =
            match decode_bounded_json_request(
                &mut request,
                crate::TENANT_ROOT_MANAGED_RESTORE_REQUEST_MAX_BYTES_V1,
            )
            .await
            {
                Ok(value) => value,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
        return match coordinate_cloudflare_router_tenant_root_managed_restore_v1(
            &env, &runtime, parsed,
        )
        .await
        {
            Ok(response) => Response::from_json(&response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if is_cloudflare_router_public_keyset_path(&path) {
        if request.method() == Method::Options {
            return cloudflare_router_public_keyset_preflight_response_v1(&request, &env);
        }
        if request.method() != Method::Get {
            let response = Response::error("Router A/B public keyset route requires GET", 405)?;
            return cloudflare_router_public_keyset_response_v1(response, &request, &env);
        }
        let reader = CloudflareWorkerEnvReaderV1::new(&env);
        let response = match build_cloudflare_router_public_keyset_v2(&reader) {
            Ok(keyset) => Response::from_json(&keyset)?,
            Err(err) => cloudflare_protocol_error_response_v1(err)?,
        };
        return cloudflare_router_public_keyset_response_v1(response, &request, &env);
    }

    if path == CLOUDFLARE_ROUTER_ED25519_YAO_EXECUTE_PRIVATE_REQUEST_PATH {
        return handle_cloudflare_router_ed25519_yao_execute_private_fetch_v1(request, &env).await;
    }
    if path == crate::CLOUDFLARE_ROUTER_ED25519_YAO_REGISTRATION_CONSUME_PRIVATE_REQUEST_PATH {
        return crate::handle_cloudflare_router_ed25519_yao_registration_consume_private_fetch_v1(
            request, &env,
        )
        .await;
    }
    if path == CLOUDFLARE_ROUTER_ED25519_YAO_SOURCE_PRESERVING_EXECUTE_PRIVATE_REQUEST_PATH {
        return handle_cloudflare_router_ed25519_yao_source_preserving_execute_private_fetch_v1(
            request, &env,
        )
        .await;
    }
    if path == CLOUDFLARE_ROUTER_ED25519_YAO_LANE_EXECUTE_PRIVATE_REQUEST_PATH {
        return handle_cloudflare_router_ed25519_yao_lane_execute_private_fetch_v1(request, &env)
            .await;
    }
    if path == CLOUDFLARE_ROUTER_ED25519_YAO_RECOVERY_PROMOTE_PRIVATE_REQUEST_PATH {
        return handle_cloudflare_router_ed25519_yao_recovery_promote_private_fetch_v1(
            request, &env,
        )
        .await;
    }

    if request.method() == Method::Options
        && (is_cloudflare_router_normal_signing_public_path(&path)
            || is_cloudflare_router_ab_ecdsa_derivation_public_path(&path))
    {
        return cloudflare_router_normal_signing_preflight_response_v1(&request, &env);
    }

    if request.method() != Method::Post {
        return Response::error("Router A/B strict public route requires POST", 405);
    }
    if path == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_LINKED_SIGNING_PRIVATE_REQUEST_PATH {
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
        let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
            Ok(runtime) => runtime,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        let request_body =
            match read_router_public_body_v1(&mut request, &env, "linked ECDSA finalize request")
                .await?
            {
                Ok(bytes) => bytes,
                Err(response) => return Ok(response),
            };
        let parsed =
            match parse_cloudflare_router_authorized_linked_device_ecdsa_finalize_request_v1_json(
                &request_body,
            ) {
                Ok(parsed) => parsed,
                Err(err) => return cloudflare_protocol_error_response_v1(err),
            };
        let response =
            execute_cloudflare_signing_worker_linked_device_ecdsa_finalize_service_call_v1(
                &env,
                runtime.signing_worker_peer(),
                parsed,
            )
            .await;
        return match response {
            Ok(response) => Response::from_json(&response),
            Err(err) => cloudflare_protocol_error_response_v1(err),
        };
    }
    if path == CLOUDFLARE_ROUTER_NORMAL_SIGNING_ROUND1_PREPARE_PUBLIC_REQUEST_PATH
        || path == CLOUDFLARE_ROUTER_NORMAL_SIGNING_PUBLIC_REQUEST_PATH
        || path == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PUBLIC_REQUEST_PATH
        || path == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PUBLIC_REQUEST_PATH
    {
        if let Err(err) = require_cloudflare_gateway_to_router_auth_request_v1(&request, &env) {
            return cloudflare_private_service_auth_error_response_v1(err);
        }
    }
    if path != CLOUDFLARE_ROUTER_NORMAL_SIGNING_ROUND1_PREPARE_PUBLIC_REQUEST_PATH
        && path != CLOUDFLARE_ROUTER_NORMAL_SIGNING_PUBLIC_REQUEST_PATH
        && path != CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PUBLIC_REQUEST_PATH
        && path != CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PUBLIC_REQUEST_PATH
        && path != CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ADD_SIGNER_PUBLIC_REQUEST_PATH
        && path != CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PUBLIC_REQUEST_PATH
        && path != CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_REFRESH_PUBLIC_REQUEST_PATH
        && path != CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PUBLIC_REQUEST_PATH
        && path != CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PUBLIC_REQUEST_PATH
    {
        return Response::error(
            format!(
                "Router A/B strict public request must be served at {}, {}, {}, {}, {}, {}, {}, {}, or {}",
                CLOUDFLARE_ROUTER_NORMAL_SIGNING_ROUND1_PREPARE_PUBLIC_REQUEST_PATH,
                CLOUDFLARE_ROUTER_NORMAL_SIGNING_PUBLIC_REQUEST_PATH,
                CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PUBLIC_REQUEST_PATH,
                CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PUBLIC_REQUEST_PATH,
                CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ADD_SIGNER_PUBLIC_REQUEST_PATH,
                CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PUBLIC_REQUEST_PATH,
                CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_REFRESH_PUBLIC_REQUEST_PATH,
                CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PUBLIC_REQUEST_PATH,
                CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PUBLIC_REQUEST_PATH
            ),
            404,
        );
    }
    let parsed_normal_signing = if path
        == CLOUDFLARE_ROUTER_NORMAL_SIGNING_ROUND1_PREPARE_PUBLIC_REQUEST_PATH
        || path == CLOUDFLARE_ROUTER_NORMAL_SIGNING_PUBLIC_REQUEST_PATH
        || path == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PUBLIC_REQUEST_PATH
        || path == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PUBLIC_REQUEST_PATH
    {
        match parse_strict_router_normal_signing_request_v1(&mut request, &env, &path).await? {
            Ok(parsed) => Some(parsed),
            Err(response) => return Ok(response),
        }
    } else {
        None
    };
    let authorization_header_present = match request.headers().get("authorization") {
        Ok(value) => value.is_some(),
        Err(err) => {
            return cloudflare_protocol_error_response_v1(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
                format!("Router authorization header read failed: {err}"),
            ));
        }
    };
    let gateway_wallet_session_request = parsed_normal_signing
        .as_ref()
        .is_some_and(StrictRouterNormalSigningRequestV1::is_gateway_wallet_session);
    if parsed_normal_signing
        .as_ref()
        .is_some_and(|parsed| !parsed.is_gateway_wallet_session() && !parsed.is_operation_step_up())
    {
        return cloudflare_protocol_error_response_v1(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Normal signing requires Gateway Wallet Session admission or operation step-up",
        ));
    }
    if gateway_wallet_session_request && authorization_header_present {
        return cloudflare_protocol_error_response_v1(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
            "Gateway Wallet Session requests must omit Authorization",
        ));
    }
    let authorization = if parsed_normal_signing.is_some() {
        None
    } else {
        match parse_cloudflare_router_bearer_authorization_from_request_v1(&request) {
            Ok(authorization) => Some(authorization),
            Err(_err)
                if parsed_normal_signing
                    .as_ref()
                    .is_some_and(StrictRouterNormalSigningRequestV1::is_operation_step_up) =>
            {
                None
            }
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        }
    };
    let trusted_source_digest = match cloudflare_trusted_source_digest_v1(&request) {
        Ok(digest) => digest,
        Err(err) => return cloudflare_protocol_error_response_v1(err),
    };
    let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
        Ok(runtime) => runtime,
        Err(err) => return cloudflare_protocol_error_response_v1(err),
    };
    let now_unix_ms = match cloudflare_now_unix_ms_v1() {
        Ok(now_unix_ms) => now_unix_ms,
        Err(err) => return cloudflare_protocol_error_response_v1(err),
    };
    let verifier = match build_cloudflare_router_ed25519_jwks_jwt_verifier_v1(
        &runtime.admission_bindings().jwt,
    ) {
        Ok(verifier) => verifier,
        Err(err) => return cloudflare_protocol_error_response_v1(err),
    };

    if let Some(parsed) = parsed_normal_signing {
        return execute_strict_router_normal_signing_request_v1(
            parsed,
            &request,
            &env,
            &runtime,
            now_unix_ms,
            trusted_source_digest,
            verifier,
        )
        .await;
    }
    let authorization = match authorization {
        Some(authorization) => authorization,
        None => {
            return cloudflare_protocol_error_response_v1(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "Bearer authorization is required",
            ));
        }
    };

    if path == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PUBLIC_REQUEST_PATH {
        let trace_id = match router_ecdsa_trace_context_v1(&request, &env)? {
            Ok(trace_id) => trace_id,
            Err(response) => return Ok(response),
        };
        let request_body = match read_router_public_body_v1(
            &mut request,
            &env,
            "Router A/B strict ECDSA registration activation",
        )
        .await?
        {
            Ok(bytes) => bytes,
            Err(response) => return Ok(response),
        };
        let activation_request = match parse_router_public_body_v1(
            &request_body,
            parse_cloudflare_router_ab_ecdsa_derivation_activation_request_v1_json,
            &request,
            &env,
        )? {
            Ok(parsed) => parsed,
            Err(response) => return Ok(response),
        };
        let mut timing = CloudflareEcdsaBoundaryTimingV1::with_trace_id(trace_id);
        let response =
            handle_cloudflare_router_ab_ecdsa_derivation_activation_authenticated_public_request_v1(
                &env,
                &runtime,
                now_unix_ms,
                activation_request,
                authorization,
                trusted_source_digest,
                verifier,
                &mut timing,
            )
            .await;
        return router_ecdsa_timed_json_cors_response_v1(response, &timing, &request, &env);
    }

    if let Some(registration_purpose) =
        router_ab_ecdsa_derivation_registration_purpose_for_public_path(&path)
    {
        let trace_id = match router_ecdsa_trace_context_v1(&request, &env)? {
            Ok(trace_id) => trace_id,
            Err(response) => return Ok(response),
        };
        let request_body = match read_router_public_body_v1(
            &mut request,
            &env,
            "Router A/B strict Router A/B ECDSA derivation registration",
        )
        .await?
        {
            Ok(bytes) => bytes,
            Err(response) => return Ok(response),
        };
        match registration_purpose {
            RouterAbEcdsaDerivationRegistrationPurposeV1::WalletRegistration => {
                let (registration_request, identity_digest, custody_lineage) =
                    match parse_router_public_body_v1(
                        &request_body,
                        parse_cloudflare_router_ab_ecdsa_derivation_registration_gateway_request_v1,
                        &request,
                        &env,
                    )? {
                        Ok(parsed) => parsed,
                        Err(response) => return Ok(response),
                    };
                if let Err(err) =
                    registration_request.validate_for_registration_purpose(registration_purpose)
                {
                    let response = cloudflare_protocol_error_response_v1(err)?;
                    return cloudflare_router_normal_signing_response_v1(response, &request, &env);
                }
                let active_receipt =
                    match crate::tenant_root_refresh_coordinator::execute_cloudflare_router_tenant_root_admission_receipt_v1(
                        &env,
                        identity_digest,
                        custody_lineage,
                    )
                    .await
                    {
                        Ok(receipt) => receipt,
                        Err(err) => {
                            let response = cloudflare_protocol_error_response_v1(err)?;
                            return cloudflare_router_normal_signing_response_v1(
                                response, &request, &env,
                            );
                        }
                    };
                let custody_binding = match cloudflare_tenant_root_registration_binding_wire_v1(
                    &registration_request,
                    registration_purpose,
                    &active_receipt,
                ) {
                    Ok(binding) => binding,
                    Err(err) => {
                        let response = cloudflare_protocol_error_response_v1(err)?;
                        return cloudflare_router_normal_signing_response_v1(
                            response, &request, &env,
                        );
                    }
                };
                let mut timing = CloudflareEcdsaBoundaryTimingV1::with_trace_id(trace_id);
                let response = handle_cloudflare_router_ab_ecdsa_derivation_registration_bootstrap_authenticated_public_request_v1(
                    &env,
                    &runtime,
                    now_unix_ms,
                    registration_request,
                    &custody_binding,
                    authorization,
                    trusted_source_digest,
                    verifier,
                    &mut timing,
                )
                .await;
                return router_ecdsa_timed_json_cors_response_v1(response, &timing, &request, &env);
            }
            RouterAbEcdsaDerivationRegistrationPurposeV1::WalletAddSigner => {
                let (registration_request, identity_digest, custody_lineage) =
                    match parse_router_public_body_v1(
                        &request_body,
                        parse_cloudflare_router_ab_ecdsa_derivation_registration_gateway_request_v1,
                        &request,
                        &env,
                    )? {
                        Ok(parsed) => parsed,
                        Err(response) => return Ok(response),
                    };
                if let Err(err) =
                    registration_request.validate_for_registration_purpose(registration_purpose)
                {
                    let response = cloudflare_protocol_error_response_v1(err)?;
                    return cloudflare_router_normal_signing_response_v1(response, &request, &env);
                }
                let active_receipt =
                    match crate::tenant_root_refresh_coordinator::execute_cloudflare_router_tenant_root_admission_receipt_v1(
                        &env,
                        identity_digest,
                        custody_lineage,
                    )
                    .await
                    {
                        Ok(receipt) => receipt,
                        Err(err) => {
                            let response = cloudflare_protocol_error_response_v1(err)?;
                            return cloudflare_router_normal_signing_response_v1(
                                response, &request, &env,
                            );
                        }
                    };
                let custody_binding = match cloudflare_tenant_root_registration_binding_wire_v1(
                    &registration_request,
                    registration_purpose,
                    &active_receipt,
                ) {
                    Ok(binding) => binding,
                    Err(err) => {
                        let response = cloudflare_protocol_error_response_v1(err)?;
                        return cloudflare_router_normal_signing_response_v1(
                            response, &request, &env,
                        );
                    }
                };
                let mut timing = CloudflareEcdsaBoundaryTimingV1::with_trace_id(trace_id);
                let response = handle_cloudflare_router_ab_ecdsa_derivation_registration_bootstrap_authenticated_public_request_v1(
                    &env,
                    &runtime,
                    now_unix_ms,
                    registration_request,
                    &custody_binding,
                    authorization,
                    trusted_source_digest,
                    verifier,
                    &mut timing,
                )
                .await;
                return router_ecdsa_timed_json_cors_response_v1(response, &timing, &request, &env);
            }
        }
    }

    if path == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PUBLIC_REQUEST_PATH {
        let request_body = match read_router_public_body_v1(
            &mut request,
            &env,
            "Router A/B strict Router A/B ECDSA derivation export",
        )
        .await?
        {
            Ok(bytes) => bytes,
            Err(response) => return Ok(response),
        };
        let export_request = match parse_router_public_body_v1(
            &request_body,
            parse_cloudflare_router_ab_ecdsa_derivation_export_command_v1_json,
            &request,
            &env,
        )? {
            Ok(parsed) => parsed,
            Err(response) => return Ok(response),
        };
        let response =
            handle_cloudflare_router_ab_ecdsa_derivation_explicit_export_authenticated_public_request_v1(
                &env,
                &runtime,
                now_unix_ms,
                export_request,
                authorization,
                trusted_source_digest,
                verifier,
            )
            .await;
        return router_json_cors_response_v1(response, &request, &env);
    }

    if path == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_REFRESH_PUBLIC_REQUEST_PATH {
        let request_body = match read_router_public_body_v1(
            &mut request,
            &env,
            "Router A/B strict Router A/B ECDSA derivation activation-refresh",
        )
        .await?
        {
            Ok(bytes) => bytes,
            Err(response) => return Ok(response),
        };
        let refresh_request = match parse_router_public_body_v1(
            &request_body,
            parse_cloudflare_router_ab_ecdsa_derivation_activation_refresh_command_v1_json,
            &request,
            &env,
        )? {
            Ok(parsed) => parsed,
            Err(response) => return Ok(response),
        };
        let response =
            handle_cloudflare_router_ab_ecdsa_derivation_activation_refresh_authenticated_public_request_v1(
                &env,
                &runtime,
                now_unix_ms,
                refresh_request,
                authorization,
                trusted_source_digest,
                verifier,
            )
            .await;
        return router_json_cors_response_v1(response, &request, &env);
    }

    Response::error("Router A/B strict public route is unavailable", 404)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn parse_strict_router_normal_signing_request_v1(
    request: &mut Request,
    env: &Env,
    path: &str,
) -> worker::Result<Result<StrictRouterNormalSigningRequestV1, Response>> {
    let started_at_ms = CloudflareEcdsaBoundaryTimingV1::now_ms();
    let request_body =
        match read_router_public_body_v1(request, env, "Router A/B strict normal-signing request")
            .await?
        {
            Ok(bytes) => bytes,
            Err(response) => return Ok(Err(response)),
        };
    if matches!(
        path,
        CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PUBLIC_REQUEST_PATH
            | CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PUBLIC_REQUEST_PATH
    ) {
        let mut timing = CloudflareEcdsaBoundaryTimingV1::new();
        timing.mark("router_request_body", started_at_ms);
        timing.emit_io_diagnostic();
    }
    let parsed = match path {
        CLOUDFLARE_ROUTER_NORMAL_SIGNING_ROUND1_PREPARE_PUBLIC_REQUEST_PATH => {
            parse_router_public_body_v1(
                &request_body,
                parse_cloudflare_router_authorized_ed25519_prepare_request_v2_json,
                request,
                env,
            )?
            .map(|(request, authorized_operation)| {
                StrictRouterNormalSigningRequestV1::Ed25519Prepare {
                    request,
                    authorized_operation,
                }
            })
        }
        CLOUDFLARE_ROUTER_NORMAL_SIGNING_PUBLIC_REQUEST_PATH => parse_router_public_body_v1(
            &request_body,
            parse_cloudflare_router_authorized_ed25519_finalize_request_v2_json,
            request,
            env,
        )?
        .map(|(request, authorized_operation)| {
            StrictRouterNormalSigningRequestV1::Ed25519Finalize {
                request,
                authorized_operation,
            }
        }),
        CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PUBLIC_REQUEST_PATH => {
            parse_router_public_body_v1(
                &request_body,
                parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_prepare_request_v1_json,
                request,
                env,
            )?
            .map(|(request, authorized_operation, presign_source)| {
                StrictRouterNormalSigningRequestV1::EcdsaPrepare {
                    request,
                    authorized_operation,
                    presign_source,
                }
            })
        }
        CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PUBLIC_REQUEST_PATH => {
            parse_router_public_body_v1(
                &request_body,
                parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_finalize_request_v1_json,
                request,
                env,
            )?
            .map(|(request, authorized_operation)| {
                StrictRouterNormalSigningRequestV1::EcdsaFinalize {
                    request,
                    authorized_operation,
                }
            })
        }
        _ => {
            return Ok(Err(Response::error(
                "Router A/B strict normal-signing route is unavailable",
                404,
            )?));
        }
    };
    Ok(parsed)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn execute_strict_router_normal_signing_request_v1(
    parsed: StrictRouterNormalSigningRequestV1,
    request: &Request,
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    now_unix_ms: u64,
    trusted_source_digest: PublicDigest32,
    verifier: CloudflareRouterEd25519JwksJwtVerifierV1,
) -> worker::Result<Response> {
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
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    trusted_source_digest,
                )
                .await;
            router_json_cors_response_v1(response, request, env)
        }
        StrictRouterNormalSigningRequestV1::Ed25519Prepare {
            request: signing_request,
            authorized_operation,
        } if operation_step_up => {
            let response =
                handle_cloudflare_router_normal_signing_prepare_internal_step_up_request_v2(
                    env,
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    trusted_source_digest,
                )
                .await;
            router_json_cors_response_v1(response, request, env)
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
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    credential,
                    trusted_source_digest,
                    verifier,
                )
                .await;
            router_json_cors_response_v1(response, request, env)
        }
        StrictRouterNormalSigningRequestV1::Ed25519Finalize {
            request: signing_request,
            authorized_operation,
        } if gateway_linked_device_wallet_session => {
            let response =
                handle_cloudflare_router_normal_signing_finalize_internal_linked_device_request_v2(
                    env,
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    trusted_source_digest,
                )
                .await;
            router_json_cors_response_v1(response, request, env)
        }
        StrictRouterNormalSigningRequestV1::Ed25519Finalize {
            request: signing_request,
            authorized_operation,
        } if operation_step_up => {
            let response =
                handle_cloudflare_router_normal_signing_finalize_internal_step_up_request_v2(
                    env,
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    trusted_source_digest,
                )
                .await;
            router_json_cors_response_v1(response, request, env)
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
                    runtime,
                    now_unix_ms,
                    signing_request,
                    authorized_operation,
                    credential,
                    trusted_source_digest,
                    verifier,
                )
                .await;
            router_json_cors_response_v1(response, request, env)
        }
        StrictRouterNormalSigningRequestV1::EcdsaPrepare {
            request: signing_request,
            presign_source,
            authorized_operation,
        } if operation_step_up => {
            let response = handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_prepare_internal_step_up_request_v1(
                env,
                runtime,
                now_unix_ms,
                signing_request,
                authorized_operation,
                presign_source,
                trusted_source_digest,
            )
            .await;
            router_json_cors_response_v1(response, request, env)
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
            router_json_cors_response_v1(response, request, env)
        }
        StrictRouterNormalSigningRequestV1::EcdsaFinalize {
            request: signing_request,
            authorized_operation,
        } if operation_step_up => {
            let response = handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_finalize_internal_step_up_request_v1(
                env,
                runtime,
                now_unix_ms,
                signing_request,
                authorized_operation,
                trusted_source_digest,
            )
            .await;
            router_json_cors_response_v1(response, request, env)
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
                runtime,
                now_unix_ms,
                signing_request,
                authorized_operation,
                credential,
                trusted_source_digest,
                verifier,
            )
            .await;
            router_json_cors_response_v1(response, request, env)
        }
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn handle_router_prewarm_v1(request: &Request, env: &Env) -> worker::Result<Response> {
    if let Err(err) = require_cloudflare_internal_service_auth_request_v1(request, env) {
        return cloudflare_private_service_auth_error_response_v1(err);
    }
    if request.method() != Method::Post {
        return cloudflare_prewarm_response_v1(request);
    }
    if let Err(err) = CloudflareRouterWorkerRuntimeV1::from_worker_env(env) {
        return cloudflare_protocol_error_response_v1(err);
    }
    let result = await_prewarm_fanout_v1(
        prewarm_service_binding_v1(env, "DERIVER_A"),
        prewarm_service_binding_v1(env, "DERIVER_B"),
        prewarm_service_binding_v1(env, "SIGNING_WORKER"),
    )
    .await;
    if result.is_err() {
        return Response::error("Router A/B prewarm fan-out failed", 502);
    }
    cloudflare_prewarm_response_v1(request)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn prewarm_service_binding_v1(env: &Env, binding_name: &str) -> Result<(), ()> {
    let fetcher = env.service(binding_name).map_err(|_| ())?;
    let headers = worker::Headers::new();
    set_cloudflare_internal_service_auth_header_v1(env, &headers, "Worker prewarm")
        .map_err(|_| ())?;
    let mut init = worker::RequestInit::new();
    init.with_method(Method::Post).with_headers(headers);
    let request =
        Request::new_with_init("https://router-ab-prewarm.internal/internal/prewarm", &init)
            .map_err(|_| ())?;
    let response = fetcher.fetch_request(request).await.map_err(|_| ())?;
    if !(200..=299).contains(&response.status_code()) {
        return Err(());
    }
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn await_prewarm_fanout_v1<A, B, C, E>(a: A, b: B, c: C) -> Result<(), E>
where
    A: core::future::Future<Output = Result<(), E>>,
    B: core::future::Future<Output = Result<(), E>>,
    C: core::future::Future<Output = Result<(), E>>,
{
    futures::try_join!(a, b, c)?;
    Ok(())
}

#[cfg(all(test, feature = "strict-worker-router-entrypoint"))]
mod prewarm_tests {
    use super::await_prewarm_fanout_v1;
    use core::task::Poll;
    use futures::future::poll_fn;
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;
    use std::task::Waker;

    fn gated_prewarm_child(
        started: Rc<Cell<usize>>,
        waiting: Rc<RefCell<Vec<Waker>>>,
    ) -> impl core::future::Future<Output = Result<(), ()>> {
        let mut entered = false;
        poll_fn(move |context| {
            if !entered {
                entered = true;
                started.set(started.get() + 1);
            }
            if started.get() == 3 {
                for waker in waiting.borrow_mut().drain(..) {
                    waker.wake();
                }
                return Poll::Ready(Ok(()));
            }
            waiting.borrow_mut().push(context.waker().clone());
            Poll::Pending
        })
    }

    #[test]
    fn router_prewarm_polls_all_three_role_bindings_concurrently() {
        let started = Rc::new(Cell::new(0));
        let waiting = Rc::new(RefCell::new(Vec::new()));
        let result = futures::executor::block_on(await_prewarm_fanout_v1(
            gated_prewarm_child(started.clone(), waiting.clone()),
            gated_prewarm_child(started.clone(), waiting.clone()),
            gated_prewarm_child(started.clone(), waiting),
        ));

        assert_eq!(result, Ok(()));
        assert_eq!(started.get(), 3);
    }
}

#[cfg(all(test, feature = "strict-worker-router-entrypoint"))]
mod refresh_replay_tests {
    use crate::tenant_root_refresh_coordinator::{
        tenant_root_router_replay_terminal_refresh_v1 as replay_terminal_refresh_response_v1,
        CloudflareRouterTenantRootRefreshRequestV1,
    };
    use crate::durable_object::tenant_root_creation::{
        CloudflareTenantRootRefreshActivationResponseV1, CloudflareTenantRootRefreshAttemptV1,
        CloudflareTenantRootRefreshFenceV1, CloudflareTenantRootRefreshTerminalOutcomeV1,
    };

    #[test]
    fn manual_refresh_request_requires_operation_identity_and_rejects_bypass() {
        let request = serde_json::json!({
            "operation_id": "manual-operation",
            "expected_lifecycle_revision": 1,
            "expires_at_ms": 10000,
            "trigger": "manual",
            "identity_digest_b64u": "identity",
            "custody_lineage_b64u": "lineage",
        });
        assert!(
            serde_json::from_value::<CloudflareRouterTenantRootRefreshRequestV1>(request.clone())
                .is_ok()
        );
        let mut missing = request.clone();
        missing.as_object_mut().unwrap().remove("operation_id");
        assert!(
            serde_json::from_value::<CloudflareRouterTenantRootRefreshRequestV1>(missing).is_err()
        );
        for field in ["expected_lifecycle_revision", "expires_at_ms"] {
            let mut missing = request.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(
                serde_json::from_value::<CloudflareRouterTenantRootRefreshRequestV1>(missing)
                    .is_err()
            );
        }
        let mut bypass = request;
        bypass["mode"] = serde_json::json!("emergency");
        assert!(
            serde_json::from_value::<CloudflareRouterTenantRootRefreshRequestV1>(bypass).is_err()
        );
        let scheduled = serde_json::json!({
            "operation_id": "scheduled-operation",
            "expected_lifecycle_revision": 1,
            "expires_at_ms": 10000,
            "trigger": "scheduled",
            "identity_digest_b64u": "identity",
            "custody_lineage_b64u": "lineage",
        });
        assert!(
            serde_json::from_value::<CloudflareRouterTenantRootRefreshRequestV1>(scheduled).is_ok()
        );
    }

    #[test]
    fn completed_refresh_replay_returns_the_persisted_activation_response() {
        let persisted = CloudflareTenantRootRefreshActivationResponseV1 {
            activation_receipt_digest_b64u: "persisted-receipt-digest".to_owned(),
            lifecycle_revision: 42,
        };
        let fence = CloudflareTenantRootRefreshFenceV1::Terminal {
            attempt: CloudflareTenantRootRefreshAttemptV1 {
                manual_operation_id: None,
                attempt_id_b64u: "attempt".to_owned(),
                identity_digest_b64u: "identity".to_owned(),
                custody_lineage_b64u: "lineage".to_owned(),
                command_digest_b64u: "command-a".to_owned(),
                deriver_b_command_digest_b64u: "command-b".to_owned(),
                ceremony_context_digest_b64u: "context".to_owned(),
                refresh_context_b64u: "refresh-context".to_owned(),
                deriver_a_refresh_command_b64u: "refresh-command-a".to_owned(),
                deriver_b_refresh_command_b64u: "refresh-command-b".to_owned(),
                session_id_b64u: "session".to_owned(),
                nonce_b64u: "nonce".to_owned(),
                current_epoch: 7,
                next_epoch: 8,
                expected_control_plane_revision: 41,
            },
            outcome: CloudflareTenantRootRefreshTerminalOutcomeV1::Completed,
            response: persisted.clone(),
        };

        let replay = replay_terminal_refresh_response_v1(&fence)
            .expect("completed terminal state must replay")
            .expect("completed terminal state must return a response");
        assert_eq!(replay, persisted);
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn read_router_public_body_v1(
    request: &mut Request,
    env: &Env,
    label: &'static str,
) -> worker::Result<Result<Vec<u8>, Response>> {
    match request.bytes().await {
        Ok(bytes) => Ok(Ok(bytes)),
        Err(err) => {
            let response = Response::error(format!("{label} body read failed: {err}"), 400)?;
            Ok(Err(cloudflare_router_normal_signing_response_v1(
                response, request, env,
            )?))
        }
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn parse_router_public_body_v1<T>(
    body: &[u8],
    parser: fn(&[u8]) -> RouterAbProtocolResult<T>,
    request: &Request,
    env: &Env,
) -> worker::Result<Result<T, Response>> {
    match parser(body) {
        Ok(parsed) => Ok(Ok(parsed)),
        Err(err) => {
            let response = cloudflare_protocol_error_response_v1(err)?;
            Ok(Err(cloudflare_router_normal_signing_response_v1(
                response, request, env,
            )?))
        }
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn router_json_cors_response_v1<T: serde::Serialize>(
    result: RouterAbProtocolResult<T>,
    request: &Request,
    env: &Env,
) -> worker::Result<Response> {
    match result {
        Ok(response) => {
            let response = Response::from_json(&response)?;
            cloudflare_router_normal_signing_response_v1(response, request, env)
        }
        Err(err) => {
            let response = cloudflare_protocol_error_response_v1(err)?;
            cloudflare_router_normal_signing_response_v1(response, request, env)
        }
    }
}

/// As `router_json_cors_response_v1`, but attaches the Router's ECDSA boundary
/// spans as `Server-Timing` (Refactor 94B Phase 0). The response body is
/// untouched — the Gateway reads the header and drops it before the browser.
/// A failed leg still carries whatever spans completed before it failed.
#[cfg(feature = "strict-worker-router-entrypoint")]
fn router_ecdsa_timed_json_cors_response_v1<T: serde::Serialize>(
    result: RouterAbProtocolResult<T>,
    timing: &CloudflareEcdsaBoundaryTimingV1,
    request: &Request,
    env: &Env,
) -> worker::Result<Response> {
    let response = router_json_cors_response_v1(result, request, env)?;
    timing.apply_to(&response)?;
    Ok(response)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn router_ecdsa_trace_context_v1(
    request: &Request,
    env: &Env,
) -> worker::Result<Result<Option<CloudflareTraceIdV1>, Response>> {
    match parse_cloudflare_trace_id_from_request_v1(request) {
        Ok(trace_id) => Ok(Ok(trace_id)),
        Err(error) => {
            let response = cloudflare_protocol_error_response_v1(error)?;
            Ok(Err(cloudflare_router_normal_signing_response_v1(
                response, request, env,
            )?))
        }
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn is_cloudflare_router_public_keyset_path(path: &str) -> bool {
    let normalized = path.strip_suffix('/').unwrap_or(path);
    normalized == CLOUDFLARE_ROUTER_PUBLIC_KEYSET_WELL_KNOWN_PATH
        || normalized == CLOUDFLARE_ROUTER_PUBLIC_KEYSET_PATH
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn is_cloudflare_router_normal_signing_public_path(path: &str) -> bool {
    let normalized = path.strip_suffix('/').unwrap_or(path);
    normalized == CLOUDFLARE_ROUTER_NORMAL_SIGNING_ROUND1_PREPARE_PUBLIC_REQUEST_PATH
        || normalized == CLOUDFLARE_ROUTER_NORMAL_SIGNING_PUBLIC_REQUEST_PATH
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn is_cloudflare_router_ab_ecdsa_derivation_public_path(path: &str) -> bool {
    let normalized = path.strip_suffix('/').unwrap_or(path);
    normalized == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PUBLIC_REQUEST_PATH
        || normalized == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ACTIVATION_PUBLIC_REQUEST_PATH
        || normalized == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ADD_SIGNER_PUBLIC_REQUEST_PATH
        || normalized == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_EXPORT_PUBLIC_REQUEST_PATH
        || normalized == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_REFRESH_PUBLIC_REQUEST_PATH
        || normalized == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PREPARE_PUBLIC_REQUEST_PATH
        || normalized == CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_SIGNING_PUBLIC_REQUEST_PATH
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn router_ab_ecdsa_derivation_registration_purpose_for_public_path(
    path: &str,
) -> Option<RouterAbEcdsaDerivationRegistrationPurposeV1> {
    let normalized = path.strip_suffix('/').unwrap_or(path);
    match normalized {
        CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_REGISTRATION_PUBLIC_REQUEST_PATH => {
            Some(RouterAbEcdsaDerivationRegistrationPurposeV1::WalletRegistration)
        }
        CLOUDFLARE_ROUTER_AB_ECDSA_DERIVATION_ADD_SIGNER_PUBLIC_REQUEST_PATH => {
            Some(RouterAbEcdsaDerivationRegistrationPurposeV1::WalletAddSigner)
        }
        _ => None,
    }
}
