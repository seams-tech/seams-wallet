use super::*;
mod restore_refresh_and_bootstrap;
use self::restore_refresh_and_bootstrap::*;
mod journal_and_refresh;
use self::journal_and_refresh::*;
mod cleanup_and_managed_restore;
use self::cleanup_and_managed_restore::*;
mod installation_and_cutover;
use self::installation_and_cutover::*;
use crate::{
    TenantRootCutoverAttemptIdV1, TenantRootCutoverDrainReceiptV1,
    TenantRootCutoverFenceReceiptV1, TenantRootCutoverOpenV1, TenantRootCutoverPrerequisitesV1,
    TenantRootCutoverReceiptDigestV1,
};
use curve25519_dalek::scalar::Scalar;
use ed25519_dalek::SigningKey;
use rand_chacha::ChaCha20Rng;
use rand_core::{CryptoRng, RngCore};
use rand_core_06::SeedableRng;
use router_ab_core::{
    seal_tenant_root_refresh_contribution_v1, tenant_root_restore_refresh_context_nonce_v1,
    MpcPrfShareCommitmentWireV1, MpcPrfSigningRootShareWireV1,
    TenantRootActivationReceiptTransitionV1, TenantRootCanaryCurveFamilyV1,
    TenantRootCeremonyContextV1, TenantRootCeremonyEpochsV1, TenantRootCeremonyNonceV1,
    TenantRootCeremonySessionIdV1, TenantRootCreationCapabilityNonceV1,
    TenantRootCreationCommitmentTranscriptV1, TenantRootCustodyLineageId,
    TenantRootManagedBackupBindingV1, TenantRootManagedBackupSealRequestV1,
    TenantRootProviderCanaryReceiptBindingV1, TenantRootRefreshCommitmentTranscriptV1,
    TenantRootRefreshContributionAadV1, TenantRootRefreshHpkeKeypairV1,
    TenantRootRestoreAuthorizationNonceV1, TenantRootRestoreSessionIdV1,
    TenantRootShareInstallationEvidenceV1, TenantRootShareInstallationTranscriptV1,
    TenantRootSignedManagedBackupV1, TenantRootSignedProviderCanaryReceiptV1,
    TenantRootSignedRefreshContributionV1,
    VerifiedTenantRootInitialCreationActivationEvidenceBundleV1,
    VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1,
};
use sha2::{Digest, Sha256};
use threshold_prf::{
    prove_root_share_knowledge, RootShareRefreshCoefficient, SigningRootShare,
    SigningRootShareCommitment, SigningRootShareWire,
};

