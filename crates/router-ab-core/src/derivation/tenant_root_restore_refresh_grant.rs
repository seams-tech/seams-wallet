//! Signed admission for one staged restore forward-refresh orchestration.
//!
//! The grant authenticates the public restore scope that the control plane has
//! already established.  Root material, commitments, and signer identities
//! are deliberately absent; those values are resolved from the verified
//! manifest and destination configuration when role commands are built.

use core::fmt;

use sha2::{Digest, Sha256};

use super::tenant_root_protocol::{verified_token_debug, TenantRootWireDecoderV1};
use super::tenant_root_restore_grant_wire::{
    restore_grant_accessors, TenantRootRestoreGrantWireV1,
};
use super::{
    RouterAbDerivationResult, TenantRootCeremonySessionIdV1, TenantRootCustodyLineageId,
    TenantRootIdentityDigestV1, TenantRootLifecycleReceiptDigestV1, TenantRootProtocolDigestV1,
    TenantRootRestoreAuthorizationNonceV1, TenantRootRestoreDestinationFingerprintV1,
    TenantRootRestoreSessionIdV1,
};

const RESTORE_REFRESH_GRANT_DOMAIN_V1: &[u8] = b"seams/tenant-root-restore-refresh-grant/v1";
const RESTORE_REFRESH_GRANT_AUTH_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-restore-refresh-grant/authentication/v1";
const RESTORE_REFRESH_GRANT_OPERATION_V1: &[u8] = b"tenant_root_restore_refresh_v1";
const RESTORE_REFRESH_GRANT_SESSION_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-restore-refresh-grant/ceremony-session/v1";
const RESTORE_REFRESH_GRANT_MAX_BYTES_V1: usize = 16 * 1024;
const RESTORE_REFRESH_GRANT_KEY_ID_MAX_BYTES_V1: usize = 256;
const REFRESH_GRANT_WIRE: TenantRootRestoreGrantWireV1 = TenantRootRestoreGrantWireV1 {
    label: "tenant-root restore refresh grant",
    key_id_field: "tenant-root restore refresh grant key id",
    domain: RESTORE_REFRESH_GRANT_DOMAIN_V1,
    auth_domain: RESTORE_REFRESH_GRANT_AUTH_DOMAIN_V1,
    operation: RESTORE_REFRESH_GRANT_OPERATION_V1,
    max_bytes: RESTORE_REFRESH_GRANT_MAX_BYTES_V1,
    key_id_max_bytes: RESTORE_REFRESH_GRANT_KEY_ID_MAX_BYTES_V1,
};

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
        data.signature =
            REFRESH_GRANT_WIRE.sign(&data.grant_key_id, &unsigned, grant_signing_key_bytes)?;
        validate_data(&data)?;
        let grant = Self { data };
        grant.canonical_bytes()?;
        Ok(grant)
    }

    /// Decodes exactly one canonical signed restore refresh grant.
    pub fn decode_canonical_bytes(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.is_empty() || bytes.len() > RESTORE_REFRESH_GRANT_MAX_BYTES_V1 {
            return Err(REFRESH_GRANT_WIRE.malformed("wire length is invalid"));
        }
        let mut decoder = TenantRootWireDecoderV1::new(bytes);
        decoder.require_field(RESTORE_REFRESH_GRANT_DOMAIN_V1)?;
        if decoder.field("tenant-root restore refresh grant operation")?
            != RESTORE_REFRESH_GRANT_OPERATION_V1
        {
            return Err(REFRESH_GRANT_WIRE.malformed("operation is invalid"));
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
            return Err(REFRESH_GRANT_WIRE.malformed("wire is not canonical"));
        }
        Ok(grant)
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

    restore_grant_accessors!(grant);

    /// Returns the exact canonical signed grant bytes.
    pub fn canonical_bytes(&self) -> RouterAbDerivationResult<Vec<u8>> {
        let unsigned = unsigned_canonical_bytes(&self.data)?;
        REFRESH_GRANT_WIRE.signed_canonical_bytes(unsigned, &self.data.signature)
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
        let (canonical_bytes, digest) = REFRESH_GRANT_WIRE.verify(
            &self.data.grant_key_id,
            &self.data.signature,
            expected_grant_key_id,
            trusted_grant_verifying_key,
            || unsigned_canonical_bytes(&self.data),
        )?;
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

verified_token_debug!(VerifiedTenantRootRestoreRefreshGrantV1);

impl VerifiedTenantRootRestoreRefreshGrantV1 {
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

    restore_grant_accessors!(verified);

    /// Requires `now_ms` to be inside the grant's strict freshness window.
    pub fn require_fresh(&self, now_ms: u64) -> RouterAbDerivationResult<()> {
        REFRESH_GRANT_WIRE.require_fresh(now_ms, self.issued_at_ms(), self.expires_at_ms())
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
    REFRESH_GRANT_WIRE.push_field(&mut bytes, domain)?;
    REFRESH_GRANT_WIRE.push_field(&mut bytes, grant.canonical_bytes())?;
    Ok(Sha256::digest(bytes).into())
}

fn validate_data(data: &TenantRootRestoreRefreshGrantDataV1) -> RouterAbDerivationResult<()> {
    validate_unsigned_data(data)?;
    REFRESH_GRANT_WIRE.validate_signature(&data.signature)
}

fn validate_unsigned_data(
    data: &TenantRootRestoreRefreshGrantDataV1,
) -> RouterAbDerivationResult<()> {
    REFRESH_GRANT_WIRE.validate_window(data.issued_at_ms, data.expires_at_ms)?;
    if data.deriver_a_acceptance_receipt_digest == data.deriver_b_acceptance_receipt_digest {
        return Err(REFRESH_GRANT_WIRE.malformed("acceptance receipts must differ"));
    }
    REFRESH_GRANT_WIRE.require_nonzero(&data.manifest_digest, "manifest digest")?;
    REFRESH_GRANT_WIRE.require_nonzero(
        data.destination_identity_digest.as_bytes(),
        "destination identity digest",
    )?;
    REFRESH_GRANT_WIRE.validate_grant_key_id(&data.grant_key_id)
}

fn unsigned_canonical_bytes(
    data: &TenantRootRestoreRefreshGrantDataV1,
) -> RouterAbDerivationResult<Vec<u8>> {
    REFRESH_GRANT_WIRE.unsigned_canonical_bytes(
        &[
            data.operation_digest.as_bytes(),
            data.destination_identity_digest.as_bytes(),
            data.destination_fingerprint.as_bytes(),
            data.destination_lineage.as_bytes(),
            data.restore_session_id.as_bytes(),
            &data.manifest_digest,
            data.deriver_a_acceptance_receipt_digest.as_bytes(),
            data.deriver_b_acceptance_receipt_digest.as_bytes(),
        ],
        data.nonce.as_bytes(),
        data.issued_at_ms,
        data.expires_at_ms,
        &data.grant_key_id,
    )
}
