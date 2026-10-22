use crate::ClientActivationError;

/// Checks public identities before the Client releases a reconstructed seed.
/// Both inputs contain public key bytes, so equality may use ordinary comparison.
pub(crate) fn validate_export_public_key(
    reconstructed_public_key: [u8; 32],
    registered_public_key: [u8; 32],
) -> Result<(), ClientActivationError> {
    if reconstructed_public_key != registered_public_key {
        return Err(ClientActivationError::PublicKeyContinuityMismatch);
    }
    Ok(())
}
