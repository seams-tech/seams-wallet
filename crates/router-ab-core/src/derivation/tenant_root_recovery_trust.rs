//! Offline trust for tenant derivation-root recovery artifacts (Refactor 121).
//!
//! Recovery artifacts are signed by three rotating signers: Deriver A, Deriver B,
//! and the control plane. This module binds each of those signing keys to a
//! certificate issued by a *pinned offline recovery-verification root*, so a
//! verifier never has to be handed raw signer keys out of band.
//!
//! Three rules shape the design:
//!
//! - A manifest carries certificate chains but **cannot introduce a trust root**.
//!   Roots come only from a [`TenantRootRecoveryTrustBundleV1`] the verifier
//!   already pinned.
//! - A certificate authorizes exactly one signer role and one validity interval.
//!   An artifact is trusted when it was *created* inside that interval, so
//!   ordinary signer retirement never invalidates correctly signed history.
//! - Compromise is different from retirement: a revocation entry carries an
//!   `invalidBefore` time that explicitly invalidates earlier artifacts from that
//!   signer, and that failure is terminal.
//!
//! The verifier reports which of the three trust results it actually obtained
//! ([`TenantRootRecoveryTrustLevelV1`]) rather than collapsing them into a
//! boolean, because restore admits them differently.

use core::fmt;

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;
use threshold_prf::TwoPartyDeriverRole;

use super::tenant_root_recovery_artifacts::{
    canonical_json_bytes, decode_base64url_fixed, encode_base64url, json_object, malformed,
    malformed_owned, require_key_id, strict_json_value, validate_rfc3339_millis,
    verification_failed,
};
use super::tenant_root_time::epoch_millis;
use super::{
    RouterAbDerivationResult, TenantRootRecoveryManifestV1, TenantRootRecoveryPackageV1,
    TenantRootRecoveryTrustedVerifyingKeysV1, TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1,
};

const TENANT_ROOT_RECOVERY_SIGNER_CERTIFICATE_FORMAT_V1: &str =
    "tenant_root_recovery_signer_certificate_v1";
const TENANT_ROOT_RECOVERY_TRUST_BRIDGE_FORMAT_V1: &str = "tenant_root_recovery_trust_bridge_v1";
const TENANT_ROOT_RECOVERY_TRUST_BUNDLE_FORMAT_V1: &str = "tenant_root_recovery_trust_bundle_v1";
const TENANT_ROOT_RECOVERY_REVOCATION_SNAPSHOT_FORMAT_V1: &str =
    "tenant_root_recovery_revocation_snapshot_v1";

const TENANT_ROOT_RECOVERY_SIGNER_CERTIFICATE_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-recovery-signer-certificate/v1";
const TENANT_ROOT_RECOVERY_TRUST_BRIDGE_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-recovery-trust-bridge/v1";
const TENANT_ROOT_RECOVERY_REVOCATION_SNAPSHOT_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-recovery-revocation-snapshot/v1";

/// Warning version recorded when restore proceeds without current revocation status.
pub const TENANT_ROOT_RECOVERY_OFFLINE_TRUST_WARNING_V1: &str =
    "tenant_root_recovery_offline_trust_v1";

/// Maximum encoded bytes accepted for one signer certificate.
pub const TENANT_ROOT_RECOVERY_SIGNER_CERTIFICATE_MAX_BYTES: usize = 2 * 1024;
/// Maximum encoded bytes accepted for one pinned trust bundle.
pub const TENANT_ROOT_RECOVERY_TRUST_BUNDLE_MAX_BYTES: usize = 64 * 1024;
/// Maximum encoded bytes accepted for one signed revocation snapshot.
pub const TENANT_ROOT_RECOVERY_REVOCATION_SNAPSHOT_MAX_BYTES: usize = 64 * 1024;

/// Certificate-chain length accepted by the first release.
///
/// A chain is exactly one certificate issued directly by a pinned recovery
/// root. Intermediates are a future additive change: admitting them now would
/// let an artifact widen its own trust path.
pub const TENANT_ROOT_RECOVERY_SIGNER_CHAIN_LEN_V1: usize = 1;

const TENANT_ROOT_RECOVERY_TRUST_MAX_HISTORICAL_ROOTS_V1: usize = 32;
const TENANT_ROOT_RECOVERY_TRUST_MAX_BRIDGES_V1: usize = 64;
const TENANT_ROOT_RECOVERY_TRUST_MAX_REVOCATIONS_V1: usize = 1024;
const TENANT_ROOT_RECOVERY_TRUST_MAX_KEY_ID_LEN_V1: usize = 128;

/// Signer role authorized by one recovery certificate.
///
/// Wider than [`TwoPartyDeriverRole`]: the control plane signs the manifest but
/// holds no derivation role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TenantRootRecoverySignerRoleV1 {
    /// Deriver A role-signing key.
    DeriverA,
    /// Deriver B role-signing key.
    DeriverB,
    /// Control-plane manifest-signing key.
    ControlPlane,
}

impl TenantRootRecoverySignerRoleV1 {
    /// Returns the canonical wire value.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DeriverA => "deriver_a",
            Self::DeriverB => "deriver_b",
            Self::ControlPlane => "control_plane",
        }
    }

    /// Returns the signer role for one derivation role.
    pub const fn from_deriver_role(role: TwoPartyDeriverRole) -> Self {
        match role {
            TwoPartyDeriverRole::DeriverA => Self::DeriverA,
            TwoPartyDeriverRole::DeriverB => Self::DeriverB,
        }
    }

    fn parse(value: &str) -> RouterAbDerivationResult<Self> {
        match value {
            "deriver_a" => Ok(Self::DeriverA),
            "deriver_b" => Ok(Self::DeriverB),
            "control_plane" => Ok(Self::ControlPlane),
            _ => Err(malformed(
                "tenant root recovery signer role is not a known role",
            )),
        }
    }
}

impl Serialize for TenantRootRecoverySignerRoleV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

/// One pinned offline recovery-verification root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRecoveryTrustRootV1 {
    key_id: String,
    verifying_key: [u8; 32],
}

impl TenantRootRecoveryTrustRootV1 {
    /// Creates one pinned root from its identifier and Ed25519 verifying key.
    pub fn new(
        key_id: impl Into<String>,
        verifying_key: [u8; 32],
    ) -> RouterAbDerivationResult<Self> {
        let key_id = key_id.into();
        validate_key_id(&key_id, "tenant root recovery trust root key id")?;
        VerifyingKey::from_bytes(&verifying_key)
            .map_err(|_| malformed("tenant root recovery trust root verifying key is invalid"))?;
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

    fn to_value(&self) -> Value {
        json_object(vec![
            ("keyId", Value::String(self.key_id.clone())),
            (
                "verifyingKey",
                Value::String(encode_base64url(&self.verifying_key)),
            ),
        ])
    }
}

/// One certificate binding a recovery signer key to a pinned root and one role.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRecoverySignerCertificateV1 {
    issuer_key_id: String,
    subject_key_id: String,
    subject_verifying_key: [u8; 32],
    authorized_role: TenantRootRecoverySignerRoleV1,
    not_before: String,
    not_after: String,
    signature: [u8; 64],
}

