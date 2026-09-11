use core::fmt;

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use hpke_ng::{Aes256Gcm, DhKemX25519HkdfSha256, HkdfSha256, Hpke, Kem};
use rand_core_09::{CryptoRng, RngCore};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use threshold_prf::{
    SigningRootShareCommitment, SigningRootShareWire, ThresholdShareId, TwoPartyDeriverRole,
    TwoPartyRootCommitment,
};
use zeroize::{Zeroize, Zeroizing};

use super::x25519_canonical::is_canonical_nonzero_x25519_encoding;
use super::{
    require_tenant_root_identifier, RouterAbDerivationError, RouterAbDerivationErrorCode,
    RouterAbDerivationResult, TenantRootCustodyLineageId, TenantRootIdentityDigestV1,
    TenantRootProtocolDigestV1, TenantRootRecoveryManifestV1, TenantRootRecoveryPackageDigestV1,
    TenantRootRecoveryRecipientFingerprintV1, TenantRootRecoveryRecipientPublicKeyV1,
    TenantRootRecoverySetId, VerifiedTenantRootRecoveryRoleShareV1, TENANT_ROOT_MAX_LIFETIME_MS_V1,
    TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1,
};

const RESTORE_IMPORT_DOMAIN_V1: &[u8] = b"seams/tenant-root-restore-import/v1";
const RESTORE_IMPORT_HPKE_INFO_V1: &[u8] =
    b"seams/tenant-root-restore-import/hpke-x25519-hkdf-sha256-aes256gcm/v1";
const RESTORE_IMPORT_MAGIC_V1: &[u8; 8] = b"SEAMSRI1";
const RESTORE_IMPORT_KEY_BYTES: usize = 32;
const RESTORE_IMPORT_ID_BYTES: usize = 16;
const RESTORE_IMPORT_CIPHERTEXT_BYTES: usize = SigningRootShareWire::LEN + 16;
const RESTORE_IMPORT_MAX_BYTES_V1: usize = 16 * 1024;
const RESTORE_ROLE_IMPORT_GRANT_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-restore-role-import-grant/v1";
const RESTORE_ROLE_IMPORT_GRANT_AUTH_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-restore-role-import-grant/authentication/v1";
const RESTORE_ROLE_IMPORT_COMMAND_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-restore-role-import-command/v1";
const RESTORE_ROLE_IMPORT_COMMAND_AUTH_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-restore-role-import-command/authentication/v1";
const RESTORE_ROLE_IMPORT_OPERATION_V1: &[u8] = b"tenant_root_restore_role_import_key_issue_v1";
const RESTORE_ROLE_IMPORT_NONCE_BYTES_V1: usize = 32;
const RESTORE_ROLE_IMPORT_GRANT_MAX_BYTES_V1: usize = 16 * 1024;
const RESTORE_ROLE_IMPORT_COMMAND_MAX_BYTES_V1: usize = 32 * 1024;
const RESTORE_ROLE_IMPORT_KEY_ID_MAX_BYTES_V1: usize = 128;
const RESTORE_ROLE_IMPORT_AUTHORITY_KEY_ID_MAX_BYTES_V1: usize = 256;

type TenantRootRestoreImportHpkeV1 = Hpke<DhKemX25519HkdfSha256, HkdfSha256, Aes256Gcm>;

/// Maximum encoded size of one destination role import envelope.
pub const TENANT_ROOT_RESTORE_IMPORT_MAX_BYTES: usize = RESTORE_IMPORT_MAX_BYTES_V1;
/// Maximum encoded size of one restore role-import admission grant.
pub const TENANT_ROOT_RESTORE_ROLE_IMPORT_GRANT_MAX_BYTES_V1: usize =
    RESTORE_ROLE_IMPORT_GRANT_MAX_BYTES_V1;
/// Maximum encoded size of one issuer-signed restore role-import command.
pub const TENANT_ROOT_RESTORE_ROLE_IMPORT_COMMAND_MAX_BYTES_V1: usize =
    RESTORE_ROLE_IMPORT_COMMAND_MAX_BYTES_V1;
/// Exact operation label authenticated by a restore role-import authorization.
pub const TENANT_ROOT_RESTORE_ROLE_IMPORT_OPERATION_LABEL_V1: &str =
    "tenant_root_restore_role_import_key_issue_v1";

/// One-use nonce binding a restore role-import grant and its issuer command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TenantRootRestoreAuthorizationNonceV1([u8; RESTORE_ROLE_IMPORT_NONCE_BYTES_V1]);

impl TenantRootRestoreAuthorizationNonceV1 {
    /// Parses one non-zero authorization nonce.
    pub fn from_bytes(
        bytes: [u8; RESTORE_ROLE_IMPORT_NONCE_BYTES_V1],
    ) -> RouterAbDerivationResult<Self> {
        require_nonzero(
            &bytes,
            "tenant-root restore authorization nonce must be non-zero",
        )?;
        Ok(Self(bytes))
    }

    /// Draws one fresh authorization nonce.
    pub fn random<R>(rng: &mut R) -> Self
    where
        R: RngCore + CryptoRng,
    {
        loop {
            let mut bytes = [0_u8; RESTORE_ROLE_IMPORT_NONCE_BYTES_V1];
            rng.fill_bytes(&mut bytes);
            if let Ok(nonce) = Self::from_bytes(bytes) {
                return nonce;
            }
        }
    }

    /// Returns the exact nonce bytes.
    pub const fn as_bytes(&self) -> &[u8; RESTORE_ROLE_IMPORT_NONCE_BYTES_V1] {
        &self.0
    }
}

#[derive(Clone, PartialEq, Eq)]
struct TenantRootRestoreRoleImportGrantDataV1 {
    operation_digest: TenantRootProtocolDigestV1,
    destination_identity_digest: TenantRootIdentityDigestV1,
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    destination_lineage: TenantRootCustodyLineageId,
    restore_session_id: TenantRootRestoreSessionIdV1,
    manifest_digest: [u8; 32],
    role: TwoPartyDeriverRole,
    import_key_id: String,
    generation: u64,
    nonce: TenantRootRestoreAuthorizationNonceV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
    grant_key_id: String,
    signature: [u8; 64],
}

impl fmt::Debug for TenantRootRestoreRoleImportGrantDataV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TenantRootRestoreRoleImportGrantDataV1")
            .field("operation_digest", &self.operation_digest)
            .field(
                "destination_identity_digest",
                &self.destination_identity_digest,
            )
            .field("destination_fingerprint", &self.destination_fingerprint)
            .field("destination_lineage", &self.destination_lineage)
            .field("restore_session_id", &self.restore_session_id)
            .field("manifest_digest", &hex::encode(self.manifest_digest))
            .field("role", &self.role)
            .field("import_key_id", &self.import_key_id)
            .field("generation", &self.generation)
            .field("nonce", &self.nonce)
            .field("issued_at_ms", &self.issued_at_ms)
            .field("expires_at_ms", &self.expires_at_ms)
            .field("grant_key_id", &self.grant_key_id)
            .field("signature", &"[redacted]")
            .finish()
    }
}

/// Console admission grant for one exact destination role import-key issue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRestoreRoleImportGrantV1 {
    data: TenantRootRestoreRoleImportGrantDataV1,
}

impl TenantRootRestoreRoleImportGrantV1 {
    /// Signs one exact restore role-import grant.
    #[allow(clippy::too_many_arguments)]
    pub fn sign(
        operation_digest: TenantRootProtocolDigestV1,
        destination_identity_digest: TenantRootIdentityDigestV1,
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        destination_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
        manifest_digest: [u8; 32],
        role: TwoPartyDeriverRole,
        import_key_id: impl Into<String>,
        generation: u64,
        nonce: TenantRootRestoreAuthorizationNonceV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
        grant_key_id: impl Into<String>,
        grant_signing_key_bytes: &[u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        let mut data = TenantRootRestoreRoleImportGrantDataV1 {
            operation_digest,
            destination_identity_digest,
            destination_fingerprint,
            destination_lineage,
            restore_session_id,
            manifest_digest,
            role,
            import_key_id: import_key_id.into(),
            generation,
            nonce,
            issued_at_ms,
            expires_at_ms,
            grant_key_id: grant_key_id.into(),
            signature: [0_u8; 64],
        };
        validate_restore_role_import_grant_unsigned_data(&data)?;
        let unsigned = restore_role_import_grant_unsigned_canonical_bytes(&data)?;
        data.signature = SigningKey::from_bytes(grant_signing_key_bytes)
            .sign(&restore_role_import_grant_authentication_input(
                &data.grant_key_id,
                &unsigned,
            )?)
            .to_bytes();
        validate_restore_role_import_grant_data(&data)?;
        let grant = Self { data };
        grant.canonical_bytes()?;
        Ok(grant)
    }

    /// Decodes exactly one canonical signed restore role-import grant.
    pub fn decode_canonical_bytes(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.is_empty() || bytes.len() > RESTORE_ROLE_IMPORT_GRANT_MAX_BYTES_V1 {
            return Err(malformed(
                "tenant-root restore role-import grant wire length is invalid",
            ));
        }
        let mut decoder = RestoreRoleImportWireDecoderV1::new(bytes);
        decoder.require_field(RESTORE_ROLE_IMPORT_GRANT_DOMAIN_V1)?;
        if decoder.field("tenant-root restore role-import grant operation")?
            != RESTORE_ROLE_IMPORT_OPERATION_V1
        {
            return Err(malformed(
                "tenant-root restore role-import grant operation is invalid",
            ));
        }
        let operation_digest = TenantRootProtocolDigestV1::from_bytes(
            decoder.fixed_field::<32>("tenant-root restore role-import grant operation digest")?,
        )?;
        let destination_identity_digest = TenantRootIdentityDigestV1::from_bytes(
            decoder
                .fixed_field::<32>("tenant-root restore role-import grant destination identity")?,
        );
        let destination_fingerprint =
            TenantRootRestoreDestinationFingerprintV1::from_bytes(decoder.fixed_field::<32>(
                "tenant-root restore role-import grant destination fingerprint",
            )?)?;
        let destination_lineage = TenantRootCustodyLineageId::from_bytes(
            decoder
                .fixed_field::<16>("tenant-root restore role-import grant destination lineage")?,
        )?;
        let restore_session_id = TenantRootRestoreSessionIdV1::from_bytes(
            decoder.fixed_field::<16>("tenant-root restore role-import grant session id")?,
        )?;
        let manifest_digest =
            decoder.fixed_field::<32>("tenant-root restore role-import grant manifest digest")?;
        let role = parse_role(decoder.field("tenant-root restore role-import grant role")?)?;
        let import_key_id = decoder.text_field(
            "tenant-root restore role-import grant import key id",
            RESTORE_ROLE_IMPORT_KEY_ID_MAX_BYTES_V1,
        )?;
        let generation = decoder.u64_field("tenant-root restore role-import grant generation")?;
        let nonce = TenantRootRestoreAuthorizationNonceV1::from_bytes(
            decoder.fixed_field::<32>("tenant-root restore role-import grant nonce")?,
        )?;
        let issued_at_ms = decoder.u64_field("tenant-root restore role-import grant issue time")?;
        let expires_at_ms = decoder.u64_field("tenant-root restore role-import grant expiry")?;
        let grant_key_id = decoder.text_field(
            "tenant-root restore role-import grant authority key id",
            RESTORE_ROLE_IMPORT_AUTHORITY_KEY_ID_MAX_BYTES_V1,
        )?;
        let signature =
            decoder.fixed_field::<64>("tenant-root restore role-import grant signature")?;
        decoder.finish()?;
        let data = TenantRootRestoreRoleImportGrantDataV1 {
            operation_digest,
            destination_identity_digest,
            destination_fingerprint,
            destination_lineage,
            restore_session_id,
            manifest_digest,
            role,
            import_key_id,
            generation,
            nonce,
            issued_at_ms,
            expires_at_ms,
            grant_key_id,
            signature,
        };
        validate_restore_role_import_grant_data(&data)?;
        let grant = Self { data };
        if grant.canonical_bytes()? != bytes {
            return Err(malformed(
                "tenant-root restore role-import grant wire is not canonical",
            ));
        }
        Ok(grant)
    }

    pub fn grant_key_id(&self) -> &str {
        &self.data.grant_key_id
    }

    pub const fn operation_digest(&self) -> TenantRootProtocolDigestV1 {
        self.data.operation_digest
    }

    pub const fn destination_identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.data.destination_identity_digest
    }

