//! Creation cleanup, manual refresh admission and managed-restore tests.

use super::*;

#[test]
fn creation_cleanup_commits_once_and_replays_exactly_after_expiry() {
    const FRESH_NOW_MS: u64 = 1_010_000;
    const EXPIRED_NOW_MS: u64 = 1_030_001;
    let journal = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("journal");
    let (installation_record, commitments) =
        deriver_b_installation_checkpoint(&journal, FRESH_NOW_MS);
    let installation = validate_installation_checkpoint(
        installation_record,
        &journal,
        &role_keys(),
        &commitments,
    )
    .expect("installation");
    let abandonment = abandonment_fixture(
        &journal,
        vec![CloudflareTenantRootCreationInstallationRoleV1::DeriverB],
    );
    let candidate_record = cleanup_checkpoint_fixture(
        &journal,
        &abandonment,
        &installation,
        0x83,
        TwoPartyDeriverRole::DeriverB,
        None,
    );
    let candidate = validate_creation_cleanup_checkpoint(
        candidate_record.clone(),
        &journal,
        &abandonment,
        Some(&installation),
        authority(0x44),
        &verifying_keys(),
        &role_keys(),
    )
    .expect("cleanup candidate");
    let committed = evaluate_creation_cleanup_checkpoint(
        None,
        candidate,
        &journal,
        &abandonment,
        Some(&installation),
        authority(0x44),
        &verifying_keys(),
        &role_keys(),
        FRESH_NOW_MS,
    )
    .expect("cleanup commit");
    let checkpoint = match committed {
        TenantRootCreationCleanupEvaluationV1::Commit {
            checkpoint,
            response,
        } => {
            assert_eq!(
                response.outcome,
                CloudflareTenantRootCreationCleanupOutcomeV1::Committed
            );
            checkpoint
        }
        TenantRootCreationCleanupEvaluationV1::Replay(_) => {
            panic!("fresh cleanup cannot replay")
        }
    };
    let replay_candidate = validate_creation_cleanup_checkpoint(
        candidate_record,
        &journal,
        &abandonment,
        Some(&installation),
        authority(0x44),
        &verifying_keys(),
        &role_keys(),
    )
    .expect("replay candidate");
    let replay = evaluate_creation_cleanup_checkpoint(
        Some(checkpoint),
        replay_candidate,
        &journal,
        &abandonment,
        Some(&installation),
        authority(0x44),
        &verifying_keys(),
        &role_keys(),
        EXPIRED_NOW_MS,
    )
    .expect("exact expired cleanup replay");
    assert!(matches!(
        replay,
        TenantRootCreationCleanupEvaluationV1::Replay(
            CloudflareTenantRootCreationCleanupResponseV1 {
                outcome: CloudflareTenantRootCreationCleanupOutcomeV1::Replay,
                ..
            }
        )
    ));
}

#[test]
fn creation_cleanup_rejects_role_signer_payload_and_lifecycle_substitution() {
    const NOW_MS: u64 = 1_010_000;
    let journal = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("journal");
    let (installation_record, commitments) =
        deriver_b_installation_checkpoint(&journal, NOW_MS);
    let installation = validate_installation_checkpoint(
        installation_record.clone(),
        &journal,
        &role_keys(),
        &commitments,
    )
    .expect("installation");
    let abandonment = abandonment_fixture(
        &journal,
        vec![CloudflareTenantRootCreationInstallationRoleV1::DeriverB],
    );

    let mut wrong_role = cleanup_checkpoint_fixture(
        &journal,
        &abandonment,
        &installation,
        0x83,
        TwoPartyDeriverRole::DeriverB,
        None,
    );
    wrong_role.role = CloudflareTenantRootCreationInstallationRoleV1::DeriverA;
    assert!(validate_creation_cleanup_checkpoint(
        wrong_role,
        &journal,
        &abandonment,
        Some(&installation),
        authority(0x44),
        &verifying_keys(),
        &role_keys(),
    )
    .is_err());

    let wrong_signer = cleanup_checkpoint_fixture(
        &journal,
        &abandonment,
        &installation,
        0x83,
        TwoPartyDeriverRole::DeriverA,
        None,
    );
    assert!(validate_creation_cleanup_checkpoint(
        wrong_signer,
        &journal,
        &abandonment,
        Some(&installation),
        authority(0x44),
        &verifying_keys(),
        &role_keys(),
    )
    .is_err());

    let wrong_payload = cleanup_checkpoint_fixture(
        &journal,
        &abandonment,
        &installation,
        0x83,
        TwoPartyDeriverRole::DeriverB,
        Some(b"other cleanup authorization"),
    );
    assert!(validate_creation_cleanup_checkpoint(
        wrong_payload,
        &journal,
        &abandonment,
        Some(&installation),
        authority(0x44),
        &verifying_keys(),
        &role_keys(),
    )
    .is_err());

    let command_a = role_creation_command(&journal, TwoPartyDeriverRole::DeriverA);
    let completed = evaluate_installation_checkpoint(
        Some(installation_record),
        installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61),
        &command_a,
        &journal,
        &role_keys(),
        &commitments,
        NOW_MS,
    )
    .expect("complete installation");
    let completed_record = match completed {
        TenantRootCreationInstallationEvaluationV1::Commit { checkpoint, .. } => checkpoint,
        other => panic!("unexpected completion outcome: {other:?}"),
    };
    let completed_installation = validate_installation_checkpoint(
        completed_record,
        &journal,
        &role_keys(),
        &commitments,
    )
    .expect("completed installation");
    // Once the fence records both roles installed, each role's cleanup
    // targets that role's own installation evidence.
    let both_abandoned = abandonment_fixture(
        &journal,
        vec![
            CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
            CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
        ],
    );
    for role in [
        CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
        CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
    ] {
        let (target, targeted) = creation_cleanup_target(
            &journal,
            &both_abandoned,
            Some(&completed_installation),
            role,
        )
        .expect("each installed role has a cleanup target");
        assert_eq!(targeted, role);
        assert!(matches!(
            target,
            TenantRootRoleCleanupTargetV1::Pending { role: targeted, .. }
                if targeted == role.to_protocol()
        ));
    }
    // A role the fence did not record is cleaned by the abandoned
    // ceremony alone, never by installation evidence; a recorded role
    // with no installation to bind has no target.
    let (target, _) = creation_cleanup_target(
        &journal,
        &abandonment,
        Some(&installation),
        CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
    )
    .expect("an unrecorded role has a ceremony-bound cleanup target");
    assert_eq!(
        target,
        TenantRootRoleCleanupTargetV1::AbandonedCeremony {
            identity_digest: journal.identity_digest,
            custody_lineage: journal.custody_lineage,
            role: TwoPartyDeriverRole::DeriverA,
            session_id: journal.ceremony_context.session_id(),
            ceremony_nonce: journal.ceremony_context.nonce(),
        }
    );
    assert!(creation_cleanup_target(
        &journal,
        &abandonment,
        None,
        CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
    )
    .is_err());
}

