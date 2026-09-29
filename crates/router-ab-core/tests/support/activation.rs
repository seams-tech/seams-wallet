//! Signed fixtures for the activation evidence and activation receipt tests.
//!
//! Both files build the same ceremony, installation, backup, canary, accepted-loss
//! and restore fixtures, but each signs them with its own keys, so everything that
//! signs is a method on the file's `Signers`.

use ed25519_dalek::SigningKey;
use router_ab_core::{
    tenant_root_restore_refresh_context_nonce_v1, MpcPrfShareCommitmentWireV1,
    MpcPrfSigningRootShareWireV1, TenantRootAcceptedPermanentLossAuthorizationBindingV1,
    TenantRootActivationAvailabilityEvidenceV1, TenantRootActivationReceiptTransitionV1,
    TenantRootCanaryCurveFamilyV1, TenantRootCeremonyContextV1, TenantRootCeremonyEpochsV1,
    TenantRootCeremonyNonceV1, TenantRootCeremonySessionIdV1, TenantRootControlPlaneAuthorityIdV1,
    TenantRootCustodyLineageId, TenantRootEpochCommitmentsV1, TenantRootIdentityDigestV1,
    TenantRootLifecycleReceiptDigestV1, TenantRootManagedBackupBindingV1,
    TenantRootManagedBackupSealRequestV1, TenantRootProtocolDigestV1,
    TenantRootProviderCanaryReceiptBindingV1, TenantRootRecoverySetId,
    TenantRootRestoreDestinationFingerprintV1, TenantRootRestoreRefreshRoleCommandV1,
    TenantRootRestoreSessionIdV1, TenantRootRoleInstallationReceiptsV1, TenantRootShareEpoch,
    TenantRootShareInstallationEvidenceV1, TenantRootShareInstallationTranscriptV1,
    TenantRootSignedAcceptedPermanentLossAuthorizationV1, TenantRootSignedManagedBackupV1,
    TenantRootSignedProviderCanaryReceiptV1, TenantRootSignedShareInstallationEvidenceV1,
    TenantRootTenantHeldExternalProvenanceV1,
    VerifiedTenantRootAcceptedPermanentLossAuthorizationV1,
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1, VerifiedTenantRootManagedBackupV1,
    VerifiedTenantRootProviderCanaryReceiptV1,
    VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1,
    VerifiedTenantRootRestoreRefreshRoleCommandV1,
    VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
};
use threshold_prf::{
    prove_root_share_knowledge, SigningRootShareCommitment, SigningRootShareWire,
    TwoPartyDeriverRole,
};

use super::{fixed_share, rng06, EXPIRES_AT_MS, ISSUED_AT_MS};

pub fn identity() -> TenantRootIdentityDigestV1 {
    identity_with(0x11)
}

pub fn identity_with(value: u8) -> TenantRootIdentityDigestV1 {
    TenantRootIdentityDigestV1::from_bytes([value; 32])
}

pub fn lineage() -> TenantRootCustodyLineageId {
    TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage")
}

pub fn context(epochs: TenantRootCeremonyEpochsV1) -> TenantRootCeremonyContextV1 {
    context_with(epochs, identity(), lineage(), 0x33, 0x44)
}

