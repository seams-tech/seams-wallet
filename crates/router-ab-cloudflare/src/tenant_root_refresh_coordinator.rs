//! The Router's tenant-root share refresh, independent of its host.
//!
//! The Router admits one refresh operation in its creation state, reserves an
//! attempt with both issuer-signed role commands, and runs both Derivers'
//! refreshes together: they meet at the Router's commitment and contribution
//! rendezvous and each checkpoints its prepared replacement share, backup and
//! canary. The control plane then signs the refresh-swap receipt.
//!
//! The Router's persisted refresh-swap receipt is the commit point. Nothing is
//! delivered before it, and afterwards every retry delivers that exact receipt
//! and never obtains another, however late. Each Deriver swaps only on the
//! Router's committed receipt. The previous epoch's shares are retired and
//! kept: erasure waits for the safe-retirement rule
//! (`docs/refactor-150-root-retirement-admission.md`), so retirement is
//! reported pending.
//!
//! The Router records each Deriver's delivery of the committed receipt. New
//! root work is admitted only on a fully delivered epoch: admission first
//! finishes a pending delivery, and answers a retryable error if a Deriver
//! cannot be reached, so no binding names an epoch a Deriver has not
//! activated.

use router_ab_core::{
    TenantRootActivationReceiptTransitionV1, TenantRootCustodyLineageId,
    TenantRootIdentityDigestV1, TwoPartyDeriverRole, VerifiedTenantRootSignedActivationReceiptV1,
};

use crate::durable_object::tenant_root_creation::{
    refresh_attempt_abandoned_error, tenant_root_creation_active_state_with_revision_read_call_v1,
    tenant_root_refresh_activation_call_v1, tenant_root_refresh_admission_call_v1,
    tenant_root_refresh_attempt_reservation_call_v1, tenant_root_record_delivery_call_v1,
    CloudflareTenantRootRefreshAdmissionOutcomeV1, CloudflareTenantRootRefreshFenceV1,
    CloudflareTenantRootRefreshTerminalOutcomeV1, CloudflareTenantRootRefreshTriggerV1,
    CloudflareVerifiedTenantRootActiveStateV1,
};
use crate::tenant_root_control_plane::{
    CloudflareTenantRootControlPlaneRefreshActivationRequestV1,
    CloudflareTenantRootControlPlaneRefreshCommandsRequestV1,
};
use crate::tenant_root_role_runtime::{
    CloudflareDeriverTenantRootInitialActivationRequestV1,
    CloudflareDeriverTenantRootRefreshActivationRequestV1,
    CloudflareDeriverTenantRootRefreshRequestV1, CloudflareDeriverTenantRootRefreshResponseV1,
};
use crate::tenant_root_transport::{
    tenant_root_control_plane_refresh_activation_call_v1,
    tenant_root_deriver_initial_activation_call_v1,
    tenant_root_control_plane_refresh_commands_call_v1,
    tenant_root_deriver_refresh_activation_call_v1, tenant_root_deriver_refresh_call_v1,
    TenantRootServiceTransportV1,
};
use crate::{
    decode_base64url_bytes_v1, encode_base64url_bytes_v1, RouterAbProtocolError,
    RouterAbProtocolErrorCode, RouterAbProtocolResult, TenantRootRouterCreationHostV1,
};

/// What happened to the previous epoch's retired shares. They are kept:
/// erasure waits for the safe-retirement rule, so work already admitted on the
/// old epoch can finish.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CloudflareRouterTenantRootRetirementEvidenceV1 {
    Pending,
}

/// A completed refresh: the committed receipt's digest and revision.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CloudflareRouterTenantRootRefreshResponseV1 {
    pub activation_receipt_digest_b64u: String,
    pub lifecycle_revision: u64,
    pub retirement: CloudflareRouterTenantRootRetirementEvidenceV1,
}

