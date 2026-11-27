//! Stable MPC-PRF evaluation, HPKE decryption and the signer private handlers.

use super::*;

/// Builds the V2 stable request from the admitted public envelope and the
/// independently authenticated tenant-root custody scope.
pub(crate) fn build_cloudflare_ecdsa_threshold_prf_outer_request_v2(
    public_request: &EcdsaThresholdPrfRequestV1,
    custody_binding: &TenantRootCustodyBindingV1,
    custody_wire: &CloudflareTenantRootCustodyBindingWireV1,
) -> RouterAbProtocolResult<EcdsaThresholdPrfOuterRequestV2> {
    public_request.validate()?;
    custody_binding
        .validate()
        .map_err(map_root_share_to_protocol)?;
    custody_wire.validate()?;
    let private_request = EcdsaThresholdPrfPrivateRequestV2::new(
        public_request.stable_tenant_derivation_context()?,
        custody_binding
            .digest()
            .map_err(map_root_share_to_protocol)?,
        EcdsaThresholdPrfPurposeV2::XClientBase,
    )?;
    EcdsaThresholdPrfOuterRequestV2::new(
        custody_wire.nonce,
        custody_wire.issued_at_ms,
        custody_wire.expires_at_ms,
        private_request,
        public_request.signer_a_envelope.clone(),
        public_request.signer_b_envelope.clone(),
    )
}

/// Evaluates the two stable tenant-root outputs for one authenticated Deriver request.
pub fn evaluate_cloudflare_authenticated_stable_mpc_prf_outputs_v2(
    host: &CloudflarePreloadedSignerHostV1,
    request: &CloudflareValidatedSignerPrivateRequestV1,
    outer_request: &EcdsaThresholdPrfOuterRequestV2,
    custody_binding: &TenantRootCustodyBindingV1,
    verified_share: VerifiedTenantRootOnlineRoleShareV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<(
    MpcPrfStablePartialProofBundleV2,
    MpcPrfStablePartialProofBundleV2,
)> {
    let (signer_role, active_pair) = validate_cloudflare_authenticated_stable_mpc_prf_request_v2(
        host,
        request,
        outer_request,
        custody_binding,
        now_unix_ms,
    )?;
    let expected_share_role = match signer_role {
        Role::SignerA => TwoPartyDeriverRole::DeriverA,
        Role::SignerB => TwoPartyDeriverRole::DeriverB,
        _ => unreachable!("cloudflare_worker_signer_role_v1 returns only signer roles"),
    };
    if verified_share.role() != expected_share_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "tenant-root active role share does not match Deriver Worker role",
        ));
    }
    MpcPrfStableThresholdSignerInputV2::evaluate_x_client_and_x_server_batch_with_threshold_backend_v2(
        outer_request.private_request().stable_context(),
        custody_binding,
        &active_pair,
        verified_share,
        now_unix_ms,
        &mut CloudflareSignerProofGetrandomRngV1,
    )
    .map_err(map_derivation_to_protocol)
}

pub(super) fn validate_cloudflare_authenticated_stable_mpc_prf_request_v2(
    host: &CloudflarePreloadedSignerHostV1,
    request: &CloudflareValidatedSignerPrivateRequestV1,
    outer_request: &EcdsaThresholdPrfOuterRequestV2,
    custody_binding: &TenantRootCustodyBindingV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<(Role, router_ab_core::TenantRootActiveRootPairV1)> {
    host.validate()?;
    request.router_payload().validate()?;
    request
        .signer_input()
        .validate()
        .map_err(map_derivation_to_protocol)?;
    custody_binding
        .validate_at(now_unix_ms)
        .map_err(map_root_share_to_protocol)?;
    outer_request.validate_for_custody(custody_binding, now_unix_ms)?;
    if outer_request.private_request().purpose() != EcdsaThresholdPrfPurposeV2::XClientBase {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "ECDSA registration V2 request must use the fixed client/server purpose pair",
        ));
    }

    let signer_role = cloudflare_worker_signer_role_v1(request.worker_role())?;
    if request.signer_input().recipient_role != signer_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "validated signer input role does not match Worker role",
        ));
    }
    let expected_envelope = match signer_role {
        Role::SignerA => outer_request.signer_a_envelope(),
        Role::SignerB => outer_request.signer_b_envelope(),
        _ => unreachable!("cloudflare_worker_signer_role_v1 returns only signer roles"),
    };
    if expected_envelope != &request.router_payload().assignment().envelope {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "ECDSA threshold-PRF V2 outer request envelope does not match Router payload",
        ));
    }
    let active_pair = cloudflare_active_tenant_root_pair_from_custody_binding_v1(custody_binding)?;
    Ok((signer_role, active_pair))
}

