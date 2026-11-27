//! Role bindings and runtime, SigningWorker prepare and finalize, step-up and preloaded signer host tests.

use super::*;

#[test]
fn deriver_a_bindings_accept_role_private_secrets() {
    let bindings = CloudflareDeriverABindingsV1::new(
        deriver_a_envelope_hpke_decrypt_key(),
        peer(CloudflareWorkerRoleV1::DeriverB, "DERIVER_B"),
        issuer_verifying_keys(),
    )
    .expect("signer a bindings");
    let startup = CloudflareWorkerBindingsV1::deriver_a(bindings).expect("signer a startup");

    assert_eq!(startup.worker_role(), CloudflareWorkerRoleV1::DeriverA);
}

#[test]
fn signing_worker_bindings_accept_presign_session_scope() {
    let bindings = CloudflareSigningWorkerBindingsV1::new(
        signing_worker_presign_session_binding(),
        server_output_hpke_decrypt_key(),
    )
    .expect("signing worker bindings");
    let startup =
        CloudflareWorkerBindingsV1::signing_worker(bindings).expect("signing worker startup");

    assert_eq!(startup.worker_role(), CloudflareWorkerRoleV1::SigningWorker);
}

#[test]
fn deriver_a_bindings_reject_b_envelope_decrypt_key() {
    let err = CloudflareDeriverABindingsV1::new(
        deriver_b_envelope_hpke_decrypt_key(),
        peer(CloudflareWorkerRoleV1::DeriverB, "DERIVER_B"),
        issuer_verifying_keys(),
    )
    .expect_err("signer a must reject signer b decrypt key");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ForbiddenLocalBinding);
}

#[test]
fn deriver_b_bindings_accept_role_private_secrets() {
    let bindings = CloudflareDeriverBBindingsV1::new(
        deriver_b_envelope_hpke_decrypt_key(),
        peer(CloudflareWorkerRoleV1::DeriverA, "DERIVER_A"),
        issuer_verifying_keys(),
    )
    .expect("signer b bindings");
    let startup = CloudflareWorkerBindingsV1::deriver_b(bindings).expect("signer b startup");

    assert_eq!(startup.worker_role(), CloudflareWorkerRoleV1::DeriverB);
}

#[test]
fn deriver_b_bindings_reject_a_envelope_decrypt_key() {
    let err = CloudflareDeriverBBindingsV1::new(
        deriver_a_envelope_hpke_decrypt_key(),
        peer(CloudflareWorkerRoleV1::DeriverA, "DERIVER_A"),
        issuer_verifying_keys(),
    )
    .expect_err("signer b must reject signer a decrypt key");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ForbiddenLocalBinding);
}

#[test]
fn deriver_a_runtime_exposes_role_private_secrets_and_peer() {
    let runtime = CloudflareDeriverAWorkerRuntimeV1::new(
        CloudflareDeriverABindingsV1::new(
            deriver_a_envelope_hpke_decrypt_key(),
            peer(CloudflareWorkerRoleV1::DeriverB, "DERIVER_B"),
            issuer_verifying_keys(),
        )
        .expect("signer a bindings"),
    )
    .expect("signer a runtime");
    assert_eq!(
        runtime.deriver_b_peer().peer_role,
        CloudflareWorkerRoleV1::DeriverB
    );
    assert_eq!(runtime.envelope_decrypt_key().current.role, Role::SignerA);
}

#[test]
fn deriver_b_runtime_exposes_role_private_secrets_and_peer() {
    let runtime = CloudflareDeriverBWorkerRuntimeV1::new(
        CloudflareDeriverBBindingsV1::new(
            deriver_b_envelope_hpke_decrypt_key(),
            peer(CloudflareWorkerRoleV1::DeriverA, "DERIVER_A"),
            issuer_verifying_keys(),
        )
        .expect("signer b bindings"),
    )
    .expect("signer b runtime");
    assert_eq!(
        runtime.deriver_a_peer().peer_role,
        CloudflareWorkerRoleV1::DeriverA
    );
    assert_eq!(runtime.envelope_decrypt_key().current.role, Role::SignerB);
}

