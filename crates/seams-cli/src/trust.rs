//! The trust this binary was built with.
//!
//! The recovery-verification bundle and the release root are compiled in.
//! Deployment authorities are acquired and saved by the deployment module.
//! An explicit bundle update must continue the selected trusted authority.
//! The release root remains compiled in and authenticates distributed binaries.

use std::path::Path;

use router_ab_core::{
    TenantRootRecoveryTrustBundleV1, TENANT_ROOT_RECOVERY_TRUST_BUNDLE_MAX_BYTES,
};
use seams_recovery_core::{
    read_capped_file_v1, require_trust_bundle_continues_pinned_root_v1, RecoveryCoreError,
    RecoveryCoreErrorCode, ReleaseTrustRootV1,
};

/// The recovery-verification trust bundle compiled into this binary.
const PINNED_RECOVERY_TRUST_BUNDLE_JSON: &[u8] =
    include_bytes!("../trust/recovery-trust-bundle.json");
/// The release root compiled into this binary.
const PINNED_RELEASE_ROOT_JSON: &[u8] = include_bytes!("../trust/release-root.json");

/// Returns the pinned recovery-verification trust bundle.
pub fn pinned_recovery_trust_bundle_v1(
) -> Result<TenantRootRecoveryTrustBundleV1, RecoveryCoreError> {
    TenantRootRecoveryTrustBundleV1::from_canonical_json(PINNED_RECOVERY_TRUST_BUNDLE_JSON).map_err(
        |error| {
            RecoveryCoreError::new(
                RecoveryCoreErrorCode::ArtifactVerificationFailed,
                format!(
                    "the trust bundle pinned in this binary is invalid: {}",
                    error.message()
                ),
            )
        },
    )
}

/// Returns the pinned release root.
///
/// The recovery root is passed so the two can be compared: a build that pins
/// the same key for both has collapsed the separation the design depends on.
pub fn pinned_release_root_v1() -> Result<ReleaseTrustRootV1, RecoveryCoreError> {
    let bundle = pinned_recovery_trust_bundle_v1()?;
    ReleaseTrustRootV1::from_canonical_json(
        PINNED_RELEASE_ROOT_JSON,
        bundle.current_root().verifying_key(),
    )
    .map_err(|error| {
        RecoveryCoreError::new(
            RecoveryCoreErrorCode::ArtifactVerificationFailed,
            format!(
                "the release root pinned in this binary is invalid: {}",
                error.message()
            ),
        )
    })
}

/// The trust bundle one verification will use, and where it came from.
#[derive(Debug, Clone)]
pub struct ResolvedTrustBundleV1 {
    bundle: TenantRootRecoveryTrustBundleV1,
    pinned: bool,
}

impl ResolvedTrustBundleV1 {
    /// Returns the bundle.
    pub const fn bundle(&self) -> &TenantRootRecoveryTrustBundleV1 {
        &self.bundle
    }

    /// Returns true when the bundle is the one compiled into the binary.
    pub const fn is_pinned(&self) -> bool {
        self.pinned
    }
}

/// Resolves the trust bundle a command will verify against.
///
/// With no override the pinned bundle is used. An override is read, parsed,
/// and accepted only when it continues the pinned root; it is never a way to
/// verify against a root the host did not supply as its authority.
pub fn resolve_recovery_trust_bundle_v1(
    pinned: &TenantRootRecoveryTrustBundleV1,
    override_path: Option<&Path>,
) -> Result<ResolvedTrustBundleV1, RecoveryCoreError> {
    let Some(path) = override_path else {
        return Ok(ResolvedTrustBundleV1 {
            bundle: pinned.clone(),
            pinned: true,
        });
    };
    let candidate = TenantRootRecoveryTrustBundleV1::from_canonical_json(&read_capped_file_v1(
        path,
        TENANT_ROOT_RECOVERY_TRUST_BUNDLE_MAX_BYTES,
    )?)
    .map_err(|error| {
        RecoveryCoreError::new(
            RecoveryCoreErrorCode::ArtifactVerificationFailed,
            error.message().to_owned(),
        )
    })?;
    require_trust_bundle_continues_pinned_root_v1(pinned, &candidate)?;
    Ok(ResolvedTrustBundleV1 {
        bundle: candidate,
        pinned: false,
    })
}
