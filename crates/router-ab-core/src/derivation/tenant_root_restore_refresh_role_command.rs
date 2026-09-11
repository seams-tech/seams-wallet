use core::fmt;

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};
use threshold_prf::TwoPartyDeriverRole;

use super::{
    require_tenant_root_identifier, MpcPrfShareCommitmentWireV1, RouterAbDerivationError,
    RouterAbDerivationErrorCode, RouterAbDerivationResult, TenantRootCeremonyContextV1,
    TenantRootCeremonyEpochsV1, TenantRootCeremonyNonceV1, TenantRootCeremonySessionIdV1,
    TenantRootCustodyLineageId, TenantRootEpochCommitmentsV1, TenantRootIdentityDigestV1,
    TenantRootLifecycleReceiptDigestV1, TenantRootProtocolDigestV1,
    TenantRootRestoreDestinationFingerprintV1, TenantRootRestoreSessionIdV1, TenantRootShareEpoch,
    TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1,
};

use super::tenant_root_protocol::TenantRootWireDecoderV1;

const TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_DOMAIN_V1: &[u8] =
    b"tenant_root_restore_refresh_role_command_v1";
const TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_AUTH_DOMAIN_V1: &[u8] =
    b"tenant_root_restore_refresh_role_command_authentication_v1";
const TENANT_ROOT_RESTORE_REFRESH_ROLE_OPERATION_V1: &[u8] = b"restore_refresh_role";
const TENANT_ROOT_RESTORE_REFRESH_ROLE_ISSUER_KEY_ID_MAX_BYTES_V1: usize = 256;

/// Exact operation authenticated by a restore-to-creation refresh role command.
pub const TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_OPERATION_V1: &str = "restore_refresh_role";

/// Maximum canonical wire size accepted for one restore refresh role command.
pub const TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1: usize = 24 * 1024;

#[derive(Clone, PartialEq, Eq)]
struct TenantRootRestoreRefreshRoleCommandDataV1 {
    context: TenantRootCeremonyContextV1,
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    restore_session_id: TenantRootRestoreSessionIdV1,
    manifest_digest: [u8; 32],
    deriver_a_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    deriver_b_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    deriver_a_imported_commitment: MpcPrfShareCommitmentWireV1,
    deriver_b_imported_commitment: MpcPrfShareCommitmentWireV1,
    stable_root_commitment: [u8; 32],
    role: TwoPartyDeriverRole,
    issuer_key_id: String,
    signature: [u8; 64],
}

impl fmt::Debug for TenantRootRestoreRefreshRoleCommandDataV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TenantRootRestoreRefreshRoleCommandDataV1")
            .field("context", &self.context)
            .field("destination_fingerprint", &self.destination_fingerprint)
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
            .field(
                "deriver_a_imported_commitment",
                &self.deriver_a_imported_commitment,
            )
            .field(
                "deriver_b_imported_commitment",
                &self.deriver_b_imported_commitment,
            )
            .field(
                "stable_root_commitment",
                &hex::encode(self.stable_root_commitment),
            )
            .field("role", &self.role)
            .field("issuer_key_id", &self.issuer_key_id)
            .field("signature", &"[redacted]")
            .finish()
    }
}

/// Issuer-signed authorization for one role's restore forward-refresh step.
///
/// The ceremony context is the create/epoch-1 context for the destination. The
/// imported commitments remain the source pair for the refresh math; no active
/// epoch or activation receipt is represented here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRestoreRefreshRoleCommandV1 {
    data: TenantRootRestoreRefreshRoleCommandDataV1,
}

