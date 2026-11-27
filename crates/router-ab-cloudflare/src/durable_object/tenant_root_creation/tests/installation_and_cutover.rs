//! Installation checkpoint and cutover Durable Object write tests.

use super::*;

#[test]
fn installation_checkpoint_accepts_both_orders_and_replays_exact_evidence() {
    const NOW_MS: u64 = 1_010_000;
    let journal = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("journal");
    let (_commitment_rendezvous, commitments) =
        publish_creation_commitment_pair(&journal, NOW_MS);
    let command_a = role_creation_command(&journal, TwoPartyDeriverRole::DeriverA);
    let command_b = role_creation_command(&journal, TwoPartyDeriverRole::DeriverB);
    let deriver_a_wire =
        installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61);
    #[cfg(feature = "workers-rs")]
    let pending = CloudflareTenantRootPendingShareV1::from_verified_installation_evidence(
        &deriver_a_wire,
        NOW_MS,
    )
    .expect("pending evidence binding");
    #[cfg(feature = "workers-rs")]
    assert_eq!(
        pending.installation_evidence_digest(),
        deriver_a_wire
            .lifecycle_receipt_digest()
            .expect("evidence digest"),
    );
    let first = evaluate_installation_checkpoint(
        None,
        deriver_a_wire,
        &command_a,
        &journal,
        &role_keys(),
        &commitments,
        NOW_MS,
    )
    .expect("first role");
    let first_checkpoint = match first {
        TenantRootCreationInstallationEvaluationV1::Commit {
            checkpoint,
            outcome:
                CloudflareTenantRootCreationInstallationOutcomeV1::WaitingForPeer {
                    role: CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
                },
        } => checkpoint,
        other => panic!("unexpected first-role outcome: {other:?}"),
    };
    assert!(matches!(
        evaluate_installation_checkpoint(
            Some(first_checkpoint.clone()),
            installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61),
            &command_a,
            &journal,
            &role_keys(),
            &commitments,
            NOW_MS,
        )
        .expect("exact retry"),
        TenantRootCreationInstallationEvaluationV1::Replay(
            CloudflareTenantRootCreationInstallationOutcomeV1::WaitingForPeer {
                role: CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
            }
        )
    ));
    let completed = evaluate_installation_checkpoint(
        Some(first_checkpoint),
        installation_wire(&journal, TwoPartyDeriverRole::DeriverB, 19, 12, 0x62),
        &command_b,
        &journal,
        &role_keys(),
        &commitments,
        NOW_MS,
    )
    .expect("second role");
    let completed_checkpoint = match completed {
        TenantRootCreationInstallationEvaluationV1::Commit {
            checkpoint,
            outcome: CloudflareTenantRootCreationInstallationOutcomeV1::BothRolesReady { .. },
        } => checkpoint,
        other => panic!("unexpected completed outcome: {other:?}"),
    };
    assert!(matches!(
        validate_installation_checkpoint(
            completed_checkpoint.clone(),
            &journal,
            &role_keys(),
            &commitments,
        )
        .expect("durable reload")
        .state,
        ValidatedTenantRootCreationInstallationStateV1::BothRolesReady { .. }
    ));
    assert!(matches!(
        evaluate_installation_checkpoint(
            Some(completed_checkpoint),
            installation_wire(&journal, TwoPartyDeriverRole::DeriverB, 19, 12, 0x62),
            &command_b,
            &journal,
            &role_keys(),
            &commitments,
            NOW_MS,
        )
        .expect("completed retry"),
        TenantRootCreationInstallationEvaluationV1::Replay(
            CloudflareTenantRootCreationInstallationOutcomeV1::BothRolesReady { .. }
        )
    ));

    let reverse_first = evaluate_installation_checkpoint(
        None,
        installation_wire(&journal, TwoPartyDeriverRole::DeriverB, 19, 12, 0x62),
        &command_b,
        &journal,
        &role_keys(),
        &commitments,
        NOW_MS,
    )
    .expect("reverse first");
    let reverse_checkpoint = match reverse_first {
        TenantRootCreationInstallationEvaluationV1::Commit { checkpoint, .. } => checkpoint,
        other => panic!("unexpected reverse first outcome: {other:?}"),
    };
    assert!(matches!(
        evaluate_installation_checkpoint(
            Some(reverse_checkpoint),
            installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61),
            &command_a,
            &journal,
            &role_keys(),
            &commitments,
            NOW_MS,
        )
        .expect("reverse completion"),
        TenantRootCreationInstallationEvaluationV1::Commit {
            outcome: CloudflareTenantRootCreationInstallationOutcomeV1::BothRolesReady { .. },
            ..
        }
    ));
}

