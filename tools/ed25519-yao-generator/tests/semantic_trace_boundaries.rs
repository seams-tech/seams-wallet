mod support {
    pub mod ui;
}

use ed25519_yao_generator::{
    HOST_ONLY_CORRUPTION_GAME_INTERFACE_SHAPES_V1, HOST_ONLY_CORRUPTION_KINDS_V1,
    HOST_ONLY_SEMANTIC_DELIVERY_STATES_V1, HOST_ONLY_SEMANTIC_FRAME_CLASSES_V1,
    HOST_ONLY_SEMANTIC_PRIVATE_VALUE_CLASSES_V1, HOST_ONLY_SEMANTIC_PUBLIC_EVENTS_V1,
    HOST_ONLY_SEMANTIC_ROLES_V1,
};

use support::ui::{assert_compile_failure, UiHarness};

#[test]
fn compile_fail_guards_keep_trace_construction_static_and_closed() {
    let harness = UiHarness::create("semantic-trace");
    let control = harness.check(
        "use ed25519_yao_generator::HostOnlySemanticDeliveryStateV1;\n\
         fn main() { let _ = HostOnlySemanticDeliveryStateV1::ExactRedelivery; }",
    );
    assert!(
        control.status.success(),
        "UI control failed:\n{}",
        String::from_utf8_lossy(&control.stderr)
    );

    for (source, code) in [
        (
            "use ed25519_yao_generator::{HostOnlySemanticFrameDirectionV1, HostOnlySemanticFrameEndpointV1};\n\
             fn main() { let _ = HostOnlySemanticFrameDirectionV1 { sender: HostOnlySemanticFrameEndpointV1::Client, receiver: HostOnlySemanticFrameEndpointV1::Router }; }",
            "E0451",
        ),
        (
            "use ed25519_yao_generator::HostOnlySemanticDeliveryViewSetV1;\n\
             fn invalid(view: HostOnlySemanticDeliveryViewSetV1) { let _ = view.clone(); }\nfn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::HostOnlySemanticDeliveryViewSetV1;\n\
             fn invalid(view: HostOnlySemanticDeliveryViewSetV1) { let _ = view.observe_role_v1(true); }\nfn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::HostOnlySemanticDeliveryViewSetV1; use serde::Serialize;\n\
             fn require_serialize<T: Serialize>() {}\n\
             fn main() { require_serialize::<HostOnlySemanticDeliveryViewSetV1>(); }",
            "E0277",
        ),
        (
            "use ed25519_yao_generator::HostOnlyCorruptionMarkerV1;\n\
             struct Custom;\nimpl HostOnlyCorruptionMarkerV1 for Custom { const KIND: ed25519_yao_generator::HostOnlyCorruptionKindV1 = ed25519_yao_generator::HostOnlyCorruptionKindV1::RouterOnly; }\nfn main() {}",
            "E0277",
        ),
        (
            "use ed25519_yao_generator::RouterAndDeriverAAndDeriverBV1;\nfn main() {}",
            "E0432",
        ),
        (
            "use ed25519_yao_generator::semantic_delivery_views::build_export_success_semantic_trace_v1;\nfn main() { let _ = build_export_success_semantic_trace_v1; }",
            "E0603",
        ),
    ] {
        assert_compile_failure(&harness, source, code);
    }
}

#[test]
fn frozen_orders_export_exact_authoritative_labels() {
    assert_eq!(HOST_ONLY_SEMANTIC_FRAME_CLASSES_V1.len(), 11);
    assert_eq!(HOST_ONLY_SEMANTIC_DELIVERY_STATES_V1.len(), 11);
    assert_eq!(HOST_ONLY_SEMANTIC_ROLES_V1.len(), 7);
    assert_eq!(HOST_ONLY_CORRUPTION_KINDS_V1.len(), 10);

    let public: Vec<_> = HOST_ONLY_SEMANTIC_PUBLIC_EVENTS_V1
        .iter()
        .map(|value| value.as_str())
        .collect();
    assert_eq!(
        public,
        [
            "ceremony_public",
            "evaluation_inputs_accepted_public",
            "peer_progress_public",
            "output_commitment_public",
            "uniform_abort_public",
            "activation_metadata_public",
            "recipient_delivery_uncertainty_public",
            "activation_recipient_release_public",
            "export_release_public",
            "exact_redelivery_identity_public",
            "signing_worker_activation_receipt_public",
        ]
    );

    let private: Vec<_> = HOST_ONLY_SEMANTIC_PRIVATE_VALUE_CLASSES_V1
        .iter()
        .map(|value| value.as_str())
        .collect();
    assert_eq!(
        private,
        [
            "client_role_scoped_inputs",
            "deriver_a_activation_inputs",
            "deriver_b_activation_inputs",
            "deriver_a_export_inputs",
            "deriver_b_export_inputs",
            "deriver_a_peer_local_state",
            "deriver_b_peer_local_state",
            "deriver_a_protocol_randomness",
            "deriver_b_protocol_randomness",
            "deriver_a_activation_output_shares",
            "deriver_b_activation_output_shares",
            "deriver_a_export_seed_share",
            "deriver_b_export_seed_share",
            "client_activation_scalar",
            "signing_worker_activation_authority",
            "client_export_seed",
            "signing_worker_activated_scalar",
            "router_opaque_role_envelope_identities",
            "router_opaque_output_package_identities",
            "router_opaque_recipient_delivery_identities",
            "router_lifecycle_control_knowledge",
            "router_receipt_control_knowledge",
        ]
    );

    let frames: Vec<_> = HOST_ONLY_SEMANTIC_FRAME_CLASSES_V1
        .iter()
        .map(|value| value.as_str())
        .collect();
    assert_eq!(frames[0], "client_to_router_evaluation_request");
    assert_eq!(frames[10], "signing_worker_to_router_activation_receipt");

    let states: Vec<_> = HOST_ONLY_SEMANTIC_DELIVERY_STATES_V1
        .iter()
        .map(|value| value.as_str())
        .collect();
    assert_eq!(states[0], "ceremony_admitted");
    assert_eq!(states[10], "exact_redelivery");

    let roles: Vec<_> = HOST_ONLY_SEMANTIC_ROLES_V1
        .iter()
        .map(|value| value.as_str())
        .collect();
    assert_eq!(
        roles,
        [
            "deriver_a",
            "deriver_b",
            "client",
            "signing_worker",
            "router",
            "observer",
            "diagnostics",
        ]
    );

    let corruptions: Vec<_> = HOST_ONLY_CORRUPTION_KINDS_V1
        .iter()
        .map(|value| value.as_str())
        .collect();
    assert_eq!(corruptions[0], "honest_execution");
    assert_eq!(corruptions[9], "router_and_active_deriver_b");

    let interfaces: Vec<_> = HOST_ONLY_CORRUPTION_GAME_INTERFACE_SHAPES_V1
        .iter()
        .map(|value| value.as_str())
        .collect();
    assert_eq!(
        interfaces,
        [
            "corrupted_view_input",
            "selected_profile_real_execution",
            "selected_profile_ideal_simulator",
            "selected_profile_security_experiment",
        ]
    );
}
