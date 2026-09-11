//! Offline trust for recovery artifacts: certificate chains, rotation bridges,
//! revocation snapshots, and the three trust results restore admits differently.

use ed25519_dalek::SigningKey;
use rand_chacha_09::ChaCha20Rng;
use rand_core_09::SeedableRng;
use router_ab_core::{
    seal_tenant_root_recovery_package_v1, sign_tenant_root_recovery_manifest_v1,
    tenant_root_recovery_restore_trust_admission_v1,
    verify_tenant_root_recovery_artifacts_with_trust_v1,
    verify_tenant_root_recovery_manifest_trust_v1, TenantRootRecoveryManifestV1,
    TenantRootRecoveryOfflineTrustAcknowledgementV1, TenantRootRecoveryPackageV1,
    TenantRootRecoveryRevocationEntryV1, TenantRootRecoveryRevocationSnapshotV1,
    TenantRootRecoverySignerCertificateV1, TenantRootRecoverySignerRoleV1,
    TenantRootRecoveryTrustBridgeV1, TenantRootRecoveryTrustBundleV1,
    TenantRootRecoveryTrustEvidenceV1, TenantRootRecoveryTrustLevelV1,
    TenantRootRecoveryTrustRootV1,
};

mod support;

use support::verified_recovery_artifact_fixture;

const CREATION_TIME: &str = "2026-08-29T10:20:30.123Z";
const NOT_BEFORE: &str = "2026-01-01T00:00:00.000Z";
const NOT_AFTER: &str = "2027-01-01T00:00:00.000Z";
const DERIVER_A_KEY_ID: &str = "deriver-a-signing-key-7";
const DERIVER_B_KEY_ID: &str = "deriver-b-signing-key-9";
const CONTROL_PLANE_KEY_ID: &str = "control-plane-manifest-key-3";
const ROOT_KEY_ID: &str = "seams-recovery-root-2026";
const OLD_ROOT_KEY_ID: &str = "seams-recovery-root-2025";

fn signing_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn hpke_rng(seed: u8) -> ChaCha20Rng {
    ChaCha20Rng::from_seed([seed; 32])
}

fn root_signing_key() -> SigningKey {
    signing_key(0xd1)
}

fn old_root_signing_key() -> SigningKey {
    signing_key(0xd2)
}

fn trust_root() -> TenantRootRecoveryTrustRootV1 {
    TenantRootRecoveryTrustRootV1::new(ROOT_KEY_ID, root_signing_key().verifying_key().to_bytes())
        .expect("trust root")
}

fn old_trust_root() -> TenantRootRecoveryTrustRootV1 {
    TenantRootRecoveryTrustRootV1::new(
        OLD_ROOT_KEY_ID,
        old_root_signing_key().verifying_key().to_bytes(),
    )
    .expect("old trust root")
}

fn bundle() -> TenantRootRecoveryTrustBundleV1 {
    TenantRootRecoveryTrustBundleV1::new(1, trust_root(), Vec::new(), Vec::new()).expect("bundle")
}

fn certificate(
    issuer_key_id: &str,
    issuer_signing_key: &SigningKey,
    subject_key_id: &str,
    subject: &SigningKey,
    role: TenantRootRecoverySignerRoleV1,
    not_before: &str,
    not_after: &str,
) -> TenantRootRecoverySignerCertificateV1 {
    TenantRootRecoverySignerCertificateV1::sign(
        issuer_key_id,
        &issuer_signing_key.to_bytes(),
        subject_key_id,
        subject.verifying_key().to_bytes(),
        role,
        not_before,
        not_after,
    )
    .expect("certificate")
}

fn chain(certificate: &TenantRootRecoverySignerCertificateV1) -> Vec<String> {
    vec![certificate.to_chain_entry().expect("chain entry")]
}

struct ArtifactSet {
    manifest: TenantRootRecoveryManifestV1,
    package_a: TenantRootRecoveryPackageV1,
    package_b: TenantRootRecoveryPackageV1,
}

