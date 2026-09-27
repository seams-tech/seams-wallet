//! Restore into a new deployment, as the Router runs it on any host.
//!
//! The destination's bootstrap authority, manifest registration, the role
//! imports, the restore refresh to a promoted (dormant) root, its operator
//! activation and cleanup. The Router reaches its creation state, the control
//! plane and both Derivers through the host's transports, so a Cloudflare
//! Router and a VM Router run this same code.

use std::collections::BTreeMap;

use router_ab_core::{
    verify_tenant_root_creation_evidence_v1, TenantRootCeremonyContextV1,
    TenantRootControlPlaneAuthorityIdV1, TenantRootLifecycleReceiptDigestV1,
    TenantRootRefreshContributionAadV1, TenantRootRestoreRefreshRoleCommandV1,
    TenantRootRestoreRoleImportCommandV1, TenantRootSignedRefreshCommitmentV1,
    TenantRootSignedRefreshContributionV1, TenantRootSignedShareInstallationEvidenceV1,
    TwoPartyDeriverRole, VerifiedTenantRootRefreshCommitmentPairV1,
    VerifiedTenantRootRefreshCommitmentV1, VerifiedTenantRootRestoreRefreshRoleCommandV1,
    VerifiedTenantRootSignedRefreshContributionV1,
    VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
};
use sha2::{Digest, Sha256};

use crate::durable_object::tenant_root_creation::{
    destination_bootstrap_request_scope_from_wire_v1, tenant_root_destination_bootstrap_call_v1,
    tenant_root_restore_initial_activation_call_v1, tenant_root_restore_refresh_checkpoint_call_v1,
    CloudflareTenantRootDestinationBootstrapRequestV1,
    CloudflareTenantRootDestinationBootstrapResponseV1,
    CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
    CloudflareTenantRootRestoreRefreshCheckpointResponseV1,
    CloudflareTenantRootRestoreRefreshCheckpointStateV1,
    CloudflareTenantRootRestoreRefreshCheckpointV1, CloudflareTenantRootRestoreRefreshCommandsV1,
    CloudflareTenantRootRestoreRefreshDeriverDispatchV1,
    CloudflareTenantRootCreationInstallationRoleV1, CloudflareTenantRootRestoreRefreshRolePromotionV1,
};
use crate::tenant_root_control_plane::{
    CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1,
    CloudflareTenantRootControlPlaneRegisterManifestRequestV1,
    CloudflareTenantRootControlPlaneRegisterManifestResponseV1,
    CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1,
    CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1,
    CloudflareTenantRootControlPlaneRestoreRefreshCommandsResponseV1,
    CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1,
    CloudflareTenantRootControlPlaneRestoreRoleImportKeyResponseV1,
};
use crate::tenant_root_creation_coordinator::TenantRootRouterCreationHostV1;
use crate::tenant_root_managed_restore_coordinator::{
    decode_exact_tenant_root_wire_v1, managed_restore_derivation_error_v1,
};
use crate::tenant_root_restore_refresh_runtime::{
    CloudflareDeriverTenantRootRestoreRefreshRequestV1,
    CloudflareDeriverTenantRootRestoreRefreshResponseV1,
};
use crate::tenant_root_role_runtime::{
    CloudflareDeriverTenantRootInitialActivationRequestV1,
    CloudflareDeriverTenantRootInitialActivationResponseV1,
    CloudflareDeriverTenantRootRestoreRoleImportAcceptRequestV1,
    CloudflareDeriverTenantRootRestoreRoleImportAcceptResponseV1,
    CloudflareDeriverTenantRootRestoreRoleImportKeyRequestV1,
    CloudflareDeriverTenantRootRestoreRoleImportKeyResponseV1, CloudflareTenantRootCreateRoleV1,
};
use crate::tenant_root_transport::{
    tenant_root_deriver_initial_activation_call_v1, TenantRootCallBoundsV1,
    TenantRootServiceTargetV1,
};
use crate::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};

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

#[derive(Debug)]
struct VerifiedCloudflareRouterTenantRootRestoreRefreshCommitmentV1 {
    wire_b64u: String,
    commitment: VerifiedTenantRootRefreshCommitmentV1,
}

#[derive(Debug)]
struct VerifiedCloudflareRouterTenantRootRestoreRefreshEvidenceV1 {
    wire_b64u: String,
    evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
}

