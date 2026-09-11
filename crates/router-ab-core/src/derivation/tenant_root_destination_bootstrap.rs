//! Destination bootstrap authority and restore session admission (Refactor 121).
//!
//! Restore targets an empty deployment, which by definition has no tenant,
//! no owners, and no console session anyone could authenticate against. Its
//! only authority is a one-time bearer credential shown once to whoever
//! initialized it.
//!
//! Three properties this module enforces:
//!
//! - **The token is never stored.** The destination keeps only a digest bound
//!   to its own deployment fingerprint, and compares in constant time, so a
//!   digest lifted from one deployment cannot authenticate another.
//! - **A console session is not bootstrap authority.** Sessions from the
//!   *source* deployment prove nothing about the destination, so restore
//!   admission takes this credential and nothing else.
//! - **One share per role, one key at a time.** Reissuing a role import key
//!   invalidates its predecessor, and no key is issued once that role has
//!   installed its share.

use core::fmt;
use core::num::NonZeroU64;

use rand_core_09::{CryptoRng, RngCore};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use threshold_prf::TwoPartyDeriverRole;
use zeroize::Zeroizing;

use super::tenant_root_recovery_artifacts::{malformed, verification_failed};
use super::{
    RouterAbDerivationResult, TenantRootRestoreDestinationFingerprintV1,
    TenantRootRestoreSessionIdV1,
};

const DESTINATION_BOOTSTRAP_DOMAIN_V1: &[u8] = b"seams/destination-bootstrap/v1";
const DESTINATION_BOOTSTRAP_TOKEN_BYTES: usize = 32;

/// How long one restore administration session lives.
pub const TENANT_ROOT_RESTORE_ADMIN_SESSION_MS_V1: i64 = 1_800_000;
/// How long one restore session lives.
pub const TENANT_ROOT_RESTORE_SESSION_MS_V1: i64 = 86_400_000;
/// How long one role import key lives.
pub const TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1: i64 = 900_000;
/// How recently bootstrap authority must be reproved before activation.
pub const TENANT_ROOT_ACTIVATION_REAUTH_MAX_AGE_MS_V1: i64 = 300_000;

/// One one-time destination bootstrap bearer token.
///
/// The token exists only between initialization and being shown once. It is
/// zeroized on drop and never rendered by `Debug`.
pub struct DestinationBootstrapTokenV1(Zeroizing<[u8; DESTINATION_BOOTSTRAP_TOKEN_BYTES]>);

impl fmt::Debug for DestinationBootstrapTokenV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("DestinationBootstrapTokenV1")
            .field(&"[redacted]")
            .finish()
    }
}

impl DestinationBootstrapTokenV1 {
    /// Wraps exact token bytes supplied by an operator.
    pub fn from_bytes(
        bytes: [u8; DESTINATION_BOOTSTRAP_TOKEN_BYTES],
    ) -> RouterAbDerivationResult<Self> {
        if bytes.iter().all(|byte| *byte == 0) {
            return Err(malformed("destination bootstrap token must be non-zero"));
        }
        Ok(Self(Zeroizing::new(bytes)))
    }

    /// Returns the token bytes for the single display to the deployment owner.
    pub fn expose_once(&self) -> &[u8; DESTINATION_BOOTSTRAP_TOKEN_BYTES] {
        &self.0
    }
}

/// The stored destination bootstrap authority: a digest, never a token.
#[derive(Clone, PartialEq, Eq)]
pub struct DestinationBootstrapAuthorityV1 {
    deployment_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    token_digest: [u8; 32],
}

impl fmt::Debug for DestinationBootstrapAuthorityV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DestinationBootstrapAuthorityV1")
            .field("deployment_fingerprint", &self.deployment_fingerprint)
            .field("token_digest", &"[redacted]")
            .finish()
    }
}

impl DestinationBootstrapAuthorityV1 {
    /// Initializes one empty deployment's bootstrap authority.
    pub fn initialize<R>(
        deployment_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        rng: &mut R,
    ) -> RouterAbDerivationResult<(Self, DestinationBootstrapTokenV1)>
    where
        R: RngCore + CryptoRng,
    {
        let mut bytes = [0_u8; DESTINATION_BOOTSTRAP_TOKEN_BYTES];
        rng.fill_bytes(&mut bytes);
        let token = DestinationBootstrapTokenV1::from_bytes(bytes)?;
        let authority = Self {
            deployment_fingerprint,
            token_digest: token_digest(&deployment_fingerprint, token.expose_once()),
        };
        Ok((authority, token))
    }

    /// Returns the deployment this authority belongs to.
    pub const fn deployment_fingerprint(&self) -> TenantRootRestoreDestinationFingerprintV1 {
        self.deployment_fingerprint
    }

    /// Returns the stored digest.
    pub const fn token_digest(&self) -> &[u8; 32] {
        &self.token_digest
    }

