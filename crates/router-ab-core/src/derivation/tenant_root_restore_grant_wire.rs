use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};

use super::{
    require_tenant_root_identifier, RouterAbDerivationError, RouterAbDerivationErrorCode,
    RouterAbDerivationResult, TenantRootProtocolDigestV1, TENANT_ROOT_MAX_LIFETIME_MS_V1,
};

/// Signed wire shared by the restore cleanup and restore refresh grants: a domain
/// and operation, the grant's own scope fields, then its nonce, validity window and
/// authority key id, each prefixed with its big-endian `u32` length, and finally
/// the authority's signature over the key id and those unsigned bytes.
///
/// Every error message starts with `label`, which names the grant.
#[derive(Clone, Copy)]
pub(super) struct TenantRootRestoreGrantWireV1 {
    pub(super) label: &'static str,
    pub(super) key_id_field: &'static str,
    pub(super) domain: &'static [u8],
    pub(super) auth_domain: &'static [u8],
    pub(super) operation: &'static [u8],
    pub(super) max_bytes: usize,
    pub(super) key_id_max_bytes: usize,
}

impl TenantRootRestoreGrantWireV1 {
    /// Encodes the unsigned grant: domain, operation, `scope` in order, then the
    /// nonce, validity window and authority key id.
    pub(super) fn unsigned_canonical_bytes(
        self,
        scope: &[&[u8]],
        nonce: &[u8],
        issued_at_ms: u64,
        expires_at_ms: u64,
        grant_key_id: &str,
    ) -> RouterAbDerivationResult<Vec<u8>> {
        let mut bytes = Vec::new();
        self.push_field(&mut bytes, self.domain)?;
        self.push_field(&mut bytes, self.operation)?;
        for field in scope {
            self.push_field(&mut bytes, field)?;
        }
        self.push_field(&mut bytes, nonce)?;
        self.push_field(&mut bytes, &issued_at_ms.to_be_bytes())?;
        self.push_field(&mut bytes, &expires_at_ms.to_be_bytes())?;
        self.push_field(&mut bytes, grant_key_id.as_bytes())?;
        self.ensure_wire_size(bytes)
    }

    pub(super) fn signed_canonical_bytes(
        self,
        mut unsigned: Vec<u8>,
        signature: &[u8; 64],
    ) -> RouterAbDerivationResult<Vec<u8>> {
        self.push_field(&mut unsigned, signature)?;
        self.ensure_wire_size(unsigned)
    }

    pub(super) fn sign(
        self,
        grant_key_id: &str,
        unsigned: &[u8],
        grant_signing_key_bytes: &[u8; 32],
    ) -> RouterAbDerivationResult<[u8; 64]> {
        Ok(SigningKey::from_bytes(grant_signing_key_bytes)
            .sign(&self.authentication_input(grant_key_id, unsigned)?)
            .to_bytes())
    }

    /// Verifies a grant's signature under the caller's configured authority and
    /// returns its exact signed bytes and their digest. `unsigned` builds the
    /// grant's unsigned bytes once the authority checks have passed.
    pub(super) fn verify(
        self,
        grant_key_id: &str,
        signature: &[u8; 64],
        expected_grant_key_id: &str,
        trusted_grant_verifying_key: &[u8; 32],
        unsigned: impl FnOnce() -> RouterAbDerivationResult<Vec<u8>>,
    ) -> RouterAbDerivationResult<(Vec<u8>, TenantRootProtocolDigestV1)> {
        self.validate_grant_key_id(expected_grant_key_id)?;
        if grant_key_id != expected_grant_key_id {
            return Err(self.replay_mismatch("key id does not match its expected authority"));
        }
        let verifying_key = VerifyingKey::from_bytes(trusted_grant_verifying_key)
            .map_err(|_| self.verification_failed("authority key is invalid"))?;
        let unsigned = unsigned()?;
        verifying_key
            .verify_strict(
                &self.authentication_input(grant_key_id, &unsigned)?,
                &Signature::from_bytes(signature),
            )
            .map_err(|_| self.verification_failed("signature is invalid"))?;
        let canonical_bytes = self.signed_canonical_bytes(unsigned, signature)?;
        let digest =
            TenantRootProtocolDigestV1::from_bytes(Sha256::digest(&canonical_bytes).into())?;
        Ok((canonical_bytes, digest))
    }