/// One refresh operation. A retry names the same operation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterTenantRootRefreshRequestV1 {
    pub operation_id: String,
    pub identity_digest_b64u: String,
    pub custody_lineage_b64u: String,
    pub expected_lifecycle_revision: u64,
    pub expires_at_ms: u64,
    pub trigger: CloudflareTenantRootRefreshTriggerV1,
}

/// The outcome of one refresh operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloudflareRouterTenantRootRefreshResultV1 {
    Completed(CloudflareRouterTenantRootRefreshResponseV1),
    /// The operation's attempt missed its ceremony window before the Router
    /// committed it, or its authorization expired while it held no attempt.
    /// A retry is refused; a new operation refreshes the root.
    Abandoned { abandoned_at_ms: u64 },
    Throttled { retry_at_ms: u64 },
    InProgress,
    RevisionMoved,
    AuthorizationExpired,
    NotDue { next_run_at_ms: u64 },
}

impl CloudflareRouterTenantRootRefreshResultV1 {
    /// The HTTP status and JSON body every host answers this outcome with.
    pub fn http_status_and_body(&self) -> (u16, serde_json::Value) {
        match self {
            Self::Completed(response) => (
                200,
                serde_json::to_value(response).unwrap_or(serde_json::Value::Null),
            ),
            Self::Throttled { retry_at_ms } => (
                429,
                serde_json::json!({
                    "code": "tenant_root_refresh_throttled",
                    "retry_at_ms": retry_at_ms,
                }),
            ),
            Self::Abandoned { abandoned_at_ms } => (
                409,
                serde_json::json!({
                    "code": "tenant_root_refresh_abandoned",
                    "abandoned_at_ms": abandoned_at_ms,
                }),
            ),
            Self::RevisionMoved => (409, serde_json::json!({ "code": "lifecycle_revision_moved" })),
            Self::AuthorizationExpired => {
                (409, serde_json::json!({ "code": "authorization_expired" }))
            }
            Self::NotDue { next_run_at_ms } => (
                409,
                serde_json::json!({
                    "code": "tenant_root_refresh_not_due",
                    "next_run_at_ms": next_run_at_ms,
                }),
            ),
            Self::InProgress => (
                409,
                serde_json::json!({ "code": "tenant_root_refresh_in_progress" }),
            ),
        }
    }
}

