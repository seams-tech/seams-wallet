use ed25519_dalek::SigningKey;
use router_ab_core::{
    combine_mpc_prf_stable_proof_bundles_with_threshold_backend_v2,
    combine_mpc_prf_stable_recipient_output_from_proof_bundle_payloads_v2,
    decode_mpc_prf_stable_recipient_proof_bundle_payload_v2,
    evaluate_mpc_prf_stable_signer_partial_with_threshold_backend_v2,
    plan_mpc_prf_stable_purpose_binding_from_authenticated_custody_digest_v2,
    plan_mpc_prf_stable_purpose_binding_v2, resolve_active_tenant_root_pair_binding_v1,
    resolve_authoritative_active_tenant_root_pair_binding_v1,
    verify_mpc_prf_stable_partial_with_threshold_backend_v2, MpcPrfStablePurposeBindingPlanV2,
    MpcPrfStableRecipientProofBundlePayloadV2, MpcPrfStableThresholdCombineInputV2,
    MpcPrfStableThresholdSignerInputV2, PublicDigest32, RecipientProofBundleEncryptionRequestV1,
    Role, SignerIdentityV1, StableTenantDerivationContextV2, TenantRootAcceptedLossReceiptV1,
    TenantRootAcceptedPermanentLossAuthorizationBindingV1, TenantRootActivationReceiptTransitionV1,
    TenantRootActivePairMismatchV1, TenantRootActivePairResolutionV1,
    TenantRootActiveRoleBindingV1, TenantRootActiveRoleResolutionV1, TenantRootActiveRoleRowKeyV1,
    TenantRootActiveRootPairV1, TenantRootBackupPolicyV1, TenantRootCanaryCurveFamilyV1,
    TenantRootCanaryReceiptsV1, TenantRootCeremonyContextV1, TenantRootCeremonyEpochsV1,
    TenantRootCeremonyNonceV1, TenantRootCeremonySessionIdV1, TenantRootControlPlaneAuthorityIdV1,
    TenantRootCreationStateV1, TenantRootCustodyBindingV1, TenantRootCustodyLineageId,
    TenantRootDerivationNonceV1, TenantRootDerivationOperationIdV1,
    TenantRootDerivationSessionIdV1, TenantRootDeriverIdentitiesV1, TenantRootEmptyCreationV1,
    TenantRootEpochCommitmentsV1, TenantRootIdentityDigestV1, TenantRootIdentityV1,
    TenantRootLifecycleReceiptDigestV1, TenantRootManagedRestoreAvailableV1,
    TenantRootManagedRestoreCapabilityV1, TenantRootManagedRestoreInstallationReceiptV1,
    TenantRootManagedRestoreInstallingV1, TenantRootManagedRestorePeerVerificationReceiptV1,
    TenantRootManagedRestoreRoleV1, TenantRootManagedRestoreStateV1,
    TenantRootPendingCleanupReceiptV1, TenantRootProtocolDigestV1,
    TenantRootProviderCanaryReceiptBindingV1, TenantRootRefreshFailureV1,
    TenantRootRoleBackupReceiptsV1, TenantRootRoleInstallationReceiptsV1,
    TenantRootRoleRetirementReceiptsV1, TenantRootRoleUnavailableReceiptV1, TenantRootShareEpoch,
    TenantRootSignedAcceptedPermanentLossAuthorizationV1, TenantRootSignedProviderCanaryReceiptV1,
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
    VerifiedTenantRootProviderCanaryReceiptV1, VerifiedTenantRootShareInstallationEvidenceV1,
    TENANT_ROOT_MAX_LIFETIME_MS_V1,
};
use threshold_prf::{
    apply_two_party_root_share_refresh, PrfPurpose, RootShareRefreshCoefficient, SigningRootShare,
    TwoPartyDeriverRole, TwoPartyRootShareCommitments,
};

mod support;

use support::{
    fixed_share, identity, lifecycle_digest as digest, rng06, share_wire, signed_installation_wire,
    EXPIRES_AT_MS, ISSUED_AT_MS,
};

fn lineage(seed: u8) -> TenantRootCustodyLineageId {
    TenantRootCustodyLineageId::from_bytes([seed; 16]).unwrap()
}

