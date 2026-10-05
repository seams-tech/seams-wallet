//! Local barriers serialize relocation with linked-session KV writers.

use std::{cell::RefCell, rc::Rc};

use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::ecdsa_presign_live_session::{presign_do_error_response, transaction_get_optional};

use crate::{
    CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1,
    CloudflareSigningWorkerRuntimeV1, CloudflareSigningWorkerWalletScopeV1,
    SigningWorkerPoolFreezeRequestV1,
};

pub(crate) const FENCE_PATH: &str = "/router-ab/signing-worker/linked-presign-session/fence";
pub(crate) const INTERNAL_FENCE_PATH: &str =
    "/router-ab/internal/signing-worker/linked-ecdsa-presign-session/fence";
const FENCE_KEY: &str = "linked-presign-relocation-fence";
pub(crate) const FREEZE_PATH: &str = "/router-ab/signing-worker/linked-presign-session/freeze";
pub(crate) const INTERNAL_FREEZE_PATH: &str =
    "/router-ab/internal/signing-worker/linked-ecdsa-presign-session/freeze";
const SNAPSHOT_KEY: &str = "linked-presign-relocation-snapshot";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LinkedPresignRelocationRequest {
    wallet_scope: CloudflareSigningWorkerWalletScopeV1,
    presign_session_id: String,
    server_presignature_id: String,
    request: SigningWorkerPoolFreezeRequestV1,
}

impl LinkedPresignRelocationRequest {
    fn validate(&self) -> RouterAbProtocolResult<()> {
        self.wallet_scope.validate()?;
        self.request.validate()?;
        crate::require_non_empty("Linked presign session", &self.presign_session_id)?;
        crate::require_non_empty("Linked server presignature", &self.server_presignature_id)
    }
}

