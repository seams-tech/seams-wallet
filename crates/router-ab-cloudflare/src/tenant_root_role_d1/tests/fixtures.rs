//! Fixtures for the role-store tests: ciphers, identities, contexts, commands, records and activation bundles.

use super::*;

pub(super) struct PersistedOnlineShareProvider {
    pub(super) opened_share: Option<SigningRootShareWire>,
}

impl TenantRootOnlineRoleShareProviderV1 for PersistedOnlineShareProvider {
    fn seal_online_role_share(
        &mut self,
        _request: &TenantRootOnlineRoleShareSealRequestV1,
    ) -> router_ab_core::RouterAbDerivationResult<Vec<u8>> {
        Err(RouterAbDerivationError::new(
            router_ab_core::RouterAbDerivationErrorCode::MalformedInput,
            "persisted-artifact test provider does not seal shares",
        ))
    }

    fn open_online_role_share(
        &mut self,
        sealed: TenantRootSealedOnlineRoleShareV1,
    ) -> router_ab_core::RouterAbDerivationResult<
        router_ab_core::VerifiedTenantRootOnlineRoleShareV1,
    > {
        let opened_share = self.opened_share.take().ok_or_else(|| {
            RouterAbDerivationError::new(
                router_ab_core::RouterAbDerivationErrorCode::MalformedInput,
                "persisted-artifact test provider has no opened share",
            )
        })?;
        sealed.verify_opened_share(opened_share)
    }
}

pub(super) fn test_cipher(role: CloudflareTenantRootDeriverRoleV1, seed: u8) -> TenantRootRoleD1CipherV1 {
    let (private_key, public_key) = CloudflareHpkeKemV1::derive_key_pair(&[seed; 32])
        .expect("test role-private D1 keypair derives");
    TenantRootRoleD1CipherV1 {
        environment: "test".to_owned(),
        role,
        key_version: "outer-kek-1".to_owned(),
        public_key,
        private_key,
    }
}

pub(super) fn test_identity() -> TenantRootIdentityV1 {
    TenantRootIdentityV1::new(
        "org-1",
        "project-1",
        "env-1",
        "project-1:env-1",
        "root-version-1",
    )
    .expect("identity")
}

pub(super) fn test_creation_context() -> TenantRootCeremonyContextV1 {
    test_creation_context_for_identity(test_identity())
}

pub(super) fn test_creation_context_for_identity(
    identity: TenantRootIdentityV1,
) -> TenantRootCeremonyContextV1 {
    let custody_lineage = TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage");
    TenantRootCeremonyContextV1::new(
        identity.digest().expect("identity digest"),
        custody_lineage,
        TenantRootCeremonyEpochsV1::create(),
        TenantRootCeremonySessionIdV1::from_bytes([0x45; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x46; 32]).expect("nonce"),
        10,
        100,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("creation context")
}

pub(super) fn test_refresh_context() -> TenantRootCeremonyContextV1 {
    test_refresh_context_with_identity(test_identity(), 0x44, 1, 2, 0x45, 0x46)
}

pub(super) fn test_refresh_context_with_identity(
    identity: TenantRootIdentityV1,
    lineage_seed: u8,
    current_epoch: u64,
    next_epoch: u64,
    session_seed: u8,
    nonce_seed: u8,
) -> TenantRootCeremonyContextV1 {
    let custody_lineage =
        TenantRootCustodyLineageId::from_bytes([lineage_seed; 16]).expect("lineage");
    TenantRootCeremonyContextV1::new(
        identity.digest().expect("identity digest"),
        custody_lineage,
        TenantRootCeremonyEpochsV1::refresh(epoch(current_epoch), epoch(next_epoch))
            .expect("refresh epochs"),
        TenantRootCeremonySessionIdV1::from_bytes([session_seed; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([nonce_seed; 32]).expect("nonce"),
        10,
        100,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("refresh context")
}

pub(super) fn test_refresh_active_pair() -> TenantRootActiveRootPairV1 {
    let identity_digest = test_identity().digest().expect("identity digest");
    let custody_lineage = TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage");
    let epoch = epoch(1);
    let receipt = lifecycle_receipt(0x89).expect("activation receipt");
    let deriver_a = TenantRootActiveRoleBindingV1::new(
        TenantRootActiveRoleRowKeyV1::new(
            identity_digest,
            custody_lineage,
            epoch,
            TenantRootManagedRestoreRoleV1::DeriverA,
        ),
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 7),
        receipt,
    )
    .expect("Deriver A active binding");
    let deriver_b = TenantRootActiveRoleBindingV1::new(
        TenantRootActiveRoleRowKeyV1::new(
            identity_digest,
            custody_lineage,
            epoch,
            TenantRootManagedRestoreRoleV1::DeriverB,
        ),
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 8),
        receipt,
    )
    .expect("Deriver B active binding");
    resolve_active_tenant_root_pair_binding_v1(
        identity_digest,
        &TenantRootActiveRoleResolutionV1::Active(deriver_a),
        &TenantRootActiveRoleResolutionV1::Active(deriver_b),
    )
    .expect("active pair resolution")
    .require_active()
    .expect("active pair")
    .clone()
}

pub(super) fn test_verified_refresh_command(
    role: TwoPartyDeriverRole,
    expected_control_plane_revision: u64,
) -> VerifiedTenantRootRoleRefreshCommandV1 {
    test_verified_refresh_command_with_window(role, expected_control_plane_revision, 20, 40)
}

pub(super) fn test_verified_refresh_command_with_window(
    role: TwoPartyDeriverRole,
    expected_control_plane_revision: u64,
    issued_at_ms: u64,
    expires_at_ms: u64,
) -> VerifiedTenantRootRoleRefreshCommandV1 {
    let active_pair = test_refresh_active_pair();
    let context = test_refresh_context();
    let signing_key = SigningKey::from_bytes(&[0x47; 32]);
    TenantRootRoleRefreshCommandV1::sign(
        &active_pair,
        &context,
        role,
        expected_control_plane_revision,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]),
        issued_at_ms,
        expires_at_ms,
        "test-issuer-v1",
        signing_key.as_bytes(),
    )
    .expect("signed refresh command")
    .verify(
        &active_pair,
        &context,
        role,
        expected_control_plane_revision,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]),
        "test-issuer-v1",
        signing_key.verifying_key().as_bytes(),
    )
    .expect("verified refresh command")
}

