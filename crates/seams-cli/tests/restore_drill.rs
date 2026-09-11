//! Restore drills: source-offline recovery and destination clone isolation.
//!
//! These are the claims the product makes about recovery, exercised rather
//! than asserted:
//!
//! - the source deployment is unnecessary once a tenant holds its files;
//! - the same files can restore more than one destination, and each one gets
//!   its own custody lineage rather than inheriting the source's;
//! - the destination bootstrap credential is presented once, to open a
//!   session, and never travels again.

#![cfg(unix)]

mod support;

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use base64ct::{Base64UrlUnpadded, Encoding};
use rand_core_09::{CryptoRng, RngCore};
use router_ab_core::{TenantRootRestoreImportEnvelopeV1, TwoPartyDeriverRole};
use seams_cli::{
    run_command_with_recovery_trust_v1, ConsoleRequestV1, ConsoleResponseV1,
    ConsoleTransportErrorV1, ConsoleTransportV1, SeamsCommandV1, SeamsExitCodeV1, SeamsResultV1,
    SecretInputV1, DESTINATION_BOOTSTRAP_HEADER_V1, RESTORE_SESSION_HEADER_V1,
};
use seams_recovery_core::{
    write_new_file_durably_v1, RecoveryHostSecretCapabilitiesV1, RecoveryKeyFileV1,
};

const BOOTSTRAP: &str = "destination-bootstrap-token";
const DERIVER_A_KEY_MATERIAL: [u8; 32] = [0xa1; 32];
const DERIVER_B_KEY_MATERIAL: [u8; 32] = [0xb1; 32];
const SOURCE_CONSOLE: &str = "https://source-console.example";

/// An RNG that yields fixed recipient key material first.
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
        let root = std::env::temp_dir().join(format!("seams-restore-drill-{name}"));
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

fn json(status: u16, body: String) -> Result<ConsoleResponseV1, ConsoleTransportErrorV1> {
    Ok(ConsoleResponseV1 {
        status,
        body: body.into_bytes(),
        content_type: Some("application/json".to_owned()),
    })
}

/// One destination deployment, with its own fingerprint and lineage.
struct Destination {
    url: String,
    session_token: String,
    fingerprint: [u8; 32],
    lineage: [u8; 16],
    session_id: [u8; 16],
    import_public_key: [u8; 32],
    /// Whether manifest registration is refused, to exercise the failure path.
    refuse_manifest: bool,
    /// The restore session status the destination currently reports.
    status: RefCell<&'static str>,
    /// Envelopes uploaded to this destination, by role.
    imports: RefCell<Vec<(String, Vec<u8>)>>,
    /// How many times the bootstrap credential was presented.
    bootstrap_presentations: RefCell<usize>,
}

impl Destination {
    fn new(label: u8, url: &str) -> Self {
        // A distinct import key per destination, derived like a real one.
        let import = router_ab_core::TenantRootRestoreImportKeypairV1::derive_from_ikm(
            [label.wrapping_add(0x40); 32],
        )
        .expect("import keypair");
        Self {
            url: url.to_owned(),
            session_token: format!("restore-session-{label:02x}"),
            fingerprint: [label; 32],
            lineage: [label.wrapping_add(1); 16],
            session_id: [label.wrapping_add(2); 16],
            import_public_key: *import.public_key().as_bytes(),
            refuse_manifest: false,
            status: RefCell::new("none"),
            imports: RefCell::new(Vec::new()),
            bootstrap_presentations: RefCell::new(0),
        }
    }

    fn refusing_manifests(mut self) -> Self {
        self.refuse_manifest = true;
        self
    }

    fn session_body(&self, status: &str) -> String {
        match status {
            "none" => r#"{"ok":true,"session":null}"#.to_owned(),
            "active" => format!(
                r#"{{"ok":true,"session":{{"status":"active","sessionId":"session-1","destinationFingerprintB64u":"{}","destinationLineageId":"{}"}}}}"#,
                Base64UrlUnpadded::encode_string(&self.fingerprint),
                Base64UrlUnpadded::encode_string(&self.lineage),
            ),
            other => format!(
                r#"{{"ok":true,"session":{{"status":"{other}","sessionId":"session-1","expiresAt":"2026-09-06T00:00:00Z","destinationFingerprintB64u":"{}"}}}}"#,
                Base64UrlUnpadded::encode_string(&self.fingerprint),
            ),
        }
    }
}

