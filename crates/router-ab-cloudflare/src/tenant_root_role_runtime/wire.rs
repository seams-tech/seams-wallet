//! Public Deriver request and response wire types.

use super::*;

/// Router -> Deriver: execute this role's part of one creation ceremony.
///
/// Everything here is issuer-signed or public. The Deriver derives its own
/// role, authority id, clock and signer locally, so nothing in this request
/// can select them.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareDeriverTenantRootCreateRoleShareRequestV1 {
    /// Router -> initiating Deriver: run both role legs in one request.
    Initiator {
        /// Exact canonical package for this Deriver's role, issuer-signed.
        role_creation_command_package_b64u: String,
        /// Exact canonical package to hand to the peer Deriver.
        peer_role_creation_command_package_b64u: String,
    },
    /// Initiating Deriver -> peer Deriver: complete against the initiator's
    /// public commitment while keeping this Deriver's share request-local.
    PeerCompletion {
        /// Exact canonical package for the peer's role, issuer-signed.
        role_creation_command_package_b64u: String,
        /// The initiating Deriver's signed public commitment.
        initiator_signed_commitment_b64u: String,
    },
}

/// Deriver -> caller: the completed role's public result.
///
/// Public authenticated artifacts only. No scalar or unwrapped share material
/// is named here. A managed backup remains opaque inside its signed artifact.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareDeriverTenantRootCreateRoleShareResponseV1 {
    Completed {
        /// The role that initiated this two-role completion, from its own runtime.
        role: CloudflareTenantRootCreateRoleV1,
        /// Deriver A's signed public commitment.
        deriver_a_signed_commitment_b64u: String,
        /// Deriver B's signed public commitment.
        deriver_b_signed_commitment_b64u: String,
        /// Deriver A's signed installation evidence.
        deriver_a_signed_installation_evidence_b64u: String,
        /// Deriver B's signed installation evidence.
        deriver_b_signed_installation_evidence_b64u: String,
        /// Deriver A's opaque signed managed-backup artifact.
        deriver_a_signed_managed_backup_b64u: String,
        /// Deriver B's opaque signed managed-backup artifact.
        deriver_b_signed_managed_backup_b64u: String,
        /// Deriver A's authenticated terminal receipt.
        deriver_a_terminal_receipt_b64u: String,
        /// Deriver B's authenticated terminal receipt.
        deriver_b_terminal_receipt_b64u: String,
        /// Deriver A's exact signed online-provider canary receipt.
        ecdsa_provider_canary_receipt_b64u: String,
        /// Deriver B's exact signed online-provider canary receipt.
        ed25519_provider_canary_receipt_b64u: String,
    },
    PeerCompleted {
        /// The role this Deriver executed, from its own runtime.
        role: CloudflareTenantRootCreateRoleV1,
        /// This role's signed public commitment.
        signed_commitment_b64u: String,
        /// This role's signed installation evidence.
        signed_installation_evidence_b64u: String,
        /// This role's opaque signed managed-backup artifact.
        signed_managed_backup_b64u: String,
        /// Authenticated terminal receipt for this role's insertion.
        terminal_receipt_b64u: String,
        /// This role's exact signed online-provider canary receipt.
        provider_canary_receipt_b64u: String,
    },
}

/// Router -> Deriver: read back one pending initial share's stored activation
/// evidence.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootCreationEvidenceRequestV1 {
    pub identity_digest_b64u: String,
    pub custody_lineage_b64u: String,
}

/// Deriver -> Router: the signed managed backup and provider canary receipt
/// one role stored for its pending initial share.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootCreationEvidenceResponseV1 {
    pub role: CloudflareTenantRootCreateRoleV1,
    pub signed_managed_backup_b64u: String,
    pub provider_canary_receipt_b64u: String,
}

/// Control plane -> Deriver: remove one exact pending or retired role share.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootCleanupRequestV1 {
    /// Exact issuer-signed cleanup command. Its unverified target may only be
    /// used to locate the row; the Deriver verifies it against that row before deletion.
    pub cleanup_command_b64u: String,
}

/// Router -> Deriver: issue one role-local X25519 import key under the
/// control-plane's immutable, issuer-signed restore command.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootRestoreRoleImportKeyRequestV1 {
    /// The issuer key id selected from this Worker's configured trust anchor.
    pub issuer_key_id: String,
    /// Exact canonical control-plane command, encoded as unpadded base64url.
    pub role_import_command_b64u: String,
}

