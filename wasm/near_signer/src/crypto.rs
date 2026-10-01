/// Ephemeral wrap key material derived in the SecureConfirm worker and delivered to the signer.
/// Holds the base64url-encoded WrapKeySeed and its salt.
#[derive(Clone)]
pub struct WrapKey {
    pub(crate) wrap_key_seed: String,
    pub(crate) wrap_key_salt: String,
}

impl WrapKey {
    /// Return the base64url-encoded wrap_key_salt associated with this wrap key.
    pub fn salt_b64u(&self) -> &str {
        &self.wrap_key_salt
    }
}

impl std::fmt::Debug for WrapKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WrapKey")
            .field("wrap_key_seed", &"***")
            .field("wrap_key_salt", &self.wrap_key_salt)
            .finish()
    }
}