    /// Reconstructs an authority from its provisioned public fingerprint and
    /// persisted token digest. Identity and custody-lineage binding belongs to
    /// the destination storage boundary that owns this authority.
    pub fn from_persisted_digest(
        deployment_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        token_digest: [u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        if token_digest.iter().all(|byte| *byte == 0) {
            return Err(malformed(
                "destination bootstrap token digest must be non-zero",
            ));
        }
        Ok(Self {
            deployment_fingerprint,
            token_digest,
        })
    }

    /// Verifies one presented token in constant time.
    ///
    /// The digest binds the deployment fingerprint, so a digest copied from
    /// another deployment cannot be replayed here.
    pub fn verify(
        &self,
        deployment_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        token: &DestinationBootstrapTokenV1,
    ) -> RouterAbDerivationResult<()> {
        let expected = token_digest(&deployment_fingerprint, token.expose_once());
        let matches = self.token_digest.ct_eq(&expected)
            & self
                .deployment_fingerprint
                .as_bytes()
                .ct_eq(deployment_fingerprint.as_bytes());
        if bool::from(matches) {
            Ok(())
        } else {
            Err(verification_failed(
                "destination bootstrap authority verification failed",
            ))
        }
    }
}

fn token_digest(
    deployment_fingerprint: &TenantRootRestoreDestinationFingerprintV1,
    token: &[u8; DESTINATION_BOOTSTRAP_TOKEN_BYTES],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(DESTINATION_BOOTSTRAP_DOMAIN_V1);
    hasher.update(deployment_fingerprint.as_bytes());
    hasher.update(token);
    hasher.finalize().into()
}

/// One restore administration session minted from the bootstrap authority.
///
/// There is no public constructor: holding one means the bootstrap credential
/// was presented. A source-deployment console session can never produce it.
pub struct RestoreAdministrationSessionV1 {
    deployment_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    authenticated_at_ms: i64,
    expires_at_ms: i64,
}

impl fmt::Debug for RestoreAdministrationSessionV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RestoreAdministrationSessionV1")
            .field("deployment_fingerprint", &self.deployment_fingerprint)
            .field("authenticated_at_ms", &self.authenticated_at_ms)
            .field("expires_at_ms", &self.expires_at_ms)
            .finish()
    }
}

impl RestoreAdministrationSessionV1 {
    /// Returns the deployment this session administers.
    pub const fn deployment_fingerprint(&self) -> TenantRootRestoreDestinationFingerprintV1 {
        self.deployment_fingerprint
    }

    /// Returns when the bootstrap credential was presented.
    pub const fn authenticated_at_ms(&self) -> i64 {
        self.authenticated_at_ms
    }

    /// Returns the session expiry.
    pub const fn expires_at_ms(&self) -> i64 {
        self.expires_at_ms
    }

    /// Returns whether the session is live at one instant.
    pub const fn is_live_at(&self, now_ms: i64) -> bool {
        now_ms < self.expires_at_ms
    }

    /// Returns whether activation may proceed on this session's authentication.
    ///
    /// Activation destroys the source-independence boundary, so it requires
    /// bootstrap reauthentication at most five minutes old rather than merely
    /// a live session.
    pub const fn permits_activation_at(&self, now_ms: i64) -> bool {
        self.is_live_at(now_ms)
            && now_ms >= self.authenticated_at_ms
            && now_ms - self.authenticated_at_ms <= TENANT_ROOT_ACTIVATION_REAUTH_MAX_AGE_MS_V1
    }
}

/// Authenticates one bootstrap credential and mints an administration session.
pub fn authenticate_destination_bootstrap_v1(
    authority: &DestinationBootstrapAuthorityV1,
    deployment_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    token: &DestinationBootstrapTokenV1,
    now_ms: i64,
) -> RouterAbDerivationResult<RestoreAdministrationSessionV1> {
    authority.verify(deployment_fingerprint, token)?;
    Ok(RestoreAdministrationSessionV1 {
        deployment_fingerprint,
        authenticated_at_ms: now_ms,
        expires_at_ms: now_ms.saturating_add(TENANT_ROOT_RESTORE_ADMIN_SESSION_MS_V1),
    })
}

/// One issued role import key and its lifetime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleImportKeyIssuanceV1 {
    role: TwoPartyDeriverRole,
    key_id: String,
    generation: NonZeroU64,
    issued_at_ms: i64,
    expires_at_ms: i64,
}

impl RoleImportKeyIssuanceV1 {
    /// Returns the role this key serves.
    pub const fn role(&self) -> TwoPartyDeriverRole {
        self.role
    }

    /// Returns the key identifier.
    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    /// Returns the monotonic issuance generation.
    ///
    /// Reissuing invalidates the predecessor, and the generation is what makes
    /// that visible to the destination role.
    pub const fn generation(&self) -> NonZeroU64 {
        self.generation
    }

