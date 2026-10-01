use crate::error::ParsePayloadError;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Request ids of the signer worker protocol. The TypeScript worker sends the same numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum WorkerRequestType {
    DeriveThresholdEd25519ClientVerifyingShare = 3,
}

impl TryFrom<u32> for WorkerRequestType {
    type Error = JsValue;

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            3 => Ok(Self::DeriveThresholdEd25519ClientVerifyingShare),
            _ => Err(JsValue::from_str(&format!(
                "unsupported signer worker request type: {value}"
            ))),
        }
    }
}

impl WorkerRequestType {
    pub fn name(self) -> &'static str {
        match self {
            WorkerRequestType::DeriveThresholdEd25519ClientVerifyingShare => {
                "DERIVE_THRESHOLD_ED25519_CLIENT_VERIFYING_SHARE"
            }
        }
    }
}

pub fn parse_typed_payload<T: DeserializeOwned>(
    payload: &JsValue,
    request_type: WorkerRequestType,
) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(payload.clone())
        .map_err(|error| ParsePayloadError::new(request_type.name(), error).into())
}

/// Success response ids of the signer worker protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum WorkerResponseType {
    DeriveThresholdEd25519ClientVerifyingShareSuccess = 10,
}

pub struct SignerWorkerMessage {
    pub request_type: WorkerRequestType,
    pub request_type_raw: u32,
    pub payload: JsValue,
}

pub fn parse_worker_request_envelope(
    message_value: JsValue,
) -> Result<SignerWorkerMessage, JsValue> {
    let message = if message_value.is_string() {
        let json = message_value.as_string().unwrap_or_default();
        js_sys::JSON::parse(&json).map_err(|error| {
            JsValue::from_str(&format!("failed to parse signer request: {error:?}"))
        })?
    } else {
        message_value
    };
    let request_type_value = js_sys::Reflect::get(&message, &JsValue::from_str("type"))
        .map_err(|error| JsValue::from_str(&format!("failed to read message.type: {error:?}")))?;
    let request_type_raw = request_type_value
        .as_f64()
        .filter(|value| value.is_finite() && *value >= 0.0 && value.fract() == 0.0)
        .ok_or_else(|| JsValue::from_str("message.type must be a non-negative integer"))?
        as u32;
    let request_type = WorkerRequestType::try_from(request_type_raw)?;
    let payload =
        js_sys::Reflect::get(&message, &JsValue::from_str("payload")).map_err(|error| {
            JsValue::from_str(&format!("failed to read message.payload: {error:?}"))
        })?;
    Ok(SignerWorkerMessage {
        request_type,
        request_type_raw,
        payload,
    })
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SignerWorkerResponse {
    #[serde(rename = "type")]
    pub response_type: u32,
    #[serde(with = "serde_wasm_bindgen::preserve")]
    pub payload: JsValue,
}
