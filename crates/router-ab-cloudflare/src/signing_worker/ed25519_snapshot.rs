use super::*;

pub const SIGNING_WORKER_ED25519_SNAPSHOT_PATH_V1: &str =
    "/router-ab/signing-worker/wallet/ed25519/snapshot";

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
    Capture {
        source: SigningWorkerEd25519FenceCommandV1,
    },
    Export {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
        segment_index: u32,
    },
}

impl SigningWorkerEd25519SnapshotCommandV1 {
    pub(crate) fn source(&self) -> &SigningWorkerEd25519FenceCommandV1 {
        match self {
            Self::Capture { source } => source,
            Self::Export { receipt, .. } => &receipt.source,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerEd25519SnapshotResponseV1 {
    Capturing,
    Frozen {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Segment {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
        segment: SigningWorkerEd25519SnapshotSegmentV1,
    },
}
