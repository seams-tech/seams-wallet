//! Console lifecycle state: what each branch is allowed to claim.

use router_ab_core::{
    TenantRootConsoleStateV1, TenantRootCustodyLineageId, TenantRootOperationKindV1,
    TenantRootOutstandingCleanupV1, TenantRootReceiptDigestV1, TenantRootRecipientEnrolmentV1,
    TenantRootRecipientPairV1, TenantRootRecoveryBackupV1,
    TenantRootRecoveryRecipientFingerprintV1, TenantRootRecoverySetId,
    TenantRootRecoverySetStateV1, TenantRootRestoreSessionV1, TenantRootRoleImportProgressV1,
    TenantRootRoleReceiptsV1, TenantRootRotationJobV1, TenantRootShareEpoch,
    TenantRootSourceCustodyDispositionV1,
};
use threshold_prf::TwoPartyDeriverRole;

fn receipt(seed: u8) -> TenantRootReceiptDigestV1 {
    TenantRootReceiptDigestV1::from_bytes([seed; 32]).expect("receipt")
}

fn role_receipts() -> TenantRootRoleReceiptsV1 {
    TenantRootRoleReceiptsV1::new(receipt(0x11), receipt(0x12)).expect("role receipts")
}

fn fingerprint(seed: u8) -> TenantRootRecoveryRecipientFingerprintV1 {
    TenantRootRecoveryRecipientFingerprintV1::from_bytes([seed; 32])
}

fn recipient_pair() -> TenantRootRecipientPairV1 {
    TenantRootRecipientPairV1::new(fingerprint(0x21), fingerprint(0x22)).expect("pair")
}

fn recovery_set() -> TenantRootRecoverySetStateV1 {
    TenantRootRecoverySetStateV1::new(
        TenantRootRecoverySetId::from_bytes([0x41; 16]).unwrap(),
        recipient_pair(),
        "2026-08-29T10:20:30.123Z",
        receipt(0x31),
    )
    .expect("recovery set")
}

fn epoch() -> TenantRootShareEpoch {
    TenantRootShareEpoch::new(4).expect("epoch")
}

fn outstanding() -> TenantRootOutstandingCleanupV1 {
    TenantRootOutstandingCleanupV1::new(
        vec![TwoPartyDeriverRole::DeriverB],
        "deriver-b-retirement-receipt",
    )
    .expect("outstanding")
}

#[test]
fn only_a_complete_rotation_may_claim_compromise_healing() {
    let activated = TenantRootRotationJobV1::Retiring {
        activated_epoch: epoch(),
        activation_receipt: receipt(0x51),
    };
    assert!(!activated.permits_compromise_healing_claim());

    let retirement_incomplete = TenantRootRotationJobV1::RetirementIncomplete {
        activated_epoch: epoch(),
        activation_receipt: receipt(0x51),
        outstanding: outstanding(),
    };
    assert!(!retirement_incomplete.permits_compromise_healing_claim());
    assert_eq!(retirement_incomplete.as_str(), "retirement_incomplete");
    assert!(!retirement_incomplete.is_in_flight());

    let complete = TenantRootRotationJobV1::Complete {
        activated_epoch: epoch(),
        activation_receipt: receipt(0x51),
        retirement_receipts: role_receipts(),
    };
    assert!(complete.permits_compromise_healing_claim());
}

#[test]
fn evidence_that_needs_two_receipts_cannot_be_built_from_one() {
    assert!(TenantRootRoleReceiptsV1::new(receipt(0x11), receipt(0x11)).is_err());
    assert!(TenantRootReceiptDigestV1::from_bytes([0; 32]).is_err());

    let receipts = role_receipts();
    assert_ne!(
        receipts.role(TwoPartyDeriverRole::DeriverA).as_bytes(),
        receipts.role(TwoPartyDeriverRole::DeriverB).as_bytes()
    );
}

#[test]
fn one_recipient_key_cannot_serve_both_roles() {
    assert!(TenantRootRecipientPairV1::new(fingerprint(0x21), fingerprint(0x21)).is_err());
    let pair = recipient_pair();
    assert_ne!(
        pair.role(TwoPartyDeriverRole::DeriverA).as_bytes(),
        pair.role(TwoPartyDeriverRole::DeriverB).as_bytes()
    );
}

#[test]
fn outstanding_cleanup_must_name_what_is_outstanding() {
    assert!(TenantRootOutstandingCleanupV1::new(Vec::new(), "nothing").is_err());
    assert!(TenantRootOutstandingCleanupV1::new(
        vec![TwoPartyDeriverRole::DeriverA, TwoPartyDeriverRole::DeriverA],
        "duplicate role",
    )
    .is_err());
}

