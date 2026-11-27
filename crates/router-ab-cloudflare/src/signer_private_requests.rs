//! Validation of signer private requests, tenant-root scope wire, Deriver private request types and the preload plan.

use super::*;

/// Validates a private Router-to-signer message for the target Worker role.
pub fn validate_cloudflare_signer_private_request_v1(
    worker_role: CloudflareWorkerRoleV1,
    message: &WireMessageV1,
) -> RouterAbProtocolResult<()> {
    let expected = expected_signer_private_request_kind_v1(worker_role)?;
    if message.kind != expected {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalRoute,
            format!(
                "{} private signer endpoint expected {} message, received {}",
                worker_role.as_str(),
                expected.as_str(),
                message.kind.as_str()
            ),
        ));
    }
    let payload = decode_router_to_signer_payload_v1(message.payload.as_bytes())?;
    if payload.transcript_digest() != message.transcript_digest {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "private signer request payload transcript digest does not match wire message",
        ));
    }
    match (worker_role, payload) {
        (CloudflareWorkerRoleV1::DeriverA, RouterToSignerPayloadV1::SignerA { .. })
        | (CloudflareWorkerRoleV1::DeriverB, RouterToSignerPayloadV1::SignerB { .. }) => Ok(()),
        (CloudflareWorkerRoleV1::DeriverA | CloudflareWorkerRoleV1::DeriverB, _) => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidRole,
                "private signer request payload branch does not match Worker role",
            ))
        }
        (
            CloudflareWorkerRoleV1::Router
            | CloudflareWorkerRoleV1::SigningWorker
            | CloudflareWorkerRoleV1::TenantRootControlPlane,
            _,
        ) => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "this Worker has no private signer payload branch",
        )),
    }
}

/// Decodes and validates public signer-envelope HPKE metadata before decryption.
pub fn decode_and_validate_cloudflare_signer_envelope_hpke_payload_v1(
    worker_role: CloudflareWorkerRoleV1,
    message: &WireMessageV1,
    envelope_decrypt_key: &CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1,
) -> RouterAbProtocolResult<SignerEnvelopeHpkePayloadV1> {
    validate_cloudflare_signer_private_request_v1(worker_role, message)?;
    envelope_decrypt_key.validate_visible_to(worker_role)?;
    let expected_role = cloudflare_worker_signer_role_v1(worker_role)?;
    if envelope_decrypt_key.role != expected_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "Cloudflare signer HPKE envelope key role does not match Worker role",
        ));
    }
    let payload = decode_router_to_signer_payload_v1(message.payload.as_bytes())?;
    let envelope = &payload.assignment().envelope;
    decode_and_validate_signer_envelope_hpke_payload_v1(
        envelope,
        &envelope_decrypt_key.key_epoch,
        &envelope_decrypt_key.public_key,
    )
}

/// Decodes signer-envelope HPKE metadata and selects the accepted private key.
pub fn decode_and_select_cloudflare_signer_envelope_hpke_decrypt_key_binding_v1<'a>(
    worker_role: CloudflareWorkerRoleV1,
    message: &WireMessageV1,
    envelope_decrypt_keys: &'a CloudflareSignerEnvelopeHpkeDecryptKeyBindingSetV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<(
    &'a CloudflareSignerEnvelopeHpkeDecryptKeyBindingV1,
    SignerEnvelopeHpkePayloadV1,
)> {
    validate_cloudflare_signer_private_request_v1(worker_role, message)?;
    envelope_decrypt_keys.validate_visible_to(worker_role)?;
    let payload = decode_router_to_signer_payload_v1(message.payload.as_bytes())?;
    let envelope = &payload.assignment().envelope;
    let hpke_payload = decode_signer_envelope_hpke_payload_v1(envelope.ciphertext.as_bytes())?;
    let binding = envelope_decrypt_keys.accepted_binding_for_payload(
        worker_role,
        &hpke_payload,
        now_unix_ms,
    )?;
    hpke_payload.validate_for_envelope(envelope, &binding.key_epoch, &binding.public_key)?;
    Ok((binding, hpke_payload))
}

/// Parses the exact Gateway-to-Router registration envelope.
///
/// The browser request remains the nested `registration_request`; tenant-root
/// coordinates are supplied by the authenticated server boundary and are
/// converted to typed identifiers before any Router admission work starts.
pub(crate) fn parse_cloudflare_router_ab_ecdsa_derivation_registration_gateway_request_v1(
    bytes: &[u8],
) -> RouterAbProtocolResult<(
    RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    TenantRootIdentityDigestV1,
    TenantRootCustodyLineageId,
)> {
    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct GatewayRequest {
        registration_request: RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
        tenant_root: CloudflareTenantRootCoordinatesV1,
    }

    let parsed = serde_json::from_slice::<GatewayRequest>(bytes).map_err(|err| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!(
                "Router A/B ECDSA derivation registration Gateway envelope parse failed: {err}"
            ),
        )
    })?;
    parsed.registration_request.validate()?;
    let (identity_digest, custody_lineage) = parsed.tenant_root.resolve()?;
    Ok((
        parsed.registration_request,
        identity_digest,
        custody_lineage,
    ))
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_tenant_root_deriver_identities_v1(
    env: &worker::Env,
) -> RouterAbProtocolResult<TenantRootDeriverIdentitiesV1> {
    let reader = CloudflareWorkerEnvReaderV1::new(env);
    parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(&reader)?.deriver_identities()
}

pub(super) fn derive_cloudflare_tenant_root_registration_scope_v1(
    registration_request: &RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
) -> RouterAbProtocolResult<(
    TenantRootDerivationOperationIdV1,
    TenantRootDerivationSessionIdV1,
    TenantRootDerivationNonceV1,
)> {
    let request_digest = registration_request.request_digest()?;
    derive_cloudflare_tenant_root_ecdsa_scope_v1(
        request_digest,
        b"seams/router-ab-ecdsa-registration/operation/v1",
        b"seams/router-ab-ecdsa-registration/session/v1",
        b"seams/router-ab-ecdsa-registration/nonce/v1",
    )
}

