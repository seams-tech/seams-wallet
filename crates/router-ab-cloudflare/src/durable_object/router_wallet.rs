//! The Router's wallet object on Workers: one Durable Object per wallet,
//! holding the Router's record of each Yao registration it executes for that
//! wallet. The transitions are shared with the VM; see
//! [`crate::router_wallet`]. Each command runs in one storage transaction.
//! A refusal crosses back to the Router with its protocol code, never as a
//! bare server error.

use std::cell::RefCell;
use std::rc::Rc;

use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use worker::{durable_object, DurableObject, Env, Method, Request, Response, State};

use crate::router_wallet::{
    router_wallet_serve_v1, RouterWalletCommandV1, RouterWalletOwnerV1,
    RouterWalletRegistrationRecordV1, RouterWalletRequestV1, RouterWalletResponseV1,
    RouterWalletStoreV1, REGISTRATION_KEY_PREFIX,
};
use crate::{
    freeze_router_wallet_v1, transfer_router_wallet_v1, RouterWalletFreezeRequestV1,
    RouterWalletFreezeResponseV1, RouterWalletTransferRequestV1, RouterWalletTransferResponseV1,
    ROUTER_WALLET_FREEZE_PATH_V1, ROUTER_WALLET_TRANSFER_PATH_V1,
};

const BINDING: &str = "ROUTER_WALLET_DO";
const COMMAND_PATH: &str = "/router-wallet/v1/command";

enum WalletCall {
    Ordinary(RouterWalletRequestV1),
    Freeze(RouterWalletFreezeRequestV1),
    Transfer(RouterWalletTransferRequestV1),
}

/// A refusal as the object answers it, with its protocol code.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RouterWalletRefusalV1 {
    code: RouterAbProtocolErrorCode,
    message: String,
}

#[durable_object]
pub struct RouterAbRouterWalletDurableObject {
    state: State,
    timing: super::command_timing::WalletCommandTiming,
}

impl DurableObject for RouterAbRouterWalletDurableObject {
    fn new(state: State, _env: Env) -> Self {
        let timing = super::command_timing::WalletCommandTiming::new(state.id().to_string());
        Self { state, timing }
    }

    async fn fetch(&self, request: Request) -> worker::Result<Response> {
        let observation = self
            .timing
            .begin(&self.state, "router", request.path());
        observation.finish(self.handle_request(request).await)
    }
}

impl RouterAbRouterWalletDurableObject {
    async fn handle_request(&self, mut request: Request) -> worker::Result<Response> {
        if request.method() == Method::Post && request.path() == super::wallet_startup::PATH {
            // A private wake-up has no authority and performs no storage operation.
            return Response::from_json(&true);
        }
        if request.path() == super::custody_target::OBSERVE_PATH {
            return super::custody_target::observe_location().await;
        }
        if request.method() != Method::Post
            || (request.path() != COMMAND_PATH
                && request.path() != ROUTER_WALLET_FREEZE_PATH_V1
                && request.path() != ROUTER_WALLET_TRANSFER_PATH_V1)
        {
            return Response::error("Router wallet object route not found", 404);
        }
        let parsed = if request.path() == COMMAND_PATH {
            request
                .json::<RouterWalletRequestV1>()
                .await
                .map(WalletCall::Ordinary)
        } else if request.path() == ROUTER_WALLET_FREEZE_PATH_V1 {
            request
                .json::<RouterWalletFreezeRequestV1>()
                .await
                .map(WalletCall::Freeze)
        } else {
            request
                .json::<RouterWalletTransferRequestV1>()
                .await
                .map(WalletCall::Transfer)
        };
        let command = match parsed {
            Ok(command) => command,
            Err(error) => {
                return refusal_response(&RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    format!("Router wallet object command is malformed: {error}"),
                ))
            }
        };
        let operation = match &command {
            WalletCall::Ordinary(request) => command_label(&request.command),
            WalletCall::Freeze(_) => "freeze",
            WalletCall::Transfer(_) => "transfer",
        };
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "router_wallet_operation",
                "operation": operation,
            })
        );
        let outcome = Rc::new(RefCell::new(None));
        let captured = Rc::clone(&outcome);
        self.state
            .storage()
            .transaction(move |transaction| async move {
                let store = TransactionStoreV1 {
                    transaction,
                    storage_error: RefCell::new(None),
                };
                let result = match command {
                    WalletCall::Ordinary(command) => router_wallet_serve_v1(&store, command)
                        .await
                        .and_then(encode_response),
                    WalletCall::Freeze(command) => freeze_router_wallet_v1(&store, command)
                        .await
                        .and_then(encode_response),
                    WalletCall::Transfer(command) => transfer_router_wallet_v1(&store, command)
                        .await
                        .and_then(encode_response),
                };
                if let Some(error) = store.storage_error.borrow_mut().take() {
                    return Err(worker::Error::RustError(error));
                }
                captured.replace(Some(result));
                Ok(())
            })
            .await?;
        let result = outcome.borrow_mut().take();
        match result {
            Some(Ok(response)) => Response::from_json(&response),
            Some(Err(error)) => refusal_response(&error),
            None => refusal_response(&RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "Router wallet object transaction produced no outcome",
            )),
        }
    }
}

