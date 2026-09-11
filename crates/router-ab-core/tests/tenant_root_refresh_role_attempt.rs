use curve25519_dalek::scalar::Scalar;
use ed25519_dalek::SigningKey;
use rand_chacha::ChaCha20Rng;
use rand_core::SeedableRng;
use router_ab_core::{
    resolve_active_tenant_root_pair_binding_v1, tenant_root_restore_refresh_context_nonce_v1,
    verify_tenant_root_creation_evidence_v1, MpcPrfShareCommitmentWireV1,
    PendingTenantRootRefreshRoleAttemptV1, PendingTenantRootRestoreRefreshRoleAttemptV1,
    TenantRootActiveRoleBindingV1, TenantRootActiveRoleResolutionV1, TenantRootActiveRoleRowKeyV1,
    TenantRootActiveRootPairV1, TenantRootCeremonyContextV1, TenantRootCeremonyEpochsV1,
    TenantRootCeremonyNonceV1, TenantRootCeremonySessionIdV1, TenantRootControlPlaneAuthorityIdV1,
    TenantRootCustodyLineageId, TenantRootIdentityV1, TenantRootLifecycleReceiptDigestV1,
    TenantRootManagedRestoreRoleV1, TenantRootRefreshCommitmentTranscriptV1,
    TenantRootRefreshHpkeKeypairV1, TenantRootRestoreDestinationFingerprintV1,
    TenantRootRestoreRefreshRoleCommandV1, TenantRootRestoreSessionIdV1,
    TenantRootRoleRefreshCommandV1, TenantRootShareEpoch, TenantRootSignedRefreshCommitmentV1,
    TwoPartyDeriverRole, VerifiedTenantRootRefreshCommitmentPairV1,
    VerifiedTenantRootRefreshCommitmentV1, VerifiedTenantRootRestoreRefreshRoleCommandV1,
    VerifiedTenantRootRoleRefreshCommandV1, TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1,
};
use threshold_prf::{
    derive_two_party_root_share_refresh_commitments, RootShareRefreshCoefficient,
    RootShareRefreshContributionWire, SigningRootShare, SigningRootShareCommitment,
    TwoPartyRootShareCommitments,
};

const ISSUER_KEY_BYTES: [u8; 32] = [0x41; 32];
const ISSUER_KEY_ID: &str = "control-plane-issuer-v1";
const ISSUED_AT_MS: u64 = 1_000_000;
const EXPIRES_AT_MS: u64 = 1_030_000;
const CURRENT_EPOCH: u64 = 7;
const NEXT_EPOCH: u64 = 8;
const EXPECTED_REVISION: u64 = 4;

fn rng(seed: u8) -> ChaCha20Rng {
    ChaCha20Rng::from_seed([seed; 32])
}

fn identity() -> TenantRootIdentityV1 {
    TenantRootIdentityV1::new("org-1", "project-2", "production", "root-main", "v3")
        .expect("fixed identity")
}

fn lineage(seed: u8) -> TenantRootCustodyLineageId {
    TenantRootCustodyLineageId::from_bytes([seed; 16]).expect("fixed lineage")
}

