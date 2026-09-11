//! Authorization for tenant derivation-root console operations (Refactor 121).
//!
//! Every mutating console operation is bound to one exact server-generated
//! record. The record's digest is what a capability signs, what a second owner
//! approves, and what the control plane consumes once — so a request cannot be
//! re-pointed at a different tenant, role, lifecycle revision, or actor after
//! it was authorized.
//!
//! Three properties this module exists to enforce:
//!
//! - **No caller-asserted MFA.** Step-up is a server-signed evidence type, not
//!   a boolean in a request body, and it must be fresh.
//! - **No self-approval.** Under two-person governance the approver must be a
//!   different owner, and the approval covers the exact operation digest.
//! - **No reuse.** A capability carries a one-use nonce and an expiry; the
//!   authorized result has no public constructor, so it can only come from a
//!   passing check.

use core::fmt;

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;
use threshold_prf::{TwoPartyDeriverRole, TwoPartyRootCommitment};

use super::tenant_root::require_tenant_root_identifier;
use super::tenant_root_recovery_artifacts::{
    canonical_recovery_json_v1, decode_base64url_fixed, encode_base64url, json_object, malformed,
    malformed_owned, parse_strict_recovery_json_v1, validate_rfc3339_millis, verification_failed,
};
use super::tenant_root_restore_import::{
    TenantRootRestoreDestinationFingerprintV1, TenantRootRestoreSessionIdV1,
};
use super::tenant_root_time::epoch_millis;
use super::{
    RouterAbDerivationResult, TenantRootCustodyLineageId, TenantRootIdentityDigestV1,
    TenantRootIdentityV1, TenantRootRecoverySetId, TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1,
};

const TENANT_ROOT_OPERATION_DOMAIN_V1: &[u8] = b"seams/tenant-root-operation/v1";
const TENANT_ROOT_STEP_UP_DOMAIN_V1: &[u8] = b"seams/tenant-root-step-up/v1";
const TENANT_ROOT_APPROVAL_DOMAIN_V1: &[u8] = b"seams/tenant-root-operation-approval/v1";
const TENANT_ROOT_OPERATION_RECORD_FORMAT_V1: &str = "tenant_root_operation_record_v1";

/// Fixed warning version acknowledged when a tenant selects single-owner governance.
pub const TENANT_ROOT_SINGLE_OWNER_WARNING_V1: &str = "tenant_root_single_owner_v1";
/// Maximum age of step-up evidence when an operation is authorized.
pub const TENANT_ROOT_STEP_UP_MAX_AGE_MS_V1: i64 = 300_000;
/// Maximum lifetime of an operation authorization.
pub const TENANT_ROOT_OPERATION_MAX_LIFETIME_MS_V1: i64 = 600_000;
/// Maximum lifetime of a one-role ciphertext download authorization.
pub const TENANT_ROOT_DOWNLOAD_MAX_LIFETIME_MS_V1: i64 = 300_000;
/// Maximum canonical bytes accepted for one operation record.
pub const TENANT_ROOT_OPERATION_RECORD_MAX_BYTES_V1: usize = 8 * 1024;

const OPERATION_NONCE_BYTES: usize = 32;

/// One console operation on a tenant derivation root.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TenantRootOperationKindV1 {
    /// Manual operational-share rotation.
    OperationalShareRotation,
    /// Install one recovery governance branch.
    RecoveryGovernanceChange,
    /// Enrol the first verified Deriver A/B recipient pair.
    RecoveryRecipientPairEnroll,
    /// Replace the verified Deriver A/B recipient pair.
    RecoveryRecipientPairReplace,
    /// Create the first recovery backup under the active pair.
    RecoveryBackupCreate,
    /// Replace the active recovery backup.
    RecoveryBackupReplace,
    /// Download one role's encrypted package.
    RecoveryRolePackageDownload,
    /// Download the public recovery manifest.
    RecoveryManifestDownload,
    /// Start one destination restore session.
    RestoreSessionStart,
    /// Bind one recovery manifest to a restore session.
    RestoreManifestRegister,
    /// Issue one role-local destination import key.
    RestoreRoleImportKeyIssue,
    /// Accept one role's destination import envelope.
    RestoreRoleImport,
    /// Verify, forward-refresh, and activate a restored root.
    RestoreActivate,
    /// Retire the source lineage after destination activation.
    SourceLineageRetire,
}

impl TenantRootOperationKindV1 {
    /// Returns the canonical wire value.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OperationalShareRotation => "tenant_root_operational_share_rotation_v1",
            Self::RecoveryGovernanceChange => "tenant_root_recovery_governance_change_v1",
            Self::RecoveryRecipientPairEnroll => "tenant_root_recovery_recipient_pair_enroll_v1",
            Self::RecoveryRecipientPairReplace => "tenant_root_recovery_recipient_pair_replace_v1",
            Self::RecoveryBackupCreate => "tenant_root_recovery_backup_create_v1",
            Self::RecoveryBackupReplace => "tenant_root_recovery_backup_replace_v1",
            Self::RecoveryRolePackageDownload => "tenant_root_recovery_role_package_download_v1",
            Self::RecoveryManifestDownload => "tenant_root_recovery_manifest_download_v1",
            Self::RestoreSessionStart => "tenant_root_restore_session_start_v1",
            Self::RestoreManifestRegister => "tenant_root_restore_manifest_register_v1",
            Self::RestoreRoleImportKeyIssue => "tenant_root_restore_role_import_key_issue_v1",
            Self::RestoreRoleImport => "tenant_root_restore_role_import_v1",
            Self::RestoreActivate => "tenant_root_restore_activate_v1",
            Self::SourceLineageRetire => "tenant_root_source_lineage_retire_v1",
        }
    }

    /// Returns true for the operations that follow the tenant's recovery governance.
    ///
    /// These are the four that change who can recover the root, or that destroy
    /// a source custodian. Everything else needs one stepped-up console actor.
    pub const fn follows_recovery_governance(self) -> bool {
        matches!(
            self,
            Self::RecoveryGovernanceChange
                | Self::RecoveryRecipientPairEnroll
                | Self::RecoveryRecipientPairReplace
                | Self::SourceLineageRetire
        )
    }

    /// Returns true when the operation acts on exactly one Deriver role.
    pub const fn is_role_local(self) -> bool {
        matches!(
            self,
            Self::RecoveryRolePackageDownload
                | Self::RestoreRoleImportKeyIssue
                | Self::RestoreRoleImport
        )
    }

    /// Returns the maximum authorization lifetime for this operation.
    pub const fn max_lifetime_ms(self) -> i64 {
        match self {
            Self::RecoveryRolePackageDownload | Self::RecoveryManifestDownload => {
                TENANT_ROOT_DOWNLOAD_MAX_LIFETIME_MS_V1
            }
            _ => TENANT_ROOT_OPERATION_MAX_LIFETIME_MS_V1,
        }
    }

    fn required_subject(self) -> RequiredSubject {
        match self {
            Self::RecoveryRecipientPairEnroll | Self::RecoveryRecipientPairReplace => {
                RequiredSubject::RecipientPair
            }
            Self::RecoveryBackupReplace
            | Self::RecoveryRolePackageDownload
            | Self::RecoveryManifestDownload
            | Self::RestoreManifestRegister
            | Self::RestoreRoleImportKeyIssue
            | Self::RestoreRoleImport
            | Self::RestoreActivate => RequiredSubject::RecoverySet,
            Self::OperationalShareRotation
            | Self::RecoveryGovernanceChange
            | Self::RecoveryBackupCreate
            | Self::RestoreSessionStart
            | Self::SourceLineageRetire => RequiredSubject::None,
        }
    }

    fn parse(value: &str) -> RouterAbDerivationResult<Self> {
        const ALL: [TenantRootOperationKindV1; 14] = [
            TenantRootOperationKindV1::OperationalShareRotation,
            TenantRootOperationKindV1::RecoveryGovernanceChange,
            TenantRootOperationKindV1::RecoveryRecipientPairEnroll,
            TenantRootOperationKindV1::RecoveryRecipientPairReplace,
            TenantRootOperationKindV1::RecoveryBackupCreate,
            TenantRootOperationKindV1::RecoveryBackupReplace,
            TenantRootOperationKindV1::RecoveryRolePackageDownload,
            TenantRootOperationKindV1::RecoveryManifestDownload,
            TenantRootOperationKindV1::RestoreSessionStart,
            TenantRootOperationKindV1::RestoreManifestRegister,
            TenantRootOperationKindV1::RestoreRoleImportKeyIssue,
            TenantRootOperationKindV1::RestoreRoleImport,
            TenantRootOperationKindV1::RestoreActivate,
            TenantRootOperationKindV1::SourceLineageRetire,
        ];
        ALL.into_iter()
            .find(|kind| kind.as_str() == value)
            .ok_or_else(|| malformed("tenant root operation kind is not a known operation"))
    }
}