/// Drives one refresh operation to a committed, delivered receipt, or reports
/// why it cannot proceed.
pub async fn tenant_root_router_coordinate_refresh_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    request: CloudflareRouterTenantRootRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRefreshResultV1> {
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(
        decode_base64url_bytes_v1(
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
    let issuer_keys = host.trusted_issuer_keys()?;
    let admitted_revision = match tenant_root_refresh_admission_call_v1(
        host,
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
            let active = tenant_root_creation_active_state_with_revision_read_call_v1(
                host,
                &issuer_keys,
                identity_digest,
                custody_lineage,
            )
            .await?;
            // A delayed retry must never reinstall an epoch superseded by refresh or restore.
            let retirement = if active.lifecycle_revision == response.lifecycle_revision {
                tenant_root_router_deliver_pending_v1(host, &active).await?
            } else {
                CloudflareRouterTenantRootRetirementEvidenceV1::Pending
            };
            return Ok(CloudflareRouterTenantRootRefreshResultV1::Completed(
                CloudflareRouterTenantRootRefreshResponseV1 {
                    activation_receipt_digest_b64u: response.activation_receipt_digest_b64u,
                    lifecycle_revision: response.lifecycle_revision,
                    retirement,
                },
            ));
        }
        CloudflareTenantRootRefreshAdmissionOutcomeV1::Abandoned { abandoned_at_ms } => {
            return Ok(CloudflareRouterTenantRootRefreshResultV1::Abandoned { abandoned_at_ms });
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
    let active = tenant_root_creation_active_state_with_revision_read_call_v1(
        host,
        &issuer_keys,
        identity_digest,
        custody_lineage,
    )
    .await?;
    if active.lifecycle_revision != admitted_revision {
        let mut response = tenant_root_router_replay_terminal_refresh_v1(&active.refresh_fence)?
            .filter(|_| {
                matches!(&active.refresh_fence,
                    CloudflareTenantRootRefreshFenceV1::Terminal { attempt, .. }
                        if attempt.manual_operation_id.as_deref() == Some(request.operation_id.as_str()))
            })
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ConflictingPair,
                    "tenant-root manual refresh admission revision changed; retry the same operation",
                )
            })?;
        response.retirement = tenant_root_router_deliver_pending_v1(host, &active).await?;
        return Ok(CloudflareRouterTenantRootRefreshResultV1::Completed(response));
    }
    if matches!(
        &active.refresh_fence,
        CloudflareTenantRootRefreshFenceV1::Terminal { .. }
            | CloudflareTenantRootRefreshFenceV1::Abandoned { .. }
    ) {
        // Finish delivering the previous committed refresh before replacing
        // its attempt.
        tenant_root_router_deliver_pending_v1(host, &active).await?;
    }
    let (refresh_context_b64u, deriver_a_refresh_command_b64u, deriver_b_refresh_command_b64u) =
        match active.refresh_fence {
            CloudflareTenantRootRefreshFenceV1::Open
            | CloudflareTenantRootRefreshFenceV1::Terminal { .. }
            | CloudflareTenantRootRefreshFenceV1::Abandoned { .. } => {
                let issued = tenant_root_control_plane_refresh_commands_call_v1(
                    host,
                    &CloudflareTenantRootControlPlaneRefreshCommandsRequestV1 {
                        identity_digest_b64u: request.identity_digest_b64u.clone(),
                        custody_lineage_b64u: request.custody_lineage_b64u.clone(),
                    },
                )
                .await?;
                let reserved = tenant_root_refresh_attempt_reservation_call_v1(
                    host,
                    &issuer_keys,
                    identity_digest,
                    custody_lineage,
                    issued.refresh_context_b64u,
                    issued.deriver_a_refresh_command_b64u,
                    issued.deriver_b_refresh_command_b64u,
                    Some(request.operation_id.clone()),
                )
                .await?;
                tenant_root_router_refresh_attempt_packages_v1(reserved.refresh_fence)?
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
                tenant_root_router_refresh_attempt_packages_v1(fence)?
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
    // Both roles run together: each waits at the rendezvous for the other.
    let (deriver_a, deriver_b) = futures::join!(
        tenant_root_deriver_refresh_with_retry_v1(
            host,
            TwoPartyDeriverRole::DeriverA,
            &deriver_a_request,
        ),
        tenant_root_deriver_refresh_with_retry_v1(
            host,
            TwoPartyDeriverRole::DeriverB,
            &deriver_b_request,
        ),
    );
    let completed = tenant_root_router_finish_refresh_v1(
        host,
        identity_digest,
        custody_lineage,
        deriver_a?,
        deriver_b?,
    )
    .await?;
    Ok(CloudflareRouterTenantRootRefreshResultV1::Completed(completed))
}

/// Offers one root its scheduled refresh. A scheduled operation the Router has
/// admitted and not finished is resumed under its own id, so a restarted
/// scheduler continues the refresh it began; otherwise one starts under
/// `fresh_operation_id`, and the admission answers "not due" until the root's
/// schedule says otherwise. Each offer also abandons refresh work that can no
/// longer finish.
pub async fn tenant_root_router_scheduled_refresh_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    fresh_operation_id: String,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRefreshResultV1> {
    let active = tenant_root_creation_active_state_with_revision_read_call_v1(
        host,
        &host.trusted_issuer_keys()?,
        identity_digest,
        custody_lineage,
    )
    .await?;
    let (operation_id, expected_lifecycle_revision) = match &active.refresh_pending {
        Some(pending) if pending.trigger == CloudflareTenantRootRefreshTriggerV1::Scheduled => {
            (pending.operation_id.clone(), pending.lifecycle_revision)
        }
        _ => (fresh_operation_id, active.lifecycle_revision),
    };
    tenant_root_router_coordinate_refresh_v1(
        host,
        CloudflareRouterTenantRootRefreshRequestV1 {
            operation_id,
            identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
            custody_lineage_b64u: custody_lineage.to_base64url(),
            expected_lifecycle_revision,
            expires_at_ms: now_ms.saturating_add(router_ab_core::TENANT_ROOT_MAX_LIFETIME_MS_V1),
            trigger: CloudflareTenantRootRefreshTriggerV1::Scheduled,
        },
    )
    .await
}

/// Executes one role's refresh, retrying once. The Deriver's durable
/// admission makes the retry an exact resume or replay.
pub(crate) async fn tenant_root_deriver_refresh_with_retry_v1(
    transport: &impl TenantRootServiceTransportV1,
    role: TwoPartyDeriverRole,
    request: &CloudflareDeriverTenantRootRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    match tenant_root_deriver_refresh_call_v1(transport, role, request).await {
        Ok(response) => Ok(response),
        Err(_) => tenant_root_deriver_refresh_call_v1(transport, role, request).await,
    }
}

/// The attempt's context and both role commands, from a reserved or executed
/// fence.
pub(crate) fn tenant_root_router_refresh_attempt_packages_v1(
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
        CloudflareTenantRootRefreshFenceV1::Abandoned { .. } => {
            Err(refresh_attempt_abandoned_error())
        }
    }
}

/// The durable response of a completed attempt, or `None` while the attempt
/// is not terminal.
pub(crate) fn tenant_root_router_replay_terminal_refresh_v1(
    fence: &CloudflareTenantRootRefreshFenceV1,
) -> RouterAbProtocolResult<Option<CloudflareRouterTenantRootRefreshResponseV1>> {
    match fence {
        CloudflareTenantRootRefreshFenceV1::Terminal {
            outcome: CloudflareTenantRootRefreshTerminalOutcomeV1::Completed,
            response,
            ..
        } => Ok(Some(CloudflareRouterTenantRootRefreshResponseV1 {
            activation_receipt_digest_b64u: response.activation_receipt_digest_b64u.clone(),
            lifecycle_revision: response.lifecycle_revision,
            retirement: CloudflareRouterTenantRootRetirementEvidenceV1::Pending,
        })),
        _ => Ok(None),
    }
}

/// Delivers the Router's committed receipt to each Deriver still waiting
/// for it. Nothing is erased. Both deliveries are attempted, each
/// acknowledgement is recorded, and the first failure is returned.
pub(crate) async fn tenant_root_router_deliver_pending_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    active: &CloudflareVerifiedTenantRootActiveStateV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRetirementEvidenceV1> {
    let roles = match &active.delivery {
        Some(delivery) => delivery.pending_roles(),
        // A refresh-swap receipt committed before delivery was recorded is
        // delivered again; each Deriver replays a swap it already made.
        None if active.activation_receipt.transition()
            == TenantRootActivationReceiptTransitionV1::RefreshSwap =>
        {
            vec![TwoPartyDeriverRole::DeriverA, TwoPartyDeriverRole::DeriverB]
        }
        None => Vec::new(),
    };
    tenant_root_router_deliver_receipt_v1(host, &active.activation_receipt, &roles).await?;
    Ok(CloudflareRouterTenantRootRetirementEvidenceV1::Pending)
}

/// Delivers one committed receipt to these roles: a creation's initial
/// activation, or a refresh's swap. Each Deriver activates that exact
/// receipt, or replays the activation it already made; each acknowledgement
/// is recorded in the Router's creation state. Both deliveries are attempted,
/// and the first failure is returned.
pub(crate) async fn tenant_root_router_deliver_receipt_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    receipt: &VerifiedTenantRootSignedActivationReceiptV1,
    roles: &[TwoPartyDeriverRole],
) -> RouterAbProtocolResult<()> {
    let activation_receipt_b64u = encode_base64url_bytes_v1(receipt.canonical_bytes());
    let transition = receipt.transition();
    let deliver = |role: TwoPartyDeriverRole| {
        let activation_receipt_b64u = activation_receipt_b64u.clone();
        async move {
            if !roles.contains(&role) {
                return Ok(false);
            }
            match transition {
                TenantRootActivationReceiptTransitionV1::InitialCreation => {
                    tenant_root_deriver_initial_activation_call_v1(
                        host,
                        role,
                        &CloudflareDeriverTenantRootInitialActivationRequestV1 {
                            activation_receipt_b64u,
                        },
                    )
                    .await
                    .map(|_| true)
                }
                TenantRootActivationReceiptTransitionV1::RefreshSwap => {
                    tenant_root_deriver_refresh_activation_call_v1(
                        host,
                        role,
                        &CloudflareDeriverTenantRootRefreshActivationRequestV1 {
                            activation_receipt_b64u,
                        },
                    )
                    .await
                    .map(|_| true)
                }
            }
        }
    };
    let (deriver_a, deriver_b) = futures::join!(
        deliver(TwoPartyDeriverRole::DeriverA),
        deliver(TwoPartyDeriverRole::DeriverB),
    );
    let issuer_keys = host.trusted_issuer_keys()?;
    for (role, delivered) in [
        (TwoPartyDeriverRole::DeriverA, &deriver_a),
        (TwoPartyDeriverRole::DeriverB, &deriver_b),
    ] {
        if matches!(delivered, Ok(true)) {
            tenant_root_record_delivery_call_v1(
                host,
                &issuer_keys,
                receipt.identity_digest(),
                receipt.custody_lineage(),
                encode_base64url_bytes_v1(receipt.digest().as_bytes()),
                role,
            )
            .await?;
        }
    }
    deriver_a?;
    deriver_b?;
    Ok(())
}