#[derive(Debug, serde::Serialize)]
pub struct CloudflareRouterTenantRootRestoreRefreshResponseV1 {
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CloudflareRouterTenantRootRestoreBootstrapCleanupV1 {
    Destroyed {
        receipt_digest_b64u: String,
    },
    Outstanding {
        outstanding: CloudflareRouterTenantRootRestoreOutstandingCleanupV1,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterTenantRootRestoreOutstandingCleanupV1 {
    roles: Vec<CloudflareTenantRootCreateRoleV1>,
    description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterTenantRootRestoreRoleCleanupReceiptsV1 {
    deriver_a: String,
    deriver_b: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareRouterTenantRootRestoreRoleCleanupV1 {
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterTenantRootRestoreCleanupV1 {
    bootstrap: CloudflareRouterTenantRootRestoreBootstrapCleanupV1,
    roles: CloudflareRouterTenantRootRestoreRoleCleanupV1,
}

#[derive(Debug, serde::Serialize)]
pub struct CloudflareRouterTenantRootRestoreActivationResponseV1 {
    activation_receipt_b64u: String,
    destination_lineage_id: String,
    activated_epoch: u64,
    activation_receipt_digest_b64u: String,
    forward_refresh_receipt_digest_b64u: String,
    continuity_canary_receipt_digest_b64u: String,
    root_commitment_matches: bool,
    cleanup: CloudflareRouterTenantRootRestoreCleanupV1,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareRouterTenantRootRestoreCleanupRequestV1 {
    PreActivation {
        cleanup_grant_b64u: String,
    },
    PostActivation {
        activation_receipt_b64u: String,
        cleanup: CloudflareRouterTenantRootRestoreCleanupV1,
    },
}

#[derive(serde::Serialize)]
#[serde(untagged)]
pub enum CloudflareRouterTenantRootRestoreCleanupResponseV1 {
    PreActivation(CloudflareRouterTenantRootRestoreRoleCleanupV1),
    PostActivation(CloudflareRouterTenantRootRestoreCleanupV1),
}

pub enum CloudflareRouterTenantRootRestoreRefreshOutcomeV1 {
    Completed(CloudflareRouterTenantRootRestoreRefreshResponseV1),
    AuthorizationExpiredBeforeCommands {
        grant_digest_b64u: String,
        operation_digest_b64u: String,
        deriver_dispatch: CloudflareTenantRootRestoreRefreshDeriverDispatchV1,
    },
}

impl CloudflareRouterTenantRootRestoreRefreshOutcomeV1 {
    /// The body both hosts answer the restore-refresh route with: the
    /// completed refresh, or the durable record that its authorization
    /// expired before commands were issued.
    pub fn into_response_body(self) -> RouterAbProtocolResult<serde_json::Value> {
        let encoded = match self {
            Self::Completed(response) => serde_json::to_value(&response),
            Self::AuthorizationExpiredBeforeCommands {
                grant_digest_b64u,
                operation_digest_b64u,
                deriver_dispatch,
            } => serde_json::to_value(
                &CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforeCommands {
                    grant_digest_b64u,
                    operation_digest_b64u,
                    deriver_dispatch,
                },
            ),
        };
        encoded.map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("tenant-root restore-refresh response encoding failed: {error}"),
            )
        })
    }
}

enum RestoreRefreshCommandValidationV1 {
    Fresh { now_ms: u64 },
    Persisted,
}

fn restore_refresh_derivation_error_v1(
    field: &'static str,
    error: router_ab_core::RouterAbDerivationError,
) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!("{field} was refused: {error}"),
    )
}

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

fn verify_cloudflare_router_tenant_root_restore_refresh_commands_v1(
    issuer_keys: &BTreeMap<String, [u8; 32]>,
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
    let issuer_key = issuer_keys
        .get(&response.issuer_key_id)
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

fn restore_refresh_commands_from_checkpoint_v1(
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    commands: CloudflareTenantRootRestoreRefreshCommandsV1,
) -> RouterAbProtocolResult<VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1> {
    verify_cloudflare_router_tenant_root_restore_refresh_commands_v1(
        issuer_keys,
        CloudflareTenantRootControlPlaneRestoreRefreshCommandsResponseV1 {
            refresh_context_b64u: commands.refresh_context_b64u,
            deriver_a_refresh_command_b64u: commands.deriver_a_refresh_command_b64u,
            deriver_b_refresh_command_b64u: commands.deriver_b_refresh_command_b64u,
            issuer_key_id: commands.issuer_key_id,
        },
        RestoreRefreshCommandValidationV1::Persisted,
    )
}

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

fn restore_refresh_command_object_for_role_v1(
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    role: TwoPartyDeriverRole,
) -> &VerifiedTenantRootRestoreRefreshRoleCommandV1 {
    match role {
        TwoPartyDeriverRole::DeriverA => &commands.deriver_a_command,
        TwoPartyDeriverRole::DeriverB => &commands.deriver_b_command,
    }
}

async fn restore_refresh_deriver_call_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    role: TwoPartyDeriverRole,
    request: &CloudflareDeriverTenantRootRestoreRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRefreshResponseV1> {
    let response: CloudflareDeriverTenantRootRestoreRefreshResponseV1 = host
        .post_private_json(
            TenantRootServiceTargetV1::Deriver(role),
            crate::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH,
            "tenant-root restore-refresh phase request",
            request,
            None,
        )
        .await?;
    if response.role() != CloudflareTenantRootCreateRoleV1::from_protocol(role) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root restore-refresh response names the wrong role",
        ));
    }
    Ok(response)
}

