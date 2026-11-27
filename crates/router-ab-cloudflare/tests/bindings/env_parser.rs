//! Environment parser tests for each Worker role.

use super::*;

#[test]
fn env_parser_builds_router_bindings_from_required_keys() {
    let parsed = parse_cloudflare_worker_bindings_v1(CloudflareWorkerRoleV1::Router, &router_env())
        .expect("router env");

    let CloudflareWorkerBindingsV1::Router { bindings } = parsed else {
        panic!("expected router bindings");
    };
    assert_eq!(bindings.admission.jwt.audience, "router-ab");
    assert_eq!(
        bindings.deriver_a.peer_role,
        CloudflareWorkerRoleV1::DeriverA
    );
    assert_eq!(bindings.deriver_b.binding_name, "DERIVER_B");
    assert_eq!(
        bindings.signing_worker.peer_role,
        CloudflareWorkerRoleV1::SigningWorker
    );
}

#[test]
fn env_parser_builds_deriver_a_bindings_from_required_keys() {
    let bindings = parse_cloudflare_deriver_a_bindings_v1(&deriver_a_env()).expect("signer a env");

    assert_eq!(
        bindings.envelope_decrypt_key.current.binding_name,
        "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY"
    );
    assert_eq!(
        bindings.envelope_decrypt_key.current.key_epoch,
        "envelope-hpke-key-epoch-a"
    );
    assert_eq!(
        bindings.envelope_decrypt_key.current.public_key,
        x25519_public_key(0x11)
    );
}

#[test]
fn env_parser_builds_signing_worker_bindings_from_required_keys() {
    let bindings = parse_cloudflare_signing_worker_bindings_v1(&signing_worker_env())
        .expect("signing worker env");

    assert_eq!(
        bindings.presign_session.binding_name,
        "SIGNING_WORKER_PRESIGN_SESSION_DO"
    );
    assert_eq!(
        bindings.server_output_decrypt_key.binding_name,
        "SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY"
    );
    assert_eq!(bindings.server_output_decrypt_key.key_epoch, "server-epoch");
    assert_eq!(
        bindings.server_output_decrypt_key.public_key,
        signer_set().selected_server.recipient_encryption_key
    );
}

#[test]
fn env_parser_builds_deriver_b_bindings_from_required_keys() {
    let bindings = parse_cloudflare_deriver_b_bindings_v1(&deriver_b_env()).expect("signer b env");

    assert_eq!(
        bindings.deriver_a.peer_role,
        CloudflareWorkerRoleV1::DeriverA
    );
    assert_eq!(
        bindings.envelope_decrypt_key.current.binding_name,
        "DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY"
    );
    assert_eq!(
        bindings.envelope_decrypt_key.current.key_epoch,
        "envelope-hpke-key-epoch-b"
    );
    assert_eq!(
        bindings.envelope_decrypt_key.current.public_key,
        x25519_public_key(0x22)
    );
}

#[test]
fn env_parser_rejects_router_with_signer_envelope_hpke_private_key_binding() {
    let env = CloudflareEnvMapV1::new(vec![(
        DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
        "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY",
    )]);

    let err = parse_cloudflare_worker_bindings_v1(CloudflareWorkerRoleV1::Router, &env)
        .expect_err("router must reject signer hpke private key env");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ForbiddenLocalBinding);
}

#[test]
fn env_parser_rejects_deriver_a_with_deriver_b_envelope_hpke_private_key_binding() {
    let env = CloudflareEnvMapV1::new(vec![(
        DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
        "DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY",
    )]);

    let err = parse_cloudflare_worker_bindings_v1(CloudflareWorkerRoleV1::DeriverA, &env)
        .expect_err("signer a must reject signer b hpke private key env");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ForbiddenLocalBinding);
}

#[test]
fn env_parser_rejects_deriver_b_with_deriver_a_envelope_hpke_private_key_binding() {
    let env = CloudflareEnvMapV1::new(vec![(
        DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
        "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY",
    )]);

    let err = parse_cloudflare_worker_bindings_v1(CloudflareWorkerRoleV1::DeriverB, &env)
        .expect_err("signer b must reject signer a hpke private key env");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ForbiddenLocalBinding);
}

#[test]
fn env_parser_rejects_missing_required_key() {
    let env = CloudflareEnvMapV1::new(vec![
        (ROUTER_JWT_ISSUER_ENV, "https://issuer.example"),
        (ROUTER_JWT_AUDIENCE_ENV, "router-ab"),
        (ROUTER_JWT_JWKS_JSON_ENV, test_router_jwks_json()),
        (DERIVER_A_PEER_BINDING_ENV, "DERIVER_A"),
    ]);

    let err = parse_cloudflare_worker_bindings_v1(CloudflareWorkerRoleV1::Router, &env)
        .expect_err("missing signer b peer must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MissingLocalBinding);
}

#[test]
fn env_parser_rejects_signer_env_with_router_admission_key() {
    let env = CloudflareEnvMapV1::new(vec![(ROUTER_JWT_ISSUER_ENV, "https://issuer.example")]);

    let err = parse_cloudflare_worker_bindings_v1(CloudflareWorkerRoleV1::DeriverA, &env)
        .expect_err("signer env must reject router admission key");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ForbiddenLocalBinding);
}

#[test]
fn env_parser_rejects_deriver_b_env_with_server_output_key() {
    let env = CloudflareEnvMapV1::new(vec![(
        SIGNING_WORKER_PRESIGN_SESSION_DO_BINDING_ENV,
        "SIGNING_WORKER_PRESIGN_SESSION_DO",
    )]);

    let err = parse_cloudflare_worker_bindings_v1(CloudflareWorkerRoleV1::DeriverB, &env)
        .expect_err("signer b env must reject server-output key");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ForbiddenLocalBinding);
}
