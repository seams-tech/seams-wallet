use router_ab_core::{
    TenantRootActivationReceiptTransitionV1, TenantRootBackupPolicyV1,
    TenantRootCanaryCurveFamilyV1, TenantRootCeremonyEpochsV1, TenantRootEpochCommitmentsV1,
    TenantRootLifecycleReceiptDigestV1, TenantRootProtocolDigestV1,
    TenantRootRoleInstallationReceiptsV1, TenantRootShareEpoch,
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
    VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1,
};
use threshold_prf::TwoPartyDeriverRole;

mod support;

use support::activation::{
    commitments, context, identity, lineage, refresh_epochs, restore_context,
    restore_refresh_scope, role_signing_key_id, AcceptedLossScope, Signers,
};
use support::{EXPIRES_AT_MS, ISSUED_AT_MS};

const SIGNERS: Signers = Signers {
    deriver_a: [0x51; 32],
    deriver_b: [0x61; 32],
    canary: [0x41; 32],
    loss_authorities: [[0x41; 32], [0x42; 32]],
    restore_issuer_key_id: "control-plane-restore-refresh-v1",
    restore_issuer: [0x41; 32],
};

fn managed_backup(
    installation: &router_ab_core::VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    share: &router_ab_core::MpcPrfSigningRootShareWireV1,
    role: TwoPartyDeriverRole,
) -> router_ab_core::VerifiedTenantRootManagedBackupV1 {
    let key_id = role_signing_key_id(role);
    SIGNERS.managed_backup(
        installation,
        share,
        role,
        &format!("kms/{key_id}/epoch"),
        &format!("kms-key/{key_id}/v1"),
        key_id,
    )
}

fn accepted_loss(
    epochs: TenantRootCeremonyEpochsV1,
    target_commitments: &TenantRootEpochCommitmentsV1,
    installation_receipts: TenantRootRoleInstallationReceiptsV1,
    expected_control_plane_revision: u64,
    result_control_plane_revision: u64,
) -> router_ab_core::VerifiedTenantRootAcceptedPermanentLossAuthorizationV1 {
    accepted_loss_with_scope(
        epochs,
        target_commitments,
        installation_receipts,
        context(epochs).digest().expect("context digest"),
        expected_control_plane_revision,
        result_control_plane_revision,
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
    )
}

fn accepted_loss_with_scope(
    epochs: TenantRootCeremonyEpochsV1,
    target_commitments: &TenantRootEpochCommitmentsV1,
    installation_receipts: TenantRootRoleInstallationReceiptsV1,
    context_digest: TenantRootProtocolDigestV1,
    expected_control_plane_revision: u64,
    result_control_plane_revision: u64,
    issued_at_ms: u64,
    expires_at_ms: u64,
) -> router_ab_core::VerifiedTenantRootAcceptedPermanentLossAuthorizationV1 {
    SIGNERS.accepted_loss(AcceptedLossScope {
        epochs,
        identity_digest: identity(),
        custody_lineage: lineage(),
        context_digest,
        commitments: target_commitments,
        installation_receipts,
        expected_control_plane_revision,
        result_control_plane_revision,
        issued_at_ms,
        expires_at_ms,
    })
}

fn refresh_installation_receipts() -> TenantRootRoleInstallationReceiptsV1 {
    let epochs = refresh_epochs();
    let (installation_a, _) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverA, 19, 33, 0x71);
    let (installation_b, _) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverB, 33, 19, 0x81);
    TenantRootRoleInstallationReceiptsV1::new(
        installation_a
            .lifecycle_receipt_digest()
            .expect("installation receipt A"),
        installation_b
            .lifecycle_receipt_digest()
            .expect("installation receipt B"),
    )
    .expect("installation receipts")
}

