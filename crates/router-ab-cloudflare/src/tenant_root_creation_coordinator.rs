//! The Router's tenant-root creation ceremony, independent of its host.
//!
//! The Router drives one creation from a verified grant to an active root:
//! control-plane genesis, both issuer-signed role commands, Deriver A as the
//! initiating role (it drives Deriver B), the control plane's activation
//! receipt, the Router-owned creation state's activation, and finally each
//! Deriver's own activation. Every step is an exact, idempotent call, so a
//! retry of the same grant resumes rather than repeats.
//!
//! The Router's persisted activation receipt is the commit point. Once it
//! exists, a retry of the grant that opened the ceremony only finishes
//! delivering that receipt, however late: it does not re-authorize, so the
//! grant's freshness no longer gates it. Before the commit, a creation with
//! both roles installed resumes inside its ceremony window; a creation that
//! cannot finish is abandoned behind a fence in the Router's creation state,
//! which no activation can pass, and its installed roles are cleaned.

use std::collections::BTreeMap;

use router_ab_core::{
    TenantRootActivationReceiptTransitionV1, TenantRootCreationGrantV1,
    TenantRootRoleCleanupCommandV1, TenantRootSignedActivationReceiptV1, TwoPartyDeriverRole,
};

use crate::durable_object::tenant_root_creation::{
    tenant_root_creation_abandonment_call_v1, tenant_root_creation_cleanup_call_v1,
    tenant_root_creation_initial_activation_call_v1,
    tenant_root_creation_progress_read_call_v1, validate_creation_record,
    CloudflareTenantRootCreationInstallationCheckpointReadStateV1,
    CloudflareTenantRootCreationJournalOutcomeV1, CloudflareTenantRootCreationJournalRecordV1,
    CloudflareTenantRootCreationProgressV1, TenantRootCreationStateTransportV1,
};
use crate::tenant_root_control_plane::{
    create_tenant_root_response_v1, tenant_root_creation_grant_opened_ceremony_v1,
    CloudflareTenantRootControlPlaneCleanupCommandRequestV1,
    CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
    CloudflareTenantRootControlPlaneCreateTenantRootResponseV1,
    CloudflareTenantRootControlPlaneInitialActivationRequestV1,
    CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1,
    CloudflareTenantRootControlPlaneRoleV1, CloudflareTenantRootCreationStatusV1,
};
use crate::tenant_root_role_runtime::{
    CloudflareDeriverTenantRootCleanupRequestV1, CloudflareDeriverTenantRootCreateRoleShareRequestV1,
    CloudflareDeriverTenantRootCreationEvidenceRequestV1,
    CloudflareDeriverTenantRootCreateRoleShareResponseV1,
    CloudflareDeriverTenantRootInitialActivationRequestV1, CloudflareTenantRootCreateRoleV1,
};
use crate::tenant_root_transport::{
    tenant_root_control_plane_cleanup_command_call_v1,
    tenant_root_control_plane_create_tenant_root_call_v1,
    tenant_root_control_plane_initial_activation_call_v1,
    tenant_root_control_plane_role_creation_command_call_v1,
    tenant_root_deriver_cleanup_call_v1, tenant_root_deriver_create_role_share_call_v1,
    tenant_root_deriver_creation_evidence_call_v1,
    tenant_root_deriver_initial_activation_call_v1, TenantRootServiceTransportV1,
};
use crate::{
    decode_base64url_bytes_v1, encode_base64url_bytes_v1, RouterAbProtocolError,
    RouterAbProtocolErrorCode, RouterAbProtocolResult,
};

/// What the Router's creation coordinator needs from its host. The ceremony,
/// its partial-creation cleanup included, is the same code on every host.
#[allow(async_fn_in_trait)]
pub trait TenantRootRouterCreationHostV1:
    TenantRootServiceTransportV1 + TenantRootCreationStateTransportV1
{
    /// The control-plane issuer keys the Router trusts.
    fn trusted_issuer_keys(&self) -> RouterAbProtocolResult<BTreeMap<String, [u8; 32]>>;
}

