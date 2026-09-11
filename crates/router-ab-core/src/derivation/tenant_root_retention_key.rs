//! Role- and set-isolated retention keys for stored recovery packages.
//!
//! A tenant recovery package is already encrypted to the tenant's own recipient
//! key. This is the *outer* wrap the service applies before storing it, and it
//! exists for one reason: so the service can make the stored bytes permanently
//! unopenable without depending on a storage system actually forgetting them.
//!
//! Destroying one key version is therefore the whole point. A key is scoped to
//! one recovery set and one role, so destroying it removes exactly that role's
//! stored package and nothing else — which is what `managed_healing_v1` claims
//! and what the deployed shared per-role KMS version cannot provide, since
//! destroying it would destroy every tenant's material.
//!
//! This module owns the wrap: the key's identity, and the binding that stops
//! one role's package being unwrapped as another's. It deliberately owns no
//! destruction path. Destruction is a property of wherever the secret actually
//! lives, and a receipt this process wrote would be evidence of nothing —
//! deleting a local copy does not destroy a key a provider still holds. When a
//! destructible provider is chosen, its own destruction evidence is the only
//! thing that may satisfy `managed_healing_v1`.

use core::fmt;
use core::num::NonZeroU64;

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use rand_core_09::{CryptoRng, RngCore};
use sha2::{Digest, Sha256};
use threshold_prf::TwoPartyDeriverRole;
use zeroize::{Zeroize, Zeroizing};

use super::tenant_root_recovery_artifacts::{malformed, verification_failed};
use super::{RouterAbDerivationResult, TenantRootRecoverySetId};

const RETENTION_KEY_BYTES: usize = 32;
const RETENTION_NONCE_BYTES: usize = 12;
const RETENTION_WRAP_DOMAIN_V1: &[u8] = b"seams/tenant-root-retention-wrap/v1";

/// Identifies one retention key: one recovery set, one role, one version.
///
/// Every field is part of the wrap's authenticated data, so a package stored
/// under one identity can never be opened under another.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TenantRootRetentionKeyIdV1 {
    recovery_set_id: TenantRootRecoverySetId,
    role: TwoPartyDeriverRole,
    version: NonZeroU64,
}

impl TenantRootRetentionKeyIdV1 {
    /// Names one retention key version.
    pub const fn new(
        recovery_set_id: TenantRootRecoverySetId,
        role: TwoPartyDeriverRole,
        version: NonZeroU64,
    ) -> Self {
        Self {
            recovery_set_id,
            role,
            version,
        }
    }

    /// Returns the recovery set this key is isolated to.
    pub const fn recovery_set_id(&self) -> TenantRootRecoverySetId {
        self.recovery_set_id
    }

    /// Returns the role this key is isolated to.
    pub const fn role(&self) -> TwoPartyDeriverRole {
        self.role
    }

    /// Returns the key version.
    pub const fn version(&self) -> NonZeroU64 {
        self.version
    }

    /// Returns the canonical bytes bound into every wrap under this key.
    pub fn binding_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(RETENTION_WRAP_DOMAIN_V1);
        bytes.extend_from_slice(self.recovery_set_id.as_bytes());
        bytes.extend_from_slice(self.role.as_str().as_bytes());
        bytes.extend_from_slice(&self.version.get().to_be_bytes());
        bytes
    }

    /// Returns the public digest naming this key version in receipts and audit.
    pub fn digest(&self) -> [u8; 32] {
        Sha256::digest(self.binding_bytes()).into()
    }
}

/// One retention key's secret, held only while a package is wrapped or opened.
pub struct TenantRootRetentionKeySecretV1 {
    id: TenantRootRetentionKeyIdV1,
    secret: Zeroizing<[u8; RETENTION_KEY_BYTES]>,
}

impl fmt::Debug for TenantRootRetentionKeySecretV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TenantRootRetentionKeySecretV1")
            .field("id", &self.id)
            .field("secret", &"[redacted]")
            .finish()
    }
}

impl TenantRootRetentionKeySecretV1 {
    /// Provisions one fresh retention key version.
    pub fn provision<R>(id: TenantRootRetentionKeyIdV1, rng: &mut R) -> Self
    where
        R: RngCore + CryptoRng,
    {
        let mut secret = Zeroizing::new([0_u8; RETENTION_KEY_BYTES]);
        rng.fill_bytes(secret.as_mut());
        Self { id, secret }
    }

