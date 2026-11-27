//! ECDSA derivation, presign, pool and Worker environment fixtures for the binding tests.

use super::*;

pub(super) fn role_envelope(role: Role, seed: u8) -> RoleEncryptedEnvelopeV1 {
    RoleEncryptedEnvelopeV1::new(
        role,
        digest(seed),
        digest(seed + 1),
        EncryptedPayloadV1::new(vec![seed, seed + 1]).expect("ciphertext"),
    )
    .expect("role envelope")
}

pub(super) fn ecdsa_derivation_client_share_public_key33() -> [u8; 33] {
    [
        0x02, 0x79, 0xbe, 0x66, 0x7e, 0xf9, 0xdc, 0xbb, 0xac, 0x55, 0xa0, 0x62, 0x95, 0xce, 0x87,
        0x0b, 0x07, 0x02, 0x9b, 0xfc, 0xdb, 0x2d, 0xce, 0x28, 0xd9, 0x59, 0xf2, 0x81, 0x5b, 0x16,
        0xf8, 0x17, 0x98,
    ]
}

pub(super) fn router_ab_ecdsa_derivation_context() -> RouterAbEcdsaDerivationStableKeyContextV1 {
    RouterAbEcdsaDerivationStableKeyContextV1::new(ecdsa_application_binding_digest_b64u())
        .expect("Router A/B ECDSA derivation context")
}

pub(super) fn router_ab_ecdsa_derivation_material_activation_for_epoch(
    epoch: &str,
) -> MpcMaterialActivationRefV1 {
    let context = router_ab_ecdsa_derivation_context();
    MpcMaterialActivationRefV1::new(
        format!("ecdsa-activation-{epoch}"),
        "ecdsa-signing-capability-1",
        ROUTER_AB_ECDSA_DERIVATION_WALLET_ID,
        b64u(
            context
                .context_binding_digest()
                .expect("context binding")
                .as_bytes(),
        ),
        "ecdsa-material-lifecycle-1",
        signer_set().selected_server.server_id.clone(),
    )
    .expect("ECDSA material activation")
}

pub(super) fn router_ab_ecdsa_derivation_lifecycle_scope_for(
    lifecycle_id: &str,
    work_kind: ExpensiveWorkKindV1,
    epoch: RootShareEpoch,
) -> LifecycleScopeV1 {
    let session_id = format!("ecdsa-session-{}", epoch.as_str());
    LifecycleScopeV1::new(
        lifecycle_id,
        work_kind,
        epoch,
        ROUTER_AB_ECDSA_DERIVATION_WALLET_ID,
        session_id,
        "signer-set-v1",
        "server-a",
    )
    .expect("Router A/B ECDSA derivation lifecycle scope")
}

pub(super) fn router_ab_ecdsa_derivation_lifecycle_scope() -> LifecycleScopeV1 {
    router_ab_ecdsa_derivation_lifecycle_scope_for(
        "ecdsa-lifecycle-1",
        ExpensiveWorkKindV1::RegistrationPrepare,
        root_epoch(),
    )
}

pub(super) fn router_ab_ecdsa_derivation_registration_request(
) -> RouterAbEcdsaDerivationRegistrationBootstrapRequestV1 {
    router_ab_ecdsa_derivation_registration_request_for(
        RouterAbEcdsaDerivationRegistrationPurposeV1::WalletRegistration,
    )
}

pub(super) fn router_ab_ecdsa_derivation_registration_request_for(
    purpose: RouterAbEcdsaDerivationRegistrationPurposeV1,
) -> RouterAbEcdsaDerivationRegistrationBootstrapRequestV1 {
    RouterAbEcdsaDerivationRegistrationBootstrapRequestV1::new(
        purpose,
        router_ab_ecdsa_derivation_context(),
        router_ab_ecdsa_derivation_lifecycle_scope(),
        signer_set(),
        "router-1",
        "client-1",
        "x25519:client-ephemeral-public-key",
        "ecdsa-replay-1",
        2_000,
        role_envelope(Role::SignerA, 0xa3),
        role_envelope(Role::SignerB, 0xb3),
    )
    .expect("Router A/B ECDSA derivation registration request")
}

pub(super) fn router_ab_ecdsa_derivation_registration_request_with_aad_bound_envelopes(
) -> RouterAbEcdsaDerivationRegistrationBootstrapRequestV1 {
    router_ab_ecdsa_derivation_registration_request_with_aad_bound_envelopes_for(
        RouterAbEcdsaDerivationRegistrationPurposeV1::WalletRegistration,
    )
}

pub(super) fn router_ab_ecdsa_derivation_registration_request_with_aad_bound_envelopes_for(
    purpose: RouterAbEcdsaDerivationRegistrationPurposeV1,
) -> RouterAbEcdsaDerivationRegistrationBootstrapRequestV1 {
    let base = router_ab_ecdsa_derivation_registration_request_for(purpose);
    let header = base.header();
    let header_digest = base
        .request_header_digest()
        .expect("Router A/B ECDSA derivation registration header digest");
    let aad_a = header
        .role_aad(Role::SignerA)
        .expect("Router A/B ECDSA derivation registration Deriver A AAD");
    let aad_b = header
        .role_aad(Role::SignerB)
        .expect("Router A/B ECDSA derivation registration Deriver B AAD");
    let request = RouterAbEcdsaDerivationRegistrationBootstrapRequestV1 {
        deriver_a_envelope: RoleEncryptedEnvelopeV1::new(
            Role::SignerA,
            header_digest,
            aad_a.digest(),
            EncryptedPayloadV1::new(vec![0xa3, 0xa4])
                .expect("ECDSA registration signer a ciphertext"),
        )
        .expect("ECDSA registration signer a aad-bound envelope"),
        deriver_b_envelope: RoleEncryptedEnvelopeV1::new(
            Role::SignerB,
            header_digest,
            aad_b.digest(),
            EncryptedPayloadV1::new(vec![0xb3, 0xb4])
                .expect("ECDSA registration signer b ciphertext"),
        )
        .expect("ECDSA registration signer b aad-bound envelope"),
        ..base
    };
    request
        .validate()
        .expect("AAD-bound Router A/B ECDSA derivation registration request");
    request
}

pub(super) fn router_ab_ecdsa_derivation_export_lifecycle_scope() -> LifecycleScopeV1 {
    router_ab_ecdsa_derivation_lifecycle_scope_for(
        "ecdsa-export-lifecycle-1",
        ExpensiveWorkKindV1::KeyExport,
        root_epoch(),
    )
}

pub(super) fn router_ab_ecdsa_derivation_public_identity() -> RouterAbEcdsaDerivationPublicIdentityV1 {
    let activation = router_ab_ecdsa_derivation_activation_request();
    let material = router_ab_ecdsa_derivation_server_material_record(&activation);
    cloudflare_router_ab_ecdsa_derivation_public_identity_from_activation_material_v1(
        &activation.pending.registration,
        &activation.client_activation,
        &material,
    )
    .expect("Router A/B ECDSA derivation public identity")
}

