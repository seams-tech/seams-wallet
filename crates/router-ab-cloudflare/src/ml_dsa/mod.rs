//! Durable ML-DSA admission and role-private prepared material.
//! Store implementations execute one command in one atomic transaction.
pub mod admission;
pub mod execution;
pub mod material;
pub mod policy;
pub mod refill;
pub mod pool;
pub mod sealing;
#[cfg(feature = "workers-rs")]
pub mod workers;

use crate::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub type Result<T> = RouterAbProtocolResult<T>;

/// Canonical identifiers are parsed once at JSON or persistence boundaries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Identifier(String);
impl TryFrom<String> for Identifier {
    type Error = RouterAbProtocolError;
    fn try_from(value: String) -> Result<Self> {
        if value.is_empty()
            || value.len() > 256
            || value
                .bytes()
                .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        {
            return Err(invalid("Invalid ML-DSA identifier"));
        }
        Ok(Self(value))
    }
}
impl From<Identifier> for String {
    fn from(value: Identifier) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WalletScope {
    pub org: Identifier,
    pub project: Identifier,
    pub environment: Identifier,
    pub wallet: Identifier,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyScope {
    pub wallet: WalletScope,
    pub key_id: Identifier,
    pub epoch: u64,
    pub public_key_digest: [u8; 32],
    pub schedule_digest: [u8; 32],
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Participant {
    A,
    B,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningRequest {
    pub key: KeyScope,
    pub operation: [u8; 32],
    pub message_digest: [u8; 32],
    pub context_digest: [u8; 32],
}
impl SigningRequest {
    pub fn digest(&self) -> Result<[u8; 32]> {
        digest(b"seams/ml-dsa/admission/v1", self)
    }
    pub fn record_key(&self) -> Result<String> {
        Ok(format!(
            "operation/{}/{}",
            hex(&digest(b"wallet", &self.key.wallet)?),
            hex(&self.operation)
        ))
    }
}
/// Serialized commands contain public identities and sealed role material only.
#[allow(async_fn_in_trait)]
pub trait Store {
    async fn get<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>>;
    async fn put<T: Serialize>(&self, key: &str, value: &T) -> Result<()>;
    async fn delete(&self, key: &str) -> Result<()>;
}
pub fn digest(domain: &[u8], value: &impl Serialize) -> Result<[u8; 32]> {
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(serde_json::to_vec(value).map_err(|_| invalid("Cannot encode ML-DSA binding"))?);
    Ok(hash.finalize().into())
}
pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push(DIGITS[(byte >> 4) as usize] as char);
        text.push(DIGITS[(byte & 15) as usize] as char);
    }
    text
}
pub(crate) fn invalid(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidGateDecision, message)
}
