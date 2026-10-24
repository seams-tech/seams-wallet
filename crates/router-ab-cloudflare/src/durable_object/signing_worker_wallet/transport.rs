use super::*;

pub(crate) async fn call_signing_worker_wallet_do_v1(
    env: &Env,
    wallet_objects: crate::WalletObjectRoute,
    command: SigningWorkerWalletDoRequestV1,
) -> Result<Response, RouterAbProtocolError> {
    command.validate()?;
    let namespace = env.durable_object(BINDING).map_err(|error| {
        wallet_error(format!("SigningWorker wallet binding is missing: {error}"))
    })?;
    let stub = wallet_objects
        .addresses
        .signing_worker
        .stub(&namespace, wallet_objects.home)
        .map_err(|error| {
            wallet_error(format!("SigningWorker wallet identity is invalid: {error}"))
        })?;
    let body = serde_json::to_string(&command).map_err(|error| {
        wallet_error(format!("SigningWorker wallet command is invalid: {error}"))
    })?;
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let request = Request::new_with_init(&format!("https://router-ab-do.internal{PATH}"), &init)
        .map_err(|error| wallet_error(format!("SigningWorker wallet request failed: {error}")))?;
    stub.fetch_with_request(request)
        .await
        .map_err(|error| wallet_error(format!("SigningWorker wallet call failed: {error}")))
}