fn refresh_bundle_with_authorization(
    authorization: router_ab_core::VerifiedTenantRootAcceptedPermanentLossAuthorizationV1,
    expected_control_plane_revision: u64,
    result_control_plane_revision: u64,
) -> router_ab_core::RouterAbDerivationResult<VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1>
{
    let current = commitments(12, 19);
    let epochs = refresh_epochs();
    let next = commitments(19, 33);
    let (installation_a, _) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverA, 19, 33, 0x71);
    let (installation_b, _) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverB, 33, 19, 0x81);
    let ecdsa = SIGNERS.canary(epochs, &next, TenantRootCanaryCurveFamilyV1::Ecdsa);
    let ed25519 = SIGNERS.canary(epochs, &next, TenantRootCanaryCurveFamilyV1::Ed25519);
    VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1::from_verified_accepted_loss(
        &current,
        installation_a,
        installation_b,
        authorization,
        ecdsa,
        ed25519,
        expected_control_plane_revision,
        result_control_plane_revision,
    )
}

#[test]
fn initial_creation_bundle_derives_strict_projections_and_consumes_installation_wires() {
    let epochs = TenantRootCeremonyEpochsV1::create();
    let expected_commitments = commitments(12, 19);
    let (installation_a, share_a) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverA, 12, 19, 0x51);
    let (installation_b, share_b) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverB, 19, 12, 0x61);
    let installation_a_bytes = installation_a.canonical_bytes().to_vec();
    let installation_b_bytes = installation_b.canonical_bytes().to_vec();
    let backup_a = managed_backup(&installation_a, &share_a, TwoPartyDeriverRole::DeriverA);
    let backup_b = managed_backup(&installation_b, &share_b, TwoPartyDeriverRole::DeriverB);
    let backup_a_receipt = backup_a.receipt_digest();
    let backup_b_receipt = backup_b.receipt_digest();
    let ecdsa = SIGNERS.canary(
        epochs,
        &expected_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
    );
    let ed25519 = SIGNERS.canary(
        epochs,
        &expected_commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
    );

    let bundle =
        VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_managed_backups(
            installation_a,
            installation_b,
            backup_a,
            backup_b,
            ecdsa,
            ed25519,
            2,
            3,
        )
        .expect("initial activation evidence bundle");

    assert_eq!(
        bundle.transition(),
        TenantRootActivationReceiptTransitionV1::InitialCreation
    );
    assert_eq!(bundle.epochs(), epochs);
    assert_eq!(bundle.epoch(), TenantRootShareEpoch::INITIAL);
    assert_eq!(bundle.identity_digest(), identity());
    assert_eq!(bundle.custody_lineage(), lineage());
    assert_eq!(
        bundle.context_digest(),
        context(epochs).digest().expect("context digest")
    );
    assert_eq!(bundle.commitments(), &expected_commitments);
    assert_eq!(
        bundle.root_commitment(),
        expected_commitments.root_commitment()
    );
    assert_eq!(
        bundle.backup_policy(),
        TenantRootBackupPolicyV1::CurrentRoleBackups(
            router_ab_core::TenantRootRoleBackupReceiptsV1::new(backup_a_receipt, backup_b_receipt)
                .expect("backup receipts"),
        )
    );
    assert_eq!(
        *bundle.canary_receipts().ecdsa().as_bytes(),
        ecdsa_digest(&bundle)
    );
    bundle
        .require_fresh(ISSUED_AT_MS + 10)
        .expect("fresh bundle");

    let (actual_a_bytes, actual_b_bytes) = bundle.into_installation_evidence_bytes();
    assert_eq!(actual_a_bytes, installation_a_bytes);
    assert_eq!(actual_b_bytes, installation_b_bytes);
}

