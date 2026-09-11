#![forbid(unsafe_code)]
#![deny(missing_docs)]
//! Native secret core shared by the `seams derivation-root` commands.
//!
//! Everything that touches a recovery private key lives here so the CLI, and
//! any later adapter, share one implementation rather than parallel ones. The
//! crate holds no networking and no filesystem policy beyond the durability
//! primitives the recovery commands need.

mod artifacts;
mod durable_file;
mod host_capabilities;
mod key_file;
mod pinned_trust;
mod recipient_proof;
mod release_trust;

pub use self::artifacts::{
    check_role_backup_decryption_v1, open_and_reseal_role_share_v1, verify_role_package_offline_v1,
    ResealedRoleImportV1, RestoreDestinationBindingV1, VerifiedRolePackageReportV1,
};
pub use self::durable_file::{
    read_capped_file_v1, write_new_file_durably_v1, DurableWriteOutcomeV1, RECOVERY_FILE_MODE_V1,
};
pub use self::host_capabilities::RecoveryHostSecretCapabilitiesV1;
pub use self::key_file::{
    require_distinct_role_key_files_v1, RecoveryKeyFileV1, TenantRootRecoveryKeyMaterialV1,
    RECOVERY_KEY_FILE_MAGIC_V1, RECOVERY_KEY_FILE_MAX_BYTES,
};
pub use self::pinned_trust::require_trust_bundle_continues_pinned_root_v1;
pub use self::recipient_proof::{
    prove_recovery_recipient_control_from_bytes_v1, prove_recovery_recipient_control_v1,
    RecipientProofResultV1, RECOVERY_RECIPIENT_CHALLENGE_MAX_BYTES,
};
pub use self::release_trust::{
    ReleaseArtifactEntryV1, ReleaseChecksumManifestV1, ReleaseTrustRootV1,
    RELEASE_MANIFEST_MAX_BYTES_V1, RELEASE_MANIFEST_MAX_ENTRIES_V1,
};

/// Errors raised by the native recovery core.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryCoreError {
    code: RecoveryCoreErrorCode,
    message: String,
}

impl RecoveryCoreError {
    /// Creates one error in a stable category.
    pub fn new(code: RecoveryCoreErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// Returns the stable machine-readable code.
    pub const fn code(&self) -> RecoveryCoreErrorCode {
        self.code
    }

    /// Returns the redacted operator-facing message.
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl core::fmt::Display for RecoveryCoreError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(formatter, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for RecoveryCoreError {}

/// Stable error categories, aligned with the CLI's documented exit codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryCoreErrorCode {
    /// Local input was malformed or unusable.
    InvalidLocalInput,
    /// An artifact, signature, manifest, or trust check failed.
    ArtifactVerificationFailed,
    /// A local key provider or decryption step failed.
    KeyProviderFailure,
    /// A local filesystem safety or durability check failed.
    FilesystemDurabilityFailure,
    /// Authentication, step-up, approval, or capability failure.
    AuthorizationFailure,
    /// A retryable network or service failure.
    RetryableServiceFailure,
}

impl RecoveryCoreErrorCode {
    /// Returns the stable wire label.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidLocalInput => "invalid_local_input",
            Self::ArtifactVerificationFailed => "artifact_verification_failed",
            Self::KeyProviderFailure => "key_provider_failure",
            Self::FilesystemDurabilityFailure => "filesystem_durability_failure",
            Self::AuthorizationFailure => "authorization_failure",
            Self::RetryableServiceFailure => "retryable_service_failure",
        }
    }

    /// Returns the CLI exit code for this category.
    pub const fn exit_code(self) -> i32 {
        match self {
            Self::InvalidLocalInput => 2,
            Self::ArtifactVerificationFailed => 4,
            Self::KeyProviderFailure => 5,
            Self::FilesystemDurabilityFailure => 8,
            Self::AuthorizationFailure => 3,
            Self::RetryableServiceFailure => 7,
        }
    }
}

/// Result alias for the native recovery core.
pub type RecoveryCoreResult<T> = Result<T, RecoveryCoreError>;
