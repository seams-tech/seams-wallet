//! Deriver A and B target prepare and complete for the v2 Yao lifecycle, and the sealed target proofs.

use super::*;

/// Prepares the V2 role-target preface from the authenticated Deriver A share.
///
/// The returned state owns only A's local threshold-PRF partial. Its outbound
/// plaintext is the fixed B-target proof exposed by
/// [`Ed25519YaoDeriverAPrefaceInFlightV2::outbound_plaintext`].
pub(crate) fn prepare_cloudflare_ed25519_yao_deriver_a_target_v2(
    role_share: VerifiedTenantRootOnlineRoleShareV1,
    custody_binding: &TenantRootCustodyBindingV1,
    outer_binding: Ed25519YaoOuterBindingV2,
    stable_context: &Ed25519YaoStableKeyDerivationContextV1,
) -> RouterAbProtocolResult<Ed25519YaoDeriverAPrefaceInFlightV2> {
    validate_cloudflare_ed25519_yao_v2_binding(&outer_binding, custody_binding, stable_context)?;
    let (role_binding, share_wire) = role_share.into_parts();
    validate_cloudflare_ed25519_yao_v2_role_share(
        &role_binding,
        custody_binding,
        TwoPartyDeriverRole::DeriverA,
    )?;
    let share = share_wire
        .to_share()
        .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    let expected_peer_commitment = SigningRootShareCommitment::from_slice(
        custody_binding.commitments().deriver_b().as_bytes(),
    )
    .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    let stable_context_bytes = stable_context.encode();
    let mut rng = crate::CloudflareSignerProofGetrandomRngV1;
    let (prepared, outbound) = prepare_ed25519_deriver_a_target_v1(
        &share,
        expected_peer_commitment,
        &stable_context_bytes,
        &mut rng,
    )
    .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    Ed25519YaoDeriverAPrefaceInFlightV2::new(outer_binding, prepared, outbound)
}

/// Completes the V2 Deriver A preface and feeds its target root into the
/// unchanged role-local contribution KDF.
pub(crate) fn complete_cloudflare_ed25519_yao_deriver_a_target_v2(
    preface: Ed25519YaoDeriverAPrefaceInFlightV2,
    incoming: &Ed25519YaoDeriverBToATargetProofPayloadV2,
    incoming_plaintext: &[u8],
    expected_outer_binding: &Ed25519YaoOuterBindingV2,
    stable_context: &Ed25519YaoStableKeyDerivationContextV1,
) -> RouterAbProtocolResult<Ed25519YaoDeriverAServerContributionV1> {
    let ready = preface
        .complete(incoming, incoming_plaintext)
        .map_err(|error| invalid_lifecycle(error.message()))?;
    if ready.binding() != expected_outer_binding
        || stable_context.binding_digest() != ready.binding().stable_context_binding().into_bytes()
    {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 Deriver A completion binding does not match the stable context",
        ));
    }
    let target_root = ready.into_threshold_prf_root().into_secret_bytes();
    derive_ed25519_yao_deriver_a_server_contribution_v1(
        &Ed25519YaoDeriverADerivationRootV1::from_secret_bytes(*target_root),
        stable_context,
    )
    .map_err(|error| {
        invalid_lifecycle(format!(
            "Ed25519 Yao Deriver A contribution failed: {error}"
        ))
    })
}

/// Prepares the V2 role-target preface from the authenticated Deriver B share.
///
/// The returned state owns only B's local threshold-PRF partial. Its outbound
/// plaintext is the fixed A-target proof exposed by
/// [`Ed25519YaoDeriverBPrefaceInFlightV2::outbound_plaintext`].
pub(crate) fn prepare_cloudflare_ed25519_yao_deriver_b_target_v2(
    role_share: VerifiedTenantRootOnlineRoleShareV1,
    custody_binding: &TenantRootCustodyBindingV1,
    outer_binding: Ed25519YaoOuterBindingV2,
    stable_context: &Ed25519YaoStableKeyDerivationContextV1,
) -> RouterAbProtocolResult<Ed25519YaoDeriverBPrefaceInFlightV2> {
    validate_cloudflare_ed25519_yao_v2_binding(&outer_binding, custody_binding, stable_context)?;
    let (role_binding, share_wire) = role_share.into_parts();
    validate_cloudflare_ed25519_yao_v2_role_share(
        &role_binding,
        custody_binding,
        TwoPartyDeriverRole::DeriverB,
    )?;
    let share = share_wire
        .to_share()
        .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    let expected_peer_commitment = SigningRootShareCommitment::from_slice(
        custody_binding.commitments().deriver_a().as_bytes(),
    )
    .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    let stable_context_bytes = stable_context.encode();
    let mut rng = crate::CloudflareSignerProofGetrandomRngV1;
    let (prepared, outbound) = prepare_ed25519_deriver_b_target_v1(
        &share,
        expected_peer_commitment,
        &stable_context_bytes,
        &mut rng,
    )
    .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    Ed25519YaoDeriverBPrefaceInFlightV2::new(outer_binding, prepared, outbound)
}

