//! Signed admission for one staged restore forward-refresh orchestration.
//!
//! The grant authenticates the public restore scope that the control plane has
//! already established.  Root material, commitments, and signer identities
//! are deliberately absent; those values are resolved from the verified
//! manifest and destination configuration when role commands are built.

use core::fmt;

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};

use super::tenant_root_protocol::TenantRootWireDecoderV1;
use super::{
    require_tenant_root_identifier, RouterAbDerivationError, RouterAbDerivationErrorCode,
    RouterAbDerivationResult, TenantRootCeremonySessionIdV1, TenantRootCustodyLineageId,
    TenantRootIdentityDigestV1, TenantRootLifecycleReceiptDigestV1, TenantRootProtocolDigestV1,
    TenantRootRestoreAuthorizationNonceV1, TenantRootRestoreDestinationFingerprintV1,
    TenantRootRestoreSessionIdV1, TENANT_ROOT_MAX_LIFETIME_MS_V1,
};

const RESTORE_REFRESH_GRANT_DOMAIN_V1: &[u8] = b"seams/tenant-root-restore-refresh-grant/v1";
const RESTORE_REFRESH_GRANT_AUTH_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-restore-refresh-grant/authentication/v1";
const RESTORE_REFRESH_GRANT_OPERATION_V1: &[u8] = b"tenant_root_restore_refresh_v1";
const RESTORE_REFRESH_GRANT_SESSION_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-restore-refresh-grant/ceremony-session/v1";
const RESTORE_REFRESH_GRANT_MAX_BYTES_V1: usize = 16 * 1024;
const RESTORE_REFRESH_GRANT_KEY_ID_MAX_BYTES_V1: usize = 256;

/// Exact operation authenticated by a restore refresh grant.
pub const TENANT_ROOT_RESTORE_REFRESH_GRANT_OPERATION_V1: &str = "tenant_root_restore_refresh_v1";

/// Maximum canonical wire size accepted for one restore refresh grant.
pub const TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1: usize =
    RESTORE_REFRESH_GRANT_MAX_BYTES_V1;

/// A signed authorization for one exact staged restore forward-refresh scope.
#[derive(Clone, PartialEq, Eq)]
struct TenantRootRestoreRefreshGrantDataV1 {
    operation_digest: TenantRootProtocolDigestV1,
    destination_identity_digest: TenantRootIdentityDigestV1,
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    destination_lineage: TenantRootCustodyLineageId,
    restore_session_id: TenantRootRestoreSessionIdV1,
    manifest_digest: [u8; 32],
    deriver_a_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    deriver_b_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    nonce: TenantRootRestoreAuthorizationNonceV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
    grant_key_id: String,
    signature: [u8; 64],
}

impl fmt::Debug for TenantRootRestoreRefreshGrantDataV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TenantRootRestoreRefreshGrantDataV1")
            .field("operation_digest", &self.operation_digest)
            .field(
                "destination_identity_digest",
                &self.destination_identity_digest,
            )
            .field("destination_fingerprint", &self.destination_fingerprint)
            .field("destination_lineage", &self.destination_lineage)
            .field("restore_session_id", &self.restore_session_id)
            .field("manifest_digest", &hex::encode(self.manifest_digest))
            .field(
                "deriver_a_acceptance_receipt_digest",
                &self.deriver_a_acceptance_receipt_digest,
            )
            .field(
                "deriver_b_acceptance_receipt_digest",
                &self.deriver_b_acceptance_receipt_digest,
            )
            .field("nonce", &self.nonce)
            .field("issued_at_ms", &self.issued_at_ms)
            .field("expires_at_ms", &self.expires_at_ms)
            .field("grant_key_id", &self.grant_key_id)
            .field("signature", &"[redacted]")
            .finish()
    }
}

/// Restore refresh authorization before signature verification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRestoreRefreshGrantV1 {
    data: TenantRootRestoreRefreshGrantDataV1,
}