#[test]
fn tenant_held_external_restore_provenance_survives_initial_activation_and_refresh() {
    let scope = restore_refresh_scope();
    let restore_context = restore_context(&scope);
    let command_a =
        SIGNERS.restore_command(&scope, &restore_context, TwoPartyDeriverRole::DeriverA);
    let command_b =
        SIGNERS.restore_command(&scope, &restore_context, TwoPartyDeriverRole::DeriverB);
    assert_eq!(command_a.context(), command_b.context());
    assert_eq!(
        command_a.destination_fingerprint(),
        scope.destination_fingerprint
    );
    assert_eq!(command_a.restore_session_id(), scope.restore_session_id);
    assert_eq!(command_a.manifest_digest(), &scope.manifest_digest);
    assert_eq!(
        command_a.acceptance_receipt(TwoPartyDeriverRole::DeriverA),
        scope.deriver_a_acceptance_receipt_digest
    );
    assert_eq!(
        command_a.acceptance_receipt(TwoPartyDeriverRole::DeriverB),
        scope.deriver_b_acceptance_receipt_digest
    );
    assert_eq!(
        command_a.stable_root_commitment(),
        scope.commitments.root_commitment()
    );

    let initial_bundle =
        SIGNERS.tenant_held_external_initial_bundle(&scope, &restore_context, &command_a);

    assert_eq!(
        initial_bundle.transition(),
        TenantRootActivationReceiptTransitionV1::InitialCreation
    );
    assert_eq!(initial_bundle.identity_digest(), identity());
    assert_eq!(initial_bundle.custody_lineage(), lineage());
    assert_eq!(initial_bundle.context(), &restore_context);
    assert_eq!(
        initial_bundle.context_digest(),
        restore_context.digest().expect("restore context digest")
    );
    assert_eq!(initial_bundle.commitments(), &scope.commitments);
    assert_eq!(
        initial_bundle.root_commitment(),
        scope.commitments.root_commitment()
    );

    let provenance = match initial_bundle.availability() {
        router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::TenantHeldExternal {
            provenance,
        } => provenance.clone(),
        _ => panic!("restore activation must retain tenant-held external provenance"),
    };
    assert_eq!(provenance.identity_digest(), identity());
    assert_eq!(provenance.custody_lineage(), lineage());
    assert_eq!(
        provenance.destination_fingerprint(),
        scope.destination_fingerprint
    );
    assert_eq!(provenance.restore_session_id(), scope.restore_session_id);
    assert_eq!(provenance.recovery_set_id(), scope.recovery_set_id);
    assert_eq!(provenance.manifest_digest(), &scope.manifest_digest);
    assert_eq!(
        provenance.deriver_a_acceptance_receipt_digest(),
        scope.deriver_a_acceptance_receipt_digest
    );
    assert_eq!(
        provenance.deriver_b_acceptance_receipt_digest(),
        scope.deriver_b_acceptance_receipt_digest
    );
    assert_eq!(
        provenance.deriver_a_imported_commitment(),
        scope.commitments.deriver_a()
    );
    assert_eq!(
        provenance.deriver_b_imported_commitment(),
        scope.commitments.deriver_b()
    );
    assert_eq!(
        provenance.stable_root_commitment(),
        scope.commitments.root_commitment()
    );
    assert_eq!(
        provenance.restore_context_digest(),
        restore_context.digest().expect("restore context digest")
    );
    assert_eq!(
        provenance.restore_refresh_command_digest(),
        command_a.digest()
    );
    assert_eq!(
        initial_bundle.backup_policy(),
        TenantRootBackupPolicyV1::TenantHeldExternal(provenance.clone())
    );

    let refresh_bundle = SIGNERS.tenant_held_external_refresh_bundle(&scope, &provenance);
    assert_eq!(
        refresh_bundle.transition(),
        TenantRootActivationReceiptTransitionV1::RefreshSwap
    );
    assert_eq!(
        refresh_bundle.root_commitment(),
        provenance.stable_root_commitment()
    );
    assert_eq!(
        refresh_bundle.backup_policy(),
        TenantRootBackupPolicyV1::TenantHeldExternal(provenance.clone())
    );
    match refresh_bundle.availability() {
        router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::TenantHeldExternal {
            provenance: refresh_provenance,
        } => assert_eq!(refresh_provenance, &provenance),
        _ => panic!("refresh activation must retain tenant-held external provenance"),
    }
}