#[test]
fn installation_checkpoint_rejects_substitution_and_corrupt_reload() {
    const NOW_MS: u64 = 1_010_000;
    let journal = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("journal");
    let (_commitment_rendezvous, commitments) =
        publish_creation_commitment_pair(&journal, NOW_MS);
    let command_a = role_creation_command(&journal, TwoPartyDeriverRole::DeriverA);
    let command_b = role_creation_command(&journal, TwoPartyDeriverRole::DeriverB);
    let first = evaluate_installation_checkpoint(
        None,
        installation_wire(&journal, TwoPartyDeriverRole::DeriverB, 19, 12, 0x62),
        &command_b,
        &journal,
        &role_keys(),
        &commitments,
        NOW_MS,
    )
    .expect("first role");
    let first_checkpoint = match first {
        TenantRootCreationInstallationEvaluationV1::Commit { checkpoint, .. } => checkpoint,
        other => panic!("unexpected first outcome: {other:?}"),
    };
    assert_eq!(
        evaluate_installation_checkpoint(
            Some(first_checkpoint.clone()),
            installation_wire(&journal, TwoPartyDeriverRole::DeriverB, 20, 12, 0x63),
            &command_b,
            &journal,
            &role_keys(),
            &commitments,
            NOW_MS,
        )
        .expect_err("same-role substitution")
        .code(),
        RouterAbProtocolErrorCode::ConflictingPair
    );
    let completed = evaluate_installation_checkpoint(
        Some(first_checkpoint),
        installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61),
        &command_a,
        &journal,
        &role_keys(),
        &commitments,
        NOW_MS,
    )
    .expect("completion");
    let mut corrupt = match completed {
        TenantRootCreationInstallationEvaluationV1::Commit { checkpoint, .. } => checkpoint,
        other => panic!("unexpected completed outcome: {other:?}"),
    };
    match &mut corrupt.state {
        CloudflareTenantRootCreationInstallationStateV1::BothRolesReady {
            root_commitment_b64u,
            ..
        } => *root_commitment_b64u = encode_base64url_bytes_v1(&[0x91; 32]),
        _ => panic!("completed checkpoint must contain both roles"),
    }
    assert_eq!(
        evaluate_installation_checkpoint(
            Some(corrupt),
            installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61),
            &command_a,
            &journal,
            &role_keys(),
            &commitments,
            NOW_MS,
        )
        .expect_err("corrupt stored root")
        .code(),
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig
    );

    let foreign_journal = validate(
        record(0x22, 0x52, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("foreign journal");
    assert_eq!(
        evaluate_installation_checkpoint(
            None,
            installation_wire(
                &foreign_journal,
                TwoPartyDeriverRole::DeriverA,
                12,
                19,
                0x64,
            ),
            &command_a,
            &journal,
            &role_keys(),
            &commitments,
            NOW_MS,
        )
        .expect_err("foreign ceremony")
        .code(),
        RouterAbProtocolErrorCode::ForbiddenLocalBinding
    );
}

#[test]
fn installation_checkpoint_allows_only_exact_replay_after_expiry() {
    const FRESH_NOW_MS: u64 = 1_010_000;
    const EXPIRED_NOW_MS: u64 = 1_030_001;
    let journal = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("journal");
    let (_commitment_rendezvous, commitments) =
        publish_creation_commitment_pair(&journal, FRESH_NOW_MS);
    let command_a = role_creation_command(&journal, TwoPartyDeriverRole::DeriverA);
    let command_b = role_creation_command(&journal, TwoPartyDeriverRole::DeriverB);
    let deriver_a = installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61);
    let first = evaluate_installation_checkpoint(
        None,
        deriver_a,
        &command_a,
        &journal,
        &role_keys(),
        &commitments,
        FRESH_NOW_MS,
    )
    .expect("first role");
    let checkpoint = match first {
        TenantRootCreationInstallationEvaluationV1::Commit { checkpoint, .. } => checkpoint,
        other => panic!("unexpected first outcome: {other:?}"),
    };

    assert!(matches!(
        evaluate_installation_checkpoint(
            Some(checkpoint.clone()),
            installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61,),
            &command_a,
            &journal,
            &role_keys(),
            &commitments,
            EXPIRED_NOW_MS,
        )
        .expect("exact expired retry"),
        TenantRootCreationInstallationEvaluationV1::Replay(
            CloudflareTenantRootCreationInstallationOutcomeV1::WaitingForPeer { .. }
        )
    ));
    assert_eq!(
        evaluate_installation_checkpoint(
            Some(checkpoint),
            installation_wire(&journal, TwoPartyDeriverRole::DeriverB, 19, 12, 0x62,),
            &command_b,
            &journal,
            &role_keys(),
            &commitments,
            EXPIRED_NOW_MS,
        )
        .expect_err("unseen peer evidence after expiry")
        .code(),
        RouterAbProtocolErrorCode::ExpiredLocalRequest
    );
    assert_eq!(
        evaluate_installation_checkpoint(
            None,
            installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61,),
            &command_a,
            &journal,
            &role_keys(),
            &commitments,
            EXPIRED_NOW_MS,
        )
        .expect_err("unseen evidence after expiry")
        .code(),
        RouterAbProtocolErrorCode::ExpiredLocalRequest
    );
}

