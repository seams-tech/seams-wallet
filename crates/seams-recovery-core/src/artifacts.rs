//! One-role recovery artifact handling for the CLI.
//!
//! Every entry point here processes exactly one Deriver role. A single
//! invocation can never hold both recovery private keys or both opened shares:
//! that separation is the whole point of splitting the recovery set, and it is
//! enforced by these signatures rather than by convention.
//!
//! Nothing in this module writes an opened share anywhere. The share exists
//! only between opening one source package and resealing it to the
//! destination's one-use import key, in zeroizing buffers.

use rand_core_09::{CryptoRng, RngCore};
use router_ab_core::{
    decode_tenant_root_recovery_manifest_v1, decode_tenant_root_recovery_package_v1,
    verify_and_open_tenant_root_recovery_role_package_v1,
    verify_tenant_root_recovery_role_package_with_trust_v1, ExpectedTenantRootRestoreImportV1,
    RouterAbDerivationError, TenantRootCustodyLineageId, TenantRootRecoveryManifestV1,
    TenantRootRecoveryPackageV1, TenantRootRecoveryTrustBundleV1,
    TenantRootRecoveryTrustEvidenceV1, TenantRootRecoveryTrustLevelV1,
    TenantRootRestoreDestinationFingerprintV1, TenantRootRestoreImportEnvelopeV1,
    TenantRootRestoreImportPublicKeyV1, TenantRootRestoreSessionIdV1, TwoPartyDeriverRole,
    TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES, TENANT_ROOT_RECOVERY_PACKAGE_MAX_BYTES,
};
use serde::Serialize;
use std::path::Path;
use zeroize::Zeroizing;

use crate::durable_file::read_capped_file_v1;
use crate::key_file::RecoveryKeyFileV1;
use crate::{RecoveryCoreError, RecoveryCoreErrorCode, RecoveryCoreResult};

/// Public result of verifying one role package. Carries no secret material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedRolePackageReportV1 {
    /// The role this package belongs to.
    pub role: String,
    /// The recovery set the package belongs to.
    pub recovery_set_id: String,
    /// SHA-256 over the complete package file.
    pub package_digest_b64u: String,
    /// SHA-256 over the signed manifest.
    pub manifest_digest_b64u: String,
    /// The stable public root commitment the package binds.
    pub root_commitment_b64u: String,
    /// The recipient fingerprint the package was encrypted to.
    pub recipient_fingerprint_b64u: String,
    /// Which of the three trust results this verification obtained.
    pub trust_level: String,
}

/// One resealed role share, ready for exactly one destination import.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResealedRoleImportV1 {
    envelope_bytes: Vec<u8>,
    report: VerifiedRolePackageReportV1,
}

impl ResealedRoleImportV1 {
    /// Returns the canonical import envelope to upload.
    ///
    /// The envelope is ciphertext for the destination role's one-use key; it is
    /// not readable by the CLI, the console, or any other role.
    pub fn envelope_bytes(&self) -> &[u8] {
        &self.envelope_bytes
    }

    /// Returns the public verification report.
    pub const fn report(&self) -> &VerifiedRolePackageReportV1 {
        &self.report
    }
}

/// The destination-supplied binding one role import is authorized against.
///
/// These values come from the destination's restore session, never from the
/// package or manifest: decoded artifact metadata must not be able to create
/// its own import capability.
#[derive(Debug, Clone)]
pub struct RestoreDestinationBindingV1 {
    /// The destination deployment fingerprint.
    pub destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    /// The destination's own custody lineage.
    pub destination_lineage: TenantRootCustodyLineageId,
    /// The restore session this import belongs to.
    pub restore_session_id: TenantRootRestoreSessionIdV1,
    /// The destination role import key identifier.
    pub import_key_id: String,
    /// The destination role import public key.
    pub import_public_key: TenantRootRestoreImportPublicKeyV1,
    /// When the import key was issued.
    pub issued_at_ms: u64,
    /// When the import key expires.
    pub expires_at_ms: u64,
}

/// Verifies one role package against its manifest and pinned trust, offline.
///
/// This needs no recovery private key: it proves the public structure,
/// signatures, trust chain, and set identity without opening the encrypted
/// share.
pub fn verify_role_package_offline_v1(
    manifest_path: &Path,
    package_path: &Path,
    expected_role: TwoPartyDeriverRole,
    bundle: &TenantRootRecoveryTrustBundleV1,
    evidence: &TenantRootRecoveryTrustEvidenceV1<'_>,
) -> RecoveryCoreResult<VerifiedRolePackageReportV1> {
    let (manifest, package) = read_role_artifacts(manifest_path, package_path, expected_role)?;
    let trust = verify_tenant_root_recovery_role_package_with_trust_v1(
        &manifest, &package, bundle, evidence,
    )
    .map_err(artifact_failure)?;
    build_report(&manifest, &package, expected_role, trust.level())
}

/// Verifies that the saved key can decrypt this role's backup.
/// The opened share is dropped immediately and never returned or written.
pub fn check_role_backup_decryption_v1(
    manifest_path: &Path,
    package_path: &Path,
    key_file_path: &Path,

    expected_role: TwoPartyDeriverRole,
    bundle: &TenantRootRecoveryTrustBundleV1,
) -> RecoveryCoreResult<VerifiedRolePackageReportV1> {
    let (manifest, package) = read_role_artifacts(manifest_path, package_path, expected_role)?;
    let trust = verify_tenant_root_recovery_role_package_with_trust_v1(
        &manifest,
        &package,
        bundle,
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )
    .map_err(artifact_failure)?;
    let file = RecoveryKeyFileV1::decode(&Zeroizing::new(read_capped_file_v1(
        key_file_path,
        crate::key_file::RECOVERY_KEY_FILE_MAX_BYTES,
    )?))?;
    if file.role() != expected_role {
        return Err(RecoveryCoreError::new(
            RecoveryCoreErrorCode::KeyProviderFailure,
            "This key file belongs to the other Deriver role",
        ));
    }
    let material = file.open()?;
    let opened = verify_and_open_tenant_root_recovery_role_package_v1(
        &manifest,
        &package,
        material.recipient(),
        trust.trusted_verifying_keys(),
    )
    .map_err(artifact_failure)?;
    drop(opened);
    build_report(&manifest, &package, expected_role, trust.level())
}

