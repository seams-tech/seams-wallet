//! Enrolling a recovery recipient: proof of control over a scripted console.
//!
//! The private key is used exactly once, to open the console's challenge. What
//! travels is the public key, the challenge id, and a confirmation derived
//! from the challenge secret; the secret and the credential
//! never leave the process.

#![cfg(unix)]

mod support;

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use base64ct::{Base64UrlUnpadded, Encoding};
use rand_core_09::{CryptoRng, RngCore};
use router_ab_core::{
    decode_tenant_root_recovery_recipient_proof_v1, TenantRootRecoveryRecipientKeypairV1,
    TwoPartyDeriverRole,
};
use seams_cli::{
    run_command_with_recovery_trust_v1, ConsoleRequestV1, ConsoleResponseV1,
    ConsoleTransportErrorV1, ConsoleTransportV1, SeamsCommandV1, SeamsExitCodeV1, SeamsResultV1,
    SecretInputV1, CONSOLE_ENVIRONMENT_HEADER_V1,
};
use seams_recovery_core::{
    write_new_file_durably_v1, RecoveryHostSecretCapabilitiesV1, RecoveryKeyFileV1,
};

const CREDENTIAL: &str = "console-session-token";
const DERIVER_A_KEY_MATERIAL: [u8; 32] = [0xa1; 32];
const DERIVER_B_KEY_MATERIAL: [u8; 32] = [0xb1; 32];

struct ScriptedRng {
    key_material: [u8; 32],
    consumed: bool,
    counter: u8,
}

impl ScriptedRng {
    const fn new(key_material: [u8; 32]) -> Self {
        Self {
            key_material,
            consumed: false,
            counter: 0,
        }
    }
}

impl RngCore for ScriptedRng {
    fn next_u32(&mut self) -> u32 {
        let mut bytes = [0_u8; 4];
        self.fill_bytes(&mut bytes);
        u32::from_le_bytes(bytes)
    }

    fn next_u64(&mut self) -> u64 {
        let mut bytes = [0_u8; 8];
        self.fill_bytes(&mut bytes);
        u64::from_le_bytes(bytes)
    }

    fn fill_bytes(&mut self, destination: &mut [u8]) {
        if !self.consumed && destination.len() == 32 {
            destination.copy_from_slice(&self.key_material);
            self.consumed = true;
            return;
        }
        for byte in destination.iter_mut() {
            self.counter = self.counter.wrapping_add(1);
            *byte = self.counter;
        }
    }
}

impl CryptoRng for ScriptedRng {}

struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("seams-enroll-{name}"));
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

fn key_file(scratch: &Scratch, role: TwoPartyDeriverRole, material: [u8; 32]) -> PathBuf {
    let (file, _) =
        RecoveryKeyFileV1::create(role, &mut ScriptedRng::new(material)).expect("key file");
    let path = scratch.path(&format!("{}.key", role.as_str()));
    write_new_file_durably_v1(&path, &file.to_bytes().expect("bytes")).expect("write key file");
    path
}

fn fingerprint(material: [u8; 32]) -> String {
    let keypair = TenantRootRecoveryRecipientKeypairV1::derive_from_ikm(material).expect("keypair");
    Base64UrlUnpadded::encode_string(keypair.fingerprint().as_bytes())
}

/// A console that issues the committed Deriver A challenge and records what
/// it is sent.
struct EnrolmentConsole {
    challenge: Vec<u8>,
    challenge_id_b64u: String,
    requests: RefCell<Vec<(String, serde_json::Value)>>,
}

impl EnrolmentConsole {
    fn new() -> Self {
        let challenge =
            std::fs::read(fixture("recipient-challenge-deriver-a.bin")).expect("fixture");
        let envelope =
            decode_tenant_root_recovery_recipient_proof_v1(&challenge).expect("challenge envelope");
        Self {
            challenge_id_b64u: Base64UrlUnpadded::encode_string(envelope.binding().challenge_id()),
            challenge,
            requests: RefCell::new(Vec::new()),
        }
    }
}

impl ConsoleTransportV1 for EnrolmentConsole {
    fn send(
        &self,
        request: ConsoleRequestV1,
    ) -> Result<ConsoleResponseV1, ConsoleTransportErrorV1> {
        assert_eq!(
            request.headers.get("authorization").map(String::as_str),
            Some(format!("Bearer {CREDENTIAL}").as_str())
        );
        assert_eq!(
            request
                .headers
                .get(CONSOLE_ENVIRONMENT_HEADER_V1)
                .map(String::as_str),
            Some("production")
        );
        let body: serde_json::Value =
            serde_json::from_slice(&request.body.clone().unwrap_or_default()).expect("json body");
        self.requests
            .borrow_mut()
            .push((request.url.clone(), body.clone()));

        if request.url.ends_with("/recipients/challenge") {
            let response = format!(
                r#"{{"ok":true,"challengeIdB64u":"{}","envelopeB64u":"{}"}}"#,
                self.challenge_id_b64u,
                Base64UrlUnpadded::encode_string(&self.challenge),
            );
            return Ok(ConsoleResponseV1 {
                status: 200,
                body: response.into_bytes(),
                content_type: Some("application/json".to_owned()),
            });
        }
        if request.url.ends_with("/recipients/confirm") {
            let response = format!(
                r#"{{"ok":true,"recipient":{{"role":"{}","recipientPublicKeyB64u":"unused","recipientFingerprintB64u":"{}","verifiedAtMs":1788000000000}}}}"#,
                body["role"].as_str().unwrap_or_default(),
                fingerprint(DERIVER_A_KEY_MATERIAL),
            );
            return Ok(ConsoleResponseV1 {
                status: 200,
                body: response.into_bytes(),
                content_type: Some("application/json".to_owned()),
            });
        }
        Err(ConsoleTransportErrorV1::new("unexpected request", false))
    }
}

