use base64ct::{Base64UrlUnpadded, Encoding};
use router_ab_core::{
    Ed25519YaoCeremonyBindingV1, Ed25519YaoLaneJobV1, RouterAbEd25519YaoApplicationBindingFactsV1,
    RouterAbEd25519YaoExportAdmissionReceiptV1, RouterAbEd25519YaoExportResultV1,
};
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;
use zeroize::{Zeroize, Zeroizing};

use crate::{complete_client_activation_packages_v1, verify_public_relation};
use crate::{
    complete_client_export_v1, create_client_signing_share_v1, prepare_client_export_with_root_v1,
    ClientActivationEntropyV1, ClientExportStateV1, ClientSigningRequestV1,
};
use crate::{
    complete_client_lane_v1, prepare_client_lane_dispatch_with_root_v1, prepare_client_lane_v1,
    prepare_client_registration_source_preserving_with_root_v1,
    ClientActivationSourcePreservingEntropyV1, ClientLaneExecutionEntropyV1,
    Ed25519YaoClientRootV1, PreparedClientLaneV1,
};
use crate::{
    ed25519_local_material_binding_v1, import_activated_client_material_v1,
    open_wallet_custody_ed25519_material_v1, seal_activated_client_material_v1,
    LocalMaterialSealDomainV1, OpenWalletCustodyEd25519MaterialV1,
};
use router_ab_core::{
    Ed25519YaoEncryptedPackageV1, RouterAbEd25519YaoActivationAdmissionReceiptV1,
    RouterAbEd25519YaoActivationPublicReceiptV1,
};
use signer_core::ed25519_yao_client_root_transfer::open_ed25519_yao_client_root_under_factor_v1;
use signer_core::near_ed25519_recovery::{
    build_near_ed25519_seed_export_artifact_v1, encode_near_ed25519_public_key_from_seed,
};
use signer_core::near_threshold_ed25519::CommitmentsWire;
use signer_core::passkey_custody::{
    open_wallet_custody_seed_envelope_v1, PasskeyCustodyEnvelopeBindingV1,
};
use signer_core::wallet_seed_derivation::derive_ed25519_yao_client_root_from_seed_v1;

/// One-use owner export session opened from a factor-sealed wallet custody
/// seed. Linked-device export uses the dedicated Client-root session below.
#[wasm_bindgen]
pub struct WasmWalletCustodySeedExportSessionV1 {
    execute_request_json: String,
    state: Option<ClientExportStateV1>,
}

#[wasm_bindgen]
impl WasmWalletCustodySeedExportSessionV1 {
    /// Opens the wallet custody seed and prepares a one-use export request.
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        admission_json: &str,
        application_json: &str,
        client_participant_id: u16,
        signing_worker_participant_id: u16,
        factor_secret: &[u8],
        envelope_binding_json: &str,
        envelope_nonce: &[u8],
        envelope_ciphertext: &[u8],
        envelope_aad_hash: &[u8],
        envelope_ciphertext_digest: &[u8],
        recipient_key_material: &[u8],
        deriver_a_seal_seed: &[u8],
        deriver_b_seal_seed: &[u8],
    ) -> Result<WasmWalletCustodySeedExportSessionV1, JsValue> {
        let admission =
            serde_json::from_str::<RouterAbEd25519YaoExportAdmissionReceiptV1>(admission_json)
                .map_err(js_error)?;
        let application =
            serde_json::from_str::<RouterAbEd25519YaoApplicationBindingFactsV1>(application_json)
                .map_err(js_error)?;
        let envelope_binding =
            serde_json::from_str::<PasskeyCustodyEnvelopeBindingV1>(envelope_binding_json)
                .map_err(js_error)?;
        let factor_secret = Zeroizing::new(parse_32(factor_secret, "custody factor secret")?);
        let (seed, _) = open_wallet_custody_seed_envelope_v1(
            &*factor_secret,
            &envelope_binding,
            envelope_nonce,
            envelope_ciphertext,
            envelope_aad_hash,
            envelope_ciphertext_digest,
        )
        .map_err(js_error)?;
        let custody_seed = Zeroizing::new(
            seed.as_slice()
                .try_into()
                .map_err(|_| JsValue::from_str("wallet custody seed must contain 32 bytes"))?,
        );
        let recipient_key_material =
            Zeroizing::new(parse_32(recipient_key_material, "recipient key material")?);
        let deriver_a_seal_seed =
            Zeroizing::new(parse_32(deriver_a_seal_seed, "Deriver A seal seed")?);
        let deriver_b_seal_seed =
            Zeroizing::new(parse_32(deriver_b_seal_seed, "Deriver B seal seed")?);
        let entropy = ClientActivationEntropyV1::new(
            *recipient_key_material,
            *deriver_a_seal_seed,
            *deriver_b_seal_seed,
        )
        .map_err(js_error)?;
        let prepared = crate::prepare_client_export_from_custody_seed_v1(
            &admission,
            &application,
            [client_participant_id, signing_worker_participant_id],
            &*custody_seed,
            entropy,
        )
        .map_err(js_error)?;
        let (execute_request, state) = prepared.into_parts();
        let execute_request_json = serde_json::to_string(&execute_request).map_err(js_error)?;
        Ok(Self {
            execute_request_json,
            state: Some(state),
        })
    }

    /// Returns the serialized request to execute through the Router A/B export protocol.
    pub fn execute_request_json(&self) -> String {
        self.execute_request_json.clone()
    }

    /// Consumes the session and returns the verified exported seed.
    pub fn complete(&mut self, result_json: &str) -> Result<WasmExportedEd25519SeedV1, JsValue> {
        let result = serde_json::from_str::<RouterAbEd25519YaoExportResultV1>(result_json)
            .map_err(js_error)?;
        let state = self
            .state
            .take()
            .ok_or_else(|| JsValue::from_str("Ed25519 Yao export session was consumed"))?;
        let seed = complete_client_export_v1(state, &result).map_err(js_error)?;
        Ok(WasmExportedEd25519SeedV1 {
            seed: Some(Zeroizing::new(seed.into_bytes())),
        })
    }
}

