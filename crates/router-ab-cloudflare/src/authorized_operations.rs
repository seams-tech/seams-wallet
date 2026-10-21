//! Curve-specific authorized operations and accepted capability bindings.

use crate::*;

/// Durable authorized operation attached by the authorization service to Ed25519 finalize.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareRouterEd25519AuthorizedOperationV1 {
    ReusableWalletSessionAuthorizedOperationV1 {
        authorized_operation_id: String,
        operation_id: String,
        capability_kind: CloudflareRouterEd25519CapabilityKindV1,
        operation_kind: CloudflareRouterEd25519OperationKindV1,
        lane_digest_b64u: String,
        intent_digest_b64u: String,
        display_digest_b64u: String,
        operation_fingerprint_digest: String,
    },
    VerifiedStepUpAuthorizedOperationV1 {
        authorization_session_id: String,
        evidence_set_digest: String,
        authorized_operation_id: String,
        operation_id: String,
        capability_kind: CloudflareRouterEd25519CapabilityKindV1,
        operation_kind: CloudflareRouterEd25519OperationKindV1,
        lane_digest_b64u: String,
        intent_digest_b64u: String,
        display_digest_b64u: String,
        operation_fingerprint_digest: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareRouterEd25519AcceptedCapabilityBindingV1 {
    ReusableWalletSession {
        /// Exact Wallet Session authorization record used for this operation.
        authorization_id: String,
        wallet_session_id: String,
        quota_id: String,
    },
    /// Wallet Session admission resolved by the trusted Gateway.
    GatewayOwnerWalletSession {
        ownership_generation: u64,
        subject_id: String,
        account_id: String,
        authorization_id: String,
        wallet_session_id: String,
        quota_id: String,
        threshold_session_id: String,
        org_id: String,
        project_id: String,
        environment: String,
        project_environment_id: String,
        signing_worker_id: String,
        expires_at_ms: u64,
    },
    /// Linked-device Wallet Session admission resolved by the trusted Gateway.
    GatewayLinkedDeviceWalletSession {
        ownership_generation: u64,
        subject_id: String,
        account_id: String,
        authorization_id: String,
        wallet_session_id: String,
        quota_id: String,
        org_id: String,
        project_id: String,
        environment: String,
        signing_worker_id: String,
        expires_at_ms: u64,
        material_source: CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    },
    /// Verified operation step-up resolved by the trusted Gateway. The
    /// wallet and its Console project environment are the ones the Gateway
    /// pinned when it claimed the step-up operation.
    OperationStepUp {
        ownership_generation: u64,
        authorization_session_id: String,
        org_id: String,
        project_id: String,
        environment: String,
        project_environment_id: String,
        subject_id: String,
        account_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
    pub binding: CloudflareRouterEd25519AcceptedCapabilityBindingV1,
    pub authorized_operation: CloudflareRouterEd25519AuthorizedOperationV1,
}

impl CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
    /// The wallet the SigningWorker keeps this operation's material under:
    /// the one the Gateway resolved for an owner Wallet Session or a
    /// verified step-up.
    pub(super) fn wallet_scope(
        &self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerWalletScopeV1> {
        match &self.binding {
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                org_id,
                project_id,
                project_environment_id,
                account_id,
                ..
            }
            | CloudflareRouterEd25519AcceptedCapabilityBindingV1::OperationStepUp {
                org_id,
                project_id,
                project_environment_id,
                account_id,
                ..
            } => CloudflareSigningWorkerWalletScopeV1::new(
                org_id,
                project_id,
                project_environment_id,
                account_id,
            ),
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "a Gateway owner Wallet Session or verified step-up binding is required",
            )),
        }
    }

    pub(super) fn into_signing_worker_authorized_operation_identity(
        &self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerAuthorizedOperationIdentityV1> {
        self.validate()?;
        match (&self.binding, &self.authorized_operation) {
            (
                CloudflareRouterEd25519AcceptedCapabilityBindingV1::ReusableWalletSession {
                    authorization_id,
                    wallet_session_id,
                    ..
                },
                CloudflareRouterEd25519AuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                    authorized_operation_id,
                    operation_id,
                    operation_fingerprint_digest,
                    ..
                },
            ) => Ok(CloudflareSigningWorkerAuthorizedOperationIdentityV1::ReusableWalletSession {
                authorization_id: authorization_id.clone(),
                wallet_session_id: wallet_session_id.clone(),
                authorized_operation_id: authorized_operation_id.clone(),
                operation_id: operation_id.clone(),
                operation_fingerprint_digest: operation_fingerprint_digest.clone(),
            }),
            (
                CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                    authorization_id,
                    wallet_session_id,
                    ..
                },
                CloudflareRouterEd25519AuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                    authorized_operation_id,
                    operation_id,
                    operation_fingerprint_digest,
                    ..
                },
            ) => Ok(CloudflareSigningWorkerAuthorizedOperationIdentityV1::ReusableWalletSession {
                authorization_id: authorization_id.clone(),
                wallet_session_id: wallet_session_id.clone(),
                authorized_operation_id: authorized_operation_id.clone(),
                operation_id: operation_id.clone(),
                operation_fingerprint_digest: operation_fingerprint_digest.clone(),
            }),
            (
                CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession {
                    authorization_id,
                    wallet_session_id,
                    ..
                },
                CloudflareRouterEd25519AuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                    authorized_operation_id,
                    operation_id,
                    operation_fingerprint_digest,
                    ..
                },
            ) => Ok(CloudflareSigningWorkerAuthorizedOperationIdentityV1::ReusableWalletSession {
                authorization_id: authorization_id.clone(),
                wallet_session_id: wallet_session_id.clone(),
                authorized_operation_id: authorized_operation_id.clone(),
                operation_id: operation_id.clone(),
                operation_fingerprint_digest: operation_fingerprint_digest.clone(),
            }),
            (
                CloudflareRouterEd25519AcceptedCapabilityBindingV1::OperationStepUp {
                    authorization_session_id,
                    ..
                },
                CloudflareRouterEd25519AuthorizedOperationV1::VerifiedStepUpAuthorizedOperationV1 {
                    authorized_operation_id,
                    operation_id,
                    operation_fingerprint_digest,
                    ..
                },
            ) => Ok(CloudflareSigningWorkerAuthorizedOperationIdentityV1::OperationStepUp {
                authorization_session_id: authorization_session_id.clone(),
                authorized_operation_id: authorized_operation_id.clone(),
                operation_id: operation_id.clone(),
                operation_fingerprint_digest: operation_fingerprint_digest.clone(),
            }),
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "accepted Ed25519 operation identity branch does not match authorized operation",
            )),
        }
    }

    pub(super) fn reusable_authorization_id(&self) -> RouterAbProtocolResult<&str> {
        match &self.binding {
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::ReusableWalletSession {
                authorization_id,
                ..
            }
            | CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                authorization_id,
                ..
            }
            | CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession {
                authorization_id,
                ..
            } => Ok(authorization_id),
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::OperationStepUp { .. } => {
                Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "Ed25519 operation step-up has no reusable authorization id",
                ))
            }
        }
    }

    pub(super) fn validate(&self) -> RouterAbProtocolResult<()> {
        match &self.binding {
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                ownership_generation,
                ..
            }
            | CloudflareRouterEd25519AcceptedCapabilityBindingV1::OperationStepUp {
                ownership_generation,
                ..
            } => {
                crate::router_wallet::validate_wallet_ownership_generation(*ownership_generation)?;
            }
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::ReusableWalletSession { .. }
            | CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession { .. } => {}
        }
        self.authorized_operation.validate()?;
        match (&self.binding, &self.authorized_operation) {
            (
                CloudflareRouterEd25519AcceptedCapabilityBindingV1::ReusableWalletSession {
                    authorization_id,
                    wallet_session_id,
                    quota_id,
                },
                CloudflareRouterEd25519AuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                    ..
                },
            ) => {
                require_non_empty("accepted Ed25519 authorization_id", authorization_id)?;
                require_non_empty("accepted Ed25519 wallet_session_id", wallet_session_id)?;
                require_non_empty("accepted Ed25519 quota_id", quota_id)?;
                if authorization_id == wallet_session_id
                    || authorization_id == quota_id
                    || wallet_session_id == quota_id
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "accepted Ed25519 authorization, Wallet Session, and quota ids must be pairwise distinct",
                    ));
                }
                Ok(())
            }
            (
                CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                    ownership_generation: _,
                    subject_id,
                    account_id,
                    authorization_id,
                    wallet_session_id,
                    quota_id,
                    threshold_session_id,
                    org_id,
                    project_id,
                    environment,
                    project_environment_id,
                    signing_worker_id,
                    expires_at_ms,
                },
                CloudflareRouterEd25519AuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                    ..
                },
            ) => {
                require_non_empty("accepted Ed25519 Gateway subject_id", subject_id)?;
                require_non_empty("accepted Ed25519 Gateway account_id", account_id)?;
                require_non_empty("accepted Ed25519 Gateway authorization_id", authorization_id)?;
                require_non_empty("accepted Ed25519 Gateway wallet_session_id", wallet_session_id)?;
                require_non_empty("accepted Ed25519 Gateway quota_id", quota_id)?;
                require_non_empty(
                    "accepted Ed25519 Gateway threshold_session_id",
                    threshold_session_id,
                )?;
                require_non_empty("accepted Ed25519 Gateway org_id", org_id)?;
                require_non_empty("accepted Ed25519 Gateway project_id", project_id)?;
                require_non_empty("accepted Ed25519 Gateway environment", environment)?;
                require_non_empty(
                    "accepted Ed25519 Gateway project_environment_id",
                    project_environment_id,
                )?;
                require_non_empty("accepted Ed25519 Gateway signing_worker_id", signing_worker_id)?;
                require_positive_ms("accepted Ed25519 Gateway expires_at_ms", *expires_at_ms)?;
                if authorization_id == wallet_session_id
                    || authorization_id == quota_id
                    || wallet_session_id == quota_id
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "accepted Ed25519 Gateway authorization ids must be pairwise distinct",
                    ));
                }
                Ok(())
            }
            (
                CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession {
                    subject_id,
                    account_id,
                    authorization_id,
                    wallet_session_id,
                    quota_id,
                    org_id,
                    project_id,
                    environment,
                    signing_worker_id,
                    expires_at_ms,
                    material_source,
                    ownership_generation,
                },
                CloudflareRouterEd25519AuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                    ..
                },
            ) => {
                crate::router_wallet::validate_wallet_ownership_generation(*ownership_generation)?;
                require_non_empty("accepted Ed25519 linked-device subject_id", subject_id)?;
                require_non_empty("accepted Ed25519 linked-device account_id", account_id)?;
                require_non_empty("accepted Ed25519 linked-device authorization_id", authorization_id)?;
                require_non_empty("accepted Ed25519 linked-device wallet_session_id", wallet_session_id)?;
                require_non_empty("accepted Ed25519 linked-device quota_id", quota_id)?;
                require_non_empty("accepted Ed25519 linked-device org_id", org_id)?;
                require_non_empty("accepted Ed25519 linked-device project_id", project_id)?;
                require_non_empty("accepted Ed25519 linked-device environment", environment)?;
                require_non_empty("accepted Ed25519 linked-device signing_worker_id", signing_worker_id)?;
                require_positive_ms("accepted Ed25519 linked-device expires_at_ms", *expires_at_ms)?;
                if !matches!(
                    material_source,
                    CloudflareSigningWorkerNormalSigningMaterialSourceV1::RotatableLane { .. }
                ) {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "accepted Ed25519 linked-device material source must be a rotatable lane",
                    ));
                }
                if authorization_id == wallet_session_id
                    || authorization_id == quota_id
                    || wallet_session_id == quota_id
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "accepted Ed25519 linked-device authorization ids must be pairwise distinct",
                    ));
                }
                Ok(())
            }
            (
                CloudflareRouterEd25519AcceptedCapabilityBindingV1::OperationStepUp {
                    ownership_generation: _,
                    authorization_session_id,
                    org_id,
                    project_id,
                    environment,
                    project_environment_id,
                    subject_id,
                    account_id,
                },
                CloudflareRouterEd25519AuthorizedOperationV1::VerifiedStepUpAuthorizedOperationV1 {
                    authorization_session_id: authorized_operation_session,
                    ..
                },
            ) if authorization_session_id == authorized_operation_session => {
                require_non_empty(
                    "accepted Ed25519 authorization_session_id",
                    authorization_session_id,
                )?;
                require_non_empty("accepted Ed25519 org_id", org_id)?;
                require_non_empty("accepted Ed25519 project_id", project_id)?;
                require_non_empty("accepted Ed25519 environment", environment)?;
                require_non_empty(
                    "accepted Ed25519 project_environment_id",
                    project_environment_id,
                )?;
                require_non_empty("accepted Ed25519 subject_id", subject_id)?;
                require_non_empty("accepted Ed25519 account_id", account_id)
            }
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "accepted Ed25519 capability binding does not match authorized operation",
            )),
        }
    }

    pub(super) fn validate_for_wallet_session(
        &self,
        wallet_session: &CloudflareRouterVerifiedWalletSessionV1,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        match &self.binding {
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::ReusableWalletSession {
                authorization_id,
                wallet_session_id,
                quota_id,
            } => {
                if wallet_session.authorization_id != *authorization_id
                    || wallet_session.wallet_session_id != *wallet_session_id
                    || wallet_session.quota_id != *quota_id
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "accepted Ed25519 capability binding does not match Wallet Session",
                    ));
                }
            }
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                authorization_id,
                wallet_session_id,
                quota_id,
                ..
            } => {
                if wallet_session.authorization_id != *authorization_id
                    || wallet_session.wallet_session_id != *wallet_session_id
                    || wallet_session.quota_id != *quota_id
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "accepted Ed25519 Gateway binding does not match Wallet Session",
                    ));
                }
            }
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayLinkedDeviceWalletSession {
                ..
            } => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "accepted Ed25519 linked-device binding requires trusted Gateway admission",
                ));
            }
            CloudflareRouterEd25519AcceptedCapabilityBindingV1::OperationStepUp { .. } => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "accepted Ed25519 step-up session cannot use a Wallet Session credential",
                ));
            }
        }
        Ok(())
    }

    /// The Wallet Session credential the Gateway's owner projection implies.
    /// Only a Gateway-owner binding has one.
    pub fn gateway_owner_wallet_session_credential(
        &self,
        trusted_source_digest: PublicDigest32,
    ) -> RouterAbProtocolResult<CloudflareRouterWalletSessionCredentialV1> {
        self.validate()?;
        let CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
            ownership_generation: _,
            subject_id,
            account_id,
            authorization_id,
            wallet_session_id,
            quota_id,
            threshold_session_id,
            org_id,
            project_id,
            environment,
            project_environment_id: _,
            signing_worker_id,
            expires_at_ms,
        } = &self.binding
        else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "Ed25519 Gateway owner Wallet Session admission is required",
            ));
        };
        let wallet_session = CloudflareRouterVerifiedWalletSessionV1::new(
            subject_id.clone(),
            account_id.clone(),
            authorization_id.clone(),
            wallet_session_id.clone(),
            quota_id.clone(),
            threshold_session_id.clone(),
            org_id.clone(),
            project_id.clone(),
            environment.clone(),
            "near-ed25519",
            signing_worker_id.clone(),
            trusted_source_digest,
            *expires_at_ms,
        )?;
        CloudflareRouterWalletSessionCredentialV1::gateway_owner(wallet_session)
    }
}