impl TenantRootRecoverySignerCertificateV1 {
    /// Signs one certificate with a pinned recovery root's signing key.
    pub fn sign(
        issuer_key_id: impl Into<String>,
        issuer_signing_key_bytes: &[u8; 32],
        subject_key_id: impl Into<String>,
        subject_verifying_key: [u8; 32],
        authorized_role: TenantRootRecoverySignerRoleV1,
        not_before: impl Into<String>,
        not_after: impl Into<String>,
    ) -> RouterAbDerivationResult<Self> {
        let mut certificate = Self {
            issuer_key_id: issuer_key_id.into(),
            subject_key_id: subject_key_id.into(),
            subject_verifying_key,
            authorized_role,
            not_before: not_before.into(),
            not_after: not_after.into(),
            signature: [0_u8; 64],
        };
        certificate.validate_shape()?;
        let signing_key = SigningKey::from_bytes(issuer_signing_key_bytes);
        certificate.signature = signing_key
            .sign(&certificate_signature_input(
                &certificate.unsigned_canonical_json()?,
            ))
            .to_bytes();
        Ok(certificate)
    }

    /// Returns the issuing pinned-root key identifier.
    pub fn issuer_key_id(&self) -> &str {
        &self.issuer_key_id
    }

    /// Returns the certified signer key identifier.
    pub fn subject_key_id(&self) -> &str {
        &self.subject_key_id
    }

    /// Returns the certified Ed25519 signer verifying key.
    pub const fn subject_verifying_key(&self) -> &[u8; 32] {
        &self.subject_verifying_key
    }

    /// Returns the single role this certificate authorizes.
    pub const fn authorized_role(&self) -> TenantRootRecoverySignerRoleV1 {
        self.authorized_role
    }

    /// Returns the inclusive start of the validity interval.
    pub fn not_before(&self) -> &str {
        &self.not_before
    }

    /// Returns the inclusive end of the validity interval.
    pub fn not_after(&self) -> &str {
        &self.not_after
    }

    /// Returns the exact unsigned canonical bytes covered by the signature.
    pub fn unsigned_canonical_json(&self) -> RouterAbDerivationResult<Vec<u8>> {
        self.validate_shape()?;
        canonical_json_bytes(&self.to_value(false))
    }

    /// Returns the exact canonical signed certificate bytes.
    pub fn canonical_json(&self) -> RouterAbDerivationResult<Vec<u8>> {
        self.validate()?;
        canonical_json_bytes(&self.to_value(true))
    }

    /// Parses one exact capped canonical certificate.
    pub fn from_canonical_json(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.len() > TENANT_ROOT_RECOVERY_SIGNER_CERTIFICATE_MAX_BYTES {
            return Err(malformed(
                "tenant root recovery signer certificate exceeds size cap",
            ));
        }
        let value = strict_json_value(bytes)?;
        let wire: SignerCertificateWire = serde_json::from_value(value).map_err(|error| {
            malformed_owned(format!(
                "invalid tenant root recovery signer certificate: {error}"
            ))
        })?;
        if wire.format_version != TENANT_ROOT_RECOVERY_SIGNER_CERTIFICATE_FORMAT_V1 {
            return Err(malformed(
                "tenant root recovery signer certificate version is invalid",
            ));
        }
        let certificate = Self {
            issuer_key_id: wire.issuer_key_id,
            subject_key_id: wire.subject_key_id,
            subject_verifying_key: decode_base64url_fixed(
                &wire.subject_verifying_key,
                "certificate subject verifying key",
            )?,
            authorized_role: TenantRootRecoverySignerRoleV1::parse(&wire.authorized_role)?,
            not_before: wire.not_before,
            not_after: wire.not_after,
            signature: decode_base64url_fixed(&wire.signature, "certificate signature")?,
        };
        if certificate.canonical_json()? != bytes {
            return Err(malformed(
                "tenant root recovery signer certificate is not canonical JSON",
            ));
        }
        Ok(certificate)
    }

    /// Encodes this certificate as one manifest chain entry.
    pub fn to_chain_entry(&self) -> RouterAbDerivationResult<String> {
        Ok(encode_base64url(&self.canonical_json()?))
    }

    /// Decodes one manifest chain entry.
    pub fn from_chain_entry(entry: &str) -> RouterAbDerivationResult<Self> {
        let bytes = decode_base64url_vec(entry, "recovery signer certificate chain entry")?;
        Self::from_canonical_json(&bytes)
    }

    /// Verifies this certificate's signature against one pinned root.
    pub fn verify_issued_by(
        &self,
        root: &TenantRootRecoveryTrustRootV1,
    ) -> RouterAbDerivationResult<()> {
        self.validate()?;
        if self.issuer_key_id != root.key_id {
            return Err(verification_failed(
                "tenant root recovery certificate issuer is not the supplied pinned root",
            ));
        }
        let verifying_key = VerifyingKey::from_bytes(&root.verifying_key)
            .map_err(|_| malformed("tenant root recovery trust root verifying key is invalid"))?;
        verifying_key
            .verify_strict(
                &certificate_signature_input(&self.unsigned_canonical_json()?),
                &Signature::from_bytes(&self.signature),
            )
            .map_err(|_| {
                verification_failed(
                    "tenant root recovery certificate signature verification failed",
                )
            })
    }

    fn validate(&self) -> RouterAbDerivationResult<()> {
        self.validate_shape()?;
        if self.signature == [0_u8; 64] {
            return Err(malformed(
                "tenant root recovery signer certificate signature is empty",
            ));
        }
        Ok(())
    }

    fn validate_shape(&self) -> RouterAbDerivationResult<()> {
        validate_key_id(&self.issuer_key_id, "certificate issuer key id")?;
        validate_key_id(&self.subject_key_id, "certificate subject key id")?;
        VerifyingKey::from_bytes(&self.subject_verifying_key).map_err(|_| {
            malformed("tenant root recovery certificate subject verifying key is invalid")
        })?;
        validate_rfc3339_millis(&self.not_before, "certificate notBefore")?;
        validate_rfc3339_millis(&self.not_after, "certificate notAfter")?;
        if epoch_millis(&self.not_before, "certificate notBefore")?
            >= epoch_millis(&self.not_after, "certificate notAfter")?
        {
            return Err(malformed(
                "tenant root recovery certificate validity interval is empty",
            ));
        }
        Ok(())
    }

