use super::relocation::Fence;
use super::transfer::validate_chunk_bytes;
use super::*;

pub const SIGNING_WORKER_ECDSA_TRANSFER_PATH_V1: &str =
    "/router-ab/signing-worker/wallet/ecdsa/transfer";

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ecdsa_import_chunks (
    owner_json TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    chunk_json TEXT NOT NULL,
    acknowledgement_json TEXT NOT NULL,
    PRIMARY KEY(owner_json, segment_index))";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerEcdsaTransferRequestV1 {
    Prepare {
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: SigningWorkerPoolFreezeRequestV1,
        chunk_bytes: u32,
    },
    Import {
        chunk: SigningWorkerEcdsaSnapshotChunkV1,
    },
}

impl SigningWorkerEcdsaTransferRequestV1 {
    pub fn scope(&self) -> &CloudflareSigningWorkerWalletScopeV1 {
        match self {
            Self::Prepare { scope, .. } => scope,
            Self::Import { chunk } => &chunk.receipt.scope,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerEcdsaTransferResponseV1 {
    Prepared {
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: SigningWorkerPoolFreezeRequestV1,
        chunk_bytes: u32,
    },
    Imported {
        segment_index: u32,
        input_digest_hex: String,
    },
}

#[derive(Deserialize)]
struct StoredChunk {
    chunk_json: String,
    acknowledgement_json: String,
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    /// The host commits chunk bytes, acknowledgement, and progress in one transaction.
    pub fn transfer_ecdsa_snapshot(
        &self,
        command: SigningWorkerEcdsaTransferRequestV1,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaTransferResponseV1> {
        match command {
            SigningWorkerEcdsaTransferRequestV1::Prepare {
                scope,
                request,
                chunk_bytes,
            } => self.prepare_ecdsa_import(scope, request, chunk_bytes),
            SigningWorkerEcdsaTransferRequestV1::Import { chunk } => self.import_ecdsa_chunk(chunk),
        }
    }

    fn prepare_ecdsa_import(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: SigningWorkerPoolFreezeRequestV1,
        chunk_bytes: u32,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaTransferResponseV1> {
        scope.validate()?;
        request.validate()?;
        validate_chunk_bytes(chunk_bytes)?;
        match self.pool_fence(&scope)? {
            Some(Fence::Prepared {
                request: prior,
                chunk_bytes: size,
            }) if prior == request && size == chunk_bytes => {}
            Some(Fence::Importing {
                receipt,
                chunk_bytes: size,
                ..
            }) if receipt.request == request && size == chunk_bytes => {}
            None => {
                let chunks = self.sql.query::<StoredChunk>(
                    "SELECT chunk_json, acknowledgement_json FROM wallet_ecdsa_import_chunks WHERE owner_json = ? LIMIT 1",
                    vec![text(owner_json(&scope, "ECDSA import")?)],
                )?;
                if self.ecdsa_snapshot(&scope)?.record_count() != 0 || !chunks.is_empty() {
                    return Err(wallet_error("ECDSA import requires a fresh destination"));
                }
                self.save_pool_fence(
                    &scope,
                    &Fence::Prepared {
                        request: request.clone(),
                        chunk_bytes,
                    },
                )?;
            }
            _ => return Err(wallet_error("ECDSA destination preparation changed")),
        }
        Ok(SigningWorkerEcdsaTransferResponseV1::Prepared {
            scope,
            request,
            chunk_bytes,
        })
    }

    fn import_ecdsa_chunk(
        &self,
        chunk: SigningWorkerEcdsaSnapshotChunkV1,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaTransferResponseV1> {
        chunk.receipt.scope.validate()?;
        chunk.receipt.request.validate()?;
        validate_chunk_bytes(chunk.chunk_bytes)?;
        if chunk.segment_count == 0
            || chunk.segment_index >= chunk.segment_count
            || chunk.data_b64u.len() > (chunk.chunk_bytes as usize).div_ceil(3) * 4
            || chunk.receipt.wallet_records_digest_hex.len() != 64
            || !chunk
                .receipt
                .wallet_records_digest_hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(wallet_error(
                "ECDSA import chunk bounds or digest are invalid",
            ));
        }
        let data = crate::decode_base64url_bytes_v1("ECDSA import chunk", &chunk.data_b64u)?;
        if data.is_empty()
            || data.len() > chunk.chunk_bytes as usize
            || (chunk.segment_index + 1 < chunk.segment_count
                && data.len() != chunk.chunk_bytes as usize)
            || crate::encode_base64url_bytes_v1(&data) != chunk.data_b64u
        {
            return Err(wallet_error(
                "ECDSA import chunk encoding or length is invalid",
            ));
        }
        let owner = owner_json(&chunk.receipt.scope, "ECDSA import")?;
        let prior = self.sql.query::<StoredChunk>(
            "SELECT chunk_json, acknowledgement_json FROM wallet_ecdsa_import_chunks
             WHERE owner_json = ? AND segment_index = ?",
            vec![
                text(owner.clone()),
                SigningWorkerWalletSqlValueV1::Integer(chunk.segment_index.into()),
            ],
        )?;
        if let [stored] = prior.as_slice() {
            let original: SigningWorkerEcdsaSnapshotChunkV1 =
                serde_json::from_str(&stored.chunk_json)
                    .map_err(|error| wallet_error(error.to_string()))?;
            if original != chunk {
                return Err(replay_error("ECDSA import chunk inputs changed"));
            }
            return serde_json::from_str(&stored.acknowledgement_json)
                .map_err(|error| wallet_error(error.to_string()));
        }
        match self.pool_fence(&chunk.receipt.scope)? {
            Some(Fence::Prepared {
                request,
                chunk_bytes,
            }) if request == chunk.receipt.request
                && chunk_bytes == chunk.chunk_bytes
                && chunk.segment_index == 0 => {}
            Some(Fence::Importing {
                receipt,
                chunk_bytes,
                segment_count,
                next_segment,
            }) if receipt == chunk.receipt
                && chunk_bytes == chunk.chunk_bytes
                && segment_count == chunk.segment_count
                && next_segment == chunk.segment_index => {}
            _ => {
                return Err(wallet_error(
                    "ECDSA import does not match prepared progress",
                ))
            }
        }
        let encoded =
            serde_json::to_string(&chunk).map_err(|error| wallet_error(error.to_string()))?;
        let acknowledgement = SigningWorkerEcdsaTransferResponseV1::Imported {
            segment_index: chunk.segment_index,
            input_digest_hex: hex_slice(&Sha256::digest(encoded.as_bytes())),
        };
        let acknowledgement_json = serde_json::to_string(&acknowledgement)
            .map_err(|error| wallet_error(error.to_string()))?;
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_ecdsa_import_chunks
             (owner_json, segment_index, chunk_json, acknowledgement_json) VALUES (?, ?, ?, ?)",
            vec![
                text(owner),
                SigningWorkerWalletSqlValueV1::Integer(chunk.segment_index.into()),
                text(encoded),
                text(acknowledgement_json),
            ],
        )?;
        self.save_pool_fence(
            &chunk.receipt.scope,
            &Fence::Importing {
                receipt: chunk.receipt.clone(),
                chunk_bytes: chunk.chunk_bytes,
                segment_count: chunk.segment_count,
                next_segment: chunk.segment_index + 1,
            },
        )?;
        Ok(acknowledgement)
    }
}