/// One-use explicit export session opened from a factor-sealed Ed25519 Yao
/// Client root.
///
/// The factor authorizes and opens the root envelope. No wallet custody seed
/// is accepted or reconstructed on this ordinary export path.
#[wasm_bindgen]
pub struct WasmEd25519YaoClientRootExportSessionV1 {
    execute_request_json: String,
    state: Option<ClientExportStateV1>,
}

#[wasm_bindgen]
impl WasmEd25519YaoClientRootExportSessionV1 {
    /// Opens the factor-sealed Client root and prepares a one-use export request.
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        admission_json: &str,
        application_json: &str,
        client_participant_id: u16,
        signing_worker_participant_id: u16,
        factor_secret: &[u8],
        envelope_binding_json: &str,
        envelope_nonce: &[u8],
        envelope_ciphertext: &[u8],
        envelope_aad_hash: &[u8],
        envelope_ciphertext_digest: &[u8],
        recipient_key_material: &[u8],
        deriver_a_seal_seed: &[u8],
        deriver_b_seal_seed: &[u8],
    ) -> Result<WasmEd25519YaoClientRootExportSessionV1, JsValue> {
        let admission =
            serde_json::from_str::<RouterAbEd25519YaoExportAdmissionReceiptV1>(admission_json)
                .map_err(js_error)?;
        let application =
            serde_json::from_str::<RouterAbEd25519YaoApplicationBindingFactsV1>(application_json)
                .map_err(js_error)?;
        let envelope_binding =
            serde_json::from_str::<PasskeyCustodyEnvelopeBindingV1>(envelope_binding_json)
                .map_err(js_error)?;
        let factor_secret = Zeroizing::new(parse_32(factor_secret, "custody factor secret")?);
        let root_facts = root_envelope_facts(&envelope_binding)?;
        if root_facts.wallet_id != application.wallet_id() {
            return Err(JsValue::from_str(
                "factor-sealed Ed25519 Yao Client root is bound to another wallet",
            ));
        }
        let root = open_ed25519_yao_client_root_under_factor_v1(
            &*factor_secret,
            &envelope_binding,
            envelope_nonce,
            envelope_ciphertext,
            envelope_aad_hash,
            envelope_ciphertext_digest,
        )
        .map_err(js_error)?;
        let expected_application_binding_digest = crate::client_application_binding_digest_v1(
            &application,
            [client_participant_id, signing_worker_participant_id],
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
        if root_facts.application_binding_digest != expected_application_binding_digest {
            return Err(JsValue::from_str(
                "factor-sealed Ed25519 Yao Client root is bound to another application",
            ));
        }
        if root_facts.registered_public_key != admission.binding().registered_public_key() {
            return Err(JsValue::from_str(
                "factor-sealed Ed25519 Yao Client root is bound to another public key",
            ));
        }
        let recipient_key_material =
            Zeroizing::new(parse_32(recipient_key_material, "recipient key material")?);
        let deriver_a_seal_seed =
            Zeroizing::new(parse_32(deriver_a_seal_seed, "Deriver A seal seed")?);
        let deriver_b_seal_seed =
            Zeroizing::new(parse_32(deriver_b_seal_seed, "Deriver B seal seed")?);
        let entropy = ClientActivationEntropyV1::new(
            *recipient_key_material,
            *deriver_a_seal_seed,
            *deriver_b_seal_seed,
        )
        .map_err(js_error)?;
        let prepared = prepare_client_export_with_root_v1(
            &admission,
            &application,
            [client_participant_id, signing_worker_participant_id],
            root,
            entropy,
        )
        .map_err(js_error)?;
        let (execute_request, state) = prepared.into_parts();
        let execute_request_json = serde_json::to_string(&execute_request).map_err(js_error)?;
        Ok(Self {
            execute_request_json,
            state: Some(state),
        })
    }

    /// Returns the serialized request to execute through the Router A/B export protocol.
    pub fn execute_request_json(&self) -> String {
        self.execute_request_json.clone()
    }

    /// Consumes the session and returns the verified exported seed.
    pub fn complete(&mut self, result_json: &str) -> Result<WasmExportedEd25519SeedV1, JsValue> {
        let result = serde_json::from_str::<RouterAbEd25519YaoExportResultV1>(result_json)
            .map_err(js_error)?;
        let state = self
            .state
            .take()
            .ok_or_else(|| JsValue::from_str("Ed25519 Yao export session was consumed"))?;
        let seed = complete_client_export_v1(state, &result).map_err(js_error)?;
        Ok(WasmExportedEd25519SeedV1 {
            seed: Some(Zeroizing::new(seed.into_bytes())),
        })
    }
}

