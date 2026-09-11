//! Exhaustive console-facing lifecycle state for a tenant derivation root.
//!
//! The dashboard and CLI mirror this state rather than inventing local
//! booleans, so every branch here carries the exact evidence that branch
//! requires. Two distinctions the product depends on are structural rather
//! than advisory:
//!
//! - **Activated is not retired.** A rotation that activated but has not proved
//!   both retirements is its own branch, so the page cannot claim compromise
//!   healing from an activation alone.
//! - **Failed is not cleaned.** A failure with complete cleanup receipts and a
//!   failure with outstanding material are different branches, so incomplete
//!   cleanup can never be reported as a tidy failure.

use core::fmt;

use threshold_prf::TwoPartyDeriverRole;

use super::tenant_root::require_tenant_root_identifier;
use super::tenant_root_recovery_artifacts::{malformed, validate_rfc3339_millis};
use super::tenant_root_time::epoch_millis;
use super::{
    RouterAbDerivationResult, TenantRootCustodyLineageId, TenantRootOperationKindV1,
    TenantRootRecoveryRecipientFingerprintV1, TenantRootRecoverySetId, TenantRootShareEpoch,
};

/// One redacted receipt reference: a digest, never receipt contents.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct TenantRootReceiptDigestV1([u8; 32]);

impl TenantRootReceiptDigestV1 {
    /// Wraps exact digest bytes.
    pub fn from_bytes(bytes: [u8; 32]) -> RouterAbDerivationResult<Self> {
        if bytes.iter().all(|byte| *byte == 0) {
            return Err(malformed("tenant root receipt digest must be non-zero"));
        }
        Ok(Self(bytes))
    }

    /// Returns the digest bytes.
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for TenantRootReceiptDigestV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("TenantRootReceiptDigestV1")
            .field(&hex::encode(self.0))
            .finish()
    }
}

/// One receipt from each Deriver.
///
/// Both roles are required by construction: a claim that needs two receipts can
/// never be built from one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TenantRootRoleReceiptsV1 {
    deriver_a: TenantRootReceiptDigestV1,
    deriver_b: TenantRootReceiptDigestV1,
}

impl TenantRootRoleReceiptsV1 {
    /// Records one receipt per role.
    pub fn new(
        deriver_a: TenantRootReceiptDigestV1,
        deriver_b: TenantRootReceiptDigestV1,
    ) -> RouterAbDerivationResult<Self> {
        if deriver_a == deriver_b {
            return Err(malformed(
                "tenant root role receipts must be two distinct receipts",
            ));
        }
        Ok(Self {
            deriver_a,
            deriver_b,
        })
    }

    /// Returns one role's receipt.
    pub const fn role(&self, role: TwoPartyDeriverRole) -> TenantRootReceiptDigestV1 {
        match role {
            TwoPartyDeriverRole::DeriverA => self.deriver_a,
            TwoPartyDeriverRole::DeriverB => self.deriver_b,
        }
    }
}

/// Material a failed or expired operation still has to remove.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootOutstandingCleanupV1 {
    roles: Vec<TwoPartyDeriverRole>,
    description: String,
}

impl TenantRootOutstandingCleanupV1 {
    /// Records the roles whose cleanup is still outstanding.
    pub fn new(
        roles: Vec<TwoPartyDeriverRole>,
        description: impl Into<String>,
    ) -> RouterAbDerivationResult<Self> {
        let description = description.into();
        if roles.is_empty() {
            return Err(malformed(
                "outstanding cleanup must name at least one role; use the completed branch instead",
            ));
        }
        if roles.len() > 2 || (roles.len() == 2 && roles[0] == roles[1]) {
            return Err(malformed("outstanding cleanup repeats a role"));
        }
        require_tenant_root_identifier("outstanding cleanup description", &description)?;
        Ok(Self { roles, description })
    }

    /// Returns the roles still requiring cleanup.
    pub fn roles(&self) -> &[TwoPartyDeriverRole] {
        &self.roles
    }

    /// Returns the operator-facing description.
    pub fn description(&self) -> &str {
        &self.description
    }
}