/// The committed activation receipt new root work is admitted on.
///
/// A committed receipt, initial or refresh, that a Deriver has not yet
/// activated is delivered first. If a Deriver cannot be reached, the caller gets
/// `LifecycleTransitionInProgress` and can retry, so no custody binding is
/// issued for an epoch a Deriver has not activated.
pub async fn tenant_root_router_admission_receipt_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<VerifiedTenantRootSignedActivationReceiptV1> {
    let issuer_keys = host.trusted_issuer_keys()?;
    let active = tenant_root_creation_active_state_with_revision_read_call_v1(
        host,
        &issuer_keys,
        identity_digest,
        custody_lineage,
    )
    .await?;
    if active.pending_delivery().is_empty() {
        return Ok(active.activation_receipt);
    }
    tenant_root_router_deliver_pending_v1(host, &active)
        .await
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
                format!(
                    "tenant-root activation delivery is in progress; retry: {}",
                    error.message()
                ),
            )
        })?;
    let delivered = tenant_root_creation_active_state_with_revision_read_call_v1(
        host,
        &issuer_keys,
        identity_digest,
        custody_lineage,
    )
    .await?;
    if !delivered.pending_delivery().is_empty() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
            "tenant-root activation delivery is in progress; retry",
        ));
    }
    Ok(delivered.activation_receipt)
}

