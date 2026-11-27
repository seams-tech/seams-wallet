#[cfg(all(feature = "workers-rs", any(feature = "strict-worker-router-entrypoint", test)))]
mod cloudflare_actor;
#[cfg(all(feature = "workers-rs", any(feature = "strict-worker-router-entrypoint", test)))]
pub use cloudflare_actor::RouterAbTenantRootCreationDurableObject;

mod grant_renewal;
mod destination_bootstrap;
pub(crate) use self::destination_bootstrap::*;
mod wire;
pub use self::wire::*;
mod router_calls;
pub use self::router_calls::*;
mod checkpoints;
pub(crate) use self::checkpoints::*;
mod cutover_restore_refresh;
pub use self::cutover_restore_refresh::*;
mod refresh_admission;
pub(crate) use self::refresh_admission::*;
mod managed_restore_authorization;
pub(crate) use self::managed_restore_authorization::*;
mod refresh_checkpoints;
pub(crate) use self::refresh_checkpoints::*;
mod store_refresh;
pub use self::store_refresh::*;
mod store_creation;
pub(crate) use self::store_creation::*;
mod store_serve;
pub use self::store_serve::*;
pub(crate) use grant_renewal::tenant_root_creation_persist_journal_v1;
#[cfg(all(feature = "workers-rs", any(feature = "strict-worker-router-entrypoint", test)))]
pub(crate) use grant_renewal::{renewal_call, RENEWAL_PATH};

use std::{collections::BTreeMap, fmt};

#[cfg(all(feature = "workers-rs", any(feature = "strict-worker-router-entrypoint", test)))]
use std::{cell::RefCell, rc::Rc};

use router_ab_core::{
    evaluate_tenant_root_refresh_commitment_checkpoint_v1,
    resolve_active_tenant_root_pair_binding_v1, verify_tenant_root_creation_evidence_v1,
    verify_tenant_root_refresh_installation_transition_v1, DestinationBootstrapAuthorityV1,
    DestinationBootstrapTokenV1, MpcPrfShareCommitmentWireV1, RouterAbDerivationError,
    RouterAbDerivationErrorCode, TenantRootActivationReceiptBindingV1,
    TenantRootActivationReceiptTransitionV1, TenantRootActiveRoleBindingV1,
    TenantRootActiveRoleResolutionV1, TenantRootActiveRoleRowKeyV1, TenantRootCeremonyContextV1,
    TenantRootCeremonyEpochsV1, TenantRootCeremonySessionIdV1, TenantRootCommandReplayKeyV1,
    TenantRootCommandSuccessReceiptV1, TenantRootCommandTerminalReceiptV1,
    TenantRootControlPlaneAuthorityIdV1, TenantRootCreationCapabilityV1,
    TenantRootCreationJournalV1, TenantRootCustodyLineageId, TenantRootEpochCommitmentsV1,
    TenantRootIdentityDigestV1, TenantRootIdentityV1, TenantRootLifecycleReceiptDigestV1,
    TenantRootManagedRestoreRoleV1, TenantRootProtocolDigestV1, TenantRootRecoveryManifestV1,
    TenantRootRefreshCommitmentCheckpointActiveBindingV1,
    TenantRootRefreshCommitmentCheckpointEvaluationV1,
    TenantRootRefreshCommitmentCheckpointOutcomeV1, TenantRootRefreshCommitmentCheckpointScopeV1,
    TenantRootRefreshCommitmentCheckpointStateV1, TenantRootRefreshCommitmentCheckpointV1,
    TenantRootRefreshContributionAadV1, TenantRootRestoreDestinationFingerprintV1,
    TenantRootRestoreRefreshGrantV1, TenantRootRestoreRefreshRoleCommandV1,
    TenantRootRoleCleanupCommandV1, TenantRootRoleCleanupTargetV1, TenantRootRoleCreationCommandV1,
    TenantRootRoleInstallationReceiptsV1, TenantRootRoleRefreshCommandV1, TenantRootShareEpoch,
    TenantRootSignedActivationReceiptV1, TenantRootSignedCreationCommitmentV1,
    TenantRootSignedRefreshCommitmentV1, TenantRootSignedRefreshContributionV1,
    TenantRootSignedShareInstallationEvidenceV1, TwoPartyDeriverRole,
    VerifiedTenantRootCreationCapabilityV1, VerifiedTenantRootCreationCommitmentPairV1,
    VerifiedTenantRootCreationCommitmentV1, VerifiedTenantRootRefreshCommitmentPairV1,
    VerifiedTenantRootRefreshCommitmentV1, VerifiedTenantRootRoleCleanupCommandV1,
    VerifiedTenantRootRoleCreationCommandV1, VerifiedTenantRootRoleRefreshCommandV1,
    VerifiedTenantRootSignedRefreshContributionV1,
    VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BYTES_V1,
    TENANT_ROOT_CREATION_CAPABILITY_MAX_BYTES_V1, TENANT_ROOT_CREATION_JOURNAL_MAX_BYTES_V1,
    TENANT_ROOT_MANAGED_RESTORE_CAPABILITY_MAX_BYTES_V1,
    TENANT_ROOT_MANAGED_RESTORE_INCIDENT_AUTHORIZATION_MAX_BYTES_V1,
    TENANT_ROOT_MANAGED_RESTORE_PUBLIC_STATE_MAX_BYTES, TENANT_ROOT_MAX_LIFETIME_MS_V1,
    TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1, TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES,
    TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_MAX_BYTES_V1,
    TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1,
    TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1,
    TENANT_ROOT_ROLE_CLEANUP_COMMAND_MAX_BYTES_V1,
    TENANT_ROOT_SIGNED_CREATION_COMMITMENT_MAX_BYTES_V1,
    TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1,
};
use router_ab_core::TENANT_ROOT_ROLE_CREATION_COMMAND_MAX_BYTES_V1;
use router_ab_core::TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BYTES_V1;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(all(test, feature = "workers-rs"))]
use crate::tenant_root_role_d1::CloudflareTenantRootPendingShareV1;
#[cfg(test)]
use crate::decode_role_verifying_keys;
use crate::{
    decode_base64url_bytes_v1, encode_base64url_bytes_v1,
    RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult,
    TenantRootCreationRoleVerifyingKeysV1, TenantRootCutoverRecordV1,
};