/// Exhaustive state of one operational-share rotation job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantRootRotationJobV1 {
    /// Contributions are being prepared.
    Preparing,
    /// New shares are being installed by both roles.
    Installing,
    /// Root continuity is being verified.
    Verifying,
    /// The new epoch is being activated.
    Activating,
    /// The new epoch is active and previous shares are being retired.
    Retiring {
        /// The activated epoch.
        activated_epoch: TenantRootShareEpoch,
        /// The signed activation receipt digest.
        activation_receipt: TenantRootReceiptDigestV1,
    },
    /// Activation and both retirements are proved.
    Complete {
        /// The activated epoch.
        activated_epoch: TenantRootShareEpoch,
        /// The signed activation receipt digest.
        activation_receipt: TenantRootReceiptDigestV1,
        /// One proved retirement receipt per role.
        retirement_receipts: TenantRootRoleReceiptsV1,
    },
    /// The job failed before activation and its cleanup is proved.
    FailedBeforeActivation {
        /// Stable failure code.
        failure_code: String,
        /// One cleanup receipt per role.
        cleanup_receipts: TenantRootRoleReceiptsV1,
    },
    /// The job failed and material is still outstanding.
    CleanupIncomplete {
        /// Stable failure code.
        failure_code: String,
        /// What remains to be removed.
        outstanding: TenantRootOutstandingCleanupV1,
    },
    /// The new epoch is active but retirement is not proved for every role.
    ///
    /// This branch exists so the product cannot claim compromise healing from
    /// an activation that has not proved both retirements.
    RetirementIncomplete {
        /// The activated epoch.
        activated_epoch: TenantRootShareEpoch,
        /// The signed activation receipt digest.
        activation_receipt: TenantRootReceiptDigestV1,
        /// Roles whose retirement is not proved.
        outstanding: TenantRootOutstandingCleanupV1,
    },
}

impl TenantRootRotationJobV1 {
    /// Returns the stable wire label shown by the dashboard and CLI.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Preparing => "preparing",
            Self::Installing => "installing",
            Self::Verifying => "verifying",
            Self::Activating => "activating",
            Self::Retiring { .. } => "retiring",
            Self::Complete { .. } => "complete",
            Self::FailedBeforeActivation { .. } => "failed_before_activation",
            Self::CleanupIncomplete { .. } => "cleanup_incomplete",
            Self::RetirementIncomplete { .. } => "retirement_incomplete",
        }
    }

    /// Returns true while the job still holds the tenant-root operation lock.
    pub const fn is_in_flight(&self) -> bool {
        matches!(
            self,
            Self::Preparing
                | Self::Installing
                | Self::Verifying
                | Self::Activating
                | Self::Retiring { .. }
        )
    }

    /// Returns true only when both retirement receipts are proved.
    ///
    /// Compromise-healing copy is gated on this, never on activation.
    pub const fn permits_compromise_healing_claim(&self) -> bool {
        matches!(self, Self::Complete { .. })
    }
}

/// Which recovery recipients have proved control of their keys.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantRootRecipientEnrolmentV1 {
    /// Neither role has proved control.
    NeitherEnrolled,
    /// Only Deriver A has proved control.
    DeriverAEnrolled {
        /// The verified Deriver A recipient fingerprint.
        deriver_a: TenantRootRecoveryRecipientFingerprintV1,
    },
    /// Only Deriver B has proved control.
    DeriverBEnrolled {
        /// The verified Deriver B recipient fingerprint.
        deriver_b: TenantRootRecoveryRecipientFingerprintV1,
    },
}

/// One verified Deriver A and Deriver B recipient pair.
///
/// The two fingerprints must differ, so no state can represent one public
/// recipient as valid for both roles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TenantRootRecipientPairV1 {
    deriver_a: TenantRootRecoveryRecipientFingerprintV1,
    deriver_b: TenantRootRecoveryRecipientFingerprintV1,
}