    pub const fn destination_fingerprint(&self) -> TenantRootRestoreDestinationFingerprintV1 {
        self.data.destination_fingerprint
    }

    pub const fn destination_lineage(&self) -> TenantRootCustodyLineageId {
        self.data.destination_lineage
    }

    pub const fn restore_session_id(&self) -> TenantRootRestoreSessionIdV1 {
        self.data.restore_session_id
    }

    pub const fn manifest_digest(&self) -> &[u8; 32] {
        &self.data.manifest_digest
    }

    pub const fn role(&self) -> TwoPartyDeriverRole {
        self.data.role
    }

    pub fn import_key_id(&self) -> &str {
        &self.data.import_key_id
    }

    pub const fn generation(&self) -> u64 {
        self.data.generation
    }

    pub const fn nonce(&self) -> TenantRootRestoreAuthorizationNonceV1 {
        self.data.nonce
    }

    pub const fn issued_at_ms(&self) -> u64 {
        self.data.issued_at_ms
    }

    pub const fn expires_at_ms(&self) -> u64 {
        self.data.expires_at_ms
    }

    pub fn canonical_bytes(&self) -> RouterAbDerivationResult<Vec<u8>> {
        let unsigned = restore_role_import_grant_unsigned_canonical_bytes(&self.data)?;
        restore_role_import_signed_canonical_bytes(
            unsigned,
            &self.data.signature,
            RESTORE_ROLE_IMPORT_GRANT_MAX_BYTES_V1,
        )
    }

    pub fn digest(&self) -> RouterAbDerivationResult<TenantRootProtocolDigestV1> {
        TenantRootProtocolDigestV1::from_bytes(Sha256::digest(self.canonical_bytes()?).into())
    }

    /// Verifies the grant under the verifier's configured grant authority.
    pub fn verify(
        &self,
        expected_grant_key_id: &str,
        trusted_grant_verifying_key: &[u8; 32],
    ) -> RouterAbDerivationResult<VerifiedTenantRootRestoreRoleImportGrantV1> {
        validate_restore_role_import_grant_data(&self.data)?;
        validate_restore_role_import_authority_key_id(expected_grant_key_id)?;
        if self.data.grant_key_id != expected_grant_key_id {
            return Err(replay_mismatch(
                "tenant-root restore role-import grant key id does not match its expected authority",
            ));
        }
        let verifying_key =
            VerifyingKey::from_bytes(trusted_grant_verifying_key).map_err(|_| {
                verification_failed(
                    "tenant-root restore role-import grant authority key is invalid",
                )
            })?;
        let unsigned = restore_role_import_grant_unsigned_canonical_bytes(&self.data)?;
        verifying_key
            .verify_strict(
                &restore_role_import_grant_authentication_input(
                    &self.data.grant_key_id,
                    &unsigned,
                )?,
                &Signature::from_bytes(&self.data.signature),
            )
            .map_err(|_| {
                verification_failed("tenant-root restore role-import grant signature is invalid")
            })?;
        let canonical_bytes = restore_role_import_signed_canonical_bytes(
            unsigned,
            &self.data.signature,
            RESTORE_ROLE_IMPORT_GRANT_MAX_BYTES_V1,
        )?;
        let digest =
            TenantRootProtocolDigestV1::from_bytes(Sha256::digest(&canonical_bytes).into())?;
        Ok(VerifiedTenantRootRestoreRoleImportGrantV1 {
            grant: self.clone(),
            canonical_bytes,
            digest,
        })
    }
}

/// A restore role-import grant verified under the control plane's configured authority.
pub struct VerifiedTenantRootRestoreRoleImportGrantV1 {
    grant: TenantRootRestoreRoleImportGrantV1,
    canonical_bytes: Vec<u8>,
    digest: TenantRootProtocolDigestV1,
}

impl fmt::Debug for VerifiedTenantRootRestoreRoleImportGrantV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("VerifiedTenantRootRestoreRoleImportGrantV1")
            .field("digest", &self.digest)
            .field("canonical_bytes", &"[public bytes]")
            .finish()
    }
}

impl VerifiedTenantRootRestoreRoleImportGrantV1 {
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

    pub const fn role(&self) -> TwoPartyDeriverRole {
        self.grant.role()
    }

    pub fn import_key_id(&self) -> &str {
        self.grant.import_key_id()
    }

