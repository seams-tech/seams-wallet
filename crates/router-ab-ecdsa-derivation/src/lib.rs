pub mod error;
pub mod shared;

pub use error::{RouterAbEcdsaDerivationError, RouterAbEcdsaDerivationErrorCode};
pub use shared::context::{encode_context, RouterAbEcdsaDerivationStableKeyContext};
pub use shared::derive::{
    compose_public_identity_from_public_keys, context_binding, derive_client_share,
    derive_ecdsa_lane_delta_from_source_share32_v1, derive_relayer_share_for_client_public,
    ecdsa_lane_client_public_key_from_share32_v1, rebind_ecdsa_lane_relayer_share_bytes_v1,
    reconstruct_ecdsa_additive_export_key_v1, reconstruct_export_key,
    sample_ecdsa_lane_client_share_v1, ClientRoleShare, EcdsaLaneClientShare, EcdsaLaneDelta,
    EcdsaLanePublicIdentityBindingV1, EcdsaLaneRelayerRebindV1, PublicIdentity, RelayerRoleShare,
};
