//! Typed console operations over the transport boundary.
//!
//! Responses are parsed once into exact shapes. A partial or unknown response
//! is a failure, never a partly-populated result: a recovery tool that guesses
//! at what the server meant is worse than one that stops.
//!
//! Two credentials, two types. A console session credential belongs to the
//! *source* deployment and authorizes reads, rotation, enrolment, and
//! downloads. A destination bootstrap credential belongs to an empty
//! destination; it is presented exactly once, to open a 30-minute restore
//! administration session, and every other destination request carries that
//! session instead.

use std::collections::BTreeMap;

use serde::Deserialize;
use zeroize::Zeroizing;

use crate::transport::{
    ConsoleRequestV1, ConsoleResponseV1, ConsoleTransportErrorV1, ConsoleTransportV1,
};

/// Maximum response bytes accepted before parsing.
pub const CONSOLE_RESPONSE_MAX_BYTES_V1: usize = 256 * 1024;

const STATUS_PATH: &str = "/console/tenant-root/security/status";
/// The sole rotation mutation. The security routes read; they never rotate.
const ROTATION_PATH: &str = "/console/tenant-root/refresh";
/// Polling reads the durable operation by the id this command submitted.
const ROTATION_STATUS_PATH: &str = "/console/tenant-root/security/rotation";
const ROLE_PACKAGE_PATH: &str = "/console/tenant-root/security/backup/package";
const MANIFEST_PATH: &str = "/console/tenant-root/security/manifest";
const DURABLE_VERIFICATION_PATH: &str = "/console/tenant-root/security/backup/durable-verification";
const RECIPIENT_CHALLENGE_PATH: &str = "/console/tenant-root/security/recipients/challenge";
const RECIPIENT_CONFIRM_PATH: &str = "/console/tenant-root/security/recipients/confirm";

/// The header naming the environment a console command must act on.
///
/// The console resolves the environment from the session and refuses the
/// request when this does not match; the header cannot select or override.
pub const CONSOLE_ENVIRONMENT_HEADER_V1: &str = "x-seams-environment";

/// What kind of failure one console operation met.
///
/// An operator responds to each differently, and each maps to its own exit
/// code, so the distinction is kept rather than flattened into a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsoleErrorKindV1 {
    /// Local input was unusable before any request was sent.
    InvalidInput,
    /// The service refused the credential or the capability.
    Unauthorized,
    /// The service refused the operation for its current state.
    Refused,
    /// The request did not complete.
    Unavailable,
    /// The service answered with something this tool does not understand.
    UnexpectedResponse,
}

/// Why one console operation failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsoleErrorV1 {
    message: String,
    kind: ConsoleErrorKindV1,
    code: Option<String>,
    retryable: bool,
}

impl ConsoleErrorV1 {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            kind: ConsoleErrorKindV1::InvalidInput,
            code: None,
            retryable: false,
        }
    }

    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            kind: ConsoleErrorKindV1::Unauthorized,
            code: None,
            retryable: false,
        }
    }

    fn refused(message: impl Into<String>, code: Option<String>) -> Self {
        Self {
            message: message.into(),
            kind: ConsoleErrorKindV1::Refused,
            code,
            retryable: false,
        }
    }

    fn unavailable(message: impl Into<String>, retryable: bool) -> Self {
        Self {
            message: message.into(),
            kind: ConsoleErrorKindV1::Unavailable,
            code: None,
            retryable,
        }
    }

    fn unexpected(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            kind: ConsoleErrorKindV1::UnexpectedResponse,
            code: None,
            retryable: false,
        }
    }

    /// Returns the redacted operator-facing message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Returns what kind of failure this was.
    pub const fn kind(&self) -> ConsoleErrorKindV1 {
        self.kind
    }

    /// Returns the stable refusal code the service named, when it named one.
    pub fn code(&self) -> Option<&str> {
        self.code.as_deref()
    }

    /// Returns whether retrying could succeed.
    pub const fn retryable(&self) -> bool {
        self.retryable
    }
}

impl From<ConsoleTransportErrorV1> for ConsoleErrorV1 {
    fn from(error: ConsoleTransportErrorV1) -> Self {
        Self::unavailable(error.message().to_owned(), error.retryable())
    }
}

/// A console session credential, read from a dedicated descriptor.
///
/// It is redacted in `Debug`, zeroized on drop, and never appears in a result
/// or a diagnostic.
#[derive(Clone)]
pub struct ConsoleCredentialV1(Zeroizing<String>);

impl core::fmt::Debug for ConsoleCredentialV1 {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_tuple("ConsoleCredentialV1")
            .field(&"[redacted]")
            .finish()
    }
}

impl ConsoleCredentialV1 {
    /// Wraps one console session credential.
    pub fn new(value: impl Into<String>) -> Result<Self, ConsoleErrorV1> {
        let value = Zeroizing::new(value.into());
        if value.trim().is_empty() {
            return Err(ConsoleErrorV1::invalid("console credential is empty"));
        }
        Ok(Self(value))
    }
}

