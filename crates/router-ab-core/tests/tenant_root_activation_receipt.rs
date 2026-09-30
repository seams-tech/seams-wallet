use ed25519_dalek::SigningKey;
use router_ab_core::{
    MpcPrfSigningRootShareWireV1, RouterAbDerivationErrorCode,
    TenantRootActivationReceiptAvailabilityV1, TenantRootActivationReceiptTransitionV1,
    TenantRootCanaryCurveFamilyV1, TenantRootCeremonyEpochsV1, TenantRootControlPlaneAuthorityIdV1,
    TenantRootCustodyLineageId, TenantRootIdentityDigestV1, TenantRootRoleInstallationReceiptsV1,
    TenantRootShareEpoch, TenantRootSignedActivationReceiptV1,
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
    VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1,
    TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1,
    TENANT_ROOT_INITIAL_CREATION_ACTIVATION_EXPECTED_REVISION_V1,
    TENANT_ROOT_INITIAL_CREATION_ACTIVATION_RESULT_REVISION_V1,
};
use sha2::{Digest, Sha256};
use threshold_prf::TwoPartyDeriverRole;

mod support;

use support::activation::{
    commitments, context_with, identity, identity_with, lineage, restore_context,
    restore_refresh_scope, role_signing_key_id, AcceptedLossScope, Signers,
};
use support::{EXPIRES_AT_MS, ISSUED_AT_MS};

const ISSUER_KEY_BYTES: [u8; 32] = [0x41; 32];
const ISSUER_KEY_ID: &str = "control-plane-issuer-v1";
const ACTIVATION_TIME_MS: u64 = 1_000_010;
const SIGNERS: Signers = Signers {
    deriver_a: [0x71; 32],
    deriver_b: [0x72; 32],
    canary: [0x51; 32],
    loss_authorities: [[0x61; 32], [0x62; 32]],
    restore_issuer_key_id: ISSUER_KEY_ID,
    restore_issuer: ISSUER_KEY_BYTES,
};

fn managed_backup(
    installation: &router_ab_core::VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    share: &MpcPrfSigningRootShareWireV1,
    role: TwoPartyDeriverRole,
) -> router_ab_core::VerifiedTenantRootManagedBackupV1 {
    let key_id = role_signing_key_id(role);
    SIGNERS.managed_backup(
        installation,
        share,
        role,
        &format!("backup-provider-{key_id}"),
        &format!("kms/{key_id}/epoch"),
        key_id,
    )
}

fn creation_bundle(
    accepted_loss_branch: bool,
) -> VerifiedTenantRootInitialCreationActivationEvidenceBundleV1 {
    creation_bundle_with_scope(
        accepted_loss_branch,
        identity(),
        lineage(),
        0x33,
        0x44,
        0x51,
        0x61,
    )
}

fn creation_bundle_with_revisions(
    expected_control_plane_revision: u64,
    result_control_plane_revision: u64,
) -> VerifiedTenantRootInitialCreationActivationEvidenceBundleV1 {
    creation_bundle_with_scope_and_commitments(
        false,
        identity(),
        lineage(),
        0x33,
        0x44,
        0x51,
        0x61,
        12,
        19,
        expected_control_plane_revision,
        result_control_plane_revision,
    )
}

fn creation_bundle_with_scope(
    accepted_loss_branch: bool,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    session_byte: u8,
    nonce_byte: u8,
    deriver_a_proof_seed: u8,
    deriver_b_proof_seed: u8,
) -> VerifiedTenantRootInitialCreationActivationEvidenceBundleV1 {
    creation_bundle_with_scope_and_commitments(
        accepted_loss_branch,
        identity_digest,
        custody_lineage,
        session_byte,
        nonce_byte,
        deriver_a_proof_seed,
        deriver_b_proof_seed,
        12,
        19,
        TENANT_ROOT_INITIAL_CREATION_ACTIVATION_EXPECTED_REVISION_V1,
        TENANT_ROOT_INITIAL_CREATION_ACTIVATION_RESULT_REVISION_V1,
    )
}

