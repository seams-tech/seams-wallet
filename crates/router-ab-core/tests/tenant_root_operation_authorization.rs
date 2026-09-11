//! Authorization contracts for tenant-root console operations.

use curve25519_dalek::scalar::Scalar;
use ed25519_dalek::SigningKey;
use router_ab_core::{
    authorize_tenant_root_operation_v1, tenant_root_governance_transition_quorum_v1,
    TenantRootCustodyLineageId, TenantRootIdentityV1, TenantRootOperationApprovalV1,
    TenantRootOperationCapabilityV1, TenantRootOperationIssuerKeysV1, TenantRootOperationKindV1,
    TenantRootOperationNonceV1, TenantRootOperationRecordV1, TenantRootOperationSubjectV1,
    TenantRootRecoveryGovernanceV1, TenantRootRestoreDestinationFingerprintV1,
    TenantRootRestoreSessionIdV1, TenantRootStepUpEvidenceV1,
};
use threshold_prf::{
    SigningRootShare, TwoPartyDeriverRole, TwoPartyRootCommitment, TwoPartyRootShareCommitments,
};

const NOW: &str = "2026-09-05T12:00:00.000Z";
const ISSUED_AT: &str = "2026-09-05T11:58:00.000Z";
const EXPIRES_AT: &str = "2026-09-05T12:05:00.000Z";
const REQUESTER: &str = "owner-1";
const APPROVER: &str = "owner-2";

fn capability_key() -> SigningKey {
    SigningKey::from_bytes(&[0x41; 32])
}

fn step_up_key() -> SigningKey {
    SigningKey::from_bytes(&[0x42; 32])
}

fn approval_key() -> SigningKey {
    SigningKey::from_bytes(&[0x43; 32])
}

fn issuer_keys() -> TenantRootOperationIssuerKeysV1 {
    TenantRootOperationIssuerKeysV1 {
        capability: capability_key().verifying_key().to_bytes(),
        step_up: step_up_key().verifying_key().to_bytes(),
        approval: approval_key().verifying_key().to_bytes(),
    }
}

fn identity() -> TenantRootIdentityV1 {
    TenantRootIdentityV1::new("org-1", "project-2", "production", "root-main", "v3").unwrap()
}

fn lineage() -> TenantRootCustodyLineageId {
    TenantRootCustodyLineageId::from_bytes([0x31; 16]).unwrap()
}

fn root_commitment() -> TwoPartyRootCommitment {
    let deriver_a = SigningRootShare::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverA.share_id(),
        Scalar::from(12_u64).to_bytes(),
    )
    .unwrap();
    let deriver_b = SigningRootShare::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverB.share_id(),
        Scalar::from(19_u64).to_bytes(),
    )
    .unwrap();
    TwoPartyRootShareCommitments::from_shares(&deriver_a, &deriver_b)
        .unwrap()
        .root()
}

fn single_owner() -> TenantRootRecoveryGovernanceV1 {
    TenantRootRecoveryGovernanceV1::single_owner(REQUESTER, "2026-08-01T00:00:00.000Z").unwrap()
}

fn two_person() -> TenantRootRecoveryGovernanceV1 {
    TenantRootRecoveryGovernanceV1::two_person(REQUESTER, "2026-08-01T00:00:00.000Z").unwrap()
}

fn record_for(
    kind: TenantRootOperationKindV1,
    governance: &TenantRootRecoveryGovernanceV1,
) -> TenantRootOperationRecordV1 {
    record_with(kind, governance, &identity(), REQUESTER)
}

fn record_with(
    kind: TenantRootOperationKindV1,
    governance: &TenantRootRecoveryGovernanceV1,
    identity: &TenantRootIdentityV1,
    requester: &str,
) -> TenantRootOperationRecordV1 {
    TenantRootOperationRecordV1::new(
        kind,
        identity,
        lineage(),
        7,
        governance,
        TenantRootOperationSubjectV1::TenantRoot,
        None,
        requester,
        "idempotency-1",
        ISSUED_AT,
        EXPIRES_AT,
        root_commitment(),
    )
    .expect("record")
}

fn capability_for(record: &TenantRootOperationRecordV1) -> TenantRootOperationCapabilityV1 {
    TenantRootOperationCapabilityV1::issue(
        record.digest().unwrap(),
        TenantRootOperationNonceV1::from_bytes([0x55; 32]).unwrap(),
        "console-capability-key-1",
        ISSUED_AT,
        EXPIRES_AT,
        &capability_key().to_bytes(),
    )
    .expect("capability")
}

