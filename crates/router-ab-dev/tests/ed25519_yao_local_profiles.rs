use router_ab_core::LocalServiceRoleV1;
use router_ab_dev::{
    build_local_ed25519_yao_one_account_plan_v1, build_local_ed25519_yao_two_administrator_plan_v1,
};
use std::collections::BTreeSet;

#[test]
fn fixed_local_profiles_share_protocol_artifacts_and_separate_layout_policy() {
    let one_account = build_local_ed25519_yao_one_account_plan_v1();
    let two_administrator = build_local_ed25519_yao_two_administrator_plan_v1();

    assert_eq!(
        one_account.artifact_identity(),
        two_administrator.artifact_identity()
    );
    assert!(!one_account.evidence_claim().production_eligible());
    assert!(!two_administrator.evidence_claim().production_eligible());
    assert!(!one_account
        .evidence_claim()
        .administrative_independence_proven());
    assert!(!two_administrator
        .evidence_claim()
        .administrative_independence_proven());
    assert_eq!(
        one_account
            .role_roots()
            .iter()
            .map(|entry| entry.relative_root())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["."])
    );
    assert_eq!(
        two_administrator
            .role_roots()
            .iter()
            .map(|entry| entry.relative_root())
            .collect::<BTreeSet<_>>()
            .len(),
        3
    );
    for role in [
        LocalServiceRoleV1::DeriverA,
        LocalServiceRoleV1::DeriverB,
        LocalServiceRoleV1::SigningWorker,
    ] {
        assert!(one_account.root_for(role).is_some());
        assert!(two_administrator.root_for(role).is_some());
    }
}