#[test]
fn download_availability_follows_the_exact_backup_branch() {
    assert!(TenantRootRecoveryBackupV1::NotConfigured
        .downloadable_set()
        .is_none());
    assert!(TenantRootRecoveryBackupV1::RecipientsPending {
        enrolled: TenantRootRecipientEnrolmentV1::DeriverAEnrolled {
            deriver_a: fingerprint(0x21),
        },
    }
    .downloadable_set()
    .is_none());

    // The old set stays downloadable while a replacement is generated, and
    // after a replacement fails.
    assert!(TenantRootRecoveryBackupV1::Replacing {
        active: recovery_set(),
        pending_recipient_pair: TenantRootRecipientPairV1::new(
            fingerprint(0x31),
            fingerprint(0x32)
        )
        .unwrap(),
        pending_recovery_set_id: TenantRootRecoverySetId::from_bytes([0x42; 16]).unwrap(),
    }
    .downloadable_set()
    .is_some());
    assert!(TenantRootRecoveryBackupV1::FailedReplacement {
        active: recovery_set(),
        failure_code: "deriver_b_unavailable".to_owned(),
        cleanup_receipts: role_receipts(),
    }
    .downloadable_set()
    .is_some());

    // A restored set was never stored here, so it cannot be served.
    let external = TenantRootRecoveryBackupV1::TenantHeldExternal {
        recovery_set_id: TenantRootRecoverySetId::from_bytes([0x41; 16]).unwrap(),
        manifest_digest: receipt(0x31),
    };
    assert_eq!(external.as_str(), "tenant_held_external");
    assert!(external.downloadable_set().is_none());
}

#[test]
fn source_disposition_records_evidence_rather_than_a_boolean() {
    let retired = TenantRootSourceCustodyDispositionV1::verified_retired(
        role_receipts(),
        TenantRootRoleReceiptsV1::new(receipt(0x61), receipt(0x62)).unwrap(),
        receipt(0x71),
        receipt(0x72),
        "owner-1",
        "2026-09-05T12:00:00.000Z",
    )
    .expect("verified retired");
    assert!(retired.source_is_proved_retired());

    let unverified = TenantRootSourceCustodyDispositionV1::unavailable_retirement_unverified(
        vec!["deriver_a_destruction".to_owned()],
        "owner-1",
        "2026-09-05T12:00:00.000Z",
    )
    .expect("unverified");
    assert!(!unverified.source_is_proved_retired());
    assert_eq!(unverified.as_str(), "unavailable_retirement_unverified");

    let retained = TenantRootSourceCustodyDispositionV1::retained_as_backup(
        "owner-1",
        "source stays in the incident-response model",
        "2026-09-05T12:00:00.000Z",
    )
    .expect("retained");
    assert!(!retained.source_is_proved_retired());

    // An unverified retirement must say what it actually tried.
    assert!(
        TenantRootSourceCustodyDispositionV1::unavailable_retirement_unverified(
            Vec::new(),
            "owner-1",
            "2026-09-05T12:00:00.000Z",
        )
        .is_err()
    );
}

#[test]
fn one_operation_lock_serializes_mutations_but_not_downloads() {
    let rotating = TenantRootConsoleStateV1::new(
        Some(TenantRootRotationJobV1::Installing),
        TenantRootRecoveryBackupV1::Ready {
            active: recovery_set(),
        },
        None,
    )
    .expect("state");

    for kind in [
        TenantRootOperationKindV1::OperationalShareRotation,
        TenantRootOperationKindV1::RecoveryGovernanceChange,
        TenantRootOperationKindV1::RecoveryRecipientPairEnroll,
        TenantRootOperationKindV1::RecoveryBackupReplace,
        TenantRootOperationKindV1::RestoreSessionStart,
        TenantRootOperationKindV1::SourceLineageRetire,
    ] {
        assert!(
            rotating.permits_operation(kind).is_err(),
            "{} must wait for the in-flight rotation",
            kind.as_str()
        );
    }

    // Downloading an already-complete set does not take the lock.
    assert!(rotating
        .permits_operation(TenantRootOperationKindV1::RecoveryRolePackageDownload)
        .is_ok());
    assert!(rotating
        .permits_operation(TenantRootOperationKindV1::RecoveryManifestDownload)
        .is_ok());

    // A completed rotation releases the lock.
    let settled = TenantRootConsoleStateV1::new(
        Some(TenantRootRotationJobV1::Complete {
            activated_epoch: epoch(),
            activation_receipt: receipt(0x51),
            retirement_receipts: role_receipts(),
        }),
        TenantRootRecoveryBackupV1::Ready {
            active: recovery_set(),
        },
        None,
    )
    .expect("state");
    assert!(settled
        .permits_operation(TenantRootOperationKindV1::OperationalShareRotation)
        .is_ok());

    // A backup being generated also holds the lock.
    let preparing = TenantRootConsoleStateV1::new(
        None,
        TenantRootRecoveryBackupV1::PreparingInitial {
            recipient_pair: recipient_pair(),
            pending_recovery_set_id: TenantRootRecoverySetId::from_bytes([0x42; 16]).unwrap(),
        },
        None,
    )
    .expect("state");
    assert!(preparing
        .permits_operation(TenantRootOperationKindV1::OperationalShareRotation)
        .is_err());
}

