//! ECDSA derivation activation, refresh and export types, and their material and public-identity helpers.

use super::*;

/// Pending SigningWorker activation produced after the Router completes both Deriver calls.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterAbEcdsaDerivationPendingSigningWorkerActivationV1 {
    pub ownership_generation: u64,
    /// Typed Router A/B ECDSA derivation registration/bootstrap request admitted by Router.
    pub registration: RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    /// Issuer-signed tenant-root receipt and exact operation scope.
    pub tenant_root_custody_binding: CloudflareTenantRootCustodyBindingWireV1,
    /// Gateway ceremony owner, pinned at first-phase admission.
    pub wallet_scope: CloudflareSigningWorkerWalletScopeV1,
    /// Gateway runtime environment key used for the original ceremony policy.
    pub environment_key: String,
    /// Public context needed to verify and open SigningWorker proof bundles.
    pub activation_context: SigningWorkerActivationContextV1,
    /// Opaque SigningWorker proof bundles from Deriver A and Deriver B.
    pub activation: CloudflareSigningWorkerRecipientProofBundleActivationV1,
}

impl CloudflareRouterAbEcdsaDerivationPendingSigningWorkerActivationV1 {
    /// Creates a pending activation from Router public context and encrypted server bundles.
    pub fn new(
        ownership_generation: u64,
        registration: RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
        tenant_root_custody_binding: CloudflareTenantRootCustodyBindingWireV1,
        wallet_scope: CloudflareSigningWorkerWalletScopeV1,
        environment_key: String,
        router_payload: RouterToSignerPayloadV1,
        activation: CloudflareSigningWorkerRecipientProofBundleActivationV1,
    ) -> RouterAbProtocolResult<Self> {
        router_payload.require_recipient_role(Role::SignerA)?;
        activation.validate_for_router_payload(&router_payload)?;
        let activation_context =
            SigningWorkerActivationContextV1::from_router_payload(&router_payload)?;
        let request = Self {
            ownership_generation,
            registration,
            tenant_root_custody_binding,
            wallet_scope,
            environment_key,
            activation_context,
            activation,
        };
        request.validate()?;
        Ok(request)
    }

    /// Validates registration metadata against the generic Router A/B activation context.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)?;
        self.registration.validate()?;
        self.tenant_root_custody_binding.validate_transport()?;
        if self.tenant_root_custody_binding.expires_at_ms < self.registration.expires_at_ms {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "tenant-root custody binding expires before the ECDSA registration request",
            ));
        }
        self.wallet_scope.validate()?;
        require_non_empty("ECDSA pending environment key", &self.environment_key)?;
        if self.wallet_scope.wallet_id != self.registration.lifecycle.account_id {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "ECDSA pending owner differs from registration wallet",
            ));
        }
        self.activation_context.validate()?;
        self.activation
            .validate_for_activation_context(&self.activation_context)?;
        let public_request = self.registration.to_threshold_prf_request()?;
        let transcript_metadata = public_request.transcript_metadata()?;
        if self.activation_context.lifecycle != public_request.lifecycle
            || self.activation_context.signer_set != public_request.signer_set
            || self.activation_context.transcript_metadata != transcript_metadata
            || self.activation_context.transcript_digest != public_request.transcript_digest
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "Router A/B ECDSA derivation activation context does not match registration transcript",
            ));
        }
        Ok(())
    }
}

/// Public Router activation command carrying client facts derived after proof verification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterAbEcdsaDerivationActivationCommandV1 {
    /// Gateway-owned idempotency identity for this activation.
    pub activation_correlation_id: String,
    /// Router-produced pending activation with encrypted SigningWorker proof bundles.
    pub pending: CloudflareRouterAbEcdsaDerivationPendingSigningWorkerActivationV1,
    /// Client public facts produced by the verified `XClientBase` finalizer.
    pub client_activation: EcdsaVerifiedClientActivationFactsV1,
}

impl CloudflareRouterAbEcdsaDerivationActivationCommandV1 {
    /// Creates a validated public Router activation command.
    pub fn new(
        activation_correlation_id: impl Into<String>,
        pending: CloudflareRouterAbEcdsaDerivationPendingSigningWorkerActivationV1,
        client_activation: EcdsaVerifiedClientActivationFactsV1,
    ) -> RouterAbProtocolResult<Self> {
        let command = Self {
            activation_correlation_id: activation_correlation_id.into(),
            pending,
            client_activation,
        };
        command.validate()?;
        Ok(command)
    }

    /// Validates client facts against the exact registration request and proof transcript.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_non_empty(
            "ECDSA activation correlation id",
            &self.activation_correlation_id,
        )?;
        self.pending.validate()?;
        if self.activation_correlation_id != self.pending.activation_context.lifecycle.lifecycle_id
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "ECDSA activation correlation id does not match lifecycle id",
            ));
        }
        self.client_activation.validate().map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Router A/B ECDSA derivation client activation facts are malformed",
            )
        })?;
        let registration = &self.pending.registration;
        let expected_request_digest =
            encode_base64url_bytes_v1(registration.request_digest()?.as_bytes());
        let public_request = registration.to_threshold_prf_request()?;
        let expected_transcript_digest =
            encode_base64url_bytes_v1(public_request.transcript_digest.as_bytes());
        let expected_context_binding =
            encode_base64url_bytes_v1(registration.context.context_binding_digest()?.as_bytes());
        if self.client_activation.registration_request_digest_b64u != expected_request_digest
            || self.client_activation.proof_transcript_digest_b64u != expected_transcript_digest
            || self.client_activation.context_binding32_b64u != expected_context_binding
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "Router A/B ECDSA derivation client activation does not match pending registration",
            ));
        }
        Ok(())
    }

    /// Converts a public command into the private SigningWorker activation request.
    pub(crate) fn into_signing_worker_request(
        self,
    ) -> RouterAbProtocolResult<CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1>
    {
        self.validate()?;
        let material_activation =
            cloudflare_router_ab_ecdsa_derivation_material_activation_ref_v1(&self)?;
        CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1::new(
            self.activation_correlation_id,
            self.pending,
            self.client_activation,
            material_activation,
        )
    }
}

/// SigningWorker activation request carrying the Router-minted material reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1 {
    /// Gateway-owned idempotency identity for this activation.
    pub activation_correlation_id: String,
    /// Router-produced pending activation with encrypted SigningWorker proof bundles.
    pub pending: CloudflareRouterAbEcdsaDerivationPendingSigningWorkerActivationV1,
    /// Client public facts produced by the verified `XClientBase` finalizer.
    pub client_activation: EcdsaVerifiedClientActivationFactsV1,
    /// Canonical exact material activation for this ECDSA capability.
    pub material_activation: MpcMaterialActivationRefV1,
}