#[test]
fn request_json_and_base64url_are_strict() {
    let accepted = record(0x21, 0x51, authority(0x44), 1_000, 1_030);
    let value = serde_json::json!({
        "journal_b64u": accepted.journal_b64u,
        "creation_capability_b64u": accepted.creation_capability_b64u,
        "unexpected": true,
    });
    assert!(
        serde_json::from_value::<CloudflareTenantRootCreationJournalRequestV1>(value).is_err()
    );
    assert!(decode_canonical_base64url("journal", "", 1, 1).is_err());
    assert!(decode_canonical_base64url("journal", "AAAA", 1, 4).is_err());
    let key_json = format!(
        "{{\"keys\":[{{\"issuer_key_id\":\"{ISSUER_KEY_ID}\",\"verifying_key_hex\":\"{}\"}}]}}",
        lower_hex(&verifying_key())
    );
    assert_eq!(
        crate::env::decode_issuer_verifying_keys(&key_json)
            .expect("issuer key set")
            .get(ISSUER_KEY_ID),
        Some(&verifying_key())
    );
    let duplicate = format!(
        "{{\"keys\":[{{\"issuer_key_id\":\"{ISSUER_KEY_ID}\",\"verifying_key_hex\":\"{}\"}},{{\"issuer_key_id\":\"{ISSUER_KEY_ID}\",\"verifying_key_hex\":\"{}\"}}]}}",
        lower_hex(&verifying_key()),
        lower_hex(&verifying_key())
    );
    assert!(crate::env::decode_issuer_verifying_keys(&duplicate).is_err());
    let invalid_point_bytes = (0_u8..=u8::MAX)
        .map(|marker| [marker; 32])
        .find(|candidate| ed25519_dalek::VerifyingKey::from_bytes(candidate).is_err())
        .expect("at least one repeated-byte encoding is not an Ed25519 point");
    let invalid_point = format!(
        "{{\"keys\":[{{\"issuer_key_id\":\"{ISSUER_KEY_ID}\",\"verifying_key_hex\":\"{}\"}}]}}",
        lower_hex(&invalid_point_bytes)
    );
    assert!(crate::env::decode_issuer_verifying_keys(&invalid_point).is_err());
}