fn creation_bundle_with_scope_and_commitments(
    accepted_loss_branch: bool,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    session_byte: u8,
    nonce_byte: u8,
    deriver_a_proof_seed: u8,
    deriver_b_proof_seed: u8,
    deriver_a_scalar: u64,
    deriver_b_scalar: u64,
    expected_control_plane_revision: u64,
    result_control_plane_revision: u64,
) -> VerifiedTenantRootInitialCreationActivationEvidenceBundleV1 {
    let epochs = TenantRootCeremonyEpochsV1::create();
    let expected_commitments = commitments(deriver_a_scalar, deriver_b_scalar);
    let ceremony_context = context_with(
        epochs,
        identity_digest,
        custody_lineage,
        session_byte,
        nonce_byte,
    );
    let (installation_a, share_a) = SIGNERS.installation_with_context(
        ceremony_context.clone(),
        TwoPartyDeriverRole::DeriverA,
        deriver_a_scalar,
        deriver_b_scalar,
        deriver_a_proof_seed,
    );
    let (installation_b, share_b) = SIGNERS.installation_with_context(
        ceremony_context,
        TwoPartyDeriverRole::DeriverB,
        deriver_b_scalar,
        deriver_a_scalar,
        deriver_b_proof_seed,
    );
    let installation_receipts = TenantRootRoleInstallationReceiptsV1::new(
        installation_a
            .lifecycle_receipt_digest()
            .expect("deriver A installation receipt"),
        installation_b
            .lifecycle_receipt_digest()
            .expect("deriver B installation receipt"),
    )
    .expect("installation receipts");
    let context_digest = installation_a
        .evidence()
        .transcript()
        .context()
        .digest()
        .expect("context digest");
    let backup_a = managed_backup(&installation_a, &share_a, TwoPartyDeriverRole::DeriverA);
    let backup_b = managed_backup(&installation_b, &share_b, TwoPartyDeriverRole::DeriverB);
    let ecdsa = SIGNERS.canary_with_scope(
        epochs,
        &expected_commitments,
        TenantRootCanaryCurveFamilyV1::Ecdsa,
        identity_digest,
        custody_lineage,
    );
    let ed25519 = SIGNERS.canary_with_scope(
        epochs,
        &expected_commitments,
        TenantRootCanaryCurveFamilyV1::Ed25519,
        identity_digest,
        custody_lineage,
    );
    if accepted_loss_branch {
        VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_accepted_loss(
            installation_a,
            installation_b,
            SIGNERS.accepted_loss(AcceptedLossScope {
                epochs,
                identity_digest,
                custody_lineage,
                context_digest,
                commitments: &expected_commitments,
                installation_receipts,
                expected_control_plane_revision,
                result_control_plane_revision,
                issued_at_ms: ISSUED_AT_MS,
                expires_at_ms: EXPIRES_AT_MS,
            }),
            ecdsa,
            ed25519,
            expected_control_plane_revision,
            result_control_plane_revision,
        )
        .expect("initial accepted-loss evidence bundle")
    } else {
        VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_managed_backups(
            installation_a,
            installation_b,
            backup_a,
            backup_b,
            ecdsa,
            ed25519,
            expected_control_plane_revision,
            result_control_plane_revision,
        )
        .expect("initial managed-backup evidence bundle")
    }
}

fn creation_bundle_with_shared_backup_key_version() -> router_ab_core::RouterAbDerivationResult<
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
> {
    creation_bundle_with_backup_fields(
        "backup-provider-a",
        "backup-provider-b",
        "kms/shared-version",
        "kms/shared-version",
        role_signing_key_id(TwoPartyDeriverRole::DeriverA),
        role_signing_key_id(TwoPartyDeriverRole::DeriverB),
    )
}

fn creation_bundle_with_shared_backup_provider() -> router_ab_core::RouterAbDerivationResult<
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
> {
    creation_bundle_with_backup_fields(
        "backup-provider-shared",
        "backup-provider-shared",
        "kms/deriver-a-epoch",
        "kms/deriver-b-epoch",
        role_signing_key_id(TwoPartyDeriverRole::DeriverA),
        role_signing_key_id(TwoPartyDeriverRole::DeriverB),
    )
}

fn creation_bundle_with_shared_backup_authority() -> router_ab_core::RouterAbDerivationResult<
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
> {
    creation_bundle_with_backup_fields(
        "backup-provider-a",
        "backup-provider-b",
        "kms/deriver-a-epoch",
        "kms/deriver-b-epoch",
        "shared-role-signing-key",
        "shared-role-signing-key",
    )
}