impl TenantRootRestoreRefreshRoleCommandV1 {
    /// Signs one exact restore forward-refresh role command.
    #[allow(clippy::too_many_arguments)]
    pub fn sign(
        context: &TenantRootCeremonyContextV1,
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        restore_session_id: TenantRootRestoreSessionIdV1,
        manifest_digest: [u8; 32],
        deriver_a_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        deriver_b_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        deriver_a_imported_commitment: MpcPrfShareCommitmentWireV1,
        deriver_b_imported_commitment: MpcPrfShareCommitmentWireV1,
        stable_root_commitment: [u8; 32],
        role: TwoPartyDeriverRole,
        issuer_key_id: impl Into<String>,
        issuer_signing_key_bytes: &[u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        let issuer_key_id = issuer_key_id.into();
        let mut data = Self {
            data: TenantRootRestoreRefreshRoleCommandDataV1 {
                context: context.clone(),
                destination_fingerprint,
                restore_session_id,
                manifest_digest,
                deriver_a_acceptance_receipt_digest,
                deriver_b_acceptance_receipt_digest,
                deriver_a_imported_commitment,
                deriver_b_imported_commitment,
                stable_root_commitment,
                role,
                issuer_key_id,
                signature: [0; 64],
            },
        };
        validate_unsigned_data(&data.data)?;
        let unsigned = unsigned_canonical_bytes(&data.data)?;
        data.data.signature = SigningKey::from_bytes(issuer_signing_key_bytes)
            .sign(&authentication_input(&data.data.issuer_key_id, &unsigned)?)
            .to_bytes();
        validate_data(&data.data)?;
        data.canonical_bytes()?;
        Ok(data)
    }

    /// Decodes one exact canonical signed restore refresh role command wire.
    pub fn decode_canonical_bytes(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.is_empty() || bytes.len() > TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1 {
            return Err(malformed(
                "tenant-root restore refresh role command wire length is invalid",
            ));
        }
        let mut decoder = TenantRootWireDecoderV1::new(bytes);
        decoder.require_field(TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_DOMAIN_V1)?;
        if decoder.field("tenant-root restore refresh role command operation")?
            != TENANT_ROOT_RESTORE_REFRESH_ROLE_OPERATION_V1
        {
            return Err(malformed(
                "tenant-root restore refresh role command operation is invalid",
            ));
        }
        let context = TenantRootCeremonyContextV1::decode_canonical_bytes(
            decoder.field("tenant-root restore refresh role command context")?,
        )?;
        let destination_fingerprint =
            TenantRootRestoreDestinationFingerprintV1::from_bytes(decoder.fixed_field::<32>(
                "tenant-root restore refresh role command destination fingerprint",
            )?)?;
        let restore_session_id = TenantRootRestoreSessionIdV1::from_bytes(
            decoder
                .fixed_field::<16>("tenant-root restore refresh role command restore session")?,
        )?;
        let manifest_digest = decoder
            .fixed_field::<32>("tenant-root restore refresh role command manifest digest")?;
        let deriver_a_acceptance_receipt_digest =
            TenantRootLifecycleReceiptDigestV1::from_bytes(decoder.fixed_field::<32>(
                "tenant-root restore refresh role command Deriver A acceptance receipt",
            )?)?;
        let deriver_b_acceptance_receipt_digest =
            TenantRootLifecycleReceiptDigestV1::from_bytes(decoder.fixed_field::<32>(
                "tenant-root restore refresh role command Deriver B acceptance receipt",
            )?)?;
        let deriver_a_imported_commitment = MpcPrfShareCommitmentWireV1::new(
            decoder
                .field("tenant-root restore refresh role command Deriver A imported commitment")?
                .to_vec(),
        )?;
        let deriver_b_imported_commitment = MpcPrfShareCommitmentWireV1::new(
            decoder
                .field("tenant-root restore refresh role command Deriver B imported commitment")?
                .to_vec(),
        )?;
        let stable_root_commitment = decoder
            .fixed_field::<32>("tenant-root restore refresh role command stable root commitment")?;
        let role = decoder.role()?;
        let issuer_key_id = decoder.text_field(
            "tenant-root restore refresh role command issuer key id",
            TENANT_ROOT_RESTORE_REFRESH_ROLE_ISSUER_KEY_ID_MAX_BYTES_V1,
        )?;
        require_issuer_key_id(&issuer_key_id)?;
        let signature =
            decoder.fixed_field::<64>("tenant-root restore refresh role command signature")?;
        if signature.iter().all(|byte| *byte == 0) {
            return Err(malformed(
                "tenant-root restore refresh role command signature must be nonzero",
            ));
        }
        decoder.finish()?;

        let command = Self {
            data: TenantRootRestoreRefreshRoleCommandDataV1 {
                context,
                destination_fingerprint,
                restore_session_id,
                manifest_digest,
                deriver_a_acceptance_receipt_digest,
                deriver_b_acceptance_receipt_digest,
                deriver_a_imported_commitment,
                deriver_b_imported_commitment,
                stable_root_commitment,
                role,
                issuer_key_id,
                signature,
            },
        };
        validate_data(&command.data)?;
        if command.canonical_bytes()? != bytes {
            return Err(malformed(
                "tenant-root restore refresh role command wire is not canonical",
            ));
        }
        Ok(command)
    }

    /// Returns the fixed operation authenticated by this command.
    pub const fn operation(&self) -> &'static str {
        TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_OPERATION_V1
    }

