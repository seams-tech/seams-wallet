//! Release verification for the `seams` binary.
//!
//! Two roots, never one. The recovery-verification root vouches for recovery
//! artifacts; the release root vouches for the executable. Sharing one key
//! would let whoever can sign a release also sign artifacts, and the reverse.
//!
//! Recovery commands verify a release only when an operator asks them to. They
//! never fetch, install, or self-update: a recovery tool that can replace its
//! own code is a recovery tool an attacker can replace.

use base64ct::{Base64UrlUnpadded, Encoding};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use router_ab_core::{canonical_recovery_json_v1, parse_strict_recovery_json_v1};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{RecoveryCoreError, RecoveryCoreErrorCode, RecoveryCoreResult};

const RELEASE_MANIFEST_FORMAT_V1: &str = "seams_release_checksum_manifest_v1";
const RELEASE_MANIFEST_DOMAIN_V1: &[u8] = b"seams/release-checksum-manifest/v1";
const RELEASE_ROOT_FORMAT_V1: &str = "seams_release_root_v1";

/// Maximum encoded bytes accepted for one release checksum manifest.
pub const RELEASE_MANIFEST_MAX_BYTES_V1: usize = 64 * 1024;
/// Maximum release artifacts one manifest may describe.
pub const RELEASE_MANIFEST_MAX_ENTRIES_V1: usize = 64;

/// One pinned offline release-signing root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseTrustRootV1 {
    key_id: String,
    verifying_key: [u8; 32],
}

impl ReleaseTrustRootV1 {
    /// Pins one release root.
    ///
    /// The recovery-verification root is required here so the two can be
    /// compared: a build that pins the same key for both has collapsed the
    /// separation this design depends on, and that is a build error, not a
    /// runtime warning.
    pub fn new(
        key_id: impl Into<String>,
        verifying_key: [u8; 32],
        recovery_root_verifying_key: &[u8; 32],
    ) -> RecoveryCoreResult<Self> {
        let key_id = key_id.into();
        if key_id.trim().is_empty() {
            return Err(invalid("release root key id is required"));
        }
        if &verifying_key == recovery_root_verifying_key {
            return Err(invalid(
                "the release root and the recovery-verification root must be different keys",
            ));
        }
        VerifyingKey::from_bytes(&verifying_key)
            .map_err(|_| invalid("release root verifying key is invalid"))?;
        Ok(Self {
            key_id,
            verifying_key,
        })
    }

    /// Returns the root key identifier.
    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    /// Returns the root Ed25519 verifying key.
    pub const fn verifying_key(&self) -> &[u8; 32] {
        &self.verifying_key
    }

    /// Parses one pinned release root from its canonical JSON.
    ///
    /// The recovery root is required for the same reason as in [`Self::new`]:
    /// the two roots must be different keys, and that is checked wherever a
    /// release root is constructed.
    pub fn from_canonical_json(
        bytes: &[u8],
        recovery_root_verifying_key: &[u8; 32],
    ) -> RecoveryCoreResult<Self> {
        if bytes.len() > RELEASE_MANIFEST_MAX_BYTES_V1 {
            return Err(invalid("release root exceeds size cap"));
        }
        let value = parse_strict_recovery_json_v1(bytes)
            .map_err(|error| invalid_owned(error.message().to_owned()))?;
        let wire: ReleaseRootWire = serde_json::from_value(value)
            .map_err(|error| invalid_owned(format!("invalid release root: {error}")))?;
        if wire.format_version != RELEASE_ROOT_FORMAT_V1 {
            return Err(invalid("release root version is unsupported"));
        }
        let verifying_key = decode_digest(&wire.verifying_key)
            .map_err(|_| invalid("release root verifying key is not a canonical 32-byte key"))?;
        let root = Self::new(wire.key_id, verifying_key, recovery_root_verifying_key)?;
        if root.canonical_json()? != bytes {
            return Err(invalid("release root is not canonical JSON"));
        }
        Ok(root)
    }

    /// Returns the exact canonical JSON of this root.
    pub fn canonical_json(&self) -> RecoveryCoreResult<Vec<u8>> {
        canonical(&object(vec![
            (
                "formatVersion",
                Value::String(RELEASE_ROOT_FORMAT_V1.to_owned()),
            ),
            ("keyId", Value::String(self.key_id.clone())),
            (
                "verifyingKey",
                Value::String(Base64UrlUnpadded::encode_string(&self.verifying_key)),
            ),
        ]))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleaseRootWire {
    format_version: String,
    key_id: String,
    verifying_key: String,
}

/// One release artifact and its digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseArtifactEntryV1 {
    /// The build target this artifact is for.
    pub target: String,
    /// The artifact filename.
    pub filename: String,
    /// SHA-256 over the artifact bytes.
    pub sha256_b64u: String,
}

/// One signed release checksum manifest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseChecksumManifestV1 {
    release_version: String,
    source_revision: String,
    minimum_protocol_version: String,
    signer_key_id: String,
    entries: Vec<ReleaseArtifactEntryV1>,
    signature: [u8; 64],
}