pub(super) fn router_ab_ecdsa_derivation_export_request_with_aad_bound_envelopes(
) -> RouterAbEcdsaDerivationExplicitExportRequestV1 {
    let registration = router_ab_ecdsa_derivation_registration_request();
    let base = RouterAbEcdsaDerivationExplicitExportRequestV1 {
        context: registration.context,
        lifecycle: router_ab_ecdsa_derivation_export_lifecycle_scope(),
        public_identity: router_ab_ecdsa_derivation_public_identity(),
        signer_set: signer_set(),
        router_id: "router-1".to_owned(),
        client_id: "client-1".to_owned(),
        client_ephemeral_public_key: "x25519:client-ephemeral-public-key".to_owned(),
        authorization: NormalSigningAuthorizationV1::reusable_wallet_session("session-1")
            .expect("export authorization"),
        material_activation: MpcMaterialActivationRefV1::new(
            "ecdsa-material-activation-1",
            "ecdsa-signing-capability-1",
            ROUTER_AB_ECDSA_DERIVATION_WALLET_ID,
            ROUTER_AB_ECDSA_DERIVATION_WALLET_KEY_ID,
            "ecdsa-material-lifecycle-1",
            "server-a",
        )
        .expect("ECDSA export material activation"),
        export_authorization_digest_b64u: b64u(&[0x44; 32]),
        export_nonce: "ecdsa-export-nonce-1".to_owned(),
        expires_at_ms: 2_000,
        deriver_a_export_envelope: role_envelope(Role::SignerA, 0xc3),
        deriver_b_export_envelope: role_envelope(Role::SignerB, 0xd3),
    };
    base.validate()
        .expect("base Router A/B ECDSA derivation export request");
    let public_request = base
        .to_threshold_prf_request()
        .expect("base Router A/B ECDSA derivation export public request");
    let aad_a = role_envelope_aad_for_request(Role::SignerA, &public_request);
    let aad_b = role_envelope_aad_for_request(Role::SignerB, &public_request);
    let request = RouterAbEcdsaDerivationExplicitExportRequestV1 {
        deriver_a_export_envelope: RoleEncryptedEnvelopeV1::new(
            Role::SignerA,
            digest(0xc3),
            aad_a.digest(),
            EncryptedPayloadV1::new(vec![0xc3, 0xc4]).expect("ECDSA export signer a ciphertext"),
        )
        .expect("ECDSA export signer a aad-bound envelope"),
        deriver_b_export_envelope: RoleEncryptedEnvelopeV1::new(
            Role::SignerB,
            digest(0xd3),
            aad_b.digest(),
            EncryptedPayloadV1::new(vec![0xd3, 0xd4]).expect("ECDSA export signer b ciphertext"),
        )
        .expect("ECDSA export signer b aad-bound envelope"),
        ..base
    };
    request
        .validate()
        .expect("AAD-bound Router A/B ECDSA derivation export request");
    request
}

pub(super) fn router_ab_ecdsa_derivation_refresh_lifecycle_scope() -> LifecycleScopeV1 {
    router_ab_ecdsa_derivation_lifecycle_scope_for(
        "ecdsa-refresh-lifecycle-1",
        ExpensiveWorkKindV1::ServerShareRefresh,
        next_root_epoch(),
    )
}

pub(super) fn router_ab_ecdsa_derivation_activation_refresh_request_with_aad_bound_envelopes(
) -> RouterAbEcdsaDerivationActivationRefreshRequestV1 {
    let registration = router_ab_ecdsa_derivation_registration_request();
    let base = RouterAbEcdsaDerivationActivationRefreshRequestV1 {
        context: registration.context,
        lifecycle: router_ab_ecdsa_derivation_refresh_lifecycle_scope(),
        public_identity: router_ab_ecdsa_derivation_public_identity(),
        signer_set: signer_set(),
        router_id: "router-1".to_owned(),
        client_id: "client-1".to_owned(),
        signing_worker_ephemeral_public_key: "x25519:signing-worker-refresh-ephemeral-key"
            .to_owned(),
        refresh_authorization_digest_b64u: b64u(&[0x46; 32]),
        refresh_nonce: "ecdsa-refresh-nonce-1".to_owned(),
        previous_activation_epoch: root_epoch().as_str().to_owned(),
        next_activation_epoch: next_root_epoch().as_str().to_owned(),
        material_activation: router_ab_ecdsa_derivation_material_activation_for_epoch(
            next_root_epoch().as_str(),
        ),
        expires_at_ms: 2_000,
        deriver_a_refresh_envelope: role_envelope(Role::SignerA, 0x83),
        deriver_b_refresh_envelope: role_envelope(Role::SignerB, 0x93),
    };
    base.validate()
        .expect("base Router A/B ECDSA derivation refresh request");
    let public_request = base
        .to_threshold_prf_request()
        .expect("base Router A/B ECDSA derivation refresh public request");
    let aad_a = role_envelope_aad_for_request(Role::SignerA, &public_request);
    let aad_b = role_envelope_aad_for_request(Role::SignerB, &public_request);
    let request = RouterAbEcdsaDerivationActivationRefreshRequestV1 {
        deriver_a_refresh_envelope: RoleEncryptedEnvelopeV1::new(
            Role::SignerA,
            digest(0x83),
            aad_a.digest(),
            EncryptedPayloadV1::new(vec![0x83, 0x84]).expect("ECDSA refresh signer a ciphertext"),
        )
        .expect("ECDSA refresh signer a aad-bound envelope"),
        deriver_b_refresh_envelope: RoleEncryptedEnvelopeV1::new(
            Role::SignerB,
            digest(0x93),
            aad_b.digest(),
            EncryptedPayloadV1::new(vec![0x93, 0x94]).expect("ECDSA refresh signer b ciphertext"),
        )
        .expect("ECDSA refresh signer b aad-bound envelope"),
        ..base
    };
    request
        .validate()
        .expect("AAD-bound Router A/B ECDSA derivation refresh request");
    request
}

pub(super) fn router_ab_ecdsa_activation_custody_binding_wire() -> CloudflareTenantRootCustodyBindingWireV1 {
    CloudflareTenantRootCustodyBindingWireV1 {
        activation_receipt_b64u: b64u(&[0x55; 32]),
        operation_id: TenantRootDerivationOperationIdV1::from_bytes([0x56; 16])
            .expect("custody operation id"),
        session_id: TenantRootDerivationSessionIdV1::from_bytes([0x57; 16])
            .expect("custody session id"),
        nonce: TenantRootDerivationNonceV1::from_bytes([0x58; 32]).expect("custody nonce"),
        issued_at_ms: 1,
        expires_at_ms: 2_000,
    }
}

pub(super) fn router_ab_ecdsa_derivation_activation_request(
) -> CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1 {
    router_ab_ecdsa_derivation_activation_for_registration(
        router_ab_ecdsa_derivation_registration_request(),
    )
}

