#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
pub(crate) mod recovery;

use core::{fmt, future::Future, pin::Pin};

#[cfg(debug_assertions)]
use ed25519_dalek::SigningKey;
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
    TwoPartyDeriverRole, VerifiedTenantRootCommandFailureReceiptV1,
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
use worker::{D1DatabaseSession, D1SessionConstraint, D1Type, Env};
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
const INTEGRATION_EPOCH_ONE_DERIVER_A_POINT_V1: [u8; 32] = [
    0xe4, 0x54, 0x9e, 0xe1, 0x6b, 0x9a, 0xa0, 0x30, 0x99, 0xca, 0x20, 0x8c, 0x67, 0xad, 0xaf, 0xca,
    0xfa, 0x4c, 0x3f, 0x3e, 0x4e, 0x53, 0x03, 0xde, 0x60, 0x26, 0xe3, 0xca, 0x8f, 0xf8, 0x44, 0x60,
];
const INTEGRATION_EPOCH_ONE_DERIVER_B_POINT_V1: [u8; 32] = [
    0x4c, 0xf1, 0xb9, 0xde, 0xda, 0x93, 0xeb, 0x9f, 0xd5, 0x15, 0xfc, 0xc9, 0x92, 0x62, 0xae, 0xd1,
    0x36, 0x8b, 0x48, 0xf2, 0x4a, 0x27, 0xaf, 0xd2, 0x98, 0x4d, 0xa8, 0xfe, 0x7b, 0xb2, 0x34, 0x1f,
];
const INTEGRATION_EPOCH_TWO_DERIVER_A_POINT_V1: [u8; 32] = [
    0x68, 0x28, 0x02, 0xb3, 0xc9, 0x01, 0x12, 0xe0, 0xf4, 0xe7, 0xd9, 0x85, 0xe4, 0x23, 0xcd, 0x2b,
    0x16, 0xc5, 0xbf, 0xa6, 0x3d, 0x9c, 0x96, 0x7c, 0x52, 0xbb, 0x6c, 0xb7, 0xfe, 0xa7, 0xea, 0x7e,
];
const INTEGRATION_EPOCH_TWO_DERIVER_B_POINT_V1: [u8; 32] = [
    0x28, 0x09, 0xbe, 0x5a, 0x1c, 0x38, 0x8c, 0x4c, 0x00, 0x70, 0xa5, 0xc6, 0x6a, 0xce, 0x50, 0x7f,
    0xea, 0xde, 0x48, 0x82, 0x85, 0x90, 0x31, 0x46, 0x74, 0xcb, 0x0a, 0x6f, 0xd9, 0x71, 0xe9, 0x03,
];

const LOAD_EPOCH_SQL: &str = "SELECT tenant_identity_digest_hex, custody_lineage_b64u, \
    tenant_root_share_epoch, role, lifecycle, ciphertext_json, revision, created_at_ms, \
    updated_at_ms FROM tenant_root_role_shares WHERE tenant_identity_digest_hex = ?1 \
    AND custody_lineage_b64u = ?2 AND tenant_root_share_epoch = ?3 AND role = ?4";
const LOAD_ACTIVE_SQL: &str = "SELECT tenant_identity_digest_hex, custody_lineage_b64u, \
    tenant_root_share_epoch, role, lifecycle, ciphertext_json, revision, created_at_ms, \
    updated_at_ms FROM tenant_root_role_shares WHERE tenant_identity_digest_hex = ?1 \
    AND lifecycle = 'active'";
const INSERT_SQL: &str = "INSERT INTO tenant_root_role_shares \
    (tenant_identity_digest_hex, custody_lineage_b64u, tenant_root_share_epoch, role, \
    lifecycle, ciphertext_json, revision, created_at_ms, updated_at_ms) \
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8) \
    ON CONFLICT(tenant_identity_digest_hex, custody_lineage_b64u, \
    tenant_root_share_epoch, role) DO NOTHING";
const ACTIVATE_INITIAL_PENDING_SQL: &str = "UPDATE tenant_root_role_shares SET \
    lifecycle = 'active', ciphertext_json = ?1, revision = revision + 1, updated_at_ms = ?2 \
    WHERE tenant_identity_digest_hex = ?3 AND custody_lineage_b64u = ?4 \
    AND tenant_root_share_epoch = ?5 AND CAST(?5 AS INTEGER) = 1 \
    AND role = ?6 AND lifecycle = 'pending' \
    AND revision = ?7 AND NOT EXISTS (SELECT 1 FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = ?3 AND role = ?6 AND lifecycle = 'active')";
const SWAP_ACTIVE_EPOCH_SQL: &str = "UPDATE tenant_root_role_shares SET \
    lifecycle = CASE WHEN tenant_root_share_epoch = ?3 THEN 'retired' ELSE 'active' END, \
    ciphertext_json = CASE WHEN tenant_root_share_epoch = ?3 THEN ?8 ELSE ?9 END, \
    revision = revision + 1, updated_at_ms = ?10 \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 AND role = ?4 \
    AND CAST(?6 AS INTEGER) = CAST(?3 AS INTEGER) + 1 \
    AND ((tenant_root_share_epoch = ?3 AND lifecycle = 'active' AND revision = ?5 \
    AND EXISTS (SELECT 1 FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
    AND tenant_root_share_epoch = ?6 AND role = ?4 AND lifecycle = 'pending' \
    AND revision = ?7)) OR (tenant_root_share_epoch = ?6 AND lifecycle = 'pending' \
    AND revision = ?7 AND EXISTS (SELECT 1 FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
    AND tenant_root_share_epoch = ?3 AND role = ?4 AND lifecycle = 'active' \
    AND revision = ?5)))";
const DELETE_MANAGED_RESTORE_FORWARD_REFRESH_PENDING_SQL: &str =
    "DELETE FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
    AND tenant_root_share_epoch = ?3 AND role = ?4 AND lifecycle = 'pending' \
    AND revision = ?5";
const ACTIVATE_MANAGED_RESTORE_FORWARD_REFRESH_PENDING_SQL: &str =
    "UPDATE tenant_root_role_shares SET \
    lifecycle = 'active', ciphertext_json = ?1, revision = revision + 1, updated_at_ms = ?2 \
    WHERE tenant_identity_digest_hex = ?3 AND custody_lineage_b64u = ?4 \
    AND tenant_root_share_epoch = ?5 AND role = ?6 AND lifecycle = 'pending' \
    AND revision = ?7 AND CAST(?5 AS INTEGER) = CAST(?8 AS INTEGER) + 1 \
    AND NOT EXISTS (SELECT 1 FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = ?3 AND custody_lineage_b64u = ?4 \
    AND tenant_root_share_epoch = ?8 AND role = ?6)";
const CLEANUP_PENDING_SQL: &str = "DELETE FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
    AND tenant_root_share_epoch = ?3 AND role = ?4 AND lifecycle = 'pending' \
    AND revision = ?5";
const CLEANUP_RETIRED_SQL: &str = "DELETE FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
    AND tenant_root_share_epoch = ?3 AND role = ?4 AND lifecycle = 'retired' \
    AND revision = ?5 AND EXISTS (SELECT 1 FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
    AND tenant_root_share_epoch = ?6 AND role = ?4 AND lifecycle = 'active' \
    AND revision = ?7)";
const LOAD_COMMAND_REPLAY_SQL: &str = "SELECT replay_key_digest_hex, \
    tenant_identity_digest_hex, custody_lineage_b64u, session_id_hex, nonce_hex, role, \
    command_digest_hex, admission_digest_hex, status, receipt_b64u, \
    receipt_digest_hex, reserved_at_ms, executed_at_ms, terminal_at_ms, \
    refresh_state_b64u, refresh_state_digest_hex \
    FROM tenant_root_command_replays WHERE replay_key_digest_hex = ?1 \
    AND role = ?2";
const INSERT_COMMAND_RESERVATION_SQL: &str = "INSERT INTO tenant_root_command_replays \
    (replay_key_digest_hex, tenant_identity_digest_hex, custody_lineage_b64u, \
    session_id_hex, nonce_hex, role, command_digest_hex, admission_digest_hex, \
    status, reserved_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'reserved', ?9) \
    ON CONFLICT(replay_key_digest_hex) DO NOTHING";
const INSERT_REFRESH_ADMISSION_SQL: &str = "INSERT INTO tenant_root_command_replays \
    (replay_key_digest_hex, tenant_identity_digest_hex, custody_lineage_b64u, \
    session_id_hex, nonce_hex, role, command_digest_hex, admission_digest_hex, \
    status, reserved_at_ms, refresh_state_b64u, refresh_state_digest_hex) \
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'reserved', ?9, ?10, ?11) \
    ON CONFLICT(replay_key_digest_hex) DO NOTHING";
const MARK_REFRESH_EXECUTED_SQL: &str = "UPDATE tenant_root_command_replays SET \
    status = 'executed', command_digest_hex = ?7, executed_at_ms = ?8, \
    refresh_state_b64u = ?9, refresh_state_digest_hex = ?10 \
    WHERE replay_key_digest_hex = ?1 AND tenant_identity_digest_hex = ?2 \
    AND custody_lineage_b64u = ?3 AND session_id_hex = ?4 AND nonce_hex = ?5 \
    AND role = ?6 AND command_digest_hex = ?11 AND admission_digest_hex = ?12 \
    AND reserved_at_ms = ?13 AND status = 'reserved' \
    AND refresh_state_b64u = ?14 AND refresh_state_digest_hex = ?15";
const ATTACH_REFRESH_ARTIFACTS_SQL: &str = "UPDATE tenant_root_command_replays SET \
    refresh_state_b64u = ?1, refresh_state_digest_hex = ?2 \
    WHERE replay_key_digest_hex = ?3 AND tenant_identity_digest_hex = ?4 \
    AND custody_lineage_b64u = ?5 AND session_id_hex = ?6 AND nonce_hex = ?7 \
    AND role = ?8 AND command_digest_hex = ?9 AND admission_digest_hex = ?10 \
    AND reserved_at_ms = ?11 AND executed_at_ms = ?12 AND status = 'executed' \
    AND refresh_state_b64u = ?13 AND refresh_state_digest_hex = ?14";
const COMMIT_REFRESH_TERMINAL_SQL: &str = "UPDATE tenant_root_command_replays SET \
    status = 'completed', receipt_b64u = ?1, receipt_digest_hex = ?2, terminal_at_ms = ?3 \
    WHERE replay_key_digest_hex = ?4 AND tenant_identity_digest_hex = ?5 \
    AND custody_lineage_b64u = ?6 AND session_id_hex = ?7 AND nonce_hex = ?8 \
    AND role = ?9 AND command_digest_hex = ?10 AND admission_digest_hex = ?11 \
    AND reserved_at_ms = ?12 AND executed_at_ms = ?13 AND status = 'executed' \
    AND refresh_state_b64u = ?14 AND refresh_state_digest_hex = ?15";
const MARK_COMMAND_EXECUTED_SQL: &str = "UPDATE tenant_root_command_replays SET \
    status = 'executed', executed_at_ms = ?9 \
    WHERE replay_key_digest_hex = ?1 AND tenant_identity_digest_hex = ?2 \
    AND custody_lineage_b64u = ?3 AND session_id_hex = ?4 AND nonce_hex = ?5 \
    AND role = ?6 AND command_digest_hex = ?7 AND reserved_at_ms = ?8 \
    AND status = 'reserved'";
const CAS_COUNT_GUARD_SQL: &str = "INSERT INTO tenant_root_command_cas_guard (guard_id) \
    SELECT 1 WHERE changes() <> CAST(?1 AS INTEGER)";
const COMMIT_COMMAND_TERMINAL_SQL: &str = "UPDATE tenant_root_command_replays SET \
    status = ?1, receipt_b64u = ?2, receipt_digest_hex = ?3, terminal_at_ms = ?4 \
    WHERE replay_key_digest_hex = ?5 AND tenant_identity_digest_hex = ?6 \
    AND custody_lineage_b64u = ?7 AND session_id_hex = ?8 AND nonce_hex = ?9 \
    AND role = ?10 AND command_digest_hex = ?11 AND reserved_at_ms = ?12 \
    AND status = ?13 AND (status = 'reserved' OR executed_at_ms = ?14)";
const LOAD_RESTORE_IMPORT_KEY_BY_REPLAY_SQL: &str = "SELECT \
    tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, role, generation, \
    import_key_id, replay_key_digest_hex, command_digest_hex, operation_digest_hex, recovery_set_id_b64u, \
    manifest_digest_hex, stable_root_commitment_b64u, share_commitment_b64u, \
    destination_fingerprint_hex, public_key_b64u, encrypted_ikm_json, envelope_digest_hex, \
    encrypted_imported_share_json, issued_at_ms, expires_at_ms, lifecycle, installed_at_ms, \
    receipt_digest_hex, created_at_ms, updated_at_ms \
    FROM tenant_root_restore_import_keys WHERE replay_key_digest_hex = ?1";
const LOAD_RESTORE_IMPORT_KEY_CURRENT_SQL: &str = "SELECT \
    tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, role, generation, \
    import_key_id, replay_key_digest_hex, command_digest_hex, operation_digest_hex, recovery_set_id_b64u, \
    manifest_digest_hex, stable_root_commitment_b64u, share_commitment_b64u, \
    destination_fingerprint_hex, public_key_b64u, encrypted_ikm_json, envelope_digest_hex, \
    encrypted_imported_share_json, issued_at_ms, expires_at_ms, lifecycle, installed_at_ms, \
    receipt_digest_hex, created_at_ms, updated_at_ms \
    FROM tenant_root_restore_import_keys WHERE tenant_identity_digest_hex = ?1 \
    AND custody_lineage_b64u = ?2 AND restore_session_id_hex = ?3 AND role = ?4 \
    ORDER BY generation DESC LIMIT 1";
const LOAD_RESTORE_IMPORT_SESSION_TOMBSTONE_SQL: &str = "SELECT closed_at_ms, role, \
    activation_operation, activation_receipt_b64u, activation_receipt_digest_hex, \
    cleanup_receipt_b64u, cleanup_receipt_digest_hex \
    FROM tenant_root_restore_import_sessions WHERE tenant_identity_digest_hex = ?1 \
    AND custody_lineage_b64u = ?2 AND restore_session_id_hex = ?3";
const LOAD_RESTORE_IMPORT_SESSION_CLOSED_SQL: &str = "SELECT closed_at_ms \
    FROM tenant_root_restore_import_sessions WHERE tenant_identity_digest_hex = ?1 \
    AND custody_lineage_b64u = ?2 AND restore_session_id_hex = ?3";
const INSERT_RESTORE_IMPORT_KEY_SQL: &str = "INSERT INTO tenant_root_restore_import_keys (\
    tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, role, generation, \
    import_key_id, replay_key_digest_hex, command_digest_hex, operation_digest_hex, recovery_set_id_b64u, \
    manifest_digest_hex, stable_root_commitment_b64u, share_commitment_b64u, \
    destination_fingerprint_hex, public_key_b64u, encrypted_ikm_json, issued_at_ms, \
    expires_at_ms, lifecycle, created_at_ms, updated_at_ms) SELECT \
    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, \
    'issued', ?17, ?17 WHERE NOT EXISTS (SELECT 1 FROM tenant_root_restore_import_sessions \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
    AND restore_session_id_hex = ?3) ON CONFLICT(replay_key_digest_hex) DO NOTHING";
const SUPERSEDE_RESTORE_IMPORT_KEY_SQL: &str = "UPDATE tenant_root_restore_import_keys \
    SET lifecycle = 'superseded', updated_at_ms = ?6 WHERE tenant_identity_digest_hex = ?1 \
    AND custody_lineage_b64u = ?2 AND restore_session_id_hex = ?3 AND role = ?4 \
    AND generation = ?5 AND lifecycle IN ('issued', 'expired')";
const INSERT_RESTORE_IMPORT_SESSION_TOMBSTONE_SQL: &str = "INSERT INTO \
    tenant_root_restore_import_sessions (tenant_identity_digest_hex, custody_lineage_b64u, \
    restore_session_id_hex, closed_at_ms, role, activation_operation, \
    activation_receipt_b64u, activation_receipt_digest_hex, cleanup_receipt_b64u, \
    cleanup_receipt_digest_hex) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
    ON CONFLICT DO NOTHING";
const CLOSE_RESTORE_IMPORT_KEYS_SQL: &str = "UPDATE tenant_root_restore_import_keys SET \
    lifecycle = 'closed', encrypted_ikm_json = NULL, installed_at_ms = NULL, \
    envelope_digest_hex = NULL, encrypted_imported_share_json = NULL, receipt_digest_hex = NULL, \
    updated_at_ms = ?4 \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
    AND restore_session_id_hex = ?3 AND role = ?5 AND lifecycle <> 'closed'";
const ACCEPT_RESTORE_IMPORT_KEY_SQL: &str = "UPDATE tenant_root_restore_import_keys SET \
    lifecycle = 'installed', envelope_digest_hex = ?1, encrypted_imported_share_json = ?2, \
    installed_at_ms = ?3, receipt_digest_hex = ?4, updated_at_ms = ?5 \
    WHERE tenant_identity_digest_hex = ?6 AND custody_lineage_b64u = ?7 \
    AND restore_session_id_hex = ?8 AND role = ?9 AND generation = ?10 \
    AND import_key_id = ?11 AND replay_key_digest_hex = ?12 \
    AND command_digest_hex = ?13 AND operation_digest_hex = ?14 \
    AND lifecycle = 'issued' AND encrypted_ikm_json IS NOT NULL \
    AND CAST(?5 AS INTEGER) < expires_at_ms \
    AND NOT EXISTS (SELECT 1 FROM tenant_root_restore_import_sessions \
        WHERE tenant_identity_digest_hex = ?6 AND custody_lineage_b64u = ?7 \
        AND restore_session_id_hex = ?8)";
const LOAD_RESTORE_REFRESH_ATTEMPT_SQL: &str = "SELECT \
    tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, role, generation, \
    import_key_id, import_replay_key_digest_hex, import_command_digest_hex, \
    import_operation_digest_hex, recovery_set_id_b64u, manifest_digest_hex, \
    stable_root_commitment_b64u, share_commitment_b64u, destination_fingerprint_hex, \
    import_public_key_b64u, import_issued_at_ms, import_expires_at_ms, \
    refresh_command_digest_hex, refresh_issued_at_ms, refresh_expires_at_ms, \
    admitted_at_ms, encrypted_seed_json, \
    encrypted_refreshed_share_json, installation_evidence_b64u, \
    installation_evidence_digest_hex, lifecycle, refreshed_at_ms, created_at_ms, updated_at_ms \
    , promotion_lifecycle, promotion_reserved_at_ms, encrypted_online_role_share_json, \
    provider_canary_receipt_b64u, promotion_completed_at_ms \
    FROM tenant_root_restore_refresh_attempts \
    WHERE import_replay_key_digest_hex = ?1";
const LOAD_RESTORE_REFRESH_ATTEMPT_BY_COMMAND_SQL: &str = "SELECT \
    tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, role, generation, \
    import_key_id, import_replay_key_digest_hex, import_command_digest_hex, \
    import_operation_digest_hex, recovery_set_id_b64u, manifest_digest_hex, \
    stable_root_commitment_b64u, share_commitment_b64u, destination_fingerprint_hex, \
    import_public_key_b64u, import_issued_at_ms, import_expires_at_ms, \
    refresh_command_digest_hex, refresh_issued_at_ms, refresh_expires_at_ms, \
    admitted_at_ms, encrypted_seed_json, \
    encrypted_refreshed_share_json, installation_evidence_b64u, \
    installation_evidence_digest_hex, lifecycle, refreshed_at_ms, created_at_ms, updated_at_ms, \
    promotion_lifecycle, promotion_reserved_at_ms, encrypted_online_role_share_json, \
    provider_canary_receipt_b64u, promotion_completed_at_ms \
    FROM tenant_root_restore_refresh_attempts \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
      AND restore_session_id_hex = ?3 AND role = ?4 AND refresh_command_digest_hex = ?5";
const INSERT_RESTORE_REFRESH_ATTEMPT_SQL: &str = "INSERT INTO \
    tenant_root_restore_refresh_attempts (tenant_identity_digest_hex, custody_lineage_b64u, \
    restore_session_id_hex, role, generation, import_key_id, import_replay_key_digest_hex, \
    import_command_digest_hex, import_operation_digest_hex, recovery_set_id_b64u, \
    manifest_digest_hex, stable_root_commitment_b64u, share_commitment_b64u, \
    destination_fingerprint_hex, import_public_key_b64u, import_issued_at_ms, \
    import_expires_at_ms, refresh_command_digest_hex, refresh_issued_at_ms, \
    refresh_expires_at_ms, admitted_at_ms, encrypted_seed_json, lifecycle, \
    created_at_ms, updated_at_ms) SELECT \
    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, \
    ?17, ?18, ?19, ?20, ?21, ?22, 'pending', ?21, ?21 \
    WHERE NOT EXISTS (SELECT 1 FROM tenant_root_restore_import_sessions \
      WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
        AND restore_session_id_hex = ?3) \
    ON CONFLICT(import_replay_key_digest_hex) DO NOTHING";
const FINALIZE_RESTORE_REFRESH_ATTEMPT_SQL: &str = "UPDATE \
    tenant_root_restore_refresh_attempts SET lifecycle = 'refreshed', \
    encrypted_refreshed_share_json = ?1, \
    installation_evidence_b64u = ?2, installation_evidence_digest_hex = ?3, \
    refreshed_at_ms = ?4, updated_at_ms = ?4 \
    WHERE tenant_identity_digest_hex = ?5 AND custody_lineage_b64u = ?6 \
      AND restore_session_id_hex = ?7 AND role = ?8 AND generation = ?9 \
      AND import_key_id = ?10 AND import_replay_key_digest_hex = ?11 \
      AND import_command_digest_hex = ?12 AND refresh_command_digest_hex = ?13 \
      AND refresh_issued_at_ms = ?14 AND refresh_expires_at_ms = ?15 \
      AND lifecycle = 'pending' AND NOT EXISTS (SELECT 1 \
        FROM tenant_root_restore_import_sessions \
        WHERE tenant_identity_digest_hex = ?5 AND custody_lineage_b64u = ?6 \
          AND restore_session_id_hex = ?7)";
const CLOSE_RESTORE_REFRESH_ATTEMPTS_SQL: &str = "UPDATE \
    tenant_root_restore_refresh_attempts SET lifecycle = 'closed', \
    encrypted_seed_json = NULL, encrypted_refreshed_share_json = NULL, \
    installation_evidence_b64u = NULL, installation_evidence_digest_hex = NULL, \
    refreshed_at_ms = NULL, promotion_lifecycle = 'unstarted', \
    promotion_reserved_at_ms = NULL, encrypted_online_role_share_json = NULL, \
    provider_canary_receipt_b64u = NULL, promotion_completed_at_ms = NULL, updated_at_ms = ?4 \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
      AND restore_session_id_hex = ?3 AND role = ?5 AND lifecycle <> 'closed'";
const RESERVE_RESTORE_REFRESH_PROMOTION_SQL: &str = "UPDATE \
    tenant_root_restore_refresh_attempts SET promotion_lifecycle = 'reserved', \
    promotion_reserved_at_ms = ?6, updated_at_ms = ?6 \
    WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
      AND restore_session_id_hex = ?3 AND role = ?4 AND refresh_command_digest_hex = ?5 \
      AND lifecycle = 'refreshed' AND promotion_lifecycle = 'unstarted' \
      AND promotion_reserved_at_ms IS NULL AND encrypted_online_role_share_json IS NULL \
      AND provider_canary_receipt_b64u IS NULL AND promotion_completed_at_ms IS NULL \
      AND NOT EXISTS (SELECT 1 FROM tenant_root_restore_import_sessions \
        WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
          AND restore_session_id_hex = ?3)";
const COMPLETE_RESTORE_REFRESH_PROMOTION_SQL: &str = "UPDATE \
    tenant_root_restore_refresh_attempts SET encrypted_online_role_share_json = ?1, \
    provider_canary_receipt_b64u = ?2, promotion_completed_at_ms = ?3, \
    promotion_lifecycle = 'completed', updated_at_ms = ?3 \
    WHERE tenant_identity_digest_hex = ?4 AND custody_lineage_b64u = ?5 \
      AND restore_session_id_hex = ?6 AND role = ?7 AND refresh_command_digest_hex = ?8 \
      AND lifecycle = 'refreshed' AND promotion_lifecycle = 'reserved' \
      AND promotion_reserved_at_ms = ?9 AND encrypted_online_role_share_json IS NULL \
      AND provider_canary_receipt_b64u IS NULL AND promotion_completed_at_ms IS NULL";

/// Exact role owning one private tenant-root share store.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudflareTenantRootDeriverRoleV1 {
    /// Deriver A owns threshold share identifier one.
    DeriverA,
    /// Deriver B owns threshold share identifier two.
    DeriverB,
}

impl CloudflareTenantRootDeriverRoleV1 {
    fn parse(value: &str) -> worker::Result<Self> {
        match value {
            "deriver_a" => Ok(Self::DeriverA),
            "deriver_b" => Ok(Self::DeriverB),
            _ => Err(store_error(
                "DERIVER_ROLE_PRIVATE_D1_ROLE must be deriver_a or deriver_b",
            )),
        }
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::DeriverA => "deriver_a",
            Self::DeriverB => "deriver_b",
        }
    }

    const fn share_id(self) -> u16 {
        match self {
            Self::DeriverA => 1,
            Self::DeriverB => 2,
        }
    }

    const fn managed_restore_role(self) -> TenantRootManagedRestoreRoleV1 {
        match self {
            Self::DeriverA => TenantRootManagedRestoreRoleV1::DeriverA,
            Self::DeriverB => TenantRootManagedRestoreRoleV1::DeriverB,
        }
    }
}

/// Ciphertext returned by the role's epoch wrapping-key provider.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootSealedRoleShareV1 {
    ciphertext_b64u: String,
    ciphertext_digest_hex: String,
}

impl CloudflareTenantRootSealedRoleShareV1 {
    /// Normalizes one non-empty bounded ciphertext and commits its exact bytes.
    pub fn new(ciphertext: &[u8]) -> worker::Result<Self> {
        if ciphertext.is_empty() || ciphertext.len() > MAX_SEALED_ROLE_SHARE_BYTES {
            return Err(store_error(
                "tenant-root sealed role share has an invalid ciphertext length",
            ));
        }
        Ok(Self {
            ciphertext_b64u: encode_base64url_bytes_v1(ciphertext),
            ciphertext_digest_hex: encode_hex(Sha256::digest(ciphertext).as_ref()),
        })
    }

    /// Returns the canonical unpadded base64url ciphertext.
    pub fn ciphertext_b64u(&self) -> &str {
        &self.ciphertext_b64u
    }

    /// Returns the public digest of the exact sealed ciphertext.
    pub fn ciphertext_digest_hex(&self) -> &str {
        &self.ciphertext_digest_hex
    }

    fn validate(&self) -> worker::Result<()> {
        let ciphertext =
            decode_base64url_bytes_v1("tenant-root sealed role share", &self.ciphertext_b64u)
                .map_err(|error| store_error(error.message()))?;
        if ciphertext.is_empty()
            || ciphertext.len() > MAX_SEALED_ROLE_SHARE_BYTES
            || encode_base64url_bytes_v1(&ciphertext) != self.ciphertext_b64u
            || encode_hex(Sha256::digest(&ciphertext).as_ref()) != self.ciphertext_digest_hex
        {
            return Err(store_error("tenant-root sealed role share is malformed"));
        }
        require_digest_hex(
            "tenant-root sealed role share digest",
            &self.ciphertext_digest_hex,
        )
    }
}

impl fmt::Debug for CloudflareTenantRootSealedRoleShareV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootSealedRoleShareV1")
            .field("ciphertext", &"[redacted]")
            .field("ciphertext_digest_hex", &self.ciphertext_digest_hex)
            .finish()
    }
}

/// Provenance of a pending role-local tenant-root share.
///
/// Restore material remains a pending input until the mandatory forward
/// refresh replaces it. Keeping that provenance in the encrypted record lets
/// every activation boundary reject a direct restore-to-active transition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum CloudflareTenantRootPendingShareOriginV1 {
    Ceremony,
    Refresh {
        replay_key_digest: TenantRootProtocolDigestV1,
    },
    ManagedRestore {
        capability_digest: TenantRootLifecycleReceiptDigestV1,
        backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    },
}

/// Pending role-local tenant-root installation evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootPendingShareV1 {
    installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
    staged_at_ms: u64,
    origin: CloudflareTenantRootPendingShareOriginV1,
}

impl CloudflareTenantRootPendingShareV1 {
    /// Creates one pending branch from exact verified installation evidence bytes.
    pub fn from_verified_installation_evidence(
        evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        staged_at_ms: u64,
    ) -> worker::Result<Self> {
        let installation_evidence_digest = evidence
            .lifecycle_receipt_digest()
            .map_err(|error| store_error(error.message()))?;
        Self::from_stored_digest(installation_evidence_digest, staged_at_ms)
    }

    fn from_verified_refresh_installation_evidence(
        evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        staged_at_ms: u64,
        replay_key_digest: TenantRootProtocolDigestV1,
    ) -> worker::Result<Self> {
        let installation_evidence_digest = evidence
            .lifecycle_receipt_digest()
            .map_err(|error| store_error(error.message()))?;
        Self::from_stored_digest_with_origin(
            installation_evidence_digest,
            staged_at_ms,
            CloudflareTenantRootPendingShareOriginV1::Refresh { replay_key_digest },
        )
    }

    fn from_stored_digest(
        installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
        staged_at_ms: u64,
    ) -> worker::Result<Self> {
        Self::from_stored_digest_with_origin(
            installation_evidence_digest,
            staged_at_ms,
            CloudflareTenantRootPendingShareOriginV1::Ceremony,
        )
    }

    fn from_managed_restore(
        installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
        capability_digest: TenantRootLifecycleReceiptDigestV1,
        backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        staged_at_ms: u64,
    ) -> worker::Result<Self> {
        Self::from_stored_digest_with_origin(
            installation_evidence_digest,
            staged_at_ms,
            CloudflareTenantRootPendingShareOriginV1::ManagedRestore {
                capability_digest,
                backup_receipt_digest,
            },
        )
    }

    fn from_stored_digest_with_origin(
        installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
        staged_at_ms: u64,
        origin: CloudflareTenantRootPendingShareOriginV1,
    ) -> worker::Result<Self> {
        let pending = Self {
            installation_evidence_digest,
            staged_at_ms,
            origin,
        };
        pending.validate()?;
        Ok(pending)
    }

    fn validate(&self) -> worker::Result<()> {
        require_timestamp("tenant-root staged timestamp", self.staged_at_ms)
    }

    pub const fn installation_evidence_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.installation_evidence_digest
    }

    fn is_managed_restore(&self) -> bool {
        matches!(
            &self.origin,
            CloudflareTenantRootPendingShareOriginV1::ManagedRestore { .. }
        )
    }

    fn managed_restore_digests(
        &self,
    ) -> Option<(
        TenantRootLifecycleReceiptDigestV1,
        TenantRootLifecycleReceiptDigestV1,
    )> {
        match &self.origin {
            CloudflareTenantRootPendingShareOriginV1::Ceremony => None,
            CloudflareTenantRootPendingShareOriginV1::Refresh { .. } => None,
            CloudflareTenantRootPendingShareOriginV1::ManagedRestore {
                capability_digest,
                backup_receipt_digest,
            } => Some((*capability_digest, *backup_receipt_digest)),
        }
    }

    fn refresh_replay_key_digest(&self) -> Option<TenantRootProtocolDigestV1> {
        match &self.origin {
            CloudflareTenantRootPendingShareOriginV1::Refresh { replay_key_digest } => {
                Some(*replay_key_digest)
            }
            CloudflareTenantRootPendingShareOriginV1::Ceremony
            | CloudflareTenantRootPendingShareOriginV1::ManagedRestore { .. } => None,
        }
    }
}

fn require_pending_activation_source(
    pending: &CloudflareTenantRootPendingShareV1,
) -> worker::Result<()> {
    if pending.is_managed_restore() {
        return Err(store_error(
            "managed-restore material must pass through the mandatory forward refresh before activation",
        ));
    }
    Ok(())
}

/// Exact availability evidence accepted before a role share may activate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloudflareTenantRootAvailabilityEvidenceV1 {
    /// The owning role durably stored its independently encrypted current backup.
    CurrentRoleBackup {
        /// Digest of the role-signed backup receipt.
        role_backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        /// Logical root bound by the signature-verified backup.
        identity_digest: TenantRootIdentityDigestV1,
        /// Custody lineage bound by the signature-verified backup.
        custody_lineage: TenantRootCustodyLineageId,
        /// Owning role bound by the signature-verified backup.
        role: TenantRootManagedRestoreRoleV1,
        /// Custody epoch bound by the signature-verified backup.
        epoch: TenantRootShareEpoch,
        /// Public role-share commitment bound by the signature-verified backup.
        share_commitment: MpcPrfShareCommitmentWireV1,
    },
    /// The deployment accepted permanent derivation loss with a verified
    /// dual-authority authorization retained by the activation receipt.
    AcceptedPermanentDerivationLoss {
        /// Digest of the exact signed accepted-loss authorization bytes.
        authorization_digest: TenantRootAcceptedPermanentLossAuthorizationDigestV1,
        /// Logical root bound by the signed activation receipt.
        identity_digest: TenantRootIdentityDigestV1,
        /// Custody lineage bound by the signed activation receipt.
        custody_lineage: TenantRootCustodyLineageId,
        /// Owning role bound by the signed activation receipt.
        role: TenantRootManagedRestoreRoleV1,
        /// Custody epoch bound by the signed activation receipt.
        epoch: TenantRootShareEpoch,
        /// Public role-share commitment bound by the signed activation receipt.
        share_commitment: MpcPrfShareCommitmentWireV1,
    },
    /// The tenant retains the verified source recovery set outside this deployment.
    TenantHeldExternal {
        /// Exact destination-bound provenance retained from the signed activation receipt.
        provenance: TenantRootTenantHeldExternalProvenanceV1,
    },
}

impl Serialize for CloudflareTenantRootAvailabilityEvidenceV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::CurrentRoleBackup {
                role_backup_receipt_digest,
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
            } => {
                let mut state =
                    serializer.serialize_struct("CloudflareTenantRootAvailabilityEvidenceV1", 7)?;
                state.serialize_field("kind", "current_role_backup")?;
                state.serialize_field("role_backup_receipt_digest", role_backup_receipt_digest)?;
                state.serialize_field("identity_digest", identity_digest)?;
                state.serialize_field("custody_lineage", custody_lineage)?;
                state.serialize_field("role", role)?;
                state.serialize_field("epoch", epoch)?;
                state.serialize_field("share_commitment", share_commitment)?;
                state.end()
            }
            Self::AcceptedPermanentDerivationLoss {
                authorization_digest,
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
            } => {
                let mut state =
                    serializer.serialize_struct("CloudflareTenantRootAvailabilityEvidenceV1", 7)?;
                state.serialize_field("kind", "accepted_permanent_derivation_loss")?;
                state.serialize_field("authorization_digest", authorization_digest.as_bytes())?;
                state.serialize_field("identity_digest", identity_digest)?;
                state.serialize_field("custody_lineage", custody_lineage)?;
                state.serialize_field("role", role)?;
                state.serialize_field("epoch", epoch)?;
                state.serialize_field("share_commitment", share_commitment)?;
                state.end()
            }
            Self::TenantHeldExternal { provenance } => {
                let mut state = serializer
                    .serialize_struct("CloudflareTenantRootAvailabilityEvidenceV1", 14)?;
                state.serialize_field("kind", "tenant_held_external")?;
                state.serialize_field("identity_digest", &provenance.identity_digest())?;
                state.serialize_field("custody_lineage", &provenance.custody_lineage())?;
                state.serialize_field(
                    "destination_fingerprint",
                    provenance.destination_fingerprint().as_bytes(),
                )?;
                state.serialize_field(
                    "restore_session_id",
                    provenance.restore_session_id().as_bytes(),
                )?;
                state.serialize_field("recovery_set_id", &provenance.recovery_set_id())?;
                state.serialize_field("manifest_digest", provenance.manifest_digest())?;
                state.serialize_field(
                    "deriver_a_acceptance_receipt_digest",
                    &provenance.deriver_a_acceptance_receipt_digest(),
                )?;
                state.serialize_field(
                    "deriver_b_acceptance_receipt_digest",
                    &provenance.deriver_b_acceptance_receipt_digest(),
                )?;
                state.serialize_field(
                    "deriver_a_imported_commitment",
                    provenance.deriver_a_imported_commitment(),
                )?;
                state.serialize_field(
                    "deriver_b_imported_commitment",
                    provenance.deriver_b_imported_commitment(),
                )?;
                state.serialize_field(
                    "stable_root_commitment",
                    provenance.stable_root_commitment(),
                )?;
                state.serialize_field(
                    "restore_context_digest",
                    &provenance.restore_context_digest(),
                )?;
                state.serialize_field(
                    "restore_refresh_command_digest",
                    &provenance.restore_refresh_command_digest(),
                )?;
                state.end()
            }
        }
    }
}

impl CloudflareTenantRootAvailabilityEvidenceV1 {
    fn validate(&self) -> worker::Result<()> {
        match self {
            Self::CurrentRoleBackup { .. } => Ok(()),
            Self::AcceptedPermanentDerivationLoss {
                authorization_digest,
                ..
            } => {
                if authorization_digest
                    .as_bytes()
                    .iter()
                    .all(|byte| *byte == 0)
                {
                    return Err(store_error(
                        "tenant-root accepted-loss authorization digest must be non-zero",
                    ));
                }
                Ok(())
            }
            Self::TenantHeldExternal { .. } => Ok(()),
        }
    }
}

/// Evidence required to activate one pending role-local share.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootActivationV1 {
    availability: CloudflareTenantRootAvailabilityEvidenceV1,
    #[serde(
        rename = "activation_receipt_b64u",
        serialize_with = "serialize_activation_receipt_bytes"
    )]
    activation_receipt_bytes: Vec<u8>,
    #[serde(skip)]
    activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    #[serde(skip)]
    activated_at_ms: u64,
}

impl CloudflareTenantRootActivationV1 {
    /// Creates one activation backed by the role's current managed backup.
    pub fn with_current_role_backup(
        record: &CloudflareTenantRootRoleShareRecordV1,
        verified_backup: &VerifiedTenantRootManagedBackupV1,
        activation_receipt: VerifiedTenantRootSignedActivationReceiptV1,
    ) -> worker::Result<Self> {
        record.validate()?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = record.lifecycle() else {
            return Err(store_error(
                "tenant-root activation requires a pending role-share record",
            ));
        };
        require_pending_activation_source(pending)?;
        let binding = verified_backup.binding();
        validate_activation_receipt_against_backup(&activation_receipt, verified_backup)?;
        let availability = CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            role_backup_receipt_digest: verified_backup.receipt_digest(),
            identity_digest: binding.identity_digest(),
            custody_lineage: binding.custody_lineage(),
            role: binding.role(),
            epoch: binding.epoch(),
            share_commitment: binding.share_commitment().clone(),
        };
        validate_activation_receipt_against_record(
            activation_receipt.canonical_bytes(),
            record,
            &availability,
        )?;
        Self::from_verified_receipt(availability, activation_receipt)
    }

    /// Creates one activation backed by a tenant-held external restore set.
    pub fn with_tenant_held_external(
        record: &CloudflareTenantRootRoleShareRecordV1,
        activation_receipt: &VerifiedTenantRootSignedActivationReceiptV1,
    ) -> worker::Result<Self> {
        record.validate()?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = record.lifecycle() else {
            return Err(store_error(
                "tenant-root activation requires a pending role-share record",
            ));
        };
        require_pending_activation_source(pending)?;
        let provenance = activation_receipt
            .availability()
            .tenant_held_external_provenance()
            .ok_or_else(|| {
                store_error(
                    "tenant-root external activation requires tenant-held external provenance",
                )
            })?;
        validate_tenant_held_external_provenance_against_binding(
            provenance,
            activation_receipt.binding(),
        )?;
        let availability = CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal {
            provenance: provenance.clone(),
        };
        validate_activation_receipt_against_record(
            activation_receipt.canonical_bytes(),
            record,
            &availability,
        )?;
        Self::from_stored_receipt_bytes(availability, activation_receipt.canonical_bytes().to_vec())
    }

    /// Creates one activation backed by a verified dual-authority loss authorization.
    pub fn with_accepted_permanent_derivation_loss(
        record: &CloudflareTenantRootRoleShareRecordV1,
        activation_receipt: VerifiedTenantRootSignedActivationReceiptV1,
    ) -> worker::Result<Self> {
        record.validate()?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = record.lifecycle() else {
            return Err(store_error(
                "tenant-root activation requires a pending role-share record",
            ));
        };
        require_pending_activation_source(pending)?;
        let availability = accepted_loss_availability_from_verified_receipt(
            &activation_receipt,
            record.role.managed_restore_role(),
        )?;
        validate_activation_receipt_against_record(
            activation_receipt.canonical_bytes(),
            record,
            &availability,
        )?;
        Self::from_verified_receipt(availability, activation_receipt)
    }

    fn from_verified_receipt(
        availability: CloudflareTenantRootAvailabilityEvidenceV1,
        activation_receipt: VerifiedTenantRootSignedActivationReceiptV1,
    ) -> worker::Result<Self> {
        let activation_receipt_digest = activation_receipt.digest();
        let activated_at_ms = activation_receipt.activated_at_ms();
        let activation_receipt_bytes = activation_receipt.into_canonical_bytes();
        let activation = Self {
            availability,
            activation_receipt_bytes,
            activation_receipt_digest,
            activated_at_ms,
        };
        activation.validate()?;
        Ok(activation)
    }

    fn from_stored_receipt_bytes(
        availability: CloudflareTenantRootAvailabilityEvidenceV1,
        activation_receipt_bytes: Vec<u8>,
    ) -> worker::Result<Self> {
        let receipt = decode_activation_receipt_bytes(&activation_receipt_bytes)?;
        let activation_receipt_digest = receipt
            .digest()
            .map_err(|error| store_error(error.message()))?;
        let activated_at_ms = receipt.activated_at_ms();
        let activation = Self {
            availability,
            activation_receipt_bytes,
            activation_receipt_digest,
            activated_at_ms,
        };
        activation.validate()?;
        Ok(activation)
    }

    /// Returns the exact canonical signed activation receipt bytes.
    pub fn activation_receipt_bytes(&self) -> &[u8] {
        &self.activation_receipt_bytes
    }

    /// Returns the digest derived from the exact canonical activation bytes.
    pub const fn activation_receipt_digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.activation_receipt_digest
    }

    /// Returns the activation time derived from the signed receipt.
    pub const fn activated_at_ms(&self) -> u64 {
        self.activated_at_ms
    }

    fn validate(&self) -> worker::Result<()> {
        self.availability.validate()?;
        let receipt = decode_activation_receipt_bytes(&self.activation_receipt_bytes)?;
        let digest = receipt
            .digest()
            .map_err(|error| store_error(error.message()))?;
        if digest != self.activation_receipt_digest
            || receipt.activated_at_ms() != self.activated_at_ms
        {
            return Err(store_error(
                "tenant-root activation receipt projection does not match its exact bytes",
            ));
        }
        require_timestamp("tenant-root activation timestamp", self.activated_at_ms)
    }

    fn validate_for_record(
        &self,
        record: &CloudflareTenantRootRoleShareRecordV1,
    ) -> worker::Result<()> {
        self.validate()?;
        let record_identity = record
            .identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        match &self.availability {
            CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
                ..
            } => {
                if *identity_digest != record_identity
                    || *custody_lineage != record.custody_lineage
                    || *role != record.role.managed_restore_role()
                    || *epoch != record.epoch
                    || share_commitment != &record.share_commitment
                {
                    return Err(store_error(
                        "tenant-root managed-backup binding does not match the pending role share",
                    ));
                }
            }
            CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
                ..
            } => {
                if *identity_digest != record_identity
                    || *custody_lineage != record.custody_lineage
                    || *role != record.role.managed_restore_role()
                    || *epoch != record.epoch
                    || share_commitment != &record.share_commitment
                {
                    return Err(store_error(
                        "tenant-root accepted-loss binding does not match the pending role share",
                    ));
                }
            }
            CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal { provenance } => {
                if provenance.identity_digest() != record_identity
                    || provenance.custody_lineage() != record.custody_lineage
                {
                    return Err(store_error(
                        "tenant-root tenant-held external binding does not match the pending role share",
                    ));
                }
            }
        }
        validate_activation_receipt_against_record(
            &self.activation_receipt_bytes,
            record,
            &self.availability,
        )?;
        Ok(())
    }
}

/// Active role-local tenant-root share retaining the exact activation receipt bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootActiveShareV1 {
    pending: CloudflareTenantRootPendingShareV1,
    activation: CloudflareTenantRootActivationV1,
}

impl CloudflareTenantRootActiveShareV1 {
    fn from_pending(
        pending: CloudflareTenantRootPendingShareV1,
        activation: CloudflareTenantRootActivationV1,
    ) -> worker::Result<Self> {
        require_pending_activation_source(&pending)?;
        let active = Self {
            pending,
            activation,
        };
        active.validate()?;
        Ok(active)
    }

    fn validate(&self) -> worker::Result<()> {
        self.pending.validate()?;
        require_pending_activation_source(&self.pending)?;
        self.activation.validate()?;
        if self.activation.activated_at_ms < self.pending.staged_at_ms {
            return Err(store_error(
                "tenant-root activation predates role-share installation",
            ));
        }
        Ok(())
    }
}

/// Evidence required to retire one active role-local share.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootRetirementV1 {
    retirement_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    retired_at_ms: u64,
}

impl CloudflareTenantRootRetirementV1 {
    /// Creates one signed forward-only retirement transition.
    pub fn new(
        retirement_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        retired_at_ms: u64,
    ) -> worker::Result<Self> {
        let retirement = Self {
            retirement_receipt_digest,
            retired_at_ms,
        };
        retirement.validate()?;
        Ok(retirement)
    }

    fn validate(&self) -> worker::Result<()> {
        require_timestamp("tenant-root retirement timestamp", self.retired_at_ms)
    }
}

/// Retired role-local tenant-root share awaiting provider destruction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootRetiredShareV1 {
    active: CloudflareTenantRootActiveShareV1,
    retirement: CloudflareTenantRootRetirementV1,
}

impl CloudflareTenantRootRetiredShareV1 {
    fn from_active(
        active: CloudflareTenantRootActiveShareV1,
        retirement: CloudflareTenantRootRetirementV1,
    ) -> worker::Result<Self> {
        let retired = Self { active, retirement };
        retired.validate()?;
        Ok(retired)
    }

    fn validate(&self) -> worker::Result<()> {
        self.active.validate()?;
        self.retirement.validate()?;
        if self.retirement.retired_at_ms < self.active.activation.activated_at_ms {
            return Err(store_error(
                "tenant-root retirement predates role-share activation",
            ));
        }
        Ok(())
    }
}

/// Exhaustive lifecycle for one persisted role-local share epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "state", rename_all = "snake_case")]
pub enum CloudflareTenantRootRoleShareLifecycleV1 {
    /// Installed and verified locally, with activation still pending.
    Pending(CloudflareTenantRootPendingShareV1),
    /// Selected as the one current epoch for this role and tenant.
    Active(CloudflareTenantRootActiveShareV1),
    /// Replaced by a newer active epoch and awaiting destruction.
    Retired(CloudflareTenantRootRetiredShareV1),
}

impl CloudflareTenantRootRoleShareLifecycleV1 {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Pending(_) => "pending",
            Self::Active(_) => "active",
            Self::Retired(_) => "retired",
        }
    }

    fn event_at_ms(&self) -> u64 {
        match self {
            Self::Pending(state) => state.staged_at_ms,
            Self::Active(state) => state.activation.activated_at_ms,
            Self::Retired(state) => state.retirement.retired_at_ms,
        }
    }

    fn validate(&self) -> worker::Result<()> {
        match self {
            Self::Pending(state) => state.validate(),
            Self::Active(state) => state.validate(),
            Self::Retired(state) => state.validate(),
        }
    }
}

/// Required fields for one role-private tenant-root share record.
pub struct CloudflareTenantRootRoleShareRecordInputV1 {
    /// Server-resolved logical root identity.
    pub identity: TenantRootIdentityV1,
    /// Random custody lineage for this physical share pair.
    pub custody_lineage: TenantRootCustodyLineageId,
    /// Monotonic role-share custody epoch.
    pub epoch: TenantRootShareEpoch,
    /// Exact Deriver role owning the record.
    pub role: CloudflareTenantRootDeriverRoleV1,
    /// Epoch-provider ciphertext containing one canonical role share.
    pub sealed_share: CloudflareTenantRootSealedRoleShareV1,
    /// Public commitment to the sealed role share.
    pub share_commitment: MpcPrfShareCommitmentWireV1,
    /// Opaque external key-version reference needed to open the sealed share.
    pub epoch_wrapping_key_ref: String,
    /// Current lifecycle branch.
    pub lifecycle: CloudflareTenantRootRoleShareLifecycleV1,
    /// Initial durable creation time.
    pub created_at_ms: u64,
    /// Last successful lifecycle update time.
    pub updated_at_ms: u64,
}

/// Encrypted-at-rest record for one role's tenant-root share epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootRoleShareRecordV1 {
    identity: TenantRootIdentityV1,
    custody_lineage: TenantRootCustodyLineageId,
    epoch: TenantRootShareEpoch,
    role: CloudflareTenantRootDeriverRoleV1,
    sealed_share: CloudflareTenantRootSealedRoleShareV1,
    share_commitment: MpcPrfShareCommitmentWireV1,
    epoch_wrapping_key_ref: String,
    lifecycle: CloudflareTenantRootRoleShareLifecycleV1,
    created_at_ms: u64,
    updated_at_ms: u64,
}

impl CloudflareTenantRootRoleShareRecordV1 {
    /// Validates and normalizes one role-private share record.
    pub fn new(input: CloudflareTenantRootRoleShareRecordInputV1) -> worker::Result<Self> {
        let record = Self {
            identity: input.identity,
            custody_lineage: input.custody_lineage,
            epoch: input.epoch,
            role: input.role,
            sealed_share: input.sealed_share,
            share_commitment: input.share_commitment,
            epoch_wrapping_key_ref: input.epoch_wrapping_key_ref,
            lifecycle: input.lifecycle,
            created_at_ms: input.created_at_ms,
            updated_at_ms: input.updated_at_ms,
        };
        record.validate()?;
        Ok(record)
    }

    /// Returns the server-resolved logical root identity.
    pub fn identity(&self) -> &TenantRootIdentityV1 {
        &self.identity
    }

    /// Returns the physical custody lineage.
    pub const fn custody_lineage(&self) -> TenantRootCustodyLineageId {
        self.custody_lineage
    }

    /// Returns the role-share custody epoch.
    pub const fn epoch(&self) -> TenantRootShareEpoch {
        self.epoch
    }

    /// Returns the exact owning Deriver role.
    pub const fn role(&self) -> CloudflareTenantRootDeriverRoleV1 {
        self.role
    }

    /// Returns the epoch-provider sealed share ciphertext.
    pub const fn sealed_share(&self) -> &CloudflareTenantRootSealedRoleShareV1 {
        &self.sealed_share
    }

    /// Returns the public share commitment.
    pub const fn share_commitment(&self) -> &MpcPrfShareCommitmentWireV1 {
        &self.share_commitment
    }

    /// Returns the opaque epoch wrapping-key reference.
    pub fn epoch_wrapping_key_ref(&self) -> &str {
        &self.epoch_wrapping_key_ref
    }

    /// Returns the exhaustive lifecycle branch.
    pub const fn lifecycle(&self) -> &CloudflareTenantRootRoleShareLifecycleV1 {
        &self.lifecycle
    }

    /// Returns the last timestamp durably written with this row.
    pub(crate) const fn updated_at_ms(&self) -> u64 {
        self.updated_at_ms
    }

    fn into_online_role_share_artifact(self) -> worker::Result<TenantRootSealedOnlineRoleShareV1> {
        let installation_evidence_digest = match &self.lifecycle {
            CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
                active.pending.installation_evidence_digest()
            }
            _ => {
                return Err(store_error(
                    "tenant-root online role-share artifact requires an active record",
                ));
            }
        };
        self.validate()?;
        validate_record_activation_binding(&self)?;
        self.into_online_role_share_artifact_with_installation_evidence_digest(
            installation_evidence_digest,
        )
    }

    fn into_online_role_share_artifact_with_installation_evidence_digest(
        self,
        installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
    ) -> worker::Result<TenantRootSealedOnlineRoleShareV1> {
        let identity_digest = self
            .identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        let ciphertext = decode_base64url_bytes_v1(
            "tenant-root sealed role share",
            self.sealed_share.ciphertext_b64u(),
        )
        .map_err(|error| store_error(error.message()))?;
        let binding = TenantRootOnlineRoleShareBindingV1::from_persisted(
            identity_digest,
            self.custody_lineage,
            protocol_role_for_cloudflare(self.role),
            self.epoch,
            self.share_commitment,
            self.epoch_wrapping_key_ref,
            installation_evidence_digest,
        )
        .map_err(|error| store_error(error.message()))?;
        TenantRootSealedOnlineRoleShareV1::from_persisted(binding, ciphertext)
            .map_err(|error| store_error(error.message()))
    }

    fn identity_digest_hex(&self) -> worker::Result<String> {
        self.identity
            .digest()
            .map(|digest| encode_hex(digest.as_bytes()))
            .map_err(|error| store_error(error.message()))
    }

    fn validate(&self) -> worker::Result<()> {
        self.sealed_share.validate()?;
        self.lifecycle.validate()?;
        require_identifier(
            "tenant-root epoch wrapping-key reference",
            &self.epoch_wrapping_key_ref,
        )?;
        require_timestamp("tenant-root record creation timestamp", self.created_at_ms)?;
        require_timestamp("tenant-root record update timestamp", self.updated_at_ms)?;
        if self.updated_at_ms < self.created_at_ms
            || self.lifecycle.event_at_ms() < self.created_at_ms
            || self.lifecycle.event_at_ms() > self.updated_at_ms
        {
            return Err(store_error(
                "tenant-root role-share lifecycle timestamps are inconsistent",
            ));
        }
        validate_tenant_root_active_role_share_commitment_v1(
            self.role.managed_restore_role(),
            &self.share_commitment,
        )
        .map_err(|error| store_error(error.message()))?;
        epoch_i64(self.epoch)?;
        timestamp_i64(self.created_at_ms)?;
        timestamp_i64(self.updated_at_ms)?;
        Ok(())
    }

    fn into_active(
        mut self,
        activation: CloudflareTenantRootActivationV1,
        updated_at_ms: u64,
    ) -> worker::Result<Self> {
        require_lifecycle_progression(
            "tenant-root activation",
            self.updated_at_ms,
            activation.activated_at_ms,
            updated_at_ms,
        )?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = &self.lifecycle else {
            return Err(store_error(
                "only a pending tenant-root role share can become active",
            ));
        };
        require_pending_activation_source(pending)?;
        activation.validate_for_record(&self)?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = self.lifecycle else {
            unreachable!("pending lifecycle was checked before activation");
        };
        let active = CloudflareTenantRootActiveShareV1::from_pending(pending, activation)?;
        self.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Active(active);
        self.updated_at_ms = updated_at_ms;
        self.validate()?;
        Ok(self)
    }

    fn into_retired(
        mut self,
        retirement: CloudflareTenantRootRetirementV1,
        updated_at_ms: u64,
    ) -> worker::Result<Self> {
        require_lifecycle_progression(
            "tenant-root retirement",
            self.updated_at_ms,
            retirement.retired_at_ms,
            updated_at_ms,
        )?;
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = self.lifecycle else {
            return Err(store_error(
                "only an active tenant-root role share can become retired",
            ));
        };
        let retired = CloudflareTenantRootRetiredShareV1::from_active(active, retirement)?;
        self.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Retired(retired);
        self.updated_at_ms = updated_at_ms;
        self.validate()?;
        Ok(self)
    }
}

/// One versioned record read from the primary role-private D1 session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudflareStoredTenantRootRoleShareV1 {
    record: CloudflareTenantRootRoleShareRecordV1,
    revision: i64,
}

impl CloudflareStoredTenantRootRoleShareV1 {
    /// Returns the validated encrypted-record plaintext.
    pub const fn record(&self) -> &CloudflareTenantRootRoleShareRecordV1 {
        &self.record
    }

    /// Returns the positive compare-and-set revision.
    pub const fn revision(&self) -> i64 {
        self.revision
    }

    /// Returns the validated public binding for this active role share.
    pub(crate) fn active_binding(&self) -> worker::Result<TenantRootActiveRoleBindingV1> {
        active_binding_from_stored(self)
    }

    /// Returns the exact activation receipt retained by an active row.
    pub(crate) fn active_activation_receipt_bytes(&self) -> worker::Result<&[u8]> {
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = &self.record.lifecycle
        else {
            return Err(store_error(
                "tenant-root initial activation retry requires an active record",
            ));
        };
        Ok(active.activation.activation_receipt_bytes())
    }

    pub(crate) fn retained_activation_receipt_bytes(&self) -> worker::Result<&[u8]> {
        match &self.record.lifecycle {
            CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
                Ok(active.activation.activation_receipt_bytes())
            }
            CloudflareTenantRootRoleShareLifecycleV1::Retired(retired) => {
                Ok(retired.active.activation.activation_receipt_bytes())
            }
            CloudflareTenantRootRoleShareLifecycleV1::Pending(_) => Err(store_error(
                "tenant-root retained activation receipt requires an active or retired record",
            )),
        }
    }

    /// Reconstructs the exact pending revision consumed by initial activation.
    pub(crate) fn initial_activation_retry_pending(&self) -> worker::Result<Self> {
        self.record.validate()?;
        if self.record.epoch != TenantRootShareEpoch::INITIAL {
            return Err(store_error(
                "tenant-root initial activation retry requires epoch 1",
            ));
        }
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = &self.record.lifecycle
        else {
            return Err(store_error(
                "tenant-root initial activation retry requires an active record",
            ));
        };
        let revision = self
            .revision
            .checked_sub(1)
            .filter(|revision| *revision > 0)
            .ok_or_else(|| {
                store_error("tenant-root initial activation retry has no prior pending revision")
            })?;
        let mut record = self.record.clone();
        record.lifecycle =
            CloudflareTenantRootRoleShareLifecycleV1::Pending(active.pending.clone());
        record.updated_at_ms = active.pending.staged_at_ms;
        record.validate()?;
        Ok(Self { record, revision })
    }

    /// Reconstructs the exact pending revision consumed by a refresh activation.
    pub(crate) fn refresh_activation_retry_pending(&self) -> worker::Result<Self> {
        self.record.validate()?;
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = &self.record.lifecycle
        else {
            return Err(store_error(
                "tenant-root refresh activation retry requires an active successor",
            ));
        };
        let revision = self
            .revision
            .checked_sub(1)
            .filter(|revision| *revision > 0)
            .ok_or_else(|| {
                store_error("tenant-root refresh activation retry has no prior pending revision")
            })?;
        let mut record = self.record.clone();
        record.lifecycle =
            CloudflareTenantRootRoleShareLifecycleV1::Pending(active.pending.clone());
        record.updated_at_ms = active.pending.staged_at_ms;
        record.validate()?;
        Ok(Self { record, revision })
    }

    /// Reconstructs the opaque provider artifact from one validated active D1 record.
    pub fn into_online_role_share_artifact(
        self,
    ) -> worker::Result<TenantRootSealedOnlineRoleShareV1> {
        validate_active_stored_record_shape(&self)?;
        self.record.into_online_role_share_artifact()
    }
}

/// Exhaustive role-private active-share resolution for one authenticated tenant.
#[derive(Debug)]
pub enum CloudflareTenantRootActiveRoleShareV1 {
    /// This role holds no active share for the authenticated tenant root.
    Unprovisioned,
    /// Exactly one active share exists.
    Active(Box<CloudflareStoredTenantRootRoleShareV1>),
    /// More than one active share exists; reconciliation may observe this.
    Ambiguous(TenantRootActiveRoleAmbiguityV1),
}

impl CloudflareTenantRootActiveRoleShareV1 {
    fn from_stored(stored: CloudflareStoredTenantRootRoleShareV1) -> worker::Result<Self> {
        active_binding_from_stored(&stored)?;
        Ok(Self::Active(Box::new(stored)))
    }

    /// Returns the one active share, or fails closed.
    ///
    /// Derivation and runtime callers use this; reconciliation matches the
    /// variants directly so it can observe ambiguity without deriving from it.
    pub fn require_active(self) -> worker::Result<CloudflareStoredTenantRootRoleShareV1> {
        match self {
            Self::Active(stored) => {
                validate_active_stored_record_shape(stored.as_ref())?;
                Ok(*stored)
            }
            Self::Unprovisioned => Err(store_error(
                "authenticated tenant root has no active role share",
            )),
            Self::Ambiguous(_) => Err(store_error(
                "authenticated tenant root resolves to more than one active role share",
            )),
        }
    }
}

impl CloudflareTenantRootActiveRoleShareV1 {
    /// Returns this role's public resolution, leaving every sealed value behind.
    ///
    /// Pair resolution consumes only this. A Deriver never receives its peer's
    /// opened record, so assembling a pair cannot move sealed share material
    /// across the role boundary.
    pub fn public_resolution(&self) -> worker::Result<TenantRootActiveRoleResolutionV1> {
        match self {
            Self::Unprovisioned => Ok(TenantRootActiveRoleResolutionV1::Unprovisioned),
            Self::Active(stored) => Ok(TenantRootActiveRoleResolutionV1::Active(
                active_binding_from_stored(stored.as_ref())?,
            )),
            Self::Ambiguous(ambiguity) => Ok(TenantRootActiveRoleResolutionV1::Ambiguous(
                ambiguity.clone(),
            )),
        }
    }
}

/// Observes one authenticated tenant's active Deriver A/B root pair.
///
/// Each role's private store answers for itself, so this is where the two
/// halves meet for reconciliation. This intentionally does not authorize
/// derivation; callers that need a usable pair must supply the authority-derived
/// custody binding through `cloudflare_resolve_active_tenant_root_pair_v1`.
pub fn cloudflare_observe_active_tenant_root_pair_v1(
    identity: &TenantRootIdentityV1,
    deriver_a: &CloudflareTenantRootActiveRoleShareV1,
    deriver_b: &CloudflareTenantRootActiveRoleShareV1,
) -> worker::Result<TenantRootActivePairResolutionV1> {
    let identity_digest = identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let deriver_a = deriver_a.public_resolution()?;
    let deriver_b = deriver_b.public_resolution()?;
    resolve_active_tenant_root_pair_binding_v1(identity_digest, &deriver_a, &deriver_b)
        .map_err(|error| store_error(error.message()))
}

/// Resolves one active root pair against the authority-derived custody binding.
///
/// The custody binding supplies the authenticated identity, lineage, epoch,
/// commitments, root commitment, and activation receipt expected from both
/// private stores. An observed pair is never sufficient for derivation.
pub fn cloudflare_resolve_active_tenant_root_pair_v1(
    custody_binding: &TenantRootCustodyBindingV1,
    deriver_a: &CloudflareTenantRootActiveRoleShareV1,
    deriver_b: &CloudflareTenantRootActiveRoleShareV1,
) -> worker::Result<TenantRootActivePairResolutionV1> {
    let identity_digest = custody_binding.identity_digest();
    let deriver_a = deriver_a.public_resolution()?;
    let deriver_b = deriver_b.public_resolution()?;
    resolve_authoritative_active_tenant_root_pair_binding_v1(
        identity_digest,
        custody_binding,
        &deriver_a,
        &deriver_b,
    )
    .map_err(|error| store_error(error.message()))
}

/// Returns the one authority-matching active root pair, or fails closed.
///
/// Reconciliation calls `cloudflare_observe_active_tenant_root_pair_v1` instead
/// so it can observe an unsafe state without deriving from it.
pub fn cloudflare_require_active_tenant_root_pair_v1(
    custody_binding: &TenantRootCustodyBindingV1,
    deriver_a: &CloudflareTenantRootActiveRoleShareV1,
    deriver_b: &CloudflareTenantRootActiveRoleShareV1,
) -> worker::Result<TenantRootActiveRootPairV1> {
    let resolution =
        cloudflare_resolve_active_tenant_root_pair_v1(custody_binding, deriver_a, deriver_b)?;
    let pair = resolution
        .require_active()
        .map_err(|error| store_error(error.message()))?;
    Ok(pair.clone())
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRoleD1AadV1<'a> {
    environment: &'a str,
    worker_role: CloudflareTenantRootDeriverRoleV1,
    tenant_identity_digest_hex: &'a str,
    custody_lineage_b64u: &'a str,
    tenant_root_share_epoch: u64,
    record_role: CloudflareTenantRootDeriverRoleV1,
    lifecycle: &'a str,
    revision: i64,
    purpose: &'static str,
    schema: &'static str,
    record_key: &'a str,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRoleD1CiphertextV1 {
    key_version: String,
    tenant_identity_digest_hex: String,
    custody_lineage_b64u: String,
    tenant_root_share_epoch: u64,
    role: CloudflareTenantRootDeriverRoleV1,
    lifecycle: String,
    ciphertext_b64u: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRoleD1RecordWireV1 {
    identity: TenantRootIdentityV1,
    custody_lineage: TenantRootCustodyLineageId,
    epoch: TenantRootShareEpoch,
    role: CloudflareTenantRootDeriverRoleV1,
    sealed_share: CloudflareTenantRootSealedRoleShareV1,
    share_commitment: MpcPrfShareCommitmentWireV1,
    epoch_wrapping_key_ref: String,
    lifecycle: TenantRootRoleD1LifecycleWireV1,
    created_at_ms: u64,
    updated_at_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    content = "state",
    rename_all = "snake_case",
    deny_unknown_fields
)]
enum TenantRootRoleD1LifecycleWireV1 {
    Pending(TenantRootRoleD1PendingWireV1),
    Active(TenantRootRoleD1ActiveWireV1),
    Retired(TenantRootRoleD1RetiredWireV1),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRoleD1PendingWireV1 {
    installation_evidence_digest: TenantRootLifecycleReceiptDigestV1,
    staged_at_ms: u64,
    origin: CloudflareTenantRootPendingShareOriginV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRoleD1ActiveWireV1 {
    pending: TenantRootRoleD1PendingWireV1,
    activation: TenantRootRoleD1ActivationWireV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRoleD1RetiredWireV1 {
    active: TenantRootRoleD1ActiveWireV1,
    retirement: TenantRootRoleD1RetirementWireV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRoleD1ActivationWireV1 {
    availability: TenantRootRoleD1AvailabilityWireV1,
    activation_receipt_b64u: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum TenantRootRoleD1AvailabilityWireV1 {
    CurrentRoleBackup {
        role_backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        role: TenantRootManagedRestoreRoleV1,
        epoch: TenantRootShareEpoch,
        share_commitment: MpcPrfShareCommitmentWireV1,
    },
    AcceptedPermanentDerivationLoss {
        authorization_digest: [u8; 32],
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        role: TenantRootManagedRestoreRoleV1,
        epoch: TenantRootShareEpoch,
        share_commitment: MpcPrfShareCommitmentWireV1,
    },
    TenantHeldExternal {
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        destination_fingerprint: [u8; 32],
        restore_session_id: [u8; 16],
        recovery_set_id: TenantRootRecoverySetId,
        manifest_digest: [u8; 32],
        deriver_a_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        deriver_b_acceptance_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        deriver_a_imported_commitment: MpcPrfShareCommitmentWireV1,
        deriver_b_imported_commitment: MpcPrfShareCommitmentWireV1,
        stable_root_commitment: [u8; 32],
        restore_context_digest: TenantRootProtocolDigestV1,
        restore_refresh_command_digest: TenantRootProtocolDigestV1,
    },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRoleD1RetirementWireV1 {
    retirement_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    retired_at_ms: u64,
}

impl TenantRootRoleD1RecordWireV1 {
    fn into_record(self) -> worker::Result<CloudflareTenantRootRoleShareRecordV1> {
        CloudflareTenantRootRoleShareRecordV1::new(CloudflareTenantRootRoleShareRecordInputV1 {
            identity: self.identity,
            custody_lineage: self.custody_lineage,
            epoch: self.epoch,
            role: self.role,
            sealed_share: self.sealed_share,
            share_commitment: self.share_commitment,
            epoch_wrapping_key_ref: self.epoch_wrapping_key_ref,
            lifecycle: self.lifecycle.into_lifecycle()?,
            created_at_ms: self.created_at_ms,
            updated_at_ms: self.updated_at_ms,
        })
    }
}

impl TenantRootRoleD1LifecycleWireV1 {
    fn into_lifecycle(self) -> worker::Result<CloudflareTenantRootRoleShareLifecycleV1> {
        match self {
            Self::Pending(pending) => Ok(CloudflareTenantRootRoleShareLifecycleV1::Pending(
                pending.into_pending()?,
            )),
            Self::Active(active) => Ok(CloudflareTenantRootRoleShareLifecycleV1::Active(
                active.into_active()?,
            )),
            Self::Retired(retired) => Ok(CloudflareTenantRootRoleShareLifecycleV1::Retired(
                retired.into_retired()?,
            )),
        }
    }
}

impl TenantRootRoleD1PendingWireV1 {
    fn into_pending(self) -> worker::Result<CloudflareTenantRootPendingShareV1> {
        CloudflareTenantRootPendingShareV1::from_stored_digest_with_origin(
            self.installation_evidence_digest,
            self.staged_at_ms,
            self.origin,
        )
    }
}

impl TenantRootRoleD1ActiveWireV1 {
    fn into_active(self) -> worker::Result<CloudflareTenantRootActiveShareV1> {
        CloudflareTenantRootActiveShareV1::from_pending(
            self.pending.into_pending()?,
            self.activation.into_activation()?,
        )
    }
}

impl TenantRootRoleD1RetiredWireV1 {
    fn into_retired(self) -> worker::Result<CloudflareTenantRootRetiredShareV1> {
        CloudflareTenantRootRetiredShareV1::from_active(
            self.active.into_active()?,
            self.retirement.into_retirement()?,
        )
    }
}

impl TenantRootRoleD1ActivationWireV1 {
    fn into_activation(self) -> worker::Result<CloudflareTenantRootActivationV1> {
        let receipt_bytes = decode_base64url_bytes_v1(
            "tenant-root activation receipt",
            &self.activation_receipt_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&receipt_bytes) != self.activation_receipt_b64u {
            return Err(store_error(
                "tenant-root activation receipt bytes are not canonical base64url",
            ));
        }
        let receipt = decode_activation_receipt_bytes(&receipt_bytes)?;
        CloudflareTenantRootActivationV1::from_stored_receipt_bytes(
            self.availability
                .into_availability(receipt.availability())?,
            receipt_bytes,
        )
    }
}

impl TenantRootRoleD1AvailabilityWireV1 {
    fn into_availability(
        self,
        receipt_availability: &TenantRootActivationReceiptAvailabilityV1,
    ) -> worker::Result<CloudflareTenantRootAvailabilityEvidenceV1> {
        Ok(match self {
            Self::CurrentRoleBackup {
                role_backup_receipt_digest,
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
            } => {
                let TenantRootActivationReceiptAvailabilityV1::CurrentRoleBackups { receipts } =
                    receipt_availability
                else {
                    return Err(store_error(
                        "tenant-root current-backup availability does not match activation receipt",
                    ));
                };
                let receipt_digest = match role {
                    TenantRootManagedRestoreRoleV1::DeriverA => receipts.deriver_a(),
                    TenantRootManagedRestoreRoleV1::DeriverB => receipts.deriver_b(),
                };
                if receipt_digest != role_backup_receipt_digest {
                    return Err(store_error(
                        "tenant-root current-backup receipt digest does not match activation receipt",
                    ));
                }
                CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
                    role_backup_receipt_digest,
                    identity_digest,
                    custody_lineage,
                    role,
                    epoch,
                    share_commitment,
                }
            }
            Self::AcceptedPermanentDerivationLoss {
                authorization_digest,
                identity_digest,
                custody_lineage,
                role,
                epoch,
                share_commitment,
            } => {
                let TenantRootActivationReceiptAvailabilityV1::AcceptedPermanentDerivationLoss {
                    authorization_digest: receipt_digest,
                    ..
                } = receipt_availability
                else {
                    return Err(store_error(
                        "tenant-root accepted-loss availability does not match activation receipt",
                    ));
                };
                if receipt_digest.as_bytes() != &authorization_digest {
                    return Err(store_error(
                        "tenant-root accepted-loss authorization digest does not match activation receipt",
                    ));
                }
                CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
                    authorization_digest: *receipt_digest,
                    identity_digest,
                    custody_lineage,
                    role,
                    epoch,
                    share_commitment,
                }
            }
            Self::TenantHeldExternal {
                identity_digest,
                custody_lineage,
                destination_fingerprint,
                restore_session_id,
                recovery_set_id,
                manifest_digest,
                deriver_a_acceptance_receipt_digest,
                deriver_b_acceptance_receipt_digest,
                deriver_a_imported_commitment,
                deriver_b_imported_commitment,
                stable_root_commitment,
                restore_context_digest,
                restore_refresh_command_digest,
            } => {
                let TenantRootActivationReceiptAvailabilityV1::TenantHeldExternal { provenance } =
                    receipt_availability
                else {
                    return Err(store_error(
                        "tenant-root tenant-held external availability does not match activation receipt",
                    ));
                };
                if provenance.identity_digest() != identity_digest
                    || provenance.custody_lineage() != custody_lineage
                    || provenance.destination_fingerprint().as_bytes() != &destination_fingerprint
                    || provenance.restore_session_id().as_bytes() != &restore_session_id
                    || provenance.recovery_set_id() != recovery_set_id
                    || provenance.manifest_digest() != &manifest_digest
                    || provenance.deriver_a_acceptance_receipt_digest()
                        != deriver_a_acceptance_receipt_digest
                    || provenance.deriver_b_acceptance_receipt_digest()
                        != deriver_b_acceptance_receipt_digest
                    || provenance.deriver_a_imported_commitment() != &deriver_a_imported_commitment
                    || provenance.deriver_b_imported_commitment() != &deriver_b_imported_commitment
                    || provenance.stable_root_commitment() != &stable_root_commitment
                    || provenance.restore_context_digest() != restore_context_digest
                    || provenance.restore_refresh_command_digest() != restore_refresh_command_digest
                {
                    return Err(store_error(
                        "tenant-root tenant-held external availability does not match activation receipt",
                    ));
                }
                CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal {
                    provenance: provenance.clone(),
                }
            }
        })
    }
}

impl TenantRootRoleD1RetirementWireV1 {
    fn into_retirement(self) -> worker::Result<CloudflareTenantRootRetirementV1> {
        CloudflareTenantRootRetirementV1::new(self.retirement_receipt_digest, self.retired_at_ms)
    }
}

struct TenantRootRoleD1CipherV1 {
    environment: String,
    role: CloudflareTenantRootDeriverRoleV1,
    key_version: String,
    public_key: <CloudflareHpkeKemV1 as Kem>::PublicKey,
    private_key: <CloudflareHpkeKemV1 as Kem>::PrivateKey,
}

impl TenantRootRoleD1CipherV1 {
    fn from_env(env: &Env) -> worker::Result<Self> {
        let environment = required_env_var(env, ROLE_PRIVATE_D1_ENVIRONMENT_ENV)?;
        let role = CloudflareTenantRootDeriverRoleV1::parse(&required_env_var(
            env,
            ROLE_PRIVATE_D1_ROLE_ENV,
        )?)?;
        let key_version = required_env_var(env, ROLE_PRIVATE_D1_KEK_VERSION_ENV)?;
        let public_key = parse_cloudflare_hpke_x25519_public_key_v1(&required_env_var(
            env,
            ROLE_PRIVATE_D1_KEK_PUBLIC_KEY_ENV,
        )?)
        .map_err(|error| store_error(error.message()))?;
        let secret_binding = required_env_var(env, ROLE_PRIVATE_D1_KEK_BINDING_ENV)?;
        let secret = env.secret(&secret_binding).map_err(|error| {
            store_error(format!(
                "role-private D1 KEK Secret binding {secret_binding} is unavailable: {error}"
            ))
        })?;
        let mut encoded_private_key = secret.to_string();
        let mut private_key_bytes = decode_private_key(&encoded_private_key)?;
        encoded_private_key.zeroize();
        let private_key = CloudflareHpkeKemV1::sk_from_bytes(&private_key_bytes)
            .map_err(|error| store_error(format!("role-private D1 KEK is invalid: {error}")))?;
        private_key_bytes.zeroize();
        validate_role_private_d1_kek_key_pair(&public_key, &private_key)?;
        Ok(Self {
            environment,
            role,
            key_version,
            public_key,
            private_key,
        })
    }

    fn seal(
        &self,
        record: &CloudflareTenantRootRoleShareRecordV1,
        revision: i64,
    ) -> worker::Result<String> {
        if revision <= 0 {
            return Err(store_error(
                "tenant-root role-private row has an invalid revision",
            ));
        }
        record.validate()?;
        self.require_role(record.role)?;
        let metadata = record_metadata(record)?;
        let aad = self.aad(&metadata, revision)?;
        let plaintext = serde_json::to_vec(record).map_err(|error| {
            store_error(format!(
                "tenant-root role-private record encoding failed: {error}"
            ))
        })?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_ROLE_D1_HPKE_INFO,
            &aad,
            &plaintext,
        )
        .map_err(|error| {
            store_error(format!(
                "tenant-root role-private D1 encryption failed: {error}"
            ))
        })?;
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        serde_json::to_string(&TenantRootRoleD1CiphertextV1 {
            key_version: self.key_version.clone(),
            tenant_identity_digest_hex: metadata.identity_digest_hex,
            custody_lineage_b64u: metadata.custody_lineage_b64u,
            tenant_root_share_epoch: metadata.epoch,
            role: metadata.role,
            lifecycle: metadata.lifecycle,
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root role-private ciphertext encoding failed: {error}"
            ))
        })
    }

    fn seal_restore_import_ikm(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        ikm: &[u8; TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES],
    ) -> worker::Result<String> {
        binding.validate()?;
        self.require_role(binding.role)?;
        require_nonzero_bytes("tenant-root restore import key IKM", ikm)?;
        let lifecycle = CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued;
        let aad = self.restore_import_key_aad(binding, lifecycle)?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_RESTORE_IMPORT_KEY_D1_HPKE_INFO,
            &aad,
            ikm,
        )
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore import key encryption failed: {error}"
            ))
        })?;
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        if payload.len() > MAX_RESTORE_IMPORT_KEY_CIPHERTEXT_BYTES {
            return Err(store_error(
                "tenant-root restore import key ciphertext exceeds its size limit",
            ));
        }
        let identity_digest_hex = encode_hex(binding.identity_digest.as_bytes());
        let custody_lineage_b64u = binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(binding.restore_session_id.as_bytes());
        let public_key_b64u = encode_base64url_bytes_v1(binding.import_public_key.as_bytes());
        serde_json::to_string(&TenantRootRestoreImportKeyCiphertextV1 {
            key_version: self.key_version.clone(),
            tenant_identity_digest_hex: identity_digest_hex,
            custody_lineage_b64u,
            restore_session_id_hex,
            role: binding.role,
            generation: binding.generation,
            import_key_id: binding.import_key_id.clone(),
            public_key_b64u,
            issued_at_ms: binding.issued_at_ms,
            expires_at_ms: binding.expires_at_ms,
            lifecycle: lifecycle.as_str().to_owned(),
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore import key ciphertext encoding failed: {error}"
            ))
        })
    }

    fn seal_restore_imported_share(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        envelope_digest: &[u8; 32],
        share_bytes: &[u8],
    ) -> worker::Result<String> {
        binding.validate()?;
        self.require_role(binding.role)?;
        require_nonzero_bytes(
            "tenant-root restore imported share envelope digest",
            envelope_digest,
        )?;
        if share_bytes.len() != SigningRootShareWire::LEN {
            return Err(store_error(
                "tenant-root restore imported share wire has an invalid length",
            ));
        }
        let identity_digest_hex = encode_hex(binding.identity_digest.as_bytes());
        let custody_lineage_b64u = binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(binding.restore_session_id.as_bytes());
        let envelope_digest_hex = encode_hex(envelope_digest);
        let share_commitment_b64u = encode_base64url_bytes_v1(&binding.share_commitment);
        let aad = self.restore_imported_share_aad(
            binding,
            &identity_digest_hex,
            &custody_lineage_b64u,
            &restore_session_id_hex,
            &envelope_digest_hex,
            &share_commitment_b64u,
        )?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_RESTORE_IMPORTED_SHARE_D1_HPKE_INFO,
            &aad,
            share_bytes,
        )
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore imported share encryption failed: {error}"
            ))
        })?;
        if ciphertext.len() != SigningRootShareWire::LEN + 16 {
            return Err(store_error(
                "tenant-root restore imported share ciphertext has an invalid length",
            ));
        }
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        if payload.len() > MAX_RESTORE_IMPORTED_SHARE_CIPHERTEXT_BYTES {
            return Err(store_error(
                "tenant-root restore imported share ciphertext exceeds its size limit",
            ));
        }
        serde_json::to_string(&TenantRootRestoreImportedShareCiphertextV1 {
            key_version: self.key_version.clone(),
            tenant_identity_digest_hex: identity_digest_hex,
            custody_lineage_b64u,
            restore_session_id_hex,
            role: binding.role,
            generation: binding.generation,
            import_key_id: binding.import_key_id.clone(),
            envelope_digest_hex,
            share_commitment_b64u,
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore imported share ciphertext encoding failed: {error}"
            ))
        })
    }

    fn restore_imported_share_aad(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        identity_digest_hex: &str,
        custody_lineage_b64u: &str,
        restore_session_id_hex: &str,
        envelope_digest_hex: &str,
        share_commitment_b64u: &str,
    ) -> worker::Result<Vec<u8>> {
        serde_json::to_vec(&TenantRootRestoreImportedShareAadV1 {
            environment: &self.environment,
            worker_role: self.role,
            tenant_identity_digest_hex: identity_digest_hex,
            custody_lineage_b64u,
            restore_session_id_hex,
            role: binding.role,
            generation: binding.generation,
            import_key_id: &binding.import_key_id,
            envelope_digest_hex,
            share_commitment_b64u,
            purpose: TENANT_ROOT_RESTORE_IMPORTED_SHARE_D1_PURPOSE,
            schema: TENANT_ROOT_RESTORE_IMPORTED_SHARE_D1_SCHEMA,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore imported share AAD encoding failed: {error}"
            ))
        })
    }

    fn open_restore_imported_share(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> worker::Result<SigningRootShare> {
        record.binding.validate()?;
        self.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed {
            return Err(store_error(
                "tenant-root restore imported share is not installed",
            ));
        }
        let envelope_digest = record.envelope_digest.ok_or_else(|| {
            store_error("tenant-root restore imported share envelope digest is missing")
        })?;
        let encoded = record.encrypted_imported_share_json()?;
        if encoded.len() > 8 * 1024 {
            return Err(store_error(
                "tenant-root restore imported share ciphertext JSON exceeds its size limit",
            ));
        }
        let envelope: TenantRootRestoreImportedShareCiphertextV1 = serde_json::from_str(encoded)
            .map_err(|error| {
                store_error(format!(
                    "tenant-root restore imported share ciphertext decoding failed: {error}"
                ))
            })?;
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let expected_envelope_digest_hex = encode_hex(&envelope_digest);
        let expected_share_commitment_b64u =
            encode_base64url_bytes_v1(&record.binding.share_commitment);
        if envelope.key_version != self.key_version
            || envelope.tenant_identity_digest_hex != identity_digest_hex
            || envelope.custody_lineage_b64u != custody_lineage_b64u
            || envelope.restore_session_id_hex != restore_session_id_hex
            || envelope.role != record.binding.role
            || envelope.generation != record.binding.generation
            || envelope.import_key_id != record.binding.import_key_id
            || envelope.envelope_digest_hex != expected_envelope_digest_hex
            || envelope.share_commitment_b64u != expected_share_commitment_b64u
        {
            return Err(store_error(
                "tenant-root restore imported share ciphertext metadata does not match its row",
            ));
        }
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore imported share ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len()
                != CloudflareHpkeKemV1::ENCAPPED_KEY_LEN + SigningRootShareWire::LEN + 16
            || payload.len() > MAX_RESTORE_IMPORTED_SHARE_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore imported share ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|_| {
            store_error("tenant-root restore imported share encapsulation is invalid")
        })?;
        let aad = self.restore_imported_share_aad(
            &record.binding,
            &identity_digest_hex,
            &custody_lineage_b64u,
            &restore_session_id_hex,
            &expected_envelope_digest_hex,
            &expected_share_commitment_b64u,
        )?;
        let plaintext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped_key,
                &self.private_key,
                TENANT_ROOT_RESTORE_IMPORTED_SHARE_D1_HPKE_INFO,
                &aad,
                ciphertext,
            )
            .map_err(|_| store_error("tenant-root restore imported share decryption failed"))?,
        );
        let share = SigningRootShareWire::decode_slice(&plaintext)
            .and_then(|wire| wire.to_share())
            .map_err(|_| store_error("tenant-root restore imported share plaintext is invalid"))?;
        if share.id() != tenant_root_protocol_role_of(record.binding.role).share_id()
            || SigningRootShareCommitment::from_share(&share).to_bytes()
                != record.binding.share_commitment
        {
            return Err(store_error(
                "tenant-root restore imported share does not match its accepted commitment",
            ));
        }
        Ok(share)
    }

    fn restore_refresh_seed_aad(
        &self,
        binding: &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
    ) -> worker::Result<Vec<u8>> {
        let import = binding.import_binding();
        let identity_digest_hex = encode_hex(import.identity_digest.as_bytes());
        let custody_lineage_b64u = import.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(import.restore_session_id.as_bytes());
        let recovery_set_id_b64u = import.recovery_set_id.to_base64url();
        let destination_fingerprint_hex = encode_hex(import.destination_fingerprint.as_bytes());
        let manifest_digest_hex = encode_hex(&import.manifest_digest);
        let stable_root_commitment_b64u = encode_base64url_bytes_v1(&import.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&import.share_commitment);
        let import_replay_key_digest_hex = encode_hex(&import.replay_key_digest);
        let import_command_digest_hex = encode_hex(&import.command_digest);
        let import_operation_digest_hex = encode_hex(&import.operation_digest);
        let import_public_key_b64u = encode_base64url_bytes_v1(import.import_public_key.as_bytes());
        let refresh_command_digest_hex = encode_hex(binding.command_digest());
        serde_json::to_vec(&TenantRootRestoreRefreshSeedAadV1 {
            environment: &self.environment,
            worker_role: self.role,
            tenant_identity_digest_hex: &identity_digest_hex,
            custody_lineage_b64u: &custody_lineage_b64u,
            restore_session_id_hex: &restore_session_id_hex,
            recovery_set_id_b64u: &recovery_set_id_b64u,
            destination_fingerprint_hex: &destination_fingerprint_hex,
            manifest_digest_hex: &manifest_digest_hex,
            stable_root_commitment_b64u: &stable_root_commitment_b64u,
            share_commitment_b64u: &share_commitment_b64u,
            role: import.role,
            generation: import.generation,
            import_key_id: &import.import_key_id,
            import_replay_key_digest_hex: &import_replay_key_digest_hex,
            import_command_digest_hex: &import_command_digest_hex,
            import_operation_digest_hex: &import_operation_digest_hex,
            import_public_key_b64u: &import_public_key_b64u,
            import_issued_at_ms: import.issued_at_ms,
            import_expires_at_ms: import.expires_at_ms,
            refresh_command_digest_hex: &refresh_command_digest_hex,
            issued_at_ms: binding.issued_at_ms,
            expires_at_ms: binding.expires_at_ms,
            admitted_at_ms: binding.admitted_at_ms,
            purpose: TENANT_ROOT_RESTORE_REFRESH_SEED_D1_PURPOSE,
            schema: TENANT_ROOT_RESTORE_REFRESH_SEED_D1_SCHEMA,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refresh replay seed AAD encoding failed: {error}"
            ))
        })
    }

    fn restore_refresh_share_aad(
        &self,
        binding: &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
        evidence_digest_hex: &str,
    ) -> worker::Result<Vec<u8>> {
        let import = binding.import_binding();
        let identity_digest_hex = encode_hex(import.identity_digest.as_bytes());
        let custody_lineage_b64u = import.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(import.restore_session_id.as_bytes());
        let recovery_set_id_b64u = import.recovery_set_id.to_base64url();
        let destination_fingerprint_hex = encode_hex(import.destination_fingerprint.as_bytes());
        let manifest_digest_hex = encode_hex(&import.manifest_digest);
        let stable_root_commitment_b64u = encode_base64url_bytes_v1(&import.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&import.share_commitment);
        let import_replay_key_digest_hex = encode_hex(&import.replay_key_digest);
        let import_command_digest_hex = encode_hex(&import.command_digest);
        let import_operation_digest_hex = encode_hex(&import.operation_digest);
        let import_public_key_b64u = encode_base64url_bytes_v1(import.import_public_key.as_bytes());
        let refresh_command_digest_hex = encode_hex(binding.command_digest());
        serde_json::to_vec(&TenantRootRestoreRefreshShareAadV1 {
            environment: &self.environment,
            worker_role: self.role,
            tenant_identity_digest_hex: &identity_digest_hex,
            custody_lineage_b64u: &custody_lineage_b64u,
            restore_session_id_hex: &restore_session_id_hex,
            recovery_set_id_b64u: &recovery_set_id_b64u,
            destination_fingerprint_hex: &destination_fingerprint_hex,
            manifest_digest_hex: &manifest_digest_hex,
            stable_root_commitment_b64u: &stable_root_commitment_b64u,
            share_commitment_b64u: &share_commitment_b64u,
            role: import.role,
            generation: import.generation,
            import_key_id: &import.import_key_id,
            import_replay_key_digest_hex: &import_replay_key_digest_hex,
            import_command_digest_hex: &import_command_digest_hex,
            import_operation_digest_hex: &import_operation_digest_hex,
            import_public_key_b64u: &import_public_key_b64u,
            import_issued_at_ms: import.issued_at_ms,
            import_expires_at_ms: import.expires_at_ms,
            refresh_command_digest_hex: &refresh_command_digest_hex,
            evidence_digest_hex,
            purpose: TENANT_ROOT_RESTORE_REFRESH_SHARE_D1_PURPOSE,
            schema: TENANT_ROOT_RESTORE_REFRESH_SHARE_D1_SCHEMA,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refresh share AAD encoding failed: {error}"
            ))
        })
    }

    fn restore_promotion_aad(
        &self,
        binding: &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
        provider_binding_aad_b64u: &str,
    ) -> worker::Result<Vec<u8>> {
        let import = binding.import_binding();
        let identity_digest_hex = encode_hex(import.identity_digest.as_bytes());
        let custody_lineage_b64u = import.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(import.restore_session_id.as_bytes());
        let recovery_set_id_b64u = import.recovery_set_id.to_base64url();
        let destination_fingerprint_hex = encode_hex(import.destination_fingerprint.as_bytes());
        let manifest_digest_hex = encode_hex(&import.manifest_digest);
        let stable_root_commitment_b64u = encode_base64url_bytes_v1(&import.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&import.share_commitment);
        let import_replay_key_digest_hex = encode_hex(&import.replay_key_digest);
        let import_command_digest_hex = encode_hex(&import.command_digest);
        let import_operation_digest_hex = encode_hex(&import.operation_digest);
        let import_public_key_b64u = encode_base64url_bytes_v1(import.import_public_key.as_bytes());
        let refresh_command_digest_hex = encode_hex(binding.command_digest());
        serde_json::to_vec(&TenantRootRestorePromotionAadV1 {
            environment: &self.environment,
            worker_role: self.role,
            tenant_identity_digest_hex: &identity_digest_hex,
            custody_lineage_b64u: &custody_lineage_b64u,
            restore_session_id_hex: &restore_session_id_hex,
            recovery_set_id_b64u: &recovery_set_id_b64u,
            destination_fingerprint_hex: &destination_fingerprint_hex,
            manifest_digest_hex: &manifest_digest_hex,
            stable_root_commitment_b64u: &stable_root_commitment_b64u,
            share_commitment_b64u: &share_commitment_b64u,
            role: import.role,
            generation: import.generation,
            import_key_id: &import.import_key_id,
            import_replay_key_digest_hex: &import_replay_key_digest_hex,
            import_command_digest_hex: &import_command_digest_hex,
            import_operation_digest_hex: &import_operation_digest_hex,
            import_public_key_b64u: &import_public_key_b64u,
            import_issued_at_ms: import.issued_at_ms,
            import_expires_at_ms: import.expires_at_ms,
            refresh_command_digest_hex: &refresh_command_digest_hex,
            provider_binding_aad_b64u,
            purpose: TENANT_ROOT_RESTORE_PROMOTION_D1_PURPOSE,
            schema: TENANT_ROOT_RESTORE_PROMOTION_D1_SCHEMA,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refresh promotion AAD encoding failed: {error}"
            ))
        })
    }

    fn seal_restore_refresh_promotion_output(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
        sealed: &TenantRootSealedOnlineRoleShareV1,
    ) -> worker::Result<String> {
        if record.lifecycle() != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
        {
            return Err(store_error(
                "tenant-root restore refresh promotion requires a refreshed attempt",
            ));
        }
        let binding = record.binding();
        let import = binding.import_binding();
        if sealed.binding().identity_digest() != import.identity_digest
            || sealed.binding().custody_lineage() != import.custody_lineage
            || sealed.binding().role() != tenant_root_protocol_role_of(import.role)
            || sealed.binding().epoch() != TenantRootShareEpoch::INITIAL
        {
            return Err(store_error(
                "tenant-root restore refresh promotion provider binding does not match its row",
            ));
        }
        let provider_binding_aad = sealed.aad().map_err(|error| store_error(error.message()))?;
        let provider_binding_aad_b64u = encode_base64url_bytes_v1(&provider_binding_aad);
        let aad = self.restore_promotion_aad(binding, &provider_binding_aad_b64u)?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_RESTORE_PROMOTION_D1_HPKE_INFO,
            &aad,
            sealed.ciphertext(),
        )
        .map_err(|_| {
            store_error("tenant-root restore refresh promotion output encryption failed")
        })?;
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        if payload.len() > MAX_RESTORE_PROMOTION_ROLE_CIPHERTEXT_BYTES {
            return Err(store_error(
                "tenant-root restore refresh promotion ciphertext exceeds its size limit",
            ));
        }
        let identity_digest_hex = encode_hex(import.identity_digest.as_bytes());
        let custody_lineage_b64u = import.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(import.restore_session_id.as_bytes());
        let recovery_set_id_b64u = import.recovery_set_id.to_base64url();
        let destination_fingerprint_hex = encode_hex(import.destination_fingerprint.as_bytes());
        let manifest_digest_hex = encode_hex(&import.manifest_digest);
        let stable_root_commitment_b64u = encode_base64url_bytes_v1(&import.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&import.share_commitment);
        let import_replay_key_digest_hex = encode_hex(&import.replay_key_digest);
        let import_command_digest_hex = encode_hex(&import.command_digest);
        let import_operation_digest_hex = encode_hex(&import.operation_digest);
        let import_public_key_b64u = encode_base64url_bytes_v1(import.import_public_key.as_bytes());
        let refresh_command_digest_hex = encode_hex(binding.command_digest());
        serde_json::to_string(&TenantRootRestorePromotionRoleCiphertextV1 {
            key_version: self.key_version.clone(),
            tenant_identity_digest_hex: identity_digest_hex,
            custody_lineage_b64u,
            restore_session_id_hex,
            recovery_set_id_b64u,
            destination_fingerprint_hex,
            manifest_digest_hex,
            stable_root_commitment_b64u,
            share_commitment_b64u,
            role: import.role,
            generation: import.generation,
            import_key_id: import.import_key_id.clone(),
            import_replay_key_digest_hex,
            import_command_digest_hex,
            import_operation_digest_hex,
            import_public_key_b64u,
            import_issued_at_ms: import.issued_at_ms,
            import_expires_at_ms: import.expires_at_ms,
            refresh_command_digest_hex,
            provider_binding_aad_b64u,
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refresh promotion ciphertext encoding failed: {error}"
            ))
        })
    }

    fn open_restore_refresh_promotion_output(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
    ) -> worker::Result<(Vec<u8>, Vec<u8>, Vec<u8>)> {
        if record.promotion_lifecycle()
            != CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed
        {
            return Err(store_error(
                "tenant-root restore refresh promotion is not complete",
            ));
        }
        let binding = record.binding();
        let import = binding.import_binding();
        let encoded = record.encrypted_online_role_share_json()?;
        if encoded.len() > 8 * 1024 {
            return Err(store_error(
                "tenant-root restore refresh promotion ciphertext JSON exceeds its size limit",
            ));
        }
        let envelope: TenantRootRestorePromotionRoleCiphertextV1 = serde_json::from_str(encoded)
            .map_err(|_| {
                store_error("tenant-root restore refresh promotion ciphertext is malformed")
            })?;
        let identity_digest_hex = encode_hex(import.identity_digest.as_bytes());
        let custody_lineage_b64u = import.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(import.restore_session_id.as_bytes());
        let recovery_set_id_b64u = import.recovery_set_id.to_base64url();
        let destination_fingerprint_hex = encode_hex(import.destination_fingerprint.as_bytes());
        let manifest_digest_hex = encode_hex(&import.manifest_digest);
        let stable_root_commitment_b64u = encode_base64url_bytes_v1(&import.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&import.share_commitment);
        let import_replay_key_digest_hex = encode_hex(&import.replay_key_digest);
        let import_command_digest_hex = encode_hex(&import.command_digest);
        let import_operation_digest_hex = encode_hex(&import.operation_digest);
        let import_public_key_b64u = encode_base64url_bytes_v1(import.import_public_key.as_bytes());
        let refresh_command_digest_hex = encode_hex(binding.command_digest());
        if envelope.key_version != self.key_version
            || envelope.tenant_identity_digest_hex != identity_digest_hex
            || envelope.custody_lineage_b64u != custody_lineage_b64u
            || envelope.restore_session_id_hex != restore_session_id_hex
            || envelope.recovery_set_id_b64u != recovery_set_id_b64u
            || envelope.destination_fingerprint_hex != destination_fingerprint_hex
            || envelope.manifest_digest_hex != manifest_digest_hex
            || envelope.stable_root_commitment_b64u != stable_root_commitment_b64u
            || envelope.share_commitment_b64u != share_commitment_b64u
            || envelope.role != import.role
            || envelope.generation != import.generation
            || envelope.import_key_id != import.import_key_id
            || envelope.import_replay_key_digest_hex != import_replay_key_digest_hex
            || envelope.import_command_digest_hex != import_command_digest_hex
            || envelope.import_operation_digest_hex != import_operation_digest_hex
            || envelope.import_public_key_b64u != import_public_key_b64u
            || envelope.import_issued_at_ms != import.issued_at_ms
            || envelope.import_expires_at_ms != import.expires_at_ms
            || envelope.refresh_command_digest_hex != refresh_command_digest_hex
        {
            return Err(store_error(
                "tenant-root restore refresh promotion ciphertext metadata does not match its row",
            ));
        }
        let provider_binding_aad = decode_base64url_bytes_v1(
            "tenant-root restore refresh promotion provider binding",
            &envelope.provider_binding_aad_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&provider_binding_aad) != envelope.provider_binding_aad_b64u
            || provider_binding_aad.is_empty()
        {
            return Err(store_error(
                "tenant-root restore refresh promotion provider binding is malformed",
            ));
        }
        let aad = self.restore_promotion_aad(binding, &envelope.provider_binding_aad_b64u)?;
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore refresh promotion ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len() < CloudflareHpkeKemV1::ENCAPPED_KEY_LEN + 1 + 16
            || payload.len() > MAX_RESTORE_PROMOTION_ROLE_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore refresh promotion ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|_| {
            store_error("tenant-root restore refresh promotion encapsulation is invalid")
        })?;
        let provider_ciphertext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped_key,
                &self.private_key,
                TENANT_ROOT_RESTORE_PROMOTION_D1_HPKE_INFO,
                &aad,
                ciphertext,
            )
            .map_err(|_| store_error("tenant-root restore refresh promotion decryption failed"))?,
        );
        if provider_ciphertext.is_empty() || provider_ciphertext.len() > MAX_SEALED_ROLE_SHARE_BYTES
        {
            return Err(store_error(
                "tenant-root restore refresh promotion provider ciphertext is malformed",
            ));
        }
        let canary = decode_base64url_bytes_v1(
            "tenant-root restore refresh provider canary",
            record.provider_canary_receipt_b64u()?,
        )
        .map_err(|error| store_error(error.message()))?;
        Ok((provider_ciphertext.to_vec(), provider_binding_aad, canary))
    }

    fn seal_restore_refresh_seed(
        &self,
        binding: &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
        replay_seed: &[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES],
    ) -> worker::Result<String> {
        binding.import_binding().validate()?;
        self.require_role(binding.import_binding().role)?;
        require_nonzero_bytes("tenant-root restore refresh replay seed", replay_seed)?;
        let aad = self.restore_refresh_seed_aad(binding)?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_RESTORE_REFRESH_SEED_D1_HPKE_INFO,
            &aad,
            replay_seed,
        )
        .map_err(|_| store_error("tenant-root restore refresh replay seed encryption failed"))?;
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        if payload.len() > MAX_RESTORE_REFRESH_SEED_CIPHERTEXT_BYTES {
            return Err(store_error(
                "tenant-root restore refresh replay seed ciphertext exceeds its size limit",
            ));
        }
        let import = binding.import_binding();
        let identity_digest_hex = encode_hex(import.identity_digest.as_bytes());
        let custody_lineage_b64u = import.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(import.restore_session_id.as_bytes());
        let recovery_set_id_b64u = import.recovery_set_id.to_base64url();
        let destination_fingerprint_hex = encode_hex(import.destination_fingerprint.as_bytes());
        let manifest_digest_hex = encode_hex(&import.manifest_digest);
        let stable_root_commitment_b64u = encode_base64url_bytes_v1(&import.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&import.share_commitment);
        let import_replay_key_digest_hex = encode_hex(&import.replay_key_digest);
        let import_command_digest_hex = encode_hex(&import.command_digest);
        let import_operation_digest_hex = encode_hex(&import.operation_digest);
        let import_public_key_b64u = encode_base64url_bytes_v1(import.import_public_key.as_bytes());
        let refresh_command_digest_hex = encode_hex(binding.command_digest());
        serde_json::to_string(&TenantRootRestoreRefreshSeedCiphertextV1 {
            key_version: self.key_version.clone(),
            tenant_identity_digest_hex: identity_digest_hex,
            custody_lineage_b64u,
            restore_session_id_hex,
            recovery_set_id_b64u,
            destination_fingerprint_hex,
            manifest_digest_hex,
            stable_root_commitment_b64u,
            share_commitment_b64u,
            role: import.role,
            generation: import.generation,
            import_key_id: import.import_key_id.clone(),
            import_replay_key_digest_hex,
            import_command_digest_hex,
            import_operation_digest_hex,
            import_public_key_b64u,
            import_issued_at_ms: import.issued_at_ms,
            import_expires_at_ms: import.expires_at_ms,
            refresh_command_digest_hex,
            issued_at_ms: binding.issued_at_ms,
            expires_at_ms: binding.expires_at_ms,
            admitted_at_ms: binding.admitted_at_ms,
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refresh replay seed ciphertext encoding failed: {error}"
            ))
        })
    }

    fn open_restore_refresh_seed(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
    ) -> worker::Result<zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]>>
    {
        let binding = record.binding();
        binding.import_binding().validate()?;
        self.require_role(binding.import_binding().role)?;
        let encoded = record.encrypted_seed_json()?;
        if encoded.len() > 8 * 1024 {
            return Err(store_error(
                "tenant-root restore refresh replay seed ciphertext JSON exceeds its size limit",
            ));
        }
        let envelope: TenantRootRestoreRefreshSeedCiphertextV1 = serde_json::from_str(encoded)
            .map_err(|_| {
                store_error("tenant-root restore refresh replay seed ciphertext is malformed")
            })?;
        let import = binding.import_binding();
        let identity_digest_hex = encode_hex(import.identity_digest.as_bytes());
        let custody_lineage_b64u = import.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(import.restore_session_id.as_bytes());
        let recovery_set_id_b64u = import.recovery_set_id.to_base64url();
        let destination_fingerprint_hex = encode_hex(import.destination_fingerprint.as_bytes());
        let manifest_digest_hex = encode_hex(&import.manifest_digest);
        let stable_root_commitment_b64u = encode_base64url_bytes_v1(&import.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&import.share_commitment);
        let import_replay_key_digest_hex = encode_hex(&import.replay_key_digest);
        let import_command_digest_hex = encode_hex(&import.command_digest);
        let import_operation_digest_hex = encode_hex(&import.operation_digest);
        let import_public_key_b64u = encode_base64url_bytes_v1(import.import_public_key.as_bytes());
        let refresh_command_digest_hex = encode_hex(binding.command_digest());
        if envelope.key_version != self.key_version
            || envelope.tenant_identity_digest_hex != identity_digest_hex
            || envelope.custody_lineage_b64u != custody_lineage_b64u
            || envelope.restore_session_id_hex != restore_session_id_hex
            || envelope.recovery_set_id_b64u != recovery_set_id_b64u
            || envelope.destination_fingerprint_hex != destination_fingerprint_hex
            || envelope.manifest_digest_hex != manifest_digest_hex
            || envelope.stable_root_commitment_b64u != stable_root_commitment_b64u
            || envelope.share_commitment_b64u != share_commitment_b64u
            || envelope.role != import.role
            || envelope.generation != import.generation
            || envelope.import_key_id != import.import_key_id
            || envelope.import_replay_key_digest_hex != import_replay_key_digest_hex
            || envelope.import_command_digest_hex != import_command_digest_hex
            || envelope.import_operation_digest_hex != import_operation_digest_hex
            || envelope.import_public_key_b64u != import_public_key_b64u
            || envelope.import_issued_at_ms != import.issued_at_ms
            || envelope.import_expires_at_ms != import.expires_at_ms
            || envelope.refresh_command_digest_hex != refresh_command_digest_hex
            || envelope.issued_at_ms != binding.issued_at_ms
            || envelope.expires_at_ms != binding.expires_at_ms
            || envelope.admitted_at_ms != binding.admitted_at_ms
        {
            return Err(store_error(
                "tenant-root restore refresh replay seed ciphertext metadata does not match its row",
            ));
        }
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore refresh replay seed ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len()
                != CloudflareHpkeKemV1::ENCAPPED_KEY_LEN
                    + TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES
                    + 16
            || payload.len() > MAX_RESTORE_REFRESH_SEED_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore refresh replay seed ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|_| {
            store_error("tenant-root restore refresh replay seed encapsulation is invalid")
        })?;
        let aad = self.restore_refresh_seed_aad(binding)?;
        let plaintext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped_key,
                &self.private_key,
                TENANT_ROOT_RESTORE_REFRESH_SEED_D1_HPKE_INFO,
                &aad,
                ciphertext,
            )
            .map_err(|_| {
                store_error("tenant-root restore refresh replay seed decryption failed")
            })?,
        );
        if plaintext.len() != TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES {
            return Err(store_error(
                "tenant-root restore refresh replay seed length is invalid",
            ));
        }
        let mut replay_seed =
            zeroize::Zeroizing::new([0_u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]);
        replay_seed.copy_from_slice(&plaintext);
        require_nonzero_bytes(
            "tenant-root restore refresh replay seed",
            replay_seed.as_ref(),
        )?;
        Ok(replay_seed)
    }

    fn seal_restore_refresh_share(
        &self,
        binding: &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
        evidence_digest: &[u8; 32],
        share_wire: &SigningRootShareWire,
    ) -> worker::Result<String> {
        binding.import_binding().validate()?;
        self.require_role(binding.import_binding().role)?;
        require_nonzero_bytes(
            "tenant-root restore refresh installation evidence digest",
            evidence_digest,
        )?;
        let share = share_wire
            .to_share()
            .map_err(|_| store_error("tenant-root restore refreshed share is invalid"))?;
        if share.id() != tenant_root_protocol_role_of(binding.import_binding().role).share_id() {
            return Err(store_error(
                "tenant-root restore refreshed share belongs to the wrong role",
            ));
        }
        let aad = self.restore_refresh_share_aad(binding, &encode_hex(evidence_digest))?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let share_bytes = share_wire.to_bytes();
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_RESTORE_REFRESH_SHARE_D1_HPKE_INFO,
            &aad,
            &share_bytes,
        )
        .map_err(|_| store_error("tenant-root restore refreshed share encryption failed"))?;
        if ciphertext.len() != SigningRootShareWire::LEN + 16 {
            return Err(store_error(
                "tenant-root restore refreshed share ciphertext has an invalid length",
            ));
        }
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        if payload.len() > MAX_RESTORE_REFRESH_SHARE_CIPHERTEXT_BYTES {
            return Err(store_error(
                "tenant-root restore refreshed share ciphertext exceeds its size limit",
            ));
        }
        let import = binding.import_binding();
        let identity_digest_hex = encode_hex(import.identity_digest.as_bytes());
        let custody_lineage_b64u = import.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(import.restore_session_id.as_bytes());
        let recovery_set_id_b64u = import.recovery_set_id.to_base64url();
        let destination_fingerprint_hex = encode_hex(import.destination_fingerprint.as_bytes());
        let manifest_digest_hex = encode_hex(&import.manifest_digest);
        let stable_root_commitment_b64u = encode_base64url_bytes_v1(&import.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&import.share_commitment);
        let import_replay_key_digest_hex = encode_hex(&import.replay_key_digest);
        let import_command_digest_hex = encode_hex(&import.command_digest);
        let import_operation_digest_hex = encode_hex(&import.operation_digest);
        let import_public_key_b64u = encode_base64url_bytes_v1(import.import_public_key.as_bytes());
        let refresh_command_digest_hex = encode_hex(binding.command_digest());
        serde_json::to_string(&TenantRootRestoreRefreshShareCiphertextV1 {
            key_version: self.key_version.clone(),
            tenant_identity_digest_hex: identity_digest_hex,
            custody_lineage_b64u,
            restore_session_id_hex,
            recovery_set_id_b64u,
            destination_fingerprint_hex,
            manifest_digest_hex,
            stable_root_commitment_b64u,
            share_commitment_b64u,
            role: import.role,
            generation: import.generation,
            import_key_id: import.import_key_id.clone(),
            import_replay_key_digest_hex,
            import_command_digest_hex,
            import_operation_digest_hex,
            import_public_key_b64u,
            import_issued_at_ms: import.issued_at_ms,
            import_expires_at_ms: import.expires_at_ms,
            refresh_command_digest_hex,
            evidence_digest_hex: encode_hex(evidence_digest),
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refreshed share ciphertext encoding failed: {error}"
            ))
        })
    }

    fn open_restore_refresh_share(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
    ) -> worker::Result<SigningRootShare> {
        if record.lifecycle() != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
        {
            return Err(store_error(
                "tenant-root restore refreshed share is not durably staged",
            ));
        }
        let binding = record.binding();
        binding.import_binding().validate()?;
        self.require_role(binding.import_binding().role)?;
        let evidence_digest = record.installation_evidence_digest().ok_or_else(|| {
            store_error("tenant-root restore refreshed share evidence digest is missing")
        })?;
        let encoded = record.encrypted_refreshed_share_json()?;
        if encoded.len() > 8 * 1024 {
            return Err(store_error(
                "tenant-root restore refreshed share ciphertext JSON exceeds its size limit",
            ));
        }
        let envelope: TenantRootRestoreRefreshShareCiphertextV1 = serde_json::from_str(encoded)
            .map_err(|_| {
                store_error("tenant-root restore refreshed share ciphertext is malformed")
            })?;
        let import = binding.import_binding();
        let identity_digest_hex = encode_hex(import.identity_digest.as_bytes());
        let custody_lineage_b64u = import.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(import.restore_session_id.as_bytes());
        let recovery_set_id_b64u = import.recovery_set_id.to_base64url();
        let destination_fingerprint_hex = encode_hex(import.destination_fingerprint.as_bytes());
        let manifest_digest_hex = encode_hex(&import.manifest_digest);
        let stable_root_commitment_b64u = encode_base64url_bytes_v1(&import.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&import.share_commitment);
        let import_replay_key_digest_hex = encode_hex(&import.replay_key_digest);
        let import_command_digest_hex = encode_hex(&import.command_digest);
        let import_operation_digest_hex = encode_hex(&import.operation_digest);
        let import_public_key_b64u = encode_base64url_bytes_v1(import.import_public_key.as_bytes());
        let refresh_command_digest_hex = encode_hex(binding.command_digest());
        let evidence_digest_hex = encode_hex(&evidence_digest);
        if envelope.key_version != self.key_version
            || envelope.tenant_identity_digest_hex != identity_digest_hex
            || envelope.custody_lineage_b64u != custody_lineage_b64u
            || envelope.restore_session_id_hex != restore_session_id_hex
            || envelope.recovery_set_id_b64u != recovery_set_id_b64u
            || envelope.destination_fingerprint_hex != destination_fingerprint_hex
            || envelope.manifest_digest_hex != manifest_digest_hex
            || envelope.stable_root_commitment_b64u != stable_root_commitment_b64u
            || envelope.share_commitment_b64u != share_commitment_b64u
            || envelope.role != import.role
            || envelope.generation != import.generation
            || envelope.import_key_id != import.import_key_id
            || envelope.import_replay_key_digest_hex != import_replay_key_digest_hex
            || envelope.import_command_digest_hex != import_command_digest_hex
            || envelope.import_operation_digest_hex != import_operation_digest_hex
            || envelope.import_public_key_b64u != import_public_key_b64u
            || envelope.import_issued_at_ms != import.issued_at_ms
            || envelope.import_expires_at_ms != import.expires_at_ms
            || envelope.refresh_command_digest_hex != refresh_command_digest_hex
            || envelope.evidence_digest_hex != evidence_digest_hex
        {
            return Err(store_error(
                "tenant-root restore refreshed share ciphertext metadata does not match its row",
            ));
        }
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore refreshed share ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len()
                != CloudflareHpkeKemV1::ENCAPPED_KEY_LEN + SigningRootShareWire::LEN + 16
            || payload.len() > MAX_RESTORE_REFRESH_SHARE_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore refreshed share ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|_| {
            store_error("tenant-root restore refreshed share encapsulation is invalid")
        })?;
        let aad = self.restore_refresh_share_aad(binding, &evidence_digest_hex)?;
        let plaintext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped_key,
                &self.private_key,
                TENANT_ROOT_RESTORE_REFRESH_SHARE_D1_HPKE_INFO,
                &aad,
                ciphertext,
            )
            .map_err(|_| store_error("tenant-root restore refreshed share decryption failed"))?,
        );
        let wire = SigningRootShareWire::decode_slice(&plaintext)
            .map_err(|_| store_error("tenant-root restore refreshed share plaintext is invalid"))?;
        let share = wire
            .to_share()
            .map_err(|_| store_error("tenant-root restore refreshed share plaintext is invalid"))?;
        if share.id() != tenant_root_protocol_role_of(import.role).share_id() {
            return Err(store_error(
                "tenant-root restore refreshed share plaintext belongs to the wrong role",
            ));
        }
        Ok(share)
    }

    fn open_restore_import_ikm(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> worker::Result<zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES]>> {
        record.binding.validate()?;
        self.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued {
            return Err(store_error(
                "tenant-root restore import key is not live for opening",
            ));
        }
        let envelope: TenantRootRestoreImportKeyCiphertextV1 =
            serde_json::from_str(record.encrypted_ikm_json()?).map_err(|error| {
                store_error(format!(
                    "tenant-root restore import key ciphertext decoding failed: {error}"
                ))
            })?;
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let public_key_b64u =
            encode_base64url_bytes_v1(record.binding.import_public_key.as_bytes());
        if envelope.key_version != self.key_version
            || envelope.tenant_identity_digest_hex != identity_digest_hex
            || envelope.custody_lineage_b64u != custody_lineage_b64u
            || envelope.restore_session_id_hex != restore_session_id_hex
            || envelope.role != record.binding.role
            || envelope.generation != record.binding.generation
            || envelope.import_key_id != record.binding.import_key_id
            || envelope.public_key_b64u != public_key_b64u
            || envelope.issued_at_ms != record.binding.issued_at_ms
            || envelope.expires_at_ms != record.binding.expires_at_ms
            || envelope.lifecycle != record.lifecycle.as_str()
        {
            return Err(store_error(
                "tenant-root restore import key ciphertext metadata does not match its row",
            ));
        }
        let aad = self.restore_import_key_aad(
            &record.binding,
            CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued,
        )?;
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore import key ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len() <= CloudflareHpkeKemV1::ENCAPPED_KEY_LEN
            || payload.len() > MAX_RESTORE_IMPORT_KEY_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore import key ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|error| {
            store_error(format!(
                "tenant-root restore import key encapsulation is invalid: {error}"
            ))
        })?;
        let plaintext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped_key,
                &self.private_key,
                TENANT_ROOT_RESTORE_IMPORT_KEY_D1_HPKE_INFO,
                &aad,
                ciphertext,
            )
            .map_err(|error| {
                store_error(format!(
                    "tenant-root restore import key decryption failed: {error}"
                ))
            })?,
        );
        if plaintext.len() != TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES {
            return Err(store_error(
                "tenant-root restore import key IKM length is invalid",
            ));
        }
        let mut ikm = zeroize::Zeroizing::new([0_u8; TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES]);
        ikm.copy_from_slice(&plaintext);
        require_nonzero_bytes("tenant-root restore import key IKM", ikm.as_ref())?;
        Ok(ikm)
    }

    fn restore_import_key_aad(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        lifecycle: CloudflareTenantRootRestoreImportKeyLifecycleV1,
    ) -> worker::Result<Vec<u8>> {
        let identity_digest_hex = encode_hex(binding.identity_digest.as_bytes());
        let custody_lineage_b64u = binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(binding.restore_session_id.as_bytes());
        let recovery_set_id_b64u = binding.recovery_set_id.to_base64url();
        let destination_fingerprint_hex = encode_hex(binding.destination_fingerprint.as_bytes());
        let manifest_digest_hex = encode_hex(&binding.manifest_digest);
        let stable_root_commitment_b64u =
            encode_base64url_bytes_v1(&binding.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&binding.share_commitment);
        let replay_key_digest_hex = encode_hex(&binding.replay_key_digest);
        let command_digest_hex = encode_hex(&binding.command_digest);
        let operation_digest_hex = encode_hex(&binding.operation_digest);
        let public_key_b64u = encode_base64url_bytes_v1(binding.import_public_key.as_bytes());
        serde_json::to_vec(&TenantRootRestoreImportKeyAadV1 {
            environment: &self.environment,
            worker_role: self.role,
            tenant_identity_digest_hex: &identity_digest_hex,
            custody_lineage_b64u: &custody_lineage_b64u,
            restore_session_id_hex: &restore_session_id_hex,
            recovery_set_id_b64u: &recovery_set_id_b64u,
            destination_fingerprint_hex: &destination_fingerprint_hex,
            manifest_digest_hex: &manifest_digest_hex,
            stable_root_commitment_b64u: &stable_root_commitment_b64u,
            share_commitment_b64u: &share_commitment_b64u,
            role: binding.role,
            generation: binding.generation,
            import_key_id: &binding.import_key_id,
            replay_key_digest_hex: &replay_key_digest_hex,
            command_digest_hex: &command_digest_hex,
            operation_digest_hex: &operation_digest_hex,
            public_key_b64u: &public_key_b64u,
            issued_at_ms: binding.issued_at_ms,
            expires_at_ms: binding.expires_at_ms,
            lifecycle: lifecycle.as_str(),
            purpose: TENANT_ROOT_RESTORE_IMPORT_KEY_D1_PURPOSE,
            schema: TENANT_ROOT_RESTORE_IMPORT_KEY_D1_SCHEMA,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore import key AAD encoding failed: {error}"
            ))
        })
    }

    fn open(
        &self,
        row: &TenantRootRoleD1RowV1,
    ) -> worker::Result<CloudflareTenantRootRoleShareRecordV1> {
        let envelope: TenantRootRoleD1CiphertextV1 = serde_json::from_str(&row.ciphertext_json)
            .map_err(|error| {
                store_error(format!(
                    "tenant-root role-private ciphertext decoding failed: {error}"
                ))
            })?;
        if envelope.key_version != self.key_version
            || envelope.tenant_identity_digest_hex != row.tenant_identity_digest_hex
            || envelope.custody_lineage_b64u != row.custody_lineage_b64u
            || epoch_i64_value(envelope.tenant_root_share_epoch)? != row.tenant_root_share_epoch
            || envelope.role.as_str() != row.role
            || envelope.lifecycle != row.lifecycle
        {
            return Err(store_error(
                "tenant-root role-private ciphertext metadata does not match its row",
            ));
        }
        self.require_role(envelope.role)?;
        let metadata = TenantRootRoleD1MetadataV1 {
            identity_digest_hex: envelope.tenant_identity_digest_hex,
            custody_lineage_b64u: envelope.custody_lineage_b64u,
            epoch: envelope.tenant_root_share_epoch,
            role: envelope.role,
            lifecycle: envelope.lifecycle,
        };
        let aad = self.aad(&metadata, row.revision)?;
        let payload = decode_base64url_bytes_v1(
            "tenant-root role-private ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len() <= CloudflareHpkeKemV1::ENCAPPED_KEY_LEN
        {
            return Err(store_error(
                "tenant-root role-private ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|error| {
            store_error(format!(
                "tenant-root role-private encapsulated key is invalid: {error}"
            ))
        })?;
        let plaintext = CloudflareHpkeSuiteV1::open_base(
            &encapped_key,
            &self.private_key,
            TENANT_ROOT_ROLE_D1_HPKE_INFO,
            &aad,
            ciphertext,
        )
        .map_err(|error| {
            store_error(format!(
                "tenant-root role-private D1 decryption failed: {error}"
            ))
        })?;
        let record = decode_tenant_root_role_d1_record_v1(plaintext)?;
        record.validate()?;
        validate_record_activation_binding(&record)?;
        let actual = record_metadata(&record)?;
        if actual != metadata
            || timestamp_i64(record.created_at_ms)? != row.created_at_ms
            || timestamp_i64(record.updated_at_ms)? != row.updated_at_ms
        {
            return Err(store_error(
                "tenant-root role-private record does not match its authenticated row",
            ));
        }
        Ok(record)
    }

    fn aad(&self, metadata: &TenantRootRoleD1MetadataV1, revision: i64) -> worker::Result<Vec<u8>> {
        if revision <= 0 {
            return Err(store_error(
                "tenant-root role-private row has an invalid revision",
            ));
        }
        let record_key = metadata.record_key();
        serde_json::to_vec(&TenantRootRoleD1AadV1 {
            environment: &self.environment,
            worker_role: self.role,
            tenant_identity_digest_hex: &metadata.identity_digest_hex,
            custody_lineage_b64u: &metadata.custody_lineage_b64u,
            tenant_root_share_epoch: metadata.epoch,
            record_role: metadata.role,
            lifecycle: &metadata.lifecycle,
            revision,
            purpose: TENANT_ROOT_ROLE_D1_PURPOSE,
            schema: TENANT_ROOT_ROLE_D1_SCHEMA,
            record_key: &record_key,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root role-private AAD encoding failed: {error}"
            ))
        })
    }

    fn require_role(&self, role: CloudflareTenantRootDeriverRoleV1) -> worker::Result<()> {
        if role != self.role {
            return Err(store_error(
                "tenant-root role-private record belongs to the other Deriver",
            ));
        }
        Ok(())
    }
}

/// Keeps the large authenticated record decoder out of the HPKE open frame.
#[inline(never)]
fn decode_tenant_root_role_d1_record_v1(
    plaintext: Vec<u8>,
) -> worker::Result<CloudflareTenantRootRoleShareRecordV1> {
    serde_json::from_slice::<TenantRootRoleD1RecordWireV1>(&plaintext)
        .map_err(|error| {
            store_error(format!(
                "tenant-root role-private record decoding failed: {error}"
            ))
        })?
        .into_record()
}

fn validate_role_private_d1_kek_key_pair(
    public_key: &<CloudflareHpkeKemV1 as Kem>::PublicKey,
    private_key: &<CloudflareHpkeKemV1 as Kem>::PrivateKey,
) -> worker::Result<()> {
    let mut rng = CloudflareHpkeGetrandomRngV1;
    let (encapped_shared_secret, encapped_key) =
        match CloudflareHpkeKemV1::encap(&mut rng, public_key) {
            Ok(pair) => pair,
            Err(error) => {
                return Err(store_error(format!(
                    "role-private D1 KEK public key validation failed: {error}"
                )));
            }
        };
    let decapped_shared_secret =
        CloudflareHpkeKemV1::decap(&encapped_key, private_key).map_err(|error| {
            store_error(format!(
                "role-private D1 KEK private key validation failed: {error}"
            ))
        })?;
    if !constant_time_bytes_equal(
        encapped_shared_secret.as_ref(),
        decapped_shared_secret.as_ref(),
    ) {
        return Err(store_error(
            "role-private D1 KEK public key does not match private key",
        ));
    }
    Ok(())
}

fn constant_time_bytes_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0_u8;
    for (left, right) in left.iter().zip(right) {
        difference |= left ^ right;
    }
    difference == 0
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TenantRootRoleD1MetadataV1 {
    identity_digest_hex: String,
    custody_lineage_b64u: String,
    epoch: u64,
    role: CloudflareTenantRootDeriverRoleV1,
    lifecycle: String,
}

impl TenantRootRoleD1MetadataV1 {
    fn record_key(&self) -> String {
        format!(
            "{}/{}/{}/{}",
            self.identity_digest_hex,
            self.custody_lineage_b64u,
            self.epoch,
            self.role.as_str()
        )
    }
}

#[derive(Debug, Deserialize)]
struct TenantRootRoleD1RowV1 {
    tenant_identity_digest_hex: String,
    custody_lineage_b64u: String,
    tenant_root_share_epoch: i64,
    role: String,
    lifecycle: String,
    ciphertext_json: String,
    revision: i64,
    created_at_ms: i64,
    updated_at_ms: i64,
}

/// Lifecycle of one destination role import key retained in role-private D1.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootRestoreImportKeyLifecycleV1 {
    Issued,
    Superseded,
    Installed,
    Expired,
    Closed,
}

impl CloudflareTenantRootRestoreImportKeyLifecycleV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::Issued => "issued",
            Self::Superseded => "superseded",
            Self::Installed => "installed",
            Self::Expired => "expired",
            Self::Closed => "closed",
        }
    }

    fn parse(value: &str) -> worker::Result<Self> {
        match value {
            "issued" => Ok(Self::Issued),
            "superseded" => Ok(Self::Superseded),
            "installed" => Ok(Self::Installed),
            "expired" => Ok(Self::Expired),
            "closed" => Ok(Self::Closed),
            _ => Err(store_error(
                "tenant-root restore import key lifecycle is invalid",
            )),
        }
    }
}

/// Immutable scope and public metadata signed by restore admission.
///
/// The private IKM is deliberately absent. It is generated and sealed only
/// after this binding has been verified at the Deriver boundary.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRestoreImportKeyBindingV1 {
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    restore_session_id: TenantRootRestoreSessionIdV1,
    recovery_set_id: TenantRootRecoverySetId,
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    manifest_digest: [u8; 32],
    stable_root_commitment: [u8; 32],
    share_commitment: [u8; 34],
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: String,
    replay_key_digest: [u8; 32],
    command_digest: [u8; 32],
    operation_digest: [u8; 32],
    import_public_key: TenantRootRestoreImportPublicKeyV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreImportKeyBindingV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreImportKeyBindingV1")
            .field("identity_digest", &self.identity_digest)
            .field("custody_lineage", &self.custody_lineage)
            .field("restore_session_id", &self.restore_session_id)
            .field("recovery_set_id", &self.recovery_set_id)
            .field("destination_fingerprint", &self.destination_fingerprint)
            .field("manifest_digest", &encode_hex(&self.manifest_digest))
            .field(
                "stable_root_commitment",
                &encode_hex(&self.stable_root_commitment),
            )
            .field("share_commitment", &encode_hex(&self.share_commitment))
            .field("role", &self.role)
            .field("generation", &self.generation)
            .field("import_key_id", &self.import_key_id)
            .field("replay_key_digest", &encode_hex(&self.replay_key_digest))
            .field("command_digest", &encode_hex(&self.command_digest))
            .field("operation_digest", &encode_hex(&self.operation_digest))
            .field("import_public_key", &self.import_public_key)
            .field("issued_at_ms", &self.issued_at_ms)
            .field("expires_at_ms", &self.expires_at_ms)
            .finish()
    }
}

impl CloudflareTenantRootRestoreImportKeyBindingV1 {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
        recovery_set_id: TenantRootRecoverySetId,
        destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
        manifest_digest: [u8; 32],
        stable_root_commitment: [u8; 32],
        share_commitment: [u8; 34],
        role: CloudflareTenantRootDeriverRoleV1,
        generation: u64,
        import_key_id: impl Into<String>,
        replay_key_digest: [u8; 32],
        command_digest: [u8; 32],
        operation_digest: [u8; 32],
        import_public_key: TenantRootRestoreImportPublicKeyV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> worker::Result<Self> {
        let binding = Self {
            identity_digest,
            custody_lineage,
            restore_session_id,
            recovery_set_id,
            destination_fingerprint,
            manifest_digest,
            stable_root_commitment,
            share_commitment,
            role,
            generation,
            import_key_id: import_key_id.into(),
            replay_key_digest,
            command_digest,
            operation_digest,
            import_public_key,
            issued_at_ms,
            expires_at_ms,
        };
        binding.validate()?;
        Ok(binding)
    }

    pub(crate) const fn identity_digest(&self) -> TenantRootIdentityDigestV1 {
        self.identity_digest
    }

    pub(crate) const fn custody_lineage(&self) -> TenantRootCustodyLineageId {
        self.custody_lineage
    }

    pub(crate) const fn restore_session_id(&self) -> TenantRootRestoreSessionIdV1 {
        self.restore_session_id
    }

    pub(crate) const fn recovery_set_id(&self) -> TenantRootRecoverySetId {
        self.recovery_set_id
    }

    pub(crate) const fn destination_fingerprint(
        &self,
    ) -> TenantRootRestoreDestinationFingerprintV1 {
        self.destination_fingerprint
    }

    pub(crate) const fn manifest_digest(&self) -> &[u8; 32] {
        &self.manifest_digest
    }

    pub(crate) const fn stable_root_commitment(&self) -> &[u8; 32] {
        &self.stable_root_commitment
    }

    pub(crate) const fn share_commitment(&self) -> &[u8; 34] {
        &self.share_commitment
    }

    pub(crate) const fn role(&self) -> CloudflareTenantRootDeriverRoleV1 {
        self.role
    }

    pub(crate) const fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn import_key_id(&self) -> &str {
        &self.import_key_id
    }

    pub(crate) const fn replay_key_digest(&self) -> &[u8; 32] {
        &self.replay_key_digest
    }

    pub(crate) const fn command_digest(&self) -> &[u8; 32] {
        &self.command_digest
    }

    pub(crate) const fn operation_digest(&self) -> &[u8; 32] {
        &self.operation_digest
    }

    pub(crate) const fn import_public_key(&self) -> TenantRootRestoreImportPublicKeyV1 {
        self.import_public_key
    }

    pub(crate) const fn issued_at_ms(&self) -> u64 {
        self.issued_at_ms
    }

    pub(crate) const fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }

    /// Compares the signed scope that selects one issuance, leaving the
    /// Deriver-generated public key and transport command digest out of the
    /// comparison. The first concurrent issuer owns the generated key; a
    /// retry or issuer-key rotation reuses its recorded public response.
    pub(crate) fn matches_authorized_scope(
        &self,
        other: &CloudflareTenantRootRestoreImportKeyBindingV1,
    ) -> bool {
        self.identity_digest == other.identity_digest
            && self.custody_lineage == other.custody_lineage
            && self.restore_session_id == other.restore_session_id
            && self.recovery_set_id == other.recovery_set_id
            && self.destination_fingerprint == other.destination_fingerprint
            && self.manifest_digest == other.manifest_digest
            && self.stable_root_commitment == other.stable_root_commitment
            && self.share_commitment == other.share_commitment
            && self.role == other.role
            && self.generation == other.generation
            && self.import_key_id == other.import_key_id
            && self.replay_key_digest == other.replay_key_digest
            && self.operation_digest == other.operation_digest
            && self.issued_at_ms == other.issued_at_ms
            && self.expires_at_ms == other.expires_at_ms
    }

    fn validate(&self) -> worker::Result<()> {
        if self.generation == 0 {
            return Err(store_error(
                "tenant-root restore import key generation must be positive",
            ));
        }
        if self.import_key_id.is_empty()
            || self.import_key_id.len() > MAX_RESTORE_IMPORT_KEY_ID_BYTES
            || self.import_key_id.trim() != self.import_key_id
            || self
                .import_key_id
                .bytes()
                .any(|byte| byte.is_ascii_control())
        {
            return Err(store_error("tenant-root restore import key id is invalid"));
        }
        require_nonzero_bytes(
            "tenant-root restore import key replay digest",
            &self.replay_key_digest,
        )?;
        require_nonzero_bytes(
            "tenant-root restore import key command digest",
            &self.command_digest,
        )?;
        require_nonzero_bytes(
            "tenant-root restore import key operation digest",
            &self.operation_digest,
        )?;
        require_nonzero_bytes(
            "tenant-root restore import manifest digest",
            &self.manifest_digest,
        )?;
        require_nonzero_bytes(
            "tenant-root restore import stable root commitment",
            &self.stable_root_commitment,
        )?;
        require_nonzero_bytes(
            "tenant-root restore import share commitment",
            &self.share_commitment,
        )?;
        if self.issued_at_ms == 0
            || self.expires_at_ms <= self.issued_at_ms
            || self.expires_at_ms - self.issued_at_ms != TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1 as u64
        {
            return Err(store_error(
                "tenant-root restore import key lifetime is invalid",
            ));
        }
        Ok(())
    }
}

/// One role-local import-key row, with encrypted IKM retained only on the
/// owning Deriver.
pub(crate) struct CloudflareTenantRootRestoreImportKeyRecordV1 {
    binding: CloudflareTenantRootRestoreImportKeyBindingV1,
    encrypted_ikm_json: Option<String>,
    envelope_digest: Option<[u8; 32]>,
    encrypted_imported_share_json: Option<String>,
    lifecycle: CloudflareTenantRootRestoreImportKeyLifecycleV1,
    installed_at_ms: Option<u64>,
    receipt_digest: Option<[u8; 32]>,
    created_at_ms: u64,
    updated_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreImportKeyRecordV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreImportKeyRecordV1")
            .field("binding", &self.binding)
            .field(
                "encrypted_ikm_json",
                &self.encrypted_ikm_json.as_ref().map(|_| "[redacted]"),
            )
            .field(
                "envelope_digest",
                &self.envelope_digest.map(|digest| encode_hex(&digest)),
            )
            .field(
                "encrypted_imported_share_json",
                &self
                    .encrypted_imported_share_json
                    .as_ref()
                    .map(|_| "[redacted]"),
            )
            .field("lifecycle", &self.lifecycle)
            .field("installed_at_ms", &self.installed_at_ms)
            .field(
                "receipt_digest",
                &self.receipt_digest.map(|digest| encode_hex(&digest)),
            )
            .field("created_at_ms", &self.created_at_ms)
            .field("updated_at_ms", &self.updated_at_ms)
            .finish()
    }
}

impl CloudflareTenantRootRestoreImportKeyRecordV1 {
    pub(crate) fn new_issued(
        binding: CloudflareTenantRootRestoreImportKeyBindingV1,
        encrypted_ikm_json: String,
    ) -> worker::Result<Self> {
        if encrypted_ikm_json.is_empty() {
            return Err(store_error(
                "tenant-root restore import key ciphertext is empty",
            ));
        }
        let record = Self {
            binding,
            encrypted_ikm_json: Some(encrypted_ikm_json),
            envelope_digest: None,
            encrypted_imported_share_json: None,
            lifecycle: CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued,
            installed_at_ms: None,
            receipt_digest: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        };
        record.validate()?;
        Ok(record)
    }

    pub(crate) fn binding(&self) -> &CloudflareTenantRootRestoreImportKeyBindingV1 {
        &self.binding
    }

    pub(crate) const fn lifecycle(&self) -> CloudflareTenantRootRestoreImportKeyLifecycleV1 {
        self.lifecycle
    }

    pub(crate) fn encrypted_ikm_json(&self) -> worker::Result<&str> {
        self.encrypted_ikm_json.as_deref().ok_or_else(|| {
            store_error("closed tenant-root restore import key has no encrypted IKM")
        })
    }

    pub(crate) fn encrypted_imported_share_json(&self) -> worker::Result<&str> {
        self.encrypted_imported_share_json
            .as_deref()
            .ok_or_else(|| {
                store_error("tenant-root restore import key has no staged imported share")
            })
    }

    pub(crate) const fn envelope_digest(&self) -> Option<[u8; 32]> {
        self.envelope_digest
    }

    pub(crate) const fn installed_at_ms(&self) -> Option<u64> {
        self.installed_at_ms
    }

    pub(crate) const fn receipt_digest(&self) -> Option<[u8; 32]> {
        self.receipt_digest
    }

    pub(crate) const fn created_at_ms(&self) -> u64 {
        self.created_at_ms
    }

    pub(crate) const fn updated_at_ms(&self) -> u64 {
        self.updated_at_ms
    }

    fn validate(&self) -> worker::Result<()> {
        self.binding.validate()?;
        if self.created_at_ms != 0 || self.updated_at_ms != 0 {
            if self.created_at_ms == 0
                || self.updated_at_ms < self.created_at_ms
                || self.updated_at_ms > i64::MAX as u64
            {
                return Err(store_error(
                    "tenant-root restore import key timestamps are invalid",
                ));
            }
        }
        match self.lifecycle {
            CloudflareTenantRootRestoreImportKeyLifecycleV1::Closed => {
                if self.encrypted_ikm_json.is_some()
                    || self.envelope_digest.is_some()
                    || self.encrypted_imported_share_json.is_some()
                    || self.installed_at_ms.is_some()
                    || self.receipt_digest.is_some()
                {
                    return Err(store_error(
                        "closed tenant-root restore import key retains secret state",
                    ));
                }
            }
            CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed => {
                if self.encrypted_ikm_json.is_none()
                    || self.envelope_digest.is_none()
                    || self.encrypted_imported_share_json.is_none()
                    || self.installed_at_ms.is_none()
                    || self.receipt_digest.is_none()
                {
                    return Err(store_error(
                        "installed tenant-root restore import key is incomplete",
                    ));
                }
            }
            CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued
            | CloudflareTenantRootRestoreImportKeyLifecycleV1::Superseded
            | CloudflareTenantRootRestoreImportKeyLifecycleV1::Expired => {
                if self.encrypted_ikm_json.is_none()
                    || self.envelope_digest.is_some()
                    || self.encrypted_imported_share_json.is_some()
                    || self.installed_at_ms.is_some()
                    || self.receipt_digest.is_some()
                {
                    return Err(store_error(
                        "uninstalled tenant-root restore import key is incomplete",
                    ));
                }
            }
        }
        Ok(())
    }
}

/// Outcome of one role-local import-key issuance transaction.
#[derive(Debug)]
pub(crate) enum CloudflareTenantRootRestoreImportKeyIssueDecisionV1 {
    Issued(CloudflareTenantRootRestoreImportKeyRecordV1),
    Replay(CloudflareTenantRootRestoreImportKeyRecordV1),
}

#[derive(Debug)]
pub(crate) enum CloudflareTenantRootRestoreImportKeyAcceptDecisionV1 {
    Accepted(CloudflareTenantRootRestoreImportKeyRecordV1),
    Replay(CloudflareTenantRootRestoreImportKeyRecordV1),
}

/// Lifecycle of one role-local refresh attempt after restore import.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1 {
    Pending,
    Refreshed,
    Closed,
}

impl CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Refreshed => "refreshed",
            Self::Closed => "closed",
        }
    }

    fn parse(value: &str) -> worker::Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "refreshed" => Ok(Self::Refreshed),
            "closed" => Ok(Self::Closed),
            _ => Err(store_error(
                "tenant-root restore refresh attempt lifecycle is invalid",
            )),
        }
    }
}

/// Lifecycle of the provider promotion attached to one refreshed attempt.
///
/// Promotion state lives on the refresh-attempt row so the staged share,
/// provider ciphertext, and canary have one durable replay boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootRestoreRefreshPromotionLifecycleV1 {
    Unstarted,
    Reserved,
    Completed,
}

impl CloudflareTenantRootRestoreRefreshPromotionLifecycleV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::Unstarted => "unstarted",
            Self::Reserved => "reserved",
            Self::Completed => "completed",
        }
    }

    fn parse(value: &str) -> worker::Result<Self> {
        match value {
            "unstarted" => Ok(Self::Unstarted),
            "reserved" => Ok(Self::Reserved),
            "completed" => Ok(Self::Completed),
            _ => Err(store_error(
                "tenant-root restore refresh promotion lifecycle is invalid",
            )),
        }
    }
}

/// The exact staged share and evidence loaded for one promotion reservation.
pub(crate) struct CloudflareTenantRootRestoreRefreshPromotionSourceV1 {
    refreshed_share: SigningRootShareWire,
    evidence_bytes: Vec<u8>,
    refreshed_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreRefreshPromotionSourceV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreRefreshPromotionSourceV1")
            .field("refreshed_share", &"[redacted]")
            .field("evidence_bytes", &self.evidence_bytes.len())
            .field("refreshed_at_ms", &self.refreshed_at_ms)
            .finish()
    }
}

impl CloudflareTenantRootRestoreRefreshPromotionSourceV1 {
    pub(crate) fn into_parts(self) -> (SigningRootShareWire, Vec<u8>, u64) {
        (
            self.refreshed_share,
            self.evidence_bytes,
            self.refreshed_at_ms,
        )
    }

    pub(crate) const fn refreshed_at_ms(&self) -> u64 {
        self.refreshed_at_ms
    }
}

/// Provider bytes and public canary retained after a promotion completes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1 {
    provider_ciphertext: Vec<u8>,
    provider_binding_aad: Vec<u8>,
    provider_canary_receipt_bytes: Vec<u8>,
    completed_at_ms: u64,
}

impl CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1 {
    pub(crate) fn provider_ciphertext(&self) -> &[u8] {
        &self.provider_ciphertext
    }

    pub(crate) fn provider_binding_aad(&self) -> &[u8] {
        &self.provider_binding_aad
    }

    pub(crate) fn provider_canary_receipt_bytes(&self) -> &[u8] {
        &self.provider_canary_receipt_bytes
    }

    pub(crate) const fn completed_at_ms(&self) -> u64 {
        self.completed_at_ms
    }
}

/// Decision returned by the durable promotion reservation.
pub(crate) enum CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1 {
    Execute {
        source: CloudflareTenantRootRestoreRefreshPromotionSourceV1,
    },
    Resume {
        source: CloudflareTenantRootRestoreRefreshPromotionSourceV1,
    },
    Replay {
        artifacts: CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1,
    },
}

impl fmt::Debug for CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match self {
            Self::Execute { .. } => "execute",
            Self::Resume { .. } => "resume",
            Self::Replay { .. } => "replay",
        };
        formatter
            .debug_struct("CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1")
            .field("kind", &kind)
            .finish()
    }
}

/// Outcome returned after provider output and canary persistence.
pub(crate) enum CloudflareTenantRootRestoreRefreshPromotionCompletionV1 {
    Committed {
        artifacts: CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1,
    },
    Replay {
        artifacts: CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1,
    },
}

impl fmt::Debug for CloudflareTenantRootRestoreRefreshPromotionCompletionV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match self {
            Self::Committed { .. } => "committed",
            Self::Replay { .. } => "replay",
        };
        formatter
            .debug_struct("CloudflareTenantRootRestoreRefreshPromotionCompletionV1")
            .field("kind", &kind)
            .finish()
    }
}

/// Result of durable restore-refresh admission before peer contact.
pub(crate) enum CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1 {
    /// The first request owns the sampled replay seed.
    Execute {
        replay_seed: zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]>,
        admitted_at_ms: u64,
    },
    /// A retry owns the already persisted replay seed.
    Resume {
        replay_seed: zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]>,
        admitted_at_ms: u64,
    },
    /// The refresh was already durably staged; the caller can replay the exact
    /// evidence and reconstruct any request-local contribution from the same seed.
    Refreshed {
        replay_seed: zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]>,
        admitted_at_ms: u64,
        evidence_bytes: Vec<u8>,
    },
}

impl fmt::Debug for CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match self {
            Self::Execute { .. } => "execute",
            Self::Resume { .. } => "resume",
            Self::Refreshed { .. } => "refreshed",
        };
        formatter
            .debug_struct("CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1")
            .field("kind", &kind)
            .field("admitted_at_ms", &self.admitted_at_ms())
            .field(
                "evidence_bytes",
                &match self {
                    Self::Refreshed { evidence_bytes, .. } => Some(evidence_bytes.len()),
                    _ => None,
                },
            )
            .finish()
    }
}

impl CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1 {
    pub(crate) const fn admitted_at_ms(&self) -> u64 {
        match self {
            Self::Execute { admitted_at_ms, .. }
            | Self::Resume { admitted_at_ms, .. }
            | Self::Refreshed { admitted_at_ms, .. } => *admitted_at_ms,
        }
    }

    pub(crate) fn seed(
        &self,
    ) -> &zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]> {
        match self {
            Self::Execute { replay_seed, .. }
            | Self::Resume { replay_seed, .. }
            | Self::Refreshed { replay_seed, .. } => replay_seed,
        }
    }

    pub(crate) fn evidence_bytes(&self) -> Option<&[u8]> {
        match self {
            Self::Refreshed { evidence_bytes, .. } => Some(evidence_bytes),
            _ => None,
        }
    }
}

/// The exact accepted import and issuer command selected by one restore
/// refresh attempt. The import binding is copied into the attempt row so a
/// later request cannot rebind a durable seed to another accepted import.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1 {
    import_binding: CloudflareTenantRootRestoreImportKeyBindingV1,
    command_digest: [u8; 32],
    issued_at_ms: u64,
    expires_at_ms: u64,
    admitted_at_ms: u64,
}

impl CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1 {
    pub(crate) fn new(
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
        command_digest: [u8; 32],
        issued_at_ms: u64,
        expires_at_ms: u64,
        admitted_at_ms: u64,
    ) -> worker::Result<Self> {
        record.validate()?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed {
            return Err(store_error(
                "tenant-root restore refresh requires an accepted import",
            ));
        }
        Self::from_import_binding(
            record.binding.clone(),
            command_digest,
            issued_at_ms,
            expires_at_ms,
            admitted_at_ms,
        )
    }

    fn from_import_binding(
        import_binding: CloudflareTenantRootRestoreImportKeyBindingV1,
        command_digest: [u8; 32],
        issued_at_ms: u64,
        expires_at_ms: u64,
        admitted_at_ms: u64,
    ) -> worker::Result<Self> {
        import_binding.validate()?;
        require_nonzero_bytes(
            "tenant-root restore refresh command digest",
            &command_digest,
        )?;
        require_timestamp(
            "tenant-root restore refresh command issue timestamp",
            issued_at_ms,
        )?;
        require_timestamp(
            "tenant-root restore refresh command expiry timestamp",
            expires_at_ms,
        )?;
        require_timestamp(
            "tenant-root restore refresh admission timestamp",
            admitted_at_ms,
        )?;
        if expires_at_ms <= issued_at_ms {
            return Err(store_error(
                "tenant-root restore refresh command lifetime is invalid",
            ));
        }
        Ok(Self {
            import_binding,
            command_digest,
            issued_at_ms,
            expires_at_ms,
            admitted_at_ms,
        })
    }

    pub(crate) const fn import_binding(&self) -> &CloudflareTenantRootRestoreImportKeyBindingV1 {
        &self.import_binding
    }

    pub(crate) const fn command_digest(&self) -> &[u8; 32] {
        &self.command_digest
    }

    pub(crate) const fn issued_at_ms(&self) -> u64 {
        self.issued_at_ms
    }

    pub(crate) const fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }

    pub(crate) const fn admitted_at_ms(&self) -> u64 {
        self.admitted_at_ms
    }
}

/// One role-local durable restore-refresh attempt. Secret fields are always
/// represented as authenticated ciphertext and omitted from Debug output.
pub(crate) struct CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1 {
    binding: CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
    encrypted_seed_json: Option<String>,
    encrypted_refreshed_share_json: Option<String>,
    installation_evidence_b64u: Option<String>,
    installation_evidence_digest: Option<[u8; 32]>,
    lifecycle: CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1,
    refreshed_at_ms: Option<u64>,
    promotion_lifecycle: CloudflareTenantRootRestoreRefreshPromotionLifecycleV1,
    promotion_reserved_at_ms: Option<u64>,
    encrypted_online_role_share_json: Option<String>,
    provider_canary_receipt_b64u: Option<String>,
    promotion_completed_at_ms: Option<u64>,
    created_at_ms: u64,
    updated_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1")
            .field("binding", &self.binding)
            .field(
                "encrypted_seed_json",
                &self.encrypted_seed_json.as_ref().map(|_| "[redacted]"),
            )
            .field(
                "encrypted_refreshed_share_json",
                &self
                    .encrypted_refreshed_share_json
                    .as_ref()
                    .map(|_| "[redacted]"),
            )
            .field(
                "installation_evidence_digest",
                &self.installation_evidence_digest,
            )
            .field("lifecycle", &self.lifecycle)
            .field("refreshed_at_ms", &self.refreshed_at_ms)
            .field("promotion_lifecycle", &self.promotion_lifecycle)
            .field("promotion_reserved_at_ms", &self.promotion_reserved_at_ms)
            .field(
                "encrypted_online_role_share_json",
                &self
                    .encrypted_online_role_share_json
                    .as_ref()
                    .map(|_| "[redacted]"),
            )
            .field(
                "provider_canary_receipt_b64u",
                &self
                    .provider_canary_receipt_b64u
                    .as_ref()
                    .map(|_| "[redacted]"),
            )
            .field("promotion_completed_at_ms", &self.promotion_completed_at_ms)
            .field("created_at_ms", &self.created_at_ms)
            .field("updated_at_ms", &self.updated_at_ms)
            .finish()
    }
}

impl CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1 {
    fn pending(
        binding: CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
        encrypted_seed_json: String,
    ) -> worker::Result<Self> {
        if encrypted_seed_json.is_empty() {
            return Err(store_error(
                "tenant-root restore refresh replay seed ciphertext is empty",
            ));
        }
        let record = Self {
            binding,
            encrypted_seed_json: Some(encrypted_seed_json),
            encrypted_refreshed_share_json: None,
            installation_evidence_b64u: None,
            installation_evidence_digest: None,
            lifecycle: CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Pending,
            refreshed_at_ms: None,
            promotion_lifecycle: CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted,
            promotion_reserved_at_ms: None,
            encrypted_online_role_share_json: None,
            provider_canary_receipt_b64u: None,
            promotion_completed_at_ms: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        };
        record.validate()?;
        Ok(record)
    }

    fn refreshed(
        binding: CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
        encrypted_seed_json: String,
        encrypted_refreshed_share_json: String,
        installation_evidence_b64u: String,
        installation_evidence_digest: [u8; 32],
        refreshed_at_ms: u64,
        created_at_ms: u64,
        updated_at_ms: u64,
    ) -> worker::Result<Self> {
        let record = Self {
            binding,
            encrypted_seed_json: Some(encrypted_seed_json),
            encrypted_refreshed_share_json: Some(encrypted_refreshed_share_json),
            installation_evidence_b64u: Some(installation_evidence_b64u),
            installation_evidence_digest: Some(installation_evidence_digest),
            lifecycle: CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed,
            refreshed_at_ms: Some(refreshed_at_ms),
            promotion_lifecycle: CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted,
            promotion_reserved_at_ms: None,
            encrypted_online_role_share_json: None,
            provider_canary_receipt_b64u: None,
            promotion_completed_at_ms: None,
            created_at_ms,
            updated_at_ms,
        };
        record.validate()?;
        Ok(record)
    }

    fn closed(
        binding: CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
        created_at_ms: u64,
        updated_at_ms: u64,
    ) -> worker::Result<Self> {
        let record = Self {
            binding,
            encrypted_seed_json: None,
            encrypted_refreshed_share_json: None,
            installation_evidence_b64u: None,
            installation_evidence_digest: None,
            lifecycle: CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed,
            refreshed_at_ms: None,
            promotion_lifecycle: CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted,
            promotion_reserved_at_ms: None,
            encrypted_online_role_share_json: None,
            provider_canary_receipt_b64u: None,
            promotion_completed_at_ms: None,
            created_at_ms,
            updated_at_ms,
        };
        record.validate()?;
        Ok(record)
    }

    pub(crate) const fn binding(&self) -> &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1 {
        &self.binding
    }

    pub(crate) const fn lifecycle(
        &self,
    ) -> CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1 {
        self.lifecycle
    }

    pub(crate) fn installation_evidence_bytes(&self) -> worker::Result<Vec<u8>> {
        let encoded = self.installation_evidence_b64u.as_deref().ok_or_else(|| {
            store_error("tenant-root restore refresh attempt has no installation evidence")
        })?;
        let bytes =
            decode_base64url_bytes_v1("tenant-root restore refresh installation evidence", encoded)
                .map_err(|error| store_error(error.message()))?;
        if bytes.is_empty()
            || bytes.len()
                > router_ab_core::TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1
            || encode_base64url_bytes_v1(&bytes) != encoded
            || self.installation_evidence_digest != Some(Sha256::digest(&bytes).into())
        {
            return Err(store_error(
                "tenant-root restore refresh installation evidence is malformed",
            ));
        }
        Ok(bytes)
    }

    pub(crate) const fn refreshed_at_ms(&self) -> Option<u64> {
        self.refreshed_at_ms
    }

    pub(crate) const fn promotion_lifecycle(
        &self,
    ) -> CloudflareTenantRootRestoreRefreshPromotionLifecycleV1 {
        self.promotion_lifecycle
    }

    pub(crate) const fn promotion_reserved_at_ms(&self) -> Option<u64> {
        self.promotion_reserved_at_ms
    }

    fn encrypted_online_role_share_json(&self) -> worker::Result<&str> {
        self.encrypted_online_role_share_json
            .as_deref()
            .ok_or_else(|| {
                store_error("tenant-root restore refresh promotion has no provider ciphertext")
            })
    }

    fn provider_canary_receipt_b64u(&self) -> worker::Result<&str> {
        self.provider_canary_receipt_b64u.as_deref().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no provider canary")
        })
    }

    pub(crate) const fn promotion_completed_at_ms(&self) -> Option<u64> {
        self.promotion_completed_at_ms
    }

    pub(crate) const fn created_at_ms(&self) -> u64 {
        self.created_at_ms
    }

    pub(crate) const fn updated_at_ms(&self) -> u64 {
        self.updated_at_ms
    }

    fn encrypted_seed_json(&self) -> worker::Result<&str> {
        self.encrypted_seed_json
            .as_deref()
            .ok_or_else(|| store_error("tenant-root restore refresh attempt has no replay seed"))
    }

    fn encrypted_refreshed_share_json(&self) -> worker::Result<&str> {
        self.encrypted_refreshed_share_json
            .as_deref()
            .ok_or_else(|| {
                store_error("tenant-root restore refresh attempt has no refreshed share")
            })
    }

    fn installation_evidence_digest(&self) -> Option<[u8; 32]> {
        self.installation_evidence_digest
    }

    fn matches_request(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
        command_digest: &[u8; 32],
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> bool {
        self.binding.import_binding == record.binding
            && self.binding.command_digest == *command_digest
            && self.binding.issued_at_ms == issued_at_ms
            && self.binding.expires_at_ms == expires_at_ms
    }

    fn validate(&self) -> worker::Result<()> {
        self.binding.import_binding.validate()?;
        if self.created_at_ms != 0 || self.updated_at_ms != 0 {
            if self.created_at_ms == 0
                || self.updated_at_ms < self.created_at_ms
                || self.updated_at_ms > i64::MAX as u64
            {
                return Err(store_error(
                    "tenant-root restore refresh attempt timestamps are invalid",
                ));
            }
        }
        match self.lifecycle {
            CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Pending => {
                if self.encrypted_seed_json.is_none()
                    || self.encrypted_refreshed_share_json.is_some()
                    || self.installation_evidence_b64u.is_some()
                    || self.installation_evidence_digest.is_some()
                    || self.refreshed_at_ms.is_some()
                    || self.promotion_lifecycle
                        != CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted
                    || self.promotion_reserved_at_ms.is_some()
                    || self.encrypted_online_role_share_json.is_some()
                    || self.provider_canary_receipt_b64u.is_some()
                    || self.promotion_completed_at_ms.is_some()
                {
                    return Err(store_error(
                        "pending tenant-root restore refresh attempt is incomplete",
                    ));
                }
            }
            CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed => {
                if self.encrypted_seed_json.is_none()
                    || self.encrypted_refreshed_share_json.is_none()
                    || self.installation_evidence_b64u.is_none()
                    || self.installation_evidence_digest.is_none()
                    || self.refreshed_at_ms.is_none()
                {
                    return Err(store_error(
                        "refreshed tenant-root restore refresh attempt is incomplete",
                    ));
                }
            }
            CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed => {
                if self.encrypted_seed_json.is_some()
                    || self.encrypted_refreshed_share_json.is_some()
                    || self.installation_evidence_b64u.is_some()
                    || self.installation_evidence_digest.is_some()
                    || self.refreshed_at_ms.is_some()
                    || self.promotion_lifecycle
                        != CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted
                    || self.promotion_reserved_at_ms.is_some()
                    || self.encrypted_online_role_share_json.is_some()
                    || self.provider_canary_receipt_b64u.is_some()
                    || self.promotion_completed_at_ms.is_some()
                {
                    return Err(store_error(
                        "closed tenant-root restore refresh attempt retains secret state",
                    ));
                }
            }
        }
        match self.promotion_lifecycle {
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted => {
                if self.promotion_reserved_at_ms.is_some()
                    || self.encrypted_online_role_share_json.is_some()
                    || self.provider_canary_receipt_b64u.is_some()
                    || self.promotion_completed_at_ms.is_some()
                {
                    return Err(store_error(
                        "unstarted tenant-root restore refresh promotion is incomplete",
                    ));
                }
            }
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Reserved => {
                let Some(reserved_at_ms) = self.promotion_reserved_at_ms else {
                    return Err(store_error(
                        "reserved tenant-root restore refresh promotion has no reservation timestamp",
                    ));
                };
                require_timestamp(
                    "tenant-root restore refresh promotion reservation timestamp",
                    reserved_at_ms,
                )?;
                if self.lifecycle
                    != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
                    || self.encrypted_online_role_share_json.is_some()
                    || self.provider_canary_receipt_b64u.is_some()
                    || self.promotion_completed_at_ms.is_some()
                {
                    return Err(store_error(
                        "reserved tenant-root restore refresh promotion is incomplete",
                    ));
                }
            }
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed => {
                let Some(reserved_at_ms) = self.promotion_reserved_at_ms else {
                    return Err(store_error(
                        "completed tenant-root restore refresh promotion has no reservation timestamp",
                    ));
                };
                let Some(completed_at_ms) = self.promotion_completed_at_ms else {
                    return Err(store_error(
                        "completed tenant-root restore refresh promotion has no completion timestamp",
                    ));
                };
                require_timestamp(
                    "tenant-root restore refresh promotion reservation timestamp",
                    reserved_at_ms,
                )?;
                require_timestamp(
                    "tenant-root restore refresh promotion completion timestamp",
                    completed_at_ms,
                )?;
                if self.lifecycle
                    != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
                    || self.encrypted_online_role_share_json.is_none()
                    || self.provider_canary_receipt_b64u.is_none()
                {
                    return Err(store_error(
                        "completed tenant-root restore refresh promotion is incomplete",
                    ));
                }
                let encrypted_output =
                    self.encrypted_online_role_share_json().map_err(|error| {
                        store_error(format!(
                        "completed tenant-root restore refresh promotion output is invalid: {error}"
                    ))
                    })?;
                if encrypted_output.len() > 8 * 1024 {
                    return Err(store_error(
                        "tenant-root restore refresh promotion ciphertext JSON exceeds its size limit",
                    ));
                }
                let canary_encoded = self.provider_canary_receipt_b64u()?;
                let canary_bytes = decode_base64url_bytes_v1(
                    "tenant-root restore refresh provider canary",
                    canary_encoded,
                )
                .map_err(|error| store_error(error.message()))?;
                if canary_bytes.is_empty()
                    || canary_bytes.len() > TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1
                    || encode_base64url_bytes_v1(&canary_bytes) != canary_encoded
                {
                    return Err(store_error(
                        "tenant-root restore refresh provider canary is malformed",
                    ));
                }
                TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(&canary_bytes)
                    .map_err(|error| store_error(error.message()))?;
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreRefreshRoleAttemptD1RowV1 {
    tenant_identity_digest_hex: String,
    custody_lineage_b64u: String,
    restore_session_id_hex: String,
    role: String,
    generation: i64,
    import_key_id: String,
    import_replay_key_digest_hex: String,
    import_command_digest_hex: String,
    import_operation_digest_hex: String,
    recovery_set_id_b64u: String,
    manifest_digest_hex: String,
    stable_root_commitment_b64u: String,
    share_commitment_b64u: String,
    destination_fingerprint_hex: String,
    import_public_key_b64u: String,
    import_issued_at_ms: i64,
    import_expires_at_ms: i64,
    refresh_command_digest_hex: String,
    refresh_issued_at_ms: i64,
    refresh_expires_at_ms: i64,
    admitted_at_ms: i64,
    encrypted_seed_json: Option<String>,
    encrypted_refreshed_share_json: Option<String>,
    installation_evidence_b64u: Option<String>,
    installation_evidence_digest_hex: Option<String>,
    lifecycle: String,
    refreshed_at_ms: Option<i64>,
    created_at_ms: i64,
    updated_at_ms: i64,
    promotion_lifecycle: String,
    promotion_reserved_at_ms: Option<i64>,
    encrypted_online_role_share_json: Option<String>,
    provider_canary_receipt_b64u: Option<String>,
    promotion_completed_at_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreImportKeyD1RowV1 {
    tenant_identity_digest_hex: String,
    custody_lineage_b64u: String,
    restore_session_id_hex: String,
    role: String,
    generation: i64,
    import_key_id: String,
    replay_key_digest_hex: String,
    command_digest_hex: String,
    operation_digest_hex: String,
    recovery_set_id_b64u: String,
    manifest_digest_hex: String,
    stable_root_commitment_b64u: String,
    share_commitment_b64u: String,
    destination_fingerprint_hex: String,
    public_key_b64u: String,
    encrypted_ikm_json: Option<String>,
    envelope_digest_hex: Option<String>,
    encrypted_imported_share_json: Option<String>,
    issued_at_ms: i64,
    expires_at_ms: i64,
    lifecycle: String,
    installed_at_ms: Option<i64>,
    receipt_digest_hex: Option<String>,
    created_at_ms: i64,
    updated_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreImportSessionTombstoneD1RowV1 {
    closed_at_ms: i64,
    role: Option<String>,
    activation_operation: Option<String>,
    activation_receipt_b64u: Option<String>,
    activation_receipt_digest_hex: Option<String>,
    cleanup_receipt_b64u: Option<String>,
    cleanup_receipt_digest_hex: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreImportSessionClosedD1RowV1 {
    closed_at_ms: i64,
}

/// Exact public receipt returned when a tenant-held restore session is closed.
/// It commits only to authenticated public scope and receipt digests.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRestoreSessionCleanupReceiptV1 {
    bytes: Vec<u8>,
    digest: TenantRootLifecycleReceiptDigestV1,
    closed_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreSessionCleanupReceiptV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreSessionCleanupReceiptV1")
            .field("digest", &self.digest)
            .field("closed_at_ms", &self.closed_at_ms)
            .field("bytes", &"[public receipt bytes]")
            .finish()
    }
}

impl CloudflareTenantRootRestoreSessionCleanupReceiptV1 {
    fn new(
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
        role: CloudflareTenantRootDeriverRoleV1,
        activation_operation: &str,
        activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        closed_at_ms: u64,
    ) -> worker::Result<Self> {
        require_timestamp(
            "tenant-root restore import session close timestamp",
            closed_at_ms,
        )?;
        let mut bytes = Vec::with_capacity(256);
        bytes.extend_from_slice(TENANT_ROOT_RESTORE_SESSION_CLEANUP_RECEIPT_DOMAIN_V1);
        push_command_field(&mut bytes, identity_digest.as_bytes())?;
        push_command_field(&mut bytes, custody_lineage.as_bytes())?;
        push_command_field(&mut bytes, restore_session_id.as_bytes())?;
        push_command_field(&mut bytes, role.as_str().as_bytes())?;
        push_command_field(&mut bytes, activation_operation.as_bytes())?;
        push_command_field(&mut bytes, activation_receipt_digest.as_bytes())?;
        push_command_u64(&mut bytes, closed_at_ms)?;
        let digest = TenantRootLifecycleReceiptDigestV1::from_bytes(Sha256::digest(&bytes).into())
            .map_err(|error| store_error(error.message()))?;
        Ok(Self {
            bytes,
            digest,
            closed_at_ms,
        })
    }

    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) const fn digest(&self) -> TenantRootLifecycleReceiptDigestV1 {
        self.digest
    }

    pub(crate) const fn closed_at_ms(&self) -> u64 {
        self.closed_at_ms
    }
}

#[derive(Clone, PartialEq, Eq)]
struct CloudflareTenantRootRestoreImportSessionTombstoneV1 {
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    restore_session_id: TenantRootRestoreSessionIdV1,
    role: CloudflareTenantRootDeriverRoleV1,
    activation_operation: String,
    activation_receipt_bytes: Vec<u8>,
    activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    cleanup_receipt: CloudflareTenantRootRestoreSessionCleanupReceiptV1,
    closed_at_ms: u64,
}

impl fmt::Debug for CloudflareTenantRootRestoreImportSessionTombstoneV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRestoreImportSessionTombstoneV1")
            .field("identity_digest", &self.identity_digest)
            .field("custody_lineage", &self.custody_lineage)
            .field("restore_session_id", &self.restore_session_id)
            .field("role", &self.role)
            .field("activation_operation", &self.activation_operation)
            .field("activation_receipt_digest", &self.activation_receipt_digest)
            .field("cleanup_receipt", &self.cleanup_receipt)
            .field("closed_at_ms", &self.closed_at_ms)
            .finish()
    }
}

impl CloudflareTenantRootRestoreImportSessionTombstoneV1 {
    fn from_activation(
        activation: &VerifiedTenantRootSignedActivationReceiptV1,
        role: CloudflareTenantRootDeriverRoleV1,
        closed_at_ms: u64,
    ) -> worker::Result<Self> {
        if activation.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation {
            return Err(store_error(
                "tenant-root restore-session cleanup requires initial-creation activation",
            ));
        }
        let provenance = activation
            .availability()
            .tenant_held_external_provenance()
            .ok_or_else(|| {
                store_error(
                    "tenant-root restore-session cleanup requires tenant-held external activation",
                )
            })?;
        let activation_operation = activation.transition().operation().to_owned();
        let activation_receipt_digest = activation.digest();
        let cleanup_receipt = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
            activation.identity_digest(),
            activation.custody_lineage(),
            provenance.restore_session_id(),
            role,
            &activation_operation,
            activation_receipt_digest,
            closed_at_ms,
        )?;
        Ok(Self {
            identity_digest: activation.identity_digest(),
            custody_lineage: activation.custody_lineage(),
            restore_session_id: provenance.restore_session_id(),
            role,
            activation_operation,
            activation_receipt_bytes: activation.canonical_bytes().to_vec(),
            activation_receipt_digest,
            cleanup_receipt,
            closed_at_ms,
        })
    }

    fn validate(&self) -> worker::Result<()> {
        require_timestamp(
            "tenant-root restore import session close timestamp",
            self.closed_at_ms,
        )?;
        if self.activation_operation
            != TenantRootActivationReceiptTransitionV1::InitialCreation.operation()
        {
            return Err(store_error(
                "tenant-root restore-session tombstone activation operation is invalid",
            ));
        }
        let receipt = decode_activation_receipt_bytes(&self.activation_receipt_bytes)?;
        if receipt.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation
            || receipt.identity_digest() != self.identity_digest
            || receipt.custody_lineage() != self.custody_lineage
            || receipt
                .availability()
                .tenant_held_external_provenance()
                .map(|provenance| provenance.restore_session_id())
                != Some(self.restore_session_id)
        {
            return Err(store_error(
                "tenant-root restore-session tombstone activation scope is invalid",
            ));
        }
        let activation_receipt_digest = receipt
            .digest()
            .map_err(|error| store_error(error.message()))?;
        if activation_receipt_digest != self.activation_receipt_digest {
            return Err(store_error(
                "tenant-root restore-session tombstone activation digest is invalid",
            ));
        }
        let expected_cleanup = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
            self.identity_digest,
            self.custody_lineage,
            self.restore_session_id,
            self.role,
            &self.activation_operation,
            self.activation_receipt_digest,
            self.closed_at_ms,
        )?;
        if self.cleanup_receipt != expected_cleanup {
            return Err(store_error(
                "tenant-root restore-session tombstone cleanup receipt is invalid",
            ));
        }
        Ok(())
    }

    fn matches(&self, other: &Self) -> bool {
        self.identity_digest == other.identity_digest
            && self.custody_lineage == other.custody_lineage
            && self.restore_session_id == other.restore_session_id
            && self.role == other.role
            && self.activation_operation == other.activation_operation
            && self.activation_receipt_bytes == other.activation_receipt_bytes
            && self.activation_receipt_digest == other.activation_receipt_digest
    }

    pub(crate) fn cleanup_receipt(&self) -> &CloudflareTenantRootRestoreSessionCleanupReceiptV1 {
        &self.cleanup_receipt
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreImportKeyCiphertextV1 {
    key_version: String,
    tenant_identity_digest_hex: String,
    custody_lineage_b64u: String,
    restore_session_id_hex: String,
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: String,
    public_key_b64u: String,
    issued_at_ms: u64,
    expires_at_ms: u64,
    lifecycle: String,
    ciphertext_b64u: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreImportedShareCiphertextV1 {
    key_version: String,
    tenant_identity_digest_hex: String,
    custody_lineage_b64u: String,
    restore_session_id_hex: String,
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: String,
    envelope_digest_hex: String,
    share_commitment_b64u: String,
    ciphertext_b64u: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreImportedShareAadV1<'a> {
    environment: &'a str,
    worker_role: CloudflareTenantRootDeriverRoleV1,
    tenant_identity_digest_hex: &'a str,
    custody_lineage_b64u: &'a str,
    restore_session_id_hex: &'a str,
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: &'a str,
    envelope_digest_hex: &'a str,
    share_commitment_b64u: &'a str,
    purpose: &'static str,
    schema: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreImportKeyAadV1<'a> {
    environment: &'a str,
    worker_role: CloudflareTenantRootDeriverRoleV1,
    tenant_identity_digest_hex: &'a str,
    custody_lineage_b64u: &'a str,
    restore_session_id_hex: &'a str,
    recovery_set_id_b64u: &'a str,
    destination_fingerprint_hex: &'a str,
    manifest_digest_hex: &'a str,
    stable_root_commitment_b64u: &'a str,
    share_commitment_b64u: &'a str,
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: &'a str,
    replay_key_digest_hex: &'a str,
    command_digest_hex: &'a str,
    operation_digest_hex: &'a str,
    public_key_b64u: &'a str,
    issued_at_ms: u64,
    expires_at_ms: u64,
    lifecycle: &'a str,
    purpose: &'static str,
    schema: &'static str,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreRefreshSeedCiphertextV1 {
    key_version: String,
    tenant_identity_digest_hex: String,
    custody_lineage_b64u: String,
    restore_session_id_hex: String,
    recovery_set_id_b64u: String,
    destination_fingerprint_hex: String,
    manifest_digest_hex: String,
    stable_root_commitment_b64u: String,
    share_commitment_b64u: String,
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: String,
    import_replay_key_digest_hex: String,
    import_command_digest_hex: String,
    import_operation_digest_hex: String,
    import_public_key_b64u: String,
    import_issued_at_ms: u64,
    import_expires_at_ms: u64,
    refresh_command_digest_hex: String,
    issued_at_ms: u64,
    expires_at_ms: u64,
    admitted_at_ms: u64,
    ciphertext_b64u: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreRefreshShareCiphertextV1 {
    key_version: String,
    tenant_identity_digest_hex: String,
    custody_lineage_b64u: String,
    restore_session_id_hex: String,
    recovery_set_id_b64u: String,
    destination_fingerprint_hex: String,
    manifest_digest_hex: String,
    stable_root_commitment_b64u: String,
    share_commitment_b64u: String,
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: String,
    import_replay_key_digest_hex: String,
    import_command_digest_hex: String,
    import_operation_digest_hex: String,
    import_public_key_b64u: String,
    import_issued_at_ms: u64,
    import_expires_at_ms: u64,
    refresh_command_digest_hex: String,
    evidence_digest_hex: String,
    ciphertext_b64u: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreRefreshSeedAadV1<'a> {
    environment: &'a str,
    worker_role: CloudflareTenantRootDeriverRoleV1,
    tenant_identity_digest_hex: &'a str,
    custody_lineage_b64u: &'a str,
    restore_session_id_hex: &'a str,
    recovery_set_id_b64u: &'a str,
    destination_fingerprint_hex: &'a str,
    manifest_digest_hex: &'a str,
    stable_root_commitment_b64u: &'a str,
    share_commitment_b64u: &'a str,
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: &'a str,
    import_replay_key_digest_hex: &'a str,
    import_command_digest_hex: &'a str,
    import_operation_digest_hex: &'a str,
    import_public_key_b64u: &'a str,
    import_issued_at_ms: u64,
    import_expires_at_ms: u64,
    refresh_command_digest_hex: &'a str,
    issued_at_ms: u64,
    expires_at_ms: u64,
    admitted_at_ms: u64,
    purpose: &'static str,
    schema: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestoreRefreshShareAadV1<'a> {
    environment: &'a str,
    worker_role: CloudflareTenantRootDeriverRoleV1,
    tenant_identity_digest_hex: &'a str,
    custody_lineage_b64u: &'a str,
    restore_session_id_hex: &'a str,
    recovery_set_id_b64u: &'a str,
    destination_fingerprint_hex: &'a str,
    manifest_digest_hex: &'a str,
    stable_root_commitment_b64u: &'a str,
    share_commitment_b64u: &'a str,
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: &'a str,
    import_replay_key_digest_hex: &'a str,
    import_command_digest_hex: &'a str,
    import_operation_digest_hex: &'a str,
    import_public_key_b64u: &'a str,
    import_issued_at_ms: u64,
    import_expires_at_ms: u64,
    refresh_command_digest_hex: &'a str,
    evidence_digest_hex: &'a str,
    purpose: &'static str,
    schema: &'static str,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestorePromotionRoleCiphertextV1 {
    key_version: String,
    tenant_identity_digest_hex: String,
    custody_lineage_b64u: String,
    restore_session_id_hex: String,
    recovery_set_id_b64u: String,
    destination_fingerprint_hex: String,
    manifest_digest_hex: String,
    stable_root_commitment_b64u: String,
    share_commitment_b64u: String,
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: String,
    import_replay_key_digest_hex: String,
    import_command_digest_hex: String,
    import_operation_digest_hex: String,
    import_public_key_b64u: String,
    import_issued_at_ms: u64,
    import_expires_at_ms: u64,
    refresh_command_digest_hex: String,
    provider_binding_aad_b64u: String,
    ciphertext_b64u: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct TenantRootRestorePromotionAadV1<'a> {
    environment: &'a str,
    worker_role: CloudflareTenantRootDeriverRoleV1,
    tenant_identity_digest_hex: &'a str,
    custody_lineage_b64u: &'a str,
    restore_session_id_hex: &'a str,
    recovery_set_id_b64u: &'a str,
    destination_fingerprint_hex: &'a str,
    manifest_digest_hex: &'a str,
    stable_root_commitment_b64u: &'a str,
    share_commitment_b64u: &'a str,
    role: CloudflareTenantRootDeriverRoleV1,
    generation: u64,
    import_key_id: &'a str,
    import_replay_key_digest_hex: &'a str,
    import_command_digest_hex: &'a str,
    import_operation_digest_hex: &'a str,
    import_public_key_b64u: &'a str,
    import_issued_at_ms: u64,
    import_expires_at_ms: u64,
    refresh_command_digest_hex: &'a str,
    provider_binding_aad_b64u: &'a str,
    purpose: &'static str,
    schema: &'static str,
}

fn restore_import_key_record_from_row(
    row: TenantRootRestoreImportKeyD1RowV1,
    expected_role: CloudflareTenantRootDeriverRoleV1,
) -> worker::Result<CloudflareTenantRootRestoreImportKeyRecordV1> {
    let role = CloudflareTenantRootDeriverRoleV1::parse(&row.role)?;
    if role != expected_role {
        return Err(store_error(
            "tenant-root restore import key row belongs to the other Deriver",
        ));
    }
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
        "tenant-root restore import identity digest",
        &row.tenant_identity_digest_hex,
    )?);
    let custody_lineage = TenantRootCustodyLineageId::from_base64url(&row.custody_lineage_b64u)
        .map_err(|error| store_error(error.message()))?;
    let restore_session_id =
        TenantRootRestoreSessionIdV1::from_bytes(decode_lower_hex_fixed::<16>(
            "tenant-root restore import session id",
            &row.restore_session_id_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let recovery_set_id = TenantRootRecoverySetId::from_base64url(&row.recovery_set_id_b64u)
        .map_err(|error| store_error(error.message()))?;
    let destination_fingerprint =
        TenantRootRestoreDestinationFingerprintV1::from_bytes(decode_lower_hex_fixed::<32>(
            "tenant-root restore destination fingerprint",
            &row.destination_fingerprint_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let import_public_key =
        TenantRootRestoreImportPublicKeyV1::from_bytes(decode_base64url_fixed::<32>(
            "tenant-root restore import public key",
            &row.public_key_b64u,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let binding = CloudflareTenantRootRestoreImportKeyBindingV1::new(
        identity_digest,
        custody_lineage,
        restore_session_id,
        recovery_set_id,
        destination_fingerprint,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore import manifest digest",
            &row.manifest_digest_hex,
        )?,
        decode_base64url_fixed::<32>(
            "tenant-root restore stable root commitment",
            &row.stable_root_commitment_b64u,
        )?,
        decode_base64url_fixed::<34>(
            "tenant-root restore role commitment",
            &row.share_commitment_b64u,
        )?,
        role,
        positive_u64_from_i64("tenant-root restore import generation", row.generation)?,
        row.import_key_id,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore import replay digest",
            &row.replay_key_digest_hex,
        )?,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore import command digest",
            &row.command_digest_hex,
        )?,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore import operation digest",
            &row.operation_digest_hex,
        )?,
        import_public_key,
        positive_u64_from_i64(
            "tenant-root restore import issued timestamp",
            row.issued_at_ms,
        )?,
        positive_u64_from_i64(
            "tenant-root restore import expiry timestamp",
            row.expires_at_ms,
        )?,
    )?;
    let lifecycle = CloudflareTenantRootRestoreImportKeyLifecycleV1::parse(&row.lifecycle)?;
    let installed_at_ms = row
        .installed_at_ms
        .map(|value| {
            positive_u64_from_i64("tenant-root restore import installation timestamp", value)
        })
        .transpose()?;
    let receipt_digest = row
        .receipt_digest_hex
        .as_deref()
        .map(|value| {
            decode_lower_hex_fixed::<32>("tenant-root restore import receipt digest", value)
        })
        .transpose()?;
    let envelope_digest = row
        .envelope_digest_hex
        .as_deref()
        .map(|value| {
            decode_lower_hex_fixed::<32>("tenant-root restore import envelope digest", value)
        })
        .transpose()?;
    let record = CloudflareTenantRootRestoreImportKeyRecordV1 {
        binding,
        encrypted_ikm_json: row.encrypted_ikm_json,
        envelope_digest,
        encrypted_imported_share_json: row.encrypted_imported_share_json,
        lifecycle,
        installed_at_ms,
        receipt_digest,
        created_at_ms: positive_u64_from_i64(
            "tenant-root restore import creation timestamp",
            row.created_at_ms,
        )?,
        updated_at_ms: positive_u64_from_i64(
            "tenant-root restore import update timestamp",
            row.updated_at_ms,
        )?,
    };
    record.validate()?;
    Ok(record)
}

fn restore_refresh_role_attempt_record_from_row(
    row: TenantRootRestoreRefreshRoleAttemptD1RowV1,
    expected_role: CloudflareTenantRootDeriverRoleV1,
) -> worker::Result<CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1> {
    let role = CloudflareTenantRootDeriverRoleV1::parse(&row.role)?;
    if role != expected_role {
        return Err(store_error(
            "tenant-root restore refresh attempt row belongs to the other Deriver",
        ));
    }
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
        "tenant-root restore refresh identity digest",
        &row.tenant_identity_digest_hex,
    )?);
    let custody_lineage = TenantRootCustodyLineageId::from_base64url(&row.custody_lineage_b64u)
        .map_err(|error| store_error(error.message()))?;
    let restore_session_id =
        TenantRootRestoreSessionIdV1::from_bytes(decode_lower_hex_fixed::<16>(
            "tenant-root restore refresh session id",
            &row.restore_session_id_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let recovery_set_id = TenantRootRecoverySetId::from_base64url(&row.recovery_set_id_b64u)
        .map_err(|error| store_error(error.message()))?;
    let destination_fingerprint =
        TenantRootRestoreDestinationFingerprintV1::from_bytes(decode_lower_hex_fixed::<32>(
            "tenant-root restore refresh destination fingerprint",
            &row.destination_fingerprint_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let import_public_key =
        TenantRootRestoreImportPublicKeyV1::from_bytes(decode_base64url_fixed::<32>(
            "tenant-root restore refresh import public key",
            &row.import_public_key_b64u,
        )?)
        .map_err(|error| store_error(error.message()))?;
    let import_binding = CloudflareTenantRootRestoreImportKeyBindingV1::new(
        identity_digest,
        custody_lineage,
        restore_session_id,
        recovery_set_id,
        destination_fingerprint,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore refresh manifest digest",
            &row.manifest_digest_hex,
        )?,
        decode_base64url_fixed::<32>(
            "tenant-root restore refresh stable root commitment",
            &row.stable_root_commitment_b64u,
        )?,
        decode_base64url_fixed::<34>(
            "tenant-root restore refresh imported share commitment",
            &row.share_commitment_b64u,
        )?,
        role,
        positive_u64_from_i64(
            "tenant-root restore refresh import generation",
            row.generation,
        )?,
        row.import_key_id,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore refresh import replay digest",
            &row.import_replay_key_digest_hex,
        )?,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore refresh import command digest",
            &row.import_command_digest_hex,
        )?,
        decode_lower_hex_fixed::<32>(
            "tenant-root restore refresh import operation digest",
            &row.import_operation_digest_hex,
        )?,
        import_public_key,
        positive_u64_from_i64(
            "tenant-root restore refresh import issue timestamp",
            row.import_issued_at_ms,
        )?,
        positive_u64_from_i64(
            "tenant-root restore refresh import expiry timestamp",
            row.import_expires_at_ms,
        )?,
    )?;
    let command_digest = decode_lower_hex_fixed::<32>(
        "tenant-root restore refresh command digest",
        &row.refresh_command_digest_hex,
    )?;
    let issued_at_ms = positive_u64_from_i64(
        "tenant-root restore refresh command issue timestamp",
        row.refresh_issued_at_ms,
    )?;
    let expires_at_ms = positive_u64_from_i64(
        "tenant-root restore refresh command expiry timestamp",
        row.refresh_expires_at_ms,
    )?;
    let admitted_at_ms = positive_u64_from_i64(
        "tenant-root restore refresh admission timestamp",
        row.admitted_at_ms,
    )?;
    let binding = CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1::from_import_binding(
        import_binding,
        command_digest,
        issued_at_ms,
        expires_at_ms,
        admitted_at_ms,
    )?;
    let lifecycle =
        CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::parse(&row.lifecycle)?;
    let promotion_lifecycle =
        CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::parse(&row.promotion_lifecycle)?;
    let installation_evidence_digest = row
        .installation_evidence_digest_hex
        .as_deref()
        .map(|value| {
            decode_lower_hex_fixed::<32>(
                "tenant-root restore refresh installation evidence digest",
                value,
            )
        })
        .transpose()?;
    let record = CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1 {
        binding,
        encrypted_seed_json: row.encrypted_seed_json,
        encrypted_refreshed_share_json: row.encrypted_refreshed_share_json,
        installation_evidence_b64u: row.installation_evidence_b64u,
        installation_evidence_digest,
        lifecycle,
        refreshed_at_ms: row
            .refreshed_at_ms
            .map(|value| positive_u64_from_i64("tenant-root restore refresh timestamp", value))
            .transpose()?,
        promotion_lifecycle,
        promotion_reserved_at_ms: row
            .promotion_reserved_at_ms
            .map(|value| {
                positive_u64_from_i64(
                    "tenant-root restore refresh promotion reservation timestamp",
                    value,
                )
            })
            .transpose()?,
        encrypted_online_role_share_json: row.encrypted_online_role_share_json,
        provider_canary_receipt_b64u: row.provider_canary_receipt_b64u,
        promotion_completed_at_ms: row
            .promotion_completed_at_ms
            .map(|value| {
                positive_u64_from_i64(
                    "tenant-root restore refresh promotion completion timestamp",
                    value,
                )
            })
            .transpose()?,
        created_at_ms: positive_u64_from_i64(
            "tenant-root restore refresh attempt creation timestamp",
            row.created_at_ms,
        )?,
        updated_at_ms: positive_u64_from_i64(
            "tenant-root restore refresh attempt update timestamp",
            row.updated_at_ms,
        )?,
    };
    record.validate()?;
    if record.lifecycle == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed {
        record.installation_evidence_bytes()?;
    }
    Ok(record)
}

#[derive(Debug, Deserialize)]
struct TenantRootCommandReplayD1RowV1 {
    replay_key_digest_hex: String,
    tenant_identity_digest_hex: String,
    custody_lineage_b64u: String,
    session_id_hex: String,
    nonce_hex: String,
    role: String,
    command_digest_hex: String,
    admission_digest_hex: Option<String>,
    status: String,
    receipt_b64u: Option<String>,
    receipt_digest_hex: Option<String>,
    reserved_at_ms: i64,
    executed_at_ms: Option<i64>,
    terminal_at_ms: Option<i64>,
    refresh_state_b64u: Option<String>,
    refresh_state_digest_hex: Option<String>,
}

struct StoredTenantRootCommandReplayV1 {
    record: TenantRootCommandReplayRecordV1,
    admission_digest: Option<TenantRootProtocolDigestV1>,
    refresh_state: Option<CloudflareTenantRootRefreshDurableStateV1>,
    receipt_bytes: Option<Vec<u8>>,
    reserved_at_ms: u64,
    executed_at_ms: Option<u64>,
}

/// Durable refresh state retained beside the generic command replay row.
///
/// The command and evidence bytes are retained as canonical wire bytes. They
/// let a restarted worker recover the exact provider inputs that preceded any
/// R2 operation without regenerating role material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "state",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub(crate) enum CloudflareTenantRootRefreshDurableStateV1 {
    Admitted {
        command_b64u: String,
        encrypted_seed_b64u: String,
    },
    Executed {
        command_b64u: String,
        evidence_b64u: String,
        prepared_artifacts: CloudflareTenantRootRefreshPreparedArtifactsV1,
    },
    Artifacts {
        command_b64u: String,
        evidence_b64u: String,
        prepared_artifacts: CloudflareTenantRootRefreshPreparedArtifactsV1,
        artifacts: CloudflareTenantRootRefreshArtifactMetadataV1,
    },
}

/// Exact canonical artifacts prepared before the pending role row is written.
///
/// These bytes are the replay source after a crash. R2 writes therefore never
/// require rerunning provider randomness or re-signing an artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshPreparedArtifactsV1 {
    managed_backup_b64u: String,
    provider_canary_receipt_b64u: String,
}

impl CloudflareTenantRootRefreshPreparedArtifactsV1 {
    pub(crate) fn new(
        managed_backup: &VerifiedTenantRootManagedBackupV1,
        provider_canary: &TenantRootSignedProviderCanaryReceiptV1,
    ) -> worker::Result<Self> {
        let managed_backup_bytes = managed_backup.canonical_bytes();
        let provider_canary_bytes = provider_canary
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?;
        let prepared = Self {
            managed_backup_b64u: encode_base64url_bytes_v1(managed_backup_bytes),
            provider_canary_receipt_b64u: encode_base64url_bytes_v1(&provider_canary_bytes),
        };
        prepared.validate()?;
        Ok(prepared)
    }

    pub(crate) fn managed_backup_bytes(&self) -> worker::Result<Vec<u8>> {
        decode_prepared_refresh_artifact(
            "tenant-root refresh managed-backup artifact",
            &self.managed_backup_b64u,
            MAX_REFRESH_PREPARED_MANAGED_BACKUP_BYTES,
        )
    }

    pub(crate) fn provider_canary_receipt_bytes(&self) -> worker::Result<Vec<u8>> {
        decode_prepared_refresh_artifact(
            "tenant-root refresh provider-canary artifact",
            &self.provider_canary_receipt_b64u,
            MAX_REFRESH_PREPARED_CANARY_BYTES,
        )
    }

    fn validate(&self) -> worker::Result<()> {
        let managed_backup_bytes = self.managed_backup_bytes()?;
        let managed_backup =
            TenantRootSignedManagedBackupV1::decode_canonical_bytes(&managed_backup_bytes)
                .map_err(|error| store_error(error.message()))?;
        if managed_backup
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?
            != managed_backup_bytes
        {
            return Err(store_error(
                "tenant-root refresh managed-backup artifact is not canonical",
            ));
        }
        let provider_canary_bytes = self.provider_canary_receipt_bytes()?;
        let provider_canary =
            TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(&provider_canary_bytes)
                .map_err(|error| store_error(error.message()))?;
        if provider_canary
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?
            != provider_canary_bytes
        {
            return Err(store_error(
                "tenant-root refresh provider-canary artifact is not canonical",
            ));
        }
        Ok(())
    }
}

/// Exact immutable artifacts bound to a terminal refresh replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshArtifactMetadataV1 {
    backup_object_key: String,
    backup_artifact_digest_hex: String,
    backup_object_generation: String,
    backup_key_generation_ref: String,
    canary_object_key: String,
    canary_artifact_digest_hex: String,
    canary_object_generation: String,
    canary_key_generation_ref: String,
    online_epoch_wrapping_key_ref: String,
    role_signing_key_id: String,
}

impl CloudflareTenantRootRefreshDurableStateV1 {
    pub(crate) fn admitted(
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        encrypted_seed_b64u: String,
    ) -> worker::Result<Self> {
        let command_b64u = encode_base64url_bytes_v1(command.canonical_bytes());
        let state = Self::Admitted {
            command_b64u,
            encrypted_seed_b64u,
        };
        state.validate()?;
        Ok(state)
    }

    fn validate(&self) -> worker::Result<()> {
        let (command_b64u, evidence_b64u) = match self {
            Self::Admitted { command_b64u, .. } => (command_b64u, None),
            Self::Executed {
                command_b64u,
                evidence_b64u,
                ..
            }
            | Self::Artifacts {
                command_b64u,
                evidence_b64u,
                ..
            } => (command_b64u, Some(evidence_b64u)),
        };
        validate_refresh_state_bytes(
            "tenant-root refresh durable command",
            command_b64u,
            TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BYTES_V1,
        )?;
        if let Some(evidence_b64u) = evidence_b64u {
            validate_refresh_state_bytes(
                "tenant-root refresh durable evidence",
                evidence_b64u,
                TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BYTES_V1,
            )?;
        }
        match self {
            Self::Admitted {
                encrypted_seed_b64u,
                ..
            } => {
                let bytes = decode_base64url_bytes_v1("refresh replay seed", encrypted_seed_b64u)
                    .map_err(|error| store_error(error.message()))?;
                if bytes.len() != CloudflareHpkeKemV1::ENCAPPED_KEY_LEN + 32 + 16 {
                    return Err(store_error("invalid encrypted refresh replay seed"));
                }
            }
            Self::Executed {
                prepared_artifacts, ..
            }
            | Self::Artifacts {
                prepared_artifacts, ..
            } => {
                prepared_artifacts.validate()?;
            }
        }
        if let Self::Artifacts { artifacts, .. } = self {
            artifacts.validate()?;
        }
        Ok(())
    }

    pub(crate) fn command_bytes(&self) -> worker::Result<Vec<u8>> {
        let encoded = match self {
            Self::Admitted { command_b64u, .. }
            | Self::Executed { command_b64u, .. }
            | Self::Artifacts { command_b64u, .. } => command_b64u,
        };
        decode_refresh_state_bytes("tenant-root refresh durable command", encoded)
    }

    pub(crate) fn evidence_bytes(&self) -> worker::Result<Vec<u8>> {
        let encoded = match self {
            Self::Admitted { .. } => {
                return Err(store_error(
                    "tenant-root refresh admission has no installation evidence",
                ));
            }
            Self::Executed { evidence_b64u, .. } | Self::Artifacts { evidence_b64u, .. } => {
                evidence_b64u
            }
        };
        decode_refresh_state_bytes("tenant-root refresh durable evidence", encoded)
    }

    pub(crate) fn prepared_artifacts(
        &self,
    ) -> worker::Result<&CloudflareTenantRootRefreshPreparedArtifactsV1> {
        match self {
            Self::Executed {
                prepared_artifacts, ..
            }
            | Self::Artifacts {
                prepared_artifacts, ..
            } => Ok(prepared_artifacts),
            Self::Admitted { .. } => Err(store_error(
                "tenant-root refresh admission has no prepared artifacts",
            )),
        }
    }

    pub(crate) fn artifacts(
        &self,
    ) -> worker::Result<&CloudflareTenantRootRefreshArtifactMetadataV1> {
        match self {
            Self::Artifacts { artifacts, .. } => Ok(artifacts),
            Self::Admitted { .. } | Self::Executed { .. } => Err(store_error(
                "tenant-root refresh durable state has no persisted artifact metadata",
            )),
        }
    }

    fn encode(&self) -> worker::Result<(String, String)> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|error| {
            store_error(format!(
                "tenant-root refresh durable state encode failed: {error}"
            ))
        })?;
        if bytes.is_empty() || bytes.len() > MAX_REFRESH_DURABLE_STATE_BYTES {
            return Err(store_error(
                "tenant-root refresh durable state exceeds its size limit",
            ));
        }
        let digest: [u8; 32] = Sha256::digest(&bytes).into();
        Ok((encode_base64url_bytes_v1(&bytes), encode_hex(&digest)))
    }

    fn kind_matches_status(&self, status: &str) -> bool {
        match (status, self) {
            ("reserved", Self::Admitted { .. })
            | ("executed", Self::Executed { .. })
            | ("executed", Self::Artifacts { .. })
            | ("completed", Self::Artifacts { .. }) => true,
            _ => false,
        }
    }
}

impl CloudflareTenantRootRefreshArtifactMetadataV1 {
    pub(crate) fn new(
        backup: &TenantRootManagedBackupObjectMetadataV1,
        canary: &TenantRootManagedBackupObjectMetadataV1,
        online_epoch_wrapping_key_ref: impl Into<String>,
        role_signing_key_id: impl Into<String>,
    ) -> worker::Result<Self> {
        let metadata = Self {
            backup_object_key: backup.object_key().to_owned(),
            backup_artifact_digest_hex: encode_hex(backup.canonical_digest()),
            backup_object_generation: backup.object_generation().to_owned(),
            backup_key_generation_ref: backup.wrapping_key_generation_ref().to_owned(),
            canary_object_key: canary.object_key().to_owned(),
            canary_artifact_digest_hex: encode_hex(canary.canonical_digest()),
            canary_object_generation: canary.object_generation().to_owned(),
            canary_key_generation_ref: canary.wrapping_key_generation_ref().to_owned(),
            online_epoch_wrapping_key_ref: online_epoch_wrapping_key_ref.into(),
            role_signing_key_id: role_signing_key_id.into(),
        };
        metadata.validate()?;
        Ok(metadata)
    }

    pub(crate) fn backup_object_key(&self) -> &str {
        &self.backup_object_key
    }

    pub(crate) fn backup_artifact_digest(&self) -> worker::Result<[u8; 32]> {
        decode_lower_hex_fixed(
            "tenant-root refresh backup artifact digest",
            &self.backup_artifact_digest_hex,
        )
    }

    pub(crate) fn backup_object_generation(&self) -> &str {
        &self.backup_object_generation
    }

    pub(crate) fn backup_key_generation_ref(&self) -> &str {
        &self.backup_key_generation_ref
    }

    pub(crate) fn canary_object_key(&self) -> &str {
        &self.canary_object_key
    }

    pub(crate) fn canary_artifact_digest(&self) -> worker::Result<[u8; 32]> {
        decode_lower_hex_fixed(
            "tenant-root refresh canary artifact digest",
            &self.canary_artifact_digest_hex,
        )
    }

    pub(crate) fn canary_object_generation(&self) -> &str {
        &self.canary_object_generation
    }

    pub(crate) fn canary_key_generation_ref(&self) -> &str {
        &self.canary_key_generation_ref
    }

    pub(crate) fn online_epoch_wrapping_key_ref(&self) -> &str {
        &self.online_epoch_wrapping_key_ref
    }

    pub(crate) fn role_signing_key_id(&self) -> &str {
        &self.role_signing_key_id
    }

    fn validate(&self) -> worker::Result<()> {
        require_identifier(
            "tenant-root refresh backup object key",
            &self.backup_object_key,
        )?;
        require_digest_hex(
            "tenant-root refresh backup artifact digest",
            &self.backup_artifact_digest_hex,
        )?;
        require_identifier(
            "tenant-root refresh backup object generation",
            &self.backup_object_generation,
        )?;
        require_identifier(
            "tenant-root refresh backup key generation",
            &self.backup_key_generation_ref,
        )?;
        require_identifier(
            "tenant-root refresh canary object key",
            &self.canary_object_key,
        )?;
        require_digest_hex(
            "tenant-root refresh canary artifact digest",
            &self.canary_artifact_digest_hex,
        )?;
        require_identifier(
            "tenant-root refresh canary object generation",
            &self.canary_object_generation,
        )?;
        require_identifier(
            "tenant-root refresh canary key generation",
            &self.canary_key_generation_ref,
        )?;
        require_identifier(
            "tenant-root refresh online wrapping-key generation",
            &self.online_epoch_wrapping_key_ref,
        )?;
        require_identifier(
            "tenant-root refresh role signing key",
            &self.role_signing_key_id,
        )
    }
}

/// Exact immutable artifacts recovered from a completed refresh replay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRefreshArtifactCheckpointV1 {
    command_bytes: Vec<u8>,
    evidence_bytes: Vec<u8>,
    prepared_artifacts: CloudflareTenantRootRefreshPreparedArtifactsV1,
    artifacts: CloudflareTenantRootRefreshArtifactMetadataV1,
}

impl CloudflareTenantRootRefreshArtifactCheckpointV1 {
    pub(crate) fn command_bytes(&self) -> &[u8] {
        &self.command_bytes
    }

    pub(crate) fn evidence_bytes(&self) -> &[u8] {
        &self.evidence_bytes
    }

    pub(crate) const fn prepared_artifacts(
        &self,
    ) -> &CloudflareTenantRootRefreshPreparedArtifactsV1 {
        &self.prepared_artifacts
    }

    pub(crate) const fn artifacts(&self) -> &CloudflareTenantRootRefreshArtifactMetadataV1 {
        &self.artifacts
    }
}

fn validate_refresh_state_bytes(
    field: &str,
    encoded: &str,
    max_bytes: usize,
) -> worker::Result<()> {
    let bytes = decode_refresh_state_bytes(field, encoded)?;
    if bytes.is_empty() || bytes.len() > max_bytes || encode_base64url_bytes_v1(&bytes) != encoded {
        return Err(store_error(format!("{field} is not canonical")));
    }
    Ok(())
}

fn decode_refresh_state_bytes(field: &str, encoded: &str) -> worker::Result<Vec<u8>> {
    decode_base64url_bytes_v1(field, encoded).map_err(|error| store_error(error.message()))
}

fn decode_prepared_refresh_artifact(
    field: &str,
    encoded: &str,
    max_bytes: usize,
) -> worker::Result<Vec<u8>> {
    let bytes = decode_refresh_state_bytes(field, encoded)?;
    if bytes.is_empty() || bytes.len() > max_bytes || encode_base64url_bytes_v1(&bytes) != encoded {
        return Err(store_error(format!("{field} is not canonical")));
    }
    Ok(bytes)
}

fn decode_refresh_durable_state(
    state_b64u: &str,
    state_digest_hex: &str,
) -> worker::Result<CloudflareTenantRootRefreshDurableStateV1> {
    let bytes = decode_refresh_state_bytes("tenant-root refresh durable state", state_b64u)?;
    if bytes.is_empty()
        || bytes.len() > MAX_REFRESH_DURABLE_STATE_BYTES
        || encode_base64url_bytes_v1(&bytes) != state_b64u
    {
        return Err(store_error(
            "tenant-root refresh durable state is not canonical",
        ));
    }
    require_digest_hex("tenant-root refresh durable state digest", state_digest_hex)?;
    if encode_hex(Sha256::digest(&bytes).as_ref()) != state_digest_hex {
        return Err(store_error(
            "tenant-root refresh durable state digest does not match its bytes",
        ));
    }
    let state: CloudflareTenantRootRefreshDurableStateV1 =
        serde_json::from_slice(&bytes).map_err(|error| {
            store_error(format!(
                "tenant-root refresh durable state decode failed: {error}"
            ))
        })?;
    state.validate()?;
    let canonical = serde_json::to_vec(&state).map_err(|error| {
        store_error(format!(
            "tenant-root refresh durable state re-encode failed: {error}"
        ))
    })?;
    if canonical != bytes {
        return Err(store_error(
            "tenant-root refresh durable state is not canonical JSON",
        ));
    }
    Ok(state)
}

fn refresh_replay_state_for_command(
    stored: &StoredTenantRootCommandReplayV1,
    command_bytes: &[u8],
) -> worker::Result<CloudflareTenantRootRefreshDurableStateV1> {
    let state = stored.refresh_state.clone().ok_or_else(|| {
        store_error("tenant-root refresh replay row omitted durable refresh state")
    })?;
    if state.command_bytes()? != command_bytes {
        return Err(store_error(
            "tenant-root refresh durable command bytes do not match the retry",
        ));
    }
    Ok(state)
}

#[derive(Clone, Copy)]
enum TenantRootCommandAdmissionV1 {
    InitialCreation(TenantRootProtocolDigestV1),
    AuthorizedCleanup(TenantRootProtocolDigestV1),
}

impl TenantRootCommandAdmissionV1 {
    const fn digest(self) -> TenantRootProtocolDigestV1 {
        match self {
            Self::InitialCreation(digest) | Self::AuthorizedCleanup(digest) => digest,
        }
    }
}

/// Durable role-local decision for one exact tenant-root command retry.
#[derive(Debug, PartialEq, Eq)]
pub enum CloudflareTenantRootCommandReplayDecisionV1 {
    /// The caller owns the newly persisted reservation and may execute once.
    Execute {
        /// Exact reservation required to commit a terminal receipt.
        reservation: ReservedTenantRootCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        /// Exact token reconstructed from the validated reserved replay row.
        reservation: ReservedTenantRootCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        /// Exact token reconstructed from the validated executed replay row.
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact previously committed successful receipt bytes.
    ReplayCompleted {
        /// Previously committed signed public receipt bytes.
        receipt_bytes: Vec<u8>,
    },
    /// Return the exact previously committed failure receipt bytes.
    ReplayFailed {
        /// Previously committed signed public failure-receipt bytes.
        failure_receipt_bytes: Vec<u8>,
    },
}

/// Executable insert-pending command issued by the role's control plane.
///
/// Fields remain private so a caller cannot forge the reserved operation or
/// substitute a different local row after reservation.
#[derive(Debug, PartialEq, Eq)]
pub struct CloudflareTenantRootInsertPendingCommandV1 {
    scope: TenantRootCommandScopeV1,
    reservation: ReservedTenantRootCommandV1,
    record: CloudflareTenantRootRoleShareRecordV1,
    expected_revision: i64,
    operation_payload_digest: TenantRootProtocolDigestV1,
}

/// Local inputs for one issuer-authorized initial role creation.
///
/// The role store derives the pending lifecycle branch from the exact verified
/// installation-evidence wire. Callers provide only the server-resolved
/// identity and the locally sealed share material.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootInitialCreationShareInputV1 {
    identity: TenantRootIdentityV1,
    sealed_online_share: TenantRootSealedOnlineRoleShareV1,
    staged_at_ms: u64,
}

#[allow(dead_code)]
impl CloudflareTenantRootInitialCreationShareInputV1 {
    /// Creates the local sealed-share inputs for one initial role installation.
    pub(crate) fn new(
        identity: TenantRootIdentityV1,
        sealed_online_share: TenantRootSealedOnlineRoleShareV1,
        staged_at_ms: u64,
    ) -> Self {
        Self {
            identity,
            sealed_online_share,
            staged_at_ms,
        }
    }
}

/// Creation-only input bundle coupling one verified issuer command to one exact
/// role-signed installation-evidence wire and its local sealed share material.
///
/// The bundle is intentionally non-cloneable. Its evidence token is carried
/// through reservation, execution, and successful terminalization so a caller
/// cannot substitute receipt payload bytes at a later lifecycle stage.
#[allow(dead_code)]
pub(crate) struct CloudflareTenantRootInitialCreationInputV1 {
    command: VerifiedTenantRootRoleCreationCommandV1,
    evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    record: CloudflareTenantRootRoleShareRecordV1,
}

#[allow(dead_code)]
impl fmt::Debug for CloudflareTenantRootInitialCreationInputV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootInitialCreationInputV1")
            .field("command", &self.command)
            .field("evidence", &self.evidence)
            .field("record", &self.record)
            .finish()
    }
}

#[allow(dead_code)]
impl CloudflareTenantRootInitialCreationInputV1 {
    /// Returns the sealed share ciphertext, for leak tests only.
    #[cfg(test)]
    pub(crate) fn sealed_share_ciphertext_for_test(&self) -> Vec<u8> {
        use base64::Engine;
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(self.record.sealed_share().ciphertext_b64u())
            .expect("sealed share ciphertext is canonical base64url")
    }

    /// Returns the exact signed installation evidence wire bytes.
    ///
    /// Public evidence: it is what the Router-owned object verifies, and it
    /// carries no share material.
    pub(crate) fn installation_evidence_bytes(&self) -> &[u8] {
        self.evidence.canonical_bytes()
    }

    /// Builds one exact pending record from verified evidence and local share inputs.
    pub(crate) fn new(
        command: VerifiedTenantRootRoleCreationCommandV1,
        evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        share: CloudflareTenantRootInitialCreationShareInputV1,
    ) -> worker::Result<Self> {
        let sealed_binding = share.sealed_online_share.binding();
        let identity_digest = share
            .identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        let evidence_digest = evidence
            .lifecycle_receipt_digest()
            .map_err(|error| store_error(error.message()))?;
        if sealed_binding.identity_digest() != identity_digest {
            return Err(store_error(
                "tenant-root initial creation sealed share identity does not match its local identity",
            ));
        }
        if sealed_binding.installation_evidence_digest() != evidence_digest {
            return Err(store_error(
                "tenant-root initial creation sealed share evidence does not match its exact wire",
            ));
        }
        let role = cloudflare_role_for_protocol(sealed_binding.role())?;
        let installation_evidence =
            CloudflareTenantRootPendingShareV1::from_verified_installation_evidence(
                &evidence,
                share.staged_at_ms,
            )?;
        let sealed_share =
            CloudflareTenantRootSealedRoleShareV1::new(share.sealed_online_share.ciphertext())?;
        let record = CloudflareTenantRootRoleShareRecordV1::new(
            CloudflareTenantRootRoleShareRecordInputV1 {
                identity: share.identity,
                custody_lineage: sealed_binding.custody_lineage(),
                epoch: sealed_binding.epoch(),
                role,
                sealed_share,
                share_commitment: sealed_binding.share_commitment().clone(),
                epoch_wrapping_key_ref: sealed_binding.epoch_wrapping_key_ref().to_owned(),
                lifecycle: CloudflareTenantRootRoleShareLifecycleV1::Pending(installation_evidence),
                created_at_ms: share.staged_at_ms,
                updated_at_ms: share.staged_at_ms,
            },
        )?;
        validate_initial_creation_binding(&command, &evidence, &record)?;
        Ok(Self {
            command,
            evidence,
            record,
        })
    }
}

/// Executable initial-creation insertion command retaining its exact evidence token.
#[allow(dead_code)]
pub(crate) struct CloudflareTenantRootInitialCreationPendingCommandV1 {
    command: CloudflareTenantRootInsertPendingCommandV1,
    evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
}

impl fmt::Debug for CloudflareTenantRootInitialCreationPendingCommandV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootInitialCreationPendingCommandV1")
            .field("command", &self.command)
            .field("evidence", &self.evidence)
            .finish()
    }
}

/// Executed initial-creation command retaining the evidence needed for its
/// exact successful terminal receipt payload.
#[allow(dead_code)]
pub(crate) struct CloudflareTenantRootInitialCreationExecutedCommandV1 {
    executed: ExecutedTenantRootCommandV1,
    evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
}

impl CloudflareTenantRootInitialCreationExecutedCommandV1 {
    /// Returns the executed command this insertion must be terminalized under.
    ///
    /// The caller signs its terminal receipt against this token and verifies
    /// the result with it, which is what binds the receipt to the exact
    /// insertion rather than to the role generally.
    pub(crate) const fn executed(&self) -> &ExecutedTenantRootCommandV1 {
        &self.executed
    }

    /// Returns the installation evidence this insertion attests.
    pub(crate) fn evidence_bytes(&self) -> &[u8] {
        self.evidence.canonical_bytes()
    }
}

impl fmt::Debug for CloudflareTenantRootInitialCreationExecutedCommandV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootInitialCreationExecutedCommandV1")
            .field("executed", &self.executed)
            .field("evidence", &self.evidence)
            .finish()
    }
}

/// Local inputs for one issuer-authorized refresh role installation.
///
/// The sealed provider result retains the exact binding that authenticated the
/// refresh evidence, role, epoch, commitment, and wrapping-key reference.
#[allow(dead_code)]
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRefreshShareInputV1 {
    /// Server-resolved logical root identity.
    identity: TenantRootIdentityV1,
    /// Provider ciphertext containing the newly sealed role share.
    sealed_online_share: TenantRootSealedOnlineRoleShareV1,
    /// Initial durable staging time for the pending row.
    staged_at_ms: u64,
}

#[allow(dead_code)]
impl CloudflareTenantRootRefreshShareInputV1 {
    /// Creates the local sealed-share inputs for one refresh installation.
    pub(crate) fn new(
        identity: TenantRootIdentityV1,
        sealed_online_share: TenantRootSealedOnlineRoleShareV1,
        staged_at_ms: u64,
    ) -> Self {
        Self {
            identity,
            sealed_online_share,
            staged_at_ms,
        }
    }
}

/// Refresh-only input bundle coupling one verified issuer command to one exact
/// role-signed installation-evidence wire and its local sealed share material.
///
/// The bundle is intentionally non-cloneable. Its evidence token is carried
/// through reservation, execution, and successful terminalization so receipt
/// payload bytes cannot be substituted after the provider call.
#[allow(dead_code)]
pub(crate) struct CloudflareTenantRootRefreshInputV1 {
    command: VerifiedTenantRootRoleRefreshCommandV1,
    evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    record: CloudflareTenantRootRoleShareRecordV1,
}

#[allow(dead_code)]
impl fmt::Debug for CloudflareTenantRootRefreshInputV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRefreshInputV1")
            .field("command", &self.command)
            .field("evidence", &self.evidence)
            .field("record", &self.record)
            .finish()
    }
}

#[allow(dead_code)]
impl CloudflareTenantRootRefreshInputV1 {
    /// Returns the exact signed installation evidence wire bytes.
    pub(crate) fn installation_evidence_bytes(&self) -> &[u8] {
        self.evidence.canonical_bytes()
    }

    /// Builds one exact pending record from verified refresh evidence and local
    /// provider-sealed share inputs.
    pub(crate) fn new(
        command: VerifiedTenantRootRoleRefreshCommandV1,
        evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        share: CloudflareTenantRootRefreshShareInputV1,
    ) -> worker::Result<Self> {
        let sealed_binding = share.sealed_online_share.binding();
        let evidence_digest = validate_refresh_command_evidence(&command, &evidence)?;
        let replay_key_digest = command
            .scope()
            .key()
            .storage_key_digest()
            .map_err(|error| store_error(error.message()))?;
        let identity_digest = share
            .identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        validate_refresh_sealed_binding(
            &command,
            &evidence,
            sealed_binding,
            identity_digest,
            evidence_digest,
        )?;
        let role = cloudflare_role_for_protocol(sealed_binding.role())?;
        let pending =
            CloudflareTenantRootPendingShareV1::from_verified_refresh_installation_evidence(
                &evidence,
                share.staged_at_ms,
                replay_key_digest,
            )?;
        let sealed_share =
            CloudflareTenantRootSealedRoleShareV1::new(share.sealed_online_share.ciphertext())?;
        let record = CloudflareTenantRootRoleShareRecordV1::new(
            CloudflareTenantRootRoleShareRecordInputV1 {
                identity: share.identity,
                custody_lineage: sealed_binding.custody_lineage(),
                epoch: sealed_binding.epoch(),
                role,
                sealed_share,
                share_commitment: sealed_binding.share_commitment().clone(),
                epoch_wrapping_key_ref: sealed_binding.epoch_wrapping_key_ref().to_owned(),
                lifecycle: CloudflareTenantRootRoleShareLifecycleV1::Pending(pending),
                created_at_ms: share.staged_at_ms,
                updated_at_ms: share.staged_at_ms,
            },
        )?;
        validate_refresh_record_sealed_binding(&record, sealed_binding)?;
        validate_refresh_record_binding(&command, &evidence, &record)?;
        Ok(Self {
            command,
            evidence,
            record,
        })
    }
}

fn validate_refresh_record_sealed_binding(
    record: &CloudflareTenantRootRoleShareRecordV1,
    sealed_binding: &TenantRootOnlineRoleShareBindingV1,
) -> worker::Result<()> {
    let record_identity = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let record_role = cloudflare_role_for_protocol(sealed_binding.role())?;
    if record_identity != sealed_binding.identity_digest()
        || record.custody_lineage != sealed_binding.custody_lineage()
        || record.epoch != sealed_binding.epoch()
        || record.role != record_role
        || record.share_commitment != *sealed_binding.share_commitment()
        || record.epoch_wrapping_key_ref != sealed_binding.epoch_wrapping_key_ref()
    {
        return Err(store_error(
            "tenant-root refresh role-share record does not match its sealed binding",
        ));
    }
    Ok(())
}

/// Executed refresh insertion retaining the exact evidence needed to produce
/// its successful terminal receipt payload.
#[allow(dead_code)]
pub(crate) struct CloudflareTenantRootRefreshExecutedCommandV1 {
    executed: ExecutedTenantRootCommandV1,
    evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
}

impl CloudflareTenantRootRefreshExecutedCommandV1 {
    /// Returns the executed command this insertion must be terminalized under.
    pub(crate) const fn executed(&self) -> &ExecutedTenantRootCommandV1 {
        &self.executed
    }

    /// Returns the installation evidence this insertion attests.
    pub(crate) fn evidence_bytes(&self) -> &[u8] {
        self.evidence.canonical_bytes()
    }
}

impl fmt::Debug for CloudflareTenantRootRefreshExecutedCommandV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRefreshExecutedCommandV1")
            .field("executed", &self.executed)
            .field("evidence", &self.evidence)
            .finish()
    }
}

/// Exact durable admission token for a verified refresh command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRefreshAdmissionV1 {
    key: TenantRootCommandReplayKeyV1,
    command_digest: TenantRootProtocolDigestV1,
    reserved_at_ms: u64,
}

impl CloudflareTenantRootRefreshAdmissionV1 {
    pub(crate) const fn key(&self) -> &TenantRootCommandReplayKeyV1 {
        &self.key
    }

    pub(crate) const fn command_digest(&self) -> TenantRootProtocolDigestV1 {
        self.command_digest
    }

    pub(crate) const fn reserved_at_ms(&self) -> u64 {
        self.reserved_at_ms
    }
}

/// Admission result returned before refresh randomness or provider writes.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootRefreshAdmissionDecisionV1 {
    Execute {
        admission: CloudflareTenantRootRefreshAdmissionV1,
        durable_state: CloudflareTenantRootRefreshDurableStateV1,
    },
    ResumeExecution {
        admission: CloudflareTenantRootRefreshAdmissionV1,
        durable_state: CloudflareTenantRootRefreshDurableStateV1,
    },
    ResumeCompletion {
        admission: CloudflareTenantRootRefreshAdmissionV1,
        durable_state: CloudflareTenantRootRefreshDurableStateV1,
    },
    ReplayCompleted {
        receipt_bytes: Vec<u8>,
        durable_state: CloudflareTenantRootRefreshDurableStateV1,
    },
    ReplayFailed {
        failure_receipt_bytes: Vec<u8>,
    },
}

/// Durable decision for one creation-only pending-row reservation.
#[allow(dead_code)]
#[derive(Debug)]
pub(crate) enum CloudflareTenantRootInitialCreationDecisionV1 {
    /// The caller owns the newly reserved command and may execute it once.
    Execute {
        command: CloudflareTenantRootInitialCreationPendingCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        command: CloudflareTenantRootInitialCreationPendingCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        executed: CloudflareTenantRootInitialCreationExecutedCommandV1,
    },
    /// Return the exact prior successful receipt bytes.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt bytes.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Read-only admission decision before a creation attempt draws a role share.
///
/// A completed retry returns its exact public receipt here. Reserved or
/// executed retries remain in progress because their random scalar cannot be
/// regenerated after the original request ends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootInitialCreationPreflightV1 {
    Fresh,
    InProgress,
    ReplayCompleted { receipt_bytes: Vec<u8> },
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Result of one role-local initial-creation persistence attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootInitialCreationPersistenceOutcomeV1 {
    /// This call persisted the successful terminal receipt.
    Committed { receipt_bytes: Vec<u8> },
    /// A reservation or execution checkpoint already owns this command.
    InProgress,
    /// An identical command already committed the exact successful receipt.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// An identical command already committed the exact failure receipt.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Executable initial-activation command issued by the role's control plane.
#[derive(Debug, PartialEq, Eq)]
pub struct CloudflareTenantRootActivateInitialPendingCommandV1 {
    scope: TenantRootCommandScopeV1,
    reservation: ReservedTenantRootCommandV1,
    pending: CloudflareStoredTenantRootRoleShareV1,
    activation: CloudflareTenantRootActivationV1,
    updated_at_ms: u64,
    expected_revision: i64,
}

/// Executable active-epoch-swap command issued by the role's control plane.
#[derive(Debug, PartialEq, Eq)]
pub struct CloudflareTenantRootSwapActiveEpochCommandV1 {
    scope: TenantRootCommandScopeV1,
    reservation: ReservedTenantRootCommandV1,
    active: CloudflareStoredTenantRootRoleShareV1,
    pending: CloudflareStoredTenantRootRoleShareV1,
    activation: CloudflareTenantRootActivationV1,
    retirement: CloudflareTenantRootRetirementV1,
    updated_at_ms: u64,
    expected_active_revision: i64,
    expected_pending_revision: i64,
}

/// Executable pending-cleanup command issued by the role's control plane.
#[derive(Debug, PartialEq, Eq)]
pub struct CloudflareTenantRootCleanupPendingCommandV1 {
    scope: TenantRootCommandScopeV1,
    reservation: ReservedTenantRootCommandV1,
    pending: CloudflareStoredTenantRootRoleShareV1,
    expected_revision: i64,
    operation_payload_digest: TenantRootProtocolDigestV1,
}

/// Executable retired-cleanup command issued by the role's control plane.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootCleanupRetiredCommandV1 {
    scope: TenantRootCommandScopeV1,
    reservation: ReservedTenantRootCommandV1,
    retired: CloudflareStoredTenantRootRoleShareV1,
    expected_retired_revision: i64,
    expected_active_epoch: TenantRootShareEpoch,
    expected_active_revision: i64,
    operation_payload_digest: TenantRootProtocolDigestV1,
}

pub(crate) struct CloudflareTenantRootAuthorizedCleanupPendingCommandV1 {
    command: CloudflareTenantRootCleanupPendingCommandV1,
    authorization: VerifiedTenantRootRoleCleanupCommandV1,
}

pub(crate) struct CloudflareTenantRootAuthorizedCleanupRetiredCommandV1 {
    command: CloudflareTenantRootCleanupRetiredCommandV1,
    authorization: VerifiedTenantRootRoleCleanupCommandV1,
}

pub(crate) enum CloudflareTenantRootAuthorizedCleanupCommandV1 {
    Pending(CloudflareTenantRootAuthorizedCleanupPendingCommandV1),
    Retired(CloudflareTenantRootAuthorizedCleanupRetiredCommandV1),
}

pub(crate) struct CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
    executed: ExecutedTenantRootCommandV1,
    authorization: VerifiedTenantRootRoleCleanupCommandV1,
}

/// Durable decision for one insert-pending command reservation.
#[derive(Debug, PartialEq, Eq)]
pub enum CloudflareTenantRootInsertPendingDecisionV1 {
    /// The caller owns the newly reserved command and may execute it once.
    Execute {
        command: CloudflareTenantRootInsertPendingCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        /// Exact command rebuilt from the request payload and durable reservation.
        command: CloudflareTenantRootInsertPendingCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        /// Exact token reconstructed from the validated executed replay row.
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact prior successful receipt bytes.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt bytes.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Durable decision for one initial-activation command reservation.
#[derive(Debug, PartialEq, Eq)]
pub enum CloudflareTenantRootActivateInitialPendingDecisionV1 {
    /// The caller owns the newly reserved command and may execute it once.
    Execute {
        command: CloudflareTenantRootActivateInitialPendingCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        /// Exact command rebuilt from the request payload and durable reservation.
        command: CloudflareTenantRootActivateInitialPendingCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        /// Exact token reconstructed from the validated executed replay row.
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact prior successful receipt bytes.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt bytes.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Durable decision for one active-epoch-swap command reservation.
#[derive(Debug, PartialEq, Eq)]
pub enum CloudflareTenantRootSwapActiveEpochDecisionV1 {
    /// The caller owns the newly reserved command and may execute it once.
    Execute {
        command: CloudflareTenantRootSwapActiveEpochCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        /// Exact command rebuilt from the request payload and durable reservation.
        command: CloudflareTenantRootSwapActiveEpochCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        /// Exact token reconstructed from the validated executed replay row.
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact prior successful receipt bytes.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt bytes.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Durable decision for one pending-cleanup command reservation.
#[derive(Debug, PartialEq, Eq)]
pub enum CloudflareTenantRootCleanupPendingDecisionV1 {
    /// The caller owns the newly reserved command and may execute it once.
    Execute {
        command: CloudflareTenantRootCleanupPendingCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        /// Exact command rebuilt from the request payload and durable reservation.
        command: CloudflareTenantRootCleanupPendingCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        /// Exact token reconstructed from the validated executed replay row.
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact prior successful receipt bytes.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt bytes.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Durable decision for one retired-cleanup command reservation.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootCleanupRetiredDecisionV1 {
    Execute {
        command: CloudflareTenantRootCleanupRetiredCommandV1,
    },
    InProgress,
    ResumeExecution {
        command: CloudflareTenantRootCleanupRetiredCommandV1,
    },
    ResumeCompletion {
        executed: ExecutedTenantRootCommandV1,
    },
    ReplayCompleted {
        receipt_bytes: Vec<u8>,
    },
    ReplayFailed {
        failure_receipt_bytes: Vec<u8>,
    },
}

pub(crate) enum CloudflareTenantRootAuthorizedCleanupDecisionV1 {
    Execute {
        command: CloudflareTenantRootAuthorizedCleanupCommandV1,
    },
    InProgress,
    ResumeExecution {
        command: CloudflareTenantRootAuthorizedCleanupCommandV1,
    },
    ResumeCompletion {
        executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1,
    },
    /// The managed-restore source was consumed by the forward-refresh CAS;
    /// checkpoint the authorized cleanup so its provider cleanup can proceed.
    RetiredAlreadyAbsent {
        reservation: ReservedTenantRootCommandV1,
        authorization: VerifiedTenantRootRoleCleanupCommandV1,
    },
    ReplayCompleted {
        receipt_bytes: Vec<u8>,
    },
    ReplayFailed {
        failure_receipt_bytes: Vec<u8>,
    },
}

/// Result of persisting one terminal tenant-root command receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloudflareTenantRootCommandTerminalCommitV1 {
    /// This call committed the terminal receipt.
    Committed {
        /// Exact committed signed public receipt bytes.
        receipt_bytes: Vec<u8>,
    },
    /// Another identical call already committed these exact receipt bytes.
    Replay {
        /// Exact previously committed signed public receipt bytes.
        receipt_bytes: Vec<u8>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TenantRootCommandTerminalKindV1 {
    Completed,
    Failed,
}

enum TenantRootCommandTerminalInputV1 {
    Completed {
        executed: ExecutedTenantRootCommandV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    },
    Failed {
        reservation: ReservedTenantRootCommandV1,
        receipt: VerifiedTenantRootCommandFailureReceiptV1,
    },
}

struct TenantRootCommandTerminalCommitDataV1 {
    key: TenantRootCommandReplayKeyV1,
    command_digest: TenantRootProtocolDigestV1,
    reserved_at_ms: u64,
    executed_at_ms: Option<u64>,
    receipt_bytes: Vec<u8>,
    receipt_digest: TenantRootProtocolDigestV1,
    terminal_at_ms: u64,
    terminal_kind: TenantRootCommandTerminalKindV1,
}

struct DecodedTenantRootCommandTerminalReceiptV1 {
    receipt_bytes: Vec<u8>,
    receipt_digest: TenantRootProtocolDigestV1,
    terminal_at_ms: u64,
}

impl TenantRootCommandTerminalInputV1 {
    fn into_commit_data(self) -> worker::Result<TenantRootCommandTerminalCommitDataV1> {
        match self {
            Self::Completed { executed, receipt } => {
                if receipt.key() != executed.key()
                    || receipt.command_digest() != executed.command_digest()
                {
                    return Err(store_error(
                        "tenant-root successful receipt does not match its executed command",
                    ));
                }
                let key = *executed.key();
                let command_digest = executed.command_digest();
                let reserved_at_ms = executed.reserved_at_ms();
                let executed_at_ms = executed.executed_at_ms();
                let receipt_digest = receipt.digest();
                let terminal_at_ms = receipt.terminal_at_ms();
                executed
                    .complete(receipt_digest, terminal_at_ms)
                    .map_err(|error| store_error(error.message()))?;
                Ok(TenantRootCommandTerminalCommitDataV1 {
                    key,
                    command_digest,
                    reserved_at_ms,
                    executed_at_ms: Some(executed_at_ms),
                    receipt_bytes: receipt.into_canonical_bytes(),
                    receipt_digest,
                    terminal_at_ms,
                    terminal_kind: TenantRootCommandTerminalKindV1::Completed,
                })
            }
            Self::Failed {
                reservation,
                receipt,
            } => {
                if receipt.key() != reservation.key()
                    || receipt.command_digest() != reservation.command_digest()
                {
                    return Err(store_error(
                        "tenant-root failure receipt does not match its reserved command",
                    ));
                }
                let key = *reservation.key();
                let command_digest = reservation.command_digest();
                let reserved_at_ms = reservation.reserved_at_ms();
                let receipt_digest = receipt.digest();
                let terminal_at_ms = receipt.terminal_at_ms();
                reservation
                    .fail(receipt_digest, terminal_at_ms)
                    .map_err(|error| store_error(error.message()))?;
                Ok(TenantRootCommandTerminalCommitDataV1 {
                    key,
                    command_digest,
                    reserved_at_ms,
                    executed_at_ms: None,
                    receipt_bytes: receipt.into_canonical_bytes(),
                    receipt_digest,
                    terminal_at_ms,
                    terminal_kind: TenantRootCommandTerminalKindV1::Failed,
                })
            }
        }
    }
}

impl TenantRootCommandTerminalKindV1 {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    const fn expected_status(self) -> &'static str {
        match self {
            Self::Completed => "executed",
            Self::Failed => "reserved",
        }
    }

    const fn expected_outcome(self) -> TenantRootCommandTerminalOutcomeV1 {
        match self {
            Self::Completed => TenantRootCommandTerminalOutcomeV1::Success,
            Self::Failed => TenantRootCommandTerminalOutcomeV1::Failure,
        }
    }
}

/// Primary-consistent access to one Deriver's encrypted tenant-root share rows.
pub struct CloudflareTenantRootRoleShareStoreV1 {
    session: D1DatabaseSession,
    cipher: TenantRootRoleD1CipherV1,
}

#[cfg(debug_assertions)]
pub const CLOUDFLARE_TENANT_ROOT_ROLE_D1_INTEGRATION_PATH: &str =
    "/router-ab/deriver/tenant-root-role-d1/integration";

#[cfg(debug_assertions)]
const TENANT_ROOT_ROLE_D1_INTEGRATION_ENV: &str = "ROUTER_AB_TENANT_ROOT_ROLE_D1_INTEGRATION";

/// Exact request accepted by the debug-only role-store workerd probe.
#[cfg(debug_assertions)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CloudflareTenantRootRoleD1IntegrationRequestV1 {
    /// Runs the complete pending-to-active-to-retired lifecycle through the Rust store.
    RunLifecycle,
    /// Runs the creation-specific reserve, insert, terminalize, and replay path.
    ///
    /// Exercises the creation wrappers the generic lifecycle probe never
    /// reaches, driving a real ceremony so the terminal receipt comes from the
    /// production sequence rather than fixture bytes.
    RunInitialCreation,
}

/// Receipt proving that the real Rust role-store adapter completed its lifecycle probe.
#[cfg(debug_assertions)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareTenantRootRoleD1IntegrationReceiptV1 {
    role: CloudflareTenantRootDeriverRoleV1,
    retired_epoch: u64,
    retired_revision: i64,
    active_epoch: u64,
    active_revision: i64,
    cleanup_epoch: u64,
    command_receipt_digest_hex: String,
}

/// Returns whether the explicit workerd-only integration binding is enabled.
#[cfg(debug_assertions)]
pub fn cloudflare_tenant_root_role_d1_integration_enabled_v1(env: &Env) -> bool {
    env.var(TENANT_ROOT_ROLE_D1_INTEGRATION_ENV)
        .map(|value| value.to_string() == "enabled")
        .unwrap_or(false)
}

/// Exercises the production Rust store against a real role-private D1 binding.
#[cfg(debug_assertions)]
pub async fn run_cloudflare_tenant_root_role_d1_integration_v1(
    env: &Env,
    request: CloudflareTenantRootRoleD1IntegrationRequestV1,
) -> worker::Result<CloudflareTenantRootRoleD1IntegrationReceiptV1> {
    match request {
        CloudflareTenantRootRoleD1IntegrationRequestV1::RunLifecycle => {
            run_cloudflare_tenant_root_role_d1_lifecycle_integration_v1(env).await
        }
        CloudflareTenantRootRoleD1IntegrationRequestV1::RunInitialCreation => {
            run_cloudflare_tenant_root_initial_creation_integration_v1(env).await
        }
    }
}

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
    ) -> worker::Result<Self> {
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

impl CloudflareTenantRootRoleShareStoreV1 {
    /// Resolves the private D1 binding and role-local record cipher per request.
    pub fn from_env(env: &Env) -> worker::Result<Self> {
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
            session,
            cipher: TenantRootRoleD1CipherV1::from_env(env)?,
        })
    }

    pub(crate) fn seal_restore_import_key_ikm(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        ikm: &[u8; TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES],
    ) -> worker::Result<String> {
        self.cipher.seal_restore_import_ikm(binding, ikm)
    }

    pub(crate) fn open_restore_import_key_ikm(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> worker::Result<zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES]>> {
        self.cipher.open_restore_import_ikm(record)
    }

    pub(crate) fn seal_restore_imported_share(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        envelope_digest: &[u8; 32],
        share_bytes: &[u8],
    ) -> worker::Result<String> {
        self.cipher
            .seal_restore_imported_share(binding, envelope_digest, share_bytes)
    }

    pub(crate) fn validate_restore_imported_share(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> worker::Result<()> {
        self.open_restore_imported_share(record).map(drop)
    }

    pub(crate) fn open_restore_imported_share(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> worker::Result<SigningRootShare> {
        self.cipher.open_restore_imported_share(record)
    }

    async fn load_restore_refresh_attempt_by_replay(
        &self,
        replay_key_digest: [u8; 32],
    ) -> worker::Result<Option<CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1>> {
        let replay_key_digest_hex = encode_hex(&replay_key_digest);
        let row = self
            .session
            .prepare(LOAD_RESTORE_REFRESH_ATTEMPT_SQL)
            .bind_refs([D1Type::Text(replay_key_digest_hex.as_str())].iter())?
            .first::<TenantRootRestoreRefreshRoleAttemptD1RowV1>(None)
            .await?;
        row.map(|row| restore_refresh_role_attempt_record_from_row(row, self.cipher.role))
            .transpose()
    }

    async fn load_restore_refresh_attempt_by_command(
        &self,
        command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
    ) -> worker::Result<Option<CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1>> {
        let identity_digest_hex = encode_hex(command.identity_digest().as_bytes());
        let custody_lineage_b64u = command.custody_lineage().to_base64url();
        let restore_session_id_hex = encode_hex(command.restore_session_id().as_bytes());
        let role = match command.role() {
            TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
            TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
        };
        let command_digest_hex = encode_hex(command.digest().as_bytes());
        let row = self
            .session
            .prepare(LOAD_RESTORE_REFRESH_ATTEMPT_BY_COMMAND_SQL)
            .bind_refs(
                [
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                    D1Type::Text(role.as_str()),
                    D1Type::Text(command_digest_hex.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRestoreRefreshRoleAttemptD1RowV1>(None)
            .await?;
        row.map(|row| restore_refresh_role_attempt_record_from_row(row, self.cipher.role))
            .transpose()
    }

    fn restore_refresh_promotion_source(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
    ) -> worker::Result<CloudflareTenantRootRestoreRefreshPromotionSourceV1> {
        if record.lifecycle() != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
        {
            return Err(store_error(
                "tenant-root restore refresh promotion requires a refreshed attempt",
            ));
        }
        let refreshed_at_ms = record.refreshed_at_ms().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no refresh timestamp")
        })?;
        let evidence_bytes = record.installation_evidence_bytes()?;
        let refreshed_share =
            SigningRootShareWire::from_share(&self.cipher.open_restore_refresh_share(record)?);
        Ok(CloudflareTenantRootRestoreRefreshPromotionSourceV1 {
            refreshed_share,
            evidence_bytes,
            refreshed_at_ms,
        })
    }

    /// Loads the exact finalized staged share and evidence for promotion.
    ///
    /// The share is opened only for the caller's immediate provider-sealing
    /// step. A closed or non-finalized attempt never crosses this boundary.
    pub(crate) async fn load_restore_refresh_promotion_source(
        &self,
        command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
    ) -> worker::Result<CloudflareTenantRootRestoreRefreshPromotionSourceV1> {
        let record = self
            .load_restore_refresh_attempt_by_command(command)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore refresh promotion attempt was not found")
            })?;
        if record.binding().command_digest() != command.digest().as_bytes() {
            return Err(store_error(
                "tenant-root restore refresh promotion command digest does not match its row",
            ));
        }
        validate_restore_refresh_promotion_timestamp(command, &record)?;
        self.restore_refresh_promotion_source(&record)
    }

    fn restore_refresh_promotion_artifacts(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
    ) -> worker::Result<CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1> {
        let (provider_ciphertext, provider_binding_aad, provider_canary_receipt_bytes) =
            self.cipher.open_restore_refresh_promotion_output(record)?;
        let completed_at_ms = record.promotion_completed_at_ms().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no completion timestamp")
        })?;
        Ok(
            CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1 {
                provider_ciphertext,
                provider_binding_aad,
                provider_canary_receipt_bytes,
                completed_at_ms,
            },
        )
    }

    fn promotion_source_or_replay(
        &self,
        record: CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
        execute: bool,
    ) -> worker::Result<CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1> {
        match record.promotion_lifecycle() {
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed => Ok(
                CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1::Replay {
                    artifacts: self.restore_refresh_promotion_artifacts(&record)?,
                },
            ),
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Reserved => {
                let source = self.restore_refresh_promotion_source(&record)?;
                if execute {
                    Ok(
                        CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1::Execute {
                            source,
                        },
                    )
                } else {
                    Ok(
                        CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1::Resume {
                            source,
                        },
                    )
                }
            }
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted => Err(store_error(
                "tenant-root restore refresh promotion reservation did not persist",
            )),
        }
    }

    /// Reserves the one role-local restore promotion or returns its exact replay.
    ///
    /// The reservation is kept on the finalized restore-refresh row. A caller
    /// may safely retry after a crash between reservation and provider sealing;
    /// only completion makes provider bytes authoritative for replay.
    pub(crate) async fn reserve_restore_refresh_promotion(
        &self,
        command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
        now_ms: u64,
    ) -> worker::Result<CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1> {
        require_timestamp(
            "tenant-root restore refresh promotion reservation timestamp",
            now_ms,
        )?;
        let record = self
            .load_restore_refresh_attempt_by_command(command)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore refresh promotion attempt was not found")
            })?;
        if record.binding().command_digest() != command.digest().as_bytes() {
            return Err(store_error(
                "tenant-root restore refresh promotion command digest does not match its row",
            ));
        }
        validate_restore_refresh_promotion_timestamp(command, &record)?;
        match record.promotion_lifecycle() {
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed
            | CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Reserved => {
                self.promotion_source_or_replay(record, false)
            }
            CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Unstarted => {
                if record.lifecycle()
                    != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
                {
                    return Err(store_error(
                        "tenant-root restore refresh promotion requires a refreshed attempt",
                    ));
                }
                if now_ms < command.context().issued_at_ms()
                    || now_ms > command.context().expires_at_ms()
                {
                    return Err(store_error(
                        "tenant-root restore refresh promotion command is expired",
                    ));
                }
                let identity_digest_hex = encode_hex(command.identity_digest().as_bytes());
                let custody_lineage_b64u = command.custody_lineage().to_base64url();
                let restore_session_id_hex = encode_hex(command.restore_session_id().as_bytes());
                let role = match command.role() {
                    TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
                    TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
                };
                let command_digest_hex = encode_hex(command.digest().as_bytes());
                let reserved_at_ms = timestamp_i64(now_ms)?.to_string();
                let statement = self
                    .session
                    .prepare(RESERVE_RESTORE_REFRESH_PROMOTION_SQL)
                    .bind_refs(
                        [
                            D1Type::Text(identity_digest_hex.as_str()),
                            D1Type::Text(custody_lineage_b64u.as_str()),
                            D1Type::Text(restore_session_id_hex.as_str()),
                            D1Type::Text(role.as_str()),
                            D1Type::Text(command_digest_hex.as_str()),
                            D1Type::Text(reserved_at_ms.as_str()),
                        ]
                        .iter(),
                    )?;
                let result = statement.run().await?;
                if result_changes(&result)? == 1 {
                    let reserved = self
                        .load_restore_refresh_attempt_by_command(command)
                        .await?
                        .ok_or_else(|| {
                            store_error(
                                "tenant-root restore refresh promotion row disappeared after reservation",
                            )
                        })?;
                    self.promotion_source_or_replay(reserved, true)
                } else {
                    let current = self
                        .load_restore_refresh_attempt_by_command(command)
                        .await?
                        .ok_or_else(|| {
                            store_error(
                                "tenant-root restore refresh promotion reservation conflict disappeared",
                            )
                        })?;
                    self.promotion_source_or_replay(current, false)
                }
            }
        }
    }

    fn validate_restore_refresh_promotion_canary(
        &self,
        command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
        canary_receipt_bytes: &[u8],
        now_ms: u64,
    ) -> worker::Result<()> {
        if canary_receipt_bytes.is_empty()
            || canary_receipt_bytes.len() > TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1
        {
            return Err(store_error(
                "tenant-root restore refresh provider canary length is invalid",
            ));
        }
        let canary =
            TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(canary_receipt_bytes)
                .map_err(|error| store_error(error.message()))?;
        let binding = canary.binding();
        let role = tenant_root_protocol_role_of(record.binding().import_binding().role);
        let refreshed_at_ms = record.refreshed_at_ms().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no refresh timestamp")
        })?;
        if binding.identity_digest() != command.identity_digest()
            || binding.custody_lineage() != command.custody_lineage()
            || binding.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation
            || binding.target_epoch() != TenantRootShareEpoch::INITIAL
            || binding.commitments().root_commitment() != command.stable_root_commitment()
            || binding.signing_key_id() != command.context().signing_key_id(role)
            || binding.issued_at_ms() != command.issued_at_ms()
            || binding.expires_at_ms() != command.expires_at_ms()
            || binding.completed_at_ms() < refreshed_at_ms
            || binding.completed_at_ms() != now_ms
        {
            return Err(store_error(
                "tenant-root restore refresh provider canary does not match its promotion",
            ));
        }
        Ok(())
    }

    fn promotion_replay_matches(
        stored: &CloudflareTenantRootRestoreRefreshPromotionStoredArtifactsV1,
        sealed: &TenantRootSealedOnlineRoleShareV1,
        canary_receipt_bytes: &[u8],
    ) -> worker::Result<()> {
        let provider_binding_aad = sealed.aad().map_err(|error| store_error(error.message()))?;
        if stored.provider_ciphertext() != sealed.ciphertext()
            || stored.provider_binding_aad() != provider_binding_aad.as_slice()
            || stored.provider_canary_receipt_bytes() != canary_receipt_bytes
        {
            return Err(store_error(
                "tenant-root restore refresh promotion replay conflicts with its durable result",
            ));
        }
        Ok(())
    }

    /// Persists provider ciphertext and canary after one reservation.
    ///
    /// A completed row is authoritative. Any retry must reproduce both opaque
    /// provider bytes and canonical canary bytes exactly.
    pub(crate) async fn complete_restore_refresh_promotion(
        &self,
        command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
        identity: TenantRootIdentityV1,
        sealed: &TenantRootSealedOnlineRoleShareV1,
        canary_receipt_bytes: &[u8],
        now_ms: u64,
    ) -> worker::Result<CloudflareTenantRootRestoreRefreshPromotionCompletionV1> {
        require_timestamp(
            "tenant-root restore refresh promotion completion timestamp",
            now_ms,
        )?;
        let record = self
            .load_restore_refresh_attempt_by_command(command)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore refresh promotion attempt was not found")
            })?;
        if record.binding().command_digest() != command.digest().as_bytes() {
            return Err(store_error(
                "tenant-root restore refresh promotion command digest does not match its row",
            ));
        }
        if record.promotion_lifecycle()
            == CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed
        {
            let stored = self.restore_refresh_promotion_artifacts(&record)?;
            return Ok(
                CloudflareTenantRootRestoreRefreshPromotionCompletionV1::Replay {
                    artifacts: stored,
                },
            );
        }
        if record.promotion_lifecycle()
            != CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Reserved
        {
            return Err(store_error(
                "tenant-root restore refresh promotion was not reserved",
            ));
        }
        let reserved_at_ms = record.promotion_reserved_at_ms().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no reservation timestamp")
        })?;
        let refreshed_at_ms = record.refreshed_at_ms().ok_or_else(|| {
            store_error("tenant-root restore refresh promotion has no refresh timestamp")
        })?;
        if now_ms < reserved_at_ms || now_ms < refreshed_at_ms {
            return Err(store_error(
                "tenant-root restore refresh promotion completion predates its durable state",
            ));
        }
        if now_ms < command.context().issued_at_ms() || now_ms > command.context().expires_at_ms() {
            return Err(store_error(
                "tenant-root restore refresh promotion command is expired",
            ));
        }
        validate_restore_refresh_promotion_timestamp(command, &record)?;
        self.validate_restore_refresh_promotion_canary(
            command,
            &record,
            canary_receipt_bytes,
            now_ms,
        )?;
        let encrypted_output = self
            .cipher
            .seal_restore_refresh_promotion_output(&record, sealed)?;
        let canary_b64u = encode_base64url_bytes_v1(canary_receipt_bytes);
        let completion_at_ms = timestamp_i64(now_ms)?.to_string();
        let identity_digest_hex = encode_hex(command.identity_digest().as_bytes());
        let custody_lineage_b64u = command.custody_lineage().to_base64url();
        let restore_session_id_hex = encode_hex(command.restore_session_id().as_bytes());
        let role = match command.role() {
            TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
            TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
        };
        let command_digest_hex = encode_hex(command.digest().as_bytes());
        let reserved_at_ms = reserved_at_ms.to_string();
        let statement = self
            .session
            .prepare(COMPLETE_RESTORE_REFRESH_PROMOTION_SQL)
            .bind_refs(
                [
                    D1Type::Text(encrypted_output.as_str()),
                    D1Type::Text(canary_b64u.as_str()),
                    D1Type::Text(completion_at_ms.as_str()),
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                    D1Type::Text(role.as_str()),
                    D1Type::Text(command_digest_hex.as_str()),
                    D1Type::Text(reserved_at_ms.as_str()),
                ]
                .iter(),
            )?;
        let binding = sealed.binding();
        if identity
            .digest()
            .map_err(|error| store_error(error.message()))?
            != command.identity_digest()
            || binding.identity_digest() != command.identity_digest()
            || binding.custody_lineage() != command.custody_lineage()
            || binding.epoch() != TenantRootShareEpoch::INITIAL
            || binding.role() != command.role()
        {
            return Err(store_error(
                "restore promotion pending scope does not match its command",
            ));
        }
        let pending = CloudflareTenantRootRoleShareRecordV1::new(
            CloudflareTenantRootRoleShareRecordInputV1 {
                identity,
                custody_lineage: command.custody_lineage(),
                epoch: TenantRootShareEpoch::INITIAL,
                role,
                sealed_share: CloudflareTenantRootSealedRoleShareV1::new(sealed.ciphertext())?,
                share_commitment: binding.share_commitment().clone(),
                epoch_wrapping_key_ref: binding.epoch_wrapping_key_ref().to_owned(),
                lifecycle: CloudflareTenantRootRoleShareLifecycleV1::Pending(
                    CloudflareTenantRootPendingShareV1::from_stored_digest(
                        binding.installation_evidence_digest(),
                        now_ms,
                    )?,
                ),
                created_at_ms: now_ms,
                updated_at_ms: now_ms,
            },
        )?;
        let ciphertext = self.cipher.seal(&pending, 1)?;
        let insert = self.session.prepare(INSERT_SQL).bind_refs(
            [
                D1Type::Text(&identity_digest_hex),
                D1Type::Text(&custody_lineage_b64u),
                D1Type::Text("1"),
                D1Type::Text(role.as_str()),
                D1Type::Text("pending"),
                D1Type::Text(&ciphertext),
                D1Type::Text(&completion_at_ms),
                D1Type::Text(&completion_at_ms),
            ]
            .iter(),
        )?;
        // The promoted provider result and its activation-ready row become durable together.
        let results = self.session.batch(vec![statement, insert]).await?;
        if results.len() != 2 || results.iter().any(|result| !result.success()) {
            return Err(store_error("restore promotion persistence failed"));
        }
        let durable = self
            .load_initial_pending_for_activation(
                command.identity_digest(),
                command.custody_lineage(),
            )
            .await?;
        if durable.record().share_commitment() != pending.share_commitment()
            || durable.record().epoch_wrapping_key_ref() != pending.epoch_wrapping_key_ref()
        {
            return Err(store_error(
                "restore promotion conflicts with the durable role share",
            ));
        }
        if result_changes(&results[0])? == 1 {
            let stored_record = self
                .load_restore_refresh_attempt_by_command(command)
                .await?
                .ok_or_else(|| {
                    store_error(
                        "tenant-root restore refresh promotion row disappeared after completion",
                    )
                })?;
            let stored = self.restore_refresh_promotion_artifacts(&stored_record)?;
            Self::promotion_replay_matches(&stored, sealed, canary_receipt_bytes)?;
            return Ok(
                CloudflareTenantRootRestoreRefreshPromotionCompletionV1::Committed {
                    artifacts: stored,
                },
            );
        }
        let current = self
            .load_restore_refresh_attempt_by_command(command)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore refresh promotion completion conflict disappeared")
            })?;
        if current.promotion_lifecycle()
            == CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed
        {
            let stored = self.restore_refresh_promotion_artifacts(&current)?;
            return Ok(
                CloudflareTenantRootRestoreRefreshPromotionCompletionV1::Replay {
                    artifacts: stored,
                },
            );
        }
        Err(store_error(
            "tenant-root restore refresh promotion changed concurrently",
        ))
    }

    /// Atomically admits one restore refresh and samples its replay seed.
    /// Existing rows are authoritative, including after command expiry.
    pub(crate) async fn admit_restore_refresh(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
        command_digest: [u8; 32],
        issued_at_ms: u64,
        expires_at_ms: u64,
        now_ms: u64,
    ) -> worker::Result<CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1> {
        record.validate()?;
        self.cipher.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed {
            return Err(store_error(
                "tenant-root restore refresh requires an accepted import",
            ));
        }
        let replay_key_digest = record.binding.replay_key_digest;
        if let Some(existing) = self
            .load_restore_refresh_attempt_by_replay(replay_key_digest)
            .await?
        {
            if !existing.matches_request(record, &command_digest, issued_at_ms, expires_at_ms) {
                return Err(store_error(
                    "tenant-root restore refresh replay conflicts with its signed binding",
                ));
            }
            if existing.lifecycle()
                == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed
            {
                return Err(store_error("tenant-root restore refresh session is closed"));
            }
            self.validate_restore_imported_share(record)?;
            let replay_seed = self.cipher.open_restore_refresh_seed(&existing)?;
            return match existing.lifecycle() {
                CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Pending => Ok(
                    CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1::Resume {
                        replay_seed,
                        admitted_at_ms: existing.binding().admitted_at_ms(),
                    },
                ),
                CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed => Ok(
                    CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1::Refreshed {
                        replay_seed,
                        admitted_at_ms: existing.binding().admitted_at_ms(),
                        evidence_bytes: existing.installation_evidence_bytes()?,
                    },
                ),
                CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed => {
                    unreachable!("closed restore refresh attempt was rejected before seed opening")
                }
            };
        }
        require_timestamp("tenant-root restore refresh current timestamp", now_ms)?;
        if now_ms < issued_at_ms || now_ms >= expires_at_ms {
            return Err(store_error(
                "tenant-root restore refresh command is outside its admission window",
            ));
        }
        self.validate_restore_imported_share(record)?;
        let binding = CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1::new(
            record,
            command_digest,
            issued_at_ms,
            expires_at_ms,
            now_ms,
        )?;
        let mut replay_seed =
            zeroize::Zeroizing::new([0_u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]);
        rand_core::RngCore::fill_bytes(&mut CloudflareHpkeGetrandomRngV1, replay_seed.as_mut());
        require_nonzero_bytes(
            "tenant-root restore refresh replay seed",
            replay_seed.as_ref(),
        )?;
        let encrypted_seed_json = self
            .cipher
            .seal_restore_refresh_seed(&binding, &replay_seed)?;
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let generation = record.binding.generation.to_string();
        let import_key_id = record.binding.import_key_id.as_str();
        let import_replay_key_digest_hex = encode_hex(&record.binding.replay_key_digest);
        let import_command_digest_hex = encode_hex(&record.binding.command_digest);
        let import_operation_digest_hex = encode_hex(&record.binding.operation_digest);
        let recovery_set_id_b64u = record.binding.recovery_set_id.to_base64url();
        let manifest_digest_hex = encode_hex(&record.binding.manifest_digest);
        let stable_root_commitment_b64u =
            encode_base64url_bytes_v1(&record.binding.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&record.binding.share_commitment);
        let destination_fingerprint_hex =
            encode_hex(record.binding.destination_fingerprint.as_bytes());
        let import_public_key_b64u =
            encode_base64url_bytes_v1(record.binding.import_public_key.as_bytes());
        let import_issued_at_ms = timestamp_i64(record.binding.issued_at_ms)?.to_string();
        let import_expires_at_ms = timestamp_i64(record.binding.expires_at_ms)?.to_string();
        let refresh_command_digest_hex = encode_hex(&command_digest);
        let refresh_issued_at_ms = timestamp_i64(issued_at_ms)?.to_string();
        let refresh_expires_at_ms = timestamp_i64(expires_at_ms)?.to_string();
        let admitted_at_ms = timestamp_i64(now_ms)?.to_string();
        let insert = self
            .session
            .prepare(INSERT_RESTORE_REFRESH_ATTEMPT_SQL)
            .bind_refs(
                [
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                    D1Type::Text(self.cipher.role.as_str()),
                    D1Type::Text(generation.as_str()),
                    D1Type::Text(import_key_id),
                    D1Type::Text(import_replay_key_digest_hex.as_str()),
                    D1Type::Text(import_command_digest_hex.as_str()),
                    D1Type::Text(import_operation_digest_hex.as_str()),
                    D1Type::Text(recovery_set_id_b64u.as_str()),
                    D1Type::Text(manifest_digest_hex.as_str()),
                    D1Type::Text(stable_root_commitment_b64u.as_str()),
                    D1Type::Text(share_commitment_b64u.as_str()),
                    D1Type::Text(destination_fingerprint_hex.as_str()),
                    D1Type::Text(import_public_key_b64u.as_str()),
                    D1Type::Text(import_issued_at_ms.as_str()),
                    D1Type::Text(import_expires_at_ms.as_str()),
                    D1Type::Text(refresh_command_digest_hex.as_str()),
                    D1Type::Text(refresh_issued_at_ms.as_str()),
                    D1Type::Text(refresh_expires_at_ms.as_str()),
                    D1Type::Text(admitted_at_ms.as_str()),
                    D1Type::Text(encrypted_seed_json.as_str()),
                ]
                .iter(),
            )?;
        let result = insert.run().await?;
        match result_changes(&result)? {
            1 => Ok(
                CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1::Execute {
                    replay_seed,
                    admitted_at_ms: now_ms,
                },
            ),
            0 => {
                let existing = self
                    .load_restore_refresh_attempt_by_replay(replay_key_digest)
                    .await?
                    .ok_or_else(|| {
                        store_error(
                            "tenant-root restore refresh admission conflict disappeared before reconciliation",
                        )
                    })?;
                if !existing.matches_request(record, &command_digest, issued_at_ms, expires_at_ms) {
                    return Err(store_error(
                        "tenant-root restore refresh admission conflicts after concurrent insert",
                    ));
                }
                if existing.lifecycle()
                    == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed
                {
                    return Err(store_error("tenant-root restore refresh session is closed"));
                }
                self.validate_restore_imported_share(record)?;
                let replay_seed = self.cipher.open_restore_refresh_seed(&existing)?;
                match existing.lifecycle() {
                    CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Pending => Ok(
                        CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1::Resume {
                            replay_seed,
                            admitted_at_ms: existing.binding().admitted_at_ms(),
                        },
                    ),
                    CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed => Ok(
                        CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1::Refreshed {
                            replay_seed,
                            admitted_at_ms: existing.binding().admitted_at_ms(),
                            evidence_bytes: existing.installation_evidence_bytes()?,
                        },
                    ),
                    CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed => {
                        unreachable!(
                            "closed restore refresh attempt was rejected before seed opening"
                        )
                    }
                }
            }
            _ => Err(store_error(
                "tenant-root restore refresh admission returned an invalid change count",
            )),
        }
    }

    /// Atomically stages the verified refreshed share and signed evidence.
    /// A late response cannot write after the session tombstone or a prior
    /// finalization has won the exact replay row.
    pub(crate) async fn finalize_restore_refresh(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
        command_digest: [u8; 32],
        refreshed_share: &SigningRootShareWire,
        evidence_bytes: &[u8],
        now_ms: u64,
    ) -> worker::Result<Vec<u8>> {
        record.validate()?;
        self.cipher.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed {
            return Err(store_error(
                "tenant-root restore refresh requires an accepted import",
            ));
        }
        require_timestamp("tenant-root restore refresh finalization timestamp", now_ms)?;
        if evidence_bytes.is_empty()
            || evidence_bytes.len()
                > router_ab_core::TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1
        {
            return Err(store_error(
                "tenant-root restore refresh installation evidence is invalid",
            ));
        }
        let signed_evidence =
            TenantRootSignedShareInstallationEvidenceV1::decode_canonical_bytes(evidence_bytes)
                .map_err(|error| store_error(error.message()))?;
        let canonical_evidence = signed_evidence
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?;
        if canonical_evidence.as_slice() != evidence_bytes
            || signed_evidence.role() != tenant_root_protocol_role_of(record.binding.role)
        {
            return Err(store_error(
                "tenant-root restore refresh installation evidence does not match its role",
            ));
        }
        let share = refreshed_share
            .to_share()
            .map_err(|_| store_error("tenant-root restore refreshed share is invalid"))?;
        if share.id() != tenant_root_protocol_role_of(record.binding.role).share_id() {
            return Err(store_error(
                "tenant-root restore refreshed share belongs to the wrong role",
            ));
        }
        let evidence_digest: [u8; 32] = Sha256::digest(evidence_bytes).into();
        let replay_key_digest = record.binding.replay_key_digest;
        let existing = self
            .load_restore_refresh_attempt_by_replay(replay_key_digest)
            .await?
            .ok_or_else(|| store_error("tenant-root restore refresh admission row is missing"))?;
        if !existing.matches_request(
            record,
            &command_digest,
            existing.binding().issued_at_ms(),
            existing.binding().expires_at_ms(),
        ) {
            return Err(store_error(
                "tenant-root restore refresh finalization conflicts with its signed binding",
            ));
        }
        if now_ms < existing.binding().admitted_at_ms() {
            return Err(store_error(
                "tenant-root restore refresh finalization predates admission",
            ));
        }
        if existing.lifecycle() == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Closed
        {
            return Err(store_error("tenant-root restore refresh session is closed"));
        }
        if existing.lifecycle()
            == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
        {
            let prior_evidence = existing.installation_evidence_bytes()?;
            let prior_share = self.cipher.open_restore_refresh_share(&existing)?;
            if prior_evidence != evidence_bytes
                || SigningRootShareWire::from_share(&prior_share).to_bytes()
                    != refreshed_share.to_bytes()
            {
                return Err(store_error(
                    "tenant-root restore refresh finalization conflicts with its durable result",
                ));
            }
            return Ok(prior_evidence);
        }
        let encrypted_refreshed_share_json = self.cipher.seal_restore_refresh_share(
            existing.binding(),
            &evidence_digest,
            refreshed_share,
        )?;
        let installation_evidence_b64u = encode_base64url_bytes_v1(evidence_bytes);
        let installation_evidence_digest_hex = encode_hex(&evidence_digest);
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let generation = record.binding.generation.to_string();
        let import_key_id = record.binding.import_key_id.as_str();
        let import_replay_key_digest_hex = encode_hex(&record.binding.replay_key_digest);
        let import_command_digest_hex = encode_hex(&record.binding.command_digest);
        let refresh_command_digest_hex = encode_hex(&command_digest);
        let refresh_issued_at_ms = existing.binding().issued_at_ms().to_string();
        let refresh_expires_at_ms = existing.binding().expires_at_ms().to_string();
        let finalization_at_ms = timestamp_i64(now_ms)?.to_string();
        let statement = self
            .session
            .prepare(FINALIZE_RESTORE_REFRESH_ATTEMPT_SQL)
            .bind_refs(
                [
                    D1Type::Text(encrypted_refreshed_share_json.as_str()),
                    D1Type::Text(installation_evidence_b64u.as_str()),
                    D1Type::Text(installation_evidence_digest_hex.as_str()),
                    D1Type::Text(finalization_at_ms.as_str()),
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                    D1Type::Text(self.cipher.role.as_str()),
                    D1Type::Text(generation.as_str()),
                    D1Type::Text(import_key_id),
                    D1Type::Text(import_replay_key_digest_hex.as_str()),
                    D1Type::Text(import_command_digest_hex.as_str()),
                    D1Type::Text(refresh_command_digest_hex.as_str()),
                    D1Type::Text(refresh_issued_at_ms.as_str()),
                    D1Type::Text(refresh_expires_at_ms.as_str()),
                ]
                .iter(),
            )?;
        let guard = self.command_cas_count_guard_statement(1)?;
        let results = self.session.batch(vec![statement, guard]).await?;
        if results.len() != 2 || results.iter().any(|result| !result.success()) {
            return Err(store_error(
                "tenant-root restore refresh finalization failed",
            ));
        }
        match result_changes(&results[0])? {
            1 => {
                require_changes(
                    &results[1],
                    0,
                    "tenant-root restore refresh finalization count guard returned an invalid change count",
                )?;
                let stored = self
                    .load_restore_refresh_attempt_by_replay(replay_key_digest)
                    .await?
                    .ok_or_else(|| {
                        store_error(
                            "tenant-root restore refresh row disappeared after finalization",
                        )
                    })?;
                let stored_evidence = stored.installation_evidence_bytes()?;
                let stored_share = self.cipher.open_restore_refresh_share(&stored)?;
                if stored_evidence != evidence_bytes
                    || SigningRootShareWire::from_share(&stored_share).to_bytes()
                        != refreshed_share.to_bytes()
                {
                    return Err(store_error(
                        "tenant-root restore refresh row is inconsistent after finalization",
                    ));
                }
                Ok(stored_evidence)
            }
            0 => {
                let stored = self
                    .load_restore_refresh_attempt_by_replay(replay_key_digest)
                    .await?
                    .ok_or_else(|| {
                        store_error(
                            "tenant-root restore refresh finalization conflict disappeared before reconciliation",
                        )
                    })?;
                if stored.lifecycle()
                    == CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
                {
                    let stored_evidence = stored.installation_evidence_bytes()?;
                    let stored_share = self.cipher.open_restore_refresh_share(&stored)?;
                    if stored_evidence == evidence_bytes
                        && SigningRootShareWire::from_share(&stored_share).to_bytes()
                            == refreshed_share.to_bytes()
                    {
                        return Ok(stored_evidence);
                    }
                }
                Err(store_error(
                    "tenant-root restore refresh finalization changed concurrently",
                ))
            }
            _ => Err(store_error(
                "tenant-root restore refresh finalization returned an invalid change count",
            )),
        }
    }

    pub(crate) async fn load_restore_import_key_by_replay(
        &self,
        replay_key_digest: [u8; 32],
    ) -> worker::Result<Option<CloudflareTenantRootRestoreImportKeyRecordV1>> {
        let replay_key_digest_hex = encode_hex(&replay_key_digest);
        let row = self
            .session
            .prepare(LOAD_RESTORE_IMPORT_KEY_BY_REPLAY_SQL)
            .bind_refs([D1Type::Text(replay_key_digest_hex.as_str())].iter())?
            .first::<TenantRootRestoreImportKeyD1RowV1>(None)
            .await?;
        row.map(|row| self.open_restore_import_key_row(row))
            .transpose()
    }

    pub(crate) async fn load_current_restore_import_key(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
    ) -> worker::Result<Option<CloudflareTenantRootRestoreImportKeyRecordV1>> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(restore_session_id.as_bytes());
        let row = self
            .session
            .prepare(LOAD_RESTORE_IMPORT_KEY_CURRENT_SQL)
            .bind_refs(
                [
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                    D1Type::Text(self.cipher.role.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRestoreImportKeyD1RowV1>(None)
            .await?;
        row.map(|row| self.open_restore_import_key_row(row))
            .transpose()
    }

    async fn load_restore_import_session_tombstone(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
    ) -> worker::Result<Option<CloudflareTenantRootRestoreImportSessionTombstoneV1>> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(restore_session_id.as_bytes());
        let row = self
            .session
            .prepare(LOAD_RESTORE_IMPORT_SESSION_TOMBSTONE_SQL)
            .bind_refs(
                [
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRestoreImportSessionTombstoneD1RowV1>(None)
            .await?;
        row.map(|row| {
            restore_import_session_tombstone_from_row(
                row,
                identity_digest,
                custody_lineage,
                restore_session_id,
                self.cipher.role,
            )
        })
        .transpose()
    }

    pub(crate) async fn restore_import_session_is_closed(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
    ) -> worker::Result<bool> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(restore_session_id.as_bytes());
        let row = self
            .session
            .prepare(LOAD_RESTORE_IMPORT_SESSION_CLOSED_SQL)
            .bind_refs(
                [
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRestoreImportSessionClosedD1RowV1>(None)
            .await?;
        if let Some(row) = row {
            positive_u64_from_i64(
                "tenant-root restore import session close timestamp",
                row.closed_at_ms,
            )?;
            return Ok(true);
        }
        Ok(false)
    }

    /// Stores one fresh role import key and its encrypted IKM atomically with
    /// predecessor supersession. The replay row is the dedicated key row, so
    /// a retry can return public metadata after the command itself expires.
    pub(crate) async fn persist_restore_import_key_issue(
        &self,
        record: CloudflareTenantRootRestoreImportKeyRecordV1,
        now_ms: u64,
    ) -> worker::Result<CloudflareTenantRootRestoreImportKeyIssueDecisionV1> {
        record.validate()?;
        self.cipher.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued {
            return Err(store_error(
                "tenant-root restore import key issue requires an issued record",
            ));
        }
        if self
            .restore_import_session_is_closed(
                record.binding.identity_digest,
                record.binding.custody_lineage,
                record.binding.restore_session_id,
            )
            .await?
        {
            return Err(store_error("tenant-root restore import session is closed"));
        }
        let replay_key_digest = record.binding.replay_key_digest;
        if let Some(existing) = self
            .load_restore_import_key_by_replay(replay_key_digest)
            .await?
        {
            if !existing.binding.matches_authorized_scope(&record.binding) {
                return Err(store_error(
                    "tenant-root restore import key replay conflicts with its signed binding",
                ));
            }
            if existing.lifecycle == CloudflareTenantRootRestoreImportKeyLifecycleV1::Closed {
                return Err(store_error("tenant-root restore import session is closed"));
            }
            self.validate_restore_import_key_ciphertext(&existing)?;
            return Ok(CloudflareTenantRootRestoreImportKeyIssueDecisionV1::Replay(
                existing,
            ));
        }
        if now_ms < record.binding.issued_at_ms || now_ms >= record.binding.expires_at_ms {
            return Err(store_error(
                "tenant-root restore import key issue command is expired",
            ));
        }
        let current = self
            .load_current_restore_import_key(
                record.binding.identity_digest,
                record.binding.custody_lineage,
                record.binding.restore_session_id,
            )
            .await?;
        if let Some(current) = &current {
            match current.lifecycle {
                CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed => {
                    return Err(store_error(
                        "tenant-root restore import role already has an installed share",
                    ));
                }
                CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued
                | CloudflareTenantRootRestoreImportKeyLifecycleV1::Expired => {}
                CloudflareTenantRootRestoreImportKeyLifecycleV1::Superseded
                | CloudflareTenantRootRestoreImportKeyLifecycleV1::Closed => {
                    return Err(store_error(
                        "tenant-root restore import key has a terminal local lifecycle",
                    ));
                }
            }
            let expected_generation =
                current.binding.generation.checked_add(1).ok_or_else(|| {
                    store_error("tenant-root restore import key generation is exhausted")
                })?;
            if record.binding.generation != expected_generation {
                return Err(store_error(
                    "tenant-root restore import key generation is not monotonic",
                ));
            }
        } else if record.binding.generation != 1 {
            return Err(store_error(
                "first tenant-root restore import key generation must be one",
            ));
        }
        let mut persisted = record;
        persisted.created_at_ms = now_ms;
        persisted.updated_at_ms = now_ms;
        persisted.validate()?;
        let identity_digest_hex = encode_hex(persisted.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = persisted.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(persisted.binding.restore_session_id.as_bytes());
        let generation = persisted.binding.generation.to_string();
        let import_key_id = persisted.binding.import_key_id.as_str();
        let replay_key_digest_hex = encode_hex(&persisted.binding.replay_key_digest);
        let command_digest_hex = encode_hex(&persisted.binding.command_digest);
        let operation_digest_hex = encode_hex(&persisted.binding.operation_digest);
        let recovery_set_id_b64u = persisted.binding.recovery_set_id.to_base64url();
        let manifest_digest_hex = encode_hex(&persisted.binding.manifest_digest);
        let stable_root_commitment_b64u =
            encode_base64url_bytes_v1(&persisted.binding.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&persisted.binding.share_commitment);
        let destination_fingerprint_hex =
            encode_hex(persisted.binding.destination_fingerprint.as_bytes());
        let public_key_b64u =
            encode_base64url_bytes_v1(persisted.binding.import_public_key.as_bytes());
        let encrypted_ikm_json = persisted.encrypted_ikm_json()?;
        let issued_at_ms = timestamp_i64(persisted.binding.issued_at_ms)?.to_string();
        let expires_at_ms = timestamp_i64(persisted.binding.expires_at_ms)?.to_string();
        let now_ms = timestamp_i64(now_ms)?.to_string();
        let insert = self
            .session
            .prepare(INSERT_RESTORE_IMPORT_KEY_SQL)
            .bind_refs(
                [
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                    D1Type::Text(self.cipher.role.as_str()),
                    D1Type::Text(generation.as_str()),
                    D1Type::Text(import_key_id),
                    D1Type::Text(replay_key_digest_hex.as_str()),
                    D1Type::Text(command_digest_hex.as_str()),
                    D1Type::Text(operation_digest_hex.as_str()),
                    D1Type::Text(recovery_set_id_b64u.as_str()),
                    D1Type::Text(manifest_digest_hex.as_str()),
                    D1Type::Text(stable_root_commitment_b64u.as_str()),
                    D1Type::Text(share_commitment_b64u.as_str()),
                    D1Type::Text(destination_fingerprint_hex.as_str()),
                    D1Type::Text(public_key_b64u.as_str()),
                    D1Type::Text(encrypted_ikm_json),
                    D1Type::Text(issued_at_ms.as_str()),
                    D1Type::Text(expires_at_ms.as_str()),
                ]
                .iter(),
            )?;
        let results = if let Some(current) = current {
            let predecessor_generation = current.binding.generation.to_string();
            let supersede = self
                .session
                .prepare(SUPERSEDE_RESTORE_IMPORT_KEY_SQL)
                .bind_refs(
                    [
                        D1Type::Text(identity_digest_hex.as_str()),
                        D1Type::Text(custody_lineage_b64u.as_str()),
                        D1Type::Text(restore_session_id_hex.as_str()),
                        D1Type::Text(self.cipher.role.as_str()),
                        D1Type::Text(predecessor_generation.as_str()),
                        D1Type::Text(now_ms.as_str()),
                    ]
                    .iter(),
                )?;
            let supersede_guard = self.command_cas_count_guard_statement(1)?;
            let insert_guard = self.command_cas_count_guard_statement(1)?;
            self.session
                .batch(vec![supersede, supersede_guard, insert, insert_guard])
                .await?
        } else {
            let insert_guard = self.command_cas_count_guard_statement(1)?;
            self.session.batch(vec![insert, insert_guard]).await?
        };
        if results.iter().all(worker::D1Result::success) {
            let stored = self
                .load_restore_import_key_by_replay(replay_key_digest)
                .await?
                .ok_or_else(|| {
                    store_error("tenant-root restore import key row disappeared after issue")
                })?;
            if !stored.binding.matches_authorized_scope(&persisted.binding) {
                return Err(store_error(
                    "tenant-root restore import key row conflicts with its command",
                ));
            }
            return Ok(CloudflareTenantRootRestoreImportKeyIssueDecisionV1::Issued(
                stored,
            ));
        }
        if let Some(existing) = self
            .load_restore_import_key_by_replay(replay_key_digest)
            .await?
        {
            if !existing
                .binding
                .matches_authorized_scope(&persisted.binding)
            {
                return Err(store_error(
                    "tenant-root restore import key replay conflicts after concurrent issue",
                ));
            }
            return Ok(CloudflareTenantRootRestoreImportKeyIssueDecisionV1::Replay(
                existing,
            ));
        }
        Err(store_error(
            "tenant-root restore import key issue changed concurrently",
        ))
    }

    /// Atomically stages one decrypted recovery share and marks the issued key
    /// installed. The tombstone predicate makes session close and acceptance
    /// serialize on the same primary D1 session.
    pub(crate) async fn persist_restore_import_key_accept(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
        envelope_digest: [u8; 32],
        encrypted_imported_share_json: String,
        receipt_digest: [u8; 32],
        accepted_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootRestoreImportKeyAcceptDecisionV1> {
        record.validate()?;
        self.cipher.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued {
            return Err(store_error(
                "tenant-root restore import acceptance requires an issued key",
            ));
        }
        require_nonzero_bytes(
            "tenant-root restore imported share envelope digest",
            &envelope_digest,
        )?;
        require_nonzero_bytes(
            "tenant-root restore imported share receipt digest",
            &receipt_digest,
        )?;
        require_timestamp(
            "tenant-root restore imported share acceptance timestamp",
            accepted_at_ms,
        )?;
        if accepted_at_ms < record.binding.issued_at_ms
            || accepted_at_ms >= record.binding.expires_at_ms
        {
            return Err(store_error(
                "tenant-root restore import key is outside its acceptance window",
            ));
        }
        if encrypted_imported_share_json.is_empty()
            || encrypted_imported_share_json.len() > 8 * 1024
        {
            return Err(store_error(
                "tenant-root restore imported share ciphertext JSON is invalid",
            ));
        }
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let generation = record.binding.generation.to_string();
        let import_key_id = record.binding.import_key_id.as_str();
        let replay_key_digest_hex = encode_hex(&record.binding.replay_key_digest);
        let command_digest_hex = encode_hex(&record.binding.command_digest);
        let operation_digest_hex = encode_hex(&record.binding.operation_digest);
        let envelope_digest_hex = encode_hex(&envelope_digest);
        let receipt_digest_hex = encode_hex(&receipt_digest);
        let accepted_at_ms = timestamp_i64(accepted_at_ms)?.to_string();
        let statement = self
            .session
            .prepare(ACCEPT_RESTORE_IMPORT_KEY_SQL)
            .bind_refs(
                [
                    D1Type::Text(envelope_digest_hex.as_str()),
                    D1Type::Text(encrypted_imported_share_json.as_str()),
                    D1Type::Text(accepted_at_ms.as_str()),
                    D1Type::Text(receipt_digest_hex.as_str()),
                    D1Type::Text(accepted_at_ms.as_str()),
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                    D1Type::Text(record.binding.role.as_str()),
                    D1Type::Text(generation.as_str()),
                    D1Type::Text(import_key_id),
                    D1Type::Text(replay_key_digest_hex.as_str()),
                    D1Type::Text(command_digest_hex.as_str()),
                    D1Type::Text(operation_digest_hex.as_str()),
                ]
                .iter(),
            )?;
        let guard = self.command_cas_count_guard_statement(1)?;
        let results = self.session.batch(vec![statement, guard]).await?;
        if results.len() != 2 || results.iter().any(|result| !result.success()) {
            return Err(store_error(
                "tenant-root restore imported share acceptance failed",
            ));
        }
        let changes = result_changes(&results[0])?;
        if changes == 1 {
            require_changes(
                &results[1],
                0,
                "tenant-root restore imported share acceptance count guard returned an invalid change count",
            )?;
            let stored = self
                .load_restore_import_key_by_replay(record.binding.replay_key_digest)
                .await?
                .ok_or_else(|| {
                    store_error(
                        "tenant-root restore imported share row disappeared after acceptance",
                    )
                })?;
            if stored.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed
                || stored.envelope_digest != Some(envelope_digest)
                || stored.receipt_digest != Some(receipt_digest)
            {
                return Err(store_error(
                    "tenant-root restore imported share acceptance row is inconsistent",
                ));
            }
            self.validate_restore_imported_share(&stored)?;
            return Ok(CloudflareTenantRootRestoreImportKeyAcceptDecisionV1::Accepted(stored));
        }
        if changes != 0 {
            return Err(store_error(
                "tenant-root restore imported share acceptance returned an invalid change count",
            ));
        }
        let stored = self
            .load_restore_import_key_by_replay(record.binding.replay_key_digest)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore imported share row disappeared after concurrent acceptance")
            })?;
        if !stored.binding.matches_authorized_scope(&record.binding) {
            return Err(store_error(
                "tenant-root restore imported share acceptance conflicts with its signed binding",
            ));
        }
        if stored.lifecycle == CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed
            && stored.envelope_digest == Some(envelope_digest)
            && stored.receipt_digest == Some(receipt_digest)
        {
            self.validate_restore_imported_share(&stored)?;
            return Ok(CloudflareTenantRootRestoreImportKeyAcceptDecisionV1::Replay(stored));
        }
        Err(store_error(
            "tenant-root restore imported share acceptance conflicts with its durable state",
        ))
    }

    pub(crate) async fn close_restore_before_activation(
        &self,
        grant: &router_ab_core::VerifiedTenantRootRestoreCleanupGrantV1,
        closed_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootRestoreSessionCleanupReceiptV1> {
        let identity = grant.destination_identity_digest();
        let lineage = grant.destination_lineage();
        let session = grant.restore_session_id();
        let identity_hex = encode_hex(identity.as_bytes());
        let lineage_b64u = lineage.to_base64url();
        let session_hex = encode_hex(session.as_bytes());
        let grant_b64u = encode_base64url_bytes_v1(grant.canonical_bytes());
        let grant_digest =
            TenantRootLifecycleReceiptDigestV1::from_bytes(*grant.digest().as_bytes())
                .map_err(|error| store_error(error.message()))?;
        let receipt = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
            identity,
            lineage,
            session,
            self.cipher.role,
            grant.operation(),
            grant_digest,
            closed_at_ms,
        )?;
        let receipt_b64u = encode_base64url_bytes_v1(receipt.bytes());
        let receipt_digest_hex = encode_hex(receipt.digest().as_bytes());
        let closed_text = timestamp_i64(closed_at_ms)?.to_string();
        let fingerprint_hex = encode_hex(grant.destination_fingerprint().as_bytes());
        // Admission races promotion in the same D1 database. Once promotion starts,
        // only activation-receipt cleanup may close the session.
        self.session.prepare("INSERT INTO tenant_root_restore_import_sessions \
            (tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, \
             closed_at_ms, role, cleanup_grant_b64u, cleanup_receipt_b64u, cleanup_receipt_digest_hex) \
            SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 \
            WHERE NOT EXISTS (SELECT 1 FROM tenant_root_restore_refresh_attempts \
              WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
                AND restore_session_id_hex = ?3 AND promotion_lifecycle <> 'unstarted') \
            AND NOT EXISTS (SELECT 1 FROM tenant_root_restore_import_keys \
              WHERE tenant_identity_digest_hex = ?1 AND custody_lineage_b64u = ?2 \
                AND restore_session_id_hex = ?3 AND destination_fingerprint_hex <> ?9) \
            ON CONFLICT DO NOTHING")
            .bind_refs([
                D1Type::Text(&identity_hex), D1Type::Text(&lineage_b64u), D1Type::Text(&session_hex),
                D1Type::Text(&closed_text), D1Type::Text(self.cipher.role.as_str()),
                D1Type::Text(&grant_b64u), D1Type::Text(&receipt_b64u),
                D1Type::Text(&receipt_digest_hex), D1Type::Text(&fingerprint_hex),
            ].iter())?.run().await?;
        #[derive(Deserialize)]
        struct Closure {
            cleanup_grant_b64u: String,
            closed_at_ms: i64,
        }
        let closure = self
            .session
            .prepare(
                "SELECT cleanup_grant_b64u, closed_at_ms \
            FROM tenant_root_restore_import_sessions WHERE tenant_identity_digest_hex = ?1 \
            AND custody_lineage_b64u = ?2 AND restore_session_id_hex = ?3 \
            AND cleanup_grant_b64u IS NOT NULL",
            )
            .bind_refs(
                [
                    D1Type::Text(&identity_hex),
                    D1Type::Text(&lineage_b64u),
                    D1Type::Text(&session_hex),
                ]
                .iter(),
            )?
            .first::<Closure>(None)
            .await?
            .ok_or_else(|| {
                store_error("preactivation cleanup conflicts with promotion or destination scope")
            })?;
        let stored_bytes =
            decode_base64url_bytes_v1("restore cleanup grant", &closure.cleanup_grant_b64u)
                .map_err(|error| store_error(error.message()))?;
        let stored =
            router_ab_core::TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&stored_bytes)
                .map_err(|error| store_error(error.message()))?;
        if stored.destination_identity_digest() != identity
            || stored.destination_lineage() != lineage
            || stored.restore_session_id() != session
            || stored.destination_fingerprint() != grant.destination_fingerprint()
        {
            return Err(store_error(
                "preactivation cleanup replay changed destination scope",
            ));
        }
        let closed_at_ms = u64::try_from(closure.closed_at_ms)
            .map_err(|_| store_error("invalid cleanup closure timestamp"))?;
        self.close_restore_import_session_secrets(identity, lineage, session, closed_at_ms)
            .await?;
        let stored_digest =
            TenantRootLifecycleReceiptDigestV1::from_bytes(Sha256::digest(&stored_bytes).into())
                .map_err(|error| store_error(error.message()))?;
        CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
            identity,
            lineage,
            session,
            self.cipher.role,
            stored.operation(),
            stored_digest,
            closed_at_ms,
        )
    }

    /// Records a closed restore session before deleting its encrypted keys.
    /// The tombstone remains after the key rows lose their ciphertext.
    pub(crate) async fn close_restore_import_session(
        &self,
        activation: &VerifiedTenantRootSignedActivationReceiptV1,
        role: TwoPartyDeriverRole,
        closed_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootRestoreSessionCleanupReceiptV1> {
        let expected_role = match role {
            TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
            TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
        };
        if expected_role != self.cipher.role {
            return Err(store_error(
                "tenant-root restore-session cleanup belongs to the other Deriver",
            ));
        }
        let candidate = CloudflareTenantRootRestoreImportSessionTombstoneV1::from_activation(
            activation,
            expected_role,
            closed_at_ms,
        )?;
        if closed_at_ms < activation.activated_at_ms() {
            return Err(store_error(
                "tenant-root restore-session cleanup predates activation",
            ));
        }
        let active = self
            .load_epoch_by_identity_digest(
                candidate.identity_digest,
                candidate.custody_lineage,
                TenantRootShareEpoch::INITIAL,
            )
            .await?
            .ok_or_else(|| {
                store_error("tenant-root restore-session cleanup requires durable activation")
            })?;
        if active.record().role() != expected_role
            || !matches!(
                active.record().lifecycle(),
                CloudflareTenantRootRoleShareLifecycleV1::Active(_)
                    | CloudflareTenantRootRoleShareLifecycleV1::Retired(_)
            )
            || active.retained_activation_receipt_bytes()? != candidate.activation_receipt_bytes
        {
            return Err(store_error(
                "tenant-root restore-session cleanup activation does not match the active role share",
            ));
        }
        if let Some(existing) = self
            .load_restore_import_session_tombstone(
                candidate.identity_digest,
                candidate.custody_lineage,
                candidate.restore_session_id,
            )
            .await?
        {
            if !existing.matches(&candidate) {
                return Err(store_error(
                    "tenant-root restore-session cleanup conflicts with its tombstone",
                ));
            }
            self.close_restore_import_session_secrets(
                candidate.identity_digest,
                candidate.custody_lineage,
                candidate.restore_session_id,
                existing.closed_at_ms,
            )
            .await?;
            return Ok(existing.cleanup_receipt().clone());
        }
        let identity_digest_hex = encode_hex(candidate.identity_digest.as_bytes());
        let custody_lineage_b64u = candidate.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(candidate.restore_session_id.as_bytes());
        let closed_at_ms_text = timestamp_i64(candidate.closed_at_ms)?.to_string();
        let activation_receipt_b64u =
            encode_base64url_bytes_v1(&candidate.activation_receipt_bytes);
        let activation_receipt_digest_hex =
            encode_hex(candidate.activation_receipt_digest.as_bytes());
        let cleanup_receipt_b64u = encode_base64url_bytes_v1(candidate.cleanup_receipt.bytes());
        let cleanup_receipt_digest_hex = encode_hex(candidate.cleanup_receipt.digest().as_bytes());
        let insert = self
            .session
            .prepare(INSERT_RESTORE_IMPORT_SESSION_TOMBSTONE_SQL)
            .bind_refs(
                [
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                    D1Type::Text(closed_at_ms_text.as_str()),
                    D1Type::Text(expected_role.as_str()),
                    D1Type::Text(candidate.activation_operation.as_str()),
                    D1Type::Text(activation_receipt_b64u.as_str()),
                    D1Type::Text(activation_receipt_digest_hex.as_str()),
                    D1Type::Text(cleanup_receipt_b64u.as_str()),
                    D1Type::Text(cleanup_receipt_digest_hex.as_str()),
                ]
                .iter(),
            )?;
        let insert_result = insert.run().await?;
        let inserted = result_changes(&insert_result)?;
        if inserted > 1 {
            return Err(store_error(
                "tenant-root restore-session tombstone inserted an invalid change count",
            ));
        }
        if inserted == 0 {
            let existing = self
                .load_restore_import_session_tombstone(
                    candidate.identity_digest,
                    candidate.custody_lineage,
                    candidate.restore_session_id,
                )
                .await?
                .ok_or_else(|| {
                    store_error("tenant-root restore-session tombstone disappeared after insert")
                })?;
            if !existing.matches(&candidate) {
                return Err(store_error(
                    "tenant-root restore-session cleanup conflicts with its tombstone",
                ));
            }
            self.close_restore_import_session_secrets(
                candidate.identity_digest,
                candidate.custody_lineage,
                candidate.restore_session_id,
                existing.closed_at_ms,
            )
            .await?;
            return Ok(existing.cleanup_receipt().clone());
        }
        self.close_restore_import_session_secrets(
            candidate.identity_digest,
            candidate.custody_lineage,
            candidate.restore_session_id,
            candidate.closed_at_ms,
        )
        .await?;
        Ok(candidate.cleanup_receipt().clone())
    }

    async fn close_restore_import_session_secrets(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        restore_session_id: TenantRootRestoreSessionIdV1,
        closed_at_ms: u64,
    ) -> worker::Result<()> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(restore_session_id.as_bytes());
        let role = self.cipher.role.as_str();
        let closed_at_ms = timestamp_i64(closed_at_ms)?.to_string();
        let close = self
            .session
            .prepare(CLOSE_RESTORE_IMPORT_KEYS_SQL)
            .bind_refs(
                [
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                    D1Type::Text(closed_at_ms.as_str()),
                    D1Type::Text(role),
                ]
                .iter(),
            )?;
        let close_refresh_attempts = self
            .session
            .prepare(CLOSE_RESTORE_REFRESH_ATTEMPTS_SQL)
            .bind_refs(
                [
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(restore_session_id_hex.as_str()),
                    D1Type::Text(closed_at_ms.as_str()),
                    D1Type::Text(role),
                ]
                .iter(),
            )?;
        let results = self
            .session
            .batch(vec![close, close_refresh_attempts])
            .await?;
        if results.len() != 2 || results.iter().any(|result| !result.success()) {
            return Err(store_error(
                "tenant-root restore import session close failed",
            ));
        }
        Ok(())
    }

    fn open_restore_import_key_row(
        &self,
        row: TenantRootRestoreImportKeyD1RowV1,
    ) -> worker::Result<CloudflareTenantRootRestoreImportKeyRecordV1> {
        restore_import_key_record_from_row(row, self.cipher.role)
    }

    fn validate_restore_import_key_ciphertext(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> worker::Result<()> {
        let envelope: TenantRootRestoreImportKeyCiphertextV1 =
            serde_json::from_str(record.encrypted_ikm_json()?).map_err(|error| {
                store_error(format!(
                    "tenant-root restore import key ciphertext decoding failed: {error}"
                ))
            })?;
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let public_key_b64u =
            encode_base64url_bytes_v1(record.binding.import_public_key.as_bytes());
        if envelope.tenant_identity_digest_hex != identity_digest_hex
            || envelope.key_version != self.cipher.key_version
            || envelope.custody_lineage_b64u != custody_lineage_b64u
            || envelope.restore_session_id_hex != restore_session_id_hex
            || envelope.role != record.binding.role
            || envelope.generation != record.binding.generation
            || envelope.import_key_id != record.binding.import_key_id
            || envelope.public_key_b64u != public_key_b64u
            || envelope.issued_at_ms != record.binding.issued_at_ms
            || envelope.expires_at_ms != record.binding.expires_at_ms
            || envelope.lifecycle != record.lifecycle.as_str()
            || envelope.ciphertext_b64u.is_empty()
        {
            return Err(store_error(
                "tenant-root restore import key ciphertext metadata does not match its row",
            ));
        }
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore import key ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len() <= CloudflareHpkeKemV1::ENCAPPED_KEY_LEN
            || payload.len() > MAX_RESTORE_IMPORT_KEY_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore import key ciphertext is malformed",
            ));
        }
        Ok(())
    }

    /// Reserves one exact pending-row insertion command.
    async fn reserve_insert_pending(
        &self,
        scope: TenantRootCommandScopeV1,
        record: CloudflareTenantRootRoleShareRecordV1,
        reserved_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootInsertPendingDecisionV1> {
        let operation_payload_digest = insert_pending_payload_digest(&record, 1)?;
        self.reserve_insert_pending_with_payload_digest(
            scope,
            record,
            reserved_at_ms,
            operation_payload_digest,
            None,
        )
        .await
    }

    async fn reserve_insert_pending_with_payload_digest(
        &self,
        scope: TenantRootCommandScopeV1,
        record: CloudflareTenantRootRoleShareRecordV1,
        reserved_at_ms: u64,
        operation_payload_digest: TenantRootProtocolDigestV1,
        admission: Option<TenantRootCommandAdmissionV1>,
    ) -> worker::Result<CloudflareTenantRootInsertPendingDecisionV1> {
        record.validate()?;
        self.cipher.require_role(record.role)?;
        if !matches!(
            record.lifecycle,
            CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
        ) {
            return Err(store_error(
                "tenant-root role-private insertion requires a pending record",
            ));
        }
        let expected_revision = 1;
        validate_command_scope_for_record(
            &scope,
            &record,
            expected_revision,
            "tenant-root pending insertion",
        )?;
        let operation = TenantRootCommandOperationV1::insert_pending(operation_payload_digest);
        match self
            .reserve_scoped_command_with_admission_digest(
                scope,
                operation,
                reserved_at_ms,
                admission,
            )
            .await?
        {
            CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => {
                Ok(CloudflareTenantRootInsertPendingDecisionV1::Execute {
                    command: CloudflareTenantRootInsertPendingCommandV1 {
                        scope,
                        reservation,
                        record,
                        expected_revision,
                        operation_payload_digest,
                    },
                })
            }
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootInsertPendingDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootInsertPendingDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootInsertPendingCommandV1 {
                        scope,
                        reservation,
                        record,
                        expected_revision,
                        operation_payload_digest,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => {
                Ok(CloudflareTenantRootInsertPendingDecisionV1::ResumeCompletion { executed })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => {
                Ok(CloudflareTenantRootInsertPendingDecisionV1::ReplayCompleted { receipt_bytes })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(CloudflareTenantRootInsertPendingDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            }),
        }
    }

    /// Loads the only sealed role artifact allowed as a managed-restore
    /// forward-refresh source. The source row must remain pending and retain
    /// all three receipt digests supplied by the verified restore flow.
    pub(crate) async fn load_managed_restore_forward_refresh_source(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        current_epoch: TenantRootShareEpoch,
        capability_digest: TenantRootLifecycleReceiptDigestV1,
        backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    ) -> worker::Result<CloudflareTenantRootManagedRestoreForwardRefreshSourceV1> {
        let stored = self
            .load_epoch_by_identity_digest(identity_digest, custody_lineage, current_epoch)
            .await?
            .ok_or_else(|| {
                store_error(
                    "tenant-root managed-restore forward-refresh source pending row does not exist",
                )
            })?;
        validate_managed_restore_forward_refresh_source(
            &self.cipher,
            &stored,
            identity_digest,
            custody_lineage,
            current_epoch,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
        )?;
        let sealed_online_role_share = stored
            .record
            .into_online_role_share_artifact_with_installation_evidence_digest(
                installation_receipt_digest,
            )?;
        Ok(CloudflareTenantRootManagedRestoreForwardRefreshSourceV1 {
            sealed_online_role_share,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
        })
    }

    /// Reads the provenance that was authenticated when managed restore was staged.
    ///
    /// The returned digests are copied from the authenticated pending record;
    /// no caller-provided provenance can replace them at the activation boundary.
    pub(crate) fn managed_restore_forward_refresh_provenance(
        &self,
        stored: &CloudflareStoredTenantRootRoleShareV1,
    ) -> worker::Result<CloudflareTenantRootManagedRestoreForwardRefreshProvenanceV1> {
        validate_pending_stored_record(&self.cipher, stored)?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = &stored.record.lifecycle
        else {
            unreachable!("pending lifecycle was checked by validate_pending_stored_record");
        };
        let Some((capability_digest, backup_receipt_digest)) = pending.managed_restore_digests()
        else {
            return Err(store_error(
                "tenant-root forward-refresh provenance requires managed-restore material",
            ));
        };
        Ok(
            CloudflareTenantRootManagedRestoreForwardRefreshProvenanceV1 {
                capability_digest,
                backup_receipt_digest,
                installation_receipt_digest: pending.installation_evidence_digest(),
            },
        )
    }

    /// Reserves one role-local managed-restore staging insertion.
    ///
    /// The capability is fresh only for a first-seen replay key. Exact retries
    /// reconcile through the durable command row, including after capability
    /// expiry, while the row itself remains pending for forward refresh.
    pub(crate) async fn reserve_managed_restore_staging(
        &self,
        staging: CloudflareTenantRootManagedRestoreStagingInputV1,
        reserved_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootManagedRestoreStagingDecisionV1> {
        let CloudflareTenantRootManagedRestoreStagingInputV1 {
            capability,
            scope,
            record,
        } = staging;
        let capability_digest = capability.capability_digest();
        validate_managed_restore_staging_record(&record, capability_digest)?;
        validate_command_scope_for_record(
            &scope,
            &record,
            1,
            "tenant-root managed-restore staging",
        )?;
        let replay_exists = self.load_command_replay(scope.key()).await?.is_some();
        if !replay_exists {
            capability
                .require_fresh(reserved_at_ms)
                .map_err(|error| store_error(error.message()))?;
        }
        let operation_payload_digest = insert_pending_payload_digest(&record, 1)?;
        match self
            .reserve_insert_pending_with_payload_digest(
                scope,
                record,
                reserved_at_ms,
                operation_payload_digest,
                None,
            )
            .await?
        {
            CloudflareTenantRootInsertPendingDecisionV1::Execute { command } => Ok(
                CloudflareTenantRootManagedRestoreStagingDecisionV1::Execute {
                    command: CloudflareTenantRootManagedRestoreStagingPendingCommandV1 { command },
                },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::InProgress => {
                Ok(CloudflareTenantRootManagedRestoreStagingDecisionV1::InProgress)
            }
            CloudflareTenantRootInsertPendingDecisionV1::ResumeExecution { command } => Ok(
                CloudflareTenantRootManagedRestoreStagingDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootManagedRestoreStagingPendingCommandV1 { command },
                },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ResumeCompletion { executed } => Ok(
                CloudflareTenantRootManagedRestoreStagingDecisionV1::ResumeCompletion { executed },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootManagedRestoreStagingDecisionV1::ReplayCompleted {
                    receipt_bytes,
                },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootManagedRestoreStagingDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
        }
    }

    /// Durably admits one verified refresh before any randomness or provider
    /// material is produced. The replay row stores the exact issuer command
    /// bytes so a later worker can distinguish regeneration from resumption.
    ///
    /// This lookup must run before resolving the active row. A refresh retry
    /// can arrive after the lifecycle swap retired that row, while its replay
    /// record still authoritatively owns the exact command.
    pub(crate) async fn preflight_refresh_replay(
        &self,
        raw_command: &TenantRootRoleRefreshCommandV1,
    ) -> worker::Result<Option<CloudflareTenantRootRefreshAdmissionDecisionV1>> {
        let key = TenantRootCommandReplayKeyV1::new(
            raw_command.identity_digest(),
            raw_command.custody_lineage(),
            raw_command.session_id(),
            raw_command.nonce(),
            raw_command.role(),
        );
        self.require_command_role(&key)?;
        let command_bytes = raw_command
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?;
        let command_digest = raw_command
            .digest()
            .map_err(|error| store_error(error.message()))?;
        let Some(stored) = self.load_command_replay(&key).await? else {
            return Ok(None);
        };
        Self::reconcile_refresh_admission(&stored, key, command_digest, &command_bytes).map(Some)
    }

    /// Durably admits one verified refresh before any randomness or provider
    /// material is produced. The replay row stores the exact issuer command
    /// bytes so a later worker can distinguish regeneration from resumption.
    // The insert-only admission chooses one encrypted seed before either contender publishes.
    fn seal_refresh_seed(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
    ) -> worker::Result<String> {
        let mut seed = zeroize::Zeroizing::new([0_u8; 32]);
        rand_core::RngCore::fill_bytes(&mut CloudflareHpkeGetrandomRngV1, seed.as_mut());
        let (encapped, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut CloudflareHpkeGetrandomRngV1,
            &self.cipher.public_key,
            b"seams/tenant-root/refresh-replay-seed/chacha20/v1",
            command.canonical_bytes(),
            seed.as_ref(),
        )
        .map_err(|_| store_error("refresh replay seed encryption failed"))?;
        let mut bytes = encapped.as_ref().to_vec();
        bytes.extend_from_slice(&ciphertext);
        Ok(encode_base64url_bytes_v1(&bytes))
    }

    pub(crate) fn open_refresh_seed(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        state: &CloudflareTenantRootRefreshDurableStateV1,
    ) -> worker::Result<zeroize::Zeroizing<[u8; 32]>> {
        state.validate()?;
        if state.command_bytes()? != command.canonical_bytes() {
            return Err(store_error("refresh replay seed command mismatch"));
        }
        let CloudflareTenantRootRefreshDurableStateV1::Admitted {
            encrypted_seed_b64u,
            ..
        } = state
        else {
            return Err(store_error("refresh replay seed requires admitted state"));
        };
        let bytes = decode_base64url_bytes_v1("refresh replay seed", encrypted_seed_b64u)
            .map_err(|error| store_error(error.message()))?;
        let (encapped, ciphertext) = bytes.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped = CloudflareHpkeKemV1::enc_from_bytes(encapped)
            .map_err(|_| store_error("refresh replay seed encapsulation invalid"))?;
        let plaintext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped,
                &self.cipher.private_key,
                b"seams/tenant-root/refresh-replay-seed/chacha20/v1",
                command.canonical_bytes(),
                ciphertext,
            )
            .map_err(|_| store_error("refresh replay seed authentication failed"))?,
        );
        let mut seed = zeroize::Zeroizing::new([0_u8; 32]);
        if plaintext.len() != seed.len() {
            return Err(store_error("refresh replay seed length invalid"));
        }
        seed.copy_from_slice(&plaintext);
        Ok(seed)
    }

    pub(crate) async fn admit_refresh(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        now_ms: u64,
    ) -> worker::Result<CloudflareTenantRootRefreshAdmissionDecisionV1> {
        let scope = command.scope();
        let key = *scope.key();
        self.require_command_role(&key)?;
        let command_digest = command.digest();
        let command_bytes = command.canonical_bytes();
        if let Some(stored) = self.load_command_replay(&key).await? {
            return Self::reconcile_refresh_admission(&stored, key, command_digest, command_bytes);
        }
        command
            .require_fresh(now_ms)
            .map_err(|error| store_error(error.message()))?;
        let operation_digest = refresh_admission_operation_digest(&scope, command_digest)?;
        let state = CloudflareTenantRootRefreshDurableStateV1::admitted(
            command,
            self.seal_refresh_seed(command)?,
        )?;
        let (state_b64u, state_digest_hex) = state.encode()?;
        let replay_key_digest_hex = encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(key.identity_digest().as_bytes());
        let custody_lineage_b64u = key.custody_lineage().to_base64url();
        let session_id_hex = encode_hex(key.session_id().as_bytes());
        let nonce_hex = encode_hex(key.nonce().as_bytes());
        let role = self.cipher.role.as_str();
        let operation_digest_hex = encode_hex(operation_digest.as_bytes());
        let admission_digest_hex = encode_hex(command_digest.as_bytes());
        let reserved_at_ms_text = timestamp_i64(now_ms)?.to_string();
        let result = self
            .session
            .prepare(INSERT_REFRESH_ADMISSION_SQL)
            .bind_refs(
                [
                    D1Type::Text(replay_key_digest_hex.as_str()),
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(session_id_hex.as_str()),
                    D1Type::Text(nonce_hex.as_str()),
                    D1Type::Text(role),
                    D1Type::Text(operation_digest_hex.as_str()),
                    D1Type::Text(admission_digest_hex.as_str()),
                    D1Type::Text(reserved_at_ms_text.as_str()),
                    D1Type::Text(state_b64u.as_str()),
                    D1Type::Text(state_digest_hex.as_str()),
                ]
                .iter(),
            )?
            .run()
            .await?;
        match result_changes(&result)? {
            1 => Ok(CloudflareTenantRootRefreshAdmissionDecisionV1::Execute {
                durable_state: state,
                admission: CloudflareTenantRootRefreshAdmissionV1 {
                    key,
                    command_digest,
                    reserved_at_ms: now_ms,
                },
            }),
            0 => {
                let stored = self.load_command_replay(&key).await?.ok_or_else(|| {
                    store_error(
                        "tenant-root refresh admission conflict disappeared before reconciliation",
                    )
                })?;
                Self::reconcile_refresh_admission(&stored, key, command_digest, command_bytes)
            }
            _ => Err(store_error(
                "tenant-root refresh admission returned an invalid change count",
            )),
        }
    }

    fn reconcile_refresh_admission(
        stored: &StoredTenantRootCommandReplayV1,
        key: TenantRootCommandReplayKeyV1,
        command_digest: TenantRootProtocolDigestV1,
        command_bytes: &[u8],
    ) -> worker::Result<CloudflareTenantRootRefreshAdmissionDecisionV1> {
        if stored.record.key() != &key || stored.admission_digest != Some(command_digest) {
            return Err(store_error(
                "tenant-root refresh session was reused with different issuer-authorized bytes",
            ));
        }
        let admission = CloudflareTenantRootRefreshAdmissionV1 {
            key,
            command_digest,
            reserved_at_ms: stored.reserved_at_ms,
        };
        match &stored.record {
            TenantRootCommandReplayRecordV1::Reserved(_) => {
                let durable_state = refresh_replay_state_for_command(stored, command_bytes)?;
                Ok(
                    CloudflareTenantRootRefreshAdmissionDecisionV1::ResumeExecution {
                        admission,
                        durable_state,
                    },
                )
            }
            TenantRootCommandReplayRecordV1::Executed(_) => {
                let durable_state = refresh_replay_state_for_command(stored, command_bytes)?;
                Ok(
                    CloudflareTenantRootRefreshAdmissionDecisionV1::ResumeCompletion {
                        admission,
                        durable_state,
                    },
                )
            }
            TenantRootCommandReplayRecordV1::Completed(_) => {
                let durable_state = refresh_replay_state_for_command(stored, command_bytes)?;
                Ok(
                    CloudflareTenantRootRefreshAdmissionDecisionV1::ReplayCompleted {
                        receipt_bytes: stored.receipt_bytes.clone().ok_or_else(|| {
                            store_error("completed tenant-root refresh omitted prior receipt bytes")
                        })?,
                        durable_state,
                    },
                )
            }
            TenantRootCommandReplayRecordV1::Failed(_) => {
                if stored.refresh_state.is_some() {
                    return Err(store_error(
                        "failed tenant-root refresh replay row has durable refresh state",
                    ));
                }
                Ok(
                    CloudflareTenantRootRefreshAdmissionDecisionV1::ReplayFailed {
                        failure_receipt_bytes: stored.receipt_bytes.clone().ok_or_else(|| {
                            store_error("failed tenant-root refresh omitted prior receipt bytes")
                        })?,
                    },
                )
            }
        }
    }

    /// Persists the generated sealed role-share record and checkpoints the
    /// replay row in one D1 batch. The replay command digest is replaced with
    /// the exact role-private operation digest only in this atomic step.
    pub(crate) async fn persist_refresh_pending(
        &self,
        admission: CloudflareTenantRootRefreshAdmissionV1,
        refresh: CloudflareTenantRootRefreshInputV1,
        prepared_artifacts: CloudflareTenantRootRefreshPreparedArtifactsV1,
        executed_at_ms: u64,
    ) -> worker::Result<(
        CloudflareStoredTenantRootRoleShareV1,
        CloudflareTenantRootRefreshExecutedCommandV1,
    )> {
        let CloudflareTenantRootRefreshInputV1 {
            command,
            evidence,
            record,
        } = refresh;
        prepared_artifacts.validate()?;
        let scope = command.scope();
        if scope.key() != admission.key()
            || command.digest() != admission.command_digest()
            || scope.key().role() != protocol_role_for_cloudflare(self.cipher.role)
        {
            return Err(store_error(
                "tenant-root refresh admission does not match its verified command",
            ));
        }
        if executed_at_ms < admission.reserved_at_ms() {
            return Err(store_error(
                "tenant-root refresh execution checkpoint precedes its admission",
            ));
        }
        require_timestamp("tenant-root refresh execution checkpoint", executed_at_ms)?;
        validate_refresh_command_evidence(&command, &evidence)?;
        validate_refresh_record_binding(&command, &evidence, &record)?;
        validate_refresh_replay_link(&record, admission.key())?;
        validate_command_scope_for_record(
            &scope,
            &record,
            1,
            "tenant-root refresh pending insertion",
        )?;
        record.validate()?;
        self.cipher.require_role(record.role)?;
        let operation_payload_digest = refresh_insert_pending_payload_digest(&command, &record, 1)?;
        let operation_digest = scope
            .command_digest(TenantRootCommandOperationV1::insert_pending(
                operation_payload_digest,
            ))
            .map_err(|error| store_error(error.message()))?;
        let stored_replay = self
            .load_command_replay(admission.key())
            .await?
            .ok_or_else(|| store_error("tenant-root refresh admission row does not exist"))?;
        if stored_replay.admission_digest != Some(admission.command_digest())
            || stored_replay.reserved_at_ms != admission.reserved_at_ms()
        {
            return Err(store_error(
                "tenant-root refresh admission row does not match its token",
            ));
        }
        let old_state = stored_replay.refresh_state.clone().ok_or_else(|| {
            store_error("tenant-root refresh admission row omitted durable state")
        })?;
        if !matches!(
            stored_replay.record,
            TenantRootCommandReplayRecordV1::Reserved(_)
        ) || !matches!(
            old_state,
            CloudflareTenantRootRefreshDurableStateV1::Admitted { .. }
        ) {
            return Err(store_error(
                "tenant-root refresh pending insertion requires a reserved admission",
            ));
        }
        let expected_admission_digest =
            refresh_admission_operation_digest(&scope, admission.command_digest())?;
        if stored_replay.record.command_digest() != expected_admission_digest {
            return Err(store_error(
                "tenant-root refresh admission row has an unexpected operation digest",
            ));
        }
        if old_state.command_bytes()? != command.canonical_bytes() {
            return Err(store_error(
                "tenant-root refresh admission row has different command bytes",
            ));
        }
        let (old_state_b64u, old_state_digest_hex) = old_state.encode()?;
        let next_state = CloudflareTenantRootRefreshDurableStateV1::Executed {
            command_b64u: encode_base64url_bytes_v1(command.canonical_bytes()),
            evidence_b64u: encode_base64url_bytes_v1(evidence.canonical_bytes()),
            prepared_artifacts,
        };
        let (next_state_b64u, next_state_digest_hex) = next_state.encode()?;
        let metadata = record_metadata(&record)?;
        let ciphertext_json = self.cipher.seal(&record, 1)?;
        let epoch = metadata.epoch.to_string();
        let created_at_ms = record.created_at_ms.to_string();
        let updated_at_ms = record.updated_at_ms.to_string();
        let lifecycle_statement = self.session.prepare(INSERT_SQL).bind_refs(
            [
                D1Type::Text(metadata.identity_digest_hex.as_str()),
                D1Type::Text(metadata.custody_lineage_b64u.as_str()),
                D1Type::Text(epoch.as_str()),
                D1Type::Text(metadata.role.as_str()),
                D1Type::Text(metadata.lifecycle.as_str()),
                D1Type::Text(ciphertext_json.as_str()),
                D1Type::Text(created_at_ms.as_str()),
                D1Type::Text(updated_at_ms.as_str()),
            ]
            .iter(),
        )?;
        let replay_key_digest_hex = encode_hex(
            admission
                .key()
                .storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(admission.key().identity_digest().as_bytes());
        let custody_lineage_b64u = admission.key().custody_lineage().to_base64url();
        let session_id_hex = encode_hex(admission.key().session_id().as_bytes());
        let nonce_hex = encode_hex(admission.key().nonce().as_bytes());
        let old_operation_digest_hex = encode_hex(expected_admission_digest.as_bytes());
        let operation_digest_hex = encode_hex(operation_digest.as_bytes());
        let admission_digest_hex = encode_hex(admission.command_digest().as_bytes());
        let reserved_at_ms = timestamp_i64(admission.reserved_at_ms())?.to_string();
        let executed_at_ms_text = timestamp_i64(executed_at_ms)?.to_string();
        let replay_statement = self.session.prepare(MARK_REFRESH_EXECUTED_SQL).bind_refs(
            [
                D1Type::Text(replay_key_digest_hex.as_str()),
                D1Type::Text(identity_digest_hex.as_str()),
                D1Type::Text(custody_lineage_b64u.as_str()),
                D1Type::Text(session_id_hex.as_str()),
                D1Type::Text(nonce_hex.as_str()),
                D1Type::Text(self.cipher.role.as_str()),
                D1Type::Text(operation_digest_hex.as_str()),
                D1Type::Text(executed_at_ms_text.as_str()),
                D1Type::Text(next_state_b64u.as_str()),
                D1Type::Text(next_state_digest_hex.as_str()),
                D1Type::Text(old_operation_digest_hex.as_str()),
                D1Type::Text(admission_digest_hex.as_str()),
                D1Type::Text(reserved_at_ms.as_str()),
                D1Type::Text(old_state_b64u.as_str()),
                D1Type::Text(old_state_digest_hex.as_str()),
            ]
            .iter(),
        )?;
        self.run_refresh_pending_checkpoint(lifecycle_statement, replay_statement)
            .await?;
        let reservation = match reserve_tenant_root_command_v1(
            None,
            *admission.key(),
            operation_digest,
            admission.reserved_at_ms(),
        )
        .map_err(|error| store_error(error.message()))?
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => {
                return Err(store_error(
                    "tenant-root refresh operation could not reconstruct its execution token",
                ));
            }
        };
        let executed = reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))?;
        Ok((
            CloudflareStoredTenantRootRoleShareV1 {
                record,
                revision: 1,
            },
            CloudflareTenantRootRefreshExecutedCommandV1 { executed, evidence },
        ))
    }

    /// Reconstructs the exact executed token after a refresh interruption.
    /// Private operation digests and replay fields remain inside this adapter;
    /// the caller supplies only the verified command, durable state, and the
    /// pending row recovered from D1.
    pub(crate) async fn recover_refresh_executed(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        admission: CloudflareTenantRootRefreshAdmissionV1,
        durable_state: &CloudflareTenantRootRefreshDurableStateV1,
        pending: CloudflareStoredTenantRootRoleShareV1,
        role_verifying_key: &[u8; 32],
    ) -> worker::Result<CloudflareTenantRootRefreshExecutedCommandV1> {
        let scope = command.scope();
        if scope.key() != admission.key()
            || command.digest() != admission.command_digest()
            || scope.key().role() != protocol_role_for_cloudflare(self.cipher.role)
        {
            return Err(store_error(
                "tenant-root refresh recovery command does not match its admission",
            ));
        }
        if !matches!(
            durable_state,
            CloudflareTenantRootRefreshDurableStateV1::Executed { .. }
                | CloudflareTenantRootRefreshDurableStateV1::Artifacts { .. }
        ) {
            return Err(store_error(
                "tenant-root refresh recovery requires an executed durable state",
            ));
        }
        if durable_state.command_bytes()? != command.canonical_bytes() {
            return Err(store_error(
                "tenant-root refresh recovery command bytes do not match admission",
            ));
        }
        let evidence_bytes = durable_state.evidence_bytes()?;
        let evidence =
            TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
                &evidence_bytes,
                role_verifying_key,
            )
            .map_err(|error| store_error(error.message()))?;
        validate_refresh_command_evidence(command, &evidence)?;
        validate_refresh_record_binding(command, &evidence, pending.record())?;
        let operation_payload_digest =
            refresh_insert_pending_payload_digest(command, pending.record(), 1)?;
        let operation_digest = scope
            .command_digest(TenantRootCommandOperationV1::insert_pending(
                operation_payload_digest,
            ))
            .map_err(|error| store_error(error.message()))?;
        let stored = self
            .load_command_replay(admission.key())
            .await?
            .ok_or_else(|| store_error("tenant-root refresh recovery replay row is missing"))?;
        if stored.admission_digest != Some(admission.command_digest())
            || stored.reserved_at_ms != admission.reserved_at_ms()
            || stored.record.command_digest() != operation_digest
            || stored.refresh_state.as_ref() != Some(durable_state)
            || !matches!(stored.record, TenantRootCommandReplayRecordV1::Executed(_))
        {
            return Err(store_error(
                "tenant-root refresh recovery state does not match D1",
            ));
        }
        let executed_at_ms = stored.executed_at_ms.ok_or_else(|| {
            store_error("tenant-root refresh recovery omitted execution timestamp")
        })?;
        let reservation = match reserve_tenant_root_command_v1(
            None,
            *admission.key(),
            operation_digest,
            admission.reserved_at_ms(),
        )
        .map_err(|error| store_error(error.message()))?
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => {
                return Err(store_error(
                    "tenant-root refresh recovery could not reconstruct its reservation",
                ));
            }
        };
        let executed = reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))?;
        Ok(CloudflareTenantRootRefreshExecutedCommandV1 { executed, evidence })
    }

    async fn run_refresh_pending_checkpoint(
        &self,
        lifecycle_statement: worker::D1PreparedStatement,
        replay_statement: worker::D1PreparedStatement,
    ) -> worker::Result<()> {
        let lifecycle_guard = self.command_cas_count_guard_statement(1)?;
        let replay_guard = self.command_cas_count_guard_statement(1)?;
        let results = self
            .session
            .batch(vec![
                lifecycle_statement,
                lifecycle_guard,
                replay_statement,
                replay_guard,
            ])
            .await?;
        if results.len() != 4 {
            return Err(store_error(
                "tenant-root refresh pending checkpoint returned an invalid result count",
            ));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "tenant-root refresh pending checkpoint statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown D1 error".to_owned())
                )));
            }
        }
        require_changes(
            &results[0],
            1,
            "tenant-root refresh pending row changed concurrently",
        )?;
        require_changes(
            &results[1],
            0,
            "tenant-root refresh pending row count guard returned an invalid change count",
        )?;
        require_changes(
            &results[2],
            1,
            "tenant-root refresh replay checkpoint changed concurrently",
        )?;
        require_changes(
            &results[3],
            0,
            "tenant-root refresh replay count guard returned an invalid change count",
        )
    }

    /// Attaches the exact immutable R2 object metadata after both artifacts
    /// have been written. The CAS is fenced by the executed replay state.
    pub(crate) async fn attach_refresh_artifacts(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        executed: &CloudflareTenantRootRefreshExecutedCommandV1,
        artifacts: CloudflareTenantRootRefreshArtifactMetadataV1,
    ) -> worker::Result<()> {
        artifacts.validate()?;
        let scope = command.scope();
        if scope.key() != executed.executed().key()
            || scope.key().role() != protocol_role_for_cloudflare(self.cipher.role)
        {
            return Err(store_error(
                "tenant-root refresh artifact attachment command does not match execution",
            ));
        }
        let stored = self
            .load_command_replay(executed.executed().key())
            .await?
            .ok_or_else(|| store_error("tenant-root refresh execution replay row is missing"))?;
        let stored_state = stored.refresh_state.clone().ok_or_else(|| {
            store_error("tenant-root refresh execution replay row omitted durable state")
        })?;
        let prepared_artifacts = match &stored_state {
            CloudflareTenantRootRefreshDurableStateV1::Executed {
                prepared_artifacts, ..
            } => prepared_artifacts.clone(),
            CloudflareTenantRootRefreshDurableStateV1::Admitted { .. }
            | CloudflareTenantRootRefreshDurableStateV1::Artifacts { .. } => {
                return Err(store_error(
                    "tenant-root refresh artifact attachment requires prepared execution state",
                ));
            }
        };
        let expected_state = CloudflareTenantRootRefreshDurableStateV1::Executed {
            command_b64u: encode_base64url_bytes_v1(command.canonical_bytes()),
            evidence_b64u: encode_base64url_bytes_v1(executed.evidence_bytes()),
            prepared_artifacts: prepared_artifacts.clone(),
        };
        let next_state = CloudflareTenantRootRefreshDurableStateV1::Artifacts {
            command_b64u: encode_base64url_bytes_v1(command.canonical_bytes()),
            evidence_b64u: encode_base64url_bytes_v1(executed.evidence_bytes()),
            prepared_artifacts,
            artifacts,
        };
        let (expected_state_b64u, expected_state_digest_hex) = expected_state.encode()?;
        let (next_state_b64u, next_state_digest_hex) = next_state.encode()?;
        if stored.record.command_digest() != executed.executed().command_digest()
            || stored.admission_digest != Some(command.digest())
            || stored.refresh_state != Some(expected_state.clone())
        {
            return Err(store_error(
                "tenant-root refresh execution state does not match artifact attachment",
            ));
        }
        let key = executed.executed().key();
        let replay_key_digest_hex = encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(key.identity_digest().as_bytes());
        let custody_lineage_b64u = key.custody_lineage().to_base64url();
        let session_id_hex = encode_hex(key.session_id().as_bytes());
        let nonce_hex = encode_hex(key.nonce().as_bytes());
        let command_digest_hex = encode_hex(executed.executed().command_digest().as_bytes());
        let admission_digest_hex = encode_hex(command.digest().as_bytes());
        let reserved_at_ms = timestamp_i64(executed.executed().reserved_at_ms())?.to_string();
        let executed_at_ms = timestamp_i64(executed.executed().executed_at_ms())?.to_string();
        let statement = self
            .session
            .prepare(ATTACH_REFRESH_ARTIFACTS_SQL)
            .bind_refs(
                [
                    D1Type::Text(next_state_b64u.as_str()),
                    D1Type::Text(next_state_digest_hex.as_str()),
                    D1Type::Text(replay_key_digest_hex.as_str()),
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(session_id_hex.as_str()),
                    D1Type::Text(nonce_hex.as_str()),
                    D1Type::Text(self.cipher.role.as_str()),
                    D1Type::Text(command_digest_hex.as_str()),
                    D1Type::Text(admission_digest_hex.as_str()),
                    D1Type::Text(reserved_at_ms.as_str()),
                    D1Type::Text(executed_at_ms.as_str()),
                    D1Type::Text(expected_state_b64u.as_str()),
                    D1Type::Text(expected_state_digest_hex.as_str()),
                ]
                .iter(),
            )?;
        self.run_refresh_state_update(statement, "artifact attachment")
            .await
    }

    /// Terminalizes a refresh only when D1 already contains the exact R2
    /// object digests, generations, and key-generation references.
    pub(crate) async fn complete_refresh_with_artifacts(
        &self,
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        executed: CloudflareTenantRootRefreshExecutedCommandV1,
        artifacts: &CloudflareTenantRootRefreshArtifactMetadataV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> worker::Result<CloudflareTenantRootCommandTerminalCommitV1> {
        artifacts.validate()?;
        if command.scope().key() != executed.executed().key()
            || receipt.key() != executed.executed().key()
            || receipt.command_digest() != executed.executed().command_digest()
        {
            return Err(store_error(
                "tenant-root refresh terminal inputs do not match their command",
            ));
        }
        let evidence_bytes = executed.evidence_bytes().to_vec();
        validate_refresh_success_receipt_payload(&executed.evidence, &receipt)?;
        self.commit_refresh_terminal(
            executed,
            receipt,
            command.canonical_bytes().to_vec(),
            evidence_bytes,
            artifacts.clone(),
        )
        .await
    }

    async fn commit_refresh_terminal(
        &self,
        executed: CloudflareTenantRootRefreshExecutedCommandV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
        command_bytes: Vec<u8>,
        evidence_bytes: Vec<u8>,
        artifacts: CloudflareTenantRootRefreshArtifactMetadataV1,
    ) -> worker::Result<CloudflareTenantRootCommandTerminalCommitV1> {
        let CloudflareTenantRootRefreshExecutedCommandV1 { executed, .. } = executed;
        let key = *executed.key();
        let command_digest = executed.command_digest();
        let stored_before = self
            .load_command_replay(&key)
            .await?
            .ok_or_else(|| store_error("tenant-root refresh terminal replay row is missing"))?;
        let expected_state = stored_before.refresh_state.clone().ok_or_else(|| {
            store_error("tenant-root refresh terminal replay row omitted durable state")
        })?;
        if !matches!(
            &expected_state,
            CloudflareTenantRootRefreshDurableStateV1::Artifacts { .. }
        ) || expected_state.command_bytes()? != command_bytes
            || expected_state.evidence_bytes()? != evidence_bytes
            || expected_state.artifacts()? != &artifacts
            || stored_before.record.command_digest() != command_digest
            || !matches!(
                stored_before.record,
                TenantRootCommandReplayRecordV1::Executed(_)
            )
        {
            return Err(store_error(
                "tenant-root refresh terminal state is not the attached artifact state",
            ));
        }
        let (state_b64u, state_digest_hex) = expected_state.encode()?;
        let receipt_digest = receipt.digest();
        let terminal_at_ms_value = receipt.terminal_at_ms();
        let receipt_bytes = receipt.into_canonical_bytes();
        let receipt_b64u = encode_base64url_bytes_v1(&receipt_bytes);
        let receipt_digest_hex = encode_hex(receipt_digest.as_bytes());
        let terminal_at_ms = timestamp_i64(terminal_at_ms_value)?.to_string();
        let expected_state = decode_refresh_durable_state(&state_b64u, &state_digest_hex)?;
        let replay_key_digest_hex = encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(key.identity_digest().as_bytes());
        let custody_lineage_b64u = key.custody_lineage().to_base64url();
        let session_id_hex = encode_hex(key.session_id().as_bytes());
        let nonce_hex = encode_hex(key.nonce().as_bytes());
        let command_digest_hex = encode_hex(command_digest.as_bytes());
        let admission_digest_hex = encode_hex(
            stored_before
                .admission_digest
                .ok_or_else(|| {
                    store_error("tenant-root refresh terminal admission digest is missing")
                })?
                .as_bytes(),
        );
        let reserved_at_ms = timestamp_i64(executed.reserved_at_ms())?.to_string();
        let executed_at_ms = timestamp_i64(executed.executed_at_ms())?.to_string();
        let statement = self
            .session
            .prepare(COMMIT_REFRESH_TERMINAL_SQL)
            .bind_refs(
                [
                    D1Type::Text(receipt_b64u.as_str()),
                    D1Type::Text(receipt_digest_hex.as_str()),
                    D1Type::Text(terminal_at_ms.as_str()),
                    D1Type::Text(replay_key_digest_hex.as_str()),
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(session_id_hex.as_str()),
                    D1Type::Text(nonce_hex.as_str()),
                    D1Type::Text(self.cipher.role.as_str()),
                    D1Type::Text(command_digest_hex.as_str()),
                    D1Type::Text(admission_digest_hex.as_str()),
                    D1Type::Text(reserved_at_ms.as_str()),
                    D1Type::Text(executed_at_ms.as_str()),
                    D1Type::Text(state_b64u.as_str()),
                    D1Type::Text(state_digest_hex.as_str()),
                ]
                .iter(),
            )?;
        let guard = self.command_cas_count_guard_statement(1)?;
        let results = self.session.batch(vec![statement, guard]).await?;
        if results.len() != 2 {
            return Err(store_error(
                "tenant-root refresh terminal commit returned an invalid result count",
            ));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "tenant-root refresh terminal commit statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown D1 error".to_owned())
                )));
            }
        }
        if result_changes(&results[0])? == 1 {
            require_changes(
                &results[1],
                0,
                "tenant-root refresh terminal count guard returned an invalid change count",
            )?;
            return Ok(CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes });
        }
        if result_changes(&results[0])? != 0 {
            return Err(store_error(
                "tenant-root refresh terminal commit returned an invalid change count",
            ));
        }
        let stored = self
            .load_command_replay(&key)
            .await?
            .ok_or_else(|| store_error("tenant-root refresh terminal replay row disappeared"))?;
        if !matches!(stored.record, TenantRootCommandReplayRecordV1::Completed(_))
            || stored.refresh_state != Some(expected_state)
            || stored.receipt_bytes.as_deref() != Some(receipt_bytes.as_slice())
        {
            return Err(store_error(
                "tenant-root refresh terminal replay conflicts with durable artifacts",
            ));
        }
        Ok(CloudflareTenantRootCommandTerminalCommitV1::Replay { receipt_bytes })
    }

    async fn run_refresh_state_update(
        &self,
        statement: worker::D1PreparedStatement,
        operation: &str,
    ) -> worker::Result<()> {
        let guard = self.command_cas_count_guard_statement(1)?;
        let results = self.session.batch(vec![statement, guard]).await?;
        if results.len() != 2 {
            return Err(store_error(format!(
                "tenant-root refresh {operation} returned an invalid result count"
            )));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "tenant-root refresh {operation} statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown D1 error".to_owned())
                )));
            }
        }
        require_changes(
            &results[0],
            1,
            "tenant-root refresh state changed concurrently",
        )?;
        require_changes(
            &results[1],
            0,
            "tenant-root refresh state count guard returned an invalid change count",
        )
    }

    /// Reserves initial creation with one exact verified evidence wire.
    ///
    /// The generic replay reservation remains below this creation-only boundary;
    /// this method is the only initial-creation entry point and carries evidence
    /// into every executable branch.
    pub(crate) async fn preflight_initial_creation(
        &self,
        command: &VerifiedTenantRootRoleCreationCommandV1,
        now_ms: u64,
    ) -> worker::Result<CloudflareTenantRootInitialCreationPreflightV1> {
        let scope = command.scope();
        self.require_command_role(scope.key())?;
        let Some(stored) = self.load_command_replay(scope.key()).await? else {
            command
                .require_fresh(now_ms)
                .map_err(|error| store_error(error.message()))?;
            return Ok(CloudflareTenantRootInitialCreationPreflightV1::Fresh);
        };
        match self.reconcile_initial_creation_retry(&stored, *scope.key(), command.digest())? {
            CloudflareTenantRootCommandReplayDecisionV1::InProgress
            | CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { .. }
            | CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { .. } => {
                Ok(CloudflareTenantRootInitialCreationPreflightV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootInitialCreationPreflightV1::ReplayCompleted { receipt_bytes },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootInitialCreationPreflightV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::Execute { .. } => Err(store_error(
                "durable initial creation replay returned a fresh execution",
            )),
        }
    }

    /// Persists one role's initial tenant-root share through its complete
    /// reserve, execution-checkpoint, and successful terminal-receipt path.
    pub(crate) async fn persist_initial_creation(
        &self,
        creation: CloudflareTenantRootInitialCreationInputV1,
        role_signer: &CloudflareTenantRootCreationRoleSignerV1,
        reserved_at_ms: u64,
        executed_at_ms: u64,
        terminal_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootInitialCreationPersistenceOutcomeV1> {
        validate_initial_creation_role_signer(&creation, role_signer)?;
        match self
            .preflight_initial_creation(&creation.command, reserved_at_ms)
            .await?
        {
            CloudflareTenantRootInitialCreationPreflightV1::Fresh => {}
            CloudflareTenantRootInitialCreationPreflightV1::InProgress => {
                return Ok(CloudflareTenantRootInitialCreationPersistenceOutcomeV1::InProgress);
            }
            CloudflareTenantRootInitialCreationPreflightV1::ReplayCompleted { receipt_bytes } => {
                return Ok(
                    CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayCompleted {
                        receipt_bytes,
                    },
                );
            }
            CloudflareTenantRootInitialCreationPreflightV1::ReplayFailed {
                failure_receipt_bytes,
            } => {
                return Ok(
                    CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayFailed {
                        failure_receipt_bytes,
                    },
                );
            }
        }

        let reservation = self
            .reserve_initial_creation_pending(creation, reserved_at_ms)
            .await?;
        let pending = match reservation {
            CloudflareTenantRootInitialCreationDecisionV1::Execute { command } => command,
            CloudflareTenantRootInitialCreationDecisionV1::InProgress
            | CloudflareTenantRootInitialCreationDecisionV1::ResumeExecution { .. }
            | CloudflareTenantRootInitialCreationDecisionV1::ResumeCompletion { .. } => {
                return Ok(CloudflareTenantRootInitialCreationPersistenceOutcomeV1::InProgress);
            }
            CloudflareTenantRootInitialCreationDecisionV1::ReplayCompleted { receipt_bytes } => {
                return Ok(
                    CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayCompleted {
                        receipt_bytes,
                    },
                );
            }
            CloudflareTenantRootInitialCreationDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => {
                return Ok(
                    CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayFailed {
                        failure_receipt_bytes,
                    },
                );
            }
        };
        let (_, executed) = self
            .insert_initial_creation_pending(pending, executed_at_ms)
            .await?;
        let receipt = role_signer
            .sign_verified_success_terminal_receipt(
                executed.executed(),
                executed.evidence_bytes(),
                terminal_at_ms,
            )
            .map_err(|error| store_error(error.message()))?;
        match self.complete_initial_creation(executed, receipt).await? {
            CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes } => Ok(
                CloudflareTenantRootInitialCreationPersistenceOutcomeV1::Committed {
                    receipt_bytes,
                },
            ),
            CloudflareTenantRootCommandTerminalCommitV1::Replay { receipt_bytes } => Ok(
                CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayCompleted {
                    receipt_bytes,
                },
            ),
        }
    }

    #[allow(dead_code)]
    pub(crate) async fn reserve_initial_creation_pending(
        &self,
        creation: CloudflareTenantRootInitialCreationInputV1,
        reserved_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootInitialCreationDecisionV1> {
        let CloudflareTenantRootInitialCreationInputV1 {
            command,
            evidence,
            record,
        } = creation;
        validate_initial_creation_binding(&command, &evidence, &record)?;
        let scope = initial_creation_scope_without_freshness(&command, &record)?;
        let creation_admission_digest = command.digest();
        // Freshness applies only before the first durable reservation. An exact
        // retry must still reconcile after the issuer command has expired.
        if self.load_command_replay(scope.key()).await?.is_none() {
            command
                .require_fresh(reserved_at_ms)
                .map_err(|error| store_error(error.message()))?;
        }
        let operation_payload_digest = insert_pending_payload_digest(&record, 1)?;
        match self
            .reserve_insert_pending_with_payload_digest(
                scope,
                record,
                reserved_at_ms,
                operation_payload_digest,
                Some(TenantRootCommandAdmissionV1::InitialCreation(
                    creation_admission_digest,
                )),
            )
            .await?
        {
            CloudflareTenantRootInsertPendingDecisionV1::Execute { command } => {
                Ok(CloudflareTenantRootInitialCreationDecisionV1::Execute {
                    command: CloudflareTenantRootInitialCreationPendingCommandV1 {
                        command,
                        evidence,
                    },
                })
            }
            CloudflareTenantRootInsertPendingDecisionV1::InProgress => {
                Ok(CloudflareTenantRootInitialCreationDecisionV1::InProgress)
            }
            CloudflareTenantRootInsertPendingDecisionV1::ResumeExecution { command } => Ok(
                CloudflareTenantRootInitialCreationDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootInitialCreationPendingCommandV1 {
                        command,
                        evidence,
                    },
                },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ResumeCompletion { executed } => Ok(
                CloudflareTenantRootInitialCreationDecisionV1::ResumeCompletion {
                    executed: CloudflareTenantRootInitialCreationExecutedCommandV1 {
                        executed,
                        evidence,
                    },
                },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootInitialCreationDecisionV1::ReplayCompleted { receipt_bytes },
            ),
            CloudflareTenantRootInsertPendingDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootInitialCreationDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
        }
    }

    /// Inserts one creation-only pending row and retains evidence for terminalization.
    #[allow(dead_code)]
    pub(crate) async fn insert_initial_creation_pending(
        &self,
        command: CloudflareTenantRootInitialCreationPendingCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<(
        CloudflareStoredTenantRootRoleShareV1,
        CloudflareTenantRootInitialCreationExecutedCommandV1,
    )> {
        let CloudflareTenantRootInitialCreationPendingCommandV1 { command, evidence } = command;
        let (stored, executed) = self.insert_pending(command, executed_at_ms).await?;
        Ok((
            stored,
            CloudflareTenantRootInitialCreationExecutedCommandV1 { executed, evidence },
        ))
    }

    /// Inserts a verified pending epoch exactly once using its reserved command.
    async fn insert_pending(
        &self,
        command: CloudflareTenantRootInsertPendingCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<(
        CloudflareStoredTenantRootRoleShareV1,
        ExecutedTenantRootCommandV1,
    )> {
        let CloudflareTenantRootInsertPendingCommandV1 {
            scope,
            record,
            reservation,
            expected_revision,
            operation_payload_digest,
        } = command;
        record.validate()?;
        self.cipher.require_role(record.role)?;
        if !matches!(
            record.lifecycle,
            CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
        ) {
            return Err(store_error(
                "tenant-root role-private insertion requires a pending record",
            ));
        }
        validate_command_scope_for_record(
            &scope,
            &record,
            expected_revision,
            "tenant-root pending insertion",
        )?;
        if expected_revision != 1 {
            return Err(store_error(
                "tenant-root pending insertion has an invalid initial revision",
            ));
        }
        let operation = TenantRootCommandOperationV1::insert_pending(operation_payload_digest);
        validate_reserved_command(
            &scope,
            &reservation,
            operation,
            "tenant-root pending insertion",
        )?;
        let metadata = record_metadata(&record)?;
        let ciphertext_json = self.cipher.seal(&record, expected_revision)?;
        let epoch = metadata.epoch.to_string();
        let created_at_ms = record.created_at_ms.to_string();
        let updated_at_ms = record.updated_at_ms.to_string();
        let lifecycle_statement = self.session.prepare(INSERT_SQL).bind_refs(
            [
                D1Type::Text(metadata.identity_digest_hex.as_str()),
                D1Type::Text(metadata.custody_lineage_b64u.as_str()),
                D1Type::Text(epoch.as_str()),
                D1Type::Text(metadata.role.as_str()),
                D1Type::Text(metadata.lifecycle.as_str()),
                D1Type::Text(ciphertext_json.as_str()),
                D1Type::Text(created_at_ms.as_str()),
                D1Type::Text(updated_at_ms.as_str()),
            ]
            .iter(),
        )?;
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        let executed = self
            .run_lifecycle_checkpoint(
                lifecycle_statement,
                1,
                checkpoint_statement,
                reservation,
                executed_at_ms,
            )
            .await?;
        Ok((
            CloudflareStoredTenantRootRoleShareV1 {
                record,
                revision: expected_revision,
            },
            executed,
        ))
    }

    /// Executes one reserved managed-restore staging insertion.
    pub(crate) async fn insert_managed_restore_pending(
        &self,
        command: CloudflareTenantRootManagedRestoreStagingPendingCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<(
        CloudflareStoredTenantRootRoleShareV1,
        ExecutedTenantRootCommandV1,
    )> {
        let CloudflareTenantRootManagedRestoreStagingPendingCommandV1 { command } = command;
        let expected_payload_digest = insert_pending_payload_digest(&command.record, 1)?;
        if command.operation_payload_digest != expected_payload_digest {
            return Err(store_error(
                "managed-restore staging command payload does not match its pending record",
            ));
        }
        let capability_digest = match &command.record.lifecycle {
            CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) => pending
                .managed_restore_digests()
                .map(|(capability_digest, _)| capability_digest)
                .ok_or_else(|| {
                    store_error("managed-restore staging command lost restore provenance")
                })?,
            _ => {
                return Err(store_error(
                    "managed-restore staging command requires a pending record",
                ));
            }
        };
        validate_managed_restore_staging_record(&command.record, capability_digest)?;
        self.insert_pending(command, executed_at_ms).await
    }

    /// Commits one managed-restore staging receipt without changing lifecycle
    /// state. The pending row remains fenced from every activation path.
    pub(crate) async fn complete_managed_restore_staging(
        &self,
        executed: ExecutedTenantRootCommandV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> worker::Result<CloudflareTenantRootCommandTerminalCommitV1> {
        self.complete_command(executed, receipt).await
    }

    /// Loads the one active role share authorized by the control-plane binding.
    ///
    /// The store's configured role supplies the role selector. Identity, lineage,
    /// epoch, commitment, and activation receipt all come from the authenticated
    /// custody binding; no caller can choose them independently.
    pub(crate) async fn load_active(
        &self,
        custody_binding: &TenantRootCustodyBindingV1,
    ) -> worker::Result<CloudflareStoredTenantRootRoleShareV1> {
        custody_binding
            .validate()
            .map_err(|error| store_error(error.message()))?;
        let active = self
            .load_active_resolution(custody_binding.identity_digest())
            .await?
            .require_active()?;
        let observed = active_binding_from_stored(&active)?;
        let expected_role = self.cipher.role.managed_restore_role();
        let expected_commitment = match expected_role {
            TenantRootManagedRestoreRoleV1::DeriverA => custody_binding.commitments().deriver_a(),
            TenantRootManagedRestoreRoleV1::DeriverB => custody_binding.commitments().deriver_b(),
        };
        if observed.identity_digest() != custody_binding.identity_digest()
            || observed.custody_lineage() != custody_binding.custody_lineage()
            || observed.epoch() != custody_binding.epoch()
            || observed.role() != expected_role
            || observed.share_commitment() != expected_commitment
            || observed.activation_receipt_digest() != custody_binding.activation_receipt_digest()
        {
            return Err(store_error(
                "tenant-root active role share does not match authenticated custody binding",
            ));
        }
        Ok(active)
    }

    /// Observes all active rows for the debug lifecycle probe.
    async fn observe_active(
        &self,
        identity: &TenantRootIdentityV1,
    ) -> worker::Result<CloudflareTenantRootActiveRoleShareV1> {
        let identity_digest = identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        self.load_active_resolution(identity_digest).await
    }

    async fn load_active_resolution(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
    ) -> worker::Result<CloudflareTenantRootActiveRoleShareV1> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let rows = self
            .session
            .prepare(LOAD_ACTIVE_SQL)
            .bind_refs([D1Type::Text(identity_digest_hex.as_str())].iter())?
            .all()
            .await?
            .results::<TenantRootRoleD1RowV1>()?;
        let mut stored = Vec::with_capacity(rows.len());
        for row in rows {
            let opened = self
                .open_row(Some(row))
                .await?
                .ok_or_else(|| store_error("tenant-root role-private active row is missing"))?;
            stored.push(opened);
        }
        let mut observed = Vec::with_capacity(stored.len());
        for entry in &stored {
            observed.push(active_binding_from_stored(entry)?);
        }
        let resolution = resolve_active_tenant_root_role_binding_v1(
            identity_digest,
            self.cipher.role.managed_restore_role(),
            &observed,
        )
        .map_err(|error| store_error(error.message()))?;
        Ok(match resolution {
            TenantRootActiveRoleResolutionV1::Unprovisioned => {
                CloudflareTenantRootActiveRoleShareV1::Unprovisioned
            }
            TenantRootActiveRoleResolutionV1::Active(binding) => {
                let [stored] = stored
                    .try_into()
                    .map_err(|_| store_error("tenant-root active resolution lost its exact row"))?;
                let expected = active_binding_from_stored(&stored)?;
                if expected != binding {
                    return Err(store_error(
                        "tenant-root active resolution changed its stored commitment",
                    ));
                }
                CloudflareTenantRootActiveRoleShareV1::from_stored(stored)?
            }
            TenantRootActiveRoleResolutionV1::Ambiguous(ambiguity) => {
                CloudflareTenantRootActiveRoleShareV1::Ambiguous(ambiguity)
            }
        })
    }

    /// Loads one exact lineage and epoch for reconciliation or lifecycle work.
    pub async fn load_epoch(
        &self,
        identity: &TenantRootIdentityV1,
        custody_lineage: TenantRootCustodyLineageId,
        epoch: TenantRootShareEpoch,
    ) -> worker::Result<Option<CloudflareStoredTenantRootRoleShareV1>> {
        let identity_digest_hex = identity_digest_hex(identity)?;
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let epoch = epoch_i64(epoch)?.to_string();
        let row = self
            .session
            .prepare(LOAD_EPOCH_SQL)
            .bind_refs(
                [
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(epoch.as_str()),
                    D1Type::Text(self.cipher.role.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRoleD1RowV1>(None)
            .await?;
        self.open_row(row).await
    }

    pub(crate) async fn load_epoch_by_identity_digest(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        epoch: TenantRootShareEpoch,
    ) -> worker::Result<Option<CloudflareStoredTenantRootRoleShareV1>> {
        let identity_digest_hex = encode_hex(identity_digest.as_bytes());
        let custody_lineage_b64u = custody_lineage.to_base64url();
        let epoch = epoch_i64(epoch)?.to_string();
        let row = self
            .session
            .prepare(LOAD_EPOCH_SQL)
            .bind_refs(
                [
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(epoch.as_str()),
                    D1Type::Text(self.cipher.role.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootRoleD1RowV1>(None)
            .await?;
        self.open_row(row).await
    }

    pub(crate) async fn load_initial_pending_for_activation(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> worker::Result<CloudflareStoredTenantRootRoleShareV1> {
        let stored = self
            .load_epoch_by_identity_digest(
                identity_digest,
                custody_lineage,
                TenantRootShareEpoch::INITIAL,
            )
            .await?
            .ok_or_else(|| store_error("tenant-root initial pending role share does not exist"))?;
        if !matches!(
            stored.record.lifecycle(),
            CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
                | CloudflareTenantRootRoleShareLifecycleV1::Active(_)
        ) {
            return Err(store_error(
                "tenant-root initial activation requires a pending or active role share",
            ));
        }
        Ok(stored)
    }

    /// Returns whether one exact activation command already has a
    /// durable replay row. Freshness is enforced only when this is false.
    pub(crate) async fn activation_replay_exists(
        &self,
        scope: &TenantRootCommandScopeV1,
    ) -> worker::Result<bool> {
        self.require_command_role(scope.key())?;
        Ok(self.load_command_replay(scope.key()).await?.is_some())
    }

    /// Reconciles an activation retry after its lifecycle mutation committed.
    pub(crate) async fn reconcile_activation_after_swap(
        &self,
        scope: &TenantRootCommandScopeV1,
    ) -> worker::Result<CloudflareTenantRootCommandReplayDecisionV1> {
        self.require_command_role(scope.key())?;
        let stored = self
            .load_command_replay(scope.key())
            .await?
            .ok_or_else(|| {
                store_error("tenant-root active successor has no activation replay record")
            })?;
        self.reconcile_command_retry(&stored, *scope.key(), stored.record.command_digest())
    }

    /// Loads the exact completed refresh artifacts linked from one pending row.
    /// The link is the replay row's primary-key digest, so activation never
    /// scans replay history or accepts a caller-selected refresh record.
    pub(crate) async fn load_refresh_artifact_checkpoint(
        &self,
        pending: &CloudflareStoredTenantRootRoleShareV1,
    ) -> worker::Result<CloudflareTenantRootRefreshArtifactCheckpointV1> {
        validate_pending_stored_record(&self.cipher, pending)?;
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending_state) =
            pending.record.lifecycle()
        else {
            unreachable!("pending lifecycle was checked by validate_pending_stored_record");
        };
        let replay_key_digest = pending_state.refresh_replay_key_digest().ok_or_else(|| {
            store_error("tenant-root pending refresh row omitted its replay linkage")
        })?;
        let stored = self
            .load_command_replay_by_storage_key_digest(replay_key_digest)
            .await?
            .ok_or_else(|| {
                store_error("tenant-root pending refresh row links to a missing replay row")
            })?;
        if !matches!(stored.record, TenantRootCommandReplayRecordV1::Completed(_)) {
            return Err(store_error(
                "tenant-root refresh artifact checkpoint requires a completed replay",
            ));
        }
        let state = stored.refresh_state.ok_or_else(|| {
            store_error("tenant-root completed refresh replay omitted its durable state")
        })?;
        let CloudflareTenantRootRefreshDurableStateV1::Artifacts {
            command_b64u,
            evidence_b64u,
            prepared_artifacts,
            artifacts,
        } = state
        else {
            return Err(store_error(
                "tenant-root completed refresh replay omitted its artifact checkpoint",
            ));
        };
        let command_bytes =
            decode_refresh_state_bytes("tenant-root refresh checkpoint command", &command_b64u)?;
        let command = TenantRootRoleRefreshCommandV1::decode_canonical_bytes(&command_bytes)
            .map_err(|error| store_error(error.message()))?;
        let identity_digest = pending
            .record
            .identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        if command.identity_digest() != identity_digest
            || command.custody_lineage() != pending.record.custody_lineage
            || command.next_epoch() != pending.record.epoch
            || command.role() != protocol_role_for_cloudflare(self.cipher.role)
        {
            return Err(store_error(
                "tenant-root refresh checkpoint command does not match its pending row",
            ));
        }
        let command_key = TenantRootCommandReplayKeyV1::new(
            command.identity_digest(),
            command.custody_lineage(),
            command.session_id(),
            command.nonce(),
            command.role(),
        );
        if command_key
            .storage_key_digest()
            .map_err(|error| store_error(error.message()))?
            != replay_key_digest
        {
            return Err(store_error(
                "tenant-root refresh checkpoint command does not match its replay link",
            ));
        }
        let evidence_bytes =
            decode_refresh_state_bytes("tenant-root refresh checkpoint evidence", &evidence_b64u)?;
        TenantRootSignedShareInstallationEvidenceV1::decode_canonical_bytes(&evidence_bytes)
            .map_err(|error| store_error(error.message()))?;
        let evidence_digest =
            TenantRootLifecycleReceiptDigestV1::from_bytes(Sha256::digest(&evidence_bytes).into())
                .map_err(|error| store_error(error.message()))?;
        if evidence_digest != pending_state.installation_evidence_digest() {
            return Err(store_error(
                "tenant-root refresh checkpoint evidence does not match its pending row",
            ));
        }
        Ok(CloudflareTenantRootRefreshArtifactCheckpointV1 {
            command_bytes,
            evidence_bytes,
            prepared_artifacts,
            artifacts,
        })
    }

    /// Reserves one exact initial-activation command.
    pub(crate) async fn reserve_activate_initial_pending(
        &self,
        scope: TenantRootCommandScopeV1,
        pending: CloudflareStoredTenantRootRoleShareV1,
        activation: CloudflareTenantRootActivationV1,
        updated_at_ms: u64,
        reserved_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootActivateInitialPendingDecisionV1> {
        validate_pending_stored_record(&self.cipher, &pending)?;
        if pending.record.epoch != TenantRootShareEpoch::INITIAL {
            return Err(store_error(
                "tenant-root initial activation requires epoch 1",
            ));
        }
        let expected_revision = pending.revision;
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_revision,
            "tenant-root initial activation",
        )?;
        pending
            .record
            .clone()
            .into_active(activation.clone(), updated_at_ms)?;
        let operation =
            TenantRootCommandOperationV1::activate_initial(activate_initial_payload_digest(
                &pending,
                &activation,
                updated_at_ms,
                expected_revision,
            )?);
        match self
            .reserve_scoped_command(scope, operation, reserved_at_ms)
            .await?
        {
            CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => Ok(
                CloudflareTenantRootActivateInitialPendingDecisionV1::Execute {
                    command: CloudflareTenantRootActivateInitialPendingCommandV1 {
                        scope,
                        reservation,
                        pending,
                        activation,
                        updated_at_ms,
                        expected_revision,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootActivateInitialPendingDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootActivateInitialPendingDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootActivateInitialPendingCommandV1 {
                        scope,
                        reservation,
                        pending,
                        activation,
                        updated_at_ms,
                        expected_revision,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => Ok(
                CloudflareTenantRootActivateInitialPendingDecisionV1::ResumeCompletion { executed },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootActivateInitialPendingDecisionV1::ReplayCompleted {
                    receipt_bytes,
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootActivateInitialPendingDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
        }
    }

    /// Reserves one exact active-epoch-swap command.
    pub(crate) async fn reserve_swap_active_epoch(
        &self,
        scope: TenantRootCommandScopeV1,
        active: CloudflareStoredTenantRootRoleShareV1,
        pending: CloudflareStoredTenantRootRoleShareV1,
        activation: CloudflareTenantRootActivationV1,
        retirement: CloudflareTenantRootRetirementV1,
        updated_at_ms: u64,
        reserved_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootSwapActiveEpochDecisionV1> {
        validate_active_stored_record(&self.cipher, &active)?;
        validate_pending_stored_record(&self.cipher, &pending)?;
        validate_epoch_swap_inputs(&active, &pending)?;
        validate_activation_receipt_against_swap_records(&activation, &active, &pending)?;
        let expected_active_revision = active.revision;
        let expected_pending_revision = pending.revision;
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_pending_revision,
            "tenant-root epoch swap",
        )?;
        active
            .record
            .clone()
            .into_retired(retirement.clone(), updated_at_ms)?;
        pending
            .record
            .clone()
            .into_active(activation.clone(), updated_at_ms)?;
        let operation =
            TenantRootCommandOperationV1::swap_active_epoch(swap_active_epoch_payload_digest(
                &active,
                &pending,
                &activation,
                &retirement,
                updated_at_ms,
                expected_active_revision,
                expected_pending_revision,
            )?);
        match self
            .reserve_scoped_command(scope, operation, reserved_at_ms)
            .await?
        {
            CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => {
                Ok(CloudflareTenantRootSwapActiveEpochDecisionV1::Execute {
                    command: CloudflareTenantRootSwapActiveEpochCommandV1 {
                        scope,
                        reservation,
                        active,
                        pending,
                        activation,
                        retirement,
                        updated_at_ms,
                        expected_active_revision,
                        expected_pending_revision,
                    },
                })
            }
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootSwapActiveEpochDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootSwapActiveEpochDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootSwapActiveEpochCommandV1 {
                        scope,
                        reservation,
                        active,
                        pending,
                        activation,
                        retirement,
                        updated_at_ms,
                        expected_active_revision,
                        expected_pending_revision,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => {
                Ok(CloudflareTenantRootSwapActiveEpochDecisionV1::ResumeCompletion { executed })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootSwapActiveEpochDecisionV1::ReplayCompleted { receipt_bytes },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootSwapActiveEpochDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
        }
    }

    /// Reserves the mandatory forward refresh for a managed-restore source.
    ///
    /// The restored row is deliberately kept pending. Execution consumes that
    /// row and activates only the exact next refresh row in one D1 batch.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn reserve_managed_restore_forward_refresh(
        &self,
        scope: TenantRootCommandScopeV1,
        restored_pending: CloudflareStoredTenantRootRoleShareV1,
        refresh_pending: CloudflareStoredTenantRootRoleShareV1,
        activation: CloudflareTenantRootActivationV1,
        capability_digest: TenantRootLifecycleReceiptDigestV1,
        backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
        updated_at_ms: u64,
        reserved_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1> {
        validate_managed_restore_forward_refresh_inputs(
            &self.cipher,
            &scope,
            &restored_pending,
            &refresh_pending,
            &activation,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
            updated_at_ms,
        )?;
        let expected_restored_revision = restored_pending.revision;
        let expected_refresh_revision = refresh_pending.revision;
        let operation_payload_digest = managed_restore_forward_refresh_payload_digest(
            &scope,
            &restored_pending,
            &refresh_pending,
            &activation,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
            updated_at_ms,
            expected_restored_revision,
            expected_refresh_revision,
        )?;
        let operation = TenantRootCommandOperationV1::swap_active_epoch(operation_payload_digest);
        match self
            .reserve_scoped_command(scope, operation, reserved_at_ms)
            .await?
        {
            CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => Ok(
                CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::Execute {
                    command: CloudflareTenantRootManagedRestoreForwardRefreshCommandV1 {
                        scope,
                        reservation,
                        restored_pending,
                        refresh_pending,
                        activation,
                        capability_digest,
                        backup_receipt_digest,
                        installation_receipt_digest,
                        updated_at_ms,
                        expected_restored_revision,
                        expected_refresh_revision,
                        operation_payload_digest,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootManagedRestoreForwardRefreshCommandV1 {
                        scope,
                        reservation,
                        restored_pending,
                        refresh_pending,
                        activation,
                        capability_digest,
                        backup_receipt_digest,
                        installation_receipt_digest,
                        updated_at_ms,
                        expected_restored_revision,
                        expected_refresh_revision,
                        operation_payload_digest,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => Ok(
                CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ResumeCompletion {
                    executed,
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => Ok(
                CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ReplayCompleted {
                    receipt_bytes,
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(
                CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                },
            ),
        }
    }

    /// Applies the mandatory managed-restore forward refresh atomically.
    ///
    /// The source pending row is deleted only in the same batch that activates
    /// its exact next-epoch refresh row and checkpoints command execution.
    pub(crate) async fn execute_managed_restore_forward_refresh(
        &self,
        command: CloudflareTenantRootManagedRestoreForwardRefreshCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<(
        CloudflareStoredTenantRootRoleShareV1,
        ExecutedTenantRootCommandV1,
    )> {
        let CloudflareTenantRootManagedRestoreForwardRefreshCommandV1 {
            scope,
            reservation,
            restored_pending,
            refresh_pending,
            activation,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
            updated_at_ms,
            expected_restored_revision,
            expected_refresh_revision,
            operation_payload_digest,
        } = command;
        validate_managed_restore_forward_refresh_inputs(
            &self.cipher,
            &scope,
            &restored_pending,
            &refresh_pending,
            &activation,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
            updated_at_ms,
        )?;
        if expected_restored_revision != restored_pending.revision
            || expected_refresh_revision != refresh_pending.revision
        {
            return Err(store_error(
                "managed-restore forward-refresh command revision changed",
            ));
        }
        let expected_payload_digest = managed_restore_forward_refresh_payload_digest(
            &scope,
            &restored_pending,
            &refresh_pending,
            &activation,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
            updated_at_ms,
            expected_restored_revision,
            expected_refresh_revision,
        )?;
        if operation_payload_digest != expected_payload_digest {
            return Err(store_error(
                "managed-restore forward-refresh command payload does not match its inputs",
            ));
        }
        let operation = TenantRootCommandOperationV1::swap_active_epoch(operation_payload_digest);
        validate_reserved_command(
            &scope,
            &reservation,
            operation,
            "managed-restore forward refresh",
        )?;
        let activated_revision = next_revision(expected_refresh_revision)?;
        let activated_record = refresh_pending
            .record
            .clone()
            .into_active(activation, updated_at_ms)?;
        let activated_metadata = record_metadata(&activated_record)?;
        let activated_ciphertext_json = self.cipher.seal(&activated_record, activated_revision)?;
        let restored_metadata = record_metadata(&restored_pending.record)?;
        if restored_metadata.identity_digest_hex != activated_metadata.identity_digest_hex
            || restored_metadata.custody_lineage_b64u != activated_metadata.custody_lineage_b64u
            || restored_metadata.role != activated_metadata.role
        {
            return Err(store_error(
                "managed-restore forward-refresh metadata changed during transition",
            ));
        }
        let restored_epoch = restored_metadata.epoch.to_string();
        let refresh_epoch = activated_metadata.epoch.to_string();
        let restored_revision = expected_restored_revision.to_string();
        let refresh_revision = expected_refresh_revision.to_string();
        let updated_at_ms = timestamp_i64(updated_at_ms)?.to_string();
        let delete_statement = self
            .session
            .prepare(DELETE_MANAGED_RESTORE_FORWARD_REFRESH_PENDING_SQL)
            .bind_refs(
                [
                    D1Type::Text(restored_metadata.identity_digest_hex.as_str()),
                    D1Type::Text(restored_metadata.custody_lineage_b64u.as_str()),
                    D1Type::Text(restored_epoch.as_str()),
                    D1Type::Text(restored_metadata.role.as_str()),
                    D1Type::Text(restored_revision.as_str()),
                ]
                .iter(),
            )?;
        let activate_statement = self
            .session
            .prepare(ACTIVATE_MANAGED_RESTORE_FORWARD_REFRESH_PENDING_SQL)
            .bind_refs(
                [
                    D1Type::Text(activated_ciphertext_json.as_str()),
                    D1Type::Text(updated_at_ms.as_str()),
                    D1Type::Text(activated_metadata.identity_digest_hex.as_str()),
                    D1Type::Text(activated_metadata.custody_lineage_b64u.as_str()),
                    D1Type::Text(refresh_epoch.as_str()),
                    D1Type::Text(activated_metadata.role.as_str()),
                    D1Type::Text(refresh_revision.as_str()),
                    D1Type::Text(restored_epoch.as_str()),
                ]
                .iter(),
            )?;
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        let executed = self
            .run_managed_restore_forward_refresh_checkpoint(
                delete_statement,
                activate_statement,
                checkpoint_statement,
                reservation,
                executed_at_ms,
            )
            .await?;
        Ok((
            CloudflareStoredTenantRootRoleShareV1 {
                record: activated_record,
                revision: activated_revision,
            },
            executed,
        ))
    }

    /// Reserves a cleanup that a control-plane authorization permits.
    ///
    /// This is the authorized path. The raw `reserve_cleanup_pending` below
    /// takes a caller-supplied scope and asks no one's permission, so it can
    /// only be reached from inside this store; every external cleanup must
    /// present a signed command naming the exact row.
    ///
    /// The scope is derived from the command's own nonce, not the ceremony's,
    /// so a cleanup is a distinct one-use command from the creation it undoes.
    /// A replayed creation command therefore cannot authorize deleting the
    /// share it created.
    pub(crate) async fn reserve_authorized_cleanup(
        &self,
        authorization: VerifiedTenantRootRoleCleanupCommandV1,
        reserved_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootAuthorizedCleanupDecisionV1> {
        let record_role = authorization.role();
        if record_role.as_str() != self.cipher.role.as_str() {
            return Err(store_error(
                "tenant-root cleanup authorization names another role",
            ));
        }
        let key = TenantRootCommandReplayKeyV1::new(
            authorization.identity_digest(),
            authorization.custody_lineage(),
            // The cleanup's own session coordinate is its nonce, which makes
            // its replay key disjoint from the creation command's.
            router_ab_core::TenantRootCeremonySessionIdV1::from_bytes(
                authorization.nonce().as_bytes()[..16]
                    .try_into()
                    .expect("sixteen nonce bytes"),
            )
            .map_err(|error| store_error(error.message()))?,
            authorization.nonce(),
            record_role,
        );
        let scope = TenantRootCommandScopeV1::new(
            key,
            authorization.epoch(),
            TENANT_ROOT_AUTHORIZED_CLEANUP_CONTROL_PLANE_REVISION_V1,
        )
        .map_err(|error| store_error(error.message()))?;
        let authorization_digest = authorization
            .digest()
            .map_err(|error| store_error(error.message()))?;
        let replay = self.load_command_replay(scope.key()).await?;
        if let Some(stored) = replay.as_ref() {
            match &stored.record {
                TenantRootCommandReplayRecordV1::Executed(_)
                | TenantRootCommandReplayRecordV1::Completed(_)
                | TenantRootCommandReplayRecordV1::Failed(_) => {
                    return match self.reconcile_authorized_cleanup_retry(
                        stored,
                        key,
                        authorization_digest,
                        None,
                    )? {
                        CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion {
                            executed,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeCompletion {
                                executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                                    executed,
                                    authorization,
                                },
                            },
                        ),
                        CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted {
                            receipt_bytes,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted {
                                receipt_bytes,
                            },
                        ),
                        CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                            failure_receipt_bytes,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed {
                                failure_receipt_bytes,
                            },
                        ),
                        _ => Err(store_error(
                            "durable tenant-root cleanup replay returned an invalid decision",
                        )),
                    };
                }
                TenantRootCommandReplayRecordV1::Reserved(_) => {}
            }
        } else {
            authorization
                .require_fresh(reserved_at_ms)
                .map_err(|error| store_error(error.message()))?;
        }

        match authorization.target() {
            TenantRootRoleCleanupTargetV1::Pending { .. } => {
                let pending = self
                    .load_epoch_by_identity_digest(
                        authorization.identity_digest(),
                        authorization.custody_lineage(),
                        authorization.epoch(),
                    )
                    .await?
                    .ok_or_else(|| store_error("tenant-root cleanup pending row does not exist"))?;
                validate_authorized_cleanup_pending(&self.cipher, &authorization, &pending)?;
                let operation_payload_digest = authorized_cleanup_pending_payload_digest(
                    &authorization,
                    &pending,
                    pending.revision,
                )?;
                match self
                    .reserve_cleanup_pending_with_payload_digest(
                        scope,
                        pending,
                        reserved_at_ms,
                        operation_payload_digest,
                        Some(TenantRootCommandAdmissionV1::AuthorizedCleanup(
                            authorization_digest,
                        )),
                    )
                    .await?
                {
                    CloudflareTenantRootCleanupPendingDecisionV1::Execute { command } => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::Execute {
                            command: CloudflareTenantRootAuthorizedCleanupCommandV1::Pending(
                                CloudflareTenantRootAuthorizedCleanupPendingCommandV1 {
                                    command,
                                    authorization,
                                },
                            ),
                        })
                    }
                    CloudflareTenantRootCleanupPendingDecisionV1::InProgress => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::InProgress)
                    }
                    CloudflareTenantRootCleanupPendingDecisionV1::ResumeExecution { command } => {
                        Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeExecution {
                                command: CloudflareTenantRootAuthorizedCleanupCommandV1::Pending(
                                    CloudflareTenantRootAuthorizedCleanupPendingCommandV1 {
                                        command,
                                        authorization,
                                    },
                                ),
                            },
                        )
                    }
                    CloudflareTenantRootCleanupPendingDecisionV1::ResumeCompletion { executed } => {
                        Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeCompletion {
                                executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                                    executed,
                                    authorization,
                                },
                            },
                        )
                    }
                    CloudflareTenantRootCleanupPendingDecisionV1::ReplayCompleted {
                        receipt_bytes,
                    } => Ok(
                        CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted {
                            receipt_bytes,
                        },
                    ),
                    CloudflareTenantRootCleanupPendingDecisionV1::ReplayFailed {
                        failure_receipt_bytes,
                    } => Ok(
                        CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed {
                            failure_receipt_bytes,
                        },
                    ),
                }
            }
            TenantRootRoleCleanupTargetV1::Retired {
                retired_epoch,
                expected_retired_revision,
                expected_active_epoch,
                expected_active_revision,
                ..
            } => {
                let active = self
                    .load_epoch_by_identity_digest(
                        authorization.identity_digest(),
                        authorization.custody_lineage(),
                        *expected_active_epoch,
                    )
                    .await?
                    .ok_or_else(|| {
                        store_error("tenant-root cleanup active successor row does not exist")
                    })?;
                let retired = self
                    .load_epoch_by_identity_digest(
                        authorization.identity_digest(),
                        authorization.custody_lineage(),
                        *retired_epoch,
                    )
                    .await?;
                let Some(retired) = retired else {
                    validate_authorized_cleanup_retired_absent(
                        &self.cipher,
                        &authorization,
                        &active,
                    )?;
                    let operation_payload_digest =
                        authorized_cleanup_retired_absent_payload_digest(&authorization)?;
                    return match self
                        .reserve_scoped_command_with_admission_digest(
                            scope,
                            TenantRootCommandOperationV1::cleanup_pending(operation_payload_digest),
                            reserved_at_ms,
                            Some(TenantRootCommandAdmissionV1::AuthorizedCleanup(
                                authorization_digest,
                            )),
                        )
                        .await?
                    {
                        CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation }
                        | CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution {
                            reservation,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::RetiredAlreadyAbsent {
                                reservation,
                                authorization,
                            },
                        ),
                        CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                            Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::InProgress)
                        }
                        CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion {
                            executed,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeCompletion {
                                executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                                    executed,
                                    authorization,
                                },
                            },
                        ),
                        CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted {
                            receipt_bytes,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted {
                                receipt_bytes,
                            },
                        ),
                        CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                            failure_receipt_bytes,
                        } => Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed {
                                failure_receipt_bytes,
                            },
                        ),
                    };
                };
                validate_authorized_cleanup_retired(
                    &self.cipher,
                    &authorization,
                    &retired,
                    &active,
                )?;
                let operation_payload_digest = authorized_cleanup_retired_payload_digest(
                    &authorization,
                    &retired,
                    *expected_retired_revision,
                    *expected_active_epoch,
                    *expected_active_revision,
                )?;
                match self
                    .reserve_cleanup_retired_with_payload_digest(
                        scope,
                        retired,
                        *expected_retired_revision,
                        *expected_active_epoch,
                        *expected_active_revision,
                        reserved_at_ms,
                        operation_payload_digest,
                        Some(TenantRootCommandAdmissionV1::AuthorizedCleanup(
                            authorization_digest,
                        )),
                    )
                    .await?
                {
                    CloudflareTenantRootCleanupRetiredDecisionV1::Execute { command } => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::Execute {
                            command: CloudflareTenantRootAuthorizedCleanupCommandV1::Retired(
                                CloudflareTenantRootAuthorizedCleanupRetiredCommandV1 {
                                    command,
                                    authorization,
                                },
                            ),
                        })
                    }
                    CloudflareTenantRootCleanupRetiredDecisionV1::InProgress => {
                        Ok(CloudflareTenantRootAuthorizedCleanupDecisionV1::InProgress)
                    }
                    CloudflareTenantRootCleanupRetiredDecisionV1::ResumeExecution { command } => {
                        Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeExecution {
                                command: CloudflareTenantRootAuthorizedCleanupCommandV1::Retired(
                                    CloudflareTenantRootAuthorizedCleanupRetiredCommandV1 {
                                        command,
                                        authorization,
                                    },
                                ),
                            },
                        )
                    }
                    CloudflareTenantRootCleanupRetiredDecisionV1::ResumeCompletion { executed } => {
                        Ok(
                            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeCompletion {
                                executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                                    executed,
                                    authorization,
                                },
                            },
                        )
                    }
                    CloudflareTenantRootCleanupRetiredDecisionV1::ReplayCompleted {
                        receipt_bytes,
                    } => Ok(
                        CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted {
                            receipt_bytes,
                        },
                    ),
                    CloudflareTenantRootCleanupRetiredDecisionV1::ReplayFailed {
                        failure_receipt_bytes,
                    } => Ok(
                        CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed {
                            failure_receipt_bytes,
                        },
                    ),
                }
            }
        }
    }

    /// Executes one authorized cleanup and returns its exact terminal receipt bytes.
    pub(crate) async fn persist_authorized_cleanup(
        &self,
        authorization: VerifiedTenantRootRoleCleanupCommandV1,
        role_signer: &CloudflareTenantRootCreationRoleSignerV1,
        reserved_at_ms: u64,
        executed_at_ms: u64,
        terminal_at_ms: u64,
    ) -> worker::Result<Vec<u8>> {
        if role_signer.role() != authorization.role() {
            return Err(store_error(
                "tenant-root cleanup receipt signer does not match the authorized role",
            ));
        }
        let authorization_bytes = authorization
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?;
        let decision = self
            .reserve_authorized_cleanup(authorization, reserved_at_ms)
            .await?;
        let executed = match decision {
            CloudflareTenantRootAuthorizedCleanupDecisionV1::Execute { command }
            | CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeExecution { command } => {
                self.execute_authorized_cleanup(command, executed_at_ms)
                    .await?
            }
            CloudflareTenantRootAuthorizedCleanupDecisionV1::ResumeCompletion { executed } => {
                executed
            }
            CloudflareTenantRootAuthorizedCleanupDecisionV1::RetiredAlreadyAbsent {
                reservation,
                authorization,
            } => {
                let executed = self
                    .checkpoint_command_without_lifecycle(reservation, executed_at_ms)
                    .await?;
                CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
                    executed,
                    authorization,
                }
            }
            CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted { receipt_bytes } => {
                return Ok(receipt_bytes);
            }
            CloudflareTenantRootAuthorizedCleanupDecisionV1::InProgress => {
                return Err(store_error(
                    "tenant-root authorized cleanup is already in progress",
                ));
            }
            CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed { .. } => {
                return Err(store_error(
                    "tenant-root authorized cleanup previously failed",
                ));
            }
        };
        let receipt = role_signer
            .sign_verified_success_terminal_receipt(
                &executed.executed,
                &authorization_bytes,
                terminal_at_ms,
            )
            .map_err(|error| store_error(error.message()))?;
        match self.complete_authorized_cleanup(executed, receipt).await? {
            CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes }
            | CloudflareTenantRootCommandTerminalCommitV1::Replay { receipt_bytes } => {
                Ok(receipt_bytes)
            }
        }
    }

    async fn reserve_cleanup_pending(
        &self,
        scope: TenantRootCommandScopeV1,
        pending: CloudflareStoredTenantRootRoleShareV1,
        reserved_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootCleanupPendingDecisionV1> {
        let operation_payload_digest = cleanup_pending_payload_digest(&pending, pending.revision)?;
        self.reserve_cleanup_pending_with_payload_digest(
            scope,
            pending,
            reserved_at_ms,
            operation_payload_digest,
            None,
        )
        .await
    }

    async fn reserve_cleanup_pending_with_payload_digest(
        &self,
        scope: TenantRootCommandScopeV1,
        pending: CloudflareStoredTenantRootRoleShareV1,
        reserved_at_ms: u64,
        operation_payload_digest: TenantRootProtocolDigestV1,
        admission: Option<TenantRootCommandAdmissionV1>,
    ) -> worker::Result<CloudflareTenantRootCleanupPendingDecisionV1> {
        validate_pending_stored_record(&self.cipher, &pending)?;
        let expected_revision = pending.revision;
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_revision,
            "tenant-root pending cleanup",
        )?;
        let operation = TenantRootCommandOperationV1::cleanup_pending(operation_payload_digest);
        match self
            .reserve_scoped_command_with_admission_digest(
                scope,
                operation,
                reserved_at_ms,
                admission,
            )
            .await?
        {
            CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => {
                Ok(CloudflareTenantRootCleanupPendingDecisionV1::Execute {
                    command: CloudflareTenantRootCleanupPendingCommandV1 {
                        scope,
                        reservation,
                        pending,
                        expected_revision,
                        operation_payload_digest,
                    },
                })
            }
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootCleanupPendingDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootCleanupPendingDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootCleanupPendingCommandV1 {
                        scope,
                        reservation,
                        pending,
                        expected_revision,
                        operation_payload_digest,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => {
                Ok(CloudflareTenantRootCleanupPendingDecisionV1::ResumeCompletion { executed })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => {
                Ok(CloudflareTenantRootCleanupPendingDecisionV1::ReplayCompleted { receipt_bytes })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(CloudflareTenantRootCleanupPendingDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            }),
        }
    }

    async fn reserve_cleanup_retired_with_payload_digest(
        &self,
        scope: TenantRootCommandScopeV1,
        retired: CloudflareStoredTenantRootRoleShareV1,
        expected_retired_revision: i64,
        expected_active_epoch: TenantRootShareEpoch,
        expected_active_revision: i64,
        reserved_at_ms: u64,
        operation_payload_digest: TenantRootProtocolDigestV1,
        admission: Option<TenantRootCommandAdmissionV1>,
    ) -> worker::Result<CloudflareTenantRootCleanupRetiredDecisionV1> {
        validate_retired_stored_record(&self.cipher, &retired)?;
        if expected_retired_revision != retired.revision {
            return Err(store_error(
                "tenant-root retired-cleanup command revision changed",
            ));
        }
        if expected_active_revision <= 0 {
            return Err(store_error(
                "tenant-root retired-cleanup command has an invalid active successor revision",
            ));
        }
        validate_command_scope_for_record(
            &scope,
            &retired.record,
            expected_retired_revision,
            "tenant-root retired cleanup",
        )?;
        let operation = TenantRootCommandOperationV1::cleanup_pending(operation_payload_digest);
        match self
            .reserve_scoped_command_with_admission_digest(
                scope,
                operation,
                reserved_at_ms,
                admission,
            )
            .await?
        {
            CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => {
                Ok(CloudflareTenantRootCleanupRetiredDecisionV1::Execute {
                    command: CloudflareTenantRootCleanupRetiredCommandV1 {
                        scope,
                        reservation,
                        retired,
                        expected_retired_revision,
                        expected_active_epoch,
                        expected_active_revision,
                        operation_payload_digest,
                    },
                })
            }
            CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                Ok(CloudflareTenantRootCleanupRetiredDecisionV1::InProgress)
            }
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => Ok(
                CloudflareTenantRootCleanupRetiredDecisionV1::ResumeExecution {
                    command: CloudflareTenantRootCleanupRetiredCommandV1 {
                        scope,
                        reservation,
                        retired,
                        expected_retired_revision,
                        expected_active_epoch,
                        expected_active_revision,
                        operation_payload_digest,
                    },
                },
            ),
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => {
                Ok(CloudflareTenantRootCleanupRetiredDecisionV1::ResumeCompletion { executed })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => {
                Ok(CloudflareTenantRootCleanupRetiredDecisionV1::ReplayCompleted { receipt_bytes })
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            } => Ok(CloudflareTenantRootCleanupRetiredDecisionV1::ReplayFailed {
                failure_receipt_bytes,
            }),
        }
    }

    async fn reserve_scoped_command(
        &self,
        scope: TenantRootCommandScopeV1,
        operation: TenantRootCommandOperationV1,
        reserved_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootCommandReplayDecisionV1> {
        self.reserve_scoped_command_with_admission_digest(scope, operation, reserved_at_ms, None)
            .await
    }

    async fn reserve_scoped_command_with_admission_digest(
        &self,
        scope: TenantRootCommandScopeV1,
        operation: TenantRootCommandOperationV1,
        reserved_at_ms: u64,
        admission: Option<TenantRootCommandAdmissionV1>,
    ) -> worker::Result<CloudflareTenantRootCommandReplayDecisionV1> {
        // Reservation commits before an executable command leaves this adapter.
        // Atomic reservation-plus-lifecycle mutation needs a D1 transaction path.
        let key = *scope.key();
        self.require_command_role(&key)?;
        let command_digest = scope
            .command_digest(operation)
            .map_err(|error| store_error(error.message()))?;
        let reservation =
            match reserve_tenant_root_command_v1(None, key, command_digest, reserved_at_ms)
                .map_err(|error| store_error(error.message()))?
            {
                TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
                _ => {
                    return Err(store_error(
                        "fresh tenant-root command reservation returned an invalid decision",
                    ));
                }
            };
        let replay_key_digest_hex = encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(key.identity_digest().as_bytes());
        let custody_lineage_b64u = key.custody_lineage().to_base64url();
        let session_id_hex = encode_hex(key.session_id().as_bytes());
        let nonce_hex = encode_hex(key.nonce().as_bytes());
        let command_digest_hex = encode_hex(command_digest.as_bytes());
        let admission_digest_hex = admission.map(|value| encode_hex(value.digest().as_bytes()));
        let reserved_at_ms_text = timestamp_i64(reserved_at_ms)?.to_string();
        let admission_digest_value = admission_digest_hex
            .as_deref()
            .map_or(D1Type::Null, D1Type::Text);
        let result = self
            .session
            .prepare(INSERT_COMMAND_RESERVATION_SQL)
            .bind_refs(
                [
                    D1Type::Text(replay_key_digest_hex.as_str()),
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(session_id_hex.as_str()),
                    D1Type::Text(nonce_hex.as_str()),
                    D1Type::Text(self.cipher.role.as_str()),
                    D1Type::Text(command_digest_hex.as_str()),
                    admission_digest_value,
                    D1Type::Text(reserved_at_ms_text.as_str()),
                ]
                .iter(),
            )?
            .run()
            .await?;
        match result_changes(&result)? {
            1 => Ok(CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation }),
            0 => {
                let stored = self
                    .load_command_replay(&key)
                    .await?
                    .ok_or_else(|| {
                        store_error(
                            "tenant-root command reservation conflict disappeared before reconciliation",
                        )
                    })?;
                match admission {
                    Some(TenantRootCommandAdmissionV1::InitialCreation(admission_digest)) => {
                        self.reconcile_initial_creation_retry(&stored, key, admission_digest)
                    }
                    Some(TenantRootCommandAdmissionV1::AuthorizedCleanup(admission_digest)) => self
                        .reconcile_authorized_cleanup_retry(
                            &stored,
                            key,
                            admission_digest,
                            Some(command_digest),
                        ),
                    None => self.reconcile_command_retry(&stored, key, command_digest),
                }
            }
            _ => Err(store_error(
                "tenant-root command reservation returned an invalid change count",
            )),
        }
    }

    /// Commits one exact successful signed public receipt for an executed command.
    async fn complete_command(
        &self,
        executed: ExecutedTenantRootCommandV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> worker::Result<CloudflareTenantRootCommandTerminalCommitV1> {
        self.commit_command_terminal(TenantRootCommandTerminalInputV1::Completed {
            executed,
            receipt,
        })
        .await
    }

    /// Commits the initial-creation receipt whose payload is the exact evidence wire.
    #[allow(dead_code)]
    pub(crate) async fn complete_initial_creation(
        &self,
        executed: CloudflareTenantRootInitialCreationExecutedCommandV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> worker::Result<CloudflareTenantRootCommandTerminalCommitV1> {
        let CloudflareTenantRootInitialCreationExecutedCommandV1 { executed, evidence } = executed;
        validate_initial_creation_success_receipt_payload(&evidence, &receipt)?;
        self.complete_command(executed, receipt).await
    }

    /// Commits an activation receipt whose payload is the exact issuer-signed
    /// activation receipt consumed by the lifecycle transition.
    pub(crate) async fn complete_activation(
        &self,
        executed: ExecutedTenantRootCommandV1,
        activation: &CloudflareTenantRootActivationV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> worker::Result<CloudflareTenantRootCommandTerminalCommitV1> {
        if receipt.payload_bytes() != activation.activation_receipt_bytes() {
            return Err(store_error(
                "tenant-root activation receipt payload does not match its exact activation receipt",
            ));
        }
        self.complete_command(executed, receipt).await
    }

    /// Commits a forward-refresh receipt bound to the exact activation receipt.
    pub(crate) async fn complete_managed_restore_forward_refresh(
        &self,
        executed: ExecutedTenantRootCommandV1,
        activation: &CloudflareTenantRootActivationV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> worker::Result<CloudflareTenantRootCommandTerminalCommitV1> {
        if receipt.payload_bytes() != activation.activation_receipt_bytes() {
            return Err(store_error(
                "managed-restore forward-refresh receipt payload does not match its exact activation receipt",
            ));
        }
        self.complete_command(executed, receipt).await
    }

    /// Commits one exact signed public failure receipt for a reserved command.
    async fn fail_command(
        &self,
        reservation: ReservedTenantRootCommandV1,
        receipt: VerifiedTenantRootCommandFailureReceiptV1,
    ) -> worker::Result<CloudflareTenantRootCommandTerminalCommitV1> {
        self.commit_command_terminal(TenantRootCommandTerminalInputV1::Failed {
            reservation,
            receipt,
        })
        .await
    }

    /// Activates epoch 1 only when this role has no active epoch for the root.
    pub(crate) async fn activate_initial_pending(
        &self,
        command: CloudflareTenantRootActivateInitialPendingCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<(
        CloudflareStoredTenantRootRoleShareV1,
        ExecutedTenantRootCommandV1,
    )> {
        let CloudflareTenantRootActivateInitialPendingCommandV1 {
            scope,
            pending,
            reservation,
            activation,
            updated_at_ms,
            expected_revision,
        } = command;
        validate_pending_stored_record(&self.cipher, &pending)?;
        if pending.record.epoch != TenantRootShareEpoch::INITIAL {
            return Err(store_error(
                "tenant-root initial activation requires epoch 1",
            ));
        }
        if expected_revision != pending.revision {
            return Err(store_error(
                "tenant-root initial activation command revision changed",
            ));
        }
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_revision,
            "tenant-root initial activation",
        )?;
        let operation =
            TenantRootCommandOperationV1::activate_initial(activate_initial_payload_digest(
                &pending,
                &activation,
                updated_at_ms,
                expected_revision,
            )?);
        validate_reserved_command(
            &scope,
            &reservation,
            operation,
            "tenant-root initial activation",
        )?;
        let revision = next_revision(expected_revision)?;
        let record = pending.record.into_active(activation, updated_at_ms)?;
        let metadata = record_metadata(&record)?;
        let ciphertext_json = self.cipher.seal(&record, revision)?;
        let epoch = metadata.epoch.to_string();
        let updated_at_ms = record.updated_at_ms.to_string();
        let expected_revision_text = expected_revision.to_string();
        let lifecycle_statement = self
            .session
            .prepare(ACTIVATE_INITIAL_PENDING_SQL)
            .bind_refs(
                [
                    D1Type::Text(ciphertext_json.as_str()),
                    D1Type::Text(updated_at_ms.as_str()),
                    D1Type::Text(metadata.identity_digest_hex.as_str()),
                    D1Type::Text(metadata.custody_lineage_b64u.as_str()),
                    D1Type::Text(epoch.as_str()),
                    D1Type::Text(metadata.role.as_str()),
                    D1Type::Text(expected_revision_text.as_str()),
                ]
                .iter(),
            )?;
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        let executed = self
            .run_lifecycle_checkpoint(
                lifecycle_statement,
                1,
                checkpoint_statement,
                reservation,
                executed_at_ms,
            )
            .await?;
        Ok((
            CloudflareStoredTenantRootRoleShareV1 { record, revision },
            executed,
        ))
    }

    /// Atomically retires one active epoch and activates its exact next pending epoch.
    ///
    /// The returned pair contains the retired row first and the newly active row second.
    pub(crate) async fn swap_active_epoch(
        &self,
        command: CloudflareTenantRootSwapActiveEpochCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<(
        (
            CloudflareStoredTenantRootRoleShareV1,
            CloudflareStoredTenantRootRoleShareV1,
        ),
        ExecutedTenantRootCommandV1,
    )> {
        let CloudflareTenantRootSwapActiveEpochCommandV1 {
            scope,
            reservation,
            active,
            pending,
            activation,
            retirement,
            updated_at_ms,
            expected_active_revision,
            expected_pending_revision,
        } = command;
        validate_active_stored_record(&self.cipher, &active)?;
        validate_pending_stored_record(&self.cipher, &pending)?;
        validate_epoch_swap_inputs(&active, &pending)?;
        validate_activation_receipt_against_swap_records(&activation, &active, &pending)?;
        if expected_active_revision != active.revision
            || expected_pending_revision != pending.revision
        {
            return Err(store_error(
                "tenant-root epoch-swap command revision changed",
            ));
        }
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_pending_revision,
            "tenant-root epoch swap",
        )?;
        let operation =
            TenantRootCommandOperationV1::swap_active_epoch(swap_active_epoch_payload_digest(
                &active,
                &pending,
                &activation,
                &retirement,
                updated_at_ms,
                expected_active_revision,
                expected_pending_revision,
            )?);
        validate_reserved_command(&scope, &reservation, operation, "tenant-root epoch swap")?;
        let retired_revision = next_revision(expected_active_revision)?;
        let activated_revision = next_revision(expected_pending_revision)?;
        let retired_record = active.record.into_retired(retirement, updated_at_ms)?;
        let activated_record = pending.record.into_active(activation, updated_at_ms)?;
        let retired_metadata = record_metadata(&retired_record)?;
        let activated_metadata = record_metadata(&activated_record)?;
        if retired_metadata.identity_digest_hex != activated_metadata.identity_digest_hex
            || retired_metadata.custody_lineage_b64u != activated_metadata.custody_lineage_b64u
            || retired_metadata.role != activated_metadata.role
        {
            return Err(store_error(
                "tenant-root epoch swap metadata changed during transition",
            ));
        }
        let current_epoch = retired_metadata.epoch.to_string();
        let next_epoch = activated_metadata.epoch.to_string();
        let current_revision = active.revision.to_string();
        let next_revision = pending.revision.to_string();
        let updated_at_ms = timestamp_i64(updated_at_ms)?.to_string();
        let retired_ciphertext_json = self.cipher.seal(&retired_record, retired_revision)?;
        let activated_ciphertext_json = self.cipher.seal(&activated_record, activated_revision)?;
        // The WHERE clause requires both CAS rows before this single UPDATE can match either.
        let lifecycle_statement = self.session.prepare(SWAP_ACTIVE_EPOCH_SQL).bind_refs(
            [
                D1Type::Text(retired_metadata.identity_digest_hex.as_str()),
                D1Type::Text(retired_metadata.custody_lineage_b64u.as_str()),
                D1Type::Text(current_epoch.as_str()),
                D1Type::Text(retired_metadata.role.as_str()),
                D1Type::Text(current_revision.as_str()),
                D1Type::Text(next_epoch.as_str()),
                D1Type::Text(next_revision.as_str()),
                D1Type::Text(retired_ciphertext_json.as_str()),
                D1Type::Text(activated_ciphertext_json.as_str()),
                D1Type::Text(updated_at_ms.as_str()),
            ]
            .iter(),
        )?;
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        let executed = self
            .run_lifecycle_checkpoint(
                lifecycle_statement,
                2,
                checkpoint_statement,
                reservation,
                executed_at_ms,
            )
            .await?;
        Ok((
            (
                CloudflareStoredTenantRootRoleShareV1 {
                    record: retired_record,
                    revision: retired_revision,
                },
                CloudflareStoredTenantRootRoleShareV1 {
                    record: activated_record,
                    revision: activated_revision,
                },
            ),
            executed,
        ))
    }

    /// Removes one exact pending revision after a failed pre-activation attempt.
    pub(crate) async fn cleanup_pending(
        &self,
        command: CloudflareTenantRootCleanupPendingCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<ExecutedTenantRootCommandV1> {
        let CloudflareTenantRootCleanupPendingCommandV1 {
            scope,
            reservation,
            pending,
            expected_revision,
            operation_payload_digest,
        } = command;
        validate_pending_stored_record(&self.cipher, &pending)?;
        if expected_revision != pending.revision {
            return Err(store_error(
                "tenant-root pending-cleanup command revision changed",
            ));
        }
        validate_command_scope_for_record(
            &scope,
            &pending.record,
            expected_revision,
            "tenant-root pending cleanup",
        )?;
        let operation = TenantRootCommandOperationV1::cleanup_pending(operation_payload_digest);
        validate_reserved_command(
            &scope,
            &reservation,
            operation,
            "tenant-root pending cleanup",
        )?;
        let metadata = record_metadata(&pending.record)?;
        let epoch = metadata.epoch.to_string();
        let revision = expected_revision.to_string();
        let lifecycle_statement = self.session.prepare(CLEANUP_PENDING_SQL).bind_refs(
            [
                D1Type::Text(metadata.identity_digest_hex.as_str()),
                D1Type::Text(metadata.custody_lineage_b64u.as_str()),
                D1Type::Text(epoch.as_str()),
                D1Type::Text(metadata.role.as_str()),
                D1Type::Text(revision.as_str()),
            ]
            .iter(),
        )?;
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        self.run_lifecycle_checkpoint(
            lifecycle_statement,
            1,
            checkpoint_statement,
            reservation,
            executed_at_ms,
        )
        .await
    }

    /// Removes one exact retired revision while its expected active successor
    /// still exists at the bound revision.
    pub(crate) async fn cleanup_retired(
        &self,
        command: CloudflareTenantRootCleanupRetiredCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<ExecutedTenantRootCommandV1> {
        let CloudflareTenantRootCleanupRetiredCommandV1 {
            scope,
            reservation,
            retired,
            expected_retired_revision,
            expected_active_epoch,
            expected_active_revision,
            operation_payload_digest,
        } = command;
        validate_retired_stored_record(&self.cipher, &retired)?;
        if expected_retired_revision != retired.revision {
            return Err(store_error(
                "tenant-root retired-cleanup command revision changed",
            ));
        }
        if expected_active_revision <= 0 {
            return Err(store_error(
                "tenant-root retired-cleanup command has an invalid active successor revision",
            ));
        }
        validate_command_scope_for_record(
            &scope,
            &retired.record,
            expected_retired_revision,
            "tenant-root retired cleanup",
        )?;
        let operation = TenantRootCommandOperationV1::cleanup_pending(operation_payload_digest);
        validate_reserved_command(
            &scope,
            &reservation,
            operation,
            "tenant-root retired cleanup",
        )?;
        let metadata = record_metadata(&retired.record)?;
        let retired_epoch = metadata.epoch.to_string();
        let retired_revision = expected_retired_revision.to_string();
        let active_epoch = epoch_i64(expected_active_epoch)?.to_string();
        let active_revision = expected_active_revision.to_string();
        let lifecycle_statement = self.session.prepare(CLEANUP_RETIRED_SQL).bind_refs(
            [
                D1Type::Text(metadata.identity_digest_hex.as_str()),
                D1Type::Text(metadata.custody_lineage_b64u.as_str()),
                D1Type::Text(retired_epoch.as_str()),
                D1Type::Text(metadata.role.as_str()),
                D1Type::Text(retired_revision.as_str()),
                D1Type::Text(active_epoch.as_str()),
                D1Type::Text(active_revision.as_str()),
            ]
            .iter(),
        )?;
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        self.run_lifecycle_checkpoint(
            lifecycle_statement,
            1,
            checkpoint_statement,
            reservation,
            executed_at_ms,
        )
        .await
    }

    pub(crate) async fn execute_authorized_cleanup(
        &self,
        command: CloudflareTenantRootAuthorizedCleanupCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<CloudflareTenantRootAuthorizedCleanupExecutedCommandV1> {
        let (executed, authorization) = match command {
            CloudflareTenantRootAuthorizedCleanupCommandV1::Pending(command) => {
                let CloudflareTenantRootAuthorizedCleanupPendingCommandV1 {
                    command,
                    authorization,
                } = command;
                (
                    self.cleanup_pending(command, executed_at_ms).await?,
                    authorization,
                )
            }
            CloudflareTenantRootAuthorizedCleanupCommandV1::Retired(command) => {
                let CloudflareTenantRootAuthorizedCleanupRetiredCommandV1 {
                    command,
                    authorization,
                } = command;
                (
                    self.cleanup_retired(command, executed_at_ms).await?,
                    authorization,
                )
            }
        };
        Ok(CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
            executed,
            authorization,
        })
    }

    pub(crate) async fn complete_authorized_cleanup(
        &self,
        executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1,
        receipt: VerifiedTenantRootCommandSuccessReceiptV1,
    ) -> worker::Result<CloudflareTenantRootCommandTerminalCommitV1> {
        let CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
            executed,
            authorization,
        } = executed;
        let authorization_bytes = authorization
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?;
        if receipt.payload_bytes() != authorization_bytes {
            return Err(store_error(
                "tenant-root cleanup receipt payload does not match its exact authorization",
            ));
        }
        self.complete_command(executed, receipt).await
    }

    fn command_execution_checkpoint_statement(
        &self,
        reservation: &ReservedTenantRootCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<worker::D1PreparedStatement> {
        self.require_command_role(reservation.key())?;
        let key = reservation.key();
        let replay_key_digest_hex = encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(key.identity_digest().as_bytes());
        let custody_lineage_b64u = key.custody_lineage().to_base64url();
        let session_id_hex = encode_hex(key.session_id().as_bytes());
        let nonce_hex = encode_hex(key.nonce().as_bytes());
        let command_digest_hex = encode_hex(reservation.command_digest().as_bytes());
        let reserved_at_ms = timestamp_i64(reservation.reserved_at_ms())?.to_string();
        let executed_at_ms = timestamp_i64(executed_at_ms)?.to_string();
        self.session.prepare(MARK_COMMAND_EXECUTED_SQL).bind_refs(
            [
                D1Type::Text(replay_key_digest_hex.as_str()),
                D1Type::Text(identity_digest_hex.as_str()),
                D1Type::Text(custody_lineage_b64u.as_str()),
                D1Type::Text(session_id_hex.as_str()),
                D1Type::Text(nonce_hex.as_str()),
                D1Type::Text(key.role().as_str()),
                D1Type::Text(command_digest_hex.as_str()),
                D1Type::Text(reserved_at_ms.as_str()),
                D1Type::Text(executed_at_ms.as_str()),
            ]
            .iter(),
        )
    }

    fn command_cas_count_guard_statement(
        &self,
        expected_changes: usize,
    ) -> worker::Result<worker::D1PreparedStatement> {
        let expected_changes = expected_changes.to_string();
        self.session
            .prepare(CAS_COUNT_GUARD_SQL)
            .bind_refs([D1Type::Text(expected_changes.as_str())].iter())
    }

    async fn run_lifecycle_checkpoint(
        &self,
        lifecycle_statement: worker::D1PreparedStatement,
        expected_lifecycle_changes: usize,
        checkpoint_statement: worker::D1PreparedStatement,
        reservation: ReservedTenantRootCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<ExecutedTenantRootCommandV1> {
        if executed_at_ms < reservation.reserved_at_ms() {
            return Err(store_error(
                "tenant-root command execution checkpoint precedes its reservation",
            ));
        }
        let lifecycle_guard = self.command_cas_count_guard_statement(expected_lifecycle_changes)?;
        let checkpoint_guard = self.command_cas_count_guard_statement(1)?;
        let results = self
            .session
            .batch(vec![
                lifecycle_statement,
                lifecycle_guard,
                checkpoint_statement,
                checkpoint_guard,
            ])
            .await?;
        if results.len() != 4 {
            return Err(store_error(
                "tenant-root lifecycle checkpoint returned an invalid result count",
            ));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "tenant-root lifecycle checkpoint statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown D1 error".to_owned())
                )));
            }
        }
        require_changes(
            &results[0],
            expected_lifecycle_changes,
            "tenant-root lifecycle changed concurrently",
        )?;
        require_changes(
            &results[1],
            0,
            "tenant-root lifecycle count guard returned an invalid change count",
        )?;
        require_one_change(
            &results[2],
            "tenant-root command execution checkpoint changed concurrently",
        )?;
        require_changes(
            &results[3],
            0,
            "tenant-root command checkpoint count guard returned an invalid change count",
        )?;
        reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))
    }

    async fn checkpoint_command_without_lifecycle(
        &self,
        reservation: ReservedTenantRootCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<ExecutedTenantRootCommandV1> {
        if executed_at_ms < reservation.reserved_at_ms() {
            return Err(store_error(
                "tenant-root command execution checkpoint precedes its reservation",
            ));
        }
        let checkpoint_statement =
            self.command_execution_checkpoint_statement(&reservation, executed_at_ms)?;
        let checkpoint_guard = self.command_cas_count_guard_statement(1)?;
        let results = self
            .session
            .batch(vec![checkpoint_statement, checkpoint_guard])
            .await?;
        if results.len() != 2 {
            return Err(store_error(
                "tenant-root command-only checkpoint returned an invalid result count",
            ));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "tenant-root command-only checkpoint statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown D1 error".to_owned())
                )));
            }
        }
        require_one_change(
            &results[0],
            "tenant-root command execution checkpoint changed concurrently",
        )?;
        require_changes(
            &results[1],
            0,
            "tenant-root command checkpoint count guard returned an invalid change count",
        )?;
        reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))
    }

    async fn run_managed_restore_forward_refresh_checkpoint(
        &self,
        delete_statement: worker::D1PreparedStatement,
        activate_statement: worker::D1PreparedStatement,
        checkpoint_statement: worker::D1PreparedStatement,
        reservation: ReservedTenantRootCommandV1,
        executed_at_ms: u64,
    ) -> worker::Result<ExecutedTenantRootCommandV1> {
        if executed_at_ms < reservation.reserved_at_ms() {
            return Err(store_error(
                "tenant-root command execution checkpoint precedes its reservation",
            ));
        }
        let delete_guard = self.command_cas_count_guard_statement(1)?;
        let activate_guard = self.command_cas_count_guard_statement(1)?;
        let checkpoint_guard = self.command_cas_count_guard_statement(1)?;
        let results = self
            .session
            .batch(vec![
                delete_statement,
                delete_guard,
                activate_statement,
                activate_guard,
                checkpoint_statement,
                checkpoint_guard,
            ])
            .await?;
        if results.len() != 6 {
            return Err(store_error(
                "managed-restore forward-refresh checkpoint returned an invalid result count",
            ));
        }
        for result in &results {
            if !result.success() {
                return Err(store_error(format!(
                    "managed-restore forward-refresh checkpoint statement failed: {}",
                    result
                        .error()
                        .unwrap_or_else(|| "unknown D1 error".to_owned())
                )));
            }
        }
        require_one_change(
            &results[0],
            "managed-restore forward-refresh source changed concurrently",
        )?;
        require_changes(
            &results[1],
            0,
            "managed-restore forward-refresh source count guard returned an invalid change count",
        )?;
        require_one_change(
            &results[2],
            "managed-restore forward-refresh successor changed concurrently",
        )?;
        require_changes(
            &results[3],
            0,
            "managed-restore forward-refresh successor count guard returned an invalid change count",
        )?;
        require_one_change(
            &results[4],
            "managed-restore forward-refresh execution checkpoint changed concurrently",
        )?;
        require_changes(
            &results[5],
            0,
            "managed-restore forward-refresh checkpoint count guard returned an invalid change count",
        )?;
        reservation
            .checkpoint_executed(executed_at_ms)
            .map_err(|error| store_error(error.message()))
    }

    fn open_row(
        &self,
        row: Option<TenantRootRoleD1RowV1>,
    ) -> Pin<
        Box<
            dyn Future<Output = worker::Result<Option<CloudflareStoredTenantRootRoleShareV1>>> + '_,
        >,
    > {
        // Keep authenticated receipt decoding in a heap-backed future; the
        // Workers WASM stack is too small for the complete encrypted row path.
        Box::pin(async move {
            let Some(row) = row else {
                return Ok(None);
            };
            if row.revision <= 0 {
                return Err(store_error(
                    "tenant-root role-private row has an invalid revision",
                ));
            }
            let revision = row.revision;
            let record = self.cipher.open(&row)?;
            Ok(Some(CloudflareStoredTenantRootRoleShareV1 {
                record,
                revision,
            }))
        })
    }

    async fn commit_command_terminal(
        &self,
        input: TenantRootCommandTerminalInputV1,
    ) -> worker::Result<CloudflareTenantRootCommandTerminalCommitV1> {
        let TenantRootCommandTerminalCommitDataV1 {
            key,
            command_digest,
            reserved_at_ms,
            executed_at_ms,
            receipt_bytes,
            receipt_digest,
            terminal_at_ms,
            terminal_kind,
        } = input.into_commit_data()?;
        self.require_command_role(&key)?;
        let replay_key_digest_hex = encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        );
        let identity_digest_hex = encode_hex(key.identity_digest().as_bytes());
        let custody_lineage_b64u = key.custody_lineage().to_base64url();
        let session_id_hex = encode_hex(key.session_id().as_bytes());
        let nonce_hex = encode_hex(key.nonce().as_bytes());
        let command_digest_hex = encode_hex(command_digest.as_bytes());
        let receipt_b64u = encode_base64url_bytes_v1(&receipt_bytes);
        let receipt_digest_hex = encode_hex(receipt_digest.as_bytes());
        let terminal_at_ms_text = timestamp_i64(terminal_at_ms)?.to_string();
        let reserved_at_ms_text = timestamp_i64(reserved_at_ms)?.to_string();
        let executed_at_ms_text = timestamp_i64(executed_at_ms.unwrap_or_default())?.to_string();
        let result = self
            .session
            .prepare(COMMIT_COMMAND_TERMINAL_SQL)
            .bind_refs(
                [
                    D1Type::Text(terminal_kind.as_str()),
                    D1Type::Text(receipt_b64u.as_str()),
                    D1Type::Text(receipt_digest_hex.as_str()),
                    D1Type::Text(terminal_at_ms_text.as_str()),
                    D1Type::Text(replay_key_digest_hex.as_str()),
                    D1Type::Text(identity_digest_hex.as_str()),
                    D1Type::Text(custody_lineage_b64u.as_str()),
                    D1Type::Text(session_id_hex.as_str()),
                    D1Type::Text(nonce_hex.as_str()),
                    D1Type::Text(self.cipher.role.as_str()),
                    D1Type::Text(command_digest_hex.as_str()),
                    D1Type::Text(reserved_at_ms_text.as_str()),
                    D1Type::Text(terminal_kind.expected_status()),
                    D1Type::Text(executed_at_ms_text.as_str()),
                ]
                .iter(),
            )?
            .run()
            .await?;
        match result_changes(&result)? {
            1 => Ok(CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes }),
            0 => {
                let stored = self.load_command_replay(&key).await?.ok_or_else(|| {
                    store_error(
                        "tenant-root terminal command conflict has no durable replay record",
                    )
                })?;
                let decision = reserve_tenant_root_command_v1(
                    Some(&stored.record),
                    key,
                    command_digest,
                    reserved_at_ms,
                )
                .map_err(|error| store_error(error.message()))?;
                let matches_terminal_kind = matches!(
                    (terminal_kind, decision),
                    (
                        TenantRootCommandTerminalKindV1::Completed,
                        TenantRootCommandReplayDecisionV1::ReplayCompleted { .. }
                    ) | (
                        TenantRootCommandTerminalKindV1::Failed,
                        TenantRootCommandReplayDecisionV1::ReplayFailed { .. }
                    )
                );
                let stored_receipt = stored.receipt_bytes.ok_or_else(|| {
                    store_error("tenant-root terminal replay omitted its exact receipt bytes")
                })?;
                if !matches_terminal_kind || stored_receipt != receipt_bytes {
                    return Err(store_error(
                        "tenant-root command terminal receipt conflicts with durable state",
                    ));
                }
                Ok(CloudflareTenantRootCommandTerminalCommitV1::Replay {
                    receipt_bytes: stored_receipt,
                })
            }
            _ => Err(store_error(
                "tenant-root command terminal commit returned an invalid change count",
            )),
        }
    }

    async fn load_command_replay(
        &self,
        key: &TenantRootCommandReplayKeyV1,
    ) -> worker::Result<Option<StoredTenantRootCommandReplayV1>> {
        self.require_command_role(key)?;
        let replay_key_digest = key
            .storage_key_digest()
            .map_err(|error| store_error(error.message()))?;
        self.load_command_replay_by_storage_key_digest(replay_key_digest)
            .await
    }

    async fn load_command_replay_by_storage_key_digest(
        &self,
        replay_key_digest: TenantRootProtocolDigestV1,
    ) -> worker::Result<Option<StoredTenantRootCommandReplayV1>> {
        let replay_key_digest_hex = encode_hex(replay_key_digest.as_bytes());
        let row = self
            .session
            .prepare(LOAD_COMMAND_REPLAY_SQL)
            .bind_refs(
                [
                    D1Type::Text(replay_key_digest_hex.as_str()),
                    D1Type::Text(self.cipher.role.as_str()),
                ]
                .iter(),
            )?
            .first::<TenantRootCommandReplayD1RowV1>(None)
            .await?;
        row.map(|row| self.open_command_replay_row(row)).transpose()
    }

    fn open_command_replay_row(
        &self,
        row: TenantRootCommandReplayD1RowV1,
    ) -> worker::Result<StoredTenantRootCommandReplayV1> {
        if row.role != self.cipher.role.as_str() {
            return Err(store_error(
                "tenant-root command replay row belongs to the other Deriver",
            ));
        }
        let identity_digest = TenantRootIdentityDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
            "tenant-root command identity digest",
            &row.tenant_identity_digest_hex,
        )?);
        let custody_lineage = TenantRootCustodyLineageId::from_base64url(&row.custody_lineage_b64u)
            .map_err(|error| store_error(error.message()))?;
        let session_id = TenantRootCeremonySessionIdV1::from_bytes(decode_lower_hex_fixed::<16>(
            "tenant-root command session id",
            &row.session_id_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
        let nonce = TenantRootCeremonyNonceV1::from_bytes(decode_lower_hex_fixed::<32>(
            "tenant-root command nonce",
            &row.nonce_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
        let key = match self.cipher.role {
            CloudflareTenantRootDeriverRoleV1::DeriverA => TenantRootCommandReplayKeyV1::deriver_a(
                identity_digest,
                custody_lineage,
                session_id,
                nonce,
            ),
            CloudflareTenantRootDeriverRoleV1::DeriverB => TenantRootCommandReplayKeyV1::deriver_b(
                identity_digest,
                custody_lineage,
                session_id,
                nonce,
            ),
        };
        if encode_hex(
            key.storage_key_digest()
                .map_err(|error| store_error(error.message()))?
                .as_bytes(),
        ) != row.replay_key_digest_hex
        {
            return Err(store_error(
                "tenant-root command replay lookup digest does not match its row",
            ));
        }
        let command_digest = TenantRootProtocolDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
            "tenant-root command payload digest",
            &row.command_digest_hex,
        )?)
        .map_err(|error| store_error(error.message()))?;
        let admission_digest = row
            .admission_digest_hex
            .as_deref()
            .map(|value| {
                TenantRootProtocolDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
                    "tenant-root command admission digest",
                    value,
                )?)
                .map_err(|error| store_error(error.message()))
            })
            .transpose()?;
        let refresh_state = match (
            row.refresh_state_b64u.as_deref(),
            row.refresh_state_digest_hex.as_deref(),
        ) {
            (None, None) => None,
            (Some(state_b64u), Some(state_digest_hex)) => {
                let state = decode_refresh_durable_state(state_b64u, state_digest_hex)?;
                if admission_digest.is_none() {
                    return Err(store_error(
                        "tenant-root refresh durable state omitted its admission digest",
                    ));
                }
                let command_bytes = state.command_bytes()?;
                let command_digest: [u8; 32] = Sha256::digest(&command_bytes).into();
                if admission_digest
                    != Some(
                        TenantRootProtocolDigestV1::from_bytes(command_digest)
                            .map_err(|error| store_error(error.message()))?,
                    )
                {
                    return Err(store_error(
                        "tenant-root refresh durable command does not match its admission digest",
                    ));
                }
                if !state.kind_matches_status(&row.status) {
                    return Err(store_error(
                        "tenant-root refresh durable state does not match replay status",
                    ));
                }
                Some(state)
            }
            _ => {
                return Err(store_error(
                    "tenant-root refresh durable state columns must be written together",
                ));
            }
        };
        let reserved_at_ms = positive_u64_from_i64(
            "tenant-root command reservation timestamp",
            row.reserved_at_ms,
        )?;
        let reservation =
            match reserve_tenant_root_command_v1(None, key, command_digest, reserved_at_ms)
                .map_err(|error| store_error(error.message()))?
            {
                TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
                _ => {
                    return Err(store_error(
                        "persisted tenant-root command could not reconstruct its reservation",
                    ));
                }
            };
        let (record, receipt_bytes, executed_at_ms) = match row.status.as_str() {
            "reserved"
                if row.receipt_b64u.is_none()
                    && row.receipt_digest_hex.is_none()
                    && row.executed_at_ms.is_none()
                    && row.terminal_at_ms.is_none() =>
            {
                (
                    TenantRootCommandReplayRecordV1::Reserved(reservation),
                    None,
                    None,
                )
            }
            "executed"
                if row.receipt_b64u.is_none()
                    && row.receipt_digest_hex.is_none()
                    && row.terminal_at_ms.is_none() =>
            {
                let executed_at_ms = positive_u64_from_i64(
                    "tenant-root command execution timestamp",
                    row.executed_at_ms.ok_or_else(|| {
                        store_error("executed tenant-root command row omitted execution timestamp")
                    })?,
                )?;
                let executed = reservation
                    .checkpoint_executed(executed_at_ms)
                    .map_err(|error| store_error(error.message()))?;
                (
                    TenantRootCommandReplayRecordV1::Executed(executed),
                    None,
                    Some(executed_at_ms),
                )
            }
            "completed" => {
                let terminal_receipt = decode_stored_terminal_receipt(
                    TenantRootCommandTerminalKindV1::Completed,
                    row.receipt_b64u.as_deref(),
                    row.receipt_digest_hex.as_deref(),
                    row.terminal_at_ms,
                    key,
                    command_digest,
                )?;
                let executed_at_ms = positive_u64_from_i64(
                    "tenant-root command execution timestamp",
                    row.executed_at_ms.ok_or_else(|| {
                        store_error("completed tenant-root command row omitted execution timestamp")
                    })?,
                )?;
                let executed = reservation
                    .checkpoint_executed(executed_at_ms)
                    .map_err(|error| store_error(error.message()))?;
                let record = executed
                    .complete(
                        terminal_receipt.receipt_digest,
                        terminal_receipt.terminal_at_ms,
                    )
                    .map_err(|error| store_error(error.message()))?;
                (
                    record,
                    Some(terminal_receipt.receipt_bytes),
                    Some(executed_at_ms),
                )
            }
            "failed" if row.executed_at_ms.is_none() => {
                let terminal_receipt = decode_stored_terminal_receipt(
                    TenantRootCommandTerminalKindV1::Failed,
                    row.receipt_b64u.as_deref(),
                    row.receipt_digest_hex.as_deref(),
                    row.terminal_at_ms,
                    key,
                    command_digest,
                )?;
                let record = reservation
                    .fail(
                        terminal_receipt.receipt_digest,
                        terminal_receipt.terminal_at_ms,
                    )
                    .map_err(|error| store_error(error.message()))?;
                (record, Some(terminal_receipt.receipt_bytes), None)
            }
            _ => {
                return Err(store_error(
                    "tenant-root command replay row has an invalid lifecycle shape",
                ));
            }
        };
        Ok(StoredTenantRootCommandReplayV1 {
            record,
            admission_digest,
            refresh_state,
            receipt_bytes,
            reserved_at_ms,
            executed_at_ms,
        })
    }

    fn reconcile_command_retry(
        &self,
        stored: &StoredTenantRootCommandReplayV1,
        key: TenantRootCommandReplayKeyV1,
        command_digest: TenantRootProtocolDigestV1,
    ) -> worker::Result<CloudflareTenantRootCommandReplayDecisionV1> {
        match reserve_tenant_root_command_v1(
            Some(&stored.record),
            key,
            command_digest,
            stored.reserved_at_ms,
        )
        .map_err(|error| store_error(error.message()))?
        {
            TenantRootCommandReplayDecisionV1::Execute(_) => Err(store_error(
                "durable tenant-root command replay returned a fresh execution",
            )),
            TenantRootCommandReplayDecisionV1::InProgress => match &stored.record {
                TenantRootCommandReplayRecordV1::Reserved(_) => Ok(
                    CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution {
                        reservation: replay_reservation_from_stored(stored)?,
                    },
                ),
                TenantRootCommandReplayRecordV1::Executed(_) => Ok(
                    CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion {
                        executed: replay_executed_from_stored(stored)?,
                    },
                ),
                _ => Err(store_error(
                    "tenant-root command replay reported in-progress for a terminal row",
                )),
            },
            TenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_digest } => {
                let receipt_bytes = stored.receipt_bytes.clone().ok_or_else(|| {
                    store_error("completed tenant-root command omitted prior receipt bytes")
                })?;
                require_receipt_digest(&receipt_bytes, receipt_digest)?;
                Ok(CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes })
            }
            TenantRootCommandReplayDecisionV1::ReplayFailed {
                failure_receipt_digest,
            } => {
                let failure_receipt_bytes = stored.receipt_bytes.clone().ok_or_else(|| {
                    store_error("failed tenant-root command omitted prior receipt bytes")
                })?;
                require_receipt_digest(&failure_receipt_bytes, failure_receipt_digest)?;
                Ok(CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
                    failure_receipt_bytes,
                })
            }
        }
    }

    fn reconcile_initial_creation_retry(
        &self,
        stored: &StoredTenantRootCommandReplayV1,
        key: TenantRootCommandReplayKeyV1,
        creation_admission_digest: TenantRootProtocolDigestV1,
    ) -> worker::Result<CloudflareTenantRootCommandReplayDecisionV1> {
        if stored.admission_digest != Some(creation_admission_digest) {
            return Err(store_error(
                "tenant-root creation session was reused with different issuer-authorized bytes",
            ));
        }
        match self.reconcile_command_retry(stored, key, stored.record.command_digest())? {
            CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { .. }
            | CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { .. } => {
                Ok(CloudflareTenantRootCommandReplayDecisionV1::InProgress)
            }
            decision => Ok(decision),
        }
    }

    fn reconcile_authorized_cleanup_retry(
        &self,
        stored: &StoredTenantRootCommandReplayV1,
        key: TenantRootCommandReplayKeyV1,
        authorization_digest: TenantRootProtocolDigestV1,
        expected_command_digest: Option<TenantRootProtocolDigestV1>,
    ) -> worker::Result<CloudflareTenantRootCommandReplayDecisionV1> {
        if stored.admission_digest != Some(authorization_digest) {
            return Err(store_error(
                "tenant-root cleanup session was reused with different authorization bytes",
            ));
        }
        if expected_command_digest
            .is_some_and(|expected| stored.record.command_digest() != expected)
        {
            return Err(store_error(
                "tenant-root cleanup session was reused after the pending row changed",
            ));
        }
        self.reconcile_command_retry(stored, key, stored.record.command_digest())
    }

    fn require_command_role(&self, key: &TenantRootCommandReplayKeyV1) -> worker::Result<()> {
        if key.role().as_str() != self.cipher.role.as_str() {
            return Err(store_error(
                "tenant-root command replay key belongs to the other Deriver",
            ));
        }
        Ok(())
    }
}

#[cfg(debug_assertions)]
fn run_cloudflare_tenant_root_role_d1_lifecycle_integration_v1(
    env: &Env,
) -> Pin<
    Box<dyn Future<Output = worker::Result<CloudflareTenantRootRoleD1IntegrationReceiptV1>> + '_>,
> {
    // This debug-only probe holds many encrypted rows across awaits. Heap-boxing
    // the future keeps its large state frame off the Workers stack.
    Box::pin(run_cloudflare_tenant_root_role_d1_lifecycle_integration_body_v1(env))
}

#[cfg(debug_assertions)]
async fn run_cloudflare_tenant_root_role_d1_lifecycle_integration_body_v1(
    env: &Env,
) -> worker::Result<CloudflareTenantRootRoleD1IntegrationReceiptV1> {
    let store = CloudflareTenantRootRoleShareStoreV1::from_env(env)?;
    let role = store.cipher.role;
    let other_role = match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverB,
        CloudflareTenantRootDeriverRoleV1::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverA,
    };

    let wrong_role = tenant_root_role_d1_integration_pending_record(other_role, 8, 8, 10)?;
    let wrong_role_scope = tenant_root_role_d1_integration_scope(&wrong_role, 0x01, 0x01, 1)?;
    require_integration_failure(
        store
            .reserve_insert_pending(wrong_role_scope, wrong_role, 10)
            .await,
        "role-private D1 accepted the other Deriver's share",
    )?;

    let non_initial_record = tenant_root_role_d1_integration_pending_record(role, 2, 2, 10)?;
    let non_initial_scope =
        tenant_root_role_d1_integration_scope(&non_initial_record, 0x02, 0x02, 1)?;
    let non_initial_command = match store
        .reserve_insert_pending(non_initial_scope, non_initial_record, 11)
        .await?
    {
        CloudflareTenantRootInsertPendingDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh non-initial insertion did not return an executable command",
            ));
        }
    };
    let (non_initial, _) = store.insert_pending(non_initial_command, 11).await?;
    require_integration_failure(
        store
            .reserve_activate_initial_pending(
                tenant_root_role_d1_integration_scope(&non_initial.record, 0x03, 0x03, 1)?,
                non_initial.clone(),
                tenant_root_role_d1_integration_activation(&non_initial.record, 20)?,
                20,
                12,
            )
            .await,
        "role-private D1 reserved a non-initial epoch as epoch one",
    )?;
    let non_initial_cleanup_scope =
        tenant_root_role_d1_integration_scope(&non_initial.record, 0x04, 0x04, 1)?;
    let non_initial_cleanup = match store
        .reserve_cleanup_pending(non_initial_cleanup_scope, non_initial, 13)
        .await?
    {
        CloudflareTenantRootCleanupPendingDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh non-initial cleanup did not return an executable command",
            ));
        }
    };
    let _ = store.cleanup_pending(non_initial_cleanup, 13).await?;

    let initial_record = tenant_root_role_d1_integration_pending_record(role, 1, 1, 10)?;
    let initial_scope = tenant_root_role_d1_integration_scope(&initial_record, 0x05, 0x05, 1)?;
    let initial_command = match store
        .reserve_insert_pending(initial_scope, initial_record.clone(), 60)
        .await?
    {
        CloudflareTenantRootInsertPendingDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh initial insertion did not return an executable command",
            ));
        }
    };
    let (initial, _) = store.insert_pending(initial_command, 60).await?;
    let resumed_initial = match store
        .reserve_insert_pending(initial_scope, initial_record.clone(), 61)
        .await?
    {
        CloudflareTenantRootInsertPendingDecisionV1::ResumeCompletion { executed } => executed,
        _ => {
            return Err(store_error(
                "identical executed pending insertion did not return a completion token",
            ));
        }
    };
    if resumed_initial.executed_at_ms() != 60 {
        return Err(store_error(
            "executed pending insertion changed its durable checkpoint timestamp",
        ));
    }
    let initial_receipt = tenant_root_role_d1_integration_success_receipt(
        role,
        &resumed_initial,
        br#"{"kind":"r120_pending_inserted"}"#,
        62,
    )?;
    let initial_receipt_bytes = initial_receipt.canonical_bytes().to_vec();
    store
        .complete_command(resumed_initial, initial_receipt)
        .await?;
    if !matches!(
        store
            .reserve_insert_pending(initial_scope, initial_record.clone(), 63)
            .await?,
        CloudflareTenantRootInsertPendingDecisionV1::ReplayCompleted { receipt_bytes }
            if receipt_bytes == initial_receipt_bytes
    ) {
        return Err(store_error(
            "completed pending insertion did not replay after an arrival-time change",
        ));
    }
    let conflicting = tenant_root_role_d1_integration_pending_record(role, 1, 9, 10)?;
    require_integration_failure(
        store
            .reserve_insert_pending(initial_scope, conflicting, 60)
            .await,
        "role-private D1 accepted conflicting pending share bytes",
    )?;

    let initial_activation = tenant_root_role_d1_integration_activation(&initial.record, 20)?;
    let initial_activation_scope =
        tenant_root_role_d1_integration_scope(&initial.record, 0x06, 0x06, 1)?;
    let initial_activation_command = match store
        .reserve_activate_initial_pending(
            initial_activation_scope,
            initial.clone(),
            initial_activation.clone(),
            20,
            61,
        )
        .await?
    {
        CloudflareTenantRootActivateInitialPendingDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh initial activation did not return an executable command",
            ));
        }
    };
    let (active, _) = store
        .activate_initial_pending(initial_activation_command, 61)
        .await?;
    let stale_activation_scope =
        tenant_root_role_d1_integration_scope(&initial.record, 0x07, 0x07, 1)?;
    let stale_activation_command = match store
        .reserve_activate_initial_pending(
            stale_activation_scope,
            initial,
            initial_activation,
            20,
            62,
        )
        .await?
    {
        CloudflareTenantRootActivateInitialPendingDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh stale activation did not return an executable command",
            ));
        }
    };
    require_integration_failure(
        store
            .activate_initial_pending(stale_activation_command, 62)
            .await,
        "role-private D1 accepted a stale initial-activation revision",
    )?;

    let next_record = tenant_root_role_d1_integration_pending_record(role, 2, 2, 30)?;
    let missing_scope = tenant_root_role_d1_integration_scope(&next_record, 0x08, 0x08, 2)?;
    let missing_command = match store
        .reserve_insert_pending(missing_scope, next_record.clone(), 63)
        .await?
    {
        CloudflareTenantRootInsertPendingDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh successor insertion did not return an executable command",
            ));
        }
    };
    let (missing_pending, _) = store.insert_pending(missing_command, 63).await?;
    let missing_cleanup_scope =
        tenant_root_role_d1_integration_scope(&missing_pending.record, 0x09, 0x09, 2)?;
    let missing_cleanup_command = match store
        .reserve_cleanup_pending(missing_cleanup_scope, missing_pending.clone(), 64)
        .await?
    {
        CloudflareTenantRootCleanupPendingDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh missing-successor cleanup did not return an executable command",
            ));
        }
    };
    let _ = store.cleanup_pending(missing_cleanup_command, 64).await?;
    let missing_swap_scope =
        tenant_root_role_d1_integration_scope(&missing_pending.record, 0x0a, 0x0a, 2)?;
    let missing_swap_command = match store
        .reserve_swap_active_epoch(
            missing_swap_scope,
            active.clone(),
            missing_pending,
            tenant_root_role_d1_integration_activation(&next_record, 40)?,
            CloudflareTenantRootRetirementV1::new(lifecycle_receipt(0x45)?, 40)?,
            40,
            65,
        )
        .await?
    {
        CloudflareTenantRootSwapActiveEpochDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh missing-successor swap did not return an executable command",
            ));
        }
    };
    require_integration_failure(
        store.swap_active_epoch(missing_swap_command, 65).await,
        "role-private D1 retired an active epoch without its pending successor",
    )?;

    let pending_scope = tenant_root_role_d1_integration_scope(&next_record, 0x0b, 0x0b, 2)?;
    let pending_command = match store
        .reserve_insert_pending(pending_scope, next_record, 66)
        .await?
    {
        CloudflareTenantRootInsertPendingDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh successor insertion did not return an executable command",
            ));
        }
    };
    let (pending, _) = store.insert_pending(pending_command, 66).await?;
    let swap_activation = tenant_root_role_d1_integration_activation(&pending.record, 40)?;
    let swap_retirement = CloudflareTenantRootRetirementV1::new(lifecycle_receipt(0x45)?, 40)?;
    let swap_scope = tenant_root_role_d1_integration_scope(&pending.record, 0x0c, 0x0c, 2)?;
    let swap_command = match store
        .reserve_swap_active_epoch(
            swap_scope,
            active.clone(),
            pending.clone(),
            swap_activation.clone(),
            swap_retirement.clone(),
            40,
            67,
        )
        .await?
    {
        CloudflareTenantRootSwapActiveEpochDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh epoch swap did not return an executable command",
            ));
        }
    };
    let ((retired, activated), _) = store.swap_active_epoch(swap_command, 67).await?;
    let stale_swap_scope = tenant_root_role_d1_integration_scope(&pending.record, 0x0d, 0x0d, 2)?;
    let stale_swap_command = match store
        .reserve_swap_active_epoch(
            stale_swap_scope,
            active,
            pending,
            swap_activation,
            swap_retirement,
            40,
            68,
        )
        .await?
    {
        CloudflareTenantRootSwapActiveEpochDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh stale epoch swap did not return an executable command",
            ));
        }
    };
    require_integration_failure(
        store.swap_active_epoch(stale_swap_command, 68).await,
        "role-private D1 accepted a stale epoch-swap revision",
    )?;

    let loaded_active = store
        .observe_active(activated.record().identity())
        .await?
        .require_active()?;
    if loaded_active != activated {
        return Err(store_error(
            "role-private D1 active load did not return the activated epoch",
        ));
    }

    // Retired cleanup binds both sides of the swap and removes only the exact
    // retired revision while the expected active successor remains current.
    let retired_epoch = retired.record().epoch();
    let retired_revision = retired.revision();
    let active_epoch = activated.record().epoch();
    let active_revision = activated.revision();
    let wrong_retired_revision = tenant_root_creation_probe_retired_cleanup_authorization(
        &retired,
        tenant_root_creation_probe_protocol_role(role),
        retired_revision + 1,
        active_epoch,
        active_revision,
        0x31,
    )?;
    require_integration_failure(
        store
            .reserve_authorized_cleanup(wrong_retired_revision, 72)
            .await,
        "role-private D1 accepted an authorization for another retired revision",
    )?;
    let wrong_active_revision = tenant_root_creation_probe_retired_cleanup_authorization(
        &retired,
        tenant_root_creation_probe_protocol_role(role),
        retired_revision,
        active_epoch,
        active_revision + 1,
        0x32,
    )?;
    require_integration_failure(
        store
            .reserve_authorized_cleanup(wrong_active_revision, 72)
            .await,
        "role-private D1 accepted an authorization for another active successor revision",
    )?;
    let retired_cleanup_authorization = tenant_root_creation_probe_retired_cleanup_authorization(
        &retired,
        tenant_root_creation_probe_protocol_role(role),
        retired_revision,
        active_epoch,
        active_revision,
        0x34,
    )?;
    let retired_cleanup_authorization_bytes = retired_cleanup_authorization
        .canonical_bytes()
        .map_err(|error| store_error(error.message()))?;
    let retired_cleanup_command = match store
        .reserve_authorized_cleanup(retired_cleanup_authorization, 72)
        .await?
    {
        CloudflareTenantRootAuthorizedCleanupDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh authorized retired cleanup was not executable",
            ));
        }
    };
    let retired_cleanup_executed = store
        .execute_authorized_cleanup(retired_cleanup_command, 72)
        .await?;
    let retired_cleanup_receipt = tenant_root_role_d1_integration_success_receipt(
        role,
        &retired_cleanup_executed.executed,
        &retired_cleanup_authorization_bytes,
        73,
    )?;
    let retired_cleanup_receipt_bytes = match store
        .complete_authorized_cleanup(retired_cleanup_executed, retired_cleanup_receipt)
        .await?
    {
        CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes } => receipt_bytes,
        CloudflareTenantRootCommandTerminalCommitV1::Replay { .. } => {
            return Err(store_error(
                "fresh authorized retired cleanup reported a replay",
            ));
        }
    };
    let replay_retired_cleanup_authorization =
        tenant_root_creation_probe_retired_cleanup_authorization(
            &retired,
            tenant_root_creation_probe_protocol_role(role),
            retired_revision,
            active_epoch,
            active_revision,
            0x34,
        )?;
    match store
        .reserve_authorized_cleanup(
            replay_retired_cleanup_authorization,
            TENANT_ROOT_CREATION_PROBE_EXPIRES_AT_MS_V1 + 60_000,
        )
        .await?
    {
        CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted { receipt_bytes }
            if receipt_bytes == retired_cleanup_receipt_bytes => {}
        _ => {
            return Err(store_error(
                "authorized retired cleanup did not replay its exact terminal receipt",
            ));
        }
    }
    if store
        .load_epoch(
            retired.record().identity(),
            retired.record().custody_lineage(),
            retired_epoch,
        )
        .await?
        .is_some()
    {
        return Err(store_error(
            "authorized retired cleanup left its retired role share durable",
        ));
    }
    let active_after_cleanup = store
        .load_epoch(
            activated.record().identity(),
            activated.record().custody_lineage(),
            active_epoch,
        )
        .await?
        .ok_or_else(|| store_error("authorized retired cleanup removed its active successor"))?;
    if active_after_cleanup != activated {
        return Err(store_error(
            "authorized retired cleanup changed its active successor",
        ));
    }

    let cleanup_record = tenant_root_role_d1_integration_pending_record(role, 3, 3, 50)?;
    let cleanup_insert_scope =
        tenant_root_role_d1_integration_scope(&cleanup_record, 0x0e, 0x0e, 3)?;
    let cleanup_insert_command = match store
        .reserve_insert_pending(cleanup_insert_scope, cleanup_record, 69)
        .await?
    {
        CloudflareTenantRootInsertPendingDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh cleanup-row insertion did not return an executable command",
            ));
        }
    };
    let (cleanup, _) = store.insert_pending(cleanup_insert_command, 69).await?;
    let cleanup_scope = tenant_root_role_d1_integration_scope(&cleanup.record, 0x0f, 0x0f, 3)?;
    let cleanup_command = match store
        .reserve_cleanup_pending(cleanup_scope, cleanup.clone(), 70)
        .await?
    {
        CloudflareTenantRootCleanupPendingDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh pending cleanup did not return an executable command",
            ));
        }
    };
    let _ = store.cleanup_pending(cleanup_command, 70).await?;
    let stale_cleanup_scope =
        tenant_root_role_d1_integration_scope(&cleanup.record, 0x10, 0x10, 3)?;
    let stale_cleanup_command = match store
        .reserve_cleanup_pending(stale_cleanup_scope, cleanup, 71)
        .await?
    {
        CloudflareTenantRootCleanupPendingDecisionV1::Execute { command } => command,
        _ => {
            return Err(store_error(
                "fresh stale pending cleanup did not return an executable command",
            ));
        }
    };
    require_integration_failure(
        store.cleanup_pending(stale_cleanup_command, 71).await,
        "role-private D1 accepted a stale pending-cleanup revision",
    )?;

    let command_identity = activated
        .record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let command_session = TenantRootCeremonySessionIdV1::from_bytes([0x71; 16])
        .map_err(|error| store_error(error.message()))?;
    let command_nonce = TenantRootCeremonyNonceV1::from_bytes([0x72; 32])
        .map_err(|error| store_error(error.message()))?;
    let mut command_payload = command_payload_start("integration_terminal_probe")?;
    push_command_field(&mut command_payload, b"r120-role-command")?;
    let command_payload_digest = finish_command_payload(command_payload)?;
    let command_scope = TenantRootCommandScopeV1::new(
        match role {
            CloudflareTenantRootDeriverRoleV1::DeriverA => TenantRootCommandReplayKeyV1::deriver_a(
                command_identity,
                activated.record.custody_lineage,
                command_session,
                command_nonce,
            ),
            CloudflareTenantRootDeriverRoleV1::DeriverB => TenantRootCommandReplayKeyV1::deriver_b(
                command_identity,
                activated.record.custody_lineage,
                command_session,
                command_nonce,
            ),
        },
        activated.record.epoch,
        2,
    )
    .map_err(|error| store_error(error.message()))?;
    let command_operation = TenantRootCommandOperationV1::cleanup_pending(command_payload_digest);
    let _fresh_reservation = match store
        .reserve_scoped_command(command_scope, command_operation, 60)
        .await?
    {
        CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => reservation,
        _ => {
            return Err(store_error(
                "fresh role-private command did not return an execution reservation",
            ));
        }
    };
    let resumed_reservation = match store
        .reserve_scoped_command(command_scope, command_operation, 61)
        .await?
    {
        CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { reservation } => reservation,
        _ => {
            return Err(store_error(
                "identical reserved role-private command did not return a resumable reservation",
            ));
        }
    };
    let command_receipt = tenant_root_role_d1_integration_failure_receipt(
        role,
        &resumed_reservation,
        br#"{"kind":"r120_role_command_failed"}"#,
        70,
    )?;
    let command_receipt_bytes = command_receipt.canonical_bytes().to_vec();
    let command_receipt_digest_hex = encode_hex(command_receipt.digest().as_bytes());
    let committed = store
        .fail_command(resumed_reservation, command_receipt)
        .await?;
    if !matches!(
        committed,
        CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes }
            if receipt_bytes == command_receipt_bytes
    ) {
        return Err(store_error(
            "role-private command did not commit its exact receipt bytes",
        ));
    }
    if !matches!(
        store
            .reserve_scoped_command(command_scope, command_operation, 63)
            .await?,
        CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed { failure_receipt_bytes }
            if failure_receipt_bytes == command_receipt_bytes
    ) {
        return Err(store_error(
            "failed role-private command did not replay exact receipt bytes",
        ));
    }
    let substituted_nonce = TenantRootCeremonyNonceV1::from_bytes([0x74; 32])
        .map_err(|error| store_error(error.message()))?;
    let substituted_scope = TenantRootCommandScopeV1::new(
        match role {
            CloudflareTenantRootDeriverRoleV1::DeriverA => TenantRootCommandReplayKeyV1::deriver_a(
                command_identity,
                activated.record.custody_lineage,
                command_session,
                substituted_nonce,
            ),
            CloudflareTenantRootDeriverRoleV1::DeriverB => TenantRootCommandReplayKeyV1::deriver_b(
                command_identity,
                activated.record.custody_lineage,
                command_session,
                substituted_nonce,
            ),
        },
        activated.record.epoch,
        2,
    )
    .map_err(|error| store_error(error.message()))?;
    require_integration_failure(
        store
            .reserve_scoped_command(substituted_scope, command_operation, 60)
            .await,
        "role-private command replay accepted nonce substitution",
    )?;

    let failed_session = TenantRootCeremonySessionIdV1::from_bytes([0x75; 16])
        .map_err(|error| store_error(error.message()))?;
    let failed_nonce = TenantRootCeremonyNonceV1::from_bytes([0x76; 32])
        .map_err(|error| store_error(error.message()))?;
    let failed_scope = TenantRootCommandScopeV1::new(
        match role {
            CloudflareTenantRootDeriverRoleV1::DeriverA => TenantRootCommandReplayKeyV1::deriver_a(
                command_identity,
                activated.record.custody_lineage,
                failed_session,
                failed_nonce,
            ),
            CloudflareTenantRootDeriverRoleV1::DeriverB => TenantRootCommandReplayKeyV1::deriver_b(
                command_identity,
                activated.record.custody_lineage,
                failed_session,
                failed_nonce,
            ),
        },
        activated.record.epoch,
        2,
    )
    .map_err(|error| store_error(error.message()))?;
    let failed_reservation = match store
        .reserve_scoped_command(failed_scope, command_operation, 80)
        .await?
    {
        CloudflareTenantRootCommandReplayDecisionV1::Execute { reservation } => reservation,
        _ => {
            return Err(store_error(
                "fresh failing role-private command did not return an execution reservation",
            ));
        }
    };
    let failure_receipt = tenant_root_role_d1_integration_failure_receipt(
        role,
        &failed_reservation,
        br#"{"kind":"r120_role_command_failed"}"#,
        90,
    )?;
    let failed_receipt_bytes = failure_receipt.canonical_bytes().to_vec();
    store
        .fail_command(failed_reservation, failure_receipt)
        .await?;
    if !matches!(
        store
            .reserve_scoped_command(failed_scope, command_operation, 81)
            .await?,
        CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed {
            failure_receipt_bytes: stored_receipt_bytes
        } if stored_receipt_bytes == failed_receipt_bytes
    ) {
        return Err(store_error(
            "failed role-private command did not replay exact failure-receipt bytes",
        ));
    }

    Ok(CloudflareTenantRootRoleD1IntegrationReceiptV1 {
        role,
        retired_epoch: retired.record.epoch.get().get(),
        retired_revision: retired.revision,
        active_epoch: activated.record.epoch.get().get(),
        active_revision: activated.revision,
        cleanup_epoch: 3,
        command_receipt_digest_hex,
    })
}

/// One probe ceremony's sealed creation input plus the public bytes A needs.
#[cfg(debug_assertions)]
struct TenantRootCreationProbeCeremonyV1 {
    input: CloudflareTenantRootInitialCreationInputV1,
    managed_backup: VerifiedTenantRootManagedBackupV1,
    own_package: Vec<u8>,
    evidence: Vec<u8>,
    context: router_ab_core::TenantRootCeremonyContextV1,
    authority_id: router_ab_core::TenantRootControlPlaneAuthorityIdV1,
}

#[cfg(debug_assertions)]
struct TenantRootCreationProbeAuthorizationV1 {
    own_package: Vec<u8>,
    peer_package: Vec<u8>,
    context: router_ab_core::TenantRootCeremonyContextV1,
    authority_id: router_ab_core::TenantRootControlPlaneAuthorityIdV1,
}

#[cfg(debug_assertions)]
fn tenant_root_creation_probe_authorization(
    role: CloudflareTenantRootDeriverRoleV1,
    session_seed: u8,
) -> worker::Result<TenantRootCreationProbeAuthorizationV1> {
    let protocol_role = tenant_root_creation_probe_protocol_role(role);
    let identity = tenant_root_creation_probe_identity()?;
    let context = tenant_root_creation_probe_context(session_seed)?;
    let journal = router_ab_core::TenantRootCreationJournalV1::started(
        identity,
        context.custody_lineage(),
        context.clone(),
    )
    .map_err(|error| store_error(error.message()))?;
    let authority_id = router_ab_core::TenantRootControlPlaneAuthorityIdV1::from_bytes([0x56; 32]);
    let package_for = |package_role: TwoPartyDeriverRole| -> worker::Result<Vec<u8>> {
        let signed = tenant_root_creation_probe_signed_command(
            package_role,
            &journal,
            &context,
            authority_id,
        )?;
        router_ab_core::TenantRootRoleCreationCommandPackageV1::new(journal.clone(), signed)
            .and_then(|package| package.canonical_bytes())
            .map_err(|error| store_error(error.message()))
    };
    Ok(TenantRootCreationProbeAuthorizationV1 {
        own_package: package_for(protocol_role)?,
        peer_package: package_for(protocol_role.peer())?,
        context,
        authority_id,
    })
}

#[cfg(debug_assertions)]
fn tenant_root_creation_probe_verified_package(
    authorization: &TenantRootCreationProbeAuthorizationV1,
    role: CloudflareTenantRootDeriverRoleV1,
) -> worker::Result<router_ab_core::VerifiedTenantRootRoleCreationCommandPackageV1> {
    let protocol_role = tenant_root_creation_probe_protocol_role(role);
    let signer = crate::env::cloudflare_tenant_root_creation_role_signer_for_probe_v1(
        protocol_role,
        tenant_root_role_d1_integration_role_signing_key_id(role),
        tenant_root_role_d1_integration_role_signing_key(role),
    );
    crate::tenant_root_role_runtime::verify_tenant_root_role_creation_package_v1(
        &authorization.own_package,
        protocol_role,
        authorization.authority_id,
        &tenant_root_creation_probe_issuer_keys()?,
        &signer,
    )
    .map_err(|error| store_error(error.message()))
}

/// Builds one complete ceremony through the production entry point.
///
/// The peer leg runs first only to produce a real peer commitment; its share is
/// dropped and never persisted. This role's leg then runs through
/// `execute_tenant_root_role_creation_v1`, the same function a live Deriver
/// calls, so the probe exercises production admission, finalization, and
/// sealing rather than a parallel fixture path.
#[cfg(debug_assertions)]
async fn tenant_root_creation_probe_ceremony(
    env: &Env,
    role: CloudflareTenantRootDeriverRoleV1,
    authorization: TenantRootCreationProbeAuthorizationV1,
    now_ms: u64,
) -> worker::Result<TenantRootCreationProbeCeremonyV1> {
    let protocol_role = tenant_root_creation_probe_protocol_role(role);
    let peer_protocol_role = protocol_role.peer();
    let peer_role_id = match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverB,
        CloudflareTenantRootDeriverRoleV1::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverA,
    };

    let TenantRootCreationProbeAuthorizationV1 {
        own_package,
        peer_package,
        context,
        authority_id,
    } = authorization;

    let role_keys = tenant_root_creation_probe_role_keys()?;
    let trusted_issuer = tenant_root_creation_probe_issuer_keys()?;
    let worker_role = match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => crate::CloudflareWorkerRoleV1::DeriverA,
        CloudflareTenantRootDeriverRoleV1::DeriverB => crate::CloudflareWorkerRoleV1::DeriverB,
    };
    let provider_config = tenant_root_creation_probe_provider_config(env, worker_role)?;
    let mut rng = crate::CloudflareSignerProofGetrandomRngV1;

    // Peer leg: commit only. Its share dies with this scope.
    let mut peer_online =
        crate::env::load_cloudflare_tenant_root_operational_rotation_provider_v1(env, worker_role)
            .map_err(|error| store_error(error.message()))?;
    let mut peer_backup =
        crate::env::load_cloudflare_tenant_root_operational_rotation_provider_v1(env, worker_role)
            .map_err(|error| store_error(error.message()))?;
    let peer_signer = crate::env::cloudflare_tenant_root_creation_role_signer_for_probe_v1(
        peer_protocol_role,
        tenant_root_role_d1_integration_role_signing_key_id(peer_role_id),
        tenant_root_role_d1_integration_role_signing_key(peer_role_id),
    );
    let peer_progress = crate::tenant_root_role_runtime::execute_tenant_root_role_creation_v1(
        &peer_package,
        None,
        peer_protocol_role,
        authority_id,
        &trusted_issuer,
        &role_keys,
        &peer_signer,
        &provider_config,
        &mut peer_online,
        &mut peer_backup,
        now_ms,
        &mut rng,
    )
    .await
    .map_err(|error| store_error(error.message()))?;
    let peer_commitment = match peer_progress {
        crate::tenant_root_role_runtime::TenantRootRoleCreationProgressV1::Committed {
            pending,
        } => pending.commitment_bytes().to_vec(),
        _ => {
            return Err(store_error(
                "peer probe leg sealed without a peer commitment",
            ))
        }
    };

    // This role's leg: admit, finalize, seal, through the production entry point.
    let mut online =
        crate::env::load_cloudflare_tenant_root_operational_rotation_provider_v1(env, worker_role)
            .map_err(|error| store_error(error.message()))?;
    let mut backup =
        crate::env::load_cloudflare_tenant_root_operational_rotation_provider_v1(env, worker_role)
            .map_err(|error| store_error(error.message()))?;
    let signer = crate::env::cloudflare_tenant_root_creation_role_signer_for_probe_v1(
        protocol_role,
        tenant_root_role_d1_integration_role_signing_key_id(role),
        tenant_root_role_d1_integration_role_signing_key(role),
    );
    let progress = crate::tenant_root_role_runtime::execute_tenant_root_role_creation_v1(
        &own_package,
        Some(&peer_commitment),
        protocol_role,
        authority_id,
        &trusted_issuer,
        &role_keys,
        &signer,
        &provider_config,
        &mut online,
        &mut backup,
        now_ms,
        &mut rng,
    )
    .await
    .map_err(|error| store_error(error.message()))?;
    match progress {
        crate::tenant_root_role_runtime::TenantRootRoleCreationProgressV1::Sealed {
            signed_installation_evidence,
            input,
            managed_backup,
            ..
        } => Ok(TenantRootCreationProbeCeremonyV1 {
            input: *input,
            managed_backup: *managed_backup,
            own_package,
            evidence: signed_installation_evidence,
            context,
            authority_id,
        }),
        _ => Err(store_error(
            "own probe leg did not seal against the peer commitment",
        )),
    }
}

/// Exercises the creation-specific store path against a real role-private D1.
///
/// The receipt comes through the production sequence -- reserve, insert, sign
/// against the executed command, verify locally with that same token, complete
/// -- so nothing here fabricates a receipt. Run this probe in each Deriver to
/// prove both roles' wrappers; a single Worker only owns its own store.
#[cfg(debug_assertions)]
async fn run_cloudflare_tenant_root_initial_creation_integration_v1(
    env: &Env,
) -> worker::Result<CloudflareTenantRootRoleD1IntegrationReceiptV1> {
    let store = CloudflareTenantRootRoleShareStoreV1::from_env(env)?;
    let role = store.cipher.role;
    let reserved_at_ms = TENANT_ROOT_CREATION_PROBE_ISSUED_AT_MS_V1 + 4;

    // 1. The full happy path: reserve, insert, terminalize.
    let completed_authorization = tenant_root_creation_probe_authorization(role, 0x54)?;
    let completed_package =
        tenant_root_creation_probe_verified_package(&completed_authorization, role)?;
    if !matches!(
        store
            .preflight_initial_creation(completed_package.command(), reserved_at_ms)
            .await?,
        CloudflareTenantRootInitialCreationPreflightV1::Fresh
    ) {
        return Err(store_error(
            "fresh initial creation preflight did not admit generation",
        ));
    }
    let completed =
        tenant_root_creation_probe_ceremony(env, role, completed_authorization, reserved_at_ms - 2)
            .await?;
    let role_signer = crate::env::cloudflare_tenant_root_creation_role_signer_for_probe_v1(
        tenant_root_creation_probe_protocol_role(role),
        tenant_root_role_d1_integration_role_signing_key_id(role),
        tenant_root_role_d1_integration_role_signing_key(role),
    );
    let backup_store =
        crate::tenant_root_managed_backup_r2::CloudflareTenantRootManagedBackupStoreV1::from_env(
            env,
            role.managed_restore_role(),
        )?;
    if !matches!(
        backup_store.put_verified(&completed.managed_backup).await?,
        crate::tenant_root_managed_backup_r2::CloudflareTenantRootManagedBackupPutOutcomeV1::Stored { .. }
    ) {
        return Err(store_error(
            "a first managed-backup write reported a replay",
        ));
    }
    let completed_epoch = completed.input.record.epoch.get().get();
    let committed_bytes = match store
        .persist_initial_creation(
            completed.input,
            &role_signer,
            reserved_at_ms,
            reserved_at_ms,
            reserved_at_ms + 1,
        )
        .await?
    {
        CloudflareTenantRootInitialCreationPersistenceOutcomeV1::Committed { receipt_bytes } => {
            receipt_bytes
        }
        CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayCompleted { .. } => {
            return Err(store_error(
                "a first initial-creation persistence reported a replay",
            ));
        }
        CloudflareTenantRootInitialCreationPersistenceOutcomeV1::InProgress => {
            return Err(store_error(
                "a first initial-creation persistence reported in progress",
            ));
        }
        CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayFailed { .. } => {
            return Err(store_error(
                "a first initial-creation persistence replayed a failure",
            ));
        }
    };

    // 2. Exact replay returns the identical receipt.
    let replay_authorization = tenant_root_creation_probe_authorization(role, 0x54)?;
    let replay_package = tenant_root_creation_probe_verified_package(&replay_authorization, role)?;
    match store
        .preflight_initial_creation(replay_package.command(), reserved_at_ms + 2)
        .await?
    {
        CloudflareTenantRootInitialCreationPreflightV1::ReplayCompleted { receipt_bytes } => {
            if receipt_bytes != committed_bytes {
                return Err(store_error(
                    "exact initial-creation replay returned different receipt bytes",
                ));
            }
        }
        _ => {
            return Err(store_error(
                "exact initial-creation replay was not recognised",
            ))
        }
    }

    if !matches!(
        backup_store.put_verified(&completed.managed_backup).await?,
        crate::tenant_root_managed_backup_r2::CloudflareTenantRootManagedBackupPutOutcomeV1::Replay { .. }
    ) {
        return Err(store_error(
            "an exact managed-backup retry did not report a replay",
        ));
    }

    // 3. Exact replay AFTER the issuer command expired still reconciles.
    //    Freshness gates only the first durable reservation.
    let expired_authorization = tenant_root_creation_probe_authorization(role, 0x54)?;
    let expired_package =
        tenant_root_creation_probe_verified_package(&expired_authorization, role)?;
    match store
        .preflight_initial_creation(
            expired_package.command(),
            TENANT_ROOT_CREATION_PROBE_EXPIRES_AT_MS_V1 + 60_000,
        )
        .await?
    {
        CloudflareTenantRootInitialCreationPreflightV1::ReplayCompleted { receipt_bytes } => {
            if receipt_bytes != committed_bytes {
                return Err(store_error(
                    "post-expiry initial-creation replay returned different receipt bytes",
                ));
            }
        }
        _ => {
            return Err(store_error(
                "post-expiry exact initial-creation replay was not recognised",
            ));
        }
    }

    // 4. A different ceremony for the same tenant is a different command and
    //    must not reconcile against the completed one.
    let changed_authorization = tenant_root_creation_probe_authorization(role, 0x64)?;
    let changed_package =
        tenant_root_creation_probe_verified_package(&changed_authorization, role)?;
    if !matches!(
        store
            .preflight_initial_creation(changed_package.command(), reserved_at_ms + 3)
            .await?,
        CloudflareTenantRootInitialCreationPreflightV1::Fresh
    ) {
        return Err(store_error(
            "a changed creation package reconciled against another ceremony",
        ));
    }
    let changed =
        tenant_root_creation_probe_ceremony(env, role, changed_authorization, reserved_at_ms - 2)
            .await?;
    match store
        .reserve_initial_creation_pending(changed.input, reserved_at_ms + 3)
        .await
    {
        Ok(CloudflareTenantRootInitialCreationDecisionV1::ReplayCompleted { .. }) => {
            return Err(store_error(
                "a changed creation package replayed the prior receipt",
            ));
        }
        Ok(CloudflareTenantRootInitialCreationDecisionV1::Execute { .. }) | Err(_) => {}
        Ok(_) => {
            return Err(store_error(
                "a changed creation package produced an unexpected decision",
            ));
        }
    }

    // 5. Execution-checkpoint resume: reserve, do not insert, reserve again.
    let resume_authorization = tenant_root_creation_probe_authorization(role, 0x74)?;
    let resume_package = tenant_root_creation_probe_verified_package(&resume_authorization, role)?;
    if !matches!(
        store
            .preflight_initial_creation(resume_package.command(), reserved_at_ms + 4)
            .await?,
        CloudflareTenantRootInitialCreationPreflightV1::Fresh
    ) {
        return Err(store_error("a fresh resume preflight was not executable"));
    }
    let resume =
        tenant_root_creation_probe_ceremony(env, role, resume_authorization, reserved_at_ms - 2)
            .await?;
    match store
        .reserve_initial_creation_pending(resume.input, reserved_at_ms + 4)
        .await?
    {
        CloudflareTenantRootInitialCreationDecisionV1::Execute { .. } => {}
        _ => return Err(store_error("a fresh resume ceremony was not executable")),
    }
    let resume_again_authorization = tenant_root_creation_probe_authorization(role, 0x74)?;
    let resume_again_package =
        tenant_root_creation_probe_verified_package(&resume_again_authorization, role)?;
    match store
        .preflight_initial_creation(resume_again_package.command(), reserved_at_ms + 5)
        .await?
    {
        CloudflareTenantRootInitialCreationPreflightV1::InProgress => {}
        _ => {
            return Err(store_error(
                "an unexecuted reservation did not offer resume or report in progress",
            ));
        }
    }

    // 6. The receipt A would receive verifies under the remote attestation path.
    crate::tenant_root_role_runtime::verify_tenant_root_peer_persistence_v1(
        &committed_bytes,
        &completed.own_package,
        &completed.evidence,
        tenant_root_creation_probe_protocol_role(role),
        completed.authority_id,
        &tenant_root_creation_probe_issuer_keys()?,
        &tenant_root_creation_probe_role_keys()?,
        &completed.context,
    )
    .map_err(|error| store_error(error.message()))?;

    // 7. Cleanup requires a distinct issuer authorization, deletes the exact
    // pending revision, terminalizes under that authorization, and replays its
    // exact receipt without resurrecting the row.
    let cleanup_record = tenant_root_role_d1_integration_pending_record(role, 2, 0x85, 50)?;
    let cleanup_identity = cleanup_record.identity().clone();
    let cleanup_lineage = cleanup_record.custody_lineage();
    let cleanup_epoch = cleanup_record.epoch();
    let cleanup_insert_scope =
        tenant_root_role_d1_integration_scope(&cleanup_record, 0x81, 0x82, 1)?;
    let cleanup_insert = match store
        .reserve_insert_pending(cleanup_insert_scope, cleanup_record, reserved_at_ms + 6)
        .await?
    {
        CloudflareTenantRootInsertPendingDecisionV1::Execute { command } => command,
        _ => return Err(store_error("fresh cleanup fixture was not executable")),
    };
    let (cleanup_pending, _) = store
        .insert_pending(cleanup_insert, reserved_at_ms + 6)
        .await?;
    let cleanup_session = TenantRootCeremonySessionIdV1::from_bytes([0x83; 16])
        .map_err(|error| store_error(error.message()))?;
    let cleanup_ceremony_nonce = TenantRootCeremonyNonceV1::from_bytes([0x84; 32])
        .map_err(|error| store_error(error.message()))?;

    let wrong_role = tenant_root_creation_probe_cleanup_authorization(
        &cleanup_pending,
        tenant_root_creation_probe_protocol_role(role).peer(),
        cleanup_pending.revision,
        cleanup_session,
        cleanup_ceremony_nonce,
        0x85,
    )?;
    require_integration_failure(
        store
            .reserve_authorized_cleanup(wrong_role, reserved_at_ms + 7)
            .await,
        "role-private D1 accepted a cleanup authorization for the peer role",
    )?;
    let wrong_revision = tenant_root_creation_probe_cleanup_authorization(
        &cleanup_pending,
        tenant_root_creation_probe_protocol_role(role),
        cleanup_pending.revision + 1,
        cleanup_session,
        cleanup_ceremony_nonce,
        0x86,
    )?;
    require_integration_failure(
        store
            .reserve_authorized_cleanup(wrong_revision, reserved_at_ms + 7)
            .await,
        "role-private D1 accepted a cleanup authorization for another revision",
    )?;

    let cleanup_authorization = tenant_root_creation_probe_cleanup_authorization(
        &cleanup_pending,
        tenant_root_creation_probe_protocol_role(role),
        cleanup_pending.revision,
        cleanup_session,
        cleanup_ceremony_nonce,
        0x87,
    )?;
    let cleanup_authorization_bytes = cleanup_authorization
        .canonical_bytes()
        .map_err(|error| store_error(error.message()))?;
    let cleanup_command = match store
        .reserve_authorized_cleanup(cleanup_authorization, reserved_at_ms + 7)
        .await?
    {
        CloudflareTenantRootAuthorizedCleanupDecisionV1::Execute { command } => command,
        _ => return Err(store_error("fresh authorized cleanup was not executable")),
    };
    let cleanup_executed = store
        .execute_authorized_cleanup(cleanup_command, reserved_at_ms + 7)
        .await?;
    let cleanup_receipt = tenant_root_role_d1_integration_success_receipt(
        role,
        &cleanup_executed.executed,
        &cleanup_authorization_bytes,
        reserved_at_ms + 8,
    )?;
    let cleanup_receipt_bytes = match store
        .complete_authorized_cleanup(cleanup_executed, cleanup_receipt)
        .await?
    {
        CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes } => receipt_bytes,
        CloudflareTenantRootCommandTerminalCommitV1::Replay { .. } => {
            return Err(store_error("fresh authorized cleanup reported a replay"));
        }
    };
    let replay_cleanup_authorization = tenant_root_creation_probe_cleanup_authorization(
        &cleanup_pending,
        tenant_root_creation_probe_protocol_role(role),
        cleanup_pending.revision,
        cleanup_session,
        cleanup_ceremony_nonce,
        0x87,
    )?;
    match store
        .reserve_authorized_cleanup(
            replay_cleanup_authorization,
            TENANT_ROOT_CREATION_PROBE_EXPIRES_AT_MS_V1 + 60_000,
        )
        .await?
    {
        CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayCompleted { receipt_bytes }
            if receipt_bytes == cleanup_receipt_bytes => {}
        _ => {
            return Err(store_error(
                "authorized cleanup did not replay its exact terminal receipt",
            ));
        }
    }
    let conflicting_replay_cleanup = tenant_root_creation_probe_cleanup_authorization(
        &cleanup_pending,
        tenant_root_creation_probe_protocol_role(role),
        cleanup_pending.revision + 1,
        cleanup_session,
        cleanup_ceremony_nonce,
        0x87,
    )?;
    require_integration_failure(
        store
            .reserve_authorized_cleanup(
                conflicting_replay_cleanup,
                TENANT_ROOT_CREATION_PROBE_EXPIRES_AT_MS_V1 + 60_000,
            )
            .await,
        "authorized cleanup accepted changed command bytes under a completed replay key",
    )?;
    if store
        .load_epoch(&cleanup_identity, cleanup_lineage, cleanup_epoch)
        .await?
        .is_some()
    {
        return Err(store_error(
            "authorized cleanup left its pending role share durable",
        ));
    }

    Ok(CloudflareTenantRootRoleD1IntegrationReceiptV1 {
        role,
        retired_epoch: 0,
        retired_revision: 0,
        active_epoch: completed_epoch,
        active_revision: 1,
        cleanup_epoch: cleanup_epoch.get().get(),
        command_receipt_digest_hex: encode_hex(&Sha256::digest(&committed_bytes)),
    })
}

/// The probe's published issuer keyset.
#[cfg(debug_assertions)]
fn tenant_root_creation_probe_issuer_keys(
) -> worker::Result<crate::env::CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1> {
    crate::env::CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1::decode(&format!(
        "{{\"keys\":[{{\"issuer_key_id\":\"{TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_ID_V1}\",\"verifying_key_hex\":\"{}\"}}]}}",
        encode_hex(
            SigningKey::from_bytes(&TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_V1)
                .verifying_key()
                .as_bytes()
        )
    ))
    .map_err(|error| store_error(error.message()))
}

/// The probe's sealing provider descriptors, read from this Worker's own Env.
///
/// These must describe the provider that actually performs the seal, not a
/// fixture's idea of one: a seal request whose declared provider disagrees with
/// the loaded provider is refused, and that check is one of the things this
/// probe exists to exercise.
#[cfg(debug_assertions)]
fn tenant_root_creation_probe_provider_config(
    env: &Env,
    worker_role: crate::CloudflareWorkerRoleV1,
) -> worker::Result<crate::tenant_root_role_runtime::TenantRootRoleRuntimeProviderConfigV1> {
    let reader = crate::CloudflareWorkerEnvReaderV1::new(env);
    let config = crate::env::parse_cloudflare_tenant_root_operational_rotation_provider_config_v1(
        worker_role,
        &reader,
    )
    .map_err(|error| store_error(error.message()))?;
    crate::tenant_root_role_runtime::TenantRootRoleRuntimeProviderConfigV1::new(
        config.online_epoch_wrapping_key_ref(),
        config.backup_provider_id(),
        config.backup_key_version(),
    )
    .map_err(|error| store_error(error.message()))
}

/// The probe's published role keyset, matching the ceremony's key IDs.
#[cfg(debug_assertions)]
fn tenant_root_creation_probe_role_keys(
) -> worker::Result<crate::env::TenantRootCreationRoleVerifyingKeysV1> {
    let entry = |role: CloudflareTenantRootDeriverRoleV1, label: &str| {
        format!(
            "{{\"role\":\"{label}\",\"signing_key_id\":\"{}\",\"verifying_key_hex\":\"{}\"}}",
            tenant_root_role_d1_integration_role_signing_key_id(role),
            encode_hex(
                tenant_root_role_d1_integration_role_signing_key(role)
                    .verifying_key()
                    .as_bytes()
            )
        )
    };
    crate::env::decode_role_verifying_keys(&format!(
        "{{\"active_deriver_a_signing_key_id\":\"{}\",\"active_deriver_b_signing_key_id\":\"{}\",\"keys\":[{},{}]}}",
        tenant_root_role_d1_integration_role_signing_key_id(
            CloudflareTenantRootDeriverRoleV1::DeriverA,
        ),
        tenant_root_role_d1_integration_role_signing_key_id(
            CloudflareTenantRootDeriverRoleV1::DeriverB,
        ),
        entry(CloudflareTenantRootDeriverRoleV1::DeriverA, "deriver_a"),
        entry(CloudflareTenantRootDeriverRoleV1::DeriverB, "deriver_b"),
    ))
    .map_err(|error| store_error(error.message()))
}

/// Control-plane revision an authorized cleanup executes under.
///
/// Cleanup undoes an initial insertion, so it acts at the same control-plane
/// revision that authorized the creation it is clearing.
const TENANT_ROOT_AUTHORIZED_CLEANUP_CONTROL_PLANE_REVISION_V1: u64 = 1;

/// Maps a stored record's role to its protocol role.
fn tenant_root_protocol_role_of(role: CloudflareTenantRootDeriverRoleV1) -> TwoPartyDeriverRole {
    match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        CloudflareTenantRootDeriverRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    }
}

/// Issuer key used only by the workerd-gated creation probe.
///
/// The probe must produce a genuinely issuer-signed command so the production
/// verification path runs. This key exists only in a debug build behind the
/// integration env flag.
#[cfg(debug_assertions)]
const TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_V1: [u8; 32] = [0x4d; 32];
#[cfg(debug_assertions)]
const TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_ID_V1: &str = "tenant-root-creation-probe-issuer-v1";
#[cfg(debug_assertions)]
const TENANT_ROOT_CREATION_PROBE_ISSUED_AT_MS_V1: u64 = 1_000_000;
#[cfg(debug_assertions)]
const TENANT_ROOT_CREATION_PROBE_EXPIRES_AT_MS_V1: u64 = 1_030_000;

/// Builds the probe's ceremony context, shared by both roles.
#[cfg(debug_assertions)]
fn tenant_root_creation_probe_context(
    session_seed: u8,
) -> worker::Result<router_ab_core::TenantRootCeremonyContextV1> {
    let identity = tenant_root_creation_probe_identity()?;
    router_ab_core::TenantRootCeremonyContextV1::new(
        identity
            .digest()
            .map_err(|error| store_error(error.message()))?,
        TenantRootCustodyLineageId::from_bytes([0x53; 16])
            .map_err(|error| store_error(error.message()))?,
        router_ab_core::TenantRootCeremonyEpochsV1::create(),
        router_ab_core::TenantRootCeremonySessionIdV1::from_bytes([session_seed; 16])
            .map_err(|error| store_error(error.message()))?,
        router_ab_core::TenantRootCeremonyNonceV1::from_bytes([session_seed ^ 0x0f; 32])
            .map_err(|error| store_error(error.message()))?,
        TENANT_ROOT_CREATION_PROBE_ISSUED_AT_MS_V1,
        TENANT_ROOT_CREATION_PROBE_EXPIRES_AT_MS_V1,
        tenant_root_role_d1_integration_role_signing_key_id(
            CloudflareTenantRootDeriverRoleV1::DeriverA,
        ),
        tenant_root_role_d1_integration_role_signing_key_id(
            CloudflareTenantRootDeriverRoleV1::DeriverB,
        ),
    )
    .map_err(|error| store_error(error.message()))
}

#[cfg(debug_assertions)]
fn tenant_root_creation_probe_identity() -> worker::Result<TenantRootIdentityV1> {
    TenantRootIdentityV1::new(
        "r120-creation-probe-org",
        "r120-creation-probe-project",
        "workerd",
        "r120-creation-probe-root",
        "v1",
    )
    .map_err(|error| store_error(error.message()))
}

/// Signs and verifies one role's creation command, as the issuer would.
#[cfg(debug_assertions)]
fn tenant_root_creation_probe_signed_command(
    role: TwoPartyDeriverRole,
    journal: &router_ab_core::TenantRootCreationJournalV1,
    context: &router_ab_core::TenantRootCeremonyContextV1,
    authority_id: router_ab_core::TenantRootControlPlaneAuthorityIdV1,
) -> worker::Result<router_ab_core::TenantRootRoleCreationCommandV1> {
    router_ab_core::TenantRootRoleCreationCommandV1::sign(
        journal,
        context,
        role,
        authority_id,
        TENANT_ROOT_CREATION_PROBE_ISSUED_AT_MS_V1 + 1,
        TENANT_ROOT_CREATION_PROBE_EXPIRES_AT_MS_V1 - 1,
        TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_ID_V1,
        &TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_V1,
    )
    .map_err(|error| store_error(error.message()))
}

#[cfg(debug_assertions)]
fn tenant_root_creation_probe_cleanup_authorization(
    pending: &CloudflareStoredTenantRootRoleShareV1,
    authorized_role: TwoPartyDeriverRole,
    expected_revision: i64,
    session_id: TenantRootCeremonySessionIdV1,
    ceremony_nonce: TenantRootCeremonyNonceV1,
    cleanup_nonce_seed: u8,
) -> worker::Result<VerifiedTenantRootRoleCleanupCommandV1> {
    let installation_evidence_digest = TenantRootProtocolDigestV1::from_bytes(
        *record_installation_evidence_digest(&pending.record)?.as_bytes(),
    )
    .map_err(|error| store_error(error.message()))?;
    let target = router_ab_core::TenantRootRoleCleanupTargetV1::Pending {
        identity_digest: pending
            .record
            .identity()
            .digest()
            .map_err(|error| store_error(error.message()))?,
        custody_lineage: pending.record.custody_lineage(),
        role: authorized_role,
        epoch: pending.record.epoch(),
        expected_row_revision: expected_revision,
        session_id,
        ceremony_nonce,
        installation_evidence_digest,
    };
    let cleanup_nonce = TenantRootCeremonyNonceV1::from_bytes([cleanup_nonce_seed; 32])
        .map_err(|error| store_error(error.message()))?;
    let issuer_signing_key = SigningKey::from_bytes(&TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_V1);
    let signed = router_ab_core::TenantRootRoleCleanupCommandV1::sign(
        &target,
        router_ab_core::TenantRootControlPlaneAuthorityIdV1::from_bytes([0x56; 32]),
        cleanup_nonce,
        TENANT_ROOT_CREATION_PROBE_ISSUED_AT_MS_V1 + 1,
        TENANT_ROOT_CREATION_PROBE_EXPIRES_AT_MS_V1 - 1,
        TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_ID_V1,
        issuer_signing_key.as_bytes(),
    )
    .map_err(|error| store_error(error.message()))?;
    signed
        .verify(
            &target,
            authorized_role,
            router_ab_core::TenantRootControlPlaneAuthorityIdV1::from_bytes([0x56; 32]),
            TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_ID_V1,
            issuer_signing_key.verifying_key().as_bytes(),
        )
        .map_err(|error| store_error(error.message()))
}

#[cfg(debug_assertions)]
fn tenant_root_creation_probe_retired_cleanup_authorization(
    retired: &CloudflareStoredTenantRootRoleShareV1,
    authorized_role: TwoPartyDeriverRole,
    expected_retired_revision: i64,
    expected_active_epoch: TenantRootShareEpoch,
    expected_active_revision: i64,
    cleanup_nonce_seed: u8,
) -> worker::Result<VerifiedTenantRootRoleCleanupCommandV1> {
    let target = router_ab_core::TenantRootRoleCleanupTargetV1::Retired {
        identity_digest: retired
            .record()
            .identity()
            .digest()
            .map_err(|error| store_error(error.message()))?,
        custody_lineage: retired.record().custody_lineage(),
        role: authorized_role,
        retired_epoch: retired.record().epoch(),
        expected_retired_revision,
        expected_active_epoch,
        expected_active_revision,
    };
    let cleanup_nonce = TenantRootCeremonyNonceV1::from_bytes([cleanup_nonce_seed; 32])
        .map_err(|error| store_error(error.message()))?;
    let issuer_signing_key = SigningKey::from_bytes(&TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_V1);
    let signed = router_ab_core::TenantRootRoleCleanupCommandV1::sign(
        &target,
        router_ab_core::TenantRootControlPlaneAuthorityIdV1::from_bytes([0x56; 32]),
        cleanup_nonce,
        TENANT_ROOT_CREATION_PROBE_ISSUED_AT_MS_V1 + 1,
        TENANT_ROOT_CREATION_PROBE_EXPIRES_AT_MS_V1 - 1,
        TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_ID_V1,
        issuer_signing_key.as_bytes(),
    )
    .map_err(|error| store_error(error.message()))?;
    signed
        .verify(
            &target,
            authorized_role,
            router_ab_core::TenantRootControlPlaneAuthorityIdV1::from_bytes([0x56; 32]),
            TENANT_ROOT_CREATION_PROBE_ISSUER_KEY_ID_V1,
            issuer_signing_key.verifying_key().as_bytes(),
        )
        .map_err(|error| store_error(error.message()))
}

#[cfg(debug_assertions)]
fn tenant_root_creation_probe_protocol_role(
    role: CloudflareTenantRootDeriverRoleV1,
) -> TwoPartyDeriverRole {
    match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        CloudflareTenantRootDeriverRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    }
}

#[cfg(debug_assertions)]
fn tenant_root_role_d1_integration_role_signing_key(
    role: CloudflareTenantRootDeriverRoleV1,
) -> SigningKey {
    let seed = match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => 0xa7,
        CloudflareTenantRootDeriverRoleV1::DeriverB => 0xb7,
    };
    SigningKey::from_bytes(&[seed; 32])
}

#[cfg(debug_assertions)]
const fn tenant_root_role_d1_integration_role_signing_key_id(
    role: CloudflareTenantRootDeriverRoleV1,
) -> &'static str {
    match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => "r120-integration-deriver-a-command-key-v1",
        CloudflareTenantRootDeriverRoleV1::DeriverB => "r120-integration-deriver-b-command-key-v1",
    }
}

#[cfg(debug_assertions)]
fn tenant_root_role_d1_integration_success_receipt(
    role: CloudflareTenantRootDeriverRoleV1,
    executed: &ExecutedTenantRootCommandV1,
    payload: &[u8],
    terminal_at_ms: u64,
) -> worker::Result<VerifiedTenantRootCommandSuccessReceiptV1> {
    let signing_key = tenant_root_role_d1_integration_role_signing_key(role);
    let role_signing_key_id = tenant_root_role_d1_integration_role_signing_key_id(role);
    let signed = TenantRootCommandTerminalReceiptV1::sign_success(
        *executed.key(),
        executed.command_digest(),
        payload.to_vec(),
        terminal_at_ms,
        role_signing_key_id,
        signing_key.as_bytes(),
    )
    .map_err(|error| store_error(error.message()))?;
    let canonical_bytes = signed
        .canonical_bytes()
        .map_err(|error| store_error(error.message()))?;
    let decoded = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&canonical_bytes)
        .map_err(|error| store_error(error.message()))?;
    decoded
        .verify_success(
            executed,
            role_signing_key_id,
            signing_key.verifying_key().as_bytes(),
        )
        .map_err(|error| store_error(error.message()))
}

#[cfg(debug_assertions)]
fn tenant_root_role_d1_integration_failure_receipt(
    role: CloudflareTenantRootDeriverRoleV1,
    reservation: &ReservedTenantRootCommandV1,
    payload: &[u8],
    terminal_at_ms: u64,
) -> worker::Result<VerifiedTenantRootCommandFailureReceiptV1> {
    let signing_key = tenant_root_role_d1_integration_role_signing_key(role);
    let role_signing_key_id = tenant_root_role_d1_integration_role_signing_key_id(role);
    let signed = TenantRootCommandTerminalReceiptV1::sign_failure(
        *reservation.key(),
        reservation.command_digest(),
        payload.to_vec(),
        terminal_at_ms,
        role_signing_key_id,
        signing_key.as_bytes(),
    )
    .map_err(|error| store_error(error.message()))?;
    let canonical_bytes = signed
        .canonical_bytes()
        .map_err(|error| store_error(error.message()))?;
    let decoded = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&canonical_bytes)
        .map_err(|error| store_error(error.message()))?;
    decoded
        .verify_failure(
            reservation,
            role_signing_key_id,
            signing_key.verifying_key().as_bytes(),
        )
        .map_err(|error| store_error(error.message()))
}

#[cfg(debug_assertions)]
fn tenant_root_role_d1_integration_pending_record(
    role: CloudflareTenantRootDeriverRoleV1,
    epoch: u64,
    marker: u8,
    at_ms: u64,
) -> worker::Result<CloudflareTenantRootRoleShareRecordV1> {
    let identity = TenantRootIdentityV1::new(
        "r120-integration-org",
        "r120-integration-project",
        "workerd",
        "r120-integration-root",
        "v1",
    )
    .map_err(|error| store_error(error.message()))?;
    let custody_lineage = TenantRootCustodyLineageId::from_bytes([0x52; 16])
        .map_err(|error| store_error(error.message()))?;
    let epoch = TenantRootShareEpoch::new(epoch).map_err(|error| store_error(error.message()))?;
    let share_commitment = tenant_root_role_d1_integration_commitment(role, epoch)?;
    CloudflareTenantRootRoleShareRecordV1::new(CloudflareTenantRootRoleShareRecordInputV1 {
        identity,
        custody_lineage,
        epoch,
        role,
        sealed_share: CloudflareTenantRootSealedRoleShareV1::new(&[marker; 96])?,
        share_commitment,
        epoch_wrapping_key_ref: format!("workerd://tenant-root/{}", epoch.get()),
        lifecycle: CloudflareTenantRootRoleShareLifecycleV1::Pending(
            CloudflareTenantRootPendingShareV1::from_stored_digest(
                lifecycle_receipt(marker)?,
                at_ms,
            )?,
        ),
        created_at_ms: at_ms,
        updated_at_ms: at_ms,
    })
}

#[cfg(debug_assertions)]
fn tenant_root_role_d1_integration_commitment(
    role: CloudflareTenantRootDeriverRoleV1,
    epoch: TenantRootShareEpoch,
) -> worker::Result<MpcPrfShareCommitmentWireV1> {
    let point = match (epoch, role) {
        (TenantRootShareEpoch::INITIAL, CloudflareTenantRootDeriverRoleV1::DeriverA) => {
            INTEGRATION_EPOCH_ONE_DERIVER_A_POINT_V1
        }
        (TenantRootShareEpoch::INITIAL, CloudflareTenantRootDeriverRoleV1::DeriverB) => {
            INTEGRATION_EPOCH_ONE_DERIVER_B_POINT_V1
        }
        (_, CloudflareTenantRootDeriverRoleV1::DeriverA) => {
            INTEGRATION_EPOCH_TWO_DERIVER_A_POINT_V1
        }
        (_, CloudflareTenantRootDeriverRoleV1::DeriverB) => {
            INTEGRATION_EPOCH_TWO_DERIVER_B_POINT_V1
        }
    };
    let mut bytes = Vec::with_capacity(34);
    bytes.extend_from_slice(&role.share_id().to_be_bytes());
    bytes.extend_from_slice(&point);
    MpcPrfShareCommitmentWireV1::new(bytes).map_err(|error| store_error(error.message()))
}

#[cfg(debug_assertions)]
fn tenant_root_role_d1_integration_scope(
    record: &CloudflareTenantRootRoleShareRecordV1,
    session_seed: u8,
    nonce_seed: u8,
    expected_control_plane_revision: u64,
) -> worker::Result<TenantRootCommandScopeV1> {
    let identity_digest = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let session_id = TenantRootCeremonySessionIdV1::from_bytes([session_seed; 16])
        .map_err(|error| store_error(error.message()))?;
    let nonce = TenantRootCeremonyNonceV1::from_bytes([nonce_seed; 32])
        .map_err(|error| store_error(error.message()))?;
    let key = match record.role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => TenantRootCommandReplayKeyV1::deriver_a(
            identity_digest,
            record.custody_lineage,
            session_id,
            nonce,
        ),
        CloudflareTenantRootDeriverRoleV1::DeriverB => TenantRootCommandReplayKeyV1::deriver_b(
            identity_digest,
            record.custody_lineage,
            session_id,
            nonce,
        ),
    };
    TenantRootCommandScopeV1::new(key, record.epoch, expected_control_plane_revision)
        .map_err(|error| store_error(error.message()))
}

#[cfg(debug_assertions)]
fn tenant_root_role_d1_integration_activation(
    record: &CloudflareTenantRootRoleShareRecordV1,
    at_ms: u64,
) -> worker::Result<CloudflareTenantRootActivationV1> {
    let _ = (record, at_ms);
    Err(store_error(
        "tenant-root role-private D1 integration requires a verified activation evidence bundle",
    ))
}

#[cfg(debug_assertions)]
fn require_integration_failure<T>(
    result: worker::Result<T>,
    message: &'static str,
) -> worker::Result<()> {
    if result.is_ok() {
        return Err(store_error(message));
    }
    Ok(())
}

fn record_metadata(
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> worker::Result<TenantRootRoleD1MetadataV1> {
    Ok(TenantRootRoleD1MetadataV1 {
        identity_digest_hex: record.identity_digest_hex()?,
        custody_lineage_b64u: record.custody_lineage.to_base64url(),
        epoch: record.epoch.get().get(),
        role: record.role,
        lifecycle: record.lifecycle.as_str().to_owned(),
    })
}

fn serialize_activation_receipt_bytes<S>(bytes: &Vec<u8>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&encode_base64url_bytes_v1(bytes))
}

fn decode_activation_receipt_bytes(
    bytes: &[u8],
) -> worker::Result<TenantRootSignedActivationReceiptV1> {
    if bytes.is_empty() || bytes.len() > TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1 {
        return Err(store_error(
            "tenant-root activation receipt bytes have an invalid length",
        ));
    }
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(bytes)
        .map_err(|error| store_error(error.message()))?;
    let canonical_bytes = receipt
        .canonical_bytes()
        .map_err(|error| store_error(error.message()))?;
    if canonical_bytes != bytes {
        return Err(store_error(
            "tenant-root activation receipt bytes are not canonical",
        ));
    }
    Ok(receipt)
}

fn restore_import_session_tombstone_from_row(
    row: TenantRootRestoreImportSessionTombstoneD1RowV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    restore_session_id: TenantRootRestoreSessionIdV1,
    expected_role: CloudflareTenantRootDeriverRoleV1,
) -> worker::Result<CloudflareTenantRootRestoreImportSessionTombstoneV1> {
    let role = CloudflareTenantRootDeriverRoleV1::parse(
        row.role
            .as_deref()
            .ok_or_else(|| store_error("tenant-root restore-session tombstone has no role"))?,
    )?;
    if role != expected_role {
        return Err(store_error(
            "tenant-root restore-session tombstone belongs to the other Deriver",
        ));
    }
    let closed_at_ms = positive_u64_from_i64(
        "tenant-root restore import session close timestamp",
        row.closed_at_ms,
    )?;
    let activation_operation = row.activation_operation.ok_or_else(|| {
        store_error("tenant-root restore-session tombstone has no activation operation")
    })?;
    let activation_receipt_encoded = row.activation_receipt_b64u.ok_or_else(|| {
        store_error("tenant-root restore-session tombstone has no activation receipt")
    })?;
    let activation_receipt_bytes = decode_base64url_bytes_v1(
        "tenant-root restore-session activation receipt",
        &activation_receipt_encoded,
    )
    .map_err(|error| store_error(error.message()))?;
    if encode_base64url_bytes_v1(&activation_receipt_bytes) != activation_receipt_encoded {
        return Err(store_error(
            "tenant-root restore-session activation receipt is not canonical",
        ));
    }
    let activation_receipt = decode_activation_receipt_bytes(&activation_receipt_bytes)?;
    let activation_receipt_digest = activation_receipt
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let stored_activation_receipt_digest = decode_lower_hex_fixed::<32>(
        "tenant-root restore-session activation receipt digest",
        row.activation_receipt_digest_hex
            .as_deref()
            .ok_or_else(|| {
                store_error(
                    "tenant-root restore-session tombstone has no activation receipt digest",
                )
            })?,
    )?;
    if activation_receipt_digest
        != TenantRootLifecycleReceiptDigestV1::from_bytes(stored_activation_receipt_digest)
            .map_err(|error| store_error(error.message()))?
        || activation_operation != activation_receipt.transition().operation()
    {
        return Err(store_error(
            "tenant-root restore-session activation receipt projection is invalid",
        ));
    }
    if activation_receipt.identity_digest() != identity_digest
        || activation_receipt.custody_lineage() != custody_lineage
        || activation_receipt.transition()
            != TenantRootActivationReceiptTransitionV1::InitialCreation
        || activation_receipt
            .availability()
            .tenant_held_external_provenance()
            .map(|provenance| provenance.restore_session_id())
            != Some(restore_session_id)
    {
        return Err(store_error(
            "tenant-root restore-session activation receipt scope is invalid",
        ));
    }
    let cleanup_receipt_encoded = row.cleanup_receipt_b64u.ok_or_else(|| {
        store_error("tenant-root restore-session tombstone has no cleanup receipt")
    })?;
    let cleanup_receipt_bytes = decode_base64url_bytes_v1(
        "tenant-root restore-session cleanup receipt",
        &cleanup_receipt_encoded,
    )
    .map_err(|error| store_error(error.message()))?;
    if cleanup_receipt_bytes.is_empty()
        || cleanup_receipt_bytes.len() > MAX_RESTORE_PROMOTION_TERMINAL_RECEIPT_BYTES
        || encode_base64url_bytes_v1(&cleanup_receipt_bytes) != cleanup_receipt_encoded
    {
        return Err(store_error(
            "tenant-root restore-session cleanup receipt is malformed",
        ));
    }
    let cleanup_receipt_digest = TenantRootLifecycleReceiptDigestV1::from_bytes(
        Sha256::digest(&cleanup_receipt_bytes).into(),
    )
    .map_err(|error| store_error(error.message()))?;
    let stored_cleanup_receipt_digest = decode_lower_hex_fixed::<32>(
        "tenant-root restore-session cleanup receipt digest",
        row.cleanup_receipt_digest_hex.as_deref().ok_or_else(|| {
            store_error("tenant-root restore-session tombstone has no cleanup receipt digest")
        })?,
    )?;
    if cleanup_receipt_digest
        != TenantRootLifecycleReceiptDigestV1::from_bytes(stored_cleanup_receipt_digest)
            .map_err(|error| store_error(error.message()))?
    {
        return Err(store_error(
            "tenant-root restore-session cleanup receipt digest is invalid",
        ));
    }
    let cleanup_receipt = CloudflareTenantRootRestoreSessionCleanupReceiptV1 {
        bytes: cleanup_receipt_bytes,
        digest: cleanup_receipt_digest,
        closed_at_ms,
    };
    let tombstone = CloudflareTenantRootRestoreImportSessionTombstoneV1 {
        identity_digest,
        custody_lineage,
        restore_session_id,
        role,
        activation_operation,
        activation_receipt_bytes,
        activation_receipt_digest,
        cleanup_receipt,
        closed_at_ms,
    };
    tombstone.validate()?;
    Ok(tombstone)
}

fn validate_restore_refresh_promotion_timestamp(
    command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
    record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
) -> worker::Result<()> {
    let refreshed_at_ms = record.refreshed_at_ms().ok_or_else(|| {
        store_error("tenant-root restore refresh promotion has no refresh timestamp")
    })?;
    if refreshed_at_ms < command.context().issued_at_ms()
        || refreshed_at_ms > command.context().expires_at_ms()
    {
        return Err(store_error(
            "tenant-root restore refresh promotion refresh timestamp is outside its command context",
        ));
    }
    Ok(())
}

fn accepted_loss_availability_from_verified_receipt(
    activation: &VerifiedTenantRootSignedActivationReceiptV1,
    role: TenantRootManagedRestoreRoleV1,
) -> worker::Result<CloudflareTenantRootAvailabilityEvidenceV1> {
    let (authorization, authorization_digest) =
        accepted_loss_authorization_from_binding(activation.binding())?;
    validate_accepted_loss_authorization_against_activation(activation.binding(), &authorization)?;
    Ok(
        CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
            authorization_digest,
            identity_digest: activation.identity_digest(),
            custody_lineage: activation.custody_lineage(),
            role,
            epoch: activation_target_epoch(activation.binding()),
            share_commitment: activation_target_commitment(activation.binding(), role).clone(),
        },
    )
}

fn accepted_loss_authorization_from_binding(
    binding: &TenantRootActivationReceiptBindingV1,
) -> worker::Result<(
    TenantRootSignedAcceptedPermanentLossAuthorizationV1,
    TenantRootAcceptedPermanentLossAuthorizationDigestV1,
)> {
    let TenantRootActivationReceiptAvailabilityV1::AcceptedPermanentDerivationLoss {
        authorization_bytes,
        authorization_digest,
    } = binding.availability()
    else {
        return Err(store_error(
            "tenant-root activation receipt does not carry accepted-loss authorization",
        ));
    };
    let authorization =
        TenantRootSignedAcceptedPermanentLossAuthorizationV1::decode_canonical_bytes(
            authorization_bytes,
        )
        .map_err(|error| store_error(error.message()))?;
    if authorization
        .digest()
        .map_err(|error| store_error(error.message()))?
        != *authorization_digest
    {
        return Err(store_error(
            "tenant-root accepted-loss authorization digest does not match its bytes",
        ));
    }
    Ok((authorization, *authorization_digest))
}

fn validate_accepted_loss_authorization_against_activation(
    binding: &TenantRootActivationReceiptBindingV1,
    authorization: &TenantRootSignedAcceptedPermanentLossAuthorizationV1,
) -> worker::Result<()> {
    if authorization.identity_digest() != binding.identity_digest()
        || authorization.custody_lineage() != binding.custody_lineage()
        || authorization.transition() != binding.transition()
        || authorization.target_epoch() != activation_target_epoch(binding)
        || authorization.context_digest() != binding.context_digest()
        || authorization.commitments() != activation_target_commitments(binding)
        || authorization.installation_receipts() != activation_installation_receipts(binding)
        || authorization.expected_control_plane_revision()
            != binding.expected_control_plane_revision()
        || authorization.result_control_plane_revision() != binding.result_control_plane_revision()
        || authorization.issued_at_ms() != binding.issued_at_ms()
        || authorization.expires_at_ms() != binding.expires_at_ms()
    {
        return Err(store_error(
            "tenant-root accepted-loss authorization does not match activation receipt binding",
        ));
    }
    Ok(())
}

fn validate_activation_receipt_against_backup(
    activation: &VerifiedTenantRootSignedActivationReceiptV1,
    backup: &VerifiedTenantRootManagedBackupV1,
) -> worker::Result<()> {
    let binding = activation.binding();
    if binding.identity_digest() != backup.identity_digest()
        || binding.custody_lineage() != backup.custody_lineage()
    {
        return Err(store_error(
            "tenant-root activation receipt identity binding does not match managed backup",
        ));
    }
    if activation_target_epoch(binding) != backup.epoch()
        || activation_target_commitment(binding, backup.role()) != backup.share_commitment()
        || activation_installation_receipt(binding, backup.role())
            != backup.installation_receipt_digest()
        || activation_backup_receipt(binding, backup.role())? != backup.receipt_digest()
    {
        return Err(store_error(
            "tenant-root activation receipt binding does not match managed backup",
        ));
    }
    Ok(())
}

fn validate_activation_receipt_against_record(
    activation_receipt_bytes: &[u8],
    record: &CloudflareTenantRootRoleShareRecordV1,
    availability: &CloudflareTenantRootAvailabilityEvidenceV1,
) -> worker::Result<()> {
    let receipt = decode_activation_receipt_bytes(activation_receipt_bytes)?;
    let binding = receipt.binding();
    let role = record.role.managed_restore_role();
    let record_identity = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let expected_transition = if record.epoch == TenantRootShareEpoch::INITIAL {
        TenantRootActivationReceiptTransitionV1::InitialCreation
    } else {
        TenantRootActivationReceiptTransitionV1::RefreshSwap
    };
    if binding.identity_digest() != record_identity
        || binding.custody_lineage() != record.custody_lineage
        || binding.transition() != expected_transition
        || activation_target_epoch(binding) != record.epoch
        || activation_target_commitment(binding, role) != &record.share_commitment
        || activation_installation_receipt(binding, role)
            != record_installation_evidence_digest(record)?
    {
        return Err(store_error(
            "tenant-root activation receipt binding does not match the role-share record",
        ));
    }
    match availability {
        CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            role_backup_receipt_digest,
            identity_digest,
            custody_lineage,
            role: availability_role,
            epoch,
            share_commitment,
        } => {
            if *identity_digest != record_identity
                || *custody_lineage != record.custody_lineage
                || *availability_role != role
                || *epoch != record.epoch
                || share_commitment != &record.share_commitment
                || activation_backup_receipt(binding, role)? != *role_backup_receipt_digest
            {
                return Err(store_error(
                    "tenant-root activation backup evidence does not match the role-share record",
                ));
            }
        }
        CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
            authorization_digest,
            identity_digest,
            custody_lineage,
            role: availability_role,
            epoch,
            share_commitment,
        } => {
            if *identity_digest != record_identity
                || *custody_lineage != record.custody_lineage
                || *availability_role != role
                || *epoch != record.epoch
                || share_commitment != &record.share_commitment
            {
                return Err(store_error(
                    "tenant-root accepted-loss evidence does not match the role-share record",
                ));
            }
            let (authorization, receipt_digest) =
                accepted_loss_authorization_from_binding(binding)?;
            if receipt_digest != *authorization_digest {
                return Err(store_error(
                    "tenant-root accepted-loss authorization digest does not match its projection",
                ));
            }
            validate_accepted_loss_authorization_against_activation(binding, &authorization)?;
        }
        CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal { provenance } => {
            validate_tenant_held_external_provenance_against_binding(provenance, binding)?;
            if provenance.identity_digest() != record_identity
                || provenance.custody_lineage() != record.custody_lineage
            {
                return Err(store_error(
                    "tenant-root tenant-held external evidence does not match the role-share record",
                ));
            }
        }
    }
    Ok(())
}

fn validate_tenant_held_external_provenance_against_binding(
    provenance: &TenantRootTenantHeldExternalProvenanceV1,
    binding: &TenantRootActivationReceiptBindingV1,
) -> worker::Result<()> {
    let target_epoch = activation_target_epoch(binding);
    let target_commitments = activation_target_commitments(binding);
    let context_matches = match binding {
        TenantRootActivationReceiptBindingV1::InitialCreation(_) => {
            target_epoch == TenantRootShareEpoch::INITIAL
                && provenance.restore_context_digest() == binding.context_digest()
        }
        TenantRootActivationReceiptBindingV1::RefreshSwap(_) => {
            target_epoch != TenantRootShareEpoch::INITIAL
        }
    };
    if provenance.identity_digest() != binding.identity_digest()
        || provenance.custody_lineage() != binding.custody_lineage()
        || provenance.stable_root_commitment() != target_commitments.root_commitment()
        || !context_matches
    {
        return Err(store_error(
            "tenant-root tenant-held external provenance does not match activation scope",
        ));
    }
    Ok(())
}

fn validate_activation_receipt_against_swap_records(
    activation: &CloudflareTenantRootActivationV1,
    active: &CloudflareStoredTenantRootRoleShareV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
) -> worker::Result<()> {
    let receipt = decode_activation_receipt_bytes(&activation.activation_receipt_bytes)?;
    let TenantRootActivationReceiptBindingV1::RefreshSwap(binding) = receipt.binding() else {
        return Err(store_error(
            "tenant-root epoch swap requires a refresh activation receipt",
        ));
    };
    let active_identity = active
        .record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let pending_identity = pending
        .record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let active_role = active.record.role.managed_restore_role();
    let pending_role = pending.record.role.managed_restore_role();
    if active_identity != pending_identity
        || binding.identity_digest() != pending_identity
        || binding.custody_lineage() != pending.record.custody_lineage
        || binding.current_epoch() != active.record.epoch
        || binding.next_epoch() != pending.record.epoch
        || active_role != pending_role
        || activation_role_commitment(binding.current_commitments(), active_role)
            != &active.record.share_commitment
        || activation_role_commitment(binding.next_commitments(), pending_role)
            != &pending.record.share_commitment
    {
        return Err(store_error(
            "tenant-root refresh activation receipt does not match the epoch swap records",
        ));
    }
    Ok(())
}

fn activation_target_epoch(binding: &TenantRootActivationReceiptBindingV1) -> TenantRootShareEpoch {
    match binding {
        TenantRootActivationReceiptBindingV1::InitialCreation(_) => TenantRootShareEpoch::INITIAL,
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => binding.next_epoch(),
    }
}

fn activation_target_commitment(
    binding: &TenantRootActivationReceiptBindingV1,
    role: TenantRootManagedRestoreRoleV1,
) -> &MpcPrfShareCommitmentWireV1 {
    activation_role_commitment(activation_target_commitments(binding), role)
}

fn activation_target_commitments(
    binding: &TenantRootActivationReceiptBindingV1,
) -> &TenantRootEpochCommitmentsV1 {
    match binding {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => binding.commitments(),
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => binding.next_commitments(),
    }
}

fn activation_role_commitment(
    commitments: &TenantRootEpochCommitmentsV1,
    role: TenantRootManagedRestoreRoleV1,
) -> &MpcPrfShareCommitmentWireV1 {
    match role {
        TenantRootManagedRestoreRoleV1::DeriverA => commitments.deriver_a(),
        TenantRootManagedRestoreRoleV1::DeriverB => commitments.deriver_b(),
    }
}

fn activation_installation_receipt(
    binding: &TenantRootActivationReceiptBindingV1,
    role: TenantRootManagedRestoreRoleV1,
) -> TenantRootLifecycleReceiptDigestV1 {
    let receipts = activation_installation_receipts(binding);
    match role {
        TenantRootManagedRestoreRoleV1::DeriverA => receipts.deriver_a(),
        TenantRootManagedRestoreRoleV1::DeriverB => receipts.deriver_b(),
    }
}

fn activation_installation_receipts(
    binding: &TenantRootActivationReceiptBindingV1,
) -> TenantRootRoleInstallationReceiptsV1 {
    match binding {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => {
            binding.installation_receipts()
        }
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => {
            binding.installation_receipts()
        }
    }
}

fn activation_backup_receipt(
    binding: &TenantRootActivationReceiptBindingV1,
    role: TenantRootManagedRestoreRoleV1,
) -> worker::Result<TenantRootLifecycleReceiptDigestV1> {
    let availability = match binding {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => binding.availability(),
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => binding.availability(),
    };
    let receipts = match availability {
        TenantRootActivationReceiptAvailabilityV1::CurrentRoleBackups { receipts, .. } => *receipts,
        TenantRootActivationReceiptAvailabilityV1::AcceptedPermanentDerivationLoss { .. }
        | TenantRootActivationReceiptAvailabilityV1::TenantHeldExternal { .. } => {
            return Err(store_error(
                "tenant-root activation receipt does not carry current-backup evidence",
            ));
        }
    };
    Ok(match role {
        TenantRootManagedRestoreRoleV1::DeriverA => receipts.deriver_a(),
        TenantRootManagedRestoreRoleV1::DeriverB => receipts.deriver_b(),
    })
}

fn record_installation_evidence_digest(
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> worker::Result<TenantRootLifecycleReceiptDigestV1> {
    match &record.lifecycle {
        CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) => {
            Ok(pending.installation_evidence_digest)
        }
        CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
            Ok(active.pending.installation_evidence_digest)
        }
        CloudflareTenantRootRoleShareLifecycleV1::Retired(retired) => {
            Ok(retired.active.pending.installation_evidence_digest)
        }
    }
}

const TENANT_ROOT_ROLE_COMMAND_PAYLOAD_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-role-command-payload/v1";
const TENANT_ROOT_REFRESH_INSERT_PENDING_PAYLOAD_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-refresh-insert-pending-payload/v1";
const TENANT_ROOT_AUTHORIZED_CLEANUP_PAYLOAD_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-authorized-cleanup-payload/v1";

fn validate_command_scope_for_record(
    scope: &TenantRootCommandScopeV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
    expected_revision: i64,
    operation: &'static str,
) -> worker::Result<()> {
    let identity_digest = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if scope.key().identity_digest() != identity_digest
        || scope.key().custody_lineage() != record.custody_lineage
        || scope.key().role().as_str() != record.role.as_str()
        || scope.epoch() != record.epoch
    {
        return Err(store_error(format!(
            "{operation} command scope does not match its role-share record"
        )));
    }
    if expected_revision <= 0 {
        return Err(store_error(format!(
            "{operation} command has an invalid local row revision"
        )));
    }
    // Authority must be established by the caller before this module-private
    // helper accepts the scope; a raw scope does not establish issuer authority.
    let _ = scope.expected_control_plane_revision();
    Ok(())
}

#[allow(dead_code)]
fn initial_creation_scope_for_record(
    command: &VerifiedTenantRootRoleCreationCommandV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
    reserved_at_ms: u64,
) -> worker::Result<TenantRootCommandScopeV1> {
    command
        .require_fresh(reserved_at_ms)
        .map_err(|error| store_error(error.message()))?;
    initial_creation_scope_without_freshness(command, record)
}

#[allow(dead_code)]
fn initial_creation_scope_without_freshness(
    command: &VerifiedTenantRootRoleCreationCommandV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> worker::Result<TenantRootCommandScopeV1> {
    let scope = command.scope();
    validate_command_scope_for_record(&scope, record, 1, "tenant-root initial role creation")?;
    Ok(scope)
}

#[allow(dead_code)]
fn cloudflare_role_for_protocol(
    role: TwoPartyDeriverRole,
) -> worker::Result<CloudflareTenantRootDeriverRoleV1> {
    Ok(match role {
        TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
        TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
    })
}

fn protocol_role_for_cloudflare(role: CloudflareTenantRootDeriverRoleV1) -> TwoPartyDeriverRole {
    match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        CloudflareTenantRootDeriverRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    }
}

fn protocol_role_for_managed_restore(role: TenantRootManagedRestoreRoleV1) -> TwoPartyDeriverRole {
    match role {
        TenantRootManagedRestoreRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        TenantRootManagedRestoreRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    }
}

fn validate_initial_creation_role_signer(
    creation: &CloudflareTenantRootInitialCreationInputV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
) -> worker::Result<()> {
    let role = creation.command.role();
    if role_signer.role() != role {
        return Err(store_error(
            "tenant-root initial creation receipt signer role does not match its command",
        ));
    }
    if role_signer.signing_key_id()
        != creation
            .evidence
            .evidence()
            .transcript()
            .context()
            .signing_key_id(role)
    {
        return Err(store_error(
            "tenant-root initial creation receipt signer key does not match its evidence",
        ));
    }
    Ok(())
}

#[allow(dead_code)]
fn validate_initial_creation_binding(
    command: &VerifiedTenantRootRoleCreationCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> worker::Result<()> {
    record.validate()?;
    let transcript = evidence.evidence().transcript();
    let context = transcript.context();
    let record_identity = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let evidence_context_digest = context
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if command.role() != transcript.role() {
        return Err(store_error(
            "tenant-root initial creation evidence role does not match its command",
        ));
    }
    if record.role != cloudflare_role_for_protocol(transcript.role())? {
        return Err(store_error(
            "tenant-root initial creation share role does not match its evidence",
        ));
    }
    if command.identity_digest() != record_identity
        || command.identity_digest() != context.identity_digest()
        || command.custody_lineage() != record.custody_lineage
        || command.custody_lineage() != context.custody_lineage()
        || command.creation_context_digest() != evidence_context_digest
        || command.epoch() != TenantRootShareEpoch::INITIAL
        || record.epoch != TenantRootShareEpoch::INITIAL
    {
        return Err(store_error(
            "tenant-root initial creation command, evidence, and share identity do not match",
        ));
    }
    let evidence_commitment =
        MpcPrfShareCommitmentWireV1::new(transcript.commitment().to_bytes().to_vec())
            .map_err(|error| store_error(error.message()))?;
    if record.share_commitment != evidence_commitment {
        return Err(store_error(
            "tenant-root initial creation share commitment does not match its evidence",
        ));
    }
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = &record.lifecycle else {
        return Err(store_error(
            "tenant-root initial creation requires a pending role share",
        ));
    };
    let evidence_digest = evidence
        .lifecycle_receipt_digest()
        .map_err(|error| store_error(error.message()))?;
    if pending.installation_evidence_digest != evidence_digest {
        return Err(store_error(
            "tenant-root pending installation evidence digest does not match its exact wire",
        ));
    }
    Ok(())
}

#[allow(dead_code)]
fn validate_initial_creation_success_receipt_payload(
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    receipt: &VerifiedTenantRootCommandSuccessReceiptV1,
) -> worker::Result<()> {
    if receipt.payload_bytes() != evidence.canonical_bytes() {
        return Err(store_error(
            "tenant-root initial creation receipt payload does not match its exact evidence wire",
        ));
    }
    Ok(())
}

fn validate_refresh_command_evidence(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
) -> worker::Result<TenantRootLifecycleReceiptDigestV1> {
    let transcript = evidence.evidence().transcript();
    let context = transcript.context();
    let TenantRootCeremonyEpochsV1::Refresh { current, next } = context.epochs() else {
        return Err(store_error(
            "tenant-root refresh installation requires a refresh ceremony context",
        ));
    };
    let context_digest = context
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if command.identity_digest() != context.identity_digest()
        || command.custody_lineage() != context.custody_lineage()
        || command.refresh_context_digest() != context_digest
        || command.current_epoch() != current
        || command.next_epoch() != next
        || command.session_id() != context.session_id()
        || command.nonce() != context.nonce()
        || command.role() != transcript.role()
    {
        return Err(store_error(
            "tenant-root refresh command and installation evidence do not match",
        ));
    }
    evidence
        .lifecycle_receipt_digest()
        .map_err(|error| store_error(error.message()))
}

fn validate_refresh_sealed_binding(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    sealed_binding: &TenantRootOnlineRoleShareBindingV1,
    share_identity_digest: TenantRootIdentityDigestV1,
    evidence_digest: TenantRootLifecycleReceiptDigestV1,
) -> worker::Result<()> {
    let transcript = evidence.evidence().transcript();
    let evidence_commitment =
        MpcPrfShareCommitmentWireV1::new(transcript.commitment().to_bytes().to_vec())
            .map_err(|error| store_error(error.message()))?;
    if share_identity_digest != command.identity_digest()
        || sealed_binding.identity_digest() != share_identity_digest
        || sealed_binding.custody_lineage() != command.custody_lineage()
        || sealed_binding.role() != command.role()
        || sealed_binding.epoch() != command.next_epoch()
        || sealed_binding.share_commitment() != &evidence_commitment
        || sealed_binding.installation_evidence_digest() != evidence_digest
    {
        return Err(store_error(
            "tenant-root refresh sealed share does not match its command and evidence",
        ));
    }
    Ok(())
}

fn validate_refresh_record_binding(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> worker::Result<()> {
    let evidence_digest = validate_refresh_command_evidence(command, evidence)?;
    let transcript = evidence.evidence().transcript();
    let evidence_commitment =
        MpcPrfShareCommitmentWireV1::new(transcript.commitment().to_bytes().to_vec())
            .map_err(|error| store_error(error.message()))?;
    let identity_digest = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let expected_role = cloudflare_role_for_protocol(command.role())?;
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = &record.lifecycle else {
        return Err(store_error(
            "tenant-root refresh insertion requires a pending role share",
        ));
    };
    if identity_digest != command.identity_digest()
        || record.custody_lineage != command.custody_lineage()
        || record.epoch != command.next_epoch()
        || record.role != expected_role
        || record.share_commitment != evidence_commitment
        || pending.installation_evidence_digest() != evidence_digest
    {
        return Err(store_error(
            "tenant-root refresh role-share record does not match its command and evidence",
        ));
    }
    record.validate()
}

fn validate_refresh_replay_link(
    record: &CloudflareTenantRootRoleShareRecordV1,
    replay_key: &TenantRootCommandReplayKeyV1,
) -> worker::Result<()> {
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = record.lifecycle() else {
        return Err(store_error(
            "tenant-root refresh replay link requires a pending role share",
        ));
    };
    let replay_key_digest = replay_key
        .storage_key_digest()
        .map_err(|error| store_error(error.message()))?;
    if pending.refresh_replay_key_digest() != Some(replay_key_digest) {
        return Err(store_error(
            "tenant-root refresh pending row does not link its exact replay key",
        ));
    }
    Ok(())
}

fn validate_refresh_success_receipt_payload(
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    receipt: &VerifiedTenantRootCommandSuccessReceiptV1,
) -> worker::Result<()> {
    if receipt.payload_bytes() != evidence.canonical_bytes() {
        return Err(store_error(
            "tenant-root refresh receipt payload does not match its exact evidence wire",
        ));
    }
    Ok(())
}

fn validate_reserved_command(
    scope: &TenantRootCommandScopeV1,
    reservation: &ReservedTenantRootCommandV1,
    operation: TenantRootCommandOperationV1,
    operation_name: &'static str,
) -> worker::Result<()> {
    let command_digest = scope
        .command_digest(operation)
        .map_err(|error| store_error(error.message()))?;
    if reservation.key() != scope.key() || reservation.command_digest() != command_digest {
        return Err(store_error(format!(
            "{operation_name} command does not match its authority reservation"
        )));
    }
    Ok(())
}

fn decode_stored_terminal_receipt(
    terminal_kind: TenantRootCommandTerminalKindV1,
    receipt_b64u: Option<&str>,
    receipt_digest_hex: Option<&str>,
    terminal_at_ms: Option<i64>,
    key: TenantRootCommandReplayKeyV1,
    command_digest: TenantRootProtocolDigestV1,
) -> worker::Result<DecodedTenantRootCommandTerminalReceiptV1> {
    let receipt_b64u = receipt_b64u
        .ok_or_else(|| store_error("terminal tenant-root command row omitted receipt bytes"))?;
    let receipt_bytes = decode_base64url_bytes_v1("tenant-root command receipt", receipt_b64u)
        .map_err(|error| store_error(error.message()))?;
    if receipt_bytes.is_empty()
        || receipt_bytes.len() > TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BYTES_V1
        || encode_base64url_bytes_v1(&receipt_bytes) != receipt_b64u
    {
        return Err(store_error(
            "terminal tenant-root command receipt bytes are malformed",
        ));
    }

    // D1 stores the signed bytes without a role verifier. The receipt consumer
    // verifies Ed25519 with the retained role key after this canonical binding.
    let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .map_err(|error| store_error(error.message()))?;
    let canonical_bytes = receipt
        .canonical_bytes()
        .map_err(|error| store_error(error.message()))?;
    if canonical_bytes != receipt_bytes {
        return Err(store_error(
            "terminal tenant-root command receipt bytes are not canonical",
        ));
    }
    if receipt.outcome() != terminal_kind.expected_outcome() {
        return Err(store_error(
            "terminal tenant-root command receipt outcome conflicts with durable status",
        ));
    }
    if receipt.key() != &key {
        return Err(store_error(
            "terminal tenant-root command receipt replay key conflicts with durable state",
        ));
    }
    if receipt.command_digest() != command_digest {
        return Err(store_error(
            "terminal tenant-root command receipt command digest conflicts with durable state",
        ));
    }
    let receipt_digest = TenantRootProtocolDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
        "tenant-root command receipt digest",
        receipt_digest_hex.ok_or_else(|| {
            store_error("terminal tenant-root command row omitted receipt digest")
        })?,
    )?)
    .map_err(|error| store_error(error.message()))?;
    let decoded_receipt_digest = receipt
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if decoded_receipt_digest != receipt_digest {
        return Err(store_error(
            "terminal tenant-root command receipt digest conflicts with durable state",
        ));
    }
    let terminal_at_ms = positive_u64_from_i64(
        "tenant-root command terminal timestamp",
        terminal_at_ms.ok_or_else(|| {
            store_error("terminal tenant-root command row omitted terminal timestamp")
        })?,
    )?;
    if receipt.terminal_at_ms() != terminal_at_ms {
        return Err(store_error(
            "terminal tenant-root command receipt timestamp conflicts with durable state",
        ));
    }

    Ok(DecodedTenantRootCommandTerminalReceiptV1 {
        receipt_bytes,
        receipt_digest,
        terminal_at_ms,
    })
}

fn replay_reservation_from_stored(
    stored: &StoredTenantRootCommandReplayV1,
) -> worker::Result<ReservedTenantRootCommandV1> {
    if !matches!(&stored.record, TenantRootCommandReplayRecordV1::Reserved(_)) {
        return Err(store_error(
            "tenant-root replay row is not resumable as a reservation",
        ));
    }
    fresh_reservation_from_stored(stored)
}

fn replay_executed_from_stored(
    stored: &StoredTenantRootCommandReplayV1,
) -> worker::Result<ExecutedTenantRootCommandV1> {
    if !matches!(&stored.record, TenantRootCommandReplayRecordV1::Executed(_)) {
        return Err(store_error(
            "tenant-root replay row is not resumable as an executed command",
        ));
    }
    let executed_at_ms = stored.executed_at_ms.ok_or_else(|| {
        store_error("executed tenant-root replay row omitted execution timestamp")
    })?;
    fresh_reservation_from_stored(stored)?
        .checkpoint_executed(executed_at_ms)
        .map_err(|error| store_error(error.message()))
}

fn fresh_reservation_from_stored(
    stored: &StoredTenantRootCommandReplayV1,
) -> worker::Result<ReservedTenantRootCommandV1> {
    let key = *stored.record.key();
    let command_digest = stored.record.command_digest();
    match reserve_tenant_root_command_v1(None, key, command_digest, stored.reserved_at_ms)
        .map_err(|error| store_error(error.message()))?
    {
        TenantRootCommandReplayDecisionV1::Execute(reservation) => Ok(reservation),
        _ => Err(store_error(
            "tenant-root replay row could not reconstruct its reservation",
        )),
    }
}

fn insert_pending_payload_digest(
    record: &CloudflareTenantRootRoleShareRecordV1,
    expected_revision: i64,
) -> worker::Result<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("insert_pending")?;
    push_record_public_payload(&mut bytes, record)?;
    push_command_i64(&mut bytes, expected_revision)?;
    finish_command_payload(bytes)
}

fn refresh_insert_pending_payload_digest(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
    expected_revision: i64,
) -> worker::Result<TenantRootProtocolDigestV1> {
    let row_payload_digest = insert_pending_payload_digest(record, expected_revision)?;
    let mut bytes = Vec::new();
    push_command_field(
        &mut bytes,
        TENANT_ROOT_REFRESH_INSERT_PENDING_PAYLOAD_DOMAIN_V1,
    )?;
    push_command_field(&mut bytes, command.digest().as_bytes())?;
    push_command_field(&mut bytes, row_payload_digest.as_bytes())?;
    finish_command_payload(bytes)
}

fn refresh_admission_operation_digest(
    scope: &TenantRootCommandScopeV1,
    command_digest: TenantRootProtocolDigestV1,
) -> worker::Result<TenantRootProtocolDigestV1> {
    scope
        .command_digest(TenantRootCommandOperationV1::insert_pending(command_digest))
        .map_err(|error| store_error(error.message()))
}

fn activate_initial_payload_digest(
    pending: &CloudflareStoredTenantRootRoleShareV1,
    activation: &CloudflareTenantRootActivationV1,
    updated_at_ms: u64,
    expected_revision: i64,
) -> worker::Result<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("activate_initial")?;
    push_record_public_payload(&mut bytes, &pending.record)?;
    push_command_i64(&mut bytes, expected_revision)?;
    push_activation_payload(&mut bytes, activation)?;
    push_command_u64(&mut bytes, updated_at_ms)?;
    finish_command_payload(bytes)
}

#[allow(clippy::too_many_arguments)]
fn managed_restore_forward_refresh_payload_digest(
    scope: &TenantRootCommandScopeV1,
    restored_pending: &CloudflareStoredTenantRootRoleShareV1,
    refresh_pending: &CloudflareStoredTenantRootRoleShareV1,
    activation: &CloudflareTenantRootActivationV1,
    capability_digest: TenantRootLifecycleReceiptDigestV1,
    backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    updated_at_ms: u64,
    expected_restored_revision: i64,
    expected_refresh_revision: i64,
) -> worker::Result<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("managed_restore_forward_refresh")?;
    let key = scope.key();
    push_command_field(&mut bytes, key.identity_digest().as_bytes())?;
    push_command_field(&mut bytes, key.custody_lineage().as_bytes())?;
    push_command_field(&mut bytes, key.session_id().as_bytes())?;
    push_command_field(&mut bytes, key.nonce().as_bytes())?;
    push_command_field(&mut bytes, key.role().as_str().as_bytes())?;
    push_command_u64(&mut bytes, scope.epoch().get().get())?;
    push_command_u64(&mut bytes, scope.expected_control_plane_revision())?;
    push_record_public_payload(&mut bytes, &restored_pending.record)?;
    push_command_i64(&mut bytes, expected_restored_revision)?;
    push_record_public_payload(&mut bytes, &refresh_pending.record)?;
    push_command_i64(&mut bytes, expected_refresh_revision)?;
    push_activation_payload(&mut bytes, activation)?;
    push_command_field(&mut bytes, capability_digest.as_bytes())?;
    push_command_field(&mut bytes, backup_receipt_digest.as_bytes())?;
    push_command_field(&mut bytes, installation_receipt_digest.as_bytes())?;
    push_command_u64(&mut bytes, updated_at_ms)?;
    finish_command_payload(bytes)
}

#[allow(clippy::too_many_arguments)]
fn swap_active_epoch_payload_digest(
    active: &CloudflareStoredTenantRootRoleShareV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
    activation: &CloudflareTenantRootActivationV1,
    retirement: &CloudflareTenantRootRetirementV1,
    updated_at_ms: u64,
    expected_active_revision: i64,
    expected_pending_revision: i64,
) -> worker::Result<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("swap_active_epoch")?;
    push_record_public_payload(&mut bytes, &active.record)?;
    push_command_i64(&mut bytes, expected_active_revision)?;
    push_record_public_payload(&mut bytes, &pending.record)?;
    push_command_i64(&mut bytes, expected_pending_revision)?;
    push_activation_payload(&mut bytes, activation)?;
    push_retirement_payload(&mut bytes, retirement)?;
    push_command_u64(&mut bytes, updated_at_ms)?;
    finish_command_payload(bytes)
}

fn cleanup_pending_payload_digest(
    pending: &CloudflareStoredTenantRootRoleShareV1,
    expected_revision: i64,
) -> worker::Result<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("cleanup_pending")?;
    push_record_public_payload(&mut bytes, &pending.record)?;
    push_command_i64(&mut bytes, expected_revision)?;
    finish_command_payload(bytes)
}

fn authorized_cleanup_pending_payload_digest(
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
    expected_revision: i64,
) -> worker::Result<TenantRootProtocolDigestV1> {
    let row_payload_digest = cleanup_pending_payload_digest(pending, expected_revision)?;
    let authorization_digest = authorization
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let mut bytes = Vec::new();
    push_command_field(&mut bytes, TENANT_ROOT_AUTHORIZED_CLEANUP_PAYLOAD_DOMAIN_V1)?;
    push_command_field(&mut bytes, authorization_digest.as_bytes())?;
    push_command_field(&mut bytes, row_payload_digest.as_bytes())?;
    finish_command_payload(bytes)
}

fn cleanup_retired_payload_digest(
    retired: &CloudflareStoredTenantRootRoleShareV1,
    expected_retired_revision: i64,
    expected_active_epoch: TenantRootShareEpoch,
    expected_active_revision: i64,
) -> worker::Result<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("cleanup_retired")?;
    push_record_public_payload(&mut bytes, &retired.record)?;
    push_command_i64(&mut bytes, expected_retired_revision)?;
    push_command_u64(&mut bytes, expected_active_epoch.get().get())?;
    push_command_i64(&mut bytes, expected_active_revision)?;
    finish_command_payload(bytes)
}

fn authorized_cleanup_retired_payload_digest(
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
    retired: &CloudflareStoredTenantRootRoleShareV1,
    expected_retired_revision: i64,
    expected_active_epoch: TenantRootShareEpoch,
    expected_active_revision: i64,
) -> worker::Result<TenantRootProtocolDigestV1> {
    let row_payload_digest = cleanup_retired_payload_digest(
        retired,
        expected_retired_revision,
        expected_active_epoch,
        expected_active_revision,
    )?;
    let authorization_digest = authorization
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let mut bytes = Vec::new();
    push_command_field(&mut bytes, TENANT_ROOT_AUTHORIZED_CLEANUP_PAYLOAD_DOMAIN_V1)?;
    push_command_field(&mut bytes, authorization_digest.as_bytes())?;
    push_command_field(&mut bytes, row_payload_digest.as_bytes())?;
    finish_command_payload(bytes)
}

fn authorized_cleanup_retired_absent_payload_digest(
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
) -> worker::Result<TenantRootProtocolDigestV1> {
    let authorization_digest = authorization
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let mut bytes = command_payload_start("authorized_cleanup_retired_absent")?;
    push_command_field(&mut bytes, authorization_digest.as_bytes())?;
    finish_command_payload(bytes)
}

fn validate_authorized_cleanup_pending(
    cipher: &TenantRootRoleD1CipherV1,
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
) -> worker::Result<()> {
    validate_pending_stored_record(cipher, pending)?;
    let record_role = tenant_root_protocol_role_of(pending.record.role);
    let identity_digest = pending
        .record
        .identity()
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let evidence_digest = record_installation_evidence_digest(&pending.record)?;
    if authorization.role() != record_role
        || authorization.identity_digest() != identity_digest
        || authorization.custody_lineage() != pending.record.custody_lineage
        || authorization.epoch() != pending.record.epoch
        || authorization.expected_row_revision() != pending.revision
        || authorization
            .pending_installation_evidence_digest()
            .map_err(|error| store_error(error.message()))?
            .as_bytes()
            != evidence_digest.as_bytes()
    {
        return Err(store_error(
            "tenant-root cleanup authorization does not name the authoritative pending row",
        ));
    }
    Ok(())
}

fn validate_authorized_cleanup_retired(
    cipher: &TenantRootRoleD1CipherV1,
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
    retired: &CloudflareStoredTenantRootRoleShareV1,
    active: &CloudflareStoredTenantRootRoleShareV1,
) -> worker::Result<()> {
    validate_retired_stored_record(cipher, retired)?;
    validate_active_stored_record(cipher, active)?;
    let TenantRootRoleCleanupTargetV1::Retired {
        identity_digest,
        custody_lineage,
        role,
        retired_epoch,
        expected_retired_revision,
        expected_active_epoch,
        expected_active_revision,
    } = authorization.target()
    else {
        return Err(store_error(
            "tenant-root retired cleanup requires a retired authorization",
        ));
    };
    let retired_identity = retired
        .record()
        .identity()
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let active_identity = active
        .record()
        .identity()
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let retired_role = tenant_root_protocol_role_of(retired.record().role());
    let active_role = tenant_root_protocol_role_of(active.record().role());
    if retired_identity != *identity_digest
        || active_identity != *identity_digest
        || retired.record().custody_lineage() != *custody_lineage
        || active.record().custody_lineage() != *custody_lineage
        || retired_role != *role
        || active_role != *role
        || retired.record().epoch() != *retired_epoch
        || retired.revision() != *expected_retired_revision
        || active.record().epoch() != *expected_active_epoch
        || active.revision() != *expected_active_revision
        || retired
            .record()
            .epoch()
            .next()
            .map_err(|error| store_error(error.message()))?
            != *expected_active_epoch
    {
        return Err(store_error(
            "tenant-root cleanup authorization does not name the authoritative retired row and active successor",
        ));
    }
    Ok(())
}

fn validate_authorized_cleanup_retired_absent(
    cipher: &TenantRootRoleD1CipherV1,
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
    active: &CloudflareStoredTenantRootRoleShareV1,
) -> worker::Result<()> {
    validate_active_stored_record(cipher, active)?;
    let TenantRootRoleCleanupTargetV1::Retired {
        identity_digest,
        custody_lineage,
        role,
        retired_epoch,
        expected_retired_revision,
        expected_active_epoch,
        expected_active_revision,
    } = authorization.target()
    else {
        return Err(store_error(
            "tenant-root absent retired cleanup requires a retired authorization",
        ));
    };
    let active_identity = active
        .record()
        .identity()
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let active_role = tenant_root_protocol_role_of(active.record().role());
    if active_identity != *identity_digest
        || active.record().custody_lineage() != *custody_lineage
        || active_role != *role
        || active.record().epoch() != *expected_active_epoch
        || active.revision() != *expected_active_revision
        || *expected_retired_revision <= 0
        || retired_epoch
            .next()
            .map_err(|error| store_error(error.message()))?
            != *expected_active_epoch
    {
        return Err(store_error(
            "tenant-root absent retired cleanup authorization does not name the active successor",
        ));
    }
    Ok(())
}

fn command_payload_start(operation: &'static str) -> worker::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    push_command_field(&mut bytes, TENANT_ROOT_ROLE_COMMAND_PAYLOAD_DOMAIN_V1)?;
    push_command_field(&mut bytes, operation.as_bytes())?;
    Ok(bytes)
}

fn finish_command_payload(bytes: Vec<u8>) -> worker::Result<TenantRootProtocolDigestV1> {
    TenantRootProtocolDigestV1::from_bytes(Sha256::digest(bytes).into())
        .map_err(|error| store_error(error.message()))
}

fn push_record_public_payload(
    bytes: &mut Vec<u8>,
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> worker::Result<()> {
    record.validate()?;
    let identity_digest = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    push_command_field(bytes, identity_digest.as_bytes())?;
    push_command_field(bytes, record.custody_lineage.as_bytes())?;
    push_command_u64(bytes, record.epoch.get().get())?;
    push_command_field(bytes, record.role.as_str().as_bytes())?;
    push_command_field(
        bytes,
        record.sealed_share.ciphertext_digest_hex().as_bytes(),
    )?;
    push_command_field(bytes, record.share_commitment.as_bytes())?;
    push_command_field(bytes, record.epoch_wrapping_key_ref.as_bytes())?;
    push_lifecycle_public_payload(bytes, &record.lifecycle)?;
    push_command_u64(bytes, record.created_at_ms)?;
    push_command_u64(bytes, record.updated_at_ms)?;
    Ok(())
}

fn push_lifecycle_public_payload(
    bytes: &mut Vec<u8>,
    lifecycle: &CloudflareTenantRootRoleShareLifecycleV1,
) -> worker::Result<()> {
    match lifecycle {
        CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) => {
            push_command_field(bytes, b"pending")?;
            push_pending_public_payload(bytes, pending)?;
        }
        CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
            push_command_field(bytes, b"active")?;
            push_active_public_payload(bytes, active)?;
        }
        CloudflareTenantRootRoleShareLifecycleV1::Retired(retired) => {
            push_command_field(bytes, b"retired")?;
            push_retired_public_payload(bytes, retired)?;
        }
    }
    Ok(())
}

fn push_pending_public_payload(
    bytes: &mut Vec<u8>,
    pending: &CloudflareTenantRootPendingShareV1,
) -> worker::Result<()> {
    push_command_field(bytes, pending.installation_evidence_digest.as_bytes())?;
    push_command_u64(bytes, pending.staged_at_ms)?;
    match &pending.origin {
        CloudflareTenantRootPendingShareOriginV1::Ceremony => {
            push_command_field(bytes, b"ceremony")?;
        }
        CloudflareTenantRootPendingShareOriginV1::Refresh { replay_key_digest } => {
            push_command_field(bytes, b"refresh")?;
            push_command_field(bytes, replay_key_digest.as_bytes())?;
        }
        CloudflareTenantRootPendingShareOriginV1::ManagedRestore {
            capability_digest,
            backup_receipt_digest,
        } => {
            push_command_field(bytes, b"managed_restore")?;
            push_command_field(bytes, capability_digest.as_bytes())?;
            push_command_field(bytes, backup_receipt_digest.as_bytes())?;
        }
    }
    Ok(())
}

fn push_active_public_payload(
    bytes: &mut Vec<u8>,
    active: &CloudflareTenantRootActiveShareV1,
) -> worker::Result<()> {
    push_pending_public_payload(bytes, &active.pending)?;
    push_activation_payload(bytes, &active.activation)
}

fn push_retired_public_payload(
    bytes: &mut Vec<u8>,
    retired: &CloudflareTenantRootRetiredShareV1,
) -> worker::Result<()> {
    push_active_public_payload(bytes, &retired.active)?;
    push_retirement_payload(bytes, &retired.retirement)
}

fn push_activation_payload(
    bytes: &mut Vec<u8>,
    activation: &CloudflareTenantRootActivationV1,
) -> worker::Result<()> {
    activation.validate()?;
    match &activation.availability {
        CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            role_backup_receipt_digest,
            identity_digest,
            custody_lineage,
            role,
            epoch,
            share_commitment,
        } => {
            push_command_field(bytes, b"current_role_backup")?;
            push_command_field(bytes, role_backup_receipt_digest.as_bytes())?;
            push_command_field(bytes, identity_digest.as_bytes())?;
            push_command_field(bytes, custody_lineage.as_bytes())?;
            push_command_field(bytes, managed_restore_role_str(*role).as_bytes())?;
            push_command_u64(bytes, epoch.get().get())?;
            push_command_field(bytes, share_commitment.as_bytes())?;
        }
        CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
            authorization_digest,
            identity_digest,
            custody_lineage,
            role,
            epoch,
            share_commitment,
        } => {
            push_command_field(bytes, b"accepted_permanent_derivation_loss")?;
            push_command_field(bytes, authorization_digest.as_bytes())?;
            push_command_field(bytes, identity_digest.as_bytes())?;
            push_command_field(bytes, custody_lineage.as_bytes())?;
            push_command_field(bytes, managed_restore_role_str(*role).as_bytes())?;
            push_command_u64(bytes, epoch.get().get())?;
            push_command_field(bytes, share_commitment.as_bytes())?;
        }
        CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal { provenance } => {
            push_command_field(bytes, b"tenant_held_external")?;
            push_command_field(bytes, provenance.identity_digest().as_bytes())?;
            push_command_field(bytes, provenance.custody_lineage().as_bytes())?;
            push_command_field(bytes, provenance.destination_fingerprint().as_bytes())?;
            push_command_field(bytes, provenance.restore_session_id().as_bytes())?;
            push_command_field(bytes, provenance.recovery_set_id().as_bytes())?;
            push_command_field(bytes, provenance.manifest_digest())?;
            push_command_field(
                bytes,
                provenance.deriver_a_acceptance_receipt_digest().as_bytes(),
            )?;
            push_command_field(
                bytes,
                provenance.deriver_b_acceptance_receipt_digest().as_bytes(),
            )?;
            push_command_field(bytes, provenance.deriver_a_imported_commitment().as_bytes())?;
            push_command_field(bytes, provenance.deriver_b_imported_commitment().as_bytes())?;
            push_command_field(bytes, provenance.stable_root_commitment())?;
            push_command_field(bytes, provenance.restore_context_digest().as_bytes())?;
            push_command_field(
                bytes,
                provenance.restore_refresh_command_digest().as_bytes(),
            )?;
        }
    }
    push_command_field(bytes, &activation.activation_receipt_bytes)?;
    push_command_u64(bytes, activation.activated_at_ms)
}

const fn managed_restore_role_str(role: TenantRootManagedRestoreRoleV1) -> &'static str {
    match role {
        TenantRootManagedRestoreRoleV1::DeriverA => "deriver_a",
        TenantRootManagedRestoreRoleV1::DeriverB => "deriver_b",
    }
}

fn push_retirement_payload(
    bytes: &mut Vec<u8>,
    retirement: &CloudflareTenantRootRetirementV1,
) -> worker::Result<()> {
    push_command_field(bytes, retirement.retirement_receipt_digest.as_bytes())?;
    push_command_u64(bytes, retirement.retired_at_ms)
}

fn push_command_u64(bytes: &mut Vec<u8>, value: u64) -> worker::Result<()> {
    push_command_field(bytes, &value.to_be_bytes())
}

fn push_command_i64(bytes: &mut Vec<u8>, value: i64) -> worker::Result<()> {
    let value = u64::try_from(value)
        .map_err(|_| store_error("tenant-root command local revision is invalid"))?;
    push_command_u64(bytes, value)
}

fn push_command_field(bytes: &mut Vec<u8>, value: &[u8]) -> worker::Result<()> {
    let length = u32::try_from(value.len())
        .map_err(|_| store_error("tenant-root command payload field is too long"))?;
    bytes.extend_from_slice(&length.to_be_bytes());
    bytes.extend_from_slice(value);
    Ok(())
}

fn identity_digest_hex(identity: &TenantRootIdentityV1) -> worker::Result<String> {
    identity
        .digest()
        .map(|digest| encode_hex(digest.as_bytes()))
        .map_err(|error| store_error(error.message()))
}

fn active_binding_from_stored(
    stored: &CloudflareStoredTenantRootRoleShareV1,
) -> worker::Result<TenantRootActiveRoleBindingV1> {
    validate_active_stored_record_shape(stored)?;
    let record = stored.record();
    let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = record.lifecycle() else {
        return Err(store_error(
            "tenant-root active binding requires an active record",
        ));
    };
    let identity_digest = record
        .identity()
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let row = TenantRootActiveRoleRowKeyV1::new(
        identity_digest,
        record.custody_lineage(),
        record.epoch(),
        record.role().managed_restore_role(),
    );
    TenantRootActiveRoleBindingV1::new(
        row,
        record.share_commitment().clone(),
        active.activation.activation_receipt_digest,
    )
    .map_err(|error| store_error(error.message()))
}

fn required_env_var(env: &Env, name: &'static str) -> worker::Result<String> {
    let value = env
        .var(name)
        .map_err(|error| store_error(format!("required env {name} is unavailable: {error}")))?
        .to_string();
    require_identifier(name, &value)?;
    Ok(value)
}

fn require_identifier(field: &str, value: &str) -> worker::Result<()> {
    if value.is_empty()
        || value.trim() != value
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err(store_error(format!("{field} is malformed")));
    }
    Ok(())
}

fn require_digest_hex(field: &str, value: &str) -> worker::Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(store_error(format!(
            "{field} must be 32-byte lowercase hex"
        )));
    }
    Ok(())
}

fn require_nonzero_bytes(field: &'static str, value: &[u8]) -> worker::Result<()> {
    if value.iter().all(|byte| *byte == 0) {
        return Err(store_error(format!("{field} must be non-zero")));
    }
    Ok(())
}

fn require_timestamp(field: &str, value: u64) -> worker::Result<()> {
    if value == 0 {
        return Err(store_error(format!("{field} must be positive")));
    }
    timestamp_i64(value).map(|_| ())
}

fn timestamp_i64(value: u64) -> worker::Result<i64> {
    i64::try_from(value).map_err(|_| store_error("tenant-root timestamp exceeds D1 INTEGER"))
}

fn epoch_i64(epoch: TenantRootShareEpoch) -> worker::Result<i64> {
    epoch_i64_value(epoch.get().get())
}

fn epoch_i64_value(epoch: u64) -> worker::Result<i64> {
    i64::try_from(epoch).map_err(|_| store_error("tenant-root share epoch exceeds D1 INTEGER"))
}

fn decode_private_key(encoded: &str) -> worker::Result<[u8; 32]> {
    let hex = encoded
        .trim()
        .strip_prefix(ROLE_PRIVATE_D1_KEK_SECRET_PREFIX)
        .ok_or_else(|| {
            store_error("role-private D1 KEK Secret has an unsupported encoding prefix")
        })?;
    if hex.len() != 64 {
        return Err(store_error(
            "role-private D1 KEK Secret must contain 32 bytes",
        ));
    }
    let mut bytes = [0_u8; 32];
    for (index, chunk) in hex.as_bytes().chunks_exact(2).enumerate() {
        let high = decode_hex_nibble(chunk[0])
            .ok_or_else(|| store_error("role-private D1 KEK Secret must use lowercase hex"))?;
        let low = decode_hex_nibble(chunk[1])
            .ok_or_else(|| store_error("role-private D1 KEK Secret must use lowercase hex"))?;
        bytes[index] = (high << 4) | low;
    }
    Ok(bytes)
}

const fn decode_hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[cfg(any(debug_assertions, test))]
fn lifecycle_receipt(seed: u8) -> worker::Result<TenantRootLifecycleReceiptDigestV1> {
    TenantRootLifecycleReceiptDigestV1::from_bytes([seed; 32])
        .map_err(|error| store_error(error.message()))
}

fn decode_lower_hex_fixed<const N: usize>(field: &str, value: &str) -> worker::Result<[u8; N]> {
    if value.len() != N * 2 {
        return Err(store_error(format!(
            "{field} must contain exactly {N} bytes of lowercase hex"
        )));
    }
    let mut bytes = [0_u8; N];
    for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = decode_hex_nibble(chunk[0])
            .ok_or_else(|| store_error(format!("{field} must use lowercase hex")))?;
        let low = decode_hex_nibble(chunk[1])
            .ok_or_else(|| store_error(format!("{field} must use lowercase hex")))?;
        bytes[index] = (high << 4) | low;
    }
    Ok(bytes)
}

fn decode_base64url_fixed<const N: usize>(field: &str, value: &str) -> worker::Result<[u8; N]> {
    let bytes =
        decode_base64url_bytes_v1(field, value).map_err(|error| store_error(error.message()))?;
    if encode_base64url_bytes_v1(&bytes) != value || bytes.len() != N {
        return Err(store_error(format!(
            "{field} must contain exactly {N} canonical base64url bytes"
        )));
    }
    bytes
        .try_into()
        .map_err(|_| store_error(format!("{field} has an invalid fixed length")))
}

fn positive_u64_from_i64(field: &str, value: i64) -> worker::Result<u64> {
    let value = u64::try_from(value).map_err(|_| store_error(format!("{field} is invalid")))?;
    if value == 0 {
        return Err(store_error(format!("{field} must be positive")));
    }
    Ok(value)
}

fn require_receipt_digest(
    receipt_bytes: &[u8],
    expected: TenantRootProtocolDigestV1,
) -> worker::Result<()> {
    let actual: [u8; 32] = Sha256::digest(receipt_bytes).into();
    if &actual != expected.as_bytes() {
        return Err(store_error(
            "tenant-root command replay receipt digest does not match its bytes",
        ));
    }
    Ok(())
}

fn validate_active_stored_record_shape(
    stored: &CloudflareStoredTenantRootRoleShareV1,
) -> worker::Result<()> {
    stored.record.validate()?;
    let CloudflareTenantRootRoleShareLifecycleV1::Active(_) = &stored.record.lifecycle else {
        return Err(store_error(
            "tenant-root role-private operation requires an active record",
        ));
    };
    validate_record_activation_binding(&stored.record)?;
    if stored.revision <= 0 {
        return Err(store_error(
            "tenant-root role-private revision must be positive",
        ));
    }
    Ok(())
}

fn validate_record_activation_binding(
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> worker::Result<()> {
    match &record.lifecycle {
        CloudflareTenantRootRoleShareLifecycleV1::Pending(_) => Ok(()),
        CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
            active.activation.validate_for_record(record)
        }
        CloudflareTenantRootRoleShareLifecycleV1::Retired(retired) => {
            retired.active.activation.validate_for_record(record)
        }
    }
}

fn validate_pending_stored_record(
    cipher: &TenantRootRoleD1CipherV1,
    stored: &CloudflareStoredTenantRootRoleShareV1,
) -> worker::Result<()> {
    stored.record.validate()?;
    cipher.require_role(stored.record.role)?;
    if !matches!(
        stored.record.lifecycle,
        CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
    ) {
        return Err(store_error(
            "tenant-root role-private operation requires a pending record",
        ));
    }
    if stored.revision <= 0 {
        return Err(store_error(
            "tenant-root role-private revision must be positive",
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_managed_restore_forward_refresh_source(
    cipher: &TenantRootRoleD1CipherV1,
    stored: &CloudflareStoredTenantRootRoleShareV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    current_epoch: TenantRootShareEpoch,
    capability_digest: TenantRootLifecycleReceiptDigestV1,
    backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
) -> worker::Result<()> {
    validate_pending_stored_record(cipher, stored)?;
    let record_identity_digest = stored
        .record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if record_identity_digest != identity_digest
        || stored.record.custody_lineage != custody_lineage
        || stored.record.epoch != current_epoch
    {
        return Err(store_error(
            "managed-restore forward-refresh source coordinates do not match its request",
        ));
    }
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = &stored.record.lifecycle
    else {
        unreachable!("pending lifecycle was checked by validate_pending_stored_record");
    };
    let Some((stored_capability_digest, stored_backup_receipt_digest)) =
        pending.managed_restore_digests()
    else {
        return Err(store_error(
            "managed-restore forward-refresh source is not restored material",
        ));
    };
    if stored_capability_digest != capability_digest
        || stored_backup_receipt_digest != backup_receipt_digest
    {
        return Err(store_error(
            "managed-restore forward-refresh source provenance does not match its request",
        ));
    }
    if pending.installation_evidence_digest() != installation_receipt_digest {
        return Err(store_error(
            "managed-restore forward-refresh source installation evidence does not match its request",
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_managed_restore_forward_refresh_inputs(
    cipher: &TenantRootRoleD1CipherV1,
    scope: &TenantRootCommandScopeV1,
    restored_pending: &CloudflareStoredTenantRootRoleShareV1,
    refresh_pending: &CloudflareStoredTenantRootRoleShareV1,
    activation: &CloudflareTenantRootActivationV1,
    capability_digest: TenantRootLifecycleReceiptDigestV1,
    backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    updated_at_ms: u64,
) -> worker::Result<()> {
    validate_pending_stored_record(cipher, restored_pending)?;
    validate_pending_stored_record(cipher, refresh_pending)?;

    let restored_identity_digest = restored_pending
        .record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    validate_managed_restore_forward_refresh_source(
        cipher,
        restored_pending,
        restored_identity_digest,
        restored_pending.record.custody_lineage,
        restored_pending.record.epoch,
        capability_digest,
        backup_receipt_digest,
        installation_receipt_digest,
    )?;

    validate_epoch_swap_inputs(restored_pending, refresh_pending)?;
    let refresh_identity_digest = refresh_pending
        .record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if refresh_identity_digest != restored_identity_digest {
        return Err(store_error(
            "managed-restore forward refresh requires one tenant-root identity",
        ));
    }
    validate_command_scope_for_record(
        scope,
        &refresh_pending.record,
        refresh_pending.revision,
        "managed-restore forward refresh",
    )?;
    validate_activation_receipt_against_swap_records(
        activation,
        restored_pending,
        refresh_pending,
    )?;
    refresh_pending
        .record
        .clone()
        .into_active(activation.clone(), updated_at_ms)?;
    Ok(())
}

fn validate_retired_stored_record(
    cipher: &TenantRootRoleD1CipherV1,
    stored: &CloudflareStoredTenantRootRoleShareV1,
) -> worker::Result<()> {
    stored.record.validate()?;
    cipher.require_role(stored.record.role)?;
    if !matches!(
        stored.record.lifecycle,
        CloudflareTenantRootRoleShareLifecycleV1::Retired(_)
    ) {
        return Err(store_error(
            "tenant-root role-private operation requires a retired record",
        ));
    }
    validate_record_activation_binding(&stored.record)?;
    if stored.revision <= 0 {
        return Err(store_error(
            "tenant-root role-private revision must be positive",
        ));
    }
    Ok(())
}

fn validate_managed_restore_staging_record(
    record: &CloudflareTenantRootRoleShareRecordV1,
    capability_digest: TenantRootLifecycleReceiptDigestV1,
) -> worker::Result<()> {
    record.validate()?;
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = record.lifecycle() else {
        return Err(store_error(
            "managed-restore material must be stored as a pending role-share record",
        ));
    };
    let Some((stored_capability_digest, _)) = pending.managed_restore_digests() else {
        return Err(store_error(
            "managed-restore staging record is missing restore provenance",
        ));
    };
    if stored_capability_digest != capability_digest {
        return Err(store_error(
            "managed-restore staging record capability digest does not match its input",
        ));
    }
    Ok(())
}

fn validate_active_stored_record(
    cipher: &TenantRootRoleD1CipherV1,
    stored: &CloudflareStoredTenantRootRoleShareV1,
) -> worker::Result<()> {
    validate_active_stored_record_shape(stored)?;
    cipher.require_role(stored.record.role)?;
    Ok(())
}

fn require_lifecycle_progression(
    operation: &'static str,
    existing_updated_at_ms: u64,
    event_at_ms: u64,
    updated_at_ms: u64,
) -> worker::Result<()> {
    if event_at_ms < existing_updated_at_ms || updated_at_ms < existing_updated_at_ms {
        return Err(store_error(format!(
            "{operation} timestamps regress the existing tenant-root record"
        )));
    }
    if event_at_ms > updated_at_ms {
        return Err(store_error(format!(
            "{operation} timestamp exceeds the tenant-root record update timestamp"
        )));
    }
    Ok(())
}

fn validate_epoch_swap_inputs(
    active: &CloudflareStoredTenantRootRoleShareV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
) -> worker::Result<()> {
    if active.record.identity != pending.record.identity {
        return Err(store_error(
            "tenant-root epoch swap requires one tenant-root identity",
        ));
    }
    if active.record.custody_lineage != pending.record.custody_lineage {
        return Err(store_error(
            "tenant-root epoch swap requires one custody lineage",
        ));
    }
    if active.record.role != pending.record.role {
        return Err(store_error(
            "tenant-root epoch swap requires one Deriver role",
        ));
    }
    if active
        .record
        .epoch
        .next()
        .map_err(|error| store_error(error.message()))?
        != pending.record.epoch
    {
        return Err(store_error(
            "tenant-root epoch swap must advance exactly one epoch",
        ));
    }
    Ok(())
}

fn next_revision(revision: i64) -> worker::Result<i64> {
    if revision <= 0 {
        return Err(store_error(
            "tenant-root role-private revision must be positive",
        ));
    }
    revision
        .checked_add(1)
        .ok_or_else(|| store_error("tenant-root role-private revision is exhausted"))
}

fn result_changes(result: &worker::D1Result) -> worker::Result<usize> {
    Ok(result
        .meta()?
        .and_then(|metadata| metadata.changes)
        .unwrap_or_default())
}

fn require_changes(
    result: &worker::D1Result,
    expected: usize,
    message: &'static str,
) -> worker::Result<()> {
    if result_changes(result)? != expected {
        return Err(store_error(message));
    }
    Ok(())
}

fn require_one_change(result: &worker::D1Result, message: &'static str) -> worker::Result<()> {
    require_changes(result, 1, message)
}

fn store_error(message: impl Into<String>) -> worker::Error {
    worker::Error::RustError(message.into())
}

#[cfg(test)]
mod tests {
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
    use crate::tenant_root_role_runtime::{
        open_tenant_root_online_role_share_v1, TenantRootOnlineRoleShareProviderV1,
    };

    struct PersistedOnlineShareProvider {
        opened_share: Option<SigningRootShareWire>,
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

    fn test_cipher(role: CloudflareTenantRootDeriverRoleV1, seed: u8) -> TenantRootRoleD1CipherV1 {
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

    fn test_identity() -> TenantRootIdentityV1 {
        TenantRootIdentityV1::new(
            "org-1",
            "project-1",
            "env-1",
            "project-1:env-1",
            "root-version-1",
        )
        .expect("identity")
    }

    fn test_creation_context() -> TenantRootCeremonyContextV1 {
        test_creation_context_for_identity(test_identity())
    }

    fn test_creation_context_for_identity(
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

    fn test_refresh_context() -> TenantRootCeremonyContextV1 {
        test_refresh_context_with_identity(test_identity(), 0x44, 1, 2, 0x45, 0x46)
    }

    fn test_refresh_context_with_identity(
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

    fn test_refresh_active_pair() -> TenantRootActiveRootPairV1 {
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

    fn test_verified_refresh_command(
        role: TwoPartyDeriverRole,
        expected_control_plane_revision: u64,
    ) -> VerifiedTenantRootRoleRefreshCommandV1 {
        test_verified_refresh_command_with_window(role, expected_control_plane_revision, 20, 40)
    }

    fn test_verified_refresh_command_with_window(
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

    fn test_refresh_evidence(
        context: &router_ab_core::TenantRootCeremonyContextV1,
        role: TwoPartyDeriverRole,
    ) -> VerifiedTenantRootSignedShareInstallationEvidenceWireV1 {
        let (signing_seed, proof_seed) = match role {
            TwoPartyDeriverRole::DeriverA => (0x57, 0x67),
            TwoPartyDeriverRole::DeriverB => (0x58, 0x68),
        };
        test_refresh_evidence_with_seeds(context, role, signing_seed, proof_seed)
    }

    fn test_refresh_evidence_with_seeds(
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

    fn refresh_input_with_sealed_evidence(
        command: VerifiedTenantRootRoleRefreshCommandV1,
        evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        identity: TenantRootIdentityV1,
        sealed_context: &router_ab_core::TenantRootCeremonyContextV1,
        sealed_evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        sealed_role: TwoPartyDeriverRole,
    ) -> worker::Result<CloudflareTenantRootRefreshInputV1> {
        let sealed_online_share =
            test_sealed_online_share(sealed_context, sealed_evidence, sealed_role);
        CloudflareTenantRootRefreshInputV1::new(
            command,
            evidence,
            CloudflareTenantRootRefreshShareInputV1::new(identity, sealed_online_share, 30),
        )
    }

    fn test_verified_initial_creation_command(
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

    fn test_commitment(role: CloudflareTenantRootDeriverRoleV1) -> MpcPrfShareCommitmentWireV1 {
        pair_commitment(
            role,
            match role {
                CloudflareTenantRootDeriverRoleV1::DeriverA => 17,
                CloudflareTenantRootDeriverRoleV1::DeriverB => 29,
            },
        )
    }

    fn core_role(role: CloudflareTenantRootDeriverRoleV1) -> TwoPartyDeriverRole {
        match role {
            CloudflareTenantRootDeriverRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
            CloudflareTenantRootDeriverRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
        }
    }

    fn scalar_for_commitment(
        role: CloudflareTenantRootDeriverRoleV1,
        commitment: &MpcPrfShareCommitmentWireV1,
    ) -> u64 {
        (1..=1024)
            .find(|scalar| pair_commitment(role, *scalar) == *commitment)
            .expect("test commitment has a small discrete-log fixture")
    }

    fn test_context_for_record(
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

    fn test_target_commitments(
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

    fn test_refresh_current_commitments(
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

    fn commitment_point(commitment: &MpcPrfShareCommitmentWireV1) -> RistrettoPoint {
        CompressedRistretto(
            commitment.as_bytes()[2..]
                .try_into()
                .expect("commitment point"),
        )
        .decompress()
        .expect("commitment point decodes")
    }

    fn commitment_wire_from_point(
        role: CloudflareTenantRootDeriverRoleV1,
        point: RistrettoPoint,
    ) -> MpcPrfShareCommitmentWireV1 {
        let mut bytes = Vec::with_capacity(34);
        bytes.extend_from_slice(&role.share_id().to_be_bytes());
        bytes.extend_from_slice(point.compress().as_bytes());
        MpcPrfShareCommitmentWireV1::new(bytes).expect("commitment wire")
    }

    fn test_signed_installation_evidence(
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

    fn test_verified_managed_backup(
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

    fn test_verified_provider_canary(
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

    fn record_for_identity_epoch(
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

    fn record(role: CloudflareTenantRootDeriverRoleV1) -> CloudflareTenantRootRoleShareRecordV1 {
        record_for_identity_epoch(
            test_identity(),
            role,
            0x44,
            TenantRootShareEpoch::INITIAL,
            test_commitment(role),
        )
    }

    fn current_backup_activation(
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

    fn deriver_b_share_activation_digest() -> TenantRootLifecycleReceiptDigestV1 {
        current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverB, 0x88, 0x89, 20)
            .activation_receipt_digest()
    }

    fn test_activation_target(
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

    fn test_initial_activation_bundle(
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

    fn test_external_initial_activation_bundle(
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

    fn tenant_held_external_activation_for_record(
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

    fn test_refresh_activation_bundle(
        record: &CloudflareTenantRootRoleShareRecordV1,
        backup_seed: u8,
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
        VerifiedTenantRootRefreshSwapActivationEvidenceBundleV1::from_verified_managed_backups(
            &test_refresh_current_commitments(&target_commitments),
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

    fn test_verified_accepted_loss_authorization(
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

    fn test_initial_accepted_loss_bundle(
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

    fn test_refresh_accepted_loss_bundle(
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

    fn accepted_loss_activation_for_record(
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

    fn current_backup_activation_for_record(
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
    fn active_role_share(
        role: CloudflareTenantRootDeriverRoleV1,
        lineage_seed: u8,
        epoch: TenantRootShareEpoch,
        share_commitment: MpcPrfShareCommitmentWireV1,
    ) -> CloudflareTenantRootActiveRoleShareV1 {
        active_role_share_for_identity(test_identity(), role, lineage_seed, epoch, share_commitment)
    }

    fn active_role_share_for_identity(
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

    fn direct_active_role_resolution(
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
    fn pair_commitment(
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

    fn deriver_a_share(
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

    fn deriver_b_share(
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

    fn epoch(value: u64) -> TenantRootShareEpoch {
        TenantRootShareEpoch::new(value).expect("epoch")
    }

    fn test_custody_binding() -> TenantRootCustodyBindingV1 {
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

    fn test_initial_creation_evidence(
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

    fn signed_installation_evidence_wire(
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

    fn test_sealed_online_share(
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

    #[test]
    fn active_pair_resolution_preserves_both_stored_role_commitments() {
        let custody_binding = test_custody_binding();
        let pair = cloudflare_require_active_tenant_root_pair_v1(
            &custody_binding,
            &deriver_a_share(0x44, epoch(1)),
            &deriver_b_share(0x44, epoch(1)),
        )
        .expect("one active root pair");

        assert_eq!(
            pair.identity_digest(),
            test_identity().digest().expect("identity digest")
        );
        assert_eq!(
            pair.custody_lineage(),
            TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage")
        );
        assert_eq!(pair.epoch(), epoch(1));
        assert_eq!(
            pair.deriver_a().share_commitment(),
            &pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17)
        );
        assert_eq!(
            pair.deriver_b().share_commitment(),
            &pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 29)
        );
        assert_eq!(pair.root_commitment(), pair.commitments().root_commitment());
        assert_eq!(
            pair.activation_receipt_digest(),
            custody_binding.activation_receipt_digest()
        );
    }

    #[test]
    fn authoritative_pair_resolution_rejects_stale_pair_receipt_and_commitment() {
        let custody_binding = test_custody_binding();

        let stale_lineage = cloudflare_resolve_active_tenant_root_pair_v1(
            &custody_binding,
            &deriver_a_share(0x45, epoch(1)),
            &deriver_b_share(0x45, epoch(1)),
        )
        .expect("stale lineage is observed");
        assert_eq!(
            stale_lineage,
            TenantRootActivePairResolutionV1::Mismatched(
                router_ab_core::TenantRootActivePairMismatchV1::CustodyBinding
            )
        );

        let stale_epoch = cloudflare_resolve_active_tenant_root_pair_v1(
            &custody_binding,
            &deriver_a_share(0x44, epoch(2)),
            &deriver_b_share(0x44, epoch(2)),
        )
        .expect("stale epoch is observed");
        assert_eq!(
            stale_epoch,
            TenantRootActivePairResolutionV1::Mismatched(
                router_ab_core::TenantRootActivePairMismatchV1::CustodyBinding
            )
        );

        let TenantRootActiveRoleResolutionV1::Active(deriver_a) = deriver_a_share(0x44, epoch(1))
            .public_resolution()
            .expect("Deriver A public resolution")
        else {
            panic!("expected an active Deriver A resolution");
        };
        let mismatched_commitment = direct_active_role_resolution(
            TenantRootManagedRestoreRoleV1::DeriverB,
            0x44,
            epoch(1),
            pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 34),
            deriver_a.activation_receipt_digest(),
        );
        let commitment_mismatch = resolve_authoritative_active_tenant_root_pair_binding_v1(
            custody_binding.identity_digest(),
            &custody_binding,
            &TenantRootActiveRoleResolutionV1::Active(deriver_a),
            &mismatched_commitment,
        )
        .expect("commitment mismatch is observed");
        assert_eq!(
            commitment_mismatch,
            TenantRootActivePairResolutionV1::Mismatched(
                router_ab_core::TenantRootActivePairMismatchV1::ShareCommitments
            )
        );

        let mut stale_receipt = match deriver_a_share(0x44, epoch(1)) {
            CloudflareTenantRootActiveRoleShareV1::Active(stored) => *stored,
            _ => panic!("expected active role share"),
        };
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
            &mut stale_receipt.record.lifecycle
        else {
            panic!("expected active lifecycle");
        };
        let replacement =
            current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x90, 20);
        active.activation.activation_receipt_bytes = replacement.activation_receipt_bytes.clone();
        active.activation.activation_receipt_digest = replacement.activation_receipt_digest;
        active.activation.activated_at_ms = replacement.activated_at_ms;
        let stale_receipt = CloudflareTenantRootActiveRoleShareV1::Active(Box::new(stale_receipt));
        let stale_receipt = cloudflare_resolve_active_tenant_root_pair_v1(
            &custody_binding,
            &stale_receipt,
            &deriver_b_share(0x44, epoch(1)),
        )
        .expect("stale receipt is observed");
        assert_eq!(
            stale_receipt,
            TenantRootActivePairResolutionV1::Mismatched(
                router_ab_core::TenantRootActivePairMismatchV1::ActivationReceiptDigest {
                    expected: custody_binding.activation_receipt_digest(),
                    deriver_a: replacement.activation_receipt_digest,
                    deriver_b: deriver_b_share_activation_digest(),
                }
            )
        );
        assert!(commitment_mismatch.require_active().is_err());
    }

    #[test]
    fn pair_resolution_never_moves_a_peers_sealed_share_across_the_role_boundary() {
        let deriver_a = deriver_a_share(0x44, epoch(7));
        let TenantRootActiveRoleResolutionV1::Active(binding) =
            deriver_a.public_resolution().expect("public resolution")
        else {
            panic!("expected an active public resolution");
        };
        // The public half carries coordinates and a commitment, and nothing sealed.
        assert_eq!(binding.role(), TenantRootManagedRestoreRoleV1::DeriverA);
        assert_eq!(binding.epoch(), epoch(7));
        assert_eq!(
            binding.share_commitment(),
            &pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17)
        );
    }

    #[test]
    fn public_resolution_rejects_a_non_active_stored_record() {
        let pending = CloudflareTenantRootActiveRoleShareV1::Active(Box::new(
            CloudflareStoredTenantRootRoleShareV1 {
                record: record(CloudflareTenantRootDeriverRoleV1::DeriverA),
                revision: 1,
            },
        ));

        assert!(pending.public_resolution().is_err());
        assert!(pending.require_active().is_err());
    }

    #[test]
    fn persisted_active_record_reconstructs_online_artifact_for_role_local_provider() {
        let role = CloudflareTenantRootDeriverRoleV1::DeriverA;
        let pending = record(role);
        let expected_identity_digest = pending.identity().digest().expect("identity digest");
        let expected_lineage = pending.custody_lineage();
        let expected_epoch = pending.epoch();
        let expected_commitment = pending.share_commitment().clone();
        let expected_key_ref = pending.epoch_wrapping_key_ref().to_owned();
        let expected_evidence_digest =
            record_installation_evidence_digest(&pending).expect("installation evidence digest");
        assert!(CloudflareStoredTenantRootRoleShareV1 {
            record: pending.clone(),
            revision: 1,
        }
        .into_online_role_share_artifact()
        .is_err());
        let share = SigningRootShare::from_canonical_bytes(
            TwoPartyDeriverRole::DeriverA.share_id(),
            Scalar::from(17_u64).to_bytes(),
        )
        .expect("Deriver A share");
        let activation = current_backup_activation_for_record(&pending, 0x88, 0x89, 20);
        let active = pending
            .into_active(activation, 20)
            .expect("active role share");
        let stored = CloudflareStoredTenantRootRoleShareV1 {
            record: active,
            revision: 1,
        };
        let artifact = stored
            .into_online_role_share_artifact()
            .expect("persisted online role-share artifact");
        let mut provider = PersistedOnlineShareProvider {
            opened_share: Some(SigningRootShareWire::from_share(&share)),
        };

        let opened = open_tenant_root_online_role_share_v1(artifact, &mut provider)
            .expect("provider-opened online role share");

        assert_eq!(opened.role(), TwoPartyDeriverRole::DeriverA);
        assert_eq!(opened.identity_digest(), expected_identity_digest);
        assert_eq!(opened.custody_lineage(), expected_lineage);
        assert_eq!(opened.epoch(), expected_epoch);
        assert_eq!(opened.share_commitment(), &expected_commitment);
        assert_eq!(opened.binding().epoch_wrapping_key_ref(), expected_key_ref);
        assert_eq!(
            opened.binding().installation_evidence_digest(),
            expected_evidence_digest
        );
    }

    #[test]
    fn empty_active_load_is_publicly_unprovisioned_and_fails_closed() {
        let empty = CloudflareTenantRootActiveRoleShareV1::Unprovisioned;
        assert_eq!(
            empty.public_resolution().expect("empty public resolution"),
            TenantRootActiveRoleResolutionV1::Unprovisioned
        );
        assert!(empty.require_active().is_err());
    }

    #[test]
    fn active_projection_rejects_invalid_commitments_and_activation_evidence() {
        let mut invalid_commitment = match deriver_a_share(0x44, epoch(7)) {
            CloudflareTenantRootActiveRoleShareV1::Active(stored) => *stored,
            _ => panic!("expected active role share"),
        };
        let mut identity_commitment = vec![0_u8; 34];
        identity_commitment[..2].copy_from_slice(&1_u16.to_be_bytes());
        identity_commitment[2..].copy_from_slice(RistrettoPoint::identity().compress().as_bytes());
        invalid_commitment.record.share_commitment =
            MpcPrfShareCommitmentWireV1::new(identity_commitment).expect("identity commitment");
        let invalid_commitment =
            CloudflareTenantRootActiveRoleShareV1::Active(Box::new(invalid_commitment));
        assert!(invalid_commitment.public_resolution().is_err());
        assert!(invalid_commitment.require_active().is_err());

        let mut tampered_evidence = match deriver_a_share(0x44, epoch(7)) {
            CloudflareTenantRootActiveRoleShareV1::Active(stored) => *stored,
            _ => panic!("expected active role share"),
        };
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
            &mut tampered_evidence.record.lifecycle
        else {
            panic!("expected active lifecycle");
        };
        let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            identity_digest, ..
        } = &mut active.activation.availability
        else {
            panic!("expected current-backup availability");
        };
        *identity_digest = TenantRootIdentityDigestV1::from_bytes([0x91; 32]);
        let tampered_evidence =
            CloudflareTenantRootActiveRoleShareV1::Active(Box::new(tampered_evidence));
        assert!(tampered_evidence.public_resolution().is_err());
        assert!(tampered_evidence.require_active().is_err());
    }

    #[test]
    fn pair_resolution_reports_exact_fail_closed_classifications() {
        let unprovisioned = CloudflareTenantRootActiveRoleShareV1::Unprovisioned;
        let ambiguous = CloudflareTenantRootActiveRoleShareV1::Ambiguous(
            TenantRootActiveRoleAmbiguityV1::DistinctLineages {
                custody_lineages: vec![
                    TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage"),
                    TenantRootCustodyLineageId::from_bytes([0x45; 16]).expect("lineage"),
                ],
            },
        );
        let cases = [
            (
                &unprovisioned,
                &unprovisioned,
                TenantRootActivePairResolutionV1::Unprovisioned,
            ),
            (
                &deriver_a_share(0x44, epoch(7)),
                &unprovisioned,
                TenantRootActivePairResolutionV1::Partial {
                    present: TenantRootManagedRestoreRoleV1::DeriverA,
                },
            ),
            (
                &unprovisioned,
                &deriver_b_share(0x44, epoch(7)),
                TenantRootActivePairResolutionV1::Partial {
                    present: TenantRootManagedRestoreRoleV1::DeriverB,
                },
            ),
            (
                &ambiguous,
                &deriver_b_share(0x44, epoch(7)),
                TenantRootActivePairResolutionV1::AmbiguousRole {
                    role: TenantRootManagedRestoreRoleV1::DeriverA,
                    ambiguity: match &ambiguous {
                        CloudflareTenantRootActiveRoleShareV1::Ambiguous(ambiguity) => {
                            ambiguity.clone()
                        }
                        _ => unreachable!(),
                    },
                },
            ),
            (
                &deriver_a_share(0x44, epoch(7)),
                &ambiguous,
                TenantRootActivePairResolutionV1::AmbiguousRole {
                    role: TenantRootManagedRestoreRoleV1::DeriverB,
                    ambiguity: match &ambiguous {
                        CloudflareTenantRootActiveRoleShareV1::Ambiguous(ambiguity) => {
                            ambiguity.clone()
                        }
                        _ => unreachable!(),
                    },
                },
            ),
            (
                &deriver_a_share(0x44, epoch(7)),
                &deriver_b_share(0x45, epoch(7)),
                TenantRootActivePairResolutionV1::Mismatched(
                    router_ab_core::TenantRootActivePairMismatchV1::CustodyLineage {
                        deriver_a: TenantRootCustodyLineageId::from_bytes([0x44; 16])
                            .expect("lineage"),
                        deriver_b: TenantRootCustodyLineageId::from_bytes([0x45; 16])
                            .expect("lineage"),
                    },
                ),
            ),
            (
                &deriver_a_share(0x44, epoch(7)),
                &deriver_b_share(0x44, epoch(9)),
                TenantRootActivePairResolutionV1::Mismatched(
                    router_ab_core::TenantRootActivePairMismatchV1::Epoch {
                        deriver_a: epoch(7),
                        deriver_b: epoch(9),
                    },
                ),
            ),
        ];

        for (deriver_a, deriver_b, expected) in cases {
            let actual = cloudflare_observe_active_tenant_root_pair_v1(
                &test_identity(),
                deriver_a,
                deriver_b,
            )
            .expect("reconciliation observes the public state");
            assert_eq!(actual, expected);
            assert!(cloudflare_require_active_tenant_root_pair_v1(
                &test_custody_binding(),
                deriver_a,
                deriver_b,
            )
            .is_err());
        }

        let TenantRootActiveRoleResolutionV1::Active(deriver_a) = deriver_a_share(0x44, epoch(7))
            .public_resolution()
            .expect("Deriver A public resolution")
        else {
            panic!("expected an active Deriver A resolution");
        };
        let mismatched_commitment = direct_active_role_resolution(
            TenantRootManagedRestoreRoleV1::DeriverB,
            0x44,
            epoch(7),
            pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 34),
            deriver_a.activation_receipt_digest(),
        );
        assert_eq!(
            resolve_active_tenant_root_pair_binding_v1(
                test_identity().digest().expect("identity digest"),
                &TenantRootActiveRoleResolutionV1::Active(deriver_a),
                &mismatched_commitment,
            )
            .expect("reconciliation observes invalid pair commitments"),
            TenantRootActivePairResolutionV1::Mismatched(
                router_ab_core::TenantRootActivePairMismatchV1::ShareCommitments,
            )
        );
    }

    #[test]
    fn every_unsafe_pair_state_fails_closed_at_the_boundary() {
        let unprovisioned = CloudflareTenantRootActiveRoleShareV1::Unprovisioned;
        let ambiguous = CloudflareTenantRootActiveRoleShareV1::Ambiguous(
            TenantRootActiveRoleAmbiguityV1::DistinctLineages {
                custody_lineages: vec![
                    TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage"),
                    TenantRootCustodyLineageId::from_bytes([0x45; 16]).expect("lineage"),
                ],
            },
        );
        // Unprovisioned, partial both ways, ambiguous either role, lineage, and
        // epoch mismatch: none of them yields a pair.
        for (deriver_a, deriver_b) in [
            (&unprovisioned, &unprovisioned),
            (&deriver_a_share(0x44, epoch(7)), &unprovisioned),
            (&unprovisioned, &deriver_b_share(0x44, epoch(7))),
            (&ambiguous, &deriver_b_share(0x44, epoch(7))),
            (&deriver_a_share(0x44, epoch(7)), &ambiguous),
            (
                &deriver_a_share(0x44, epoch(7)),
                &deriver_b_share(0x45, epoch(7)),
            ),
            (
                &deriver_a_share(0x44, epoch(7)),
                &deriver_b_share(0x44, epoch(9)),
            ),
        ] {
            assert!(
                cloudflare_require_active_tenant_root_pair_v1(
                    &test_custody_binding(),
                    deriver_a,
                    deriver_b
                )
                .is_err(),
                "unsafe tenant-root pair state resolved to a usable pair"
            );
            // Reconciliation still observes the state without deriving from it.
            cloudflare_observe_active_tenant_root_pair_v1(&test_identity(), deriver_a, deriver_b)
                .expect("reconciliation observes the unsafe state");
        }
    }

    #[test]
    fn a_role_share_in_the_wrong_pair_position_fails_closed() {
        assert!(cloudflare_observe_active_tenant_root_pair_v1(
            &test_identity(),
            &deriver_b_share(0x44, epoch(7)),
            &deriver_b_share(0x44, epoch(7)),
        )
        .is_err());
        assert!(cloudflare_observe_active_tenant_root_pair_v1(
            &test_identity(),
            &deriver_a_share(0x44, epoch(7)),
            &deriver_a_share(0x44, epoch(7)),
        )
        .is_err());
    }

    #[test]
    fn a_role_share_for_a_foreign_identity_fails_closed() {
        let foreign_identity = TenantRootIdentityV1::new(
            "org-2",
            "project-1",
            "env-1",
            "project-1:env-1",
            "root-version-1",
        )
        .expect("foreign identity");
        assert!(cloudflare_observe_active_tenant_root_pair_v1(
            &test_identity(),
            &active_role_share_for_identity(
                foreign_identity.clone(),
                CloudflareTenantRootDeriverRoleV1::DeriverA,
                0x44,
                epoch(7),
                pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17),
            ),
            &deriver_b_share(0x44, epoch(7)),
        )
        .is_err());
        assert!(cloudflare_observe_active_tenant_root_pair_v1(
            &test_identity(),
            &deriver_a_share(0x44, epoch(7)),
            &active_role_share_for_identity(
                foreign_identity,
                CloudflareTenantRootDeriverRoleV1::DeriverB,
                0x44,
                epoch(7),
                pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 29),
            ),
        )
        .is_err());
    }

    #[test]
    fn role_private_d1_kek_matching_public_private_pair_is_accepted() {
        let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41);
        validate_role_private_d1_kek_key_pair(&cipher.public_key, &cipher.private_key)
            .expect("matching role-private D1 KEK pair is accepted");
    }

    #[test]
    fn role_private_d1_kek_mismatched_public_private_pair_is_rejected() {
        let public_key = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41).public_key;
        let private_key =
            test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x42).private_key;
        assert!(validate_role_private_d1_kek_key_pair(&public_key, &private_key).is_err());
    }

    fn row_from_record(
        cipher: &TenantRootRoleD1CipherV1,
        record: &CloudflareTenantRootRoleShareRecordV1,
    ) -> TenantRootRoleD1RowV1 {
        let metadata = record_metadata(record).expect("metadata");
        TenantRootRoleD1RowV1 {
            tenant_identity_digest_hex: metadata.identity_digest_hex,
            custody_lineage_b64u: metadata.custody_lineage_b64u,
            tenant_root_share_epoch: epoch_i64_value(metadata.epoch).expect("epoch"),
            role: metadata.role.as_str().to_owned(),
            lifecycle: metadata.lifecycle,
            ciphertext_json: cipher.seal(record, 1).expect("ciphertext"),
            revision: 1,
            created_at_ms: timestamp_i64(record.created_at_ms).expect("created"),
            updated_at_ms: timestamp_i64(record.updated_at_ms).expect("updated"),
        }
    }

    fn row_from_record_with_schema(
        cipher: &TenantRootRoleD1CipherV1,
        record: &CloudflareTenantRootRoleShareRecordV1,
        schema: &'static str,
    ) -> TenantRootRoleD1RowV1 {
        let metadata = record_metadata(record).expect("metadata");
        let revision = 1;
        let record_key = metadata.record_key();
        let aad = serde_json::to_vec(&TenantRootRoleD1AadV1 {
            environment: &cipher.environment,
            worker_role: cipher.role,
            tenant_identity_digest_hex: &metadata.identity_digest_hex,
            custody_lineage_b64u: &metadata.custody_lineage_b64u,
            tenant_root_share_epoch: metadata.epoch,
            record_role: metadata.role,
            lifecycle: &metadata.lifecycle,
            revision,
            purpose: TENANT_ROOT_ROLE_D1_PURPOSE,
            schema,
            record_key: &record_key,
        })
        .expect("old-schema AAD");
        let plaintext = serde_json::to_vec(record).expect("record JSON");
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &cipher.public_key,
            TENANT_ROOT_ROLE_D1_HPKE_INFO,
            &aad,
            &plaintext,
        )
        .expect("old-schema ciphertext");
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        let ciphertext_json = serde_json::to_string(&TenantRootRoleD1CiphertextV1 {
            key_version: cipher.key_version.clone(),
            tenant_identity_digest_hex: metadata.identity_digest_hex.clone(),
            custody_lineage_b64u: metadata.custody_lineage_b64u.clone(),
            tenant_root_share_epoch: metadata.epoch,
            role: metadata.role,
            lifecycle: metadata.lifecycle.clone(),
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .expect("old-schema envelope");
        TenantRootRoleD1RowV1 {
            tenant_identity_digest_hex: metadata.identity_digest_hex,
            custody_lineage_b64u: metadata.custody_lineage_b64u,
            tenant_root_share_epoch: epoch_i64_value(metadata.epoch).expect("epoch"),
            role: metadata.role.as_str().to_owned(),
            lifecycle: metadata.lifecycle,
            ciphertext_json,
            revision,
            created_at_ms: timestamp_i64(record.created_at_ms).expect("created"),
            updated_at_ms: timestamp_i64(record.updated_at_ms).expect("updated"),
        }
    }

    #[test]
    fn role_private_cipher_binds_tenant_lineage_epoch_role_and_lifecycle() {
        let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41);
        let record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let row = row_from_record(&cipher, &record);
        assert_eq!(cipher.open(&row).expect("record opens"), record);

        let mut wrong_revision = row_from_record(&cipher, &record);
        wrong_revision.revision = 2;
        assert!(cipher.open(&wrong_revision).is_err());

        let wrong_role = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverB, 0x41);
        assert!(wrong_role.open(&row).is_err());

        let wrong_key = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x42);
        assert!(wrong_key.open(&row).is_err());

        let mut wrong_epoch = row_from_record(&cipher, &record);
        wrong_epoch.tenant_root_share_epoch = 2;
        assert!(cipher.open(&wrong_epoch).is_err());

        let mut wrong_lifecycle = row_from_record(&cipher, &record);
        wrong_lifecycle.lifecycle = "active".to_owned();
        assert!(cipher.open(&wrong_lifecycle).is_err());
    }

    #[test]
    fn old_schema_ciphertext_is_rejected_without_a_compatibility_parser() {
        let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41);
        let record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let old_row =
            row_from_record_with_schema(&cipher, &record, "tenant-root-role-private-d1/v1");
        assert!(cipher.open(&old_row).is_err());
    }

    #[test]
    fn managed_restore_pending_provenance_survives_d1_wire_and_cannot_activate() {
        let mut record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let activation = current_backup_activation_for_record(&record, 0x88, 0x89, 40);
        let capability_digest = lifecycle_receipt(0x91).expect("capability digest");
        let backup_receipt_digest = lifecycle_receipt(0x92).expect("backup receipt digest");
        let installation_evidence_digest =
            record_installation_evidence_digest(&record).expect("installation evidence digest");
        let pending = CloudflareTenantRootPendingShareV1::from_managed_restore(
            installation_evidence_digest,
            capability_digest,
            backup_receipt_digest,
            30,
        )
        .expect("managed-restore pending state");
        record.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Pending(pending);
        record.updated_at_ms = 30;
        record.validate().expect("managed-restore pending record");

        let wire = serde_json::to_value(&record).expect("managed-restore record wire");
        let decoded = serde_json::from_value::<TenantRootRoleD1RecordWireV1>(wire)
            .expect("strict managed-restore record wire");
        let round_tripped = decoded.into_record().expect("round-tripped record");
        assert_eq!(round_tripped, record);
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = round_tripped.lifecycle()
        else {
            panic!("managed-restore record must remain pending");
        };
        assert_eq!(
            pending.managed_restore_digests(),
            Some((capability_digest, backup_receipt_digest))
        );

        assert!(record.into_active(activation, 40).is_err());
    }

    #[test]
    fn managed_restore_forward_refresh_source_requires_exact_provenance() {
        let mut managed_record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let identity_digest = managed_record.identity().digest().expect("identity digest");
        let custody_lineage = managed_record.custody_lineage();
        let epoch = managed_record.epoch();
        let capability_digest = lifecycle_receipt(0xa1).expect("capability digest");
        let backup_receipt_digest = lifecycle_receipt(0xa2).expect("backup receipt digest");
        let installation_receipt_digest =
            record_installation_evidence_digest(&managed_record).expect("installation digest");
        managed_record.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Pending(
            CloudflareTenantRootPendingShareV1::from_managed_restore(
                installation_receipt_digest,
                capability_digest,
                backup_receipt_digest,
                30,
            )
            .expect("managed-restore pending state"),
        );
        managed_record.updated_at_ms = 30;
        let stored = CloudflareStoredTenantRootRoleShareV1 {
            record: managed_record,
            revision: 1,
        };
        let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41);

        validate_managed_restore_forward_refresh_source(
            &cipher,
            &stored,
            identity_digest,
            custody_lineage,
            epoch,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
        )
        .expect("exact managed-restore provenance");

        for (capability, backup, installation) in [
            (
                lifecycle_receipt(0xa3).expect("replacement capability digest"),
                backup_receipt_digest,
                installation_receipt_digest,
            ),
            (
                capability_digest,
                lifecycle_receipt(0xa4).expect("replacement backup digest"),
                installation_receipt_digest,
            ),
            (
                capability_digest,
                backup_receipt_digest,
                lifecycle_receipt(0xa5).expect("replacement installation digest"),
            ),
        ] {
            assert!(validate_managed_restore_forward_refresh_source(
                &cipher,
                &stored,
                identity_digest,
                custody_lineage,
                epoch,
                capability,
                backup,
                installation,
            )
            .is_err());
        }

        let ceremony = CloudflareStoredTenantRootRoleShareV1 {
            record: record(CloudflareTenantRootDeriverRoleV1::DeriverA),
            revision: 1,
        };
        assert!(validate_managed_restore_forward_refresh_source(
            &cipher,
            &ceremony,
            identity_digest,
            custody_lineage,
            epoch,
            capability_digest,
            backup_receipt_digest,
            installation_receipt_digest,
        )
        .is_err());
    }

    #[test]
    fn managed_restore_provenance_changes_the_replay_payload_digest() {
        let ceremony = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let mut restore = ceremony.clone();
        let installation_evidence_digest =
            record_installation_evidence_digest(&restore).expect("installation evidence digest");
        restore.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Pending(
            CloudflareTenantRootPendingShareV1::from_managed_restore(
                installation_evidence_digest,
                lifecycle_receipt(0x93).expect("capability digest"),
                lifecycle_receipt(0x94).expect("backup receipt digest"),
                30,
            )
            .expect("managed-restore pending state"),
        );
        restore.updated_at_ms = 30;
        let ceremony_digest =
            insert_pending_payload_digest(&ceremony, 1).expect("ceremony insertion payload digest");
        let restore_digest =
            insert_pending_payload_digest(&restore, 1).expect("restore insertion payload digest");
        assert_ne!(ceremony_digest, restore_digest);
    }

    #[test]
    fn activation_wire_round_trip_rederives_projection_from_exact_bytes() {
        let activation =
            current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
        let wire_value = serde_json::json!({
            "availability": serde_json::to_value(&activation.availability)
                .expect("availability JSON"),
            "activation_receipt_b64u": encode_base64url_bytes_v1(
                activation.activation_receipt_bytes()
            ),
        });
        let decoded = serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(wire_value)
            .expect("activation wire");
        let round_tripped = decoded.into_activation().expect("round-tripped activation");
        assert_eq!(
            round_tripped.activation_receipt_bytes(),
            activation.activation_receipt_bytes()
        );
        assert_eq!(
            round_tripped.activation_receipt_digest(),
            activation.activation_receipt_digest()
        );
        assert_eq!(
            round_tripped.activated_at_ms(),
            activation.activated_at_ms()
        );
        let serialized = serde_json::to_value(&round_tripped).expect("activation JSON");
        assert_eq!(
            serialized["activation_receipt_b64u"],
            serde_json::json!(encode_base64url_bytes_v1(
                activation.activation_receipt_bytes()
            ))
        );
        assert!(serialized.get("activation_receipt_digest").is_none());
        assert!(serialized.get("activated_at_ms").is_none());
    }

    #[test]
    fn tenant_held_external_activation_wire_round_trip_retains_exact_provenance() {
        let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let activation = tenant_held_external_activation_for_record(&pending, 0x81, 20);
        let wire_value = serde_json::json!({
            "availability": serde_json::to_value(&activation.availability)
                .expect("tenant-held external availability JSON"),
            "activation_receipt_b64u": encode_base64url_bytes_v1(
                activation.activation_receipt_bytes()
            ),
        });
        let decoded = serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(wire_value)
            .expect("tenant-held external activation wire");
        let round_tripped = decoded
            .into_activation()
            .expect("round-tripped tenant-held external activation");
        assert_eq!(
            round_tripped.activation_receipt_bytes(),
            activation.activation_receipt_bytes()
        );
        assert_eq!(
            round_tripped.activation_receipt_digest(),
            activation.activation_receipt_digest()
        );
        let CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal { provenance } =
            &round_tripped.availability
        else {
            panic!("expected tenant-held external availability");
        };
        assert_eq!(provenance.recovery_set_id().as_bytes(), &[0x86; 16]);
        assert_eq!(provenance.destination_fingerprint().as_bytes(), &[0x81; 32]);
        let serialized = serde_json::to_value(&round_tripped).expect("activation JSON");
        assert_eq!(
            serialized["availability"]["kind"],
            serde_json::json!("tenant_held_external")
        );
        assert_eq!(
            serialized["availability"]["restore_refresh_command_digest"],
            serde_json::json!(provenance.restore_refresh_command_digest().as_bytes())
        );
        let mut activation_record = pending.clone();
        let receipt = decode_activation_receipt_bytes(round_tripped.activation_receipt_bytes())
            .expect("round-tripped activation receipt");
        let installation_evidence_digest = activation_installation_receipt(
            receipt.binding(),
            activation_record.role().managed_restore_role(),
        );
        activation_record.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Pending(
            CloudflareTenantRootPendingShareV1::from_stored_digest(
                installation_evidence_digest,
                10,
            )
            .expect("external activation pending state"),
        );
        activation_record
            .into_active(round_tripped, 20)
            .expect("tenant-held external activation binds pending role");
    }

    #[test]
    fn tenant_held_external_activation_rejects_provenance_projection_substitution() {
        let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let activation = tenant_held_external_activation_for_record(&pending, 0x81, 20);
        let mut wire_value = serde_json::json!({
            "availability": serde_json::to_value(&activation.availability)
                .expect("tenant-held external availability JSON"),
            "activation_receipt_b64u": encode_base64url_bytes_v1(
                activation.activation_receipt_bytes()
            ),
        });
        wire_value["availability"]["manifest_digest"][0] = serde_json::json!(0x99);
        let decoded = serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(wire_value)
            .expect("tenant-held external substituted wire shape");
        assert!(decoded.into_activation().is_err());
    }

    #[test]
    fn accepted_loss_activation_wire_round_trip_retains_exact_authorization_digest() {
        let record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let activation = accepted_loss_activation_for_record(&record, 0x61, 0x89, 20);
        let receipt = decode_activation_receipt_bytes(activation.activation_receipt_bytes())
            .expect("accepted-loss activation receipt");
        let (authorization_bytes, authorization_digest) = match receipt.availability() {
            TenantRootActivationReceiptAvailabilityV1::AcceptedPermanentDerivationLoss {
                authorization_bytes,
                authorization_digest,
            } => (authorization_bytes.clone(), *authorization_digest),
            TenantRootActivationReceiptAvailabilityV1::CurrentRoleBackups { .. }
            | TenantRootActivationReceiptAvailabilityV1::TenantHeldExternal { .. } => {
                panic!("expected accepted-loss availability")
            }
        };
        let wire_value = serde_json::json!({
            "availability": serde_json::to_value(&activation.availability)
                .expect("accepted-loss availability JSON"),
            "activation_receipt_b64u": encode_base64url_bytes_v1(
                activation.activation_receipt_bytes()
            ),
        });
        let decoded = serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(wire_value)
            .expect("accepted-loss activation wire");
        let round_tripped = decoded
            .into_activation()
            .expect("round-tripped accepted-loss activation");
        assert_eq!(
            round_tripped.activation_receipt_bytes(),
            activation.activation_receipt_bytes()
        );
        assert_eq!(
            round_tripped.activation_receipt_digest(),
            activation.activation_receipt_digest()
        );
        assert_eq!(
            round_tripped.activated_at_ms(),
            activation.activated_at_ms()
        );
        let CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
            authorization_digest: round_tripped_digest,
            ..
        } = &round_tripped.availability
        else {
            panic!("expected accepted-loss availability");
        };
        assert_eq!(*round_tripped_digest, authorization_digest);
        assert!(!authorization_bytes.is_empty());
        let serialized = serde_json::to_value(&round_tripped).expect("activation JSON");
        assert_eq!(
            serialized["availability"]["kind"],
            serde_json::json!("accepted_permanent_derivation_loss")
        );
        assert_eq!(
            serialized["availability"]["authorization_digest"],
            serde_json::json!(authorization_digest.as_bytes())
        );
        assert_eq!(
            serialized["activation_receipt_b64u"],
            serde_json::json!(encode_base64url_bytes_v1(
                activation.activation_receipt_bytes()
            ))
        );
        assert!(serialized.get("activation_receipt_digest").is_none());
        assert!(serialized.get("activated_at_ms").is_none());
    }

    #[test]
    fn accepted_loss_refresh_activation_round_trip_retains_exact_receipt_bytes() {
        let pending = record_for_identity_epoch(
            test_identity(),
            CloudflareTenantRootDeriverRoleV1::DeriverA,
            0x44,
            epoch(2),
            pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 18),
        );
        let activation = accepted_loss_activation_for_record(&pending, 0x63, 0x89, 40);
        let wire_value = serde_json::json!({
            "availability": serde_json::to_value(&activation.availability)
                .expect("accepted-loss availability JSON"),
            "activation_receipt_b64u": encode_base64url_bytes_v1(
                activation.activation_receipt_bytes()
            ),
        });
        let decoded = serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(wire_value)
            .expect("accepted-loss refresh activation wire");
        let round_tripped = decoded
            .into_activation()
            .expect("round-tripped accepted-loss refresh activation");
        assert_eq!(
            round_tripped.activation_receipt_bytes(),
            activation.activation_receipt_bytes()
        );
        assert_eq!(
            round_tripped.activation_receipt_digest(),
            activation.activation_receipt_digest()
        );
        assert_eq!(
            round_tripped.activated_at_ms(),
            activation.activated_at_ms()
        );
        pending
            .into_active(round_tripped, 40)
            .expect("accepted-loss refresh activation binds pending role");
    }

    #[test]
    fn accepted_loss_activation_rejects_authorization_projection_substitution() {
        let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let original = accepted_loss_activation_for_record(&pending, 0x61, 0x89, 20);
        let replacement = accepted_loss_activation_for_record(&pending, 0x62, 0x90, 20);
        let active = pending
            .clone()
            .into_active(original.clone(), 20)
            .expect("active record");
        let mut stored = CloudflareStoredTenantRootRoleShareV1 {
            record: active,
            revision: 1,
        };
        {
            let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
                &mut stored.record.lifecycle
            else {
                panic!("active lifecycle");
            };
            active.activation.activation_receipt_bytes =
                replacement.activation_receipt_bytes.clone();
        }
        assert!(validate_active_stored_record_shape(&stored).is_err());
        {
            let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
                &mut stored.record.lifecycle
            else {
                panic!("active lifecycle");
            };
            active.activation.activation_receipt_digest = replacement.activation_receipt_digest;
            active.activation.activated_at_ms = replacement.activated_at_ms;
        }
        assert!(validate_active_stored_record_shape(&stored).is_err());
        let original_payload = activate_initial_payload_digest(
            &CloudflareStoredTenantRootRoleShareV1 {
                record: pending,
                revision: 1,
            },
            &original,
            20,
            1,
        )
        .expect("original activation payload");
        let replacement_payload = activate_initial_payload_digest(
            &CloudflareStoredTenantRootRoleShareV1 {
                record: record(CloudflareTenantRootDeriverRoleV1::DeriverA),
                revision: 1,
            },
            &replacement,
            20,
            1,
        )
        .expect("replacement activation payload");
        assert_ne!(original_payload, replacement_payload);
    }

    #[test]
    fn accepted_loss_activation_replay_is_idempotent_and_rejects_authorization_substitution() {
        let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let pending_stored = CloudflareStoredTenantRootRoleShareV1 {
            record: pending.clone(),
            revision: 1,
        };
        let original = accepted_loss_activation_for_record(&pending, 0x61, 0x89, 20);
        let original_payload = activate_initial_payload_digest(&pending_stored, &original, 20, 1)
            .expect("accepted-loss activation payload");
        let identity = pending.identity().digest().expect("identity digest");
        let key = TenantRootCommandReplayKeyV1::deriver_a(
            identity,
            pending.custody_lineage(),
            TenantRootCeremonySessionIdV1::from_bytes([0x21; 16]).expect("session"),
            TenantRootCeremonyNonceV1::from_bytes([0x22; 32]).expect("nonce"),
        );
        let scope = TenantRootCommandScopeV1::new(key, pending.epoch(), 1).expect("scope");
        let command_digest = scope
            .command_digest(TenantRootCommandOperationV1::activate_initial(
                original_payload,
            ))
            .expect("command digest");
        let reservation = match reserve_tenant_root_command_v1(None, key, command_digest, 61)
            .expect("fresh accepted-loss reservation")
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => panic!("fresh accepted-loss command must be executable"),
        };
        let stored = TenantRootCommandReplayRecordV1::Reserved(reservation);
        assert!(matches!(
            reserve_tenant_root_command_v1(Some(&stored), key, command_digest, 62)
                .expect("identical accepted-loss replay"),
            TenantRootCommandReplayDecisionV1::InProgress
        ));

        let replacement = accepted_loss_activation_for_record(&pending, 0x62, 0x89, 20);
        let replacement_payload =
            activate_initial_payload_digest(&pending_stored, &replacement, 20, 1)
                .expect("replacement accepted-loss activation payload");
        let replacement_digest = scope
            .command_digest(TenantRootCommandOperationV1::activate_initial(
                replacement_payload,
            ))
            .expect("replacement command digest");
        assert_ne!(command_digest, replacement_digest);
        assert!(
            reserve_tenant_root_command_v1(Some(&stored), key, replacement_digest, 62).is_err()
        );
    }

    #[test]
    fn encrypted_active_record_round_trip_retains_exact_activation_receipt_bytes() {
        let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41);
        let activation =
            current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
        let record = record(CloudflareTenantRootDeriverRoleV1::DeriverA)
            .into_active(activation.clone(), 20)
            .expect("active record");
        let row = row_from_record(&cipher, &record);
        let opened = cipher.open(&row).expect("opened active record");
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = opened.lifecycle else {
            panic!("active lifecycle");
        };
        assert_eq!(
            active.activation.activation_receipt_bytes,
            activation.activation_receipt_bytes
        );
        assert_eq!(
            active.activation.activation_receipt_digest,
            activation.activation_receipt_digest
        );
        assert_eq!(
            active.activation.activated_at_ms,
            activation.activated_at_ms
        );

        let mut tampered = record;
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = &mut tampered.lifecycle
        else {
            panic!("active lifecycle");
        };
        let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            identity_digest, ..
        } = &mut active.activation.availability
        else {
            panic!("expected current-backup availability");
        };
        *identity_digest = TenantRootIdentityDigestV1::from_bytes([0x91; 32]);
        assert!(cipher.open(&row_from_record(&cipher, &tampered)).is_err());
    }

    #[test]
    fn active_initial_activation_retry_reuses_exact_receipt_and_pending_command_revision() {
        let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let pending_stored = CloudflareStoredTenantRootRoleShareV1 {
            record: pending.clone(),
            revision: 1,
        };
        let activation =
            current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
        let active_record = pending
            .clone()
            .into_active(activation.clone(), 20)
            .expect("active record");
        let active_stored = CloudflareStoredTenantRootRoleShareV1 {
            record: active_record,
            revision: 2,
        };

        assert_eq!(
            active_stored
                .active_activation_receipt_bytes()
                .expect("stored activation receipt"),
            activation.activation_receipt_bytes()
        );
        let retry_pending = active_stored
            .initial_activation_retry_pending()
            .expect("retry pending record");
        assert_eq!(retry_pending.revision(), pending_stored.revision());
        assert!(matches!(
            retry_pending.record().lifecycle(),
            CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
        ));
        assert_eq!(
            retry_pending.record().updated_at_ms(),
            pending_stored.record().updated_at_ms()
        );
        assert_eq!(
            activate_initial_payload_digest(&pending_stored, &activation, 20, 1)
                .expect("original activation payload"),
            activate_initial_payload_digest(&retry_pending, &activation, 20, 1)
                .expect("retry activation payload")
        );
    }

    #[test]
    fn active_refresh_activation_retry_reconstructs_the_consumed_pending_revision() {
        let epoch = TenantRootShareEpoch::new(2).expect("epoch 2");
        let pending = record_for_identity_epoch(
            test_identity(),
            CloudflareTenantRootDeriverRoleV1::DeriverA,
            0x44,
            epoch,
            test_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA),
        );
        let activation = current_backup_activation_for_record(&pending, 0x88, 0x91, 30);
        let active = pending
            .clone()
            .into_active(activation, 30)
            .expect("active refresh successor");
        let retry_pending = CloudflareStoredTenantRootRoleShareV1 {
            record: active,
            revision: 2,
        }
        .refresh_activation_retry_pending()
        .expect("refresh retry pending");

        assert_eq!(retry_pending.revision(), 1);
        assert_eq!(retry_pending.record(), &pending);
    }

    #[test]
    fn old_digest_only_activation_wire_is_rejected() {
        let activation =
            current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
        let old_shape = serde_json::json!({
            "availability": serde_json::to_value(&activation.availability)
                .expect("availability JSON"),
            "activation_receipt_digest_hex": encode_hex(
                activation.activation_receipt_digest().as_bytes()
            ),
            "activated_at_ms": activation.activated_at_ms(),
        });
        assert!(serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(old_shape).is_err());
    }

    #[test]
    fn activation_replay_substitution_retains_only_the_replacement_exact_bytes() {
        let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let original =
            current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
        let replacement =
            current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x90, 20);
        assert_ne!(
            original.activation_receipt_bytes(),
            replacement.activation_receipt_bytes()
        );
        let original_digest = original.activation_receipt_digest();
        let active = pending.into_active(original, 20).expect("active record");
        let mut stored = CloudflareStoredTenantRootRoleShareV1 {
            record: active,
            revision: 1,
        };
        {
            let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
                &mut stored.record.lifecycle
            else {
                panic!("active lifecycle");
            };
            active.activation.activation_receipt_bytes =
                replacement.activation_receipt_bytes.clone();
        }
        assert!(validate_active_stored_record_shape(&stored).is_err());
        {
            let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
                &mut stored.record.lifecycle
            else {
                panic!("active lifecycle");
            };
            active.activation.activation_receipt_digest = replacement.activation_receipt_digest;
            active.activation.activated_at_ms = replacement.activated_at_ms;
        }
        validate_active_stored_record_shape(&stored).expect("replacement remains self-consistent");
        let replacement_binding = active_binding_from_stored(&stored).expect("active binding");
        assert_eq!(
            replacement_binding.activation_receipt_digest(),
            replacement.activation_receipt_digest()
        );
        assert_ne!(
            replacement_binding.activation_receipt_digest(),
            original_digest
        );
    }

    #[test]
    fn lifecycle_is_forward_only_and_retains_activation_evidence() {
        let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let activation =
            current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
        let installation_digest = match pending.lifecycle() {
            CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) => {
                pending.installation_evidence_digest()
            }
            _ => unreachable!(),
        };
        let activation_digest = activation.activation_receipt_digest();
        let backup_digest = match &activation.availability {
            CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
                role_backup_receipt_digest,
                ..
            } => *role_backup_receipt_digest,
            CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
                ..
            } => {
                panic!("expected current-backup availability")
            }
            CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal { .. } => {
                panic!("expected current-backup availability")
            }
        };
        let active = pending
            .into_active(activation, 20)
            .expect("pending activates");
        assert_eq!(active.lifecycle.as_str(), "active");
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active_evidence) = &active.lifecycle
        else {
            panic!("active lifecycle");
        };
        assert_eq!(
            active_evidence.pending.installation_evidence_digest,
            installation_digest
        );
        assert!(matches!(
            &active_evidence.activation.availability,
            CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
                role_backup_receipt_digest,
                ..
            } if *role_backup_receipt_digest == backup_digest
        ));
        assert_eq!(
            active_evidence.activation.activation_receipt_digest,
            activation_digest
        );
        let retired = active
            .into_retired(
                CloudflareTenantRootRetirementV1::new(
                    lifecycle_receipt(0x90).expect("retirement receipt"),
                    30,
                )
                .expect("retirement"),
                30,
            )
            .expect("active retires");
        assert_eq!(retired.lifecycle.as_str(), "retired");
        let CloudflareTenantRootRoleShareLifecycleV1::Retired(retired_evidence) =
            &retired.lifecycle
        else {
            panic!("retired lifecycle");
        };
        assert_eq!(
            retired_evidence.active.pending.installation_evidence_digest,
            installation_digest
        );
        assert_eq!(
            retired_evidence.active.activation.activation_receipt_digest,
            activation_digest
        );
        assert_eq!(
            retired_evidence.retirement.retirement_receipt_digest,
            lifecycle_receipt(0x90).expect("retirement receipt")
        );
        let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x43);
        let row = row_from_record(&cipher, &retired);
        assert_eq!(cipher.open(&row).expect("retired record opens"), retired);
        assert!(retired
            .clone()
            .into_active(
                current_backup_activation(
                    CloudflareTenantRootDeriverRoleV1::DeriverA,
                    0x99,
                    0x9a,
                    40
                ),
                40,
            )
            .is_err());
        assert!(TenantRootLifecycleReceiptDigestV1::from_bytes([0; 32]).is_err());
    }

    #[test]
    fn lifecycle_rejects_out_of_order_evidence() {
        let mut activation =
            current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
        activation.activated_at_ms = 9;
        assert!(record(CloudflareTenantRootDeriverRoleV1::DeriverA)
            .into_active(activation, 10)
            .is_err());

        let active = record(CloudflareTenantRootDeriverRoleV1::DeriverA)
            .into_active(
                current_backup_activation(
                    CloudflareTenantRootDeriverRoleV1::DeriverA,
                    0x88,
                    0x89,
                    20,
                ),
                20,
            )
            .expect("active");
        assert!(active
            .into_retired(
                CloudflareTenantRootRetirementV1::new(
                    lifecycle_receipt(0x90).expect("retirement receipt"),
                    19,
                )
                .expect("retirement shape"),
                30,
            )
            .is_err());

        let active = record(CloudflareTenantRootDeriverRoleV1::DeriverA)
            .into_active(
                current_backup_activation(
                    CloudflareTenantRootDeriverRoleV1::DeriverA,
                    0x88,
                    0x89,
                    20,
                ),
                20,
            )
            .expect("active");
        assert!(active
            .into_retired(
                CloudflareTenantRootRetirementV1::new(
                    lifecycle_receipt(0x90).expect("retirement receipt"),
                    30,
                )
                .expect("retirement shape"),
                19,
            )
            .is_err());

        assert!(record(CloudflareTenantRootDeriverRoleV1::DeriverA)
            .into_active(
                current_backup_activation(
                    CloudflareTenantRootDeriverRoleV1::DeriverA,
                    0x88,
                    0x89,
                    20,
                ),
                19,
            )
            .is_err());
    }

    fn assert_payload_digest_changes(
        cases: &[(&str, TenantRootProtocolDigestV1, TenantRootProtocolDigestV1)],
    ) {
        for (label, original, changed) in cases {
            assert_ne!(
                original, changed,
                "{label} did not change its payload digest"
            );
        }
    }

    #[test]
    fn branch_commands_preserve_linear_reservation_for_terminalization() {
        let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let identity = pending.identity().digest().expect("identity digest");
        let lineage = pending.custody_lineage();
        let key = TenantRootCommandReplayKeyV1::deriver_a(
            identity,
            lineage,
            TenantRootCeremonySessionIdV1::from_bytes([0x21; 16]).expect("session"),
            TenantRootCeremonyNonceV1::from_bytes([0x22; 32]).expect("nonce"),
        );
        let scope = TenantRootCommandScopeV1::new(key, pending.epoch(), 1).expect("scope");
        let command_digest =
            TenantRootProtocolDigestV1::from_bytes([0x23; 32]).expect("command digest");
        let reservation = match reserve_tenant_root_command_v1(None, key, command_digest, 1)
            .expect("reservation")
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => panic!("fresh reservation must be executable"),
        };
        let command = CloudflareTenantRootInsertPendingCommandV1 {
            scope,
            reservation,
            record: pending,
            expected_revision: 1,
            operation_payload_digest: command_digest,
        };
        let CloudflareTenantRootInsertPendingCommandV1 { reservation, .. } = command;
        let terminal = reservation
            .checkpoint_executed(2)
            .expect("reservation checkpoints")
            .complete(
                TenantRootProtocolDigestV1::from_bytes([0x24; 32]).expect("receipt digest"),
                3,
            )
            .expect("executed reservation terminalizes");
        assert_eq!(terminal.key(), &key);
        assert_eq!(terminal.command_digest(), command_digest);
    }

    #[test]
    fn persisted_command_checkpoints_reconstruct_only_the_exact_resume_token() {
        let identity = test_identity().digest().expect("identity digest");
        let lineage = TenantRootCustodyLineageId::from_bytes([0x31; 16]).expect("lineage");
        let session = TenantRootCeremonySessionIdV1::from_bytes([0x32; 16]).expect("session");
        let nonce = TenantRootCeremonyNonceV1::from_bytes([0x33; 32]).expect("nonce");
        let key = TenantRootCommandReplayKeyV1::deriver_a(identity, lineage, session, nonce);
        let command_digest = TenantRootProtocolDigestV1::from_bytes([0x34; 32]).expect("digest");
        let reservation = match reserve_tenant_root_command_v1(None, key, command_digest, 40)
            .expect("reservation")
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => panic!("fresh reservation must be executable"),
        };
        let executed = reservation.checkpoint_executed(41).expect("checkpoint");
        let stored = StoredTenantRootCommandReplayV1 {
            record: TenantRootCommandReplayRecordV1::Executed(executed),
            receipt_bytes: None,
            admission_digest: None,
            refresh_state: None,
            reserved_at_ms: 40,
            executed_at_ms: Some(41),
        };
        let resumed = replay_executed_from_stored(&stored).expect("resume token");
        assert_eq!(resumed.key(), &key);
        assert_eq!(resumed.command_digest(), command_digest);
        assert_eq!(resumed.reserved_at_ms(), 40);
        assert_eq!(resumed.executed_at_ms(), 41);
        assert!(replay_reservation_from_stored(&stored).is_err());
    }

    #[test]
    fn d1_terminal_receipt_reload_rejects_untrusted_bytes_and_row_substitutions() {
        let identity = test_identity().digest().expect("identity digest");
        let lineage = TenantRootCustodyLineageId::from_bytes([0x41; 16]).expect("lineage");
        let session = TenantRootCeremonySessionIdV1::from_bytes([0x42; 16]).expect("session");
        let nonce = TenantRootCeremonyNonceV1::from_bytes([0x43; 32]).expect("nonce");
        let key = TenantRootCommandReplayKeyV1::deriver_a(identity, lineage, session, nonce);
        let command_digest = TenantRootProtocolDigestV1::from_bytes([0x44; 32]).expect("digest");
        let signing_key = SigningKey::from_bytes(&[0x45; 32]);
        let signed = TenantRootCommandTerminalReceiptV1::sign_success(
            key,
            command_digest,
            b"terminal payload".to_vec(),
            20,
            "r120-test-command-key-v1",
            signing_key.as_bytes(),
        )
        .expect("signed receipt");
        let receipt_bytes = signed.canonical_bytes().expect("receipt bytes");
        let receipt_b64u = encode_base64url_bytes_v1(&receipt_bytes);
        let receipt_digest = signed.digest().expect("receipt digest");
        let receipt_digest_hex = encode_hex(receipt_digest.as_bytes());

        let arbitrary_bytes = encode_base64url_bytes_v1(b"arbitrary bytes");
        let arbitrary_digest = encode_hex(Sha256::digest(b"arbitrary bytes").as_ref());
        assert!(decode_stored_terminal_receipt(
            TenantRootCommandTerminalKindV1::Completed,
            Some(arbitrary_bytes.as_str()),
            Some(arbitrary_digest.as_str()),
            Some(20),
            key,
            command_digest,
        )
        .is_err());

        assert!(decode_stored_terminal_receipt(
            TenantRootCommandTerminalKindV1::Failed,
            Some(receipt_b64u.as_str()),
            Some(receipt_digest_hex.as_str()),
            Some(20),
            key,
            command_digest,
        )
        .is_err());

        let wrong_session = TenantRootCeremonySessionIdV1::from_bytes([0x46; 16]).expect("session");
        let wrong_key =
            TenantRootCommandReplayKeyV1::deriver_a(identity, lineage, wrong_session, nonce);
        assert!(decode_stored_terminal_receipt(
            TenantRootCommandTerminalKindV1::Completed,
            Some(receipt_b64u.as_str()),
            Some(receipt_digest_hex.as_str()),
            Some(20),
            wrong_key,
            command_digest,
        )
        .is_err());

        let wrong_command_digest =
            TenantRootProtocolDigestV1::from_bytes([0x47; 32]).expect("digest");
        assert!(decode_stored_terminal_receipt(
            TenantRootCommandTerminalKindV1::Completed,
            Some(receipt_b64u.as_str()),
            Some(receipt_digest_hex.as_str()),
            Some(20),
            key,
            wrong_command_digest,
        )
        .is_err());

        let wrong_receipt_digest = encode_hex([0x48; 32].as_ref());
        assert!(decode_stored_terminal_receipt(
            TenantRootCommandTerminalKindV1::Completed,
            Some(receipt_b64u.as_str()),
            Some(wrong_receipt_digest.as_str()),
            Some(20),
            key,
            command_digest,
        )
        .is_err());

        assert!(decode_stored_terminal_receipt(
            TenantRootCommandTerminalKindV1::Completed,
            Some(receipt_b64u.as_str()),
            Some(receipt_digest_hex.as_str()),
            Some(21),
            key,
            command_digest,
        )
        .is_err());
    }

    #[test]
    fn d1_terminal_receipt_reload_returns_exact_canonical_success_and_failure_bytes() {
        let identity = test_identity().digest().expect("identity digest");
        let lineage = TenantRootCustodyLineageId::from_bytes([0x51; 16]).expect("lineage");
        let session = TenantRootCeremonySessionIdV1::from_bytes([0x52; 16]).expect("session");
        let nonce = TenantRootCeremonyNonceV1::from_bytes([0x53; 32]).expect("nonce");
        let key = TenantRootCommandReplayKeyV1::deriver_a(identity, lineage, session, nonce);
        let command_digest = TenantRootProtocolDigestV1::from_bytes([0x54; 32]).expect("digest");
        let signing_key = SigningKey::from_bytes(&[0x55; 32]);

        let success = TenantRootCommandTerminalReceiptV1::sign_success(
            key,
            command_digest,
            b"success payload".to_vec(),
            20,
            "r120-test-command-key-v1",
            signing_key.as_bytes(),
        )
        .expect("success receipt");
        let success_bytes = success.canonical_bytes().expect("success bytes");
        let success_b64u = encode_base64url_bytes_v1(&success_bytes);
        let success_digest = success.digest().expect("success digest");
        let success_digest_hex = encode_hex(success_digest.as_bytes());
        let opened_success = decode_stored_terminal_receipt(
            TenantRootCommandTerminalKindV1::Completed,
            Some(success_b64u.as_str()),
            Some(success_digest_hex.as_str()),
            Some(20),
            key,
            command_digest,
        )
        .expect("exact success receipt reload");
        assert_eq!(opened_success.receipt_bytes, success_bytes);
        assert_eq!(opened_success.receipt_digest, success_digest);
        assert_eq!(opened_success.terminal_at_ms, 20);

        let failure = TenantRootCommandTerminalReceiptV1::sign_failure(
            key,
            command_digest,
            b"failure payload".to_vec(),
            21,
            "r120-test-command-key-v1",
            signing_key.as_bytes(),
        )
        .expect("failure receipt");
        let failure_bytes = failure.canonical_bytes().expect("failure bytes");
        let failure_b64u = encode_base64url_bytes_v1(&failure_bytes);
        let failure_digest = failure.digest().expect("failure digest");
        let failure_digest_hex = encode_hex(failure_digest.as_bytes());
        let opened_failure = decode_stored_terminal_receipt(
            TenantRootCommandTerminalKindV1::Failed,
            Some(failure_b64u.as_str()),
            Some(failure_digest_hex.as_str()),
            Some(21),
            key,
            command_digest,
        )
        .expect("exact failure receipt reload");
        assert_eq!(opened_failure.receipt_bytes, failure_bytes);
        assert_eq!(opened_failure.receipt_digest, failure_digest);
        assert_eq!(opened_failure.terminal_at_ms, 21);
    }

    #[test]
    fn command_payload_digest_binds_each_operation_and_substitution() {
        let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let pending_stored = CloudflareStoredTenantRootRoleShareV1 {
            record: pending.clone(),
            revision: 1,
        };
        let initial_activation = current_backup_activation_for_record(&pending, 0x88, 0x89, 20);
        let initial_active_record = pending
            .clone()
            .into_active(initial_activation.clone(), 20)
            .expect("active record");
        let active_stored = CloudflareStoredTenantRootRoleShareV1 {
            record: initial_active_record,
            revision: 2,
        };

        let successor = record_for_identity_epoch(
            test_identity(),
            CloudflareTenantRootDeriverRoleV1::DeriverA,
            0x44,
            epoch(2),
            pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 18),
        );
        let successor_stored = CloudflareStoredTenantRootRoleShareV1 {
            record: successor.clone(),
            revision: 1,
        };
        let successor_activation = current_backup_activation_for_record(&successor, 0x90, 0x91, 40);
        let retirement = CloudflareTenantRootRetirementV1::new(
            lifecycle_receipt(0x92).expect("retirement receipt"),
            40,
        )
        .expect("retirement");

        let insert = insert_pending_payload_digest(&pending, 1).expect("insert digest");
        let activate = activate_initial_payload_digest(&pending_stored, &initial_activation, 20, 1)
            .expect("activation digest");
        let swap = swap_active_epoch_payload_digest(
            &active_stored,
            &successor_stored,
            &successor_activation,
            &retirement,
            40,
            2,
            1,
        )
        .expect("swap digest");
        let cleanup = cleanup_pending_payload_digest(&successor_stored, 1).expect("cleanup digest");

        let mut changed_insert_record = pending.clone();
        changed_insert_record.sealed_share =
            CloudflareTenantRootSealedRoleShareV1::new(&[0x68; 96]).expect("sealed share");
        let changed_insert =
            insert_pending_payload_digest(&changed_insert_record, 1).expect("insert substitution");

        let mut changed_pending = pending.clone();
        changed_pending.updated_at_ms = 11;
        let changed_activate_record = CloudflareStoredTenantRootRoleShareV1 {
            record: changed_pending,
            revision: 1,
        };
        let changed_activate_record_digest =
            activate_initial_payload_digest(&changed_activate_record, &initial_activation, 20, 1)
                .expect("activation record substitution");
        let mut changed_activation = initial_activation.clone();
        let replacement_activation = current_backup_activation_for_record(&pending, 0x88, 0x93, 20);
        changed_activation.activation_receipt_bytes =
            replacement_activation.activation_receipt_bytes.clone();
        changed_activation.activation_receipt_digest =
            replacement_activation.activation_receipt_digest;
        changed_activation.activated_at_ms = replacement_activation.activated_at_ms;
        let changed_activate_evidence =
            activate_initial_payload_digest(&pending_stored, &changed_activation, 20, 1)
                .expect("activation evidence substitution");
        let changed_activate_timestamp =
            activate_initial_payload_digest(&pending_stored, &initial_activation, 21, 1)
                .expect("activation timestamp substitution");
        let changed_activate_revision =
            activate_initial_payload_digest(&pending_stored, &initial_activation, 20, 2)
                .expect("activation revision substitution");

        let mut changed_active = active_stored.clone();
        changed_active.record.sealed_share =
            CloudflareTenantRootSealedRoleShareV1::new(&[0x69; 96]).expect("sealed share");
        let changed_swap_active = swap_active_epoch_payload_digest(
            &changed_active,
            &successor_stored,
            &successor_activation,
            &retirement,
            40,
            2,
            1,
        )
        .expect("swap active-row substitution");
        let mut changed_successor = successor_stored.clone();
        changed_successor.record.sealed_share =
            CloudflareTenantRootSealedRoleShareV1::new(&[0x6a; 96]).expect("sealed share");
        let changed_swap_pending = swap_active_epoch_payload_digest(
            &active_stored,
            &changed_successor,
            &successor_activation,
            &retirement,
            40,
            2,
            1,
        )
        .expect("swap pending-row substitution");
        let mut changed_successor_activation = successor_activation.clone();
        let replacement_successor_activation =
            current_backup_activation_for_record(&successor, 0x90, 0x94, 40);
        changed_successor_activation.activation_receipt_bytes = replacement_successor_activation
            .activation_receipt_bytes
            .clone();
        changed_successor_activation.activation_receipt_digest =
            replacement_successor_activation.activation_receipt_digest;
        changed_successor_activation.activated_at_ms =
            replacement_successor_activation.activated_at_ms;
        let changed_swap_evidence = swap_active_epoch_payload_digest(
            &active_stored,
            &successor_stored,
            &changed_successor_activation,
            &retirement,
            40,
            2,
            1,
        )
        .expect("swap evidence substitution");
        let mut changed_retirement = retirement.clone();
        changed_retirement.retirement_receipt_digest =
            lifecycle_receipt(0x95).expect("retirement receipt");
        let changed_swap_retirement = swap_active_epoch_payload_digest(
            &active_stored,
            &successor_stored,
            &successor_activation,
            &changed_retirement,
            40,
            2,
            1,
        )
        .expect("swap retirement substitution");
        let changed_swap_timestamp = swap_active_epoch_payload_digest(
            &active_stored,
            &successor_stored,
            &successor_activation,
            &retirement,
            41,
            2,
            1,
        )
        .expect("swap timestamp substitution");
        let changed_swap_active_revision = swap_active_epoch_payload_digest(
            &active_stored,
            &successor_stored,
            &successor_activation,
            &retirement,
            40,
            3,
            1,
        )
        .expect("swap active revision substitution");
        let changed_swap_pending_revision = swap_active_epoch_payload_digest(
            &active_stored,
            &successor_stored,
            &successor_activation,
            &retirement,
            40,
            2,
            2,
        )
        .expect("swap pending revision substitution");

        let changed_cleanup_record = cleanup_pending_payload_digest(&changed_successor, 1)
            .expect("cleanup record substitution");
        let changed_cleanup_revision =
            cleanup_pending_payload_digest(&successor_stored, 2).expect("cleanup revision");

        assert_payload_digest_changes(&[
            ("insert record", insert, changed_insert),
            ("activate record", activate, changed_activate_record_digest),
            ("activate evidence", activate, changed_activate_evidence),
            ("activate timestamp", activate, changed_activate_timestamp),
            (
                "activate local revision",
                activate,
                changed_activate_revision,
            ),
            ("swap active record", swap, changed_swap_active),
            ("swap pending record", swap, changed_swap_pending),
            ("swap activation evidence", swap, changed_swap_evidence),
            ("swap retirement evidence", swap, changed_swap_retirement),
            ("swap timestamp", swap, changed_swap_timestamp),
            (
                "swap active local revision",
                swap,
                changed_swap_active_revision,
            ),
            (
                "swap pending local revision",
                swap,
                changed_swap_pending_revision,
            ),
            ("cleanup record", cleanup, changed_cleanup_record),
            ("cleanup local revision", cleanup, changed_cleanup_revision),
        ]);

        let identity = pending.identity().digest().expect("identity digest");
        let key = TenantRootCommandReplayKeyV1::deriver_a(
            identity,
            pending.custody_lineage(),
            TenantRootCeremonySessionIdV1::from_bytes([0x21; 16]).expect("session"),
            TenantRootCeremonyNonceV1::from_bytes([0x22; 32]).expect("nonce"),
        );
        let scope = TenantRootCommandScopeV1::new(key, pending.epoch(), 1).expect("scope");
        let operation = TenantRootCommandOperationV1::activate_initial(activate);
        let digest = scope.command_digest(operation).expect("command digest");
        let changed_scope =
            TenantRootCommandScopeV1::new(key, pending.epoch(), 2).expect("changed scope");
        assert_ne!(
            digest,
            changed_scope
                .command_digest(operation)
                .expect("changed command digest")
        );
    }

    #[test]
    fn current_backup_activation_rejects_record_binding_substitution() {
        let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let activation =
            current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);

        let mut wrong_identity = activation.clone();
        let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            identity_digest, ..
        } = &mut wrong_identity.availability
        else {
            panic!("expected current-backup availability");
        };
        *identity_digest = TenantRootIdentityDigestV1::from_bytes([0x91; 32]);
        assert!(pending.clone().into_active(wrong_identity, 20).is_err());

        let mut wrong_lineage = activation.clone();
        let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            custody_lineage, ..
        } = &mut wrong_lineage.availability
        else {
            panic!("expected current-backup availability");
        };
        *custody_lineage = TenantRootCustodyLineageId::from_bytes([0x45; 16]).expect("lineage");
        assert!(pending.clone().into_active(wrong_lineage, 20).is_err());

        let mut wrong_role = activation.clone();
        let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup { role, .. } =
            &mut wrong_role.availability
        else {
            panic!("expected current-backup availability");
        };
        *role = TenantRootManagedRestoreRoleV1::DeriverB;
        assert!(pending.clone().into_active(wrong_role, 20).is_err());

        let mut wrong_epoch = activation.clone();
        let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup { epoch, .. } =
            &mut wrong_epoch.availability
        else {
            panic!("expected current-backup availability");
        };
        *epoch = TenantRootShareEpoch::new(2).expect("epoch");
        assert!(pending.clone().into_active(wrong_epoch, 20).is_err());

        let mut wrong_commitment = activation;
        let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            share_commitment, ..
        } = &mut wrong_commitment.availability
        else {
            panic!("expected current-backup availability");
        };
        *share_commitment = test_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB);
        assert!(pending.into_active(wrong_commitment, 20).is_err());
    }

    #[test]
    fn initial_creation_reservation_requires_fresh_command_and_exact_record_binding() {
        let command = test_verified_initial_creation_command(TwoPartyDeriverRole::DeriverA, 20, 40);
        let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);

        let scope = initial_creation_scope_for_record(&command, &pending, 25)
            .expect("fresh verified command matches pending record");
        assert_eq!(scope.key().role(), TwoPartyDeriverRole::DeriverA);
        assert_eq!(scope.epoch(), TenantRootShareEpoch::INITIAL);
        assert_eq!(scope.expected_control_plane_revision(), 1);

        assert!(initial_creation_scope_for_record(&command, &pending, 41).is_err());
        assert!(initial_creation_scope_for_record(
            &command,
            &record(CloudflareTenantRootDeriverRoleV1::DeriverB),
            25,
        )
        .is_err());

        let mut substituted_identity = pending;
        substituted_identity.identity = TenantRootIdentityV1::new(
            "org-2",
            "project-1",
            "env-1",
            "project-1:env-1",
            "root-version-1",
        )
        .expect("substituted identity");
        assert!(initial_creation_scope_for_record(&command, &substituted_identity, 25).is_err());
    }

    #[test]
    fn initial_creation_input_derives_the_pending_digest_from_exact_evidence_bytes() {
        let command = test_verified_initial_creation_command(TwoPartyDeriverRole::DeriverA, 20, 40);
        let context = test_creation_context();
        let evidence = test_initial_creation_evidence(&context, TwoPartyDeriverRole::DeriverA);
        let expected_digest = evidence
            .lifecycle_receipt_digest()
            .expect("evidence digest");
        let share = CloudflareTenantRootInitialCreationShareInputV1::new(
            test_identity(),
            test_sealed_online_share(&context, &evidence, TwoPartyDeriverRole::DeriverA),
            10,
        );
        let creation = CloudflareTenantRootInitialCreationInputV1::new(command, evidence, share)
            .expect("initial creation input");
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) =
            creation.record.lifecycle()
        else {
            panic!("initial creation must produce a pending record");
        };
        assert_eq!(pending.installation_evidence_digest(), expected_digest);
    }

    #[test]
    fn initial_creation_input_rejects_evidence_role_and_identity_substitution() {
        let command = test_verified_initial_creation_command(TwoPartyDeriverRole::DeriverA, 20, 40);
        let context = test_creation_context();
        let wrong_role_evidence =
            test_initial_creation_evidence(&context, TwoPartyDeriverRole::DeriverB);
        let wrong_role_share = CloudflareTenantRootInitialCreationShareInputV1::new(
            test_identity(),
            test_sealed_online_share(
                &context,
                &wrong_role_evidence,
                TwoPartyDeriverRole::DeriverB,
            ),
            10,
        );
        assert!(CloudflareTenantRootInitialCreationInputV1::new(
            command,
            wrong_role_evidence,
            wrong_role_share,
        )
        .is_err());

        let command = test_verified_initial_creation_command(TwoPartyDeriverRole::DeriverA, 20, 40);
        let foreign_identity = TenantRootIdentityV1::new(
            "org-2",
            "project-1",
            "env-1",
            "project-1:env-1",
            "root-version-1",
        )
        .expect("foreign identity");
        let foreign_context = test_creation_context_for_identity(foreign_identity.clone());
        let foreign_evidence =
            test_initial_creation_evidence(&foreign_context, TwoPartyDeriverRole::DeriverA);
        let foreign_share = CloudflareTenantRootInitialCreationShareInputV1::new(
            foreign_identity,
            test_sealed_online_share(
                &foreign_context,
                &foreign_evidence,
                TwoPartyDeriverRole::DeriverA,
            ),
            10,
        );
        assert!(CloudflareTenantRootInitialCreationInputV1::new(
            command,
            foreign_evidence,
            foreign_share,
        )
        .is_err());
    }

    #[test]
    fn initial_creation_input_rejects_sealed_share_evidence_substitution() {
        let command = test_verified_initial_creation_command(TwoPartyDeriverRole::DeriverA, 20, 40);
        let context = test_creation_context();
        let sealed_evidence =
            test_initial_creation_evidence(&context, TwoPartyDeriverRole::DeriverA);
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
        let substituted_evidence = signed_installation_evidence_wire(
            &context,
            TwoPartyDeriverRole::DeriverA,
            &share_a,
            &share_b,
            0x59,
            0x69,
        );
        assert_ne!(
            sealed_evidence.canonical_bytes(),
            substituted_evidence.canonical_bytes()
        );
        let share = CloudflareTenantRootInitialCreationShareInputV1::new(
            test_identity(),
            test_sealed_online_share(&context, &sealed_evidence, TwoPartyDeriverRole::DeriverA),
            10,
        );
        assert!(CloudflareTenantRootInitialCreationInputV1::new(
            command,
            substituted_evidence,
            share,
        )
        .is_err());
    }

    #[test]
    fn initial_creation_success_receipt_requires_the_exact_evidence_payload() {
        let context = test_creation_context();
        let evidence = test_initial_creation_evidence(&context, TwoPartyDeriverRole::DeriverA);
        let expected_payload = evidence.canonical_bytes().to_vec();
        let identity = test_identity().digest().expect("identity digest");
        let lineage = TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage");
        let key = TenantRootCommandReplayKeyV1::deriver_a(
            identity,
            lineage,
            TenantRootCeremonySessionIdV1::from_bytes([0x71; 16]).expect("session"),
            TenantRootCeremonyNonceV1::from_bytes([0x72; 32]).expect("nonce"),
        );
        let command_digest = TenantRootProtocolDigestV1::from_bytes([0x73; 32]).expect("digest");
        let reservation = match reserve_tenant_root_command_v1(None, key, command_digest, 20)
            .expect("reservation")
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => panic!("fresh reservation must be executable"),
        };
        let executed = reservation.checkpoint_executed(21).expect("executed");
        let signing_key = SigningKey::from_bytes(&[0x74; 32]);
        let signed = TenantRootCommandTerminalReceiptV1::sign_success(
            key,
            command_digest,
            expected_payload,
            22,
            "r120-initial-creation-command-key-v1",
            signing_key.as_bytes(),
        )
        .expect("signed receipt");
        let receipt_bytes = signed.canonical_bytes().expect("receipt bytes");
        let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
            .expect("decoded receipt")
            .verify_success(
                &executed,
                "r120-initial-creation-command-key-v1",
                signing_key.verifying_key().as_bytes(),
            )
            .expect("verified receipt");
        assert!(validate_initial_creation_success_receipt_payload(&evidence, &receipt).is_ok());

        let signed = TenantRootCommandTerminalReceiptV1::sign_success(
            key,
            command_digest,
            b"substituted evidence bytes".to_vec(),
            22,
            "r120-initial-creation-command-key-v1",
            signing_key.as_bytes(),
        )
        .expect("signed substituted receipt");
        let receipt_bytes = signed.canonical_bytes().expect("receipt bytes");
        let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
            .expect("decoded substituted receipt")
            .verify_success(
                &executed,
                "r120-initial-creation-command-key-v1",
                signing_key.verifying_key().as_bytes(),
            )
            .expect("verified substituted receipt");
        assert!(validate_initial_creation_success_receipt_payload(&evidence, &receipt).is_err());
    }

    #[test]
    fn refresh_input_derives_pending_digest_from_exact_evidence_and_keeps_scope_revision() {
        let context = test_refresh_context();
        let evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
        let expected_digest = evidence
            .lifecycle_receipt_digest()
            .expect("refresh evidence digest");
        let command = test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4);
        let input = refresh_input_with_sealed_evidence(
            command,
            evidence,
            test_identity(),
            &context,
            &test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
            TwoPartyDeriverRole::DeriverA,
        )
        .expect("refresh input");
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = input.record.lifecycle()
        else {
            panic!("refresh insertion must produce a pending record");
        };
        assert_eq!(pending.installation_evidence_digest(), expected_digest);
        assert_eq!(input.record.epoch(), epoch(2));
        assert_eq!(input.command.scope().expected_control_plane_revision(), 4);
        assert_eq!(input.record.created_at_ms, 30);
        assert_eq!(input.record.updated_at_ms, 30);
    }

    #[test]
    fn refresh_replay_digest_binds_the_exact_signed_command() {
        let context = test_refresh_context();
        let command =
            test_verified_refresh_command_with_window(TwoPartyDeriverRole::DeriverA, 4, 20, 40);
        let changed_command =
            test_verified_refresh_command_with_window(TwoPartyDeriverRole::DeriverA, 4, 21, 39);
        let input = refresh_input_with_sealed_evidence(
            command,
            test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
            test_identity(),
            &context,
            &test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
            TwoPartyDeriverRole::DeriverA,
        )
        .expect("refresh input");
        let original_digest =
            refresh_insert_pending_payload_digest(&input.command, &input.record, 1)
                .expect("original operation payload digest");
        let changed_digest =
            refresh_insert_pending_payload_digest(&changed_command, &input.record, 1)
                .expect("changed operation payload digest");
        assert_ne!(input.command.digest(), changed_command.digest());
        assert_ne!(original_digest, changed_digest);

        let scope = input.command.scope();
        let key = *scope.key();
        let reserved = match reserve_tenant_root_command_v1(None, key, original_digest, 40)
            .expect("fresh reservation")
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => panic!("fresh reservation must be executable"),
        };
        let reserved_record = TenantRootCommandReplayRecordV1::Reserved(reserved);
        assert!(
            reserve_tenant_root_command_v1(Some(&reserved_record), key, changed_digest, 400,)
                .is_err()
        );
        assert!(matches!(
            reserve_tenant_root_command_v1(Some(&reserved_record), key, original_digest, 400)
                .expect("exact reserved retry"),
            TenantRootCommandReplayDecisionV1::InProgress
        ));

        let completed_reservation =
            match reserve_tenant_root_command_v1(None, key, original_digest, 40)
                .expect("fresh completion reservation")
            {
                TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
                _ => panic!("fresh completion reservation must be executable"),
            };
        let completed = completed_reservation
            .checkpoint_executed(41)
            .expect("executed checkpoint")
            .complete(
                TenantRootProtocolDigestV1::from_bytes([0x79; 32]).expect("receipt digest"),
                42,
            )
            .expect("completed command");
        assert!(matches!(
            reserve_tenant_root_command_v1(Some(&completed), key, original_digest, 400)
                .expect("exact completed retry"),
            TenantRootCommandReplayDecisionV1::ReplayCompleted { .. }
        ));
        assert!(
            reserve_tenant_root_command_v1(Some(&completed), key, changed_digest, 400).is_err()
        );
    }

    #[test]
    fn refresh_input_rejects_context_identity_lineage_role_epoch_commitment_and_evidence_substitution(
    ) {
        let identity = test_identity();
        let context = test_refresh_context();

        let foreign_identity = TenantRootIdentityV1::new(
            "org-2",
            "project-1",
            "env-1",
            "project-1:env-1",
            "root-version-1",
        )
        .expect("foreign identity");
        let foreign_context =
            test_refresh_context_with_identity(foreign_identity.clone(), 0x44, 1, 2, 0x45, 0x46);
        let foreign_evidence =
            test_refresh_evidence(&foreign_context, TwoPartyDeriverRole::DeriverA);
        assert!(refresh_input_with_sealed_evidence(
            test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4),
            foreign_evidence,
            foreign_identity,
            &foreign_context,
            &test_refresh_evidence(&foreign_context, TwoPartyDeriverRole::DeriverA),
            TwoPartyDeriverRole::DeriverA,
        )
        .is_err());

        let foreign_lineage_context =
            test_refresh_context_with_identity(identity.clone(), 0x45, 1, 2, 0x45, 0x46);
        let foreign_lineage_evidence =
            test_refresh_evidence(&foreign_lineage_context, TwoPartyDeriverRole::DeriverA);
        assert!(refresh_input_with_sealed_evidence(
            test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4),
            foreign_lineage_evidence,
            identity.clone(),
            &foreign_lineage_context,
            &test_refresh_evidence(&foreign_lineage_context, TwoPartyDeriverRole::DeriverA),
            TwoPartyDeriverRole::DeriverA,
        )
        .is_err());

        let role_evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
        assert!(refresh_input_with_sealed_evidence(
            test_verified_refresh_command(TwoPartyDeriverRole::DeriverB, 4),
            role_evidence,
            identity.clone(),
            &context,
            &test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
            TwoPartyDeriverRole::DeriverA,
        )
        .is_err());

        let foreign_epoch_context =
            test_refresh_context_with_identity(identity.clone(), 0x44, 2, 3, 0x45, 0x46);
        let foreign_epoch_evidence =
            test_refresh_evidence(&foreign_epoch_context, TwoPartyDeriverRole::DeriverA);
        assert!(refresh_input_with_sealed_evidence(
            test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4),
            foreign_epoch_evidence,
            identity.clone(),
            &foreign_epoch_context,
            &test_refresh_evidence(&foreign_epoch_context, TwoPartyDeriverRole::DeriverA),
            TwoPartyDeriverRole::DeriverA,
        )
        .is_err());

        let commitment_evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverB);
        assert!(refresh_input_with_sealed_evidence(
            test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4),
            test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
            identity.clone(),
            &context,
            &commitment_evidence,
            TwoPartyDeriverRole::DeriverB,
        )
        .is_err());

        let sealed_evidence =
            test_refresh_evidence_with_seeds(&context, TwoPartyDeriverRole::DeriverA, 0x59, 0x69);
        let arrival_evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
        assert_ne!(
            sealed_evidence.canonical_bytes(),
            arrival_evidence.canonical_bytes()
        );
        assert!(refresh_input_with_sealed_evidence(
            test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4),
            arrival_evidence,
            identity,
            &context,
            &sealed_evidence,
            TwoPartyDeriverRole::DeriverA,
        )
        .is_err());
    }

    #[test]
    fn refresh_success_receipt_requires_exact_evidence_payload() {
        let context = test_refresh_context();
        let evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
        let expected_payload = evidence.canonical_bytes().to_vec();
        let key = TenantRootCommandReplayKeyV1::deriver_a(
            test_identity().digest().expect("identity digest"),
            TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage"),
            TenantRootCeremonySessionIdV1::from_bytes([0x71; 16]).expect("session"),
            TenantRootCeremonyNonceV1::from_bytes([0x72; 32]).expect("nonce"),
        );
        let command_digest = TenantRootProtocolDigestV1::from_bytes([0x73; 32]).expect("digest");
        let reservation = match reserve_tenant_root_command_v1(None, key, command_digest, 20)
            .expect("reservation")
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => panic!("fresh reservation must be executable"),
        };
        let executed = reservation.checkpoint_executed(21).expect("executed");
        let signing_key = SigningKey::from_bytes(&[0x74; 32]);
        let signed = TenantRootCommandTerminalReceiptV1::sign_success(
            key,
            command_digest,
            expected_payload,
            22,
            "r120-refresh-command-key-v1",
            signing_key.as_bytes(),
        )
        .expect("signed receipt");
        let receipt_bytes = signed.canonical_bytes().expect("receipt bytes");
        let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
            .expect("decoded receipt")
            .verify_success(
                &executed,
                "r120-refresh-command-key-v1",
                signing_key.verifying_key().as_bytes(),
            )
            .expect("verified receipt");
        assert!(validate_refresh_success_receipt_payload(&evidence, &receipt).is_ok());

        let signed = TenantRootCommandTerminalReceiptV1::sign_success(
            key,
            command_digest,
            b"changed arrival bytes".to_vec(),
            22,
            "r120-refresh-command-key-v1",
            signing_key.as_bytes(),
        )
        .expect("signed changed receipt");
        let receipt_bytes = signed.canonical_bytes().expect("changed receipt bytes");
        let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
            .expect("decoded changed receipt")
            .verify_success(
                &executed,
                "r120-refresh-command-key-v1",
                signing_key.verifying_key().as_bytes(),
            )
            .expect("verified changed receipt");
        assert!(validate_refresh_success_receipt_payload(&evidence, &receipt).is_err());
    }

    #[test]
    fn refresh_durable_state_retains_exact_prepared_artifact_bytes() {
        let context = test_refresh_context();
        let evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
        let command = test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4);
        let managed_backup = test_verified_managed_backup(
            &context,
            TwoPartyDeriverRole::DeriverA,
            17,
            0x88,
            &evidence,
        );
        let commitments = TenantRootEpochCommitmentsV1::new(
            pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17),
            pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 29),
        )
        .expect("refresh commitments");
        let provider_canary = test_verified_provider_canary(
            &context,
            TenantRootActivationReceiptTransitionV1::RefreshSwap,
            epoch(2),
            &commitments,
            TenantRootCanaryCurveFamilyV1::Ecdsa,
            0x89,
        );
        let provider_canary = TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(
            provider_canary.canonical_bytes(),
        )
        .expect("signed provider canary");
        let prepared =
            CloudflareTenantRootRefreshPreparedArtifactsV1::new(&managed_backup, &provider_canary)
                .expect("prepared artifacts");
        let state = CloudflareTenantRootRefreshDurableStateV1::Executed {
            command_b64u: encode_base64url_bytes_v1(command.canonical_bytes()),
            evidence_b64u: encode_base64url_bytes_v1(evidence.canonical_bytes()),
            prepared_artifacts: prepared,
        };
        let (state_b64u, state_digest_hex) = state.encode().expect("encoded durable state");
        let decoded = decode_refresh_durable_state(&state_b64u, &state_digest_hex)
            .expect("decoded durable state");
        let prepared = decoded
            .prepared_artifacts()
            .expect("prepared artifacts accessor");
        assert_eq!(
            prepared.managed_backup_bytes().expect("backup bytes"),
            managed_backup.canonical_bytes()
        );
        assert_eq!(
            prepared
                .provider_canary_receipt_bytes()
                .expect("canary bytes"),
            provider_canary.canonical_bytes().expect("canary bytes")
        );
    }

    #[test]
    fn refresh_replay_state_requires_exact_command_bytes_and_rejects_failed_state() {
        let command = test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4);
        let state = CloudflareTenantRootRefreshDurableStateV1::admitted(
            &command,
            encode_base64url_bytes_v1(&[1; 80]),
        )
        .expect("refresh admission state");
        let operation_digest =
            refresh_admission_operation_digest(&command.scope(), command.digest())
                .expect("refresh operation digest");
        let reservation = match reserve_tenant_root_command_v1(
            None,
            *command.scope().key(),
            operation_digest,
            20,
        )
        .expect("refresh reservation")
        {
            TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
            _ => panic!("fresh refresh replay must reserve"),
        };
        let stored = StoredTenantRootCommandReplayV1 {
            record: TenantRootCommandReplayRecordV1::Reserved(reservation),
            admission_digest: Some(command.digest()),
            refresh_state: Some(state.clone()),
            receipt_bytes: None,
            reserved_at_ms: 20,
            executed_at_ms: None,
        };
        assert_eq!(
            refresh_replay_state_for_command(&stored, command.canonical_bytes())
                .expect("exact refresh replay state"),
            state
        );
        let mut changed_command_bytes = command.canonical_bytes().to_vec();
        changed_command_bytes[0] ^= 1;
        assert!(refresh_replay_state_for_command(&stored, &changed_command_bytes).is_err());
        assert!(!state.kind_matches_status("failed"));
    }

    #[test]
    fn refresh_control_plane_revision_is_distinct_from_new_row_revision() {
        let context = test_refresh_context();
        let evidence = test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA);
        let command = test_verified_refresh_command(TwoPartyDeriverRole::DeriverA, 4);
        let input = refresh_input_with_sealed_evidence(
            command,
            evidence,
            test_identity(),
            &context,
            &test_refresh_evidence(&context, TwoPartyDeriverRole::DeriverA),
            TwoPartyDeriverRole::DeriverA,
        )
        .expect("refresh input");
        let scope = input.command.scope();
        let stored = CloudflareStoredTenantRootRoleShareV1 {
            record: input.record,
            revision: 1,
        };
        let replay_key_digest = scope
            .key()
            .storage_key_digest()
            .expect("refresh replay key digest");
        let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = stored.record.lifecycle()
        else {
            panic!("refresh input must remain pending before activation");
        };
        assert_eq!(pending.refresh_replay_key_digest(), Some(replay_key_digest));
        assert_eq!(scope.expected_control_plane_revision(), 4);
        assert_eq!(stored.revision(), 1);
        assert_ne!(
            scope.expected_control_plane_revision() as i64,
            stored.revision()
        );
    }

    #[test]
    fn record_rejects_commitment_for_the_other_role() {
        let mut record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
        let mut commitment = record.share_commitment.as_bytes().to_vec();
        commitment[..2].copy_from_slice(&2_u16.to_be_bytes());
        record.share_commitment =
            MpcPrfShareCommitmentWireV1::new(commitment).expect("B commitment");
        assert!(record.validate().is_err());
    }

    #[test]
    fn epoch_swap_requires_exact_identity_lineage_role_and_next_epoch() {
        let active_record = record(CloudflareTenantRootDeriverRoleV1::DeriverA)
            .into_active(
                current_backup_activation(
                    CloudflareTenantRootDeriverRoleV1::DeriverA,
                    0x88,
                    0x89,
                    20,
                ),
                20,
            )
            .expect("active");
        let pending_record = record_for_identity_epoch(
            test_identity(),
            CloudflareTenantRootDeriverRoleV1::DeriverA,
            0x44,
            TenantRootShareEpoch::new(2).expect("epoch 2"),
            pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 18),
        );
        let active = CloudflareStoredTenantRootRoleShareV1 {
            record: active_record,
            revision: 2,
        };
        let pending = CloudflareStoredTenantRootRoleShareV1 {
            record: pending_record.clone(),
            revision: 1,
        };
        assert!(validate_epoch_swap_inputs(&active, &pending).is_ok());

        let mut wrong_identity = pending_record.clone();
        wrong_identity.identity = TenantRootIdentityV1::new(
            "org-2",
            "project-1",
            "env-1",
            "project-1:env-1",
            "root-version-1",
        )
        .expect("identity");
        assert!(validate_epoch_swap_inputs(
            &active,
            &CloudflareStoredTenantRootRoleShareV1 {
                record: wrong_identity,
                revision: 1,
            }
        )
        .is_err());

        let mut wrong_lineage = pending_record.clone();
        wrong_lineage.custody_lineage =
            TenantRootCustodyLineageId::from_bytes([0x45; 16]).expect("lineage");
        assert!(validate_epoch_swap_inputs(
            &active,
            &CloudflareStoredTenantRootRoleShareV1 {
                record: wrong_lineage,
                revision: 1,
            }
        )
        .is_err());

        let mut wrong_next_epoch = pending_record;
        wrong_next_epoch.epoch = TenantRootShareEpoch::new(3).expect("epoch 3");
        assert!(validate_epoch_swap_inputs(
            &active,
            &CloudflareStoredTenantRootRoleShareV1 {
                record: wrong_next_epoch,
                revision: 1,
            }
        )
        .is_err());

        let wrong_role = CloudflareStoredTenantRootRoleShareV1 {
            record: record(CloudflareTenantRootDeriverRoleV1::DeriverB),
            revision: 1,
        };
        assert!(validate_epoch_swap_inputs(&active, &wrong_role).is_err());
    }

    #[test]
    fn restore_session_cleanup_receipt_is_deterministic_and_nonzero() {
        let identity = TenantRootIdentityDigestV1::from_bytes([0x11; 32]);
        let lineage = TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage");
        let session =
            TenantRootRestoreSessionIdV1::from_bytes([0x33; 16]).expect("restore session");
        let activation_digest = lifecycle_receipt(0x44).expect("activation digest");
        let first = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
            identity,
            lineage,
            session,
            CloudflareTenantRootDeriverRoleV1::DeriverA,
            "initial_creation",
            activation_digest,
            100,
        )
        .expect("cleanup receipt");
        let replay = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
            identity,
            lineage,
            session,
            CloudflareTenantRootDeriverRoleV1::DeriverA,
            "initial_creation",
            activation_digest,
            100,
        )
        .expect("cleanup receipt replay");
        assert_eq!(first, replay);
        assert!(first.digest().as_bytes().iter().any(|byte| *byte != 0));
        let changed_close_time = CloudflareTenantRootRestoreSessionCleanupReceiptV1::new(
            identity,
            lineage,
            session,
            CloudflareTenantRootDeriverRoleV1::DeriverA,
            "initial_creation",
            activation_digest,
            101,
        )
        .expect("changed cleanup receipt");
        assert_ne!(first, changed_close_time);
    }
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
pub(crate) mod source_retirement;
