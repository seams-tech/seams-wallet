//! Creation journal reads, refresh fixtures and refresh installation tests.

use super::*;

/// A caller that reached the wrong object fails closed on identity or lineage.
#[test]
fn creation_journal_read_rejects_a_foreign_identity_or_lineage() {
    let record = record(0x11, 0x21, authority(0x44), 1_000_000, 1_030_000);
    let journal = validate_creation_record(record, authority(0x44), &verifying_keys())
        .expect("validated journal");
    let honest = read_request(&journal);

    let mut foreign_identity = honest.clone();
    foreign_identity.identity_digest_b64u = encode_base64url_bytes_v1(&[0x99; 32]);
    assert!(build_creation_journal_read_response(
        &foreign_identity,
        &journal,
        None,
        None,
        None
    )
    .is_err());

    let mut foreign_lineage = honest.clone();
    foreign_lineage.custody_lineage_b64u = encode_base64url_bytes_v1(&[0x98; 16]);
    assert!(build_creation_journal_read_response(
        &foreign_lineage,
        &journal,
        None,
        None,
        None
    )
    .is_err());

    // Malformed encodings fail closed rather than comparing loosely.
    let mut malformed = honest;
    malformed.identity_digest_b64u = "not base64url!".to_owned();
    assert!(
        build_creation_journal_read_response(&malformed, &journal, None, None, None).is_err()
    );
}

pub(super) fn verifying_key() -> [u8; 32] {
    SigningKey::from_bytes(&SIGNING_KEY_BYTES)
        .verifying_key()
        .to_bytes()
}

pub(super) fn verifying_keys() -> BTreeMap<String, [u8; 32]> {
    BTreeMap::from([(ISSUER_KEY_ID.to_owned(), verifying_key())])
}

pub(super) fn active_refresh_state_fixture() -> (
    CloudflareTenantRootRefreshActiveStateRecordV1,
    BTreeMap<String, [u8; 32]>,
) {
    let receipt_b64u = ACTIVE_RECEIPT_B64U.to_owned();
    let receipt_bytes = decode_base64url_bytes_v1("active activation receipt", &receipt_b64u)
        .expect("active receipt bytes");
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .expect("active receipt");
    let digest = receipt.digest().expect("active receipt digest");
    let (active_epoch, commitments) = match receipt.binding() {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => {
            (binding.epoch(), binding.commitments())
        }
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => {
            (binding.next_epoch(), binding.next_commitments())
        }
    };
    let record = CloudflareTenantRootRefreshActiveStateRecordV1 {
        activation_receipt_b64u: receipt_b64u,
        activation_receipt_digest_b64u: encode_base64url_bytes_v1(digest.as_bytes()),
        identity_digest_b64u: encode_base64url_bytes_v1(receipt.identity_digest().as_bytes()),
        custody_lineage_b64u: receipt.custody_lineage().to_base64url(),
        active_epoch: active_epoch.get().get(),
        deriver_a_commitment_b64u: encode_base64url_bytes_v1(
            commitments.deriver_a().as_bytes(),
        ),
        deriver_b_commitment_b64u: encode_base64url_bytes_v1(
            commitments.deriver_b().as_bytes(),
        ),
        active_root_commitment_b64u: encode_base64url_bytes_v1(commitments.root_commitment()),
        lifecycle_revision: receipt.result_control_plane_revision(),
        fence: CloudflareTenantRootRefreshFenceV1::Open,
        managed_restore_fence: CloudflareTenantRootManagedRestoreFenceV1::Open,
        manual_refresh_pending: None,
        last_manual_refresh_completed_at_ms: None,
        last_refresh_completed_at_ms: None,
        delivery: None,
    };
    let verifying_key = SigningKey::from_bytes(&[0x41; 32])
        .verifying_key()
        .to_bytes();
    let issuer_keys = BTreeMap::from([(receipt.issuer_key_id().to_owned(), verifying_key)]);
    (record, issuer_keys)
}

pub(super) fn identity_digest_for_record(
    record: &CloudflareTenantRootRefreshActiveStateRecordV1,
) -> TenantRootIdentityDigestV1 {
    TenantRootIdentityDigestV1::from_bytes(
        decode_fixed_base64url_32(
            "tenant-root refresh test identity digest",
            &record.identity_digest_b64u,
        )
        .expect("test identity digest"),
    )
}

pub(super) fn activation_at_ms_for_record(record: &CloudflareTenantRootRefreshActiveStateRecordV1) -> u64 {
    let receipt_bytes = decode_base64url_bytes_v1(
        "tenant-root refresh test activation receipt",
        &record.activation_receipt_b64u,
    )
    .expect("test activation receipt bytes");
    TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .expect("test activation receipt")
        .activated_at_ms()
}

pub(super) fn validate(
    record: CloudflareTenantRootCreationJournalRecordV1,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
) -> RouterAbProtocolResult<ValidatedTenantRootCreationJournalV1> {
    validate_creation_record(record, authority_id, &verifying_keys())
}

pub(super) fn role_signing_key(role: TwoPartyDeriverRole) -> SigningKey {
    SigningKey::from_bytes(match role {
        TwoPartyDeriverRole::DeriverA => &DERIVER_A_SIGNING_KEY_BYTES,
        TwoPartyDeriverRole::DeriverB => &DERIVER_B_SIGNING_KEY_BYTES,
    })
}

pub(super) fn role_keys_from_verifiers(
    deriver_a_key_id: &str,
    deriver_a_verifying_key: [u8; 32],
    deriver_b_key_id: &str,
    deriver_b_verifying_key: [u8; 32],
) -> TenantRootCreationRoleVerifyingKeysV1 {
    let key_json = serde_json::json!({
        "active_deriver_a_signing_key_id": deriver_a_key_id,
        "active_deriver_b_signing_key_id": deriver_b_key_id,
        "keys": [
            {
                "role": "deriver_a",
                "signing_key_id": deriver_a_key_id,
                "verifying_key_hex": lower_hex(&deriver_a_verifying_key),
            },
            {
                "role": "deriver_b",
                "signing_key_id": deriver_b_key_id,
                "verifying_key_hex": lower_hex(&deriver_b_verifying_key),
            },
        ],
    })
    .to_string();
    decode_role_verifying_keys(&key_json).expect("valid role key set")
}

pub(super) fn role_keys() -> TenantRootCreationRoleVerifyingKeysV1 {
    role_keys_from_verifiers(
        "deriver-a-signing-key-7",
        role_signing_key(TwoPartyDeriverRole::DeriverA)
            .verifying_key()
            .to_bytes(),
        "deriver-b-signing-key-9",
        role_signing_key(TwoPartyDeriverRole::DeriverB)
            .verifying_key()
            .to_bytes(),
    )
}

pub(super) fn validated_active_refresh_state() -> ValidatedTenantRootRefreshActiveStateV1 {
    let (record, issuer_keys) = active_refresh_state_fixture();
    validate_refresh_active_state_record(record, authority(0x71), &issuer_keys)
        .expect("active refresh state")
}