pub(super) fn router_ab_ecdsa_derivation_activation_for_registration(
    registration: RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
) -> CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1 {
    let public_request = registration
        .to_threshold_prf_request()
        .expect("Router A/B ECDSA derivation public request");
    let (deriver_a, _) = public_request
        .to_signer_wire_messages()
        .expect("Router A/B ECDSA derivation router-to-signer messages");
    let router_payload =
        decode_router_to_signer_payload_v1(deriver_a.payload.as_bytes()).expect("router payload");
    let activation = CloudflareSigningWorkerRecipientProofBundleActivationV1::new(
        server_proof_bundle_wire(&router_payload, Role::SignerA, 0xa3),
        server_proof_bundle_wire(&router_payload, Role::SignerB, 0xb3),
    )
    .expect("Router A/B ECDSA derivation SigningWorker proof-bundle activation");
    let pending = CloudflareRouterAbEcdsaDerivationPendingSigningWorkerActivationV1::new(
        1,
        registration.clone(),
        router_ab_ecdsa_activation_custody_binding_wire(),
        CloudflareSigningWorkerWalletScopeV1::new(
            "org-fixture",
            "project-fixture",
            "environment-fixture",
            &registration.lifecycle.account_id,
        )
        .expect("wallet scope"),
        "test".to_owned(),
        router_payload,
        activation,
    )
    .expect("pending Router A/B ECDSA derivation SigningWorker activation");
    let client_activation = EcdsaVerifiedClientActivationFactsV1 {
        registration_request_digest_b64u: b64u(
            pending
                .registration
                .request_digest()
                .expect("registration request digest")
                .as_bytes(),
        ),
        proof_transcript_digest_b64u: b64u(
            pending.activation_context.transcript_digest().as_bytes(),
        ),
        context_binding32_b64u: b64u(
            pending
                .registration
                .context
                .context_binding_digest()
                .expect("context binding")
                .as_bytes(),
        ),
        derivation_client_share_public_key33_b64u: b64u(
            &ecdsa_derivation_client_share_public_key33(),
        ),
        client_share_retry_counter: 0,
        participant_id: 1,
    };
    let activation_correlation_id = pending.activation_context.lifecycle.lifecycle_id.clone();
    CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1::new(
        activation_correlation_id,
        pending,
        client_activation,
        router_ab_ecdsa_derivation_material_activation_for_epoch("epoch-1"),
    )
    .expect("Router A/B ECDSA derivation SigningWorker activation request")
}

#[test]
fn router_mints_stable_domain_separated_ecdsa_material_activation() {
    let existing = router_ab_ecdsa_derivation_activation_request();
    let command = CloudflareRouterAbEcdsaDerivationActivationCommandV1::new(
        existing.activation_correlation_id.clone(),
        existing.pending.clone(),
        existing.client_activation.clone(),
    )
    .expect("public ECDSA activation command");
    let first = cloudflare_router_ab_ecdsa_derivation_material_activation_ref_v1(&command)
        .expect("Router-minted ECDSA activation ref");
    let second = cloudflare_router_ab_ecdsa_derivation_material_activation_ref_v1(&command)
        .expect("idempotent Router-minted ECDSA activation ref");

    assert_eq!(first, second);
    assert_eq!(
        first.activation_id,
        "ecdsa-activation-v1-crkrm9mr28cJQj6z6haRzW0ZBSw1NH5DYdl7bKNtpJQ"
    );
    assert_eq!(
        first.capability,
        "ecdsa-capability-v1-Mm1SNWRATVrl4lCOPo5qXuNy_yho_YlWScmJC3M4DU8"
    );
    assert_ne!(first.activation_id, first.capability);
    assert!(first.activation_id.starts_with("ecdsa-activation-v1-"));
    assert!(first.capability.starts_with("ecdsa-capability-v1-"));
    assert_eq!(
        first.material_owner,
        command.pending.activation_context.lifecycle.account_id
    );
    assert_eq!(
        first.key_binding,
        command.client_activation.context_binding32_b64u
    );
    assert_eq!(
        first.lifecycle_binding,
        command.pending.activation_context.lifecycle.lifecycle_id
    );
    assert_eq!(
        first.signing_worker,
        command
            .pending
            .activation_context
            .signer_set()
            .selected_server
            .server_id
    );

    let mut public_json = serde_json::to_value(command).expect("public activation JSON");
    assert!(public_json.get("material_activation").is_none());
    public_json
        .as_object_mut()
        .expect("public activation object")
        .insert(
            "material_activation".to_string(),
            serde_json::to_value(existing.material_activation).expect("material activation JSON"),
        );
    assert!(
        serde_json::from_value::<CloudflareRouterAbEcdsaDerivationActivationCommandV1>(public_json)
            .is_err()
    );
}

pub(super) fn router_ab_ecdsa_derivation_activation_refresh_request(
) -> CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRefreshRequestV1 {
    let refresh_request =
        router_ab_ecdsa_derivation_activation_refresh_request_with_aad_bound_envelopes();
    let public_request = refresh_request
        .to_threshold_prf_request()
        .expect("Router A/B ECDSA derivation refresh public request");
    let (deriver_a, _) = public_request
        .to_signer_wire_messages()
        .expect("Router A/B ECDSA derivation refresh router-to-signer messages");
    let router_payload = decode_router_to_signer_payload_v1(deriver_a.payload.as_bytes())
        .expect("refresh router payload");
    let activation = CloudflareSigningWorkerRecipientProofBundleActivationV1::new(
        server_proof_bundle_wire(&router_payload, Role::SignerA, 0xc3),
        server_proof_bundle_wire(&router_payload, Role::SignerB, 0xd3),
    )
    .expect("Router A/B ECDSA derivation refresh proof-bundle activation");
    CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRefreshRequestV1::new(
        refresh_request,
        router_payload,
        activation,
        router_ab_ecdsa_derivation_material_activation_for_epoch("epoch-2"),
        router_ab_ecdsa_activation_custody_binding_wire(),
    )
    .expect("Router A/B ECDSA derivation SigningWorker activation-refresh request")
}

pub(super) fn router_ab_ecdsa_derivation_server_material_record(
    activation: &CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1,
) -> CloudflareServerOutputMaterialRecordV1 {
    let selected_server = &activation
        .pending
        .activation_context
        .signer_set()
        .selected_server;
    CloudflareServerOutputMaterialRecordV1::new(
        activation.pending.activation_context.transcript_digest(),
        OpenedShareKind::XServerBase,
        Role::Server,
        selected_server.server_id.clone(),
        CloudflareSecretMaterial32V1::new([0x5a; 32]),
    )
    .expect("Router A/B ECDSA derivation server output material record")
}

pub(super) fn router_ab_ecdsa_derivation_refresh_server_material_record(
    activation: &CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRefreshRequestV1,
    seed: u8,
) -> CloudflareServerOutputMaterialRecordV1 {
    let selected_server = &activation.activation_context.signer_set().selected_server;
    CloudflareServerOutputMaterialRecordV1::new(
        activation.activation_context.transcript_digest(),
        OpenedShareKind::XServerBase,
        Role::Server,
        selected_server.server_id.clone(),
        CloudflareSecretMaterial32V1::new([seed; 32]),
    )
    .expect("Router A/B ECDSA derivation refresh server output material record")
}

pub(super) fn active_signing_worker_state_for_router_ab_ecdsa_derivation() -> ActiveSigningWorkerStateV1 {
    let activation = router_ab_ecdsa_derivation_activation_request();
    cloudflare_active_signing_worker_state_from_activation_request_v1(
        &activation
            .to_recipient_proof_bundle_activation_request()
            .expect("generic Router A/B ECDSA derivation activation request"),
        activation.material_activation.clone(),
        "router-ab-ecdsa-derivation-material",
        TEST_ACTIVATED_AT_MS,
    )
    .expect("Router A/B ECDSA derivation active SigningWorker state")
}