#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
use crate::TenantRootCutoverRecordUpdateV1;

#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_PATH: &str =
    "/router-ab/internal/tenant-root/creation/v1/journal";
/// Reads the persisted Started journal, its issuer capability, and public
/// creation progress. Public evidence only: no scalar, share, or sealed
/// material is ever stored here, so nothing private can be returned.
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_READ_PATH: &str =
    "/router-ab/internal/tenant-root/creation/v1/journal/read";
/// The Router coordinator's read of its own creation progress.
pub const CLOUDFLARE_TENANT_ROOT_CREATION_PROGRESS_READ_PATH: &str =
    "/router-ab/internal/tenant-root/creation/v1/progress/read";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const CLOUDFLARE_TENANT_ROOT_CREATION_INITIAL_ACTIVATION_PATH: &str =
    "/router-ab/internal/tenant-root/creation/v1/initial-activation";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const CLOUDFLARE_TENANT_ROOT_REFRESH_ACTIVATION_PATH: &str =
    "/router-ab/internal/tenant-root/refresh/v1/activation";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH: &str =
    "/router-ab/internal/tenant-root/creation/v1/active-state";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const CLOUDFLARE_TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_PATH: &str =
    "/router-ab/internal/tenant-root/creation/v1/commitment-rendezvous";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const CLOUDFLARE_TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_PATH: &str =
    "/router-ab/internal/tenant-root/creation/v1/installation-checkpoint";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const CLOUDFLARE_TENANT_ROOT_CREATION_CLEANUP_CHECKPOINT_PATH: &str =
    "/router-ab/internal/tenant-root/creation/v1/cleanup-checkpoint";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(crate) const TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1: &str = "creation/v1/journal";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(crate) const TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1: &str =
    "creation/v1/installation-checkpoint";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(crate) const TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_STORAGE_KEY_V1: &str =
    "creation/v1/commitment-rendezvous";
/// The fence that abandons an uncommitted creation.
pub(crate) const TENANT_ROOT_CREATION_ABANDONMENT_STORAGE_KEY_V1: &str = "creation/v1/abandonment";
/// Router -> its creation state: abandon one uncommitted creation.
pub const CLOUDFLARE_TENANT_ROOT_CREATION_ABANDONMENT_PATH: &str =
    "/router-ab/internal/tenant-root/creation/v1/abandon";

/// When an abandonment's cleanup commands are judged: the first instant after
/// the fence, since a command is fresh only strictly after its issue time and
/// each is issued at the fence. Judging there, rather than at the current
/// time, lets an interrupted abandonment finish however late it is retried.
pub(crate) const fn tenant_root_abandonment_decided_at_ms_v1(abandoned_at_ms: u64) -> u64 {
    abandoned_at_ms.saturating_add(1)
}

/// Where the Router checkpoints one abandoned role's cleanup.
fn tenant_root_creation_cleanup_checkpoint_storage_key_v1(
    role: CloudflareTenantRootCreationInstallationRoleV1,
) -> &'static str {
    match role {
        CloudflareTenantRootCreationInstallationRoleV1::DeriverA => {
            "creation/v1/cleanup-checkpoint/deriver_a"
        }
        CloudflareTenantRootCreationInstallationRoleV1::DeriverB => {
            "creation/v1/cleanup-checkpoint/deriver_b"
        }
    }
}
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(crate) const CLOUDFLARE_TENANT_ROOT_CUTOVER_READ_PATH: &str =
    "/router-ab/internal/tenant-root/cutover/v1/read";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(crate) const CLOUDFLARE_TENANT_ROOT_CUTOVER_WRITE_PATH: &str =
    "/router-ab/internal/tenant-root/cutover/v1/write";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(crate) const TENANT_ROOT_CUTOVER_STORAGE_KEY_V1: &str = "cutover/v1/state";