/// Derives the stable Router-owned activation reference for one idempotent activation command.
pub fn cloudflare_router_ab_ecdsa_derivation_material_activation_ref_v1(
    command: &CloudflareRouterAbEcdsaDerivationActivationCommandV1,
) -> RouterAbProtocolResult<MpcMaterialActivationRefV1> {
    command.validate()?;
    let lifecycle = command.pending.activation_context.lifecycle();
    let selected_server = &command
        .pending
        .activation_context
        .signer_set()
        .selected_server;
    let activation_id = router_owned_ecdsa_activation_component_v1(
        b"router-ab-cloudflare/ecdsa-material-activation-id/v1",
        command,
        "ecdsa-activation-v1",
    )?;
    let capability = router_owned_ecdsa_activation_component_v1(
        b"router-ab-cloudflare/ecdsa-material-capability/v1",
        command,
        "ecdsa-capability-v1",
    )?;
    MpcMaterialActivationRefV1::new(
        activation_id,
        capability,
        lifecycle.account_id.clone(),
        command.client_activation.context_binding32_b64u.clone(),
        lifecycle.lifecycle_id.clone(),
        selected_server.server_id.clone(),
    )
}

pub(super) fn router_owned_ecdsa_activation_component_v1(
    domain: &[u8],
    command: &CloudflareRouterAbEcdsaDerivationActivationCommandV1,
    prefix: &str,
) -> RouterAbProtocolResult<String> {
    let lifecycle = command.pending.activation_context.lifecycle();
    let selected_server = &command
        .pending
        .activation_context
        .signer_set()
        .selected_server;
    let mut hasher = Sha256::new();
    push_hash_field_v1(&mut hasher, domain);
    push_hash_field_v1(&mut hasher, command.activation_correlation_id.as_bytes());
    push_hash_field_v1(&mut hasher, lifecycle.account_id.as_bytes());
    push_hash_field_v1(
        &mut hasher,
        command
            .client_activation
            .registration_request_digest_b64u
            .as_bytes(),
    );
    push_hash_field_v1(
        &mut hasher,
        command
            .client_activation
            .proof_transcript_digest_b64u
            .as_bytes(),
    );
    push_hash_field_v1(
        &mut hasher,
        command.client_activation.context_binding32_b64u.as_bytes(),
    );
    push_hash_field_v1(&mut hasher, selected_server.server_id.as_bytes());
    let digest = hasher.finalize();
    Ok(format!(
        "{prefix}-{}",
        encode_base64url_bytes_v1(digest.as_slice())
    ))
}

impl CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1 {
    /// Binds verified client facts to one exact pending Router activation.
    pub fn new(
        activation_correlation_id: impl Into<String>,
        pending: CloudflareRouterAbEcdsaDerivationPendingSigningWorkerActivationV1,
        client_activation: EcdsaVerifiedClientActivationFactsV1,
        material_activation: MpcMaterialActivationRefV1,
    ) -> RouterAbProtocolResult<Self> {
        let request = Self {
            activation_correlation_id: activation_correlation_id.into(),
            pending,
            client_activation,
            material_activation,
        };
        request.validate()?;
        Ok(request)
    }

    /// Validates client facts against the exact registration request and proof transcript.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        require_non_empty(
            "ECDSA activation correlation id",
            &self.activation_correlation_id,
        )?;
        self.pending.validate()?;
        self.material_activation.validate()?;
        if self.activation_correlation_id != self.pending.activation_context.lifecycle.lifecycle_id
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "ECDSA activation correlation id does not match lifecycle id",
            ));
        }
        if self.material_activation.material_owner
            != self.pending.activation_context.lifecycle.account_id
            || self.material_activation.signing_worker
                != self
                    .pending
                    .activation_context
                    .signer_set
                    .selected_server
                    .server_id
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "ECDSA material activation does not match activation context",
            ));
        }
        self.client_activation.validate().map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Router A/B ECDSA derivation client activation facts are malformed",
            )
        })?;
        let registration = &self.pending.registration;
        let expected_request_digest =
            encode_base64url_bytes_v1(registration.request_digest()?.as_bytes());
        let public_request = registration.to_threshold_prf_request()?;
        let expected_transcript_digest =
            encode_base64url_bytes_v1(public_request.transcript_digest.as_bytes());
        let expected_context_binding =
            encode_base64url_bytes_v1(registration.context.context_binding_digest()?.as_bytes());
        if self.client_activation.registration_request_digest_b64u != expected_request_digest
            || self.client_activation.proof_transcript_digest_b64u != expected_transcript_digest
            || self.client_activation.context_binding32_b64u != expected_context_binding
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "Router A/B ECDSA derivation client activation does not match pending registration",
            ));
        }
        Ok(())
    }

    /// Converts this typed ECDSA request into the generic proof-bundle activation body.
    pub fn to_recipient_proof_bundle_activation_request(
        &self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerRecipientProofBundleActivationRequestV1>
    {
        self.validate()?;
        let activation = CloudflareSigningWorkerRecipientProofBundleActivationRequestV1 {
            activation_context: self.pending.activation_context.clone(),
            activation: self.pending.activation.clone(),
            material_activation: self.material_activation.clone(),
        };
        activation.validate()?;
        Ok(activation)
    }
}

/// SigningWorker activation-refresh request for Router A/B ECDSA derivation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRefreshRequestV1 {
    /// Typed Router A/B ECDSA derivation activation-refresh request admitted by Router.
    pub refresh_request: RouterAbEcdsaDerivationActivationRefreshRequestV1,
    /// Public context needed to verify and open SigningWorker proof bundles.
    pub activation_context: SigningWorkerActivationContextV1,
    /// Opaque SigningWorker proof bundles from Deriver A and Deriver B.
    pub activation: CloudflareSigningWorkerRecipientProofBundleActivationV1,
    /// Canonical exact material activation for the refreshed ECDSA capability.
    pub material_activation: MpcMaterialActivationRefV1,
    /// Issuer-signed tenant-root receipt and exact operation scope.
    pub tenant_root_custody_binding: CloudflareTenantRootCustodyBindingWireV1,
}

impl CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRefreshRequestV1 {
    /// Creates a validated Router A/B ECDSA derivation activation-refresh request from Router public context.
    pub fn new(
        refresh_request: RouterAbEcdsaDerivationActivationRefreshRequestV1,
        router_payload: RouterToSignerPayloadV1,
        activation: CloudflareSigningWorkerRecipientProofBundleActivationV1,
        material_activation: MpcMaterialActivationRefV1,
        tenant_root_custody_binding: CloudflareTenantRootCustodyBindingWireV1,
    ) -> RouterAbProtocolResult<Self> {
        router_payload.require_recipient_role(Role::SignerA)?;
        activation.validate_for_router_payload(&router_payload)?;
        let activation_context =
            SigningWorkerActivationContextV1::from_router_payload(&router_payload)?;
        let request = Self {
            refresh_request,
            activation_context,
            activation,
            material_activation,
            tenant_root_custody_binding,
        };
        request.validate()?;
        Ok(request)
    }

