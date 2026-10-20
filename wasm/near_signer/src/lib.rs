mod actions;
mod config;
mod encoders;
mod logger;
mod ml_dsa_transaction;
mod passkey_custody_wasm;
#[cfg(test)]
mod tests;
mod threshold;
mod transaction;
mod types;

pub use actions::ActionParams;
pub use ml_dsa_transaction::{finalize_ml_dsa65_transaction, inspect_ml_dsa65_transaction};
use wasm_bindgen::prelude::*;

// Re-export NEAR types for TypeScript usage
pub use transaction::{
    build_transaction_with_actions, calculate_transaction_hash, encode_signed_transaction,
};
pub use types::near::{
    DelegateAction, NearAction, PublicKey, PublicKeyHandle, Signature, SignedDelegate,
    SignedTransaction, Transaction,
};
// Re-export WASM-friendly wrapper types for TypeScript usage
pub use types::wasm_to_json::{
    WasmDelegateAction, WasmPublicKey, WasmSignature, WasmSignedDelegate, WasmSignedTransaction,
    WasmTransaction,
};

#[wasm_bindgen]
pub fn init_worker() {
    logger::init(config::CURRENT_LOG_LEVEL);
}