pub(super) fn router_ab_ecdsa_derivation_digest_signing_request(
) -> RouterAbEcdsaDerivationEvmDigestSigningRequestV1 {
    let activation = router_ab_ecdsa_derivation_activation_request();
    let material = router_ab_ecdsa_derivation_server_material_record(&activation);
    let receipt = cloudflare_router_ab_ecdsa_derivation_activation_receipt_from_material_v1(
        &activation,
        &material,
        TEST_ACTIVATED_AT_MS,
    )
    .expect("Router A/B ECDSA derivation activation receipt");
    let scope =
        cloudflare_router_ab_ecdsa_derivation_normal_signing_scope_from_activation_receipt_v1(
            &receipt,
            ROUTER_AB_ECDSA_DERIVATION_WALLET_ID,
            ROUTER_AB_ECDSA_DERIVATION_THRESHOLD_KEY_ID,
            ROUTER_AB_ECDSA_DERIVATION_SIGNING_ROOT_ID,
            ROUTER_AB_ECDSA_DERIVATION_SIGNING_ROOT_VERSION,
            router_ab_ecdsa_derivation_material_activation_for_epoch(&receipt.activation_epoch),
        )
        .expect("Router A/B ECDSA derivation normal-signing scope");
    let material_activation = router_ab_ecdsa_derivation_material_activation(&scope);
    RouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
        scope,
        "router-ab-ecdsa-derivation-sign-request-1",
        "router-ab-ecdsa-operation-1",
        router_ab_ecdsa_derivation_operation_digests(),
        NormalSigningAuthorizationV1::reusable_wallet_session("ecdsa-wallet-session-1")
            .expect("ECDSA authorization"),
        material_activation,
        "server-presignature-1",
        2_000,
        b64u(&[0x77; 32]),
        b64u(&router_ab_ecdsa_rerandomization_client_commitment_v1(
            [0x66; 32],
        )),
    )
    .expect("Router A/B ECDSA derivation digest-signing request")
}

pub(super) fn router_ab_ecdsa_derivation_digest_signing_finalize_request(
) -> RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1 {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1::new(
        request.scope,
        request.request_id,
        request.operation_id,
        request.operation_digests,
        request.authorization,
        request.material_activation,
        request.expires_at_ms,
        request.signing_digest_b64u,
        request.client_presignature_id,
        b64u(&[0x88; 32]),
        b64u(&[0x66; 32]),
    )
    .expect("Router A/B ECDSA derivation digest-signing finalize request")
}

pub(super) fn router_ab_ecdsa_derivation_operation_digests() -> RouterAbEcdsaDerivationOperationDigestsV1 {
    RouterAbEcdsaDerivationOperationDigestsV1 {
        lane_digest_b64u: b64u(&[0x31; 32]),
        intent_digest_b64u: b64u(&[0x77; 32]),
        display_digest_b64u: b64u(&[0x33; 32]),
    }
}

pub(super) fn router_ab_ecdsa_derivation_material_activation(
    scope: &router_ab_core::RouterAbEcdsaDerivationNormalSigningScopeV1,
) -> MpcMaterialActivationRefV1 {
    scope.material_activation.clone()
}

pub(super) fn router_ab_ecdsa_derivation_trusted_admission(
    request: &RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
) -> CloudflareRouterNormalSigningTrustedAdmissionV1 {
    let auth = match &request.authorization {
        NormalSigningAuthorizationV1::ReusableWalletSession { wallet_session_id } => {
            CloudflareRouterAuthContextV1::owner_wallet_session(
                "subject-1",
                wallet_session_id.clone(),
            )
            .expect("Router A/B ECDSA derivation auth context")
        }
        NormalSigningAuthorizationV1::OperationStepUp => {
            CloudflareRouterAuthContextV1::owner_operation_step_up(
                "subject-1",
                "authorization-session-ecdsa-1",
            )
            .expect("Router A/B ECDSA derivation operation-step-up auth context")
        }
    };
    CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        CloudflareRouterNormalSigningTrustedMetadataV1::new(
            "org-1",
            "project-1",
            "dev",
            request.scope.wallet_id.clone(),
            auth,
            digest(0x42),
            request
                .request_digest()
                .expect("Router A/B ECDSA derivation request digest"),
        )
        .expect("Router A/B ECDSA derivation trusted metadata"),
        ExpensiveWorkGateDecisionV1::accepted("router-ab-ecdsa-derivation-gate-request-1")
            .expect("accepted Router A/B ECDSA derivation admission"),
    )
    .expect("Router A/B ECDSA derivation trusted admission")
}

pub(super) fn router_ab_ecdsa_derivation_finalize_trusted_admission(
    request: &RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
) -> CloudflareRouterNormalSigningTrustedAdmissionV1 {
    let auth = match &request.authorization {
        NormalSigningAuthorizationV1::ReusableWalletSession { wallet_session_id } => {
            CloudflareRouterAuthContextV1::owner_wallet_session(
                "subject-1",
                wallet_session_id.clone(),
            )
            .expect("Router A/B ECDSA derivation finalize auth context")
        }
        NormalSigningAuthorizationV1::OperationStepUp => {
            CloudflareRouterAuthContextV1::owner_operation_step_up(
                "subject-1",
                "authorization-session-ecdsa-1",
            )
            .expect("Router A/B ECDSA derivation finalize operation-step-up auth context")
        }
    };
    CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        CloudflareRouterNormalSigningTrustedMetadataV1::new(
            "org-1",
            "project-1",
            "dev",
            request.scope.wallet_id.clone(),
            auth,
            digest(0x42),
            request
                .request_digest()
                .expect("Router A/B ECDSA derivation finalize request digest"),
        )
        .expect("Router A/B ECDSA derivation finalize trusted metadata"),
        ExpensiveWorkGateDecisionV1::accepted("router-ab-ecdsa-derivation-finalize-gate-request-1")
            .expect("accepted Router A/B ECDSA derivation finalize admission"),
    )
    .expect("Router A/B ECDSA derivation finalize trusted admission")
}

pub(super) fn router_ab_ecdsa_derivation_wallet_session(
    request: &RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
) -> CloudflareRouterVerifiedWalletSessionV1 {
    CloudflareRouterVerifiedWalletSessionV1::new(
        "subject-1",
        request.scope.wallet_id.clone(),
        "authorization-ecdsa-1",
        "ecdsa-wallet-session-1",
        "quota-ecdsa-1",
        "threshold-session-ecdsa-1",
        "org-1",
        "project-1",
        "dev",
        "evm-family",
        request.scope.signing_worker.server_id.clone(),
        digest(0x42),
        request.expires_at_ms + 500,
    )
    .expect("Router A/B ECDSA derivation Wallet Session")
}

pub(super) fn signing_wallet_scope(wallet_id: &str) -> CloudflareSigningWorkerWalletScopeV1 {
    CloudflareSigningWorkerWalletScopeV1::new("org-1", "project-1", "dev", wallet_id)
        .expect("signing wallet scope")
}

pub(super) fn admitted_router_ab_ecdsa_derivation_digest_signing_request(
    request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
) -> CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1 {
    let trusted_admission = router_ab_ecdsa_derivation_trusted_admission(&request);
    CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
        1,
        signing_wallet_scope(&request.scope.wallet_id),
        request,
        trusted_admission,
    )
    .expect("admitted Router A/B ECDSA derivation digest-signing request")
}

pub(super) fn admitted_router_ab_ecdsa_derivation_digest_finalize_request(
    request: RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
) -> CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1 {
    let trusted_admission = router_ab_ecdsa_derivation_finalize_trusted_admission(&request);
    let effect_claim = ecdsa_effect_claim(&request);
    let effect_identity = ecdsa_effect_identity(&request);
    CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1::new(
        1,
        signing_wallet_scope(&request.scope.wallet_id),
        request,
        trusted_admission,
        effect_identity,
        effect_claim,
    )
    .expect("admitted Router A/B ECDSA derivation digest finalize request")
}

