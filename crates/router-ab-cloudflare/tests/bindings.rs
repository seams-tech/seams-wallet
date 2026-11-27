#![cfg(not(target_arch = "wasm32"))]

#[path = "bindings/pool_relocation_sqlite.rs"]
mod pool_relocation_sqlite;
#[path = "bindings/wallet_owner_sqlite.rs"]
mod wallet_owner_sqlite;
#[path = "bindings/fixtures.rs"]
mod fixtures;
use self::fixtures::*;
#[path = "bindings/ecdsa_fixtures.rs"]
mod ecdsa_fixtures;
use self::ecdsa_fixtures::*;
#[path = "bindings/router_bindings.rs"]
mod router_bindings;
use self::router_bindings::*;
#[path = "bindings/signer_private.rs"]
mod signer_private;
use self::signer_private::*;
#[path = "bindings/hpke_keys.rs"]
mod hpke_keys;
use self::hpke_keys::*;
#[path = "bindings/ecdsa_derivation.rs"]
mod ecdsa_derivation;
use self::ecdsa_derivation::*;
#[path = "bindings/role_runtime.rs"]
mod role_runtime;
use self::role_runtime::*;
#[path = "bindings/env_parser.rs"]
mod env_parser;
use self::env_parser::*;
#[path = "bindings/control_plane.rs"]
mod control_plane;
use self::control_plane::*;