/// Drives one tenant-root creation to an active root, or reports why it
/// cannot proceed.
pub async fn tenant_root_router_coordinate_creation_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    request: CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneCreateTenantRootResponseV1> {
    if let Some(committed) = recover_creation_from_router_state_v1(host, &request).await? {
        return Ok(committed);
    }
    let genesis = tenant_root_control_plane_create_tenant_root_call_v1(host, &request).await?;
    match &genesis.status {
        CloudflareTenantRootCreationStatusV1::Ready { .. } => {
            resume_tenant_root_initial_activation_v1(host, &genesis).await?;
            return Ok(genesis);
        }
        CloudflareTenantRootCreationStatusV1::Abandoned { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root creation was abandoned; a fresh grant is required",
            ));
        }
        CloudflareTenantRootCreationStatusV1::OneRoleInstalled { .. } => {
            let (identity_digest, custody_lineage) = genesis_scope_v1(&genesis)?;
            abandon_tenant_root_creation_v1(host, identity_digest, custody_lineage).await?;
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
    let deriver_a = tenant_root_control_plane_role_creation_command_call_v1(
        host,
        &command_request(CloudflareTenantRootControlPlaneRoleV1::DeriverA),
    )
    .await?;
    let deriver_b = tenant_root_control_plane_role_creation_command_call_v1(
        host,
        &command_request(CloudflareTenantRootControlPlaneRoleV1::DeriverB),
    )
    .await?;

    let completed = tenant_root_deriver_create_role_share_call_v1(
        host,
        TwoPartyDeriverRole::DeriverA,
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

    commit_and_deliver_initial_activation_v1(
        host,
        &genesis,
        CloudflareTenantRootControlPlaneInitialActivationRequestV1 {
            deriver_a_signed_installation_evidence_b64u,
            deriver_b_signed_installation_evidence_b64u,
            deriver_a_signed_managed_backup_b64u,
            deriver_b_signed_managed_backup_b64u,
            ecdsa_provider_canary_receipt_b64u,
            ed25519_provider_canary_receipt_b64u,
        },
    )
    .await?;

    let completed_state = tenant_root_control_plane_create_tenant_root_call_v1(host, &request).await?;
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

/// Serves a retry from the Router's own creation state, for the ceremony these
/// exact grant bytes opened, without asking the control plane to authorize the
/// grant again:
///
/// - a committed activation is re-delivered to both Derivers and the durable
///   response returned;
/// - an uncommitted creation that is already abandoned, or whose ceremony
///   window has closed, is abandoned and cleaned, and the retry is refused
///   with the reason.
///
/// Anything else returns `None` and the grant goes to the control plane.
async fn recover_creation_from_router_state_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    request: &CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
) -> RouterAbProtocolResult<Option<CloudflareTenantRootControlPlaneCreateTenantRootResponseV1>> {
    let grant_bytes =
        decode_base64url_bytes_v1("tenant-root creation grant", &request.creation_grant_b64u)?;
    let grant = TenantRootCreationGrantV1::decode_canonical_bytes(&grant_bytes).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("tenant-root creation grant is malformed: {error}"),
        )
    })?;
    let (identity_digest, custody_lineage) = grant.claimed_scope().map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("tenant-root creation grant identity is malformed: {error}"),
        )
    })?;
    let CloudflareTenantRootCreationProgressV1::Started {
        state,
        committed_activation_receipt_b64u,
        ceremony_open,
    } = tenant_root_creation_progress_read_call_v1(host, identity_digest, custody_lineage).await?
    else {
        return Ok(None);
    };
    let journal = validate_creation_record(
        CloudflareTenantRootCreationJournalRecordV1 {
            journal_b64u: state.journal_b64u.clone(),
            creation_capability_b64u: state.creation_capability_b64u.clone(),
        },
        host.creation_authority_id(identity_digest, custody_lineage)?,
        &host.trusted_issuer_keys()?,
    )?;
    if !tenant_root_creation_grant_opened_ceremony_v1(&grant_bytes, &journal.ceremony_context)? {
        return Ok(None);
    }
    let Some(receipt_b64u) = committed_activation_receipt_b64u else {
        let already_abandoned = state.abandonment.is_some();
        if !already_abandoned && ceremony_open {
            return Ok(None);
        }
        abandon_tenant_root_creation_v1(host, identity_digest, custody_lineage).await?;
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            if already_abandoned {
                "tenant-root creation was abandoned; a fresh grant is required"
            } else {
                "tenant-root creation expired before activation and was abandoned; a fresh grant is required"
            },
        ));
    };
    deliver_committed_initial_activation_v1(host, &receipt_b64u).await?;
    create_tenant_root_response_v1(
        identity_digest,
        custody_lineage,
        journal.response(CloudflareTenantRootCreationJournalOutcomeV1::Replay),
        &state,
    )
    .map(Some)
}

