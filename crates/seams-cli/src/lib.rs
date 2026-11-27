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
    parse_invocation_v1, RestoreAuthorizationV1, SeamsCommandV1, SecretInputV1,
};
pub use self::console::{
    issue_role_import_key_v1, open_restore_session_v1, read_console_rotation_v1,
    read_console_status_v1, read_restore_status_v1, start_console_rotation_v1, ConsoleCredentialV1,
    ConsoleEndpointV1, ConsoleErrorKindV1, ConsoleRotationOutcomeV1, DestinationBootstrapV1,
    CONSOLE_ENVIRONMENT_HEADER_V1, DESTINATION_BOOTSTRAP_HEADER_V1, RESTORE_SESSION_HEADER_V1,
};
pub use self::https::HttpsConsoleTransportV1;
pub use self::output::{SeamsExitCodeV1, SeamsResultV1};
pub use self::run::{run_command_v1, run_command_with_recovery_trust_v1};
pub use self::transport::{
    ConsoleRequestV1, ConsoleResponseV1, ConsoleTransportErrorV1, ConsoleTransportV1,
};
pub use self::trust::pinned_recovery_trust_bundle_v1;