    /// Validates typed refresh metadata against the generic Router A/B activation context.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.refresh_request.validate()?;
        self.tenant_root_custody_binding.validate_transport()?;
        if self.tenant_root_custody_binding.expires_at_ms < self.refresh_request.expires_at_ms {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidTimeRange,
                "tenant-root custody binding expires before the ECDSA refresh request",
            ));
        }
        self.material_activation.validate()?;
        if self.material_activation.material_owner != self.activation_context.lifecycle.account_id
            || self.material_activation.signing_worker
                != self.activation_context.signer_set.selected_server.server_id
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "ECDSA refresh material activation does not match activation context",
            ));
        }
        self.activation_context.validate()?;
        self.activation
            .validate_for_activation_context(&self.activation_context)?;
        let public_request = self.refresh_request.to_threshold_prf_request()?;
        let transcript_metadata = public_request.transcript_metadata()?;
        if self.activation_context.lifecycle != public_request.lifecycle
            || self.activation_context.signer_set != public_request.signer_set
            || self.activation_context.transcript_metadata != transcript_metadata
            || self.activation_context.transcript_digest != public_request.transcript_digest
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "Router A/B ECDSA derivation activation-refresh context does not match refresh transcript",
            ));
        }
        Ok(())
    }

    /// Converts this typed refresh into the generic proof-bundle activation body.
    pub fn to_recipient_proof_bundle_activation_request(
        &self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerRecipientProofBundleActivationRequestV1>
    {
        self.validate()?;
        let activation = CloudflareSigningWorkerRecipientProofBundleActivationRequestV1 {
            activation_context: self.activation_context.clone(),
            activation: self.activation.clone(),
            material_activation: self.material_activation.clone(),
        };
        activation.validate()?;
        Ok(activation)
    }
}

/// Router A/B ECDSA derivation activation receipt safe to return across the public boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1 {
    /// Router A/B ECDSA derivation public identity activated for normal signing.
    pub ecdsa_activation: RouterAbEcdsaDerivationActivationReceiptV1,
    /// Lifecycle id accepted by the SigningWorker.
    pub lifecycle_id: String,
    /// Public transcript digest accepted by the SigningWorker.
    pub transcript_digest: PublicDigest32,
    /// Whether the SigningWorker committed the activation.
    pub activated: bool,
}

impl CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1 {
    /// Creates a public receipt from server-internal SigningWorker storage evidence.
    pub fn new(
        ecdsa_activation: RouterAbEcdsaDerivationActivationReceiptV1,
        signing_worker_output: CloudflareSigningWorkerOutputActivationReceiptV1,
    ) -> RouterAbProtocolResult<Self> {
        signing_worker_output.validate()?;
        if ecdsa_activation.signing_worker
            != signing_worker_output
                .active_signing_worker_state
                .signing_worker
            || ecdsa_activation.activation_digest_b64u
                != encode_base64url_bytes_v1(
                    signing_worker_output
                        .active_signing_worker_state
                        .activation_digest
                        .as_bytes(),
                )
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "Router A/B ECDSA derivation activation does not match SigningWorker storage evidence",
            ));
        }
        let receipt = Self {
            ecdsa_activation,
            lifecycle_id: signing_worker_output.lifecycle_id,
            transcript_digest: signing_worker_output.transcript_digest,
            activated: signing_worker_output.activated,
        };
        receipt.validate()?;
        Ok(receipt)
    }

    /// Validates the public activation receipt.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.ecdsa_activation.validate()?;
        require_non_empty("activation lifecycle_id", &self.lifecycle_id)?;
        if !self.activated {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "Router A/B ECDSA derivation activation was not committed",
            ));
        }
        Ok(())
    }
}

/// Returns the public digest of a SigningWorker proof-bundle activation package.
pub(crate) fn cloudflare_signing_worker_recipient_proof_bundle_activation_digest_v1(
    activation: &CloudflareSigningWorkerRecipientProofBundleActivationV1,
) -> RouterAbProtocolResult<PublicDigest32> {
    activation.validate()?;
    let mut hasher = Sha256::new();
    push_hash_field_v1(
        &mut hasher,
        b"router-ab-cloudflare/server-proof-bundle-activation/v1",
    );
    push_hash_field_v1(&mut hasher, activation.deriver_a_bundle.digest().as_bytes());
    push_hash_field_v1(
        &mut hasher,
        activation.deriver_b_server_bundle.digest().as_bytes(),
    );
    let digest = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    Ok(PublicDigest32::new(out))
}

/// Converts a Router A/B ECDSA derivation context into the Router A/B ECDSA derivation crate context.
pub fn cloudflare_router_ab_ecdsa_derivation_stable_key_context_v1(
    context: &RouterAbEcdsaDerivationStableKeyContextV1,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationStableKeyContext> {
    context.validate()?;
    let application_binding_digest = decode_base64url_fixed_32_v1(
        "Router A/B ECDSA derivation application_binding_digest_b64u",
        &context.application_binding_digest_b64u,
    )?;
    let ecdsa_context = RouterAbEcdsaDerivationStableKeyContext::new(application_binding_digest);
    ecdsa_context
        .validate()
        .map_err(map_router_ab_ecdsa_derivation_error_v1)?;
    Ok(ecdsa_context)
}

/// Derives the public Router A/B ECDSA derivation identity from opened SigningWorker A/B material.
pub fn cloudflare_router_ab_ecdsa_derivation_public_identity_from_activation_material_v1(
    registration: &RouterAbEcdsaDerivationRegistrationBootstrapRequestV1,
    client_activation: &EcdsaVerifiedClientActivationFactsV1,
    material: &CloudflareServerOutputMaterialRecordV1,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationPublicIdentityV1> {
    registration.validate()?;
    client_activation.validate().map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "Router A/B ECDSA derivation client activation facts are malformed",
        )
    })?;
    material.validate()?;
    let public_request = registration.to_threshold_prf_request()?;
    if material.transcript_digest != public_request.transcript_digest
        || material.recipient_identity != registration.signer_set.selected_server.server_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Router A/B ECDSA derivation activation material does not match registration transcript",
        ));
    }
    let ecdsa_context =
        cloudflare_router_ab_ecdsa_derivation_stable_key_context_v1(&registration.context)?;
    let derivation_client_share_public_key33 = decode_base64url_fixed_33_v1(
        "Router A/B ECDSA derivation client activation derivation_client_share_public_key33_b64u",
        &client_activation.derivation_client_share_public_key33_b64u,
    )?;
    let (_relayer_share, identity) = derive_relayer_share_for_client_public(
        &ecdsa_context,
        *material.output_material.as_bytes(),
        &derivation_client_share_public_key33,
        client_activation.client_share_retry_counter,
    )
    .map_err(map_router_ab_ecdsa_derivation_error_v1)?;
    RouterAbEcdsaDerivationPublicIdentityV1::new(
        encode_base64url_bytes_v1(&identity.context_binding32),
        encode_base64url_bytes_v1(&identity.derivation_client_share_public_key33),
        encode_base64url_bytes_v1(&identity.relayer_public_key33),
        encode_base64url_bytes_v1(&identity.threshold_public_key33),
        encode_base64url_bytes_v1(&identity.threshold_ethereum_address20),
        identity.client_share_retry_counter,
        identity.relayer_share_retry_counter,
    )
}

