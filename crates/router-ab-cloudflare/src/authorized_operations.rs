//! Curve-specific authorized operations and accepted capability bindings.

use crate::*;

// Without the Worker entries only the Ed25519 paths are compiled.
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
mod curve_checks;
use curve_checks::*;

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
        binding_wallet_scope(
            self.binding.fields(),
            "a Gateway owner Wallet Session or verified step-up binding is required",
        )
    }

    pub(super) fn into_signing_worker_authorized_operation_identity(
        &self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerAuthorizedOperationIdentityV1> {
        self.validate()?;
        operation_identity(
            AuthorizedOperationCurveV1::Ed25519,
            self.binding.fields(),
            self.authorized_operation.fields(),
        )
    }

    pub(super) fn reusable_authorization_id(&self) -> RouterAbProtocolResult<&str> {
        reusable_authorization_id(AuthorizedOperationCurveV1::Ed25519, self.binding.fields())
    }

    pub(super) fn validate(&self) -> RouterAbProtocolResult<()> {
        validate_accepted_operation(
            AuthorizedOperationCurveV1::Ed25519,
            self.binding.fields(),
            self.authorized_operation.fields(),
            || self.authorized_operation.validate(),
        )
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
    pub(crate) fn gateway_owner_wallet_session_credential(
        &self,
        trusted_source_digest: PublicDigest32,
    ) -> RouterAbProtocolResult<CloudflareRouterWalletSessionCredentialV1> {
        self.validate()?;
        gateway_owner_credential(
            AuthorizedOperationCurveV1::Ed25519,
            self.binding.fields(),
            "near-ed25519",
            trusted_source_digest,
        )
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
        validate_operation_fields(AuthorizedOperationCurveV1::Ed25519, self.fields())
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
        let fields = self.fields();
        if fields.intent_digest_b64u != &intent_digest_b64u
            || fields.display_digest_b64u != &display_digest_b64u
        {
            return Err(invalid_gate_decision(
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
        effect_claim(self.into_claim_parts(), wallet_session_id, authorization_id)
    }

    pub(super) fn into_step_up_signing_worker_effect_claim(
        self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerNormalSigningEffectClaimV1> {
        self.validate()?;
        step_up_effect_claim(AuthorizedOperationCurveV1::Ed25519, self.into_claim_parts())
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
        binding_wallet_scope(
            self.binding.fields(),
            "an ECDSA Gateway owner Wallet Session or verified step-up binding is required",
        )
    }

    pub(super) fn validate_for_linked_device_ecdsa_finalize_request(
        &self,
        request: &router_ab_core::RouterAbEcdsaDerivationLinkedDeviceEvmDigestSigningFinalizeRequestV1,
    ) -> RouterAbProtocolResult<()> {
        self.validate()?;
        request.validate()?;
        let operation = self.authorized_operation.fields();
        if operation.authorized_operation_id
            != &format!("linked-ecdsa-authorized-operation:{}", request.request_id)
            || operation.operation_id != &request.operation_id
            || operation.intent_digest_b64u != &request.operation_digests.intent_digest_b64u
            || operation.lane_digest_b64u != &request.operation_digests.lane_digest_b64u
            || operation.display_digest_b64u != &request.operation_digests.display_digest_b64u
        {
            return Err(invalid_gate_decision(
                "ECDSA authorized operation does not match linked finalize digests",
            ));
        }
        let NormalSigningAuthorizationV1::ReusableWalletSession { wallet_session_id } =
            &request.authorization
        else {
            return Err(invalid_gate_decision(
                "linked ECDSA finalize requires reusable Wallet Session authorization",
            ));
        };
        match &self.binding {
            CloudflareRouterEcdsaAcceptedCapabilityBindingV1::ReusableWalletSession {
                wallet_session_id: admitted_wallet_session_id,
                ..
            } if admitted_wallet_session_id == wallet_session_id => Ok(()),
            _ => Err(invalid_gate_decision(
                "linked ECDSA capability binding does not match Wallet Session authorization",
            )),
        }
    }

    pub(super) fn into_signing_worker_authorized_operation_identity(
        &self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerAuthorizedOperationIdentityV1> {
        self.validate()?;
        operation_identity(
            AuthorizedOperationCurveV1::Ecdsa,
            self.binding.fields(),
            self.authorized_operation.fields(),
        )
    }

    pub(super) fn reusable_authorization_id(&self) -> RouterAbProtocolResult<&str> {
        reusable_authorization_id(AuthorizedOperationCurveV1::Ecdsa, self.binding.fields())
    }

    pub(super) fn validate(&self) -> RouterAbProtocolResult<()> {
        validate_accepted_operation(
            AuthorizedOperationCurveV1::Ecdsa,
            self.binding.fields(),
            self.authorized_operation.fields(),
            || self.authorized_operation.validate(),
        )
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
    pub(crate) fn gateway_owner_wallet_session_credential(
        &self,
        trusted_source_digest: PublicDigest32,
    ) -> RouterAbProtocolResult<CloudflareRouterWalletSessionCredentialV1> {
        self.validate()?;
        self.wallet_scope()?;
        gateway_owner_credential(
            AuthorizedOperationCurveV1::Ecdsa,
            self.binding.fields(),
            "evm-family",
            trusted_source_digest,
        )
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
        validate_operation_fields(AuthorizedOperationCurveV1::Ecdsa, self.fields())?;
        let (capability_kind, operation_kind) = match self {
            Self::ReusableWalletSessionAuthorizedOperationV1 {
                capability_kind,
                operation_kind,
                ..
            }
            | Self::VerifiedStepUpAuthorizedOperationV1 {
                capability_kind,
                operation_kind,
                ..
            } => (capability_kind, operation_kind),
        };
        if *capability_kind != CloudflareRouterEcdsaCapabilityKindV1::EvmEcdsaMpcSigning
            || *operation_kind != CloudflareRouterEcdsaOperationKindV1::SignTransaction
        {
            return Err(invalid_gate_decision(
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
        if !self.matches_operation_digests(&request.operation_id, &request.operation_digests) {
            return Err(invalid_gate_decision(
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
            _ => Err(invalid_gate_decision(
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
        if !self.matches_operation_digests(&request.operation_id, &request.operation_digests) {
            return Err(invalid_gate_decision(
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
                        return Err(invalid_gate_decision(
                            "ECDSA authorized operation session does not match Wallet Session",
                        ));
                    }
                }
                Ok(())
            }
            _ => Err(invalid_gate_decision(
                "ECDSA authorized operation branch does not match finalize authorization",
            )),
        }
    }

    /// Whether the operation names this request's operation id and digests.
    fn matches_operation_digests(
        &self,
        operation_id: &str,
        digests: &router_ab_core::RouterAbEcdsaDerivationOperationDigestsV1,
    ) -> bool {
        let fields = self.fields();
        fields.operation_id == operation_id
            && fields.intent_digest_b64u == &digests.intent_digest_b64u
            && fields.lane_digest_b64u == &digests.lane_digest_b64u
            && fields.display_digest_b64u == &digests.display_digest_b64u
    }

    pub fn authorized_operation_id(&self) -> &str {
        self.fields().authorized_operation_id
    }

    pub(super) fn into_signing_worker_effect_claim(
        self,
        wallet_session_id: String,
        authorization_id: String,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerNormalSigningEffectClaimV1> {
        self.validate()?;
        effect_claim(self.into_claim_parts(), wallet_session_id, authorization_id)
    }

    pub(super) fn into_step_up_signing_worker_effect_claim(
        self,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerNormalSigningEffectClaimV1> {
        self.validate()?;
        step_up_effect_claim(AuthorizedOperationCurveV1::Ecdsa, self.into_claim_parts())
    }
}
