//! Command payload digest, terminal receipt, refresh replay and epoch-swap tests.

use super::*;

pub(super) fn assert_payload_digest_changes(
    cases: &[(&str, TenantRootProtocolDigestV1, TenantRootProtocolDigestV1)],
) {
    for (label, original, changed) in cases {
        assert_ne!(
            original, changed,
            "{label} did not change its payload digest"
        );
    }
}

#[test]
fn branch_commands_preserve_linear_reservation_for_terminalization() {
    let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let identity = pending.identity().digest().expect("identity digest");
    let lineage = pending.custody_lineage();
    let key = TenantRootCommandReplayKeyV1::deriver_a(
        identity,
        lineage,
        TenantRootCeremonySessionIdV1::from_bytes([0x21; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x22; 32]).expect("nonce"),
    );
    let scope = TenantRootCommandScopeV1::new(key, pending.epoch(), 1).expect("scope");
    let command_digest =
        TenantRootProtocolDigestV1::from_bytes([0x23; 32]).expect("command digest");
    let reservation = match reserve_tenant_root_command_v1(None, key, command_digest, 1)
        .expect("reservation")
    {
        TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
        _ => panic!("fresh reservation must be executable"),
    };
    let command = CloudflareTenantRootInsertPendingCommandV1 {
        scope,
        reservation,
        record: pending,
        expected_revision: 1,
        operation_payload_digest: command_digest,
    };
    let CloudflareTenantRootInsertPendingCommandV1 { reservation, .. } = command;
    let terminal = reservation
        .checkpoint_executed(2)
        .expect("reservation checkpoints")
        .complete(
            TenantRootProtocolDigestV1::from_bytes([0x24; 32]).expect("receipt digest"),
            3,
        )
        .expect("executed reservation terminalizes");
    assert_eq!(terminal.key(), &key);
    assert_eq!(terminal.command_digest(), command_digest);
}

#[test]
fn persisted_command_checkpoints_reconstruct_only_the_exact_resume_token() {
    let identity = test_identity().digest().expect("identity digest");
    let lineage = TenantRootCustodyLineageId::from_bytes([0x31; 16]).expect("lineage");
    let session = TenantRootCeremonySessionIdV1::from_bytes([0x32; 16]).expect("session");
    let nonce = TenantRootCeremonyNonceV1::from_bytes([0x33; 32]).expect("nonce");
    let key = TenantRootCommandReplayKeyV1::deriver_a(identity, lineage, session, nonce);
    let command_digest = TenantRootProtocolDigestV1::from_bytes([0x34; 32]).expect("digest");
    let reservation = match reserve_tenant_root_command_v1(None, key, command_digest, 40)
        .expect("reservation")
    {
        TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
        _ => panic!("fresh reservation must be executable"),
    };
    let executed = reservation.checkpoint_executed(41).expect("checkpoint");
    let stored = StoredTenantRootCommandReplayV1 {
        record: TenantRootCommandReplayRecordV1::Executed(executed),
        receipt_bytes: None,
        admission_digest: None,
        refresh_state: None,
        reserved_at_ms: 40,
        executed_at_ms: Some(41),
    };
    let resumed = replay_executed_from_stored(&stored).expect("resume token");
    assert_eq!(resumed.key(), &key);
    assert_eq!(resumed.command_digest(), command_digest);
    assert_eq!(resumed.reserved_at_ms(), 40);
    assert_eq!(resumed.executed_at_ms(), 41);
    assert!(replay_reservation_from_stored(&stored).is_err());
}

#[test]
fn d1_terminal_receipt_reload_rejects_untrusted_bytes_and_row_substitutions() {
    let identity = test_identity().digest().expect("identity digest");
    let lineage = TenantRootCustodyLineageId::from_bytes([0x41; 16]).expect("lineage");
    let session = TenantRootCeremonySessionIdV1::from_bytes([0x42; 16]).expect("session");
    let nonce = TenantRootCeremonyNonceV1::from_bytes([0x43; 32]).expect("nonce");
    let key = TenantRootCommandReplayKeyV1::deriver_a(identity, lineage, session, nonce);
    let command_digest = TenantRootProtocolDigestV1::from_bytes([0x44; 32]).expect("digest");
    let signing_key = SigningKey::from_bytes(&[0x45; 32]);
    let signed = TenantRootCommandTerminalReceiptV1::sign_success(
        key,
        command_digest,
        b"terminal payload".to_vec(),
        20,
        "r120-test-command-key-v1",
        signing_key.as_bytes(),
    )
    .expect("signed receipt");
    let receipt_bytes = signed.canonical_bytes().expect("receipt bytes");
    let receipt_b64u = encode_base64url_bytes_v1(&receipt_bytes);
    let receipt_digest = signed.digest().expect("receipt digest");
    let receipt_digest_hex = encode_hex(receipt_digest.as_bytes());

    let arbitrary_bytes = encode_base64url_bytes_v1(b"arbitrary bytes");
    let arbitrary_digest = encode_hex(Sha256::digest(b"arbitrary bytes").as_ref());
    assert!(decode_stored_terminal_receipt(
        TenantRootCommandTerminalKindV1::Completed,
        Some(arbitrary_bytes.as_str()),
        Some(arbitrary_digest.as_str()),
        Some(20),
        key,
        command_digest,
    )
    .is_err());

    assert!(decode_stored_terminal_receipt(
        TenantRootCommandTerminalKindV1::Failed,
        Some(receipt_b64u.as_str()),
        Some(receipt_digest_hex.as_str()),
        Some(20),
        key,
        command_digest,
    )
    .is_err());

    let wrong_session = TenantRootCeremonySessionIdV1::from_bytes([0x46; 16]).expect("session");
    let wrong_key =
        TenantRootCommandReplayKeyV1::deriver_a(identity, lineage, wrong_session, nonce);
    assert!(decode_stored_terminal_receipt(
        TenantRootCommandTerminalKindV1::Completed,
        Some(receipt_b64u.as_str()),
        Some(receipt_digest_hex.as_str()),
        Some(20),
        wrong_key,
        command_digest,
    )
    .is_err());

    let wrong_command_digest =
        TenantRootProtocolDigestV1::from_bytes([0x47; 32]).expect("digest");
    assert!(decode_stored_terminal_receipt(
        TenantRootCommandTerminalKindV1::Completed,
        Some(receipt_b64u.as_str()),
        Some(receipt_digest_hex.as_str()),
        Some(20),
        key,
        wrong_command_digest,
    )
    .is_err());

    let wrong_receipt_digest = encode_hex([0x48; 32].as_ref());
    assert!(decode_stored_terminal_receipt(
        TenantRootCommandTerminalKindV1::Completed,
        Some(receipt_b64u.as_str()),
        Some(wrong_receipt_digest.as_str()),
        Some(20),
        key,
        command_digest,
    )
    .is_err());

    assert!(decode_stored_terminal_receipt(
        TenantRootCommandTerminalKindV1::Completed,
        Some(receipt_b64u.as_str()),
        Some(receipt_digest_hex.as_str()),
        Some(21),
        key,
        command_digest,
    )
    .is_err());
}