/// Builds a public Router A/B ECDSA derivation activation receipt from opened SigningWorker material.
pub fn cloudflare_router_ab_ecdsa_derivation_activation_receipt_from_material_v1(
    request: &CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRequestV1,
    material: &CloudflareServerOutputMaterialRecordV1,
    activated_at_ms: u64,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationActivationReceiptV1> {
    request.validate()?;
    let public_identity =
        cloudflare_router_ab_ecdsa_derivation_public_identity_from_activation_material_v1(
            &request.pending.registration,
            &request.client_activation,
            material,
        )?;
    let selected_worker = request
        .pending
        .activation_context
        .signer_set()
        .selected_server
        .clone();
    let activation_epoch = request
        .pending
        .activation_context
        .lifecycle()
        .root_share_epoch
        .as_str()
        .to_owned();
    let activation_digest = cloudflare_signing_worker_recipient_proof_bundle_activation_digest_v1(
        &request.pending.activation,
    )?;
    let receipt = RouterAbEcdsaDerivationActivationReceiptV1 {
        context: request.pending.registration.context.clone(),
        public_identity,
        signing_worker: selected_worker,
        material_activation: request.material_activation.clone(),
        activation_epoch,
        activation_digest_b64u: encode_base64url_bytes_v1(activation_digest.as_bytes()),
        activated_at_ms,
    };
    receipt.validate()?;
    Ok(receipt)
}

/// Builds a public Router A/B ECDSA derivation activation receipt from refreshed SigningWorker material.
pub fn cloudflare_router_ab_ecdsa_derivation_activation_refresh_receipt_from_material_v1(
    request: &CloudflareRouterAbEcdsaDerivationSigningWorkerActivationRefreshRequestV1,
    material: &CloudflareServerOutputMaterialRecordV1,
    activated_at_ms: u64,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationActivationReceiptV1> {
    request.validate()?;
    let selected_worker = request
        .activation_context
        .signer_set()
        .selected_server
        .clone();
    let derived_identity =
        cloudflare_router_ab_ecdsa_derivation_public_identity_from_material_parts_v1(
            &request.refresh_request.context,
            &request.refresh_request.public_identity,
            &selected_worker,
            material,
            "Router A/B ECDSA derivation refreshed activation material",
        )?;
    if derived_identity != request.refresh_request.public_identity {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Router A/B ECDSA derivation refreshed activation material does not match public identity",
        ));
    }
    let activation_digest =
        cloudflare_signing_worker_recipient_proof_bundle_activation_digest_v1(&request.activation)?;
    let receipt = RouterAbEcdsaDerivationActivationReceiptV1 {
        context: request.refresh_request.context.clone(),
        public_identity: request.refresh_request.public_identity.clone(),
        signing_worker: selected_worker,
        material_activation: request.material_activation.clone(),
        activation_epoch: request.refresh_request.next_activation_epoch.clone(),
        activation_digest_b64u: encode_base64url_bytes_v1(activation_digest.as_bytes()),
        activated_at_ms,
    };
    receipt.validate()?;
    Ok(receipt)
}

/// Builds a normal-signing scope from a validated Router A/B ECDSA derivation activation receipt.
pub fn cloudflare_router_ab_ecdsa_derivation_normal_signing_scope_from_activation_receipt_v1(
    receipt: &RouterAbEcdsaDerivationActivationReceiptV1,
    wallet_id: impl Into<String>,
    ecdsa_threshold_key_id: impl Into<String>,
    signing_root_id: impl Into<String>,
    signing_root_version: impl Into<String>,
    material_activation: MpcMaterialActivationRefV1,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationNormalSigningScopeV1> {
    receipt.validate()?;
    RouterAbEcdsaDerivationNormalSigningScopeV1::new(
        wallet_id,
        ecdsa_threshold_key_id,
        signing_root_id,
        signing_root_version,
        receipt.context.clone(),
        receipt.public_identity.clone(),
        receipt.signing_worker.clone(),
        receipt.activation_epoch.clone(),
        material_activation,
    )
}

/// Derives the Router A/B ECDSA derivation identity implied by active SigningWorker material.
pub fn cloudflare_router_ab_ecdsa_derivation_public_identity_from_normal_signing_material_v1(
    scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
    material: &CloudflareServerOutputMaterialRecordV1,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationPublicIdentityV1> {
    let (_, identity) =
        cloudflare_router_ab_ecdsa_derivation_relayer_share_and_public_identity_from_normal_signing_material_v1(
            scope, material,
        )?;
    Ok(identity)
}

pub(super) fn cloudflare_router_ab_ecdsa_derivation_relayer_share_and_public_identity_from_normal_signing_material_v1(
    scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
    material: &CloudflareServerOutputMaterialRecordV1,
) -> RouterAbProtocolResult<(
    router_ab_ecdsa_derivation::RelayerRoleShare,
    RouterAbEcdsaDerivationPublicIdentityV1,
)> {
    scope.validate()?;
    material.validate()?;
    if material.recipient_identity != scope.signing_worker.server_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Router A/B ECDSA derivation normal-signing material recipient does not match SigningWorker",
        ));
    }
    let ecdsa_context =
        cloudflare_router_ab_ecdsa_derivation_stable_key_context_v1(&scope.context)?;
    let derivation_client_share_public_key33 = decode_base64url_fixed_33_v1(
        "Router A/B ECDSA derivation normal signing derivation_client_share_public_key33_b64u",
        &scope
            .public_identity
            .derivation_client_share_public_key33_b64u,
    )?;
    let (relayer_share, identity) = derive_relayer_share_for_client_public(
        &ecdsa_context,
        *material.output_material.as_bytes(),
        &derivation_client_share_public_key33,
        scope.public_identity.client_share_retry_counter,
    )
    .map_err(map_router_ab_ecdsa_derivation_error_v1)?;
    let identity = RouterAbEcdsaDerivationPublicIdentityV1::new(
        encode_base64url_bytes_v1(&identity.context_binding32),
        encode_base64url_bytes_v1(&identity.derivation_client_share_public_key33),
        encode_base64url_bytes_v1(&identity.relayer_public_key33),
        encode_base64url_bytes_v1(&identity.threshold_public_key33),
        encode_base64url_bytes_v1(&identity.threshold_ethereum_address20),
        identity.client_share_retry_counter,
        identity.relayer_share_retry_counter,
    )?;
    if identity != scope.public_identity {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Router A/B ECDSA derivation normal-signing material does not match public identity",
        ));
    }
    Ok((relayer_share, identity))
}