fn context(lineage: TenantRootCustodyLineageId, session_seed: u8) -> TenantRootCeremonyContextV1 {
    TenantRootCeremonyContextV1::new(
        identity().digest().unwrap(),
        lineage,
        TenantRootCeremonyEpochsV1::create(),
        TenantRootCeremonySessionIdV1::from_bytes([session_seed; 16]).unwrap(),
        TenantRootCeremonyNonceV1::from_bytes([0x41; 32]).unwrap(),
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .unwrap()
}

fn refresh_context(
    lineage: TenantRootCustodyLineageId,
    current: u64,
    next: u64,
    session_seed: u8,
) -> TenantRootCeremonyContextV1 {
    refresh_context_at(
        lineage,
        current,
        next,
        session_seed,
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
    )
}

fn refresh_context_at(
    lineage: TenantRootCustodyLineageId,
    current: u64,
    next: u64,
    session_seed: u8,
    issued_at_ms: u64,
    expires_at_ms: u64,
) -> TenantRootCeremonyContextV1 {
    TenantRootCeremonyContextV1::new(
        identity().digest().unwrap(),
        lineage,
        TenantRootCeremonyEpochsV1::refresh(
            TenantRootShareEpoch::new(current).unwrap(),
            TenantRootShareEpoch::new(next).unwrap(),
        )
        .unwrap(),
        TenantRootCeremonySessionIdV1::from_bytes([session_seed; 16]).unwrap(),
        TenantRootCeremonyNonceV1::from_bytes([0x42; 32]).unwrap(),
        issued_at_ms,
        expires_at_ms,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .unwrap()
}

fn managed_restore_capability(
    active: &router_ab_core::TenantRootActiveRefreshV1,
    role: TenantRootManagedRestoreRoleV1,
    digest_seed: u8,
    issued_at_ms: u64,
    expires_at_ms: u64,
) -> TenantRootManagedRestoreCapabilityV1 {
    TenantRootManagedRestoreCapabilityV1::new(
        digest(digest_seed),
        active.identity().digest().unwrap(),
        active.custody_lineage(),
        role,
        active.current().epoch(),
        active.current().activation().digest(),
        issued_at_ms,
        expires_at_ms,
    )
    .unwrap()
}

fn managed_restore_installation(
    active: &router_ab_core::TenantRootActiveRefreshV1,
    capability: &TenantRootManagedRestoreCapabilityV1,
    receipt_seed: u8,
    installed_at_ms: u64,
) -> TenantRootManagedRestoreInstallationReceiptV1 {
    let commitment = match capability.role() {
        TenantRootManagedRestoreRoleV1::DeriverA => {
            active.current().verified().commitments().deriver_a()
        }
        TenantRootManagedRestoreRoleV1::DeriverB => {
            active.current().verified().commitments().deriver_b()
        }
    };
    TenantRootManagedRestoreInstallationReceiptV1::new(
        digest(receipt_seed),
        capability.digest(),
        active.identity().digest().unwrap(),
        active.custody_lineage(),
        capability.role(),
        active.current().epoch(),
        active.current().activation().digest(),
        commitment.clone(),
        installed_at_ms,
    )
    .unwrap()
}

fn managed_restore_peer_receipt(
    active: &router_ab_core::TenantRootActiveRefreshV1,
    restored_role: TenantRootManagedRestoreRoleV1,
    receipt_seed: u8,
    verified_at_ms: u64,
) -> TenantRootManagedRestorePeerVerificationReceiptV1 {
    let role = restored_role.peer();
    let commitment = match role {
        TenantRootManagedRestoreRoleV1::DeriverA => {
            active.current().verified().commitments().deriver_a()
        }
        TenantRootManagedRestoreRoleV1::DeriverB => {
            active.current().verified().commitments().deriver_b()
        }
    };
    TenantRootManagedRestorePeerVerificationReceiptV1::new(
        digest(receipt_seed),
        active.identity().digest().unwrap(),
        active.custody_lineage(),
        role,
        active.current().epoch(),
        active.current().activation().digest(),
        commitment.clone(),
        verified_at_ms,
    )
    .unwrap()
}

fn authenticated_evidence(
    context: TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    share: &SigningRootShare,
    peer: &SigningRootShare,
    proof_seed: u8,
) -> VerifiedTenantRootShareInstallationEvidenceV1 {
    signed_installation_wire(context, role, share, peer, proof_seed)
        .evidence()
        .clone()
}

fn evidence_pair(
    context: &TenantRootCeremonyContextV1,
) -> (
    VerifiedTenantRootShareInstallationEvidenceV1,
    VerifiedTenantRootShareInstallationEvidenceV1,
    TwoPartyRootShareCommitments,
) {
    let share_a = fixed_share(TwoPartyDeriverRole::DeriverA, 12);
    let share_b = fixed_share(TwoPartyDeriverRole::DeriverB, 19);
    evidence_pair_for_shares(context, &share_a, &share_b, 1, 2)
}

fn evidence_pair_for_shares(
    context: &TenantRootCeremonyContextV1,
    share_a: &SigningRootShare,
    share_b: &SigningRootShare,
    proof_seed_a: u8,
    proof_seed_b: u8,
) -> (
    VerifiedTenantRootShareInstallationEvidenceV1,
    VerifiedTenantRootShareInstallationEvidenceV1,
    TwoPartyRootShareCommitments,
) {
    let commitments = TwoPartyRootShareCommitments::from_shares(&share_a, &share_b).unwrap();
    (
        authenticated_evidence(
            context.clone(),
            TwoPartyDeriverRole::DeriverA,
            &share_a,
            &share_b,
            proof_seed_a,
        ),
        authenticated_evidence(
            context.clone(),
            TwoPartyDeriverRole::DeriverB,
            &share_b,
            &share_a,
            proof_seed_b,
        ),
        commitments,
    )
}

/// Refreshes both shares with coefficients drawn from seeds `seed` and `seed + 1`.
fn refreshed_pair(
    current_a: &SigningRootShare,
    current_b: &SigningRootShare,
    seed: u8,
) -> (SigningRootShare, SigningRootShare) {
    let coefficient_a =
        RootShareRefreshCoefficient::random(TwoPartyDeriverRole::DeriverA, &mut rng06(seed));
    let coefficient_b =
        RootShareRefreshCoefficient::random(TwoPartyDeriverRole::DeriverB, &mut rng06(seed + 1));
    let refreshed = |current, recipient| {
        let contribution_a = coefficient_a
            .commitment()
            .verify_contribution(coefficient_a.contribution_for(recipient))
            .unwrap();
        let contribution_b = coefficient_b
            .commitment()
            .verify_contribution(coefficient_b.contribution_for(recipient))
            .unwrap();
        apply_two_party_root_share_refresh(current, contribution_a, contribution_b).unwrap()
    };
    (
        refreshed(current_a, TwoPartyDeriverRole::DeriverA),
        refreshed(current_b, TwoPartyDeriverRole::DeriverB),
    )
}

/// Refreshes the active pair as `refreshed_pair` does and builds the refreshed shares'
/// activation evidence with proof seeds `seed + 2` and `seed + 3`.
fn refresh_evidence(
    context: &TenantRootCeremonyContextV1,
    active: &router_ab_core::TenantRootActiveRefreshV1,
    current_a: &SigningRootShare,
    current_b: &SigningRootShare,
    seed: u8,
    expected_control_plane_revision: u64,
) -> (
    SigningRootShare,
    SigningRootShare,
    support::RefreshActivationEvidenceFixture,
) {
    let (next_a, next_b) = refreshed_pair(current_a, current_b, seed);
    let fixture = support::refresh_activation_evidence_fixture(
        context.clone(),
        active.current().verified().commitments(),
        &next_a,
        &next_b,
        seed + 2,
        seed + 3,
        expected_control_plane_revision,
    );
    (next_a, next_b, fixture)
}

fn active_refresh_state(
    lineage: TenantRootCustodyLineageId,
) -> (
    router_ab_core::TenantRootActiveRefreshV1,
    SigningRootShare,
    SigningRootShare,
) {
    let creation_context = context(lineage, 0x71);
    let (verified, bundle) =
        verified_creation_with_managed_bundle(lineage, creation_context, 21, 22);
    let activation = support::initial_activation_receipt(&bundle, 1_020_000);
    let active = verified.activate(activation).unwrap().into_refresh_state();
    let share_a = fixed_share(TwoPartyDeriverRole::DeriverA, 12);
    let share_b = fixed_share(TwoPartyDeriverRole::DeriverB, 19);
    (active, share_a, share_b)
}

fn verified_creation_with_managed_bundle(
    lineage: TenantRootCustodyLineageId,
    creation_context: TenantRootCeremonyContextV1,
    proof_seed_a: u8,
    proof_seed_b: u8,
) -> (
    router_ab_core::TenantRootVerifiedCreationV1,
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
) {
    let share_a = fixed_share(TwoPartyDeriverRole::DeriverA, 12);
    let share_b = fixed_share(TwoPartyDeriverRole::DeriverB, 19);
    let fixture = support::initial_activation_evidence_fixture(
        creation_context.clone(),
        &share_a,
        &share_b,
        proof_seed_a,
        proof_seed_b,
    );
    let support::InitialActivationEvidenceFixture {
        bundle,
        evidence_a,
        evidence_b,
        installation_receipts,
        backup_policy,
        canary_receipts,
    } = fixture;
    let verified = TenantRootEmptyCreationV1::new(identity(), lineage)
        .start(&creation_context)
        .unwrap()
        .verify(
            &evidence_a,
            &evidence_b,
            installation_receipts,
            backup_policy,
            canary_receipts,
            1_010_000,
        )
        .unwrap();
    (verified, bundle)
}

fn advance_active_refresh(
    active: router_ab_core::TenantRootActiveRefreshV1,
    current_a: &SigningRootShare,
    current_b: &SigningRootShare,
) -> (
    router_ab_core::TenantRootActiveRefreshV1,
    SigningRootShare,
    SigningRootShare,
) {
    let lineage = active.custody_lineage();
    let current_epoch = active.current().epoch();
    let next_epoch = current_epoch.next().unwrap();
    let refresh_context = refresh_context(
        lineage,
        current_epoch.get().get(),
        next_epoch.get().get(),
        0x7a,
    );
    let (next_a, next_b, fixture) =
        refresh_evidence(&refresh_context, &active, current_a, current_b, 71, 5);
    let verified = active
        .start(&refresh_context)
        .unwrap()
        .verify(
            &fixture.evidence_a,
            &fixture.evidence_b,
            fixture.installation_receipts,
            fixture.backup_policy,
            fixture.canary_receipts,
            1_010_000,
        )
        .unwrap();
    let activation = support::refresh_activation_receipt(&fixture.bundle, 1_020_000);
    let active = verified
        .activate(activation)
        .unwrap()
        .finish_retirement(
            TenantRootRoleRetirementReceiptsV1::new(digest(76), digest(77), 1_021_000).unwrap(),
        )
        .unwrap();
    (active, next_a, next_b)
}

fn stable_context_digest(
    stable_context: &StableTenantDerivationContextV2,
) -> TenantRootProtocolDigestV1 {
    stable_context.digest().expect("stable context digest")
}

fn custody_binding(
    active: &router_ab_core::TenantRootActiveRefreshV1,
    stable_context: &StableTenantDerivationContextV2,
) -> TenantRootCustodyBindingV1 {
    TenantRootCustodyBindingV1::from_active(
        active,
        TenantRootDeriverIdentitiesV1::new("deriver-a-runtime-7", "deriver-b-runtime-9").unwrap(),
        TenantRootDerivationOperationIdV1::from_bytes([0x81; 16]).unwrap(),
        TenantRootDerivationSessionIdV1::from_bytes([0x82; 16]).unwrap(),
        TenantRootDerivationNonceV1::from_bytes([0x83; 32]).unwrap(),
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
        stable_context,
        TenantRootProtocolDigestV1::from_bytes([0x84; 32]).expect("non-zero protocol digest"),
    )
    .unwrap()
}

fn active_role_binding(
    active: &router_ab_core::TenantRootActiveRefreshV1,
    role: TenantRootManagedRestoreRoleV1,
    activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
) -> TenantRootActiveRoleBindingV1 {
    let share_commitment = match role {
        TenantRootManagedRestoreRoleV1::DeriverA => active
            .current()
            .verified()
            .commitments()
            .deriver_a()
            .clone(),
        TenantRootManagedRestoreRoleV1::DeriverB => active
            .current()
            .verified()
            .commitments()
            .deriver_b()
            .clone(),
    };
    TenantRootActiveRoleBindingV1::new(
        TenantRootActiveRoleRowKeyV1::new(
            active.identity().digest().unwrap(),
            active.custody_lineage(),
            active.current().epoch(),
            role,
        ),
        share_commitment,
        activation_receipt_digest,
    )
    .unwrap()
}

fn active_role_resolution(
    active: &router_ab_core::TenantRootActiveRefreshV1,
    role: TenantRootManagedRestoreRoleV1,
    activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
) -> TenantRootActiveRoleResolutionV1 {
    TenantRootActiveRoleResolutionV1::Active(active_role_binding(
        active,
        role,
        activation_receipt_digest,
    ))
}

fn active_pair(
    active: &router_ab_core::TenantRootActiveRefreshV1,
    custody_binding: &TenantRootCustodyBindingV1,
) -> TenantRootActiveRootPairV1 {
    let activation_receipt_digest = custody_binding.activation_receipt_digest();
    resolve_authoritative_active_tenant_root_pair_binding_v1(
        active.identity().digest().unwrap(),
        custody_binding,
        &active_role_resolution(
            active,
            TenantRootManagedRestoreRoleV1::DeriverA,
            activation_receipt_digest,
        ),
        &active_role_resolution(
            active,
            TenantRootManagedRestoreRoleV1::DeriverB,
            activation_receipt_digest,
        ),
    )
    .unwrap()
    .require_active()
    .unwrap()
    .clone()
}

fn stable_signer_input(
    purpose_plan: MpcPrfStablePurposeBindingPlanV2,
    custody_binding: &TenantRootCustodyBindingV1,
    active_pair: &TenantRootActiveRootPairV1,
    signer_role: Role,
    share: &SigningRootShare,
    now_ms: u64,
) -> MpcPrfStableThresholdSignerInputV2 {
    MpcPrfStableThresholdSignerInputV2::new(
        purpose_plan,
        custody_binding,
        active_pair,
        signer_role,
        share_wire(share),
        now_ms,
    )
    .expect("stable signer input")
}

fn accepted_loss_authorization(
    identity: &TenantRootIdentityV1,
    custody_lineage: TenantRootCustodyLineageId,
    context_digest: TenantRootProtocolDigestV1,
    commitments: TenantRootEpochCommitmentsV1,
    installation_receipts: TenantRootRoleInstallationReceiptsV1,
) -> router_ab_core::VerifiedTenantRootAcceptedPermanentLossAuthorizationV1 {
    let binding = TenantRootAcceptedPermanentLossAuthorizationBindingV1::new(
        identity.digest().unwrap(),
        custody_lineage,
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        context_digest,
        commitments,
        installation_receipts,
        2,
        3,
        "policy-accept-loss-001",
        "incident-2026-0001",
        "both managed backups are unavailable",
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
        "operator-a-v1",
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x72; 32]),
        "operator-b-v1",
    )
    .unwrap();
    let first_key = SigningKey::from_bytes(&[0x61; 32]);
    let second_key = SigningKey::from_bytes(&[0x62; 32]);
    let signed = TenantRootSignedAcceptedPermanentLossAuthorizationV1::sign(
        binding.clone(),
        &first_key.to_bytes(),
        &second_key.to_bytes(),
    )
    .unwrap();
    signed
        .verify(
            &binding,
            first_key.verifying_key().as_bytes(),
            second_key.verifying_key().as_bytes(),
        )
        .unwrap()
}

