//! Machine-readable results and exit codes.
//!
//! `--json` writes one exhaustive result object to stdout and nothing else;
//! diagnostics go to stderr. No result ever carries a passphrase, private key,
//! opened share, or a raw server body.

use seams_recovery_core::{RecoveryHostSecretCapabilitiesV1, VerifiedRolePackageReportV1};
use serde::Serialize;

pub(crate) fn terminal_notice(label: &str, detail: &str, color: &str) {
    use std::io::{IsTerminal, Write};
    let mut stderr = std::io::stderr();
    let use_color = stderr.is_terminal()
        && std::env::var_os("NO_COLOR").is_none_or(|value| value.is_empty())
        && std::env::var_os("TERM").is_none_or(|value| value != "dumb");
    if use_color {
        let _ = writeln!(stderr, "\n\x1b[{color}m{label}\x1b[0m");
    } else {
        let _ = writeln!(stderr, "\n{label}");
    }
    for line in detail.lines() {
        let _ = writeln!(stderr, "  {line}");
    }
    let _ = writeln!(stderr);
}

/// Stable exit codes, as documented for automation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeamsExitCodeV1 {
    /// The command succeeded.
    Success,
    /// Usage or invalid local input.
    UsageOrInvalidInput,
    /// Authentication, step-up, approval, or capability failure.
    AuthorizationFailure,
    /// Artifact, signature, manifest, or trust failure.
    ArtifactOrTrustFailure,
    /// Retryable network or service failure.
    RetryableServiceFailure,
    /// Local key-provider or decryption failure.
    KeyProviderFailure,
    /// Destination identity, lifecycle, or restore-state failure.
    RestoreStateFailure,
    /// Local filesystem safety or durability failure.
    FilesystemDurabilityFailure,
    /// Internal invariant failure.
    InternalInvariantFailure,
}

impl SeamsExitCodeV1 {
    /// Returns the process exit status.
    pub const fn code(self) -> i32 {
        match self {
            Self::Success => 0,
            Self::UsageOrInvalidInput => 2,
            Self::AuthorizationFailure => 3,
            Self::ArtifactOrTrustFailure => 4,
            Self::KeyProviderFailure => 5,
            Self::RestoreStateFailure => 6,
            Self::RetryableServiceFailure => 7,
            Self::FilesystemDurabilityFailure => 8,
            Self::InternalInvariantFailure => 9,
        }
    }

    /// Returns the stable machine-readable category.
    pub const fn category(self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::UsageOrInvalidInput => "usage_or_invalid_input",
            Self::AuthorizationFailure => "authorization_failure",
            Self::ArtifactOrTrustFailure => "artifact_or_trust_failure",
            Self::RetryableServiceFailure => "retryable_service_failure",
            Self::KeyProviderFailure => "key_provider_failure",
            Self::RestoreStateFailure => "restore_state_failure",
            Self::FilesystemDurabilityFailure => "filesystem_durability_failure",
            Self::InternalInvariantFailure => "internal_invariant_failure",
        }
    }

    /// Returns whether retrying the same invocation could succeed.
    ///
    /// Only a service failure is worth retrying unchanged; every other
    /// category needs the operator to change something first.
    pub const fn retryable(self) -> bool {
        matches!(self, Self::RetryableServiceFailure)
    }
}

/// One created wrapper key file. Carries only public material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryKeyCreatedV1 {
    /// The role this key serves.
    pub role: String,
    /// Where the key file was installed.
    pub key_file: String,
    /// The public recipient key to enrol.
    pub public_key_b64u: String,
    /// The public-key fingerprint.
    pub fingerprint_b64u: String,
    /// What the host could provide for in-memory secret handling.
    pub host_capabilities: RecoveryHostSecretCapabilitiesV1,
}

/// The trust bundle a verification would use.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustBundleSummaryV1 {
    /// Whether this is the bundle compiled into the binary.
    pub pinned: bool,
    /// The bundle version.
    pub bundle_version: u64,
    /// The current pinned root key identifier.
    pub current_root_key_id: String,
    /// Retained historical root key identifiers.
    pub historical_root_key_ids: Vec<String>,
    /// Number of retained rotation bridges.
    pub bridge_count: usize,
}