pub(super) fn cloudflare_router_ab_ecdsa_derivation_relayer_share_and_public_identity_from_source_preserving_material_v1(
    scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
    material: &CloudflareServerOutputMaterialRecordV1,
) -> RouterAbProtocolResult<(RelayerRoleShare, RouterAbEcdsaDerivationPublicIdentityV1)> {
    scope.validate()?;
    material.validate()?;
    if material.recipient_identity != scope.signing_worker.server_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Router A/B source-preserving ECDSA material recipient does not match SigningWorker",
        ));
    }
    let ecdsa_context =
        cloudflare_router_ab_ecdsa_derivation_stable_key_context_v1(&scope.context)?;
    let derivation_client_share_public_key33 = decode_base64url_fixed_33_v1(
        "Router A/B source-preserving ECDSA derivation client public key",
        &scope
            .public_identity
            .derivation_client_share_public_key33_b64u,
    )?;
    let relayer_public_key33 =
        ecdsa_lane_client_public_key_from_share32_v1(*material.output_material.as_bytes())
            .map_err(map_router_ab_ecdsa_derivation_error_v1)?;
    let identity = compose_public_identity_from_public_keys(
        &ecdsa_context,
        &derivation_client_share_public_key33,
        scope.public_identity.client_share_retry_counter,
        &relayer_public_key33,
        scope.public_identity.server_share_retry_counter,
    )
    .map_err(map_router_ab_ecdsa_derivation_error_v1)?;
    let public_identity = RouterAbEcdsaDerivationPublicIdentityV1::new(
        encode_base64url_bytes_v1(&identity.context_binding32),
        encode_base64url_bytes_v1(&identity.derivation_client_share_public_key33),
        encode_base64url_bytes_v1(&identity.relayer_public_key33),
        encode_base64url_bytes_v1(&identity.threshold_public_key33),
        encode_base64url_bytes_v1(&identity.threshold_ethereum_address20),
        identity.client_share_retry_counter,
        identity.relayer_share_retry_counter,
    )?;
    if public_identity != scope.public_identity {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Router A/B source-preserving ECDSA material does not match public identity",
        ));
    }
    let context_bytes =
        encode_context(&ecdsa_context).map_err(map_router_ab_ecdsa_derivation_error_v1)?;
    let relayer_share = RelayerRoleShare {
        context_bytes,
        context_binding32: identity.context_binding32,
        retry_counter: identity.relayer_share_retry_counter,
        x_relayer32: *material.output_material.as_bytes(),
        relayer_public_key33,
    };
    Ok((relayer_share, public_identity))
}

pub(super) fn cloudflare_router_ab_ecdsa_derivation_relayer_share_and_public_identity_from_active_material_v1(
    scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
    active_signing_worker: &ActiveSigningWorkerStateV1,
    material: &CloudflareServerOutputMaterialRecordV1,
) -> RouterAbProtocolResult<(RelayerRoleShare, RouterAbEcdsaDerivationPublicIdentityV1)> {
    if active_signing_worker
        .signing_worker_material_handle
        .starts_with(SOURCE_PRESERVING_ECDSA_MATERIAL_HANDLE_PREFIX_V1)
    {
        cloudflare_router_ab_ecdsa_derivation_relayer_share_and_public_identity_from_source_preserving_material_v1(
            scope, material,
        )
    } else {
        cloudflare_router_ab_ecdsa_derivation_relayer_share_and_public_identity_from_normal_signing_material_v1(
            scope, material,
        )
    }
}

pub(super) fn cloudflare_router_ab_ecdsa_derivation_public_identity_from_material_parts_v1(
    context: &RouterAbEcdsaDerivationStableKeyContextV1,
    public_identity: &RouterAbEcdsaDerivationPublicIdentityV1,
    signing_worker: &ServerIdentityV1,
    material: &CloudflareServerOutputMaterialRecordV1,
    label: &str,
) -> RouterAbProtocolResult<RouterAbEcdsaDerivationPublicIdentityV1> {
    context.validate()?;
    public_identity.validate_for_context(context)?;
    signing_worker.validate()?;
    material.validate()?;
    if material.recipient_identity != signing_worker.server_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} recipient does not match SigningWorker"),
        ));
    }
    let ecdsa_context = cloudflare_router_ab_ecdsa_derivation_stable_key_context_v1(context)?;
    let derivation_client_share_public_key33 = decode_base64url_fixed_33_v1(
        "Router A/B ECDSA derivation normal signing derivation_client_share_public_key33_b64u",
        &public_identity.derivation_client_share_public_key33_b64u,
    )?;
    let (_relayer_share, identity) = derive_relayer_share_for_client_public(
        &ecdsa_context,
        *material.output_material.as_bytes(),
        &derivation_client_share_public_key33,
        public_identity.client_share_retry_counter,
    )
    .map_err(map_router_ab_ecdsa_derivation_error_v1)?;
    RouterAbEcdsaDerivationPublicIdentityV1::new(
        encode_base64url_bytes_v1(&identity.context_binding32),
        encode_base64url_bytes_v1(&identity.derivation_client_share_public_key33),
        encode_base64url_bytes_v1(&identity.relayer_public_key33),
        encode_base64url_bytes_v1(&identity.threshold_public_key33),
        encode_base64url_bytes_v1(&identity.threshold_ethereum_address20),
        identity.client_share_retry_counter,
        identity.relayer_share_retry_counter,
    )
}

/// Validates that active SigningWorker state and material belong to a Router A/B ECDSA derivation scope.
pub fn validate_cloudflare_router_ab_ecdsa_derivation_normal_signing_active_material_v1(
    scope: &RouterAbEcdsaDerivationNormalSigningScopeV1,
    active_signing_worker: &ActiveSigningWorkerStateV1,
    material: &CloudflareServerOutputMaterialRecordV1,
) -> RouterAbProtocolResult<()> {
    scope.validate()?;
    active_signing_worker.validate()?;
    material.validate()?;
    if active_signing_worker.account_id != scope.wallet_id
        || active_signing_worker.material_activation != scope.material_activation
        || active_signing_worker.signing_worker != scope.signing_worker
        || material.transcript_digest != active_signing_worker.activation_transcript_digest
        || material.recipient_identity != active_signing_worker.signing_worker.server_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Router A/B ECDSA derivation normal-signing active state does not match scope",
        ));
    }
    let derived_identity = if active_signing_worker
        .signing_worker_material_handle
        .starts_with(SOURCE_PRESERVING_ECDSA_MATERIAL_HANDLE_PREFIX_V1)
    {
        let (_, identity) =
            cloudflare_router_ab_ecdsa_derivation_relayer_share_and_public_identity_from_source_preserving_material_v1(
                scope, material,
            )?;
        identity
    } else {
        cloudflare_router_ab_ecdsa_derivation_public_identity_from_normal_signing_material_v1(
            scope, material,
        )?
    };
    if derived_identity == scope.public_identity {
        return Ok(());
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        "Router A/B ECDSA derivation normal-signing active material does not match public identity",
    ))
}

/// Validates direct active lane material against the authoritative linked-device scope.
pub(crate) fn validate_cloudflare_linked_device_ecdsa_normal_signing_active_material_v1(
    scope: &RouterAbEcdsaDerivationLinkedDeviceNormalSigningScopeV1,
    active_signing_worker: &ActiveSigningWorkerStateV1,
    material: &CloudflareServerOutputMaterialRecordV1,
) -> RouterAbProtocolResult<()> {
    scope.validate()?;
    active_signing_worker.validate()?;
    material.validate()?;
    let signing_worker = ServerIdentityV1::new(
        scope.signing_worker_participant_id.clone(),
        scope.signing_worker_recipient_key_id.clone(),
        scope.signing_worker_hpke_public_key_b64u.clone(),
    )?;
    let transcript = PublicDigest32::new(decode_base64url_fixed_32_v1(
        "linked ECDSA transcript_hash_b64u",
        &scope.transcript_hash_b64u,
    )?);
    if active_signing_worker.account_id != scope.wallet_id
        || active_signing_worker.material_activation != scope.material_activation
        || active_signing_worker.signing_worker != signing_worker
        || active_signing_worker.activation_transcript_digest != transcript
        || material.transcript_digest != transcript
        || material.recipient_identity != scope.signing_worker_participant_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "linked ECDSA active lane material does not match authoritative scope",
        ));
    }
    let server_public =
        ecdsa_lane_client_public_key_from_share32_v1(*material.output_material.as_bytes())
            .map_err(map_router_ab_ecdsa_derivation_error_v1)?;
    if encode_base64url_bytes_v1(&server_public) == scope.target_server_public_commitment_b64u {
        return Ok(());
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        "linked ECDSA server share does not match committed public identity",
    ))
}

