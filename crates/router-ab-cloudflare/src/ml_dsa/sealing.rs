//! Authenticated role-private envelopes; storage state owns freshness.
use super::*;
use hpke_ng::{Aes256Gcm, DhKemX25519HkdfSha256, HkdfSha256, Hpke, Kem};
use zeroize::Zeroizing;
type Cipher = Hpke<DhKemX25519HkdfSha256, HkdfSha256, Aes256Gcm>;
const INFO: &[u8] = b"seams/ml-dsa/prepared-storage/v1";
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub key: KeyScope,
    pub role: Participant,
    pub batch: [u8; 32],
    pub expires_at_ms: u64,
    pub wrapping_key_version: Identifier,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sealed {
    pub(crate) encapsulated_key: [u8; 32],
    #[serde(
        rename = "ciphertext_b64u",
        serialize_with = "encode_ciphertext",
        deserialize_with = "decode_ciphertext"
    )]
    pub(crate) ciphertext: Vec<u8>,
}
impl Sealed {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.ciphertext.len() < 16 || self.ciphertext.len() > 16 * 1024 * 1024 + 16 {
            return Err(invalid("Invalid ML-DSA preparation envelope length"));
        }
        Ok(())
    }
}
pub fn seal(
    bytes: Zeroizing<Vec<u8>>,
    binding: &Binding,
    wrapping_seed: &[u8; 32],
) -> Result<Sealed> {
    if bytes.is_empty() || bytes.len() > 16 * 1024 * 1024 {
        return Err(invalid("Invalid preparation length"));
    }
    let (secret, public) =
        DhKemX25519HkdfSha256::derive_key_pair(wrapping_seed).map_err(crypto_error)?;
    let (enc, ciphertext) = Cipher::seal_auth(
        &mut crate::hpke::CloudflareHpkeGetrandomRngV1,
        &public,
        INFO,
        &digest(INFO, binding)?,
        &bytes,
        &secret,
    )
    .map_err(crypto_error)?;
    Ok(Sealed {
        encapsulated_key: enc
            .as_ref()
            .try_into()
            .map_err(|_| invalid("Invalid HPKE encapsulation"))?,
        ciphertext,
    })
}
/// The caller must obtain this envelope from an atomic consume result.
/// Authenticated encryption cannot detect a rolled-back lifecycle database.
pub fn open(
    sealed: Sealed,
    binding: &Binding,
    wrapping_seed: &[u8; 32],
) -> Result<Zeroizing<Vec<u8>>> {
    sealed.validate()?;
    let enc =
        DhKemX25519HkdfSha256::enc_from_bytes(&sealed.encapsulated_key).map_err(crypto_error)?;
    let (secret, public) =
        DhKemX25519HkdfSha256::derive_key_pair(wrapping_seed).map_err(crypto_error)?;
    Cipher::open_auth(
        &enc,
        &secret,
        INFO,
        &digest(INFO, binding)?,
        &sealed.ciphertext,
        &public,
    )
    .map(Zeroizing::new)
    .map_err(crypto_error)
}
fn crypto_error(error: impl core::fmt::Display) -> RouterAbProtocolError {
    let _ = error;
    invalid("ML-DSA preparation authentication failed")
}

fn encode_ciphertext<S: serde::Serializer>(
    bytes: &[u8],
    serializer: S,
) -> core::result::Result<S::Ok, S::Error> {
    use base64::Engine;
    serializer.serialize_str(&base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}
fn decode_ciphertext<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> core::result::Result<Vec<u8>, D::Error> {
    use base64::Engine;
    let encoded = String::deserialize(deserializer)?;
    if encoded.len() > (16usize * 1024 * 1024 + 16).div_ceil(3) * 4 {
        return Err(serde::de::Error::custom(
            "ML-DSA preparation envelope is too large",
        ));
    }
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(serde::de::Error::custom)
}