/// The exhaustive result union.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum SeamsResultV1 {
    /// A complete kit verified and saved locally.
    BackupKitCreated {
        /// Durable ZIP path.
        output: String,
    },
    /// A wrapper key file was created.
    RecoveryKeyCreated(RecoveryKeyCreatedV1),
    /// One recipient key proved control and was enrolled.
    #[serde(rename_all = "camelCase")]
    RecipientEnrolled {
        /// The role enrolled.
        role: String,
        /// The environment the console acted on.
        environment: String,
        /// The public recipient key.
        public_key_b64u: String,
        /// The fingerprint the console recorded.
        fingerprint_b64u: String,
        /// The challenge that was answered.
        challenge_id_b64u: String,
    },
    /// One role package verified.
    BackupVerified {
        /// Verification results for each requested recovery package.
        reports: Vec<VerifiedRolePackageReportV1>,
    },
    /// The saved key opened the backup successfully.
    BackupDecryptionChecked {
        /// Public verification metadata only.
        report: VerifiedRolePackageReportV1,
    },
    /// One artifact downloaded, written durably, and reverified from disk.
    #[serde(rename_all = "camelCase")]
    ArtifactDownloaded {
        /// Which artifact was downloaded.
        artifact: String,
        /// Where it was installed.
        output: String,
        /// The digest read back from disk.
        content_digest_b64u: String,
        /// Whether the service accepted this tool's durability report.
        durable_verification_recorded: bool,
        /// Which trust result the offline verification obtained, when it ran.
        trust_level: Option<String>,
    },
    /// The trust bundle was read.
    TrustBundle(TrustBundleSummaryV1),
    /// A bundle continuing the pinned root was installed.
    #[serde(rename_all = "camelCase")]
    TrustUpdated {
        /// Where the bundle was installed.
        output: String,
        /// The installed bundle version.
        bundle_version: u64,
        /// The installed bundle's current root key identifier.
        current_root_key_id: String,
    },
    /// One release artifact verified against its signed manifest.
    #[serde(rename_all = "camelCase")]
    ReleaseVerified {
        /// The artifact file name the manifest describes.
        artifact: String,
        /// The release version.
        release_version: String,
        /// The source revision the release was built from.
        source_revision: String,
        /// The pinned release root that signed the manifest.
        signer_key_id: String,
    },
    /// One restore session's exact state.
    #[serde(rename_all = "camelCase")]
    RestoreSession {
        /// The exact session branch.
        status: String,
        /// The session identifier, when the branch carries one.
        session_id: Option<String>,
        /// The role this step handled, when it handled one.
        role: Option<String>,
        /// The installation receipt this step produced, when it produced one.
        receipt_digest_b64u: Option<String>,
        /// This destination's own custody lineage, once activated.
        destination_lineage_id: Option<String>,
    },
    /// The derivation-root status for one environment.
    #[serde(rename_all = "camelCase")]
    Status {
        /// The environment the console resolved, which the request matched.
        environment: String,
        /// The current lifecycle revision.
        lifecycle_revision: u64,
        /// The active operational-share epoch.
        active_epoch: u64,
        /// Deriver A health.
        deriver_a_status: String,
        /// Deriver B health.
        deriver_b_status: String,
        /// The in-flight rotation job status, when one exists.
        rotation_job_status: Option<String>,
        /// The recovery backup branch label.
        recovery_backup_status: String,
    },
    /// One started or replayed rotation.
    #[serde(rename_all = "camelCase")]
    RotationStarted {
        /// The environment this rotation belongs to.
        environment: String,
        /// The operation identifier, and the id polling uses.
        operation_id: String,
        /// completed, throttled, or in_progress.
        outcome: String,
        /// When another attempt is permitted, for a throttled rotation.
        retry_at_ms: Option<u64>,
        /// The lifecycle revision after a completed rotation.
        lifecycle_revision: Option<u64>,
    },
    /// The state of one rotation job.
    #[serde(rename_all = "camelCase")]
    RotationStatus {
        /// The environment the job belongs to.
        environment: String,
        /// The job asked about.
        job_id: String,
        /// The exact job branch, or null when the console has no such job.
        status: Option<String>,
    },
    /// Usage text was requested.
    Usage {
        /// The usage text.
        text: String,
    },
    /// The build version was requested.
    Version {
        /// The version string.
        version: String,
    },
    /// The command failed.
    Failed {
        /// The stable failure category.
        category: String,
        /// Whether retrying could succeed.
        retryable: bool,
        /// The redacted operator-facing message.
        message: String,
    },
}