pub(super) fn test_refresh_evidence(
    context: &router_ab_core::TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
) -> VerifiedTenantRootSignedShareInstallationEvidenceWireV1 {
    let (signing_seed, proof_seed) = match role {
        TwoPartyDeriverRole::DeriverA => (0x57, 0x67),
        TwoPartyDeriverRole::DeriverB => (0x58, 0x68),
    };
    test_refresh_evidence_with_seeds(context, role, signing_seed, proof_seed)
}

pub(super) fn test_refresh_evidence_with_seeds(
    context: &router_ab_core::TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    signing_seed: u8,
    proof_seed: u8,
) -> VerifiedTenantRootSignedShareInstallationEvidenceWireV1 {
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
    match role {
        TwoPartyDeriverRole::DeriverA => signed_installation_evidence_wire(
            context,
            role,
            &share_a,
            &share_b,
            signing_seed,
            proof_seed,
        ),
        TwoPartyDeriverRole::DeriverB => signed_installation_evidence_wire(
            context,
            role,
            &share_b,
            &share_a,
            signing_seed,
            proof_seed,
        ),
    }
}

pub(super) fn refresh_input_with_sealed_evidence(
    command: VerifiedTenantRootRoleRefreshCommandV1,
    evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    identity: TenantRootIdentityV1,
    sealed_context: &router_ab_core::TenantRootCeremonyContextV1,
    sealed_evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    sealed_role: TwoPartyDeriverRole,
) -> RoleStoreResult<CloudflareTenantRootRefreshInputV1> {
    let sealed_online_share =
        test_sealed_online_share(sealed_context, sealed_evidence, sealed_role);
    CloudflareTenantRootRefreshInputV1::new(
        command,
        evidence,
        CloudflareTenantRootRefreshShareInputV1::new(identity, sealed_online_share, 30),
    )
}

pub(super) fn test_verified_initial_creation_command(
    role: TwoPartyDeriverRole,
    issued_at_ms: u64,
    expires_at_ms: u64,
) -> VerifiedTenantRootRoleCreationCommandV1 {
    let identity = test_identity();
    let custody_lineage = TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage");
    let context = test_creation_context();
    let journal =
        TenantRootCreationJournalV1::started(identity, custody_lineage, context.clone())
            .expect("Started journal");
    let signing_key = SigningKey::from_bytes(&[0x47; 32]);
    TenantRootRoleCreationCommandV1::sign(
        &journal,
        &context,
        role,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]),
        issued_at_ms,
        expires_at_ms,
        "test-issuer-v1",
        signing_key.as_bytes(),
    )
    .expect("signed command")
    .verify(
        &journal,
        &context,
        role,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]),
        "test-issuer-v1",
        signing_key.verifying_key().as_bytes(),
    )
    .expect("verified command")
}

pub(super) fn test_commitment(role: CloudflareTenantRootDeriverRoleV1) -> MpcPrfShareCommitmentWireV1 {
    pair_commitment(
        role,
        match role {
            CloudflareTenantRootDeriverRoleV1::DeriverA => 17,
            CloudflareTenantRootDeriverRoleV1::DeriverB => 29,
        },
    )
}

pub(super) fn core_role(role: CloudflareTenantRootDeriverRoleV1) -> TwoPartyDeriverRole {
    match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        CloudflareTenantRootDeriverRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    }
}

pub(super) fn scalar_for_commitment(
    role: CloudflareTenantRootDeriverRoleV1,
    commitment: &MpcPrfShareCommitmentWireV1,
) -> u64 {
    (1..=1024)
        .find(|scalar| pair_commitment(role, *scalar) == *commitment)
        .expect("test commitment has a small discrete-log fixture")
}

pub(super) fn test_context_for_record(
    identity: &TenantRootIdentityV1,
    custody_lineage: TenantRootCustodyLineageId,
    target_epoch: TenantRootShareEpoch,
) -> TenantRootCeremonyContextV1 {
    let epochs = if target_epoch == TenantRootShareEpoch::INITIAL {
        TenantRootCeremonyEpochsV1::create()
    } else {
        TenantRootCeremonyEpochsV1::refresh(epoch(target_epoch.get().get() - 1), target_epoch)
            .expect("refresh epochs")
    };
    TenantRootCeremonyContextV1::new(
        identity.digest().expect("identity digest"),
        custody_lineage,
        epochs,
        TenantRootCeremonySessionIdV1::from_bytes([0x45; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x46; 32]).expect("nonce"),
        10,
        100,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("test context")
}

pub(super) fn test_target_commitments(
    role: CloudflareTenantRootDeriverRoleV1,
    share_commitment: &MpcPrfShareCommitmentWireV1,
) -> (TenantRootEpochCommitmentsV1, u64, u64) {
    let (deriver_a, scalar_a, deriver_b, scalar_b) = match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => (
            share_commitment.clone(),
            scalar_for_commitment(role, share_commitment),
            pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 29),
            29,
        ),
        CloudflareTenantRootDeriverRoleV1::DeriverB => (
            pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17),
            17,
            share_commitment.clone(),
            scalar_for_commitment(role, share_commitment),
        ),
    };
    (
        TenantRootEpochCommitmentsV1::new(deriver_a, deriver_b)
            .expect("test target commitments"),
        scalar_a,
        scalar_b,
    )
}

pub(super) fn test_refresh_current_commitments(
    target: &TenantRootEpochCommitmentsV1,
) -> TenantRootEpochCommitmentsV1 {
    let current_a = commitment_point(&pair_commitment(
        CloudflareTenantRootDeriverRoleV1::DeriverA,
        6,
    ));
    let target_root = CompressedRistretto(
        (*target.root_commitment())
            .try_into()
            .expect("target root commitment point"),
    )
    .decompress()
    .expect("target root commitment point");
    let current_b = (Scalar::from(2_u64) * current_a) - target_root;
    TenantRootEpochCommitmentsV1::new(
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 6),
        commitment_wire_from_point(CloudflareTenantRootDeriverRoleV1::DeriverB, current_b),
    )
    .expect("test refresh current commitments")
}

pub(super) fn commitment_point(commitment: &MpcPrfShareCommitmentWireV1) -> RistrettoPoint {
    CompressedRistretto(
        commitment.as_bytes()[2..]
            .try_into()
            .expect("commitment point"),
    )
    .decompress()
    .expect("commitment point decodes")
}

pub(super) fn commitment_wire_from_point(
    role: CloudflareTenantRootDeriverRoleV1,
    point: RistrettoPoint,
) -> MpcPrfShareCommitmentWireV1 {
    let mut bytes = Vec::with_capacity(34);
    bytes.extend_from_slice(&role.share_id().to_be_bytes());
    bytes.extend_from_slice(point.compress().as_bytes());
    MpcPrfShareCommitmentWireV1::new(bytes).expect("commitment wire")
}