#[cfg(feature = "workers-rs")]
#[test]
fn refresh_job_read_projection_is_limited_to_validated_phases() {
    for (phase, expected_status) in [
        (
            CloudflareTenantRootRefreshJobPhaseV1::Preparing,
            "preparing",
        ),
        (
            CloudflareTenantRootRefreshJobPhaseV1::Installing,
            "installing",
        ),
        (
            CloudflareTenantRootRefreshJobPhaseV1::Verifying,
            "verifying",
        ),
    ] {
        let job = refresh_job_read_from_phase_v1(
            phase,
            Some("operation-state-reader".to_owned()),
            1_000_000,
        )
        .expect("valid refresh phase")
        .expect("operation-backed job");
        let job_wire = serde_json::to_value(job).expect("job wire");
        let status = job_wire
            .get("status")
            .and_then(serde_json::Value::as_str)
            .expect("job status");
        assert_eq!(status, expected_status);
    }

    assert_eq!(
        refresh_job_read_from_phase_v1(
            CloudflareTenantRootRefreshJobPhaseV1::Preparing,
            None,
            1_000_000,
        )
        .expect("missing operation is allowed"),
        None,
    );
    let invalid_operation = refresh_job_read_from_phase_v1(
        CloudflareTenantRootRefreshJobPhaseV1::Preparing,
        Some(" ".to_owned()),
        1_000_000,
    )
    .expect_err("invalid operation must fail closed");
    assert_eq!(
        invalid_operation.code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );
    let invalid_timestamp = refresh_job_read_from_phase_v1(
        CloudflareTenantRootRefreshJobPhaseV1::Installing,
        Some("operation-state-reader".to_owned()),
        0,
    )
    .expect_err("invalid ceremony time must fail closed");
    assert_eq!(
        invalid_timestamp.code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );
}

pub(super) fn managed_restore_active_state_fixture() -> (
    ValidatedTenantRootRefreshActiveStateV1,
    ValidatedTenantRootCreationJournalV1,
    BTreeMap<String, [u8; 32]>,
) {
    let journal = validate(
        record(0x19, 0x29, authority(0x71), 1_000_000, 1_030_000),
        authority(0x71),
    )
    .expect("managed-restore Started journal");
    let (_, creation_commitments) = publish_creation_commitment_pair(&journal, 1_000_100);
    let command_a = role_creation_command(&journal, TwoPartyDeriverRole::DeriverA);
    let command_b = role_creation_command(&journal, TwoPartyDeriverRole::DeriverB);
    let deriver_b_checkpoint = match evaluate_installation_checkpoint(
        None,
        installation_wire(&journal, TwoPartyDeriverRole::DeriverB, 19, 12, 0x92),
        &command_b,
        &journal,
        &role_keys(),
        &creation_commitments,
        1_000_100,
    )
    .expect("Deriver B installation")
    {
        TenantRootCreationInstallationEvaluationV1::Commit { checkpoint, .. } => checkpoint,
        other => panic!("unexpected Deriver B installation outcome: {other:?}"),
    };
    let complete_installation = match evaluate_installation_checkpoint(
        Some(deriver_b_checkpoint),
        installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x91),
        &command_a,
        &journal,
        &role_keys(),
        &creation_commitments,
        1_000_100,
    )
    .expect("Deriver A installation")
    {
        TenantRootCreationInstallationEvaluationV1::Commit { checkpoint, .. } => checkpoint,
        other => panic!("unexpected complete installation outcome: {other:?}"),
    };
    validate_installation_checkpoint(
        complete_installation,
        &journal,
        &role_keys(),
        &creation_commitments,
    )
    .expect("validated complete installation");

    let deriver_a_installation =
        installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x91);
    let deriver_b_installation =
        installation_wire(&journal, TwoPartyDeriverRole::DeriverB, 19, 12, 0x92);
    let commitments = creation_commitments_from_installation(
        &deriver_a_installation,
        &deriver_b_installation,
    );
    let deriver_a_backup =
        refresh_managed_backup(&deriver_a_installation, TwoPartyDeriverRole::DeriverA, 12);
    let deriver_b_backup =
        refresh_managed_backup(&deriver_b_installation, TwoPartyDeriverRole::DeriverB, 19);
    let ecdsa_canary = creation_provider_canary(
        &journal.ceremony_context,
        &commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
    );
    let ed25519_canary = creation_provider_canary(
        &journal.ceremony_context,
        &commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
    );
    let expected_revision = 2;
    let result_revision = 3;
    let bundle = VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_managed_backups(
        deriver_a_installation,
        deriver_b_installation,
        deriver_a_backup,
        deriver_b_backup,
        ecdsa_canary,
        ed25519_canary,
        expected_revision,
        result_revision,
    )
    .expect("initial activation evidence");
    let signed = TenantRootSignedActivationReceiptV1::sign_initial_creation(
        &bundle,
        1_000_120,
        authority(0x71),
        ISSUER_KEY_ID,
        &[0x41; 32],
    )
    .expect("initial activation receipt");
    let receipt_bytes = signed
        .canonical_bytes()
        .expect("initial activation receipt bytes");
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .expect("decoded initial activation receipt")
        .verify_issuer_signature(
            &SigningKey::from_bytes(&[0x41; 32])
                .verifying_key()
                .to_bytes(),
        )
        .expect("verified initial activation receipt");
    let record = refresh_active_state_record_from_verified_receipt(receipt, result_revision)
        .expect("managed-restore active state");
    let issuer_keys = BTreeMap::from([(
        ISSUER_KEY_ID.to_owned(),
        SigningKey::from_bytes(&[0x41; 32])
            .verifying_key()
            .to_bytes(),
    )]);
    let active = validate_refresh_active_state_record(record, authority(0x71), &issuer_keys)
        .expect("validated managed-restore active state");
    (active, journal, issuer_keys)
}

pub(super) fn managed_restore_request(
    incident_seed: u8,
) -> CloudflareTenantRootManagedRestoreAuthorizationRequestV1 {
    CloudflareTenantRootManagedRestoreAuthorizationRequestV1 {
        incident_id: format!("incident-{incident_seed}"),
        outage_observation_digest_b64u: encode_base64url_bytes_v1(&[incident_seed; 32]),
        issued_at_ms: 1_000_200,
        expires_at_ms: 1_000_300,
        nonce_b64u: encode_base64url_bytes_v1(&[incident_seed.wrapping_add(1); 32]),
        unavailable_role: TenantRootManagedRestoreRoleV1::DeriverA,
    }
}

