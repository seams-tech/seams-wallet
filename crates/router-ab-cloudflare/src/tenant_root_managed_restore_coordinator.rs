//! The Router's managed restore of one unavailable Deriver role, independent
//! of its host.
//!
//! The control plane has dually authorized the restore, and the Router's
//! creation state holds that authorization checkpointed. The Router has the
//! unavailable role stage its share from its managed backup, then runs the
//! mandatory forward refresh with both roles: the restored role refreshes from
//! its staged share, the healthy role from its active one. The forward refresh
//! commits like any refresh, and that commit completes the restore; from then
//! on an exact retry returns the restore's durable outcome, however far later
//! refreshes have moved the active state.
//!
//! A restore does not wait for the previous swap's retirement: the role it
//! restores may be the one that cannot erase. Its swap carries that
//! retirement, and later passes erase the epoch once each role can.

use std::collections::BTreeMap;

use router_ab_core::{
    TenantRootActivationReceiptBindingV1, TenantRootCustodyLineageId,
    TenantRootIdentityDigestV1, TenantRootIdentityV1, TenantRootLifecycleReceiptDigestV1,
    TenantRootManagedRestoreRoleV1, TenantRootSignedManagedRestoreCapabilityV1,
    TenantRootSignedManagedRestoreRoleUnavailableV1, TwoPartyDeriverRole,
    VerifiedTenantRootManagedRestoreCapabilityV1,
};

use crate::durable_object::tenant_root_creation::{
    managed_restore_superseded_error, tenant_root_managed_restore_completion_read_call_v1,
    tenant_root_refresh_attempt_reservation_call_v1, CloudflareTenantRootManagedRestoreFenceV1,
    CloudflareTenantRootRefreshFenceV1, CloudflareVerifiedTenantRootActiveStateV1,
};
use crate::tenant_root_control_plane::CloudflareTenantRootControlPlaneRefreshCommandsRequestV1;
use crate::tenant_root_refresh_coordinator::{
    tenant_root_deriver_refresh_with_retry_v1, tenant_root_router_finish_refresh_v1,
    tenant_root_router_refresh_attempt_packages_v1, tenant_root_router_swap_retirement_v1,
    CloudflareRouterTenantRootRefreshResponseV1,
};
use crate::tenant_root_role_runtime::{
    CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1,
    CloudflareDeriverTenantRootManagedRestoreRequestV1, CloudflareDeriverTenantRootRefreshRequestV1,
    CloudflareDeriverTenantRootRefreshResponseV1,
};
use crate::tenant_root_transport::{
    tenant_root_control_plane_refresh_commands_call_v1,
    tenant_root_deriver_managed_restore_call_v1,
    tenant_root_deriver_managed_restore_forward_refresh_call_v1,
};
use crate::{
    RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult,
    TenantRootRouterCreationHostV1,
};

/// One managed restore, as the operator submits it: the exact issuer-signed
/// role-unavailable state and the one-use restore capability.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterTenantRootManagedRestoreRequestV1 {
    /// Exact control-plane-signed public role-unavailable state.
    pub public_state_b64u: String,
    /// Exact control-plane-signed one-use restore capability.
    pub restore_capability_b64u: String,
}

pub const TENANT_ROOT_MANAGED_RESTORE_REQUEST_MAX_BYTES_V1: usize = 128 * 1024;