/// Capability domain admitted by the Ed25519 reusable-session route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CloudflareRouterEd25519CapabilityKindV1 {
    #[serde(rename = "near_ed25519_mpc_signing")]
    NearEd25519MpcSigning,
}

/// Supported NEAR operation admitted by the Ed25519 reusable-session route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CloudflareRouterEd25519OperationKindV1 {
    #[serde(rename = "near.sign_transaction")]
    SignTransaction,
    #[serde(rename = "near.sign_delegate_action")]
    SignDelegateAction,
    #[serde(rename = "near.sign_nep413_message")]
    SignNep413Message,
}

impl CloudflareRouterEd25519AuthorizedOperationV1 {
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        let (
            authorization_session_id,
            evidence_set_digest,
            authorized_operation_id,
            operation_id,
            lane_digest_b64u,
            intent_digest_b64u,
            display_digest_b64u,
            operation_fingerprint_digest,
        ) = match self {
            Self::ReusableWalletSessionAuthorizedOperationV1 {
                authorized_operation_id,
                operation_id,
                lane_digest_b64u,
                intent_digest_b64u,
                display_digest_b64u,
                operation_fingerprint_digest,
                ..
            } => (
                None,
                None,
                authorized_operation_id,
                operation_id,
                lane_digest_b64u,
                intent_digest_b64u,
                display_digest_b64u,
                operation_fingerprint_digest,
            ),
            Self::VerifiedStepUpAuthorizedOperationV1 {
                authorization_session_id,
                evidence_set_digest,
                authorized_operation_id,
                operation_id,
                lane_digest_b64u,
                intent_digest_b64u,
                display_digest_b64u,
                operation_fingerprint_digest,
                ..
            } => (
                Some(authorization_session_id),
                Some(evidence_set_digest),
                authorized_operation_id,
                operation_id,
                lane_digest_b64u,
                intent_digest_b64u,
                display_digest_b64u,
                operation_fingerprint_digest,
            ),
        };
        if let Some(value) = authorization_session_id {
            require_non_empty("authorized_operation.authorization_session_id", value)?;
        }
        if let Some(value) = evidence_set_digest {
            decode_public_digest_b64u_v1("authorized_operation.evidence_set_digest", value)?;
        }
        require_non_empty(
            "authorized_operation.authorized_operation_id",
            authorized_operation_id,
        )?;
        require_non_empty("authorized_operation.operation_id", operation_id)?;
        decode_public_digest_b64u_v1("authorized_operation.lane_digest_b64u", lane_digest_b64u)?;
        decode_public_digest_b64u_v1(
            "authorized_operation.intent_digest_b64u",
            intent_digest_b64u,
        )?;
        decode_public_digest_b64u_v1(
            "authorized_operation.display_digest_b64u",
            display_digest_b64u,
        )?;
        decode_public_digest_b64u_v1(
            "authorized_operation.operation_fingerprint_digest",
            operation_fingerprint_digest,
        )?;
        Ok(())
    }

    pub fn validate_for_prepare_request(
        &self,
        request: &RouterAbEd25519NormalSigningPrepareRequestV2,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        request.validate()?;
        let material = request.admission_material()?;
        let intent_digest_b64u = encode_base64url_bytes_v1(material.intent_digest.as_bytes());
        let display_digest_b64u = encode_base64url_bytes_v1(request.display_digest.as_bytes());
        let (authorized_operation_intent, authorized_operation_display) = match self {
            Self::ReusableWalletSessionAuthorizedOperationV1 {
                intent_digest_b64u,
                display_digest_b64u,
                ..
            }
            | Self::VerifiedStepUpAuthorizedOperationV1 {
                intent_digest_b64u,
                display_digest_b64u,
                ..
            } => (intent_digest_b64u, display_digest_b64u),
        };
        if authorized_operation_intent != &intent_digest_b64u
            || authorized_operation_display != &display_digest_b64u
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "Ed25519 authorized operation does not match prepare digests",
            ));
        }
        Ok(())
    }

    pub fn validate_for_finalize_request(
        &self,
        request: &RouterAbEd25519NormalSigningFinalizeRequestV2,
        authorization: &CloudflareRouterNormalSigningAuthorizationV2,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        request.validate()?;
        authorization.validate()?;
        let intent_digest_b64u = match (self, authorization) {
            (
                Self::ReusableWalletSessionAuthorizedOperationV1 {
                    intent_digest_b64u, ..
                },
                CloudflareRouterNormalSigningAuthorizationV2::ReusableWalletSession { .. },
            ) => intent_digest_b64u,
            (
                Self::VerifiedStepUpAuthorizedOperationV1 {
                    authorization_session_id,
                    intent_digest_b64u,
                    ..
                },
                CloudflareRouterNormalSigningAuthorizationV2::OperationStepUp {
                    authorization_session_id: admitted_session_id,
                    ..
                },
            ) if authorization_session_id == admitted_session_id => intent_digest_b64u,
            _ => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "Ed25519 authorized operation does not match Router admission",
                ));
            }
        };
        let intent_digest = decode_public_digest_b64u_v1(
            "authorized_operation.intent_digest_b64u",
            intent_digest_b64u,
        )?;
        if intent_digest != request.intent_digest() {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "Ed25519 authorized operation intent does not match finalize request",
            ));
        }
        Ok(())
    }

    pub(super) fn into_signing_worker_effect_claim(
        self,
        wallet_session_id: String,
        authorization_id: String,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerNormalSigningEffectClaimV1> {
        self.validate()?;
        match self {
            Self::ReusableWalletSessionAuthorizedOperationV1 {
                authorized_operation_id,
                operation_id,
                operation_fingerprint_digest,
                ..
            } => Ok(
                CloudflareSigningWorkerNormalSigningEffectClaimV1::ReusableWalletSession {
                    claim: CloudflareSigningWorkerReusableWalletSessionEffectClaimV1::new(
                        authorization_id,
                        wallet_session_id,
                        authorized_operation_id,
                        operation_id,
                        operation_fingerprint_digest,
                    )?,
                },
            ),
            Self::VerifiedStepUpAuthorizedOperationV1 {
                authorization_session_id,
                authorized_operation_id,
                operation_id,
                operation_fingerprint_digest,
                ..
            } => Ok(
                CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
                    authorization_session_id,
                    authorized_operation_id,
                    operation_id,
                    operation_fingerprint_digest,
                },
            ),
        }
    }

    pub(super) fn into_step_up_signing_worker_effect_claim(
        self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerNormalSigningEffectClaimV1> {
        self.validate()?;
        match self {
            Self::VerifiedStepUpAuthorizedOperationV1 {
                authorization_session_id,
                authorized_operation_id,
                operation_id,
                operation_fingerprint_digest,
                ..
            } => Ok(CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
                authorization_session_id,
                authorized_operation_id,
                operation_id,
                operation_fingerprint_digest,
            }),
            Self::ReusableWalletSessionAuthorizedOperationV1 { .. } => Err(
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "Ed25519 reusable Wallet Session authorized operation cannot use the operation step-up admission path",
                ),
            ),
        }
    }
}