pub(super) fn refresh_context(
    active: &ValidatedTenantRootRefreshActiveStateV1,
) -> TenantRootCeremonyContextV1 {
    TenantRootCeremonyContextV1::new(
        active.identity_digest,
        active.custody_lineage,
        TenantRootCeremonyEpochsV1::refresh(
            active.active_epoch,
            active.active_epoch.next().expect("next epoch"),
        )
        .expect("refresh epochs"),
        TenantRootCeremonySessionIdV1::from_bytes([0x52; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x53; 32]).expect("nonce"),
        1_000_000,
        1_030_000,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("refresh context")
}

pub(super) fn refresh_command(
    active: &ValidatedTenantRootRefreshActiveStateV1,
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
) -> VerifiedTenantRootRoleRefreshCommandV1 {
    let issuer_signing_key = SigningKey::from_bytes(&[0x41; 32]);
    let issuer_signing_key_bytes = issuer_signing_key.to_bytes();
    let issuer_verifying_key_bytes = issuer_signing_key.verifying_key().to_bytes();
    let issuer_key_id = active.activation_receipt.issuer_key_id().to_owned();
    let command = TenantRootRoleRefreshCommandV1::sign(
        &active.active_pair,
        context,
        role,
        active.record.lifecycle_revision,
        authority(0x71),
        1_000_000,
        1_030_000,
        issuer_key_id.clone(),
        &issuer_signing_key_bytes,
    )
    .expect("refresh command");
    let bytes = command.canonical_bytes().expect("refresh command bytes");
    let command = TenantRootRoleRefreshCommandV1::decode_canonical_bytes(&bytes)
        .expect("decoded refresh command");
    command
        .verify(
            &active.active_pair,
            context,
            role,
            active.record.lifecycle_revision,
            authority(0x71),
            &issuer_key_id,
            &issuer_verifying_key_bytes,
        )
        .expect("verified refresh command")
}

pub(super) fn refresh_managed_backup(
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    role: TwoPartyDeriverRole,
    share_scalar: u64,
) -> router_ab_core::VerifiedTenantRootManagedBackupV1 {
    let context = evidence.evidence().transcript().context();
    let share = SigningRootShare::from_canonical_bytes(
        role.share_id(),
        Scalar::from(share_scalar).to_bytes(),
    )
    .expect("refresh backup share");
    let binding = TenantRootManagedBackupBindingV1::from_verified_installation_evidence(
        evidence,
        format!("backup-provider-{}", role.as_str()),
        format!("kms/tenant-root/{}/epoch-2/v1", role.as_str()),
        context.signing_key_id(role),
        1_000_010,
    )
    .expect("refresh backup binding");
    let share_wire = MpcPrfSigningRootShareWireV1::new(
        SigningRootShareWire::from_share(&share).to_bytes().to_vec(),
    )
    .expect("refresh backup share wire");
    let request = TenantRootManagedBackupSealRequestV1::new(binding.clone(), share_wire)
        .expect("refresh backup seal request");
    let ciphertext = match role {
        TwoPartyDeriverRole::DeriverA => vec![0xa5; 96],
        TwoPartyDeriverRole::DeriverB => vec![0xb5; 96],
    };
    let signing_key = role_signing_key(role);
    let signed =
        TenantRootSignedManagedBackupV1::sign(request, ciphertext, &signing_key.to_bytes())
            .expect("signed refresh backup");
    signed
        .verify(&binding, &signing_key.verifying_key().to_bytes())
        .expect("verified refresh backup")
}

pub(super) fn refresh_provider_canary(
    context: &TenantRootCeremonyContextV1,
    commitments: &TenantRootEpochCommitmentsV1,
    family: TenantRootCanaryCurveFamilyV1,
) -> router_ab_core::VerifiedTenantRootProviderCanaryReceiptV1 {
    let target_epoch = match context.epochs() {
        TenantRootCeremonyEpochsV1::Refresh { next, .. } => next,
        TenantRootCeremonyEpochsV1::Create { .. } => {
            panic!("refresh canary requires refresh epochs")
        }
    };
    let binding = TenantRootProviderCanaryReceiptBindingV1::new(
        context.identity_digest(),
        context.custody_lineage(),
        TenantRootActivationReceiptTransitionV1::RefreshSwap,
        target_epoch,
        commitments.clone(),
        family,
        format!("kms/tenant-root/{}/canary-v1", family.as_str()),
        1_000_010,
        authority(0x72),
        "control-plane-canary-v1",
        1_000_000,
        1_030_000,
    )
    .expect("refresh canary binding");
    let signing_key = SigningKey::from_bytes(&[0x72; 32]);
    let signed =
        TenantRootSignedProviderCanaryReceiptV1::sign(binding.clone(), &signing_key.to_bytes())
            .expect("signed refresh canary");
    signed
        .verify(&binding, &signing_key.verifying_key().to_bytes())
        .expect("verified refresh canary")
}

pub(super) fn refresh_activation_receipt(
    active: &ValidatedTenantRootRefreshActiveStateV1,
    context: &TenantRootCeremonyContextV1,
) -> router_ab_core::VerifiedTenantRootSignedActivationReceiptV1 {
    let share_a = SigningRootShare::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverA.share_id(),
        Scalar::from(30u64).to_bytes(),
    )
    .expect("refresh Deriver A share");
    let share_b = SigningRootShare::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverB.share_id(),
        Scalar::from(55u64).to_bytes(),
    )
    .expect("refresh Deriver B share");
    let installation_a =
        refresh_installation_wire(context, TwoPartyDeriverRole::DeriverA, 30, 55, 0x75);
    let installation_b =
        refresh_installation_wire(context, TwoPartyDeriverRole::DeriverB, 55, 30, 0x76);
    let next_commitments = TenantRootEpochCommitmentsV1::new(
        MpcPrfShareCommitmentWireV1::new(
            SigningRootShareCommitment::from_share(&share_a)
                .to_bytes()
                .to_vec(),
        )
        .expect("refresh Deriver A commitment"),
        MpcPrfShareCommitmentWireV1::new(
            SigningRootShareCommitment::from_share(&share_b)
                .to_bytes()
                .to_vec(),
        )
        .expect("refresh Deriver B commitment"),
    )
    .expect("refresh next commitments");
    let backup_a = refresh_managed_backup(&installation_a, TwoPartyDeriverRole::DeriverA, 30);
    let backup_b = refresh_managed_backup(&installation_b, TwoPartyDeriverRole::DeriverB, 55);
    let canary_ecdsa = refresh_provider_canary(
        context,
        &next_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
    );
    let canary_ed25519 = refresh_provider_canary(
        context,
        &next_commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
    );
    let result_revision = active
        .record
        .lifecycle_revision
        .checked_add(1)
        .expect("refresh result revision");
    let bundle =
        VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1::from_verified_managed_backups(
            &active.commitments,
            installation_a,
            installation_b,
            backup_a,
            backup_b,
            canary_ecdsa,
            canary_ed25519,
            active.record.lifecycle_revision,
            result_revision,
        )
        .expect("refresh activation bundle");
    let signed = TenantRootSignedActivationReceiptV1::sign_refresh_swap(
        &bundle,
        1_000_020,
        authority(0x71),
        active.activation_receipt.issuer_key_id(),
        &[0x41; 32],
    )
    .expect("signed refresh activation receipt");
    let bytes = signed
        .canonical_bytes()
        .expect("refresh activation receipt bytes");
    TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&bytes)
        .expect("decoded refresh activation receipt")
        .verify_issuer_signature(
            &SigningKey::from_bytes(&[0x41; 32])
                .verifying_key()
                .to_bytes(),
        )
        .expect("verified refresh activation receipt")
}

pub(super) fn refresh_recipient(
    role: TwoPartyDeriverRole,
) -> (
    &'static str,
    router_ab_core::TenantRootRefreshHpkePublicKeyV1,
) {
    match role {
        TwoPartyDeriverRole::DeriverA => (
            "deriver-b-refresh-hpke-key-1",
            TenantRootRefreshHpkeKeypairV1::derive_from_ikm([0xb2; 32])
                .expect("Deriver B refresh HPKE key")
                .public_key(),
        ),
        TwoPartyDeriverRole::DeriverB => (
            "deriver-a-refresh-hpke-key-1",
            TenantRootRefreshHpkeKeypairV1::derive_from_ikm([0xa2; 32])
                .expect("Deriver A refresh HPKE key")
                .public_key(),
        ),
    }
}