pub(crate) const TENANT_ROOT_CUTOVER_REQUEST_MAX_BYTES_V1: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCutoverReadRequestV1 {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootCutoverWriteRequestV1 {
    Initialize {
        record: TenantRootCutoverRecordV1,
    },
    Update {
        expected_revision: u64,
        record: TenantRootCutoverRecordV1,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloudflareTenantRootCutoverWriteOutcomeV1 {
    Initialized,
    ExactReplay,
    Advanced,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCutoverWriteResponseV1 {
    outcome: CloudflareTenantRootCutoverWriteOutcomeV1,
    record: TenantRootCutoverRecordV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootCutoverReadResponseV1 {
    Empty,
    Present { record: TenantRootCutoverRecordV1 },
}

#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const CLOUDFLARE_TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_PATH: &str =
    "/router-ab/internal/tenant-root/refresh/v1/commitment-checkpoint";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const CLOUDFLARE_TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_PATH: &str =
    "/router-ab/internal/tenant-root/refresh/v1/installation-checkpoint";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const CLOUDFLARE_TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_PATH: &str =
    "/router-ab/internal/tenant-root/refresh/v1/contribution-rendezvous";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub const TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1: &str = "refresh/v1/active-state";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(crate) const TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1: &str =
    "refresh/v1/commitment-checkpoint";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(crate) const TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1: &str =
    "refresh/v1/installation-checkpoint";
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(crate) const TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_STORAGE_KEY_V1: &str =
    "refresh/v1/contribution-rendezvous";

/// Restore-refresh has its own aggregate. It never participates in the
/// active-root refresh fence or its epoch/activation state.
pub(crate) const TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_STORAGE_KEY_V1: &str =
    "restore-refresh/v1/checkpoint";
pub(crate) const TENANT_ROOT_RESTORE_REFRESH_INITIAL_ACTIVATION_EXPECTED_REVISION_V1: u64 = 2;
pub(crate) const TENANT_ROOT_RESTORE_REFRESH_INITIAL_ACTIVATION_RESULT_REVISION_V1: u64 = 3;
pub(crate) const TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_REQUEST_MAX_BYTES_V1: usize = 512 * 1024;
pub(crate) const TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_RESPONSE_MAX_BYTES_V1: usize = 512 * 1024;
pub(crate) const TENANT_ROOT_RESTORE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1: usize = 32 * 1024;
pub(crate) const TENANT_ROOT_RESTORE_INITIAL_ACTIVATION_RESPONSE_MAX_BYTES_V1: usize = 8 * 1024;

/// One preprovisioned destination bootstrap authority record. The bearer
/// credential is represented only by its native digest; it never crosses this
/// record boundary in plaintext.
pub(crate) const TENANT_ROOT_DESTINATION_BOOTSTRAP_STORAGE_KEY_V1: &str =
    "destination-bootstrap/v1/record";
pub(crate) const TENANT_ROOT_DESTINATION_BOOTSTRAP_DESTROYED_STORAGE_KEY_V1: &str =
    "destination-bootstrap/v1/destroyed";
const TENANT_ROOT_DESTINATION_BOOTSTRAP_IDENTITY_MAX_BYTES_V1: usize = 8 * 1024;
const TENANT_ROOT_DESTINATION_BOOTSTRAP_RECORD_MAX_BYTES_V1: usize = 16 * 1024;
pub(crate) const TENANT_ROOT_DESTINATION_BOOTSTRAP_REQUEST_MAX_BYTES_V1: usize = 16 * 1024;
pub(crate) const TENANT_ROOT_DESTINATION_BOOTSTRAP_RESPONSE_MAX_BYTES_V1: usize = 16 * 1024;
const TENANT_ROOT_DESTINATION_BOOTSTRAP_DESTROYED_RECORD_MAX_BYTES_V1: usize = 16 * 1024;
const TENANT_ROOT_DESTINATION_BOOTSTRAP_DESTRUCTION_RECEIPT_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-destination-bootstrap-destruction/v1";

const TENANT_ROOT_CREATION_OBJECT_NAME_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-creation-object-name/v1";
const TENANT_ROOT_CREATION_OBJECT_NAME_PREFIX_V1: &str = "tenant-root-creation-v1";
const TENANT_ROOT_CREATION_JOURNAL_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_CREATION_JOURNAL_MAX_BYTES_V1);
const TENANT_ROOT_CREATION_CAPABILITY_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_CREATION_CAPABILITY_MAX_BYTES_V1);
const TENANT_ROOT_CREATION_INSTALLATION_EVIDENCE_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1);
const TENANT_ROOT_CREATION_COMMITMENT_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_SIGNED_CREATION_COMMITMENT_MAX_BYTES_V1);
const TENANT_ROOT_REFRESH_COMMITMENT_MAX_BYTES_V1: usize = 4 * 1024;
const TENANT_ROOT_REFRESH_COMMITMENT_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_REFRESH_COMMITMENT_MAX_BYTES_V1);
const TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1: usize = 4 * 1024;
const TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1);
const TENANT_ROOT_REFRESH_CHECKPOINT_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_MAX_BYTES_V1);
const TENANT_ROOT_ROLE_CREATION_COMMAND_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_ROLE_CREATION_COMMAND_MAX_BYTES_V1);
const TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BYTES_V1);
const TENANT_ROOT_ROLE_CLEANUP_COMMAND_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_ROLE_CLEANUP_COMMAND_MAX_BYTES_V1);
const TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BYTES_V1);
const TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BYTES_V1: usize = 16 * 1024;
const TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BYTES_V1);
const TENANT_ROOT_MANUAL_REFRESH_INTERVAL_MS_V1: u64 = 10 * 60 * 1000;
pub(crate) const TENANT_ROOT_SCHEDULED_REFRESH_INTERVAL_MS_V1: u64 = 30 * 24 * 60 * 60 * 1000;
pub(crate) const TENANT_ROOT_SCHEDULED_REFRESH_JITTER_WINDOW_MS_V1: u64 = 24 * 60 * 60 * 1000;
const TENANT_ROOT_SCHEDULED_REFRESH_JITTER_DOMAIN_V1: &[u8] =
    b"seams/tenant-root/scheduled-refresh-jitter/v1";
const TENANT_ROOT_MANUAL_REFRESH_OPERATION_MAX_BYTES_V1: usize = 256;
const TENANT_ROOT_MANUAL_REFRESH_COMPLETION_STORAGE_PREFIX_V1: &str =
    "refresh/v1/manual-completion/";
const TENANT_ROOT_REFRESH_ABANDONMENT_STORAGE_PREFIX_V1: &str = "refresh/v1/abandoned-operation/";
const TENANT_ROOT_MANAGED_RESTORE_COMPLETION_STORAGE_PREFIX_V1: &str =
    "managed-restore/v1/completion/";
pub(crate) const TENANT_ROOT_MANUAL_REFRESH_IN_PROGRESS_ERROR_V1: &str =
    "tenant_root_refresh_in_progress";
const TENANT_ROOT_REFRESH_ATTEMPT_CONTEXT_MAX_BYTES_V1: usize = 8 * 1024;
const TENANT_ROOT_REFRESH_ATTEMPT_COMMAND_MAX_BYTES_V1: usize = 16 * 1024;
const TENANT_ROOT_MANAGED_RESTORE_INCIDENT_MAX_BYTES_V1: usize = 256;
const TENANT_ROOT_MANAGED_RESTORE_NONCE_BYTES_V1: usize = 32;
const TENANT_ROOT_MANAGED_RESTORE_INCIDENT_AUTHORIZATION_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_MANAGED_RESTORE_INCIDENT_AUTHORIZATION_MAX_BYTES_V1);
const TENANT_ROOT_MANAGED_RESTORE_IDENTITY_MAX_BYTES_V1: usize = 8 * 1024;
const TENANT_ROOT_MANAGED_RESTORE_IDENTITY_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_MANAGED_RESTORE_IDENTITY_MAX_BYTES_V1);
const TENANT_ROOT_MANAGED_RESTORE_ARTIFACT_MAX_BYTES_V1: usize = 48 * 1024;
const TENANT_ROOT_MANAGED_RESTORE_CAPABILITY_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_MANAGED_RESTORE_CAPABILITY_MAX_BYTES_V1);
const TENANT_ROOT_MANAGED_RESTORE_PUBLIC_STATE_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_MANAGED_RESTORE_PUBLIC_STATE_MAX_BYTES);
const TENANT_ROOT_MANAGED_RESTORE_ARTIFACT_MAX_BASE64URL_BYTES_V1: usize =
    base64url_len_for_bytes(TENANT_ROOT_MANAGED_RESTORE_ARTIFACT_MAX_BYTES_V1);
