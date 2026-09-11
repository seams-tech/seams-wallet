//! Tenant-root control-plane issuer operations.
//!
//! The control plane is the sole holder of the R120 issuer private signing
//! key. Every operation here constructs a canonical artifact from
//! authoritative Durable Object state and local key configuration, then
//! signs it. There is deliberately no raw-payload signing entry point: the
//! request types name *what* to issue, never the bytes to sign.

use router_ab_core::{
    tenant_root_restore_refresh_context_nonce_v1, verify_tenant_root_recovery_manifest_trust_v1,
    MpcPrfShareCommitmentWireV1, TenantRootActivationAvailabilityEvidenceV1,
    TenantRootActivationReceiptTransitionV1, TenantRootActiveRefreshV1, TenantRootActiveRootPairV1,
    TenantRootCanaryCurveFamilyV1, TenantRootCeremonyContextV1, TenantRootCeremonyEpochsV1,
    TenantRootCeremonyNonceV1, TenantRootCeremonySessionIdV1, TenantRootControlPlaneAuthorityIdV1,
    TenantRootCreationCapabilityNonceV1, TenantRootCreationCapabilityV1,
    TenantRootCreationJournalV1, TenantRootIdentityV1, TenantRootLifecycleReceiptDigestV1,
    TenantRootManagedRestoreAvailableV1, TenantRootManagedRestoreCapabilityV1,
    TenantRootManagedRestoreIncidentAuthorizationBindingV1,
    TenantRootManagedRestoreIncidentNonceV1, TenantRootManagedRestoreRoleV1,
    TenantRootProtocolDigestV1, TenantRootRecoveryManifestTrustV1, TenantRootRecoveryManifestV1,
    TenantRootRecoveryRoleDescriptorV1, TenantRootRecoveryTrustEvidenceV1,
    TenantRootRecoveryTrustLevelV1, TenantRootRestoreRefreshGrantV1,
    TenantRootRestoreRefreshRoleCommandV1, TenantRootRestoreRoleImportCommandV1,
    TenantRootRestoreRoleImportGrantV1, TenantRootRoleCleanupCommandV1,
    TenantRootRoleCleanupTargetV1, TenantRootRoleCreationCommandPackageV1,
    TenantRootRoleCreationCommandV1, TenantRootRoleRefreshCommandV1,
    TenantRootRoleUnavailableReceiptV1, TenantRootShareEpoch, TenantRootSignedActivationReceiptV1,
    TenantRootSignedManagedBackupV1, TenantRootSignedManagedRestoreCapabilityV1,
    TenantRootSignedManagedRestoreIncidentAuthorizationV1,
    TenantRootSignedManagedRestoreRoleUnavailableV1, TenantRootSignedProviderCanaryReceiptV1,
    TenantRootSignedShareInstallationEvidenceV1, VerifiedTenantRootCreationGrantV1,
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
    VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1,
    VerifiedTenantRootRestoreRefreshGrantV1, VerifiedTenantRootRestoreRefreshRoleCommandV1,
    TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1,
    TENANT_ROOT_INITIAL_CREATION_ACTIVATION_EXPECTED_REVISION_V1,
    TENANT_ROOT_INITIAL_CREATION_ACTIVATION_RESULT_REVISION_V1, TENANT_ROOT_MAX_LIFETIME_MS_V1,
    TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1, TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES,
    TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1,
    TENANT_ROOT_RESTORE_ROLE_IMPORT_GRANT_MAX_BYTES_V1,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use threshold_prf::TwoPartyDeriverRole;
use zeroize::Zeroizing;

use crate::durable_object::tenant_root_creation::{
    CloudflareTenantRootCreationInstallationCheckpointReadStateV1,
    CloudflareTenantRootCreationInstallationRoleV1,
    CloudflareTenantRootCreationJournalReadResponseV1,
    CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
    CloudflareTenantRootManagedRestoreAuthorizationCheckpointV1,
    CloudflareTenantRootManagedRestoreAuthorizationRequestV1,
    CloudflareTenantRootManagedRestoreFenceV1, ValidatedTenantRootCreationJournalV1,
};
use crate::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};

/// Maximum accepted request size for the role creation command operation.
pub const TENANT_ROOT_CONTROL_PLANE_ROLE_CREATION_COMMAND_REQUEST_MAX_BYTES_V1: usize = 2 * 1024;
pub const TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_REQUEST_MAX_BYTES_V1: usize = 2 * 1024;
pub const TENANT_ROOT_CONTROL_PLANE_REFRESH_COMMANDS_REQUEST_MAX_BYTES_V1: usize = 2 * 1024;
pub const TENANT_ROOT_CONTROL_PLANE_MANAGED_RESTORE_CHALLENGE_REQUEST_MAX_BYTES_V1: usize =
    8 * 1024;
pub const TENANT_ROOT_CONTROL_PLANE_MANAGED_RESTORE_AUTHORIZE_REQUEST_MAX_BYTES_V1: usize =
    32 * 1024;
/// Maximum accepted request size for recovery-manifest registration.
pub const TENANT_ROOT_CONTROL_PLANE_REGISTER_MANIFEST_REQUEST_MAX_BYTES_V1: usize = 256 * 1024;
/// Maximum JSON request size for one restore role-import command issuance.
pub const TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_REQUEST_MAX_BYTES_V1: usize = 384 * 1024;
/// Maximum JSON request size for one restore refresh command issuance.
pub const TENANT_ROOT_CONTROL_PLANE_RESTORE_REFRESH_COMMANDS_REQUEST_MAX_BYTES_V1: usize =
    384 * 1024;

/// Role label on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudflareTenantRootControlPlaneRoleV1 {
    DeriverA,
    DeriverB,
}

impl CloudflareTenantRootControlPlaneRoleV1 {
    pub(crate) const fn to_protocol(self) -> TwoPartyDeriverRole {
        match self {
            Self::DeriverA => TwoPartyDeriverRole::DeriverA,
            Self::DeriverB => TwoPartyDeriverRole::DeriverB,
        }
    }

    pub(crate) const fn from_protocol(role: TwoPartyDeriverRole) -> Self {
        match role {
            TwoPartyDeriverRole::DeriverA => Self::DeriverA,
            TwoPartyDeriverRole::DeriverB => Self::DeriverB,
        }
    }
}

/// One role's authenticated recovery descriptor context.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootRecoveryManifestRoleV1 {
    pub share_id: u64,
    pub recipient_public_key_b64u: String,
    pub recipient_fingerprint_b64u: String,
    pub recovery_share_commitment_b64u: String,
    pub deriver_signing_key_id: String,
}

/// The trust result established by the control-plane verifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareTenantRootRecoveryTrustLevelV1 {
    CryptographicallyValidOffline,
    ValidAtTrustSnapshot {
        snapshot_version: u64,
        snapshot_issued_at: String,
    },
    CurrentTrustConfirmed {
        snapshot_version: u64,
        snapshot_issued_at: String,
        checked_at: String,
    },
}

/// Router or console -> control plane: verify one recovery manifest.
///
/// The manifest is the complete caller-supplied surface. Trust roots and
/// revocation evidence are owned by this Worker and never appear in the
/// request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneRegisterManifestRequestV1 {
    pub manifest_b64u: String,
}

/// Control plane -> Router or console: the exact authenticated manifest
/// descriptor context needed to authorize later role imports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneRegisterManifestResponseV1 {
    pub identity_digest_b64u: String,
    pub source_custody_lineage_b64u: String,
    pub recovery_set_id_b64u: String,
    pub stable_root_commitment_b64u: String,
    pub deriver_a: CloudflareTenantRootRecoveryManifestRoleV1,
    pub deriver_b: CloudflareTenantRootRecoveryManifestRoleV1,
    pub deriver_a_package_length: u32,
    pub deriver_a_package_digest_b64u: String,
    pub deriver_b_package_length: u32,
    pub deriver_b_package_digest_b64u: String,
    pub manifest_digest_b64u: String,
    pub artifact_created_at_iso: String,
    pub trust_level: CloudflareTenantRootRecoveryTrustLevelV1,
}

/// Router or console -> control plane: issue one exact restore role-import command.
///
/// The grant carries the authenticated destination/session binding. The
/// manifest bytes are supplied again so this Worker can perform the complete
/// server-owned trust and detached-signature verification before it derives
/// any role command fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1 {
    pub restore_grant_b64u: String,
    pub manifest_b64u: String,
}

/// Control plane -> Router: the exact issuer-signed restore role-import command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneRestoreRoleImportKeyResponseV1 {
    pub issuer_key_id: String,
    pub role_import_command_b64u: String,
}

/// Router or console -> control plane: issue both exact restore refresh commands.
///
/// The signed grant carries the complete admitted destination/session scope.
/// The manifest is supplied again so this Worker can repeat server-owned trust
/// and detached-signature verification before deriving command fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1 {
    pub restore_refresh_grant_b64u: String,
    pub manifest_b64u: String,
}

/// Control plane -> Router: one deterministic create context and its A/B
/// issuer-signed restore refresh commands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneRestoreRefreshCommandsResponseV1 {
    pub refresh_context_b64u: String,
    pub deriver_a_refresh_command_b64u: String,
    pub deriver_b_refresh_command_b64u: String,
    pub issuer_key_id: String,
}

/// Router -> control plane: mint the creation command for one role.
///
/// This is the entire caller-supplied surface. Authority, revision, session,
/// nonce, journal, context, time window, and issuer key are all derived.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1 {
    pub identity_digest_b64u: String,
    pub custody_lineage_b64u: String,
    pub role: CloudflareTenantRootControlPlaneRoleV1,
}

/// Control plane -> Router: the signed command and its self-contained package.
///
/// Public bytes only. The package carries the Started journal preimage so a
/// Deriver can verify the command at its own boundary with no Router state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneRoleCreationCommandResponseV1 {
    pub role: CloudflareTenantRootControlPlaneRoleV1,
    pub issuer_key_id: String,
    pub role_creation_command_b64u: String,
    pub role_creation_command_package_b64u: String,
}

/// Router -> control plane: mint both role commands for one fresh refresh.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneRefreshCommandsRequestV1 {
    pub identity_digest_b64u: String,
    pub custody_lineage_b64u: String,
}

/// Control plane -> Router: one exact context and its A/B issuer commands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneRefreshCommandsResponseV1 {
    pub refresh_context_b64u: String,
    pub deriver_a_refresh_command_b64u: String,
    pub deriver_b_refresh_command_b64u: String,
    pub issuer_key_id: String,
}

/// Router -> control plane: issue one exact pending or retired cleanup command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareTenantRootControlPlaneCleanupCommandRequestV1 {
    PendingCreation {
        identity_digest_b64u: String,
        custody_lineage_b64u: String,
    },
    RetiredAfterRefresh {
        identity_digest_b64u: String,
        custody_lineage_b64u: String,
        role: CloudflareTenantRootControlPlaneRoleV1,
        expected_retired_revision: i64,
        expected_active_revision: i64,
    },
}

/// Control plane -> Router: exact issuer-signed cleanup authorization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneCleanupCommandResponseV1 {
    pub role: CloudflareTenantRootControlPlaneRoleV1,
    pub cleanup_command_b64u: String,
}

/// Router -> control plane: reserve one exact managed-restore challenge.
///
/// The identity and lineage scope the Router-owned active-state lookup. The
/// remaining fields are the operator's incident coordinates and freshness
/// window; active epoch and activation receipt are always read from the DO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootControlPlaneManagedRestoreChallengeRequestV1 {
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) incident_id: String,
    pub(crate) outage_observation_digest_b64u: String,
    pub(crate) issued_at_ms: u64,
    pub(crate) expires_at_ms: u64,
    pub(crate) nonce_b64u: String,
    pub(crate) unavailable_role: TenantRootManagedRestoreRoleV1,
}

/// Control plane -> Router: the persisted challenge and its canonical binding.
///
/// The challenge fields are flattened on the wire so an operator can display
/// the authoritative active identity, epoch, receipt, and one-use coordinates
/// directly. The `challenge` field remains available to in-crate callers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootControlPlaneManagedRestoreChallengeResponseV1 {
    #[serde(flatten)]
    pub(crate) challenge: CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
    pub(crate) authorization_binding_b64u: String,
}

/// Router -> control plane: authorize the exact challenge with both signatures.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootControlPlaneManagedRestoreAuthorizeRequestV1 {
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) incident_authorization_b64u: String,
}

/// Control plane -> Router: the exact terminal public artifacts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootControlPlaneManagedRestoreAuthorizeResponseV1 {
    pub(crate) public_state_b64u: String,
    pub(crate) capability_b64u: String,
    pub(crate) incident_authorization_b64u: String,
}

/// Maximum accepted request size for the genesis operation.
pub const TENANT_ROOT_CONTROL_PLANE_CREATE_TENANT_ROOT_REQUEST_MAX_BYTES_V1: usize = 32 * 1024;

/// Maximum accepted request size for initial activation evidence.
pub(crate) const TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1: usize =
    256 * 1024;
const TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_RESPONSE_MAX_BYTES_V1: usize = 32 * 1024;
/// Maximum accepted request size for restore initial activation evidence.
pub(crate) const TENANT_ROOT_CONTROL_PLANE_RESTORE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1: usize =
    256 * 1024;
/// Maximum accepted request size for refresh activation evidence.
pub(crate) const TENANT_ROOT_CONTROL_PLANE_REFRESH_ACTIVATION_REQUEST_MAX_BYTES_V1: usize =
    256 * 1024;

/// Router -> control plane: issue the signed initial-activation receipt from
/// exact public installation, managed-backup, and provider-canary wires.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootControlPlaneInitialActivationRequestV1 {
    pub(crate) deriver_a_signed_installation_evidence_b64u: String,
    pub(crate) deriver_b_signed_installation_evidence_b64u: String,
    pub(crate) deriver_a_signed_managed_backup_b64u: String,
    pub(crate) deriver_b_signed_managed_backup_b64u: String,
    pub(crate) ecdsa_provider_canary_receipt_b64u: String,
    pub(crate) ed25519_provider_canary_receipt_b64u: String,
}

/// Router -> control plane: issue initial activation for a restore refresh.
///
/// The Durable Object supplies the exact promoted evidence. The request names
/// only the signed authorization and its authenticated recovery manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1 {
    pub(crate) restore_refresh_grant_b64u: String,
    pub(crate) manifest_b64u: String,
}

/// Router -> control plane: issue the signed refresh-swap receipt from exact
/// public installation, managed-backup, and provider-canary wires.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootControlPlaneRefreshActivationRequestV1 {
    pub(crate) deriver_a_signed_installation_evidence_b64u: String,
    pub(crate) deriver_b_signed_installation_evidence_b64u: String,
    pub(crate) deriver_a_signed_managed_backup_b64u: String,
    pub(crate) deriver_b_signed_managed_backup_b64u: String,
    pub(crate) ecdsa_provider_canary_receipt_b64u: String,
    pub(crate) ed25519_provider_canary_receipt_b64u: String,
}

/// Router -> control plane: open a tenant root under a signed grant.
///
/// The grant is the entire caller-supplied surface. It is authorization, not
/// instruction: the issuer reads a tenant and a lineage from it and derives
/// everything else.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneCreateTenantRootRequestV1 {
    pub creation_grant_b64u: String,
}

/// Control plane -> Router: the persisted creation, public evidence only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneCreateTenantRootResponseV1 {
    pub identity_digest_b64u: String,
    pub custody_lineage_b64u: String,
    pub revision: u64,
    pub journal_digest_b64u: String,
    pub capability_digest_b64u: String,
    pub status: CloudflareTenantRootCreationStatusV1,
    /// True when this exact creation had already been persisted.
    pub replayed: bool,
}

/// Control plane -> Router: the exact signed initial-activation receipt.
///
/// The receipt contains the complete verified evidence binding. Keeping the
/// transport projection to canonical bytes prevents a second, weaker metadata
/// shape from becoming an activation authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1 {
    pub activation_receipt_b64u: String,
}

/// Control plane -> Router: the exact signed refresh-swap activation receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootControlPlaneRefreshActivationReceiptResponseV1 {
    pub(crate) activation_receipt_b64u: String,
}

/// Exhaustive durable state of one tenant-root creation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareTenantRootCreationStatusV1 {
    Pending,
    OneRoleInstalled {
        role: CloudflareTenantRootControlPlaneRoleV1,
    },
    Ready {
        root_commitment_b64u: String,
    },
    Abandoned {
        role: CloudflareTenantRootControlPlaneRoleV1,
    },
}

/// Public creation progress the issuer must respect before minting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TenantRootCreationProgressV1 {
    pub(crate) committed_roles: Vec<TwoPartyDeriverRole>,
    pub(crate) installation_checkpoint:
        CloudflareTenantRootCreationInstallationCheckpointReadStateV1,
    pub(crate) cleanup_checkpointed: bool,
}

impl TenantRootCreationProgressV1 {
    pub(crate) fn from_read_response(
        response: &CloudflareTenantRootCreationJournalReadResponseV1,
    ) -> Self {
        Self {
            committed_roles: response
                .committed_roles
                .iter()
                .map(|role: &CloudflareTenantRootCreationInstallationRoleV1| role.to_protocol())
                .collect(),
            installation_checkpoint: response.installation_checkpoint.clone(),
            cleanup_checkpointed: response.cleanup_checkpointed,
        }
    }
}

/// Everything the issuer derives before it signs; nothing here is caller-chosen.
pub(crate) struct TenantRootRoleCreationCommandIssuanceV1<'a> {
    /// Validated against the issuer's own published keys and the locally
    /// derived authority id.
    pub(crate) journal: &'a ValidatedTenantRootCreationJournalV1,
    pub(crate) progress: &'a TenantRootCreationProgressV1,
    pub(crate) role: TwoPartyDeriverRole,
    /// Derived from the Durable Object binding, never read from a request.
    pub(crate) authority_id: TenantRootControlPlaneAuthorityIdV1,
    pub(crate) now_ms: u64,
}

/// A signed command and the package a Deriver consumes. Both are public artifacts.
#[derive(Debug)]
pub(crate) struct IssuedTenantRootRoleCreationCommandV1 {
    pub(crate) command: TenantRootRoleCreationCommandV1,
    pub(crate) package: TenantRootRoleCreationCommandPackageV1,
}

/// Everything the issuer derives before it signs one refresh pair; nothing
/// here is caller-chosen.
pub(crate) struct TenantRootRoleRefreshCommandIssuanceV1<'a> {
    /// The one active A/B pair resolved from the tenant's private stores.
    pub(crate) active_pair: &'a TenantRootActiveRootPairV1,
    /// The exact refresh ceremony context selected by the control plane.
    pub(crate) refresh_context: &'a TenantRootCeremonyContextV1,
    /// The lifecycle revision the Router must still hold when applying either command.
    pub(crate) expected_control_plane_revision: u64,
    /// The locally derived control-plane authority binding.
    pub(crate) authority_id: TenantRootControlPlaneAuthorityIdV1,
    /// The issuer's current time, used for both commands.
    pub(crate) now_ms: u64,
}

/// The two signed role wires for one exact refresh ceremony.
#[derive(Debug)]
pub(crate) struct IssuedTenantRootRoleRefreshCommandsV1 {
    pub(crate) deriver_a: TenantRootRoleRefreshCommandV1,
    pub(crate) deriver_b: TenantRootRoleRefreshCommandV1,
}

/// The deterministic create context and A/B commands for one admitted restore
/// refresh. Every field is derived from the verified grant, verified manifest,
/// and destination role configuration.
#[derive(Debug)]
pub(crate) struct IssuedTenantRootRestoreRefreshCommandsV1 {
    pub(crate) context: TenantRootCeremonyContextV1,
    pub(crate) deriver_a: TenantRootRestoreRefreshRoleCommandV1,
    pub(crate) deriver_b: TenantRootRestoreRefreshRoleCommandV1,
}

fn refused(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ForbiddenLocalBinding, message)
}

fn derivation(error: router_ab_core::RouterAbDerivationError) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!("tenant-root control-plane issuance failed: {error}"),
    )
}

fn recovery_trust_level_v1(
    level: &TenantRootRecoveryTrustLevelV1,
) -> CloudflareTenantRootRecoveryTrustLevelV1 {
    match level {
        TenantRootRecoveryTrustLevelV1::CryptographicallyValidOffline => {
            CloudflareTenantRootRecoveryTrustLevelV1::CryptographicallyValidOffline
        }
        TenantRootRecoveryTrustLevelV1::ValidAtTrustSnapshot {
            snapshot_version,
            snapshot_issued_at,
        } => CloudflareTenantRootRecoveryTrustLevelV1::ValidAtTrustSnapshot {
            snapshot_version: *snapshot_version,
            snapshot_issued_at: snapshot_issued_at.clone(),
        },
        TenantRootRecoveryTrustLevelV1::CurrentTrustConfirmed {
            snapshot_version,
            snapshot_issued_at,
            checked_at,
        } => CloudflareTenantRootRecoveryTrustLevelV1::CurrentTrustConfirmed {
            snapshot_version: *snapshot_version,
            snapshot_issued_at: snapshot_issued_at.clone(),
            checked_at: checked_at.clone(),
        },
    }
}

fn recovery_manifest_role_v1(
    role: &TenantRootRecoveryRoleDescriptorV1,
) -> CloudflareTenantRootRecoveryManifestRoleV1 {
    CloudflareTenantRootRecoveryManifestRoleV1 {
        share_id: u64::from(role.share_id().get().get()),
        recipient_public_key_b64u: crate::encode_base64url_bytes_v1(
            role.recipient_public_key().as_bytes(),
        ),
        recipient_fingerprint_b64u: crate::encode_base64url_bytes_v1(
            role.recipient_fingerprint().as_bytes(),
        ),
        recovery_share_commitment_b64u: crate::encode_base64url_bytes_v1(
            &role.recovery_share_commitment().to_bytes(),
        ),
        deriver_signing_key_id: role.deriver_signing_key_id().to_owned(),
    }
}

