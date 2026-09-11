//! Release verification: two roots, a signed checksum manifest, and no updates.

use base64ct::{Base64UrlUnpadded, Encoding};
use ed25519_dalek::SigningKey;
use seams_recovery_core::{
    ReleaseArtifactEntryV1, ReleaseChecksumManifestV1, ReleaseTrustRootV1,
    RELEASE_MANIFEST_MAX_BYTES_V1,
};
use sha2::{Digest, Sha256};

const RELEASE_KEY_ID: &str = "seams-release-root-2026";

fn release_signing_key() -> SigningKey {
    SigningKey::from_bytes(&[0xe1; 32])
}

fn recovery_root_key() -> [u8; 32] {
    SigningKey::from_bytes(&[0xd1; 32])
        .verifying_key()
        .to_bytes()
}

fn release_root() -> ReleaseTrustRootV1 {
    ReleaseTrustRootV1::new(
        RELEASE_KEY_ID,
        release_signing_key().verifying_key().to_bytes(),
        &recovery_root_key(),
    )
    .expect("release root")
}

fn digest(bytes: &[u8]) -> String {
    Base64UrlUnpadded::encode_string(&<[u8; 32]>::from(Sha256::digest(bytes)))
}

fn entry(filename: &str, bytes: &[u8]) -> ReleaseArtifactEntryV1 {
    ReleaseArtifactEntryV1 {
        target: "aarch64-apple-darwin".to_owned(),
        filename: filename.to_owned(),
        sha256_b64u: digest(bytes),
    }
}

fn manifest(entries: Vec<ReleaseArtifactEntryV1>) -> ReleaseChecksumManifestV1 {
    ReleaseChecksumManifestV1::sign(
        "0.1.0",
        "4299ac0b3",
        "tenant_root_operation_record_v1",
        RELEASE_KEY_ID,
        entries,
        &release_signing_key().to_bytes(),
    )
    .expect("manifest")
}

#[test]
fn the_release_root_cannot_be_the_recovery_root() {
    // Sharing one key would let whoever signs a release also sign recovery
    // artifacts, and the reverse.
    assert!(
        ReleaseTrustRootV1::new(RELEASE_KEY_ID, recovery_root_key(), &recovery_root_key(),)
            .is_err()
    );
    assert!(ReleaseTrustRootV1::new(
        "",
        release_signing_key().verifying_key().to_bytes(),
        &recovery_root_key()
    )
    .is_err());
    assert!(release_root().key_id() == RELEASE_KEY_ID);
}

#[test]
fn a_manifest_round_trips_and_verifies_against_its_pinned_root() {
    let binary = b"the seams binary".to_vec();
    let signed = manifest(vec![entry("seams-aarch64-apple-darwin", &binary)]);
    let bytes = signed.canonical_json().expect("canonical");
    assert!(bytes.len() <= RELEASE_MANIFEST_MAX_BYTES_V1);

    let decoded = ReleaseChecksumManifestV1::decode(&bytes).expect("decode");
    assert_eq!(decoded, signed);
    assert!(decoded.verify(&release_root()).is_ok());
    assert_eq!(decoded.release_version(), "0.1.0");
    assert_eq!(decoded.source_revision(), "4299ac0b3");
    assert_eq!(
        decoded.minimum_protocol_version(),
        "tenant_root_operation_record_v1"
    );
    assert!(decoded
        .verify_artifact("seams-aarch64-apple-darwin", &binary)
        .is_ok());

    // Non-canonical encodings are refused.
    let text = String::from_utf8(bytes).expect("utf-8");
    assert!(ReleaseChecksumManifestV1::decode(format!("{text} ").as_bytes()).is_err());
    assert!(
        ReleaseChecksumManifestV1::decode(text.replacen('{', "{\"extra\":1,", 1).as_bytes())
            .is_err()
    );
}

#[test]
fn another_root_cannot_vouch_for_a_release() {
    let signed = ReleaseChecksumManifestV1::sign(
        "0.1.0",
        "4299ac0b3",
        "tenant_root_operation_record_v1",
        RELEASE_KEY_ID,
        vec![entry("seams-aarch64-apple-darwin", b"binary")],
        // Signed by the recovery root, claiming the release key id.
        &SigningKey::from_bytes(&[0xd1; 32]).to_bytes(),
    )
    .expect("manifest");
    assert!(signed.verify(&release_root()).is_err());

    // A manifest naming a different signer is refused before the signature.
    let other_signer = ReleaseChecksumManifestV1::sign(
        "0.1.0",
        "4299ac0b3",
        "tenant_root_operation_record_v1",
        "some-other-release-root",
        vec![entry("seams-aarch64-apple-darwin", b"binary")],
        &release_signing_key().to_bytes(),
    )
    .expect("manifest");
    assert!(other_signer.verify(&release_root()).is_err());
}

#[test]
fn an_artifact_the_manifest_does_not_name_is_refused() {
    let binary = b"the seams binary".to_vec();
    let signed = manifest(vec![entry("seams-aarch64-apple-darwin", &binary)]);

    // A valid signature does not vouch for an artifact the manifest omits.
    assert!(signed
        .verify_artifact("seams-x86_64-unknown-linux-gnu", &binary)
        .is_err());
    // A named artifact whose bytes changed is refused.
    assert!(signed
        .verify_artifact("seams-aarch64-apple-darwin", b"a different binary")
        .is_err());
}

#[test]
fn manifests_must_describe_sorted_unique_artifacts() {
    assert!(ReleaseChecksumManifestV1::sign(
        "0.1.0",
        "4299ac0b3",
        "tenant_root_operation_record_v1",
        RELEASE_KEY_ID,
        Vec::new(),
        &release_signing_key().to_bytes(),
    )
    .is_err());

    assert!(ReleaseChecksumManifestV1::sign(
        "0.1.0",
        "4299ac0b3",
        "tenant_root_operation_record_v1",
        RELEASE_KEY_ID,
        vec![entry("seams-b", b"second"), entry("seams-a", b"first"),],
        &release_signing_key().to_bytes(),
    )
    .is_err());

    assert!(ReleaseChecksumManifestV1::sign(
        "0.1.0",
        "4299ac0b3",
        "tenant_root_operation_record_v1",
        RELEASE_KEY_ID,
        vec![entry("seams-a", b"first"), entry("seams-a", b"first")],
        &release_signing_key().to_bytes(),
    )
    .is_err());

    // A malformed digest is refused rather than compared as a string.
    assert!(ReleaseChecksumManifestV1::sign(
        "0.1.0",
        "4299ac0b3",
        "tenant_root_operation_record_v1",
        RELEASE_KEY_ID,
        vec![ReleaseArtifactEntryV1 {
            target: "aarch64-apple-darwin".to_owned(),
            filename: "seams".to_owned(),
            sha256_b64u: "not-a-digest".to_owned(),
        }],
        &release_signing_key().to_bytes(),
    )
    .is_err());
}