struct VerifiedTenantRootManagedRestoreRequestV1 {
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

/// Drives one managed restore to its committed forward refresh, or returns
/// the durable outcome of the restore it names once that has committed.
pub async fn tenant_root_router_coordinate_managed_restore_v1<
    Host: TenantRootRouterCreationHostV1,
>(
    host: &Host,
    request: CloudflareRouterTenantRootManagedRestoreRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRefreshResponseV1> {
    let (public_state_b64u, capability_b64u) = (
        request.public_state_b64u.clone(),
        request.restore_capability_b64u.clone(),
    );
    let issuer_keys = host.trusted_issuer_keys()?;
    let authorization = verify_tenant_root_managed_restore_request_v1(&issuer_keys, request)?;
    // A completed restore answers its exact retry with its durable outcome,
    // however far later refreshes have moved the active state.
    let (completed, active) = tenant_root_managed_restore_completion_read_call_v1(
        host,
        &issuer_keys,
        authorization.identity_digest,
        authorization.custody_lineage,
        public_state_b64u,
        capability_b64u,
    )
    .await?;
    if let Some(completed) = completed {
        // A pass moves the retirements on, as for any refresh, and reports
        // the restore's swap's.
        let retirement = tenant_root_router_swap_retirement_v1(
            host,
            active,
            &completed.activation_receipt_digest_b64u,
        )
        .await?;
        return Ok(CloudflareRouterTenantRootRefreshResponseV1 {
            activation_receipt_digest_b64u: completed.activation_receipt_digest_b64u,
            lifecycle_revision: completed.lifecycle_revision,
            retirement,
        });
    }
    require_managed_restore_checkpoint_artifacts_v1(&active, &authorization)?;
    require_managed_restore_checkpoint_current_state_v1(&active, &authorization)?;

    let must_start_forward_refresh = matches!(
        &active.refresh_fence,
        CloudflareTenantRootRefreshFenceV1::Open | CloudflareTenantRootRefreshFenceV1::Abandoned { .. }
    ) || matches!(
        &active.refresh_fence,
        CloudflareTenantRootRefreshFenceV1::Terminal { attempt, .. }
            if attempt.next_epoch == authorization.active_epoch
    );
    let restored_role = match authorization.unavailable_role {
        TenantRootManagedRestoreRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        TenantRootManagedRestoreRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    };
    // The restore's swap does not wait for a pending retirement: the role it
    // restores may be the one that cannot erase. Its commit carries every
    // retirement not yet erased at both roles, and later passes erase those
    // epochs once each role can.
    let unerased = active
        .delivery
        .as_ref()
        .map(|delivery| delivery.unerased_retired_epochs())
        .unwrap_or_default();
    if !unerased.is_empty() {
        host.warn(&format!(
            "tenant-root managed restore proceeds while the retirement of epoch(s) {unerased:?} is pending; its swap carries it until both roles erase them, for root {} lineage {}",
            crate::encode_base64url_bytes_v1(authorization.identity_digest.as_bytes()),
            authorization.custody_lineage.to_base64url(),
        ));
    }
    let (refresh_context_b64u, deriver_a_refresh_command_b64u, deriver_b_refresh_command_b64u) =
        if must_start_forward_refresh {
            tenant_root_deriver_managed_restore_call_v1(
                host,
                restored_role,
                &CloudflareDeriverTenantRootManagedRestoreRequestV1 {
                    public_state_b64u: authorization.public_state_b64u.clone(),
                    restore_capability_b64u: authorization.restore_capability_b64u.clone(),
                },
                authorization.capability.capability_digest(),
            )
            .await?;
            let issued = tenant_root_control_plane_refresh_commands_call_v1(
                host,
                &CloudflareTenantRootControlPlaneRefreshCommandsRequestV1 {
                    identity_digest_b64u: crate::encode_base64url_bytes_v1(
                        authorization.identity_digest.as_bytes(),
                    ),
                    custody_lineage_b64u: authorization.custody_lineage.to_base64url(),
                },
            )
            .await?;
            let reserved = tenant_root_refresh_attempt_reservation_call_v1(
                host,
                &issuer_keys,
                authorization.identity_digest,
                authorization.custody_lineage,
                issued.refresh_context_b64u,
                issued.deriver_a_refresh_command_b64u,
                issued.deriver_b_refresh_command_b64u,
                None,
            )
            .await?;
            tenant_root_router_refresh_attempt_packages_v1(reserved.refresh_fence)?
        } else {
            tenant_root_router_refresh_attempt_packages_v1(active.refresh_fence)?
        };

    // Both roles run together: each waits at the rendezvous for the other.
    let (deriver_a, deriver_b) = futures::join!(
        managed_restore_forward_refresh_v1(
            host,
            &authorization,
            TwoPartyDeriverRole::DeriverA,
            restored_role,
            refresh_context_b64u.clone(),
            deriver_a_refresh_command_b64u,
        ),
        managed_restore_forward_refresh_v1(
            host,
            &authorization,
            TwoPartyDeriverRole::DeriverB,
            restored_role,
            refresh_context_b64u,
            deriver_b_refresh_command_b64u,
        ),
    );
    tenant_root_router_finish_refresh_v1(
        host,
        authorization.identity_digest,
        authorization.custody_lineage,
        deriver_a?,
        deriver_b?,
    )
    .await
}

/// One role's part of the forward refresh, retried once: the restored role
/// refreshes from its staged share, the healthy one from its active share.
async fn managed_restore_forward_refresh_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    authorization: &VerifiedTenantRootManagedRestoreRequestV1,
    role: TwoPartyDeriverRole,
    restored_role: TwoPartyDeriverRole,
    refresh_context_b64u: String,
    role_refresh_command_b64u: String,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    if role != restored_role {
        return tenant_root_deriver_refresh_with_retry_v1(
            host,
            role,
            &CloudflareDeriverTenantRootRefreshRequestV1 {
                refresh_context_b64u,
                role_refresh_command_b64u,
            },
        )
        .await;
    }
    let request = CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1 {
        public_state_b64u: authorization.public_state_b64u.clone(),
        restore_capability_b64u: authorization.restore_capability_b64u.clone(),
        refresh_context_b64u,
        role_refresh_command_b64u,
    };
    match tenant_root_deriver_managed_restore_forward_refresh_call_v1(host, role, &request).await {
        Ok(response) => Ok(response),
        Err(_) => {
            tenant_root_deriver_managed_restore_forward_refresh_call_v1(host, role, &request).await
        }
    }
}

pub(crate) fn decode_exact_tenant_root_wire_v1(
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

pub(crate) fn managed_restore_derivation_error_v1(
    field: &'static str,
    error: router_ab_core::RouterAbDerivationError,
) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!("{field} was refused: {error}"),
    )
}

