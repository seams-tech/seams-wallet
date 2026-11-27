//! HPKE key-set, rotation and decrypt tests.

use super::*;

#[test]
fn cloudflare_signer_envelope_hpke_public_key_set_parses_from_env() {
    let deriver_a_public_key = x25519_public_key(0x11);
    let deriver_b_public_key = x25519_public_key(0x22);
    let env = CloudflareEnvMapV1::new(vec![
        (
            DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-a".to_string(),
        ),
        (
            DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            deriver_a_public_key.clone(),
        ),
        (
            DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-b".to_string(),
        ),
        (
            DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            deriver_b_public_key.clone(),
        ),
    ]);

    let key_set =
        parse_cloudflare_signer_envelope_hpke_public_key_set_v1(&env).expect("hpke key set");

    assert_eq!(key_set.deriver_a.role, Role::SignerA);
    assert_eq!(key_set.deriver_a.key_epoch, "envelope-hpke-key-epoch-a");
    assert_eq!(key_set.deriver_a.public_key, deriver_a_public_key);
    assert_eq!(key_set.deriver_b.role, Role::SignerB);
    assert_eq!(key_set.deriver_b.key_epoch, "envelope-hpke-key-epoch-b");
    assert_eq!(key_set.deriver_b.public_key, deriver_b_public_key);
}

#[test]
fn router_public_keyset_builds_from_public_env_only() {
    let keyset = build_cloudflare_router_public_keyset_v2(&router_env_with_public_keyset())
        .expect("router public keyset");
    assert_eq!(keyset.keyset_version, "router_ab_keyset_v2");
    assert_eq!(
        keyset.signer_envelope_hpke.current.deriver_a.role,
        Role::SignerA
    );
    assert!(keyset.signer_envelope_hpke.previous.is_none());
    assert_eq!(
        keyset.signing_worker_server_output_hpke.public_key,
        signer_set().selected_server.recipient_encryption_key
    );

    let json = serde_json::to_string(&keyset).expect("keyset JSON");
    for forbidden in [
        "PRIVATE_KEY",
        "hpke-x25519-private-v1",
        "hpke-x25519-server-output-private-v1",
    ] {
        assert!(
            !json.contains(forbidden),
            "router public keyset leaked private descriptor marker `{forbidden}`"
        );
    }
}

#[test]
fn router_bindings_accept_public_keyset_env_without_private_bindings() {
    let bindings = parse_cloudflare_worker_bindings_v1(
        CloudflareWorkerRoleV1::Router,
        &router_env_with_public_keyset(),
    )
    .expect("router bindings with public keyset env");

    assert!(matches!(
        bindings,
        CloudflareWorkerBindingsV1::Router { bindings: _ }
    ));
}

#[test]
fn cloudflare_signer_envelope_hpke_rotation_keyset_accepts_current_and_previous_overlap() {
    let current = CloudflareSignerEnvelopeHpkePublicKeySetV1::new(
        CloudflareSignerEnvelopeHpkePublicKeyV1::new(
            Role::SignerA,
            "envelope-hpke-key-epoch-a-current",
            x25519_public_key(0x11),
        )
        .expect("current signer a"),
        CloudflareSignerEnvelopeHpkePublicKeyV1::new(
            Role::SignerB,
            "envelope-hpke-key-epoch-b-current",
            x25519_public_key(0x22),
        )
        .expect("current signer b"),
    )
    .expect("current keyset");
    let previous = CloudflareSignerEnvelopeHpkePublicKeySetV1::new(
        CloudflareSignerEnvelopeHpkePublicKeyV1::new(
            Role::SignerA,
            "envelope-hpke-key-epoch-a-previous",
            x25519_public_key(0x33),
        )
        .expect("previous signer a"),
        CloudflareSignerEnvelopeHpkePublicKeyV1::new(
            Role::SignerB,
            "envelope-hpke-key-epoch-b-previous",
            x25519_public_key(0x44),
        )
        .expect("previous signer b"),
    )
    .expect("previous keyset");
    let keyset = CloudflareSignerEnvelopeHpkeRotationPublicKeySetV1::current_and_previous(
        current, previous, 2_000,
    )
    .expect("rotation keyset");

    assert_eq!(
        keyset
            .accepted_for_role_epoch(Role::SignerA, "envelope-hpke-key-epoch-a-current", 3_000)
            .expect("current signer a key")
            .public_key,
        x25519_public_key(0x11)
    );
    assert_eq!(
        keyset
            .accepted_for_role_epoch(Role::SignerB, "envelope-hpke-key-epoch-b-previous", 2_000)
            .expect("previous signer b key in overlap")
            .public_key,
        x25519_public_key(0x44)
    );
}