/// Gateway authorized operation attached to Router A/B ECDSA finalize.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareRouterEcdsaAuthorizedOperationV1 {
    ReusableWalletSessionAuthorizedOperationV1 {
        authorized_operation_id: String,
        operation_id: String,
        capability_kind: CloudflareRouterEcdsaCapabilityKindV1,
        operation_kind: CloudflareRouterEcdsaOperationKindV1,
        lane_digest_b64u: String,
        intent_digest_b64u: String,
        display_digest_b64u: String,
        operation_fingerprint_digest: String,
    },
    VerifiedStepUpAuthorizedOperationV1 {
        authorization_session_id: String,
        evidence_set_digest: String,
        authorized_operation_id: String,
        operation_id: String,
        capability_kind: CloudflareRouterEcdsaCapabilityKindV1,
        operation_kind: CloudflareRouterEcdsaOperationKindV1,
        lane_digest_b64u: String,
        intent_digest_b64u: String,
        display_digest_b64u: String,
        operation_fingerprint_digest: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareRouterEcdsaAcceptedCapabilityBindingV1 {
    ReusableWalletSession {
        /// Exact Wallet Session authorization record used for this operation.
        authorization_id: String,
        wallet_session_id: String,
        quota_id: String,
    },
    /// Wallet Session admission resolved by the trusted Gateway.
    GatewayOwnerWalletSession {
        ownership_generation: u64,
        subject_id: String,
        account_id: String,
        authorization_id: String,
        wallet_session_id: String,
        quota_id: String,
        threshold_session_id: String,
        org_id: String,
        project_id: String,
        environment: String,
        project_environment_id: String,
        signing_worker_id: String,
        expires_at_ms: u64,
    },
    /// Verified operation step-up resolved by the trusted Gateway. The
    /// wallet and its Console project environment are the ones the Gateway
    /// pinned when it claimed the step-up operation.
    OperationStepUp {
        ownership_generation: u64,
        authorization_session_id: String,
        org_id: String,
        project_id: String,
        environment: String,
        project_environment_id: String,
        subject_id: String,
        account_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterEcdsaAcceptedAuthorizedOperationV1 {
    pub binding: CloudflareRouterEcdsaAcceptedCapabilityBindingV1,
    pub authorized_operation: CloudflareRouterEcdsaAuthorizedOperationV1,
}

#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
impl CloudflareRouterEcdsaAcceptedAuthorizedOperationV1 {
    /// The wallet the SigningWorker keeps this operation's material under:
    /// the one the Gateway resolved for an owner Wallet Session or a
    /// verified step-up.
    pub(super) fn wallet_scope(
        &self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerWalletScopeV1> {
        match &self.binding {
            CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                org_id,
                project_id,
                project_environment_id,
                account_id,
                ..
            }
            | CloudflareRouterEcdsaAcceptedCapabilityBindingV1::OperationStepUp {
                org_id,
                project_id,
                project_environment_id,
                account_id,
                ..
            } => CloudflareSigningWorkerWalletScopeV1::new(
                org_id,
                project_id,
                project_environment_id,
                account_id,
            ),
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "an ECDSA Gateway owner Wallet Session or verified step-up binding is required",
            )),
        }
    }

    pub(super) fn validate_for_linked_device_ecdsa_finalize_request(
        &self,
        request: &router_ab_core::RouterAbEcdsaDerivationLinkedDeviceEvmDigestSigningFinalizeRequestV1,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        request.validate()?;
        let (
            authorized_operation_id,
            operation_id,
            authorized_operation_intent,
            authorized_operation_lane,
            authorized_operation_display,
        ) = match &self.authorized_operation {
            CloudflareRouterEcdsaAuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                authorized_operation_id,
                operation_id,
                intent_digest_b64u,
                lane_digest_b64u,
                display_digest_b64u,
                ..
            }
            | CloudflareRouterEcdsaAuthorizedOperationV1::VerifiedStepUpAuthorizedOperationV1 {
                authorized_operation_id,
                operation_id,
                intent_digest_b64u,
                lane_digest_b64u,
                display_digest_b64u,
                ..
            } => (
                authorized_operation_id,
                operation_id,
                intent_digest_b64u,
                lane_digest_b64u,
                display_digest_b64u,
            ),
        };
        if authorized_operation_id
            != &format!("linked-ecdsa-authorized-operation:{}", request.request_id)
            || operation_id != &request.operation_id
            || authorized_operation_intent != &request.operation_digests.intent_digest_b64u
            || authorized_operation_lane != &request.operation_digests.lane_digest_b64u
            || authorized_operation_display != &request.operation_digests.display_digest_b64u
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "ECDSA authorized operation does not match linked finalize digests",
            ));
        }
        let NormalSigningAuthorizationV1::ReusableWalletSession { wallet_session_id } =
            &request.authorization
        else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "linked ECDSA finalize requires reusable Wallet Session authorization",
            ));
        };
        match &self.binding {
            CloudflareRouterEcdsaAcceptedCapabilityBindingV1::ReusableWalletSession {
                wallet_session_id: admitted_wallet_session_id,
                ..
            } if admitted_wallet_session_id == wallet_session_id => Ok(()),
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "linked ECDSA capability binding does not match Wallet Session authorization",
            )),
        }
    }

    pub(super) fn into_signing_worker_authorized_operation_identity(
        &self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerAuthorizedOperationIdentityV1> {
        self.validate()?;
        match (&self.binding, &self.authorized_operation) {
            (
                CloudflareRouterEcdsaAcceptedCapabilityBindingV1::ReusableWalletSession {
                    authorization_id,
                    wallet_session_id,
                    ..
                },
                CloudflareRouterEcdsaAuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                    authorized_operation_id,
                    operation_id,
                    operation_fingerprint_digest,
                    ..
                },
            ) => Ok(CloudflareSigningWorkerAuthorizedOperationIdentityV1::ReusableWalletSession {
                authorization_id: authorization_id.clone(),
                wallet_session_id: wallet_session_id.clone(),
                authorized_operation_id: authorized_operation_id.clone(),
                operation_id: operation_id.clone(),
                operation_fingerprint_digest: operation_fingerprint_digest.clone(),
            }),
            (
                CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                    authorization_id,
                    wallet_session_id,
                    ..
                },
                CloudflareRouterEcdsaAuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                    authorized_operation_id,
                    operation_id,
                    operation_fingerprint_digest,
                    ..
                },
            ) => Ok(CloudflareSigningWorkerAuthorizedOperationIdentityV1::ReusableWalletSession {
                authorization_id: authorization_id.clone(),
                wallet_session_id: wallet_session_id.clone(),
                authorized_operation_id: authorized_operation_id.clone(),
                operation_id: operation_id.clone(),
                operation_fingerprint_digest: operation_fingerprint_digest.clone(),
            }),
            (
                CloudflareRouterEcdsaAcceptedCapabilityBindingV1::OperationStepUp {
                    authorization_session_id,
                    ..
                },
                CloudflareRouterEcdsaAuthorizedOperationV1::VerifiedStepUpAuthorizedOperationV1 {
                    authorized_operation_id,
                    operation_id,
                    operation_fingerprint_digest,
                    ..
                },
            ) => Ok(CloudflareSigningWorkerAuthorizedOperationIdentityV1::OperationStepUp {
                authorization_session_id: authorization_session_id.clone(),
                authorized_operation_id: authorized_operation_id.clone(),
                operation_id: operation_id.clone(),
                operation_fingerprint_digest: operation_fingerprint_digest.clone(),
            }),
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "accepted ECDSA operation identity branch does not match authorized operation",
            )),
        }
    }

    pub(super) fn reusable_authorization_id(&self) -> RouterAbProtocolResult<&str> {
        match &self.binding {
            CloudflareRouterEcdsaAcceptedCapabilityBindingV1::ReusableWalletSession {
                authorization_id,
                ..
            }
            | CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                authorization_id,
                ..
            } => Ok(authorization_id),
            CloudflareRouterEcdsaAcceptedCapabilityBindingV1::OperationStepUp { .. } => {
                Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "ECDSA operation step-up has no reusable authorization id",
                ))
            }
        }
    }

    pub(super) fn validate(&self) -> RouterAbProtocolResult<()> {
        match &self.binding {
            CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                ownership_generation,
                ..
            }
            | CloudflareRouterEcdsaAcceptedCapabilityBindingV1::OperationStepUp {
                ownership_generation,
                ..
            } => {
                crate::router_wallet::validate_wallet_ownership_generation(*ownership_generation)?;
            }
            CloudflareRouterEcdsaAcceptedCapabilityBindingV1::ReusableWalletSession { .. } => {}
        }
        self.authorized_operation.validate()?;
        match (&self.binding, &self.authorized_operation) {
            (
                CloudflareRouterEcdsaAcceptedCapabilityBindingV1::ReusableWalletSession {
                    authorization_id,
                    wallet_session_id,
                    quota_id,
                },
                CloudflareRouterEcdsaAuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                    ..
                },
            ) => {
                require_non_empty("accepted ECDSA authorization_id", authorization_id)?;
                require_non_empty("accepted ECDSA wallet_session_id", wallet_session_id)?;
                require_non_empty("accepted ECDSA quota_id", quota_id)?;
                if authorization_id == wallet_session_id
                    || authorization_id == quota_id
                    || wallet_session_id == quota_id
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "accepted ECDSA authorization, Wallet Session, and quota ids must be pairwise distinct",
                    ));
                }
                Ok(())
            }
            (
                CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                    ownership_generation: _,
                    subject_id,
                    account_id,
                    authorization_id,
                    wallet_session_id,
                    quota_id,
                    threshold_session_id,
                    org_id,
                    project_id,
                    environment,
                    project_environment_id,
                    signing_worker_id,
                    expires_at_ms,
                },
                CloudflareRouterEcdsaAuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                    ..
                },
            ) => {
                require_non_empty("accepted ECDSA Gateway subject_id", subject_id)?;
                require_non_empty("accepted ECDSA Gateway account_id", account_id)?;
                require_non_empty("accepted ECDSA Gateway authorization_id", authorization_id)?;
                require_non_empty("accepted ECDSA Gateway wallet_session_id", wallet_session_id)?;
                require_non_empty("accepted ECDSA Gateway quota_id", quota_id)?;
                require_non_empty(
                    "accepted ECDSA Gateway threshold_session_id",
                    threshold_session_id,
                )?;
                require_non_empty("accepted ECDSA Gateway org_id", org_id)?;
                require_non_empty("accepted ECDSA Gateway project_id", project_id)?;
                require_non_empty("accepted ECDSA Gateway environment", environment)?;
                require_non_empty(
                    "accepted ECDSA Gateway project_environment_id",
                    project_environment_id,
                )?;
                require_non_empty("accepted ECDSA Gateway signing_worker_id", signing_worker_id)?;
                require_positive_ms("accepted ECDSA Gateway expires_at_ms", *expires_at_ms)?;
                if authorization_id == wallet_session_id
                    || authorization_id == quota_id
                    || wallet_session_id == quota_id
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "accepted ECDSA Gateway authorization ids must be pairwise distinct",
                    ));
                }
                Ok(())
            }
            (
                CloudflareRouterEcdsaAcceptedCapabilityBindingV1::OperationStepUp {
                    ownership_generation: _,
                    authorization_session_id,
                    org_id,
                    project_id,
                    environment,
                    project_environment_id,
                    subject_id,
                    account_id,
                },
                CloudflareRouterEcdsaAuthorizedOperationV1::VerifiedStepUpAuthorizedOperationV1 {
                    authorization_session_id: authorized_operation_session,
                    ..
                },
            ) if authorization_session_id == authorized_operation_session => {
                require_non_empty(
                    "accepted ECDSA authorization_session_id",
                    authorization_session_id,
                )?;
                require_non_empty("accepted ECDSA org_id", org_id)?;
                require_non_empty("accepted ECDSA project_id", project_id)?;
                require_non_empty("accepted ECDSA environment", environment)?;
                require_non_empty(
                    "accepted ECDSA project_environment_id",
                    project_environment_id,
                )?;
                require_non_empty("accepted ECDSA subject_id", subject_id)?;
                require_non_empty("accepted ECDSA account_id", account_id)
            }
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "accepted ECDSA capability binding does not match authorized operation",
            )),
        }
    }

    pub(super) fn validate_for_wallet_session(
        &self,
        wallet_session: &CloudflareRouterVerifiedWalletSessionV1,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        match &self.binding {
            CloudflareRouterEcdsaAcceptedCapabilityBindingV1::ReusableWalletSession {
                authorization_id,
                wallet_session_id,
                quota_id,
                ..
            } => {
                if wallet_session.authorization_id != *authorization_id
                    || wallet_session.wallet_session_id != *wallet_session_id
                    || wallet_session.quota_id != *quota_id
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "accepted ECDSA capability binding does not match Wallet Session",
                    ));
                }
            }
            CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
                subject_id,
                account_id,
                authorization_id,
                wallet_session_id,
                quota_id,
                threshold_session_id,
                org_id,
                project_id,
                environment,
                signing_worker_id,
                expires_at_ms,
                ..
            } => {
                if wallet_session.subject_id != *subject_id
                    || wallet_session.account_id != *account_id
                    || wallet_session.authorization_id != *authorization_id
                    || wallet_session.wallet_session_id != *wallet_session_id
                    || wallet_session.quota_id != *quota_id
                    || wallet_session.threshold_session_id != *threshold_session_id
                    || wallet_session.org_id != *org_id
                    || wallet_session.project_id != *project_id
                    || wallet_session.environment != *environment
                    || wallet_session.signing_worker_id != *signing_worker_id
                    || wallet_session.expires_at_ms != *expires_at_ms
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidGateDecision,
                        "accepted ECDSA Gateway binding does not match Wallet Session",
                    ));
                }
            }
            CloudflareRouterEcdsaAcceptedCapabilityBindingV1::OperationStepUp { .. } => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "accepted ECDSA step-up session cannot use a Wallet Session credential",
                ));
            }
        }
        Ok(())
    }

    /// The owner's Wallet Session credential the Gateway forwarded.
    pub fn gateway_owner_wallet_session_credential(
        &self,
        trusted_source_digest: PublicDigest32,
    ) -> RouterAbProtocolResult<CloudflareRouterWalletSessionCredentialV1> {
        self.validate()?;
        self.wallet_scope()?;
        let CloudflareRouterEcdsaAcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
            ownership_generation: _,
            subject_id,
            account_id,
            authorization_id,
            wallet_session_id,
            quota_id,
            threshold_session_id,
            org_id,
            project_id,
            environment,
            project_environment_id: _,
            signing_worker_id,
            expires_at_ms,
        } = &self.binding
        else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "ECDSA Gateway owner Wallet Session admission is required",
            ));
        };
        let wallet_session = CloudflareRouterVerifiedWalletSessionV1::new(
            subject_id.clone(),
            account_id.clone(),
            authorization_id.clone(),
            wallet_session_id.clone(),
            quota_id.clone(),
            threshold_session_id.clone(),
            org_id.clone(),
            project_id.clone(),
            environment.clone(),
            "evm-family",
            signing_worker_id.clone(),
            trusted_source_digest,
            *expires_at_ms,
        )?;
        CloudflareRouterWalletSessionCredentialV1::gateway_owner(wallet_session)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CloudflareRouterEcdsaCapabilityKindV1 {
    #[serde(rename = "evm_ecdsa_mpc_signing")]
    EvmEcdsaMpcSigning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CloudflareRouterEcdsaOperationKindV1 {
    #[serde(rename = "evm.sign_transaction")]
    SignTransaction,
}

#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
impl CloudflareRouterEcdsaAuthorizedOperationV1 {
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        let (
            authorization_session_id,
            evidence_set_digest,
            authorized_operation_id,
            operation_id,
            lane_digest_b64u,
            intent_digest_b64u,
            display_digest_b64u,
            operation_fingerprint_digest,
            capability_kind,
            operation_kind,
        ) = match self {
            Self::ReusableWalletSessionAuthorizedOperationV1 {
                authorized_operation_id,
                operation_id,
                lane_digest_b64u,
                intent_digest_b64u,
                display_digest_b64u,
                operation_fingerprint_digest,
                capability_kind,
                operation_kind,
            } => (
                None,
                None,
                authorized_operation_id,
                operation_id,
                lane_digest_b64u,
                intent_digest_b64u,
                display_digest_b64u,
                operation_fingerprint_digest,
                capability_kind,
                operation_kind,
            ),
            Self::VerifiedStepUpAuthorizedOperationV1 {
                authorization_session_id,
                evidence_set_digest,
                authorized_operation_id,
                operation_id,
                lane_digest_b64u,
                intent_digest_b64u,
                display_digest_b64u,
                operation_fingerprint_digest,
                capability_kind,
                operation_kind,
            } => (
                Some(authorization_session_id),
                Some(evidence_set_digest),
                authorized_operation_id,
                operation_id,
                lane_digest_b64u,
                intent_digest_b64u,
                display_digest_b64u,
                operation_fingerprint_digest,
                capability_kind,
                operation_kind,
            ),
        };
        if let Some(value) = authorization_session_id {
            require_non_empty("ECDSA authorized_operation.authorization_session_id", value)?;
        }
        if let Some(value) = evidence_set_digest {
            decode_public_digest_b64u_v1("ECDSA authorized_operation.evidence_set_digest", value)?;
        }
        require_non_empty(
            "ECDSA authorized_operation.authorized_operation_id",
            authorized_operation_id,
        )?;
        require_non_empty("ECDSA authorized_operation.operation_id", operation_id)?;
        decode_public_digest_b64u_v1(
            "ECDSA authorized_operation.lane_digest_b64u",
            lane_digest_b64u,
        )?;
        decode_public_digest_b64u_v1(
            "ECDSA authorized_operation.intent_digest_b64u",
            intent_digest_b64u,
        )?;
        decode_public_digest_b64u_v1(
            "ECDSA authorized_operation.display_digest_b64u",
            display_digest_b64u,
        )?;
        decode_public_digest_b64u_v1(
            "ECDSA authorized_operation.operation_fingerprint_digest",
            operation_fingerprint_digest,
        )?;
        if *capability_kind != CloudflareRouterEcdsaCapabilityKindV1::EvmEcdsaMpcSigning
            || *operation_kind != CloudflareRouterEcdsaOperationKindV1::SignTransaction
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "ECDSA authorized operation capability or operation kind is invalid",
            ));
        }
        Ok(())
    }

    pub fn validate_for_prepare_request(
        &self,
        request: &RouterAbEcdsaDerivationEvmDigestSigningRequestV1,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        request.validate()?;
        let (
            authorized_operation_id,
            authorized_operation_intent,
            authorized_operation_lane,
            authorized_operation_display,
        ) = match self {
            Self::ReusableWalletSessionAuthorizedOperationV1 {
                operation_id,
                intent_digest_b64u,
                lane_digest_b64u,
                display_digest_b64u,
                ..
            }
            | Self::VerifiedStepUpAuthorizedOperationV1 {
                operation_id,
                intent_digest_b64u,
                lane_digest_b64u,
                display_digest_b64u,
                ..
            } => (
                operation_id,
                intent_digest_b64u,
                lane_digest_b64u,
                display_digest_b64u,
            ),
        };
        if authorized_operation_id != &request.operation_id
            || authorized_operation_intent != &request.operation_digests.intent_digest_b64u
            || authorized_operation_lane != &request.operation_digests.lane_digest_b64u
            || authorized_operation_display != &request.operation_digests.display_digest_b64u
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "ECDSA authorized operation does not match prepare digests",
            ));
        }
        match (&request.authorization, self) {
            (
                NormalSigningAuthorizationV1::ReusableWalletSession { .. },
                Self::ReusableWalletSessionAuthorizedOperationV1 { .. },
            ) => Ok(()),
            (
                NormalSigningAuthorizationV1::OperationStepUp,
                Self::VerifiedStepUpAuthorizedOperationV1 { .. },
            ) => Ok(()),
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "ECDSA authorized operation branch does not match prepare authorization",
            )),
        }
    }

    pub fn validate_for_finalize_request(
        &self,
        request: &RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
    ) -> RouterAbProtocolResult<()> {
        self.validate_for_finalize_request_with_session(request, None)
    }

    pub fn validate_for_finalize_request_with_session(
        &self,
        request: &RouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
        expected_authorization_session_id: Option<&str>,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        request.validate()?;
        let (
            authorized_operation_id,
            authorized_operation_intent,
            authorized_operation_lane,
            authorized_operation_display,
        ) = match self {
            Self::ReusableWalletSessionAuthorizedOperationV1 {
                operation_id,
                intent_digest_b64u,
                lane_digest_b64u,
                display_digest_b64u,
                ..
            }
            | Self::VerifiedStepUpAuthorizedOperationV1 {
                operation_id,
                intent_digest_b64u,
                lane_digest_b64u,
                display_digest_b64u,
                ..
            } => (
                operation_id,
                intent_digest_b64u,
                lane_digest_b64u,
                display_digest_b64u,
            ),
        };
        if authorized_operation_id != &request.operation_id
            || authorized_operation_intent != &request.operation_digests.intent_digest_b64u
            || authorized_operation_lane != &request.operation_digests.lane_digest_b64u
            || authorized_operation_display != &request.operation_digests.display_digest_b64u
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "ECDSA authorized operation does not match finalize digests",
            ));
        }
        match (&request.authorization, self) {
            (
                NormalSigningAuthorizationV1::ReusableWalletSession { .. },
                Self::ReusableWalletSessionAuthorizedOperationV1 { .. },
            ) => Ok(()),
            (
                NormalSigningAuthorizationV1::OperationStepUp,
                Self::VerifiedStepUpAuthorizedOperationV1 {
                    authorization_session_id,
                    ..
                },
            ) => {
                if let Some(expected) = expected_authorization_session_id {
                    if authorization_session_id != expected {
                        return Err(RouterAbProtocolError::new(
                            RouterAbProtocolErrorCode::InvalidGateDecision,
                            "ECDSA authorized operation session does not match Wallet Session",
                        ));
                    }
                }
                Ok(())
            }
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidGateDecision,
                "ECDSA authorized operation branch does not match finalize authorization",
            )),
        }
    }

    pub fn authorized_operation_id(&self) -> &str {
        match self {
            Self::ReusableWalletSessionAuthorizedOperationV1 {
                authorized_operation_id,
                ..
            }
            | Self::VerifiedStepUpAuthorizedOperationV1 {
                authorized_operation_id,
                ..
            } => authorized_operation_id,
        }
    }

    pub(super) fn into_signing_worker_effect_claim(
        self,
        wallet_session_id: String,
        authorization_id: String,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerNormalSigningEffectClaimV1> {
        self.validate()?;
        match self {
            Self::ReusableWalletSessionAuthorizedOperationV1 {
                authorized_operation_id,
                operation_id,
                operation_fingerprint_digest,
                ..
            } => Ok(
                CloudflareSigningWorkerNormalSigningEffectClaimV1::ReusableWalletSession {
                    claim: CloudflareSigningWorkerReusableWalletSessionEffectClaimV1::new(
                        authorization_id,
                        wallet_session_id,
                        authorized_operation_id,
                        operation_id,
                        operation_fingerprint_digest,
                    )?,
                },
            ),
            Self::VerifiedStepUpAuthorizedOperationV1 {
                authorization_session_id,
                authorized_operation_id,
                operation_id,
                operation_fingerprint_digest,
                ..
            } => Ok(
                CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
                    authorization_session_id,
                    authorized_operation_id,
                    operation_id,
                    operation_fingerprint_digest,
                },
            ),
        }
    }

    pub(super) fn into_step_up_signing_worker_effect_claim(
        self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerNormalSigningEffectClaimV1> {
        self.validate()?;
        match self {
            Self::VerifiedStepUpAuthorizedOperationV1 {
                authorization_session_id,
                authorized_operation_id,
                operation_id,
                operation_fingerprint_digest,
                ..
            } => Ok(CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
                authorization_session_id,
                authorized_operation_id,
                operation_id,
                operation_fingerprint_digest,
            }),
            Self::ReusableWalletSessionAuthorizedOperationV1 { .. } => Err(
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "ECDSA reusable Wallet Session authorized operation cannot use the operation step-up admission path",
                ),
            ),
        }
    }
}