pub(super) fn derive_cloudflare_tenant_root_ecdsa_scope_v1(
    request_digest: PublicDigest32,
    operation_domain: &[u8],
    session_domain: &[u8],
    nonce_domain: &[u8],
) -> RouterAbProtocolResult<(
    TenantRootDerivationOperationIdV1,
    TenantRootDerivationSessionIdV1,
    TenantRootDerivationNonceV1,
)> {
    let derive = |domain: &[u8]| {
        let mut hasher = Sha256::new();
        hasher.update(domain);
        hasher.update(request_digest.as_bytes());
        let mut bytes: [u8; 32] = hasher.finalize().into();
        if bytes.iter().all(|byte| *byte == 0) {
            bytes[0] = 1;
        }
        bytes
    };
    let operation_bytes = derive(operation_domain);
    let operation_id = TenantRootDerivationOperationIdV1::from_bytes(
        operation_bytes[..16]
            .try_into()
            .expect("fixed operation id length"),
    )
    .map_err(map_root_share_to_protocol)?;
    let session_bytes = derive(session_domain);
    let session_id = TenantRootDerivationSessionIdV1::from_bytes(
        session_bytes[..16]
            .try_into()
            .expect("fixed session id length"),
    )
    .map_err(map_root_share_to_protocol)?;
    let nonce = TenantRootDerivationNonceV1::from_bytes(derive(nonce_domain))
        .map_err(map_root_share_to_protocol)?;
    Ok((operation_id, session_id, nonce))
}

pub(super) fn derive_cloudflare_tenant_root_export_scope_v1(
    export_request: &RouterAbEcdsaDerivationExplicitExportRequestV1,
) -> RouterAbProtocolResult<(
    TenantRootDerivationOperationIdV1,
    TenantRootDerivationSessionIdV1,
    TenantRootDerivationNonceV1,
)> {
    derive_cloudflare_tenant_root_ecdsa_scope_v1(
        export_request.request_digest()?,
        b"seams/router-ab-ecdsa-export/operation/v1",
        b"seams/router-ab-ecdsa-export/session/v1",
        b"seams/router-ab-ecdsa-export/nonce/v1",
    )
}

#[cfg(feature = "workers-rs")]
pub(super) fn derive_cloudflare_tenant_root_refresh_scope_v1(
    refresh_request: &RouterAbEcdsaDerivationActivationRefreshRequestV1,
) -> RouterAbProtocolResult<(
    TenantRootDerivationOperationIdV1,
    TenantRootDerivationSessionIdV1,
    TenantRootDerivationNonceV1,
)> {
    derive_cloudflare_tenant_root_ecdsa_scope_v1(
        refresh_request.request_digest()?,
        b"seams/router-ab-ecdsa-refresh/operation/v1",
        b"seams/router-ab-ecdsa-refresh/session/v1",
        b"seams/router-ab-ecdsa-refresh/nonce/v1",
    )
}