impl TenantRootRestoreRefreshGrantV1 {
    /// Signs one exact restore refresh grant.
    #[allow(clippy::too_many_arguments)]
    pub fn sign(
        operation_digest: TenantRootProtocolDigestV1,
        destination_identity_digest: TenantRootIdentityDigestV1,
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        destination_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
        manifest_digest: [u8; 32],
        deriver_a_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        deriver_b_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        nonce: TenantRootRestoreAuthorizationNonceV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
        grant_key_id: impl Into<String>,
        grant_signing_key_bytes: &[u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        let mut data = TenantRootRestoreRefreshGrantDataV1 {
            operation_digest,
            destination_identity_digest,
            destination_fingerprint,
            destination_lineage,
            restore_session_id,
            manifest_digest,
            deriver_a_acceptance_receipt_digest,
            deriver_b_acceptance_receipt_digest,
            nonce,
            issued_at_ms,
            expires_at_ms,
            grant_key_id: grant_key_id.into(),
            signature: [0_u8; 64],
        };
        validate_unsigned_data(&data)?;
        let unsigned = unsigned_canonical_bytes(&data)?;
        data.signature = SigningKey::from_bytes(grant_signing_key_bytes)
            .sign(&authentication_input(&data.grant_key_id, &unsigned)?)
            .to_bytes();
        validate_data(&data)?;
        let grant = Self { data };
        grant.canonical_bytes()?;
        Ok(grant)
    }

    /// Decodes exactly one canonical signed restore refresh grant.
    pub fn decode_canonical_bytes(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.is_empty() || bytes.len() > RESTORE_REFRESH_GRANT_MAX_BYTES_V1 {
            return Err(malformed(
                "tenant-root restore refresh grant wire length is invalid",
            ));
        }
        let mut decoder = TenantRootWireDecoderV1::new(bytes);
        decoder.require_field(RESTORE_REFRESH_GRANT_DOMAIN_V1)?;
        if decoder.field("tenant-root restore refresh grant operation")?
            != RESTORE_REFRESH_GRANT_OPERATION_V1
        {
            return Err(malformed(
                "tenant-root restore refresh grant operation is invalid",
            ));
        }
        let operation_digest = TenantRootProtocolDigestV1::from_bytes(
            decoder.fixed_field::<32>("tenant-root restore refresh grant operation digest")?,
        )?;
        let destination_identity_digest = TenantRootIdentityDigestV1::from_bytes(
            decoder.fixed_field::<32>("tenant-root restore refresh grant destination identity")?,
        );
        let destination_fingerprint = TenantRootRestoreDestinationFingerprintV1::from_bytes(
            decoder
                .fixed_field::<32>("tenant-root restore refresh grant destination fingerprint")?,
        )?;
        let destination_lineage = TenantRootCustodyLineageId::from_bytes(
            decoder.fixed_field::<16>("tenant-root restore refresh grant destination lineage")?,
        )?;
        let restore_session_id = TenantRootRestoreSessionIdV1::from_bytes(
            decoder.fixed_field::<16>("tenant-root restore refresh grant restore session")?,
        )?;
        let manifest_digest =
            decoder.fixed_field::<32>("tenant-root restore refresh grant manifest digest")?;
        let deriver_a_acceptance_receipt_digest =
            TenantRootLifecycleReceiptDigestV1::from_bytes(decoder.fixed_field::<32>(
                "tenant-root restore refresh grant Deriver A acceptance receipt",
            )?)?;
        let deriver_b_acceptance_receipt_digest =
            TenantRootLifecycleReceiptDigestV1::from_bytes(decoder.fixed_field::<32>(
                "tenant-root restore refresh grant Deriver B acceptance receipt",
            )?)?;
        let nonce = TenantRootRestoreAuthorizationNonceV1::from_bytes(
            decoder.fixed_field::<32>("tenant-root restore refresh grant nonce")?,
        )?;
        let issued_at_ms = decoder.u64_field("tenant-root restore refresh grant issue time")?;
        let expires_at_ms = decoder.u64_field("tenant-root restore refresh grant expiry")?;
        let grant_key_id = decoder.text_field(
            "tenant-root restore refresh grant key id",
            RESTORE_REFRESH_GRANT_KEY_ID_MAX_BYTES_V1,
        )?;
        let signature = decoder.fixed_field::<64>("tenant-root restore refresh grant signature")?;
        decoder.finish()?;

        let data = TenantRootRestoreRefreshGrantDataV1 {
            operation_digest,
            destination_identity_digest,
            destination_fingerprint,
            destination_lineage,
            restore_session_id,
            manifest_digest,
            deriver_a_acceptance_receipt_digest,
            deriver_b_acceptance_receipt_digest,
            nonce,
            issued_at_ms,
            expires_at_ms,
            grant_key_id,
            signature,
        };
        validate_data(&data)?;
        let grant = Self { data };
        if grant.canonical_bytes()? != bytes {
            return Err(malformed(
                "tenant-root restore refresh grant wire is not canonical",
            ));
        }
        Ok(grant)
    }

    /// Returns the fixed operation authenticated by this grant.
    pub const fn operation(&self) -> &'static str {
        TENANT_ROOT_RESTORE_REFRESH_GRANT_OPERATION_V1
    }