impl SeamsResultV1 {
    /// Returns the exit code this result maps to.
    pub fn exit_code(&self, failure: Option<SeamsExitCodeV1>) -> SeamsExitCodeV1 {
        match self {
            Self::Failed { .. } => failure.unwrap_or(SeamsExitCodeV1::InternalInvariantFailure),
            _ => SeamsExitCodeV1::Success,
        }
    }

    /// Render human-readable output, coloring successful backup checks when requested.
    pub fn render_terminal_text(&self, color: bool) -> String {
        let text = self.render_text();
        if !color
            || !matches!(
                self,
                Self::BackupVerified { .. }
                    | Self::BackupDecryptionChecked { .. }
                    | Self::BackupKitCreated { .. }
                    | Self::RestoreSession { .. }
            )
        {
            return text;
        }
        text.lines()
            .map(|line| {
                if line.starts_with("SUCCESS:") || line.starts_with("✓ Verified") {
                    format!("\x1b[1;32m{line}\x1b[0m")
                } else {
                    line.to_owned()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Renders the result for a human reader.
    pub fn render_text(&self) -> String {
        match self {
            Self::RecoveryKeyCreated(created) => format!(
                "Created {} wrapper key at {}\n  public key:  {}\n  fingerprint: {}\n{}",
                created.role,
                created.key_file,
                created.public_key_b64u,
                created.fingerprint_b64u,
                render_capability_warnings(created.host_capabilities),
            ),
            Self::RecipientEnrolled {
                role,
                environment,
                public_key_b64u,
                fingerprint_b64u,
                challenge_id_b64u,
            } => format!(
                "Enrolled {role} wrapper key for {environment}\n  public key:  {public_key_b64u}\n  fingerprint: {fingerprint_b64u}\n  challenge:   {challenge_id_b64u}",
            ),
            Self::BackupVerified { reports } => {
                let summary = if reports.len() == 2 {
                    "SUCCESS: Both recovery packages verified."
                } else {
                    "SUCCESS: Recovery package verified."
                };
                let details = reports.iter().map(|report| format!(
                "✓ Verified {} package for recovery set {}\n  trust:       {}\n  package:     {}\n  manifest:    {}\n  root:        {}\n  recipient:   {}",
                report.role,
                report.recovery_set_id,
                report.trust_level,
                report.package_digest_b64u,
                report.manifest_digest_b64u,
                report.root_commitment_b64u,
                report.recipient_fingerprint_b64u,
            )).collect::<Vec<_>>().join("\n\n");
                let offline_note = if reports.iter().any(|report| report.trust_level == "cryptographically_valid_offline") {
                    "\n\nOffline verification passed. Revocation status was not checked."
                } else {
                    ""
                };
                format!("{summary}\n\n{details}{offline_note}\nVerification does not perform a restore.")
            }
            Self::BackupKitCreated { output } => format!(
                "\nSUCCESS: Recovery kit saved.\n\n  File: {output}\n  Wrapper keys and backup packages verified.\n\nKeep this ZIP secure: it contains private wrapper keys.\nRevocation status was not checked."
            ),
            Self::BackupDecryptionChecked { report } => format!(
                "SUCCESS: {} backup decrypted successfully.\nYour saved key matches recovery set {}.\nKeep the key with your package. Protect these files using your own storage controls.\nOffline check passed; revocation status was not checked. No deployment was changed.",
                report.role, report.recovery_set_id,
            ),
            Self::ArtifactDownloaded {
                artifact,
                output,
                content_digest_b64u,
                durable_verification_recorded,
                trust_level,
            } => format!(
                "Downloaded {artifact} to {output}\n  digest:      {content_digest_b64u}\n  trust:       {}\n  recorded:    {}",
                trust_level.as_deref().unwrap_or("not verified"),
                if *durable_verification_recorded {
                    "durable verification reported"
                } else {
                    "not reported to the service"
                },
            ),
            Self::RestoreSession { status, session_id, destination_lineage_id, .. } if status == "active" => format!(
                "\nSUCCESS: RECOVERY COMPLETE\n\nYour restored root is active. No further activation steps are needed.\n\n  Session: {}\n  Lineage: {}\n\nKeep your recovery ZIP and restore session file securely.",
                session_id.as_deref().unwrap_or("unknown"),
                destination_lineage_id.as_deref().unwrap_or("unknown"),
            ),
            Self::RestoreSession {
                status,
                session_id,
                role,
                receipt_digest_b64u,
                destination_lineage_id,
            } => format!(
                "{}\nRestore {status}\n  session:     {}\n  role:        {}\n  receipt:     {}\n  lineage:     {}",
                match (role, receipt_digest_b64u, status.as_str()) {
                    (_, _, "active") => "SUCCESS: Recovery activated.",
                    (Some(_), Some(_), "awaiting_role_imports") => "SUCCESS: Your recovery share was imported. The other holder must run the restore command next.",
                    (Some(_), Some(_), _) => "SUCCESS: Your recovery share was imported. Check restore status, then explicitly run restore activate when ready.",
                    _ => "Recovery status:",
                },
                session_id.as_deref().unwrap_or("not started"),
                role.as_deref().unwrap_or("not role-specific"),
                receipt_digest_b64u.as_deref().unwrap_or("none"),
                destination_lineage_id
                    .as_deref()
                    .unwrap_or("assigned at activation"),
            ),
            Self::TrustBundle(bundle) => format!(
                "Trust bundle version {} ({})\n  current root: {}\n  historical:   {}\n  bridges:      {}",
                bundle.bundle_version,
                if bundle.pinned {
                    "pinned in this binary"
                } else {
                    "supplied, continues the pinned root"
                },
                bundle.current_root_key_id,
                if bundle.historical_root_key_ids.is_empty() {
                    "none".to_owned()
                } else {
                    bundle.historical_root_key_ids.join(", ")
                },
                bundle.bridge_count,
            ),
            Self::TrustUpdated {
                output,
                bundle_version,
                current_root_key_id,
            } => format!(
                "Installed trust bundle version {bundle_version} to {output}\n  current root: {current_root_key_id}",
            ),
            Self::ReleaseVerified {
                artifact,
                release_version,
                source_revision,
                signer_key_id,
            } => format!(
                "Verified {artifact} against release {release_version}\n  revision:    {source_revision}\n  signed by:   {signer_key_id}",
            ),
            Self::Status {
                environment,
                lifecycle_revision,
                active_epoch,
                deriver_a_status,
                deriver_b_status,
                rotation_job_status,
                recovery_backup_status,
            } => format!(
                "Derivation root {environment}\n  revision:    {lifecycle_revision}\n  epoch:       {active_epoch}\n  Deriver A:   {deriver_a_status}\n  Deriver B:   {deriver_b_status}\n  rotation:    {}\n  recovery:    {recovery_backup_status}",
                rotation_job_status.as_deref().unwrap_or("none in progress"),
            ),
            Self::RotationStarted {
                environment,
                operation_id,
                outcome,
                retry_at_ms,
                lifecycle_revision,
            } => format!(
                "Rotation {outcome} for {environment}\n  operation:   {operation_id}{}{}\n  poll with:   seams-wallet derivation-root rotation status --operation {operation_id}",
                match lifecycle_revision {
                    Some(revision) => format!("\n  revision:    {revision}"),
                    None => String::new(),
                },
                match retry_at_ms {
                    Some(retry) => format!("\n  retry after: {retry}"),
                    None => String::new(),
                },
            ),
            Self::RotationStatus {
                environment,
                job_id,
                status,
            } => format!(
                "Rotation {job_id} for {environment}\n  status:      {}",
                status.as_deref().unwrap_or("no such job"),
            ),
            Self::Usage { text } => text.clone(),
            Self::Version { version } => version.clone(),
            Self::Failed { message, .. } => format!("error: {message}"),
        }
    }
}

fn render_capability_warnings(capabilities: RecoveryHostSecretCapabilitiesV1) -> String {
    if capabilities.is_complete() {
        return String::new();
    }
    capabilities
        .warnings()
        .into_iter()
        .map(|warning| format!("  warning: {warning}\n"))
        .collect()
}
