use serde::{de::Error as DeError, Deserialize, Deserializer, Serialize};
use threshold_prf::PrfPurpose;

use crate::derivation::{
    StableTenantDerivationContextV2, TenantRootCustodyBindingV1, TenantRootDerivationNonceV1,
    TenantRootProtocolDigestV1, TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1, TENANT_ROOT_MAX_LIFETIME_MS_V1,
};
use crate::protocol::envelope::RoleEncryptedEnvelopeV1;
use crate::protocol::error::{
    RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult,
};

/// Fixed version for the stable tenant-root ECDSA request boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EcdsaThresholdPrfRequestVersionV2 {
    /// The stable tenant-root request shape.
    V2,
}

/// Fixed ECDSA threshold-PRF purpose accepted by the V2 request boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EcdsaThresholdPrfPurposeV2 {
    /// Client-owned base output.
    XClientBase,
    /// Server-owned base output.
    XServerBase,
    /// Server-owned ECDSA derivation input.
    YServer,
}

impl EcdsaThresholdPrfPurposeV2 {
    /// Returns the exact threshold-PRF purpose selected by this request.
    pub const fn threshold_prf_purpose(self) -> PrfPurpose {
        match self {
            Self::XClientBase => PrfPurpose::RouterAbXClientBaseV1,
            Self::XServerBase => PrfPurpose::RouterAbXServerBaseV1,
            Self::YServer => PrfPurpose::RouterAbEcdsaDerivationYServer,
        }
    }
}

/// Validated request data consumed after the role-encrypted boundary.
///
/// The stable context is the only threshold-PRF input. Custody is represented
/// by its authenticated digest and is supplied again by the server-side
/// custody lookup; no caller-selected role, identity, lineage, or epoch is
/// carried by this shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EcdsaThresholdPrfPrivateRequestV2 {
    version: EcdsaThresholdPrfRequestVersionV2,
    stable_context: StableTenantDerivationContextV2,
    custody_binding_digest: TenantRootProtocolDigestV1,
    purpose: EcdsaThresholdPrfPurposeV2,
}

impl EcdsaThresholdPrfPrivateRequestV2 {
    /// Creates one exact validated private request.
    pub fn new(
        stable_context: StableTenantDerivationContextV2,
        custody_binding_digest: TenantRootProtocolDigestV1,
        purpose: EcdsaThresholdPrfPurposeV2,
    ) -> RouterAbProtocolResult<Self> {
        let request = Self {
            version: EcdsaThresholdPrfRequestVersionV2::V2,
            stable_context,
            custody_binding_digest,
            purpose,
        };
        request.validate()?;
        Ok(request)
    }

    /// Validates the exact stable request fields.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        if self.version != EcdsaThresholdPrfRequestVersionV2::V2 {
            return Err(malformed("unsupported ECDSA threshold-PRF V2 version"));
        }
        let stable_digest = self.stable_context.digest().map_err(map_derivation_error)?;
        if stable_digest.as_bytes().iter().all(|byte| *byte == 0) {
            return Err(malformed(
                "ECDSA threshold-PRF stable context digest must be non-zero",
            ));
        }
        if self
            .custody_binding_digest
            .as_bytes()
            .iter()
            .all(|byte| *byte == 0)
        {
            return Err(malformed(
                "ECDSA threshold-PRF custody binding digest must be non-zero",
            ));
        }
        let _ = self.purpose.threshold_prf_purpose();
        Ok(())
    }

    /// Validates this request against the independently authenticated custody record.
    pub fn validate_for_custody(
        &self,
        custody_binding: &TenantRootCustodyBindingV1,
        now_ms: u64,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        custody_binding
            .validate_at(now_ms)
            .map_err(map_derivation_error)?;
        if self.custody_binding_digest != custody_binding.digest().map_err(map_derivation_error)? {
            return Err(malformed(
                "ECDSA threshold-PRF private request custody binding digest does not match",
            ));
        }
        if self.stable_context.digest().map_err(map_derivation_error)?
            != custody_binding.stable_context_digest()
        {
            return Err(malformed(
                "ECDSA threshold-PRF private request stable context does not match custody",
            ));
        }
        Ok(())
    }

    /// Returns the stable context consumed by threshold-PRF.
    pub const fn stable_context(&self) -> &StableTenantDerivationContextV2 {
        &self.stable_context
    }

    /// Returns the authenticated custody binding digest.
    pub const fn custody_binding_digest(&self) -> TenantRootProtocolDigestV1 {
        self.custody_binding_digest
    }

    /// Returns the fixed threshold-PRF purpose.
    pub const fn purpose(&self) -> EcdsaThresholdPrfPurposeV2 {
        self.purpose
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawEcdsaThresholdPrfPrivateRequestV2 {
    version: EcdsaThresholdPrfRequestVersionV2,
    stable_context: StableTenantDerivationContextV2,
    custody_binding_digest: TenantRootProtocolDigestV1,
    purpose: EcdsaThresholdPrfPurposeV2,
}

impl<'de> Deserialize<'de> for EcdsaThresholdPrfPrivateRequestV2 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawEcdsaThresholdPrfPrivateRequestV2::deserialize(deserializer)?;
        if raw.version != EcdsaThresholdPrfRequestVersionV2::V2 {
            return Err(D::Error::custom(
                "unsupported ECDSA threshold-PRF private request version",
            ));
        }
        Self::new(raw.stable_context, raw.custody_binding_digest, raw.purpose)
            .map_err(D::Error::custom)
    }
}