/// Completes the V2 Deriver B preface and feeds its target root into the
/// unchanged role-local contribution KDF.
pub(crate) fn complete_cloudflare_ed25519_yao_deriver_b_target_v2(
    preface: Ed25519YaoDeriverBPrefaceInFlightV2,
    incoming: &Ed25519YaoDeriverAToBTargetProofPayloadV2,
    incoming_plaintext: &[u8],
    expected_outer_binding: &Ed25519YaoOuterBindingV2,
    stable_context: &Ed25519YaoStableKeyDerivationContextV1,
) -> RouterAbProtocolResult<Ed25519YaoDeriverBServerContributionV1> {
    let ready = preface
        .complete(incoming, incoming_plaintext)
        .map_err(|error| invalid_lifecycle(error.message()))?;
    if ready.binding() != expected_outer_binding
        || stable_context.binding_digest() != ready.binding().stable_context_binding().into_bytes()
    {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 Deriver B completion binding does not match the stable context",
        ));
    }
    let target_root = ready.into_threshold_prf_root().into_secret_bytes();
    derive_ed25519_yao_deriver_b_server_contribution_v1(
        &Ed25519YaoDeriverBDerivationRootV1::from_secret_bytes(*target_root),
        stable_context,
    )
    .map_err(|error| {
        invalid_lifecycle(format!(
            "Ed25519 Yao Deriver B contribution failed: {error}"
        ))
    })
}

pub(super) fn validate_cloudflare_ed25519_yao_v2_binding(
    outer_binding: &Ed25519YaoOuterBindingV2,
    custody_binding: &TenantRootCustodyBindingV1,
    stable_context: &Ed25519YaoStableKeyDerivationContextV1,
) -> RouterAbProtocolResult<()> {
    outer_binding
        .validate_at(
            cloudflare_yao_now_unix_ms().map_err(|_| {
                invalid_lifecycle("Ed25519 Yao V2 outer binding clock is unavailable")
            })?,
        )
        .map_err(|error| invalid_lifecycle(error.message()))?;
    custody_binding
        .validate()
        .map_err(|error| invalid_lifecycle(error.message()))?;
    if stable_context.binding_digest() != outer_binding.stable_context_binding().into_bytes() {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 outer binding does not match the stable context",
        ));
    }
    let custody_digest = custody_binding
        .digest()
        .map_err(|error| invalid_lifecycle(error.message()))?;
    if outer_binding.custody_binding_digest() != PublicDigest32::new(custody_digest.into_bytes()) {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 outer binding does not match the custody binding",
        ));
    }
    Ok(())
}

pub(super) fn validate_cloudflare_ed25519_yao_v2_role_share(
    role_binding: &router_ab_core::TenantRootOnlineRoleShareBindingV1,
    custody_binding: &TenantRootCustodyBindingV1,
    role: TwoPartyDeriverRole,
) -> RouterAbProtocolResult<()> {
    if role_binding.role() != role
        || role_binding.identity_digest() != custody_binding.identity_digest()
        || role_binding.custody_lineage() != custody_binding.custody_lineage()
        || role_binding.epoch() != custody_binding.epoch()
    {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 role share does not match the custody binding",
        ));
    }
    let expected_commitment = match role {
        TwoPartyDeriverRole::DeriverA => custody_binding.commitments().deriver_a(),
        TwoPartyDeriverRole::DeriverB => custody_binding.commitments().deriver_b(),
    };
    if role_binding.share_commitment() != expected_commitment {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 role share commitment does not match the custody binding",
        ));
    }
    Ok(())
}

pub(super) fn map_cloudflare_ed25519_yao_v2_threshold_error(
    error: threshold_prf::ThresholdPrfError,
) -> RouterAbProtocolError {
    invalid_lifecycle(format!("Ed25519 Yao V2 target proof failed: {error}"))
}

pub(super) fn validate_expected_root_metadata_digest(
    expected: [u8; 32],
    actual: [u8; 32],
) -> RouterAbProtocolResult<()> {
    if expected != actual {
        return Err(invalid_lifecycle(
            "root-share metadata changed after pair preparation",
        ));
    }
    Ok(())
}