pub(super) fn refresh_commitment(
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    scalar: u64,
) -> VerifiedTenantRootRefreshCommitmentV1 {
    let coefficient = RootShareRefreshCoefficient::from_canonical_bytes(
        role,
        Scalar::from(scalar).to_bytes(),
    )
    .expect("refresh coefficient");
    let (recipient_key_id, recipient_public_key) = refresh_recipient(role);
    let transcript = TenantRootRefreshCommitmentTranscriptV1::new(
        context.clone(),
        coefficient.commitment(),
        recipient_key_id,
        recipient_public_key,
    )
    .expect("refresh commitment transcript");
    let signing_key = role_signing_key(role);
    let signed = TenantRootSignedRefreshCommitmentV1::sign(transcript, &signing_key.to_bytes())
        .expect("signed refresh commitment");
    let bytes = signed.canonical_bytes().expect("refresh commitment bytes");
    let signed = TenantRootSignedRefreshCommitmentV1::decode_canonical_bytes(&bytes)
        .expect("decoded refresh commitment");
    let keys = role_keys();
    signed
        .verify_strict(
            context,
            role,
            context.signing_key_id(role),
            keys.for_role_and_key_id(role, context.signing_key_id(role))
                .expect("refresh commitment key"),
        )
        .expect("verified refresh commitment")
}

pub(super) fn refresh_commitment_pair(
    context: &TenantRootCeremonyContextV1,
) -> VerifiedTenantRootRefreshCommitmentPairV1 {
    VerifiedTenantRootRefreshCommitmentPairV1::new(
        refresh_commitment(context, TwoPartyDeriverRole::DeriverA, 7),
        refresh_commitment(context, TwoPartyDeriverRole::DeriverB, 11),
    )
    .expect("refresh commitment pair")
}

pub(super) fn refresh_contribution(
    context: &TenantRootCeremonyContextV1,
    commitments: &VerifiedTenantRootRefreshCommitmentPairV1,
    role: TwoPartyDeriverRole,
    scalar: u64,
    rng_seed: u64,
) -> VerifiedTenantRootSignedRefreshContributionV1 {
    let coefficient = RootShareRefreshCoefficient::from_canonical_bytes(
        role,
        Scalar::from(scalar).to_bytes(),
    )
    .expect("refresh coefficient");
    let aad = match role {
        TwoPartyDeriverRole::DeriverA => {
            TenantRootRefreshContributionAadV1::deriver_a_to_b(commitments)
        }
        TwoPartyDeriverRole::DeriverB => {
            TenantRootRefreshContributionAadV1::deriver_b_to_a(commitments)
        }
    }
    .expect("refresh contribution AAD");
    let envelope = seal_tenant_root_refresh_contribution_v1(
        &aad,
        &coefficient.contribution_for(role.peer()),
        &mut TestRng(rng_seed),
    )
    .expect("sealed refresh contribution");
    let signed = TenantRootSignedRefreshContributionV1::sign(
        &aad,
        envelope,
        &role_signing_key(role).to_bytes(),
    )
    .expect("signed refresh contribution");
    let bytes = signed
        .canonical_bytes()
        .expect("refresh contribution bytes");
    verify_refresh_contribution_wire(&bytes, context, commitments, &role_keys())
        .expect("verified refresh contribution")
}

pub(super) fn refresh_installation_wire(
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    share_scalar: u64,
    peer_scalar: u64,
    proof_seed: u8,
) -> VerifiedTenantRootSignedShareInstallationEvidenceWireV1 {
    let share = SigningRootShare::from_canonical_bytes(
        role.share_id(),
        Scalar::from(share_scalar).to_bytes(),
    )
    .expect("share");
    let peer = SigningRootShare::from_canonical_bytes(
        role.peer().share_id(),
        Scalar::from(peer_scalar).to_bytes(),
    )
    .expect("peer share");
    let transcript = TenantRootShareInstallationTranscriptV1::new(
        context.clone(),
        role,
        SigningRootShareCommitment::from_share(&share),
        SigningRootShareCommitment::from_share(&peer),
    )
    .expect("transcript");
    let proof = prove_root_share_knowledge(
        &share,
        &transcript.canonical_bytes().expect("transcript bytes"),
        &mut ChaCha20Rng::from_seed([proof_seed; 32]),
    )
    .expect("proof");
    let signing_key = role_signing_key(role);
    let signed = TenantRootSignedShareInstallationEvidenceV1::sign(
        TenantRootShareInstallationEvidenceV1::new(transcript, proof).expect("evidence"),
        &signing_key.to_bytes(),
    )
    .expect("signed evidence");
    let bytes = signed.canonical_bytes().expect("signed evidence bytes");
    let keys = role_keys();
    TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        &bytes,
        keys.for_role_and_key_id(role, context.signing_key_id(role))
            .expect("installation evidence key"),
    )
    .expect("verified installation evidence")
}

pub(super) fn refresh_installation_terminal_receipt(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
) -> VerifiedTenantRootRefreshInstallationReceiptV1 {
    let role = command.role();
    let context = evidence.evidence().transcript().context();
    let receipt = match TenantRootCommandTerminalReceiptV1::sign_success(
        TenantRootCommandReplayKeyV1::new(
            command.identity_digest(),
            command.custody_lineage(),
            command.session_id(),
            command.nonce(),
            role,
        ),
        TenantRootProtocolDigestV1::from_bytes([0x91; 32]).expect("receipt digest"),
        evidence.canonical_bytes().to_vec(),
        command.issued_at_ms(),
        context.signing_key_id(role),
        &role_signing_key(role).to_bytes(),
    )
    .expect("terminal receipt")
    {
        TenantRootCommandTerminalReceiptV1::Success(receipt) => receipt,
        TenantRootCommandTerminalReceiptV1::Failure(_) => {
            unreachable!("sign_success returns a success receipt")
        }
    };
    VerifiedTenantRootRefreshInstallationReceiptV1::new(
        receipt,
        evidence.canonical_bytes(),
        command,
        context,
        &role_keys(),
    )
    .expect("verified terminal receipt")
}