fn creation_bundle_with_backup_fields(
    backup_provider_a: &str,
    backup_provider_b: &str,
    backup_key_version_a: &str,
    backup_key_version_b: &str,
    role_signing_key_id_a: &str,
    role_signing_key_id_b: &str,
) -> router_ab_core::RouterAbDerivationResult<
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
> {
    let epochs = TenantRootCeremonyEpochsV1::create();
    let expected_commitments = commitments(12, 19);
    let (installation_a, share_a) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverA, 12, 19, 0x51);
    let (installation_b, share_b) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverB, 19, 12, 0x61);
    let backup_a = SIGNERS.managed_backup(
        &installation_a,
        &share_a,
        TwoPartyDeriverRole::DeriverA,
        backup_provider_a,
        backup_key_version_a,
        role_signing_key_id_a,
    );
    let backup_b = SIGNERS.managed_backup(
        &installation_b,
        &share_b,
        TwoPartyDeriverRole::DeriverB,
        backup_provider_b,
        backup_key_version_b,
        role_signing_key_id_b,
    );
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1::from_verified_managed_backups(
        installation_a,
        installation_b,
        backup_a,
        backup_b,
        SIGNERS.canary(
            epochs,
            &expected_commitments,
            TenantRootCanaryCurveFamilyV1::Ecdsa,
        ),
        SIGNERS.canary(
            epochs,
            &expected_commitments,
            TenantRootCanaryCurveFamilyV1::Ed25519,
        ),
        TENANT_ROOT_INITIAL_CREATION_ACTIVATION_EXPECTED_REVISION_V1,
        TENANT_ROOT_INITIAL_CREATION_ACTIVATION_RESULT_REVISION_V1,
    )
}

fn refresh_bundle(
    accepted_loss_branch: bool,
) -> VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1 {
    refresh_bundle_with_revisions(accepted_loss_branch, 5, 6).expect("refresh evidence bundle")
}

fn refresh_bundle_with_revisions(
    accepted_loss_branch: bool,
    expected_control_plane_revision: u64,
    result_control_plane_revision: u64,
) -> router_ab_core::RouterAbDerivationResult<VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1>
{
    let current = commitments(12, 19);
    let epochs = TenantRootCeremonyEpochsV1::refresh(
        TenantRootShareEpoch::new(7).expect("current epoch"),
        TenantRootShareEpoch::new(8).expect("next epoch"),
    )
    .expect("refresh epochs");
    let next = commitments(19, 33);
    let (installation_a, share_a) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverA, 19, 33, 0x71);
    let (installation_b, share_b) =
        SIGNERS.installation(epochs, TwoPartyDeriverRole::DeriverB, 33, 19, 0x81);
    let installation_receipts = TenantRootRoleInstallationReceiptsV1::new(
        installation_a
            .lifecycle_receipt_digest()
            .expect("deriver A installation receipt"),
        installation_b
            .lifecycle_receipt_digest()
            .expect("deriver B installation receipt"),
    )
    .expect("installation receipts");
    let context_digest = installation_a
        .evidence()
        .transcript()
        .context()
        .digest()
        .expect("context digest");
    let ecdsa = SIGNERS.canary(epochs, &next, TenantRootCanaryCurveFamilyV1::Ecdsa);
    let ed25519 = SIGNERS.canary(epochs, &next, TenantRootCanaryCurveFamilyV1::Ed25519);
    if accepted_loss_branch {
        VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1::from_verified_accepted_loss(
            &current,
            installation_a,
            installation_b,
            SIGNERS.accepted_loss(AcceptedLossScope {
                epochs,
                identity_digest: identity(),
                custody_lineage: lineage(),
                context_digest,
                commitments: &next,
                installation_receipts,
                expected_control_plane_revision,
                result_control_plane_revision,
                issued_at_ms: ISSUED_AT_MS,
                expires_at_ms: EXPIRES_AT_MS,
            }),
            ecdsa,
            ed25519,
            expected_control_plane_revision,
            result_control_plane_revision,
        )
    } else {
        let backup_a = managed_backup(&installation_a, &share_a, TwoPartyDeriverRole::DeriverA);
        let backup_b = managed_backup(&installation_b, &share_b, TwoPartyDeriverRole::DeriverB);
        VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1::from_verified_managed_backups(
            &current,
            installation_a,
            installation_b,
            backup_a,
            backup_b,
            ecdsa,
            ed25519,
            expected_control_plane_revision,
            result_control_plane_revision,
        )
    }
}

fn verifying_key_bytes() -> [u8; 32] {
    SigningKey::from_bytes(&ISSUER_KEY_BYTES)
        .verifying_key()
        .to_bytes()
}