impl ReleaseChecksumManifestV1 {
    /// Signs one release checksum manifest with the pinned release root.
    pub fn sign(
        release_version: impl Into<String>,
        source_revision: impl Into<String>,
        minimum_protocol_version: impl Into<String>,
        signer_key_id: impl Into<String>,
        entries: Vec<ReleaseArtifactEntryV1>,
        signing_key_bytes: &[u8; 32],
    ) -> RecoveryCoreResult<Self> {
        let mut manifest = Self {
            release_version: release_version.into(),
            source_revision: source_revision.into(),
            minimum_protocol_version: minimum_protocol_version.into(),
            signer_key_id: signer_key_id.into(),
            entries,
            signature: [0_u8; 64],
        };
        manifest.validate()?;
        manifest.signature = SigningKey::from_bytes(signing_key_bytes)
            .sign(&signature_input(&manifest.unsigned_canonical_json()?))
            .to_bytes();
        Ok(manifest)
    }

    /// Returns the release version.
    pub fn release_version(&self) -> &str {
        &self.release_version
    }

    /// Returns the source revision this release was built from.
    pub fn source_revision(&self) -> &str {
        &self.source_revision
    }

    /// Returns the minimum protocol version this release speaks.
    pub fn minimum_protocol_version(&self) -> &str {
        &self.minimum_protocol_version
    }

    /// Returns the described artifacts.
    pub fn entries(&self) -> &[ReleaseArtifactEntryV1] {
        &self.entries
    }

    /// Returns the exact canonical signed manifest bytes.
    pub fn canonical_json(&self) -> RecoveryCoreResult<Vec<u8>> {
        self.validate()?;
        canonical(&self.to_value(true))
    }

    /// Parses one exact capped canonical manifest.
    pub fn decode(bytes: &[u8]) -> RecoveryCoreResult<Self> {
        if bytes.len() > RELEASE_MANIFEST_MAX_BYTES_V1 {
            return Err(invalid("release checksum manifest exceeds size cap"));
        }
        let value = parse_strict_recovery_json_v1(bytes)
            .map_err(|error| invalid_owned(error.message().to_owned()))?;
        let wire: ReleaseManifestWire = serde_json::from_value(value)
            .map_err(|error| invalid_owned(format!("invalid release manifest: {error}")))?;
        if wire.format_version != RELEASE_MANIFEST_FORMAT_V1 {
            return Err(invalid("release checksum manifest version is unsupported"));
        }
        let manifest = Self {
            release_version: wire.release_version,
            source_revision: wire.source_revision,
            minimum_protocol_version: wire.minimum_protocol_version,
            signer_key_id: wire.signer_key_id,
            entries: wire
                .entries
                .into_iter()
                .map(|entry| ReleaseArtifactEntryV1 {
                    target: entry.target,
                    filename: entry.filename,
                    sha256_b64u: entry.sha256_b64u,
                })
                .collect(),
            signature: decode_signature(&wire.signature)?,
        };
        if manifest.canonical_json()? != bytes {
            return Err(invalid("release checksum manifest is not canonical JSON"));
        }
        Ok(manifest)
    }

    /// Verifies this manifest against one pinned release root.
    pub fn verify(&self, root: &ReleaseTrustRootV1) -> RecoveryCoreResult<()> {
        self.validate()?;
        if self.signer_key_id != root.key_id {
            return Err(verification_failed(
                "release checksum manifest was not signed by the pinned release root",
            ));
        }
        let verifying_key = VerifyingKey::from_bytes(&root.verifying_key)
            .map_err(|_| invalid("release root verifying key is invalid"))?;
        verifying_key
            .verify_strict(
                &signature_input(&self.unsigned_canonical_json()?),
                &Signature::from_bytes(&self.signature),
            )
            .map_err(|_| {
                verification_failed("release checksum manifest signature verification failed")
            })
    }

    /// Verifies one downloaded artifact against this manifest.
    ///
    /// An artifact the manifest does not name is refused rather than accepted
    /// on the strength of the manifest's signature alone.
    pub fn verify_artifact(&self, filename: &str, bytes: &[u8]) -> RecoveryCoreResult<()> {
        let entry = self
            .entries
            .iter()
            .find(|entry| entry.filename == filename)
            .ok_or_else(|| {
                verification_failed("this release manifest does not describe that artifact")
            })?;
        let digest = Base64UrlUnpadded::encode_string(&<[u8; 32]>::from(Sha256::digest(bytes)));
        if digest != entry.sha256_b64u {
            return Err(verification_failed(
                "the artifact does not match the digest this release manifest records",
            ));
        }
        Ok(())
    }

    fn unsigned_canonical_json(&self) -> RecoveryCoreResult<Vec<u8>> {
        canonical(&self.to_value(false))
    }