    /// Returns the create ceremony context authenticated by this command.
    pub const fn context(&self) -> &TenantRootCeremonyContextV1 {
        &self.data.context
    }

    pub const fn destination_fingerprint(&self) -> TenantRootRestoreDestinationFingerprintV1 {
        self.data.destination_fingerprint
    }

    pub const fn restore_session_id(&self) -> TenantRootRestoreSessionIdV1 {
        self.data.restore_session_id
    }

    pub const fn manifest_digest(&self) -> &[u8; 32] {
        &self.data.manifest_digest
    }

    pub const fn acceptance_receipt(
        &self,
        role: TwoPartyDeriverRole,
    ) -> TenantRootLifecycleReceiptDigestV1 {
        match role {
            TwoPartyDeriverRole::DeriverA => self.data.deriver_a_acceptance_receipt_digest,
            TwoPartyDeriverRole::DeriverB => self.data.deriver_b_acceptance_receipt_digest,
        }
    }

    pub const fn imported_commitment(
        &self,
        role: TwoPartyDeriverRole,
    ) -> &MpcPrfShareCommitmentWireV1 {
        match role {
            TwoPartyDeriverRole::DeriverA => &self.data.deriver_a_imported_commitment,
            TwoPartyDeriverRole::DeriverB => &self.data.deriver_b_imported_commitment,
        }
    }

    pub const fn stable_root_commitment(&self) -> &[u8; 32] {
        &self.data.stable_root_commitment
    }

    pub const fn role(&self) -> TwoPartyDeriverRole {
        self.data.role
    }

    pub fn issuer_key_id(&self) -> &str {
        &self.data.issuer_key_id
    }

    pub fn canonical_bytes(&self) -> RouterAbDerivationResult<Vec<u8>> {
        let unsigned = unsigned_canonical_bytes(&self.data)?;
        canonical_bytes_from_unsigned(unsigned, &self.data.signature)
    }

    pub fn digest(&self) -> RouterAbDerivationResult<TenantRootProtocolDigestV1> {
        TenantRootProtocolDigestV1::from_bytes(Sha256::digest(self.canonical_bytes()?).into())
    }

    /// Verifies the issuer signature and returns the command capability.
    pub fn verify(
        &self,
        expected_issuer_key_id: &str,
        trusted_issuer_verifying_key: &[u8; 32],
    ) -> RouterAbDerivationResult<VerifiedTenantRootRestoreRefreshRoleCommandV1> {
        validate_data(&self.data)?;
        require_issuer_key_id(expected_issuer_key_id)?;
        if self.data.issuer_key_id != expected_issuer_key_id {
            return Err(replay_mismatch(
                "tenant-root restore refresh role command issuer key id does not match the trusted key",
            ));
        }
        let unsigned = unsigned_canonical_bytes(&self.data)?;
        let verifying_key =
            VerifyingKey::from_bytes(trusted_issuer_verifying_key).map_err(|_| {
                malformed("tenant-root restore refresh issuer verifying key is invalid")
            })?;
        let signature = Signature::from_bytes(&self.data.signature);
        verifying_key
            .verify_strict(
                &authentication_input(&self.data.issuer_key_id, &unsigned)?,
                &signature,
            )
            .map_err(|_| {
                verification_failed("tenant-root restore refresh role command signature is invalid")
            })?;
        let canonical_bytes = self.canonical_bytes()?;
        let digest =
            TenantRootProtocolDigestV1::from_bytes(Sha256::digest(&canonical_bytes).into())?;
        Ok(VerifiedTenantRootRestoreRefreshRoleCommandV1 {
            command: self.clone(),
            canonical_bytes,
            digest,
        })
    }
}