    fn to_value(&self, include_signature: bool) -> Value {
        let mut entries = vec![
            (
                "authorizedRole",
                Value::String(self.authorized_role.as_str().to_owned()),
            ),
            (
                "formatVersion",
                Value::String(TENANT_ROOT_RECOVERY_SIGNER_CERTIFICATE_FORMAT_V1.to_owned()),
            ),
            ("issuerKeyId", Value::String(self.issuer_key_id.clone())),
            ("notAfter", Value::String(self.not_after.clone())),
            ("notBefore", Value::String(self.not_before.clone())),
            ("subjectKeyId", Value::String(self.subject_key_id.clone())),
            (
                "subjectVerifyingKey",
                Value::String(encode_base64url(&self.subject_verifying_key)),
            ),
        ];
        if include_signature {
            entries.push((
                "signature",
                Value::String(encode_base64url(&self.signature)),
            ));
        }
        json_object(entries)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignerCertificateWire {
    authorized_role: String,
    format_version: String,
    issuer_key_id: String,
    not_after: String,
    not_before: String,
    signature: String,
    subject_key_id: String,
    subject_verifying_key: String,
}

fn certificate_signature_input(unsigned: &[u8]) -> Vec<u8> {
    let mut input = Vec::with_capacity(
        TENANT_ROOT_RECOVERY_SIGNER_CERTIFICATE_DOMAIN_V1.len() + unsigned.len(),
    );
    input.extend_from_slice(TENANT_ROOT_RECOVERY_SIGNER_CERTIFICATE_DOMAIN_V1);
    input.extend_from_slice(unsigned);
    input
}

/// One recovery-root rotation step, signed by both the old and the new root.
///
/// Rotation never orphans history: a certificate issued by an older root stays
/// verifiable as long as that root still reaches the current root through
/// bridges kept in the bundle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRecoveryTrustBridgeV1 {
    from_root: TenantRootRecoveryTrustRootV1,
    to_root: TenantRootRecoveryTrustRootV1,
    issued_at: String,
    from_signature: [u8; 64],
    to_signature: [u8; 64],
}

impl TenantRootRecoveryTrustBridgeV1 {
    /// Signs one rotation bridge with both root signing keys.
    pub fn sign(
        from_root: TenantRootRecoveryTrustRootV1,
        from_root_signing_key_bytes: &[u8; 32],
        to_root: TenantRootRecoveryTrustRootV1,
        to_root_signing_key_bytes: &[u8; 32],
        issued_at: impl Into<String>,
    ) -> RouterAbDerivationResult<Self> {
        let mut bridge = Self {
            from_root,
            to_root,
            issued_at: issued_at.into(),
            from_signature: [0_u8; 64],
            to_signature: [0_u8; 64],
        };
        bridge.validate_shape()?;
        let unsigned = bridge_signature_input(&bridge.unsigned_canonical_json()?);
        bridge.from_signature = SigningKey::from_bytes(from_root_signing_key_bytes)
            .sign(&unsigned)
            .to_bytes();
        bridge.to_signature = SigningKey::from_bytes(to_root_signing_key_bytes)
            .sign(&unsigned)
            .to_bytes();
        bridge.verify()?;
        Ok(bridge)
    }

    /// Returns the superseded root.
    pub const fn from_root(&self) -> &TenantRootRecoveryTrustRootV1 {
        &self.from_root
    }

    /// Returns the succeeding root.
    pub const fn to_root(&self) -> &TenantRootRecoveryTrustRootV1 {
        &self.to_root
    }

    /// Returns the rotation time.
    pub fn issued_at(&self) -> &str {
        &self.issued_at
    }

    /// Verifies that both roots signed this exact rotation.
    pub fn verify(&self) -> RouterAbDerivationResult<()> {
        self.validate_shape()?;
        let input = bridge_signature_input(&self.unsigned_canonical_json()?);
        verify_detached(
            &self.from_root.verifying_key,
            &input,
            &self.from_signature,
            "tenant root recovery trust bridge superseded-root signature verification failed",
        )?;
        verify_detached(
            &self.to_root.verifying_key,
            &input,
            &self.to_signature,
            "tenant root recovery trust bridge succeeding-root signature verification failed",
        )
    }

    fn unsigned_canonical_json(&self) -> RouterAbDerivationResult<Vec<u8>> {
        canonical_json_bytes(&self.to_value(false))
    }

    fn validate_shape(&self) -> RouterAbDerivationResult<()> {
        validate_rfc3339_millis(&self.issued_at, "trust bridge issuedAt")?;
        epoch_millis(&self.issued_at, "trust bridge issuedAt")?;
        if self.from_root.key_id == self.to_root.key_id {
            return Err(malformed(
                "tenant root recovery trust bridge does not rotate to a different root",
            ));
        }
        if self.from_root.verifying_key == self.to_root.verifying_key {
            return Err(malformed(
                "tenant root recovery trust bridge reuses one verifying key for both roots",
            ));
        }
        Ok(())
    }

    fn to_value(&self, include_signatures: bool) -> Value {
        let mut entries = vec![
            (
                "formatVersion",
                Value::String(TENANT_ROOT_RECOVERY_TRUST_BRIDGE_FORMAT_V1.to_owned()),
            ),
            ("fromRoot", self.from_root.to_value()),
            ("issuedAt", Value::String(self.issued_at.clone())),
            ("toRoot", self.to_root.to_value()),
        ];
        if include_signatures {
            entries.push((
                "fromSignature",
                Value::String(encode_base64url(&self.from_signature)),
            ));
            entries.push((
                "toSignature",
                Value::String(encode_base64url(&self.to_signature)),
            ));
        }
        json_object(entries)
    }
}

fn bridge_signature_input(unsigned: &[u8]) -> Vec<u8> {
    let mut input =
        Vec::with_capacity(TENANT_ROOT_RECOVERY_TRUST_BRIDGE_DOMAIN_V1.len() + unsigned.len());
    input.extend_from_slice(TENANT_ROOT_RECOVERY_TRUST_BRIDGE_DOMAIN_V1);
    input.extend_from_slice(unsigned);
    input
}

/// The pinned trust material a verifier already holds.
///
/// This is the only source of roots. Nothing inside an artifact can add one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRecoveryTrustBundleV1 {
    bundle_version: u64,
    current_root: TenantRootRecoveryTrustRootV1,
    historical_roots: Vec<TenantRootRecoveryTrustRootV1>,
    bridges: Vec<TenantRootRecoveryTrustBridgeV1>,
}

impl TenantRootRecoveryTrustBundleV1 {
    /// Creates one verified bundle.
    ///
    /// Every historical root must still reach the current root through verified
    /// bridges, so a bundle can never silently strand certificates it claims to
    /// cover.
    pub fn new(
        bundle_version: u64,
        current_root: TenantRootRecoveryTrustRootV1,
        historical_roots: Vec<TenantRootRecoveryTrustRootV1>,
        bridges: Vec<TenantRootRecoveryTrustBridgeV1>,
    ) -> RouterAbDerivationResult<Self> {
        let bundle = Self {
            bundle_version,
            current_root,
            historical_roots,
            bridges,
        };
        bundle.verify()?;
        Ok(bundle)
    }

    /// Returns the monotonic bundle version.
    pub const fn bundle_version(&self) -> u64 {
        self.bundle_version
    }

    /// Returns the current pinned root.
    pub const fn current_root(&self) -> &TenantRootRecoveryTrustRootV1 {
        &self.current_root
    }

    /// Returns the retained historical roots.
    pub fn historical_roots(&self) -> &[TenantRootRecoveryTrustRootV1] {
        &self.historical_roots
    }

    /// Returns the retained rotation bridges.
    pub fn bridges(&self) -> &[TenantRootRecoveryTrustBridgeV1] {
        &self.bridges
    }