/// Deriver -> Router: public metadata for one role-local import key.
///
/// The private X25519 key and its encrypted IKM remain in the owning Deriver's
/// role-private D1 database. A replay returns the originally recorded response,
/// including its operation and command digests.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootRestoreRoleImportKeyResponseV1 {
    pub role: CloudflareTenantRootCreateRoleV1,
    pub import_key_id: String,
    pub import_public_key_b64u: String,
    pub generation: u64,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
    pub operation_digest_b64u: String,
    pub command_digest_b64u: String,
}

/// Router -> Deriver: accept one envelope under a previously issued,
/// role-local import key.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootRestoreRoleImportAcceptRequestV1 {
    pub issuer_key_id: String,
    pub role_import_command_b64u: String,
    pub import_envelope_b64u: String,
}

/// Deriver -> Router: public receipt for one staged imported role share.
///
/// The receipt identifies staged encrypted material. It does not claim that
/// the role is active in the operational provider.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootRestoreRoleImportAcceptResponseV1 {
    pub role: CloudflareTenantRootCreateRoleV1,
    pub import_key_id: String,
    pub envelope_digest_b64u: String,
    pub receipt_digest_b64u: String,
}

/// Router -> Deriver: read one exact active operational share binding.
///
/// The epoch is selected by the Router's current Durable Object state. The
/// Deriver still authenticates the row locally and opens the sealed share with
/// its own operational provider before returning the public binding.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootStatusRequestV1 {
    pub identity_digest_b64u: String,
    pub custody_lineage_b64u: String,
    pub active_epoch: u64,
}

/// Deriver -> Router: public result of one role-local operational readback.
///
/// No sealed ciphertext, plaintext share, wrapping key, or provider secret
/// crosses the Worker boundary.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootStatusResponseV1 {
    pub identity_digest_b64u: String,
    pub custody_lineage_b64u: String,
    pub active_epoch: u64,
    pub role: CloudflareTenantRootCreateRoleV1,
    pub share_commitment_b64u: String,
    pub activation_receipt_digest_b64u: String,
}

/// Deriver A to Deriver B, during retirement recovery of a claimed attempt:
/// fence this pair session at B unless B completed it. Deriver A cannot
/// complete without B's completion, so once B answers, A's delayed messages
/// can cause nothing more at B.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootPeerPairFenceRequestV1 {
    pub identity_digest_b64u: String,
    pub custody_lineage_b64u: String,
    /// The epoch the pair was admitted on at Deriver A.
    pub epoch: u64,
    pub session_hex: String,
}

/// Deriver B's answer: the pair completed at B, or B can no longer complete
/// it. Either is durable at B before it answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareDeriverTenantRootPeerPairFenceResponseV1 {
    Completed,
    Fenced,
}

/// Destruction evidence available after a retired-share cleanup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudflareTenantRootCryptographicErasureStatusV1 {
    CryptographicErasureUnverified,
}

/// Deriver -> Router: exact public result of one role-local cleanup.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareDeriverTenantRootCleanupResponseV1 {
    PendingDeleted {
        role: CloudflareTenantRootCreateRoleV1,
        cleanup_receipt_b64u: String,
    },
    RetiredDeleted {
        role: CloudflareTenantRootCreateRoleV1,
        cleanup_receipt_b64u: String,
        /// Both retired R2 object keys were observed absent after deletion.
        r2_deletion: CloudflareTenantRootManagedBackupDeletionReceiptV1,
        cryptographic_erasure: CloudflareTenantRootCryptographicErasureStatusV1,
        /// Admissions on the retired epoch here that recovery cancelled
        /// because they stayed unsettled `W` after admission. Nonzero is a
        /// warning.
        cancelled_admissions: u64,
    },
}

impl CloudflareDeriverTenantRootCleanupResponseV1 {
    pub const fn role(&self) -> CloudflareTenantRootCreateRoleV1 {
        match self {
            Self::PendingDeleted { role, .. } | Self::RetiredDeleted { role, .. } => *role,
        }
    }

    pub fn cleanup_receipt_b64u(&self) -> &str {
        match self {
            Self::PendingDeleted {
                cleanup_receipt_b64u,
                ..
            }
            | Self::RetiredDeleted {
                cleanup_receipt_b64u,
                ..
            } => cleanup_receipt_b64u,
        }
    }
}

/// Router -> Deriver: activate the exact pending role share named by the
/// control-plane receipt. All tenant, lineage, role, epoch and command scope
/// values are derived after signature verification.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootInitialActivationRequestV1 {
    pub activation_receipt_b64u: String,
}

