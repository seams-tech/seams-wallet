//! Shared constants, signing, HPKE, JWT and admission fixtures for the binding tests.

use super::*;

pub(super) const TEST_ACTIVATED_AT_MS: u64 = 1_000;

pub(super) const ROUTER_AB_ECDSA_DERIVATION_WALLET_KEY_ID: &str = "wallet-key-1";

pub(super) const ROUTER_AB_ECDSA_DERIVATION_WALLET_ID: &str = "wallet-1";

pub(super) const ROUTER_AB_ECDSA_DERIVATION_THRESHOLD_KEY_ID: &str = "ecdsa-key-1";

pub(super) const ROUTER_AB_ECDSA_DERIVATION_SIGNING_ROOT_ID: &str = "signing-root-1";

pub(super) const ROUTER_AB_ECDSA_DERIVATION_SIGNING_ROOT_VERSION: &str = "root-version-1";

pub(super) fn root_epoch() -> RootShareEpoch {
    RootShareEpoch::new("epoch-1").expect("root epoch")
}

pub(super) fn next_root_epoch() -> RootShareEpoch {
    RootShareEpoch::new("epoch-2").expect("next root epoch")
}

pub(super) fn digest(byte: u8) -> PublicDigest32 {
    PublicDigest32::new([byte; 32])
}

pub(super) fn active_signing_worker_state_for_activation(
    activation: &CloudflareSigningWorkerRecipientProofBundleActivationRequestV1,
    material_handle: impl Into<String>,
) -> ActiveSigningWorkerStateV1 {
    cloudflare_active_signing_worker_state_from_activation_request_v1(
        activation,
        activation.material_activation.clone(),
        material_handle,
        TEST_ACTIVATED_AT_MS,
    )
    .expect("active SigningWorker state")
}

pub(super) fn normal_signing_scope() -> NormalSigningScopeV1 {
    normal_signing_scope_for_request_id("sign-request-1")
}

pub(super) fn normal_signing_scope_for_request_id(request_id: &str) -> NormalSigningScopeV1 {
    NormalSigningScopeV1::new(
        request_id,
        "account.near",
        NormalSigningAuthorizationV1::reusable_wallet_session("wallet-session-1")
            .expect("normal signing authorization"),
        MpcMaterialActivationRefV1::new(
            "session-1",
            "ed25519-signing-capability-1",
            "account.near",
            "ed25519-public-key-1",
            "ed25519-material-lifecycle-1",
            "server-a",
        )
        .expect("normal signing material activation"),
        "server-a",
    )
    .expect("normal signing scope")
}

pub(super) fn normal_signing_v2_wallet_session(expires_at_ms: u64) -> CloudflareRouterVerifiedWalletSessionV1 {
    CloudflareRouterVerifiedWalletSessionV1::new(
        "user-1",
        "account.near",
        "authorization-1",
        "wallet-session-1",
        "quota-1",
        "threshold-session-1",
        "org-1",
        "project-1",
        "dev",
        "near-ed25519",
        "server-a",
        digest(0x90),
        expires_at_ms,
    )
    .expect("wallet session")
}

pub(super) fn ecdsa_wallet_session(expires_at_ms: u64) -> CloudflareRouterVerifiedWalletSessionV1 {
    CloudflareRouterVerifiedWalletSessionV1::new(
        "wallet-1",
        "wallet-1",
        "authorization-1",
        "wallet-session-1",
        "quota-1",
        "ecdsa-material-lifecycle-1",
        "org-1",
        "project-1",
        "dev",
        "evm-family",
        "server-a",
        digest(0x90),
        expires_at_ms,
    )
    .expect("ECDSA wallet session")
}

pub(super) fn normal_signing_v2_prepare_request(
    expires_at_ms: u64,
) -> RouterAbEd25519NormalSigningPrepareRequestV2 {
    normal_signing_v2_prepare_request_for_id("sign-request-1", expires_at_ms)
}