    /// Returns the operation digest bound by this grant.
    pub const fn operation_digest(&self) -> TenantRootProtocolDigestV1 {
        self.data.operation_digest
    }

    /// Returns the destination's logical tenant-root identity digest.
    pub const fn destination_identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.data.destination_identity_digest
    }

    /// Returns the destination deployment fingerprint.
    pub const fn destination_fingerprint(&self) -> TenantRootRestoreDestinationFingerprintV1 {
        self.data.destination_fingerprint
    }

    /// Returns the destination custody lineage.
    pub const fn destination_lineage(&self) -> TenantRootCustodyLineageId {
        self.data.destination_lineage
    }

    /// Returns the destination restore session identifier.
    pub const fn restore_session_id(&self) -> TenantRootRestoreSessionIdV1 {
        self.data.restore_session_id
    }

    /// Returns the verified recovery manifest digest.
    pub const fn manifest_digest(&self) -> &[u8; 32] {
        &self.data.manifest_digest
    }

    /// Returns Deriver A's exact accepted-import receipt digest.
    pub const fn deriver_a_acceptance_receipt_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.data.deriver_a_acceptance_receipt_digest
    }

    /// Returns Deriver B's exact accepted-import receipt digest.
    pub const fn deriver_b_acceptance_receipt_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.data.deriver_b_acceptance_receipt_digest
    }

    /// Returns one role's exact accepted-import receipt digest.
    pub const fn acceptance_receipt(
        &self,
        role: threshold_prf::TwoPartyDeriverRole,
    ) -> TenantRootLifecycleReceiptDigestV1 {
        match role {
            threshold_prf::TwoPartyDeriverRole::DeriverA => {
                self.deriver_a_acceptance_receipt_digest()
            }
            threshold_prf::TwoPartyDeriverRole::DeriverB => {
                self.deriver_b_acceptance_receipt_digest()
            }
        }
    }

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

    /// Returns the exact canonical signed grant bytes.
    pub fn canonical_bytes(&self) -> RouterAbDerivationResult<Vec<u8>> {
        let unsigned = unsigned_canonical_bytes(&self.data)?;
        signed_canonical_bytes(unsigned, &self.data.signature)
    }

    /// Returns the digest of the exact canonical signed grant bytes.
    pub fn digest(&self) -> RouterAbDerivationResult<TenantRootProtocolDigestV1> {
        TenantRootProtocolDigestV1::from_bytes(Sha256::digest(self.canonical_bytes()?).into())
    }

    /// Verifies this grant under the caller's configured grant authority.
    pub fn verify(
        &self,
        expected_grant_key_id: &str,
        trusted_grant_verifying_key: &[u8; 32],
    ) -> RouterAbDerivationResult<VerifiedTenantRootRestoreRefreshGrantV1> {
        validate_data(&self.data)?;
        validate_grant_key_id(expected_grant_key_id)?;
        if self.data.grant_key_id != expected_grant_key_id {
            return Err(replay_mismatch(
                "tenant-root restore refresh grant key id does not match its expected authority",
            ));
        }
        let verifying_key =
            VerifyingKey::from_bytes(trusted_grant_verifying_key).map_err(|_| {
                verification_failed("tenant-root restore refresh grant authority key is invalid")
            })?;
        let unsigned = unsigned_canonical_bytes(&self.data)?;
        verifying_key
            .verify_strict(
                &authentication_input(&self.data.grant_key_id, &unsigned)?,
                &Signature::from_bytes(&self.data.signature),
            )
            .map_err(|_| {
                verification_failed("tenant-root restore refresh grant signature is invalid")
            })?;
        let canonical_bytes = signed_canonical_bytes(unsigned, &self.data.signature)?;
        let digest =
            TenantRootProtocolDigestV1::from_bytes(Sha256::digest(&canonical_bytes).into())?;
        Ok(VerifiedTenantRootRestoreRefreshGrantV1 {
            grant: self.clone(),
            canonical_bytes,
            digest,
        })
    }
}

/// Restore refresh grant verified under a configured authority.
pub struct VerifiedTenantRootRestoreRefreshGrantV1 {
    grant: TenantRootRestoreRefreshGrantV1,
    canonical_bytes: Vec<u8>,
    digest: TenantRootProtocolDigestV1,
}