    /// Adopts key material a provisioned key store returned.
    pub fn from_provider_bytes(
        id: TenantRootRetentionKeyIdV1,
        bytes: [u8; RETENTION_KEY_BYTES],
    ) -> RouterAbDerivationResult<Self> {
        let mut bytes = Zeroizing::new(bytes);
        if bytes.iter().all(|byte| *byte == 0) {
            bytes.zeroize();
            return Err(malformed("tenant root retention key must be non-zero"));
        }
        Ok(Self { id, secret: bytes })
    }

    /// Returns the key version this secret belongs to.
    pub const fn id(&self) -> TenantRootRetentionKeyIdV1 {
        self.id
    }

    /// Wraps one already tenant-encrypted package for storage.
    pub fn wrap<R>(
        &self,
        package_bytes: &[u8],
        rng: &mut R,
    ) -> RouterAbDerivationResult<TenantRootRetainedPackageV1>
    where
        R: RngCore + CryptoRng,
    {
        if package_bytes.is_empty() {
            return Err(malformed("tenant root retained package is empty"));
        }
        let mut nonce = [0_u8; RETENTION_NONCE_BYTES];
        rng.fill_bytes(&mut nonce);
        let ciphertext = ChaCha20Poly1305::new(Key::from_slice(self.secret.as_ref()))
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: package_bytes,
                    aad: &self.id.binding_bytes(),
                },
            )
            .map_err(|_| verification_failed("tenant root retention wrap failed"))?;
        Ok(TenantRootRetainedPackageV1 {
            id: self.id,
            nonce,
            ciphertext,
        })
    }

    /// Opens one retained package wrapped under this exact key version.
    pub fn unwrap(
        &self,
        retained: &TenantRootRetainedPackageV1,
    ) -> RouterAbDerivationResult<Zeroizing<Vec<u8>>> {
        // The key version is authenticated data, so a package stored for another
        // role, set, or version cannot be opened here even with this secret.
        if retained.id != self.id {
            return Err(verification_failed(
                "tenant root retained package belongs to another retention key version",
            ));
        }
        let plaintext = ChaCha20Poly1305::new(Key::from_slice(self.secret.as_ref()))
            .decrypt(
                Nonce::from_slice(&retained.nonce),
                Payload {
                    msg: &retained.ciphertext,
                    aad: &self.id.binding_bytes(),
                },
            )
            .map_err(|_| verification_failed("tenant root retained package could not be opened"))?;
        Ok(Zeroizing::new(plaintext))
    }
}

/// One stored package under its retention key version.
#[derive(Clone, PartialEq, Eq)]
pub struct TenantRootRetainedPackageV1 {
    id: TenantRootRetentionKeyIdV1,
    nonce: [u8; RETENTION_NONCE_BYTES],
    ciphertext: Vec<u8>,
}

impl fmt::Debug for TenantRootRetainedPackageV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TenantRootRetainedPackageV1")
            .field("id", &self.id)
            .field("ciphertext", &"[wrapped]")
            .finish()
    }
}

impl TenantRootRetainedPackageV1 {
    /// Returns the retention key version this package is stored under.
    pub const fn retention_key_id(&self) -> TenantRootRetentionKeyIdV1 {
        self.id
    }

    /// Returns the wrap nonce.
    pub const fn nonce(&self) -> &[u8; RETENTION_NONCE_BYTES] {
        &self.nonce
    }

    /// Returns the wrapped bytes.
    pub fn ciphertext(&self) -> &[u8] {
        &self.ciphertext
    }

    /// Rebuilds one retained package from storage.
    pub fn from_parts(
        id: TenantRootRetentionKeyIdV1,
        nonce: [u8; RETENTION_NONCE_BYTES],
        ciphertext: Vec<u8>,
    ) -> RouterAbDerivationResult<Self> {
        if ciphertext.is_empty() {
            return Err(malformed("tenant root retained package is empty"));
        }
        Ok(Self {
            id,
            nonce,
            ciphertext,
        })
    }
}
