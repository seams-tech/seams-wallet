use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::router_wallet::{
    RouterWalletOwnerV1, RouterWalletRegistrationRecordV1, RouterWalletStoreV1, OWNER_KEY,
    REGISTRATION_KEY_PREFIX,
};

pub const ROUTER_WALLET_FREEZE_PATH_V1: &str = "/router-ab/router/wallet/freeze";
pub(crate) const FENCE_KEY: &str = "relocation-fence";
pub(crate) const OWNERSHIP_GENERATION_KEY: &str = "ownership-generation";

/// The admitted move's immutable identity, supplied through the private Router boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouterWalletFreezeRequestV1 {
    pub owner: RouterWalletOwnerV1,
    pub move_id: String,
    pub request_digest_hex: String,
    pub source_generation: u64,
    pub destination_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouterWalletFreezeReceiptV1 {
    pub request: RouterWalletFreezeRequestV1,
    pub records_digest_hex: String,
    pub record_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum RouterWalletFreezeResponseV1 {
    Draining {
        unsettled_lifecycles: Vec<String>,
    },
    Frozen {
        receipt: RouterWalletFreezeReceiptV1,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Fence {
    Draining {
        request: RouterWalletFreezeRequestV1,
    },
    Frozen {
        receipt: RouterWalletFreezeReceiptV1,
    },
    Prepared {
        request: RouterWalletFreezeRequestV1,
        chunk_bytes: u32,
    },
    Importing {
        receipt: RouterWalletFreezeReceiptV1,
        chunk_bytes: u32,
        next_record: u64,
        next_segment: u32,
        segment_count: u32,
    },
    Verified {
        receipt: RouterWalletFreezeReceiptV1,
        chunk_bytes: u32,
    },
    Cleaning {
        activation: crate::RouterWalletActivationReceiptV1,
    },
    Cleaned {
        activation: crate::RouterWalletActivationReceiptV1,
    },
}

/// Older fixed-home stores predate this metadata and belong to generation one.
pub(crate) async fn require_ownership_generation<Store: RouterWalletStoreV1>(
    store: &Store,
    requested: u64,
) -> RouterAbProtocolResult<()> {
    let stored = store
        .get_json::<u64>(OWNERSHIP_GENERATION_KEY)
        .await?
        .unwrap_or(1);
    if requested == 0 || requested > 9_007_199_254_740_991 || requested != stored {
        return Err(conflict("Router wallet ownership generation does not match"));
    }
    Ok(())
}

pub(crate) async fn admit_ordinary_command<Store: RouterWalletStoreV1>(
    store: &Store,
) -> RouterAbProtocolResult<()> {
    match store.get_json::<Fence>(FENCE_KEY).await? {
        Some(
            Fence::Prepared { .. }
            | Fence::Importing { .. }
            | Fence::Verified { .. }
            | Fence::Cleaning { .. }
            | Fence::Cleaned { .. },
        ) => Err(paused()),
        _ => Ok(()),
    }
}

/// Must share the store transaction with the admitted write.
pub(crate) async fn admit_new_registration<Store: RouterWalletStoreV1>(
    store: &Store,
) -> RouterAbProtocolResult<()> {
    if store.get_json::<Fence>(FENCE_KEY).await?.is_some() {
        return Err(paused());
    }
    Ok(())
}

/// Existing claims can settle until the immutable snapshot is sealed.
pub(crate) async fn admit_settlement<Store: RouterWalletStoreV1>(
    store: &Store,
) -> RouterAbProtocolResult<()> {
    if matches!(
        store.get_json::<Fence>(FENCE_KEY).await?,
        Some(
            Fence::Frozen { .. }
                | Fence::Prepared { .. }
                | Fence::Importing { .. }
                | Fence::Verified { .. }
                | Fence::Cleaning { .. }
                | Fence::Cleaned { .. }
        )
    ) {
        return Err(paused());
    }
    Ok(())
}

/// Runs inside the same transaction as ordinary Router wallet commands.
/// A pending external effect stays unresolved even if its claim lease expired.
pub async fn freeze_router_wallet_v1<Store: RouterWalletStoreV1>(
    store: &Store,
    request: RouterWalletFreezeRequestV1,
) -> RouterAbProtocolResult<RouterWalletFreezeResponseV1> {
    validate_request(&request)?;
    require_ownership_generation(store, request.source_generation).await?;
    match store.get_json::<RouterWalletOwnerV1>(OWNER_KEY).await? {
        Some(owner) if owner == request.owner => {}
        Some(_) => return Err(conflict("Router wallet freeze names another owner")),
        None => {
            if store.get_json::<Fence>(FENCE_KEY).await?.is_some()
                || !store.list_registrations().await?.is_empty()
            {
                return Err(conflict("Router wallet inventory has no owner"));
            }
            // An unused role still needs a durable fence before it attests an empty inventory.
            store.put_json(OWNER_KEY, &request.owner).await?;
        }
    }
    match store.get_json::<Fence>(FENCE_KEY).await? {
        Some(Fence::Cleaning { activation } | Fence::Cleaned { activation }) => {
            if activation.source.request != request {
                return Err(conflict("Router wallet freeze inputs changed"));
            }
            return Ok(RouterWalletFreezeResponseV1::Frozen {
                receipt: activation.source,
            });
        }
        Some(Fence::Frozen { receipt }) => {
            if receipt.request != request {
                return Err(conflict("Router wallet freeze inputs changed"));
            }
            return Ok(RouterWalletFreezeResponseV1::Frozen { receipt });
        }
        Some(Fence::Draining { request: admitted }) => {
            if admitted != request {
                return Err(conflict("Router wallet freeze inputs changed"));
            }
        }
        Some(_) => {
            return Err(conflict(
                "An inactive destination cannot freeze source records",
            ))
        }
        None => {
            store
                .put_json(
                    FENCE_KEY,
                    &Fence::Draining {
                        request: request.clone(),
                    },
                )
                .await?
        }
    }
    let mut records = store.list_registrations().await?;
    records.sort_by(|left, right| left.0.cmp(&right.0));
    let mut unsettled_lifecycles = Vec::new();
    for (key, record) in &records {
        let (lifecycle_id, settled) = match record {
            RouterWalletRegistrationRecordV1::Claimed { lifecycle_id, .. } => (lifecycle_id, false),
            RouterWalletRegistrationRecordV1::Completed {
                lifecycle_id,
                consumer_binding,
                ..
            } => (lifecycle_id, consumer_binding.is_some()),
            RouterWalletRegistrationRecordV1::Failed { lifecycle_id, .. } => (lifecycle_id, true),
        };
        if key != &format!("{REGISTRATION_KEY_PREFIX}{lifecycle_id}") {
            return Err(conflict(
                "Router wallet record key differs from its lifecycle",
            ));
        }
        if !settled {
            unsettled_lifecycles.push(lifecycle_id.clone());
        }
    }
    if !unsettled_lifecycles.is_empty() {
        return Ok(RouterWalletFreezeResponseV1::Draining {
            unsettled_lifecycles,
        });
    }
    let bytes = serde_json::to_vec(&(&request, &records))
        .map_err(|error| conflict(&format!("Router wallet snapshot encoding failed: {error}")))?;
    let mut digest = Sha256::new();
    digest.update(b"seams/router/wallet-snapshot/v1");
    digest.update(bytes);
    let receipt = RouterWalletFreezeReceiptV1 {
        request,
        records_digest_hex: crate::router_wallet::lower_hex(&digest.finalize()),
        record_count: records.len() as u64,
    };
    store
        .put_json(
            FENCE_KEY,
            &Fence::Frozen {
                receipt: receipt.clone(),
            },
        )
        .await?;
    Ok(RouterWalletFreezeResponseV1::Frozen { receipt })
}

pub(crate) fn validate_request(
    request: &RouterWalletFreezeRequestV1,
) -> RouterAbProtocolResult<()> {
    if request.move_id.len() != 49
        || !request.move_id.starts_with("wmove_")
        || !request.move_id.as_bytes()[6..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
        || request.request_digest_hex.len() != 64
        || !request
            .request_digest_hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || request.source_generation == 0
        || request.source_generation >= 9_007_199_254_740_991
        || request.destination_generation != request.source_generation + 1
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "Router wallet freeze identity is invalid",
        ));
    }
    Ok(())
}

fn paused() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
        "Router wallet relocation has closed admission",
    )
}

