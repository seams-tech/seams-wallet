//! Console operations against a scripted transport.
//!
//! Everything above the socket is exercised here: request shapes, credential
//! handling, response parsing, and the failures a recovery operator must be
//! able to tell apart.

use std::cell::RefCell;
use std::collections::BTreeMap;

use seams_cli::{
    issue_role_import_key_v1, open_restore_session_v1, read_console_rotation_v1,
    read_console_status_v1, read_restore_status_v1, start_console_rotation_v1, ConsoleCredentialV1,
    ConsoleEndpointV1, ConsoleErrorKindV1, ConsoleRequestV1, ConsoleResponseV1,
    ConsoleRotationOutcomeV1, ConsoleTransportErrorV1, ConsoleTransportV1, DestinationBootstrapV1,
    UnavailableConsoleTransportV1, CONSOLE_ENVIRONMENT_HEADER_V1, DESTINATION_BOOTSTRAP_HEADER_V1,
    RESTORE_SESSION_HEADER_V1,
};

const BASE_URL: &str = "https://console.example";
const TOKEN: &str = "console-session-token";
const BOOTSTRAP: &str = "destination-bootstrap-token";
const SESSION: &str = "restore-session-token";

/// A transport that records what it was asked to send and replies from a script.
struct ScriptedTransport {
    sent: RefCell<Vec<ConsoleRequestV1>>,
    responses: RefCell<Vec<Result<ConsoleResponseV1, ConsoleTransportErrorV1>>>,
}

impl ScriptedTransport {
    fn new(responses: Vec<Result<ConsoleResponseV1, ConsoleTransportErrorV1>>) -> Self {
        Self {
            sent: RefCell::new(Vec::new()),
            responses: RefCell::new(responses),
        }
    }

    fn json(status: u16, body: &str) -> Result<ConsoleResponseV1, ConsoleTransportErrorV1> {
        Ok(ConsoleResponseV1 {
            status,
            body: body.as_bytes().to_vec(),
            content_type: Some("application/json".to_owned()),
        })
    }
}

impl ConsoleTransportV1 for ScriptedTransport {
    fn send(
        &self,
        request: ConsoleRequestV1,
    ) -> Result<ConsoleResponseV1, ConsoleTransportErrorV1> {
        self.sent.borrow_mut().push(request);
        self.responses
            .borrow_mut()
            .pop()
            .unwrap_or_else(|| Err(ConsoleTransportErrorV1::new("no scripted response", false)))
    }
}

fn endpoint() -> ConsoleEndpointV1 {
    ConsoleEndpointV1::new(
        BASE_URL,
        ConsoleCredentialV1::new(TOKEN).expect("credential"),
    )
    .expect("endpoint")
    .for_environment("production")
}

const RESTORE_IMPORT_OPERATION_ID: &str = "restore-operation-1";
const RESTORE_IMPORT_PUBLIC_KEY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RESTORE_DESTINATION_FINGERPRINT: &str = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const RESTORE_DESTINATION_LINEAGE: &str = "AgICAgICAgICAgICAgICAgICAgICAg";
const RESTORE_SESSION_ID: &str = "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw";
const RESTORE_OPERATION_DIGEST: &str = "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ";
const RESTORE_COMMAND_DIGEST: &str = "BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU";

fn restore_import_key_response(
    operation_id: &str,
    role: &str,
    replayed: bool,
) -> Result<ConsoleResponseV1, ConsoleTransportErrorV1> {
    ScriptedTransport::json(
        200,
        &format!(
            r#"{{"ok":true,"importKeyId":"import-key-1","importPublicKeyB64u":"{RESTORE_IMPORT_PUBLIC_KEY}","destinationFingerprintB64u":"{RESTORE_DESTINATION_FINGERPRINT}","destinationLineageB64u":"{RESTORE_DESTINATION_LINEAGE}","restoreSessionIdB64u":"{RESTORE_SESSION_ID}","operationId":"{operation_id}","operationDigestB64u":"{RESTORE_OPERATION_DIGEST}","commandDigestB64u":"{RESTORE_COMMAND_DIGEST}","role":"{role}","generation":1,"issuedAtMs":1788000000000,"expiresAtMs":1788000900000,"replayed":{replayed}}}"#,
        ),
    )
}