#[test]
fn cloudflare_signer_envelope_hpke_rotation_keyset_rejects_retired_previous_epoch() {
    let env = CloudflareEnvMapV1::new(vec![
        (
            DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-a-current".to_string(),
        ),
        (
            DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            x25519_public_key(0x11),
        ),
        (
            DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-b-current".to_string(),
        ),
        (
            DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            x25519_public_key(0x22),
        ),
        (
            DERIVER_A_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-a-previous".to_string(),
        ),
        (
            DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            x25519_public_key(0x33),
        ),
        (
            DERIVER_B_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-b-previous".to_string(),
        ),
        (
            DERIVER_B_PREVIOUS_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            x25519_public_key(0x44),
        ),
        (
            ROUTER_AB_PREVIOUS_ENVELOPE_HPKE_RETIRE_AT_MS_ENV,
            "2000".to_string(),
        ),
    ]);
    let keyset = parse_cloudflare_signer_envelope_hpke_rotation_public_key_set_v1(&env)
        .expect("rotation public keyset");

    let err = keyset
        .accepted_for_role_epoch(Role::SignerA, "envelope-hpke-key-epoch-a-previous", 2_001)
        .expect_err("retired previous epoch must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::ExpiredLocalRequest);
}

#[test]
fn cloudflare_signer_envelope_hpke_rotation_keyset_rejects_partial_previous_descriptor() {
    let env = CloudflareEnvMapV1::new(vec![
        (
            DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-a-current".to_string(),
        ),
        (
            DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            x25519_public_key(0x11),
        ),
        (
            DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-b-current".to_string(),
        ),
        (
            DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            x25519_public_key(0x22),
        ),
        (
            DERIVER_A_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-a-previous".to_string(),
        ),
    ]);

    let err = parse_cloudflare_signer_envelope_hpke_rotation_public_key_set_v1(&env)
        .expect_err("partial previous descriptor must fail");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::MissingLocalBinding);
}

#[test]
fn cloudflare_signer_envelope_hpke_public_key_set_rejects_role_swap() {
    let err = CloudflareSignerEnvelopeHpkePublicKeySetV1::new(
        CloudflareSignerEnvelopeHpkePublicKeyV1::new(
            Role::SignerB,
            "envelope-hpke-key-epoch-a",
            x25519_public_key(0x11),
        )
        .expect("swapped signer a descriptor"),
        CloudflareSignerEnvelopeHpkePublicKeyV1::new(
            Role::SignerA,
            "envelope-hpke-key-epoch-b",
            x25519_public_key(0x22),
        )
        .expect("swapped signer b descriptor"),
    )
    .expect_err("swapped signer roles must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidRole);
}

#[test]
fn cloudflare_signer_envelope_hpke_decrypt_key_binding_is_role_local() {
    let key = deriver_a_envelope_hpke_decrypt_key();

    key.validate_visible_to(CloudflareWorkerRoleV1::DeriverA)
        .expect("signer a can access signer a hpke key");
    let err = key
        .validate_visible_to(CloudflareWorkerRoleV1::Router)
        .expect_err("router must not access signer hpke key");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::ForbiddenLocalBinding);
}

#[test]
fn cloudflare_signer_envelope_hpke_decrypt_key_parses_from_role_env() {
    let public_key = x25519_public_key(0x11);
    let env = CloudflareEnvMapV1::new(vec![
        (
            DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
            "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY".to_string(),
        ),
        (
            DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-a".to_string(),
        ),
        (DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY_ENV, public_key.clone()),
    ]);

    let key = parse_cloudflare_signer_envelope_hpke_decrypt_key_binding_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &env,
    )
    .expect("signer a hpke decrypt key");

    assert_eq!(key.role, Role::SignerA);
    assert_eq!(key.binding_name, "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY");
    assert_eq!(key.key_epoch, "envelope-hpke-key-epoch-a");
    assert_eq!(key.public_key, public_key);
}

