//! Restore-refresh checkpoint and destination bootstrap tests, with their fixtures.

use super::*;

pub(super) const ISSUER_KEY_ID: &str = "tenant-root-creation-issuer-v1";

pub(super) const SIGNING_KEY_BYTES: [u8; 32] = [0x71; 32];

pub(super) const DERIVER_A_SIGNING_KEY_BYTES: [u8; 32] = [0xa1; 32];

pub(super) const DERIVER_B_SIGNING_KEY_BYTES: [u8; 32] = [0xb1; 32];

pub(super) struct RestoreRefreshCheckpointFixture {
    pub(super) grant_b64u: String,
    pub(super) manifest_b64u: String,
    pub(super) commands: CloudflareTenantRootRestoreRefreshCommandsV1,
    pub(super) alternate_commands: CloudflareTenantRootRestoreRefreshCommandsV1,
}

pub(super) fn restore_refresh_checkpoint_fixture() -> RestoreRefreshCheckpointFixture {
    let identity =
        TenantRootIdentityV1::new("org-1", "project-2", "production", "root-main", "v3")
            .expect("restore identity");
    let identity_digest = identity.digest().expect("restore identity digest");
    let custody_lineage =
        TenantRootCustodyLineageId::from_bytes([0x83; 16]).expect("restore custody lineage");
    let destination_fingerprint =
        TenantRootRestoreDestinationFingerprintV1::from_bytes([0x82; 32])
            .expect("restore destination fingerprint");
    let restore_session_id =
        TenantRootRestoreSessionIdV1::from_bytes([0x84; 16]).expect("restore session");
    let manifest = TenantRootRecoveryManifestV1::from_canonical_json(include_bytes!(
        "../../../../../router-ab-core/tests/fixtures/tenant-root-recovery/manifest.json"
    ))
    .expect("restore manifest");
    let manifest_digest = manifest.digest().expect("restore manifest digest");
    let grant = TenantRootRestoreRefreshGrantV1::sign(
        TenantRootProtocolDigestV1::from_bytes([0x81; 32]).expect("restore operation digest"),
        identity_digest,
        destination_fingerprint,
        custody_lineage,
        TenantRootRestoreSessionIdV1::from_bytes([0x84; 16]).expect("restore session"),
        manifest_digest,
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x85; 32])
            .expect("Deriver A acceptance receipt"),
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x86; 32])
            .expect("Deriver B acceptance receipt"),
        TenantRootRestoreAuthorizationNonceV1::from_bytes([0x87; 32])
            .expect("restore authorization nonce"),
        1_000_000,
        1_030_000,
        ISSUER_KEY_ID,
        &SIGNING_KEY_BYTES,
    )
    .expect("restore refresh grant");
    let ceremony_session_id =
        TenantRootCeremonySessionIdV1::from_bytes([0x90; 16]).expect("ceremony session");
    let imported_a = restore_refresh_checkpoint_commitment(TwoPartyDeriverRole::DeriverA, 11);
    let imported_b = restore_refresh_checkpoint_commitment(TwoPartyDeriverRole::DeriverB, 19);
    let imported_pair =
        TenantRootEpochCommitmentsV1::new(imported_a.clone(), imported_b.clone())
            .expect("restore imported commitment pair");
    let context_nonce = tenant_root_restore_refresh_context_nonce_v1(
        identity_digest,
        custody_lineage,
        ceremony_session_id,
        destination_fingerprint,
        restore_session_id,
        manifest_digest,
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x85; 32])
            .expect("Deriver A acceptance receipt"),
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x86; 32])
            .expect("Deriver B acceptance receipt"),
        &imported_a,
        &imported_b,
        *imported_pair.root_commitment(),
    )
    .expect("restore context nonce");
    let context = TenantRootCeremonyContextV1::new(
        identity_digest,
        custody_lineage,
        TenantRootCeremonyEpochsV1::create(),
        ceremony_session_id,
        context_nonce,
        1_000_000,
        1_030_000,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("restore context");
    let commands = restore_refresh_checkpoint_commands(
        &context,
        destination_fingerprint,
        restore_session_id,
        manifest_digest,
        imported_a.clone(),
        imported_b.clone(),
    );
    let alternate_imported_b =
        restore_refresh_checkpoint_commitment(TwoPartyDeriverRole::DeriverB, 23);
    let alternate_pair =
        TenantRootEpochCommitmentsV1::new(imported_a.clone(), alternate_imported_b.clone())
            .expect("alternate restore imported commitment pair");
    let alternate_context_nonce = tenant_root_restore_refresh_context_nonce_v1(
        identity_digest,
        custody_lineage,
        ceremony_session_id,
        destination_fingerprint,
        restore_session_id,
        manifest_digest,
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x85; 32])
            .expect("Deriver A acceptance receipt"),
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x86; 32])
            .expect("Deriver B acceptance receipt"),
        &imported_a,
        &alternate_imported_b,
        *alternate_pair.root_commitment(),
    )
    .expect("alternate restore context nonce");
    let alternate_context = TenantRootCeremonyContextV1::new(
        identity_digest,
        custody_lineage,
        TenantRootCeremonyEpochsV1::create(),
        ceremony_session_id,
        alternate_context_nonce,
        1_000_000,
        1_030_000,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("alternate restore context");
    let alternate_commands = restore_refresh_checkpoint_commands(
        &alternate_context,
        destination_fingerprint,
        restore_session_id,
        manifest_digest,
        imported_a,
        alternate_imported_b,
    );
    let alternate_context_b64u = encode_base64url_bytes_v1(
        &alternate_context
            .canonical_bytes()
            .expect("alternate restore context bytes"),
    );
    let manifest_b64u =
        encode_base64url_bytes_v1(&manifest.canonical_bytes().expect("restore manifest bytes"));
    RestoreRefreshCheckpointFixture {
        grant_b64u: encode_base64url_bytes_v1(
            &grant.canonical_bytes().expect("restore grant bytes"),
        ),
        manifest_b64u,
        commands,
        alternate_commands: CloudflareTenantRootRestoreRefreshCommandsV1 {
            refresh_context_b64u: alternate_context_b64u,
            deriver_a_refresh_command_b64u: alternate_commands.deriver_a_refresh_command_b64u,
            deriver_b_refresh_command_b64u: alternate_commands.deriver_b_refresh_command_b64u,
            issuer_key_id: ISSUER_KEY_ID.to_owned(),
        },
    }
}

pub(super) fn restore_refresh_checkpoint_commands(
    context: &TenantRootCeremonyContextV1,
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    restore_session_id: TenantRootRestoreSessionIdV1,
    manifest_digest: [u8; 32],
    deriver_a_imported_commitment: MpcPrfShareCommitmentWireV1,
    deriver_b_imported_commitment: MpcPrfShareCommitmentWireV1,
) -> CloudflareTenantRootRestoreRefreshCommandsV1 {
    let imported_pair = TenantRootEpochCommitmentsV1::new(
        deriver_a_imported_commitment.clone(),
        deriver_b_imported_commitment.clone(),
    )
    .expect("restore command commitment pair");
    let stable_root_commitment = *imported_pair.root_commitment();
    let context_b64u = encode_base64url_bytes_v1(
        &context
            .canonical_bytes()
            .expect("restore command context bytes"),
    );
    CloudflareTenantRootRestoreRefreshCommandsV1 {
        refresh_context_b64u: context_b64u.clone(),
        deriver_a_refresh_command_b64u: restore_refresh_checkpoint_command(
            context,
            destination_fingerprint,
            restore_session_id,
            manifest_digest,
            deriver_a_imported_commitment.clone(),
            deriver_b_imported_commitment.clone(),
            stable_root_commitment,
            TwoPartyDeriverRole::DeriverA,
        ),
        deriver_b_refresh_command_b64u: restore_refresh_checkpoint_command(
            context,
            destination_fingerprint,
            restore_session_id,
            manifest_digest,
            deriver_a_imported_commitment,
            deriver_b_imported_commitment,
            stable_root_commitment,
            TwoPartyDeriverRole::DeriverB,
        ),
        issuer_key_id: ISSUER_KEY_ID.to_owned(),
    }
}

pub(super) fn restore_refresh_checkpoint_commitment(
    role: TwoPartyDeriverRole,
    scalar: u64,
) -> MpcPrfShareCommitmentWireV1 {
    let share = SigningRootShare::from_canonical_bytes(
        role.share_id(),
        Scalar::from(scalar).to_bytes(),
    )
    .expect("restore imported share");
    MpcPrfShareCommitmentWireV1::new(
        SigningRootShareCommitment::from_share(&share)
            .to_bytes()
            .to_vec(),
    )
    .expect("restore imported commitment")
}

