use super::*;
use std::io::Read;

pub(super) struct ChunkReader<'a, Sql> {
    sql: &'a Sql,
    owner: String,
    receipt: &'a SigningWorkerPoolFreezeReceiptV1,
    segment_count: u32,
    chunk_bytes: u32,
    next_segment: u32,
    bytes: Vec<u8>,
    offset: usize,
    digest: Sha256,
}

#[derive(Deserialize)]
struct ChunkCount {
    count: u32,
}

impl<'a, Sql: SigningWorkerWalletSqlV1> ChunkReader<'a, Sql> {
    pub(super) fn new(
        sql: &'a Sql,
        receipt: &'a SigningWorkerPoolFreezeReceiptV1,
        segment_count: u32,
        chunk_bytes: u32,
    ) -> RouterAbProtocolResult<Self> {
        let owner = owner_json(&receipt.scope, "ECDSA import")?;
        let rows = sql.query::<ChunkCount>(
            "SELECT COUNT(*) AS count FROM wallet_ecdsa_import_chunks WHERE owner_json = ?",
            vec![text(owner.clone())],
        )?;
        if !matches!(rows.as_slice(), [row] if row.count == segment_count) {
            return Err(wallet_error("ECDSA staged segment count changed"));
        }
        Ok(Self {
            sql,
            owner,
            receipt,
            segment_count,
            chunk_bytes,
            next_segment: 0,
            bytes: Vec::new(),
            offset: 0,
            digest: snapshot::snapshot_hasher(),
        })
    }

    fn load_chunk(&mut self) -> RouterAbProtocolResult<()> {
        let rows = self.sql.query::<StoredChunk>(
            "SELECT chunk_json, acknowledgement_json FROM wallet_ecdsa_import_chunks WHERE owner_json = ? AND segment_index = ?",
            vec![text(self.owner.clone()), SigningWorkerWalletSqlValueV1::Integer(i64::from(self.next_segment))],
        )?;
        let [stored] = rows.as_slice() else {
            return Err(wallet_error("ECDSA staged segment is missing"));
        };
        let chunk: SigningWorkerEcdsaSnapshotChunkV1 = serde_json::from_str(&stored.chunk_json)
            .map_err(|error| wallet_error(error.to_string()))?;
        if chunk.receipt != *self.receipt
            || chunk.segment_index != self.next_segment
            || chunk.segment_count != self.segment_count
            || chunk.chunk_bytes != self.chunk_bytes
        {
            return Err(wallet_error("ECDSA staged segment identity changed"));
        }
        self.bytes = decode_chunk(&chunk)?;
        self.digest.update(&self.bytes);
        self.offset = 0;
        self.next_segment += 1;
        Ok(())
    }

    pub(super) fn verify(self) -> RouterAbProtocolResult<()> {
        if self.next_segment != self.segment_count
            || self.offset != self.bytes.len()
            || hex_slice(&self.digest.finalize()) != self.receipt.wallet_records_digest_hex
        {
            return Err(wallet_error(
                "ECDSA staged inventory digest differs from source",
            ));
        }
        Ok(())
    }
}
impl<Sql: SigningWorkerWalletSqlV1> Read for ChunkReader<'_, Sql> {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.offset == self.bytes.len() {
            if self.next_segment == self.segment_count {
                return Ok(0);
            }
            self.load_chunk().map_err(std::io::Error::other)?;
        }
        let count = output.len().min(self.bytes.len() - self.offset);
        output[..count].copy_from_slice(&self.bytes[self.offset..self.offset + count]);
        self.offset += count;
        Ok(count)
    }
}
