#[cfg(all(feature = "postgres", not(target_arch = "wasm32")))]
mod postgres_e2e {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/postgres_role_store/mod.rs"
    ));
}
use curve25519_dalek::{
    ristretto::{CompressedRistretto, RistrettoPoint},
    scalar::Scalar,
    traits::Identity,
};
use ed25519_dalek::SigningKey;
use rand_chacha::ChaCha20Rng;
use rand_core_06::SeedableRng;
use router_ab_core::{
    resolve_active_tenant_root_pair_binding_v1, tenant_root_restore_refresh_context_nonce_v1,
    MpcPrfSigningRootShareWireV1, RouterAbDerivationError, StableTenantDerivationContextV2,
    TenantRootAcceptedPermanentLossAuthorizationBindingV1,
    TenantRootActivationAvailabilityEvidenceV1, TenantRootActivationReceiptTransitionV1,
    TenantRootActiveRoleBindingV1, TenantRootActiveRoleResolutionV1,
    TenantRootActiveRoleRowKeyV1, TenantRootBackupPolicyV1, TenantRootCanaryCurveFamilyV1,
    TenantRootCanaryReceiptsV1, TenantRootCeremonyContextV1, TenantRootCeremonyEpochsV1,
    TenantRootControlPlaneAuthorityIdV1, TenantRootCreationJournalV1,
    TenantRootDerivationNonceV1, TenantRootDerivationOperationIdV1,
    TenantRootDerivationSessionIdV1, TenantRootDeriverIdentitiesV1, TenantRootEmptyCreationV1,
    TenantRootManagedBackupBindingV1, TenantRootManagedBackupSealRequestV1,
    TenantRootOnlineRoleShareBindingV1, TenantRootOnlineRoleShareSealRequestV1,
    TenantRootProviderCanaryReceiptBindingV1, TenantRootRecoverySetId,
    TenantRootRestoreDestinationFingerprintV1, TenantRootRestoreRefreshRoleCommandV1,
    TenantRootRestoreSessionIdV1, TenantRootRoleBackupReceiptsV1,
    TenantRootRoleCreationCommandV1, TenantRootRoleInstallationReceiptsV1,
    TenantRootRoleRefreshCommandV1, TenantRootSealedOnlineRoleShareV1,
    TenantRootShareInstallationEvidenceV1, TenantRootShareInstallationTranscriptV1,
    TenantRootSignedAcceptedPermanentLossAuthorizationV1, TenantRootSignedActivationReceiptV1,
    TenantRootSignedManagedBackupV1, TenantRootSignedProviderCanaryReceiptV1,
    TenantRootSignedShareInstallationEvidenceV1,
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
    VerifiedTenantRootProviderCanaryReceiptV1,
    VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1,
};
use threshold_prf::{
    prove_root_share_knowledge, SigningRootShare, SigningRootShareCommitment,
    SigningRootShareWire, TwoPartyDeriverRole,
};

use super::*;
mod fixtures;
use self::fixtures::*;
mod pair_resolution;
use self::pair_resolution::*;
mod records_and_lifecycle;
use self::records_and_lifecycle::*;
mod commands;
use self::commands::*;
use crate::tenant_root_role_runtime::{
    open_tenant_root_online_role_share_v1, TenantRootOnlineRoleShareProviderV1,
};