#[test]
fn d1_terminal_receipt_reload_returns_exact_canonical_success_and_failure_bytes() {
    let identity = test_identity().digest().expect("identity digest");
    let lineage = TenantRootCustodyLineageId::from_bytes([0x51; 16]).expect("lineage");
    let session = TenantRootCeremonySessionIdV1::from_bytes([0x52; 16]).expect("session");
    let nonce = TenantRootCeremonyNonceV1::from_bytes([0x53; 32]).expect("nonce");
    let key = TenantRootCommandReplayKeyV1::deriver_a(identity, lineage, session, nonce);
    let command_digest = TenantRootProtocolDigestV1::from_bytes([0x54; 32]).expect("digest");
    let signing_key = SigningKey::from_bytes(&[0x55; 32]);

    let success = TenantRootCommandTerminalReceiptV1::sign_success(
        key,
        command_digest,
        b"success payload".to_vec(),
        20,
        "r120-test-command-key-v1",
        signing_key.as_bytes(),
    )
    .expect("success receipt");
    let success_bytes = success.canonical_bytes().expect("success bytes");
    let success_b64u = encode_base64url_bytes_v1(&success_bytes);
    let success_digest = success.digest().expect("success digest");
    let success_digest_hex = encode_hex(success_digest.as_bytes());
    let opened_success = decode_stored_terminal_receipt(
        TenantRootCommandTerminalKindV1::Completed,
        Some(success_b64u.as_str()),
        Some(success_digest_hex.as_str()),
        Some(20),
        key,
        command_digest,
    )
    .expect("exact success receipt reload");
    assert_eq!(opened_success.receipt_bytes, success_bytes);
    assert_eq!(opened_success.receipt_digest, success_digest);
    assert_eq!(opened_success.terminal_at_ms, 20);

    let failure = TenantRootCommandTerminalReceiptV1::sign_failure(
        key,
        command_digest,
        b"failure payload".to_vec(),
        21,
        "r120-test-command-key-v1",
        signing_key.as_bytes(),
    )
    .expect("failure receipt");
    let failure_bytes = failure.canonical_bytes().expect("failure bytes");
    let failure_b64u = encode_base64url_bytes_v1(&failure_bytes);
    let failure_digest = failure.digest().expect("failure digest");
    let failure_digest_hex = encode_hex(failure_digest.as_bytes());
    let opened_failure = decode_stored_terminal_receipt(
        TenantRootCommandTerminalKindV1::Failed,
        Some(failure_b64u.as_str()),
        Some(failure_digest_hex.as_str()),
        Some(21),
        key,
        command_digest,
    )
    .expect("exact failure receipt reload");
    assert_eq!(opened_failure.receipt_bytes, failure_bytes);
    assert_eq!(opened_failure.receipt_digest, failure_digest);
    assert_eq!(opened_failure.terminal_at_ms, 21);
}

