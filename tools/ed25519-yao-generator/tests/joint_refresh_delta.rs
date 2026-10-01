mod support {
    pub mod ui;
}

use support::ui::{assert_compile_failure, UiHarness};

#[test]
fn compile_fail_guards_seal_joint_delta_derivation_and_move_ownership() {
    let harness = UiHarness::create("joint-refresh-delta");
    let control = harness.check(
        "use ed25519_yao_generator::{HostOnlyDeriverARefreshDeltaContributionV1, HostOnlyDeriverBRefreshDeltaContributionV1, HostOnlyJointRefreshDeltaCoinsV1};\n\
         fn main() {\n\
             let a = HostOnlyDeriverARefreshDeltaContributionV1::from_host_only_fixture([1; 32], [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).unwrap();\n\
             let b = HostOnlyDeriverBRefreshDeltaContributionV1::from_host_only_fixture([2; 32], [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).unwrap();\n\
             let _ = HostOnlyJointRefreshDeltaCoinsV1::new(a, b);\n\
         }",
    );
    assert!(
        control.status.success(),
        "UI control failed:\n{}",
        String::from_utf8_lossy(&control.stderr)
    );

    for (body, code) in [
        (
            "use ed25519_yao_generator::HostOnlyJointRefreshDeltaV1; fn main() {}",
            "E0432",
        ),
        (
            "use ed25519_yao_generator::derive_host_only_joint_refresh_delta_v1; fn main() {}",
            "E0432",
        ),
        (
            "use ed25519_yao_generator::apply_host_only_joint_refresh_delta_v1; fn main() {}",
            "E0432",
        ),
        (
            "use ed25519_yao_generator::HostOnlyDeriverARefreshDeltaContributionV1;\n\
             fn invalid(value: HostOnlyDeriverARefreshDeltaContributionV1) { let _ = value.clone(); } fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::HostOnlyJointRefreshDeltaCoinsV1;\n\
             fn invalid(value: HostOnlyJointRefreshDeltaCoinsV1) { let _ = value.clone(); } fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::HostOnlyJointRefreshDeltaCoinsV1; use serde::Serialize;\n\
             fn require_serialize<T: Serialize>() {} fn main() { require_serialize::<HostOnlyJointRefreshDeltaCoinsV1>(); }",
            "E0277",
        ),
        (
            "use ed25519_yao_generator::HostOnlyJointRefreshDeltaCoinsV1;\n\
             fn invalid(value: HostOnlyJointRefreshDeltaCoinsV1) { let _ = value.deriver_a; } fn main() {}",
            "E0616",
        ),
        (
            "use ed25519_yao_generator::{HostOnlyDeriverARefreshDeltaContributionV1, HostOnlyDeriverBRefreshDeltaContributionV1, HostOnlyJointRefreshDeltaCoinsV1};\n\
             fn invalid(a: HostOnlyDeriverARefreshDeltaContributionV1, b: HostOnlyDeriverBRefreshDeltaContributionV1) {\n\
                 let _coins = HostOnlyJointRefreshDeltaCoinsV1::new(a, b); let _ = a.delta_y_fixture_bytes();\n\
             } fn main() {}",
            "E0382",
        ),
    ] {
        assert_compile_failure(&harness, body, code);
    }
}