/// One restore-refresh phase at one Deriver, retried once: every phase
/// replays its durable result, so a lost reply is recovered by asking again.
async fn restore_refresh_deriver_call_with_retry_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    role: TwoPartyDeriverRole,
    request: &CloudflareDeriverTenantRootRestoreRefreshRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRefreshResponseV1> {
    match restore_refresh_deriver_call_v1(host, role, request).await {
        Ok(response) => Ok(response),
        Err(_) => restore_refresh_deriver_call_v1(host, role, request).await,
    }
}

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

const fn restore_refresh_installation_role_v1(
    role: TwoPartyDeriverRole,
) -> CloudflareTenantRootCreationInstallationRoleV1 {
    match role {
        TwoPartyDeriverRole::DeriverA => CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
        TwoPartyDeriverRole::DeriverB => CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
    }
}

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

async fn execute_restore_refresh_checkpoint_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    request: &CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRestoreRefreshCheckpointV1> {
    let response = tenant_root_restore_refresh_checkpoint_call_v1(host, request).await?;
    restore_refresh_checkpoint_from_response_v1(response)
}

fn restore_refresh_expected_authority_v1(
    host: &impl TenantRootRouterCreationHostV1,
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
    host.creation_authority_id(
        commands.context.identity_digest(),
        commands.context.custody_lineage(),
    )
}

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

async fn promote_cloudflare_router_tenant_root_restore_refresh_v1<
    Host: TenantRootRouterCreationHostV1,