/// Proves linked-session KV writes are closed. Material invalidation and sealing are separate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LinkedPresignFenceReceipt {
    command: LinkedPresignRelocationRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LinkedPresignFreezeReceipt {
    command: LinkedPresignRelocationRequest,
    records_digest_hex: String,
    record_count: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FrozenSnapshot {
    receipt: LinkedPresignFreezeReceipt,
    snapshot_json: String,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum CompletionHistory {
    NoStoredCompletion,
    Retired {
        completion: super::linked_presign_history::RetiredCompletion,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    command: LinkedPresignRelocationRequest,
    authority: CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1,
    completion: CompletionHistory,
}

pub(crate) async fn handle_freeze(
    mut request: worker::Request,
    storage: &worker::Storage,
) -> RouterAbProtocolResult<LinkedPresignFreezeReceipt> {
    if request.method() != worker::Method::Post {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "Linked presign freeze requires POST",
        ));
    }
    let command: LinkedPresignRelocationRequest = request.json().await.map_err(storage_error)?;
    command.validate()?;
    let outcome = Rc::new(RefCell::new(None));
    let transaction_outcome = Rc::clone(&outcome);
    storage
        .transaction(move |transaction| async move {
            let receipt = freeze_transaction(&transaction, command).await?;
            transaction_outcome.replace(Some(receipt));
            Ok(())
        })
        .await
        .map_err(storage_error)?;
    let receipt = outcome
        .borrow_mut()
        .take()
        .ok_or_else(|| storage_error("Missing freeze outcome"))?;
    receipt
}

async fn freeze_transaction(
    transaction: &worker::Transaction,
    command: LinkedPresignRelocationRequest,
) -> worker::Result<RouterAbProtocolResult<LinkedPresignFreezeReceipt>> {
    use super::ecdsa_presign_live_session::{
        linked_completion_server_storage_key, linked_completion_session_storage_key,
        CloudflareSigningWorkerLinkedDeviceEcdsaCompletedPresignatureRecordV1 as Completion,
        LINKED_PRESIGN_AUTHORITY_STORAGE_KEY,
    };
    use super::linked_presign_history::{RetiredCompletion, Retirement};

    let fence =
        transaction_get_optional::<LinkedPresignFenceReceipt>(transaction, FENCE_KEY).await?;
    match fence {
        Some(receipt) if receipt.command == command => {}
        Some(_) => {
            return Ok(Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "Linked presign freeze command differs from its fence",
            )))
        }
        None => {
            return Ok(Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "Linked presign freeze requires its durable fence",
            )))
        }
    }
    if let Some(frozen) =
        transaction_get_optional::<FrozenSnapshot>(transaction, SNAPSHOT_KEY).await?
    {
        if frozen.receipt.command != command {
            return Err(worker::Error::RustError(
                "Linked presign frozen command changed".into(),
            ));
        }
        return Ok(Ok(frozen.receipt));
    }
    let authority: CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1 =
        transaction
            .get(LINKED_PRESIGN_AUTHORITY_STORAGE_KEY)
            .await?;
    authority.validate().map_err(transaction_error)?;
    if authority.wallet_scope != command.wallet_scope
        || authority.presign_session_id != command.presign_session_id
        || authority.request.client_presignature_id != command.server_presignature_id
    {
        return Err(worker::Error::RustError(
            "Linked presign frozen authority changed".into(),
        ));
    }
    let session_key = linked_completion_session_storage_key(&command.presign_session_id);
    let server_key = linked_completion_server_storage_key(&command.server_presignature_id);
    let by_session = transaction_get_optional::<Completion>(transaction, &session_key).await?;
    let by_server = transaction_get_optional::<Completion>(transaction, &server_key).await?;
    if by_session != by_server {
        return Err(worker::Error::RustError(
            "Linked presign completion indexes disagree".into(),
        ));
    }
    let retired = transaction_get_optional::<RetiredCompletion>(
        transaction,
        &super::linked_presign_history::storage_key(&command.server_presignature_id),
    )
    .await?;
    let completion = match (by_session, retired) {
        (Some(active), None) => {
            let retired = RetiredCompletion::from_completion(
                &active,
                Retirement::WalletRelocated {
                    move_id: command.request.move_id.clone(),
                },
            )
            .map_err(transaction_error)?;
            retired
                .validate_for_authority(&authority)
                .map_err(transaction_error)?;
            super::linked_presign_history::persist_retirement(transaction, &retired).await?;
            transaction.delete(&session_key).await?;
            transaction.delete(&server_key).await?;
            CompletionHistory::Retired {
                completion: retired,
            }
        }
        (None, Some(retired)) => {
            retired
                .validate_for_authority(&authority)
                .map_err(transaction_error)?;
            CompletionHistory::Retired {
                completion: retired,
            }
        }
        (None, None) => CompletionHistory::NoStoredCompletion,
        (Some(_), Some(_)) => {
            return Err(worker::Error::RustError(
                "Linked presign has live and retired records".into(),
            ))
        }
    };
    let record_count = match &completion {
        CompletionHistory::NoStoredCompletion => 1,
        CompletionHistory::Retired { .. } => 2,
    };
    let snapshot = Snapshot {
        command: command.clone(),
        authority,
        completion,
    };
    let snapshot_json = serde_json::to_string(&snapshot).map_err(transaction_error)?;
    let mut digest = Sha256::new();
    digest.update(b"seams/signing-worker/linked-presign-snapshot/v1");
    digest.update(snapshot_json.as_bytes());
    let receipt = LinkedPresignFreezeReceipt {
        command,
        records_digest_hex: format!("{:x}", digest.finalize()),
        record_count,
    };
    transaction
        .put(
            SNAPSHOT_KEY,
            &FrozenSnapshot {
                receipt: receipt.clone(),
                snapshot_json,
            },
        )
        .await?;
    Ok(Ok(receipt))
}

fn transaction_error(error: impl std::fmt::Display) -> worker::Error {
    worker::Error::RustError(error.to_string())
}

pub(crate) async fn forward_fence(
    request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
) -> worker::Result<worker::Response> {
    forward_command::<LinkedPresignFenceReceipt>(request, env, runtime, INTERNAL_FENCE_PATH).await
}

pub(crate) async fn forward_freeze(
    request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
) -> worker::Result<worker::Response> {
    forward_command::<LinkedPresignFreezeReceipt>(request, env, runtime, INTERNAL_FREEZE_PATH).await
}