pub(super) fn evaluate_cloudflare_stable_mpc_prf_output_v2(
    outer_request: &EcdsaThresholdPrfOuterRequestV2,
    custody_binding: &TenantRootCustodyBindingV1,
    active_pair: &router_ab_core::TenantRootActiveRootPairV1,
    signer_role: Role,
    verified_share: VerifiedTenantRootOnlineRoleShareV1,
    purpose: EcdsaThresholdPrfPurposeV2,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<MpcPrfStablePartialProofBundleV2> {
    let expected_share_role = match signer_role {
        Role::SignerA => TwoPartyDeriverRole::DeriverA,
        Role::SignerB => TwoPartyDeriverRole::DeriverB,
        _ => unreachable!("cloudflare_worker_signer_role_v1 returns only signer roles"),
    };
    if verified_share.role() != expected_share_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "tenant-root active role share does not match Deriver Worker role",
        ));
    }
    let private_request = EcdsaThresholdPrfPrivateRequestV2::new(
        outer_request.private_request().stable_context().clone(),
        outer_request.private_request().custody_binding_digest(),
        purpose,
    )?;
    let input = MpcPrfStableThresholdSignerInputV2::from_private_request(
        &private_request,
        custody_binding,
        active_pair,
        verified_share,
        now_unix_ms,
    )
    .map_err(map_derivation_to_protocol)?;
    evaluate_mpc_prf_stable_signer_partial_with_threshold_backend_v2(
        input,
        &mut CloudflareSignerProofGetrandomRngV1,
    )
    .map_err(map_derivation_to_protocol)
}