pub(super) fn test_signed_installation_evidence(
    context: &router_ab_core::TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    scalar_a: u64,
    scalar_b: u64,
) -> VerifiedTenantRootSignedShareInstallationEvidenceWireV1 {
    let share_a = SigningRootShare::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverA.share_id(),
        Scalar::from(scalar_a).to_bytes(),
    )
    .expect("Deriver A share");
    let share_b = SigningRootShare::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverB.share_id(),
        Scalar::from(scalar_b).to_bytes(),
    )
    .expect("Deriver B share");
    let (share, peer, signing_seed, proof_seed) = match role {
        TwoPartyDeriverRole::DeriverA => (&share_a, &share_b, 0x57, 0x67),
        TwoPartyDeriverRole::DeriverB => (&share_b, &share_a, 0x58, 0x68),
    };
    signed_installation_evidence_wire(context, role, share, peer, signing_seed, proof_seed)
}

pub(super) fn test_verified_managed_backup(
    context: &router_ab_core::TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    scalar: u64,
    backup_seed: u8,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
) -> VerifiedTenantRootManagedBackupV1 {
    let managed_role = match role {
        TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
        TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
    };
    let (backup_provider_id, backup_key_version) = match role {
        TwoPartyDeriverRole::DeriverA => ("backup-provider-a-v1", "backup-key-a-v1"),
        TwoPartyDeriverRole::DeriverB => ("backup-provider-b-v1", "backup-key-b-v1"),
    };
    let binding = TenantRootManagedBackupBindingV1::from_verified_installation_evidence(
        evidence,
        backup_provider_id,
        backup_key_version,
        context.signing_key_id(role),
        11,
    )
    .expect("managed-backup binding");
    assert_eq!(binding.role(), managed_role.managed_restore_role());
    assert_eq!(binding.custody_lineage(), context.custody_lineage());
    let share = SigningRootShare::from_canonical_bytes(
        role.share_id(),
        Scalar::from(scalar).to_bytes(),
    )
    .expect("managed-backup share");
    let share_wire = MpcPrfSigningRootShareWireV1::new(
        SigningRootShareWire::from_share(&share).to_bytes().to_vec(),
    )
    .expect("managed-backup share wire");
    let request = TenantRootManagedBackupSealRequestV1::new(binding.clone(), share_wire)
        .expect("managed-backup request");
    let signing_key = SigningKey::from_bytes(&[backup_seed; 32]);
    TenantRootSignedManagedBackupV1::sign(
        request,
        vec![backup_seed; 96],
        signing_key.as_bytes(),
    )
    .expect("signed managed backup")
    .verify(&binding, signing_key.verifying_key().as_bytes())
    .expect("verified managed backup")
}

pub(super) fn test_verified_provider_canary(
    context: &router_ab_core::TenantRootCeremonyContextV1,
    transition: TenantRootActivationReceiptTransitionV1,
    target_epoch: TenantRootShareEpoch,
    commitments: &TenantRootEpochCommitmentsV1,
    curve_family: TenantRootCanaryCurveFamilyV1,
    signing_seed: u8,
) -> VerifiedTenantRootProviderCanaryReceiptV1 {
    let binding = TenantRootProviderCanaryReceiptBindingV1::new(
        context.identity_digest(),
        context.custody_lineage(),
        transition,
        target_epoch,
        commitments.clone(),
        curve_family,
        "canary-provider-key-v1",
        20,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]),
        "canary-signing-key-v1",
        10,
        100,
    )
    .expect("provider canary binding");
    let signing_key = SigningKey::from_bytes(&[signing_seed; 32]);
    TenantRootSignedProviderCanaryReceiptV1::sign(binding.clone(), signing_key.as_bytes())
        .expect("signed provider canary")
        .verify(&binding, signing_key.verifying_key().as_bytes())
        .expect("verified provider canary")
}

pub(super) fn record_for_identity_epoch(
    identity: TenantRootIdentityV1,
    role: CloudflareTenantRootDeriverRoleV1,
    lineage_seed: u8,
    target_epoch: TenantRootShareEpoch,
    share_commitment: MpcPrfShareCommitmentWireV1,
) -> CloudflareTenantRootRoleShareRecordV1 {
    let custody_lineage =
        TenantRootCustodyLineageId::from_bytes([lineage_seed; 16]).expect("lineage");
    let context = test_context_for_record(&identity, custody_lineage, target_epoch);
    let (target_commitments, scalar_a, scalar_b) =
        test_target_commitments(role, &share_commitment);
    let evidence =
        test_signed_installation_evidence(&context, core_role(role), scalar_a, scalar_b);
    debug_assert_eq!(
        share_commitment,
        match role {
            CloudflareTenantRootDeriverRoleV1::DeriverA =>
                target_commitments.deriver_a().clone(),
            CloudflareTenantRootDeriverRoleV1::DeriverB =>
                target_commitments.deriver_b().clone(),
        }
    );
    CloudflareTenantRootRoleShareRecordV1::new(CloudflareTenantRootRoleShareRecordInputV1 {
        identity,
        custody_lineage,
        epoch: target_epoch,
        role,
        sealed_share: CloudflareTenantRootSealedRoleShareV1::new(&[0x66; 96])
            .expect("sealed share"),
        share_commitment,
        epoch_wrapping_key_ref: format!("kms://deriver/tenant/epoch-{}", target_epoch.get()),
        lifecycle: CloudflareTenantRootRoleShareLifecycleV1::Pending(
            CloudflareTenantRootPendingShareV1::from_verified_installation_evidence(
                &evidence, 10,
            )
            .expect("pending"),
        ),
        created_at_ms: 10,
        updated_at_ms: 10,
    })
    .expect("record")
}

pub(super) fn record(role: CloudflareTenantRootDeriverRoleV1) -> CloudflareTenantRootRoleShareRecordV1 {
    record_for_identity_epoch(
        test_identity(),
        role,
        0x44,
        TenantRootShareEpoch::INITIAL,
        test_commitment(role),
    )
}

pub(super) fn current_backup_activation(
    role: CloudflareTenantRootDeriverRoleV1,
    backup_seed: u8,
    activation_seed: u8,
    activated_at_ms: u64,
) -> CloudflareTenantRootActivationV1 {
    current_backup_activation_for_record(
        &record(role),
        backup_seed,
        activation_seed,
        activated_at_ms,
    )
}

