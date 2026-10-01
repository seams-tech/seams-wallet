use crate::crypto::WrapKey;

pub(crate) fn derive_threshold_client_verifying_share_b64u_v1(
    wrap_key: &WrapKey,
    near_account_id: &str,
) -> Result<String, String> {
    signer_core::near_threshold_ed25519::derive_threshold_client_verifying_share_b64u_v1_from_wrap_key_seed_b64u(
        &wrap_key.wrap_key_seed,
        near_account_id,
    )
    .map_err(|e| e.to_string())
}
