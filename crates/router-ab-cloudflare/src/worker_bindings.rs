//! Environment and secret readers, Worker roles, presign and peer bindings, and HPKE key sets.

use super::*;

pub(super) const SOURCE_PRESERVING_ECDSA_MATERIAL_HANDLE_PREFIX_V1: &str = "source-preserving-ecdsa/";

/// Serializes one Cloudflare Service Binding JSON request body.
pub(crate) fn cloudflare_service_json_request_body_v1<T: Serialize>(
    request_kind: &str,
    request: &T,
) -> RouterAbProtocolResult<String> {
    require_non_empty("Cloudflare service JSON request kind", request_kind)?;
    serde_json::to_string(request).map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{request_kind} serialization failed: {err}"),
        )
    })
}

/// Text-reader boundary used before binding descriptors are constructed.
pub trait CloudflareEnvReaderV1 {
    /// Returns a raw environment value if present.
    fn get_text(&self, key: &str) -> RouterAbProtocolResult<Option<String>>;
}

/// Deterministic map-backed Env reader for tests and local adapter validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareEnvMapV1 {
    pub(super) entries: BTreeMap<String, String>,
}

impl CloudflareEnvMapV1 {
    /// Creates an empty map-backed Env reader.
    pub fn new(entries: Vec<(impl Into<String>, impl Into<String>)>) -> Self {
        let entries = entries
            .into_iter()
            .map(|(key, value)| (key.into(), value.into()))
            .collect();
        Self { entries }
    }

    /// Returns the number of entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Returns the retained key/value entries.
    pub const fn entries(&self) -> &BTreeMap<String, String> {
        &self.entries
    }

    /// Returns whether there are no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Returns a copy with the supplied entries inserted or replaced.
    pub fn with_overrides(mut self, entries: Vec<(impl Into<String>, impl Into<String>)>) -> Self {
        for (key, value) in entries {
            self.entries.insert(key.into(), value.into());
        }
        self
    }
}

impl CloudflareEnvReaderV1 for CloudflareEnvMapV1 {
    fn get_text(&self, key: &str) -> RouterAbProtocolResult<Option<String>> {
        Ok(self.entries.get(key).cloned())
    }
}

/// Secret-reader boundary: resolves a named Secret binding for one operation.
///
/// On Cloudflare this is a Worker Secret binding. A VM role holds its Secrets
/// in its own role-private env file, so the same binding names resolve there.
pub trait CloudflareSecretReaderV1 {
    /// Returns the Secret's text, or an error naming the missing binding.
    fn secret_text(&self, binding_name: &str) -> RouterAbProtocolResult<zeroize::Zeroizing<String>>;
}

impl CloudflareSecretReaderV1 for CloudflareEnvMapV1 {
    fn secret_text(&self, binding_name: &str) -> RouterAbProtocolResult<zeroize::Zeroizing<String>> {
        self.entries
            .get(binding_name)
            .map(|value| zeroize::Zeroizing::new(value.clone()))
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MissingLocalBinding,
                    format!("secret binding {binding_name} is not configured"),
                )
            })
    }
}

/// Cloudflare Worker role in the Router/A/B deployment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudflareWorkerRoleV1 {
    /// Public Router Worker.
    Router,
    /// Deriver A Worker.
    DeriverA,
    /// Deriver B Worker.
    DeriverB,
    /// Dedicated normal-signing worker that owns active SigningWorker output.
    SigningWorker,
    /// Internal tenant-root control-plane Worker.
    ///
    /// Sole holder of the tenant-root issuer private signing key. It validates exact
    /// tenant authorization and authoritative Durable Object lifecycle state,
    /// then constructs and signs canonical one-use commands, capabilities and
    /// receipts. It never receives a scalar, a lane holder share, or Router
    /// authorization configuration, and exposes no raw-payload signing method.
    TenantRootControlPlane,
}

impl CloudflareWorkerRoleV1 {
    /// Returns the stable role label.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Router => "router",
            Self::DeriverA => "deriver_a",
            Self::DeriverB => "deriver_b",
            Self::SigningWorker => "signing_worker",
            Self::TenantRootControlPlane => "tenant_root_control_plane",
        }
    }
}

/// Binding for the one allowed ephemeral presign rendezvous Durable Object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSigningWorkerPresignSessionBindingV1 {
    /// Cloudflare Env binding name.
    pub binding_name: String,
    /// Durable Object object name.
    pub object_name: String,
    /// Prefix for keys within the Durable Object.
    pub(crate) key_prefix: String,
}