fn require_https(
    base_url: impl Into<String>,
    what: &'static str,
) -> Result<String, ConsoleErrorV1> {
    let base_url = base_url.into();
    let trimmed = base_url.trim_end_matches('/').to_owned();
    if !trimmed.starts_with("https://") {
        return Err(ConsoleErrorV1::invalid(format!(
            "the {what} must use https"
        )));
    }
    Ok(trimmed)
}

/// One resolved console endpoint and credential.
#[derive(Debug, Clone)]
pub struct ConsoleEndpointV1 {
    base_url: String,
    credential: ConsoleCredentialV1,
    environment: Option<String>,
}

impl ConsoleEndpointV1 {
    /// Creates one endpoint.
    ///
    /// A plaintext base URL is refused: the console credential and every
    /// ciphertext response would otherwise cross the network in the clear.
    pub fn new(
        base_url: impl Into<String>,
        credential: ConsoleCredentialV1,
    ) -> Result<Self, ConsoleErrorV1> {
        Ok(Self {
            base_url: require_https(base_url, "console base URL")?,
            credential,
            environment: None,
        })
    }

    /// Names the environment every request must act on.
    ///
    /// The console compares this to the environment its session resolves and
    /// refuses a mismatch, so a command aimed at one environment can never
    /// silently act on another.
    pub fn for_environment(mut self, environment: impl Into<String>) -> Self {
        self.environment = Some(environment.into());
        self
    }

    fn request(&self, method: &'static str, path: &str, body: Option<Vec<u8>>) -> ConsoleRequestV1 {
        let mut headers = BTreeMap::new();
        headers.insert("accept".to_owned(), "application/json".to_owned());
        headers.insert(
            "authorization".to_owned(),
            format!("Bearer {}", self.credential.0.as_str()),
        );
        if let Some(environment) = &self.environment {
            headers.insert(
                CONSOLE_ENVIRONMENT_HEADER_V1.to_owned(),
                environment.clone(),
            );
        }
        if body.is_some() {
            headers.insert("content-type".to_owned(), "application/json".to_owned());
        }
        ConsoleRequestV1 {
            method,
            url: format!("{}{path}", self.base_url),
            headers,
            body,
        }
    }
}

/// Redacted derivation-root status for one environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsoleStatusReportV1 {
    /// The environment the console resolved for the session.
    pub environment_id: String,
    /// Current lifecycle revision.
    pub lifecycle_revision: u64,
    /// Operational-share summary.
    pub operational_shares: ConsoleOperationalSharesV1,
    /// The recovery backup branch label.
    pub recovery_backup_status: String,
}

/// Operational-share health as the CLI reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsoleOperationalSharesV1 {
    /// The active epoch.
    pub active_epoch: u64,
    /// Deriver A health.
    pub deriver_a_status: String,
    /// Deriver B health.
    pub deriver_b_status: String,
    /// The rotation job the console holds, when one exists.
    pub job: Option<ConsoleRotationJobV1>,
}

/// One rotation job as the CLI reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsoleRotationJobV1 {
    /// The job identifier.
    pub job_id: String,
    /// The exact job branch.
    pub status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StatusResponseWire {
    ok: bool,
    status: StatusWire,
}

/// The status object. Only the fields this tool reports are read; the
/// lifecycle unions inside are read by their label.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusWire {
    identity: IdentityWire,
    lifecycle_revision: u64,
    operational_shares: OperationalSharesWire,
    recovery_backup: LabelledWire,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentityWire {
    env_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationalSharesWire {
    active_epoch: u64,
    deriver_a_status: String,
    deriver_b_status: String,
    job: Option<JobWire>,
}

/// A rotation job. Its branch-specific evidence fields are not read here.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobWire {
    job_id: String,
    status: String,
}