fn refusal_response(error: &RouterAbProtocolError) -> worker::Result<Response> {
    Response::from_json(&RouterWalletRefusalV1 {
        code: error.code(),
        message: error.message().to_owned(),
    })
    .map(|response| response.with_status(409))
}

/// Runs one command in the wallet object the request's owner names.
pub(crate) async fn call_router_wallet_v1(
    env: &Env,
    wallet_route: crate::WalletObjectRoute,
    request: &RouterWalletRequestV1,
) -> RouterAbProtocolResult<RouterWalletResponseV1> {
    let started_ms = worker::Date::now().as_millis();
    let result = call_wallet(
        env,
        wallet_route,
        &request.owner,
        request.ownership_generation,
        COMMAND_PATH,
        command_label(&request.command),
        request,
    )
    .await;
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "router_wallet_dispatch_timing",
            "operation": command_label(&request.command),
            "wallet_home": wallet_route.home,
            "duration_ms": worker::Date::now().as_millis().saturating_sub(started_ms),
            "outcome": if result.is_ok() { "success" } else { "failure" },
        })
    );
    result
}

fn command_label(command: &RouterWalletCommandV1) -> &'static str {
    match command {
        RouterWalletCommandV1::PendingRegistration { .. } => "pending_registration",
        RouterWalletCommandV1::AdmitSettlement => "admit_settlement",
        RouterWalletCommandV1::ClaimRegistration { .. } => "claim_registration",
        RouterWalletCommandV1::FinishRegistration { .. } => "finish_registration",
        RouterWalletCommandV1::ConsumeRegistration { .. } => "consume_registration",
    }
}

pub(crate) async fn call_router_wallet_freeze_v1(
    env: &Env,
    wallet_route: crate::WalletObjectRoute,
    request: &RouterWalletFreezeRequestV1,
) -> RouterAbProtocolResult<RouterWalletFreezeResponseV1> {
    call_wallet(
        env,
        wallet_route,
        &request.owner,
        request.source_generation,
        ROUTER_WALLET_FREEZE_PATH_V1,
        "freeze",
        request,
    )
    .await
}

pub(crate) async fn call_router_wallet_transfer_v1(
    env: &Env,
    wallet_route: crate::WalletObjectRoute,
    request: &RouterWalletTransferRequestV1,
) -> RouterAbProtocolResult<RouterWalletTransferResponseV1> {
    call_wallet(
        env,
        wallet_route,
        request.owner(),
        request.ownership_generation(),
        ROUTER_WALLET_TRANSFER_PATH_V1,
        "transfer",
        request,
    )
    .await
}

async fn call_wallet<Input: Serialize, Output: DeserializeOwned>(
    env: &Env,
    wallet_route: crate::WalletObjectRoute,
    owner: &RouterWalletOwnerV1,
    ownership_generation: u64,
    path: &str,
    operation: &'static str,
    request: &Input,
) -> RouterAbProtocolResult<Output> {
    let lookup_started_ms = worker::Date::now().as_millis();
    let object_name = owner.object_name(ownership_generation)?;
    let stub = env
        .durable_object(BINDING)
        .and_then(|namespace| wallet_route.wallet_stub(&namespace, &object_name, "router"))
        .map_err(|error| unavailable(format!("Router wallet object binding failed: {error}")))?;
    let encoding_started_ms = worker::Date::now().as_millis();
    let body = serde_json::to_string(request).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Router wallet object command is not encodable: {error}"),
        )
    })?;
    let mut init = worker::RequestInit::new();
    init.with_method(Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let outbound = Request::new_with_init(&format!("https://router-wallet.internal{path}"), &init)
        .map_err(|error| unavailable(format!("Router wallet object request failed: {error}")))?;
    let fetch_started_ms = worker::Date::now().as_millis();
    let mut response = stub
        .fetch_with_request(outbound)
        .await
        .map_err(|error| unavailable(format!("Router wallet object call failed: {error}")))?;
    let body_started_ms = worker::Date::now().as_millis();
    let status = response.status_code();
    let text = response.text().await.map_err(|error| {
        unavailable(format!(
            "Router wallet object answer is unreadable: {error}"
        ))
    })?;
    let decode_started_ms = worker::Date::now().as_millis();
    let result = if status == 200 {
        decode(&text, "answer")
    } else {
        match serde_json::from_str::<RouterWalletRefusalV1>(&text) {
            Ok(refusal) => Err(RouterAbProtocolError::new(refusal.code, refusal.message)),
            Err(_) => Err(unavailable(format!(
                "Router wallet object answered HTTP {status}: {text}"
            ))),
        }
    };
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "router_wallet_transport_timing",
            "operation": operation,
            "wallet_home": wallet_route.home,
            "lookup_ms": encoding_started_ms.saturating_sub(lookup_started_ms),
            "encoding_ms": fetch_started_ms.saturating_sub(encoding_started_ms),
            "response_headers_ms": body_started_ms.saturating_sub(fetch_started_ms),
            "response_body_ms": decode_started_ms.saturating_sub(body_started_ms),
            "decode_ms": worker::Date::now().as_millis().saturating_sub(decode_started_ms),
            "request_body_bytes": body.len(),
            "response_body_bytes": text.len(),
            "status": status,
        })
    );
    result
}

