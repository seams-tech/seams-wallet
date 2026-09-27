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
    router_wallet_serve_v1, RouterWalletRequestV1, RouterWalletResponseV1, RouterWalletStoreV1,
};

const BINDING: &str = "ROUTER_WALLET_DO";
const COMMAND_PATH: &str = "/router-wallet/v1/command";

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
}

impl DurableObject for RouterAbRouterWalletDurableObject {
    fn new(state: State, _env: Env) -> Self {
        Self { state }
    }

    async fn fetch(&self, mut request: Request) -> worker::Result<Response> {
        if request.method() != Method::Post || request.path() != COMMAND_PATH {
            return Response::error("Router wallet object route not found", 404);
        }
        let command = match request.json::<RouterWalletRequestV1>().await {
            Ok(command) => command,
            Err(error) => {
                return refusal_response(&RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    format!("Router wallet object command is malformed: {error}"),
                ))
            }
        };
        let outcome = Rc::new(RefCell::new(None));
        let captured = Rc::clone(&outcome);
        self.state
            .storage()
            .transaction(move |transaction| async move {
                let store = TransactionStoreV1 {
                    transaction,
                    storage_error: RefCell::new(None),
                };
                let result = router_wallet_serve_v1(&store, command).await;
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
    request: &RouterWalletRequestV1,
) -> RouterAbProtocolResult<RouterWalletResponseV1> {
    let object_name = request.owner.object_name()?;
    let stub = env
        .durable_object(BINDING)
        .and_then(|namespace| namespace.get_by_name(&object_name))
        .map_err(|error| unavailable(format!("Router wallet object binding failed: {error}")))?;
    let body = serde_json::to_string(request).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Router wallet object command is not encodable: {error}"),
        )
    })?;
    let mut init = worker::RequestInit::new();
    init.with_method(Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let outbound = Request::new_with_init(
        &format!("https://router-wallet.internal{COMMAND_PATH}"),
        &init,
    )
    .map_err(|error| unavailable(format!("Router wallet object request failed: {error}")))?;
    let mut response = stub
        .fetch_with_request(outbound)
        .await
        .map_err(|error| unavailable(format!("Router wallet object call failed: {error}")))?;
    let status = response.status_code();
    let text = response.text().await.map_err(|error| {
        unavailable(format!(
            "Router wallet object answer is unreadable: {error}"
        ))
    })?;
    if status == 200 {
        return decode(&text, "answer");
    }
    match serde_json::from_str::<RouterWalletRefusalV1>(&text) {
        Ok(refusal) => Err(RouterAbProtocolError::new(refusal.code, refusal.message)),
        Err(_) => Err(unavailable(format!(
            "Router wallet object answered HTTP {status}: {text}"
        ))),
    }
}

fn decode<T: DeserializeOwned>(text: &str, what: &str) -> RouterAbProtocolResult<T> {
    serde_json::from_str(text).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("Router wallet object {what} is malformed: {error}"),
        )
    })
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
