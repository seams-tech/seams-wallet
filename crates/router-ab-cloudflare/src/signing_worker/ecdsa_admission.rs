use super::*;

/// Router-admitted Router A/B ECDSA derivation normal-signing request sent to SigningWorker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1 {
    /// Typed public Router A/B ECDSA derivation normal-signing request accepted by the Router.
    pub request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    /// Accepted Router store admission decision for this request.
    pub trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
    /// Exact active material source selected by the Gateway.
    pub material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    #[serde(default)]
    pub presign_source: CloudflareEcdsaPrepareSourceV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wallet_scope: Option<CloudflareSigningWorkerWalletScopeV1>,
    pub ownership_generation: u64,
}

impl CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestSigningRequestV1 {
    /// Creates a validated admitted Router A/B ECDSA derivation normal-signing service request.
    pub fn new(
        ownership_generation: u64,
        request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
        trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
    ) -> RouterAbProtocolResult<Self> {
        let material_source =
            CloudflareSigningWorkerNormalSigningMaterialSourceV1::registration_for_ecdsa_scope(
                &request.scope,
            )?;
        let request = Self {
            request,
            trusted_admission,
            material_source,
            presign_source: CloudflareEcdsaPrepareSourceV1::AvailablePool,
            wallet_scope: None,
            ownership_generation,
        };
        request.validate()?;
        Ok(request)
    }

    pub fn new_with_material_source(
        ownership_generation: u64,
        request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
        trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
        material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    ) -> RouterAbProtocolResult<Self> {
        let request = Self {
            request,
            trusted_admission,
            material_source,
            presign_source: CloudflareEcdsaPrepareSourceV1::AvailablePool,
            wallet_scope: None,
            ownership_generation,
        };
        request.validate()?;
        Ok(request)
    }

    /// Validates Router-admitted Router A/B ECDSA derivation normal-signing material.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)?;
        if let Some(wallet_scope) = &self.wallet_scope {
            validate_ecdsa_wallet_scope(
                wallet_scope,
                &self.trusted_admission.metadata,
                &self.request.scope.wallet_id,
            )?;
        }
        self.request.validate()?;
        self.presign_source.validate_for_request(&self.request)?;
        self.material_source
            .validate_for_ecdsa_scope(&self.request.scope)?;
        self.trusted_admission.validate()?;
        if self.trusted_admission.metadata.account_id != self.request.scope.wallet_id {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "Router A/B ECDSA derivation trusted admission account_id does not match request scope",
            ));
        }
        match (
            &self.trusted_admission.metadata.auth,
            &self.request.authorization,
        ) {
            (
                CloudflareRouterAuthContextV1::OwnerWalletSession {
                    wallet_session_id: owner_wallet_session_id,
                    ..
                },
                NormalSigningAuthorizationV1::ReusableWalletSession {
                    wallet_session_id: scope_wallet_session_id,
                },
            ) if owner_wallet_session_id == scope_wallet_session_id => {}
            (
                CloudflareRouterAuthContextV1::RouterJwtSession { session_id, .. },
                NormalSigningAuthorizationV1::ReusableWalletSession { wallet_session_id },
            ) if session_id == wallet_session_id => {}
            (
                CloudflareRouterAuthContextV1::OwnerOperationStepUp { .. },
                NormalSigningAuthorizationV1::OperationStepUp,
            ) => {}
            _ => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "Router A/B ECDSA derivation trusted authorization does not match request",
                ));
            }
        }
        if self.trusted_admission.metadata.intent_digest != self.request.request_digest()? {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "Router A/B ECDSA derivation trusted admission digest does not match request",
            ));
        }
        if self.trusted_admission.allows_signing_worker_forwarding()? {
            return Ok(());
        }
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "SigningWorker Router A/B ECDSA derivation prepare requires accepted Router admission",
        ))
    }
}

/// Router-admitted Router A/B ECDSA derivation finalize request sent to SigningWorker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1 {
    /// Typed public Router A/B ECDSA derivation finalize request accepted by the Router.
    pub request: RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    /// Accepted Router store admission decision for this request.
    pub trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
    /// Exact accepted operation identity reconstructed by the Router boundary.
    pub authorized_operation_identity: CloudflareSigningWorkerAuthorizedOperationIdentityV1,
    /// Exact Gateway authorization claim converted by Router into the worker effect claim.
    pub effect_claim: CloudflareSigningWorkerNormalSigningEffectClaimV1,
    /// Exact active material source selected by the Gateway.
    pub material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wallet_scope: Option<CloudflareSigningWorkerWalletScopeV1>,
    pub ownership_generation: u64,
}