/// One-use verified Ed25519 seed returned to the secure export viewer boundary.
#[wasm_bindgen]
pub struct WasmExportedEd25519SeedV1 {
    seed: Option<Zeroizing<[u8; 32]>>,
}

#[wasm_bindgen]
impl WasmExportedEd25519SeedV1 {
    /// Builds the standard verified NEAR export artifact exactly once.
    pub fn take_export_artifact_json(&mut self) -> Result<String, JsValue> {
        let mut seed = self
            .seed
            .take()
            .ok_or_else(|| JsValue::from_str("Ed25519 Yao exported seed was consumed"))?;
        let expected_public_key = encode_near_ed25519_public_key_from_seed(*seed);
        let artifact = build_near_ed25519_seed_export_artifact_v1(*seed, &expected_public_key)
            .map_err(js_error)?;
        seed.zeroize();
        serde_json::to_string(&artifact).map_err(js_error)
    }
}

/// Verified Client activation material retained inside the browser WASM boundary.
#[wasm_bindgen]
pub struct WasmActivatedClientV1 {
    client_scalar_share: Zeroizing<[u8; 32]>,
    registered_public_key: [u8; 32],
    state_epoch: u64,
}

/// Worker-owned Client material completed from one exact ordinary activation.
///
/// The scalar share remains in Rust until the worker explicitly consumes it
/// for its local factor-sealing operation. Package metadata is retained so a
/// caller cannot accidentally seal material under another transcript.
#[wasm_bindgen]
pub struct WasmOrdinaryEd25519ActivationClientMaterialV1 {
    client_scalar_share: Option<Zeroizing<[u8; 32]>>,
    session: [u8; 32],
    transcript: [u8; 32],
}

#[wasm_bindgen]
impl WasmOrdinaryEd25519ActivationClientMaterialV1 {
    /// Opens and combines the two Client packages for one admitted activation.
    /// The binding, receipt, and participant IDs provide the public relation
    /// needed before local factor sealing. The recipient private key is
    /// consumed only in Rust/WASM.
    #[wasm_bindgen(constructor)]
    pub fn new(
        binding_json: &str,
        deriver_a_client_package_json: &str,
        deriver_b_client_package_json: &str,
        recipient_private_key: &[u8],
        participant_ids_json: &str,
        public_receipt_json: &str,
    ) -> Result<Self, JsValue> {
        let binding =
            serde_json::from_str::<Ed25519YaoCeremonyBindingV1>(binding_json).map_err(js_error)?;
        let participant_ids =
            serde_json::from_str::<[u16; 2]>(participant_ids_json).map_err(js_error)?;
        let public_receipt = serde_json::from_str::<RouterAbEd25519YaoActivationPublicReceiptV1>(
            public_receipt_json,
        )
        .map_err(js_error)?;
        let deriver_a =
            serde_json::from_str::<Ed25519YaoEncryptedPackageV1>(deriver_a_client_package_json)
                .map_err(js_error)?;
        let deriver_b =
            serde_json::from_str::<Ed25519YaoEncryptedPackageV1>(deriver_b_client_package_json)
                .map_err(js_error)?;
        let recipient_private_key = Zeroizing::new(parse_32(
            recipient_private_key,
            "Ed25519 activation recipient private key",
        )?);
        let (client_scalar_share, transcript) = complete_client_activation_packages_v1(
            &binding,
            participant_ids,
            &public_receipt,
            &recipient_private_key,
            &deriver_a,
            &deriver_b,
        )
        .map_err(js_error)?;
        Ok(Self {
            client_scalar_share: Some(client_scalar_share),
            session: binding.session_id.into_bytes(),
            transcript,
        })
    }

    /// Returns the exact activation session bound to the opened packages.
    pub fn session(&self) -> Vec<u8> {
        self.session.to_vec()
    }

    /// Returns the exact Router transcript bound to the opened packages.
    pub fn transcript(&self) -> Vec<u8> {
        self.transcript.to_vec()
    }

    /// Consumes the local scalar for the worker's factor-sealing primitive.
    pub fn take_client_material(&mut self) -> Result<Vec<u8>, JsValue> {
        let material = self
            .client_scalar_share
            .take()
            .ok_or_else(|| JsValue::from_str("Ed25519 activation material was consumed"))?;
        Ok(material.to_vec())
    }

    /// Zeroizes the retained Client share before normal object collection.
    pub fn destroy(&mut self) {
        if let Some(mut material) = self.client_scalar_share.take() {
            material.zeroize();
        }
    }
}

#[wasm_bindgen]
impl WasmActivatedClientV1 {
    /// Returns the verified 32-byte Ed25519 public key.
    pub fn registered_public_key(&self) -> Vec<u8> {
        self.registered_public_key.to_vec()
    }

    /// Returns the activated SigningWorker state epoch.
    pub fn state_epoch(&self) -> u64 {
        self.state_epoch
    }

    /// Authenticates and encrypts the active Client material for same-device rehydration.
    pub fn seal_local_material(
        &self,
        passkey_prf_first: &[u8],
        binding: &[u8],
        nonce: &[u8],
    ) -> Result<Vec<u8>, JsValue> {
        let wrapping_secret = Zeroizing::new(parse_32(passkey_prf_first, "passkey PRF.first")?);
        seal_activated_client_local_material(
            self,
            &wrapping_secret,
            binding,
            nonce,
            LocalMaterialSealDomainV1::PasskeyPrfFirst,
        )
    }

