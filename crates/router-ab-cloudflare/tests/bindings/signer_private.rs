//! Signer private request, bootstrap and ECDSA Deriver private-request tests.

use super::*;

#[test]
fn signer_private_request_accepts_role_specific_router_message() {
    let message = signer_private_request(WireMessageKindV1::RouterToSignerA);

    validate_cloudflare_signer_private_request_v1(CloudflareWorkerRoleV1::DeriverA, &message)
        .expect("signer a request should validate");
}

#[test]
fn signer_private_request_rejects_wrong_role_message() {
    let message = signer_private_request(WireMessageKindV1::RouterToSignerB);
    let err =
        validate_cloudflare_signer_private_request_v1(CloudflareWorkerRoleV1::DeriverA, &message)
            .expect_err("signer a must reject signer b request branch");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidLocalRoute);
}

#[test]
fn signer_private_request_rejects_malformed_router_payload() {
    let message = WireMessageV1::new(
        WireMessageKindV1::RouterToSignerA,
        digest(0x33),
        CanonicalWireBytesV1::new(vec![0x31, 0x32]).expect("malformed payload bytes"),
    )
    .expect("malformed private request");
    let err =
        validate_cloudflare_signer_private_request_v1(CloudflareWorkerRoleV1::DeriverA, &message)
            .expect_err("malformed Router-to-signer payload must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MalformedWirePayload);
}

#[test]
fn signer_private_request_rejects_payload_transcript_mismatch() {
    let mut message = signer_private_request(WireMessageKindV1::RouterToSignerA);
    message.transcript_digest = digest(0x77);
    let err =
        validate_cloudflare_signer_private_request_v1(CloudflareWorkerRoleV1::DeriverA, &message)
            .expect_err("wire transcript must match decoded payload transcript");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn signer_private_bootstrap_accepts_typed_role_envelope_aad() {
    let request = ecdsa_threshold_prf_request_with_aad_bound_envelopes(2_000);
    let message =
        signer_private_request_with_aad_bound_envelope(WireMessageKindV1::RouterToSignerA);
    let aad = role_envelope_aad_for_request(Role::SignerA, &request);
    let bootstrap = CloudflareSignerPrivateBootstrapRequestV1::new(
        CloudflareWorkerRoleV1::DeriverA,
        message.clone(),
        aad.clone(),
        request_context_digest(&request),
    )
    .expect("strict signer bootstrap");

    assert_eq!(bootstrap.message, message);
    assert_eq!(bootstrap.aad, aad);
}

#[test]
fn signer_private_bootstrap_reconstructs_from_public_request() {
    let request = ecdsa_threshold_prf_request_with_aad_bound_envelopes(2_000);
    let message = request
        .to_signer_wire_messages()
        .expect("signer wire messages")
        .0;
    let bootstrap = cloudflare_signer_private_bootstrap_from_public_request_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &request,
        message.clone(),
    )
    .expect("strict signer bootstrap from public request");

    assert_eq!(bootstrap.message, message);
    assert_eq!(
        bootstrap.router_request_digest,
        request_context_digest(&request)
    );
    assert_eq!(
        bootstrap.aad,
        role_envelope_aad_for_request(Role::SignerA, &request)
    );
}

pub(super) fn tenant_root_registration_transport_fixture() -> CloudflareTenantRootCustodyBindingWireV1 {
    CloudflareTenantRootCustodyBindingWireV1 {
        activation_receipt_b64u: "AQ".to_owned(),
        operation_id: TenantRootDerivationOperationIdV1::from_bytes([0x31; 16])
            .expect("tenant-root operation id"),
        session_id: TenantRootDerivationSessionIdV1::from_bytes([0x32; 16])
            .expect("tenant-root session id"),
        nonce: TenantRootDerivationNonceV1::from_bytes([0x33; 32]).expect("tenant-root nonce"),
        issued_at_ms: 1,
        expires_at_ms: 2_000,
    }
}

#[test]
fn router_ab_ecdsa_derivation_deriver_registration_private_request_accepts_matching_payload() {
    let registration_request =
        router_ab_ecdsa_derivation_registration_request_with_aad_bound_envelopes_for(
            RouterAbEcdsaDerivationRegistrationPurposeV1::WalletAddSigner,
        );
    let public_request = registration_request
        .to_threshold_prf_request()
        .expect("Router A/B ECDSA derivation registration public request");
    let (deriver_a_message, _) = public_request
        .to_signer_wire_messages()
        .expect("Router A/B ECDSA derivation registration signer messages");
    let bootstrap = cloudflare_signer_private_bootstrap_from_ecdsa_derivation_registration_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &registration_request,
        deriver_a_message.clone(),
    )
    .expect("Router A/B ECDSA derivation registration bootstrap");
    let router_payload = decode_router_to_signer_payload_v1(deriver_a_message.payload.as_bytes())
        .expect("Router A/B ECDSA derivation registration Router payload");

    validate_cloudflare_router_ab_ecdsa_derivation_registration_request_for_router_payload_v1(
        &registration_request,
        &router_payload,
    )
    .expect("Router A/B ECDSA derivation registration payload binding");
    let private_request =
        CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1::new(
            CloudflareWorkerRoleV1::DeriverA,
            registration_request,
            bootstrap,
            tenant_root_registration_transport_fixture(),
        )
        .expect("Router A/B ECDSA derivation registration private request");

    private_request
        .validate_for_worker_role(CloudflareWorkerRoleV1::DeriverA)
        .expect("Router A/B ECDSA derivation registration private request validates");
}