    pub const fn generation(&self) -> u64 {
        self.grant.generation()
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

    pub const fn digest(&self) -> TenantRootProtocolDigestV1 {
        self.digest
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub fn require_fresh(&self, now_ms: u64) -> RouterAbDerivationResult<()> {
        if now_ms < self.issued_at_ms() || now_ms >= self.expires_at_ms() {
            return Err(replay_mismatch(
                "tenant-root restore role-import grant is outside its freshness window",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, PartialEq, Eq)]
struct TenantRootRestoreRoleImportCommandDataV1 {
    operation_digest: TenantRootProtocolDigestV1,
    grant_digest: TenantRootProtocolDigestV1,
    destination_identity_digest: TenantRootIdentityDigestV1,
    source_custody_lineage: TenantRootCustodyLineageId,
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    destination_lineage: TenantRootCustodyLineageId,
    restore_session_id: TenantRootRestoreSessionIdV1,
    manifest_digest: [u8; 32],
    recovery_set_id: TenantRootRecoverySetId,
    role: TwoPartyDeriverRole,
    share_id: ThresholdShareId,
    source_package_digest: TenantRootRecoveryPackageDigestV1,
    stable_root_commitment: TwoPartyRootCommitment,
    recovery_share_commitment: SigningRootShareCommitment,
    recipient_public_key: TenantRootRecoveryRecipientPublicKeyV1,
    recipient_fingerprint: TenantRootRecoveryRecipientFingerprintV1,
    deriver_signing_key_id: String,
    import_key_id: String,
    generation: u64,
    nonce: TenantRootRestoreAuthorizationNonceV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
    issuer_key_id: String,
    signature: [u8; 64],
}

impl fmt::Debug for TenantRootRestoreRoleImportCommandDataV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TenantRootRestoreRoleImportCommandDataV1")
            .field("operation_digest", &self.operation_digest)
            .field("grant_digest", &self.grant_digest)
            .field(
                "destination_identity_digest",
                &self.destination_identity_digest,
            )
            .field("source_custody_lineage", &self.source_custody_lineage)
            .field("destination_fingerprint", &self.destination_fingerprint)
            .field("destination_lineage", &self.destination_lineage)
            .field("restore_session_id", &self.restore_session_id)
            .field("manifest_digest", &hex::encode(self.manifest_digest))
            .field("recovery_set_id", &self.recovery_set_id)
            .field("role", &self.role)
            .field("share_id", &self.share_id)
            .field("source_package_digest", &self.source_package_digest)
            .field("stable_root_commitment", &self.stable_root_commitment)
            .field("recovery_share_commitment", &self.recovery_share_commitment)
            .field("recipient_public_key", &self.recipient_public_key)
            .field("recipient_fingerprint", &self.recipient_fingerprint)
            .field("deriver_signing_key_id", &self.deriver_signing_key_id)
            .field("import_key_id", &self.import_key_id)
            .field("generation", &self.generation)
            .field("nonce", &self.nonce)
            .field("issued_at_ms", &self.issued_at_ms)
            .field("expires_at_ms", &self.expires_at_ms)
            .field("issuer_key_id", &self.issuer_key_id)
            .field("signature", &"[redacted]")
            .finish()
    }
}

/// Control-plane issuer command for one exact destination role import-key issue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRestoreRoleImportCommandV1 {
    data: TenantRootRestoreRoleImportCommandDataV1,
}

impl TenantRootRestoreRoleImportCommandV1 {
    /// Derives descriptor bindings from a verified manifest and signs one command.
    pub fn sign(
        grant: &VerifiedTenantRootRestoreRoleImportGrantV1,
        manifest: &TenantRootRecoveryManifestV1,
        issuer_key_id: impl Into<String>,
        issuer_signing_key_bytes: &[u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        let manifest_digest = manifest.digest()?;
        if manifest_digest != *grant.manifest_digest() {
            return Err(replay_mismatch(
                "tenant-root restore role-import manifest digest does not match its grant",
            ));
        }
        let descriptor = manifest.descriptor();
        if descriptor.tenant_root_identity_digest() != grant.destination_identity_digest() {
            return Err(replay_mismatch(
                "tenant-root restore role-import manifest identity does not match its destination grant",
            ));
        }
        let role_descriptor = descriptor.role(grant.role());
        let mut data = TenantRootRestoreRoleImportCommandDataV1 {
            operation_digest: grant.operation_digest(),
            grant_digest: grant.digest(),
            destination_identity_digest: grant.destination_identity_digest(),
            source_custody_lineage: descriptor.source_custody_lineage(),
            destination_fingerprint: grant.destination_fingerprint(),
            destination_lineage: grant.destination_lineage(),
            restore_session_id: grant.restore_session_id(),
            manifest_digest,
            recovery_set_id: descriptor.recovery_set_id(),
            role: grant.role(),
            share_id: role_descriptor.share_id(),
            source_package_digest: match grant.role() {
                TwoPartyDeriverRole::DeriverA => manifest.deriver_a_package_digest(),
                TwoPartyDeriverRole::DeriverB => manifest.deriver_b_package_digest(),
            },
            stable_root_commitment: descriptor.stable_root_commitment(),
            recovery_share_commitment: role_descriptor.recovery_share_commitment(),
            recipient_public_key: role_descriptor.recipient_public_key(),
            recipient_fingerprint: role_descriptor.recipient_fingerprint(),
            deriver_signing_key_id: role_descriptor.deriver_signing_key_id().to_owned(),
            import_key_id: grant.import_key_id().to_owned(),
            generation: grant.generation(),
            nonce: grant.nonce(),
            issued_at_ms: grant.issued_at_ms(),
            expires_at_ms: grant.expires_at_ms(),
            issuer_key_id: issuer_key_id.into(),
            signature: [0_u8; 64],
        };
        validate_restore_role_import_command_unsigned_data(&data)?;
        let unsigned = restore_role_import_command_unsigned_canonical_bytes(&data)?;
        data.signature = SigningKey::from_bytes(issuer_signing_key_bytes)
            .sign(&restore_role_import_command_authentication_input(
                &data.issuer_key_id,
                &unsigned,
            )?)
            .to_bytes();
        validate_restore_role_import_command_data(&data)?;
        let command = Self { data };
        command.canonical_bytes()?;
        Ok(command)
    }

    /// Decodes exactly one canonical signed restore role-import command.
    pub fn decode_canonical_bytes(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.is_empty() || bytes.len() > RESTORE_ROLE_IMPORT_COMMAND_MAX_BYTES_V1 {
            return Err(malformed(
                "tenant-root restore role-import command wire length is invalid",
            ));
        }
        let mut decoder = RestoreRoleImportWireDecoderV1::new(bytes);
        decoder.require_field(RESTORE_ROLE_IMPORT_COMMAND_DOMAIN_V1)?;
        if decoder.field("tenant-root restore role-import command operation")?
            != RESTORE_ROLE_IMPORT_OPERATION_V1
        {
            return Err(malformed(
                "tenant-root restore role-import command operation is invalid",
            ));
        }
        let operation_digest = TenantRootProtocolDigestV1::from_bytes(
            decoder
                .fixed_field::<32>("tenant-root restore role-import command operation digest")?,
        )?;
        let grant_digest = TenantRootProtocolDigestV1::from_bytes(
            decoder.fixed_field::<32>("tenant-root restore role-import command grant digest")?,
        )?;
        let destination_identity_digest =
            TenantRootIdentityDigestV1::from_bytes(decoder.fixed_field::<32>(
                "tenant-root restore role-import command destination identity",
            )?);
        let source_custody_lineage = TenantRootCustodyLineageId::from_bytes(
            decoder.fixed_field::<16>("tenant-root restore role-import command source lineage")?,
        )?;
        let destination_fingerprint =
            TenantRootRestoreDestinationFingerprintV1::from_bytes(decoder.fixed_field::<32>(
                "tenant-root restore role-import command destination fingerprint",
            )?)?;
        let destination_lineage = TenantRootCustodyLineageId::from_bytes(
            decoder
                .fixed_field::<16>("tenant-root restore role-import command destination lineage")?,
        )?;
        let restore_session_id = TenantRootRestoreSessionIdV1::from_bytes(
            decoder.fixed_field::<16>("tenant-root restore role-import command session id")?,
        )?;
        let manifest_digest =
            decoder.fixed_field::<32>("tenant-root restore role-import command manifest digest")?;
        let recovery_set_id = TenantRootRecoverySetId::from_bytes(
            decoder.fixed_field::<16>("tenant-root restore role-import command recovery set id")?,
        )?;
        let role = parse_role(decoder.field("tenant-root restore role-import command role")?)?;
        let share_id = ThresholdShareId::from_u16(u16::from_be_bytes(
            decoder.fixed_field::<2>("tenant-root restore role-import command share id")?,
        ))
        .map_err(|_| malformed("tenant-root restore role-import command share id is invalid"))?;
        let source_package_digest = TenantRootRecoveryPackageDigestV1::from_bytes(
            decoder.fixed_field::<32>("tenant-root restore role-import command package digest")?,
        );
        let stable_root_commitment = TwoPartyRootCommitment::from_bytes(
            decoder.fixed_field::<32>(
                "tenant-root restore role-import command stable root commitment",
            )?,
        )
        .map_err(|_| {
            malformed("tenant-root restore role-import command stable root commitment is invalid")
        })?;
        let recovery_share_commitment = SigningRootShareCommitment::from_bytes(
            decoder.fixed_field::<{ SigningRootShareCommitment::LEN }>(
                "tenant-root restore role-import command share commitment",
            )?,
        )
        .map_err(|_| {
            malformed("tenant-root restore role-import command share commitment is invalid")
        })?;
        let recipient_public_key =
            TenantRootRecoveryRecipientPublicKeyV1::from_bytes(decoder.fixed_field::<32>(
                "tenant-root restore role-import command recipient public key",
            )?)?;
        let recipient_fingerprint =
            TenantRootRecoveryRecipientFingerprintV1::from_bytes(decoder.fixed_field::<32>(
                "tenant-root restore role-import command recipient fingerprint",
            )?);
        let deriver_signing_key_id = decoder.text_field(
            "tenant-root restore role-import command Deriver signing key id",
            RESTORE_ROLE_IMPORT_AUTHORITY_KEY_ID_MAX_BYTES_V1,
        )?;
        let import_key_id = decoder.text_field(
            "tenant-root restore role-import command import key id",
            RESTORE_ROLE_IMPORT_KEY_ID_MAX_BYTES_V1,
        )?;
        let generation = decoder.u64_field("tenant-root restore role-import command generation")?;
        let nonce = TenantRootRestoreAuthorizationNonceV1::from_bytes(
            decoder.fixed_field::<32>("tenant-root restore role-import command nonce")?,
        )?;
        let issued_at_ms =
            decoder.u64_field("tenant-root restore role-import command issue time")?;
        let expires_at_ms = decoder.u64_field("tenant-root restore role-import command expiry")?;
        let issuer_key_id = decoder.text_field(
            "tenant-root restore role-import command issuer key id",
            RESTORE_ROLE_IMPORT_AUTHORITY_KEY_ID_MAX_BYTES_V1,
        )?;
        let signature =
            decoder.fixed_field::<64>("tenant-root restore role-import command signature")?;
        decoder.finish()?;
        let data = TenantRootRestoreRoleImportCommandDataV1 {
            operation_digest,
            grant_digest,
            destination_identity_digest,
            source_custody_lineage,
            destination_fingerprint,
            destination_lineage,
            restore_session_id,
            manifest_digest,
            recovery_set_id,
            role,
            share_id,
            source_package_digest,
            stable_root_commitment,
            recovery_share_commitment,
            recipient_public_key,
            recipient_fingerprint,
            deriver_signing_key_id,
            import_key_id,
            generation,
            nonce,
            issued_at_ms,
            expires_at_ms,
            issuer_key_id,
            signature,
        };
        validate_restore_role_import_command_data(&data)?;
        let command = Self { data };
        if command.canonical_bytes()? != bytes {
            return Err(malformed(
                "tenant-root restore role-import command wire is not canonical",
            ));
        }
        Ok(command)
    }

    pub fn issuer_key_id(&self) -> &str {
        &self.data.issuer_key_id
    }

    pub const fn operation_digest(&self) -> TenantRootProtocolDigestV1 {
        self.data.operation_digest
    }

    pub const fn grant_digest(&self) -> TenantRootProtocolDigestV1 {
        self.data.grant_digest
    }

    pub const fn destination_identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.data.destination_identity_digest
    }

    pub const fn source_custody_lineage(&self) -> TenantRootCustodyLineageId {
        self.data.source_custody_lineage
    }

    pub const fn destination_fingerprint(&self) -> TenantRootRestoreDestinationFingerprintV1 {
        self.data.destination_fingerprint
    }

    pub const fn destination_lineage(&self) -> TenantRootCustodyLineageId {
        self.data.destination_lineage
    }

    pub const fn restore_session_id(&self) -> TenantRootRestoreSessionIdV1 {
        self.data.restore_session_id
    }

    pub const fn manifest_digest(&self) -> &[u8; 32] {
        &self.data.manifest_digest
    }

    pub const fn recovery_set_id(&self) -> TenantRootRecoverySetId {
        self.data.recovery_set_id
    }

    pub const fn role(&self) -> TwoPartyDeriverRole {
        self.data.role
    }

    pub const fn share_id(&self) -> ThresholdShareId {
        self.data.share_id
    }

    pub const fn source_package_digest(&self) -> TenantRootRecoveryPackageDigestV1 {
        self.data.source_package_digest
    }

    pub const fn stable_root_commitment(&self) -> TwoPartyRootCommitment {
        self.data.stable_root_commitment
    }

    pub const fn recovery_share_commitment(&self) -> SigningRootShareCommitment {
        self.data.recovery_share_commitment
    }

    pub const fn recipient_public_key(&self) -> TenantRootRecoveryRecipientPublicKeyV1 {
        self.data.recipient_public_key
    }

    pub const fn recipient_fingerprint(&self) -> TenantRootRecoveryRecipientFingerprintV1 {
        self.data.recipient_fingerprint
    }

    pub fn deriver_signing_key_id(&self) -> &str {
        &self.data.deriver_signing_key_id
    }

    pub fn import_key_id(&self) -> &str {
        &self.data.import_key_id
    }

    pub const fn generation(&self) -> u64 {
        self.data.generation
    }

    pub const fn nonce(&self) -> TenantRootRestoreAuthorizationNonceV1 {
        self.data.nonce
    }

    pub const fn issued_at_ms(&self) -> u64 {
        self.data.issued_at_ms
    }

    pub const fn expires_at_ms(&self) -> u64 {
        self.data.expires_at_ms
    }

    pub fn canonical_bytes(&self) -> RouterAbDerivationResult<Vec<u8>> {
        let unsigned = restore_role_import_command_unsigned_canonical_bytes(&self.data)?;
        restore_role_import_signed_canonical_bytes(
            unsigned,
            &self.data.signature,
            RESTORE_ROLE_IMPORT_COMMAND_MAX_BYTES_V1,
        )
    }

    pub fn digest(&self) -> RouterAbDerivationResult<TenantRootProtocolDigestV1> {
        TenantRootProtocolDigestV1::from_bytes(Sha256::digest(self.canonical_bytes()?).into())
    }

    /// Verifies this command under the control plane issuer configured by the Deriver.
    pub fn verify(
        &self,
        expected_issuer_key_id: &str,
        trusted_issuer_verifying_key: &[u8; 32],
    ) -> RouterAbDerivationResult<VerifiedTenantRootRestoreRoleImportCommandV1> {
        validate_restore_role_import_command_data(&self.data)?;
        validate_restore_role_import_authority_key_id(expected_issuer_key_id)?;
        if self.data.issuer_key_id != expected_issuer_key_id {
            return Err(replay_mismatch(
                "tenant-root restore role-import command key id does not match its expected issuer",
            ));
        }
        let verifying_key =
            VerifyingKey::from_bytes(trusted_issuer_verifying_key).map_err(|_| {
                verification_failed("tenant-root restore role-import command issuer key is invalid")
            })?;
        let unsigned = restore_role_import_command_unsigned_canonical_bytes(&self.data)?;
        verifying_key
            .verify_strict(
                &restore_role_import_command_authentication_input(
                    &self.data.issuer_key_id,
                    &unsigned,
                )?,
                &Signature::from_bytes(&self.data.signature),
            )
            .map_err(|_| {
                verification_failed("tenant-root restore role-import command signature is invalid")
            })?;
        let canonical_bytes = restore_role_import_signed_canonical_bytes(
            unsigned,
            &self.data.signature,
            RESTORE_ROLE_IMPORT_COMMAND_MAX_BYTES_V1,
        )?;
        let digest =
            TenantRootProtocolDigestV1::from_bytes(Sha256::digest(&canonical_bytes).into())?;
        Ok(VerifiedTenantRootRestoreRoleImportCommandV1 {
            command: self.clone(),
            canonical_bytes,
            digest,
        })
    }
}

/// An issuer-signed restore role-import command verified at a Deriver boundary.
pub struct VerifiedTenantRootRestoreRoleImportCommandV1 {
    command: TenantRootRestoreRoleImportCommandV1,
    canonical_bytes: Vec<u8>,
    digest: TenantRootProtocolDigestV1,
}

impl fmt::Debug for VerifiedTenantRootRestoreRoleImportCommandV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("VerifiedTenantRootRestoreRoleImportCommandV1")
            .field("digest", &self.digest)
            .field("canonical_bytes", &"[public bytes]")
            .finish()
    }
}