pub(super) fn deriver_b_share_activation_digest() -> TenantRootLifecycleReceiptDigestV1 {
    current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverB, 0x88, 0x89, 20)
        .activation_receipt_digest()
}

pub(super) fn test_activation_target(
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> (
    TenantRootEpochCommitmentsV1,
    u64,
    u64,
    TenantRootCeremonyContextV1,
) {
    let target_commitments = test_target_commitments(record.role(), record.share_commitment());
    let context =
        test_context_for_record(record.identity(), record.custody_lineage(), record.epoch());
    (
        target_commitments.0,
        target_commitments.1,
        target_commitments.2,
        context,
    )
}

pub(super) fn test_initial_activation_bundle(
    record: &CloudflareTenantRootRoleShareRecordV1,
    backup_seed: u8,
    canary_seed: u8,
) -> VerifiedTenantRootInitialCreationActivationEvidenceBundleV1 {
    let (target_commitments, scalar_a, scalar_b, context) = test_activation_target(record);
    let evidence_a = test_signed_installation_evidence(
        &context,
        TwoPartyDeriverRole::DeriverA,
        scalar_a,
        scalar_b,
    );
    let evidence_b = test_signed_installation_evidence(
        &context,
        TwoPartyDeriverRole::DeriverB,
        scalar_a,
        scalar_b,
    );
    let backup_a = test_verified_managed_backup(
        &context,
        TwoPartyDeriverRole::DeriverA,
        scalar_a,
        backup_seed,
        &evidence_a,
    );
    let backup_b = test_verified_managed_backup(
        &context,
        TwoPartyDeriverRole::DeriverB,
        scalar_b,
        backup_seed.wrapping_add(1),
        &evidence_b,
    );
    let canary_ecdsa = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        &target_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
        canary_seed,
    );
    let canary_ed25519 = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        &target_commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
        canary_seed.wrapping_add(1),
    );
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_managed_backups(
        evidence_a,
        evidence_b,
        backup_a,
        backup_b,
        canary_ecdsa,
        canary_ed25519,
        2,
        3,
    )
    .expect("initial activation evidence")
}

pub(super) fn test_external_initial_activation_bundle(
    record: &CloudflareTenantRootRoleShareRecordV1,
    seed: u8,
    canary_seed: u8,
) -> VerifiedTenantRootInitialCreationActivationEvidenceBundleV1 {
    let (target_commitments, scalar_a, scalar_b, base_context) = test_activation_target(record);
    let destination_fingerprint =
        TenantRootRestoreDestinationFingerprintV1::from_bytes([seed; 32])
            .expect("destination fingerprint");
    let restore_session_id =
        TenantRootRestoreSessionIdV1::from_bytes([seed.wrapping_add(1); 16])
            .expect("restore session");
    let manifest_digest = [seed.wrapping_add(2); 32];
    let deriver_a_acceptance_receipt_digest =
        lifecycle_receipt(seed.wrapping_add(3)).expect("Deriver A acceptance receipt");
    let deriver_b_acceptance_receipt_digest =
        lifecycle_receipt(seed.wrapping_add(4)).expect("Deriver B acceptance receipt");
    let recovery_set_id =
        TenantRootRecoverySetId::from_bytes([seed.wrapping_add(5); 16]).expect("recovery set");
    let nonce = tenant_root_restore_refresh_context_nonce_v1(
        base_context.identity_digest(),
        base_context.custody_lineage(),
        base_context.session_id(),
        destination_fingerprint,
        restore_session_id,
        manifest_digest,
        deriver_a_acceptance_receipt_digest,
        deriver_b_acceptance_receipt_digest,
        target_commitments.deriver_a(),
        target_commitments.deriver_b(),
        *target_commitments.root_commitment(),
    )
    .expect("restore refresh context nonce");
    let context = TenantRootCeremonyContextV1::new(
        base_context.identity_digest(),
        base_context.custody_lineage(),
        base_context.epochs(),
        base_context.session_id(),
        nonce,
        base_context.issued_at_ms(),
        base_context.expires_at_ms(),
        base_context.signing_key_id(TwoPartyDeriverRole::DeriverA),
        base_context.signing_key_id(TwoPartyDeriverRole::DeriverB),
    )
    .expect("restore refresh context");
    let evidence_a = test_signed_installation_evidence(
        &context,
        TwoPartyDeriverRole::DeriverA,
        scalar_a,
        scalar_b,
    );
    let evidence_b = test_signed_installation_evidence(
        &context,
        TwoPartyDeriverRole::DeriverB,
        scalar_a,
        scalar_b,
    );
    let issuer_key = SigningKey::from_bytes(&[seed.wrapping_add(6); 32]);
    let command = TenantRootRestoreRefreshRoleCommandV1::sign(
        &context,
        destination_fingerprint,
        restore_session_id,
        manifest_digest,
        deriver_a_acceptance_receipt_digest,
        deriver_b_acceptance_receipt_digest,
        target_commitments.deriver_a().clone(),
        target_commitments.deriver_b().clone(),
        *target_commitments.root_commitment(),
        TwoPartyDeriverRole::DeriverA,
        "test-restore-refresh-issuer-v1",
        issuer_key.as_bytes(),
    )
    .expect("signed restore refresh role command")
    .verify(
        "test-restore-refresh-issuer-v1",
        issuer_key.verifying_key().as_bytes(),
    )
    .expect("verified restore refresh role command");
    let availability = TenantRootActivationAvailabilityEvidenceV1::from_verified_restore(
        &command,
        recovery_set_id,
    )
    .expect("tenant-held external availability");
    let canary_ecdsa = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        &target_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
        canary_seed,
    );
    let canary_ed25519 = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        &target_commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
        canary_seed.wrapping_add(1),
    );
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::new(
        evidence_a,
        evidence_b,
        availability,
        canary_ecdsa,
        canary_ed25519,
        2,
        3,
    )
    .expect("initial tenant-held external activation evidence")
}

