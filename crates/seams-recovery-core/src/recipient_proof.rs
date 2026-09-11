//! Proving control of one recovery recipient key.
//!
//! Enrolment cannot ask an X25519 key to sign, so control is proved by opening
//! an encrypted challenge. The console seals a one-use secret to the submitted
//! public key, bound to the tenant, lineage, role, fingerprint, actor, and
//! lifecycle revision; only the holder of that private key can recover the
//! secret and return the confirmation over the same binding.
//!
//! Nothing here returns the challenge secret. It exists only long enough to
//! produce the confirmation, and the result carries public material only.

use router_ab_core::{
    confirm_tenant_root_recovery_recipient_proof_v1,
    decode_tenant_root_recovery_recipient_proof_v1, open_tenant_root_recovery_recipient_proof_v1,
    RouterAbDerivationError, TwoPartyDeriverRole,
};
use serde::Serialize;
use std::path::Path;
use zeroize::Zeroizing;

use crate::durable_file::read_capped_file_v1;
use crate::key_file::{RecoveryKeyFileV1, RECOVERY_KEY_FILE_MAX_BYTES};
use crate::{RecoveryCoreError, RecoveryCoreErrorCode, RecoveryCoreResult};

/// Maximum bytes read for one challenge envelope before allocation.
pub const RECOVERY_RECIPIENT_CHALLENGE_MAX_BYTES: usize = 4 * 1024;

/// The public result of proving control of one recipient key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipientProofResultV1 {
    /// The role this recipient serves.
    pub role: String,
    /// The challenge this proof answers.
    pub challenge_id_b64u: String,
    /// The public recipient key to enrol.
    pub public_key_b64u: String,
    /// The public-key fingerprint.
    pub fingerprint_b64u: String,
    /// The confirmation to submit. Derived from the secret, never the secret.
    pub confirmation_b64u: String,
}

/// Proves control of one recovery recipient key against one challenge.
///
/// The challenge must name this key file's own role and fingerprint. A
/// challenge for the other role, or for a different key, fails before the
/// private key is used.
pub fn prove_recovery_recipient_control_v1(
    key_file_path: &Path,

    expected_role: TwoPartyDeriverRole,
    challenge_path: &Path,
) -> RecoveryCoreResult<RecipientProofResultV1> {
    let challenge = read_capped_file_v1(challenge_path, RECOVERY_RECIPIENT_CHALLENGE_MAX_BYTES)?;
    prove_recovery_recipient_control_from_bytes_v1(key_file_path, expected_role, &challenge)
}

/// Proves control of one recovery recipient key against one challenge envelope
/// the console returned directly, without the envelope touching disk.
pub fn prove_recovery_recipient_control_from_bytes_v1(
    key_file_path: &Path,

    expected_role: TwoPartyDeriverRole,
    challenge_bytes: &[u8],
) -> RecoveryCoreResult<RecipientProofResultV1> {
    if challenge_bytes.len() > RECOVERY_RECIPIENT_CHALLENGE_MAX_BYTES {
        return Err(RecoveryCoreError::new(
            RecoveryCoreErrorCode::ArtifactVerificationFailed,
            "the recipient challenge exceeds its size cap",
        ));
    }
    let key_file = RecoveryKeyFileV1::decode(&Zeroizing::new(read_capped_file_v1(
        key_file_path,
        RECOVERY_KEY_FILE_MAX_BYTES,
    )?))?;
    if key_file.role() != expected_role {
        return Err(RecoveryCoreError::new(
            RecoveryCoreErrorCode::KeyProviderFailure,
            "this recovery key file belongs to the other Deriver role",
        ));
    }

    let envelope = decode_tenant_root_recovery_recipient_proof_v1(challenge_bytes)
        .map_err(challenge_failure)?;
    let binding = envelope.binding();
    if binding.role() != expected_role {
        return Err(RecoveryCoreError::new(
            RecoveryCoreErrorCode::ArtifactVerificationFailed,
            "this challenge was issued for the other Deriver role",
        ));
    }
    if binding.recipient_fingerprint().as_bytes() != key_file.fingerprint().as_bytes() {
        return Err(RecoveryCoreError::new(
            RecoveryCoreErrorCode::ArtifactVerificationFailed,
            "this challenge was issued for a different recovery key",
        ));
    }

    let material = key_file.open()?;
    let secret = open_tenant_root_recovery_recipient_proof_v1(&envelope, material.recipient())
        .map_err(challenge_failure)?;
    let confirmation = confirm_tenant_root_recovery_recipient_proof_v1(binding, secret.as_bytes())
        .map_err(challenge_failure)?;

    Ok(RecipientProofResultV1 {
        role: expected_role.as_str().to_owned(),
        challenge_id_b64u: encode(binding.challenge_id()),
        public_key_b64u: encode(material.public_key().as_bytes()),
        fingerprint_b64u: encode(material.fingerprint().as_bytes()),
        confirmation_b64u: encode(confirmation.as_bytes()),
    })
}

fn encode(bytes: &[u8]) -> String {
    use base64ct::{Base64UrlUnpadded, Encoding};
    Base64UrlUnpadded::encode_string(bytes)
}

fn challenge_failure(error: RouterAbDerivationError) -> RecoveryCoreError {
    RecoveryCoreError::new(
        RecoveryCoreErrorCode::ArtifactVerificationFailed,
        error.message().to_owned(),
    )
}
