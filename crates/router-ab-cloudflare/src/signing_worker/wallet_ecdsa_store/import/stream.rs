use super::*;

pub(in crate::signing_worker::wallet_ecdsa_store) struct ChunkReader<'a, Sql> {
    sql: &'a Sql,
    owner: String,
    receipt: &'a SigningWorkerPoolFreezeReceiptV1,
    segment_count: u32,
    chunk_bytes: u32,
    next_segment: u32,
    bytes: Vec<u8>,
    offset: usize,
    position: u64,
}

impl<'a, Sql: SigningWorkerWalletSqlV1> ChunkReader<'a, Sql> {
    pub(in crate::signing_worker::wallet_ecdsa_store) fn new(
        sql: &'a Sql,
        receipt: &'a SigningWorkerPoolFreezeReceiptV1,
        segment_count: u32,
        chunk_bytes: u32,
        position: u64,
    ) -> RouterAbProtocolResult<Self> {
        let owner = owner_json(&receipt.scope, "ECDSA import")?;
        if position > u64::from(segment_count) * u64::from(chunk_bytes) {
            return Err(wallet_error(
                "ECDSA restore cursor exceeds the staged inventory",
            ));
        }
        Ok(Self {
            sql,
            owner,
            receipt,
            segment_count,
            chunk_bytes,
            next_segment: u32::try_from(position / u64::from(chunk_bytes))
                .map_err(|_| wallet_error("ECDSA restore cursor overflowed"))?,
            bytes: Vec::new(),
            offset: (position % u64::from(chunk_bytes)) as usize,
            position,
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
        self.next_segment += 1;
        Ok(())
    }

    pub(in crate::signing_worker::wallet_ecdsa_store) fn position(&self) -> u64 {
        self.position
    }

    pub(in crate::signing_worker::wallet_ecdsa_store) fn record(
        &mut self,
    ) -> RouterAbProtocolResult<Option<Vec<u8>>> {
        let mut line = Vec::new();
        loop {
            if self.bytes.is_empty() || self.offset == self.bytes.len() {
                if self.next_segment == self.segment_count {
                    if !line.is_empty() {
                        return Err(wallet_error("ECDSA snapshot record is incomplete"));
                    }
                    return Ok(None);
                }
                if !self.bytes.is_empty() {
                    self.offset = 0;
                }
                self.load_chunk()?;
                if self.offset > self.bytes.len() {
                    return Err(wallet_error("ECDSA restore cursor exceeds its segment"));
                }
            }
            let remaining = &self.bytes[self.offset..];
            let newline = remaining.iter().position(|byte| *byte == b'\n');
            let length = newline.unwrap_or(remaining.len());
            line.extend_from_slice(&remaining[..length]);
            let consumed = length + usize::from(newline.is_some());
            self.offset += consumed;
            self.position += consumed as u64;
            if newline.is_some() {
                return Ok(Some(line));
            }
        }
    }
}
