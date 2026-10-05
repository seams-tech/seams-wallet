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
        let snapshot = self.ecdsa_snapshot(&request.receipt.scope)?;
        let bytes = snapshot.encode(&request.receipt.scope, &request.receipt.request)?;
        if snapshot.record_count() != request.receipt.record_count
            || snapshot::snapshot_digest(&bytes) != request.receipt.wallet_records_digest_hex
        {
            return Err(wallet_error(
                "ECDSA source inventory differs from its frozen receipt",
            ));
        }
        let segment_count = u32::try_from(bytes.len().div_ceil(request.chunk_bytes as usize))
            .map_err(|_| wallet_error("ECDSA snapshot has too many segments"))?;
        if request.segment_index >= segment_count {
            return Err(wallet_error("ECDSA export segment is absent"));
        }
        let start = request.segment_index as usize * request.chunk_bytes as usize;
        let end = (start + request.chunk_bytes as usize).min(bytes.len());
        Ok(SigningWorkerEcdsaSnapshotChunkV1 {
            receipt: request.receipt,
            segment_index: request.segment_index,
            segment_count,
            chunk_bytes: request.chunk_bytes,
            data_b64u: crate::encode_base64url_bytes_v1(&bytes[start..end]),
        })
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
