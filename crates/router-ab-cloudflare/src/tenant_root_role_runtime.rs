mod wire;
pub use wire::*;

mod bound_share;
pub use bound_share::tenant_root_deriver_load_bound_role_share_v1;
pub(crate) use bound_share::{load_role_share_with_access, AttemptConflictV1};
mod creation_package;
pub use self::creation_package::*;
mod deriver_host;
pub use self::deriver_host::*;
mod restore_import;
pub use self::restore_import::*;
mod initial_activation;
pub use self::initial_activation::*;
mod restore_refresh_promotion;
pub use self::restore_refresh_promotion::*;
mod refresh_activation;
pub use self::refresh_activation::*;
mod refresh;
pub use self::refresh::*;
mod creation;
pub use self::creation::*;
mod managed_restore;
pub use self::managed_restore::*;
mod providers;
pub(crate) use self::providers::*;
use rand_core_06::SeedableRng;
use router_ab_core::MpcPrfSigningRootShareWireV1;
use router_ab_core::{
    resolve_active_tenant_root_pair_binding_v1, ExpectedTenantRootRestoreImportV1,
    MpcPrfShareCommitmentWireV1, TenantRootActivationReceiptBindingV1,
    TenantRootActivationReceiptTransitionV1, TenantRootActiveRoleResolutionV1,
    TenantRootActiveRoleRowKeyV1, TenantRootCanaryCurveFamilyV1, TenantRootCeremonyNonceV1,
    TenantRootCeremonySessionIdV1, TenantRootCommandReplayKeyV1, TenantRootCommandScopeV1,
    TenantRootCommandTerminalReceiptV1, TenantRootEpochCommitmentsV1, TenantRootIdentityV1,
    TenantRootManagedBackupBindingV1, TenantRootManagedRestoreRoleV1,
    TenantRootOnlineRoleShareBindingV1, TenantRootProviderCanaryReceiptBindingV1,
    TenantRootRestoreImportEnvelopeV1, TenantRootRestoreImportKeypairV1,
    TenantRootRestoreRoleImportCommandV1, TenantRootRoleCleanupCommandV1,
    TenantRootRoleCleanupTargetV1, TenantRootSignedActivationReceiptV1,
    TenantRootSignedManagedBackupV1, TenantRootSignedManagedRestoreCapabilityV1,
    TenantRootSignedManagedRestoreRoleUnavailableV1, TenantRootSignedProviderCanaryReceiptV1,
    VerifiedTenantRootManagedRestoreCapabilityV1,
    VerifiedTenantRootManagedRestoreRoleUnavailableV1,
    VerifiedTenantRootRestoreRefreshRoleCommandV1, VerifiedTenantRootRestoreRoleImportCommandV1,
    VerifiedTenantRootRoleCreationCommandV1, VerifiedTenantRootSignedActivationReceiptV1,
};
use router_ab_core::{
    PendingTenantRootInitialRoleAttemptV1, PendingTenantRootRefreshRoleAttemptV1,
    RouterAbDerivationError, RouterAbDerivationErrorCode, RouterAbDerivationResult,
    TenantRootActiveRoleBindingV1, TenantRootActiveRootPairV1, TenantRootCeremonyContextV1,
    TenantRootCeremonyEpochsV1, TenantRootControlPlaneAuthorityIdV1, TenantRootCustodyLineageId,
    TenantRootIdentityDigestV1, TenantRootManagedBackupSealRequestV1,
    TenantRootOnlineRoleShareSealRequestV1, TenantRootRefreshContributionAadV1,
    TenantRootRefreshHpkeKeypairV1,
    TenantRootRestoreRefreshRoleCommandV1, TenantRootRoleCreationCommandPackageV1,
    TenantRootRoleRefreshCommandV1, TenantRootSealedOnlineRoleShareV1, TenantRootShareEpoch,
    TenantRootSignedCreationCommitmentV1, TenantRootSignedRefreshCommitmentV1,
    TenantRootSignedRefreshContributionV1, TenantRootSignedShareInstallationEvidenceV1,
    TwoPartyDeriverRole, VerifiedTenantRootCreationCommitmentPairV1,
    VerifiedTenantRootCreationCommitmentV1, VerifiedTenantRootInitialRoleAttemptV1,
    VerifiedTenantRootManagedBackupShareV1, VerifiedTenantRootManagedBackupV1,
    VerifiedTenantRootOnlineRoleShareV1, VerifiedTenantRootRoleCreationCommandPackageV1,
    VerifiedTenantRootRoleRefreshCommandV1,
    VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
};
use router_ab_core::{
    VerifiedTenantRootRefreshCommitmentPairV1, VerifiedTenantRootRefreshRoleAttemptV1,
};
use zeroize::{Zeroize, Zeroizing};