#[test]
fn first_acceptance_and_exact_expired_replay_are_distinct() {
    let accepted = record(0x21, 0x51, authority(0x44), 1_000, 1_030);
    let commit = evaluate_creation_record(
        None,
        validate(accepted.clone(), authority(0x44)).expect("candidate"),
        authority(0x44),
        &verifying_keys(),
        1_015,
    )
    .expect("commit");
    assert!(matches!(
        commit,
        TenantRootCreationJournalEvaluationV1::Commit { .. }
    ));
    let mut retained_keys = verifying_keys();
    retained_keys.insert(
        "tenant-root-creation-issuer-v2".to_owned(),
        SigningKey::from_bytes(&[0x73; 32])
            .verifying_key()
            .to_bytes(),
    );
    let replay = evaluate_creation_record(
        Some(accepted.clone()),
        validate(accepted, authority(0x44)).expect("replay candidate"),
        authority(0x44),
        &retained_keys,
        1_031,
    )
    .expect("expired exact replay");
    assert!(matches!(
        replay,
        TenantRootCreationJournalEvaluationV1::Replay(_)
    ));
}

#[test]
fn unseen_expired_and_every_changed_command_fail_closed() {
    let accepted = record(0x21, 0x51, authority(0x44), 1_000, 1_030);
    assert_eq!(
        evaluate_creation_record(
            None,
            validate(accepted.clone(), authority(0x44)).expect("expired candidate"),
            authority(0x44),
            &verifying_keys(),
            1_031,
        )
        .expect_err("unseen expired capability")
        .code(),
        RouterAbProtocolErrorCode::ExpiredLocalRequest
    );
    for changed in [
        record(0x21, 0x52, authority(0x44), 1_000, 1_030),
        record(0x22, 0x51, authority(0x44), 1_000, 1_030),
    ] {
        assert_eq!(
            evaluate_creation_record(
                Some(accepted.clone()),
                validate(changed, authority(0x44)).expect("changed candidate"),
                authority(0x44),
                &verifying_keys(),
                1_015,
            )
            .expect_err("changed command")
            .code(),
            RouterAbProtocolErrorCode::ConflictingPair
        );
    }
}

#[test]
fn issuer_key_authority_and_journal_substitutions_are_rejected() {
    let accepted = record(0x21, 0x51, authority(0x44), 1_000, 1_030);
    assert!(
        validate_creation_record(accepted.clone(), authority(0x45), &verifying_keys()).is_err()
    );
    assert!(
        validate_creation_record(accepted.clone(), authority(0x44), &BTreeMap::new()).is_err()
    );
    let wrong_key = SigningKey::from_bytes(&[0x72; 32])
        .verifying_key()
        .to_bytes();
    let wrong_keys = BTreeMap::from([(ISSUER_KEY_ID.to_owned(), wrong_key)]);
    assert!(validate_creation_record(accepted.clone(), authority(0x44), &wrong_keys).is_err());
    let mut tampered = accepted;
    let mut journal =
        decode_base64url_bytes_v1("journal", &tampered.journal_b64u).expect("journal bytes");
    journal[0] ^= 1;
    tampered.journal_b64u = encode_base64url_bytes_v1(&journal);
    assert!(validate(tampered, authority(0x44)).is_err());
}

#[test]
fn refresh_active_state_accepts_exact_signed_receipt_replay() {
    let (record, issuer_keys) = active_refresh_state_fixture();
    let receipt_bytes =
        decode_base64url_bytes_v1("active activation receipt", &record.activation_receipt_b64u)
            .expect("active receipt bytes");
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .expect("active receipt");
    let expected_digest = receipt.digest().expect("active receipt digest");
    let validated = validate_refresh_active_state_record(record, authority(0x71), &issuer_keys)
        .expect("exact active state replay");
    assert_eq!(validated.active_epoch.get().get(), 1);
    assert_eq!(validated.activation_receipt_digest, expected_digest);
}

#[test]
fn refresh_terminal_fence_replays_exact_response_after_json_restart() {
    let (record, issuer_keys) = active_refresh_state_fixture();
    let active =
        validate_refresh_active_state_record(record.clone(), authority(0x71), &issuer_keys)
            .expect("active refresh state");
    let context = refresh_context(&active);
    let command_a = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverA);
    let command_b = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverB);
    let attempt = refresh_attempt_from_commands(&context, &command_a, &command_b)
        .expect("refresh attempt");
    let activation_receipt = refresh_activation_receipt(&active, &context);
    let result_revision = active
        .record
        .lifecycle_revision
        .checked_add(1)
        .expect("refresh result revision");
    let mut terminal_record =
        refresh_active_state_record_from_verified_receipt(activation_receipt, result_revision)
            .expect("refresh active record");
    let response = refresh_terminal_response_from_record(&terminal_record);
    terminal_record.fence = CloudflareTenantRootRefreshFenceV1::Terminal {
        attempt,
        outcome: CloudflareTenantRootRefreshTerminalOutcomeV1::Completed,
        response: response.clone(),
    };
    validate_refresh_active_state_record(
        terminal_record.clone(),
        authority(0x71),
        &issuer_keys,
    )
    .expect("terminal refresh state validates against its activation");

    let restarted: CloudflareTenantRootRefreshActiveStateRecordV1 = serde_json::from_slice(
        &serde_json::to_vec(&terminal_record).expect("persist terminal refresh state"),
    )
    .expect("reload terminal refresh state");
    let CloudflareTenantRootRefreshFenceV1::Terminal {
        response: restarted_response,
        ..
    } = &restarted.fence
    else {
        panic!("restart must retain the terminal refresh fence")
    };
    assert_eq!(restarted_response, &response);
    assert_eq!(
        restarted_response,
        &refresh_terminal_response_from_record(&restarted)
    );
    validate_refresh_active_state_record(restarted, authority(0x71), &issuer_keys)
        .expect("restarted terminal refresh state validates");
}