pub(super) fn seal_ed25519_yao_target_proof_v2(
    env: &Env,
    recipient: Ed25519YaoDeriverRoleV1,
    aad: &[u8],
    plaintext: &[u8],
) -> RouterAbProtocolResult<([u8; 32], Vec<u8>)> {
    let public_keys = parse_cloudflare_signer_envelope_hpke_public_key_set_v1(
        &CloudflareWorkerEnvReaderV1::new(env),
    )?;
    let public_key = match recipient {
        Ed25519YaoDeriverRoleV1::DeriverA => &public_keys.deriver_a.public_key,
        Ed25519YaoDeriverRoleV1::DeriverB => &public_keys.deriver_b.public_key,
    };
    let public_key = parse_cloudflare_hpke_x25519_public_key_v1(public_key)?;
    let (encapsulated_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
        &mut CloudflareHpkeGetrandomRngV1,
        &public_key,
        ED25519_YAO_TARGET_PROOF_HPKE_INFO_V2,
        aad,
        plaintext,
    )
    .map_err(|_| invalid_lifecycle("Ed25519 Yao target proof encryption failed"))?;
    let encapsulated_key = encapsulated_key
        .as_ref()
        .try_into()
        .map_err(|_| invalid_lifecycle("Ed25519 Yao target proof key has invalid length"))?;
    Ok((encapsulated_key, ciphertext))
}

pub(super) fn open_ed25519_yao_target_proof_v2(
    env: &Env,
    private_key_binding: &str,
    encapsulated_key: &[u8; 32],
    ciphertext: &[u8],
    aad: &[u8],
) -> RouterAbProtocolResult<Zeroizing<Vec<u8>>> {
    let secret = env
        .secret(private_key_binding)
        .map_err(|_| invalid_lifecycle("Deriver target-proof HPKE secret binding is missing"))?;
    let mut encoded = secret.to_string();
    let mut private_key_bytes =
        decode_cloudflare_signer_envelope_hpke_private_key_secret_v1(&encoded)?;
    encoded.zeroize();
    let private_key = CloudflareHpkeKemV1::sk_from_bytes(&private_key_bytes)
        .map_err(|_| invalid_lifecycle("Deriver target-proof HPKE private key is invalid"))?;
    private_key_bytes.zeroize();
    let encapsulated_key = CloudflareHpkeKemV1::enc_from_bytes(encapsulated_key)
        .map_err(|_| invalid_lifecycle("Ed25519 Yao target proof key is invalid"))?;
    CloudflareHpkeSuiteV1::open_base(
        &encapsulated_key,
        &private_key,
        ED25519_YAO_TARGET_PROOF_HPKE_INFO_V2,
        aad,
        ciphertext,
    )
    .map(Zeroizing::new)
    .map_err(|_| invalid_lifecycle("Ed25519 Yao target proof decryption failed"))
}

pub(super) fn seal_deriver_a_target_proof_v2(
    env: &Env,
    binding: &Ed25519YaoOuterBindingV2,
    plaintext: &[u8],
) -> RouterAbProtocolResult<Ed25519YaoDeriverAToBTargetProofPayloadV2> {
    let aad = Ed25519YaoDeriverAToBTargetProofPayloadV2::aad_for_binding(binding)?;
    let (encapsulated_key, ciphertext) =
        seal_ed25519_yao_target_proof_v2(env, Ed25519YaoDeriverRoleV1::DeriverB, &aad, plaintext)?;
    Ed25519YaoDeriverAToBTargetProofPayloadV2::new(binding.clone(), encapsulated_key, ciphertext)
}

pub(super) fn open_deriver_a_target_proof_v2(
    env: &Env,
    private_key_binding: &str,
    payload: &Ed25519YaoDeriverBToATargetProofPayloadV2,
) -> RouterAbProtocolResult<Zeroizing<Vec<u8>>> {
    let aad = Ed25519YaoDeriverBToATargetProofPayloadV2::aad_for_binding(payload.binding())?;
    open_ed25519_yao_target_proof_v2(
        env,
        private_key_binding,
        payload.encapsulated_key(),
        payload.ciphertext(),
        &aad,
    )
}

pub(super) fn seal_deriver_b_target_proof_v2(
    env: &Env,
    binding: &Ed25519YaoOuterBindingV2,
    plaintext: &[u8],
) -> RouterAbProtocolResult<Ed25519YaoDeriverBToATargetProofPayloadV2> {
    let aad = Ed25519YaoDeriverBToATargetProofPayloadV2::aad_for_binding(binding)?;
    let (encapsulated_key, ciphertext) =
        seal_ed25519_yao_target_proof_v2(env, Ed25519YaoDeriverRoleV1::DeriverA, &aad, plaintext)?;
    Ed25519YaoDeriverBToATargetProofPayloadV2::new(binding.clone(), encapsulated_key, ciphertext)
}

pub(super) fn open_deriver_b_target_proof_v2(
    env: &Env,
    private_key_binding: &str,
    payload: &Ed25519YaoDeriverAToBTargetProofPayloadV2,
) -> RouterAbProtocolResult<Zeroizing<Vec<u8>>> {
    let aad = Ed25519YaoDeriverAToBTargetProofPayloadV2::aad_for_binding(payload.binding())?;
    open_ed25519_yao_target_proof_v2(
        env,
        private_key_binding,
        payload.encapsulated_key(),
        payload.ciphertext(),
        &aad,
    )
}
