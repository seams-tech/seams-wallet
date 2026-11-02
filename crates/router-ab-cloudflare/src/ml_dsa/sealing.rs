//! Authenticated role-private envelopes; storage state owns freshness.
use super::*;
use hpke_ng::{ChaCha20Poly1305, DhKemX25519HkdfSha256, HkdfSha256, Hpke, Kem};
use zeroize::Zeroizing;
// HPKE binds its AEAD suite ID into key derivation. Earlier AES-GCM preparation
// cannot authenticate under this suite and must be replaced with fresh stock.
type Cipher = Hpke<DhKemX25519HkdfSha256, HkdfSha256, ChaCha20Poly1305>;
const INFO: &[u8] = b"seams/ml-dsa/prepared-storage/v2";
/// Advance this when stored stock changes shape. Older stock burns on its next read.
pub const STOCK_FORMAT: u16 = 1;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub key: KeyScope,
    pub role: Participant,
    pub batch: [u8; 32],
    pub expires_at_ms: u64,
    pub wrapping_key_version: Identifier,
    #[serde(default)]
    pub generation: u32,
    #[serde(default)]
    pub format: u16,
}
/// What current stock must carry. Deployment configuration holds these values, so a
/// storage restore cannot bring an older value back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StockStamp {
    pub generation: u32,
    pub wrapping_key_version: Identifier,
}
impl StockStamp {
    pub fn is_current(&self, binding: &Binding) -> bool {
        binding.generation == self.generation
            && binding.format == STOCK_FORMAT
            && binding.wrapping_key_version == self.wrapping_key_version
    }
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
    /// Hashes the raw envelope. Encoding one first would briefly hold four copies of it.
    pub(crate) fn digest(&self, domain: &[u8]) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(domain);
        hash.update(self.encapsulated_key);
        hash.update(&self.ciphertext);
        hash.finalize().into()
    }
}
pub fn seal(
    bytes: Zeroizing<Vec<u8>>,
    binding: &Binding,
    wrapping_seed: &[u8; 32],
) -> Result<Sealed> {
    seal_bound(bytes, INFO, binding, wrapping_seed)
}
pub(crate) fn seal_bound(
    bytes: Zeroizing<Vec<u8>>,
    domain: &[u8],
    binding: &impl Serialize,
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
        domain,
        &digest(domain, binding)?,
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
    open_bound(sealed, INFO, binding, wrapping_seed)
}
pub(crate) fn open_bound(
    sealed: Sealed,
    domain: &[u8],
    binding: &impl Serialize,
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
        domain,
        &digest(domain, binding)?,
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

pub(super) const CHUNK_BYTES: usize = 48 * 1024;
const CHUNKS_PER_IO: usize = 16;
impl Sealed {
    pub(crate) async fn store_chunks(&self, store: &impl Store, prefix: &str) -> Result<usize> {
        self.validate()?;
        write_chunks(store, prefix, &self.ciphertext).await
    }
    pub(crate) async fn load_chunks(
        store: &impl Store,
        prefix: &str,
        chunks: usize,
        encapsulated_key: [u8; 32],
    ) -> Result<Self> {
        let sealed = Self {
            encapsulated_key,
            ciphertext: read_chunks(store, prefix, chunks).await?,
        };
        sealed.validate()?;
        Ok(sealed)
    }
}
/// Bounded binary storage shared by encrypted private state and public table frames.
pub(super) async fn write_chunks(store: &impl Store, prefix: &str, bytes: &[u8]) -> Result<usize> {
    if bytes.is_empty() || bytes.len() > 16 * 1024 * 1024 + 16 {
        return Err(invalid("Invalid ML-DSA stored byte length"));
    }
    for (group, bytes) in bytes.chunks(CHUNK_BYTES * CHUNKS_PER_IO).enumerate() {
        let mut values = Vec::new();
        for (offset, chunk) in bytes.chunks(CHUNK_BYTES).enumerate() {
            values.push((
                format!("{prefix}/{}", group * CHUNKS_PER_IO + offset),
                chunk,
            ));
        }
        let mut writes = Vec::with_capacity(values.len());
        for (key, value) in &values {
            writes.push(store.put_chunk(key, value));
        }
        // Every write completes before the surrounding transaction can commit.
        for result in futures::future::join_all(writes).await {
            result?;
        }
    }
    Ok(bytes.len().div_ceil(CHUNK_BYTES))
}
pub(super) async fn read_chunks(
    store: &impl Store,
    prefix: &str,
    chunks: usize,
) -> Result<Vec<u8>> {
    if chunks == 0 || chunks > (16usize * 1024 * 1024 + 16).div_ceil(CHUNK_BYTES) {
        return Err(invalid("Invalid ML-DSA chunk count"));
    }
    let mut bytes = Vec::new();
    for first in (0..chunks).step_by(CHUNKS_PER_IO) {
        let keys = chunk_keys(prefix, first, chunks.min(first + CHUNKS_PER_IO));
        let values = store.get_chunks(&keys, CHUNK_BYTES).await?;
        if values.len() != keys.len() {
            return Err(invalid("Invalid ML-DSA chunk response length"));
        }
        for value in values {
            let chunk = value.ok_or_else(|| invalid("Missing ML-DSA stored chunk"))?;
            if chunk.len() > CHUNK_BYTES || bytes.len() + chunk.len() > 16 * 1024 * 1024 + 16 {
                return Err(invalid("Oversized ML-DSA stored chunks"));
            }
            bytes.extend_from_slice(&chunk);
        }
    }
    Ok(bytes)
}
pub(crate) async fn erase_chunks(store: &impl Store, prefix: &str, chunks: usize) -> Result<()> {
    for first in (0..chunks).step_by(CHUNKS_PER_IO) {
        store
            .delete_many(&chunk_keys(
                prefix,
                first,
                chunks.min(first + CHUNKS_PER_IO),
            ))
            .await?;
    }
    Ok(())
}
fn chunk_keys(prefix: &str, first: usize, end: usize) -> Vec<String> {
    (first..end)
        .map(|ordinal| format!("{prefix}/{ordinal}"))
        .collect()
}