#[test]
fn command_payload_digest_binds_each_operation_and_substitution() {
    let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let pending_stored = CloudflareStoredTenantRootRoleShareV1 {
        record: pending.clone(),
        revision: 1,
    };
    let initial_activation = current_backup_activation_for_record(&pending, 0x88, 0x89, 20);
    let initial_active_record = pending
        .clone()
        .into_active(initial_activation.clone(), 20)
        .expect("active record");
    let active_stored = CloudflareStoredTenantRootRoleShareV1 {
        record: initial_active_record,
        revision: 2,
    };

    let successor = record_for_identity_epoch(
        test_identity(),
        CloudflareTenantRootDeriverRoleV1::DeriverA,
        0x44,
        epoch(2),
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 18),
    );
    let successor_stored = CloudflareStoredTenantRootRoleShareV1 {
        record: successor.clone(),
        revision: 1,
    };
    let successor_activation = current_backup_activation_for_record(&successor, 0x90, 0x91, 40);
    let retirement = CloudflareTenantRootRetirementV1::new(
        lifecycle_receipt(0x92).expect("retirement receipt"),
        40,
    )
    .expect("retirement");

    let insert = insert_pending_payload_digest(&pending, 1).expect("insert digest");
    let activate = activate_initial_payload_digest(&pending_stored, &initial_activation, 20, 1)
        .expect("activation digest");
    let swap = swap_active_epoch_payload_digest(
        &active_stored,
        &successor_stored,
        &successor_activation,
        &retirement,
        40,
        2,
        1,
    )
    .expect("swap digest");
    let cleanup = cleanup_pending_payload_digest(&successor_stored, 1).expect("cleanup digest");

    let mut changed_insert_record = pending.clone();
    changed_insert_record.sealed_share =
        CloudflareTenantRootSealedRoleShareV1::new(&[0x68; 96]).expect("sealed share");
    let changed_insert =
        insert_pending_payload_digest(&changed_insert_record, 1).expect("insert substitution");

    let mut changed_pending = pending.clone();
    changed_pending.updated_at_ms = 11;
    let changed_activate_record = CloudflareStoredTenantRootRoleShareV1 {
        record: changed_pending,
        revision: 1,
    };
    let changed_activate_record_digest =
        activate_initial_payload_digest(&changed_activate_record, &initial_activation, 20, 1)
            .expect("activation record substitution");
    let mut changed_activation = initial_activation.clone();
    let replacement_activation = current_backup_activation_for_record(&pending, 0x88, 0x93, 20);
    changed_activation.activation_receipt_bytes =
        replacement_activation.activation_receipt_bytes.clone();
    changed_activation.activation_receipt_digest =
        replacement_activation.activation_receipt_digest;
    changed_activation.activated_at_ms = replacement_activation.activated_at_ms;
    let changed_activate_evidence =
        activate_initial_payload_digest(&pending_stored, &changed_activation, 20, 1)
            .expect("activation evidence substitution");
    let changed_activate_timestamp =
        activate_initial_payload_digest(&pending_stored, &initial_activation, 21, 1)
            .expect("activation timestamp substitution");
    let changed_activate_revision =
        activate_initial_payload_digest(&pending_stored, &initial_activation, 20, 2)
            .expect("activation revision substitution");

    let mut changed_active = active_stored.clone();
    changed_active.record.sealed_share =
        CloudflareTenantRootSealedRoleShareV1::new(&[0x69; 96]).expect("sealed share");
    let changed_swap_active = swap_active_epoch_payload_digest(
        &changed_active,
        &successor_stored,
        &successor_activation,
        &retirement,
        40,
        2,
        1,
    )
    .expect("swap active-row substitution");
    let mut changed_successor = successor_stored.clone();
    changed_successor.record.sealed_share =
        CloudflareTenantRootSealedRoleShareV1::new(&[0x6a; 96]).expect("sealed share");
    let changed_swap_pending = swap_active_epoch_payload_digest(
        &active_stored,
        &changed_successor,
        &successor_activation,
        &retirement,
        40,
        2,
        1,
    )
    .expect("swap pending-row substitution");
    let mut changed_successor_activation = successor_activation.clone();
    let replacement_successor_activation =
        current_backup_activation_for_record(&successor, 0x90, 0x94, 40);
    changed_successor_activation.activation_receipt_bytes = replacement_successor_activation
        .activation_receipt_bytes
        .clone();
    changed_successor_activation.activation_receipt_digest =
        replacement_successor_activation.activation_receipt_digest;
    changed_successor_activation.activated_at_ms =
        replacement_successor_activation.activated_at_ms;
    let changed_swap_evidence = swap_active_epoch_payload_digest(
        &active_stored,
        &successor_stored,
        &changed_successor_activation,
        &retirement,
        40,
        2,
        1,
    )
    .expect("swap evidence substitution");
    let mut changed_retirement = retirement.clone();
    changed_retirement.retirement_receipt_digest =
        lifecycle_receipt(0x95).expect("retirement receipt");
    let changed_swap_retirement = swap_active_epoch_payload_digest(
        &active_stored,
        &successor_stored,
        &successor_activation,
        &changed_retirement,
        40,
        2,
        1,
    )
    .expect("swap retirement substitution");
    let changed_swap_timestamp = swap_active_epoch_payload_digest(
        &active_stored,
        &successor_stored,
        &successor_activation,
        &retirement,
        41,
        2,
        1,
    )
    .expect("swap timestamp substitution");
    let changed_swap_active_revision = swap_active_epoch_payload_digest(
        &active_stored,
        &successor_stored,
        &successor_activation,
        &retirement,
        40,
        3,
        1,
    )
    .expect("swap active revision substitution");
    let changed_swap_pending_revision = swap_active_epoch_payload_digest(
        &active_stored,
        &successor_stored,
        &successor_activation,
        &retirement,
        40,
        2,
        2,
    )
    .expect("swap pending revision substitution");

    let changed_cleanup_record = cleanup_pending_payload_digest(&changed_successor, 1)
        .expect("cleanup record substitution");
    let changed_cleanup_revision =
        cleanup_pending_payload_digest(&successor_stored, 2).expect("cleanup revision");

    assert_payload_digest_changes(&[
        ("insert record", insert, changed_insert),
        ("activate record", activate, changed_activate_record_digest),
        ("activate evidence", activate, changed_activate_evidence),
        ("activate timestamp", activate, changed_activate_timestamp),
        (
            "activate local revision",
            activate,
            changed_activate_revision,
        ),
        ("swap active record", swap, changed_swap_active),
        ("swap pending record", swap, changed_swap_pending),
        ("swap activation evidence", swap, changed_swap_evidence),
        ("swap retirement evidence", swap, changed_swap_retirement),
        ("swap timestamp", swap, changed_swap_timestamp),
        (
            "swap active local revision",
            swap,
            changed_swap_active_revision,
        ),
        (
            "swap pending local revision",
            swap,
            changed_swap_pending_revision,
        ),
        ("cleanup record", cleanup, changed_cleanup_record),
        ("cleanup local revision", cleanup, changed_cleanup_revision),
    ]);

    let identity = pending.identity().digest().expect("identity digest");
    let key = TenantRootCommandReplayKeyV1::deriver_a(
        identity,
        pending.custody_lineage(),
        TenantRootCeremonySessionIdV1::from_bytes([0x21; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x22; 32]).expect("nonce"),
    );
    let scope = TenantRootCommandScopeV1::new(key, pending.epoch(), 1).expect("scope");
    let operation = TenantRootCommandOperationV1::activate_initial(activate);
    let digest = scope.command_digest(operation).expect("command digest");
    let changed_scope =
        TenantRootCommandScopeV1::new(key, pending.epoch(), 2).expect("changed scope");
    assert_ne!(
        digest,
        changed_scope
            .command_digest(operation)
            .expect("changed command digest")
    );
}

