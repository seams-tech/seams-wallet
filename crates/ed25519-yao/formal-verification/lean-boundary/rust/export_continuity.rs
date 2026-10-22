// Extract the production modules without unrelated cryptographic dependencies.
#[path = "../../../../router-ab-ed25519-yao-client/src/error.rs"]
mod error;
#[path = "../../../../router-ab-ed25519-yao-client/src/export_continuity.rs"]
mod export_continuity;

pub(crate) use error::ClientActivationError;