#[test]
fn cloudflare_signer_envelope_hpke_decrypt_key_set_parses_current_only() {
    let key_set = parse_cloudflare_signer_envelope_hpke_decrypt_key_binding_set_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &deriver_a_env(),
    )
    .expect("signer a hpke decrypt key set");

    assert_eq!(key_set.current, deriver_a_envelope_hpke_decrypt_key());
    assert_eq!(key_set.previous, None);
    assert_eq!(key_set.previous_retire_at_ms, None);
}

#[test]
fn cloudflare_signer_envelope_hpke_decrypt_key_set_parses_previous_overlap() {
    let env = deriver_a_env().with_overrides(vec![
        (
            DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
            "DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PRIVATE_KEY".to_string(),
        ),
        (
            DERIVER_A_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
            "envelope-hpke-key-epoch-a-previous".to_string(),
        ),
        (
            DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
            x25519_public_key(0x33),
        ),
        (
            ROUTER_AB_PREVIOUS_ENVELOPE_HPKE_RETIRE_AT_MS_ENV,
            "2000".to_string(),
        ),
    ]);

    let key_set = parse_cloudflare_signer_envelope_hpke_decrypt_key_binding_set_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &env,
    )
    .expect("signer a rotating hpke decrypt key set");

    assert_eq!(key_set.current, deriver_a_envelope_hpke_decrypt_key());
    let previous = key_set.previous.expect("previous hpke decrypt key");
    assert_eq!(
        previous.binding_name,
        "DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PRIVATE_KEY"
    );
    assert_eq!(previous.key_epoch, "envelope-hpke-key-epoch-a-previous");
    assert_eq!(previous.public_key, x25519_public_key(0x33));
    assert_eq!(key_set.previous_retire_at_ms, Some(2_000));
}

#[test]
fn cloudflare_signer_envelope_hpke_decrypt_key_set_rejects_partial_previous_overlap() {
    let env = deriver_a_env().with_overrides(vec![(
        DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
        "DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PRIVATE_KEY".to_string(),
    )]);

    let err = parse_cloudflare_signer_envelope_hpke_decrypt_key_binding_set_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &env,
    )
    .expect_err("partial previous private keyset must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MissingLocalBinding);
}

#[test]
fn cloudflare_signer_envelope_hpke_decrypt_key_set_selects_previous_until_retired() {
    let previous = CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1::new(
        Role::SignerA,
        "DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PRIVATE_KEY",
        "envelope-hpke-key-epoch-a-previous",
        x25519_public_key(0x33),
    )
    .expect("previous signer a hpke decrypt key");
    let key_set = CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1::current_and_previous(
        deriver_a_envelope_hpke_decrypt_key(),
        previous.clone(),
        2_000,
    )
    .expect("rotating signer a hpke key set");
    let payload = signer_envelope_hpke_payload(
        Role::SignerA,
        "envelope-hpke-key-epoch-a-previous",
        &x25519_public_key(0x33),
        digest(0x11),
    );

    let selected = key_set
        .accepted_binding_for_payload(CloudflareWorkerRoleV1::DeriverA, &payload, 2_000)
        .expect("previous key accepted before retirement");
    assert_eq!(selected, &previous);

    let err = key_set
        .accepted_binding_for_payload(CloudflareWorkerRoleV1::DeriverA, &payload, 2_001)
        .expect_err("previous key rejected after retirement");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::ExpiredLocalRequest);
}

#[test]
fn cloudflare_signer_envelope_hpke_decrypt_key_set_decodes_current_message() {
    let message = signer_private_request_with_hpke_envelope(WireMessageKindV1::RouterToSignerA);
    let key_set = deriver_a_envelope_hpke_decrypt_key_set();

    let (selected, payload) =
        decode_and_select_cloudflare_signer_envelope_hpke_decrypt_key_binding_v1(
            CloudflareWorkerRoleV1::DeriverA,
            &message,
            &key_set,
            1_500,
        )
        .expect("current signer a key selected");

    assert_eq!(selected, &deriver_a_envelope_hpke_decrypt_key());
    assert_eq!(payload.key_epoch, "envelope-hpke-key-epoch-a");
}

