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
//! Router's committed receipt. The previous epoch's shares are retired, and
//! the Router erases them once delivery is complete and the grace after the
//! swap has passed (`docs/refactor-150-refresh-retirement.md`). Each role
//! erases its retired share only once every admission on that epoch is
//! settled or cancelled; until then its retirement is reported pending and a
//! later pass tries again. The next refresh waits for both roles. A managed
//! restore does not wait: its swap carries any retirement still pending, and
//! later passes erase that epoch too.
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
    tenant_root_record_retirement_call_v1, tenant_root_refresh_activation_call_v1,
    tenant_root_refresh_admission_call_v1, tenant_root_refresh_attempt_reservation_call_v1,
    tenant_root_record_delivery_call_v1, CloudflareTenantRootRefreshActivationResponseV1,
    CloudflareTenantRootRefreshAdmissionOutcomeV1, CloudflareTenantRootRefreshFenceV1,
    CloudflareTenantRootRefreshTerminalOutcomeV1, CloudflareTenantRootRefreshTriggerV1,
    CloudflareTenantRootRetiredErasureV1, CloudflareTenantRootRoleRetirementV1,
    CloudflareTenantRootSwapAcknowledgementV1, CloudflareVerifiedTenantRootActiveStateV1,
};
use crate::tenant_root_control_plane::{
    CloudflareTenantRootControlPlaneCleanupCommandRequestV1,
    CloudflareTenantRootControlPlaneRefreshActivationRequestV1,
    CloudflareTenantRootControlPlaneRefreshCommandsRequestV1, CloudflareTenantRootControlPlaneRoleV1,
};
use crate::tenant_root_role_runtime::{
    CloudflareDeriverTenantRootCleanupRequestV1, CloudflareDeriverTenantRootCleanupResponseV1,
    CloudflareDeriverTenantRootInitialActivationRequestV1,
    CloudflareDeriverTenantRootRefreshActivationRequestV1,
    CloudflareDeriverTenantRootRefreshRequestV1, CloudflareDeriverTenantRootRefreshResponseV1,
};
use crate::tenant_root_transport::{
    tenant_root_control_plane_cleanup_command_call_v1,
    tenant_root_control_plane_refresh_activation_call_v1,
    tenant_root_deriver_cleanup_call_v1, tenant_root_deriver_initial_activation_call_v1,
    tenant_root_control_plane_refresh_commands_call_v1,
    tenant_root_deriver_refresh_activation_call_v1, tenant_root_deriver_refresh_call_v1,
    TenantRootServiceTransportV1,
};
use crate::{
    decode_base64url_bytes_v1, encode_base64url_bytes_v1, RouterAbProtocolError,
    RouterAbProtocolErrorCode, RouterAbProtocolResult, TenantRootRouterCreationHostV1,
};

/// What happened, at each role, to the epoch a refresh replaced, and to any
/// earlier epoch its swap carries.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterTenantRootRetirementEvidenceV1 {
    pub deriver_a: CloudflareRouterTenantRootRoleRetirementV1,
    pub deriver_b: CloudflareRouterTenantRootRoleRetirementV1,
    /// Earlier swaps' retirements this swap committed over before both roles
    /// had erased them, oldest first. Only a managed restore's swap carries
    /// any.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub carried: Vec<CloudflareRouterTenantRootCarriedRetirementEvidenceV1>,
}

/// An earlier swap's retirement that the latest swap carries, at each role.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterTenantRootCarriedRetirementEvidenceV1 {
    /// The earlier swap's committed receipt.
    pub activation_receipt_digest_b64u: String,
    pub retired_epoch: u64,
    pub deriver_a: CloudflareRouterTenantRootRoleRetirementV1,
    pub deriver_b: CloudflareRouterTenantRootRoleRetirementV1,
}

impl CloudflareRouterTenantRootRetirementEvidenceV1 {
    /// A later swap has since replaced the active epoch too.
    pub(crate) const fn superseded() -> Self {
        Self {
            deriver_a: CloudflareRouterTenantRootRoleRetirementV1::Superseded,
            deriver_b: CloudflareRouterTenantRootRoleRetirementV1::Superseded,
            carried: Vec::new(),
        }
    }
}