const TENANT_ROOT_MANAGED_RESTORE_CHALLENGE_DOMAIN_V1: &[u8] =
    b"tenant_root_managed_restore_authorization_challenge_v1";
const TENANT_ROOT_MANAGED_RESTORE_ATTEMPT_DOMAIN_V1: &[u8] =
    b"tenant_root_managed_restore_authorization_attempt_v1";

/// A deployment's refresh schedule: the least time between manual refreshes
/// of one root, and the interval its scheduled refreshes run at. The Router's
/// admission and its status report both judge by it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TenantRootRefreshScheduleV1 {
    pub(crate) manual_interval_ms: u64,
    pub(crate) scheduled_interval_ms: u64,
}

impl Default for TenantRootRefreshScheduleV1 {
    fn default() -> Self {
        Self {
            manual_interval_ms: TENANT_ROOT_MANUAL_REFRESH_INTERVAL_MS_V1,
            scheduled_interval_ms: TENANT_ROOT_SCHEDULED_REFRESH_INTERVAL_MS_V1,
        }
    }
}

/// Each root's scheduled refresh is spread over up to a day, or over the
/// interval when that is shorter, by a jitter derived from its identity.
pub(crate) fn tenant_root_scheduled_refresh_jitter_ms_v1(
    identity_digest: TenantRootIdentityDigestV1,
    scheduled_interval_ms: u64,
) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(TENANT_ROOT_SCHEDULED_REFRESH_JITTER_DOMAIN_V1);
    hasher.update(identity_digest.as_bytes());
    let digest = hasher.finalize();
    let mut jitter_bytes = [0_u8; 8];
    jitter_bytes.copy_from_slice(&digest[..8]);
    u64::from_be_bytes(jitter_bytes)
        % TENANT_ROOT_SCHEDULED_REFRESH_JITTER_WINDOW_MS_V1.min(scheduled_interval_ms.max(1))
}

pub(crate) fn tenant_root_scheduled_refresh_next_at_ms_v1(
    identity_digest: TenantRootIdentityDigestV1,
    activation_at_ms: u64,
    last_refresh_completed_at_ms: Option<u64>,
    scheduled_interval_ms: u64,
) -> u64 {
    let anchor = last_refresh_completed_at_ms.unwrap_or(activation_at_ms);
    anchor
        .saturating_add(scheduled_interval_ms)
        .saturating_add(tenant_root_scheduled_refresh_jitter_ms_v1(
            identity_digest,
            scheduled_interval_ms,
        ))
}
#[cfg(feature = "workers-rs")]
const ROUTER_TENANT_ROOT_CREATION_DO_BINDING_V1: &str = "ROUTER_TENANT_ROOT_CREATION_DO";
#[cfg(feature = "workers-rs")]
const TENANT_ROOT_CUTOVER_OBJECT_NAME_V1: &str = "tenant-root-cutover-v1";
const TENANT_ROOT_CREATION_JOURNAL_RESPONSE_MAX_BYTES_V1: usize = 4 * 1024;
const TENANT_ROOT_CREATION_JOURNAL_READ_RESPONSE_MAX_BYTES_V1: usize = 256 * 1024;
const TENANT_ROOT_CREATION_PROGRESS_READ_RESPONSE_MAX_BYTES_V1: usize =
    TENANT_ROOT_CREATION_JOURNAL_READ_RESPONSE_MAX_BYTES_V1
        + TENANT_ROOT_CREATION_ACTIVE_STATE_READ_RESPONSE_MAX_BYTES_V1;
const TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1: usize =
    TENANT_ROOT_CREATION_JOURNAL_MAX_BASE64URL_BYTES_V1
        + TENANT_ROOT_CREATION_CAPABILITY_MAX_BASE64URL_BYTES_V1
        + 128;
const TENANT_ROOT_CREATION_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1: usize =
    TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BASE64URL_BYTES_V1 + 128;
const TENANT_ROOT_CREATION_INITIAL_ACTIVATION_RESPONSE_MAX_BYTES_V1: usize = 1024;
const TENANT_ROOT_REFRESH_ACTIVATION_RESPONSE_MAX_BYTES_V1: usize = 1024;
const TENANT_ROOT_CREATION_ACTIVE_STATE_READ_REQUEST_MAX_BYTES_V1: usize =
    TENANT_ROOT_MANAGED_RESTORE_ACTIVE_STATE_REQUEST_MAX_BYTES_V1;
const TENANT_ROOT_CREATION_ACTIVE_STATE_READ_RESPONSE_MAX_BYTES_V1: usize =
    TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BASE64URL_BYTES_V1
        + TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BASE64URL_BYTES_V1 * 2
        + 8 * 1024
        + TENANT_ROOT_MANAGED_RESTORE_ARTIFACT_MAX_BASE64URL_BYTES_V1 * 2
        + TENANT_ROOT_MANAGED_RESTORE_INCIDENT_AUTHORIZATION_MAX_BASE64URL_BYTES_V1
        + TENANT_ROOT_MANAGED_RESTORE_IDENTITY_MAX_BASE64URL_BYTES_V1
        + 16 * 1024
        + 1024;
