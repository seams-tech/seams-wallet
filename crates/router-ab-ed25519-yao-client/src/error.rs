use core::fmt;

/// Client activation preparation or completion failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientActivationError {
    /// Entropy was zero or reused across distinct purposes.
    InvalidEntropy,
    /// Admission, application facts, or participants did not share one stable binding.
    BindingMismatch,
    /// Client contribution derivation failed.
    DerivationFailed,
    /// HPKE key derivation, sealing, or opening failed.
    HpkeFailed,
    /// A role input could not be encoded.
    EncodingFailed,
    /// A typed Router request or result was inconsistent.
    InvalidProtocolShape,
    /// Recipient package decoding or scalar combination failed.
    InvalidRecipientPackage,
    /// Public activation evidence did not match the opened Client share.
    PublicRelationMismatch,
    /// Recovery or export produced a public key different from the registered identity.
    PublicKeyContinuityMismatch,
    /// The completion checkpoint failed authentication or version validation.
    InvalidCheckpoint,
}

impl fmt::Display for ClientActivationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidEntropy => "Ed25519 Yao Client entropy is invalid",
            Self::BindingMismatch => "Ed25519 Yao registration binding does not match Client facts",
            Self::DerivationFailed => "Ed25519 Yao Client contribution derivation failed",
            Self::HpkeFailed => "Ed25519 Yao Client HPKE operation failed",
            Self::EncodingFailed => "Ed25519 Yao Client role input encoding failed",
            Self::InvalidProtocolShape => "Ed25519 Yao Router protocol shape is invalid",
            Self::InvalidRecipientPackage => "Ed25519 Yao Client package is invalid",
            Self::PublicRelationMismatch => "Ed25519 Yao activation public relation is invalid",
            Self::PublicKeyContinuityMismatch => "Ed25519 Yao public-key continuity check failed",
            Self::InvalidCheckpoint => "Ed25519 Yao activation checkpoint is invalid",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for ClientActivationError {}