const STATUS_BODY: &str = r#"{
  "ok": true,
  "status": {
    "identity": {
      "orgId": "org-1",
      "projectId": "project-1",
      "envId": "production",
      "signingRootId": "root-1",
      "signingRootVersion": "1"
    },
    "custodyLineageId": "lineage-1",
    "lifecycleRevision": 7,
    "operationalShares": {
      "activeEpoch": 4,
      "rootCommitmentFingerprintB64u": "AAAA",
      "deriverAStatus": "healthy",
      "deriverBStatus": "healthy",
      "lastCompletedRotationAt": null,
      "nextScheduledRotationAt": null,
      "securityProfile": "managed_healing_v1",
      "job": { "status": "installing", "jobId": "job-1", "requestedAt": "2026-09-05T00:00:00Z" }
    },
    "recoveryBackup": { "status": "ready" },
    "restore": null,
    "trustLevel": { "kind": "not_verified" }
  }
}"#;

#[test]
fn a_plaintext_console_url_is_refused() {
    let credential = ConsoleCredentialV1::new(TOKEN).expect("credential");
    assert!(ConsoleEndpointV1::new("http://console.example", credential.clone()).is_err());
    assert!(ConsoleEndpointV1::new(BASE_URL, credential).is_ok());
    assert!(ConsoleCredentialV1::new("   ").is_err());
}

