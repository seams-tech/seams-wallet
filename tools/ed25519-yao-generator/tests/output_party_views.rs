mod support {
    pub mod ui;
}

use support::ui::{assert_compile_failure, UiHarness};

#[test]
fn compile_fail_guards_enforce_consuming_role_and_output_family_boundaries() {
    let harness = UiHarness::create("output-party-views");
    let control = harness.check(
        "use ed25519_yao_generator::output_party_views::HostOnlyOutputPartyViewStageV1;\n\
         fn main() { let _ = HostOnlyOutputPartyViewStageV1::ExportReleased; }",
    );
    assert!(
        control.status.success(),
        "UI control failed:\n{}",
        String::from_utf8_lossy(&control.stderr)
    );

    for (body, code) in [
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyActivationPackagePreparedPartyViewSetV1;\n\
             fn invalid(views: HostOnlyActivationPackagePreparedPartyViewSetV1) {\n\
                 let _a = views.observe_deriver_a_v1();\n\
                 let _b = views.observe_deriver_b_v1();\n\
             }\nfn main() {}",
            "E0382",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyActivationPackagePreparedPartyViewSetV1;\n\
             fn invalid(views: HostOnlyActivationPackagePreparedPartyViewSetV1) {\n\
                 let _ = views.observe_deriver_v1(true);\n\
             }\nfn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyActivationPackagePreparedPartyViewSetV1;\n\
             fn invalid(views: HostOnlyActivationPackagePreparedPartyViewSetV1) { let _ = views.clone(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyDeriverAActivationOutputPartyViewV1;\n\
             fn invalid(view: HostOnlyDeriverAActivationOutputPartyViewV1) { let _ = view.clone(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyDeriverAActivationOutputPartyViewV1;\n\
             fn invalid(view: HostOnlyDeriverAActivationOutputPartyViewV1) { let _ = format!(\"{view:?}\"); }\n\
             fn main() {}",
            "E0277",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyActivationPackagePreparedPartyViewSetV1;\n\
             use serde::Serialize;\n\
             fn require_serialize<T: Serialize>() {}\n\
             fn main() { require_serialize::<HostOnlyActivationPackagePreparedPartyViewSetV1>(); }",
            "E0277",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyClientExportOutputPartyViewV1;\n\
             use serde::Serialize;\n\
             fn require_serialize<T: Serialize>() {}\n\
             fn main() { require_serialize::<HostOnlyClientExportOutputPartyViewV1>(); }",
            "E0277",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyDeriverAActivationOutputPartyViewV1;\n\
             fn invalid(view: &HostOnlyDeriverAActivationOutputPartyViewV1) { let _ = view.deriver_b(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyDeriverBActivationOutputPartyViewV1;\n\
             fn invalid(view: &HostOnlyDeriverBActivationOutputPartyViewV1) { let _ = view.joined_output(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyClientActivationOutputPartyViewV1;\n\
             fn invalid(view: &HostOnlyClientActivationOutputPartyViewV1) { let _ = view.x_client_base(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlySigningWorkerActivationPackagePreparedPartyViewV1;\n\
             fn invalid(view: &HostOnlySigningWorkerActivationPackagePreparedPartyViewV1) { let _ = view.x_server_base(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyClientActivationMetadataConsumedPartyViewV1;\n\
             fn invalid(view: &HostOnlyClientActivationMetadataConsumedPartyViewV1) { let _ = view.x_client_base(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyClientExportOutputPartyViewV1;\n\
             fn invalid(view: &HostOnlyClientExportOutputPartyViewV1) { let _ = view.x_client_base(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlySigningWorkerExportReleasedPartyViewV1;\n\
             fn invalid(view: &HostOnlySigningWorkerExportReleasedPartyViewV1) { let _ = view.seed(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::output_party_views::{HostOnlyActivationPackagePreparedPartyViewSetV1, HostOnlyCommonOutputPublicLeakageV1};\n\
             use ed25519_yao_generator::{HostOnlyDeriverAActivationOutputSharesV1, HostOnlyDeriverBActivationOutputSharesV1};\n\
             fn invalid(common: HostOnlyCommonOutputPublicLeakageV1, deriver_a: HostOnlyDeriverAActivationOutputSharesV1, deriver_b: HostOnlyDeriverBActivationOutputSharesV1) {\n\
                 let _ = HostOnlyActivationPackagePreparedPartyViewSetV1 { common, deriver_a, deriver_b };\n\
             }\nfn main() {}",
            "E0451",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyEvaluatorAbortPartyViewSetV1;\n\
             fn invalid(views: HostOnlyEvaluatorAbortPartyViewSetV1) {\n\
                 let _a = views.observe_deriver_a_v1();\n\
                 let _b = views.observe_deriver_b_v1();\n\
             }\nfn main() {}",
            "E0382",
        ),
        (
            "use ed25519_yao_generator::output_party_views::HostOnlyClientEvaluatorAbortPartyViewV1;\n\
             fn invalid(view: &HostOnlyClientEvaluatorAbortPartyViewV1) { let _ = view.seed(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::output_party_views::build_host_only_evaluator_abort_party_view_set_v1;\n\
             fn main() { let _ = build_host_only_evaluator_abort_party_view_set_v1; }",
            "E0603",
        ),
        (
            "use ed25519_yao_generator::output_party_views::build_host_only_activation_package_prepared_party_view_set_v1;\n\
             fn main() { let _ = build_host_only_activation_package_prepared_party_view_set_v1; }",
            "E0603",
        ),
        (
            "use ed25519_yao_generator::lifecycle_domain::HostOnlyActivationOutputCommittedV1;\n\
             fn invalid(output: HostOnlyActivationOutputCommittedV1) { let _ = output.clone(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::lifecycle_domain::HostOnlyExportOutputCommittedV1;\n\
             fn invalid(committed: HostOnlyExportOutputCommittedV1) { let _ = committed.clone(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::export_delivery::HostOnlyExportReleasedV1;\n\
             use serde::Serialize;\n\
             fn require_serialize<T: Serialize>() {}\n\
             fn main() { require_serialize::<HostOnlyExportReleasedV1>(); }",
            "E0277",
        ),
        (
            "use ed25519_yao_generator::export_delivery::HostOnlyExportClientReleaseEvidenceV1;\n\
             fn invalid() { let _ = HostOnlyExportClientReleaseEvidenceV1 {}; }\n\
             fn main() {}",
            "private fields",
        ),
        (
            "use ed25519_yao_generator::output_party_views::build_host_only_export_released_party_view_set_v1;\n\
             fn main() { let _ = build_host_only_export_released_party_view_set_v1; }",
            "E0603",
        ),
    ] {
        assert_compile_failure(&harness, body, code);
    }
}