/// Strictly verified issuer-authenticated restore forward-refresh role command.
pub struct VerifiedTenantRootRestoreRefreshRoleCommandV1 {
    command: TenantRootRestoreRefreshRoleCommandV1,
    canonical_bytes: Vec<u8>,
    digest: TenantRootProtocolDigestV1,
}

impl fmt::Debug for VerifiedTenantRootRestoreRefreshRoleCommandV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("VerifiedTenantRootRestoreRefreshRoleCommandV1")
            .field("digest", &self.digest)
            .field("canonical_bytes", &"[public bytes]")
            .finish()
    }
}

impl VerifiedTenantRootRestoreRefreshRoleCommandV1 {
    pub const fn operation(&self) -> &'static str {
        self.command.operation()
    }

    pub const fn context(&self) -> &TenantRootCeremonyContextV1 {
        self.command.context()
    }

    pub const fn destination_fingerprint(&self) -> TenantRootRestoreDestinationFingerprintV1 {
        self.command.destination_fingerprint()
    }

    pub const fn identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.context().identity_digest()
    }

    pub const fn custody_lineage(&self) -> TenantRootCustodyLineageId {
        self.context().custody_lineage()
    }

    pub const fn restore_session_id(&self) -> TenantRootRestoreSessionIdV1 {
        self.command.restore_session_id()
    }

    pub const fn manifest_digest(&self) -> &[u8; 32] {
        self.command.manifest_digest()
    }

    pub const fn acceptance_receipt(
        &self,
        role: TwoPartyDeriverRole,
    ) -> TenantRootLifecycleReceiptDigestV1 {
        self.command.acceptance_receipt(role)
    }

    pub const fn imported_commitment(
        &self,
        role: TwoPartyDeriverRole,
    ) -> &MpcPrfShareCommitmentWireV1 {
        self.command.imported_commitment(role)
    }

    pub const fn stable_root_commitment(&self) -> &[u8; 32] {
        self.command.stable_root_commitment()
    }

    pub const fn role(&self) -> TwoPartyDeriverRole {
        self.command.role()
    }

    pub fn issuer_key_id(&self) -> &str {
        self.command.issuer_key_id()
    }

    pub const fn issued_at_ms(&self) -> u64 {
        self.context().issued_at_ms()
    }

    pub const fn expires_at_ms(&self) -> u64 {
        self.context().expires_at_ms()
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub const fn digest(&self) -> TenantRootProtocolDigestV1 {
        self.digest
    }

    pub fn into_canonical_bytes(self) -> Vec<u8> {
        self.canonical_bytes
    }

    /// Requires the signed restore refresh command to be inside its fresh window.
    pub fn require_fresh(&self, now_ms: u64) -> RouterAbDerivationResult<()> {
        let earliest_acceptable_now = self
            .issued_at_ms()
            .saturating_sub(TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1);
        let latest_acceptable_now = self
            .expires_at_ms()
            .saturating_add(TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1);
        if now_ms < earliest_acceptable_now || now_ms > latest_acceptable_now {
            return Err(replay_mismatch(
                "tenant-root restore refresh role command is outside its freshness window",
            ));
        }
        Ok(())
    }
}

fn validate_data(data: &TenantRootRestoreRefreshRoleCommandDataV1) -> RouterAbDerivationResult<()> {
    validate_unsigned_data(data)?;
    if data.signature.iter().all(|byte| *byte == 0) {
        return Err(malformed(
            "tenant-root restore refresh role command signature must be nonzero",
        ));
    }
    Ok(())
}

