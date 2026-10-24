//! Optional ML-DSA device-link root operations. Handles belong only to this module instance.
use crate::passkey_custody_wasm::{decode_b64u, js_error};
use base64ct::{Base64UrlUnpadded, Encoding};
use ml_dsa::{Keypair, MlDsa65, SigningKey};
use serde::Deserialize;
use signer_core::{
    ml_dsa_link::{
        MlDsaRootFromFactorV1, MlDsaRootTransferBindingV1, MlDsaRootTransferRecipientV1,
        SealedMlDsaRootTransferV1,
    },
    passkey_custody::PasskeyCustodyEnvelopeBindingV1,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmMlDsa65LinkRecipientV1 {
    inner: Option<MlDsaRootTransferRecipientV1>,
    public_key_b64u: String,
}
#[wasm_bindgen]
impl WasmMlDsa65LinkRecipientV1 {
    pub fn public_key_b64u(&self) -> String {
        self.public_key_b64u.clone()
    }
}
#[wasm_bindgen]
pub fn ml_dsa65_link_recipient_v1() -> Result<WasmMlDsa65LinkRecipientV1, JsValue> {
    let inner = MlDsaRootTransferRecipientV1::generate().map_err(js_error)?;
    let public_key_b64u = inner.public_key_b64u();
    Ok(WasmMlDsa65LinkRecipientV1 {
        inner: Some(inner),
        public_key_b64u,
    })
}

/// Opening and factor sealing are one operation. No received plaintext handle reaches JavaScript.
#[wasm_bindgen]
pub fn ml_dsa65_accept_linked_root_v1(
    recipient: &mut WasmMlDsa65LinkRecipientV1,
    factor: &[u8],
    transfer_binding_json: &str,
    package_json: &str,
    target_envelope_binding_json: &str,
) -> Result<String, JsValue> {
    let recipient = recipient
        .inner
        .take()
        .ok_or_else(|| js_error("The ML-DSA recipient was already consumed"))?;
    let binding: MlDsaRootTransferBindingV1 =
        serde_json::from_str(transfer_binding_json).map_err(js_error)?;
    let package: SealedMlDsaRootTransferV1 =
        serde_json::from_str(package_json).map_err(js_error)?;
    let envelope: PasskeyCustodyEnvelopeBindingV1 =
        serde_json::from_str(target_envelope_binding_json).map_err(js_error)?;
    let received = recipient.open(binding, &package).map_err(js_error)?;
    verify_seed(
        &received.seed_for_public_key_verification(),
        received.expected_public_key_b64u(),
    )?;
    let mut nonce = [0u8; 12];
    getrandom::getrandom(&mut nonce)
        .map_err(|_| js_error("ML-DSA root wrapping randomness unavailable"))?;
    let sealed = received
        .seal_under_factor(factor, &envelope, &nonce)
        .map_err(js_error)?;
    serde_json::to_string(&serde_json::json!({
        "nonceB64u": Base64UrlUnpadded::encode_string(&nonce),
        "sealedCustodySecretB64u": sealed.ciphertext_b64u(),
        "aadHashB64u": sealed.aad_hash_b64u(),
        "ciphertextDigestB64u": sealed.ciphertext_digest_b64u(),
    }))
    .map_err(js_error)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RootEnvelopeWire {
    binding_json: String,
    nonce_b64u: String,
    ciphertext_b64u: String,
    aad_hash_b64u: String,
    ciphertext_digest_b64u: String,
}
fn open_root(factor: &[u8], envelope_json: &str) -> Result<MlDsaRootFromFactorV1, JsValue> {
    let wire: RootEnvelopeWire = serde_json::from_str(envelope_json).map_err(js_error)?;
    let binding: PasskeyCustodyEnvelopeBindingV1 =
        serde_json::from_str(&wire.binding_json).map_err(js_error)?;
    MlDsaRootFromFactorV1::open(
        factor,
        &binding,
        &decode_b64u(&wire.nonce_b64u, "nonce")?,
        &decode_b64u(&wire.ciphertext_b64u, "root ciphertext")?,
        &decode_b64u(&wire.aad_hash_b64u, "AAD hash")?,
        &decode_b64u(&wire.ciphertext_digest_b64u, "ciphertext digest")?,
    )
    .map_err(js_error)
}

#[wasm_bindgen]
pub fn ml_dsa65_verify_linked_root_v1(
    factor: &[u8],
    envelope_json: &str,
    wallet_id: &str,
    signing_key_id: &str,
    public_key_b64u: &str,
) -> Result<(), JsValue> {
    let root = open_root(factor, envelope_json)?;
    let seed = root
        .seed_for_export(wallet_id, signing_key_id, public_key_b64u)
        .map_err(js_error)?;
    verify_seed(&seed, public_key_b64u)?;
    Ok(())
}

#[wasm_bindgen]
pub fn ml_dsa65_forward_linked_root_v1(
    factor: &[u8],
    envelope_json: &str,
    transfer_binding_json: &str,
) -> Result<String, JsValue> {
    let root = open_root(factor, envelope_json)?;
    let binding: MlDsaRootTransferBindingV1 =
        serde_json::from_str(transfer_binding_json).map_err(js_error)?;
    let package = root.seal_for_link(&binding).map_err(js_error)?;
    serde_json::to_string(&package).map_err(js_error)
}

#[wasm_bindgen]
pub fn ml_dsa65_export_linked_seed_v1(
    factor: &[u8],
    envelope_json: &str,
    wallet_id: &str,
    signing_key_id: &str,
    expected_public_key_b64u: &str,
) -> Result<String, JsValue> {
    let root = open_root(factor, envelope_json)?;
    let seed = root
        .seed_for_export(wallet_id, signing_key_id, expected_public_key_b64u)
        .map_err(js_error)?;
    export_seed_payload(&seed, expected_public_key_b64u)
}

fn verify_seed(seed: &[u8; 32], expected_public_key_b64u: &str) -> Result<String, JsValue> {
    let seed_ref: &ml_dsa::Seed = seed.as_slice().try_into().map_err(js_error)?;
    let key = SigningKey::<MlDsa65>::from_seed(seed_ref);
    let public_key = Base64UrlUnpadded::encode_string(key.verifying_key().encode().as_slice());
    if public_key != expected_public_key_b64u {
        return Err(js_error("ML-DSA root does not reproduce the published key"));
    }
    Ok(public_key)
}
pub(super) fn export_seed_payload(
    seed: &[u8; 32],
    expected_public_key_b64u: &str,
) -> Result<String, JsValue> {
    let public_key = verify_seed(seed, expected_public_key_b64u)?;
    serde_json::to_string(&serde_json::json!({ "format": "fips-204-ml-dsa-65-seed-v1", "publicKeyB64u": public_key, "seedB64u": Base64UrlUnpadded::encode_string(seed) })).map_err(js_error)
}
