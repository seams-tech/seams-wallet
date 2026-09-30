mod support {
    pub mod ui;
}

use support::ui::{assert_compile_failure, UiHarness};

#[test]
fn compile_fail_guards_enforce_move_only_disjoint_recipient_custody() {
    let harness = UiHarness::create("activation-recipient-party-views");
    let control = harness.check(
        "use ed25519_yao_generator::activation_recipient_party_views::HostOnlyActivationRecipientPartyViewStageV1;\n\
         fn main() { let _ = HostOnlyActivationRecipientPartyViewStageV1::RecipientsReleased; }",
    );
    assert!(
        control.status.success(),
        "UI control failed:\n{}",
        String::from_utf8_lossy(&control.stderr)
    );

    for (source, code) in [
        (
            "use ed25519_yao_generator::activation_recipient_party_views::HostOnlyActivationRecipientsReleasedPartyViewSetV1;\n\
             fn invalid(views: HostOnlyActivationRecipientsReleasedPartyViewSetV1) {\n\
               let _client = views.observe_client_v1();\n\
               let _worker = views.observe_signing_worker_v1();\n\
             }\nfn main() {}",
            "E0382",
        ),
        (
            "use ed25519_yao_generator::activation_recipient_party_views::HostOnlySigningWorkerActivatedPartyViewSetV1;\n\
             fn invalid(views: HostOnlySigningWorkerActivatedPartyViewSetV1) { let _ = views.clone(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::activation_recipient_party_views::HostOnlySigningWorkerActivatedPartyViewSetV1;\n\
             use serde::Serialize;\nfn require_serialize<T: Serialize>() {}\n\
             fn main() { require_serialize::<HostOnlySigningWorkerActivatedPartyViewSetV1>(); }",
            "E0277",
        ),
        (
            "use ed25519_yao_generator::activation_recipient_party_views::HostOnlySigningWorkerActivatedPartyViewV1;\n\
             fn invalid(view: &HostOnlySigningWorkerActivatedPartyViewV1) { let _ = view.x_server_base(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::activation_recipient_party_views::HostOnlySigningWorkerActivationRecipientsReleasedPartyViewV1;\n\
             fn invalid(view: &HostOnlySigningWorkerActivationRecipientsReleasedPartyViewV1) { let _ = view.retained_shares(); }\n\
             fn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::activation_recipient_party_views::build_host_only_signing_worker_activated_party_view_set_v1;\n\
             fn main() { let _ = build_host_only_signing_worker_activated_party_view_set_v1; }",
            "E0603",
        ),
    ] {
        assert_compile_failure(&harness, source, code);
    }
}