impl TenantRootRecipientPairV1 {
    /// Records one verified pair.
    pub fn new(
        deriver_a: TenantRootRecoveryRecipientFingerprintV1,
        deriver_b: TenantRootRecoveryRecipientFingerprintV1,
    ) -> RouterAbDerivationResult<Self> {
        if deriver_a.as_bytes() == deriver_b.as_bytes() {
            return Err(malformed(
                "Deriver A and Deriver B recovery recipients must be different keys",
            ));
        }
        Ok(Self {
            deriver_a,
            deriver_b,
        })
    }

    /// Returns one role's verified recipient fingerprint.
    pub const fn role(
        &self,
        role: TwoPartyDeriverRole,
    ) -> TenantRootRecoveryRecipientFingerprintV1 {
        match role {
            TwoPartyDeriverRole::DeriverA => self.deriver_a,
            TwoPartyDeriverRole::DeriverB => self.deriver_b,
        }
    }
}

/// One complete service-held recovery set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRecoverySetStateV1 {
    recovery_set_id: TenantRootRecoverySetId,
    recipient_pair: TenantRootRecipientPairV1,
    created_at: String,
    manifest_digest: TenantRootReceiptDigestV1,
}

impl TenantRootRecoverySetStateV1 {
    /// Records one complete recovery set.
    pub fn new(
        recovery_set_id: TenantRootRecoverySetId,
        recipient_pair: TenantRootRecipientPairV1,
        created_at: impl Into<String>,
        manifest_digest: TenantRootReceiptDigestV1,
    ) -> RouterAbDerivationResult<Self> {
        let created_at = created_at.into();
        validate_rfc3339_millis(&created_at, "recovery set creation time")?;
        epoch_millis(&created_at, "recovery set creation time")?;
        Ok(Self {
            recovery_set_id,
            recipient_pair,
            created_at,
            manifest_digest,
        })
    }

    /// Returns the recovery set identifier.
    pub const fn recovery_set_id(&self) -> TenantRootRecoverySetId {
        self.recovery_set_id
    }

    /// Returns the verified recipient pair.
    pub const fn recipient_pair(&self) -> TenantRootRecipientPairV1 {
        self.recipient_pair
    }

    /// Returns the creation time.
    pub fn created_at(&self) -> &str {
        &self.created_at
    }

    /// Returns the signed manifest digest.
    pub const fn manifest_digest(&self) -> TenantRootReceiptDigestV1 {
        self.manifest_digest
    }
}

/// Exhaustive state of the tenant-controlled recovery backup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantRootRecoveryBackupV1 {
    /// No governance or recipients chosen yet.
    NotConfigured,
    /// Governance chosen; recipient proofs incomplete.
    RecipientsPending {
        /// Which roles have proved control so far.
        enrolled: TenantRootRecipientEnrolmentV1,
    },
    /// The first recovery set is being generated.
    PreparingInitial {
        /// The verified pair the set is being generated for.
        recipient_pair: TenantRootRecipientPairV1,
        /// The exact set being generated; activation must produce this id.
        pending_recovery_set_id: TenantRootRecoverySetId,
    },
    /// One active downloadable recovery set.
    Ready {
        /// The active set.
        active: TenantRootRecoverySetStateV1,
    },
    /// A replacement is being generated while the old set stays downloadable.
    Replacing {
        /// The set that remains downloadable until the replacement is verified.
        active: TenantRootRecoverySetStateV1,
        /// The pair the replacement is being generated for.
        pending_recipient_pair: TenantRootRecipientPairV1,
        /// The exact replacement set being generated; never the active id.
        pending_recovery_set_id: TenantRootRecoverySetId,
    },
    /// Initial generation failed and its pending material is proved removed.
    FailedInitial {
        /// Stable failure code.
        failure_code: String,
        /// One cleanup receipt per role.
        cleanup_receipts: TenantRootRoleReceiptsV1,
    },
    /// Replacement failed; the old set stays active and pending material is removed.
    FailedReplacement {
        /// The set that remains active.
        active: TenantRootRecoverySetStateV1,
        /// Stable failure code.
        failure_code: String,
        /// One cleanup receipt per role.
        cleanup_receipts: TenantRootRoleReceiptsV1,
    },
    /// Material still requires cleanup; a superseded set is never reactivated.
    CleanupIncomplete {
        /// The active set, when one survived.
        active: Option<TenantRootRecoverySetStateV1>,
        /// What remains to be removed.
        outstanding: TenantRootOutstandingCleanupV1,
    },
    /// Restored from packages this deployment never stored.
    TenantHeldExternal {
        /// The source recovery set the tenant still holds.
        recovery_set_id: TenantRootRecoverySetId,
        /// The manifest digest that restored this root.
        manifest_digest: TenantRootReceiptDigestV1,
    },
}

