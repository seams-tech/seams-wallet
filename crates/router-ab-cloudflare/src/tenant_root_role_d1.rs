mod restore_refresh_record;
pub(crate) use restore_refresh_record::*;

mod bound_share;
pub(crate) use bound_share::RootUseAccess;
pub(crate) mod recovery;
mod sql;
pub use self::sql::*;
mod share_records;
pub use self::share_records::*;
mod d1_wire;
use self::d1_wire::*;
mod cipher;
use self::cipher::*;
mod restore_records;
pub(crate) use self::restore_records::*;
mod commands;
pub use self::commands::*;
mod store_restore;
use self::store_restore::*;
mod store_refresh;
use self::store_refresh::*;
mod store_creation;
use self::store_creation::*;
mod store_reservations;
use self::store_reservations::*;
mod store_execution;
use self::store_execution::*;
mod store_commands;
use self::store_commands::*;
mod row_decoding;
use self::row_decoding::*;
mod validation;
use self::validation::*;

use core::{fmt, future::Future, pin::Pin};

use hpke_ng::Kem;
use router_ab_core::{
    reserve_tenant_root_command_v1, resolve_active_tenant_root_pair_binding_v1,
    resolve_active_tenant_root_role_binding_v1,
    resolve_authoritative_active_tenant_root_pair_binding_v1,
    validate_tenant_root_active_role_share_commitment_v1, ExecutedTenantRootCommandV1,
    MpcPrfShareCommitmentWireV1, ReservedTenantRootCommandV1,
    TenantRootAcceptedPermanentLossAuthorizationDigestV1,
    TenantRootActivationReceiptAvailabilityV1, TenantRootActivationReceiptBindingV1,
    TenantRootActivationReceiptTransitionV1, TenantRootActivePairResolutionV1,
    TenantRootActiveRoleAmbiguityV1, TenantRootActiveRoleBindingV1,
    TenantRootActiveRoleResolutionV1, TenantRootActiveRoleRowKeyV1, TenantRootActiveRootPairV1,
    TenantRootCeremonyEpochsV1, TenantRootCeremonyNonceV1, TenantRootCeremonySessionIdV1,
    TenantRootCommandOperationV1, TenantRootCommandReplayDecisionV1, TenantRootCommandReplayKeyV1,
    TenantRootCommandReplayRecordV1, TenantRootCommandScopeV1, TenantRootCommandTerminalOutcomeV1,
    TenantRootCommandTerminalReceiptV1, TenantRootCustodyBindingV1, TenantRootCustodyLineageId,
    TenantRootEpochCommitmentsV1, TenantRootIdentityDigestV1, TenantRootIdentityV1,
    TenantRootLifecycleReceiptDigestV1, TenantRootManagedRestoreRoleV1,
    TenantRootOnlineRoleShareBindingV1, TenantRootProtocolDigestV1, TenantRootRecoverySetId,
    TenantRootRestoreDestinationFingerprintV1, TenantRootRestoreImportPublicKeyV1,
    TenantRootRestoreSessionIdV1, TenantRootRoleCleanupTargetV1,
    TenantRootRoleInstallationReceiptsV1, TenantRootRoleRefreshCommandV1,
    TenantRootSealedOnlineRoleShareV1, TenantRootShareEpoch,
    TenantRootSignedAcceptedPermanentLossAuthorizationV1, TenantRootSignedActivationReceiptV1,
    TenantRootSignedManagedBackupV1, TenantRootSignedProviderCanaryReceiptV1,
    TenantRootSignedShareInstallationEvidenceV1, TenantRootTenantHeldExternalProvenanceV1,
    TwoPartyDeriverRole,
    VerifiedTenantRootCommandSuccessReceiptV1, VerifiedTenantRootManagedBackupShareV1,
    VerifiedTenantRootManagedBackupV1, VerifiedTenantRootManagedRestoreCapabilityV1,
    VerifiedTenantRootRestoreRefreshRoleCommandV1, VerifiedTenantRootRoleCleanupCommandV1,
    VerifiedTenantRootRoleCreationCommandV1, VerifiedTenantRootRoleRefreshCommandV1,
    VerifiedTenantRootSignedActivationReceiptV1,
    VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1, TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BYTES_V1,
    TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1, TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1,
    TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BYTES_V1,
};
use serde::{ser::SerializeStruct, Deserialize, Serialize, Serializer};
use sha2::{Digest, Sha256};
use threshold_prf::{SigningRootShare, SigningRootShareCommitment, SigningRootShareWire};
#[cfg(feature = "workers-rs")]
use worker::{D1SessionConstraint, Env};