/// Deriver -> Router: authenticated completion of one role-local activation.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootInitialActivationResponseV1 {
    pub role: CloudflareTenantRootCreateRoleV1,
    pub activation_terminal_receipt_b64u: String,
    pub restore_cleanup_receipt_b64u: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootPreactivationCleanupRequestV1 {
    pub cleanup_grant_b64u: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootPreactivationCleanupResponseV1 {
    pub role: CloudflareTenantRootCreateRoleV1,
    pub cleanup_receipt_digest_b64u: String,
}

/// Router -> Deriver: close one tenant-held restore session after activation.
/// The activation receipt is the complete scope; no caller-selected row key is accepted.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1 {
    pub activation_receipt_b64u: String,
}

/// Deriver -> Router: exact public receipt for one closed restore session.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootRestoreSessionCleanupResponseV1 {
    pub role: CloudflareTenantRootCreateRoleV1,
    pub activation_operation: String,
    pub activation_receipt_digest_b64u: String,
    pub cleanup_receipt_b64u: String,
    pub cleanup_receipt_digest_b64u: String,
    pub closed_at_ms: u64,
}

/// Control plane -> Deriver: activate one exact pending refresh epoch.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootRefreshActivationRequestV1 {
    pub activation_receipt_b64u: String,
}

/// Deriver -> Router: authenticated completion of one role-local refresh swap.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootRefreshActivationResponseV1 {
    pub role: CloudflareTenantRootCreateRoleV1,
    pub activation_terminal_receipt_b64u: String,
    pub retired_epoch: u64,
    pub retired_revision: i64,
    pub active_epoch: u64,
    pub active_revision: i64,
}

/// Router -> Deriver: execute one issuer-authorized role-local refresh.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootRefreshRequestV1 {
    pub refresh_context_b64u: String,
    pub role_refresh_command_b64u: String,
}

/// Router -> Deriver: execute a refresh whose current role share was restored.
///
/// The public state and restore capability re-authenticate the previous active
/// pair. The refresh command remains a separate issuer-signed authorization;
/// both are required before the restored pending row can be opened as a source.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1 {
    pub public_state_b64u: String,
    pub restore_capability_b64u: String,
    pub refresh_context_b64u: String,
    pub role_refresh_command_b64u: String,
}

/// Deriver -> Router: public artifacts from one durably installed refresh share.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootRefreshResponseV1 {
    pub role: CloudflareTenantRootCreateRoleV1,
    pub signed_installation_evidence_b64u: String,
    pub signed_managed_backup_b64u: String,
    pub provider_canary_receipt_b64u: String,
    pub terminal_receipt_b64u: String,
}

/// Deriver -> Router: exact public artifacts from one restore-refresh
/// promotion. The provider ciphertext remains inside the role's D1 store.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootRestoreRefreshPromotionResponseV1 {
    pub(crate) role: CloudflareTenantRootCreateRoleV1,
    pub(crate) restore_refresh_role_command_b64u: String,
    pub(crate) command_digest_b64u: String,
    pub(crate) signed_installation_evidence_b64u: String,
    pub(crate) installation_evidence_digest_b64u: String,
    pub(crate) provider_canary_receipt_b64u: String,
    pub(crate) provider_canary_receipt_digest_b64u: String,
    pub(crate) completed_at_ms: u64,
}

/// Control plane -> Deriver: stage one issuer-authorized managed restore.
///
/// The signed packages carry the identity, lineage, role, epoch, and active
/// receipt binding. No request field selects storage coordinates or lifecycle
/// state.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootManagedRestoreRequestV1 {
    pub public_state_b64u: String,
    pub restore_capability_b64u: String,
}

/// Result of one role-local managed restore staging attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudflareDeriverTenantRootManagedRestoreStatusV1 {
    StagedForForwardRefresh,
}

/// Deriver -> control plane: restored material is pending the mandatory
/// forward refresh and has not become active.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareDeriverTenantRootManagedRestoreResponseV1 {
    pub role: CloudflareTenantRootCreateRoleV1,
    pub status: CloudflareDeriverTenantRootManagedRestoreStatusV1,
    pub capability_digest_b64u: String,
    pub staging_terminal_receipt_b64u: String,
}

/// Role label on the Deriver creation wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudflareTenantRootCreateRoleV1 {
    DeriverA,
    DeriverB,
}

impl CloudflareTenantRootCreateRoleV1 {
    pub(crate) const fn from_protocol(role: TwoPartyDeriverRole) -> Self {
        match role {
            TwoPartyDeriverRole::DeriverA => Self::DeriverA,
            TwoPartyDeriverRole::DeriverB => Self::DeriverB,
        }
    }

    pub(crate) const fn to_protocol(self) -> TwoPartyDeriverRole {
        match self {
            Self::DeriverA => TwoPartyDeriverRole::DeriverA,
            Self::DeriverB => TwoPartyDeriverRole::DeriverB,
        }
    }
}