pub(super) fn ecdsa_effect_claim(
    request: &RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
) -> CloudflareSigningWorkerNormalSigningEffectClaimV1 {
    match &request.authorization {
        NormalSigningAuthorizationV1::ReusableWalletSession { wallet_session_id } => {
            CloudflareSigningWorkerNormalSigningEffectClaimV1::ReusableWalletSession {
                claim: CloudflareSigningWorkerReusableWalletSessionEffectClaimV1::new(
                    "authorization-ecdsa-1",
                    wallet_session_id.clone(),
                    request.operation_id.clone(),
                    request.operation_id.clone(),
                    request.operation_digests.intent_digest_b64u.clone(),
                )
                .expect("ECDSA reusable effect claim"),
            }
        }
        NormalSigningAuthorizationV1::OperationStepUp => {
            CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
                authorization_session_id: "authorization-session-ecdsa-1".to_owned(),
                authorized_operation_id: request.operation_id.clone(),
                operation_id: request.operation_id.clone(),
                operation_fingerprint_digest: request.operation_digests.intent_digest_b64u.clone(),
            }
        }
    }
}

pub(super) fn ecdsa_effect_identity(
    request: &RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
) -> CloudflareSigningWorkerAuthorizedOperationIdentityV1 {
    match &request.authorization {
        NormalSigningAuthorizationV1::ReusableWalletSession { wallet_session_id } => {
            CloudflareSigningWorkerAuthorizedOperationIdentityV1::ReusableWalletSession {
                authorization_id: "authorization-ecdsa-1".to_owned(),
                wallet_session_id: wallet_session_id.clone(),
                authorized_operation_id: request.operation_id.clone(),
                operation_id: request.operation_id.clone(),
                operation_fingerprint_digest: request.operation_digests.intent_digest_b64u.clone(),
            }
        }
        NormalSigningAuthorizationV1::OperationStepUp => {
            CloudflareSigningWorkerAuthorizedOperationIdentityV1::OperationStepUp {
                authorization_session_id: "authorization-session-ecdsa-1".to_owned(),
                authorized_operation_id: request.operation_id.clone(),
                operation_id: request.operation_id.clone(),
                operation_fingerprint_digest: request.operation_digests.intent_digest_b64u.clone(),
            }
        }
    }
}

pub(super) fn router_ab_ecdsa_derivation_presignature_big_r33(seed: u8) -> [u8; 33] {
    let mut bytes = [seed; 33];
    bytes[0] = 0x02;
    bytes
}

pub(super) fn ecdsa_scalar_one_be32() -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes[31] = 1;
    bytes
}

pub(super) fn split_ecdsa_presignature_97(bytes: Vec<u8>) -> ([u8; 33], [u8; 32], [u8; 32]) {
    assert_eq!(bytes.len(), 97, "presignature must be 97 bytes");
    let big_r33 = bytes[0..33]
        .try_into()
        .expect("presignature R point length");
    let k_share32 = bytes[33..65]
        .try_into()
        .expect("presignature k share length");
    let sigma_share32 = bytes[65..97]
        .try_into()
        .expect("presignature sigma share length");
    (big_r33, k_share32, sigma_share32)
}

pub(super) type EcdsaPresignaturePairFixture = ([u8; 33], [u8; 32], [u8; 32], [u8; 32], [u8; 32]);

pub(super) fn drive_ecdsa_presignature_pair(
    client_additive_share32: &[u8; 32],
    relayer_additive_share32: &[u8; 32],
    public_key33: &[u8; 33],
) -> EcdsaPresignaturePairFixture {
    let key = CompressedPointBytes::new(*public_key33);
    let context = derive_presign_pair_context(key, "cloudflare-bindings-presign-pair")
        .expect("fixed presign context");
    let client_share = AdditiveKeyShare::from_bytes(ScalarBytes::new(*client_additive_share32))
        .expect("client additive share");
    let worker_share = AdditiveKeyShare::from_bytes(ScalarBytes::new(*relayer_additive_share32))
        .expect("SigningWorker additive share");
    let mut client_rng = rand_chacha::ChaCha20Rng::from_seed([0x81; 32]);
    let mut worker_rng = rand_chacha::ChaCha20Rng::from_seed([0x82; 32]);
    let mut client = ClientPresignSession::new(context, client_share, key, &mut client_rng)
        .expect("client presign session");
    let mut worker = SigningWorkerPresignSession::new(context, worker_share, key, &mut worker_rng)
        .expect("SigningWorker presign session");

    for _ in 0..9 {
        exchange_ecdsa_presign_round(&mut client, &mut worker, &mut client_rng, &mut worker_rng);
    }
    client.start_presign().expect("client starts presign");
    worker
        .start_presign()
        .expect("SigningWorker starts presign");
    for _ in 0..2 {
        exchange_ecdsa_presign_round(&mut client, &mut worker, &mut client_rng, &mut worker_rng);
    }

    let (client_big_r33, client_k_share32, client_sigma_share32) =
        split_ecdsa_presignature_97(client.take_presignature_97().expect("client presignature"));
    let (server_big_r33, server_k_share32, server_sigma_share32) = split_ecdsa_presignature_97(
        worker
            .take_presignature_97()
            .expect("SigningWorker presignature"),
    );
    assert_eq!(client_big_r33, server_big_r33);
    (
        server_big_r33,
        server_k_share32,
        server_sigma_share32,
        client_k_share32,
        client_sigma_share32,
    )
}

pub(super) fn exchange_ecdsa_presign_round(
    client: &mut ClientPresignSession,
    worker: &mut SigningWorkerPresignSession,
    client_rng: &mut rand_chacha::ChaCha20Rng,
    worker_rng: &mut rand_chacha::ChaCha20Rng,
) {
    let client_messages = client.poll().outgoing;
    let worker_messages = worker.poll().outgoing;
    assert_eq!(client_messages.len(), 1);
    assert_eq!(worker_messages.len(), 1);
    client
        .message(&worker_messages[0], client_rng)
        .expect("client accepts SigningWorker frame");
    worker
        .message(&client_messages[0], worker_rng)
        .expect("SigningWorker accepts client frame");
}

pub(super) fn router_ab_ecdsa_derivation_presignature_record(
) -> CloudflareSigningWorkerEcdsaPresignatureRecordV1 {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    CloudflareSigningWorkerEcdsaPresignatureRecordV1::new(
        active_signing_worker_state_for_router_ab_ecdsa_derivation(),
        "server-presignature-1",
        request
            .request_digest()
            .expect("Router A/B ECDSA derivation request digest"),
        request
            .signing_digest()
            .expect("Router A/B ECDSA derivation signing digest"),
        b64u(&router_ab_ecdsa_derivation_presignature_big_r33(0x31)),
        b64u(&[0x55; 32]),
        b64u(&[0x11; 32]),
        b64u(&[0x22; 32]),
        1_000,
        2_000,
    )
    .expect("Router A/B ECDSA derivation presignature record")
}

