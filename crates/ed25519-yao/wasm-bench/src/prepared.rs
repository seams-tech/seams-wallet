//! Node-hosted Wasm experiment with separate processes and disk-backed tables.

use js_sys::{Array, Uint8Array};
use ml_dsa_threshold::{
    runtime::{
        prepared::{keygen::prepare_keygen, Phase, Transport},
        RuntimeError, TrustedMlDsaSchedule,
    },
    signing::SigningRole,
};
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(catch, js_namespace = preparedHost, js_name = send)]
    async fn host_send(bytes: &[u8]) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch, js_namespace = preparedHost, js_name = receive)]
    async fn host_receive(length: usize) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch, js_namespace = preparedHost, js_name = store)]
    async fn host_store(binding: &[u8], ordinal: usize, bytes: &[u8]) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch, js_namespace = preparedHost, js_name = load)]
    async fn host_load(binding: &[u8], ordinal: usize, length: usize) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_namespace = preparedHost, js_name = phase)]
    fn host_phase(phase: u8);
}
struct Host;
impl Transport for Host {
    async fn send(&mut self, bytes: &[u8]) -> Result<(), RuntimeError> {
        host_send(bytes).await.map_err(host_error)?;
        Ok(())
    }
    async fn receive(&mut self, length: usize) -> Result<Vec<u8>, RuntimeError> {
        let value = host_receive(length).await.map_err(host_error)?;
        let bytes = Uint8Array::new(&value).to_vec();
        if bytes.len() != length {
            return Err(RuntimeError::MessageLength);
        }
        Ok(bytes)
    }
    async fn store(
        &mut self,
        binding: [u8; 32],
        ordinal: usize,
        bytes: &[u8],
    ) -> Result<(), RuntimeError> {
        host_store(&binding, ordinal, bytes)
            .await
            .map_err(host_error)?;
        Ok(())
    }
    async fn load(
        &mut self,
        binding: [u8; 32],
        ordinal: usize,
        length: usize,
    ) -> Result<Vec<u8>, RuntimeError> {
        let value = host_load(&binding, ordinal, length)
            .await
            .map_err(host_error)?;
        Ok(Uint8Array::new(&value).to_vec())
    }
    fn phase(&mut self, phase: Phase) {
        host_phase(match phase {
            Phase::Offline => 0,
            Phase::Online => 1,
        });
    }
}
fn host_error(_: JsValue) -> RuntimeError {
    RuntimeError::MessageLength
}
fn error(error: impl core::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

/// Runs one complete wallet-derived keygen with real independent preprocessing.
/// Returns only the public key. Each process receives one owner's root share.
#[wasm_bindgen]
pub async fn prepared_keygen_benchmark(
    role: &str,
    schedule_buffers: Array,
    own_root: Vec<u8>,
) -> Result<Vec<u8>, JsValue> {
    let role = match role {
        "a" => SigningRole::A,
        "b" => SigningRole::B,
        _ => return Err(error("Invalid role")),
    };
    let own_root = Zeroizing::new(own_root);
    let own_root: &[u8; 32] = own_root.as_slice().try_into().map_err(error)?;
    let mut bytes = Vec::new();
    for buffer in schedule_buffers.iter() {
        bytes.push(Uint8Array::new(&buffer).to_vec());
    }
    let mut schedules = Vec::new();
    for encoded in &bytes {
        schedules.push(
            TrustedMlDsaSchedule::parse(encoded, Sha256::digest(encoded).into()).map_err(error)?,
        );
    }
    let mut host = Host;
    host.phase(Phase::Offline);
    let prepared = prepare_keygen(role, &schedules, &mut host)
        .await
        .map_err(error)?;
    match role {
        SigningRole::A => {
            host.send(&[1]).await.map_err(error)?;
            if host.receive(1).await.map_err(error)? != [2] {
                return Err(error("Preparation barrier mismatch"));
            }
        }
        SigningRole::B => {
            if host.receive(1).await.map_err(error)? != [1] {
                return Err(error("Preparation barrier mismatch"));
            }
            host.send(&[2]).await.map_err(error)?;
        }
    }
    host.phase(Phase::Online);
    let (key, _) = prepared.run(own_root, &mut host).await.map_err(error)?;
    Ok(key.public_key.to_vec())
}
