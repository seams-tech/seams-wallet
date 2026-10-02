//! Browser-worker boundary for passkey custody envelopes.
//!
//! Opened custody material never crosses back into JavaScript. Every operation
//! that produces a custody secret returns an opaque handle whose bytes only
//! Rust can read, which is what keeps the custody invariant that
//! JavaScript, the app origin, Router, and persistence adapters never receive a
//! plaintext client root, holder share, PRF output, or KEK.
//!
//! Callers pass parsed envelope records as JSON. The AAD is recomputed inside
//! `signer_core` from those records, so a caller cannot supply an arbitrary AAD
//! blob and cannot bind ciphertext to facts the record does not carry.
//!
//! Scope: this module serves unlock — opening an existing envelope into a
//! handle on the recurring signing path. Custody *ceremonies* (registration and
//! recovery re-establishment) need the owner roots derived and the key manifest
//! verified, which requires protocol crates `near_signer` does not link, so
//! they live in the wallet custody ceremony module instead.

use base64ct::{Base64UrlUnpadded, Encoding};
use serde::Serialize;
use signer_core::ed25519_yao_client_root_transfer::{
    open_ed25519_yao_client_root_envelope_for_linking_v1,
    open_ed25519_yao_client_root_from_linked_device_v1,
    seal_ed25519_yao_client_root_for_linked_device_v1,
    seal_ed25519_yao_client_root_from_envelope_for_linked_device_v1,
    seal_ed25519_yao_client_root_under_factor_v1, Ed25519YaoClientRootFromFactorEnvelopeV1,
    Ed25519YaoClientRootFromLinkedDeviceTransferV1, Ed25519YaoClientRootTransferBindingV1,
    Ed25519YaoClientRootTransferRecipientV1,
};
use signer_core::passkey_custody::{
    open_wallet_custody_seed_envelope_v1, reseal_wallet_custody_seed_under_new_factor_v1,
    PasskeyCustodyEnvelopeBindingV1, PasskeyCustodySecretKind,
    WalletCustodySeedFromSealedEnvelopeV1, PASSKEY_CUSTODY_NONCE_LEN,
};
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