impl VerifiedTenantRootRestoreRoleImportCommandV1 {
    pub const fn operation_digest(&self) -> TenantRootProtocolDigestV1 {
        self.command.operation_digest()
    }

    pub const fn grant_digest(&self) -> TenantRootProtocolDigestV1 {
        self.command.grant_digest()
    }

    pub const fn destination_identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.command.destination_identity_digest()
    }

    pub const fn source_custody_lineage(&self) -> TenantRootCustodyLineageId {
        self.command.source_custody_lineage()
    }

    pub const fn destination_fingerprint(&self) -> TenantRootRestoreDestinationFingerprintV1 {
        self.command.destination_fingerprint()
    }

    pub const fn destination_lineage(&self) -> TenantRootCustodyLineageId {
        self.command.destination_lineage()
    }

    pub const fn restore_session_id(&self) -> TenantRootRestoreSessionIdV1 {
        self.command.restore_session_id()
    }

    pub const fn manifest_digest(&self) -> &[u8; 32] {
        self.command.manifest_digest()
    }

    pub const fn recovery_set_id(&self) -> TenantRootRecoverySetId {
        self.command.recovery_set_id()
    }

    pub const fn role(&self) -> TwoPartyDeriverRole {
        self.command.role()
    }

    pub const fn share_id(&self) -> ThresholdShareId {
        self.command.share_id()
    }

    pub const fn source_package_digest(&self) -> TenantRootRecoveryPackageDigestV1 {
        self.command.source_package_digest()
    }

    pub const fn stable_root_commitment(&self) -> TwoPartyRootCommitment {
        self.command.stable_root_commitment()
    }

    pub const fn recovery_share_commitment(&self) -> SigningRootShareCommitment {
        self.command.recovery_share_commitment()
    }

    pub const fn recipient_public_key(&self) -> TenantRootRecoveryRecipientPublicKeyV1 {
        self.command.recipient_public_key()
    }

    pub const fn recipient_fingerprint(&self) -> TenantRootRecoveryRecipientFingerprintV1 {
        self.command.recipient_fingerprint()
    }

    pub fn deriver_signing_key_id(&self) -> &str {
        self.command.deriver_signing_key_id()
    }

    pub fn import_key_id(&self) -> &str {
        self.command.import_key_id()
    }

    pub const fn generation(&self) -> u64 {
        self.command.generation()
    }

    pub const fn nonce(&self) -> TenantRootRestoreAuthorizationNonceV1 {
        self.command.nonce()
    }

    pub const fn issued_at_ms(&self) -> u64 {
        self.command.issued_at_ms()
    }

    pub const fn expires_at_ms(&self) -> u64 {
        self.command.expires_at_ms()
    }

    pub fn issuer_key_id(&self) -> &str {
        self.command.issuer_key_id()
    }

    pub const fn digest(&self) -> TenantRootProtocolDigestV1 {
        self.digest
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub fn require_fresh(&self, now_ms: u64) -> RouterAbDerivationResult<()> {
        if now_ms < self.issued_at_ms() || now_ms >= self.expires_at_ms() {
            return Err(replay_mismatch(
                "tenant-root restore role-import command is outside its freshness window",
            ));
        }
        Ok(())
    }
}

/// Public fingerprint of one empty destination deployment.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct TenantRootRestoreDestinationFingerprintV1([u8; RESTORE_IMPORT_KEY_BYTES]);

impl TenantRootRestoreDestinationFingerprintV1 {
    pub fn from_bytes(bytes: [u8; RESTORE_IMPORT_KEY_BYTES]) -> RouterAbDerivationResult<Self> {
        require_nonzero(
            &bytes,
            "destination deployment fingerprint must be non-zero",
        )?;
        Ok(Self(bytes))
    }

    pub const fn as_bytes(&self) -> &[u8; RESTORE_IMPORT_KEY_BYTES] {
        &self.0
    }
}

impl fmt::Debug for TenantRootRestoreDestinationFingerprintV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("TenantRootRestoreDestinationFingerprintV1")
            .field(&hex::encode(self.0))
            .finish()
    }
}

/// Public identifier for one destination restore session.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct TenantRootRestoreSessionIdV1([u8; RESTORE_IMPORT_ID_BYTES]);

impl TenantRootRestoreSessionIdV1 {
    pub fn from_bytes(bytes: [u8; RESTORE_IMPORT_ID_BYTES]) -> RouterAbDerivationResult<Self> {
        require_nonzero(&bytes, "tenant-root restore session id must be non-zero")?;
        Ok(Self(bytes))
    }

    pub const fn as_bytes(&self) -> &[u8; RESTORE_IMPORT_ID_BYTES] {
        &self.0
    }
}

impl fmt::Debug for TenantRootRestoreSessionIdV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("TenantRootRestoreSessionIdV1")
            .field(&hex::encode(self.0))
            .finish()
    }
}

/// Canonical destination role import public key.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct TenantRootRestoreImportPublicKeyV1([u8; RESTORE_IMPORT_KEY_BYTES]);

impl TenantRootRestoreImportPublicKeyV1 {
    pub fn from_bytes(bytes: [u8; RESTORE_IMPORT_KEY_BYTES]) -> RouterAbDerivationResult<Self> {
        validate_x25519_public_key(&bytes, "tenant-root restore import public key")?;
        Ok(Self(bytes))
    }

    pub const fn as_bytes(&self) -> &[u8; RESTORE_IMPORT_KEY_BYTES] {
        &self.0
    }

    pub fn digest(&self) -> [u8; 32] {
        Sha256::digest(self.0).into()
    }
}

impl fmt::Debug for TenantRootRestoreImportPublicKeyV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("TenantRootRestoreImportPublicKeyV1")
            .field(&hex::encode(self.0))
            .finish()
    }
}

/// One-use role-local import keypair created inside the destination Deriver.
pub struct TenantRootRestoreImportKeypairV1 {
    private_key: Zeroizing<[u8; RESTORE_IMPORT_KEY_BYTES]>,
    public_key: TenantRootRestoreImportPublicKeyV1,
}

impl TenantRootRestoreImportKeypairV1 {
    pub fn derive_from_ikm(ikm: [u8; RESTORE_IMPORT_KEY_BYTES]) -> RouterAbDerivationResult<Self> {
        let mut ikm = Zeroizing::new(ikm);
        require_nonzero(
            ikm.as_ref(),
            "tenant-root restore import IKM must be non-zero",
        )?;
        let (private_key, public_key) = DhKemX25519HkdfSha256::derive_key_pair(ikm.as_ref())
            .map_err(|_| malformed("tenant-root restore import key derivation failed"))?;
        let private_key: [u8; RESTORE_IMPORT_KEY_BYTES] =
            DhKemX25519HkdfSha256::sk_to_bytes(&private_key)
                .as_slice()
                .try_into()
                .map_err(|_| malformed("tenant-root restore import private key is invalid"))?;
        let public_key: [u8; RESTORE_IMPORT_KEY_BYTES] =
            DhKemX25519HkdfSha256::pk_to_bytes(&public_key)
                .as_slice()
                .try_into()
                .map_err(|_| malformed("tenant-root restore import public key is invalid"))?;
        ikm.zeroize();
        Ok(Self {
            private_key: Zeroizing::new(private_key),
            public_key: TenantRootRestoreImportPublicKeyV1::from_bytes(public_key)?,
        })
    }