fn accepted_loss_policy(
    identity: &TenantRootIdentityV1,
    custody_lineage: TenantRootCustodyLineageId,
    context_digest: TenantRootProtocolDigestV1,
    commitments: TenantRootEpochCommitmentsV1,
    installation_receipts: TenantRootRoleInstallationReceiptsV1,
) -> TenantRootBackupPolicyV1 {
    TenantRootBackupPolicyV1::AcceptedPermanentDerivationLoss(
        TenantRootAcceptedLossReceiptV1::from_verified(accepted_loss_authorization(
            identity,
            custody_lineage,
            context_digest,
            commitments,
            installation_receipts,
        )),
    )
}

struct AcceptedInitialActivationFixture {
    bundle: VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
    evidence_a: VerifiedTenantRootShareInstallationEvidenceV1,
    evidence_b: VerifiedTenantRootShareInstallationEvidenceV1,
    installation_receipts: TenantRootRoleInstallationReceiptsV1,
    backup_policy: TenantRootBackupPolicyV1,
    canary_receipts: TenantRootCanaryReceiptsV1,
}

fn accepted_initial_activation_fixture(
    context: TenantRootCeremonyContextV1,
    proof_seed_a: u8,
    proof_seed_b: u8,
) -> AcceptedInitialActivationFixture {
    let share_a = fixed_share(TwoPartyDeriverRole::DeriverA, 12);
    let share_b = fixed_share(TwoPartyDeriverRole::DeriverB, 19);
    let installation_a = signed_installation_wire(
        context.clone(),
        TwoPartyDeriverRole::DeriverA,
        &share_a,
        &share_b,
        proof_seed_a,
    );
    let installation_b = signed_installation_wire(
        context.clone(),
        TwoPartyDeriverRole::DeriverB,
        &share_b,
        &share_a,
        proof_seed_b,
    );
    let evidence_a = installation_a.evidence().clone();
    let evidence_b = installation_b.evidence().clone();
    let commitments = TenantRootEpochCommitmentsV1::from_verified(
        TwoPartyRootShareCommitments::from_shares(&share_a, &share_b).unwrap(),
    )
    .unwrap();
    let installation_receipts = TenantRootRoleInstallationReceiptsV1::new(
        installation_a.lifecycle_receipt_digest().unwrap(),
        installation_b.lifecycle_receipt_digest().unwrap(),
    )
    .unwrap();
    let ecdsa_canary =
        activation_canary(&context, &commitments, TenantRootCanaryCurveFamilyV1::Ecdsa);
    let ed25519_canary = activation_canary(
        &context,
        &commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
    );
    let canary_receipts = TenantRootCanaryReceiptsV1::new(
        TenantRootLifecycleReceiptDigestV1::from_bytes(*ecdsa_canary.digest().as_bytes()).unwrap(),
        TenantRootLifecycleReceiptDigestV1::from_bytes(*ed25519_canary.digest().as_bytes())
            .unwrap(),
    )
    .unwrap();
    let backup_policy = accepted_loss_policy(
        &identity(),
        context.custody_lineage(),
        context.digest().unwrap(),
        commitments.clone(),
        installation_receipts.clone(),
    );
    let authorization = accepted_loss_authorization(
        &identity(),
        context.custody_lineage(),
        context.digest().unwrap(),
        commitments,
        installation_receipts.clone(),
    );
    let bundle =
        VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_accepted_loss(
            installation_a,
            installation_b,
            authorization,
            ecdsa_canary,
            ed25519_canary,
            2,
            3,
        )
        .unwrap();
    AcceptedInitialActivationFixture {
        bundle,
        evidence_a,
        evidence_b,
        installation_receipts,
        backup_policy,
        canary_receipts,
    }
}

fn activation_canary(
    context: &TenantRootCeremonyContextV1,
    commitments: &TenantRootEpochCommitmentsV1,
    family: TenantRootCanaryCurveFamilyV1,
) -> VerifiedTenantRootProviderCanaryReceiptV1 {
    let (transition, target_epoch) = match context.epochs() {
        TenantRootCeremonyEpochsV1::Create { next } => (
            TenantRootActivationReceiptTransitionV1::InitialCreation,
            next,
        ),
        TenantRootCeremonyEpochsV1::Refresh { next, .. } => {
            (TenantRootActivationReceiptTransitionV1::RefreshSwap, next)
        }
    };
    let provider_key_version_ref = match family {
        TenantRootCanaryCurveFamilyV1::Ecdsa => "kms/tenant-root/ecdsa-canary-v1",
        TenantRootCanaryCurveFamilyV1::Ed25519 => "kms/tenant-root/ed25519-canary-v1",
    };
    let binding = TenantRootProviderCanaryReceiptBindingV1::new(
        context.identity_digest(),
        context.custody_lineage(),
        transition,
        target_epoch,
        commitments.clone(),
        family,
        provider_key_version_ref,
        context.issued_at_ms(),
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x72; 32]),
        "control-plane-canary-v1",
        context.issued_at_ms(),
        context.expires_at_ms(),
    )
    .unwrap();
    let signing_key = [0x71; 32];
    let signed =
        TenantRootSignedProviderCanaryReceiptV1::sign(binding.clone(), &signing_key).unwrap();
    signed
        .verify(
            &binding,
            SigningKey::from_bytes(&signing_key)
                .verifying_key()
                .as_bytes(),
        )
        .unwrap()
}

fn installation_receipts() -> TenantRootRoleInstallationReceiptsV1 {
    TenantRootRoleInstallationReceiptsV1::new(digest(1), digest(2)).unwrap()
}

fn managed_backups() -> TenantRootBackupPolicyV1 {
    TenantRootBackupPolicyV1::CurrentRoleBackups(
        TenantRootRoleBackupReceiptsV1::new(digest(3), digest(4)).unwrap(),
    )
}

fn canaries() -> TenantRootCanaryReceiptsV1 {
    TenantRootCanaryReceiptsV1::new(digest(5), digest(6)).unwrap()
}

fn assert_state_kind(state: impl Into<TenantRootCreationStateV1>, expected: &str) {
    let state = state.into();
    let json = serde_json::to_value(&state).unwrap();
    assert_eq!(json["kind"], expected);
}

#[test]
fn creation_moves_only_empty_to_preparing_to_verified_to_active() {
    let lineage = lineage(0x31);
    let context = context(lineage, 0x21);
    let fixture = support::initial_activation_evidence_fixture(
        context.clone(),
        &fixed_share(TwoPartyDeriverRole::DeriverA, 12),
        &fixed_share(TwoPartyDeriverRole::DeriverB, 19),
        1,
        2,
    );
    let expected_root = *fixture.bundle.root_commitment();
    let support::InitialActivationEvidenceFixture {
        bundle,
        evidence_a,
        evidence_b,
        installation_receipts,
        backup_policy,
        canary_receipts,
    } = fixture;
    let empty = TenantRootEmptyCreationV1::new(identity(), lineage);
    assert_eq!(TenantRootCreationStateV1::from(empty.clone()).revision(), 0);

    let preparing = empty.start(&context).unwrap();
    assert_eq!(
        TenantRootCreationStateV1::from(preparing.clone()).revision(),
        1
    );
    let verified = preparing
        .verify(
            &evidence_a,
            &evidence_b,
            installation_receipts,
            backup_policy,
            canary_receipts,
            1_010_000,
        )
        .unwrap();
    assert_eq!(
        TenantRootCreationStateV1::from(verified.clone()).revision(),
        2
    );
    let activation = support::initial_activation_receipt(&bundle, 1_020_000);
    let activation_bytes = activation.canonical_bytes().to_vec();
    let activation_digest = activation.digest();
    let activation_time = activation.activated_at_ms();
    let active = verified.activate(activation).unwrap();

    assert_eq!(active.revision(), 3);
    assert_eq!(
        active.current().activation_receipt_bytes(),
        activation_bytes
    );
    assert_eq!(
        active.current().activation_receipt_digest(),
        activation_digest
    );
    assert_eq!(active.current().activation_time_ms(), activation_time);
    assert_eq!(
        active.current().verified().commitments().root_commitment(),
        &expected_root,
    );
    assert_eq!(active.current().verified().pending().epoch().get().get(), 1);
    assert!(matches!(
        active.current().verified().backup_policy(),
        TenantRootBackupPolicyV1::CurrentRoleBackups(_)
    ));
    assert_state_kind(active, "active");
}