const TENANT_ROOT_MANAGED_RESTORE_ACTIVE_STATE_REQUEST_MAX_BYTES_V1: usize =
    TENANT_ROOT_MANAGED_RESTORE_ARTIFACT_MAX_BASE64URL_BYTES_V1 * 2
        + TENANT_ROOT_MANAGED_RESTORE_INCIDENT_AUTHORIZATION_MAX_BASE64URL_BYTES_V1
        + TENANT_ROOT_MANAGED_RESTORE_IDENTITY_MAX_BASE64URL_BYTES_V1 * 2
        + TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BASE64URL_BYTES_V1 * 2
        + 16 * 1024;
const TENANT_ROOT_CREATION_COMMITMENT_REQUEST_MAX_BYTES_V1: usize =
    TENANT_ROOT_ROLE_CREATION_COMMAND_MAX_BASE64URL_BYTES_V1
        + TENANT_ROOT_CREATION_COMMITMENT_MAX_BASE64URL_BYTES_V1
        + 128;
const TENANT_ROOT_CREATION_INSTALLATION_REQUEST_MAX_BYTES_V1: usize =
    TENANT_ROOT_ROLE_CREATION_COMMAND_MAX_BASE64URL_BYTES_V1
        + TENANT_ROOT_CREATION_INSTALLATION_EVIDENCE_MAX_BASE64URL_BYTES_V1
        + 128;
const TENANT_ROOT_CREATION_CLEANUP_REQUEST_MAX_BYTES_V1: usize =
    TENANT_ROOT_ROLE_CLEANUP_COMMAND_MAX_BASE64URL_BYTES_V1
        + TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BASE64URL_BYTES_V1
        + 128;
const TENANT_ROOT_CREATION_CLEANUP_RESPONSE_MAX_BYTES_V1: usize = 1024;
const TENANT_ROOT_CREATION_COMMITMENT_RESPONSE_MAX_BYTES_V1: usize =
    TENANT_ROOT_CREATION_COMMITMENT_MAX_BASE64URL_BYTES_V1 * 2 + 512;
const TENANT_ROOT_CREATION_INSTALLATION_RESPONSE_MAX_BYTES_V1: usize =
    TENANT_ROOT_CREATION_INSTALLATION_EVIDENCE_MAX_BASE64URL_BYTES_V1 * 2 + 512;
const TENANT_ROOT_REFRESH_COMMITMENT_REQUEST_MAX_BYTES_V1: usize =
    TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BASE64URL_BYTES_V1
        + TENANT_ROOT_REFRESH_COMMITMENT_MAX_BASE64URL_BYTES_V1
        + 128;
const TENANT_ROOT_REFRESH_INSTALLATION_REQUEST_MAX_BYTES_V1: usize =
    TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BASE64URL_BYTES_V1
        + TENANT_ROOT_CREATION_INSTALLATION_EVIDENCE_MAX_BASE64URL_BYTES_V1
        + TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BASE64URL_BYTES_V1
        + 128;
const TENANT_ROOT_REFRESH_CONTRIBUTION_REQUEST_MAX_BYTES_V1: usize =
    TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BASE64URL_BYTES_V1
        + TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BASE64URL_BYTES_V1
        + 128;
const TENANT_ROOT_REFRESH_COMMITMENT_RESPONSE_MAX_BYTES_V1: usize =
    TENANT_ROOT_REFRESH_COMMITMENT_MAX_BASE64URL_BYTES_V1 * 2 + 2048;
const TENANT_ROOT_REFRESH_INSTALLATION_RESPONSE_MAX_BYTES_V1: usize = 4096;
const TENANT_ROOT_REFRESH_CONTRIBUTION_RESPONSE_MAX_BYTES_V1: usize =
    TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BASE64URL_BYTES_V1 * 2 + 2048;

pub fn tenant_root_creation_object_name_v1(
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(TENANT_ROOT_CREATION_OBJECT_NAME_DOMAIN_V1);
    hasher.update(identity_digest.as_bytes());
    hasher.update(custody_lineage.as_bytes());
    format!(
        "{TENANT_ROOT_CREATION_OBJECT_NAME_PREFIX_V1}-{}",
        encode_base64url_bytes_v1(&hasher.finalize())
    )
}

/// A refresh checkpoint request verified against the active state, before
/// the checkpoint is evaluated.
struct LoadedTenantRootRefreshRequestV1 {
    active: ValidatedTenantRootRefreshActiveStateV1,
    context: TenantRootCeremonyContextV1,
    command: VerifiedTenantRootRoleRefreshCommandV1,
    candidate_bytes: Vec<u8>,
}

struct LoadedTenantRootRefreshInstallationRequestV1 {
    active: ValidatedTenantRootRefreshActiveStateV1,
    context: TenantRootCeremonyContextV1,
    command: VerifiedTenantRootRoleRefreshCommandV1,
    candidate_bytes: Vec<u8>,
    terminal_receipt: VerifiedTenantRootRefreshInstallationReceiptV1,
}

struct VerifiedTenantRootRefreshInstallationReceiptV1 {
    receipt: TenantRootCommandSuccessReceiptV1,
}

impl VerifiedTenantRootRefreshInstallationReceiptV1 {
    fn new(
        receipt: TenantRootCommandSuccessReceiptV1,
        candidate_bytes: &[u8],
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        context: &TenantRootCeremonyContextV1,
        role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    ) -> RouterAbProtocolResult<Self> {
        let trusted_role_key = role_keys
            .for_role_and_key_id(command.role(), context.signing_key_id(command.role()))?;
        receipt
            .verify_remote_public(
                command.scope().key(),
                candidate_bytes,
                command.issued_at_ms(),
                context.signing_key_id(command.role()),
                trusted_role_key,
            )
            .map_err(candidate_derivation_error)?;
        Ok(Self { receipt })
    }