pub(super) fn normal_signing_v2_prepare_request_for_id(
    request_id: &str,
    expires_at_ms: u64,
) -> RouterAbEd25519NormalSigningPrepareRequestV2 {
    let unsigned_transaction_borsh = normal_signing_v2_unsigned_transaction_borsh();
    let unsigned_transaction_borsh_b64u = b64u(&unsigned_transaction_borsh);
    let intent = RouterAbEd25519NormalSigningIntentV2::NearTransactionV1 {
        operation_id: "operation-1".to_owned(),
        operation_fingerprint: "fingerprint-1".to_owned(),
        near_account_id: "account.near".to_owned(),
        near_network_id: RouterAbNearNetworkIdV2::Testnet,
        transactions: vec![RouterAbNearTransactionIntentV1::new(
            "receiver.near",
            normal_signing_v2_action_fingerprint(),
        )
        .expect("near transaction intent")],
        unsigned_transaction_borsh_b64u: unsigned_transaction_borsh_b64u.clone(),
    };
    let signing_payload = RouterAbEd25519SigningPayloadV2::NearUnsignedTransactionBorshV1 {
        unsigned_transaction_borsh_b64u,
        expected_signing_digest_b64u: sha256_digest_b64u(&unsigned_transaction_borsh),
    };
    RouterAbEd25519NormalSigningPrepareRequestV2::new(
        normal_signing_scope_for_request_id(request_id),
        expires_at_ms,
        digest(0x91),
        intent,
        signing_payload,
    )
    .expect("normal signing v2 prepare request")
}

pub(super) fn normal_signing_v2_finalize_request(
    expires_at_ms: u64,
) -> RouterAbEd25519NormalSigningFinalizeRequestV2 {
    let prepare = normal_signing_v2_prepare_request(expires_at_ms);
    let material = prepare.admission_material().expect("admission material");
    let prepare_binding = RouterAbEd25519NormalSigningPrepareBindingV2::new(
        "server-round1/sign-request-1",
        prepare.round1_binding_digest().expect("round1 binding"),
        material.intent_digest,
        material.signing_payload_digest,
    )
    .expect("prepare binding");
    let protocol = RouterAbEd25519NormalSigningFinalizeProtocolV2::Ed25519TwoPartyFrostFinalizeV1(
        RouterAbEd25519TwoPartyFrostFinalizeProtocolV2::new(
            NormalSigningEd25519TwoPartyFrostCommitmentsV1::new(
                b64u(&[0x11; 32]),
                b64u(&[0x12; 32]),
            )
            .expect("client commitments"),
            NormalSigningEd25519TwoPartyFrostCommitmentsV1::new(
                b64u(&[0x21; 32]),
                b64u(&[0x22; 32]),
            )
            .expect("server commitments"),
            b64u(&[0x31; 32]),
            b64u(&[0x32; 32]),
            b64u(&[0x41; 32]),
        )
        .expect("v2 finalize protocol"),
    );
    RouterAbEd25519NormalSigningFinalizeRequestV2::new(
        normal_signing_scope(),
        expires_at_ms,
        prepare_binding,
        protocol,
    )
    .expect("normal signing v2 finalize request")
}

pub(super) fn active_signing_worker_state_for_normal_signing() -> ActiveSigningWorkerStateV1 {
    active_signing_worker_state_for_normal_signing_account_public_key(
        "ed25519:11111111111111111111111111111111",
    )
}

pub(super) fn active_signing_worker_state_for_normal_signing_account_public_key(
    account_public_key: impl Into<String>,
) -> ActiveSigningWorkerStateV1 {
    ActiveSigningWorkerStateV1::new(
        "account.near",
        MpcMaterialActivationRefV1::new(
            "session-1",
            "ed25519-signing-capability-1",
            "account.near",
            "ed25519-public-key-1",
            "ed25519-material-lifecycle-1",
            "server-a",
        )
        .expect("active SigningWorker material activation"),
        account_public_key,
        signer_set().selected_server,
        digest(0x81),
        digest(0x82),
        "server-output/lifecycle-1/material",
        TEST_ACTIVATED_AT_MS,
    )
    .expect("active SigningWorker state")
}

pub(super) fn active_signing_worker_state_for_normal_signing_public_key(
    public_key: [u8; 32],
) -> ActiveSigningWorkerStateV1 {
    active_signing_worker_state_for_normal_signing_account_public_key(format!(
        "ed25519:{}",
        bs58::encode(public_key).into_string()
    ))
}

pub(super) fn normal_signing_round1_state() -> CloudflareEd25519Round1StateV1 {
    let signing_share =
        frost_ed25519::keys::SigningShare::deserialize(&scalar_bytes(5)).expect("signing share");
    let mut rng = rand_chacha::ChaCha20Rng::from_seed([0x5a; 32]);
    let (nonces, commitments) = frost_ed25519::round1::commit(&signing_share, &mut rng);
    CloudflareEd25519Round1StateV1::new(nonces, commitments).expect("round1 state")
}

