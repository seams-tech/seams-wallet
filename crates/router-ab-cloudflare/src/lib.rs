#![forbid(unsafe_code)]
//! Cloudflare adapter boundary types for Router/A/B signing.
//!
//! This crate pins role-specific binding and storage-scope rules before the
//! `workers-rs` adapter layer is added.

#[cfg(feature = "strict-worker-signing-worker-entrypoint")]
mod ecdsa_signing_fetch;
#[cfg(feature = "strict-worker-signing-worker-entrypoint")]
pub use ecdsa_signing_fetch::*;

mod auth;
mod authorized_operations;
pub use authorized_operations::*;

use base64::Engine;
mod durable_object;
#[cfg(feature = "workers-rs")]
mod ecdsa_normal_signing_transport;
mod ecdsa_pool_lifecycle;
pub use ecdsa_pool_lifecycle::*;
mod ecdsa_export;
pub use ecdsa_export::*;
mod ecdsa_registration;
pub use ecdsa_registration::*;
mod ecdsa_presign_session;
pub(crate) use ecdsa_presign_session::*;
mod ecdsa_signing;
pub use ecdsa_signing::*;
mod ed25519_yao_pair_protocol;
pub use ed25519_yao_pair_protocol::*;
mod ed25519_yao_router_checks;
pub(crate) use ed25519_yao_router_checks::*;
// Only the two Deriver Workers run the prewarm ceremony.
#[cfg_attr(
    not(any(
        feature = "strict-worker-deriver-a-entrypoint",
        feature = "strict-worker-deriver-b-entrypoint"
    )),
    allow(dead_code)
)]
mod ed25519_yao_prewarm;
#[cfg(feature = "workers-rs")]
mod ed25519_yao_websocket;
#[cfg(feature = "workers-rs")]
pub use ed25519_yao_websocket::*;
#[cfg(feature = "workers-rs")]
mod ed25519_yao_lifecycle;
#[cfg(feature = "workers-rs")]
pub(crate) use ed25519_yao_lifecycle::*;
// A linked device's Ed25519 reservation lifecycle is shared by every host;
// its D1 store and Worker routes are Cloudflare-only.
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code, unused_imports))]
mod ed25519_yao_signing_worker;
pub use ed25519_yao_signing_worker::{
    build_output_activation_record_at_v1, decide_ed25519_yao_recovery_delivery_v1,
    decide_ed25519_yao_recovery_promotion_v1, public_activation_receipt_v1,
    reservation_record_key_from_binding_v1, reservation_record_key_from_material_activation_v1,
    settle_linked_ed25519_activation_v1, settle_linked_ed25519_deactivation_v1,
    settle_linked_ed25519_reservation_v1, source_preserving_reservation_id_v1,
    CloudflareEd25519YaoActivateReservationRequestV1,
    CloudflareEd25519YaoDeactivateReservationRequestV1,
    CloudflareEd25519YaoInactiveReservationRequestV1,
    CloudflareEd25519YaoInactiveReservationResponseV1,
    CloudflareEd25519YaoInitialRegistrationFinalizationLookupRequestV1,
    CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1,
    CloudflareEd25519YaoPackagePairDeliveryV1, CloudflareEd25519YaoRecoveryPromotionRequestV1,
    CloudflareEd25519YaoReservationActivationResponseV1,
    CloudflareEd25519YaoReservationDeactivationResponseV1,
    CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1,
    CloudflareScopedEd25519YaoPackagePairDeliveryV1,
    CloudflareScopedEd25519YaoRecoveryPromotionRequestV1, Ed25519YaoRecoveryDeliveryDecisionV1,
    Ed25519YaoRecoveryHeldV1, Ed25519YaoRecoveryPromotionDecisionV1,
    Ed25519YaoRecoveryPromotionHeldV1, LinkedEd25519ActivationV1, LinkedEd25519DeactivationV1,
    LinkedEd25519ReservationV1, SigningWorkerYaoReservationStateV1,
    CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_ACTIVATE_RESERVATION_PATH,
    CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_DEACTIVATE_RESERVATION_PATH,
    CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_INITIAL_REGISTRATION_FINALIZATION_LOOKUP_PATH,
    CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_PACKAGES_PATH,
    CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RECOVERY_PROMOTE_PATH,
    CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RESERVE_INACTIVE_PATH,
    CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RESERVE_INACTIVE_SOURCE_PRESERVING_PATH,
};
#[cfg(feature = "workers-rs")]
pub use ed25519_yao_signing_worker::{
    handle_cloudflare_signing_worker_ed25519_yao_activate_reservation_v1,
    handle_cloudflare_signing_worker_ed25519_yao_deactivate_reservation_v1,
    handle_cloudflare_signing_worker_ed25519_yao_initial_registration_finalization_lookup_v1,
    handle_cloudflare_signing_worker_ed25519_yao_packages_v1,
    handle_cloudflare_signing_worker_ed25519_yao_recovery_promote_v1,
    handle_cloudflare_signing_worker_ed25519_yao_reserve_inactive_source_preserving_v1,
    handle_cloudflare_signing_worker_ed25519_yao_reserve_inactive_v1,
};
// A linked device's ECDSA reservation lifecycle is shared by every host;
// its D1 store and Worker routes are Cloudflare-only.
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code, unused_imports))]
mod ordinary_inactive_signer_material;
#[cfg(feature = "workers-rs")]
pub(crate) use ordinary_inactive_signer_material::{
    handle_cloudflare_signing_worker_ecdsa_activate_reservation_v1,
    handle_cloudflare_signing_worker_ecdsa_deactivate_reservation_v1,
    handle_cloudflare_signing_worker_ecdsa_reserve_inactive_source_preserving_v1,
    handle_cloudflare_signing_worker_ecdsa_reserve_inactive_v1,
};
pub(crate) use ordinary_inactive_signer_material::{
    CloudflareEcdsaActivateReservationRequestV1, CloudflareEcdsaDeactivateReservationRequestV1,
    CloudflareEcdsaInactiveMaterialReservationRequestV1,
    CloudflareEcdsaInactiveMaterialReservationResponseV1,
    CloudflareEcdsaReservationActivationResponseV1,
    CloudflareEcdsaReservationDeactivationResponseV1,
    CloudflareEcdsaSourcePreservingInactiveMaterialReservationRequestV1,
    CloudflareEcdsaSourcePreservingInactiveMaterialReservationResponseV1,
    CloudflareEcdsaSourcePreservingReservationActivationResponseV1,
    CLOUDFLARE_SIGNING_WORKER_ECDSA_ACTIVATE_RESERVATION_PATH,
    CLOUDFLARE_SIGNING_WORKER_ECDSA_DEACTIVATE_RESERVATION_PATH,
    CLOUDFLARE_SIGNING_WORKER_ECDSA_RESERVE_INACTIVE_PATH,
    CLOUDFLARE_SIGNING_WORKER_ECDSA_RESERVE_INACTIVE_SOURCE_PRESERVING_PATH,
};
mod tenant_root_role_sql;
#[cfg(feature = "postgres")]
pub use tenant_root_role_sql::{
    apply_postgres_role_store_schema_v1, PostgresRoleSqlOutcomeV1, PostgresRoleSqlSessionV1,
};
pub use tenant_root_role_sql::{
    RoleSqlOutcomeV1, RoleSqlOwnedValueV1, RoleSqlReadV1, RoleSqlSessionV1, RoleSqlStatement,
    RoleSqlTransactionStatement, RoleSqlValue, RoleStoreError, RoleStoreResult,
};
// Shared by every host. Its refresh, restore, retirement and cutover paths
// still have only Cloudflare callers, so a Cloudflare-free build leaves them unused.
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code, unused_imports))]
mod tenant_root_role_d1;
pub use tenant_root_role_d1::*;
// Tenant-root creation, shared by every host. The Cloudflare Workers wrap
// these with Worker bindings; the VM reference (router-ab-dev) implements the
// same host traits with ordinary processes and role-private SQLite.
pub(crate) use env::{
    parse_cloudflare_tenant_root_recovery_trust_bundle_v1,
    parse_cloudflare_tenant_root_recovery_trust_snapshot_v1,
};
pub use durable_object::tenant_root_creation::{
    tenant_root_creation_active_state_with_revision_read_call_v1,
    tenant_root_creation_cleanup_call_v1, tenant_root_creation_journal_call_v1,
    tenant_root_creation_journal_read_call_v1, tenant_root_creation_object_name_v1,
    parse_tenant_root_refresh_schedule_v1, parse_tenant_root_retirement_grace_ms_v1,
    tenant_root_creation_serve_v1,
    TenantRootRefreshScheduleV1, TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1,
    CloudflareTenantRootCreationJournalReadRequestV1,
    CloudflareTenantRootCreationJournalReadResponseV1,
    CloudflareTenantRootCreationJournalResponseV1, CloudflareVerifiedTenantRootActiveStateV1,
    CloudflareTenantRootRefreshTriggerV1, TenantRootCreationStateTransportV1,
    TenantRootCreationStoreV1, CLOUDFLARE_TENANT_ROOT_CREATION_ABANDONMENT_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_CLEANUP_CHECKPOINT_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_INITIAL_ACTIVATION_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_PATH, CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_READ_PATH,
    CLOUDFLARE_TENANT_ROOT_CREATION_PROGRESS_READ_PATH,
    CLOUDFLARE_TENANT_ROOT_REFRESH_ACTIVATION_PATH,
    CLOUDFLARE_TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_PATH,
    CLOUDFLARE_TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_PATH,
    CLOUDFLARE_TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_PATH,
};
pub use tenant_root_role_runtime::{
    tenant_root_deriver_cleanup_v1, tenant_root_deriver_create_role_share_v1,
    tenant_root_deriver_creation_evidence_v1, CloudflareDeriverTenantRootCreationEvidenceRequestV1,
    CloudflareDeriverTenantRootCreationEvidenceResponseV1,
    tenant_root_deriver_initial_activation_v1,
    tenant_root_deriver_admit_bound_work_v1, tenant_root_deriver_load_bound_role_share_v1,
    tenant_root_deriver_managed_restore_forward_refresh_v1, tenant_root_deriver_managed_restore_v1,
    tenant_root_deriver_refresh_activation_v1,
    tenant_root_deriver_refresh_v1, CloudflareDeriverTenantRootCreateRoleShareRequestV1,
    CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1,
    CloudflareDeriverTenantRootManagedRestoreRequestV1,
    CloudflareDeriverTenantRootCreateRoleShareResponseV1,
    CloudflareDeriverTenantRootInitialActivationRequestV1,
    CloudflareDeriverTenantRootInitialActivationResponseV1, CloudflareTenantRootCreateRoleV1,
    CloudflareDeriverTenantRootCleanupRequestV1, CloudflareDeriverTenantRootCleanupResponseV1,
    CloudflareDeriverTenantRootPeerPairFenceRequestV1,
    CloudflareDeriverTenantRootPeerPairFenceResponseV1, tenant_root_deriver_fence_peer_pair_v1,
    TenantRootDeriverHostV1,
    tenant_root_deriver_restore_preactivation_cleanup_v1,
    tenant_root_deriver_restore_refresh_promotion_v1,
    tenant_root_deriver_restore_role_import_accept_v1,
    tenant_root_deriver_restore_role_import_key_v1,
    tenant_root_deriver_restore_session_cleanup_v1,
    TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS_V1,
    CloudflareDeriverTenantRootPreactivationCleanupRequestV1,
    CloudflareDeriverTenantRootRestoreRoleImportAcceptRequestV1,
    CloudflareDeriverTenantRootRestoreRoleImportKeyRequestV1,
    CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1,
};
pub use tenant_root_role_d1::{
    TenantRootRootUseAttemptV1, TENANT_ROOT_CLAIM_ROOT_USE_ADMISSION_SQL_V1,
    TENANT_ROOT_ROOT_USE_ADMISSION_STATUS_SQL_V1, TENANT_ROOT_SETTLE_ROOT_USE_ADMISSION_SQL_V1,
    TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1,
};
mod tenant_root_creation_coordinator;
pub(crate) use tenant_root_creation_coordinator::{
    tenant_root_router_coordinate_creation_v1, tenant_root_router_sweep_abandoned_creation_v1,
    CloudflareTenantRootCreationSweepResponseV1, TenantRootRouterCreationHostV1,
};
mod tenant_root_managed_restore_coordinator;
pub(crate) use tenant_root_managed_restore_coordinator::{
    tenant_root_router_coordinate_managed_restore_v1,
    CloudflareRouterTenantRootManagedRestoreRequestV1,
    TENANT_ROOT_MANAGED_RESTORE_REQUEST_MAX_BYTES_V1,
};
mod tenant_root_restore_coordinator;
pub(crate) use tenant_root_restore_coordinator::{
    tenant_root_router_destination_bootstrap_v1, tenant_root_router_register_manifest_v1,
    tenant_root_router_restore_activation_v1, tenant_root_router_restore_cleanup_v1,
    tenant_root_router_restore_refresh_v1, tenant_root_router_restore_role_import_accept_v1,
    tenant_root_router_restore_role_import_key_v1,
    CloudflareRouterTenantRootRestoreCleanupRequestV1,
    CloudflareRouterTenantRootRestoreRoleImportAcceptRequestV1,
};
mod tenant_root_refresh_coordinator;
pub(crate) use tenant_root_refresh_coordinator::{tenant_root_router_admission_receipt_v1, tenant_root_router_coordinate_refresh_v1, CloudflareRouterTenantRootRefreshRequestV1, CloudflareRouterTenantRootRefreshResponseV1, CloudflareRouterTenantRootRefreshResultV1, CloudflareRouterTenantRootRetirementEvidenceV1, CloudflareRouterTenantRootRoleRetirementV1};
mod tenant_root_transport;
pub(crate) use tenant_root_transport::{
    TenantRootCallBoundsV1, TenantRootServiceTargetV1, TenantRootServiceTransportV1,
};
// The issuer's pure authorization and validation logic is host-neutral; its
// Worker handlers live in the gated `live` submodule.
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code, unused_imports))]
mod tenant_root_control_plane;
mod tenant_root_cutover_lifecycle;
mod tenant_root_managed_backup_r2;
mod tenant_root_operational_provider;
#[cfg(feature = "workers-rs")]
pub(crate) use tenant_root_control_plane::{
    handle_cloudflare_tenant_root_control_plane_cleanup_command_v1,
    handle_cloudflare_tenant_root_control_plane_create_tenant_root_v1,
    handle_cloudflare_tenant_root_control_plane_refresh_commands_v1,
    handle_cloudflare_tenant_root_control_plane_register_manifest_v1,
    handle_cloudflare_tenant_root_control_plane_restore_role_import_key_v1,
    handle_cloudflare_tenant_root_control_plane_role_creation_command_v1,
};
pub(crate) use tenant_root_control_plane::{
    CloudflareTenantRootControlPlaneCleanupCommandRequestV1,
    CloudflareTenantRootControlPlaneCleanupCommandResponseV1,
    CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
    CloudflareTenantRootControlPlaneCreateTenantRootResponseV1,
    CloudflareTenantRootControlPlaneRefreshCommandsRequestV1,
    CloudflareTenantRootControlPlaneRefreshCommandsResponseV1,
    CloudflareTenantRootControlPlaneRegisterManifestRequestV1,
    CloudflareTenantRootControlPlaneRegisterManifestResponseV1,
    CloudflareTenantRootControlPlaneRestoreRoleImportKeyRequestV1,
    CloudflareTenantRootControlPlaneRestoreRoleImportKeyResponseV1,
    CloudflareTenantRootControlPlaneRestoreRefreshCommandsRequestV1,
    CloudflareTenantRootControlPlaneRestoreRefreshCommandsResponseV1,
    CloudflareTenantRootControlPlaneRestoreInitialActivationRequestV1,
    TENANT_ROOT_CONTROL_PLANE_RESTORE_REFRESH_COMMANDS_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_RESTORE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
    CloudflareTenantRootControlPlaneRoleCreationCommandRequestV1,
    CloudflareTenantRootControlPlaneRoleCreationCommandResponseV1,
    CloudflareTenantRootControlPlaneRoleV1, CloudflareTenantRootCreationStatusV1,
    CloudflareTenantRootRecoveryManifestRoleV1, CloudflareTenantRootRecoveryTrustLevelV1,
    TENANT_ROOT_CONTROL_PLANE_CLEANUP_COMMAND_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_CREATE_TENANT_ROOT_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_REFRESH_COMMANDS_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_REGISTER_MANIFEST_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_RESTORE_ROLE_IMPORT_REQUEST_MAX_BYTES_V1,
    TENANT_ROOT_CONTROL_PLANE_ROLE_CREATION_COMMAND_REQUEST_MAX_BYTES_V1,
};
#[cfg(feature = "workers-rs")]
mod tenant_root_google_kms;
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
mod tenant_root_recovery_runtime;
mod tenant_root_recovery_reshare;
mod tenant_root_restore_refresh_runtime;
#[cfg_attr(not(feature = "workers-rs"), allow(unused_imports))]
mod tenant_root_role_runtime;
pub use tenant_root_cutover_lifecycle::*;
mod tenant_root_revision_manifest;
pub use tenant_root_revision_manifest::*;
mod router;
pub use router::*;
mod router_wallet;
mod wallet_object;
mod wallet_home;
pub use wallet_home::WalletHomeRegion;
mod wallet_object_address;
pub use wallet_object_address::{WalletObjectAddresses, WalletObjectId, WalletObjectRoute};
#[cfg(feature = "workers-rs")]
use wallet_object::SigningWorkerWalletRoute;
pub(crate) use router_wallet::*;
mod router_wallet_relocation;
#[cfg(all(feature = "workers-rs", any(feature = "strict-worker-router-entrypoint", test)))]
mod signing_worker_relocation_transport;
mod router_wallet_transfer;
pub(crate) use router_wallet_transfer::{
    transfer_router_wallet_v1, RouterWalletActivationReceiptV1, RouterWalletTransferChunkV1,
    RouterWalletTransferRequestV1,
    RouterWalletTransferResponseV1, ROUTER_WALLET_TRANSFER_PATH_V1,
};
pub(crate) use router_wallet_relocation::{
    freeze_router_wallet_v1, RouterWalletFreezeReceiptV1, RouterWalletFreezeRequestV1,
    RouterWalletFreezeResponseV1, ROUTER_WALLET_FREEZE_PATH_V1,
};