#[cfg(feature = "workers-rs")]
use crate::tenant_root_role_sql::D1RoleSqlSessionV1;
use crate::tenant_root_role_sql::{
    RoleSqlOutcomeV1, RoleSqlSessionV1, RoleSqlStatement, RoleSqlValue, RoleStoreError,
    RoleStoreResult,
};
use zeroize::Zeroize;

use crate::{
    encoding::{decode_base64url_bytes_v1, encode_base64url_bytes_v1},
    env::CloudflareTenantRootCreationRoleSignerV1,
    hpke::{
        parse_cloudflare_hpke_x25519_public_key_v1, CloudflareHpkeGetrandomRngV1,
        CloudflareHpkeKemV1, CloudflareHpkeSuiteV1,
    },
    tenant_root_managed_backup_r2::TenantRootManagedBackupObjectMetadataV1,
};

const ROLE_PRIVATE_D1_BINDING: &str = "DERIVER_ROLE_PRIVATE_DB";
const ROLE_PRIVATE_D1_KEK_BINDING_ENV: &str = "DERIVER_ROLE_PRIVATE_D1_KEK_BINDING";
const ROLE_PRIVATE_D1_KEK_VERSION_ENV: &str = "DERIVER_ROLE_PRIVATE_D1_KEK_VERSION";
const ROLE_PRIVATE_D1_KEK_PUBLIC_KEY_ENV: &str = "DERIVER_ROLE_PRIVATE_D1_KEK_PUBLIC_KEY";
const ROLE_PRIVATE_D1_ENVIRONMENT_ENV: &str = "DERIVER_ROLE_PRIVATE_D1_ENVIRONMENT";
const ROLE_PRIVATE_D1_ROLE_ENV: &str = "DERIVER_ROLE_PRIVATE_D1_ROLE";
const ROLE_PRIVATE_D1_KEK_SECRET_PREFIX: &str = "hpke-x25519-role-private-d1-private-v1:";
const TENANT_ROOT_ROLE_D1_HPKE_INFO: &[u8] = b"seams/tenant-root/role-private-d1/hpke/v1";
const TENANT_ROOT_ROLE_D1_SCHEMA: &str = "tenant-root-role-private-d1/v2";
const TENANT_ROOT_ROLE_D1_PURPOSE: &str = "tenant-root-role-share";
const TENANT_ROOT_RESTORE_IMPORT_KEY_D1_SCHEMA: &str = "tenant-root-restore-import-key/v1";
const TENANT_ROOT_RESTORE_IMPORT_KEY_D1_PURPOSE: &str = "tenant-root-restore-import-key";
const TENANT_ROOT_RESTORE_IMPORT_KEY_D1_HPKE_INFO: &[u8] =
    b"seams/tenant-root/restore-import-key/d1-hpke/v1";
const TENANT_ROOT_RESTORE_IMPORTED_SHARE_D1_SCHEMA: &str = "tenant-root-restore-imported-share/v1";
const TENANT_ROOT_RESTORE_IMPORTED_SHARE_D1_PURPOSE: &str = "tenant-root-restore-imported-share";
const TENANT_ROOT_RESTORE_IMPORTED_SHARE_D1_HPKE_INFO: &[u8] =
    b"seams/tenant-root/restore-imported-share/d1-hpke/v1";
const TENANT_ROOT_RESTORE_REFRESH_SEED_D1_SCHEMA: &str = "tenant-root-restore-refresh-seed/v1";
const TENANT_ROOT_RESTORE_REFRESH_SEED_D1_PURPOSE: &str = "tenant-root-restore-refresh-seed";
const TENANT_ROOT_RESTORE_REFRESH_SEED_D1_HPKE_INFO: &[u8] =
    b"seams/tenant-root/restore-refresh-seed/d1-hpke/v1";