impl Serialize for TenantRootOperationKindV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequiredSubject {
    None,
    RecoverySet,
    RecipientPair,
}

/// What an operation acts on, when it acts on a recovery set or recipient pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantRootOperationSubjectV1 {
    /// The operation acts on the tenant root itself.
    TenantRoot,
    /// The operation acts on one exact recovery set.
    RecoverySet {
        /// The recovery set identifier.
        recovery_set_id: TenantRootRecoverySetId,
    },
    /// The operation acts on one exact verified recipient pair.
    RecipientPair {
        /// Digest over the exact Deriver A and Deriver B recipient keys.
        recipient_pair_digest: [u8; 32],
    },
}

impl TenantRootOperationSubjectV1 {
    fn kind_matches(&self, required: RequiredSubject) -> bool {
        matches!(
            (self, required),
            (Self::TenantRoot, RequiredSubject::None)
                | (Self::RecoverySet { .. }, RequiredSubject::RecoverySet)
                | (Self::RecipientPair { .. }, RequiredSubject::RecipientPair)
        )
    }

    fn to_value(&self) -> Value {
        match self {
            Self::TenantRoot => {
                json_object(vec![("kind", Value::String("tenant_root".to_owned()))])
            }
            Self::RecoverySet { recovery_set_id } => json_object(vec![
                ("kind", Value::String("recovery_set".to_owned())),
                (
                    "recoverySetId",
                    Value::String(recovery_set_id.to_base64url()),
                ),
            ]),
            Self::RecipientPair {
                recipient_pair_digest,
            } => json_object(vec![
                ("kind", Value::String("recipient_pair".to_owned())),
                (
                    "recipientPairDigest",
                    Value::String(encode_base64url(recipient_pair_digest)),
                ),
            ]),
        }
    }
}

/// The tenant's recovery governance policy: exactly one branch, chosen up front.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantRootRecoveryGovernanceV1 {
    /// One freshly stepped-up owner, with the weaker boundary acknowledged.
    SingleOwnerV1 {
        /// The owner who acknowledged the weaker boundary.
        acknowledged_by_owner_id: String,
        /// When the acknowledgement was recorded.
        acknowledged_at: String,
        /// The fixed acknowledged warning version.
        warning_version: String,
    },
    /// The requesting owner plus one different owner.
    TwoPersonV1 {
        /// The owner who selected two-person governance.
        selected_by_owner_id: String,
        /// When the policy was selected.
        selected_at: String,
    },
}

impl TenantRootRecoveryGovernanceV1 {
    /// Records single-owner governance with its required acknowledgement.
    pub fn single_owner(
        acknowledged_by_owner_id: impl Into<String>,
        acknowledged_at: impl Into<String>,
    ) -> RouterAbDerivationResult<Self> {
        let governance = Self::SingleOwnerV1 {
            acknowledged_by_owner_id: acknowledged_by_owner_id.into(),
            acknowledged_at: acknowledged_at.into(),
            warning_version: TENANT_ROOT_SINGLE_OWNER_WARNING_V1.to_owned(),
        };
        governance.validate()?;
        Ok(governance)
    }

    /// Records two-person governance.
    pub fn two_person(
        selected_by_owner_id: impl Into<String>,
        selected_at: impl Into<String>,
    ) -> RouterAbDerivationResult<Self> {
        let governance = Self::TwoPersonV1 {
            selected_by_owner_id: selected_by_owner_id.into(),
            selected_at: selected_at.into(),
        };
        governance.validate()?;
        Ok(governance)
    }

    /// Returns true when this branch requires a second approving owner.
    pub const fn requires_second_owner(&self) -> bool {
        matches!(self, Self::TwoPersonV1 { .. })
    }