fn sign_creation(
    bundle: &VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
) -> TenantRootSignedActivationReceiptV1 {
    TenantRootSignedActivationReceiptV1::sign_initial_creation(
        bundle,
        ACTIVATION_TIME_MS,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
        ISSUER_KEY_ID,
        &ISSUER_KEY_BYTES,
    )
    .expect("signed initial activation receipt")
}

fn sign_refresh(
    bundle: &VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1,
) -> TenantRootSignedActivationReceiptV1 {
    TenantRootSignedActivationReceiptV1::sign_refresh_swap(
        bundle,
        ACTIVATION_TIME_MS,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
        ISSUER_KEY_ID,
        &ISSUER_KEY_BYTES,
    )
    .expect("signed refresh activation receipt")
}

fn verify_creation(
    receipt: TenantRootSignedActivationReceiptV1,
    bundle: &VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
    activated_at_ms: u64,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    issuer_key_id: &str,
) -> router_ab_core::RouterAbDerivationResult<
    router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
> {
    receipt.verify_initial_creation(
        bundle,
        activated_at_ms,
        authority_id,
        issuer_key_id,
        &verifying_key_bytes(),
    )
}

fn verify_refresh(
    receipt: TenantRootSignedActivationReceiptV1,
    bundle: &VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1,
    activated_at_ms: u64,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    issuer_key_id: &str,
) -> router_ab_core::RouterAbDerivationResult<
    router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
> {
    receipt.verify_refresh_swap(
        bundle,
        activated_at_ms,
        authority_id,
        issuer_key_id,
        &verifying_key_bytes(),
    )
}

fn read_field(bytes: &[u8], offset: usize) -> (usize, usize, usize) {
    let length_end = offset + 4;
    let length =
        u32::from_be_bytes(bytes[offset..length_end].try_into().expect("field length")) as usize;
    let value_start = length_end;
    let value_end = value_start + length;
    (value_start, value_end, value_end)
}

fn replace_accepted_loss_authorization_byte(bytes: &[u8]) -> Vec<u8> {
    let mut replaced = bytes.to_vec();
    let mut offset = 0;
    let mut found = false;
    for _ in 0..32 {
        let (value_start, value_end, next_offset) = read_field(&replaced, offset);
        if &replaced[value_start..value_end] == b"accepted_permanent_derivation_loss" {
            let (authorization_start, authorization_end, _) = read_field(&replaced, next_offset);
            replaced[authorization_end - 1] ^= 1;
            let digest = Sha256::digest(&replaced[authorization_start..authorization_end]);
            let (digest_start, digest_end, _) = read_field(&replaced, authorization_end);
            assert_eq!(digest_end - digest_start, 32);
            replaced[digest_start..digest_end].copy_from_slice(&digest);
            found = true;
            break;
        }
        offset = next_offset;
    }
    assert!(found, "accepted-loss branch must be present");
    replaced
}

#[test]
fn initial_creation_receipt_is_bundle_bound_and_canonical() {
    let bundle = creation_bundle(false);
    let receipt = sign_creation(&bundle);
    let bytes = receipt.canonical_bytes().expect("canonical receipt");
    assert!(bytes.len() < TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1);
    assert!(bytes
        .windows(b"current_role_backups".len())
        .any(|window| window == b"current_role_backups"));
    let decoded = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&bytes)
        .expect("decode canonical receipt");
    assert_eq!(decoded, receipt);
    assert_eq!(
        decoded.transition(),
        TenantRootActivationReceiptTransitionV1::InitialCreation
    );
    assert_eq!(
        decoded.expected_control_plane_revision(),
        TENANT_ROOT_INITIAL_CREATION_ACTIVATION_EXPECTED_REVISION_V1
    );
    assert_eq!(
        decoded.result_control_plane_revision(),
        TENANT_ROOT_INITIAL_CREATION_ACTIVATION_RESULT_REVISION_V1
    );
    assert_eq!(decoded.issued_at_ms(), bundle.context().issued_at_ms());
    assert_eq!(decoded.expires_at_ms(), bundle.context().expires_at_ms());
    match decoded.availability() {
        TenantRootActivationReceiptAvailabilityV1::CurrentRoleBackups { receipts } => {
            let expected = match bundle.availability() {
                router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::CurrentRoleBackups {
                    deriver_a,
                    deriver_b,
                } => router_ab_core::TenantRootRoleBackupReceiptsV1::new(
                    deriver_a.receipt_digest(),
                    deriver_b.receipt_digest(),
                )
                .expect("backup receipts"),
                router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::AcceptedPermanentDerivationLoss {
                    ..
                } => panic!("managed-backup fixture must use current-role branch"),
                router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::TenantHeldExternal {
                    ..
                } => panic!("managed-backup fixture must use current-role branch"),
            };
            assert_eq!(*receipts, expected);
        }
        TenantRootActivationReceiptAvailabilityV1::AcceptedPermanentDerivationLoss { .. } => {
            panic!("managed-backup fixture must use current-role branch")
        }
        TenantRootActivationReceiptAvailabilityV1::TenantHeldExternal { .. } => {
            panic!("managed-backup fixture must use current-role branch")
        }
    }
    let receipt_digest = receipt.digest().expect("receipt digest");
    let verified = decoded
        .verify_initial_creation(
            &bundle,
            ACTIVATION_TIME_MS,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
            ISSUER_KEY_ID,
            &verifying_key_bytes(),
        )
        .expect("verify exact initial activation receipt");
    assert_eq!(verified.canonical_bytes(), bytes.as_slice());
    assert_eq!(verified.digest(), receipt_digest);
    verified
        .require_fresh(ISSUED_AT_MS)
        .expect("issue boundary");
    verified
        .require_fresh(EXPIRES_AT_MS)
        .expect("expiry boundary");
    assert!(verified.require_fresh(EXPIRES_AT_MS + 1).is_err());
}

