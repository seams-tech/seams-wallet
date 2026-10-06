use super::relocation::Fence;
use super::transfer::validate_chunk_bytes;
use super::*;
mod stream;

pub const SIGNING_WORKER_ECDSA_TRANSFER_PATH_V1: &str =
    "/router-ab/signing-worker/wallet/ecdsa/transfer";

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ecdsa_import_chunks (
    owner_json TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    chunk_json TEXT NOT NULL,
    acknowledgement_json TEXT NOT NULL,
    PRIMARY KEY(owner_json, segment_index))";

pub(super) const ACTIVATION_SCHEMA: &str =
    "CREATE TABLE IF NOT EXISTS wallet_ecdsa_import_activation (
    owner_json TEXT PRIMARY KEY,
    receipt_json TEXT NOT NULL,
    chunk_bytes INTEGER NOT NULL)";

#[derive(Deserialize)]
struct ImportActivationRow {
    receipt_json: String,
    chunk_bytes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerEcdsaTransferRequestV1 {
    Prepare {
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: SigningWorkerRelocationIdentityV1,
        chunk_bytes: u32,
    },
    Status {
        receipt: SigningWorkerPoolFreezeReceiptV1,
        chunk_bytes: u32,
    },
    Import {
        chunk: SigningWorkerEcdsaSnapshotChunkV1,
    },
    Verify {
        receipt: SigningWorkerPoolFreezeReceiptV1,
    },
    Activate {
        receipt: SigningWorkerPoolFreezeReceiptV1,
    },
    Cleanup {
        activation: SigningWorkerPoolFreezeReceiptV1,
    },
}

impl SigningWorkerEcdsaTransferRequestV1 {
    pub fn scope(&self) -> &CloudflareSigningWorkerWalletScopeV1 {
        match self {
            Self::Prepare { scope, .. } => scope,
            Self::Cleanup { activation } => &activation.scope,
            Self::Import { chunk } => &chunk.receipt.scope,
            Self::Status { receipt, .. }
            | Self::Verify { receipt }
            | Self::Activate { receipt } => &receipt.scope,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerEcdsaTransferResponseV1 {
    Prepared {
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: SigningWorkerRelocationIdentityV1,
        chunk_bytes: u32,
    },
    Receiving {
        receipt: SigningWorkerPoolFreezeReceiptV1,
        chunk_bytes: u32,
        segment_count: u32,
        next_segment: u32,
    },
    Imported {
        segment_index: u32,
        input_digest_hex: String,
    },
    Verified {
        receipt: SigningWorkerPoolFreezeReceiptV1,
    },
    Activated {
        receipt: SigningWorkerPoolFreezeReceiptV1,
    },
    Cleaning {
        receipt: SigningWorkerPoolFreezeReceiptV1,
    },
    Cleaned {
        receipt: SigningWorkerPoolFreezeReceiptV1,
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
            SigningWorkerEcdsaTransferRequestV1::Cleanup { activation } => {
                self.cleanup_ecdsa_source(activation)
            }
            SigningWorkerEcdsaTransferRequestV1::Prepare {
                scope,
                request,
                chunk_bytes,
            } => self.prepare_ecdsa_import(scope, request, chunk_bytes),
            SigningWorkerEcdsaTransferRequestV1::Status {
                receipt,
                chunk_bytes,
            } => self.ecdsa_import_status(receipt, chunk_bytes),
            SigningWorkerEcdsaTransferRequestV1::Import { chunk } => self.import_ecdsa_chunk(chunk),
            SigningWorkerEcdsaTransferRequestV1::Activate { receipt } => {
                self.activate_ecdsa_import(receipt)
            }
            SigningWorkerEcdsaTransferRequestV1::Verify { receipt } => {
                self.verify_ecdsa_import(receipt)
            }
        }
    }

    pub(super) fn import_activation(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<Option<(SigningWorkerPoolFreezeReceiptV1, u32)>> {
        let rows = self.sql.query::<ImportActivationRow>(
            "SELECT receipt_json, chunk_bytes FROM wallet_ecdsa_import_activation WHERE owner_json = ?",
            vec![text(owner_json(scope, "ECDSA import activation")?)],
        )?;
        match rows.as_slice() {
            [] => Ok(None),
            [row] => {
                let receipt: SigningWorkerPoolFreezeReceiptV1 =
                    serde_json::from_str(&row.receipt_json)
                        .map_err(|error| wallet_error(error.to_string()))?;
                validate_receipt(&receipt)?;
                if receipt.scope != *scope {
                    return Err(wallet_error("ECDSA activation scope differs"));
                }
                Ok(Some((receipt, row.chunk_bytes)))
            }
            _ => Err(wallet_error("ECDSA import activation is duplicated")),
        }
    }

    fn activate_ecdsa_import(
        &self,
        receipt: SigningWorkerPoolFreezeReceiptV1,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaTransferResponseV1> {
        validate_receipt(&receipt)?;
        if let Some((prior, _)) = self.import_activation(&receipt.scope)? {
            if prior != receipt {
                return Err(wallet_error("ECDSA import activation changed"));
            }
            self.require_execution_generation(
                &receipt.scope,
                receipt.request.source_generation + 1,
            )?;
            // An exact retry must never remove a later move's source fence.
            return Ok(SigningWorkerEcdsaTransferResponseV1::Activated { receipt });
        }
        let chunk_bytes = match self.pool_fence(&receipt.scope)? {
            Some(Fence::Verified {
                receipt: prior,
                chunk_bytes,
            }) if prior == receipt => chunk_bytes,
            _ => {
                return Err(wallet_error(
                    "ECDSA activation requires its verified destination",
                ))
            }
        };
        self.install_execution_authority(
            &receipt.scope,
            execution::ExecutionAuthority::Relocation {
                request: receipt.request.clone(),
            },
        )?;
        let owner = owner_json(&receipt.scope, "ECDSA import activation")?;
        let encoded =
            serde_json::to_string(&receipt).map_err(|error| wallet_error(error.to_string()))?;
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_ecdsa_import_activation (owner_json, receipt_json, chunk_bytes) VALUES (?, ?, ?)",
            vec![text(owner.clone()), text(encoded), SigningWorkerWalletSqlValueV1::Integer(chunk_bytes.into())],
        )?;
        self.sql.query::<serde::de::IgnoredAny>(
            "DELETE FROM wallet_ecdsa_pool_relocation WHERE owner_json = ?",
            vec![text(owner)],
        )?;
        Ok(SigningWorkerEcdsaTransferResponseV1::Activated { receipt })
    }

    fn prepare_ecdsa_import(
        &self,
        scope: CloudflareSigningWorkerWalletScopeV1,
        request: SigningWorkerRelocationIdentityV1,
        chunk_bytes: u32,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaTransferResponseV1> {
        scope.validate()?;
        request.validate()?;
        validate_chunk_bytes(chunk_bytes)?;
        if let Some(Fence::Cleaned { receipt }) = self.pool_fence(&scope)? {
            if request.source_generation <= receipt.request.source_generation
                || request.move_id == receipt.request.move_id
                || !self.completed_cleanup(&receipt)?
            {
                return Err(wallet_error("ECDSA return requires a later ownership generation"));
            }
            let owner = owner_json(&scope, "ECDSA return preparation")?;
            for table in ["wallet_ecdsa_execution", "wallet_ecdsa_import_activation"] {
                self.sql.query::<serde::de::IgnoredAny>(
                    &format!("DELETE FROM {table} WHERE owner_json = ?"),
                    vec![text(owner.clone())],
                )?;
            }
            self.save_pool_fence(&scope, &Fence::Prepared {
                request: request.clone(),
                chunk_bytes,
            })?;
        }
        if let Some((receipt, size)) = self.import_activation(&scope)? {
            if receipt.request.identity() != request || size != chunk_bytes {
                return Err(wallet_error("ECDSA destination preparation changed"));
            }
            return Ok(SigningWorkerEcdsaTransferResponseV1::Prepared {
                scope,
                request,
                chunk_bytes,
            });
        }
        match self.pool_fence(&scope)? {
            Some(Fence::Prepared {
                request: prior,
                chunk_bytes: size,
            }) if prior == request && size == chunk_bytes => {}
            Some(
                Fence::Importing {
                    receipt,
                    chunk_bytes: size,
                    ..
                }
                | Fence::Verified {
                    receipt,
                    chunk_bytes: size,
                },
            ) if receipt.request.identity() == request && size == chunk_bytes => {}
            None => {
                let chunks = self.sql.query::<StoredChunk>(
                    "SELECT chunk_json, acknowledgement_json FROM wallet_ecdsa_import_chunks WHERE owner_json = ? LIMIT 1",
                    vec![text(owner_json(&scope, "ECDSA import")?)],
                )?;
                if self.ecdsa_snapshot_record_count(&scope)? != 0 || !chunks.is_empty() {
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

    // Read durable progress without admitting writes or opening the import gate.
    fn ecdsa_import_status(
        &self,
        receipt: SigningWorkerPoolFreezeReceiptV1,
        chunk_bytes: u32,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaTransferResponseV1> {
        validate_receipt(&receipt)?;
        validate_chunk_bytes(chunk_bytes)?;
        if let Some((prior, size)) = self.import_activation(&receipt.scope)? {
            if prior != receipt || size != chunk_bytes {
                return Err(wallet_error("ECDSA import status identity differs"));
            }
            return Ok(SigningWorkerEcdsaTransferResponseV1::Activated { receipt });
        }
        match self.pool_fence(&receipt.scope)? {
            Some(Fence::Prepared {
                request,
                chunk_bytes: size,
            }) if request == receipt.request.identity() && size == chunk_bytes => {
                Ok(SigningWorkerEcdsaTransferResponseV1::Prepared {
                    scope: receipt.scope,
                    request,
                    chunk_bytes,
                })
            }
            Some(Fence::Importing {
                receipt: stored,
                chunk_bytes: size,
                segment_count,
                next_segment,
            }) if stored == receipt && size == chunk_bytes => {
                Ok(SigningWorkerEcdsaTransferResponseV1::Receiving {
                    receipt,
                    chunk_bytes,
                    segment_count,
                    next_segment,
                })
            }
            Some(Fence::Verified {
                receipt: stored,
                chunk_bytes: size,
            }) if stored == receipt && size == chunk_bytes => {
                Ok(SigningWorkerEcdsaTransferResponseV1::Verified { receipt })
            }
            _ => Err(wallet_error("ECDSA import status identity differs")),
        }
    }

    fn import_ecdsa_chunk(
        &self,
        chunk: SigningWorkerEcdsaSnapshotChunkV1,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaTransferResponseV1> {
        decode_chunk(&chunk)?;
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
            }) if request == chunk.receipt.request.identity()
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

pub(super) fn validate_receipt(
    receipt: &SigningWorkerPoolFreezeReceiptV1,
) -> RouterAbProtocolResult<()> {
    receipt.scope.validate()?;
    receipt.request.validate()?;
    if receipt.wallet_records_digest_hex.len() != 64
        || !receipt
            .wallet_records_digest_hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(wallet_error("ECDSA import receipt digest is invalid"));
    }
    Ok(())
}

fn decode_chunk(chunk: &SigningWorkerEcdsaSnapshotChunkV1) -> RouterAbProtocolResult<Vec<u8>> {
    validate_receipt(&chunk.receipt)?;
    validate_chunk_bytes(chunk.chunk_bytes)?;
    if chunk.segment_count == 0
        || chunk.segment_index >= chunk.segment_count
        || chunk.data_b64u.len() > (chunk.chunk_bytes as usize).div_ceil(3) * 4
    {
        return Err(wallet_error("ECDSA import chunk bounds are invalid"));
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
    Ok(data)
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    fn verify_ecdsa_import(
        &self,
        receipt: SigningWorkerPoolFreezeReceiptV1,
    ) -> RouterAbProtocolResult<SigningWorkerEcdsaTransferResponseV1> {
        validate_receipt(&receipt)?;
        if let Some((prior, _)) = self.import_activation(&receipt.scope)? {
            if prior != receipt {
                return Err(wallet_error("ECDSA verification receipt changed"));
            }
            return Ok(SigningWorkerEcdsaTransferResponseV1::Verified { receipt });
        }
        let (chunk_bytes, segment_count) = match self.pool_fence(&receipt.scope)? {
            Some(Fence::Verified {
                receipt: stored, ..
            }) if stored == receipt => {
                return Ok(SigningWorkerEcdsaTransferResponseV1::Verified { receipt });
            }
            Some(Fence::Importing {
                receipt: stored,
                chunk_bytes,
                segment_count,
                next_segment,
            }) if stored == receipt && next_segment == segment_count => {
                (chunk_bytes, segment_count)
            }
            _ => {
                return Err(wallet_error(
                    "ECDSA verification requires all staged segments",
                ))
            }
        };
        let scope = receipt.scope.clone();
        let request = receipt.request.clone();
        if self.ecdsa_snapshot_record_count(&scope)? != 0 {
            return Err(wallet_error("ECDSA restore destination contains ordinary records"));
        }
        let mut reader = stream::ChunkReader::new(self.sql, &receipt, segment_count, chunk_bytes)?;
        self.restore_ecdsa_snapshot(&receipt, &mut reader)?;
        reader.verify()?;
        if self.ecdsa_snapshot_digest(&scope, &request)? != receipt.wallet_records_digest_hex {
            return Err(wallet_error("Restored ECDSA inventory differs from source"));
        }
        self.save_pool_fence(
            &scope,
            &Fence::Verified {
                receipt: receipt.clone(),
                chunk_bytes,
            },
        )?;
        Ok(SigningWorkerEcdsaTransferResponseV1::Verified { receipt })
    }
}