    /// Returns the canonical branch label.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::SingleOwnerV1 { .. } => "single_owner_v1",
            Self::TwoPersonV1 { .. } => "two_person_v1",
        }
    }

    /// Returns SHA-256 over the canonical governance record.
    pub fn digest(&self) -> RouterAbDerivationResult<[u8; 32]> {
        use sha2::{Digest, Sha256};
        Ok(Sha256::digest(canonical_recovery_json_v1(&self.to_value())?).into())
    }

    fn validate(&self) -> RouterAbDerivationResult<()> {
        match self {
            Self::SingleOwnerV1 {
                acknowledged_by_owner_id,
                acknowledged_at,
                warning_version,
            } => {
                require_tenant_root_identifier(
                    "recovery governance acknowledging owner id",
                    acknowledged_by_owner_id,
                )?;
                validate_rfc3339_millis(
                    acknowledged_at,
                    "recovery governance acknowledgement time",
                )?;
                epoch_millis(acknowledged_at, "recovery governance acknowledgement time")?;
                if warning_version != TENANT_ROOT_SINGLE_OWNER_WARNING_V1 {
                    return Err(malformed(
                        "single-owner recovery governance warning version is unsupported",
                    ));
                }
                Ok(())
            }
            Self::TwoPersonV1 {
                selected_by_owner_id,
                selected_at,
            } => {
                require_tenant_root_identifier(
                    "recovery governance selecting owner id",
                    selected_by_owner_id,
                )?;
                validate_rfc3339_millis(selected_at, "recovery governance selection time")?;
                epoch_millis(selected_at, "recovery governance selection time")?;
                Ok(())
            }
        }
    }

    fn to_value(&self) -> Value {
        match self {
            Self::SingleOwnerV1 {
                acknowledged_by_owner_id,
                acknowledged_at,
                warning_version,
            } => json_object(vec![
                ("acknowledgedAt", Value::String(acknowledged_at.clone())),
                (
                    "acknowledgedByOwnerId",
                    Value::String(acknowledged_by_owner_id.clone()),
                ),
                ("kind", Value::String("single_owner_v1".to_owned())),
                ("warningVersion", Value::String(warning_version.clone())),
            ]),
            Self::TwoPersonV1 {
                selected_by_owner_id,
                selected_at,
            } => json_object(vec![
                ("kind", Value::String("two_person_v1".to_owned())),
                ("selectedAt", Value::String(selected_at.clone())),
                (
                    "selectedByOwnerId",
                    Value::String(selected_by_owner_id.clone()),
                ),
            ]),
        }
    }
}

/// Returns the governance a policy transition must satisfy.
///
/// A transition uses the stronger quorum of the current and target branches, so
/// one owner cannot quietly downgrade a two-person tenant to single-owner.
pub fn tenant_root_governance_transition_quorum_v1(
    current: &TenantRootRecoveryGovernanceV1,
    target: &TenantRootRecoveryGovernanceV1,
) -> bool {
    current.requires_second_owner() || target.requires_second_owner()
}

/// SHA-256 digest over one canonical operation record.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct TenantRootOperationDigestV1([u8; 32]);

impl TenantRootOperationDigestV1 {
    /// Wraps exact digest bytes.
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Returns the digest bytes.
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for TenantRootOperationDigestV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("TenantRootOperationDigestV1")
            .field(&hex::encode(self.0))
            .finish()
    }
}

/// One non-zero 32-byte one-use operation nonce.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct TenantRootOperationNonceV1([u8; OPERATION_NONCE_BYTES]);

impl TenantRootOperationNonceV1 {
    /// Wraps exact nonce bytes.
    pub fn from_bytes(bytes: [u8; OPERATION_NONCE_BYTES]) -> RouterAbDerivationResult<Self> {
        if bytes.iter().all(|byte| *byte == 0) {
            return Err(malformed("tenant root operation nonce must be non-zero"));
        }
        Ok(Self(bytes))
    }

    /// Returns the nonce bytes.
    pub const fn as_bytes(&self) -> &[u8; OPERATION_NONCE_BYTES] {
        &self.0
    }
}

impl fmt::Debug for TenantRootOperationNonceV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("TenantRootOperationNonceV1")
            .field(&hex::encode(self.0))
            .finish()
    }
}

/// One exact server-generated console operation record.
///
/// The organization, project, and environment ids are taken from the resolved
/// tenant identity rather than accepted separately, so the record's ids and its
/// identity digest can never disagree.
#[derive(Debug, Clone, PartialEq, Eq)]
enum TenantRootOperationRecordStateV1 {
    ActiveRoot {
        expected_lifecycle_revision: u64,
        governance_digest: [u8; 32],
        role: Option<TwoPartyDeriverRole>,
        expected_root_commitment: TwoPartyRootCommitment,
    },
    RestoreRoleImportKeyIssue {
        role: TwoPartyDeriverRole,
        nonce: TenantRootOperationNonceV1,
        manifest_digest: [u8; 32],
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        restore_session_id: TenantRootRestoreSessionIdV1,
        import_key_id: String,
        generation: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootOperationRecordV1 {
    kind: TenantRootOperationKindV1,
    identity_digest: TenantRootIdentityDigestV1,
    org_id: String,
    project_id: String,
    env_id: String,
    custody_lineage: TenantRootCustodyLineageId,
    subject: TenantRootOperationSubjectV1,
    requester_actor_id: String,
    idempotency_key: String,
    issued_at: String,
    expires_at: String,
    state: TenantRootOperationRecordStateV1,
}

impl TenantRootOperationRecordV1 {
    /// Builds one operation record from resolved server state.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        kind: TenantRootOperationKindV1,
        identity: &TenantRootIdentityV1,
        custody_lineage: TenantRootCustodyLineageId,
        expected_lifecycle_revision: u64,
        governance: &TenantRootRecoveryGovernanceV1,
        subject: TenantRootOperationSubjectV1,
        role: Option<TwoPartyDeriverRole>,
        requester_actor_id: impl Into<String>,
        idempotency_key: impl Into<String>,
        issued_at: impl Into<String>,
        expires_at: impl Into<String>,
        expected_root_commitment: TwoPartyRootCommitment,
    ) -> RouterAbDerivationResult<Self> {
        if kind == TenantRootOperationKindV1::RestoreRoleImportKeyIssue {
            return Err(malformed(
                "restore role-import key issue requires its destination-scoped constructor",
            ));
        }
        let record = Self {
            kind,
            identity_digest: identity.digest()?,
            org_id: identity.org_id().to_owned(),
            project_id: identity.project_id().to_owned(),
            env_id: identity.env_id().to_owned(),
            custody_lineage,
            subject,
            requester_actor_id: requester_actor_id.into(),
            idempotency_key: idempotency_key.into(),
            issued_at: issued_at.into(),
            expires_at: expires_at.into(),
            state: TenantRootOperationRecordStateV1::ActiveRoot {
                expected_lifecycle_revision,
                governance_digest: governance.digest()?,
                role,
                expected_root_commitment,
            },
        };
        record.validate()?;
        Ok(record)
    }

    /// Builds the source-offline, destination-scoped restore role-import record.
    #[allow(clippy::too_many_arguments)]
    pub fn new_restore_role_import_key_issue(
        identity: &TenantRootIdentityV1,
        custody_lineage: TenantRootCustodyLineageId,
        recovery_set_id: TenantRootRecoverySetId,
        role: TwoPartyDeriverRole,
        requester_actor_id: impl Into<String>,
        idempotency_key: impl Into<String>,
        nonce: TenantRootOperationNonceV1,
        issued_at: impl Into<String>,
        expires_at: impl Into<String>,
        manifest_digest: [u8; 32],
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        restore_session_id: TenantRootRestoreSessionIdV1,
        import_key_id: impl Into<String>,
        generation: u64,
    ) -> RouterAbDerivationResult<Self> {
        let record = Self {
            kind: TenantRootOperationKindV1::RestoreRoleImportKeyIssue,
            identity_digest: identity.digest()?,
            org_id: identity.org_id().to_owned(),
            project_id: identity.project_id().to_owned(),
            env_id: identity.env_id().to_owned(),
            custody_lineage,
            subject: TenantRootOperationSubjectV1::RecoverySet { recovery_set_id },
            requester_actor_id: requester_actor_id.into(),
            idempotency_key: idempotency_key.into(),
            issued_at: issued_at.into(),
            expires_at: expires_at.into(),
            state: TenantRootOperationRecordStateV1::RestoreRoleImportKeyIssue {
                role,
                nonce,
                manifest_digest,
                destination_fingerprint,
                restore_session_id,
                import_key_id: import_key_id.into(),
                generation,
            },
        };
        record.validate()?;
        Ok(record)
    }

    /// Returns the operation kind.
    pub const fn kind(&self) -> TenantRootOperationKindV1 {
        self.kind
    }

    /// Returns the bound tenant identity digest.
    pub const fn identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.identity_digest
    }

