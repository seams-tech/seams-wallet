use ed25519_dalek::SigningKey;
use router_ab_core::{
    TenantRootRecoveryReshareHpkeKeypairV1, TenantRootSignedRecoveryReshareContributionV1,
    TenantRootSignedRecoveryShareInstallationEvidenceV1, VerifiedTenantRootRecoveryResharePairV1,
};
use threshold_prf::{
    SigningRootShareCommitment, TwoPartyDeriverRole, TwoPartyRootShareCommitments,
};

mod support;

use support::{
    fixed_share, recovery_reshare_fixture as fixture, rng06, rng09, EXPIRES_AT_MS, ISSUED_AT_MS,
};

#[test]
fn dedicated_reshare_is_role_separated_fresh_and_root_continuous() {
    let fixture = fixture();
    let commitment_a = router_ab_core::TenantRootSignedRecoveryReshareCommitmentV1::decode_and_verify_canonical_bytes(
        &fixture.signed_commitment_a.canonical_bytes(&fixture.context).unwrap(),
        &fixture.context,
        fixture.signing_a.verifying_key().as_bytes(),
    ).unwrap();
    let commitment_b = router_ab_core::TenantRootSignedRecoveryReshareCommitmentV1::decode_and_verify_canonical_bytes(
        &fixture.signed_commitment_b.canonical_bytes(&fixture.context).unwrap(),
        &fixture.context,
        fixture.signing_b.verifying_key().as_bytes(),
    ).unwrap();

    let verified_commitment_a = commitment_a
        .verify(
            &fixture.context,
            fixture.signing_a.verifying_key().as_bytes(),
        )
        .unwrap();
    let verified_commitment_b = commitment_b
        .verify(
            &fixture.context,
            fixture.signing_b.verifying_key().as_bytes(),
        )
        .unwrap();
    let hpke_a = TenantRootRecoveryReshareHpkeKeypairV1::derive_from_ikm([0x71; 32]).unwrap();
    let hpke_b = TenantRootRecoveryReshareHpkeKeypairV1::derive_from_ikm([0x81; 32]).unwrap();
    let contribution_a_to_b = TenantRootSignedRecoveryReshareContributionV1::seal(
        &fixture.context,
        &fixture.coefficient_a,
        &verified_commitment_a,
        "recovery-reshare-hpke-b-1",
        &verified_commitment_b,
        &mut rng09(0x91),
        &fixture.signing_a.to_bytes(),
    )
    .unwrap();
    let contribution_b_to_a = TenantRootSignedRecoveryReshareContributionV1::seal(
        &fixture.context,
        &fixture.coefficient_b,
        &verified_commitment_b,
        "recovery-reshare-hpke-a-1",
        &verified_commitment_a,
        &mut rng09(0xa1),
        &fixture.signing_b.to_bytes(),
    )
    .unwrap();
    let contribution_a_to_b =
        TenantRootSignedRecoveryReshareContributionV1::decode_and_verify_canonical_bytes(
            &contribution_a_to_b.canonical_bytes().unwrap(),
            &fixture.context,
            fixture.signing_a.verifying_key().as_bytes(),
        )
        .unwrap();
    let contribution_b_to_a =
        TenantRootSignedRecoveryReshareContributionV1::decode_and_verify_canonical_bytes(
            &contribution_b_to_a.canonical_bytes().unwrap(),
            &fixture.context,
            fixture.signing_b.verifying_key().as_bytes(),
        )
        .unwrap();
    assert_eq!(
        (
            contribution_a_to_b.source(),
            contribution_a_to_b.recipient()
        ),
        (TwoPartyDeriverRole::DeriverA, TwoPartyDeriverRole::DeriverB)
    );
    assert_eq!(
        (
            contribution_b_to_a.source(),
            contribution_b_to_a.recipient()
        ),
        (TwoPartyDeriverRole::DeriverB, TwoPartyDeriverRole::DeriverA)
    );
    let verified_b_for_a = contribution_b_to_a
        .verify_and_open(
            &fixture.context,
            &verified_commitment_b,
            "recovery-reshare-hpke-a-1",
            &hpke_a,
            fixture.signing_b.verifying_key().as_bytes(),
        )
        .unwrap();
    let verified_a_for_b = contribution_a_to_b
        .verify_and_open(
            &fixture.context,
            &verified_commitment_a,
            "recovery-reshare-hpke-b-1",
            &hpke_b,
            fixture.signing_a.verifying_key().as_bytes(),
        )
        .unwrap();
    let pending_a = router_ab_core::PendingTenantRootRecoveryShareV1::derive(
        &fixture.context,
        &fixture.active_a,
        &fixture.coefficient_a,
        &verified_commitment_a,
        verified_b_for_a,
    )
    .unwrap();
    let pending_b = router_ab_core::PendingTenantRootRecoveryShareV1::derive(
        &fixture.context,
        &fixture.active_b,
        &fixture.coefficient_b,
        &verified_commitment_b,
        verified_a_for_b,
    )
    .unwrap();

    let expected_a = fixed_share(TwoPartyDeriverRole::DeriverA, 30);
    let expected_b = fixed_share(TwoPartyDeriverRole::DeriverB, 55);
    assert_eq!(
        pending_a.commitment(),
        SigningRootShareCommitment::from_share(&expected_a)
    );
    assert_eq!(
        pending_b.commitment(),
        SigningRootShareCommitment::from_share(&expected_b)
    );
    assert_ne!(
        pending_a.commitment(),
        SigningRootShareCommitment::from_share(&fixture.active_a)
    );
    assert_ne!(
        pending_b.commitment(),
        SigningRootShareCommitment::from_share(&fixture.active_b)
    );

    let evidence_a = pending_a
        .prove(&fixture.context, pending_b.commitment(), &mut rng06(0xb1))
        .unwrap();
    let evidence_b = pending_b
        .prove(&fixture.context, pending_a.commitment(), &mut rng06(0xc1))
        .unwrap();
    let signed_evidence_a = TenantRootSignedRecoveryShareInstallationEvidenceV1::sign(
        &fixture.context,
        evidence_a,
        &fixture.signing_a.to_bytes(),
    )
    .unwrap();
    let signed_evidence_b = TenantRootSignedRecoveryShareInstallationEvidenceV1::sign(
        &fixture.context,
        evidence_b,
        &fixture.signing_b.to_bytes(),
    )
    .unwrap();
    let signed_evidence_a =
        TenantRootSignedRecoveryShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
            &signed_evidence_a.canonical_bytes(&fixture.context).unwrap(),
            &fixture.context,
            fixture.signing_a.verifying_key().as_bytes(),
        )
        .unwrap();
    let signed_evidence_b =
        TenantRootSignedRecoveryShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
            &signed_evidence_b.canonical_bytes(&fixture.context).unwrap(),
            &fixture.context,
            fixture.signing_b.verifying_key().as_bytes(),
        )
        .unwrap();
    let verified_pair = VerifiedTenantRootRecoveryResharePairV1::verify(
        &fixture.context,
        &signed_evidence_a,
        &signed_evidence_b,
        fixture.signing_a.verifying_key().as_bytes(),
        fixture.signing_b.verifying_key().as_bytes(),
    )
    .unwrap();
    let expected_pair =
        TwoPartyRootShareCommitments::from_shares(&expected_a, &expected_b).unwrap();
    assert_eq!(verified_pair.stable_root_commitment(), expected_pair.root());
    assert_eq!(
        verified_pair.stable_root_commitment(),
        fixture.context.stable_root_commitment()
    );

    let verified_a = pending_a.finalize(&verified_pair).unwrap();
    let verified_b = pending_b.finalize(&verified_pair).unwrap();
    assert_eq!(verified_a.role(), TwoPartyDeriverRole::DeriverA);
    assert_eq!(verified_b.role(), TwoPartyDeriverRole::DeriverB);
    assert_eq!(
        verified_a.recovery_set_id(),
        fixture.context.recovery_set_id()
    );
    assert_eq!(
        verified_b.recovery_set_id(),
        fixture.context.recovery_set_id()
    );
    assert_ne!(
        verified_a.recipient_fingerprint(),
        verified_b.recipient_fingerprint()
    );
}