pub(super) type NormalSigningFrostFixture = (
    [u8; 32],
    [u8; 32],
    [u8; 32],
    [u8; 32],
    [u8; 32],
    ClientRound1State,
    CloudflareEd25519Round1StateV1,
);

pub(super) fn normal_signing_frost_fixture() -> NormalSigningFrostFixture {
    let client_scalar = scalar_bytes(7);
    let server_scalar = scalar_bytes(5);
    let client_verifying_share = verifying_share_bytes_from_signing_share_bytes(&client_scalar);
    let server_verifying_share = verifying_share_bytes_from_signing_share_bytes(&server_scalar);
    let group_public_key = compute_threshold_ed25519_group_public_key_2p_from_verifying_shares(
        &client_verifying_share,
        &server_verifying_share,
        1,
        2,
    )
    .expect("group public key");
    let client_identifier = frost_ed25519::Identifier::try_from(1_u16).expect("client identifier");
    let client_key_package =
        key_package_from_signing_share_bytes(&client_scalar, &group_public_key, client_identifier)
            .expect("client key package");
    let client_round1 = client_round1_commit(&client_key_package).expect("client round1");
    (
        client_scalar,
        server_scalar,
        client_verifying_share,
        server_verifying_share,
        group_public_key,
        client_round1,
        normal_signing_round1_state(),
    )
}

pub(super) fn normal_signing_client_signature_share(
    client_scalar: &[u8; 32],
    group_public_key: &[u8; 32],
    client_round1: &ClientRound1State,
    server_round1: &CloudflareEd25519Round1StateV1,
    message: &[u8],
) -> String {
    let client_identifier = frost_ed25519::Identifier::try_from(1_u16).expect("client identifier");
    let signing_worker_identifier =
        frost_ed25519::Identifier::try_from(2_u16).expect("SigningWorker identifier");
    let client_key_package =
        key_package_from_signing_share_bytes(client_scalar, group_public_key, client_identifier)
            .expect("client key package");
    let server_commitments = frost_ed25519::round1::SigningCommitments::new(
        frost_ed25519::round1::NonceCommitment::deserialize(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(&server_round1.commitments.hiding)
                .expect("hiding commitment"),
        )
        .expect("hiding commitment point"),
        frost_ed25519::round1::NonceCommitment::deserialize(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(&server_round1.commitments.binding)
                .expect("binding commitment"),
        )
        .expect("binding commitment point"),
    );
    let signing_package = build_signing_package(
        message,
        BTreeMap::from([
            (client_identifier, client_round1.commitments),
            (signing_worker_identifier, server_commitments),
        ]),
    );
    let share =
        client_round2_signature_share(&signing_package, &client_round1.nonces, &client_key_package)
            .expect("client signature share");
    signature_share_to_b64u(&share).expect("signature share encoding")
}

pub(super) fn scalar_bytes(value: u64) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes[..8].copy_from_slice(&value.to_le_bytes());
    bytes
}

pub(super) fn request_context_digest(request: &EcdsaThresholdPrfRequestV1) -> PublicDigest32 {
    request
        .request_context_digest()
        .expect("request context digest")
}

pub(super) fn role_envelope_aad_for_request(
    role: Role,
    request: &EcdsaThresholdPrfRequestV1,
) -> RoleEnvelopeAadV1 {
    let (payload_a, payload_b) = request.to_signer_payloads().expect("signer payloads");
    let payload = match role {
        Role::SignerA => payload_a,
        Role::SignerB => payload_b,
        _ => panic!("test helper requires signer role"),
    };
    let assignment = payload.assignment();
    RoleEnvelopeAadV1::new(
        payload.lifecycle().lifecycle_id.clone(),
        payload.lifecycle().work_kind,
        payload.signer_set().signer_set_id.clone(),
        assignment.signer.clone(),
        payload.signer_set().selected_server.clone(),
        payload.transcript_digest(),
        request_context_digest(request),
        request.expires_at_ms,
    )
    .expect("role envelope aad")
}

pub(super) fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