pub(super) fn restore_refresh_checkpoint_command(
    context: &TenantRootCeremonyContextV1,
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    restore_session_id: TenantRootRestoreSessionIdV1,
    manifest_digest: [u8; 32],
    deriver_a_imported_commitment: MpcPrfShareCommitmentWireV1,
    deriver_b_imported_commitment: MpcPrfShareCommitmentWireV1,
    stable_root_commitment: [u8; 32],
    role: TwoPartyDeriverRole,
) -> String {
    let command = TenantRootRestoreRefreshRoleCommandV1::sign(
        context,
        destination_fingerprint,
        restore_session_id,
        manifest_digest,
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x85; 32])
            .expect("Deriver A acceptance receipt"),
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x86; 32])
            .expect("Deriver B acceptance receipt"),
        deriver_a_imported_commitment,
        deriver_b_imported_commitment,
        stable_root_commitment,
        role,
        ISSUER_KEY_ID,
        &SIGNING_KEY_BYTES,
    )
    .expect("restore role command");
    encode_base64url_bytes_v1(&command.canonical_bytes().expect("restore command bytes"))
}

pub(super) fn restore_refresh_checkpoint_admit_request(
    fixture: &RestoreRefreshCheckpointFixture,
) -> CloudflareTenantRootRestoreRefreshCheckpointRequestV1 {
    CloudflareTenantRootRestoreRefreshCheckpointRequestV1::Admit {
        restore_refresh_grant_b64u: fixture.grant_b64u.clone(),
        manifest_b64u: fixture.manifest_b64u.clone(),
    }
}

pub(super) fn restore_refresh_checkpoint_commands_request(
    fixture: &RestoreRefreshCheckpointFixture,
    commands: CloudflareTenantRootRestoreRefreshCommandsV1,
) -> CloudflareTenantRootRestoreRefreshCheckpointRequestV1 {
    CloudflareTenantRootRestoreRefreshCheckpointRequestV1::PersistCommands {
        restore_refresh_grant_b64u: fixture.grant_b64u.clone(),
        manifest_b64u: fixture.manifest_b64u.clone(),
        commands,
    }
}

pub(super) fn restore_refresh_checkpoint_commitment_b64u(
    role: TwoPartyDeriverRole,
    scalar: u64,
) -> String {
    encode_base64url_bytes_v1(
        &restore_refresh_checkpoint_commitment(role, scalar)
            .as_bytes()
            .to_vec(),
    )
}

pub(super) fn restore_refresh_checkpoint_commit_prepared_request(
    fixture: &RestoreRefreshCheckpointFixture,
    deriver_a_commitment_b64u: String,
    deriver_b_commitment_b64u: String,
) -> CloudflareTenantRootRestoreRefreshCheckpointRequestV1 {
    CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitPrepared {
        restore_refresh_grant_b64u: fixture.grant_b64u.clone(),
        deriver_a_commitment_b64u,
        deriver_b_commitment_b64u,
    }
}

pub(super) fn restore_refresh_checkpoint_commit_contributed_request(
    fixture: &RestoreRefreshCheckpointFixture,
    deriver_a_commitment_b64u: String,
    deriver_b_commitment_b64u: String,
    deriver_a_contribution_b64u: String,
    deriver_b_contribution_b64u: String,
) -> CloudflareTenantRootRestoreRefreshCheckpointRequestV1 {
    CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitContributed {
        restore_refresh_grant_b64u: fixture.grant_b64u.clone(),
        deriver_a_commitment_b64u,
        deriver_b_commitment_b64u,
        deriver_a_contribution_b64u,
        deriver_b_contribution_b64u,
    }
}

pub(super) fn restore_refresh_checkpoint_commit_completed_request(
    fixture: &RestoreRefreshCheckpointFixture,
    deriver_a_commitment_b64u: String,
    deriver_b_commitment_b64u: String,
    deriver_a_contribution_b64u: String,
    deriver_b_contribution_b64u: String,
) -> CloudflareTenantRootRestoreRefreshCheckpointRequestV1 {
    CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitCompleted {
        restore_refresh_grant_b64u: fixture.grant_b64u.clone(),
        deriver_a_commitment_b64u,
        deriver_b_commitment_b64u,
        deriver_a_contribution_b64u,
        deriver_b_contribution_b64u,
        deriver_a_evidence_b64u: encode_base64url_bytes_v1(&[0xb1; 64]),
        deriver_b_evidence_b64u: encode_base64url_bytes_v1(&[0xb2; 64]),
        deriver_a_evidence_digest_b64u: encode_base64url_bytes_v1(&[0xc1; 32]),
        deriver_b_evidence_digest_b64u: encode_base64url_bytes_v1(&[0xc2; 32]),
    }
}

pub(super) fn restore_refresh_checkpoint_committed(
    current: Option<&CloudflareTenantRootRestoreRefreshCheckpointV1>,
    request: CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
    now_ms: u64,
) -> CloudflareTenantRootRestoreRefreshCheckpointV1 {
    match evaluate_tenant_root_restore_refresh_checkpoint_v1(current, request, now_ms)
        .expect("restore checkpoint evaluation")
    {
        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Commit { checkpoint } => {
            checkpoint
        }
        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay { .. }
        | CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::AuthorizationExpiredBeforeCommands {
            ..
        } => panic!("expected a durable checkpoint commit"),
    }
}

pub(super) fn restore_refresh_checkpoint_completed_fixture() -> (
    RestoreRefreshCheckpointFixture,
    CloudflareTenantRootRestoreRefreshCheckpointV1,
) {
    let fixture = restore_refresh_checkpoint_fixture();
    let admitted = restore_refresh_checkpoint_committed(
        None,
        restore_refresh_checkpoint_admit_request(&fixture),
        1_000_001,
    );
    let commands_persisted = restore_refresh_checkpoint_committed(
        Some(&admitted),
        restore_refresh_checkpoint_commands_request(&fixture, fixture.commands.clone()),
        1_000_002,
    );
    let commitment_a =
        restore_refresh_checkpoint_commitment_b64u(TwoPartyDeriverRole::DeriverA, 31);
    let commitment_b =
        restore_refresh_checkpoint_commitment_b64u(TwoPartyDeriverRole::DeriverB, 37);
    let prepared = restore_refresh_checkpoint_committed(
        Some(&commands_persisted),
        restore_refresh_checkpoint_commit_prepared_request(
            &fixture,
            commitment_a.clone(),
            commitment_b.clone(),
        ),
        1_000_003,
    );
    let contributed = restore_refresh_checkpoint_committed(
        Some(&prepared),
        restore_refresh_checkpoint_commit_contributed_request(
            &fixture,
            commitment_a.clone(),
            commitment_b.clone(),
            encode_base64url_bytes_v1(&[0xa1; 64]),
            encode_base64url_bytes_v1(&[0xa2; 64]),
        ),
        1_000_004,
    );
    let completed = restore_refresh_checkpoint_committed(
        Some(&contributed),
        restore_refresh_checkpoint_commit_completed_request(
            &fixture,
            commitment_a,
            commitment_b,
            encode_base64url_bytes_v1(&[0xa1; 64]),
            encode_base64url_bytes_v1(&[0xa2; 64]),
        ),
        1_000_005,
    );
    (fixture, completed)
}

pub(super) fn restore_refresh_checkpoint_installation_wire(
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
    .expect("restore refresh share");
    let peer = SigningRootShare::from_canonical_bytes(
        role.peer().share_id(),
        Scalar::from(peer_scalar).to_bytes(),
    )
    .expect("restore refresh peer share");
    let transcript = TenantRootShareInstallationTranscriptV1::new(
        context.clone(),
        role,
        SigningRootShareCommitment::from_share(&share),
        SigningRootShareCommitment::from_share(&peer),
    )
    .expect("restore refresh installation transcript");
    let proof = prove_root_share_knowledge(
        &share,
        &transcript
            .canonical_bytes()
            .expect("restore refresh installation transcript bytes"),
        &mut ChaCha20Rng::from_seed([proof_seed; 32]),
    )
    .expect("restore refresh installation proof");
    let signed = TenantRootSignedShareInstallationEvidenceV1::sign(
        TenantRootShareInstallationEvidenceV1::new(transcript, proof)
            .expect("restore refresh installation evidence"),
        &role_signing_key(role).to_bytes(),
    )
    .expect("restore refresh signed installation evidence");
    let bytes = signed
        .canonical_bytes()
        .expect("restore refresh signed installation bytes");
    TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        &bytes,
        role_keys()
            .for_role_and_key_id(role, context.signing_key_id(role))
            .expect("restore refresh installation verifying key"),
    )
    .expect("restore refresh verified installation evidence")
}