#[test]
fn manual_refresh_admission_transitions_are_durable_and_tenant_scoped() {
    const FIRST_NOW_MS: u64 = 10_000;
    let (record, _issuer_keys) = active_refresh_state_fixture();
    let first = evaluate_refresh_admission_v1(
        &record,
        None,
        None,
        "operation-a",
        CloudflareTenantRootRefreshTriggerV1::Manual,
        identity_digest_for_record(&record),
        activation_at_ms_for_record(&record),
        record.lifecycle_revision,
        u64::MAX,
        FIRST_NOW_MS,
        TenantRootRefreshScheduleV1::default(),
    )
    .expect("first manual refresh admission");
    let pending = match first {
        CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit { pending } => pending,
        other => panic!("first manual refresh must commit: {other:?}"),
    };
    let mut admitted = record.clone();
    admitted.manual_refresh_pending = Some(pending);

    assert!(matches!(
        evaluate_refresh_admission_v1(
            &admitted,
            None,
            None,
            "operation-a",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&admitted),
            activation_at_ms_for_record(&admitted),
            admitted.lifecycle_revision,
            u64::MAX,
            FIRST_NOW_MS,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit { .. })
    ));
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &admitted,
            None,
            None,
            "operation-b",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&admitted),
            activation_at_ms_for_record(&admitted),
            admitted.lifecycle_revision,
            u64::MAX,
            FIRST_NOW_MS,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::InProgress)
    ));

    let restarted: CloudflareTenantRootRefreshActiveStateRecordV1 = serde_json::from_slice(
        &serde_json::to_vec(&admitted).expect("persist pending manual refresh"),
    )
    .expect("reload pending manual refresh");
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &restarted,
            None,
            None,
            "operation-a",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&restarted),
            activation_at_ms_for_record(&restarted),
            restarted.lifecycle_revision,
            u64::MAX,
            FIRST_NOW_MS,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit { .. })
    ));
    let mut completed = restarted.clone();
    apply_refresh_completion_transition_v1(
        &restarted,
        &mut completed,
        Some("operation-a"),
        FIRST_NOW_MS,
    )
    .expect("manual refresh completion transition");
    assert!(completed.manual_refresh_pending.is_none());
    assert_eq!(
        completed.last_manual_refresh_completed_at_ms,
        Some(FIRST_NOW_MS)
    );
    let retry_at_ms = FIRST_NOW_MS + TENANT_ROOT_MANUAL_REFRESH_INTERVAL_MS_V1;
    let recovered_completed: CloudflareTenantRootRefreshActiveStateRecordV1 =
        serde_json::from_slice(
            &serde_json::to_vec(&completed).expect("persist completed manual refresh"),
        )
        .expect("reload completed manual refresh");
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &recovered_completed,
            None,
            None,
            "operation-b",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&recovered_completed),
            activation_at_ms_for_record(&recovered_completed),
            recovered_completed.lifecycle_revision,
            u64::MAX,
            retry_at_ms - 1,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::Throttled {
            retry_at_ms: value
        }) if value == retry_at_ms
    ));
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &completed,
            None,
            None,
            "operation-b",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&completed),
            activation_at_ms_for_record(&completed),
            completed.lifecycle_revision,
            u64::MAX,
            retry_at_ms,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit { .. })
    ));

    let (mut restore_active, restore_journal, _restore_issuer_keys) =
        managed_restore_active_state_fixture();
    restore_active.record.last_manual_refresh_completed_at_ms = Some(1_000_000);
    let restore_request = managed_restore_request(0x61);
    let restore_reserved = match reserve_managed_restore_authorization_fence_v1(
        &restore_active,
        &restore_journal,
        restore_request,
        1_000_250,
    )
    .expect("managed restore remains admissible during manual cooldown")
    {
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit { fence } => fence,
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { .. } => {
            panic!("fresh managed restore must reserve during manual cooldown")
        }
    };
    restore_active.record.managed_restore_fence = restore_reserved;
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &restore_active.record,
            None,
            None,
            "operation-c",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&restore_active.record),
            activation_at_ms_for_record(&restore_active.record),
            restore_active.record.lifecycle_revision,
            u64::MAX,
            1_000_250,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::InProgress)
    ));

    let completion = CloudflareTenantRootRefreshCompletionV1 {
        operation_id: "operation-a".to_owned(),
        completed_at_ms: FIRST_NOW_MS,
        response: refresh_terminal_response_from_record(&completed),
    };
    let mut later_state = completed;
    later_state.lifecycle_revision += 1;
    let replay = evaluate_refresh_admission_v1(
        &later_state,
        Some(
            serde_json::from_slice(
                &serde_json::to_vec(&completion).expect("persist completion"),
            )
            .expect("reload completion"),
        ),
        None,
        "operation-a",
        CloudflareTenantRootRefreshTriggerV1::Manual,
        identity_digest_for_record(&later_state),
        activation_at_ms_for_record(&later_state),
        later_state.lifecycle_revision,
        u64::MAX,
        retry_at_ms,
        TenantRootRefreshScheduleV1::default(),
    )
    .expect("replay completed operation after a later operation");
    assert!(matches!(
        replay,
        CloudflareTenantRootRefreshAdmissionEvaluationV1::Replay { response }
            if response == completion.response
    ));
    assert_ne!(
        manual_refresh_completion_storage_key_v1("tenant-a-operation"),
        manual_refresh_completion_storage_key_v1("tenant-b-operation")
    );
    let (other_tenant, _issuer_keys) = active_refresh_state_fixture();
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &other_tenant,
            None,
            None,
            "operation-b",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&other_tenant),
            activation_at_ms_for_record(&other_tenant),
            other_tenant.lifecycle_revision,
            u64::MAX,
            FIRST_NOW_MS + 1,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit { .. })
    ));
}