impl fmt::Debug for VerifiedTenantRootRestoreRefreshGrantV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("VerifiedTenantRootRestoreRefreshGrantV1")
            .field("digest", &self.digest)
            .field("canonical_bytes", &"[public bytes]")
            .finish()
    }
}

impl VerifiedTenantRootRestoreRefreshGrantV1 {
    pub const fn operation(&self) -> &'static str {
        self.grant.operation()
    }

    pub const fn operation_digest(&self) -> TenantRootProtocolDigestV1 {
        self.grant.operation_digest()
    }

    pub const fn destination_identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.grant.destination_identity_digest()
    }

    pub const fn destination_fingerprint(&self) -> TenantRootRestoreDestinationFingerprintV1 {
        self.grant.destination_fingerprint()
    }

    pub const fn destination_lineage(&self) -> TenantRootCustodyLineageId {
        self.grant.destination_lineage()
    }

    pub const fn restore_session_id(&self) -> TenantRootRestoreSessionIdV1 {
        self.grant.restore_session_id()
    }

    pub const fn manifest_digest(&self) -> &[u8; 32] {
        self.grant.manifest_digest()
    }

    pub const fn deriver_a_acceptance_receipt_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.grant.deriver_a_acceptance_receipt_digest()
    }

    pub const fn deriver_b_acceptance_receipt_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.grant.deriver_b_acceptance_receipt_digest()
    }

    pub const fn acceptance_receipt(
        &self,
        role: threshold_prf::TwoPartyDeriverRole,
    ) -> TenantRootLifecycleReceiptDigestV1 {
        self.grant.acceptance_receipt(role)
    }

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

    /// Requires `now_ms` to be inside the grant's strict freshness window.
    pub fn require_fresh(&self, now_ms: u64) -> RouterAbDerivationResult<()> {
        if now_ms < self.issued_at_ms() || now_ms >= self.expires_at_ms() {
            return Err(replay_mismatch(
                "tenant-root restore refresh grant is outside its freshness window",
            ));
        }
        Ok(())
    }

    /// Derives the deterministic ceremony session shared by both role commands.
    pub fn ceremony_session_id(&self) -> RouterAbDerivationResult<TenantRootCeremonySessionIdV1> {
        tenant_root_restore_refresh_ceremony_session_id_v1(self)
    }
}

/// Derives a deterministic 16-byte ceremony session from a verified grant.
pub fn tenant_root_restore_refresh_ceremony_session_id_v1(
    grant: &VerifiedTenantRootRestoreRefreshGrantV1,
) -> RouterAbDerivationResult<TenantRootCeremonySessionIdV1> {
    let digest = derive_grant_output_digest(RESTORE_REFRESH_GRANT_SESSION_DOMAIN_V1, grant)?;
    let session_bytes: [u8; 16] = digest[..16]
        .try_into()
        .expect("restore refresh ceremony session digest prefix has fixed length");
    TenantRootCeremonySessionIdV1::from_bytes(session_bytes)
}

fn derive_grant_output_digest(
    domain: &[u8],
    grant: &VerifiedTenantRootRestoreRefreshGrantV1,
) -> RouterAbDerivationResult<[u8; 32]> {
    let mut bytes = Vec::new();
    push_field(&mut bytes, domain)?;
    push_field(&mut bytes, grant.canonical_bytes())?;
    Ok(Sha256::digest(bytes).into())
}

fn validate_data(data: &TenantRootRestoreRefreshGrantDataV1) -> RouterAbDerivationResult<()> {
    validate_unsigned_data(data)?;
    if data.signature.iter().all(|byte| *byte == 0) {
        return Err(malformed(
            "tenant-root restore refresh grant signature must be non-zero",
        ));
    }
    Ok(())
}

fn validate_unsigned_data(
    data: &TenantRootRestoreRefreshGrantDataV1,
) -> RouterAbDerivationResult<()> {
    if data.issued_at_ms == 0
        || data.expires_at_ms <= data.issued_at_ms
        || data.expires_at_ms - data.issued_at_ms > TENANT_ROOT_MAX_LIFETIME_MS_V1
    {
        return Err(malformed(
            "tenant-root restore refresh grant time window is invalid",
        ));
    }
    if data.deriver_a_acceptance_receipt_digest == data.deriver_b_acceptance_receipt_digest {
        return Err(malformed(
            "tenant-root restore refresh grant acceptance receipts must differ",
        ));
    }
    require_nonzero(
        &data.manifest_digest,
        "tenant-root restore refresh grant manifest digest must be non-zero",
    )?;
    require_nonzero(
        data.destination_identity_digest.as_bytes(),
        "tenant-root restore refresh grant destination identity digest must be non-zero",
    )?;
    validate_grant_key_id(&data.grant_key_id)
}