#[test]
fn current_backup_activation_rejects_record_binding_substitution() {
    let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let activation =
        current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);

    let mut wrong_identity = activation.clone();
    let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
        identity_digest, ..
    } = &mut wrong_identity.availability
    else {
        panic!("expected current-backup availability");
    };
    *identity_digest = TenantRootIdentityDigestV1::from_bytes([0x91; 32]);
    assert!(pending.clone().into_active(wrong_identity, 20).is_err());

    let mut wrong_lineage = activation.clone();
    let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
        custody_lineage, ..
    } = &mut wrong_lineage.availability
    else {
        panic!("expected current-backup availability");
    };
    *custody_lineage = TenantRootCustodyLineageId::from_bytes([0x45; 16]).expect("lineage");
    assert!(pending.clone().into_active(wrong_lineage, 20).is_err());

    let mut wrong_role = activation.clone();
    let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup { role, .. } =
        &mut wrong_role.availability
    else {
        panic!("expected current-backup availability");
    };
    *role = TenantRootManagedRestoreRoleV1::DeriverB;
    assert!(pending.clone().into_active(wrong_role, 20).is_err());

    let mut wrong_epoch = activation.clone();
    let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup { epoch, .. } =
        &mut wrong_epoch.availability
    else {
        panic!("expected current-backup availability");
    };
    *epoch = TenantRootShareEpoch::new(2).expect("epoch");
    assert!(pending.clone().into_active(wrong_epoch, 20).is_err());

    let mut wrong_commitment = activation;
    let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
        share_commitment, ..
    } = &mut wrong_commitment.availability
    else {
        panic!("expected current-backup availability");
    };
    *share_commitment = test_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB);
    assert!(pending.into_active(wrong_commitment, 20).is_err());
}

#[test]
fn initial_creation_reservation_requires_fresh_command_and_exact_record_binding() {
    let command = test_verified_initial_creation_command(TwoPartyDeriverRole::DeriverA, 20, 40);
    let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);

    let scope = initial_creation_scope_for_record(&command, &pending, 25)
        .expect("fresh verified command matches pending record");
    assert_eq!(scope.key().role(), TwoPartyDeriverRole::DeriverA);
    assert_eq!(scope.epoch(), TenantRootShareEpoch::INITIAL);
    assert_eq!(scope.expected_control_plane_revision(), 1);

    assert!(initial_creation_scope_for_record(&command, &pending, 41).is_err());
    assert!(initial_creation_scope_for_record(
        &command,
        &record(CloudflareTenantRootDeriverRoleV1::DeriverB),
        25,
    )
    .is_err());

    let mut substituted_identity = pending;
    substituted_identity.identity = TenantRootIdentityV1::new(
        "org-2",
        "project-1",
        "env-1",
        "project-1:env-1",
        "root-version-1",
    )
    .expect("substituted identity");
    assert!(initial_creation_scope_for_record(&command, &substituted_identity, 25).is_err());
}

#[test]
fn initial_creation_input_derives_the_pending_digest_from_exact_evidence_bytes() {
    let command = test_verified_initial_creation_command(TwoPartyDeriverRole::DeriverA, 20, 40);
    let context = test_creation_context();
    let evidence = test_initial_creation_evidence(&context, TwoPartyDeriverRole::DeriverA);
    let expected_digest = evidence
        .lifecycle_receipt_digest()
        .expect("evidence digest");
    let share = CloudflareTenantRootInitialCreationShareInputV1::new(
        test_identity(),
        test_sealed_online_share(&context, &evidence, TwoPartyDeriverRole::DeriverA),
        10,
    );
    let creation = CloudflareTenantRootInitialCreationInputV1::new(command, evidence, share)
        .expect("initial creation input");
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) =
        creation.record.lifecycle()
    else {
        panic!("initial creation must produce a pending record");
    };
    assert_eq!(pending.installation_evidence_digest(), expected_digest);
}