#[test]
fn manual_refresh_reconciles_admission_before_enforcing_original_bounds() {
    let (mut record, _) = active_refresh_state_fixture();
    let revision = record.lifecycle_revision;
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &record,
            None,
            None,
            "unseen",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&record),
            activation_at_ms_for_record(&record),
            revision,
            10,
            10,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::AuthorizationExpired)
    ));
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &record,
            None,
            None,
            "unseen",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&record),
            activation_at_ms_for_record(&record),
            revision + 1,
            20,
            10,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::RevisionMoved)
    ));
    let admitted = evaluate_refresh_admission_v1(
        &record,
        None,
        None,
        "admitted",
        CloudflareTenantRootRefreshTriggerV1::Manual,
        identity_digest_for_record(&record),
        activation_at_ms_for_record(&record),
        revision,
        20,
        10,
        TenantRootRefreshScheduleV1::default(),
    )
    .expect("valid authorization admits once");
    let CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit { pending } = admitted else {
        panic!("expected admission");
    };
    record.manual_refresh_pending = Some(pending);
    let restarted: CloudflareTenantRootRefreshActiveStateRecordV1 =
        serde_json::from_slice(&serde_json::to_vec(&record).unwrap()).unwrap();
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &restarted,
            None,
            None,
            "admitted",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&restarted),
            activation_at_ms_for_record(&restarted),
            revision,
            20,
            30,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit { .. })
    ));
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &restarted,
            None,
            None,
            "admitted",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&restarted),
            activation_at_ms_for_record(&restarted),
            revision + 1,
            1,
            30,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit { .. })
    ));
    let completion = CloudflareTenantRootRefreshCompletionV1 {
        operation_id: "admitted".to_owned(),
        completed_at_ms: 15,
        response: refresh_terminal_response_from_record(&record),
    };
    record.lifecycle_revision += 1;
    record.manual_refresh_pending = None;
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &record,
            Some(completion),
            None,
            "admitted",
            CloudflareTenantRootRefreshTriggerV1::Manual,
            identity_digest_for_record(&record),
            activation_at_ms_for_record(&record),
            revision,
            20,
            30,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::Replay { .. })
    ));
}

#[test]
fn scheduled_refresh_uses_stable_jitter_and_completion_anchor() {
    let (record, _) = active_refresh_state_fixture();
    let identity_digest = identity_digest_for_record(&record);
    let activation_at_ms = activation_at_ms_for_record(&record);
    let interval_ms = TENANT_ROOT_SCHEDULED_REFRESH_INTERVAL_MS_V1;
    let jitter = tenant_root_scheduled_refresh_jitter_ms_v1(identity_digest, interval_ms);
    assert!(jitter < TENANT_ROOT_SCHEDULED_REFRESH_JITTER_WINDOW_MS_V1);
    assert_eq!(
        jitter,
        tenant_root_scheduled_refresh_jitter_ms_v1(identity_digest, interval_ms)
    );

    let next_run_at_ms = tenant_root_scheduled_refresh_next_at_ms_v1(
        identity_digest,
        activation_at_ms,
        record.last_refresh_completed_at_ms,
        interval_ms,
    );
    assert!(matches!(
        evaluate_refresh_admission_v1(
            &record,
            None,
            None,
            "scheduled-operation",
            CloudflareTenantRootRefreshTriggerV1::Scheduled,
            identity_digest,
            activation_at_ms,
            record.lifecycle_revision,
            u64::MAX,
            next_run_at_ms - 1,
            TenantRootRefreshScheduleV1::default(),
        ),
        Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::NotDue {
            next_run_at_ms: observed
        }) if observed == next_run_at_ms
    ));
    let admitted = evaluate_refresh_admission_v1(
        &record,
        None,
        None,
        "scheduled-operation",
        CloudflareTenantRootRefreshTriggerV1::Scheduled,
        identity_digest,
        activation_at_ms,
        record.lifecycle_revision,
        u64::MAX,
        next_run_at_ms,
        TenantRootRefreshScheduleV1::default(),
    )
    .expect("scheduled refresh is admitted at its due bound");
    let CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit { pending } = admitted else {
        panic!("scheduled refresh must commit when due");
    };
    assert_eq!(
        pending.trigger,
        CloudflareTenantRootRefreshTriggerV1::Scheduled
    );

    let mut completed = record.clone();
    completed.manual_refresh_pending = Some(pending);
    let mut transitioned = completed.clone();
    apply_refresh_completion_transition_v1(
        &completed,
        &mut transitioned,
        Some("scheduled-operation"),
        next_run_at_ms,
    )
    .expect("scheduled completion transition persists anchor");
    assert_eq!(
        transitioned.last_refresh_completed_at_ms,
        Some(next_run_at_ms)
    );
    assert_eq!(transitioned.last_manual_refresh_completed_at_ms, None);
    assert!(
        tenant_root_scheduled_refresh_next_at_ms_v1(
            identity_digest,
            activation_at_ms,
            transitioned.last_refresh_completed_at_ms,
            interval_ms,
        ) > next_run_at_ms
    );

    let mut trigger_mismatch = record;
    trigger_mismatch.manual_refresh_pending = Some(CloudflareTenantRootRefreshPendingV1 {
        operation_id: "scheduled-operation".to_owned(),
        lifecycle_revision: trigger_mismatch.lifecycle_revision,
        trigger: CloudflareTenantRootRefreshTriggerV1::Scheduled,
        expires_at_ms: u64::MAX,
    });
    let mismatch = evaluate_refresh_admission_v1(
        &trigger_mismatch,
        None,
        None,
        "scheduled-operation",
        CloudflareTenantRootRefreshTriggerV1::Manual,
        identity_digest,
        activation_at_ms,
        trigger_mismatch.lifecycle_revision,
        u64::MAX,
        next_run_at_ms,
        TenantRootRefreshScheduleV1::default(),
    )
    .expect_err("replay cannot change its persisted trigger");
    assert_eq!(mismatch.code(), RouterAbProtocolErrorCode::ConflictingPair);
}

