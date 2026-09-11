//! Continuity between the trust bundle pinned in a binary and one supplied later.
//!
//! The `seams` binary carries its recovery-verification roots. A bundle handed
//! to it at run time is never a new trust root: it is accepted only when the
//! pinned current root is still present in it — either as the candidate's
//! current root, or as a historical root the candidate's own dual-signed
//! bridges carry forward to a newer root. Anything else would let a file on
//! disk replace the pin, which is exactly what pinning exists to prevent.

use router_ab_core::TenantRootRecoveryTrustBundleV1;

use crate::{RecoveryCoreError, RecoveryCoreErrorCode, RecoveryCoreResult};

/// Requires that `candidate` continues the trust `pinned` established.
///
/// A candidate passes when its version is not older than the pin and the
/// pinned current root appears in it with the same verifying key. Bundle
/// parsing already verified every bridge signature and that every historical
/// root reaches the candidate's current root, so a pinned root found among the
/// historical roots is one the old root itself signed over to the new one.
pub fn require_trust_bundle_continues_pinned_root_v1(
    pinned: &TenantRootRecoveryTrustBundleV1,
    candidate: &TenantRootRecoveryTrustBundleV1,
) -> RecoveryCoreResult<()> {
    if candidate.bundle_version() < pinned.bundle_version() {
        return Err(trust_failure(
            "the supplied trust bundle is older than the bundle pinned in this binary",
        ));
    }
    let pinned_root = pinned.current_root();
    let matches = |root: &router_ab_core::TenantRootRecoveryTrustRootV1| {
        root.key_id() == pinned_root.key_id() && root.verifying_key() == pinned_root.verifying_key()
    };
    let same_key_id = |root: &router_ab_core::TenantRootRecoveryTrustRootV1| {
        root.key_id() == pinned_root.key_id()
    };
    if matches(candidate.current_root()) {
        return Ok(());
    }
    if let Some(historical) = candidate
        .historical_roots()
        .iter()
        .find(|root| same_key_id(root))
    {
        if !matches(historical) {
            return Err(trust_failure(
                "the supplied trust bundle reuses the pinned root key id for a different key",
            ));
        }
        // Reachability to the candidate's current root was verified on parse.
        return Ok(());
    }
    if same_key_id(candidate.current_root()) {
        return Err(trust_failure(
            "the supplied trust bundle reuses the pinned root key id for a different key",
        ));
    }
    Err(trust_failure(
        "the supplied trust bundle does not continue the root pinned in this binary; \
         only a bundle the pinned root bridged to is accepted",
    ))
}

fn trust_failure(message: &'static str) -> RecoveryCoreError {
    RecoveryCoreError::new(RecoveryCoreErrorCode::ArtifactVerificationFailed, message)
}
