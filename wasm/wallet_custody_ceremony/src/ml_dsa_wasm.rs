//! Browser custody handles. Secret derivation and HPKE state stay inside Wasm.

use super::{
    ceremony_error, decode_fixed, factor_seal_inputs, js_error, recovery_code_inputs,
    WasmCeremonySeedHeldV1,
};
use crate::ceremony::ml_dsa::{
    MlDsaCeremonyPreparedV1, MlDsaCeremonyVerifiedV1, MlDsaCustodyCompletionV1,
};
use serde::{Deserialize, Serialize};
use signer_core::ml_dsa_custody::{
    MlDsaCeremonyBindingV1, MlDsaKeyContinuityV1, MlDsaRoleV1, SealedMlDsaRoleInputV1,
    SealedMlDsaRoleResultV1,
};
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProtocolInputs {
    wallet_id: String,
    signing_key_id: String,
    operation_id_b64u: String,
    material_epoch: u64,
    role_a_public_key_b64u: String,
    role_b_public_key_b64u: String,
    continuity: Continuity,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Continuity {
    Create,
    Recover {
        #[serde(rename = "recordedKeyManifestDigestB64u")]
        recorded_manifest_digest: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoleInputs<'a> {
    binding: &'a MlDsaCeremonyBindingV1,
    role_a: &'a SealedMlDsaRoleInputV1,
    role_b: &'a SealedMlDsaRoleInputV1,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoleResults {
    role_a: SealedMlDsaRoleResultV1,
    role_b: SealedMlDsaRoleResultV1,
}

#[wasm_bindgen]
pub struct WasmMlDsaCeremonyPreparedV1 {
    inner: MlDsaCeremonyPreparedV1,
}

#[wasm_bindgen]
pub struct WasmMlDsaCeremonyVerifiedV1 {
    inner: MlDsaCeremonyVerifiedV1,
}

#[wasm_bindgen]
impl WasmCeremonySeedHeldV1 {
    /// Consumes the custody seed handle. Only public metadata enters this preparation.
    pub fn prepare_ml_dsa65(
        self,
        inputs_json: &str,
    ) -> Result<WasmMlDsaCeremonyPreparedV1, JsValue> {
        let input: ProtocolInputs = serde_json::from_str(inputs_json).map_err(js_error)?;
        // Browser JSON must preserve this authenticated integer exactly.
        if input.material_epoch > 9_007_199_254_740_991 {
            return Err(js_error(
                "materialEpoch exceeds the JavaScript safe integer range",
            ));
        }
        let binding = MlDsaCeremonyBindingV1::new(
            input.wallet_id,
            input.signing_key_id,
            decode_fixed(&input.operation_id_b64u, "operationIdB64u").map_err(js_error)?,
            input.material_epoch,
        )
        .map_err(js_error)?;
        let recipients = [
            decode_fixed(&input.role_a_public_key_b64u, "roleAPublicKeyB64u").map_err(js_error)?,
            decode_fixed(&input.role_b_public_key_b64u, "roleBPublicKeyB64u").map_err(js_error)?,
        ];
        let continuity = match input.continuity {
            Continuity::Create => MlDsaKeyContinuityV1::Create,
            Continuity::Recover {
                recorded_manifest_digest,
            } => MlDsaKeyContinuityV1::Recover {
                recorded_manifest_digest: decode_fixed(
                    &recorded_manifest_digest,
                    "recordedKeyManifestDigestB64u",
                )
                .map_err(js_error)?,
            },
        };
        Ok(WasmMlDsaCeremonyPreparedV1 {
            inner: self
                .inner
                .prepare_ml_dsa65(binding, recipients, continuity)
                .map_err(ceremony_error)?,
        })
    }
}

#[wasm_bindgen]
impl WasmMlDsaCeremonyPreparedV1 {
    /// Returns only bound HPKE ciphertexts. No root share or completion secret is exported.
    pub fn role_inputs_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&RoleInputs {
            binding: self.inner.binding(),
            role_a: self.inner.input(MlDsaRoleV1::A),
            role_b: self.inner.input(MlDsaRoleV1::B),
        })
        .map_err(js_error)
    }

    /// A failure consumes the handle. Results must authenticate under both expected holder keys.
    pub fn complete(self, results_json: &str) -> Result<WasmMlDsaCeremonyVerifiedV1, JsValue> {
        let results: RoleResults = serde_json::from_str(results_json).map_err(js_error)?;
        Ok(WasmMlDsaCeremonyVerifiedV1 {
            inner: self
                .inner
                .complete(&results.role_a, &results.role_b)
                .map_err(ceremony_error)?,
        })
    }
}

#[wasm_bindgen]
impl WasmMlDsaCeremonyVerifiedV1 {
    /// Returns proposed commit data. Durable holder activation remains a separate requirement.
    pub fn finish_joining_custody(self) -> Result<String, JsValue> {
        let commit = self
            .inner
            .finish(MlDsaCustodyCompletionV1::Join)
            .map_err(ceremony_error)?;
        serde_json::to_string(&commit).map_err(js_error)
    }

    pub fn finish_establishing_custody(
        self,
        factor_json: &str,
        factor_secret: &[u8],
        recovery_codes_json: &str,
    ) -> Result<String, JsValue> {
        let factor = factor_seal_inputs(factor_json, factor_secret).map_err(js_error)?;
        let recovery_codes = recovery_code_inputs(recovery_codes_json).map_err(js_error)?;
        let commit = self
            .inner
            .finish(MlDsaCustodyCompletionV1::Establish {
                factor,
                recovery_codes,
            })
            .map_err(ceremony_error)?;
        serde_json::to_string(&commit).map_err(js_error)
    }

    pub fn finish_recovering_custody(
        self,
        replacement_factor_json: &str,
        replacement_factor_secret: &[u8],
    ) -> Result<String, JsValue> {
        let replacement_factor =
            factor_seal_inputs(replacement_factor_json, replacement_factor_secret)
                .map_err(js_error)?;
        let commit = self
            .inner
            .finish(MlDsaCustodyCompletionV1::Recover { replacement_factor })
            .map_err(ceremony_error)?;
        serde_json::to_string(&commit).map_err(js_error)
    }
}
