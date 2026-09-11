use super::tenant_root_protocol::TenantRootWireDecoderV1;
use super::{
    RouterAbDerivationError, RouterAbDerivationErrorCode, RouterAbDerivationResult,
    TenantRootCeremonyNonceV1, TenantRootCustodyLineageId, TenantRootIdentityDigestV1,
    TenantRootLifecycleReceiptDigestV1, TenantRootProtocolDigestV1,
    VerifiedTenantRootSignedActivationReceiptV1,
};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use threshold_prf::TwoPartyDeriverRole;

const DOMAIN: &[u8] = b"seams/tenant-root/source-retirement/v1";

/// Fresh source-console authority to retire one exact active custody lineage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootSourceRetirementCommandV1 {
    identity: TenantRootIdentityDigestV1,
    lineage: TenantRootCustodyLineageId,
    active_receipt: TenantRootLifecycleReceiptDigestV1,
    destination_receipt: TenantRootProtocolDigestV1,
    role: TwoPartyDeriverRole,
    nonce: TenantRootCeremonyNonceV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
    issuer_key_id: String,
    signature: [u8; 64],
}
impl TenantRootSourceRetirementCommandV1 {
    /// Binds retirement to the source's verified active receipt and named destination receipt.
    #[allow(clippy::too_many_arguments)]
    pub fn sign(
        active: &VerifiedTenantRootSignedActivationReceiptV1,
        role: TwoPartyDeriverRole,
        destination_receipt: TenantRootProtocolDigestV1,
        nonce: TenantRootCeremonyNonceV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
        issuer_key_id: &str,
        key: &[u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        let mut command = Self {
            identity: active.identity_digest(),
            lineage: active.custody_lineage(),
            active_receipt: active.digest(),
            destination_receipt,
            role,
            nonce,
            issued_at_ms,
            expires_at_ms,
            issuer_key_id: issuer_key_id.to_owned(),
            signature: [0; 64],
        };
        command.signature = SigningKey::from_bytes(key)
            .sign(&command.unsigned()?)
            .to_bytes();
        Ok(command)
    }
    fn unsigned(&self) -> RouterAbDerivationResult<Vec<u8>> {
        if self.issued_at_ms == 0
            || self.expires_at_ms <= self.issued_at_ms
            || self.expires_at_ms - self.issued_at_ms > 300_000
            || self.issuer_key_id.is_empty()
            || self.issuer_key_id.len() > 256
        {
            return Err(invalid("invalid source retirement lifetime or issuer"));
        }
        let mut out = Vec::new();
        for field in [
            DOMAIN,
            self.identity.as_bytes(),
            self.lineage.as_bytes(),
            self.active_receipt.as_bytes(),
            self.destination_receipt.as_bytes(),
            self.role.as_str().as_bytes(),
            self.nonce.as_bytes(),
            &self.issued_at_ms.to_be_bytes(),
            &self.expires_at_ms.to_be_bytes(),
            self.issuer_key_id.as_bytes(),
        ] {
            push(&mut out, field);
        }
        Ok(out)
    }
    /// Encodes the exact signed authorization.
    pub fn canonical_bytes(&self) -> RouterAbDerivationResult<Vec<u8>> {
        let mut out = self.unsigned()?;
        push(&mut out, &self.signature);
        Ok(out)
    }
    /// Parses bounded canonical wire data without authorizing deletion.
    pub fn decode_canonical_bytes(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.len() > 2048 {
            return Err(invalid("source retirement command exceeds wire limit"));
        }
        let mut d = TenantRootWireDecoderV1::new(bytes);
        d.require_field(DOMAIN)?;
        let identity = TenantRootIdentityDigestV1::from_bytes(d.fixed_field("source identity")?);
        let lineage = TenantRootCustodyLineageId::from_bytes(d.fixed_field("source lineage")?)?;
        let active_receipt = TenantRootLifecycleReceiptDigestV1::from_bytes(
            d.fixed_field("source active receipt")?,
        )?;
        let destination_receipt = TenantRootProtocolDigestV1::from_bytes(
            d.fixed_field("destination activation receipt")?,
        )?;
        let role = match d.field("source role")? {
            b"deriver_a" => TwoPartyDeriverRole::DeriverA,
            b"deriver_b" => TwoPartyDeriverRole::DeriverB,
            _ => return Err(invalid("invalid source retirement role")),
        };
        let nonce = TenantRootCeremonyNonceV1::from_bytes(d.fixed_field("retirement nonce")?)?;
        let issued_at_ms = d.u64_field("retirement issue time")?;
        let expires_at_ms = d.u64_field("retirement expiry")?;
        let issuer_key_id = d.text_field("retirement issuer", 256)?;
        let signature = d.fixed_field("retirement signature")?;
        d.finish()?;
        let value = Self {
            identity,
            lineage,
            active_receipt,
            destination_receipt,
            role,
            nonce,
            issued_at_ms,
            expires_at_ms,
            issuer_key_id,
            signature,
        };
        if value.canonical_bytes()? != bytes {
            return Err(invalid("noncanonical source retirement command"));
        }
        Ok(value)
    }
    /// Selects the configured source issuer key.
    pub fn issuer_key_id(&self) -> &str {
        &self.issuer_key_id
    }
    /// Verifies fresh role-specific authority before producing a deletion input.
    pub fn verify(
        &self,
        role: TwoPartyDeriverRole,
        issuer_key_id: &str,
        key: &[u8; 32],
        now_ms: u64,
    ) -> RouterAbDerivationResult<VerifiedTenantRootSourceRetirementCommandV1> {
        if self.role != role
            || self.issuer_key_id != issuer_key_id
            || now_ms < self.issued_at_ms
            || now_ms >= self.expires_at_ms
        {
            return Err(invalid(
                "source retirement role, issuer, or freshness mismatch",
            ));
        }
        VerifyingKey::from_bytes(key)
            .map_err(|_| invalid("invalid source retirement issuer key"))?
            .verify_strict(&self.unsigned()?, &Signature::from_bytes(&self.signature))
            .map_err(|_| invalid("invalid source retirement signature"))?;
        Ok(VerifiedTenantRootSourceRetirementCommandV1(self.clone()))
    }
}
/// Only an issuer-verified command may reach source role storage.
#[derive(Debug, Clone)]
pub struct VerifiedTenantRootSourceRetirementCommandV1(TenantRootSourceRetirementCommandV1);
impl VerifiedTenantRootSourceRetirementCommandV1 {
    /// Exact source identity.
    pub fn identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.0.identity
    }
    /// Exact source custody lineage.
    pub fn custody_lineage(&self) -> TenantRootCustodyLineageId {
        self.0.lineage
    }
    /// Active source receipt admitted for retirement.
    pub fn active_receipt_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.0.active_receipt
    }
    /// Destination receipt named by the source owner.
    pub fn destination_receipt_digest(&self) -> TenantRootProtocolDigestV1 {
        self.0.destination_receipt
    }
    /// Role owning the material to remove.
    pub fn role(&self) -> TwoPartyDeriverRole {
        self.0.role
    }
}
fn push(out: &mut Vec<u8>, field: &[u8]) {
    out.extend_from_slice(&(field.len() as u32).to_be_bytes());
    out.extend_from_slice(field);
}
fn invalid(message: &str) -> RouterAbDerivationError {
    RouterAbDerivationError::new(RouterAbDerivationErrorCode::MalformedInput, message)
}
