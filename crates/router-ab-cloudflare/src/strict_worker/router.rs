use super::cors::{
    cloudflare_router_normal_signing_preflight_response_v1,
    cloudflare_router_normal_signing_response_v1,
    cloudflare_router_public_keyset_preflight_response_v1,
    cloudflare_router_public_keyset_response_v1,
};
use super::*;
use crate::durable_object::tenant_root_creation::{
    decode_bounded_json_request, derive_tenant_root_creation_authority_object_v1,
    destination_bootstrap_request_scope_from_wire_v1,
    execute_cloudflare_router_tenant_root_creation_active_state_read_call_v1,
    execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1,
    execute_cloudflare_router_tenant_root_creation_cleanup_call_v1,
    execute_cloudflare_router_tenant_root_creation_initial_activation_call_v1,
    execute_cloudflare_router_tenant_root_destination_bootstrap_call_v1,
    execute_cloudflare_router_tenant_root_refresh_activation_call_v1,
    execute_cloudflare_router_tenant_root_refresh_admission_call_v1,
    execute_cloudflare_router_tenant_root_refresh_attempt_reservation_call_v1,
    execute_cloudflare_router_tenant_root_restore_initial_activation_call_v1,
    execute_cloudflare_router_tenant_root_restore_refresh_checkpoint_call_v1,
    tenant_root_scheduled_refresh_next_at_ms_v1, CloudflareTenantRootCreationInstallationRoleV1,
    CloudflareTenantRootDestinationBootstrapRequestV1,
    CloudflareTenantRootRefreshAdmissionOutcomeV1, CloudflareTenantRootRefreshFenceV1,
    CloudflareTenantRootRefreshJobReadV1, CloudflareTenantRootRefreshTriggerV1,
    CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
    CloudflareTenantRootRestoreRefreshCheckpointResponseV1,
    CloudflareTenantRootRestoreRefreshCheckpointStateV1,
    CloudflareTenantRootRestoreRefreshCheckpointV1, CloudflareTenantRootRestoreRefreshCommandsV1,
    CloudflareTenantRootRestoreRefreshDeriverDispatchV1,
    CloudflareTenantRootRestoreRefreshRolePromotionV1,
    TENANT_ROOT_DESTINATION_BOOTSTRAP_REQUEST_MAX_BYTES_V1,
};
#[cfg(feature = "strict-worker-router-entrypoint")]
use crate::post_service_json;
use crate::tenant_root_control_plane::{
    execute_cloudflare_tenant_root_control_plane_initial_activation_service_call_v1,
    execute_cloudflare_tenant_root_control_plane_restore_initial_activation_service_call_v1,
    CloudflareTenantRootControlPlaneInitialActivationRequestV1,
    CloudflareTenantRootControlPlaneRefreshActivationRequestV1,
    CloudflareTenantRootControlPlaneRegisterManifestRequestV1,
    CloudflareTenantRootControlPlaneRegisterManifestResponseV1,
    CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1,
    CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1,
    CloudflareTenantRootControlPlaneRestoreRefreshCommandsResponseV1,
    CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1,
    CloudflareTenantRootControlPlaneRestoreRoleImportKeyResponseV1,
    TENANT_ROOT_CONTROL_PLANE_REGISTER_MANIFEST_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_RESTORE_REFRESH_COMMANDS_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_REQUEST_MAX_BYTES_V1,
};
#[cfg(feature = "strict-worker-router-entrypoint")]
use crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1;
#[cfg(feature = "strict-worker-router-entrypoint")]
use crate::tenant_root_restore_refresh_runtime::{
    CloudflareDeriverTenantRootRestoreRefreshRequestV1,
    CloudflareDeriverTenantRootRestoreRefreshResponseV1,
};
use crate::tenant_root_role_runtime::{
    CloudflareDeriverTenantRootCleanupResponseV1,
    CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1,
    CloudflareDeriverTenantRootManagedRestoreRequestV1,
    CloudflareDeriverTenantRootManagedRestoreResponseV1,
    CloudflareDeriverTenantRootManagedRestoreStatusV1,
    CloudflareDeriverTenantRootRefreshActivationRequestV1,
    CloudflareDeriverTenantRootRefreshActivationResponseV1,
    CloudflareDeriverTenantRootRefreshRequestV1, CloudflareDeriverTenantRootRefreshResponseV1,
    CloudflareDeriverTenantRootRestoreRoleImportAcceptRequestV1,
    CloudflareDeriverTenantRootRestoreRoleImportAcceptResponseV1,
    CloudflareDeriverTenantRootRestoreRoleImportKeyRequestV1,
    CloudflareDeriverTenantRootRestoreRoleImportKeyResponseV1,
    CloudflareDeriverTenantRootStatusRequestV1, CloudflareDeriverTenantRootStatusResponseV1,
    CloudflareTenantRootCreateRoleV1,
};
#[cfg(feature = "strict-worker-router-entrypoint")]
use crate::{
    execute_cloudflare_deriver_tenant_root_cleanup_service_call_v1,
    execute_cloudflare_deriver_tenant_root_create_role_share_service_call_v1,
    execute_cloudflare_deriver_tenant_root_initial_activation_service_call_v1,
    execute_cloudflare_deriver_tenant_root_refresh_activation_service_call_v1,
    execute_cloudflare_deriver_tenant_root_refresh_service_call_v1,
    execute_cloudflare_signing_worker_linked_device_ecdsa_finalize_service_call_v1,
    execute_cloudflare_tenant_root_control_plane_cleanup_command_service_call_v1,
    execute_cloudflare_tenant_root_control_plane_create_tenant_root_service_call_v1,
    execute_cloudflare_tenant_root_control_plane_refresh_activation_service_call_v1,
    execute_cloudflare_tenant_root_control_plane_refresh_commands_service_call_v1,
    execute_cloudflare_tenant_root_control_plane_role_creation_command_service_call_v1,
    handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_finalize_internal_step_up_request_v1,
    handle_cloudflare_router_ab_ecdsa_derivation_evm_digest_signing_prepare_internal_step_up_request_v1,
    handle_cloudflare_router_normal_signing_finalize_internal_linked_device_request_v2,
    handle_cloudflare_router_normal_signing_finalize_internal_step_up_request_v2,
    handle_cloudflare_router_normal_signing_prepare_internal_linked_device_request_v2,
    handle_cloudflare_router_normal_signing_prepare_internal_step_up_request_v2,
    parse_cloudflare_router_authorized_ed25519_prepare_request_v2_json,
    parse_cloudflare_router_authorized_linked_device_ecdsa_finalize_request_v1_json,
    CloudflareDeriverTenantRootCleanupRequestV1,
    CloudflareDeriverTenantRootCreateRoleShareRequestV1,
    CloudflareDeriverTenantRootCreateRoleShareResponseV1,
    CloudflareDeriverTenantRootInitialActivationRequestV1,
    CloudflareDeriverTenantRootInitialActivationResponseV1, CloudflarePeerBindingV1,
    CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    CloudflareRouterEcdsaAcceptedCapabilityBindingV1,
    CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    CloudflareRouterEd25519AcceptedCapabilityBindingV1, CloudflareRouterEd25519JwksJwtVerifierV1,
    CloudflareTenantRootControlPlaneCleanupCommandRequestV1,
    CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
    CloudflareTenantRootControlPlaneCreateTenantRootResponseV1,
    CloudflareTenantRootControlPlaneRefreshCommandsRequestV1,
    CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1,
    CloudflareTenantRootControlPlaneRoleV1, CloudflareTenantRootCreationStatusV1,
    CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_PRIVATE_REQUEST_PATH,
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
use router_ab_core::{
    verify_tenant_root_creation_evidence_v1, TenantRootCeremonyContextV1,
    TenantRootControlPlaneAuthorityIdV1, TenantRootRefreshContributionAadV1,
    TenantRootRestoreRefreshRoleCommandV1, TenantRootRestoreRoleImportCommandV1,
    TenantRootSignedRefreshCommitmentV1, TenantRootSignedRefreshContributionV1,
    TenantRootSignedShareInstallationEvidenceV1, TwoPartyDeriverRole,
    VerifiedTenantRootRefreshCommitmentPairV1, VerifiedTenantRootRefreshCommitmentV1,
    VerifiedTenantRootRestoreRefreshRoleCommandV1, VerifiedTenantRootSignedRefreshContributionV1,
    VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
};
#[cfg(feature = "strict-worker-router-entrypoint")]
use sha2::{Digest, Sha256};
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

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug)]
struct VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1 {
    context: TenantRootCeremonyContextV1,
    context_b64u: String,
    context_digest_b64u: String,
    deriver_a_command_b64u: String,
    deriver_b_command_b64u: String,
    deriver_a_command: VerifiedTenantRootRestoreRefreshRoleCommandV1,
    deriver_b_command: VerifiedTenantRootRestoreRefreshRoleCommandV1,
    deriver_a_command_digest_b64u: String,
    deriver_b_command_digest_b64u: String,
    issuer_key_id: String,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug)]
struct VerifiedCloudflareRouterTenantRootRestoreRefreshCommitmentV1 {
    wire_b64u: String,
    commitment: VerifiedTenantRootRefreshCommitmentV1,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug)]
struct VerifiedCloudflareRouterTenantRootRestoreRefreshEvidenceV1 {
    wire_b64u: String,
    evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, serde::Serialize)]