#[test]
fn the_credential_and_environment_travel_in_headers_and_never_in_a_result() {
    let transport = ScriptedTransport::new(vec![ScriptedTransport::json(200, STATUS_BODY)]);
    let report = read_console_status_v1(&transport, &endpoint()).expect("status");

    let sent = transport.sent.borrow();
    let request = sent.first().expect("one request");
    assert_eq!(request.method, "GET");
    assert_eq!(
        request.url,
        format!("{BASE_URL}/console/tenant-root/security/status")
    );
    assert_eq!(
        request.headers.get("authorization").map(String::as_str),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    // The environment the operator named goes to the console to be checked,
    // never merely echoed back as fact.
    assert_eq!(
        request
            .headers
            .get(CONSOLE_ENVIRONMENT_HEADER_V1)
            .map(String::as_str),
        Some("production")
    );
    assert!(request.body.is_none());

    // The credential is not in the parsed result, and not in its rendering.
    let rendered = format!("{report:?}");
    assert!(!rendered.contains(TOKEN));
    assert_eq!(report.environment_id, "production");
    assert_eq!(report.lifecycle_revision, 7);
    assert_eq!(report.operational_shares.active_epoch, 4);
    let job = report.operational_shares.job.expect("job");
    assert_eq!(job.job_id, "job-1");
    assert_eq!(job.status, "installing");
    assert_eq!(report.recovery_backup_status, "ready");

    // The credential type itself refuses to render.
    let credential = ConsoleCredentialV1::new(TOKEN).expect("credential");
    assert!(format!("{credential:?}").contains("[redacted]"));
    assert!(!format!("{credential:?}").contains(TOKEN));
}

#[test]
fn a_rotation_submits_its_operation_id_and_polls_the_same_one() {
    let transport = ScriptedTransport::new(vec![ScriptedTransport::json(
        200,
        r#"{"ok":true,"status":"ACTIVE","activationReceiptDigestB64u":"receipt-1","lifecycleRevision":8}"#,
    )]);
    let started =
        start_console_rotation_v1(&transport, &endpoint(), "operation-1").expect("rotation");
    assert_eq!(started.operation_id, "operation-1");
    assert!(matches!(
        started.outcome,
        ConsoleRotationOutcomeV1::Completed {
            lifecycle_revision: Some(8),
            ..
        }
    ));

    let sent = transport.sent.borrow();
    let request = sent.first().expect("one request");
    assert_eq!(request.method, "POST");
    // The sole rotation mutation; the security routes read.
    assert!(request.url.ends_with("/console/tenant-root/refresh"));
    let body = String::from_utf8(request.body.clone().expect("body")).expect("utf-8");
    assert!(body.contains("operationId"));
    assert!(body.contains("operation-1"));

    let invalid = start_console_rotation_v1(&transport, &endpoint(), "  ").expect_err("blank id");
    assert_eq!(invalid.kind(), ConsoleErrorKindV1::InvalidInput);

    // Polling names the same operation id the submission used.
    let read = ScriptedTransport::new(vec![ScriptedTransport::json(
        200,
        r#"{"ok":true,"operation":{"operationId":"operation-1","status":"accepted","failureCode":null,"acceptedResult":null}}"#,
    )]);
    let job = read_console_rotation_v1(&read, &endpoint(), "operation-1")
        .expect("rotation read")
        .expect("operation");
    assert_eq!(job.job_id, "operation-1");
    assert_eq!(job.status, "accepted");
    let polled = read.sent.borrow();
    let poll = polled.first().expect("request");
    assert_eq!(poll.method, "GET");
    assert!(poll
        .url
        .ends_with("/console/tenant-root/security/rotation?operationId=operation-1"));
}

#[test]
fn a_cooldown_and_a_running_rotation_are_answers_rather_than_failures() {
    let throttled = ScriptedTransport::new(vec![ScriptedTransport::json(
        429,
        r#"{"ok":false,"code":"tenant_root_refresh_throttled","message":"once per hour","retryAtMs":1788000000000}"#,
    )]);
    let outcome = start_console_rotation_v1(&throttled, &endpoint(), "operation-2")
        .expect("throttled is not an error")
        .outcome;
    assert!(matches!(
        outcome,
        ConsoleRotationOutcomeV1::Throttled {
            retry_at_ms: 1_788_000_000_000
        }
    ));

    let running = ScriptedTransport::new(vec![ScriptedTransport::json(
        409,
        r#"{"ok":false,"code":"tenant_root_refresh_in_progress","message":"already running"}"#,
    )]);
    let outcome = start_console_rotation_v1(&running, &endpoint(), "operation-3")
        .expect("in progress is not an error")
        .outcome;
    assert!(matches!(
        outcome,
        ConsoleRotationOutcomeV1::InProgress { .. }
    ));
}

#[test]
fn authorization_refusal_and_server_failures_are_told_apart() {
    let refused = ScriptedTransport::new(vec![ScriptedTransport::json(
        403,
        r#"{"ok":false,"code":"step_up_required","message":"server text"}"#,
    )]);
    let error = read_console_status_v1(&refused, &endpoint()).expect_err("refused");
    assert_eq!(error.kind(), ConsoleErrorKindV1::Unauthorized);
    assert!(error.message().contains("not authorized"));
    assert!(!error.retryable());
    // Server-supplied text is not echoed back to the operator.
    assert!(!error.message().contains("server text"));

    // A state refusal carries its stable code and nothing else from the body.
    let conflicted = ScriptedTransport::new(vec![ScriptedTransport::json(
        409,
        r#"{"ok":false,"code":"environment_mismatch","environmentId":"staging","message":"server text"}"#,
    )]);
    let conflict = read_console_status_v1(&conflicted, &endpoint()).expect_err("conflict");
    assert_eq!(conflict.kind(), ConsoleErrorKindV1::Refused);
    assert_eq!(conflict.code(), Some("environment_mismatch"));
    assert!(conflict.message().contains("environment_mismatch"));
    assert!(!conflict.message().contains("server text"));
    assert!(!conflict.message().contains("staging"));

    // A code that is not identifier-shaped is not repeated either.
    let odd = ScriptedTransport::new(vec![ScriptedTransport::json(
        409,
        r#"{"ok":false,"error":{"kind":"<script>alert(1)</script>"}}"#,
    )]);
    let unnamed = read_console_status_v1(&odd, &endpoint()).expect_err("odd code");
    assert_eq!(unnamed.code(), None);
    assert!(!unnamed.message().contains("script"));

    let unavailable = ScriptedTransport::new(vec![ScriptedTransport::json(503, "{}")]);
    let transient = read_console_status_v1(&unavailable, &endpoint()).expect_err("unavailable");
    assert_eq!(transient.kind(), ConsoleErrorKindV1::Unavailable);
    assert!(transient.retryable());

    let malformed = ScriptedTransport::new(vec![ScriptedTransport::json(200, r#"{"ok":true}"#)]);
    let unexpected = read_console_status_v1(&malformed, &endpoint()).expect_err("malformed");
    assert_eq!(unexpected.kind(), ConsoleErrorKindV1::UnexpectedResponse);
    assert!(unexpected.message().contains("unexpected response"));
    assert!(!unexpected.retryable());

    let oversized = ScriptedTransport::new(vec![Ok(ConsoleResponseV1 {
        status: 200,
        body: vec![b'a'; 256 * 1024 + 1],
        content_type: Some("application/json".to_owned()),
    })]);
    assert!(read_console_status_v1(&oversized, &endpoint())
        .expect_err("oversized")
        .message()
        .contains("size limit"));
}

#[test]
fn this_build_has_no_transport_and_says_so() {
    let error = read_console_status_v1(&UnavailableConsoleTransportV1, &endpoint())
        .expect_err("no transport");
    assert!(error.message().contains("no console transport"));
    assert!(error
        .message()
        .contains("/console/tenant-root/security/status"));
    assert!(!error.retryable());
}

#[test]
fn a_transport_failure_keeps_its_retryability() {
    let transport = ScriptedTransport::new(vec![Err(ConsoleTransportErrorV1::new(
        "connection reset",
        true,
    ))]);
    let error = read_console_status_v1(&transport, &endpoint()).expect_err("transport failure");
    assert!(error.retryable());
    assert!(error.message().contains("connection reset"));

    let headers: BTreeMap<String, String> = transport
        .sent
        .borrow()
        .first()
        .expect("one request")
        .headers
        .clone();
    assert!(headers.contains_key("accept"));
}

#[test]
fn the_bootstrap_credential_is_presented_once_and_the_session_thereafter() {
    // Responses pop from the end: the session opening comes first.
    let transport = ScriptedTransport::new(vec![
        ScriptedTransport::json(
            200,
            r#"{"ok":true,"session":{"status":"awaiting_manifest","sessionId":"session-1","expiresAt":"2026-09-06T00:00:00Z","destinationFingerprintB64u":"AAAA"}}"#,
        ),
        ScriptedTransport::json(
            200,
            &format!(
                r#"{{"ok":true,"sessionToken":"{SESSION}","expiresAt":"2026-09-05T00:30:00Z"}}"#
            ),
        ),
    ]);
    let destination = DestinationBootstrapV1::new(
        "https://destination.example",
        ConsoleCredentialV1::new(BOOTSTRAP).expect("bootstrap"),
    )
    .expect("destination");
    let session = open_restore_session_v1(&transport, &destination).expect("session");
    assert_eq!(session.expires_at(), "2026-09-05T00:30:00Z");

    let status = read_restore_status_v1(&transport, &session).expect("status");
    assert_eq!(status.status, "awaiting_manifest");
    assert_eq!(status.session_id.as_deref(), Some("session-1"));

    let sent = transport.sent.borrow();
    let opening = &sent[0];
    assert_eq!(opening.method, "POST");
    assert!(opening
        .url
        .ends_with("/console/tenant-root/security/restore/bootstrap-session"));
    assert_eq!(
        opening
            .headers
            .get(DESTINATION_BOOTSTRAP_HEADER_V1)
            .map(String::as_str),
        Some(BOOTSTRAP)
    );
    assert!(!opening.headers.contains_key(RESTORE_SESSION_HEADER_V1));
    assert!(!opening.headers.contains_key("authorization"));

    let later = &sent[1];
    assert_eq!(later.method, "GET");
    assert!(later
        .url
        .ends_with("/console/tenant-root/security/restore/status"));
    assert_eq!(
        later
            .headers
            .get(RESTORE_SESSION_HEADER_V1)
            .map(String::as_str),
        Some(SESSION)
    );
    // The bootstrap credential does not travel again.
    assert!(!later.headers.contains_key(DESTINATION_BOOTSTRAP_HEADER_V1));
    assert!(later.body.is_none());
    assert!(!later.headers.contains_key("content-type"));

    // Neither secret renders through the session's debug output.
    let rendered = format!("{session:?}");
    assert!(!rendered.contains(BOOTSTRAP));
    assert!(!rendered.contains(SESSION));

    // A plaintext destination is refused before any credential is presented.
    assert!(DestinationBootstrapV1::new(
        "http://destination.example",
        ConsoleCredentialV1::new(BOOTSTRAP).expect("bootstrap"),
    )
    .is_err());
}

#[test]
fn a_restore_import_key_reuses_the_caller_operation_id_and_returns_the_session_id() {
    // Responses pop from the end: session opening, then two attempts using
    // the same durable caller operation ID.
    let transport = ScriptedTransport::new(vec![
        restore_import_key_response(RESTORE_IMPORT_OPERATION_ID, "deriver_a", true),
        restore_import_key_response(RESTORE_IMPORT_OPERATION_ID, "deriver_a", false),
        ScriptedTransport::json(
            200,
            r#"{"ok":true,"sessionToken":"restore-session-token","expiresAt":"2026-09-05T00:30:00Z"}"#,
        ),
    ]);
    let destination = DestinationBootstrapV1::new(
        "https://destination.example",
        ConsoleCredentialV1::new(BOOTSTRAP).expect("bootstrap"),
    )
    .expect("destination");
    let session = open_restore_session_v1(&transport, &destination).expect("session");

    let first = issue_role_import_key_v1(
        &transport,
        &session,
        "deriver_a",
        RESTORE_IMPORT_OPERATION_ID,
    )
    .expect("first issuance");
    assert_eq!(first.restore_session_id_b64u, RESTORE_SESSION_ID);
    assert_eq!(first.operation_id, RESTORE_IMPORT_OPERATION_ID);
    assert_eq!(first.operation_digest_b64u, RESTORE_OPERATION_DIGEST);
    assert_eq!(first.command_digest_b64u, RESTORE_COMMAND_DIGEST);
    assert_eq!(first.role, "deriver_a");
    assert_eq!(first.generation, 1);
    assert!(!first.replayed);

    let replay = issue_role_import_key_v1(
        &transport,
        &session,
        "deriver_a",
        RESTORE_IMPORT_OPERATION_ID,
    )
    .expect("replay");
    assert_eq!(replay.restore_session_id_b64u, RESTORE_SESSION_ID);
    assert_eq!(replay.operation_id, RESTORE_IMPORT_OPERATION_ID);
    assert!(replay.replayed);

    let invalid = issue_role_import_key_v1(&transport, &session, "deriver_a", "  ")
        .expect_err("blank operation ID");
    assert_eq!(invalid.kind(), ConsoleErrorKindV1::InvalidInput);

    let sent = transport.sent.borrow();
    assert_eq!(sent.len(), 3);
    for request in sent.iter().skip(1) {
        assert_eq!(request.method, "POST");
        assert!(request
            .url
            .ends_with("/console/tenant-root/security/restore/import-key"));
        let body: serde_json::Value =
            serde_json::from_slice(request.body.as_ref().expect("request body"))
                .expect("request JSON");
        assert_eq!(
            body,
            serde_json::json!({
                "role": "deriver_a",
                "operationId": RESTORE_IMPORT_OPERATION_ID,
            })
        );
        assert_eq!(
            request
                .headers
                .get(RESTORE_SESSION_HEADER_V1)
                .map(String::as_str),
            Some(SESSION),
        );
        assert!(!request
            .headers
            .contains_key(DESTINATION_BOOTSTRAP_HEADER_V1));
    }

    for (response_operation_id, response_role, expected_message) in [
        ("different-operation", "deriver_a", "different operation"),
        (RESTORE_IMPORT_OPERATION_ID, "deriver_b", "different role"),
    ] {
        let mismatch_transport = ScriptedTransport::new(vec![
            restore_import_key_response(response_operation_id, response_role, false),
            ScriptedTransport::json(
                200,
                r#"{"ok":true,"sessionToken":"restore-session-token","expiresAt":"2026-09-05T00:30:00Z"}"#,
            ),
        ]);
        let mismatch_destination = DestinationBootstrapV1::new(
            "https://destination.example",
            ConsoleCredentialV1::new(BOOTSTRAP).expect("bootstrap"),
        )
        .expect("destination");
        let mismatch_session =
            open_restore_session_v1(&mismatch_transport, &mismatch_destination).expect("session");
        let error = issue_role_import_key_v1(
            &mismatch_transport,
            &mismatch_session,
            "deriver_a",
            RESTORE_IMPORT_OPERATION_ID,
        )
        .expect_err("mismatched response");
        assert_eq!(error.kind(), ConsoleErrorKindV1::UnexpectedResponse);
        assert!(error.message().contains(expected_message));
    }
}