pub(super) fn router_ab_ecdsa_derivation_presignature_pool_record(
) -> CloudflareSigningWorkerEcdsaPresignaturePoolRecordV1 {
    CloudflareSigningWorkerEcdsaPresignaturePoolRecordV1::new(
        router_ab_ecdsa_derivation_digest_signing_request().scope,
        active_signing_worker_state_for_router_ab_ecdsa_derivation(),
        "server-presignature-1",
        b64u(&router_ab_ecdsa_derivation_presignature_big_r33(0x31)),
        b64u(&[0x11; 32]),
        b64u(&[0x22; 32]),
        1_000,
        2_000,
    )
    .expect("Router A/B ECDSA derivation presignature pool record")
}

pub(super) fn router_ab_ecdsa_derivation_presignature_pool_record_with_expiry(
    expires_at_ms: u64,
) -> CloudflareSigningWorkerEcdsaPresignaturePoolRecordV1 {
    let mut record = router_ab_ecdsa_derivation_presignature_pool_record();
    record.expires_at_ms = expires_at_ms;
    record
        .validate()
        .expect("custom SigningWorker presignature expiry");
    record
}

pub(super) fn router_ab_ecdsa_derivation_presignature_pool_put_request(
    expires_at_ms: u64,
) -> CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1 {
    CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1::new(
        router_ab_ecdsa_derivation_digest_signing_request().scope,
        "server-presignature-1",
        b64u(&router_ab_ecdsa_derivation_presignature_big_r33(0x31)),
        b64u(&[0x11; 32]),
        b64u(&[0x22; 32]),
        expires_at_ms,
    )
    .expect("Router A/B ECDSA derivation presignature pool put request")
}

pub(super) fn signer_envelope_hpke_payload(
    role: Role,
    key_epoch: &str,
    public_key: &str,
    aad_digest: PublicDigest32,
) -> SignerEnvelopeHpkePayloadV1 {
    let encapped_key_seed = match role {
        Role::SignerA => 0xa2,
        Role::SignerB => 0xb2,
        _ => panic!("test helper requires signer role"),
    };
    SignerEnvelopeHpkePayloadV1::new(
        role,
        key_epoch,
        public_key,
        aad_digest,
        [encapped_key_seed; SIGNER_ENVELOPE_HPKE_ENCAPPED_KEY_LEN_V1],
        vec![0xd1; SIGNER_ENVELOPE_HPKE_TAG_LEN_V1 + 1],
    )
    .expect("signer envelope HPKE payload")
}

pub(super) fn role_hpke_envelope(
    role: Role,
    seed: u8,
    key_epoch: &str,
    public_key: &str,
) -> RoleEncryptedEnvelopeV1 {
    let aad_digest = digest(seed + 1);
    let hpke = signer_envelope_hpke_payload(role, key_epoch, public_key, aad_digest);
    RoleEncryptedEnvelopeV1::new(
        role,
        digest(seed),
        aad_digest,
        EncryptedPayloadV1::new(hpke.canonical_bytes()).expect("HPKE payload bytes"),
    )
    .expect("role HPKE envelope")
}

pub(super) fn signer_private_request(kind: WireMessageKindV1) -> WireMessageV1 {
    match kind {
        WireMessageKindV1::RouterToSignerA => {
            ecdsa_threshold_prf_request(2_000)
                .to_signer_wire_messages()
                .expect("signer wire messages")
                .0
        }
        WireMessageKindV1::RouterToSignerB => {
            ecdsa_threshold_prf_request(2_000)
                .to_signer_wire_messages()
                .expect("signer wire messages")
                .1
        }
        _ => WireMessageV1::new(
            kind,
            digest(0x33),
            CanonicalWireBytesV1::new(vec![0x31, 0x32]).expect("private request bytes"),
        )
        .expect("private request"),
    }
}

pub(super) fn ecdsa_threshold_prf_request_with_hpke_envelopes(
    expires_at_ms: u64,
) -> EcdsaThresholdPrfRequestV1 {
    let lifecycle = lifecycle_scope();
    let signer_set = signer_set();
    let transcript_digest = public_request_transcript_digest(&lifecycle, &signer_set);
    EcdsaThresholdPrfRequestV1::new(
        "request-nonce-1",
        expires_at_ms,
        lifecycle,
        signer_set,
        "near-mainnet",
        ecdsa_application_binding_digest_b64u(),
        "router-1",
        "client-1",
        "x25519:client-ephemeral-public-key",
        transcript_digest,
        role_hpke_envelope(
            Role::SignerA,
            0x10,
            "envelope-hpke-key-epoch-a",
            &x25519_public_key(0x11),
        ),
        role_hpke_envelope(
            Role::SignerB,
            0x20,
            "envelope-hpke-key-epoch-b",
            &x25519_public_key(0x22),
        ),
    )
    .expect("public router request with HPKE envelopes")
}

pub(super) fn deriver_a_private_request_with_sealed_hpke_envelope(
    public_key: &str,
    plaintext: &[u8],
) -> (WireMessageV1, RoleEnvelopeAadV1) {
    deriver_a_private_request_with_sealed_hpke_envelope_for_key(
        "envelope-hpke-key-epoch-a",
        public_key,
        plaintext,
    )
}

pub(super) fn deriver_a_private_request_with_sealed_hpke_envelope_for_key(
    key_epoch: &str,
    public_key: &str,
    plaintext: &[u8],
) -> (WireMessageV1, RoleEnvelopeAadV1) {
    let base = ecdsa_threshold_prf_request(2_000);
    let aad = role_envelope_aad_for_request(Role::SignerA, &base);
    let recipient_key =
        CloudflareSignerEnvelopeHpkePublicKeyV1::new(Role::SignerA, key_epoch, public_key)
            .expect("signer a hpke public key");
    let sealed = seal_cloudflare_signer_envelope_hpke_payload_v1(&recipient_key, &aad, plaintext)
        .expect("sealed signer a hpke envelope");
    let request = EcdsaThresholdPrfRequestV1::new(
        base.request_nonce,
        base.expires_at_ms,
        base.lifecycle,
        base.signer_set,
        base.network_id,
        base.account_public_key,
        base.router_id,
        base.client_id,
        base.client_ephemeral_public_key,
        base.transcript_digest,
        RoleEncryptedEnvelopeV1::new(
            Role::SignerA,
            digest(0x10),
            aad.digest(),
            EncryptedPayloadV1::new(sealed.canonical_bytes()).expect("sealed hpke payload bytes"),
        )
        .expect("sealed signer a hpke role envelope"),
        role_hpke_envelope(
            Role::SignerB,
            0x20,
            "envelope-hpke-key-epoch-b",
            &x25519_public_key(0x22),
        ),
    )
    .expect("public router request with sealed signer a HPKE envelope");
    let message = request
        .to_signer_wire_messages()
        .expect("signer wire messages")
        .0;
    (message, aad)
}

