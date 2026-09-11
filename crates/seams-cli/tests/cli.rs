//! Process-level behaviour of the `seams` binary: exit codes, redaction, and
//! the one-role boundary.

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use ed25519_dalek::SigningKey;
use router_ab_core::{TenantRootRecoveryTrustBundleV1, TenantRootRecoveryTrustRootV1};

struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("seams-cli-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("scratch directory");
        Self { root }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    /// Writes a self-consistent trust bundle for a root this binary does not pin.
    fn foreign_bundle(&self) -> PathBuf {
        let root = TenantRootRecoveryTrustRootV1::new(
            "someone-elses-root-2026",
            SigningKey::from_bytes(&[0x5e; 32])
                .verifying_key()
                .to_bytes(),
        )
        .expect("root");
        let bundle =
            TenantRootRecoveryTrustBundleV1::new(2, root, Vec::new(), Vec::new()).expect("bundle");
        let path = self.path("foreign-bundle.json");
        std::fs::write(&path, bundle.canonical_json().expect("json")).expect("write bundle");
        path
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

fn seams(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_seams-wallet"))
        .args(args)
        .env(
            "HOME",
            std::env::temp_dir().join(format!("seams-pristine-home-{}", std::process::id())),
        )
        .output()
        .expect("run seams")
}

/// Runs the binary with one secret supplied on a dedicated descriptor.
fn seams_with_descriptor(secret_file: &Path, option: &str, args: &[&str]) -> Output {
    let quoted: Vec<String> = args
        .iter()
        .map(|argument| format!("'{argument}'"))
        .collect();
    let script = format!(
        "exec 3< '{}'; exec '{}' {} --{option} 3",
        secret_file.display(),
        env!("CARGO_BIN_EXE_seams-wallet"),
        quoted.join(" "),
    );
    Command::new("sh")
        .arg("-c")
        .arg(script)
        .output()
        .expect("run seams")
}

fn stdout(output: &Output) -> String {
    String::from_utf8(output.stdout.clone()).expect("stdout utf-8")
}

fn stderr(output: &Output) -> String {
    String::from_utf8(output.stderr.clone()).expect("stderr utf-8")
}

fn code(output: &Output) -> i32 {
    output.status.code().expect("exit code")
}

fn json_result(output: &Output) -> serde_json::Value {
    serde_json::from_str(stdout(output).trim()).expect("json")
}

#[test]
fn help_and_version_succeed() {
    let help = seams(&["help"]);
    assert_eq!(code(&help), 0);
    assert!(stdout(&help).contains("seams-wallet derivation-root"));
    assert!(stdout(&help).contains("Everyday tasks"));
    assert!(!stdout(&help).contains("--passphrase-fd"));
    assert!(stdout(&help).lines().count() <= 26);
    assert_eq!(stdout(&seams(&["--help"])), stdout(&help));

    let advanced = seams(&["help", "advanced"]);
    assert_eq!(code(&advanced), 0);
    assert!(stdout(&advanced).contains("recovery-key enroll"));
    assert!(stdout(&advanced).contains("release verify"));

    let details = seams(&["derivation-root", "recovery-key", "enroll", "--help"]);
    assert_eq!(code(&details), 0);
    assert!(stdout(&details).contains("--wrapping-key-file"));
    assert_eq!(
        stdout(&details),
        stdout(&seams(&[
            "help",
            "derivation-root",
            "recovery-key",
            "enroll"
        ]))
    );
    let structured = seams(&["derivation-root", "backup", "verify", "--help", "--json"]);
    assert_eq!(code(&structured), 0);
    assert_eq!(json_result(&structured)["result"], "usage");
    assert!(json_result(&structured)["text"]
        .as_str()
        .unwrap()
        .contains("--manifest"));
    assert_eq!(code(&seams(&["derivation-root", "unknown", "--help"])), 2);
    let restore = seams(&["derivation-root", "restore", "--help"]);
    assert_eq!(code(&restore), 0);
    assert!(stdout(&restore).contains("restore --destination <url> --role"));
    assert!(stdout(&restore).contains("explicitly restore activate"));

    let version = seams(&["version"]);
    assert_eq!(code(&version), 0);
    assert!(stdout(&version).starts_with("seams-wallet "));

    // No arguments is usage, not a failure.
    assert_eq!(code(&seams(&[])), 0);
}

#[test]
fn usage_errors_exit_two_and_write_to_stderr() {
    let unknown = seams(&["derivation-root", "nonsense"]);
    assert_eq!(code(&unknown), 2);
    assert!(stderr(&unknown).contains("unknown command"));
    assert!(stdout(&unknown).is_empty());

    let missing = seams(&["derivation-root", "trust", "update"]);
    assert_eq!(code(&missing), 2);
    assert!(stderr(&missing).contains("--bundle is required"));

    let bad_role = seams(&[
        "derivation-root",
        "backup",
        "verify",
        "--manifest",
        "m",
        "--role",
        "deriver-c",
        "--package",
        "p",
    ]);
    assert_eq!(code(&bad_role), 2);
    assert!(stderr(&bad_role).contains("--role"));

    // A flag takes no value; a value after it is a usage error, not a silent
    // acknowledgement of something the operator did not mean.
    let flag_value = seams(&[
        "derivation-root",
        "restore",
        "activate",
        "--destination",
        "https://destination.example",
        "--acknowledge-offline-trust",
        "yes",
    ]);
    assert_eq!(code(&flag_value), 2);
    assert!(stderr(&flag_value).contains("takes no value"));
}

#[test]
fn a_trust_root_is_never_accepted_as_a_command_line_value() {
    for option in ["--trust-root", "--root-key"] {
        let refused = seams(&[
            "derivation-root",
            "trust",
            "show",
            option,
            "seams-recovery-root-production-2026-09",
        ]);
        assert_eq!(code(&refused), 2, "{option} must be refused");
        assert!(stderr(&refused).contains("pinned root"));
    }
}

#[test]
fn creating_a_recovery_key_writes_one_owner_only_file() {
    use std::os::unix::fs::PermissionsExt;

    let scratch = Scratch::new("key-create");
    let key_file = scratch.path("deriver-a-wrapper.key");
    let created = seams(&[
        "derivation-root",
        "recovery-key",
        "create",
        "--role",
        "deriver-a",
        "--wrapping-key-file",
        key_file.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(code(&created), 0, "{}", stderr(&created));

    let metadata = std::fs::metadata(&key_file).expect("key file");
    assert_eq!(metadata.permissions().mode() & 0o777, 0o600);

    let result = json_result(&created);
    assert_eq!(result["result"], "recovery_key_created");
    assert_eq!(result["role"], "deriver_a");
    assert!(result["publicKeyB64u"].as_str().is_some());
    assert!(result["fingerprintB64u"].as_str().is_some());
    // The host could not lock memory in this build, and says so rather than
    // implying a hardware boundary.
    assert_eq!(result["hostCapabilities"]["memoryLocking"], false);

    // The same path is never overwritten.
    let again = seams(&[
        "derivation-root",
        "recovery-key",
        "create",
        "--role",
        "deriver-a",
        "--wrapping-key-file",
        key_file.to_str().unwrap(),
    ]);
    assert_eq!(code(&again), 8);
    assert!(stderr(&again).contains("already exists"));
}

#[test]
fn an_oversized_credential_is_refused_rather_than_truncated() {
    let scratch = Scratch::new("oversized-secret");
    let oversized = scratch.path("oversized");
    std::fs::write(&oversized, vec![b'x'; 4097]).expect("secret file");
    let refused = seams_with_descriptor(
        &oversized,
        "bootstrap-fd",
        &[
            "derivation-root",
            "restore",
            "status",
            "--destination",
            "https://destination.example",
        ],
    );
    assert_eq!(code(&refused), 2, "{}", stderr(&refused));
    assert!(stderr(&refused).contains("exceeds 4096 bytes"));
}

#[test]
fn production_pins_refuse_fixture_signed_backups() {
    let refused = seams(&[
        "derivation-root",
        "backup",
        "verify",
        "--manifest",
        fixture("manifest.json").to_str().unwrap(),
        "--role",
        "deriver-a",
        "--package",
        fixture("deriver-a.backup").to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(code(&refused), 4, "{}", stderr(&refused));
    assert_eq!(
        json_result(&refused)["category"],
        "artifact_or_trust_failure"
    );
}

#[test]
fn a_bundle_for_a_root_this_binary_does_not_pin_is_refused() {
    let scratch = Scratch::new("foreign-root");
    let foreign = scratch.foreign_bundle();

    // Verification against a foreign root never happens, however valid the
    // bundle is on its own terms.
    let refused = seams(&[
        "derivation-root",
        "backup",
        "verify",
        "--manifest",
        fixture("manifest.json").to_str().unwrap(),
        "--role",
        "deriver-a",
        "--package",
        fixture("deriver-a.backup").to_str().unwrap(),
        "--trust-bundle",
        foreign.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(code(&refused), 4, "{}", stderr(&refused));
    let result = json_result(&refused);
    assert_eq!(result["category"], "artifact_or_trust_failure");

    // Nor is such a bundle installed for later use.
    let installed = scratch.path("installed-bundle.json");
    let update = seams(&[
        "derivation-root",
        "trust",
        "update",
        "--bundle",
        foreign.to_str().unwrap(),
        "--output",
        installed.to_str().unwrap(),
    ]);
    assert_eq!(code(&update), 4);
    assert!(!installed.exists());
}

#[test]
fn trust_show_and_update_report_the_pinned_bundle_and_its_continuations() {
    let scratch = Scratch::new("trust-pinned");
    let shown = seams(&["derivation-root", "trust", "show", "--json"]);
    assert_eq!(code(&shown), 0, "{}", stderr(&shown));
    let result = json_result(&shown);
    assert_eq!(result["result"], "trust_bundle");
    assert_eq!(result["pinned"], true);
    assert_eq!(
        result["currentRootKeyId"],
        "seams-recovery-root-production-2026-09"
    );
    assert_eq!(result["bridgeCount"], 0);

    // The production bundle itself is a valid continuation of its pin.
    let supplied = seams(&[
        "derivation-root",
        "trust",
        "show",
        "--trust-bundle",
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("trust/recovery-trust-bundle.json")
            .to_str()
            .unwrap(),
        "--json",
    ]);
    assert_eq!(code(&supplied), 0, "{}", stderr(&supplied));
    assert_eq!(json_result(&supplied)["pinned"], false);

    let installed = scratch.path("installed-bundle.json");
    let update = seams(&[
        "derivation-root",
        "trust",
        "update",
        "--bundle",
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("trust/recovery-trust-bundle.json")
            .to_str()
            .unwrap(),
        "--output",
        installed.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(code(&update), 0, "{}", stderr(&update));
    let result = json_result(&update);
    assert_eq!(result["result"], "trust_updated");
    assert_eq!(
        result["currentRootKeyId"],
        "seams-recovery-root-production-2026-09"
    );
    assert_eq!(
        std::fs::read(&installed).expect("installed"),
        std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("trust/recovery-trust-bundle.json")
        )
        .expect("fixture")
    );
}

#[test]
fn a_missing_or_oversized_artifact_fails_without_a_stack_trace() {
    let scratch = Scratch::new("bad-artifacts");
    let missing = seams(&[
        "derivation-root",
        "trust",
        "show",
        "--trust-bundle",
        scratch.path("absent.json").to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(code(&missing), 8);
    let result = json_result(&missing);
    assert_eq!(result["result"], "failed");
    assert_eq!(result["category"], "filesystem_durability_failure");
    assert_eq!(result["retryable"], false);
    assert!(!stderr(&missing).contains("panicked"));

    let garbage = scratch.path("garbage.json");
    std::fs::write(&garbage, b"{}").expect("write");
    let rejected = seams(&[
        "derivation-root",
        "trust",
        "show",
        "--trust-bundle",
        garbage.to_str().unwrap(),
    ]);
    assert_eq!(code(&rejected), 4);
}

#[test]
fn an_unreachable_console_reports_a_retryable_failure() {
    let scratch = Scratch::new("network-commands");
    let credential = scratch.path("credential");
    std::fs::write(&credential, "console-session-token").expect("credential file");

    let status = seams_with_descriptor(
        &credential,
        "credential-fd",
        &[
            "derivation-root",
            "status",
            // A host that resolves nowhere: the transport must report a
            // connection failure rather than hanging or panicking.
            "--console-url",
            "https://console.invalid",
            "--environment",
            "production",
            "--json",
        ],
    );
    assert_eq!(code(&status), 7, "{}", stderr(&status));
    let result = json_result(&status);
    assert_eq!(result["result"], "failed");
    assert_eq!(result["category"], "retryable_service_failure");
    assert_eq!(result["retryable"], true);
    // The credential is never echoed back, even in a failure.
    assert!(!stdout(&status).contains("console-session-token"));
    assert!(!stderr(&status).contains("console-session-token"));
}

#[test]
fn a_console_credential_is_never_a_command_line_value() {
    let scratch = Scratch::new("credential-argv");
    for option in ["--credential", "--token", "--console-token"] {
        let refused = seams(&[
            "derivation-root",
            "status",
            "--console-url",
            "https://console.example",
            "--environment",
            "production",
            option,
            "console-session-token",
        ]);
        assert_eq!(code(&refused), 2, "{option} must be refused");
        assert!(!stderr(&refused).contains("console-session-token"));
    }

    // A plaintext console URL is refused before any credential is read.
    let scratch_credential = scratch.path("credential");
    std::fs::write(&scratch_credential, "console-session-token").expect("credential file");
    let plaintext = seams_with_descriptor(
        &scratch_credential,
        "credential-fd",
        &[
            "derivation-root",
            "status",
            "--console-url",
            "http://console.example",
            "--environment",
            "production",
        ],
    );
    assert_eq!(code(&plaintext), 2);
    assert!(stderr(&plaintext).contains("https"));
}

/// Runs the binary detached from any controlling terminal, if this host can.
///
/// Linux hosts have `setsid`; a host with no controlling terminal at all (a CI
/// runner) needs nothing. An interactive host without `setsid` cannot run this
/// check, and says so instead of passing vacuously.
fn seams_without_a_terminal(args: &[&str]) -> Option<Output> {
    let has_terminal = std::fs::File::open("/dev/tty").is_ok();
    let has_setsid = Command::new("setsid")
        .arg("true")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let mut command = if has_setsid {
        let mut command = Command::new("setsid");
        command.arg(env!("CARGO_BIN_EXE_seams-wallet"));
        command
    } else if !has_terminal {
        Command::new(env!("CARGO_BIN_EXE_seams-wallet"))
    } else {
        eprintln!("skipped: this host has a controlling terminal and no setsid");
        return None;
    };
    Some(
        command
            .args(args)
            .stdin(std::process::Stdio::null())
            .output()
            .expect("run seams"),
    )
}

#[test]
fn restore_requires_browser_approval_configuration() {
    let Some(refused) = seams_without_a_terminal(&[
        "derivation-root",
        "restore",
        "status",
        "--destination",
        "https://destination.example",
    ]) else {
        return;
    };
    assert_eq!(code(&refused), 2, "{}", stderr(&refused));
    assert!(stderr(&refused).contains("console-url"));
}

#[test]
fn default_backup_verification_checks_both_packages() {
    let scratch = Scratch::new("verify-both");
    for name in ["manifest.json", "deriver-a.backup", "deriver-b.backup"] {
        std::fs::copy(fixture(name), scratch.path(name)).unwrap();
    }
    let trust = TenantRootRecoveryTrustBundleV1::from_canonical_json(
        &std::fs::read(fixture("trust-bundle.json")).unwrap(),
    )
    .unwrap();
    let invocation = seams_cli::parse_invocation_v1(&[
        "derivation-root".into(),
        "backup".into(),
        "verify".into(),
        "--manifest".into(),
        scratch.path("manifest.json").to_string_lossy().into_owned(),
    ])
    .unwrap();
    let (result, exit) = seams_cli::run_command_with_recovery_trust_v1(
        &invocation.command,
        seams_recovery_core::RecoveryHostSecretCapabilitiesV1::new(false, false),
        &seams_cli::UnavailableConsoleTransportV1,
        &trust,
    );
    assert_eq!(exit.code(), 0, "{}", result.render_text());
    match result {
        seams_cli::SeamsResultV1::BackupVerified { reports } => assert_eq!(reports.len(), 2),
        other => panic!("unexpected result: {}", other.render_text()),
    }
    std::fs::write(scratch.path("deriver-b.backup"), b"corrupt").unwrap();
    let (_, exit) = seams_cli::run_command_with_recovery_trust_v1(
        &invocation.command,
        seams_recovery_core::RecoveryHostSecretCapabilitiesV1::new(false, false),
        &seams_cli::UnavailableConsoleTransportV1,
        &trust,
    );
    assert_ne!(exit.code(), 0);
}
