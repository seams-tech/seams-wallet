//! Exact NEAR public-key and signature encodings.
//!
//! Full ML-DSA-65 keys use tag 2. Hashed access-key identifiers use a separate
//! tag space and cannot enter these full-key transaction types.

use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};

#[repr(u8)]
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[borsh(use_discriminant = true)]
#[serde(try_from = "PublicKeyWire", into = "PublicKeyWire")]
pub enum PublicKey {
    Ed25519([u8; 32]) = 0,
    Secp256k1([u8; 64]) = 1,
    MlDsa65(Box<[u8; 1952]>) = 2,
}

impl PublicKey {
    pub const fn key_type(&self) -> u8 {
        match self {
            Self::Ed25519(_) => 0,
            Self::Secp256k1(_) => 1,
            Self::MlDsa65(_) => 2,
        }
    }

    pub fn as_bytes(&self) -> &[u8] {
        match self {
            Self::Ed25519(bytes) => bytes,
            Self::Secp256k1(bytes) => bytes,
            Self::MlDsa65(bytes) => bytes.as_slice(),
        }
    }
}

impl FromStr for PublicKey {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let (scheme, encoded) = value
            .split_once(':')
            .ok_or("A NEAR public-key scheme is required.")?;
        let tag = match scheme {
            "ed25519" => 0,
            "secp256k1" => 1,
            "ml-dsa-65" => 2,
            "ml-dsa-65-hash" => {
                return Err(
                    "A hashed access-key identifier cannot replace a full public key.".into(),
                )
            }
            _ => return Err("The NEAR public-key scheme is unsupported.".into()),
        };
        let bytes = bs58::decode(encoded)
            .into_vec()
            .map_err(|error| format!("Invalid NEAR public-key base58: {error}"))?;
        PublicKeyWire {
            key_type: tag,
            key_data: bytes,
        }
        .try_into()
    }
}

impl fmt::Display for PublicKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let scheme = match self {
            Self::Ed25519(_) => "ed25519",
            Self::Secp256k1(_) => "secp256k1",
            Self::MlDsa65(_) => "ml-dsa-65",
        };
        write!(
            formatter,
            "{scheme}:{}",
            bs58::encode(self.as_bytes()).into_string()
        )
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicKeyWire {
    key_type: u8,
    key_data: Vec<u8>,
}

impl TryFrom<PublicKeyWire> for PublicKey {
    type Error = String;

    fn try_from(wire: PublicKeyWire) -> Result<Self, Self::Error> {
        match wire.key_type {
            0 => Ok(Self::Ed25519(fixed_bytes(wire.key_data)?)),
            1 => Ok(Self::Secp256k1(fixed_bytes(wire.key_data)?)),
            2 => Ok(Self::MlDsa65(Box::new(fixed_bytes(wire.key_data)?))),
            _ => Err("The full NEAR public-key tag is unsupported.".into()),
        }
    }
}

impl From<PublicKey> for PublicKeyWire {
    fn from(key: PublicKey) -> Self {
        Self {
            key_type: key.key_type(),
            key_data: key.as_bytes().to_vec(),
        }
    }
}

#[repr(u8)]
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[borsh(use_discriminant = true)]
#[serde(try_from = "SignatureWire", into = "SignatureWire")]
pub enum Signature {
    Ed25519([u8; 64]) = 0,
    Secp256k1([u8; 65]) = 1,
    MlDsa65(Box<[u8; 3309]>) = 2,
}

impl Signature {
    pub const fn key_type(&self) -> u8 {
        match self {
            Self::Ed25519(_) => 0,
            Self::Secp256k1(_) => 1,
            Self::MlDsa65(_) => 2,
        }
    }

    pub fn as_bytes(&self) -> &[u8] {
        match self {
            Self::Ed25519(bytes) => bytes,
            Self::Secp256k1(bytes) => bytes,
            Self::MlDsa65(bytes) => bytes.as_slice(),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignatureWire {
    key_type: u8,
    signature_data: Vec<u8>,
}

impl TryFrom<SignatureWire> for Signature {
    type Error = String;

    fn try_from(wire: SignatureWire) -> Result<Self, Self::Error> {
        match wire.key_type {
            0 => Ok(Self::Ed25519(fixed_bytes(wire.signature_data)?)),
            1 => Ok(Self::Secp256k1(fixed_bytes(wire.signature_data)?)),
            2 => Ok(Self::MlDsa65(Box::new(fixed_bytes(wire.signature_data)?))),
            _ => Err("The NEAR signature tag is unsupported.".into()),
        }
    }
}

impl From<Signature> for SignatureWire {
    fn from(signature: Signature) -> Self {
        Self {
            key_type: signature.key_type(),
            signature_data: signature.as_bytes().to_vec(),
        }
    }
}

fn fixed_bytes<const LENGTH: usize>(bytes: Vec<u8>) -> Result<[u8; LENGTH], String> {
    let actual = bytes.len();
    bytes
        .try_into()
        .map_err(|_| format!("The NEAR encoding requires {LENGTH} bytes, received {actual}."))
}