pub(crate) fn cloudflare_tenant_root_registration_binding_wire_v1(
    registration_request: &RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    registration_purpose: RouterAbEcdsaDerivationRegistrationPurposeV1,
    activation_receipt: &VerifiedTenantRootSignedActivationReceiptV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCustodyBindingWireV1> {
    registration_request.validate_for_registration_purpose(registration_purpose)?;
    let (operation_id, session_id, nonce) =
        derive_cloudflare_tenant_root_registration_scope_v1(registration_request)?;
    let expires_at_ms = registration_request.expires_at_ms;
    let issued_at_ms = expires_at_ms
        .saturating_sub(TENANT_ROOT_MAX_LIFETIME_MS_V1)
        .max(1);
    CloudflareTenantRootCustodyBindingWireV1::from_verified_activation_receipt(
        activation_receipt,
        operation_id,
        session_id,
        nonce,
        issued_at_ms,
        expires_at_ms,
    )
}

pub(super) fn cloudflare_tenant_root_export_binding_wire_v1(
    export_request: &RouterAbEcdsaDerivationExplicitExportRequestV1,
    activation_receipt: &VerifiedTenantRootSignedActivationReceiptV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCustodyBindingWireV1> {
    export_request.validate()?;
    let (operation_id, session_id, nonce) =
        derive_cloudflare_tenant_root_export_scope_v1(export_request)?;
    let issued_at_ms = export_request
        .expires_at_ms
        .saturating_sub(TENANT_ROOT_MAX_LIFETIME_MS_V1)
        .max(1);
    CloudflareTenantRootCustodyBindingWireV1::from_verified_activation_receipt(
        activation_receipt,
        operation_id,
        session_id,
        nonce,
        issued_at_ms,
        export_request.expires_at_ms,
    )
}

#[cfg(feature = "workers-rs")]
pub(super) fn cloudflare_tenant_root_refresh_binding_wire_v1(
    refresh_request: &RouterAbEcdsaDerivationActivationRefreshRequestV1,
    activation_receipt: &VerifiedTenantRootSignedActivationReceiptV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCustodyBindingWireV1> {
    refresh_request.validate()?;
    let (operation_id, session_id, nonce) =
        derive_cloudflare_tenant_root_refresh_scope_v1(refresh_request)?;
    let issued_at_ms = refresh_request
        .expires_at_ms
        .saturating_sub(TENANT_ROOT_MAX_LIFETIME_MS_V1)
        .max(1);
    CloudflareTenantRootCustodyBindingWireV1::from_verified_activation_receipt(
        activation_receipt,
        operation_id,
        session_id,
        nonce,
        issued_at_ms,
        refresh_request.expires_at_ms,
    )
}

#[cfg(feature = "workers-rs")]
pub(crate) fn cloudflare_tenant_root_ed25519_yao_binding_v2(
    env: &worker::Env,
    pair_binding: &Ed25519YaoInputPairBindingV1,
    activation_receipt: &VerifiedTenantRootSignedActivationReceiptV1,
    issued_at_ms: u64,
    expires_at_ms: u64,
) -> RouterAbProtocolResult<(
    CloudflareTenantRootCustodyBindingWireV1,
    Ed25519YaoOuterBindingV2,
)> {
    pair_binding.validate()?;
    let pair_digest = pair_binding.pair_digest();
    let operation_bytes = derive_ed25519_yao_tenant_root_scope_bytes_v2(
        b"seams/ed25519-yao/tenant-root-operation/v2",
        pair_digest.as_bytes(),
    );
    let session_bytes = derive_ed25519_yao_tenant_root_scope_bytes_v2(
        b"seams/ed25519-yao/tenant-root-session/v2",
        pair_digest.as_bytes(),
    );
    let nonce_bytes = derive_ed25519_yao_tenant_root_scope_bytes_v2(
        b"seams/ed25519-yao/tenant-root-nonce/v2",
        pair_digest.as_bytes(),
    );
    let mut operation_id_bytes = [0_u8; 16];
    operation_id_bytes.copy_from_slice(&operation_bytes[..16]);
    let operation_id = TenantRootDerivationOperationIdV1::from_bytes(operation_id_bytes)
        .map_err(map_root_share_to_protocol)?;
    let mut session_id_bytes = [0_u8; 16];
    session_id_bytes.copy_from_slice(&session_bytes[..16]);
    let session_id = TenantRootDerivationSessionIdV1::from_bytes(session_id_bytes)
        .map_err(map_root_share_to_protocol)?;
    let nonce =
        TenantRootDerivationNonceV1::from_bytes(nonce_bytes).map_err(map_root_share_to_protocol)?;
    let wire = CloudflareTenantRootCustodyBindingWireV1::from_verified_activation_receipt(
        activation_receipt,
        operation_id,
        session_id,
        nonce,
        issued_at_ms,
        expires_at_ms,
    )?;
    let custody_binding =
        TenantRootCustodyBindingV1::from_verified_activation_receipt_with_stable_context_digest(
            activation_receipt,
            cloudflare_tenant_root_deriver_identities_v1(env)?,
            operation_id,
            session_id,
            nonce,
            issued_at_ms,
            expires_at_ms,
            TenantRootProtocolDigestV1::from_bytes(
                pair_binding
                    .binding()
                    .stable_key_context_binding
                    .into_bytes(),
            )
            .map_err(map_root_share_to_protocol)?,
            TenantRootProtocolDigestV1::from_bytes(*pair_digest.as_bytes())
                .map_err(map_root_share_to_protocol)?,
        )
        .map_err(map_root_share_to_protocol)?;
    let custody_digest = custody_binding
        .digest()
        .map_err(map_root_share_to_protocol)?;
    let outer_nonce_digest = derive_ed25519_yao_tenant_root_scope_bytes_v2(
        b"seams/ed25519-yao/outer-nonce/v2",
        custody_digest.as_bytes(),
    );
    let mut outer_nonce = [0_u8; 16];
    outer_nonce.copy_from_slice(&outer_nonce_digest[..16]);
    let outer_binding = Ed25519YaoOuterBindingV2::new(
        Ed25519YaoPairSessionIdV2::new(pair_binding.session())?,
        pair_binding.binding().stable_key_context_binding,
        PublicDigest32::new(*custody_digest.as_bytes()),
        outer_nonce,
        issued_at_ms,
        expires_at_ms,
    )?;
    Ok((wire, outer_binding))
}

#[cfg(feature = "workers-rs")]
pub(super) fn derive_ed25519_yao_tenant_root_scope_bytes_v2(domain: &[u8], transcript: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(transcript);
    hasher.finalize().into()
}

/// Typed server-only bootstrap after custody-binding comparison.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareAuthenticatedSignerPrivateBootstrapRequestV1 {
    /// Existing validated signer bootstrap body.
    pub bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
    /// Authenticated tenant-root custody binding selected by the server boundary.
    pub tenant_root_custody_binding: TenantRootCustodyBindingV1,
}

impl CloudflareAuthenticatedSignerPrivateBootstrapRequestV1 {
    /// Creates a typed bootstrap from an already validated server binding.
    pub fn new(
        worker_role: CloudflareWorkerRoleV1,
        bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
        tenant_root_custody_binding: TenantRootCustodyBindingV1,
    ) -> RouterAbProtocolResult<Self> {
        bootstrap.validate_for_worker_role(worker_role)?;
        tenant_root_custody_binding
            .validate()
            .map_err(map_root_share_to_protocol)?;
        Ok(Self {
            bootstrap,
            tenant_root_custody_binding,
        })
    }

    /// Returns the authenticated binding for the active tenant-root lookup.
    pub const fn tenant_root_custody_binding(&self) -> &TenantRootCustodyBindingV1 {
        &self.tenant_root_custody_binding
    }
}

/// Strict private signer bootstrap body supplied by Router before envelope decryption.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSignerPrivateBootstrapRequestV1 {
    /// Router-to-signer private wire message.
    pub message: WireMessageV1,
    /// Typed role-envelope AAD used by Router during signer-envelope encryption.
    pub aad: RoleEnvelopeAadV1,
    /// Pre-envelope public request-context digest bound inside signer plaintext.
    pub router_request_digest: PublicDigest32,
}

impl CloudflareSignerPrivateBootstrapRequestV1 {
    /// Creates a validated strict private signer bootstrap body.
    pub fn new(
        worker_role: CloudflareWorkerRoleV1,
        message: WireMessageV1,
        aad: RoleEnvelopeAadV1,
        router_request_digest: PublicDigest32,
    ) -> RouterAbProtocolResult<Self> {
        let bootstrap = Self {
            message,
            aad,
            router_request_digest,
        };
        bootstrap.validate_for_worker_role(worker_role)?;
        Ok(bootstrap)
    }

    /// Validates that the typed AAD matches the role-local Router payload.
    pub fn validate_for_worker_role(
        &self,
        worker_role: CloudflareWorkerRoleV1,
    ) -> RouterAbProtocolResult<()> {
        validate_cloudflare_signer_private_request_v1(worker_role, &self.message)?;
        self.aad.validate()?;
        let payload = decode_router_to_signer_payload_v1(self.message.payload.as_bytes())?;
        let assignment = payload.assignment();
        if self.aad.digest() != assignment.envelope.aad_digest {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "strict signer bootstrap AAD digest does not match role envelope",
            ));
        }
        if self.aad.recipient != assignment.signer {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidSignerIdentity,
                "strict signer bootstrap AAD recipient does not match assignment signer",
            ));
        }
        if self.aad.signer_set_id != payload.signer_set().signer_set_id {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidSignerIdentity,
                "strict signer bootstrap AAD signer-set id does not match payload",
            ));
        }
        if self.aad.selected_server != payload.signer_set().selected_server {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidSignerIdentity,
                "strict signer bootstrap AAD server does not match signer set",
            ));
        }
        if self.aad.lifecycle_id != payload.lifecycle().lifecycle_id
            || self.aad.work_kind != payload.lifecycle().work_kind
            || self.aad.primitive_request_kind != payload.lifecycle().primitive_request_kind
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "strict signer bootstrap AAD lifecycle scope does not match payload",
            ));
        }
        if self.aad.transcript_digest != payload.transcript_digest() {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "strict signer bootstrap AAD transcript digest does not match payload",
            ));
        }
        if self.aad.router_request_digest != self.router_request_digest {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "strict signer bootstrap AAD Router request digest does not match body",
            ));
        }
        Ok(())
    }
}

