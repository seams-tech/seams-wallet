use super::*;

pub(crate) const PATH: &str = "/router-ab/signing-worker/linked-presign-session/transfer";
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
pub(crate) const INTERNAL_PATH: &str =
    "/router-ab/internal/signing-worker/linked-ecdsa-presign-session/transfer";
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
const IMPORT_KEY: &str = "linked-presign-relocation-import";

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Preparation {
    wallet_scope: crate::CloudflareSigningWorkerWalletScopeV1,
    presign_session_id: String,
    server_presignature_id: String,
    request: crate::SigningWorkerRelocationIdentityV1,
}

#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
impl Preparation {
    fn from_source(command: &LinkedPresignRelocationRequest) -> Self {
        Self {
            wallet_scope: command.wallet_scope.clone(),
            presign_session_id: command.presign_session_id.clone(),
            server_presignature_id: command.server_presignature_id.clone(),
            request: command.request.identity(),
        }
    }

    fn validate(&self) -> RouterAbProtocolResult<()> {
        self.wallet_scope.validate()?;
        self.request.validate()?;
        crate::require_non_empty("Linked presign session", &self.presign_session_id)?;
        crate::require_non_empty("Linked server presignature", &self.server_presignature_id)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Command {
    Prepare {
        command: Preparation,
        chunk_bytes: u32,
    },
    Import {
        chunk: SnapshotChunk,
    },
    Verify {
        receipt: LinkedPresignFreezeReceipt,
    },
    Cleanup {
        receipt: LinkedPresignFreezeReceipt,
    },
    Status {
        receipt: LinkedPresignFreezeReceipt,
        chunk_bytes: u32,
    },
}

#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
impl Command {
    fn validate(&self) -> RouterAbProtocolResult<()> {
        match self {
            Self::Prepare { command, .. } => command.validate(),
            Self::Import { chunk } => chunk.receipt.command.validate(),
            Self::Verify { receipt } | Self::Status { receipt, .. } | Self::Cleanup { receipt } => {
                receipt.command.validate()
            }
        }
    }

    fn identity(&self) -> Preparation {
        match self {
            Self::Prepare { command, .. } => command.clone(),
            Self::Import { chunk } => Preparation::from_source(&chunk.receipt.command),
            Self::Verify { receipt } | Self::Status { receipt, .. } | Self::Cleanup { receipt } => {
                Preparation::from_source(&receipt.command)
            }
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Receipt {
    Prepared {
        command: Preparation,
        chunk_bytes: u32,
    },
    Receiving {
        receipt: LinkedPresignFreezeReceipt,
        chunk_bytes: u32,
        segment_count: u32,
        next_segment: u32,
    },
    Imported {
        segment_index: u32,
        input_digest_hex: String,
    },
    Verified {
        receipt: LinkedPresignFreezeReceipt,
    },
    Cleaning,
    Cleaned {
        receipt: LinkedPresignFreezeReceipt,
    },
}

#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
mod owner;
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
pub(crate) use owner::forward;
#[cfg(any(feature = "strict-worker-signing-worker-entrypoint", test))]
pub(super) use owner::{handle, has_import, has_import_transaction};