#[test]
fn tenant_held_external_receipt_round_trips_and_preserves_refresh_provenance() {
    let scope = restore_refresh_scope();
    let restore_context = restore_context(&scope);
    let command_a =
        SIGNERS.restore_command(&scope, &restore_context, TwoPartyDeriverRole::DeriverA);
    let command_b =
        SIGNERS.restore_command(&scope, &restore_context, TwoPartyDeriverRole::DeriverB);
    assert_eq!(command_a.context(), command_b.context());

    let initial_bundle =
        SIGNERS.tenant_held_external_initial_bundle(&scope, &restore_context, &command_a);
    let provenance = match initial_bundle.availability() {
        router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::TenantHeldExternal {
            provenance,
        } => provenance.clone(),
        _ => panic!("initial evidence must retain tenant-held external provenance"),
    };
    let receipt = sign_creation(&initial_bundle);
    let bytes = receipt
        .canonical_bytes()
        .expect("canonical external receipt");
    let decoded = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&bytes)
        .expect("decode external receipt");
    let decoded_provenance = decoded
        .availability()
        .tenant_held_external_provenance()
        .expect("external receipt branch");
    assert_eq!(decoded_provenance, &provenance);
    assert_eq!(decoded_provenance.identity_digest(), identity());
    assert_eq!(decoded_provenance.custody_lineage(), lineage());
    assert_eq!(
        decoded_provenance.destination_fingerprint(),
        scope.destination_fingerprint
    );
    assert_eq!(
        decoded_provenance.restore_session_id(),
        scope.restore_session_id
    );
    assert_eq!(decoded_provenance.recovery_set_id(), scope.recovery_set_id);
    assert_eq!(decoded_provenance.manifest_digest(), &scope.manifest_digest);
    assert_eq!(
        decoded_provenance.deriver_a_acceptance_receipt_digest(),
        scope.deriver_a_acceptance_receipt_digest
    );
    assert_eq!(
        decoded_provenance.deriver_b_acceptance_receipt_digest(),
        scope.deriver_b_acceptance_receipt_digest
    );
    assert_eq!(
        decoded_provenance.deriver_a_imported_commitment(),
        scope.commitments.deriver_a()
    );
    assert_eq!(
        decoded_provenance.deriver_b_imported_commitment(),
        scope.commitments.deriver_b()
    );
    assert_eq!(
        decoded_provenance.stable_root_commitment(),
        scope.commitments.root_commitment()
    );
    assert_eq!(
        decoded_provenance.restore_context_digest(),
        restore_context.digest().expect("restore context digest")
    );
    assert_eq!(
        decoded_provenance.restore_refresh_command_digest(),
        command_a.digest()
    );
    let verified = decoded
        .verify_initial_creation(
            &initial_bundle,
            ACTIVATION_TIME_MS,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
            ISSUER_KEY_ID,
            &verifying_key_bytes(),
        )
        .expect("verify external initial receipt");
    assert_eq!(verified.canonical_bytes(), bytes.as_slice());
    assert_eq!(verified.digest(), receipt.digest().expect("receipt digest"));

    let substitution = receipt
        .clone()
        .verify_initial_creation(
            &creation_bundle(false),
            ACTIVATION_TIME_MS,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
            ISSUER_KEY_ID,
            &verifying_key_bytes(),
        )
        .expect_err("external receipt must reject managed-backup scope substitution");
    assert_eq!(
        substitution.code(),
        RouterAbDerivationErrorCode::ReplayMismatch
    );

    let refresh_bundle = SIGNERS.tenant_held_external_refresh_bundle(&scope, &provenance);
    let refresh_receipt = sign_refresh(&refresh_bundle);
    let refresh_bytes = refresh_receipt
        .canonical_bytes()
        .expect("canonical external refresh receipt");
    let verified_refresh =
        TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&refresh_bytes)
            .expect("decode external refresh receipt")
            .verify_refresh_swap(
                &refresh_bundle,
                ACTIVATION_TIME_MS,
                TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
                ISSUER_KEY_ID,
                &verifying_key_bytes(),
            )
            .expect("verify external refresh receipt");
    assert_eq!(
        verified_refresh.transition(),
        TenantRootActivationReceiptTransitionV1::RefreshSwap
    );
    assert_eq!(
        verified_refresh
            .availability()
            .tenant_held_external_provenance(),
        Some(&provenance)
    );
    assert_eq!(
        verified_refresh.identity_digest(),
        provenance.identity_digest()
    );
    assert_eq!(
        verified_refresh.custody_lineage(),
        provenance.custody_lineage()
    );
}