fn context(session_seed: u8, lineage_seed: u8) -> TenantRootCeremonyContextV1 {
    TenantRootCeremonyContextV1::new(
        identity().digest().expect("identity digest"),
        lineage(lineage_seed),
        TenantRootCeremonyEpochsV1::refresh(
            TenantRootShareEpoch::new(CURRENT_EPOCH).expect("current epoch"),
            TenantRootShareEpoch::new(NEXT_EPOCH).expect("next epoch"),
        )
        .expect("refresh epochs"),
        TenantRootCeremonySessionIdV1::from_bytes([session_seed; 16]).expect("session id"),
        TenantRootCeremonyNonceV1::from_bytes([session_seed.wrapping_add(1); 32]).expect("nonce"),
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("refresh context")
}

fn role_key(role: TwoPartyDeriverRole) -> SigningKey {
    SigningKey::from_bytes(
        &[match role {
            TwoPartyDeriverRole::DeriverA => 0x51,
            TwoPartyDeriverRole::DeriverB => 0x61,
        }; 32],
    )
}

fn recipient(
    role: TwoPartyDeriverRole,
) -> (
    &'static str,
    router_ab_core::TenantRootRefreshHpkePublicKeyV1,
) {
    match role {
        TwoPartyDeriverRole::DeriverA => (
            "deriver-a-hpke-key-7",
            TenantRootRefreshHpkeKeypairV1::derive_from_ikm([0xa1; 32])
                .expect("recipient HPKE keypair")
                .public_key(),
        ),
        TwoPartyDeriverRole::DeriverB => (
            "deriver-b-hpke-key-8",
            TenantRootRefreshHpkeKeypairV1::derive_from_ikm([0xb1; 32])
                .expect("recipient HPKE keypair")
                .public_key(),
        ),
    }
}

fn share(role: TwoPartyDeriverRole, scalar: u64) -> SigningRootShare {
    SigningRootShare::from_canonical_bytes(role.share_id(), Scalar::from(scalar).to_bytes())
        .expect("fixed share")
}

fn commitment_wire(share: &SigningRootShare) -> MpcPrfShareCommitmentWireV1 {
    MpcPrfShareCommitmentWireV1::new(
        SigningRootShareCommitment::from_share(share)
            .to_bytes()
            .to_vec(),
    )
    .expect("commitment wire")
}

fn active_pair() -> TenantRootActiveRootPairV1 {
    let identity_digest = identity().digest().expect("identity digest");
    let custody_lineage = lineage(0x31);
    let epoch = TenantRootShareEpoch::new(CURRENT_EPOCH).expect("active epoch");
    let receipt = router_ab_core::TenantRootLifecycleReceiptDigestV1::from_bytes([0x71; 32])
        .expect("receipt");
    let binding_a = TenantRootActiveRoleBindingV1::new(
        TenantRootActiveRoleRowKeyV1::new(
            identity_digest,
            custody_lineage,
            epoch,
            TenantRootManagedRestoreRoleV1::DeriverA,
        ),
        commitment_wire(&share(TwoPartyDeriverRole::DeriverA, 12)),
        receipt,
    )
    .expect("Deriver A binding");
    let binding_b = TenantRootActiveRoleBindingV1::new(
        TenantRootActiveRoleRowKeyV1::new(
            identity_digest,
            custody_lineage,
            epoch,
            TenantRootManagedRestoreRoleV1::DeriverB,
        ),
        commitment_wire(&share(TwoPartyDeriverRole::DeriverB, 19)),
        receipt,
    )
    .expect("Deriver B binding");
    resolve_active_tenant_root_pair_binding_v1(
        identity_digest,
        &TenantRootActiveRoleResolutionV1::Active(binding_a),
        &TenantRootActiveRoleResolutionV1::Active(binding_b),
    )
    .expect("active pair resolution")
    .require_active()
    .expect("active pair")
    .clone()
}

fn raw_command(
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
) -> TenantRootRoleRefreshCommandV1 {
    TenantRootRoleRefreshCommandV1::sign(
        &active_pair(),
        context,
        role,
        EXPECTED_REVISION,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x44; 32]),
        ISSUED_AT_MS + 1,
        EXPIRES_AT_MS - 1,
        ISSUER_KEY_ID,
        &ISSUER_KEY_BYTES,
    )
    .expect("signed command")
}

fn verified_command(
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
) -> VerifiedTenantRootRoleRefreshCommandV1 {
    let command = raw_command(context, role);
    let issuer = SigningKey::from_bytes(&ISSUER_KEY_BYTES);
    command
        .verify(
            &active_pair(),
            context,
            role,
            EXPECTED_REVISION,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x44; 32]),
            ISSUER_KEY_ID,
            issuer.verifying_key().as_bytes(),
        )
        .expect("verified command")
}

fn active_binding(role: TwoPartyDeriverRole) -> TenantRootActiveRoleBindingV1 {
    let active = active_pair();
    match role {
        TwoPartyDeriverRole::DeriverA => active.deriver_a().clone(),
        TwoPartyDeriverRole::DeriverB => active.deriver_b().clone(),
    }
}

fn active_share(role: TwoPartyDeriverRole) -> SigningRootShare {
    share(
        role,
        match role {
            TwoPartyDeriverRole::DeriverA => 12,
            TwoPartyDeriverRole::DeriverB => 19,
        },
    )
}

