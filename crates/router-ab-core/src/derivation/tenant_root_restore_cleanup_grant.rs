//! Signed admission for pre-activation restore cleanup.
//!
//! The grant binds cleanup to one logical destination, deployment fingerprint,
//! custody lineage, and restore session. It carries no role because Router
//! fans one verified grant out to both fixed role endpoints.

use core::fmt;

use sha2::{Digest, Sha256};

use super::tenant_root_protocol::{verified_token_debug, TenantRootWireDecoderV1};
use super::tenant_root_restore_grant_wire::{
    restore_grant_accessors, TenantRootRestoreGrantWireV1,
};
use super::{
    RouterAbDerivationResult, TenantRootCustodyLineageId, TenantRootIdentityDigestV1,
    TenantRootProtocolDigestV1, TenantRootRestoreAuthorizationNonceV1,
    TenantRootRestoreDestinationFingerprintV1, TenantRootRestoreSessionIdV1,
    TENANT_ROOT_MAX_LIFETIME_MS_V1,
};

const RESTORE_CLEANUP_GRANT_DOMAIN_V1: &[u8] = b"seams/tenant-root-restore-cleanup-grant/v1";
const RESTORE_CLEANUP_GRANT_AUTH_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-restore-cleanup-grant/authentication/v1";
const RESTORE_CLEANUP_GRANT_OPERATION_V1: &[u8] = b"tenant_root_restore_cleanup_v1";
const RESTORE_CLEANUP_GRANT_MAX_BYTES_V1: usize = 16 * 1024;
const RESTORE_CLEANUP_GRANT_KEY_ID_MAX_BYTES_V1: usize = 256;
const CLEANUP_GRANT_WIRE: TenantRootRestoreGrantWireV1 = TenantRootRestoreGrantWireV1 {
    label: "tenant-root restore cleanup grant",
    key_id_field: "tenant-root restore cleanup grant key id",
    domain: RESTORE_CLEANUP_GRANT_DOMAIN_V1,
    auth_domain: RESTORE_CLEANUP_GRANT_AUTH_DOMAIN_V1,
    operation: RESTORE_CLEANUP_GRANT_OPERATION_V1,
    max_bytes: RESTORE_CLEANUP_GRANT_MAX_BYTES_V1,
    key_id_max_bytes: RESTORE_CLEANUP_GRANT_KEY_ID_MAX_BYTES_V1,
};

/// Exact operation authenticated by a pre-activation restore cleanup grant.
pub const TENANT_ROOT_RESTORE_CLEANUP_GRANT_OPERATION_V1: &str = "tenant_root_restore_cleanup_v1";

/// Maximum lifetime accepted for one cleanup grant.
pub const TENANT_ROOT_RESTORE_CLEANUP_GRANT_MAX_LIFETIME_MS_V1: u64 =
    TENANT_ROOT_MAX_LIFETIME_MS_V1;

#[derive(Clone, PartialEq, Eq)]
struct TenantRootRestoreCleanupGrantDataV1 {
    destination_identity_digest: TenantRootIdentityDigestV1,
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    destination_lineage: TenantRootCustodyLineageId,
    restore_session_id: TenantRootRestoreSessionIdV1,
    nonce: TenantRootRestoreAuthorizationNonceV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
    grant_key_id: String,
    signature: [u8; 64],
}

impl fmt::Debug for TenantRootRestoreCleanupGrantDataV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TenantRootRestoreCleanupGrantDataV1")
            .field(
                "destination_identity_digest",
                &self.destination_identity_digest,
            )
            .field("destination_fingerprint", &self.destination_fingerprint)
            .field("destination_lineage", &self.destination_lineage)
            .field("restore_session_id", &self.restore_session_id)
            .field("nonce", &self.nonce)
            .field("issued_at_ms", &self.issued_at_ms)
            .field("expires_at_ms", &self.expires_at_ms)
            .field("grant_key_id", &self.grant_key_id)
            .field("signature", &"[redacted]")
            .finish()
    }
}