#[test]
fn router_ab_ecdsa_derivation_deriver_registration_private_request_rejects_payload_drift() {
    let mut registration_request =
        router_ab_ecdsa_derivation_registration_request_with_aad_bound_envelopes_for(
            RouterAbEcdsaDerivationRegistrationPurposeV1::WalletAddSigner,
        );
    let public_request = registration_request
        .to_threshold_prf_request()
        .expect("Router A/B ECDSA derivation registration public request");
    let (deriver_a_message, _) = public_request
        .to_signer_wire_messages()
        .expect("Router A/B ECDSA derivation registration signer messages");
    let bootstrap = cloudflare_signer_private_bootstrap_from_ecdsa_derivation_registration_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &registration_request,
        deriver_a_message,
    )
    .expect("Router A/B ECDSA derivation registration bootstrap");
    registration_request.replay_nonce = "ecdsa-registration-replay-drift".to_owned();

    let err = CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1::new(
        CloudflareWorkerRoleV1::DeriverA,
        registration_request,
        bootstrap,
        tenant_root_registration_transport_fixture(),
    )
    .expect_err("payload drift must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MalformedWirePayload);
}

#[test]
fn router_ab_ecdsa_derivation_deriver_export_private_request_accepts_matching_payload() {
    let export_request = router_ab_ecdsa_derivation_export_request_with_aad_bound_envelopes();
    let public_request = export_request
        .to_threshold_prf_request()
        .expect("Router A/B ECDSA derivation export public request");
    let (deriver_a_message, _) = public_request
        .to_signer_wire_messages()
        .expect("Router A/B ECDSA derivation export signer messages");
    let bootstrap = cloudflare_signer_private_bootstrap_from_public_request_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &public_request,
        deriver_a_message.clone(),
    )
    .expect("Router A/B ECDSA derivation export bootstrap");
    let router_payload = decode_router_to_signer_payload_v1(deriver_a_message.payload.as_bytes())
        .expect("Router A/B ECDSA derivation export Router payload");

    validate_cloudflare_router_ab_ecdsa_derivation_export_request_for_router_payload_v1(
        &export_request,
        &router_payload,
    )
    .expect("Router A/B ECDSA derivation export payload binding");
    let private_request = CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1::new(
        CloudflareWorkerRoleV1::DeriverA,
        export_request,
        bootstrap,
        tenant_root_registration_transport_fixture(),
    )
    .expect("Router A/B ECDSA derivation export private request");

    private_request
        .validate_for_worker_role(CloudflareWorkerRoleV1::DeriverA)
        .expect("Router A/B ECDSA derivation export private request validates");
}

