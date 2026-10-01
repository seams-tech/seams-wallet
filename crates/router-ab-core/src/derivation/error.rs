use core::fmt;

use serde::{Deserialize, Serialize};

/// Stable error codes for fixed ECDSA threshold-PRF derivation failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouterAbDerivationErrorCode {
    /// A required field was empty.
    EmptyField,
    /// A vector or transcript field is malformed.
    MalformedInput,
    /// A protocol or evidence version is unsupported.
    UnsupportedVersion,
    /// Signer A and Signer B used the same identity.
    DuplicateSignerIdentity,
    /// A signer identity did not match the transcript.
    SignerIdentityMismatch,
    /// A root-share epoch did not match the transcript.
    RootEpochMismatch,
    /// A transcript digest did not match the expected value.
    TranscriptMismatch,
    /// A recipient role or identity did not match the expected value.
    RecipientMismatch,
    /// A replay key was reused with a different transcript value.
    ReplayMismatch,
    /// Threshold-PRF proof or output verification failed.
    OutputVerificationFailed,
    /// A code path attempted to expose secret material.
    SecretMaterialExposure,
    /// One authenticated tenant identity and role has no active root binding.
    MissingActiveTenantRootBinding,
    /// One authenticated tenant identity and role has more than one active binding.
    AmbiguousActiveTenantRootBinding,
    /// One authenticated tenant's active roles do not form one physical root pair.
    MismatchedActiveTenantRootPair,
}

/// Error type used by this crate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouterAbDerivationError {
    code: RouterAbDerivationErrorCode,
    message: String,
}

impl RouterAbDerivationError {
    /// Creates a new structured error.
    pub fn new(code: RouterAbDerivationErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// Returns the stable error code.
    pub fn code(&self) -> RouterAbDerivationErrorCode {
        self.code
    }

    /// Returns a human-readable diagnostic message.
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for RouterAbDerivationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for RouterAbDerivationError {}

/// Result alias used by this crate.
pub type RouterAbDerivationResult<T> = Result<T, RouterAbDerivationError>;

/// Rejects an empty `value`, naming `field` in the error.
pub(super) fn require_non_empty(field: &'static str, value: &str) -> RouterAbDerivationResult<()> {
    if value.is_empty() {
        return Err(RouterAbDerivationError::new(
            RouterAbDerivationErrorCode::EmptyField,
            format!("{field} is required"),
        ));
    }
    Ok(())
}