pub(super) fn tenant_held_external_activation_for_record(
    record: &CloudflareTenantRootRoleShareRecordV1,
    seed: u8,
    activated_at_ms: u64,
) -> CloudflareTenantRootActivationV1 {
    let issuer_key = SigningKey::from_bytes(&[seed.wrapping_add(6); 32]);
    let signed = TenantRootSignedActivationReceiptV1::sign_initial_creation(
        &test_external_initial_activation_bundle(record, seed, seed.wrapping_add(7)),
        activated_at_ms,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]),
        "test-external-activation-issuer-v1",
        issuer_key.as_bytes(),
    )
    .expect("signed tenant-held external activation");
    let verified = signed
        .verify_initial_creation(
            &test_external_initial_activation_bundle(record, seed, seed.wrapping_add(7)),
            activated_at_ms,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]),
            "test-external-activation-issuer-v1",
            issuer_key.verifying_key().as_bytes(),
        )
        .expect("verified tenant-held external activation");
    let receipt_bytes = verified.canonical_bytes().to_vec();
    let receipt = decode_activation_receipt_bytes(&receipt_bytes)
        .expect("tenant-held external activation receipt");
    let TenantRootActivationReceiptAvailabilityV1::TenantHeldExternal { provenance } =
        receipt.availability()
    else {
        panic!("expected tenant-held external availability");
    };
    CloudflareTenantRootActivationV1::from_stored_receipt_bytes(
        CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal {
            provenance: provenance.clone(),
        },
        receipt_bytes,
    )
    .expect("tenant-held external activation")
}

pub(super) fn test_refresh_activation_bundle(
    record: &CloudflareTenantRootRoleShareRecordV1,
    backup_seed: u8,
    canary_seed: u8,
) -> VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1 {
    let (target_commitments, scalar_a, scalar_b, context) = test_activation_target(record);
    test_refresh_activation_bundle_for_context(
        &context,
        &test_refresh_current_commitments(&target_commitments),
        &target_commitments,
        scalar_a,
        scalar_b,
        backup_seed,
        canary_seed,
    )
}

pub(super) fn test_refresh_activation_bundle_for_context(
    context: &TenantRootCeremonyContextV1,
    current_commitments: &TenantRootEpochCommitmentsV1,
    target_commitments: &TenantRootEpochCommitmentsV1,
    scalar_a: u64,
    scalar_b: u64,
    backup_seed: u8,
    canary_seed: u8,
) -> VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1 {
    let target_epoch = match context.epochs() {
        TenantRootCeremonyEpochsV1::Refresh { next, .. } => next,
        TenantRootCeremonyEpochsV1::Create { .. } => panic!("refresh context required"),
    };
    let evidence_a = test_signed_installation_evidence(
        context,
        TwoPartyDeriverRole::DeriverA,
        scalar_a,
        scalar_b,
    );
    let evidence_b = test_signed_installation_evidence(
        context,
        TwoPartyDeriverRole::DeriverB,
        scalar_a,
        scalar_b,
    );
    let backup_a = test_verified_managed_backup(
        context,
        TwoPartyDeriverRole::DeriverA,
        scalar_a,
        backup_seed,
        &evidence_a,
    );
    let backup_b = test_verified_managed_backup(
        context,
        TwoPartyDeriverRole::DeriverB,
        scalar_b,
        backup_seed.wrapping_add(1),
        &evidence_b,
    );
    let canary_ecdsa = test_verified_provider_canary(
        context,
        TenantRootActivationReceiptTransitionV1::RefreshSwap,
        target_epoch,
        target_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
        canary_seed,
    );
    let canary_ed25519 = test_verified_provider_canary(
        context,
        TenantRootActivationReceiptTransitionV1::RefreshSwap,
        target_epoch,
        target_commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
        canary_seed.wrapping_add(1),
    );
    VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1::from_verified_managed_backups(
        current_commitments,
        evidence_a,
        evidence_b,
        backup_a,
        backup_b,
        canary_ecdsa,
        canary_ed25519,
        2,
        3,
    )
    .expect("refresh activation evidence")
}

pub(super) fn test_verified_accepted_loss_authorization(
    context: &router_ab_core::TenantRootCeremonyContextV1,
    target_commitments: &TenantRootEpochCommitmentsV1,
    installation_receipts: TenantRootRoleInstallationReceiptsV1,
    variant: u8,
) -> router_ab_core::VerifiedTenantRootAcceptedPermanentLossAuthorizationV1 {
    let (transition, target_epoch) = match context.epochs() {
        TenantRootCeremonyEpochsV1::Create { next } => (
            TenantRootActivationReceiptTransitionV1::InitialCreation,
            next,
        ),
        TenantRootCeremonyEpochsV1::Refresh { next, .. } => {
            (TenantRootActivationReceiptTransitionV1::RefreshSwap, next)
        }
    };
    let binding = TenantRootAcceptedPermanentLossAuthorizationBindingV1::new(
        context.identity_digest(),
        context.custody_lineage(),
        transition,
        target_epoch,
        context.digest().expect("context digest"),
        target_commitments.clone(),
        installation_receipts,
        2,
        3,
        format!("policy-accept-loss-{variant:02x}"),
        format!("incident-2026-{variant:04x}"),
        "both managed backups are unavailable",
        context.issued_at_ms(),
        context.expires_at_ms(),
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
        "operator-a-v1",
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x72; 32]),
        "operator-b-v1",
    )
    .expect("accepted-loss binding");
    let first_key = SigningKey::from_bytes(&[0x61; 32]);
    let second_key = SigningKey::from_bytes(&[0x62; 32]);
    TenantRootSignedAcceptedPermanentLossAuthorizationV1::sign(
        binding.clone(),
        first_key.as_bytes(),
        second_key.as_bytes(),
    )
    .expect("signed accepted-loss authorization")
    .verify(
        &binding,
        first_key.verifying_key().as_bytes(),
        second_key.verifying_key().as_bytes(),
    )
    .expect("verified accepted-loss authorization")
}

pub(super) fn test_initial_accepted_loss_bundle(
    record: &CloudflareTenantRootRoleShareRecordV1,
    authorization_variant: u8,
    canary_seed: u8,
) -> VerifiedTenantRootInitialCreationActivationEvidenceBundleV1 {
    let (target_commitments, scalar_a, scalar_b, context) = test_activation_target(record);
    let evidence_a = test_signed_installation_evidence(
        &context,
        TwoPartyDeriverRole::DeriverA,
        scalar_a,
        scalar_b,
    );
    let evidence_b = test_signed_installation_evidence(
        &context,
        TwoPartyDeriverRole::DeriverB,
        scalar_a,
        scalar_b,
    );
    let installation_receipts = TenantRootRoleInstallationReceiptsV1::new(
        evidence_a
            .lifecycle_receipt_digest()
            .expect("Deriver A installation receipt"),
        evidence_b
            .lifecycle_receipt_digest()
            .expect("Deriver B installation receipt"),
    )
    .expect("installation receipts");
    let authorization = test_verified_accepted_loss_authorization(
        &context,
        &target_commitments,
        installation_receipts,
        authorization_variant,
    );
    let canary_ecdsa = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        &target_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
        canary_seed,
    );
    let canary_ed25519 = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        &target_commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
        canary_seed.wrapping_add(1),
    );
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_accepted_loss(
        evidence_a,
        evidence_b,
        authorization,
        canary_ecdsa,
        canary_ed25519,
        2,
        3,
    )
    .expect("initial accepted-loss activation evidence")
}