/// One role's retirement of a replaced epoch.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareRouterTenantRootRoleRetirementV1 {
    /// Erased there: the role's signed cleanup receipt, and the admissions
    /// its recovery cancelled on the epoch.
    Erased {
        cleanup_receipt_b64u: String,
        cancelled_admissions: u64,
    },
    /// Still kept there, and tried again by a later pass: why.
    Pending { reason: String },
    /// A later swap has replaced the active epoch since, and this retirement
    /// had finished at both roles: a refresh is admitted only then, and a
    /// managed restore that commits before carries it until it has.
    Superseded,
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
    /// The previous refresh's retired epoch is not yet erased at both roles.
    /// Every refresh call tries again first.
    RetirementPending {
        retirement: CloudflareRouterTenantRootRetirementEvidenceV1,
    },
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
            Self::RetirementPending { retirement } => (
                409,
                serde_json::json!({
                    "code": "tenant_root_retirement_pending",
                    "retirement": retirement,
                }),
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
    // Every call first moves on what the last swap left: its delivery, then
    // its retirement. So an exact retry of that refresh, the next refresh
    // and each scheduled offer all try again.
    let current = tenant_root_creation_active_state_with_revision_read_call_v1(
        host,
        &issuer_keys,
        identity_digest,
        custody_lineage,
    )
    .await?;
    // Boxed, like each pass below: a pass's future is large, and a host that
    // polls it on a thread's stack must not overflow.
    let (current, retirement) = Box::pin(tenant_root_router_retire_v1(host, current)).await?;
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
            let retirement = tenant_root_router_swap_retirement_evidence_v1(
                &current,
                retirement,
                &response.activation_receipt_digest_b64u,
            )?;
            return Ok(CloudflareRouterTenantRootRefreshResultV1::Completed(
                CloudflareRouterTenantRootRefreshResponseV1 {
                    activation_receipt_digest_b64u: response.activation_receipt_digest_b64u,
                    lifecycle_revision: response.lifecycle_revision,
                    retirement,
                },
            ));
        }
        CloudflareTenantRootRefreshAdmissionOutcomeV1::RetirementPending => {
            return Ok(CloudflareRouterTenantRootRefreshResultV1::RetirementPending {
                retirement: retirement.ok_or_else(missing_retirement_error)?,
            });
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
        let committed = tenant_root_router_replay_terminal_refresh_v1(&active.refresh_fence)?
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
        let retirement = tenant_root_router_swap_retirement_v1(
            host,
            active,
            &committed.activation_receipt_digest_b64u,
        )
        .await?;
        return Ok(CloudflareRouterTenantRootRefreshResultV1::Completed(
            CloudflareRouterTenantRootRefreshResponseV1 {
                activation_receipt_digest_b64u: committed.activation_receipt_digest_b64u,
                lifecycle_revision: committed.lifecycle_revision,
                retirement,
            },
        ));
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
) -> RouterAbProtocolResult<Option<CloudflareTenantRootRefreshActivationResponseV1>> {
    match fence {
        CloudflareTenantRootRefreshFenceV1::Terminal {
            outcome: CloudflareTenantRootRefreshTerminalOutcomeV1::Completed,
            response,
            ..
        } => Ok(Some(response.clone())),
        _ => Ok(None),
    }
}

fn missing_retirement_error() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        "tenant-root refresh swap has no retirement recorded with its delivery",
    )
}