fn pending(
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    coefficient_rng_seed: u8,
) -> PendingTenantRootRefreshRoleAttemptV1 {
    let signing_key = role_key(role);
    let verifying_key = signing_key.verifying_key().to_bytes();
    let (recipient_key_id, recipient_public_key) = recipient(role);
    PendingTenantRootRefreshRoleAttemptV1::new(
        verified_command(context, role),
        context.clone(),
        active_binding(role),
        active_share(role),
        &signing_key.to_bytes(),
        &verifying_key,
        recipient_key_id,
        recipient_public_key,
        ISSUED_AT_MS + 10,
        &mut rng(coefficient_rng_seed),
    )
    .expect("pending refresh role attempt")
}

fn coefficient(role: TwoPartyDeriverRole, seed: u8) -> RootShareRefreshCoefficient {
    RootShareRefreshCoefficient::random(role, &mut rng(seed))
}

fn verified_commitment(
    pending: &PendingTenantRootRefreshRoleAttemptV1,
) -> VerifiedTenantRootRefreshCommitmentV1 {
    let role = pending.role();
    let context = pending.commitment().transcript().context();
    let key = role_key(role);
    TenantRootSignedRefreshCommitmentV1::decode_and_verify_canonical_bytes(
        pending.commitment_bytes(),
        context,
        role,
        context.signing_key_id(role),
        key.verifying_key().as_bytes(),
    )
    .expect("verified commitment")
}

fn commitment_pair(
    pending_a: &PendingTenantRootRefreshRoleAttemptV1,
    pending_b: &PendingTenantRootRefreshRoleAttemptV1,
) -> VerifiedTenantRootRefreshCommitmentPairV1 {
    VerifiedTenantRootRefreshCommitmentPairV1::new(
        verified_commitment(pending_a),
        verified_commitment(pending_b),
    )
    .expect("verified commitment pair")
}

fn current_public_pair() -> TwoPartyRootShareCommitments {
    TwoPartyRootShareCommitments::from_shares(
        &active_share(TwoPartyDeriverRole::DeriverA),
        &active_share(TwoPartyDeriverRole::DeriverB),
    )
    .expect("current public pair")
}

fn contribution_for(role: TwoPartyDeriverRole, peer_seed: u8) -> RootShareRefreshContributionWire {
    coefficient(role.peer(), peer_seed).contribution_for(role)
}

struct RestoreScope {
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    restore_session_id: TenantRootRestoreSessionIdV1,
    manifest_digest: [u8; 32],
    deriver_a_receipt: TenantRootLifecycleReceiptDigestV1,
    deriver_b_receipt: TenantRootLifecycleReceiptDigestV1,
    deriver_a_commitment: MpcPrfShareCommitmentWireV1,
    deriver_b_commitment: MpcPrfShareCommitmentWireV1,
    stable_root_commitment: [u8; 32],
}

fn restore_scope() -> RestoreScope {
    let deriver_a_share = active_share(TwoPartyDeriverRole::DeriverA);
    let deriver_b_share = active_share(TwoPartyDeriverRole::DeriverB);
    let public_pair = TwoPartyRootShareCommitments::from_shares(&deriver_a_share, &deriver_b_share)
        .expect("restore source public pair");
    RestoreScope {
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1::from_bytes([0x91; 32])
            .expect("destination fingerprint"),
        restore_session_id: TenantRootRestoreSessionIdV1::from_bytes([0x92; 16])
            .expect("restore session"),
        manifest_digest: [0x93; 32],
        deriver_a_receipt: TenantRootLifecycleReceiptDigestV1::from_bytes([0x94; 32])
            .expect("Deriver A receipt"),
        deriver_b_receipt: TenantRootLifecycleReceiptDigestV1::from_bytes([0x95; 32])
            .expect("Deriver B receipt"),
        deriver_a_commitment: commitment_wire(&deriver_a_share),
        deriver_b_commitment: commitment_wire(&deriver_b_share),
        stable_root_commitment: public_pair.root().to_bytes(),
    }
}

