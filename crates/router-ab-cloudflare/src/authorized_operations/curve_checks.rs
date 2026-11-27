//! The checks that the Ed25519 and ECDSA authorized operations share. The
//! two curves' wire types use the same variant and field names, and only
//! Ed25519 has the linked-device binding. Each curve reads its types into the
//! borrowed fields below; the checks over those fields are written once, with
//! the curve named in their error texts.

use std::fmt;

use super::*;

/// The curve that a shared check names in its error texts.
#[derive(Clone, Copy)]
pub(super) enum AuthorizedOperationCurveV1 {
    Ed25519,
    Ecdsa,
}

impl fmt::Display for AuthorizedOperationCurveV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Ed25519 => "Ed25519",
            Self::Ecdsa => "ECDSA",
        })
    }
}

impl AuthorizedOperationCurveV1 {
    /// The prefix of the authorized operation's field names in error texts.
    const fn operation_label_prefix(self) -> &'static str {
        match self {
            Self::Ed25519 => "",
            Self::Ecdsa => "ECDSA ",
        }
    }
}

/// One accepted capability binding of either curve.
#[derive(Clone, Copy)]
pub(super) enum BindingFieldsV1<'a> {
    ReusableWalletSession {
        authorization_id: &'a String,
        wallet_session_id: &'a String,
        quota_id: &'a String,
    },
    GatewayOwnerWalletSession {
        ownership_generation: u64,
        subject_id: &'a String,
        account_id: &'a String,
        authorization_id: &'a String,
        wallet_session_id: &'a String,
        quota_id: &'a String,
        threshold_session_id: &'a String,
        org_id: &'a String,
        project_id: &'a String,
        environment: &'a String,
        project_environment_id: &'a String,
        signing_worker_id: &'a String,
        expires_at_ms: u64,
    },
    GatewayLinkedDeviceWalletSession {
        ownership_generation: u64,
        subject_id: &'a String,
        account_id: &'a String,
        authorization_id: &'a String,
        wallet_session_id: &'a String,
        quota_id: &'a String,
        org_id: &'a String,
        project_id: &'a String,
        environment: &'a String,
        signing_worker_id: &'a String,
        expires_at_ms: u64,
        material_source: &'a CloudflareSigningWorkerNormalSigningMaterialSourceV1,
    },
    OperationStepUp {
        ownership_generation: u64,
        authorization_session_id: &'a String,
        org_id: &'a String,
        project_id: &'a String,
        environment: &'a String,
        project_environment_id: &'a String,
        subject_id: &'a String,
        account_id: &'a String,
    },
}

/// One authorized operation of either curve, without its kinds.
#[derive(Clone, Copy)]
pub(super) struct OperationFieldsV1<'a> {
    /// The step-up session and evidence-set digest; `None` for a reusable
    /// Wallet Session operation.
    pub(super) step_up: Option<(&'a String, &'a String)>,
    pub(super) authorized_operation_id: &'a String,
    pub(super) operation_id: &'a String,
    pub(super) lane_digest_b64u: &'a String,
    pub(super) intent_digest_b64u: &'a String,
    pub(super) display_digest_b64u: &'a String,
    pub(super) operation_fingerprint_digest: &'a String,
}

/// The parts of an authorized operation that a SigningWorker effect claim
/// keeps.
pub(super) struct OperationClaimPartsV1 {
    /// `None` for a reusable Wallet Session operation.
    pub(super) authorization_session_id: Option<String>,
    pub(super) authorized_operation_id: String,
    pub(super) operation_id: String,
    pub(super) operation_fingerprint_digest: String,
}

