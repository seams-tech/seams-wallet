use super::*;

pub const SIGNING_WORKER_ECDSA_EXPORT_PATH_V1: &str =
    "/router-ab/signing-worker/wallet/ecdsa/export";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerEcdsaExportRequestV1 {
    pub receipt: SigningWorkerPoolFreezeReceiptV1,
    pub segment_index: u32,
    pub chunk_bytes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerEcdsaSnapshotChunkV1 {
    pub receipt: SigningWorkerPoolFreezeReceiptV1,
    pub segment_index: u32,
    pub segment_count: u32,
    pub chunk_bytes: u32,
    pub data_b64u: String,
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    /// Export runs in the host's wallet transaction and releases only frozen role-local rows.
    pub fn export_ecdsa_snapshot(
        &self,
        request: SigningWorkerEcdsaExportRequestV1,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaSnapshotChunkV1> {
        validate_chunk_bytes(request.chunk_bytes)?;
        self.require_frozen_receipt(&request.receipt)?;
        self.read_ecdsa_snapshot_chunk(request)
    }
}

pub(super) fn validate_chunk_bytes(size: u32) -> RouterAbProtocolResult<()> {
    if !(1..=65_536).contains(&size) {
        return Err(wallet_error(
            "ECDSA transfer chunk size must be 1 through 65536 bytes",
        ));
    }
    Ok(())
}