/// Validated public transport wrapper for one stable ECDSA request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EcdsaThresholdPrfOuterRequestV2 {
    version: EcdsaThresholdPrfRequestVersionV2,
    request_nonce: TenantRootDerivationNonceV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
    private_request: EcdsaThresholdPrfPrivateRequestV2,
    signer_a_envelope: RoleEncryptedEnvelopeV1,
    signer_b_envelope: RoleEncryptedEnvelopeV1,
}

impl EcdsaThresholdPrfOuterRequestV2 {
    /// Creates one exact validated outer request.
    pub fn new(
        request_nonce: TenantRootDerivationNonceV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
        private_request: EcdsaThresholdPrfPrivateRequestV2,
        signer_a_envelope: RoleEncryptedEnvelopeV1,
        signer_b_envelope: RoleEncryptedEnvelopeV1,
    ) -> RouterAbProtocolResult<Self> {
        let request = Self {
            version: EcdsaThresholdPrfRequestVersionV2::V2,
            request_nonce,
            issued_at_ms,
            expires_at_ms,
            private_request,
            signer_a_envelope,
            signer_b_envelope,
        };
        request.validate()?;
        Ok(request)
    }

    /// Validates version, custody-independent metadata, and fixed role envelopes.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        if self.version != EcdsaThresholdPrfRequestVersionV2::V2 {
            return Err(malformed(
                "unsupported ECDSA threshold-PRF outer request version",
            ));
        }
        self.private_request.validate()?;
        if self.issued_at_ms == 0
            || self.expires_at_ms <= self.issued_at_ms
            || self.expires_at_ms - self.issued_at_ms > TENANT_ROOT_MAX_LIFETIME_MS_V1
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "ECDSA threshold-PRF V2 outer request lifetime is invalid",
            ));
        }
        self.signer_a_envelope.validate()?;
        self.signer_b_envelope.validate()?;
        if self.signer_a_envelope.recipient_role != crate::derivation::Role::SignerA {
            return Err(malformed(
                "ECDSA threshold-PRF V2 first envelope must target Signer A",
            ));
        }
        if self.signer_b_envelope.recipient_role != crate::derivation::Role::SignerB {
            return Err(malformed(
                "ECDSA threshold-PRF V2 second envelope must target Signer B",
            ));
        }
        Ok(())
    }

    /// Validates the request lifetime against one wall clock.
    pub fn validate_at(&self, now_ms: u64) -> RouterAbProtocolResult<()> {
        self.validate()?;
        if self.issued_at_ms > now_ms.saturating_add(TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1)
            || now_ms
                > self
                    .expires_at_ms
                    .saturating_add(TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1)
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ExpiredLocalRequest,
                "ECDSA threshold-PRF V2 outer request is outside its clock window",
            ));
        }
        Ok(())
    }

    /// Validates the outer request against the server-authenticated custody record.
    pub fn validate_for_custody(
        &self,
        custody_binding: &TenantRootCustodyBindingV1,
        now_ms: u64,
    ) -> RouterAbProtocolResult<()> {
        self.validate_at(now_ms)?;
        self.private_request
            .validate_for_custody(custody_binding, now_ms)
    }

    /// Returns the private request after the outer boundary has been validated.
    pub const fn private_request(&self) -> &EcdsaThresholdPrfPrivateRequestV2 {
        &self.private_request
    }

    /// Returns the role-A encrypted envelope.
    pub const fn signer_a_envelope(&self) -> &RoleEncryptedEnvelopeV1 {
        &self.signer_a_envelope
    }

    /// Returns the role-B encrypted envelope.
    pub const fn signer_b_envelope(&self) -> &RoleEncryptedEnvelopeV1 {
        &self.signer_b_envelope
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawEcdsaThresholdPrfOuterRequestV2 {
    version: EcdsaThresholdPrfRequestVersionV2,
    request_nonce: TenantRootDerivationNonceV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
    private_request: EcdsaThresholdPrfPrivateRequestV2,
    signer_a_envelope: RoleEncryptedEnvelopeV1,
    signer_b_envelope: RoleEncryptedEnvelopeV1,
}

impl<'de> Deserialize<'de> for EcdsaThresholdPrfOuterRequestV2 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawEcdsaThresholdPrfOuterRequestV2::deserialize(deserializer)?;
        if raw.version != EcdsaThresholdPrfRequestVersionV2::V2 {
            return Err(D::Error::custom(
                "unsupported ECDSA threshold-PRF outer request version",
            ));
        }
        Self::new(
            raw.request_nonce,
            raw.issued_at_ms,
            raw.expires_at_ms,
            raw.private_request,
            raw.signer_a_envelope,
            raw.signer_b_envelope,
        )
        .map_err(D::Error::custom)
    }
}

fn map_derivation_error(
    error: crate::derivation::RouterAbDerivationError,
) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!("ECDSA threshold-PRF V2 request rejected derivation field: {error}"),
    )
}

fn malformed(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MalformedWirePayload, message)
}