#[test]
fn signing_worker_production_v2_prepare_returns_router_admitted_public_material() {
    let request = normal_signing_v2_prepare_request(2_000);
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let admission = CloudflareRouterNormalSigningPrepareAdmissionCandidateV2::from_prepare_request(
        &wallet_session,
        &request,
        1_000,
    )
    .expect("normal signing v2 admission");
    let trusted_admission = CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        admission
            .to_v1_trusted_metadata()
            .expect("v1 trusted metadata"),
        ExpensiveWorkGateDecisionV1::accepted("gate-request-1").expect("accepted"),
    )
    .expect("trusted admission");
    let admitted = CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2::new(
        1,
        signing_wallet_scope("account.near"),
        request.scope.clone(),
        request.expires_at_ms,
        admission.clone(),
        trusted_admission,
    )
    .expect("admitted v2 prepare");
    let active_signing_worker = active_signing_worker_state_for_normal_signing();
    let material = CloudflareServerOutputMaterialRecordV1::new(
        active_signing_worker.activation_transcript_digest,
        OpenedShareKind::XServerBase,
        Role::Server,
        "server-a",
        CloudflareSecretMaterial32V1::new(scalar_bytes(5)),
    )
    .expect("server output material");

    let prepared = handle_cloudflare_signing_worker_normal_signing_prepare_private_request_v2(
        &CloudflareEd25519YaoNormalSigningHandlerV1,
        1_500,
        admitted,
        active_signing_worker,
        material,
    )
    .expect("production v2 prepare");

    assert_eq!(prepared.response.scope, request.scope);
    assert_eq!(
        prepared.response.signing_payload_digest,
        admission.signing_payload_digest
    );
    assert_eq!(
        prepared.response.round1_binding_digest,
        request.round1_binding_digest().expect("round1 binding")
    );
    assert_eq!(
        prepared.record.admitted_signing_digest,
        admission.admitted_signing_digest
    );
    assert_eq!(
        prepared.record.round1_binding_digest,
        request.round1_binding_digest().expect("round1 binding")
    );
}