#[cfg(feature = "workers-rs")]
mod router_coordinator;
#[cfg(feature = "workers-rs")]
pub(crate) use router_coordinator::{
    handle_cloudflare_router_ed25519_yao_execute_private_fetch_v1,
    handle_cloudflare_router_ed25519_yao_lane_execute_private_fetch_v1,
    handle_cloudflare_router_ed25519_yao_recovery_promote_private_fetch_v1,
    handle_cloudflare_router_ed25519_yao_registration_consume_private_fetch_v1,
    handle_cloudflare_router_ed25519_yao_source_preserving_execute_private_fetch_v1,
    CloudflareRouterEd25519YaoLaneExecuteRequestV2,
};
mod signing_worker;
pub use signing_worker::*;
mod env;
pub use env::*;
use env::{
    parse_cloudflare_custody_authority_verifiers_v1,
    parse_cloudflare_operations_incident_verifier_v1,
    DERIVER_A_FORBIDDEN_ENV_KEYS,
    DERIVER_B_FORBIDDEN_ENV_KEYS, ROUTER_FORBIDDEN_ENV_KEYS, SIGNING_WORKER_FORBIDDEN_ENV_KEYS,
};
mod validation;
pub(crate) use validation::{
    require_no_ascii_whitespace, require_non_empty, require_non_empty_vec, require_positive_ms,
};
mod hpke;
#[cfg(feature = "workers-rs")]
use hpke::CloudflareHpkeGetrandomRngV1;
#[cfg(test)]
use hpke::{
    cloudflare_hpke_recipient_proof_bundle_aad_v1, CloudflareHpkeKemV1, CloudflareHpkeSuiteV1,
    CLOUDFLARE_HPKE_RECIPIENT_OUTPUT_ENVELOPE_NONCE_V1, CLOUDFLARE_HPKE_RECIPIENT_OUTPUT_INFO_V1,
    CLOUDFLARE_HPKE_RECIPIENT_PROOF_BUNDLE_INFO_V1,
};
pub use hpke::{
    cloudflare_server_output_material_record_from_activation_request_v1,
    decode_cloudflare_server_output_hpke_private_key_secret_v1,
    decode_cloudflare_signer_envelope_hpke_private_key_secret_v1,
    encode_cloudflare_server_output_hpke_private_key_secret_v1,
    encode_cloudflare_signer_envelope_hpke_private_key_secret_v1,
    open_cloudflare_recipient_proof_bundle_hpke_payload_v1,
    open_cloudflare_recipient_proof_bundle_hpke_payload_v2,
    open_cloudflare_signer_envelope_hpke_payload_v1,
    seal_cloudflare_signer_envelope_hpke_payload_v1, CloudflareHpkeRecipientOutputEncryptorV1,
    CloudflareHpkeRecipientProofBundleEncryptorV1, CloudflareSecretMaterial32V1,
    CloudflareServerOutputMaterialRecordV1,
};
pub(crate) use hpke::cloudflare_server_output_material_record_from_ecdsa_activation_request_v2;
#[cfg(feature = "workers-rs")]
pub(crate) use hpke::cloudflare_server_output_material_record_from_ecdsa_refresh_request_v2;
use hpke::{parse_cloudflare_hpke_x25519_public_key_v1, CloudflareSignerProofGetrandomRngV1};
pub use router_ab_ecdsa_client_protocol::{
    seal_ecdsa_signing_worker_export_share_v1, EcdsaClientProofBundleDeliveryKindV1,
    EcdsaClientProofBundleDeliveryV1, EcdsaClientProofBundlePairDeliveryV1,
    EcdsaMaterialActivationRefKindV1, EcdsaMaterialActivationRefV1,
    EcdsaSigningWorkerExportShareBindingV1, EcdsaSigningWorkerExportShareEnvelopeV1,
    EcdsaVerifiedClientActivationFactsV1,
};
mod encoding;
use auth::hash_optional_header_v1;
#[cfg(feature = "workers-rs")]
pub use auth::{
    cloudflare_private_service_auth_error_response_v1,
    require_cloudflare_gateway_to_router_auth_request_v1,
    require_cloudflare_gateway_to_signing_worker_presign_auth_request_v1,
    require_cloudflare_internal_service_auth_request_v1,
    require_cloudflare_router_to_signing_worker_ecdsa_auth_request_v1,
    set_cloudflare_internal_service_auth_header_v1,
    set_cloudflare_router_to_signing_worker_ecdsa_auth_header_v1,
};
use auth::{
    router_jwt_segment_error, unix_seconds_to_millis_v1, verify_router_ed25519_jwt_signature_v1,
};
use encoding::{
    decode_base64url_bytes_v1, decode_base64url_fixed_32_v1, decode_base64url_fixed_33_v1,
    decode_base64url_fixed_64_v1, decode_base64url_json_v1, encode_base64url_bytes_v1,
};
mod paths;
#[cfg(feature = "workers-rs")]
mod registration_pair_connection;
#[cfg(feature = "workers-rs")]
mod registration_pair_preparation;
pub use paths::*;
mod trace_context;
mod ed25519_normal_signing_transport;
pub use ed25519_normal_signing_transport::*;
#[cfg(feature = "workers-rs")]
mod ecdsa_boundary_timing;
#[cfg(feature = "workers-rs")]
pub(crate) use ecdsa_boundary_timing::CloudflareEcdsaBoundaryTimingV1;
#[cfg(feature = "workers-rs")]
use paths::{
    cloudflare_router_ab_ecdsa_derivation_deriver_export_service_url,
    cloudflare_router_ab_ecdsa_derivation_deriver_refresh_service_url,
    cloudflare_router_ab_ecdsa_derivation_deriver_registration_service_url,
    cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_refresh_service_url,
    cloudflare_router_ab_ecdsa_derivation_signing_worker_activation_service_url,
    cloudflare_router_ab_ecdsa_derivation_signing_worker_export_preflight_service_url,
    cloudflare_router_ab_ecdsa_derivation_signing_worker_export_share_service_url,
    cloudflare_signing_worker_linked_device_ecdsa_finalize_service_url,
    cloudflare_signing_worker_normal_signing_round1_prepare_service_url,
    cloudflare_signing_worker_normal_signing_service_url,
    cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_service_url,
    cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_prepare_service_url,
};
pub(crate) use trace_context::CloudflareTraceIdV1;
#[cfg(feature = "workers-rs")]
pub(crate) use trace_context::{
    parse_cloudflare_trace_id_from_request_v1, set_cloudflare_trace_id_header_v1,
};
#[cfg(any(
    all(
        feature = "strict-worker-router-entrypoint",
        feature = "strict-worker-deriver-a-entrypoint"
    ),
    all(
        feature = "strict-worker-router-entrypoint",
        feature = "strict-worker-deriver-b-entrypoint"
    ),
    all(
        feature = "strict-worker-router-entrypoint",
        feature = "strict-worker-signing-worker-entrypoint"
    ),
    all(
        feature = "strict-worker-deriver-a-entrypoint",
        feature = "strict-worker-deriver-b-entrypoint"
    ),
    all(
        feature = "strict-worker-deriver-a-entrypoint",
        feature = "strict-worker-signing-worker-entrypoint"
    ),
    all(
        feature = "strict-worker-deriver-b-entrypoint",
        feature = "strict-worker-signing-worker-entrypoint"
    ),
    all(
        feature = "strict-worker-router-entrypoint",
        feature = "strict-worker-tenant-root-control-plane-entrypoint"
    ),
    all(
        feature = "strict-worker-deriver-a-entrypoint",
        feature = "strict-worker-tenant-root-control-plane-entrypoint"
    ),
    all(
        feature = "strict-worker-deriver-b-entrypoint",
        feature = "strict-worker-tenant-root-control-plane-entrypoint"
    ),
    all(
        feature = "strict-worker-signing-worker-entrypoint",
        feature = "strict-worker-tenant-root-control-plane-entrypoint"
    ),
))]
compile_error!("enable exactly one strict Worker entrypoint feature");

