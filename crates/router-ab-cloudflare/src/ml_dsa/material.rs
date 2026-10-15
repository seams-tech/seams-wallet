//! One participant's encrypted signing share, bound to verified custody activation.
use super::*;
use ed25519_yao::ml_dsa_signing::OwnSigningShare;
use signer_core::ml_dsa_custody::{
    material::{open_ml_dsa_role_material_v1, MlDsaMaterialBindingV1, SealedMlDsaRoleMaterialV1},
    MlDsaCeremonyBindingV1, MlDsaRoleV1,
};
use zeroize::Zeroizing;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub activation: admission::KeyActivation,
    pub role: Participant,
    pub public_key: Vec<u8>,
    pub wrapping_key_version: Identifier,
    pub sealed: SealedMlDsaRoleMaterialV1,
}
impl Record {
    pub fn open(
        &self,
        role: Participant,
        version: &Identifier,
        seed: &[u8; 32],
    ) -> Result<Zeroizing<Vec<u8>>> {
        if self.role != role
            || self.wrapping_key_version != *version
            || self.public_key.len() != 1952
            || <[u8; 32]>::from(Sha256::digest(&self.public_key))
                != self.activation.key.public_key_digest
        {
            return Err(invalid("ML-DSA role material binding changed"));
        }
        let key = &self.activation.key;
        let ceremony = MlDsaCeremonyBindingV1::new(
            key.wallet.wallet.0.clone(),
            key.key_id.0.clone(),
            self.activation.ceremony_id,
            key.epoch,
        )
        .map_err(material_error)?;
        let public_key = self
            .public_key
            .as_slice()
            .try_into()
            .map_err(material_error)?;
        let binding = MlDsaMaterialBindingV1::new(
            &hex(&digest(
                b"seams/ml-dsa/custody-storage-scope/v1",
                &key.wallet,
            )?),
            &version.0,
            &ceremony,
            match role {
                Participant::A => MlDsaRoleV1::A,
                Participant::B => MlDsaRoleV1::B,
            },
            public_key,
        )
        .map_err(material_error)?;
        let bytes =
            open_ml_dsa_role_material_v1(&self.sealed, &binding, seed).map_err(material_error)?;
        drop(OwnSigningShare::parse(&bytes).map_err(material_error)?);
        Ok(bytes)
    }
}
fn record_key(key: &KeyScope) -> Result<String> {
    Ok(format!(
        "material/{}",
        hex(&digest(b"key-slot", &key.key_id)?)
    ))
}
pub async fn put(store: &impl Store, record: Record) -> Result<()> {
    super::pool::check_key(store, &record.activation.key).await?;
    let name = record_key(&record.activation.key)?;
    if let Some(current) = store.get::<Record>(&name).await? {
        if current.activation.key == record.activation.key {
            if digest(b"material", &current)? == digest(b"material", &record)? {
                return Ok(());
            }
            return Err(invalid("ML-DSA role material is already installed"));
        }
    }
    store.put(&name, &record).await
}
pub async fn get(store: &impl Store, key: &KeyScope) -> Result<Record> {
    super::pool::check_key(store, key).await?;
    let record: Record = store
        .get(&record_key(key)?)
        .await?
        .ok_or_else(|| invalid("ML-DSA role material is absent"))?;
    if record.activation.key != *key {
        return Err(invalid("ML-DSA role material has an old epoch"));
    }
    Ok(record)
}
fn material_error(_: impl core::fmt::Display) -> RouterAbProtocolError {
    invalid("ML-DSA role material authentication failed")
}