pub(crate) fn conflict(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ForbiddenLocalBinding, message)
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn handle_freeze(
    mut request: worker::Request,
    env: &worker::Env,
) -> worker::Result<worker::Response> {
    if request.method() != worker::Method::Post {
        return worker::Response::error("Router wallet freeze requires POST", 405);
    }
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    let wallet_route = match crate::WalletObjectRoute::from_gateway_request(&request) {
        Ok(home) => home,
        Err(error) => return crate::router_coordinator::protocol_error_response(error),
    };
    let freeze = match request.json::<RouterWalletFreezeRequestV1>().await {
        Ok(freeze) => freeze,
        Err(error) => {
            return crate::router_coordinator::protocol_error_response(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("Router wallet freeze request is malformed: {error}"),
            ))
        }
    };
    let response = match crate::durable_object::call_router_wallet_freeze_v1(env, wallet_route, &freeze).await {
        Ok(response) => response,
        Err(error) => return crate::router_coordinator::protocol_error_response(error),
    };
    if matches!(response, RouterWalletFreezeResponseV1::Draining { .. }) {
        let command = crate::RouterWalletRequestV1 {
            owner: freeze.owner.clone(),
            ownership_generation: freeze.source_generation,
            command: crate::RouterWalletCommandV1::PendingRegistration {
                now_ms: crate::cloudflare_now_unix_ms_v1()
                    .map_err(|error| worker::Error::RustError(error.to_string()))?,
            },
        };
        match crate::durable_object::call_router_wallet_v1(env, wallet_route, &command).await {
            Ok(crate::RouterWalletResponseV1::PendingRegistration { request_json }) => {
                let mut init = worker::RequestInit::new();
                init.with_method(worker::Method::Post);
                let headers = worker::Headers::new();
                // The replayed execution runs as the Gateway's request would:
                // its secret, and the home and objects of the frozen source.
                for name in [
                    "x-router-ab-internal-service-auth",
                    "x-seams-wallet-home-region",
                    "x-seams-wallet-object-addresses",
                ] {
                    if let Some(value) = request.headers().get(name)? {
                        headers.set(name, &value)?;
                    }
                }
                init.with_headers(headers);
                init.with_body(Some(request_json.into()));
                let replay = worker::Request::new_with_init(
                    "https://router.internal/router-ab/router/ed25519-yao/execute",
                    &init,
                )?;
                // A lost execution reply is harmless: the next freeze reads the
                // durable claim or terminal result and continues from there.
                let _ = crate::handle_cloudflare_router_ed25519_yao_execute_private_fetch_v1(
                    replay, env,
                )
                .await?;
                return match crate::durable_object::call_router_wallet_freeze_v1(env, wallet_route, &freeze).await
                {
                    Ok(response) => worker::Response::from_json(&response),
                    Err(error) => crate::router_coordinator::protocol_error_response(error),
                };
            }
            Ok(crate::RouterWalletResponseV1::NoPendingRegistration) => {}
            Ok(_) => {
                return crate::router_coordinator::protocol_error_response(conflict(
                    "Router settlement response is invalid",
                ))
            }
            Err(error) => return crate::router_coordinator::protocol_error_response(error),
        }
    }
    worker::Response::from_json(&response)
}