#[test]
fn initial_creation_input_rejects_evidence_role_and_identity_substitution() {
    let command = test_verified_initial_creation_command(TwoPartyDeriverRole::DeriverA, 20, 40);
    let context = test_creation_context();
    let wrong_role_evidence =
        test_initial_creation_evidence(&context, TwoPartyDeriverRole::DeriverB);
    let wrong_role_share = CloudflareTenantRootInitialCreationShareInputV1::new(
        test_identity(),
        test_sealed_online_share(
            &context,
            &wrong_role_evidence,
            TwoPartyDeriverRole::DeriverB,
        ),
        10,
    );
    assert!(CloudflareTenantRootInitialCreationInputV1::new(
        command,
        wrong_role_evidence,
        wrong_role_share,
    )
    .is_err());

    let command = test_verified_initial_creation_command(TwoPartyDeriverRole::DeriverA, 20, 40);
    let foreign_identity = TenantRootIdentityV1::new(
        "org-2",
        "project-1",
        "env-1",
        "project-1:env-1",
        "root-version-1",
    )
    .expect("foreign identity");
    let foreign_context = test_creation_context_for_identity(foreign_identity.clone());
    let foreign_evidence =
        test_initial_creation_evidence(&foreign_context, TwoPartyDeriverRole::DeriverA);
    let foreign_share = CloudflareTenantRootInitialCreationShareInputV1::new(
        foreign_identity,
        test_sealed_online_share(
            &foreign_context,
            &foreign_evidence,
            TwoPartyDeriverRole::DeriverA,
        ),
        10,
    );
    assert!(CloudflareTenantRootInitialCreationInputV1::new(
        command,
        foreign_evidence,
        foreign_share,
    )
    .is_err());
}

#[test]
fn initial_creation_input_rejects_sealed_share_evidence_substitution() {
    let command = test_verified_initial_creation_command(TwoPartyDeriverRole::DeriverA, 20, 40);
    let context = test_creation_context();
    let sealed_evidence =
        test_initial_creation_evidence(&context, TwoPartyDeriverRole::DeriverA);
    let share_a = SigningRootShare::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverA.share_id(),
        Scalar::from(17_u64).to_bytes(),
    )
    .expect("Deriver A share");
    let share_b = SigningRootShare::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverB.share_id(),
        Scalar::from(29_u64).to_bytes(),
    )
    .expect("Deriver B share");
    let substituted_evidence = signed_installation_evidence_wire(
        &context,
        TwoPartyDeriverRole::DeriverA,
        &share_a,
        &share_b,
        0x59,
        0x69,
    );
    assert_ne!(
        sealed_evidence.canonical_bytes(),
        substituted_evidence.canonical_bytes()
    );
    let share = CloudflareTenantRootInitialCreationShareInputV1::new(
        test_identity(),
        test_sealed_online_share(&context, &sealed_evidence, TwoPartyDeriverRole::DeriverA),
        10,
    );
    assert!(CloudflareTenantRootInitialCreationInputV1::new(
        command,
        substituted_evidence,
        share,
    )
    .is_err());
}

#[test]
fn initial_creation_success_receipt_requires_the_exact_evidence_payload() {
    let context = test_creation_context();
    let evidence = test_initial_creation_evidence(&context, TwoPartyDeriverRole::DeriverA);
    let expected_payload = evidence.canonical_bytes().to_vec();
    let identity = test_identity().digest().expect("identity digest");
    let lineage = TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage");
    let key = TenantRootCommandReplayKeyV1::deriver_a(
        identity,
        lineage,
        TenantRootCeremonySessionIdV1::from_bytes([0x71; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x72; 32]).expect("nonce"),
    );
    let command_digest = TenantRootProtocolDigestV1::from_bytes([0x73; 32]).expect("digest");
    let reservation = match reserve_tenant_root_command_v1(None, key, command_digest, 20)
        .expect("reservation")
    {
        TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
        _ => panic!("fresh reservation must be executable"),
    };
    let executed = reservation.checkpoint_executed(21).expect("executed");
    let signing_key = SigningKey::from_bytes(&[0x74; 32]);
    let signed = TenantRootCommandTerminalReceiptV1::sign_success(
        key,
        command_digest,
        expected_payload,
        22,
        "r120-initial-creation-command-key-v1",
        signing_key.as_bytes(),
    )
    .expect("signed receipt");
    let receipt_bytes = signed.canonical_bytes().expect("receipt bytes");
    let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .expect("decoded receipt")
        .verify_success(
            &executed,
            "r120-initial-creation-command-key-v1",
            signing_key.verifying_key().as_bytes(),
        )
        .expect("verified receipt");
    assert!(validate_initial_creation_success_receipt_payload(&evidence, &receipt).is_ok());

    let signed = TenantRootCommandTerminalReceiptV1::sign_success(
        key,
        command_digest,
        b"substituted evidence bytes".to_vec(),
        22,
        "r120-initial-creation-command-key-v1",
        signing_key.as_bytes(),
    )
    .expect("signed substituted receipt");
    let receipt_bytes = signed.canonical_bytes().expect("receipt bytes");
    let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .expect("decoded substituted receipt")
        .verify_success(
            &executed,
            "r120-initial-creation-command-key-v1",
            signing_key.verifying_key().as_bytes(),
        )
        .expect("verified substituted receipt");
    assert!(validate_initial_creation_success_receipt_payload(&evidence, &receipt).is_err());
}

#[test]
fn refresh_input_derives_pending_digest_from_exact_evidence_and_keeps_scope_revision() {
    let context = test_refresh_context();
    let evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
    let expected_digest = evidence
        .lifecycle_receipt_digest()
        .expect("refresh evidence digest");
    let command = test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4);
    let input = refresh_input_with_sealed_evidence(
        command,
        evidence,
        test_identity(),
        &context,
        &test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
        TwoPartyDeriverRole::DeriverA,
    )
    .expect("refresh input");
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = input.record.lifecycle()
    else {
        panic!("refresh insertion must produce a pending record");
    };
    assert_eq!(pending.installation_evidence_digest(), expected_digest);
    assert_eq!(input.record.epoch(), epoch(2));
    assert_eq!(input.command.scope().expected_control_plane_revision(), 4);
    assert_eq!(input.record.created_at_ms, 30);
    assert_eq!(input.record.updated_at_ms, 30);
}