fn js_error(message: impl core::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

fn decode_b64u(value: &str, label: &str) -> Result<Vec<u8>, JsValue> {
    Base64UrlUnpadded::decode_vec(value)
        .map_err(|_| js_error(format!("{label} must be unpadded base64url")))
}

fn decode_digest(value: &str, label: &str) -> Result<[u8; 32], JsValue> {
    let bytes = decode_b64u(value, label)?;
    bytes
        .try_into()
        .map_err(|_| js_error(format!("{label} must decode to 32 bytes")))
}

/// How an admitted custody secret reached this handle.
///
/// The proofs authorize different writes. A seed envelope open may reseal
/// locally and seal a derived root for a linked device. A root received by
/// transfer may reseal only under the receiving device's own factor. A root
/// opened from that device's own envelope may seal only to a further
/// approved link's recipient. The handle holds exactly one, and each write
/// entry point requires its own branch. An enum rather than several
/// `Option`s keeps "admitted twice, by different routes" unrepresentable.
enum WasmCustodyAdmissionV1 {
    SealedEnvelope(WalletCustodySeedFromSealedEnvelopeV1),
    Ed25519YaoClientRootTransfer(Ed25519YaoClientRootFromLinkedDeviceTransferV1),
    Ed25519YaoClientRootEnvelope(Ed25519YaoClientRootFromFactorEnvelopeV1),
}

/// An opened custody secret held in Rust memory.
///
/// There is deliberately no accessor for the bytes: JavaScript can learn the
/// secret's kind and length, hand the handle back into another custody
/// operation, or drop it. The bytes are zeroized when the handle is freed.
#[wasm_bindgen]
pub struct WasmPasskeyCustodyHandleV1 {
    secret: Zeroizing<Vec<u8>>,
    kind: PasskeyCustodySecretKind,
    /// Set when the handle is opened, and cleared when it is destroyed or a
    /// factor seal consumes the proof. The branch-specific proof authorizes the
    /// matching factor-seal operation and never crosses back into JavaScript.
    admitted: Option<WasmCustodyAdmissionV1>,
}

#[wasm_bindgen]
impl WasmPasskeyCustodyHandleV1 {
    /// Zeroizes the held secret immediately, before the handle is dropped.
    /// Callers use this at lock, page lifecycle termination, success, and
    /// failure rather than waiting for garbage collection.
    pub fn destroy(&mut self) {
        self.secret = Zeroizing::new(Vec::new());
        self.admitted = None;
    }
}

fn parse_envelope_binding(binding_json: &str) -> Result<PasskeyCustodyEnvelopeBindingV1, JsValue> {
    serde_json::from_str::<PasskeyCustodyEnvelopeBindingV1>(binding_json).map_err(js_error)
}

/// Opens a wallet custody seed envelope into a handle that can add a factor.
///
/// This is the second-factor enrolment path: a wallet with an Email OTP factor
/// gains a passkey, or the reverse. It needs no owner-root derivation and no
/// protocol crate, because the seed's key manifest was established when its
/// first envelope was written — opening authenticates the seed against that
/// manifest, and the reseal below may only carry the claim forward.
#[wasm_bindgen]
pub fn passkey_custody_open_wallet_seed_v1(
    factor_secret: &[u8],
    envelope_binding_json: &str,
    nonce12: &[u8],
    sealed_custody_secret_b64u: &str,
    aad_hash_b64u: &str,
    ciphertext_digest_b64u: &str,
) -> Result<WasmPasskeyCustodyHandleV1, JsValue> {
    let binding = parse_envelope_binding(envelope_binding_json)?;
    let ciphertext = decode_b64u(sealed_custody_secret_b64u, "sealedCustodySecretB64u")?;
    let expected_aad_hash = decode_digest(aad_hash_b64u, "aadHashB64u")?;
    let expected_ciphertext_digest = decode_digest(ciphertext_digest_b64u, "ciphertextDigestB64u")?;
    let factor_secret = Zeroizing::new(factor_secret.to_vec());
    let (secret, admitted) = open_wallet_custody_seed_envelope_v1(
        &factor_secret,
        &binding,
        nonce12,
        &ciphertext,
        &expected_aad_hash,
        &expected_ciphertext_digest,
    )
    .map_err(js_error)?;
    Ok(WasmPasskeyCustodyHandleV1 {
        secret,
        kind: PasskeyCustodySecretKind::WalletCustodySeed,
        admitted: Some(WasmCustodyAdmissionV1::SealedEnvelope(admitted)),
    })
}

/// Seals an admitted seed under a second factor.
///
/// The nonce is generated here rather than accepted, so a caller cannot reuse
/// one across two seals. Everything except the factor and the envelope id must
/// match the envelope the handle was opened from; `signer_core` enforces that,
/// so a reseal cannot move the seed to another wallet or relabel its keys.
#[wasm_bindgen]
pub fn passkey_custody_reseal_wallet_seed_v1(
    handle: &WasmPasskeyCustodyHandleV1,
    new_factor_secret: &[u8],
    new_envelope_binding_json: &str,
) -> Result<JsValue, JsValue> {
    let admitted = match handle.admitted.as_ref() {
        Some(WasmCustodyAdmissionV1::SealedEnvelope(admitted)) => admitted,
        Some(WasmCustodyAdmissionV1::Ed25519YaoClientRootTransfer(_)) => {
            return Err(js_error(
                "an Ed25519 Yao Client root reseals through its dedicated factor operation",
            ))
        }
        Some(WasmCustodyAdmissionV1::Ed25519YaoClientRootEnvelope(_)) => {
            return Err(js_error(
                "a Client root opened to link a device cannot reseal a wallet seed",
            ))
        }
        None => {
            return Err(js_error(
                "this handle was not opened from a verified wallet custody seed envelope",
            ))
        }
    };
    let binding = parse_envelope_binding(new_envelope_binding_json)?;
    let mut nonce = [0u8; PASSKEY_CUSTODY_NONCE_LEN];
    getrandom::getrandom(&mut nonce)
        .map_err(|_| js_error("envelope nonce randomness is unavailable"))?;
    let new_factor_secret = Zeroizing::new(new_factor_secret.to_vec());
    let sealed = reseal_wallet_custody_seed_under_new_factor_v1(
        &new_factor_secret,
        &binding,
        admitted,
        &nonce,
        &handle.secret[..],
    )
    .map_err(js_error)?;
    serde_wasm_bindgen::to_value(&ResealedEnvelopeWireV1 {
        nonce_b64u: Base64UrlUnpadded::encode_string(&nonce),
        sealed_custody_secret_b64u: sealed.ciphertext_b64u(),
        aad_hash_b64u: sealed.aad_hash_b64u(),
        ciphertext_digest_b64u: sealed.ciphertext_digest_b64u(),
    })
    .map_err(js_error)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResealedEnvelopeWireV1 {
    nonce_b64u: String,
    sealed_custody_secret_b64u: String,
    aad_hash_b64u: String,
    ciphertext_digest_b64u: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SealedEd25519YaoClientRootEnvelopeWireV1 {
    nonce_b64u: String,
    sealed_export_root_b64u: String,
    aad_hash_b64u: String,
    ciphertext_digest_b64u: String,
}

/// Device 2's one-use X25519 recipient for an Ed25519 Yao Client root.
///
/// The private key remains in this WASM object. JavaScript receives only the
/// public routing key and an opaque handle id managed by its worker.
#[wasm_bindgen]
pub struct WasmEd25519YaoClientRootTransferRecipientV1 {
    inner: Option<Ed25519YaoClientRootTransferRecipientV1>,
    public_key: [u8; 32],
}

#[wasm_bindgen]
impl WasmEd25519YaoClientRootTransferRecipientV1 {
    /// Returns the public X25519 recipient key.
    pub fn public_key_b64u(&self) -> String {
        Base64UrlUnpadded::encode_string(&self.public_key)
    }
}

/// Generates Device 2's one-use root recipient inside WASM.
#[wasm_bindgen]
pub fn ed25519_yao_client_root_transfer_recipient_v1(
) -> Result<WasmEd25519YaoClientRootTransferRecipientV1, JsValue> {
    let mut secret = Zeroizing::new([0u8; 32]);
    getrandom::getrandom(&mut secret[..])
        .map_err(|_| js_error("Ed25519 Yao Client-root transfer randomness is unavailable"))?;
    let inner = Ed25519YaoClientRootTransferRecipientV1::from_secret_bytes(&secret[..])
        .map_err(js_error)?;
    Ok(WasmEd25519YaoClientRootTransferRecipientV1 {
        public_key: inner.public_key(),
        inner: Some(inner),
    })
}

/// Seals only the Ed25519 Yao Client root to an approved linked device.
///
/// A handle opened from a verified local wallet custody envelope derives the
/// root from the seed. A handle opened from this device's own Client-root
/// envelope seals that root, and only for the same wallet key. A root just
/// received by transfer is never forwarded. The secret is read only inside
/// this WASM call; the returned value contains ciphertext and public binding
/// facts only.
#[wasm_bindgen]
pub fn passkey_custody_seal_ed25519_yao_client_root_for_linked_device_v1(
    handle: &WasmPasskeyCustodyHandleV1,
    transfer_binding_json: &str,
) -> Result<JsValue, JsValue> {
    let transfer = parse_root_transfer_binding(transfer_binding_json)?;
    let mut ephemeral_secret = Zeroizing::new([0u8; 32]);
    getrandom::getrandom(&mut ephemeral_secret[..])
        .map_err(|_| js_error("Ed25519 Yao Client-root transfer randomness is unavailable"))?;
    let mut nonce = [0u8; PASSKEY_CUSTODY_NONCE_LEN];
    getrandom::getrandom(&mut nonce).map_err(|_| {
        js_error("Ed25519 Yao Client-root transfer nonce randomness is unavailable")
    })?;
    let sealed = match handle.admitted.as_ref() {
        Some(WasmCustodyAdmissionV1::SealedEnvelope(admitted)) => {
            seal_ed25519_yao_client_root_for_linked_device_v1(
                admitted,
                &handle.secret[..],
                &transfer,
                &ephemeral_secret[..],
                &nonce,
            )
        }
        Some(WasmCustodyAdmissionV1::Ed25519YaoClientRootEnvelope(admitted)) => {
            let root = client_root_from_handle(handle)?;
            seal_ed25519_yao_client_root_from_envelope_for_linked_device_v1(
                admitted,
                &root,
                &transfer,
                &ephemeral_secret[..],
                &nonce,
            )
        }
        Some(WasmCustodyAdmissionV1::Ed25519YaoClientRootTransfer(_)) => {
            return Err(js_error(
                "an Ed25519 Yao Client root received by transfer cannot be forwarded",
            ))
        }
        None => {
            return Err(js_error(
                "this handle was not opened from a verified custody envelope",
            ))
        }
    }
    .map_err(js_error)?;
    serde_wasm_bindgen::to_value(&Ed25519YaoClientRootTransferWireV1 {
        ephemeral_public_key_b64u: sealed.ephemeral_public_key_b64u(),
        nonce_b64u: sealed.nonce_b64u(),
        sealed_export_root_b64u: sealed.ciphertext_b64u(),
        binding_digest_b64u: sealed.binding_digest_b64u(),
        ciphertext_digest_b64u: sealed.ciphertext_digest_b64u(),
    })
    .map_err(js_error)
}

/// Device 2 opens one root package addressed to its one-use recipient.
#[wasm_bindgen]
pub fn passkey_custody_open_ed25519_yao_client_root_from_linked_device_v1(
    recipient: &mut WasmEd25519YaoClientRootTransferRecipientV1,
    transfer_binding_json: &str,
    ephemeral_public_key_b64u: &str,
    nonce12: &[u8],
    sealed_export_root_b64u: &str,
    binding_digest_b64u: &str,
    ciphertext_digest_b64u: &str,
) -> Result<WasmPasskeyCustodyHandleV1, JsValue> {
    let recipient_inner = recipient.inner.take().ok_or_else(|| {
        js_error("Ed25519 Yao Client-root transfer recipient was already consumed")
    })?;
    let transfer = parse_root_transfer_binding(transfer_binding_json)?;
    let ephemeral_public_key = decode_b64u(ephemeral_public_key_b64u, "ephemeralPublicKeyB64u")?;
    let ciphertext = decode_b64u(sealed_export_root_b64u, "sealedExportRootB64u")?;
    let expected_binding_digest = decode_digest(binding_digest_b64u, "bindingDigestB64u")?;
    let expected_ciphertext_digest = decode_digest(ciphertext_digest_b64u, "ciphertextDigestB64u")?;
    let (root, admitted) = open_ed25519_yao_client_root_from_linked_device_v1(
        recipient_inner,
        &transfer,
        &ephemeral_public_key,
        nonce12,
        &ciphertext,
        &expected_binding_digest,
        &expected_ciphertext_digest,
    )
    .map_err(js_error)?;
    let root_bytes = Zeroizing::new(root.into_bytes());
    Ok(WasmPasskeyCustodyHandleV1 {
        secret: Zeroizing::new(root_bytes.to_vec()),
        kind: PasskeyCustodySecretKind::Ed25519YaoClientRoot,
        admitted: Some(WasmCustodyAdmissionV1::Ed25519YaoClientRootTransfer(
            admitted,
        )),
    })
}

/// Device 2 immediately factor-seals an opened Client root.
#[wasm_bindgen]
pub fn passkey_custody_seal_ed25519_yao_client_root_under_factor_v1(
    handle: &mut WasmPasskeyCustodyHandleV1,
    factor_secret: &[u8],
    envelope_binding_json: &str,
) -> Result<JsValue, JsValue> {
    let binding = parse_envelope_binding(envelope_binding_json)?;
    if handle.kind != PasskeyCustodySecretKind::Ed25519YaoClientRoot {
        return Err(js_error("custody handle is not an Ed25519 Yao Client root"));
    }
    let admitted = match handle.admitted.take() {
        Some(WasmCustodyAdmissionV1::Ed25519YaoClientRootTransfer(admitted)) => admitted,
        Some(WasmCustodyAdmissionV1::SealedEnvelope(_)) => {
            return Err(js_error(
                "a local wallet custody seed is not an Ed25519 Yao Client root",
            ))
        }
        Some(proof @ WasmCustodyAdmissionV1::Ed25519YaoClientRootEnvelope(_)) => {
            handle.admitted = Some(proof);
            return Err(js_error(
                "an Ed25519 Yao Client root opened to link a device cannot reseal a factor",
            ));
        }
        None => {
            return Err(js_error(
                "this handle was not opened from an Ed25519 Yao Client-root transfer",
            ))
        }
    };
    let root = client_root_from_handle(handle)?;
    handle.destroy();
    let mut nonce = [0u8; PASSKEY_CUSTODY_NONCE_LEN];
    getrandom::getrandom(&mut nonce).map_err(|_| {
        js_error("Ed25519 Yao Client-root envelope nonce randomness is unavailable")
    })?;
    let factor_secret = Zeroizing::new(factor_secret.to_vec());
    let sealed = seal_ed25519_yao_client_root_under_factor_v1(
        &factor_secret,
        &binding,
        admitted,
        &root,
        &nonce,
    )
    .map_err(js_error)?;
    serde_wasm_bindgen::to_value(&SealedEd25519YaoClientRootEnvelopeWireV1 {
        nonce_b64u: Base64UrlUnpadded::encode_string(&nonce),
        sealed_export_root_b64u: sealed.ciphertext_b64u(),
        aad_hash_b64u: sealed.aad_hash_b64u(),
        ciphertext_digest_b64u: sealed.ciphertext_digest_b64u(),
    })
    .map_err(js_error)
}

/// Opens this device's own Client-root envelope to link another device.
///
/// The factor secret is the one this unlock already presented. The handle may
/// seal the root only to the recipient of a further approved link for the
/// same wallet key; it never reseals a factor or a wallet seed.
#[wasm_bindgen]
pub fn passkey_custody_open_ed25519_yao_client_root_envelope_v1(
    factor_secret: &[u8],
    envelope_binding_json: &str,
    nonce12: &[u8],
    sealed_custody_secret_b64u: &str,
    aad_hash_b64u: &str,
    ciphertext_digest_b64u: &str,
) -> Result<WasmPasskeyCustodyHandleV1, JsValue> {
    let binding = parse_envelope_binding(envelope_binding_json)?;
    let ciphertext = decode_b64u(sealed_custody_secret_b64u, "sealedCustodySecretB64u")?;
    let expected_aad_hash = decode_digest(aad_hash_b64u, "aadHashB64u")?;
    let expected_ciphertext_digest = decode_digest(ciphertext_digest_b64u, "ciphertextDigestB64u")?;
    let factor_secret = Zeroizing::new(factor_secret.to_vec());
    let (root, admitted) = open_ed25519_yao_client_root_envelope_for_linking_v1(
        &factor_secret,
        &binding,
        nonce12,
        &ciphertext,
        &expected_aad_hash,
        &expected_ciphertext_digest,
    )
    .map_err(js_error)?;
    let root_bytes = Zeroizing::new(root.into_bytes());
    Ok(WasmPasskeyCustodyHandleV1 {
        secret: Zeroizing::new(root_bytes.to_vec()),
        kind: PasskeyCustodySecretKind::Ed25519YaoClientRoot,
        admitted: Some(WasmCustodyAdmissionV1::Ed25519YaoClientRootEnvelope(
            admitted,
        )),
    })
}

fn client_root_from_handle(
    handle: &WasmPasskeyCustodyHandleV1,
) -> Result<signer_core::ed25519_yao_derivation::Ed25519YaoClientRootV1, JsValue> {
    let root_bytes: Zeroizing<[u8; 32]> = Zeroizing::new(
        handle
            .secret
            .as_slice()
            .try_into()
            .map_err(|_| js_error("Ed25519 Yao Client root handle must contain 32 bytes"))?,
    );
    Ok(signer_core::ed25519_yao_derivation::Ed25519YaoClientRootV1::from_secret_bytes(*root_bytes))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Ed25519YaoClientRootTransferWireV1 {
    ephemeral_public_key_b64u: String,
    nonce_b64u: String,
    sealed_export_root_b64u: String,
    binding_digest_b64u: String,
    ciphertext_digest_b64u: String,
}

fn parse_root_transfer_binding(
    binding_json: &str,
) -> Result<Ed25519YaoClientRootTransferBindingV1, JsValue> {
    serde_json::from_str::<Ed25519YaoClientRootTransferBindingV1>(binding_json).map_err(js_error)
}

// The wallet recovery envelope set is deliberately absent from this module.
//
// Both of its flows are custody ceremonies: issuing a set requires a verified
// key manifest, and opening one is the first step of recovery re-establishment,
// which must verify the manifest before the recovered seed becomes a
// capability. `near_signer` links no protocol crate, so it cannot derive the
// owner roots a manifest check needs — a recovery open exported from here would
// be an unverified path to the seed. Those exports live in the wallet custody
// ceremony module, which links both protocols and completes the whole flow in
// one instance.