struct CloudflareRouterTenantRootRestoreRefreshResponseV1 {
    refresh_context_b64u: String,
    refresh_context_digest_b64u: String,
    deriver_a_refresh_command_b64u: String,
    deriver_b_refresh_command_b64u: String,
    deriver_a_refresh_command_digest_b64u: String,
    deriver_b_refresh_command_digest_b64u: String,
    deriver_a_signed_installation_evidence_b64u: String,
    deriver_b_signed_installation_evidence_b64u: String,
    deriver_a_installation_evidence_digest_b64u: String,
    deriver_b_installation_evidence_digest_b64u: String,
    issuer_key_id: String,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum CloudflareRouterTenantRootRestoreBootstrapCleanupV1 {
    Destroyed {
        receipt_digest_b64u: String,
    },
    Outstanding {
        outstanding: CloudflareRouterTenantRootRestoreOutstandingCleanupV1,
    },
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct CloudflareRouterTenantRootRestoreOutstandingCleanupV1 {
    roles: Vec<CloudflareTenantRootCreateRoleV1>,
    description: String,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct CloudflareRouterTenantRootRestoreRoleCleanupReceiptsV1 {
    deriver_a: String,
    deriver_b: String,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum CloudflareRouterTenantRootRestoreRoleCleanupV1 {
    BothRolesIncomplete {
        outstanding: CloudflareRouterTenantRootRestoreOutstandingCleanupV1,
    },
    DeriverAIncomplete {
        deriver_b_receipt_digest_b64u: String,
        outstanding: CloudflareRouterTenantRootRestoreOutstandingCleanupV1,
    },
    DeriverBIncomplete {
        deriver_a_receipt_digest_b64u: String,
        outstanding: CloudflareRouterTenantRootRestoreOutstandingCleanupV1,
    },
    Complete {
        receipts: CloudflareRouterTenantRootRestoreRoleCleanupReceiptsV1,
    },
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct CloudflareRouterTenantRootRestoreCleanupV1 {
    bootstrap: CloudflareRouterTenantRootRestoreBootstrapCleanupV1,
    roles: CloudflareRouterTenantRootRestoreRoleCleanupV1,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, serde::Serialize)]
struct CloudflareRouterTenantRootRestoreActivationResponseV1 {
    activation_receipt_b64u: String,
    destination_lineage_id: String,
    activated_epoch: u64,
    activation_receipt_digest_b64u: String,
    forward_refresh_receipt_digest_b64u: String,
    continuity_canary_receipt_digest_b64u: String,
    root_commitment_matches: bool,
    cleanup: CloudflareRouterTenantRootRestoreCleanupV1,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum CloudflareRouterTenantRootRestoreCleanupRequestV1 {
    PreActivation {
        cleanup_grant_b64u: String,
    },
    PostActivation {
        activation_receipt_b64u: String,
        cleanup: CloudflareRouterTenantRootRestoreCleanupV1,
    },
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(serde::Serialize)]
#[serde(untagged)]
enum CloudflareRouterTenantRootRestoreCleanupResponseV1 {
    PreActivation(CloudflareRouterTenantRootRestoreRoleCleanupV1),
    PostActivation(CloudflareRouterTenantRootRestoreCleanupV1),
}

#[cfg(feature = "strict-worker-router-entrypoint")]
enum CloudflareRouterTenantRootRestoreRefreshOutcomeV1 {
    Completed(CloudflareRouterTenantRootRestoreRefreshResponseV1),
    AuthorizationExpiredBeforeCommands {
        grant_digest_b64u: String,
        operation_digest_b64u: String,
        deriver_dispatch: CloudflareTenantRootRestoreRefreshDeriverDispatchV1,
    },
}

#[cfg(feature = "strict-worker-router-entrypoint")]
enum RestoreRefreshCommandValidationV1 {
    Fresh { now_ms: u64 },
    Persisted,
}

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
        ),
        job: active.job,
        deriver_a_status,
        deriver_b_status,
    })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum CloudflareRouterTenantRootRetirementEvidenceV1 {
    Confirmed,
    Unverified,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, serde::Serialize)]
struct CloudflareRouterTenantRootRefreshResponseV1 {
    activation_receipt_digest_b64u: String,
    lifecycle_revision: u64,
    retirement: CloudflareRouterTenantRootRetirementEvidenceV1,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct CloudflareRouterTenantRootRefreshRequestV1 {
    operation_id: String,
    identity_digest_b64u: String,
    custody_lineage_b64u: String,
    expected_lifecycle_revision: u64,
    expires_at_ms: u64,
    trigger: CloudflareTenantRootRefreshTriggerV1,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
enum CloudflareRouterTenantRootRefreshResultV1 {
    Completed(CloudflareRouterTenantRootRefreshResponseV1),
    Throttled { retry_at_ms: u64 },
    InProgress,
    RevisionMoved,
    AuthorizationExpired,
    NotDue { next_run_at_ms: u64 },
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn refresh_http_response_v1(
    result: CloudflareRouterTenantRootRefreshResultV1,
) -> worker::Result<Response> {
    match result {
        CloudflareRouterTenantRootRefreshResultV1::Completed(response) => {
            Response::from_json(&response)
        }
        CloudflareRouterTenantRootRefreshResultV1::Throttled { retry_at_ms } => {
            Ok(Response::from_json(&serde_json::json!({
                "code": "tenant_root_refresh_throttled",
                "retry_at_ms": retry_at_ms,
            }))?
            .with_status(429))
        }
        CloudflareRouterTenantRootRefreshResultV1::RevisionMoved => {
            Ok(Response::from_json(&serde_json::json!({
                "code": "lifecycle_revision_moved",
            }))?
            .with_status(409))
        }
        CloudflareRouterTenantRootRefreshResultV1::AuthorizationExpired => {
            Ok(Response::from_json(&serde_json::json!({
                "code": "authorization_expired",
            }))?
            .with_status(409))
        }
        CloudflareRouterTenantRootRefreshResultV1::NotDue { next_run_at_ms } => {
            Ok(Response::from_json(&serde_json::json!({
                "code": "tenant_root_refresh_not_due",
                "next_run_at_ms": next_run_at_ms,
            }))?
            .with_status(409))
        }
        CloudflareRouterTenantRootRefreshResultV1::InProgress => {
            Ok(Response::from_json(&serde_json::json!({
                "code": "tenant_root_refresh_in_progress",
            }))?
            .with_status(409))
        }
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct CloudflareRouterTenantRootManagedRestoreRequestV1 {
    /// Exact control-plane-signed public role-unavailable state.
    public_state_b64u: String,
    /// Exact control-plane-signed one-use restore capability.
    restore_capability_b64u: String,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
const TENANT_ROOT_MANAGED_RESTORE_REQUEST_MAX_BYTES_V1: usize = 128 * 1024;

#[cfg(feature = "strict-worker-router-entrypoint")]
struct VerifiedCloudflareRouterTenantRootManagedRestoreRequestV1 {
    public_state_b64u: String,
    restore_capability_b64u: String,
    identity_b64u: String,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    active_epoch: u64,
    active_lifecycle_revision: u64,
    active_activation_receipt_b64u: String,
    unavailable_role: TenantRootManagedRestoreRoleV1,
    outage_observation_digest: TenantRootLifecycleReceiptDigestV1,
    active_activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    capability: VerifiedTenantRootManagedRestoreCapabilityV1,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn decode_exact_tenant_root_wire_v1(
    field: &'static str,
    encoded: &str,
) -> RouterAbProtocolResult<Vec<u8>> {
    let bytes = crate::decode_base64url_bytes_v1(field, encoded)?;
    if crate::encode_base64url_bytes_v1(&bytes) != encoded {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{field} must use canonical unpadded base64url"),
        ));
    }
    Ok(bytes)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn managed_restore_derivation_error_v1(
    field: &'static str,
    error: router_ab_core::RouterAbDerivationError,
) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!("{field} was refused: {error}"),
    )
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn verify_cloudflare_router_tenant_root_managed_restore_request_v1(
    env: &Env,
    request: CloudflareRouterTenantRootManagedRestoreRequestV1,
) -> RouterAbProtocolResult<VerifiedCloudflareRouterTenantRootManagedRestoreRequestV1> {
    let public_state_bytes = decode_exact_tenant_root_wire_v1(
        "tenant-root managed-restore public state",
        &request.public_state_b64u,
    )?;
    let signed_public_state =
        TenantRootSignedManagedRestoreRoleUnavailableV1::decode_canonical_bytes(
            &public_state_bytes,
        )
        .map_err(|error| {
            managed_restore_derivation_error_v1("tenant-root managed-restore public state", error)
        })?;
    let reader = CloudflareWorkerEnvReaderV1::new(env);
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(&reader)?;
    let issuer_key_id = signed_public_state.issuer_key_id().to_owned();
    let issuer_key = issuer_keys
        .for_issuer_key_id(&issuer_key_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root managed-restore public-state issuer is not trusted by the Router",
            )
        })?;
    let verified_public_state = signed_public_state
        .verify(&issuer_key_id, issuer_key)
        .map_err(|error| {
            managed_restore_derivation_error_v1("tenant-root managed-restore public state", error)
        })?;

    let capability_bytes = decode_exact_tenant_root_wire_v1(
        "tenant-root managed-restore capability",
        &request.restore_capability_b64u,
    )?;
    let signed_capability =
        TenantRootSignedManagedRestoreCapabilityV1::decode_canonical_bytes(&capability_bytes)
            .map_err(|error| {
                managed_restore_derivation_error_v1("tenant-root managed-restore capability", error)
            })?;
    if signed_capability.issuer_key_id() != verified_public_state.issuer_key_id() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore capability and public state use different issuers",
        ));
    }
    let capability = signed_capability
        .verify(
            verified_public_state.state(),
            verified_public_state.issuer_key_id(),
            issuer_key,
        )
        .map_err(|error| {
            managed_restore_derivation_error_v1("tenant-root managed-restore capability", error)
        })?;
    let identity_digest = verified_public_state
        .state()
        .active()
        .identity()
        .digest()
        .map_err(|error| {
            managed_restore_derivation_error_v1(
                "tenant-root managed-restore public-state identity",
                error,
            )
        })?;
    let custody_lineage = verified_public_state.state().active().custody_lineage();
    let identity_canonical_bytes = verified_public_state
        .state()
        .active()
        .identity()
        .canonical_bytes()
        .map_err(|error| {
            managed_restore_derivation_error_v1(
                "tenant-root managed-restore public-state identity",
                error,
            )
        })?;
    let identity_b64u = crate::encode_base64url_bytes_v1(&identity_canonical_bytes);
    let active_epoch = verified_public_state
        .state()
        .active()
        .current()
        .epoch()
        .get()
        .get();
    let active_lifecycle_revision = verified_public_state.state().active().revision();
    let active_activation_receipt_b64u = crate::encode_base64url_bytes_v1(
        verified_public_state
            .state()
            .active()
            .activation_receipt_bytes(),
    );
    let outage_observation_digest = verified_public_state.state().unavailable_receipt().digest();
    let active_activation_receipt_digest = verified_public_state
        .state()
        .active()
        .activation_receipt_digest();
    if verified_public_state.unavailable_role() != capability.role()
        || capability.identity_digest() != identity_digest
        || capability.custody_lineage() != custody_lineage
        || capability.activation_receipt_digest() != active_activation_receipt_digest
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore capability does not match the signed unavailable state",
        ));
    }
    Ok(VerifiedCloudflareRouterTenantRootManagedRestoreRequestV1 {
        public_state_b64u: request.public_state_b64u,
        restore_capability_b64u: request.restore_capability_b64u,
        identity_b64u,
        identity_digest,
        custody_lineage,
        active_epoch,
        active_lifecycle_revision,
        active_activation_receipt_b64u,
        unavailable_role: capability.role(),
        outage_observation_digest,
        active_activation_receipt_digest,
        capability,
    })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn require_cloudflare_router_managed_restore_checkpoint_artifacts_v1(
    active: &crate::durable_object::tenant_root_creation::CloudflareVerifiedTenantRootActiveStateV1,
    authorization: &VerifiedCloudflareRouterTenantRootManagedRestoreRequestV1,
) -> RouterAbProtocolResult<()> {
    let identity_digest_b64u =
        crate::encode_base64url_bytes_v1(authorization.identity_digest.as_bytes());
    let custody_lineage_b64u = authorization.custody_lineage.to_base64url();
    let activation_receipt_digest_b64u =
        crate::encode_base64url_bytes_v1(authorization.active_activation_receipt_digest.as_bytes());

    let crate::durable_object::tenant_root_creation::CloudflareTenantRootManagedRestoreFenceV1::Terminal {
        challenge,
        public_state_b64u,
        capability_b64u,
        ..
    } = &active.managed_restore_fence
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root managed-restore authorization is not terminally checkpointed",
        ));
    };
    let challenge_identity =
        TenantRootIdentityV1::decode_canonical_bytes(&decode_exact_tenant_root_wire_v1(
            "tenant-root managed-restore checkpoint identity",
            &challenge.identity_b64u,
        )?)
        .map_err(|error| {
            managed_restore_derivation_error_v1(
                "tenant-root managed-restore checkpoint identity",
                error,
            )
        })?;
    let challenge_identity_canonical_bytes =
        challenge_identity.canonical_bytes().map_err(|error| {
            managed_restore_derivation_error_v1(
                "tenant-root managed-restore checkpoint identity",
                error,
            )
        })?;
    let challenge_identity_b64u =
        crate::encode_base64url_bytes_v1(&challenge_identity_canonical_bytes);
    let challenge_identity_digest = challenge_identity.digest().map_err(|error| {
        managed_restore_derivation_error_v1(
            "tenant-root managed-restore checkpoint identity",
            error,
        )
    })?;
    let outage_observation_digest_b64u =
        crate::encode_base64url_bytes_v1(authorization.outage_observation_digest.as_bytes());
    if public_state_b64u != &authorization.public_state_b64u
        || capability_b64u != &authorization.restore_capability_b64u
        || challenge.identity_b64u != authorization.identity_b64u
        || challenge_identity_b64u != authorization.identity_b64u
        || challenge_identity_digest != authorization.identity_digest
        || challenge.identity_digest_b64u != identity_digest_b64u
        || challenge.custody_lineage_b64u != custody_lineage_b64u
        || challenge.active_epoch != authorization.active_epoch
        || challenge.active_lifecycle_revision != authorization.active_lifecycle_revision
        || challenge.activation_receipt_b64u != authorization.active_activation_receipt_b64u
        || challenge.activation_receipt_digest_b64u != activation_receipt_digest_b64u
        || challenge.outage_observation_digest_b64u != outage_observation_digest_b64u
        || challenge.unavailable_role != authorization.unavailable_role
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore authorization checkpoint does not match its signed scope",
        ));
    }
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn require_cloudflare_router_managed_restore_checkpoint_current_state_v1(
    active: &crate::durable_object::tenant_root_creation::CloudflareVerifiedTenantRootActiveStateV1,
    authorization: &VerifiedCloudflareRouterTenantRootManagedRestoreRequestV1,
) -> RouterAbProtocolResult<()> {
    let active_epoch = match active.activation_receipt.binding() {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => binding.epoch(),
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => binding.next_epoch(),
    }
    .get()
    .get();
    let active_activation_receipt_b64u =
        crate::encode_base64url_bytes_v1(active.activation_receipt.canonical_bytes());
    let identity_digest_b64u =
        crate::encode_base64url_bytes_v1(authorization.identity_digest.as_bytes());
    let custody_lineage_b64u = authorization.custody_lineage.to_base64url();
    let crate::durable_object::tenant_root_creation::CloudflareTenantRootManagedRestoreFenceV1::Terminal {
        challenge,
        ..
    } = &active.managed_restore_fence
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root managed-restore authorization is not terminally checkpointed",
        ));
    };
    if active.activation_receipt.digest() != authorization.active_activation_receipt_digest
        || challenge.identity_b64u != authorization.identity_b64u
        || challenge.identity_digest_b64u != identity_digest_b64u
        || challenge.custody_lineage_b64u != custody_lineage_b64u
        || challenge.unavailable_role != authorization.unavailable_role
        || challenge.active_epoch != active_epoch
        || challenge.active_lifecycle_revision != active.lifecycle_revision
        || challenge.activation_receipt_b64u != active_activation_receipt_b64u
        || challenge.activation_receipt_digest_b64u
            != crate::encode_base64url_bytes_v1(active.activation_receipt.digest().as_bytes())
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore authorization checkpoint does not match current active state",
        ));
    }
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn finish_cloudflare_router_tenant_root_initial_activation_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    genesis: &CloudflareTenantRootControlPlaneCreateTenantRootResponseV1,
) -> RouterAbProtocolResult<()> {
    let identity_digest_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root creation identity digest",
        &genesis.identity_digest_b64u,
    )?;
    let identity_digest = router_ab_core::TenantRootIdentityDigestV1::from_bytes(
        identity_digest_bytes.try_into().map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "tenant-root creation identity digest must contain exactly 32 bytes",
            )
        })?,
    );
    let custody_lineage =
        router_ab_core::TenantRootCustodyLineageId::from_base64url(&genesis.custody_lineage_b64u)
            .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("tenant-root creation custody lineage is invalid: {error}"),
            )
        })?;
    let active = execute_cloudflare_router_tenant_root_creation_active_state_read_call_v1(
        env,
        identity_digest,
        custody_lineage,
    )
    .await?;
    if active.transition()
        != router_ab_core::TenantRootActivationReceiptTransitionV1::InitialCreation
    {
        return Ok(());
    }
    let role_activation = CloudflareDeriverTenantRootInitialActivationRequestV1 {
        activation_receipt_b64u: crate::encode_base64url_bytes_v1(active.canonical_bytes()),
    };
    execute_cloudflare_deriver_tenant_root_initial_activation_service_call_v1(
        env,
        &runtime.bindings().deriver_a,
        &role_activation,
    )
    .await?;
    execute_cloudflare_deriver_tenant_root_initial_activation_service_call_v1(
        env,
        &runtime.bindings().deriver_b,
        &role_activation,
    )
    .await?;
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn coordinate_cloudflare_router_tenant_root_creation_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneCreateTenantRootResponseV1> {
    let genesis = execute_cloudflare_tenant_root_control_plane_create_tenant_root_service_call_v1(
        env, &request,
    )
    .await?;
    match &genesis.status {
        CloudflareTenantRootCreationStatusV1::Ready { .. } => {
            finish_cloudflare_router_tenant_root_initial_activation_v1(env, runtime, &genesis)
                .await?;
            return Ok(genesis);
        }
        CloudflareTenantRootCreationStatusV1::Abandoned { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root creation was abandoned; a fresh grant is required",
            ));
        }
        CloudflareTenantRootCreationStatusV1::OneRoleInstalled { role } => {
            let cleanup =
                execute_cloudflare_tenant_root_control_plane_cleanup_command_service_call_v1(
                    env,
                    &CloudflareTenantRootControlPlaneCleanupCommandRequestV1::PendingCreation {
                        identity_digest_b64u: genesis.identity_digest_b64u.clone(),
                        custody_lineage_b64u: genesis.custody_lineage_b64u.clone(),
                    },
                )
                .await?;
            if cleanup.role != *role {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                    "tenant-root cleanup command names a different installed role",
                ));
            }
            let cleanup_command_bytes = crate::decode_base64url_bytes_v1(
                "tenant-root cleanup command",
                &cleanup.cleanup_command_b64u,
            )?;
            let cleanup_command =
                router_ab_core::TenantRootRoleCleanupCommandV1::decode_canonical_bytes(
                    &cleanup_command_bytes,
                )
                .map_err(|error| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        format!("tenant-root cleanup command was malformed: {error}"),
                    )
                })?;
            let claimed_target = cleanup_command.claimed_target();
            let expected_role = role.to_protocol();
            let (authority_id, _) = derive_tenant_root_creation_authority_object_v1(
                env,
                claimed_target.identity_digest(),
                claimed_target.custody_lineage(),
            )?;
            let reader = crate::CloudflareWorkerEnvReaderV1::new(env);
            let issuer_keys =
                crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(
                    &reader,
                )?;
            let issuer_key_id = cleanup_command.issuer_key_id().to_owned();
            let issuer_key = issuer_keys
                .for_issuer_key_id(&issuer_key_id)
                .ok_or_else(|| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                        "tenant-root cleanup command issuer is not trusted by the Router",
                    )
                })?;
            let verified_cleanup = cleanup_command
                .verify(
                    &claimed_target,
                    expected_role,
                    authority_id,
                    &issuer_key_id,
                    issuer_key,
                )
                .map_err(|error| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                        format!("tenant-root cleanup command verification failed: {error}"),
                    )
                })?;
            let deriver = match role {
                CloudflareTenantRootControlPlaneRoleV1::DeriverA => &runtime.bindings().deriver_a,
                CloudflareTenantRootControlPlaneRoleV1::DeriverB => &runtime.bindings().deriver_b,
            };
            let cleaned = execute_cloudflare_deriver_tenant_root_cleanup_service_call_v1(
                env,
                deriver,
                &CloudflareDeriverTenantRootCleanupRequestV1 {
                    cleanup_command_b64u: cleanup.cleanup_command_b64u,
                },
            )
            .await?;
            let cleanup_receipt = crate::decode_base64url_bytes_v1(
                "tenant-root cleanup terminal receipt",
                cleaned.cleanup_receipt_b64u(),
            )?;
            execute_cloudflare_router_tenant_root_creation_cleanup_call_v1(
                env,
                &verified_cleanup,
                &cleanup_receipt,
            )
            .await?;
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root partial creation was cleaned; a fresh grant is required",
            ));
        }
        CloudflareTenantRootCreationStatusV1::Pending => {}
    }

    let command_request = |role| CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1 {
        identity_digest_b64u: genesis.identity_digest_b64u.clone(),
        custody_lineage_b64u: genesis.custody_lineage_b64u.clone(),
        role,
    };
    let deriver_a =
        execute_cloudflare_tenant_root_control_plane_role_creation_command_service_call_v1(
            env,
            &command_request(CloudflareTenantRootControlPlaneRoleV1::DeriverA),
        )
        .await?;
    let deriver_b =
        execute_cloudflare_tenant_root_control_plane_role_creation_command_service_call_v1(
            env,
            &command_request(CloudflareTenantRootControlPlaneRoleV1::DeriverB),
        )
        .await?;

    let completed = execute_cloudflare_deriver_tenant_root_create_role_share_service_call_v1(
        env,
        &runtime.bindings().deriver_a,
        &CloudflareDeriverTenantRootCreateRoleShareRequestV1::Initiator {
            role_creation_command_package_b64u: deriver_a.role_creation_command_package_b64u,
            peer_role_creation_command_package_b64u: deriver_b.role_creation_command_package_b64u,
        },
    )
    .await?;
    let CloudflareDeriverTenantRootCreateRoleShareResponseV1::Completed {
        role: CloudflareTenantRootCreateRoleV1::DeriverA,
        deriver_a_signed_installation_evidence_b64u,
        deriver_b_signed_installation_evidence_b64u,
        deriver_a_signed_managed_backup_b64u,
        deriver_b_signed_managed_backup_b64u,
        ecdsa_provider_canary_receipt_b64u,
        ed25519_provider_canary_receipt_b64u,
        ..
    } = completed
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root creation initiator response names the wrong role",
        ));
    };

    let issued_activation =
        execute_cloudflare_tenant_root_control_plane_initial_activation_service_call_v1(
            env,
            &CloudflareTenantRootControlPlaneInitialActivationRequestV1 {
                deriver_a_signed_installation_evidence_b64u,
                deriver_b_signed_installation_evidence_b64u,
                deriver_a_signed_managed_backup_b64u,
                deriver_b_signed_managed_backup_b64u,
                ecdsa_provider_canary_receipt_b64u,
                ed25519_provider_canary_receipt_b64u,
            },
        )
        .await?;
    let activation_receipt_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root initial activation receipt",
        &issued_activation.activation_receipt_b64u,
    )?;
    execute_cloudflare_router_tenant_root_creation_initial_activation_call_v1(
        env,
        &activation_receipt_bytes,
    )
    .await?;
    let role_activation = CloudflareDeriverTenantRootInitialActivationRequestV1 {
        activation_receipt_b64u: issued_activation.activation_receipt_b64u,
    };
    execute_cloudflare_deriver_tenant_root_initial_activation_service_call_v1(
        env,
        &runtime.bindings().deriver_a,
        &role_activation,
    )
    .await?;
    execute_cloudflare_deriver_tenant_root_initial_activation_service_call_v1(
        env,
        &runtime.bindings().deriver_b,
        &role_activation,
    )
    .await?;

    let completed_state =
        execute_cloudflare_tenant_root_control_plane_create_tenant_root_service_call_v1(
            env, &request,
        )
        .await?;
    if !matches!(
        completed_state.status,
        CloudflareTenantRootCreationStatusV1::Ready { .. }
    ) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root creation returned before both role installations were checkpointed",
        ));
    }
    Ok(completed_state)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