fn step_up(actor: &str, verified_at: &str) -> TenantRootStepUpEvidenceV1 {
    TenantRootStepUpEvidenceV1::issue(
        actor,
        format!("session-{actor}"),
        "webauthn_platform_v1",
        verified_at,
        "console-step-up-key-1",
        &step_up_key().to_bytes(),
    )
    .expect("step-up")
}

fn approval(
    record: &TenantRootOperationRecordV1,
    approver: &TenantRootStepUpEvidenceV1,
) -> TenantRootOperationApprovalV1 {
    TenantRootOperationApprovalV1::issue(
        record.digest().unwrap(),
        approver.clone(),
        "2026-09-05T11:59:00.000Z",
        "console-approval-key-1",
        &approval_key().to_bytes(),
    )
    .expect("approval")
}

#[test]
fn an_operation_record_round_trips_and_binds_its_identity() {
    let record = record_for(
        TenantRootOperationKindV1::OperationalShareRotation,
        &single_owner(),
    );
    let canonical = record.canonical_json().expect("canonical");
    assert_eq!(
        TenantRootOperationRecordV1::from_canonical_json(&canonical).unwrap(),
        record
    );
    assert!(TenantRootOperationRecordV1::from_canonical_json(
        format!("{} ", String::from_utf8(canonical.clone()).unwrap()).as_bytes()
    )
    .is_err());

    // The record's ids come from the resolved identity, so they cannot disagree
    // with its digest.
    let text = String::from_utf8(canonical).unwrap();
    assert!(text.contains("\"orgId\":\"org-1\""));
    assert!(text.contains("\"projectId\":\"project-2\""));
    assert!(text.contains("\"envId\":\"production\""));
}

#[test]
fn a_different_tenant_or_environment_produces_a_different_digest() {
    let governance = single_owner();
    let base = record_for(
        TenantRootOperationKindV1::OperationalShareRotation,
        &governance,
    );
    let other_environment =
        TenantRootIdentityV1::new("org-1", "project-2", "staging", "root-main", "v3").unwrap();
    let cross_environment = record_with(
        TenantRootOperationKindV1::OperationalShareRotation,
        &governance,
        &other_environment,
        REQUESTER,
    );
    assert_ne!(
        base.digest().unwrap().as_bytes(),
        cross_environment.digest().unwrap().as_bytes()
    );

    // A capability minted for one environment cannot authorize the other.
    assert!(authorize_tenant_root_operation_v1(
        &cross_environment,
        &capability_for(&base),
        &step_up(REQUESTER, NOW),
        None,
        &governance,
        &issuer_keys(),
        NOW,
    )
    .is_err());
}

#[test]
fn one_stepped_up_actor_authorizes_a_single_owner_operation() {
    let governance = single_owner();
    let record = TenantRootOperationRecordV1::new(
        TenantRootOperationKindV1::RecoveryRecipientPairEnroll,
        &identity(),
        lineage(),
        7,
        &governance,
        TenantRootOperationSubjectV1::RecipientPair {
            recipient_pair_digest: [0x9a; 32],
        },
        None,
        REQUESTER,
        "idempotency-1",
        ISSUED_AT,
        EXPIRES_AT,
        root_commitment(),
    )
    .expect("record");

    let authorized = authorize_tenant_root_operation_v1(
        &record,
        &capability_for(&record),
        &step_up(REQUESTER, NOW),
        None,
        &governance,
        &issuer_keys(),
        NOW,
    )
    .expect("authorized");
    assert_eq!(authorized.requester_actor_id(), REQUESTER);
    assert_eq!(authorized.approver_actor_id(), None);
    assert_eq!(authorized.expected_lifecycle_revision(), 7);
    assert_eq!(
        authorized.kind(),
        TenantRootOperationKindV1::RecoveryRecipientPairEnroll
    );
}

#[test]
fn restore_role_import_key_issue_is_refused_by_active_authorization() {
    let record = TenantRootOperationRecordV1::new_restore_role_import_key_issue(
        &identity(),
        lineage(),
        router_ab_core::TenantRootRecoverySetId::from_bytes([0x41; 16]).unwrap(),
        TwoPartyDeriverRole::DeriverA,
        REQUESTER,
        "restore-operation-1",
        TenantRootOperationNonceV1::from_bytes([0x51; 32]).unwrap(),
        ISSUED_AT,
        "2026-09-05T12:03:00.000Z",
        [0x61; 32],
        TenantRootRestoreDestinationFingerprintV1::from_bytes([0x71; 32]).unwrap(),
        TenantRootRestoreSessionIdV1::from_bytes([0x81; 16]).unwrap(),
        "restore-import-key-1",
        1,
    )
    .expect("restore record");

    assert!(authorize_tenant_root_operation_v1(
        &record,
        &capability_for(&record),
        &step_up(REQUESTER, NOW),
        None,
        &single_owner(),
        &issuer_keys(),
        NOW,
    )
    .is_err());
}