    /// Verifies bundle shape, every bridge signature, and root reachability.
    pub fn verify(&self) -> RouterAbDerivationResult<()> {
        if self.bundle_version == 0 {
            return Err(malformed(
                "tenant root recovery trust bundle version must be positive",
            ));
        }
        if self.historical_roots.len() > TENANT_ROOT_RECOVERY_TRUST_MAX_HISTORICAL_ROOTS_V1 {
            return Err(malformed(
                "tenant root recovery trust bundle has too many historical roots",
            ));
        }
        if self.bridges.len() > TENANT_ROOT_RECOVERY_TRUST_MAX_BRIDGES_V1 {
            return Err(malformed(
                "tenant root recovery trust bundle has too many bridges",
            ));
        }
        for (index, root) in self.historical_roots.iter().enumerate() {
            if root.key_id == self.current_root.key_id {
                return Err(malformed(
                    "tenant root recovery trust bundle repeats the current root as historical",
                ));
            }
            if self.historical_roots[..index]
                .iter()
                .any(|earlier| earlier.key_id == root.key_id)
            {
                return Err(malformed(
                    "tenant root recovery trust bundle repeats one historical root key id",
                ));
            }
        }
        for bridge in &self.bridges {
            bridge.verify()?;
            self.require_known_root(&bridge.from_root, "bridge superseded root")?;
            self.require_known_root(&bridge.to_root, "bridge succeeding root")?;
        }
        for root in &self.historical_roots {
            if !self.reaches_current_root(&root.key_id) {
                return Err(verification_failed(
                    "tenant root recovery trust bundle historical root does not bridge to the current root",
                ));
            }
        }
        Ok(())
    }

    /// Returns the pinned root that may issue certificates under this key id.
    pub fn issuing_root(
        &self,
        key_id: &str,
    ) -> RouterAbDerivationResult<&TenantRootRecoveryTrustRootV1> {
        if self.current_root.key_id == key_id {
            return Ok(&self.current_root);
        }
        let root = self
            .historical_roots
            .iter()
            .find(|root| root.key_id == key_id)
            .ok_or_else(|| {
                verification_failed(
                    "tenant root recovery certificate issuer is not a pinned trust root",
                )
            })?;
        if !self.reaches_current_root(key_id) {
            return Err(verification_failed(
                "tenant root recovery certificate issuer no longer bridges to the current root",
            ));
        }
        Ok(root)
    }

    fn require_known_root(
        &self,
        root: &TenantRootRecoveryTrustRootV1,
        field: &'static str,
    ) -> RouterAbDerivationResult<()> {
        let known = core::iter::once(&self.current_root)
            .chain(self.historical_roots.iter())
            .find(|candidate| candidate.key_id == root.key_id)
            .ok_or_else(|| {
                malformed_owned(format!(
                    "tenant root recovery trust bundle {field} is not present in the bundle"
                ))
            })?;
        if known.verifying_key != root.verifying_key {
            return Err(malformed_owned(format!(
                "tenant root recovery trust bundle {field} key id and verifying key disagree"
            )));
        }
        Ok(())
    }

    fn reaches_current_root(&self, key_id: &str) -> bool {
        if key_id == self.current_root.key_id {
            return true;
        }
        let mut reached = vec![key_id.to_owned()];
        // Bounded by the bridge count: each pass must add at least one new root.
        for _ in 0..=self.bridges.len() {
            let mut grew = false;
            for bridge in &self.bridges {
                if reached.iter().any(|id| id == &bridge.from_root.key_id)
                    && !reached.iter().any(|id| id == &bridge.to_root.key_id)
                {
                    if bridge.to_root.key_id == self.current_root.key_id {
                        return true;
                    }
                    reached.push(bridge.to_root.key_id.clone());
                    grew = true;
                }
            }
            if !grew {
                return false;
            }
        }
        false
    }

    /// Returns the exact canonical bundle bytes.
    pub fn canonical_json(&self) -> RouterAbDerivationResult<Vec<u8>> {
        self.verify()?;
        canonical_json_bytes(&json_object(vec![
            (
                "bridges",
                Value::Array(self.bridges.iter().map(|b| b.to_value(true)).collect()),
            ),
            ("bundleVersion", Value::Number(self.bundle_version.into())),
            ("currentRoot", self.current_root.to_value()),
            (
                "formatVersion",
                Value::String(TENANT_ROOT_RECOVERY_TRUST_BUNDLE_FORMAT_V1.to_owned()),
            ),
            (
                "historicalRoots",
                Value::Array(self.historical_roots.iter().map(|r| r.to_value()).collect()),
            ),
        ]))
    }

    /// Parses one exact capped canonical bundle.
    pub fn from_canonical_json(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.len() > TENANT_ROOT_RECOVERY_TRUST_BUNDLE_MAX_BYTES {
            return Err(malformed(
                "tenant root recovery trust bundle exceeds size cap",
            ));
        }
        let value = strict_json_value(bytes)?;
        let wire: TrustBundleWire = serde_json::from_value(value).map_err(|error| {
            malformed_owned(format!(
                "invalid tenant root recovery trust bundle: {error}"
            ))
        })?;
        if wire.format_version != TENANT_ROOT_RECOVERY_TRUST_BUNDLE_FORMAT_V1 {
            return Err(malformed(
                "tenant root recovery trust bundle version is invalid",
            ));
        }
        let bundle = Self {
            bundle_version: wire.bundle_version,
            current_root: root_from_wire(wire.current_root)?,
            historical_roots: wire
                .historical_roots
                .into_iter()
                .map(root_from_wire)
                .collect::<RouterAbDerivationResult<Vec<_>>>()?,
            bridges: wire
                .bridges
                .into_iter()
                .map(bridge_from_wire)
                .collect::<RouterAbDerivationResult<Vec<_>>>()?,
        };
        if bundle.canonical_json()? != bytes {
            return Err(malformed(
                "tenant root recovery trust bundle is not canonical JSON",
            ));
        }
        Ok(bundle)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TrustRootWire {
    key_id: String,
    verifying_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TrustBridgeWire {
    format_version: String,
    from_root: TrustRootWire,
    from_signature: String,
    issued_at: String,
    to_root: TrustRootWire,
    to_signature: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TrustBundleWire {
    bridges: Vec<TrustBridgeWire>,
    bundle_version: u64,
    current_root: TrustRootWire,
    format_version: String,
    historical_roots: Vec<TrustRootWire>,
}

fn root_from_wire(wire: TrustRootWire) -> RouterAbDerivationResult<TenantRootRecoveryTrustRootV1> {
    TenantRootRecoveryTrustRootV1::new(
        wire.key_id,
        decode_base64url_fixed(&wire.verifying_key, "trust root verifying key")?,
    )
}

fn bridge_from_wire(
    wire: TrustBridgeWire,
) -> RouterAbDerivationResult<TenantRootRecoveryTrustBridgeV1> {
    if wire.format_version != TENANT_ROOT_RECOVERY_TRUST_BRIDGE_FORMAT_V1 {
        return Err(malformed(
            "tenant root recovery trust bridge version is invalid",
        ));
    }
    let bridge = TenantRootRecoveryTrustBridgeV1 {
        from_root: root_from_wire(wire.from_root)?,
        to_root: root_from_wire(wire.to_root)?,
        issued_at: wire.issued_at,
        from_signature: decode_base64url_fixed(
            &wire.from_signature,
            "trust bridge from signature",
        )?,
        to_signature: decode_base64url_fixed(&wire.to_signature, "trust bridge to signature")?,
    };
    bridge.verify()?;
    Ok(bridge)
}

/// Why one signer key appears in a revocation snapshot.
///
/// The two branches carry different security meaning and must not be collapsed:
/// retirement is routine key hygiene, compromise invalidates history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantRootRecoveryRevocationKindV1 {
    /// Ordinary retirement. Artifacts signed inside the certificate interval stay valid.
    Retired,
    /// Compromise. Artifacts created before `invalid_before` are explicitly invalid.
    Compromised {
        /// Artifacts created before this time are rejected.
        invalid_before: String,
    },
}

impl TenantRootRecoveryRevocationKindV1 {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Retired => "retired",
            Self::Compromised { .. } => "compromised",
        }
    }
}

/// One revoked signer key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRecoveryRevocationEntryV1 {
    subject_key_id: String,
    kind: TenantRootRecoveryRevocationKindV1,
}