#[test]
fn completed_refresh_commitment_replay_after_expiry_reaches_core_evaluator() {
    let active = validated_active_refresh_state();
    let context = refresh_context(&active);
    let command_a = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverA);
    let command_b = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverB);
    let commitment_a = refresh_commitment(&context, TwoPartyDeriverRole::DeriverA, 7);
    let commitment_b = refresh_commitment(&context, TwoPartyDeriverRole::DeriverB, 11);
    let active_binding =
        TenantRootRefreshCommitmentCheckpointActiveBindingV1::from_verified_activation_receipt(
            active.activation_receipt,
            &active.active_pair,
            active.record.lifecycle_revision,
        )
        .expect("active checkpoint binding");
    let deriver_a_verifying_key = role_signing_key(TwoPartyDeriverRole::DeriverA)
        .verifying_key()
        .to_bytes();
    let deriver_b_verifying_key = role_signing_key(TwoPartyDeriverRole::DeriverB)
        .verifying_key()
        .to_bytes();
    let first = evaluate_tenant_root_refresh_commitment_checkpoint_v1(
        None,
        commitment_a,
        &command_a,
        &active_binding,
        &context,
        authority(0x71),
        &deriver_a_verifying_key,
        &deriver_b_verifying_key,
        1_000_100,
    )
    .expect("first refresh commitment");
    let first_checkpoint = match first {
        TenantRootRefreshCommitmentCheckpointEvaluationV1::Commit { checkpoint, .. } => {
            checkpoint
        }
        other => panic!("unexpected first refresh commitment outcome: {other:?}"),
    };
    let second = evaluate_tenant_root_refresh_commitment_checkpoint_v1(
        Some(first_checkpoint),
        commitment_b,
        &command_b,
        &active_binding,
        &context,
        authority(0x71),
        &deriver_a_verifying_key,
        &deriver_b_verifying_key,
        1_000_100,
    )
    .expect("completed refresh commitment");
    let completed_checkpoint = match second {
        TenantRootRefreshCommitmentCheckpointEvaluationV1::Commit { checkpoint, .. } => {
            checkpoint
        }
        other => panic!("unexpected completed refresh commitment outcome: {other:?}"),
    };

    require_fresh_refresh_commitment_command(
        Some(&completed_checkpoint),
        TwoPartyDeriverRole::DeriverB,
        &command_b,
        &context,
        1_030_001,
    )
    .expect("completed exact replay bypasses freshness");
    let replay = evaluate_tenant_root_refresh_commitment_checkpoint_v1(
        Some(completed_checkpoint.clone()),
        refresh_commitment(&context, TwoPartyDeriverRole::DeriverB, 11),
        &command_b,
        &active_binding,
        &context,
        authority(0x71),
        &deriver_a_verifying_key,
        &deriver_b_verifying_key,
        1_030_001,
    )
    .expect("exact completed replay");
    assert!(matches!(
        replay,
        TenantRootRefreshCommitmentCheckpointEvaluationV1::Replay(
            TenantRootRefreshCommitmentCheckpointOutcomeV1::BothRolesCommitted { .. }
        )
    ));

    require_fresh_refresh_commitment_command(
        Some(&completed_checkpoint),
        TwoPartyDeriverRole::DeriverB,
        &command_b,
        &context,
        1_030_001,
    )
    .expect("changed completed candidate reaches replay evaluator");
    let changed_error = evaluate_tenant_root_refresh_commitment_checkpoint_v1(
        Some(completed_checkpoint),
        refresh_commitment(&context, TwoPartyDeriverRole::DeriverB, 12),
        &command_b,
        &active_binding,
        &context,
        authority(0x71),
        &deriver_a_verifying_key,
        &deriver_b_verifying_key,
        1_030_001,
    )
    .err()
    .expect("changed completed candidate conflicts");
    assert_eq!(
        changed_error.code(),
        RouterAbDerivationErrorCode::ReplayMismatch
    );
    assert_eq!(
        refresh_commitment_evaluation_error(changed_error, true).code(),
        RouterAbProtocolErrorCode::ConflictingPair
    );
}

#[test]
fn refresh_contribution_rendezvous_replays_completed_pair_after_expiry() {
    let mut active = validated_active_refresh_state();
    let context = refresh_context(&active);
    let commitments = refresh_commitment_pair(&context);
    let command_a = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverA);
    let command_b = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverB);
    active.record.fence = CloudflareTenantRootRefreshFenceV1::Reserved {
        attempt: refresh_attempt_from_commands(&context, &command_a, &command_b)
            .expect("refresh attempt"),
    };

    let contribution_b = refresh_contribution(
        &context,
        &commitments,
        TwoPartyDeriverRole::DeriverB,
        11,
        0x22,
    );
    let expected_b = encode_base64url_bytes_v1(contribution_b.canonical_bytes());
    let first = evaluate_refresh_contribution_rendezvous(
        None,
        contribution_b,
        &command_b,
        &active,
        &context,
        &commitments,
        &role_keys(),
        authority(0x71),
        1_000_100,
    )
    .expect("first contribution");
    let first_record = match first {
        TenantRootRefreshContributionRendezvousEvaluationV1::Commit {
            record,
            outcome:
                CloudflareTenantRootRefreshContributionResponseOutcomeV1::WaitingForPeer {
                    role: CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
                },
        } => record,
        _ => panic!("unexpected first contribution outcome"),
    };

    let contribution_a = refresh_contribution(
        &context,
        &commitments,
        TwoPartyDeriverRole::DeriverA,
        7,
        0x33,
    );
    let expected_a = encode_base64url_bytes_v1(contribution_a.canonical_bytes());
    let completed = evaluate_refresh_contribution_rendezvous(
        Some(first_record),
        contribution_a,
        &command_a,
        &active,
        &context,
        &commitments,
        &role_keys(),
        authority(0x71),
        1_000_100,
    )
    .expect("completed contribution pair");
    let completed_record = match completed {
        TenantRootRefreshContributionRendezvousEvaluationV1::Commit {
            record,
            outcome:
                CloudflareTenantRootRefreshContributionResponseOutcomeV1::BothRolesContributed {
                    deriver_a_signed_contribution_b64u,
                    deriver_b_signed_contribution_b64u,
                },
        } => {
            assert_eq!(deriver_a_signed_contribution_b64u, expected_a);
            assert_eq!(deriver_b_signed_contribution_b64u, expected_b);
            record
        }
        _ => panic!("unexpected completed contribution outcome"),
    };

    let replay = evaluate_refresh_contribution_rendezvous(
        Some(completed_record.clone()),
        refresh_contribution(
            &context,
            &commitments,
            TwoPartyDeriverRole::DeriverA,
            7,
            0x33,
        ),
        &command_a,
        &active,
        &context,
        &commitments,
        &role_keys(),
        authority(0x71),
        1_030_001,
    )
    .expect("exact completed replay");
    assert!(matches!(
        replay,
        TenantRootRefreshContributionRendezvousEvaluationV1::Replay(
            CloudflareTenantRootRefreshContributionResponseOutcomeV1::BothRolesContributed { .. }
        )
    ));

    let conflict = evaluate_refresh_contribution_rendezvous(
        Some(completed_record),
        refresh_contribution(
            &context,
            &commitments,
            TwoPartyDeriverRole::DeriverA,
            7,
            0x34,
        ),
        &command_a,
        &active,
        &context,
        &commitments,
        &role_keys(),
        authority(0x71),
        1_030_001,
    )
    .err()
    .expect("changed completed contribution conflicts");
    assert_eq!(conflict.code(), RouterAbProtocolErrorCode::ConflictingPair);
}

