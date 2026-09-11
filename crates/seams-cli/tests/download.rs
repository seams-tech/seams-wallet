//! The download command end to end: fetch, write durably, verify from disk.

#![cfg(unix)]

mod support;

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use base64ct::{Base64UrlUnpadded, Encoding};
use seams_cli::{
    run_command_with_recovery_trust_v1, ConsoleRequestV1, ConsoleResponseV1,
    ConsoleTransportErrorV1, ConsoleTransportV1, SeamsCommandV1, SeamsExitCodeV1, SeamsResultV1,
    CONSOLE_ENVIRONMENT_HEADER_V1,
};
use seams_recovery_core::RecoveryHostSecretCapabilitiesV1;
use sha2::{Digest, Sha256};

struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("seams-cli-download-{name}"));
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

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../router-ab-core/tests/fixtures/tenant-root-recovery")
        .join(name)
}

/// A transport that serves the committed artifact set and records reports.
struct FixtureTransport {
    package: Vec<u8>,
    digest_override: Option<String>,
    reports: RefCell<Vec<String>>,
}

impl FixtureTransport {
    fn new(package: Vec<u8>) -> Self {
        Self {
            package,
            digest_override: None,
            reports: RefCell::new(Vec::new()),
        }
    }

    fn with_wrong_digest(package: Vec<u8>) -> Self {
        Self {
            package,
            digest_override: Some(Base64UrlUnpadded::encode_string(&[0x00; 32])),
            reports: RefCell::new(Vec::new()),
        }
    }

    fn digest(&self) -> String {
        self.digest_override.clone().unwrap_or_else(|| {
            Base64UrlUnpadded::encode_string(&<[u8; 32]>::from(Sha256::digest(&self.package)))
        })
    }
}

impl ConsoleTransportV1 for FixtureTransport {
    fn send(
        &self,
        request: ConsoleRequestV1,
    ) -> Result<ConsoleResponseV1, ConsoleTransportErrorV1> {
        // Every console request names the environment for the console to check.
        assert_eq!(
            request
                .headers
                .get(CONSOLE_ENVIRONMENT_HEADER_V1)
                .map(String::as_str),
            Some("production"),
        );
        if request.url.ends_with("/backup/package") {
            let body = format!(
                r#"{{"ok":true,"artifactB64u":"{}","contentDigestB64u":"{}","recoverySetId":"set-1"}}"#,
                Base64UrlUnpadded::encode_string(&self.package),
                self.digest(),
            );
            return Ok(ConsoleResponseV1 {
                status: 200,
                body: body.into_bytes(),
                content_type: Some("application/json".to_owned()),
            });
        }
        if request.url.ends_with("/backup/durable-verification") {
            self.reports.borrow_mut().push(
                String::from_utf8(request.body.clone().unwrap_or_default()).unwrap_or_default(),
            );
            return Ok(ConsoleResponseV1 {
                status: 200,
                body: br#"{"ok":true,"evidence":{}}"#.to_vec(),
                content_type: Some("application/json".to_owned()),
            });
        }
        Err(ConsoleTransportErrorV1::new("unexpected request", false))
    }
}

/// Opens the credential and returns the descriptor number the OS assigned.
///
/// The command reads `/dev/fd/<n>`, so the test uses the real number rather
/// than duplicating onto a fixed one, which would need `dup2`.
fn open_credential(scratch: &Scratch) -> (std::fs::File, u16) {
    use std::os::unix::io::AsRawFd;
    let path = scratch.path("credential");
    std::fs::write(&path, "console-session-token").expect("credential file");
    let file = std::fs::File::open(&path).expect("open credential");
    let descriptor = u16::try_from(file.as_raw_fd()).expect("descriptor fits");
    (file, descriptor)
}

/// Runs one command with the credential on its own descriptor.
fn run_with_credential(
    build: impl FnOnce(u16) -> SeamsCommandV1,
    scratch: &Scratch,
    transport: &dyn ConsoleTransportV1,
) -> (SeamsResultV1, SeamsExitCodeV1) {
    let (file, descriptor) = open_credential(scratch);
    let command = build(descriptor);
    let outcome = run_command_with_recovery_trust_v1(
        &command,
        RecoveryHostSecretCapabilitiesV1::new(false, false),
        transport,
        &support::recovery_trust(),
    );
    drop(file);
    outcome
}

fn download(scratch: &Scratch, descriptor: u16, trust_bundle: Option<PathBuf>) -> SeamsCommandV1 {
    SeamsCommandV1::BackupDownload {
        console_url: "https://console.example".to_owned(),
        environment: "production".to_owned(),
        role: router_ab_core::TwoPartyDeriverRole::DeriverA,
        output: scratch.path("deriver-a.backup"),
        manifest: fixture("manifest.json"),
        trust_bundle,
        credential: seams_cli::SecretInputV1::FileDescriptor(descriptor),
    }
}