/// Delivers the Router's committed receipt to both Derivers. An active Deriver
/// replays its activation; a pending one activates. After a refresh the
/// committed receipt is no longer an initial creation and there is nothing
/// left to deliver.
async fn deliver_committed_initial_activation_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    receipt_b64u: &str,
) -> RouterAbProtocolResult<()> {
    let receipt_bytes =
        decode_base64url_bytes_v1("tenant-root committed activation receipt", receipt_b64u)?;
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("tenant-root committed activation receipt is malformed: {error}"),
            )
        })?;
    if receipt.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation {
        return Ok(());
    }
    let role_activation = CloudflareDeriverTenantRootInitialActivationRequestV1 {
        activation_receipt_b64u: receipt_b64u.to_owned(),
    };
    tenant_root_deriver_initial_activation_call_v1(
        host,
        TwoPartyDeriverRole::DeriverA,
        &role_activation,
    )
    .await?;
    tenant_root_deriver_initial_activation_call_v1(
        host,
        TwoPartyDeriverRole::DeriverB,
        &role_activation,
    )
    .await?;
    Ok(())
}

/// Abandons an uncommitted creation so a fresh grant can start again. The
/// Router's creation state writes the fence first, refusing it if an
/// activation is already committed; from then on no activation, commitment or
/// installation lands. Each installed role not yet cleaned is then cleaned.
/// Every step is idempotent, so a retry finishes an interrupted abandonment.
async fn abandon_tenant_root_creation_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    identity_digest: router_ab_core::TenantRootIdentityDigestV1,
    custody_lineage: router_ab_core::TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<()> {
    let fenced =
        tenant_root_creation_abandonment_call_v1(host, identity_digest, custody_lineage).await?;
    let cleaned = match tenant_root_creation_progress_read_call_v1(
        host,
        identity_digest,
        custody_lineage,
    )
    .await?
    {
        CloudflareTenantRootCreationProgressV1::Started { state, .. } => state
            .abandonment
            .map(|abandonment| abandonment.cleaned_roles)
            .unwrap_or_default(),
        CloudflareTenantRootCreationProgressV1::NotStarted => Vec::new(),
    };
    for role in fenced.installed_roles {
        if !cleaned.contains(&role) {
            clean_abandoned_role_v1(
                host,
                identity_digest,
                custody_lineage,
                CloudflareTenantRootControlPlaneRoleV1::from_protocol(role.to_protocol()),
            )
            .await?;
        }
    }
    Ok(())
}

/// Cleans one role an abandoned creation installed. The control plane issues
/// a cleanup command naming that role's pending row; the Router verifies it
/// before the Deriver removes the row, and checkpoints the Deriver's terminal
/// receipt.
async fn clean_abandoned_role_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    identity_digest: router_ab_core::TenantRootIdentityDigestV1,
    custody_lineage: router_ab_core::TenantRootCustodyLineageId,
    installed_role: CloudflareTenantRootControlPlaneRoleV1,
) -> RouterAbProtocolResult<()> {
    let cleanup = tenant_root_control_plane_cleanup_command_call_v1(
        host,
        &CloudflareTenantRootControlPlaneCleanupCommandRequestV1::PendingCreation {
            identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
            custody_lineage_b64u: encode_base64url_bytes_v1(custody_lineage.as_bytes()),
            role: installed_role,
        },
    )
    .await?;
    if cleanup.role != installed_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root cleanup command names a different installed role",
        ));
    }
    let command_bytes =
        decode_base64url_bytes_v1("tenant-root cleanup command", &cleanup.cleanup_command_b64u)?;
    let command = TenantRootRoleCleanupCommandV1::decode_canonical_bytes(&command_bytes)
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("tenant-root cleanup command was malformed: {error}"),
            )
        })?;
    let claimed_target = command.claimed_target();
    let expected_role = installed_role.to_protocol();
    let authority_id = host.creation_authority_id(
        claimed_target.identity_digest(),
        claimed_target.custody_lineage(),
    )?;
    let issuer_keys = host.trusted_issuer_keys()?;
    let issuer_key_id = command.issuer_key_id().to_owned();
    let issuer_key = issuer_keys.get(&issuer_key_id).ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root cleanup command issuer is not trusted by the Router",
        )
    })?;
    let verified_cleanup = command
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
    let cleaned = tenant_root_deriver_cleanup_call_v1(
        host,
        expected_role,
        &CloudflareDeriverTenantRootCleanupRequestV1 {
            cleanup_command_b64u: cleanup.cleanup_command_b64u,
        },
    )
    .await?;
    let cleanup_receipt = decode_base64url_bytes_v1(
        "tenant-root cleanup terminal receipt",
        cleaned.cleanup_receipt_b64u(),
    )?;
    tenant_root_creation_cleanup_call_v1(host, &verified_cleanup, &cleanup_receipt).await?;
    Ok(())
}