#[test]
fn managed_restore_fence_reserves_checkpoints_and_replays_after_json_restart() {
    const RESERVE_NOW_MS: u64 = 1_000_250;
    const LAST_RETRY_NOW_MS: u64 = 1_000_300;
    const EXPIRED_RETRY_NOW_MS: u64 = 1_000_301;
    let (mut active, journal, issuer_keys) = managed_restore_active_state_fixture();
    let request = managed_restore_request(0x61);
    let challenge = managed_restore_authorization_challenge_from_active_state_v1(
        &active,
        &journal,
        request.clone(),
    )
    .expect("managed-restore challenge");
    let mut tampered_challenge = challenge;
    tampered_challenge.activation_receipt_digest_b64u = encode_base64url_bytes_v1(&[0x62; 32]);
    assert!(validate_managed_restore_challenge_shape_v1(&tampered_challenge).is_err());
    let reserved = match reserve_managed_restore_authorization_fence_v1(
        &active,
        &journal,
        request.clone(),
        RESERVE_NOW_MS,
    )
    .expect("managed-restore reservation")
    {
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit { fence } => fence,
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { .. } => {
            panic!("fresh managed-restore request must reserve")
        }
    };
    active.record.managed_restore_fence = reserved.clone();
    let persisted_reserved: CloudflareTenantRootRefreshActiveStateRecordV1 =
        serde_json::from_slice(
            &serde_json::to_vec(&active.record).expect("persist reserved managed restore"),
        )
        .expect("reload reserved managed restore");
    active =
        validate_refresh_active_state_record(persisted_reserved, authority(0x71), &issuer_keys)
            .expect("reloaded reserved managed restore");
    assert!(matches!(
        reserve_managed_restore_authorization_fence_v1(
            &active,
            &journal,
            request.clone(),
            LAST_RETRY_NOW_MS,
        )
        .expect("exact reservation replay inside its window"),
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { fence }
            if fence == reserved
    ));
    let mut expired_record = active.record.clone();
    assert!(expire_managed_restore_reservation_v1(
        &mut expired_record,
        EXPIRED_RETRY_NOW_MS,
    ));
    let expired =
        validate_refresh_active_state_record(expired_record, authority(0x71), &issuer_keys)
            .expect("expired managed restore");
    let error = reserve_managed_restore_authorization_fence_v1(
        &expired,
        &journal,
        request.clone(),
        EXPIRED_RETRY_NOW_MS,
    )
    .expect_err("exact reservation retry after expiry");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::ExpiredLocalRequest);

    let (challenge, attempt) = match &reserved {
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { challenge, attempt } => {
            (challenge.clone(), attempt.clone())
        }
        CloudflareTenantRootManagedRestoreFenceV1::Open
        | CloudflareTenantRootManagedRestoreFenceV1::Terminal { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Expired { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Superseded { .. } => {
            panic!("reservation must retain the reserved challenge")
        }
    };
    let checkpoint = CloudflareTenantRootManagedRestoreAuthorizationCheckpointV1 {
        challenge,
        attempt,
        public_state_b64u: encode_base64url_bytes_v1(b"managed-restore-public-state"),
        capability_b64u: encode_base64url_bytes_v1(b"managed-restore-capability"),
        incident_authorization_b64u: encode_base64url_bytes_v1(
            b"managed-restore-incident-authorization",
        ),
    };
    let terminal =
        match checkpoint_managed_restore_authorization_fence_v1(&active, checkpoint.clone())
            .expect("managed-restore checkpoint")
        {
            CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit { fence } => fence,
            CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { .. } => {
                panic!("first managed-restore checkpoint must commit")
            }
        };
    active.record.managed_restore_fence = terminal.clone();
    let persisted_terminal: CloudflareTenantRootRefreshActiveStateRecordV1 =
        serde_json::from_slice(
            &serde_json::to_vec(&active.record).expect("persist terminal managed restore"),
        )
        .expect("reload terminal managed restore");
    active =
        validate_refresh_active_state_record(persisted_terminal, authority(0x71), &issuer_keys)
            .expect("reloaded terminal managed restore");
    assert!(matches!(
        checkpoint_managed_restore_authorization_fence_v1(&active, checkpoint)
            .expect("exact terminal checkpoint replay after restart"),
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { fence }
            if fence == terminal
    ));
}

#[test]
fn managed_restore_fence_rejects_changed_attempt_or_artifact_after_terminal() {
    let (mut active, journal, issuer_keys) = managed_restore_active_state_fixture();
    let request = managed_restore_request(0x63);
    let reserved = match reserve_managed_restore_authorization_fence_v1(
        &active,
        &journal,
        request.clone(),
        1_000_250,
    )
    .expect("managed-restore reservation")
    {
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit { fence } => fence,
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { .. } => {
            panic!("fresh managed-restore request must reserve")
        }
    };
    active.record.managed_restore_fence = reserved.clone();
    let (challenge, attempt) = match reserved {
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { challenge, attempt } => {
            (challenge, attempt)
        }
        CloudflareTenantRootManagedRestoreFenceV1::Open
        | CloudflareTenantRootManagedRestoreFenceV1::Terminal { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Expired { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Superseded { .. } => {
            panic!("reservation must retain the reserved challenge")
        }
    };
    let checkpoint = CloudflareTenantRootManagedRestoreAuthorizationCheckpointV1 {
        challenge,
        attempt,
        public_state_b64u: encode_base64url_bytes_v1(b"managed-restore-public-state"),
        capability_b64u: encode_base64url_bytes_v1(b"managed-restore-capability"),
        incident_authorization_b64u: encode_base64url_bytes_v1(
            b"managed-restore-incident-authorization",
        ),
    };
    let terminal =
        match checkpoint_managed_restore_authorization_fence_v1(&active, checkpoint.clone())
            .expect("managed-restore checkpoint")
        {
            CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit { fence } => fence,
            CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { .. } => {
                panic!("first managed-restore checkpoint must commit")
            }
        };
    active.record.managed_restore_fence = terminal;
    validate_refresh_active_state_record(
        serde_json::from_slice(
            &serde_json::to_vec(&active.record).expect("persist managed restore"),
        )
        .expect("reload managed restore"),
        authority(0x71),
        &issuer_keys,
    )
    .expect("terminal managed restore remains valid");

    let error = reserve_managed_restore_authorization_fence_v1(
        &active,
        &journal,
        managed_restore_request(0x64),
        1_000_250,
    )
    .expect_err("changed operator attempt must conflict");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::ConflictingPair);

    let mut changed_artifact = checkpoint.clone();
    changed_artifact.public_state_b64u = encode_base64url_bytes_v1(b"changed-public-state");
    let error = checkpoint_managed_restore_authorization_fence_v1(&active, changed_artifact)
        .expect_err("changed terminal artifact must conflict");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::ConflictingPair);
    let mut changed_incident_authorization = checkpoint;
    changed_incident_authorization.incident_authorization_b64u =
        encode_base64url_bytes_v1(b"changed-incident-authorization");
    let error = checkpoint_managed_restore_authorization_fence_v1(
        &active,
        changed_incident_authorization,
    )
    .expect_err("changed incident authorization must conflict");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::ConflictingPair);
}