#[test]
fn current_role_backup_evidence_requires_independent_key_versions() {
    let error = creation_bundle_with_shared_backup_key_version()
        .expect_err("A/B managed backups must not share a key version");
    assert_eq!(error.code(), RouterAbDerivationErrorCode::ReplayMismatch);
}

#[test]
fn current_role_backup_evidence_requires_independent_providers() {
    let error = creation_bundle_with_shared_backup_provider()
        .expect_err("A/B managed backups must not share a provider");
    assert_eq!(error.code(), RouterAbDerivationErrorCode::ReplayMismatch);
}

#[test]
fn current_role_backup_evidence_requires_independent_authorities() {
    let error = creation_bundle_with_shared_backup_authority()
        .expect_err("A/B managed backups must not share a role authority");
    assert_eq!(error.code(), RouterAbDerivationErrorCode::ReplayMismatch);
}

#[test]
fn refresh_receipt_preserves_root_continuity_and_revision_advance() {
    let bundle = refresh_bundle(false);
    let receipt = sign_refresh(&bundle);
    let bytes = receipt.canonical_bytes().expect("canonical receipt");
    let decoded = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&bytes)
        .expect("decode canonical refresh receipt");
    let verified = decoded
        .verify_refresh_swap(
            &bundle,
            ACTIVATION_TIME_MS,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
            ISSUER_KEY_ID,
            &verifying_key_bytes(),
        )
        .expect("verify exact refresh activation receipt");
    assert_eq!(verified.expected_control_plane_revision(), 5);
    assert_eq!(verified.result_control_plane_revision(), 6);
    assert_eq!(verified.issued_at_ms(), bundle.context().issued_at_ms());
    assert_eq!(verified.expires_at_ms(), bundle.context().expires_at_ms());
    assert_eq!(verified.identity_digest(), identity());
    assert_eq!(verified.custody_lineage(), lineage());
    assert_eq!(verified.context_digest(), bundle.context_digest());
    assert_eq!(verified.canonical_bytes(), bytes.as_slice());
}

#[test]
fn availability_branch_substitution_fails_before_signature_acceptance() {
    let current_bundle = creation_bundle(false);
    let receipt = sign_creation(&current_bundle);
    let accepted_loss_bundle = creation_bundle(true);
    let error = receipt
        .verify_initial_creation(
            &accepted_loss_bundle,
            ACTIVATION_TIME_MS,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
            ISSUER_KEY_ID,
            &verifying_key_bytes(),
        )
        .expect_err("availability branch substitution must fail");
    assert_eq!(error.code(), RouterAbDerivationErrorCode::ReplayMismatch);
}