impl CloudflareSigningWorkerPresignSessionBindingV1 {
    /// Creates a validated presign-session binding descriptor.
    pub fn new(
        binding_name: impl Into<String>,
        object_name: impl Into<String>,
        key_prefix: impl Into<String>,
    ) -> RouterAbProtocolResult<Self> {
        let binding = Self {
            binding_name: binding_name.into(),
            object_name: object_name.into(),
            key_prefix: key_prefix.into(),
        };
        binding.validate()?;
        Ok(binding)
    }

    /// Validates binding fields.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_non_empty("binding_name", &self.binding_name)?;
        require_non_empty("object_name", &self.object_name)?;
        require_non_empty("key_prefix", &self.key_prefix)
    }
}

/// Service Binding or HTTPS peer descriptor after Cloudflare env parsing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflarePeerBindingV1 {
    /// Peer Worker role.
    pub peer_role: CloudflareWorkerRoleV1,
    /// Cloudflare Service Binding name or configured peer endpoint label.
    pub binding_name: String,
}

impl CloudflarePeerBindingV1 {
    /// Creates a validated peer binding descriptor.
    pub fn new(
        peer_role: CloudflareWorkerRoleV1,
        binding_name: impl Into<String>,
    ) -> RouterAbProtocolResult<Self> {
        let binding = Self {
            peer_role,
            binding_name: binding_name.into(),
        };
        binding.validate()?;
        Ok(binding)
    }

    /// Validates peer binding fields.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_non_empty("binding_name", &self.binding_name)
    }
}

/// Public signer-envelope HPKE key descriptor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSignerEnvelopeHpkePublicKeyV1 {
    /// Signer role that owns this public envelope key.
    pub role: Role,
    /// Public decrypt-key epoch used for transcript and rotation binding.
    pub key_epoch: String,
    /// Canonical `x25519:<64 lowercase hex chars>` public key.
    pub public_key: String,
}

impl CloudflareSignerEnvelopeHpkePublicKeyV1 {
    /// Creates a validated signer-envelope HPKE public-key descriptor.
    pub fn new(
        role: Role,
        key_epoch: impl Into<String>,
        public_key: impl Into<String>,
    ) -> RouterAbProtocolResult<Self> {
        let descriptor = Self {
            role,
            key_epoch: key_epoch.into(),
            public_key: public_key.into(),
        };
        descriptor.validate()?;
        Ok(descriptor)
    }

    /// Validates signer ownership and canonical public-key encoding.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_signer_role(self.role)?;
        require_non_empty("key_epoch", &self.key_epoch)?;
        parse_cloudflare_hpke_x25519_public_key_v1(&self.public_key)?;
        Ok(())
    }
}

/// Public A/B signer-envelope HPKE key set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSignerEnvelopeHpkePublicKeySetV1 {
    /// Deriver A public envelope key descriptor.
    pub deriver_a: CloudflareSignerEnvelopeHpkePublicKeyV1,
    /// Deriver B public envelope key descriptor.
    pub deriver_b: CloudflareSignerEnvelopeHpkePublicKeyV1,
}

impl CloudflareSignerEnvelopeHpkePublicKeySetV1 {
    /// Creates a validated public A/B signer-envelope HPKE key set.
    pub fn new(
        deriver_a: CloudflareSignerEnvelopeHpkePublicKeyV1,
        deriver_b: CloudflareSignerEnvelopeHpkePublicKeyV1,
    ) -> RouterAbProtocolResult<Self> {
        let key_set = Self {
            deriver_a,
            deriver_b,
        };
        key_set.validate()?;
        Ok(key_set)
    }

    /// Validates role assignments and public-key descriptors.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.deriver_a.validate()?;
        self.deriver_b.validate()?;
        if self.deriver_a.role != Role::SignerA {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidRole,
                "Deriver A HPKE public key descriptor must use Deriver A role",
            ));
        }
        if self.deriver_b.role != Role::SignerB {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidRole,
                "Deriver B HPKE public key descriptor must use Deriver B role",
            ));
        }
        Ok(())
    }

    /// Returns the public-key descriptor for one signer role.
    pub(crate) fn for_role(
        &self,
        role: Role,
    ) -> RouterAbProtocolResult<&CloudflareSignerEnvelopeHpkePublicKeyV1> {
        match role {
            Role::SignerA => Ok(&self.deriver_a),
            Role::SignerB => Ok(&self.deriver_b),
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidRole,
                "signer-envelope HPKE public key set supports only signer roles",
            )),
        }
    }
}