#[test]
fn a_downloaded_package_is_written_durably_and_verified_from_disk() {
    let scratch = Scratch::new("verified");
    let package = std::fs::read(fixture("deriver-a.backup")).expect("fixture package");
    let transport = FixtureTransport::new(package);

    let (result, exit) = run_with_credential(
        |descriptor| download(&scratch, descriptor, None),
        &scratch,
        &transport,
    );
    assert_eq!(exit, SeamsExitCodeV1::Success, "{result:?}");

    match result {
        SeamsResultV1::ArtifactDownloaded {
            artifact,
            content_digest_b64u,
            durable_verification_recorded,
            trust_level,
            ..
        } => {
            assert_eq!(artifact, "deriver_a_package");
            assert_eq!(
                trust_level.as_deref(),
                Some("cryptographically_valid_offline")
            );
            assert!(durable_verification_recorded);
            assert!(!content_digest_b64u.is_empty());
            // The bytes on disk are exactly what the service sent.
            assert_eq!(
                std::fs::read(scratch.path("deriver-a.backup")).expect("installed"),
                std::fs::read(fixture("deriver-a.backup")).expect("fixture"),
            );
            // The report names the artifact and its trust result, nothing more.
            let reports = transport.reports.borrow();
            let report = reports.first().expect("one report");
            assert!(report.contains("deriver_a_package"));
            assert!(report.contains("cryptographically_valid_offline"));
            assert!(!report.contains("console-session-token"));
        }
        other => panic!("unexpected result: {other:?}"),
    }
}

#[test]
fn a_digest_the_service_did_not_record_is_refused_and_the_file_removed() {
    let scratch = Scratch::new("digest-mismatch");
    let package = std::fs::read(fixture("deriver-a.backup")).expect("fixture package");
    let transport = FixtureTransport::with_wrong_digest(package.clone());

    let (result, exit) = run_with_credential(
        |descriptor| download(&scratch, descriptor, None),
        &scratch,
        &transport,
    );
    assert_eq!(exit, SeamsExitCodeV1::ArtifactOrTrustFailure);
    match result {
        SeamsResultV1::Failed {
            category, message, ..
        } => {
            assert_eq!(category, "artifact_or_trust_failure");
            assert!(message.contains("was removed"), "{message}");
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    // Nothing was reported as durably verified, and the unverified file does
    // not stay where a retry would need to write.
    assert!(transport.reports.borrow().is_empty());
    assert!(!scratch.path("deriver-a.backup").exists());

    // The retry against a correct digest succeeds at the same path.
    let retry = FixtureTransport::new(package);
    let (_, exit) = run_with_credential(
        |descriptor| download(&scratch, descriptor, None),
        &scratch,
        &retry,
    );
    assert_eq!(exit, SeamsExitCodeV1::Success);
    assert!(scratch.path("deriver-a.backup").exists());
}

#[test]
fn the_other_roles_package_is_refused_for_this_role() {
    let scratch = Scratch::new("wrong-role");
    let package = std::fs::read(fixture("deriver-b.backup")).expect("fixture package");
    let transport = FixtureTransport::new(package);

    let (result, exit) = run_with_credential(
        |descriptor| download(&scratch, descriptor, None),
        &scratch,
        &transport,
    );
    assert_eq!(exit, SeamsExitCodeV1::ArtifactOrTrustFailure);
    match result {
        SeamsResultV1::Failed {
            category, message, ..
        } => {
            assert_eq!(category, "artifact_or_trust_failure");
            assert!(message.contains("other Deriver role"), "{message}");
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert!(transport.reports.borrow().is_empty());
    assert!(!scratch.path("deriver-a.backup").exists());
}

#[test]
fn a_trust_bundle_that_does_not_continue_the_pin_fails_before_any_download() {
    let scratch = Scratch::new("foreign-trust");
    let package = std::fs::read(fixture("deriver-a.backup")).expect("fixture package");
    let transport = FixtureTransport::new(package);
    // A syntactically valid bundle for a root this binary does not pin.
    let foreign = scratch.path("foreign-bundle.json");
    std::fs::write(&foreign, b"{}").expect("write");

    let (result, exit) = run_with_credential(
        |descriptor| download(&scratch, descriptor, Some(foreign.clone())),
        &scratch,
        &transport,
    );
    assert_eq!(exit, SeamsExitCodeV1::ArtifactOrTrustFailure, "{result:?}");
    assert!(transport.reports.borrow().is_empty());
    assert!(!scratch.path("deriver-a.backup").exists());
}

struct InterruptedDownloadTransport;

impl ConsoleTransportV1 for InterruptedDownloadTransport {
    fn send(
        &self,
        request: ConsoleRequestV1,
    ) -> Result<ConsoleResponseV1, ConsoleTransportErrorV1> {
        assert!(request.url.ends_with("/backup/package"));
        Err(ConsoleTransportErrorV1::new(
            "could not read the response: connection closed before message completed",
            true,
        ))
    }
}

#[test]
fn an_interrupted_response_leaves_no_file_and_retry_installs_the_verified_package() {
    let scratch = Scratch::new("interrupted-response");
    let (result, exit) = run_with_credential(
        |descriptor| download(&scratch, descriptor, None),
        &scratch,
        &InterruptedDownloadTransport,
    );
    assert_ne!(exit, SeamsExitCodeV1::Success, "{result:?}");
    assert!(!scratch.path("deriver-a.backup").exists());

    let package = std::fs::read(fixture("deriver-a.backup")).expect("fixture package");
    let transport = FixtureTransport::new(package.clone());
    let (result, exit) = run_with_credential(
        |descriptor| download(&scratch, descriptor, None),
        &scratch,
        &transport,
    );
    assert_eq!(exit, SeamsExitCodeV1::Success, "{result:?}");
    assert_eq!(
        std::fs::read(scratch.path("deriver-a.backup")).unwrap(),
        package
    );
    assert_eq!(transport.reports.borrow().len(), 1);
}