impl TenantRootRecoveryRevocationEntryV1 {
    /// Records one ordinary signer retirement.
    pub fn retired(subject_key_id: impl Into<String>) -> RouterAbDerivationResult<Self> {
        let subject_key_id = subject_key_id.into();
        validate_key_id(&subject_key_id, "revocation subject key id")?;
        Ok(Self {
            subject_key_id,
            kind: TenantRootRecoveryRevocationKindV1::Retired,
        })
    }

    /// Records one compromise that invalidates artifacts created before `invalid_before`.
    pub fn compromised(
        subject_key_id: impl Into<String>,
        invalid_before: impl Into<String>,
    ) -> RouterAbDerivationResult<Self> {
        let subject_key_id = subject_key_id.into();
        let invalid_before = invalid_before.into();
        validate_key_id(&subject_key_id, "revocation subject key id")?;
        validate_rfc3339_millis(&invalid_before, "revocation invalidBefore")?;
        epoch_millis(&invalid_before, "revocation invalidBefore")?;
        Ok(Self {
            subject_key_id,
            kind: TenantRootRecoveryRevocationKindV1::Compromised { invalid_before },
        })
    }

    /// Returns the revoked signer key identifier.
    pub fn subject_key_id(&self) -> &str {
        &self.subject_key_id
    }

    /// Returns the revocation branch.
    pub const fn kind(&self) -> &TenantRootRecoveryRevocationKindV1 {
        &self.kind
    }

    fn to_value(&self) -> Value {
        let mut entries = vec![
            ("kind", Value::String(self.kind.as_str().to_owned())),
            ("subjectKeyId", Value::String(self.subject_key_id.clone())),
        ];
        if let TenantRootRecoveryRevocationKindV1::Compromised { invalid_before } = &self.kind {
            entries.push(("invalidBefore", Value::String(invalid_before.clone())));
        }
        json_object(entries)
    }
}

/// One signed snapshot of signer revocation state.
///
/// A snapshot is signed by the bundle's **current** root only: a superseded root
/// must not be able to speak for present-day revocation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRecoveryRevocationSnapshotV1 {
    snapshot_version: u64,
    issued_at: String,
    signer_key_id: String,
    entries: Vec<TenantRootRecoveryRevocationEntryV1>,
    signature: [u8; 64],
}

impl TenantRootRecoveryRevocationSnapshotV1 {
    /// Signs one revocation snapshot with the current pinned root.
    pub fn sign(
        snapshot_version: u64,
        issued_at: impl Into<String>,
        signer_key_id: impl Into<String>,
        signing_key_bytes: &[u8; 32],
        entries: Vec<TenantRootRecoveryRevocationEntryV1>,
    ) -> RouterAbDerivationResult<Self> {
        let mut snapshot = Self {
            snapshot_version,
            issued_at: issued_at.into(),
            signer_key_id: signer_key_id.into(),
            entries,
            signature: [0_u8; 64],
        };
        snapshot.validate_shape()?;
        snapshot.signature = SigningKey::from_bytes(signing_key_bytes)
            .sign(&snapshot_signature_input(
                &snapshot.unsigned_canonical_json()?,
            ))
            .to_bytes();
        Ok(snapshot)
    }

    /// Returns the monotonic snapshot version.
    pub const fn snapshot_version(&self) -> u64 {
        self.snapshot_version
    }

    /// Returns the snapshot issue time.
    pub fn issued_at(&self) -> &str {
        &self.issued_at
    }

    /// Returns the signing root key identifier.
    pub fn signer_key_id(&self) -> &str {
        &self.signer_key_id
    }

    /// Returns the revoked signer entries.
    pub fn entries(&self) -> &[TenantRootRecoveryRevocationEntryV1] {
        &self.entries
    }

    /// Verifies this snapshot against the bundle's current pinned root.
    pub fn verify(&self, bundle: &TenantRootRecoveryTrustBundleV1) -> RouterAbDerivationResult<()> {
        self.validate_shape()?;
        if self.signature == [0_u8; 64] {
            return Err(malformed(
                "tenant root recovery revocation snapshot signature is empty",
            ));
        }
        if self.signer_key_id != bundle.current_root.key_id {
            return Err(verification_failed(
                "tenant root recovery revocation snapshot was not signed by the current pinned root",
            ));
        }
        verify_detached(
            &bundle.current_root.verifying_key,
            &snapshot_signature_input(&self.unsigned_canonical_json()?),
            &self.signature,
            "tenant root recovery revocation snapshot signature verification failed",
        )
    }

    /// Applies revocation to one signer key and artifact creation time.
    pub fn apply(
        &self,
        subject_key_id: &str,
        artifact_creation_time: &str,
    ) -> RouterAbDerivationResult<()> {
        let Some(entry) = self
            .entries
            .iter()
            .find(|entry| entry.subject_key_id == subject_key_id)
        else {
            return Ok(());
        };
        match &entry.kind {
            TenantRootRecoveryRevocationKindV1::Retired => Ok(()),
            TenantRootRecoveryRevocationKindV1::Compromised { invalid_before } => {
                let created = epoch_millis(artifact_creation_time, "artifact creation time")?;
                let boundary = epoch_millis(invalid_before, "revocation invalidBefore")?;
                if created < boundary {
                    return Err(verification_failed(
                        "tenant root recovery artifact predates a compromise invalidBefore boundary",
                    ));
                }
                Ok(())
            }
        }
    }

    /// Returns the exact canonical signed snapshot bytes.
    pub fn canonical_json(&self) -> RouterAbDerivationResult<Vec<u8>> {
        self.validate_shape()?;
        canonical_json_bytes(&self.to_value(true))
    }

    /// Parses one exact capped canonical snapshot.
    pub fn from_canonical_json(bytes: &[u8]) -> RouterAbDerivationResult<Self> {
        if bytes.len() > TENANT_ROOT_RECOVERY_REVOCATION_SNAPSHOT_MAX_BYTES {
            return Err(malformed(
                "tenant root recovery revocation snapshot exceeds size cap",
            ));
        }
        let value = strict_json_value(bytes)?;
        let wire: RevocationSnapshotWire = serde_json::from_value(value).map_err(|error| {
            malformed_owned(format!(
                "invalid tenant root recovery revocation snapshot: {error}"
            ))
        })?;
        if wire.format_version != TENANT_ROOT_RECOVERY_REVOCATION_SNAPSHOT_FORMAT_V1 {
            return Err(malformed(
                "tenant root recovery revocation snapshot version is invalid",
            ));
        }
        let entries = wire
            .entries
            .into_iter()
            .map(|entry| match (entry.kind.as_str(), entry.invalid_before) {
                ("retired", None) => {
                    TenantRootRecoveryRevocationEntryV1::retired(entry.subject_key_id)
                }
                ("compromised", Some(invalid_before)) => {
                    TenantRootRecoveryRevocationEntryV1::compromised(
                        entry.subject_key_id,
                        invalid_before,
                    )
                }
                _ => Err(malformed(
                    "tenant root recovery revocation entry kind and fields disagree",
                )),
            })
            .collect::<RouterAbDerivationResult<Vec<_>>>()?;
        let snapshot = Self {
            snapshot_version: wire.snapshot_version,
            issued_at: wire.issued_at,
            signer_key_id: wire.signer_key_id,
            entries,
            signature: decode_base64url_fixed(&wire.signature, "revocation snapshot signature")?,
        };
        if snapshot.canonical_json()? != bytes {
            return Err(malformed(
                "tenant root recovery revocation snapshot is not canonical JSON",
            ));
        }
        Ok(snapshot)
    }

