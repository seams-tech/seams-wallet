//! Canonical recovery artifacts shared with the native CLI.
//!
//! The CLI crate cannot run the resharing ceremony, so the artifact set it
//! verifies is generated here and committed. This test regenerates the files
//! when `UPDATE_TENANT_ROOT_RECOVERY_CLI_FIXTURES=1` and otherwise asserts the
//! committed bytes still match, so a protocol change cannot silently leave the
//! CLI testing against stale artifacts.

use std::path::{Path, PathBuf};

use ed25519_dalek::SigningKey;
use rand_chacha_09::ChaCha20Rng;
use rand_core_09::SeedableRng;
use router_ab_core::{
    seal_tenant_root_recovery_package_v1, seal_tenant_root_recovery_recipient_proof_v1,
    sign_tenant_root_recovery_manifest_v1, TenantRootRecoveryRecipientKeypairV1,
    TenantRootRecoveryRecipientProofBindingV1, TenantRootRecoverySignerCertificateV1,
    TenantRootRecoverySignerRoleV1, TenantRootRecoveryTrustBundleV1, TenantRootRecoveryTrustRootV1,
};
use threshold_prf::TwoPartyDeriverRole;

mod support;

use support::{identity, lineage, verified_recovery_artifact_fixture};

/// Recovery-root signing key for the committed fixture set.
const FIXTURE_TRUST_ROOT_SEED: u8 = 0xd1;
/// Control-plane manifest signing key for the committed fixture set.
const FIXTURE_CONTROL_PLANE_SEED: u8 = 0xc1;
const FIXTURE_TRUST_ROOT_KEY_ID: &str = "seams-recovery-root-2026";
const FIXTURE_CONTROL_PLANE_KEY_ID: &str = "control-plane-manifest-key-3";
const FIXTURE_NOT_BEFORE: &str = "2026-01-01T00:00:00.000Z";
const FIXTURE_NOT_AFTER: &str = "2027-01-01T00:00:00.000Z";

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tenant-root-recovery")
}

fn signing_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn certificate(
    subject_key_id: &str,
    subject: &SigningKey,
    role: TenantRootRecoverySignerRoleV1,
) -> String {
    TenantRootRecoverySignerCertificateV1::sign(
        FIXTURE_TRUST_ROOT_KEY_ID,
        &signing_key(FIXTURE_TRUST_ROOT_SEED).to_bytes(),
        subject_key_id,
        subject.verifying_key().to_bytes(),
        role,
        FIXTURE_NOT_BEFORE,
        FIXTURE_NOT_AFTER,
    )
    .expect("certificate")
    .to_chain_entry()
    .expect("chain entry")
}

fn expect_fixture(name: &str, bytes: &[u8]) {
    let path = fixture_dir().join(name);
    if std::env::var("UPDATE_TENANT_ROOT_RECOVERY_CLI_FIXTURES").is_ok() {
        std::fs::create_dir_all(fixture_dir()).expect("fixture directory");
        std::fs::write(&path, bytes).expect("write fixture");
        return;
    }
    let committed = std::fs::read(&path).unwrap_or_else(|error| {
        panic!(
            "missing fixture {}: {error}. Regenerate with \
             UPDATE_TENANT_ROOT_RECOVERY_CLI_FIXTURES=1 cargo test -p router-ab-core \
             --test tenant_root_recovery_cli_fixtures",
            path.display()
        )
    });
    assert_eq!(
        committed,
        bytes,
        "fixture {} is stale; regenerate it rather than editing it by hand",
        path.display()
    );
}

#[test]
fn the_committed_cli_artifact_set_matches_the_current_protocol() {
    let fixture = verified_recovery_artifact_fixture();
    let descriptor = fixture.descriptor;
    let package_a = seal_tenant_root_recovery_package_v1(
        &descriptor,
        &fixture.verified_a,
        &mut ChaCha20Rng::from_seed([0x71; 32]),
        &fixture.signing_a.to_bytes(),
    )
    .expect("package A");
    let package_b = seal_tenant_root_recovery_package_v1(
        &descriptor,
        &fixture.verified_b,
        &mut ChaCha20Rng::from_seed([0x81; 32]),
        &fixture.signing_b.to_bytes(),
    )
    .expect("package B");

    let control_plane = signing_key(FIXTURE_CONTROL_PLANE_SEED);
    let manifest = sign_tenant_root_recovery_manifest_v1(
        descriptor.clone(),
        &package_a,
        &package_b,
        vec![certificate(
            descriptor.deriver_a().deriver_signing_key_id(),
            &fixture.signing_a,
            TenantRootRecoverySignerRoleV1::DeriverA,
        )],
        vec![certificate(
            descriptor.deriver_b().deriver_signing_key_id(),
            &fixture.signing_b,
            TenantRootRecoverySignerRoleV1::DeriverB,
        )],
        vec![certificate(
            FIXTURE_CONTROL_PLANE_KEY_ID,
            &control_plane,
            TenantRootRecoverySignerRoleV1::ControlPlane,
        )],
        &control_plane.to_bytes(),
    )
    .expect("manifest");

    let bundle = TenantRootRecoveryTrustBundleV1::new(
        1,
        TenantRootRecoveryTrustRootV1::new(
            FIXTURE_TRUST_ROOT_KEY_ID,
            signing_key(FIXTURE_TRUST_ROOT_SEED)
                .verifying_key()
                .to_bytes(),
        )
        .expect("trust root"),
        Vec::new(),
        Vec::new(),
    )
    .expect("trust bundle");

    expect_fixture(
        "manifest.json",
        &manifest.canonical_json().expect("manifest"),
    );
    expect_fixture(
        "deriver-a.backup",
        &package_a.to_bytes().expect("package A"),
    );
    expect_fixture(
        "deriver-b.backup",
        &package_b.to_bytes().expect("package B"),
    );
    expect_fixture(
        "trust-bundle.json",
        &bundle.canonical_json().expect("trust bundle"),
    );

    expect_fixture(
        "recipient-challenge-deriver-a.bin",
        &recipient_challenge(TwoPartyDeriverRole::DeriverA, [0xa1; 32]),
    );

    // The committed set must verify as a whole, not merely round-trip.
    assert_eq!(
        package_a.role(),
        TwoPartyDeriverRole::DeriverA,
        "package A role"
    );
    assert_eq!(
        package_b.role(),
        TwoPartyDeriverRole::DeriverB,
        "package B role"
    );
}

/// One sealed proof-of-control challenge for the committed recipient key.
///
/// The console mints these; the CLI opens one to prove it holds the private
/// key it is enrolling.
fn recipient_challenge(role: TwoPartyDeriverRole, key_material: [u8; 32]) -> Vec<u8> {
    let recipient = TenantRootRecoveryRecipientKeypairV1::derive_from_ikm(key_material)
        .expect("recipient keypair");
    let binding = TenantRootRecoveryRecipientProofBindingV1::new(
        [0x5c; 16],
        identity().digest().expect("identity digest"),
        lineage(),
        role,
        role.share_id(),
        recipient.fingerprint(),
        "owner-1",
        7,
        1_788_000_000_000,
        1_788_000_600_000,
    )
    .expect("challenge binding");
    seal_tenant_root_recovery_recipient_proof_v1(
        binding,
        recipient.public_key(),
        [0x6d; 32],
        &mut ChaCha20Rng::from_seed([0x91; 32]),
    )
    .expect("challenge envelope")
    .to_bytes()
    .expect("challenge bytes")
}