    /// Returns the key expiry.
    pub const fn expires_at_ms(&self) -> i64 {
        self.expires_at_ms
    }

    /// Returns whether this key is still usable at one instant.
    pub const fn is_live_at(&self, now_ms: i64) -> bool {
        now_ms < self.expires_at_ms
    }
}

/// Why a role import key could not be issued.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleImportKeyIssueRefusalV1 {
    /// The administration session is not live.
    SessionExpired,
    /// That role already installed its share.
    RoleAlreadyInstalled,
    /// The issuance generation would overflow.
    GenerationExhausted,
}

/// Issues one role import key, superseding any unconsumed predecessor.
pub fn issue_role_import_key_v1(
    session: &RestoreAdministrationSessionV1,
    role: TwoPartyDeriverRole,
    key_id: impl Into<String>,
    previous: Option<&RoleImportKeyIssuanceV1>,
    role_share_installed: bool,
    now_ms: i64,
) -> Result<RoleImportKeyIssuanceV1, RoleImportKeyIssueRefusalV1> {
    if !session.is_live_at(now_ms) {
        return Err(RoleImportKeyIssueRefusalV1::SessionExpired);
    }
    if role_share_installed {
        // A role that already installed its share has no use for another key,
        // and issuing one would widen the window for a second import attempt.
        return Err(RoleImportKeyIssueRefusalV1::RoleAlreadyInstalled);
    }
    let generation = match previous {
        None => NonZeroU64::new(1).expect("one is non-zero"),
        Some(previous) => previous
            .generation
            .get()
            .checked_add(1)
            .and_then(NonZeroU64::new)
            .ok_or(RoleImportKeyIssueRefusalV1::GenerationExhausted)?,
    };
    Ok(RoleImportKeyIssuanceV1 {
        role,
        key_id: key_id.into(),
        generation,
        issued_at_ms: now_ms,
        expires_at_ms: now_ms.saturating_add(TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1),
    })
}

/// Returns whether one presented import key is the current, live one.
///
/// A superseded generation is refused even before its own expiry: reissuing
/// invalidates the predecessor immediately.
pub fn role_import_key_is_current_v1(
    current: &RoleImportKeyIssuanceV1,
    presented_key_id: &str,
    presented_generation: NonZeroU64,
    now_ms: i64,
) -> bool {
    current.is_live_at(now_ms)
        && current.key_id == presented_key_id
        && current.generation == presented_generation
}

/// Returns whether one restore session has expired.
pub const fn restore_session_expired_v1(started_at_ms: i64, now_ms: i64) -> bool {
    now_ms.saturating_sub(started_at_ms) >= TENANT_ROOT_RESTORE_SESSION_MS_V1
}

/// Returns the deterministic session identifier binding for one destination.
///
/// The destination fingerprint is part of the binding so a session id from one
/// deployment cannot be presented to another.
pub fn restore_session_binding_digest_v1(
    deployment_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    session_id: TenantRootRestoreSessionIdV1,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"seams/tenant-root-restore-session/v1");
    hasher.update(deployment_fingerprint.as_bytes());
    hasher.update(session_id.as_bytes());
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_chacha_09::ChaCha20Rng;
    use rand_core_09::SeedableRng;

    fn fingerprint(seed: u8) -> TenantRootRestoreDestinationFingerprintV1 {
        TenantRootRestoreDestinationFingerprintV1::from_bytes([seed; 32]).expect("fingerprint")
    }

    #[test]
    fn persisted_digest_reconstructs_the_same_constant_time_authority() {
        let (authority, token) = DestinationBootstrapAuthorityV1::initialize(
            fingerprint(0x41),
            &mut ChaCha20Rng::from_seed([0x42; 32]),
        )
        .expect("authority");
        let reconstructed = DestinationBootstrapAuthorityV1::from_persisted_digest(
            authority.deployment_fingerprint(),
            *authority.token_digest(),
        )
        .expect("reconstructed authority");

        assert!(reconstructed.verify(fingerprint(0x41), &token).is_ok());
        assert!(reconstructed.verify(fingerprint(0x42), &token).is_err());
        assert!(
            DestinationBootstrapAuthorityV1::from_persisted_digest(fingerprint(0x41), [0; 32],)
                .is_err()
        );
    }

    #[test]
    fn authority_debug_redacts_the_persisted_digest() {
        let (authority, _token) = DestinationBootstrapAuthorityV1::initialize(
            fingerprint(0x51),
            &mut ChaCha20Rng::from_seed([0x52; 32]),
        )
        .expect("authority");
        let debug = format!("{authority:?}");

        assert!(debug.contains("[redacted]"));
        assert!(!debug.contains(&hex::encode(authority.token_digest())));
    }
}