#[test]
fn refresh_replay_digest_binds_the_exact_signed_command() {
    let context = test_refresh_context();
    let command =
        test_verified_refresh_command_with_window(TwoPartyDeriverRole::DeriverA, 4, 20, 40);
    let changed_command =
        test_verified_refresh_command_with_window(TwoPartyDeriverRole::DeriverA, 4, 21, 39);
    let input = refresh_input_with_sealed_evidence(
        command,
        test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
        test_identity(),
        &context,
        &test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
        TwoPartyDeriverRole::DeriverA,
    )
    .expect("refresh input");
    let original_digest =
        refresh_insert_pending_payload_digest(&input.command, &input.record, 1)
            .expect("original operation payload digest");
    let changed_digest =
        refresh_insert_pending_payload_digest(&changed_command, &input.record, 1)
            .expect("changed operation payload digest");
    assert_ne!(input.command.digest(), changed_command.digest());
    assert_ne!(original_digest, changed_digest);

    let scope = input.command.scope();
    let key = *scope.key();
    let reserved = match reserve_tenant_root_command_v1(None, key, original_digest, 40)
        .expect("fresh reservation")
    {
        TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
        _ => panic!("fresh reservation must be executable"),
    };
    let reserved_record = TenantRootCommandReplayRecordV1::Reserved(reserved);
    assert!(
        reserve_tenant_root_command_v1(Some(&reserved_record), key, changed_digest, 400,)
            .is_err()
    );
    assert!(matches!(
        reserve_tenant_root_command_v1(Some(&reserved_record), key, original_digest, 400)
            .expect("exact reserved retry"),
        TenantRootCommandReplayDecisionV1::InProgress
    ));

    let completed_reservation =
        match reserve_tenant_root_command_v1(None, key, original_digest, 40)
            .expect("fresh completion reservation")
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => panic!("fresh completion reservation must be executable"),
        };
    let completed = completed_reservation
        .checkpoint_executed(41)
        .expect("executed checkpoint")
        .complete(
            TenantRootProtocolDigestV1::from_bytes([0x79; 32]).expect("receipt digest"),
            42,
        )
        .expect("completed command");
    assert!(matches!(
        reserve_tenant_root_command_v1(Some(&completed), key, original_digest, 400)
            .expect("exact completed retry"),
        TenantRootCommandReplayDecisionV1::ReplayCompleted { .. }
    ));
    assert!(
        reserve_tenant_root_command_v1(Some(&completed), key, changed_digest, 400).is_err()
    );
}

#[test]
fn refresh_input_rejects_context_identity_lineage_role_epoch_commitment_and_evidence_substitution(
) {
    let identity = test_identity();
    let context = test_refresh_context();

    let foreign_identity = TenantRootIdentityV1::new(
        "org-2",
        "project-1",
        "env-1",
        "project-1:env-1",
        "root-version-1",
    )
    .expect("foreign identity");
    let foreign_context =
        test_refresh_context_with_identity(foreign_identity.clone(), 0x44, 1, 2, 0x45, 0x46);
    let foreign_evidence =
        test_refresh_evidence(&foreign_context, TwoPartyDeriverRole::DeriverA);
    assert!(refresh_input_with_sealed_evidence(
        test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4),
        foreign_evidence,
        foreign_identity,
        &foreign_context,
        &test_refresh_evidence(&foreign_context, TwoPartyDeriverRole::DeriverA),
        TwoPartyDeriverRole::DeriverA,
    )
    .is_err());

    let foreign_lineage_context =
        test_refresh_context_with_identity(identity.clone(), 0x45, 1, 2, 0x45, 0x46);
    let foreign_lineage_evidence =
        test_refresh_evidence(&foreign_lineage_context, TwoPartyDeriverRole::DeriverA);
    assert!(refresh_input_with_sealed_evidence(
        test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4),
        foreign_lineage_evidence,
        identity.clone(),
        &foreign_lineage_context,
        &test_refresh_evidence(&foreign_lineage_context, TwoPartyDeriverRole::DeriverA),
        TwoPartyDeriverRole::DeriverA,
    )
    .is_err());

    let role_evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
    assert!(refresh_input_with_sealed_evidence(
        test_verified_refresh_command(TwoPartyDeriverRole::DeriverB, 4),
        role_evidence,
        identity.clone(),
        &context,
        &test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
        TwoPartyDeriverRole::DeriverA,
    )
    .is_err());

    let foreign_epoch_context =
        test_refresh_context_with_identity(identity.clone(), 0x44, 2, 3, 0x45, 0x46);
    let foreign_epoch_evidence =
        test_refresh_evidence(&foreign_epoch_context, TwoPartyDeriverRole::DeriverA);
    assert!(refresh_input_with_sealed_evidence(
        test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4),
        foreign_epoch_evidence,
        identity.clone(),
        &foreign_epoch_context,
        &test_refresh_evidence(&foreign_epoch_context, TwoPartyDeriverRole::DeriverA),
        TwoPartyDeriverRole::DeriverA,
    )
    .is_err());

    let commitment_evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverB);
    assert!(refresh_input_with_sealed_evidence(
        test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4),
        test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
        identity.clone(),
        &context,
        &commitment_evidence,
        TwoPartyDeriverRole::DeriverB,
    )
    .is_err());

    let sealed_evidence =
        test_refresh_evidence_with_seeds(&context, TwoPartyDeriverRole::DeriverA, 0x59, 0x69);
    let arrival_evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
    assert_ne!(
        sealed_evidence.canonical_bytes(),
        arrival_evidence.canonical_bytes()
    );
    assert!(refresh_input_with_sealed_evidence(
        test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4),
        arrival_evidence,
        identity,
        &context,
        &sealed_evidence,
        TwoPartyDeriverRole::DeriverA,
    )
    .is_err());
}

