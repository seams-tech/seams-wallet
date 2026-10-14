//! ML-DSA preparation and manifest completion inside the custody seed boundary.
//!
//! Callers still need Router admission and durable holder activation. These
//! consuming states never expose the seed, owner root, or client HPKE secret.

use super::{
    b64u, CeremonyError, CeremonyManifestEstablishedV1, CeremonyResult, CeremonySeedHeldV1,
    CustodyOriginV1, EstablishedCustodyRecordsV1, FactorSealInputsV1, RecoveryCodeInputV1,
    RecoveryReplacementEnvelopeV1,
};
use signer_core::ml_dsa_custody::{
    prepare_ml_dsa_custody_v1, MlDsaCeremonyBindingV1, MlDsaKeyContinuityV1, MlDsaRoleV1,
    PreparedMlDsaCustodyV1, SealedMlDsaRoleInputV1, SealedMlDsaRoleResultV1, VerifiedMlDsaKeyV1,
};

pub struct MlDsaCeremonyPreparedV1 {
    custody: CeremonySeedHeldV1,
    protocol: PreparedMlDsaCustodyV1,
}

impl CeremonySeedHeldV1 {
    pub fn prepare_ml_dsa65(
        self,
        binding: MlDsaCeremonyBindingV1,
        role_public_keys: [[u8; 32]; 2],
        continuity: MlDsaKeyContinuityV1,
    ) -> CeremonyResult<MlDsaCeremonyPreparedV1> {
        if self.wallet_id != binding.wallet_id() {
            return Err(CeremonyError::new(
                "ML-DSA binding names a different custody wallet",
            ));
        }
        match (&self.origin, &continuity) {
            (CustodyOriginV1::Recover, MlDsaKeyContinuityV1::Create)
            | (CustodyOriginV1::Establish, MlDsaKeyContinuityV1::Recover { .. }) => {
                return Err(CeremonyError::new(
                    "ML-DSA continuity does not match the custody operation",
                ));
            }
            _ => {}
        }
        let protocol =
            prepare_ml_dsa_custody_v1(self.seed.as_ref(), binding, role_public_keys, continuity)
                .map_err(CeremonyError::new)?;
        Ok(MlDsaCeremonyPreparedV1 {
            custody: self,
            protocol,
        })
    }
}

impl MlDsaCeremonyPreparedV1 {
    pub fn binding(&self) -> &MlDsaCeremonyBindingV1 {
        self.protocol.binding()
    }
    pub fn input(&self, role: MlDsaRoleV1) -> &SealedMlDsaRoleInputV1 {
        self.protocol.input(role)
    }

    pub fn complete(
        self,
        a: &SealedMlDsaRoleResultV1,
        b: &SealedMlDsaRoleResultV1,
    ) -> CeremonyResult<MlDsaCeremonyVerifiedV1> {
        let key = self.protocol.complete(a, b).map_err(CeremonyError::new)?;
        Ok(MlDsaCeremonyVerifiedV1 {
            custody: self.custody,
            key,
        })
    }
}

pub struct MlDsaCeremonyVerifiedV1 {
    custody: CeremonySeedHeldV1,
    key: VerifiedMlDsaKeyV1,
}

pub enum MlDsaCustodyCompletionV1 {
    Establish {
        factor: FactorSealInputsV1,
        recovery_codes: Vec<RecoveryCodeInputV1>,
    },
    Join,
    Recover {
        replacement_factor: FactorSealInputsV1,
    },
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MlDsaPublicKeyManifestV1 {
    wallet_id: String,
    signing_key_id: String,
    key_set: &'static str,
    public_key_b64u: String,
    key_manifest_digest_b64u: String,
    operation_id_b64u: String,
    material_epoch: u64,
}

/// Public or encrypted commit data. The caller must activate both durable roles
/// before publishing signing capability. This value is not an activation receipt.
#[derive(serde::Serialize)]
#[serde(tag = "custodyAction", rename_all = "snake_case")]
pub enum MlDsaCustodyCommitV1 {
    Established {
        key: MlDsaPublicKeyManifestV1,
        custody: EstablishedCustodyRecordsV1,
    },
    Joined {
        key: MlDsaPublicKeyManifestV1,
    },
    Recovered {
        key: MlDsaPublicKeyManifestV1,
        replacement: RecoveryReplacementEnvelopeV1,
    },
}

impl MlDsaCeremonyVerifiedV1 {
    pub fn key(&self) -> &VerifiedMlDsaKeyV1 {
        &self.key
    }

    pub fn finish(
        self,
        completion: MlDsaCustodyCompletionV1,
    ) -> CeremonyResult<MlDsaCustodyCommitV1> {
        let key = MlDsaPublicKeyManifestV1 {
            wallet_id: self.key.binding().wallet_id().into(),
            signing_key_id: self.key.binding().signing_key_id().into(),
            key_set: self.key.manifest().key_set().as_str(),
            public_key_b64u: b64u(self.key.public_key()),
            key_manifest_digest_b64u: self.key.manifest().digest_b64u(),
            operation_id_b64u: b64u(self.key.binding().operation_id()),
            material_epoch: self.key.binding().material_epoch(),
        };
        match (&self.custody.origin, completion) {
            (
                CustodyOriginV1::Establish,
                MlDsaCustodyCompletionV1::Establish {
                    factor,
                    recovery_codes,
                },
            ) => {
                let custody = CeremonyManifestEstablishedV1::seal_new_custody(
                    &self.custody.wallet_id,
                    &self.custody.seed,
                    factor,
                    recovery_codes,
                )?;
                Ok(MlDsaCustodyCommitV1::Established { key, custody })
            }
            (CustodyOriginV1::Join, MlDsaCustodyCompletionV1::Join) => {
                Ok(MlDsaCustodyCommitV1::Joined { key })
            }
            (
                CustodyOriginV1::Recover,
                MlDsaCustodyCompletionV1::Recover { replacement_factor },
            ) => {
                let replacement = CeremonyManifestEstablishedV1::seal_factor_envelope(
                    &self.custody.wallet_id,
                    &self.custody.seed,
                    replacement_factor,
                )?;
                Ok(MlDsaCustodyCommitV1::Recovered { key, replacement })
            }
            _ => Err(CeremonyError::new(
                "ML-DSA custody completion does not match the ceremony origin",
            )),
        }
    }
}