/// The Workers admission gate, over the Router's Service Bindings and its
/// creation Durable Object.
#[cfg(feature = "workers-rs")]
pub(crate) async fn execute_cloudflare_router_tenant_root_admission_receipt_v1(
    env: &worker::Env,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<VerifiedTenantRootSignedActivationReceiptV1> {
    let runtime = crate::CloudflareRouterWorkerRuntimeV1::from_worker_env(env)?;
    tenant_root_router_admission_receipt_v1(
        &crate::tenant_root_creation_coordinator::CloudflareRouterTenantRootCreationHostV1::new(
            env, &runtime,
        ),
        identity_digest,
        custody_lineage,
    )
    .await
}

/// Commits one prepared refresh at the Router, then delivers it. The control
/// plane signs the activation receipt, and the Router's creation state
/// persists it as the authoritative active state before any Deriver swaps.
/// That is the commit point: afterwards every retry delivers this exact
/// receipt, and no other receipt can be committed for the attempt. If a
/// concurrent retry committed first, its receipt is the one delivered.
pub(crate) async fn tenant_root_router_finish_refresh_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    deriver_a: CloudflareDeriverTenantRootRefreshResponseV1,
    deriver_b: CloudflareDeriverTenantRootRefreshResponseV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRefreshResponseV1> {
    let issued_activation = tenant_root_control_plane_refresh_activation_call_v1(
        host,
        &CloudflareTenantRootControlPlaneRefreshActivationRequestV1 {
            deriver_a_signed_installation_evidence_b64u: deriver_a.signed_installation_evidence_b64u,
            deriver_b_signed_installation_evidence_b64u: deriver_b.signed_installation_evidence_b64u,
            deriver_a_signed_managed_backup_b64u: deriver_a.signed_managed_backup_b64u,
            deriver_b_signed_managed_backup_b64u: deriver_b.signed_managed_backup_b64u,
            ecdsa_provider_canary_receipt_b64u: deriver_a.provider_canary_receipt_b64u,
            ed25519_provider_canary_receipt_b64u: deriver_b.provider_canary_receipt_b64u,
        },
    )
    .await?;
    let activation_receipt = decode_base64url_bytes_v1(
        "tenant-root refresh activation receipt",
        &issued_activation.activation_receipt_b64u,
    )?;
    let (committed_receipt_b64u, activation_receipt_digest_b64u, lifecycle_revision) =
        match tenant_root_refresh_activation_call_v1(host, &activation_receipt).await {
            Ok(activated) => (
                issued_activation.activation_receipt_b64u,
                activated.activation_receipt_digest_b64u,
                activated.lifecycle_revision,
            ),
            Err(error) => {
                let active = tenant_root_creation_active_state_with_revision_read_call_v1(
                    host,
                    &host.trusted_issuer_keys()?,
                    identity_digest,
                    custody_lineage,
                )
                .await?;
                match tenant_root_router_replay_terminal_refresh_v1(&active.refresh_fence)? {
                    Some(response) if response.lifecycle_revision == active.lifecycle_revision => (
                        encode_base64url_bytes_v1(active.activation_receipt.canonical_bytes()),
                        response.activation_receipt_digest_b64u,
                        response.lifecycle_revision,
                    ),
                    _ => return Err(error),
                }
            }
        };
    let issuer_keys = host.trusted_issuer_keys()?;
    let committed_receipt = router_ab_core::TenantRootSignedActivationReceiptV1::decode_canonical_bytes(
        &decode_base64url_bytes_v1("tenant-root committed refresh receipt", &committed_receipt_b64u)?,
    )
    .map_err(crate::map_root_share_to_protocol)?;
    let issuer_key = issuer_keys
        .get(committed_receipt.issuer_key_id())
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root committed refresh receipt issuer is not trusted",
            )
        })?;
    let committed_receipt = committed_receipt
        .verify_issuer_signature(issuer_key)
        .map_err(crate::map_root_share_to_protocol)?;
    tenant_root_router_deliver_receipt_v1(
        host,
        &committed_receipt,
        &[TwoPartyDeriverRole::DeriverA, TwoPartyDeriverRole::DeriverB],
    )
    .await?;
    let retirement = CloudflareRouterTenantRootRetirementEvidenceV1::Pending;
    Ok(CloudflareRouterTenantRootRefreshResponseV1 {
        activation_receipt_digest_b64u,
        lifecycle_revision,
        retirement,
    })
}