#[test]
fn context_commitment_signature_recipient_and_active_share_substitution_fail_closed() {
    let fixture = fixture();
    let wrong_signing_key = SigningKey::from_bytes(&[0xee; 32]);
    assert!(fixture
        .signed_commitment_a
        .verify(
            &fixture.context,
            wrong_signing_key.verifying_key().as_bytes()
        )
        .is_err());

    let verified_commitment_a = fixture
        .signed_commitment_a
        .verify(
            &fixture.context,
            fixture.signing_a.verifying_key().as_bytes(),
        )
        .unwrap();
    let verified_commitment_b = fixture
        .signed_commitment_b
        .verify(
            &fixture.context,
            fixture.signing_b.verifying_key().as_bytes(),
        )
        .unwrap();
    let hpke_a = TenantRootRecoveryReshareHpkeKeypairV1::derive_from_ikm([0x71; 32]).unwrap();
    let wrong_hpke_a = TenantRootRecoveryReshareHpkeKeypairV1::derive_from_ikm([0x72; 32]).unwrap();
    let contribution_b_to_a = TenantRootSignedRecoveryReshareContributionV1::seal(
        &fixture.context,
        &fixture.coefficient_b,
        &verified_commitment_b,
        "recovery-reshare-hpke-a-1",
        &verified_commitment_a,
        &mut rng09(0xa1),
        &fixture.signing_b.to_bytes(),
    )
    .unwrap();
    assert!(contribution_b_to_a
        .verify_and_open(
            &fixture.context,
            &verified_commitment_b,
            "recovery-reshare-hpke-a-1",
            &wrong_hpke_a,
            fixture.signing_b.verifying_key().as_bytes(),
        )
        .is_err());
    assert!(contribution_b_to_a
        .verify_and_open(
            &fixture.context,
            &verified_commitment_b,
            "recovery-reshare-hpke-a-substituted",
            &hpke_a,
            fixture.signing_b.verifying_key().as_bytes(),
        )
        .is_err());
    let verified_b_for_a = contribution_b_to_a
        .verify_and_open(
            &fixture.context,
            &verified_commitment_b,
            "recovery-reshare-hpke-a-1",
            &hpke_a,
            fixture.signing_b.verifying_key().as_bytes(),
        )
        .unwrap();
    let wrong_active_a = fixed_share(TwoPartyDeriverRole::DeriverA, 13);
    assert!(router_ab_core::PendingTenantRootRecoveryShareV1::derive(
        &fixture.context,
        &wrong_active_a,
        &fixture.coefficient_a,
        &verified_commitment_a,
        verified_b_for_a,
    )
    .is_err());
}