const TENANT_ROOT_RESTORE_REFRESH_SHARE_D1_SCHEMA: &str = "tenant-root-restore-refresh-share/v1";
const TENANT_ROOT_RESTORE_REFRESH_SHARE_D1_PURPOSE: &str = "tenant-root-restore-refresh-share";
const TENANT_ROOT_RESTORE_REFRESH_SHARE_D1_HPKE_INFO: &[u8] =
    b"seams/tenant-root/restore-refresh-share/d1-hpke/v1";
const TENANT_ROOT_RESTORE_PROMOTION_D1_SCHEMA: &str = "tenant-root-restore-promotion/v1";
const TENANT_ROOT_RESTORE_PROMOTION_D1_PURPOSE: &str = "tenant-root-restore-promotion";
const TENANT_ROOT_RESTORE_PROMOTION_D1_HPKE_INFO: &[u8] =
    b"seams/tenant-root/restore-promotion/d1-hpke/v1";
const TENANT_ROOT_RESTORE_SESSION_CLEANUP_RECEIPT_DOMAIN_V1: &[u8] =
    b"seams/tenant-root/restore-session-cleanup-receipt/v1";
const TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES: usize = 32;
const TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES: usize = 32;
const MAX_RESTORE_IMPORT_KEY_ID_BYTES: usize = 128;
const MAX_RESTORE_IMPORT_KEY_CIPHERTEXT_BYTES: usize = 256;
const MAX_RESTORE_IMPORTED_SHARE_CIPHERTEXT_BYTES: usize = 256;
const MAX_RESTORE_REFRESH_SEED_CIPHERTEXT_BYTES: usize = 256;
const MAX_RESTORE_REFRESH_SHARE_CIPHERTEXT_BYTES: usize = 256;
const MAX_RESTORE_PROMOTION_ROLE_CIPHERTEXT_BYTES: usize = 96 * 1024;
const MAX_RESTORE_PROMOTION_TERMINAL_RECEIPT_BYTES: usize = 16 * 1024;
const MAX_SEALED_ROLE_SHARE_BYTES: usize = 64 * 1024;
const MAX_REFRESH_DURABLE_STATE_BYTES: usize = 128 * 1024;
const MAX_REFRESH_PREPARED_MANAGED_BACKUP_BYTES: usize = 72 * 1024;
const MAX_REFRESH_PREPARED_CANARY_BYTES: usize = 16 * 1024;

/// Primary-consistent access to one Deriver's encrypted tenant-root share rows.
pub struct TenantRootRoleShareStoreV1<S: RoleSqlSessionV1> {
    session: S,
    cipher: TenantRootRoleD1CipherV1,
}

/// The role store over the Deriver's role-private D1 database.
#[cfg(feature = "workers-rs")]
pub(crate) type CloudflareTenantRootRoleShareStoreV1 = TenantRootRoleShareStoreV1<D1RoleSqlSessionV1>;

/// Role-local restore input that retains only the verified capability and the
/// pending record metadata. The opened backup share is consumed while the
/// provider-sealed online ciphertext is copied into the encrypted D1 record;
/// plaintext share bytes never enter this type or persistence.
pub(crate) struct CloudflareTenantRootManagedRestoreStagingInputV1 {
    capability: VerifiedTenantRootManagedRestoreCapabilityV1,
    scope: TenantRootCommandScopeV1,
    record: CloudflareTenantRootRoleShareRecordV1,
}

impl fmt::Debug for CloudflareTenantRootManagedRestoreStagingInputV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootManagedRestoreStagingInputV1")
            .field("capability", &self.capability)
            .field("scope", &self.scope)
            .field("record", &self.record)
            .finish()
    }
}