#[test]
fn refresh_installation_checkpoint_rejects_role_commitment_substitutions() {
    let mut active = validated_active_refresh_state();
    let context = refresh_context(&active);
    let commitments = refresh_commitment_pair(&context);
    let command_a = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverA);
    let command_b = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverB);
    active.record.fence = CloudflareTenantRootRefreshFenceV1::Reserved {
        attempt: refresh_attempt_from_commands(&context, &command_a, &command_b)
            .expect("refresh attempt"),
    };

    // Active shares are 12 and 19; coefficients 7 and 11 produce next shares 30 and 55.
    let exact_a =
        refresh_installation_wire(&context, TwoPartyDeriverRole::DeriverA, 30, 55, 0x61);
    let exact_b =
        refresh_installation_wire(&context, TwoPartyDeriverRole::DeriverB, 55, 30, 0x62);
    let exact_a_receipt = refresh_installation_terminal_receipt(&command_a, &exact_a);
    let exact_b_receipt = refresh_installation_terminal_receipt(&command_b, &exact_b);
    let first = evaluate_refresh_installation_checkpoint(
        None,
        exact_a.canonical_bytes(),
        &command_a,
        &active,
        &context,
        &role_keys(),
        &commitments,
        authority(0x71),
        &exact_a_receipt,
        1_000_100,
    )
    .expect("first exact role installation");
    let first_checkpoint = match first {
        TenantRootRefreshInstallationCheckpointEvaluationV1::Commit { checkpoint, .. } => {
            checkpoint
        }
        _ => panic!("unexpected first installation outcome"),
    };
    match evaluate_refresh_installation_checkpoint(
        Some(first_checkpoint),
        exact_b.canonical_bytes(),
        &command_b,
        &active,
        &context,
        &role_keys(),
        &commitments,
        authority(0x71),
        &exact_b_receipt,
        1_000_100,
    )
    .expect("complete exact role installation")
    {
        TenantRootRefreshInstallationCheckpointEvaluationV1::Commit {
            outcome:
                CloudflareTenantRootRefreshInstallationResponseOutcomeV1::BothRolesReady { .. },
            ..
        } => {}
        _ => panic!("unexpected complete installation outcome"),
    }

    for (share_scalar, peer_scalar, proof_seed) in
        [(7, 11, 0x63), (31, 55, 0x64), (30, 56, 0x65)]
    {
        let substituted_a = refresh_installation_wire(
            &context,
            TwoPartyDeriverRole::DeriverA,
            share_scalar,
            peer_scalar,
            proof_seed,
        );
        let substituted_a_receipt =
            refresh_installation_terminal_receipt(&command_a, &substituted_a);
        let first = evaluate_refresh_installation_checkpoint(
            None,
            substituted_a.canonical_bytes(),
            &command_a,
            &active,
            &context,
            &role_keys(),
            &commitments,
            authority(0x71),
            &substituted_a_receipt,
            1_000_100,
        )
        .expect("substituted first role installation is retained pending its peer");
        let first_checkpoint = match first {
            TenantRootRefreshInstallationCheckpointEvaluationV1::Commit {
                checkpoint, ..
            } => checkpoint,
            _ => panic!("unexpected substituted first outcome"),
        };
        let substituted_b = refresh_installation_wire(
            &context,
            TwoPartyDeriverRole::DeriverB,
            peer_scalar,
            share_scalar,
            proof_seed.wrapping_add(1),
        );
        let substituted_b_receipt =
            refresh_installation_terminal_receipt(&command_b, &substituted_b);
        let error = evaluate_refresh_installation_checkpoint(
            Some(first_checkpoint),
            substituted_b.canonical_bytes(),
            &command_b,
            &active,
            &context,
            &role_keys(),
            &commitments,
            authority(0x71),
            &substituted_b_receipt,
            1_000_100,
        )
        .err()
        .expect("substituted role commitment must conflict at pair completion");
        assert_eq!(error.code(), RouterAbProtocolErrorCode::ConflictingPair);
    }
}

#[test]
fn refresh_installation_checkpoint_recovers_after_terminal_d1_commit() {
    const EXPIRED_NOW_MS: u64 = 1_030_001;
    let mut active = validated_active_refresh_state();
    let context = refresh_context(&active);
    let commitments = refresh_commitment_pair(&context);
    let command = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverA);
    let command_b = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverB);
    active.record.fence = CloudflareTenantRootRefreshFenceV1::Reserved {
        attempt: refresh_attempt_from_commands(&context, &command, &command_b)
            .expect("refresh attempt"),
    };
    let persisted_record = serde_json::from_slice(
        &serde_json::to_vec(&active.record).expect("persisted reserved refresh state"),
    )
    .expect("reload reserved refresh state");
    let mut restarted_active = validated_active_refresh_state();
    restarted_active.record = persisted_record;
    let evidence =
        refresh_installation_wire(&context, TwoPartyDeriverRole::DeriverA, 30, 55, 0x71);
    let terminal_receipt = refresh_installation_terminal_receipt(&command, &evidence);

    let evaluation = evaluate_refresh_installation_checkpoint(
        None,
        evidence.canonical_bytes(),
        &command,
        &restarted_active,
        &context,
        &role_keys(),
        &commitments,
        authority(0x71),
        &terminal_receipt,
        EXPIRED_NOW_MS,
    )
    .expect("terminal D1 receipt permits checkpoint recovery");
    match evaluation {
        TenantRootRefreshInstallationCheckpointEvaluationV1::Commit {
            checkpoint,
            fence: CloudflareTenantRootRefreshFenceV1::Executed { .. },
            outcome:
                CloudflareTenantRootRefreshInstallationResponseOutcomeV1::WaitingForPeer {
                    role: CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
                },
        } => {
            validate_refresh_installation_checkpoint(
                checkpoint,
                &refresh_checkpoint_scope(
                    &command,
                    &restarted_active,
                    &context,
                    authority(0x71),
                )
                .expect("refresh checkpoint scope"),
                &context,
                &role_keys(),
                &commitments,
                &restarted_active.commitments,
            )
            .expect("recovered installation checkpoint");
        }
        TenantRootRefreshInstallationCheckpointEvaluationV1::Commit { .. } => {
            panic!("terminal D1 recovery must execute the refresh fence")
        }
        TenantRootRefreshInstallationCheckpointEvaluationV1::Replay(_) => {
            panic!("missing checkpoint must commit after terminal D1 recovery")
        }
    }
}

#[test]
fn refresh_installation_checkpoint_replays_persisted_terminal_receipt_after_restart() {
    const FRESH_NOW_MS: u64 = 1_000_100;
    const EXPIRED_NOW_MS: u64 = 1_030_001;
    let mut active = validated_active_refresh_state();
    let context = refresh_context(&active);
    let commitments = refresh_commitment_pair(&context);
    let command = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverA);
    let command_b = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverB);
    active.record.fence = CloudflareTenantRootRefreshFenceV1::Reserved {
        attempt: refresh_attempt_from_commands(&context, &command, &command_b)
            .expect("refresh attempt"),
    };
    let evidence =
        refresh_installation_wire(&context, TwoPartyDeriverRole::DeriverA, 30, 55, 0x72);
    let terminal_receipt = refresh_installation_terminal_receipt(&command, &evidence);
    let first = evaluate_refresh_installation_checkpoint(
        None,
        evidence.canonical_bytes(),
        &command,
        &active,
        &context,
        &role_keys(),
        &commitments,
        authority(0x71),
        &terminal_receipt,
        FRESH_NOW_MS,
    )
    .expect("first installation checkpoint");
    let (checkpoint, executed_fence) = match first {
        TenantRootRefreshInstallationCheckpointEvaluationV1::Commit {
            checkpoint,
            fence: executed_fence,
            ..
        } => (checkpoint, executed_fence),
        TenantRootRefreshInstallationCheckpointEvaluationV1::Replay(_) => {
            panic!("first installation must commit")
        }
    };

    active.record.fence = executed_fence;
    let persisted_record = serde_json::from_slice(
        &serde_json::to_vec(&active.record).expect("persisted refresh active state"),
    )
    .expect("decode persisted refresh active state");
    let mut restarted_active = validated_active_refresh_state();
    restarted_active.record = persisted_record;

    assert!(matches!(
        evaluate_refresh_installation_checkpoint(
            Some(checkpoint),
            evidence.canonical_bytes(),
            &command,
            &restarted_active,
            &context,
            &role_keys(),
            &commitments,
            authority(0x71),
            &terminal_receipt,
            EXPIRED_NOW_MS,
        )
        .expect("exact retry after expiry"),
        TenantRootRefreshInstallationCheckpointEvaluationV1::Replay(
            CloudflareTenantRootRefreshInstallationResponseOutcomeV1::WaitingForPeer {
                role: CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
            }
        )
    ));
}