#[test]
fn signing_worker_production_v2_finalize_signs_router_admitted_digest_from_round1_record() {
    let (
        client_scalar,
        server_scalar,
        client_verifying_share,
        server_verifying_share,
        group_public_key,
        client_round1,
        server_round1,
    ) = normal_signing_frost_fixture();
    let prepare_request = normal_signing_v2_prepare_request(2_000);
    let material = prepare_request
        .admission_material()
        .expect("admission material");
    let client_signature_share = normal_signing_client_signature_share(
        &client_scalar,
        &group_public_key,
        &client_round1,
        &server_round1,
        material.admitted_signing_digest.as_bytes(),
    );
    let prepare_binding = RouterAbEd25519NormalSigningPrepareBindingV2::new(
        "server-round1/sign-request-1",
        prepare_request
            .round1_binding_digest()
            .expect("round1 binding"),
        material.intent_digest,
        material.signing_payload_digest,
    )
    .expect("prepare binding");
    let protocol = RouterAbEd25519NormalSigningFinalizeProtocolV2::Ed25519TwoPartyFrostFinalizeV1(
        RouterAbEd25519TwoPartyFrostFinalizeProtocolV2::new(
            NormalSigningEd25519TwoPartyFrostCommitmentsV1::new(
                client_round1.commitments_wire.hiding.clone(),
                client_round1.commitments_wire.binding.clone(),
            )
            .expect("client commitments"),
            server_round1.commitments.clone(),
            b64u(&client_verifying_share),
            b64u(&server_verifying_share),
            client_signature_share,
        )
        .expect("v2 finalize protocol"),
    );
    let request = RouterAbEd25519NormalSigningFinalizeRequestV2::new(
        normal_signing_scope(),
        2_000,
        prepare_binding,
        protocol,
    )
    .expect("v2 finalize request");
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let finalize_admission =
        CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::from_finalize_request(
            &wallet_session,
            &request,
            1_000,
        )
        .expect("v2 finalize admission");
    let trusted_admission = CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        finalize_admission
            .to_v1_trusted_metadata()
            .expect("v1 trusted metadata"),
        ExpensiveWorkGateDecisionV1::accepted("gate-request-1").expect("accepted"),
    )
    .expect("trusted admission");
    let active_signing_worker =
        active_signing_worker_state_for_normal_signing_public_key(group_public_key);
    let material_record = CloudflareServerOutputMaterialRecordV1::new(
        active_signing_worker.activation_transcript_digest,
        OpenedShareKind::XServerBase,
        Role::Server,
        "server-a",
        CloudflareSecretMaterial32V1::new(server_scalar),
    )
    .expect("server output material");
    let server_round1_record = CloudflareSigningWorkerRound1RecordV1::new(
        active_signing_worker.clone(),
        "server-round1/sign-request-1",
        request.round1_binding_digest(),
        request.intent_digest(),
        request.signing_payload_digest(),
        material.admitted_signing_digest,
        server_round1,
        1_000,
        2_000,
    )
    .expect("server round1 record");
    let authorized_operation_identity =
        CloudflareSigningWorkerAuthorizedOperationIdentityV1::ReusableWalletSession {
            authorization_id: "authorization-1".to_owned(),
            wallet_session_id: wallet_session.wallet_session_id.clone(),
            authorized_operation_id: "authorized-operation-1".to_owned(),
            operation_id: "operation-1".to_owned(),
            operation_fingerprint_digest: "fingerprint-1".to_owned(),
        };
    let admitted = CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2::new(
        1,
        signing_wallet_scope("account.near"),
        request.clone(),
        finalize_admission,
        trusted_admission,
        authorized_operation_identity,
        CloudflareSigningWorkerNormalSigningEffectClaimV1::ReusableWalletSession {
            claim: CloudflareSigningWorkerReusableWalletSessionEffectClaimV1::new(
                "authorization-1",
                wallet_session.wallet_session_id.clone(),
                "authorized-operation-1",
                "operation-1",
                "fingerprint-1",
            )
            .expect("stable effect claim"),
        },
    )
    .expect("admitted v2 finalize");

    let mut intent_drift_record = server_round1_record.clone();
    intent_drift_record.intent_digest = digest(0xa1);
    let err = CloudflareSigningWorkerMaterializedNormalSigningFinalizeRequestV2::new(
        admitted.clone(),
        active_signing_worker.clone(),
        material_record.clone(),
        intent_drift_record,
        1_500,
    )
    .expect_err("finalize intent must match the persisted prepare record");
    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );

    let mut payload_drift_record = server_round1_record.clone();
    payload_drift_record.signing_payload_digest = digest(0xa2);
    let err = CloudflareSigningWorkerMaterializedNormalSigningFinalizeRequestV2::new(
        admitted.clone(),
        active_signing_worker.clone(),
        material_record.clone(),
        payload_drift_record,
        1_500,
    )
    .expect_err("finalize signing payload must match the persisted prepare record");
    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );

    let response = handle_cloudflare_signing_worker_normal_signing_finalize_private_request_v2(
        &CloudflareEd25519YaoNormalSigningHandlerV1,
        1_500,
        admitted,
        active_signing_worker,
        material_record,
        server_round1_record,
    )
    .expect("production v2 finalize response");

    response.validate().expect("v2 finalize response validates");
    assert_eq!(response.scope, request.scope);
    assert_eq!(
        response.signing_payload_digest,
        material.signing_payload_digest
    );
    let verifying_key = VerifyingKey::from_bytes(&group_public_key).expect("fixture verifying key");
    let signature: [u8; 64] = response
        .signature
        .as_bytes()
        .try_into()
        .expect("64-byte signature");
    verifying_key
        .verify(
            material.admitted_signing_digest.as_bytes(),
            &Ed25519Signature::from_bytes(&signature),
        )
        .expect("production v2 handler signature verifies over admitted digest");
}