    /// Returns the bound custody lineage.
    pub const fn custody_lineage(&self) -> TenantRootCustodyLineageId {
        self.custody_lineage
    }

    /// Returns what the operation acts on.
    pub const fn subject(&self) -> &TenantRootOperationSubjectV1 {
        &self.subject
    }

    /// Returns the bound role for a role-local operation.
    pub const fn role(&self) -> Option<TwoPartyDeriverRole> {
        match &self.state {
            TenantRootOperationRecordStateV1::ActiveRoot { role, .. } => *role,
            TenantRootOperationRecordStateV1::RestoreRoleImportKeyIssue { role, .. } => Some(*role),
        }
    }

    /// Returns the requesting actor.
    pub fn requester_actor_id(&self) -> &str {
        &self.requester_actor_id
    }

    /// Returns the idempotency key.
    pub fn idempotency_key(&self) -> &str {
        &self.idempotency_key
    }

    /// Returns the issue time.
    pub fn issued_at(&self) -> &str {
        &self.issued_at
    }

    /// Returns the expiry.
    pub fn expires_at(&self) -> &str {
        &self.expires_at
    }

    /// Returns the exact canonical record bytes.
    pub fn canonical_json(&self) -> RouterAbDerivationResult<Vec<u8>> {
        self.validate()?;
        let bytes = canonical_recovery_json_v1(&self.to_value())?;
        if bytes.len() > TENANT_ROOT_OPERATION_RECORD_MAX_BYTES_V1 {
            return Err(malformed("tenant root operation record exceeds size cap"));
        }
        Ok(bytes)
    }

    /// Returns SHA-256 over the domain and the canonical record bytes.
    pub fn digest(&self) -> RouterAbDerivationResult<TenantRootOperationDigestV1> {
        use sha2::{Digest, Sha256};
        let canonical = self.canonical_json()?;
        let mut hasher = Sha256::new();
        hasher.update(TENANT_ROOT_OPERATION_DOMAIN_V1);
        hasher.update(&canonical);
        Ok(TenantRootOperationDigestV1(hasher.finalize().into()))
    }

    /// Parses one exact capped canonical record.
    pub fn from_canonical_json(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.len() > TENANT_ROOT_OPERATION_RECORD_MAX_BYTES_V1 {
            return Err(malformed("tenant root operation record exceeds size cap"));
        }
        let value = parse_strict_recovery_json_v1(bytes)?;
        let operation_kind = value
            .get("operationKind")
            .and_then(Value::as_str)
            .ok_or_else(|| malformed("tenant root operation kind is missing"))?;
        if operation_kind == TenantRootOperationKindV1::RestoreRoleImportKeyIssue.as_str() {
            return Self::from_restore_canonical_value(bytes, value);
        }
        let wire: OperationRecordWire = serde_json::from_value(value).map_err(|error| {
            malformed_owned(format!("invalid tenant root operation record: {error}"))
        })?;
        if wire.format_version != TENANT_ROOT_OPERATION_RECORD_FORMAT_V1 {
            return Err(malformed("tenant root operation record version is invalid"));
        }
        let subject = parse_operation_subject(wire.subject)?;
        let record = Self {
            kind: TenantRootOperationKindV1::parse(&wire.operation_kind)?,
            identity_digest: TenantRootIdentityDigestV1::from_bytes(decode_base64url_fixed(
                &wire.tenant_root_identity_digest,
                "operation identity digest",
            )?),
            org_id: wire.org_id,
            project_id: wire.project_id,
            env_id: wire.env_id,
            custody_lineage: TenantRootCustodyLineageId::from_base64url(&wire.custody_lineage_id)?,
            subject,
            requester_actor_id: wire.requester_actor_id,
            idempotency_key: wire.idempotency_key,
            issued_at: wire.issued_at,
            expires_at: wire.expires_at,
            state: TenantRootOperationRecordStateV1::ActiveRoot {
                expected_lifecycle_revision: wire.expected_lifecycle_revision,
                governance_digest: decode_base64url_fixed(
                    &wire.recovery_governance_digest,
                    "operation governance digest",
                )?,
                role: wire.role.as_deref().map(parse_deriver_role).transpose()?,
                expected_root_commitment: TwoPartyRootCommitment::from_bytes(
                    decode_base64url_fixed(
                        &wire.expected_root_commitment,
                        "operation expected root commitment",
                    )?,
                )
                .map_err(|_| {
                    malformed("tenant root operation expected root commitment is invalid")
                })?,
            },
        };
        record.validate()?;
        if record.canonical_json()? != bytes {
            return Err(malformed(
                "tenant root operation record is not canonical JSON",
            ));
        }
        Ok(record)
    }

    fn from_restore_canonical_value(bytes: &[u8], value: Value) -> RouterAbDerivationResult<Self> {
        let wire: RestoreOperationRecordWire = serde_json::from_value(value).map_err(|error| {
            malformed_owned(format!(
                "invalid tenant root restore operation record: {error}"
            ))
        })?;
        if wire.format_version != TENANT_ROOT_OPERATION_RECORD_FORMAT_V1
            || wire.operation_kind != TenantRootOperationKindV1::RestoreRoleImportKeyIssue.as_str()
        {
            return Err(malformed(
                "tenant root restore operation record version or kind is invalid",
            ));
        }
        let record = Self {
            kind: TenantRootOperationKindV1::RestoreRoleImportKeyIssue,
            identity_digest: TenantRootIdentityDigestV1::from_bytes(decode_base64url_fixed(
                &wire.tenant_root_identity_digest,
                "operation identity digest",
            )?),
            org_id: wire.org_id,
            project_id: wire.project_id,
            env_id: wire.env_id,
            custody_lineage: TenantRootCustodyLineageId::from_base64url(&wire.custody_lineage_id)?,
            subject: parse_operation_subject(wire.subject)?,
            requester_actor_id: wire.requester_actor_id,
            idempotency_key: wire.idempotency_key,
            issued_at: wire.issued_at,
            expires_at: wire.expires_at,
            state: TenantRootOperationRecordStateV1::RestoreRoleImportKeyIssue {
                role: parse_deriver_role(&wire.role)?,
                nonce: TenantRootOperationNonceV1::from_bytes(decode_base64url_fixed(
                    &wire.nonce_b64u,
                    "operation nonce",
                )?)?,
                manifest_digest: decode_base64url_fixed(
                    &wire.manifest_digest_b64u,
                    "operation manifest digest",
                )?,
                destination_fingerprint: TenantRootRestoreDestinationFingerprintV1::from_bytes(
                    decode_base64url_fixed(
                        &wire.destination_fingerprint_b64u,
                        "operation destination fingerprint",
                    )?,
                )?,
                restore_session_id: TenantRootRestoreSessionIdV1::from_bytes(
                    decode_base64url_fixed(
                        &wire.restore_session_id_b64u,
                        "operation restore session id",
                    )?,
                )?,
                import_key_id: wire.import_key_id,
                generation: wire.generation,
            },
        };
        record.validate()?;
        if record.canonical_json()? != bytes {
            return Err(malformed(
                "tenant root operation record is not canonical JSON",
            ));
        }
        Ok(record)
    }