const fn tenant_root_control_plane_role_v1(
    role: CloudflareTenantRootCreateRoleV1,
) -> CloudflareTenantRootControlPlaneRoleV1 {
    match role {
        CloudflareTenantRootCreateRoleV1::DeriverA => {
            CloudflareTenantRootControlPlaneRoleV1::DeriverA
        }
        CloudflareTenantRootCreateRoleV1::DeriverB => {
            CloudflareTenantRootControlPlaneRoleV1::DeriverB
        }
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn cleanup_cloudflare_router_retired_tenant_root_role_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    identity_digest_b64u: &str,
    custody_lineage_b64u: &str,
    activation: &CloudflareDeriverTenantRootRefreshActivationResponseV1,
) -> RouterAbProtocolResult<()> {
    let expected_role = tenant_root_control_plane_role_v1(activation.role);
    let issued = execute_cloudflare_tenant_root_control_plane_cleanup_command_service_call_v1(
        env,
        &CloudflareTenantRootControlPlaneCleanupCommandRequestV1::RetiredAfterRefresh {
            identity_digest_b64u: identity_digest_b64u.to_owned(),
            custody_lineage_b64u: custody_lineage_b64u.to_owned(),
            role: expected_role,
            expected_retired_revision: activation.retired_revision,
            expected_active_revision: activation.active_revision,
        },
    )
    .await?;
    if issued.role != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root retired cleanup command names a different Deriver",
        ));
    }
    let command_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root retired cleanup command",
        &issued.cleanup_command_b64u,
    )?;
    let command =
        router_ab_core::TenantRootRoleCleanupCommandV1::decode_canonical_bytes(&command_bytes)
            .map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    format!("tenant-root retired cleanup command was malformed: {error}"),
                )
            })?;
    let claimed_target = command.claimed_target();
    let router_ab_core::TenantRootRoleCleanupTargetV1::Retired {
        role,
        retired_epoch,
        expected_retired_revision,
        expected_active_epoch,
        expected_active_revision,
        ..
    } = &claimed_target
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root post-refresh cleanup command is not a retired-share command",
        ));
    };
    if *role != activation.role.to_protocol()
        || retired_epoch.get().get() != activation.retired_epoch
        || *expected_retired_revision != activation.retired_revision
        || expected_active_epoch.get().get() != activation.active_epoch
        || *expected_active_revision != activation.active_revision
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root retired cleanup command does not match the completed role swap",
        ));
    }
    let (authority_id, _) = derive_tenant_root_creation_authority_object_v1(
        env,
        claimed_target.identity_digest(),
        claimed_target.custody_lineage(),
    )?;
    let reader = crate::CloudflareWorkerEnvReaderV1::new(env);
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(&reader)?;
    let issuer_key_id = command.issuer_key_id().to_owned();
    let issuer_key = issuer_keys
        .for_issuer_key_id(&issuer_key_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root retired cleanup issuer is not trusted by the Router",
            )
        })?;
    command
        .verify(
            &claimed_target,
            activation.role.to_protocol(),
            authority_id,
            &issuer_key_id,
            issuer_key,
        )
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                format!("tenant-root retired cleanup command verification failed: {error}"),
            )
        })?;
    let deriver = match activation.role {
        CloudflareTenantRootCreateRoleV1::DeriverA => &runtime.bindings().deriver_a,
        CloudflareTenantRootCreateRoleV1::DeriverB => &runtime.bindings().deriver_b,
    };
    let cleaned = execute_cloudflare_deriver_tenant_root_cleanup_service_call_v1(
        env,
        deriver,
        &CloudflareDeriverTenantRootCleanupRequestV1 {
            cleanup_command_b64u: issued.cleanup_command_b64u,
        },
    )
    .await?;
    match cleaned {
        CloudflareDeriverTenantRootCleanupResponseV1::RetiredDeleted {
            role, r2_deletion, ..
        } if role == activation.role => {
            let expected_coordinates = TenantRootManagedBackupObjectCoordinatesV1::new(
                claimed_target.identity_digest(),
                claimed_target.custody_lineage(),
                match activation.role {
                    CloudflareTenantRootCreateRoleV1::DeriverA => {
                        TenantRootManagedRestoreRoleV1::DeriverA
                    }
                    CloudflareTenantRootCreateRoleV1::DeriverB => {
                        TenantRootManagedRestoreRoleV1::DeriverB
                    }
                },
                router_ab_core::TenantRootShareEpoch::new(activation.retired_epoch).map_err(
                    |error| {
                        managed_restore_derivation_error_v1(
                            "tenant-root retired cleanup epoch",
                            error,
                        )
                    },
                )?,
            );
            if r2_deletion.managed_backup_object_key() != expected_coordinates.object_key()
                || r2_deletion.provider_canary_object_key()
                    != expected_coordinates.provider_canary_object_key()
            {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                    "tenant-root retired cleanup returned unrelated managed-backup objects",
                ));
            }
            Ok(())
        }
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root Deriver did not confirm retired-share deletion",
        )),
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn execute_cloudflare_deriver_tenant_root_refresh_service_call_with_retry_v1<'a>(
    env: &'a Env,
    peer: &'a CloudflarePeerBindingV1,
    request: &'a CloudflareDeriverTenantRootRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    match execute_cloudflare_deriver_tenant_root_refresh_service_call_v1(env, peer, request).await {
        Ok(response) => Ok(response),
        Err(_) => {
            execute_cloudflare_deriver_tenant_root_refresh_service_call_v1(env, peer, request).await
        }
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_derivation_error_v1(
    field: &'static str,
    error: router_ab_core::RouterAbDerivationError,
) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!("{field} was refused: {error}"),
    )
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn require_restore_refresh_digest_v1(
    field: &'static str,
    encoded: &str,
    expected: &[u8],
) -> RouterAbProtocolResult<()> {
    let bytes = decode_exact_tenant_root_wire_v1(field, encoded)?;
    if bytes.as_slice() != expected {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            format!("{field} does not match the authenticated restore-refresh scope"),
        ));
    }
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn require_restore_refresh_command_scope_v1(
    deriver_a: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
    deriver_b: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
) -> RouterAbProtocolResult<()> {
    if deriver_a.role() != TwoPartyDeriverRole::DeriverA
        || deriver_b.role() != TwoPartyDeriverRole::DeriverB
        || deriver_a.context() != deriver_b.context()
        || deriver_a.destination_fingerprint() != deriver_b.destination_fingerprint()
        || deriver_a.restore_session_id() != deriver_b.restore_session_id()
        || deriver_a.manifest_digest() != deriver_b.manifest_digest()
        || deriver_a.acceptance_receipt(TwoPartyDeriverRole::DeriverA)
            != deriver_b.acceptance_receipt(TwoPartyDeriverRole::DeriverA)
        || deriver_a.acceptance_receipt(TwoPartyDeriverRole::DeriverB)
            != deriver_b.acceptance_receipt(TwoPartyDeriverRole::DeriverB)
        || deriver_a.imported_commitment(TwoPartyDeriverRole::DeriverA)
            != deriver_b.imported_commitment(TwoPartyDeriverRole::DeriverA)
        || deriver_a.imported_commitment(TwoPartyDeriverRole::DeriverB)
            != deriver_b.imported_commitment(TwoPartyDeriverRole::DeriverB)
        || deriver_a.stable_root_commitment() != deriver_b.stable_root_commitment()
        || deriver_a.issuer_key_id() != deriver_b.issuer_key_id()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh commands do not share one authenticated scope",
        ));
    }
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn verify_cloudflare_router_tenant_root_restore_refresh_commands_v1(
    runtime: &CloudflareRouterWorkerRuntimeV1,
    response: CloudflareTenantRootControlPlaneRestoreRefreshCommandsResponseV1,
    validation: RestoreRefreshCommandValidationV1,
) -> RouterAbProtocolResult<VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1> {
    let context_bytes = decode_exact_tenant_root_wire_v1(
        "tenant-root restore-refresh context",
        &response.refresh_context_b64u,
    )?;
    let context =
        TenantRootCeremonyContextV1::decode_canonical_bytes(&context_bytes).map_err(|error| {
            restore_refresh_derivation_error_v1("tenant-root restore-refresh context", error)
        })?;
    let deriver_a_command_bytes = decode_exact_tenant_root_wire_v1(
        "tenant-root Deriver A restore-refresh command",
        &response.deriver_a_refresh_command_b64u,
    )?;
    let deriver_b_command_bytes = decode_exact_tenant_root_wire_v1(
        "tenant-root Deriver B restore-refresh command",
        &response.deriver_b_refresh_command_b64u,
    )?;
    let deriver_a_command =
        TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&deriver_a_command_bytes)
            .map_err(|error| {
                restore_refresh_derivation_error_v1(
                    "tenant-root Deriver A restore-refresh command",
                    error,
                )
            })?;
    let deriver_b_command =
        TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&deriver_b_command_bytes)
            .map_err(|error| {
                restore_refresh_derivation_error_v1(
                    "tenant-root Deriver B restore-refresh command",
                    error,
                )
            })?;
    if deriver_a_command.context() != &context || deriver_b_command.context() != &context {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh command context does not match the issuer response",
        ));
    }
    if deriver_a_command.issuer_key_id() != response.issuer_key_id
        || deriver_b_command.issuer_key_id() != response.issuer_key_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh issuer response key does not match its commands",
        ));
    }
    let issuer_key = runtime
        .bindings()
        .issuer_verifying_keys
        .for_issuer_key_id(&response.issuer_key_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root restore-refresh issuer key is not trusted by the Router",
            )
        })?;
    let deriver_a_command = deriver_a_command
        .verify(&response.issuer_key_id, issuer_key)
        .map_err(|error| {
            restore_refresh_derivation_error_v1(
                "tenant-root Deriver A restore-refresh command",
                error,
            )
        })?;
    let deriver_b_command = deriver_b_command
        .verify(&response.issuer_key_id, issuer_key)
        .map_err(|error| {
            restore_refresh_derivation_error_v1(
                "tenant-root Deriver B restore-refresh command",
                error,
            )
        })?;
    require_restore_refresh_command_scope_v1(&deriver_a_command, &deriver_b_command)?;
    if let RestoreRefreshCommandValidationV1::Fresh { now_ms } = validation {
        deriver_a_command.require_fresh(now_ms).map_err(|error| {
            restore_refresh_derivation_error_v1(
                "tenant-root Deriver A restore-refresh command freshness",
                error,
            )
        })?;
        deriver_b_command.require_fresh(now_ms).map_err(|error| {
            restore_refresh_derivation_error_v1(
                "tenant-root Deriver B restore-refresh command freshness",
                error,
            )
        })?;
    }
    let context_digest = context.digest().map_err(|error| {
        restore_refresh_derivation_error_v1("tenant-root restore-refresh context digest", error)
    })?;
    let deriver_a_command_digest = deriver_a_command.digest();
    let deriver_b_command_digest = deriver_b_command.digest();
    if deriver_a_command_digest == deriver_b_command_digest {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh commands have the same digest",
        ));
    }
    Ok(VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1 {
        context,
        context_b64u: response.refresh_context_b64u,
        context_digest_b64u: crate::encode_base64url_bytes_v1(context_digest.as_bytes()),
        deriver_a_command_b64u: response.deriver_a_refresh_command_b64u,
        deriver_b_command_b64u: response.deriver_b_refresh_command_b64u,
        deriver_a_command_digest_b64u: crate::encode_base64url_bytes_v1(
            deriver_a_command_digest.as_bytes(),
        ),
        deriver_b_command_digest_b64u: crate::encode_base64url_bytes_v1(
            deriver_b_command_digest.as_bytes(),
        ),
        deriver_a_command,
        deriver_b_command,
        issuer_key_id: response.issuer_key_id,
    })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_checkpoint_commands_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
) -> CloudflareTenantRootRestoreRefreshCommandsV1 {
    CloudflareTenantRootRestoreRefreshCommandsV1 {
        refresh_context_b64u: commands.context_b64u.clone(),
        deriver_a_refresh_command_b64u: commands.deriver_a_command_b64u.clone(),
        deriver_b_refresh_command_b64u: commands.deriver_b_command_b64u.clone(),
        issuer_key_id: commands.issuer_key_id.clone(),
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_commands_from_checkpoint_v1(
    runtime: &CloudflareRouterWorkerRuntimeV1,
    commands: CloudflareTenantRootRestoreRefreshCommandsV1,
) -> RouterAbProtocolResult<VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1> {
    verify_cloudflare_router_tenant_root_restore_refresh_commands_v1(
        runtime,
        CloudflareTenantRootControlPlaneRestoreRefreshCommandsResponseV1 {
            refresh_context_b64u: commands.refresh_context_b64u,
            deriver_a_refresh_command_b64u: commands.deriver_a_refresh_command_b64u,
            deriver_b_refresh_command_b64u: commands.deriver_b_refresh_command_b64u,
            issuer_key_id: commands.issuer_key_id,
        },
        RestoreRefreshCommandValidationV1::Persisted,
    )
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_command_for_role_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    role: TwoPartyDeriverRole,
) -> (&str, &str) {
    match role {
        TwoPartyDeriverRole::DeriverA => (
            &commands.deriver_a_command_b64u,
            &commands.deriver_a_command_digest_b64u,
        ),
        TwoPartyDeriverRole::DeriverB => (
            &commands.deriver_b_command_b64u,
            &commands.deriver_b_command_digest_b64u,
        ),
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_command_object_for_role_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    role: TwoPartyDeriverRole,
) -> &VerifiedTenantRootRestoreRefreshRoleCommandV1 {
    match role {
        TwoPartyDeriverRole::DeriverA => &commands.deriver_a_command,
        TwoPartyDeriverRole::DeriverB => &commands.deriver_b_command,
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_peer_v1(
    runtime: &CloudflareRouterWorkerRuntimeV1,
    role: TwoPartyDeriverRole,
) -> &CloudflarePeerBindingV1 {
    match role {
        TwoPartyDeriverRole::DeriverA => &runtime.bindings().deriver_a,
        TwoPartyDeriverRole::DeriverB => &runtime.bindings().deriver_b,
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_v1(
    env: &Env,
    peer: &CloudflarePeerBindingV1,
    request: &CloudflareDeriverTenantRootRestoreRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRefreshResponseV1> {
    let expected_role = tenant_root_deriver_role_for_peer_v1(peer)?;
    let url = tenant_root_deriver_managed_restore_service_url_v1(
        peer,
        crate::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH,
    )?;
    let response: CloudflareDeriverTenantRootRestoreRefreshResponseV1 = crate::post_service_json(
        env,
        &peer.binding_name,
        &url,
        "tenant-root restore-refresh phase request",
        request,
    )
    .await?;
    if response.role() != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root restore-refresh response names the wrong role",
        ));
    }
    Ok(response)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_with_retry_v1<'a>(
    env: &'a Env,
    peer: &'a CloudflarePeerBindingV1,
    request: &'a CloudflareDeriverTenantRootRestoreRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRefreshResponseV1> {
    match execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_v1(env, peer, request)
        .await
    {
        Ok(response) => Ok(response),
        Err(_) => {
            execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_v1(
                env, peer, request,
            )
            .await
        }
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn require_restore_refresh_phase_header_v1(
    phase: &'static str,
    role: CloudflareTenantRootCreateRoleV1,
    command_digest_b64u: &str,
    expected_role: CloudflareTenantRootCreateRoleV1,
    expected_command_digest_b64u: &str,
) -> RouterAbProtocolResult<()> {
    if role != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            format!("tenant-root restore-refresh {phase} response names the wrong role"),
        ));
    }
    require_restore_refresh_digest_v1(
        "tenant-root restore-refresh command digest",
        command_digest_b64u,
        &decode_exact_tenant_root_wire_v1(
            "tenant-root expected restore-refresh command digest",
            expected_command_digest_b64u,
        )?,
    )
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn verify_cloudflare_router_tenant_root_restore_refresh_prepare_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    role: TwoPartyDeriverRole,
    role_keys: &crate::env::TenantRootCreationRoleVerifyingKeysV1,
    response: CloudflareDeriverTenantRootRestoreRefreshResponseV1,
) -> RouterAbProtocolResult<VerifiedCloudflareRouterTenantRootRestoreRefreshCommitmentV1> {
    let (_, expected_digest) = restore_refresh_command_for_role_v1(commands, role);
    let (response_role, response_digest, wire_b64u) = match response {
        CloudflareDeriverTenantRootRestoreRefreshResponseV1::Prepared {
            role,
            command_digest_b64u,
            signed_commitment_b64u,
        } => (role, command_digest_b64u, signed_commitment_b64u),
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-refresh Deriver did not return a prepare response",
            ));
        }
    };
    require_restore_refresh_phase_header_v1(
        "prepare",
        response_role,
        &response_digest,
        CloudflareTenantRootCreateRoleV1::from_protocol(role),
        expected_digest,
    )?;
    let commitment_bytes = decode_exact_tenant_root_wire_v1(
        "tenant-root restore-refresh signed commitment",
        &wire_b64u,
    )?;
    let commitment =
        TenantRootSignedRefreshCommitmentV1::decode_and_verify_restore_canonical_bytes(
            &commitment_bytes,
            &commands.context,
            role,
            commands.context.signing_key_id(role),
            role_keys.for_role_and_key_id(role, commands.context.signing_key_id(role))?,
        )
        .map_err(|error| {
            restore_refresh_derivation_error_v1(
                "tenant-root restore-refresh signed commitment",
                error,
            )
        })?;
    Ok(
        VerifiedCloudflareRouterTenantRootRestoreRefreshCommitmentV1 {
            wire_b64u,
            commitment,
        },
    )
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_contribution_aad_v1(
    pair: &VerifiedTenantRootRefreshCommitmentPairV1,
    role: TwoPartyDeriverRole,
) -> RouterAbProtocolResult<TenantRootRefreshContributionAadV1> {
    match role {
        TwoPartyDeriverRole::DeriverA => TenantRootRefreshContributionAadV1::deriver_a_to_b(pair),
        TwoPartyDeriverRole::DeriverB => TenantRootRefreshContributionAadV1::deriver_b_to_a(pair),
    }
    .map_err(|error| {
        restore_refresh_derivation_error_v1("tenant-root restore-refresh contribution AAD", error)
    })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn verify_cloudflare_router_tenant_root_restore_refresh_contribute_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    pair: &VerifiedTenantRootRefreshCommitmentPairV1,
    role: TwoPartyDeriverRole,
    role_keys: &crate::env::TenantRootCreationRoleVerifyingKeysV1,
    response: CloudflareDeriverTenantRootRestoreRefreshResponseV1,
) -> RouterAbProtocolResult<String> {
    let (_, expected_digest) = restore_refresh_command_for_role_v1(commands, role);
    let (response_role, response_digest, wire_b64u) = match response {
        CloudflareDeriverTenantRootRestoreRefreshResponseV1::Contributed {
            role,
            command_digest_b64u,
            signed_contribution_b64u,
        } => (role, command_digest_b64u, signed_contribution_b64u),
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-refresh Deriver did not return a contribution response",
            ));
        }
    };
    require_restore_refresh_phase_header_v1(
        "contribute",
        response_role,
        &response_digest,
        CloudflareTenantRootCreateRoleV1::from_protocol(role),
        expected_digest,
    )?;
    let contribution_bytes = decode_exact_tenant_root_wire_v1(
        "tenant-root restore-refresh signed contribution",
        &wire_b64u,
    )?;
    let signed = TenantRootSignedRefreshContributionV1::decode_canonical_bytes(&contribution_bytes)
        .map_err(|error| {
            restore_refresh_derivation_error_v1(
                "tenant-root restore-refresh signed contribution",
                error,
            )
        })?;
    let aad = restore_refresh_contribution_aad_v1(pair, role)?;
    let verified: VerifiedTenantRootSignedRefreshContributionV1 = signed
        .verify_signature(
            &aad,
            role_keys.for_role_and_key_id(role, commands.context.signing_key_id(role))?,
        )
        .map_err(|error| {
            restore_refresh_derivation_error_v1(
                "tenant-root restore-refresh signed contribution",
                error,
            )
        })?;
    if verified.source() != role || verified.recipient() != role.peer() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh contribution role binding is invalid",
        ));
    }
    Ok(wire_b64u)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn require_restore_refresh_commitment_changed_v1(
    field: &'static str,
    commitment: threshold_prf::SigningRootShareCommitment,
    previous: &router_ab_core::MpcPrfShareCommitmentWireV1,
) -> RouterAbProtocolResult<()> {
    let Some(previous_point) = previous.as_bytes().get(2..) else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{field} previous commitment is truncated"),
        ));
    };
    if commitment.to_compressed().as_slice() == previous_point {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            format!("{field} did not change from the admitted restore import"),
        ));
    }
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn verify_cloudflare_router_tenant_root_restore_refresh_evidence_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    role: TwoPartyDeriverRole,
    role_keys: &crate::env::TenantRootCreationRoleVerifyingKeysV1,
    response: CloudflareDeriverTenantRootRestoreRefreshResponseV1,
) -> RouterAbProtocolResult<VerifiedCloudflareRouterTenantRootRestoreRefreshEvidenceV1> {
    let (_, expected_digest) = restore_refresh_command_for_role_v1(commands, role);
    let (response_role, response_digest, wire_b64u) = match response {
        CloudflareDeriverTenantRootRestoreRefreshResponseV1::Refreshed {
            role,
            command_digest_b64u,
            signed_installation_evidence_b64u,
        } => (role, command_digest_b64u, signed_installation_evidence_b64u),
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-refresh Deriver did not return installation evidence",
            ));
        }
    };
    require_restore_refresh_phase_header_v1(
        "finalize",
        response_role,
        &response_digest,
        CloudflareTenantRootCreateRoleV1::from_protocol(role),
        expected_digest,
    )?;
    let evidence_bytes = decode_exact_tenant_root_wire_v1(
        "tenant-root restore-refresh signed installation evidence",
        &wire_b64u,
    )?;
    let signed =
        TenantRootSignedShareInstallationEvidenceV1::decode_canonical_bytes(&evidence_bytes)
            .map_err(|error| {
                restore_refresh_derivation_error_v1(
                    "tenant-root restore-refresh signed installation evidence",
                    error,
                )
            })?;
    if signed.role() != role || signed.signing_key_id() != commands.context.signing_key_id(role) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh evidence role authentication does not match its command",
        ));
    }
    let evidence = TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        &evidence_bytes,
        role_keys.for_role_and_key_id(role, commands.context.signing_key_id(role))?,
    )
    .map_err(|error| {
        restore_refresh_derivation_error_v1(
            "tenant-root restore-refresh signed installation evidence",
            error,
        )
    })?;
    let transcript = evidence.evidence().transcript();
    if transcript.context() != &commands.context || transcript.role() != role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh evidence does not match its command context",
        ));
    }
    let command = restore_refresh_command_object_for_role_v1(commands, role);
    require_restore_refresh_commitment_changed_v1(
        "tenant-root restore-refresh local commitment",
        transcript.commitment(),
        command.imported_commitment(role),
    )?;
    require_restore_refresh_commitment_changed_v1(
        "tenant-root restore-refresh peer commitment",
        transcript.peer_commitment(),
        command.imported_commitment(role.peer()),
    )?;
    Ok(VerifiedCloudflareRouterTenantRootRestoreRefreshEvidenceV1 {
        wire_b64u,
        evidence,
    })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn verify_persisted_restore_refresh_prepare_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    role: TwoPartyDeriverRole,
    role_keys: &crate::env::TenantRootCreationRoleVerifyingKeysV1,
    wire_b64u: &str,
) -> RouterAbProtocolResult<VerifiedCloudflareRouterTenantRootRestoreRefreshCommitmentV1> {
    let (_, command_digest_b64u) = restore_refresh_command_for_role_v1(commands, role);
    verify_cloudflare_router_tenant_root_restore_refresh_prepare_v1(
        commands,
        role,
        role_keys,
        CloudflareDeriverTenantRootRestoreRefreshResponseV1::Prepared {
            role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
            command_digest_b64u: command_digest_b64u.to_owned(),
            signed_commitment_b64u: wire_b64u.to_owned(),
        },
    )
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn verify_persisted_restore_refresh_contribute_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    pair: &VerifiedTenantRootRefreshCommitmentPairV1,
    role: TwoPartyDeriverRole,
    role_keys: &crate::env::TenantRootCreationRoleVerifyingKeysV1,
    wire_b64u: &str,
) -> RouterAbProtocolResult<String> {
    let (_, command_digest_b64u) = restore_refresh_command_for_role_v1(commands, role);
    verify_cloudflare_router_tenant_root_restore_refresh_contribute_v1(
        commands,
        pair,
        role,
        role_keys,
        CloudflareDeriverTenantRootRestoreRefreshResponseV1::Contributed {
            role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
            command_digest_b64u: command_digest_b64u.to_owned(),
            signed_contribution_b64u: wire_b64u.to_owned(),
        },
    )
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn verify_persisted_restore_refresh_evidence_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    role: TwoPartyDeriverRole,
    role_keys: &crate::env::TenantRootCreationRoleVerifyingKeysV1,
    wire_b64u: &str,
) -> RouterAbProtocolResult<VerifiedCloudflareRouterTenantRootRestoreRefreshEvidenceV1> {
    let (_, command_digest_b64u) = restore_refresh_command_for_role_v1(commands, role);
    verify_cloudflare_router_tenant_root_restore_refresh_evidence_v1(
        commands,
        role,
        role_keys,
        CloudflareDeriverTenantRootRestoreRefreshResponseV1::Refreshed {
            role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
            command_digest_b64u: command_digest_b64u.to_owned(),
            signed_installation_evidence_b64u: wire_b64u.to_owned(),
        },
    )
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn decode_restore_refresh_authority_id_v1(
    encoded: &str,
) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
    let bytes = crate::decode_base64url_bytes_v1(
        "tenant-root restore-refresh control-plane authority id",
        encoded,
    )?;
    if crate::encode_base64url_bytes_v1(&bytes) != encoded {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore-refresh control-plane authority id must use canonical base64url",
        ));
    }
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore-refresh control-plane authority id must contain exactly 32 bytes",
        )
    })?;
    if bytes.iter().all(|byte| *byte == 0) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore-refresh control-plane authority id must be non-zero",
        ));
    }
    Ok(TenantRootControlPlaneAuthorityIdV1::from_bytes(bytes))
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn require_restore_refresh_artifact_digest_v1(
    field: &'static str,
    encoded: &str,
    expected_digest_b64u: &str,
) -> RouterAbProtocolResult<()> {
    let bytes = decode_exact_tenant_root_wire_v1(field, encoded)?;
    let digest = crate::encode_base64url_bytes_v1(&Sha256::digest(&bytes));
    if digest != expected_digest_b64u {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            format!("{field} digest does not match its artifact"),
        ));
    }
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn verify_cloudflare_router_tenant_root_restore_refresh_promotion_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    role: TwoPartyDeriverRole,
    expected_evidence_b64u: &str,
    response: CloudflareDeriverTenantRootRestoreRefreshResponseV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRestoreRefreshRolePromotionV1> {
    let (_, expected_command_digest_b64u) = restore_refresh_command_for_role_v1(commands, role);
    let (
        response_role,
        response_command_b64u,
        response_command_digest_b64u,
        response_evidence_b64u,
        response_evidence_digest_b64u,
        response_canary_b64u,
        response_canary_digest_b64u,
        completed_at_ms,
    ) = match response {
        CloudflareDeriverTenantRootRestoreRefreshResponseV1::Promoted {
            role,
            restore_refresh_role_command_b64u,
            command_digest_b64u,
            signed_installation_evidence_b64u,
            installation_evidence_digest_b64u,
            provider_canary_receipt_b64u,
            provider_canary_receipt_digest_b64u,
            completed_at_ms,
        } => (
            role,
            restore_refresh_role_command_b64u,
            command_digest_b64u,
            signed_installation_evidence_b64u,
            installation_evidence_digest_b64u,
            provider_canary_receipt_b64u,
            provider_canary_receipt_digest_b64u,
            completed_at_ms,
        ),
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-refresh Deriver did not return a promotion response",
            ));
        }
    };
    require_restore_refresh_phase_header_v1(
        "promote",
        response_role,
        &response_command_digest_b64u,
        CloudflareTenantRootCreateRoleV1::from_protocol(role),
        expected_command_digest_b64u,
    )?;
    let (expected_command_b64u, _) = restore_refresh_command_for_role_v1(commands, role);
    if response_command_b64u != expected_command_b64u {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh promotion command changed from the persisted command",
        ));
    }
    let command_bytes = decode_exact_tenant_root_wire_v1(
        "tenant-root restore-refresh promoted role command",
        &response_command_b64u,
    )?;
    if crate::encode_base64url_bytes_v1(&Sha256::digest(&command_bytes))
        != response_command_digest_b64u
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh promotion command digest changed",
        ));
    }
    if response_evidence_b64u != expected_evidence_b64u {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh promotion evidence changed from the completed artifact",
        ));
    }
    require_restore_refresh_artifact_digest_v1(
        "tenant-root restore-refresh promoted installation evidence",
        &response_evidence_b64u,
        &response_evidence_digest_b64u,
    )?;
    require_restore_refresh_artifact_digest_v1(
        "tenant-root restore-refresh promoted provider canary",
        &response_canary_b64u,
        &response_canary_digest_b64u,
    )?;
    if completed_at_ms == 0 {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore-refresh promotion completion time must be positive",
        ));
    }
    Ok(CloudflareTenantRootRestoreRefreshRolePromotionV1 {
        role: restore_refresh_installation_role_v1(role),
        restore_refresh_role_command_b64u: response_command_b64u,
        command_digest_b64u: response_command_digest_b64u,
        signed_installation_evidence_b64u: response_evidence_b64u,
        installation_evidence_digest_b64u: response_evidence_digest_b64u,
        provider_canary_receipt_b64u: response_canary_b64u,
        provider_canary_receipt_digest_b64u: response_canary_digest_b64u,
        completed_at_ms,
    })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