#[test]
fn normal_signing_step_up_admission_derives_the_exact_authorized_operation() {
    let mut request = normal_signing_v2_finalize_request(2_000);
    request.scope.authorization =
        NormalSigningAuthorizationV1::operation_step_up().expect("step-up scope authorization");
    request.validate().expect("step-up finalize request");
    let admission = CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::new(
        "org-1",
        "project-1",
        "dev",
        request.scope.account_id.clone(),
        "principal-1",
        CloudflareRouterNormalSigningAuthorizationV2::operation_step_up(
            "authorization-session-1",
            "evidence-set-digest-1",
        )
        .expect("step-up admission authorization"),
        request.scope.signing_worker_id.clone(),
        request.scope.request_id.clone(),
        request.intent_digest(),
        request.signing_payload_digest(),
        request.round1_binding_digest(),
        digest(0x90),
        request.expires_at_ms,
    )
    .expect("step-up admission");
    let trusted_admission = CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        admission
            .to_v1_trusted_metadata()
            .expect("trusted metadata"),
        ExpensiveWorkGateDecisionV1::accepted(request.scope.request_id.clone()).expect("accepted"),
    )
    .expect("trusted admission");
    let authorized_operation_identity =
        CloudflareSigningWorkerAuthorizedOperationIdentityV1::OperationStepUp {
            authorization_session_id: "authorization-session-1".to_owned(),
            authorized_operation_id: "authorized-operation-1".to_owned(),
            operation_id: "operation-1".to_owned(),
            operation_fingerprint_digest: "fingerprint-1".to_owned(),
        };
    let admitted = CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2::new(
        1,
        signing_wallet_scope("account.near"),
        request,
        admission,
        trusted_admission,
        authorized_operation_identity,
        CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
            authorization_session_id: "authorization-session-1".to_owned(),
            authorized_operation_id: "authorized-operation-1".to_owned(),
            operation_id: "operation-1".to_owned(),
            operation_fingerprint_digest: "fingerprint-1".to_owned(),
        },
    )
    .expect("admitted step-up finalize");

    assert_eq!(
        admitted.effect_claim,
        CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
            authorization_session_id: "authorization-session-1".to_owned(),
            authorized_operation_id: "authorized-operation-1".to_owned(),
            operation_id: "operation-1".to_owned(),
            operation_fingerprint_digest: "fingerprint-1".to_owned(),
        }
    );
    let operation_key = admitted.effect_operation_key().expect("operation key");
    assert!(operation_key.contains("session-1"));
    assert!(!operation_key.contains("authorized-operation-1"));
}