    pub const fn public_key(&self) -> TenantRootRestoreImportPublicKeyV1 {
        self.public_key
    }
}

impl fmt::Debug for TenantRootRestoreImportKeypairV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TenantRootRestoreImportKeypairV1")
            .field("private_key", &"[redacted]")
            .field("public_key", &self.public_key)
            .finish()
    }
}

/// Exact source and destination metadata authenticated by one role import envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRestoreImportBindingV1 {
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    destination_lineage: TenantRootCustodyLineageId,
    restore_session_id: TenantRootRestoreSessionIdV1,
    identity_digest: TenantRootIdentityDigestV1,
    recovery_set_id: TenantRootRecoverySetId,
    manifest_digest: [u8; 32],
    source_package_digest: TenantRootRecoveryPackageDigestV1,
    stable_root_commitment: TwoPartyRootCommitment,
    recovery_share_commitment: SigningRootShareCommitment,
    role: TwoPartyDeriverRole,
    share_id: ThresholdShareId,
    import_key_id: String,
    import_public_key_digest: [u8; 32],
    issued_at_ms: u64,
    expires_at_ms: u64,
}

impl TenantRootRestoreImportBindingV1 {
    #[allow(clippy::too_many_arguments)]
    fn new(
        source: &VerifiedTenantRootRecoveryRoleShareV1,
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        destination_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
        import_key_id: impl Into<String>,
        import_public_key: TenantRootRestoreImportPublicKeyV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> RouterAbDerivationResult<Self> {
        let binding = Self {
            destination_fingerprint,
            destination_lineage,
            restore_session_id,
            identity_digest: source.tenant_root_identity_digest(),
            recovery_set_id: source.recovery_set_id(),
            manifest_digest: *source.manifest_digest(),
            source_package_digest: source.package_digest(),
            stable_root_commitment: source.stable_root_commitment(),
            recovery_share_commitment: source.recovery_share_commitment(),
            role: source.role(),
            share_id: source.role().share_id(),
            import_key_id: import_key_id.into(),
            import_public_key_digest: import_public_key.digest(),
            issued_at_ms,
            expires_at_ms,
        };
        binding.validate()?;
        Ok(binding)
    }

    fn from_verified_command(
        command: &VerifiedTenantRootRestoreRoleImportCommandV1,
        import_public_key: TenantRootRestoreImportPublicKeyV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> RouterAbDerivationResult<Self> {
        let expected_expires_at_ms = command
            .issued_at_ms()
            .checked_add(TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1 as u64)
            .ok_or_else(|| malformed("tenant-root restore import key lifetime overflows"))?;
        if issued_at_ms != command.issued_at_ms() || expires_at_ms != expected_expires_at_ms {
            return Err(replay_mismatch(
                "tenant-root restore import key window does not match its verified command",
            ));
        }
        let binding = Self {
            destination_fingerprint: command.destination_fingerprint(),
            destination_lineage: command.destination_lineage(),
            restore_session_id: command.restore_session_id(),
            identity_digest: command.destination_identity_digest(),
            recovery_set_id: command.recovery_set_id(),
            manifest_digest: *command.manifest_digest(),
            source_package_digest: command.source_package_digest(),
            stable_root_commitment: command.stable_root_commitment(),
            recovery_share_commitment: command.recovery_share_commitment(),
            role: command.role(),
            share_id: command.share_id(),
            import_key_id: command.import_key_id().to_owned(),
            import_public_key_digest: import_public_key.digest(),
            issued_at_ms,
            expires_at_ms,
        };
        binding.validate()?;
        Ok(binding)
    }

    pub const fn role(&self) -> TwoPartyDeriverRole {
        self.role
    }

    pub const fn destination_fingerprint(&self) -> TenantRootRestoreDestinationFingerprintV1 {
        self.destination_fingerprint
    }

    pub const fn recovery_share_commitment(&self) -> SigningRootShareCommitment {
        self.recovery_share_commitment
    }

    pub const fn destination_lineage(&self) -> TenantRootCustodyLineageId {
        self.destination_lineage
    }

    pub const fn restore_session_id(&self) -> TenantRootRestoreSessionIdV1 {
        self.restore_session_id
    }

    pub const fn destination_identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.identity_digest
    }

    pub const fn recovery_set_id(&self) -> TenantRootRecoverySetId {
        self.recovery_set_id
    }

    pub const fn manifest_digest(&self) -> &[u8; 32] {
        &self.manifest_digest
    }

    pub const fn source_package_digest(&self) -> TenantRootRecoveryPackageDigestV1 {
        self.source_package_digest
    }

    pub const fn stable_root_commitment(&self) -> TwoPartyRootCommitment {
        self.stable_root_commitment
    }

    pub fn import_key_id(&self) -> &str {
        &self.import_key_id
    }

    pub const fn import_public_key_digest(&self) -> &[u8; 32] {
        &self.import_public_key_digest
    }

    pub const fn issued_at_ms(&self) -> u64 {
        self.issued_at_ms
    }

    pub const fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }

    pub fn canonical_aad_bytes(&self) -> RouterAbDerivationResult<Vec<u8>> {
        self.validate()?;
        let mut bytes = Vec::with_capacity(512);
        push_lp32(&mut bytes, RESTORE_IMPORT_DOMAIN_V1)?;
        push_lp32(&mut bytes, self.destination_fingerprint.as_bytes())?;
        push_lp32(&mut bytes, self.destination_lineage.as_bytes())?;
        push_lp32(&mut bytes, self.restore_session_id.as_bytes())?;
        push_lp32(&mut bytes, self.identity_digest.as_bytes())?;
        push_lp32(&mut bytes, self.recovery_set_id.as_bytes())?;
        push_lp32(&mut bytes, &self.manifest_digest)?;
        push_lp32(&mut bytes, self.source_package_digest.as_bytes())?;
        push_lp32(&mut bytes, &self.stable_root_commitment.to_bytes())?;
        push_lp32(&mut bytes, &self.recovery_share_commitment.to_bytes())?;
        push_lp32(&mut bytes, self.role.as_str().as_bytes())?;
        push_lp32(&mut bytes, &self.share_id.get().get().to_be_bytes())?;
        push_lp32(&mut bytes, self.import_key_id.as_bytes())?;
        push_lp32(&mut bytes, &self.import_public_key_digest)?;
        push_lp32(&mut bytes, &self.issued_at_ms.to_be_bytes())?;
        push_lp32(&mut bytes, &self.expires_at_ms.to_be_bytes())?;
        Ok(bytes)
    }

    fn validate(&self) -> RouterAbDerivationResult<()> {
        if self.share_id != self.role.share_id()
            || self.recovery_share_commitment.id() != self.share_id
        {
            return Err(malformed(
                "tenant-root restore import role binding is invalid",
            ));
        }
        validate_key_id(&self.import_key_id)?;
        require_nonzero(
            &self.import_public_key_digest,
            "tenant-root restore import public-key digest must be non-zero",
        )?;
        if self.issued_at_ms == 0 || self.expires_at_ms <= self.issued_at_ms {
            return Err(malformed(
                "tenant-root restore import time window is invalid",
            ));
        }
        Ok(())
    }
}

/// Authoritative destination expectation required before an import envelope can be opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpectedTenantRootRestoreImportV1 {
    binding: TenantRootRestoreImportBindingV1,
    import_public_key: TenantRootRestoreImportPublicKeyV1,
}

impl ExpectedTenantRootRestoreImportV1 {
    /// Creates an import expectation from a manifest-verified source role and one destination session.
    #[allow(clippy::too_many_arguments)]
    pub fn from_verified_source(
        source: &VerifiedTenantRootRecoveryRoleShareV1,
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        destination_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
        import_key_id: impl Into<String>,
        import_public_key: TenantRootRestoreImportPublicKeyV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> RouterAbDerivationResult<Self> {
        Ok(Self {
            binding: TenantRootRestoreImportBindingV1::new(
                source,
                destination_fingerprint,
                destination_lineage,
                restore_session_id,
                import_key_id,
                import_public_key,
                issued_at_ms,
                expires_at_ms,
            )?,
            import_public_key,
        })
    }

    /// Creates a destination expectation from the Deriver's verified command
    /// and the public key metadata retained in its role-private store.
    ///
    /// A destination has no source share to inspect. The command is the
    /// authenticated source metadata, while the persisted key window remains
    /// authoritative for opening a previously issued envelope.
    pub fn from_verified_command(
        command: &VerifiedTenantRootRestoreRoleImportCommandV1,
        import_public_key: TenantRootRestoreImportPublicKeyV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> RouterAbDerivationResult<Self> {
        Ok(Self {
            binding: TenantRootRestoreImportBindingV1::from_verified_command(
                command,
                import_public_key,
                issued_at_ms,
                expires_at_ms,
            )?,
            import_public_key,
        })
    }

    /// Returns the exact source and destination metadata authorized for this import.
    pub const fn binding(&self) -> &TenantRootRestoreImportBindingV1 {
        &self.binding
    }

    fn validate(&self) -> RouterAbDerivationResult<()> {
        self.binding.validate()?;
        if !bool::from(
            self.binding
                .import_public_key_digest
                .ct_eq(&self.import_public_key.digest()),
        ) {
            return Err(malformed(
                "tenant-root restore import expectation key does not match binding",
            ));
        }
        Ok(())
    }
}

/// Recipient-encrypted role share ready for one destination import key.
#[derive(Clone, PartialEq, Eq)]
pub struct TenantRootRestoreImportEnvelopeV1 {
    binding: TenantRootRestoreImportBindingV1,
    encapsulated_key: [u8; RESTORE_IMPORT_KEY_BYTES],
    ciphertext: Vec<u8>,
}

impl fmt::Debug for TenantRootRestoreImportEnvelopeV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TenantRootRestoreImportEnvelopeV1")
            .field("binding", &self.binding)
            .field("encapsulated_key", &hex::encode(self.encapsulated_key))
            .field("ciphertext", &"[redacted]")
            .finish()
    }
}

