//! Local barriers serialize relocation with linked-session KV writers.

use std::{cell::RefCell, rc::Rc};

use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LinkedPresignFenceCommand {
    wallet_scope: CloudflareSigningWorkerWalletScopeV1,
    presign_session_id: String,
    server_presignature_id: String,
    request: SigningWorkerPoolFreezeRequestV1,
}

impl LinkedPresignFenceCommand {
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
    command: LinkedPresignFenceCommand,
}

pub(crate) async fn forward_fence(
    mut request: worker::Request,
    env: &worker::Env,
    runtime: &CloudflareSigningWorkerRuntimeV1,
) -> worker::Result<worker::Response> {
    if request.method() != worker::Method::Post {
        return worker::Response::error("Linked presign fence requires POST", 405);
    }
    let command: LinkedPresignFenceCommand = match request.json().await {
        Ok(command) => command,
        Err(_) => return worker::Response::error("Linked presign fence request is malformed", 400),
    };
    if let Err(error) = command.validate() {
        return presign_do_error_response(error);
    }
    let result: RouterAbProtocolResult<LinkedPresignFenceReceipt> =
        super::execute_cloudflare_durable_object_custom_json_call_v1(
            env,
            &runtime.bindings().presign_session,
            INTERNAL_FENCE_PATH,
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
            "Linked presign fence requires POST",
        ));
    }
    let command: LinkedPresignFenceCommand = request.json().await.map_err(storage_error)?;
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
    command: LinkedPresignFenceCommand,
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
