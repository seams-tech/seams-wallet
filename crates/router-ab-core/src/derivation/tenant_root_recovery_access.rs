use super::tenant_root_protocol::TenantRootWireDecoderV1;
use super::{
    RouterAbDerivationError, RouterAbDerivationErrorCode, RouterAbDerivationResult,
    TenantRootCeremonyNonceV1, TenantRootProtocolDigestV1,
    VerifiedTenantRootRecoveryReshareRoleCommandV1,
};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};

const DOMAIN: &[u8] = b"seams/tenant-root/recovery-access/v1";

/// Exact operation authorized independently of recovery generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TenantRootRecoveryAccessOperationV1 {
    /// Download the persisted tenant-encrypted role package.
    DownloadPackage,
    /// Permanently close this role's retained recovery set.
    DestroyRecoverySet,
}
impl TenantRootRecoveryAccessOperationV1 {
    fn bytes(self) -> &'static [u8] {
        match self {
            Self::DownloadPackage => b"download_package",
            Self::DestroyRecoverySet => b"destroy_recovery_set",
        }
    }
}

/// Short-lived issuer-signed access to one exact admitted generation command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRecoveryAccessGrantV1 {
    command_digest: TenantRootProtocolDigestV1,
    operation: TenantRootRecoveryAccessOperationV1,
    nonce: TenantRootCeremonyNonceV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
    issuer_key_id: String,
    signature: [u8; 64],
}
impl TenantRootRecoveryAccessGrantV1 {
    /// Signs one explicit operation with a maximum five-minute lifetime.
    #[allow(clippy::too_many_arguments)]
    pub fn sign(
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
        operation: TenantRootRecoveryAccessOperationV1,
        nonce: TenantRootCeremonyNonceV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
        issuer_key_id: &str,
        key: &[u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        let mut grant = Self {
            command_digest: command.digest(),
            operation,
            nonce,
            issued_at_ms,
            expires_at_ms,
            issuer_key_id: issuer_key_id.to_owned(),
            signature: [0; 64],
        };
        grant.signature = SigningKey::from_bytes(key)
            .sign(&grant.unsigned()?)
            .to_bytes();
        Ok(grant)
    }
    fn unsigned(&self) -> RouterAbDerivationResult<Vec<u8>> {
        if self.issued_at_ms == 0
            || self.expires_at_ms <= self.issued_at_ms
            || self.expires_at_ms - self.issued_at_ms > 300_000
            || self.issuer_key_id.is_empty()
            || self.issuer_key_id.len() > 256
        {
            return Err(invalid("invalid recovery access lifetime or issuer"));
        }
        let mut out = Vec::new();
        for field in [
            DOMAIN,
            self.command_digest.as_bytes(),
            self.operation.bytes(),
            self.nonce.as_bytes(),
            &self.issued_at_ms.to_be_bytes(),
            &self.expires_at_ms.to_be_bytes(),
            self.issuer_key_id.as_bytes(),
        ] {
            push(&mut out, field);
        }
        Ok(out)
    }
    /// Encodes the exact signed grant.
    pub fn canonical_bytes(&self) -> RouterAbDerivationResult<Vec<u8>> {
        let mut out = self.unsigned()?;
        push(&mut out, &self.signature);
        Ok(out)
    }
    /// Parses bounded wire data without authorizing an operation.
    pub fn decode_canonical_bytes(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.len() > 1024 {
            return Err(invalid("recovery access grant exceeds wire limit"));
        }
        let mut d = TenantRootWireDecoderV1::new(bytes);
        d.require_field(DOMAIN)?;
        let command_digest =
            TenantRootProtocolDigestV1::from_bytes(d.fixed_field("generation command digest")?)?;
        let operation = match d.field("recovery access operation")? {
            b"download_package" => TenantRootRecoveryAccessOperationV1::DownloadPackage,
            b"destroy_recovery_set" => TenantRootRecoveryAccessOperationV1::DestroyRecoverySet,
            _ => return Err(invalid("unknown recovery access operation")),
        };
        let nonce = TenantRootCeremonyNonceV1::from_bytes(d.fixed_field("recovery access nonce")?)?;
        let issued_at_ms = d.u64_field("recovery access issue time")?;
        let expires_at_ms = d.u64_field("recovery access expiry")?;
        let issuer_key_id = d.text_field("recovery access issuer", 256)?;
        let signature = d.fixed_field("recovery access signature")?;
        d.finish()?;
        let grant = Self {
            command_digest,
            operation,
            nonce,
            issued_at_ms,
            expires_at_ms,
            issuer_key_id,
            signature,
        };
        if grant.canonical_bytes()? != bytes {
            return Err(invalid("noncanonical recovery access grant"));
        }
        Ok(grant)
    }
    /// Selects the issuer from the configured trusted keyset.
    pub fn issuer_key_id(&self) -> &str {
        &self.issuer_key_id
    }
    /// Verifies fresh authority for the exact generation before returning its operation.
    pub fn verify(
        &self,
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
        issuer_key_id: &str,
        key: &[u8; 32],
        now_ms: u64,
    ) -> RouterAbDerivationResult<TenantRootRecoveryAccessOperationV1> {
        if self.command_digest != command.digest()
            || self.issuer_key_id != issuer_key_id
            || now_ms < self.issued_at_ms
            || now_ms >= self.expires_at_ms
        {
            return Err(invalid("recovery access scope, issuer, or time mismatch"));
        }
        VerifyingKey::from_bytes(key)
            .map_err(|_| invalid("invalid recovery access issuer key"))?
            .verify_strict(&self.unsigned()?, &Signature::from_bytes(&self.signature))
            .map_err(|_| invalid("invalid recovery access signature"))?;
        Ok(self.operation)
    }
}
fn push(out: &mut Vec<u8>, field: &[u8]) {
    out.extend_from_slice(&(field.len() as u32).to_be_bytes());
    out.extend_from_slice(field);
}
fn invalid(message: &str) -> RouterAbDerivationError {
    RouterAbDerivationError::new(RouterAbDerivationErrorCode::MalformedInput, message)
}