fn validate_unsigned_data(
    data: &TenantRootRestoreRefreshRoleCommandDataV1,
) -> RouterAbDerivationResult<()> {
    require_create_context(&data.context)?;
    if data.manifest_digest.iter().all(|byte| *byte == 0) {
        return Err(malformed(
            "tenant-root restore refresh role command manifest digest must be nonzero",
        ));
    }
    if data.deriver_a_acceptance_receipt_digest == data.deriver_b_acceptance_receipt_digest {
        return Err(malformed(
            "tenant-root restore refresh role command acceptance receipts must differ",
        ));
    }
    let commitments = TenantRootEpochCommitmentsV1::new(
        data.deriver_a_imported_commitment.clone(),
        data.deriver_b_imported_commitment.clone(),
    )?;
    if commitments.root_commitment() != &data.stable_root_commitment {
        return Err(replay_mismatch(
            "tenant-root restore refresh role command stable root does not match imported commitments",
        ));
    }
    let expected_nonce = tenant_root_restore_refresh_context_nonce_v1(
        data.context.identity_digest(),
        data.context.custody_lineage(),
        data.context.session_id(),
        data.destination_fingerprint,
        data.restore_session_id,
        data.manifest_digest,
        data.deriver_a_acceptance_receipt_digest,
        data.deriver_b_acceptance_receipt_digest,
        &data.deriver_a_imported_commitment,
        &data.deriver_b_imported_commitment,
        data.stable_root_commitment,
    )?;
    if data.context.nonce() != expected_nonce {
        return Err(replay_mismatch(
            "tenant-root restore refresh role command context nonce does not bind its shared scope",
        ));
    }
    require_issuer_key_id(&data.issuer_key_id)
}

/// Derives the shared ceremony nonce that prevents role commands from
/// different accepted restore scopes sharing one create context.
#[allow(clippy::too_many_arguments)]
pub fn tenant_root_restore_refresh_context_nonce_v1(
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    ceremony_session_id: TenantRootCeremonySessionIdV1,
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    restore_session_id: TenantRootRestoreSessionIdV1,
    manifest_digest: [u8; 32],
    deriver_a_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    deriver_b_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    deriver_a_imported_commitment: &MpcPrfShareCommitmentWireV1,
    deriver_b_imported_commitment: &MpcPrfShareCommitmentWireV1,
    stable_root_commitment: [u8; 32],
) -> RouterAbDerivationResult<TenantRootCeremonyNonceV1> {
    if manifest_digest.iter().all(|byte| *byte == 0)
        || stable_root_commitment.iter().all(|byte| *byte == 0)
    {
        return Err(malformed(
            "tenant-root restore refresh shared scope digest fields must be nonzero",
        ));
    }
    let mut bytes = Vec::new();
    push_field(
        &mut bytes,
        b"tenant_root_restore_refresh_role_context_nonce_v1",
    )?;
    push_field(&mut bytes, identity_digest.as_bytes())?;
    push_field(&mut bytes, custody_lineage.as_bytes())?;
    push_field(&mut bytes, ceremony_session_id.as_bytes())?;
    push_field(&mut bytes, destination_fingerprint.as_bytes())?;
    push_field(&mut bytes, restore_session_id.as_bytes())?;
    push_field(&mut bytes, &manifest_digest)?;
    push_field(&mut bytes, deriver_a_acceptance_receipt_digest.as_bytes())?;
    push_field(&mut bytes, deriver_b_acceptance_receipt_digest.as_bytes())?;
    push_field(&mut bytes, deriver_a_imported_commitment.as_bytes())?;
    push_field(&mut bytes, deriver_b_imported_commitment.as_bytes())?;
    push_field(&mut bytes, &stable_root_commitment)?;
    TenantRootCeremonyNonceV1::from_bytes(Sha256::digest(bytes).into())
}

fn require_create_context(context: &TenantRootCeremonyContextV1) -> RouterAbDerivationResult<()> {
    context.validate()?;
    if !matches!(
        context.epochs(),
        TenantRootCeremonyEpochsV1::Create {
            next: TenantRootShareEpoch::INITIAL
        }
    ) {
        return Err(malformed(
            "tenant-root restore refresh role command requires the create epoch-1 context",
        ));
    }
    Ok(())
}