/// Exact public tenant-root proof and Router-generated operation scope carried
/// over the private Router-to-Deriver registration hop.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootCustodyBindingWireV1 {
    /// Canonical issuer-signed active-activation receipt bytes.
    pub activation_receipt_b64u: String,
    /// Router-generated derivation operation identifier.
    pub operation_id: TenantRootDerivationOperationIdV1,
    /// Router-generated one-use session identifier.
    pub session_id: TenantRootDerivationSessionIdV1,
    /// Router-generated replay nonce.
    pub nonce: TenantRootDerivationNonceV1,
    /// Router issue time for this private binding.
    pub issued_at_ms: u64,
    /// Router expiry time for this private binding.
    pub expires_at_ms: u64,
}

impl CloudflareTenantRootCustodyBindingWireV1 {
    /// Builds the exact wire from the Router's issuer-verified active receipt.
    pub fn from_verified_activation_receipt(
        activation_receipt: &VerifiedTenantRootSignedActivationReceiptV1,
        operation_id: TenantRootDerivationOperationIdV1,
        session_id: TenantRootDerivationSessionIdV1,
        nonce: TenantRootDerivationNonceV1,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> RouterAbProtocolResult<Self> {
        let wire = Self {
            activation_receipt_b64u: encode_base64url_bytes_v1(
                activation_receipt.canonical_bytes(),
            ),
            operation_id,
            session_id,
            nonce,
            issued_at_ms,
            expires_at_ms,
        };
        wire.validate()?;
        Ok(wire)
    }

    /// Validates exact receipt encoding and the Router-issued time window.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.validate_transport()?;
        let receipt_bytes = self.activation_receipt_bytes()?;
        TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes).map_err(
            |error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    format!("tenant-root activation receipt wire is invalid: {error}"),
                )
            },
        )?;
        Ok(())
    }

    pub(super) fn validate_transport(&self) -> RouterAbProtocolResult<()> {
        self.activation_receipt_bytes()?;
        if self.issued_at_ms == 0 || self.expires_at_ms <= self.issued_at_ms {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "tenant-root private binding expiry must follow a non-zero issue time",
            ));
        }
        if self.expires_at_ms - self.issued_at_ms > TENANT_ROOT_MAX_LIFETIME_MS_V1 {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "tenant-root private binding lifetime exceeds the frozen maximum window",
            ));
        }
        Ok(())
    }

    /// Returns the canonical activation receipt bytes after validating the wire.
    pub fn activation_receipt_bytes(&self) -> RouterAbProtocolResult<Vec<u8>> {
        let bytes = decode_base64url_bytes_v1(
            "tenant-root activation receipt",
            &self.activation_receipt_b64u,
        )?;
        if bytes.len() > TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1 {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "tenant-root activation receipt exceeds the accepted wire size",
            ));
        }
        if encode_base64url_bytes_v1(&bytes) != self.activation_receipt_b64u {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "tenant-root activation receipt is not canonical base64url",
            ));
        }
        Ok(bytes)
    }

    pub(super) fn verify_activation_receipt(
        &self,
        trusted_issuer_keys: &CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    ) -> RouterAbProtocolResult<VerifiedTenantRootSignedActivationReceiptV1> {
        let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(
            &self.activation_receipt_bytes()?,
        )
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("tenant-root activation receipt wire is invalid: {error}"),
            )
        })?;
        let issuer_key = trusted_issuer_keys
            .for_issuer_key_id(receipt.issuer_key_id())
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                    "tenant-root activation receipt issuer is not trusted by this Deriver",
                )
            })?;
        receipt
            .verify_issuer_signature(issuer_key)
            .map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                    format!(
                        "tenant-root activation receipt signature verification failed: {error}"
                    ),
                )
            })
    }

    pub(super) fn authenticate_for_registration(
        &self,
        env: &impl CloudflareEnvReaderV1,
        registration_request: &RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<TenantRootCustodyBindingV1> {
        registration_request.validate_at(now_unix_ms)?;
        self.authenticate_for_stable_request(
            env,
            &registration_request.to_threshold_prf_request()?,
            now_unix_ms,
        )
    }

    pub(super) fn authenticate_for_export(
        &self,
        env: &impl CloudflareEnvReaderV1,
        export_request: &RouterAbEcdsaDerivationExplicitExportRequestV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<TenantRootCustodyBindingV1> {
        export_request.validate_at(now_unix_ms)?;
        self.authenticate_for_stable_request(
            env,
            &export_request.to_threshold_prf_request()?,
            now_unix_ms,
        )
    }

    #[cfg(feature = "workers-rs")]
    pub(super) fn authenticate_for_refresh(
        &self,
        env: &impl CloudflareEnvReaderV1,
        refresh_request: &RouterAbEcdsaDerivationActivationRefreshRequestV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<TenantRootCustodyBindingV1> {
        refresh_request.validate_at(now_unix_ms)?;
        self.authenticate_for_stable_request(
            env,
            &refresh_request.to_threshold_prf_request()?,
            now_unix_ms,
        )
    }

    /// Authenticates this custody binding for one Ed25519 Yao pair against
    /// the trusted issuer keys and Deriver identities in `env`.
    pub(crate) fn authenticate_for_ed25519_yao_v1(
        &self,
        env: &impl CloudflareEnvReaderV1,
        pair_binding: &router_ab_core::Ed25519YaoInputPairBindingV1,
        application: &router_ab_core::RouterAbEd25519YaoApplicationBindingFactsV1,
        participant_ids: [u16; 2],
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<TenantRootCustodyBindingV1> {
        self.validate()?;
        pair_binding.validate()?;
        let stable_context =
            router_ab_ed25519_yao::stable_key_derivation_context_v1(application, participant_ids)
                .map_err(|error| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    format!("Ed25519 Yao stable context is invalid: {error}"),
                )
            })?;
        if stable_context.binding_digest()
            != pair_binding
                .binding()
                .stable_key_context_binding
                .into_bytes()
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Ed25519 Yao stable context does not match the admitted pair",
            ));
        }
        let issuer_keys = parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(env)?;
        let activation_receipt = self.verify_activation_receipt(&issuer_keys)?;
        let stable_context_digest =
            TenantRootProtocolDigestV1::from_bytes(stable_context.binding_digest())
                .map_err(map_root_share_to_protocol)?;
        let outer_transcript_digest =
            TenantRootProtocolDigestV1::from_bytes(pair_binding.pair_digest().bytes)
                .map_err(map_root_share_to_protocol)?;
        let binding =
            TenantRootCustodyBindingV1::from_verified_activation_receipt_with_stable_context_digest(
                &activation_receipt,
                parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(env)?
                    .deriver_identities()?,
                self.operation_id,
                self.session_id,
                self.nonce,
                self.issued_at_ms,
                self.expires_at_ms,
                stable_context_digest,
                outer_transcript_digest,
            )
            .map_err(map_root_share_to_protocol)?;
        binding
            .validate_at(now_unix_ms)
            .map_err(map_root_share_to_protocol)?;
        Ok(binding)
    }

    pub(super) fn authenticate_for_stable_request(
        &self,
        env: &impl CloudflareEnvReaderV1,
        public_request: &EcdsaThresholdPrfRequestV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<TenantRootCustodyBindingV1> {
        self.validate()?;
        public_request.validate_at(now_unix_ms)?;
        let issuer_keys = parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(env)?;
        let activation_receipt = self.verify_activation_receipt(&issuer_keys)?;
        let stable_context = public_request.stable_tenant_derivation_context()?;
        let transcript_digest = public_request.derivation_transcript_digest()?;
        let outer_transcript_digest =
            TenantRootProtocolDigestV1::from_bytes(*transcript_digest.as_bytes())
                .map_err(map_root_share_to_protocol)?;
        let binding = TenantRootCustodyBindingV1::from_verified_activation_receipt(
            &activation_receipt,
            parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(env)?
                .deriver_identities()?,
            self.operation_id,
            self.session_id,
            self.nonce,
            self.issued_at_ms,
            self.expires_at_ms,
            &stable_context,
            outer_transcript_digest,
        )
        .map_err(map_root_share_to_protocol)?;
        binding
            .validate_at(now_unix_ms)
            .map_err(map_root_share_to_protocol)?;
        Ok(binding)
    }
}