/// Resumes a creation whose roles are both installed but whose activation the
/// Router has not committed. Every artifact the control plane needs is already
/// durable at its owner: both installation evidences in the Router's
/// checkpoint, each role's signed managed backup and provider canary in that
/// Deriver's own store. If a concurrent retry committed meanwhile, that
/// receipt is delivered instead.
async fn resume_tenant_root_initial_activation_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    genesis: &CloudflareTenantRootControlPlaneCreateTenantRootResponseV1,
) -> RouterAbProtocolResult<()> {
    let (identity_digest, custody_lineage) = genesis_scope_v1(genesis)?;
    let CloudflareTenantRootCreationProgressV1::Started {
        state,
        committed_activation_receipt_b64u,
        ..
    } = tenant_root_creation_progress_read_call_v1(host, identity_digest, custody_lineage).await?
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root creation reads ready but has no started state",
        ));
    };
    if let Some(receipt_b64u) = committed_activation_receipt_b64u {
        return deliver_committed_initial_activation_v1(host, &receipt_b64u).await;
    }
    let CloudflareTenantRootCreationInstallationCheckpointReadStateV1::BothRolesReady {
        deriver_a_signed_evidence_b64u,
        deriver_b_signed_evidence_b64u,
        ..
    } = state.installation_checkpoint
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root creation reads ready but has no installation evidence",
        ));
    };
    let evidence_request = CloudflareDeriverTenantRootCreationEvidenceRequestV1 {
        identity_digest_b64u: genesis.identity_digest_b64u.clone(),
        custody_lineage_b64u: genesis.custody_lineage_b64u.clone(),
    };
    let deriver_a = tenant_root_deriver_creation_evidence_call_v1(
        host,
        TwoPartyDeriverRole::DeriverA,
        &evidence_request,
    )
    .await?;
    let deriver_b = tenant_root_deriver_creation_evidence_call_v1(
        host,
        TwoPartyDeriverRole::DeriverB,
        &evidence_request,
    )
    .await?;
    commit_and_deliver_initial_activation_v1(
        host,
        genesis,
        CloudflareTenantRootControlPlaneInitialActivationRequestV1 {
            deriver_a_signed_installation_evidence_b64u: deriver_a_signed_evidence_b64u,
            deriver_b_signed_installation_evidence_b64u: deriver_b_signed_evidence_b64u,
            deriver_a_signed_managed_backup_b64u: deriver_a.signed_managed_backup_b64u,
            deriver_b_signed_managed_backup_b64u: deriver_b.signed_managed_backup_b64u,
            ecdsa_provider_canary_receipt_b64u: deriver_a.provider_canary_receipt_b64u,
            ed25519_provider_canary_receipt_b64u: deriver_b.provider_canary_receipt_b64u,
        },
    )
    .await
}

/// Has the control plane issue the activation receipt over the six artifacts,
/// commits it in the Router's creation state and delivers it. The Router's
/// commit decides: if a concurrent retry committed a different receipt first,
/// this commit is refused and the committed receipt is delivered instead.
async fn commit_and_deliver_initial_activation_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    genesis: &CloudflareTenantRootControlPlaneCreateTenantRootResponseV1,
    activation: CloudflareTenantRootControlPlaneInitialActivationRequestV1,
) -> RouterAbProtocolResult<()> {
    let issued = tenant_root_control_plane_initial_activation_call_v1(host, &activation).await?;
    let receipt_bytes = decode_base64url_bytes_v1(
        "tenant-root initial activation receipt",
        &issued.activation_receipt_b64u,
    )?;
    if let Err(error) = tenant_root_creation_initial_activation_call_v1(host, &receipt_bytes).await {
        let (identity_digest, custody_lineage) = genesis_scope_v1(genesis)?;
        return match tenant_root_creation_progress_read_call_v1(
            host,
            identity_digest,
            custody_lineage,
        )
        .await?
        {
            CloudflareTenantRootCreationProgressV1::Started {
                committed_activation_receipt_b64u: Some(committed),
                ..
            } => deliver_committed_initial_activation_v1(host, &committed).await,
            _ => Err(error),
        };
    }
    deliver_committed_initial_activation_v1(host, &issued.activation_receipt_b64u).await
}

/// The identity digest and custody lineage a control-plane genesis response
/// names.
fn genesis_scope_v1(
    genesis: &CloudflareTenantRootControlPlaneCreateTenantRootResponseV1,
) -> RouterAbProtocolResult<(
    router_ab_core::TenantRootIdentityDigestV1,
    router_ab_core::TenantRootCustodyLineageId,
)> {
    let identity_digest_bytes = decode_base64url_bytes_v1(
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
    Ok((identity_digest, custody_lineage))
}