fn decode<T: DeserializeOwned>(text: &str, what: &str) -> RouterAbProtocolResult<T> {
    serde_json::from_str(text).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("Router wallet object {what} is malformed: {error}"),
        )
    })
}

fn encode_response<T: Serialize>(response: T) -> RouterAbProtocolResult<serde_json::Value> {
    serde_json::to_value(response)
        .map_err(|error| unavailable(format!("Router wallet response encoding failed: {error}")))
}

fn unavailable(message: String) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
        message,
    )
}

/// One wallet-object storage transaction as the shared store. A storage
/// failure is kept so the transaction aborts instead of committing a partial
/// write.
struct TransactionStoreV1 {
    transaction: worker::Transaction,
    storage_error: RefCell<Option<String>>,
}

impl TransactionStoreV1 {
    fn record(&self, error: worker::Error) -> RouterAbProtocolError {
        let message = error.to_string();
        self.storage_error
            .borrow_mut()
            .get_or_insert(message.clone());
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
            format!("Router wallet object storage failed: {message}"),
        )
    }
}

impl RouterWalletStoreV1 for TransactionStoreV1 {
    async fn delete_key(&self, key: &str) -> RouterAbProtocolResult<()> {
        self.transaction
            .delete(key)
            .await
            .map_err(|error| self.record(error))?;
        Ok(())
    }

    async fn list_keys(&self, prefix: &str, limit: u32) -> RouterAbProtocolResult<Vec<String>> {
        let values = self
            .transaction
            .list_with_options(
                worker::ListOptions::new()
                    .prefix(prefix)
                    .limit(limit as usize),
            )
            .await
            .map_err(|error| self.record(error))?;
        let mut keys = Vec::new();
        for key in values.keys() {
            let key =
                key.map_err(|error| self.record(worker::Error::JsError(format!("{error:?}"))))?;
            keys.push(key.as_string().ok_or_else(|| {
                self.record(worker::Error::RustError(
                    "Router wallet storage key is invalid".to_owned(),
                ))
            })?);
        }
        Ok(keys)
    }

    async fn list_registrations(
        &self,
    ) -> RouterAbProtocolResult<Vec<(String, RouterWalletRegistrationRecordV1)>> {
        let values = self
            .transaction
            .list_with_options(worker::ListOptions::new().prefix(REGISTRATION_KEY_PREFIX))
            .await
            .map_err(|error| self.record(error))?;
        let mut records = Vec::new();
        for key in values.keys() {
            let key =
                key.map_err(|error| self.record(worker::Error::JsError(format!("{error:?}"))))?;
            let key = key.as_string().ok_or_else(|| {
                self.record(worker::Error::RustError(
                    "Router wallet storage key is invalid".to_owned(),
                ))
            })?;
            let record = self.get_json(&key).await?.ok_or_else(|| {
                self.record(worker::Error::RustError(
                    "Router wallet record disappeared".to_owned(),
                ))
            })?;
            records.push((key, record));
        }
        Ok(records)
    }
    async fn get_json<T: DeserializeOwned>(&self, key: &str) -> RouterAbProtocolResult<Option<T>> {
        match self.transaction.get::<T>(key).await {
            Ok(value) => Ok(Some(value)),
            Err(worker::Error::JsError(message)) if message == "No such value in storage." => {
                Ok(None)
            }
            Err(error) => Err(self.record(error)),
        }
    }

    async fn put_json<T: Serialize>(&self, key: &str, value: &T) -> RouterAbProtocolResult<()> {
        self.transaction
            .put(key, value)
            .await
            .map_err(|error| self.record(error))
    }
}
