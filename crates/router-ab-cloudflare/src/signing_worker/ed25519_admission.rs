use super::*;

/// Router-admitted v2 prepare request sent to SigningWorker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2 {
    /// Normal signing identity and active SigningWorker scope.
    pub scope: NormalSigningScopeV1,
    /// Request expiry in Unix milliseconds.
    pub expires_at_ms: u64,
    /// Router-derived v2 normal-signing prepare admission candidate.
    pub admission_candidate: CloudflareRouterNormalSigningPrepareAdmissionCandidateV2,
    /// Accepted Router store admission decision for this request.
    pub trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
    /// Exact active material source selected by the Gateway.
    pub material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    pub wallet_scope: CloudflareSigningWorkerWalletScopeV1,
    pub ownership_generation: u64,
}

impl CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2 {
    /// Creates a validated admitted v2 prepare service request.
    pub fn new(
        ownership_generation: u64,
        wallet_scope: CloudflareSigningWorkerWalletScopeV1,
        scope: NormalSigningScopeV1,
        expires_at_ms: u64,
        admission_candidate: CloudflareRouterNormalSigningPrepareAdmissionCandidateV2,
        trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
    ) -> RouterAbProtocolResult<Self> {
        let material_source =
            CloudflareSigningWorkerNormalSigningMaterialSourceV1::registration_for_scope(&scope)?;
        let request = Self {
            scope,
            expires_at_ms,
            admission_candidate,
            trusted_admission,
            material_source,
            wallet_scope,
            ownership_generation,
        };
        request.validate()?;
        Ok(request)
    }

    /// Creates a request with the Gateway-admitted source branch.
    pub fn new_with_material_source(
        ownership_generation: u64,
        wallet_scope: CloudflareSigningWorkerWalletScopeV1,
        scope: NormalSigningScopeV1,
        expires_at_ms: u64,
        admission_candidate: CloudflareRouterNormalSigningPrepareAdmissionCandidateV2,
        trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
        material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    ) -> RouterAbProtocolResult<Self> {
        let request = Self {
            scope,
            expires_at_ms,
            admission_candidate,
            trusted_admission,
            material_source,
            wallet_scope,
            ownership_generation,
        };
        request.validate()?;
        Ok(request)
    }

    /// Validates Router admission accepted this exact v2 prepare request.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)?;
        let wallet_scope = &self.wallet_scope;
        wallet_scope.validate()?;
        if wallet_scope.org_id != self.admission_candidate.org_id
            || wallet_scope.project_id != self.admission_candidate.project_id
            || wallet_scope.wallet_id != self.scope.account_id
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "normal-signing wallet scope differs from Router admission",
            ));
        }
        self.scope.validate()?;
        self.material_source
            .validate_for_normal_scope(&self.scope)?;
        require_positive_ms(
            "normal-signing v2 prepare expires_at_ms",
            self.expires_at_ms,
        )?;
        self.admission_candidate.validate()?;
        self.trusted_admission.validate()?;
        if self.admission_candidate.account_id != self.scope.account_id
            || self.admission_candidate.signing_worker_id != self.scope.signing_worker_id
            || self.admission_candidate.request_id != self.scope.request_id
            || self.admission_candidate.expires_at_ms != self.expires_at_ms
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "normal-signing v2 prepare admission does not match request scope",
            ));
        }
        self.admission_candidate
            .authorization
            .validate_for_scope(&self.scope.authorization)?;
        if self.admission_candidate.round1_binding_digest.is_none() {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "normal-signing v2 prepare admission requires round1 binding digest",
            ));
        }
        if self.trusted_admission.metadata != self.admission_candidate.to_v1_trusted_metadata()? {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "normal-signing v2 trusted admission metadata does not match internal admission",
            ));
        }
        if self.trusted_admission.allows_signing_worker_forwarding()? {
            return Ok(());
        }
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "SigningWorker normal-signing v2 prepare requires accepted Router admission",
        ))
    }

    pub(crate) fn round1_binding_digest(&self) -> RouterAbProtocolResult<PublicDigest32> {
        self.admission_candidate
            .round1_binding_digest
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "normal-signing v2 prepare admission requires round1 binding digest",
                )
            })
    }
}

/// Router-admitted v2 finalize request sent to SigningWorker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2 {
    /// Typed public finalize request accepted by the Router.
    pub request: RouterAbEd25519NormalSigningFinalizeRequestV2,
    /// Router-derived finalize admission, including the exact authorization branch.
    pub admission_candidate: CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2,
    /// Accepted Router store admission decision for this request.
    pub trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
    /// Exact accepted operation identity reconstructed by the Router boundary.
    pub authorized_operation_identity: CloudflareSigningWorkerAuthorizedOperationIdentityV1,
    /// Exact claim that the SigningWorker must commit before evaluating crypto.
    pub effect_claim: CloudflareSigningWorkerNormalSigningEffectClaimV1,
    /// Exact active material source selected by the Gateway.
    pub material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    pub wallet_scope: CloudflareSigningWorkerWalletScopeV1,
    pub ownership_generation: u64,
}

