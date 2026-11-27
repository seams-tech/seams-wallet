//! Request and response wire types of the creation journal, activation, refresh, restore refresh, managed restore, delivery and retirement.

use super::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationJournalRequestV1 {
    pub(crate) journal_b64u: String,
    pub(crate) creation_capability_b64u: String,
}

impl CloudflareTenantRootCreationJournalRequestV1 {
    #[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
    pub(super) fn into_record(self) -> CloudflareTenantRootCreationJournalRecordV1 {
        CloudflareTenantRootCreationJournalRecordV1 {
            journal_b64u: self.journal_b64u,
            creation_capability_b64u: self.creation_capability_b64u,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationJournalRecordV1 {
    pub(crate) journal_b64u: String,
    pub(crate) creation_capability_b64u: String,
}

#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(crate) struct ValidatedTenantRootCreationJournalV1 {
    pub(crate) record: CloudflareTenantRootCreationJournalRecordV1,
    pub(crate) journal: TenantRootCreationJournalV1,
    pub(crate) identity_digest: TenantRootIdentityDigestV1,
    pub(crate) custody_lineage: router_ab_core::TenantRootCustodyLineageId,
    pub(crate) ceremony_context: TenantRootCeremonyContextV1,
    pub(crate) revision: u64,
    pub(crate) journal_digest: TenantRootProtocolDigestV1,
    pub(crate) capability: VerifiedTenantRootCreationCapabilityV1,
}

impl ValidatedTenantRootCreationJournalV1 {
    pub(crate) fn response(
        &self,
        outcome: CloudflareTenantRootCreationJournalOutcomeV1,
    ) -> CloudflareTenantRootCreationJournalResponseV1 {
        CloudflareTenantRootCreationJournalResponseV1 {
            outcome,
            revision: self.revision,
            journal_digest_b64u: encode_base64url_bytes_v1(self.journal_digest.as_bytes()),
            capability_digest_b64u: encode_base64url_bytes_v1(self.capability.digest().as_bytes()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloudflareTenantRootCreationJournalOutcomeV1 {
    Committed,
    Replay,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootCreationJournalResponseV1 {
    pub outcome: CloudflareTenantRootCreationJournalOutcomeV1,
    pub revision: u64,
    pub journal_digest_b64u: String,
    pub(crate) capability_digest_b64u: String,
}

/// Asks the Durable Object for its persisted creation state.
///
/// Identity and lineage are carried so the object can fail closed if a caller
/// reached the wrong object: the stored journal must name exactly this pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootCreationJournalReadRequestV1 {
    pub identity_digest_b64u: String,
    pub custody_lineage_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationInitialActivationRequestV1 {
    pub(crate) activation_receipt_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationInitialActivationResponseV1 {
    pub(crate) activation_receipt_digest_b64u: String,
    pub(crate) lifecycle_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRestoreInitialActivationRequestV1 {
    pub(crate) activation_receipt_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRestoreInitialActivationResponseV1 {
    pub(crate) activation_receipt_digest_b64u: String,
    pub(crate) lifecycle_revision: u64,
    pub(crate) destruction_receipt_b64u: String,
    pub(crate) destruction_receipt_digest_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshActivationRequestV1 {
    pub(crate) activation_receipt_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshActivationResponseV1 {
    pub(crate) activation_receipt_digest_b64u: String,
    pub(crate) lifecycle_revision: u64,
}

/// The refresh gate is persisted in the same transaction as the authoritative
/// active state. Completion records live under one keyed storage entry per
/// operation so replay remains exact after later refreshes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshPendingV1 {
    pub(crate) operation_id: String,
    pub(crate) lifecycle_revision: u64,
    #[serde(default)]
    pub(crate) trigger: CloudflareTenantRootRefreshTriggerV1,
    /// When the operation's authorization expires. Past it, an operation that
    /// holds no live attempt stops blocking other operations.
    pub(crate) expires_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudflareTenantRootRefreshTriggerV1 {
    Manual,
    Scheduled,
}

impl Default for CloudflareTenantRootRefreshTriggerV1 {
    fn default() -> Self {
        Self::Manual
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshCompletionV1 {
    pub(crate) operation_id: String,
    pub(crate) completed_at_ms: u64,
    pub(crate) response: CloudflareTenantRootRefreshActivationResponseV1,
}

/// A managed restore whose forward refresh committed, named by its exact
/// issuer-signed public state and capability. It holds the outcome an exact
/// retry of the restore returns, after the restore's fence is retired and
/// later refreshes move the active state on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootManagedRestoreCompletionV1 {
    pub(crate) public_state_b64u: String,
    pub(crate) capability_b64u: String,
    pub(crate) response: CloudflareTenantRootRefreshActivationResponseV1,
}

/// An operation abandoned before its refresh committed: its attempt's
/// ceremony window closed first, or its authorization expired while it held
/// no live attempt. A retry of the operation is refused; a new operation can
/// refresh the root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshAbandonmentV1 {
    pub(crate) operation_id: String,
    pub(crate) abandoned_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootRefreshAdmissionOutcomeV1 {
    Admitted {
        lifecycle_revision: u64,
    },
    /// The previous swap's retired epoch is not yet erased at both roles.
    RetirementPending,
    Replayed {
        response: CloudflareTenantRootRefreshActivationResponseV1,
    },
    Abandoned {
        abandoned_at_ms: u64,
    },
    Throttled {
        retry_at_ms: u64,
    },
    InProgress,
    RevisionMoved,
    AuthorizationExpired,
    NotDue {
        next_run_at_ms: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootCreationActiveStateReadRequestV1 {
    Read {
        identity_digest_b64u: String,
        custody_lineage_b64u: String,
    },
    ReserveRefresh {
        identity_digest_b64u: String,
        custody_lineage_b64u: String,
        refresh_context_b64u: String,
        deriver_a_refresh_command_b64u: String,
        deriver_b_refresh_command_b64u: String,
        #[serde(default)]
        manual_operation_id: Option<String>,
    },
    ReserveRefreshAdmission {
        identity_digest_b64u: String,
        custody_lineage_b64u: String,
        operation_id: String,
        expected_lifecycle_revision: u64,
        expires_at_ms: u64,
        trigger: CloudflareTenantRootRefreshTriggerV1,
    },
    ReserveManagedRestore {
        identity_digest_b64u: String,
        custody_lineage_b64u: String,
        authorization: CloudflareTenantRootManagedRestoreAuthorizationRequestV1,
    },
    CheckpointManagedRestore {
        identity_digest_b64u: String,
        custody_lineage_b64u: String,
        checkpoint: CloudflareTenantRootManagedRestoreAuthorizationCheckpointV1,
    },
    RecordDelivery {
        identity_digest_b64u: String,
        custody_lineage_b64u: String,
        activation_receipt_digest_b64u: String,
        role: CloudflareTenantRootCreationInstallationRoleV1,
        /// A refresh swap's acknowledgement; none for an initial activation.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        swap: Option<CloudflareTenantRootSwapAcknowledgementV1>,
    },
    /// One role erased a retired epoch the committed swap's record holds.
    RecordRetirement {
        identity_digest_b64u: String,
        custody_lineage_b64u: String,
        activation_receipt_digest_b64u: String,
        role: CloudflareTenantRootCreationInstallationRoleV1,
        retired_epoch: u64,
        erasure: CloudflareTenantRootRetiredErasureV1,
    },
    ReadManagedRestoreCompletion {
        identity_digest_b64u: String,
        custody_lineage_b64u: String,
        public_state_b64u: String,
        capability_b64u: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationActiveStateReadResponseV1 {
    pub(crate) activation_receipt_b64u: String,
    pub(crate) activation_receipt_digest_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) lifecycle_revision: u64,
    pub(crate) fence: CloudflareTenantRootRefreshFenceV1,
    pub(crate) managed_restore_fence: CloudflareTenantRootManagedRestoreFenceV1,
    #[serde(default)]
    pub(crate) job: Option<CloudflareTenantRootRefreshJobReadV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) refresh_admission: Option<CloudflareTenantRootRefreshAdmissionOutcomeV1>,
    pub(crate) last_manual_refresh_completed_at_ms: Option<u64>,
    pub(crate) last_refresh_completed_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) delivery: Option<CloudflareTenantRootDeliveryV1>,
    /// The refresh operation admitted and not yet completed or abandoned.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) refresh_pending: Option<CloudflareTenantRootRefreshPendingV1>,
    /// The outcome of the completed managed restore a completion read names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) managed_restore_completion: Option<CloudflareTenantRootRefreshActivationResponseV1>,
}

/// Readback phases supported by the durable Router checkpoints.
///
/// The ceremony issue time is the signed context `issued_at_ms`; it is the
/// first durable Router start time available here and does not describe D1
/// authorization time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootRefreshJobReadV1 {
    Preparing {
        job_id: String,
        requested_at_ms: u64,
    },
    Installing {
        job_id: String,
        requested_at_ms: u64,
    },
    Verifying {
        job_id: String,
        requested_at_ms: u64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CloudflareTenantRootRefreshJobPhaseV1 {
    Preparing,
    Installing,
    Verifying,
}

/// Public installation progress from one fully validated checkpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootCreationInstallationCheckpointReadStateV1 {
    None,
    OneRoleReady {
        role: CloudflareTenantRootCreationInstallationRoleV1,
        signed_evidence_b64u: String,
    },
    BothRolesReady {
        deriver_a_signed_evidence_b64u: String,
        deriver_b_signed_evidence_b64u: String,
        root_commitment_b64u: String,
    },
}

/// Persisted creation state, public evidence only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootCreationJournalReadResponseV1 {
    /// Exact canonical Started journal bytes as persisted.
    pub(crate) journal_b64u: String,
    /// Exact canonical issuer capability bytes as persisted.
    pub(crate) creation_capability_b64u: String,
    /// Control-plane revision the Started journal authenticates.
    pub revision: u64,
    /// Roles whose signed public commitment has already reached this object.
    pub(crate) committed_roles: Vec<CloudflareTenantRootCreationInstallationRoleV1>,
    /// Validated public installation checkpoint, when one exists.
    pub(crate) installation_checkpoint:
        CloudflareTenantRootCreationInstallationCheckpointReadStateV1,
    /// The abandonment fence, once the creation is abandoned.
    pub abandonment: Option<CloudflareTenantRootCreationAbandonmentReadV1>,
}

/// Public projection of an abandoned creation: the roles installed when it was
/// fenced, and those whose cleanup the Router has checkpointed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationAbandonmentReadV1 {
    pub(crate) abandoned_at_ms: u64,
    pub installed_roles: Vec<CloudflareTenantRootCreationInstallationRoleV1>,
    pub cleaned_roles: Vec<CloudflareTenantRootCreationInstallationRoleV1>,
}

/// The fence that abandons an uncommitted creation. Once it is written no
/// activation, commitment or installation is accepted for the ceremony, and
/// the roles it names are cleaned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CloudflareTenantRootCreationAbandonmentV1 {
    pub(super) journal_digest_b64u: String,
    pub(super) identity_digest_b64u: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) ceremony_context_digest_b64u: String,
    pub(super) installed_roles: Vec<CloudflareTenantRootCreationInstallationRoleV1>,
    pub(super) abandoned_at_ms: u64,
}

/// What the Router's creation state recorded when it abandoned a creation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationAbandonmentResponseV1 {
    pub installed_roles: Vec<CloudflareTenantRootCreationInstallationRoleV1>,
    pub(crate) abandoned_at_ms: u64,
    pub replayed: bool,
}

/// The Router coordinator's view of one creation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootCreationProgressV1 {
    /// No Started journal exists for this identity and lineage.
    NotStarted,
    /// The persisted creation state, the Router's committed activation receipt
    /// once one exists, and whether the ceremony window is still open by the
    /// creation state's clock.
    Started {
        state: CloudflareTenantRootCreationJournalReadResponseV1,
        committed_activation_receipt_b64u: Option<String>,
        ceremony_open: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationCommitmentRequestV1 {
    pub(crate) role_creation_command_b64u: String,
    pub(crate) signed_commitment_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationInstallationRequestV1 {
    pub(crate) role_creation_command_b64u: String,
    pub(crate) signed_evidence_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationCleanupRequestV1 {
    pub(crate) cleanup_command_b64u: String,
    pub(crate) cleanup_receipt_b64u: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloudflareTenantRootCreationCleanupOutcomeV1 {
    Committed,
    Replay,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationCleanupResponseV1 {
    pub(crate) outcome: CloudflareTenantRootCreationCleanupOutcomeV1,
    pub(crate) role: CloudflareTenantRootCreationInstallationRoleV1,
    pub(crate) cleanup_receipt_digest_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootCreationCommitmentResponseOutcomeV1 {
    WaitingForPeer {
        role: CloudflareTenantRootCreationInstallationRoleV1,
        signed_commitment_b64u: String,
    },
    BothRolesCommitted {
        deriver_a_signed_commitment_b64u: String,
        deriver_b_signed_commitment_b64u: String,
        pair_digest_b64u: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationCommitmentResponseV1 {
    pub(crate) outcome: CloudflareTenantRootCreationCommitmentResponseOutcomeV1,
    pub(crate) command_digest_b64u: String,
    pub(crate) journal_digest_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) ceremony_context_digest_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootCreationInstallationResponseOutcomeV1 {
    WaitingForPeer {
        role: CloudflareTenantRootCreationInstallationRoleV1,
    },
    BothRolesReady {
        root_commitment_b64u: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationInstallationResponseV1 {
    pub(crate) outcome: CloudflareTenantRootCreationInstallationResponseOutcomeV1,
    pub(crate) command_digest_b64u: String,
    pub(crate) journal_digest_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) ceremony_context_digest_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshCommitmentRequestV1 {
    pub(crate) role_refresh_command_b64u: String,
    pub(crate) signed_commitment_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshInstallationRequestV1 {
    pub(crate) role_refresh_command_b64u: String,
    pub(crate) signed_evidence_b64u: String,
    pub(crate) terminal_receipt_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshContributionRequestV1 {
    pub(crate) role_refresh_command_b64u: String,
    pub(crate) signed_contribution_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootRefreshCommitmentResponseOutcomeV1 {
    WaitingForPeer {
        role: CloudflareTenantRootCreationInstallationRoleV1,
        signed_commitment_b64u: String,
    },
    BothRolesCommitted {
        deriver_a_signed_commitment_b64u: String,
        deriver_b_signed_commitment_b64u: String,
        pair_digest_b64u: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshCommitmentResponseV1 {
    pub(crate) outcome: CloudflareTenantRootRefreshCommitmentResponseOutcomeV1,
    pub(crate) command_digest_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) authority_id_b64u: String,
    pub(crate) ceremony_context_digest_b64u: String,
    pub(crate) current_epoch: u64,
    pub(crate) next_epoch: u64,
    pub(crate) expected_control_plane_revision: u64,
    pub(crate) active_root_commitment_b64u: String,
    pub(crate) active_activation_receipt_digest_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootRefreshInstallationResponseOutcomeV1 {
    WaitingForPeer {
        role: CloudflareTenantRootCreationInstallationRoleV1,
    },
    BothRolesReady {
        root_commitment_b64u: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshInstallationResponseV1 {
    pub(crate) outcome: CloudflareTenantRootRefreshInstallationResponseOutcomeV1,
    pub(crate) command_digest_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) authority_id_b64u: String,
    pub(crate) ceremony_context_digest_b64u: String,
    pub(crate) current_epoch: u64,
    pub(crate) next_epoch: u64,
    pub(crate) expected_control_plane_revision: u64,
    pub(crate) active_root_commitment_b64u: String,
    pub(crate) active_activation_receipt_digest_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootRefreshContributionResponseOutcomeV1 {
    WaitingForPeer {
        role: CloudflareTenantRootCreationInstallationRoleV1,
    },
    BothRolesContributed {
        deriver_a_signed_contribution_b64u: String,
        deriver_b_signed_contribution_b64u: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshContributionResponseV1 {
    pub(crate) outcome: CloudflareTenantRootRefreshContributionResponseOutcomeV1,
    pub(crate) command_digest_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) authority_id_b64u: String,
    pub(crate) ceremony_context_digest_b64u: String,
    pub(crate) current_epoch: u64,
    pub(crate) next_epoch: u64,
    pub(crate) expected_control_plane_revision: u64,
    pub(crate) active_root_commitment_b64u: String,
    pub(crate) active_activation_receipt_digest_b64u: String,
}

/// The immutable public scope admitted for one restore-refresh operation.
/// The signed grant bytes and this derived scope are retained together so a
/// restarted Router cannot rebind a checkpoint to a different authorization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRestoreRefreshCheckpointScopeV1 {
    pub(crate) grant_digest_b64u: String,
    pub(crate) operation_digest_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) destination_fingerprint_b64u: String,
    pub(crate) restore_session_id_b64u: String,
    pub(crate) manifest_digest_b64u: String,
    pub(crate) deriver_a_acceptance_receipt_digest_b64u: String,
    pub(crate) deriver_b_acceptance_receipt_digest_b64u: String,
    pub(crate) issued_at_ms: u64,
    pub(crate) expires_at_ms: u64,
}

/// Exact command response returned by the deterministic control-plane issuer.
/// It is written before either role receives a Deriver request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRestoreRefreshCommandsV1 {
    pub(crate) refresh_context_b64u: String,
    pub(crate) deriver_a_refresh_command_b64u: String,
    pub(crate) deriver_b_refresh_command_b64u: String,
    pub(crate) issuer_key_id: String,
}

/// Exact public artifacts returned after one role promotes its refreshed share
/// into the epoch-one operational provider. The command is retained because
/// the control plane reconstructs tenant-held provenance from its verified
/// scope rather than from duplicated projections.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRestoreRefreshRolePromotionV1 {
    pub(crate) role: CloudflareTenantRootCreationInstallationRoleV1,
    pub(crate) restore_refresh_role_command_b64u: String,
    pub(crate) command_digest_b64u: String,
    pub(crate) signed_installation_evidence_b64u: String,
    pub(crate) installation_evidence_digest_b64u: String,
    pub(crate) provider_canary_receipt_b64u: String,
    pub(crate) provider_canary_receipt_digest_b64u: String,
    pub(crate) completed_at_ms: u64,
}

/// Router-owned restore-refresh progress. Every later branch carries the
/// exact bytes needed to retry the next phase without re-deriving anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootRestoreRefreshCheckpointStateV1 {
    Admitted,
    CommandsPersisted {
        commands: CloudflareTenantRootRestoreRefreshCommandsV1,
    },
    Prepared {
        commands: CloudflareTenantRootRestoreRefreshCommandsV1,
        deriver_a_commitment_b64u: String,
        deriver_b_commitment_b64u: String,
    },
    Contributed {
        commands: CloudflareTenantRootRestoreRefreshCommandsV1,
        deriver_a_commitment_b64u: String,
        deriver_b_commitment_b64u: String,
        deriver_a_contribution_b64u: String,
        deriver_b_contribution_b64u: String,
    },
    Completed {
        commands: CloudflareTenantRootRestoreRefreshCommandsV1,
        deriver_a_commitment_b64u: String,
        deriver_b_commitment_b64u: String,
        deriver_a_contribution_b64u: String,
        deriver_b_contribution_b64u: String,
        deriver_a_evidence_b64u: String,
        deriver_b_evidence_b64u: String,
        deriver_a_evidence_digest_b64u: String,
        deriver_b_evidence_digest_b64u: String,
    },
    Promoted {
        commands: CloudflareTenantRootRestoreRefreshCommandsV1,
        deriver_a_commitment_b64u: String,
        deriver_b_commitment_b64u: String,
        deriver_a_contribution_b64u: String,
        deriver_b_contribution_b64u: String,
        deriver_a_evidence_b64u: String,
        deriver_b_evidence_b64u: String,
        deriver_a_evidence_digest_b64u: String,
        deriver_b_evidence_digest_b64u: String,
        deriver_a_promotion: CloudflareTenantRootRestoreRefreshRolePromotionV1,
        deriver_b_promotion: CloudflareTenantRootRestoreRefreshRolePromotionV1,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRestoreRefreshCheckpointV1 {
    pub(crate) grant_b64u: String,
    pub(crate) scope: CloudflareTenantRootRestoreRefreshCheckpointScopeV1,
    pub(crate) expected_initial_activation_revision: u64,
    pub(crate) result_initial_activation_revision: u64,
    pub(crate) state: CloudflareTenantRootRestoreRefreshCheckpointStateV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootRestoreRefreshCheckpointRequestV1 {
    Admit {
        restore_refresh_grant_b64u: String,
        manifest_b64u: String,
    },
    PersistCommands {
        restore_refresh_grant_b64u: String,
        manifest_b64u: String,
        commands: CloudflareTenantRootRestoreRefreshCommandsV1,
    },
    CommitPrepared {
        restore_refresh_grant_b64u: String,
        deriver_a_commitment_b64u: String,
        deriver_b_commitment_b64u: String,
    },
    CommitContributed {
        restore_refresh_grant_b64u: String,
        deriver_a_commitment_b64u: String,
        deriver_b_commitment_b64u: String,
        deriver_a_contribution_b64u: String,
        deriver_b_contribution_b64u: String,
    },
    CommitCompleted {
        restore_refresh_grant_b64u: String,
        deriver_a_commitment_b64u: String,
        deriver_b_commitment_b64u: String,
        deriver_a_contribution_b64u: String,
        deriver_b_contribution_b64u: String,
        deriver_a_evidence_b64u: String,
        deriver_b_evidence_b64u: String,
        deriver_a_evidence_digest_b64u: String,
        deriver_b_evidence_digest_b64u: String,
    },
    CommitPromoted {
        restore_refresh_grant_b64u: String,
        deriver_a_promotion: CloudflareTenantRootRestoreRefreshRolePromotionV1,
        deriver_b_promotion: CloudflareTenantRootRestoreRefreshRolePromotionV1,
    },
    ReadCompleted {
        restore_refresh_grant_b64u: String,
        manifest_b64u: String,
    },
    ReadPromoted {
        restore_refresh_grant_b64u: String,
        manifest_b64u: String,
    },
}

/// Explicit refusal for an admitted operation that expired before the Router
/// durably received the command response. No Deriver request is possible from
/// this state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloudflareTenantRootRestoreRefreshDeriverDispatchV1 {
    NoneBeforeCommands,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootRestoreRefreshCheckpointResponseV1 {
    Checkpoint {
        checkpoint: CloudflareTenantRootRestoreRefreshCheckpointV1,
    },
    AuthorizationExpiredBeforeCommands {
        grant_digest_b64u: String,
        operation_digest_b64u: String,
        deriver_dispatch: CloudflareTenantRootRestoreRefreshDeriverDispatchV1,
    },
    CompletedRead {
        authority_id_b64u: String,
        expected_initial_activation_revision: u64,
        result_initial_activation_revision: u64,
    },
    PromotedRead {
        authority_id_b64u: String,
        expected_initial_activation_revision: u64,
        result_initial_activation_revision: u64,
        deriver_a_promotion: CloudflareTenantRootRestoreRefreshRolePromotionV1,
        deriver_b_promotion: CloudflareTenantRootRestoreRefreshRolePromotionV1,
    },
    AuthorizationExpiredBeforePromotion {
        grant_digest_b64u: String,
        operation_digest_b64u: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1 {
    Commit {
        checkpoint: CloudflareTenantRootRestoreRefreshCheckpointV1,
    },
    Replay {
        checkpoint: CloudflareTenantRootRestoreRefreshCheckpointV1,
    },
    AuthorizationExpiredBeforeCommands {
        grant_digest_b64u: String,
        operation_digest_b64u: String,
    },
}

/// Public operation coordinates retained beside the authoritative active state.
/// The session id is the attempt id; nonce and command digest remain part of the
/// fence so a restarted request cannot silently resume another ceremony.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshAttemptV1 {
    #[serde(default)]
    pub(crate) manual_operation_id: Option<String>,
    pub(crate) attempt_id_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) command_digest_b64u: String,
    pub(crate) deriver_b_command_digest_b64u: String,
    pub(crate) ceremony_context_digest_b64u: String,
    pub(crate) refresh_context_b64u: String,
    pub(crate) deriver_a_refresh_command_b64u: String,
    pub(crate) deriver_b_refresh_command_b64u: String,
    pub(crate) session_id_b64u: String,
    pub(crate) nonce_b64u: String,
    pub(crate) current_epoch: u64,
    pub(crate) next_epoch: u64,
    pub(crate) expected_control_plane_revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloudflareTenantRootRefreshTerminalOutcomeV1 {
    Completed,
}

/// Forward-only public refresh fence. The activation path owns terminal
/// transitions; the terminal state retains the exact activation response for
/// a lost-response retry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootRefreshFenceV1 {
    Open,
    Reserved {
        attempt: CloudflareTenantRootRefreshAttemptV1,
    },
    Executed {
        attempt: CloudflareTenantRootRefreshAttemptV1,
    },
    Terminal {
        attempt: CloudflareTenantRootRefreshAttemptV1,
        outcome: CloudflareTenantRootRefreshTerminalOutcomeV1,
        response: CloudflareTenantRootRefreshActivationResponseV1,
    },
    /// An attempt whose ceremony window closed before the Router committed
    /// it. Its commit, rendezvous and installation checkpoints are refused
    /// from here on, so nothing it prepared can activate. The next attempt
    /// replaces it; each Deriver's next refresh supersedes what it left.
    Abandoned {
        attempt: CloudflareTenantRootRefreshAttemptV1,
        abandoned_at_ms: u64,
    },
}

/// Operator-supplied inputs for one managed role-restore authorization.
///
/// Tenant identity, custody lineage, active epoch, and activation receipt are
/// deliberately absent. The Durable Object derives those values from its
/// validated active state before constructing the challenge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootManagedRestoreAuthorizationRequestV1 {
    pub(crate) incident_id: String,
    pub(crate) outage_observation_digest_b64u: String,
    pub(crate) issued_at_ms: u64,
    pub(crate) expires_at_ms: u64,
    pub(crate) nonce_b64u: String,
    pub(crate) unavailable_role: TenantRootManagedRestoreRoleV1,
}

/// Exact challenge bound to one active tenant-root state and one operator
/// authorization request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootManagedRestoreAuthorizationChallengeV1 {
    pub(crate) identity_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) active_epoch: u64,
    pub(crate) active_lifecycle_revision: u64,
    pub(crate) activation_receipt_b64u: String,
    pub(crate) activation_receipt_digest_b64u: String,
    pub(crate) incident_id: String,
    pub(crate) outage_observation_digest_b64u: String,
    pub(crate) issued_at_ms: u64,
    pub(crate) expires_at_ms: u64,
    pub(crate) nonce_b64u: String,
    pub(crate) unavailable_role: TenantRootManagedRestoreRoleV1,
    pub(crate) challenge_digest_b64u: String,
}

/// Exact attempt identity derived from one authorization challenge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootManagedRestoreAuthorizationAttemptV1 {
    pub(crate) attempt_id_b64u: String,
    pub(crate) challenge_digest_b64u: String,
}

/// Public artifacts retained after an authorization is terminalized. The
/// signed bytes remain opaque here; cryptographic verification belongs to the
/// control-plane and role boundaries that consume them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootManagedRestoreAuthorizationCheckpointV1 {
    pub(crate) challenge: CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
    pub(crate) attempt: CloudflareTenantRootManagedRestoreAuthorizationAttemptV1,
    pub(crate) public_state_b64u: String,
    pub(crate) capability_b64u: String,
    pub(crate) incident_authorization_b64u: String,
}

/// Forward-only one-use managed-restore authorization fence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootManagedRestoreFenceV1 {
    Open,
    Reserved {
        challenge: CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
        attempt: CloudflareTenantRootManagedRestoreAuthorizationAttemptV1,
    },
    Terminal {
        challenge: CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
        attempt: CloudflareTenantRootManagedRestoreAuthorizationAttemptV1,
        public_state_b64u: String,
        capability_b64u: String,
        incident_authorization_b64u: String,
    },
    /// A reservation whose challenge window closed before its authorization
    /// was checkpointed. It holds back neither refresh nor a new reservation,
    /// and a late checkpoint for it is refused.
    Expired {
        challenge: CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
        attempt: CloudflareTenantRootManagedRestoreAuthorizationAttemptV1,
        expired_at_ms: u64,
    },
    /// An authorized restore that a completed refresh overtook before the
    /// restore's own forward refresh ran. That refresh needed both roles, and
    /// the restore's capability names a state that no longer exists. It holds
    /// back neither refresh nor a new reservation, and its late steps are
    /// refused.
    Superseded {
        challenge: CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
        attempt: CloudflareTenantRootManagedRestoreAuthorizationAttemptV1,
        /// The lifecycle revision of the refresh that overtook it.
        superseded_at_revision: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootManagedRestoreFenceEvaluationV1 {
    Commit {
        fence: CloudflareTenantRootManagedRestoreFenceV1,
    },
    Replay {
        fence: CloudflareTenantRootManagedRestoreFenceV1,
    },
}

/// Whether one Deriver has activated the Router's committed receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloudflareTenantRootRoleDeliveryV1 {
    Pending,
    Delivered,
}

/// Delivery of one committed activation receipt, initial or refresh, to each
/// Deriver. The commit records both roles pending; each Deriver's
/// acknowledged activation of that exact receipt marks it delivered. Work is
/// admitted on the committed epoch only once both roles are delivered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootDeliveryV1 {
    pub activation_receipt_digest_b64u: String,
    pub deriver_a: CloudflareTenantRootRoleDeliveryV1,
    pub deriver_b: CloudflareTenantRootRoleDeliveryV1,
    /// A refresh swap's retirement of the epoch it replaced; none for an
    /// initial activation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retirement: Option<CloudflareTenantRootSwapRetirementV1>,
    /// Earlier swaps' retirements this swap committed over before both roles
    /// had erased their epochs, oldest first. Only a managed restore commits
    /// over one: it does not wait, since the role it restores may be the one
    /// that cannot erase. Each is erased like the swap's own, and the next
    /// swap carries it on until both roles have.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) carried_retirements: Vec<CloudflareTenantRootCarriedRetirementV1>,
}

/// An earlier swap's retirement that a later swap committed over: that
/// swap's committed receipt, and the retirement recorded with its delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCarriedRetirementV1 {
    pub activation_receipt_digest_b64u: String,
    pub retirement: CloudflareTenantRootSwapRetirementV1,
}

/// The epoch a committed refresh swap replaced, and its retirement at each
/// role. Each role's part is recorded with that role's delivery, from its
/// swap acknowledgement, so a later pass needs nothing from the retired row,
/// which may be gone. The next refresh is admitted only once both roles have
/// erased the epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootSwapRetirementV1 {
    pub retired_epoch: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deriver_a: Option<CloudflareTenantRootRoleRetirementV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deriver_b: Option<CloudflareTenantRootRoleRetirementV1>,
}

impl CloudflareTenantRootSwapRetirementV1 {
    /// One role's part, once its swap is acknowledged.
    pub fn role(&self, role: TwoPartyDeriverRole) -> Option<&CloudflareTenantRootRoleRetirementV1> {
        match role {
            TwoPartyDeriverRole::DeriverA => self.deriver_a.as_ref(),
            TwoPartyDeriverRole::DeriverB => self.deriver_b.as_ref(),
        }
    }

    /// Whether both roles have erased the replaced epoch.
    pub fn erased(&self) -> bool {
        [&self.deriver_a, &self.deriver_b]
            .iter()
            .all(|role| role.as_ref().is_some_and(|role| role.erasure.is_some()))
    }
}

/// One role's retirement of a replaced epoch: the row revisions its swap
/// acknowledged, when the Router recorded that swap, and once the epoch is
/// erased there, that erasure. Its cleanup command names the retired row's
/// revision, and binds to the role's current active row: the one the latest
/// swap acknowledged, which for a carried retirement is a later swap's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRoleRetirementV1 {
    pub retired_revision: i64,
    pub active_revision: i64,
    pub(crate) swapped_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub erasure: Option<CloudflareTenantRootRetiredErasureV1>,
}

/// A role's erasure of a retired epoch: its signed cleanup receipt, and the
/// admissions recovery cancelled on the epoch there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRetiredErasureV1 {
    pub(crate) cleanup_receipt_b64u: String,
    pub cancelled_admissions: u64,
}

/// What a Deriver's acknowledged refresh swap reports: the epoch it retired
/// and the one it activated, with each row's revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootSwapAcknowledgementV1 {
    pub retired_epoch: u64,
    pub retired_revision: i64,
    pub active_epoch: u64,
    pub active_revision: i64,
}

impl CloudflareTenantRootDeliveryV1 {
    pub(super) fn pending(activation_receipt_digest_b64u: String) -> Self {
        Self {
            activation_receipt_digest_b64u,
            deriver_a: CloudflareTenantRootRoleDeliveryV1::Pending,
            deriver_b: CloudflareTenantRootRoleDeliveryV1::Pending,
            retirement: None,
            carried_retirements: Vec::new(),
        }
    }

    /// A refresh swap's delivery, which also retires the epoch it replaced.
    /// Every retirement the replaced delivery still held unerased is carried
    /// on with it.
    pub(super) fn pending_swap(
        activation_receipt_digest_b64u: String,
        retired_epoch: u64,
        replaced: Option<&Self>,
    ) -> Self {
        let carried_retirements = replaced
            .map(|replaced| {
                let own = replaced.retirement.as_ref().map(|retirement| {
                    CloudflareTenantRootCarriedRetirementV1 {
                        activation_receipt_digest_b64u: replaced
                            .activation_receipt_digest_b64u
                            .clone(),
                        retirement: retirement.clone(),
                    }
                });
                replaced
                    .carried_retirements
                    .iter()
                    .cloned()
                    .chain(own)
                    .filter(|carried| !carried.retirement.erased())
                    .collect()
            })
            .unwrap_or_default();
        Self {
            retirement: Some(CloudflareTenantRootSwapRetirementV1 {
                retired_epoch,
                deriver_a: None,
                deriver_b: None,
            }),
            carried_retirements,
            ..Self::pending(activation_receipt_digest_b64u)
        }
    }

    /// Every retirement this record holds: the swap's own, then each one it
    /// carries.
    pub(super) fn retirements(&self) -> impl Iterator<Item = &CloudflareTenantRootSwapRetirementV1> {
        self.retirement.iter().chain(
            self.carried_retirements
                .iter()
                .map(|carried| &carried.retirement),
        )
    }

    /// This record's retirement of `retired_epoch`: the swap's own, or one it
    /// carries.
    pub(crate) fn retirement_of(
        &self,
        retired_epoch: u64,
    ) -> Option<&CloudflareTenantRootSwapRetirementV1> {
        self.retirements()
            .find(|retirement| retirement.retired_epoch == retired_epoch)
    }

    /// Whether this record holds a retirement of `retired_epoch`.
    pub(crate) fn holds_retirement_of(&self, retired_epoch: u64) -> bool {
        self.retirement_of(retired_epoch).is_some()
    }

    /// The epochs this record retires that a role has not yet erased.
    pub(crate) fn unerased_retired_epochs(&self) -> Vec<u64> {
        self.retirements()
            .filter(|retirement| !retirement.erased())
            .map(|retirement| retirement.retired_epoch)
            .collect()
    }

    /// Whether both roles have erased every epoch this record retires.
    pub(crate) fn retirements_erased(&self) -> bool {
        self.retirements()
            .all(CloudflareTenantRootSwapRetirementV1::erased)
    }

    pub(super) fn retirement_of_mut(
        &mut self,
        retired_epoch: u64,
    ) -> Option<&mut CloudflareTenantRootSwapRetirementV1> {
        self.retirement
            .iter_mut()
            .chain(
                self.carried_retirements
                    .iter_mut()
                    .map(|carried| &mut carried.retirement),
            )
            .find(|retirement| retirement.retired_epoch == retired_epoch)
    }

    /// The roles still waiting for the committed receipt.
    pub(crate) fn pending_roles(&self) -> Vec<TwoPartyDeriverRole> {
        let mut roles = Vec::with_capacity(2);
        if self.deriver_a == CloudflareTenantRootRoleDeliveryV1::Pending {
            roles.push(TwoPartyDeriverRole::DeriverA);
        }
        if self.deriver_b == CloudflareTenantRootRoleDeliveryV1::Pending {
            roles.push(TwoPartyDeriverRole::DeriverB);
        }
        roles
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshActiveStateRecordV1 {
    pub(crate) activation_receipt_b64u: String,
    pub(crate) activation_receipt_digest_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) active_epoch: u64,
    pub(crate) deriver_a_commitment_b64u: String,
    pub(crate) deriver_b_commitment_b64u: String,
    pub(crate) active_root_commitment_b64u: String,
    pub(crate) lifecycle_revision: u64,
    pub(crate) fence: CloudflareTenantRootRefreshFenceV1,
    pub(crate) managed_restore_fence: CloudflareTenantRootManagedRestoreFenceV1,
    /// Missing fields in persisted records predate manual refresh admission.
    #[serde(default)]
    pub(crate) manual_refresh_pending: Option<CloudflareTenantRootRefreshPendingV1>,
    #[serde(default)]
    pub(crate) last_manual_refresh_completed_at_ms: Option<u64>,
    #[serde(default)]
    pub(crate) last_refresh_completed_at_ms: Option<u64>,
    /// Delivery of the committed receipt to each Deriver.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) delivery: Option<CloudflareTenantRootDeliveryV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CloudflareTenantRootRefreshCheckpointScopeV1 {
    pub(super) identity_digest_b64u: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) authority_id_b64u: String,
    pub(super) ceremony_context_digest_b64u: String,
    pub(super) current_epoch: u64,
    pub(super) next_epoch: u64,
    pub(super) expected_control_plane_revision: u64,
    pub(super) active_root_commitment_b64u: String,
    pub(super) active_activation_receipt_digest_b64u: String,
    pub(super) deriver_a_commitment_b64u: String,
    pub(super) deriver_b_commitment_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum CloudflareTenantRootRefreshInstallationCheckpointStateV1 {
    OneRoleReady {
        role: CloudflareTenantRootCreationInstallationRoleV1,
        command_digest_b64u: String,
        signed_evidence_b64u: String,
    },
    BothRolesReady {
        deriver_a_command_digest_b64u: String,
        deriver_b_command_digest_b64u: String,
        deriver_a_signed_evidence_b64u: String,
        deriver_b_signed_evidence_b64u: String,
        root_commitment_b64u: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CloudflareTenantRootRefreshInstallationCheckpointRecordV1 {
    pub(super) scope: CloudflareTenantRootRefreshCheckpointScopeV1,
    pub(super) state: CloudflareTenantRootRefreshInstallationCheckpointStateV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum CloudflareTenantRootRefreshContributionRendezvousStateV1 {
    OneRoleContributed {
        role: CloudflareTenantRootCreationInstallationRoleV1,
        command_digest_b64u: String,
        signed_contribution_b64u: String,
    },
    BothRolesContributed {
        deriver_a_command_digest_b64u: String,
        deriver_b_command_digest_b64u: String,
        deriver_a_signed_contribution_b64u: String,
        deriver_b_signed_contribution_b64u: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CloudflareTenantRootRefreshContributionRendezvousRecordV1 {
    pub(super) scope: CloudflareTenantRootRefreshCheckpointScopeV1,
    pub(super) state: CloudflareTenantRootRefreshContributionRendezvousStateV1,
}