#[test]
fn managed_restore_terminal_fence_survives_one_completed_refresh_transition() {
    let (mut active, journal, issuer_keys) = managed_restore_active_state_fixture();
    let request = managed_restore_request(0x65);
    let reserved = match reserve_managed_restore_authorization_fence_v1(
        &active,
        &journal,
        request.clone(),
        1_000_250,
    )
    .expect("managed-restore reservation")
    {
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit { fence } => fence,
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { .. } => {
            panic!("fresh managed-restore request must reserve")
        }
    };
    active.record.managed_restore_fence = reserved.clone();
    let checkpoint = match reserved {
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { challenge, attempt } => {
            CloudflareTenantRootManagedRestoreAuthorizationCheckpointV1 {
                challenge,
                attempt,
                public_state_b64u: encode_base64url_bytes_v1(b"managed-restore-public-state"),
                capability_b64u: encode_base64url_bytes_v1(b"managed-restore-capability"),
                incident_authorization_b64u: encode_base64url_bytes_v1(
                    b"managed-restore-incident-authorization",
                ),
            }
        }
        CloudflareTenantRootManagedRestoreFenceV1::Open
        | CloudflareTenantRootManagedRestoreFenceV1::Terminal { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Expired { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Superseded { .. } => {
            panic!("reservation must retain the reserved challenge")
        }
    };
    let terminal =
        match checkpoint_managed_restore_authorization_fence_v1(&active, checkpoint.clone())
            .expect("managed-restore checkpoint")
        {
            CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit { fence } => fence,
            CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { .. } => {
                panic!("first managed-restore checkpoint must commit")
            }
        };
    active.record.managed_restore_fence = terminal;

    let context = refresh_context(&active);
    let command_a = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverA);
    let command_b = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverB);
    let refresh_attempt = refresh_attempt_from_commands(&context, &command_a, &command_b)
        .expect("refresh attempt");
    let result_revision = active
        .record
        .lifecycle_revision
        .checked_add(1)
        .expect("refresh result revision");
    let activation_receipt = refresh_activation_receipt(&active, &context);
    let mut refreshed_record =
        refresh_active_state_record_from_verified_receipt(activation_receipt, result_revision)
            .expect("refreshed active record");
    let response = refresh_terminal_response_from_record(&refreshed_record);
    refreshed_record.fence = CloudflareTenantRootRefreshFenceV1::Terminal {
        attempt: refresh_attempt,
        outcome: CloudflareTenantRootRefreshTerminalOutcomeV1::Completed,
        response,
    };
    refreshed_record.managed_restore_fence = active.record.managed_restore_fence.clone();
    let refreshed =
        validate_refresh_active_state_record(refreshed_record, authority(0x71), &issuer_keys)
            .expect("completed refresh preserves the terminal managed-restore fence");
    assert!(matches!(
        reserve_managed_restore_authorization_fence_v1(
            &refreshed, &journal, request, 1_000_250,
        )
        .expect("managed-restore terminal request replay after refresh"),
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { .. }
    ));
    assert!(matches!(
        checkpoint_managed_restore_authorization_fence_v1(&refreshed, checkpoint)
            .expect("managed-restore terminal retry after refresh"),
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { .. }
    ));
}

#[test]
fn managed_restore_reserves_after_a_completed_refresh() {
    let (active, journal, issuer_keys) = managed_restore_active_state_fixture();
    let context = refresh_context(&active);
    let command_a = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverA);
    let command_b = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverB);
    let refresh_attempt = refresh_attempt_from_commands(&context, &command_a, &command_b)
        .expect("refresh attempt");
    let result_revision = active
        .record
        .lifecycle_revision
        .checked_add(1)
        .expect("refresh result revision");
    let activation_receipt = refresh_activation_receipt(&active, &context);
    let mut refreshed_record =
        refresh_active_state_record_from_verified_receipt(activation_receipt, result_revision)
            .expect("refreshed active record");
    let response = refresh_terminal_response_from_record(&refreshed_record);
    refreshed_record.fence = CloudflareTenantRootRefreshFenceV1::Terminal {
        attempt: refresh_attempt,
        outcome: CloudflareTenantRootRefreshTerminalOutcomeV1::Completed,
        response,
    };
    let refreshed =
        validate_refresh_active_state_record(refreshed_record, authority(0x71), &issuer_keys)
            .expect("completed refresh state");

    assert!(matches!(
        reserve_managed_restore_authorization_fence_v1(
            &refreshed,
            &journal,
            managed_restore_request(0x66),
            1_000_250,
        )
        .expect("managed restore after completed refresh"),
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit { .. }
    ));
}

#[test]
fn refresh_active_state_rejects_nonzero_signature_substitution() {
    let (mut record, issuer_keys) = active_refresh_state_fixture();
    let mut receipt_bytes =
        decode_base64url_bytes_v1("active activation receipt", &record.activation_receipt_b64u)
            .expect("active receipt bytes");
    let last_byte = receipt_bytes
        .last_mut()
        .expect("active receipt has a signature");
    *last_byte ^= 1;
    record.activation_receipt_b64u = encode_base64url_bytes_v1(&receipt_bytes);
    let error = validate_refresh_active_state_record(record, authority(0x71), &issuer_keys)
        .err()
        .expect("substituted signature must fail");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::ForbiddenLocalBinding
    );
}

#[test]
fn refresh_active_state_rejects_unknown_receipt_issuer_key_id() {
    let (record, _) = active_refresh_state_fixture();
    let wrong_keys = BTreeMap::from([(
        "different-issuer-v1".to_owned(),
        SigningKey::from_bytes(&[0x41; 32])
            .verifying_key()
            .to_bytes(),
    )]);
    let error = validate_refresh_active_state_record(record, authority(0x71), &wrong_keys)
        .err()
        .expect("unknown issuer key id must fail");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::ForbiddenLocalBinding
    );
}

#[test]
fn refresh_active_state_rejects_corrupt_reload() {
    let (mut record, issuer_keys) = active_refresh_state_fixture();
    record.activation_receipt_b64u = encode_base64url_bytes_v1(&[0x91; 8]);
    let error = validate_refresh_active_state_record(record, authority(0x71), &issuer_keys)
        .err()
        .expect("corrupt active state must fail");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );
}