/// Strict tenant-root private Deriver request for ECDSA registration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1 {
    /// Typed public registration request admitted by Router.
    pub registration_request: RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    /// Router-to-Deriver bootstrap body carrying role-envelope AAD.
    pub(crate) signer_bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
    /// Issuer-verified tenant-root receipt and Router-issued operation scope.
    pub tenant_root_custody_binding: CloudflareTenantRootCustodyBindingWireV1,
}

impl CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1 {
    /// Creates a validated Router A/B ECDSA derivation registration Deriver request.
    pub fn new(
        worker_role: CloudflareWorkerRoleV1,
        registration_request: RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
        signer_bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
        tenant_root_custody_binding: CloudflareTenantRootCustodyBindingWireV1,
    ) -> RouterAbProtocolResult<Self> {
        let request = Self {
            registration_request,
            signer_bootstrap,
            tenant_root_custody_binding,
        };
        request.validate_for_worker_role(worker_role)?;
        Ok(request)
    }

    /// Validates that typed registration metadata matches the Router-to-signer payload.
    pub fn validate_for_worker_role(
        &self,
        worker_role: CloudflareWorkerRoleV1,
    ) -> RouterAbProtocolResult<()> {
        self.registration_request.validate()?;
        self.signer_bootstrap
            .validate_for_worker_role(worker_role)?;
        self.tenant_root_custody_binding.validate_transport()?;
        let expected_router_request_digest = self.registration_request.request_header_digest()?;
        if self.signer_bootstrap.router_request_digest != expected_router_request_digest {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Router A/B ECDSA derivation registration bootstrap digest does not match typed registration request",
            ));
        }
        if self.tenant_root_custody_binding.expires_at_ms < self.registration_request.expires_at_ms
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "tenant-root private binding expires before the admitted registration request",
            ));
        }
        let router_payload =
            decode_router_to_signer_payload_v1(self.signer_bootstrap.message.payload.as_bytes())?;
        validate_cloudflare_router_ab_ecdsa_derivation_registration_request_for_router_payload_v1(
            &self.registration_request,
            &router_payload,
        )
    }

    /// Consumes the public wire after independently authenticating its signed
    /// tenant-root receipt and reconstructing the exact role-local binding.
    pub(crate) fn into_authenticated_parts(
        self,
        env: &impl CloudflareEnvReaderV1,
        worker_role: CloudflareWorkerRoleV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<(
        RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
        CloudflareAuthenticatedSignerPrivateBootstrapRequestV1,
        CloudflareTenantRootCustodyBindingWireV1,
    )> {
        self.validate_for_worker_role(worker_role)?;
        let CloudflareRouterAbEcdsaDerivationDeriverRegistrationPrivateRequestV1 {
            registration_request,
            signer_bootstrap,
            tenant_root_custody_binding,
        } = self;
        let binding = tenant_root_custody_binding.authenticate_for_registration(
            env,
            &registration_request,
            now_unix_ms,
        )?;
        let authenticated = CloudflareAuthenticatedSignerPrivateBootstrapRequestV1::new(
            worker_role,
            signer_bootstrap,
            binding,
        )?;
        Ok((
            registration_request,
            authenticated,
            tenant_root_custody_binding,
        ))
    }
}