    fn unsigned_canonical_json(&self) -> RouterAbDerivationResult<Vec<u8>> {
        canonical_json_bytes(&self.to_value(false))
    }

    fn validate_shape(&self) -> RouterAbDerivationResult<()> {
        if self.snapshot_version == 0 {
            return Err(malformed(
                "tenant root recovery revocation snapshot version must be positive",
            ));
        }
        validate_key_id(&self.signer_key_id, "revocation snapshot signer key id")?;
        validate_rfc3339_millis(&self.issued_at, "revocation snapshot issuedAt")?;
        epoch_millis(&self.issued_at, "revocation snapshot issuedAt")?;
        if self.entries.len() > TENANT_ROOT_RECOVERY_TRUST_MAX_REVOCATIONS_V1 {
            return Err(malformed(
                "tenant root recovery revocation snapshot has too many entries",
            ));
        }
        for (index, entry) in self.entries.iter().enumerate() {
            validate_key_id(&entry.subject_key_id, "revocation subject key id")?;
            if index > 0
                && self.entries[index - 1].subject_key_id.as_bytes()
                    >= entry.subject_key_id.as_bytes()
            {
                return Err(malformed(
                    "tenant root recovery revocation entries are not sorted and unique by subject key id",
                ));
            }
        }
        Ok(())
    }

    fn to_value(&self, include_signature: bool) -> Value {
        let mut entries = vec![
            (
                "entries",
                Value::Array(self.entries.iter().map(|entry| entry.to_value()).collect()),
            ),
            (
                "formatVersion",
                Value::String(TENANT_ROOT_RECOVERY_REVOCATION_SNAPSHOT_FORMAT_V1.to_owned()),
            ),
            ("issuedAt", Value::String(self.issued_at.clone())),
            ("signerKeyId", Value::String(self.signer_key_id.clone())),
            (
                "snapshotVersion",
                Value::Number(self.snapshot_version.into()),
            ),
        ];
        if include_signature {
            entries.push((
                "signature",
                Value::String(encode_base64url(&self.signature)),
            ));
        }
        json_object(entries)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevocationEntryWire {
    #[serde(default)]
    invalid_before: Option<String>,
    kind: String,
    subject_key_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevocationSnapshotWire {
    entries: Vec<RevocationEntryWire>,
    format_version: String,
    issued_at: String,
    signature: String,
    signer_key_id: String,
    snapshot_version: u64,
}

fn snapshot_signature_input(unsigned: &[u8]) -> Vec<u8> {
    let mut input = Vec::with_capacity(
        TENANT_ROOT_RECOVERY_REVOCATION_SNAPSHOT_DOMAIN_V1.len() + unsigned.len(),
    );
    input.extend_from_slice(TENANT_ROOT_RECOVERY_REVOCATION_SNAPSHOT_DOMAIN_V1);
    input.extend_from_slice(unsigned);
    input
}

/// The trust material a caller actually had when it verified an artifact.
///
/// This is an input, not a claim: the level a verification reports is derived
/// from which branch was supplied and whether it passed, so no caller can
/// assert `current_trust_confirmed` without live snapshot evidence.
#[derive(Debug, Clone, Copy)]
pub enum TenantRootRecoveryTrustEvidenceV1<'a> {
    /// Only the pinned bundle. No revocation state was available.
    OfflineRootsOnly,
    /// A saved signed snapshot of unknown freshness.
    TrustSnapshot {
        /// The saved signed snapshot.
        snapshot: &'a TenantRootRecoveryRevocationSnapshotV1,
    },
    /// A snapshot fetched now, accepted only inside a caller-set freshness bound.
    LiveTrustCheck {
        /// The freshly fetched signed snapshot.
        snapshot: &'a TenantRootRecoveryRevocationSnapshotV1,
        /// The time the fetch completed.
        checked_at: &'a str,
        /// The maximum snapshot age this caller treats as current.
        max_snapshot_age_ms: u64,
    },
}

/// Which of the three trust results a verification actually obtained.
///
/// The dashboard and CLI display this verbatim; it is never reduced to a
/// boolean, because restore admits the three branches differently.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantRootRecoveryTrustLevelV1 {
    /// Signatures and certificates verify against pinned roots; revocation state unknown.
    CryptographicallyValidOffline,
    /// Additionally checked against a saved signed snapshot of known issue time.
    ValidAtTrustSnapshot {
        /// The snapshot version consulted.
        snapshot_version: u64,
        /// The snapshot issue time.
        snapshot_issued_at: String,
    },
    /// Additionally checked against a snapshot that was fresh at check time.
    CurrentTrustConfirmed {
        /// The snapshot version consulted.
        snapshot_version: u64,
        /// The snapshot issue time.
        snapshot_issued_at: String,
        /// The time the live check completed.
        checked_at: String,
    },
}

impl TenantRootRecoveryTrustLevelV1 {
    /// Returns the stable wire label shown by the dashboard and CLI.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CryptographicallyValidOffline => "cryptographically_valid_offline",
            Self::ValidAtTrustSnapshot { .. } => "valid_at_trust_snapshot",
            Self::CurrentTrustConfirmed { .. } => "current_trust_confirmed",
        }
    }
}

impl fmt::Display for TenantRootRecoveryTrustLevelV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A destination operator's explicit acknowledgement that revocation status was unavailable.
///
/// Restore preserves this in its activation receipt so the weaker check stays
/// visible after the fact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRecoveryOfflineTrustAcknowledgementV1 {
    acknowledged_by: String,
    acknowledged_at: String,
    warning_version: String,
}

impl TenantRootRecoveryOfflineTrustAcknowledgementV1 {
    /// Records one acknowledgement of unavailable revocation status.
    pub fn new(
        acknowledged_by: impl Into<String>,
        acknowledged_at: impl Into<String>,
    ) -> RouterAbDerivationResult<Self> {
        let acknowledged_by = acknowledged_by.into();
        let acknowledged_at = acknowledged_at.into();
        if acknowledged_by.is_empty() {
            return Err(malformed(
                "tenant root recovery offline trust acknowledgement actor is required",
            ));
        }
        validate_rfc3339_millis(&acknowledged_at, "offline trust acknowledgement time")?;
        epoch_millis(&acknowledged_at, "offline trust acknowledgement time")?;
        Ok(Self {
            acknowledged_by,
            acknowledged_at,
            warning_version: TENANT_ROOT_RECOVERY_OFFLINE_TRUST_WARNING_V1.to_owned(),
        })
    }