#[test]
fn canonical_context_freezes_recovery_namespace_and_clock_window() {
    let fixture = fixture();
    assert!(fixture.context.validate_at(ISSUED_AT_MS).is_ok());
    assert!(fixture.context.validate_at(EXPIRES_AT_MS + 60_000).is_ok());
    assert!(fixture.context.validate_at(EXPIRES_AT_MS + 60_001).is_err());
    assert_eq!(
        hex::encode(fixture.context.digest().unwrap().into_bytes()),
        "fdc7deffdc60f3ebee3796ab40a21bb8d9aedb3caeb0df1118a9c5665ac5f7d6"
    );
}

#[test]
fn recovery_commitment_wire_rejects_tampering_and_wrong_authority() {
    let fixture = fixture();
    let bytes = fixture
        .signed_commitment_a
        .canonical_bytes(&fixture.context)
        .unwrap();
    let decode = router_ab_core::TenantRootSignedRecoveryReshareCommitmentV1::decode_and_verify_canonical_bytes;
    assert!(decode(
        &bytes,
        &fixture.context,
        fixture.signing_b.verifying_key().as_bytes()
    )
    .is_err());
    let receiver = TenantRootRecoveryReshareHpkeKeypairV1::derive_from_ikm([0x71; 32]).unwrap();
    let substituted = TenantRootRecoveryReshareHpkeKeypairV1::derive_from_ikm([0x72; 32]).unwrap();
    let mut altered_receiver = bytes.clone();
    let offset = altered_receiver
        .windows(32)
        .position(|window| window == receiver.public_key().as_bytes())
        .unwrap();
    altered_receiver[offset..offset + 32].copy_from_slice(substituted.public_key().as_bytes());
    assert!(decode(
        &altered_receiver,
        &fixture.context,
        fixture.signing_a.verifying_key().as_bytes()
    )
    .is_err());
    let mut altered_signature = bytes.clone();
    *altered_signature.last_mut().unwrap() ^= 1;
    assert!(decode(
        &altered_signature,
        &fixture.context,
        fixture.signing_a.verifying_key().as_bytes()
    )
    .is_err());
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(decode(
        &trailing,
        &fixture.context,
        fixture.signing_a.verifying_key().as_bytes()
    )
    .is_err());
    assert!(decode(
        &bytes[..bytes.len() - 1],
        &fixture.context,
        fixture.signing_a.verifying_key().as_bytes()
    )
    .is_err());
    assert!(decode(
        &vec![0; 16 * 1024 + 1],
        &fixture.context,
        fixture.signing_a.verifying_key().as_bytes()
    )
    .is_err());
}