/// Reads one curve's binding and authorized operation into the shared
/// fields. `$extra` holds the binding arms that only this curve has.
macro_rules! authorized_operation_fields_v1 {
    ($binding:ty, $operation:ty, { $($extra:tt)* }) => {
        impl $binding {
            pub(super) fn fields(&self) -> BindingFieldsV1<'_> {
                match self {
                    Self::ReusableWalletSession {
                        authorization_id,
                        wallet_session_id,
                        quota_id,
                    } => BindingFieldsV1::ReusableWalletSession {
                        authorization_id,
                        wallet_session_id,
                        quota_id,
                    },
                    Self::GatewayOwnerWalletSession {
                        ownership_generation,
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
                    } => BindingFieldsV1::GatewayOwnerWalletSession {
                        ownership_generation: *ownership_generation,
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
                        expires_at_ms: *expires_at_ms,
                    },
                    Self::OperationStepUp {
                        ownership_generation,
                        authorization_session_id,
                        org_id,
                        project_id,
                        environment,
                        project_environment_id,
                        subject_id,
                        account_id,
                    } => BindingFieldsV1::OperationStepUp {
                        ownership_generation: *ownership_generation,
                        authorization_session_id,
                        org_id,
                        project_id,
                        environment,
                        project_environment_id,
                        subject_id,
                        account_id,
                    },
                    $($extra)*
                }
            }
        }

        impl $operation {
            pub(super) fn fields(&self) -> OperationFieldsV1<'_> {
                match self {
                    Self::ReusableWalletSessionAuthorizedOperationV1 {
                        authorized_operation_id,
                        operation_id,
                        lane_digest_b64u,
                        intent_digest_b64u,
                        display_digest_b64u,
                        operation_fingerprint_digest,
                        ..
                    } => OperationFieldsV1 {
                        step_up: None,
                        authorized_operation_id,
                        operation_id,
                        lane_digest_b64u,
                        intent_digest_b64u,
                        display_digest_b64u,
                        operation_fingerprint_digest,
                    },
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
                    } => OperationFieldsV1 {
                        step_up: Some((authorization_session_id, evidence_set_digest)),
                        authorized_operation_id,
                        operation_id,
                        lane_digest_b64u,
                        intent_digest_b64u,
                        display_digest_b64u,
                        operation_fingerprint_digest,
                    },
                }
            }

            pub(super) fn into_claim_parts(self) -> OperationClaimPartsV1 {
                match self {
                    Self::ReusableWalletSessionAuthorizedOperationV1 {
                        authorized_operation_id,
                        operation_id,
                        operation_fingerprint_digest,
                        ..
                    } => OperationClaimPartsV1 {
                        authorization_session_id: None,
                        authorized_operation_id,
                        operation_id,
                        operation_fingerprint_digest,
                    },
                    Self::VerifiedStepUpAuthorizedOperationV1 {
                        authorization_session_id,
                        authorized_operation_id,
                        operation_id,
                        operation_fingerprint_digest,
                        ..
                    } => OperationClaimPartsV1 {
                        authorization_session_id: Some(authorization_session_id),
                        authorized_operation_id,
                        operation_id,
                        operation_fingerprint_digest,
                    },
                }
            }
        }
    };
}

authorized_operation_fields_v1!(
    CloudflareRouterEd25519AcceptedCapabilityBindingV1,
    CloudflareRouterEd25519AuthorizedOperationV1,
    {
        Self::GatewayLinkedDeviceWalletSession {
            ownership_generation,
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
        } => BindingFieldsV1::GatewayLinkedDeviceWalletSession {
            ownership_generation: *ownership_generation,
            subject_id,
            account_id,
            authorization_id,
            wallet_session_id,
            quota_id,
            org_id,
            project_id,
            environment,
            signing_worker_id,
            expires_at_ms: *expires_at_ms,
            material_source,
        },
    }
);

authorized_operation_fields_v1!(
    CloudflareRouterEcdsaAcceptedCapabilityBindingV1,
    CloudflareRouterEcdsaAuthorizedOperationV1,
    {}
);

pub(super) fn invalid_gate_decision(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidGateDecision, message)
}