const fn restore_refresh_installation_role_v1(
    role: TwoPartyDeriverRole,
) -> CloudflareTenantRootCreationInstallationRoleV1 {
    match role {
        TwoPartyDeriverRole::DeriverA => CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
        TwoPartyDeriverRole::DeriverB => CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_checkpoint_from_response_v1(
    response: CloudflareTenantRootRestoreRefreshCheckpointResponseV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRestoreRefreshCheckpointV1> {
    match response {
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::Checkpoint { checkpoint } => {
            Ok(checkpoint)
        }
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforeCommands {
            ..
        } => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root restore-refresh checkpoint expired before commands after command persistence",
        )),
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::CompletedRead { .. } => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-refresh phase returned a completed-read response",
            ))
        }
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::PromotedRead { .. } => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-refresh phase returned a promoted-read response",
            ))
        }
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforePromotion {
            ..
        } => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root restore-refresh phase expired before promotion",
        )),
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn execute_restore_refresh_checkpoint_v1(
    env: &Env,
    request: &CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRestoreRefreshCheckpointV1> {
    let response =
        execute_cloudflare_router_tenant_root_restore_refresh_checkpoint_call_v1(env, request)
            .await?;
    restore_refresh_checkpoint_from_response_v1(response)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_expected_authority_v1(
    env: &Env,
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
    let (authority_id, _) = derive_tenant_root_creation_authority_object_v1(
        env,
        commands.context.identity_digest(),
        commands.context.custody_lineage(),
    )?;
    Ok(authority_id)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_read_revisions_match_v1(
    checkpoint: &CloudflareTenantRootRestoreRefreshCheckpointV1,
    expected_initial_activation_revision: u64,
    result_initial_activation_revision: u64,
) -> RouterAbProtocolResult<()> {
    if expected_initial_activation_revision != checkpoint.expected_initial_activation_revision
        || result_initial_activation_revision != checkpoint.result_initial_activation_revision
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh checkpoint read revisions changed",
        ));
    }
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_completed_read_authority_v1(
    checkpoint: &CloudflareTenantRootRestoreRefreshCheckpointV1,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
    response: CloudflareTenantRootRestoreRefreshCheckpointResponseV1,
) -> RouterAbProtocolResult<String> {
    let (
        authority_id_b64u,
        expected_initial_activation_revision,
        result_initial_activation_revision,
    ) = match response {
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::CompletedRead {
            authority_id_b64u,
            expected_initial_activation_revision,
            result_initial_activation_revision,
        } => (
            authority_id_b64u,
            expected_initial_activation_revision,
            result_initial_activation_revision,
        ),
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforePromotion {
            ..
        } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ExpiredLocalRequest,
                "tenant-root restore-refresh authorization expired before durable promotion",
            ));
        }
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-refresh checkpoint did not return a completed read",
            ));
        }
    };
    restore_refresh_read_revisions_match_v1(
        checkpoint,
        expected_initial_activation_revision,
        result_initial_activation_revision,
    )?;
    let authority_id = decode_restore_refresh_authority_id_v1(&authority_id_b64u)?;
    if authority_id != expected_authority_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh completed read returned a foreign authority",
        ));
    }
    Ok(authority_id_b64u)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_promoted_read_v1(
    checkpoint: &CloudflareTenantRootRestoreRefreshCheckpointV1,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
    response: CloudflareTenantRootRestoreRefreshCheckpointResponseV1,
) -> RouterAbProtocolResult<(
    String,
    CloudflareTenantRootRestoreRefreshRolePromotionV1,
    CloudflareTenantRootRestoreRefreshRolePromotionV1,
)> {
    let CloudflareTenantRootRestoreRefreshCheckpointResponseV1::PromotedRead {
        authority_id_b64u,
        expected_initial_activation_revision,
        result_initial_activation_revision,
        deriver_a_promotion,
        deriver_b_promotion,
    } = response
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root restore-refresh checkpoint did not return a promoted read",
        ));
    };
    restore_refresh_read_revisions_match_v1(
        checkpoint,
        expected_initial_activation_revision,
        result_initial_activation_revision,
    )?;
    let authority_id = decode_restore_refresh_authority_id_v1(&authority_id_b64u)?;
    if authority_id != expected_authority_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh promoted read returned a foreign authority",
        ));
    }
    Ok((authority_id_b64u, deriver_a_promotion, deriver_b_promotion))
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn require_restore_refresh_promotions_match_checkpoint_v1(
    checkpoint: &CloudflareTenantRootRestoreRefreshCheckpointV1,
    deriver_a_promotion: &CloudflareTenantRootRestoreRefreshRolePromotionV1,
    deriver_b_promotion: &CloudflareTenantRootRestoreRefreshRolePromotionV1,
) -> RouterAbProtocolResult<()> {
    let CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
        deriver_a_promotion: persisted_deriver_a_promotion,
        deriver_b_promotion: persisted_deriver_b_promotion,
        ..
    } = &checkpoint.state
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root restore-refresh promoted read did not follow promotion persistence",
        ));
    };
    if persisted_deriver_a_promotion != deriver_a_promotion
        || persisted_deriver_b_promotion != deriver_b_promotion
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh promoted read changed persisted promotion artifacts",
        ));
    }
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn promote_cloudflare_router_tenant_root_restore_refresh_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: &CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1,
    checkpoint: &CloudflareTenantRootRestoreRefreshCheckpointV1,
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    deriver_a_evidence_b64u: &str,
    deriver_b_evidence_b64u: &str,
) -> RouterAbProtocolResult<()> {
    let expected_authority_id = restore_refresh_expected_authority_v1(env, commands)?;
    let completed_read = execute_cloudflare_router_tenant_root_restore_refresh_checkpoint_call_v1(
        env,
        &CloudflareTenantRootRestoreRefreshCheckpointRequestV1::ReadCompleted {
            restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
            manifest_b64u: request.manifest_b64u.clone(),
        },
    )
    .await?;
    let authority_id_b64u = restore_refresh_completed_read_authority_v1(
        checkpoint,
        expected_authority_id,
        completed_read,
    )?;
    let manifest_bytes =
        crate::decode_base64url_bytes_v1("restore manifest", &request.manifest_b64u)?;
    let manifest = router_ab_core::decode_tenant_root_recovery_manifest_v1(&manifest_bytes)
        .map_err(|error| restore_refresh_derivation_error_v1("restore manifest", error))?;
    let identity = manifest.descriptor().tenant_root_identity();
    let deriver_a_request = CloudflareDeriverTenantRootRestoreRefreshRequestV1::Promote {
        identity: identity.clone(),
        role_refresh_command_b64u: commands.deriver_a_command_b64u.clone(),
        authority_id_b64u: authority_id_b64u.clone(),
    };
    let deriver_b_request = CloudflareDeriverTenantRootRestoreRefreshRequestV1::Promote {
        identity: identity.clone(),
        role_refresh_command_b64u: commands.deriver_b_command_b64u.clone(),
        authority_id_b64u,
    };
    let (deriver_a_response, deriver_b_response) = futures::join!(
        execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_with_retry_v1(
            env,
            restore_refresh_peer_v1(runtime, TwoPartyDeriverRole::DeriverA),
            &deriver_a_request,
        ),
        execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_with_retry_v1(
            env,
            restore_refresh_peer_v1(runtime, TwoPartyDeriverRole::DeriverB),
            &deriver_b_request,
        ),
    );
    let deriver_a_promotion = verify_cloudflare_router_tenant_root_restore_refresh_promotion_v1(
        commands,
        TwoPartyDeriverRole::DeriverA,
        deriver_a_evidence_b64u,
        deriver_a_response?,
    )?;
    let deriver_b_promotion = verify_cloudflare_router_tenant_root_restore_refresh_promotion_v1(
        commands,
        TwoPartyDeriverRole::DeriverB,
        deriver_b_evidence_b64u,
        deriver_b_response?,
    )?;
    let promoted_checkpoint = execute_restore_refresh_checkpoint_v1(
        env,
        &CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitPromoted {
            restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
            deriver_a_promotion,
            deriver_b_promotion,
        },
    )
    .await?;
    let promoted_read = execute_cloudflare_router_tenant_root_restore_refresh_checkpoint_call_v1(
        env,
        &CloudflareTenantRootRestoreRefreshCheckpointRequestV1::ReadPromoted {
            restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
            manifest_b64u: request.manifest_b64u.clone(),
        },
    )
    .await?;
    let (_, deriver_a_promotion, deriver_b_promotion) = restore_refresh_promoted_read_v1(
        &promoted_checkpoint,
        expected_authority_id,
        promoted_read,
    )?;
    require_restore_refresh_promotions_match_checkpoint_v1(
        &promoted_checkpoint,
        &deriver_a_promotion,
        &deriver_b_promotion,
    )?;
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_commitment_pair_from_wires_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    role_keys: &crate::env::TenantRootCreationRoleVerifyingKeysV1,
    deriver_a_commitment_b64u: &str,
    deriver_b_commitment_b64u: &str,
) -> RouterAbProtocolResult<VerifiedTenantRootRefreshCommitmentPairV1> {
    let deriver_a_commitment = verify_persisted_restore_refresh_prepare_v1(
        commands,
        TwoPartyDeriverRole::DeriverA,
        role_keys,
        deriver_a_commitment_b64u,
    )?;
    let deriver_b_commitment = verify_persisted_restore_refresh_prepare_v1(
        commands,
        TwoPartyDeriverRole::DeriverB,
        role_keys,
        deriver_b_commitment_b64u,
    )?;
    let commitment_pair = VerifiedTenantRootRefreshCommitmentPairV1::new(
        deriver_a_commitment.commitment,
        deriver_b_commitment.commitment,
    )
    .map_err(|error| {
        restore_refresh_derivation_error_v1("tenant-root restore-refresh commitment pair", error)
    })?;
    Ok(commitment_pair)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_evidence_digests_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    deriver_a_evidence: &VerifiedCloudflareRouterTenantRootRestoreRefreshEvidenceV1,
    deriver_b_evidence: &VerifiedCloudflareRouterTenantRootRestoreRefreshEvidenceV1,
) -> RouterAbProtocolResult<(String, String)> {
    let next = verify_tenant_root_creation_evidence_v1(
        deriver_a_evidence.evidence.evidence(),
        deriver_b_evidence.evidence.evidence(),
    )
    .map_err(|error| {
        restore_refresh_derivation_error_v1("tenant-root restore-refresh evidence pair", error)
    })?;
    if next.root().to_bytes() != *commands.deriver_a_command.stable_root_commitment() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-refresh evidence changed the stable root",
        ));
    }
    let deriver_a_evidence_digest = deriver_a_evidence
        .evidence
        .lifecycle_receipt_digest()
        .map_err(|error| {
            restore_refresh_derivation_error_v1(
                "tenant-root Deriver A restore-refresh evidence digest",
                error,
            )
        })?;
    let deriver_b_evidence_digest = deriver_b_evidence
        .evidence
        .lifecycle_receipt_digest()
        .map_err(|error| {
            restore_refresh_derivation_error_v1(
                "tenant-root Deriver B restore-refresh evidence digest",
                error,
            )
        })?;
    Ok((
        crate::encode_base64url_bytes_v1(deriver_a_evidence_digest.as_bytes()),
        crate::encode_base64url_bytes_v1(deriver_b_evidence_digest.as_bytes()),
    ))
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_refresh_final_response_v1(
    commands: VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    deriver_a_evidence: VerifiedCloudflareRouterTenantRootRestoreRefreshEvidenceV1,
    deriver_b_evidence: VerifiedCloudflareRouterTenantRootRestoreRefreshEvidenceV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRestoreRefreshResponseV1> {
    let (deriver_a_evidence_digest_b64u, deriver_b_evidence_digest_b64u) =
        restore_refresh_evidence_digests_v1(&commands, &deriver_a_evidence, &deriver_b_evidence)?;
    Ok(CloudflareRouterTenantRootRestoreRefreshResponseV1 {
        refresh_context_b64u: commands.context_b64u,
        refresh_context_digest_b64u: commands.context_digest_b64u,
        deriver_a_refresh_command_b64u: commands.deriver_a_command_b64u,
        deriver_b_refresh_command_b64u: commands.deriver_b_command_b64u,
        deriver_a_refresh_command_digest_b64u: commands.deriver_a_command_digest_b64u,
        deriver_b_refresh_command_digest_b64u: commands.deriver_b_command_digest_b64u,
        deriver_a_signed_installation_evidence_b64u: deriver_a_evidence.wire_b64u,
        deriver_b_signed_installation_evidence_b64u: deriver_b_evidence.wire_b64u,
        deriver_a_installation_evidence_digest_b64u: deriver_a_evidence_digest_b64u,
        deriver_b_installation_evidence_digest_b64u: deriver_b_evidence_digest_b64u,
        issuer_key_id: commands.issuer_key_id,
    })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn aggregate_restore_activation_digests_v1(
    domain: &[u8],
    deriver_a: TenantRootLifecycleReceiptDigestV1,
    deriver_b: TenantRootLifecycleReceiptDigestV1,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(deriver_a.as_bytes());
    hasher.update(deriver_b.as_bytes());
    crate::encode_base64url_bytes_v1(&hasher.finalize())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_role_cleanup_digest_v1(
    role: CloudflareTenantRootCreateRoleV1,
    response: &CloudflareDeriverTenantRootInitialActivationResponseV1,
) -> RouterAbProtocolResult<String> {
    if response.role != role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            format!(
                "tenant-root restore activation Deriver response names the wrong role: {role:?}"
            ),
        ));
    }
    let Some(receipt_b64u) = response.restore_cleanup_receipt_b64u.as_ref() else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            format!(
                "tenant-root restore activation Deriver {role:?} did not return a cleanup receipt"
            ),
        ));
    };
    let receipt_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root restore activation cleanup receipt",
        receipt_b64u,
    )?;
    if receipt_bytes.is_empty() || crate::encode_base64url_bytes_v1(&receipt_bytes) != *receipt_b64u
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore activation cleanup receipt is not canonical",
        ));
    }
    let receipt_digest: [u8; 32] = Sha256::digest(&receipt_bytes).into();
    Ok(crate::encode_base64url_bytes_v1(&receipt_digest))
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_role_cleanup_digest_from_result_v1(
    role: CloudflareTenantRootCreateRoleV1,
    result: &RouterAbProtocolResult<CloudflareDeriverTenantRootInitialActivationResponseV1>,
) -> Option<String> {
    result
        .as_ref()
        .ok()
        .and_then(|response| restore_role_cleanup_digest_v1(role, response).ok())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_cleanup_outstanding_v1(
    roles: Vec<CloudflareTenantRootCreateRoleV1>,
) -> CloudflareRouterTenantRootRestoreOutstandingCleanupV1 {
    CloudflareRouterTenantRootRestoreOutstandingCleanupV1 {
        roles,
        description: "tenant-root restore role cleanup remains outstanding".to_owned(),
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn restore_role_cleanup_from_results_v1(
    deriver_a: Option<String>,
    deriver_b: Option<String>,
) -> CloudflareRouterTenantRootRestoreRoleCleanupV1 {
    match (deriver_a, deriver_b) {
        (Some(deriver_a), Some(deriver_b)) => {
            CloudflareRouterTenantRootRestoreRoleCleanupV1::Complete {
                receipts: CloudflareRouterTenantRootRestoreRoleCleanupReceiptsV1 {
                    deriver_a,
                    deriver_b,
                },
            }
        }
        (Some(deriver_a_receipt_digest_b64u), None) => {
            CloudflareRouterTenantRootRestoreRoleCleanupV1::DeriverBIncomplete {
                deriver_a_receipt_digest_b64u,
                outstanding: restore_cleanup_outstanding_v1(vec![
                    CloudflareTenantRootCreateRoleV1::DeriverB,
                ]),
            }
        }
        (None, Some(deriver_b_receipt_digest_b64u)) => {
            CloudflareRouterTenantRootRestoreRoleCleanupV1::DeriverAIncomplete {
                deriver_b_receipt_digest_b64u,
                outstanding: restore_cleanup_outstanding_v1(vec![
                    CloudflareTenantRootCreateRoleV1::DeriverA,
                ]),
            }
        }
        (None, None) => CloudflareRouterTenantRootRestoreRoleCleanupV1::BothRolesIncomplete {
            outstanding: restore_cleanup_outstanding_v1(vec![
                CloudflareTenantRootCreateRoleV1::DeriverA,
                CloudflareTenantRootCreateRoleV1::DeriverB,
            ]),
        },
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn cleanup_restore_role_v1(
    env: &Env,
    peer: &CloudflarePeerBindingV1,
    request: &CloudflareRouterTenantRootRestoreCleanupRequestV1,
) -> RouterAbProtocolResult<String> {
    use crate::tenant_root_role_runtime::{
        CloudflareDeriverTenantRootPreactivationCleanupRequestV1,
        CloudflareDeriverTenantRootPreactivationCleanupResponseV1,
        CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1,
        CloudflareDeriverTenantRootRestoreSessionCleanupResponseV1,
    };
    let expected_role = tenant_root_deriver_role_for_peer_v1(peer)?;
    let (role, digest) = match request {
        CloudflareRouterTenantRootRestoreCleanupRequestV1::PreActivation { cleanup_grant_b64u } => {
            let url = tenant_root_deriver_managed_restore_service_url_v1(peer,
                crate::paths::CLOUDFLARE_DERIVER_TENANT_ROOT_PREACTIVATION_CLEANUP_PRIVATE_REQUEST_PATH)?;
            let response: CloudflareDeriverTenantRootPreactivationCleanupResponseV1 =
                crate::post_service_json(
                    env,
                    &peer.binding_name,
                    &url,
                    "restore preactivation cleanup",
                    &CloudflareDeriverTenantRootPreactivationCleanupRequestV1 {
                        cleanup_grant_b64u: cleanup_grant_b64u.clone(),
                    },
                )
                .await?;
            (response.role, response.cleanup_receipt_digest_b64u)
        }
        CloudflareRouterTenantRootRestoreCleanupRequestV1::PostActivation {
            activation_receipt_b64u,
            ..
        } => {
            let url = tenant_root_deriver_managed_restore_service_url_v1(
                peer,
                crate::paths::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_CLEANUP_PRIVATE_REQUEST_PATH,
            )?;
            let response: CloudflareDeriverTenantRootRestoreSessionCleanupResponseV1 =
                crate::post_service_json(
                    env,
                    &peer.binding_name,
                    &url,
                    "restore postactivation cleanup",
                    &CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1 {
                        activation_receipt_b64u: activation_receipt_b64u.clone(),
                    },
                )
                .await?;
            (response.role, response.cleanup_receipt_digest_b64u)
        }
    };
    if role != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "restore cleanup response names the wrong role",
        ));
    }
    let bytes = crate::decode_base64url_bytes_v1("restore cleanup digest", &digest)?;
    if bytes.len() != 32 || crate::encode_base64url_bytes_v1(&bytes) != digest {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "restore cleanup receipt digest is malformed",
        ));
    }
    Ok(digest)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn coordinate_restore_cleanup_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: CloudflareRouterTenantRootRestoreCleanupRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRestoreCleanupResponseV1> {
    let (mut a, mut b, bootstrap) = match &request {
        CloudflareRouterTenantRootRestoreCleanupRequestV1::PreActivation { cleanup_grant_b64u } => {
            let bytes =
                crate::decode_base64url_bytes_v1("restore cleanup grant", cleanup_grant_b64u)?;
            let grant =
                router_ab_core::TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&bytes)
                    .map_err(|error| {
                        restore_refresh_derivation_error_v1("restore cleanup grant", error)
                    })?;
            let reader = crate::CloudflareWorkerEnvReaderV1::new(env);
            let keys = crate::env::parse_cloudflare_tenant_root_creation_grant_authority_verifying_keys_v1(&reader)?;
            let key = keys.for_grant_key_id(grant.grant_key_id()).ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                    "restore cleanup grant issuer is not trusted",
                )
            })?;
            grant
                .verify(grant.grant_key_id(), key)
                .map_err(|error| {
                    restore_refresh_derivation_error_v1("restore cleanup grant", error)
                })?
                .require_fresh(crate::cloudflare_now_unix_ms_v1()?)
                .map_err(|error| {
                    restore_refresh_derivation_error_v1("restore cleanup grant", error)
                })?;
            (None, None, None)
        }
        CloudflareRouterTenantRootRestoreCleanupRequestV1::PostActivation {
            activation_receipt_b64u,
            cleanup,
        } => {
            let bytes = crate::decode_base64url_bytes_v1(
                "restore activation receipt",
                activation_receipt_b64u,
            )?;
            let persisted =
                execute_cloudflare_router_tenant_root_restore_initial_activation_call_v1(
                    env, &bytes,
                )
                .await?;
            let (a, b) = match &cleanup.roles {
                CloudflareRouterTenantRootRestoreRoleCleanupV1::BothRolesIncomplete { .. } => {
                    (None, None)
                }
                CloudflareRouterTenantRootRestoreRoleCleanupV1::DeriverAIncomplete {
                    deriver_b_receipt_digest_b64u,
                    ..
                } => (None, Some(deriver_b_receipt_digest_b64u.clone())),
                CloudflareRouterTenantRootRestoreRoleCleanupV1::DeriverBIncomplete {
                    deriver_a_receipt_digest_b64u,
                    ..
                } => (Some(deriver_a_receipt_digest_b64u.clone()), None),
                CloudflareRouterTenantRootRestoreRoleCleanupV1::Complete { receipts } => (
                    Some(receipts.deriver_a.clone()),
                    Some(receipts.deriver_b.clone()),
                ),
            };
            (
                a,
                b,
                Some(
                    CloudflareRouterTenantRootRestoreBootstrapCleanupV1::Destroyed {
                        receipt_digest_b64u: persisted.destruction_receipt_digest_b64u,
                    },
                ),
            )
        }
    };
    if a.is_none() {
        a = cleanup_restore_role_v1(env, &runtime.bindings().deriver_a, &request)
            .await
            .ok();
    }
    if b.is_none() {
        b = cleanup_restore_role_v1(env, &runtime.bindings().deriver_b, &request)
            .await
            .ok();
    }
    let roles = restore_role_cleanup_from_results_v1(a, b);
    Ok(match bootstrap {
        None => CloudflareRouterTenantRootRestoreCleanupResponseV1::PreActivation(roles),
        Some(bootstrap) => CloudflareRouterTenantRootRestoreCleanupResponseV1::PostActivation(
            CloudflareRouterTenantRootRestoreCleanupV1 { bootstrap, roles },
        ),
    })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn coordinate_cloudflare_router_tenant_root_restore_activation_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRestoreActivationResponseV1> {
    match coordinate_cloudflare_router_tenant_root_restore_refresh_v1(env, runtime, request.clone())
        .await?
    {
        CloudflareRouterTenantRootRestoreRefreshOutcomeV1::Completed(_) => {}
        CloudflareRouterTenantRootRestoreRefreshOutcomeV1::AuthorizationExpiredBeforeCommands {
            ..
        } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ExpiredLocalRequest,
                "tenant-root restore activation authorization expired before refresh commands",
            ));
        }
    }
    let issued =
        execute_cloudflare_tenant_root_control_plane_restore_initial_activation_service_call_v1(
            env,
            &CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1 {
                restore_refresh_grant_b64u: request.restore_refresh_grant_b64u,
                manifest_b64u: request.manifest_b64u,
            },
        )
        .await?;
    let activation_receipt_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root restore initial activation receipt",
        &issued.activation_receipt_b64u,
    )?;
    let activation_receipt =
        router_ab_core::TenantRootSignedActivationReceiptV1::decode_canonical_bytes(
            &activation_receipt_bytes,
        )
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("tenant-root restore initial activation receipt was malformed: {error}"),
            )
        })?;
    let persisted = execute_cloudflare_router_tenant_root_restore_initial_activation_call_v1(
        env,
        &activation_receipt_bytes,
    )
    .await?;
    let role_activation = CloudflareDeriverTenantRootInitialActivationRequestV1 {
        activation_receipt_b64u: issued.activation_receipt_b64u.clone(),
    };
    let (deriver_a, deriver_b) = futures::join!(
        execute_cloudflare_deriver_tenant_root_initial_activation_service_call_v1(
            env,
            &runtime.bindings().deriver_a,
            &role_activation,
        ),
        execute_cloudflare_deriver_tenant_root_initial_activation_service_call_v1(
            env,
            &runtime.bindings().deriver_b,
            &role_activation,
        ),
    );
    let role_cleanup = restore_role_cleanup_from_results_v1(
        restore_role_cleanup_digest_from_result_v1(
            CloudflareTenantRootCreateRoleV1::DeriverA,
            &deriver_a,
        ),
        restore_role_cleanup_digest_from_result_v1(
            CloudflareTenantRootCreateRoleV1::DeriverB,
            &deriver_b,
        ),
    );
    let router_ab_core::TenantRootActivationReceiptBindingV1::InitialCreation(binding) =
        activation_receipt.binding()
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore activation receipt is not an initial-creation receipt",
        ));
    };
    let installation_receipts = binding.installation_receipts();
    let canary_receipts = binding.canary_receipts();
    Ok(CloudflareRouterTenantRootRestoreActivationResponseV1 {
        activation_receipt_b64u: issued.activation_receipt_b64u,
        destination_lineage_id: activation_receipt.custody_lineage().to_base64url(),
        activated_epoch: binding.epoch().get().get(),
        activation_receipt_digest_b64u: persisted.activation_receipt_digest_b64u,
        forward_refresh_receipt_digest_b64u: aggregate_restore_activation_digests_v1(
            b"seams/tenant-root-restore-forward-refresh/v1",
            installation_receipts.deriver_a(),
            installation_receipts.deriver_b(),
        ),
        continuity_canary_receipt_digest_b64u: aggregate_restore_activation_digests_v1(
            b"seams/tenant-root-restore-continuity-canary/v1",
            canary_receipts.ecdsa(),
            canary_receipts.ed25519(),
        ),
        root_commitment_matches: true,
        cleanup: CloudflareRouterTenantRootRestoreCleanupV1 {
            bootstrap: CloudflareRouterTenantRootRestoreBootstrapCleanupV1::Destroyed {
                receipt_digest_b64u: persisted.destruction_receipt_digest_b64u,
            },
            roles: role_cleanup,
        },
    })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn coordinate_cloudflare_router_tenant_root_restore_refresh_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRestoreRefreshOutcomeV1> {
    let now_ms = crate::cloudflare_now_unix_ms_v1()?;
    let admission_request = CloudflareTenantRootRestoreRefreshCheckpointRequestV1::Admit {
        restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
        manifest_b64u: request.manifest_b64u.clone(),
    };
    let admission_response =
        execute_cloudflare_router_tenant_root_restore_refresh_checkpoint_call_v1(
            env,
            &admission_request,
        )
        .await?;
    let mut checkpoint = match admission_response {
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::Checkpoint { checkpoint } => {
            checkpoint
        }
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforeCommands {
            grant_digest_b64u,
            operation_digest_b64u,
            deriver_dispatch,
        } => {
            return Ok(
                CloudflareRouterTenantRootRestoreRefreshOutcomeV1::AuthorizationExpiredBeforeCommands {
                    grant_digest_b64u,
                    operation_digest_b64u,
                    deriver_dispatch,
                },
            );
        }
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::CompletedRead { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-refresh admission returned a completed-read response",
            ));
        }
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::PromotedRead { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-refresh admission returned a promoted-read response",
            ));
        }
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforePromotion {
            ..
        } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-refresh admission expired before promotion",
            ));
        }
    };

    if matches!(
        checkpoint.state,
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted
    ) {
        let issued =
            crate::execute_cloudflare_tenant_root_control_plane_restore_refresh_commands_service_call_v1(
                env, &request,
            )
            .await?;
        let commands = verify_cloudflare_router_tenant_root_restore_refresh_commands_v1(
            runtime,
            issued,
            RestoreRefreshCommandValidationV1::Fresh { now_ms },
        )?;
        let persist_commands_request =
            CloudflareTenantRootRestoreRefreshCheckpointRequestV1::PersistCommands {
                restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
                manifest_b64u: request.manifest_b64u.clone(),
                commands: restore_refresh_checkpoint_commands_v1(&commands),
            };
        checkpoint = execute_restore_refresh_checkpoint_v1(env, &persist_commands_request).await?;
    }

    let role_keys = crate::env::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(
        &CloudflareWorkerEnvReaderV1::new(env),
    )?;

    loop {
        let checkpoint_was_promoted = matches!(
            &checkpoint.state,
            CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted { .. }
        );
        match checkpoint.state.clone() {
            CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "tenant-root restore-refresh checkpoint remained admitted without commands",
                ));
            }
            CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted {
                commands: persisted_commands,
            } => {
                let commands =
                    restore_refresh_commands_from_checkpoint_v1(runtime, persisted_commands)?;
                let deriver_a_prepare_request =
                    CloudflareDeriverTenantRootRestoreRefreshRequestV1::Prepare {
                        role_refresh_command_b64u: commands.deriver_a_command_b64u.clone(),
                    };
                let deriver_b_prepare_request =
                    CloudflareDeriverTenantRootRestoreRefreshRequestV1::Prepare {
                        role_refresh_command_b64u: commands.deriver_b_command_b64u.clone(),
                    };
                let (deriver_a_prepare, deriver_b_prepare) = futures::join!(
                    execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_with_retry_v1(
                        env,
                        restore_refresh_peer_v1(runtime, TwoPartyDeriverRole::DeriverA),
                        &deriver_a_prepare_request,
                    ),
                    execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_with_retry_v1(
                        env,
                        restore_refresh_peer_v1(runtime, TwoPartyDeriverRole::DeriverB),
                        &deriver_b_prepare_request,
                    ),
                );
                let deriver_a_prepare =
                    verify_cloudflare_router_tenant_root_restore_refresh_prepare_v1(
                        &commands,
                        TwoPartyDeriverRole::DeriverA,
                        &role_keys,
                        deriver_a_prepare?,
                    )?;
                let deriver_b_prepare =
                    verify_cloudflare_router_tenant_root_restore_refresh_prepare_v1(
                        &commands,
                        TwoPartyDeriverRole::DeriverB,
                        &role_keys,
                        deriver_b_prepare?,
                    )?;
                checkpoint = execute_restore_refresh_checkpoint_v1(
                    env,
                    &CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitPrepared {
                        restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
                        deriver_a_commitment_b64u: deriver_a_prepare.wire_b64u,
                        deriver_b_commitment_b64u: deriver_b_prepare.wire_b64u,
                    },
                )
                .await?;
            }
            CloudflareTenantRootRestoreRefreshCheckpointStateV1::Prepared {
                commands: persisted_commands,
                deriver_a_commitment_b64u,
                deriver_b_commitment_b64u,
            } => {
                let commands =
                    restore_refresh_commands_from_checkpoint_v1(runtime, persisted_commands)?;
                let commitment_pair = restore_refresh_commitment_pair_from_wires_v1(
                    &commands,
                    &role_keys,
                    &deriver_a_commitment_b64u,
                    &deriver_b_commitment_b64u,
                )?;
                let deriver_a_contribute_request =
                    CloudflareDeriverTenantRootRestoreRefreshRequestV1::Contribute {
                        role_refresh_command_b64u: commands.deriver_a_command_b64u.clone(),
                        deriver_a_commitment_b64u: deriver_a_commitment_b64u.clone(),
                        deriver_b_commitment_b64u: deriver_b_commitment_b64u.clone(),
                    };
                let deriver_b_contribute_request =
                    CloudflareDeriverTenantRootRestoreRefreshRequestV1::Contribute {
                        role_refresh_command_b64u: commands.deriver_b_command_b64u.clone(),
                        deriver_a_commitment_b64u: deriver_a_commitment_b64u.clone(),
                        deriver_b_commitment_b64u: deriver_b_commitment_b64u.clone(),
                    };
                let (deriver_a_contribute, deriver_b_contribute) = futures::join!(
                    execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_with_retry_v1(
                        env,
                        restore_refresh_peer_v1(runtime, TwoPartyDeriverRole::DeriverA),
                        &deriver_a_contribute_request,
                    ),
                    execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_with_retry_v1(
                        env,
                        restore_refresh_peer_v1(runtime, TwoPartyDeriverRole::DeriverB),
                        &deriver_b_contribute_request,
                    ),
                );
                let deriver_a_contribute =
                    verify_cloudflare_router_tenant_root_restore_refresh_contribute_v1(
                        &commands,
                        &commitment_pair,
                        TwoPartyDeriverRole::DeriverA,
                        &role_keys,
                        deriver_a_contribute?,
                    )?;
                let deriver_b_contribute =
                    verify_cloudflare_router_tenant_root_restore_refresh_contribute_v1(
                        &commands,
                        &commitment_pair,
                        TwoPartyDeriverRole::DeriverB,
                        &role_keys,
                        deriver_b_contribute?,
                    )?;
                checkpoint = execute_restore_refresh_checkpoint_v1(
                    env,
                    &CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitContributed {
                        restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
                        deriver_a_commitment_b64u,
                        deriver_b_commitment_b64u,
                        deriver_a_contribution_b64u: deriver_a_contribute,
                        deriver_b_contribution_b64u: deriver_b_contribute,
                    },
                )
                .await?;
            }
            CloudflareTenantRootRestoreRefreshCheckpointStateV1::Contributed {
                commands: persisted_commands,
                deriver_a_commitment_b64u,
                deriver_b_commitment_b64u,
                deriver_a_contribution_b64u,
                deriver_b_contribution_b64u,
            } => {
                let commands =
                    restore_refresh_commands_from_checkpoint_v1(runtime, persisted_commands)?;
                let _commitment_pair = restore_refresh_commitment_pair_from_wires_v1(
                    &commands,
                    &role_keys,
                    &deriver_a_commitment_b64u,
                    &deriver_b_commitment_b64u,
                )?;
                let deriver_a_contribution = verify_persisted_restore_refresh_contribute_v1(
                    &commands,
                    &_commitment_pair,
                    TwoPartyDeriverRole::DeriverA,
                    &role_keys,
                    &deriver_a_contribution_b64u,
                )?;
                let deriver_b_contribution = verify_persisted_restore_refresh_contribute_v1(
                    &commands,
                    &_commitment_pair,
                    TwoPartyDeriverRole::DeriverB,
                    &role_keys,
                    &deriver_b_contribution_b64u,
                )?;
                let deriver_a_finalize_request =
                    CloudflareDeriverTenantRootRestoreRefreshRequestV1::Finalize {
                        role_refresh_command_b64u: commands.deriver_a_command_b64u.clone(),
                        deriver_a_commitment_b64u: deriver_a_commitment_b64u.clone(),
                        deriver_b_commitment_b64u: deriver_b_commitment_b64u.clone(),
                        peer_contribution_b64u: deriver_b_contribution,
                    };
                let deriver_b_finalize_request =
                    CloudflareDeriverTenantRootRestoreRefreshRequestV1::Finalize {
                        role_refresh_command_b64u: commands.deriver_b_command_b64u.clone(),
                        deriver_a_commitment_b64u: deriver_a_commitment_b64u.clone(),
                        deriver_b_commitment_b64u: deriver_b_commitment_b64u.clone(),
                        peer_contribution_b64u: deriver_a_contribution,
                    };
                let (deriver_a_finalize, deriver_b_finalize) = futures::join!(
                    execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_with_retry_v1(
                        env,
                        restore_refresh_peer_v1(runtime, TwoPartyDeriverRole::DeriverA),
                        &deriver_a_finalize_request,
                    ),
                    execute_cloudflare_deriver_tenant_root_restore_refresh_service_call_with_retry_v1(
                        env,
                        restore_refresh_peer_v1(runtime, TwoPartyDeriverRole::DeriverB),
                        &deriver_b_finalize_request,
                    ),
                );
                let deriver_a_evidence =
                    verify_cloudflare_router_tenant_root_restore_refresh_evidence_v1(
                        &commands,
                        TwoPartyDeriverRole::DeriverA,
                        &role_keys,
                        deriver_a_finalize?,
                    )?;
                let deriver_b_evidence =
                    verify_cloudflare_router_tenant_root_restore_refresh_evidence_v1(
                        &commands,
                        TwoPartyDeriverRole::DeriverB,
                        &role_keys,
                        deriver_b_finalize?,
                    )?;
                let (deriver_a_evidence_digest_b64u, deriver_b_evidence_digest_b64u) =
                    restore_refresh_evidence_digests_v1(
                        &commands,
                        &deriver_a_evidence,
                        &deriver_b_evidence,
                    )?;
                checkpoint = execute_restore_refresh_checkpoint_v1(
                    env,
                    &CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitCompleted {
                        restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
                        deriver_a_commitment_b64u,
                        deriver_b_commitment_b64u,
                        deriver_a_contribution_b64u,
                        deriver_b_contribution_b64u,
                        deriver_a_evidence_b64u: deriver_a_evidence.wire_b64u,
                        deriver_b_evidence_b64u: deriver_b_evidence.wire_b64u,
                        deriver_a_evidence_digest_b64u,
                        deriver_b_evidence_digest_b64u,
                    },
                )
                .await?;
            }
            CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
                commands: persisted_commands,
                deriver_a_commitment_b64u,
                deriver_b_commitment_b64u,
                deriver_a_contribution_b64u,
                deriver_b_contribution_b64u,
                deriver_a_evidence_b64u,
                deriver_b_evidence_b64u,
                ..
            }
            | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
                commands: persisted_commands,
                deriver_a_commitment_b64u,
                deriver_b_commitment_b64u,
                deriver_a_contribution_b64u,
                deriver_b_contribution_b64u,
                deriver_a_evidence_b64u,
                deriver_b_evidence_b64u,
                ..
            } => {
                let commands =
                    restore_refresh_commands_from_checkpoint_v1(runtime, persisted_commands)?;
                let commitment_pair = restore_refresh_commitment_pair_from_wires_v1(
                    &commands,
                    &role_keys,
                    &deriver_a_commitment_b64u,
                    &deriver_b_commitment_b64u,
                )?;
                verify_persisted_restore_refresh_contribute_v1(
                    &commands,
                    &commitment_pair,
                    TwoPartyDeriverRole::DeriverA,
                    &role_keys,
                    &deriver_a_contribution_b64u,
                )?;
                verify_persisted_restore_refresh_contribute_v1(
                    &commands,
                    &commitment_pair,
                    TwoPartyDeriverRole::DeriverB,
                    &role_keys,
                    &deriver_b_contribution_b64u,
                )?;
                let deriver_a_evidence = verify_persisted_restore_refresh_evidence_v1(
                    &commands,
                    TwoPartyDeriverRole::DeriverA,
                    &role_keys,
                    &deriver_a_evidence_b64u,
                )?;
                let deriver_b_evidence = verify_persisted_restore_refresh_evidence_v1(
                    &commands,
                    TwoPartyDeriverRole::DeriverB,
                    &role_keys,
                    &deriver_b_evidence_b64u,
                )?;
                if !checkpoint_was_promoted {
                    promote_cloudflare_router_tenant_root_restore_refresh_v1(
                        env,
                        runtime,
                        &request,
                        &checkpoint,
                        &commands,
                        &deriver_a_evidence_b64u,
                        &deriver_b_evidence_b64u,
                    )
                    .await?;
                    return Ok(
                        CloudflareRouterTenantRootRestoreRefreshOutcomeV1::Completed(
                            restore_refresh_final_response_v1(
                                commands,
                                deriver_a_evidence,
                                deriver_b_evidence,
                            )?,
                        ),
                    );
                }
                let expected_authority_id = restore_refresh_expected_authority_v1(env, &commands)?;
                let promoted_read =
                    execute_cloudflare_router_tenant_root_restore_refresh_checkpoint_call_v1(
                        env,
                        &CloudflareTenantRootRestoreRefreshCheckpointRequestV1::ReadPromoted {
                            restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
                            manifest_b64u: request.manifest_b64u.clone(),
                        },
                    )
                    .await?;
                let (_, deriver_a_promotion, deriver_b_promotion) =
                    restore_refresh_promoted_read_v1(
                        &checkpoint,
                        expected_authority_id,
                        promoted_read,
                    )?;
                require_restore_refresh_promotions_match_checkpoint_v1(
                    &checkpoint,
                    &deriver_a_promotion,
                    &deriver_b_promotion,
                )?;
                return Ok(
                    CloudflareRouterTenantRootRestoreRefreshOutcomeV1::Completed(
                        restore_refresh_final_response_v1(
                            commands,
                            deriver_a_evidence,
                            deriver_b_evidence,
                        )?,
                    ),
                );
            }
        }
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn tenant_root_deriver_role_for_peer_v1(
    peer: &CloudflarePeerBindingV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreateRoleV1> {
    match peer.peer_role {
        crate::CloudflareWorkerRoleV1::DeriverA => Ok(CloudflareTenantRootCreateRoleV1::DeriverA),
        crate::CloudflareWorkerRoleV1::DeriverB => Ok(CloudflareTenantRootCreateRoleV1::DeriverB),
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root managed restore can target only a Deriver",
        )),
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn tenant_root_deriver_managed_restore_service_url_v1(
    peer: &CloudflarePeerBindingV1,
    path: &'static str,
) -> RouterAbProtocolResult<String> {
    peer.validate()?;
    let host = match peer.peer_role {
        crate::CloudflareWorkerRoleV1::DeriverA => "router-ab-deriver-a.internal",
        crate::CloudflareWorkerRoleV1::DeriverB => "router-ab-deriver-b.internal",
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root managed restore can target only a Deriver",
            ));
        }
    };
    Ok(format!("https://{host}{path}"))
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn execute_cloudflare_deriver_tenant_root_managed_restore_service_call_v1(
    env: &Env,
    peer: &CloudflarePeerBindingV1,
    request: &CloudflareDeriverTenantRootManagedRestoreRequestV1,
    expected_capability_digest: TenantRootLifecycleReceiptDigestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootManagedRestoreResponseV1> {
    let expected_role = tenant_root_deriver_role_for_peer_v1(peer)?;
    let url = tenant_root_deriver_managed_restore_service_url_v1(
        peer,
        crate::CLOUDFLARE_DERIVER_TENANT_ROOT_MANAGED_RESTORE_PRIVATE_REQUEST_PATH,
    )?;
    let response: CloudflareDeriverTenantRootManagedRestoreResponseV1 = crate::post_service_json(
        env,
        &peer.binding_name,
        &url,
        "tenant-root managed-restore staging request",
        request,
    )
    .await?;
    if response.role != expected_role
        || response.status
            != CloudflareDeriverTenantRootManagedRestoreStatusV1::StagedForForwardRefresh
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root managed-restore response does not confirm staged forward refresh",
        ));
    }
    let capability_digest = decode_exact_tenant_root_wire_v1(
        "tenant-root managed-restore staging capability digest",
        &response.capability_digest_b64u,
    )?;
    if capability_digest.as_slice() != expected_capability_digest.as_bytes() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore staging response names a different capability",
        ));
    }
    let terminal_receipt = decode_exact_tenant_root_wire_v1(
        "tenant-root managed-restore staging terminal receipt",
        &response.staging_terminal_receipt_b64u,
    )?;
    if !matches!(
        TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&terminal_receipt).map_err(
            |error| {
                managed_restore_derivation_error_v1(
                    "tenant-root managed-restore staging terminal receipt",
                    error,
                )
            }
        )?,
        TenantRootCommandTerminalReceiptV1::Success(_)
    ) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root managed-restore staging did not complete successfully",
        ));
    }
    Ok(response)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn execute_cloudflare_deriver_tenant_root_managed_restore_forward_refresh_service_call_v1(
    env: &Env,
    peer: &CloudflarePeerBindingV1,
    request: &CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    let expected_role = tenant_root_deriver_role_for_peer_v1(peer)?;
    let url = tenant_root_deriver_managed_restore_service_url_v1(
        peer,
        crate::CLOUDFLARE_DERIVER_TENANT_ROOT_MANAGED_RESTORE_FORWARD_REFRESH_PRIVATE_REQUEST_PATH,
    )?;
    let response: CloudflareDeriverTenantRootRefreshResponseV1 = crate::post_service_json(
        env,
        &peer.binding_name,
        &url,
        "tenant-root managed-restore forward-refresh request",
        request,
    )
    .await?;
    if response.role != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root managed-restore forward-refresh response names the wrong role",
        ));
    }
    Ok(response)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn execute_cloudflare_deriver_tenant_root_managed_restore_forward_refresh_service_call_with_retry_v1<
    'a,