#[test]
fn accepted_loss_scope_rejects_context_root_and_installation_replay() {
    let bundle = creation_bundle(true);
    let receipt = sign_creation(&bundle);
    let authority_id = TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]);

    let context_variant =
        creation_bundle_with_scope(true, identity(), lineage(), 0x34, 0x44, 0x51, 0x61);
    let context_error = verify_creation(
        receipt.clone(),
        &context_variant,
        ACTIVATION_TIME_MS,
        authority_id,
        ISSUER_KEY_ID,
    )
    .expect_err("accepted-loss context replay must fail");
    assert_eq!(
        context_error.code(),
        RouterAbDerivationErrorCode::ReplayMismatch
    );

    let root_variant =
        creation_bundle_with_scope(true, identity_with(0x12), lineage(), 0x33, 0x44, 0x51, 0x61);
    let root_error = verify_creation(
        receipt.clone(),
        &root_variant,
        ACTIVATION_TIME_MS,
        authority_id,
        ISSUER_KEY_ID,
    )
    .expect_err("accepted-loss root replay must fail");
    assert_eq!(
        root_error.code(),
        RouterAbDerivationErrorCode::ReplayMismatch
    );

    let commitment_variant = creation_bundle_with_scope_and_commitments(
        true,
        identity(),
        lineage(),
        0x33,
        0x44,
        0x51,
        0x61,
        13,
        20,
        TENANT_ROOT_INITIAL_CREATION_ACTIVATION_EXPECTED_REVISION_V1,
        TENANT_ROOT_INITIAL_CREATION_ACTIVATION_RESULT_REVISION_V1,
    );
    let commitment_error = verify_creation(
        receipt.clone(),
        &commitment_variant,
        ACTIVATION_TIME_MS,
        authority_id,
        ISSUER_KEY_ID,
    )
    .expect_err("accepted-loss root commitment replay must fail");
    assert_eq!(
        commitment_error.code(),
        RouterAbDerivationErrorCode::ReplayMismatch
    );

    let installation_variant =
        creation_bundle_with_scope(true, identity(), lineage(), 0x33, 0x44, 0x52, 0x61);
    let installation_error = verify_creation(
        receipt.clone(),
        &installation_variant,
        ACTIVATION_TIME_MS,
        authority_id,
        ISSUER_KEY_ID,
    )
    .expect_err("accepted-loss installation replay must fail");
    assert_eq!(
        installation_error.code(),
        RouterAbDerivationErrorCode::ReplayMismatch
    );

    let issuer_error = verify_creation(
        receipt,
        &bundle,
        ACTIVATION_TIME_MS,
        authority_id,
        "different-issuer-key",
    )
    .expect_err("accepted-loss issuer scope replay must fail");
    assert_eq!(
        issuer_error.code(),
        RouterAbDerivationErrorCode::ReplayMismatch
    );
}

#[test]
fn accepted_loss_revision_scope_rejects_refresh_replay() {
    let bundle = refresh_bundle(true);
    let receipt = sign_refresh(&bundle);
    let different_revision_bundle =
        refresh_bundle_with_revisions(true, 6, 7).expect("different authoritative revision bundle");
    let error = verify_refresh(
        receipt,
        &different_revision_bundle,
        ACTIVATION_TIME_MS,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
        ISSUER_KEY_ID,
    )
    .expect_err("accepted-loss revision replay must fail");
    assert_eq!(error.code(), RouterAbDerivationErrorCode::ReplayMismatch);
}

#[test]
fn accepted_loss_receipt_carries_exact_authorization_bytes_and_digest() {
    let bundle = creation_bundle(true);
    let receipt = sign_creation(&bundle);
    let authorization_bytes = match bundle.availability() {
        router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::AcceptedPermanentDerivationLoss {
            authorization,
        } => authorization.canonical_bytes().to_vec(),
        router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::CurrentRoleBackups {
            ..
        } => panic!("accepted-loss fixture must use accepted-loss branch"),
        router_ab_core::TenantRootActivationAvailabilityEvidenceViewV1::TenantHeldExternal {
            ..
        } => panic!("accepted-loss fixture must use accepted-loss branch"),
    };
    match receipt.availability() {
        TenantRootActivationReceiptAvailabilityV1::AcceptedPermanentDerivationLoss {
            authorization_bytes: receipt_bytes,
            authorization_digest,
        } => {
            let expected_digest: [u8; 32] = Sha256::digest(&authorization_bytes).into();
            assert_eq!(receipt_bytes, &authorization_bytes);
            assert_eq!(authorization_digest.as_bytes(), &expected_digest);
        }
        TenantRootActivationReceiptAvailabilityV1::CurrentRoleBackups { .. } => {
            panic!("accepted-loss fixture must use accepted-loss branch")
        }
        TenantRootActivationReceiptAvailabilityV1::TenantHeldExternal { .. } => {
            panic!("accepted-loss fixture must use accepted-loss branch")
        }
    }
    let bytes = receipt
        .canonical_bytes()
        .expect("canonical accepted-loss receipt");
    let tampered = replace_accepted_loss_authorization_byte(&bytes);
    let decoded = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&tampered)
        .expect("tampered authorization remains structurally canonical");
    let error = decoded
        .verify_initial_creation(
            &bundle,
            ACTIVATION_TIME_MS,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
            ISSUER_KEY_ID,
            &verifying_key_bytes(),
        )
        .expect_err("tampered authorization bytes must fail exact bundle verification");
    assert_eq!(error.code(), RouterAbDerivationErrorCode::ReplayMismatch);
}