#[test]
fn router_ab_ecdsa_derivation_deriver_export_private_request_rejects_payload_drift() {
    let mut export_request = router_ab_ecdsa_derivation_export_request_with_aad_bound_envelopes();
    let public_request = export_request
        .to_threshold_prf_request()
        .expect("Router A/B ECDSA derivation export public request");
    let (deriver_a_message, _) = public_request
        .to_signer_wire_messages()
        .expect("Router A/B ECDSA derivation export signer messages");
    let bootstrap = cloudflare_signer_private_bootstrap_from_public_request_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &public_request,
        deriver_a_message,
    )
    .expect("Router A/B ECDSA derivation export bootstrap");
    export_request.export_nonce = "ecdsa-export-nonce-drift".to_owned();

    let err = CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1::new(
        CloudflareWorkerRoleV1::DeriverA,
        export_request,
        bootstrap,
        tenant_root_registration_transport_fixture(),
    )
    .expect_err("payload drift must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MalformedWirePayload);
}

#[test]
fn router_ab_ecdsa_derivation_deriver_activation_refresh_private_request_accepts_matching_payload()
{
    let refresh_request =
        router_ab_ecdsa_derivation_activation_refresh_request_with_aad_bound_envelopes();
    let public_request = refresh_request
        .to_threshold_prf_request()
        .expect("Router A/B ECDSA derivation refresh public request");
    let (deriver_a_message, _) = public_request
        .to_signer_wire_messages()
        .expect("Router A/B ECDSA derivation refresh signer messages");
    let bootstrap = cloudflare_signer_private_bootstrap_from_public_request_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &public_request,
        deriver_a_message.clone(),
    )
    .expect("Router A/B ECDSA derivation refresh bootstrap");
    let router_payload = decode_router_to_signer_payload_v1(deriver_a_message.payload.as_bytes())
        .expect("Router A/B ECDSA derivation refresh Router payload");

    validate_cloudflare_router_ab_ecdsa_derivation_activation_refresh_request_for_router_payload_v1(
        &refresh_request,
        &router_payload,
    )
    .expect("Router A/B ECDSA derivation refresh payload binding");
    let private_request =
        CloudflareRouterAbEcdsaDerivationDeriverActivationRefreshPrivateRequestV1::new(
            CloudflareWorkerRoleV1::DeriverA,
            refresh_request,
            bootstrap,
            tenant_root_registration_transport_fixture(),
        )
        .expect("Router A/B ECDSA derivation refresh private request");

    private_request
        .validate_for_worker_role(CloudflareWorkerRoleV1::DeriverA)
        .expect("Router A/B ECDSA derivation refresh private request validates");
}

#[test]
fn router_ab_ecdsa_derivation_deriver_activation_refresh_private_request_rejects_payload_drift() {
    let mut refresh_request =
        router_ab_ecdsa_derivation_activation_refresh_request_with_aad_bound_envelopes();
    let public_request = refresh_request
        .to_threshold_prf_request()
        .expect("Router A/B ECDSA derivation refresh public request");
    let (deriver_a_message, _) = public_request
        .to_signer_wire_messages()
        .expect("Router A/B ECDSA derivation refresh signer messages");
    let bootstrap = cloudflare_signer_private_bootstrap_from_public_request_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &public_request,
        deriver_a_message,
    )
    .expect("Router A/B ECDSA derivation refresh bootstrap");
    refresh_request.refresh_nonce = "ecdsa-refresh-nonce-drift".to_owned();

    let err = CloudflareRouterAbEcdsaDerivationDeriverActivationRefreshPrivateRequestV1::new(
        CloudflareWorkerRoleV1::DeriverA,
        refresh_request,
        bootstrap,
        tenant_root_registration_transport_fixture(),
    )
    .expect_err("payload drift must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MalformedWirePayload);
}