/// Reconstructs a strict registration bootstrap from the admitted ECDSA lifecycle header.
pub fn cloudflare_signer_private_bootstrap_from_ecdsa_derivation_registration_v1(
    worker_role: CloudflareWorkerRoleV1,
    registration_request: &RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    message: WireMessageV1,
) -> RouterAbProtocolResult<CloudflareSignerPrivateBootstrapRequestV1> {
    registration_request.validate()?;
    validate_cloudflare_signer_private_request_v1(worker_role, &message)?;
    let public_request = registration_request.to_threshold_prf_request()?;
    let signer_role = cloudflare_worker_signer_role_v1(worker_role)?;
    let (expected_a, expected_b) = public_request.to_signer_wire_messages()?;
    let expected_message = match signer_role {
        Role::SignerA => expected_a,
        Role::SignerB => expected_b,
        _ => unreachable!("cloudflare_worker_signer_role_v1 returns only signer roles"),
    };
    if message != expected_message {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "strict ECDSA registration bootstrap message does not match admitted request",
        ));
    }
    let aad = registration_request.header().role_aad(signer_role)?;
    let router_request_digest = registration_request.request_header_digest()?;
    let router_payload = decode_router_to_signer_payload_v1(message.payload.as_bytes())?;
    let assignment = router_payload.require_recipient_role(signer_role)?;
    if assignment.envelope.header_digest != router_request_digest {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "strict ECDSA registration envelope header digest does not match admitted header",
        ));
    }
    CloudflareSignerPrivateBootstrapRequestV1::new(worker_role, message, aad, router_request_digest)
}

/// Strict private Deriver request for Router A/B ECDSA derivation explicit export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1 {
    /// Typed public export request admitted by Router.
    pub export_request: RouterAbEcdsaDerivationExplicitExportRequestV1,
    /// Router-to-Deriver bootstrap body carrying role-envelope AAD.
    pub(crate) signer_bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
    /// Issuer-verified tenant-root receipt and Router-issued operation scope.
    pub tenant_root_custody_binding: CloudflareTenantRootCustodyBindingWireV1,
}

impl CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1 {
    /// Creates a validated Router A/B ECDSA derivation export Deriver request.
    pub fn new(
        worker_role: CloudflareWorkerRoleV1,
        export_request: RouterAbEcdsaDerivationExplicitExportRequestV1,
        signer_bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
        tenant_root_custody_binding: CloudflareTenantRootCustodyBindingWireV1,
    ) -> RouterAbProtocolResult<Self> {
        let request = Self {
            export_request,
            signer_bootstrap,
            tenant_root_custody_binding,
        };
        request.validate_for_worker_role(worker_role)?;
        Ok(request)
    }

    /// Validates that typed export metadata matches the Router-to-signer payload.
    pub fn validate_for_worker_role(
        &self,
        worker_role: CloudflareWorkerRoleV1,
    ) -> RouterAbProtocolResult<()> {
        self.export_request.validate()?;
        self.signer_bootstrap
            .validate_for_worker_role(worker_role)?;
        self.tenant_root_custody_binding.validate_transport()?;
        if self.tenant_root_custody_binding.expires_at_ms < self.export_request.expires_at_ms {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "tenant-root private binding expires before the admitted export request",
            ));
        }
        let expected_router_request_digest = self
            .export_request
            .to_threshold_prf_request()?
            .request_context_digest()?;
        if self.signer_bootstrap.router_request_digest != expected_router_request_digest {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Router A/B ECDSA derivation export bootstrap digest does not match typed export request",
            ));
        }
        let router_payload =
            decode_router_to_signer_payload_v1(self.signer_bootstrap.message.payload.as_bytes())?;
        validate_cloudflare_router_ab_ecdsa_derivation_export_request_for_router_payload_v1(
            &self.export_request,
            &router_payload,
        )
    }

    /// Consumes the public wire after independently authenticating its signed
    /// tenant-root receipt and reconstructing the exact role-local binding.
    pub(crate) fn into_authenticated_parts(
        self,
        env: &impl CloudflareEnvReaderV1,
        worker_role: CloudflareWorkerRoleV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<(
        RouterAbEcdsaDerivationExplicitExportRequestV1,
        CloudflareAuthenticatedSignerPrivateBootstrapRequestV1,
        CloudflareTenantRootCustodyBindingWireV1,
    )> {
        self.validate_for_worker_role(worker_role)?;
        let CloudflareRouterAbEcdsaDerivationDeriverExportPrivateRequestV1 {
            export_request,
            signer_bootstrap,
            tenant_root_custody_binding,
        } = self;
        let binding =
            tenant_root_custody_binding.authenticate_for_export(env, &export_request, now_unix_ms)?;
        let authenticated = CloudflareAuthenticatedSignerPrivateBootstrapRequestV1::new(
            worker_role,
            signer_bootstrap,
            binding,
        )?;
        Ok((export_request, authenticated, tenant_root_custody_binding))
    }
}

/// Strict private Deriver request for Router A/B ECDSA derivation activation refresh.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterAbEcdsaDerivationDeriverActivationRefreshPrivateRequestV1 {
    /// Typed public activation-refresh request admitted by Router.
    pub refresh_request: RouterAbEcdsaDerivationActivationRefreshRequestV1,
    /// Router-to-Deriver bootstrap body carrying role-envelope AAD.
    pub(crate) signer_bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
    /// Issuer-verified tenant-root receipt and Router-issued operation scope.
    pub tenant_root_custody_binding: CloudflareTenantRootCustodyBindingWireV1,
}

impl CloudflareRouterAbEcdsaDerivationDeriverActivationRefreshPrivateRequestV1 {
    /// Creates a validated Router A/B ECDSA derivation activation-refresh Deriver request.
    pub fn new(
        worker_role: CloudflareWorkerRoleV1,
        refresh_request: RouterAbEcdsaDerivationActivationRefreshRequestV1,
        signer_bootstrap: CloudflareSignerPrivateBootstrapRequestV1,
        tenant_root_custody_binding: CloudflareTenantRootCustodyBindingWireV1,
    ) -> RouterAbProtocolResult<Self> {
        let request = Self {
            refresh_request,
            signer_bootstrap,
            tenant_root_custody_binding,
        };
        request.validate_for_worker_role(worker_role)?;
        Ok(request)
    }