    /// Opens a same-device envelope and re-verifies its public threshold relation.
    #[allow(clippy::too_many_arguments)]
    pub fn import_local_material(
        passkey_prf_first: &[u8],
        binding: &[u8],
        nonce: &[u8],
        ciphertext: &[u8],
        expected_registered_public_key: &[u8],
        expected_state_epoch: u64,
        client_participant_id: u16,
        signing_worker_participant_id: u16,
        signing_worker_verifying_share: &[u8],
    ) -> Result<WasmActivatedClientV1, JsValue> {
        let wrapping_secret = Zeroizing::new(parse_32(passkey_prf_first, "passkey PRF.first")?);
        import_activated_client_local_material(
            &wrapping_secret,
            binding,
            nonce,
            ciphertext,
            expected_registered_public_key,
            expected_state_epoch,
            [client_participant_id, signing_worker_participant_id],
            signing_worker_verifying_share,
            LocalMaterialSealDomainV1::PasskeyPrfFirst,
        )
    }

    /// Imports one linked-device Client share after verifying the complete
    /// public threshold relation carried by its activation receipt.
    pub fn import_linked_material(
        client_scalar_share: &[u8],
        client_participant_id: u16,
        signing_worker_participant_id: u16,
        public_receipt_json: &str,
    ) -> Result<WasmActivatedClientV1, JsValue> {
        let client_scalar_share = Zeroizing::new(parse_32(
            client_scalar_share,
            "linked-device Ed25519 Client share",
        )?);
        let public_receipt = serde_json::from_str::<RouterAbEd25519YaoActivationPublicReceiptV1>(
            public_receipt_json,
        )
        .map_err(js_error)?;
        verify_public_relation(
            &client_scalar_share,
            [client_participant_id, signing_worker_participant_id],
            &public_receipt,
        )
        .map_err(js_error)?;
        Ok(WasmActivatedClientV1 {
            client_scalar_share,
            registered_public_key: public_receipt.registered_public_key(),
            state_epoch: public_receipt.state_epoch().get(),
        })
    }

    /// Creates a signature share while retaining the Client scalar inside WASM.
    #[allow(clippy::too_many_arguments)]
    pub fn create_signing_share(
        &self,
        client_participant_id: u16,
        signing_worker_participant_id: u16,
        admitted_digest: &[u8],
        signing_worker_commitments_json: &str,
        signing_worker_verifying_share: &[u8],
    ) -> Result<WasmClientSigningShareV1, JsValue> {
        build_client_signing_share(
            &self.client_scalar_share,
            &self.registered_public_key,
            client_participant_id,
            signing_worker_participant_id,
            admitted_digest,
            signing_worker_commitments_json,
            signing_worker_verifying_share,
        )
    }
}