/// Moves on what the committed receipt left: delivers it to any role still
/// waiting, then, for a refresh swap, erases the epoch it retired at each role
/// whose grace after the swap has passed, and each earlier epoch the swap
/// carries. A role that cannot erase one yet is reported pending, and a later
/// pass tries again. Returns the state after the pass, and the retirements at
/// each role, or `None` for a receipt that retired nothing. Only a failed
/// delivery is an error.
pub(crate) async fn tenant_root_router_retire_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    active: CloudflareVerifiedTenantRootActiveStateV1,
) -> RouterAbProtocolResult<(
    CloudflareVerifiedTenantRootActiveStateV1,
    Option<CloudflareRouterTenantRootRetirementEvidenceV1>,
)> {
    let identity_digest = active.activation_receipt.identity_digest();
    let custody_lineage = active.activation_receipt.custody_lineage();
    let issuer_keys = host.trusted_issuer_keys()?;
    let active = if active.pending_delivery().is_empty() && active.delivery.is_some() {
        active
    } else {
        tenant_root_router_deliver_pending_v1(host, &active).await?;
        tenant_root_creation_active_state_with_revision_read_call_v1(
            host,
            &issuer_keys,
            identity_digest,
            custody_lineage,
        )
        .await?
    };
    let Some(delivery) = active.delivery.clone() else {
        return Ok((active, None));
    };
    let Some(retirement) = delivery.retirement.clone() else {
        return Ok((active, None));
    };
    let receipt_digest_b64u = encode_base64url_bytes_v1(active.activation_receipt.digest().as_bytes());
    let now_ms = host.now_ms()?;
    let grace_ms = host.retirement_grace_ms()?;
    // One role's part of one retirement. Every cleanup at a role binds to its
    // current active row, the one its acknowledgement of the latest swap
    // names.
    let retire_role = |retired_epoch: u64,
                       recorded: Option<CloudflareTenantRootRoleRetirementV1>,
                       role: TwoPartyDeriverRole,
                       unacknowledged: String| {
        let active_revision = retirement.role(role).map(|latest| latest.active_revision);
        let receipt_digest_b64u = receipt_digest_b64u.clone();
        let issuer_keys = &issuer_keys;
        async move {
            let Some(recorded) = recorded else {
                return CloudflareRouterTenantRootRoleRetirementV1::Pending {
                    reason: unacknowledged,
                };
            };
            if let Some(erasure) = recorded.erasure {
                return erased_role_retirement_v1(erasure);
            }
            let kept_until_ms = recorded.swapped_at_ms.saturating_add(grace_ms);
            if now_ms < kept_until_ms {
                return CloudflareRouterTenantRootRoleRetirementV1::Pending {
                    reason: format!(
                        "epoch {retired_epoch} is kept here until {kept_until_ms}, the grace after the swap"
                    ),
                };
            }
            let Some(active_revision) = active_revision else {
                return CloudflareRouterTenantRootRoleRetirementV1::Pending {
                    reason: "the role has not acknowledged the latest swap".to_owned(),
                };
            };
            match erase_retired_epoch_v1(
                host,
                issuer_keys,
                identity_digest,
                custody_lineage,
                receipt_digest_b64u,
                role,
                retired_epoch,
                recorded.retired_revision,
                active_revision,
            )
            .await
            {
                Ok(erasure) => erased_role_retirement_v1(erasure),
                Err(error) => CloudflareRouterTenantRootRoleRetirementV1::Pending {
                    reason: error.message().to_owned(),
                },
            }
        }
    };
    let (deriver_a, deriver_b) = futures::join!(
        Box::pin(retire_role(
            retirement.retired_epoch,
            retirement.deriver_a.clone(),
            TwoPartyDeriverRole::DeriverA,
            "the role has not acknowledged the swap".to_owned(),
        )),
        Box::pin(retire_role(
            retirement.retired_epoch,
            retirement.deriver_b.clone(),
            TwoPartyDeriverRole::DeriverB,
            "the role has not acknowledged the swap".to_owned(),
        )),
    );
    let mut carried = Vec::with_capacity(delivery.carried_retirements.len());
    for entry in &delivery.carried_retirements {
        let retired_epoch = entry.retirement.retired_epoch;
        let unacknowledged =
            format!("the role never acknowledged the swap that retired epoch {retired_epoch}");
        let (deriver_a, deriver_b) = futures::join!(
            Box::pin(retire_role(
                retired_epoch,
                entry.retirement.deriver_a.clone(),
                TwoPartyDeriverRole::DeriverA,
                unacknowledged.clone(),
            )),
            Box::pin(retire_role(
                retired_epoch,
                entry.retirement.deriver_b.clone(),
                TwoPartyDeriverRole::DeriverB,
                unacknowledged,
            )),
        );
        carried.push(CloudflareRouterTenantRootCarriedRetirementEvidenceV1 {
            activation_receipt_digest_b64u: entry.activation_receipt_digest_b64u.clone(),
            retired_epoch,
            deriver_a,
            deriver_b,
        });
    }
    Ok((
        active,
        Some(CloudflareRouterTenantRootRetirementEvidenceV1 {
            deriver_a,
            deriver_b,
            carried,
        }),
    ))
}