#[test]
fn refresh_bundle_derives_root_continuity_and_accepted_loss_projection() {
    let current = commitments(12, 19);
    let epochs = TenantRootCeremonyEpochsV1::refresh(
        TenantRootShareEpoch::new(7).expect("current epoch"),
        TenantRootShareEpoch::new(8).expect("next epoch"),
    )
    .expect("refresh epochs");
    let next = commitments(19, 33);
    let (installation_a, _) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverA, 19, 33, 0x71);
    let (installation_b, _) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverB, 33, 19, 0x81);
    let installation_receipts = TenantRootRoleInstallationReceiptsV1::new(
        installation_a
            .lifecycle_receipt_digest()
            .expect("installation receipt A"),
        installation_b
            .lifecycle_receipt_digest()
            .expect("installation receipt B"),
    )
    .expect("installation receipts");
    let authorization = accepted_loss(epochs, &next, installation_receipts, 11, 12);
    let authorization_bytes = authorization.canonical_bytes().to_vec();
    let authorization_digest = authorization.digest();
    let ecdsa = SIGNERS.canary(epochs, &next, TenantRootCanaryCurveFamilyV1::Ecdsa);
    let ed25519 = SIGNERS.canary(epochs, &next, TenantRootCanaryCurveFamilyV1::Ed25519);

    let bundle =
        VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1::from_verified_accepted_loss(
            &current,
            installation_a,
            installation_b,
            authorization,
            ecdsa,
            ed25519,
            11,
            12,
        )
        .expect("refresh activation evidence bundle");

    assert_eq!(
        bundle.transition(),
        TenantRootActivationReceiptTransitionV1::RefreshSwap
    );
    assert_eq!(
        bundle.current_epoch(),
        TenantRootShareEpoch::new(7).expect("current epoch")
    );
    assert_eq!(
        bundle.next_epoch(),
        TenantRootShareEpoch::new(8).expect("next epoch")
    );
    assert_eq!(bundle.current_commitments(), &current);
    assert_eq!(bundle.next_commitments(), &next);
    assert_eq!(bundle.root_commitment(), current.root_commitment());
    assert_eq!(
        bundle.context_digest(),
        context(epochs).digest().expect("context digest")
    );
    let TenantRootBackupPolicyV1::AcceptedPermanentDerivationLoss(receipt) = bundle.backup_policy()
    else {
        panic!("expected accepted-loss backup policy");
    };
    assert_eq!(
        receipt.authorization_bytes(),
        authorization_bytes.as_slice()
    );
    assert_eq!(receipt.authorization_digest(), &authorization_digest);
    assert!(matches!(
        bundle.availability(),
        router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::AcceptedPermanentDerivationLoss {
            ..
        }
    ));
    bundle
        .require_fresh(ISSUED_AT_MS + 10)
        .expect("fresh bundle");
}

#[test]
fn accepted_loss_bundle_rejects_scope_replays() {
    let epochs = refresh_epochs();
    let next = commitments(19, 33);
    let installation_receipts = refresh_installation_receipts();
    let cases = [
        (
            "context",
            accepted_loss_with_scope(
                epochs,
                &next,
                installation_receipts,
                TenantRootProtocolDigestV1::from_bytes([0x56; 32]).expect("context digest"),
                11,
                12,
                ISSUED_AT_MS,
                EXPIRES_AT_MS,
            ),
        ),
        (
            "deriver A commitment",
            accepted_loss_with_scope(
                epochs,
                &commitments(20, 33),
                installation_receipts,
                context(epochs).digest().expect("context digest"),
                11,
                12,
                ISSUED_AT_MS,
                EXPIRES_AT_MS,
            ),
        ),
        (
            "deriver B commitment",
            accepted_loss_with_scope(
                epochs,
                &commitments(19, 34),
                installation_receipts,
                context(epochs).digest().expect("context digest"),
                11,
                12,
                ISSUED_AT_MS,
                EXPIRES_AT_MS,
            ),
        ),
        (
            "deriver A installation receipt",
            accepted_loss_with_scope(
                epochs,
                &next,
                TenantRootRoleInstallationReceiptsV1::new(
                    TenantRootLifecycleReceiptDigestV1::from_bytes([0x91; 32]).expect("receipt A"),
                    installation_receipts.deriver_b(),
                )
                .expect("installation receipts"),
                context(epochs).digest().expect("context digest"),
                11,
                12,
                ISSUED_AT_MS,
                EXPIRES_AT_MS,
            ),
        ),
        (
            "deriver B installation receipt",
            accepted_loss_with_scope(
                epochs,
                &next,
                TenantRootRoleInstallationReceiptsV1::new(
                    installation_receipts.deriver_a(),
                    TenantRootLifecycleReceiptDigestV1::from_bytes([0x92; 32]).expect("receipt B"),
                )
                .expect("installation receipts"),
                context(epochs).digest().expect("context digest"),
                11,
                12,
                ISSUED_AT_MS,
                EXPIRES_AT_MS,
            ),
        ),
        (
            "authorization revisions",
            accepted_loss_with_scope(
                epochs,
                &next,
                installation_receipts,
                context(epochs).digest().expect("context digest"),
                12,
                13,
                ISSUED_AT_MS,
                EXPIRES_AT_MS,
            ),
        ),
        (
            "authorization issue time",
            accepted_loss_with_scope(
                epochs,
                &next,
                installation_receipts,
                context(epochs).digest().expect("context digest"),
                11,
                12,
                ISSUED_AT_MS + 1,
                EXPIRES_AT_MS + 1,
            ),
        ),
        (
            "authorization expiry time",
            accepted_loss_with_scope(
                epochs,
                &next,
                installation_receipts,
                context(epochs).digest().expect("context digest"),
                11,
                12,
                ISSUED_AT_MS,
                EXPIRES_AT_MS - 1,
            ),
        ),
    ];
    for (label, authorization) in cases {
        assert!(
            refresh_bundle_with_authorization(authorization, 11, 12).is_err(),
            "{label} must remain bound to the exact refresh ceremony"
        );
    }

    assert!(
        refresh_bundle_with_authorization(
            accepted_loss(epochs, &next, installation_receipts, 11, 12,),
            10,
            11,
        )
        .is_err(),
        "the expected lifecycle revision must be part of the activation claim"
    );
    assert!(
        refresh_bundle_with_authorization(
            accepted_loss(epochs, &next, installation_receipts, 11, 12,),
            11,
            13,
        )
        .is_err(),
        "the result lifecycle revision must be part of the activation claim"
    );
}