#[test]
fn signing_worker_effect_claim_rejects_authorized_operation_identity_substitution() {
    let claim = CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
        authorization_session_id: "authorization-session-1".to_owned(),
        authorized_operation_id: "authorized-operation-1".to_owned(),
        operation_id: "operation-1".to_owned(),
        operation_fingerprint_digest: "fingerprint-1".to_owned(),
    };
    let matching = CloudflareSigningWorkerAuthorizedOperationIdentityV1::OperationStepUp {
        authorization_session_id: "authorization-session-1".to_owned(),
        authorized_operation_id: "authorized-operation-1".to_owned(),
        operation_id: "operation-1".to_owned(),
        operation_fingerprint_digest: "fingerprint-1".to_owned(),
    };
    claim
        .validate_for_authorized_operation_identity(&matching)
        .expect("matching operation identity");

    let substituted = CloudflareSigningWorkerAuthorizedOperationIdentityV1::OperationStepUp {
        authorization_session_id: "authorization-session-1".to_owned(),
        authorized_operation_id: "authorized-operation-substituted".to_owned(),
        operation_id: "operation-1".to_owned(),
        operation_fingerprint_digest: "fingerprint-1".to_owned(),
    };
    let error = claim
        .validate_for_authorized_operation_identity(&substituted)
        .expect_err("substituted authorized operation identity must fail closed");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn signing_worker_reusable_identity_rejects_pairwise_authorization_alias() {
    let error = CloudflareSigningWorkerReusableWalletSessionEffectClaimV1::new(
        "wallet-session-1",
        "wallet-session-1",
        "authorized-operation-1",
        "operation-1",
        "fingerprint-1",
    )
    .expect_err("authorization and Wallet Session ids must remain distinct");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let identity = CloudflareSigningWorkerAuthorizedOperationIdentityV1::ReusableWalletSession {
        authorization_id: "wallet-session-1".to_owned(),
        wallet_session_id: "wallet-session-1".to_owned(),
        authorized_operation_id: "authorized-operation-1".to_owned(),
        operation_id: "operation-1".to_owned(),
        operation_fingerprint_digest: "fingerprint-1".to_owned(),
    };
    let error = identity
        .validate()
        .expect_err("accepted worker identity must reject authorization alias");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let error = CloudflareRouterNormalSigningAuthorizationV2::reusable_wallet_session(
        "wallet-session-1",
        "wallet-session-1",
    )
    .expect_err("normal-signing authorization must reject Wallet Session alias");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn normal_signing_finalize_boundary_extracts_reusable_authorized_operation() {
    let request = normal_signing_v2_finalize_request(2_000);
    let mut body = serde_json::to_value(&request)
        .expect("finalize request JSON")
        .as_object()
        .expect("finalize request object")
        .clone();
    body.insert(
        "authorized_operation".to_owned(),
        serde_json::json!({
            "binding": {
                "kind": "reusable_wallet_session",
                "authorization_id": "authorization-1",
                "wallet_session_id": "wallet-session-1",
                "quota_id": "quota-1"
            },
            "authorized_operation": {
                "kind": "reusable_wallet_session_authorized_operation_v1",
                "authorized_operation_id": "authorized-operation-1",
                "operation_id": "operation-1",
                "capability_kind": "near_ed25519_mpc_signing",
                "operation_kind": "near.sign_transaction",
                "lane_digest_b64u": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0x11; 32]),
                "intent_digest_b64u": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(request.intent_digest().as_bytes()),
                "display_digest_b64u": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0x22; 32]),
                "operation_fingerprint_digest": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0x33; 32])
            }
        }),
    );
    let bytes = serde_json::to_vec(&body).expect("authorized finalize JSON");
    let (parsed_request, authorized_operation) =
        parse_cloudflare_router_authorized_ed25519_finalize_request_v2_json(&bytes)
            .expect("authorized finalize request");

    assert_eq!(parsed_request, request);

    let mut aliased_body = body.clone();
    aliased_body["authorized_operation"]["binding"]["authorization_id"] =
        serde_json::json!("wallet-session-1");
    let error = parse_cloudflare_router_authorized_ed25519_finalize_request_v2_json(
        &serde_json::to_vec(&aliased_body).expect("aliased authorized finalize JSON"),
    )
    .expect_err("authorization and Wallet Session ids must remain distinct");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let mut legacy_body = body.clone();
    let mut legacy_accepted = legacy_body
        .remove("authorized_operation")
        .expect("authorized operation object");
    let legacy_operation = legacy_accepted
        .as_object_mut()
        .expect("accepted authorization object")
        .remove("authorized_operation")
        .expect("nested authorized operation field");
    legacy_accepted
        .as_object_mut()
        .expect("accepted authorization object")
        .insert("claim".to_owned(), legacy_operation);
    legacy_body.insert("authorized_operation".to_owned(), legacy_accepted);
    let error = parse_cloudflare_router_authorized_ed25519_finalize_request_v2_json(
        &serde_json::to_vec(&legacy_body).expect("legacy nested operation request JSON"),
    )
    .expect_err("legacy nested operation field must be rejected");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );

    let authorization = CloudflareRouterNormalSigningAuthorizationV2::reusable_wallet_session(
        "authorization-1",
        "wallet-session-1",
    )
    .expect("reusable authorization");
    authorized_operation
        .authorized_operation
        .validate_for_finalize_request(&parsed_request, &authorization)
        .expect("authorized operation matches finalize request");
}