    fn require_matches(
        &self,
        candidate_bytes: &[u8],
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        context: &TenantRootCeremonyContextV1,
    ) -> RouterAbProtocolResult<()> {
        if self.receipt.key() != command.scope().key()
            || self.receipt.payload_bytes() != candidate_bytes
            || self.receipt.role_signing_key_id() != context.signing_key_id(command.role())
            || self.receipt.terminal_at_ms() < command.issued_at_ms()
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root refresh terminal receipt does not match its command and evidence",
            ));
        }
        Ok(())
    }
}

/// Fails closed unless `encoded` is exactly the base64url of `expected`.
pub(crate) fn require_base64url_matches(
    field: &str,
    encoded: &str,
    expected: &[u8],
) -> RouterAbProtocolResult<()> {
    let decoded = decode_canonical_base64url(field, encoded, expected.len(), encoded.len().max(4))?;
    if decoded.as_slice() != expected {
        return Err(malformed_input(format!(
            "{field} does not match the persisted tenant-root creation value"
        )));
    }
    Ok(())
}

#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
fn authority_id_from_object_id(
    authority_object_id: &str,
) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
    Ok(TenantRootControlPlaneAuthorityIdV1::from_bytes(
        decode_lower_hex_32(
            "tenant-root creation Durable Object id",
            authority_object_id,
        )?,
    ))
}

fn validate_refresh_role_command(
    encoded: &str,
    active: &ValidatedTenantRootRefreshActiveStateV1,
    context: &TenantRootCeremonyContextV1,
    expected_role: TwoPartyDeriverRole,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
) -> RouterAbProtocolResult<VerifiedTenantRootRoleRefreshCommandV1> {
    let bytes = decode_canonical_base64url(
        "tenant-root role refresh command",
        encoded,
        TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BYTES_V1,
        TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BASE64URL_BYTES_V1,
    )?;
    let command = decode_and_verify_refresh_role_command(
        &bytes,
        active,
        context,
        issuer_keys,
        expected_authority_id,
    )?;
    if command.role() != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh command role does not match its signed payload",
        ));
    }
    Ok(command)
}

fn decode_and_verify_refresh_role_command(
    bytes: &[u8],
    active: &ValidatedTenantRootRefreshActiveStateV1,
    context: &TenantRootCeremonyContextV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
) -> RouterAbProtocolResult<VerifiedTenantRootRoleRefreshCommandV1> {
    let command = TenantRootRoleRefreshCommandV1::decode_canonical_bytes(bytes)
        .map_err(candidate_derivation_error)?;
    let issuer_key_id = command.issuer_key_id();
    let verifying_key = issuer_keys.get(issuer_key_id).ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh command issuer is not trusted",
        )
    })?;
    command
        .verify(
            &active.active_pair,
            context,
            command.role(),
            active.record.lifecycle_revision,
            expected_authority_id,
            issuer_key_id,
            verifying_key,
        )
        .map_err(candidate_authorization_error)
}

struct RefreshResponseScopeV1 {
    command_digest_b64u: String,
    identity_digest_b64u: String,
    custody_lineage_b64u: String,
    authority_id_b64u: String,
    ceremony_context_digest_b64u: String,
    current_epoch: u64,
    next_epoch: u64,
    expected_control_plane_revision: u64,
    active_root_commitment_b64u: String,
    active_activation_receipt_digest_b64u: String,
}

fn refresh_response_scope(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    active: &ValidatedTenantRootRefreshActiveStateV1,
    context: &TenantRootCeremonyContextV1,
) -> RouterAbProtocolResult<RefreshResponseScopeV1> {
    let scope = refresh_checkpoint_scope(command, active, context, command.authority_id())?;
    Ok(RefreshResponseScopeV1 {
        command_digest_b64u: encode_base64url_bytes_v1(command.digest().as_bytes()),
        identity_digest_b64u: scope.identity_digest_b64u,
        custody_lineage_b64u: scope.custody_lineage_b64u,
        authority_id_b64u: scope.authority_id_b64u,
        ceremony_context_digest_b64u: scope.ceremony_context_digest_b64u,
        current_epoch: scope.current_epoch,
        next_epoch: scope.next_epoch,
        expected_control_plane_revision: scope.expected_control_plane_revision,
        active_root_commitment_b64u: scope.active_root_commitment_b64u,
        active_activation_receipt_digest_b64u: scope.active_activation_receipt_digest_b64u,
    })
}

fn refresh_commitment_response(
    scope: RefreshResponseScopeV1,
    outcome: CloudflareTenantRootRefreshCommitmentResponseOutcomeV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshCommitmentResponseV1> {
    Ok(CloudflareTenantRootRefreshCommitmentResponseV1 {
        outcome,
        command_digest_b64u: scope.command_digest_b64u,
        identity_digest_b64u: scope.identity_digest_b64u,
        custody_lineage_b64u: scope.custody_lineage_b64u,
        authority_id_b64u: scope.authority_id_b64u,
        ceremony_context_digest_b64u: scope.ceremony_context_digest_b64u,
        current_epoch: scope.current_epoch,
        next_epoch: scope.next_epoch,
        expected_control_plane_revision: scope.expected_control_plane_revision,
        active_root_commitment_b64u: scope.active_root_commitment_b64u,
        active_activation_receipt_digest_b64u: scope.active_activation_receipt_digest_b64u,
    })
}

fn refresh_installation_response(
    scope: RefreshResponseScopeV1,
    outcome: CloudflareTenantRootRefreshInstallationResponseOutcomeV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshInstallationResponseV1> {
    Ok(CloudflareTenantRootRefreshInstallationResponseV1 {
        outcome,
        command_digest_b64u: scope.command_digest_b64u,
        identity_digest_b64u: scope.identity_digest_b64u,
        custody_lineage_b64u: scope.custody_lineage_b64u,
        authority_id_b64u: scope.authority_id_b64u,
        ceremony_context_digest_b64u: scope.ceremony_context_digest_b64u,
        current_epoch: scope.current_epoch,
        next_epoch: scope.next_epoch,
        expected_control_plane_revision: scope.expected_control_plane_revision,
        active_root_commitment_b64u: scope.active_root_commitment_b64u,
        active_activation_receipt_digest_b64u: scope.active_activation_receipt_digest_b64u,
    })
}

fn refresh_contribution_response(
    scope: RefreshResponseScopeV1,
    outcome: CloudflareTenantRootRefreshContributionResponseOutcomeV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshContributionResponseV1> {
    Ok(CloudflareTenantRootRefreshContributionResponseV1 {
        outcome,
        command_digest_b64u: scope.command_digest_b64u,
        identity_digest_b64u: scope.identity_digest_b64u,
        custody_lineage_b64u: scope.custody_lineage_b64u,
        authority_id_b64u: scope.authority_id_b64u,
        ceremony_context_digest_b64u: scope.ceremony_context_digest_b64u,
        current_epoch: scope.current_epoch,
        next_epoch: scope.next_epoch,
        expected_control_plane_revision: scope.expected_control_plane_revision,
        active_root_commitment_b64u: scope.active_root_commitment_b64u,
        active_activation_receipt_digest_b64u: scope.active_activation_receipt_digest_b64u,
    })
}

fn validate_tenant_root_creation_object_binding_v1(
    object_id: &str,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
) -> RouterAbProtocolResult<()> {
    let derived_authority_id = TenantRootControlPlaneAuthorityIdV1::from_bytes(
        decode_lower_hex_32("tenant-root creation Durable Object id", object_id)?,
    );
    if derived_authority_id != expected_authority_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root creation capability authority does not match the derived Durable Object id",
        ));
    }
    Ok(())
}