pub(super) fn ecdsa_threshold_prf_request_with_aad_bound_envelopes(
    expires_at_ms: u64,
) -> EcdsaThresholdPrfRequestV1 {
    let base = ecdsa_threshold_prf_request(expires_at_ms);
    let aad_a = role_envelope_aad_for_request(Role::SignerA, &base);
    let aad_b = role_envelope_aad_for_request(Role::SignerB, &base);
    EcdsaThresholdPrfRequestV1::new(
        base.request_nonce,
        base.expires_at_ms,
        base.lifecycle,
        base.signer_set,
        base.network_id,
        base.account_public_key,
        base.router_id,
        base.client_id,
        base.client_ephemeral_public_key,
        base.transcript_digest,
        RoleEncryptedEnvelopeV1::new(
            Role::SignerA,
            digest(0x10),
            aad_a.digest(),
            EncryptedPayloadV1::new(vec![0x10, 0x11]).expect("signer a ciphertext"),
        )
        .expect("signer a aad-bound envelope"),
        RoleEncryptedEnvelopeV1::new(
            Role::SignerB,
            digest(0x20),
            aad_b.digest(),
            EncryptedPayloadV1::new(vec![0x20, 0x21]).expect("signer b ciphertext"),
        )
        .expect("signer b aad-bound envelope"),
    )
    .expect("public router request with AAD-bound envelopes")
}

pub(super) fn ecdsa_threshold_prf_request_with_reconstructed_transcript(
    expires_at_ms: u64,
) -> EcdsaThresholdPrfRequestV1 {
    ecdsa_threshold_prf_request(expires_at_ms)
}

pub(super) fn signer_private_request_with_hpke_envelope(kind: WireMessageKindV1) -> WireMessageV1 {
    match kind {
        WireMessageKindV1::RouterToSignerA => {
            ecdsa_threshold_prf_request_with_hpke_envelopes(2_000)
                .to_signer_wire_messages()
                .expect("signer wire messages")
                .0
        }
        WireMessageKindV1::RouterToSignerB => {
            ecdsa_threshold_prf_request_with_hpke_envelopes(2_000)
                .to_signer_wire_messages()
                .expect("signer wire messages")
                .1
        }
        _ => signer_private_request(kind),
    }
}

pub(super) fn signer_private_request_with_aad_bound_envelope(kind: WireMessageKindV1) -> WireMessageV1 {
    match kind {
        WireMessageKindV1::RouterToSignerA => {
            ecdsa_threshold_prf_request_with_aad_bound_envelopes(2_000)
                .to_signer_wire_messages()
                .expect("signer wire messages")
                .0
        }
        WireMessageKindV1::RouterToSignerB => {
            ecdsa_threshold_prf_request_with_aad_bound_envelopes(2_000)
                .to_signer_wire_messages()
                .expect("signer wire messages")
                .1
        }
        _ => signer_private_request(kind),
    }
}

pub(super) fn signer_input_plaintext_bytes(role: Role) -> Vec<u8> {
    let request = ecdsa_threshold_prf_request(2_000);
    signer_input_plaintext_bytes_for_request(role, &request)
}

pub(super) fn signer_input_plaintext_bytes_for_request(
    role: Role,
    request: &EcdsaThresholdPrfRequestV1,
) -> Vec<u8> {
    let (payload_a, payload_b) = request.to_signer_payloads().expect("signer payloads");
    let payload = match role {
        Role::SignerA => payload_a,
        Role::SignerB => payload_b,
        _ => panic!("test helper requires signer role"),
    };
    let assignment = payload.assignment();
    SignerInputPlaintextV1::new(
        RequestKind::Registration,
        payload.lifecycle().lifecycle_id.clone(),
        payload.signer_set().signer_set_id.clone(),
        SignerInputQuorumPolicyV1::All2,
        role,
        assignment.signer.signer_id.clone(),
        assignment.signer.key_epoch.clone(),
        root_epoch(),
        "server-a",
        "server-epoch",
        payload.transcript_digest(),
        request_context_digest(request),
        assignment.envelope.aad_digest,
        vec![
            MpcPrfOutputRequestV1::new(
                OpenedShareKind::XClientBase,
                Role::Client,
                payload.transcript_metadata().client_id.clone(),
            )
            .expect("client output"),
            MpcPrfOutputRequestV1::new(
                OpenedShareKind::XServerBase,
                Role::Server,
                payload.signer_set().selected_server.server_id.clone(),
            )
            .expect("server output"),
        ],
    )
    .expect("signer input plaintext")
    .canonical_bytes()
    .expect("canonical signer input plaintext")
}

pub(super) fn ecdsa_threshold_prf_request(expires_at_ms: u64) -> EcdsaThresholdPrfRequestV1 {
    let lifecycle = lifecycle_scope();
    let signer_set = signer_set();
    let transcript_digest = public_request_transcript_digest(&lifecycle, &signer_set);
    EcdsaThresholdPrfRequestV1::new(
        "request-nonce-1",
        expires_at_ms,
        lifecycle,
        signer_set,
        "near-mainnet",
        ecdsa_application_binding_digest_b64u(),
        "router-1",
        "client-1",
        "x25519:client-ephemeral-public-key",
        transcript_digest,
        role_envelope(Role::SignerA, 0x10),
        role_envelope(Role::SignerB, 0x20),
    )
    .expect("public router request")
}

pub(super) fn server_proof_bundle_wire(
    router_payload: &RouterToSignerPayloadV1,
    signer_role: Role,
    nonce_seed: u8,
) -> WireMessageV1 {
    let server = &router_payload.signer_set().selected_server;
    let envelope = RecipientProofBundleCiphertextV1::new(
        RecipientOutputEncryptionAlgorithmV1::LocalDeterministicSha256V1,
        signer_identity(signer_role),
        Role::Server,
        OpenedShareKind::XServerBase,
        server.server_id.clone(),
        server.recipient_encryption_key.clone(),
        router_payload.transcript_digest(),
        digest(nonce_seed.wrapping_add(0x10)),
        [nonce_seed; 12],
        EncryptedPayloadV1::new(vec![nonce_seed, nonce_seed.wrapping_add(1)])
            .expect("proof-bundle ciphertext"),
    )
    .expect("recipient proof-bundle envelope");
    WireMessageV1::new(
        WireMessageKindV1::RecipientProofBundle,
        router_payload.transcript_digest(),
        CanonicalWireBytesV1::new(envelope.canonical_bytes().expect("proof-bundle bytes"))
            .expect("wire payload"),
    )
    .expect("recipient proof-bundle wire")
}

pub(super) fn client_proof_bundle_wire(
    router_payload: &RouterToSignerPayloadV1,
    signer_role: Role,
    nonce_seed: u8,
) -> WireMessageV1 {
    let metadata = router_payload.transcript_metadata();
    let envelope = RecipientProofBundleCiphertextV1::new(
        RecipientOutputEncryptionAlgorithmV1::LocalDeterministicSha256V1,
        signer_identity(signer_role),
        Role::Client,
        OpenedShareKind::XClientBase,
        metadata.client_id.clone(),
        metadata.client_ephemeral_public_key.clone(),
        router_payload.transcript_digest(),
        digest(nonce_seed.wrapping_add(0x20)),
        [nonce_seed; 12],
        EncryptedPayloadV1::new(vec![nonce_seed, nonce_seed.wrapping_add(1)])
            .expect("client proof-bundle ciphertext"),
    )
    .expect("client recipient proof-bundle envelope");
    WireMessageV1::new(
        WireMessageKindV1::RecipientProofBundle,
        router_payload.transcript_digest(),
        CanonicalWireBytesV1::new(
            envelope
                .canonical_bytes()
                .expect("client proof-bundle bytes"),
        )
        .expect("client wire payload"),
    )
    .expect("client recipient proof-bundle wire")
}

pub(super) fn test_router_jwks_json() -> &'static str {
    r#"{"keys":[{"alg":"EdDSA","crv":"Ed25519","kid":"test-router-key","kty":"OKP","use":"sig","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]}"#
}