pub(super) fn restore_refresh_checkpoint_promotion(
    fixture: &RestoreRefreshCheckpointFixture,
    context: &TenantRootCeremonyContextV1,
    commitments: &TenantRootEpochCommitmentsV1,
    role: TwoPartyDeriverRole,
    share_scalar: u64,
    peer_scalar: u64,
    proof_seed: u8,
    canary_family: TenantRootCanaryCurveFamilyV1,
) -> CloudflareTenantRootRestoreRefreshRolePromotionV1 {
    let installation = restore_refresh_checkpoint_installation_wire(
        context,
        role,
        share_scalar,
        peer_scalar,
        proof_seed,
    );
    let installation_bytes = installation.canonical_bytes().to_vec();
    let installation_evidence_b64u = encode_base64url_bytes_v1(&installation_bytes);
    let canary = creation_provider_canary(context, commitments, canary_family);
    let canary_bytes = canary.canonical_bytes().to_vec();
    let canary_b64u = encode_base64url_bytes_v1(&canary_bytes);
    let command_b64u = match role {
        TwoPartyDeriverRole::DeriverA => {
            fixture.commands.deriver_a_refresh_command_b64u.clone()
        }
        TwoPartyDeriverRole::DeriverB => {
            fixture.commands.deriver_b_refresh_command_b64u.clone()
        }
    };
    let command_bytes =
        decode_base64url_bytes_v1("restore refresh promotion command", &command_b64u)
            .expect("restore refresh promotion command bytes");
    CloudflareTenantRootRestoreRefreshRolePromotionV1 {
        role: match role {
            TwoPartyDeriverRole::DeriverA => {
                CloudflareTenantRootCreationInstallationRoleV1::DeriverA
            }
            TwoPartyDeriverRole::DeriverB => {
                CloudflareTenantRootCreationInstallationRoleV1::DeriverB
            }
        },
        restore_refresh_role_command_b64u: command_b64u,
        command_digest_b64u: encode_base64url_bytes_v1(&Sha256::digest(&command_bytes)),
        signed_installation_evidence_b64u: installation_evidence_b64u,
        installation_evidence_digest_b64u: encode_base64url_bytes_v1(&Sha256::digest(
            &installation_bytes,
        )),
        provider_canary_receipt_b64u: canary_b64u,
        provider_canary_receipt_digest_b64u: encode_base64url_bytes_v1(&Sha256::digest(
            &canary_bytes,
        )),
        completed_at_ms: 1_000_110,
    }
}

pub(super) fn restore_refresh_checkpoint_completed_with_promotion_inputs() -> (
    RestoreRefreshCheckpointFixture,
    CloudflareTenantRootRestoreRefreshCheckpointV1,
    CloudflareTenantRootRestoreRefreshRolePromotionV1,
    CloudflareTenantRootRestoreRefreshRolePromotionV1,
) {
    let (fixture, mut completed) = restore_refresh_checkpoint_completed_fixture();
    let context_bytes = decode_base64url_bytes_v1(
        "restore refresh promotion context",
        &fixture.commands.refresh_context_b64u,
    )
    .expect("restore refresh promotion context bytes");
    let context = TenantRootCeremonyContextV1::decode_canonical_bytes(&context_bytes)
        .expect("restore refresh promotion context");
    let commitments = TenantRootEpochCommitmentsV1::new(
        restore_refresh_checkpoint_commitment(TwoPartyDeriverRole::DeriverA, 11),
        restore_refresh_checkpoint_commitment(TwoPartyDeriverRole::DeriverB, 19),
    )
    .expect("restore refresh promotion commitments");
    let deriver_a_promotion = restore_refresh_checkpoint_promotion(
        &fixture,
        &context,
        &commitments,
        TwoPartyDeriverRole::DeriverA,
        11,
        19,
        0xa1,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
    );
    let deriver_b_promotion = restore_refresh_checkpoint_promotion(
        &fixture,
        &context,
        &commitments,
        TwoPartyDeriverRole::DeriverB,
        19,
        11,
        0xb1,
        TenantRootCanaryCurveFamilyV1::Ed25519,
    );
    let CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
        commands,
        deriver_a_commitment_b64u,
        deriver_b_commitment_b64u,
        deriver_a_contribution_b64u,
        deriver_b_contribution_b64u,
        ..
    } = &completed.state
    else {
        panic!("expected completed restore refresh checkpoint");
    };
    completed.state = CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
        commands: commands.clone(),
        deriver_a_commitment_b64u: deriver_a_commitment_b64u.clone(),
        deriver_b_commitment_b64u: deriver_b_commitment_b64u.clone(),
        deriver_a_contribution_b64u: deriver_a_contribution_b64u.clone(),
        deriver_b_contribution_b64u: deriver_b_contribution_b64u.clone(),
        deriver_a_evidence_b64u: deriver_a_promotion
            .signed_installation_evidence_b64u
            .clone(),
        deriver_b_evidence_b64u: deriver_b_promotion
            .signed_installation_evidence_b64u
            .clone(),
        deriver_a_evidence_digest_b64u: deriver_a_promotion
            .installation_evidence_digest_b64u
            .clone(),
        deriver_b_evidence_digest_b64u: deriver_b_promotion
            .installation_evidence_digest_b64u
            .clone(),
    };
    validate_restore_refresh_checkpoint_record_v1(&completed)
        .expect("restore refresh completed promotion inputs");
    (fixture, completed, deriver_a_promotion, deriver_b_promotion)
}

pub(super) fn restore_refresh_checkpoint_commit_promoted_request(
    fixture: &RestoreRefreshCheckpointFixture,
    deriver_a_promotion: CloudflareTenantRootRestoreRefreshRolePromotionV1,
    deriver_b_promotion: CloudflareTenantRootRestoreRefreshRolePromotionV1,
) -> CloudflareTenantRootRestoreRefreshCheckpointRequestV1 {
    CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitPromoted {
        restore_refresh_grant_b64u: fixture.grant_b64u.clone(),
        deriver_a_promotion,
        deriver_b_promotion,
    }
}

#[test]
fn restore_refresh_checkpoint_promotes_exact_artifacts_and_reconciles_after_expiry() {
    let (fixture, completed, deriver_a_promotion, deriver_b_promotion) =
        restore_refresh_checkpoint_completed_with_promotion_inputs();
    let request = restore_refresh_checkpoint_commit_promoted_request(
        &fixture,
        deriver_a_promotion.clone(),
        deriver_b_promotion.clone(),
    );
    let promoted =
        restore_refresh_checkpoint_committed(Some(&completed), request.clone(), 1_030_000);
    assert!(matches!(
        promoted.state,
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted { .. }
    ));

    let replay = evaluate_tenant_root_restore_refresh_checkpoint_v1(
        Some(&promoted),
        request.clone(),
        1_030_001,
    )
    .expect("exact promoted replay after expiry");
    assert!(matches!(
        replay,
        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay { checkpoint }
            if checkpoint == promoted
    ));

    let (_, _, scope) = restore_refresh_checkpoint_scope_from_grant_v1(&fixture.grant_b64u)
        .expect("restore refresh scope");
    let authority_id = TenantRootControlPlaneAuthorityIdV1::from_bytes([0xd4; 32]);
    let read = evaluate_restore_refresh_promoted_read_v1(
        &promoted,
        &fixture.grant_b64u,
        &scope,
        authority_id,
        1_030_001,
    )
    .expect("promoted read after expiry");
    assert!(matches!(
        read,
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::PromotedRead {
            authority_id_b64u,
            expected_initial_activation_revision: 2,
            result_initial_activation_revision: 3,
            deriver_a_promotion: a,
            deriver_b_promotion: b,
        } if authority_id_b64u == encode_base64url_bytes_v1(&[0xd4; 32])
            && a == deriver_a_promotion
            && b == deriver_b_promotion
    ));

    let expired_completed = evaluate_restore_refresh_promoted_read_v1(
        &completed,
        &fixture.grant_b64u,
        &scope,
        authority_id,
        1_030_001,
    )
    .expect("expired completed read");
    assert!(matches!(
        expired_completed,
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforePromotion { .. }
    ));
}