#[test]
fn private_creation_responses_retain_and_validate_exact_pair() {
    let journal = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("journal");
    let (_rendezvous, pair) = publish_creation_commitment_pair(&journal, 1_010_000);
    let command_b = role_creation_command(&journal, TwoPartyDeriverRole::DeriverB);
    let candidate = creation_commitment_wire(&journal, TwoPartyDeriverRole::DeriverB, 19);
    let response = commitment_response(
        creation_response_scope(&command_b, &journal).expect("response scope"),
        &candidate,
        CloudflareTenantRootCreationCommitmentOutcomeV1::BothRolesCommitted { pair },
    )
    .expect("commitment response");
    let validated = validate_creation_commitment_response_v1(
        &response,
        &command_b,
        &candidate,
        &role_keys(),
    )
    .expect("validated commitment response");
    match validated {
        CloudflareTenantRootCreationCommitmentOutcomeV1::BothRolesCommitted { pair } => {
            assert_eq!(pair.deriver_b().canonical_bytes(), candidate.as_slice(),);
        }
        other => panic!("unexpected response outcome: {other:?}"),
    }

    let mut wrong_scope = response;
    wrong_scope.identity_digest_b64u = encode_base64url_bytes_v1(&[0xa1; 32]);
    assert_eq!(
        validate_creation_commitment_response_v1(
            &wrong_scope,
            &command_b,
            &candidate,
            &role_keys(),
        )
        .expect_err("wrong response scope")
        .code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );
}

#[test]
fn private_request_wires_are_strict_and_installation_response_is_public() {
    let journal = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("journal");
    let command_a = role_creation_command(&journal, TwoPartyDeriverRole::DeriverA);
    let command_bytes = command_a.canonical_bytes();
    let commitment = creation_commitment_wire(&journal, TwoPartyDeriverRole::DeriverA, 12);
    let commitment_request = CloudflareTenantRootCreationCommitmentRequestV1 {
        role_creation_command_b64u: encode_base64url_bytes_v1(command_bytes),
        signed_commitment_b64u: encode_base64url_bytes_v1(&commitment),
    };
    let mut request_value = serde_json::to_value(commitment_request).expect("request JSON");
    request_value["unexpected"] = serde_json::Value::Bool(true);
    assert!(
        serde_json::from_value::<CloudflareTenantRootCreationCommitmentRequestV1>(
            request_value
        )
        .is_err()
    );

    let evidence = installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61);
    let installation_request = CloudflareTenantRootCreationInstallationRequestV1 {
        role_creation_command_b64u: encode_base64url_bytes_v1(command_bytes),
        signed_evidence_b64u: encode_base64url_bytes_v1(evidence.canonical_bytes()),
    };
    let mut installation_value =
        serde_json::to_value(installation_request).expect("installation request JSON");
    installation_value["unexpected"] = serde_json::Value::Bool(true);
    assert!(
        serde_json::from_value::<CloudflareTenantRootCreationInstallationRequestV1>(
            installation_value
        )
        .is_err()
    );
    let response = installation_response(
        creation_response_scope(&command_a, &journal).expect("response scope"),
        CloudflareTenantRootCreationInstallationOutcomeV1::WaitingForPeer {
            role: CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
        },
    )
    .expect("installation response");
    assert!(matches!(
        validate_installation_response_v1(&response, &command_a, &evidence)
            .expect("validated installation response"),
        CloudflareTenantRootCreationInstallationOutcomeV1::WaitingForPeer {
            role: CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
        }
    ));
}