use base64::Engine;
use ed25519_dalek::{Signature as Ed25519Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hpke_ng::{DhKemX25519HkdfSha256, Kem};
use rand_core_06::SeedableRng;
use router_ab_cloudflare::{
    apply_cloudflare_signing_worker_ecdsa_pool_command_v1,
    build_cloudflare_preloaded_signer_host_v1, build_cloudflare_router_public_keyset_v2,
    cloudflare_active_signing_worker_state_from_activation_request_v1,
    cloudflare_router_ab_ecdsa_derivation_activation_receipt_from_material_v1,
    cloudflare_router_ab_ecdsa_derivation_activation_refresh_receipt_from_material_v1,
    cloudflare_router_ab_ecdsa_derivation_material_activation_ref_v1,
    cloudflare_router_ab_ecdsa_derivation_normal_signing_scope_from_activation_receipt_v1,
    cloudflare_router_ab_ecdsa_derivation_public_identity_from_activation_material_v1,
    cloudflare_router_ab_ecdsa_derivation_public_identity_from_normal_signing_material_v1,
    cloudflare_router_ab_ecdsa_derivation_stable_key_context_v1,
    cloudflare_router_normal_signing_cors_allowed_origin_v1,
    cloudflare_signer_private_bootstrap_from_ecdsa_derivation_registration_v1,
    cloudflare_signer_private_bootstrap_from_public_request_v1,
    decode_and_select_cloudflare_signer_envelope_hpke_decrypt_key_binding_v1,
    decode_and_validate_cloudflare_signer_envelope_hpke_payload_v1,
    decode_cloudflare_server_output_hpke_private_key_secret_v1,
    decode_cloudflare_signer_envelope_hpke_private_key_secret_v1,
    derive_cloudflare_router_trusted_admission_from_provider_v1,
    derive_cloudflare_router_trusted_admission_v1,
    encode_cloudflare_server_output_hpke_private_key_secret_v1,
    encode_cloudflare_signer_envelope_hpke_private_key_secret_v1,
    handle_cloudflare_signing_worker_normal_signing_finalize_private_request_v2,
    handle_cloudflare_signing_worker_normal_signing_prepare_private_request_v2,
    handle_cloudflare_signing_worker_router_ab_ecdsa_derivation_evm_digest_finalize_private_request_v1,
    open_cloudflare_signer_envelope_hpke_payload_v1, parse_cloudflare_deriver_a_bindings_v1,
    parse_cloudflare_deriver_b_bindings_v1, parse_cloudflare_router_admission_bindings_v1,
    parse_cloudflare_router_authorized_ed25519_finalize_request_v2_json,
    parse_cloudflare_router_authorized_router_ab_ecdsa_derivation_finalize_request_v1_json,
    parse_cloudflare_signer_envelope_hpke_decrypt_key_binding_set_v1,
    parse_cloudflare_signer_envelope_hpke_decrypt_key_binding_v1,
    parse_cloudflare_signer_envelope_hpke_public_key_set_v1,
    parse_cloudflare_signer_envelope_hpke_rotation_public_key_set_v1,
    parse_cloudflare_signing_worker_bindings_v1,
    parse_cloudflare_tenant_root_control_plane_bindings_v1,
    parse_cloudflare_tenant_root_control_plane_issuer_signing_key_binding_v1,
    parse_cloudflare_worker_bindings_v1, seal_cloudflare_signer_envelope_hpke_payload_v1,
    validate_cloudflare_router_ab_ecdsa_derivation_activation_refresh_request_for_router_payload_v1,
    validate_cloudflare_router_ab_ecdsa_derivation_export_request_for_router_payload_v1,
    validate_cloudflare_router_ab_ecdsa_derivation_normal_signing_active_material_v1,
    validate_cloudflare_router_ab_ecdsa_derivation_registration_request_for_router_payload_v1,
    validate_cloudflare_signer_private_request_v1, CloudflareActiveSigningWorkerStateLookupV1,
    CloudflareDeriverABindingsV1, CloudflareDeriverAWorkerRuntimeV1, CloudflareDeriverBBindingsV1,
    CloudflareDeriverBWorkerRuntimeV1, CloudflareEd25519Round1StateV1,
    CloudflareEd25519YaoNormalSigningHandlerV1, CloudflareEnvMapV1, CloudflarePeerBindingV1,
    CloudflarePreloadedSignerHostV1,
    CloudflareRoleSeparatedRouterAbEcdsaDerivationEvmDigestFinalizeHandlerV1,
    CloudflareRootShareStartupMetadataV1, CloudflareRouterAbEcdsaDerivationActivationCommandV1,
    CloudflareRouterAbEcdsaDerivationActivationRefreshAdmissionResponseV1,
    CloudflareRouterAbEcdsaDerivationDeriverActivationRefreshPrivateRequestV1,
    CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1,
    CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1,
    CloudflareRouterAbEcdsaDerivationEvmDigestFinalizeAdmissionCandidateV1,
    CloudflareRouterAbEcdsaDerivationEvmDigestPrepareAdmissionCandidateV1,
    CloudflareRouterAbEcdsaDerivationPendingSigningWorkerActivationV1,
    CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1,
    CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRefreshRequestV1,
    CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1,
    CloudflareRouterAbuseCheckV1, CloudflareRouterAdmissionBindingsV1,
    CloudflareRouterAdmissionChecksV1, CloudflareRouterAdmissionProviderOutputV1,
    CloudflareRouterAdmissionProviderV1, CloudflareRouterAllowedWorkKindsProjectPolicyProviderV1,
    CloudflareRouterAuthContextV1, CloudflareRouterBearerAuthorizationV1,
    CloudflareRouterBindingsV1, CloudflareRouterCompositeAdmissionProviderV1,
    CloudflareRouterConfiguredAbuseProviderV1, CloudflareRouterConfiguredQuotaProviderV1,
    CloudflareRouterEcdsaAcceptedAuthorizedOperationV1,
    CloudflareRouterEcdsaAcceptedCapabilityBindingV1, CloudflareRouterEcdsaAuthorizedOperationV1,
    CloudflareRouterEcdsaCapabilityKindV1, CloudflareRouterEcdsaOperationKindV1,
    CloudflareRouterEd25519JwksJwtVerifierV1, CloudflareRouterJwtSessionProviderV1,
    CloudflareRouterJwtVerifierBindingV1, CloudflareRouterJwtVerifierV1,
    CloudflareRouterNormalSigningAuthorizationV2,
    CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2,
    CloudflareRouterNormalSigningPrepareAdmissionCandidateV2,
    CloudflareRouterNormalSigningTrustedAdmissionV1,
    CloudflareRouterNormalSigningTrustedMetadataV1, CloudflareRouterProjectPolicyBindingV1,
    CloudflareRouterProjectPolicyV1, CloudflareRouterPublicAdmissionPlanV1,
    CloudflareRouterQuotaCheckV1, CloudflareRouterRecipientProofBundleResponseV1,
    CloudflareRouterTrustedAdmissionV1, CloudflareRouterTrustedRequestMetadataV1,
    CloudflareRouterVerifiedJwtClaimsV1, CloudflareRouterVerifiedSessionProviderV1,
    CloudflareRouterVerifiedSessionV1, CloudflareRouterVerifiedWalletSessionV1,
    CloudflareRouterWalletSessionCredentialV1, CloudflareRouterWalletSessionVerifierV1,
    CloudflareRouterWorkerRuntimeV1, CloudflareSecretMaterial32V1,
    CloudflareServerOutputHpkeDecryptKeyBindingV1, CloudflareServerOutputMaterialRecordV1,
    CloudflareSignerClientRecipientProofBundleResponseV1,
    CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1,
    CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1, CloudflareSignerEnvelopeHpkePublicKeySetV1,
    CloudflareSignerEnvelopeHpkePublicKeyV1, CloudflareSignerEnvelopeHpkeRotationPublicKeySetV1,
    CloudflareSignerHostPreloadInputV1, CloudflareSignerHostPreloadPlanV1,
    CloudflareSignerPrivateBootstrapRequestV1,
    CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
    CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    CloudflareSigningWorkerAuthorizedOperationIdentityV1, CloudflareSigningWorkerBindingsV1,
    CloudflareSigningWorkerEcdsaPoolCommandV1, CloudflareSigningWorkerEcdsaPoolConsumeDecisionV1,
    CloudflareSigningWorkerEcdsaPoolLifecycleRecordV1,
    CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1,
    CloudflareSigningWorkerEcdsaPresignaturePoolRecordV1,
    CloudflareSigningWorkerEcdsaPresignatureRecordV1,
    CloudflareSigningWorkerMaterializedNormalSigningFinalizeRequestV2,
    CloudflareSigningWorkerMaterializedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    CloudflareSigningWorkerMaterializedRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    CloudflareSigningWorkerNormalSigningEffectClaimV1,
    CloudflareSigningWorkerNormalSigningTerminalV1,
    CloudflareSigningWorkerOutputActivationReceiptV1,
    CloudflareSigningWorkerPresignSessionBindingV1, CloudflareSigningWorkerPrivateD1RequestV1,
    CloudflareSigningWorkerRecipientProofBundleActivationRequestV1,
    CloudflareSigningWorkerRecipientProofBundleActivationV1,
    CloudflareSigningWorkerReusableWalletSessionEffectClaimV1,
    CloudflareSigningWorkerRound1RecordV1,
    CloudflareSigningWorkerRouterAbEcdsaDerivationEvmDigestFinalizeHandlerV1,
    CloudflareSigningWorkerRouterAbEcdsaDerivationEvmDigestPreparedV1,
    CloudflareSigningWorkerRouterAbEcdsaDerivationPresignaturePoolPutRequestV1,
    CloudflareSigningWorkerWalletScopeV1, CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    CloudflareTenantRootCustodyBindingWireV1, CloudflareWorkerBindingsV1, CloudflareWorkerRoleV1,
    EcdsaVerifiedClientActivationFactsV1, PoolRecord, TombstoneReason,
    CLOUDFLARE_SERVER_OUTPUT_HPKE_PRIVATE_KEY_SECRET_PREFIX_V1,
    CLOUDFLARE_SIGNER_ENVELOPE_HPKE_PRIVATE_KEY_SECRET_PREFIX_V1,
    DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH_ENV, DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
    DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY_ENV, DERIVER_A_PEER_BINDING_ENV,
    DERIVER_A_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
    DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV,
    DERIVER_A_PREVIOUS_ENVELOPE_HPKE_PUBLIC_KEY_ENV, DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH_ENV,
    DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY_BINDING_ENV, DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
    DERIVER_B_PEER_BINDING_ENV, DERIVER_B_PREVIOUS_ENVELOPE_HPKE_KEY_EPOCH_ENV,
    DERIVER_B_PREVIOUS_ENVELOPE_HPKE_PUBLIC_KEY_ENV,
    ROUTER_AB_PREVIOUS_ENVELOPE_HPKE_RETIRE_AT_MS_ENV, ROUTER_JWT_AUDIENCE_ENV,
    ROUTER_JWT_ISSUER_ENV, ROUTER_JWT_JWKS_JSON_ENV, ROUTER_PROJECT_POLICY_BOOTSTRAP_JSON_ENV,
    SIGNING_WORKER_PEER_BINDING_ENV, SIGNING_WORKER_PRESIGN_SESSION_DO_BINDING_ENV,
    SIGNING_WORKER_PRESIGN_SESSION_DO_KEY_PREFIX_ENV, SIGNING_WORKER_PRESIGN_SESSION_DO_OBJECT_ENV,
    SIGNING_WORKER_SERVER_OUTPUT_HPKE_KEY_EPOCH_ENV,
    SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY_BINDING_ENV,
    SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY_ENV,
    TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON_ENV,
};
use router_ab_core::{
    decode_recipient_proof_bundle_ciphertext_v1, decode_router_to_signer_payload_v1,
    encode_recipient_proof_bundle_ciphertext_v1, ActiveSigningWorkerStateV1, CanonicalWireBytesV1,
    Clock, Csprng, EcdsaThresholdPrfRequestV1, EncryptedPayloadV1, ExpensiveWorkGateContextV1,
    ExpensiveWorkGateDecisionV1, ExpensiveWorkKindV1, GateDeferReasonV1, GatePrincipalV1,
    GateRejectReasonV1, LifecycleScopeV1, MpcMaterialActivationRefV1, MpcPrfOutputRequestV1,
    NormalSigningAuthorizationV1, NormalSigningEd25519TwoPartyFrostCommitmentsV1,
    NormalSigningScopeV1, OpenedShareKind, RecipientOutputEncryptionAlgorithmV1,
    RecipientProofBundleCiphertextV1, RoleEncryptedEnvelopeV1, RoleEnvelopeAadV1,
    RouterAbLifecycleStateV1, RouterAbProtocolErrorCode, RouterAbProtocolResult,
    RouterToSignerPayloadV1, RouterTranscriptMetadataV1, ServerIdentityV1,
    SignerEnvelopeHpkePayloadV1, SignerIdentityV1, SignerInputPlaintextV1,
    SignerInputQuorumPolicyV1, SignerKeyStore, SignerSetV1, SigningRootShareStore,
    WireMessageKindV1, WireMessageV1, SIGNER_ENVELOPE_HPKE_ENCAPPED_KEY_LEN_V1,
    SIGNER_ENVELOPE_HPKE_TAG_LEN_V1,
};
use router_ab_core::{
    router_ab_ecdsa_rerandomization_client_commitment_v1, router_transcript_digest_v1,
    PublicDigest32, RequestKind, Role, RootShareEpoch,
    RouterAbEcdsaDerivationActivationRefreshRequestV1,
    RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    RouterAbEcdsaDerivationEvmDigestSigningPrepareResponseV1,
    RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    RouterAbEcdsaDerivationEvmDigestSigningResponseV1,
    RouterAbEcdsaDerivationExplicitExportRequestV1, RouterAbEcdsaDerivationOperationDigestsV1,
    RouterAbEcdsaDerivationPublicIdentityV1, RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    RouterAbEcdsaDerivationRegistrationPurposeV1, RouterAbEcdsaDerivationStableKeyContextV1,
    RouterAbEd25519NormalSigningFinalizeProtocolV2, RouterAbEd25519NormalSigningFinalizeRequestV2,
    RouterAbEd25519NormalSigningIntentV2, RouterAbEd25519NormalSigningPrepareBindingV2,
    RouterAbEd25519NormalSigningPrepareRequestV2, RouterAbEd25519SigningPayloadV2,
    RouterAbEd25519TwoPartyFrostFinalizeProtocolV2, RouterAbNearNetworkIdV2,
    RouterAbNearTransactionIntentV1, TenantRootDerivationNonceV1,
    TenantRootDerivationOperationIdV1, TenantRootDerivationSessionIdV1,
};
use router_ab_ecdsa_derivation::derive_relayer_share_for_client_public;
use router_ab_ecdsa_online::{
    compute_client_signature_share, ClientPresignMaterial, OnlineClientInput,
};
use router_ab_ecdsa_presign::session::{
    derive_presign_pair_context, ClientPresignSession, SigningWorkerPresignSession,
};
use router_ab_ecdsa_presign::AdditiveKeyShare;
use router_ab_ecdsa_wire::{CompressedPointBytes, ScalarBytes};
use sha2::{Digest as Sha2Digest, Sha256};
use signer_core::near_threshold_ed25519::{
    build_signing_package, client_round1_commit, client_round2_signature_share,
    key_package_from_signing_share_bytes, signature_share_to_b64u,
    verifying_share_bytes_from_signing_share_bytes, ClientRound1State,
};
use signer_core::near_threshold_frost::compute_threshold_ed25519_group_public_key_2p_from_verifying_shares;
use std::collections::BTreeMap;