#[test]
fn accepted_loss_activation_requires_the_exact_verified_authorization() {
    let lineage = lineage(0x32);
    let context = context(lineage, 0x22);
    let fixture = accepted_initial_activation_fixture(context.clone(), 1, 2);
    let AcceptedInitialActivationFixture {
        bundle,
        evidence_a,
        evidence_b,
        installation_receipts,
        backup_policy,
        canary_receipts,
    } = fixture;
    let verified = TenantRootEmptyCreationV1::new(identity(), lineage)
        .start(&context)
        .unwrap()
        .verify(
            &evidence_a,
            &evidence_b,
            installation_receipts,
            backup_policy,
            canary_receipts,
            1_010_000,
        )
        .unwrap();

    let activation = support::initial_activation_receipt(&bundle, 1_020_000);
    let active = verified.activate(activation).unwrap();
    assert_eq!(active.revision(), 3);
    assert!(matches!(
        active.current().verified().backup_policy(),
        TenantRootBackupPolicyV1::AcceptedPermanentDerivationLoss(_)
    ));
    assert!(TenantRootLifecycleReceiptDigestV1::from_bytes([0; 32]).is_err());
    assert!(
        serde_json::from_value::<TenantRootLifecycleReceiptDigestV1>(
            serde_json::to_value([0_u8; 32]).unwrap(),
        )
        .is_err()
    );
    let encoded_digest = serde_json::to_value(digest(10)).unwrap();
    assert_eq!(
        serde_json::from_value::<TenantRootLifecycleReceiptDigestV1>(encoded_digest).unwrap(),
        digest(10),
    );
    assert!(TenantRootRoleBackupReceiptsV1::new(digest(3), digest(3)).is_err());
    assert!(TenantRootRoleInstallationReceiptsV1::new(digest(1), digest(1)).is_err());
    assert!(TenantRootCanaryReceiptsV1::new(digest(5), digest(5)).is_err());
}

#[test]
fn accepted_loss_activation_rejects_cross_scope_receipt_replay() {
    let first_lineage = lineage(0x32);
    let second_lineage = lineage(0x39);
    let first_context = context(first_lineage, 0x22);
    let second_context = context(second_lineage, 0x29);
    let first_fixture = accepted_initial_activation_fixture(first_context.clone(), 1, 2);
    let second_fixture = accepted_initial_activation_fixture(second_context.clone(), 1, 2);
    let AcceptedInitialActivationFixture {
        bundle: _,
        evidence_a: first_evidence_a,
        evidence_b: first_evidence_b,
        installation_receipts: first_installation_receipts,
        backup_policy: first_backup_policy,
        canary_receipts: first_canary_receipts,
    } = first_fixture;
    let AcceptedInitialActivationFixture {
        bundle: second_bundle,
        evidence_a: second_evidence_a,
        evidence_b: second_evidence_b,
        installation_receipts: second_installation_receipts,
        backup_policy: second_backup_policy,
        canary_receipts: second_canary_receipts,
    } = second_fixture;
    let first_verified = TenantRootEmptyCreationV1::new(identity(), first_lineage)
        .start(&first_context)
        .unwrap()
        .verify(
            &first_evidence_a,
            &first_evidence_b,
            first_installation_receipts,
            first_backup_policy,
            first_canary_receipts,
            1_010_000,
        )
        .unwrap();
    let _second_verified = TenantRootEmptyCreationV1::new(identity(), second_lineage)
        .start(&second_context)
        .unwrap()
        .verify(
            &second_evidence_a,
            &second_evidence_b,
            second_installation_receipts,
            second_backup_policy,
            second_canary_receipts,
            1_010_000,
        )
        .unwrap();
    let replayed_activation = support::initial_activation_receipt(&second_bundle, 1_020_000);
    assert!(first_verified.activate(replayed_activation).is_err());
}

#[test]
fn creation_rejects_identity_lineage_and_ceremony_substitution() {
    let expected_lineage = lineage(0x33);
    let other_lineage = lineage(0x34);
    let other_context = context(other_lineage, 0x23);
    assert!(TenantRootEmptyCreationV1::new(identity(), expected_lineage)
        .start(&other_context)
        .is_err());

    let expected_context = context(expected_lineage, 0x24);
    let preparing = TenantRootEmptyCreationV1::new(identity(), expected_lineage)
        .start(&expected_context)
        .unwrap();
    let substituted_context = context(expected_lineage, 0x25);
    let (evidence_a, evidence_b, _) = evidence_pair(&substituted_context);
    assert!(preparing
        .verify(
            &evidence_a,
            &evidence_b,
            installation_receipts(),
            managed_backups(),
            canaries(),
            1_010_000,
        )
        .is_err());
}

#[test]
fn refresh_rejects_epoch_lineage_root_and_ceremony_substitution() {
    let lineage = lineage(0x43);
    let (active, current_a, current_b) = active_refresh_state(lineage);
    assert!(active
        .clone()
        .start(&refresh_context(
            TenantRootCustodyLineageId::from_bytes([0x42; 16]).unwrap(),
            1,
            2,
            0x72,
        ))
        .is_err());
    assert!(active
        .clone()
        .start(&refresh_context(lineage, 2, 3, 0x73))
        .is_err());

    let expected_context = refresh_context(lineage, 1, 2, 0x74);
    let preparing = active.start(&expected_context).unwrap();
    let unrelated_a = fixed_share(TwoPartyDeriverRole::DeriverA, 51);
    let unrelated_b = fixed_share(TwoPartyDeriverRole::DeriverB, 83);
    let (unrelated_evidence_a, unrelated_evidence_b, _) =
        evidence_pair_for_shares(&expected_context, &unrelated_a, &unrelated_b, 35, 36);
    assert!(preparing
        .clone()
        .verify(
            &unrelated_evidence_a,
            &unrelated_evidence_b,
            installation_receipts(),
            managed_backups(),
            canaries(),
            1_010_000,
        )
        .is_err());

    let (next_a, next_b) = refreshed_pair(&current_a, &current_b, 37);
    let other_context = refresh_context(lineage, 1, 2, 0x75);
    let (other_evidence_a, other_evidence_b, _) =
        evidence_pair_for_shares(&other_context, &next_a, &next_b, 39, 40);
    assert!(preparing
        .verify(
            &other_evidence_a,
            &other_evidence_b,
            installation_receipts(),
            managed_backups(),
            canaries(),
            1_010_000,
        )
        .is_err());
}