#[test]
fn result_revision_and_metadata_are_authoritative() {
    let creation = creation_bundle_with_revisions(
        TENANT_ROOT_INITIAL_CREATION_ACTIVATION_EXPECTED_REVISION_V1 + 1,
        TENANT_ROOT_INITIAL_CREATION_ACTIVATION_RESULT_REVISION_V1 + 1,
    );
    let initial_error = TenantRootSignedActivationReceiptV1::sign_initial_creation(
        &creation,
        ACTIVATION_TIME_MS,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
        ISSUER_KEY_ID,
        &ISSUER_KEY_BYTES,
    )
    .expect_err("initial activation revision is fixed");
    assert_eq!(
        initial_error.code(),
        RouterAbDerivationErrorCode::MalformedInput
    );

    let invalid_refresh = refresh_bundle_with_revisions(false, 5, 7)
        .expect_err("refresh result revision must advance exactly one");
    assert_eq!(
        invalid_refresh.code(),
        RouterAbDerivationErrorCode::MalformedInput
    );

    let overflow_refresh = refresh_bundle_with_revisions(false, u64::MAX, u64::MAX)
        .expect_err("refresh revision advancement must reject overflow");
    assert_eq!(
        overflow_refresh.code(),
        RouterAbDerivationErrorCode::MalformedInput
    );
}

#[test]
fn canonical_decoder_rejects_truncation_trailing_and_tampering() {
    let bundle = creation_bundle(false);
    let receipt = sign_creation(&bundle);
    let bytes = receipt.canonical_bytes().expect("canonical receipt");
    for malformed in [
        bytes[..bytes.len() - 1].to_vec(),
        {
            let mut value = bytes.clone();
            value.push(0);
            value
        },
        {
            let mut value = bytes.clone();
            value[3] = value[3].saturating_add(1);
            value
        },
    ] {
        let error = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&malformed)
            .expect_err("non-canonical activation receipt must fail");
        assert_eq!(error.code(), RouterAbDerivationErrorCode::MalformedInput);
    }
    let mut tampered_signature = bytes.clone();
    let last_byte = tampered_signature
        .last_mut()
        .expect("canonical receipt has a signature");
    *last_byte ^= 1;
    let tampered = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&tampered_signature)
        .expect("nonzero tampered signature remains structurally canonical");
    let signature_error = tampered
        .verify_initial_creation(
            &bundle,
            ACTIVATION_TIME_MS,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x71; 32]),
            ISSUER_KEY_ID,
            &verifying_key_bytes(),
        )
        .expect_err("tampered issuer signature must fail closed");
    assert_eq!(
        signature_error.code(),
        RouterAbDerivationErrorCode::OutputVerificationFailed
    );
}

#[test]
fn issuer_signature_verification_retains_exact_wire_and_rejects_substitution() {
    let bundle = creation_bundle(false);
    let receipt = sign_creation(&bundle);
    let bytes = receipt.canonical_bytes().expect("canonical receipt");
    let decoded = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&bytes)
        .expect("decoded receipt");
    let verified = decoded
        .verify_issuer_signature(&verifying_key_bytes())
        .expect("issuer signature");
    assert_eq!(verified.canonical_bytes(), bytes.as_slice());
    assert_eq!(verified.digest(), receipt.digest().expect("receipt digest"));

    let mut tampered = bytes;
    let last_byte = tampered.len() - 1;
    tampered[last_byte] ^= 1;
    let decoded = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&tampered)
        .expect("substituted signature remains structurally canonical");
    let error = decoded
        .verify_issuer_signature(&verifying_key_bytes())
        .expect_err("substituted signature must fail");
    assert_eq!(
        error.code(),
        RouterAbDerivationErrorCode::OutputVerificationFailed
    );
}