/// Public signer-envelope HPKE keyset with optional previous-epoch overlap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSignerEnvelopeHpkeRotationPublicKeySetV1 {
    /// Current signer-envelope public keys used for new client envelopes.
    pub current: CloudflareSignerEnvelopeHpkePublicKeySetV1,
    /// Previous signer-envelope public keys accepted only during overlap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous: Option<CloudflareSignerEnvelopeHpkePublicKeySetV1>,
    /// Millisecond timestamp when the previous keys must stop being accepted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_retire_at_ms: Option<u64>,
}

impl CloudflareSignerEnvelopeHpkeRotationPublicKeySetV1 {
    /// Creates a current-only signer-envelope HPKE keyset.
    pub fn current_only(
        current: CloudflareSignerEnvelopeHpkePublicKeySetV1,
    ) -> RouterAbProtocolResult<Self> {
        let key_set = Self {
            current,
            previous: None,
            previous_retire_at_ms: None,
        };
        key_set.validate()?;
        Ok(key_set)
    }

    /// Creates a signer-envelope HPKE keyset with previous-epoch overlap.
    pub fn current_and_previous(
        current: CloudflareSignerEnvelopeHpkePublicKeySetV1,
        previous: CloudflareSignerEnvelopeHpkePublicKeySetV1,
        previous_retire_at_ms: u64,
    ) -> RouterAbProtocolResult<Self> {
        let key_set = Self {
            current,
            previous: Some(previous),
            previous_retire_at_ms: Some(previous_retire_at_ms),
        };
        key_set.validate()?;
        Ok(key_set)
    }

    /// Validates the current-only or current-plus-previous branch.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.current.validate()?;
        match (&self.previous, self.previous_retire_at_ms) {
            (None, None) => Ok(()),
            (Some(previous), Some(previous_retire_at_ms)) => {
                previous.validate()?;
                if previous_retire_at_ms == 0 {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidTimeRange,
                        "previous signer-envelope HPKE retirement timestamp must be positive",
                    ));
                }
                require_rotated_hpke_descriptor_v1(
                    "deriver_a",
                    &self.current.deriver_a,
                    &previous.deriver_a,
                )?;
                require_rotated_hpke_descriptor_v1(
                    "deriver_b",
                    &self.current.deriver_b,
                    &previous.deriver_b,
                )?;
                Ok(())
            }
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "previous signer-envelope HPKE keyset and retirement timestamp must be provided together",
            )),
        }
    }

    /// Returns the descriptor accepted for a role/key epoch at one wall-clock time.
    pub fn accepted_for_role_epoch(
        &self,
        role: Role,
        key_epoch: &str,
        now_ms: u64,
    ) -> RouterAbProtocolResult<&CloudflareSignerEnvelopeHpkePublicKeyV1> {
        require_non_empty("key_epoch", key_epoch)?;
        let current = self.current.for_role(role)?;
        if current.key_epoch == key_epoch {
            return Ok(current);
        }
        if let (Some(previous), Some(previous_retire_at_ms)) =
            (&self.previous, self.previous_retire_at_ms)
        {
            let previous_for_role = previous.for_role(role)?;
            if previous_for_role.key_epoch == key_epoch {
                if now_ms <= previous_retire_at_ms {
                    return Ok(previous_for_role);
                }
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ExpiredLocalRequest,
                    "previous signer-envelope HPKE key epoch is retired",
                ));
            }
        }
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "signer-envelope HPKE key epoch is not in the current or previous keyset",
        ))
    }
}

pub(super) fn require_rotated_hpke_descriptor_v1(
    label: &str,
    current: &CloudflareSignerEnvelopeHpkePublicKeyV1,
    previous: &CloudflareSignerEnvelopeHpkePublicKeyV1,
) -> RouterAbProtocolResult<()> {
    if current.role != previous.role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            format!("{label} previous signer-envelope HPKE role does not match current role"),
        ));
    }
    if current.key_epoch == previous.key_epoch {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} previous signer-envelope HPKE key epoch must differ from current"),
        ));
    }
    if current.public_key == previous.public_key {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} previous signer-envelope HPKE public key must differ from current"),
        ));
    }
    Ok(())
}

/// Role-local signer-envelope HPKE private-key binding descriptor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1 {
    /// Signer role that owns this envelope decrypt key.
    pub role: Role,
    /// Cloudflare Secret binding name that contains the HPKE private key.
    pub binding_name: String,
    /// Public decrypt-key epoch used for transcript and rotation binding.
    pub key_epoch: String,
    /// Public key paired with the private binding.
    pub public_key: String,
}