/// Builds the active SigningWorker state descriptor from a validated activation request.
pub fn cloudflare_active_signing_worker_state_from_activation_request_v1(
    request: &CloudflareSigningWorkerRecipientProofBundleActivationRequestV1,
    material_activation: MpcMaterialActivationRefV1,
    signing_worker_material_handle: impl Into<String>,
    activated_at_ms: u64,
) -> RouterAbProtocolResult<ActiveSigningWorkerStateV1> {
    request.validate()?;
    material_activation.validate()?;
    let lifecycle = request.activation_context.lifecycle();
    let selected_server = request
        .activation_context
        .signer_set()
        .selected_server
        .clone();
    if material_activation.material_owner != lifecycle.account_id
        || material_activation.signing_worker != selected_server.server_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "material activation does not match SigningWorker activation context",
        ));
    }
    ActiveSigningWorkerStateV1::new(
        lifecycle.account_id.clone(),
        material_activation,
        request
            .activation_context
            .transcript_metadata
            .account_public_key
            .clone(),
        selected_server,
        request.activation_context.transcript_digest(),
        cloudflare_signing_worker_recipient_proof_bundle_activation_digest_v1(&request.activation)?,
        signing_worker_material_handle,
        activated_at_ms,
    )
}

/// Strict Router result for Router A/B ECDSA derivation registration/bootstrap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum CloudflareRouterAbEcdsaDerivationRegistrationAdmissionResponseV1 {
    /// Request was accepted and both recipient-specific bundle pairs were aggregated.
    Forwarded {
        /// Public client proof-bundle response.
        response: Box<CloudflareRouterRecipientProofBundleResponseV1>,
        /// Server-retained pending activation awaiting verified client facts.
        pending_activation: Box<CloudflareRouterAbEcdsaDerivationPendingSigningWorkerActivationV1>,
    },
    /// Request stopped at the Router gate before signer forwarding.
    Stopped {
        /// Trusted Router-owned gate decision.
        decision: ExpensiveWorkGateDecisionV1,
    },
}

impl CloudflareRouterAbEcdsaDerivationRegistrationAdmissionResponseV1 {
    /// Creates a forwarded Router A/B ECDSA derivation registration response.
    pub fn forwarded(
        response: CloudflareRouterRecipientProofBundleResponseV1,
        pending_activation: CloudflareRouterAbEcdsaDerivationPendingSigningWorkerActivationV1,
    ) -> RouterAbProtocolResult<Self> {
        let result = Self::Forwarded {
            response: Box::new(response),
            pending_activation: Box::new(pending_activation),
        };
        result.validate()?;
        Ok(result)
    }

    /// Creates a stopped Router A/B ECDSA derivation registration response.
    pub fn stopped(decision: ExpensiveWorkGateDecisionV1) -> RouterAbProtocolResult<Self> {
        let result = Self::Stopped { decision };
        result.validate()?;
        Ok(result)
    }

    /// Validates Router A/B ECDSA derivation registration response fields.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        match self {
            Self::Forwarded {
                response,
                pending_activation,
            } => {
                response.validate()?;
                pending_activation.validate()
            }
            Self::Stopped { decision } => decision.validate(),
        }
    }
}

/// Strict Router result for Router A/B ECDSA derivation explicit export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterAbEcdsaDerivationExportAuthorityV1 {
    /// Exact key handle selected by the authenticated Wallet Session.
    pub key_handle: String,
    /// Exact operation authority carried by the authenticated Wallet Session.
    pub authorization: NormalSigningAuthorizationV1,
    /// Exact active normal-signing capability carried by the Wallet Session.
    pub normal_signing_scope: RouterAbEcdsaDerivationNormalSigningScopeV1,
}

impl CloudflareRouterAbEcdsaDerivationExportAuthorityV1 {
    /// Validates the authenticated export authority against its public request.
    pub fn validate_for_request(
        &self,
        request: &RouterAbEcdsaDerivationExplicitExportRequestV1,
    ) -> RouterAbProtocolResult<()> {
        request.validate()?;
        self.normal_signing_scope.validate()?;
        require_non_empty("ECDSA export authority key_handle", &self.key_handle)?;
        self.authorization.validate()?;
        let scope = &self.normal_signing_scope;
        if self.authorization != request.authorization
            || scope.wallet_id != request.lifecycle.account_id
            || scope.context != request.context
            || scope.public_identity != request.public_identity
            || scope.signing_worker != request.signer_set.selected_server
            || scope.activation_epoch != request.lifecycle.root_share_epoch.as_str()
            || scope.material_activation != request.material_activation
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "authenticated ECDSA export authority does not match the requested capability",
            ));
        }
        Ok(())
    }
}

/// Server-private authorization identity forwarded to SigningWorker for one
/// exact ECDSA export redemption.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareSigningWorkerEcdsaExportAuthorizationV1 {
    /// Exact reusable Wallet Session identity.
    ReusableWalletSession { wallet_session_id: String },
    /// Verified step-up evidence identity kept off the public request.
    OperationStepUp { evidence_set_digest: String },
}

impl CloudflareSigningWorkerEcdsaExportAuthorizationV1 {
    pub(super) fn validate_for_public_authorization(
        &self,
        authorization: &NormalSigningAuthorizationV1,
    ) -> RouterAbProtocolResult<()> {
        match (authorization, self) {
            (
                NormalSigningAuthorizationV1::ReusableWalletSession {
                    wallet_session_id: expected,
                },
                Self::ReusableWalletSession { wallet_session_id },
            ) => {
                require_non_empty("ECDSA export private wallet_session_id", wallet_session_id)?;
                if wallet_session_id != expected {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "ECDSA export private Wallet Session identity does not match the public request",
                    ));
                }
                Ok(())
            }
            (
                NormalSigningAuthorizationV1::OperationStepUp,
                Self::OperationStepUp {
                    evidence_set_digest,
                },
            ) => {
                decode_public_digest_b64u_v1(
                    "ECDSA export private evidence_set_digest",
                    evidence_set_digest,
                )?;
                Ok(())
            }
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "ECDSA export private authorization branch does not match the public request",
            )),
        }
    }

    pub(super) fn validate_for_request(
        &self,
        request: &RouterAbEcdsaDerivationExplicitExportRequestV1,
    ) -> RouterAbProtocolResult<()> {
        request.validate()?;
        self.validate_for_public_authorization(&request.authorization)
    }

    pub(super) fn binding_authorization_kind(&self) -> &'static str {
        match self {
            Self::ReusableWalletSession { .. } => "reusable_wallet_session",
            Self::OperationStepUp { .. } => "verified_step_up",
        }
    }

    pub(super) fn authorization_id(&self) -> &str {
        match self {
            Self::ReusableWalletSession { wallet_session_id }
            | Self::OperationStepUp {
                evidence_set_digest: wallet_session_id,
            } => wallet_session_id,
        }
    }
}