async fn forward_command<Receipt: DeserializeOwned + Serialize>(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
    internal_path: &str,
) -> worker::Result<worker::Response> {
    if request.method() != worker::Method::Post {
        return worker::Response::error("Linked presign relocation requires POST", 405);
    }
    let command: LinkedPresignRelocationRequest = match request.json().await {
        Ok(command) => command,
        Err(_) => {
            return worker::Response::error("Linked presign relocation request is malformed", 400)
        }
    };
    if let Err(error) = command.validate() {
        return presign_do_error_response(error);
    }
    let result: RouterAbProtocolResult<Receipt> =
        super::execute_cloudflare_durable_object_custom_json_call_v1(
            env,
            &runtime.bindings().presign_session,
            internal_path,
            &command.server_presignature_id,
            &command,
        )
        .await;
    match result {
        Ok(receipt) => worker::Response::from_json(&receipt),
        Err(error) => presign_do_error_response(error),
    }
}

pub(crate) async fn handle_fence(
    mut request: worker::Request,
    storage: &worker::Storage,
) -> RouterAbProtocolResult<LinkedPresignFenceReceipt> {
    if request.method() != worker::Method::Post {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "Linked presign relocation requires POST",
        ));
    }
    let command: LinkedPresignRelocationRequest = request.json().await.map_err(storage_error)?;
    command.validate()?;
    let outcome = Rc::new(RefCell::new(None));
    let transaction_outcome = Rc::clone(&outcome);
    storage
        .transaction(move |transaction| async move {
            let result = fence_transaction(&transaction, command).await?;
            transaction_outcome.replace(Some(result));
            Ok(())
        })
        .await
        .map_err(storage_error)?;
    let result = outcome
        .borrow_mut()
        .take()
        .ok_or_else(|| storage_error("Missing fence outcome"))?;
    result
}

async fn fence_transaction(
    transaction: &worker::Transaction,
    command: LinkedPresignRelocationRequest,
) -> worker::Result<RouterAbProtocolResult<LinkedPresignFenceReceipt>> {
    if let Some(receipt) =
        transaction_get_optional::<LinkedPresignFenceReceipt>(transaction, FENCE_KEY).await?
    {
        return Ok(if receipt.command == command {
            Ok(receipt)
        } else {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "Linked presign fence command changed",
            ))
        });
    }
    let authority = transaction_get_optional::<
        CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1,
    >(
        transaction,
        super::ecdsa_presign_live_session::LINKED_PRESIGN_AUTHORITY_STORAGE_KEY,
    )
    .await?;
    let Some(authority) = authority else {
        return Ok(Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingLocalBinding,
            "Linked presign fence requires initialized authority",
        )));
    };
    if authority.wallet_scope != command.wallet_scope
        || authority.request.scope.wallet_id != command.wallet_scope.wallet_id
        || authority.presign_session_id != command.presign_session_id
        || authority.request.client_presignature_id != command.server_presignature_id
    {
        return Ok(Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "Linked presign fence does not match initialized authority",
        )));
    }
    let receipt = LinkedPresignFenceReceipt { command };
    transaction.put(FENCE_KEY, &receipt).await?;
    Ok(Ok(receipt))
}

pub(super) async fn require_open(storage: &worker::Storage) -> RouterAbProtocolResult<()> {
    if storage
        .get::<LinkedPresignFenceReceipt>(FENCE_KEY)
        .await
        .map_err(storage_error)?
        .is_some()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
            "Linked presign session is fenced for relocation",
        ));
    }
    Ok(())
}

/// This read must share the transaction with every durable linked-session write.
pub(super) async fn require_open_transaction(
    transaction: &worker::Transaction,
) -> worker::Result<()> {
    if transaction_get_optional::<LinkedPresignFenceReceipt>(transaction, FENCE_KEY)
        .await?
        .is_some()
    {
        return Err(worker::Error::RustError(
            "Linked presign session is fenced for relocation".into(),
        ));
    }
    Ok(())
}

fn storage_error(error: impl std::fmt::Display) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        &error.to_string(),
    )
}
