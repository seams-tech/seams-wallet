//! The release manifest generator, as a process.

#![cfg(unix)]

use std::path::PathBuf;
use std::process::{Command, Output};

use base64ct::{Base64UrlUnpadded, Encoding};
use ed25519_dalek::SigningKey;
use seams_recovery_core::{ReleaseChecksumManifestV1, ReleaseTrustRootV1};

const SIGNER_KEY_ID: &str = "seams-release-root-2026";

struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("seams-release-tool-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("scratch directory");
        Self { root }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn generate(scratch: &Scratch, extra: &[String]) -> Output {
    let key = SigningKey::from_bytes(&[0xe1; 32]);
    let key_path = scratch.path("signing-key");
    std::fs::write(&key_path, Base64UrlUnpadded::encode_string(&key.to_bytes()))
        .expect("signing key");
    let arguments = extra
        .iter()
        .map(|argument| format!("'{argument}'"))
        .collect::<Vec<_>>()
        .join(" ");
    let script = format!(
        "exec 3< '{}'; exec '{}' {arguments} --signing-key-fd 3",
        key_path.display(),
        env!("CARGO_BIN_EXE_seams-release-manifest"),
    );
    Command::new("sh")
        .arg("-c")
        .arg(script)
        .output()
        .expect("run generator")
}

#[test]
fn the_generator_signs_a_manifest_the_test_root_accepts() {
    let scratch = Scratch::new("signs");
    let binary = scratch.path("seams-aarch64-apple-darwin");
    std::fs::write(&binary, b"the seams binary").expect("artifact");

    let output = generate(
        &scratch,
        &[
            "--release-version".to_owned(),
            "0.1.0".to_owned(),
            "--source-revision".to_owned(),
            "4299ac0b3".to_owned(),
            "--minimum-protocol-version".to_owned(),
            "tenant_root_operation_record_v1".to_owned(),
            "--signer-key-id".to_owned(),
            SIGNER_KEY_ID.to_owned(),
            "--artifact".to_owned(),
            format!("aarch64-apple-darwin={}", binary.display()),
        ],
    );
    assert_eq!(
        output.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let manifest = ReleaseChecksumManifestV1::decode(&output.stdout).expect("decode manifest");
    let root = ReleaseTrustRootV1::new(
        SIGNER_KEY_ID,
        SigningKey::from_bytes(&[0xe1; 32])
            .verifying_key()
            .to_bytes(),
        &SigningKey::from_bytes(&[0xd1; 32])
            .verifying_key()
            .to_bytes(),
    )
    .expect("release root");
    assert!(manifest.verify(&root).is_ok());
    assert!(manifest
        .verify_artifact("seams-aarch64-apple-darwin", b"the seams binary")
        .is_ok());
    assert!(manifest
        .verify_artifact("seams-aarch64-apple-darwin", b"the seams binary, altered")
        .is_err());
    assert_eq!(manifest.source_revision(), "4299ac0b3");

    // The signing key never appears in the output.
    let rendered = String::from_utf8(output.stdout).expect("utf-8");
    assert!(!rendered.contains(&Base64UrlUnpadded::encode_string(
        &SigningKey::from_bytes(&[0xe1; 32]).to_bytes()
    )));
}

#[test]
fn the_generator_refuses_a_shared_descriptor_and_missing_artifacts() {
    let scratch = Scratch::new("refusals");
    let binary = scratch.path("seams-aarch64-apple-darwin");
    std::fs::write(&binary, b"the seams binary").expect("artifact");

    // Standard input is shared with pipeline data and is not dedicated.
    let shared = Command::new(env!("CARGO_BIN_EXE_seams-release-manifest"))
        .args([
            "--release-version",
            "0.1.0",
            "--source-revision",
            "4299ac0b3",
            "--minimum-protocol-version",
            "tenant_root_operation_record_v1",
            "--signer-key-id",
            SIGNER_KEY_ID,
            "--signing-key-fd",
            "0",
            "--artifact",
            &format!("aarch64-apple-darwin={}", binary.display()),
        ])
        .output()
        .expect("run generator");
    assert_ne!(shared.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&shared.stderr).contains("dedicated descriptor"));

    // A manifest describing nothing is refused rather than signed.
    let empty = generate(
        &scratch,
        &[
            "--release-version".to_owned(),
            "0.1.0".to_owned(),
            "--source-revision".to_owned(),
            "4299ac0b3".to_owned(),
            "--minimum-protocol-version".to_owned(),
            "tenant_root_operation_record_v1".to_owned(),
            "--signer-key-id".to_owned(),
            SIGNER_KEY_ID.to_owned(),
        ],
    );
    assert_ne!(empty.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&empty.stderr).contains("--artifact"));
}

/// Signs one manifest over `binary` with the given seed and returns its path.
fn signed_manifest(scratch: &Scratch, seed: [u8; 32], binary: &std::path::Path) -> PathBuf {
    let key = SigningKey::from_bytes(&seed);
    let key_path = scratch.path(&format!("signing-key-{:02x}", seed[0]));
    std::fs::write(&key_path, Base64UrlUnpadded::encode_string(&key.to_bytes()))
        .expect("signing key");
    let script = format!(
        "exec 3< '{}'; exec '{}' --release-version 0.1.0 --source-revision 4299ac0b3 \
         --minimum-protocol-version tenant_root_operation_record_v1 \
         --signer-key-id {SIGNER_KEY_ID} --signing-key-fd 3 \
         --artifact 'aarch64-apple-darwin={}'",
        key_path.display(),
        env!("CARGO_BIN_EXE_seams-release-manifest"),
        binary.display(),
    );
    let output = Command::new("sh")
        .arg("-c")
        .arg(script)
        .output()
        .expect("run generator");
    assert_eq!(
        output.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let manifest_path = scratch.path(&format!("manifest-{:02x}.json", seed[0]));
    std::fs::write(&manifest_path, output.stdout).expect("manifest");
    manifest_path
}

#[test]
fn the_recovery_binary_rejects_the_fixture_release_root() {
    let scratch = Scratch::new("release-verify");
    let binary = scratch.path("seams-aarch64-apple-darwin");
    std::fs::write(&binary, b"the seams binary").expect("artifact");

    let manifest = signed_manifest(&scratch, [0xe1; 32], &binary);
    let refused = Command::new(env!("CARGO_BIN_EXE_seams-wallet"))
        .args([
            "release",
            "verify",
            "--manifest",
            manifest.to_str().unwrap(),
            "--artifact",
            binary.to_str().unwrap(),
        ])
        .output()
        .expect("run seams");
    assert_eq!(refused.status.code(), Some(4));
    assert!(String::from_utf8_lossy(&refused.stderr).contains("pinned release root"));
}