/// Builds one complete artifact set whose chains are supplied by the caller, so
/// a test can inject exactly one wrong certificate and change nothing else.
fn artifacts_with_chains(
    chain_a: Vec<String>,
    chain_b: Vec<String>,
    chain_control_plane: Vec<String>,
    control_plane_signing_key: &SigningKey,
) -> ArtifactSet {
    let fixture = verified_recovery_artifact_fixture();
    let descriptor = fixture.descriptor;
    let package_a = seal_tenant_root_recovery_package_v1(
        &descriptor,
        &fixture.verified_a,
        &mut hpke_rng(0x71),
        &fixture.signing_a.to_bytes(),
    )
    .expect("package A");
    let package_b = seal_tenant_root_recovery_package_v1(
        &descriptor,
        &fixture.verified_b,
        &mut hpke_rng(0x81),
        &fixture.signing_b.to_bytes(),
    )
    .expect("package B");
    let manifest = sign_tenant_root_recovery_manifest_v1(
        descriptor,
        &package_a,
        &package_b,
        chain_a,
        chain_b,
        chain_control_plane,
        &control_plane_signing_key.to_bytes(),
    )
    .expect("manifest");
    ArtifactSet {
        manifest,
        package_a,
        package_b,
    }
}

/// The signer keys the shared recovery fixture actually signs its packages with.
fn fixture_signers() -> (SigningKey, SigningKey) {
    let fixture = verified_recovery_artifact_fixture();
    (fixture.signing_a, fixture.signing_b)
}

fn well_formed_artifacts() -> ArtifactSet {
    let (signing_a, signing_b) = fixture_signers();
    let control_plane = signing_key(0xc1);
    let root = root_signing_key();
    artifacts_with_chains(
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            DERIVER_A_KEY_ID,
            &signing_a,
            TenantRootRecoverySignerRoleV1::DeriverA,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            DERIVER_B_KEY_ID,
            &signing_b,
            TenantRootRecoverySignerRoleV1::DeriverB,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            CONTROL_PLANE_KEY_ID,
            &control_plane,
            TenantRootRecoverySignerRoleV1::ControlPlane,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        &control_plane,
    )
}

fn snapshot(
    version: u64,
    issued_at: &str,
    entries: Vec<TenantRootRecoveryRevocationEntryV1>,
) -> TenantRootRecoveryRevocationSnapshotV1 {
    TenantRootRecoveryRevocationSnapshotV1::sign(
        version,
        issued_at,
        ROOT_KEY_ID,
        &root_signing_key().to_bytes(),
        entries,
    )
    .expect("snapshot")
}

#[test]
fn certificate_encoding_is_canonical_and_strict() {
    let certificate = certificate(
        ROOT_KEY_ID,
        &root_signing_key(),
        DERIVER_A_KEY_ID,
        &signing_key(0x11),
        TenantRootRecoverySignerRoleV1::DeriverA,
        NOT_BEFORE,
        NOT_AFTER,
    );
    let canonical = certificate.canonical_json().expect("canonical");
    assert_eq!(
        TenantRootRecoverySignerCertificateV1::from_canonical_json(&canonical).unwrap(),
        certificate
    );
    let entry = certificate.to_chain_entry().unwrap();
    assert_eq!(
        TenantRootRecoverySignerCertificateV1::from_chain_entry(&entry).unwrap(),
        certificate
    );

    let text = String::from_utf8(canonical.clone()).unwrap();
    assert!(text.starts_with("{\"authorizedRole\":\"deriver_a\","));
    assert!(TenantRootRecoverySignerCertificateV1::from_canonical_json(
        format!("{text} ").as_bytes()
    )
    .is_err());
    assert!(TenantRootRecoverySignerCertificateV1::from_canonical_json(
        text.replace("{\"authorizedRole\"", "{\"extra\":1,\"authorizedRole\"")
            .as_bytes()
    )
    .is_err());
    assert!(TenantRootRecoverySignerCertificateV1::from_chain_entry(&format!("{entry}=")).is_err());
}

#[test]
fn certificate_rejects_impossible_and_inverted_validity() {
    let root = root_signing_key();
    assert!(TenantRootRecoverySignerCertificateV1::sign(
        ROOT_KEY_ID,
        &root.to_bytes(),
        DERIVER_A_KEY_ID,
        signing_key(0x11).verifying_key().to_bytes(),
        TenantRootRecoverySignerRoleV1::DeriverA,
        "2026-02-31T00:00:00.000Z",
        NOT_AFTER,
    )
    .is_err());
    assert!(TenantRootRecoverySignerCertificateV1::sign(
        ROOT_KEY_ID,
        &root.to_bytes(),
        DERIVER_A_KEY_ID,
        signing_key(0x11).verifying_key().to_bytes(),
        TenantRootRecoverySignerRoleV1::DeriverA,
        NOT_AFTER,
        NOT_BEFORE,
    )
    .is_err());
    assert!(TenantRootRecoverySignerCertificateV1::sign(
        ROOT_KEY_ID,
        &root.to_bytes(),
        "deriver a key",
        signing_key(0x11).verifying_key().to_bytes(),
        TenantRootRecoverySignerRoleV1::DeriverA,
        NOT_BEFORE,
        NOT_AFTER,
    )
    .is_err());
}