/// Signed pre-activation restore cleanup authorization before verification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRestoreCleanupGrantV1 {
    data: TenantRootRestoreCleanupGrantDataV1,
}

impl TenantRootRestoreCleanupGrantV1 {
    /// Signs one exact destination-scoped cleanup grant.
    #[allow(clippy::too_many_arguments)]
    pub fn sign(
        destination_identity_digest: TenantRootIdentityDigestV1,
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        destination_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
        nonce: TenantRootRestoreAuthorizationNonceV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
        grant_key_id: impl Into<String>,
        grant_signing_key_bytes: &[u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        let mut data = TenantRootRestoreCleanupGrantDataV1 {
            destination_identity_digest,
            destination_fingerprint,
            destination_lineage,
            restore_session_id,
            nonce,
            issued_at_ms,
            expires_at_ms,
            grant_key_id: grant_key_id.into(),
            signature: [0_u8; 64],
        };
        validate_unsigned_data(&data)?;
        let unsigned = unsigned_canonical_bytes(&data)?;
        data.signature =
            CLEANUP_GRANT_WIRE.sign(&data.grant_key_id, &unsigned, grant_signing_key_bytes)?;
        validate_data(&data)?;
        let grant = Self { data };
        grant.canonical_bytes()?;
        Ok(grant)
    }

    /// Decodes exactly one canonical signed cleanup grant.
    pub fn decode_canonical_bytes(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.is_empty() || bytes.len() > RESTORE_CLEANUP_GRANT_MAX_BYTES_V1 {
            return Err(CLEANUP_GRANT_WIRE.malformed("wire length is invalid"));
        }
        let mut decoder = TenantRootWireDecoderV1::new(bytes);
        decoder.require_field(RESTORE_CLEANUP_GRANT_DOMAIN_V1)?;
        if decoder.field("tenant-root restore cleanup grant operation")?
            != RESTORE_CLEANUP_GRANT_OPERATION_V1
        {
            return Err(CLEANUP_GRANT_WIRE.malformed("operation is invalid"));
        }
        let destination_identity_digest =
            TenantRootIdentityDigestV1::from_bytes(decoder.fixed_field::<32>(
                "tenant-root restore cleanup grant destination identity digest",
            )?);
        let destination_fingerprint = TenantRootRestoreDestinationFingerprintV1::from_bytes(
            decoder
                .fixed_field::<32>("tenant-root restore cleanup grant destination fingerprint")?,
        )?;
        let destination_lineage = TenantRootCustodyLineageId::from_bytes(
            decoder.fixed_field::<16>("tenant-root restore cleanup grant destination lineage")?,
        )?;
        let restore_session_id = TenantRootRestoreSessionIdV1::from_bytes(
            decoder.fixed_field::<16>("tenant-root restore cleanup grant restore session")?,
        )?;
        let nonce = TenantRootRestoreAuthorizationNonceV1::from_bytes(
            decoder.fixed_field::<32>("tenant-root restore cleanup grant nonce")?,
        )?;
        let issued_at_ms = decoder.u64_field("tenant-root restore cleanup grant issue time")?;
        let expires_at_ms = decoder.u64_field("tenant-root restore cleanup grant expiry")?;
        let grant_key_id = decoder.text_field(
            "tenant-root restore cleanup grant key id",
            RESTORE_CLEANUP_GRANT_KEY_ID_MAX_BYTES_V1,
        )?;
        let signature = decoder.fixed_field::<64>("tenant-root restore cleanup grant signature")?;
        decoder.finish()?;

        let data = TenantRootRestoreCleanupGrantDataV1 {
            destination_identity_digest,
            destination_fingerprint,
            destination_lineage,
            restore_session_id,
            nonce,
            issued_at_ms,
            expires_at_ms,
            grant_key_id,
            signature,
        };
        validate_data(&data)?;
        let grant = Self { data };
        if grant.canonical_bytes()? != bytes {
            return Err(CLEANUP_GRANT_WIRE.malformed("wire is not canonical"));
        }
        Ok(grant)
    }

    /// Returns the fixed operation authenticated by this grant.
    pub const fn operation(&self) -> &'static str {
        TENANT_ROOT_RESTORE_CLEANUP_GRANT_OPERATION_V1
    }