#[test]
fn role_key_set_retains_exact_role_and_key_id_across_rotation() {
    let previous_a = SigningKey::from_bytes(&[0xa2; 32])
        .verifying_key()
        .to_bytes();
    let current_a = role_signing_key(TwoPartyDeriverRole::DeriverA)
        .verifying_key()
        .to_bytes();
    let current_b = role_signing_key(TwoPartyDeriverRole::DeriverB)
        .verifying_key()
        .to_bytes();
    let key_json = serde_json::json!({
        "active_deriver_a_signing_key_id": "deriver-a-signing-key-7",
        "active_deriver_b_signing_key_id": "deriver-b-signing-key-9",
        "keys": [
            {
                "role": "deriver_a",
                "signing_key_id": "deriver-a-signing-key-6",
                "verifying_key_hex": lower_hex(&previous_a),
            },
            {
                "role": "deriver_a",
                "signing_key_id": "deriver-a-signing-key-7",
                "verifying_key_hex": lower_hex(&current_a),
            },
            {
                "role": "deriver_b",
                "signing_key_id": "deriver-b-signing-key-9",
                "verifying_key_hex": lower_hex(&current_b),
            }
        ]
    })
    .to_string();
    let keys = decode_role_verifying_keys(&key_json).expect("retained role key set");
    assert_eq!(
        keys.for_role_and_key_id(TwoPartyDeriverRole::DeriverA, "deriver-a-signing-key-6",)
            .expect("previous A key"),
        &previous_a
    );
    assert_eq!(
        keys.for_role_and_key_id(TwoPartyDeriverRole::DeriverA, "deriver-a-signing-key-7",)
            .expect("current A key"),
        &current_a
    );
    assert!(keys
        .for_role_and_key_id(TwoPartyDeriverRole::DeriverB, "deriver-a-signing-key-7",)
        .is_err());

    let journal = validate(
        record(0x21, 0x51, authority(0x44), 1_000, 1_030),
        authority(0x44),
    )
    .expect("journal");
    let (_commitment_rendezvous, commitments) =
        publish_creation_commitment_pair(&journal, 1_010_000);
    let command_a = role_creation_command(&journal, TwoPartyDeriverRole::DeriverA);
    let first = evaluate_installation_checkpoint(
        None,
        installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61),
        &command_a,
        &journal,
        &keys,
        &commitments,
        1_010_000,
    )
    .expect("checkpoint signed by retained key");
    let checkpoint = match first {
        TenantRootCreationInstallationEvaluationV1::Commit { checkpoint, .. } => checkpoint,
        other => panic!("unexpected retained-key outcome: {other:?}"),
    };
    validate_installation_checkpoint(checkpoint.clone(), &journal, &keys, &commitments)
        .expect("retained key reload");
    let without_original = role_keys_from_verifiers(
        "deriver-a-signing-key-6",
        previous_a,
        "deriver-b-signing-key-9",
        current_b,
    );
    assert!(validate_installation_checkpoint(
        checkpoint,
        &journal,
        &without_original,
        &commitments
    )
    .is_err());

    let duplicate = serde_json::json!({
        "active_deriver_a_signing_key_id": "deriver-a-signing-key-7",
        "active_deriver_b_signing_key_id": "deriver-b-signing-key-9",
        "keys": [
            {
                "role": "deriver_a",
                "signing_key_id": "deriver-a-signing-key-7",
                "verifying_key_hex": lower_hex(&current_a),
            },
            {
                "role": "deriver_a",
                "signing_key_id": "deriver-a-signing-key-7",
                "verifying_key_hex": lower_hex(&previous_a),
            },
            {
                "role": "deriver_b",
                "signing_key_id": "deriver-b-signing-key-9",
                "verifying_key_hex": lower_hex(&current_b),
            }
        ]
    })
    .to_string();
    assert!(decode_role_verifying_keys(&duplicate).is_err());

    let missing_role = serde_json::json!({
        "active_deriver_a_signing_key_id": "deriver-a-signing-key-7",
        "active_deriver_b_signing_key_id": "deriver-b-signing-key-9",
        "keys": [
            {
                "role": "deriver_a",
                "signing_key_id": "deriver-a-signing-key-6",
                "verifying_key_hex": lower_hex(&previous_a),
            },
            {
                "role": "deriver_a",
                "signing_key_id": "deriver-a-signing-key-7",
                "verifying_key_hex": lower_hex(&current_a),
            }
        ]
    })
    .to_string();
    assert!(decode_role_verifying_keys(&missing_role).is_err());
}