    fn validate(&self) -> RouterAbDerivationResult<()> {
        require_tenant_root_identifier("operation organization id", &self.org_id)?;
        require_tenant_root_identifier("operation project id", &self.project_id)?;
        require_tenant_root_identifier("operation environment id", &self.env_id)?;
        require_tenant_root_identifier("operation requester actor id", &self.requester_actor_id)?;
        require_tenant_root_identifier("operation idempotency key", &self.idempotency_key)?;
        match (&self.kind, &self.state) {
            (
                TenantRootOperationKindV1::RestoreRoleImportKeyIssue,
                TenantRootOperationRecordStateV1::RestoreRoleImportKeyIssue {
                    manifest_digest,
                    import_key_id,
                    generation,
                    ..
                },
            ) => {
                if !matches!(
                    self.subject,
                    TenantRootOperationSubjectV1::RecoverySet { .. }
                ) {
                    return Err(malformed(
                        "tenant root restore operation subject must be a recovery set",
                    ));
                }
                if self
                    .identity_digest
                    .as_bytes()
                    .iter()
                    .all(|byte| *byte == 0)
                {
                    return Err(malformed(
                        "tenant root restore operation identity digest must be non-zero",
                    ));
                }
                if manifest_digest.iter().all(|byte| *byte == 0) {
                    return Err(malformed(
                        "tenant root restore operation manifest digest must be non-zero",
                    ));
                }
                validate_restore_import_key_id(import_key_id)?;
                if *generation == 0 {
                    return Err(malformed(
                        "tenant root restore operation generation must be positive",
                    ));
                }
            }
            (
                TenantRootOperationKindV1::RestoreRoleImportKeyIssue,
                TenantRootOperationRecordStateV1::ActiveRoot { .. },
            ) => {
                return Err(malformed(
                    "tenant root restore operation has active-root state",
                ));
            }
            (_, TenantRootOperationRecordStateV1::RestoreRoleImportKeyIssue { .. }) => {
                return Err(malformed(
                    "non-restore operation has restore-specific state",
                ));
            }
            (
                kind,
                TenantRootOperationRecordStateV1::ActiveRoot {
                    expected_lifecycle_revision,
                    role,
                    ..
                },
            ) => {
                if *expected_lifecycle_revision == 0 {
                    return Err(malformed(
                        "tenant root operation expected lifecycle revision must be positive",
                    ));
                }
                if !self.subject.kind_matches(kind.required_subject()) {
                    return Err(malformed(
                        "tenant root operation subject does not match its operation kind",
                    ));
                }
                if kind.is_role_local() != role.is_some() {
                    return Err(malformed(
                        "tenant root operation role is present only for role-local operations",
                    ));
                }
            }
        }
        let issued = epoch_millis(&self.issued_at, "operation issued at")?;
        let expires = epoch_millis(&self.expires_at, "operation expires at")?;
        if expires <= issued {
            return Err(malformed("tenant root operation expiry is not after issue"));
        }
        if expires - issued > self.kind.max_lifetime_ms() {
            return Err(malformed(
                "tenant root operation lifetime exceeds the maximum for this operation",
            ));
        }
        Ok(())
    }