impl CloudflareTenantRootManagedRestoreStagingInputV1 {
    /// Consumes verified restore authorization and opened backup material into
    /// one role-bound, non-active pending record.
    pub(crate) fn from_verified_material(
        capability: VerifiedTenantRootManagedRestoreCapabilityV1,
        restored_share: VerifiedTenantRootManagedBackupShareV1,
        identity: TenantRootIdentityV1,
        sealed_online_share: TenantRootSealedOnlineRoleShareV1,
        scope: TenantRootCommandScopeV1,
        staged_at_ms: u64,
    ) -> RoleStoreResult<Self> {
        let backup_binding = restored_share.binding();
        let sealed_binding = sealed_online_share.binding();
        let identity_digest = identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        let protocol_role = protocol_role_for_managed_restore(backup_binding.role());
        if capability.identity_digest() != identity_digest
            || capability.identity_digest() != backup_binding.identity_digest()
            || capability.custody_lineage() != backup_binding.custody_lineage()
            || capability.role() != backup_binding.role()
            || capability.epoch() != backup_binding.epoch()
        {
            return Err(store_error(
                "tenant-root managed-restore material does not match its capability",
            ));
        }
        if scope.key().identity_digest() != capability.identity_digest()
            || scope.key().custody_lineage() != capability.custody_lineage()
            || scope.key().role() != protocol_role
            || scope.epoch() != capability.epoch()
        {
            return Err(store_error(
                "tenant-root managed-restore command scope does not match its capability",
            ));
        }
        if sealed_binding.identity_digest() != backup_binding.identity_digest()
            || sealed_binding.custody_lineage() != backup_binding.custody_lineage()
            || sealed_binding.role() != protocol_role
            || sealed_binding.epoch() != backup_binding.epoch()
            || sealed_binding.share_commitment() != backup_binding.share_commitment()
            || sealed_binding.installation_evidence_digest()
                != backup_binding.installation_receipt_digest()
        {
            return Err(store_error(
                "tenant-root managed-restore sealed share does not match its opened backup",
            ));
        }
        if staged_at_ms < capability.issued_at_ms() {
            return Err(store_error(
                "tenant-root managed-restore staging predates its capability",
            ));
        }
        let role = match backup_binding.role() {
            TenantRootManagedRestoreRoleV1::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
            TenantRootManagedRestoreRoleV1::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
        };
        let pending = CloudflareTenantRootPendingShareV1::from_managed_restore(
            backup_binding.installation_receipt_digest(),
            capability.capability_digest(),
            restored_share.receipt_digest(),
            staged_at_ms,
        )?;
        let sealed_share =
            CloudflareTenantRootSealedRoleShareV1::new(sealed_online_share.ciphertext())?;
        let record = CloudflareTenantRootRoleShareRecordV1::new(
            CloudflareTenantRootRoleShareRecordInputV1 {
                identity,
                custody_lineage: backup_binding.custody_lineage(),
                epoch: backup_binding.epoch(),
                role,
                sealed_share,
                share_commitment: backup_binding.share_commitment().clone(),
                epoch_wrapping_key_ref: sealed_binding.epoch_wrapping_key_ref().to_owned(),
                lifecycle: CloudflareTenantRootRoleShareLifecycleV1::Pending(pending),
                created_at_ms: staged_at_ms,
                updated_at_ms: staged_at_ms,
            },
        )?;
        validate_managed_restore_staging_record(&record, capability.capability_digest())?;
        Ok(Self {
            capability,
            scope,
            record,
        })
    }
}

/// Executable role-local managed-restore staging insertion.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootManagedRestoreStagingPendingCommandV1 {
    command: CloudflareTenantRootInsertPendingCommandV1,
}

/// Durable decision for one managed-restore staging reservation.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootManagedRestoreStagingDecisionV1 {
    /// The caller owns the newly reserved pending insertion and may execute it once.
    Execute {
        command: CloudflareTenantRootManagedRestoreStagingPendingCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        command: CloudflareTenantRootManagedRestoreStagingPendingCommandV1,
    },
    /// The pending-row mutation is checkpointed and may be terminalized by the caller.
    ResumeCompletion {
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact prior successful receipt bytes.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt bytes.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// The only role-local artifact a managed-restore forward refresh may open.
///
/// The source row remains pending and is consumed by the forward-refresh CAS;
/// callers never receive a generic stored row that could be activated.
#[derive(Debug)]
pub(crate) struct CloudflareTenantRootManagedRestoreForwardRefreshSourceV1 {
    sealed_online_role_share: TenantRootSealedOnlineRoleShareV1,
    capability_digest: TenantRootLifecycleReceiptDigestV1,
    backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
}

impl CloudflareTenantRootManagedRestoreForwardRefreshSourceV1 {
    /// Consumes this verified source into the provider-openable sealed artifact.
    pub(crate) fn into_online_role_share_artifact(self) -> TenantRootSealedOnlineRoleShareV1 {
        self.sealed_online_role_share
    }

    pub(crate) const fn capability_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.capability_digest
    }

    pub(crate) const fn backup_receipt_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.backup_receipt_digest
    }

    pub(crate) const fn installation_receipt_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.installation_receipt_digest
    }
}