    /// Returns the logical tenant-root identity digest named by this grant.
    pub const fn destination_identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.data.destination_identity_digest
    }

    /// Returns the destination deployment fingerprint named by this grant.
    pub const fn destination_fingerprint(&self) -> TenantRootRestoreDestinationFingerprintV1 {
        self.data.destination_fingerprint
    }

    /// Returns the destination custody lineage named by this grant.
    pub const fn destination_lineage(&self) -> TenantRootCustodyLineageId {
        self.data.destination_lineage
    }

    /// Returns the destination restore session identifier named by this grant.
    pub const fn restore_session_id(&self) -> TenantRootRestoreSessionIdV1 {
        self.data.restore_session_id
    }

    restore_grant_accessors!(grant);

    /// Returns the exact canonical signed grant bytes.
    pub fn canonical_bytes(&self) -> RouterAbDerivationResult<Vec<u8>> {
        let unsigned = unsigned_canonical_bytes(&self.data)?;
        CLEANUP_GRANT_WIRE.signed_canonical_bytes(unsigned, &self.data.signature)
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
    ) -> RouterAbDerivationResult<VerifiedTenantRootRestoreCleanupGrantV1> {
        validate_data(&self.data)?;
        let (canonical_bytes, digest) = CLEANUP_GRANT_WIRE.verify(
            &self.data.grant_key_id,
            &self.data.signature,
            expected_grant_key_id,
            trusted_grant_verifying_key,
            || unsigned_canonical_bytes(&self.data),
        )?;
        Ok(VerifiedTenantRootRestoreCleanupGrantV1 {
            grant: self.clone(),
            canonical_bytes,
            digest,
        })
    }
}

/// Restore cleanup grant verified under a configured authority.
pub struct VerifiedTenantRootRestoreCleanupGrantV1 {
    grant: TenantRootRestoreCleanupGrantV1,
    canonical_bytes: Vec<u8>,
    digest: TenantRootProtocolDigestV1,
}

verified_token_debug!(VerifiedTenantRootRestoreCleanupGrantV1);

impl VerifiedTenantRootRestoreCleanupGrantV1 {
    pub const fn operation(&self) -> &'static str {
        self.grant.operation()
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

    restore_grant_accessors!(verified);

    /// Requires `now_ms` to be inside the grant's strict freshness window.
    pub fn require_fresh(&self, now_ms: u64) -> RouterAbDerivationResult<()> {
        CLEANUP_GRANT_WIRE.require_fresh(now_ms, self.issued_at_ms(), self.expires_at_ms())
    }
}

fn validate_data(data: &TenantRootRestoreCleanupGrantDataV1) -> RouterAbDerivationResult<()> {
    validate_unsigned_data(data)?;
    CLEANUP_GRANT_WIRE.validate_signature(&data.signature)
}

fn validate_unsigned_data(
    data: &TenantRootRestoreCleanupGrantDataV1,
) -> RouterAbDerivationResult<()> {
    CLEANUP_GRANT_WIRE.validate_window(data.issued_at_ms, data.expires_at_ms)?;
    CLEANUP_GRANT_WIRE.require_nonzero(
        data.destination_identity_digest.as_bytes(),
        "destination identity digest",
    )?;
    CLEANUP_GRANT_WIRE.validate_grant_key_id(&data.grant_key_id)
}

fn unsigned_canonical_bytes(
    data: &TenantRootRestoreCleanupGrantDataV1,
) -> RouterAbDerivationResult<Vec<u8>> {
    CLEANUP_GRANT_WIRE.unsigned_canonical_bytes(
        &[
            data.destination_identity_digest.as_bytes(),
            data.destination_fingerprint.as_bytes(),
            data.destination_lineage.as_bytes(),
            data.restore_session_id.as_bytes(),
        ],
        data.nonce.as_bytes(),
        data.issued_at_ms,
        data.expires_at_ms,
        &data.grant_key_id,
    )
}