    pub(super) fn validate_window(
        self,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> RouterAbDerivationResult<()> {
        if issued_at_ms == 0
            || expires_at_ms <= issued_at_ms
            || expires_at_ms - issued_at_ms > TENANT_ROOT_MAX_LIFETIME_MS_V1
        {
            return Err(self.malformed("time window is invalid"));
        }
        Ok(())
    }

    pub(super) fn validate_signature(self, signature: &[u8; 64]) -> RouterAbDerivationResult<()> {
        if signature.iter().all(|byte| *byte == 0) {
            return Err(self.malformed("signature must be non-zero"));
        }
        Ok(())
    }

    pub(super) fn validate_grant_key_id(self, value: &str) -> RouterAbDerivationResult<()> {
        require_tenant_root_identifier(self.key_id_field, value)?;
        if value.len() > self.key_id_max_bytes {
            return Err(self.malformed("key id is too long"));
        }
        Ok(())
    }

    /// Rejects an all-zero value; `name` completes "{label} {name} must be non-zero".
    pub(super) fn require_nonzero(self, bytes: &[u8], name: &str) -> RouterAbDerivationResult<()> {
        if bytes.iter().all(|byte| *byte == 0) {
            Err(self.malformed(&format!("{name} must be non-zero")))
        } else {
            Ok(())
        }
    }

    /// Requires `now_ms` to be inside the grant's strict freshness window.
    pub(super) fn require_fresh(
        self,
        now_ms: u64,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> RouterAbDerivationResult<()> {
        if now_ms < issued_at_ms || now_ms >= expires_at_ms {
            return Err(self.replay_mismatch("is outside its freshness window"));
        }
        Ok(())
    }

    pub(super) fn push_field(
        self,
        out: &mut Vec<u8>,
        value: &[u8],
    ) -> RouterAbDerivationResult<()> {
        if value.is_empty() {
            return Err(RouterAbDerivationError::new(
                RouterAbDerivationErrorCode::EmptyField,
                format!("{} field is required", self.label),
            ));
        }
        let length = u32::try_from(value.len()).map_err(|_| self.malformed("field is too long"))?;
        out.extend_from_slice(&length.to_be_bytes());
        out.extend_from_slice(value);
        Ok(())
    }

    pub(super) fn malformed(self, problem: &str) -> RouterAbDerivationError {
        self.error(RouterAbDerivationErrorCode::MalformedInput, problem)
    }

    fn authentication_input(
        self,
        grant_key_id: &str,
        unsigned: &[u8],
    ) -> RouterAbDerivationResult<Vec<u8>> {
        self.validate_grant_key_id(grant_key_id)?;
        let mut bytes = Vec::new();
        self.push_field(&mut bytes, self.auth_domain)?;
        self.push_field(&mut bytes, grant_key_id.as_bytes())?;
        self.push_field(&mut bytes, unsigned)?;
        Ok(bytes)
    }

    fn ensure_wire_size(self, bytes: Vec<u8>) -> RouterAbDerivationResult<Vec<u8>> {
        if bytes.len() > self.max_bytes {
            return Err(self.malformed("wire is too long"));
        }
        Ok(bytes)
    }

    fn replay_mismatch(self, problem: &str) -> RouterAbDerivationError {
        self.error(RouterAbDerivationErrorCode::ReplayMismatch, problem)
    }

    fn verification_failed(self, problem: &str) -> RouterAbDerivationError {
        self.error(
            RouterAbDerivationErrorCode::OutputVerificationFailed,
            problem,
        )
    }

    fn error(self, code: RouterAbDerivationErrorCode, problem: &str) -> RouterAbDerivationError {
        RouterAbDerivationError::new(code, format!("{} {problem}", self.label))
    }
}

/// Accessors both restore grants share for their nonce, validity window and
/// authority key id: `grant` reads them from a grant's `data`, and `verified` from
/// the grant a verified form wraps, alongside its exact signed bytes and digest.
macro_rules! restore_grant_accessors {
    (grant) => {
        /// Returns the one-use restore authorization nonce.
        pub const fn nonce(&self) -> TenantRootRestoreAuthorizationNonceV1 {
            self.data.nonce
        }

        /// Returns the issue timestamp.
        pub const fn issued_at_ms(&self) -> u64 {
            self.data.issued_at_ms
        }

        /// Returns the expiry timestamp.
        pub const fn expires_at_ms(&self) -> u64 {
            self.data.expires_at_ms
        }

        /// Returns the authority key identifier.
        pub fn grant_key_id(&self) -> &str {
            &self.data.grant_key_id
        }
    };
    (verified) => {
        pub const fn nonce(&self) -> TenantRootRestoreAuthorizationNonceV1 {
            self.grant.nonce()
        }

        pub const fn issued_at_ms(&self) -> u64 {
            self.grant.issued_at_ms()
        }

        pub const fn expires_at_ms(&self) -> u64 {
            self.grant.expires_at_ms()
        }

        pub fn grant_key_id(&self) -> &str {
            self.grant.grant_key_id()
        }

        /// Returns the exact canonical signed grant bytes authenticated by verify.
        pub fn canonical_bytes(&self) -> &[u8] {
            &self.canonical_bytes
        }

        /// Returns the digest of the exact canonical signed grant bytes.
        pub const fn digest(&self) -> TenantRootProtocolDigestV1 {
            self.digest
        }
    };
}

pub(super) use restore_grant_accessors;