/// A transport that serves destinations and refuses the source entirely.
struct DrillTransport<'a> {
    destinations: Vec<&'a Destination>,
    source_requests: RefCell<usize>,
}

impl<'a> DrillTransport<'a> {
    fn new(destinations: Vec<&'a Destination>) -> Self {
        Self {
            destinations,
            source_requests: RefCell::new(0),
        }
    }

    fn destination_for(&self, url: &str) -> Option<&'a Destination> {
        self.destinations
            .iter()
            .copied()
            .find(|destination| url.starts_with(&destination.url))
    }
}

impl ConsoleTransportV1 for DrillTransport<'_> {
    fn send(
        &self,
        request: ConsoleRequestV1,
    ) -> Result<ConsoleResponseV1, ConsoleTransportErrorV1> {
        if request.url.starts_with(SOURCE_CONSOLE) {
            *self.source_requests.borrow_mut() += 1;
            return Err(ConsoleTransportErrorV1::new(
                "the source deployment is unavailable in this drill",
                false,
            ));
        }
        let Some(destination) = self.destination_for(&request.url) else {
            return Err(ConsoleTransportErrorV1::new("unknown host", false));
        };

        if request.url.ends_with("/restore/bootstrap-session") {
            // The bootstrap credential is presented here, and only here.
            assert_eq!(
                request
                    .headers
                    .get(DESTINATION_BOOTSTRAP_HEADER_V1)
                    .map(String::as_str),
                Some(BOOTSTRAP),
                "session opening presents the bootstrap credential",
            );
            assert!(!request.headers.contains_key(RESTORE_SESSION_HEADER_V1));
            *destination.bootstrap_presentations.borrow_mut() += 1;
            return json(
                200,
                format!(
                    r#"{{"ok":true,"sessionToken":"{}","expiresAt":"2026-09-05T00:30:00Z"}}"#,
                    destination.session_token
                ),
            );
        }

        // Every other destination request carries the minted session and
        // never the bootstrap credential.
        assert_eq!(
            request
                .headers
                .get(RESTORE_SESSION_HEADER_V1)
                .map(String::as_str),
            Some(destination.session_token.as_str()),
            "destination admission after opening is the session",
        );
        assert!(
            !request
                .headers
                .contains_key(DESTINATION_BOOTSTRAP_HEADER_V1),
            "the bootstrap credential travels exactly once",
        );

        if request.url.ends_with("/restore/status") {
            assert_eq!(request.method, "GET");
            assert!(request.body.is_none());
            return json(200, destination.session_body(&destination.status.borrow()));
        }
        if request.url.ends_with("/restore/manifest") {
            if destination.refuse_manifest {
                return json(
                    409,
                    r#"{"ok":false,"error":{"kind":"manifest_not_for_this_destination"}}"#
                        .to_owned(),
                );
            }
            *destination.status.borrow_mut() = "awaiting_role_imports";
            return json(200, destination.session_body("awaiting_role_imports"));
        }
        if request.url.ends_with("/restore/activate") {
            let body: serde_json::Value =
                serde_json::from_slice(&request.body.clone().unwrap_or_default())
                    .expect("activate body");
            assert_eq!(body["acknowledgeOfflineTrust"], true);
            *destination.status.borrow_mut() = "active";
            return json(200, destination.session_body("active"));
        }
        if request.url.ends_with("/restore") {
            if *destination.status.borrow() != "none" {
                return json(
                    409,
                    r#"{"ok":false,"error":{"kind":"restore_session_in_flight"}}"#.to_owned(),
                );
            }
            *destination.status.borrow_mut() = "awaiting_manifest";
            return json(200, destination.session_body("awaiting_manifest"));
        }
        if request.url.ends_with("/restore/import-key") {
            let body: serde_json::Value =
                serde_json::from_slice(&request.body.clone().unwrap_or_default())
                    .expect("import-key body");
            let role = body["role"].as_str().expect("role");
            let operation_id = body["operationId"].as_str().expect("operation id");
            return json(
                200,
                format!(
                    r#"{{"ok":true,"importKeyId":"import-key-1","importPublicKeyB64u":"{}","destinationFingerprintB64u":"{}","destinationLineageB64u":"{}","restoreSessionIdB64u":"{}","operationId":"{}","operationDigestB64u":"operation-digest-1","commandDigestB64u":"command-digest-1","role":"{}","generation":1,"issuedAtMs":1788000000000,"expiresAtMs":1788000900000,"replayed":false}}"#,
                    Base64UrlUnpadded::encode_string(&destination.import_public_key),
                    Base64UrlUnpadded::encode_string(&destination.fingerprint),
                    Base64UrlUnpadded::encode_string(&destination.lineage),
                    Base64UrlUnpadded::encode_string(&destination.session_id),
                    operation_id,
                    role,
                ),
            );
        }
        if request.url.ends_with("/restore/import") {
            let body: serde_json::Value =
                serde_json::from_slice(&request.body.clone().unwrap_or_default())
                    .expect("import body");
            let role = body["role"].as_str().expect("role").to_owned();
            let envelope = Base64UrlUnpadded::decode_vec(
                body["importEnvelopeB64u"].as_str().expect("envelope"),
            )
            .expect("canonical envelope");
            destination.imports.borrow_mut().push((role, envelope));
            let installed = destination.imports.borrow().len();
            let status = if installed >= 2 {
                "verifying"
            } else {
                "awaiting_role_imports"
            };
            return json(
                200,
                format!(
                    r#"{{"ok":true,"session":{{"status":"{status}","sessionId":"session-1"}},"receiptDigestB64u":"receipt-{installed}","replayed":false}}"#
                ),
            );
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

fn run(
    command: &SeamsCommandV1,
    transport: &dyn ConsoleTransportV1,
) -> (SeamsResultV1, SeamsExitCodeV1) {
    run_command_with_recovery_trust_v1(
        command,
        RecoveryHostSecretCapabilitiesV1::new(false, false),
        transport,
        &support::recovery_trust(),
    )
}

/// Starts one restore session and registers the manifest with it.
fn restore_start(
    scratch: &Scratch,
    transport: &dyn ConsoleTransportV1,
    destination: &Destination,
) -> (SeamsResultV1, SeamsExitCodeV1) {
    let (bootstrap_file, bootstrap_fd) = open_secret(scratch, "bootstrap-start", BOOTSTRAP);
    let outcome = run(
        &SeamsCommandV1::RestoreStart {
            destination_url: destination.url.clone(),
            manifest: fixture("manifest.json"),
            bootstrap: seams_cli::RestoreAuthorizationV1::Bootstrap(SecretInputV1::FileDescriptor(
                bootstrap_fd,
            )),
        },
        transport,
    );
    drop(bootstrap_file);
    outcome
}

/// Restores one role into one destination using only local files.
fn restore_role(
    scratch: &Scratch,
    transport: &dyn ConsoleTransportV1,
    destination: &Destination,
    role: TwoPartyDeriverRole,
    key_file_path: &Path,
) -> SeamsResultV1 {
    let (bootstrap_file, bootstrap_fd) =
        open_secret(scratch, &format!("bootstrap-{}", role.as_str()), BOOTSTRAP);
    let envelope_file = scratch.path(&format!(
        "restore-envelope-{:02x}-{}.bin",
        destination.fingerprint[0],
        role.as_str()
    ));
    let command = SeamsCommandV1::RestoreShare {
        destination_url: destination.url.clone(),
        operation_id: format!("restore-operation-{}", role.as_str()),
        role,
        package: fixture(&format!("{}.backup", role.as_str().replace('_', "-"))),
        key_file: key_file_path.to_path_buf(),
        manifest: fixture("manifest.json"),
        envelope_file,
        trust_bundle: None,

        bootstrap: seams_cli::RestoreAuthorizationV1::Bootstrap(SecretInputV1::FileDescriptor(
            bootstrap_fd,
        )),
    };
    let (result, _exit) = run(&command, transport);
    drop(bootstrap_file);
    result
}

#[test]
fn a_restore_retry_reuses_the_durable_envelope_without_the_local_key() {
    let scratch = Scratch::new("restore-retry");
    let destination = Destination::new(0x66, "https://destination-one.example");
    let transport = DrillTransport::new(vec![&destination]);
    let key_a = key_file(
        &scratch,
        TwoPartyDeriverRole::DeriverA,
        DERIVER_A_KEY_MATERIAL,
    );

    let first = restore_role(
        &scratch,
        &transport,
        &destination,
        TwoPartyDeriverRole::DeriverA,
        &key_a,
    );
    assert!(
        matches!(first, SeamsResultV1::RestoreSession { .. }),
        "{first:?}"
    );
    let first_envelope = destination.imports.borrow()[0].1.clone();
    let envelope_path = scratch.path("restore-envelope-66-deriver_a.bin");
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(
        std::fs::symlink_metadata(envelope_path)
            .expect("durable envelope")
            .permissions()
            .mode()
            & 0o777,
        0o600,
    );
    std::fs::remove_file(&key_a).expect("remove local key after the first send");

    let retried = restore_role(
        &scratch,
        &transport,
        &destination,
        TwoPartyDeriverRole::DeriverA,
        &key_a,
    );
    assert!(
        matches!(retried, SeamsResultV1::RestoreSession { .. }),
        "{retried:?}"
    );
    let imports = destination.imports.borrow();
    assert_eq!(imports.len(), 2);
    assert_eq!(imports[0].1, first_envelope);
    assert_eq!(imports[1].1, imports[0].1);
}

#[test]
fn a_tenant_restores_with_the_source_deployment_unavailable() {
    let scratch = Scratch::new("source-offline");
    let destination = Destination::new(0x66, "https://destination-one.example");
    let transport = DrillTransport::new(vec![&destination]);
    let key_a = key_file(
        &scratch,
        TwoPartyDeriverRole::DeriverA,
        DERIVER_A_KEY_MATERIAL,
    );
    let key_b = key_file(
        &scratch,
        TwoPartyDeriverRole::DeriverB,
        DERIVER_B_KEY_MATERIAL,
    );

    // The session opens and the manifest registers in one invocation.
    let (started, exit) = restore_start(&scratch, &transport, &destination);
    assert_eq!(exit, SeamsExitCodeV1::Success, "{started:?}");
    match started {
        SeamsResultV1::RestoreSession { status, .. } => {
            assert_eq!(status, "awaiting_role_imports");
        }
        other => panic!("expected a restore session, got {other:?}"),
    }

    for (role, key) in [
        (TwoPartyDeriverRole::DeriverA, &key_a),
        (TwoPartyDeriverRole::DeriverB, &key_b),
    ] {
        match restore_role(&scratch, &transport, &destination, role, key) {
            SeamsResultV1::RestoreSession {
                status,
                role: reported,
                receipt_digest_b64u,
                ..
            } => {
                assert_eq!(reported.as_deref(), Some(role.as_str()));
                assert!(
                    status == "awaiting_role_imports" || status == "verifying",
                    "unexpected status {status}",
                );
                assert!(receipt_digest_b64u.is_some());
            }
            other => panic!("expected a restore session, got {other:?}"),
        }
    }

    // Activation states the operator's acceptance; the trust result itself is
    // whatever the destination established when the manifest was registered.
    let (bootstrap_file, bootstrap_fd) = open_secret(&scratch, "bootstrap-activate", BOOTSTRAP);
    let (activated, exit) = run(
        &SeamsCommandV1::RestoreActivate {
            destination_url: destination.url.clone(),
            acknowledge_offline_trust: true,
            bootstrap: seams_cli::RestoreAuthorizationV1::Bootstrap(SecretInputV1::FileDescriptor(
                bootstrap_fd,
            )),
            session_file: scratch.path("activation-session.json"),
        },
        &transport,
    );
    drop(bootstrap_file);
    assert_eq!(exit, SeamsExitCodeV1::Success, "{activated:?}");
    match activated {
        SeamsResultV1::RestoreSession {
            status,
            destination_lineage_id,
            ..
        } => {
            assert_eq!(status, "active");
            assert_eq!(
                destination_lineage_id.as_deref(),
                Some(Base64UrlUnpadded::encode_string(&destination.lineage).as_str())
            );
        }
        other => panic!("expected an active session, got {other:?}"),
    }

    // Both roles are installed, the source was never contacted, and the
    // bootstrap credential was presented exactly once per invocation.
    assert_eq!(destination.imports.borrow().len(), 2);
    assert_eq!(*transport.source_requests.borrow(), 0);
    assert_eq!(*destination.bootstrap_presentations.borrow(), 4);
    let (_, retried_exit) = run(
        &SeamsCommandV1::RestoreActivate {
            destination_url: destination.url.clone(),
            acknowledge_offline_trust: true,
            bootstrap: seams_cli::RestoreAuthorizationV1::Bootstrap(SecretInputV1::FileDescriptor(
                u16::MAX,
            )),
            session_file: scratch.path("activation-session.json"),
        },
        &transport,
    );
    assert_eq!(retried_exit, SeamsExitCodeV1::Success);
    assert_eq!(
        *destination.bootstrap_presentations.borrow(),
        4,
        "retry presented destroyed bootstrap authority"
    );
    let (_, foreign_exit) = run(
        &SeamsCommandV1::RestoreActivate {
            destination_url: "https://other-destination.example".to_owned(),
            acknowledge_offline_trust: true,
            bootstrap: seams_cli::RestoreAuthorizationV1::Bootstrap(SecretInputV1::FileDescriptor(
                u16::MAX,
            )),
            session_file: scratch.path("activation-session.json"),
        },
        &transport,
    );
    assert_ne!(foreign_exit, SeamsExitCodeV1::Success);
}

#[test]
fn a_refused_manifest_registration_fails_the_start_command() {
    let scratch = Scratch::new("manifest-refused");
    let destination =
        Destination::new(0x66, "https://destination-one.example").refusing_manifests();
    let transport = DrillTransport::new(vec![&destination]);

    let (result, exit) = restore_start(&scratch, &transport, &destination);
    // A session without a manifest cannot accept a share, so this is the
    // failure of the command, not a bare session reported as success.
    assert_eq!(exit, SeamsExitCodeV1::RestoreStateFailure, "{result:?}");
    match result {
        SeamsResultV1::Failed {
            category, message, ..
        } => {
            assert_eq!(category, "restore_state_failure");
            assert!(
                message.contains("manifest_not_for_this_destination"),
                "{message}"
            );
        }
        other => panic!("expected a failure, got {other:?}"),
    }
}

#[test]
fn the_same_files_restore_two_destinations_with_isolated_lineages() {
    let scratch = Scratch::new("clone-isolation");
    let first = Destination::new(0x66, "https://destination-one.example");
    let second = Destination::new(0x77, "https://destination-two.example");
    let transport = DrillTransport::new(vec![&first, &second]);
    let key_a = key_file(
        &scratch,
        TwoPartyDeriverRole::DeriverA,
        DERIVER_A_KEY_MATERIAL,
    );
    let key_b = key_file(
        &scratch,
        TwoPartyDeriverRole::DeriverB,
        DERIVER_B_KEY_MATERIAL,
    );

    for destination in [&first, &second] {
        for (role, key) in [
            (TwoPartyDeriverRole::DeriverA, &key_a),
            (TwoPartyDeriverRole::DeriverB, &key_b),
        ] {
            let result = restore_role(&scratch, &transport, destination, role, key);
            assert!(
                matches!(result, SeamsResultV1::RestoreSession { .. }),
                "unexpected result {result:?}",
            );
        }
    }

    // Each destination received its own two envelopes.
    assert_eq!(first.imports.borrow().len(), 2);
    assert_eq!(second.imports.borrow().len(), 2);

    // Each envelope is bound, in its authenticated binding, to the lineage of
    // the destination it was resealed for. A clone's import cannot be replayed
    // into another destination because the binding names the wrong lineage.
    for destination in [&first, &second] {
        for (role, bytes) in destination.imports.borrow().iter() {
            let envelope = TenantRootRestoreImportEnvelopeV1::decode(bytes).expect("envelope");
            assert_eq!(envelope.binding().role().as_str(), role);
            assert_eq!(
                envelope.binding().destination_lineage().as_bytes(),
                &destination.lineage,
            );
        }
    }

    // Neither destination's envelope carries the recovery key material.
    for destination in [&first, &second] {
        for (_, envelope) in destination.imports.borrow().iter() {
            assert!(!envelope
                .windows(8)
                .any(|window| window == &DERIVER_A_KEY_MATERIAL[..8]));
            assert!(!envelope
                .windows(8)
                .any(|window| window == &DERIVER_B_KEY_MATERIAL[..8]));
        }
    }
    assert_eq!(*transport.source_requests.borrow(), 0);
}

#[test]
fn the_other_roles_key_file_is_refused_before_the_share_is_opened() {
    let scratch = Scratch::new("wrong-role-key");
    let destination = Destination::new(0x66, "https://destination-one.example");
    let transport = DrillTransport::new(vec![&destination]);
    // Deriver B's key cannot restore Deriver A's share. The refusal is local:
    // the key file names its role, and the tool checks it before opening
    // anything or uploading to the destination.
    let key_b = key_file(
        &scratch,
        TwoPartyDeriverRole::DeriverB,
        DERIVER_B_KEY_MATERIAL,
    );

    let result = restore_role(
        &scratch,
        &transport,
        &destination,
        TwoPartyDeriverRole::DeriverA,
        &key_b,
    );
    match result {
        SeamsResultV1::Failed { category, .. } => {
            assert_eq!(category, "key_provider_failure");
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert!(destination.imports.borrow().is_empty());
}

#[test]
fn bundled_restore_registers_imports_and_reuses_private_retry_state() {
    let scratch = Scratch::new("bundled-restore");
    let destination = Destination::new(0x66, "https://same-site.example");
    let transport = DrillTransport::new(vec![&destination]);
    for name in ["manifest.json", "deriver-a.backup"] {
        std::fs::copy(fixture(name), scratch.path(name)).unwrap();
    }
    let key = key_file(
        &scratch,
        TwoPartyDeriverRole::DeriverA,
        DERIVER_A_KEY_MATERIAL,
    );
    let default_key = scratch.path("deriver-a-wrapper.key");
    std::fs::rename(key, &default_key).unwrap();
    let (_bootstrap, bootstrap_fd) = open_secret(&scratch, "bootstrap", BOOTSTRAP);
    let command = SeamsCommandV1::Restore {
        destination_url: destination.url.clone(),
        role: TwoPartyDeriverRole::DeriverA,
        folder: scratch.root.clone(),
        key_file: default_key.clone(),
        trust_bundle: None,

        bootstrap: seams_cli::RestoreAuthorizationV1::Bootstrap(SecretInputV1::FileDescriptor(
            bootstrap_fd,
        )),
    };
    let (result, exit) = run(&command, &transport);
    assert_eq!(exit, SeamsExitCodeV1::Success, "{}", result.render_text());
    assert_eq!(*destination.bootstrap_presentations.borrow(), 1);
    std::fs::remove_file(default_key).unwrap();
    let (result, exit) = run(&command, &transport);
    assert_eq!(exit, SeamsExitCodeV1::Success, "{}", result.render_text());
    assert_eq!(*destination.bootstrap_presentations.borrow(), 1);
    let imports = destination.imports.borrow();
    assert_eq!(imports.len(), 2);
    assert_eq!(imports[0], imports[1]);
    drop(imports);

    std::fs::copy(
        fixture("deriver-b.backup"),
        scratch.path("deriver-b.backup"),
    )
    .unwrap();
    let key_b = key_file(
        &scratch,
        TwoPartyDeriverRole::DeriverB,
        DERIVER_B_KEY_MATERIAL,
    );
    let (_bootstrap_b, bootstrap_b_fd) = open_secret(&scratch, "bootstrap-b", BOOTSTRAP);
    let (result, exit) = run(
        &SeamsCommandV1::Restore {
            destination_url: destination.url.clone(),
            role: TwoPartyDeriverRole::DeriverB,
            folder: scratch.root.clone(),
            key_file: key_b,
            trust_bundle: None,

            bootstrap: seams_cli::RestoreAuthorizationV1::Bootstrap(SecretInputV1::FileDescriptor(
                bootstrap_b_fd,
            )),
        },
        &transport,
    );
    assert_eq!(exit, SeamsExitCodeV1::Success, "{}", result.render_text());
    assert!(result
        .render_text()
        .contains("SUCCESS: Your recovery share was imported."));
    assert_ne!(*destination.status.borrow(), "active");

    let (_activation_secret, activation_fd) = open_secret(&scratch, "activation", BOOTSTRAP);
    let (result, exit) = run(
        &SeamsCommandV1::RestoreActivate {
            destination_url: destination.url.clone(),
            acknowledge_offline_trust: true,
            bootstrap: seams_cli::RestoreAuthorizationV1::Bootstrap(SecretInputV1::FileDescriptor(
                activation_fd,
            )),
            session_file: scratch.path("activation-session.json"),
        },
        &transport,
    );
    assert_eq!(exit, SeamsExitCodeV1::Success, "{}", result.render_text());
    assert_eq!(*destination.status.borrow(), "active");
}