impl CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2 {
    /// Creates a validated admitted v2 finalize service request.
    pub fn new(
        ownership_generation: u64,
        wallet_scope: CloudflareSigningWorkerWalletScopeV1,
        request: RouterAbEd25519NormalSigningFinalizeRequestV2,
        admission_candidate: CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2,
        trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
        authorized_operation_identity: CloudflareSigningWorkerAuthorizedOperationIdentityV1,
        effect_claim: CloudflareSigningWorkerNormalSigningEffectClaimV1,
    ) -> RouterAbProtocolResult<Self> {
        let material_source =
            CloudflareSigningWorkerNormalSigningMaterialSourceV1::registration_for_scope(
                &request.scope,
            )?;
        let request = Self {
            request,
            admission_candidate,
            trusted_admission,
            authorized_operation_identity,
            effect_claim,
            material_source,
            wallet_scope,
            ownership_generation,
        };
        request.validate()?;
        Ok(request)
    }

    /// Creates a finalize request with the Gateway-admitted source branch.
    pub fn new_with_material_source(
        ownership_generation: u64,
        wallet_scope: CloudflareSigningWorkerWalletScopeV1,
        request: RouterAbEd25519NormalSigningFinalizeRequestV2,
        admission_candidate: CloudflareRouterNormalSigningFinalizeAdmissionCandidateV2,
        trusted_admission: CloudflareRouterNormalSigningTrustedAdmissionV1,
        authorized_operation_identity: CloudflareSigningWorkerAuthorizedOperationIdentityV1,
        effect_claim: CloudflareSigningWorkerNormalSigningEffectClaimV1,
        material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    ) -> RouterAbProtocolResult<Self> {
        let request = Self {
            request,
            admission_candidate,
            trusted_admission,
            authorized_operation_identity,
            effect_claim,
            material_source,
            wallet_scope,
            ownership_generation,
        };
        request.validate()?;
        Ok(request)
    }

    /// Validates Router admission accepted this exact v2 finalize request.
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)?;
        let wallet_scope = &self.wallet_scope;
        wallet_scope.validate()?;
        if wallet_scope.org_id != self.admission_candidate.org_id
            || wallet_scope.project_id != self.admission_candidate.project_id
            || wallet_scope.wallet_id != self.request.scope.account_id
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "normal-signing wallet scope differs from Router admission",
            ));
        }
        self.request.validate()?;
        self.material_source
            .validate_for_normal_scope(&self.request.scope)?;
        self.admission_candidate
            .validate_for_finalize_request(&self.request)?;
        self.trusted_admission
            .validate_for_finalize_request_v2(&self.request)?;
        if self.trusted_admission.metadata != self.admission_candidate.to_v1_trusted_metadata()? {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "normal-signing finalize trusted admission does not match admission candidate",
            ));
        }
        self.effect_claim
            .validate_for_admission(&self.admission_candidate)?;
        self.effect_claim
            .validate_for_authorized_operation_identity(&self.authorized_operation_identity)?;
        if self.trusted_admission.allows_signing_worker_forwarding()? {
            return Ok(());
        }
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidGateDecision,
            "SigningWorker normal-signing v2 finalize requires accepted Router admission",
        ))
    }

    /// Stable effect key derived only from the admitted account and canonical intent.
    pub fn effect_operation_key(&self) -> RouterAbProtocolResult<String> {
        self.validate()?;
        Ok(format!(
            "near-ed25519/{}/{}/{}",
            self.request.scope.account_id,
            self.request.scope.material_activation.activation_id,
            cloudflare_signing_worker_digest_hex_v1(self.request.intent_digest())
        ))
    }

    /// Exact digest whose terminal response may be replayed for this operation key.
    pub fn effect_request_digest(&self) -> RouterAbProtocolResult<PublicDigest32> {
        self.validate()?;
        let mut hasher = Sha256::new();
        hasher.update(b"seams/signing-worker/near-effect/v1");
        hasher.update(serde_json::to_vec(self).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("normal-signing finalize serialization failed: {error}"),
            )
        })?);
        Ok(PublicDigest32::new(hasher.finalize().into()))
    }
}

impl CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
    pub(crate) fn ownership_generation(&self) -> RouterAbProtocolResult<u64> {
        let generation = match &self.binding {
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                ownership_generation, ..
            }
            | CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession {
                ownership_generation, ..
            }
            | CloudflareRouterEd25519AcceptedCapabilityBindingV1::OperationStepUp {
                ownership_generation, ..
            } => *ownership_generation,
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::ReusableWalletSession { .. } => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "Ed25519 execution requires a Gateway-pinned ownership generation",
                ));
            }
        };
        crate::router_wallet::validate_wallet_ownership_generation(generation)?;
        Ok(generation)
    }
}