>(
    host: &Host,
    request: &CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1,
    checkpoint: &CloudflareTenantRootRestoreRefreshCheckpointV1,
    commands: &VerifiedCloudflareRouterTenantRootRestoreRefreshCommandsV1,
    deriver_a_evidence_b64u: &str,
    deriver_b_evidence_b64u: &str,
) -> RouterAbProtocolResult<()> {
    let expected_authority_id = restore_refresh_expected_authority_v1(host, commands)?;
    let completed_read = tenant_root_restore_refresh_checkpoint_call_v1(
        host,
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
        restore_refresh_deriver_call_with_retry_v1(
            host,
            TwoPartyDeriverRole::DeriverA,
            &deriver_a_request,
        ),
        restore_refresh_deriver_call_with_retry_v1(
            host,
            TwoPartyDeriverRole::DeriverB,
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
        host,
        &CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitPromoted {
            restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
            deriver_a_promotion,
            deriver_b_promotion,
        },
    )
    .await?;
    let promoted_read = tenant_root_restore_refresh_checkpoint_call_v1(
        host,
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

fn restore_role_cleanup_digest_from_result_v1(
    role: CloudflareTenantRootCreateRoleV1,
    result: &RouterAbProtocolResult<CloudflareDeriverTenantRootInitialActivationResponseV1>,
) -> Option<String> {
    result
        .as_ref()
        .ok()
        .and_then(|response| restore_role_cleanup_digest_v1(role, response).ok())
}

fn restore_cleanup_outstanding_v1(
    roles: Vec<CloudflareTenantRootCreateRoleV1>,
) -> CloudflareRouterTenantRootRestoreOutstandingCleanupV1 {
    CloudflareRouterTenantRootRestoreOutstandingCleanupV1 {
        roles,
        description: "tenant-root restore role cleanup remains outstanding".to_owned(),
    }
}

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

async fn cleanup_restore_role_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    role: TwoPartyDeriverRole,
    request: &CloudflareRouterTenantRootRestoreCleanupRequestV1,
) -> RouterAbProtocolResult<String> {
    use crate::tenant_root_role_runtime::{
        CloudflareDeriverTenantRootPreactivationCleanupRequestV1,
        CloudflareDeriverTenantRootPreactivationCleanupResponseV1,
        CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1,
        CloudflareDeriverTenantRootRestoreSessionCleanupResponseV1,
    };
    let (responded_role, digest) = match request {
        CloudflareRouterTenantRootRestoreCleanupRequestV1::PreActivation { cleanup_grant_b64u } => {
            let response: CloudflareDeriverTenantRootPreactivationCleanupResponseV1 = host
                .post_private_json(
                    TenantRootServiceTargetV1::Deriver(role),
                    crate::CLOUDFLARE_DERIVER_TENANT_ROOT_PREACTIVATION_CLEANUP_PRIVATE_REQUEST_PATH,
                    "restore preactivation cleanup",
                    &CloudflareDeriverTenantRootPreactivationCleanupRequestV1 {
                        cleanup_grant_b64u: cleanup_grant_b64u.clone(),
                    },
                    None,
                )
                .await?;
            (response.role, response.cleanup_receipt_digest_b64u)
        }
        CloudflareRouterTenantRootRestoreCleanupRequestV1::PostActivation {
            activation_receipt_b64u,
            ..
        } => {
            let response: CloudflareDeriverTenantRootRestoreSessionCleanupResponseV1 = host
                .post_private_json(
                    TenantRootServiceTargetV1::Deriver(role),
                    crate::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_CLEANUP_PRIVATE_REQUEST_PATH,
                    "restore postactivation cleanup",
                    &CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1 {
                        activation_receipt_b64u: activation_receipt_b64u.clone(),
                    },
                    None,
                )
                .await?;
            (response.role, response.cleanup_receipt_digest_b64u)
        }
    };
    if responded_role != CloudflareTenantRootCreateRoleV1::from_protocol(role) {
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

/// Cleans up a restore at both Derivers: before activation under an operator
/// cleanup grant, or after it under the activation receipt.
pub async fn tenant_root_router_restore_cleanup_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
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
            let keys = host.grant_authority_verifying_keys()?;
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
                .require_fresh(host.now_ms()?)
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
            let persisted = tenant_root_restore_initial_activation_call_v1(host, &bytes).await?;
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
        a = cleanup_restore_role_v1(host, TwoPartyDeriverRole::DeriverA, &request)
            .await
            .ok();
    }
    if b.is_none() {
        b = cleanup_restore_role_v1(host, TwoPartyDeriverRole::DeriverB, &request)
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

/// Activates a restored root: finishes its restore refresh, obtains the
/// initial-creation receipt, commits it in the creation state (consuming the
/// bootstrap authority), and delivers it to both Derivers.
pub async fn tenant_root_router_restore_activation_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    request: CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRestoreActivationResponseV1> {
    match tenant_root_router_restore_refresh_v1(host, request.clone()).await?
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
    let issued: CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1 = host
        .post_private_json(
            TenantRootServiceTargetV1::ControlPlane,
            crate::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_RESTORE_INITIAL_ACTIVATION_PRIVATE_REQUEST_PATH,
            "tenant-root control-plane restore initial activation request",
            &CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1 {
                restore_refresh_grant_b64u: request.restore_refresh_grant_b64u,
                manifest_b64u: request.manifest_b64u,
            },
            Some(TenantRootCallBoundsV1 {
                request_max_bytes:
                    crate::TENANT_ROOT_CONTROL_PLANE_RESTORE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
                response_max_bytes:
                    crate::tenant_root_control_plane::TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_RESPONSE_MAX_BYTES_V1,
            }),
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
    let persisted =
        tenant_root_restore_initial_activation_call_v1(host, &activation_receipt_bytes).await?;
    let role_activation = CloudflareDeriverTenantRootInitialActivationRequestV1 {
        activation_receipt_b64u: issued.activation_receipt_b64u.clone(),
    };
    let (deriver_a, deriver_b) = futures::join!(
        tenant_root_deriver_initial_activation_call_v1(
            host,
            TwoPartyDeriverRole::DeriverA,
            &role_activation,
        ),
        tenant_root_deriver_initial_activation_call_v1(
            host,
            TwoPartyDeriverRole::DeriverB,
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

/// Drives one restore refresh to its promoted checkpoint: admission, the
/// control plane's commands, then prepare, contribute, finalize and promote at
/// both Derivers, each checkpointed in the destination's creation state.
pub async fn tenant_root_router_restore_refresh_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    request: CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1,
) -> RouterAbProtocolResult<CloudflareRouterTenantRootRestoreRefreshOutcomeV1> {
    let now_ms = host.now_ms()?;
    let issuer_keys = host.trusted_issuer_keys()?;
    let admission_request = CloudflareTenantRootRestoreRefreshCheckpointRequestV1::Admit {
        restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
        manifest_b64u: request.manifest_b64u.clone(),
    };
    let admission_response =
        tenant_root_restore_refresh_checkpoint_call_v1(
            host,
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
        let issued: CloudflareTenantRootControlPlaneRestoreRefreshCommandsResponseV1 = host
            .post_private_json(
                TenantRootServiceTargetV1::ControlPlane,
                crate::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_RESTORE_REFRESH_COMMANDS_PRIVATE_REQUEST_PATH,
                "tenant-root control-plane restore-refresh command request",
                &request,
                None,
            )
            .await?;
        let commands = verify_cloudflare_router_tenant_root_restore_refresh_commands_v1(
            &issuer_keys,
            issued,
            RestoreRefreshCommandValidationV1::Fresh { now_ms },
        )?;
        let persist_commands_request =
            CloudflareTenantRootRestoreRefreshCheckpointRequestV1::PersistCommands {
                restore_refresh_grant_b64u: request.restore_refresh_grant_b64u.clone(),
                manifest_b64u: request.manifest_b64u.clone(),
                commands: restore_refresh_checkpoint_commands_v1(&commands),
            };
        checkpoint = execute_restore_refresh_checkpoint_v1(host, &persist_commands_request).await?;
    }

    let role_keys = host.role_verifying_keys()?;

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
                    restore_refresh_commands_from_checkpoint_v1(&issuer_keys, persisted_commands)?;
                let deriver_a_prepare_request =
                    CloudflareDeriverTenantRootRestoreRefreshRequestV1::Prepare {
                        role_refresh_command_b64u: commands.deriver_a_command_b64u.clone(),
                    };
                let deriver_b_prepare_request =
                    CloudflareDeriverTenantRootRestoreRefreshRequestV1::Prepare {
                        role_refresh_command_b64u: commands.deriver_b_command_b64u.clone(),
                    };
                let (deriver_a_prepare, deriver_b_prepare) = futures::join!(
                    restore_refresh_deriver_call_with_retry_v1(
                        host,
                        TwoPartyDeriverRole::DeriverA,
                        &deriver_a_prepare_request,
                    ),
                    restore_refresh_deriver_call_with_retry_v1(
                        host,
                        TwoPartyDeriverRole::DeriverB,
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
                    host,
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
                    restore_refresh_commands_from_checkpoint_v1(&issuer_keys, persisted_commands)?;
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
                    restore_refresh_deriver_call_with_retry_v1(
                        host,
                        TwoPartyDeriverRole::DeriverA,
                        &deriver_a_contribute_request,
                    ),
                    restore_refresh_deriver_call_with_retry_v1(
                        host,
                        TwoPartyDeriverRole::DeriverB,
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
                    host,
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
                    restore_refresh_commands_from_checkpoint_v1(&issuer_keys, persisted_commands)?;
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
                    restore_refresh_deriver_call_with_retry_v1(
                        host,
                        TwoPartyDeriverRole::DeriverA,
                        &deriver_a_finalize_request,
                    ),
                    restore_refresh_deriver_call_with_retry_v1(
                        host,
                        TwoPartyDeriverRole::DeriverB,
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
                    host,
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
                    restore_refresh_commands_from_checkpoint_v1(&issuer_keys, persisted_commands)?;
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
                        host,
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
                let expected_authority_id = restore_refresh_expected_authority_v1(host, &commands)?;
                let promoted_read =
                    tenant_root_restore_refresh_checkpoint_call_v1(
                        host,
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

async fn request_restore_role_import_command_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    request: CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1,
) -> RouterAbProtocolResult<(
    TwoPartyDeriverRole,
    String,
    CloudflareDeriverTenantRootRestoreRoleImportKeyRequestV1,
)> {
    let control_plane_response: CloudflareTenantRootControlPlaneRestoreRoleImportKeyResponseV1 =
        host.post_private_json(
            TenantRootServiceTargetV1::ControlPlane,
            crate::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_KEY_PRIVATE_REQUEST_PATH,
            "tenant-root control-plane restore role-import key request",
            &request,
            None,
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
    Ok((
        command.role(),
        command.import_key_id().to_owned(),
        CloudflareDeriverTenantRootRestoreRoleImportKeyRequestV1 {
            issuer_key_id: control_plane_response.issuer_key_id,
            role_import_command_b64u: command_b64u,
        },
    ))
}

/// Obtains a signed role-import command from the control plane and has the
/// Deriver it names issue its import key.
pub async fn tenant_root_router_restore_role_import_key_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    request: CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRoleImportKeyResponseV1> {
    let (role, expected_key_id, deriver_request) =
        request_restore_role_import_command_v1(host, request).await?;
    let response: CloudflareDeriverTenantRootRestoreRoleImportKeyResponseV1 = host
        .post_private_json(
            TenantRootServiceTargetV1::Deriver(role),
            crate::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_PRIVATE_REQUEST_PATH,
            "tenant-root Deriver restore role-import key request",
            &deriver_request,
            None,
        )
        .await?;
    if response.role != CloudflareTenantRootCreateRoleV1::from_protocol(role)
        || response.import_key_id != expected_key_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root Deriver restore role-import response names a different role or import key",
        ));
    }
    Ok(response)
}

/// One tenant-resealed import envelope for the Deriver its grant names.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterTenantRootRestoreRoleImportAcceptRequestV1 {
    pub restore_grant_b64u: String,
    pub manifest_b64u: String,
    pub import_envelope_b64u: String,
}

/// Has the Deriver the grant names open and stage one import envelope.
pub async fn tenant_root_router_restore_role_import_accept_v1<
    Host: TenantRootRouterCreationHostV1,
>(
    host: &Host,
    request: CloudflareRouterTenantRootRestoreRoleImportAcceptRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRoleImportAcceptResponseV1> {
    let (role, expected_key_id, command) = request_restore_role_import_command_v1(
        host,
        CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1 {
            restore_grant_b64u: request.restore_grant_b64u,
            manifest_b64u: request.manifest_b64u,
        },
    )
    .await?;
    let response: CloudflareDeriverTenantRootRestoreRoleImportAcceptResponseV1 = host
        .post_private_json(
            TenantRootServiceTargetV1::Deriver(role),
            crate::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_ROLE_IMPORT_ACCEPT_PRIVATE_REQUEST_PATH,
            "tenant-root Deriver restore role-import acceptance",
            &CloudflareDeriverTenantRootRestoreRoleImportAcceptRequestV1 {
                issuer_key_id: command.issuer_key_id,
                role_import_command_b64u: command.role_import_command_b64u,
                import_envelope_b64u: request.import_envelope_b64u,
            },
            None,
        )
        .await?;
    if response.role != CloudflareTenantRootCreateRoleV1::from_protocol(role)
        || response.import_key_id != expected_key_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root Deriver restore role-import response names a different role or import key",
        ));
    }
    Ok(response)
}

/// Reads or authenticates the destination's bootstrap authority for the
/// tenant root the request names, with the credential the caller presented.
pub async fn tenant_root_router_destination_bootstrap_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    request: CloudflareTenantRootDestinationBootstrapRequestV1,
    token_b64u: Option<&str>,
) -> RouterAbProtocolResult<CloudflareTenantRootDestinationBootstrapResponseV1> {
    let (identity_digest, custody_lineage) =
        destination_bootstrap_request_scope_from_wire_v1(&request)?;
    let token_b64u = match &request {
        CloudflareTenantRootDestinationBootstrapRequestV1::Read { .. } => None,
        CloudflareTenantRootDestinationBootstrapRequestV1::Authenticate { .. } => token_b64u,
    };
    tenant_root_destination_bootstrap_call_v1(
        host,
        identity_digest,
        custody_lineage,
        &request,
        token_b64u,
    )
    .await
}

/// Forwards one recovery manifest to the control plane for verification.
pub async fn tenant_root_router_register_manifest_v1<Host: TenantRootRouterCreationHostV1>(
    host: &Host,
    request: CloudflareTenantRootControlPlaneRegisterManifestRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneRegisterManifestResponseV1> {
    host.post_private_json(
        TenantRootServiceTargetV1::ControlPlane,
        crate::CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_REGISTER_MANIFEST_PRIVATE_REQUEST_PATH,
        "tenant-root control-plane register-manifest request",
        &request,
        None,
    )
    .await
}