/// Opens one role package and reseals its share to one destination import key.
///
/// The opened share never reaches disk, a log, or the returned value: it exists
/// only long enough to be resealed to the destination's key.
#[allow(clippy::too_many_arguments)]
pub fn open_and_reseal_role_share_v1<R>(
    manifest_path: &Path,
    package_path: &Path,
    key_file_path: &Path,

    expected_role: TwoPartyDeriverRole,
    bundle: &TenantRootRecoveryTrustBundleV1,
    evidence: &TenantRootRecoveryTrustEvidenceV1<'_>,
    destination: &RestoreDestinationBindingV1,
    rng: &mut R,
) -> RecoveryCoreResult<ResealedRoleImportV1>
where
    R: RngCore + CryptoRng,
{
    let (manifest, package) = read_role_artifacts(manifest_path, package_path, expected_role)?;
    let trust = verify_tenant_root_recovery_role_package_with_trust_v1(
        &manifest, &package, bundle, evidence,
    )
    .map_err(artifact_failure)?;
    let report = build_report(&manifest, &package, expected_role, trust.level())?;

    let key_file = RecoveryKeyFileV1::decode(&Zeroizing::new(read_capped_file_v1(
        key_file_path,
        crate::key_file::RECOVERY_KEY_FILE_MAX_BYTES,
    )?))?;
    if key_file.role() != expected_role {
        return Err(RecoveryCoreError::new(
            RecoveryCoreErrorCode::KeyProviderFailure,
            "this recovery key file belongs to the other Deriver role",
        ));
    }
    let material = key_file.open()?;

    let source = verify_and_open_tenant_root_recovery_role_package_v1(
        &manifest,
        &package,
        material.recipient(),
        trust.trusted_verifying_keys(),
    )
    .map_err(artifact_failure)?;

    let expected = ExpectedTenantRootRestoreImportV1::from_verified_source(
        &source,
        destination.destination_fingerprint,
        destination.destination_lineage,
        destination.restore_session_id,
        destination.import_key_id.clone(),
        destination.import_public_key,
        destination.issued_at_ms,
        destination.expires_at_ms,
    )
    .map_err(artifact_failure)?;
    let envelope = TenantRootRestoreImportEnvelopeV1::seal(&source, &expected, rng)
        .map_err(artifact_failure)?;
    let envelope_bytes = envelope.to_bytes().map_err(artifact_failure)?;

    Ok(ResealedRoleImportV1 {
        envelope_bytes,
        report,
    })
}

fn read_role_artifacts(
    manifest_path: &Path,
    package_path: &Path,
    expected_role: TwoPartyDeriverRole,
) -> RecoveryCoreResult<(TenantRootRecoveryManifestV1, TenantRootRecoveryPackageV1)> {
    let manifest = decode_tenant_root_recovery_manifest_v1(&read_capped_file_v1(
        manifest_path,
        TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES,
    )?)
    .map_err(artifact_failure)?;
    let package = decode_tenant_root_recovery_package_v1(&read_capped_file_v1(
        package_path,
        TENANT_ROOT_RECOVERY_PACKAGE_MAX_BYTES,
    )?)
    .map_err(artifact_failure)?;
    if package.role() != expected_role {
        return Err(RecoveryCoreError::new(
            RecoveryCoreErrorCode::ArtifactVerificationFailed,
            "this backup file belongs to the other Deriver role",
        ));
    }
    Ok((manifest, package))
}

fn build_report(
    manifest: &TenantRootRecoveryManifestV1,
    package: &TenantRootRecoveryPackageV1,
    role: TwoPartyDeriverRole,
    level: &TenantRootRecoveryTrustLevelV1,
) -> RecoveryCoreResult<VerifiedRolePackageReportV1> {
    let descriptor = manifest.descriptor();
    let role_descriptor = descriptor.role(role);
    Ok(VerifiedRolePackageReportV1 {
        role: role.as_str().to_owned(),
        recovery_set_id: descriptor.recovery_set_id().to_base64url(),
        package_digest_b64u: encode(
            package
                .digest()
                .map_err(artifact_failure)?
                .as_bytes()
                .as_slice(),
        ),
        manifest_digest_b64u: encode(&manifest.digest().map_err(artifact_failure)?),
        root_commitment_b64u: encode(&descriptor.stable_root_commitment().to_bytes()),
        recipient_fingerprint_b64u: encode(role_descriptor.recipient_fingerprint().as_bytes()),
        trust_level: level.as_str().to_owned(),
    })
}

fn encode(bytes: &[u8]) -> String {
    use base64ct::{Base64UrlUnpadded, Encoding};
    Base64UrlUnpadded::encode_string(bytes)
}

fn artifact_failure(error: RouterAbDerivationError) -> RecoveryCoreError {
    RecoveryCoreError::new(
        RecoveryCoreErrorCode::ArtifactVerificationFailed,
        error.message().to_owned(),
    )
}