impl TenantRootRecoveryBackupV1 {
    /// Returns the stable wire label.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::NotConfigured => "not_configured",
            Self::RecipientsPending { .. } => "recipients_pending",
            Self::PreparingInitial { .. } => "preparing_initial",
            Self::Ready { .. } => "ready",
            Self::Replacing { .. } => "replacing",
            Self::FailedInitial { .. } => "failed_initial",
            Self::FailedReplacement { .. } => "failed_replacement",
            Self::CleanupIncomplete { .. } => "cleanup_incomplete",
            Self::TenantHeldExternal { .. } => "tenant_held_external",
        }
    }

    /// Returns the set a tenant can download right now, if any.
    ///
    /// A restored `tenant_held_external` set is deliberately absent: this
    /// deployment never stored those packages and cannot serve them.
    pub const fn downloadable_set(&self) -> Option<&TenantRootRecoverySetStateV1> {
        match self {
            Self::Ready { active }
            | Self::Replacing { active, .. }
            | Self::FailedReplacement { active, .. } => Some(active),
            Self::CleanupIncomplete { active, .. } => active.as_ref(),
            Self::NotConfigured
            | Self::RecipientsPending { .. }
            | Self::PreparingInitial { .. }
            | Self::FailedInitial { .. }
            | Self::TenantHeldExternal { .. } => None,
        }
    }

    /// Returns true while backup generation holds the tenant-root operation lock.
    pub const fn is_in_flight(&self) -> bool {
        matches!(self, Self::PreparingInitial { .. } | Self::Replacing { .. })
    }
}

/// Which role shares a restore session has installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TenantRootRoleImportProgressV1 {
    /// Neither role has installed its share.
    NeitherInstalled,
    /// Only Deriver A has installed its share.
    DeriverAInstalled {
        /// Deriver A's installation receipt.
        deriver_a: TenantRootReceiptDigestV1,
    },
    /// Only Deriver B has installed its share.
    DeriverBInstalled {
        /// Deriver B's installation receipt.
        deriver_b: TenantRootReceiptDigestV1,
    },
}

/// How the source deployment was left after a destination activated.
///
/// There is deliberately no generic boolean such as `sourceRevoked`: a source
/// that still holds usable shares remains a valid custodian of the same root,
/// and the product may not imply otherwise.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantRootSourceCustodyDispositionV1 {
    /// Every required destruction, probe, revocation, and canary receipt passed.
    VerifiedRetired {
        /// One destruction receipt per role.
        destruction_receipts: TenantRootRoleReceiptsV1,
        /// One permanent decrypt-probe failure receipt per role.
        decrypt_probe_receipts: TenantRootRoleReceiptsV1,
        /// Receipt for revoking source lineage-scoped service credentials.
        credential_revocation_receipt: TenantRootReceiptDigestV1,
        /// Canary proving the old derivation endpoints reject the lineage.
        endpoint_canary_receipt: TenantRootReceiptDigestV1,
        /// The actor who recorded the retirement.
        recorded_by: String,
        /// When the retirement was recorded.
        recorded_at: String,
    },
    /// Retirement was attempted but could not be verified.
    UnavailableRetirementUnverified {
        /// The checks that were attempted.
        attempted_checks: Vec<String>,
        /// The actor who recorded the outcome.
        recorded_by: String,
        /// When the outcome was recorded.
        recorded_at: String,
    },
    /// The source is deliberately kept, and stays in the security model.
    RetainedAsBackup {
        /// The actor who acknowledged the retained source.
        acknowledged_by: String,
        /// The incident-response note for the retained custodian.
        incident_response_note: String,
        /// When the acknowledgement was recorded.
        recorded_at: String,
    },
}