#[test]
fn refresh_success_receipt_requires_exact_evidence_payload() {
    let context = test_refresh_context();
    let evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
    let expected_payload = evidence.canonical_bytes().to_vec();
    let key = TenantRootCommandReplayKeyV1::deriver_a(
        test_identity().digest().expect("identity digest"),
        TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage"),
        TenantRootCeremonySessionIdV1::from_bytes([0x71; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x72; 32]).expect("nonce"),
    );
    let command_digest = TenantRootProtocolDigestV1::from_bytes([0x73; 32]).expect("digest");
    let reservation = match reserve_tenant_root_command_v1(None, key, command_digest, 20)
        .expect("reservation")
    {
        TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
        _ => panic!("fresh reservation must be executable"),
    };
    let executed = reservation.checkpoint_executed(21).expect("executed");
    let signing_key = SigningKey::from_bytes(&[0x74; 32]);
    let signed = TenantRootCommandTerminalReceiptV1::sign_success(
        key,
        command_digest,
        expected_payload,
        22,
        "r120-refresh-command-key-v1",
        signing_key.as_bytes(),
    )
    .expect("signed receipt");
    let receipt_bytes = signed.canonical_bytes().expect("receipt bytes");
    let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .expect("decoded receipt")
        .verify_success(
            &executed,
            "r120-refresh-command-key-v1",
            signing_key.verifying_key().as_bytes(),
        )
        .expect("verified receipt");
    assert!(validate_refresh_success_receipt_payload(&evidence, &receipt).is_ok());

    let signed = TenantRootCommandTerminalReceiptV1::sign_success(
        key,
        command_digest,
        b"changed arrival bytes".to_vec(),
        22,
        "r120-refresh-command-key-v1",
        signing_key.as_bytes(),
    )
    .expect("signed changed receipt");
    let receipt_bytes = signed.canonical_bytes().expect("changed receipt bytes");
    let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .expect("decoded changed receipt")
        .verify_success(
            &executed,
            "r120-refresh-command-key-v1",
            signing_key.verifying_key().as_bytes(),
        )
        .expect("verified changed receipt");
    assert!(validate_refresh_success_receipt_payload(&evidence, &receipt).is_err());
}

#[test]
fn refresh_durable_state_retains_exact_prepared_artifact_bytes() {
    let context = test_refresh_context();
    let evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
    let command = test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4);
    let managed_backup = test_verified_managed_backup(
        &context,
        TwoPartyDeriverRole::DeriverA,
        17,
        0x88,
        &evidence,
    );
    let commitments = TenantRootEpochCommitmentsV1::new(
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17),
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 29),
    )
    .expect("refresh commitments");
    let provider_canary = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::RefreshSwap,
        epoch(2),
        &commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
        0x89,
    );
    let provider_canary = TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(
        provider_canary.canonical_bytes(),
    )
    .expect("signed provider canary");
    let prepared =
        CloudflareTenantRootRefreshPreparedArtifactsV1::new(&managed_backup, &provider_canary)
            .expect("prepared artifacts");
    let state = CloudflareTenantRootRefreshDurableStateV1::Executed {
        command_b64u: encode_base64url_bytes_v1(command.canonical_bytes()),
        evidence_b64u: encode_base64url_bytes_v1(evidence.canonical_bytes()),
        prepared_artifacts: prepared,
    };
    let (state_b64u, state_digest_hex) = state.encode().expect("encoded durable state");
    let decoded = decode_refresh_durable_state(&state_b64u, &state_digest_hex)
        .expect("decoded durable state");
    let prepared = decoded
        .prepared_artifacts()
        .expect("prepared artifacts accessor");
    assert_eq!(
        prepared.managed_backup_bytes().expect("backup bytes"),
        managed_backup.canonical_bytes()
    );
    assert_eq!(
        prepared
            .provider_canary_receipt_bytes()
            .expect("canary bytes"),
        provider_canary.canonical_bytes().expect("canary bytes")
    );
}

#[test]
fn refresh_replay_state_requires_exact_command_bytes_and_rejects_failed_state() {
    let command = test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4);
    let state = CloudflareTenantRootRefreshDurableStateV1::admitted(
        &command,
        encode_base64url_bytes_v1(&[1; 80]),
    )
    .expect("refresh admission state");
    let operation_digest =
        refresh_admission_operation_digest(&command.scope(), command.digest())
            .expect("refresh operation digest");
    let reservation = match reserve_tenant_root_command_v1(
        None,
        *command.scope().key(),
        operation_digest,
        20,
    )
    .expect("refresh reservation")
    {
        TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
        _ => panic!("fresh refresh replay must reserve"),
    };
    let stored = StoredTenantRootCommandReplayV1 {
        record: TenantRootCommandReplayRecordV1::Reserved(reservation),
        admission_digest: Some(command.digest()),
        refresh_state: Some(state.clone()),
        receipt_bytes: None,
        reserved_at_ms: 20,
        executed_at_ms: None,
    };
    assert_eq!(
        refresh_replay_state_for_command(&stored, command.canonical_bytes())
            .expect("exact refresh replay state"),
        state
    );
    let mut changed_command_bytes = command.canonical_bytes().to_vec();
    changed_command_bytes[0] ^= 1;
    assert!(refresh_replay_state_for_command(&stored, &changed_command_bytes).is_err());
    assert!(!state.kind_matches_status("failed"));
}