/// Seals under one of the shared wrapping domains.
///
/// The crypto itself lives in `local_material`, because the wallet custody
/// ceremony has to seal the same record shape from its own wasm module and
/// this one is compiled only for `wasm32`. These shims exist to keep the
/// binding surface unchanged while there is a single implementation underneath.
fn seal_activated_client_local_material(
    activated_client: &WasmActivatedClientV1,
    wrapping_secret: &[u8; 32],
    binding: &[u8],
    nonce: &[u8],
    domain: LocalMaterialSealDomainV1,
) -> Result<Vec<u8>, JsValue> {
    seal_activated_client_material_v1(
        &activated_client.client_scalar_share,
        &activated_client.registered_public_key,
        activated_client.state_epoch,
        wrapping_secret,
        binding,
        nonce,
        domain,
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[allow(clippy::too_many_arguments)]
fn import_activated_client_local_material(
    wrapping_secret: &[u8; 32],
    binding: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
    expected_registered_public_key: &[u8],
    expected_state_epoch: u64,
    participant_ids: [u16; 2],
    signing_worker_verifying_share: &[u8],
    domain: LocalMaterialSealDomainV1,
) -> Result<WasmActivatedClientV1, JsValue> {
    let expected_registered_public_key = parse_32(
        expected_registered_public_key,
        "expected registered Ed25519 public key",
    )?;
    let signing_worker_verifying_share = parse_32(
        signing_worker_verifying_share,
        "SigningWorker verifying share",
    )?;
    let opened = import_activated_client_material_v1(
        wrapping_secret,
        binding,
        nonce,
        ciphertext,
        &expected_registered_public_key,
        expected_state_epoch,
        participant_ids,
        &signing_worker_verifying_share,
        domain,
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(WasmActivatedClientV1 {
        client_scalar_share: opened.client_scalar_share,
        registered_public_key: opened.registered_public_key,
        state_epoch: opened.state_epoch,
    })
}

/// Opens the wallet's Ed25519 continuity cache with any enrolled factor.
///
/// **The unlock read side, and deliberately one call.** The custody seed
/// exists only between opening the envelope and deriving the cache key.
/// Splitting this into "open the envelope" and "open the cache" would put the
/// seed in a caller's hands, and every caller here is JavaScript.
///
/// Exported from *this* module rather than the ceremony's because the handle
/// it returns has to be the one the signing path already uses: two wasm
/// modules each define their own `WasmActivatedClientV1`, and a handle from
/// the wrong module cannot sign.
///
/// The caller never assembles the cache seal binding. It is rebuilt here from
/// the record's own fields, because it is both HKDF input and AEAD associated
/// data — a caller that assembled it even slightly differently would hold a
/// record that never opens, and the failure would read as a bad factor.
///
/// Any factor works, which is the point of sealing under the seed: a passkey
/// enrolled long after registration opens the cache the Email OTP enrollment
/// wrote, and the reverse.
#[wasm_bindgen(js_name = openWalletCustodyEd25519MaterialV1)]
#[allow(clippy::too_many_arguments)]
pub fn wasm_open_wallet_custody_ed25519_material_v1(
    factor_secret: &[u8],
    envelope_binding_json: &str,
    envelope_nonce: &[u8],
    envelope_ciphertext: &[u8],
    envelope_aad_hash: &[u8],
    envelope_ciphertext_digest: &[u8],
    application_binding_digest: &[u8],
    registered_public_key: &[u8],
    state_epoch: u64,
    client_participant_id: u16,
    signing_worker_participant_id: u16,
    signing_worker_verifying_share: &[u8],
    cache_nonce: &[u8],
    cache_ciphertext: &[u8],
) -> Result<WasmActivatedClientV1, JsValue> {
    let envelope_binding =
        serde_json::from_str::<PasskeyCustodyEnvelopeBindingV1>(envelope_binding_json)
            .map_err(js_error)?;
    let application_binding_digest =
        parse_32(application_binding_digest, "application binding digest")?;
    let registered_public_key = parse_32(
        registered_public_key,
        "expected registered Ed25519 public key",
    )?;
    let signing_worker_verifying_share = parse_32(
        signing_worker_verifying_share,
        "SigningWorker verifying share",
    )?;
    let participant_ids = [client_participant_id, signing_worker_participant_id];

    // Rebuilt, never accepted: see above.
    let binding = ed25519_local_material_binding_v1(
        &application_binding_digest,
        &registered_public_key,
        participant_ids,
        state_epoch,
    );

    let opened = open_wallet_custody_ed25519_material_v1(OpenWalletCustodyEd25519MaterialV1 {
        factor_secret,
        envelope_binding: &envelope_binding,
        envelope_nonce,
        envelope_ciphertext,
        envelope_aad_hash,
        envelope_ciphertext_digest,
        application_binding_digest: &application_binding_digest,
        binding: &binding,
        nonce: cache_nonce,
        ciphertext: cache_ciphertext,
        expected_registered_public_key: &registered_public_key,
        expected_state_epoch: state_epoch,
        participant_ids,
        signing_worker_verifying_share: &signing_worker_verifying_share,
    })
    .map_err(js_error)?;

    Ok(WasmActivatedClientV1 {
        client_scalar_share: Zeroizing::new(*opened.client_scalar_share()),
        registered_public_key: opened.registered_public_key(),
        state_epoch: opened.state_epoch(),
    })
}

/// One Client FROST share created from activated Yao material.
#[wasm_bindgen]
pub struct WasmClientSigningShareV1 {
    client_commitments_json: String,
    client_verifying_share: Vec<u8>,
    client_signature_share_b64u: String,
}

#[wasm_bindgen]
impl WasmClientSigningShareV1 {
    /// Returns the Client FROST commitments as canonical JSON.
    pub fn client_commitments_json(&self) -> String {
        self.client_commitments_json.clone()
    }

    /// Returns the public Client verifying share.
    pub fn client_verifying_share(&self) -> Vec<u8> {
        self.client_verifying_share.clone()
    }

    /// Returns the canonical Client signature share.
    pub fn client_signature_share_b64u(&self) -> String {
        self.client_signature_share_b64u.clone()
    }
}

#[allow(clippy::too_many_arguments)]
fn build_client_signing_share(
    client_scalar_share: &[u8; 32],
    registered_public_key: &[u8; 32],
    client_participant_id: u16,
    signing_worker_participant_id: u16,
    admitted_digest: &[u8],
    signing_worker_commitments_json: &str,
    signing_worker_verifying_share: &[u8],
) -> Result<WasmClientSigningShareV1, JsValue> {
    let admitted_digest = parse_32(admitted_digest, "admitted digest")?;
    let signing_worker_verifying_share = parse_32(
        signing_worker_verifying_share,
        "SigningWorker verifying share",
    )?;
    let signing_worker_commitments =
        serde_json::from_str::<CommitmentsWire>(signing_worker_commitments_json)
            .map_err(js_error)?;
    let output = create_client_signing_share_v1(ClientSigningRequestV1 {
        client_scalar_share,
        registered_public_key,
        participant_ids: [client_participant_id, signing_worker_participant_id],
        admitted_digest: &admitted_digest,
        signing_worker_commitments: &signing_worker_commitments,
        signing_worker_verifying_share: &signing_worker_verifying_share,
    })
    .map_err(js_error)?;
    Ok(WasmClientSigningShareV1 {
        client_commitments_json: serde_json::to_string(output.client_commitments())
            .map_err(js_error)?,
        client_verifying_share: output.client_verifying_share().to_vec(),
        client_signature_share_b64u: output.client_signature_share_b64u().to_owned(),
    })
}

fn parse_32(value: &[u8], label: &str) -> Result<[u8; 32], JsValue> {
    value
        .try_into()
        .map_err(|_| JsValue::from_str(&format!("{label} must contain exactly 32 bytes")))
}

struct RootEnvelopeFactsV1 {
    wallet_id: String,
    wallet_key_id: String,
    enrollment_id: String,
    revocation_epoch: u64,
    application_binding_digest: [u8; 32],
    registered_public_key: [u8; 32],
}

fn root_envelope_facts(
    binding: &PasskeyCustodyEnvelopeBindingV1,
) -> Result<RootEnvelopeFactsV1, JsValue> {
    let signer_core::passkey_custody::PasskeyCustodySecretBindingV1::Ed25519YaoClientRoot {
        wallet_key_id,
        application_binding_digest_b64u,
        registered_public_key_b64u,
        enrollment_id,
        revocation_epoch,
        ..
    } = &binding.binding
    else {
        return Err(JsValue::from_str(
            "Ed25519 Yao Client-root export requires an Ed25519 Yao Client-root envelope",
        ));
    };
    let application_binding_digest = Base64UrlUnpadded::decode_vec(application_binding_digest_b64u)
        .map_err(|_| JsValue::from_str("applicationBindingDigestB64u must be base64url"))?;
    let registered_public_key = Base64UrlUnpadded::decode_vec(registered_public_key_b64u)
        .map_err(|_| JsValue::from_str("registeredPublicKeyB64u must be base64url"))?;
    Ok(RootEnvelopeFactsV1 {
        wallet_id: binding.wallet_id.clone(),
        wallet_key_id: wallet_key_id.clone(),
        enrollment_id: enrollment_id.clone(),
        revocation_epoch: *revocation_epoch,
        application_binding_digest: parse_32(
            &application_binding_digest,
            "application binding digest",
        )?,
        registered_public_key: parse_32(&registered_public_key, "registered Ed25519 public key")?,
    })
}

fn js_error(error: impl core::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn parse_js_domain_value<T: DeserializeOwned>(value: JsValue) -> Result<T, JsValue> {
    if let Some(json) = value.as_string() {
        serde_json::from_str(&json).map_err(js_error)
    } else {
        serde_wasm_bindgen::from_value(value).map_err(js_error)
    }
}

/// Opaque wallet-custody source for Ed25519 Yao lane preparation.
///
/// This handle must be created and retained inside the dedicated signing
/// worker. Neither the custody seed nor stable Client root crosses into JS.
#[wasm_bindgen]
pub struct WasmEd25519YaoLaneSourceV1 {
    root: Ed25519YaoClientRootV1,
    wallet_id: String,
    wallet_key_id: String,
    enrollment_id: String,
    revocation_epoch: u64,
    application_binding_digest: [u8; 32],
    registered_public_key: [u8; 32],
}

#[wasm_bindgen]
impl WasmEd25519YaoLaneSourceV1 {
    /// Opens the custody envelope and retains only the derived Client root.
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        factor_secret: &[u8],
        envelope_binding_json: &str,
        envelope_nonce: &[u8],
        envelope_ciphertext: &[u8],
        envelope_aad_hash: &[u8],
        envelope_ciphertext_digest: &[u8],
    ) -> Result<Self, JsValue> {
        let envelope_binding =
            serde_json::from_str::<PasskeyCustodyEnvelopeBindingV1>(envelope_binding_json)
                .map_err(js_error)?;
        let factor_secret = Zeroizing::new(factor_secret.to_vec());
        let root_facts = root_envelope_facts(&envelope_binding)?;
        let root = open_ed25519_yao_client_root_under_factor_v1(
            &factor_secret,
            &envelope_binding,
            envelope_nonce,
            envelope_ciphertext,
            envelope_aad_hash,
            envelope_ciphertext_digest,
        )
        .map_err(js_error)?;
        Ok(Self {
            root,
            wallet_id: root_facts.wallet_id,
            wallet_key_id: root_facts.wallet_key_id,
            enrollment_id: root_facts.enrollment_id,
            revocation_epoch: root_facts.revocation_epoch,
            application_binding_digest: root_facts.application_binding_digest,
            registered_public_key: root_facts.registered_public_key,
        })
    }
}

/// Opens a verified owner custody-seed envelope and derives the exact Client
/// root for an approved lane job. This is the owner-capability branch; ordinary
/// factor opens continue to require a dedicated Client-root envelope.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn ed25519_yao_lane_source_from_wallet_seed_v1(
    factor_secret: &[u8],
    envelope_binding_json: &str,
    envelope_nonce: &[u8],
    envelope_ciphertext: &[u8],
    envelope_aad_hash: &[u8],
    envelope_ciphertext_digest: &[u8],
    application_binding_digest: &[u8],
    wallet_key_id: &str,
    enrollment_id: &str,
    revocation_epoch: u64,
    registered_public_key: &[u8],
) -> Result<WasmEd25519YaoLaneSourceV1, JsValue> {
    let envelope_binding =
        serde_json::from_str::<PasskeyCustodyEnvelopeBindingV1>(envelope_binding_json)
            .map_err(js_error)?;
    let factor_secret = Zeroizing::new(factor_secret.to_vec());
    let (seed, _) = open_wallet_custody_seed_envelope_v1(
        &factor_secret,
        &envelope_binding,
        envelope_nonce,
        envelope_ciphertext,
        envelope_aad_hash,
        envelope_ciphertext_digest,
    )
    .map_err(js_error)?;
    let application_binding_digest =
        parse_32(application_binding_digest, "application binding digest")?;
    let root_bytes =
        derive_ed25519_yao_client_root_from_seed_v1(&seed, &application_binding_digest)
            .map_err(js_error)?;
    Ok(WasmEd25519YaoLaneSourceV1 {
        root: Ed25519YaoClientRootV1::from_secret_bytes(*root_bytes),
        wallet_id: envelope_binding.wallet_id,
        wallet_key_id: wallet_key_id.to_owned(),
        enrollment_id: enrollment_id.to_owned(),
        revocation_epoch,
        application_binding_digest,
        registered_public_key: parse_32(registered_public_key, "registered Ed25519 public key")?,
    })
}

/// One-use source-preserving registration request prepared from an opaque
/// owner source. The root is borrowed only while the request is sealed and is
/// never retained by this session or returned to JavaScript.
#[wasm_bindgen]
pub struct WasmEd25519YaoSourcePreservingRegistrationSessionV1 {
    request_json: Option<String>,
}

#[wasm_bindgen]
impl WasmEd25519YaoSourcePreservingRegistrationSessionV1 {
    /// Seals one target registration request to Device 2's recipient key.
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        admission_input: JsValue,
        application_input: JsValue,
        client_participant_id: u16,
        signing_worker_participant_id: u16,
        source: &WasmEd25519YaoLaneSourceV1,
        expected_registered_public_key: &[u8],
        target_client_recipient_public_key: &[u8],
        deriver_a_seal_seed: &[u8],
        deriver_b_seal_seed: &[u8],
    ) -> Result<Self, JsValue> {
        let admission = parse_js_domain_value::<RouterAbEd25519YaoActivationAdmissionReceiptV1>(
            admission_input,
        )?;
        let application = parse_js_domain_value::<RouterAbEd25519YaoApplicationBindingFactsV1>(
            application_input,
        )?;
        let participant_ids = [client_participant_id, signing_worker_participant_id];
        if participant_ids[0] == 0 || participant_ids[0] >= participant_ids[1] {
            return Err(JsValue::from_str(
                "source-preserving participant ids must be distinct, nonzero, ascending values",
            ));
        }
        let expected_application_binding_digest =
            crate::client_application_binding_digest_v1(&application, participant_ids)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
        if source.application_binding_digest != expected_application_binding_digest {
            return Err(JsValue::from_str(
                "Ed25519 Yao Client-root source is bound to another application",
            ));
        }
        if source.wallet_id != application.wallet_id() {
            return Err(JsValue::from_str(
                "Ed25519 Yao Client-root source is bound to another wallet",
            ));
        }
        if source.registered_public_key
            != parse_32(
                expected_registered_public_key,
                "source registered Ed25519 public key",
            )?
        {
            return Err(JsValue::from_str(
                "Ed25519 Yao Client-root source is bound to another public key",
            ));
        }
        if admission.binding().operation != router_ab_core::Ed25519YaoOperationV1::Registration {
            return Err(JsValue::from_str(
                "source-preserving target admission must be registration",
            ));
        }
        let target_client_recipient_public_key = parse_32(
            target_client_recipient_public_key,
            "target Client recipient public key",
        )?;
        if target_client_recipient_public_key
            == admission.keyset().signing_worker_recipient_public_key()
        {
            return Err(JsValue::from_str(
                "target Client and SigningWorker recipients must differ",
            ));
        }
        let deriver_a_seal_seed =
            Zeroizing::new(parse_32(deriver_a_seal_seed, "Deriver A seal seed")?);
        let deriver_b_seal_seed =
            Zeroizing::new(parse_32(deriver_b_seal_seed, "Deriver B seal seed")?);
        let entropy = ClientActivationSourcePreservingEntropyV1::new(
            *deriver_a_seal_seed,
            *deriver_b_seal_seed,
        )
        .map_err(js_error)?;
        let request = prepare_client_registration_source_preserving_with_root_v1(
            &admission,
            &application,
            participant_ids,
            &source.root,
            target_client_recipient_public_key,
            entropy,
        )
        .map_err(js_error)?;
        let request_json = serde_json::to_string(&request).map_err(js_error)?;
        Ok(Self {
            request_json: Some(request_json),
        })
    }

    /// Consumes the one-use session and returns the opaque Router request JSON.
    pub fn take_execute_request_json(&mut self) -> Result<String, JsValue> {
        self.request_json.take().ok_or_else(|| {
            JsValue::from_str("source-preserving registration session was already consumed")
        })
    }
}

#[derive(Debug)]
enum WasmEd25519YaoLaneClientStateV1 {
    Empty,
    Prepared {
        request_json: String,
        completion: PreparedClientLaneV1,
    },
    Consumed,
}

/// One-use WASM typestate client for Ed25519 Yao lane provisioning/refresh.
///
/// The source root and derived contributions remain inside this boundary. The
/// returned request contains only recipient-encrypted Deriver inputs.
#[wasm_bindgen]
pub struct WasmEd25519YaoLaneClientV1 {
    state: WasmEd25519YaoLaneClientStateV1,
}

#[wasm_bindgen]
impl WasmEd25519YaoLaneClientV1 {
    /// Creates an empty one-use lane client.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            state: WasmEd25519YaoLaneClientStateV1::Empty,
        }
    }

    /// Prepares the exact authenticated internal dispatch artifact and returns
    /// `{ requestJson }` for Router execution.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &mut self,
        job_input: JsValue,
        binding_input: JsValue,
        application_input: JsValue,
        client_participant_id: u16,
        signing_worker_participant_id: u16,
        source: &WasmEd25519YaoLaneSourceV1,
        deriver_a_input_public_key: &[u8],
        deriver_b_input_public_key: &[u8],
        deriver_a_seal_seed: &[u8],
        deriver_b_seal_seed: &[u8],
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.state, WasmEd25519YaoLaneClientStateV1::Empty) {
            return Err(JsValue::from_str(
                "Ed25519 Yao lane client is already prepared",
            ));
        }
        let job = parse_js_domain_value::<Ed25519YaoLaneJobV1>(job_input)?;
        let binding = parse_js_domain_value::<Ed25519YaoCeremonyBindingV1>(binding_input)?;
        let application = parse_js_domain_value::<RouterAbEd25519YaoApplicationBindingFactsV1>(
            application_input,
        )?;
        let expected_application_binding_digest = crate::client_application_binding_digest_v1(
            &application,
            [client_participant_id, signing_worker_participant_id],
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
        if source.application_binding_digest != expected_application_binding_digest {
            return Err(JsValue::from_str(
                "Ed25519 Yao Client-root source is bound to another application",
            ));
        }
        if source.wallet_id != application.wallet_id() || source.wallet_id != job.wallet_id {
            return Err(JsValue::from_str(
                "Ed25519 Yao Client-root source is bound to another wallet",
            ));
        }
        if source.wallet_key_id != job.wallet_key_id {
            return Err(JsValue::from_str(
                "Ed25519 Yao Client-root source is bound to another wallet key",
            ));
        }
        if source.enrollment_id != job.enrollment_id {
            return Err(JsValue::from_str(
                "Ed25519 Yao Client-root source is bound to another enrollment",
            ));
        }
        if source.revocation_epoch != job.source.revocation_epoch() {
            return Err(JsValue::from_str(
                "Ed25519 Yao Client-root source is stale for this revocation epoch",
            ));
        }
        let expected_registered_public_key =
            Base64UrlUnpadded::decode_vec(&job.registered_public_key_b64u)
                .map_err(|_| JsValue::from_str("job registered public key is not base64url"))?;
        if source.registered_public_key
            != parse_32(&expected_registered_public_key, "job registered public key")?
        {
            return Err(JsValue::from_str(
                "Ed25519 Yao Client-root source is bound to another public key",
            ));
        }
        let deriver_a_input_public_key =
            parse_32(deriver_a_input_public_key, "Deriver A input public key")?;
        let deriver_b_input_public_key =
            parse_32(deriver_b_input_public_key, "Deriver B input public key")?;
        let deriver_a_seal_seed =
            Zeroizing::new(parse_32(deriver_a_seal_seed, "Deriver A seal seed")?);
        let deriver_b_seal_seed =
            Zeroizing::new(parse_32(deriver_b_seal_seed, "Deriver B seal seed")?);
        let prepared = prepare_client_lane_v1(job).map_err(js_error)?;
        let entropy = ClientLaneExecutionEntropyV1::new(*deriver_a_seal_seed, *deriver_b_seal_seed)
            .map_err(js_error)?;
        let dispatch = prepare_client_lane_dispatch_with_root_v1(
            prepared,
            &binding,
            &application,
            [client_participant_id, signing_worker_participant_id],
            &source.root,
            deriver_a_input_public_key,
            deriver_b_input_public_key,
            entropy,
        )
        .map_err(js_error)?;
        let (execute_request, completion) = dispatch.into_parts();
        let request_json = serde_json::to_string(&execute_request).map_err(js_error)?;
        self.state = WasmEd25519YaoLaneClientStateV1::Prepared {
            request_json: request_json.clone(),
            completion,
        };
        let object = js_sys::Object::new();
        js_sys::Reflect::set(
            &object,
            &JsValue::from_str("requestJson"),
            &JsValue::from_str(&request_json),
        )
        .map_err(|_| JsValue::from_str("failed to construct lane request"))?;
        Ok(object.into())
    }

    /// Returns the prepared request JSON for callers that use the Rust-style
    /// getter convention.
    pub fn execute_request_json(&self) -> Result<String, JsValue> {
        match &self.state {
            WasmEd25519YaoLaneClientStateV1::Prepared { request_json, .. } => {
                Ok(request_json.clone())
            }
            WasmEd25519YaoLaneClientStateV1::Empty | WasmEd25519YaoLaneClientStateV1::Consumed => {
                Err(JsValue::from_str("Ed25519 Yao lane client is not prepared"))
            }
        }
    }

    /// Consumes the one-use state and returns the immutable receipt plus the
    /// opaque holder package set required for later delivery.
    pub fn complete(&mut self, result_input: JsValue) -> Result<JsValue, JsValue> {
        let state = core::mem::replace(&mut self.state, WasmEd25519YaoLaneClientStateV1::Consumed);
        let WasmEd25519YaoLaneClientStateV1::Prepared {
            completion: prepared,
            ..
        } = state
        else {
            return Err(JsValue::from_str(
                "Ed25519 Yao lane client was not prepared",
            ));
        };
        let response_json = if let Some(response_json) = result_input.as_string() {
            response_json
        } else {
            let value = js_sys::Reflect::get(&result_input, &JsValue::from_str("responseJson"))
                .map_err(|_| JsValue::from_str("lane responseJson is missing"))?;
            value
                .as_string()
                .ok_or_else(|| JsValue::from_str("lane responseJson must be a string"))?
        };
        let receipt = complete_client_lane_v1(prepared, &response_json).map_err(js_error)?;
        serde_wasm_bindgen::to_value(&receipt).map_err(js_error)
    }
}