impl TenantRootSourceCustodyDispositionV1 {
    /// Returns the stable wire label.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::VerifiedRetired { .. } => "verified_retired",
            Self::UnavailableRetirementUnverified { .. } => "unavailable_retirement_unverified",
            Self::RetainedAsBackup { .. } => "retained_as_backup",
        }
    }

    /// Returns true only for a source proved retired by every required receipt.
    ///
    /// Even then it applies to the named source lineage alone; it is not proof
    /// that no other clone exists.
    pub const fn source_is_proved_retired(&self) -> bool {
        matches!(self, Self::VerifiedRetired { .. })
    }

    /// Records one unverified-retirement disposition.
    pub fn unavailable_retirement_unverified(
        attempted_checks: Vec<String>,
        recorded_by: impl Into<String>,
        recorded_at: impl Into<String>,
    ) -> RouterAbDerivationResult<Self> {
        let recorded_by = recorded_by.into();
        let recorded_at = recorded_at.into();
        if attempted_checks.is_empty() {
            return Err(malformed(
                "an unverified retirement must name the checks that were attempted",
            ));
        }
        for check in &attempted_checks {
            require_tenant_root_identifier("attempted retirement check", check)?;
        }
        require_tenant_root_identifier("source disposition actor", &recorded_by)?;
        validate_rfc3339_millis(&recorded_at, "source disposition time")?;
        epoch_millis(&recorded_at, "source disposition time")?;
        Ok(Self::UnavailableRetirementUnverified {
            attempted_checks,
            recorded_by,
            recorded_at,
        })
    }

    /// Records one deliberately retained source.
    pub fn retained_as_backup(
        acknowledged_by: impl Into<String>,
        incident_response_note: impl Into<String>,
        recorded_at: impl Into<String>,
    ) -> RouterAbDerivationResult<Self> {
        let acknowledged_by = acknowledged_by.into();
        let incident_response_note = incident_response_note.into();
        let recorded_at = recorded_at.into();
        require_tenant_root_identifier("source disposition actor", &acknowledged_by)?;
        require_tenant_root_identifier(
            "retained source incident-response note",
            &incident_response_note,
        )?;
        validate_rfc3339_millis(&recorded_at, "source disposition time")?;
        epoch_millis(&recorded_at, "source disposition time")?;
        Ok(Self::RetainedAsBackup {
            acknowledged_by,
            incident_response_note,
            recorded_at,
        })
    }

    /// Records one fully verified retirement.
    #[allow(clippy::too_many_arguments)]
    pub fn verified_retired(
        destruction_receipts: TenantRootRoleReceiptsV1,
        decrypt_probe_receipts: TenantRootRoleReceiptsV1,
        credential_revocation_receipt: TenantRootReceiptDigestV1,
        endpoint_canary_receipt: TenantRootReceiptDigestV1,
        recorded_by: impl Into<String>,
        recorded_at: impl Into<String>,
    ) -> RouterAbDerivationResult<Self> {
        let recorded_by = recorded_by.into();
        let recorded_at = recorded_at.into();
        require_tenant_root_identifier("source disposition actor", &recorded_by)?;
        validate_rfc3339_millis(&recorded_at, "source disposition time")?;
        epoch_millis(&recorded_at, "source disposition time")?;
        Ok(Self::VerifiedRetired {
            destruction_receipts,
            decrypt_probe_receipts,
            credential_revocation_receipt,
            endpoint_canary_receipt,
            recorded_by,
            recorded_at,
        })
    }
}

