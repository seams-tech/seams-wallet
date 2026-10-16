use router_ab_core::{
    Ed25519YaoCeremonyBindingV1, Ed25519YaoRefreshBindingV1,
    RouterAbEd25519YaoApplicationBindingFactsV1, RouterAbProtocolError, RouterAbProtocolErrorCode,
    RouterAbProtocolResult,
};
use router_ab_ed25519_yao::{
    build_product_activation_deriver_a_with_server_v1,
    build_product_activation_deriver_b_with_server_v1,
    build_product_export_deriver_a_with_server_v1, build_product_export_deriver_b_with_server_v1,
    build_product_refresh_deriver_a_with_server_v1, build_product_refresh_deriver_b_with_server_v1,
    stable_key_derivation_context_v1, ActivationDeriverA, ActivationDeriverB, AdapterError,
    ExportDeriverA, ExportDeriverB,
};
pub use router_ab_ed25519_yao::{
    LocalEd25519YaoActivationDeriverARequestV1, LocalEd25519YaoActivationDeriverBRequestV1,
    LocalEd25519YaoActivationRecipientsV1, LocalEd25519YaoClientContributionV1,
    LocalEd25519YaoExportDeriverARequestV1, LocalEd25519YaoExportDeriverBRequestV1,
    LocalEd25519YaoExportRecipientV1, LocalEd25519YaoRefreshDeriverARequestV1,
    LocalEd25519YaoRefreshDeriverBRequestV1,
};
use signer_core::ed25519_yao_derivation::{
    Ed25519YaoDeriverAServerContributionV1, Ed25519YaoDeriverBServerContributionV1,
    Ed25519YaoStableKeyDerivationContextV1,
};

pub fn build_local_activation_deriver_a_with_server_v1(
    request: LocalEd25519YaoActivationDeriverARequestV1,
    server: Ed25519YaoDeriverAServerContributionV1,
) -> RouterAbProtocolResult<(Ed25519YaoCeremonyBindingV1, ActivationDeriverA)> {
    build_product_activation_deriver_a_with_server_v1(request, server).map_err(map_adapter_error)
}

pub fn build_local_activation_deriver_b_with_server_v1(
    request: LocalEd25519YaoActivationDeriverBRequestV1,
    server: Ed25519YaoDeriverBServerContributionV1,
) -> RouterAbProtocolResult<(Ed25519YaoCeremonyBindingV1, ActivationDeriverB)> {
    build_product_activation_deriver_b_with_server_v1(request, server).map_err(map_adapter_error)
}

pub fn build_local_export_deriver_a_with_server_v1(
    request: LocalEd25519YaoExportDeriverARequestV1,
    server: Ed25519YaoDeriverAServerContributionV1,
) -> RouterAbProtocolResult<(Ed25519YaoCeremonyBindingV1, ExportDeriverA)> {
    build_product_export_deriver_a_with_server_v1(request, server).map_err(map_adapter_error)
}

pub fn build_local_export_deriver_b_with_server_v1(
    request: LocalEd25519YaoExportDeriverBRequestV1,
    server: Ed25519YaoDeriverBServerContributionV1,
) -> RouterAbProtocolResult<(Ed25519YaoCeremonyBindingV1, ExportDeriverB)> {
    build_product_export_deriver_b_with_server_v1(request, server).map_err(map_adapter_error)
}

pub fn build_local_refresh_deriver_a_v1(
    request: LocalEd25519YaoRefreshDeriverARequestV1,
    server: Ed25519YaoDeriverAServerContributionV1,
) -> RouterAbProtocolResult<(Ed25519YaoRefreshBindingV1, ActivationDeriverA)> {
    build_product_refresh_deriver_a_with_server_v1(request, server).map_err(map_adapter_error)
}

pub fn build_local_refresh_deriver_b_v1(
    request: LocalEd25519YaoRefreshDeriverBRequestV1,
    server: Ed25519YaoDeriverBServerContributionV1,
) -> RouterAbProtocolResult<(Ed25519YaoRefreshBindingV1, ActivationDeriverB)> {
    build_product_refresh_deriver_b_with_server_v1(request, server).map_err(map_adapter_error)
}

pub(crate) fn stable_context(
    application: &RouterAbEd25519YaoApplicationBindingFactsV1,
    participant_ids: [u16; 2],
) -> RouterAbProtocolResult<Ed25519YaoStableKeyDerivationContextV1> {
    stable_key_derivation_context_v1(application, participant_ids).map_err(map_adapter_error)
}

fn map_adapter_error(error: AdapterError) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLifecycleState,
        format!("Ed25519 Yao role construction failed: {error}"),
    )
}