#[test]
fn cloudflare_signer_envelope_hpke_decrypt_key_set_opens_current_and_previous() {
    let (current_private_key, current_public_key) = hpke_keypair(0x42);
    let (previous_private_key, previous_public_key) = hpke_keypair(0x43);
    let current = CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1::new(
        Role::SignerA,
        "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY",
        "envelope-hpke-key-epoch-a-current",
        current_public_key,
    )
    .expect("current signer a hpke decrypt key");
    let previous = CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1::new(
        Role::SignerA,
        "DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PRIVATE_KEY",
        "envelope-hpke-key-epoch-a-previous",
        previous_public_key,
    )
    .expect("previous signer a hpke decrypt key");
    let key_set = CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1::current_and_previous(
        current.clone(),
        previous.clone(),
        2_000,
    )
    .expect("rotating signer a hpke key set");
    let expected_plaintext = signer_input_plaintext_bytes(Role::SignerA);

    let (current_message, current_aad) =
        deriver_a_private_request_with_sealed_hpke_envelope_for_key(
            &current.key_epoch,
            &current.public_key,
            &expected_plaintext,
        );
    let (current_selected, _) =
        decode_and_select_cloudflare_signer_envelope_hpke_decrypt_key_binding_v1(
            CloudflareWorkerRoleV1::DeriverA,
            &current_message,
            &key_set,
            1_500,
        )
        .expect("current key selected");
    assert_eq!(current_selected, &current);
    let current_plaintext = open_cloudflare_signer_envelope_hpke_payload_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &current_message,
        current_selected,
        &current_aad,
        &current_private_key,
    )
    .expect("current key opens");
    assert_eq!(current_plaintext, expected_plaintext);

    let (previous_message, previous_aad) =
        deriver_a_private_request_with_sealed_hpke_envelope_for_key(
            &previous.key_epoch,
            &previous.public_key,
            &expected_plaintext,
        );
    let (previous_selected, _) =
        decode_and_select_cloudflare_signer_envelope_hpke_decrypt_key_binding_v1(
            CloudflareWorkerRoleV1::DeriverA,
            &previous_message,
            &key_set,
            2_000,
        )
        .expect("previous key selected during overlap");
    assert_eq!(previous_selected, &previous);
    let previous_plaintext = open_cloudflare_signer_envelope_hpke_payload_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &previous_message,
        previous_selected,
        &previous_aad,
        &previous_private_key,
    )
    .expect("previous key opens during overlap");
    assert_eq!(previous_plaintext, expected_plaintext);

    let err = decode_and_select_cloudflare_signer_envelope_hpke_decrypt_key_binding_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &previous_message,
        &key_set,
        2_001,
    )
    .expect_err("previous key must fail after retirement");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::ExpiredLocalRequest);
}

#[test]
fn cloudflare_signer_envelope_hpke_payload_accepts_bound_public_metadata() {
    let message = signer_private_request_with_hpke_envelope(WireMessageKindV1::RouterToSignerA);

    let parsed = decode_and_validate_cloudflare_signer_envelope_hpke_payload_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &message,
        &deriver_a_envelope_hpke_decrypt_key(),
    )
    .expect("validated HPKE payload");

    assert_eq!(parsed.recipient_role, Role::SignerA);
    assert_eq!(parsed.key_epoch, "envelope-hpke-key-epoch-a");
    assert_eq!(parsed.recipient_public_key, x25519_public_key(0x11));
    assert_eq!(parsed.aad_digest, digest(0x11));
}

#[test]
fn cloudflare_signer_envelope_hpke_payload_rejects_wrong_public_key() {
    let message = signer_private_request_with_hpke_envelope(WireMessageKindV1::RouterToSignerA);
    let key = CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1::new(
        Role::SignerA,
        "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY",
        "envelope-hpke-key-epoch-a",
        x25519_public_key(0x33),
    )
    .expect("wrong signer a hpke key descriptor");

    let err = decode_and_validate_cloudflare_signer_envelope_hpke_payload_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &message,
        &key,
    )
    .expect_err("wrong hpke public key must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::InvalidSignerIdentity);
}