#[cfg(any(
    feature = "strict-worker-router-entrypoint",
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    feature = "strict-worker-signing-worker-entrypoint",
    feature = "strict-worker-tenant-root-control-plane-entrypoint"
))]
mod strict_worker;
mod worker_bindings;
pub use self::worker_bindings::*;
mod router_bindings;
pub use self::router_bindings::*;
mod role_runtimes;
pub use self::role_runtimes::*;
mod recipient_proof_bundle;
pub use self::recipient_proof_bundle::*;
mod ecdsa_derivation_wire;
pub use self::ecdsa_derivation_wire::*;
mod router_handlers;
pub use self::router_handlers::*;
mod signer_private_requests;
pub use self::signer_private_requests::*;
mod signer_private_handlers;
pub use self::signer_private_handlers::*;
mod signing_worker_fetch;
pub use self::signing_worker_fetch::*;
mod service_calls;
pub use self::service_calls::*;
mod env_parsers;
pub use self::env_parsers::*;
// A build without a strict Worker entry serves no route.
#[cfg(feature = "workers-rs")]
#[cfg_attr(
    not(any(
        feature = "strict-worker-router-entrypoint",
        feature = "strict-worker-deriver-a-entrypoint",
        feature = "strict-worker-deriver-b-entrypoint",
        feature = "strict-worker-signing-worker-entrypoint",
        feature = "strict-worker-tenant-root-control-plane-entrypoint"
    )),
    allow(dead_code)
)]
mod worker_route;

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
pub use durable_object::RouterAbDeriverAWalletDurableObject;
#[cfg(all(feature = "workers-rs", feature = "strict-worker-deriver-b-entrypoint"))]
pub use durable_object::RouterAbDeriverBWalletDurableObject;
#[cfg(all(feature = "workers-rs", any(feature = "strict-worker-router-entrypoint", test)))]
pub use durable_object::RouterAbRouterWalletDurableObject;
#[cfg(all(feature = "workers-rs", any(feature = "strict-worker-signing-worker-entrypoint", test)))]
pub use durable_object::RouterAbSigningWorkerPresignSessionDurableObject;
#[cfg(all(feature = "workers-rs", feature = "strict-worker-signing-worker-entrypoint"))]
pub use durable_object::RouterAbSigningWorkerWalletDurableObject;
pub use durable_object::{
    CloudflareActiveSigningWorkerStateLookupV1, CloudflareEd25519Round1StateV1,
    CloudflareExpiredStateCleanupReportV1, CloudflareExpiredStateCleanupRequestV1,
    CloudflareRootShareStartupMetadataV1, CloudflareSigningWorkerEcdsaPoolAdmissionReceiptV1,
    CloudflareSigningWorkerEcdsaPresignaturePoolRecordV1,
    CloudflareSigningWorkerEcdsaPresignatureRecordV1,
    CloudflareSigningWorkerOutputActivationReceiptV1,
    CloudflareSigningWorkerOutputActivationRecordV1, CloudflareSigningWorkerOutputMaterialLookupV1,
    CloudflareSigningWorkerPrivateD1RequestV1, CloudflareSigningWorkerPrivateD1ResponseV1,
    CloudflareSigningWorkerRound1LookupV1, CloudflareSigningWorkerRound1PutReceiptV1,
    CloudflareSigningWorkerRound1RecordV1,
};
#[cfg(feature = "workers-rs")]
use router_ab_core::RouterAbEcdsaDerivationLinkedDeviceEvmDigestSigningResponseV1;
use router_ab_core::{
    combine_mpc_prf_signing_worker_output_from_activation_context_v1,
    decode_and_validate_signer_envelope_hpke_payload_v1,
    decode_recipient_proof_bundle_ciphertext_v1, decode_recipient_proof_bundle_payload_v1,
    decode_router_to_signer_payload_v1, decode_signer_envelope_hpke_payload_v1,
    encode_recipient_output_ciphertext_aad_v1, encode_recipient_proof_bundle_ciphertext_aad_v1,
    validate_signer_input_plaintext_binding_v1,
    verify_recipient_proof_bundle_ciphertext_payload_v1, ActiveSigningWorkerStateV1, AuditEventV1,
    AuditSink, CanonicalWireBytesV1, Clock, Csprng, EcdsaThresholdPrfOuterRequestV2,
    EcdsaThresholdPrfPrivateRequestV2, EcdsaThresholdPrfPurposeV2, EcdsaThresholdPrfRequestV1,
    EncryptedPayloadV1, ExpensiveWorkGateContextV1, ExpensiveWorkGateDecisionV1,
    ExpensiveWorkKindV1, GateDeferReasonV1, GatePrincipalV1, GateRejectReasonV1,
    MpcMaterialActivationRefV1, NormalSigningAuthorizationV1,
    NormalSigningEd25519TwoPartyFrostCommitmentsV1, NormalSigningResponseV1,
    NormalSigningRound1PrepareResponseV1, NormalSigningScopeV1, NormalSigningSignatureSchemeV1,
    OpenedShareKind, PublicDigest32, RecipientOutputCiphertextV1,
    RecipientOutputEncryptionAlgorithmV1, RecipientOutputEncryptionRequestV1,
    RecipientOutputEncryptorV1, RecipientProofBundleCiphertextV1,
    RecipientProofBundleEncryptionRequestV1, RecipientProofBundleEncryptorV1,
    RecipientProofBundlePayloadV1, Role, RoleEnvelopeAadV1, RootShareEpoch,
    RouterAbDerivationError, RouterAbEcdsaDerivationActivationReceiptV1,
    RouterAbEcdsaDerivationActivationRefreshRequestV1,
    RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    RouterAbEcdsaDerivationEvmDigestSigningPrepareResponseV1,
    RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    RouterAbEcdsaDerivationEvmDigestSigningResponseV1,
    RouterAbEcdsaDerivationExplicitExportRequestV1,
    RouterAbEcdsaDerivationLinkedDeviceNormalSigningScopeV1,
    RouterAbEcdsaDerivationNormalSigningScopeV1, RouterAbEcdsaDerivationPublicIdentityV1,
    RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    RouterAbEcdsaDerivationStableKeyContextV1, RouterAbEd25519NormalSigningAdmissionMaterialV2,
    RouterAbEd25519NormalSigningFinalizeProtocolV2, RouterAbEd25519NormalSigningFinalizeRequestV2,
    RouterAbEd25519NormalSigningPrepareRequestV2,
    RouterRequestPolicyClaimsV1, RouterToSignerPayloadV1, SecretMaterial32, ServerIdentityV1,
    SignerEnvelopeHpkePayloadV1, SignerIdentityV1, SignerInputPlaintextV1, SignerKeyStore,
    SignerSetV1, SigningRootShareStore, SigningWorkerActivationContextV1,
    TenantRootCustodyLineageId, TenantRootDerivationNonceV1, TenantRootDerivationOperationIdV1,
    TenantRootDerivationSessionIdV1, TenantRootIdentityDigestV1, TenantRootProtocolDigestV1,
    TenantRootSignedActivationReceiptV1, VerifiedTenantRootSignedActivationReceiptV1,
    WireMessageKindV1, WireMessageV1, TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1,
    TENANT_ROOT_MAX_LIFETIME_MS_V1,
};
use router_ab_core::{
    evaluate_mpc_prf_stable_signer_partial_with_threshold_backend_v2,
    resolve_authoritative_active_tenant_root_pair_binding_v1,
    MpcPrfOutputRequestV1,
    MpcPrfStablePartialProofBundleV2, MpcPrfStableRecipientProofBundlePayloadV2,
    MpcPrfStableThresholdSignerInputV2, RouterAbEcdsaDerivationDeriverEnvelopePlaintextV1,
    RouterAbEcdsaDerivationRegistrationPurposeV1, SignerInputQuorumPolicyV1,
    TenantRootActiveRoleBindingV1, TenantRootActiveRoleResolutionV1, TenantRootActiveRoleRowKeyV1,
    TenantRootCustodyBindingV1, TenantRootManagedRestoreRoleV1,
    TwoPartyDeriverRole, VerifiedTenantRootOnlineRoleShareV1,
};

#[cfg(any(feature = "workers-rs", test))]
use router_ab_core::{Ed25519YaoInputPairBindingV1, Ed25519YaoOuterBindingV2, Ed25519YaoPairSessionIdV2, TenantRootDeriverIdentitiesV1};
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zeroize::Zeroize;

use router_ab_ecdsa_derivation::{
    compose_public_identity_from_public_keys, derive_relayer_share_for_client_public,
    ecdsa_lane_client_public_key_from_share32_v1, encode_context, RelayerRoleShare,
    RouterAbEcdsaDerivationStableKeyContext,
};
use sha2::{Digest as Sha2Digest, Sha256};

#[cfg(test)]
mod tests;