>(
    env: &'a Env,
    peer: &'a CloudflarePeerBindingV1,
    request: &'a CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    match execute_cloudflare_deriver_tenant_root_managed_restore_forward_refresh_service_call_v1(
        env, peer, request,
    )
    .await
    {
        Ok(response) => Ok(response),
        Err(_) => {
            execute_cloudflare_deriver_tenant_root_managed_restore_forward_refresh_service_call_v1(
                env, peer, request,
            )
            .await
        }
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn request_restore_role_import_command_v1(
    env: &Env,
    request: CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1,
) -> RouterAbProtocolResult<(
    CloudflareTenantRootCreateRoleV1,
    String,
    CloudflareDeriverTenantRootRestoreRoleImportKeyRequestV1,
)> {
    let control_plane_response: CloudflareTenantRootControlPlaneRestoreRoleImportKeyResponseV1 =
        post_service_json(
            env,
            crate::TENANT_ROOT_CONTROL_PLANE_SERVICE_BINDING_V1,
            crate::cloudflare_tenant_root_control_plane_restore_role_import_key_service_url(),
            "tenant-root control-plane restore role-import key request",
            &request,
        )
        .await?;
    // The Router uses the signed command only to choose its fixed peer; the
    // selected Deriver owns signature and durable replay enforcement.
    let command_b64u = control_plane_response.role_import_command_b64u.clone();
    let command_bytes =
        decode_exact_tenant_root_wire_v1("tenant-root restore role-import command", &command_b64u)?;
    let command = TenantRootRestoreRoleImportCommandV1::decode_canonical_bytes(&command_bytes)
        .map_err(|error| {
            managed_restore_derivation_error_v1("tenant-root restore role-import command", error)
        })?;
    if command.issuer_key_id() != control_plane_response.issuer_key_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore role-import response issuer does not match its command",
        ));
    }
    let expected_role = CloudflareTenantRootCreateRoleV1::from_protocol(command.role());
    Ok((
        expected_role,
        command.import_key_id().to_owned(),
        CloudflareDeriverTenantRootRestoreRoleImportKeyRequestV1 {
            issuer_key_id: control_plane_response.issuer_key_id,
            role_import_command_b64u: command_b64u,
        },
    ))
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn execute_cloudflare_router_tenant_root_restore_role_import_key_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRoleImportKeyResponseV1> {
    let (expected_role, expected_key_id, deriver_request) =
        request_restore_role_import_command_v1(env, request).await?;
    let peer = match expected_role {
        CloudflareTenantRootCreateRoleV1::DeriverA => runtime.deriver_a_peer(),
        CloudflareTenantRootCreateRoleV1::DeriverB => runtime.deriver_b_peer(),
    };
    let url = tenant_root_deriver_managed_restore_service_url_v1(
        peer,
        CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_PRIVATE_REQUEST_PATH,
    )?;
    let response: CloudflareDeriverTenantRootRestoreRoleImportKeyResponseV1 = post_service_json(
        env,
        &peer.binding_name,
        &url,
        "tenant-root Deriver restore role-import key request",
        &deriver_request,
    )
    .await?;
    if response.role != expected_role || response.import_key_id != expected_key_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root Deriver restore role-import response names a different role or import key",
        ));
    }
    Ok(response)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct CloudflareRouterTenantRootRestoreRoleImportAcceptRequestV1 {
    restore_grant_b64u: String,
    manifest_b64u: String,
    import_envelope_b64u: String,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn execute_cloudflare_router_tenant_root_restore_role_import_accept_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: CloudflareRouterTenantRootRestoreRoleImportAcceptRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRoleImportAcceptResponseV1> {
    let (expected_role, expected_key_id, command) = request_restore_role_import_command_v1(
        env,
        CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1 {
            restore_grant_b64u: request.restore_grant_b64u,
            manifest_b64u: request.manifest_b64u,
        },
    )
    .await?;
    let peer = match expected_role {
        CloudflareTenantRootCreateRoleV1::DeriverA => runtime.deriver_a_peer(),
        CloudflareTenantRootCreateRoleV1::DeriverB => runtime.deriver_b_peer(),
    };
    let url = tenant_root_deriver_managed_restore_service_url_v1(
        peer,
        crate::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_ROLE_IMPORT_ACCEPT_PRIVATE_REQUEST_PATH,
    )?;
    let response: CloudflareDeriverTenantRootRestoreRoleImportAcceptResponseV1 = post_service_json(
        env,
        &peer.binding_name,
        &url,
        "tenant-root Deriver restore role-import acceptance",
        &CloudflareDeriverTenantRootRestoreRoleImportAcceptRequestV1 {
            issuer_key_id: command.issuer_key_id,
            role_import_command_b64u: command.role_import_command_b64u,
            import_envelope_b64u: request.import_envelope_b64u,
        },
    )
    .await?;
    if response.role != expected_role || response.import_key_id != expected_key_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root Deriver restore role-import response names a different role or import key",
        ));
    }
    Ok(response)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