impl CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1 {
    /// Creates a validated signer-envelope HPKE decrypt-key descriptor.
    pub fn new(
        role: Role,
        binding_name: impl Into<String>,
        key_epoch: impl Into<String>,
        public_key: impl Into<String>,
    ) -> RouterAbProtocolResult<Self> {
        let binding = Self {
            role,
            binding_name: binding_name.into(),
            key_epoch: key_epoch.into(),
            public_key: public_key.into(),
        };
        binding.validate()?;
        Ok(binding)
    }

    /// Validates key ownership, binding name, and public descriptor fields.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_signer_role(self.role)?;
        require_non_empty("binding_name", &self.binding_name)?;
        require_non_empty("key_epoch", &self.key_epoch)?;
        parse_cloudflare_hpke_x25519_public_key_v1(&self.public_key)?;
        Ok(())
    }

    /// Returns the public descriptor corresponding to this private binding.
    pub(crate) fn public_descriptor(
        &self,
    ) -> RouterAbProtocolResult<CloudflareSignerEnvelopeHpkePublicKeyV1> {
        CloudflareSignerEnvelopeHpkePublicKeyV1::new(
            self.role,
            self.key_epoch.clone(),
            self.public_key.clone(),
        )
    }

    /// Validates this key descriptor is visible to the given Worker role.
    pub fn validate_visible_to(
        &self,
        worker_role: CloudflareWorkerRoleV1,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        let visible = matches!(
            (worker_role, self.role),
            (CloudflareWorkerRoleV1::DeriverA, Role::SignerA)
                | (CloudflareWorkerRoleV1::DeriverB, Role::SignerB)
        );
        if visible {
            return Ok(());
        }
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            format!(
                "{} Worker cannot access {:?} signer-envelope HPKE decrypt key",
                worker_role.as_str(),
                self.role
            ),
        ))
    }
}

/// Role-local signer-envelope HPKE private-key rotation set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1 {
    /// Key used for newly sealed signer envelopes.
    pub current: CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1,
    /// Temporarily accepted previous key during rotation overlap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous: Option<CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1>,
    /// Last timestamp at which the previous key is accepted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_retire_at_ms: Option<u64>,
}

impl From<CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1>
    for CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1
{
    fn from(current: CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1) -> Self {
        Self {
            current,
            previous: None,
            previous_retire_at_ms: None,
        }
    }
}

impl CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1 {
    /// Creates a current-only HPKE decrypt-key set.
    pub fn current_only(
        current: CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1,
    ) -> RouterAbProtocolResult<Self> {
        let set = Self {
            current,
            previous: None,
            previous_retire_at_ms: None,
        };
        set.validate()?;
        Ok(set)
    }

    /// Creates a rotating HPKE decrypt-key set with an accepted previous key.
    pub fn current_and_previous(
        current: CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1,
        previous: CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1,
        previous_retire_at_ms: u64,
    ) -> RouterAbProtocolResult<Self> {
        let set = Self {
            current,
            previous: Some(previous),
            previous_retire_at_ms: Some(previous_retire_at_ms),
        };
        set.validate()?;
        Ok(set)
    }

    /// Validates role-local rotation shape and key separation.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.current.validate()?;
        match (&self.previous, self.previous_retire_at_ms) {
            (None, None) => Ok(()),
            (Some(previous), Some(retire_at_ms)) => {
                previous.validate()?;
                require_positive_ms(
                    "previous signer-envelope HPKE private-key retire_at_ms",
                    retire_at_ms,
                )?;
                let current = self.current.public_descriptor()?;
                let previous_public = previous.public_descriptor()?;
                require_rotated_hpke_descriptor_v1(
                    "private signer-envelope HPKE",
                    &current,
                    &previous_public,
                )?;
                if self.current.binding_name == previous.binding_name {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                        "previous signer-envelope HPKE private-key binding must differ from current",
                    ));
                }
                Ok(())
            }
            (None, Some(_)) | (Some(_), None) => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "previous signer-envelope HPKE private-key binding and retire timestamp must be configured together",
            )),
        }
    }

    /// Validates this key set is visible to the given Worker role.
    pub fn validate_visible_to(
        &self,
        worker_role: CloudflareWorkerRoleV1,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        self.current.validate_visible_to(worker_role)?;
        if let Some(previous) = &self.previous {
            previous.validate_visible_to(worker_role)?;
        }
        Ok(())
    }

    /// Selects the decrypt key bound by a signer-envelope HPKE payload.
    pub fn accepted_binding_for_payload(
        &self,
        worker_role: CloudflareWorkerRoleV1,
        payload: &SignerEnvelopeHpkePayloadV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<&CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1> {
        self.validate_visible_to(worker_role)?;
        require_positive_ms("signer-envelope HPKE rotation now_unix_ms", now_unix_ms)?;
        payload.validate()?;
        let expected_role = cloudflare_worker_signer_role_v1(worker_role)?;
        if payload.recipient_role != expected_role {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidRole,
                "signer-envelope HPKE payload recipient does not match Worker role",
            ));
        }
        if signer_envelope_hpke_payload_matches_binding_v1(payload, &self.current) {
            return Ok(&self.current);
        }
        if let (Some(previous), Some(retire_at_ms)) = (&self.previous, self.previous_retire_at_ms) {
            if signer_envelope_hpke_payload_matches_binding_v1(payload, previous) {
                if now_unix_ms > retire_at_ms {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::ExpiredLocalRequest,
                        "previous signer-envelope HPKE key is retired",
                    ));
                }
                return Ok(previous);
            }
        }
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidSignerIdentity,
            "signer-envelope HPKE payload key is not in the current or previous private keyset",
        ))
    }
}

