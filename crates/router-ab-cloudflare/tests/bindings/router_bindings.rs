//! Router bindings, admission, JWT, wallet-session and project-policy tests.

use super::*;

#[test]
fn router_bindings_accept_stateless_router_peers() {
    let bindings = CloudflareRouterBindingsV1::new(
        router_admission_bindings(),
        peer(CloudflareWorkerRoleV1::DeriverA, "DERIVER_A"),
        peer(CloudflareWorkerRoleV1::DeriverB, "DERIVER_B"),
        peer(CloudflareWorkerRoleV1::SigningWorker, "SIGNING_WORKER"),
        issuer_verifying_keys(),
    )
    .expect("router bindings");
    let startup = CloudflareWorkerBindingsV1::router(bindings).expect("router startup");

    assert_eq!(startup.worker_role(), CloudflareWorkerRoleV1::Router);
    let CloudflareWorkerBindingsV1::Router { bindings } = startup else {
        panic!("expected router startup bindings");
    };
    assert_eq!(bindings.admission.jwt.audience, "router-ab");
}

#[test]
fn router_admission_bindings_parse_router_only_provider_config() {
    let bindings = parse_cloudflare_router_admission_bindings_v1(&router_admission_env())
        .expect("router admission bindings");

    assert_eq!(bindings.jwt.issuer, "https://issuer.example");
    assert_eq!(bindings.jwt.audience, "router-ab");
    assert!(matches!(
        bindings.project_policy,
        CloudflareRouterProjectPolicyBindingV1::AllowAll
    ));
}

#[test]
fn router_admission_bindings_parse_configured_project_policy() {
    let env = router_admission_env().with_overrides(vec![(
        ROUTER_PROJECT_POLICY_BOOTSTRAP_JSON_ENV,
        configured_project_policy_json("\"registration_prepare\"", true),
    )]);

    let bindings = parse_cloudflare_router_admission_bindings_v1(&env)
        .expect("configured router project policy");

    let CloudflareRouterProjectPolicyBindingV1::Configured {
        org_id,
        project_id,
        environment,
        allowed_work_kinds,
        allow_normal_signing,
        rejected_retry_after_ms,
    } = bindings.project_policy
    else {
        panic!("expected configured project policy");
    };
    assert_eq!(org_id, "org-1");
    assert_eq!(project_id, "project-1");
    assert_eq!(environment, "dev");
    assert_eq!(
        allowed_work_kinds,
        vec![ExpensiveWorkKindV1::RegistrationPrepare]
    );
    assert!(allow_normal_signing);
    assert_eq!(rejected_retry_after_ms, 1_000);
}

