use super::*;

pub(crate) const PATH: &str = "/router-ab/signing-worker/linked-presign-session/transfer";
pub(crate) const INTERNAL_PATH: &str =
    "/router-ab/internal/signing-worker/linked-ecdsa-presign-session/transfer";
const IMPORT_KEY: &str = "linked-presign-relocation-import";

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Preparation {
    wallet_scope: crate::CloudflareSigningWorkerWalletScopeV1,
    presign_session_id: String,
    server_presignature_id: String,
    request: crate::SigningWorkerRelocationIdentityV1,
}

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

impl Command {
    fn validate(&self) -> RouterAbProtocolResult<()> {
        match self {
            Self::Prepare { command, .. } => command.validate(),
            Self::Import { chunk } => chunk.receipt.command.validate(),
            Self::Verify { receipt } | Self::Status { receipt, .. } | Self::Cleanup { receipt } => receipt.command.validate(),
        }
    }

    fn identity(&self) -> Preparation {
        match self {
            Self::Prepare { command, .. } => command.clone(),
            Self::Import { chunk } => Preparation::from_source(&chunk.receipt.command),
            Self::Verify { receipt } | Self::Status { receipt, .. } | Self::Cleanup { receipt } => Preparation::from_source(&receipt.command),
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

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum ImportState {
    Prepared {
        command: Preparation,
        chunk_bytes: u32,
    },
    Importing {
        receipt: LinkedPresignFreezeReceipt,
        chunk_bytes: u32,
        segment_count: u32,
        next_segment: u32,
    },
    Verified {
        receipt: LinkedPresignFreezeReceipt,
        chunk_bytes: u32,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredChunk {
    chunk: SnapshotChunk,
    acknowledgement: Receipt,
}

pub(crate) async fn forward(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
) -> worker::Result<worker::Response> {
    let wallet_objects = crate::WalletObjectRoute::from_gateway_request(&request)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    if request.method() != worker::Method::Post {
        return worker::Response::error("Linked presign transfer requires POST", 405);
    }
    let command: Command = match request.json().await {
        Ok(command) => command,
        Err(_) => {
            return worker::Response::error("Linked presign transfer request is malformed", 400)
        }
    };
    if let Err(error) = command.validate() {
        return presign_do_error_response(error);
    }
    let result: RouterAbProtocolResult<Receipt> =
        super::super::execute_cloudflare_durable_object_custom_json_call_v1(
            env,
            wallet_objects,
            &runtime.bindings().presign_session,
            INTERNAL_PATH,
            super::super::PresignHost::LinkedSession {
                session_id: &command.identity().server_presignature_id,
                ownership_generation: match &command {
                    Command::Cleanup { receipt } => receipt.command.request.source_generation,
                    Command::Prepare { .. } | Command::Import { .. }
                    | Command::Verify { .. } | Command::Status { .. } => command.identity().request.source_generation + 1,
                },
            },
            &command,
        )
        .await;
    match result {
        Ok(receipt) => worker::Response::from_json(&receipt),
        Err(error) => presign_do_error_response(error),
    }
}

pub(super) async fn handle(
    mut request: worker::Request,
    storage: &worker::Storage,
) -> RouterAbProtocolResult<worker::Response> {
    if request.method() != worker::Method::Post {
        return Err(storage_error("Linked presign transfer requires POST"));
    }
    let command: Command = request.json().await.map_err(storage_error)?;
    command.validate()?;
    let outcome = Rc::new(RefCell::new(None));
    let result = Rc::clone(&outcome);
    storage
        .transaction(move |transaction| async move {
            let receipt = match command {
                Command::Prepare {
                    command,
                    chunk_bytes,
                } => prepare(&transaction, command, chunk_bytes).await?,
                Command::Cleanup { receipt } => super::cleanup::advance(&transaction, receipt).await?,
                Command::Import { chunk } => import(&transaction, chunk).await?,
                Command::Verify { receipt } => verify(&transaction, receipt).await?,
                Command::Status { receipt, chunk_bytes } => status(&transaction, receipt, chunk_bytes).await?,
            };
            result.replace(Some(receipt));
            Ok(())
        })
        .await
        .map_err(storage_error)?;
    let receipt = outcome
        .borrow_mut()
        .take()
        .ok_or_else(|| storage_error("Missing linked presign transfer result"))?;
    worker::Response::from_json(&receipt).map_err(storage_error)
}

async fn status(
    transaction: &worker::Transaction,
    receipt: LinkedPresignFreezeReceipt,
    chunk_bytes: u32,
) -> worker::Result<Receipt> {
    validate_chunk_bytes(chunk_bytes).map_err(transaction_error)?;
    match transaction_get_optional::<ImportState>(transaction, IMPORT_KEY).await? {
        Some(ImportState::Prepared { command, chunk_bytes: size })
            if command == Preparation::from_source(&receipt.command) && size == chunk_bytes =>
        {
            Ok(Receipt::Prepared { command, chunk_bytes })
        }
        Some(ImportState::Importing { receipt: prior, chunk_bytes: size, segment_count, next_segment })
            if prior == receipt && size == chunk_bytes =>
        {
            Ok(Receipt::Receiving { receipt, chunk_bytes, segment_count, next_segment })
        }
        Some(ImportState::Verified { receipt: prior, chunk_bytes: size })
            if prior == receipt && size == chunk_bytes =>
        {
            Ok(Receipt::Verified { receipt })
        }
        _ => Err(transaction_error("Linked presign status identity differs")),
    }
}

async fn prepare(
    transaction: &worker::Transaction,
    command: Preparation,
    chunk_bytes: u32,
) -> worker::Result<Receipt> {
    validate_chunk_bytes(chunk_bytes).map_err(transaction_error)?;
    match transaction_get_optional::<ImportState>(transaction, IMPORT_KEY).await? {
        Some(ImportState::Prepared {
            command: prior,
            chunk_bytes: size,
        }) if prior == command && size == chunk_bytes => {}
        Some(
            ImportState::Importing {
                receipt,
                chunk_bytes: size,
                ..
            }
            | ImportState::Verified {
                receipt,
                chunk_bytes: size,
            },
        ) if Preparation::from_source(&receipt.command) == command && size == chunk_bytes => {}
        None => {
            if transaction
                .list_with_options(worker::ListOptions::new().limit(1))
                .await?
                .size()
                != 0
            {
                return Err(transaction_error(
                    "Linked presign import requires a fresh destination",
                ));
            }
            transaction
                .put(
                    IMPORT_KEY,
                    &ImportState::Prepared {
                        command: command.clone(),
                        chunk_bytes,
                    },
                )
                .await?;
        }
        _ => {
            return Err(transaction_error(
                "Linked presign destination preparation changed",
            ))
        }
    }
    Ok(Receipt::Prepared {
        command,
        chunk_bytes,
    })
}

fn chunk_key(index: u32) -> String {
    format!("linked-presign-relocation-chunk/{index}")
}

fn decode_chunk(chunk: &SnapshotChunk) -> RouterAbProtocolResult<Vec<u8>> {
    chunk.receipt.command.validate()?;
    validate_chunk_bytes(chunk.chunk_bytes)?;
    if chunk.segment_count == 0
        || chunk.segment_index >= chunk.segment_count
        || chunk.data_b64u.len() > (chunk.chunk_bytes as usize).div_ceil(3) * 4
    {
        return Err(storage_error("Linked presign chunk bounds are invalid"));
    }
    let bytes = crate::decode_base64url_bytes_v1("Linked presign chunk", &chunk.data_b64u)?;
    if bytes.is_empty()
        || bytes.len() > chunk.chunk_bytes as usize
        || (chunk.segment_index + 1 < chunk.segment_count
            && bytes.len() != chunk.chunk_bytes as usize)
        || crate::encode_base64url_bytes_v1(&bytes) != chunk.data_b64u
    {
        return Err(storage_error(
            "Linked presign chunk encoding or length is invalid",
        ));
    }
    Ok(bytes)
}

async fn import(
    transaction: &worker::Transaction,
    chunk: SnapshotChunk,
) -> worker::Result<Receipt> {
    decode_chunk(&chunk).map_err(transaction_error)?;
    let key = chunk_key(chunk.segment_index);
    if let Some(stored) = transaction_get_optional::<StoredChunk>(transaction, &key).await? {
        if stored.chunk != chunk {
            return Err(transaction_error("Linked presign import chunk changed"));
        }
        return Ok(stored.acknowledgement);
    }
    match transaction_get_optional::<ImportState>(transaction, IMPORT_KEY).await? {
        Some(ImportState::Prepared {
            command,
            chunk_bytes,
        }) if command == Preparation::from_source(&chunk.receipt.command)
            && chunk_bytes == chunk.chunk_bytes
            && chunk.segment_index == 0 => {}
        Some(ImportState::Importing {
            receipt,
            chunk_bytes,
            segment_count,
            next_segment,
        }) if receipt == chunk.receipt
            && chunk_bytes == chunk.chunk_bytes
            && segment_count == chunk.segment_count
            && next_segment == chunk.segment_index => {}
        _ => {
            return Err(transaction_error(
                "Linked presign import differs from prepared progress",
            ))
        }
    }
    let input = serde_json::to_vec(&chunk).map_err(transaction_error)?;
    let acknowledgement = Receipt::Imported {
        segment_index: chunk.segment_index,
        input_digest_hex: format!("{:x}", Sha256::digest(&input)),
    };
    transaction
        .put(
            IMPORT_KEY,
            &ImportState::Importing {
                receipt: chunk.receipt.clone(),
                chunk_bytes: chunk.chunk_bytes,
                segment_count: chunk.segment_count,
                next_segment: chunk.segment_index + 1,
            },
        )
        .await?;
    transaction
        .put(
            &key,
            &StoredChunk {
                chunk,
                acknowledgement: acknowledgement.clone(),
            },
        )
        .await?;
    Ok(acknowledgement)
}

async fn verify(
    transaction: &worker::Transaction,
    receipt: LinkedPresignFreezeReceipt,
) -> worker::Result<Receipt> {
    let (chunk_bytes, segment_count) =
        match transaction_get_optional::<ImportState>(transaction, IMPORT_KEY).await? {
            Some(ImportState::Verified { receipt: prior, .. }) if prior == receipt => {
                return Ok(Receipt::Verified { receipt })
            }
            Some(ImportState::Importing {
                receipt: prior,
                chunk_bytes,
                segment_count,
                next_segment,
            }) if prior == receipt && segment_count == next_segment => (chunk_bytes, segment_count),
            _ => {
                return Err(transaction_error(
                    "Linked presign verification requires all segments",
                ))
            }
        };
    let mut bytes = Vec::new();
    for index in 0..segment_count {
        let stored: StoredChunk = transaction.get(&chunk_key(index)).await?;
        if stored.chunk.receipt != receipt
            || stored.chunk.segment_index != index
            || stored.chunk.segment_count != segment_count
            || stored.chunk.chunk_bytes != chunk_bytes
        {
            return Err(transaction_error("Linked presign staged chunk differs"));
        }
        bytes.extend(decode_chunk(&stored.chunk).map_err(transaction_error)?);
    }
    if snapshot_digest(&bytes) != receipt.records_digest_hex {
        return Err(transaction_error("Linked presign imported digest differs"));
    }
    let snapshot: Snapshot = serde_json::from_slice(&bytes).map_err(transaction_error)?;
    if serde_json::to_vec(&snapshot).map_err(transaction_error)? != bytes {
        return Err(transaction_error(
            "Linked presign snapshot encoding differs",
        ));
    }
    match snapshot {
        Snapshot::Uninitialized {
            command,
            request_digest_hex,
        } => {
            if command != receipt.command
                || receipt.record_count != 1
                || request_digest_hex.len() != 64
                || !request_digest_hex
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(transaction_error(
                    "Linked presign uninitialized history differs",
                ));
            }
        }
        Snapshot::Initialized {
            command,
            authority,
            completion,
        } => {
            authority.validate().map_err(transaction_error)?;
            if command != receipt.command
                || authority.ownership_generation != receipt.command.request.source_generation
                || authority.wallet_scope != receipt.command.wallet_scope
                || authority.presign_session_id != receipt.command.presign_session_id
                || authority.request.client_presignature_id
                    != receipt.command.server_presignature_id
            {
                return Err(transaction_error(
                    "Linked presign historical authority differs",
                ));
            }
            let count = match &completion {
                CompletionHistory::NoStoredCompletion => 1,
                CompletionHistory::Retired { completion } => {
                    completion
                        .validate_for_authority(&authority)
                        .map_err(transaction_error)?;
                    2
                }
            };
            if count != receipt.record_count {
                return Err(transaction_error(
                    "Linked presign historical record count differs",
                ));
            }
            transaction
                .put(
                    super::super::ecdsa_presign_live_session::LINKED_PRESIGN_AUTHORITY_STORAGE_KEY,
                    &authority,
                )
                .await?;
            if let CompletionHistory::Retired { completion } = completion {
                super::super::linked_presign_history::persist_retirement(transaction, &completion)
                    .await?;
            }
        }
    }
    transaction.put(FENCE_KEY, &LinkedPresignFenceReceipt {
        command: receipt.command.clone(),
        initialization: Initialization::Imported,
    }).await?;
    transaction
        .put(
            SNAPSHOT_KEY,
            &FrozenSnapshot {
                receipt: receipt.clone(),
                snapshot_json: String::from_utf8(bytes).map_err(transaction_error)?,
            },
        )
        .await?;
    transaction
        .put(
            IMPORT_KEY,
            &ImportState::Verified {
                receipt: receipt.clone(),
                chunk_bytes,
            },
        )
        .await?;
    Ok(Receipt::Verified { receipt })
}

pub(super) async fn has_import(storage: &worker::Storage) -> RouterAbProtocolResult<bool> {
    storage.get::<ImportState>(IMPORT_KEY).await.map(|state| state.is_some()).map_err(storage_error)
}

pub(super) async fn has_import_transaction(transaction: &worker::Transaction) -> worker::Result<bool> {
    Ok(transaction_get_optional::<ImportState>(transaction, IMPORT_KEY).await?.is_some())
}