/// A lifecycle union read by its `status` label only.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LabelledWire {
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RotationResponseWire {
    ok: bool,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    activation_receipt_digest_b64u: Option<String>,
    #[serde(default)]
    lifecycle_revision: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RotationRefusalWire {
    #[serde(default)]
    ok: bool,
    code: String,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    retry_at_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RotationReadResponseWire {
    ok: bool,
    operation: Option<PolledOperationWire>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PolledOperationWire {
    operation_id: String,
    status: String,
    #[serde(default)]
    failure_code: Option<String>,
    #[serde(default)]
    accepted_result: Option<serde_json::Value>,
}

/// One started or replayed rotation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsoleRotationStartV1 {
    /// The operation this rotation belongs to, and the id polling uses.
    pub operation_id: String,
    /// What the console answered.
    pub outcome: ConsoleRotationOutcomeV1,
}

/// The three answers a rotation submission can receive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConsoleRotationOutcomeV1 {
    /// The rotation completed.
    Completed {
        /// The activation receipt, when the console reported one.
        activation_receipt_digest_b64u: Option<String>,
        /// The lifecycle revision after activation.
        lifecycle_revision: Option<u64>,
    },
    /// The hourly limit refused this attempt; retry after the given time.
    Throttled {
        /// When another attempt is permitted.
        retry_at_ms: u64,
    },
    /// A rotation is already running; poll the same operation id.
    InProgress {
        /// The console's refusal code.
        code: String,
    },
}

#[derive(Deserialize)]
struct RefusalWire {
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    error: Option<RefusalErrorWire>,
}

#[derive(Deserialize)]
struct RefusalErrorWire {
    kind: String,
}

/// Extracts the stable refusal code from a refusal body, if it carries one.
///
/// Only a short identifier-shaped code is accepted: the rest of the body may
/// carry server text this tool has not reviewed, and it is never echoed.
fn refusal_code(body: &[u8]) -> Option<String> {
    serde_json::from_slice::<RefusalWire>(body)
        .ok()
        .and_then(|wire| wire.code.or_else(|| wire.error.map(|error| error.kind)))
        .filter(|code| {
            !code.is_empty()
                && code.len() <= 64
                && code
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        })
}

fn parse_json<T>(response: &ConsoleResponseV1, operation: &str) -> Result<T, ConsoleErrorV1>
where
    T: serde::de::DeserializeOwned,
{
    if response.body.len() > CONSOLE_RESPONSE_MAX_BYTES_V1 {
        return Err(ConsoleErrorV1::unexpected(format!(
            "{operation} response exceeds the size limit"
        )));
    }
    match response.status {
        200 => {}
        401 | 403 => {
            return Err(ConsoleErrorV1::unauthorized(format!(
                "{operation} was not authorized (HTTP {})",
                response.status
            )));
        }
        409 | 429 => {
            let code = refusal_code(&response.body);
            return Err(ConsoleErrorV1::refused(
                match &code {
                    Some(code) => format!("{operation} was refused: {code}"),
                    None => format!("{operation} was refused (HTTP {})", response.status),
                },
                code,
            ));
        }
        status if status >= 500 => {
            return Err(ConsoleErrorV1::unavailable(
                format!("{operation} failed with HTTP {status}"),
                true,
            ));
        }
        status => {
            return Err(ConsoleErrorV1::unexpected(format!(
                "{operation} failed with HTTP {status}"
            )));
        }
    }
    serde_json::from_slice::<T>(&response.body).map_err(|_| {
        ConsoleErrorV1::unexpected(format!("{operation} returned an unexpected response"))
    })
}

fn require_ok(ok: bool, operation: &str) -> Result<(), ConsoleErrorV1> {
    if ok {
        Ok(())
    } else {
        Err(ConsoleErrorV1::refused(
            format!("{operation} was refused"),
            None,
        ))
    }
}

fn encode_body(value: &serde_json::Value, what: &str) -> Result<Vec<u8>, ConsoleErrorV1> {
    serde_json::to_vec(value)
        .map_err(|_| ConsoleErrorV1::invalid(format!("could not encode the {what}")))
}

/// Reads the derivation-root status for the selected environment.
pub fn read_console_status_v1(
    transport: &dyn ConsoleTransportV1,
    endpoint: &ConsoleEndpointV1,
) -> Result<ConsoleStatusReportV1, ConsoleErrorV1> {
    let response = transport.send(endpoint.request("GET", STATUS_PATH, None))?;
    let wire: StatusResponseWire = parse_json(&response, "derivation root status")?;
    require_ok(wire.ok, "derivation root status")?;
    Ok(ConsoleStatusReportV1 {
        environment_id: wire.status.identity.env_id,
        lifecycle_revision: wire.status.lifecycle_revision,
        operational_shares: ConsoleOperationalSharesV1 {
            active_epoch: wire.status.operational_shares.active_epoch,
            deriver_a_status: wire.status.operational_shares.deriver_a_status,
            deriver_b_status: wire.status.operational_shares.deriver_b_status,
            job: wire
                .status
                .operational_shares
                .job
                .map(|job| ConsoleRotationJobV1 {
                    job_id: job.job_id,
                    status: job.status,
                }),
        },
        recovery_backup_status: wire.status.recovery_backup.status,
    })
}

/// Starts one operational-share rotation.
pub fn start_console_rotation_v1(
    transport: &dyn ConsoleTransportV1,
    endpoint: &ConsoleEndpointV1,
    operation_id: &str,
) -> Result<ConsoleRotationStartV1, ConsoleErrorV1> {
    if operation_id.trim().is_empty() {
        return Err(ConsoleErrorV1::invalid("operation id is required"));
    }
    let body = encode_body(
        &serde_json::json!({ "operationId": operation_id }),
        "rotation request",
    )?;
    let response = transport.send(endpoint.request("POST", ROTATION_PATH, Some(body)))?;

    // A cooldown and an already-running rotation are answers, not failures. The
    // caller polls the same operation id in both cases, so collapsing them into
    // one error would lose the only thing that tells it what to do next.
    let outcome = match response.status {
        409 | 429 => {
            let refusal: RotationRefusalWire =
                decode_body(&response, "operational share rotation")?;
            match refusal.retry_at_ms {
                Some(retry_at_ms) => ConsoleRotationOutcomeV1::Throttled { retry_at_ms },
                None => ConsoleRotationOutcomeV1::InProgress { code: refusal.code },
            }
        }
        _ => {
            let wire: RotationResponseWire = parse_json(&response, "operational share rotation")?;
            require_ok(wire.ok, "operational share rotation")?;
            ConsoleRotationOutcomeV1::Completed {
                activation_receipt_digest_b64u: wire.activation_receipt_digest_b64u,
                lifecycle_revision: wire.lifecycle_revision,
            }
        }
    };
    Ok(ConsoleRotationStartV1 {
        operation_id: operation_id.to_owned(),
        outcome,
    })
}

/// Decodes a refusal body without treating the status as a hard failure.
fn decode_body<T>(response: &ConsoleResponseV1, operation: &str) -> Result<T, ConsoleErrorV1>
where
    T: serde::de::DeserializeOwned,
{
    if response.body.len() > CONSOLE_RESPONSE_MAX_BYTES_V1 {
        return Err(ConsoleErrorV1::unexpected(format!(
            "{operation} response exceeds the size limit"
        )));
    }
    serde_json::from_slice::<T>(&response.body).map_err(|_| {
        ConsoleErrorV1::unexpected(format!("{operation} returned an unexpected response"))
    })
}

/// Reads the rotation job the console holds, if any.
pub fn read_console_rotation_v1(
    transport: &dyn ConsoleTransportV1,
    endpoint: &ConsoleEndpointV1,
    operation_id: &str,
) -> Result<Option<ConsoleRotationJobV1>, ConsoleErrorV1> {
    if operation_id.trim().is_empty() {
        return Err(ConsoleErrorV1::invalid("operation id is required"));
    }
    // The submitted operation id is the identifier throughout: submit, poll,
    // and retry all name the same operation.
    let path = format!(
        "{ROTATION_STATUS_PATH}?operationId={}",
        encode_query_component(operation_id)
    );
    let response = transport.send(endpoint.request("GET", &path, None))?;
    let wire: RotationReadResponseWire = parse_json(&response, "rotation status")?;
    require_ok(wire.ok, "rotation status")?;
    Ok(wire.operation.map(|operation| ConsoleRotationJobV1 {
        job_id: operation.operation_id,
        status: operation.status,
    }))
}

/// Percent-encodes one query value, so an operation id cannot alter the query.
fn encode_query_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// One proof-of-control challenge the console issued for a recipient key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecipientChallengeV1 {
    /// The challenge the confirmation must answer.
    pub challenge_id_b64u: String,
    /// The sealed challenge envelope bytes.
    pub envelope: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecipientChallengeResponseWire {
    ok: bool,
    challenge_id_b64u: String,
    envelope_b64u: String,
}

/// Opens one proof-of-control challenge for a recipient public key.
pub fn start_recipient_challenge_v1(
    transport: &dyn ConsoleTransportV1,
    endpoint: &ConsoleEndpointV1,
    role: &str,
    recipient_public_key_b64u: &str,
) -> Result<RecipientChallengeV1, ConsoleErrorV1> {
    require_role(role)?;
    let body = encode_body(
        &serde_json::json!({
            "role": role,
            "recipientPublicKeyB64u": recipient_public_key_b64u,
        }),
        "challenge request",
    )?;
    let response =
        transport.send(endpoint.request("POST", RECIPIENT_CHALLENGE_PATH, Some(body)))?;
    let wire: RecipientChallengeResponseWire = parse_json(&response, "recipient challenge")?;
    require_ok(wire.ok, "recipient challenge")?;
    Ok(RecipientChallengeV1 {
        challenge_id_b64u: wire.challenge_id_b64u,
        envelope: decode_artifact(&wire.envelope_b64u, "recipient challenge envelope")?,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecipientConfirmResponseWire {
    ok: bool,
    recipient: StagedRecipientWire,
}

/// A staged recipient. Only the public fields this tool reports are read.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StagedRecipientWire {
    role: String,
    recipient_fingerprint_b64u: String,
}

/// One recipient the console staged after its proof of control passed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecipientEnrolmentV1 {
    /// The role enrolled.
    pub role: String,
    /// The fingerprint the console recorded.
    pub recipient_fingerprint_b64u: String,
}

/// Submits one proof of control; the console stages the recipient.
pub fn confirm_recipient_v1(
    transport: &dyn ConsoleTransportV1,
    endpoint: &ConsoleEndpointV1,
    role: &str,
    challenge_id_b64u: &str,
    confirmation_b64u: &str,
) -> Result<RecipientEnrolmentV1, ConsoleErrorV1> {
    require_role(role)?;
    let body = encode_body(
        &serde_json::json!({
            "role": role,
            "challengeIdB64u": challenge_id_b64u,
            "confirmationB64u": confirmation_b64u,
        }),
        "confirmation",
    )?;
    let response = transport.send(endpoint.request("POST", RECIPIENT_CONFIRM_PATH, Some(body)))?;
    let wire: RecipientConfirmResponseWire = parse_json(&response, "recipient enrolment")?;
    require_ok(wire.ok, "recipient enrolment")?;
    Ok(RecipientEnrolmentV1 {
        role: wire.recipient.role,
        recipient_fingerprint_b64u: wire.recipient.recipient_fingerprint_b64u,
    })
}

/// One downloaded artifact, still ciphertext to this tool.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsoleArtifactV1 {
    /// The artifact bytes exactly as the service sent them.
    pub bytes: Vec<u8>,
    /// The digest the service recorded for this response.
    pub content_digest_b64u: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactResponseWire {
    ok: bool,
    artifact_b64u: String,
    content_digest_b64u: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DurableVerificationResponseWire {
    ok: bool,
}

fn decode_artifact(value: &str, field: &'static str) -> Result<Vec<u8>, ConsoleErrorV1> {
    use base64ct::{Base64UrlUnpadded, Encoding};
    let decoded = Base64UrlUnpadded::decode_vec(value)
        .map_err(|_| ConsoleErrorV1::unexpected(format!("{field} is not canonical base64url")))?;
    if Base64UrlUnpadded::encode_string(&decoded) != value {
        return Err(ConsoleErrorV1::unexpected(format!(
            "{field} is not canonical base64url"
        )));
    }
    Ok(decoded)
}

fn require_role(role: &str) -> Result<(), ConsoleErrorV1> {
    if role != "deriver_a" && role != "deriver_b" {
        return Err(ConsoleErrorV1::invalid(
            "role must be deriver_a or deriver_b",
        ));
    }
    Ok(())
}

/// Downloads one role's encrypted recovery package.
///
/// One invocation downloads one role. The tool never receives both packages,
/// and cannot decrypt either: the response is ciphertext for a recovery key
/// this process may not even hold.
pub fn download_role_package_v1(
    transport: &dyn ConsoleTransportV1,
    endpoint: &ConsoleEndpointV1,
    role: &str,
) -> Result<ConsoleArtifactV1, ConsoleErrorV1> {
    require_role(role)?;
    let body = encode_body(&serde_json::json!({ "role": role }), "download request")?;
    let response = transport.send(endpoint.request("POST", ROLE_PACKAGE_PATH, Some(body)))?;
    let wire: ArtifactResponseWire = parse_json(&response, "role package download")?;
    require_ok(wire.ok, "role package download")?;
    Ok(ConsoleArtifactV1 {
        bytes: decode_artifact(&wire.artifact_b64u, "role package")?,
        content_digest_b64u: wire.content_digest_b64u,
    })
}

/// Downloads the public recovery manifest, without either role package.
pub fn download_recovery_manifest_v1(
    transport: &dyn ConsoleTransportV1,
    endpoint: &ConsoleEndpointV1,
) -> Result<ConsoleArtifactV1, ConsoleErrorV1> {
    let response = transport.send(endpoint.request("GET", MANIFEST_PATH, None))?;
    let wire: ArtifactResponseWire = parse_json(&response, "recovery manifest download")?;
    require_ok(wire.ok, "recovery manifest download")?;
    Ok(ConsoleArtifactV1 {
        bytes: decode_artifact(&wire.artifact_b64u, "recovery manifest")?,
        content_digest_b64u: wire.content_digest_b64u,
    })
}

/// What one durable-verification report states.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DurableVerificationReportV1 {
    /// Which artifact was verified.
    pub artifact: String,
    /// The digest read back from disk.
    pub content_digest_b64u: String,
    /// Which trust result the offline verification obtained, when one ran.
    pub trust_level: Option<String>,
}

/// Records that this tool wrote one artifact durably and reverified it.
///
/// This is reported only after the bytes are on disk, reopened, and
/// re-digested. The service records it as durable verification precisely
/// because a browser response cannot make the same claim.
pub fn record_durable_verification_v1(
    transport: &dyn ConsoleTransportV1,
    endpoint: &ConsoleEndpointV1,
    input: &DurableVerificationReportV1,
) -> Result<(), ConsoleErrorV1> {
    let body = encode_body(
        &serde_json::json!({
            "artifact": input.artifact,
            "contentDigestB64u": input.content_digest_b64u,
            "trustLevel": input.trust_level.as_ref().map(|kind| serde_json::json!({ "kind": kind })),
        }),
        "verification report",
    )?;
    let response =
        transport.send(endpoint.request("POST", DURABLE_VERIFICATION_PATH, Some(body)))?;
    let wire: DurableVerificationResponseWire =
        parse_json(&response, "durable verification report")?;
    require_ok(wire.ok, "durable verification report")
}

const RESTORE_BOOTSTRAP_SESSION_PATH: &str =
    "/console/tenant-root/security/restore/bootstrap-session";
const RESTORE_PATH: &str = "/console/tenant-root/security/restore";
const RESTORE_MANIFEST_PATH: &str = "/console/tenant-root/security/restore/manifest";
const RESTORE_IMPORT_KEY_PATH: &str = "/console/tenant-root/security/restore/import-key";
const RESTORE_IMPORT_PATH: &str = "/console/tenant-root/security/restore/import";
const RESTORE_ACTIVATE_PATH: &str = "/console/tenant-root/security/restore/activate";
const RESTORE_STATUS_PATH: &str = "/console/tenant-root/security/restore/status";

/// The header the destination bootstrap credential travels in, once.
pub const DESTINATION_BOOTSTRAP_HEADER_V1: &str = "x-seams-destination-bootstrap";
/// The header the restore administration session travels in.
pub const RESTORE_SESSION_HEADER_V1: &str = "x-seams-restore-session";

/// One destination deployment and its one-time bootstrap credential.
///
/// This is deliberately a different type from the console endpoint. A console
/// session belongs to the *source* deployment and proves nothing about a
/// destination, so the two credentials must not be interchangeable. The
/// bootstrap credential is used for exactly one thing: opening a session.
#[derive(Debug, Clone)]
pub struct DestinationBootstrapV1 {
    base_url: String,
    credential: ConsoleCredentialV1,
}

impl DestinationBootstrapV1 {
    /// Creates one destination bootstrap.
    pub fn new(
        base_url: impl Into<String>,
        credential: ConsoleCredentialV1,
    ) -> Result<Self, ConsoleErrorV1> {
        Ok(Self {
            base_url: require_https(base_url, "destination URL")?,
            credential,
        })
    }
}

/// One live restore administration session on a destination.
///
/// Created from a destination response or its private checkpoint. The destination
/// authenticates the session and enforces expiry on every request.
#[derive(Debug, Clone)]
pub struct DestinationSessionV1 {
    base_url: String,
    session: ConsoleCredentialV1,
    expires_at: String,
}

impl DestinationSessionV1 {
    pub(crate) fn checkpoint_bytes(&self) -> Result<Zeroizing<Vec<u8>>, ConsoleErrorV1> {
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Checkpoint<'a> {
            destination: &'a str,
            session_token: &'a str,
            expires_at: &'a str,
        }
        serde_json::to_vec(&Checkpoint {
            destination: &self.base_url,
            session_token: self.session.0.as_str(),
            expires_at: &self.expires_at,
        })
        .map(Zeroizing::new)
        .map_err(|_| ConsoleErrorV1::unexpected("could not encode restore session"))
    }

    pub(crate) fn from_checkpoint(destination: &str, bytes: &[u8]) -> Result<Self, ConsoleErrorV1> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Checkpoint {
            destination: String,
            session_token: String,
            expires_at: String,
        }
        let checkpoint: Checkpoint = serde_json::from_slice(bytes)
            .map_err(|_| ConsoleErrorV1::invalid("saved restore session is malformed"))?;
        let session = ConsoleCredentialV1::new(checkpoint.session_token)?;
        let base_url = require_https(destination, "destination URL")?;
        if checkpoint.destination != base_url || checkpoint.expires_at.trim().is_empty() {
            return Err(ConsoleErrorV1::invalid(
                "saved restore session belongs to another destination or has no expiry",
            ));
        }
        // The destination enforces expiry and revocation on every request.
        Ok(Self {
            base_url,
            session,
            expires_at: checkpoint.expires_at,
        })
    }

    /// Returns when the destination says the session ends.
    pub fn expires_at(&self) -> &str {
        &self.expires_at
    }

    fn request(&self, method: &'static str, path: &str, body: Option<Vec<u8>>) -> ConsoleRequestV1 {
        let mut headers = BTreeMap::new();
        headers.insert("accept".to_owned(), "application/json".to_owned());
        headers.insert(
            RESTORE_SESSION_HEADER_V1.to_owned(),
            self.session.0.as_str().to_owned(),
        );
        if body.is_some() {
            headers.insert("content-type".to_owned(), "application/json".to_owned());
        }
        ConsoleRequestV1 {
            method,
            url: format!("{}{path}", self.base_url),
            headers,
            body,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BootstrapSessionResponseWire {
    ok: bool,
    session_token: String,
    expires_at: String,
}

/// Presents the bootstrap credential once and opens an administration session.
pub fn open_restore_session_v1(
    transport: &dyn ConsoleTransportV1,
    destination: &DestinationBootstrapV1,
) -> Result<DestinationSessionV1, ConsoleErrorV1> {
    let mut headers = BTreeMap::new();
    headers.insert("accept".to_owned(), "application/json".to_owned());
    headers.insert(
        DESTINATION_BOOTSTRAP_HEADER_V1.to_owned(),
        destination.credential.0.as_str().to_owned(),
    );
    headers.insert("content-type".to_owned(), "application/json".to_owned());
    let response = transport.send(ConsoleRequestV1 {
        method: "POST",
        url: format!("{}{RESTORE_BOOTSTRAP_SESSION_PATH}", destination.base_url),
        headers,
        body: Some(b"{}".to_vec()),
    })?;
    let wire: BootstrapSessionResponseWire = parse_json(&response, "restore session opening")?;
    require_ok(wire.ok, "restore session opening")?;
    Ok(DestinationSessionV1 {
        base_url: destination.base_url.clone(),
        session: ConsoleCredentialV1::new(wire.session_token)
            .map_err(|_| ConsoleErrorV1::unexpected("the destination minted an empty session"))?,
        expires_at: wire.expires_at,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreSessionResponseWire {
    ok: bool,
    session: Option<RestoreSessionWire>,
}

/// A restore session. Its branch-specific evidence fields are not read here.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreSessionWire {
    status: String,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    destination_fingerprint_b64u: Option<String>,
    #[serde(default)]
    destination_lineage_id: Option<String>,
}

/// One restore session as the CLI reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoreSessionReportV1 {
    /// The exact session branch, or `none` when no session exists.
    pub status: String,
    /// The session identifier, when the branch carries one.
    pub session_id: Option<String>,
    /// The destination deployment fingerprint, when the branch carries one.
    pub destination_fingerprint_b64u: Option<String>,
    /// This destination's own custody lineage, once activated.
    pub destination_lineage_id: Option<String>,
}

impl RestoreSessionReportV1 {
    fn from_wire(session: Option<RestoreSessionWire>) -> Self {
        match session {
            Some(session) => Self {
                status: session.status,
                session_id: session.session_id,
                destination_fingerprint_b64u: session.destination_fingerprint_b64u,
                destination_lineage_id: session.destination_lineage_id,
            },
            None => Self {
                status: "none".to_owned(),
                session_id: None,
                destination_fingerprint_b64u: None,
                destination_lineage_id: None,
            },
        }
    }
}

fn restore_session(
    response: &ConsoleResponseV1,
    operation: &str,
) -> Result<RestoreSessionReportV1, ConsoleErrorV1> {
    let wire: RestoreSessionResponseWire = parse_json(response, operation)?;
    require_ok(wire.ok, operation)?;
    Ok(RestoreSessionReportV1::from_wire(wire.session))
}

/// Starts one restore session on an empty destination.
pub fn start_restore_session_v1(
    transport: &dyn ConsoleTransportV1,
    destination: &DestinationSessionV1,
) -> Result<RestoreSessionReportV1, ConsoleErrorV1> {
    let response =
        transport.send(destination.request("POST", RESTORE_PATH, Some(b"{}".to_vec())))?;
    restore_session(&response, "restore session start")
}

/// Reads the destination's restore session.
pub fn read_restore_status_v1(
    transport: &dyn ConsoleTransportV1,
    destination: &DestinationSessionV1,
) -> Result<RestoreSessionReportV1, ConsoleErrorV1> {
    let response = transport.send(destination.request("GET", RESTORE_STATUS_PATH, None))?;
    restore_session(&response, "restore status")
}

/// Registers the public recovery manifest with one restore session.
pub fn register_restore_manifest_v1(
    transport: &dyn ConsoleTransportV1,
    destination: &DestinationSessionV1,
    manifest_bytes: &[u8],
) -> Result<RestoreSessionReportV1, ConsoleErrorV1> {
    use base64ct::{Base64UrlUnpadded, Encoding};
    let body = encode_body(
        &serde_json::json!({
            "manifestB64u": Base64UrlUnpadded::encode_string(manifest_bytes),
        }),
        "manifest registration",
    )?;
    let response =
        transport.send(destination.request("POST", RESTORE_MANIFEST_PATH, Some(body)))?;
    restore_session(&response, "restore manifest registration")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportKeyResponseWire {
    ok: bool,
    import_key_id: String,
    import_public_key_b64u: String,
    destination_fingerprint_b64u: String,
    destination_lineage_b64u: String,
    restore_session_id_b64u: String,
    operation_id: String,
    operation_digest_b64u: String,
    command_digest_b64u: String,
    role: String,
    generation: u64,
    issued_at_ms: u64,
    expires_at_ms: u64,
    replayed: bool,
}

/// One destination role import key, issued for exactly one role and window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleImportKeyV1 {
    /// The key identifier.
    pub import_key_id: String,
    /// The destination's import public key.
    pub import_public_key_b64u: String,
    /// The destination deployment fingerprint.
    pub destination_fingerprint_b64u: String,
    /// The destination's own custody lineage.
    pub destination_lineage_b64u: String,
    /// The restore session this key belongs to.
    pub restore_session_id_b64u: String,
    /// The caller's durable restore operation ID.
    pub operation_id: String,
    /// The semantic operation digest returned by the destination.
    pub operation_digest_b64u: String,
    /// The signed command digest returned by the destination.
    pub command_digest_b64u: String,
    /// The role the destination issued this key for.
    pub role: String,
    /// The monotonic import-key generation.
    pub generation: u64,
    /// When the key was issued.
    pub issued_at_ms: u64,
    /// When the key expires.
    pub expires_at_ms: u64,
    /// Whether the destination replayed an existing operation.
    pub replayed: bool,
}

/// Requests one role import key from the destination.
pub fn issue_role_import_key_v1(
    transport: &dyn ConsoleTransportV1,
    destination: &DestinationSessionV1,
    role: &str,
    operation_id: &str,
) -> Result<RoleImportKeyV1, ConsoleErrorV1> {
    require_role(role)?;
    if operation_id.trim().is_empty() {
        return Err(ConsoleErrorV1::invalid("operation id is required"));
    }
    let body = encode_body(
        &serde_json::json!({ "role": role, "operationId": operation_id }),
        "import-key request",
    )?;
    let response =
        transport.send(destination.request("POST", RESTORE_IMPORT_KEY_PATH, Some(body)))?;
    let wire: ImportKeyResponseWire = parse_json(&response, "role import key issuance")?;
    require_ok(wire.ok, "role import key issuance")?;
    if wire.operation_id != operation_id {
        return Err(ConsoleErrorV1::unexpected(
            "role import key response named a different operation",
        ));
    }
    if wire.role != role {
        return Err(ConsoleErrorV1::unexpected(
            "role import key response named a different role",
        ));
    }
    Ok(RoleImportKeyV1 {
        import_key_id: wire.import_key_id,
        import_public_key_b64u: wire.import_public_key_b64u,
        destination_fingerprint_b64u: wire.destination_fingerprint_b64u,
        destination_lineage_b64u: wire.destination_lineage_b64u,
        restore_session_id_b64u: wire.restore_session_id_b64u,
        operation_id: wire.operation_id,
        operation_digest_b64u: wire.operation_digest_b64u,
        command_digest_b64u: wire.command_digest_b64u,
        role: wire.role,
        generation: wire.generation,
        issued_at_ms: wire.issued_at_ms,
        expires_at_ms: wire.expires_at_ms,
        replayed: wire.replayed,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportResponseWire {
    ok: bool,
    session: RestoreSessionWire,
    receipt_digest_b64u: String,
    #[serde(default)]
    replayed: bool,
}

/// One accepted role import: the session it advanced and the receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleImportReportV1 {
    /// The session after the import.
    pub session: RestoreSessionReportV1,
    /// The installation receipt digest proving the installed share commitment.
    pub receipt_digest_b64u: String,
    /// Whether the destination had already installed this exact envelope.
    pub replayed: bool,
}

/// Uploads one role's destination-encrypted import envelope.
pub fn import_role_share_v1(
    transport: &dyn ConsoleTransportV1,
    destination: &DestinationSessionV1,
    role: &str,
    envelope: &[u8],
) -> Result<RoleImportReportV1, ConsoleErrorV1> {
    use base64ct::{Base64UrlUnpadded, Encoding};
    require_role(role)?;
    let body = encode_body(
        &serde_json::json!({
            "role": role,
            "importEnvelopeB64u": Base64UrlUnpadded::encode_string(envelope),
        }),
        "role import",
    )?;
    let response = transport.send(destination.request("POST", RESTORE_IMPORT_PATH, Some(body)))?;
    let wire: ImportResponseWire = parse_json(&response, "role share import")?;
    require_ok(wire.ok, "role share import")?;
    Ok(RoleImportReportV1 {
        session: RestoreSessionReportV1::from_wire(Some(wire.session)),
        receipt_digest_b64u: wire.receipt_digest_b64u,
        replayed: wire.replayed,
    })
}

/// Verifies, forward-refreshes, and activates the restored root.
///
/// The trust result is the one the destination established when the manifest
/// was registered; this request only says whether the operator accepts
/// activating on offline verification alone.
pub fn activate_restored_root_v1(
    transport: &dyn ConsoleTransportV1,
    destination: &DestinationSessionV1,
    acknowledge_offline_trust: bool,
) -> Result<RestoreSessionReportV1, ConsoleErrorV1> {
    let body = encode_body(
        &serde_json::json!({
            "acknowledgeOfflineTrust": acknowledge_offline_trust,
        }),
        "activation request",
    )?;
    let response =
        transport.send(destination.request("POST", RESTORE_ACTIVATE_PATH, Some(body)))?;
    restore_session(&response, "restore activation")
}