/// Returns only a stored, expired claim. The ordinary execution path still takes
/// the next claim generation before it can reconcile any external effects.
pub(crate) async fn pending_registration<Store: RouterWalletStoreV1>(
    store: &Store,
    owner: &RouterWalletOwnerV1,
    now_ms: u64,
) -> RouterAbProtocolResult<crate::RouterWalletResponseV1> {
    if !matches!(
        store.get_json::<Fence>(FENCE_KEY).await?,
        Some(Fence::Draining { .. })
    ) {
        return Ok(crate::RouterWalletResponseV1::NoPendingRegistration);
    }
    let mut records = store.list_registrations().await?;
    records.sort_by(|left, right| left.0.cmp(&right.0));
    for (key, record) in records {
        let RouterWalletRegistrationRecordV1::Claimed {
            lifecycle_id,
            request_digest_hex,
            request_json,
            lease_until_ms,
            ..
        } = record
        else {
            continue;
        };
        if lease_until_ms > now_ms {
            continue;
        }
        let request = crate::router_wallet::decode_stored_registration_request(&request_json)?;
        let registration = crate::RouterWalletRegistrationV1::from_request(&request)?
            .ok_or_else(|| conflict("Router settlement record is not a registration"))?;
        if registration.owner != *owner
            || registration.lifecycle_id != lifecycle_id
            || key != format!("{REGISTRATION_KEY_PREFIX}{lifecycle_id}")
            || crate::router_wallet::registration_request_digest(&request_json)
                != request_digest_hex
        {
            return Err(conflict("Router settlement record identity conflicts"));
        }
        return Ok(crate::RouterWalletResponseV1::PendingRegistration {
            request_json: serde_json::to_string(&request)
                .map_err(|_| conflict("Router settlement request cannot be encoded"))?,
        });
    }
    Ok(crate::RouterWalletResponseV1::NoPendingRegistration)
}