#[cfg(feature = "workers-rs")]
pub(crate) fn derive_tenant_root_creation_authority_object_v1(
    env: &worker::Env,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<(TenantRootControlPlaneAuthorityIdV1, String)> {
    let namespace = env
        .durable_object(ROUTER_TENANT_ROOT_CREATION_DO_BINDING_V1)
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingLocalBinding,
                format!("tenant-root creation Durable Object binding is unavailable: {error}"),
            )
        })?;
    let object_name = tenant_root_creation_object_name_v1(identity_digest, custody_lineage);
    let object_id = namespace
        .id_from_name(&object_name)
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("tenant-root creation Durable Object id derivation failed: {error}"),
            )
        })?
        .to_string();
    let authority_id = TenantRootControlPlaneAuthorityIdV1::from_bytes(decode_lower_hex_32(
        "tenant-root creation Durable Object id",
        &object_id,
    )?);
    Ok((authority_id, object_name))
}

#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
fn require_tenant_root_creation_authority_object_v1(
    env: &worker::Env,
    authority_object_id: &str,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
) -> RouterAbProtocolResult<()> {
    let (expected_authority_id, _) =
        derive_tenant_root_creation_authority_object_v1(env, identity_digest, custody_lineage)?;
    let authority_id = TenantRootControlPlaneAuthorityIdV1::from_bytes(decode_lower_hex_32(
        "tenant-root creation Durable Object id",
        authority_object_id,
    )?);
    if expected_authority_id != authority_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root creation command reached a non-authoritative Durable Object",
        ));
    }
    Ok(())
}

#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
async fn storage_get_optional<T: serde::de::DeserializeOwned>(
    storage: &worker::Storage,
    key: &str,
) -> worker::Result<Option<T>> {
    storage.get(key).await
}

#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
async fn transaction_get_optional<T: serde::de::DeserializeOwned>(
    transaction: &worker::Transaction,
    key: &str,
) -> worker::Result<Option<T>> {
    match transaction.get(key).await {
        Ok(value) => Ok(Some(value)),
        Err(worker::Error::JsError(message)) if message == "No such value in storage." => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
fn request_has_json_content_type(request: &worker::Request) -> worker::Result<bool> {
    let Some(content_type) = request.headers().get("content-type")? else {
        return Ok(false);
    };
    Ok(content_type
        .split(';')
        .next()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json")))
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn decode_bounded_json_request<T: DeserializeOwned>(
    request: &mut worker::Request,
    max_bytes: usize,
) -> RouterAbProtocolResult<T> {
    use futures::StreamExt;

    let mut stream = request.stream().map_err(|error| {
        malformed_input(format!(
            "tenant-root creation request body is unavailable: {error}"
        ))
    })?;
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            malformed_input(format!(
                "tenant-root creation request body read failed: {error}"
            ))
        })?;
        let next_len = body
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| malformed_input("tenant-root creation request length overflows"))?;
        if next_len > max_bytes {
            return Err(malformed_input(
                "tenant-root creation request exceeds its maximum size",
            ));
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|error| {
        malformed_input(format!(
            "tenant-root creation request JSON is invalid: {error}"
        ))
    })
}

#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
async fn decode_bounded_creation_request(
    request: &mut worker::Request,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationJournalRequestV1> {
    decode_bounded_json_request(request, TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1).await
}

#[cfg(feature = "workers-rs")]
pub(crate) fn read_required_worker_var(
    env: &worker::Env,
    name: &str,
) -> RouterAbProtocolResult<String> {
    let value = env.var(name).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingLocalBinding,
            format!("required tenant-root creation binding {name} is unavailable: {error}"),
        )
    })?;
    let value = value.to_string();
    if value.is_empty() || value.trim() != value {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("tenant-root creation binding {name} is invalid"),
        ));
    }
    Ok(value)
}

#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
fn read_tenant_root_creation_role_verifying_keys(
    env: &worker::Env,
) -> RouterAbProtocolResult<TenantRootCreationRoleVerifyingKeysV1> {
    crate::decode_role_verifying_keys(&read_required_worker_var(
        env,
        crate::ROUTER_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON_ENV,
    )?)
}

#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(crate) fn decode_lower_hex_32(field: &str, value: &str) -> RouterAbProtocolResult<[u8; 32]> {
    if value.len() != 64
        || value
            .bytes()
            .any(|byte| !byte.is_ascii_hexdigit() || byte.is_ascii_uppercase())
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{field} must be exactly 64 lowercase hexadecimal characters"),
        ));
    }
    let mut decoded = [0_u8; 32];
    for (output, pair) in decoded.iter_mut().zip(value.as_bytes().chunks_exact(2)) {
        *output = (lower_hex_nibble(pair[0]) << 4) | lower_hex_nibble(pair[1]);
    }
    Ok(decoded)
}