fn recovery_manifest_response_v1(
    manifest: &TenantRootRecoveryManifestV1,
    trust: &TenantRootRecoveryManifestTrustV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneRegisterManifestResponseV1> {
    let descriptor = manifest.descriptor();
    let manifest_digest = manifest.digest().map_err(derivation)?;
    Ok(CloudflareTenantRootControlPlaneRegisterManifestResponseV1 {
        identity_digest_b64u: crate::encode_base64url_bytes_v1(
            descriptor.tenant_root_identity_digest().as_bytes(),
        ),
        source_custody_lineage_b64u: crate::encode_base64url_bytes_v1(
            descriptor.source_custody_lineage().as_bytes(),
        ),
        recovery_set_id_b64u: crate::encode_base64url_bytes_v1(
            descriptor.recovery_set_id().as_bytes(),
        ),
        stable_root_commitment_b64u: crate::encode_base64url_bytes_v1(
            &descriptor.stable_root_commitment().to_bytes(),
        ),
        deriver_a: recovery_manifest_role_v1(descriptor.deriver_a()),
        deriver_b: recovery_manifest_role_v1(descriptor.deriver_b()),
        deriver_a_package_length: manifest.deriver_a_package_length(),
        deriver_a_package_digest_b64u: crate::encode_base64url_bytes_v1(
            manifest.deriver_a_package_digest().as_bytes(),
        ),
        deriver_b_package_length: manifest.deriver_b_package_length(),
        deriver_b_package_digest_b64u: crate::encode_base64url_bytes_v1(
            manifest.deriver_b_package_digest().as_bytes(),
        ),
        manifest_digest_b64u: crate::encode_base64url_bytes_v1(&manifest_digest),
        artifact_created_at_iso: descriptor.creation_time().to_owned(),
        trust_level: recovery_trust_level_v1(trust.level()),
    })
}

/// Signs an initial-activation receipt from a fully verified evidence bundle.
///
/// Evidence collection and lifecycle mutation stay outside this boundary. A
/// caller must supply the core bundle, whose constructor already enforces both
/// role installations, the selected availability branch, and both canaries.
pub(crate) fn issue_tenant_root_initial_activation_receipt_v1(
    bundle: &VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
    activated_at_ms: u64,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    issuer_key_id: &str,
    issuer_seed: &Zeroizing<[u8; 32]>,
) -> RouterAbProtocolResult<TenantRootSignedActivationReceiptV1> {
    TenantRootSignedActivationReceiptV1::sign_initial_creation(
        bundle,
        activated_at_ms,
        authority_id,
        issuer_key_id,
        issuer_seed,
    )
    .map_err(derivation)
}

/// Signs a refresh-swap activation receipt from a fully verified evidence bundle.
///
/// The bundle owns the exact current/next pair and lifecycle revisions, so the
/// issuer only supplies its local authority, signing key, and activation time.
pub(crate) fn issue_tenant_root_refresh_activation_receipt_v1(
    bundle: &VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1,
    activated_at_ms: u64,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    issuer_key_id: &str,
    issuer_seed: &Zeroizing<[u8; 32]>,
) -> RouterAbProtocolResult<TenantRootSignedActivationReceiptV1> {
    TenantRootSignedActivationReceiptV1::sign_refresh_swap(
        bundle,
        activated_at_ms,
        authority_id,
        issuer_key_id,
        issuer_seed,
    )
    .map_err(derivation)
}

/// Projects an issued receipt onto the strict service-binding wire.
pub(crate) fn initial_activation_receipt_response_v1(
    receipt: TenantRootSignedActivationReceiptV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1> {
    let receipt_bytes = receipt.canonical_bytes().map_err(derivation)?;
    Ok(
        CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1 {
            activation_receipt_b64u: crate::encode_base64url_bytes_v1(&receipt_bytes),
        },
    )
}

/// Projects an issued refresh receipt onto the strict service-binding wire.
pub(crate) fn refresh_activation_receipt_response_v1(
    receipt: TenantRootSignedActivationReceiptV1,
) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneRefreshActivationReceiptResponseV1> {
    let receipt_bytes = receipt.canonical_bytes().map_err(derivation)?;
    Ok(
        CloudflareTenantRootControlPlaneRefreshActivationReceiptResponseV1 {
            activation_receipt_b64u: crate::encode_base64url_bytes_v1(&receipt_bytes),
        },
    )
}

/// Mints one role creation command from authoritative state.
///
/// Fail-closed conditions, in order: creation already checkpointed; the role
/// already committed; `now` outside the ceremony window; a command window
/// that would be empty. The command is then signed with the active issuer key
/// and packaged with the Started journal preimage.
pub(crate) fn issue_tenant_root_role_creation_command_v1(
    issuance: TenantRootRoleCreationCommandIssuanceV1<'_>,
    active_issuer_key_id: &str,
    issuer_seed: &Zeroizing<[u8; 32]>,
) -> RouterAbProtocolResult<IssuedTenantRootRoleCreationCommandV1> {
    if issuance.progress.cleanup_checkpointed {
        return Err(refused(
            "tenant-root creation was abandoned and cleaned; no further role command may be issued",
        ));
    }
    if !matches!(
        issuance.progress.installation_checkpoint,
        CloudflareTenantRootCreationInstallationCheckpointReadStateV1::None
    ) {
        return Err(refused(
            "tenant-root creation already installed a role; cleanup or completion must finish first",
        ));
    }
    if issuance.progress.committed_roles.contains(&issuance.role) {
        return Err(refused(
            "tenant-root creation role has already committed; its command may not be reissued",
        ));
    }
    let context: &TenantRootCeremonyContextV1 = &issuance.journal.ceremony_context;
    if issuance.now_ms < context.issued_at_ms() || issuance.now_ms >= context.expires_at_ms() {
        return Err(refused(
            "tenant-root creation ceremony window does not contain the issuance time",
        ));
    }
    let issued_at_ms = issuance.now_ms;
    let expires_at_ms = issued_at_ms
        .saturating_add(TENANT_ROOT_MAX_LIFETIME_MS_V1)
        .min(context.expires_at_ms());
    if expires_at_ms <= issued_at_ms {
        return Err(refused(
            "tenant-root creation ceremony window leaves no room for a role command",
        ));
    }
    let journal: &TenantRootCreationJournalV1 = &issuance.journal.journal;
    let command = TenantRootRoleCreationCommandV1::sign(
        journal,
        context,
        issuance.role,
        issuance.authority_id,
        issued_at_ms,
        expires_at_ms,
        active_issuer_key_id,
        issuer_seed,
    )
    .map_err(derivation)?;
    let package = TenantRootRoleCreationCommandPackageV1::new(journal.clone(), command.clone())
        .map_err(derivation)?;
    Ok(IssuedTenantRootRoleCreationCommandV1 { command, package })
}

/// Mints both refresh role commands from one validated active pair and one
/// exact refresh context.
pub(crate) fn issue_tenant_root_role_refresh_commands_v1(
    issuance: TenantRootRoleRefreshCommandIssuanceV1<'_>,
    active_issuer_key_id: &str,
    issuer_seed: &Zeroizing<[u8; 32]>,
) -> RouterAbProtocolResult<IssuedTenantRootRoleRefreshCommandsV1> {
    let context = issuance.refresh_context;
    if issuance.now_ms < context.issued_at_ms() || issuance.now_ms >= context.expires_at_ms() {
        return Err(refused(
            "tenant-root refresh ceremony window does not contain the issuance time",
        ));
    }
    let issued_at_ms = issuance.now_ms;
    let expires_at_ms = issued_at_ms
        .saturating_add(TENANT_ROOT_MAX_LIFETIME_MS_V1)
        .min(context.expires_at_ms());
    if expires_at_ms <= issued_at_ms {
        return Err(refused(
            "tenant-root refresh ceremony window leaves no room for a role command",
        ));
    }

    let deriver_a = TenantRootRoleRefreshCommandV1::sign(
        issuance.active_pair,
        context,
        TwoPartyDeriverRole::DeriverA,
        issuance.expected_control_plane_revision,
        issuance.authority_id,
        issued_at_ms,
        expires_at_ms,
        active_issuer_key_id,
        issuer_seed,
    )
    .map_err(derivation)?;
    let deriver_b = TenantRootRoleRefreshCommandV1::sign(
        issuance.active_pair,
        context,
        TwoPartyDeriverRole::DeriverB,
        issuance.expected_control_plane_revision,
        issuance.authority_id,
        issued_at_ms,
        expires_at_ms,
        active_issuer_key_id,
        issuer_seed,
    )
    .map_err(derivation)?;

    Ok(IssuedTenantRootRoleRefreshCommandsV1 {
        deriver_a,
        deriver_b,
    })
}

/// Builds both deterministic restore refresh role commands from one verified
/// grant and one verified recovery manifest.
///
/// The grant determines the destination/session scope and ceremony session.
/// The manifest determines the imported commitments, stable root, and digest.
/// Destination signer IDs come only from the validated Worker bindings. No
/// request timestamp or random value enters the issued bytes, so replaying the
/// same grant and manifest reproduces the exact commands after a lost response.
#[allow(clippy::too_many_arguments)]
pub(crate) fn issue_tenant_root_restore_refresh_commands_v1(
    grant: &VerifiedTenantRootRestoreRefreshGrantV1,
    manifest: &TenantRootRecoveryManifestV1,
    deriver_a_signing_key_id: &str,
    deriver_b_signing_key_id: &str,
    issuer_key_id: &str,
    issuer_seed: &Zeroizing<[u8; 32]>,
) -> RouterAbProtocolResult<IssuedTenantRootRestoreRefreshCommandsV1> {
    let manifest_digest = manifest.digest().map_err(derivation)?;
    if manifest_digest != *grant.manifest_digest() {
        return Err(refused(
            "tenant-root restore refresh manifest digest does not match its grant",
        ));
    }
    let descriptor = manifest.descriptor();
    if descriptor.tenant_root_identity_digest() != grant.destination_identity_digest() {
        return Err(refused(
            "tenant-root restore refresh manifest identity does not match its destination grant",
        ));
    }

    let deriver_a_imported_commitment = MpcPrfShareCommitmentWireV1::new(
        descriptor
            .deriver_a()
            .recovery_share_commitment()
            .to_bytes()
            .to_vec(),
    )
    .map_err(derivation)?;
    let deriver_b_imported_commitment = MpcPrfShareCommitmentWireV1::new(
        descriptor
            .deriver_b()
            .recovery_share_commitment()
            .to_bytes()
            .to_vec(),
    )
    .map_err(derivation)?;
    let stable_root_commitment = descriptor.stable_root_commitment().to_bytes();
    let ceremony_session_id = grant.ceremony_session_id().map_err(derivation)?;
    // The role-command scope nonce includes the full grant-derived ceremony
    // session and every manifest/receipt commitment, so both role commands
    // share one deterministic context without duplicating mutable state.
    let ceremony_nonce = tenant_root_restore_refresh_context_nonce_v1(
        grant.destination_identity_digest(),
        grant.destination_lineage(),
        ceremony_session_id,
        grant.destination_fingerprint(),
        grant.restore_session_id(),
        manifest_digest,
        grant.deriver_a_acceptance_receipt_digest(),
        grant.deriver_b_acceptance_receipt_digest(),
        &deriver_a_imported_commitment,
        &deriver_b_imported_commitment,
        stable_root_commitment,
    )
    .map_err(derivation)?;
    let context = TenantRootCeremonyContextV1::new(
        grant.destination_identity_digest(),
        grant.destination_lineage(),
        TenantRootCeremonyEpochsV1::create(),
        ceremony_session_id,
        ceremony_nonce,
        grant.issued_at_ms(),
        grant.expires_at_ms(),
        deriver_a_signing_key_id,
        deriver_b_signing_key_id,
    )
    .map_err(derivation)?;

    let deriver_a = TenantRootRestoreRefreshRoleCommandV1::sign(
        &context,
        grant.destination_fingerprint(),
        grant.restore_session_id(),
        manifest_digest,
        grant.deriver_a_acceptance_receipt_digest(),
        grant.deriver_b_acceptance_receipt_digest(),
        deriver_a_imported_commitment.clone(),
        deriver_b_imported_commitment.clone(),
        stable_root_commitment,
        TwoPartyDeriverRole::DeriverA,
        issuer_key_id,
        issuer_seed,
    )
    .map_err(derivation)?;
    let deriver_b = TenantRootRestoreRefreshRoleCommandV1::sign(
        &context,
        grant.destination_fingerprint(),
        grant.restore_session_id(),
        manifest_digest,
        grant.deriver_a_acceptance_receipt_digest(),
        grant.deriver_b_acceptance_receipt_digest(),
        deriver_a_imported_commitment,
        deriver_b_imported_commitment,
        stable_root_commitment,
        TwoPartyDeriverRole::DeriverB,
        issuer_key_id,
        issuer_seed,
    )
    .map_err(derivation)?;

    Ok(IssuedTenantRootRestoreRefreshCommandsV1 {
        context,
        deriver_a,
        deriver_b,
    })
}

const TENANT_ROOT_CEREMONY_SESSION_DOMAIN_V1: &[u8] = b"tenant_root_creation_ceremony_session_v1";
const TENANT_ROOT_CEREMONY_NONCE_DOMAIN_V1: &[u8] = b"tenant_root_creation_ceremony_nonce_v1";
const TENANT_ROOT_CAPABILITY_NONCE_DOMAIN_V1: &[u8] = b"tenant_root_creation_capability_nonce_v1";

/// Ceremony material for one genesis operation, derived from the grant.
///
/// A caller cannot supply a session, a nonce, a window, or the expected role
/// signers: choosing any of them would let a caller steer the ceremony that a
/// later role command is bound to.
///
/// The material is *derived*, not drawn, so genesis is a pure function of the
/// authorization. The Durable Object recognises a replay only when the journal
/// and capability match byte for byte, so freshly drawn randomness would make a
/// lost-response retry of the same grant conflict with its own first attempt.
/// Deriving instead means the same grant reproduces the same creation and the
/// retry lands on the object's existing replay path, while a different grant
/// for the same tenant still produces different bytes and conflicts.
///
/// Unpredictability is preserved: the derivation is domain-separated over the
/// grant's canonical bytes, which carry the authority's 32-byte random nonce.
/// Predicting this material requires the grant, and holding the grant already
/// authorizes opening the creation.
pub(crate) struct TenantRootCreationCeremonyDrawV1 {
    pub(crate) session_id: TenantRootCeremonySessionIdV1,
    pub(crate) ceremony_nonce: TenantRootCeremonyNonceV1,
    pub(crate) capability_nonce: TenantRootCreationCapabilityNonceV1,
    pub(crate) deriver_a_signing_key_id: String,
    pub(crate) deriver_b_signing_key_id: String,
}

fn derive_ceremony_bytes_v1<const N: usize>(domain: &[u8], grant_bytes: &[u8]) -> [u8; N] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update((grant_bytes.len() as u64).to_be_bytes());
    hasher.update(grant_bytes);
    let digest: [u8; 32] = hasher.finalize().into();
    let mut out = [0_u8; N];
    out.copy_from_slice(&digest[..N]);
    out
}

/// Derives one ceremony's material from the exact signed grant.
pub(crate) fn derive_tenant_root_creation_ceremony_v1(
    grant_canonical_bytes: &[u8],
    deriver_a_signing_key_id: String,
    deriver_b_signing_key_id: String,
) -> RouterAbProtocolResult<TenantRootCreationCeremonyDrawV1> {
    Ok(TenantRootCreationCeremonyDrawV1 {
        session_id: TenantRootCeremonySessionIdV1::from_bytes(derive_ceremony_bytes_v1::<16>(
            TENANT_ROOT_CEREMONY_SESSION_DOMAIN_V1,
            grant_canonical_bytes,
        ))
        .map_err(derivation)?,
        ceremony_nonce: TenantRootCeremonyNonceV1::from_bytes(derive_ceremony_bytes_v1::<32>(
            TENANT_ROOT_CEREMONY_NONCE_DOMAIN_V1,
            grant_canonical_bytes,
        ))
        .map_err(derivation)?,
        capability_nonce: TenantRootCreationCapabilityNonceV1::from_bytes(
            derive_ceremony_bytes_v1::<32>(
                TENANT_ROOT_CAPABILITY_NONCE_DOMAIN_V1,
                grant_canonical_bytes,
            ),
        )
        .map_err(derivation)?,
        deriver_a_signing_key_id,
        deriver_b_signing_key_id,
    })
}

/// The Started journal and its issuer capability, ready to persist.
#[derive(Debug)]
pub(crate) struct AuthorizedTenantRootCreationV1 {
    pub(crate) journal: TenantRootCreationJournalV1,
    pub(crate) capability: TenantRootCreationCapabilityV1,
}

/// Opens one tenant-root creation from a verified grant.
///
/// The grant authorizes a tenant and a custody lineage and nothing else; the
/// journal, ceremony context, window, and capability are constructed here from
/// that authorization plus locally drawn material. The capability is signed over
/// the journal the issuer just built, so it cannot attest a journal the issuer
/// did not construct.
pub(crate) fn authorize_tenant_root_creation_v1(
    grant: &VerifiedTenantRootCreationGrantV1,
    draw: &TenantRootCreationCeremonyDrawV1,
    now_ms: u64,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    active_issuer_key_id: &str,
    issuer_seed: &Zeroizing<[u8; 32]>,
) -> RouterAbProtocolResult<AuthorizedTenantRootCreationV1> {
    // The grant's own window gates the operation: an expired authorization
    // cannot open a ceremony, however fresh the issuer's clock is. `now_ms` is
    // the only non-derived input, and it gates admission without entering the
    // constructed bytes, so a retry inside the window is byte-identical.
    grant.require_fresh(now_ms).map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            "tenant-root creation grant is outside its authorized window",
        )
    })?;
    if draw.deriver_a_signing_key_id == draw.deriver_b_signing_key_id {
        return Err(refused(
            "tenant-root creation ceremony must name distinct role signers",
        ));
    }
    // The ceremony window IS the authorization's window, so it is reproducible
    // and can never outlive the grant that opened it.
    let issued_at_ms = grant.issued_at_ms();
    let expires_at_ms = issued_at_ms
        .saturating_add(TENANT_ROOT_MAX_LIFETIME_MS_V1)
        .min(grant.expires_at_ms());
    if expires_at_ms <= issued_at_ms {
        return Err(refused(
            "tenant-root creation grant leaves no room for a ceremony window",
        ));
    }
    let context = TenantRootCeremonyContextV1::new(
        grant.identity_digest(),
        grant.custody_lineage(),
        TenantRootCeremonyEpochsV1::create(),
        draw.session_id,
        draw.ceremony_nonce,
        issued_at_ms,
        expires_at_ms,
        draw.deriver_a_signing_key_id.as_str(),
        draw.deriver_b_signing_key_id.as_str(),
    )
    .map_err(derivation)?;
    let journal = TenantRootCreationJournalV1::started(
        grant.identity().clone(),
        grant.custody_lineage(),
        context,
    )
    .map_err(derivation)?;
    let capability = TenantRootCreationCapabilityV1::sign(
        journal.identity_digest(),
        journal.custody_lineage(),
        journal.digest().map_err(derivation)?,
        authority_id,
        draw.capability_nonce,
        issued_at_ms,
        expires_at_ms,
        active_issuer_key_id,
        issuer_seed,
    )
    .map_err(derivation)?;
    Ok(AuthorizedTenantRootCreationV1 {
        journal,
        capability,
    })
}

fn verify_recovery_manifest_with_local_trust_v1(
    manifest_bytes: &[u8],
    env: &impl crate::CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<(
    TenantRootRecoveryManifestV1,
    TenantRootRecoveryManifestTrustV1,
)> {
    let manifest =
        TenantRootRecoveryManifestV1::from_canonical_json(manifest_bytes).map_err(derivation)?;
    let trust_bundle = crate::env::parse_cloudflare_tenant_root_recovery_trust_bundle_v1(env)?;
    let snapshot = crate::env::parse_cloudflare_tenant_root_recovery_trust_snapshot_v1(env)?;
    let evidence = match snapshot.as_ref() {
        Some(snapshot) => TenantRootRecoveryTrustEvidenceV1::TrustSnapshot { snapshot },
        None => TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    };
    let trust = verify_tenant_root_recovery_manifest_trust_v1(&manifest, &trust_bundle, &evidence)
        .map_err(derivation)?;
    // The chain verifier returns the trusted key. The signed artifact still
    // needs its detached manifest signature checked against that key.
    manifest
        .verify(&trust.trusted_verifying_keys().control_plane)
        .map_err(derivation)?;
    Ok((manifest, trust))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecoveryGenerationRequestV1 {
    identity_b64u: String,
    custody_lineage_b64u: String,
    expected_lifecycle_revision: u64,
    recovery_set_id_b64u: String,
    recipient_a_b64u: String,
    recipient_b_b64u: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecoverySourceRetirementRequestV1 {
    identity_digest_b64u: String,
    custody_lineage_b64u: String,
    expected_lifecycle_revision: u64,
    destination_activation_receipt_digest_b64u: String,
}

/// Console authorization selects the operation; active root facts come from the Router.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum RecoveryCommandRequestV1 {
    Generate(RecoveryGenerationRequestV1),
    RetireSource(RecoverySourceRetirementRequestV1),
    Download {
        generation_command_b64u: String,
        role: CloudflareTenantRootControlPlaneRoleV1,
    },
    Destroy {
        generation_command_b64u: String,
        role: CloudflareTenantRootControlPlaneRoleV1,
    },
}

/// Internal console request; confirmation verifiers never enter browser responses.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum RecoveryRecipientProofRequestV1 {
    Seal {
        identity_digest_b64u: String,
        custody_lineage_b64u: String,
        role: CloudflareTenantRootControlPlaneRoleV1,
        recipient_public_key_b64u: String,
        actor_user_id: String,
        lifecycle_revision: u64,
        issued_at_ms: u64,
    },
    Verify {
        expected_confirmation_b64u: String,
        confirmation_b64u: String,
    },
}

/// Complete role-signed evidence and ciphertexts for one admitted recovery set.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecoveryManifestAssemblyRequestV1 {
    generation_command_b64u: String,
    evidence_a_b64u: String,
    evidence_b_b64u: String,
    package_a_b64u: String,
    package_b_b64u: String,
    deriver_a_certificate_chain: Vec<String>,
    deriver_b_certificate_chain: Vec<String>,
    control_plane_certificate_chain: Vec<String>,
}

#[cfg(feature = "workers-rs")]
pub(crate) use live::{
    assemble_recovery_manifest_v1, recovery_command_v1, recovery_recipient_proof_v1,
};

#[cfg(feature = "workers-rs")]
pub use live::{
    handle_cloudflare_tenant_root_control_plane_cleanup_command_v1,
    handle_cloudflare_tenant_root_control_plane_create_tenant_root_v1,
    handle_cloudflare_tenant_root_control_plane_refresh_commands_v1,
    handle_cloudflare_tenant_root_control_plane_register_manifest_v1,
    handle_cloudflare_tenant_root_control_plane_restore_refresh_commands_v1,
    handle_cloudflare_tenant_root_control_plane_restore_role_import_key_v1,
    handle_cloudflare_tenant_root_control_plane_role_creation_command_v1,
};

#[cfg(feature = "workers-rs")]
#[allow(unused_imports)]
pub(crate) use live::{
    execute_cloudflare_tenant_root_control_plane_initial_activation_service_call_v1,
    execute_cloudflare_tenant_root_control_plane_restore_initial_activation_service_call_v1,
    handle_cloudflare_tenant_root_control_plane_initial_activation_v1,
    handle_cloudflare_tenant_root_control_plane_managed_restore_authorize_v1,
    handle_cloudflare_tenant_root_control_plane_managed_restore_challenge_v1,
    handle_cloudflare_tenant_root_control_plane_refresh_activation_v1,
    handle_cloudflare_tenant_root_control_plane_restore_initial_activation_v1,
};

#[cfg(feature = "workers-rs")]
mod live {
    use super::*;
    use crate::durable_object::tenant_root_creation::{
        decode_canonical_base64url, derive_tenant_root_creation_authority_object_v1,
        execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1,
        execute_cloudflare_router_tenant_root_creation_journal_call_v1,
        execute_cloudflare_router_tenant_root_managed_restore_authorization_challenge_call_v1,
        execute_cloudflare_router_tenant_root_managed_restore_authorization_checkpoint_call_v1,
        execute_cloudflare_router_tenant_root_restore_refresh_checkpoint_call_v1,
        validate_creation_record, CloudflareTenantRootCreationJournalOutcomeV1,
        CloudflareTenantRootCreationJournalReadRequestV1,
        CloudflareTenantRootCreationJournalRecordV1,
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1,
        CloudflareTenantRootRestoreRefreshRolePromotionV1,
        CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_READ_PATH,
    };
    use crate::env::decode_cloudflare_tenant_root_control_plane_issuer_signing_secret_v1;
    use crate::{
        encode_base64url_bytes_v1, CloudflareTenantRootControlPlaneRuntimeV1,
        CloudflareWorkerEnvReaderV1,
    };
    use router_ab_core::{
        TenantRootCreationGrantV1, TenantRootCustodyLineageId, TenantRootIdentityDigestV1,
        TENANT_ROOT_CREATION_GRANT_MAX_BYTES_V1,
    };
    use zeroize::Zeroize;

    const ROUTER_TENANT_ROOT_CREATION_DO_BINDING_V1: &str = "ROUTER_TENANT_ROOT_CREATION_DO";

