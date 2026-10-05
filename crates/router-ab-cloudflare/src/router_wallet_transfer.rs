use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use router_ab_core::{RouterAbProtocolResult, RouterEd25519YaoExecuteResultV1};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::router_wallet::{
    lower_hex, RouterWalletOwnerV1, RouterWalletRegistrationRecordV1, RouterWalletRegistrationV1,
    RouterWalletStoreV1, OWNER_KEY, REGISTRATION_KEY_PREFIX,
};
use crate::router_wallet_relocation::{
    conflict, validate_request, Fence, FENCE_KEY, OWNERSHIP_GENERATION_KEY,
};
use crate::{RouterWalletFreezeReceiptV1, RouterWalletFreezeRequestV1};

pub const ROUTER_WALLET_TRANSFER_PATH_V1: &str = "/router-ab/router/wallet/transfer";
const ACTIVATION_KEY: &str = "relocation-activation";
const CLEANUP_BATCH_SIZE: u32 = 16;

/// The authenticated destination's acknowledgement, forwarded by the move coordinator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouterWalletActivationReceiptV1 {
    pub source: RouterWalletFreezeReceiptV1,
    pub destination_object: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ActivatedDestination {
    receipt: RouterWalletActivationReceiptV1,
    chunk_bytes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouterWalletTransferChunkV1 {
    pub receipt: RouterWalletFreezeReceiptV1,
    pub record_index: u64,
    pub segment_index: u32,
    pub segment_count: u32,
    pub chunk_bytes: u32,
    pub data_b64u: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RouterWalletTransferRequestV1 {
    Prepare {
        request: RouterWalletFreezeRequestV1,
        chunk_bytes: u32,
    },
    Export {
        receipt: RouterWalletFreezeReceiptV1,
        record_index: u64,
        segment_index: u32,
        chunk_bytes: u32,
    },
    Import {
        chunk: RouterWalletTransferChunkV1,
    },
    Verify {
        receipt: RouterWalletFreezeReceiptV1,
    },
    Activate {
        receipt: RouterWalletFreezeReceiptV1,
    },
    Cleanup {
        activation: RouterWalletActivationReceiptV1,
    },
}

impl RouterWalletTransferRequestV1 {
    pub fn ownership_generation(&self) -> u64 {
        match self {
            Self::Prepare { request, .. } => request.destination_generation,
            Self::Export { receipt, .. } => receipt.request.source_generation,
            Self::Import { chunk } => chunk.receipt.request.destination_generation,
            Self::Verify { receipt } => receipt.request.destination_generation,
            Self::Activate { receipt } => receipt.request.destination_generation,
            Self::Cleanup { activation } => activation.source.request.source_generation,
        }
    }

    pub fn owner(&self) -> &RouterWalletOwnerV1 {
        match self {
            Self::Prepare { request, .. } => &request.owner,
            Self::Export { receipt, .. }
            | Self::Verify { receipt }
            | Self::Activate { receipt } => &receipt.request.owner,
            Self::Import { chunk } => &chunk.receipt.request.owner,
            Self::Cleanup { activation } => &activation.source.request.owner,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RouterWalletTransferResponseV1 {
    Prepared {
        request: RouterWalletFreezeRequestV1,
        chunk_bytes: u32,
    },
    Exported {
        chunk: RouterWalletTransferChunkV1,
    },
    Imported {
        input_digest_hex: String,
        record_index: u64,
        segment_index: u32,
    },
    Verified {
        receipt: RouterWalletFreezeReceiptV1,
    },
    Activated {
        activation: RouterWalletActivationReceiptV1,
    },
    Cleaning {
        activation: RouterWalletActivationReceiptV1,
    },
    Cleaned {
        activation: RouterWalletActivationReceiptV1,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredChunk {
    chunk: RouterWalletTransferChunkV1,
    acknowledgement: RouterWalletTransferResponseV1,
}

/// The host commits each command and its acknowledgement in one wallet transaction.
pub async fn transfer_router_wallet_v1<Store: RouterWalletStoreV1>(
    store: &Store,
    command: RouterWalletTransferRequestV1,
) -> RouterAbProtocolResult<RouterWalletTransferResponseV1> {
    match command {
        RouterWalletTransferRequestV1::Prepare {
            request,
            chunk_bytes,
        } => prepare(store, request, chunk_bytes).await,
        RouterWalletTransferRequestV1::Export {
            receipt,
            record_index,
            segment_index,
            chunk_bytes,
        } => export(store, receipt, record_index, segment_index, chunk_bytes).await,
        RouterWalletTransferRequestV1::Import { chunk } => import(store, chunk).await,
        RouterWalletTransferRequestV1::Verify { receipt } => verify(store, receipt).await,
        RouterWalletTransferRequestV1::Activate { receipt } => activate(store, receipt).await,
        RouterWalletTransferRequestV1::Cleanup { activation } => cleanup(store, activation).await,
    }
}

async fn prepare<Store: RouterWalletStoreV1>(
    store: &Store,
    request: RouterWalletFreezeRequestV1,
    chunk_bytes: u32,
) -> RouterAbProtocolResult<RouterWalletTransferResponseV1> {
    validate_request(&request)?;
    validate_chunk_size(chunk_bytes)?;
    if let Some(activated) = store
        .get_json::<ActivatedDestination>(ACTIVATION_KEY)
        .await?
    {
        if activated.receipt.source.request != request || activated.chunk_bytes != chunk_bytes {
            return Err(conflict("Router destination preparation changed"));
        }
        return Ok(RouterWalletTransferResponseV1::Prepared {
            request,
            chunk_bytes,
        });
    }
    match store.get_json::<Fence>(FENCE_KEY).await? {
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
        ) if receipt.request == request && size == chunk_bytes => {}
        None => {
            if store
                .get_json::<RouterWalletOwnerV1>(OWNER_KEY)
                .await?
                .is_some()
                || store
                    .get_json::<u64>(OWNERSHIP_GENERATION_KEY)
                    .await?
                    .is_some()
                || !store.list_registrations().await?.is_empty()
            {
                return Err(conflict("Router import requires a fresh destination"));
            }
            store.put_json(OWNER_KEY, &request.owner).await?;
            store
                .put_json(OWNERSHIP_GENERATION_KEY, &request.destination_generation)
                .await?;
            store
                .put_json(
                    FENCE_KEY,
                    &Fence::Prepared {
                        request: request.clone(),
                        chunk_bytes,
                    },
                )
                .await?;
        }
        _ => return Err(conflict("Router destination preparation changed")),
    }
    Ok(RouterWalletTransferResponseV1::Prepared {
        request,
        chunk_bytes,
    })
}

async fn export<Store: RouterWalletStoreV1>(
    store: &Store,
    receipt: RouterWalletFreezeReceiptV1,
    record_index: u64,
    segment_index: u32,
    chunk_bytes: u32,
) -> RouterAbProtocolResult<RouterWalletTransferResponseV1> {
    validate_chunk_size(chunk_bytes)?;
    match store.get_json::<Fence>(FENCE_KEY).await? {
        Some(Fence::Frozen { receipt: stored }) if stored == receipt => {}
        _ => return Err(conflict("Router export requires its frozen source receipt")),
    }
    let mut records = store.list_registrations().await?;
    records.sort_by(|left, right| left.0.cmp(&right.0));
    let index =
        usize::try_from(record_index).map_err(|_| conflict("Router export position is invalid"))?;
    let record = records
        .get(index)
        .ok_or_else(|| conflict("Router export record is absent"))?;
    let bytes =
        serde_json::to_vec(record).map_err(|_| conflict("Router export record encoding failed"))?;
    let segment_count = u32::try_from(bytes.len().div_ceil(chunk_bytes as usize))
        .map_err(|_| conflict("Router record has too many segments"))?;
    if segment_index >= segment_count {
        return Err(conflict("Router export segment is absent"));
    }
    let start = segment_index as usize * chunk_bytes as usize;
    let end = (start + chunk_bytes as usize).min(bytes.len());
    Ok(RouterWalletTransferResponseV1::Exported {
        chunk: RouterWalletTransferChunkV1 {
            receipt,
            record_index,
            segment_index,
            segment_count,
            chunk_bytes,
            data_b64u: URL_SAFE_NO_PAD.encode(&bytes[start..end]),
        },
    })
}

async fn import<Store: RouterWalletStoreV1>(
    store: &Store,
    chunk: RouterWalletTransferChunkV1,
) -> RouterAbProtocolResult<RouterWalletTransferResponseV1> {
    validate_receipt(&chunk.receipt)?;
    validate_chunk_size(chunk.chunk_bytes)?;
    if chunk.record_index >= chunk.receipt.record_count
        || chunk.segment_count == 0
        || chunk.segment_index >= chunk.segment_count
        || chunk.data_b64u.len() > (chunk.chunk_bytes as usize).div_ceil(3) * 4
    {
        return Err(conflict("Router import chunk bounds are invalid"));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(&chunk.data_b64u)
        .map_err(|_| conflict("Router import chunk encoding is invalid"))?;
    if bytes.is_empty()
        || bytes.len() > chunk.chunk_bytes as usize
        || (chunk.segment_index + 1 < chunk.segment_count
            && bytes.len() != chunk.chunk_bytes as usize)
    {
        return Err(conflict("Router import chunk length is invalid"));
    }
    let key = chunk_key(&chunk, chunk.segment_index);
    if let Some(stored) = store.get_json::<StoredChunk>(&key).await? {
        if stored.chunk != chunk {
            return Err(conflict("Router import chunk inputs changed"));
        }
        return Ok(stored.acknowledgement);
    }
    match store.get_json::<Fence>(FENCE_KEY).await? {
        Some(Fence::Prepared {
            request,
            chunk_bytes,
        }) if request == chunk.receipt.request
            && chunk_bytes == chunk.chunk_bytes
            && chunk.record_index == 0
            && chunk.segment_index == 0 => {}
        Some(Fence::Importing {
            receipt,
            chunk_bytes,
            next_record,
            next_segment,
            segment_count,
        }) if receipt == chunk.receipt
            && chunk_bytes == chunk.chunk_bytes
            && next_record == chunk.record_index
            && next_segment == chunk.segment_index
            && (next_segment == 0 || segment_count == chunk.segment_count) => {}
        _ => return Err(conflict("Router import gate or position differs")),
    }
    let final_segment = chunk.segment_index + 1 == chunk.segment_count;
    if final_segment {
        let mut record_bytes = Vec::new();
        for position in 0..chunk.segment_index {
            let stored = store
                .get_json::<StoredChunk>(&chunk_key(&chunk, position))
                .await?
                .ok_or_else(|| conflict("Router import is missing an acknowledged segment"))?;
            record_bytes.extend(
                URL_SAFE_NO_PAD
                    .decode(stored.chunk.data_b64u)
                    .map_err(|_| conflict("Stored Router import segment is invalid"))?,
            );
        }
        record_bytes.extend(bytes);
        let (record_key, record): (String, RouterWalletRegistrationRecordV1) =
            serde_json::from_slice(&record_bytes)
                .map_err(|_| conflict("Router imported record is invalid"))?;
        validate_record(&chunk.receipt.request.owner, &record_key, &record)?;
        if store
            .get_json::<RouterWalletRegistrationRecordV1>(&record_key)
            .await?
            .is_some()
        {
            return Err(conflict("Router import would overwrite a record"));
        }
        store.put_json(&record_key, &record).await?;
    }
    let input = serde_json::to_vec(&chunk)
        .map_err(|_| conflict("Router import identity encoding failed"))?;
    let acknowledgement = RouterWalletTransferResponseV1::Imported {
        input_digest_hex: lower_hex(&Sha256::digest(input)),
        record_index: chunk.record_index,
        segment_index: chunk.segment_index,
    };
    store
        .put_json(
            FENCE_KEY,
            &Fence::Importing {
                receipt: chunk.receipt.clone(),
                chunk_bytes: chunk.chunk_bytes,
                next_record: chunk.record_index + u64::from(final_segment),
                next_segment: if final_segment {
                    0
                } else {
                    chunk.segment_index + 1
                },
                segment_count: chunk.segment_count,
            },
        )
        .await?;
    store
        .put_json(
            &key,
            &StoredChunk {
                chunk,
                acknowledgement: acknowledgement.clone(),
            },
        )
        .await?;
    Ok(acknowledgement)
}

async fn activate<Store: RouterWalletStoreV1>(
    store: &Store,
    receipt: RouterWalletFreezeReceiptV1,
) -> RouterAbProtocolResult<RouterWalletTransferResponseV1> {
    validate_receipt(&receipt)?;
    crate::router_wallet_relocation::require_ownership_generation(
        store,
        receipt.request.destination_generation,
    )
    .await?;
    if let Some(prior) = store
        .get_json::<ActivatedDestination>(ACTIVATION_KEY)
        .await?
    {
        if prior.receipt.source != receipt {
            return Err(conflict("Router destination activation changed"));
        }
        // A delayed activation retry must not reopen an object frozen by a later move.
        return Ok(RouterWalletTransferResponseV1::Activated {
            activation: prior.receipt,
        });
    }
    let chunk_bytes = match store.get_json::<Fence>(FENCE_KEY).await? {
        Some(Fence::Verified {
            receipt: verified,
            chunk_bytes,
        }) if verified == receipt => chunk_bytes,
        _ => {
            return Err(conflict(
                "Router activation requires its verified destination",
            ))
        }
    };
    let activation = RouterWalletActivationReceiptV1 {
        destination_object: receipt
            .request
            .owner
            .object_name(receipt.request.destination_generation)?,
        source: receipt,
    };
    store
        .put_json(
            ACTIVATION_KEY,
            &ActivatedDestination {
                receipt: activation.clone(),
                chunk_bytes,
            },
        )
        .await?;
    store.delete_key(FENCE_KEY).await?;
    Ok(RouterWalletTransferResponseV1::Activated { activation })
}

async fn cleanup<Store: RouterWalletStoreV1>(
    store: &Store,
    activation: RouterWalletActivationReceiptV1,
) -> RouterAbProtocolResult<RouterWalletTransferResponseV1> {
    validate_receipt(&activation.source)?;
    let request = &activation.source.request;
    crate::router_wallet_relocation::require_ownership_generation(store, request.source_generation)
        .await?;
    if activation.destination_object != request.owner.object_name(request.destination_generation)? {
        return Err(conflict("Router cleanup names another destination object"));
    }
    match store.get_json::<Fence>(FENCE_KEY).await? {
        Some(Fence::Frozen { receipt }) if receipt == activation.source => {}
        Some(Fence::Cleaning { activation: prior }) if prior == activation => {}
        Some(Fence::Cleaned { activation: prior }) if prior == activation => {
            return Ok(RouterWalletTransferResponseV1::Cleaned { activation });
        }
        _ => {
            return Err(conflict(
                "Router cleanup requires its frozen source and activation receipt",
            ))
        }
    }
    store
        .put_json(
            FENCE_KEY,
            &Fence::Cleaning {
                activation: activation.clone(),
            },
        )
        .await?;
    let mut remaining = CLEANUP_BATCH_SIZE;
    for prefix in [REGISTRATION_KEY_PREFIX, "relocation-import/"] {
        let keys = store.list_keys(prefix, remaining).await?;
        for key in &keys {
            store.delete_key(key).await?;
        }
        remaining -= keys.len() as u32;
        if remaining == 0 {
            return Ok(RouterWalletTransferResponseV1::Cleaning { activation });
        }
    }
    store
        .put_json(
            FENCE_KEY,
            &Fence::Cleaned {
                activation: activation.clone(),
            },
        )
        .await?;
    Ok(RouterWalletTransferResponseV1::Cleaned { activation })
}

async fn verify<Store: RouterWalletStoreV1>(
    store: &Store,
    receipt: RouterWalletFreezeReceiptV1,
) -> RouterAbProtocolResult<RouterWalletTransferResponseV1> {
    validate_receipt(&receipt)?;
    if let Some(activated) = store
        .get_json::<ActivatedDestination>(ACTIVATION_KEY)
        .await?
    {
        if activated.receipt.source != receipt {
            return Err(conflict("Router destination verification changed"));
        }
        return Ok(RouterWalletTransferResponseV1::Verified { receipt });
    }
    let chunk_bytes = match store.get_json::<Fence>(FENCE_KEY).await? {
        Some(Fence::Verified { receipt: prior, .. }) if prior == receipt => {
            return Ok(RouterWalletTransferResponseV1::Verified { receipt })
        }
        Some(Fence::Prepared {
            request,
            chunk_bytes,
        }) if request == receipt.request && receipt.record_count == 0 => chunk_bytes,
        Some(Fence::Importing {
            receipt: prior,
            chunk_bytes,
            next_record,
            next_segment: 0,
            ..
        }) if prior == receipt && next_record == receipt.record_count => chunk_bytes,
        _ => return Err(conflict("Router import is not complete")),
    };
    let mut records = store.list_registrations().await?;
    records.sort_by(|left, right| left.0.cmp(&right.0));
    for (key, record) in &records {
        validate_record(&receipt.request.owner, key, record)?;
    }
    let bytes = serde_json::to_vec(&(&receipt.request, &records))
        .map_err(|_| conflict("Router verification encoding failed"))?;
    let mut digest = Sha256::new();
    digest.update(b"seams/router/wallet-snapshot/v1");
    digest.update(bytes);
    if records.len() as u64 != receipt.record_count
        || lower_hex(&digest.finalize()) != receipt.records_digest_hex
    {
        return Err(conflict(
            "Router destination differs from the frozen snapshot",
        ));
    }
    store
        .put_json(
            FENCE_KEY,
            &Fence::Verified {
                receipt: receipt.clone(),
                chunk_bytes,
            },
        )
        .await?;
    Ok(RouterWalletTransferResponseV1::Verified { receipt })
}

fn validate_record(
    owner: &RouterWalletOwnerV1,
    key: &str,
    record: &RouterWalletRegistrationRecordV1,
) -> RouterAbProtocolResult<()> {
    let (lifecycle, digest, request, response, completed) = match record {
        RouterWalletRegistrationRecordV1::Completed {
            lifecycle_id,
            request_digest_hex,
            request_json,
            response_json,
            consumer_binding: Some(_),
            ..
        } => (
            lifecycle_id,
            request_digest_hex,
            request_json,
            response_json,
            true,
        ),
        RouterWalletRegistrationRecordV1::Failed {
            lifecycle_id,
            request_digest_hex,
            request_json,
            response_json,
            ..
        } => (
            lifecycle_id,
            request_digest_hex,
            request_json,
            response_json,
            false,
        ),
        _ => return Err(conflict("Router import contains an unsettled registration")),
    };
    let decoded = crate::router_wallet::decode_stored_registration_request(request)?;
    let registration = RouterWalletRegistrationV1::from_request(&decoded)?
        .ok_or_else(|| conflict("Router historical request is not a registration"))?;
    let answer: RouterEd25519YaoExecuteResultV1 = serde_json::from_str(response)
        .map_err(|_| conflict("Router historical answer is invalid"))?;
    let terminal = match answer {
        RouterEd25519YaoExecuteResultV1::Succeeded { .. } => completed,
        RouterEd25519YaoExecuteResultV1::Rejected { .. }
        | RouterEd25519YaoExecuteResultV1::Burned { .. } => !completed,
        RouterEd25519YaoExecuteResultV1::RecoverableFailure { .. } => false,
    };
    if &registration.owner != owner
        || &registration.lifecycle_id != lifecycle
        || &crate::router_wallet::registration_request_digest(request) != digest
        || key != format!("{REGISTRATION_KEY_PREFIX}{lifecycle}")
        || !terminal
    {
        return Err(conflict("Router historical record binding is invalid"));
    }
    Ok(())
}

fn validate_chunk_size(size: u32) -> RouterAbProtocolResult<()> {
    if !(1024..=65536).contains(&size) {
        return Err(conflict("Router transfer chunk size must be 1 to 64 KiB"));
    }
    Ok(())
}

fn validate_receipt(receipt: &RouterWalletFreezeReceiptV1) -> RouterAbProtocolResult<()> {
    validate_request(&receipt.request)?;
    if receipt.record_count > 9_007_199_254_740_991
        || receipt.records_digest_hex.len() != 64
        || !receipt
            .records_digest_hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(conflict("Router frozen receipt is invalid"));
    }
    Ok(())
}

fn chunk_key(chunk: &RouterWalletTransferChunkV1, segment: u32) -> String {
    format!(
        "relocation-import/{}/{}/{segment}",
        chunk.receipt.request.move_id, chunk.record_index
    )
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_transfer(
    mut request: worker::Request,
    env: &worker::Env,
) -> worker::Result<worker::Response> {
    if request.method() != worker::Method::Post {
        return worker::Response::error("Router wallet transfer requires POST", 405);
    }
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    let transfer = match request.json::<RouterWalletTransferRequestV1>().await {
        Ok(transfer) => transfer,
        Err(error) => {
            return crate::router_coordinator::protocol_error_response(
                router_ab_core::RouterAbProtocolError::new(
                    router_ab_core::RouterAbProtocolErrorCode::MalformedWirePayload,
                    format!("Router wallet transfer request is malformed: {error}"),
                ),
            )
        }
    };
    match crate::durable_object::call_router_wallet_transfer_v1(env, &transfer).await {
        Ok(response) => worker::Response::from_json(&response),
        Err(error) => crate::router_coordinator::protocol_error_response(error),
    }
}