#[test]
fn refresh_installation_checkpoint_rejects_mismatched_terminal_receipt_context() {
    let mut active = validated_active_refresh_state();
    let context = refresh_context(&active);
    let commitments = refresh_commitment_pair(&context);
    let command = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverA);
    let command_b = refresh_command(&active, &context, TwoPartyDeriverRole::DeriverB);
    active.record.fence = CloudflareTenantRootRefreshFenceV1::Reserved {
        attempt: refresh_attempt_from_commands(&context, &command, &command_b)
            .expect("refresh attempt"),
    };
    let evidence =
        refresh_installation_wire(&context, TwoPartyDeriverRole::DeriverA, 30, 55, 0x73);
    let foreign_context = TenantRootCeremonyContextV1::new(
        context.identity_digest(),
        context.custody_lineage(),
        context.epochs().clone(),
        TenantRootCeremonySessionIdV1::from_bytes([0x62; 16]).expect("foreign session"),
        context.nonce(),
        context.issued_at_ms(),
        context.expires_at_ms(),
        context.signing_key_id(TwoPartyDeriverRole::DeriverA),
        context.signing_key_id(TwoPartyDeriverRole::DeriverB),
    )
    .expect("foreign context");
    let foreign_command =
        refresh_command(&active, &foreign_context, TwoPartyDeriverRole::DeriverA);
    let foreign_evidence = refresh_installation_wire(
        &foreign_context,
        TwoPartyDeriverRole::DeriverA,
        30,
        55,
        0x74,
    );
    let foreign_receipt =
        refresh_installation_terminal_receipt(&foreign_command, &foreign_evidence);

    let error = evaluate_refresh_installation_checkpoint(
        None,
        evidence.canonical_bytes(),
        &command,
        &active,
        &context,
        &role_keys(),
        &commitments,
        authority(0x71),
        &foreign_receipt,
        1_030_001,
    )
    .err()
    .expect("foreign terminal receipt must fail closed");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::ForbiddenLocalBinding
    );
}

pub(super) fn creation_commitment_wire(
    journal: &ValidatedTenantRootCreationJournalV1,
    role: TwoPartyDeriverRole,
    share_scalar: u64,
) -> Vec<u8> {
    let key = role_signing_key(role).to_bytes();
    creation_commitment_wire_with_key(journal, role, share_scalar, &key)
}

pub(super) fn creation_commitment_wire_with_key(
    journal: &ValidatedTenantRootCreationJournalV1,
    role: TwoPartyDeriverRole,
    share_scalar: u64,
    signing_key_bytes: &[u8; 32],
) -> Vec<u8> {
    let share = SigningRootShare::from_canonical_bytes(
        role.share_id(),
        Scalar::from(share_scalar).to_bytes(),
    )
    .expect("share");
    let transcript = TenantRootCreationCommitmentTranscriptV1::new(
        journal.ceremony_context.clone(),
        role,
        SigningRootShareCommitment::from_share(&share),
    )
    .expect("creation commitment transcript");
    TenantRootSignedCreationCommitmentV1::sign(transcript, signing_key_bytes)
        .expect("signed creation commitment")
        .canonical_bytes()
        .expect("creation commitment bytes")
}

pub(super) fn role_creation_command(
    journal: &ValidatedTenantRootCreationJournalV1,
    role: TwoPartyDeriverRole,
) -> VerifiedTenantRootRoleCreationCommandV1 {
    let command = TenantRootRoleCreationCommandV1::sign(
        &journal.journal,
        &journal.ceremony_context,
        role,
        authority(0x44),
        1_000_000,
        1_030_000,
        ISSUER_KEY_ID,
        &SIGNING_KEY_BYTES,
    )
    .expect("role creation command");
    let bytes = command.canonical_bytes().expect("role command bytes");
    let command = TenantRootRoleCreationCommandV1::decode_canonical_bytes(&bytes)
        .expect("decoded role command");
    command
        .verify(
            &journal.journal,
            &journal.ceremony_context,
            role,
            authority(0x44),
            ISSUER_KEY_ID,
            &verifying_key(),
        )
        .expect("verified role command")
}

pub(super) fn publish_creation_commitment_pair(
    journal: &ValidatedTenantRootCreationJournalV1,
    now_ms: u64,
) -> (
    CloudflareTenantRootCreationCommitmentRendezvousRecordV1,
    VerifiedTenantRootCreationCommitmentPairV1,
) {
    let deriver_a = creation_commitment_wire(journal, TwoPartyDeriverRole::DeriverA, 12);
    let deriver_a_command = role_creation_command(journal, TwoPartyDeriverRole::DeriverA);
    let first = evaluate_creation_commitment_rendezvous(
        None,
        &deriver_a,
        &deriver_a_command,
        journal,
        &role_keys(),
        now_ms,
    )
    .expect("first creation commitment");
    let first_record = match first {
        TenantRootCreationCommitmentRendezvousEvaluationV1::Commit { rendezvous, .. } => {
            rendezvous
        }
        other => panic!("unexpected first commitment outcome: {other:?}"),
    };
    let deriver_b = creation_commitment_wire(journal, TwoPartyDeriverRole::DeriverB, 19);
    let deriver_b_command = role_creation_command(journal, TwoPartyDeriverRole::DeriverB);
    let second = evaluate_creation_commitment_rendezvous(
        Some(first_record),
        &deriver_b,
        &deriver_b_command,
        journal,
        &role_keys(),
        now_ms,
    )
    .expect("second creation commitment");
    match second {
        TenantRootCreationCommitmentRendezvousEvaluationV1::Commit {
            rendezvous,
            outcome:
                CloudflareTenantRootCreationCommitmentOutcomeV1::BothRolesCommitted { pair },
        } => (rendezvous, pair),
        other => panic!("unexpected completed commitment outcome: {other:?}"),
    }
}