    /// Validates that typed refresh metadata matches the Router-to-signer payload.
    pub fn validate_for_worker_role(
        &self,
        worker_role: CloudflareWorkerRoleV1,
    ) -> RouterAbProtocolResult<()> {
        self.refresh_request.validate()?;
        self.signer_bootstrap
            .validate_for_worker_role(worker_role)?;
        self.tenant_root_custody_binding.validate_transport()?;
        if self.tenant_root_custody_binding.expires_at_ms < self.refresh_request.expires_at_ms {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "tenant-root private binding expires before the admitted refresh request",
            ));
        }
        let expected_router_request_digest = self
            .refresh_request
            .to_threshold_prf_request()?
            .request_context_digest()?;
        if self.signer_bootstrap.router_request_digest != expected_router_request_digest {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Router A/B ECDSA derivation activation refresh bootstrap digest does not match typed refresh request",
            ));
        }
        let router_payload =
            decode_router_to_signer_payload_v1(self.signer_bootstrap.message.payload.as_bytes())?;
        validate_cloudflare_router_ab_ecdsa_derivation_activation_refresh_request_for_router_payload_v1(
            &self.refresh_request,
            &router_payload,
        )
    }

    /// Consumes the public wire after independently authenticating its signed
    /// tenant-root receipt and reconstructing the exact role-local binding.
    #[cfg(feature = "workers-rs")]
    pub(crate) fn into_authenticated_parts(
        self,
        env: &worker::Env,
        worker_role: CloudflareWorkerRoleV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<(
        RouterAbEcdsaDerivationActivationRefreshRequestV1,
        CloudflareAuthenticatedSignerPrivateBootstrapRequestV1,
        CloudflareTenantRootCustodyBindingWireV1,
    )> {
        self.validate_for_worker_role(worker_role)?;
        let CloudflareRouterAbEcdsaDerivationDeriverActivationRefreshPrivateRequestV1 {
            refresh_request,
            signer_bootstrap,
            tenant_root_custody_binding,
        } = self;
        let binding = tenant_root_custody_binding.authenticate_for_refresh(
            &CloudflareWorkerEnvReaderV1::new(env),
            &refresh_request,
            now_unix_ms,
        )?;
        let authenticated = CloudflareAuthenticatedSignerPrivateBootstrapRequestV1::new(
            worker_role,
            signer_bootstrap,
            binding,
        )?;
        Ok((refresh_request, authenticated, tenant_root_custody_binding))
    }
}

/// Reconstructs the strict signer bootstrap body from an admitted public Router request.
pub fn cloudflare_signer_private_bootstrap_from_public_request_v1(
    worker_role: CloudflareWorkerRoleV1,
    public_request: &EcdsaThresholdPrfRequestV1,
    message: WireMessageV1,
) -> RouterAbProtocolResult<CloudflareSignerPrivateBootstrapRequestV1> {
    public_request.validate()?;
    validate_cloudflare_signer_private_request_v1(worker_role, &message)?;
    let signer_role = cloudflare_worker_signer_role_v1(worker_role)?;
    let (expected_a, expected_b) = public_request.to_signer_wire_messages()?;
    let expected_message = match signer_role {
        Role::SignerA => expected_a,
        Role::SignerB => expected_b,
        _ => unreachable!("cloudflare_worker_signer_role_v1 returns only signer roles"),
    };
    if message != expected_message {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "strict signer bootstrap message does not match admitted public Router request",
        ));
    }
    let router_payload = decode_router_to_signer_payload_v1(message.payload.as_bytes())?;
    let assignment = router_payload.require_recipient_role(signer_role)?;
    let router_request_digest = public_request.request_context_digest()?;
    let aad = RoleEnvelopeAadV1::new(
        router_payload.lifecycle().lifecycle_id.clone(),
        router_payload.lifecycle().work_kind,
        router_payload.signer_set().signer_set_id.clone(),
        assignment.signer.clone(),
        router_payload.signer_set().selected_server.clone(),
        router_payload.transcript_digest(),
        router_request_digest,
        public_request.expires_at_ms,
    )?;
    CloudflareSignerPrivateBootstrapRequestV1::new(worker_role, message, aad, router_request_digest)
}

/// Validates that a Router A/B ECDSA derivation registration request owns a Router-to-signer payload.
pub fn validate_cloudflare_router_ab_ecdsa_derivation_registration_request_for_router_payload_v1(
    registration_request: &RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    router_payload: &RouterToSignerPayloadV1,
) -> RouterAbProtocolResult<()> {
    registration_request.validate()?;
    router_payload.validate()?;
    let public_request = registration_request.to_threshold_prf_request()?;
    let (expected_a, expected_b) = public_request.to_signer_payloads()?;
    let expected = match router_payload.recipient_role() {
        Role::SignerA => expected_a,
        Role::SignerB => expected_b,
        _ => unreachable!("RouterToSignerPayloadV1 targets only signer roles"),
    };
    if router_payload == &expected {
        return Ok(());
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLifecycleState,
        "Router A/B ECDSA derivation registration request does not match Router-to-Deriver payload",
    ))
}

/// Validates that a Router A/B ECDSA derivation export request owns a Router-to-signer payload.
pub fn validate_cloudflare_router_ab_ecdsa_derivation_export_request_for_router_payload_v1(
    export_request: &RouterAbEcdsaDerivationExplicitExportRequestV1,
    router_payload: &RouterToSignerPayloadV1,
) -> RouterAbProtocolResult<()> {
    export_request.validate()?;
    router_payload.validate()?;
    let public_request = export_request.to_threshold_prf_request()?;
    let (expected_a, expected_b) = public_request.to_signer_payloads()?;
    let expected = match router_payload.recipient_role() {
        Role::SignerA => expected_a,
        Role::SignerB => expected_b,
        _ => unreachable!("RouterToSignerPayloadV1 targets only signer roles"),
    };
    if router_payload == &expected {
        return Ok(());
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLifecycleState,
        "Router A/B ECDSA derivation export request does not match Router-to-Deriver payload",
    ))
}

/// Validates that a Router A/B ECDSA derivation activation-refresh request owns a Router-to-signer payload.
pub fn validate_cloudflare_router_ab_ecdsa_derivation_activation_refresh_request_for_router_payload_v1(
    refresh_request: &RouterAbEcdsaDerivationActivationRefreshRequestV1,
    router_payload: &RouterToSignerPayloadV1,
) -> RouterAbProtocolResult<()> {
    refresh_request.validate()?;
    router_payload.validate()?;
    let public_request = refresh_request.to_threshold_prf_request()?;
    let (expected_a, expected_b) = public_request.to_signer_payloads()?;
    let expected = match router_payload.recipient_role() {
        Role::SignerA => expected_a,
        Role::SignerB => expected_b,
        _ => unreachable!("RouterToSignerPayloadV1 targets only signer roles"),
    };
    if router_payload == &expected {
        return Ok(());
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLifecycleState,
        "Router A/B ECDSA derivation activation refresh request does not match Router-to-Deriver payload",
    ))
}