#[test]
fn restore_refresh_checkpoint_rejects_swapped_or_changed_promotion_artifacts() {
    let (fixture, completed, deriver_a_promotion, deriver_b_promotion) =
        restore_refresh_checkpoint_completed_with_promotion_inputs();
    let swapped = restore_refresh_checkpoint_commit_promoted_request(
        &fixture,
        deriver_b_promotion.clone(),
        deriver_a_promotion.clone(),
    );
    let error = evaluate_tenant_root_restore_refresh_checkpoint_v1(
        Some(&completed),
        swapped,
        1_000_200,
    )
    .expect_err("swapped promotion roles must conflict");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::ConflictingPair);

    let mut changed_command = deriver_a_promotion.clone();
    changed_command.restore_refresh_role_command_b64u = deriver_b_promotion
        .restore_refresh_role_command_b64u
        .clone();
    let error = evaluate_tenant_root_restore_refresh_checkpoint_v1(
        Some(&completed),
        restore_refresh_checkpoint_commit_promoted_request(
            &fixture,
            changed_command,
            deriver_b_promotion.clone(),
        ),
        1_000_200,
    )
    .expect_err("changed promotion command must conflict");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::ConflictingPair);

    let mut changed_digest = deriver_a_promotion.clone();
    changed_digest.command_digest_b64u = encode_base64url_bytes_v1(&[0xf1; 32]);
    let error = evaluate_tenant_root_restore_refresh_checkpoint_v1(
        Some(&completed),
        restore_refresh_checkpoint_commit_promoted_request(
            &fixture,
            changed_digest,
            deriver_b_promotion.clone(),
        ),
        1_000_200,
    )
    .expect_err("changed promotion digest must conflict");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::ConflictingPair);

    let mut expired_promotion = deriver_a_promotion;
    expired_promotion.completed_at_ms = 1_030_001;
    let error = evaluate_tenant_root_restore_refresh_checkpoint_v1(
        Some(&completed),
        restore_refresh_checkpoint_commit_promoted_request(
            &fixture,
            expired_promotion,
            deriver_b_promotion,
        ),
        1_030_001,
    )
    .expect_err("promotion outside grant must conflict");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::ConflictingPair);
}

#[cfg(feature = "workers-rs")]
pub(super) fn restore_initial_activation_receipt_fixture(
    fixture: &RestoreRefreshCheckpointFixture,
    deriver_a_promotion: &CloudflareTenantRootRestoreRefreshRolePromotionV1,
    deriver_b_promotion: &CloudflareTenantRootRestoreRefreshRolePromotionV1,
) -> router_ab_core::VerifiedTenantRootSignedActivationReceiptV1 {
    let context_bytes = decode_base64url_bytes_v1(
        "restore initial activation context",
        &fixture.commands.refresh_context_b64u,
    )
    .expect("restore initial activation context bytes");
    let context = TenantRootCeremonyContextV1::decode_canonical_bytes(&context_bytes)
        .expect("restore initial activation context");
    let command_a_bytes = decode_base64url_bytes_v1(
        "restore initial activation Deriver A command",
        &deriver_a_promotion.restore_refresh_role_command_b64u,
    )
    .expect("restore initial activation Deriver A command bytes");
    let command_a =
        TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&command_a_bytes)
            .expect("restore initial activation Deriver A command");
    let command_a = command_a
        .verify(ISSUER_KEY_ID, &verifying_key())
        .expect("verified restore initial activation Deriver A command");
    let command_b_bytes = decode_base64url_bytes_v1(
        "restore initial activation Deriver B command",
        &deriver_b_promotion.restore_refresh_role_command_b64u,
    )
    .expect("restore initial activation Deriver B command bytes");
    let command_b =
        TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&command_b_bytes)
            .expect("restore initial activation Deriver B command")
            .verify(ISSUER_KEY_ID, &verifying_key())
            .expect("verified restore initial activation Deriver B command");
    let manifest_bytes = decode_base64url_bytes_v1(
        "restore initial activation manifest",
        &fixture.manifest_b64u,
    )
    .expect("restore initial activation manifest bytes");
    let manifest = TenantRootRecoveryManifestV1::from_canonical_json(&manifest_bytes)
        .expect("restore initial activation manifest");
    let availability =
        router_ab_core::TenantRootActivationAvailabilityEvidenceV1::from_verified_restore(
            &command_a,
            manifest.descriptor().recovery_set_id(),
        )
        .expect("restore initial activation availability");
    let installation_a_bytes = decode_base64url_bytes_v1(
        "restore initial activation Deriver A installation",
        &deriver_a_promotion.signed_installation_evidence_b64u,
    )
    .expect("restore initial activation Deriver A installation bytes");
    let installation_a =
        TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
            &installation_a_bytes,
            role_keys()
                .for_role_and_key_id(
                    TwoPartyDeriverRole::DeriverA,
                    context.signing_key_id(TwoPartyDeriverRole::DeriverA),
                )
                .expect("Deriver A installation key"),
        )
        .expect("verified restore initial activation Deriver A installation");
    let installation_b_bytes = decode_base64url_bytes_v1(
        "restore initial activation Deriver B installation",
        &deriver_b_promotion.signed_installation_evidence_b64u,
    )
    .expect("restore initial activation Deriver B installation bytes");
    let installation_b =
        TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
            &installation_b_bytes,
            role_keys()
                .for_role_and_key_id(
                    TwoPartyDeriverRole::DeriverB,
                    context.signing_key_id(TwoPartyDeriverRole::DeriverB),
                )
                .expect("Deriver B installation key"),
        )
        .expect("verified restore initial activation Deriver B installation");
    let canary_a_bytes = decode_base64url_bytes_v1(
        "restore initial activation Deriver A canary",
        &deriver_a_promotion.provider_canary_receipt_b64u,
    )
    .expect("restore initial activation Deriver A canary bytes");
    let canary_a =
        TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(&canary_a_bytes)
            .expect("restore initial activation Deriver A canary");
    let canary_a = canary_a
        .verify(
            canary_a.binding(),
            &SigningKey::from_bytes(&[0x72; 32])
                .verifying_key()
                .to_bytes(),
        )
        .expect("verified restore initial activation Deriver A canary");
    let canary_b_bytes = decode_base64url_bytes_v1(
        "restore initial activation Deriver B canary",
        &deriver_b_promotion.provider_canary_receipt_b64u,
    )
    .expect("restore initial activation Deriver B canary bytes");
    let canary_b =
        TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(&canary_b_bytes)
            .expect("restore initial activation Deriver B canary");
    let canary_b = canary_b
        .verify(
            canary_b.binding(),
            &SigningKey::from_bytes(&[0x72; 32])
                .verifying_key()
                .to_bytes(),
        )
        .expect("verified restore initial activation Deriver B canary");
    let bundle = VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::new(
        installation_a,
        installation_b,
        availability,
        canary_a,
        canary_b,
        TENANT_ROOT_RESTORE_REFRESH_INITIAL_ACTIVATION_EXPECTED_REVISION_V1,
        TENANT_ROOT_RESTORE_REFRESH_INITIAL_ACTIVATION_RESULT_REVISION_V1,
    )
    .expect("restore initial activation evidence bundle");
    TenantRootSignedActivationReceiptV1::sign_initial_creation(
        &bundle,
        deriver_a_promotion
            .completed_at_ms
            .max(deriver_b_promotion.completed_at_ms),
        authority(0x72),
        ISSUER_KEY_ID,
        &SIGNING_KEY_BYTES,
    )
    .expect("restore initial activation receipt")
    .verify_initial_creation(
        &bundle,
        deriver_a_promotion
            .completed_at_ms
            .max(deriver_b_promotion.completed_at_ms),
        authority(0x72),
        ISSUER_KEY_ID,
        &verifying_key(),
    )
    .expect("verified restore initial activation receipt")
}

