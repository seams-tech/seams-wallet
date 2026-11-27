//! ECDSA activation, refresh, wallet-session, admitted-request, pool and finalize tests.

use super::*;

#[test]
fn router_ab_ecdsa_derivation_activation_material_derives_context_bound_public_identity() {
    let activation = router_ab_ecdsa_derivation_activation_request();
    let material = router_ab_ecdsa_derivation_server_material_record(&activation);

    let identity =
        cloudflare_router_ab_ecdsa_derivation_public_identity_from_activation_material_v1(
            &activation.pending.registration,
            &activation.client_activation,
            &material,
        )
        .expect("Router A/B ECDSA derivation public identity");

    identity
        .validate_for_context(&activation.pending.registration.context)
        .expect("identity must validate against core Router A/B ECDSA derivation context");
    assert_eq!(
        identity.context_binding_b64u,
        b64u(
            activation
                .pending
                .registration
                .context
                .context_binding_digest()
                .expect("context binding")
                .as_bytes()
        )
    );
    assert_eq!(
        identity.derivation_client_share_public_key33_b64u,
        activation
            .client_activation
            .derivation_client_share_public_key33_b64u
    );

    let receipt = cloudflare_router_ab_ecdsa_derivation_activation_receipt_from_material_v1(
        &activation,
        &material,
        TEST_ACTIVATED_AT_MS,
    )
    .expect("Router A/B ECDSA derivation activation receipt");
    receipt.validate().expect("activation receipt validates");
    assert_eq!(receipt.public_identity, identity);
    assert_eq!(
        receipt.signing_worker,
        activation
            .pending
            .activation_context
            .signer_set()
            .selected_server
    );
}