/// Public preload coordinates derived from a strict private signer bootstrap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSignerHostPreloadPlanV1 {
    /// Worker role that owns the private signer request.
    pub worker_role: CloudflareWorkerRoleV1,
    /// Signer set id whose local root-share metadata must be loaded.
    pub signer_set_id: String,
    /// Root-share epoch to load for the local signer role.
    pub root_share_epoch: RootShareEpoch,
    /// Local signer identity bound by the Router payload.
    pub local_signer: SignerIdentityV1,
    /// Signer set bound by the Router payload.
    pub signer_set: SignerSetV1,
    /// Transcript digest bound by the Router-to-signer wire message.
    pub transcript_digest: PublicDigest32,
    /// Pre-envelope public request-context digest bound inside signer plaintext.
    pub router_request_digest: PublicDigest32,
}

impl CloudflareSignerHostPreloadPlanV1 {
    /// Creates validated Deriver-host preload coordinates.
    pub fn new(
        worker_role: CloudflareWorkerRoleV1,
        signer_set_id: impl Into<String>,
        root_share_epoch: RootShareEpoch,
        local_signer: SignerIdentityV1,
        signer_set: SignerSetV1,
        transcript_digest: PublicDigest32,
        router_request_digest: PublicDigest32,
    ) -> RouterAbProtocolResult<Self> {
        let plan = Self {
            worker_role,
            signer_set_id: signer_set_id.into(),
            root_share_epoch,
            local_signer,
            signer_set,
            transcript_digest,
            router_request_digest,
        };
        plan.validate()?;
        Ok(plan)
    }

    /// Derives preload coordinates from a validated strict private bootstrap body.
    pub fn from_private_bootstrap(
        worker_role: CloudflareWorkerRoleV1,
        bootstrap: &CloudflareSignerPrivateBootstrapRequestV1,
    ) -> RouterAbProtocolResult<Self> {
        bootstrap.validate_for_worker_role(worker_role)?;
        let payload = decode_router_to_signer_payload_v1(bootstrap.message.payload.as_bytes())?;
        let local_role = cloudflare_worker_signer_role_v1(worker_role)?;
        let local_signer =
            expected_cloudflare_signer_identity_for_role_v1(&payload, local_role)?.clone();
        Self::new(
            worker_role,
            payload.signer_set().signer_set_id.clone(),
            payload.lifecycle().root_share_epoch.clone(),
            local_signer,
            payload.signer_set().clone(),
            bootstrap.message.transcript_digest,
            bootstrap.router_request_digest,
        )
    }

    /// Validates Deriver-host preload coordinates.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        let expected_role = cloudflare_worker_signer_role_v1(self.worker_role)?;
        require_non_empty("signer_set_id", &self.signer_set_id)?;
        require_non_empty("root_share_epoch", self.root_share_epoch.as_str())?;
        self.local_signer.validate()?;
        self.signer_set.validate()?;
        if self.local_signer.role != expected_role {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidSignerIdentity,
                "Deriver-host preload plan local signer does not match Worker role",
            ));
        }
        if self.signer_set.signer_set_id != self.signer_set_id {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidSignerIdentity,
                "Deriver-host preload plan signer-set id does not match signer set",
            ));
        }
        let expected_local = match expected_role {
            Role::SignerA => &self.signer_set.signer_a,
            Role::SignerB => &self.signer_set.signer_b,
            _ => unreachable!("cloudflare_worker_signer_role_v1 returns only signer roles"),
        };
        if &self.local_signer != expected_local {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidSignerIdentity,
                "Deriver-host preload plan local signer does not match signer-set role",
            ));
        }
        Ok(())
    }

    /// Builds Deriver-host preload input for these coordinates.
    pub fn to_host_preload_input(
        &self,
        random_bytes_len: usize,
    ) -> RouterAbProtocolResult<CloudflareSignerHostPreloadInputV1> {
        self.validate()?;
        CloudflareSignerHostPreloadInputV1::new(
            self.signer_set_id.clone(),
            self.root_share_epoch.clone(),
            random_bytes_len,
        )
    }
}

/// Private signer request after envelope decryption and signer-input validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareValidatedSignerPrivateRequestV1 {
    pub(super) worker_role: CloudflareWorkerRoleV1,
    pub(super) message: WireMessageV1,
    pub(super) router_payload: RouterToSignerPayloadV1,
    pub(super) signer_input: SignerInputPlaintextV1,
}

impl CloudflareValidatedSignerPrivateRequestV1 {
    pub(super) fn new(
        worker_role: CloudflareWorkerRoleV1,
        message: WireMessageV1,
        router_payload: RouterToSignerPayloadV1,
        signer_input: SignerInputPlaintextV1,
    ) -> RouterAbProtocolResult<Self> {
        validate_cloudflare_signer_private_request_v1(worker_role, &message)?;
        if router_payload.transcript_digest() != message.transcript_digest {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "validated signer request payload transcript digest does not match wire message",
            ));
        }
        router_payload.require_recipient_role(cloudflare_worker_signer_role_v1(worker_role)?)?;
        Ok(Self {
            worker_role,
            message,
            router_payload,
            signer_input,
        })
    }

    /// Returns the Cloudflare Worker role handling this request.
    pub fn worker_role(&self) -> CloudflareWorkerRoleV1 {
        self.worker_role
    }

    /// Returns the original private signer wire message.
    pub fn message(&self) -> &WireMessageV1 {
        &self.message
    }

    /// Returns the decoded Router-to-signer payload.
    pub fn router_payload(&self) -> &RouterToSignerPayloadV1 {
        &self.router_payload
    }

    /// Returns the validated signer-input plaintext.
    pub fn signer_input(&self) -> &SignerInputPlaintextV1 {
        &self.signer_input
    }
}

/// Handles a parsed private signer request through a strict proof-bundle handler.
pub fn handle_cloudflare_signer_recipient_proof_bundle_private_request_v1(
    worker_role: CloudflareWorkerRoleV1,
    handler: &impl CloudflareSignerRecipientProofBundleWireHandlerV1,
    message: WireMessageV1,
) -> RouterAbProtocolResult<CloudflareSignerRecipientProofBundleResponseV1> {
    validate_cloudflare_signer_private_request_v1(worker_role, &message)?;
    let response = handler.handle_signer_recipient_proof_bundle_wire_message(message.clone())?;
    validate_cloudflare_signer_recipient_proof_bundle_private_response_v1(
        worker_role,
        &message,
        &response,
    )?;
    Ok(response)
}
