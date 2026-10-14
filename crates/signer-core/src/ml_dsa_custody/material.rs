//! Authenticated encryption for one holder's persistent signing material.
//!
//! The adapter supplies the expected context from trusted storage/admission.
//! This envelope does not establish activation, freshness, or rollback protection.

use sha2::{Digest, Sha256};

use super::*;

const MATERIAL_BYTES: usize = 17_472;
const STORAGE_INFO: &[u8] = b"seams/ml-dsa-65/role-material-storage/v1";

/// Exact public coordinates expected by one role's storage adapter.
/// This type carries context, not an authorization or activation proof.
pub struct MlDsaMaterialBindingV1 {
    aad: Vec<u8>,
}

impl MlDsaMaterialBindingV1 {
    pub fn new(
        environment: &str,
        wrapping_key_version: &str,
        ceremony: &MlDsaCeremonyBindingV1,
        role: MlDsaRoleV1,
        public_key: &[u8; 1952],
    ) -> CoreResult<Self> {
        let mut aad = STORAGE_INFO.to_vec();
        for identifier in [environment, wrapping_key_version] {
            if identifier.is_empty() || identifier.len() > 256 || identifier.trim() != identifier {
                return Err(SignerCoreError::invalid_input(
                    "ML-DSA storage identifiers must be canonical and contain 1 to 256 bytes",
                ));
            }
            aad.extend_from_slice(&(identifier.len() as u32).to_be_bytes());
            aad.extend_from_slice(identifier.as_bytes());
        }
        aad.extend_from_slice(&ceremony.aad(role));
        aad.extend_from_slice(&Sha256::digest(public_key));
        Ok(Self { aad })
    }
}

/// Public storage envelope. The wrapping key must remain outside its database.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SealedMlDsaRoleMaterialV1 {
    encapsulated_key: [u8; 32],
    ciphertext: Vec<u8>,
}

/// Seals only the caller's 17,472-byte share using a role-private wrapping key.
/// Supply an independently random 32-byte wrapping seed from this role's secret store.
/// HPKE authenticated mode also requires that seed to create an accepted record.
pub fn seal_ml_dsa_role_material_v1(
    own_material: &[u8],
    binding: &MlDsaMaterialBindingV1,
    wrapping_key_seed: &[u8; 32],
) -> CoreResult<SealedMlDsaRoleMaterialV1> {
    if own_material.len() != MATERIAL_BYTES {
        return Err(shape_error());
    }
    let (secret, public) =
        DhKemX25519HkdfSha256::derive_key_pair(wrapping_key_seed).map_err(hpke_error)?;
    let (enc, ciphertext) = RoleHpke::seal_auth(
        &mut fresh_rng()?,
        &public,
        STORAGE_INFO,
        &binding.aad,
        own_material,
        &secret,
    )
    .map_err(hpke_error)?;
    Ok(SealedMlDsaRoleMaterialV1 {
        encapsulated_key: enc.as_ref().try_into().map_err(|_| shape_error())?,
        ciphertext,
    })
}

/// Opens a record only under independently supplied expected coordinates.
/// Parse the decrypted bytes with the signing protocol before use.
pub fn open_ml_dsa_role_material_v1(
    sealed: &SealedMlDsaRoleMaterialV1,
    expected_binding: &MlDsaMaterialBindingV1,
    wrapping_key_seed: &[u8; 32],
) -> CoreResult<Zeroizing<Vec<u8>>> {
    if sealed.ciphertext.len() != MATERIAL_BYTES + 16 {
        return Err(shape_error());
    }
    let enc =
        DhKemX25519HkdfSha256::enc_from_bytes(&sealed.encapsulated_key).map_err(hpke_error)?;
    let (secret, public) =
        DhKemX25519HkdfSha256::derive_key_pair(wrapping_key_seed).map_err(hpke_error)?;
    let bytes = RoleHpke::open_auth(
        &enc,
        &secret,
        STORAGE_INFO,
        &expected_binding.aad,
        &sealed.ciphertext,
        &public,
    )
    .map_err(hpke_error)?;
    Ok(Zeroizing::new(bytes))
}