#[cfg(feature = "workers-rs")]
#[test]
fn restore_initial_activation_binds_only_the_promoted_scope_and_authority() {
    let (fixture, completed, deriver_a_promotion, deriver_b_promotion) =
        restore_refresh_checkpoint_completed_with_promotion_inputs();
    let promoted = restore_refresh_checkpoint_committed(
        Some(&completed),
        restore_refresh_checkpoint_commit_promoted_request(
            &fixture,
            deriver_a_promotion.clone(),
            deriver_b_promotion.clone(),
        ),
        1_030_000,
    );
    let receipt = restore_initial_activation_receipt_fixture(
        &fixture,
        &deriver_a_promotion,
        &deriver_b_promotion,
    );
    let expected = (
        TenantRootRestoreDestinationFingerprintV1::from_bytes([0x82; 32])
            .expect("destination fingerprint"),
        TenantRootRestoreSessionIdV1::from_bytes([0x84; 16]).expect("restore session"),
    );
    assert_eq!(
        validate_restore_initial_activation_receipt_against_checkpoint_v1(
            &receipt,
            &promoted,
            authority(0x72),
        )
        .expect("promoted activation scope"),
        expected
    );
    assert!(
        validate_restore_initial_activation_receipt_against_checkpoint_v1(
            &receipt,
            &promoted,
            authority(0x73),
        )
        .is_err()
    );

    let mut changed_scope = promoted.clone();
    changed_scope.scope.destination_fingerprint_b64u = encode_base64url_bytes_v1(&[0x91; 32]);
    assert!(
        validate_restore_initial_activation_receipt_against_checkpoint_v1(
            &receipt,
            &changed_scope,
            authority(0x72),
        )
        .is_err()
    );
}

#[test]
fn restore_refresh_checkpoint_completed_read_requires_exact_fresh_completed_scope() {
    let (fixture, completed) = restore_refresh_checkpoint_completed_fixture();
    let (_, _, scope) = restore_refresh_checkpoint_scope_from_grant_v1(&fixture.grant_b64u)
        .expect("restore-refresh scope");
    let authority_id = TenantRootControlPlaneAuthorityIdV1::from_bytes([0xd4; 32]);
    let fresh = evaluate_restore_refresh_completed_read_v1(
        &completed,
        &fixture.grant_b64u,
        &scope,
        authority_id,
        1_000_006,
    )
    .expect("fresh completed read");
    assert!(matches!(
        fresh,
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::CompletedRead {
            authority_id_b64u,
            expected_initial_activation_revision: 2,
            result_initial_activation_revision: 3,
        } if authority_id_b64u == encode_base64url_bytes_v1(&[0xd4; 32])
    ));

    let admitted = restore_refresh_checkpoint_committed(
        None,
        restore_refresh_checkpoint_admit_request(&fixture),
        1_000_001,
    );
    let error = evaluate_restore_refresh_completed_read_v1(
        &admitted,
        &fixture.grant_b64u,
        &scope,
        authority_id,
        1_000_006,
    )
    .expect_err("non-completed checkpoint must refuse initial activation");
    assert_eq!(
        error.code(),
        RouterAbProtocolErrorCode::InvalidLifecycleState
    );

    let mut changed_scope = scope.clone();
    changed_scope.destination_fingerprint_b64u = encode_base64url_bytes_v1(&[0xd5; 32]);
    let error = evaluate_restore_refresh_completed_read_v1(
        &completed,
        &fixture.grant_b64u,
        &changed_scope,
        authority_id,
        1_000_006,
    )
    .expect_err("changed completed scope must conflict");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::ConflictingPair);

    let expired = evaluate_restore_refresh_completed_read_v1(
        &completed,
        &fixture.grant_b64u,
        &scope,
        authority_id,
        1_030_000,
    )
    .expect("expired completed read");
    assert!(matches!(
        expired,
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforePromotion {
            grant_digest_b64u,
            operation_digest_b64u,
        } if grant_digest_b64u == completed.scope.grant_digest_b64u
            && operation_digest_b64u == completed.scope.operation_digest_b64u
    ));
}

#[test]
fn restore_refresh_checkpoint_resumes_each_phase_after_expiry_and_replays_exactly() {
    let fixture = restore_refresh_checkpoint_fixture();
    let admitted = restore_refresh_checkpoint_committed(
        None,
        restore_refresh_checkpoint_admit_request(&fixture),
        1_000_001,
    );
    assert!(matches!(
        admitted.state,
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted
    ));

    let commands_persisted = restore_refresh_checkpoint_committed(
        Some(&admitted),
        restore_refresh_checkpoint_commands_request(&fixture, fixture.commands.clone()),
        1_040_000,
    );
    assert!(matches!(
        commands_persisted.state,
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted { .. }
    ));

    let commitment_a =
        restore_refresh_checkpoint_commitment_b64u(TwoPartyDeriverRole::DeriverA, 31);
    let commitment_b =
        restore_refresh_checkpoint_commitment_b64u(TwoPartyDeriverRole::DeriverB, 37);
    let prepared_request = restore_refresh_checkpoint_commit_prepared_request(
        &fixture,
        commitment_a.clone(),
        commitment_b.clone(),
    );
    let prepared = restore_refresh_checkpoint_committed(
        Some(&commands_persisted),
        prepared_request.clone(),
        1_040_001,
    );
    assert!(matches!(
        prepared.state,
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Prepared { .. }
    ));

    let contribution_a = encode_base64url_bytes_v1(&[0xa1; 64]);
    let contribution_b = encode_base64url_bytes_v1(&[0xa2; 64]);
    let contributed_request = restore_refresh_checkpoint_commit_contributed_request(
        &fixture,
        commitment_a.clone(),
        commitment_b.clone(),
        contribution_a.clone(),
        contribution_b.clone(),
    );
    let contributed = restore_refresh_checkpoint_committed(
        Some(&prepared),
        contributed_request.clone(),
        1_040_002,
    );
    assert!(matches!(
        contributed.state,
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Contributed { .. }
    ));

    let completed_request = restore_refresh_checkpoint_commit_completed_request(
        &fixture,
        commitment_a,
        commitment_b,
        contribution_a,
        contribution_b,
    );
    let completed = restore_refresh_checkpoint_committed(
        Some(&contributed),
        completed_request.clone(),
        1_040_003,
    );
    assert!(matches!(
        completed.state,
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed { .. }
    ));

    for request in [prepared_request, contributed_request, completed_request] {
        let replay = evaluate_tenant_root_restore_refresh_checkpoint_v1(
            Some(&completed),
            request,
            1_040_004,
        )
        .expect("exact persisted phase replay");
        assert!(matches!(
            replay,
            CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay { checkpoint }
                if checkpoint == completed
        ));
    }
}

#[test]
fn restore_refresh_checkpoint_reconciles_expired_operations_before_freshness_and_refuses_admitted(
) {
    let fixture = restore_refresh_checkpoint_fixture();
    let admitted = restore_refresh_checkpoint_committed(
        None,
        restore_refresh_checkpoint_admit_request(&fixture),
        1_000_001,
    );
    let expired_admitted = evaluate_tenant_root_restore_refresh_checkpoint_v1(
        Some(&admitted),
        restore_refresh_checkpoint_admit_request(&fixture),
        1_030_000,
    )
    .expect("expired admitted refusal");
    assert!(matches!(
        &expired_admitted,
        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::AuthorizationExpiredBeforeCommands {
            grant_digest_b64u,
            operation_digest_b64u,
        } if grant_digest_b64u == &admitted.scope.grant_digest_b64u
            && operation_digest_b64u == &admitted.scope.operation_digest_b64u
    ));
    assert!(matches!(
        restore_refresh_checkpoint_phase_response_v1(expired_admitted.clone()),
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforeCommands {
            deriver_dispatch: CloudflareTenantRootRestoreRefreshDeriverDispatchV1::NoneBeforeCommands,
            ..
        }
    ));

    let commands_persisted = restore_refresh_checkpoint_committed(
        Some(&admitted),
        restore_refresh_checkpoint_commands_request(&fixture, fixture.commands.clone()),
        1_000_002,
    );
    let completed_request = restore_refresh_checkpoint_commit_completed_request(
        &fixture,
        restore_refresh_checkpoint_commitment_b64u(TwoPartyDeriverRole::DeriverA, 41),
        restore_refresh_checkpoint_commitment_b64u(TwoPartyDeriverRole::DeriverB, 43),
        encode_base64url_bytes_v1(&[0xa3; 64]),
        encode_base64url_bytes_v1(&[0xa4; 64]),
    );
    let completed = CloudflareTenantRootRestoreRefreshCheckpointV1 {
        state: CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
            commands: fixture.commands.clone(),
            deriver_a_commitment_b64u: match &completed_request {
                CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitCompleted {
                    deriver_a_commitment_b64u,
                    ..
                } => deriver_a_commitment_b64u.clone(),
                _ => unreachable!(),
            },
            deriver_b_commitment_b64u: match &completed_request {
                CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitCompleted {
                    deriver_b_commitment_b64u,
                    ..
                } => deriver_b_commitment_b64u.clone(),
                _ => unreachable!(),
            },
            deriver_a_contribution_b64u: encode_base64url_bytes_v1(&[0xa3; 64]),
            deriver_b_contribution_b64u: encode_base64url_bytes_v1(&[0xa4; 64]),
            deriver_a_evidence_b64u: encode_base64url_bytes_v1(&[0xb1; 64]),
            deriver_b_evidence_b64u: encode_base64url_bytes_v1(&[0xb2; 64]),
            deriver_a_evidence_digest_b64u: encode_base64url_bytes_v1(&[0xc1; 32]),
            deriver_b_evidence_digest_b64u: encode_base64url_bytes_v1(&[0xc2; 32]),
        },
        ..admitted.clone()
    };
    validate_restore_refresh_checkpoint_record_v1(&commands_persisted)
        .expect("persisted command checkpoint remains valid");
    validate_restore_refresh_checkpoint_record_v1(&completed)
        .expect("completed checkpoint remains valid");

    let replay = evaluate_tenant_root_restore_refresh_checkpoint_v1(
        Some(&completed),
        restore_refresh_checkpoint_admit_request(&fixture),
        1_030_000,
    )
    .expect("completed exact operation replay after expiry");
    assert!(matches!(
        replay,
        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay { checkpoint }
            if checkpoint == completed
    ));
}