#[test]
fn two_person_governance_rejects_self_approval_and_missing_approval() {
    let governance = two_person();
    let record = TenantRootOperationRecordV1::new(
        TenantRootOperationKindV1::RecoveryRecipientPairReplace,
        &identity(),
        lineage(),
        7,
        &governance,
        TenantRootOperationSubjectV1::RecipientPair {
            recipient_pair_digest: [0x9a; 32],
        },
        None,
        REQUESTER,
        "idempotency-1",
        ISSUED_AT,
        EXPIRES_AT,
        root_commitment(),
    )
    .expect("record");
    let capability = capability_for(&record);
    let requester_step_up = step_up(REQUESTER, NOW);

    // No approval at all.
    assert!(authorize_tenant_root_operation_v1(
        &record,
        &capability,
        &requester_step_up,
        None,
        &governance,
        &issuer_keys(),
        NOW,
    )
    .is_err());

    // The requester approving itself, with genuinely signed evidence.
    let self_approval = approval(&record, &step_up(REQUESTER, NOW));
    assert!(authorize_tenant_root_operation_v1(
        &record,
        &capability,
        &requester_step_up,
        Some(&self_approval),
        &governance,
        &issuer_keys(),
        NOW,
    )
    .is_err());

    // A different owner with fresh step-up.
    let second_owner = approval(&record, &step_up(APPROVER, NOW));
    let authorized = authorize_tenant_root_operation_v1(
        &record,
        &capability,
        &requester_step_up,
        Some(&second_owner),
        &governance,
        &issuer_keys(),
        NOW,
    )
    .expect("authorized");
    assert_eq!(authorized.approver_actor_id(), Some(APPROVER));
}

#[test]
fn an_approval_cannot_be_moved_between_operations() {
    let governance = two_person();
    let record = record_for(TenantRootOperationKindV1::SourceLineageRetire, &governance);
    let other = TenantRootOperationRecordV1::new(
        TenantRootOperationKindV1::SourceLineageRetire,
        &identity(),
        lineage(),
        8,
        &governance,
        TenantRootOperationSubjectV1::TenantRoot,
        None,
        REQUESTER,
        "idempotency-1",
        ISSUED_AT,
        EXPIRES_AT,
        root_commitment(),
    )
    .expect("record");

    let stolen = approval(&other, &step_up(APPROVER, NOW));
    assert!(authorize_tenant_root_operation_v1(
        &record,
        &capability_for(&record),
        &step_up(REQUESTER, NOW),
        Some(&stolen),
        &governance,
        &issuer_keys(),
        NOW,
    )
    .is_err());
}

#[test]
fn an_approval_on_an_operation_that_does_not_use_one_is_refused() {
    let governance = two_person();
    let record = record_for(
        TenantRootOperationKindV1::OperationalShareRotation,
        &governance,
    );
    let unused = approval(&record, &step_up(APPROVER, NOW));
    assert!(authorize_tenant_root_operation_v1(
        &record,
        &capability_for(&record),
        &step_up(REQUESTER, NOW),
        Some(&unused),
        &governance,
        &issuer_keys(),
        NOW,
    )
    .is_err());
}

#[test]
fn step_up_must_be_fresh_and_belong_to_the_requester() {
    let governance = single_owner();
    let record = record_for(
        TenantRootOperationKindV1::OperationalShareRotation,
        &governance,
    );
    let capability = capability_for(&record);

    // Stale by more than five minutes.
    assert!(authorize_tenant_root_operation_v1(
        &record,
        &capability,
        &step_up(REQUESTER, "2026-09-05T11:54:59.000Z"),
        None,
        &governance,
        &issuer_keys(),
        NOW,
    )
    .is_err());

    // Fresh, but for a different actor.
    assert!(authorize_tenant_root_operation_v1(
        &record,
        &capability,
        &step_up(APPROVER, NOW),
        None,
        &governance,
        &issuer_keys(),
        NOW,
    )
    .is_err());

    // Dated further ahead than the permitted clock skew.
    assert!(authorize_tenant_root_operation_v1(
        &record,
        &capability,
        &step_up(REQUESTER, "2026-09-05T12:02:00.000Z"),
        None,
        &governance,
        &issuer_keys(),
        NOW,
    )
    .is_err());

    // Signed by a key the console does not trust for step-up.
    let forged = TenantRootStepUpEvidenceV1::issue(
        REQUESTER,
        "session-owner-1",
        "webauthn_platform_v1",
        NOW,
        "console-step-up-key-1",
        &approval_key().to_bytes(),
    )
    .expect("forged step-up");
    assert!(authorize_tenant_root_operation_v1(
        &record,
        &capability,
        &forged,
        None,
        &governance,
        &issuer_keys(),
        NOW,
    )
    .is_err());
}