#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
fn lower_hex_nibble(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        _ => unreachable!("lowercase hexadecimal input was validated"),
    }
}

pub(crate) fn decode_canonical_base64url(
    field: &str,
    value: &str,
    max_decoded_bytes: usize,
    max_encoded_bytes: usize,
) -> RouterAbProtocolResult<Vec<u8>> {
    if value.is_empty() || value.len() > max_encoded_bytes {
        return Err(malformed_input(format!("{field} length is invalid")));
    }
    let decoded = decode_base64url_bytes_v1(field, value)?;
    if decoded.len() > max_decoded_bytes || encode_base64url_bytes_v1(&decoded) != value {
        return Err(malformed_input(format!("{field} is not canonical")));
    }
    Ok(decoded)
}

#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
fn durable_storage_protocol_error(error: worker::Error) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!("tenant-root creation journal durable storage failed: {error}"),
    )
}

#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
fn tenant_root_creation_do_error_response(
    error: RouterAbProtocolError,
) -> worker::Result<worker::Response> {
    if error.code() == RouterAbProtocolErrorCode::ForbiddenLocalBinding {
        return worker::Response::error("tenant-root creation capability rejected", 403);
    }
    worker::Response::error(
        "tenant-root creation journal unavailable",
        super::durable_object_error_status(error.code()),
    )
}

fn candidate_derivation_error(error: RouterAbDerivationError) -> RouterAbProtocolError {
    malformed_input(format!(
        "tenant-root creation request rejected: {:?}",
        error.code()
    ))
}

fn candidate_authorization_error(error: RouterAbDerivationError) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::ForbiddenLocalBinding,
        format!(
            "tenant-root creation capability verification failed: {:?}",
            error.code()
        ),
    )
}

fn stored_record_error(error: RouterAbProtocolError) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!(
            "stored tenant-root creation record is invalid: {:?}",
            error.code()
        ),
    )
}

fn malformed_input(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MalformedWirePayload, message)
}

// ---------------------------------------------------------------------------
// Refresh and managed-restore state over the host-neutral creation store
// ---------------------------------------------------------------------------
//
// The authoritative active state, its refresh fence and checkpoints, and its
// managed-restore fence, as operations over `TenantRootCreationStoreV1`. Each
// host runs one operation inside one storage transaction, reads its own
// configuration and clock, and passes them in. As with the creation
// operations, a refusal is decided before anything is written.

// ---------------------------------------------------------------------------
// Restore into a new deployment over the host-neutral creation store
// ---------------------------------------------------------------------------
//
// The destination's bootstrap authority, its restore-refresh checkpoint and
// its restore initial activation, as operations over
// `TenantRootCreationStoreV1`, so a Cloudflare Durable Object and a VM Router
// serve them alike. As with the other operations, every refusal is decided
// before anything is written.

/// The creation Durable Object's storage as the shared creation store,
/// before it is bound to one storage transaction.
#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
struct DurableObjectCreationStoreV1 {
    env: worker::Env,
    authority_object_id: String,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
}

#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
impl DurableObjectCreationStoreV1 {
    fn new(env: &worker::Env, authority_object_id: &str) -> RouterAbProtocolResult<Self> {
        Ok(Self {
            env: env.clone(),
            authority_object_id: authority_object_id.to_owned(),
            authority_id: authority_id_from_object_id(authority_object_id)?,
        })
    }

    fn bind(self, transaction: worker::Transaction) -> OwnedDurableObjectTransactionStoreV1 {
        OwnedDurableObjectTransactionStoreV1 {
            transaction,
            env: self.env,
            authority_object_id: self.authority_object_id,
            authority_id: self.authority_id,
            storage_error: RefCell::new(None),
        }
    }
}

/// One creation-DO storage transaction as the shared creation store. A
/// storage failure is kept so the caller aborts the transaction instead of
/// committing a partial write.
#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
struct OwnedDurableObjectTransactionStoreV1 {
    transaction: worker::Transaction,
    env: worker::Env,
    authority_object_id: String,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    storage_error: RefCell<Option<String>>,
}

#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
impl OwnedDurableObjectTransactionStoreV1 {
    fn record_storage_error(&self, error: worker::Error) -> RouterAbProtocolError {
        let message = error.to_string();
        self.storage_error.borrow_mut().get_or_insert(message.clone());
        durable_storage_protocol_error(worker::Error::RustError(message))
    }

    fn take_storage_error(&self) -> Option<worker::Error> {
        self.storage_error.borrow_mut().take().map(worker::Error::RustError)
    }
}

#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
impl TenantRootCreationStoreV1 for OwnedDurableObjectTransactionStoreV1 {
    fn authority_id(&self) -> TenantRootControlPlaneAuthorityIdV1 {
        self.authority_id
    }

    fn require_scope(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<()> {
        require_tenant_root_creation_authority_object_v1(
            &self.env,
            &self.authority_object_id,
            identity_digest,
            custody_lineage,
        )
    }

    async fn get_json<T: DeserializeOwned>(&self, key: &str) -> RouterAbProtocolResult<Option<T>> {
        transaction_get_optional::<T>(&self.transaction, key)
            .await
            .map_err(|error| self.record_storage_error(error))
    }

    async fn put_json<T: Serialize>(&self, key: &str, value: &T) -> RouterAbProtocolResult<()> {
        self.transaction
            .put(key, value)
            .await
            .map_err(|error| self.record_storage_error(error))
    }

    async fn delete(&self, key: &str) -> RouterAbProtocolResult<()> {
        self.transaction
            .delete(key)
            .await
            .map(|_| ())
            .map_err(|error| self.record_storage_error(error))
    }
}

#[cfg(test)]
mod tests;