#[test]
fn issuer_recovery_command_survives_transport_and_rejects_role_or_recipient_substitution() {
    use router_ab_core::TenantRootRecoveryReshareRoleCommandV1;
    let fixture = fixture();
    let issuer = SigningKey::from_bytes(&[0x59; 32]);
    let role = TwoPartyDeriverRole::DeriverA;
    let command = TenantRootRecoveryReshareRoleCommandV1::sign(
        &fixture.context,
        role,
        "recovery-issuer",
        &issuer.to_bytes(),
    )
    .unwrap();
    let bytes = command.canonical_bytes().unwrap();
    let decoded = TenantRootRecoveryReshareRoleCommandV1::decode_canonical_bytes(&bytes).unwrap();
    let verified = decoded
        .verify(role, "recovery-issuer", issuer.verifying_key().as_bytes())
        .unwrap();
    assert_eq!(verified.context(), &fixture.context);
    assert_eq!(verified.canonical_bytes().unwrap(), bytes);
    assert!(decoded
        .verify(
            role.peer(),
            "recovery-issuer",
            issuer.verifying_key().as_bytes()
        )
        .is_err());
    assert!(decoded
        .verify(role, "other-issuer", issuer.verifying_key().as_bytes())
        .is_err());
    assert!(decoded
        .verify(
            role,
            "recovery-issuer",
            fixture.signing_a.verifying_key().as_bytes()
        )
        .is_err());
    let mut changed = bytes.clone();
    let recipient_key = fixture.context.recovery_recipient_public_key(role);
    let recipient = recipient_key.as_bytes();
    let offset = changed
        .windows(recipient.len())
        .position(|window| window == recipient)
        .unwrap();
    changed[offset..offset + recipient.len()].copy_from_slice(
        fixture
            .context
            .recovery_recipient_public_key(role.peer())
            .as_bytes(),
    );
    assert!(TenantRootRecoveryReshareRoleCommandV1::decode_canonical_bytes(&changed).is_err());
    let mut changed_signature = bytes;
    *changed_signature.last_mut().unwrap() ^= 1;
    let changed =
        TenantRootRecoveryReshareRoleCommandV1::decode_canonical_bytes(&changed_signature).unwrap();
    assert!(changed
        .verify(role, "recovery-issuer", issuer.verifying_key().as_bytes())
        .is_err());
}