fn validate_grant_key_id(value: &str) -> RouterAbDerivationResult<()> {
    require_tenant_root_identifier("tenant-root restore refresh grant key id", value)?;
    if value.len() > RESTORE_REFRESH_GRANT_KEY_ID_MAX_BYTES_V1 {
        return Err(malformed(
            "tenant-root restore refresh grant key id is too long",
        ));
    }
    Ok(())
}

fn unsigned_canonical_bytes(
    data: &TenantRootRestoreRefreshGrantDataV1,
) -> RouterAbDerivationResult<Vec<u8>> {
    let mut bytes = Vec::new();
    push_field(&mut bytes, RESTORE_REFRESH_GRANT_DOMAIN_V1)?;
    push_field(&mut bytes, RESTORE_REFRESH_GRANT_OPERATION_V1)?;
    push_field(&mut bytes, data.operation_digest.as_bytes())?;
    push_field(&mut bytes, data.destination_identity_digest.as_bytes())?;
    push_field(&mut bytes, data.destination_fingerprint.as_bytes())?;
    push_field(&mut bytes, data.destination_lineage.as_bytes())?;
    push_field(&mut bytes, data.restore_session_id.as_bytes())?;
    push_field(&mut bytes, &data.manifest_digest)?;
    push_field(
        &mut bytes,
        data.deriver_a_acceptance_receipt_digest.as_bytes(),
    )?;
    push_field(
        &mut bytes,
        data.deriver_b_acceptance_receipt_digest.as_bytes(),
    )?;
    push_field(&mut bytes, data.nonce.as_bytes())?;
    push_field(&mut bytes, &data.issued_at_ms.to_be_bytes())?;
    push_field(&mut bytes, &data.expires_at_ms.to_be_bytes())?;
    push_field(&mut bytes, data.grant_key_id.as_bytes())?;
    ensure_wire_size(bytes)
}

fn signed_canonical_bytes(
    mut unsigned: Vec<u8>,
    signature: &[u8; 64],
) -> RouterAbDerivationResult<Vec<u8>> {
    push_field(&mut unsigned, signature)?;
    ensure_wire_size(unsigned)
}

fn authentication_input(grant_key_id: &str, unsigned: &[u8]) -> RouterAbDerivationResult<Vec<u8>> {
    validate_grant_key_id(grant_key_id)?;
    let mut bytes = Vec::new();
    push_field(&mut bytes, RESTORE_REFRESH_GRANT_AUTH_DOMAIN_V1)?;
    push_field(&mut bytes, grant_key_id.as_bytes())?;
    push_field(&mut bytes, unsigned)?;
    Ok(bytes)
}

fn ensure_wire_size(bytes: Vec<u8>) -> RouterAbDerivationResult<Vec<u8>> {
    if bytes.len() > RESTORE_REFRESH_GRANT_MAX_BYTES_V1 {
        return Err(malformed(
            "tenant-root restore refresh grant wire is too long",
        ));
    }
    Ok(bytes)
}

fn push_field(out: &mut Vec<u8>, value: &[u8]) -> RouterAbDerivationResult<()> {
    if value.is_empty() {
        return Err(RouterAbDerivationError::new(
            RouterAbDerivationErrorCode::EmptyField,
            "tenant-root restore refresh grant field is required",
        ));
    }
    let length = u32::try_from(value.len())
        .map_err(|_| malformed("tenant-root restore refresh grant field is too long"))?;
    out.extend_from_slice(&length.to_be_bytes());
    out.extend_from_slice(value);
    Ok(())
}

fn require_nonzero(bytes: &[u8], message: &'static str) -> RouterAbDerivationResult<()> {
    if bytes.iter().all(|byte| *byte == 0) {
        Err(malformed(message))
    } else {
        Ok(())
    }
}

fn malformed(message: &'static str) -> RouterAbDerivationError {
    RouterAbDerivationError::new(RouterAbDerivationErrorCode::MalformedInput, message)
}

fn replay_mismatch(message: &'static str) -> RouterAbDerivationError {
    RouterAbDerivationError::new(RouterAbDerivationErrorCode::ReplayMismatch, message)
}

fn verification_failed(message: &'static str) -> RouterAbDerivationError {
    RouterAbDerivationError::new(
        RouterAbDerivationErrorCode::OutputVerificationFailed,
        message,
    )
}