    /// Returns the acknowledging actor.
    pub fn acknowledged_by(&self) -> &str {
        &self.acknowledged_by
    }

    /// Returns the acknowledgement time.
    pub fn acknowledged_at(&self) -> &str {
        &self.acknowledged_at
    }

    /// Returns the fixed warning version.
    pub fn warning_version(&self) -> &str {
        &self.warning_version
    }
}

/// One recovery signer verified against pinned roots at an artifact's creation time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedTenantRootRecoverySignerV1 {
    role: TenantRootRecoverySignerRoleV1,
    key_id: String,
    verifying_key: [u8; 32],
    level: TenantRootRecoveryTrustLevelV1,
}

impl VerifiedTenantRootRecoverySignerV1 {
    /// Returns the authorized signer role.
    pub const fn role(&self) -> TenantRootRecoverySignerRoleV1 {
        self.role
    }

    /// Returns the certified signer key identifier.
    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    /// Returns the certified Ed25519 verifying key.
    pub const fn verifying_key(&self) -> &[u8; 32] {
        &self.verifying_key
    }

    /// Returns the trust result this verification obtained.
    pub const fn level(&self) -> &TenantRootRecoveryTrustLevelV1 {
        &self.level
    }
}

/// All three manifest signers verified against pinned roots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantRootRecoveryManifestTrustV1 {
    level: TenantRootRecoveryTrustLevelV1,
    keys: TenantRootRecoveryTrustedVerifyingKeysV1,
    deriver_a_key_id: String,
    deriver_b_key_id: String,
    control_plane_key_id: String,
}

impl TenantRootRecoveryManifestTrustV1 {
    /// Returns the trust result this verification obtained.
    pub const fn level(&self) -> &TenantRootRecoveryTrustLevelV1 {
        &self.level
    }

    /// Returns the signer keys certificates authorized for this artifact set.
    ///
    /// These are derived from pinned roots, never supplied by a caller.
    pub const fn trusted_verifying_keys(&self) -> &TenantRootRecoveryTrustedVerifyingKeysV1 {
        &self.keys
    }

    /// Returns the Deriver A signer key identifier.
    pub fn deriver_a_key_id(&self) -> &str {
        &self.deriver_a_key_id
    }

    /// Returns the Deriver B signer key identifier.
    pub fn deriver_b_key_id(&self) -> &str {
        &self.deriver_b_key_id
    }

    /// Returns the control-plane signer key identifier.
    pub fn control_plane_key_id(&self) -> &str {
        &self.control_plane_key_id
    }
}

/// Verifies one signer certificate chain against pinned roots at an artifact's creation time.
///
/// The chain must authorize the exact expected role, and (when the artifact
/// names one) the exact expected signer key id. Without that binding, chain
/// verification would prove nothing about the key that actually signed.
pub fn verify_tenant_root_recovery_signer_chain_v1(
    bundle: &TenantRootRecoveryTrustBundleV1,
    evidence: &TenantRootRecoveryTrustEvidenceV1<'_>,
    chain: &[String],
    expected_role: TenantRootRecoverySignerRoleV1,
    expected_subject_key_id: Option<&str>,
    artifact_creation_time: &str,
) -> RouterAbDerivationResult<VerifiedTenantRootRecoverySignerV1> {
    if chain.len() != TENANT_ROOT_RECOVERY_SIGNER_CHAIN_LEN_V1 {
        return Err(malformed(
            "tenant root recovery signer certificate chain must contain exactly one certificate",
        ));
    }
    let certificate = TenantRootRecoverySignerCertificateV1::from_chain_entry(&chain[0])?;
    if certificate.authorized_role != expected_role {
        return Err(verification_failed(
            "tenant root recovery certificate does not authorize this signer role",
        ));
    }
    if let Some(expected) = expected_subject_key_id {
        if certificate.subject_key_id != expected {
            return Err(verification_failed(
                "tenant root recovery certificate subject does not match the artifact signer key id",
            ));
        }
    }
    let root = bundle.issuing_root(&certificate.issuer_key_id)?;
    certificate.verify_issued_by(root)?;

    validate_rfc3339_millis(artifact_creation_time, "artifact creation time")?;
    let created = epoch_millis(artifact_creation_time, "artifact creation time")?;
    let not_before = epoch_millis(&certificate.not_before, "certificate notBefore")?;
    let not_after = epoch_millis(&certificate.not_after, "certificate notAfter")?;
    if created < not_before || created > not_after {
        return Err(verification_failed(
            "tenant root recovery artifact was not created inside its signer certificate validity",
        ));
    }

    let (level, snapshot) = evaluate_trust_evidence(bundle, evidence)?;
    if let Some(snapshot) = snapshot {
        snapshot.apply(&certificate.subject_key_id, artifact_creation_time)?;
    }

    Ok(VerifiedTenantRootRecoverySignerV1 {
        role: expected_role,
        key_id: certificate.subject_key_id,
        verifying_key: certificate.subject_verifying_key,
        level,
    })
}

/// Verifies all three manifest signer chains and returns their trusted keys.
///
/// This replaces handing a verifier three raw signer keys: the pinned bundle is
/// the only trust input, and the keys come out of certificates it authorized.
pub fn verify_tenant_root_recovery_manifest_trust_v1(
    manifest: &TenantRootRecoveryManifestV1,
    bundle: &TenantRootRecoveryTrustBundleV1,
    evidence: &TenantRootRecoveryTrustEvidenceV1<'_>,
) -> RouterAbDerivationResult<TenantRootRecoveryManifestTrustV1> {
    let descriptor = manifest.descriptor();
    let creation_time = descriptor.creation_time();
    let deriver_a = verify_tenant_root_recovery_signer_chain_v1(
        bundle,
        evidence,
        manifest.deriver_a_signer_certificate_chain(),
        TenantRootRecoverySignerRoleV1::DeriverA,
        Some(descriptor.deriver_a().deriver_signing_key_id()),
        creation_time,
    )?;
    let deriver_b = verify_tenant_root_recovery_signer_chain_v1(
        bundle,
        evidence,
        manifest.deriver_b_signer_certificate_chain(),
        TenantRootRecoverySignerRoleV1::DeriverB,
        Some(descriptor.deriver_b().deriver_signing_key_id()),
        creation_time,
    )?;
    let control_plane = verify_tenant_root_recovery_signer_chain_v1(
        bundle,
        evidence,
        manifest.control_plane_signer_certificate_chain(),
        TenantRootRecoverySignerRoleV1::ControlPlane,
        None,
        creation_time,
    )?;
    if deriver_a.key_id == deriver_b.key_id
        || deriver_a.verifying_key == deriver_b.verifying_key
        || control_plane.verifying_key == deriver_a.verifying_key
        || control_plane.verifying_key == deriver_b.verifying_key
    {
        return Err(verification_failed(
            "tenant root recovery signer keys are not three distinct keys",
        ));
    }
    Ok(TenantRootRecoveryManifestTrustV1 {
        level: deriver_a.level.clone(),
        keys: TenantRootRecoveryTrustedVerifyingKeysV1 {
            deriver_a: deriver_a.verifying_key,
            deriver_b: deriver_b.verifying_key,
            control_plane: control_plane.verifying_key,
        },
        deriver_a_key_id: deriver_a.key_id,
        deriver_b_key_id: deriver_b.key_id,
        control_plane_key_id: control_plane.key_id,
    })
}