/// Server-resolved coordinates for one tenant's active derivation root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareTenantRootCoordinatesV1 {
    /// Canonical tenant identity digest.
    pub identity_digest_b64u: String,
    /// Canonical custody lineage identifier.
    pub custody_lineage_b64u: String,
}

impl CloudflareTenantRootCoordinatesV1 {
    pub fn resolve(
        &self,
    ) -> RouterAbProtocolResult<(TenantRootIdentityDigestV1, TenantRootCustodyLineageId)> {
        let identity_digest_bytes = decode_base64url_fixed_32_v1(
            "tenant-root identity digest",
            &self.identity_digest_b64u,
        )?;
        if encode_base64url_bytes_v1(&identity_digest_bytes) != self.identity_digest_b64u {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "tenant-root identity digest is not canonical base64url",
            ));
        }
        let custody_lineage = TenantRootCustodyLineageId::from_base64url(
            &self.custody_lineage_b64u,
        )
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("tenant-root custody lineage is invalid: {error}"),
            )
        })?;
        Ok((
            TenantRootIdentityDigestV1::from_bytes(identity_digest_bytes),
            custody_lineage,
        ))
    }
}

/// Gateway-admitted explicit-export request and exact Wallet Session capability.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterAbEcdsaDerivationExportCommandV1 {
    /// Typed explicit-export request created by the browser ceremony.
    pub request: RouterAbEcdsaDerivationExplicitExportRequestV1,
    /// Exact authority derived from the authenticated ECDSA Wallet Session.
    pub export_authority: CloudflareRouterAbEcdsaDerivationExportAuthorityV1,
    /// Exact active SigningWorker material source selected by Gateway admission.
    pub material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    /// Server-private authorization identity for SigningWorker redemption.
    pub private_authorization: CloudflareSigningWorkerEcdsaExportAuthorizationV1,
    /// Tenant-root coordinates resolved by the authenticated server boundary.
    pub tenant_root: CloudflareTenantRootCoordinatesV1,
}

impl CloudflareRouterAbEcdsaDerivationExportCommandV1 {
    /// Validates the request and authenticated capability as one command.
    pub fn validate_at(&self, now_unix_ms: u64) -> RouterAbProtocolResult<()> {
        self.request.validate_at(now_unix_ms)?;
        self.export_authority.validate_for_request(&self.request)?;
        self.material_source
            .validate_for_ecdsa_scope(&self.export_authority.normal_signing_scope)?;
        self.private_authorization
            .validate_for_request(&self.request)?;
        self.tenant_root.resolve()?;
        Ok(())
    }
}

/// Gateway-admitted activation refresh with server-resolved tenant-root coordinates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterAbEcdsaDerivationActivationRefreshCommandV1 {
    /// Typed activation-refresh request created by the browser ceremony.
    pub refresh_request: RouterAbEcdsaDerivationActivationRefreshRequestV1,
    /// Tenant-root coordinates resolved by the authenticated server boundary.
    pub tenant_root: CloudflareTenantRootCoordinatesV1,
}

impl CloudflareRouterAbEcdsaDerivationActivationRefreshCommandV1 {
    /// Validates the browser request and server-owned coordinates.
    pub fn validate_at(&self, now_unix_ms: u64) -> RouterAbProtocolResult<()> {
        self.refresh_request.validate_at(now_unix_ms)?;
        self.tenant_root.resolve()?;
        Ok(())
    }
}

/// Private MPCRouter request for one exact SigningWorker export-share delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareSigningWorkerEcdsaExportShareRequestV1 {
    pub ownership_generation: u64,
    /// Exact browser export request admitted by MPCRouter.
    pub request: RouterAbEcdsaDerivationExplicitExportRequestV1,
    /// Exact authenticated Wallet Session capability forwarded by Gateway.
    pub export_authority: CloudflareRouterAbEcdsaDerivationExportAuthorityV1,
    /// Exact active SigningWorker material source selected by Gateway admission.
    pub material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    /// Server-private authorization identity forwarded by Router.
    pub private_authorization: CloudflareSigningWorkerEcdsaExportAuthorizationV1,
    /// The wallet whose material is exported, from the Router-verified
    /// ceremony session.
    pub wallet_scope: CloudflareSigningWorkerWalletScopeV1,
}

/// Private request for one exact active additive-lane export share.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareSigningWorkerLinkedEcdsaExportShareRequestV1 {
    pub scope: RouterAbEcdsaDerivationLinkedDeviceNormalSigningScopeV1,
    pub material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    pub binding: EcdsaSigningWorkerExportShareBindingV1,
}

impl CloudflareSigningWorkerLinkedEcdsaExportShareRequestV1 {
    pub fn validate_at(&self, now_unix_ms: u64) -> RouterAbProtocolResult<()> {
        self.scope.validate()?;
        self.material_source
            .validate_for_linked_ecdsa_scope(&self.scope)?;
        self.binding.validate().map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "linked ECDSA export-share binding is invalid",
            )
        })?;
        let activation = &self.scope.material_activation;
        let expected = &self.binding;
        if expected.wallet_id != self.scope.wallet_id
            || expected.key_handle != self.scope.wallet_key_id
            || expected.ecdsa_threshold_key_id
                != self.scope.target_capability.ecdsa_threshold_key_id
            || expected.signing_root_id != self.scope.lane_id
            || expected.signing_root_version != self.scope.lane_share_epoch
            || expected.activation_epoch != self.scope.lane_share_epoch
            || expected.signing_worker_id != self.scope.signing_worker_participant_id
            || expected.context_binding_b64u != self.scope.public_identity_digest_b64u
            || expected.threshold_public_key33_b64u != self.scope.threshold_public_key33_b64u
            || expected.authorization_kind != "reusable_wallet_session"
            || expected.material_activation.activation_id != activation.activation_id
            || expected.material_activation.capability != activation.capability
            || expected.material_activation.material_owner != activation.material_owner
            || expected.material_activation.key_binding != activation.key_binding
            || expected.material_activation.lifecycle_binding != activation.lifecycle_binding
            || expected.material_activation.signing_worker != activation.signing_worker
            || expected.expires_at_ms <= now_unix_ms
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "linked ECDSA export-share request changed its admitted lane identity",
            ));
        }
        Ok(())
    }
}

/// No-secret acknowledgement that the requested ECDSA export material is active.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareSigningWorkerEcdsaExportPreflightResponseV1 {
    /// Fixed success marker.
    pub ready: bool,
}

