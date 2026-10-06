use super::*;
use std::io::Write;

const PAGE_BYTES: usize = 4096;

pub(super) const PAGES_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ecdsa_snapshot_pages (
    owner_json TEXT NOT NULL,
    move_id TEXT NOT NULL,
    page_index INTEGER NOT NULL,
    data_b64u TEXT NOT NULL,
    digest_hex TEXT NOT NULL,
    PRIMARY KEY (owner_json, move_id, page_index))";

pub(super) const MANIFEST_SCHEMA: &str =
    "CREATE TABLE IF NOT EXISTS wallet_ecdsa_snapshot_manifest (
    owner_json TEXT NOT NULL,
    move_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    byte_length INTEGER NOT NULL CHECK (byte_length > 0),
    PRIMARY KEY (owner_json, move_id))";

#[derive(Deserialize)]
struct ManifestRow {
    receipt_json: String,
    #[serde(deserialize_with = "sql_integer::deserialize")]
    byte_length: i64,
}

#[derive(Deserialize)]
struct PageRow {
    page_index: u32,
    data_b64u: String,
    digest_hex: String,
}

struct PageWriter<'a, Sql> {
    sql: &'a Sql,
    owner: String,
    move_id: String,
    page_index: u32,
    bytes: Vec<u8>,
    byte_length: i64,
    digest: snapshot::SnapshotDigestWriter,
}

impl<Sql: SigningWorkerWalletSqlV1> PageWriter<'_, Sql> {
    fn persist_page(&mut self) -> RouterAbProtocolResult<()> {
        if self.bytes.is_empty() {
            return Ok(());
        }
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_ecdsa_snapshot_pages (owner_json, move_id, page_index, data_b64u, digest_hex) VALUES (?, ?, ?, ?, ?)",
            vec![
                text(self.owner.clone()), text(self.move_id.clone()),
                SigningWorkerWalletSqlValueV1::Integer(i64::from(self.page_index)),
                text(crate::encode_base64url_bytes_v1(&self.bytes)),
                text(page_digest(&self.bytes)),
            ],
        )?;
        self.page_index = self
            .page_index
            .checked_add(1)
            .ok_or_else(|| wallet_error("ECDSA snapshot has too many pages"))?;
        self.bytes.clear();
        Ok(())
    }
}

