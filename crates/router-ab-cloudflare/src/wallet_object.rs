use router_ab_core::RouterAbProtocolResult;

/// Physical lookup is independent of the stable name authenticated by ciphertext.
pub(crate) fn physical_wallet_object_name(
    logical_name: &str,
    ownership_generation: u64,
) -> RouterAbProtocolResult<String> {
    crate::router_wallet::validate_wallet_ownership_generation(ownership_generation)?;
    // Persisted generation-one wallets already occupy the stable name.
    if ownership_generation == 1 {
        return Ok(logical_name.to_owned());
    }
    Ok(format!("{logical_name}/generation/{ownership_generation}"))
}

#[derive(Clone, Copy)]
pub(crate) struct SigningWorkerWalletRoute<'a> {
    pub scope: &'a crate::CloudflareSigningWorkerWalletScopeV1,
    pub ownership_generation: u64,
}