impl CloudflareSigningWorkerEcdsaExportShareRequestV1 {
    /// Validates the private request at SigningWorker time.
    pub fn validate_at(&self, now_unix_ms: u64) -> RouterAbProtocolResult<()> {
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)?;
        self.request.validate_at(now_unix_ms)?;
        self.export_authority.validate_for_request(&self.request)?;
        self.material_source
            .validate_for_ecdsa_scope(&self.export_authority.normal_signing_scope)?;
        self.wallet_scope.validate()?;
        if self.wallet_scope.wallet_id != self.export_authority.normal_signing_scope.wallet_id {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "ECDSA export wallet scope does not match the exported key",
            ));
        }
        self.private_authorization
            .validate_for_request(&self.request)
    }

    pub(super) fn export_share_binding(
        &self,
    ) -> RouterAbProtocolResult<EcdsaSigningWorkerExportShareBindingV1> {
        self.export_authority.validate_for_request(&self.request)?;
        self.material_source
            .validate_for_ecdsa_scope(&self.export_authority.normal_signing_scope)?;
        self.private_authorization
            .validate_for_request(&self.request)?;
        let scope = &self.export_authority.normal_signing_scope;
        let threshold_public_key33_b64u = match &self.material_source {
            CloudflareSigningWorkerNormalSigningMaterialSourceV1::RegistrationActivation {
                ..
            } => scope.public_identity.threshold_public_key33_b64u.clone(),
            CloudflareSigningWorkerNormalSigningMaterialSourceV1::RotatableLane {
                group_public_key,
                ..
            } => group_public_key.clone(),
        };
        let binding = EcdsaSigningWorkerExportShareBindingV1 {
            wallet_id: scope.wallet_id.clone(),
            key_handle: self.export_authority.key_handle.clone(),
            ecdsa_threshold_key_id: scope.ecdsa_threshold_key_id.clone(),
            signing_root_id: scope.signing_root_id.clone(),
            signing_root_version: scope.signing_root_version.clone(),
            activation_epoch: scope.activation_epoch.clone(),
            signing_worker_id: scope.signing_worker.server_id.clone(),
            context_binding_b64u: scope.public_identity.context_binding_b64u.clone(),
            threshold_public_key33_b64u,
            export_request_digest_b64u: encode_base64url_bytes_v1(
                self.request.request_digest()?.as_bytes(),
            ),
            export_authorization_digest_b64u: self.request.export_authorization_digest_b64u.clone(),
            export_nonce: self.request.export_nonce.clone(),
            authorization_kind: self
                .private_authorization
                .binding_authorization_kind()
                .to_owned(),
            authorization_id: self.private_authorization.authorization_id().to_owned(),
            material_activation: EcdsaMaterialActivationRefV1 {
                kind: EcdsaMaterialActivationRefKindV1::MpcMaterialActivationRef,
                activation_id: scope.material_activation.activation_id.clone(),
                capability: scope.material_activation.capability.clone(),
                material_owner: scope.material_activation.material_owner.clone(),
                key_binding: scope.material_activation.key_binding.clone(),
                lifecycle_binding: scope.material_activation.lifecycle_binding.clone(),
                signing_worker: scope.material_activation.signing_worker.clone(),
            },
            lifecycle_id: self.request.lifecycle.lifecycle_id.clone(),
            recipient_identity: self.request.client_id.clone(),
            recipient_public_key: self.request.client_ephemeral_public_key.clone(),
            expires_at_ms: self.request.expires_at_ms,
        };
        binding.validate().map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "SigningWorker ECDSA export-share binding is invalid",
            )
        })?;
        Ok(binding)
    }
}

/// Strict Router result for Router A/B ECDSA derivation explicit export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum CloudflareRouterAbEcdsaDerivationExportAdmissionResponseV1 {
    /// Request was accepted and client export bundles were aggregated.
    Forwarded {
        /// Public client proof-bundle response.
        response: CloudflareRouterRecipientProofBundleResponseV1,
        /// Exact SigningWorker additive share encrypted to the authorized browser recipient.
        signing_worker_export: EcdsaSigningWorkerExportShareEnvelopeV1,
    },
    /// Request stopped at the Router gate before signer forwarding.
    Stopped {
        /// Trusted Router-owned gate decision.
        decision: ExpensiveWorkGateDecisionV1,
    },
}

impl CloudflareRouterAbEcdsaDerivationExportAdmissionResponseV1 {
    /// Creates a forwarded Router A/B ECDSA derivation export response.
    pub fn forwarded(
        response: CloudflareRouterRecipientProofBundleResponseV1,
        signing_worker_export: EcdsaSigningWorkerExportShareEnvelopeV1,
    ) -> RouterAbProtocolResult<Self> {
        let result = Self::Forwarded {
            response,
            signing_worker_export,
        };
        result.validate()?;
        Ok(result)
    }

    /// Creates a stopped Router A/B ECDSA derivation export response.
    pub fn stopped(decision: ExpensiveWorkGateDecisionV1) -> RouterAbProtocolResult<Self> {
        let result = Self::Stopped { decision };
        result.validate()?;
        Ok(result)
    }

    /// Validates Router A/B ECDSA derivation export response fields.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        match self {
            Self::Forwarded {
                response,
                signing_worker_export,
            } => {
                response.validate()?;
                signing_worker_export.validate().map_err(|_| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        "SigningWorker ECDSA export-share envelope is invalid",
                    )
                })
            }
            Self::Stopped { decision } => decision.validate(),
        }
    }
}

/// Strict Router result for Router A/B ECDSA derivation activation refresh.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum CloudflareRouterAbEcdsaDerivationActivationRefreshAdmissionResponseV1 {
    /// Request was accepted, client bundles were aggregated, and ECDSA activation refreshed.
    Forwarded {
        /// Public client proof-bundle response.
        response: Box<CloudflareRouterRecipientProofBundleResponseV1>,
        /// Router A/B ECDSA derivation SigningWorker activation-refresh receipt.
        signing_worker_activation:
            Box<CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1>,
    },
    /// Request stopped at the Router gate before signer forwarding.
    Stopped {
        /// Trusted Router-owned gate decision.
        decision: ExpensiveWorkGateDecisionV1,
    },
}

impl CloudflareRouterAbEcdsaDerivationActivationRefreshAdmissionResponseV1 {
    /// Creates a forwarded Router A/B ECDSA derivation refresh response.
    pub fn forwarded(
        response: CloudflareRouterRecipientProofBundleResponseV1,
        signing_worker_activation: CloudflareRouterAbEcdsaDerivationSigningWorkerActivationReceiptV1,
    ) -> RouterAbProtocolResult<Self> {
        let result = Self::Forwarded {
            response: Box::new(response),
            signing_worker_activation: Box::new(signing_worker_activation),
        };
        result.validate()?;
        Ok(result)
    }

    /// Creates a stopped Router A/B ECDSA derivation refresh response.
    pub fn stopped(decision: ExpensiveWorkGateDecisionV1) -> RouterAbProtocolResult<Self> {
        let result = Self::Stopped { decision };
        result.validate()?;
        Ok(result)
    }

    /// Validates Router A/B ECDSA derivation refresh response fields.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        match self {
            Self::Forwarded {
                response,
                signing_worker_activation,
            } => {
                response.validate()?;
                signing_worker_activation.validate()
            }
            Self::Stopped { decision } => decision.validate(),
        }
    }
}
