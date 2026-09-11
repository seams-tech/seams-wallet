#![forbid(unsafe_code)]
#![deny(missing_docs)]
//! The `seams` derivation-root recovery command line.
//!
//! Parsing, execution, and result rendering live here so a process test can
//! drive the same code the binary runs.

mod backup_kit;
pub mod command;
pub mod console;
mod deployment;
mod help;
pub mod https;
pub mod output;
pub mod run;
pub mod transport;
pub mod trust;

pub use self::command::{
    parse_invocation_v1, CommandParseErrorV1, ParsedInvocationV1, RestoreAuthorizationV1,
    SeamsCommandV1, SecretInputV1, TrustEvidenceSourceV1,
};
pub use self::console::{
    activate_restored_root_v1, confirm_recipient_v1, download_recovery_manifest_v1,
    download_role_package_v1, import_role_share_v1, issue_role_import_key_v1,
    open_restore_session_v1, read_console_rotation_v1, read_console_status_v1,
    read_restore_status_v1, record_durable_verification_v1, register_restore_manifest_v1,
    start_console_rotation_v1, start_recipient_challenge_v1, start_restore_session_v1,
    ConsoleArtifactV1, ConsoleCredentialV1, ConsoleEndpointV1, ConsoleErrorKindV1, ConsoleErrorV1,
    ConsoleOperationalSharesV1, ConsoleRotationJobV1, ConsoleRotationOutcomeV1,
    ConsoleRotationStartV1, ConsoleStatusReportV1, DestinationBootstrapV1, DestinationSessionV1,
    DurableVerificationReportV1, RecipientChallengeV1, RecipientEnrolmentV1,
    RestoreSessionReportV1, RoleImportKeyV1, RoleImportReportV1, CONSOLE_ENVIRONMENT_HEADER_V1,
    DESTINATION_BOOTSTRAP_HEADER_V1, RESTORE_SESSION_HEADER_V1,
};
pub use self::help::SEAMS_USAGE_V1;
pub use self::https::HttpsConsoleTransportV1;
pub use self::output::{
    RecoveryKeyCreatedV1, SeamsExitCodeV1, SeamsResultV1, TrustBundleSummaryV1,
};
pub use self::run::{run_command_v1, run_command_with_recovery_trust_v1};
pub use self::transport::{
    ConsoleRequestV1, ConsoleResponseV1, ConsoleTransportErrorV1, ConsoleTransportV1,
    UnavailableConsoleTransportV1,
};
pub use self::trust::{
    pinned_recovery_trust_bundle_v1, pinned_release_root_v1, resolve_recovery_trust_bundle_v1,
    ResolvedTrustBundleV1,
};