#[test]
fn router_ab_ecdsa_derivation_activation_refresh_receipt_preserves_identity_for_next_epoch() {
    let refresh = router_ab_ecdsa_derivation_activation_refresh_request();
    let material = router_ab_ecdsa_derivation_refresh_server_material_record(&refresh, 0x5a);

    let receipt =
        cloudflare_router_ab_ecdsa_derivation_activation_refresh_receipt_from_material_v1(
            &refresh,
            &material,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect("Router A/B ECDSA derivation activation-refresh receipt");
    receipt
        .validate()
        .expect("activation-refresh receipt validates");
    assert_eq!(receipt.context, refresh.refresh_request.context);
    assert_eq!(
        receipt.public_identity,
        refresh.refresh_request.public_identity
    );
    assert_eq!(
        receipt.signing_worker,
        refresh.activation_context.signer_set().selected_server
    );
    assert_eq!(
        receipt.activation_epoch,
        refresh.refresh_request.next_activation_epoch
    );

    let scope =
        cloudflare_router_ab_ecdsa_derivation_normal_signing_scope_from_activation_receipt_v1(
            &receipt,
            ROUTER_AB_ECDSA_DERIVATION_WALLET_ID,
            ROUTER_AB_ECDSA_DERIVATION_THRESHOLD_KEY_ID,
            ROUTER_AB_ECDSA_DERIVATION_SIGNING_ROOT_ID,
            ROUTER_AB_ECDSA_DERIVATION_SIGNING_ROOT_VERSION,
            router_ab_ecdsa_derivation_material_activation_for_epoch(&receipt.activation_epoch),
        )
        .expect("refreshed Router A/B ECDSA derivation normal-signing scope");
    let active_state = cloudflare_active_signing_worker_state_from_activation_request_v1(
        &refresh
            .to_recipient_proof_bundle_activation_request()
            .expect("generic refresh activation request"),
        refresh.material_activation.clone(),
        "router-ab-ecdsa-derivation-refresh-material",
        TEST_ACTIVATED_AT_MS + 1,
    )
    .expect("refreshed active SigningWorker state");
    validate_cloudflare_router_ab_ecdsa_derivation_normal_signing_active_material_v1(
        &scope,
        &active_state,
        &material,
    )
    .expect("refreshed active material preserves public identity");
}

#[test]
fn router_ab_ecdsa_derivation_activation_refresh_receipt_rejects_public_identity_drift() {
    let refresh = router_ab_ecdsa_derivation_activation_refresh_request();
    let drifted_material =
        router_ab_ecdsa_derivation_refresh_server_material_record(&refresh, 0x5b);

    let err = cloudflare_router_ab_ecdsa_derivation_activation_refresh_receipt_from_material_v1(
        &refresh,
        &drifted_material,
        TEST_ACTIVATED_AT_MS + 1,
    )
    .expect_err("refresh material drift must fail");
    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn router_ab_ecdsa_derivation_activation_refresh_public_admission_response_validates_receipt() {
    let refresh = router_ab_ecdsa_derivation_activation_refresh_request();
    let material = router_ab_ecdsa_derivation_refresh_server_material_record(&refresh, 0x5a);
    let receipt =
        cloudflare_router_ab_ecdsa_derivation_activation_refresh_receipt_from_material_v1(
            &refresh,
            &material,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect("Router A/B ECDSA derivation activation-refresh receipt");
    let signing_worker_output = CloudflareSigningWorkerOutputActivationReceiptV1::new(
        refresh.refresh_request.lifecycle.lifecycle_id.clone(),
        refresh
            .activation_context
            .signer_set()
            .selected_server
            .server_id
            .clone(),
        refresh.activation_context.transcript_digest(),
        cloudflare_active_signing_worker_state_from_activation_request_v1(
            &refresh
                .to_recipient_proof_bundle_activation_request()
                .expect("generic refresh activation request"),
            refresh.material_activation.clone(),
            "router-ab-ecdsa-derivation-refresh-material",
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect("refreshed active SigningWorker state"),
        true,
    )
    .expect("SigningWorker output activation receipt");
    let signing_worker_activation =
        CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1::new(
            receipt,
            signing_worker_output,
        )
        .expect("Router A/B ECDSA derivation SigningWorker activation-refresh receipt");
    let public_request = refresh
        .refresh_request
        .to_threshold_prf_request()
        .expect("refresh public request");
    let (deriver_a_message, _) = public_request
        .to_signer_wire_messages()
        .expect("refresh signer messages");
    let router_payload = decode_router_to_signer_payload_v1(deriver_a_message.payload.as_bytes())
        .expect("refresh Router payload");
    let response = CloudflareRouterRecipientProofBundleResponseV1::new(
        client_proof_bundle_wire(&router_payload, Role::SignerA, 0x61),
        client_proof_bundle_wire(&router_payload, Role::SignerB, 0x62),
    )
    .expect("refresh public Router response");

    let admission =
        CloudflareRouterAbEcdsaDerivationActivationRefreshAdmissionResponseV1::forwarded(
            response,
            signing_worker_activation,
        )
        .expect("refresh public admission response");
    admission
        .validate()
        .expect("refresh public admission validates");
}

#[test]
fn router_ab_ecdsa_derivation_normal_signing_scope_binds_active_material_to_identity() {
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
    let active_state = cloudflare_active_signing_worker_state_from_activation_request_v1(
        &activation
            .to_recipient_proof_bundle_activation_request()
            .expect("generic activation request"),
        activation.material_activation.clone(),
        "router-ab-ecdsa-derivation-material",
        TEST_ACTIVATED_AT_MS,
    )
    .expect("Router A/B ECDSA derivation active state");
    let lookup =
        CloudflareActiveSigningWorkerStateLookupV1::from_router_ab_ecdsa_derivation_normal_signing_scope(&scope)
            .expect("Router A/B ECDSA derivation active-state lookup");

    assert_eq!(
        active_state.material_activation.activation_id,
        format!("ecdsa-activation-{}", root_epoch().as_str())
    );
    assert_eq!(
        lookup.material_activation_id,
        active_state.material_activation.activation_id
    );
    lookup
        .validate_active_state(&active_state)
        .expect("Router A/B ECDSA derivation lookup matches active state");
    let derived_identity =
        cloudflare_router_ab_ecdsa_derivation_public_identity_from_normal_signing_material_v1(
            &scope, &material,
        )
        .expect("Router A/B ECDSA derivation normal-signing identity");
    assert_eq!(derived_identity, scope.public_identity);
    validate_cloudflare_router_ab_ecdsa_derivation_normal_signing_active_material_v1(
        &scope,
        &active_state,
        &material,
    )
    .expect("Router A/B ECDSA derivation normal-signing active material validates");
}

#[test]
fn signing_worker_output_activate_and_active_state_get_share_opaque_material_activation_key() {
    let mut activation = router_ab_ecdsa_derivation_activation_request();
    activation.material_activation.activation_id = "opaque-ecdsa-activation-id".to_owned();
    activation
        .validate()
        .expect("opaque material activation remains context-valid");
    let generic_activation = activation
        .to_recipient_proof_bundle_activation_request()
        .expect("generic SigningWorker activation request");
    let material = router_ab_ecdsa_derivation_server_material_record(&activation);
    let output_activate = CloudflareSigningWorkerPrivateD1RequestV1::OutputActivate {
        activation: generic_activation.clone(),
        material,
        activated_at_ms: TEST_ACTIVATED_AT_MS,
    };
    output_activate
        .validate()
        .expect("OutputActivate request validates");
    let active_state = active_signing_worker_state_for_activation(
        &generic_activation,
        "opaque-ecdsa-activation-material",
    );
    let active_state_get = CloudflareSigningWorkerPrivateD1RequestV1::ActiveStateGet {
        lookup: CloudflareActiveSigningWorkerStateLookupV1::new(
            active_state.account_id.clone(),
            active_state.material_activation.activation_id.clone(),
            active_state.signing_worker.server_id.clone(),
        )
        .expect("active SigningWorker lookup"),
    };

    assert_eq!(
        output_activate
            .active_state_index_key()
            .expect("OutputActivate active-state key"),
        active_state_get
            .active_state_index_key()
            .expect("ActiveStateGet active-state key")
    );
}

pub(super) struct TestRouterAbEcdsaDerivationEvmDigestFinalizeHandler;

impl CloudflareSigningWorkerRouterAbEcdsaDerivationEvmDigestFinalizeHandlerV1
    for TestRouterAbEcdsaDerivationEvmDigestFinalizeHandler
{
    fn handle_router_ab_ecdsa_derivation_evm_digest_finalize_request_v1(
        &self,
        request: CloudflareSigningWorkerMaterializedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    ) -> RouterAbProtocolResult<RouterAbEcdsaDerivationEvmDigestSigningResponseV1> {
        request.validate()?;
        assert_eq!(
            request.server_presignature.server_presignature_id,
            request.request.request.server_presignature_id
        );
        RouterAbEcdsaDerivationEvmDigestSigningResponseV1::new_for_request(
            &request.request.request,
            b64u(&[0x99; 65]),
        )
    }
}

#[test]
fn router_ab_ecdsa_derivation_wallet_session_builds_prepare_admission_candidate() {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let wallet_session = router_ab_ecdsa_derivation_wallet_session(&request);

    wallet_session
        .validate_for_router_ab_ecdsa_derivation_evm_digest_signing_request_v1(
            &request,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect("Wallet Session authorizes Router A/B ECDSA derivation prepare request");
    let admission =
        CloudflareRouterAbEcdsaDerivationEvmDigestPrepareAdmissionCandidateV1::from_prepare_request(
            &wallet_session,
            &request,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect("Router A/B ECDSA derivation prepare admission candidate");
    assert_eq!(admission.account_id, request.scope.wallet_id);
    assert_eq!(
        admission.authorization,
        CloudflareRouterNormalSigningAuthorizationV2::ReusableWalletSession {
            authorization_id: "authorization-ecdsa-1".to_owned(),
            wallet_session_id: "ecdsa-wallet-session-1".to_owned(),
        }
    );
    assert_eq!(
        admission.signing_worker_id,
        request.scope.signing_worker.server_id
    );
    assert_eq!(
        admission.request_digest,
        request.request_digest().expect("request digest")
    );
    assert_eq!(
        admission.client_presignature_id,
        request.client_presignature_id
    );
    assert_eq!(
        admission.signing_digest,
        request.signing_digest().expect("signing digest")
    );
}

#[test]
fn router_ab_ecdsa_derivation_wallet_session_builds_finalize_admission_candidate() {
    let request = router_ab_ecdsa_derivation_digest_signing_finalize_request();
    let prepare_request = request.prepare_request().expect("prepare request");
    let wallet_session = router_ab_ecdsa_derivation_wallet_session(&prepare_request);

    wallet_session
        .validate_for_router_ab_ecdsa_derivation_evm_digest_finalize_request_v1(
            &request,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect("Wallet Session authorizes Router A/B ECDSA derivation finalize request");
    let admission =
        CloudflareRouterAbEcdsaDerivationEvmDigestFinalizeAdmissionCandidateV1::from_finalize_request(
            &wallet_session,
            &request,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect("Router A/B ECDSA derivation finalize admission candidate");
    assert_eq!(admission.account_id, request.scope.wallet_id);
    assert_eq!(
        admission.authorization,
        CloudflareRouterNormalSigningAuthorizationV2::ReusableWalletSession {
            authorization_id: "authorization-ecdsa-1".to_owned(),
            wallet_session_id: "ecdsa-wallet-session-1".to_owned(),
        }
    );
    assert_eq!(
        admission.finalize_request_digest,
        request.request_digest().expect("finalize request digest")
    );
    assert_eq!(
        admission.prepare_request_digest,
        request
            .prepare_request_digest()
            .expect("prepare request digest")
    );
    assert_eq!(admission.server_presignature_id, "server-presignature-1");
}

#[test]
fn router_ab_ecdsa_derivation_wallet_session_rejects_scope_mismatch() {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let mut wallet_session = router_ab_ecdsa_derivation_wallet_session(&request);
    wallet_session.account_id = "different-wallet".to_owned();

    let err = wallet_session
        .validate_for_router_ab_ecdsa_derivation_evm_digest_signing_request_v1(
            &request,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect_err("scope mismatch rejects");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_ab_ecdsa_derivation_wallet_session_rejects_wallet_session_substitution() {
    let mut request = router_ab_ecdsa_derivation_digest_signing_request();
    request.authorization =
        NormalSigningAuthorizationV1::reusable_wallet_session("wallet-session-substituted")
            .expect("substituted Wallet Session authorization");
    let wallet_session = router_ab_ecdsa_derivation_wallet_session(&request);

    let err = wallet_session
        .validate_for_router_ab_ecdsa_derivation_evm_digest_signing_request_v1(
            &request,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect_err("substituted Wallet Session id rejects");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_ab_ecdsa_derivation_operation_step_up_admission_retains_authorization_session_id() {
    let mut request = router_ab_ecdsa_derivation_digest_signing_request();
    request.authorization = NormalSigningAuthorizationV1::OperationStepUp;
    let authorization = CloudflareRouterNormalSigningAuthorizationV2::operation_step_up(
        "authorization-session-step-up",
        b64u(&[0x44; 32]),
    )
    .expect("operation step-up authorization");
    let admission = CloudflareRouterAbEcdsaDerivationEvmDigestPrepareAdmissionCandidateV1::new(
        "org-1",
        "project-1",
        "dev",
        request.scope.wallet_id.clone(),
        "subject-1",
        authorization,
        request.scope.signing_worker.server_id.clone(),
        request.request_id.clone(),
        request.client_presignature_id.clone(),
        request.scope.scope_digest().expect("scope digest"),
        request.request_digest().expect("request digest"),
        request.signing_digest().expect("signing digest"),
        digest(0x42),
        request.expires_at_ms,
    )
    .expect("operation step-up admission");

    admission
        .validate_for_prepare_request(&request)
        .expect("operation step-up authorization matches request");
    assert!(matches!(
        admission.authorization,
        CloudflareRouterNormalSigningAuthorizationV2::OperationStepUp {
            authorization_session_id,
            ..
        } if authorization_session_id == "authorization-session-step-up"
    ));
}

#[test]
fn router_ab_ecdsa_derivation_admitted_request_rejects_trusted_admission_drift() {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let mut trusted_admission = router_ab_ecdsa_derivation_trusted_admission(&request);
    trusted_admission.metadata.intent_digest = digest(0x55);

    let err = CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
        1,
        signing_wallet_scope(&request.scope.wallet_id),
        request,
        trusted_admission,
    )
    .expect_err("trusted admission drift rejects");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_ab_ecdsa_derivation_admitted_request_accepts_reusable_wallet_session_distinct_from_material_activation(
) {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let material_activation_id = request
        .scope
        .material_activation_id()
        .expect("material activation id");
    let wallet_session_id = request
        .authorization
        .reusable_wallet_session_id()
        .expect("reusable Wallet Session id");
    assert_ne!(wallet_session_id, material_activation_id);

    let admitted =
        CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
            1,
            signing_wallet_scope(&request.scope.wallet_id),
            request,
            router_ab_ecdsa_derivation_trusted_admission(
                &router_ab_ecdsa_derivation_digest_signing_request(),
            ),
        )
        .expect("reusable Wallet Session authorization is independent of material activation");
    assert!(matches!(
        admitted.trusted_admission.metadata.auth,
        CloudflareRouterAuthContextV1::OwnerWalletSession { .. }
    ));
}

#[test]
fn router_ab_ecdsa_derivation_admitted_request_rejects_wrong_reusable_wallet_session() {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let mut trusted_admission = router_ab_ecdsa_derivation_trusted_admission(&request);
    trusted_admission.metadata.auth =
        CloudflareRouterAuthContextV1::owner_wallet_session("subject-1", "wrong-wallet-session")
            .expect("wrong Wallet Session auth context");

    let err = CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
        1,
        signing_wallet_scope(&request.scope.wallet_id),
        request,
        trusted_admission,
    )
    .expect_err("wrong reusable Wallet Session authorization rejects");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_ab_ecdsa_derivation_admitted_request_accepts_operation_step_up_only_with_step_up_auth() {
    let mut request = router_ab_ecdsa_derivation_digest_signing_request();
    request.authorization =
        NormalSigningAuthorizationV1::operation_step_up().expect("operation step-up authorization");
    let trusted_admission = router_ab_ecdsa_derivation_trusted_admission(&request);

    let admitted =
        CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
            1,
            signing_wallet_scope(&request.scope.wallet_id),
            request,
            trusted_admission,
        )
        .expect("operation step-up authorization is accepted with step-up auth context");
    assert!(matches!(
        admitted.trusted_admission.metadata.auth,
        CloudflareRouterAuthContextV1::OwnerOperationStepUp { .. }
    ));
}

#[test]
fn router_ab_ecdsa_derivation_admitted_finalize_request_rejects_trusted_admission_drift() {
    let request = router_ab_ecdsa_derivation_digest_signing_finalize_request();
    let mut trusted_admission = router_ab_ecdsa_derivation_finalize_trusted_admission(&request);
    trusted_admission.metadata.intent_digest = request
        .prepare_request_digest()
        .expect("prepare request digest");
    let effect_claim = ecdsa_effect_claim(&request);
    let effect_identity = ecdsa_effect_identity(&request);

    let err =
        CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1::new(
            1,
            signing_wallet_scope(&request.scope.wallet_id),
            request,
            trusted_admission,
            effect_identity,
            effect_claim,
        )
        .expect_err("finalize trusted admission drift rejects");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_ab_ecdsa_derivation_admitted_finalize_accepts_reusable_wallet_session_distinct_from_material_activation(
) {
    let request = router_ab_ecdsa_derivation_digest_signing_finalize_request();
    let effect_claim = ecdsa_effect_claim(&request);
    let effect_identity = ecdsa_effect_identity(&request);

    let admitted =
        CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1::new(
            1,
            signing_wallet_scope(&request.scope.wallet_id),
            request.clone(),
            router_ab_ecdsa_derivation_finalize_trusted_admission(&request),
            effect_identity,
            effect_claim,
        )
        .expect("reusable Wallet Session authorization is independent of material activation");
    assert!(matches!(
        admitted.trusted_admission.metadata.auth,
        CloudflareRouterAuthContextV1::OwnerWalletSession { .. }
    ));
    let admitted_session_id = match &admitted.trusted_admission.metadata.auth {
        CloudflareRouterAuthContextV1::OwnerWalletSession {
            wallet_session_id, ..
        } => wallet_session_id,
        _ => unreachable!("reusable authorization must use owner Wallet Session auth"),
    };
    assert_ne!(
        admitted_session_id,
        &request
            .scope
            .material_activation_id()
            .expect("material activation id")
    );
}

#[test]
fn router_ab_ecdsa_derivation_admitted_finalize_rejects_owner_wallet_session_auth_for_operation_step_up(
) {
    let mut request = router_ab_ecdsa_derivation_digest_signing_finalize_request();
    request.authorization =
        NormalSigningAuthorizationV1::operation_step_up().expect("operation step-up authorization");
    let mut trusted_admission = router_ab_ecdsa_derivation_finalize_trusted_admission(&request);
    trusted_admission.metadata.auth =
        CloudflareRouterAuthContextV1::owner_wallet_session("subject-1", "wallet-session-ecdsa-1")
            .expect("owner Wallet Session auth context");
    let effect_claim = ecdsa_effect_claim(&request);
    let effect_identity = ecdsa_effect_identity(&request);

    let err =
        CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1::new(
            1,
            signing_wallet_scope(&request.scope.wallet_id),
            request,
            trusted_admission,
            effect_identity,
            effect_claim,
        )
        .expect_err("operation step-up request cannot use reusable Wallet Session auth");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_ab_ecdsa_reusable_authorized_operation_rejects_substitution() {
    let request = router_ab_ecdsa_derivation_digest_signing_finalize_request();
    let authorized_operation =
        CloudflareRouterEcdsaAuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
            authorized_operation_id: "authorized-operation-ecdsa-1".to_owned(),
            operation_id: request.operation_id.clone(),
            capability_kind: CloudflareRouterEcdsaCapabilityKindV1::EvmEcdsaMpcSigning,
            operation_kind: CloudflareRouterEcdsaOperationKindV1::SignTransaction,
            lane_digest_b64u: request.operation_digests.lane_digest_b64u.clone(),
            intent_digest_b64u: request.operation_digests.intent_digest_b64u.clone(),
            display_digest_b64u: request.operation_digests.display_digest_b64u.clone(),
            operation_fingerprint_digest: request.operation_digests.intent_digest_b64u.clone(),
        };
    authorized_operation
        .validate_for_finalize_request_with_session(&request, None)
        .expect("matching reusable authorized operation");

    let substituted = match authorized_operation {
        CloudflareRouterEcdsaAuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
            authorized_operation_id: _,
            operation_id: _,
            capability_kind,
            operation_kind,
            lane_digest_b64u,
            intent_digest_b64u,
            display_digest_b64u,
            operation_fingerprint_digest,
        } => CloudflareRouterEcdsaAuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
            authorized_operation_id: "authorized-operation-substituted".to_owned(),
            operation_id: "substituted-operation".to_owned(),
            capability_kind,
            operation_kind,
            lane_digest_b64u,
            intent_digest_b64u,
            display_digest_b64u,
            operation_fingerprint_digest,
        },
        CloudflareRouterEcdsaAuthorizedOperationV1::VerifiedStepUpAuthorizedOperationV1 { .. } => {
            unreachable!("fixture uses reusable authorization")
        }
    };
    let error = substituted
        .validate_for_finalize_request_with_session(&request, None)
        .expect_err("substituted reusable operation must fail before signing");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_ab_ecdsa_authorized_finalize_parser_requires_authorized_operation_and_rejects_legacy_fields(
) {
    let request = router_ab_ecdsa_derivation_digest_signing_finalize_request();
    let mut body = serde_json::to_value(&request)
        .expect("ECDSA finalize request JSON")
        .as_object()
        .expect("ECDSA finalize request object")
        .clone();

    let missing_authorized_operation =
        serde_json::to_vec(&body).expect("ECDSA finalize request without authorized operation");
    let error =
        parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_finalize_request_v1_json(
            &missing_authorized_operation,
        )
        .expect_err("ECDSA finalize must require authorized operation");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );

    let authorized_operation =
        CloudflareRouterEcdsaAuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
            authorized_operation_id: "authorized-operation-ecdsa-parser-1".to_owned(),
            operation_id: request.operation_id.clone(),
            capability_kind: CloudflareRouterEcdsaCapabilityKindV1::EvmEcdsaMpcSigning,
            operation_kind: CloudflareRouterEcdsaOperationKindV1::SignTransaction,
            lane_digest_b64u: request.operation_digests.lane_digest_b64u.clone(),
            intent_digest_b64u: request.operation_digests.intent_digest_b64u.clone(),
            display_digest_b64u: request.operation_digests.display_digest_b64u.clone(),
            operation_fingerprint_digest: request.operation_digests.intent_digest_b64u.clone(),
        };
    let accepted_authorized_operation = CloudflareRouterEcdsaAcceptedAuthorizedOperationV1 {
        binding: CloudflareRouterEcdsaAcceptedCapabilityBindingV1::ReusableWalletSession {
            authorization_id: "authorization-ecdsa-parser-1".to_owned(),
            wallet_session_id: "wallet-ecdsa-parser-1".to_owned(),
            quota_id: "quota-ecdsa-parser-1".to_owned(),
        },
        authorized_operation,
    };
    body.insert(
        "authorized_operation".to_owned(),
        serde_json::to_value(&accepted_authorized_operation)
            .expect("ECDSA accepted authorized operation JSON"),
    );
    let parsed =
        parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_finalize_request_v1_json(
            &serde_json::to_vec(&body).expect("ECDSA accepted finalize request JSON"),
        )
        .expect("ECDSA finalize parser accepts a bound authorized operation");
    assert_eq!(parsed.0.operation_id, request.operation_id);

    let mut aliased_body = body.clone();
    aliased_body["authorized_operation"]["binding"]["quota_id"] =
        serde_json::json!("wallet-ecdsa-parser-1");
    let error =
        parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_finalize_request_v1_json(
            &serde_json::to_vec(&aliased_body).expect("aliased ECDSA finalize request JSON"),
        )
        .expect_err("Wallet Session and quota ids must remain distinct");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let mut legacy_accepted = serde_json::to_value(&accepted_authorized_operation)
        .expect("ECDSA accepted authorized operation JSON");
    let legacy_operation = legacy_accepted
        .as_object_mut()
        .expect("ECDSA accepted authorization object")
        .remove("authorized_operation")
        .expect("authorized_operation field");
    legacy_accepted
        .as_object_mut()
        .expect("ECDSA accepted authorization object")
        .insert("claim".to_owned(), legacy_operation);
    let mut legacy_nested_body = body.clone();
    legacy_nested_body.insert("authorized_operation".to_owned(), legacy_accepted);
    let error =
        parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_finalize_request_v1_json(
            &serde_json::to_vec(&legacy_nested_body)
                .expect("ECDSA legacy nested operation request JSON"),
        )
        .expect_err("legacy nested operation field must be rejected");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );

    body.insert("sessionId".to_owned(), serde_json::json!("legacy-session"));
    let legacy_alias = serde_json::to_vec(&body).expect("ECDSA legacy alias request JSON");
    let error =
        parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_finalize_request_v1_json(
            &legacy_alias,
        )
        .expect_err("legacy session aliases must be rejected");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );
}

#[test]
fn router_ab_ecdsa_derivation_normal_signing_request_materializes_from_active_state() {
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
    let active_state = cloudflare_active_signing_worker_state_from_activation_request_v1(
        &activation
            .to_recipient_proof_bundle_activation_request()
            .expect("generic activation request"),
        activation.material_activation.clone(),
        "router-ab-ecdsa-derivation-material",
        TEST_ACTIVATED_AT_MS,
    )
    .expect("Router A/B ECDSA derivation active state");
    let material_activation = router_ab_ecdsa_derivation_material_activation(&scope);
    let request = RouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
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
    .expect("Router A/B ECDSA derivation normal-signing request");
    let admitted = admitted_router_ab_ecdsa_derivation_digest_signing_request(request);
    let materialized =
        CloudflareSigningWorkerMaterializedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
            admitted,
            active_state,
            material,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect("materialized Router A/B ECDSA derivation normal-signing request");

    assert_eq!(
        materialized
            .request
            .request
            .signing_digest()
            .expect("signing digest"),
        PublicDigest32::new([0x77; 32])
    );
}

#[test]
fn signing_worker_ecdsa_pool_lifecycle_atomically_consumes_and_destroys_material() {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let available = CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1::new_available(
        router_ab_ecdsa_derivation_presignature_pool_record(),
    )
    .expect("available SigningWorker pool lifecycle");
    assert!(matches!(available.lifecycle, PoolRecord::Available(_)));
    let persisted_available = serde_json::to_string(&available).expect("serialize available pool");
    let available: CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1 =
        serde_json::from_str(&persisted_available).expect("restore available pool");
    let reserved = available
        .reserve(
            request.request_digest().expect("prepare request digest"),
            request.signing_digest().expect("signing digest"),
            b64u(&[0x55; 32]),
            1_100,
            1_900,
        )
        .expect("reserve exact SigningWorker pool material");
    assert_eq!(reserved.lifecycle.revision().value(), 1);

    let (consumed, consumed_material) = match reserved
        .consume(
            request.request_digest().expect("prepare request digest"),
            1_200,
        )
        .expect("consume exact SigningWorker reservation")
    {
        CloudflareSigningWorkerEcdsaPoolConsumeDecisionV1::Consumed { record, material } => {
            (record, material)
        }
        CloudflareSigningWorkerEcdsaPoolConsumeDecisionV1::Burned(_) => {
            panic!("exact live reservation must consume")
        }
    };
    assert_eq!(consumed.lifecycle.revision().value(), 2);
    assert!(matches!(consumed.lifecycle, PoolRecord::Consumed(_)));
    assert_eq!(consumed_material.server_k_share32_b64u, b64u(&[0x11; 32]));
    let persisted_consumed =
        serde_json::to_string(&consumed).expect("serialize consumed SigningWorker record");
    assert!(!persisted_consumed.contains("server_k_share32_b64u"));
    assert!(!persisted_consumed.contains("server_sigma_share32_b64u"));
    serde_json::from_str::<CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1>(&persisted_consumed)
        .expect("restore consumed SigningWorker pool lifecycle");
}

#[test]
fn signing_worker_ecdsa_pool_lifecycle_burns_substituted_consume() {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let reserved = CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1::new_available(
        router_ab_ecdsa_derivation_presignature_pool_record(),
    )
    .expect("available SigningWorker pool lifecycle")
    .reserve(
        request.request_digest().expect("prepare request digest"),
        request.signing_digest().expect("signing digest"),
        b64u(&[0x55; 32]),
        1_100,
        1_900,
    )
    .expect("reserve exact SigningWorker pool material");

    let burned = match reserved
        .consume(digest(0xA7), 1_200)
        .expect("substituted consume produces a persistent burn")
    {
        CloudflareSigningWorkerEcdsaPoolConsumeDecisionV1::Burned(record) => record,
        CloudflareSigningWorkerEcdsaPoolConsumeDecisionV1::Consumed { .. } => {
            panic!("substituted request must not consume")
        }
    };
    let PoolRecord::Tombstone(terminal) = &burned.lifecycle else {
        panic!("substituted consume must be terminal");
    };
    assert_eq!(terminal.reason(), TombstoneReason::BindingRejected);
}

#[test]
fn signing_worker_ecdsa_pool_reservation_lease_is_capped_at_sixty_seconds() {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let capped = CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1::new_available(
        router_ab_ecdsa_derivation_presignature_pool_record_with_expiry(100_000),
    )
    .expect("long-lived available material")
    .reserve(
        request.request_digest().expect("request digest"),
        request.signing_digest().expect("signing digest"),
        b64u(&[0x55; 32]),
        1_100,
        100_000,
    )
    .expect("reserve with capped lease");
    let PoolRecord::Reserved(capped) = &capped.lifecycle else {
        panic!("reservation must persist");
    };
    assert_eq!(capped.lease_expires_at_ms(), 61_100);
    assert_eq!(capped.cleanup_deadline_ms(), 61_100);

    let request_limited = CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1::new_available(
        router_ab_ecdsa_derivation_presignature_pool_record_with_expiry(100_000),
    )
    .expect("long-lived available material")
    .reserve(
        request.request_digest().expect("request digest"),
        request.signing_digest().expect("signing digest"),
        b64u(&[0x55; 32]),
        1_100,
        50_000,
    )
    .expect("reserve with request-limited lease");
    let PoolRecord::Reserved(request_limited) = &request_limited.lifecycle else {
        panic!("reservation must persist");
    };
    assert_eq!(request_limited.lease_expires_at_ms(), 50_000);

    let overflow = CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1::new_available(
        router_ab_ecdsa_derivation_presignature_pool_record_with_expiry(u64::MAX),
    )
    .expect("maximum-lifetime available material")
    .reserve(
        request.request_digest().expect("request digest"),
        request.signing_digest().expect("signing digest"),
        b64u(&[0x55; 32]),
        u64::MAX - 1,
        u64::MAX,
    )
    .expect_err("reservation lease arithmetic must be checked");
    assert_eq!(overflow.code(), RouterAbProtocolErrorCode::InvalidTimeRange);
}

#[test]
fn signing_worker_ecdsa_pool_expiry_and_retirement_destroy_material() {
    let available = CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1::new_available(
        router_ab_ecdsa_derivation_presignature_pool_record(),
    )
    .expect("available material");
    assert!(available.clone().expire(1_999).is_err());
    let expired = available.expire(2_000).expect("expire available material");
    let PoolRecord::Tombstone(expired_tombstone) = &expired.lifecycle else {
        panic!("expired material must become terminal");
    };
    assert_eq!(expired_tombstone.reason(), TombstoneReason::MaterialExpired);
    let persisted = serde_json::to_string(&expired).expect("serialize expired record");
    assert!(!persisted.contains("server_k_share32_b64u"));
    assert!(!persisted.contains("server_sigma_share32_b64u"));

    let retired = CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1::new_available(
        router_ab_ecdsa_derivation_presignature_pool_record(),
    )
    .expect("available material")
    .retire(TombstoneReason::ActivationEpochRetired, 1_500)
    .expect("retire available material");
    let PoolRecord::Tombstone(retired_tombstone) = &retired.lifecycle else {
        panic!("retired material must become terminal");
    };
    assert_eq!(
        retired_tombstone.reason(),
        TombstoneReason::ActivationEpochRetired
    );
}

#[test]
fn signing_worker_ecdsa_pool_atomic_reducer_rejects_stale_reservation() {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let available = match apply_cloudflare_signing_worker_ecdsa_pool_command_v1(
        None,
        CloudflareSigningWorkerEcdsaPoolCommandV1::PutAvailable {
            material: router_ab_ecdsa_derivation_presignature_pool_record(),
        },
    )
    .expect("admit available SigningWorker material")
    {
        CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Available { record, stored } => {
            assert!(stored);
            record
        }
        _ => panic!("pool admission must return available material"),
    };
    let reserve = CloudflareSigningWorkerEcdsaPoolCommandV1::Reserve {
        scope: request.scope.clone(),
        server_presignature_id: "server-presignature-1".to_owned(),
        expected_revision: 0,
        request_digest: request.request_digest().expect("prepare request digest"),
        admitted_signing_digest: request.signing_digest().expect("signing digest"),
        signing_worker_rerandomization_contribution32_b64u: b64u(&[0x55; 32]),
        reserved_at_ms: 1_100,
        request_expires_at_ms: 1_900,
    };
    let reserved = match apply_cloudflare_signing_worker_ecdsa_pool_command_v1(
        Some(available.clone()),
        reserve.clone(),
    )
    .expect("first reservation wins")
    {
        CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Reserved { record } => record,
        _ => panic!("reserve command must return reserved material"),
    };
    let replayed = apply_cloudflare_signing_worker_ecdsa_pool_command_v1(
        Some(reserved.clone()),
        reserve.clone(),
    )
    .expect("an exact retry returns the durable reservation");
    assert_eq!(replayed.record(), &reserved);

    let mut substituted = reserve;
    if let CloudflareSigningWorkerEcdsaPoolCommandV1::Reserve { request_digest, .. } =
        &mut substituted
    {
        *request_digest = digest(0xA7);
    }
    let stale = apply_cloudflare_signing_worker_ecdsa_pool_command_v1(Some(reserved), substituted)
        .expect_err("stale revision cannot reserve twice");
    assert_eq!(
        stale.code(),
        RouterAbProtocolErrorCode::ReplayedLocalRequest
    );
}

pub(super) fn directly_reserved_ecdsa_pool_command() -> CloudflareSigningWorkerEcdsaPoolCommandV1 {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    CloudflareSigningWorkerEcdsaPoolCommandV1::PutReserved {
        material: router_ab_ecdsa_derivation_presignature_pool_record(),
        request_digest: request.request_digest().expect("prepare request digest"),
        admitted_signing_digest: request.signing_digest().expect("signing digest"),
        signing_worker_rerandomization_contribution32_b64u: b64u(&[0x55; 32]),
        reserved_at_ms: 1_100,
        request_expires_at_ms: 1_900,
    }
}

#[test]
fn signing_worker_ecdsa_pool_insert_collision_preserves_exact_available_record() {
    let material = router_ab_ecdsa_derivation_presignature_pool_record();
    let command = CloudflareSigningWorkerEcdsaPoolCommandV1::PutAvailable {
        material: material.clone(),
    };
    let existing = apply_cloudflare_signing_worker_ecdsa_pool_command_v1(None, command.clone())
        .expect("first admission")
        .record()
        .clone();
    let replay =
        apply_cloudflare_signing_worker_ecdsa_pool_command_v1(Some(existing.clone()), command)
            .expect("an exact available admission remains idempotent");
    assert_eq!(replay.record(), &existing);
    assert!(matches!(
        replay,
        CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Available { stored: false, .. }
    ));

    let mut substituted = material;
    substituted.server_k_share32_b64u = b64u(&[0x12; 32]);
    let error = apply_cloudflare_signing_worker_ecdsa_pool_command_v1(
        Some(existing),
        CloudflareSigningWorkerEcdsaPoolCommandV1::PutAvailable {
            material: substituted,
        },
    )
    .expect_err("an insertion collision must not substitute material");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::ReplayedLocalRequest
    );
}

#[test]
fn signing_worker_ecdsa_pool_direct_reservation_matches_existing_transition() {
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let expected = CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1::new_available(
        router_ab_ecdsa_derivation_presignature_pool_record(),
    )
    .expect("available material")
    .reserve(
        request.request_digest().expect("prepare request digest"),
        request.signing_digest().expect("signing digest"),
        b64u(&[0x55; 32]),
        1_100,
        1_900,
    )
    .expect("reserved material");
    let command = directly_reserved_ecdsa_pool_command();
    let wire = serde_json::to_string(&command).expect("command encoding");
    let decoded = serde_json::from_str(&wire).expect("command decoding");
    let outcome = apply_cloudflare_signing_worker_ecdsa_pool_command_v1(None, decoded)
        .expect("first persisted state can be reserved");
    outcome.validate().expect("valid reserved outcome");
    let CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1::Reserved { record } = outcome else {
        panic!("direct reservation must not publish available material");
    };
    assert_eq!(record, expected);
    assert_eq!(record.lifecycle.revision().value(), 1);
}

#[test]
fn signing_worker_ecdsa_pool_direct_reservation_cannot_replace_existing_identity() {
    let command = directly_reserved_ecdsa_pool_command();
    let reserved = apply_cloudflare_signing_worker_ecdsa_pool_command_v1(None, command.clone())
        .expect("initial reservation")
        .record()
        .clone();
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let consumed = match reserved
        .clone()
        .consume(request.request_digest().expect("request digest"), 1_200)
        .expect("consume exact reservation")
    {
        CloudflareSigningWorkerEcdsaPoolConsumeDecisionV1::Consumed { record, .. } => record,
        _ => panic!("exact reservation must be consumed"),
    };
    let tombstone = reserved
        .clone()
        .recover_after_crash(1_200)
        .expect("burn interrupted attempt");
    let available = CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1::new_available(
        router_ab_ecdsa_derivation_presignature_pool_record(),
    )
    .expect("available record");
    for existing in [available, reserved, consumed, tombstone] {
        let error =
            apply_cloudflare_signing_worker_ecdsa_pool_command_v1(Some(existing), command.clone())
                .expect_err("existing identity must never be overwritten or reopened");
        assert_eq!(
            error.code(),
            RouterAbProtocolErrorCode::ReplayedLocalRequest
        );
    }
}

#[test]
fn signing_worker_ecdsa_pool_direct_reservation_validates_deadlines_and_contribution() {
    let mut expired = directly_reserved_ecdsa_pool_command();
    if let CloudflareSigningWorkerEcdsaPoolCommandV1::PutReserved {
        request_expires_at_ms,
        ..
    } = &mut expired
    {
        *request_expires_at_ms = 1_100;
    }
    assert!(expired.validate().is_err());
    assert!(apply_cloudflare_signing_worker_ecdsa_pool_command_v1(None, expired).is_err());

    let mut malformed = directly_reserved_ecdsa_pool_command();
    if let CloudflareSigningWorkerEcdsaPoolCommandV1::PutReserved {
        signing_worker_rerandomization_contribution32_b64u,
        ..
    } = &mut malformed
    {
        *signing_worker_rerandomization_contribution32_b64u = b64u(&[0x55; 31]);
    }
    assert!(malformed.validate().is_err());
    assert!(apply_cloudflare_signing_worker_ecdsa_pool_command_v1(None, malformed).is_err());
}

#[test]
fn router_ab_ecdsa_derivation_presignature_pool_put_request_materializes_active_pool_record() {
    let request = router_ab_ecdsa_derivation_presignature_pool_put_request(2_000);
    let activation = router_ab_ecdsa_derivation_activation_request();
    let active_material = router_ab_ecdsa_derivation_server_material_record(&activation);

    let record = request
        .to_pool_record(
            active_signing_worker_state_for_router_ab_ecdsa_derivation(),
            &active_material,
            1_500,
        )
        .expect("pool put request materializes");

    assert_eq!(record.server_presignature_id, "server-presignature-1");
    assert_eq!(
        record.active_signing_worker_state,
        active_signing_worker_state_for_router_ab_ecdsa_derivation()
    );
    assert_eq!(record.server_big_r33_b64u, request.server_big_r33_b64u);
    assert_eq!(record.server_k_share32_b64u, request.server_k_share32_b64u);
    assert_eq!(
        record.server_sigma_share32_b64u,
        request.server_sigma_share32_b64u
    );
    assert_eq!(record.created_at_ms, 1_500);
    assert_eq!(record.expires_at_ms, 2_000);
}

#[test]
fn router_ab_ecdsa_derivation_presignature_pool_put_request_rejects_expired_or_mismatched_state() {
    let request = router_ab_ecdsa_derivation_presignature_pool_put_request(1_500);
    let activation = router_ab_ecdsa_derivation_activation_request();
    let active_material = router_ab_ecdsa_derivation_server_material_record(&activation);
    let expired = request
        .to_pool_record(
            active_signing_worker_state_for_router_ab_ecdsa_derivation(),
            &active_material,
            1_500,
        )
        .expect_err("exact expiry must fail");
    assert_eq!(
        expired.code(),
        RouterAbProtocolErrorCode::ExpiredLocalRequest
    );

    let valid_request = router_ab_ecdsa_derivation_presignature_pool_put_request(2_000);
    let mut mismatched_state = active_signing_worker_state_for_router_ab_ecdsa_derivation();
    mismatched_state.signing_worker.server_id = "server-other".to_owned();
    let mismatched = valid_request
        .to_pool_record(mismatched_state, &active_material, 1_500)
        .expect_err("scope and active state mismatch must fail");
    assert_eq!(
        mismatched.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );

    let mut mismatched_public_key = router_ab_ecdsa_derivation_presignature_pool_put_request(2_000);
    mismatched_public_key
        .scope
        .public_identity
        .threshold_public_key33_b64u = b64u(&ecdsa_derivation_client_share_public_key33());
    let mismatched = mismatched_public_key
        .to_pool_record(
            active_signing_worker_state_for_router_ab_ecdsa_derivation(),
            &active_material,
            1_500,
        )
        .expect_err("scope public key must match active SigningWorker material");
    assert_eq!(
        mismatched.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn router_ab_ecdsa_derivation_prepared_bundle_rejects_private_record_drift() {
    let activation = router_ab_ecdsa_derivation_activation_request();
    let material = router_ab_ecdsa_derivation_server_material_record(&activation);
    let request = router_ab_ecdsa_derivation_digest_signing_request();
    let admitted = admitted_router_ab_ecdsa_derivation_digest_signing_request(request.clone());
    let materialized =
        CloudflareSigningWorkerMaterializedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
            admitted,
            active_signing_worker_state_for_router_ab_ecdsa_derivation(),
            material,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect("materialized Router A/B ECDSA derivation prepare request");
    let response = RouterAbEcdsaDerivationEvmDigestSigningPrepareResponseV1::new_for_request(
        &request,
        request.client_presignature_id.clone(),
        b64u(&router_ab_ecdsa_derivation_presignature_big_r33(0x42)),
        b64u(&[0x55; 32]),
        TEST_ACTIVATED_AT_MS + 1,
    )
    .expect("prepare response");
    let record = CloudflareSigningWorkerEcdsaPresignatureRecordV1::new(
        active_signing_worker_state_for_router_ab_ecdsa_derivation(),
        request.client_presignature_id.clone(),
        digest(0x91),
        request.signing_digest().expect("signing digest"),
        b64u(&router_ab_ecdsa_derivation_presignature_big_r33(0x42)),
        b64u(&[0x55; 32]),
        b64u(&[0x33; 32]),
        b64u(&[0x44; 32]),
        TEST_ACTIVATED_AT_MS + 1,
        request.expires_at_ms,
    )
    .expect("drifted presignature record");

    let err = CloudflareSigningWorkerRouterAbEcdsaDerivationEvmDigestPreparedV1::new(
        response,
        record,
        &materialized,
    )
    .expect_err("record drift rejects");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn router_ab_ecdsa_derivation_evm_digest_finalize_private_handler_consumes_presignature_record() {
    let activation = router_ab_ecdsa_derivation_activation_request();
    let material = router_ab_ecdsa_derivation_server_material_record(&activation);
    let finalize_request = router_ab_ecdsa_derivation_digest_signing_finalize_request();
    let admitted =
        admitted_router_ab_ecdsa_derivation_digest_finalize_request(finalize_request.clone());
    let response =
        handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_private_request_v1(
            &TestRouterAbEcdsaDerivationEvmDigestFinalizeHandler,
            TEST_ACTIVATED_AT_MS + 1,
            admitted,
            active_signing_worker_state_for_router_ab_ecdsa_derivation(),
            material,
            router_ab_ecdsa_derivation_presignature_record(),
        )
        .expect("Router A/B ECDSA derivation digest finalize response");

    response
        .validate_for_request(&finalize_request)
        .expect("response validates against finalize request");
    assert_eq!(response.signature65_b64u, b64u(&[0x99; 65]));
}

#[test]
fn router_ab_ecdsa_derivation_production_finalize_handler_returns_real_recoverable_signature() {
    let activation = router_ab_ecdsa_derivation_activation_request();
    let material = router_ab_ecdsa_derivation_server_material_record(&activation);
    let ecdsa_context = cloudflare_router_ab_ecdsa_derivation_stable_key_context_v1(
        &activation.pending.registration.context,
    )
    .expect("Router A/B ECDSA derivation context");
    let (_relayer_role_share, identity) = derive_relayer_share_for_client_public(
        &ecdsa_context,
        *material.output_material.as_bytes(),
        &ecdsa_derivation_client_share_public_key33(),
        activation.client_activation.client_share_retry_counter,
    )
    .expect("relayer role share");
    let client_additive_share32 = ecdsa_scalar_one_be32();
    let (
        server_big_r33,
        server_k_share32,
        server_sigma_share32,
        client_k_share32,
        client_sigma_share32,
    ) = drive_ecdsa_presignature_pair(
        &client_additive_share32,
        &_relayer_role_share.x_relayer32,
        &identity.threshold_public_key33,
    );
    let client_rerandomization_contribution32 = [0x60; 32];
    let signing_worker_rerandomization_contribution32 = [0x01; 32];
    let entropy32 = [0x61; 32];
    let base_prepare_request = router_ab_ecdsa_derivation_digest_signing_request();
    let prepare_request = RouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
        base_prepare_request.scope.clone(),
        base_prepare_request.request_id.clone(),
        base_prepare_request.operation_id.clone(),
        base_prepare_request.operation_digests.clone(),
        base_prepare_request.authorization.clone(),
        base_prepare_request.material_activation.clone(),
        "server-presignature-real-1",
        base_prepare_request.expires_at_ms,
        base_prepare_request.signing_digest_b64u.clone(),
        b64u(&router_ab_ecdsa_rerandomization_client_commitment_v1(
            client_rerandomization_contribution32,
        )),
    )
    .expect("real Router A/B ECDSA derivation prepare request");
    assert_eq!(
        prepare_request
            .scope
            .public_identity
            .threshold_public_key33_b64u,
        b64u(&identity.threshold_public_key33)
    );
    let client_material =
        ClientPresignMaterial::from_bytes(server_big_r33, client_k_share32, client_sigma_share32)
            .expect("client presign material");
    let client_online_input = OnlineClientInput::new(
        identity.threshold_public_key33,
        server_big_r33,
        *prepare_request
            .signing_digest()
            .expect("signing digest")
            .as_bytes(),
        entropy32,
    )
    .expect("client online input");
    let client_signature_share32 = compute_client_signature_share(
        client_material
            .reserve()
            .commit(client_online_input)
            .expect("committed client presign material"),
    )
    .expect("client ECDSA signature share");
    let finalize_request = RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1::new(
        prepare_request.scope.clone(),
        prepare_request.request_id.clone(),
        prepare_request.operation_id.clone(),
        prepare_request.operation_digests.clone(),
        prepare_request.authorization.clone(),
        prepare_request.material_activation.clone(),
        prepare_request.expires_at_ms,
        prepare_request.signing_digest_b64u.clone(),
        "server-presignature-real-1",
        b64u(&client_signature_share32),
        b64u(&client_rerandomization_contribution32),
    )
    .expect("Router A/B ECDSA derivation finalize request");
    let presignature_record = CloudflareSigningWorkerEcdsaPresignatureRecordV1::new(
        active_signing_worker_state_for_router_ab_ecdsa_derivation(),
        "server-presignature-real-1",
        prepare_request.request_digest().expect("request digest"),
        prepare_request.signing_digest().expect("signing digest"),
        b64u(&server_big_r33),
        b64u(&signing_worker_rerandomization_contribution32),
        b64u(&server_k_share32),
        b64u(&server_sigma_share32),
        TEST_ACTIVATED_AT_MS + 1,
        prepare_request.expires_at_ms,
    )
    .expect("real Router A/B ECDSA derivation presignature record");
    let response =
        handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_private_request_v1(
            &CloudflareRoleSeparatedRouterAbEcdsaDerivationEvmDigestFinalizeHandlerV1,
            TEST_ACTIVATED_AT_MS + 2,
            admitted_router_ab_ecdsa_derivation_digest_finalize_request(finalize_request.clone()),
            active_signing_worker_state_for_router_ab_ecdsa_derivation(),
            material,
            presignature_record,
        )
        .expect("production Router A/B ECDSA derivation finalize response");

    response
        .validate_for_request(&finalize_request)
        .expect("production response binds finalize request");
    assert_ne!(response.signature65_b64u, b64u(&[0x99; 65]));
}

#[test]
fn router_ab_ecdsa_derivation_materialized_finalize_rejects_presignature_drift() {
    let activation = router_ab_ecdsa_derivation_activation_request();
    let material = router_ab_ecdsa_derivation_server_material_record(&activation);
    let finalize_request = router_ab_ecdsa_derivation_digest_signing_finalize_request();
    let admitted = admitted_router_ab_ecdsa_derivation_digest_finalize_request(finalize_request);
    let mut presignature = router_ab_ecdsa_derivation_presignature_record();
    presignature.request_digest = digest(0x92);

    let err =
        CloudflareSigningWorkerMaterializedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1::new(
            admitted,
            active_signing_worker_state_for_router_ab_ecdsa_derivation(),
            material,
            presignature,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect_err("presignature drift rejects");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn router_ab_ecdsa_derivation_normal_signing_request_rejects_active_state_drift() {
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
    let mut active_state = cloudflare_active_signing_worker_state_from_activation_request_v1(
        &activation
            .to_recipient_proof_bundle_activation_request()
            .expect("generic activation request"),
        activation.material_activation.clone(),
        "router-ab-ecdsa-derivation-material",
        TEST_ACTIVATED_AT_MS,
    )
    .expect("Router A/B ECDSA derivation active state");
    active_state.material_activation.activation_id = "different-ecdsa-key".to_owned();
    let material_activation = router_ab_ecdsa_derivation_material_activation(&scope);
    let request = RouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
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
    .expect("Router A/B ECDSA derivation normal-signing request");
    let admitted = admitted_router_ab_ecdsa_derivation_digest_signing_request(request);

    let err =
        CloudflareSigningWorkerMaterializedRouterAbEcdsaDerivationEvmDigestSigningRequestV1::new(
            admitted,
            active_state,
            material,
            TEST_ACTIVATED_AT_MS + 1,
        )
        .expect_err("active state drift rejects");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn router_ab_ecdsa_derivation_normal_signing_scope_rejects_public_identity_drift() {
    let activation = router_ab_ecdsa_derivation_activation_request();
    let material = router_ab_ecdsa_derivation_server_material_record(&activation);
    let receipt = cloudflare_router_ab_ecdsa_derivation_activation_receipt_from_material_v1(
        &activation,
        &material,
        TEST_ACTIVATED_AT_MS,
    )
    .expect("Router A/B ECDSA derivation activation receipt");
    let mut scope =
        cloudflare_router_ab_ecdsa_derivation_normal_signing_scope_from_activation_receipt_v1(
            &receipt,
            ROUTER_AB_ECDSA_DERIVATION_WALLET_ID,
            ROUTER_AB_ECDSA_DERIVATION_THRESHOLD_KEY_ID,
            ROUTER_AB_ECDSA_DERIVATION_SIGNING_ROOT_ID,
            ROUTER_AB_ECDSA_DERIVATION_SIGNING_ROOT_VERSION,
            router_ab_ecdsa_derivation_material_activation_for_epoch(&receipt.activation_epoch),
        )
        .expect("Router A/B ECDSA derivation normal-signing scope");
    scope.public_identity.ethereum_address20_b64u = b64u(&[0x55; 20]);
    let active_state = cloudflare_active_signing_worker_state_from_activation_request_v1(
        &activation
            .to_recipient_proof_bundle_activation_request()
            .expect("generic activation request"),
        activation.material_activation.clone(),
        "router-ab-ecdsa-derivation-material",
        TEST_ACTIVATED_AT_MS,
    )
    .expect("Router A/B ECDSA derivation active state");

    let err = validate_cloudflare_router_ab_ecdsa_derivation_normal_signing_active_material_v1(
        &scope,
        &active_state,
        &material,
    )
    .expect_err("identity drift must fail");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn router_worker_runtime_rejects_expired_public_request() {
    let runtime = CloudflareRouterWorkerRuntimeV1::new(
        CloudflareRouterBindingsV1::new(
            router_admission_bindings(),
            peer(CloudflareWorkerRoleV1::DeriverA, "DERIVER_A"),
            peer(CloudflareWorkerRoleV1::DeriverB, "DERIVER_B"),
            peer(CloudflareWorkerRoleV1::SigningWorker, "SIGNING_WORKER"),
            issuer_verifying_keys(),
        )
        .expect("router bindings"),
    )
    .expect("router runtime");
    let err = runtime
        .public_request_admission_plan_at(
            2_000,
            ecdsa_threshold_prf_request(2_000),
            trusted_admission(
                ExpensiveWorkGateDecisionV1::accepted("gate-request-1").expect("accepted"),
            ),
        )
        .expect_err("expired request must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ExpiredLocalRequest);
}