    fn to_value(&self) -> Value {
        let mut entries = vec![
            (
                "custodyLineageId",
                Value::String(self.custody_lineage.to_base64url()),
            ),
            ("envId", Value::String(self.env_id.clone())),
            ("expiresAt", Value::String(self.expires_at.clone())),
            (
                "formatVersion",
                Value::String(TENANT_ROOT_OPERATION_RECORD_FORMAT_V1.to_owned()),
            ),
            (
                "idempotencyKey",
                Value::String(self.idempotency_key.clone()),
            ),
            ("issuedAt", Value::String(self.issued_at.clone())),
            (
                "operationKind",
                Value::String(self.kind.as_str().to_owned()),
            ),
            ("orgId", Value::String(self.org_id.clone())),
            ("projectId", Value::String(self.project_id.clone())),
            (
                "requesterActorId",
                Value::String(self.requester_actor_id.clone()),
            ),
            ("subject", self.subject.to_value()),
            (
                "tenantRootIdentityDigest",
                Value::String(encode_base64url(self.identity_digest.as_bytes())),
            ),
        ];
        match &self.state {
            TenantRootOperationRecordStateV1::ActiveRoot {
                expected_lifecycle_revision,
                governance_digest,
                role,
                expected_root_commitment,
            } => {
                entries.push((
                    "expectedLifecycleRevision",
                    Value::Number((*expected_lifecycle_revision).into()),
                ));
                entries.push((
                    "expectedRootCommitment",
                    Value::String(encode_base64url(&expected_root_commitment.to_bytes())),
                ));
                entries.push((
                    "recoveryGovernanceDigest",
                    Value::String(encode_base64url(governance_digest)),
                ));
                if let Some(role) = role {
                    entries.push(("role", Value::String(role.as_str().to_owned())));
                }
            }
            TenantRootOperationRecordStateV1::RestoreRoleImportKeyIssue {
                role,
                nonce,
                manifest_digest,
                destination_fingerprint,
                restore_session_id,
                import_key_id,
                generation,
            } => {
                entries.push((
                    "destinationFingerprintB64u",
                    Value::String(encode_base64url(destination_fingerprint.as_bytes())),
                ));
                entries.push(("generation", Value::Number((*generation).into())));
                entries.push(("importKeyId", Value::String(import_key_id.clone())));
                entries.push((
                    "manifestDigestB64u",
                    Value::String(encode_base64url(manifest_digest)),
                ));
                entries.push((
                    "nonceB64u",
                    Value::String(encode_base64url(nonce.as_bytes())),
                ));
                entries.push(("role", Value::String(role.as_str().to_owned())));
                entries.push((
                    "restoreSessionIdB64u",
                    Value::String(encode_base64url(restore_session_id.as_bytes())),
                ));
            }
        }
        json_object(entries)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OperationSubjectWire {
    kind: String,
    #[serde(default)]
    recipient_pair_digest: Option<String>,
    #[serde(default)]
    recovery_set_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OperationRecordWire {
    custody_lineage_id: String,
    env_id: String,
    expected_lifecycle_revision: u64,
    expected_root_commitment: String,
    expires_at: String,
    format_version: String,
    idempotency_key: String,
    issued_at: String,
    operation_kind: String,
    org_id: String,
    project_id: String,
    recovery_governance_digest: String,
    requester_actor_id: String,
    #[serde(default)]
    role: Option<String>,
    subject: OperationSubjectWire,
    tenant_root_identity_digest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RestoreOperationRecordWire {
    custody_lineage_id: String,
    destination_fingerprint_b64u: String,
    env_id: String,
    expires_at: String,
    format_version: String,
    generation: u64,
    idempotency_key: String,
    import_key_id: String,
    issued_at: String,
    manifest_digest_b64u: String,
    nonce_b64u: String,
    operation_kind: String,
    org_id: String,
    project_id: String,
    requester_actor_id: String,
    role: String,
    restore_session_id_b64u: String,
    subject: OperationSubjectWire,
    tenant_root_identity_digest: String,
}

fn parse_operation_subject(
    wire: OperationSubjectWire,
) -> RouterAbDerivationResult<TenantRootOperationSubjectV1> {
    match wire.kind.as_str() {
        "tenant_root" => {
            if wire.recovery_set_id.is_some() || wire.recipient_pair_digest.is_some() {
                return Err(malformed(
                    "tenant root operation subject carries fields for another branch",
                ));
            }
            Ok(TenantRootOperationSubjectV1::TenantRoot)
        }
        "recovery_set" => {
            let id = wire.recovery_set_id.as_deref().ok_or_else(|| {
                malformed("tenant root operation recovery-set subject is missing its id")
            })?;
            if wire.recipient_pair_digest.is_some() {
                return Err(malformed(
                    "tenant root operation subject carries fields for another branch",
                ));
            }
            Ok(TenantRootOperationSubjectV1::RecoverySet {
                recovery_set_id: TenantRootRecoverySetId::from_base64url(id)?,
            })
        }
        "recipient_pair" => {
            let digest = wire.recipient_pair_digest.as_deref().ok_or_else(|| {
                malformed("tenant root operation recipient-pair subject is missing its digest")
            })?;
            if wire.recovery_set_id.is_some() {
                return Err(malformed(
                    "tenant root operation subject carries fields for another branch",
                ));
            }
            Ok(TenantRootOperationSubjectV1::RecipientPair {
                recipient_pair_digest: decode_base64url_fixed(
                    digest,
                    "operation recipient pair digest",
                )?,
            })
        }
        _ => Err(malformed("tenant root operation subject kind is invalid")),
    }
}

fn validate_restore_import_key_id(value: &str) -> RouterAbDerivationResult<()> {
    require_tenant_root_identifier("tenant root restore operation import key id", value)?;
    if value.len() > 128 || value.bytes().any(|byte| byte == b' ') {
        return Err(malformed(
            "tenant root restore operation import key id is invalid",
        ));
    }
    Ok(())
}

fn parse_deriver_role(value: &str) -> RouterAbDerivationResult<TwoPartyDeriverRole> {
    match value {
        "deriver_a" => Ok(TwoPartyDeriverRole::DeriverA),
        "deriver_b" => Ok(TwoPartyDeriverRole::DeriverB),
        _ => Err(malformed("tenant root operation role is invalid")),
    }
}

/// Server-issued proof that one actor completed high-assurance step-up.
///
/// The console signs this once at its authentication boundary. Core services
/// never accept an MFA boolean from a request body, so this type is the only
/// way step-up enters an authorization decision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootStepUpEvidenceV1 {
    actor_id: String,
    session_id: String,
    method: String,
    verified_at: String,
    issuer_key_id: String,
    signature: [u8; 64],
}

impl TenantRootStepUpEvidenceV1 {
    /// Signs one step-up evidence record at the console authentication boundary.
    pub fn issue(
        actor_id: impl Into<String>,
        session_id: impl Into<String>,
        method: impl Into<String>,
        verified_at: impl Into<String>,
        issuer_key_id: impl Into<String>,
        issuer_signing_key_bytes: &[u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        let mut evidence = Self {
            actor_id: actor_id.into(),
            session_id: session_id.into(),
            method: method.into(),
            verified_at: verified_at.into(),
            issuer_key_id: issuer_key_id.into(),
            signature: [0_u8; 64],
        };
        evidence.validate_shape()?;
        evidence.signature = SigningKey::from_bytes(issuer_signing_key_bytes)
            .sign(&evidence.signature_input())
            .to_bytes();
        Ok(evidence)
    }

    /// Returns the stepped-up actor.
    pub fn actor_id(&self) -> &str {
        &self.actor_id
    }

    /// Returns the console session the step-up belongs to.
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Returns the step-up method.
    pub fn method(&self) -> &str {
        &self.method
    }

    /// Returns when step-up completed.
    pub fn verified_at(&self) -> &str {
        &self.verified_at
    }

    /// Verifies the issuer signature and the freshness bound.
    pub fn verify(
        &self,
        issuer_verifying_key: &[u8; 32],
        now: &str,
        max_age_ms: i64,
    ) -> RouterAbDerivationResult<()> {
        self.validate_shape()?;
        verify_detached(
            issuer_verifying_key,
            &self.signature_input(),
            &self.signature,
            "tenant root step-up evidence signature verification failed",
        )?;
        let verified = epoch_millis(&self.verified_at, "step-up verified at")?;
        let now_ms = epoch_millis(now, "authorization time")?;
        require_not_in_the_future(verified, now_ms, "tenant root step-up evidence")?;
        if now_ms.saturating_sub(verified) > max_age_ms {
            return Err(verification_failed(
                "tenant root step-up evidence is older than the freshness bound",
            ));
        }
        Ok(())
    }

    fn validate_shape(&self) -> RouterAbDerivationResult<()> {
        require_tenant_root_identifier("step-up actor id", &self.actor_id)?;
        require_tenant_root_identifier("step-up session id", &self.session_id)?;
        require_tenant_root_identifier("step-up method", &self.method)?;
        require_tenant_root_identifier("step-up issuer key id", &self.issuer_key_id)?;
        validate_rfc3339_millis(&self.verified_at, "step-up verified at")?;
        epoch_millis(&self.verified_at, "step-up verified at")?;
        Ok(())
    }

    fn signature_input(&self) -> Vec<u8> {
        let mut input = Vec::new();
        input.extend_from_slice(TENANT_ROOT_STEP_UP_DOMAIN_V1);
        push_text(&mut input, &self.actor_id);
        push_text(&mut input, &self.session_id);
        push_text(&mut input, &self.method);
        push_text(&mut input, &self.verified_at);
        push_text(&mut input, &self.issuer_key_id);
        input
    }
}

/// A one-use console capability authorizing exactly one operation record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootOperationCapabilityV1 {
    digest: TenantRootOperationDigestV1,
    nonce: TenantRootOperationNonceV1,
    issuer_key_id: String,
    issued_at: String,
    expires_at: String,
    signature: [u8; 64],
}

impl TenantRootOperationCapabilityV1 {
    /// Signs one capability over an exact operation digest.
    pub fn issue(
        digest: TenantRootOperationDigestV1,
        nonce: TenantRootOperationNonceV1,
        issuer_key_id: impl Into<String>,
        issued_at: impl Into<String>,
        expires_at: impl Into<String>,
        issuer_signing_key_bytes: &[u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        let mut capability = Self {
            digest,
            nonce,
            issuer_key_id: issuer_key_id.into(),
            issued_at: issued_at.into(),
            expires_at: expires_at.into(),
            signature: [0_u8; 64],
        };
        capability.validate_shape()?;
        capability.signature = SigningKey::from_bytes(issuer_signing_key_bytes)
            .sign(&capability.signature_input())
            .to_bytes();
        Ok(capability)
    }

    /// Returns the authorized operation digest.
    pub const fn digest(&self) -> TenantRootOperationDigestV1 {
        self.digest
    }

    /// Returns the one-use nonce the control plane consumes.
    pub const fn nonce(&self) -> TenantRootOperationNonceV1 {
        self.nonce
    }

    /// Returns the issuing key identifier.
    pub fn issuer_key_id(&self) -> &str {
        &self.issuer_key_id
    }

    /// Returns the capability expiry.
    pub fn expires_at(&self) -> &str {
        &self.expires_at
    }

    /// Verifies the issuer signature and that the capability is live.
    pub fn verify(
        &self,
        issuer_verifying_key: &[u8; 32],
        now: &str,
    ) -> RouterAbDerivationResult<()> {
        self.validate_shape()?;
        verify_detached(
            issuer_verifying_key,
            &self.signature_input(),
            &self.signature,
            "tenant root operation capability signature verification failed",
        )?;
        let issued = epoch_millis(&self.issued_at, "capability issued at")?;
        let expires = epoch_millis(&self.expires_at, "capability expires at")?;
        let now_ms = epoch_millis(now, "authorization time")?;
        require_not_in_the_future(issued, now_ms, "tenant root operation capability")?;
        if now_ms.saturating_sub(TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1 as i64) >= expires {
            return Err(verification_failed(
                "tenant root operation capability has expired",
            ));
        }
        Ok(())
    }

    fn validate_shape(&self) -> RouterAbDerivationResult<()> {
        require_tenant_root_identifier("capability issuer key id", &self.issuer_key_id)?;
        validate_rfc3339_millis(&self.issued_at, "capability issued at")?;
        validate_rfc3339_millis(&self.expires_at, "capability expires at")?;
        let issued = epoch_millis(&self.issued_at, "capability issued at")?;
        let expires = epoch_millis(&self.expires_at, "capability expires at")?;
        if expires <= issued {
            return Err(malformed(
                "tenant root operation capability expiry is not after issue",
            ));
        }
        Ok(())
    }

    fn signature_input(&self) -> Vec<u8> {
        let mut input = Vec::new();
        input.extend_from_slice(TENANT_ROOT_OPERATION_DOMAIN_V1);
        input.extend_from_slice(self.digest.as_bytes());
        input.extend_from_slice(self.nonce.as_bytes());
        push_text(&mut input, &self.issuer_key_id);
        push_text(&mut input, &self.issued_at);
        push_text(&mut input, &self.expires_at);
        input
    }
}

/// One second owner's approval of an exact operation digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootOperationApprovalV1 {
    digest: TenantRootOperationDigestV1,
    approver: TenantRootStepUpEvidenceV1,
    approved_at: String,
    issuer_key_id: String,
    signature: [u8; 64],
}

impl TenantRootOperationApprovalV1 {
    /// Signs one approval binding a second owner to an exact operation digest.
    pub fn issue(
        digest: TenantRootOperationDigestV1,
        approver: TenantRootStepUpEvidenceV1,
        approved_at: impl Into<String>,
        issuer_key_id: impl Into<String>,
        issuer_signing_key_bytes: &[u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        let mut approval = Self {
            digest,
            approver,
            approved_at: approved_at.into(),
            issuer_key_id: issuer_key_id.into(),
            signature: [0_u8; 64],
        };
        approval.validate_shape()?;
        approval.signature = SigningKey::from_bytes(issuer_signing_key_bytes)
            .sign(&approval.signature_input())
            .to_bytes();
        Ok(approval)
    }

    /// Returns the approved operation digest.
    pub const fn digest(&self) -> TenantRootOperationDigestV1 {
        self.digest
    }

    /// Returns the approving owner's step-up evidence.
    pub const fn approver(&self) -> &TenantRootStepUpEvidenceV1 {
        &self.approver
    }

    /// Returns when the approval was recorded.
    pub fn approved_at(&self) -> &str {
        &self.approved_at
    }

    fn verify(
        &self,
        issuer_verifying_key: &[u8; 32],
        now: &str,
        max_age_ms: i64,
    ) -> RouterAbDerivationResult<()> {
        self.validate_shape()?;
        verify_detached(
            issuer_verifying_key,
            &self.signature_input(),
            &self.signature,
            "tenant root operation approval signature verification failed",
        )?;
        let approved = epoch_millis(&self.approved_at, "approval approved at")?;
        let now_ms = epoch_millis(now, "authorization time")?;
        require_not_in_the_future(approved, now_ms, "tenant root operation approval")?;
        if now_ms.saturating_sub(approved) > max_age_ms {
            return Err(verification_failed(
                "tenant root operation approval has expired",
            ));
        }
        Ok(())
    }

    fn validate_shape(&self) -> RouterAbDerivationResult<()> {
        self.approver.validate_shape()?;
        require_tenant_root_identifier("approval issuer key id", &self.issuer_key_id)?;
        validate_rfc3339_millis(&self.approved_at, "approval approved at")?;
        epoch_millis(&self.approved_at, "approval approved at")?;
        Ok(())
    }

    fn signature_input(&self) -> Vec<u8> {
        let mut input = Vec::new();
        input.extend_from_slice(TENANT_ROOT_APPROVAL_DOMAIN_V1);
        input.extend_from_slice(self.digest.as_bytes());
        push_text(&mut input, self.approver.actor_id());
        push_text(&mut input, self.approver.session_id());
        push_text(&mut input, &self.approved_at);
        push_text(&mut input, &self.issuer_key_id);
        input
    }
}

/// The console signing keys an authorization decision trusts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TenantRootOperationIssuerKeysV1 {
    /// Key that signs operation capabilities.
    pub capability: [u8; 32],
    /// Key that signs step-up evidence.
    pub step_up: [u8; 32],
    /// Key that signs second-owner approvals.
    pub approval: [u8; 32],
}

/// One authorized operation, ready for exactly one transactional consumption.
///
/// There is no public constructor and the type is neither `Clone` nor `Copy`:
/// the only way to hold one is to have passed the checks that produce it.
pub struct AuthorizedTenantRootOperationV1 {
    digest: TenantRootOperationDigestV1,
    kind: TenantRootOperationKindV1,
    nonce: TenantRootOperationNonceV1,
    expected_lifecycle_revision: u64,
    requester_actor_id: String,
    approver_actor_id: Option<String>,
}

impl fmt::Debug for AuthorizedTenantRootOperationV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AuthorizedTenantRootOperationV1")
            .field("digest", &self.digest)
            .field("kind", &self.kind)
            .field(
                "expected_lifecycle_revision",
                &self.expected_lifecycle_revision,
            )
            .field("requester_actor_id", &self.requester_actor_id)
            .field("approver_actor_id", &self.approver_actor_id)
            .finish()
    }
}

impl AuthorizedTenantRootOperationV1 {
    /// Returns the authorized operation digest.
    pub const fn digest(&self) -> TenantRootOperationDigestV1 {
        self.digest
    }