#[test]
fn cloudflare_signer_envelope_hpke_seal_open_round_trips_plaintext() {
    let (private_key, public_key) = hpke_keypair(0x42);
    let expected_plaintext = signer_input_plaintext_bytes(Role::SignerA);
    let (message, aad) =
        deriver_a_private_request_with_sealed_hpke_envelope(&public_key, &expected_plaintext);
    let key = CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1::new(
        Role::SignerA,
        "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY",
        "envelope-hpke-key-epoch-a",
        public_key,
    )
    .expect("signer a hpke decrypt key");

    let plaintext = open_cloudflare_signer_envelope_hpke_payload_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &message,
        &key,
        &aad,
        &private_key,
    )
    .expect("hpke signer envelope opens");

    assert_eq!(plaintext, expected_plaintext);
}

#[test]
fn cloudflare_signer_envelope_hpke_open_rejects_wrong_aad() {
    let (private_key, public_key) = hpke_keypair(0x42);
    let expected_plaintext = signer_input_plaintext_bytes(Role::SignerA);
    let (message, mut aad) =
        deriver_a_private_request_with_sealed_hpke_envelope(&public_key, &expected_plaintext);
    aad.expires_at_ms += 1;
    let key = CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1::new(
        Role::SignerA,
        "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY",
        "envelope-hpke-key-epoch-a",
        public_key,
    )
    .expect("signer a hpke decrypt key");

    let err = open_cloudflare_signer_envelope_hpke_payload_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &message,
        &key,
        &aad,
        &private_key,
    )
    .expect_err("modified AAD must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MalformedWirePayload);
}

#[test]
fn cloudflare_signer_envelope_hpke_open_rejects_wrong_private_key() {
    let (_, public_key) = hpke_keypair(0x42);
    let (wrong_private_key, _) = hpke_keypair(0x43);
    let expected_plaintext = signer_input_plaintext_bytes(Role::SignerA);
    let (message, aad) =
        deriver_a_private_request_with_sealed_hpke_envelope(&public_key, &expected_plaintext);
    let key = CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1::new(
        Role::SignerA,
        "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY",
        "envelope-hpke-key-epoch-a",
        public_key,
    )
    .expect("signer a hpke decrypt key");

    let err = open_cloudflare_signer_envelope_hpke_payload_v1(
        CloudflareWorkerRoleV1::DeriverA,
        &message,
        &key,
        &aad,
        &wrong_private_key,
    )
    .expect_err("wrong private key must fail");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::MalformedWirePayload);
}

#[test]
fn cloudflare_signer_envelope_hpke_private_key_secret_round_trips() {
    let (private_key, _) = hpke_keypair(0x42);

    let encoded = encode_cloudflare_signer_envelope_hpke_private_key_secret_v1(&private_key)
        .expect("private key secret encodes");
    let decoded = decode_cloudflare_signer_envelope_hpke_private_key_secret_v1(&encoded)
        .expect("private key secret decodes");

    assert!(encoded.starts_with(CLOUDFLARE_SIGNER_ENVELOPE_HPKE_PRIVATE_KEY_SECRET_PREFIX_V1));
    assert_eq!(decoded, private_key);
}

#[test]
fn cloudflare_server_output_hpke_private_key_secret_round_trips() {
    let (private_key, _) = hpke_keypair(0x43);

    let encoded = encode_cloudflare_server_output_hpke_private_key_secret_v1(&private_key)
        .expect("server-output private key secret encodes");
    let decoded = decode_cloudflare_server_output_hpke_private_key_secret_v1(&encoded)
        .expect("server-output private key secret decodes");

    assert!(encoded.starts_with(CLOUDFLARE_SERVER_OUTPUT_HPKE_PRIVATE_KEY_SECRET_PREFIX_V1));
    assert_eq!(decoded, private_key);
}

#[test]
fn cloudflare_signer_envelope_hpke_private_key_secret_rejects_bad_prefix() {
    let (private_key, _) = hpke_keypair(0x42);
    let encoded = format!("wrong-prefix:{}", lower_hex(&private_key));

    let err = decode_cloudflare_signer_envelope_hpke_private_key_secret_v1(&encoded)
        .expect_err("wrong private key secret prefix must fail");

    assert_eq!(
        err.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}