impl TenantRootRestoreImportEnvelopeV1 {
    pub fn seal<R>(
        source: &VerifiedTenantRootRecoveryRoleShareV1,
        expected: &ExpectedTenantRootRestoreImportV1,
        rng: &mut R,
    ) -> RouterAbDerivationResult<Self>
    where
        R: RngCore + CryptoRng,
    {
        expected.validate()?;
        validate_binding_against_source(&expected.binding, source, &expected.import_public_key)?;
        let recipient = DhKemX25519HkdfSha256::pk_from_bytes(expected.import_public_key.as_bytes())
            .map_err(|_| malformed("tenant-root restore import public key is invalid"))?;
        let plaintext = Zeroizing::new(source.share_wire().to_bytes());
        let aad = expected.binding.canonical_aad_bytes()?;
        let (encapsulated_key, ciphertext) = TenantRootRestoreImportHpkeV1::seal_base(
            rng,
            &recipient,
            RESTORE_IMPORT_HPKE_INFO_V1,
            &aad,
            plaintext.as_ref(),
        )
        .map_err(|_| verification_failed("tenant-root restore import encryption failed"))?;
        if ciphertext.len() != RESTORE_IMPORT_CIPHERTEXT_BYTES {
            return Err(malformed(
                "tenant-root restore import ciphertext length is invalid",
            ));
        }
        let encapsulated_key: [u8; RESTORE_IMPORT_KEY_BYTES] = encapsulated_key
            .as_ref()
            .try_into()
            .map_err(|_| malformed("tenant-root restore encapsulated key length is invalid"))?;
        validate_x25519_encapsulation(&encapsulated_key)?;
        Ok(Self {
            binding: expected.binding.clone(),
            encapsulated_key,
            ciphertext,
        })
    }

    pub const fn binding(&self) -> &TenantRootRestoreImportBindingV1 {
        &self.binding
    }

    pub fn digest(&self) -> RouterAbDerivationResult<[u8; 32]> {
        Ok(Sha256::digest(self.to_bytes()?).into())
    }

    pub fn to_bytes(&self) -> RouterAbDerivationResult<Vec<u8>> {
        self.validate_shape()?;
        let binding = self.binding.canonical_aad_bytes()?;
        let mut bytes = Vec::with_capacity(
            RESTORE_IMPORT_MAGIC_V1.len() + 4 + binding.len() + 32 + 4 + self.ciphertext.len(),
        );
        bytes.extend_from_slice(RESTORE_IMPORT_MAGIC_V1);
        push_u32(&mut bytes, binding.len())?;
        bytes.extend_from_slice(&binding);
        bytes.extend_from_slice(&self.encapsulated_key);
        push_u32(&mut bytes, self.ciphertext.len())?;
        bytes.extend_from_slice(&self.ciphertext);
        if bytes.len() > RESTORE_IMPORT_MAX_BYTES_V1 {
            return Err(malformed(
                "tenant-root restore import envelope exceeds size cap",
            ));
        }
        Ok(bytes)
    }

    pub fn decode(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.len() > RESTORE_IMPORT_MAX_BYTES_V1 {
            return Err(malformed(
                "tenant-root restore import envelope exceeds size cap",
            ));
        }
        let mut cursor = 0;
        if take(bytes, &mut cursor, RESTORE_IMPORT_MAGIC_V1.len())? != RESTORE_IMPORT_MAGIC_V1 {
            return Err(malformed("tenant-root restore import magic is invalid"));
        }
        let binding_len = read_u32(bytes, &mut cursor)?;
        let binding_bytes = take(bytes, &mut cursor, binding_len)?;
        let binding = decode_binding(binding_bytes)?;
        let encapsulated_key = take_fixed::<RESTORE_IMPORT_KEY_BYTES>(bytes, &mut cursor)?;
        validate_x25519_encapsulation(&encapsulated_key)?;
        let ciphertext_len = read_u32(bytes, &mut cursor)?;
        if ciphertext_len != RESTORE_IMPORT_CIPHERTEXT_BYTES {
            return Err(malformed(
                "tenant-root restore import ciphertext length is invalid",
            ));
        }
        let ciphertext = take(bytes, &mut cursor, ciphertext_len)?.to_vec();
        if cursor != bytes.len() {
            return Err(malformed(
                "tenant-root restore import envelope has trailing bytes",
            ));
        }
        let envelope = Self {
            binding,
            encapsulated_key,
            ciphertext,
        };
        envelope.validate_shape()?;
        Ok(envelope)
    }

    pub fn open(
        &self,
        expected: &ExpectedTenantRootRestoreImportV1,
        import_keypair: &TenantRootRestoreImportKeypairV1,
    ) -> RouterAbDerivationResult<ImportedTenantRootRecoveryRoleShareV1> {
        self.validate_shape()?;
        expected.validate()?;
        if self.binding != expected.binding {
            return Err(RouterAbDerivationError::new(
                RouterAbDerivationErrorCode::ReplayMismatch,
                "tenant-root restore import envelope does not match the authorized session",
            ));
        }
        if !bool::from(
            import_keypair
                .public_key
                .digest()
                .ct_eq(&expected.import_public_key.digest()),
        ) {
            return Err(RouterAbDerivationError::new(
                RouterAbDerivationErrorCode::RecipientMismatch,
                "tenant-root restore import key does not match binding",
            ));
        }
        let private_key = DhKemX25519HkdfSha256::sk_from_bytes(import_keypair.private_key.as_ref())
            .map_err(|_| malformed("tenant-root restore import private key is invalid"))?;
        let encapsulated_key = DhKemX25519HkdfSha256::enc_from_bytes(&self.encapsulated_key)
            .map_err(|_| malformed("tenant-root restore encapsulated key is invalid"))?;
        let plaintext = Zeroizing::new(
            TenantRootRestoreImportHpkeV1::open_base(
                &encapsulated_key,
                &private_key,
                RESTORE_IMPORT_HPKE_INFO_V1,
                &self.binding.canonical_aad_bytes()?,
                &self.ciphertext,
            )
            .map_err(|_| verification_failed("tenant-root restore import decryption failed"))?,
        );
        let share_wire = SigningRootShareWire::decode_slice(&plaintext)
            .map_err(|_| verification_failed("tenant-root restore import share is invalid"))?;
        let share = share_wire
            .to_share()
            .map_err(|_| verification_failed("tenant-root restore import share is invalid"))?;
        if bool::from(share.to_bytes().ct_eq(&[0_u8; 32]))
            || share.id() != self.binding.role.share_id()
            || SigningRootShareCommitment::from_share(&share)
                != self.binding.recovery_share_commitment
        {
            return Err(verification_failed(
                "tenant-root restore import share does not match binding",
            ));
        }
        Ok(ImportedTenantRootRecoveryRoleShareV1 {
            binding: self.binding.clone(),
            share_wire,
        })
    }

    fn validate_shape(&self) -> RouterAbDerivationResult<()> {
        self.binding.validate()?;
        validate_x25519_encapsulation(&self.encapsulated_key)?;
        if self.ciphertext.len() != RESTORE_IMPORT_CIPHERTEXT_BYTES {
            return Err(malformed(
                "tenant-root restore import ciphertext length is invalid",
            ));
        }
        Ok(())
    }
}

/// Decrypted role share that remains bound to its verified destination import metadata.
pub struct ImportedTenantRootRecoveryRoleShareV1 {
    binding: TenantRootRestoreImportBindingV1,
    share_wire: SigningRootShareWire,
}

impl ImportedTenantRootRecoveryRoleShareV1 {
    pub const fn binding(&self) -> &TenantRootRestoreImportBindingV1 {
        &self.binding
    }

    /// Consumes the verified import capability and returns its role-local share wire.
    pub fn into_share_wire(self) -> SigningRootShareWire {
        self.share_wire
    }
}

impl fmt::Debug for ImportedTenantRootRecoveryRoleShareV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ImportedTenantRootRecoveryRoleShareV1")
            .field("binding", &self.binding)
            .field("share_wire", &"[redacted]")
            .finish()
    }
}

fn validate_restore_role_import_authority_key_id(value: &str) -> RouterAbDerivationResult<()> {
    require_tenant_root_identifier("tenant-root restore role-import authority key id", value)?;
    if value.len() > RESTORE_ROLE_IMPORT_AUTHORITY_KEY_ID_MAX_BYTES_V1 {
        return Err(malformed(
            "tenant-root restore role-import authority key id is too long",
        ));
    }
    Ok(())
}

fn validate_restore_role_import_grant_unsigned_data(
    data: &TenantRootRestoreRoleImportGrantDataV1,
) -> RouterAbDerivationResult<()> {
    if data.issued_at_ms == 0
        || data.expires_at_ms <= data.issued_at_ms
        || data.expires_at_ms - data.issued_at_ms > TENANT_ROOT_MAX_LIFETIME_MS_V1
    {
        return Err(malformed(
            "tenant-root restore role-import grant time window is invalid",
        ));
    }
    if data.generation == 0 {
        return Err(malformed(
            "tenant-root restore role-import grant generation must be positive",
        ));
    }
    validate_key_id(&data.import_key_id)?;
    validate_restore_role_import_authority_key_id(&data.grant_key_id)?;
    require_nonzero(
        &data.manifest_digest,
        "tenant-root restore role-import grant manifest digest must be non-zero",
    )?;
    Ok(())
}

fn validate_restore_role_import_grant_data(
    data: &TenantRootRestoreRoleImportGrantDataV1,
) -> RouterAbDerivationResult<()> {
    validate_restore_role_import_grant_unsigned_data(data)?;
    if data.signature.iter().all(|byte| *byte == 0) {
        return Err(malformed(
            "tenant-root restore role-import grant signature must be non-zero",
        ));
    }
    Ok(())
}