#[test]
fn refresh_control_plane_revision_is_distinct_from_new_row_revision() {
    let context = test_refresh_context();
    let evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
    let command = test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4);
    let input = refresh_input_with_sealed_evidence(
        command,
        evidence,
        test_identity(),
        &context,
        &test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
        TwoPartyDeriverRole::DeriverA,
    )
    .expect("refresh input");
    let scope = input.command.scope();
    let stored = CloudflareStoredTenantRootRoleShareV1 {
        record: input.record,
        revision: 1,
    };
    let replay_key_digest = scope
        .key()
        .storage_key_digest()
        .expect("refresh replay key digest");
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = stored.record.lifecycle()
    else {
        panic!("refresh input must remain pending before activation");
    };
    assert_eq!(pending.refresh_replay_key_digest(), Some(replay_key_digest));
    assert_eq!(scope.expected_control_plane_revision(), 4);
    assert_eq!(stored.revision(), 1);
    assert_ne!(
        scope.expected_control_plane_revision() as i64,
        stored.revision()
    );
}

#[test]
fn record_rejects_commitment_for_the_other_role() {
    let mut record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let mut commitment = record.share_commitment.as_bytes().to_vec();
    commitment[..2].copy_from_slice(&2_u16.to_be_bytes());
    record.share_commitment =
        MpcPrfShareCommitmentWireV1::new(commitment).expect("B commitment");
    assert!(record.validate().is_err());
}

#[test]
fn epoch_swap_requires_exact_identity_lineage_role_and_next_epoch() {
    let active_record = record(CloudflareTenantRootDeriverRoleV1::DeriverA)
        .into_active(
            current_backup_activation(
                CloudflareTenantRootDeriverRoleV1::DeriverA,
                0x88,
                0x89,
                20,
            ),
            20,
        )
        .expect("active");
    let pending_record = record_for_identity_epoch(
        test_identity(),
        CloudflareTenantRootDeriverRoleV1::DeriverA,
        0x44,
        TenantRootShareEpoch::new(2).expect("epoch 2"),
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 18),
    );
    let active = CloudflareStoredTenantRootRoleShareV1 {
        record: active_record,
        revision: 2,
    };
    let pending = CloudflareStoredTenantRootRoleShareV1 {
        record: pending_record.clone(),
        revision: 1,
    };
    assert!(validate_epoch_swap_inputs(&active, &pending).is_ok());

    let mut wrong_identity = pending_record.clone();
    wrong_identity.identity = TenantRootIdentityV1::new(
        "org-2",
        "project-1",
        "env-1",
        "project-1:env-1",
        "root-version-1",
    )
    .expect("identity");
    assert!(validate_epoch_swap_inputs(
        &active,
        &CloudflareStoredTenantRootRoleShareV1 {
            record: wrong_identity,
            revision: 1,
        }
    )
    .is_err());

    let mut wrong_lineage = pending_record.clone();
    wrong_lineage.custody_lineage =
        TenantRootCustodyLineageId::from_bytes([0x45; 16]).expect("lineage");
    assert!(validate_epoch_swap_inputs(
        &active,
        &CloudflareStoredTenantRootRoleShareV1 {
            record: wrong_lineage,
            revision: 1,
        }
    )
    .is_err());

    let mut wrong_next_epoch = pending_record;
    wrong_next_epoch.epoch = TenantRootShareEpoch::new(3).expect("epoch 3");
    assert!(validate_epoch_swap_inputs(
        &active,
        &CloudflareStoredTenantRootRoleShareV1 {
            record: wrong_next_epoch,
            revision: 1,
        }
    )
    .is_err());

    let wrong_role = CloudflareStoredTenantRootRoleShareV1 {
        record: record(CloudflareTenantRootDeriverRoleV1::DeriverB),
        revision: 1,
    };
    assert!(validate_epoch_swap_inputs(&active, &wrong_role).is_err());
}

#[test]
fn restore_session_cleanup_receipt_is_deterministic_and_nonzero() {
    let identity = TenantRootIdentityDigestV1::from_bytes([0x11; 32]);
    let lineage = TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage");
    let session =
        TenantRootRestoreSessionIdV1::from_bytes([0x33; 16]).expect("restore session");
    let activation_digest = lifecycle_receipt(0x44).expect("activation digest");
    let first = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
        identity,
        lineage,
        session,
        CloudflareTenantRootDeriverRoleV1::DeriverA,
        "initial_creation",
        activation_digest,
        100,
    )
    .expect("cleanup receipt");
    let replay = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
        identity,
        lineage,
        session,
        CloudflareTenantRootDeriverRoleV1::DeriverA,
        "initial_creation",
        activation_digest,
        100,
    )
    .expect("cleanup receipt replay");
    assert_eq!(first, replay);
    assert!(first.digest().as_bytes().iter().any(|byte| *byte != 0));
    let changed_close_time = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
        identity,
        lineage,
        session,
        CloudflareTenantRootDeriverRoleV1::DeriverA,
        "initial_creation",
        activation_digest,
        101,
    )
    .expect("changed cleanup receipt");
    assert_ne!(first, changed_close_time);
}