#[test]
fn managed_restore_requires_commitment_verification_and_forward_refresh() {
    let lineage = lineage(0x51);
    let (active, current_a, current_b) = active_refresh_state(lineage);
    let stable_root = *active.current().verified().commitments().root_commitment();
    let available = TenantRootManagedRestoreAvailableV1::new(active.clone()).unwrap();
    let unavailable = available
        .mark_role_unavailable(
            TenantRootRoleUnavailableReceiptV1::new(
                digest(60),
                TenantRootManagedRestoreRoleV1::DeriverA,
                1_021_000,
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(unavailable.revision(), 4);

    let capability = managed_restore_capability(
        &active,
        TenantRootManagedRestoreRoleV1::DeriverA,
        61,
        1_022_000,
        1_050_000,
    );
    let restoring = match unavailable
        .start_restore(capability.clone(), 1_023_000)
        .unwrap()
    {
        TenantRootManagedRestoreInstallingV1::RestoringA(state) => state,
        TenantRootManagedRestoreInstallingV1::RestoringB(_) => {
            panic!("Deriver A outage selected the wrong restore branch")
        }
    };
    let verifying = restoring
        .accept_installation(managed_restore_installation(
            &active,
            &capability,
            62,
            1_024_000,
        ))
        .unwrap();
    let forward_context = refresh_context_at(lineage, 1, 2, 0x81, 1_026_000, 1_049_000);
    let forward = verifying
        .begin_forward_refresh(
            managed_restore_peer_receipt(
                &active,
                TenantRootManagedRestoreRoleV1::DeriverA,
                63,
                1_025_000,
            ),
            &forward_context,
        )
        .unwrap();
    let forward_json =
        serde_json::to_value(TenantRootManagedRestoreStateV1::from(forward.clone())).unwrap();
    assert_eq!(forward_json["kind"], "forward_refreshing");
    assert_eq!(forward_json["state"]["phase"], "preparing");
    assert_eq!(
        TenantRootManagedRestoreStateV1::from(forward.clone()).revision(),
        7
    );

    let (_, _, fixture) =
        refresh_evidence(&forward_context, &active, &current_a, &current_b, 51, 8);
    let verified = forward
        .verify(
            &fixture.evidence_a,
            &fixture.evidence_b,
            fixture.installation_receipts,
            fixture.backup_policy,
            fixture.canary_receipts,
            1_030_000,
        )
        .unwrap();
    let activation = support::refresh_activation_receipt(&fixture.bundle, 1_040_000);
    let retiring = verified.activate(activation).unwrap();
    let available = retiring
        .finish_retirement(
            TenantRootRoleRetirementReceiptsV1::new(digest(65), digest(66), 1_041_000).unwrap(),
        )
        .unwrap();

    assert_eq!(available.active().current().epoch().get().get(), 2);
    assert_eq!(available.revision(), 10);
    assert_eq!(
        available
            .active()
            .current()
            .verified()
            .commitments()
            .root_commitment(),
        &stable_root
    );
    let available_json =
        serde_json::to_value(TenantRootManagedRestoreStateV1::from(available)).unwrap();
    assert_eq!(available_json["kind"], "available");
}

#[test]
fn managed_restore_has_exact_role_branches_and_rejects_dual_loss() {
    for (lineage_seed, role, expected_kind) in [
        (
            0x52,
            TenantRootManagedRestoreRoleV1::DeriverA,
            "restoring_a",
        ),
        (
            0x53,
            TenantRootManagedRestoreRoleV1::DeriverB,
            "restoring_b",
        ),
    ] {
        let lineage = lineage(lineage_seed);
        let (active, _, _) = active_refresh_state(lineage);
        let unavailable = TenantRootManagedRestoreAvailableV1::new(active.clone())
            .unwrap()
            .mark_role_unavailable(
                TenantRootRoleUnavailableReceiptV1::new(digest(70), role, 1_021_000).unwrap(),
            )
            .unwrap();

        let wrong_role = managed_restore_capability(&active, role.peer(), 71, 1_022_000, 1_050_000);
        let error = unavailable
            .clone()
            .start_restore(wrong_role, 1_023_000)
            .unwrap_err();
        assert!(error
            .message()
            .contains("dual-role loss requires tenant recovery"));

        let capability = managed_restore_capability(&active, role, 72, 1_022_000, 1_050_000);
        let installing = unavailable
            .start_restore(capability.clone(), 1_023_000)
            .unwrap();
        let state_json =
            serde_json::to_value(TenantRootManagedRestoreStateV1::from(installing.clone()))
                .unwrap();
        assert_eq!(state_json["kind"], expected_kind);

        let verifying = match installing {
            TenantRootManagedRestoreInstallingV1::RestoringA(state) => state
                .accept_installation(managed_restore_installation(
                    &active,
                    &capability,
                    73,
                    1_024_000,
                ))
                .unwrap(),
            TenantRootManagedRestoreInstallingV1::RestoringB(state) => state
                .accept_installation(managed_restore_installation(
                    &active,
                    &capability,
                    73,
                    1_024_000,
                ))
                .unwrap(),
        };
        let verifying_json =
            serde_json::to_value(TenantRootManagedRestoreStateV1::from(verifying)).unwrap();
        assert_eq!(verifying_json["kind"], "verifying");
    }
}

#[test]
fn managed_restore_rejects_identity_epoch_commitment_and_peer_substitution() {
    let lineage = lineage(0x54);
    let (active, _, _) = active_refresh_state(lineage);
    let unavailable = TenantRootManagedRestoreAvailableV1::new(active.clone())
        .unwrap()
        .mark_role_unavailable(
            TenantRootRoleUnavailableReceiptV1::new(
                digest(80),
                TenantRootManagedRestoreRoleV1::DeriverA,
                1_021_000,
            )
            .unwrap(),
        )
        .unwrap();

    let wrong_identity = TenantRootManagedRestoreCapabilityV1::new(
        digest(81),
        TenantRootIdentityV1::new("other-org", "project-2", "production", "root-main", "v3")
            .unwrap()
            .digest()
            .unwrap(),
        lineage,
        TenantRootManagedRestoreRoleV1::DeriverA,
        active.current().epoch(),
        active.current().activation().digest(),
        1_022_000,
        1_050_000,
    )
    .unwrap();
    assert!(unavailable
        .clone()
        .start_restore(wrong_identity, 1_023_000)
        .is_err());

    let wrong_lineage = TenantRootManagedRestoreCapabilityV1::new(
        digest(87),
        active.identity().digest().unwrap(),
        TenantRootCustodyLineageId::from_bytes([0x53; 16]).unwrap(),
        TenantRootManagedRestoreRoleV1::DeriverA,
        active.current().epoch(),
        active.current().activation().digest(),
        1_022_000,
        1_050_000,
    )
    .unwrap();
    assert!(unavailable
        .clone()
        .start_restore(wrong_lineage, 1_023_000)
        .is_err());

    let wrong_epoch = TenantRootManagedRestoreCapabilityV1::new(
        digest(82),
        active.identity().digest().unwrap(),
        lineage,
        TenantRootManagedRestoreRoleV1::DeriverA,
        TenantRootShareEpoch::new(2).unwrap(),
        active.current().activation().digest(),
        1_022_000,
        1_050_000,
    )
    .unwrap();
    assert!(unavailable
        .clone()
        .start_restore(wrong_epoch, 1_023_000)
        .is_err());

    let capability = managed_restore_capability(
        &active,
        TenantRootManagedRestoreRoleV1::DeriverA,
        83,
        1_022_000,
        1_050_000,
    );
    let restoring = match unavailable
        .start_restore(capability.clone(), 1_023_000)
        .unwrap()
    {
        TenantRootManagedRestoreInstallingV1::RestoringA(state) => state,
        TenantRootManagedRestoreInstallingV1::RestoringB(_) => unreachable!(),
    };
    let wrong_commitment = TenantRootManagedRestoreInstallationReceiptV1::new(
        digest(84),
        capability.digest(),
        active.identity().digest().unwrap(),
        lineage,
        TenantRootManagedRestoreRoleV1::DeriverA,
        active.current().epoch(),
        active.current().activation().digest(),
        active
            .current()
            .verified()
            .commitments()
            .deriver_b()
            .clone(),
        1_024_000,
    )
    .unwrap();
    assert!(restoring
        .clone()
        .accept_installation(wrong_commitment)
        .is_err());

    let verifying = restoring
        .accept_installation(managed_restore_installation(
            &active,
            &capability,
            85,
            1_024_000,
        ))
        .unwrap();
    let wrong_peer = TenantRootManagedRestorePeerVerificationReceiptV1::new(
        digest(86),
        active.identity().digest().unwrap(),
        lineage,
        TenantRootManagedRestoreRoleV1::DeriverA,
        active.current().epoch(),
        active.current().activation().digest(),
        active
            .current()
            .verified()
            .commitments()
            .deriver_a()
            .clone(),
        1_025_000,
    )
    .unwrap();
    assert!(verifying
        .begin_forward_refresh(
            wrong_peer,
            &refresh_context_at(lineage, 1, 2, 0x82, 1_026_000, 1_049_000),
        )
        .is_err());
}

#[test]
fn managed_restore_forward_refresh_failure_cannot_unfence_the_old_epoch() {
    let lineage = lineage(0x56);
    let (active, _, _) = active_refresh_state(lineage);
    let capability = managed_restore_capability(
        &active,
        TenantRootManagedRestoreRoleV1::DeriverB,
        101,
        1_022_000,
        1_060_000,
    );
    let restoring = TenantRootManagedRestoreAvailableV1::new(active.clone())
        .unwrap()
        .mark_role_unavailable(
            TenantRootRoleUnavailableReceiptV1::new(
                digest(100),
                TenantRootManagedRestoreRoleV1::DeriverB,
                1_021_000,
            )
            .unwrap(),
        )
        .unwrap()
        .start_restore(capability.clone(), 1_023_000)
        .unwrap();
    let restoring = match restoring {
        TenantRootManagedRestoreInstallingV1::RestoringB(state) => state,
        TenantRootManagedRestoreInstallingV1::RestoringA(_) => unreachable!(),
    };
    let verifying = restoring
        .accept_installation(managed_restore_installation(
            &active,
            &capability,
            102,
            1_024_000,
        ))
        .unwrap();
    let ceremony = refresh_context_at(lineage, 1, 2, 0x83, 1_026_000, 1_055_000);
    let forward = verifying
        .begin_forward_refresh(
            managed_restore_peer_receipt(
                &active,
                TenantRootManagedRestoreRoleV1::DeriverB,
                103,
                1_025_000,
            ),
            &ceremony,
        )
        .unwrap();
    let failed = forward
        .fail_with_cleanup(
            TenantRootRefreshFailureV1::new(digest(104), 1_027_000).unwrap(),
            TenantRootPendingCleanupReceiptV1::new(digest(105), digest(106), 1_028_000).unwrap(),
        )
        .unwrap();
    let failed_json =
        serde_json::to_value(TenantRootManagedRestoreStateV1::from(failed.clone())).unwrap();
    assert_eq!(failed_json["kind"], "forward_refreshing");
    assert_eq!(failed_json["state"]["phase"], "failed_before_activation");
    assert!(failed.clone().retry(&ceremony).is_err());

    let fresh = refresh_context_at(lineage, 1, 2, 0x84, 1_029_000, 1_059_000);
    let retry = failed.retry(&fresh).unwrap();
    let retry_json = serde_json::to_value(TenantRootManagedRestoreStateV1::from(retry)).unwrap();
    assert_eq!(retry_json["kind"], "forward_refreshing");
    assert_eq!(retry_json["state"]["phase"], "preparing");
}

#[test]
fn custody_binding_changes_with_the_active_epoch_while_stable_context_remains_exact() {
    let lineage = lineage(0x71);
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let stable_bytes = stable_context.canonical_context_bytes();
    let stable_digest = stable_context_digest(&stable_context);
    let (epoch_one, share_a, share_b) = active_refresh_state(lineage);
    let root_commitment = *epoch_one
        .current()
        .verified()
        .commitments()
        .root_commitment();
    let binding_one = custody_binding(&epoch_one, &stable_context);
    let pair_one = active_pair(&epoch_one, &binding_one);

    let (epoch_two, refreshed_share_a, refreshed_share_b) =
        advance_active_refresh(epoch_one, &share_a, &share_b);
    let binding_two = custody_binding(&epoch_two, &stable_context);
    let pair_two = active_pair(&epoch_two, &binding_two);

    assert_eq!(binding_one.epoch().get().get(), 1);
    assert_eq!(binding_two.epoch().get().get(), 2);
    assert_eq!(binding_one.stable_context_digest(), stable_digest);
    assert_eq!(binding_two.stable_context_digest(), stable_digest);
    assert_eq!(stable_context.canonical_context_bytes(), stable_bytes);
    assert_eq!(
        epoch_two
            .current()
            .verified()
            .commitments()
            .root_commitment(),
        &root_commitment,
    );
    assert_ne!(
        binding_one.canonical_bytes().unwrap(),
        binding_two.canonical_bytes().unwrap()
    );
    assert_ne!(binding_one.digest().unwrap(), binding_two.digest().unwrap());

    let plan_one = plan_mpc_prf_stable_purpose_binding_v2(
        &stable_context,
        &binding_one,
        PrfPurpose::RouterAbXClientBaseV1,
    )
    .unwrap();
    let plan_two = plan_mpc_prf_stable_purpose_binding_v2(
        &stable_context,
        &binding_two,
        PrfPurpose::RouterAbXClientBaseV1,
    )
    .unwrap();
    let recipient_plan = plan_mpc_prf_stable_purpose_binding_from_authenticated_custody_digest_v2(
        &stable_context,
        binding_one.digest().unwrap(),
        PrfPurpose::RouterAbXClientBaseV1,
    )
    .unwrap();
    assert_eq!(recipient_plan, plan_one);
    assert_eq!(
        plan_one.threshold_prf_context_bytes(),
        stable_bytes.as_slice()
    );
    assert_eq!(
        plan_one.threshold_prf_context_bytes(),
        plan_two.threshold_prf_context_bytes()
    );
    assert_eq!(
        plan_one.stable_context_digest(),
        plan_two.stable_context_digest()
    );
    assert_ne!(
        plan_one.custody_binding_digest(),
        plan_two.custody_binding_digest()
    );

    let epoch_one_a = evaluate_mpc_prf_stable_signer_partial_with_threshold_backend_v2(
        stable_signer_input(
            plan_one.clone(),
            &binding_one,
            &pair_one,
            Role::SignerA,
            &share_a,
            ISSUED_AT_MS,
        ),
        &mut rng06(91),
    )
    .unwrap();
    let epoch_one_b = evaluate_mpc_prf_stable_signer_partial_with_threshold_backend_v2(
        stable_signer_input(
            plan_one.clone(),
            &binding_one,
            &pair_one,
            Role::SignerB,
            &share_b,
            ISSUED_AT_MS,
        ),
        &mut rng06(92),
    )
    .unwrap();
    let epoch_two_a = evaluate_mpc_prf_stable_signer_partial_with_threshold_backend_v2(
        stable_signer_input(
            plan_two.clone(),
            &binding_two,
            &pair_two,
            Role::SignerA,
            &refreshed_share_a,
            ISSUED_AT_MS,
        ),
        &mut rng06(91),
    )
    .unwrap();
    let epoch_two_b = evaluate_mpc_prf_stable_signer_partial_with_threshold_backend_v2(
        stable_signer_input(
            plan_two.clone(),
            &binding_two,
            &pair_two,
            Role::SignerB,
            &refreshed_share_b,
            ISSUED_AT_MS,
        ),
        &mut rng06(92),
    )
    .unwrap();
    assert_ne!(epoch_one_a.proof_wire, epoch_two_a.proof_wire);
    assert!(
        verify_mpc_prf_stable_partial_with_threshold_backend_v2(&plan_two, &epoch_one_a,).is_err()
    );
    let mut substituted_custody_binding = epoch_one_a.clone();
    substituted_custody_binding.purpose_plan = plan_two.clone();
    assert!(verify_mpc_prf_stable_partial_with_threshold_backend_v2(
        &plan_two,
        &substituted_custody_binding,
    )
    .is_err());

    let signer_a = SignerIdentityV1::new(Role::SignerA, "deriver-a", "key-epoch-1").unwrap();
    let signer_b = SignerIdentityV1::new(Role::SignerB, "deriver-b", "key-epoch-1").unwrap();
    let epoch_one_client_a = MpcPrfStableRecipientProofBundlePayloadV2::from_stable_partial(
        signer_a.clone(),
        Role::Client,
        "client-1",
        &epoch_one_a,
    )
    .unwrap();
    let epoch_one_client_b = MpcPrfStableRecipientProofBundlePayloadV2::from_stable_partial(
        signer_b.clone(),
        Role::Client,
        "client-1",
        &epoch_one_b,
    )
    .unwrap();
    let epoch_one_client_a_bytes = epoch_one_client_a.canonical_bytes();
    let epoch_one_client_b_bytes = epoch_one_client_b.canonical_bytes();
    let epoch_one_client_a_decoded =
        decode_mpc_prf_stable_recipient_proof_bundle_payload_v2(&epoch_one_client_a_bytes).unwrap();
    let epoch_one_client_b_decoded =
        decode_mpc_prf_stable_recipient_proof_bundle_payload_v2(&epoch_one_client_b_bytes).unwrap();
    assert_eq!(
        epoch_one_client_a_decoded.canonical_bytes(),
        epoch_one_client_a_bytes
    );
    assert_eq!(
        epoch_one_client_b_decoded.canonical_bytes(),
        epoch_one_client_b_bytes
    );
    let encryption_request = RecipientProofBundleEncryptionRequestV1::new_stable_v2(
        &epoch_one_client_a,
        "recipient-key",
        PublicDigest32::new([0x99; 32]),
    )
    .unwrap();
    assert_eq!(
        encryption_request.payload_digest(),
        epoch_one_client_a.digest()
    );
    assert_eq!(
        encryption_request.transcript_digest(),
        PublicDigest32::new([0x99; 32])
    );
    assert_eq!(
        encryption_request.plaintext(),
        epoch_one_client_a.canonical_bytes().as_slice()
    );
    let mut trailing_bytes = epoch_one_client_a_bytes.clone();
    trailing_bytes.push(0);
    assert!(decode_mpc_prf_stable_recipient_proof_bundle_payload_v2(&trailing_bytes).is_err());
    let epoch_one_wire_output =
        combine_mpc_prf_stable_recipient_output_from_proof_bundle_payloads_v2(
            &plan_one,
            epoch_one_client_a_decoded,
            epoch_one_client_b_decoded,
            Role::Client,
            "client-1",
        )
        .unwrap();

    let epoch_two_client_a = MpcPrfStableRecipientProofBundlePayloadV2::from_stable_partial(
        signer_a,
        Role::Client,
        "client-1",
        &epoch_two_a,
    )
    .unwrap();
    let epoch_two_client_b = MpcPrfStableRecipientProofBundlePayloadV2::from_stable_partial(
        signer_b,
        Role::Client,
        "client-1",
        &epoch_two_b,
    )
    .unwrap();
    let epoch_two_client_a_decoded = decode_mpc_prf_stable_recipient_proof_bundle_payload_v2(
        &epoch_two_client_a.canonical_bytes(),
    )
    .unwrap();
    let epoch_two_client_b_decoded = decode_mpc_prf_stable_recipient_proof_bundle_payload_v2(
        &epoch_two_client_b.canonical_bytes(),
    )
    .unwrap();
    let epoch_two_wire_output =
        combine_mpc_prf_stable_recipient_output_from_proof_bundle_payloads_v2(
            &plan_two,
            epoch_two_client_a_decoded,
            epoch_two_client_b_decoded,
            Role::Client,
            "client-1",
        )
        .unwrap();

    let epoch_one_output = combine_mpc_prf_stable_proof_bundles_with_threshold_backend_v2(
        MpcPrfStableThresholdCombineInputV2 {
            purpose_plan: plan_one,
            left: epoch_one_a,
            right: epoch_one_b,
        },
    )
    .unwrap();
    let epoch_two_output = combine_mpc_prf_stable_proof_bundles_with_threshold_backend_v2(
        MpcPrfStableThresholdCombineInputV2 {
            purpose_plan: plan_two,
            left: epoch_two_a,
            right: epoch_two_b,
        },
    )
    .unwrap();
    assert_eq!(
        epoch_one_output.stable_context_digest,
        epoch_two_output.stable_context_digest
    );
    assert_ne!(
        epoch_one_output.custody_binding_digest,
        epoch_two_output.custody_binding_digest
    );
    assert_eq!(
        epoch_one_output.output_material,
        epoch_two_output.output_material
    );
    assert_eq!(
        epoch_one_wire_output.output_material,
        epoch_one_output.output_material
    );
    assert_eq!(
        epoch_two_wire_output.output_material,
        epoch_two_output.output_material
    );

    let alternate_context = StableTenantDerivationContextV2::new([0x43; 32]);
    assert!(plan_mpc_prf_stable_purpose_binding_v2(
        &alternate_context,
        &binding_one,
        PrfPurpose::RouterAbXClientBaseV1,
    )
    .is_err());
}

#[test]
fn stable_signer_input_rejects_a_substituted_share() {
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let (active, _, _) = active_refresh_state(lineage(0x7a));
    let custody_binding = custody_binding(&active, &stable_context);
    let active_pair = active_pair(&active, &custody_binding);
    let plan = plan_mpc_prf_stable_purpose_binding_v2(
        &stable_context,
        &custody_binding,
        PrfPurpose::RouterAbXClientBaseV1,
    )
    .unwrap();
    let substituted_share = fixed_share(TwoPartyDeriverRole::DeriverA, 31);

    let error = MpcPrfStableThresholdSignerInputV2::new(
        plan,
        &custody_binding,
        &active_pair,
        Role::SignerA,
        share_wire(&substituted_share),
        ISSUED_AT_MS,
    )
    .unwrap_err();
    assert_eq!(
        error.code(),
        router_ab_core::RouterAbDerivationErrorCode::OutputVerificationFailed
    );
}

#[test]
fn stable_signer_input_rejects_a_stale_custody_binding() {
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let (active, share_a, _) = active_refresh_state(lineage(0x7b));
    let custody_binding = custody_binding(&active, &stable_context);
    let active_pair = active_pair(&active, &custody_binding);
    let plan = plan_mpc_prf_stable_purpose_binding_v2(
        &stable_context,
        &custody_binding,
        PrfPurpose::RouterAbXClientBaseV1,
    )
    .unwrap();

    let error = MpcPrfStableThresholdSignerInputV2::new(
        plan,
        &custody_binding,
        &active_pair,
        Role::SignerA,
        share_wire(&share_a),
        EXPIRES_AT_MS + 60_001,
    )
    .unwrap_err();
    assert_eq!(
        error.code(),
        router_ab_core::RouterAbDerivationErrorCode::MalformedInput
    );
}

#[test]
fn stable_signer_input_rejects_a_pair_from_another_custody_binding() {
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let (active, share_a, _) = active_refresh_state(lineage(0x7c));
    let binding_one = custody_binding(&active, &stable_context);
    let pair_one = active_pair(&active, &binding_one);
    let (foreign_active, _, _) = active_refresh_state(lineage(0x7d));
    let foreign_binding = custody_binding(&foreign_active, &stable_context);
    let foreign_pair = active_pair(&foreign_active, &foreign_binding);
    let plan = plan_mpc_prf_stable_purpose_binding_v2(
        &stable_context,
        &binding_one,
        PrfPurpose::RouterAbXClientBaseV1,
    )
    .unwrap();

    let error = MpcPrfStableThresholdSignerInputV2::new(
        plan,
        &binding_one,
        &foreign_pair,
        Role::SignerA,
        share_wire(&share_a),
        ISSUED_AT_MS,
    )
    .unwrap_err();
    assert_eq!(
        error.code(),
        router_ab_core::RouterAbDerivationErrorCode::MismatchedActiveTenantRootPair
    );
    assert_ne!(pair_one, foreign_pair);
}

#[test]
fn stable_signer_input_rejects_a_plan_or_receipt_substitution() {
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let (active, share_a, _) = active_refresh_state(lineage(0x7f));
    let binding_one = custody_binding(&active, &stable_context);
    let active_pair = active_pair(&active, &binding_one);

    let alternate_binding =
        custody_binding(&active, &StableTenantDerivationContextV2::new([0x43; 32]));
    let alternate_plan = plan_mpc_prf_stable_purpose_binding_v2(
        &StableTenantDerivationContextV2::new([0x43; 32]),
        &alternate_binding,
        PrfPurpose::RouterAbXClientBaseV1,
    )
    .unwrap();
    let plan_error = MpcPrfStableThresholdSignerInputV2::new(
        alternate_plan,
        &binding_one,
        &active_pair,
        Role::SignerA,
        share_wire(&share_a),
        ISSUED_AT_MS,
    )
    .unwrap_err();
    assert_eq!(
        plan_error.code(),
        router_ab_core::RouterAbDerivationErrorCode::TranscriptMismatch
    );

    let expected_receipt = binding_one.activation_receipt_digest();
    let substituted_receipt = digest(0x9a);
    let substituted_receipt_resolution = resolve_active_tenant_root_pair_binding_v1(
        active.identity().digest().unwrap(),
        &active_role_resolution(
            &active,
            TenantRootManagedRestoreRoleV1::DeriverA,
            expected_receipt,
        ),
        &active_role_resolution(
            &active,
            TenantRootManagedRestoreRoleV1::DeriverB,
            substituted_receipt,
        ),
    )
    .unwrap();
    assert_eq!(
        substituted_receipt_resolution,
        TenantRootActivePairResolutionV1::Mismatched(
            TenantRootActivePairMismatchV1::ActivationReceiptDigests {
                deriver_a: expected_receipt,
                deriver_b: substituted_receipt,
            }
        )
    );
    assert_eq!(
        substituted_receipt_resolution
            .require_active()
            .unwrap_err()
            .code(),
        router_ab_core::RouterAbDerivationErrorCode::MismatchedActiveTenantRootPair
    );
}

#[test]
fn stable_signer_input_rejects_an_invalid_or_mismatched_role() {
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let (active, share_a, _) = active_refresh_state(lineage(0x7e));
    let custody_binding = custody_binding(&active, &stable_context);
    let active_pair = active_pair(&active, &custody_binding);
    let plan = plan_mpc_prf_stable_purpose_binding_v2(
        &stable_context,
        &custody_binding,
        PrfPurpose::RouterAbXClientBaseV1,
    )
    .unwrap();

    let invalid_role = MpcPrfStableThresholdSignerInputV2::new(
        plan.clone(),
        &custody_binding,
        &active_pair,
        Role::Server,
        share_wire(&share_a),
        ISSUED_AT_MS,
    )
    .unwrap_err();
    assert_eq!(
        invalid_role.code(),
        router_ab_core::RouterAbDerivationErrorCode::SignerIdentityMismatch
    );

    let mismatched_role = MpcPrfStableThresholdSignerInputV2::new(
        plan,
        &custody_binding,
        &active_pair,
        Role::SignerB,
        share_wire(&share_a),
        ISSUED_AT_MS,
    )
    .unwrap_err();
    assert_eq!(
        mismatched_role.code(),
        router_ab_core::RouterAbDerivationErrorCode::SignerIdentityMismatch
    );
}

#[test]
fn authoritative_pair_requires_exact_custody_facts_and_activation_receipt() {
    let (active, _, _) = active_refresh_state(lineage(0x75));
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let custody_binding = custody_binding(&active, &stable_context);
    let activation_receipt_digest = active.current().activation().digest();
    let deriver_a = active_role_resolution(
        &active,
        TenantRootManagedRestoreRoleV1::DeriverA,
        activation_receipt_digest,
    );
    let deriver_b = active_role_resolution(
        &active,
        TenantRootManagedRestoreRoleV1::DeriverB,
        activation_receipt_digest,
    );

    let resolution = resolve_authoritative_active_tenant_root_pair_binding_v1(
        active.identity().digest().unwrap(),
        &custody_binding,
        &deriver_a,
        &deriver_b,
    )
    .unwrap();
    let pair = resolution.require_active().unwrap();
    assert_eq!(pair.identity_digest(), custody_binding.identity_digest());
    assert_eq!(pair.custody_lineage(), custody_binding.custody_lineage());
    assert_eq!(pair.epoch(), custody_binding.epoch());
    assert_eq!(pair.commitments(), custody_binding.commitments());
    assert_eq!(pair.root_commitment(), custody_binding.root_commitment());
    assert_eq!(
        pair.activation_receipt_digest(),
        custody_binding.activation_receipt_digest(),
    );
}

#[test]
fn authoritative_pair_rejects_stale_lineage_epoch_or_commitments() {
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let (epoch_one, share_a, share_b) = active_refresh_state(lineage(0x76));
    let custody_binding = custody_binding(&epoch_one, &stable_context);

    let (epoch_two, _, _) = advance_active_refresh(epoch_one, &share_a, &share_b);
    assert_ne!(epoch_two.current().epoch(), custody_binding.epoch());
    assert_ne!(
        epoch_two.current().verified().commitments(),
        custody_binding.commitments()
    );
    let refreshed_receipt = epoch_two.current().activation().digest();
    let refreshed = resolve_authoritative_active_tenant_root_pair_binding_v1(
        epoch_two.identity().digest().unwrap(),
        &custody_binding,
        &active_role_resolution(
            &epoch_two,
            TenantRootManagedRestoreRoleV1::DeriverA,
            refreshed_receipt,
        ),
        &active_role_resolution(
            &epoch_two,
            TenantRootManagedRestoreRoleV1::DeriverB,
            refreshed_receipt,
        ),
    )
    .unwrap();
    assert_eq!(
        refreshed,
        TenantRootActivePairResolutionV1::Mismatched(
            TenantRootActivePairMismatchV1::CustodyBinding
        )
    );

    let (other_lineage, _, _) = active_refresh_state(lineage(0x77));
    let other_lineage_receipt = other_lineage.current().activation().digest();
    let other_lineage_result = resolve_authoritative_active_tenant_root_pair_binding_v1(
        other_lineage.identity().digest().unwrap(),
        &custody_binding,
        &active_role_resolution(
            &other_lineage,
            TenantRootManagedRestoreRoleV1::DeriverA,
            other_lineage_receipt,
        ),
        &active_role_resolution(
            &other_lineage,
            TenantRootManagedRestoreRoleV1::DeriverB,
            other_lineage_receipt,
        ),
    )
    .unwrap();
    assert_eq!(
        other_lineage_result,
        TenantRootActivePairResolutionV1::Mismatched(
            TenantRootActivePairMismatchV1::CustodyBinding
        )
    );
}

#[test]
fn authoritative_pair_rejects_an_activation_receipt_substitution() {
    let (active, _, _) = active_refresh_state(lineage(0x78));
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let custody_binding = custody_binding(&active, &stable_context);
    let expected = custody_binding.activation_receipt_digest();
    let substituted = digest(0x99);
    let resolution = resolve_authoritative_active_tenant_root_pair_binding_v1(
        active.identity().digest().unwrap(),
        &custody_binding,
        &active_role_resolution(&active, TenantRootManagedRestoreRoleV1::DeriverA, expected),
        &active_role_resolution(
            &active,
            TenantRootManagedRestoreRoleV1::DeriverB,
            substituted,
        ),
    )
    .unwrap();
    assert_eq!(
        resolution,
        TenantRootActivePairResolutionV1::Mismatched(
            TenantRootActivePairMismatchV1::ActivationReceiptDigest {
                expected,
                deriver_a: expected,
                deriver_b: substituted,
            }
        )
    );
}

#[test]
fn authoritative_pair_rejects_a_foreign_custody_identity() {
    let (active, _, _) = active_refresh_state(lineage(0x79));
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let custody_binding = custody_binding(&active, &stable_context);
    let receipt = custody_binding.activation_receipt_digest();
    let deriver_a =
        active_role_resolution(&active, TenantRootManagedRestoreRoleV1::DeriverA, receipt);
    let deriver_b =
        active_role_resolution(&active, TenantRootManagedRestoreRoleV1::DeriverB, receipt);

    let error = resolve_authoritative_active_tenant_root_pair_binding_v1(
        TenantRootIdentityDigestV1::from_bytes([0x99; 32]),
        &custody_binding,
        &deriver_a,
        &deriver_b,
    )
    .unwrap_err();
    assert_eq!(
        error.code(),
        router_ab_core::RouterAbDerivationErrorCode::MalformedInput
    );
}

#[test]
fn custody_binding_identifiers_and_lifetime_are_strict() {
    let operation_id = TenantRootDerivationOperationIdV1::from_bytes([0x81; 16]).unwrap();
    let session_id = TenantRootDerivationSessionIdV1::from_bytes([0x82; 16]).unwrap();
    let nonce = TenantRootDerivationNonceV1::from_bytes([0x83; 32]).unwrap();
    let serialized_operation = serde_json::to_value(operation_id).unwrap();
    assert!(serde_json::from_value::<TenantRootDerivationOperationIdV1>(
        serialized_operation.clone()
    )
    .is_ok());
    assert!(serde_json::from_value::<TenantRootDerivationOperationIdV1>(
        serde_json::Value::String(format!("{}=", serialized_operation.as_str().unwrap()))
    )
    .is_err());
    assert!(serde_json::from_value::<TenantRootDerivationOperationIdV1>(
        serde_json::Value::String("AQ".to_owned())
    )
    .is_err());
    let serialized_session = serde_json::to_value(session_id).unwrap();
    assert!(
        serde_json::from_value::<TenantRootDerivationSessionIdV1>(serialized_session.clone())
            .is_ok()
    );
    assert!(
        serde_json::from_value::<TenantRootDerivationSessionIdV1>(serde_json::Value::String(
            format!("{}=", serialized_session.as_str().unwrap())
        ))
        .is_err()
    );
    assert!(
        serde_json::from_value::<TenantRootDerivationSessionIdV1>(serde_json::Value::String(
            "AQ".to_owned()
        ))
        .is_err()
    );
    let serialized_nonce = serde_json::to_value(nonce).unwrap();
    assert!(
        serde_json::from_value::<TenantRootDerivationNonceV1>(serialized_nonce.clone()).is_ok()
    );
    assert!(
        serde_json::from_value::<TenantRootDerivationNonceV1>(serde_json::Value::String(format!(
            "{}=",
            serialized_nonce.as_str().unwrap()
        ),))
        .is_err()
    );
    assert!(TenantRootDerivationOperationIdV1::from_bytes([0; 16]).is_err());
    assert!(TenantRootDerivationSessionIdV1::from_bytes([0; 16]).is_err());
    assert!(TenantRootDerivationNonceV1::from_bytes([0; 32]).is_err());
    assert!(TenantRootDeriverIdentitiesV1::new("", "deriver-b").is_err());
    assert!(TenantRootDeriverIdentitiesV1::new("same", "same").is_err());

    let (active, _, _) = active_refresh_state(lineage(0x72));
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let binding = custody_binding(&active, &stable_context);
    assert!(binding.validate_at(ISSUED_AT_MS - 60_000).is_ok());
    assert!(binding.validate_at(ISSUED_AT_MS - 60_001).is_err());
    assert!(binding.validate_at(EXPIRES_AT_MS + 60_000).is_ok());
    assert!(binding.validate_at(EXPIRES_AT_MS + 60_001).is_err());

    assert!(TenantRootCustodyBindingV1::from_active(
        &active,
        TenantRootDeriverIdentitiesV1::new("deriver-a", "deriver-b").unwrap(),
        operation_id,
        session_id,
        nonce,
        0,
        EXPIRES_AT_MS,
        &stable_context,
        TenantRootProtocolDigestV1::from_bytes([0x84; 32]).expect("non-zero protocol digest"),
    )
    .is_err());
    assert!(TenantRootCustodyBindingV1::from_active(
        &active,
        TenantRootDeriverIdentitiesV1::new("deriver-a", "deriver-b").unwrap(),
        operation_id,
        session_id,
        nonce,
        ISSUED_AT_MS,
        ISSUED_AT_MS,
        &stable_context,
        TenantRootProtocolDigestV1::from_bytes([0x84; 32]).expect("non-zero protocol digest"),
    )
    .is_err());
}

#[test]
fn custody_binding_digest_rejects_public_field_substitution() {
    let (active, _, _) = active_refresh_state(lineage(0x73));
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let alternate_context = StableTenantDerivationContextV2::new([0x43; 32]);
    let base = custody_binding(&active, &stable_context).digest().unwrap();
    let build = |deriver_a: &str,
                 operation: u8,
                 session: u8,
                 nonce: u8,
                 context: &StableTenantDerivationContextV2,
                 protocol: u8| {
        TenantRootCustodyBindingV1::from_active(
            &active,
            TenantRootDeriverIdentitiesV1::new(deriver_a, "deriver-b-runtime-9").unwrap(),
            TenantRootDerivationOperationIdV1::from_bytes([operation; 16]).unwrap(),
            TenantRootDerivationSessionIdV1::from_bytes([session; 16]).unwrap(),
            TenantRootDerivationNonceV1::from_bytes([nonce; 32]).unwrap(),
            ISSUED_AT_MS,
            EXPIRES_AT_MS,
            context,
            TenantRootProtocolDigestV1::from_bytes([protocol; 32])
                .expect("non-zero protocol digest"),
        )
        .unwrap()
    };
    let substituted = [
        build(
            "deriver-a-runtime-8",
            0x81,
            0x82,
            0x83,
            &stable_context,
            0x84,
        ),
        build(
            "deriver-a-runtime-7",
            0x85,
            0x82,
            0x83,
            &stable_context,
            0x84,
        ),
        build(
            "deriver-a-runtime-7",
            0x81,
            0x86,
            0x83,
            &stable_context,
            0x84,
        ),
        build(
            "deriver-a-runtime-7",
            0x81,
            0x82,
            0x87,
            &stable_context,
            0x84,
        ),
        build(
            "deriver-a-runtime-7",
            0x81,
            0x82,
            0x83,
            &alternate_context,
            0x84,
        ),
        build(
            "deriver-a-runtime-7",
            0x81,
            0x82,
            0x83,
            &stable_context,
            0x89,
        ),
    ];

    for binding in substituted {
        assert_ne!(binding.digest().unwrap(), base);
    }
}

#[test]
fn custody_binding_canonical_digest_is_frozen() {
    let (active, _, _) = active_refresh_state(lineage(0x74));
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let binding = custody_binding(&active, &stable_context);

    assert_eq!(
        hex::encode(binding.digest().unwrap().into_bytes()),
        "8e32299705e9c1aa1f87805b882df95f6fdc1dadfb2955585a777b37194170f6",
    );
}

#[test]
fn custody_binding_lifetime_and_identities_use_the_frozen_boundary_rules() {
    let (active, _, _) = active_refresh_state(lineage(0x74));
    let stable_context = StableTenantDerivationContextV2::new([0x42; 32]);
    let build = |issued_at_ms: u64, expires_at_ms: u64, deriver_a: &str, deriver_b: &str| {
        TenantRootCustodyBindingV1::from_active(
            &active,
            TenantRootDeriverIdentitiesV1::new(deriver_a, deriver_b)?,
            TenantRootDerivationOperationIdV1::from_bytes([0x81; 16]).unwrap(),
            TenantRootDerivationSessionIdV1::from_bytes([0x82; 16]).unwrap(),
            TenantRootDerivationNonceV1::from_bytes([0x83; 32]).unwrap(),
            issued_at_ms,
            expires_at_ms,
            &stable_context,
            TenantRootProtocolDigestV1::from_bytes([0x84; 32]).expect("non-zero protocol digest"),
        )
    };

    let issued = ISSUED_AT_MS;
    assert!(build(
        issued,
        issued + TENANT_ROOT_MAX_LIFETIME_MS_V1,
        "deriver-a-runtime-7",
        "deriver-b-runtime-9",
    )
    .is_ok());
    assert!(build(
        issued,
        issued + TENANT_ROOT_MAX_LIFETIME_MS_V1 + 1,
        "deriver-a-runtime-7",
        "deriver-b-runtime-9",
    )
    .is_err());

    for rejected in [
        "",
        " deriver-a-runtime-7",
        "deriver-a-runtime-7 ",
        "deriver-a\u{0000}runtime-7",
        "deriver-a\nruntime-7",
    ] {
        assert!(
            build(issued, EXPIRES_AT_MS, rejected, "deriver-b-runtime-9").is_err(),
            "expected rejection for {rejected:?}"
        );
    }
    let longest = "d".repeat(256);
    assert!(build(issued, EXPIRES_AT_MS, &longest, "deriver-b-runtime-9").is_ok());
    let too_long = "d".repeat(257);
    assert!(build(issued, EXPIRES_AT_MS, &too_long, "deriver-b-runtime-9").is_err());
}