#[cfg(test)]
use router_ab_core::TenantRootRefreshHpkePublicKeyV1;
#[cfg(test)]
use threshold_prf::SigningRootShare;
use threshold_prf::{RootShareRefreshContributionWire, SigningRootShareWire};

use sha2::{Digest, Sha256};

use crate::durable_object::tenant_root_creation::{
    tenant_root_creation_commitment_call_v1, tenant_root_creation_installation_call_v1,
    tenant_root_refresh_commitment_call_v1, tenant_root_refresh_contribution_call_v1,
    tenant_root_refresh_installation_call_v1,
    CloudflareTenantRootRefreshCommitmentResponseOutcomeV1,
    CloudflareTenantRootRefreshContributionResponseOutcomeV1, TenantRootCreationStateTransportV1,
};
use crate::env::{
    CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    CloudflareTenantRootCreationRoleSignerV1, TenantRootCreationRoleVerifyingKeysV1,
};
use crate::tenant_root_managed_backup_r2::CloudflareTenantRootManagedBackupDeletionReceiptV1;
use crate::tenant_root_role_d1::{
    CloudflareStoredTenantRootRoleShareV1, CloudflareTenantRootActivateInitialPendingDecisionV1,
    CloudflareTenantRootActivationV1, CloudflareTenantRootCommandReplayDecisionV1,
    CloudflareTenantRootCommandTerminalCommitV1, CloudflareTenantRootDeriverRoleV1,
    CloudflareTenantRootInitialCreationInputV1,
    CloudflareTenantRootInitialCreationPersistenceOutcomeV1,
    CloudflareTenantRootInitialCreationPreflightV1,
    CloudflareTenantRootInitialCreationShareInputV1,
    CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1,
    CloudflareTenantRootManagedRestoreForwardRefreshProvenanceV1,
    CloudflareTenantRootManagedRestoreStagingDecisionV1,
    CloudflareTenantRootManagedRestoreStagingInputV1,
    CloudflareTenantRootRefreshAdmissionDecisionV1,
    CloudflareTenantRootRefreshArtifactCheckpointV1, CloudflareTenantRootRefreshArtifactMetadataV1,
    CloudflareTenantRootRefreshDurableStateV1, CloudflareTenantRootRefreshExecutedCommandV1,
    CloudflareTenantRootRefreshInputV1, CloudflareTenantRootRefreshPreparedArtifactsV1,
    CloudflareTenantRootRefreshShareInputV1, CloudflareTenantRootRestoreImportKeyAcceptDecisionV1,
    CloudflareTenantRootRestoreImportKeyBindingV1,
    CloudflareTenantRootRestoreImportKeyIssueDecisionV1,
    CloudflareTenantRootRestoreImportKeyRecordV1,
    CloudflareTenantRootRestoreRefreshPromotionCompletionV1,
    CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1,
    CloudflareTenantRootRetirementV1, CloudflareTenantRootRoleShareLifecycleV1,
    TenantRootRoleShareStoreV1,
};
#[cfg(feature = "workers-rs")]
use crate::tenant_root_role_d1::CloudflareTenantRootRoleShareStoreV1;
use crate::tenant_root_role_sql::{RoleSqlSessionV1, RoleStoreResult};
use crate::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};

// HPKE uses rand_core 0.9; role proofs use 0.6. Both consume the persisted attempt stream.

#[cfg(test)]
mod tests;

#[cfg(test)]
mod admission_tests;

#[cfg(test)]
mod exchange_tests;

#[cfg(all(test, feature = "workers-rs"))]
mod live_execution_tests;

#[cfg(all(test, feature = "workers-rs"))]
mod initiator_tests;

#[cfg(all(test, feature = "workers-rs"))]
mod progress_debug_tests;

#[cfg(test)]
mod restore_session_cleanup_request_tests;