    fn local(message: String) -> RouterAbProtocolError {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            message,
        )
    }

    pub(crate) async fn recovery_command_v1(
        request: RecoveryCommandRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<serde_json::Value> {
        use router_ab_core::derivation::{
            TenantRootRecoveryAccessGrantV1, TenantRootRecoveryAccessOperationV1,
            TenantRootRecoveryReshareRoleCommandV1,
        };
        let (operation, command_b64u, role) = match request {
            RecoveryCommandRequestV1::RetireSource(scope) => {
                return issue_source_retirement_v1(scope, env, runtime).await
            }
            RecoveryCommandRequestV1::Generate(scope) => {
                return issue_recovery_generation_v1(scope, env, runtime).await
            }
            RecoveryCommandRequestV1::Download {
                generation_command_b64u,
                role,
            } => (
                TenantRootRecoveryAccessOperationV1::DownloadPackage,
                generation_command_b64u,
                role,
            ),
            RecoveryCommandRequestV1::Destroy {
                generation_command_b64u,
                role,
            } => (
                TenantRootRecoveryAccessOperationV1::DestroyRecoverySet,
                generation_command_b64u,
                role,
            ),
        };
        let now = crate::cloudflare_now_unix_ms_v1()?;
        let expires = now
            .checked_add(300_000)
            .ok_or_else(|| refused("recovery command expiry overflow"))?;
        let nonce = TenantRootCeremonyNonceV1::from_bytes(
            crate::cloudflare_random_bytes_v1(32)?
                .try_into()
                .map_err(|_| refused("recovery nonce generation failed"))?,
        )
        .map_err(derivation)?;
        let seed = load_issuer_seed(env, runtime)?;
        let bindings = runtime.bindings();
        let issuer_id = bindings.issuer_signing_key.signing_key_id();
        let raw = TenantRootRecoveryReshareRoleCommandV1::decode_canonical_bytes(
            &decode_canonical_base64url(
                "recovery generation command",
                &command_b64u,
                16384,
                32768,
            )?,
        )
        .map_err(derivation)?;
        let issuer = bindings
            .issuer_verifying_keys
            .for_issuer_key_id(raw.issuer_key_id())
            .ok_or_else(|| refused("recovery generation issuer is not trusted"))?;
        let command = raw
            .verify(role.to_protocol(), raw.issuer_key_id(), issuer)
            .map_err(derivation)?;
        let grant = TenantRootRecoveryAccessGrantV1::sign(
            &command, operation, nonce, now, expires, issuer_id, &seed,
        )
        .map_err(derivation)?;
        Ok(
            serde_json::json!({"access_grant_b64u": encode_base64url_bytes_v1(&grant.canonical_bytes().map_err(derivation)?)}),
        )
    }

    async fn issue_source_retirement_v1(
        request: RecoverySourceRetirementRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<serde_json::Value> {
        use router_ab_core::derivation::{
            TenantRootProtocolDigestV1, TenantRootSourceRetirementCommandV1,
        };
        let identity = TenantRootIdentityDigestV1::from_bytes(recovery_proof_fixed(
            "source identity",
            &request.identity_digest_b64u,
        )?);
        let lineage = TenantRootCustodyLineageId::from_bytes(recovery_proof_fixed(
            "source lineage",
            &request.custody_lineage_b64u,
        )?)
        .map_err(derivation)?;
        let destination = TenantRootProtocolDigestV1::from_bytes(recovery_proof_fixed(
            "destination activation receipt",
            &request.destination_activation_receipt_digest_b64u,
        )?)
        .map_err(derivation)?;
        let active =
            execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1(
                env, identity, lineage,
            )
            .await?;
        if active.lifecycle_revision != request.expected_lifecycle_revision {
            return Err(refused("source retirement lifecycle revision is stale"));
        }
        let now = crate::cloudflare_now_unix_ms_v1()?;
        let expires = now
            .checked_add(300_000)
            .ok_or_else(|| refused("source retirement expiry overflow"))?;
        let nonce = TenantRootCeremonyNonceV1::from_bytes(
            crate::cloudflare_random_bytes_v1(32)?
                .try_into()
                .map_err(|_| refused("source retirement nonce generation failed"))?,
        )
        .map_err(derivation)?;
        let seed = load_issuer_seed(env, runtime)?;
        let issuer = runtime.bindings().issuer_signing_key.signing_key_id();
        let a = TenantRootSourceRetirementCommandV1::sign(
            &active.activation_receipt,
            threshold_prf::TwoPartyDeriverRole::DeriverA,
            destination,
            nonce,
            now,
            expires,
            issuer,
            &seed,
        )
        .map_err(derivation)?;
        let b = TenantRootSourceRetirementCommandV1::sign(
            &active.activation_receipt,
            threshold_prf::TwoPartyDeriverRole::DeriverB,
            destination,
            nonce,
            now,
            expires,
            issuer,
            &seed,
        )
        .map_err(derivation)?;
        Ok(serde_json::json!({
            "command_a_b64u": encode_base64url_bytes_v1(&a.canonical_bytes().map_err(derivation)?),
            "command_b_b64u": encode_base64url_bytes_v1(&b.canonical_bytes().map_err(derivation)?),
            "lifecycle_revision": active.lifecycle_revision
        }))
    }

    async fn issue_recovery_generation_v1(
        request: RecoveryGenerationRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<serde_json::Value> {
        use router_ab_core::derivation::{
            TenantRootRecoveryRecipientPublicKeyV1, TenantRootRecoveryReshareContextV1,
            TenantRootRecoveryReshareRoleCommandV1, TenantRootRecoverySetId,
        };
        // Reject missing trust configuration before allocating per-set retention keys.
        let reader = crate::CloudflareWorkerEnvReaderV1::new(env);
        crate::env::parse_cloudflare_tenant_root_recovery_trust_bundle_v1(&reader)?;
        crate::env::parse_cloudflare_tenant_root_recovery_trust_snapshot_v1(&reader)?;
        let RecoveryGenerationRequestV1 {
            identity_b64u,
            custody_lineage_b64u,
            expected_lifecycle_revision,
            recovery_set_id_b64u,
            recipient_a_b64u,
            recipient_b_b64u,
        } = request;
        let identity = TenantRootIdentityV1::decode_canonical_bytes(&decode_canonical_base64url(
            "recovery identity",
            &identity_b64u,
            16384,
            32768,
        )?)
        .map_err(derivation)?;
        let lineage = TenantRootCustodyLineageId::from_bytes(recovery_proof_fixed(
            "recovery lineage",
            &custody_lineage_b64u,
        )?)
        .map_err(derivation)?;
        let active =
            execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1(
                env,
                identity.digest().map_err(derivation)?,
                lineage,
            )
            .await?;
        if active.lifecycle_revision != expected_lifecycle_revision {
            return Err(refused("recovery enrollment lifecycle revision is stale"));
        }
        let current = TenantRootActiveRefreshV1::from_verified_activation_receipt(
            identity,
            active.activation_receipt,
            active.lifecycle_revision,
        )
        .map_err(derivation)?;
        let set = TenantRootRecoverySetId::from_bytes(recovery_proof_fixed(
            "recovery set id",
            &recovery_set_id_b64u,
        )?)
        .map_err(derivation)?;
        let a = TenantRootRecoveryRecipientPublicKeyV1::from_bytes(recovery_proof_fixed(
            "recovery A recipient",
            &recipient_a_b64u,
        )?)
        .map_err(derivation)?;
        let b = TenantRootRecoveryRecipientPublicKeyV1::from_bytes(recovery_proof_fixed(
            "recovery B recipient",
            &recipient_b_b64u,
        )?)
        .map_err(derivation)?;
        let session = TenantRootCeremonySessionIdV1::from_bytes(
            crate::cloudflare_random_bytes_v1(16)?
                .try_into()
                .map_err(|_| refused("recovery session generation failed"))?,
        )
        .map_err(derivation)?;
        let nonce = TenantRootCeremonyNonceV1::from_bytes(
            crate::cloudflare_random_bytes_v1(32)?
                .try_into()
                .map_err(|_| refused("recovery nonce generation failed"))?,
        )
        .map_err(derivation)?;
        let now = crate::cloudflare_now_unix_ms_v1()?;
        let expires = now
            .checked_add(300_000)
            .ok_or_else(|| refused("recovery command expiry overflow"))?;
        let bindings = runtime.bindings();
        let context = TenantRootRecoveryReshareContextV1::from_active(
            &current,
            set,
            a,
            b,
            session,
            nonce,
            now,
            expires,
            &bindings.deriver_a_signing_key_id,
            &bindings.deriver_b_signing_key_id,
        )
        .map_err(derivation)?;
        let seed = load_issuer_seed(env, runtime)?;
        let a = TenantRootRecoveryReshareRoleCommandV1::sign(
            &context,
            TwoPartyDeriverRole::DeriverA,
            bindings.issuer_signing_key.signing_key_id(),
            &seed,
        )
        .map_err(derivation)?;
        let b = TenantRootRecoveryReshareRoleCommandV1::sign(
            &context,
            TwoPartyDeriverRole::DeriverB,
            bindings.issuer_signing_key.signing_key_id(),
            &seed,
        )
        .map_err(derivation)?;
        Ok(
            serde_json::json!({"command_a_b64u": encode_base64url_bytes_v1(&a.canonical_bytes().map_err(derivation)?), "command_b_b64u": encode_base64url_bytes_v1(&b.canonical_bytes().map_err(derivation)?), "issued_at_ms": now, "expires_at_ms": expires, "lifecycle_revision": expected_lifecycle_revision}),
        )
    }

    pub(crate) fn recovery_recipient_proof_v1(
        request: RecoveryRecipientProofRequestV1,
    ) -> RouterAbProtocolResult<serde_json::Value> {
        use router_ab_core::derivation::{
            confirm_tenant_root_recovery_recipient_proof_v1,
            TenantRootRecoveryRecipientProofBindingV1, TenantRootRecoveryRecipientProofEnvelopeV1,
            TenantRootRecoveryRecipientPublicKeyV1,
        };
        use subtle::ConstantTimeEq;
        match request {
            RecoveryRecipientProofRequestV1::Seal {
                identity_digest_b64u,
                custody_lineage_b64u,
                role,
                recipient_public_key_b64u,
                actor_user_id,
                lifecycle_revision,
                issued_at_ms,
            } => {
                let now = crate::cloudflare_now_unix_ms_v1()?;
                if now.abs_diff(issued_at_ms) > 30_000 {
                    return Err(refused("recipient challenge issue time is stale"));
                }
                let identity = TenantRootIdentityDigestV1::from_bytes(recovery_proof_fixed(
                    "identity digest",
                    &identity_digest_b64u,
                )?);
                let lineage = TenantRootCustodyLineageId::from_bytes(recovery_proof_fixed(
                    "custody lineage",
                    &custody_lineage_b64u,
                )?)
                .map_err(derivation)?;
                let recipient = TenantRootRecoveryRecipientPublicKeyV1::from_bytes(
                    recovery_proof_fixed("recipient public key", &recipient_public_key_b64u)?,
                )
                .map_err(derivation)?;
                let mut rng = crate::hpke::CloudflareHpkeGetrandomRngV1;
                let mut challenge_id = [0; 16];
                let mut secret = Zeroizing::new([0; 32]);
                rand_core::RngCore::fill_bytes(&mut rng, &mut challenge_id);
                rand_core::RngCore::fill_bytes(&mut rng, secret.as_mut());
                let role = role.to_protocol();
                let binding = TenantRootRecoveryRecipientProofBindingV1::new(
                    challenge_id,
                    identity,
                    lineage,
                    role,
                    role.share_id(),
                    recipient.fingerprint(),
                    actor_user_id,
                    lifecycle_revision,
                    issued_at_ms,
                    issued_at_ms
                        .checked_add(600_000)
                        .ok_or_else(|| refused("recipient challenge expiry overflow"))?,
                )
                .map_err(derivation)?;
                let confirmation =
                    confirm_tenant_root_recovery_recipient_proof_v1(&binding, &secret)
                        .map_err(derivation)?;
                let envelope = TenantRootRecoveryRecipientProofEnvelopeV1::seal(
                    binding, recipient, *secret, &mut rng,
                )
                .map_err(derivation)?;
                Ok(serde_json::json!({
                    "challenge_id_b64u": encode_base64url_bytes_v1(&challenge_id),
                    "envelope_b64u": encode_base64url_bytes_v1(&envelope.canonical_bytes().map_err(derivation)?),
                    "recipient_fingerprint_b64u": encode_base64url_bytes_v1(recipient.fingerprint().as_bytes()),
                    "expected_confirmation_b64u": encode_base64url_bytes_v1(confirmation.as_bytes()),
                }))
            }
            RecoveryRecipientProofRequestV1::Verify {
                expected_confirmation_b64u,
                confirmation_b64u,
            } => {
                let expected = Zeroizing::new(recovery_proof_fixed::<32>(
                    "stored recipient verifier",
                    &expected_confirmation_b64u,
                )?);
                let actual = Zeroizing::new(recovery_proof_fixed::<32>(
                    "recipient confirmation",
                    &confirmation_b64u,
                )?);
                Ok(
                    serde_json::json!({"verified": bool::from(expected.as_ref().ct_eq(actual.as_ref()))}),
                )
            }
        }
    }

    fn recovery_proof_fixed<const N: usize>(
        field: &'static str,
        value: &str,
    ) -> RouterAbProtocolResult<[u8; N]> {
        decode_canonical_base64url(field, value, N, N * 2)?
            .try_into()
            .map_err(|_| refused("recipient proof field has invalid length"))
    }

    pub(crate) async fn assemble_recovery_manifest_v1(
        request: RecoveryManifestAssemblyRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<serde_json::Value> {
        use router_ab_core::derivation::{
            TenantRootRecoveryDescriptorV1, TenantRootRecoveryPackageV1,
            TenantRootRecoveryReshareRoleCommandV1,
            TenantRootSignedRecoveryShareInstallationEvidenceV1,
            VerifiedTenantRootRecoveryResharePairV1,
        };
        let raw = TenantRootRecoveryReshareRoleCommandV1::decode_canonical_bytes(
            &decode_canonical_base64url(
                "recovery command",
                &request.generation_command_b64u,
                16384,
                32768,
            )?,
        )
        .map_err(derivation)?;
        let issuer = runtime
            .bindings()
            .issuer_verifying_keys
            .for_issuer_key_id(raw.issuer_key_id())
            .ok_or_else(|| refused("recovery generation issuer is not trusted"))?;
        let command = raw
            .verify(TwoPartyDeriverRole::DeriverA, raw.issuer_key_id(), issuer)
            .map_err(derivation)?;
        let context = command.context();
        let keys = crate::env::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(
            &CloudflareWorkerEnvReaderV1::new(env),
        )?;
        let key_a = keys.for_role_and_key_id(
            TwoPartyDeriverRole::DeriverA,
            context.signing_key_id(TwoPartyDeriverRole::DeriverA),
        )?;
        let key_b = keys.for_role_and_key_id(
            TwoPartyDeriverRole::DeriverB,
            context.signing_key_id(TwoPartyDeriverRole::DeriverB),
        )?;
        let a =
            TenantRootSignedRecoveryShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
                &decode_canonical_base64url(
                    "recovery A evidence",
                    &request.evidence_a_b64u,
                    16384,
                    32768,
                )?,
                context,
                key_a,
            )
            .map_err(derivation)?;
        let b =
            TenantRootSignedRecoveryShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
                &decode_canonical_base64url(
                    "recovery B evidence",
                    &request.evidence_b_b64u,
                    16384,
                    32768,
                )?,
                context,
                key_b,
            )
            .map_err(derivation)?;
        let pair = VerifiedTenantRootRecoveryResharePairV1::verify(context, &a, &b, key_a, key_b)
            .map_err(derivation)?;
        let time = worker::js_sys::Date::new(&worker::wasm_bindgen::JsValue::from_f64(
            context.issued_at_ms() as f64,
        ))
        .to_iso_string()
        .as_string()
        .ok_or_else(|| refused("invalid recovery creation time"))?;
        let descriptor = TenantRootRecoveryDescriptorV1::from_verified_reshare(&pair, time)
            .map_err(derivation)?;
        let package_a = TenantRootRecoveryPackageV1::decode(&decode_canonical_base64url(
            "recovery A package",
            &request.package_a_b64u,
            16384,
            32768,
        )?)
        .map_err(derivation)?;
        let package_b = TenantRootRecoveryPackageV1::decode(&decode_canonical_base64url(
            "recovery B package",
            &request.package_b_b64u,
            16384,
            32768,
        )?)
        .map_err(derivation)?;
        let seed = load_issuer_seed(env, runtime)?;
        let manifest = TenantRootRecoveryManifestV1::sign(
            descriptor,
            &package_a,
            &package_b,
            request.deriver_a_certificate_chain,
            request.deriver_b_certificate_chain,
            request.control_plane_certificate_chain,
            &seed,
        )
        .map_err(derivation)?;
        let bytes = manifest.canonical_json().map_err(derivation)?;
        // Caller-supplied chains must terminate at locally configured roots.
        let (_, trust) = verify_recovery_manifest_with_local_trust_v1(
            &bytes,
            &CloudflareWorkerEnvReaderV1::new(env),
        )?;
        manifest
            .verify_packages(&package_a, &package_b, trust.trusted_verifying_keys())
            .map_err(derivation)?;
        Ok(serde_json::json!({
            "manifest_b64u": encode_base64url_bytes_v1(&bytes),
            "verified": recovery_manifest_response_v1(&manifest, &trust)?,
        }))
    }

    /// Verifies one public recovery manifest against this Worker's configured
    /// roots and returns only the authenticated descriptor context.
    pub async fn handle_cloudflare_tenant_root_control_plane_register_manifest_v1(
        request: CloudflareTenantRootControlPlaneRegisterManifestRequestV1,
        env: &worker::Env,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneRegisterManifestResponseV1> {
        let manifest_bytes = decode_canonical_base64url(
            "tenant-root recovery manifest",
            &request.manifest_b64u,
            TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES,
            TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES * 2,
        )?;
        let (manifest, trust) = verify_recovery_manifest_with_local_trust_v1(
            &manifest_bytes,
            &CloudflareWorkerEnvReaderV1::new(env),
        )?;
        recovery_manifest_response_v1(&manifest, &trust)
    }

    /// Verifies an admitted restore grant and manifest, then signs the exact
    /// role-import command consumed by a destination Deriver.
    pub async fn handle_cloudflare_tenant_root_control_plane_restore_role_import_key_v1(
        request: CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneRestoreRoleImportKeyResponseV1>
    {
        let grant_bytes = decode_canonical_base64url(
            "tenant-root restore role-import grant",
            &request.restore_grant_b64u,
            TENANT_ROOT_RESTORE_ROLE_IMPORT_GRANT_MAX_BYTES_V1,
            TENANT_ROOT_RESTORE_ROLE_IMPORT_GRANT_MAX_BYTES_V1 * 2,
        )?;
        let grant = TenantRootRestoreRoleImportGrantV1::decode_canonical_bytes(&grant_bytes)
            .map_err(derivation)?;
        let grant_key_id = grant.grant_key_id().to_owned();
        let Some(trusted_grant_key) = runtime
            .bindings()
            .grant_authority_verifying_keys
            .for_grant_key_id(&grant_key_id)
        else {
            return Err(refused(
                "tenant-root restore role-import grant authority is not trusted by this control plane",
            ));
        };
        let verified_grant = grant
            .verify(&grant_key_id, trusted_grant_key)
            .map_err(derivation)?;
        // The Deriver checks its durable replay row before grant freshness so
        // an accepted command can be reconciled after an unknown delivery.

        let manifest_bytes = decode_canonical_base64url(
            "tenant-root recovery manifest",
            &request.manifest_b64u,
            TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES,
            TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES * 2,
        )?;
        let (manifest, _trust) = verify_recovery_manifest_with_local_trust_v1(
            &manifest_bytes,
            &CloudflareWorkerEnvReaderV1::new(env),
        )?;
        if manifest.digest().map_err(derivation)? != *verified_grant.manifest_digest() {
            return Err(refused(
                "tenant-root restore role-import manifest digest does not match its grant",
            ));
        }
        if manifest.descriptor().tenant_root_identity_digest()
            != verified_grant.destination_identity_digest()
        {
            return Err(refused(
                "tenant-root restore role-import manifest identity does not match its destination grant",
            ));
        }

        let issuer_seed = load_issuer_seed(env, runtime)?;
        let command = TenantRootRestoreRoleImportCommandV1::sign(
            &verified_grant,
            &manifest,
            runtime.bindings().issuer_signing_key.signing_key_id(),
            &issuer_seed,
        )
        .map_err(derivation)?;
        Ok(
            CloudflareTenantRootControlPlaneRestoreRoleImportKeyResponseV1 {
                issuer_key_id: runtime
                    .bindings()
                    .issuer_signing_key
                    .signing_key_id()
                    .to_owned(),
                role_import_command_b64u: encode_base64url_bytes_v1(
                    &command.canonical_bytes().map_err(derivation)?,
                ),
            },
        )
    }

    /// Verifies an admitted restore-refresh grant and manifest, then signs the
    /// deterministic A/B commands consumed by the destination Derivers.
    pub async fn handle_cloudflare_tenant_root_control_plane_restore_refresh_commands_v1(
        request: CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneRestoreRefreshCommandsResponseV1>
    {
        let grant_bytes = decode_canonical_base64url(
            "tenant-root restore refresh grant",
            &request.restore_refresh_grant_b64u,
            router_ab_core::TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1,
            router_ab_core::TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1 * 2,
        )?;
        let grant = TenantRootRestoreRefreshGrantV1::decode_canonical_bytes(&grant_bytes)
            .map_err(derivation)?;
        let grant_key_id = grant.grant_key_id().to_owned();
        let Some(trusted_grant_key) = runtime
            .bindings()
            .grant_authority_verifying_keys
            .for_grant_key_id(&grant_key_id)
        else {
            return Err(refused(
                "tenant-root restore refresh grant authority is not trusted by this control plane",
            ));
        };
        let verified_grant = grant
            .verify(&grant_key_id, trusted_grant_key)
            .map_err(derivation)?;
        verified_grant
            .require_fresh(crate::cloudflare_now_unix_ms_v1()?)
            .map_err(derivation)?;

        let manifest_bytes = decode_canonical_base64url(
            "tenant-root recovery manifest",
            &request.manifest_b64u,
            TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES,
            TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES * 2,
        )?;
        let (manifest, _trust) = verify_recovery_manifest_with_local_trust_v1(
            &manifest_bytes,
            &CloudflareWorkerEnvReaderV1::new(env),
        )?;
        let bindings = runtime.bindings();
        let issuer_seed = load_issuer_seed(env, runtime)?;
        let issued = issue_tenant_root_restore_refresh_commands_v1(
            &verified_grant,
            &manifest,
            &bindings.deriver_a_signing_key_id,
            &bindings.deriver_b_signing_key_id,
            bindings.issuer_signing_key.signing_key_id(),
            &issuer_seed,
        )?;
        Ok(
            CloudflareTenantRootControlPlaneRestoreRefreshCommandsResponseV1 {
                refresh_context_b64u: encode_base64url_bytes_v1(
                    &issued.context.canonical_bytes().map_err(derivation)?,
                ),
                deriver_a_refresh_command_b64u: encode_base64url_bytes_v1(
                    &issued.deriver_a.canonical_bytes().map_err(derivation)?,
                ),
                deriver_b_refresh_command_b64u: encode_base64url_bytes_v1(
                    &issued.deriver_b.canonical_bytes().map_err(derivation)?,
                ),
                issuer_key_id: bindings.issuer_signing_key.signing_key_id().to_owned(),
            },
        )
    }

    /// Reads authoritative creation state from the Router-owned Durable Object
    /// through this Worker's own external binding.
    /// Derives the creation object's name and its authority id from a tenant.
    ///
    /// The authority id IS the Durable Object id: derived here from the identity
    /// and lineage, never read from a request.
    pub(crate) fn read_creation_object_binding(
        env: &worker::Env,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<(TenantRootControlPlaneAuthorityIdV1, String)> {
        derive_tenant_root_creation_authority_object_v1(env, identity_digest, custody_lineage)
    }

    async fn read_creation_state(
        env: &worker::Env,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<(
        TenantRootControlPlaneAuthorityIdV1,
        CloudflareTenantRootCreationJournalReadResponseV1,
    )> {
        let namespace = env
            .durable_object(ROUTER_TENANT_ROOT_CREATION_DO_BINDING_V1)
            .map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MissingLocalBinding,
                    format!("tenant-root creation Durable Object binding is unavailable: {error}"),
                )
            })?;
        let (authority_id, object_name) =
            read_creation_object_binding(env, identity_digest, custody_lineage)?;
        let stub = namespace.get_by_name(&object_name).map_err(|error| {
            local(format!(
                "tenant-root creation Durable Object stub lookup failed: {error}"
            ))
        })?;
        let body = serde_json::to_string(&CloudflareTenantRootCreationJournalReadRequestV1 {
            identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
            custody_lineage_b64u: encode_base64url_bytes_v1(custody_lineage.as_bytes()),
        })
        .map_err(|error| {
            local(format!(
                "tenant-root creation read request encoding failed: {error}"
            ))
        })?;
        let headers = worker::Headers::new();
        headers
            .set("content-type", "application/json")
            .map_err(|error| local(format!("tenant-root creation read headers failed: {error}")))?;
        crate::set_cloudflare_internal_service_auth_header_v1(
            env,
            &headers,
            "tenant-root creation read",
        )?;
        let mut init = worker::RequestInit::new();
        init.with_method(worker::Method::Post)
            .with_headers(headers)
            .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
        let request = worker::Request::new_with_init(
            &format!(
                "https://router-ab-do.internal{CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_READ_PATH}"
            ),
            &init,
        )
        .map_err(|error| {
            local(format!(
                "tenant-root creation read request construction failed: {error}"
            ))
        })?;
        let mut response = stub
            .fetch_with_request(request)
            .await
            .map_err(|error| local(format!("tenant-root creation read request failed: {error}")))?;
        if response.status_code() != 200 {
            return Err(refused(
                "tenant-root creation Durable Object refused the read",
            ));
        }
        let parsed: CloudflareTenantRootCreationJournalReadResponseV1 =
            response.json().await.map_err(|error| {
                local(format!(
                    "tenant-root creation read response decoding failed: {error}"
                ))
            })?;
        Ok((authority_id, parsed))
    }

    fn creation_status(
        state: &CloudflareTenantRootCreationJournalReadResponseV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootCreationStatusV1> {
        match (&state.installation_checkpoint, state.cleanup_checkpointed) {
            (CloudflareTenantRootCreationInstallationCheckpointReadStateV1::None, false) => {
                Ok(CloudflareTenantRootCreationStatusV1::Pending)
            }
            (
                CloudflareTenantRootCreationInstallationCheckpointReadStateV1::OneRoleReady {
                    role,
                    ..
                },
                false,
            ) => Ok(CloudflareTenantRootCreationStatusV1::OneRoleInstalled {
                role: CloudflareTenantRootControlPlaneRoleV1::from_protocol(role.to_protocol()),
            }),
            (
                CloudflareTenantRootCreationInstallationCheckpointReadStateV1::BothRolesReady {
                    root_commitment_b64u,
                },
                false,
            ) => Ok(CloudflareTenantRootCreationStatusV1::Ready {
                root_commitment_b64u: root_commitment_b64u.clone(),
            }),
            (
                CloudflareTenantRootCreationInstallationCheckpointReadStateV1::OneRoleReady {
                    role,
                    ..
                },
                true,
            ) => Ok(CloudflareTenantRootCreationStatusV1::Abandoned {
                role: CloudflareTenantRootControlPlaneRoleV1::from_protocol(role.to_protocol()),
            }),
            _ => Err(refused(
                "tenant-root creation Durable Object returned an invalid cleanup state",
            )),
        }
    }

    /// The typed issuer operation: mint one role creation command.
    pub async fn handle_cloudflare_tenant_root_control_plane_role_creation_command_v1(
        request: CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneRoleCreationCommandResponseV1> {
        let identity_digest = TenantRootIdentityDigestV1::from_bytes(
            decode_canonical_base64url(
                "tenant-root control-plane identity digest",
                &request.identity_digest_b64u,
                32,
                48,
            )?
            .as_slice()
            .try_into()
            .map_err(|_| refused("tenant-root control-plane identity digest length is invalid"))?,
        );
        let custody_lineage = TenantRootCustodyLineageId::from_bytes(
            decode_canonical_base64url(
                "tenant-root control-plane custody lineage",
                &request.custody_lineage_b64u,
                16,
                24,
            )?
            .as_slice()
            .try_into()
            .map_err(|_| refused("tenant-root control-plane custody lineage length is invalid"))?,
        )
        .map_err(|error| {
            refused_owned(format!(
                "tenant-root control-plane custody lineage is invalid: {error}"
            ))
        })?;

        let (authority_id, read) =
            read_creation_state(env, identity_digest, custody_lineage).await?;
        // Re-validate the returned bytes against OUR published keys and OUR derived
        // authority id: the object is authoritative, but the issuer trusts nothing
        // it did not verify itself.
        let record = CloudflareTenantRootCreationJournalRecordV1 {
            journal_b64u: read.journal_b64u.clone(),
            creation_capability_b64u: read.creation_capability_b64u.clone(),
        };
        let journal = validate_creation_record(
            record,
            authority_id,
            runtime.bindings().issuer_verifying_keys.keys(),
        )?;
        if journal.identity_digest != identity_digest || journal.custody_lineage != custody_lineage
        {
            return Err(refused(
                "tenant-root creation state does not name the requested identity and lineage",
            ));
        }
        let progress = TenantRootCreationProgressV1::from_read_response(&read);
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;

        let binding = &runtime.bindings().issuer_signing_key;
        let secret = env.secret(binding.binding_name()).map_err(|error| {
            crate::worker_binding_error(
                crate::worker_binding_error_code(&error, binding.binding_name()),
                binding.binding_name(),
                "secret",
                error,
            )
        })?;
        let mut secret_value = secret.to_string();
        let seed =
            decode_cloudflare_tenant_root_control_plane_issuer_signing_secret_v1(&secret_value);
        secret_value.zeroize();
        let seed = seed?;

        let issued = issue_tenant_root_role_creation_command_v1(
            TenantRootRoleCreationCommandIssuanceV1 {
                journal: &journal,
                progress: &progress,
                role: request.role.to_protocol(),
                authority_id,
                now_ms,
            },
            binding.signing_key_id(),
            &seed,
        )?;
        Ok(
            CloudflareTenantRootControlPlaneRoleCreationCommandResponseV1 {
                role: request.role,
                issuer_key_id: binding.signing_key_id().to_owned(),
                role_creation_command_b64u: encode_base64url_bytes_v1(
                    &issued.command.canonical_bytes().map_err(derivation)?,
                ),
                role_creation_command_package_b64u: encode_base64url_bytes_v1(
                    &issued.package.canonical_bytes().map_err(derivation)?,
                ),
            },
        )
    }

    /// Mints one fresh A/B refresh command pair from authoritative active state.
    pub async fn handle_cloudflare_tenant_root_control_plane_refresh_commands_v1(
        request: CloudflareTenantRootControlPlaneRefreshCommandsRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneRefreshCommandsResponseV1> {
        let identity_digest = TenantRootIdentityDigestV1::from_bytes(
            decode_canonical_base64url(
                "tenant-root refresh identity digest",
                &request.identity_digest_b64u,
                32,
                48,
            )?
            .as_slice()
            .try_into()
            .map_err(|_| refused("tenant-root refresh identity digest length is invalid"))?,
        );
        let custody_lineage = TenantRootCustodyLineageId::from_bytes(
            decode_canonical_base64url(
                "tenant-root refresh custody lineage",
                &request.custody_lineage_b64u,
                16,
                24,
            )?
            .as_slice()
            .try_into()
            .map_err(|_| refused("tenant-root refresh custody lineage length is invalid"))?,
        )
        .map_err(derivation)?;
        let active =
            execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1(
                env,
                identity_digest,
                custody_lineage,
            )
            .await?;
        let authority_id = active.activation_receipt.binding().authority_id();
        let active_pair = TenantRootActiveRootPairV1::from_verified_activation_receipt(
            &active.activation_receipt,
        )
        .map_err(derivation)?;
        let session_bytes: [u8; 16] = crate::cloudflare_random_bytes_v1(16)?
            .try_into()
            .map_err(|_| refused("tenant-root refresh session generation failed"))?;
        let nonce_bytes: [u8; 32] = crate::cloudflare_random_bytes_v1(32)?
            .try_into()
            .map_err(|_| refused("tenant-root refresh nonce generation failed"))?;
        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let expires_at_ms = now_ms.saturating_add(TENANT_ROOT_MAX_LIFETIME_MS_V1);
        let bindings = runtime.bindings();
        let refresh_context = TenantRootCeremonyContextV1::new(
            identity_digest,
            custody_lineage,
            TenantRootCeremonyEpochsV1::refresh(
                active_pair.epoch(),
                active_pair.epoch().next().map_err(derivation)?,
            )
            .map_err(derivation)?,
            TenantRootCeremonySessionIdV1::from_bytes(session_bytes).map_err(derivation)?,
            TenantRootCeremonyNonceV1::from_bytes(nonce_bytes).map_err(derivation)?,
            now_ms,
            expires_at_ms,
            bindings.deriver_a_signing_key_id.clone(),
            bindings.deriver_b_signing_key_id.clone(),
        )
        .map_err(derivation)?;
        let issuer_seed = load_issuer_seed(env, runtime)?;
        let issued = issue_tenant_root_role_refresh_commands_v1(
            TenantRootRoleRefreshCommandIssuanceV1 {
                active_pair: &active_pair,
                refresh_context: &refresh_context,
                expected_control_plane_revision: active.lifecycle_revision,
                authority_id,
                now_ms,
            },
            bindings.issuer_signing_key.signing_key_id(),
            &issuer_seed,
        )?;
        Ok(CloudflareTenantRootControlPlaneRefreshCommandsResponseV1 {
            refresh_context_b64u: encode_base64url_bytes_v1(
                &refresh_context.canonical_bytes().map_err(derivation)?,
            ),
            deriver_a_refresh_command_b64u: encode_base64url_bytes_v1(
                &issued.deriver_a.canonical_bytes().map_err(derivation)?,
            ),
            deriver_b_refresh_command_b64u: encode_base64url_bytes_v1(
                &issued.deriver_b.canonical_bytes().map_err(derivation)?,
            ),
            issuer_key_id: bindings.issuer_signing_key.signing_key_id().to_owned(),
        })
    }

    fn decode_managed_restore_scope_v1(
        identity_digest_b64u: &str,
        custody_lineage_b64u: &str,
    ) -> RouterAbProtocolResult<(TenantRootIdentityDigestV1, TenantRootCustodyLineageId)> {
        let identity_digest = TenantRootIdentityDigestV1::from_bytes(
            decode_canonical_base64url(
                "tenant-root managed-restore identity digest",
                identity_digest_b64u,
                32,
                48,
            )?
            .as_slice()
            .try_into()
            .map_err(|_| {
                refused("tenant-root managed-restore identity digest length is invalid")
            })?,
        );
        let custody_lineage = TenantRootCustodyLineageId::from_bytes(
            decode_canonical_base64url(
                "tenant-root managed-restore custody lineage",
                custody_lineage_b64u,
                16,
                24,
            )?
            .as_slice()
            .try_into()
            .map_err(|_| {
                refused("tenant-root managed-restore custody lineage length is invalid")
            })?,
        )
        .map_err(derivation)?;
        Ok((identity_digest, custody_lineage))
    }

    fn decode_managed_restore_digest_v1(
        field: &'static str,
        encoded: &str,
    ) -> RouterAbProtocolResult<TenantRootLifecycleReceiptDigestV1> {
        TenantRootLifecycleReceiptDigestV1::from_bytes(
            decode_canonical_base64url(field, encoded, 32, 48)?
                .as_slice()
                .try_into()
                .map_err(|_| refused("tenant-root managed-restore digest length is invalid"))?,
        )
        .map_err(derivation)
    }

    fn managed_restore_incident_binding_v1(
        challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<TenantRootManagedRestoreIncidentAuthorizationBindingV1> {
        let (identity_digest, custody_lineage) = decode_managed_restore_scope_v1(
            &challenge.identity_digest_b64u,
            &challenge.custody_lineage_b64u,
        )?;
        let nonce = TenantRootManagedRestoreIncidentNonceV1::from_bytes(
            decode_canonical_base64url(
                "tenant-root managed-restore incident nonce",
                &challenge.nonce_b64u,
                32,
                48,
            )?
            .as_slice()
            .try_into()
            .map_err(|_| refused("tenant-root managed-restore incident nonce length is invalid"))?,
        )
        .map_err(derivation)?;
        let custody = &runtime.bindings().custody_authority_verifiers;
        let (custody_authority_id, custody_key_id) = match challenge.unavailable_role {
            TenantRootManagedRestoreRoleV1::DeriverA => {
                (custody.deriver_a_authority_id(), custody.deriver_a_key_id())
            }
            TenantRootManagedRestoreRoleV1::DeriverB => {
                (custody.deriver_b_authority_id(), custody.deriver_b_key_id())
            }
        };
        let operations = &runtime.bindings().operations_incident_verifier;
        TenantRootManagedRestoreIncidentAuthorizationBindingV1::new(
            challenge.incident_id.clone(),
            identity_digest,
            custody_lineage,
            challenge.unavailable_role,
            TenantRootShareEpoch::new(challenge.active_epoch).map_err(derivation)?,
            decode_managed_restore_digest_v1(
                "tenant-root managed-restore activation receipt digest",
                &challenge.activation_receipt_digest_b64u,
            )?,
            decode_managed_restore_digest_v1(
                "tenant-root managed-restore outage observation digest",
                &challenge.outage_observation_digest_b64u,
            )?,
            challenge.issued_at_ms,
            challenge.expires_at_ms,
            nonce,
            operations.authority_id(),
            operations.key_id(),
            custody_authority_id,
            custody_key_id,
        )
        .map_err(derivation)
    }

    fn managed_restore_custody_verifying_key_v1(
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
        role: TenantRootManagedRestoreRoleV1,
    ) -> [u8; 32] {
        let custody = &runtime.bindings().custody_authority_verifiers;
        match role {
            TenantRootManagedRestoreRoleV1::DeriverA => *custody.deriver_a(),
            TenantRootManagedRestoreRoleV1::DeriverB => *custody.deriver_b(),
        }
    }

    /// Reserves one authoritative managed-restore challenge.
    pub async fn handle_cloudflare_tenant_root_control_plane_managed_restore_challenge_v1(
        request: CloudflareTenantRootControlPlaneManagedRestoreChallengeRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneManagedRestoreChallengeResponseV1>
    {
        let (identity_digest, custody_lineage) = decode_managed_restore_scope_v1(
            &request.identity_digest_b64u,
            &request.custody_lineage_b64u,
        )?;
        let challenge =
            execute_cloudflare_router_tenant_root_managed_restore_authorization_challenge_call_v1(
                env,
                identity_digest,
                custody_lineage,
                CloudflareTenantRootManagedRestoreAuthorizationRequestV1 {
                    incident_id: request.incident_id,
                    outage_observation_digest_b64u: request.outage_observation_digest_b64u,
                    issued_at_ms: request.issued_at_ms,
                    expires_at_ms: request.expires_at_ms,
                    nonce_b64u: request.nonce_b64u,
                    unavailable_role: request.unavailable_role,
                },
            )
            .await?;
        let binding = managed_restore_incident_binding_v1(&challenge, runtime)?;
        Ok(
            CloudflareTenantRootControlPlaneManagedRestoreChallengeResponseV1 {
                authorization_binding_b64u: encode_base64url_bytes_v1(
                    &binding.canonical_bytes().map_err(derivation)?,
                ),
                challenge,
            },
        )
    }

    /// Verifies both incident authorities and checkpoints exact issuer artifacts.
    pub async fn handle_cloudflare_tenant_root_control_plane_managed_restore_authorize_v1(
        request: CloudflareTenantRootControlPlaneManagedRestoreAuthorizeRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneManagedRestoreAuthorizeResponseV1>
    {
        let (identity_digest, custody_lineage) = decode_managed_restore_scope_v1(
            &request.identity_digest_b64u,
            &request.custody_lineage_b64u,
        )?;
        let active =
            execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1(
                env,
                identity_digest,
                custody_lineage,
            )
            .await?;
        let (challenge, attempt, terminal) = match &active.managed_restore_fence {
            CloudflareTenantRootManagedRestoreFenceV1::Open => {
                return Err(refused(
                    "tenant-root managed-restore authorization requires a reserved challenge",
                ));
            }
            CloudflareTenantRootManagedRestoreFenceV1::Reserved { challenge, attempt } => {
                (challenge.clone(), attempt.clone(), None)
            }
            CloudflareTenantRootManagedRestoreFenceV1::Terminal {
                challenge,
                attempt,
                public_state_b64u,
                capability_b64u,
                incident_authorization_b64u,
            } => (
                challenge.clone(),
                attempt.clone(),
                Some((
                    public_state_b64u.clone(),
                    capability_b64u.clone(),
                    incident_authorization_b64u.clone(),
                )),
            ),
        };
        let expected = managed_restore_incident_binding_v1(&challenge, runtime)?;
        let authorization_bytes = decode_canonical_base64url(
            "tenant-root managed-restore incident authorization",
            &request.incident_authorization_b64u,
            router_ab_core::TENANT_ROOT_MANAGED_RESTORE_INCIDENT_AUTHORIZATION_MAX_BYTES_V1,
            router_ab_core::TENANT_ROOT_MANAGED_RESTORE_INCIDENT_AUTHORIZATION_MAX_BYTES_V1 * 2,
        )?;
        let custody_verifying_key =
            managed_restore_custody_verifying_key_v1(runtime, challenge.unavailable_role);
        let verified =
            TenantRootSignedManagedRestoreIncidentAuthorizationV1::decode_and_verify_canonical_bytes(
                &authorization_bytes,
                &expected,
                &runtime
                    .bindings()
                    .operations_incident_verifier
                    .verifying_key_bytes(),
                &custody_verifying_key,
            )
            .map_err(derivation)?;
        if let Some((public_state_b64u, capability_b64u, incident_authorization_b64u)) = terminal {
            if incident_authorization_b64u != request.incident_authorization_b64u {
                return Err(refused(
                    "tenant-root managed-restore terminal authorization retry changed bytes",
                ));
            }
            return Ok(
                CloudflareTenantRootControlPlaneManagedRestoreAuthorizeResponseV1 {
                    public_state_b64u,
                    capability_b64u,
                    incident_authorization_b64u,
                },
            );
        }
        verified
            .require_fresh(crate::cloudflare_now_unix_ms_v1()?)
            .map_err(derivation)?;

        let identity_bytes = decode_canonical_base64url(
            "tenant-root managed-restore identity",
            &challenge.identity_b64u,
            16 * 1024,
            24 * 1024,
        )?;
        let identity =
            TenantRootIdentityV1::decode_canonical_bytes(&identity_bytes).map_err(derivation)?;
        let active_refresh = TenantRootActiveRefreshV1::from_verified_activation_receipt(
            identity,
            active.activation_receipt,
            active.lifecycle_revision,
        )
        .map_err(derivation)?;
        let unavailable_receipt = TenantRootRoleUnavailableReceiptV1::new(
            verified.outage_observation_digest(),
            verified.unavailable_role(),
            verified.issued_at_ms(),
        )
        .map_err(derivation)?;
        let unavailable = TenantRootManagedRestoreAvailableV1::new(active_refresh)
            .map_err(derivation)?
            .mark_role_unavailable(unavailable_receipt)
            .map_err(derivation)?;
        let seed = load_issuer_seed(env, runtime)?;
        let issuer_key_id = runtime.bindings().issuer_signing_key.signing_key_id();
        let signed_public_state = TenantRootSignedManagedRestoreRoleUnavailableV1::sign(
            &unavailable,
            issuer_key_id,
            &seed,
        )
        .map_err(derivation)?;
        let capability_digest =
            TenantRootLifecycleReceiptDigestV1::from_bytes(*verified.digest().as_bytes())
                .map_err(derivation)?;
        let capability = TenantRootManagedRestoreCapabilityV1::new(
            capability_digest,
            verified.identity_digest(),
            verified.custody_lineage(),
            verified.unavailable_role(),
            verified.current_epoch(),
            verified.activation_receipt_digest(),
            verified.issued_at_ms(),
            verified.expires_at_ms(),
        )
        .map_err(derivation)?;
        let signed_capability =
            TenantRootSignedManagedRestoreCapabilityV1::sign(capability, issuer_key_id, &seed)
                .map_err(derivation)?;
        let public_state_b64u =
            encode_base64url_bytes_v1(&signed_public_state.canonical_bytes().map_err(derivation)?);
        let capability_b64u =
            encode_base64url_bytes_v1(&signed_capability.canonical_bytes().map_err(derivation)?);
        let checkpoint = CloudflareTenantRootManagedRestoreAuthorizationCheckpointV1 {
            challenge,
            attempt,
            public_state_b64u: public_state_b64u.clone(),
            capability_b64u: capability_b64u.clone(),
            incident_authorization_b64u: request.incident_authorization_b64u.clone(),
        };
        execute_cloudflare_router_tenant_root_managed_restore_authorization_checkpoint_call_v1(
            env,
            identity_digest,
            custody_lineage,
            checkpoint,
        )
        .await?;
        Ok(
            CloudflareTenantRootControlPlaneManagedRestoreAuthorizeResponseV1 {
                public_state_b64u,
                capability_b64u,
                incident_authorization_b64u: request.incident_authorization_b64u,
            },
        )
    }

    /// Issues cleanup for the exact sole role installation recorded by the DO.
    pub async fn handle_cloudflare_tenant_root_control_plane_cleanup_command_v1(
        request: CloudflareTenantRootControlPlaneCleanupCommandRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneCleanupCommandResponseV1> {
        let (identity_digest_b64u, custody_lineage_b64u, retired_request) = match request {
            CloudflareTenantRootControlPlaneCleanupCommandRequestV1::PendingCreation {
                identity_digest_b64u,
                custody_lineage_b64u,
            } => (identity_digest_b64u, custody_lineage_b64u, None),
            CloudflareTenantRootControlPlaneCleanupCommandRequestV1::RetiredAfterRefresh {
                identity_digest_b64u,
                custody_lineage_b64u,
                role,
                expected_retired_revision,
                expected_active_revision,
            } => (
                identity_digest_b64u,
                custody_lineage_b64u,
                Some((role, expected_retired_revision, expected_active_revision)),
            ),
        };
        let identity_digest = TenantRootIdentityDigestV1::from_bytes(
            decode_canonical_base64url(
                "tenant-root cleanup identity digest",
                &identity_digest_b64u,
                32,
                48,
            )?
            .as_slice()
            .try_into()
            .map_err(|_| refused("tenant-root cleanup identity digest length is invalid"))?,
        );
        let custody_lineage = TenantRootCustodyLineageId::from_bytes(
            decode_canonical_base64url(
                "tenant-root cleanup custody lineage",
                &custody_lineage_b64u,
                16,
                24,
            )?
            .as_slice()
            .try_into()
            .map_err(|_| refused("tenant-root cleanup custody lineage length is invalid"))?,
        )
        .map_err(derivation)?;
        if let Some((role, expected_retired_revision, expected_active_revision)) = retired_request {
            return issue_retired_tenant_root_cleanup_command_v1(
                env,
                runtime,
                identity_digest,
                custody_lineage,
                role,
                expected_retired_revision,
                expected_active_revision,
            )
            .await;
        }
        let (authority_id, read) =
            read_creation_state(env, identity_digest, custody_lineage).await?;
        if read.cleanup_checkpointed {
            return Err(refused(
                "tenant-root creation is already abandoned and cleaned",
            ));
        }
        let record = CloudflareTenantRootCreationJournalRecordV1 {
            journal_b64u: read.journal_b64u.clone(),
            creation_capability_b64u: read.creation_capability_b64u.clone(),
        };
        let journal = validate_creation_record(
            record,
            authority_id,
            runtime.bindings().issuer_verifying_keys.keys(),
        )?;
        if journal.identity_digest != identity_digest || journal.custody_lineage != custody_lineage
        {
            return Err(refused(
                "tenant-root cleanup state does not name the requested identity and lineage",
            ));
        }
        let CloudflareTenantRootCreationInstallationCheckpointReadStateV1::OneRoleReady {
            role,
            signed_evidence_b64u,
        } = read.installation_checkpoint
        else {
            return Err(refused(
                "tenant-root cleanup requires exactly one installed role",
            ));
        };
        let role = role.to_protocol();
        let evidence_bytes = decode_canonical_base64url(
            "tenant-root cleanup installation evidence",
            &signed_evidence_b64u,
            router_ab_core::TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1,
            router_ab_core::TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1 * 2,
        )?;
        let (expected_key_id, verifying_key) = match role {
            TwoPartyDeriverRole::DeriverA => (
                runtime.bindings().deriver_a_signing_key_id.as_str(),
                &runtime.bindings().deriver_a_verifying_key,
            ),
            TwoPartyDeriverRole::DeriverB => (
                runtime.bindings().deriver_b_signing_key_id.as_str(),
                &runtime.bindings().deriver_b_verifying_key,
            ),
        };
        if journal.ceremony_context.signing_key_id(role) != expected_key_id {
            return Err(refused(
                "tenant-root cleanup evidence names a retired role signing key",
            ));
        }
        let evidence =
            TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
                &evidence_bytes,
                verifying_key,
            )
            .map_err(derivation)?;
        if evidence.evidence().transcript().context() != &journal.ceremony_context
            || evidence.evidence().transcript().role() != role
        {
            return Err(refused(
                "tenant-root cleanup evidence belongs to a different ceremony or role",
            ));
        }
        let installation_evidence_digest =
            TenantRootProtocolDigestV1::from_bytes(Sha256::digest(&evidence_bytes).into())
                .map_err(derivation)?;
        let target = TenantRootRoleCleanupTargetV1::Pending {
            identity_digest,
            custody_lineage,
            role,
            epoch: TenantRootShareEpoch::INITIAL,
            expected_row_revision: 1,
            session_id: journal.ceremony_context.session_id(),
            ceremony_nonce: journal.ceremony_context.nonce(),
            installation_evidence_digest,
        };
        let mut nonce_hasher = Sha256::new();
        nonce_hasher.update(b"seams/tenant-root/creation-cleanup-nonce/v1");
        nonce_hasher.update(journal.journal_digest.as_bytes());
        nonce_hasher.update(installation_evidence_digest.as_bytes());
        let cleanup_nonce = TenantRootCeremonyNonceV1::from_bytes(nonce_hasher.finalize().into())
            .map_err(derivation)?;
        let seed = load_issuer_seed(env, runtime)?;
        let command = TenantRootRoleCleanupCommandV1::sign(
            &target,
            authority_id,
            cleanup_nonce,
            journal.ceremony_context.issued_at_ms(),
            journal.ceremony_context.expires_at_ms(),
            runtime.bindings().issuer_signing_key.signing_key_id(),
            &seed,
        )
        .map_err(derivation)?;
        Ok(CloudflareTenantRootControlPlaneCleanupCommandResponseV1 {
            role: CloudflareTenantRootControlPlaneRoleV1::from_protocol(role),
            cleanup_command_b64u: encode_base64url_bytes_v1(
                &command.canonical_bytes().map_err(derivation)?,
            ),
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn issue_retired_tenant_root_cleanup_command_v1(
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        role: CloudflareTenantRootControlPlaneRoleV1,
        expected_retired_revision: i64,
        expected_active_revision: i64,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneCleanupCommandResponseV1> {
        if expected_retired_revision <= 0 || expected_active_revision <= 0 {
            return Err(refused(
                "tenant-root retired cleanup requires positive role-store revisions",
            ));
        }
        let active =
            execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1(
                env,
                identity_digest,
                custody_lineage,
            )
            .await?;
        if active.activation_receipt.identity_digest() != identity_digest
            || active.activation_receipt.custody_lineage() != custody_lineage
            || active.activation_receipt.result_control_plane_revision()
                != active.lifecycle_revision
        {
            return Err(refused(
                "tenant-root retired cleanup active state does not match its Router-owned record",
            ));
        }
        let router_ab_core::TenantRootActivationReceiptBindingV1::RefreshSwap(binding) =
            active.activation_receipt.binding()
        else {
            return Err(refused(
                "tenant-root retired cleanup requires an activated refresh successor",
            ));
        };
        let role_protocol = role.to_protocol();
        let target = TenantRootRoleCleanupTargetV1::Retired {
            identity_digest,
            custody_lineage,
            role: role_protocol,
            retired_epoch: binding.current_epoch(),
            expected_retired_revision,
            expected_active_epoch: binding.next_epoch(),
            expected_active_revision,
        };
        let issued_at_ms = crate::cloudflare_now_unix_ms_v1()?;
        let expires_at_ms = issued_at_ms.saturating_add(TENANT_ROOT_MAX_LIFETIME_MS_V1);
        let mut nonce_hasher = Sha256::new();
        nonce_hasher.update(b"seams/tenant-root/retired-cleanup-nonce/v1");
        nonce_hasher.update(active.activation_receipt.digest().as_bytes());
        nonce_hasher.update(match role_protocol {
            TwoPartyDeriverRole::DeriverA => b"deriver-a".as_slice(),
            TwoPartyDeriverRole::DeriverB => b"deriver-b".as_slice(),
        });
        nonce_hasher.update(expected_retired_revision.to_be_bytes());
        nonce_hasher.update(expected_active_revision.to_be_bytes());
        nonce_hasher.update(issued_at_ms.to_be_bytes());
        let cleanup_nonce = TenantRootCeremonyNonceV1::from_bytes(nonce_hasher.finalize().into())
            .map_err(derivation)?;
        let seed = load_issuer_seed(env, runtime)?;
        let command = TenantRootRoleCleanupCommandV1::sign(
            &target,
            binding.authority_id(),
            cleanup_nonce,
            issued_at_ms,
            expires_at_ms,
            runtime.bindings().issuer_signing_key.signing_key_id(),
            &seed,
        )
        .map_err(derivation)?;
        Ok(CloudflareTenantRootControlPlaneCleanupCommandResponseV1 {
            role,
            cleanup_command_b64u: encode_base64url_bytes_v1(
                &command.canonical_bytes().map_err(derivation)?,
            ),
        })
    }

    fn refused_owned(message: String) -> RouterAbProtocolError {
        RouterAbProtocolError::new(RouterAbProtocolErrorCode::ForbiddenLocalBinding, message)
    }

    /// Loads the issuer signing seed for one operation.
    fn load_issuer_seed(
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<Zeroizing<[u8; 32]>> {
        let binding = &runtime.bindings().issuer_signing_key;
        let secret = env.secret(binding.binding_name()).map_err(|error| {
            crate::worker_binding_error(
                crate::worker_binding_error_code(&error, binding.binding_name()),
                binding.binding_name(),
                "secret",
                error,
            )
        })?;
        let mut secret_value = secret.to_string();
        let seed =
            decode_cloudflare_tenant_root_control_plane_issuer_signing_secret_v1(&secret_value);
        secret_value.zeroize();
        seed
    }

    const TENANT_ROOT_SIGNED_MANAGED_BACKUP_MAX_BYTES_V1: usize = 72 * 1024;

    fn decode_verified_installation_evidence_v1(
        field: &'static str,
        encoded: &str,
        expected_role: TwoPartyDeriverRole,
        expected_signing_key_id: &str,
        verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<
        router_ab_core::VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    > {
        let bytes = decode_canonical_base64url(
            field,
            encoded,
            router_ab_core::TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1,
            router_ab_core::TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1 * 2,
        )?;
        let signed = TenantRootSignedShareInstallationEvidenceV1::decode_canonical_bytes(&bytes)
            .map_err(derivation)?;
        if signed.role() != expected_role || signed.signing_key_id() != expected_signing_key_id {
            return Err(refused(
                "tenant-root installation evidence names the wrong role signing key",
            ));
        }
        TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
            &bytes,
            verifying_key,
        )
        .map_err(derivation)
    }

    fn decode_verified_managed_backup_v1(
        field: &'static str,
        encoded: &str,
        expected_role: TenantRootManagedRestoreRoleV1,
        expected_signing_key_id: &str,
        verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<router_ab_core::VerifiedTenantRootManagedBackupV1> {
        let bytes = decode_canonical_base64url(
            field,
            encoded,
            TENANT_ROOT_SIGNED_MANAGED_BACKUP_MAX_BYTES_V1,
            TENANT_ROOT_SIGNED_MANAGED_BACKUP_MAX_BYTES_V1 * 2,
        )?;
        let signed =
            TenantRootSignedManagedBackupV1::decode_canonical_bytes(&bytes).map_err(derivation)?;
        if signed.binding().role() != expected_role
            || signed.binding().role_signing_key_id() != expected_signing_key_id
        {
            return Err(refused(
                "tenant-root managed backup names the wrong role signing key",
            ));
        }
        signed
            .verify(signed.binding(), verifying_key)
            .map_err(derivation)
    }

    fn decode_verified_provider_canary_v1(
        field: &'static str,
        encoded: &str,
        expected_family: TenantRootCanaryCurveFamilyV1,
        expected_signing_key_id: &str,
        verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<router_ab_core::VerifiedTenantRootProviderCanaryReceiptV1> {
        let bytes = decode_canonical_base64url(
            field,
            encoded,
            TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1,
            TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1 * 2,
        )?;
        let signed = TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(&bytes)
            .map_err(derivation)?;
        if signed.curve_family() != expected_family
            || signed.signing_key_id() != expected_signing_key_id
        {
            return Err(refused(
                "tenant-root provider canary names the wrong role signing key",
            ));
        }
        signed
            .verify(signed.binding(), verifying_key)
            .map_err(derivation)
    }

    struct VerifiedTenantRootRestoreRefreshPromotionV1 {
        command: VerifiedTenantRootRestoreRefreshRoleCommandV1,
        installation: router_ab_core::VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        provider_canary: router_ab_core::VerifiedTenantRootProviderCanaryReceiptV1,
        completed_at_ms: u64,
    }

    fn decode_verified_restore_refresh_role_command_v1(
        field: &'static str,
        encoded: &str,
        expected_role: TwoPartyDeriverRole,
        issuer_verifying_keys: &crate::CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    ) -> RouterAbProtocolResult<VerifiedTenantRootRestoreRefreshRoleCommandV1> {
        let bytes = decode_canonical_base64url(
            field,
            encoded,
            TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1,
            TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1 * 2,
        )?;
        let signed = TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&bytes)
            .map_err(derivation)?;
        if signed.role() != expected_role {
            return Err(refused(
                "tenant-root restore-refresh promotion names the wrong role command",
            ));
        }
        let issuer_key_id = signed.issuer_key_id().to_owned();
        let Some(issuer_verifying_key) = issuer_verifying_keys.for_issuer_key_id(&issuer_key_id)
        else {
            return Err(refused(
                "tenant-root restore-refresh promotion command issuer is not trusted",
            ));
        };
        let verified = signed
            .verify(&issuer_key_id, issuer_verifying_key)
            .map_err(derivation)?;
        if verified.canonical_bytes() != bytes.as_slice() {
            return Err(refused(
                "tenant-root restore-refresh promotion command bytes changed",
            ));
        }
        Ok(verified)
    }

    fn restore_manifest_imported_commitments_v1(
        manifest: &TenantRootRecoveryManifestV1,
    ) -> RouterAbProtocolResult<(MpcPrfShareCommitmentWireV1, MpcPrfShareCommitmentWireV1)> {
        let descriptor = manifest.descriptor();
        let deriver_a = MpcPrfShareCommitmentWireV1::new(
            descriptor
                .deriver_a()
                .recovery_share_commitment()
                .to_bytes()
                .to_vec(),
        )
        .map_err(derivation)?;
        let deriver_b = MpcPrfShareCommitmentWireV1::new(
            descriptor
                .deriver_b()
                .recovery_share_commitment()
                .to_bytes()
                .to_vec(),
        )
        .map_err(derivation)?;
        Ok((deriver_a, deriver_b))
    }

    fn require_restore_refresh_command_scope_v1(
        grant: &VerifiedTenantRootRestoreRefreshGrantV1,
        manifest: &TenantRootRecoveryManifestV1,
        deriver_a: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
        deriver_b: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
        bindings: &crate::CloudflareTenantRootControlPlaneBindingsV1,
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
            || deriver_a.digest() == deriver_b.digest()
        {
            return Err(refused(
                "tenant-root restore-refresh A/B commands do not agree",
            ));
        }

        let manifest_digest = manifest.digest().map_err(derivation)?;
        let (manifest_deriver_a, manifest_deriver_b) =
            restore_manifest_imported_commitments_v1(manifest)?;
        let ceremony_session_id = grant.ceremony_session_id().map_err(derivation)?;
        let context = deriver_a.context();
        let descriptor = manifest.descriptor();
        if context.identity_digest() != grant.destination_identity_digest()
            || context.custody_lineage() != grant.destination_lineage()
            || context.session_id() != ceremony_session_id
            || context.issued_at_ms() != grant.issued_at_ms()
            || context.expires_at_ms() != grant.expires_at_ms()
            || context.signing_key_id(TwoPartyDeriverRole::DeriverA)
                != bindings.deriver_a_signing_key_id
            || context.signing_key_id(TwoPartyDeriverRole::DeriverB)
                != bindings.deriver_b_signing_key_id
            || deriver_a.destination_fingerprint() != grant.destination_fingerprint()
            || deriver_a.restore_session_id() != grant.restore_session_id()
            || deriver_a.manifest_digest() != &manifest_digest
            || deriver_a.acceptance_receipt(TwoPartyDeriverRole::DeriverA)
                != grant.deriver_a_acceptance_receipt_digest()
            || deriver_a.acceptance_receipt(TwoPartyDeriverRole::DeriverB)
                != grant.deriver_b_acceptance_receipt_digest()
            || deriver_a.imported_commitment(TwoPartyDeriverRole::DeriverA) != &manifest_deriver_a
            || deriver_a.imported_commitment(TwoPartyDeriverRole::DeriverB) != &manifest_deriver_b
            || deriver_a.stable_root_commitment() != &descriptor.stable_root_commitment().to_bytes()
            || deriver_a.issued_at_ms() != grant.issued_at_ms()
            || deriver_a.expires_at_ms() != grant.expires_at_ms()
        {
            return Err(refused(
                "tenant-root restore-refresh command scope does not match its grant or manifest",
            ));
        }
        Ok(())
    }

    fn verify_restore_refresh_promotion_v1(
        promotion: &CloudflareTenantRootRestoreRefreshRolePromotionV1,
        expected_role: TwoPartyDeriverRole,
        authority_id: TenantRootControlPlaneAuthorityIdV1,
        bindings: &crate::CloudflareTenantRootControlPlaneBindingsV1,
    ) -> RouterAbProtocolResult<VerifiedTenantRootRestoreRefreshPromotionV1> {
        if promotion.role.to_protocol() != expected_role {
            return Err(refused(
                "tenant-root restore-refresh promotion role does not match its slot",
            ));
        }
        let command = decode_verified_restore_refresh_role_command_v1(
            "tenant-root restore-refresh promoted role command",
            &promotion.restore_refresh_role_command_b64u,
            expected_role,
            &bindings.issuer_verifying_keys,
        )?;
        if encode_base64url_bytes_v1(command.digest().as_bytes()) != promotion.command_digest_b64u {
            return Err(refused(
                "tenant-root restore-refresh promotion command digest does not match its bytes",
            ));
        }
        let (expected_signing_key_id, expected_verifying_key) = match expected_role {
            TwoPartyDeriverRole::DeriverA => (
                bindings.deriver_a_signing_key_id.as_str(),
                &bindings.deriver_a_verifying_key,
            ),
            TwoPartyDeriverRole::DeriverB => (
                bindings.deriver_b_signing_key_id.as_str(),
                &bindings.deriver_b_verifying_key,
            ),
        };
        let installation = decode_verified_installation_evidence_v1(
            "tenant-root restore-refresh promoted installation evidence",
            &promotion.signed_installation_evidence_b64u,
            expected_role,
            expected_signing_key_id,
            expected_verifying_key,
        )?;
        if installation.evidence().transcript().context() != command.context() {
            return Err(refused(
                "tenant-root restore-refresh promoted installation evidence does not match its command",
            ));
        }
        let installation_digest = installation
            .lifecycle_receipt_digest()
            .map_err(derivation)?;
        if encode_base64url_bytes_v1(installation_digest.as_bytes())
            != promotion.installation_evidence_digest_b64u
        {
            return Err(refused(
                "tenant-root restore-refresh promoted installation evidence digest does not match its bytes",
            ));
        }
        let (expected_family, expected_signing_key_id, expected_verifying_key) = match expected_role
        {
            TwoPartyDeriverRole::DeriverA => (
                TenantRootCanaryCurveFamilyV1::Ecdsa,
                bindings.deriver_a_signing_key_id.as_str(),
                &bindings.deriver_a_verifying_key,
            ),
            TwoPartyDeriverRole::DeriverB => (
                TenantRootCanaryCurveFamilyV1::Ed25519,
                bindings.deriver_b_signing_key_id.as_str(),
                &bindings.deriver_b_verifying_key,
            ),
        };
        let provider_canary = decode_verified_provider_canary_v1(
            "tenant-root restore-refresh promoted provider canary",
            &promotion.provider_canary_receipt_b64u,
            expected_family,
            expected_signing_key_id,
            expected_verifying_key,
        )?;
        if provider_canary.authority_id() != authority_id
            || provider_canary.transition()
                != TenantRootActivationReceiptTransitionV1::InitialCreation
            || provider_canary.target_epoch() != TenantRootShareEpoch::INITIAL
            || provider_canary.issued_at_ms() != command.issued_at_ms()
            || provider_canary.expires_at_ms() != command.expires_at_ms()
            || provider_canary.completed_at_ms() != promotion.completed_at_ms
            || encode_base64url_bytes_v1(provider_canary.digest().as_bytes())
                != promotion.provider_canary_receipt_digest_b64u
            || promotion.completed_at_ms < command.issued_at_ms()
            || promotion.completed_at_ms >= command.expires_at_ms()
        {
            return Err(refused(
                "tenant-root restore-refresh promoted provider canary is outside its command scope",
            ));
        }
        Ok(VerifiedTenantRootRestoreRefreshPromotionV1 {
            command,
            installation,
            provider_canary,
            completed_at_ms: promotion.completed_at_ms,
        })
    }

    fn decode_restore_refresh_authority_id_v1(
        encoded: &str,
    ) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
        let bytes = decode_canonical_base64url(
            "tenant-root restore-refresh Durable Object authority",
            encoded,
            32,
            64,
        )?;
        let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
            refused("tenant-root restore-refresh Durable Object authority has the wrong size")
        })?;
        Ok(TenantRootControlPlaneAuthorityIdV1::from_bytes(bytes))
    }

    fn require_restore_initial_activation_revisions_v1(
        expected_control_plane_revision: u64,
        result_control_plane_revision: u64,
    ) -> RouterAbProtocolResult<()> {
        if expected_control_plane_revision
            != TENANT_ROOT_INITIAL_CREATION_ACTIVATION_EXPECTED_REVISION_V1
            || result_control_plane_revision
                != TENANT_ROOT_INITIAL_CREATION_ACTIVATION_RESULT_REVISION_V1
        {
            return Err(refused(
                "tenant-root restore-refresh promoted checkpoint has unexpected activation revisions",
            ));
        }
        Ok(())
    }

    fn require_promoted_restore_refresh_read_v1(
        response: CloudflareTenantRootRestoreRefreshCheckpointResponseV1,
    ) -> RouterAbProtocolResult<(
        String,
        u64,
        u64,
        CloudflareTenantRootRestoreRefreshRolePromotionV1,
        CloudflareTenantRootRestoreRefreshRolePromotionV1,
    )> {
        match response {
            CloudflareTenantRootRestoreRefreshCheckpointResponseV1::PromotedRead {
                authority_id_b64u,
                expected_initial_activation_revision,
                result_initial_activation_revision,
                deriver_a_promotion,
                deriver_b_promotion,
            } => Ok((
                authority_id_b64u,
                expected_initial_activation_revision,
                result_initial_activation_revision,
                deriver_a_promotion,
                deriver_b_promotion,
            )),
            CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforePromotion {
                ..
            } => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ExpiredLocalRequest,
                "tenant-root restore-refresh authorization expired before durable promotion",
            )),
            CloudflareTenantRootRestoreRefreshCheckpointResponseV1::Checkpoint { .. }
            | CloudflareTenantRootRestoreRefreshCheckpointResponseV1::CompletedRead { .. }
            | CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforeCommands {
                ..
            } => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-refresh initial activation requires a promoted checkpoint",
            )),
        }
    }

    pub(super) fn require_persisted_initial_activation_state_v1(
        read: &CloudflareTenantRootCreationJournalReadResponseV1,
        bundle: &VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
    ) -> RouterAbProtocolResult<()> {
        if read.cleanup_checkpointed {
            return Err(refused(
                "tenant-root initial activation cannot issue after creation cleanup",
            ));
        }
        if read.committed_roles.len() != 2
            || !read
                .committed_roles
                .contains(&CloudflareTenantRootCreationInstallationRoleV1::DeriverA)
            || !read
                .committed_roles
                .contains(&CloudflareTenantRootCreationInstallationRoleV1::DeriverB)
        {
            return Err(refused(
                "tenant-root initial activation requires both persisted role commitments",
            ));
        }
        let CloudflareTenantRootCreationInstallationCheckpointReadStateV1::BothRolesReady {
            root_commitment_b64u,
        } = &read.installation_checkpoint
        else {
            return Err(refused(
                "tenant-root initial activation requires both persisted role installations",
            ));
        };
        let root_commitment = decode_canonical_base64url(
            "tenant-root persisted installation root commitment",
            root_commitment_b64u,
            32,
            48,
        )?;
        if root_commitment.as_slice() != bundle.root_commitment() {
            return Err(refused(
                "tenant-root persisted installation root does not match the activation evidence",
            ));
        }
        Ok(())
    }

    /// Verifies the six public activation artifacts and issues the exact receipt.
    pub(crate) async fn handle_cloudflare_tenant_root_control_plane_initial_activation_v1(
        request: CloudflareTenantRootControlPlaneInitialActivationRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1>
    {
        let bindings = runtime.bindings();
        let deriver_a_installation = decode_verified_installation_evidence_v1(
            "tenant-root Deriver A installation evidence",
            &request.deriver_a_signed_installation_evidence_b64u,
            TwoPartyDeriverRole::DeriverA,
            &bindings.deriver_a_signing_key_id,
            &bindings.deriver_a_verifying_key,
        )?;
        let deriver_b_installation = decode_verified_installation_evidence_v1(
            "tenant-root Deriver B installation evidence",
            &request.deriver_b_signed_installation_evidence_b64u,
            TwoPartyDeriverRole::DeriverB,
            &bindings.deriver_b_signing_key_id,
            &bindings.deriver_b_verifying_key,
        )?;
        let deriver_a_backup = decode_verified_managed_backup_v1(
            "tenant-root Deriver A managed backup",
            &request.deriver_a_signed_managed_backup_b64u,
            TenantRootManagedRestoreRoleV1::DeriverA,
            &bindings.deriver_a_signing_key_id,
            &bindings.deriver_a_verifying_key,
        )?;
        let deriver_b_backup = decode_verified_managed_backup_v1(
            "tenant-root Deriver B managed backup",
            &request.deriver_b_signed_managed_backup_b64u,
            TenantRootManagedRestoreRoleV1::DeriverB,
            &bindings.deriver_b_signing_key_id,
            &bindings.deriver_b_verifying_key,
        )?;
        let ecdsa_canary = decode_verified_provider_canary_v1(
            "tenant-root ECDSA provider canary",
            &request.ecdsa_provider_canary_receipt_b64u,
            TenantRootCanaryCurveFamilyV1::Ecdsa,
            &bindings.deriver_a_signing_key_id,
            &bindings.deriver_a_verifying_key,
        )?;
        let ed25519_canary = decode_verified_provider_canary_v1(
            "tenant-root Ed25519 provider canary",
            &request.ed25519_provider_canary_receipt_b64u,
            TenantRootCanaryCurveFamilyV1::Ed25519,
            &bindings.deriver_b_signing_key_id,
            &bindings.deriver_b_verifying_key,
        )?;
        let bundle = VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_managed_backups(
            deriver_a_installation,
            deriver_b_installation,
            deriver_a_backup,
            deriver_b_backup,
            ecdsa_canary,
            ed25519_canary,
            2,
            3,
        )
        .map_err(derivation)?;
        let activated_at_ms = crate::cloudflare_now_unix_ms_v1()?;
        let (authority_id, read) =
            read_creation_state(env, bundle.identity_digest(), bundle.custody_lineage()).await?;
        let record = CloudflareTenantRootCreationJournalRecordV1 {
            journal_b64u: read.journal_b64u.clone(),
            creation_capability_b64u: read.creation_capability_b64u.clone(),
        };
        let journal = validate_creation_record(
            record,
            authority_id,
            runtime.bindings().issuer_verifying_keys.keys(),
        )?;
        if journal.identity_digest != bundle.identity_digest()
            || journal.custody_lineage != bundle.custody_lineage()
            || journal.ceremony_context.digest().map_err(derivation)? != bundle.context_digest()
        {
            return Err(refused(
                "tenant-root persisted creation state does not match the activation evidence",
            ));
        }
        require_persisted_initial_activation_state_v1(&read, &bundle)?;
        let issuer_binding = &bindings.issuer_signing_key;
        let issuer_seed = load_issuer_seed(env, runtime)?;
        let receipt = super::issue_tenant_root_initial_activation_receipt_v1(
            &bundle,
            activated_at_ms,
            authority_id,
            issuer_binding.signing_key_id(),
            &issuer_seed,
        )?;
        super::initial_activation_receipt_response_v1(receipt)
    }

    /// Reads the durable promoted restore-refresh checkpoint, verifies its
    /// exact A/B command, installation, and canary artifacts, then issues the
    /// tenant-held-external initial activation receipt.
    pub(crate) async fn handle_cloudflare_tenant_root_control_plane_restore_initial_activation_v1(
        request: CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1>
    {
        let grant_bytes = decode_canonical_base64url(
            "tenant-root restore-refresh grant",
            &request.restore_refresh_grant_b64u,
            router_ab_core::TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1,
            router_ab_core::TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1 * 2,
        )?;
        let grant = TenantRootRestoreRefreshGrantV1::decode_canonical_bytes(&grant_bytes)
            .map_err(derivation)?;
        let grant_key_id = grant.grant_key_id().to_owned();
        let Some(trusted_grant_key) = runtime
            .bindings()
            .grant_authority_verifying_keys
            .for_grant_key_id(&grant_key_id)
        else {
            return Err(refused(
                "tenant-root restore-refresh grant authority is not trusted by this control plane",
            ));
        };
        let verified_grant = grant
            .verify(&grant_key_id, trusted_grant_key)
            .map_err(derivation)?;

        let manifest_bytes = decode_canonical_base64url(
            "tenant-root recovery manifest",
            &request.manifest_b64u,
            TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES,
            TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES * 2,
        )?;
        let (manifest, _trust) = verify_recovery_manifest_with_local_trust_v1(
            &manifest_bytes,
            &CloudflareWorkerEnvReaderV1::new(env),
        )?;
        let manifest_digest = manifest.digest().map_err(derivation)?;
        if manifest_digest != *verified_grant.manifest_digest()
            || manifest.descriptor().tenant_root_identity_digest()
                != verified_grant.destination_identity_digest()
        {
            return Err(refused(
                "tenant-root restore-refresh manifest does not match its grant",
            ));
        }

        let checkpoint = execute_cloudflare_router_tenant_root_restore_refresh_checkpoint_call_v1(
            env,
            &CloudflareTenantRootRestoreRefreshCheckpointRequestV1::ReadPromoted {
                restore_refresh_grant_b64u: request.restore_refresh_grant_b64u,
                manifest_b64u: request.manifest_b64u,
            },
        )
        .await?;
        let (
            authority_id_b64u,
            expected_control_plane_revision,
            result_control_plane_revision,
            deriver_a_promotion,
            deriver_b_promotion,
        ) = require_promoted_restore_refresh_read_v1(checkpoint)?;
        require_restore_initial_activation_revisions_v1(
            expected_control_plane_revision,
            result_control_plane_revision,
        )?;
        let authority_id = decode_restore_refresh_authority_id_v1(&authority_id_b64u)?;
        let bindings = runtime.bindings();
        let deriver_a = verify_restore_refresh_promotion_v1(
            &deriver_a_promotion,
            TwoPartyDeriverRole::DeriverA,
            authority_id,
            bindings,
        )?;
        let deriver_b = verify_restore_refresh_promotion_v1(
            &deriver_b_promotion,
            TwoPartyDeriverRole::DeriverB,
            authority_id,
            bindings,
        )?;
        require_restore_refresh_command_scope_v1(
            &verified_grant,
            &manifest,
            &deriver_a.command,
            &deriver_b.command,
            bindings,
        )?;
        if deriver_a.completed_at_ms != deriver_a_promotion.completed_at_ms
            || deriver_b.completed_at_ms != deriver_b_promotion.completed_at_ms
        {
            return Err(refused(
                "tenant-root restore-refresh promotion completion timestamps changed",
            ));
        }
        let availability = TenantRootActivationAvailabilityEvidenceV1::from_verified_restore(
            &deriver_a.command,
            manifest.descriptor().recovery_set_id(),
        )
        .map_err(derivation)?;
        let bundle = VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::new(
            deriver_a.installation,
            deriver_b.installation,
            availability,
            deriver_a.provider_canary,
            deriver_b.provider_canary,
            expected_control_plane_revision,
            result_control_plane_revision,
        )
        .map_err(derivation)?;
        // The promotion timestamps are the durable activation event. Using the
        // later one permits a retry after grant expiry while retaining the
        // original in-window canary timestamps.
        let activated_at_ms = deriver_a.completed_at_ms.max(deriver_b.completed_at_ms);
        let issuer_binding = &bindings.issuer_signing_key;
        let issuer_seed = load_issuer_seed(env, runtime)?;
        let receipt = super::issue_tenant_root_initial_activation_receipt_v1(
            &bundle,
            activated_at_ms,
            authority_id,
            issuer_binding.signing_key_id(),
            &issuer_seed,
        )?;
        super::initial_activation_receipt_response_v1(receipt)
    }

    /// Verifies the six public refresh artifacts against the active state and
    /// issues the exact refresh-swap receipt.
    pub(crate) async fn handle_cloudflare_tenant_root_control_plane_refresh_activation_v1(
        request: CloudflareTenantRootControlPlaneRefreshActivationRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneRefreshActivationReceiptResponseV1>
    {
        let bindings = runtime.bindings();
        let deriver_a_installation = decode_verified_installation_evidence_v1(
            "tenant-root Deriver A refresh installation evidence",
            &request.deriver_a_signed_installation_evidence_b64u,
            TwoPartyDeriverRole::DeriverA,
            &bindings.deriver_a_signing_key_id,
            &bindings.deriver_a_verifying_key,
        )?;
        let deriver_b_installation = decode_verified_installation_evidence_v1(
            "tenant-root Deriver B refresh installation evidence",
            &request.deriver_b_signed_installation_evidence_b64u,
            TwoPartyDeriverRole::DeriverB,
            &bindings.deriver_b_signing_key_id,
            &bindings.deriver_b_verifying_key,
        )?;
        let deriver_a_backup = decode_verified_managed_backup_v1(
            "tenant-root Deriver A refresh managed backup",
            &request.deriver_a_signed_managed_backup_b64u,
            TenantRootManagedRestoreRoleV1::DeriverA,
            &bindings.deriver_a_signing_key_id,
            &bindings.deriver_a_verifying_key,
        )?;
        let deriver_b_backup = decode_verified_managed_backup_v1(
            "tenant-root Deriver B refresh managed backup",
            &request.deriver_b_signed_managed_backup_b64u,
            TenantRootManagedRestoreRoleV1::DeriverB,
            &bindings.deriver_b_signing_key_id,
            &bindings.deriver_b_verifying_key,
        )?;
        let ecdsa_canary = decode_verified_provider_canary_v1(
            "tenant-root ECDSA refresh provider canary",
            &request.ecdsa_provider_canary_receipt_b64u,
            TenantRootCanaryCurveFamilyV1::Ecdsa,
            &bindings.deriver_a_signing_key_id,
            &bindings.deriver_a_verifying_key,
        )?;
        let ed25519_canary = decode_verified_provider_canary_v1(
            "tenant-root Ed25519 refresh provider canary",
            &request.ed25519_provider_canary_receipt_b64u,
            TenantRootCanaryCurveFamilyV1::Ed25519,
            &bindings.deriver_b_signing_key_id,
            &bindings.deriver_b_verifying_key,
        )?;

        let context = deriver_a_installation.evidence().transcript().context();
        let identity_digest = context.identity_digest();
        let custody_lineage = context.custody_lineage();
        let active =
            execute_cloudflare_router_tenant_root_creation_active_state_with_revision_read_call_v1(
                env,
                identity_digest,
                custody_lineage,
            )
            .await?;
        let authority_id = active.activation_receipt.binding().authority_id();
        let active_pair = TenantRootActiveRootPairV1::from_verified_activation_receipt(
            &active.activation_receipt,
        )
        .map_err(derivation)?;
        if active_pair.identity_digest() != identity_digest
            || active_pair.custody_lineage() != custody_lineage
        {
            return Err(refused(
                "tenant-root active state does not match refresh installation evidence",
            ));
        }
        let TenantRootCeremonyEpochsV1::Refresh { current, .. } = context.epochs() else {
            return Err(refused(
                "tenant-root refresh activation requires refresh ceremony epochs",
            ));
        };
        if current != active_pair.epoch() {
            return Err(refused(
                "tenant-root refresh activation current epoch does not match active state",
            ));
        }
        let expected_control_plane_revision = active.lifecycle_revision;
        let result_control_plane_revision = expected_control_plane_revision
            .checked_add(1)
            .ok_or_else(|| refused("tenant-root refresh activation revision cannot advance"))?;
        let bundle =
            VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1::from_verified_managed_backups(
                active_pair.commitments(),
                deriver_a_installation,
                deriver_b_installation,
                deriver_a_backup,
                deriver_b_backup,
                ecdsa_canary,
                ed25519_canary,
                expected_control_plane_revision,
                result_control_plane_revision,
            )
            .map_err(derivation)?;
        let activated_at_ms = crate::cloudflare_now_unix_ms_v1()?;
        let issuer_binding = &bindings.issuer_signing_key;
        let issuer_seed = load_issuer_seed(env, runtime)?;
        let receipt = super::issue_tenant_root_refresh_activation_receipt_v1(
            &bundle,
            activated_at_ms,
            authority_id,
            issuer_binding.signing_key_id(),
            &issuer_seed,
        )?;
        super::refresh_activation_receipt_response_v1(receipt)
    }

    async fn read_bounded_initial_activation_response_body_v1(
        response: &mut worker::Response,
        max_bytes: usize,
        label: &str,
    ) -> RouterAbProtocolResult<Vec<u8>> {
        use futures::StreamExt;

        if let Ok(mut stream) = response.stream() {
            let mut body = Vec::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|error| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        format!("{label} response body read failed: {error}"),
                    )
                })?;
                let next_len = body.len().checked_add(chunk.len()).ok_or_else(|| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        format!("{label} response body length overflows"),
                    )
                })?;
                if next_len > max_bytes {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        format!("{label} response exceeds its maximum size"),
                    ));
                }
                body.extend_from_slice(&chunk);
            }
            return Ok(body);
        }

        let body = response.bytes().await.map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} response body read failed: {error}"),
            )
        })?;
        if body.len() > max_bytes {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} response exceeds its maximum size"),
            ));
        }
        Ok(body)
    }

    /// Sends the typed activation request over the private control-plane binding.
    pub(crate) async fn execute_cloudflare_tenant_root_control_plane_initial_activation_service_call_v1(
        env: &worker::Env,
        request: &CloudflareTenantRootControlPlaneInitialActivationRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1>
    {
        let label = "tenant-root control-plane initial activation request";
        let request_body = crate::cloudflare_service_json_request_body_v1(label, request)?;
        if request_body.len() > TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1 {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} exceeds its maximum size"),
            ));
        }
        let fetcher = env
            .service(crate::TENANT_ROOT_CONTROL_PLANE_SERVICE_BINDING_V1)
            .map_err(|error| {
                crate::worker_binding_error(
                    crate::worker_binding_error_code(
                        &error,
                        crate::TENANT_ROOT_CONTROL_PLANE_SERVICE_BINDING_V1,
                    ),
                    crate::TENANT_ROOT_CONTROL_PLANE_SERVICE_BINDING_V1,
                    "service",
                    error,
                )
            })?;
        let headers = worker::Headers::new();
        headers
            .set("content-type", "application/json")
            .map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    format!("{label} request headers failed: {error}"),
                )
            })?;
        crate::set_cloudflare_internal_service_auth_header_v1(env, &headers, label)?;
        let mut init = worker::RequestInit::new();
        init.with_method(worker::Method::Post)
            .with_headers(headers)
            .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&request_body)));
        let request_for_fetch = worker::Request::new_with_init(
            crate::cloudflare_tenant_root_control_plane_initial_activation_service_url(),
            &init,
        )
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{label} request construction failed: {error}"),
            )
        })?;
        let mut response = fetcher
            .fetch_request(request_for_fetch)
            .await
            .map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    format!("{label} request failed: {error}"),
                )
            })?;
        let status = response.status_code();
        let response_body = read_bounded_initial_activation_response_body_v1(
            &mut response,
            TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_RESPONSE_MAX_BYTES_V1,
            label,
        )
        .await?;
        if !(200..=299).contains(&status) {
            let response_detail = String::from_utf8_lossy(&response_body);
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!(
                    "{label} service returned HTTP status {status}: {}",
                    response_detail.trim()
                ),
            ));
        }
        let parsed: CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1 =
            serde_json::from_slice(&response_body).map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    format!("{label} response JSON parse failed: {error}"),
                )
            })?;
        let receipt_bytes = decode_canonical_base64url(
            "tenant-root initial activation receipt",
            &parsed.activation_receipt_b64u,
            TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1,
            TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1 * 2,
        )?;
        let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
            .map_err(derivation)?;
        if receipt.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation {
            return Err(refused(
                "tenant-root control-plane returned a non-initial activation receipt",
            ));
        }
        Ok(parsed)
    }

    /// Sends the restore initial-activation request over the private
    /// control-plane binding and validates the returned receipt transition.
    pub(crate) async fn execute_cloudflare_tenant_root_control_plane_restore_initial_activation_service_call_v1(
        env: &worker::Env,
        request: &CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1>
    {
        let label = "tenant-root control-plane restore initial activation request";
        let request_body = crate::cloudflare_service_json_request_body_v1(label, request)?;
        if request_body.len()
            > TENANT_ROOT_CONTROL_PLANE_RESTORE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} exceeds its maximum size"),
            ));
        }
        let fetcher = env
            .service(crate::TENANT_ROOT_CONTROL_PLANE_SERVICE_BINDING_V1)
            .map_err(|error| {
                crate::worker_binding_error(
                    crate::worker_binding_error_code(
                        &error,
                        crate::TENANT_ROOT_CONTROL_PLANE_SERVICE_BINDING_V1,
                    ),
                    crate::TENANT_ROOT_CONTROL_PLANE_SERVICE_BINDING_V1,
                    "service",
                    error,
                )
            })?;
        let headers = worker::Headers::new();
        headers
            .set("content-type", "application/json")
            .map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    format!("{label} request headers failed: {error}"),
                )
            })?;
        crate::set_cloudflare_internal_service_auth_header_v1(env, &headers, label)?;
        let mut init = worker::RequestInit::new();
        init.with_method(worker::Method::Post)
            .with_headers(headers)
            .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&request_body)));
        let request_for_fetch = worker::Request::new_with_init(
            crate::cloudflare_tenant_root_control_plane_restore_initial_activation_service_url(),
            &init,
        )
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{label} request construction failed: {error}"),
            )
        })?;
        let mut response = fetcher
            .fetch_request(request_for_fetch)
            .await
            .map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    format!("{label} request failed: {error}"),
                )
            })?;
        let status = response.status_code();
        let response_body = read_bounded_initial_activation_response_body_v1(
            &mut response,
            TENANT_ROOT_CONTROL_PLANE_INITIAL_ACTIVATION_RESPONSE_MAX_BYTES_V1,
            label,
        )
        .await?;
        if !(200..=299).contains(&status) {
            let response_detail = String::from_utf8_lossy(&response_body);
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!(
                    "{label} service returned HTTP status {status}: {}",
                    response_detail.trim()
                ),
            ));
        }
        let parsed: CloudflareTenantRootControlPlaneInitialActivationReceiptResponseV1 =
            serde_json::from_slice(&response_body).map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    format!("{label} response JSON parse failed: {error}"),
                )
            })?;
        let receipt_bytes = decode_canonical_base64url(
            "tenant-root restore initial activation receipt",
            &parsed.activation_receipt_b64u,
            TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1,
            TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1 * 2,
        )?;
        let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
            .map_err(derivation)?;
        if receipt.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation {
            return Err(refused(
                "tenant-root control-plane returned a non-initial restore activation receipt",
            ));
        }
        Ok(parsed)
    }

    /// The genesis operation: open a tenant root under a signed grant.
    ///
    /// The grant is verified against the issuer's own configured authorities,
    /// never against anything the request names. The authority id is derived
    /// from the Durable Object binding, and the Durable Object independently
    /// re-verifies the capability before persisting, so reaching this route
    /// grants no ability to write state.
    pub async fn handle_cloudflare_tenant_root_control_plane_create_tenant_root_v1(
        request: CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
        env: &worker::Env,
        runtime: &CloudflareTenantRootControlPlaneRuntimeV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootControlPlaneCreateTenantRootResponseV1> {
        let grant_bytes = decode_canonical_base64url(
            "tenant-root creation grant",
            &request.creation_grant_b64u,
            TENANT_ROOT_CREATION_GRANT_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_GRANT_MAX_BYTES_V1 * 2,
        )?;
        let grant =
            TenantRootCreationGrantV1::decode_canonical_bytes(&grant_bytes).map_err(derivation)?;
        // The trusted key is selected by the grant's key id but supplied by the
        // issuer's own configuration: an unlisted authority has no key here.
        let grant_key_id = grant.grant_key_id().to_owned();
        let Some(trusted_key) = runtime
            .bindings()
            .grant_authority_verifying_keys
            .for_grant_key_id(&grant_key_id)
        else {
            return Err(refused(
                "tenant-root creation grant authority is not trusted by this control plane",
            ));
        };
        let verified = grant
            .verify(&grant_key_id, trusted_key)
            .map_err(derivation)?;

        let now_ms = crate::cloudflare_now_unix_ms_v1()?;
        let draw = derive_tenant_root_creation_ceremony_v1(
            &grant_bytes,
            runtime.bindings().deriver_a_signing_key_id.clone(),
            runtime.bindings().deriver_b_signing_key_id.clone(),
        )?;
        let (authority_id, _) = read_creation_object_binding(
            env,
            verified.identity_digest(),
            verified.custody_lineage(),
        )?;
        let seed = load_issuer_seed(env, runtime)?;
        let authorized = authorize_tenant_root_creation_v1(
            &verified,
            &draw,
            now_ms,
            authority_id,
            runtime.bindings().issuer_signing_key.signing_key_id(),
            &seed,
        )?;

        let persisted = execute_cloudflare_router_tenant_root_creation_journal_call_v1(
            env,
            &authorized.journal,
            &authorized.capability,
        )
        .await?;
        let (_, current) =
            read_creation_state(env, verified.identity_digest(), verified.custody_lineage())
                .await?;
        Ok(CloudflareTenantRootControlPlaneCreateTenantRootResponseV1 {
            identity_digest_b64u: encode_base64url_bytes_v1(verified.identity_digest().as_bytes()),
            custody_lineage_b64u: encode_base64url_bytes_v1(verified.custody_lineage().as_bytes()),
            revision: persisted.revision,
            journal_digest_b64u: persisted.journal_digest_b64u,
            capability_digest_b64u: persisted.capability_digest_b64u,
            status: creation_status(&current)?,
            replayed: matches!(
                persisted.outcome,
                CloudflareTenantRootCreationJournalOutcomeV1::Replay
            ),
        })
    }

    #[cfg(test)]
    mod restore_initial_activation_tests {
        use super::*;
        use crate::env::{
            CloudflareCustodyAuthorityVerifiersV1, CloudflareOperationsIncidentVerifierV1,
            CloudflareTenantRootControlPlaneIssuerSigningKeyBindingV1,
            CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
            CloudflareTenantRootCreationGrantAuthorityVerifyingKeysV1,
        };
        use crate::CloudflareTenantRootControlPlaneBindingsV1;
        use curve25519_dalek::scalar::Scalar;
        use ed25519_dalek::SigningKey;
        use rand_chacha::ChaCha20Rng;
        use rand_core_06::SeedableRng;
        use router_ab_core::{
            tenant_root_restore_refresh_context_nonce_v1,
            TenantRootActivationReceiptAvailabilityV1, TenantRootEpochCommitmentsV1,
            TenantRootIdentityDigestV1, TenantRootLifecycleReceiptDigestV1,
            TenantRootProviderCanaryReceiptBindingV1, TenantRootRecoverySetId,
            TenantRootRestoreAuthorizationNonceV1, TenantRootRestoreDestinationFingerprintV1,
            TenantRootRestoreRefreshRoleCommandV1, TenantRootRestoreSessionIdV1,
            TenantRootShareInstallationEvidenceV1, TenantRootShareInstallationTranscriptV1,
            TenantRootSignedProviderCanaryReceiptV1, TenantRootSignedShareInstallationEvidenceV1,
        };
        use sha2::{Digest, Sha256};
        use threshold_prf::{
            prove_root_share_knowledge, SigningRootShare, SigningRootShareCommitment,
        };

        const ISSUER_KEY_ID: &str = "restore-issuer-v1";
        const ISSUER_SEED: [u8; 32] = [0x41; 32];
        const GRANT_KEY_ID: &str = "restore-grant-authority-v1";
        const GRANT_SEED: [u8; 32] = [0x42; 32];
        const DERIVER_A_KEY_ID: &str = "deriver-a-signing-key-7";
        const DERIVER_B_KEY_ID: &str = "deriver-b-signing-key-9";
        const DERIVER_A_SEED: [u8; 32] = [0x61; 32];
        const DERIVER_B_SEED: [u8; 32] = [0x62; 32];
        const ISSUED_AT_MS: u64 = 1_000_000;
        const EXPIRES_AT_MS: u64 = 1_030_000;
        const COMPLETED_AT_MS: u64 = 1_000_010;

        fn public_key(seed: &[u8; 32]) -> [u8; 32] {
            SigningKey::from_bytes(seed).verifying_key().to_bytes()
        }

        fn lower_hex(bytes: &[u8; 32]) -> String {
            bytes.iter().map(|byte| format!("{byte:02x}")).collect()
        }

        fn issuer_keys(
            key_id: &str,
            seed: &[u8; 32],
        ) -> CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1 {
            CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1::decode(&format!(
                "{{\"keys\":[{{\"issuer_key_id\":\"{key_id}\",\"verifying_key_hex\":\"{}\"}}]}}",
                lower_hex(&public_key(seed)),
            ))
            .expect("issuer keys")
        }

        fn grant_keys(
            key_id: &str,
            seed: &[u8; 32],
        ) -> CloudflareTenantRootCreationGrantAuthorityVerifyingKeysV1 {
            CloudflareTenantRootCreationGrantAuthorityVerifyingKeysV1::decode(&format!(
                "{{\"keys\":[{{\"issuer_key_id\":\"{key_id}\",\"verifying_key_hex\":\"{}\"}}]}}",
                lower_hex(&public_key(seed)),
            ))
            .expect("grant keys")
        }

        fn bindings() -> CloudflareTenantRootControlPlaneBindingsV1 {
            CloudflareTenantRootControlPlaneBindingsV1::new(
                CloudflareTenantRootControlPlaneIssuerSigningKeyBindingV1::new(
                    ISSUER_KEY_ID,
                    "TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY",
                )
                .expect("issuer binding"),
                issuer_keys(ISSUER_KEY_ID, &ISSUER_SEED),
                grant_keys(GRANT_KEY_ID, &GRANT_SEED),
                CloudflareOperationsIncidentVerifierV1::new(public_key(&[0x43; 32]))
                    .expect("operations verifier"),
                CloudflareCustodyAuthorityVerifiersV1::new(
                    public_key(&[0x44; 32]),
                    public_key(&[0x45; 32]),
                )
                .expect("custody verifiers"),
                DERIVER_A_KEY_ID.to_owned(),
                DERIVER_B_KEY_ID.to_owned(),
                public_key(&DERIVER_A_SEED),
                public_key(&DERIVER_B_SEED),
            )
            .expect("control-plane bindings")
        }

        fn role_seed(role: TwoPartyDeriverRole) -> [u8; 32] {
            match role {
                TwoPartyDeriverRole::DeriverA => DERIVER_A_SEED,
                TwoPartyDeriverRole::DeriverB => DERIVER_B_SEED,
            }
        }

        fn role_key_id(role: TwoPartyDeriverRole) -> &'static str {
            match role {
                TwoPartyDeriverRole::DeriverA => DERIVER_A_KEY_ID,
                TwoPartyDeriverRole::DeriverB => DERIVER_B_KEY_ID,
            }
        }

        fn restore_test_context() -> (TenantRootCeremonyContextV1, TenantRootEpochCommitmentsV1) {
            let identity = TenantRootIdentityDigestV1::from_bytes([0x31; 32]);
            let lineage = TenantRootCustodyLineageId::from_bytes([0x32; 16]).expect("lineage");
            let destination_fingerprint =
                TenantRootRestoreDestinationFingerprintV1::from_bytes([0x33; 32])
                    .expect("destination fingerprint");
            let restore_session_id =
                TenantRootRestoreSessionIdV1::from_bytes([0x34; 16]).expect("restore session");
            let ceremony_session_id =
                TenantRootCeremonySessionIdV1::from_bytes([0x35; 16]).expect("ceremony session");
            let manifest_digest = [0x36; 32];
            let acceptance_a =
                TenantRootLifecycleReceiptDigestV1::from_bytes([0x37; 32]).expect("receipt A");
            let acceptance_b =
                TenantRootLifecycleReceiptDigestV1::from_bytes([0x38; 32]).expect("receipt B");
            let share_a = SigningRootShare::from_canonical_bytes(
                TwoPartyDeriverRole::DeriverA.share_id(),
                Scalar::from(12_u64).to_bytes(),
            )
            .expect("share A");
            let share_b = SigningRootShare::from_canonical_bytes(
                TwoPartyDeriverRole::DeriverB.share_id(),
                Scalar::from(19_u64).to_bytes(),
            )
            .expect("share B");
            let commitments = TenantRootEpochCommitmentsV1::new(
                MpcPrfShareCommitmentWireV1::new(
                    SigningRootShareCommitment::from_share(&share_a)
                        .to_bytes()
                        .to_vec(),
                )
                .expect("commitment A"),
                MpcPrfShareCommitmentWireV1::new(
                    SigningRootShareCommitment::from_share(&share_b)
                        .to_bytes()
                        .to_vec(),
                )
                .expect("commitment B"),
            )
            .expect("commitments");
            let nonce = tenant_root_restore_refresh_context_nonce_v1(
                identity,
                lineage,
                ceremony_session_id,
                destination_fingerprint,
                restore_session_id,
                manifest_digest,
                acceptance_a,
                acceptance_b,
                commitments.deriver_a(),
                commitments.deriver_b(),
                *commitments.root_commitment(),
            )
            .expect("context nonce");
            let context = TenantRootCeremonyContextV1::new(
                identity,
                lineage,
                TenantRootCeremonyEpochsV1::create(),
                ceremony_session_id,
                nonce,
                ISSUED_AT_MS,
                EXPIRES_AT_MS,
                DERIVER_A_KEY_ID,
                DERIVER_B_KEY_ID,
            )
            .expect("restore context");
            (context, commitments)
        }

        fn signed_command(
            context: &TenantRootCeremonyContextV1,
            commitments: &TenantRootEpochCommitmentsV1,
            role: TwoPartyDeriverRole,
        ) -> TenantRootRestoreRefreshRoleCommandV1 {
            TenantRootRestoreRefreshRoleCommandV1::sign(
                context,
                TenantRootRestoreDestinationFingerprintV1::from_bytes([0x33; 32])
                    .expect("destination fingerprint"),
                TenantRootRestoreSessionIdV1::from_bytes([0x34; 16]).expect("restore session"),
                [0x36; 32],
                TenantRootLifecycleReceiptDigestV1::from_bytes([0x37; 32]).expect("receipt A"),
                TenantRootLifecycleReceiptDigestV1::from_bytes([0x38; 32]).expect("receipt B"),
                commitments.deriver_a().clone(),
                commitments.deriver_b().clone(),
                *commitments.root_commitment(),
                role,
                ISSUER_KEY_ID,
                &ISSUER_SEED,
            )
            .expect("restore command")
        }

        fn installation(
            context: &TenantRootCeremonyContextV1,
            role: TwoPartyDeriverRole,
            share_scalar: u64,
            peer_scalar: u64,
            proof_seed: u8,
        ) -> router_ab_core::VerifiedTenantRootSignedShareInstallationEvidenceWireV1 {
            let share = SigningRootShare::from_canonical_bytes(
                role.share_id(),
                Scalar::from(share_scalar).to_bytes(),
            )
            .expect("share");
            let peer = SigningRootShare::from_canonical_bytes(
                role.peer().share_id(),
                Scalar::from(peer_scalar).to_bytes(),
            )
            .expect("peer share");
            let transcript = TenantRootShareInstallationTranscriptV1::new(
                context.clone(),
                role,
                SigningRootShareCommitment::from_share(&share),
                SigningRootShareCommitment::from_share(&peer),
            )
            .expect("installation transcript");
            let proof = prove_root_share_knowledge(
                &share,
                &transcript.canonical_bytes().expect("transcript bytes"),
                &mut ChaCha20Rng::from_seed([proof_seed; 32]),
            )
            .expect("knowledge proof");
            let signed = TenantRootSignedShareInstallationEvidenceV1::sign(
                TenantRootShareInstallationEvidenceV1::new(transcript, proof)
                    .expect("installation evidence"),
                &role_seed(role),
            )
            .expect("signed installation");
            let bytes = signed.canonical_bytes().expect("installation bytes");
            TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
                &bytes,
                &public_key(&role_seed(role)),
            )
            .expect("verified installation")
        }

        fn signed_canary(
            context: &TenantRootCeremonyContextV1,
            commitments: &TenantRootEpochCommitmentsV1,
            role: TwoPartyDeriverRole,
            family: TenantRootCanaryCurveFamilyV1,
            signing_seed: &[u8; 32],
        ) -> TenantRootSignedProviderCanaryReceiptV1 {
            let binding = TenantRootProviderCanaryReceiptBindingV1::new(
                context.identity_digest(),
                context.custody_lineage(),
                TenantRootActivationReceiptTransitionV1::InitialCreation,
                TenantRootShareEpoch::INITIAL,
                commitments.clone(),
                family,
                "restore-provider-canary-v1",
                COMPLETED_AT_MS,
                TenantRootControlPlaneAuthorityIdV1::from_bytes([0x51; 32]),
                role_key_id(role),
                ISSUED_AT_MS,
                EXPIRES_AT_MS,
            )
            .expect("canary binding");
            TenantRootSignedProviderCanaryReceiptV1::sign(binding, signing_seed)
                .expect("signed canary")
        }

        fn promotion(
            role: TwoPartyDeriverRole,
            command: &TenantRootRestoreRefreshRoleCommandV1,
            installation: &router_ab_core::VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
            canary: &TenantRootSignedProviderCanaryReceiptV1,
        ) -> CloudflareTenantRootRestoreRefreshRolePromotionV1 {
            let command_bytes = command.canonical_bytes().expect("command bytes");
            let installation_bytes = installation.canonical_bytes();
            let canary_bytes = canary.canonical_bytes().expect("canary bytes");
            CloudflareTenantRootRestoreRefreshRolePromotionV1 {
                role: match role {
                    TwoPartyDeriverRole::DeriverA => {
                        CloudflareTenantRootCreationInstallationRoleV1::DeriverA
                    }
                    TwoPartyDeriverRole::DeriverB => {
                        CloudflareTenantRootCreationInstallationRoleV1::DeriverB
                    }
                },
                restore_refresh_role_command_b64u: encode_base64url_bytes_v1(&command_bytes),
                command_digest_b64u: encode_base64url_bytes_v1(&Sha256::digest(&command_bytes)),
                signed_installation_evidence_b64u: encode_base64url_bytes_v1(installation_bytes),
                installation_evidence_digest_b64u: encode_base64url_bytes_v1(&Sha256::digest(
                    installation_bytes,
                )),
                provider_canary_receipt_b64u: encode_base64url_bytes_v1(&canary_bytes),
                provider_canary_receipt_digest_b64u: encode_base64url_bytes_v1(&Sha256::digest(
                    &canary_bytes,
                )),
                completed_at_ms: COMPLETED_AT_MS,
            }
        }

        struct PromotionFixture {
            bindings: CloudflareTenantRootControlPlaneBindingsV1,
            authority: TenantRootControlPlaneAuthorityIdV1,
            recovery_set_id: TenantRootRecoverySetId,
            context: TenantRootCeremonyContextV1,
            commitments: TenantRootEpochCommitmentsV1,
            deriver_a: CloudflareTenantRootRestoreRefreshRolePromotionV1,
            deriver_b: CloudflareTenantRootRestoreRefreshRolePromotionV1,
            ecdsa_canary_b64u: String,
            ed25519_canary_b64u: String,
        }

        fn promotion_fixture() -> PromotionFixture {
            let (context, commitments) = restore_test_context();
            let command_a = signed_command(&context, &commitments, TwoPartyDeriverRole::DeriverA);
            let command_b = signed_command(&context, &commitments, TwoPartyDeriverRole::DeriverB);
            let installation_a =
                installation(&context, TwoPartyDeriverRole::DeriverA, 12, 19, 0x71);
            let installation_b =
                installation(&context, TwoPartyDeriverRole::DeriverB, 19, 12, 0x72);
            let canary_a = signed_canary(
                &context,
                &commitments,
                TwoPartyDeriverRole::DeriverA,
                TenantRootCanaryCurveFamilyV1::Ecdsa,
                &DERIVER_A_SEED,
            );
            let canary_b = signed_canary(
                &context,
                &commitments,
                TwoPartyDeriverRole::DeriverB,
                TenantRootCanaryCurveFamilyV1::Ed25519,
                &DERIVER_B_SEED,
            );
            let canary_a_b64u =
                encode_base64url_bytes_v1(&canary_a.canonical_bytes().expect("ECDSA canary bytes"));
            let canary_b_b64u = encode_base64url_bytes_v1(
                &canary_b.canonical_bytes().expect("Ed25519 canary bytes"),
            );
            PromotionFixture {
                bindings: bindings(),
                authority: TenantRootControlPlaneAuthorityIdV1::from_bytes([0x51; 32]),
                recovery_set_id: TenantRootRecoverySetId::from_bytes([0x52; 16])
                    .expect("recovery set"),
                context,
                commitments,
                deriver_a: promotion(
                    TwoPartyDeriverRole::DeriverA,
                    &command_a,
                    &installation_a,
                    &canary_a,
                ),
                deriver_b: promotion(
                    TwoPartyDeriverRole::DeriverB,
                    &command_b,
                    &installation_b,
                    &canary_b,
                ),
                ecdsa_canary_b64u: canary_a_b64u,
                ed25519_canary_b64u: canary_b_b64u,
            }
        }

        #[test]
        fn promoted_authority_requires_exactly_32_canonical_bytes() {
            let encoded = encode_base64url_bytes_v1(&[0x71; 32]);
            let authority =
                decode_restore_refresh_authority_id_v1(&encoded).expect("valid promoted authority");
            assert_eq!(authority.as_bytes(), &[0x71; 32].as_ref());

            let short = encode_base64url_bytes_v1(&[0x71; 31]);
            assert_eq!(
                decode_restore_refresh_authority_id_v1(&short)
                    .expect_err("short authority")
                    .code(),
                RouterAbProtocolErrorCode::ForbiddenLocalBinding
            );
        }

        #[test]
        fn valid_promotions_issue_a_tenant_held_external_initial_receipt() {
            let fixture = promotion_fixture();
            let verified_a = verify_restore_refresh_promotion_v1(
                &fixture.deriver_a,
                TwoPartyDeriverRole::DeriverA,
                fixture.authority,
                &fixture.bindings,
            )
            .expect("verified Deriver A promotion");
            let verified_b = verify_restore_refresh_promotion_v1(
                &fixture.deriver_b,
                TwoPartyDeriverRole::DeriverB,
                fixture.authority,
                &fixture.bindings,
            )
            .expect("verified Deriver B promotion");
            let availability = TenantRootActivationAvailabilityEvidenceV1::from_verified_restore(
                &verified_a.command,
                fixture.recovery_set_id,
            )
            .expect("tenant-held external availability");
            let bundle = VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::new(
                verified_a.installation,
                verified_b.installation,
                availability,
                verified_a.provider_canary,
                verified_b.provider_canary,
                TENANT_ROOT_INITIAL_CREATION_ACTIVATION_EXPECTED_REVISION_V1,
                TENANT_ROOT_INITIAL_CREATION_ACTIVATION_RESULT_REVISION_V1,
            )
            .expect("initial activation bundle");
            let receipt = super::super::issue_tenant_root_initial_activation_receipt_v1(
                &bundle,
                COMPLETED_AT_MS,
                fixture.authority,
                ISSUER_KEY_ID,
                &Zeroizing::new(ISSUER_SEED),
            )
            .expect("initial activation receipt");
            let verified = receipt
                .verify_initial_creation(
                    &bundle,
                    COMPLETED_AT_MS,
                    fixture.authority,
                    ISSUER_KEY_ID,
                    &public_key(&ISSUER_SEED),
                )
                .expect("receipt verification");
            assert!(matches!(
                verified.availability(),
                TenantRootActivationReceiptAvailabilityV1::TenantHeldExternal { .. }
            ));
        }

        #[test]
        fn swapped_or_wrong_role_promotions_are_rejected() {
            let fixture = promotion_fixture();
            assert!(verify_restore_refresh_promotion_v1(
                &fixture.deriver_b,
                TwoPartyDeriverRole::DeriverA,
                fixture.authority,
                &fixture.bindings,
            )
            .is_err());
            let mut wrong_role = fixture.deriver_a.clone();
            wrong_role.role = CloudflareTenantRootCreationInstallationRoleV1::DeriverB;
            assert!(verify_restore_refresh_promotion_v1(
                &wrong_role,
                TwoPartyDeriverRole::DeriverA,
                fixture.authority,
                &fixture.bindings,
            )
            .is_err());
        }

        #[test]
        fn canary_family_and_signer_mismatches_are_rejected() {
            let fixture = promotion_fixture();
            let mut wrong_family = fixture.deriver_a.clone();
            wrong_family.provider_canary_receipt_b64u = fixture.ed25519_canary_b64u;
            wrong_family.provider_canary_receipt_digest_b64u =
                encode_base64url_bytes_v1(&Sha256::digest(
                    decode_canonical_base64url(
                        "wrong family canary",
                        &wrong_family.provider_canary_receipt_b64u,
                        TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1,
                        TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1 * 2,
                    )
                    .expect("wrong family canary bytes"),
                ));
            assert!(verify_restore_refresh_promotion_v1(
                &wrong_family,
                TwoPartyDeriverRole::DeriverA,
                fixture.authority,
                &fixture.bindings,
            )
            .is_err());

            let wrong_signer_canary = signed_canary(
                &fixture.context,
                &fixture.commitments,
                TwoPartyDeriverRole::DeriverA,
                TenantRootCanaryCurveFamilyV1::Ecdsa,
                &[0x63; 32],
            );
            let mut wrong_signer = fixture.deriver_a.clone();
            let wrong_signer_bytes = wrong_signer_canary
                .canonical_bytes()
                .expect("wrong signer canary bytes");
            wrong_signer.provider_canary_receipt_b64u =
                encode_base64url_bytes_v1(&wrong_signer_bytes);
            wrong_signer.provider_canary_receipt_digest_b64u =
                encode_base64url_bytes_v1(&Sha256::digest(&wrong_signer_bytes));
            assert!(verify_restore_refresh_promotion_v1(
                &wrong_signer,
                TwoPartyDeriverRole::DeriverA,
                fixture.authority,
                &fixture.bindings,
            )
            .is_err());
        }

        #[test]
        fn promoted_scope_must_match_the_verified_grant_and_manifest() {
            let manifest = TenantRootRecoveryManifestV1::from_canonical_json(include_bytes!(
                "../../router-ab-core/tests/fixtures/tenant-root-recovery/manifest.json"
            ))
            .expect("manifest");
            let identity_digest = manifest.descriptor().tenant_root_identity_digest();
            let sign_grant = |fingerprint: u8| {
                TenantRootRestoreRefreshGrantV1::sign(
                    TenantRootProtocolDigestV1::from_bytes([0x81; 32]).expect("operation digest"),
                    identity_digest,
                    TenantRootRestoreDestinationFingerprintV1::from_bytes([fingerprint; 32])
                        .expect("destination fingerprint"),
                    TenantRootCustodyLineageId::from_bytes([0x83; 16]).expect("lineage"),
                    TenantRootRestoreSessionIdV1::from_bytes([0x84; 16]).expect("restore session"),
                    manifest.digest().expect("manifest digest"),
                    TenantRootLifecycleReceiptDigestV1::from_bytes([0x85; 32]).expect("receipt A"),
                    TenantRootLifecycleReceiptDigestV1::from_bytes([0x86; 32]).expect("receipt B"),
                    TenantRootRestoreAuthorizationNonceV1::from_bytes([0x87; 32])
                        .expect("restore nonce"),
                    ISSUED_AT_MS,
                    EXPIRES_AT_MS,
                    GRANT_KEY_ID,
                    &GRANT_SEED,
                )
                .expect("restore grant")
                .verify(GRANT_KEY_ID, &public_key(&GRANT_SEED))
                .expect("verified restore grant")
            };
            let grant = sign_grant(0x82);
            let commands = super::super::issue_tenant_root_restore_refresh_commands_v1(
                &grant,
                &manifest,
                DERIVER_A_KEY_ID,
                DERIVER_B_KEY_ID,
                ISSUER_KEY_ID,
                &Zeroizing::new(ISSUER_SEED),
            )
            .expect("restore commands");
            let verified_a = commands
                .deriver_a
                .verify(ISSUER_KEY_ID, &public_key(&ISSUER_SEED))
                .expect("verified command A");
            let verified_b = commands
                .deriver_b
                .verify(ISSUER_KEY_ID, &public_key(&ISSUER_SEED))
                .expect("verified command B");
            let mismatched_grant = sign_grant(0x92);
            assert!(require_restore_refresh_command_scope_v1(
                &mismatched_grant,
                &manifest,
                &verified_a,
                &verified_b,
                &bindings(),
            )
            .is_err());
        }

        #[test]
        fn promoted_checkpoint_rejects_wrong_revisions_and_propagates_expiry() {
            require_restore_initial_activation_revisions_v1(
                TENANT_ROOT_INITIAL_CREATION_ACTIVATION_EXPECTED_REVISION_V1,
                TENANT_ROOT_INITIAL_CREATION_ACTIVATION_RESULT_REVISION_V1,
            )
            .expect("canonical initial activation revisions");
            assert!(require_restore_initial_activation_revisions_v1(3, 4).is_err());

            let expired =
                CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforePromotion {
                    grant_digest_b64u: "grant".to_owned(),
                    operation_digest_b64u: "operation".to_owned(),
                };
            assert_eq!(
                require_promoted_restore_refresh_read_v1(expired)
                    .expect_err("expired promotion")
                    .code(),
                RouterAbProtocolErrorCode::ExpiredLocalRequest
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::durable_object::tenant_root_creation::{
        validate_creation_record, CloudflareTenantRootCreationJournalRecordV1,
    };
    use crate::encode_base64url_bytes_v1;
    use crate::{
        parse_cloudflare_tenant_root_recovery_trust_bundle_v1, CloudflareEnvMapV1,
        TENANT_ROOT_RECOVERY_TRUST_BUNDLE_JSON_ENV,
    };
    use curve25519_dalek::scalar::Scalar;
    use ed25519_dalek::SigningKey;
    use rand_chacha::ChaCha20Rng;
    use rand_core_06::SeedableRng;
    use router_ab_core::{
        TenantRootActivationReceiptBindingV1, TenantRootActivationReceiptTransitionV1,
        TenantRootCanaryCurveFamilyV1, TenantRootCeremonyEpochsV1, TenantRootCeremonyNonceV1,
        TenantRootCeremonySessionIdV1, TenantRootCreationCapabilityNonceV1,
        TenantRootCreationCapabilityV1, TenantRootCustodyLineageId, TenantRootEpochCommitmentsV1,
        TenantRootIdentityV1, TenantRootManagedBackupBindingV1,
        TenantRootManagedBackupSealRequestV1, TenantRootProviderCanaryReceiptBindingV1,
        TenantRootRecoveryManifestV1, TenantRootRestoreAuthorizationNonceV1,
        TenantRootRestoreDestinationFingerprintV1, TenantRootRestoreRefreshGrantV1,
        TenantRootRestoreSessionIdV1, TenantRootShareInstallationEvidenceV1,
        TenantRootShareInstallationTranscriptV1, TenantRootSignedManagedBackupV1,
        TenantRootSignedProviderCanaryReceiptV1, TenantRootSignedShareInstallationEvidenceV1,
        VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
    };
    use std::collections::BTreeMap;
    use threshold_prf::{
        prove_root_share_knowledge, SigningRootShare, SigningRootShareCommitment,
        SigningRootShareWire,
    };

    const ISSUER_KEY_ID: &str = "control-plane-issuer-active";
    const ISSUER_SEED: [u8; 32] = [0x51; 32];
    const OTHER_SEED: [u8; 32] = [0x52; 32];
    const AUTHORITY: [u8; 32] = [0x44; 32];
    // A 30-second ceremony window, inside the frozen 300-second maximum lifetime
    // that the capability, context, and command all enforce.
    const CEREMONY_ISSUED_AT_MS: u64 = 1_000_000;
    const CEREMONY_EXPIRES_AT_MS: u64 = 1_030_000;

    fn seed() -> Zeroizing<[u8; 32]> {
        Zeroizing::new(ISSUER_SEED)
    }

    fn published() -> BTreeMap<String, [u8; 32]> {
        BTreeMap::from([(
            ISSUER_KEY_ID.to_owned(),
            SigningKey::from_bytes(&ISSUER_SEED)
                .verifying_key()
                .to_bytes(),
        )])
    }

    fn authority() -> TenantRootControlPlaneAuthorityIdV1 {
        TenantRootControlPlaneAuthorityIdV1::from_bytes(AUTHORITY)
    }

    /// A persisted, issuer-authorized Started journal exactly as the Durable
    /// Object would hand it back and the issuer would re-validate it.
    fn validated_journal() -> ValidatedTenantRootCreationJournalV1 {
        let identity =
            TenantRootIdentityV1::new("org-1", "project-2", "production", "root-main", "v3")
                .expect("identity");
        let lineage = TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage");
        let context = TenantRootCeremonyContextV1::new(
            identity.digest().expect("identity digest"),
            lineage,
            TenantRootCeremonyEpochsV1::create(),
            TenantRootCeremonySessionIdV1::from_bytes([0x11; 16]).expect("session"),
            TenantRootCeremonyNonceV1::from_bytes([0x33; 32]).expect("nonce"),
            CEREMONY_ISSUED_AT_MS,
            CEREMONY_EXPIRES_AT_MS,
            "deriver-a-signing-key-7",
            "deriver-b-signing-key-9",
        )
        .expect("context");
        let journal =
            TenantRootCreationJournalV1::started(identity, lineage, context).expect("journal");
        let capability = TenantRootCreationCapabilityV1::sign(
            journal.identity_digest(),
            journal.custody_lineage(),
            journal.digest().expect("journal digest"),
            authority(),
            TenantRootCreationCapabilityNonceV1::from_bytes([0x55; 32]).expect("capability nonce"),
            CEREMONY_ISSUED_AT_MS,
            CEREMONY_EXPIRES_AT_MS,
            ISSUER_KEY_ID,
            &ISSUER_SEED,
        )
        .expect("capability");
        validate_creation_record(
            CloudflareTenantRootCreationJournalRecordV1 {
                journal_b64u: encode_base64url_bytes_v1(
                    &journal.canonical_bytes().expect("journal bytes"),
                ),
                creation_capability_b64u: encode_base64url_bytes_v1(
                    &capability.canonical_bytes().expect("capability bytes"),
                ),
            },
            authority(),
            &published(),
        )
        .expect("validated journal")
    }

    fn fresh() -> TenantRootCreationProgressV1 {
        TenantRootCreationProgressV1 {
            committed_roles: Vec::new(),
            installation_checkpoint:
                CloudflareTenantRootCreationInstallationCheckpointReadStateV1::None,
            cleanup_checkpointed: false,
        }
    }

    fn issue(
        journal: &ValidatedTenantRootCreationJournalV1,
        progress: &TenantRootCreationProgressV1,
        role: TwoPartyDeriverRole,
        now_ms: u64,
        issuer_seed: &Zeroizing<[u8; 32]>,
    ) -> RouterAbProtocolResult<IssuedTenantRootRoleCreationCommandV1> {
        issue_tenant_root_role_creation_command_v1(
            TenantRootRoleCreationCommandIssuanceV1 {
                journal,
                progress: &progress.clone(),
                role,
                authority_id: authority(),
                now_ms,
            },
            ISSUER_KEY_ID,
            issuer_seed,
        )
    }

    const GRANT_KEY_ID: &str = "provisioning-authority-v1";
    const GRANT_SEED: [u8; 32] = [0x71; 32];
    const RESTORE_REFRESH_GRANT_KEY_ID: &str = "restore-refresh-authority-v1";
    const RESTORE_REFRESH_GRANT_SEED: [u8; 32] = [0x72; 32];
    const RESTORE_REFRESH_DERIVER_A_KEY_ID: &str = "destination-deriver-a-v1";
    const RESTORE_REFRESH_DERIVER_B_KEY_ID: &str = "destination-deriver-b-v1";

    fn grant_verifying_key() -> [u8; 32] {
        SigningKey::from_bytes(&GRANT_SEED)
            .verifying_key()
            .to_bytes()
    }

    fn signed_grant(
        org: &str,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> router_ab_core::TenantRootCreationGrantV1 {
        router_ab_core::TenantRootCreationGrantV1::sign(
            &TenantRootIdentityV1::new(org, "project-2", "production", "root-main", "v3")
                .expect("identity"),
            TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage"),
            router_ab_core::TenantRootCreationGrantNonceV1::from_bytes([0x33; 32])
                .expect("grant nonce"),
            issued_at_ms,
            expires_at_ms,
            GRANT_KEY_ID,
            &GRANT_SEED,
        )
        .expect("signed grant")
    }

    fn verified_grant(org: &str) -> VerifiedTenantRootCreationGrantV1 {
        signed_grant(org, CEREMONY_ISSUED_AT_MS, CEREMONY_EXPIRES_AT_MS)
            .verify(GRANT_KEY_ID, &grant_verifying_key())
            .expect("verified grant")
    }

    fn restore_refresh_manifest() -> TenantRootRecoveryManifestV1 {
        TenantRootRecoveryManifestV1::from_canonical_json(include_bytes!(
            "../../router-ab-core/tests/fixtures/tenant-root-recovery/manifest.json"
        ))
        .expect("recovery manifest")
    }

    fn restore_refresh_grant(
        manifest: &TenantRootRecoveryManifestV1,
        identity_digest: router_ab_core::TenantRootIdentityDigestV1,
    ) -> TenantRootRestoreRefreshGrantV1 {
        TenantRootRestoreRefreshGrantV1::sign(
            TenantRootProtocolDigestV1::from_bytes([0x81; 32]).expect("operation digest"),
            identity_digest,
            TenantRootRestoreDestinationFingerprintV1::from_bytes([0x82; 32])
                .expect("destination fingerprint"),
            TenantRootCustodyLineageId::from_bytes([0x83; 16]).expect("destination lineage"),
            TenantRootRestoreSessionIdV1::from_bytes([0x84; 16]).expect("restore session"),
            manifest.digest().expect("manifest digest"),
            TenantRootLifecycleReceiptDigestV1::from_bytes([0x85; 32]).expect("Deriver A receipt"),
            TenantRootLifecycleReceiptDigestV1::from_bytes([0x86; 32]).expect("Deriver B receipt"),
            TenantRootRestoreAuthorizationNonceV1::from_bytes([0x87; 32])
                .expect("restore refresh nonce"),
            CEREMONY_ISSUED_AT_MS,
            CEREMONY_EXPIRES_AT_MS,
            RESTORE_REFRESH_GRANT_KEY_ID,
            &RESTORE_REFRESH_GRANT_SEED,
        )
        .expect("restore refresh grant")
    }

    /// The ceremony as the handler derives it: from the exact grant bytes.
    fn ceremony_draw_for(org: &str) -> TenantRootCreationCeremonyDrawV1 {
        derive_tenant_root_creation_ceremony_v1(
            &signed_grant(org, CEREMONY_ISSUED_AT_MS, CEREMONY_EXPIRES_AT_MS)
                .canonical_bytes()
                .expect("grant bytes"),
            "deriver-a-signing-key-7".to_owned(),
            "deriver-b-signing-key-9".to_owned(),
        )
        .expect("derived ceremony")
    }

    fn ceremony_draw() -> TenantRootCreationCeremonyDrawV1 {
        ceremony_draw_for("org-1")
    }

    /// Genesis constructs the journal and capability from the grant alone; the
    /// result is exactly what the Durable Object independently admits.
    #[test]
    fn genesis_builds_a_journal_the_durable_object_accepts() {
        let grant = verified_grant("org-1");
        let now = CEREMONY_ISSUED_AT_MS + 1;
        let authorized = authorize_tenant_root_creation_v1(
            &grant,
            &ceremony_draw(),
            now,
            authority(),
            ISSUER_KEY_ID,
            &seed(),
        )
        .expect("authorized");

        // The journal names exactly the authorized tenant and lineage.
        assert_eq!(
            authorized.journal.identity_digest(),
            grant.identity_digest()
        );
        assert_eq!(
            authorized.journal.custody_lineage(),
            grant.custody_lineage()
        );

        // The capability attests the journal the issuer just built, and
        // re-validates through the same path the Durable Object uses.
        let validated = validate_creation_record(
            CloudflareTenantRootCreationJournalRecordV1 {
                journal_b64u: encode_base64url_bytes_v1(
                    &authorized.journal.canonical_bytes().expect("journal bytes"),
                ),
                creation_capability_b64u: encode_base64url_bytes_v1(
                    &authorized
                        .capability
                        .canonical_bytes()
                        .expect("capability bytes"),
                ),
            },
            authority(),
            &published(),
        )
        .expect("the Durable Object admits this creation");
        assert_eq!(validated.identity_digest, grant.identity_digest());

        // The ceremony window IS the authorization's window: reproducible, and
        // it can never outlive the grant that opened it.
        let context = &validated.ceremony_context;
        assert_eq!(context.issued_at_ms(), grant.issued_at_ms());
        assert!(context.expires_at_ms() <= grant.expires_at_ms());
        assert_eq!(
            context.signing_key_id(TwoPartyDeriverRole::DeriverA),
            "deriver-a-signing-key-7"
        );
        assert_eq!(
            context.signing_key_id(TwoPartyDeriverRole::DeriverB),
            "deriver-b-signing-key-9"
        );
    }

    /// The whole creation path, end to end: a grant opens a ceremony, and the
    /// role command minted against it verifies at a Deriver.
    #[test]
    fn genesis_then_role_command_verifies_at_a_deriver() {
        let grant = verified_grant("org-1");
        let now = CEREMONY_ISSUED_AT_MS + 1;
        let authorized = authorize_tenant_root_creation_v1(
            &grant,
            &ceremony_draw(),
            now,
            authority(),
            ISSUER_KEY_ID,
            &seed(),
        )
        .expect("authorized");
        let journal = validate_creation_record(
            CloudflareTenantRootCreationJournalRecordV1 {
                journal_b64u: encode_base64url_bytes_v1(
                    &authorized.journal.canonical_bytes().expect("journal bytes"),
                ),
                creation_capability_b64u: encode_base64url_bytes_v1(
                    &authorized
                        .capability
                        .canonical_bytes()
                        .expect("capability bytes"),
                ),
            },
            authority(),
            &published(),
        )
        .expect("validated journal");

        for role in [TwoPartyDeriverRole::DeriverA, TwoPartyDeriverRole::DeriverB] {
            let issued = issue_tenant_root_role_creation_command_v1(
                TenantRootRoleCreationCommandIssuanceV1 {
                    journal: &journal,
                    progress: &fresh(),
                    role,
                    authority_id: authority(),
                    now_ms: now + 1,
                },
                ISSUER_KEY_ID,
                &seed(),
            )
            .expect("issued command");
            let verified = issued
                .package
                .verify(
                    role,
                    authority(),
                    ISSUER_KEY_ID,
                    &published()[ISSUER_KEY_ID],
                )
                .expect("a Deriver verifies it with only the package and the public anchor");
            assert_eq!(verified.command().role(), role);
        }
    }

    /// A lost-response retry of the SAME grant must reproduce the SAME creation.
    ///
    /// The Durable Object recognises a replay only on an exact byte match, so
    /// any per-request randomness or clock reading in the constructed bytes
    /// would make a retry conflict with its own first attempt.
    #[test]
    fn the_same_grant_reproduces_the_same_creation_byte_for_byte() {
        let grant = verified_grant("org-1");
        // Two attempts at different wall-clock instants inside the window.
        let first = authorize_tenant_root_creation_v1(
            &grant,
            &ceremony_draw(),
            CEREMONY_ISSUED_AT_MS + 1,
            authority(),
            ISSUER_KEY_ID,
            &seed(),
        )
        .expect("first attempt");
        let retry = authorize_tenant_root_creation_v1(
            &grant,
            &ceremony_draw(),
            CEREMONY_EXPIRES_AT_MS - 1,
            authority(),
            ISSUER_KEY_ID,
            &seed(),
        )
        .expect("lost-response retry");

        assert_eq!(
            first.journal.canonical_bytes().expect("journal"),
            retry.journal.canonical_bytes().expect("journal"),
        );
        assert_eq!(
            first.capability.canonical_bytes().expect("capability"),
            retry.capability.canonical_bytes().expect("capability"),
        );
        assert_eq!(
            first.journal.digest().expect("digest"),
            retry.journal.digest().expect("digest")
        );
        assert_eq!(
            first.capability.digest().expect("digest"),
            retry.capability.digest().expect("digest")
        );

        // The Durable Object therefore sees an identical record and replays it
        // rather than reporting a conflicting pair.
        let record =
            |a: &AuthorizedTenantRootCreationV1| CloudflareTenantRootCreationJournalRecordV1 {
                journal_b64u: encode_base64url_bytes_v1(
                    &a.journal.canonical_bytes().expect("journal"),
                ),
                creation_capability_b64u: encode_base64url_bytes_v1(
                    &a.capability.canonical_bytes().expect("capability"),
                ),
            };
        assert_eq!(record(&first), record(&retry));

        // A DIFFERENT grant for the same tenant still produces different bytes,
        // so it conflicts rather than silently replaying.
        let other = signed_grant("org-1", CEREMONY_ISSUED_AT_MS + 5, CEREMONY_EXPIRES_AT_MS)
            .verify(GRANT_KEY_ID, &grant_verifying_key())
            .expect("second grant");
        let other_draw = derive_tenant_root_creation_ceremony_v1(
            &signed_grant("org-1", CEREMONY_ISSUED_AT_MS + 5, CEREMONY_EXPIRES_AT_MS)
                .canonical_bytes()
                .expect("grant bytes"),
            "deriver-a-signing-key-7".to_owned(),
            "deriver-b-signing-key-9".to_owned(),
        )
        .expect("derived");
        let different = authorize_tenant_root_creation_v1(
            &other,
            &other_draw,
            CEREMONY_ISSUED_AT_MS + 6,
            authority(),
            ISSUER_KEY_ID,
            &seed(),
        )
        .expect("different grant");
        assert_ne!(record(&first), record(&different));
    }

    /// The derived material is grant-specific, not a constant.
    #[test]
    fn ceremony_material_is_derived_per_grant() {
        let a = ceremony_draw_for("org-1");
        let b = ceremony_draw_for("org-2");
        assert_ne!(a.session_id, b.session_id);
        assert_ne!(a.ceremony_nonce, b.ceremony_nonce);
        assert_ne!(a.capability_nonce, b.capability_nonce);
        // Domain separation: the three values differ within one grant.
        assert_ne!(a.ceremony_nonce.as_bytes(), a.capability_nonce.as_bytes());
    }

    #[test]
    fn genesis_fails_closed_outside_the_authorized_window() {
        let grant = verified_grant("org-1");
        for now in [
            0,
            CEREMONY_ISSUED_AT_MS,
            CEREMONY_EXPIRES_AT_MS,
            CEREMONY_EXPIRES_AT_MS + 1,
        ] {
            assert!(
                authorize_tenant_root_creation_v1(
                    &grant,
                    &ceremony_draw(),
                    now,
                    authority(),
                    ISSUER_KEY_ID,
                    &seed(),
                )
                .is_err(),
                "now={now} must be refused"
            );
        }
    }

    #[test]
    fn genesis_refuses_a_ceremony_that_cannot_separate_the_roles() {
        let grant = verified_grant("org-1");
        let mut draw = ceremony_draw();
        draw.deriver_b_signing_key_id = draw.deriver_a_signing_key_id.clone();
        assert_eq!(
            authorize_tenant_root_creation_v1(
                &grant,
                &draw,
                CEREMONY_ISSUED_AT_MS + 1,
                authority(),
                ISSUER_KEY_ID,
                &seed(),
            )
            .expect_err("identical role signers")
            .code(),
            RouterAbProtocolErrorCode::ForbiddenLocalBinding
        );
    }

    #[test]
    fn distinct_tenants_open_distinct_creations() {
        let now = CEREMONY_ISSUED_AT_MS + 1;
        let a = authorize_tenant_root_creation_v1(
            &verified_grant("org-1"),
            &ceremony_draw(),
            now,
            authority(),
            ISSUER_KEY_ID,
            &seed(),
        )
        .expect("org-1");
        let b = authorize_tenant_root_creation_v1(
            &verified_grant("org-2"),
            &ceremony_draw_for("org-2"),
            now,
            authority(),
            ISSUER_KEY_ID,
            &seed(),
        )
        .expect("org-2");
        assert_ne!(a.journal.identity_digest(), b.journal.identity_digest());
        assert_ne!(
            a.journal.digest().expect("digest"),
            b.journal.digest().expect("digest")
        );
        assert_ne!(
            a.capability.digest().expect("digest"),
            b.capability.digest().expect("digest")
        );
    }

    #[test]
    fn the_genesis_request_surface_carries_only_a_grant() {
        let request = CloudflareTenantRootControlPlaneCreateTenantRootRequestV1 {
            creation_grant_b64u: "abc".to_owned(),
        };
        let json = serde_json::to_value(&request).expect("json");
        let keys: Vec<&str> = json
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, ["creation_grant_b64u"]);
        // A smuggled identity, lineage, or window is rejected outright.
        let smuggled = r#"{"creation_grant_b64u":"abc","custody_lineage_b64u":"x"}"#;
        assert!(
            serde_json::from_str::<CloudflareTenantRootControlPlaneCreateTenantRootRequestV1>(
                smuggled
            )
            .is_err()
        );
    }

    #[test]
    fn issued_command_verifies_at_a_deriver_with_only_the_package_and_the_public_anchor() {
        let journal = validated_journal();
        let now = CEREMONY_ISSUED_AT_MS + 10_000;
        for role in [TwoPartyDeriverRole::DeriverA, TwoPartyDeriverRole::DeriverB] {
            let issued = issue(&journal, &fresh(), role, now, &seed()).expect("issued");

            // Exactly what a Deriver holds: the package bytes, its own expected
            // role and authority, and the published issuer key. No Router state.
            let package = TenantRootRoleCreationCommandPackageV1::decode_canonical_bytes(
                &issued.package.canonical_bytes().expect("package bytes"),
            )
            .expect("package decodes");
            let verified = package
                .verify(
                    role,
                    authority(),
                    ISSUER_KEY_ID,
                    &published()[ISSUER_KEY_ID],
                )
                .expect("verifies");
            assert_eq!(verified.command().role(), role);
            assert_eq!(verified.command().issuer_key_id(), ISSUER_KEY_ID);
            assert_eq!(issued.command.role(), role);

            // The window is derived: starts now, capped by the ceremony window
            // and the frozen maximum lifetime.
            assert_eq!(issued.command.issued_at_ms(), now);
            assert_eq!(
                issued.command.expires_at_ms(),
                (now + TENANT_ROOT_MAX_LIFETIME_MS_V1).min(CEREMONY_EXPIRES_AT_MS)
            );
            assert!(verified.command().require_fresh(now + 1).is_ok());

            // A Deriver expecting the other role must reject it.
            let other = match role {
                TwoPartyDeriverRole::DeriverA => TwoPartyDeriverRole::DeriverB,
                TwoPartyDeriverRole::DeriverB => TwoPartyDeriverRole::DeriverA,
            };
            assert!(package
                .verify(
                    other,
                    authority(),
                    ISSUER_KEY_ID,
                    &published()[ISSUER_KEY_ID]
                )
                .is_err());
        }
    }

    #[test]
    fn issuance_fails_closed_once_creation_is_checkpointed_or_the_role_committed() {
        let journal = validated_journal();
        let now = CEREMONY_ISSUED_AT_MS + 10_000;

        let abandoned = TenantRootCreationProgressV1 {
            committed_roles: vec![TwoPartyDeriverRole::DeriverB],
            installation_checkpoint:
                CloudflareTenantRootCreationInstallationCheckpointReadStateV1::OneRoleReady {
                    role: CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
                    signed_evidence_b64u: "evidence".to_owned(),
                },
            cleanup_checkpointed: true,
        };
        assert_eq!(
            issue(
                &journal,
                &abandoned,
                TwoPartyDeriverRole::DeriverA,
                now,
                &seed()
            )
            .expect_err("abandoned")
            .code(),
            RouterAbProtocolErrorCode::ForbiddenLocalBinding
        );

        let checkpointed = TenantRootCreationProgressV1 {
            committed_roles: Vec::new(),
            installation_checkpoint:
                CloudflareTenantRootCreationInstallationCheckpointReadStateV1::BothRolesReady {
                    root_commitment_b64u: "root".to_owned(),
                },
            cleanup_checkpointed: false,
        };
        assert_eq!(
            issue(
                &journal,
                &checkpointed,
                TwoPartyDeriverRole::DeriverA,
                now,
                &seed()
            )
            .expect_err("checkpointed")
            .code(),
            RouterAbProtocolErrorCode::ForbiddenLocalBinding
        );

        let a_committed = TenantRootCreationProgressV1 {
            committed_roles: vec![TwoPartyDeriverRole::DeriverA],
            installation_checkpoint:
                CloudflareTenantRootCreationInstallationCheckpointReadStateV1::None,
            cleanup_checkpointed: false,
        };
        assert!(issue(
            &journal,
            &a_committed,
            TwoPartyDeriverRole::DeriverA,
            now,
            &seed()
        )
        .is_err());
        // The peer that has not committed may still be issued its command.
        assert!(issue(
            &journal,
            &a_committed,
            TwoPartyDeriverRole::DeriverB,
            now,
            &seed()
        )
        .is_ok());
    }

    #[test]
    fn issuance_fails_closed_outside_the_ceremony_window() {
        let journal = validated_journal();
        for now in [
            0,
            CEREMONY_ISSUED_AT_MS - 1,
            CEREMONY_EXPIRES_AT_MS,
            CEREMONY_EXPIRES_AT_MS + 1,
        ] {
            assert!(
                issue(
                    &journal,
                    &fresh(),
                    TwoPartyDeriverRole::DeriverA,
                    now,
                    &seed()
                )
                .is_err(),
                "now={now} must be refused"
            );
        }
        // The last instant inside the window still yields a non-empty command window.
        let issued = issue(
            &journal,
            &fresh(),
            TwoPartyDeriverRole::DeriverA,
            CEREMONY_EXPIRES_AT_MS - 1,
            &seed(),
        )
        .expect("edge of window");
        assert_eq!(issued.command.expires_at_ms(), CEREMONY_EXPIRES_AT_MS);
    }

    #[test]
    fn a_command_signed_with_the_wrong_seed_never_verifies_under_the_published_key() {
        // The issuer cannot mint a verifiable command without the seed that
        // derives the published active key; boot-time provenance proves the
        // seed, this proves the consequence if it were ever bypassed.
        let journal = validated_journal();
        let issued = issue(
            &journal,
            &fresh(),
            TwoPartyDeriverRole::DeriverA,
            CEREMONY_ISSUED_AT_MS + 10_000,
            &Zeroizing::new(OTHER_SEED),
        )
        .expect("signing itself succeeds");
        assert!(issued
            .package
            .verify(
                TwoPartyDeriverRole::DeriverA,
                authority(),
                ISSUER_KEY_ID,
                &published()[ISSUER_KEY_ID],
            )
            .is_err());
    }

    #[test]
    fn the_request_surface_names_only_identity_lineage_and_role() {
        // Structural: every other command field is derived by the issuer.
        let request = CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1 {
            identity_digest_b64u: "a".repeat(43),
            custody_lineage_b64u: "b".repeat(22),
            role: CloudflareTenantRootControlPlaneRoleV1::DeriverB,
        };
        let json = serde_json::to_value(&request).expect("json");
        let mut keys: Vec<&str> = json
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            ["custody_lineage_b64u", "identity_digest_b64u", "role"]
        );
        // Unknown fields such as an authority id or a time window are rejected.
        let smuggled = r#"{"identity_digest_b64u":"a","custody_lineage_b64u":"b","role":"deriver_a","authority_id_b64u":"x"}"#;
        assert!(
            serde_json::from_str::<CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1>(
                smuggled
            )
            .is_err()
        );
    }

    const ACTIVATION_ISSUER_SEED: [u8; 32] = [0x51; 32];
    const ACTIVATION_CANARY_SEED: [u8; 32] = [0x71; 32];

    fn activation_context() -> TenantRootCeremonyContextV1 {
        let identity = TenantRootIdentityV1::new(
            "activation-org",
            "activation-project",
            "production",
            "root-main",
            "v1",
        )
        .expect("identity");
        TenantRootCeremonyContextV1::new(
            identity.digest().expect("identity digest"),
            TenantRootCustodyLineageId::from_bytes([0x23; 16]).expect("lineage"),
            TenantRootCeremonyEpochsV1::create(),
            TenantRootCeremonySessionIdV1::from_bytes([0x24; 16]).expect("session"),
            TenantRootCeremonyNonceV1::from_bytes([0x25; 32]).expect("nonce"),
            CEREMONY_ISSUED_AT_MS,
            CEREMONY_EXPIRES_AT_MS,
            "deriver-a-signing-key-7",
            "deriver-b-signing-key-9",
        )
        .expect("context")
    }

    fn refresh_activation_context() -> TenantRootCeremonyContextV1 {
        let identity = TenantRootIdentityV1::new(
            "activation-org",
            "activation-project",
            "production",
            "root-main",
            "v1",
        )
        .expect("identity");
        let epochs = TenantRootCeremonyEpochsV1::refresh(
            TenantRootShareEpoch::new(7).expect("current epoch"),
            TenantRootShareEpoch::new(8).expect("next epoch"),
        )
        .expect("refresh epochs");
        TenantRootCeremonyContextV1::new(
            identity.digest().expect("identity digest"),
            TenantRootCustodyLineageId::from_bytes([0x23; 16]).expect("lineage"),
            epochs,
            TenantRootCeremonySessionIdV1::from_bytes([0x64; 16]).expect("session"),
            TenantRootCeremonyNonceV1::from_bytes([0x65; 32]).expect("nonce"),
            CEREMONY_ISSUED_AT_MS,
            CEREMONY_EXPIRES_AT_MS,
            "deriver-a-signing-key-7",
            "deriver-b-signing-key-9",
        )
        .expect("refresh context")
    }

    fn activation_share(role: TwoPartyDeriverRole, scalar: u64) -> SigningRootShare {
        SigningRootShare::from_canonical_bytes(role.share_id(), Scalar::from(scalar).to_bytes())
            .expect("share")
    }

    fn activation_role_signing_key(role: TwoPartyDeriverRole) -> SigningKey {
        SigningKey::from_bytes(match role {
            TwoPartyDeriverRole::DeriverA => &[0x61; 32],
            TwoPartyDeriverRole::DeriverB => &[0x62; 32],
        })
    }

    fn activation_role_signing_key_id(role: TwoPartyDeriverRole) -> &'static str {
        match role {
            TwoPartyDeriverRole::DeriverA => "deriver-a-signing-key-7",
            TwoPartyDeriverRole::DeriverB => "deriver-b-signing-key-9",
        }
    }

    fn activation_installation(
        context: TenantRootCeremonyContextV1,
        role: TwoPartyDeriverRole,
        share: &SigningRootShare,
        peer: &SigningRootShare,
        proof_seed: u8,
    ) -> router_ab_core::VerifiedTenantRootSignedShareInstallationEvidenceWireV1 {
        let transcript = TenantRootShareInstallationTranscriptV1::new(
            context,
            role,
            SigningRootShareCommitment::from_share(share),
            SigningRootShareCommitment::from_share(peer),
        )
        .expect("installation transcript");
        let proof = prove_root_share_knowledge(
            share,
            &transcript.canonical_bytes().expect("transcript bytes"),
            &mut ChaCha20Rng::from_seed([proof_seed; 32]),
        )
        .expect("knowledge proof");
        let evidence = TenantRootShareInstallationEvidenceV1::new(transcript, proof)
            .expect("installation evidence");
        let signing_key = activation_role_signing_key(role);
        let signed =
            TenantRootSignedShareInstallationEvidenceV1::sign(evidence, &signing_key.to_bytes())
                .expect("signed installation evidence");
        let bytes = signed.canonical_bytes().expect("installation bytes");
        TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
            &bytes,
            signing_key.verifying_key().as_bytes(),
        )
        .expect("verified installation evidence")
    }

    fn activation_commitments(
        share_a: &SigningRootShare,
        share_b: &SigningRootShare,
    ) -> TenantRootEpochCommitmentsV1 {
        TenantRootEpochCommitmentsV1::new(
            router_ab_core::MpcPrfShareCommitmentWireV1::new(
                SigningRootShareCommitment::from_share(share_a)
                    .to_bytes()
                    .to_vec(),
            )
            .expect("A commitment"),
            router_ab_core::MpcPrfShareCommitmentWireV1::new(
                SigningRootShareCommitment::from_share(share_b)
                    .to_bytes()
                    .to_vec(),
            )
            .expect("B commitment"),
        )
        .expect("commitments")
    }

    fn activation_backup(
        installation: &router_ab_core::VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        share: &SigningRootShare,
        role: TwoPartyDeriverRole,
    ) -> router_ab_core::VerifiedTenantRootManagedBackupV1 {
        let binding = TenantRootManagedBackupBindingV1::from_verified_installation_evidence(
            installation,
            format!("backup-provider-{}", role.as_str()),
            format!("kms/tenant-root/{}/epoch-1/v1", role.as_str()),
            activation_role_signing_key_id(role),
            CEREMONY_ISSUED_AT_MS,
        )
        .expect("backup binding");
        let share_wire = router_ab_core::MpcPrfSigningRootShareWireV1::new(
            SigningRootShareWire::from_share(share).to_bytes().to_vec(),
        )
        .expect("share wire");
        let request = TenantRootManagedBackupSealRequestV1::new(binding.clone(), share_wire)
            .expect("backup seal request");
        let signing_key = activation_role_signing_key(role);
        let ciphertext = match role {
            TwoPartyDeriverRole::DeriverA => vec![0xa5; 96],
            TwoPartyDeriverRole::DeriverB => vec![0xb5; 96],
        };
        let signed =
            TenantRootSignedManagedBackupV1::sign(request, ciphertext, &signing_key.to_bytes())
                .expect("signed managed backup");
        signed
            .verify(&binding, signing_key.verifying_key().as_bytes())
            .expect("verified managed backup")
    }

    fn activation_canary(
        context: &TenantRootCeremonyContextV1,
        commitments: &TenantRootEpochCommitmentsV1,
        family: TenantRootCanaryCurveFamilyV1,
    ) -> router_ab_core::VerifiedTenantRootProviderCanaryReceiptV1 {
        let (transition, target_epoch) = match context.epochs() {
            TenantRootCeremonyEpochsV1::Create { next } => (
                TenantRootActivationReceiptTransitionV1::InitialCreation,
                next,
            ),
            TenantRootCeremonyEpochsV1::Refresh { next, .. } => {
                (TenantRootActivationReceiptTransitionV1::RefreshSwap, next)
            }
        };
        let binding = TenantRootProviderCanaryReceiptBindingV1::new(
            context.identity_digest(),
            context.custody_lineage(),
            transition,
            target_epoch,
            commitments.clone(),
            family,
            format!("kms/tenant-root/{}/canary-v1", family.as_str()),
            CEREMONY_ISSUED_AT_MS + 10,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x72; 32]),
            "control-plane-canary-v1",
            CEREMONY_ISSUED_AT_MS,
            CEREMONY_EXPIRES_AT_MS,
        )
        .expect("canary binding");
        let signed =
            TenantRootSignedProviderCanaryReceiptV1::sign(binding.clone(), &ACTIVATION_CANARY_SEED)
                .expect("signed canary");
        signed
            .verify(
                &binding,
                &SigningKey::from_bytes(&ACTIVATION_CANARY_SEED)
                    .verifying_key()
                    .to_bytes(),
            )
            .expect("verified canary")
    }

    fn activation_bundle() -> VerifiedTenantRootInitialCreationActivationEvidenceBundleV1 {
        let context = activation_context();
        let share_a = activation_share(TwoPartyDeriverRole::DeriverA, 12);
        let share_b = activation_share(TwoPartyDeriverRole::DeriverB, 19);
        let installation_a = activation_installation(
            context.clone(),
            TwoPartyDeriverRole::DeriverA,
            &share_a,
            &share_b,
            0x31,
        );
        let installation_b = activation_installation(
            context.clone(),
            TwoPartyDeriverRole::DeriverB,
            &share_b,
            &share_a,
            0x32,
        );
        let commitments = activation_commitments(&share_a, &share_b);
        let backup_a = activation_backup(&installation_a, &share_a, TwoPartyDeriverRole::DeriverA);
        let backup_b = activation_backup(&installation_b, &share_b, TwoPartyDeriverRole::DeriverB);
        let canary_ecdsa =
            activation_canary(&context, &commitments, TenantRootCanaryCurveFamilyV1::Ecdsa);
        let canary_ed25519 = activation_canary(
            &context,
            &commitments,
            TenantRootCanaryCurveFamilyV1::Ed25519,
        );
        VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_managed_backups(
            installation_a,
            installation_b,
            backup_a,
            backup_b,
            canary_ecdsa,
            canary_ed25519,
            2,
            3,
        )
        .expect("verified initial activation evidence")
    }

    fn refresh_activation_bundle() -> VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1 {
        refresh_activation_bundle_with_scalars(12, 19, 19, 33, 5, 6)
    }

    fn refresh_activation_bundle_with_scalars(
        current_a_scalar: u64,
        current_b_scalar: u64,
        next_a_scalar: u64,
        next_b_scalar: u64,
        expected_control_plane_revision: u64,
        result_control_plane_revision: u64,
    ) -> VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1 {
        let context = refresh_activation_context();
        let current_a = activation_share(TwoPartyDeriverRole::DeriverA, current_a_scalar);
        let current_b = activation_share(TwoPartyDeriverRole::DeriverB, current_b_scalar);
        let next_a = activation_share(TwoPartyDeriverRole::DeriverA, next_a_scalar);
        let next_b = activation_share(TwoPartyDeriverRole::DeriverB, next_b_scalar);
        let current_commitments = activation_commitments(&current_a, &current_b);
        let installation_a = activation_installation(
            context.clone(),
            TwoPartyDeriverRole::DeriverA,
            &next_a,
            &next_b,
            0x41,
        );
        let installation_b = activation_installation(
            context.clone(),
            TwoPartyDeriverRole::DeriverB,
            &next_b,
            &next_a,
            0x42,
        );
        let next_commitments = activation_commitments(&next_a, &next_b);
        let backup_a = activation_backup(&installation_a, &next_a, TwoPartyDeriverRole::DeriverA);
        let backup_b = activation_backup(&installation_b, &next_b, TwoPartyDeriverRole::DeriverB);
        let canary_ecdsa = activation_canary(
            &context,
            &next_commitments,
            TenantRootCanaryCurveFamilyV1::Ecdsa,
        );
        let canary_ed25519 = activation_canary(
            &context,
            &next_commitments,
            TenantRootCanaryCurveFamilyV1::Ed25519,
        );
        VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1::from_verified_managed_backups(
            &current_commitments,
            installation_a,
            installation_b,
            backup_a,
            backup_b,
            canary_ecdsa,
            canary_ed25519,
            expected_control_plane_revision,
            result_control_plane_revision,
        )
        .expect("verified refresh activation evidence")
    }

    #[test]
    fn initial_activation_issuance_returns_the_exact_typed_receipt_wire() {
        let bundle = activation_bundle();
        let activated_at_ms = CEREMONY_ISSUED_AT_MS + 20;
        let receipt = issue_tenant_root_initial_activation_receipt_v1(
            &bundle,
            activated_at_ms,
            authority(),
            ISSUER_KEY_ID,
            &Zeroizing::new(ACTIVATION_ISSUER_SEED),
        )
        .expect("issued initial activation receipt");
        let receipt_bytes = receipt.canonical_bytes().expect("receipt bytes");
        let verified = receipt
            .clone()
            .verify_initial_creation(
                &bundle,
                activated_at_ms,
                authority(),
                ISSUER_KEY_ID,
                &SigningKey::from_bytes(&ACTIVATION_ISSUER_SEED)
                    .verifying_key()
                    .to_bytes(),
            )
            .expect("receipt verifies against the complete bundle");
        assert_eq!(
            verified.transition(),
            TenantRootActivationReceiptTransitionV1::InitialCreation
        );

        let response = initial_activation_receipt_response_v1(receipt).expect("typed response");
        assert_eq!(
            crate::decode_base64url_bytes_v1(
                "initial activation receipt",
                &response.activation_receipt_b64u
            )
            .expect("response receipt bytes"),
            receipt_bytes
        );
    }

    #[test]
    fn refresh_activation_issuance_binds_the_exact_pair_and_revision() {
        let bundle = refresh_activation_bundle();
        let activated_at_ms = CEREMONY_ISSUED_AT_MS + 20;
        let receipt = issue_tenant_root_refresh_activation_receipt_v1(
            &bundle,
            activated_at_ms,
            authority(),
            ISSUER_KEY_ID,
            &Zeroizing::new(ACTIVATION_ISSUER_SEED),
        )
        .expect("issued refresh activation receipt");
        let issuer_verifying_key = SigningKey::from_bytes(&ACTIVATION_ISSUER_SEED)
            .verifying_key()
            .to_bytes();
        let verified = receipt
            .clone()
            .verify_refresh_swap(
                &bundle,
                activated_at_ms,
                authority(),
                ISSUER_KEY_ID,
                &issuer_verifying_key,
            )
            .expect("receipt verifies against the exact refresh bundle");
        let TenantRootActivationReceiptBindingV1::RefreshSwap(binding) = verified.binding() else {
            panic!("refresh issuer must produce a refresh-swap receipt")
        };
        assert_eq!(
            binding.current_epoch(),
            TenantRootShareEpoch::new(7).unwrap()
        );
        assert_eq!(binding.next_epoch(), TenantRootShareEpoch::new(8).unwrap());
        assert_eq!(binding.expected_control_plane_revision(), 5);
        assert_eq!(binding.result_control_plane_revision(), 6);
        assert_eq!(binding.current_commitments(), bundle.current_commitments());
        assert_eq!(binding.next_commitments(), bundle.next_commitments());

        let wrong_pair = refresh_activation_bundle_with_scalars(13, 20, 20, 34, 5, 6);
        assert!(receipt
            .clone()
            .verify_refresh_swap(
                &wrong_pair,
                activated_at_ms,
                authority(),
                ISSUER_KEY_ID,
                &issuer_verifying_key,
            )
            .is_err());

        let wrong_revision = refresh_activation_bundle_with_scalars(12, 19, 19, 33, 6, 7);
        assert!(receipt
            .verify_refresh_swap(
                &wrong_revision,
                activated_at_ms,
                authority(),
                ISSUER_KEY_ID,
                &issuer_verifying_key,
            )
            .is_err());
    }

    #[test]
    fn refresh_command_issuance_binds_both_roles_to_one_active_pair_and_context() {
        let bundle = activation_bundle();
        let activated_at_ms = CEREMONY_ISSUED_AT_MS + 20;
        let receipt = issue_tenant_root_initial_activation_receipt_v1(
            &bundle,
            activated_at_ms,
            authority(),
            ISSUER_KEY_ID,
            &Zeroizing::new(ACTIVATION_ISSUER_SEED),
        )
        .expect("issued initial activation receipt")
        .verify_initial_creation(
            &bundle,
            activated_at_ms,
            authority(),
            ISSUER_KEY_ID,
            &SigningKey::from_bytes(&ACTIVATION_ISSUER_SEED)
                .verifying_key()
                .to_bytes(),
        )
        .expect("verified active receipt");
        let active_pair = TenantRootActiveRootPairV1::from_verified_activation_receipt(&receipt)
            .expect("active pair from receipt");
        let refresh_context = TenantRootCeremonyContextV1::new(
            active_pair.identity_digest(),
            active_pair.custody_lineage(),
            TenantRootCeremonyEpochsV1::refresh(
                active_pair.epoch(),
                active_pair.epoch().next().expect("next epoch"),
            )
            .expect("refresh epochs"),
            TenantRootCeremonySessionIdV1::from_bytes([0x61; 16]).expect("session"),
            TenantRootCeremonyNonceV1::from_bytes([0x62; 32]).expect("nonce"),
            activated_at_ms + 1,
            activated_at_ms + 10_000,
            activation_role_signing_key_id(TwoPartyDeriverRole::DeriverA),
            activation_role_signing_key_id(TwoPartyDeriverRole::DeriverB),
        )
        .expect("refresh context");
        let issuer_seed = Zeroizing::new(ACTIVATION_ISSUER_SEED);
        let issued = issue_tenant_root_role_refresh_commands_v1(
            TenantRootRoleRefreshCommandIssuanceV1 {
                active_pair: &active_pair,
                refresh_context: &refresh_context,
                expected_control_plane_revision: receipt.result_control_plane_revision(),
                authority_id: authority(),
                now_ms: refresh_context.issued_at_ms(),
            },
            ISSUER_KEY_ID,
            &issuer_seed,
        )
        .expect("issued refresh role commands");
        let issuer_verifying_key = SigningKey::from_bytes(&ACTIVATION_ISSUER_SEED)
            .verifying_key()
            .to_bytes();
        let verified_a = issued
            .deriver_a
            .verify(
                &active_pair,
                &refresh_context,
                TwoPartyDeriverRole::DeriverA,
                receipt.result_control_plane_revision(),
                authority(),
                ISSUER_KEY_ID,
                &issuer_verifying_key,
            )
            .expect("verified Deriver A command");
        let verified_b = issued
            .deriver_b
            .verify(
                &active_pair,
                &refresh_context,
                TwoPartyDeriverRole::DeriverB,
                receipt.result_control_plane_revision(),
                authority(),
                ISSUER_KEY_ID,
                &issuer_verifying_key,
            )
            .expect("verified Deriver B command");
        assert_eq!(
            verified_a.refresh_context_digest(),
            verified_b.refresh_context_digest()
        );
        assert_ne!(verified_a.digest(), verified_b.digest());
    }

    #[test]
    fn restore_refresh_command_issuance_is_deterministic_and_manifest_bound() {
        let manifest = restore_refresh_manifest();
        let identity_digest = manifest.descriptor().tenant_root_identity_digest();
        let grant = restore_refresh_grant(&manifest, identity_digest);
        let grant_bytes = grant.canonical_bytes().expect("grant bytes");
        let grant_verifying_key = SigningKey::from_bytes(&RESTORE_REFRESH_GRANT_SEED)
            .verifying_key()
            .to_bytes();
        let verified_grant = TenantRootRestoreRefreshGrantV1::decode_canonical_bytes(&grant_bytes)
            .expect("decoded grant")
            .verify(RESTORE_REFRESH_GRANT_KEY_ID, &grant_verifying_key)
            .expect("verified grant");
        let issuer_seed = Zeroizing::new(ISSUER_SEED);

        let first = issue_tenant_root_restore_refresh_commands_v1(
            &verified_grant,
            &manifest,
            RESTORE_REFRESH_DERIVER_A_KEY_ID,
            RESTORE_REFRESH_DERIVER_B_KEY_ID,
            ISSUER_KEY_ID,
            &issuer_seed,
        )
        .expect("first issuance");
        let second = issue_tenant_root_restore_refresh_commands_v1(
            &verified_grant,
            &manifest,
            RESTORE_REFRESH_DERIVER_A_KEY_ID,
            RESTORE_REFRESH_DERIVER_B_KEY_ID,
            ISSUER_KEY_ID,
            &issuer_seed,
        )
        .expect("retry issuance");

        assert_eq!(
            first.context.canonical_bytes().expect("context bytes"),
            second
                .context
                .canonical_bytes()
                .expect("retry context bytes")
        );
        assert_eq!(
            first.deriver_a.canonical_bytes().expect("A bytes"),
            second.deriver_a.canonical_bytes().expect("retry A bytes")
        );
        assert_eq!(
            first.deriver_b.canonical_bytes().expect("B bytes"),
            second.deriver_b.canonical_bytes().expect("retry B bytes")
        );
        assert_eq!(
            first.context.session_id(),
            verified_grant
                .ceremony_session_id()
                .expect("ceremony session")
        );
        assert_eq!(
            first.context.identity_digest(),
            verified_grant.destination_identity_digest()
        );
        assert_eq!(
            first.context.custody_lineage(),
            verified_grant.destination_lineage()
        );
        assert!(matches!(
            first.context.epochs(),
            TenantRootCeremonyEpochsV1::Create { .. }
        ));

        let issuer_verifying_key = SigningKey::from_bytes(&ISSUER_SEED)
            .verifying_key()
            .to_bytes();
        let verified_a = first
            .deriver_a
            .verify(ISSUER_KEY_ID, &issuer_verifying_key)
            .expect("verified A command");
        let verified_b = first
            .deriver_b
            .verify(ISSUER_KEY_ID, &issuer_verifying_key)
            .expect("verified B command");
        assert_eq!(verified_a.role(), TwoPartyDeriverRole::DeriverA);
        assert_eq!(verified_b.role(), TwoPartyDeriverRole::DeriverB);
        assert_eq!(verified_a.context(), verified_b.context());
        assert_eq!(
            verified_a.manifest_digest(),
            &manifest.digest().expect("manifest digest")
        );

        let foreign_identity = router_ab_core::TenantRootIdentityDigestV1::from_bytes([0x99; 32]);
        let foreign_grant = restore_refresh_grant(&manifest, foreign_identity);
        let foreign_verified = foreign_grant
            .verify(
                RESTORE_REFRESH_GRANT_KEY_ID,
                &SigningKey::from_bytes(&RESTORE_REFRESH_GRANT_SEED)
                    .verifying_key()
                    .to_bytes(),
            )
            .expect("verified foreign grant");
        assert!(issue_tenant_root_restore_refresh_commands_v1(
            &foreign_verified,
            &manifest,
            RESTORE_REFRESH_DERIVER_A_KEY_ID,
            RESTORE_REFRESH_DERIVER_B_KEY_ID,
            ISSUER_KEY_ID,
            &issuer_seed,
        )
        .is_err());
    }

    #[test]
    fn native_manifest_registration_verifies_fixture_chain_and_signature_before_projection() {
        // This fixture is deliberately OfflineRootsOnly: it exercises the
        // native verifier with explicit local roots and makes no live-trust
        // claim about a deployment configuration.
        let env = CloudflareEnvMapV1::new(vec![(
            TENANT_ROOT_RECOVERY_TRUST_BUNDLE_JSON_ENV,
            include_str!(
                "../../router-ab-core/tests/fixtures/tenant-root-recovery/trust-bundle.json"
            ),
        )]);
        let manifest_bytes = include_bytes!(
            "../../router-ab-core/tests/fixtures/tenant-root-recovery/manifest.json"
        );
        let (manifest, trust) = verify_recovery_manifest_with_local_trust_v1(manifest_bytes, &env)
            .expect("configured native verifier");

        let response = recovery_manifest_response_v1(&manifest, &trust).expect("projection");
        assert_eq!(
            response.trust_level,
            CloudflareTenantRootRecoveryTrustLevelV1::CryptographicallyValidOffline
        );
        assert_eq!(
            response.identity_digest_b64u,
            encode_base64url_bytes_v1(
                manifest
                    .descriptor()
                    .tenant_root_identity_digest()
                    .as_bytes()
            )
        );
        assert_eq!(
            response.source_custody_lineage_b64u,
            encode_base64url_bytes_v1(manifest.descriptor().source_custody_lineage().as_bytes())
        );
        assert_eq!(
            response.stable_root_commitment_b64u,
            encode_base64url_bytes_v1(&manifest.descriptor().stable_root_commitment().to_bytes())
        );
        assert!(!response.deriver_a.recipient_public_key_b64u.is_empty());
        assert!(!response.deriver_a.recipient_fingerprint_b64u.is_empty());
        assert!(!response.deriver_b.recipient_public_key_b64u.is_empty());
        assert!(!response.deriver_b.recipient_fingerprint_b64u.is_empty());
        assert_eq!(
            response.deriver_a_package_length,
            manifest.deriver_a_package_length()
        );
        assert_eq!(
            response.deriver_b_package_length,
            manifest.deriver_b_package_length()
        );
        assert_eq!(
            response.manifest_digest_b64u,
            encode_base64url_bytes_v1(&manifest.digest().expect("manifest digest"))
        );
        assert_eq!(
            parse_cloudflare_tenant_root_recovery_trust_bundle_v1(&CloudflareEnvMapV1::new(
                Vec::<(String, String)>::new(),
            ))
            .expect_err("recovery route must require its server-owned bundle")
            .code(),
            RouterAbProtocolErrorCode::MissingLocalBinding
        );
    }

    #[test]
    fn configured_recovery_snapshot_rejects_compromised_history_without_offline_fallback() {
        use crate::env::TENANT_ROOT_RECOVERY_TRUST_SNAPSHOT_JSON_ENV;
        use router_ab_core::{
            TenantRootRecoveryRevocationEntryV1, TenantRootRecoveryRevocationSnapshotV1,
        };
        let manifest_bytes = include_bytes!(
            "../../router-ab-core/tests/fixtures/tenant-root-recovery/manifest.json"
        );
        let manifest = TenantRootRecoveryManifestV1::from_canonical_json(manifest_bytes).unwrap();
        let signer = manifest
            .descriptor()
            .deriver_a()
            .deriver_signing_key_id()
            .to_owned();
        for compromised in [false, true] {
            let entry = if compromised {
                TenantRootRecoveryRevocationEntryV1::compromised(
                    &signer,
                    "2026-09-08T00:00:00.000Z",
                )
                .unwrap()
            } else {
                TenantRootRecoveryRevocationEntryV1::retired(&signer).unwrap()
            };
            let snapshot = TenantRootRecoveryRevocationSnapshotV1::sign(
                1,
                "2026-09-08T00:00:00.000Z",
                "seams-recovery-root-2026",
                &[0xd1; 32],
                vec![entry],
            )
            .unwrap();
            let env = CloudflareEnvMapV1::new(vec![
                (
                    TENANT_ROOT_RECOVERY_TRUST_BUNDLE_JSON_ENV.to_owned(),
                    include_str!(
                    "../../router-ab-core/tests/fixtures/tenant-root-recovery/trust-bundle.json"
                )
                    .to_owned(),
                ),
                (
                    TENANT_ROOT_RECOVERY_TRUST_SNAPSHOT_JSON_ENV.to_owned(),
                    String::from_utf8(snapshot.canonical_json().unwrap()).unwrap(),
                ),
            ]);
            let result = verify_recovery_manifest_with_local_trust_v1(manifest_bytes, &env);
            if compromised {
                assert!(result.is_err());
            } else {
                let (_, trust) = result.expect("ordinary retirement preserves artifacts");
                assert!(matches!(
                    trust.level(),
                    TenantRootRecoveryTrustLevelV1::ValidAtTrustSnapshot { .. }
                ));
            }
        }
    }

    #[cfg(feature = "workers-rs")]
    #[test]
    fn initial_activation_requires_the_exact_persisted_both_roles_state() {
        let bundle = activation_bundle();
        let mut read = CloudflareTenantRootCreationJournalReadResponseV1 {
            journal_b64u: "journal".to_owned(),
            creation_capability_b64u: "capability".to_owned(),
            revision: 1,
            committed_roles: vec![
                CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
                CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
            ],
            installation_checkpoint:
                CloudflareTenantRootCreationInstallationCheckpointReadStateV1::BothRolesReady {
                    root_commitment_b64u: crate::encode_base64url_bytes_v1(
                        bundle.root_commitment(),
                    ),
                },
            cleanup_checkpointed: false,
        };
        live::require_persisted_initial_activation_state_v1(&read, &bundle)
            .expect("exact persisted installation state");

        read.installation_checkpoint =
            CloudflareTenantRootCreationInstallationCheckpointReadStateV1::BothRolesReady {
                root_commitment_b64u: crate::encode_base64url_bytes_v1(&[0x55; 32]),
            };
        assert_eq!(
            live::require_persisted_initial_activation_state_v1(&read, &bundle)
                .expect_err("foreign persisted root")
                .code(),
            RouterAbProtocolErrorCode::ForbiddenLocalBinding
        );

        read.installation_checkpoint =
            CloudflareTenantRootCreationInstallationCheckpointReadStateV1::BothRolesReady {
                root_commitment_b64u: crate::encode_base64url_bytes_v1(bundle.root_commitment()),
            };
        read.cleanup_checkpointed = true;
        assert_eq!(
            live::require_persisted_initial_activation_state_v1(&read, &bundle)
                .expect_err("cleaned creation")
                .code(),
            RouterAbProtocolErrorCode::ForbiddenLocalBinding
        );
    }

    #[test]
    fn restore_initial_activation_request_has_only_grant_and_manifest() {
        let request: CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1 =
            serde_json::from_str(
                r#"{"restore_refresh_grant_b64u":"grant","manifest_b64u":"manifest"}"#,
            )
            .expect("restore initial activation request");
        assert_eq!(request.restore_refresh_grant_b64u, "grant");
        assert_eq!(request.manifest_b64u, "manifest");
        assert!(serde_json::from_str::<
            CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1,
        >(r#"{"restore_refresh_grant_b64u":"grant","manifest_b64u":"manifest","authority_id_b64u":"caller-selected"}"#)
        .is_err());
        assert!(serde_json::from_str::<
            CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1,
        >(r#"{"restore_refresh_grant_b64u":"grant","manifest_b64u":"manifest","deriver_a_signed_managed_backup_b64u":"caller-selected"}"#)
        .is_err());
    }
}