pub(super) fn test_refresh_accepted_loss_bundle(
    record: &CloudflareTenantRootRoleShareRecordV1,
    authorization_variant: u8,
    canary_seed: u8,
) -> VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1 {
    let (target_commitments, scalar_a, scalar_b, context) = test_activation_target(record);
    let evidence_a = test_signed_installation_evidence(
        &context,
        TwoPartyDeriverRole::DeriverA,
        scalar_a,
        scalar_b,
    );
    let evidence_b = test_signed_installation_evidence(
        &context,
        TwoPartyDeriverRole::DeriverB,
        scalar_a,
        scalar_b,
    );
    let installation_receipts = TenantRootRoleInstallationReceiptsV1::new(
        evidence_a
            .lifecycle_receipt_digest()
            .expect("Deriver A installation receipt"),
        evidence_b
            .lifecycle_receipt_digest()
            .expect("Deriver B installation receipt"),
    )
    .expect("installation receipts");
    let authorization = test_verified_accepted_loss_authorization(
        &context,
        &target_commitments,
        installation_receipts,
        authorization_variant,
    );
    let canary_ecdsa = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::RefreshSwap,
        record.epoch(),
        &target_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
        canary_seed,
    );
    let canary_ed25519 = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::RefreshSwap,
        record.epoch(),
        &target_commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
        canary_seed.wrapping_add(1),
    );
    VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1::from_verified_accepted_loss(
        &test_refresh_current_commitments(&target_commitments),
        evidence_a,
        evidence_b,
        authorization,
        canary_ecdsa,
        canary_ed25519,
        2,
        3,
    )
    .expect("refresh accepted-loss activation evidence")
}

pub(super) fn accepted_loss_activation_for_record(
    record: &CloudflareTenantRootRoleShareRecordV1,
    authorization_variant: u8,
    activation_seed: u8,
    activated_at_ms: u64,
) -> CloudflareTenantRootActivationV1 {
    let authority_id = TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]);
    let signing_key = SigningKey::from_bytes(&[activation_seed; 32]);
    let canary_seed = activation_seed.wrapping_add(1);
    match record.epoch() {
        TenantRootShareEpoch::INITIAL => {
            let signed = TenantRootSignedActivationReceiptV1::sign_initial_creation(
                &test_initial_accepted_loss_bundle(record, authorization_variant, canary_seed),
                activated_at_ms,
                authority_id,
                "test-accepted-loss-activation-issuer-v1",
                signing_key.as_bytes(),
            )
            .expect("signed initial accepted-loss activation");
            let verified = signed
                .verify_initial_creation(
                    &test_initial_accepted_loss_bundle(
                        record,
                        authorization_variant,
                        canary_seed,
                    ),
                    activated_at_ms,
                    authority_id,
                    "test-accepted-loss-activation-issuer-v1",
                    signing_key.verifying_key().as_bytes(),
                )
                .expect("verified initial accepted-loss activation");
            CloudflareTenantRootActivationV1::with_accepted_permanent_derivation_loss(
                record, verified,
            )
            .expect("accepted-loss activation")
        }
        _ => {
            let signed = TenantRootSignedActivationReceiptV1::sign_refresh_swap(
                &test_refresh_accepted_loss_bundle(record, authorization_variant, canary_seed),
                activated_at_ms,
                authority_id,
                "test-accepted-loss-activation-issuer-v1",
                signing_key.as_bytes(),
            )
            .expect("signed refresh accepted-loss activation");
            let verified = signed
                .verify_refresh_swap(
                    &test_refresh_accepted_loss_bundle(
                        record,
                        authorization_variant,
                        canary_seed,
                    ),
                    activated_at_ms,
                    authority_id,
                    "test-accepted-loss-activation-issuer-v1",
                    signing_key.verifying_key().as_bytes(),
                )
                .expect("verified refresh accepted-loss activation");
            CloudflareTenantRootActivationV1::with_accepted_permanent_derivation_loss(
                record, verified,
            )
            .expect("accepted-loss activation")
        }
    }
}

pub(super) fn current_backup_activation_for_record(
    record: &CloudflareTenantRootRoleShareRecordV1,
    backup_seed: u8,
    activation_seed: u8,
    activated_at_ms: u64,
) -> CloudflareTenantRootActivationV1 {
    let (_target_commitments, scalar_a, scalar_b, context) = test_activation_target(record);
    let evidence_a = test_signed_installation_evidence(
        &context,
        TwoPartyDeriverRole::DeriverA,
        scalar_a,
        scalar_b,
    );
    let evidence_b = test_signed_installation_evidence(
        &context,
        TwoPartyDeriverRole::DeriverB,
        scalar_a,
        scalar_b,
    );
    let verified_backup = match record.role() {
        CloudflareTenantRootDeriverRoleV1::DeriverA => test_verified_managed_backup(
            &context,
            TwoPartyDeriverRole::DeriverA,
            scalar_a,
            backup_seed,
            &evidence_a,
        ),
        CloudflareTenantRootDeriverRoleV1::DeriverB => test_verified_managed_backup(
            &context,
            TwoPartyDeriverRole::DeriverB,
            scalar_b,
            backup_seed.wrapping_add(1),
            &evidence_b,
        ),
    };
    let signing_key = SigningKey::from_bytes(&[activation_seed; 32]);
    let authority_id = TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]);
    match record.epoch() {
        TenantRootShareEpoch::INITIAL => {
            let signed = TenantRootSignedActivationReceiptV1::sign_initial_creation(
                &test_initial_activation_bundle(
                    record,
                    backup_seed,
                    activation_seed.wrapping_add(1),
                ),
                activated_at_ms,
                authority_id,
                "test-activation-issuer-v1",
                signing_key.as_bytes(),
            )
            .expect("signed initial activation");
            let verified = signed
                .verify_initial_creation(
                    &test_initial_activation_bundle(
                        record,
                        backup_seed,
                        activation_seed.wrapping_add(1),
                    ),
                    activated_at_ms,
                    authority_id,
                    "test-activation-issuer-v1",
                    signing_key.verifying_key().as_bytes(),
                )
                .expect("verified initial activation");
            CloudflareTenantRootActivationV1::with_current_role_backup(
                record,
                &verified_backup,
                verified,
            )
            .expect("activation")
        }
        _ => {
            let signed = TenantRootSignedActivationReceiptV1::sign_refresh_swap(
                &test_refresh_activation_bundle(
                    record,
                    backup_seed,
                    activation_seed.wrapping_add(1),
                ),
                activated_at_ms,
                authority_id,
                "test-activation-issuer-v1",
                signing_key.as_bytes(),
            )
            .expect("signed refresh activation");
            let verified = signed
                .verify_refresh_swap(
                    &test_refresh_activation_bundle(
                        record,
                        backup_seed,
                        activation_seed.wrapping_add(1),
                    ),
                    activated_at_ms,
                    authority_id,
                    "test-activation-issuer-v1",
                    signing_key.verifying_key().as_bytes(),
                )
                .expect("verified refresh activation");
            CloudflareTenantRootActivationV1::with_current_role_backup(
                record,
                &verified_backup,
                verified,
            )
            .expect("activation")
        }
    }
}

