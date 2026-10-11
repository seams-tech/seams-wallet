use super::*;

pub const SIGNING_WORKER_ED25519_SNAPSHOT_PATH_V1: &str =
    "/router-ab/signing-worker/wallet/ed25519/snapshot";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerEd25519PreparationV1 {
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub request: SigningWorkerRelocationIdentityV1,
}

impl SigningWorkerEd25519PreparationV1 {
    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        self.scope.validate()?;
        self.request.validate()
    }

    pub(crate) fn from_source(source: &SigningWorkerEd25519FenceCommandV1) -> Self {
        Self {
            scope: source.scope.clone(),
            request: source.request.identity(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerEd25519SnapshotReceiptV1 {
    pub source: SigningWorkerEd25519FenceCommandV1,
    pub record_count: u32,
    pub segment_count: u32,
    pub digest_hex: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerEd25519SnapshotSegmentV1 {
    pub segment_index: u32,
    pub record_index: u32,
    pub part_index: u32,
    pub part_count: u32,
    pub data_b64u: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerEd25519SnapshotCommandV1 {
    Prepare {
        source: SigningWorkerEd25519PreparationV1,
    },
    Import {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
        segment: SigningWorkerEd25519SnapshotSegmentV1,
    },
    Status {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Verify {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Activate {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Cleanup {
        activation: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Capture {
        source: SigningWorkerEd25519FenceCommandV1,
    },
    Export {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
        segment_index: u32,
    },
}

impl SigningWorkerEd25519SnapshotCommandV1 {
    pub(crate) fn ownership_generation(&self) -> RouterAbProtocolResult<u64> {
        self.validate()?;
        Ok(match self {
            Self::Capture { source } => source.request.source_generation,
            Self::Export { receipt, .. } => receipt.source.request.source_generation,
            Self::Cleanup { activation } => activation.source.request.source_generation,
            Self::Prepare { source } => source.request.source_generation + 1,
            Self::Import { receipt, .. } | Self::Status { receipt }
            | Self::Verify { receipt } | Self::Activate { receipt } => receipt.source.request.source_generation + 1,
        })
    }

    pub(crate) fn scope(&self) -> &CloudflareSigningWorkerWalletScopeV1 {
        match self {
            Self::Prepare { source } => &source.scope,
            Self::Capture { source } => &source.scope,
            Self::Cleanup { activation } => &activation.source.scope,
            Self::Export { receipt, .. }
            | Self::Import { receipt, .. }
            | Self::Status { receipt }
            | Self::Verify { receipt }
            | Self::Activate { receipt } => &receipt.source.scope,
        }
    }

    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        match self {
            Self::Prepare { source } => source.validate(),
            Self::Capture { source } => source.validate(),
            Self::Cleanup { activation } => activation.source.validate(),
            Self::Export { receipt, .. }
            | Self::Import { receipt, .. }
            | Self::Status { receipt }
            | Self::Verify { receipt }
            | Self::Activate { receipt } => receipt.source.validate(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerEd25519SnapshotResponseV1 {
    Prepared {
        source: SigningWorkerEd25519PreparationV1,
        destination_object: String,
    },
    Imported {
        segment_index: u32,
        input_digest_hex: String,
    },
    Receiving {
        next_segment: u32,
        segment_count: u32,
    },
    Restoring,
    Verified {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Activated {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Cleaning {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Cleaned {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Capturing,
    Frozen {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Segment {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
        segment: SigningWorkerEd25519SnapshotSegmentV1,
    },
}