#[test]
fn normal_signing_finalize_boundary_extracts_verified_step_up_authorized_operation() {
    let mut request = normal_signing_v2_finalize_request(2_000);
    request.scope.authorization =
        NormalSigningAuthorizationV1::operation_step_up().expect("operation step-up");
    let mut body = serde_json::to_value(&request)
        .expect("operation-step-up finalize JSON")
        .as_object()
        .expect("operation-step-up finalize object")
        .clone();
    body.insert(
        "authorized_operation".to_owned(),
        serde_json::json!({
            "binding": {
                "kind": "operation_step_up",
                "ownership_generation": 1,
                "authorization_session_id": "authorization-session-1",
                "org_id": "org-1",
                "project_id": "project-1",
                "environment": "dev",
                "project_environment_id": "project-environment-1",
                "subject_id": "user-1",
                "account_id": "wallet-1"
            },
            "authorized_operation": {
                "kind": "verified_step_up_authorized_operation_v1",
                "authorization_session_id": "authorization-session-1",
                "evidence_set_digest": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0x55; 32]),
                "authorized_operation_id": "authorized-operation-1",
                "operation_id": "operation-1",
                "capability_kind": "near_ed25519_mpc_signing",
                "operation_kind": "near.sign_transaction",
                "lane_digest_b64u": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0x11; 32]),
                "intent_digest_b64u": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(request.intent_digest().as_bytes()),
                "display_digest_b64u": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0x22; 32]),
                "operation_fingerprint_digest": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0x33; 32])
            }
        }),
    );
    let bytes = serde_json::to_vec(&body).expect("authorized operation-step-up finalize JSON");

    let (parsed_request, authorized_operation) =
        parse_cloudflare_router_authorized_ed25519_finalize_request_v2_json(&bytes)
            .expect("operation-step-up finalize request");

    assert_eq!(parsed_request, request);
    let authorization = CloudflareRouterNormalSigningAuthorizationV2::operation_step_up(
        "authorization-session-1",
        "evidence-set-digest-1",
    )
    .expect("operation-step-up authorization");
    authorized_operation
        .authorized_operation
        .validate_for_finalize_request(&parsed_request, &authorization)
        .expect("step-up authorized operation matches finalize request");
}