fn validate_restore_role_import_command_unsigned_data(
    data: &TenantRootRestoreRoleImportCommandDataV1,
) -> RouterAbDerivationResult<()> {
    if data.issued_at_ms == 0
        || data.expires_at_ms <= data.issued_at_ms
        || data.expires_at_ms - data.issued_at_ms > TENANT_ROOT_MAX_LIFETIME_MS_V1
    {
        return Err(malformed(
            "tenant-root restore role-import command time window is invalid",
        ));
    }
    if data.generation == 0 {
        return Err(malformed(
            "tenant-root restore role-import command generation must be positive",
        ));
    }
    if data.role.share_id() != data.share_id || data.recovery_share_commitment.id() != data.share_id
    {
        return Err(malformed(
            "tenant-root restore role-import command role and share id do not match",
        ));
    }
    if data.recipient_public_key.fingerprint() != data.recipient_fingerprint {
        return Err(malformed(
            "tenant-root restore role-import command recipient fingerprint does not match key",
        ));
    }
    validate_key_id(&data.import_key_id)?;
    validate_restore_role_import_authority_key_id(&data.deriver_signing_key_id)?;
    validate_restore_role_import_authority_key_id(&data.issuer_key_id)?;
    require_nonzero(
        &data.manifest_digest,
        "tenant-root restore role-import command manifest digest must be non-zero",
    )?;
    require_nonzero(
        data.source_package_digest.as_bytes(),
        "tenant-root restore role-import command package digest must be non-zero",
    )?;
    Ok(())
}

fn validate_restore_role_import_command_data(
    data: &TenantRootRestoreRoleImportCommandDataV1,
) -> RouterAbDerivationResult<()> {
    validate_restore_role_import_command_unsigned_data(data)?;
    if data.signature.iter().all(|byte| *byte == 0) {
        return Err(malformed(
            "tenant-root restore role-import command signature must be non-zero",
        ));
    }
    Ok(())
}

fn restore_role_import_grant_unsigned_canonical_bytes(
    data: &TenantRootRestoreRoleImportGrantDataV1,
) -> RouterAbDerivationResult<Vec<u8>> {
    let mut bytes = Vec::new();
    push_lp32(&mut bytes, RESTORE_ROLE_IMPORT_GRANT_DOMAIN_V1)?;
    push_lp32(&mut bytes, RESTORE_ROLE_IMPORT_OPERATION_V1)?;
    push_lp32(&mut bytes, data.operation_digest.as_bytes())?;
    push_lp32(&mut bytes, data.destination_identity_digest.as_bytes())?;
    push_lp32(&mut bytes, data.destination_fingerprint.as_bytes())?;
    push_lp32(&mut bytes, data.destination_lineage.as_bytes())?;
    push_lp32(&mut bytes, data.restore_session_id.as_bytes())?;
    push_lp32(&mut bytes, &data.manifest_digest)?;
    push_lp32(&mut bytes, data.role.as_str().as_bytes())?;
    push_lp32(&mut bytes, data.import_key_id.as_bytes())?;
    push_lp32(&mut bytes, &data.generation.to_be_bytes())?;
    push_lp32(&mut bytes, data.nonce.as_bytes())?;
    push_lp32(&mut bytes, &data.issued_at_ms.to_be_bytes())?;
    push_lp32(&mut bytes, &data.expires_at_ms.to_be_bytes())?;
    push_lp32(&mut bytes, data.grant_key_id.as_bytes())?;
    ensure_restore_role_import_wire_size(&bytes, RESTORE_ROLE_IMPORT_GRANT_MAX_BYTES_V1)
}

fn restore_role_import_command_unsigned_canonical_bytes(
    data: &TenantRootRestoreRoleImportCommandDataV1,
) -> RouterAbDerivationResult<Vec<u8>> {
    let mut bytes = Vec::new();
    push_lp32(&mut bytes, RESTORE_ROLE_IMPORT_COMMAND_DOMAIN_V1)?;
    push_lp32(&mut bytes, RESTORE_ROLE_IMPORT_OPERATION_V1)?;
    push_lp32(&mut bytes, data.operation_digest.as_bytes())?;
    push_lp32(&mut bytes, data.grant_digest.as_bytes())?;
    push_lp32(&mut bytes, data.destination_identity_digest.as_bytes())?;
    push_lp32(&mut bytes, data.source_custody_lineage.as_bytes())?;
    push_lp32(&mut bytes, data.destination_fingerprint.as_bytes())?;
    push_lp32(&mut bytes, data.destination_lineage.as_bytes())?;
    push_lp32(&mut bytes, data.restore_session_id.as_bytes())?;
    push_lp32(&mut bytes, &data.manifest_digest)?;
    push_lp32(&mut bytes, data.recovery_set_id.as_bytes())?;
    push_lp32(&mut bytes, data.role.as_str().as_bytes())?;
    push_lp32(&mut bytes, &data.share_id.get().get().to_be_bytes())?;
    push_lp32(&mut bytes, data.source_package_digest.as_bytes())?;
    push_lp32(&mut bytes, &data.stable_root_commitment.to_bytes())?;
    push_lp32(&mut bytes, &data.recovery_share_commitment.to_bytes())?;
    push_lp32(&mut bytes, data.recipient_public_key.as_bytes())?;
    push_lp32(&mut bytes, data.recipient_fingerprint.as_bytes())?;
    push_lp32(&mut bytes, data.deriver_signing_key_id.as_bytes())?;
    push_lp32(&mut bytes, data.import_key_id.as_bytes())?;
    push_lp32(&mut bytes, &data.generation.to_be_bytes())?;
    push_lp32(&mut bytes, data.nonce.as_bytes())?;
    push_lp32(&mut bytes, &data.issued_at_ms.to_be_bytes())?;
    push_lp32(&mut bytes, &data.expires_at_ms.to_be_bytes())?;
    push_lp32(&mut bytes, data.issuer_key_id.as_bytes())?;
    ensure_restore_role_import_wire_size(&bytes, RESTORE_ROLE_IMPORT_COMMAND_MAX_BYTES_V1)
}

fn restore_role_import_signed_canonical_bytes(
    mut unsigned: Vec<u8>,
    signature: &[u8; 64],
    maximum: usize,
) -> RouterAbDerivationResult<Vec<u8>> {
    push_lp32(&mut unsigned, signature)?;
    ensure_restore_role_import_wire_size(&unsigned, maximum)
}

fn restore_role_import_grant_authentication_input(
    grant_key_id: &str,
    unsigned: &[u8],
) -> RouterAbDerivationResult<Vec<u8>> {
    validate_restore_role_import_authority_key_id(grant_key_id)?;
    let mut bytes = Vec::new();
    push_lp32(&mut bytes, RESTORE_ROLE_IMPORT_GRANT_AUTH_DOMAIN_V1)?;
    push_lp32(&mut bytes, grant_key_id.as_bytes())?;
    push_lp32(&mut bytes, unsigned)?;
    Ok(bytes)
}

fn restore_role_import_command_authentication_input(
    issuer_key_id: &str,
    unsigned: &[u8],
) -> RouterAbDerivationResult<Vec<u8>> {
    validate_restore_role_import_authority_key_id(issuer_key_id)?;
    let mut bytes = Vec::new();
    push_lp32(&mut bytes, RESTORE_ROLE_IMPORT_COMMAND_AUTH_DOMAIN_V1)?;
    push_lp32(&mut bytes, issuer_key_id.as_bytes())?;
    push_lp32(&mut bytes, unsigned)?;
    Ok(bytes)
}

fn ensure_restore_role_import_wire_size(
    bytes: &[u8],
    maximum: usize,
) -> RouterAbDerivationResult<Vec<u8>> {
    if bytes.len() > maximum {
        return Err(malformed(
            "tenant-root restore role-import wire is too long",
        ));
    }
    Ok(bytes.to_vec())
}

fn validate_binding_against_source(
    binding: &TenantRootRestoreImportBindingV1,
    source: &VerifiedTenantRootRecoveryRoleShareV1,
    import_public_key: &TenantRootRestoreImportPublicKeyV1,
) -> RouterAbDerivationResult<()> {
    binding.validate()?;
    if binding.role != source.role()
        || binding.identity_digest != source.tenant_root_identity_digest()
        || binding.recovery_set_id != source.recovery_set_id()
        || !bool::from(binding.manifest_digest.ct_eq(source.manifest_digest()))
        || binding.source_package_digest != source.package_digest()
        || binding.stable_root_commitment != source.stable_root_commitment()
        || binding.recovery_share_commitment != source.recovery_share_commitment()
        || !bool::from(
            binding
                .import_public_key_digest
                .ct_eq(&import_public_key.digest()),
        )
    {
        return Err(verification_failed(
            "tenant-root restore import binding does not match verified source share",
        ));
    }
    Ok(())
}

fn decode_binding(bytes: &[u8]) -> RouterAbDerivationResult<TenantRootRestoreImportBindingV1> {
    let mut cursor = 0;
    if take_lp32(bytes, &mut cursor)? != RESTORE_IMPORT_DOMAIN_V1 {
        return Err(malformed("tenant-root restore import domain is invalid"));
    }
    let destination_fingerprint = TenantRootRestoreDestinationFingerprintV1::from_bytes(
        take_fixed_lp32(bytes, &mut cursor)?,
    )?;
    let destination_lineage =
        TenantRootCustodyLineageId::from_bytes(take_fixed_lp32(bytes, &mut cursor)?)?;
    let restore_session_id =
        TenantRootRestoreSessionIdV1::from_bytes(take_fixed_lp32(bytes, &mut cursor)?)?;
    let identity_digest =
        TenantRootIdentityDigestV1::from_bytes(take_fixed_lp32(bytes, &mut cursor)?);
    let recovery_set_id =
        TenantRootRecoverySetId::from_bytes(take_fixed_lp32(bytes, &mut cursor)?)?;
    let manifest_digest = take_fixed_lp32(bytes, &mut cursor)?;
    let source_package_digest =
        TenantRootRecoveryPackageDigestV1::from_bytes(take_fixed_lp32(bytes, &mut cursor)?);
    let stable_root_commitment =
        TwoPartyRootCommitment::from_bytes(take_fixed_lp32(bytes, &mut cursor)?)
            .map_err(|_| malformed("tenant-root restore stable root commitment is invalid"))?;
    let recovery_share_commitment =
        SigningRootShareCommitment::from_bytes(take_fixed_lp32(bytes, &mut cursor)?)
            .map_err(|_| malformed("tenant-root restore share commitment is invalid"))?;
    let role = parse_role(take_lp32(bytes, &mut cursor)?)?;
    let share_id =
        ThresholdShareId::from_u16(u16::from_be_bytes(take_fixed_lp32(bytes, &mut cursor)?))
            .map_err(|_| malformed("tenant-root restore share id is invalid"))?;
    let import_key_id = String::from_utf8(take_lp32(bytes, &mut cursor)?.to_vec())
        .map_err(|_| malformed("tenant-root restore import key id is invalid UTF-8"))?;
    let import_public_key_digest = take_fixed_lp32(bytes, &mut cursor)?;
    let issued_at_ms = u64::from_be_bytes(take_fixed_lp32(bytes, &mut cursor)?);
    let expires_at_ms = u64::from_be_bytes(take_fixed_lp32(bytes, &mut cursor)?);
    if cursor != bytes.len() {
        return Err(malformed(
            "tenant-root restore import binding has trailing bytes",
        ));
    }
    let binding = TenantRootRestoreImportBindingV1 {
        destination_fingerprint,
        destination_lineage,
        restore_session_id,
        identity_digest,
        recovery_set_id,
        manifest_digest,
        source_package_digest,
        stable_root_commitment,
        recovery_share_commitment,
        role,
        share_id,
        import_key_id,
        import_public_key_digest,
        issued_at_ms,
        expires_at_ms,
    };
    binding.validate()?;
    if binding.canonical_aad_bytes()?.as_slice() != bytes {
        return Err(malformed(
            "tenant-root restore import binding is not canonical",
        ));
    }
    Ok(binding)
}