#[test]
fn router_admission_bindings_reject_malformed_project_policy() {
    let env = router_admission_env().with_overrides(vec![(
        ROUTER_PROJECT_POLICY_BOOTSTRAP_JSON_ENV,
        "{\"org_id\":\"org-1\"}",
    )]);

    let err = parse_cloudflare_router_admission_bindings_v1(&env)
        .expect_err("malformed project policy must fail startup parsing");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn router_admission_bindings_reject_missing_jwks_json() {
    let env = CloudflareEnvMapV1::new(vec![
        (ROUTER_JWT_ISSUER_ENV, "https://issuer.example"),
        (ROUTER_JWT_AUDIENCE_ENV, "router-ab"),
    ]);

    let err = parse_cloudflare_router_admission_bindings_v1(&env)
        .expect_err("missing JWKS JSON must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MissingLocalBinding);
}

#[test]
fn router_jwt_binding_rejects_invalid_deployment_jwks() {
    let err = CloudflareRouterJwtVerifierBindingV1::new(
        "https://issuer.example",
        "router-ab",
        r#"{"keys":[]}"#,
    )
    .expect_err("empty deployment JWKS must fail");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn router_worker_runtime_normalizes_public_request_into_admission_plan() {
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
    let request = ecdsa_threshold_prf_request(2_000);
    let plan = runtime
        .public_request_admission_plan_at(
            1_000,
            request,
            trusted_admission(
                ExpensiveWorkGateDecisionV1::accepted("gate-request-1").expect("accepted"),
            ),
        )
        .expect("public request admission plan");

    plan.validate().expect("plan validation");
    let CloudflareRouterPublicAdmissionPlanV1::Forward {
        deriver_a_message,
        deriver_b_message,
        ..
    } = &plan
    else {
        panic!("accepted admission must forward");
    };
    assert_eq!(deriver_a_message.kind, WireMessageKindV1::RouterToSignerA);
    assert_eq!(deriver_b_message.kind, WireMessageKindV1::RouterToSignerB);
}

#[test]
fn router_worker_runtime_builds_forward_plan_for_accepted_admission() {
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
    let plan = runtime
        .public_request_admission_plan_at(
            1_000,
            ecdsa_threshold_prf_request(2_000),
            trusted_admission(
                ExpensiveWorkGateDecisionV1::accepted("gate-request-1").expect("accepted"),
            ),
        )
        .expect("admission plan");

    plan.validate().expect("plan validation");
    let CloudflareRouterPublicAdmissionPlanV1::Forward {
        deriver_a_message,
        deriver_b_message,
        ..
    } = plan
    else {
        panic!("accepted admission must forward");
    };
    assert_eq!(deriver_a_message.kind, WireMessageKindV1::RouterToSignerA);
    assert_eq!(deriver_b_message.kind, WireMessageKindV1::RouterToSignerB);
}

#[test]
fn router_worker_runtime_builds_stop_plan_for_rejected_admission() {
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
    let plan = runtime
        .public_request_admission_plan_at(
            1_000,
            ecdsa_threshold_prf_request(2_000),
            trusted_admission(
                ExpensiveWorkGateDecisionV1::rejected(GateRejectReasonV1::RateLimited, 1_000)
                    .expect("rejected"),
            ),
        )
        .expect("admission plan");

    plan.validate().expect("plan validation");
    let CloudflareRouterPublicAdmissionPlanV1::Stop { trusted_admission } = plan else {
        panic!("rejected admission must stop");
    };
    assert!(matches!(
        trusted_admission.decision,
        ExpensiveWorkGateDecisionV1::Rejected { .. }
    ));
}

#[test]
fn trusted_admission_rejects_mismatched_request_resource() {
    let request = ecdsa_threshold_prf_request(2_000);
    let admission = CloudflareRouterTrustedAdmissionV1::new(
        ExpensiveWorkGateContextV1::new(
            ExpensiveWorkKindV1::RegistrationPrepare,
            "org-1",
            "project-1",
            "dev",
            "different.near",
            GatePrincipalV1::router_jwt_session("user-1", "session-1").expect("principal"),
            digest(0x90),
        )
        .expect("gate context"),
        ExpensiveWorkGateDecisionV1::accepted("gate-request-1").expect("accepted"),
    )
    .expect("trusted admission");
    let err = admission
        .validate_for_request(&request)
        .expect_err("mismatched resource must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn trusted_admission_rejects_preauth_for_non_registration_work() {
    let lifecycle = LifecycleScopeV1::new(
        "lifecycle-2",
        ExpensiveWorkKindV1::KeyExport,
        root_epoch(),
        "account.near",
        "session-1",
        "signer-set-v1",
        "server-a",
    )
    .expect("lifecycle scope");
    let signer_set = signer_set();
    let transcript_digest = public_request_transcript_digest(&lifecycle, &signer_set);
    let request = EcdsaThresholdPrfRequestV1::new(
        "request-nonce-2",
        2_000,
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
    .expect("public router request");
    let admission = CloudflareRouterTrustedAdmissionV1::new(
        ExpensiveWorkGateContextV1::new(
            ExpensiveWorkKindV1::KeyExport,
            "org-1",
            "project-1",
            "dev",
            "account.near",
            GatePrincipalV1::pre_auth_session("pre-auth-1").expect("principal"),
            digest(0x90),
        )
        .expect("gate context"),
        ExpensiveWorkGateDecisionV1::accepted("gate-request-1").expect("accepted"),
    )
    .expect("trusted admission");
    let err = admission
        .validate_for_request(&request)
        .expect_err("pre-auth key export must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_derives_trusted_admission_from_server_owned_checks() {
    let request = ecdsa_threshold_prf_request(2_000);
    let admission = derive_cloudflare_router_trusted_admission_v1(
        &request,
        trusted_metadata(),
        allow_checks("gate-request-1"),
    )
    .expect("trusted admission");

    admission
        .validate_for_request(&request)
        .expect("admission should match request");
    assert_eq!(admission.context.org_id, "org-1");
    assert_eq!(admission.context.project_id, "project-1");
    assert!(matches!(
        admission.decision,
        ExpensiveWorkGateDecisionV1::Accepted { .. }
    ));
}

#[test]
fn router_derives_trusted_admission_from_provider_boundary() {
    let request = ecdsa_threshold_prf_request(2_000);
    let output =
        CloudflareRouterAdmissionProviderOutputV1::new(trusted_metadata(), allow_checks("gate-1"))
            .expect("provider output");
    let mut provider = StaticAdmissionProvider::new(output);

    let admission =
        derive_cloudflare_router_trusted_admission_from_provider_v1(&request, &mut provider)
            .expect("trusted admission");

    admission
        .validate_for_request(&request)
        .expect("admission should match request");
    assert_eq!(provider.calls, 1);
    assert!(matches!(
        admission.decision,
        ExpensiveWorkGateDecisionV1::Accepted { .. }
    ));
}

#[test]
fn router_admission_provider_output_rejects_metadata_mismatch() {
    let request = ecdsa_threshold_prf_request(2_000);
    let mismatched_metadata = CloudflareRouterTrustedRequestMetadataV1::new(
        ExpensiveWorkKindV1::RegistrationPrepare,
        "org-1",
        "project-1",
        "dev",
        "different.near",
        CloudflareRouterAuthContextV1::router_jwt_session("user-1", "session-1")
            .expect("auth context"),
        digest(0x90),
    )
    .expect("metadata");
    let output =
        CloudflareRouterAdmissionProviderOutputV1::new(mismatched_metadata, allow_checks("gate-1"))
            .expect("provider output");
    let mut provider = StaticAdmissionProvider::new(output);

    let err = derive_cloudflare_router_trusted_admission_from_provider_v1(&request, &mut provider)
        .expect_err("metadata mismatch must fail");

    assert_eq!(provider.calls, 1);
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_admission_provider_output_rejects_invalid_checks() {
    let err = CloudflareRouterAdmissionProviderOutputV1::new(
        trusted_metadata(),
        CloudflareRouterAdmissionChecksV1 {
            project_policy: CloudflareRouterProjectPolicyV1::Allowed,
            abuse: CloudflareRouterAbuseCheckV1::RateLimited { retry_after_ms: 0 },
            quota: CloudflareRouterQuotaCheckV1::Accepted {
                request_id: "gate-1".to_owned(),
            },
        },
    )
    .expect_err("invalid checks must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidTimeRange);
}

#[test]
fn router_composite_provider_accepts_verified_jwt_policy_abuse_and_quota() {
    let request = ecdsa_threshold_prf_request(2_000);
    let mut provider = composite_admission_provider(
        verified_jwt_claims("session-1", "account.near"),
        vec![ExpensiveWorkKindV1::RegistrationPrepare],
        CloudflareRouterAbuseCheckV1::Allowed,
        CloudflareRouterQuotaCheckV1::Accepted {
            request_id: "gate-request-1".to_owned(),
        },
    );

    let admission =
        derive_cloudflare_router_trusted_admission_from_provider_v1(&request, &mut provider)
            .expect("trusted admission");

    admission
        .validate_for_request(&request)
        .expect("admission should match request");
    assert_eq!(admission.context.org_id, "org-1");
    assert_eq!(admission.context.project_id, "project-1");
    assert!(matches!(
        admission.decision,
        ExpensiveWorkGateDecisionV1::Accepted { .. }
    ));
}

#[test]
fn router_composite_provider_rejects_verified_jwt_scope_mismatch() {
    let request = ecdsa_threshold_prf_request(2_000);
    let mut provider = composite_admission_provider(
        verified_jwt_claims("session-1", "different.near"),
        vec![ExpensiveWorkKindV1::RegistrationPrepare],
        CloudflareRouterAbuseCheckV1::Allowed,
        CloudflareRouterQuotaCheckV1::Accepted {
            request_id: "gate-request-1".to_owned(),
        },
    );

    let err = derive_cloudflare_router_trusted_admission_from_provider_v1(&request, &mut provider)
        .expect_err("verified jwt account mismatch must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_composite_provider_derives_stop_from_project_policy() {
    let request = ecdsa_threshold_prf_request(2_000);
    let mut provider = composite_admission_provider(
        verified_jwt_claims("session-1", "account.near"),
        vec![ExpensiveWorkKindV1::KeyExport],
        CloudflareRouterAbuseCheckV1::Allowed,
        CloudflareRouterQuotaCheckV1::Accepted {
            request_id: "gate-request-1".to_owned(),
        },
    );

    let admission =
        derive_cloudflare_router_trusted_admission_from_provider_v1(&request, &mut provider)
            .expect("trusted admission");

    assert!(matches!(
        admission.decision,
        ExpensiveWorkGateDecisionV1::Rejected {
            reason: GateRejectReasonV1::AbusePolicy,
            retry_after_ms: 1_000
        }
    ));
    assert!(!admission
        .allows_signer_forwarding()
        .expect("forwarding decision"));
}

#[test]
fn router_composite_provider_derives_stop_from_abuse_rate_limit() {
    let request = ecdsa_threshold_prf_request(2_000);
    let mut provider = composite_admission_provider(
        verified_jwt_claims("session-1", "account.near"),
        vec![ExpensiveWorkKindV1::RegistrationPrepare],
        CloudflareRouterAbuseCheckV1::RateLimited {
            retry_after_ms: 2_000,
        },
        CloudflareRouterQuotaCheckV1::Accepted {
            request_id: "gate-request-1".to_owned(),
        },
    );

    let admission =
        derive_cloudflare_router_trusted_admission_from_provider_v1(&request, &mut provider)
            .expect("trusted admission");

    assert!(matches!(
        admission.decision,
        ExpensiveWorkGateDecisionV1::Rejected {
            reason: GateRejectReasonV1::RateLimited,
            retry_after_ms: 2_000
        }
    ));
}

#[test]
fn router_bearer_authorization_parses_strict_bearer_header() {
    let authorization = CloudflareRouterBearerAuthorizationV1::from_authorization_header(
        "Bearer header.payload.sig",
    )
    .expect("bearer authorization");

    assert_eq!(authorization.token, "header.payload.sig");
}

#[test]
fn router_bearer_authorization_rejects_wrong_scheme_and_whitespace_token() {
    let wrong_scheme =
        CloudflareRouterBearerAuthorizationV1::from_authorization_header("Basic abc")
            .expect_err("wrong scheme must fail");
    let whitespace_token =
        CloudflareRouterBearerAuthorizationV1::from_authorization_header("Bearer abc def")
            .expect_err("whitespace token must fail");

    assert_eq!(
        wrong_scheme.code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );
    assert_eq!(
        whitespace_token.code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );
}

#[test]
fn router_ed25519_jwks_jwt_verifier_accepts_bound_claims() {
    let signing_key = SigningKey::from_bytes(&[0x42; 32]);
    let jwks_json = ed25519_jwks_json(&signing_key, "router-key-1");
    let mut verifier = CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(&jwks_json)
        .expect("ed25519 jwks verifier");
    let token = ed25519_jwt(&signing_key, "router-key-1", valid_router_jwt_claims());
    let authorization = CloudflareRouterBearerAuthorizationV1::from_authorization_header(&format!(
        "Bearer {token}"
    ))
    .expect("authorization");

    let claims = verifier
        .verify_public_request_jwt(
            &router_admission_bindings().jwt,
            &authorization,
            &ecdsa_threshold_prf_request(2_000),
            ecdsa_threshold_prf_request(2_000).router_replay_digest(),
            1_000,
            digest(0x91),
        )
        .expect("verified claims");

    assert_eq!(claims.subject_id, "user-1");
    assert_eq!(claims.session_id, "session-1");
    assert_eq!(claims.account_id, "account.near");
    assert_eq!(claims.trusted_source_digest, digest(0x91));
}

#[test]
fn router_ed25519_jwks_jwt_verifier_rejects_legacy_session_id_claim() {
    let signing_key = SigningKey::from_bytes(&[0x42; 32]);
    let jwks_json = ed25519_jwks_json(&signing_key, "router-key-1");
    let mut verifier = CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(&jwks_json)
        .expect("ed25519 jwks verifier");
    let mut claims = valid_router_jwt_claims();
    claims["session_id"] = claims["sid"].take();
    let token = ed25519_jwt(&signing_key, "router-key-1", claims);
    let authorization = CloudflareRouterBearerAuthorizationV1::from_authorization_header(&format!(
        "Bearer {token}"
    ))
    .expect("authorization");

    let error = verifier
        .verify_public_request_jwt(
            &router_admission_bindings().jwt,
            &authorization,
            &ecdsa_threshold_prf_request(2_000),
            ecdsa_threshold_prf_request(2_000).router_replay_digest(),
            1_000,
            digest(0x91),
        )
        .expect_err("legacy session_id must not satisfy canonical sid");

    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );
}

#[test]
fn router_jwt_policy_binds_the_public_route_digest() {
    let signing_key = SigningKey::from_bytes(&[0x42; 32]);
    let jwks_json = ed25519_jwks_json(&signing_key, "router-key-1");
    let mut verifier = CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(&jwks_json)
        .expect("ed25519 jwks verifier");
    let route_digest = digest(0x67);
    let mut claims = valid_router_jwt_claims();
    claims["routerAbRequestPolicy"]["requestDigest"] =
        serde_json::to_value(route_digest).expect("route digest json");
    let token = ed25519_jwt(&signing_key, "router-key-1", claims);
    let authorization = CloudflareRouterBearerAuthorizationV1::from_authorization_header(&format!(
        "Bearer {token}"
    ))
    .expect("authorization");

    verifier
        .verify_public_request_jwt(
            &router_admission_bindings().jwt,
            &authorization,
            &ecdsa_threshold_prf_request(2_000),
            route_digest,
            1_000,
            digest(0x91),
        )
        .expect("route-bound claims");
}

#[test]
fn router_ed25519_jwks_jwt_verifier_rejects_bad_signature() {
    let signing_key = SigningKey::from_bytes(&[0x42; 32]);
    let wrong_signing_key = SigningKey::from_bytes(&[0x43; 32]);
    let jwks_json = ed25519_jwks_json(&signing_key, "router-key-1");
    let mut verifier = CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(&jwks_json)
        .expect("ed25519 jwks verifier");
    let token = ed25519_jwt(
        &wrong_signing_key,
        "router-key-1",
        valid_router_jwt_claims(),
    );
    let authorization = CloudflareRouterBearerAuthorizationV1::from_authorization_header(&format!(
        "Bearer {token}"
    ))
    .expect("authorization");

    let err = verifier
        .verify_public_request_jwt(
            &router_admission_bindings().jwt,
            &authorization,
            &ecdsa_threshold_prf_request(2_000),
            ecdsa_threshold_prf_request(2_000).router_replay_digest(),
            1_000,
            digest(0x91),
        )
        .expect_err("bad signature must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MalformedWirePayload);
}

#[test]
fn router_ed25519_jwks_jwt_verifier_rejects_expired_token() {
    let signing_key = SigningKey::from_bytes(&[0x42; 32]);
    let jwks_json = ed25519_jwks_json(&signing_key, "router-key-1");
    let mut verifier = CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(&jwks_json)
        .expect("ed25519 jwks verifier");
    let mut claims = valid_router_jwt_claims();
    claims["exp"] = serde_json::json!(1);
    let token = ed25519_jwt(&signing_key, "router-key-1", claims);
    let authorization = CloudflareRouterBearerAuthorizationV1::from_authorization_header(&format!(
        "Bearer {token}"
    ))
    .expect("authorization");

    let err = verifier
        .verify_public_request_jwt(
            &router_admission_bindings().jwt,
            &authorization,
            &ecdsa_threshold_prf_request(2_000),
            ecdsa_threshold_prf_request(2_000).router_replay_digest(),
            1_000,
            digest(0x91),
        )
        .expect_err("expired token must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ExpiredLocalRequest);
}

#[test]
fn router_ed25519_jwks_jwt_verifier_rejects_request_scope_mismatch() {
    let signing_key = SigningKey::from_bytes(&[0x42; 32]);
    let jwks_json = ed25519_jwks_json(&signing_key, "router-key-1");
    let mut verifier = CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(&jwks_json)
        .expect("ed25519 jwks verifier");
    let mut claims = valid_router_jwt_claims();
    claims["account_id"] = serde_json::json!("different.near");
    let token = ed25519_jwt(&signing_key, "router-key-1", claims);
    let authorization = CloudflareRouterBearerAuthorizationV1::from_authorization_header(&format!(
        "Bearer {token}"
    ))
    .expect("authorization");

    let err = verifier
        .verify_public_request_jwt(
            &router_admission_bindings().jwt,
            &authorization,
            &ecdsa_threshold_prf_request(2_000),
            ecdsa_threshold_prf_request(2_000).router_replay_digest(),
            1_000,
            digest(0x91),
        )
        .expect_err("request scope mismatch must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_wallet_session_credential_accepts_gateway_owner_projection() {
    let session = normal_signing_v2_wallet_session(3_000);
    let credential = CloudflareRouterWalletSessionCredentialV1::gateway_owner(session.clone())
        .expect("Gateway owner credential");

    credential.validate().expect("credential validates");
    match credential {
        CloudflareRouterWalletSessionCredentialV1::GatewayOwner { wallet_session } => {
            assert_eq!(wallet_session.wallet_session_id, session.wallet_session_id);
        }
    }
}

#[test]
fn router_wallet_session_verifier_accepts_normal_signing_projection() {
    let signing_key = SigningKey::from_bytes(&[0x42; 32]);
    let jwks_json = ed25519_jwks_json(&signing_key, "router-key-1");
    let mut verifier = CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(&jwks_json)
        .expect("Ed25519 JWK verifier");
    let session = normal_signing_v2_wallet_session(3_000);
    let credential =
        CloudflareRouterWalletSessionCredentialV1::gateway_owner(session).expect("credential");

    let session = verifier
        .verify_wallet_session(
            &router_admission_bindings().jwt,
            &credential,
            digest(0x90),
            1_000,
        )
        .expect("Wallet Session verifies");

    assert_eq!(session.account_id, "account.near");
    assert_eq!(session.wallet_session_id, "wallet-session-1");
    assert_eq!(session.authorization_level, "near-ed25519");
    assert_eq!(session.signing_worker_id, "server-a");
}

#[test]
fn router_wallet_session_verifier_accepts_ecdsa_projection() {
    let signing_key = SigningKey::from_bytes(&[0x42; 32]);
    let jwks_json = ed25519_jwks_json(&signing_key, "router-key-1");
    let mut verifier = CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(&jwks_json)
        .expect("Ed25519 JWK verifier");
    let credential =
        CloudflareRouterWalletSessionCredentialV1::gateway_owner(ecdsa_wallet_session(3_000))
            .expect("credential");

    let session = verifier
        .verify_wallet_session(
            &router_admission_bindings().jwt,
            &credential,
            digest(0x90),
            1_000,
        )
        .expect("ECDSA Wallet Session verifies");

    assert_eq!(session.account_id, "wallet-1");
    assert_eq!(session.authorization_id, "authorization-1");
    assert_eq!(session.authorization_level, "evm-family");
}

#[test]
fn router_wallet_session_verifier_rejects_source_mismatch() {
    let signing_key = SigningKey::from_bytes(&[0x42; 32]);
    let jwks_json = ed25519_jwks_json(&signing_key, "router-key-1");
    let mut verifier = CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(&jwks_json)
        .expect("Ed25519 JWK verifier");
    let credential = CloudflareRouterWalletSessionCredentialV1::gateway_owner(
        normal_signing_v2_wallet_session(3_000),
    )
    .expect("credential");

    let err = verifier
        .verify_wallet_session(
            &router_admission_bindings().jwt,
            &credential,
            digest(0x91),
            1_000,
        )
        .expect_err("source mismatch must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_wallet_session_verifier_rejects_expired_projection() {
    let signing_key = SigningKey::from_bytes(&[0x42; 32]);
    let jwks_json = ed25519_jwks_json(&signing_key, "router-key-1");
    let mut verifier = CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(&jwks_json)
        .expect("Ed25519 JWK verifier");
    let credential = CloudflareRouterWalletSessionCredentialV1::gateway_owner(
        normal_signing_v2_wallet_session(1_000),
    )
    .expect("credential");

    let err = verifier
        .verify_wallet_session(
            &router_admission_bindings().jwt,
            &credential,
            digest(0x90),
            1_000,
        )
        .expect_err("expired Wallet Session must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ExpiredLocalRequest);
}

#[test]
fn router_wallet_session_credential_rejects_duplicate_authorization_ids() {
    let mut session = normal_signing_v2_wallet_session(3_000);
    session.authorization_id = session.wallet_session_id.clone();

    let err = CloudflareRouterWalletSessionCredentialV1::gateway_owner(session)
        .expect_err("duplicate authorization and Wallet Session ids must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_wallet_session_credential_rejects_missing_quota_id() {
    let mut session = normal_signing_v2_wallet_session(3_000);
    session.quota_id.clear();

    let err = CloudflareRouterWalletSessionCredentialV1::gateway_owner(session)
        .expect_err("missing quota id must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::EmptyField);
}

#[test]
fn router_wallet_session_credential_rejects_missing_normal_signing_claims() {
    let mut session = normal_signing_v2_wallet_session(3_000);
    session.authorization_level.clear();

    let err = CloudflareRouterWalletSessionCredentialV1::gateway_owner(session)
        .expect_err("missing authorization level must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::EmptyField);
}

#[test]
fn router_verified_wallet_session_authorizes_normal_signing_v2_prepare_scope() {
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let request = normal_signing_v2_prepare_request(2_000);

    assert_ne!(
        wallet_session.threshold_session_id,
        request.scope.material_activation.activation_id
    );
    assert_ne!(
        wallet_session.threshold_session_id,
        wallet_session.wallet_session_id
    );
    assert_ne!(
        wallet_session.threshold_session_id,
        request.scope.material_activation.lifecycle_binding
    );
    assert_ne!(
        wallet_session.wallet_session_id,
        request.scope.material_activation.activation_id
    );
    assert_ne!(
        wallet_session.wallet_session_id,
        request.scope.material_activation.lifecycle_binding
    );
    assert_ne!(
        request.scope.material_activation.activation_id,
        request.scope.material_activation.lifecycle_binding
    );

    wallet_session
        .validate_for_normal_signing_prepare_request_v2(&request, 1_000)
        .expect("wallet session authorizes v2 prepare request");
    let admission = wallet_session
        .to_normal_signing_prepare_admission_candidate_v2(&request, 1_000)
        .expect("normal signing v2 admission");
    let expected_material = request.admission_material().expect("admission material");

    assert_eq!(
        admission
            .admission_material()
            .expect("carried admission material"),
        expected_material
    );
    assert_eq!(admission.request_id, request.scope.request_id);
    assert_eq!(admission.signing_worker_id, request.scope.signing_worker_id);
    assert_eq!(
        admission.round1_binding_digest,
        Some(request.round1_binding_digest().expect("round1 binding"))
    );
}

#[test]
fn router_verified_wallet_session_rejects_normal_signing_v2_prepare_beyond_session_expiry() {
    let wallet_session = normal_signing_v2_wallet_session(1_500);
    let request = normal_signing_v2_prepare_request(2_000);

    let err = wallet_session
        .validate_for_normal_signing_prepare_request_v2(&request, 1_000)
        .expect_err("request expiry must be bounded by Wallet Session expiry");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidTimeRange);
}

#[test]
fn router_verified_wallet_session_rejects_normal_signing_v2_prepare_at_exact_expiry() {
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let request = normal_signing_v2_prepare_request(2_000);

    let err = wallet_session
        .validate_for_normal_signing_prepare_request_v2(&request, 2_000)
        .expect_err("request is expired at expires_at_ms");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ExpiredLocalRequest);
}

#[test]
fn router_verified_wallet_session_rejects_normal_signing_v2_signing_worker_mismatch() {
    let mut wallet_session = normal_signing_v2_wallet_session(3_000);
    wallet_session.signing_worker_id = "server-b".to_owned();
    let request = normal_signing_v2_prepare_request(2_000);

    let err = wallet_session
        .validate_for_normal_signing_prepare_request_v2(&request, 1_000)
        .expect_err("signing worker mismatch must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_verified_wallet_session_rejects_v2_prepare_account_or_wallet_session_mismatch() {
    let request = normal_signing_v2_prepare_request(2_000);

    let mut wrong_account = normal_signing_v2_wallet_session(3_000);
    wrong_account.account_id = "other.near".to_owned();
    let err = wrong_account
        .validate_for_normal_signing_prepare_request_v2(&request, 1_000)
        .expect_err("prepare account mismatch must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let mut wrong_authorization = request;
    wrong_authorization.scope.authorization =
        NormalSigningAuthorizationV1::reusable_wallet_session("other-wallet-session")
            .expect("substituted Wallet Session authorization");
    let err = wallet_session
        .validate_for_normal_signing_prepare_request_v2(&wrong_authorization, 1_000)
        .expect_err("prepare Wallet Session authorization mismatch must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_verified_wallet_session_authorizes_normal_signing_v2_finalize_scope() {
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let request = normal_signing_v2_finalize_request(2_000);

    wallet_session
        .validate_for_normal_signing_finalize_request_v2(&request, 1_000)
        .expect("wallet session authorizes v2 finalize request");
    let admission =
        CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::from_finalize_request(
            &wallet_session,
            &request,
            1_000,
        )
        .expect("normal signing v2 finalize admission");

    assert_eq!(admission.request_id, request.scope.request_id);
    assert_eq!(admission.signing_worker_id, request.scope.signing_worker_id);
    assert_eq!(admission.intent_digest, request.intent_digest());
    assert_eq!(
        admission.signing_payload_digest,
        request.signing_payload_digest()
    );
    assert_eq!(
        admission.round1_binding_digest,
        request.round1_binding_digest()
    );
}

#[test]
fn router_verified_wallet_session_rejects_normal_signing_v2_finalize_beyond_session_expiry() {
    let wallet_session = normal_signing_v2_wallet_session(1_500);
    let request = normal_signing_v2_finalize_request(2_000);

    let err = wallet_session
        .validate_for_normal_signing_finalize_request_v2(&request, 1_000)
        .expect_err("finalize expiry must be bounded by Wallet Session expiry");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidTimeRange);
}

#[test]
fn router_verified_wallet_session_rejects_normal_signing_v2_finalize_at_exact_expiry() {
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let request = normal_signing_v2_finalize_request(2_000);

    let err = wallet_session
        .validate_for_normal_signing_finalize_request_v2(&request, 2_000)
        .expect_err("finalize is expired at expires_at_ms");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ExpiredLocalRequest);
}

#[test]
fn router_verified_wallet_session_rejects_normal_signing_v2_finalize_signing_worker_mismatch() {
    let mut wallet_session = normal_signing_v2_wallet_session(3_000);
    wallet_session.signing_worker_id = "server-b".to_owned();
    let request = normal_signing_v2_finalize_request(2_000);

    let err = wallet_session
        .validate_for_normal_signing_finalize_request_v2(&request, 1_000)
        .expect_err("finalize signing worker mismatch must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_verified_wallet_session_rejects_v2_finalize_account_or_wallet_session_mismatch() {
    let request = normal_signing_v2_finalize_request(2_000);

    let mut wrong_account = normal_signing_v2_wallet_session(3_000);
    wrong_account.account_id = "other.near".to_owned();
    let err = wrong_account
        .validate_for_normal_signing_finalize_request_v2(&request, 1_000)
        .expect_err("finalize account mismatch must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let mut wrong_authorization = request;
    wrong_authorization.scope.authorization =
        NormalSigningAuthorizationV1::reusable_wallet_session("other-wallet-session")
            .expect("substituted Wallet Session authorization");
    let err = wallet_session
        .validate_for_normal_signing_finalize_request_v2(&wrong_authorization, 1_000)
        .expect_err("finalize Wallet Session authorization mismatch must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_normal_signing_prepare_admission_v2_rejects_scope_and_digest_drift() {
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let request = normal_signing_v2_prepare_request(2_000);
    let admission = CloudflareRouterNormalSigningPrepareAdmissionCandidateV2::from_prepare_request(
        &wallet_session,
        &request,
        1_000,
    )
    .expect("normal signing v2 admission");

    let mut wrong_account = admission.clone();
    wrong_account.account_id = "other.near".to_owned();
    let err = wrong_account
        .validate_for_prepare_request(&request)
        .expect_err("prepare admission account drift must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let mut wrong_session = admission.clone();
    wrong_session.authorization =
        CloudflareRouterNormalSigningAuthorizationV2::reusable_wallet_session(
            "other-authorization",
            "other-session",
        )
        .expect("wrong prepare authorization");
    let err = wrong_session
        .validate_for_prepare_request(&request)
        .expect_err("prepare admission session drift must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let mut wrong_request_id = admission.clone();
    wrong_request_id.request_id = "other-request".to_owned();
    let err = wrong_request_id
        .validate_for_prepare_request(&request)
        .expect_err("prepare admission request id drift must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let mut intent_drift = admission.clone();
    intent_drift.intent_digest = digest(0x54);
    let err = intent_drift
        .validate_for_prepare_request(&request)
        .expect_err("prepare admission intent digest drift must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let mut signing_payload_drift = admission.clone();
    signing_payload_drift.signing_payload_digest = digest(0x55);
    let err = signing_payload_drift
        .validate_for_prepare_request(&request)
        .expect_err("prepare admission signing payload digest drift must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let mut admitted_signing_drift = admission.clone();
    admitted_signing_drift.admitted_signing_digest = digest(0x58);
    let err = admitted_signing_drift
        .validate_for_prepare_request(&request)
        .expect_err("prepare admission admitted signing digest drift must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_normal_signing_finalize_admission_v2_rejects_scope_and_digest_drift() {
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let request = normal_signing_v2_finalize_request(2_000);
    let admission =
        CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::from_finalize_request(
            &wallet_session,
            &request,
            1_000,
        )
        .expect("normal signing v2 finalize admission");

    let mut wrong_account = admission.clone();
    wrong_account.account_id = "other.near".to_owned();
    let err = wrong_account
        .validate_for_finalize_request(&request)
        .expect_err("finalize admission account drift must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let mut wrong_session = admission.clone();
    wrong_session.authorization =
        CloudflareRouterNormalSigningAuthorizationV2::reusable_wallet_session(
            "other-authorization",
            "other-session",
        )
        .expect("wrong finalize authorization");
    let err = wrong_session
        .validate_for_finalize_request(&request)
        .expect_err("finalize admission session drift must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let mut wrong_request_id = admission.clone();
    wrong_request_id.request_id = "other-request".to_owned();
    let err = wrong_request_id
        .validate_for_finalize_request(&request)
        .expect_err("finalize admission request id drift must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let mut intent_drift = admission.clone();
    intent_drift.intent_digest = digest(0x54);
    let err = intent_drift
        .validate_for_finalize_request(&request)
        .expect_err("finalize admission intent digest drift must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);

    let mut signing_payload_drift = admission.clone();
    signing_payload_drift.signing_payload_digest = digest(0x55);
    let err = signing_payload_drift
        .validate_for_finalize_request(&request)
        .expect_err("finalize admission signing payload digest drift must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_normal_signing_admission_v2_rejects_signing_payload_digest_drift() {
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let request = normal_signing_v2_prepare_request(2_000);
    let mut admission =
        CloudflareRouterNormalSigningPrepareAdmissionCandidateV2::from_prepare_request(
            &wallet_session,
            &request,
            1_000,
        )
        .expect("normal signing v2 admission");
    admission.signing_payload_digest = digest(0x55);

    let err = admission
        .validate_for_prepare_request(&request)
        .expect_err("signing payload digest drift must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_normal_signing_admission_v2_converts_to_v1_store_metadata() {
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let request = normal_signing_v2_prepare_request(2_000);
    let admission = CloudflareRouterNormalSigningPrepareAdmissionCandidateV2::from_prepare_request(
        &wallet_session,
        &request,
        1_000,
    )
    .expect("normal signing v2 admission");

    let metadata = admission
        .to_v1_trusted_metadata()
        .expect("v1 trusted metadata");

    assert_eq!(metadata.org_id, admission.org_id);
    assert_eq!(metadata.project_id, admission.project_id);
    assert_eq!(metadata.environment, admission.environment);
    assert_eq!(metadata.account_id, admission.account_id);
    assert_eq!(
        metadata.trusted_source_digest,
        admission.trusted_source_digest
    );
    assert_eq!(metadata.intent_digest, admission.intent_digest);
    assert_eq!(
        metadata.auth,
        CloudflareRouterAuthContextV1::owner_wallet_session("user-1", "wallet-session-1")
            .expect("owner Wallet Session auth context")
    );
}

#[test]
fn router_normal_signing_finalize_admission_v2_converts_to_v1_store_metadata() {
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let request = normal_signing_v2_finalize_request(2_000);
    let admission =
        CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::from_finalize_request(
            &wallet_session,
            &request,
            1_000,
        )
        .expect("normal signing v2 finalize admission");

    let metadata = admission
        .to_v1_trusted_metadata()
        .expect("v1 trusted metadata");

    assert_eq!(metadata.org_id, admission.org_id);
    assert_eq!(metadata.project_id, admission.project_id);
    assert_eq!(metadata.environment, admission.environment);
    assert_eq!(metadata.account_id, admission.account_id);
    assert_eq!(
        metadata.trusted_source_digest,
        admission.trusted_source_digest
    );
    assert_eq!(metadata.intent_digest, admission.intent_digest);
    assert_eq!(
        metadata.auth,
        CloudflareRouterAuthContextV1::owner_wallet_session("user-1", "wallet-session-1")
            .expect("owner Wallet Session auth context")
    );
}

#[test]
fn router_normal_signing_finalize_admission_v2_rejects_round1_binding_drift() {
    let wallet_session = normal_signing_v2_wallet_session(3_000);
    let request = normal_signing_v2_finalize_request(2_000);
    let mut admission =
        CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2::from_finalize_request(
            &wallet_session,
            &request,
            1_000,
        )
        .expect("normal signing v2 finalize admission");
    admission.round1_binding_digest = digest(0x57);

    let err = admission
        .validate_for_finalize_request(&request)
        .expect_err("round1 binding drift must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_jwt_session_provider_feeds_composite_admission() {
    let request = ecdsa_threshold_prf_request(2_000);
    let admission_bindings = parse_cloudflare_router_admission_bindings_v1(&router_admission_env())
        .expect("admission bindings");
    let jwt_session = CloudflareRouterJwtSessionProviderV1::new(
        admission_bindings.jwt,
        CloudflareRouterBearerAuthorizationV1::from_authorization_header(
            "Bearer header.payload.sig",
        )
        .expect("authorization"),
        1_000,
        digest(0x90),
        request.router_replay_digest(),
        StaticJwtVerifier::new(verified_jwt_claims("session-1", "account.near")),
    )
    .expect("jwt session provider");
    let mut provider = CloudflareRouterCompositeAdmissionProviderV1::new(
        jwt_session,
        CloudflareRouterAllowedWorkKindsProjectPolicyProviderV1::new(
            vec![ExpensiveWorkKindV1::RegistrationPrepare],
            1_000,
        )
        .expect("project policy provider"),
        CloudflareRouterConfiguredAbuseProviderV1::new(CloudflareRouterAbuseCheckV1::Allowed)
            .expect("abuse provider"),
        CloudflareRouterConfiguredQuotaProviderV1::new(CloudflareRouterQuotaCheckV1::Accepted {
            request_id: "gate-request-1".to_owned(),
        })
        .expect("quota provider"),
    );

    let admission =
        derive_cloudflare_router_trusted_admission_from_provider_v1(&request, &mut provider)
            .expect("trusted admission");

    assert_eq!(admission.context.org_id, "org-1");
    assert_eq!(admission.context.project_id, "project-1");
    assert!(matches!(
        admission.decision,
        ExpensiveWorkGateDecisionV1::Accepted { .. }
    ));
}

#[test]
fn router_runtime_builds_admission_plan_from_composite_provider() {
    let request = ecdsa_threshold_prf_request(2_000);
    let runtime = router_runtime();
    let mut provider = composite_admission_provider(
        verified_jwt_claims("session-1", "account.near"),
        vec![ExpensiveWorkKindV1::RegistrationPrepare],
        CloudflareRouterAbuseCheckV1::Allowed,
        CloudflareRouterQuotaCheckV1::SignerQueueSaturated,
    );

    let plan = runtime
        .public_request_admission_plan_from_provider_at(1_000, request, &mut provider)
        .expect("admission plan");

    assert!(matches!(
        plan,
        CloudflareRouterPublicAdmissionPlanV1::Stop { .. }
    ));
    assert!(matches!(
        plan.trusted_admission().decision,
        ExpensiveWorkGateDecisionV1::Defer {
            reason: GateDeferReasonV1::SignerQueueSaturated
        }
    ));
}

#[test]
fn router_runtime_project_policy_rejects_identity_mismatch() {
    let request = ecdsa_threshold_prf_request(2_000);
    let admission = derive_cloudflare_router_trusted_admission_v1(
        &request,
        trusted_metadata(),
        allow_checks("gate-request-1"),
    )
    .expect("trusted admission");
    let policy = configured_project_policy_json("\"registration_prepare\"", true)
        .replace("\"org-1\"", "\"org-2\"");
    let env = router_env().with_overrides(vec![(ROUTER_PROJECT_POLICY_BOOTSTRAP_JSON_ENV, policy)]);
    let runtime = CloudflareRouterWorkerRuntimeV1::new(
        CloudflareRouterBindingsV1::new(
            parse_cloudflare_router_admission_bindings_v1(&env).expect("admission bindings"),
            peer(CloudflareWorkerRoleV1::DeriverA, "DERIVER_A"),
            peer(CloudflareWorkerRoleV1::DeriverB, "DERIVER_B"),
            peer(CloudflareWorkerRoleV1::SigningWorker, "SIGNING_WORKER"),
            issuer_verifying_keys(),
        )
        .expect("router bindings"),
    )
    .expect("router runtime");

    let err = runtime
        .apply_project_policy_to_trusted_admission_v1(&request, admission)
        .expect_err("identity mismatch must fail admission");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_runtime_project_policy_rejects_denied_work_kind() {
    let request = ecdsa_threshold_prf_request(2_000);
    let admission = derive_cloudflare_router_trusted_admission_v1(
        &request,
        trusted_metadata(),
        allow_checks("gate-request-1"),
    )
    .expect("trusted admission");
    let runtime = router_runtime_with_project_policy("\"key_export\"", true);

    let admission = runtime
        .apply_project_policy_to_trusted_admission_v1(&request, admission)
        .expect("policy evaluation");

    assert!(matches!(
        admission.decision,
        ExpensiveWorkGateDecisionV1::Rejected {
            reason: GateRejectReasonV1::AbusePolicy,
            retry_after_ms: 1_000,
        }
    ));
}

#[test]
fn router_runtime_project_policy_allows_yao_work_kind() {
    let runtime = router_runtime_with_project_policy("\"registration_prepare\"", true);

    let policy = runtime
        .evaluate_project_policy_for_yao_work_kind_v1(ExpensiveWorkKindV1::RegistrationPrepare)
        .expect("Yao project policy evaluation");

    assert_eq!(policy, CloudflareRouterProjectPolicyV1::Allowed);
}

#[test]
fn router_runtime_allow_all_project_policy_allows_yao_work_kind() {
    let policy = router_runtime()
        .evaluate_project_policy_for_yao_work_kind_v1(ExpensiveWorkKindV1::KeyExport)
        .expect("Yao project policy evaluation");

    assert_eq!(policy, CloudflareRouterProjectPolicyV1::Allowed);
}

#[test]
fn router_runtime_project_policy_rejects_denied_yao_work_kind() {
    let runtime = router_runtime_with_project_policy("\"key_export\"", true);

    let policy = runtime
        .evaluate_project_policy_for_yao_work_kind_v1(ExpensiveWorkKindV1::RegistrationPrepare)
        .expect("Yao project policy evaluation");

    assert_eq!(
        policy,
        CloudflareRouterProjectPolicyV1::Rejected {
            retry_after_ms: 1_000,
        }
    );
}

#[test]
fn router_runtime_project_policy_rejects_normal_signing_when_disabled() {
    let metadata = CloudflareRouterNormalSigningTrustedMetadataV1::new(
        "org-1",
        "project-1",
        "dev",
        "account.near",
        CloudflareRouterAuthContextV1::router_jwt_session("user-1", "session-1")
            .expect("auth context"),
        digest(0x90),
        digest(0x91),
    )
    .expect("normal-signing metadata");
    let admission = CloudflareRouterNormalSigningTrustedAdmissionV1::new(
        metadata,
        ExpensiveWorkGateDecisionV1::accepted("normal-request-1").expect("accepted decision"),
    )
    .expect("normal-signing admission");
    let runtime = router_runtime_with_project_policy("\"registration_prepare\"", false);

    let admission = runtime
        .apply_project_policy_to_normal_signing_admission_v1("normal-request-1", admission)
        .expect("policy evaluation");

    assert!(matches!(
        admission.decision,
        ExpensiveWorkGateDecisionV1::Rejected {
            reason: GateRejectReasonV1::AbusePolicy,
            retry_after_ms: 1_000,
        }
    ));
}

#[test]
fn router_derives_stop_decision_from_project_policy_rejection() {
    let request = ecdsa_threshold_prf_request(2_000);
    let checks = CloudflareRouterAdmissionChecksV1::new(
        CloudflareRouterProjectPolicyV1::Rejected {
            retry_after_ms: 1_000,
        },
        CloudflareRouterAbuseCheckV1::Allowed,
        CloudflareRouterQuotaCheckV1::Accepted {
            request_id: "gate-request-1".to_owned(),
        },
    )
    .expect("checks");
    let admission =
        derive_cloudflare_router_trusted_admission_v1(&request, trusted_metadata(), checks)
            .expect("trusted admission");

    assert!(matches!(
        admission.decision,
        ExpensiveWorkGateDecisionV1::Rejected {
            reason: GateRejectReasonV1::AbusePolicy,
            retry_after_ms: 1_000
        }
    ));
    assert!(!admission
        .allows_signer_forwarding()
        .expect("forwarding check"));
}

#[test]
fn router_derives_rate_limited_admission_before_quota_acceptance() {
    let request = ecdsa_threshold_prf_request(2_000);
    let checks = CloudflareRouterAdmissionChecksV1::new(
        CloudflareRouterProjectPolicyV1::Allowed,
        CloudflareRouterAbuseCheckV1::RateLimited {
            retry_after_ms: 2_000,
        },
        CloudflareRouterQuotaCheckV1::Accepted {
            request_id: "gate-request-1".to_owned(),
        },
    )
    .expect("checks");
    let admission =
        derive_cloudflare_router_trusted_admission_v1(&request, trusted_metadata(), checks)
            .expect("trusted admission");

    assert!(matches!(
        admission.decision,
        ExpensiveWorkGateDecisionV1::Rejected {
            reason: GateRejectReasonV1::RateLimited,
            retry_after_ms: 2_000
        }
    ));
}

#[test]
fn router_derives_quota_defer_admission() {
    let request = ecdsa_threshold_prf_request(2_000);
    let checks = CloudflareRouterAdmissionChecksV1::new(
        CloudflareRouterProjectPolicyV1::Allowed,
        CloudflareRouterAbuseCheckV1::Allowed,
        CloudflareRouterQuotaCheckV1::SignerQueueSaturated,
    )
    .expect("checks");
    let admission =
        derive_cloudflare_router_trusted_admission_v1(&request, trusted_metadata(), checks)
            .expect("trusted admission");

    assert!(matches!(
        admission.decision,
        ExpensiveWorkGateDecisionV1::Defer {
            reason: GateDeferReasonV1::SignerQueueSaturated
        }
    ));
}

#[test]
fn router_trusted_metadata_must_match_public_request_lifecycle() {
    let request = ecdsa_threshold_prf_request(2_000);
    let metadata = CloudflareRouterTrustedRequestMetadataV1::new(
        ExpensiveWorkKindV1::RegistrationPrepare,
        "org-1",
        "project-1",
        "dev",
        "different.near",
        CloudflareRouterAuthContextV1::router_jwt_session("user-1", "session-1")
            .expect("auth context"),
        digest(0x90),
    )
    .expect("metadata");
    let err = derive_cloudflare_router_trusted_admission_v1(
        &request,
        metadata,
        allow_checks("gate-request-1"),
    )
    .expect_err("metadata mismatch must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}

#[test]
fn router_trusted_metadata_rejects_preauth_session_mismatch() {
    let request = ecdsa_threshold_prf_request(2_000);
    let metadata = CloudflareRouterTrustedRequestMetadataV1::new(
        ExpensiveWorkKindV1::RegistrationPrepare,
        "org-1",
        "project-1",
        "dev",
        "account.near",
        CloudflareRouterAuthContextV1::pre_auth_session("different-session").expect("auth context"),
        digest(0x90),
    )
    .expect("metadata");
    let err = derive_cloudflare_router_trusted_admission_v1(
        &request,
        metadata,
        allow_checks("gate-request-1"),
    )
    .expect_err("pre-auth session mismatch must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidGateDecision);
}