#[test]
fn a_tenant_root_cannot_rotate_and_restore_at_once() {
    assert!(TenantRootConsoleStateV1::new(
        Some(TenantRootRotationJobV1::Activating),
        TenantRootRecoveryBackupV1::NotConfigured,
        Some(TenantRootRestoreSessionV1::AwaitingRoleImports {
            recovery_set_id: TenantRootRecoverySetId::from_bytes([0x41; 16]).unwrap(),
            installed: TenantRootRoleImportProgressV1::NeitherInstalled,
        }),
    )
    .is_err());

    // An activated restore no longer holds the lock against the new deployment.
    let restored = TenantRootConsoleStateV1::new(
        None,
        TenantRootRecoveryBackupV1::TenantHeldExternal {
            recovery_set_id: TenantRootRecoverySetId::from_bytes([0x41; 16]).unwrap(),
            manifest_digest: receipt(0x31),
        },
        Some(TenantRootRestoreSessionV1::Active {
            destination_lineage: TenantRootCustodyLineageId::from_bytes([0x32; 16]).unwrap(),
            activated_epoch: epoch(),
            activation_receipt: receipt(0x51),
            forward_refresh_receipt: receipt(0x53),
            continuity_canary_receipt: receipt(0x54),
            bootstrap_destruction_receipt: receipt(0x52),
            source_disposition: TenantRootSourceCustodyDispositionV1::retained_as_backup(
                "owner-1",
                "source stays in the incident-response model",
                "2026-09-05T12:00:00.000Z",
            )
            .unwrap(),
            tenant_held_recovery_set_id: TenantRootRecoverySetId::from_bytes([0x41; 16]).unwrap(),
        }),
    )
    .expect("state");
    assert!(restored
        .permits_operation(TenantRootOperationKindV1::RecoveryBackupReplace)
        .is_ok());
    assert_eq!(restored.restore().unwrap().as_str(), "active");
}

#[test]
fn a_restore_session_admits_its_own_steps_and_nothing_else() {
    let restoring = TenantRootConsoleStateV1::new(
        None,
        TenantRootRecoveryBackupV1::NotConfigured,
        Some(TenantRootRestoreSessionV1::AwaitingRoleImports {
            recovery_set_id: TenantRootRecoverySetId::from_bytes([0x41; 16]).unwrap(),
            installed: TenantRootRoleImportProgressV1::NeitherInstalled,
        }),
    )
    .expect("state");

    // The steps that continue the session run while it holds the lock.
    for kind in [
        TenantRootOperationKindV1::RestoreManifestRegister,
        TenantRootOperationKindV1::RestoreRoleImportKeyIssue,
        TenantRootOperationKindV1::RestoreRoleImport,
        TenantRootOperationKindV1::RestoreActivate,
    ] {
        assert!(
            restoring.permits_operation(kind).is_ok(),
            "{} continues the in-flight restore session",
            kind.as_str()
        );
    }
    // Everything that would compete with the session waits.
    for kind in [
        TenantRootOperationKindV1::RestoreSessionStart,
        TenantRootOperationKindV1::OperationalShareRotation,
        TenantRootOperationKindV1::RecoveryGovernanceChange,
        TenantRootOperationKindV1::RecoveryBackupCreate,
        TenantRootOperationKindV1::SourceLineageRetire,
    ] {
        assert!(
            restoring.permits_operation(kind).is_err(),
            "{} must wait for the in-flight restore session",
            kind.as_str()
        );
    }

    // Without a session in flight, a session step has nothing to continue.
    let idle = TenantRootConsoleStateV1::new(None, TenantRootRecoveryBackupV1::NotConfigured, None)
        .expect("state");
    assert!(idle
        .permits_operation(TenantRootOperationKindV1::RestoreSessionStart)
        .is_ok());
    for kind in [
        TenantRootOperationKindV1::RestoreManifestRegister,
        TenantRootOperationKindV1::RestoreRoleImport,
        TenantRootOperationKindV1::RestoreActivate,
    ] {
        assert!(
            idle.permits_operation(kind).is_err(),
            "{} needs a restore session in flight",
            kind.as_str()
        );
    }
}