#[test]
fn stored_corruption_is_not_reported_as_a_request_conflict() {
    let mut corrupt = record(0x21, 0x51, authority(0x44), 1_000, 1_030);
    corrupt.creation_capability_b64u.push('A');
    let candidate = record(0x22, 0x52, authority(0x44), 1_000, 1_030);
    let error = evaluate_creation_record(
        Some(corrupt),
        validate(candidate, authority(0x44)).expect("candidate"),
        authority(0x44),
        &verifying_keys(),
        1_015,
    )
    .expect_err("stored corruption");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn object_names_are_stable_and_identity_lineage_scoped() {
    let first = tenant_root_creation_object_name_v1(
        TenantRootIdentityDigestV1::from_bytes([0x11; 32]),
        TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage"),
    );
    let replay = tenant_root_creation_object_name_v1(
        TenantRootIdentityDigestV1::from_bytes([0x11; 32]),
        TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage"),
    );
    let other_identity = tenant_root_creation_object_name_v1(
        TenantRootIdentityDigestV1::from_bytes([0x12; 32]),
        TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage"),
    );
    let other_lineage = tenant_root_creation_object_name_v1(
        TenantRootIdentityDigestV1::from_bytes([0x11; 32]),
        TenantRootCustodyLineageId::from_bytes([0x23; 16]).expect("lineage"),
    );
    assert_eq!(first, replay);
    assert_ne!(first, other_identity);
    assert_ne!(first, other_lineage);
    assert!(first.starts_with("tenant-root-creation-v1-"));
}

#[test]
fn object_binding_requires_the_exact_derived_authority_id() {
    let expected = authority(0xab);
    let object_id = lower_hex(expected.as_bytes());
    assert!(validate_tenant_root_creation_object_binding_v1(&object_id, expected).is_ok());
    assert_eq!(
        validate_tenant_root_creation_object_binding_v1(&object_id, authority(0xac))
            .expect_err("mismatched authority")
            .code(),
        RouterAbProtocolErrorCode::ForbiddenLocalBinding
    );
    assert_eq!(
        validate_tenant_root_creation_object_binding_v1(&object_id.to_uppercase(), expected)
            .expect_err("non-canonical object id")
            .code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
}

#[test]
fn response_validation_requires_exact_revision_and_digests() {
    let candidate = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("candidate");
    let expected_revision = candidate.revision;
    let expected_journal_digest = candidate.journal_digest;
    let expected_capability_digest = candidate.capability.digest();
    let response = candidate.response(CloudflareTenantRootCreationJournalOutcomeV1::Committed);
    assert!(
        validate_cloudflare_tenant_root_creation_journal_response_v1(
            &response,
            expected_revision,
            expected_journal_digest,
            expected_capability_digest,
        )
        .is_ok()
    );

    let mut wrong_revision = response.clone();
    wrong_revision.revision += 1;
    assert_eq!(
        validate_cloudflare_tenant_root_creation_journal_response_v1(
            &wrong_revision,
            expected_revision,
            expected_journal_digest,
            expected_capability_digest,
        )
        .expect_err("wrong revision")
        .code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );

    let mut wrong_digest = response.clone();
    wrong_digest.journal_digest_b64u = encode_base64url_bytes_v1(&[0x81; 32]);
    assert_eq!(
        validate_cloudflare_tenant_root_creation_journal_response_v1(
            &wrong_digest,
            expected_revision,
            expected_journal_digest,
            expected_capability_digest,
        )
        .expect_err("wrong journal digest")
        .code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );

    let mut wrong_capability_digest = response;
    wrong_capability_digest.capability_digest_b64u = encode_base64url_bytes_v1(&[0x82; 32]);
    assert_eq!(
        validate_cloudflare_tenant_root_creation_journal_response_v1(
            &wrong_capability_digest,
            expected_revision,
            expected_journal_digest,
            expected_capability_digest,
        )
        .expect_err("wrong capability digest")
        .code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );
}

#[test]
fn creation_commitment_rendezvous_accepts_both_orders_and_exact_expired_replays() {
    const FRESH_NOW_MS: u64 = 1_010_000;
    const EXPIRED_NOW_MS: u64 = 1_030_001;
    let journal = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("journal");
    let deriver_a = creation_commitment_wire(&journal, TwoPartyDeriverRole::DeriverA, 12);
    let deriver_a_command = role_creation_command(&journal, TwoPartyDeriverRole::DeriverA);
    let first = evaluate_creation_commitment_rendezvous(
        None,
        &deriver_a,
        &deriver_a_command,
        &journal,
        &role_keys(),
        FRESH_NOW_MS,
    )
    .expect("first commitment");
    let first_record = match first {
        TenantRootCreationCommitmentRendezvousEvaluationV1::Commit {
            rendezvous,
            outcome:
                CloudflareTenantRootCreationCommitmentOutcomeV1::WaitingForPeer {
                    role: CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
                },
        } => rendezvous,
        other => panic!("unexpected first commitment outcome: {other:?}"),
    };

    assert!(matches!(
        evaluate_creation_commitment_rendezvous(
            Some(first_record.clone()),
            &deriver_a,
            &deriver_a_command,
            &journal,
            &role_keys(),
            EXPIRED_NOW_MS,
        )
        .expect("exact expired retry"),
        TenantRootCreationCommitmentRendezvousEvaluationV1::Replay(
            CloudflareTenantRootCreationCommitmentOutcomeV1::WaitingForPeer {
                role: CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
            }
        )
    ));
    assert_eq!(
        evaluate_creation_commitment_rendezvous(
            Some(first_record.clone()),
            &creation_commitment_wire(&journal, TwoPartyDeriverRole::DeriverA, 13),
            &deriver_a_command,
            &journal,
            &role_keys(),
            EXPIRED_NOW_MS,
        )
        .expect_err("same-role substitution")
        .code(),
        RouterAbProtocolErrorCode::ConflictingPair
    );

    let deriver_b = creation_commitment_wire(&journal, TwoPartyDeriverRole::DeriverB, 19);
    let deriver_b_command = role_creation_command(&journal, TwoPartyDeriverRole::DeriverB);
    let completed = evaluate_creation_commitment_rendezvous(
        Some(first_record),
        &deriver_b,
        &deriver_b_command,
        &journal,
        &role_keys(),
        FRESH_NOW_MS,
    )
    .expect("opposite-role commitment");
    let (completed_record, pair_wire) = match completed {
        TenantRootCreationCommitmentRendezvousEvaluationV1::Commit {
            rendezvous,
            outcome:
                CloudflareTenantRootCreationCommitmentOutcomeV1::BothRolesCommitted { pair },
        } => (rendezvous, pair.canonical_bytes().to_vec()),
        other => panic!("unexpected completed commitment outcome: {other:?}"),
    };
    match evaluate_creation_commitment_rendezvous(
        Some(completed_record.clone()),
        &deriver_b,
        &deriver_b_command,
        &journal,
        &role_keys(),
        EXPIRED_NOW_MS,
    )
    .expect("exact completed retry")
    {
        TenantRootCreationCommitmentRendezvousEvaluationV1::Replay(
            CloudflareTenantRootCreationCommitmentOutcomeV1::BothRolesCommitted { pair },
        ) => assert_eq!(pair.canonical_bytes(), pair_wire.as_slice()),
        other => panic!("unexpected completed retry outcome: {other:?}"),
    }

    let reverse_first = evaluate_creation_commitment_rendezvous(
        None,
        &deriver_b,
        &deriver_b_command,
        &journal,
        &role_keys(),
        FRESH_NOW_MS,
    )
    .expect("reverse first commitment");
    let reverse_record = match reverse_first {
        TenantRootCreationCommitmentRendezvousEvaluationV1::Commit { rendezvous, .. } => {
            rendezvous
        }
        other => panic!("unexpected reverse first outcome: {other:?}"),
    };
    assert!(matches!(
        evaluate_creation_commitment_rendezvous(
            Some(reverse_record),
            &deriver_a,
            &deriver_a_command,
            &journal,
            &role_keys(),
            FRESH_NOW_MS,
        )
        .expect("reverse completion"),
        TenantRootCreationCommitmentRendezvousEvaluationV1::Commit {
            outcome: CloudflareTenantRootCreationCommitmentOutcomeV1::BothRolesCommitted { .. },
            ..
        }
    ));
}

#[test]
fn creation_commitment_rendezvous_rejects_wrong_bindings_and_corrupt_reload() {
    const FRESH_NOW_MS: u64 = 1_010_000;
    const EXPIRED_NOW_MS: u64 = 1_030_001;
    let journal = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("journal");
    let candidate = creation_commitment_wire(&journal, TwoPartyDeriverRole::DeriverA, 12);
    let deriver_a_command = role_creation_command(&journal, TwoPartyDeriverRole::DeriverA);
    let deriver_b_command = role_creation_command(&journal, TwoPartyDeriverRole::DeriverB);
    let wrong_key = SigningKey::from_bytes(&[0xa3; 32]);
    let wrong_keys = role_keys_from_verifiers(
        "deriver-a-signing-key-7",
        wrong_key.verifying_key().to_bytes(),
        "deriver-b-signing-key-9",
        role_signing_key(TwoPartyDeriverRole::DeriverB)
            .verifying_key()
            .to_bytes(),
    );
    assert_eq!(
        evaluate_creation_commitment_rendezvous(
            None,
            &candidate,
            &deriver_a_command,
            &journal,
            &wrong_keys,
            FRESH_NOW_MS,
        )
        .expect_err("wrong signing key")
        .code(),
        RouterAbProtocolErrorCode::ForbiddenLocalBinding
    );

    let foreign_journal = validate(
        record(0x22, 0x52, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("foreign journal");
    let foreign_candidate =
        creation_commitment_wire(&foreign_journal, TwoPartyDeriverRole::DeriverA, 12);
    assert_eq!(
        evaluate_creation_commitment_rendezvous(
            None,
            &foreign_candidate,
            &deriver_a_command,
            &journal,
            &role_keys(),
            FRESH_NOW_MS,
        )
        .expect_err("wrong ceremony context")
        .code(),
        RouterAbProtocolErrorCode::ForbiddenLocalBinding
    );

    let first = evaluate_creation_commitment_rendezvous(
        None,
        &candidate,
        &deriver_a_command,
        &journal,
        &role_keys(),
        FRESH_NOW_MS,
    )
    .expect("first commitment");
    let first_record = match first {
        TenantRootCreationCommitmentRendezvousEvaluationV1::Commit { rendezvous, .. } => {
            rendezvous
        }
        other => panic!("unexpected first outcome: {other:?}"),
    };
    let mut wrong_journal = first_record.clone();
    wrong_journal.journal_digest_b64u = encode_base64url_bytes_v1(&[0xa4; 32]);
    assert_eq!(
        evaluate_creation_commitment_rendezvous(
            Some(wrong_journal),
            &creation_commitment_wire(&journal, TwoPartyDeriverRole::DeriverB, 19),
            &deriver_b_command,
            &journal,
            &role_keys(),
            FRESH_NOW_MS,
        )
        .expect_err("wrong stored journal binding")
        .code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
    let mut corrupt = first_record.clone();
    match &mut corrupt.state {
        CloudflareTenantRootCreationCommitmentRendezvousStateV1::OneRoleCommitted {
            signed_commitment_b64u,
            ..
        } => signed_commitment_b64u.push('A'),
        _ => panic!("first commitment must contain one role"),
    }
    assert_eq!(
        evaluate_creation_commitment_rendezvous(
            Some(corrupt),
            &creation_commitment_wire(&journal, TwoPartyDeriverRole::DeriverB, 19),
            &deriver_b_command,
            &journal,
            &role_keys(),
            FRESH_NOW_MS,
        )
        .expect_err("corrupt stored commitment")
        .code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
    assert_eq!(
        evaluate_creation_commitment_rendezvous(
            None,
            &candidate,
            &deriver_a_command,
            &journal,
            &role_keys(),
            EXPIRED_NOW_MS,
        )
        .expect_err("unseen expired commitment")
        .code(),
        RouterAbProtocolErrorCode::ExpiredLocalRequest
    );

    let mut unknown = serde_json::to_value(first_record).expect("rendezvous JSON");
    unknown["unexpected"] = serde_json::Value::Bool(true);
    assert!(
        serde_json::from_value::<CloudflareTenantRootCreationCommitmentRendezvousRecordV1>(
            unknown
        )
        .is_err()
    );
}

#[test]
fn installation_checkpoint_requires_the_complete_creation_commitment_pair() {
    const NOW_MS: u64 = 1_010_000;
    let journal = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("journal");
    let deriver_a = creation_commitment_wire(&journal, TwoPartyDeriverRole::DeriverA, 12);
    let deriver_a_command = role_creation_command(&journal, TwoPartyDeriverRole::DeriverA);
    let first = evaluate_creation_commitment_rendezvous(
        None,
        &deriver_a,
        &deriver_a_command,
        &journal,
        &role_keys(),
        NOW_MS,
    )
    .expect("first commitment");
    let first_record = match first {
        TenantRootCreationCommitmentRendezvousEvaluationV1::Commit { rendezvous, .. } => {
            rendezvous
        }
        other => panic!("unexpected first commitment outcome: {other:?}"),
    };
    assert_eq!(
        require_complete_creation_commitment_rendezvous(None, &journal, &role_keys())
            .expect_err("missing rendezvous")
            .code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );
    assert_eq!(
        require_complete_creation_commitment_rendezvous(
            Some(first_record.clone()),
            &journal,
            &role_keys(),
        )
        .expect_err("one-role rendezvous")
        .code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );

    let (complete_record, commitments) = publish_creation_commitment_pair(&journal, NOW_MS);
    let reloaded = require_complete_creation_commitment_rendezvous(
        Some(complete_record),
        &journal,
        &role_keys(),
    )
    .expect("complete rendezvous");
    assert_eq!(reloaded.canonical_bytes(), commitments.canonical_bytes());
}
