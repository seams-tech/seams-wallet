//! Tenant-held recovery key files. Storage encryption is the holder's responsibility.
use crate::{RecoveryCoreError, RecoveryCoreErrorCode, RecoveryCoreResult};
use core::fmt;
use rand_core_09::{CryptoRng, RngCore};
use router_ab_core::{
    TenantRootRecoveryRecipientFingerprintV1, TenantRootRecoveryRecipientKeypairV1,
    TenantRootRecoveryRecipientPublicKeyV1, TwoPartyDeriverRole,
};
use zeroize::Zeroizing;

/// Magic for a plaintext, role-bound recovery key file.
pub const RECOVERY_KEY_FILE_MAGIC_V1: &[u8; 8] = b"SEAMSKP1";
/// Magic, role byte, secret material, public key, and fingerprint.
pub const RECOVERY_KEY_FILE_MAX_BYTES: usize = 105;

/// One opened recovery recipient. Secret material is never exposed in debug output.
pub struct TenantRootRecoveryKeyMaterialV1 {
    role: TwoPartyDeriverRole,
    recipient: TenantRootRecoveryRecipientKeypairV1,
}
impl TenantRootRecoveryKeyMaterialV1 {
    /// The holder role.
    pub const fn role(&self) -> TwoPartyDeriverRole {
        self.role
    }
    /// The recipient used to open backup packages.
    pub const fn recipient(&self) -> &TenantRootRecoveryRecipientKeypairV1 {
        &self.recipient
    }
    /// Public enrollment key.
    pub fn public_key(&self) -> TenantRootRecoveryRecipientPublicKeyV1 {
        self.recipient.public_key()
    }
    /// Public fingerprint.
    pub fn fingerprint(&self) -> TenantRootRecoveryRecipientFingerprintV1 {
        self.recipient.fingerprint()
    }
}
impl fmt::Debug for TenantRootRecoveryKeyMaterialV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TenantRootRecoveryKeyMaterialV1")
            .field("role", &self.role)
            .finish_non_exhaustive()
    }
}

/// One private recovery key. Serialized files must be treated as secrets.
pub struct RecoveryKeyFileV1 {
    role: TwoPartyDeriverRole,
    material: Zeroizing<[u8; 32]>,
}
impl fmt::Debug for RecoveryKeyFileV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RecoveryKeyFileV1")
            .field("role", &self.role)
            .finish_non_exhaustive()
    }
}
impl RecoveryKeyFileV1 {
    /// Generates a fresh role key using the supplied secure RNG.
    pub fn create<R: RngCore + CryptoRng>(
        role: TwoPartyDeriverRole,
        rng: &mut R,
    ) -> RecoveryCoreResult<(Self, TenantRootRecoveryKeyMaterialV1)> {
        let mut material = Zeroizing::new([0u8; 32]);
        rng.fill_bytes(material.as_mut());
        let file = Self { role, material };
        let opened = file.open()?;
        Ok((file, opened))
    }
    /// The holder role.
    pub const fn role(&self) -> TwoPartyDeriverRole {
        self.role
    }
    /// Public enrollment key.
    pub fn public_key(&self) -> TenantRootRecoveryRecipientPublicKeyV1 {
        self.open().expect("validated recovery key").public_key()
    }
    /// Public fingerprint.
    pub fn fingerprint(&self) -> TenantRootRecoveryRecipientFingerprintV1 {
        self.public_key().fingerprint()
    }
    /// Opens the key material. No application-managed encryption layer is applied.
    pub fn open(&self) -> RecoveryCoreResult<TenantRootRecoveryKeyMaterialV1> {
        let recipient = TenantRootRecoveryRecipientKeypairV1::derive_from_ikm(*self.material)
            .map_err(|_| invalid("Invalid recovery key material"))?;
        Ok(TenantRootRecoveryKeyMaterialV1 {
            role: self.role,
            recipient,
        })
    }
    /// Serializes one private file; temporary serialized bytes zeroize on drop.
    pub fn to_bytes(&self) -> RecoveryCoreResult<Zeroizing<Vec<u8>>> {
        let public = self.open()?.public_key();
        let mut bytes = Zeroizing::new(Vec::with_capacity(RECOVERY_KEY_FILE_MAX_BYTES));
        bytes.extend_from_slice(RECOVERY_KEY_FILE_MAGIC_V1);
        bytes.push(match self.role {
            TwoPartyDeriverRole::DeriverA => 1,
            TwoPartyDeriverRole::DeriverB => 2,
        });
        bytes.extend_from_slice(self.material.as_ref());
        bytes.extend_from_slice(public.as_bytes());
        bytes.extend_from_slice(public.fingerprint().as_bytes());
        Ok(bytes)
    }
    /// Parses a file and checks that its public metadata matches its private material.
    pub fn decode(bytes: &[u8]) -> RecoveryCoreResult<Self> {
        if bytes.len() != RECOVERY_KEY_FILE_MAX_BYTES || &bytes[..8] != RECOVERY_KEY_FILE_MAGIC_V1 {
            return Err(invalid(
                "Invalid recovery key file. Use the .key file from your new recovery kit.",
            ));
        }
        let role = match bytes[8] {
            1 => TwoPartyDeriverRole::DeriverA,
            2 => TwoPartyDeriverRole::DeriverB,
            _ => return Err(invalid("Invalid recovery key role")),
        };
        let mut material = Zeroizing::new([0; 32]);
        material.copy_from_slice(&bytes[9..41]);
        let file = Self { role, material };
        let public = file.open()?.public_key();
        if public.as_bytes() != &bytes[41..73] || public.fingerprint().as_bytes() != &bytes[73..105]
        {
            return Err(invalid(
                "Recovery key file metadata does not match its private key",
            ));
        }
        Ok(file)
    }
}

/// Checks that two holders have distinct roles and keys.
pub fn require_distinct_role_key_files_v1(
    left: &RecoveryKeyFileV1,
    right: &RecoveryKeyFileV1,
) -> RecoveryCoreResult<()> {
    if left.role == right.role || left.fingerprint() == right.fingerprint() {
        return Err(invalid(
            "Recovery holders must have distinct roles and keys",
        ));
    }
    Ok(())
}
fn invalid(message: &str) -> RecoveryCoreError {
    RecoveryCoreError::new(RecoveryCoreErrorCode::KeyProviderFailure, message)
}