pub(super) fn signer_envelope_hpke_payload_matches_binding_v1(
    payload: &SignerEnvelopeHpkePayloadV1,
    binding: &CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1,
) -> bool {
    payload.recipient_role == binding.role
        && payload.key_epoch == binding.key_epoch
        && payload.recipient_public_key == binding.public_key
}

/// SigningWorker server-output HPKE decrypt-key binding descriptor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareServerOutputHpkeDecryptKeyBindingV1 {
    /// Cloudflare Secret binding name that contains the server-output HPKE private key.
    pub binding_name: String,
    /// Public decrypt-key epoch used for server-output rotation binding.
    pub key_epoch: String,
    /// Public key paired with the private binding.
    pub public_key: String,
}

impl CloudflareServerOutputHpkeDecryptKeyBindingV1 {
    /// Creates a validated server-output HPKE decrypt-key descriptor.
    pub fn new(
        binding_name: impl Into<String>,
        key_epoch: impl Into<String>,
        public_key: impl Into<String>,
    ) -> RouterAbProtocolResult<Self> {
        let binding = Self {
            binding_name: binding_name.into(),
            key_epoch: key_epoch.into(),
            public_key: public_key.into(),
        };
        binding.validate()?;
        Ok(binding)
    }

    /// Validates binding name and public descriptor fields.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_non_empty("binding_name", &self.binding_name)?;
        require_non_empty("key_epoch", &self.key_epoch)?;
        parse_cloudflare_hpke_x25519_public_key_v1(&self.public_key)?;
        Ok(())
    }

    /// Validates this key descriptor is visible to the given Worker role.
    pub fn validate_visible_to(
        &self,
        worker_role: CloudflareWorkerRoleV1,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        if worker_role == CloudflareWorkerRoleV1::SigningWorker {
            return Ok(());
        }
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            format!(
                "{} Worker cannot access server-output HPKE decrypt key",
                worker_role.as_str()
            ),
        ))
    }

    /// Validates this decrypt key matches the selected server identity.
    pub(crate) fn validate_matches_server(&self, server: &ServerIdentityV1) -> RouterAbProtocolResult<()> {
        self.validate()?;
        server.validate()?;
        if self.key_epoch == server.key_epoch && self.public_key == server.recipient_encryption_key
        {
            return Ok(());
        }
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "server-output HPKE decrypt key does not match selected server",
        ))
    }
}

/// Public HPKE key descriptor for Router A/B discovery responses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflarePublicHpkeKeyDescriptorV1 {
    /// Public decrypt-key epoch used for rotation binding.
    pub key_epoch: String,
    /// Canonical `x25519:<64 lowercase hex chars>` public key.
    pub public_key: String,
}

impl CloudflarePublicHpkeKeyDescriptorV1 {
    /// Creates a validated public HPKE key descriptor.
    pub fn new(
        key_epoch: impl Into<String>,
        public_key: impl Into<String>,
    ) -> RouterAbProtocolResult<Self> {
        let descriptor = Self {
            key_epoch: key_epoch.into(),
            public_key: public_key.into(),
        };
        descriptor.validate()?;
        Ok(descriptor)
    }

    /// Validates the public key epoch and canonical HPKE key encoding.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_non_empty("key_epoch", &self.key_epoch)?;
        parse_cloudflare_hpke_x25519_public_key_v1(&self.public_key)?;
        Ok(())
    }
}
