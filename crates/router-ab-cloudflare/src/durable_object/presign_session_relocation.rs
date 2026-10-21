//! Local barriers serialize relocation with linked-session KV writers.

#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
mod cleanup;
pub(crate) mod import;
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
mod owner;
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
use owner::*;
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
pub(crate) use owner::{forward_export, forward_fence, forward_freeze, handle_relocation};
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
pub(super) use owner::{require_open, require_open_transaction};

#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
use router_ab_core::RouterAbProtocolResult;
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode};
use serde::{Deserialize, Serialize};
pub(crate) const FENCE_PATH: &str = "/router-ab/signing-worker/linked-presign-session/fence";
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
pub(crate) const INTERNAL_FENCE_PATH: &str =
    "/router-ab/internal/signing-worker/linked-ecdsa-presign-session/fence";
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
const FENCE_KEY: &str = "linked-presign-relocation-fence";
pub(crate) const FREEZE_PATH: &str = "/router-ab/signing-worker/linked-presign-session/freeze";
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
pub(crate) const INTERNAL_FREEZE_PATH: &str =
    "/router-ab/internal/signing-worker/linked-ecdsa-presign-session/freeze";
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
const SNAPSHOT_KEY: &str = "linked-presign-relocation-snapshot";
pub(crate) const EXPORT_PATH: &str = "/router-ab/signing-worker/linked-presign-session/export";
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
pub(crate) const INTERNAL_EXPORT_PATH: &str =
    "/router-ab/internal/signing-worker/linked-ecdsa-presign-session/export";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ExportRequest {
    receipt: LinkedPresignFreezeReceipt,
    segment_index: u32,
    chunk_bytes: u32,
}

#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
impl ExportRequest {
    fn validate(&self) -> RouterAbProtocolResult<()> {
        self.receipt.command.validate()?;
        validate_chunk_bytes(self.chunk_bytes)
    }
}

#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
fn validate_chunk_bytes(size: u32) -> RouterAbProtocolResult<()> {
    if !(1..=65_536).contains(&size) {
        return Err(storage_error(
            "Linked presign chunk size must be 1 through 65536 bytes",
        ));
    }
    Ok(())
}

#[derive(PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SnapshotChunk {
    receipt: LinkedPresignFreezeReceipt,
    segment_index: u32,
    segment_count: u32,
    chunk_bytes: u32,
    data_b64u: String,
}

use crate::{
    SigningWorkerLinkedPresignFreezeReceiptV1 as LinkedPresignFreezeReceipt,
    SigningWorkerLinkedPresignRelocationRequestV1 as LinkedPresignRelocationRequest,
};

/// Proves linked-session KV writes are closed. Material invalidation and sealing are separate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LinkedPresignFenceReceipt {
    command: LinkedPresignRelocationRequest,
    initialization: Initialization,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum Initialization {
    Initialized,
    Registered { request_digest_hex: String },
    Imported,
}

fn storage_error(error: impl std::fmt::Display) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        &error.to_string(),
    )
}