enum CloudflareManagedRestoreForwardRefreshRequestOrNormalV1 {
    Managed(CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1),
    Normal(CloudflareDeriverTenantRootRefreshRequestV1),
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn execute_cloudflare_router_managed_restore_forward_refresh_request_with_retry_v1(
    env: &Env,
    peer: &CloudflarePeerBindingV1,
    request: CloudflareManagedRestoreForwardRefreshRequestOrNormalV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    match request {
        CloudflareManagedRestoreForwardRefreshRequestOrNormalV1::Managed(request) => {
            execute_cloudflare_deriver_tenant_root_managed_restore_forward_refresh_service_call_with_retry_v1(
                env, peer, &request,
            )
            .await
        }
        CloudflareManagedRestoreForwardRefreshRequestOrNormalV1::Normal(request) => {
            execute_cloudflare_deriver_tenant_root_refresh_service_call_with_retry_v1(
                env, peer, &request,
            )
            .await
        }
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn refresh_attempt_packages_v1(
    fence: CloudflareTenantRootRefreshFenceV1,
) -> RouterAbProtocolResult<(String, String, String)> {
    match fence {
        CloudflareTenantRootRefreshFenceV1::Reserved { attempt }
        | CloudflareTenantRootRefreshFenceV1::Executed { attempt } => Ok((
            attempt.refresh_context_b64u,
            attempt.deriver_a_refresh_command_b64u,
            attempt.deriver_b_refresh_command_b64u,
        )),
        CloudflareTenantRootRefreshFenceV1::Open => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root refresh attempt is not reserved",
        )),
        CloudflareTenantRootRefreshFenceV1::Terminal { .. } => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "tenant-root refresh operation is terminal",
        )),
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn replay_terminal_refresh_response_v1(
    fence: &CloudflareTenantRootRefreshFenceV1,
) -> RouterAbProtocolResult<Option<CloudflareRouterTenantRootRefreshResponseV1>> {
    match fence {
        CloudflareTenantRootRefreshFenceV1::Terminal {
            outcome: crate::durable_object::tenant_root_creation::CloudflareTenantRootRefreshTerminalOutcomeV1::Completed,
            response,
            ..
        } => Ok(Some(CloudflareRouterTenantRootRefreshResponseV1 {
            activation_receipt_digest_b64u: response.activation_receipt_digest_b64u.clone(),
            lifecycle_revision: response.lifecycle_revision,
            retirement: CloudflareRouterTenantRootRetirementEvidenceV1::Unverified,
        })),
        CloudflareTenantRootRefreshFenceV1::Terminal { .. } => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ConflictingPair,
                "tenant-root refresh operation is terminal without a successful activation",
            ))
        }
        _ => Ok(None),
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn replay_cloudflare_router_terminal_refresh_cleanup_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    identity_digest_b64u: &str,
    custody_lineage_b64u: &str,
    activation_receipt_b64u: String,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRetirementEvidenceV1> {
    let role_activation = CloudflareDeriverTenantRootRefreshActivationRequestV1 {
        activation_receipt_b64u,
    };
    let (deriver_a_activation, deriver_b_activation) = futures::try_join!(
        execute_cloudflare_deriver_tenant_root_refresh_activation_service_call_v1(
            env,
            &runtime.bindings().deriver_a,
            &role_activation,
        ),
        execute_cloudflare_deriver_tenant_root_refresh_activation_service_call_v1(
            env,
            &runtime.bindings().deriver_b,
            &role_activation,
        ),
    )?;
    futures::try_join!(
        cleanup_cloudflare_router_retired_tenant_root_role_v1(
            env,
            runtime,
            identity_digest_b64u,
            custody_lineage_b64u,
            &deriver_a_activation,
        ),
        cleanup_cloudflare_router_retired_tenant_root_role_v1(
            env,
            runtime,
            identity_digest_b64u,
            custody_lineage_b64u,
            &deriver_b_activation,
        ),
    )?;
    Ok(CloudflareRouterTenantRootRetirementEvidenceV1::Confirmed)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn finish_cloudflare_router_tenant_root_refresh_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    identity_digest_b64u: &str,
    custody_lineage_b64u: &str,
    deriver_a: CloudflareDeriverTenantRootRefreshResponseV1,
    deriver_b: CloudflareDeriverTenantRootRefreshResponseV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRefreshResponseV1> {
    let issued_activation =
        execute_cloudflare_tenant_root_control_plane_refresh_activation_service_call_v1(
            env,
            &CloudflareTenantRootControlPlaneRefreshActivationRequestV1 {
                deriver_a_signed_installation_evidence_b64u: deriver_a
                    .signed_installation_evidence_b64u,
                deriver_b_signed_installation_evidence_b64u: deriver_b
                    .signed_installation_evidence_b64u,
                deriver_a_signed_managed_backup_b64u: deriver_a.signed_managed_backup_b64u,
                deriver_b_signed_managed_backup_b64u: deriver_b.signed_managed_backup_b64u,
                ecdsa_provider_canary_receipt_b64u: deriver_a.provider_canary_receipt_b64u,
                ed25519_provider_canary_receipt_b64u: deriver_b.provider_canary_receipt_b64u,
            },
        )
        .await?;
    let role_activation = CloudflareDeriverTenantRootRefreshActivationRequestV1 {
        activation_receipt_b64u: issued_activation.activation_receipt_b64u.clone(),
    };
    let (deriver_a_activation, deriver_b_activation) = futures::try_join!(
        execute_cloudflare_deriver_tenant_root_refresh_activation_service_call_v1(
            env,
            &runtime.bindings().deriver_a,
            &role_activation,
        ),
        execute_cloudflare_deriver_tenant_root_refresh_activation_service_call_v1(
            env,
            &runtime.bindings().deriver_b,
            &role_activation,
        ),
    )?;
    let activation_receipt = crate::decode_base64url_bytes_v1(
        "tenant-root refresh activation receipt",
        &issued_activation.activation_receipt_b64u,
    )?;
    let activated =
        execute_cloudflare_router_tenant_root_refresh_activation_call_v1(env, &activation_receipt)
            .await?;
    futures::try_join!(
        cleanup_cloudflare_router_retired_tenant_root_role_v1(
            env,
            runtime,
            identity_digest_b64u,
            custody_lineage_b64u,
            &deriver_a_activation,
        ),
        cleanup_cloudflare_router_retired_tenant_root_role_v1(
            env,
            runtime,
            identity_digest_b64u,
            custody_lineage_b64u,
            &deriver_b_activation,
        ),
    )?;
    Ok(CloudflareRouterTenantRootRefreshResponseV1 {
        activation_receipt_digest_b64u: activated.activation_receipt_digest_b64u,
        lifecycle_revision: activated.lifecycle_revision,
        retirement: CloudflareRouterTenantRootRetirementEvidenceV1::Confirmed,
    })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn coordinate_cloudflare_router_tenant_root_refresh_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: CloudflareRouterTenantRootRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRefreshResultV1> {
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(
        crate::decode_base64url_bytes_v1(
            "tenant-root refresh identity digest",
            &request.identity_digest_b64u,
        )?
        .try_into()
        .map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "tenant-root refresh identity digest must contain exactly 32 bytes",
            )
        })?,
    );
    let custody_lineage = TenantRootCustodyLineageId::from_base64url(&request.custody_lineage_b64u)
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("tenant-root refresh custody lineage is invalid: {error}"),
            )
        })?;
    let admitted_revision = match execute_cloudflare_router_tenant_root_refresh_admission_call_v1(
        env,
        identity_digest,
        custody_lineage,
        request.operation_id.clone(),
        request.trigger,
        request.expected_lifecycle_revision,
        request.expires_at_ms,
    )
    .await?
    {
        CloudflareTenantRootRefreshAdmissionOutcomeV1::Admitted { lifecycle_revision } => {
            lifecycle_revision
        }
        CloudflareTenantRootRefreshAdmissionOutcomeV1::Replayed { response } => {
            let active = execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1(
                env, identity_digest, custody_lineage,
            ).await?;
            // A delayed retry must never reinstall an epoch superseded by refresh or restore.
            let retirement = if active.lifecycle_revision == response.lifecycle_revision {
                replay_cloudflare_router_terminal_refresh_cleanup_v1(
                    env,
                    runtime,
                    &request.identity_digest_b64u,
                    &request.custody_lineage_b64u,
                    crate::encode_base64url_bytes_v1(active.activation_receipt.canonical_bytes()),
                )
                .await?
            } else {
                CloudflareRouterTenantRootRetirementEvidenceV1::Unverified
            };
            return Ok(CloudflareRouterTenantRootRefreshResultV1::Completed(
                CloudflareRouterTenantRootRefreshResponseV1 {
                    activation_receipt_digest_b64u: response.activation_receipt_digest_b64u,
                    lifecycle_revision: response.lifecycle_revision,
                    retirement,
                },
            ));
        }
        CloudflareTenantRootRefreshAdmissionOutcomeV1::Throttled { retry_at_ms } => {
            return Ok(CloudflareRouterTenantRootRefreshResultV1::Throttled { retry_at_ms });
        }
        CloudflareTenantRootRefreshAdmissionOutcomeV1::RevisionMoved => {
            return Ok(CloudflareRouterTenantRootRefreshResultV1::RevisionMoved);
        }
        CloudflareTenantRootRefreshAdmissionOutcomeV1::AuthorizationExpired => {
            return Ok(CloudflareRouterTenantRootRefreshResultV1::AuthorizationExpired);
        }
        CloudflareTenantRootRefreshAdmissionOutcomeV1::NotDue { next_run_at_ms } => {
            return Ok(CloudflareRouterTenantRootRefreshResultV1::NotDue { next_run_at_ms });
        }
        CloudflareTenantRootRefreshAdmissionOutcomeV1::InProgress => {
            return Ok(CloudflareRouterTenantRootRefreshResultV1::InProgress);
        }
    };
    let active =
        execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1(
            env,
            identity_digest,
            custody_lineage,
        )
        .await?;
    if active.lifecycle_revision != admitted_revision {
        let mut response = replay_terminal_refresh_response_v1(&active.refresh_fence)?
            .filter(|_| matches!(&active.refresh_fence,
                CloudflareTenantRootRefreshFenceV1::Terminal { attempt, .. }
                    if attempt.manual_operation_id.as_deref() == Some(request.operation_id.as_str())))
            .ok_or_else(|| RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ConflictingPair,
                "tenant-root manual refresh admission revision changed; retry the same operation",
            ))?;
        response.retirement = replay_cloudflare_router_terminal_refresh_cleanup_v1(
            env,
            runtime,
            &request.identity_digest_b64u,
            &request.custody_lineage_b64u,
            crate::encode_base64url_bytes_v1(active.activation_receipt.canonical_bytes()),
        )
        .await?;
        return Ok(CloudflareRouterTenantRootRefreshResultV1::Completed(
            response,
        ));
    }
    if matches!(
        &active.refresh_fence,
        CloudflareTenantRootRefreshFenceV1::Terminal { .. }
    ) {
        // Finish interrupted retirement before replacing the terminal attempt.
        replay_cloudflare_router_terminal_refresh_cleanup_v1(
            env,
            runtime,
            &request.identity_digest_b64u,
            &request.custody_lineage_b64u,
            crate::encode_base64url_bytes_v1(active.activation_receipt.canonical_bytes()),
        )
        .await?;
    }
    let (refresh_context_b64u, deriver_a_refresh_command_b64u, deriver_b_refresh_command_b64u) =
        match active.refresh_fence {
            CloudflareTenantRootRefreshFenceV1::Open
            | CloudflareTenantRootRefreshFenceV1::Terminal { .. } => {
                let commands_request = CloudflareTenantRootControlPlaneRefreshCommandsRequestV1 {
                    identity_digest_b64u: request.identity_digest_b64u.clone(),
                    custody_lineage_b64u: request.custody_lineage_b64u.clone(),
                };
                let issued =
                    execute_cloudflare_tenant_root_control_plane_refresh_commands_service_call_v1(
                        env,
                        &commands_request,
                    )
                    .await?;
                let reserved =
                    execute_cloudflare_router_tenant_root_refresh_attempt_reservation_call_v1(
                        env,
                        identity_digest,
                        custody_lineage,
                        issued.refresh_context_b64u,
                        issued.deriver_a_refresh_command_b64u,
                        issued.deriver_b_refresh_command_b64u,
                        Some(request.operation_id.clone()),
                    )
                    .await?;
                refresh_attempt_packages_v1(reserved.refresh_fence)?
            }
            fence => {
                match &fence {
                    CloudflareTenantRootRefreshFenceV1::Reserved { attempt }
                    | CloudflareTenantRootRefreshFenceV1::Executed { attempt }
                        if attempt.manual_operation_id.as_deref()
                            == Some(request.operation_id.as_str()) => {}
                    _ => {
                        return Err(RouterAbProtocolError::new(
                            RouterAbProtocolErrorCode::ConflictingPair,
                            "tenant-root manual refresh attempt belongs to another operation",
                        ))
                    }
                }
                refresh_attempt_packages_v1(fence)?
            }
        };
    let deriver_a_request = CloudflareDeriverTenantRootRefreshRequestV1 {
        refresh_context_b64u: refresh_context_b64u.clone(),
        role_refresh_command_b64u: deriver_a_refresh_command_b64u,
    };
    let deriver_b_request = CloudflareDeriverTenantRootRefreshRequestV1 {
        refresh_context_b64u,
        role_refresh_command_b64u: deriver_b_refresh_command_b64u,
    };
    let (deriver_a, deriver_b) = futures::join!(
        execute_cloudflare_deriver_tenant_root_refresh_service_call_with_retry_v1(
            env,
            &runtime.bindings().deriver_a,
            &deriver_a_request,
        ),
        execute_cloudflare_deriver_tenant_root_refresh_service_call_with_retry_v1(
            env,
            &runtime.bindings().deriver_b,
            &deriver_b_request,
        ),
    );
    let deriver_a = deriver_a?;
    let deriver_b = deriver_b?;
    let completed = finish_cloudflare_router_tenant_root_refresh_v1(
        env,
        runtime,
        &request.identity_digest_b64u,
        &request.custody_lineage_b64u,
        deriver_a,
        deriver_b,
    )
    .await?;
    Ok(CloudflareRouterTenantRootRefreshResultV1::Completed(
        completed,
    ))
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn coordinate_cloudflare_router_tenant_root_managed_restore_v1(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: CloudflareRouterTenantRootManagedRestoreRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRefreshResponseV1> {
    let authorization =
        verify_cloudflare_router_tenant_root_managed_restore_request_v1(env, request)?;
    let active =
        execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1(
            env,
            authorization.identity_digest,
            authorization.custody_lineage,
        )
        .await?;
    require_cloudflare_router_managed_restore_checkpoint_artifacts_v1(&active, &authorization)?;
    let terminal_belongs_to_this_restore = matches!(
        &active.refresh_fence,
        CloudflareTenantRootRefreshFenceV1::Terminal { attempt, .. }
            if attempt.current_epoch == authorization.active_epoch
    );
    if terminal_belongs_to_this_restore {
        let mut response =
            replay_terminal_refresh_response_v1(&active.refresh_fence)?.ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "tenant-root managed-restore terminal refresh response is unavailable",
                )
            })?;
        response.retirement = replay_cloudflare_router_terminal_refresh_cleanup_v1(
            env,
            runtime,
            &crate::encode_base64url_bytes_v1(authorization.identity_digest.as_bytes()),
            &authorization.custody_lineage.to_base64url(),
            crate::encode_base64url_bytes_v1(active.activation_receipt.canonical_bytes()),
        )
        .await?;
        return Ok(response);
    }
    require_cloudflare_router_managed_restore_checkpoint_current_state_v1(&active, &authorization)?;

    let must_start_forward_refresh = matches!(
        &active.refresh_fence,
        CloudflareTenantRootRefreshFenceV1::Open
    ) || matches!(
        &active.refresh_fence,
        CloudflareTenantRootRefreshFenceV1::Terminal { attempt, .. }
            if attempt.next_epoch == authorization.active_epoch
    );

    let (refresh_context_b64u, deriver_a_refresh_command_b64u, deriver_b_refresh_command_b64u) =
        if must_start_forward_refresh {
            let deriver = match authorization.unavailable_role {
                TenantRootManagedRestoreRoleV1::DeriverA => &runtime.bindings().deriver_a,
                TenantRootManagedRestoreRoleV1::DeriverB => &runtime.bindings().deriver_b,
            };
            execute_cloudflare_deriver_tenant_root_managed_restore_service_call_v1(
                env,
                deriver,
                &CloudflareDeriverTenantRootManagedRestoreRequestV1 {
                    public_state_b64u: authorization.public_state_b64u.clone(),
                    restore_capability_b64u: authorization.restore_capability_b64u.clone(),
                },
                authorization.capability.capability_digest(),
            )
            .await?;

            let refresh_commands_request =
                CloudflareTenantRootControlPlaneRefreshCommandsRequestV1 {
                    identity_digest_b64u: crate::encode_base64url_bytes_v1(
                        authorization.identity_digest.as_bytes(),
                    ),
                    custody_lineage_b64u: authorization.custody_lineage.to_base64url(),
                };
            let issued =
                execute_cloudflare_tenant_root_control_plane_refresh_commands_service_call_v1(
                    env,
                    &refresh_commands_request,
                )
                .await?;
            let reserved =
                execute_cloudflare_router_tenant_root_refresh_attempt_reservation_call_v1(
                    env,
                    authorization.identity_digest,
                    authorization.custody_lineage,
                    issued.refresh_context_b64u,
                    issued.deriver_a_refresh_command_b64u,
                    issued.deriver_b_refresh_command_b64u,
                    None,
                )
                .await?;
            refresh_attempt_packages_v1(reserved.refresh_fence)?
        } else {
            refresh_attempt_packages_v1(active.refresh_fence)?
        };

    let deriver_a_request = match authorization.unavailable_role {
        TenantRootManagedRestoreRoleV1::DeriverA => {
            CloudflareManagedRestoreForwardRefreshRequestOrNormalV1::Managed(
                CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1 {
                    public_state_b64u: authorization.public_state_b64u.clone(),
                    restore_capability_b64u: authorization.restore_capability_b64u.clone(),
                    refresh_context_b64u: refresh_context_b64u.clone(),
                    role_refresh_command_b64u: deriver_a_refresh_command_b64u,
                },
            )
        }
        TenantRootManagedRestoreRoleV1::DeriverB => {
            CloudflareManagedRestoreForwardRefreshRequestOrNormalV1::Normal(
                CloudflareDeriverTenantRootRefreshRequestV1 {
                    refresh_context_b64u: refresh_context_b64u.clone(),
                    role_refresh_command_b64u: deriver_a_refresh_command_b64u,
                },
            )
        }
    };
    let deriver_b_request = match authorization.unavailable_role {
        TenantRootManagedRestoreRoleV1::DeriverA => {
            CloudflareManagedRestoreForwardRefreshRequestOrNormalV1::Normal(
                CloudflareDeriverTenantRootRefreshRequestV1 {
                    refresh_context_b64u,
                    role_refresh_command_b64u: deriver_b_refresh_command_b64u,
                },
            )
        }
        TenantRootManagedRestoreRoleV1::DeriverB => {
            CloudflareManagedRestoreForwardRefreshRequestOrNormalV1::Managed(
                CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1 {
                    public_state_b64u: authorization.public_state_b64u,
                    restore_capability_b64u: authorization.restore_capability_b64u,
                    refresh_context_b64u,
                    role_refresh_command_b64u: deriver_b_refresh_command_b64u,
                },
            )
        }
    };
    let (deriver_a, deriver_b) = futures::join!(
        execute_cloudflare_router_managed_restore_forward_refresh_request_with_retry_v1(
            env,
            &runtime.bindings().deriver_a,
            deriver_a_request,
        ),
        execute_cloudflare_router_managed_restore_forward_refresh_request_with_retry_v1(
            env,
            &runtime.bindings().deriver_b,
            deriver_b_request,
        ),
    );
    finish_cloudflare_router_tenant_root_refresh_v1(
        env,
        runtime,
        &crate::encode_base64url_bytes_v1(authorization.identity_digest.as_bytes()),
        &authorization.custody_lineage.to_base64url(),
        deriver_a?,
        deriver_b?,
    )
    .await
}
use router_ab_core::{
    PublicDigest32, RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    RouterAbEd25519NormalSigningFinalizeRequestV2, RouterAbEd25519NormalSigningPrepareRequestV2,
    RouterAbProtocolErrorCode, RouterAbProtocolResult, TenantRootActivationReceiptBindingV1,
    TenantRootCommandTerminalReceiptV1, TenantRootCustodyLineageId, TenantRootIdentityDigestV1,
    TenantRootIdentityV1, TenantRootLifecycleReceiptDigestV1, TenantRootManagedRestoreRoleV1,
    TenantRootSignedManagedRestoreCapabilityV1, TenantRootSignedManagedRestoreRoleUnavailableV1,
    VerifiedTenantRootManagedRestoreCapabilityV1,
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
        let (identity_digest, custody_lineage) =
            match destination_bootstrap_request_scope_from_wire_v1(&parsed) {
                Ok(scope) => scope,
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
        return match execute_cloudflare_router_tenant_root_destination_bootstrap_call_v1(
            &env,
            identity_digest,
            custody_lineage,
            &parsed,
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
        let response: RouterAbProtocolResult<
            CloudflareTenantRootControlPlaneRegisterManifestResponseV1,
        > = post_service_json(
            &env,
            crate::TENANT_ROOT_CONTROL_PLANE_SERVICE_BINDING_V1,
            crate::cloudflare_tenant_root_control_plane_register_manifest_service_url(),
            "tenant-root control-plane register-manifest request",
            &parsed,
        )
        .await;
        return match response {
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
        let parsed: CloudflareRouterTenantRootRestoreRoleImportAcceptRequestV1 =
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
        return match execute_cloudflare_router_tenant_root_restore_role_import_accept_v1(
            &env, &runtime, parsed,
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
        return match execute_cloudflare_router_tenant_root_restore_role_import_key_v1(
            &env, &runtime, parsed,
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
        return match coordinate_cloudflare_router_tenant_root_restore_refresh_v1(
            &env, &runtime, parsed,
        )
        .await
        {
            Ok(CloudflareRouterTenantRootRestoreRefreshOutcomeV1::Completed(response)) => {
                Response::from_json(&response)
            }
            Ok(
                CloudflareRouterTenantRootRestoreRefreshOutcomeV1::AuthorizationExpiredBeforeCommands {
                    grant_digest_b64u,
                    operation_digest_b64u,
                    deriver_dispatch,
                },
            ) => Response::from_json(
                &CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforeCommands {
                    grant_digest_b64u,
                    operation_digest_b64u,
                    deriver_dispatch,
                },
            ),
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
            CloudflareRouterTenantRootRestoreCleanupRequestV1,
        >(&mut request, 64 * 1024)
        .await
        {
            Ok(parsed) => parsed,
            Err(err) => return cloudflare_protocol_error_response_v1(err),
        };
        return match coordinate_restore_cleanup_v1(&env, &runtime, parsed).await {
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
        return match coordinate_cloudflare_router_tenant_root_restore_activation_v1(
            &env, &runtime, parsed,
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
        let parsed: CloudflareRouterTenantRootManagedRestoreRequestV1 =
            match decode_bounded_json_request(
                &mut request,
                TENANT_ROOT_MANAGED_RESTORE_REQUEST_MAX_BYTES_V1,
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
        if let Err(err) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
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
                    match execute_cloudflare_router_tenant_root_creation_active_state_read_call_v1(
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
                    match execute_cloudflare_router_tenant_root_creation_active_state_read_call_v1(
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
    use super::replay_terminal_refresh_response_v1;
    use super::CloudflareRouterTenantRootRefreshRequestV1;
    use super::CloudflareRouterTenantRootRetirementEvidenceV1;
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
        assert_eq!(
            replay.activation_receipt_digest_b64u,
            persisted.activation_receipt_digest_b64u
        );
        assert_eq!(replay.lifecycle_revision, persisted.lifecycle_revision);
        assert!(matches!(
            replay.retirement,
            CloudflareRouterTenantRootRetirementEvidenceV1::Unverified
        ));
    }
}

#[cfg(all(test, feature = "strict-worker-router-entrypoint"))]
mod restore_activation_tests {
    use super::restore_role_cleanup_from_results_v1;
    use super::CloudflareRouterTenantRootRestoreActivationResponseV1;
    use super::CloudflareRouterTenantRootRestoreBootstrapCleanupV1;
    use super::CloudflareRouterTenantRootRestoreCleanupV1;
    use super::CloudflareRouterTenantRootRestoreOutstandingCleanupV1;
    use super::CloudflareRouterTenantRootRestoreRoleCleanupReceiptsV1;
    use super::CloudflareRouterTenantRootRestoreRoleCleanupV1;
    use super::CloudflareTenantRootCreateRoleV1;
    use std::collections::BTreeSet;

    #[test]
    fn one_role_failure_keeps_the_success_receipt_and_names_only_the_failed_role() {
        let cleanup = restore_role_cleanup_from_results_v1(Some("a-digest".to_owned()), None);
        assert_eq!(
            cleanup,
            CloudflareRouterTenantRootRestoreRoleCleanupV1::DeriverBIncomplete {
                deriver_a_receipt_digest_b64u: "a-digest".to_owned(),
                outstanding: CloudflareRouterTenantRootRestoreOutstandingCleanupV1 {
                    roles: vec![CloudflareTenantRootCreateRoleV1::DeriverB],
                    description: "tenant-root restore role cleanup remains outstanding".to_owned(),
                },
            }
        );
    }

    #[test]
    fn activation_response_serializes_the_exact_client_shape() {
        let response = CloudflareRouterTenantRootRestoreActivationResponseV1 {
            destination_lineage_id: "lineage".to_owned(),
            activated_epoch: 1,
            activation_receipt_b64u: "canonical-activation".to_owned(),
            activation_receipt_digest_b64u: "activation".to_owned(),
            forward_refresh_receipt_digest_b64u: "refresh".to_owned(),
            continuity_canary_receipt_digest_b64u: "canary".to_owned(),
            root_commitment_matches: true,
            cleanup: CloudflareRouterTenantRootRestoreCleanupV1 {
                bootstrap: CloudflareRouterTenantRootRestoreBootstrapCleanupV1::Destroyed {
                    receipt_digest_b64u: "bootstrap".to_owned(),
                },
                roles: CloudflareRouterTenantRootRestoreRoleCleanupV1::Complete {
                    receipts: CloudflareRouterTenantRootRestoreRoleCleanupReceiptsV1 {
                        deriver_a: "a".to_owned(),
                        deriver_b: "b".to_owned(),
                    },
                },
            },
        };
        let value = serde_json::to_value(response).expect("activation response serializes");
        let keys = value
            .as_object()
            .expect("activation response is an object")
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>();
        assert_eq!(
            keys,
            [
                "activated_epoch",
                "activation_receipt_b64u",
                "activation_receipt_digest_b64u",
                "cleanup",
                "continuity_canary_receipt_digest_b64u",
                "destination_lineage_id",
                "forward_refresh_receipt_digest_b64u",
                "root_commitment_matches",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect()
        );
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