/// Verifies a complete artifact set against pinned roots and then against its own signatures.
pub fn verify_tenant_root_recovery_artifacts_with_trust_v1(
    manifest: &TenantRootRecoveryManifestV1,
    package_a: &TenantRootRecoveryPackageV1,
    package_b: &TenantRootRecoveryPackageV1,
    bundle: &TenantRootRecoveryTrustBundleV1,
    evidence: &TenantRootRecoveryTrustEvidenceV1<'_>,
) -> RouterAbDerivationResult<TenantRootRecoveryManifestTrustV1> {
    let trust = verify_tenant_root_recovery_manifest_trust_v1(manifest, bundle, evidence)?;
    manifest.verify_packages(package_a, package_b, &trust.keys)?;
    Ok(trust)
}

/// Verifies one role package against pinned roots and its signed manifest.
pub fn verify_tenant_root_recovery_role_package_with_trust_v1(
    manifest: &TenantRootRecoveryManifestV1,
    package: &TenantRootRecoveryPackageV1,
    bundle: &TenantRootRecoveryTrustBundleV1,
    evidence: &TenantRootRecoveryTrustEvidenceV1<'_>,
) -> RouterAbDerivationResult<TenantRootRecoveryManifestTrustV1> {
    let trust = verify_tenant_root_recovery_manifest_trust_v1(manifest, bundle, evidence)?;
    manifest.verify_role_package(package, &trust.keys)?;
    Ok(trust)
}

/// Decides whether one trust result admits restore.
///
/// `current_trust_confirmed` is admitted outright. A saved snapshot is admitted
/// only when it was issued at or after the artifact was created, so a snapshot
/// predating the artifact cannot vouch for it. Offline verification needs an
/// explicit destination acknowledgement that revocation status was unavailable.
pub fn tenant_root_recovery_restore_trust_admission_v1(
    level: &TenantRootRecoveryTrustLevelV1,
    artifact_creation_time: &str,
    offline_acknowledgement: Option<&TenantRootRecoveryOfflineTrustAcknowledgementV1>,
) -> RouterAbDerivationResult<()> {
    validate_rfc3339_millis(artifact_creation_time, "artifact creation time")?;
    let created = epoch_millis(artifact_creation_time, "artifact creation time")?;
    match level {
        TenantRootRecoveryTrustLevelV1::CurrentTrustConfirmed { .. } => Ok(()),
        TenantRootRecoveryTrustLevelV1::ValidAtTrustSnapshot {
            snapshot_issued_at, ..
        } => {
            let issued = epoch_millis(snapshot_issued_at, "trust snapshot issuedAt")?;
            if issued < created {
                return Err(verification_failed(
                    "tenant root recovery trust snapshot predates the artifact it must vouch for",
                ));
            }
            Ok(())
        }
        TenantRootRecoveryTrustLevelV1::CryptographicallyValidOffline => {
            let acknowledgement = offline_acknowledgement.ok_or_else(|| {
                verification_failed(
                    "tenant root recovery restore requires an offline-trust acknowledgement",
                )
            })?;
            if acknowledgement.warning_version != TENANT_ROOT_RECOVERY_OFFLINE_TRUST_WARNING_V1 {
                return Err(verification_failed(
                    "tenant root recovery offline-trust acknowledgement version is unsupported",
                ));
            }
            Ok(())
        }
    }
}

fn evaluate_trust_evidence<'a>(
    bundle: &TenantRootRecoveryTrustBundleV1,
    evidence: &TenantRootRecoveryTrustEvidenceV1<'a>,
) -> RouterAbDerivationResult<(
    TenantRootRecoveryTrustLevelV1,
    Option<&'a TenantRootRecoveryRevocationSnapshotV1>,
)> {
    match evidence {
        TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly => Ok((
            TenantRootRecoveryTrustLevelV1::CryptographicallyValidOffline,
            None,
        )),
        TenantRootRecoveryTrustEvidenceV1::TrustSnapshot { snapshot } => {
            snapshot.verify(bundle)?;
            Ok((
                TenantRootRecoveryTrustLevelV1::ValidAtTrustSnapshot {
                    snapshot_version: snapshot.snapshot_version,
                    snapshot_issued_at: snapshot.issued_at.clone(),
                },
                Some(*snapshot),
            ))
        }
        TenantRootRecoveryTrustEvidenceV1::LiveTrustCheck {
            snapshot,
            checked_at,
            max_snapshot_age_ms,
        } => {
            snapshot.verify(bundle)?;
            validate_rfc3339_millis(checked_at, "live trust check time")?;
            let checked = epoch_millis(checked_at, "live trust check time")?;
            let issued = epoch_millis(&snapshot.issued_at, "revocation snapshot issuedAt")?;
            let skew = i64::try_from(TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1)
                .map_err(|_| malformed("clock skew bound is invalid"))?;
            if issued > checked.saturating_add(skew) {
                return Err(verification_failed(
                    "tenant root recovery revocation snapshot is issued after the live check",
                ));
            }
            let max_age = i64::try_from(*max_snapshot_age_ms)
                .map_err(|_| malformed("maximum snapshot age is invalid"))?;
            if checked.saturating_sub(issued) > max_age {
                return Err(verification_failed(
                    "tenant root recovery revocation snapshot is too old to confirm current trust",
                ));
            }
            Ok((
                TenantRootRecoveryTrustLevelV1::CurrentTrustConfirmed {
                    snapshot_version: snapshot.snapshot_version,
                    snapshot_issued_at: snapshot.issued_at.clone(),
                    checked_at: (*checked_at).to_owned(),
                },
                Some(*snapshot),
            ))
        }
    }
}

fn verify_detached(
    verifying_key_bytes: &[u8; 32],
    input: &[u8],
    signature: &[u8; 64],
    message: &'static str,
) -> RouterAbDerivationResult<()> {
    let verifying_key = VerifyingKey::from_bytes(verifying_key_bytes)
        .map_err(|_| malformed("tenant root recovery verifying key is invalid"))?;
    verifying_key
        .verify_strict(input, &Signature::from_bytes(signature))
        .map_err(|_| verification_failed(message))
}

fn validate_key_id(value: &str, field: &'static str) -> RouterAbDerivationResult<()> {
    require_key_id(field, value)?;
    if value.len() > TENANT_ROOT_RECOVERY_TRUST_MAX_KEY_ID_LEN_V1 {
        return Err(malformed_owned(format!("{field} is too long")));
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(malformed_owned(format!(
            "{field} contains characters outside the key-id alphabet"
        )));
    }
    Ok(())
}

fn decode_base64url_vec(value: &str, field: &'static str) -> RouterAbDerivationResult<Vec<u8>> {
    use base64ct::{Base64UrlUnpadded, Encoding};
    let decoded = Base64UrlUnpadded::decode_vec(value)
        .map_err(|_| malformed_owned(format!("{field} is invalid base64url")))?;
    if Base64UrlUnpadded::encode_string(&decoded) != value {
        return Err(malformed_owned(format!(
            "{field} is not canonical base64url"
        )));
    }
    Ok(decoded)
}