#[test]
fn restore_refresh_checkpoint_refuses_changed_commands_after_persistence() {
    let fixture = restore_refresh_checkpoint_fixture();
    let admitted = restore_refresh_checkpoint_committed(
        None,
        restore_refresh_checkpoint_admit_request(&fixture),
        1_000_001,
    );
    let persisted = restore_refresh_checkpoint_committed(
        Some(&admitted),
        restore_refresh_checkpoint_commands_request(&fixture, fixture.commands.clone()),
        1_000_002,
    );
    let mut changed = fixture.alternate_commands.clone();
    changed.deriver_a_refresh_command_b64u =
        fixture.commands.deriver_a_refresh_command_b64u.clone();
    let error = evaluate_tenant_root_restore_refresh_checkpoint_v1(
        Some(&persisted),
        restore_refresh_checkpoint_commands_request(&fixture, changed),
        1_000_003,
    )
    .expect_err("changed command response must conflict");
    assert_eq!(error.code(), RouterAbProtocolErrorCode::ConflictingPair);
}

pub(super) fn destination_bootstrap_fixture(
    identity_marker: &str,
    lineage_bytes: [u8; 16],
) -> (
    CloudflareTenantRootDestinationBootstrapRecordV1,
    TenantRootIdentityV1,
    TenantRootCustodyLineageId,
    TenantRootRestoreDestinationFingerprintV1,
    DestinationBootstrapAuthorityV1,
    DestinationBootstrapTokenV1,
) {
    let identity =
        TenantRootIdentityV1::new("org-1", "project-2", "production", identity_marker, "v3")
            .expect("identity");
    let identity_bytes = identity.canonical_bytes().expect("identity bytes");
    let custody_lineage =
        TenantRootCustodyLineageId::from_bytes(lineage_bytes).expect("custody lineage");
    let deployment_fingerprint =
        TenantRootRestoreDestinationFingerprintV1::from_bytes([0x52; 32])
            .expect("deployment fingerprint");
    let (authority, token) =
        DestinationBootstrapAuthorityV1::initialize(deployment_fingerprint, &mut TestRng(7))
            .expect("bootstrap authority");
    let record = CloudflareTenantRootDestinationBootstrapRecordV1 {
        identity_b64u: encode_base64url_bytes_v1(&identity_bytes),
        deployment_fingerprint_b64u: encode_base64url_bytes_v1(
            deployment_fingerprint.as_bytes(),
        ),
        custody_lineage_b64u: custody_lineage.to_base64url(),
        token_digest_b64u: encode_base64url_bytes_v1(authority.token_digest()),
    };
    (
        record,
        identity,
        custody_lineage,
        deployment_fingerprint,
        authority,
        token,
    )
}