pub(super) fn evaluate_cloudflare_authenticated_stable_mpc_prf_client_output_v2(
    host: &CloudflarePreloadedSignerHostV1,
    request: &CloudflareValidatedSignerPrivateRequestV1,
    outer_request: &EcdsaThresholdPrfOuterRequestV2,
    custody_binding: &TenantRootCustodyBindingV1,
    verified_share: VerifiedTenantRootOnlineRoleShareV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<MpcPrfStablePartialProofBundleV2> {
    let (signer_role, active_pair) = validate_cloudflare_authenticated_stable_mpc_prf_request_v2(
        host,
        request,
        outer_request,
        custody_binding,
        now_unix_ms,
    )?;
    evaluate_cloudflare_stable_mpc_prf_output_v2(
        outer_request,
        custody_binding,
        &active_pair,
        signer_role,
        verified_share,
        EcdsaThresholdPrfPurposeV2::XClientBase,
        now_unix_ms,
    )
}

pub(super) fn cloudflare_active_tenant_root_pair_from_custody_binding_v1(
    custody_binding: &TenantRootCustodyBindingV1,
) -> RouterAbProtocolResult<router_ab_core::TenantRootActiveRootPairV1> {
    let identity_digest = custody_binding.identity_digest();
    let role_binding = |role, commitment: &router_ab_core::MpcPrfShareCommitmentWireV1| {
        TenantRootActiveRoleBindingV1::new(
            TenantRootActiveRoleRowKeyV1::new(
                identity_digest,
                custody_binding.custody_lineage(),
                custody_binding.epoch(),
                role,
            ),
            commitment.clone(),
            custody_binding.activation_receipt_digest(),
        )
        .map(TenantRootActiveRoleResolutionV1::Active)
        .map_err(map_root_share_to_protocol)
    };
    let deriver_a = role_binding(
        TenantRootManagedRestoreRoleV1::DeriverA,
        custody_binding.commitments().deriver_a(),
    )?;
    let deriver_b = role_binding(
        TenantRootManagedRestoreRoleV1::DeriverB,
        custody_binding.commitments().deriver_b(),
    )?;
    resolve_authoritative_active_tenant_root_pair_binding_v1(
        identity_digest,
        custody_binding,
        &deriver_a,
        &deriver_b,
    )
    .map_err(map_root_share_to_protocol)?
    .require_active()
    .map(Clone::clone)
    .map_err(map_root_share_to_protocol)
}

/// Builds the existing opaque delivery envelope from stable tenant-root proofs.
pub(crate) fn cloudflare_recipient_proof_bundle_response_from_stable_outputs_v2(
    router_payload: &RouterToSignerPayloadV1,
    signer: SignerIdentityV1,
    client_output: &MpcPrfStablePartialProofBundleV2,
    server_output: &MpcPrfStablePartialProofBundleV2,
    encryptor: &mut impl RecipientProofBundleEncryptorV1,
) -> RouterAbProtocolResult<CloudflareSignerRecipientProofBundleResponseV1> {
    router_payload.validate()?;
    signer.validate()?;
    let client_bundle = cloudflare_stable_recipient_proof_bundle_wire_message_v2(
        router_payload,
        signer.clone(),
        Role::Client,
        &router_payload.transcript_metadata().client_id,
        &router_payload
            .transcript_metadata()
            .client_ephemeral_public_key,
        client_output,
        encryptor,
    )?;
    let server_bundle = cloudflare_stable_recipient_proof_bundle_wire_message_v2(
        router_payload,
        signer.clone(),
        Role::Server,
        &router_payload.signer_set().selected_server.server_id,
        &router_payload
            .signer_set()
            .selected_server
            .recipient_encryption_key,
        server_output,
        encryptor,
    )?;
    let response = CloudflareSignerRecipientProofBundleResponseV1::new(
        signer.role,
        client_bundle,
        server_bundle,
    )?;
    response.validate_for_router_payload(router_payload)?;
    Ok(response)
}

/// Builds the existing client-only delivery envelope from one stable tenant-root proof.
pub(crate) fn cloudflare_client_recipient_proof_bundle_response_from_stable_output_v2(
    router_payload: &RouterToSignerPayloadV1,
    signer: SignerIdentityV1,
    client_output: &MpcPrfStablePartialProofBundleV2,
    encryptor: &mut impl RecipientProofBundleEncryptorV1,
) -> RouterAbProtocolResult<CloudflareSignerClientRecipientProofBundleResponseV1> {
    router_payload.validate()?;
    signer.validate()?;
    let client_bundle = cloudflare_stable_recipient_proof_bundle_wire_message_v2(
        router_payload,
        signer.clone(),
        Role::Client,
        &router_payload.transcript_metadata().client_id,
        &router_payload
            .transcript_metadata()
            .client_ephemeral_public_key,
        client_output,
        encryptor,
    )?;
    let response =
        CloudflareSignerClientRecipientProofBundleResponseV1::new(signer.role, client_bundle)?;
    response.validate_for_router_payload(router_payload)?;
    Ok(response)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn cloudflare_stable_recipient_proof_bundle_wire_message_v2(
    router_payload: &RouterToSignerPayloadV1,
    signer: SignerIdentityV1,
    recipient_role: Role,
    recipient_identity: &str,
    recipient_encryption_key: &str,
    output: &MpcPrfStablePartialProofBundleV2,
    encryptor: &mut impl RecipientProofBundleEncryptorV1,
) -> RouterAbProtocolResult<WireMessageV1> {
    let payload = MpcPrfStableRecipientProofBundlePayloadV2::from_stable_partial(
        signer,
        recipient_role,
        recipient_identity,
        output,
    )?;
    let request = RecipientProofBundleEncryptionRequestV1::new_stable_v2(
        &payload,
        recipient_encryption_key,
        router_payload.transcript_digest(),
    )?;
    let envelope = encryptor.encrypt_recipient_proof_bundle_v1(request)?;
    WireMessageV1::new(
        WireMessageKindV1::RecipientProofBundle,
        router_payload.transcript_digest(),
        CanonicalWireBytesV1::new(envelope.canonical_bytes()?)?,
    )
}

/// Handles one authenticated registration through the stable tenant-root PRF.
pub(crate) fn handle_cloudflare_authenticated_stable_mpc_prf_signer_request_v2(
    host: &CloudflarePreloadedSignerHostV1,
    outer_request: &EcdsaThresholdPrfOuterRequestV2,
    custody_binding: &TenantRootCustodyBindingV1,
    request: &CloudflareValidatedSignerPrivateRequestV1,
    verified_share: VerifiedTenantRootOnlineRoleShareV1,
    now_unix_ms: u64,
    encryptor: &mut impl RecipientProofBundleEncryptorV1,
) -> RouterAbProtocolResult<CloudflareSignerRecipientProofBundleResponseV1> {
    let local_role = cloudflare_worker_signer_role_v1(request.worker_role())?;
    let (local_signer, _, _) = cloudflare_signer_identities_for_request_v1(request, local_role)?;
    let (client_output, server_output) =
        evaluate_cloudflare_authenticated_stable_mpc_prf_outputs_v2(
            host,
            request,
            outer_request,
            custody_binding,
            verified_share,
            now_unix_ms,
        )?;
    cloudflare_recipient_proof_bundle_response_from_stable_outputs_v2(
        request.router_payload(),
        local_signer,
        &client_output,
        &server_output,
        encryptor,
    )
}

/// Handles one authenticated client-only operation through the stable tenant-root PRF.
pub(crate) fn handle_cloudflare_authenticated_stable_mpc_prf_client_signer_request_v2(
    host: &CloudflarePreloadedSignerHostV1,
    outer_request: &EcdsaThresholdPrfOuterRequestV2,
    custody_binding: &TenantRootCustodyBindingV1,
    request: &CloudflareValidatedSignerPrivateRequestV1,
    verified_share: VerifiedTenantRootOnlineRoleShareV1,
    now_unix_ms: u64,
    encryptor: &mut impl RecipientProofBundleEncryptorV1,
) -> RouterAbProtocolResult<CloudflareSignerClientRecipientProofBundleResponseV1> {
    let local_role = cloudflare_worker_signer_role_v1(request.worker_role())?;
    let (local_signer, _, _) = cloudflare_signer_identities_for_request_v1(request, local_role)?;
    let client_output = evaluate_cloudflare_authenticated_stable_mpc_prf_client_output_v2(
        host,
        request,
        outer_request,
        custody_binding,
        verified_share,
        now_unix_ms,
    )?;
    cloudflare_client_recipient_proof_bundle_response_from_stable_output_v2(
        request.router_payload(),
        local_signer,
        &client_output,
        encryptor,
    )
}

/// Decrypts a production signer-envelope HPKE payload through the role's
/// Secret bindings.
pub(crate) fn decrypt_cloudflare_signer_envelope_hpke_payload_v1(
    secrets: &impl CloudflareSecretReaderV1,
    worker_role: CloudflareWorkerRoleV1,
    message: &WireMessageV1,
    envelope_decrypt_key: &CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1,
    aad: &RoleEnvelopeAadV1,
) -> RouterAbProtocolResult<Vec<u8>> {
    let secret_value = secrets.secret_text(&envelope_decrypt_key.binding_name)?;
    let mut private_key_bytes =
        decode_cloudflare_signer_envelope_hpke_private_key_secret_v1(&secret_value)?;
    let plaintext = open_cloudflare_signer_envelope_hpke_payload_v1(
        worker_role,
        message,
        envelope_decrypt_key,
        aad,
        &private_key_bytes,
    );
    private_key_bytes.zeroize();
    plaintext
}

/// Decrypts a production signer-envelope HPKE payload through a rotated key set.
pub(crate) fn decrypt_cloudflare_signer_envelope_hpke_payload_with_key_set_v1(
    secrets: &impl CloudflareSecretReaderV1,
    worker_role: CloudflareWorkerRoleV1,
    message: &WireMessageV1,
    envelope_decrypt_keys: &CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1,
    aad: &RoleEnvelopeAadV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<Vec<u8>> {
    let (envelope_decrypt_key, _) =
        decode_and_select_cloudflare_signer_envelope_hpke_decrypt_key_binding_v1(
            worker_role,
            message,
            envelope_decrypt_keys,
            now_unix_ms,
        )?;
    decrypt_cloudflare_signer_envelope_hpke_payload_v1(
        secrets,
        worker_role,
        message,
        envelope_decrypt_key,
        aad,
    )
}

#[cfg(feature = "workers-rs")]
pub(crate) fn load_cloudflare_server_output_hpke_private_key_bytes_v1(
    env: &worker::Env,
    binding: &CloudflareServerOutputHpkeDecryptKeyBindingV1,
) -> RouterAbProtocolResult<[u8; 32]> {
    binding.validate_visible_to(CloudflareWorkerRoleV1::SigningWorker)?;
    let secret = env.secret(&binding.binding_name).map_err(|err| {
        worker_binding_error(
            worker_binding_error_code(&err, &binding.binding_name),
            &binding.binding_name,
            "secret",
            err,
        )
    })?;
    let mut secret_value = secret.to_string();
    let key = decode_cloudflare_server_output_hpke_private_key_secret_v1(&secret_value);
    secret_value.zeroize();
    key
}

#[allow(clippy::too_many_arguments)]
pub(super) fn decrypt_cloudflare_validated_ecdsa_derivation_signer_private_request_v1(
    secrets: &impl CloudflareSecretReaderV1,
    worker_role: CloudflareWorkerRoleV1,
    message: WireMessageV1,
    envelope_decrypt_keys: &CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1,
    aad: &RoleEnvelopeAadV1,
    router_request_digest: PublicDigest32,
    root_share_metadata: &CloudflareRootShareStartupMetadataV1,
    expected_plaintext: &RouterAbEcdsaDerivationDeriverEnvelopePlaintextV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareValidatedSignerPrivateRequestV1> {
    validate_cloudflare_signer_private_request_v1(worker_role, &message)?;
    root_share_metadata.validate()?;
    expected_plaintext.validate()?;
    let plaintext_bytes = decrypt_cloudflare_signer_envelope_hpke_payload_with_key_set_v1(
        secrets,
        worker_role,
        &message,
        envelope_decrypt_keys,
        aad,
        now_unix_ms,
    )?;
    if plaintext_bytes != expected_plaintext.canonical_plaintext_bytes()? {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "Router A/B ECDSA derivation decrypted plaintext does not match the typed ceremony request",
        ));
    }
    let router_payload = decode_router_to_signer_payload_v1(message.payload.as_bytes())?;
    let signer_role = cloudflare_worker_signer_role_v1(worker_role)?;
    let assignment = router_payload.require_recipient_role(signer_role)?;
    expected_plaintext.validate_for_envelope(&assignment.envelope)?;
    let output_requests = match expected_plaintext.output_kind() {
        router_ab_core::RouterAbEcdsaDerivationOutputKindV1::ClientExport => {
            vec![MpcPrfOutputRequestV1::new(
                OpenedShareKind::XClientBase,
                Role::Client,
                expected_plaintext.common().client_id.clone(),
            )
            .map_err(map_derivation_to_protocol)?]
        }
        router_ab_core::RouterAbEcdsaDerivationOutputKindV1::SigningWorkerActivation => vec![
            MpcPrfOutputRequestV1::new(
                OpenedShareKind::XClientBase,
                Role::Client,
                expected_plaintext.common().client_id.clone(),
            )
            .map_err(map_derivation_to_protocol)?,
            MpcPrfOutputRequestV1::new(
                OpenedShareKind::XServerBase,
                Role::Server,
                router_payload
                    .signer_set()
                    .selected_server
                    .server_id
                    .clone(),
            )
            .map_err(map_derivation_to_protocol)?,
        ],
    };
    let signer_input = SignerInputPlaintextV1::new(
        router_payload.lifecycle().primitive_request_kind,
        router_payload.lifecycle().lifecycle_id.clone(),
        router_payload.signer_set().signer_set_id.clone(),
        SignerInputQuorumPolicyV1::All2,
        signer_role,
        assignment.signer.signer_id.clone(),
        assignment.signer.key_epoch.clone(),
        root_share_metadata.root_share_epoch.clone(),
        router_payload
            .signer_set()
            .selected_server
            .server_id
            .clone(),
        router_payload
            .signer_set()
            .selected_server
            .key_epoch
            .clone(),
        router_payload.transcript_digest(),
        router_request_digest,
        assignment.envelope.aad_digest,
        output_requests,
    )
    .map_err(map_derivation_to_protocol)?;
    validate_signer_input_plaintext_binding_v1(
        &router_payload,
        &signer_input,
        router_request_digest,
        &root_share_metadata.root_share_epoch,
    )?;
    CloudflareValidatedSignerPrivateRequestV1::new(
        worker_role,
        message,
        router_payload,
        signer_input,
    )
}

/// Decrypts, validates, and handles a Router A/B ECDSA derivation registration signer request.
#[allow(clippy::too_many_arguments)]
pub fn decrypt_and_handle_cloudflare_router_ab_ecdsa_derivation_registration_signer_private_request_v1(
    secrets: &impl CloudflareSecretReaderV1,
    worker_role: CloudflareWorkerRoleV1,
    host: &CloudflarePreloadedSignerHostV1,
    registration_request: RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
    tenant_root_custody_binding: TenantRootCustodyBindingV1,
    outer_request: EcdsaThresholdPrfOuterRequestV2,
    verified_share: VerifiedTenantRootOnlineRoleShareV1,
    envelope_decrypt_keys: &CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1,
    root_share_metadata: &CloudflareRootShareStartupMetadataV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSignerRecipientProofBundleResponseV1> {
    registration_request.validate()?;
    bootstrap.validate_for_worker_role(worker_role)?;
    let expected_plaintext =
        RouterAbEcdsaDerivationDeriverEnvelopePlaintextV1::registration_for_request(
            &registration_request,
            cloudflare_worker_signer_role_v1(worker_role)?,
            bootstrap.aad.digest(),
        )?;
    let validated = decrypt_cloudflare_validated_ecdsa_derivation_signer_private_request_v1(
        secrets,
        worker_role,
        bootstrap.message,
        envelope_decrypt_keys,
        &bootstrap.aad,
        bootstrap.router_request_digest,
        root_share_metadata,
        &expected_plaintext,
        now_unix_ms,
    )?;
    validate_cloudflare_router_ab_ecdsa_derivation_registration_request_for_router_payload_v1(
        &registration_request,
        validated.router_payload(),
    )?;
    let mut encryptor = CloudflareHpkeRecipientProofBundleEncryptorV1::new();
    let response = handle_cloudflare_authenticated_stable_mpc_prf_signer_request_v2(
        host,
        &outer_request,
        &tenant_root_custody_binding,
        &validated,
        verified_share,
        now_unix_ms,
        &mut encryptor,
    )?;
    validate_cloudflare_signer_recipient_proof_bundle_private_response_v1(
        worker_role,
        validated.message(),
        &response,
    )?;
    Ok(response)
}

/// Decrypts, validates, and handles a Router A/B ECDSA derivation export signer request.
#[allow(clippy::too_many_arguments)]
pub fn decrypt_and_handle_cloudflare_router_ab_ecdsa_derivation_export_signer_private_request_v1(
    secrets: &impl CloudflareSecretReaderV1,
    worker_role: CloudflareWorkerRoleV1,
    host: &CloudflarePreloadedSignerHostV1,
    export_request: RouterAbEcdsaDerivationExplicitExportRequestV1,
    bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
    custody_binding: TenantRootCustodyBindingV1,
    outer_request: EcdsaThresholdPrfOuterRequestV2,
    verified_share: VerifiedTenantRootOnlineRoleShareV1,
    envelope_decrypt_keys: &CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1,
    root_share_metadata: &CloudflareRootShareStartupMetadataV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSignerClientRecipientProofBundleResponseV1> {
    export_request.validate_at(now_unix_ms)?;
    bootstrap.validate_for_worker_role(worker_role)?;
    let expected_plaintext = RouterAbEcdsaDerivationDeriverEnvelopePlaintextV1::export_for_request(
        &export_request,
        cloudflare_worker_signer_role_v1(worker_role)?,
        bootstrap.aad.digest(),
    )?;
    let validated = decrypt_cloudflare_validated_ecdsa_derivation_signer_private_request_v1(
        secrets,
        worker_role,
        bootstrap.message,
        envelope_decrypt_keys,
        &bootstrap.aad,
        bootstrap.router_request_digest,
        root_share_metadata,
        &expected_plaintext,
        now_unix_ms,
    )?;
    validate_cloudflare_router_ab_ecdsa_derivation_export_request_for_router_payload_v1(
        &export_request,
        validated.router_payload(),
    )?;
    let mut encryptor = CloudflareHpkeRecipientProofBundleEncryptorV1::new();
    let response = handle_cloudflare_authenticated_stable_mpc_prf_client_signer_request_v2(
        host,
        &outer_request,
        &custody_binding,
        &validated,
        verified_share,
        now_unix_ms,
        &mut encryptor,
    )?;
    validate_cloudflare_signer_client_recipient_proof_bundle_private_response_v1(
        worker_role,
        validated.message(),
        &response,
    )?;
    Ok(response)
}

/// Decrypts, validates, and handles a Router A/B ECDSA derivation activation-refresh signer request.
#[cfg(feature = "workers-rs")]
pub async fn decrypt_and_handle_cloudflare_router_ab_ecdsa_derivation_activation_refresh_signer_private_request_v1(
    env: &worker::Env,
    worker_role: CloudflareWorkerRoleV1,
    host: &CloudflarePreloadedSignerHostV1,
    refresh_request: RouterAbEcdsaDerivationActivationRefreshRequestV1,
    bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
    custody_binding: TenantRootCustodyBindingV1,
    outer_request: EcdsaThresholdPrfOuterRequestV2,
    verified_share: VerifiedTenantRootOnlineRoleShareV1,
    envelope_decrypt_keys: &CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1,
    root_share_metadata: &CloudflareRootShareStartupMetadataV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<CloudflareSignerRecipientProofBundleResponseV1> {
    refresh_request.validate_at(now_unix_ms)?;
    bootstrap.validate_for_worker_role(worker_role)?;
    let expected_plaintext =
        RouterAbEcdsaDerivationDeriverEnvelopePlaintextV1::refresh_for_request(
            &refresh_request,
            cloudflare_worker_signer_role_v1(worker_role)?,
            bootstrap.aad.digest(),
        )?;
    let validated = decrypt_cloudflare_validated_ecdsa_derivation_signer_private_request_v1(
        &CloudflareWorkerEnvReaderV1::new(env),
        worker_role,
        bootstrap.message,
        envelope_decrypt_keys,
        &bootstrap.aad,
        bootstrap.router_request_digest,
        root_share_metadata,
        &expected_plaintext,
        now_unix_ms,
    )?;
    validate_cloudflare_router_ab_ecdsa_derivation_activation_refresh_request_for_router_payload_v1(
        &refresh_request,
        validated.router_payload(),
    )?;
    let mut encryptor = CloudflareHpkeRecipientProofBundleEncryptorV1::new();
    let response = handle_cloudflare_authenticated_stable_mpc_prf_signer_request_v2(
        host,
        &outer_request,
        &custody_binding,
        &validated,
        verified_share,
        now_unix_ms,
        &mut encryptor,
    )?;
    validate_cloudflare_signer_recipient_proof_bundle_private_response_v1(
        worker_role,
        validated.message(),
        &response,
    )?;
    Ok(response)
}

/// Validates a strict private signer proof-bundle response against the Router-dispatched request.
pub fn validate_cloudflare_signer_recipient_proof_bundle_private_response_v1(
    worker_role: CloudflareWorkerRoleV1,
    request: &WireMessageV1,
    response: &CloudflareSignerRecipientProofBundleResponseV1,
) -> RouterAbProtocolResult<()> {
    validate_cloudflare_signer_private_request_v1(worker_role, request)?;
    let router_payload = decode_router_to_signer_payload_v1(request.payload.as_bytes())?;
    let expected_role = cloudflare_worker_signer_role_v1(worker_role)?;
    if response.signer_role != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidSignerIdentity,
            "strict private signer proof-bundle response signer role does not match Worker role",
        ));
    }
    response.validate_for_router_payload(&router_payload)
}

/// Validates a strict private signer client-output response against the dispatched request.
pub fn validate_cloudflare_signer_client_recipient_proof_bundle_private_response_v1(
    worker_role: CloudflareWorkerRoleV1,
    request: &WireMessageV1,
    response: &CloudflareSignerClientRecipientProofBundleResponseV1,
) -> RouterAbProtocolResult<()> {
    validate_cloudflare_signer_private_request_v1(worker_role, request)?;
    let router_payload = decode_router_to_signer_payload_v1(request.payload.as_bytes())?;
    let expected_role = cloudflare_worker_signer_role_v1(worker_role)?;
    if response.signer_role != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidSignerIdentity,
            "strict private signer client response signer role does not match Worker role",
        ));
    }
    response.validate_for_router_payload(&router_payload)
}