pub(super) fn control_plane_verifying_key_hex(seed: u8) -> String {
    lower_hex(
        &SigningKey::from_bytes(&[seed; 32])
            .verifying_key()
            .to_bytes(),
    )
}

pub(super) fn x25519_public_key(byte: u8) -> String {
    let mut out = String::from("x25519:");
    for _ in 0..32 {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub(super) fn hpke_keypair(seed: u8) -> ([u8; 32], String) {
    let (private_key, public_key) =
        DhKemX25519HkdfSha256::derive_key_pair(&[seed; 32]).expect("hpke keypair derives");
    let private_key_bytes = DhKemX25519HkdfSha256::sk_to_bytes(&private_key);
    let mut private_key_out = [0u8; 32];
    private_key_out.copy_from_slice(&private_key_bytes);
    let public_key = format!(
        "x25519:{}",
        lower_hex(&DhKemX25519HkdfSha256::pk_to_bytes(&public_key))
    );
    (private_key_out, public_key)
}

pub(super) fn signer_identity(role: Role) -> SignerIdentityV1 {
    match role {
        Role::SignerA => {
            SignerIdentityV1::new(Role::SignerA, "signer-a", "key-epoch-a").expect("signer a")
        }
        Role::SignerB => {
            SignerIdentityV1::new(Role::SignerB, "signer-b", "key-epoch-b").expect("signer b")
        }
        _ => panic!("signer role"),
    }
}

pub(super) fn presign_session_binding(binding_name: &str) -> CloudflareSigningWorkerPresignSessionBindingV1 {
    CloudflareSigningWorkerPresignSessionBindingV1::new(
        binding_name,
        format!("{binding_name}-object"),
        format!("{binding_name}:"),
    )
    .expect("durable object binding")
}

pub(super) fn peer(peer_role: CloudflareWorkerRoleV1, binding_name: &str) -> CloudflarePeerBindingV1 {
    CloudflarePeerBindingV1::new(peer_role, binding_name).expect("peer binding")
}

pub(super) fn root_share_metadata(role: Role) -> CloudflareRootShareStartupMetadataV1 {
    let (signer_id, key_epoch, storage_key) = match role {
        Role::SignerA => ("signer-a", "key-epoch-a", "sealed/share/a"),
        Role::SignerB => ("signer-b", "key-epoch-b", "sealed/share/b"),
        _ => panic!("test root-share metadata requires signer role"),
    };
    CloudflareRootShareStartupMetadataV1::new(
        "signer-set-v1",
        role,
        signer_id,
        key_epoch,
        root_epoch(),
        storage_key,
    )
    .expect("root-share startup metadata")
}

pub(super) fn signing_worker_presign_session_binding() -> CloudflareSigningWorkerPresignSessionBindingV1 {
    presign_session_binding("SIGNING_WORKER_PRESIGN_SESSION_DO")
}

pub(super) fn deriver_a_envelope_hpke_decrypt_key() -> CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1 {
    CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1::new(
        Role::SignerA,
        "DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY",
        "envelope-hpke-key-epoch-a",
        x25519_public_key(0x11),
    )
    .expect("signer a hpke envelope decrypt key")
}

pub(super) fn deriver_a_envelope_hpke_decrypt_key_set() -> CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1 {
    CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1::current_only(
        deriver_a_envelope_hpke_decrypt_key(),
    )
    .expect("signer a hpke envelope decrypt key set")
}

pub(super) fn deriver_b_envelope_hpke_decrypt_key() -> CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1 {
    CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1::new(
        Role::SignerB,
        "DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY",
        "envelope-hpke-key-epoch-b",
        x25519_public_key(0x22),
    )
    .expect("signer b hpke envelope decrypt key")
}

pub(super) fn server_output_hpke_decrypt_key() -> CloudflareServerOutputHpkeDecryptKeyBindingV1 {
    let server = &signer_set().selected_server;
    CloudflareServerOutputHpkeDecryptKeyBindingV1::new(
        "SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY",
        server.key_epoch.clone(),
        server.recipient_encryption_key.clone(),
    )
    .expect("server-output hpke decrypt key")
}

pub(super) fn router_runtime() -> CloudflareRouterWorkerRuntimeV1 {
    CloudflareRouterWorkerRuntimeV1::new(
        CloudflareRouterBindingsV1::new(
            router_admission_bindings(),
            peer(CloudflareWorkerRoleV1::DeriverA, "DERIVER_A"),
            peer(CloudflareWorkerRoleV1::DeriverB, "DERIVER_B"),
            peer(CloudflareWorkerRoleV1::SigningWorker, "SIGNING_WORKER"),
            issuer_verifying_keys(),
        )
        .expect("router bindings"),
    )
    .expect("router runtime")
}

pub(super) fn router_runtime_with_project_policy(
    allowed_work_kinds: &str,
    allow_normal_signing: bool,
) -> CloudflareRouterWorkerRuntimeV1 {
    let env = router_env().with_overrides(vec![(
        ROUTER_PROJECT_POLICY_BOOTSTRAP_JSON_ENV,
        configured_project_policy_json(allowed_work_kinds, allow_normal_signing),
    )]);
    let admission = parse_cloudflare_router_admission_bindings_v1(&env)
        .expect("configured router admission bindings");
    CloudflareRouterWorkerRuntimeV1::new(
        CloudflareRouterBindingsV1::new(
            admission,
            peer(CloudflareWorkerRoleV1::DeriverA, "DERIVER_A"),
            peer(CloudflareWorkerRoleV1::DeriverB, "DERIVER_B"),
            peer(CloudflareWorkerRoleV1::SigningWorker, "SIGNING_WORKER"),
            issuer_verifying_keys(),
        )
        .expect("router bindings"),
    )
    .expect("router runtime")
}

pub(super) fn lifecycle_state() -> RouterAbLifecycleStateV1 {
    RouterAbLifecycleStateV1::requested(
        LifecycleScopeV1::new(
            "lifecycle-1",
            ExpensiveWorkKindV1::RegistrationPrepare,
            root_epoch(),
            "account.near",
            "session-1",
            "signer-set-v1",
            "server-a",
        )
        .expect("lifecycle scope"),
    )
    .expect("lifecycle state")
}

pub(super) fn lifecycle_scope() -> LifecycleScopeV1 {
    lifecycle_state().scope().clone()
}

pub(super) fn signer_set() -> SignerSetV1 {
    SignerSetV1::v1_all2(
        "signer-set-v1",
        SignerIdentityV1::new(Role::SignerA, "signer-a", "key-epoch-a").expect("signer a"),
        SignerIdentityV1::new(Role::SignerB, "signer-b", "key-epoch-b").expect("signer b"),
        ServerIdentityV1::new(
            "server-a",
            "server-epoch",
            "x25519:1111111111111111111111111111111111111111111111111111111111111111",
        )
        .expect("server"),
    )
    .expect("signer set")
}

pub(super) fn transcript_metadata() -> RouterTranscriptMetadataV1 {
    RouterTranscriptMetadataV1::new(
        "near-mainnet",
        ecdsa_application_binding_digest_b64u(),
        "router-1",
        "client-1",
        "x25519:client-ephemeral-public-key",
    )
    .expect("transcript metadata")
}

pub(super) fn public_request_transcript_digest(
    lifecycle: &LifecycleScopeV1,
    signer_set: &SignerSetV1,
) -> PublicDigest32 {
    router_transcript_digest_v1(lifecycle, signer_set, &transcript_metadata(), root_epoch())
        .expect("public request transcript digest")
}

pub(super) fn trusted_admission(decision: ExpensiveWorkGateDecisionV1) -> CloudflareRouterTrustedAdmissionV1 {
    CloudflareRouterTrustedAdmissionV1::new(
        ExpensiveWorkGateContextV1::new(
            ExpensiveWorkKindV1::RegistrationPrepare,
            "org-1",
            "project-1",
            "dev",
            "account.near",
            GatePrincipalV1::router_jwt_session("user-1", "session-1").expect("principal"),
            digest(0x90),
        )
        .expect("gate context"),
        decision,
    )
    .expect("trusted admission")
}

pub(super) fn trusted_metadata() -> CloudflareRouterTrustedRequestMetadataV1 {
    CloudflareRouterTrustedRequestMetadataV1::new(
        ExpensiveWorkKindV1::RegistrationPrepare,
        "org-1",
        "project-1",
        "dev",
        "account.near",
        CloudflareRouterAuthContextV1::router_jwt_session("user-1", "session-1")
            .expect("auth context"),
        digest(0x90),
    )
    .expect("trusted metadata")
}

pub(super) type TestCompositeAdmissionProvider = CloudflareRouterCompositeAdmissionProviderV1<
    CloudflareRouterVerifiedSessionProviderV1,
    CloudflareRouterAllowedWorkKindsProjectPolicyProviderV1,
    CloudflareRouterConfiguredAbuseProviderV1,
    CloudflareRouterConfiguredQuotaProviderV1,
>;

pub(super) fn verified_jwt_claims(session_id: &str, account_id: &str) -> CloudflareRouterVerifiedJwtClaimsV1 {
    CloudflareRouterVerifiedJwtClaimsV1::new(
        1,
        "user-1",
        session_id,
        "org-1",
        "project-1",
        "dev",
        account_id,
        digest(0x90),
    )
    .expect("verified claims")
}

pub(super) fn encode_jwt_segment(value: &serde_json::Value) -> String {
    let bytes = serde_json::to_vec(value).expect("json segment");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub(super) fn b64u(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub(super) fn ecdsa_application_binding_digest_b64u() -> String {
    b64u(&[0x42; 32])
}

pub(super) fn sha256_public_digest(bytes: &[u8]) -> PublicDigest32 {
    let digest = Sha256::digest(bytes);
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    PublicDigest32::new(out)
}

pub(super) fn sha256_digest_b64u(bytes: &[u8]) -> String {
    b64u(sha256_public_digest(bytes).as_bytes())
}

pub(super) fn push_borsh_string(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value.as_bytes());
}

pub(super) fn push_borsh_bytes(out: &mut Vec<u8>, value: &[u8]) {
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value);
}

pub(super) fn normal_signing_v2_unsigned_transaction_borsh() -> Vec<u8> {
    let mut out = Vec::new();
    push_borsh_string(&mut out, "account.near");
    out.push(0);
    out.extend_from_slice(&[0; 32]);
    out.extend_from_slice(&7_u64.to_le_bytes());
    push_borsh_string(&mut out, "receiver.near");
    out.extend_from_slice(&[0x44; 32]);
    out.extend_from_slice(&1_u32.to_le_bytes());
    out.push(2);
    push_borsh_string(&mut out, "transfer");
    push_borsh_bytes(&mut out, br#"{"amount":"1"}"#);
    out.extend_from_slice(&30_000_000_000_000_u64.to_le_bytes());
    out.extend_from_slice(&0_u128.to_le_bytes());
    out
}

pub(super) fn normal_signing_v2_action_fingerprint() -> String {
    sha256_digest_b64u(
        r#"[{"action_type":"FunctionCall","args":"{\"amount\":\"1\"}","deposit":"0","gas":"30000000000000","method_name":"transfer"}]"#
            .as_bytes(),
    )
}

pub(super) fn ed25519_jwks_json(signing_key: &SigningKey, key_id: &str) -> String {
    let public_key = signing_key.verifying_key().to_bytes();
    serde_json::json!({
        "keys": [{
            "kty": "OKP",
            "crv": "Ed25519",
            "kid": key_id,
            "alg": "EdDSA",
            "use": "sig",
            "x": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(public_key),
        }]
    })
    .to_string()
}

pub(super) fn ed25519_jwt(signing_key: &SigningKey, key_id: &str, claims: serde_json::Value) -> String {
    let header = encode_jwt_segment(&serde_json::json!({
        "alg": "EdDSA",
        "kid": key_id,
        "typ": "JWT",
    }));
    let payload = encode_jwt_segment(&claims);
    let signing_input = format!("{header}.{payload}");
    let signature = signing_key.sign(signing_input.as_bytes()).to_bytes();
    let signature = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(signature);
    format!("{signing_input}.{signature}")
}

pub(super) fn valid_router_jwt_claims() -> serde_json::Value {
    let request = ecdsa_threshold_prf_request(2_000);
    serde_json::json!({
        "iss": "https://issuer.example",
        "sub": "user-1",
        "aud": "router-ab",
        "exp": 3,
        "nbf": 1,
        "iat": 1,
        "sid": "session-1",
        "org_id": "org-1",
        "project_id": "project-1",
        "environment": "dev",
        "account_id": "account.near",
        "ownership_generation": 1,
        "routerAbRequestPolicy": {
            "policyVersion": "policy-v1",
            "workKind": request.lifecycle.work_kind,
            "requestDigest": request.router_replay_digest(),
        },
    })
}

#[test]
fn normal_signing_cors_requires_exact_configured_origin() {
    assert_eq!(
        cloudflare_router_normal_signing_cors_allowed_origin_v1(
            Some("https://wallet.example, https://app.example"),
            "https://app.example",
        ),
        Some("https://app.example".to_owned())
    );
    assert_eq!(
        cloudflare_router_normal_signing_cors_allowed_origin_v1(None, "https://app.example"),
        None
    );
    assert_eq!(
        cloudflare_router_normal_signing_cors_allowed_origin_v1(Some(""), "https://app.example"),
        None
    );
    assert_eq!(
        cloudflare_router_normal_signing_cors_allowed_origin_v1(Some("*"), "https://app.example"),
        None
    );
    assert_eq!(
        cloudflare_router_normal_signing_cors_allowed_origin_v1(
            Some("https://wallet.example"),
            "https://app.example",
        ),
        None
    );
}

pub(super) fn composite_admission_provider(
    claims: CloudflareRouterVerifiedJwtClaimsV1,
    allowed_work_kinds: Vec<ExpensiveWorkKindV1>,
    abuse: CloudflareRouterAbuseCheckV1,
    quota: CloudflareRouterQuotaCheckV1,
) -> TestCompositeAdmissionProvider {
    CloudflareRouterCompositeAdmissionProviderV1::new(
        CloudflareRouterVerifiedSessionProviderV1::new(
            CloudflareRouterVerifiedSessionV1::jwt(claims).expect("verified jwt session"),
        )
        .expect("verified session provider"),
        CloudflareRouterAllowedWorkKindsProjectPolicyProviderV1::new(allowed_work_kinds, 1_000)
            .expect("project policy provider"),
        CloudflareRouterConfiguredAbuseProviderV1::new(abuse).expect("abuse provider"),
        CloudflareRouterConfiguredQuotaProviderV1::new(quota).expect("quota provider"),
    )
}

pub(super) fn allow_checks(request_id: &str) -> CloudflareRouterAdmissionChecksV1 {
    CloudflareRouterAdmissionChecksV1::new(
        CloudflareRouterProjectPolicyV1::Allowed,
        CloudflareRouterAbuseCheckV1::Allowed,
        CloudflareRouterQuotaCheckV1::Accepted {
            request_id: request_id.to_owned(),
        },
    )
    .expect("admission checks")
}

#[derive(Debug, Clone)]
pub(super) struct StaticAdmissionProvider {
    pub(super) output: CloudflareRouterAdmissionProviderOutputV1,
    pub(super) calls: usize,
}

impl StaticAdmissionProvider {
    pub(super) fn new(output: CloudflareRouterAdmissionProviderOutputV1) -> Self {
        Self { output, calls: 0 }
    }
}

impl CloudflareRouterAdmissionProviderV1 for StaticAdmissionProvider {
    fn evaluate_public_request_admission(
        &mut self,
        _request: &EcdsaThresholdPrfRequestV1,
    ) -> RouterAbProtocolResult<CloudflareRouterAdmissionProviderOutputV1> {
        self.calls += 1;
        Ok(self.output.clone())
    }
}

#[derive(Debug, Clone)]
pub(super) struct StaticJwtVerifier {
    pub(super) claims: CloudflareRouterVerifiedJwtClaimsV1,
    pub(super) calls: usize,
}

impl StaticJwtVerifier {
    pub(super) fn new(claims: CloudflareRouterVerifiedJwtClaimsV1) -> Self {
        Self { claims, calls: 0 }
    }
}

impl CloudflareRouterJwtVerifierV1 for StaticJwtVerifier {
    fn verify_public_request_jwt(
        &mut self,
        verifier: &CloudflareRouterJwtVerifierBindingV1,
        authorization: &CloudflareRouterBearerAuthorizationV1,
        request: &EcdsaThresholdPrfRequestV1,
        _request_policy_digest: PublicDigest32,
        now_unix_ms: u64,
        trusted_source_digest: PublicDigest32,
    ) -> RouterAbProtocolResult<CloudflareRouterVerifiedJwtClaimsV1> {
        verifier.validate()?;
        authorization.validate()?;
        request.validate_at(now_unix_ms)?;
        self.calls += 1;
        let mut claims = self.claims.clone();
        claims.trusted_source_digest = trusted_source_digest;
        claims.validate()?;
        Ok(claims)
    }
}
