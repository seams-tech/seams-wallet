mod actions;
mod config;
mod crypto;
mod encoders;
mod error;
mod handlers;
mod logger;
mod passkey_custody_wasm;
#[cfg(test)]
mod tests;
mod threshold;
mod transaction;
mod types;

use crate::types::worker_messages::{
    parse_typed_payload, parse_worker_request_envelope, SignerWorkerMessage, SignerWorkerResponse,
    WorkerRequestType, WorkerResponseType,
};
use log::debug;
use wasm_bindgen::prelude::*;

pub use handlers::DeriveThresholdEd25519ClientVerifyingShareRequest;

// Re-export NEAR types for TypeScript usage
pub use types::near::{
    DelegateAction, PublicKey, Signature, SignedDelegate, SignedTransaction, Transaction,
};
// Re-export WASM-friendly wrapper types for TypeScript usage
pub use types::wasm_to_json::{
    WasmDelegateAction, WasmPublicKey, WasmSignature, WasmSignedDelegate, WasmSignedTransaction,
    WasmTransaction,
};

pub use crate::crypto::WrapKey;

#[wasm_bindgen]
pub fn init_worker() {
    logger::init(config::CURRENT_LOG_LEVEL);
}

fn require_field(
    field_name: &str,
    value: &Option<String>,
    request_type: WorkerRequestType,
) -> Result<String, JsValue> {
    let trimmed = value.as_deref().unwrap_or("").trim();
    if trimmed.is_empty() {
        return Err(JsValue::from_str(&format!(
            "Missing {} for {}",
            field_name,
            request_type.name()
        )));
    }
    Ok(trimmed.to_string())
}

fn wrap_key_from_request(
    prf_first_b64u: &Option<String>,
    wrap_key_salt: &Option<String>,
    request_type: WorkerRequestType,
) -> Result<WrapKey, JsValue> {
    let wrap_key_seed = require_field("prfFirstB64u", prf_first_b64u, request_type)?;
    let wrap_key_salt = require_field("wrapKeySalt", wrap_key_salt, request_type)?;
    Ok(WrapKey {
        wrap_key_seed,
        wrap_key_salt,
    })
}

// === MESSAGE HANDLER FUNCTIONS ===

/// Unified message handler for all signer worker operations
/// This replaces the TypeScript-based message dispatching with a Rust-based approach
/// for better type safety and performance
#[wasm_bindgen]
pub async fn handle_signer_message(message_val: JsValue) -> Result<JsValue, JsValue> {
    init_worker();

    // Parse the outer `{ type, payload }` envelope from JS into a strongly
    // typed `WorkerRequestType` and raw `payload` value.
    let SignerWorkerMessage {
        request_type,
        request_type_raw: msg_type_num,
        payload: payload_js,
    } = parse_worker_request_envelope(message_val)?;

    debug!(
        "WASM Worker: Received message type: {} ({})",
        request_type.name(),
        msg_type_num
    );

    // Route message to appropriate handler
    let response_payload = match request_type {
        WorkerRequestType::DeriveThresholdEd25519ClientVerifyingShare => {
            let request: DeriveThresholdEd25519ClientVerifyingShareRequest =
                parse_typed_payload(&payload_js, request_type)?;
            let wrap_key = wrap_key_from_request(
                &request.prf_first_b64u,
                &request.wrap_key_salt,
                request_type,
            )?;
            let result =
                handlers::handle_threshold_ed25519_derive_client_verifying_share(request, wrap_key)
                    .await?;
            serde_wasm_bindgen::to_value(&result)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {:?}", e)))?
        }
    };

    // At this point, response_payload is the successful JsValue result.
    // Errors would have been propagated early via `?` operator and caught by the TypeScript wrapper.

    // Determine the success response type based on the request type
    let response_type = match request_type {
        WorkerRequestType::DeriveThresholdEd25519ClientVerifyingShare => {
            WorkerResponseType::DeriveThresholdEd25519ClientVerifyingShareSuccess
        }
    };

    // Create the final response
    let response = SignerWorkerResponse {
        response_type: response_type as u32,
        payload: response_payload,
    };

    // Return JsValue directly
    serde_wasm_bindgen::to_value(&response)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize response: {:?}", e)))
}