fn verify_tenant_root_managed_restore_request_v1(
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    request: CloudflareRouterTenantRootManagedRestoreRequestV1,
) -> RouterAbProtocolResult<VerifiedTenantRootManagedRestoreRequestV1> {
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
    let issuer_key_id = signed_public_state.issuer_key_id().to_owned();
    let issuer_key = issuer_keys
        .get(&issuer_key_id)
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
    Ok(VerifiedTenantRootManagedRestoreRequestV1 {
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

fn require_managed_restore_checkpoint_artifacts_v1(
    active: &CloudflareVerifiedTenantRootActiveStateV1,
    authorization: &VerifiedTenantRootManagedRestoreRequestV1,
) -> RouterAbProtocolResult<()> {
    let identity_digest_b64u =
        crate::encode_base64url_bytes_v1(authorization.identity_digest.as_bytes());
    let custody_lineage_b64u = authorization.custody_lineage.to_base64url();
    let activation_receipt_digest_b64u =
        crate::encode_base64url_bytes_v1(authorization.active_activation_receipt_digest.as_bytes());

    if matches!(
        &active.managed_restore_fence,
        CloudflareTenantRootManagedRestoreFenceV1::Superseded { .. }
    ) {
        return Err(managed_restore_superseded_error());
    }
    let CloudflareTenantRootManagedRestoreFenceV1::Terminal {
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

fn require_managed_restore_checkpoint_current_state_v1(
    active: &CloudflareVerifiedTenantRootActiveStateV1,
    authorization: &VerifiedTenantRootManagedRestoreRequestV1,
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
    if matches!(
        &active.managed_restore_fence,
        CloudflareTenantRootManagedRestoreFenceV1::Superseded { .. }
    ) {
        return Err(managed_restore_superseded_error());
    }
    let CloudflareTenantRootManagedRestoreFenceV1::Terminal {
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