#[test]
fn normal_signing_finalize_admission_rejects_operation_step_up_from_wallet_session() {
    let mut request = normal_signing_v2_finalize_request(2_000);
    request.scope.authorization =
        NormalSigningAuthorizationV1::operation_step_up().expect("operation step-up");
    let wallet_session = normal_signing_v2_wallet_session(3_000);

    let error = CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::from_finalize_request(
        &wallet_session,
        &request,
        1_000,
    )
    .expect_err("Wallet Session bearer cannot authorize operation-step-up signing");

    assert_eq!(error.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn normal_signing_effect_digest_binds_policy_principal_capability_and_terminal_failure() {
    let request = normal_signing_v2_finalize_request(2_000);
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let admission =
        CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::from_finalize_request(
            &wallet_session,
            &request,
            1_000,
        )
        .expect("finalize admission");
    let trusted = CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        admission
            .to_v1_trusted_metadata()
            .expect("trusted metadata"),
        ExpensiveWorkGateDecisionV1::accepted("gate-request-1").expect("accepted"),
    )
    .expect("trusted admission");
    let effect_claim = CloudflareSigningWorkerNormalSigningEffectClaimV1::ReusableWalletSession {
        claim: CloudflareSigningWorkerReusableWalletSessionEffectClaimV1::new(
            "authorization-1",
            wallet_session.wallet_session_id.clone(),
            "authorized-operation-1",
            "operation-1",
            "fingerprint-1",
        )
        .expect("stable effect claim"),
    };
    let effect_identity =
        CloudflareSigningWorkerAuthorizedOperationIdentityV1::ReusableWalletSession {
            authorization_id: "authorization-1".to_owned(),
            wallet_session_id: wallet_session.wallet_session_id.clone(),
            authorized_operation_id: "authorized-operation-1".to_owned(),
            operation_id: "operation-1".to_owned(),
            operation_fingerprint_digest: "fingerprint-1".to_owned(),
        };
    let admitted = CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2::new(
        1,
        signing_wallet_scope("account.near"),
        request.clone(),
        admission.clone(),
        trusted,
        effect_identity.clone(),
        effect_claim.clone(),
    )
    .expect("admitted finalize");
    let retry_claim = CloudflareSigningWorkerReusableWalletSessionEffectClaimV1::new(
        "authorization-1",
        wallet_session.wallet_session_id.clone(),
        "authorized-operation-1",
        "operation-1",
        "fingerprint-1",
    )
    .expect("stable retry effect claim");
    assert_eq!(
        admitted.effect_claim,
        CloudflareSigningWorkerNormalSigningEffectClaimV1::ReusableWalletSession {
            claim: retry_claim,
        }
    );
    let effect_json = serde_json::to_value(&admitted.effect_claim).expect("effect claim JSON");
    assert!(effect_json["claim"].get("now_unix_ms").is_none());

    let mut changed_admission = admission;
    changed_admission.org_id = "org-2".to_owned();
    changed_admission.subject_id = "principal-2".to_owned();
    let changed_trusted = CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        changed_admission
            .to_v1_trusted_metadata()
            .expect("changed trusted metadata"),
        ExpensiveWorkGateDecisionV1::accepted("gate-request-1").expect("accepted"),
    )
    .expect("changed trusted admission");
    let changed = CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2::new(
        1,
        CloudflareSigningWorkerWalletScopeV1::new("org-2", "project-1", "dev", "account.near")
            .expect("changed signing wallet scope"),
        request,
        changed_admission,
        changed_trusted,
        effect_identity.clone(),
        effect_claim,
    )
    .expect("changed admitted finalize");
    assert_eq!(
        admitted.effect_operation_key().expect("operation key"),
        changed
            .effect_operation_key()
            .expect("changed operation key")
    );
    assert_ne!(
        admitted.effect_request_digest().expect("request digest"),
        changed
            .effect_request_digest()
            .expect("changed request digest")
    );

    let mut changed_capability_request = admitted.request.clone();
    changed_capability_request
        .scope
        .material_activation
        .capability = "ed25519-signing-capability-2".to_owned();
    changed_capability_request
        .validate()
        .expect("changed capability request");
    let changed_capability_admission =
        CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::from_finalize_request(
            &wallet_session,
            &changed_capability_request,
            1_000,
        )
        .expect("changed capability admission");
    let changed_capability_trusted = CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        changed_capability_admission
            .to_v1_trusted_metadata()
            .expect("changed capability metadata"),
        ExpensiveWorkGateDecisionV1::accepted("gate-request-1").expect("accepted"),
    )
    .expect("changed capability trusted admission");
    let changed_capability = CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2::new(
        1,
        signing_wallet_scope("account.near"),
        changed_capability_request,
        changed_capability_admission,
        changed_capability_trusted,
        effect_identity,
        admitted.effect_claim.clone(),
    )
    .expect("changed capability admitted finalize");
    assert_eq!(
        admitted.effect_operation_key().expect("operation key"),
        changed_capability
            .effect_operation_key()
            .expect("changed capability operation key")
    );
    assert_ne!(
        admitted.effect_request_digest().expect("request digest"),
        changed_capability
            .effect_request_digest()
            .expect("changed capability request digest")
    );

    let terminal = CloudflareSigningWorkerNormalSigningTerminalV1::from_result(Err(
        router_ab_core::RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingLocalBinding,
            "round-1 material is missing",
        ),
    ));
    terminal
        .validate_for_request(&admitted)
        .expect("terminal failure validates");
    let round_trip: CloudflareSigningWorkerNormalSigningTerminalV1 =
        serde_json::from_str(&serde_json::to_string(&terminal).expect("serialize terminal"))
            .expect("deserialize terminal");
    let error = round_trip
        .into_result()
        .expect_err("terminal failure replays as failure");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::MissingLocalBinding);
}