fn open_secret(scratch: &Scratch, name: &str, value: &str) -> (std::fs::File, u16) {
    use std::os::unix::io::AsRawFd;
    let path = scratch.path(name);
    std::fs::write(&path, value).expect("secret file");
    let file = std::fs::File::open(&path).expect("open secret");
    let descriptor = u16::try_from(file.as_raw_fd()).expect("descriptor fits");
    (file, descriptor)
}

fn enroll(
    scratch: &Scratch,
    console: &EnrolmentConsole,
    role: TwoPartyDeriverRole,
    key_file_path: &Path,
) -> (SeamsResultV1, SeamsExitCodeV1) {
    let (credential_file, credential_fd) = open_secret(scratch, "credential", CREDENTIAL);
    let outcome = run_command_with_recovery_trust_v1(
        &SeamsCommandV1::RecoveryKeyEnroll {
            console_url: "https://console.example".to_owned(),
            environment: "production".to_owned(),
            role,
            key_file: key_file_path.to_path_buf(),

            credential: SecretInputV1::FileDescriptor(credential_fd),
        },
        RecoveryHostSecretCapabilitiesV1::new(false, false),
        console,
        &support::recovery_trust(),
    );
    drop(credential_file);
    outcome
}

#[test]
fn a_recipient_proves_control_and_is_enrolled_without_exposing_a_secret() {
    let scratch = Scratch::new("proves-control");
    let console = EnrolmentConsole::new();
    let key_a = key_file(
        &scratch,
        TwoPartyDeriverRole::DeriverA,
        DERIVER_A_KEY_MATERIAL,
    );

    let (result, exit) = enroll(&scratch, &console, TwoPartyDeriverRole::DeriverA, &key_a);
    assert_eq!(exit, SeamsExitCodeV1::Success, "{result:?}");
    match result {
        SeamsResultV1::RecipientEnrolled {
            role,
            environment,
            fingerprint_b64u,
            challenge_id_b64u,
            ..
        } => {
            assert_eq!(role, "deriver_a");
            assert_eq!(environment, "production");
            assert_eq!(fingerprint_b64u, fingerprint(DERIVER_A_KEY_MATERIAL));
            assert_eq!(challenge_id_b64u, console.challenge_id_b64u);
        }
        other => panic!("expected an enrolment, got {other:?}"),
    }

    let requests = console.requests.borrow();
    assert_eq!(requests.len(), 2);
    let (challenge_url, challenge_body) = &requests[0];
    assert!(challenge_url.ends_with("/recipients/challenge"));
    assert_eq!(challenge_body["role"], "deriver_a");
    assert!(challenge_body["recipientPublicKeyB64u"].is_string());
    let (confirm_url, confirm_body) = &requests[1];
    assert!(confirm_url.ends_with("/recipients/confirm"));
    assert_eq!(confirm_body["role"], "deriver_a");
    assert_eq!(confirm_body["challengeIdB64u"], console.challenge_id_b64u);
    assert!(confirm_body["confirmationB64u"].is_string());

    // Nothing secret crossed the wire: no private key, no credential in a body,
    // and no recovery key material.
    for (_, body) in requests.iter() {
        let rendered = body.to_string();
        assert!(!rendered.contains(CREDENTIAL));
        assert!(!rendered.contains(&Base64UrlUnpadded::encode_string(&DERIVER_A_KEY_MATERIAL)));
    }
}

#[test]
fn a_challenge_for_the_other_role_is_never_answered() {
    let scratch = Scratch::new("other-role");
    let console = EnrolmentConsole::new();
    // The console issues a Deriver A challenge whatever is asked; a Deriver B
    // key must refuse it before its private key is used, and never confirm.
    let key_b = key_file(
        &scratch,
        TwoPartyDeriverRole::DeriverB,
        DERIVER_B_KEY_MATERIAL,
    );

    let (result, exit) = enroll(&scratch, &console, TwoPartyDeriverRole::DeriverB, &key_b);
    assert_eq!(exit, SeamsExitCodeV1::ArtifactOrTrustFailure, "{result:?}");
    let requests = console.requests.borrow();
    assert_eq!(requests.len(), 1, "no confirmation was sent");
    assert!(requests[0].0.ends_with("/recipients/challenge"));

    // A key file for the wrong role fails before any request at all.
    let wrong_role = EnrolmentConsole::new();
    let (result, exit) = enroll(&scratch, &wrong_role, TwoPartyDeriverRole::DeriverA, &key_b);
    assert_eq!(exit, SeamsExitCodeV1::KeyProviderFailure, "{result:?}");
    assert!(wrong_role.requests.borrow().is_empty());
}