pub(super) fn configured_project_policy_json(allowed_work_kinds: &str, allow_normal_signing: bool) -> String {
    format!(
        r#"{{"org_id":"org-1","project_id":"project-1","environment":"dev","allowed_work_kinds":[{allowed_work_kinds}],"allow_normal_signing":{allow_normal_signing},"rejected_retry_after_ms":1000}}"#
    )
}

/// The published control-plane issuer anchor every verifier Worker requires.
pub(super) static ISSUER_VERIFYING_KEYS_JSON: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    let verifying = SigningKey::from_bytes(&[0x51; 32])
        .verifying_key()
        .to_bytes();
    let hex: String = verifying.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{{\"keys\":[{{\"issuer_key_id\":\"control-plane-issuer-v1\",\"verifying_key_hex\":\"{hex}\"}}]}}"
    )
});

/// Grant authorities the issuer trusts. Deliberately a different key from the
/// issuer's own: the bindings reject reuse.
pub(super) static GRANT_AUTHORITY_VERIFYING_KEYS_JSON: std::sync::LazyLock<String> = std::sync::LazyLock::new(
    || {
        let verifying = SigningKey::from_bytes(&[0x71; 32])
            .verifying_key()
            .to_bytes();
        let hex: String = verifying.iter().map(|byte| format!("{byte:02x}")).collect();
        format!(
            "{{\"keys\":[{{\"issuer_key_id\":\"provisioning-authority-v1\",\"verifying_key_hex\":\"{hex}\"}}]}}"
        )
    },
);

/// The published role keyset the control plane resolves its configured signing
/// IDs against. Keys are distinct from the issuer and grant authorities.
pub(super) static ROLE_VERIFYING_KEYS_JSON: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    let hex = |seed: u8| -> String {
        SigningKey::from_bytes(&[seed; 32])
            .verifying_key()
            .to_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    };
    format!(
        "{{\"active_deriver_a_signing_key_id\":\"deriver-a-signing-key-7\",\"active_deriver_b_signing_key_id\":\"deriver-b-signing-key-9\",\"keys\":[{{\"role\":\"deriver_a\",\"signing_key_id\":\"deriver-a-signing-key-7\",\"verifying_key_hex\":\"{}\"}},{{\"role\":\"deriver_b\",\"signing_key_id\":\"deriver-b-signing-key-9\",\"verifying_key_hex\":\"{}\"}}]}}",
        hex(0xa1),
        hex(0xb1)
    )
});

pub(super) fn issuer_verifying_keys() -> CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1 {
    CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1::decode(&ISSUER_VERIFYING_KEYS_JSON)
        .expect("issuer verifying keys")
}

pub(super) fn router_env() -> CloudflareEnvMapV1 {
    CloudflareEnvMapV1::new(vec![
        (
            TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
            ISSUER_VERIFYING_KEYS_JSON.as_str(),
        ),
        (ROUTER_JWT_ISSUER_ENV, "https://issuer.example"),
        (ROUTER_JWT_AUDIENCE_ENV, "router-ab"),
        (ROUTER_JWT_JWKS_JSON_ENV, test_router_jwks_json()),
        (DERIVER_A_PEER_BINDING_ENV, "DERIVER_A"),
        (DERIVER_B_PEER_BINDING_ENV, "DERIVER_B"),
        (SIGNING_WORKER_PEER_BINDING_ENV, "SIGNING_WORKER"),
    ])
}

pub(super) fn router_env_with_public_keyset() -> CloudflareEnvMapV1 {
    CloudflareEnvMapV1::new(vec![
        (
            TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
            ISSUER_VERIFYING_KEYS_JSON.as_str(),
        ),
        (ROUTER_JWT_ISSUER_ENV, "https://issuer.example"),
        (ROUTER_JWT_AUDIENCE_ENV, "router-ab"),
        (ROUTER_JWT_JWKS_JSON_ENV, test_router_jwks_json()),
        (DERIVER_A_PEER_BINDING_ENV, "DERIVER_A"),
        (DERIVER_B_PEER_BINDING_ENV, "DERIVER_B"),
        (SIGNING_WORKER_PEER_BINDING_ENV, "SIGNING_WORKER"),
        (
            DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-a",
        ),
        (
            DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            x25519_public_key(0x11).as_str(),
        ),
        (
            DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-b",
        ),
        (
            DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            x25519_public_key(0x22).as_str(),
        ),
        (
            SIGNING_WORKER_SERVER_OUTPUT_HPKE_KEY_EPOCH_ENV,
            signer_set().selected_server.key_epoch.as_str(),
        ),
        (
            SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY_ENV,
            signer_set()
                .selected_server
                .recipient_encryption_key
                .as_str(),
        ),
    ])
}

pub(super) fn router_admission_env() -> CloudflareEnvMapV1 {
    CloudflareEnvMapV1::new(vec![
        (ROUTER_JWT_ISSUER_ENV, "https://issuer.example"),
        (ROUTER_JWT_AUDIENCE_ENV, "router-ab"),
        (ROUTER_JWT_JWKS_JSON_ENV, test_router_jwks_json()),
    ])
}

pub(super) fn router_admission_bindings() -> CloudflareRouterAdmissionBindingsV1 {
    parse_cloudflare_router_admission_bindings_v1(&router_admission_env())
        .expect("router admission bindings")
}

pub(super) fn deriver_a_env() -> CloudflareEnvMapV1 {
    CloudflareEnvMapV1::new(vec![
        (
            TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
            ISSUER_VERIFYING_KEYS_JSON.to_string(),
        ),
        (
            DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
            "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY".to_string(),
        ),
        (
            DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-a".to_string(),
        ),
        (
            DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            x25519_public_key(0x11),
        ),
        (DERIVER_B_PEER_BINDING_ENV, "DERIVER_B".to_string()),
    ])
}

pub(super) fn deriver_b_env() -> CloudflareEnvMapV1 {
    CloudflareEnvMapV1::new(vec![
        (
            TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
            ISSUER_VERIFYING_KEYS_JSON.to_string(),
        ),
        (
            DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
            "DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY".to_string(),
        ),
        (
            DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-b".to_string(),
        ),
        (
            DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            x25519_public_key(0x22),
        ),
        (DERIVER_A_PEER_BINDING_ENV, "DERIVER_A".to_string()),
    ])
}

pub(super) fn signing_worker_env() -> CloudflareEnvMapV1 {
    CloudflareEnvMapV1::new(vec![
        (
            SIGNING_WORKER_PRESIGN_SESSION_DO_BINDING_ENV,
            "SIGNING_WORKER_PRESIGN_SESSION_DO".to_string(),
        ),
        (
            SIGNING_WORKER_PRESIGN_SESSION_DO_OBJECT_ENV,
            "signing-worker-presign-session".to_string(),
        ),
        (
            SIGNING_WORKER_PRESIGN_SESSION_DO_KEY_PREFIX_ENV,
            "signing-worker-presign-session:".to_string(),
        ),
        (
            SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY_BINDING_ENV,
            "SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY".to_string(),
        ),
        (
            SIGNING_WORKER_SERVER_OUTPUT_HPKE_KEY_EPOCH_ENV,
            "server-epoch".to_string(),
        ),
        (
            SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY_ENV,
            signer_set().selected_server.recipient_encryption_key,
        ),
    ])
}