fn require_issuer_key_id(value: &str) -> RouterAbDerivationResult<()> {
    require_tenant_root_identifier(
        "tenant-root restore refresh role command issuer key id",
        value,
    )?;
    if value.len() > TENANT_ROOT_RESTORE_REFRESH_ROLE_ISSUER_KEY_ID_MAX_BYTES_V1 {
        return Err(malformed(
            "tenant-root restore refresh role command issuer key id is too long",
        ));
    }
    Ok(())
}

fn push_authorization_fields(
    bytes: &mut Vec<u8>,
    data: &TenantRootRestoreRefreshRoleCommandDataV1,
) -> RouterAbDerivationResult<()> {
    push_field(bytes, TENANT_ROOT_RESTORE_REFRESH_ROLE_OPERATION_V1)?;
    push_field(bytes, &data.context.canonical_bytes()?)?;
    push_field(bytes, data.destination_fingerprint.as_bytes())?;
    push_field(bytes, data.restore_session_id.as_bytes())?;
    push_field(bytes, &data.manifest_digest)?;
    push_field(bytes, data.deriver_a_acceptance_receipt_digest.as_bytes())?;
    push_field(bytes, data.deriver_b_acceptance_receipt_digest.as_bytes())?;
    push_field(bytes, data.deriver_a_imported_commitment.as_bytes())?;
    push_field(bytes, data.deriver_b_imported_commitment.as_bytes())?;
    push_field(bytes, &data.stable_root_commitment)?;
    push_role(bytes, data.role)?;
    Ok(())
}

fn unsigned_canonical_bytes(
    data: &TenantRootRestoreRefreshRoleCommandDataV1,
) -> RouterAbDerivationResult<Vec<u8>> {
    validate_unsigned_data(data)?;
    let mut bytes = Vec::new();
    push_field(
        &mut bytes,
        TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_DOMAIN_V1,
    )?;
    push_authorization_fields(&mut bytes, data)?;
    push_field(&mut bytes, data.issuer_key_id.as_bytes())?;
    Ok(bytes)
}

fn canonical_bytes_from_unsigned(
    unsigned: Vec<u8>,
    signature: &[u8; 64],
) -> RouterAbDerivationResult<Vec<u8>> {
    if signature.iter().all(|byte| *byte == 0) {
        return Err(malformed(
            "tenant-root restore refresh role command signature must be nonzero",
        ));
    }
    let mut bytes = unsigned;
    push_field(&mut bytes, signature)?;
    Ok(bytes)
}

fn authentication_input(issuer_key_id: &str, unsigned: &[u8]) -> RouterAbDerivationResult<Vec<u8>> {
    require_issuer_key_id(issuer_key_id)?;
    let mut bytes = Vec::new();
    push_field(
        &mut bytes,
        TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_AUTH_DOMAIN_V1,
    )?;
    push_field(&mut bytes, issuer_key_id.as_bytes())?;
    push_field(&mut bytes, unsigned)?;
    Ok(bytes)
}

fn push_role(bytes: &mut Vec<u8>, role: TwoPartyDeriverRole) -> RouterAbDerivationResult<()> {
    push_field(bytes, role.as_str().as_bytes())?;
    push_field(bytes, &role.share_id().get().get().to_be_bytes())
}

fn push_field(bytes: &mut Vec<u8>, value: &[u8]) -> RouterAbDerivationResult<()> {
    if value.is_empty() {
        return Err(RouterAbDerivationError::new(
            RouterAbDerivationErrorCode::EmptyField,
            "tenant-root restore refresh role command field is required",
        ));
    }
    let length = u32::try_from(value.len())
        .map_err(|_| malformed("tenant-root restore refresh role command field is too long"))?;
    let new_len = bytes
        .len()
        .checked_add(4)
        .and_then(|length| length.checked_add(value.len()))
        .ok_or_else(|| {
            malformed("tenant-root restore refresh role command wire length overflows")
        })?;
    if new_len > TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1 {
        return Err(malformed(
            "tenant-root restore refresh role command wire is too long",
        ));
    }
    bytes.extend_from_slice(&length.to_be_bytes());
    bytes.extend_from_slice(value);
    Ok(())
}

fn malformed(message: impl Into<String>) -> RouterAbDerivationError {
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