/// Exhaustive state of one destination restore session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantRootRestoreSessionV1 {
    /// The session exists and is waiting for its public recovery manifest.
    AwaitingManifest,
    /// The manifest is registered and role shares are being imported.
    AwaitingRoleImports {
        /// The bound source recovery set.
        recovery_set_id: TenantRootRecoverySetId,
        /// Which role shares have been installed.
        installed: TenantRootRoleImportProgressV1,
    },
    /// Both role shares are installed and continuity is being verified.
    Verifying {
        /// The bound source recovery set.
        recovery_set_id: TenantRootRecoverySetId,
        /// One installation receipt per role.
        installation_receipts: TenantRootRoleReceiptsV1,
    },
    /// Continuity passed; activation may proceed.
    ReadyToActivate {
        /// The bound source recovery set.
        recovery_set_id: TenantRootRecoverySetId,
        /// One installation receipt per role.
        installation_receipts: TenantRootRoleReceiptsV1,
    },
    /// The mandatory forward refresh is running.
    Refreshing {
        /// The bound source recovery set.
        recovery_set_id: TenantRootRecoverySetId,
        /// One installation receipt per role.
        installation_receipts: TenantRootRoleReceiptsV1,
    },
    /// The restored root is active on this destination.
    Active {
        /// This destination's own custody lineage.
        destination_lineage: TenantRootCustodyLineageId,
        /// The activated epoch.
        activated_epoch: TenantRootShareEpoch,
        /// The signed activation receipt.
        activation_receipt: TenantRootReceiptDigestV1,
        /// Proof the mandatory forward refresh produced the activated epoch.
        forward_refresh_receipt: TenantRootReceiptDigestV1,
        /// Proof the continuity canaries passed against the restored root.
        continuity_canary_receipt: TenantRootReceiptDigestV1,
        /// Proof the one-time bootstrap credential was destroyed.
        bootstrap_destruction_receipt: TenantRootReceiptDigestV1,
        /// How the source deployment was left.
        source_disposition: TenantRootSourceCustodyDispositionV1,
        /// The source set, recorded as tenant-held and not stored here.
        tenant_held_recovery_set_id: TenantRootRecoverySetId,
    },
    /// The session failed before activation and its cleanup is proved.
    FailedBeforeActivation {
        /// Stable failure code.
        failure_code: String,
        /// One cleanup receipt per role.
        cleanup_receipts: TenantRootRoleReceiptsV1,
    },
    /// Imported material or import keys still require cleanup.
    CleanupIncomplete {
        /// What remains to be removed.
        outstanding: TenantRootOutstandingCleanupV1,
    },
    /// The 24-hour session expired and its cleanup is proved.
    Expired {
        /// When the session expired.
        expired_at: String,
        /// One cleanup receipt per role.
        cleanup_receipts: TenantRootRoleReceiptsV1,
    },
}

impl TenantRootRestoreSessionV1 {
    /// Returns the stable wire label.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::AwaitingManifest => "awaiting_manifest",
            Self::AwaitingRoleImports { .. } => "awaiting_role_imports",
            Self::Verifying { .. } => "verifying",
            Self::ReadyToActivate { .. } => "ready_to_activate",
            Self::Refreshing { .. } => "refreshing",
            Self::Active { .. } => "active",
            Self::FailedBeforeActivation { .. } => "failed_before_activation",
            Self::CleanupIncomplete { .. } => "cleanup_incomplete",
            Self::Expired { .. } => "expired",
        }
    }

    /// Returns true while the session holds the tenant-root operation lock.
    pub const fn is_in_flight(&self) -> bool {
        matches!(
            self,
            Self::AwaitingManifest
                | Self::AwaitingRoleImports { .. }
                | Self::Verifying { .. }
                | Self::ReadyToActivate { .. }
                | Self::Refreshing { .. }
        )
    }
}

/// The whole console-facing state of one tenant derivation root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootConsoleStateV1 {
    rotation: Option<TenantRootRotationJobV1>,
    backup: TenantRootRecoveryBackupV1,
    restore: Option<TenantRootRestoreSessionV1>,
}

impl TenantRootConsoleStateV1 {
    /// Assembles one console state.
    ///
    /// An active tenant root and an in-flight restore session are mutually
    /// exclusive by construction: restore targets an empty destination, so a
    /// deployment that is rotating or holding recovery sets cannot also be
    /// restoring into itself.
    pub fn new(
        rotation: Option<TenantRootRotationJobV1>,
        backup: TenantRootRecoveryBackupV1,
        restore: Option<TenantRootRestoreSessionV1>,
    ) -> RouterAbDerivationResult<Self> {
        let state = Self {
            rotation,
            backup,
            restore,
        };
        if state
            .restore
            .as_ref()
            .is_some_and(|session| session.is_in_flight())
            && state
                .rotation
                .as_ref()
                .is_some_and(|job| job.is_in_flight())
        {
            return Err(malformed(
                "a tenant root cannot rotate and restore at the same time",
            ));
        }
        Ok(state)
    }