#[test]
fn preloaded_signer_host_implements_core_host_traits() {
    let mut host = CloudflarePreloadedSignerHostV1::new(
        1_000,
        vec![root_share_metadata(Role::SignerA)],
        vec![0x42, 0x43],
    )
    .expect("preloaded host");

    assert_eq!(host.now_unix_ms(), 1_000);
    assert_eq!(
        host.signer_identity(Role::SignerA).expect("identity"),
        "signer-a"
    );
    assert!(host
        .has_root_share(Role::SignerA, &root_epoch())
        .expect("root share"));
    assert!(!host
        .has_root_share(Role::SignerB, &root_epoch())
        .expect("root share"));
    let mut random = [0u8; 2];
    host.fill_random(&mut random).expect("random");
    assert_eq!(random, [0x42, 0x43]);
    assert_eq!(host.now_unix_ms(), 1_000);
}

#[test]
fn preloaded_signer_host_builds_from_loaded_parts() {
    let input = CloudflareSignerHostPreloadInputV1::new("signer-set-v1", root_epoch(), 2)
        .expect("preload input");
    let mut host = build_cloudflare_preloaded_signer_host_v1(
        1_000,
        Role::SignerA,
        input,
        root_share_metadata(Role::SignerA),
        vec![0x42, 0x43],
    )
    .expect("preloaded host");

    assert_eq!(
        host.signer_identity(Role::SignerA).expect("identity"),
        "signer-a"
    );
    let mut random = [0u8; 2];
    host.fill_random(&mut random).expect("random");
    assert_eq!(random, [0x42, 0x43]);
}

#[test]
fn preloaded_signer_host_rejects_metadata_mismatch() {
    let input = CloudflareSignerHostPreloadInputV1::new("signer-set-v1", root_epoch(), 0)
        .expect("preload input");
    let metadata = CloudflareRootShareStartupMetadataV1::new(
        "other-signer-set",
        Role::SignerA,
        "signer-a",
        "key-epoch-a",
        root_epoch(),
        "sealed/share/a",
    )
    .expect("metadata");

    let err = build_cloudflare_preloaded_signer_host_v1(
        1_000,
        Role::SignerA,
        input,
        metadata,
        Vec::new(),
    )
    .expect_err("mismatched metadata must fail");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn preloaded_signer_host_rejects_non_local_root_metadata_role() {
    let input = CloudflareSignerHostPreloadInputV1::new("signer-set-v1", root_epoch(), 0)
        .expect("preload input");

    let err = build_cloudflare_preloaded_signer_host_v1(
        1_000,
        Role::SignerA,
        input,
        root_share_metadata(Role::SignerB),
        Vec::new(),
    )
    .expect_err("wrong role metadata must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidRole);
}

#[test]
fn preloaded_signer_host_rejects_random_length_mismatch() {
    let input = CloudflareSignerHostPreloadInputV1::new("signer-set-v1", root_epoch(), 2)
        .expect("preload input");
    let err = build_cloudflare_preloaded_signer_host_v1(
        1_000,
        Role::SignerA,
        input,
        root_share_metadata(Role::SignerA),
        vec![0x42],
    )
    .expect_err("random length mismatch must fail");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn preloaded_signer_host_rejects_random_exhaustion() {
    let mut host = CloudflarePreloadedSignerHostV1::new(
        1_000,
        vec![root_share_metadata(Role::SignerA)],
        vec![0x42],
    )
    .expect("preloaded host");
    let mut random = [0u8; 2];
    let err = host
        .fill_random(&mut random)
        .expect_err("random buffer exhaustion must fail");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}