fn validate_x25519_public_key(
    bytes: &[u8; 32],
    label: &'static str,
) -> RouterAbDerivationResult<()> {
    if !is_canonical_nonzero_x25519_encoding(bytes) {
        return Err(malformed(label));
    }
    let key = DhKemX25519HkdfSha256::pk_from_bytes(bytes).map_err(|_| malformed(label))?;
    if DhKemX25519HkdfSha256::pk_to_bytes(&key).as_slice() != bytes {
        return Err(malformed(label));
    }
    Ok(())
}

fn validate_x25519_encapsulation(bytes: &[u8; 32]) -> RouterAbDerivationResult<()> {
    if !is_canonical_nonzero_x25519_encoding(bytes) {
        return Err(malformed("tenant-root restore encapsulated key is invalid"));
    }
    DhKemX25519HkdfSha256::enc_from_bytes(bytes)
        .map_err(|_| malformed("tenant-root restore encapsulated key is invalid"))?;
    Ok(())
}

fn validate_key_id(value: &str) -> RouterAbDerivationResult<()> {
    if value.is_empty()
        || value.len() > 128
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b' ')
    {
        return Err(malformed("tenant-root restore import key id is invalid"));
    }
    Ok(())
}

fn parse_role(bytes: &[u8]) -> RouterAbDerivationResult<TwoPartyDeriverRole> {
    match bytes {
        b"deriver_a" => Ok(TwoPartyDeriverRole::DeriverA),
        b"deriver_b" => Ok(TwoPartyDeriverRole::DeriverB),
        _ => Err(malformed("tenant-root restore import role is invalid")),
    }
}

struct RestoreRoleImportWireDecoderV1<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> RestoreRoleImportWireDecoderV1<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn field(&mut self, name: &'static str) -> RouterAbDerivationResult<&'a [u8]> {
        let length_end = self
            .offset
            .checked_add(4)
            .ok_or_else(|| malformed("tenant-root restore role-import wire offset overflows"))?;
        let length_bytes = self.bytes.get(self.offset..length_end).ok_or_else(|| {
            malformed("tenant-root restore role-import field length is truncated")
        })?;
        let length = u32::from_be_bytes(
            length_bytes
                .try_into()
                .expect("fixed four-byte restore role-import field length"),
        ) as usize;
        let value_end = length_end
            .checked_add(length)
            .ok_or_else(|| malformed("tenant-root restore role-import field length overflows"))?;
        let value = self
            .bytes
            .get(length_end..value_end)
            .ok_or_else(|| malformed("tenant-root restore role-import field is truncated"))?;
        self.offset = value_end;
        if value.is_empty() {
            return Err(RouterAbDerivationError::new(
                RouterAbDerivationErrorCode::EmptyField,
                format!("{name} is required"),
            ));
        }
        Ok(value)
    }

    fn require_field(&mut self, expected: &[u8]) -> RouterAbDerivationResult<()> {
        if self.field("tenant-root restore role-import wire domain")? != expected {
            return Err(malformed(
                "tenant-root restore role-import wire domain is invalid",
            ));
        }
        Ok(())
    }

    fn fixed_field<const N: usize>(
        &mut self,
        name: &'static str,
    ) -> RouterAbDerivationResult<[u8; N]> {
        self.field(name)?
            .try_into()
            .map_err(|_| malformed("tenant-root restore role-import fixed field length is invalid"))
    }

    fn u64_field(&mut self, name: &'static str) -> RouterAbDerivationResult<u64> {
        Ok(u64::from_be_bytes(self.fixed_field::<8>(name)?))
    }

    fn text_field(
        &mut self,
        name: &'static str,
        maximum: usize,
    ) -> RouterAbDerivationResult<String> {
        let bytes = self.field(name)?;
        if bytes.len() > maximum {
            return Err(malformed(
                "tenant-root restore role-import text field is too long",
            ));
        }
        String::from_utf8(bytes.to_vec())
            .map_err(|_| malformed("tenant-root restore role-import text field is not UTF-8"))
    }

    fn finish(self) -> RouterAbDerivationResult<()> {
        if self.offset != self.bytes.len() {
            return Err(malformed(
                "tenant-root restore role-import wire has trailing bytes",
            ));
        }
        Ok(())
    }
}

fn push_lp32(out: &mut Vec<u8>, value: &[u8]) -> RouterAbDerivationResult<()> {
    push_u32(out, value.len())?;
    out.extend_from_slice(value);
    Ok(())
}

fn push_u32(out: &mut Vec<u8>, length: usize) -> RouterAbDerivationResult<()> {
    let length = u32::try_from(length)
        .map_err(|_| malformed("tenant-root restore import field is too long"))?;
    out.extend_from_slice(&length.to_be_bytes());
    Ok(())
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> RouterAbDerivationResult<usize> {
    Ok(u32::from_be_bytes(take_fixed(bytes, cursor)?) as usize)
}

fn take_lp32<'a>(bytes: &'a [u8], cursor: &mut usize) -> RouterAbDerivationResult<&'a [u8]> {
    let length = read_u32(bytes, cursor)?;
    take(bytes, cursor, length)
}

fn take_fixed_lp32<const N: usize>(
    bytes: &[u8],
    cursor: &mut usize,
) -> RouterAbDerivationResult<[u8; N]> {
    let value = take_lp32(bytes, cursor)?;
    value
        .try_into()
        .map_err(|_| malformed("tenant-root restore import fixed field length is invalid"))
}

fn take_fixed<const N: usize>(
    bytes: &[u8],
    cursor: &mut usize,
) -> RouterAbDerivationResult<[u8; N]> {
    take(bytes, cursor, N)?
        .try_into()
        .map_err(|_| malformed("tenant-root restore import fixed field length is invalid"))
}

fn take<'a>(
    bytes: &'a [u8],
    cursor: &mut usize,
    length: usize,
) -> RouterAbDerivationResult<&'a [u8]> {
    let end = cursor
        .checked_add(length)
        .ok_or_else(|| malformed("tenant-root restore import length overflows"))?;
    let value = bytes
        .get(*cursor..end)
        .ok_or_else(|| malformed("tenant-root restore import is truncated"))?;
    *cursor = end;
    Ok(value)
}

fn require_nonzero(bytes: &[u8], message: &'static str) -> RouterAbDerivationResult<()> {
    let aggregate = bytes.iter().fold(0_u8, |value, byte| value | byte);
    if aggregate == 0 {
        Err(malformed(message))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod restore_role_import_authorization_tests {
    use super::*;

    #[test]
    fn restore_grant_round_trips_and_verifies_under_expected_authority() {
        let signing_key = SigningKey::from_bytes(&[0x71; 32]);
        let operation_digest =
            TenantRootProtocolDigestV1::from_bytes([0x11; 32]).expect("operation digest");
        let destination_identity_digest = TenantRootIdentityDigestV1::from_bytes([0x12; 32]);
        let destination_fingerprint =
            TenantRootRestoreDestinationFingerprintV1::from_bytes([0x13; 32])
                .expect("destination fingerprint");
        let destination_lineage =
            TenantRootCustodyLineageId::from_bytes([0x14; 16]).expect("destination lineage");
        let restore_session_id =
            TenantRootRestoreSessionIdV1::from_bytes([0x15; 16]).expect("restore session");
        let nonce = TenantRootRestoreAuthorizationNonceV1::from_bytes([0x16; 32])
            .expect("authorization nonce");
        let grant = TenantRootRestoreRoleImportGrantV1::sign(
            operation_digest,
            destination_identity_digest,
            destination_fingerprint,
            destination_lineage,
            restore_session_id,
            [0x17; 32],
            TwoPartyDeriverRole::DeriverA,
            "restore-import-key-1",
            1,
            nonce,
            100,
            200,
            "restore-authority-v1",
            &signing_key.to_bytes(),
        )
        .expect("signed restore grant");
        let bytes = grant.canonical_bytes().expect("canonical grant");
        let decoded = TenantRootRestoreRoleImportGrantV1::decode_canonical_bytes(&bytes)
            .expect("decoded restore grant");
        let verified = decoded
            .verify(
                "restore-authority-v1",
                &signing_key.verifying_key().to_bytes(),
            )
            .expect("verified restore grant");
        assert_eq!(verified.operation_digest(), operation_digest);
        assert_eq!(
            verified.destination_identity_digest(),
            destination_identity_digest
        );
        assert_eq!(verified.role(), TwoPartyDeriverRole::DeriverA);
        assert!(verified.require_fresh(100).is_ok());
        assert!(verified.require_fresh(200).is_err());
    }
}

fn malformed(message: &'static str) -> RouterAbDerivationError {
    RouterAbDerivationError::new(RouterAbDerivationErrorCode::MalformedInput, message)
}

fn verification_failed(message: &'static str) -> RouterAbDerivationError {
    RouterAbDerivationError::new(
        RouterAbDerivationErrorCode::OutputVerificationFailed,
        message,
    )
}

fn replay_mismatch(message: &'static str) -> RouterAbDerivationError {
    RouterAbDerivationError::new(RouterAbDerivationErrorCode::ReplayMismatch, message)
}
