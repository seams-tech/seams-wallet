//! The Signing Worker's read-only check of a reissue run.

use super::*;
use router_ab_ed25519_yao::verify_ed25519_yao_signing_worker_reissue_v1;

/// Checks a reissue package pair against the wallet's active material.
///
/// A reissue gives a browser that has no usable cache the Client share of the
/// current state epoch. A recovery keeps both shares, so the run must
/// reproduce the stored Signing Worker share; the check opens the run's
/// Signing Worker packages for that and keeps nothing. The Router releases the
/// Client packages only after this receipt. A staged recovery, or no active
/// material, refuses the reissue.
#[cfg(feature = "workers-rs")]
pub(crate) fn check_signing_worker_yao_reissue_v1(
    env: &Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    delivery: &CloudflareEd25519YaoPackagePairDeliveryV1,
    current: Option<&SigningWorkerYaoDurableStateV1>,
) -> RouterAbProtocolResult<Ed25519YaoSigningWorkerActivationReceiptV1> {
    let Some(SigningWorkerYaoDurableStateV1::Active { material, .. }) = current else {
        return Err(invalid_lifecycle(
            "Signing Worker reissue requires active material and no staged recovery",
        ));
    };
    let private_key = load_cloudflare_server_output_hpke_private_key_bytes_v1(
        env,
        runtime.server_output_decrypt_key(),
    )?;
    verify_ed25519_yao_signing_worker_reissue_v1(
        &Ed25519YaoRecipientPrivateKeyV1::from_bytes(private_key),
        delivery.deriver_a.clone(),
        delivery.deriver_b.clone(),
        material,
    )
}