#[test]
fn expired_operations_and_capabilities_are_refused() {
    let governance = single_owner();
    let record = record_for(
        TenantRootOperationKindV1::OperationalShareRotation,
        &governance,
    );
    let capability = capability_for(&record);

    // Past the record's own expiry, beyond the permitted skew.
    assert!(authorize_tenant_root_operation_v1(
        &record,
        &capability,
        &step_up(REQUESTER, "2026-09-05T12:07:00.000Z"),
        None,
        &governance,
        &issuer_keys(),
        "2026-09-05T12:07:00.000Z",
    )
    .is_err());

    // A capability that expires before the record does.
    let short = TenantRootOperationCapabilityV1::issue(
        record.digest().unwrap(),
        TenantRootOperationNonceV1::from_bytes([0x55; 32]).unwrap(),
        "console-capability-key-1",
        ISSUED_AT,
        "2026-09-05T11:58:30.000Z",
        &capability_key().to_bytes(),
    )
    .expect("capability");
    assert!(authorize_tenant_root_operation_v1(
        &record,
        &short,
        &step_up(REQUESTER, NOW),
        None,
        &governance,
        &issuer_keys(),
        NOW,
    )
    .is_err());
}

#[test]
fn a_record_issued_under_different_governance_is_refused() {
    let record = record_for(
        TenantRootOperationKindV1::OperationalShareRotation,
        &single_owner(),
    );
    assert!(authorize_tenant_root_operation_v1(
        &record,
        &capability_for(&record),
        &step_up(REQUESTER, NOW),
        None,
        &two_person(),
        &issuer_keys(),
        NOW,
    )
    .is_err());
}

#[test]
fn records_bind_their_subject_role_and_lifetime_to_the_operation() {
    let governance = single_owner();

    // A role-local operation must name its role, and only a role-local one may.
    assert!(TenantRootOperationRecordV1::new(
        TenantRootOperationKindV1::RecoveryRolePackageDownload,
        &identity(),
        lineage(),
        7,
        &governance,
        TenantRootOperationSubjectV1::RecoverySet {
            recovery_set_id: router_ab_core::TenantRootRecoverySetId::from_bytes([0x41; 16])
                .unwrap(),
        },
        None,
        REQUESTER,
        "idempotency-1",
        ISSUED_AT,
        EXPIRES_AT,
        root_commitment(),
    )
    .is_err());
    assert!(TenantRootOperationRecordV1::new(
        TenantRootOperationKindV1::OperationalShareRotation,
        &identity(),
        lineage(),
        7,
        &governance,
        TenantRootOperationSubjectV1::TenantRoot,
        Some(TwoPartyDeriverRole::DeriverA),
        REQUESTER,
        "idempotency-1",
        ISSUED_AT,
        EXPIRES_AT,
        root_commitment(),
    )
    .is_err());

    // A recipient-pair operation cannot claim a recovery-set subject.
    assert!(TenantRootOperationRecordV1::new(
        TenantRootOperationKindV1::RecoveryRecipientPairEnroll,
        &identity(),
        lineage(),
        7,
        &governance,
        TenantRootOperationSubjectV1::TenantRoot,
        None,
        REQUESTER,
        "idempotency-1",
        ISSUED_AT,
        EXPIRES_AT,
        root_commitment(),
    )
    .is_err());

    // A ciphertext download authorization may not outlive five minutes.
    assert!(TenantRootOperationRecordV1::new(
        TenantRootOperationKindV1::RecoveryRolePackageDownload,
        &identity(),
        lineage(),
        7,
        &governance,
        TenantRootOperationSubjectV1::RecoverySet {
            recovery_set_id: router_ab_core::TenantRootRecoverySetId::from_bytes([0x41; 16])
                .unwrap(),
        },
        Some(TwoPartyDeriverRole::DeriverA),
        REQUESTER,
        "idempotency-1",
        ISSUED_AT,
        "2026-09-05T12:04:00.000Z",
        root_commitment(),
    )
    .is_err());
}

#[test]
fn a_governance_transition_uses_the_stronger_quorum() {
    assert!(!tenant_root_governance_transition_quorum_v1(
        &single_owner(),
        &single_owner()
    ));
    assert!(tenant_root_governance_transition_quorum_v1(
        &single_owner(),
        &two_person()
    ));
    // A two-person tenant cannot be downgraded by one owner alone.
    assert!(tenant_root_governance_transition_quorum_v1(
        &two_person(),
        &single_owner()
    ));
    assert!(tenant_root_governance_transition_quorum_v1(
        &two_person(),
        &two_person()
    ));
}