/// Reports the retirement of the committed swap with this digest. While that
/// retirement is outstanding, as the latest swap's or a carried one, a pass
/// moves it on first; see [`tenant_root_router_swap_retirement_evidence_v1`].
/// Otherwise it has finished, and it is reported superseded without a pass,
/// so a later receipt's delivery never holds up an exact retry.
pub(crate) async fn tenant_root_router_swap_retirement_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    active: CloudflareVerifiedTenantRootActiveStateV1,
    activation_receipt_digest_b64u: &str,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRetirementEvidenceV1> {
    let outstanding = encode_base64url_bytes_v1(active.activation_receipt.digest().as_bytes())
        == activation_receipt_digest_b64u
        || active.delivery.as_ref().is_some_and(|delivery| {
            delivery.carried_retirements.iter().any(|carried| {
                carried.activation_receipt_digest_b64u == activation_receipt_digest_b64u
            })
        });
    if !outstanding {
        return Ok(CloudflareRouterTenantRootRetirementEvidenceV1::superseded());
    }
    let (after, evidence) = Box::pin(tenant_root_router_retire_v1(host, active)).await?;
    tenant_root_router_swap_retirement_evidence_v1(&after, evidence, activation_receipt_digest_b64u)
}

/// The retirement a pass found for the committed swap with this digest: the
/// latest swap's, with what it carries; an earlier swap's that the latest
/// carries; or superseded, once a later swap has replaced the epoch and this
/// retirement had finished.
pub(crate) fn tenant_root_router_swap_retirement_evidence_v1(
    after: &CloudflareVerifiedTenantRootActiveStateV1,
    evidence: Option<CloudflareRouterTenantRootRetirementEvidenceV1>,
    activation_receipt_digest_b64u: &str,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRetirementEvidenceV1> {
    if encode_base64url_bytes_v1(after.activation_receipt.digest().as_bytes())
        == activation_receipt_digest_b64u
    {
        return evidence.ok_or_else(missing_retirement_error);
    }
    Ok(evidence
        .and_then(|evidence| {
            evidence.carried.into_iter().find(|carried| {
                carried.activation_receipt_digest_b64u == activation_receipt_digest_b64u
            })
        })
        .map(|carried| CloudflareRouterTenantRootRetirementEvidenceV1 {
            deriver_a: carried.deriver_a,
            deriver_b: carried.deriver_b,
            carried: Vec::new(),
        })
        .unwrap_or_else(CloudflareRouterTenantRootRetirementEvidenceV1::superseded))
}

fn erased_role_retirement_v1(
    erasure: CloudflareTenantRootRetiredErasureV1,
) -> CloudflareRouterTenantRootRoleRetirementV1 {
    CloudflareRouterTenantRootRoleRetirementV1::Erased {
        cleanup_receipt_b64u: erasure.cleanup_receipt_b64u,
        cancelled_admissions: erasure.cancelled_admissions,
    }
}

/// Erases one role's retired epoch: the control plane signs a fresh cleanup
/// command for the retired row's recorded revision, bound to the role's
/// current active row, and the Deriver executes it. A Deriver that already
/// erased the epoch, and whose answer was lost, answers the fresh command
/// from its store. The first erasure recorded is the one reported.
#[allow(clippy::too_many_arguments)]
async fn erase_retired_epoch_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    issuer_keys: &std::collections::BTreeMap<String, [u8; 32]>,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    receipt_digest_b64u: String,
    role: TwoPartyDeriverRole,
    retired_epoch: u64,
    retired_revision: i64,
    active_revision: i64,
) -> RouterAbProtocolResult<CloudflareTenantRootRetiredErasureV1> {
    let command = tenant_root_control_plane_cleanup_command_call_v1(
        host,
        &CloudflareTenantRootControlPlaneCleanupCommandRequestV1::RetiredAfterRefresh {
            identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
            custody_lineage_b64u: custody_lineage.to_base64url(),
            role: CloudflareTenantRootControlPlaneRoleV1::from_protocol(role),
            retired_epoch,
            expected_retired_revision: retired_revision,
            expected_active_revision: active_revision,
        },
    )
    .await?;
    let CloudflareDeriverTenantRootCleanupResponseV1::RetiredDeleted {
        cleanup_receipt_b64u,
        cancelled_admissions,
        ..
    } = tenant_root_deriver_cleanup_call_v1(
        host,
        role,
        &CloudflareDeriverTenantRootCleanupRequestV1 {
            cleanup_command_b64u: command.cleanup_command_b64u,
        },
    )
    .await?
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root retired cleanup answered with another cleanup's response",
        ));
    };
    if cancelled_admissions > 0 {
        host.warn(&format!(
            "tenant-root retirement recovery cancelled {cancelled_admissions} admission(s) on epoch {retired_epoch} at {} for root {} lineage {}",
            match role {
                TwoPartyDeriverRole::DeriverA => "deriver_a",
                TwoPartyDeriverRole::DeriverB => "deriver_b",
            },
            encode_base64url_bytes_v1(identity_digest.as_bytes()),
            custody_lineage.to_base64url(),
        ));
    }
    let recorded = tenant_root_record_retirement_call_v1(
        host,
        issuer_keys,
        identity_digest,
        custody_lineage,
        receipt_digest_b64u,
        role,
        retired_epoch,
        CloudflareTenantRootRetiredErasureV1 {
            cleanup_receipt_b64u,
            cancelled_admissions,
        },
    )
    .await?;
    recorded
        .delivery
        .as_ref()
        .and_then(|delivery| delivery.retirement_of(retired_epoch))
        .and_then(|retirement| retirement.role(role))
        .and_then(|retirement| retirement.erasure.clone())
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
                "tenant-root retirement was erased but a later swap replaced its record; retry",
            )
        })
}