    fn validate(&self) -> RecoveryCoreResult<()> {
        for (label, value) in [
            ("release version", &self.release_version),
            ("source revision", &self.source_revision),
            ("minimum protocol version", &self.minimum_protocol_version),
            ("release signer key id", &self.signer_key_id),
        ] {
            if value.trim().is_empty() || value.trim() != value {
                return Err(invalid_owned(format!("{label} is invalid")));
            }
        }
        if self.entries.is_empty() {
            return Err(invalid("release checksum manifest describes no artifacts"));
        }
        if self.entries.len() > RELEASE_MANIFEST_MAX_ENTRIES_V1 {
            return Err(invalid("release checksum manifest has too many artifacts"));
        }
        for (index, entry) in self.entries.iter().enumerate() {
            if entry.target.trim().is_empty() || entry.filename.trim().is_empty() {
                return Err(invalid("release artifact target and filename are required"));
            }
            if decode_digest(&entry.sha256_b64u).is_err() {
                return Err(invalid(
                    "release artifact digest is not a canonical SHA-256",
                ));
            }
            if index > 0 && self.entries[index - 1].filename.as_bytes() >= entry.filename.as_bytes()
            {
                return Err(invalid(
                    "release artifacts are not sorted and unique by filename",
                ));
            }
        }
        Ok(())
    }

    fn to_value(&self, include_signature: bool) -> Value {
        let mut entries = vec![
            (
                "entries",
                Value::Array(
                    self.entries
                        .iter()
                        .map(|entry| {
                            object(vec![
                                ("filename", Value::String(entry.filename.clone())),
                                ("sha256B64u", Value::String(entry.sha256_b64u.clone())),
                                ("target", Value::String(entry.target.clone())),
                            ])
                        })
                        .collect(),
                ),
            ),
            (
                "formatVersion",
                Value::String(RELEASE_MANIFEST_FORMAT_V1.to_owned()),
            ),
            (
                "minimumProtocolVersion",
                Value::String(self.minimum_protocol_version.clone()),
            ),
            (
                "releaseVersion",
                Value::String(self.release_version.clone()),
            ),
            ("signerKeyId", Value::String(self.signer_key_id.clone())),
            (
                "sourceRevision",
                Value::String(self.source_revision.clone()),
            ),
        ];
        if include_signature {
            entries.push((
                "signature",
                Value::String(Base64UrlUnpadded::encode_string(&self.signature)),
            ));
        }
        object(entries)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleaseEntryWire {
    filename: String,
    #[serde(rename = "sha256B64u")]
    sha256_b64u: String,
    target: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleaseManifestWire {
    entries: Vec<ReleaseEntryWire>,
    format_version: String,
    minimum_protocol_version: String,
    release_version: String,
    signature: String,
    signer_key_id: String,
    source_revision: String,
}

fn signature_input(unsigned: &[u8]) -> Vec<u8> {
    let mut input = Vec::with_capacity(RELEASE_MANIFEST_DOMAIN_V1.len() + unsigned.len());
    input.extend_from_slice(RELEASE_MANIFEST_DOMAIN_V1);
    input.extend_from_slice(unsigned);
    input
}

fn object(entries: Vec<(&str, Value)>) -> Value {
    let mut map = serde_json::Map::new();
    for (key, value) in entries {
        map.insert(key.to_owned(), value);
    }
    Value::Object(map)
}

fn canonical(value: &Value) -> RecoveryCoreResult<Vec<u8>> {
    canonical_recovery_json_v1(value).map_err(|error| invalid_owned(error.message().to_owned()))
}

fn decode_digest(value: &str) -> RecoveryCoreResult<[u8; 32]> {
    let decoded = Base64UrlUnpadded::decode_vec(value)
        .map_err(|_| invalid("release artifact digest is invalid base64url"))?;
    if Base64UrlUnpadded::encode_string(&decoded) != value {
        return Err(invalid(
            "release artifact digest is not canonical base64url",
        ));
    }
    decoded
        .try_into()
        .map_err(|_| invalid("release artifact digest has an invalid length"))
}

fn decode_signature(value: &str) -> RecoveryCoreResult<[u8; 64]> {
    let decoded = Base64UrlUnpadded::decode_vec(value)
        .map_err(|_| invalid("release manifest signature is invalid base64url"))?;
    if Base64UrlUnpadded::encode_string(&decoded) != value {
        return Err(invalid(
            "release manifest signature is not canonical base64url",
        ));
    }
    decoded
        .try_into()
        .map_err(|_| invalid("release manifest signature has an invalid length"))
}

fn invalid(message: &'static str) -> RecoveryCoreError {
    RecoveryCoreError::new(RecoveryCoreErrorCode::InvalidLocalInput, message)
}

fn invalid_owned(message: String) -> RecoveryCoreError {
    RecoveryCoreError::new(RecoveryCoreErrorCode::InvalidLocalInput, message)
}

fn verification_failed(message: &'static str) -> RecoveryCoreError {
    RecoveryCoreError::new(RecoveryCoreErrorCode::ArtifactVerificationFailed, message)
}