    /// Returns the authorized operation kind.
    pub const fn kind(&self) -> TenantRootOperationKindV1 {
        self.kind
    }

    /// Returns the one-use nonce this authorization consumes.
    pub const fn nonce(&self) -> TenantRootOperationNonceV1 {
        self.nonce
    }

    /// Returns the lifecycle revision this authorization is fenced to.
    pub const fn expected_lifecycle_revision(&self) -> u64 {
        self.expected_lifecycle_revision
    }

    /// Returns the requesting actor.
    pub fn requester_actor_id(&self) -> &str {
        &self.requester_actor_id
    }

    /// Returns the approving actor, when the operation required a second owner.
    pub fn approver_actor_id(&self) -> Option<&str> {
        self.approver_actor_id.as_deref()
    }
}

/// Authorizes one tenant-root console operation.
///
/// The capability must cover this exact record, the requester's step-up must be
/// fresh and belong to the requester, and a governance-following operation
/// under two-person governance must carry an approval from a *different* owner
/// for this same digest. Everything else is refused.
pub fn authorize_tenant_root_operation_v1(
    record: &TenantRootOperationRecordV1,
    capability: &TenantRootOperationCapabilityV1,
    requester_step_up: &TenantRootStepUpEvidenceV1,
    approval: Option<&TenantRootOperationApprovalV1>,
    governance: &TenantRootRecoveryGovernanceV1,
    issuer_keys: &TenantRootOperationIssuerKeysV1,
    now: &str,
) -> RouterAbDerivationResult<AuthorizedTenantRootOperationV1> {
    let (expected_lifecycle_revision, governance_digest) = match &record.state {
        TenantRootOperationRecordStateV1::ActiveRoot {
            expected_lifecycle_revision,
            governance_digest,
            ..
        } => (*expected_lifecycle_revision, governance_digest),
        TenantRootOperationRecordStateV1::RestoreRoleImportKeyIssue { .. } => {
            return Err(verification_failed(
                "restore role-import key issue requires destination restore authorization",
            ));
        }
    };
    let digest = record.digest()?;
    if governance.digest()? != *governance_digest {
        return Err(verification_failed(
            "tenant root operation was issued under a different recovery governance policy",
        ));
    }
    if capability.digest != digest {
        return Err(verification_failed(
            "tenant root operation capability does not cover this operation record",
        ));
    }
    capability.verify(&issuer_keys.capability, now)?;

    let now_ms = epoch_millis(now, "authorization time")?;
    let record_expires = epoch_millis(&record.expires_at, "operation expires at")?;
    if now_ms.saturating_sub(TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1 as i64) >= record_expires {
        return Err(verification_failed("tenant root operation has expired"));
    }

    requester_step_up.verify(&issuer_keys.step_up, now, TENANT_ROOT_STEP_UP_MAX_AGE_MS_V1)?;
    if requester_step_up.actor_id() != record.requester_actor_id {
        return Err(verification_failed(
            "tenant root operation step-up belongs to a different actor",
        ));
    }

    let approver_actor_id = match (
        record.kind.follows_recovery_governance() && governance.requires_second_owner(),
        approval,
    ) {
        (true, Some(approval)) => {
            if approval.digest != digest {
                return Err(verification_failed(
                    "tenant root operation approval covers a different operation",
                ));
            }
            approval.verify(
                &issuer_keys.approval,
                now,
                TENANT_ROOT_OPERATION_MAX_LIFETIME_MS_V1,
            )?;
            approval.approver.verify(
                &issuer_keys.step_up,
                now,
                TENANT_ROOT_STEP_UP_MAX_AGE_MS_V1,
            )?;
            if approval.approver.actor_id() == record.requester_actor_id {
                return Err(verification_failed(
                    "tenant root operation approver cannot be its requester",
                ));
            }
            Some(approval.approver.actor_id().to_owned())
        }
        (true, None) => {
            return Err(verification_failed(
                "tenant root operation requires a second owner's approval",
            ))
        }
        (false, Some(_)) => {
            return Err(verification_failed(
                "tenant root operation carries an approval it does not use",
            ))
        }
        (false, None) => None,
    };

    Ok(AuthorizedTenantRootOperationV1 {
        digest,
        kind: record.kind,
        nonce: capability.nonce,
        expected_lifecycle_revision,
        requester_actor_id: record.requester_actor_id.clone(),
        approver_actor_id,
    })
}

fn require_not_in_the_future(
    value_ms: i64,
    now_ms: i64,
    subject: &'static str,
) -> RouterAbDerivationResult<()> {
    if value_ms.saturating_sub(now_ms) > TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1 as i64 {
        return Err(verification_failed_owned(format!(
            "{subject} is dated further ahead than the permitted clock skew"
        )));
    }
    Ok(())
}

fn verify_detached(
    verifying_key_bytes: &[u8; 32],
    input: &[u8],
    signature: &[u8; 64],
    message: &'static str,
) -> RouterAbDerivationResult<()> {
    if signature == &[0_u8; 64] {
        return Err(malformed("tenant root authorization signature is empty"));
    }
    let verifying_key = VerifyingKey::from_bytes(verifying_key_bytes)
        .map_err(|_| malformed("tenant root authorization verifying key is invalid"))?;
    verifying_key
        .verify_strict(input, &Signature::from_bytes(signature))
        .map_err(|_| verification_failed(message))
}

fn verification_failed_owned(message: String) -> super::RouterAbDerivationError {
    super::RouterAbDerivationError::new(
        super::RouterAbDerivationErrorCode::OutputVerificationFailed,
        message,
    )
}

/// Length-prefixes one text field so concatenated inputs stay unambiguous.
fn push_text(input: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    input.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    input.extend_from_slice(bytes);
}