pub(super) fn installation_wire(
    journal: &ValidatedTenantRootCreationJournalV1,
    role: TwoPartyDeriverRole,
    share_scalar: u64,
    peer_scalar: u64,
    proof_seed: u8,
) -> VerifiedTenantRootSignedShareInstallationEvidenceWireV1 {
    let share = SigningRootShare::from_canonical_bytes(
        role.share_id(),
        Scalar::from(share_scalar).to_bytes(),
    )
    .expect("share");
    let peer = SigningRootShare::from_canonical_bytes(
        role.peer().share_id(),
        Scalar::from(peer_scalar).to_bytes(),
    )
    .expect("peer share");
    let transcript = TenantRootShareInstallationTranscriptV1::new(
        journal.ceremony_context.clone(),
        role,
        SigningRootShareCommitment::from_share(&share),
        SigningRootShareCommitment::from_share(&peer),
    )
    .expect("transcript");
    let proof = prove_root_share_knowledge(
        &share,
        &transcript.canonical_bytes().expect("transcript bytes"),
        &mut ChaCha20Rng::from_seed([proof_seed; 32]),
    )
    .expect("proof");
    let signed = TenantRootSignedShareInstallationEvidenceV1::sign(
        TenantRootShareInstallationEvidenceV1::new(transcript, proof).expect("evidence"),
        &role_signing_key(role).to_bytes(),
    )
    .expect("signed evidence");
    let bytes = signed.canonical_bytes().expect("signed bytes");
    TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        &bytes,
        role_keys()
            .for_role_and_key_id(role, journal.ceremony_context.signing_key_id(role))
            .expect("role key"),
    )
    .expect("verified wire")
}

pub(super) fn creation_commitments_from_installation(
    deriver_a: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    deriver_b: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
) -> TenantRootEpochCommitmentsV1 {
    TenantRootEpochCommitmentsV1::new(
        MpcPrfShareCommitmentWireV1::new(
            deriver_a
                .evidence()
                .transcript()
                .commitment()
                .to_bytes()
                .to_vec(),
        )
        .expect("creation Deriver A commitment"),
        MpcPrfShareCommitmentWireV1::new(
            deriver_b
                .evidence()
                .transcript()
                .commitment()
                .to_bytes()
                .to_vec(),
        )
        .expect("creation Deriver B commitment"),
    )
    .expect("creation commitments")
}

pub(super) fn creation_provider_canary(
    context: &TenantRootCeremonyContextV1,
    commitments: &TenantRootEpochCommitmentsV1,
    family: TenantRootCanaryCurveFamilyV1,
) -> router_ab_core::VerifiedTenantRootProviderCanaryReceiptV1 {
    let binding = TenantRootProviderCanaryReceiptBindingV1::new(
        context.identity_digest(),
        context.custody_lineage(),
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        commitments.clone(),
        family,
        format!("kms/tenant-root/{}/canary-v1", family.as_str()),
        1_000_110,
        authority(0x72),
        "control-plane-canary-v1",
        context.issued_at_ms(),
        context.expires_at_ms(),
    )
    .expect("creation canary binding");
    let signing_key = SigningKey::from_bytes(&[0x72; 32]);
    let signed =
        TenantRootSignedProviderCanaryReceiptV1::sign(binding.clone(), &signing_key.to_bytes())
            .expect("signed creation canary");
    signed
        .verify(&binding, &signing_key.verifying_key().to_bytes())
        .expect("verified creation canary")
}

pub(super) fn deriver_b_installation_checkpoint(
    journal: &ValidatedTenantRootCreationJournalV1,
    now_ms: u64,
) -> (
    CloudflareTenantRootCreationInstallationCheckpointV1,
    VerifiedTenantRootCreationCommitmentPairV1,
) {
    let (_, commitments) = publish_creation_commitment_pair(journal, now_ms);
    let command = role_creation_command(journal, TwoPartyDeriverRole::DeriverB);
    let evaluated = evaluate_installation_checkpoint(
        None,
        installation_wire(journal, TwoPartyDeriverRole::DeriverB, 19, 12, 0x62),
        &command,
        journal,
        &role_keys(),
        &commitments,
        now_ms,
    )
    .expect("Deriver B installation checkpoint");
    let TenantRootCreationInstallationEvaluationV1::Commit { checkpoint, .. } = evaluated
    else {
        panic!("fresh Deriver B installation must commit");
    };
    (checkpoint, commitments)
}

pub(super) fn abandonment_fixture(
    journal: &ValidatedTenantRootCreationJournalV1,
    installed_roles: Vec<CloudflareTenantRootCreationInstallationRoleV1>,
) -> CloudflareTenantRootCreationAbandonmentV1 {
    CloudflareTenantRootCreationAbandonmentV1 {
        journal_digest_b64u: encode_base64url_bytes_v1(journal.journal_digest.as_bytes()),
        identity_digest_b64u: encode_base64url_bytes_v1(journal.identity_digest.as_bytes()),
        custody_lineage_b64u: journal.custody_lineage.to_base64url(),
        ceremony_context_digest_b64u: encode_base64url_bytes_v1(
            journal
                .ceremony_context
                .digest()
                .expect("ceremony context digest")
                .as_bytes(),
        ),
        installed_roles,
        abandoned_at_ms: 1_000_001,
    }
}

pub(super) fn cleanup_checkpoint_fixture(
    journal: &ValidatedTenantRootCreationJournalV1,
    abandonment: &CloudflareTenantRootCreationAbandonmentV1,
    installation: &ValidatedTenantRootCreationInstallationCheckpointV1,
    cleanup_nonce_seed: u8,
    receipt_signer: TwoPartyDeriverRole,
    replacement_payload: Option<&[u8]>,
) -> CloudflareTenantRootCreationCleanupCheckpointV1 {
    let ValidatedTenantRootCreationInstallationStateV1::OneRoleReady {
        role: installed, ..
    } = &installation.state
    else {
        panic!("the cleanup fixture cleans the one installed role");
    };
    let (target, role) = creation_cleanup_target(
        journal,
        abandonment,
        Some(installation),
        CloudflareTenantRootCreationInstallationRoleV1::from_protocol(*installed),
    )
    .expect("cleanup target");
    let cleanup_nonce =
        TenantRootCeremonyNonceV1::from_bytes([cleanup_nonce_seed; 32]).expect("cleanup nonce");
    let command = TenantRootRoleCleanupCommandV1::sign(
        &target,
        authority(0x44),
        cleanup_nonce,
        1_000_001,
        1_030_000,
        ISSUER_KEY_ID,
        &SIGNING_KEY_BYTES,
    )
    .expect("cleanup command");
    let command_bytes = command.canonical_bytes().expect("cleanup command bytes");
    let replay_session = TenantRootCeremonySessionIdV1::from_bytes(
        cleanup_nonce.as_bytes()[..16]
            .try_into()
            .expect("sixteen cleanup nonce bytes"),
    )
    .expect("cleanup replay session");
    let replay_key = TenantRootCommandReplayKeyV1::new(
        journal.identity_digest,
        journal.custody_lineage,
        replay_session,
        cleanup_nonce,
        target.role(),
    );
    let payload = replacement_payload.unwrap_or(&command_bytes);
    let receipt = TenantRootCommandTerminalReceiptV1::sign_success(
        replay_key,
        TenantRootProtocolDigestV1::from_bytes([0xd1; 32]).expect("command digest"),
        payload.to_vec(),
        1_010_000,
        journal.ceremony_context.signing_key_id(target.role()),
        &role_signing_key(receipt_signer).to_bytes(),
    )
    .expect("cleanup receipt");
    creation_cleanup_checkpoint_record(
        CloudflareTenantRootCreationCleanupRequestV1 {
            cleanup_command_b64u: encode_base64url_bytes_v1(&command_bytes),
            cleanup_receipt_b64u: encode_base64url_bytes_v1(
                &receipt.canonical_bytes().expect("cleanup receipt bytes"),
            ),
        },
        journal,
        role,
    )
    .expect("cleanup checkpoint record")
}