#[test]
fn bundle_rejects_installation_source_digest_and_canary_family_substitution() {
    let epochs = TenantRootCeremonyEpochsV1::create();
    let expected_commitments = commitments(12, 19);
    let (original_a, share_a) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverA, 12, 19, 0x91);
    let (installation_b, share_b) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverB, 19, 12, 0xa1);
    let backup_a = managed_backup(&original_a, &share_a, TwoPartyDeriverRole::DeriverA);
    let backup_b = managed_backup(&installation_b, &share_b, TwoPartyDeriverRole::DeriverB);
    let ecdsa = SIGNERS.canary(
        epochs,
        &expected_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
    );
    let ed25519 = SIGNERS.canary(
        epochs,
        &expected_commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
    );
    let (substituted_a, _) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverA, 12, 19, 0xb1);

    assert!(
        VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_managed_backups(
            substituted_a,
            installation_b,
            backup_a,
            backup_b,
            ecdsa,
            ed25519,
            2,
            3,
        )
        .is_err(),
        "backup provenance must follow the exact installation wire digest"
    );

    let (installation_a, share_a) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverA, 12, 19, 0xc1);
    let (installation_b, share_b) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverB, 19, 12, 0xd1);
    let backup_a = managed_backup(&installation_a, &share_a, TwoPartyDeriverRole::DeriverA);
    let backup_b = managed_backup(&installation_b, &share_b, TwoPartyDeriverRole::DeriverB);
    let ecdsa = SIGNERS.canary(
        epochs,
        &expected_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
    );
    let wrong_family = SIGNERS.canary(
        epochs,
        &expected_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
    );
    assert!(
        VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_managed_backups(
            installation_a,
            installation_b,
            backup_a,
            backup_b,
            ecdsa,
            wrong_family,
            2,
            3,
        )
        .is_err(),
        "the second provider canary must be Ed25519"
    );
}

fn ecdsa_digest(bundle: &VerifiedTenantRootInitialCreationActivationEvidenceBundleV1) -> [u8; 32] {
    match bundle.availability() {
        router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::CurrentRoleBackups {
            ..
        } => *bundle.canary_receipts().ecdsa().as_bytes(),
        router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::AcceptedPermanentDerivationLoss {
            ..
        } => unreachable!("initial test uses managed backups"),
        router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::TenantHeldExternal {
            ..
        } => unreachable!("initial test uses managed backups"),
    }
}