    /// Returns the rotation job, when one exists.
    pub const fn rotation(&self) -> Option<&TenantRootRotationJobV1> {
        self.rotation.as_ref()
    }

    /// Returns the recovery backup state.
    pub const fn backup(&self) -> &TenantRootRecoveryBackupV1 {
        &self.backup
    }

    /// Returns the restore session, when one exists.
    pub const fn restore(&self) -> Option<&TenantRootRestoreSessionV1> {
        self.restore.as_ref()
    }

    /// Decides whether one operation may start against this state.
    ///
    /// Rotation, governance and recipient changes, backup generation and
    /// replacement, restore, and source retirement all take the one tenant-root
    /// operation lock. Read-only status and downloads of an already-complete
    /// set do not.
    ///
    /// A restore session holds the lock from its start to its activation. The
    /// steps of that session — registering the manifest, issuing import keys,
    /// importing role shares, activating — are the only operations the lock
    /// admits while it is held, and the only ones it refuses when no session
    /// is in flight: they continue a session rather than compete with one.
    pub fn permits_operation(
        &self,
        kind: TenantRootOperationKindV1,
    ) -> RouterAbDerivationResult<()> {
        if !operation_takes_the_lock(kind) {
            return Ok(());
        }
        if self
            .rotation
            .as_ref()
            .is_some_and(TenantRootRotationJobV1::is_in_flight)
        {
            return Err(malformed(
                "an operational-share rotation is already in flight for this tenant root",
            ));
        }
        if self.backup.is_in_flight() {
            return Err(malformed(
                "a recovery backup operation is already in flight for this tenant root",
            ));
        }
        let restore_in_flight = self
            .restore
            .as_ref()
            .is_some_and(TenantRootRestoreSessionV1::is_in_flight);
        if operation_continues_a_restore_session(kind) {
            if !restore_in_flight {
                return Err(malformed(
                    "no restore session is in flight for this tenant root",
                ));
            }
            return Ok(());
        }
        if restore_in_flight {
            return Err(malformed(
                "a restore session is already in flight for this tenant root",
            ));
        }
        Ok(())
    }
}

/// The steps of one restore session, which run while the session holds the
/// lock rather than taking it themselves.
const fn operation_continues_a_restore_session(kind: TenantRootOperationKindV1) -> bool {
    matches!(
        kind,
        TenantRootOperationKindV1::RestoreManifestRegister
            | TenantRootOperationKindV1::RestoreRoleImportKeyIssue
            | TenantRootOperationKindV1::RestoreRoleImport
            | TenantRootOperationKindV1::RestoreActivate
    )
}

const fn operation_takes_the_lock(kind: TenantRootOperationKindV1) -> bool {
    match kind {
        TenantRootOperationKindV1::OperationalShareRotation
        | TenantRootOperationKindV1::RecoveryGovernanceChange
        | TenantRootOperationKindV1::RecoveryRecipientPairEnroll
        | TenantRootOperationKindV1::RecoveryRecipientPairReplace
        | TenantRootOperationKindV1::RecoveryBackupCreate
        | TenantRootOperationKindV1::RecoveryBackupReplace
        | TenantRootOperationKindV1::RestoreSessionStart
        | TenantRootOperationKindV1::RestoreManifestRegister
        | TenantRootOperationKindV1::RestoreRoleImportKeyIssue
        | TenantRootOperationKindV1::RestoreRoleImport
        | TenantRootOperationKindV1::RestoreActivate
        | TenantRootOperationKindV1::SourceLineageRetire => true,
        TenantRootOperationKindV1::RecoveryRolePackageDownload
        | TenantRootOperationKindV1::RecoveryManifestDownload => false,
    }
}