impl<Sql: SigningWorkerWalletSqlV1> Write for PageWriter<'_, Sql> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let mut remaining = bytes;
        while !remaining.is_empty() {
            let count = remaining.len().min(PAGE_BYTES - self.bytes.len());
            self.bytes.extend_from_slice(&remaining[..count]);
            self.digest.write_all(&remaining[..count])?;
            self.byte_length = self
                .byte_length
                .checked_add(count as i64)
                .ok_or_else(|| std::io::Error::other("ECDSA snapshot length overflowed"))?;
            remaining = &remaining[count..];
            if self.bytes.len() == PAGE_BYTES {
                self.persist_page().map_err(std::io::Error::other)?;
            }
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.persist_page().map_err(std::io::Error::other)
    }
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    pub(super) fn seal_ecdsa_snapshot(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        request: SigningWorkerRelocationRequestV1,
    ) -> RouterAbProtocolResult<SigningWorkerPoolFreezeReceiptV1> {
        let owner = owner_json(scope, "ECDSA sealed snapshot")?;
        let digest = snapshot::SnapshotDigestWriter::new();
        let mut writer = PageWriter {
            sql: self.sql,
            owner: owner.clone(),
            move_id: request.move_id.clone(),
            page_index: 0,
            bytes: Vec::with_capacity(PAGE_BYTES),
            byte_length: 0,
            digest,
        };
        let record_count = self.write_ecdsa_snapshot(scope, &request, &mut writer)?;
        writer.persist_page()?;
        let receipt = SigningWorkerPoolFreezeReceiptV1 {
            scope: scope.clone(),
            request,
            record_count,
            wallet_records_digest_hex: writer.digest.finish()?,
        };
        let encoded =
            serde_json::to_string(&receipt).map_err(|error| wallet_error(error.to_string()))?;
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_ecdsa_snapshot_manifest (owner_json, move_id, receipt_json, byte_length) VALUES (?, ?, ?, ?)",
            vec![text(owner), text(receipt.request.move_id.clone()), text(encoded),
                SigningWorkerWalletSqlValueV1::Integer(writer.byte_length)],
        )?;
        Ok(receipt)
    }

    pub(super) fn read_ecdsa_snapshot_chunk(
        &self,
        request: SigningWorkerEcdsaExportRequestV1,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaSnapshotChunkV1> {
        let owner = owner_json(&request.receipt.scope, "ECDSA sealed snapshot")?;
        let manifests = self.sql.query::<ManifestRow>(
            "SELECT receipt_json, CAST(byte_length AS TEXT) AS byte_length FROM wallet_ecdsa_snapshot_manifest WHERE owner_json = ? AND move_id = ?",
            vec![text(owner.clone()), text(request.receipt.request.move_id.clone())],
        )?;
        let [manifest] = manifests.as_slice() else {
            return Err(wallet_error("ECDSA sealed snapshot manifest is missing"));
        };
        let receipt: SigningWorkerPoolFreezeReceiptV1 =
            serde_json::from_str(&manifest.receipt_json)
                .map_err(|error| wallet_error(error.to_string()))?;
        if receipt != request.receipt || manifest.byte_length <= 0 {
            return Err(wallet_error("ECDSA sealed snapshot manifest differs"));
        }
        let length = manifest.byte_length as u64;
        let size = u64::from(request.chunk_bytes);
        let segment_count = u32::try_from(length.div_ceil(size))
            .map_err(|_| wallet_error("ECDSA snapshot has too many segments"))?;
        if request.segment_index >= segment_count {
            return Err(wallet_error("ECDSA export segment is absent"));
        }
        let start = u64::from(request.segment_index) * size;
        let end = (start + size).min(length);
        let first_page = start / PAGE_BYTES as u64;
        let last_page = (end - 1) / PAGE_BYTES as u64;
        let pages = self.sql.query::<PageRow>(
            "SELECT page_index, data_b64u, digest_hex FROM wallet_ecdsa_snapshot_pages WHERE owner_json = ? AND move_id = ? AND page_index BETWEEN ? AND ? ORDER BY page_index LIMIT 17",
            vec![text(owner), text(request.receipt.request.move_id.clone()),
                SigningWorkerWalletSqlValueV1::Integer(first_page as i64),
                SigningWorkerWalletSqlValueV1::Integer(last_page as i64)],
        )?;
        if pages.len() as u64 != last_page - first_page + 1 {
            return Err(wallet_error("ECDSA sealed snapshot pages are missing"));
        }
        let mut data = Vec::with_capacity((end - start) as usize);
        for (index, page) in pages.into_iter().enumerate() {
            let page_index = first_page + index as u64;
            let offset = page_index * PAGE_BYTES as u64;
            let bytes = crate::decode_base64url_bytes_v1("ECDSA sealed page", &page.data_b64u)?;
            if u64::from(page.page_index) != page_index
                || bytes.len() as u64 != (length - offset).min(PAGE_BYTES as u64)
                || page_digest(&bytes) != page.digest_hex
            {
                return Err(wallet_error("ECDSA sealed snapshot page differs"));
            }
            let from = start.saturating_sub(offset) as usize;
            let to = (end - offset).min(bytes.len() as u64) as usize;
            data.extend_from_slice(&bytes[from..to]);
        }
        Ok(SigningWorkerEcdsaSnapshotChunkV1 {
            receipt: request.receipt,
            segment_index: request.segment_index,
            segment_count,
            chunk_bytes: request.chunk_bytes,
            data_b64u: crate::encode_base64url_bytes_v1(&data),
        })
    }
}

fn page_digest(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"seams/signing-worker/wallet-ecdsa-snapshot-page/v1");
    digest.update(bytes);
    hex_slice(&digest.finalize())
}
