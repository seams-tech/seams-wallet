use router_ab_core::{
    Ed25519YaoDeriverRoleV1, Ed25519YaoPackageKindV1, LocalServiceRoleV1, RouterAbProtocolErrorCode,
};
use router_ab_dev::{
    local_env_materialization_plan_v1, open_local_ed25519_yao_client_package_v1,
    parse_local_env_file_contents_v1, parse_local_service_role_label_v1,
    seal_local_ed25519_yao_package_v1, LocalEd25519YaoRecipientPrivateKeyV1,
    LOCAL_DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY_ENV_V1,
    LOCAL_DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_ENV_V1, LOCAL_DERIVER_A_ENV_FILE_V1,
    LOCAL_DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY_ENV_V1,
    LOCAL_DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY_ENV_V1, LOCAL_DERIVER_B_ENV_FILE_V1,
    LOCAL_ROUTER_ENV_FILE_V1, LOCAL_SIGNING_WORKER_ENV_FILE_V1,
    LOCAL_SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY_ENV_V1,
    LOCAL_SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY_ENV_V1, LOCAL_WORKER_ROLE_ENV_V1,
};

#[test]
fn local_env_materialization_plan_generates_parseable_role_env_files() {
    let plan =
        local_env_materialization_plan_v1(b"test-seed-1").expect("local env materialization plan");

    assert_eq!(
        plan.files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        vec![
            LOCAL_ROUTER_ENV_FILE_V1,
            LOCAL_DERIVER_A_ENV_FILE_V1,
            LOCAL_DERIVER_B_ENV_FILE_V1,
            LOCAL_SIGNING_WORKER_ENV_FILE_V1,
        ]
    );
    for file in &plan.files {
        assert!(!file.contents.contains("dev-only-deriver"));
        assert!(!file.contents.contains("dev-only-signing-worker"));
        match file.role {
            LocalServiceRoleV1::DeriverA | LocalServiceRoleV1::DeriverB => {
                assert!(!file.contents.contains("dev-only-generated-"));
            }
            LocalServiceRoleV1::SigningWorker => {
                assert!(!file
                    .contents
                    .contains("dev-only-signing-worker-server-output-hpke-private-key"));
                assert!(!file.contents.contains(
                    "x25519:3333333333333333333333333333333333333333333333333333333333333333"
                ));
            }
            LocalServiceRoleV1::Router => {}
        }
        let entries =
            parse_local_env_file_contents_v1(&file.contents).expect("generated env parses");
        let label = entries
            .iter()
            .find(|(key, _)| key == LOCAL_WORKER_ROLE_ENV_V1)
            .map(|(_, value)| value.as_str())
            .expect("Worker role label");
        assert_eq!(
            parse_local_service_role_label_v1(label).expect("Worker role"),
            file.role
        );
    }
}

#[test]
fn local_env_materialization_plan_is_seed_bound() {
    let first = local_env_materialization_plan_v1(b"seed-a").expect("first plan");
    let second = local_env_materialization_plan_v1(b"seed-a").expect("second plan");
    let third = local_env_materialization_plan_v1(b"seed-b").expect("third plan");

    assert_eq!(first, second);
    assert_ne!(first, third);
}

#[test]
fn local_env_materialization_exposes_only_public_keys_matching_role_private_keys() {
    let plan = local_env_materialization_plan_v1(b"key-coherence-seed").expect("materialization");
    let mut roles = std::collections::BTreeMap::new();
    for file in &plan.files {
        let entries = parse_local_env_file_contents_v1(&file.contents).expect("env parses");
        roles.insert(
            file.role.as_str(),
            entries
                .into_iter()
                .collect::<std::collections::BTreeMap<_, _>>(),
        );
    }
    let router = &roles[LocalServiceRoleV1::Router.as_str()];
    let deriver_a = &roles[LocalServiceRoleV1::DeriverA.as_str()];
    let deriver_b = &roles[LocalServiceRoleV1::DeriverB.as_str()];
    let signing_worker = &roles[LocalServiceRoleV1::SigningWorker.as_str()];
    assert_hpke_key_pair(
        &router[LOCAL_DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY_ENV_V1],
        &deriver_a[LOCAL_DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_ENV_V1],
        Ed25519YaoDeriverRoleV1::DeriverA,
    );
    assert_hpke_key_pair(
        &router[LOCAL_DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY_ENV_V1],
        &deriver_b[LOCAL_DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY_ENV_V1],
        Ed25519YaoDeriverRoleV1::DeriverB,
    );
    assert_eq!(
        router[LOCAL_SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY_ENV_V1],
        signing_worker[LOCAL_SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY_ENV_V1]
    );
    assert_hpke_key_pair(
        &router[LOCAL_SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY_ENV_V1],
        &signing_worker[LOCAL_SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY_ENV_V1],
        Ed25519YaoDeriverRoleV1::DeriverA,
    );
}

#[test]
fn local_env_materialization_plan_rejects_empty_seed() {
    let err = local_env_materialization_plan_v1(&[]).expect_err("empty seed rejected");

    assert_eq!(err.code(), RouterAbProtocolErrorCode::EmptyField);
}

fn assert_hpke_key_pair(public_key: &str, private_key: &str, deriver: Ed25519YaoDeriverRoleV1) {
    let public_key: [u8; 32] = hex::decode(
        public_key
            .strip_prefix("x25519:")
            .expect("public key prefix"),
    )
    .expect("public key hex")
    .try_into()
    .expect("public key length");
    let private_key: [u8; 32] = hex::decode(private_key)
        .expect("private key hex")
        .try_into()
        .expect("private key length");
    let envelope = seal_local_ed25519_yao_package_v1(
        Ed25519YaoPackageKindV1::ActivationClient,
        deriver,
        [1; 32],
        [2; 32],
        public_key,
        b"key-coherence",
    )
    .expect("seal with public key");
    let opened = open_local_ed25519_yao_client_package_v1(
        &envelope,
        &LocalEd25519YaoRecipientPrivateKeyV1::from_bytes(private_key),
    )
    .expect("open with private key");
    assert_eq!(opened.as_slice(), b"key-coherence");
}