pub(super) fn destination_bootstrap_read_request(
    identity: &TenantRootIdentityV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> CloudflareTenantRootDestinationBootstrapRequestV1 {
    CloudflareTenantRootDestinationBootstrapRequestV1::Read {
        identity_b64u: encode_base64url_bytes_v1(
            &identity.canonical_bytes().expect("identity bytes"),
        ),
        custody_lineage_b64u: custody_lineage.to_base64url(),
    }
}

pub(super) fn destination_bootstrap_authenticate_request(
    identity: &TenantRootIdentityV1,
    custody_lineage: TenantRootCustodyLineageId,
    deployment_fingerprint: TenantRootRestoreDestinationFingerprintV1,
) -> CloudflareTenantRootDestinationBootstrapRequestV1 {
    CloudflareTenantRootDestinationBootstrapRequestV1::Authenticate {
        identity_b64u: encode_base64url_bytes_v1(
            &identity.canonical_bytes().expect("identity bytes"),
        ),
        deployment_fingerprint_b64u: encode_base64url_bytes_v1(
            deployment_fingerprint.as_bytes(),
        ),
        custody_lineage_b64u: custody_lineage.to_base64url(),
    }
}

#[test]
fn destination_bootstrap_read_and_authentication_are_scoped_and_fail_closed() {
    let (record, identity, custody_lineage, deployment_fingerprint, authority, token) =
        destination_bootstrap_fixture("root-main", [0x31; 16]);
    let record = validate_tenant_root_destination_bootstrap_record_v1(record)
        .expect("validated destination bootstrap record");
    let read = validate_tenant_root_destination_bootstrap_request_v1(
        destination_bootstrap_read_request(&identity, custody_lineage),
    )
    .expect("validated read request");
    let authenticate = validate_tenant_root_destination_bootstrap_request_v1(
        destination_bootstrap_authenticate_request(
            &identity,
            custody_lineage,
            deployment_fingerprint,
        ),
    )
    .expect("validated authenticate request");

    assert!(matches!(
        evaluate_tenant_root_destination_bootstrap_request_v1(
            &TenantRootDestinationBootstrapStateV1::Ready(record.clone()),
            &read,
            None,
            0,
        ),
        CloudflareTenantRootDestinationBootstrapResponseV1::ReadReady { .. }
    ));
    assert!(matches!(
        evaluate_tenant_root_destination_bootstrap_request_v1(
            &TenantRootDestinationBootstrapStateV1::Ready(record.clone()),
            &authenticate,
            Some(&token),
            1234,
        ),
        CloudflareTenantRootDestinationBootstrapResponseV1::Authenticated {
            authenticated_at_ms: 1234,
            ..
        }
    ));

    let wrong_token = DestinationBootstrapTokenV1::from_bytes([0x99; 32]).expect("wrong token");
    assert!(matches!(
        evaluate_tenant_root_destination_bootstrap_request_v1(
            &TenantRootDestinationBootstrapStateV1::Ready(record.clone()),
            &authenticate,
            Some(&wrong_token),
            0,
        ),
        CloudflareTenantRootDestinationBootstrapResponseV1::AuthenticationRefused {
            reason: CloudflareTenantRootDestinationBootstrapRefusalV1::AuthenticationFailed,
        }
    ));

    let wrong_fingerprint = TenantRootRestoreDestinationFingerprintV1::from_bytes([0x53; 32])
        .expect("wrong fingerprint");
    let wrong_scope_authenticate = validate_tenant_root_destination_bootstrap_request_v1(
        destination_bootstrap_authenticate_request(
            &identity,
            custody_lineage,
            wrong_fingerprint,
        ),
    )
    .expect("validated wrong fingerprint request");
    assert!(matches!(
        evaluate_tenant_root_destination_bootstrap_request_v1(
            &TenantRootDestinationBootstrapStateV1::Ready(record.clone()),
            &wrong_scope_authenticate,
            Some(&token),
            0,
        ),
        CloudflareTenantRootDestinationBootstrapResponseV1::AuthenticationRefused {
            reason: CloudflareTenantRootDestinationBootstrapRefusalV1::ScopeMismatch,
        }
    ));

    let (_, foreign_identity, _, _, _, _) =
        destination_bootstrap_fixture("foreign-root", [0x31; 16]);
    let foreign_read = validate_tenant_root_destination_bootstrap_request_v1(
        destination_bootstrap_read_request(&foreign_identity, custody_lineage),
    )
    .expect("validated foreign read request");
    assert!(matches!(
        evaluate_tenant_root_destination_bootstrap_request_v1(
            &TenantRootDestinationBootstrapStateV1::Ready(record.clone()),
            &foreign_read,
            None,
            0,
        ),
        CloudflareTenantRootDestinationBootstrapResponseV1::ReadRefused {
            reason: CloudflareTenantRootDestinationBootstrapRefusalV1::ScopeMismatch,
        }
    ));

    for (state, reason) in [
        (
            TenantRootDestinationBootstrapStateV1::Uninitialized,
            CloudflareTenantRootDestinationBootstrapRefusalV1::Uninitialized,
        ),
        (
            TenantRootDestinationBootstrapStateV1::CreationInProgress(record.clone()),
            CloudflareTenantRootDestinationBootstrapRefusalV1::CreationInProgress,
        ),
        (
            TenantRootDestinationBootstrapStateV1::ActiveRootPresent(record.clone()),
            CloudflareTenantRootDestinationBootstrapRefusalV1::ActiveRootPresent,
        ),
    ] {
        assert!(matches!(
            evaluate_tenant_root_destination_bootstrap_request_v1(
                &state,
                &read,
                None,
                0,
            ),
            CloudflareTenantRootDestinationBootstrapResponseV1::ReadRefused { reason: actual }
                if actual == reason
        ));
    }

    let debug = format!("{:?}", &record.record);
    assert!(debug.contains("[redacted]"));
    assert!(!debug.contains(&encode_base64url_bytes_v1(authority.token_digest())));
    let response = CloudflareTenantRootDestinationBootstrapResponseV1::Authenticated {
        scope: record.scope(),
        authenticated_at_ms: 1234,
    };
    let response_json = serde_json::to_string(&response).expect("response JSON");
    assert!(!response_json.contains("token_digest"));
}

#[test]
fn destination_bootstrap_destroyed_state_is_terminal_and_replayable() {
    let (record, identity, custody_lineage, deployment_fingerprint, _authority, _token) =
        destination_bootstrap_fixture("root-main", [0x31; 16]);
    let activation_digest =
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x61; 32]).expect("activation digest");
    let restore_session_id =
        TenantRootRestoreSessionIdV1::from_bytes([0x62; 16]).expect("restore session");
    let grant_digest_b64u = encode_base64url_bytes_v1(&[0x63; 32]);
    let (destruction_receipt_b64u, destruction_receipt_digest_b64u) =
        restore_bootstrap_destruction_receipt_v1(
            identity.digest().expect("identity digest"),
            custody_lineage,
            deployment_fingerprint,
            restore_session_id,
            &grant_digest_b64u,
            activation_digest,
        )
        .expect("destruction receipt");
    let destroyed = validate_tenant_root_destination_bootstrap_destroyed_record_v1(
        CloudflareTenantRootDestinationBootstrapDestroyedRecordV1 {
            identity_b64u: record.identity_b64u.clone(),
            deployment_fingerprint_b64u: record.deployment_fingerprint_b64u.clone(),
            custody_lineage_b64u: record.custody_lineage_b64u.clone(),
            activation_receipt_digest_b64u: encode_base64url_bytes_v1(
                activation_digest.as_bytes(),
            ),
            destruction_receipt_b64u,
            destruction_receipt_digest_b64u,
        },
    )
    .expect("destroyed record");
    let read = validate_tenant_root_destination_bootstrap_request_v1(
        destination_bootstrap_read_request(&identity, custody_lineage),
    )
    .expect("read request");
    assert!(matches!(
        evaluate_tenant_root_destination_bootstrap_request_v1(
            &TenantRootDestinationBootstrapStateV1::Destroyed(destroyed.clone()),
            &read,
            None,
            0,
        ),
        CloudflareTenantRootDestinationBootstrapResponseV1::ReadRefused {
            reason: CloudflareTenantRootDestinationBootstrapRefusalV1::Destroyed,
        }
    ));
    let authenticate = validate_tenant_root_destination_bootstrap_request_v1(
        destination_bootstrap_authenticate_request(
            &identity,
            custody_lineage,
            deployment_fingerprint,
        ),
    )
    .expect("authenticate request");
    assert!(matches!(
        evaluate_tenant_root_destination_bootstrap_request_v1(
            &TenantRootDestinationBootstrapStateV1::Destroyed(destroyed.clone()),
            &authenticate,
            None,
            0,
        ),
        CloudflareTenantRootDestinationBootstrapResponseV1::AuthenticationRefused {
            reason: CloudflareTenantRootDestinationBootstrapRefusalV1::Destroyed,
        }
    ));
    let (_, foreign_identity, _, _, _, _) =
        destination_bootstrap_fixture("foreign-root", [0x31; 16]);
    let foreign_read = validate_tenant_root_destination_bootstrap_request_v1(
        destination_bootstrap_read_request(&foreign_identity, custody_lineage),
    )
    .expect("foreign read request");
    assert!(matches!(
        evaluate_tenant_root_destination_bootstrap_request_v1(
            &TenantRootDestinationBootstrapStateV1::Destroyed(destroyed),
            &foreign_read,
            None,
            0,
        ),
        CloudflareTenantRootDestinationBootstrapResponseV1::ReadRefused {
            reason: CloudflareTenantRootDestinationBootstrapRefusalV1::ScopeMismatch,
        }
    ));
}

pub(super) struct TestRng(pub(super) u64);

impl RngCore for TestRng {
    fn next_u32(&mut self) -> u32 {
        self.next_u64() as u32
    }

    fn next_u64(&mut self) -> u64 {
        self.0 ^= self.0 << 7;
        self.0 ^= self.0 >> 9;
        self.0 ^= self.0 << 8;
        self.0
    }

    fn fill_bytes(&mut self, destination: &mut [u8]) {
        for chunk in destination.chunks_mut(8) {
            let bytes = self.next_u64().to_le_bytes();
            let length = chunk.len();
            chunk.copy_from_slice(&bytes[..length]);
        }
    }
}

impl CryptoRng for TestRng {}

pub(super) const ACTIVE_RECEIPT_B64U: &str = "AAAAJ3NlYW1zL3RlbmFudC1yb290LWFjdGl2YXRpb24tcmVjZWlwdC92MQAAABBpbml0aWFsX2NyZWF0aW9uAAAAIBERERERERERERERERERERERERERERERERERERERERERAAAAECIiIiIiIiIiIiIiIiIiIiIAAAAIAAAAAAAAAAEAAAAgkI_pwUXEA4gcAvabBzqouVV7bYFT9VPpRZ10ciaUPikAAAAIAAAAAAAAAAIAAAAIAAAAAAAAAAMAAAAiAAHkVJ7ha5qgMJnKIIxnra_K-kw_Pk5TA95gJuPKj_hEYAAAACIAAkzxud7ak-uf1RX8yZJirtE2i0jySiev0phNqP57sjQfAAAAIOiCsTEBa1LB0zNwgBh892hCPvzLtRe7SVq4EsQWD_ROAAAAIMQ9g3dCkm7LYr3LZYshGa91a8Z9PLnqT3uf3jTE4aIxAAAAIDakJhm_fPXLIc4wnkXePcNdYGfNUjiEna5UZhH5AFHPAAAAFGN1cnJlbnRfcm9sZV9iYWNrdXBzAAAAIC2mFYLjHTKbc8aMOkEmcTVBYQfG-haBElDQh2WGuka_AAAAID1zStMyGYGvRh9E-TLEGvjbICdBkWWjxV1MO29AkQOMAAAAIIM2B2FzSVsXBnkngfyo5gVXqcVmpiT1tyNwUXER7ef7AAAAIPEpISsVxYb2unONkNRuxtq6LW6rokS_H89t5CwHRn1gAAAACAAAAAAAD0JKAAAAIHFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxAAAACAAAAAAAD0JAAAAACAAAAAAAD7dwAAAAF2NvbnRyb2wtcGxhbmUtaXNzdWVyLXYxAAAAQNj5VPnQhsrHKxUDM1Qj3_FxrfZPpPvjAdqVjvbR_dX9QguP3nfue5x0vHeXlHP1qC41Z2FODFPXTpYJb5GaPwE";