#[test]
fn client_recipient_proof_bundle_response_rejects_server_bundle() {
    let request = ecdsa_threshold_prf_request_with_reconstructed_transcript(2_000);
    let (deriver_a_message, _) = request
        .to_signer_wire_messages()
        .expect("signer wire messages");
    let router_payload = decode_router_to_signer_payload_v1(deriver_a_message.payload.as_bytes())
        .expect("router payload");
    let server_bundle = server_proof_bundle_wire(&router_payload, Role::SignerA, 0xa3);
    let err =
        CloudflareSignerClientRecipientProofBundleResponseV1::new(Role::SignerA, server_bundle)
            .expect_err("client-only response must reject server bundles");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn router_ab_ecdsa_derivation_lifecycles_enforce_exact_client_and_signing_worker_recipients() {
    let registration = router_ab_ecdsa_derivation_registration_request_with_aad_bound_envelopes()
        .to_threshold_prf_request()
        .expect("registration threshold-PRF request");
    let export = router_ab_ecdsa_derivation_export_request_with_aad_bound_envelopes()
        .to_threshold_prf_request()
        .expect("export threshold-PRF request");
    let refresh = router_ab_ecdsa_derivation_activation_refresh_request_with_aad_bound_envelopes()
        .to_threshold_prf_request()
        .expect("refresh threshold-PRF request");
    let cases = [
        ("registration", first_router_payload(&registration), true),
        ("export", first_router_payload(&export), false),
        ("refresh", first_router_payload(&refresh), true),
    ];

    for (operation, router_payload, expects_signing_worker_recipient) in cases {
        assert_exact_lifecycle_recipient_bindings(
            operation,
            &router_payload,
            expects_signing_worker_recipient,
        );
    }
}

pub(super) fn first_router_payload(request: &EcdsaThresholdPrfRequestV1) -> RouterToSignerPayloadV1 {
    let (deriver_a_message, _) = request
        .to_signer_wire_messages()
        .expect("threshold-PRF signer messages");
    decode_router_to_signer_payload_v1(deriver_a_message.payload.as_bytes())
        .expect("Router payload")
}

pub(super) fn assert_exact_lifecycle_recipient_bindings(
    operation: &str,
    router_payload: &RouterToSignerPayloadV1,
    expects_signing_worker_recipient: bool,
) {
    let client_a = client_proof_bundle_wire(router_payload, Role::SignerA, 0x81);
    let client_b = client_proof_bundle_wire(router_payload, Role::SignerB, 0x82);
    let response_a =
        CloudflareSignerClientRecipientProofBundleResponseV1::new(Role::SignerA, client_a.clone())
            .expect("Deriver A client response");
    let response_b =
        CloudflareSignerClientRecipientProofBundleResponseV1::new(Role::SignerB, client_b.clone())
            .expect("Deriver B client response");
    response_a
        .validate_for_router_payload(router_payload)
        .expect("Deriver A client binding");
    response_b
        .validate_for_router_payload(router_payload)
        .expect("Deriver B client binding");
    let client_envelope = decode_recipient_proof_bundle_ciphertext_v1(client_a.payload.as_bytes())
        .expect("client envelope");
    assert_eq!(client_envelope.recipient_role, Role::Client, "{operation}");
    assert_eq!(
        client_envelope.opened_share_kind,
        OpenedShareKind::XClientBase,
        "{operation}",
    );
    assert_eq!(
        client_envelope.recipient_identity,
        router_payload.transcript_metadata().client_id,
        "{operation}",
    );
    assert_eq!(
        client_envelope.recipient_encryption_key,
        router_payload
            .transcript_metadata()
            .client_ephemeral_public_key,
        "{operation}",
    );
    assert_eq!(
        client_envelope.transcript_digest,
        router_payload.transcript_digest(),
        "{operation}",
    );

    let substituted_client = recipient_bundle_with_identity(&client_a, "substituted-client");
    let substituted_response = CloudflareSignerClientRecipientProofBundleResponseV1::new(
        Role::SignerA,
        substituted_client,
    )
    .expect("substituted client response remains structurally valid");
    assert!(
        substituted_response
            .validate_for_router_payload(router_payload)
            .is_err(),
        "{operation} must reject client recipient substitution",
    );

    if expects_signing_worker_recipient {
        let server_a = server_proof_bundle_wire(router_payload, Role::SignerA, 0x83);
        let server_b = server_proof_bundle_wire(router_payload, Role::SignerB, 0x84);
        let activation = CloudflareSigningWorkerRecipientProofBundleActivationV1::new(
            server_a.clone(),
            server_b,
        )
        .expect("SigningWorker activation");
        activation
            .validate_for_router_payload(router_payload)
            .expect("SigningWorker binding");
        let server_envelope =
            decode_recipient_proof_bundle_ciphertext_v1(server_a.payload.as_bytes())
                .expect("SigningWorker envelope");
        assert_eq!(server_envelope.recipient_role, Role::Server, "{operation}");
        assert_eq!(
            server_envelope.opened_share_kind,
            OpenedShareKind::XServerBase,
            "{operation}",
        );
        assert_eq!(
            server_envelope.recipient_identity,
            router_payload.signer_set().selected_server.server_id,
            "{operation}",
        );
        assert_eq!(
            server_envelope.recipient_encryption_key,
            router_payload
                .signer_set()
                .selected_server
                .recipient_encryption_key,
            "{operation}",
        );
        assert_eq!(
            server_envelope.transcript_digest,
            router_payload.transcript_digest(),
            "{operation}",
        );
        let substituted_server =
            recipient_bundle_with_identity(&server_a, "substituted-signing-worker");
        let substituted_activation = CloudflareSigningWorkerRecipientProofBundleActivationV1::new(
            substituted_server,
            activation.deriver_b_server_bundle,
        )
        .expect("substituted SigningWorker activation remains structurally valid");
        assert!(
            substituted_activation
                .validate_for_router_payload(router_payload)
                .is_err(),
            "{operation} must reject SigningWorker recipient substitution",
        );
    }
}

pub(super) fn recipient_bundle_with_identity(
    message: &WireMessageV1,
    recipient_identity: &str,
) -> WireMessageV1 {
    let envelope = decode_recipient_proof_bundle_ciphertext_v1(message.payload.as_bytes())
        .expect("recipient envelope");
    let nonce = *envelope.nonce();
    let ciphertext_and_tag = envelope.ciphertext_and_tag().as_bytes().to_vec();
    let changed = RecipientProofBundleCiphertextV1::new(
        envelope.algorithm,
        envelope.signer,
        envelope.recipient_role,
        envelope.opened_share_kind,
        recipient_identity,
        envelope.recipient_encryption_key,
        envelope.transcript_digest,
        envelope.payload_digest,
        nonce,
        EncryptedPayloadV1::new(ciphertext_and_tag).expect("recipient ciphertext clone"),
    )
    .expect("changed recipient envelope");
    WireMessageV1::new(
        WireMessageKindV1::RecipientProofBundle,
        changed.transcript_digest,
        CanonicalWireBytesV1::new(
            encode_recipient_proof_bundle_ciphertext_v1(&changed)
                .expect("changed recipient envelope bytes"),
        )
        .expect("changed recipient envelope wire"),
    )
    .expect("changed recipient message")
}

#[test]
fn signer_private_bootstrap_rejects_wrong_aad_digest() {
    let request = ecdsa_threshold_prf_request_with_aad_bound_envelopes(2_000);
    let message =
        signer_private_request_with_aad_bound_envelope(WireMessageKindV1::RouterToSignerA);
    let mut aad = role_envelope_aad_for_request(Role::SignerA, &request);
    aad.router_request_digest = digest(0x99);
    let err = CloudflareSignerPrivateBootstrapRequestV1::new(
        CloudflareWorkerRoleV1::DeriverA,
        message,
        aad,
        request_context_digest(&request),
    )
    .expect_err("bootstrap AAD digest mismatch must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MalformedWirePayload);
}

#[test]
fn signer_private_bootstrap_rejects_body_request_digest_mismatch() {
    let request = ecdsa_threshold_prf_request_with_aad_bound_envelopes(2_000);
    let message =
        signer_private_request_with_aad_bound_envelope(WireMessageKindV1::RouterToSignerA);
    let aad = role_envelope_aad_for_request(Role::SignerA, &request);
    let err = CloudflareSignerPrivateBootstrapRequestV1::new(
        CloudflareWorkerRoleV1::DeriverA,
        message,
        aad,
        digest(0x99),
    )
    .expect_err("bootstrap body Router request digest mismatch must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MalformedWirePayload);
}

#[test]
fn signer_private_bootstrap_derives_preload_plan() {
    let request = ecdsa_threshold_prf_request_with_aad_bound_envelopes(2_000);
    let message =
        signer_private_request_with_aad_bound_envelope(WireMessageKindV1::RouterToSignerA);
    let aad = role_envelope_aad_for_request(Role::SignerA, &request);
    let bootstrap = CloudflareSignerPrivateBootstrapRequestV1::new(
        CloudflareWorkerRoleV1::DeriverA,
        message.clone(),
        aad,
        request_context_digest(&request),
    )
    .expect("strict signer bootstrap");
    let plan = CloudflareSignerHostPreloadPlanV1::from_private_bootstrap(
        CloudflareWorkerRoleV1::DeriverA,
        &bootstrap,
    )
    .expect("preload plan");

    assert_eq!(plan.worker_role, CloudflareWorkerRoleV1::DeriverA);
    assert_eq!(plan.signer_set_id, "signer-set-v1");
    assert_eq!(plan.root_share_epoch, root_epoch());
    assert_eq!(plan.local_signer, signer_identity(Role::SignerA));
    assert_eq!(plan.signer_set, signer_set());
    assert_eq!(plan.transcript_digest, message.transcript_digest);
    assert_eq!(plan.router_request_digest, request_context_digest(&request));
}

#[test]
fn signer_private_preload_plan_builds_host_preload_input() {
    let request = ecdsa_threshold_prf_request_with_aad_bound_envelopes(2_000);
    let message =
        signer_private_request_with_aad_bound_envelope(WireMessageKindV1::RouterToSignerA);
    let aad = role_envelope_aad_for_request(Role::SignerA, &request);
    let bootstrap = CloudflareSignerPrivateBootstrapRequestV1::new(
        CloudflareWorkerRoleV1::DeriverA,
        message,
        aad,
        request_context_digest(&request),
    )
    .expect("strict signer bootstrap");
    let plan = CloudflareSignerHostPreloadPlanV1::from_private_bootstrap(
        CloudflareWorkerRoleV1::DeriverA,
        &bootstrap,
    )
    .expect("preload plan");
    let input = plan.to_host_preload_input(0).expect("host preload input");

    assert_eq!(input.signer_set_id, "signer-set-v1");
    assert_eq!(input.root_share_epoch, root_epoch());
    assert_eq!(input.random_bytes_len, 0);
}

#[test]
fn signer_private_preload_plan_rejects_wrong_worker_role() {
    let request = ecdsa_threshold_prf_request_with_aad_bound_envelopes(2_000);
    let message =
        signer_private_request_with_aad_bound_envelope(WireMessageKindV1::RouterToSignerA);
    let aad = role_envelope_aad_for_request(Role::SignerA, &request);
    let bootstrap = CloudflareSignerPrivateBootstrapRequestV1::new(
        CloudflareWorkerRoleV1::DeriverA,
        message,
        aad,
        request_context_digest(&request),
    )
    .expect("strict signer bootstrap");
    let err = CloudflareSignerHostPreloadPlanV1::from_private_bootstrap(
        CloudflareWorkerRoleV1::DeriverB,
        &bootstrap,
    )
    .expect_err("wrong Worker role must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidLocalRoute);
}
