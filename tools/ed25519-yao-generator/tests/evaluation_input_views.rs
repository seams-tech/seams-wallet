mod support {
    pub mod ui;
}

use support::ui::{assert_compile_failure, UiHarness};

#[test]
fn compile_fail_guards_enforce_input_custody_and_branch_coin_ownership() {
    let harness = UiHarness::create("evaluation-input-views");
    let control = harness.check(
        "use ed25519_yao_generator::HostOnlyEvaluationInputStageV1;\n\
         fn main() { let _ = HostOnlyEvaluationInputStageV1::ExportEvaluationAccepted; }",
    );
    assert!(
        control.status.success(),
        "UI control failed:\n{}",
        String::from_utf8_lossy(&control.stderr)
    );

    for (body, code) in [
        (
            "use ed25519_yao_generator::HostOnlyRegistrationEvaluationInputViewSetV1;\n\
             fn invalid(views: HostOnlyRegistrationEvaluationInputViewSetV1) {\n\
                 let _a = views.observe_deriver_a_v1();\n\
                 let _b = views.observe_deriver_b_v1();\n\
             }\nfn main() {}",
            "E0382",
        ),
        (
            "use ed25519_yao_generator::HostOnlyRegistrationEvaluationInputViewSetV1;\n\
             fn invalid(views: HostOnlyRegistrationEvaluationInputViewSetV1) {\n\
                 let _ = views.observe_deriver_v1(true);\n\
             }\nfn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::HostOnlyRegistrationEvaluationInputViewSetV1;\n\
             fn invalid(views: &HostOnlyRegistrationEvaluationInputViewSetV1) { let _ = views.common(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::{HostOnlyDeriverAActivationEvaluationInputViewV1, HostOnlyRegistrationEvaluationInputCommonV1};\n\
             fn invalid(view: &HostOnlyDeriverAActivationEvaluationInputViewV1<HostOnlyRegistrationEvaluationInputCommonV1>) { let _ = view.deriver_b(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::HostOnlyDeriverAExportEvaluationInputViewV1;\n\
             fn invalid(view: &HostOnlyDeriverAExportEvaluationInputViewV1) { let _ = view.tau_client(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::{HostOnlyActivationContinuationInputCommonV1, HostOnlyDeriverAEmptyEvaluationInputViewV1};\n\
             fn invalid(view: &HostOnlyDeriverAEmptyEvaluationInputViewV1<HostOnlyActivationContinuationInputCommonV1>) { let _ = view.contribution(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::{HostOnlyClientEmptyEvaluationInputViewV1, HostOnlyRegistrationEvaluationInputCommonV1};\n\
             fn invalid(view: &HostOnlyClientEmptyEvaluationInputViewV1<HostOnlyRegistrationEvaluationInputCommonV1>) { let _ = view.contribution(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::HostOnlyRegistrationEvaluationInputViewSetV1;\n\
             fn invalid(views: HostOnlyRegistrationEvaluationInputViewSetV1) { let _ = views.clone(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::{HostOnlyDeriverAActivationEvaluationInputViewV1, HostOnlyRegistrationEvaluationInputCommonV1};\n\
             fn invalid(view: HostOnlyDeriverAActivationEvaluationInputViewV1<HostOnlyRegistrationEvaluationInputCommonV1>) { let _ = format!(\"{view:?}\"); }\n\
             fn main() {}",
            "E0277",
        ),
        (
            "use ed25519_yao_generator::HostOnlyExportIdealCoinV1;\n\
             fn invalid(coin: HostOnlyExportIdealCoinV1) { let _ = coin.clone(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::HostOnlyRegistrationIdealCoinsV1;\n\
             use serde::Serialize;\n\
             fn require_serialize<T: Serialize>() {}\n\
             fn main() { require_serialize::<HostOnlyRegistrationIdealCoinsV1>(); }",
            "E0277",
        ),
        (
            "use ed25519_yao_generator::{HostOnlyRecoveryIdealCoinsV1, HostOnlyRegistrationIdealCoinsV1};\n\
             fn require_recovery(_: HostOnlyRecoveryIdealCoinsV1) {}\n\
             fn invalid(coins: HostOnlyRegistrationIdealCoinsV1) { require_recovery(coins); }\n\
             fn main() {}",
            "E0308",
        ),
        (
            "use ed25519_yao_generator::{evaluate_host_only_registration_output_sharing_v1, HostOnlyActivationOutputCoinsV1, HostOnlyPreparedRegistrationReferenceV1};\n\
             fn invalid(prepared: HostOnlyPreparedRegistrationReferenceV1, coins: HostOnlyActivationOutputCoinsV1) {\n\
                 let _ = evaluate_host_only_registration_output_sharing_v1(prepared, coins);\n\
             }\nfn main() {}",
            "E0308",
        ),
        (
            "use ed25519_yao_generator::{build_host_only_registration_evaluation_input_view_set_v1, HostOnlyPreparedRecoveryReferenceV1};\n\
             use ed25519_yao_generator::lifecycle_domain::RegistrationRequestV1;\n\
             use ed25519_yao_generator::provenance::RoleInputProvenancePairV1;\n\
             fn invalid(request: &RegistrationRequestV1, provenance: &RoleInputProvenancePairV1, prepared: &HostOnlyPreparedRecoveryReferenceV1) {\n\
                 let _ = build_host_only_registration_evaluation_input_view_set_v1(request, provenance, prepared);\n\
             }\nfn main() {}",
            "E0308",
        ),
        (
            "use ed25519_yao_generator::build_host_only_activation_continuation_input_view_set_v1;\n\
             use ed25519_yao_generator::lifecycle_domain::ActivationRequestV1;\n\
             fn invalid(request: &ActivationRequestV1) { let _ = build_host_only_activation_continuation_input_view_set_v1(request); }\n\
             fn main() {}",
            "E0061",
        ),
        (
            "use ed25519_yao_generator::{HostOnlyRegistrationEvaluationInputCommonV1, HostOnlyRegistrationEvaluationInputViewSetV1};\n\
             use ed25519_yao_generator::{DeriverAContribution, DeriverBContribution};\n\
             fn invalid(common: HostOnlyRegistrationEvaluationInputCommonV1, deriver_a: DeriverAContribution, deriver_b: DeriverBContribution) {\n\
                 let _ = HostOnlyRegistrationEvaluationInputViewSetV1 { common, deriver_a, deriver_b };\n\
             }\nfn main() {}",
            "E0451",
        ),
    ] {
        assert_compile_failure(&harness, body, code);
    }
}