#[test]
fn manifest_trust_derives_signer_keys_from_the_pinned_root() {
    let artifacts = well_formed_artifacts();
    let (signing_a, signing_b) = fixture_signers();
    let trust = verify_tenant_root_recovery_artifacts_with_trust_v1(
        &artifacts.manifest,
        &artifacts.package_a,
        &artifacts.package_b,
        &bundle(),
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )
    .expect("trusted artifacts");

    assert_eq!(
        trust.trusted_verifying_keys().deriver_a,
        signing_a.verifying_key().to_bytes()
    );
    assert_eq!(
        trust.trusted_verifying_keys().deriver_b,
        signing_b.verifying_key().to_bytes()
    );
    assert_eq!(
        trust.trusted_verifying_keys().control_plane,
        signing_key(0xc1).verifying_key().to_bytes()
    );
    assert_eq!(trust.deriver_a_key_id(), DERIVER_A_KEY_ID);
    assert_eq!(trust.deriver_b_key_id(), DERIVER_B_KEY_ID);
    assert_eq!(trust.control_plane_key_id(), CONTROL_PLANE_KEY_ID);
    assert_eq!(
        trust.level(),
        &TenantRootRecoveryTrustLevelV1::CryptographicallyValidOffline
    );
    assert_eq!(trust.level().as_str(), "cryptographically_valid_offline");
}

#[test]
fn certificate_must_authorize_the_exact_role_and_signer_key_id() {
    let (signing_a, signing_b) = fixture_signers();
    let control_plane = signing_key(0xc1);
    let root = root_signing_key();

    // Deriver A's key certified for role B: the signature would still verify,
    // so only the role binding can reject this.
    let role_swapped = artifacts_with_chains(
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            DERIVER_A_KEY_ID,
            &signing_a,
            TenantRootRecoverySignerRoleV1::DeriverB,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            DERIVER_B_KEY_ID,
            &signing_b,
            TenantRootRecoverySignerRoleV1::DeriverB,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            CONTROL_PLANE_KEY_ID,
            &control_plane,
            TenantRootRecoverySignerRoleV1::ControlPlane,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        &control_plane,
    );
    assert!(verify_tenant_root_recovery_manifest_trust_v1(
        &role_swapped.manifest,
        &bundle(),
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )
    .is_err());

    // A certificate for a signer key id the descriptor does not name.
    let renamed = artifacts_with_chains(
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            "deriver-a-signing-key-8",
            &signing_a,
            TenantRootRecoverySignerRoleV1::DeriverA,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            DERIVER_B_KEY_ID,
            &signing_b,
            TenantRootRecoverySignerRoleV1::DeriverB,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            CONTROL_PLANE_KEY_ID,
            &control_plane,
            TenantRootRecoverySignerRoleV1::ControlPlane,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        &control_plane,
    );
    assert!(verify_tenant_root_recovery_manifest_trust_v1(
        &renamed.manifest,
        &bundle(),
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )
    .is_err());
}