/// Exact provenance retained by a managed-restore pending row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootManagedRestoreForwardRefreshProvenanceV1 {
    capability_digest: TenantRootLifecycleReceiptDigestV1,
    backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
}

impl CloudflareTenantRootManagedRestoreForwardRefreshProvenanceV1 {
    pub(crate) const fn capability_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.capability_digest
    }

    pub(crate) const fn backup_receipt_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.backup_receipt_digest
    }

    pub(crate) const fn installation_receipt_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.installation_receipt_digest
    }
}

/// Executable managed-restore forward-refresh command.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootManagedRestoreForwardRefreshCommandV1 {
    scope: TenantRootCommandScopeV1,
    reservation: ReservedTenantRootCommandV1,
    restored_pending: CloudflareStoredTenantRootRoleShareV1,
    refresh_pending: CloudflareStoredTenantRootRoleShareV1,
    activation: CloudflareTenantRootActivationV1,
    capability_digest: TenantRootLifecycleReceiptDigestV1,
    backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    updated_at_ms: u64,
    expected_restored_revision: i64,
    expected_refresh_revision: i64,
    operation_payload_digest: TenantRootProtocolDigestV1,
}

/// Durable decision for one managed-restore forward-refresh reservation.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1 {
    /// The caller owns the newly reserved command and may execute it once.
    Execute {
        command: CloudflareTenantRootManagedRestoreForwardRefreshCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        command: CloudflareTenantRootManagedRestoreForwardRefreshCommandV1,
    },
    /// Both lifecycle mutations are durably checkpointed and may be terminalized.
    ResumeCompletion {
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact prior successful receipt.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// The role-local record key a store seals with. On Cloudflare these come
/// from the Deriver's vars; the private key stays in its Secret binding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRoleStoreKeyConfigV1 {
    pub environment: String,
    pub role: String,
    pub key_version: String,
    pub public_key: String,
}

impl<S: RoleSqlSessionV1> TenantRootRoleShareStoreV1<S> {

    /// A store over any role-private SQL session, sealing with this role's
    /// record key.
    pub fn new(
        session: S,
        config: TenantRootRoleStoreKeyConfigV1,
        encoded_private_key: &str,
    ) -> RoleStoreResult<Self> {
        Ok(Self {
            session,
            cipher: TenantRootRoleD1CipherV1::from_config(config, encoded_private_key)?,
        })
    }
}

#[cfg(feature = "workers-rs")]
impl CloudflareTenantRootRoleShareStoreV1 {
    /// Resolves the private D1 binding and role-local record cipher per request.
    pub(crate) fn from_env(env: &Env) -> RoleStoreResult<Self> {
        let database = env.d1(ROLE_PRIVATE_D1_BINDING).map_err(|error| {
            store_error(format!(
                "role-private D1 binding {ROLE_PRIVATE_D1_BINDING} is unavailable: {error}"
            ))
        })?;
        let session = database
            .with_session_constraint(D1SessionConstraint::FirstPrimary)
            .map_err(|error| {
                store_error(format!(
                    "tenant-root role-private primary session could not be created: {error}"
                ))
            })?;
        Ok(Self {
            session: D1RoleSqlSessionV1::new(session),
            cipher: TenantRootRoleD1CipherV1::from_env_reader(&crate::CloudflareWorkerEnvReaderV1::new(
                env,
            ))?,
        })
    }
}

#[cfg(test)]
mod tests;

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(feature = "postgres", not(target_arch = "wasm32")),
    all(test, feature = "workers-rs")
))]
pub(crate) mod source_retirement;