pub(super) fn authority(marker: u8) -> TenantRootControlPlaneAuthorityIdV1 {
    TenantRootControlPlaneAuthorityIdV1::from_bytes([marker; 32])
}

pub(super) fn record(
    session_seed: u8,
    nonce_seed: u8,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
) -> CloudflareTenantRootCreationJournalRecordV1 {
    let identity =
        TenantRootIdentityV1::new("org-1", "project-2", "production", "root-main", "v3")
            .expect("identity");
    let lineage = TenantRootCustodyLineageId::from_bytes([0x31; 16]).expect("lineage");
    let context = TenantRootCeremonyContextV1::new(
        identity.digest().expect("identity digest"),
        lineage,
        TenantRootCeremonyEpochsV1::create(),
        TenantRootCeremonySessionIdV1::from_bytes([session_seed; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x41; 32]).expect("nonce"),
        1_000_000,
        1_030_000,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("context");
    let journal =
        TenantRootCreationJournalV1::started(identity, lineage, context).expect("journal");
    let journal_bytes = journal.canonical_bytes().expect("canonical journal");
    let capability = TenantRootCreationCapabilityV1::sign(
        journal.identity_digest(),
        journal.custody_lineage(),
        journal.digest().expect("journal digest"),
        authority_id,
        TenantRootCreationCapabilityNonceV1::from_bytes([nonce_seed; 32])
            .expect("capability nonce"),
        issued_at_ms,
        expires_at_ms,
        ISSUER_KEY_ID,
        &SIGNING_KEY_BYTES,
    )
    .expect("capability");
    CloudflareTenantRootCreationJournalRecordV1 {
        journal_b64u: encode_base64url_bytes_v1(&journal_bytes),
        creation_capability_b64u: encode_base64url_bytes_v1(
            &capability.canonical_bytes().expect("capability bytes"),
        ),
    }
}

pub(super) fn read_request(
    journal: &ValidatedTenantRootCreationJournalV1,
) -> CloudflareTenantRootCreationJournalReadRequestV1 {
    CloudflareTenantRootCreationJournalReadRequestV1 {
        identity_digest_b64u: encode_base64url_bytes_v1(journal.identity_digest.as_bytes()),
        custody_lineage_b64u: encode_base64url_bytes_v1(journal.custody_lineage.as_bytes()),
    }
}

pub(super) fn rendezvous_with(
    state: CloudflareTenantRootCreationCommitmentRendezvousStateV1,
) -> CloudflareTenantRootCreationCommitmentRendezvousRecordV1 {
    CloudflareTenantRootCreationCommitmentRendezvousRecordV1 {
        journal_digest_b64u: String::new(),
        identity_digest_b64u: String::new(),
        custody_lineage_b64u: String::new(),
        ceremony_context_digest_b64u: String::new(),
        state,
    }
}

/// The read projection returns exactly the persisted public bytes and the
/// creation progress the issuer must respect, and nothing else.
#[test]
fn creation_journal_read_projects_exact_bytes_and_progress() {
    let record = record(0x11, 0x21, authority(0x44), 1_000_000, 1_030_000);
    let journal = validate_creation_record(record.clone(), authority(0x44), &verifying_keys())
        .expect("validated journal");
    let request = read_request(&journal);

    let fresh = build_creation_journal_read_response(&request, &journal, None, None, None)
        .expect("fresh");
    assert_eq!(fresh.journal_b64u, record.journal_b64u);
    assert_eq!(
        fresh.creation_capability_b64u,
        record.creation_capability_b64u
    );
    assert_eq!(fresh.revision, journal.journal.revision());
    assert!(fresh.committed_roles.is_empty());
    assert_eq!(
        fresh.installation_checkpoint,
        CloudflareTenantRootCreationInstallationCheckpointReadStateV1::None
    );
    assert!(fresh.abandonment.is_none());

    let one = rendezvous_with(
        CloudflareTenantRootCreationCommitmentRendezvousStateV1::OneRoleCommitted {
            role: CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
            signed_commitment_b64u: String::new(),
        },
    );
    let one_committed =
        build_creation_journal_read_response(&request, &journal, Some(&one), None, None)
            .expect("one committed");
    assert_eq!(
        one_committed.committed_roles,
        vec![CloudflareTenantRootCreationInstallationRoleV1::DeriverB]
    );

    let both = rendezvous_with(
        CloudflareTenantRootCreationCommitmentRendezvousStateV1::BothRolesCommitted {
            deriver_a_signed_commitment_b64u: String::new(),
            deriver_b_signed_commitment_b64u: String::new(),
        },
    );
    let (one_checkpoint, commitments) = deriver_b_installation_checkpoint(&journal, 1_010_000);
    let expected_evidence = match &one_checkpoint.state {
        CloudflareTenantRootCreationInstallationStateV1::OneRoleReady {
            signed_evidence_b64u,
            ..
        } => signed_evidence_b64u.clone(),
        CloudflareTenantRootCreationInstallationStateV1::BothRolesReady { .. } => {
            panic!("expected one installation record")
        }
    };
    let one_checkpoint_for_read = validate_installation_checkpoint(
        one_checkpoint.clone(),
        &journal,
        &role_keys(),
        &commitments,
    )
    .expect("one installation checkpoint");
    let one_read = build_creation_journal_read_response(
        &request,
        &journal,
        Some(&both),
        Some(&one_checkpoint_for_read),
        None,
    )
    .expect("one ready");
    assert_eq!(
        one_read.committed_roles,
        vec![
            CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
            CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
        ]
    );
    let CloudflareTenantRootCreationInstallationCheckpointReadStateV1::OneRoleReady {
        role,
        signed_evidence_b64u,
    } = one_read.installation_checkpoint
    else {
        panic!("expected one installation checkpoint");
    };
    assert_eq!(
        role,
        CloudflareTenantRootCreationInstallationRoleV1::DeriverB
    );
    assert_eq!(signed_evidence_b64u, expected_evidence);
    assert!(one_read.abandonment.is_none());

    let command_a = role_creation_command(&journal, TwoPartyDeriverRole::DeriverA);
    let both_checkpoint = match evaluate_installation_checkpoint(
        Some(one_checkpoint),
        installation_wire(&journal, TwoPartyDeriverRole::DeriverA, 12, 19, 0x61),
        &command_a,
        &journal,
        &role_keys(),
        &commitments,
        1_010_000,
    )
    .expect("both installation checkpoints")
    {
        TenantRootCreationInstallationEvaluationV1::Commit { checkpoint, .. } => checkpoint,
        other => panic!("unexpected installation checkpoint outcome: {other:?}"),
    };
    let expected_root = match &both_checkpoint.state {
        CloudflareTenantRootCreationInstallationStateV1::BothRolesReady {
            root_commitment_b64u,
            ..
        } => root_commitment_b64u.clone(),
        CloudflareTenantRootCreationInstallationStateV1::OneRoleReady { .. } => {
            panic!("expected both installation record")
        }
    };
    let both_checkpoint =
        validate_installation_checkpoint(both_checkpoint, &journal, &role_keys(), &commitments)
            .expect("both installation checkpoint");
    let completed = build_creation_journal_read_response(
        &request,
        &journal,
        Some(&both),
        Some(&both_checkpoint),
        None,
    )
    .expect("both ready");
    assert!(matches!(
        completed.installation_checkpoint,
        CloudflareTenantRootCreationInstallationCheckpointReadStateV1::BothRolesReady {
            root_commitment_b64u,
            ..
        } if root_commitment_b64u == expected_root
    ));

    let abandoned = build_creation_journal_read_response(
        &request,
        &journal,
        Some(&both),
        Some(&both_checkpoint),
        Some(CloudflareTenantRootCreationAbandonmentReadV1 {
            abandoned_at_ms: 1_020_000,
            installed_roles: vec![
                CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
                CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
            ],
            cleaned_roles: vec![CloudflareTenantRootCreationInstallationRoleV1::DeriverA],
        }),
    )
    .expect("abandoned");
    assert!(matches!(
        abandoned.installation_checkpoint,
        CloudflareTenantRootCreationInstallationCheckpointReadStateV1::BothRolesReady { .. }
    ));
    assert_eq!(
        abandoned.abandonment.map(|abandonment| abandonment.cleaned_roles),
        Some(vec![CloudflareTenantRootCreationInstallationRoleV1::DeriverA])
    );
}