/// Builds one role's public active resolution the way `load_active` does.
pub(super) fn active_role_share(
    role: CloudflareTenantRootDeriverRoleV1,
    lineage_seed: u8,
    epoch: TenantRootShareEpoch,
    share_commitment: MpcPrfShareCommitmentWireV1,
) -> CloudflareTenantRootActiveRoleShareV1 {
    active_role_share_for_identity(test_identity(), role, lineage_seed, epoch, share_commitment)
}

pub(super) fn active_role_share_for_identity(
    identity: TenantRootIdentityV1,
    role: CloudflareTenantRootDeriverRoleV1,
    lineage_seed: u8,
    epoch: TenantRootShareEpoch,
    share_commitment: MpcPrfShareCommitmentWireV1,
) -> CloudflareTenantRootActiveRoleShareV1 {
    let record =
        record_for_identity_epoch(identity, role, lineage_seed, epoch, share_commitment);
    let activation = current_backup_activation_for_record(&record, 0x88, 0x89, 20);
    let record = record.into_active(activation, 20).expect("active record");
    CloudflareTenantRootActiveRoleShareV1::Active(Box::new(
        CloudflareStoredTenantRootRoleShareV1 {
            record,
            revision: 1,
        },
    ))
}

pub(super) fn direct_active_role_resolution(
    role: TenantRootManagedRestoreRoleV1,
    lineage_seed: u8,
    epoch: TenantRootShareEpoch,
    share_commitment: MpcPrfShareCommitmentWireV1,
    activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
) -> TenantRootActiveRoleResolutionV1 {
    let identity_digest = test_identity().digest().expect("identity digest");
    let custody_lineage =
        TenantRootCustodyLineageId::from_bytes([lineage_seed; 16]).expect("lineage");
    TenantRootActiveRoleResolutionV1::Active(
        TenantRootActiveRoleBindingV1::new(
            TenantRootActiveRoleRowKeyV1::new(identity_digest, custody_lineage, epoch, role),
            share_commitment,
            activation_receipt_digest,
        )
        .expect("active role binding"),
    )
}

/// Commits to one fixed role-local share, as a real installation would.
pub(super) fn pair_commitment(
    role: CloudflareTenantRootDeriverRoleV1,
    scalar: u64,
) -> MpcPrfShareCommitmentWireV1 {
    let deriver = match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        CloudflareTenantRootDeriverRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    };
    let share = SigningRootShare::from_canonical_bytes(
        deriver.share_id(),
        Scalar::from(scalar).to_bytes(),
    )
    .expect("share");
    MpcPrfShareCommitmentWireV1::new(
        SigningRootShareCommitment::from_share(&share)
            .to_bytes()
            .to_vec(),
    )
    .expect("commitment")
}

pub(super) fn deriver_a_share(
    lineage_seed: u8,
    epoch: TenantRootShareEpoch,
) -> CloudflareTenantRootActiveRoleShareV1 {
    active_role_share(
        CloudflareTenantRootDeriverRoleV1::DeriverA,
        lineage_seed,
        epoch,
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17),
    )
}

pub(super) fn deriver_b_share(
    lineage_seed: u8,
    epoch: TenantRootShareEpoch,
) -> CloudflareTenantRootActiveRoleShareV1 {
    active_role_share(
        CloudflareTenantRootDeriverRoleV1::DeriverB,
        lineage_seed,
        epoch,
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 29),
    )
}

pub(super) fn epoch(value: u64) -> TenantRootShareEpoch {
    TenantRootShareEpoch::new(value).expect("epoch")
}

pub(super) fn test_active_refresh_state() -> router_ab_core::TenantRootActiveRefreshV1 {
    let identity = test_identity();
    let custody_lineage = TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage");
    let context =
        test_context_for_record(&identity, custody_lineage, TenantRootShareEpoch::INITIAL);
    let evidence_a_wire =
        test_signed_installation_evidence(&context, TwoPartyDeriverRole::DeriverA, 17, 29);
    let evidence_b_wire =
        test_signed_installation_evidence(&context, TwoPartyDeriverRole::DeriverB, 17, 29);
    let target_commitments = TenantRootEpochCommitmentsV1::new(
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17),
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 29),
    )
    .expect("target commitments");
    let backup_a = test_verified_managed_backup(
        &context,
        TwoPartyDeriverRole::DeriverA,
        17,
        0x88,
        &evidence_a_wire,
    );
    let backup_b = test_verified_managed_backup(
        &context,
        TwoPartyDeriverRole::DeriverB,
        29,
        0x89,
        &evidence_b_wire,
    );
    let canary_ecdsa = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        &target_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
        0x8a,
    );
    let canary_ed25519 = test_verified_provider_canary(
        &context,
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        &target_commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
        0x8b,
    );
    let installation_receipts = TenantRootRoleInstallationReceiptsV1::new(
        evidence_a_wire
            .lifecycle_receipt_digest()
            .expect("installation receipt"),
        evidence_b_wire
            .lifecycle_receipt_digest()
            .expect("installation receipt"),
    )
    .expect("installation receipts");
    let backup_receipts = TenantRootRoleBackupReceiptsV1::new(
        backup_a.receipt_digest(),
        backup_b.receipt_digest(),
    )
    .expect("backup receipts");
    let canary_receipts = TenantRootCanaryReceiptsV1::new(
        TenantRootLifecycleReceiptDigestV1::from_bytes(*canary_ecdsa.digest().as_bytes())
            .expect("canary receipt"),
        TenantRootLifecycleReceiptDigestV1::from_bytes(*canary_ed25519.digest().as_bytes())
            .expect("canary receipt"),
    )
    .expect("canary receipts");
    let verified_creation = TenantRootEmptyCreationV1::new(identity, custody_lineage)
        .start(&context)
        .expect("start ceremony")
        .verify(
            evidence_a_wire.evidence(),
            evidence_b_wire.evidence(),
            installation_receipts,
            TenantRootBackupPolicyV1::CurrentRoleBackups(backup_receipts),
            canary_receipts,
            20,
        )
        .expect("verify ceremony");
    let activation_key = SigningKey::from_bytes(&[0x89; 32]);
    let activation = TenantRootSignedActivationReceiptV1::sign_initial_creation(
        &VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_managed_backups(
            evidence_a_wire,
            evidence_b_wire,
            backup_a,
            backup_b,
            canary_ecdsa,
            canary_ed25519,
            2,
            3,
        )
        .expect("activation evidence"),
        20,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]),
        "test-activation-issuer-v1",
        activation_key.as_bytes(),
    )
    .expect("signed activation")
    .verify_initial_creation(
        &test_initial_activation_bundle(
            &record_for_identity_epoch(
                test_identity(),
                CloudflareTenantRootDeriverRoleV1::DeriverA,
                0x44,
                TenantRootShareEpoch::INITIAL,
                pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17),
            ),
            0x88,
            0x8a,
        ),
        20,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x48; 32]),
        "test-activation-issuer-v1",
        activation_key.verifying_key().as_bytes(),
    )
    .expect("verified activation");
    let active = verified_creation
        .activate(activation)
        .expect("activate ceremony")
        .into_refresh_state();
    active
}