#[test]
fn a_manifest_cannot_introduce_its_own_trust_root() {
    let (signing_a, signing_b) = fixture_signers();
    let control_plane = signing_key(0xc1);
    let rogue_root = signing_key(0xee);
    let artifacts = artifacts_with_chains(
        chain(&certificate(
            "rogue-root-1",
            &rogue_root,
            DERIVER_A_KEY_ID,
            &signing_a,
            TenantRootRecoverySignerRoleV1::DeriverA,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        chain(&certificate(
            "rogue-root-1",
            &rogue_root,
            DERIVER_B_KEY_ID,
            &signing_b,
            TenantRootRecoverySignerRoleV1::DeriverB,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        chain(&certificate(
            "rogue-root-1",
            &rogue_root,
            CONTROL_PLANE_KEY_ID,
            &control_plane,
            TenantRootRecoverySignerRoleV1::ControlPlane,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        &control_plane,
    );
    assert!(verify_tenant_root_recovery_manifest_trust_v1(
        &artifacts.manifest,
        &bundle(),
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )
    .is_err());

    // A certificate that names a pinned root it was not signed by also fails.
    let forged = certificate(
        ROOT_KEY_ID,
        &rogue_root,
        DERIVER_A_KEY_ID,
        &signing_a,
        TenantRootRecoverySignerRoleV1::DeriverA,
        NOT_BEFORE,
        NOT_AFTER,
    );
    assert!(forged.verify_issued_by(&trust_root()).is_err());
}

#[test]
fn certificate_chain_length_is_fixed_at_one() {
    let (signing_a, signing_b) = fixture_signers();
    let control_plane = signing_key(0xc1);
    let root = root_signing_key();
    let leaf = certificate(
        ROOT_KEY_ID,
        &root,
        DERIVER_A_KEY_ID,
        &signing_a,
        TenantRootRecoverySignerRoleV1::DeriverA,
        NOT_BEFORE,
        NOT_AFTER,
    );
    let mut doubled = chain(&leaf);
    doubled.push(leaf.to_chain_entry().unwrap());
    let artifacts = artifacts_with_chains(
        doubled,
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            DERIVER_B_KEY_ID,
            &signing_b,
            TenantRootRecoverySignerRoleV1::DeriverB,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            CONTROL_PLANE_KEY_ID,
            &control_plane,
            TenantRootRecoverySignerRoleV1::ControlPlane,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        &control_plane,
    );
    assert!(verify_tenant_root_recovery_manifest_trust_v1(
        &artifacts.manifest,
        &bundle(),
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )
    .is_err());
}

#[test]
fn artifacts_created_outside_certificate_validity_are_rejected() {
    let (signing_a, signing_b) = fixture_signers();
    let control_plane = signing_key(0xc1);
    let root = root_signing_key();
    for (not_before, not_after) in [
        ("2026-08-29T10:20:30.124Z", NOT_AFTER),
        (NOT_BEFORE, "2026-08-29T10:20:30.122Z"),
    ] {
        let artifacts = artifacts_with_chains(
            chain(&certificate(
                ROOT_KEY_ID,
                &root,
                DERIVER_A_KEY_ID,
                &signing_a,
                TenantRootRecoverySignerRoleV1::DeriverA,
                not_before,
                not_after,
            )),
            chain(&certificate(
                ROOT_KEY_ID,
                &root,
                DERIVER_B_KEY_ID,
                &signing_b,
                TenantRootRecoverySignerRoleV1::DeriverB,
                NOT_BEFORE,
                NOT_AFTER,
            )),
            chain(&certificate(
                ROOT_KEY_ID,
                &root,
                CONTROL_PLANE_KEY_ID,
                &control_plane,
                TenantRootRecoverySignerRoleV1::ControlPlane,
                NOT_BEFORE,
                NOT_AFTER,
            )),
            &control_plane,
        );
        assert!(verify_tenant_root_recovery_manifest_trust_v1(
            &artifacts.manifest,
            &bundle(),
            &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
        )
        .is_err());
    }

    // The exact creation instant is inside the interval at both boundaries.
    let boundary = artifacts_with_chains(
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            DERIVER_A_KEY_ID,
            &signing_a,
            TenantRootRecoverySignerRoleV1::DeriverA,
            CREATION_TIME,
            NOT_AFTER,
        )),
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            DERIVER_B_KEY_ID,
            &signing_b,
            TenantRootRecoverySignerRoleV1::DeriverB,
            NOT_BEFORE,
            CREATION_TIME,
        )),
        chain(&certificate(
            ROOT_KEY_ID,
            &root,
            CONTROL_PLANE_KEY_ID,
            &control_plane,
            TenantRootRecoverySignerRoleV1::ControlPlane,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        &control_plane,
    );
    assert!(verify_tenant_root_recovery_manifest_trust_v1(
        &boundary.manifest,
        &bundle(),
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )
    .is_ok());
}

#[test]
fn ordinary_retirement_preserves_artifacts_but_compromise_invalidates_history() {
    let artifacts = well_formed_artifacts();
    let bundle = bundle();

    let retired = snapshot(
        7,
        "2026-09-01T00:00:00.000Z",
        vec![TenantRootRecoveryRevocationEntryV1::retired(DERIVER_A_KEY_ID).unwrap()],
    );
    let trust = verify_tenant_root_recovery_manifest_trust_v1(
        &artifacts.manifest,
        &bundle,
        &TenantRootRecoveryTrustEvidenceV1::TrustSnapshot { snapshot: &retired },
    )
    .expect("retirement preserves signed history");
    assert_eq!(
        trust.level(),
        &TenantRootRecoveryTrustLevelV1::ValidAtTrustSnapshot {
            snapshot_version: 7,
            snapshot_issued_at: "2026-09-01T00:00:00.000Z".to_owned(),
        }
    );
    assert_eq!(trust.level().as_str(), "valid_at_trust_snapshot");

    let compromised = snapshot(
        8,
        "2026-09-01T00:00:00.000Z",
        vec![TenantRootRecoveryRevocationEntryV1::compromised(
            DERIVER_A_KEY_ID,
            "2026-08-30T00:00:00.000Z",
        )
        .unwrap()],
    );
    assert!(verify_tenant_root_recovery_manifest_trust_v1(
        &artifacts.manifest,
        &bundle,
        &TenantRootRecoveryTrustEvidenceV1::TrustSnapshot {
            snapshot: &compromised,
        },
    )
    .is_err());

    // A compromise boundary at or before creation leaves the artifact valid.
    let later_boundary = snapshot(
        9,
        "2026-09-01T00:00:00.000Z",
        vec![
            TenantRootRecoveryRevocationEntryV1::compromised(DERIVER_A_KEY_ID, CREATION_TIME)
                .unwrap(),
        ],
    );
    assert!(verify_tenant_root_recovery_manifest_trust_v1(
        &artifacts.manifest,
        &bundle,
        &TenantRootRecoveryTrustEvidenceV1::TrustSnapshot {
            snapshot: &later_boundary,
        },
    )
    .is_ok());

    // A compromise of an unrelated signer key changes nothing.
    let unrelated = snapshot(
        10,
        "2026-09-01T00:00:00.000Z",
        vec![TenantRootRecoveryRevocationEntryV1::compromised(
            "some-other-key-1",
            "2027-01-01T00:00:00.000Z",
        )
        .unwrap()],
    );
    assert!(verify_tenant_root_recovery_manifest_trust_v1(
        &artifacts.manifest,
        &bundle,
        &TenantRootRecoveryTrustEvidenceV1::TrustSnapshot {
            snapshot: &unrelated,
        },
    )
    .is_ok());
}

#[test]
fn revocation_snapshots_are_canonical_and_signed_by_the_current_root_only() {
    let snapshot = snapshot(
        3,
        "2026-09-01T00:00:00.000Z",
        vec![
            TenantRootRecoveryRevocationEntryV1::retired("aaa-key-1").unwrap(),
            TenantRootRecoveryRevocationEntryV1::compromised("bbb-key-2", NOT_BEFORE).unwrap(),
        ],
    );
    let canonical = snapshot.canonical_json().expect("canonical");
    assert_eq!(
        TenantRootRecoveryRevocationSnapshotV1::from_canonical_json(&canonical).unwrap(),
        snapshot
    );
    assert!(snapshot.verify(&bundle()).is_ok());

    // Unsorted entries are not canonical.
    assert!(TenantRootRecoveryRevocationSnapshotV1::sign(
        3,
        "2026-09-01T00:00:00.000Z",
        ROOT_KEY_ID,
        &root_signing_key().to_bytes(),
        vec![
            TenantRootRecoveryRevocationEntryV1::retired("bbb-key-2").unwrap(),
            TenantRootRecoveryRevocationEntryV1::retired("aaa-key-1").unwrap(),
        ],
    )
    .is_err());

    // A superseded root cannot speak for present-day revocation.
    let bundle_with_history = TenantRootRecoveryTrustBundleV1::new(
        2,
        trust_root(),
        vec![old_trust_root()],
        vec![TenantRootRecoveryTrustBridgeV1::sign(
            old_trust_root(),
            &old_root_signing_key().to_bytes(),
            trust_root(),
            &root_signing_key().to_bytes(),
            "2026-06-01T00:00:00.000Z",
        )
        .unwrap()],
    )
    .expect("rotated bundle");
    let historical_signed = TenantRootRecoveryRevocationSnapshotV1::sign(
        4,
        "2026-09-01T00:00:00.000Z",
        OLD_ROOT_KEY_ID,
        &old_root_signing_key().to_bytes(),
        Vec::new(),
    )
    .unwrap();
    assert!(historical_signed.verify(&bundle_with_history).is_err());

    // A snapshot naming the current root but signed by another key fails.
    let forged = TenantRootRecoveryRevocationSnapshotV1::sign(
        5,
        "2026-09-01T00:00:00.000Z",
        ROOT_KEY_ID,
        &old_root_signing_key().to_bytes(),
        Vec::new(),
    )
    .unwrap();
    assert!(forged.verify(&bundle()).is_err());
}

#[test]
fn live_trust_confirmation_requires_a_fresh_snapshot() {
    let artifacts = well_formed_artifacts();
    let bundle = bundle();
    let snapshot = snapshot(11, "2026-09-01T00:00:00.000Z", Vec::new());

    let trust = verify_tenant_root_recovery_manifest_trust_v1(
        &artifacts.manifest,
        &bundle,
        &TenantRootRecoveryTrustEvidenceV1::LiveTrustCheck {
            snapshot: &snapshot,
            checked_at: "2026-09-01T00:04:00.000Z",
            max_snapshot_age_ms: 300_000,
        },
    )
    .expect("fresh snapshot confirms current trust");
    assert_eq!(
        trust.level(),
        &TenantRootRecoveryTrustLevelV1::CurrentTrustConfirmed {
            snapshot_version: 11,
            snapshot_issued_at: "2026-09-01T00:00:00.000Z".to_owned(),
            checked_at: "2026-09-01T00:04:00.000Z".to_owned(),
        }
    );
    assert_eq!(trust.level().as_str(), "current_trust_confirmed");

    // Past the freshness bound it is no longer a current-trust claim.
    assert!(verify_tenant_root_recovery_manifest_trust_v1(
        &artifacts.manifest,
        &bundle,
        &TenantRootRecoveryTrustEvidenceV1::LiveTrustCheck {
            snapshot: &snapshot,
            checked_at: "2026-09-01T00:06:00.000Z",
            max_snapshot_age_ms: 300_000,
        },
    )
    .is_err());

    // A snapshot issued beyond clock skew after the check is rejected.
    assert!(verify_tenant_root_recovery_manifest_trust_v1(
        &artifacts.manifest,
        &bundle,
        &TenantRootRecoveryTrustEvidenceV1::LiveTrustCheck {
            snapshot: &snapshot,
            checked_at: "2026-08-31T23:58:00.000Z",
            max_snapshot_age_ms: 300_000,
        },
    )
    .is_err());
}

#[test]
fn root_rotation_keeps_historical_certificates_verifiable() {
    let (signing_a, signing_b) = fixture_signers();
    let control_plane = signing_key(0xc1);
    let old_root = old_root_signing_key();
    let artifacts = artifacts_with_chains(
        chain(&certificate(
            OLD_ROOT_KEY_ID,
            &old_root,
            DERIVER_A_KEY_ID,
            &signing_a,
            TenantRootRecoverySignerRoleV1::DeriverA,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        chain(&certificate(
            OLD_ROOT_KEY_ID,
            &old_root,
            DERIVER_B_KEY_ID,
            &signing_b,
            TenantRootRecoverySignerRoleV1::DeriverB,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        chain(&certificate(
            OLD_ROOT_KEY_ID,
            &old_root,
            CONTROL_PLANE_KEY_ID,
            &control_plane,
            TenantRootRecoverySignerRoleV1::ControlPlane,
            NOT_BEFORE,
            NOT_AFTER,
        )),
        &control_plane,
    );

    // Without the superseded root pinned, the artifacts are untrusted.
    assert!(verify_tenant_root_recovery_manifest_trust_v1(
        &artifacts.manifest,
        &bundle(),
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )
    .is_err());

    let bridge = TenantRootRecoveryTrustBridgeV1::sign(
        old_trust_root(),
        &old_root.to_bytes(),
        trust_root(),
        &root_signing_key().to_bytes(),
        "2026-06-01T00:00:00.000Z",
    )
    .expect("bridge");
    let rotated =
        TenantRootRecoveryTrustBundleV1::new(2, trust_root(), vec![old_trust_root()], vec![bridge])
            .expect("rotated bundle");
    assert!(verify_tenant_root_recovery_artifacts_with_trust_v1(
        &artifacts.manifest,
        &artifacts.package_a,
        &artifacts.package_b,
        &rotated,
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )
    .is_ok());

    // A historical root with no bridge to the current root is not usable.
    assert!(TenantRootRecoveryTrustBundleV1::new(
        3,
        trust_root(),
        vec![old_trust_root()],
        Vec::new()
    )
    .is_err());
}

#[test]
fn trust_bundles_reject_unsigned_and_inconsistent_rotation() {
    let bridge = TenantRootRecoveryTrustBridgeV1::sign(
        old_trust_root(),
        &old_root_signing_key().to_bytes(),
        trust_root(),
        &root_signing_key().to_bytes(),
        "2026-06-01T00:00:00.000Z",
    )
    .expect("bridge");
    let rotated = TenantRootRecoveryTrustBundleV1::new(
        2,
        trust_root(),
        vec![old_trust_root()],
        vec![bridge.clone()],
    )
    .expect("rotated bundle");
    let canonical = rotated.canonical_json().expect("canonical");
    assert_eq!(
        TenantRootRecoveryTrustBundleV1::from_canonical_json(&canonical).unwrap(),
        rotated
    );

    // A bridge that only one root signed is not a rotation.
    assert!(TenantRootRecoveryTrustBridgeV1::sign(
        old_trust_root(),
        &old_root_signing_key().to_bytes(),
        trust_root(),
        &old_root_signing_key().to_bytes(),
        "2026-06-01T00:00:00.000Z",
    )
    .is_err());

    // A bridge whose endpoint key id is pinned to a different key is rejected.
    let mismatched_root = TenantRootRecoveryTrustRootV1::new(
        OLD_ROOT_KEY_ID,
        signing_key(0xab).verifying_key().to_bytes(),
    )
    .unwrap();
    assert!(TenantRootRecoveryTrustBundleV1::new(
        4,
        trust_root(),
        vec![mismatched_root],
        vec![bridge]
    )
    .is_err());

    // The current root may not also appear as historical.
    assert!(
        TenantRootRecoveryTrustBundleV1::new(5, trust_root(), vec![trust_root()], Vec::new())
            .is_err()
    );
}

#[test]
fn restore_admits_the_three_trust_results_differently() {
    let acknowledgement =
        TenantRootRecoveryOfflineTrustAcknowledgementV1::new("owner-1", "2026-09-02T00:00:00.000Z")
            .expect("acknowledgement");

    assert!(tenant_root_recovery_restore_trust_admission_v1(
        &TenantRootRecoveryTrustLevelV1::CurrentTrustConfirmed {
            snapshot_version: 1,
            snapshot_issued_at: "2026-09-01T00:00:00.000Z".to_owned(),
            checked_at: "2026-09-01T00:01:00.000Z".to_owned(),
        },
        CREATION_TIME,
        None,
    )
    .is_ok());

    // A snapshot issued at or after creation vouches for the artifact.
    assert!(tenant_root_recovery_restore_trust_admission_v1(
        &TenantRootRecoveryTrustLevelV1::ValidAtTrustSnapshot {
            snapshot_version: 1,
            snapshot_issued_at: CREATION_TIME.to_owned(),
        },
        CREATION_TIME,
        None,
    )
    .is_ok());
    assert!(tenant_root_recovery_restore_trust_admission_v1(
        &TenantRootRecoveryTrustLevelV1::ValidAtTrustSnapshot {
            snapshot_version: 1,
            snapshot_issued_at: "2026-08-29T10:20:30.122Z".to_owned(),
        },
        CREATION_TIME,
        None,
    )
    .is_err());

    // Offline verification needs the explicit destination acknowledgement.
    assert!(tenant_root_recovery_restore_trust_admission_v1(
        &TenantRootRecoveryTrustLevelV1::CryptographicallyValidOffline,
        CREATION_TIME,
        None,
    )
    .is_err());
    assert!(tenant_root_recovery_restore_trust_admission_v1(
        &TenantRootRecoveryTrustLevelV1::CryptographicallyValidOffline,
        CREATION_TIME,
        Some(&acknowledgement),
    )
    .is_ok());
    assert_eq!(
        acknowledgement.warning_version(),
        "tenant_root_recovery_offline_trust_v1"
    );
}
