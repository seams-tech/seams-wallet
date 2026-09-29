#[test]
fn protocol_and_worker_sources_expose_no_runtime_profile_negotiation() {
    let sources = [
        include_str!("../src/local_ed25519_yao_api.rs"),
        include_str!("../src/local_ed25519_yao_input.rs"),
        include_str!("../src/local_ed25519_yao_worker.rs"),
        include_str!("../src/bin/router_ab_local_worker.rs"),
    ]
    .join("\n");
    for forbidden in ["--profile", "YAOS_AB_TOPOLOGY", "YAOS_AB_PROFILE"] {
        assert!(!sources.contains(forbidden), "found {forbidden}");
    }
}

#[test]
fn ed25519_yao_and_router_ab_ecdsa_derivation_modules_have_disjoint_backend_imports() {
    let yao_sources = [
        include_str!("../src/local_ed25519_yao_api.rs"),
        include_str!("../src/local_ed25519_yao_delivery.rs"),
        include_str!("../src/local_ed25519_yao_input.rs"),
        include_str!("../src/local_ed25519_yao_refresh.rs"),
        include_str!("../src/local_ed25519_yao_router.rs"),
        include_str!("../src/local_ed25519_yao_signing_worker.rs"),
        include_str!("../src/local_ed25519_yao_stream.rs"),
        include_str!("../src/local_ed25519_yao_worker.rs"),
    ]
    .join("\n");
    for forbidden in [
        "ed25519_hss",
        "ed25519-hss",
        "router_ab_ecdsa_derivation",
        "router-ab-ecdsa-derivation",
    ] {
        assert!(!yao_sources.contains(forbidden), "found {forbidden}");
    }

    let router_ab_ecdsa_derivation_source = [
        include_str!("../src/local_router_ab_ecdsa.rs"),
        include_str!("../src/local_signing_worker_wallet_sqlite.rs"),
    ]
    .join("\n");
    for forbidden in ["ed25519_yao", "ed25519-yao", "router_ab_ed25519_yao"] {
        assert!(
            !router_ab_ecdsa_derivation_source.contains(forbidden),
            "found {forbidden}"
        );
    }
}