/// Delivers the Router's committed receipt to each Deriver still waiting
/// for it. Both deliveries are attempted, each acknowledgement is recorded,
/// and the first failure is returned.
pub(crate) async fn tenant_root_router_deliver_pending_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    active: &CloudflareVerifiedTenantRootActiveStateV1,
) -> RouterAbProtocolResult<()> {
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
    tenant_root_router_deliver_receipt_v1(host, &active.activation_receipt, &roles).await
}

/// Delivers one committed receipt to these roles: a creation's initial
/// activation, or a refresh's swap. Each Deriver activates that exact
/// receipt, or replays the activation it already made; each acknowledgement
/// is recorded in the Router's creation state, a swap's with the revisions
/// its retirement names. Both deliveries are attempted, and the first failure
/// is returned.
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
                return Ok(None);
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
                    .map(|_| Some(None))
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
                    .map(|swapped| {
                        Some(Some(CloudflareTenantRootSwapAcknowledgementV1 {
                            retired_epoch: swapped.retired_epoch,
                            retired_revision: swapped.retired_revision,
                            active_epoch: swapped.active_epoch,
                            active_revision: swapped.active_revision,
                        }))
                    })
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
        if let Ok(Some(swap)) = delivered {
            tenant_root_record_delivery_call_v1(
                host,
                &issuer_keys,
                receipt.identity_digest(),
                receipt.custody_lineage(),
                encode_base64url_bytes_v1(receipt.digest().as_bytes()),
                role,
                *swap,
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
    // The retired epoch is kept for the grace after the swap; the first pass
    // after it asks both roles to erase it.
    let delivered = tenant_root_creation_active_state_with_revision_read_call_v1(
        host,
        &issuer_keys,
        identity_digest,
        custody_lineage,
    )
    .await?;
    let retirement =
        tenant_root_router_swap_retirement_v1(host, delivered, &activation_receipt_digest_b64u)
            .await?;
    Ok(CloudflareRouterTenantRootRefreshResponseV1 {
        activation_receipt_digest_b64u,
        lifecycle_revision,
        retirement,
    })
}