#[test]
fn cutover_do_write_initializes_replays_and_advances_one_revision() {
    let attempt = TenantRootCutoverAttemptIdV1::from_bytes([0x41; 16]).expect("attempt");
    let receipt =
        |seed| TenantRootCutoverReceiptDigestV1::from_bytes([seed; 32]).expect("receipt");
    let prerequisites =
        TenantRootCutoverPrerequisitesV1::new(receipt(1), receipt(2), receipt(3), [0x44; 32])
            .expect("prerequisites");
    let open = TenantRootCutoverOpenV1::new(attempt, prerequisites);
    let open_record = TenantRootCutoverRecordV1::new(open.clone().into());
    let initialized = evaluate_cutover_write(
        None,
        CloudflareTenantRootCutoverWriteRequestV1::Initialize {
            record: open_record.clone(),
        },
    )
    .expect("initialize");
    assert_eq!(
        initialized.outcome,
        CloudflareTenantRootCutoverWriteOutcomeV1::Initialized
    );

    let replayed = evaluate_cutover_write(
        Some(&open_record),
        CloudflareTenantRootCutoverWriteRequestV1::Initialize {
            record: open_record.clone(),
        },
    )
    .expect("replay initialize");
    assert_eq!(
        replayed.outcome,
        CloudflareTenantRootCutoverWriteOutcomeV1::ExactReplay
    );

    let fenced = open
        .fence(
            TenantRootCutoverFenceReceiptV1::new(attempt, receipt(4), 100)
                .expect("fence receipt"),
        )
        .expect("fenced");
    let fenced_record = TenantRootCutoverRecordV1::new(fenced.into());
    let advanced = evaluate_cutover_write(
        Some(&open_record),
        CloudflareTenantRootCutoverWriteRequestV1::Update {
            expected_revision: 0,
            record: fenced_record.clone(),
        },
    )
    .expect("advance");
    assert_eq!(
        advanced.outcome,
        CloudflareTenantRootCutoverWriteOutcomeV1::Advanced
    );
    assert_eq!(advanced.record, fenced_record);
}

#[test]
fn cutover_do_write_rejects_missing_stale_and_skipped_state() {
    let attempt = TenantRootCutoverAttemptIdV1::from_bytes([0x41; 16]).expect("attempt");
    let receipt =
        |seed| TenantRootCutoverReceiptDigestV1::from_bytes([seed; 32]).expect("receipt");
    let prerequisites =
        TenantRootCutoverPrerequisitesV1::new(receipt(1), receipt(2), receipt(3), [0x44; 32])
            .expect("prerequisites");
    let open = TenantRootCutoverOpenV1::new(attempt, prerequisites);
    let open_record = TenantRootCutoverRecordV1::new(open.clone().into());
    let fenced = open
        .fence(
            TenantRootCutoverFenceReceiptV1::new(attempt, receipt(4), 100)
                .expect("fence receipt"),
        )
        .expect("fenced");
    let fenced_record = TenantRootCutoverRecordV1::new(fenced.clone().into());

    assert!(evaluate_cutover_write(
        None,
        CloudflareTenantRootCutoverWriteRequestV1::Update {
            expected_revision: 0,
            record: fenced_record.clone(),
        },
    )
    .is_err());
    assert!(evaluate_cutover_write(
        Some(&open_record),
        CloudflareTenantRootCutoverWriteRequestV1::Update {
            expected_revision: 1,
            record: fenced_record,
        },
    )
    .is_err());

    let drained = fenced
        .drain(
            TenantRootCutoverDrainReceiptV1::new(attempt, receipt(5), receipt(6), 200)
                .expect("drain receipt"),
        )
        .expect("drained");
    let drained_record = TenantRootCutoverRecordV1::new(drained.into());
    assert!(evaluate_cutover_write(
        Some(&open_record),
        CloudflareTenantRootCutoverWriteRequestV1::Update {
            expected_revision: 0,
            record: drained_record,
        },
    )
    .is_err());
}

pub(super) fn lower_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}
