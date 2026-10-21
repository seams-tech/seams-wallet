//! Public transaction parsing and verification. This module accepts no secret material.
use crate::{
    calculate_transaction_hash, encode_signed_transaction,
    encoders::{base64_url_decode, base64_url_encode},
    PublicKey, PublicKeyHandle, Signature, Transaction,
};
use ml_dsa::{
    EncodedSignature, EncodedVerifyingKey, MlDsa65, Signature as MlSignature, VerifyingKey,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuildInput {
    signer_id: String,
    receiver_id: String,
    public_key_b64u: String,
    nonce: String,
    block_hash: String,
    actions: Vec<crate::actions::ActionParams>,
}

/// Builds the ordinary transaction through the same action and Borsh codecs.
#[wasm_bindgen]
pub fn ml_dsa65_build_near_transaction(input_json: &str) -> Result<String, JsValue> {
    build_ml_dsa65_transaction(input_json).map_err(|error| JsValue::from_str(&error))
}

pub fn build_ml_dsa65_transaction(input_json: &str) -> Result<String, String> {
    let input: BuildInput = serde_json::from_str(input_json).map_err(|error| error.to_string())?;
    let key: [u8; 1952] = base64_url_decode(&input.public_key_b64u)?
        .try_into()
        .map_err(|_| "ML-DSA public key must contain 1952 bytes")?;
    let block_hash: [u8; 32] = bs58::decode(&input.block_hash)
        .into_vec()
        .map_err(|error| error.to_string())?
        .try_into()
        .map_err(|_| "NEAR block hash must contain 32 bytes")?;
    let nonce: u64 = input.nonce.parse().map_err(|_| "Invalid NEAR nonce")?;
    if nonce == 0 || input.nonce != nonce.to_string() {
        return Err("NEAR nonce must be a positive canonical integer".into());
    }
    let actions = crate::transaction::build_actions_from_params(input.actions)?;
    let tx = crate::build_transaction_with_actions(
        &input.signer_id,
        &input.receiver_id,
        nonce,
        &block_hash,
        PublicKey::MlDsa65(Box::new(key)),
        actions,
    )?;
    let encoded = base64_url_encode(&borsh::to_vec(&tx).map_err(|error| error.to_string())?);
    transaction(&InspectionInput {
        unsigned_transaction_borsh_b64u: encoded.clone(),
        public_key_b64u: input.public_key_b64u,
    })?;
    Ok(encoded)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InspectionInput {
    unsigned_transaction_borsh_b64u: String,
    public_key_b64u: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Inspection {
    transaction_hash_b64u: String,
    display_json: String,
    signer_id: String,
    receiver_id: String,
    nonce: String,
    public_key_b64u: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FinalizeInput {
    unsigned_transaction_borsh_b64u: String,
    public_key_b64u: String,
    signature_b64u: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Finalized {
    signed_transaction_borsh_b64u: String,
    transaction_hash: String,
    signature_b64u: String,
}

fn transaction(input: &InspectionInput) -> Result<Transaction, String> {
    // Bound the input before base64 decoding or Borsh allocation.
    if input.unsigned_transaction_borsh_b64u.len() > 44_000 {
        return Err("ML-DSA transaction exceeds the 32 KiB request limit".into());
    }
    let bytes = base64_url_decode(&input.unsigned_transaction_borsh_b64u)?;
    if bytes.len() > 32 * 1024 {
        return Err("ML-DSA transaction is too large".into());
    }
    let key: [u8; 1952] = base64_url_decode(&input.public_key_b64u)?
        .try_into()
        .map_err(|_| "ML-DSA public key must contain 1952 bytes")?;
    let tx: Transaction =
        borsh::from_slice(&bytes).map_err(|e| format!("Invalid NEAR transaction: {e}"))?;
    if tx.public_key != PublicKey::MlDsa65(Box::new(key)) {
        return Err("NEAR transaction public key differs from the published ML-DSA key".into());
    }
    if tx.actions.is_empty() || tx.actions.len() > 100 {
        return Err("NEAR transaction must contain between 1 and 100 actions".into());
    }
    if !valid_account_id(&tx.signer_id.0) || !valid_account_id(&tx.receiver_id.0) {
        return Err("Invalid NEAR account identifier".into());
    }
    Ok(tx)
}
fn valid_account_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    if !(2..=64).contains(&bytes.len()) {
        return false;
    }
    let mut separator = true;
    for byte in bytes {
        if byte.is_ascii_lowercase() || byte.is_ascii_digit() {
            separator = false;
        } else if matches!(byte, b'.' | b'-' | b'_') && !separator {
            separator = true;
        } else {
            return false;
        }
    }
    !separator
}

pub fn inspect_ml_dsa65_transaction(input_json: &str) -> Result<String, String> {
    let input: InspectionInput = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
    let tx = transaction(&input)?;
    // JSON through serde_json keeps u64 action fields exact in the approval preimage.
    let display_json = serde_json::to_string(&serde_json::json!({
        "signerId": tx.signer_id.0, "receiverId": tx.receiver_id.0,
        "nonce": tx.nonce.to_string(), "publicKey": tx.public_key.to_string(),
        "blockHash": bs58::encode(tx.block_hash.0).into_string(), "actions": tx.actions,
    }))
    .map_err(|e| e.to_string())?;
    serde_json::to_string(&Inspection {
        transaction_hash_b64u: base64_url_encode(&tx.get_hash_and_size().0 .0),
        display_json,
        signer_id: tx.signer_id.0,
        receiver_id: tx.receiver_id.0,
        nonce: tx.nonce.to_string(),
        public_key_b64u: input.public_key_b64u,
    })
    .map_err(|e| e.to_string())
}

pub fn finalize_ml_dsa65_transaction(input_json: &str) -> Result<String, String> {
    let input: FinalizeInput = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
    let tx = transaction(&InspectionInput {
        unsigned_transaction_borsh_b64u: input.unsigned_transaction_borsh_b64u,
        public_key_b64u: input.public_key_b64u,
    })?;
    let raw_signature: [u8; 3309] = base64_url_decode(&input.signature_b64u)?
        .try_into()
        .map_err(|_| "ML-DSA signature must contain 3309 bytes")?;
    let encoded: EncodedSignature<MlDsa65> = raw_signature
        .as_slice()
        .try_into()
        .map_err(|_| "Invalid signature encoding")?;
    let decoded = MlSignature::<MlDsa65>::decode(&encoded).ok_or("Invalid ML-DSA signature")?;
    let key: EncodedVerifyingKey<MlDsa65> = tx
        .public_key
        .as_bytes()
        .try_into()
        .map_err(|_| "Invalid public key encoding")?;
    if !VerifyingKey::<MlDsa65>::decode(&key).verify_with_context(
        &tx.get_hash_and_size().0 .0,
        b"",
        &decoded,
    ) {
        return Err("ML-DSA transaction signature verification failed".into());
    }
    let transaction_hash = calculate_transaction_hash(&tx);
    let bytes = encode_signed_transaction(tx, Signature::MlDsa65(Box::new(raw_signature)))?;
    serde_json::to_string(&Finalized {
        signed_transaction_borsh_b64u: base64_url_encode(&bytes),
        transaction_hash,
        signature_b64u: input.signature_b64u,
    })
    .map_err(|e| e.to_string())
}

#[wasm_bindgen]
pub fn ml_dsa65_inspect_near_transaction(input_json: &str) -> Result<String, JsValue> {
    inspect_ml_dsa65_transaction(input_json).map_err(|e| JsValue::from_str(&e))
}
#[wasm_bindgen]
pub fn ml_dsa65_finalize_near_transaction(input_json: &str) -> Result<String, JsValue> {
    finalize_ml_dsa65_transaction(input_json).map_err(|e| JsValue::from_str(&e))
}

/// Both identifiers use the existing NEAR codec. Access-key lists return the hashed handle.
#[wasm_bindgen]
pub fn ml_dsa65_near_key_identifiers(public_key_b64u: &str) -> Result<String, JsValue> {
    let bytes: [u8; 1952] = base64_url_decode(public_key_b64u)
        .map_err(|error| JsValue::from_str(&error))?
        .try_into()
        .map_err(|_| JsValue::from_str("ML-DSA public key must contain 1952 bytes"))?;
    let key = PublicKey::MlDsa65(Box::new(bytes));
    serde_json::to_string(&serde_json::json!({
        "publicKey": key.to_string(),
        "accessKeyHandle": PublicKeyHandle::from(&key).to_string(),
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}