impl CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1 {
    /// Creates a validated admitted Router A/B ECDSA derivation finalize service request.
    pub fn new(
        ownership_generation: u64,
        request: RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
        trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
        authorized_operation_identity: CloudflareSigningWorkerAuthorizedOperationIdentityV1,
        effect_claim: CloudflareSigningWorkerNormalSigningEffectClaimV1,
    ) -> RouterAbProtocolResult<Self> {
        let material_source =
            CloudflareSigningWorkerNormalSigningMaterialSourceV1::registration_for_ecdsa_scope(
                &request.scope,
            )?;
        let request = Self {
            request,
            trusted_admission,
            authorized_operation_identity,
            effect_claim,
            material_source,
            wallet_scope: None,
            ownership_generation,
        };
        request.validate()?;
        Ok(request)
    }

    pub fn new_with_material_source(
        ownership_generation: u64,
        request: RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
        trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
        authorized_operation_identity: CloudflareSigningWorkerAuthorizedOperationIdentityV1,
        effect_claim: CloudflareSigningWorkerNormalSigningEffectClaimV1,
        material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    ) -> RouterAbProtocolResult<Self> {
        let request = Self {
            request,
            trusted_admission,
            authorized_operation_identity,
            effect_claim,
            material_source,
            wallet_scope: None,
            ownership_generation,
        };
        request.validate()?;
        Ok(request)
    }

    /// Validates Router admission accepted this exact Router A/B ECDSA derivation finalize body.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)?;
        if let Some(wallet_scope) = &self.wallet_scope {
            validate_ecdsa_wallet_scope(
                wallet_scope,
                &self.trusted_admission.metadata,
                &self.request.scope.wallet_id,
            )?;
        }
        self.request.validate()?;
        self.material_source
            .validate_for_ecdsa_scope(&self.request.scope)?;
        self.trusted_admission.validate()?;
        if self.trusted_admission.metadata.account_id != self.request.scope.wallet_id {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "Router A/B ECDSA derivation finalize trusted admission account_id does not match request scope",
            ));
        }
        match (
            &self.trusted_admission.metadata.auth,
            &self.request.authorization,
        ) {
            (
                CloudflareRouterAuthContextV1::OwnerWalletSession {
                    wallet_session_id: owner_wallet_session_id,
                    ..
                },
                NormalSigningAuthorizationV1::ReusableWalletSession {
                    wallet_session_id: scope_wallet_session_id,
                },
            ) if owner_wallet_session_id == scope_wallet_session_id => {}
            (
                CloudflareRouterAuthContextV1::RouterJwtSession { session_id, .. },
                NormalSigningAuthorizationV1::ReusableWalletSession { wallet_session_id },
            ) if session_id == wallet_session_id => {}
            (
                CloudflareRouterAuthContextV1::OwnerOperationStepUp { .. },
                NormalSigningAuthorizationV1::OperationStepUp,
            ) => {}
            _ => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "Router A/B ECDSA derivation finalize trusted authorization does not match request",
                ));
            }
        }
        if self.trusted_admission.metadata.intent_digest != self.request.request_digest()? {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "Router A/B ECDSA derivation finalize trusted admission digest does not match request",
            ));
        }
        self.effect_claim
            .validate_for_ecdsa_finalize_request(&self.request)?;
        self.effect_claim
            .validate_for_authorized_operation_identity(&self.authorized_operation_identity)?;
        if self.trusted_admission.allows_signing_worker_forwarding()? {
            return Ok(());
        }
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "SigningWorker Router A/B ECDSA derivation finalize requires accepted Router admission",
        ))
    }

    /// Stable effect key shared by retries of one exact ECDSA operation.
    pub fn effect_operation_key(&self) -> RouterAbProtocolResult<String> {
        self.validate()?;
        Ok(format!(
            "evm-ecdsa/{}/{}/{}",
            self.request.scope.wallet_id,
            self.request.material_activation.activation_id,
            self.request.operation_id,
        ))
    }

    /// Exact digest whose terminal response may be replayed for this effect key.
    pub fn effect_request_digest(&self) -> RouterAbProtocolResult<PublicDigest32> {
        self.validate()?;
        let mut hasher = Sha256::new();
        hasher.update(b"seams/signing-worker/evm-ecdsa-effect/v1");
        hasher.update(serde_json::to_vec(self).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("ECDSA finalize serialization failed: {error}"),
            )
        })?);
        Ok(PublicDigest32::new(hasher.finalize().into()))
    }

    pub(crate) fn effect_authorization_key(&self) -> RouterAbProtocolResult<String> {
        self.validate()?;
        let key = match &self.effect_claim {
            CloudflareSigningWorkerNormalSigningEffectClaimV1::ReusableWalletSession { claim } => {
                format!(
                    "ecdsa-reusable-wallet-session/{}/{}/{}/{}/{}",
                    claim.authorization_id,
                    claim.wallet_session_id,
                    claim.authorized_operation_id,
                    claim.operation_id,
                    claim.operation_fingerprint_digest
                )
            }
            CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
                authorization_session_id,
                authorized_operation_id,
                operation_id,
                operation_fingerprint_digest,
                ..
            } => format!(
                "ecdsa-operation-step-up/{authorization_session_id}/{authorized_operation_id}/{operation_id}/{operation_fingerprint_digest}"
            ),
        };
        Ok(key)
    }
}