/// The wallet of an owner Wallet Session or verified step-up binding.
pub(super) fn binding_wallet_scope(
    binding: BindingFieldsV1<'_>,
    refusal: &'static str,
) -> RouterAbProtocolResult<CloudflareSigningWorkerWalletScopeV1> {
    match binding {
        BindingFieldsV1::GatewayOwnerWalletSession {
            org_id,
            project_id,
            project_environment_id,
            account_id,
            ..
        }
        | BindingFieldsV1::OperationStepUp {
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
        _ => Err(invalid_gate_decision(refusal)),
    }
}

pub(super) fn operation_identity(
    curve: AuthorizedOperationCurveV1,
    binding: BindingFieldsV1<'_>,
    operation: OperationFieldsV1<'_>,
) -> RouterAbProtocolResult<CloudflareSigningWorkerAuthorizedOperationIdentityV1> {
    match (binding, operation.step_up) {
        (
            BindingFieldsV1::ReusableWalletSession {
                authorization_id,
                wallet_session_id,
                ..
            }
            | BindingFieldsV1::GatewayOwnerWalletSession {
                authorization_id,
                wallet_session_id,
                ..
            }
            | BindingFieldsV1::GatewayLinkedDeviceWalletSession {
                authorization_id,
                wallet_session_id,
                ..
            },
            None,
        ) => Ok(
            CloudflareSigningWorkerAuthorizedOperationIdentityV1::ReusableWalletSession {
                authorization_id: authorization_id.clone(),
                wallet_session_id: wallet_session_id.clone(),
                authorized_operation_id: operation.authorized_operation_id.clone(),
                operation_id: operation.operation_id.clone(),
                operation_fingerprint_digest: operation.operation_fingerprint_digest.clone(),
            },
        ),
        (
            BindingFieldsV1::OperationStepUp {
                authorization_session_id,
                ..
            },
            Some(_),
        ) => Ok(
            CloudflareSigningWorkerAuthorizedOperationIdentityV1::OperationStepUp {
                authorization_session_id: authorization_session_id.clone(),
                authorized_operation_id: operation.authorized_operation_id.clone(),
                operation_id: operation.operation_id.clone(),
                operation_fingerprint_digest: operation.operation_fingerprint_digest.clone(),
            },
        ),
        _ => Err(invalid_gate_decision(format!(
            "accepted {curve} operation identity branch does not match authorized operation"
        ))),
    }
}

pub(super) fn reusable_authorization_id(
    curve: AuthorizedOperationCurveV1,
    binding: BindingFieldsV1<'_>,
) -> RouterAbProtocolResult<&str> {
    match binding {
        BindingFieldsV1::ReusableWalletSession {
            authorization_id, ..
        }
        | BindingFieldsV1::GatewayOwnerWalletSession {
            authorization_id, ..
        }
        | BindingFieldsV1::GatewayLinkedDeviceWalletSession {
            authorization_id, ..
        } => Ok(authorization_id),
        BindingFieldsV1::OperationStepUp { .. } => Err(invalid_gate_decision(format!(
            "{curve} operation step-up has no reusable authorization id"
        ))),
    }
}

/// Checks a binding and its authorized operation together. The binding's
/// wallet generation is checked first, then `validate_operation`, then the
/// pair.
pub(super) fn validate_accepted_operation(
    curve: AuthorizedOperationCurveV1,
    binding: BindingFieldsV1<'_>,
    operation: OperationFieldsV1<'_>,
    validate_operation: impl FnOnce() -> RouterAbProtocolResult<()>,
) -> RouterAbProtocolResult<()> {
    match binding {
        BindingFieldsV1::GatewayOwnerWalletSession {
            ownership_generation,
            ..
        }
        | BindingFieldsV1::OperationStepUp {
            ownership_generation,
            ..
        } => {
            crate::router_wallet::validate_wallet_ownership_generation(ownership_generation)?;
        }
        BindingFieldsV1::ReusableWalletSession { .. }
        | BindingFieldsV1::GatewayLinkedDeviceWalletSession { .. } => {}
    }
    validate_operation()?;
    let require =
        |label: &str, value: &str| require_non_empty(&format!("accepted {curve} {label}"), value);
    match (binding, operation.step_up) {
        (
            BindingFieldsV1::ReusableWalletSession {
                authorization_id,
                wallet_session_id,
                quota_id,
            },
            None,
        ) => {
            require("authorization_id", authorization_id)?;
            require("wallet_session_id", wallet_session_id)?;
            require("quota_id", quota_id)?;
            if !pairwise_distinct(authorization_id, wallet_session_id, quota_id) {
                return Err(invalid_gate_decision(format!(
                    "accepted {curve} authorization, Wallet Session, and quota ids must be pairwise distinct"
                )));
            }
            Ok(())
        }
        (
            BindingFieldsV1::GatewayOwnerWalletSession {
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
            None,
        ) => {
            require("Gateway subject_id", subject_id)?;
            require("Gateway account_id", account_id)?;
            require("Gateway authorization_id", authorization_id)?;
            require("Gateway wallet_session_id", wallet_session_id)?;
            require("Gateway quota_id", quota_id)?;
            require("Gateway threshold_session_id", threshold_session_id)?;
            require("Gateway org_id", org_id)?;
            require("Gateway project_id", project_id)?;
            require("Gateway environment", environment)?;
            require("Gateway project_environment_id", project_environment_id)?;
            require("Gateway signing_worker_id", signing_worker_id)?;
            require_positive_ms(
                &format!("accepted {curve} Gateway expires_at_ms"),
                expires_at_ms,
            )?;
            if !pairwise_distinct(authorization_id, wallet_session_id, quota_id) {
                return Err(invalid_gate_decision(format!(
                    "accepted {curve} Gateway authorization ids must be pairwise distinct"
                )));
            }
            Ok(())
        }
        (
            BindingFieldsV1::GatewayLinkedDeviceWalletSession {
                ownership_generation,
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
            },
            None,
        ) => {
            crate::router_wallet::validate_wallet_ownership_generation(ownership_generation)?;
            require("linked-device subject_id", subject_id)?;
            require("linked-device account_id", account_id)?;
            require("linked-device authorization_id", authorization_id)?;
            require("linked-device wallet_session_id", wallet_session_id)?;
            require("linked-device quota_id", quota_id)?;
            require("linked-device org_id", org_id)?;
            require("linked-device project_id", project_id)?;
            require("linked-device environment", environment)?;
            require("linked-device signing_worker_id", signing_worker_id)?;
            require_positive_ms(
                &format!("accepted {curve} linked-device expires_at_ms"),
                expires_at_ms,
            )?;
            if !matches!(
                material_source,
                CloudflareSigningWorkerNormalSigningMaterialSourceV1::RotatableLane { .. }
            ) {
                return Err(invalid_gate_decision(format!(
                    "accepted {curve} linked-device material source must be a rotatable lane"
                )));
            }
            if !pairwise_distinct(authorization_id, wallet_session_id, quota_id) {
                return Err(invalid_gate_decision(format!(
                    "accepted {curve} linked-device authorization ids must be pairwise distinct"
                )));
            }
            Ok(())
        }
        (
            BindingFieldsV1::OperationStepUp {
                ownership_generation: _,
                authorization_session_id,
                org_id,
                project_id,
                environment,
                project_environment_id,
                subject_id,
                account_id,
            },
            Some((authorized_operation_session, _)),
        ) if authorization_session_id == authorized_operation_session => {
            require("authorization_session_id", authorization_session_id)?;
            require("org_id", org_id)?;
            require("project_id", project_id)?;
            require("environment", environment)?;
            require("project_environment_id", project_environment_id)?;
            require("subject_id", subject_id)?;
            require("account_id", account_id)
        }
        _ => Err(invalid_gate_decision(format!(
            "accepted {curve} capability binding does not match authorized operation"
        ))),
    }
}

fn pairwise_distinct(authorization_id: &str, wallet_session_id: &str, quota_id: &str) -> bool {
    authorization_id != wallet_session_id
        && authorization_id != quota_id
        && wallet_session_id != quota_id
}

/// The Wallet Session credential that a Gateway owner binding implies.
// Only the Router entry calls this helper's callers.
#[cfg_attr(not(feature = "strict-worker-router-entrypoint"), allow(dead_code))]
pub(super) fn gateway_owner_credential(
    curve: AuthorizedOperationCurveV1,
    binding: BindingFieldsV1<'_>,
    authorization_level: &'static str,
    trusted_source_digest: PublicDigest32,
) -> RouterAbProtocolResult<CloudflareRouterWalletSessionCredentialV1> {
    let BindingFieldsV1::GatewayOwnerWalletSession {
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
    } = binding
    else {
        return Err(invalid_gate_decision(format!(
            "{curve} Gateway owner Wallet Session admission is required"
        )));
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
        authorization_level,
        signing_worker_id.clone(),
        trusted_source_digest,
        expires_at_ms,
    )?;
    CloudflareRouterWalletSessionCredentialV1::gateway_owner(wallet_session)
}

pub(super) fn validate_operation_fields(
    curve: AuthorizedOperationCurveV1,
    operation: OperationFieldsV1<'_>,
) -> RouterAbProtocolResult<()> {
    let prefix = curve.operation_label_prefix();
    let label = |field: &str| format!("{prefix}authorized_operation.{field}");
    if let Some((authorization_session_id, evidence_set_digest)) = operation.step_up {
        require_non_empty(&label("authorization_session_id"), authorization_session_id)?;
        decode_public_digest_b64u_v1(&label("evidence_set_digest"), evidence_set_digest)?;
    }
    require_non_empty(
        &label("authorized_operation_id"),
        operation.authorized_operation_id,
    )?;
    require_non_empty(&label("operation_id"), operation.operation_id)?;
    decode_public_digest_b64u_v1(&label("lane_digest_b64u"), operation.lane_digest_b64u)?;
    decode_public_digest_b64u_v1(&label("intent_digest_b64u"), operation.intent_digest_b64u)?;
    decode_public_digest_b64u_v1(&label("display_digest_b64u"), operation.display_digest_b64u)?;
    decode_public_digest_b64u_v1(
        &label("operation_fingerprint_digest"),
        operation.operation_fingerprint_digest,
    )?;
    Ok(())
}

pub(super) fn effect_claim(
    parts: OperationClaimPartsV1,
    wallet_session_id: String,
    authorization_id: String,
) -> RouterAbProtocolResult<CloudflareSigningWorkerNormalSigningEffectClaimV1> {
    match parts.authorization_session_id {
        None => Ok(
            CloudflareSigningWorkerNormalSigningEffectClaimV1::ReusableWalletSession {
                claim: CloudflareSigningWorkerReusableWalletSessionEffectClaimV1::new(
                    authorization_id,
                    wallet_session_id,
                    parts.authorized_operation_id,
                    parts.operation_id,
                    parts.operation_fingerprint_digest,
                )?,
            },
        ),
        Some(authorization_session_id) => Ok(
            CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
                authorization_session_id,
                authorized_operation_id: parts.authorized_operation_id,
                operation_id: parts.operation_id,
                operation_fingerprint_digest: parts.operation_fingerprint_digest,
            },
        ),
    }
}

// Only the Router entry calls this helper's callers.
#[cfg_attr(not(feature = "strict-worker-router-entrypoint"), allow(dead_code))]
pub(super) fn step_up_effect_claim(
    curve: AuthorizedOperationCurveV1,
    parts: OperationClaimPartsV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerNormalSigningEffectClaimV1> {
    match parts.authorization_session_id {
        Some(authorization_session_id) => Ok(
            CloudflareSigningWorkerNormalSigningEffectClaimV1::OperationStepUp {
                authorization_session_id,
                authorized_operation_id: parts.authorized_operation_id,
                operation_id: parts.operation_id,
                operation_fingerprint_digest: parts.operation_fingerprint_digest,
            },
        ),
        None => Err(invalid_gate_decision(format!(
            "{curve} reusable Wallet Session authorized operation cannot use the operation step-up admission path"
        ))),
    }
}