fn restore_context(scope: &RestoreScope, ceremony_session_seed: u8) -> TenantRootCeremonyContextV1 {
    let identity_digest = identity().digest().expect("identity digest");
    let custody_lineage = lineage(0x31);
    let ceremony_session_id =
        TenantRootCeremonySessionIdV1::from_bytes([ceremony_session_seed; 16])
            .expect("ceremony session");
    let nonce = tenant_root_restore_refresh_context_nonce_v1(
        identity_digest,
        custody_lineage,
        ceremony_session_id,
        scope.destination_fingerprint,
        scope.restore_session_id,
        scope.manifest_digest,
        scope.deriver_a_receipt,
        scope.deriver_b_receipt,
        &scope.deriver_a_commitment,
        &scope.deriver_b_commitment,
        scope.stable_root_commitment,
    )
    .expect("restore shared scope nonce");
    TenantRootCeremonyContextV1::new(
        identity_digest,
        custody_lineage,
        TenantRootCeremonyEpochsV1::create(),
        ceremony_session_id,
        nonce,
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("restore create context")
}

fn restore_command(
    scope: &RestoreScope,
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
) -> VerifiedTenantRootRestoreRefreshRoleCommandV1 {
    let command = TenantRootRestoreRefreshRoleCommandV1::sign(
        context,
        scope.destination_fingerprint,
        scope.restore_session_id,
        scope.manifest_digest,
        scope.deriver_a_receipt,
        scope.deriver_b_receipt,
        scope.deriver_a_commitment.clone(),
        scope.deriver_b_commitment.clone(),
        scope.stable_root_commitment,
        role,
        ISSUER_KEY_ID,
        &ISSUER_KEY_BYTES,
    )
    .expect("signed restore refresh command");
    let issuer_key = SigningKey::from_bytes(&ISSUER_KEY_BYTES);
    command
        .verify(ISSUER_KEY_ID, issuer_key.verifying_key().as_bytes())
        .expect("verified restore refresh command")
}

fn restore_pending(
    scope: &RestoreScope,
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    coefficient_rng_seed: u8,
) -> PendingTenantRootRestoreRefreshRoleAttemptV1 {
    let signing_key = role_key(role);
    let signing_key_bytes = signing_key.to_bytes();
    let verifying_key_bytes = signing_key.verifying_key().to_bytes();
    let (recipient_key_id, recipient_public_key) = recipient(role);
    PendingTenantRootRestoreRefreshRoleAttemptV1::from_verified_command(
        restore_command(scope, context, role),
        active_share(role),
        &signing_key_bytes,
        &verifying_key_bytes,
        recipient_key_id,
        recipient_public_key,
        ISSUED_AT_MS + 10,
        &mut rng(coefficient_rng_seed),
    )
    .expect("pending restore refresh role attempt")
}

fn verified_restore_commitment(
    pending: &PendingTenantRootRestoreRefreshRoleAttemptV1,
) -> VerifiedTenantRootRefreshCommitmentV1 {
    let role = pending.role();
    let context = pending.commitment().transcript().context();
    let key = role_key(role);
    TenantRootSignedRefreshCommitmentV1::decode_and_verify_restore_canonical_bytes(
        pending.commitment_bytes(),
        context,
        role,
        context.signing_key_id(role),
        key.verifying_key().as_bytes(),
    )
    .expect("verified restore commitment")
}

fn restore_commitment_pair(
    pending_a: &PendingTenantRootRestoreRefreshRoleAttemptV1,
    pending_b: &PendingTenantRootRestoreRefreshRoleAttemptV1,
) -> VerifiedTenantRootRefreshCommitmentPairV1 {
    VerifiedTenantRootRefreshCommitmentPairV1::new(
        verified_restore_commitment(pending_a),
        verified_restore_commitment(pending_b),
    )
    .expect("verified restore commitment pair")
}

#[test]
fn both_roles_refresh_to_the_exact_predicted_next_pair() {
    let ceremony_context = context(0x11, 0x31);
    let pending_a = pending(&ceremony_context, TwoPartyDeriverRole::DeriverA, 0xa1);
    let pending_b = pending(&ceremony_context, TwoPartyDeriverRole::DeriverB, 0xb1);
    assert_eq!(
        pending_a.commitment_bytes(),
        pending_a.commitment().canonical_bytes()
    );
    assert_eq!(
        pending_b.commitment_bytes(),
        pending_b.commitment().canonical_bytes()
    );

    let pair_for_a = commitment_pair(&pending_a, &pending_b);
    let pair_for_b = commitment_pair(&pending_a, &pending_b);
    let expected_public_pair = derive_two_party_root_share_refresh_commitments(
        &current_public_pair(),
        coefficient(TwoPartyDeriverRole::DeriverA, 0xa1).commitment(),
        coefficient(TwoPartyDeriverRole::DeriverB, 0xb1).commitment(),
    )
    .expect("predicted next pair");

    let completed_a = pending_a
        .finalize(
            pair_for_a,
            pending_b.contribution_for_peer(),
            &mut rng(0xc1),
        )
        .expect("Deriver A refresh attempt");
    let completed_b = pending_b
        .finalize(
            pair_for_b,
            contribution_for(TwoPartyDeriverRole::DeriverB, 0xa1),
            &mut rng(0xd1),
        )
        .expect("Deriver B refresh attempt");
    let (command_a, share_a, evidence_a) = completed_a.into_parts();
    let (command_b, share_b, evidence_b) = completed_b.into_parts();
    let share_a = share_a.to_share().expect("Deriver A next share");
    let share_b = share_b.to_share().expect("Deriver B next share");

    assert_eq!(command_a.role(), TwoPartyDeriverRole::DeriverA);
    assert_eq!(command_b.role(), TwoPartyDeriverRole::DeriverB);
    assert_eq!(
        SigningRootShareCommitment::from_share(&share_a),
        expected_public_pair.deriver_a()
    );
    assert_eq!(
        SigningRootShareCommitment::from_share(&share_b),
        expected_public_pair.deriver_b()
    );
    assert_eq!(
        evidence_a.evidence().transcript().commitment(),
        expected_public_pair.deriver_a()
    );
    assert_eq!(
        evidence_b.evidence().transcript().commitment(),
        expected_public_pair.deriver_b()
    );
    assert_eq!(
        evidence_a.evidence().transcript().peer_commitment(),
        expected_public_pair.deriver_b()
    );
    assert_eq!(
        evidence_b.evidence().transcript().peer_commitment(),
        expected_public_pair.deriver_a()
    );
    assert!(!evidence_a.canonical_bytes().is_empty());
    assert!(!evidence_b.canonical_bytes().is_empty());
}

#[test]
fn constructor_rejects_freshness_context_binding_share_and_key_substitution() {
    let ceremony_context = context(0x21, 0x31);
    let role = TwoPartyDeriverRole::DeriverA;
    let signing_key = role_key(role);
    let verifying_key = signing_key.verifying_key().to_bytes();
    let (recipient_key_id, recipient_public_key) = recipient(role);

    let mut command = verified_command(&ceremony_context, role);
    assert!(PendingTenantRootRefreshRoleAttemptV1::new(
        command,
        ceremony_context.clone(),
        active_binding(role),
        active_share(role),
        &signing_key.to_bytes(),
        &verifying_key,
        recipient_key_id,
        recipient_public_key,
        ISSUED_AT_MS - TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1,
        &mut rng(0xe1),
    )
    .is_err());

    command = verified_command(&ceremony_context, role);
    assert!(PendingTenantRootRefreshRoleAttemptV1::new(
        command,
        context(0x22, 0x31),
        active_binding(role),
        active_share(role),
        &signing_key.to_bytes(),
        &verifying_key,
        recipient_key_id,
        recipient_public_key,
        ISSUED_AT_MS + 10,
        &mut rng(0xe2),
    )
    .is_err());

    command = verified_command(&ceremony_context, role);
    assert!(PendingTenantRootRefreshRoleAttemptV1::new(
        command,
        ceremony_context.clone(),
        active_binding(TwoPartyDeriverRole::DeriverB),
        active_share(role),
        &signing_key.to_bytes(),
        &verifying_key,
        recipient_key_id,
        recipient_public_key,
        ISSUED_AT_MS + 10,
        &mut rng(0xe3),
    )
    .is_err());

    command = verified_command(&ceremony_context, role);
    assert!(PendingTenantRootRefreshRoleAttemptV1::new(
        command,
        ceremony_context.clone(),
        active_binding(role),
        active_share(TwoPartyDeriverRole::DeriverB),
        &signing_key.to_bytes(),
        &verifying_key,
        recipient_key_id,
        recipient_public_key,
        ISSUED_AT_MS + 10,
        &mut rng(0xe4),
    )
    .is_err());

    command = verified_command(&ceremony_context, role);
    let wrong_key = role_key(TwoPartyDeriverRole::DeriverB);
    assert!(PendingTenantRootRefreshRoleAttemptV1::new(
        command,
        ceremony_context,
        active_binding(role),
        active_share(role),
        &wrong_key.to_bytes(),
        &verifying_key,
        recipient_key_id,
        recipient_public_key,
        ISSUED_AT_MS + 10,
        &mut rng(0xe5),
    )
    .is_err());
}

#[test]
fn finalize_rejects_substituted_pair_peer_contribution_and_tamper() {
    let ceremony_context = context(0x31, 0x31);
    let pending_a = pending(&ceremony_context, TwoPartyDeriverRole::DeriverA, 0xf1);
    let pending_b = pending(&ceremony_context, TwoPartyDeriverRole::DeriverB, 0xf2);
    let changed_a = pending(&ceremony_context, TwoPartyDeriverRole::DeriverA, 0xf3);
    let bad_pair = commitment_pair(&changed_a, &pending_b);
    assert!(pending_a
        .finalize(
            bad_pair,
            contribution_for(TwoPartyDeriverRole::DeriverA, 0xf2),
            &mut rng(0xf4),
        )
        .is_err());

    let pending_a = pending(&ceremony_context, TwoPartyDeriverRole::DeriverA, 0xf5);
    let pending_b = pending(&ceremony_context, TwoPartyDeriverRole::DeriverB, 0xf6);
    let pair = commitment_pair(&pending_a, &pending_b);
    let wrong_source = coefficient(TwoPartyDeriverRole::DeriverA, 0xf5)
        .contribution_for(TwoPartyDeriverRole::DeriverA);
    assert!(pending_a
        .finalize(pair, wrong_source, &mut rng(0xf7))
        .is_err());

    let pending_a = pending(&ceremony_context, TwoPartyDeriverRole::DeriverA, 0xf8);
    let pending_b = pending(&ceremony_context, TwoPartyDeriverRole::DeriverB, 0xf9);
    let pair = commitment_pair(&pending_a, &pending_b);
    let mut tampered = contribution_for(TwoPartyDeriverRole::DeriverA, 0xf9).to_bytes();
    tampered[4] ^= 1;
    let tampered = RootShareRefreshContributionWire::decode(tampered).expect("tampered wire");
    assert!(pending_a.finalize(pair, tampered, &mut rng(0xfa)).is_err());
}

#[test]
fn finalize_rejects_coefficient_cancellation() {
    let ceremony_context = context(0x41, 0x31);
    let role = TwoPartyDeriverRole::DeriverA;
    let coefficient_seed = 0xab;
    let pending_a = pending(&ceremony_context, role, coefficient_seed);

    let mut coefficient_rng = rng(coefficient_seed);
    let local_scalar = Scalar::random(&mut coefficient_rng);
    let cancelling_peer =
        RootShareRefreshCoefficient::from_canonical_bytes(role.peer(), (-local_scalar).to_bytes())
            .expect("cancelling peer coefficient");
    let (recipient_key_id, recipient_public_key) = recipient(role.peer());
    let peer_transcript = TenantRootRefreshCommitmentTranscriptV1::new(
        ceremony_context.clone(),
        cancelling_peer.commitment(),
        recipient_key_id,
        recipient_public_key,
    )
    .expect("peer commitment transcript");
    let peer_signed = TenantRootSignedRefreshCommitmentV1::sign(
        peer_transcript,
        &role_key(role.peer()).to_bytes(),
    )
    .expect("peer signed commitment");
    let peer_wire = peer_signed.canonical_bytes().expect("peer wire");
    let peer_commitment = TenantRootSignedRefreshCommitmentV1::decode_and_verify_canonical_bytes(
        &peer_wire,
        &ceremony_context,
        role.peer(),
        ceremony_context.signing_key_id(role.peer()),
        role_key(role.peer()).verifying_key().as_bytes(),
    )
    .expect("verified cancelling peer commitment");
    let pair = VerifiedTenantRootRefreshCommitmentPairV1::new(
        verified_commitment(&pending_a),
        peer_commitment,
    )
    .expect("cancelling commitment pair");
    let peer_contribution = cancelling_peer.contribution_for(role);
    assert!(pending_a
        .finalize(pair, peer_contribution, &mut rng(0xac))
        .is_err());
}

#[test]
fn restore_refresh_produces_epoch_one_creation_evidence_without_changing_root() {
    let scope = restore_scope();
    let ceremony_context = restore_context(&scope, 0x51);
    let pending_a = restore_pending(
        &scope,
        &ceremony_context,
        TwoPartyDeriverRole::DeriverA,
        0xa1,
    );
    let pending_b = restore_pending(
        &scope,
        &ceremony_context,
        TwoPartyDeriverRole::DeriverB,
        0xb1,
    );
    let pair_for_a = restore_commitment_pair(&pending_a, &pending_b);
    let pair_for_b = restore_commitment_pair(&pending_a, &pending_b);
    let source_public_pair = TwoPartyRootShareCommitments::from_shares(
        &active_share(TwoPartyDeriverRole::DeriverA),
        &active_share(TwoPartyDeriverRole::DeriverB),
    )
    .expect("source public pair");
    let expected_public_pair = derive_two_party_root_share_refresh_commitments(
        &source_public_pair,
        coefficient(TwoPartyDeriverRole::DeriverA, 0xa1).commitment(),
        coefficient(TwoPartyDeriverRole::DeriverB, 0xb1).commitment(),
    )
    .expect("expected refreshed public pair");

    let completed_a = pending_a
        .finalize(
            pair_for_a,
            pending_b.contribution_for_peer(),
            &mut rng(0xc1),
        )
        .expect("Deriver A restore refresh attempt");
    let completed_b = pending_b
        .finalize(
            pair_for_b,
            coefficient(TwoPartyDeriverRole::DeriverA, 0xa1)
                .contribution_for(TwoPartyDeriverRole::DeriverB),
            &mut rng(0xd1),
        )
        .expect("Deriver B restore refresh attempt");
    let (command_a, share_a, evidence_a) = completed_a.into_parts();
    let (command_b, share_b, evidence_b) = completed_b.into_parts();
    let share_a = share_a.to_share().expect("Deriver A refreshed share");
    let share_b = share_b.to_share().expect("Deriver B refreshed share");

    assert_eq!(command_a.role(), TwoPartyDeriverRole::DeriverA);
    assert_eq!(command_b.role(), TwoPartyDeriverRole::DeriverB);
    assert_eq!(command_a.context(), &ceremony_context);
    assert_eq!(command_b.context(), &ceremony_context);
    assert!(matches!(
        ceremony_context.epochs(),
        TenantRootCeremonyEpochsV1::Create {
            next: TenantRootShareEpoch::INITIAL
        }
    ));
    assert_eq!(expected_public_pair.root(), source_public_pair.root());
    assert_ne!(
        share_a.to_bytes(),
        active_share(TwoPartyDeriverRole::DeriverA).to_bytes()
    );
    assert_ne!(
        share_b.to_bytes(),
        active_share(TwoPartyDeriverRole::DeriverB).to_bytes()
    );
    assert_eq!(
        SigningRootShareCommitment::from_share(&share_a),
        expected_public_pair.deriver_a()
    );
    assert_eq!(
        SigningRootShareCommitment::from_share(&share_b),
        expected_public_pair.deriver_b()
    );
    assert_eq!(
        evidence_a.evidence().transcript().context(),
        &ceremony_context
    );
    assert_eq!(
        evidence_b.evidence().transcript().context(),
        &ceremony_context
    );
    let creation_pair =
        verify_tenant_root_creation_evidence_v1(evidence_a.evidence(), evidence_b.evidence())
            .expect("verified epoch-one creation evidence");
    assert_eq!(creation_pair, expected_public_pair);
}

#[test]
fn restore_refresh_rejects_foreign_scope_and_peer_contribution() {
    let scope = restore_scope();
    let ceremony_context = restore_context(&scope, 0x61);
    let foreign_context = restore_context(&scope, 0x62);
    let pending_a = restore_pending(
        &scope,
        &ceremony_context,
        TwoPartyDeriverRole::DeriverA,
        0xe1,
    );
    let foreign_pending_b = restore_pending(
        &scope,
        &foreign_context,
        TwoPartyDeriverRole::DeriverB,
        0xe2,
    );
    assert!(VerifiedTenantRootRefreshCommitmentPairV1::new(
        verified_restore_commitment(&pending_a),
        verified_restore_commitment(&foreign_pending_b),
    )
    .is_err());

    let pending_a = restore_pending(
        &scope,
        &ceremony_context,
        TwoPartyDeriverRole::DeriverA,
        0xe3,
    );
    let pending_b = restore_pending(
        &scope,
        &ceremony_context,
        TwoPartyDeriverRole::DeriverB,
        0xe4,
    );
    let pair = restore_commitment_pair(&pending_a, &pending_b);
    let wrong_peer_contribution = coefficient(TwoPartyDeriverRole::DeriverB, 0xe5)
        .contribution_for(TwoPartyDeriverRole::DeriverA);
    assert!(pending_a
        .finalize(pair, wrong_peer_contribution, &mut rng(0xe6))
        .is_err());
}