pub(super) fn test_custody_binding() -> TenantRootCustodyBindingV1 {
    let active = test_active_refresh_state();
    let stable_context = StableTenantDerivationContextV2::new([0x85; 32]);
    TenantRootCustodyBindingV1::from_active(
        &active,
        TenantRootDeriverIdentitiesV1::new("deriver-a-runtime-7", "deriver-b-runtime-9")
            .expect("Deriver identities"),
        TenantRootDerivationOperationIdV1::from_bytes([0x81; 16]).expect("operation id"),
        TenantRootDerivationSessionIdV1::from_bytes([0x82; 16]).expect("session id"),
        TenantRootDerivationNonceV1::from_bytes([0x83; 32]).expect("derivation nonce"),
        40,
        70,
        &stable_context,
        TenantRootProtocolDigestV1::from_bytes([0x84; 32]).expect("transcript digest"),
    )
    .expect("custody binding")
}

pub(super) fn test_initial_creation_evidence(
    context: &router_ab_core::TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
) -> VerifiedTenantRootSignedShareInstallationEvidenceWireV1 {
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
    match role {
        TwoPartyDeriverRole::DeriverA => {
            signed_installation_evidence_wire(context, role, &share_a, &share_b, 0x57, 0x67)
        }
        TwoPartyDeriverRole::DeriverB => {
            signed_installation_evidence_wire(context, role, &share_b, &share_a, 0x58, 0x68)
        }
    }
}

pub(super) fn signed_installation_evidence_wire(
    context: &router_ab_core::TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    share: &SigningRootShare,
    peer: &SigningRootShare,
    signing_seed: u8,
    proof_seed: u8,
) -> VerifiedTenantRootSignedShareInstallationEvidenceWireV1 {
    let transcript = TenantRootShareInstallationTranscriptV1::new(
        context.clone(),
        role,
        SigningRootShareCommitment::from_share(share),
        SigningRootShareCommitment::from_share(peer),
    )
    .expect("installation transcript");
    let proof = prove_root_share_knowledge(
        share,
        &transcript.canonical_bytes().expect("transcript bytes"),
        &mut ChaCha20Rng::from_seed([proof_seed; 32]),
    )
    .expect("share proof");
    let evidence = TenantRootShareInstallationEvidenceV1::new(transcript, proof)
        .expect("installation evidence");
    let signing_key = SigningKey::from_bytes(&[signing_seed; 32]);
    let signed =
        TenantRootSignedShareInstallationEvidenceV1::sign(evidence, &signing_key.to_bytes())
            .expect("signed installation evidence");
    let bytes = signed.canonical_bytes().expect("signed evidence bytes");
    TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        &bytes,
        signing_key.verifying_key().as_bytes(),
    )
    .expect("verified installation evidence wire")
}

pub(super) fn test_sealed_online_share(
    context: &router_ab_core::TenantRootCeremonyContextV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    role: TwoPartyDeriverRole,
) -> TenantRootSealedOnlineRoleShareV1 {
    let (share, commitment) = match role {
        TwoPartyDeriverRole::DeriverA => {
            let share = SigningRootShare::from_canonical_bytes(
                TwoPartyDeriverRole::DeriverA.share_id(),
                Scalar::from(17_u64).to_bytes(),
            )
            .expect("Deriver A share");
            let commitment = MpcPrfShareCommitmentWireV1::new(
                SigningRootShareCommitment::from_share(&share)
                    .to_bytes()
                    .to_vec(),
            )
            .expect("Deriver A commitment");
            (share, commitment)
        }
        TwoPartyDeriverRole::DeriverB => {
            let share = SigningRootShare::from_canonical_bytes(
                TwoPartyDeriverRole::DeriverB.share_id(),
                Scalar::from(29_u64).to_bytes(),
            )
            .expect("Deriver B share");
            let commitment = MpcPrfShareCommitmentWireV1::new(
                SigningRootShareCommitment::from_share(&share)
                    .to_bytes()
                    .to_vec(),
            )
            .expect("Deriver B commitment");
            (share, commitment)
        }
    };
    let binding = TenantRootOnlineRoleShareBindingV1::new(
        context.identity_digest(),
        context.custody_lineage(),
        role,
        match context.epochs() {
            TenantRootCeremonyEpochsV1::Create { next }
            | TenantRootCeremonyEpochsV1::Refresh { next, .. } => next,
        },
        commitment,
        "kms://deriver/tenant/epoch-1",
        evidence,
    )
    .expect("online share binding");
    TenantRootOnlineRoleShareSealRequestV1::new(
        binding,
        SigningRootShareWire::from_share(&share),
    )
    .expect("online share seal request")
    .complete(vec![0x66; 96])
    .expect("sealed online share")
}