pub fn context_with(
    epochs: TenantRootCeremonyEpochsV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    session_byte: u8,
    nonce_byte: u8,
) -> TenantRootCeremonyContextV1 {
    TenantRootCeremonyContextV1::new(
        identity_digest,
        custody_lineage,
        epochs,
        TenantRootCeremonySessionIdV1::from_bytes([session_byte; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([nonce_byte; 32]).expect("nonce"),
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("context")
}

pub fn refresh_epochs() -> TenantRootCeremonyEpochsV1 {
    TenantRootCeremonyEpochsV1::refresh(
        TenantRootShareEpoch::new(7).expect("current epoch"),
        TenantRootShareEpoch::new(8).expect("next epoch"),
    )
    .expect("refresh epochs")
}

pub fn role_signing_key_id(role: TwoPartyDeriverRole) -> &'static str {
    match role {
        TwoPartyDeriverRole::DeriverA => "deriver-a-signing-key-7",
        TwoPartyDeriverRole::DeriverB => "deriver-b-signing-key-9",
    }
}

pub fn commitments(a_scalar: u64, b_scalar: u64) -> TenantRootEpochCommitmentsV1 {
    TenantRootEpochCommitmentsV1::new(
        commitment(TwoPartyDeriverRole::DeriverA, a_scalar),
        commitment(TwoPartyDeriverRole::DeriverB, b_scalar),
    )
    .expect("commitments")
}

fn commitment(role: TwoPartyDeriverRole, scalar: u64) -> MpcPrfShareCommitmentWireV1 {
    MpcPrfShareCommitmentWireV1::new(
        SigningRootShareCommitment::from_share(&fixed_share(role, scalar))
            .to_bytes()
            .to_vec(),
    )
    .expect("commitment")
}

pub struct RestoreRefreshScope {
    pub destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    pub restore_session_id: TenantRootRestoreSessionIdV1,
    pub recovery_set_id: TenantRootRecoverySetId,
    pub manifest_digest: [u8; 32],
    pub deriver_a_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    pub deriver_b_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    pub commitments: TenantRootEpochCommitmentsV1,
    pub ceremony_session_id: TenantRootCeremonySessionIdV1,
}

pub fn restore_refresh_scope() -> RestoreRefreshScope {
    RestoreRefreshScope {
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1::from_bytes([0x58; 32])
            .expect("destination fingerprint"),
        restore_session_id: TenantRootRestoreSessionIdV1::from_bytes([0x59; 16])
            .expect("restore session"),
        recovery_set_id: TenantRootRecoverySetId::from_bytes([0x5a; 16]).expect("recovery set"),
        manifest_digest: [0x5b; 32],
        deriver_a_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1::from_bytes(
            [0x5c; 32],
        )
        .expect("Deriver A acceptance receipt"),
        deriver_b_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1::from_bytes(
            [0x5d; 32],
        )
        .expect("Deriver B acceptance receipt"),
        commitments: commitments(12, 19),
        ceremony_session_id: TenantRootCeremonySessionIdV1::from_bytes([0x5e; 16])
            .expect("ceremony session"),
    }
}

pub fn restore_context(scope: &RestoreRefreshScope) -> TenantRootCeremonyContextV1 {
    let ceremony_nonce = tenant_root_restore_refresh_context_nonce_v1(
        identity(),
        lineage(),
        scope.ceremony_session_id,
        scope.destination_fingerprint,
        scope.restore_session_id,
        scope.manifest_digest,
        scope.deriver_a_acceptance_receipt_digest,
        scope.deriver_b_acceptance_receipt_digest,
        scope.commitments.deriver_a(),
        scope.commitments.deriver_b(),
        *scope.commitments.root_commitment(),
    )
    .expect("restore context nonce");
    TenantRootCeremonyContextV1::new(
        identity(),
        lineage(),
        TenantRootCeremonyEpochsV1::create(),
        scope.ceremony_session_id,
        ceremony_nonce,
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("restore context")
}

/// Everything an accepted-permanent-loss authorization binds.
pub struct AcceptedLossScope<'a> {
    pub epochs: TenantRootCeremonyEpochsV1,
    pub identity_digest: TenantRootIdentityDigestV1,
    pub custody_lineage: TenantRootCustodyLineageId,
    pub context_digest: TenantRootProtocolDigestV1,
    pub commitments: &'a TenantRootEpochCommitmentsV1,
    pub installation_receipts: TenantRootRoleInstallationReceiptsV1,
    pub expected_control_plane_revision: u64,
    pub result_control_plane_revision: u64,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
}

/// The keys a test file signs its fixtures with.
pub struct Signers {
    pub deriver_a: [u8; 32],
    pub deriver_b: [u8; 32],
    pub canary: [u8; 32],
    pub loss_authorities: [[u8; 32]; 2],
    pub restore_issuer_key_id: &'static str,
    pub restore_issuer: [u8; 32],
}

impl Signers {
    fn role_key(&self, role: TwoPartyDeriverRole) -> SigningKey {
        SigningKey::from_bytes(match role {
            TwoPartyDeriverRole::DeriverA => &self.deriver_a,
            TwoPartyDeriverRole::DeriverB => &self.deriver_b,
        })
    }

    pub fn installation(
        &self,
        epochs: TenantRootCeremonyEpochsV1,
        role: TwoPartyDeriverRole,
        scalar: u64,
        peer_scalar: u64,
        proof_seed: u8,
    ) -> (
        VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        MpcPrfSigningRootShareWireV1,
    ) {
        self.installation_with_context(context(epochs), role, scalar, peer_scalar, proof_seed)
    }

    pub fn installation_with_context(
        &self,
        ceremony_context: TenantRootCeremonyContextV1,
        role: TwoPartyDeriverRole,
        scalar: u64,
        peer_scalar: u64,
        proof_seed: u8,
    ) -> (
        VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        MpcPrfSigningRootShareWireV1,
    ) {
        let signing_share = fixed_share(role, scalar);
        let peer = fixed_share(role.peer(), peer_scalar);
        let transcript = TenantRootShareInstallationTranscriptV1::new(
            ceremony_context,
            role,
            SigningRootShareCommitment::from_share(&signing_share),
            SigningRootShareCommitment::from_share(&peer),
        )
        .expect("installation transcript");
        let proof = prove_root_share_knowledge(
            &signing_share,
            &transcript.canonical_bytes().expect("transcript bytes"),
            &mut rng06(proof_seed),
        )
        .expect("knowledge proof");
        let evidence = TenantRootShareInstallationEvidenceV1::new(transcript, proof)
            .expect("installation evidence");
        let signing_key = self.role_key(role);
        let signed =
            TenantRootSignedShareInstallationEvidenceV1::sign(evidence, &signing_key.to_bytes())
                .expect("signed installation evidence");
        let bytes = signed.canonical_bytes().expect("installation bytes");
        let verified =
            TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
                &bytes,
                signing_key.verifying_key().as_bytes(),
            )
            .expect("verified installation evidence");
        let share_wire = MpcPrfSigningRootShareWireV1::new(
            SigningRootShareWire::from_share(&signing_share)
                .to_bytes()
                .to_vec(),
        )
        .expect("share wire");
        (verified, share_wire)
    }

    pub fn managed_backup(
        &self,
        installation: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        share: &MpcPrfSigningRootShareWireV1,
        role: TwoPartyDeriverRole,
        backup_provider_id: &str,
        backup_key_version: &str,
        role_signing_key_id: &str,
    ) -> VerifiedTenantRootManagedBackupV1 {
        let binding = TenantRootManagedBackupBindingV1::from_verified_installation_evidence(
            installation,
            backup_provider_id,
            backup_key_version,
            role_signing_key_id,
            ISSUED_AT_MS,
        )
        .expect("backup binding");
        let request = TenantRootManagedBackupSealRequestV1::new(binding.clone(), share.clone())
            .expect("backup seal request");
        let signing_key = self.role_key(role);
        let signed =
            TenantRootSignedManagedBackupV1::sign(request, vec![0xa5; 96], &signing_key.to_bytes())
                .expect("signed backup");
        signed
            .verify(&binding, signing_key.verifying_key().as_bytes())
            .expect("verified backup")
    }

    pub fn canary(
        &self,
        epochs: TenantRootCeremonyEpochsV1,
        commitments: &TenantRootEpochCommitmentsV1,
        family: TenantRootCanaryCurveFamilyV1,
    ) -> VerifiedTenantRootProviderCanaryReceiptV1 {
        self.canary_with_scope(epochs, commitments, family, identity(), lineage())
    }

    pub fn canary_with_scope(
        &self,
        epochs: TenantRootCeremonyEpochsV1,
        commitments: &TenantRootEpochCommitmentsV1,
        family: TenantRootCanaryCurveFamilyV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> VerifiedTenantRootProviderCanaryReceiptV1 {
        let (transition, target_epoch) = transition_and_target_epoch(epochs);
        let binding = TenantRootProviderCanaryReceiptBindingV1::new(
            identity_digest,
            custody_lineage,
            transition,
            target_epoch,
            commitments.clone(),
            family,
            "kms/tenant-11/epoch",
            ISSUED_AT_MS + 10,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
            "control-plane-canary-v1",
            ISSUED_AT_MS,
            EXPIRES_AT_MS,
        )
        .expect("canary binding");
        let signed = TenantRootSignedProviderCanaryReceiptV1::sign(binding.clone(), &self.canary)
            .expect("signed canary");
        signed
            .verify(
                &binding,
                &SigningKey::from_bytes(&self.canary)
                    .verifying_key()
                    .to_bytes(),
            )
            .expect("verified canary")
    }

    pub fn accepted_loss(
        &self,
        scope: AcceptedLossScope,
    ) -> VerifiedTenantRootAcceptedPermanentLossAuthorizationV1 {
        let (transition, target_epoch) = transition_and_target_epoch(scope.epochs);
        let binding = TenantRootAcceptedPermanentLossAuthorizationBindingV1::new(
            scope.identity_digest,
            scope.custody_lineage,
            transition,
            target_epoch,
            scope.context_digest,
            scope.commitments.clone(),
            scope.installation_receipts,
            scope.expected_control_plane_revision,
            scope.result_control_plane_revision,
            "policy-accept-loss-001",
            "incident-2026-0001",
            "both managed backups are unavailable",
            scope.issued_at_ms,
            scope.expires_at_ms,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
            "operator-a-v1",
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x72; 32]),
            "operator-b-v1",
        )
        .expect("accepted-loss binding");
        let [first_authority, second_authority] = &self.loss_authorities;
        let signed = TenantRootSignedAcceptedPermanentLossAuthorizationV1::sign(
            binding.clone(),
            first_authority,
            second_authority,
        )
        .expect("signed accepted-loss authorization");
        signed
            .verify(
                &binding,
                &SigningKey::from_bytes(first_authority)
                    .verifying_key()
                    .to_bytes(),
                &SigningKey::from_bytes(second_authority)
                    .verifying_key()
                    .to_bytes(),
            )
            .expect("verified accepted-loss authorization")
    }

    pub fn restore_command(
        &self,
        scope: &RestoreRefreshScope,
        context: &TenantRootCeremonyContextV1,
        role: TwoPartyDeriverRole,
    ) -> VerifiedTenantRootRestoreRefreshRoleCommandV1 {
        let signed = TenantRootRestoreRefreshRoleCommandV1::sign(
            context,
            scope.destination_fingerprint,
            scope.restore_session_id,
            scope.manifest_digest,
            scope.deriver_a_acceptance_receipt_digest,
            scope.deriver_b_acceptance_receipt_digest,
            scope.commitments.deriver_a().clone(),
            scope.commitments.deriver_b().clone(),
            *scope.commitments.root_commitment(),
            role,
            self.restore_issuer_key_id,
            &self.restore_issuer,
        )
        .expect("signed restore refresh command");
        let bytes = signed.canonical_bytes().expect("restore command bytes");
        let issuer = SigningKey::from_bytes(&self.restore_issuer);
        TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&bytes)
            .expect("decoded restore refresh command")
            .verify(
                self.restore_issuer_key_id,
                issuer.verifying_key().as_bytes(),
            )
            .expect("verified restore refresh command")
    }

    /// Initial activation evidence for a tenant-held external restore: both roles
    /// install under the restore context and the restore stands in for backups.
    pub fn tenant_held_external_initial_bundle(
        &self,
        scope: &RestoreRefreshScope,
        restore_context: &TenantRootCeremonyContextV1,
        command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
    ) -> VerifiedTenantRootInitialCreationActivationEvidenceBundleV1 {
        let (installation_a, _) = self.installation_with_context(
            restore_context.clone(),
            TwoPartyDeriverRole::DeriverA,
            12,
            19,
            0xa1,
        );
        let (installation_b, _) = self.installation_with_context(
            restore_context.clone(),
            TwoPartyDeriverRole::DeriverB,
            19,
            12,
            0xb1,
        );
        VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::new(
            installation_a,
            installation_b,
            TenantRootActivationAvailabilityEvidenceV1::from_verified_restore(
                command,
                scope.recovery_set_id,
            )
            .expect("tenant-held external availability"),
            self.canary(
                TenantRootCeremonyEpochsV1::create(),
                &scope.commitments,
                TenantRootCanaryCurveFamilyV1::Ecdsa,
            ),
            self.canary(
                TenantRootCeremonyEpochsV1::create(),
                &scope.commitments,
                TenantRootCanaryCurveFamilyV1::Ed25519,
            ),
            2,
            3,
        )
        .expect("tenant-held external initial activation evidence")
    }

    /// Refresh activation evidence that carries a restore's provenance forward.
    pub fn tenant_held_external_refresh_bundle(
        &self,
        scope: &RestoreRefreshScope,
        provenance: &TenantRootTenantHeldExternalProvenanceV1,
    ) -> VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1 {
        let epochs = refresh_epochs();
        let next_commitments = commitments(19, 33);
        let (installation_a, _) =
            self.installation(epochs, TwoPartyDeriverRole::DeriverA, 19, 33, 0xc1);
        let (installation_b, _) =
            self.installation(epochs, TwoPartyDeriverRole::DeriverB, 33, 19, 0xd1);
        VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1::new(
            &scope.commitments,
            installation_a,
            installation_b,
            TenantRootActivationAvailabilityEvidenceV1::from_verified_external_provenance(
                provenance.clone(),
            ),
            self.canary(
                epochs,
                &next_commitments,
                TenantRootCanaryCurveFamilyV1::Ecdsa,
            ),
            self.canary(
                epochs,
                &next_commitments,
                TenantRootCanaryCurveFamilyV1::Ed25519,
            ),
            5,
            6,
        )
        .expect("tenant-held external refresh activation evidence")
    }
}

fn transition_and_target_epoch(
    epochs: TenantRootCeremonyEpochsV1,
) -> (
    TenantRootActivationReceiptTransitionV1,
    TenantRootShareEpoch,
) {
    match epochs {
        TenantRootCeremonyEpochsV1::Create { next } => (
            TenantRootActivationReceiptTransitionV1::InitialCreation,
            next,
        ),
        TenantRootCeremonyEpochsV1::Refresh { next, .. } => {
            (TenantRootActivationReceiptTransitionV1::RefreshSwap, next)
        }
    }
}
