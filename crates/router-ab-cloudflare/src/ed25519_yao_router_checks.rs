//! Host-neutral Router checks for one Yao pair execution.
//!
//! The Cloudflare Router coordinator and the VM Router process both validate
//! Deriver readiness receipts and role executions with these functions, so a
//! receipt or execution accepted by one host is accepted by the other.

use ed25519_dalek::{Signature, VerifyingKey};
use router_ab_core::{
    Ed25519YaoCeremonyBindingV1, Ed25519YaoDeriverRoleV1, Ed25519YaoInputPairBindingV1,
    Ed25519YaoOperationV1, Ed25519YaoPackageKindV1, Ed25519YaoRoleReadinessReceiptV1,
    RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult,
};
use router_ab_ed25519_yao::{
    Ed25519YaoActivationRoleExecutionV1, Ed25519YaoExportRoleExecutionV1,
    Ed25519YaoLaneRoleExecutionV1, Ed25519YaoRoleExecutionV1,
};
use serde::{Deserialize, Serialize};

use crate::{
    CloudflareEd25519YaoInactiveReservationResponseV1, CloudflareRouterEd25519YaoExecuteRequestV2,
    CloudflareSignerPeerVerifyingKeySetV1,
};

/// Header the Gateway sets when it re-dispatches an execution it may already
/// have sent; only then does the Router reconcile a prior run first.
pub const ROUTER_ED25519_YAO_REPLAY_HEADER_V1: &str = "x-seams-yao-replay";

/// Parses the Gateway replay header: absent or `0` is a first dispatch, `1` a
/// replay, anything else a malformed request.
pub fn parse_router_ed25519_yao_replay_header_v1(value: Option<&str>) -> RouterAbProtocolResult<bool> {
    match value {
        None | Some("0") => Ok(false),
        Some("1") => Ok(true),
        Some(_) => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
            "Router replay header must be 0 or 1",
        )),
    }
}

// Worker clocks expose the last I/O time, so a nested peer handoff can arrive slightly "future".
pub(crate) const YAO_READINESS_RECEIPT_MAX_FUTURE_SKEW_MS: u64 = 1_000;

/// Verifies the Deriver's signature over its readiness receipt.
pub fn verify_role_readiness_receipt_v1(
    receipt: &Ed25519YaoRoleReadinessReceiptV1,
    verifying_keys: &CloudflareSignerPeerVerifyingKeySetV1,
) -> RouterAbProtocolResult<()> {
    let verifying_key_bytes = match receipt.role() {
        Ed25519YaoDeriverRoleV1::DeriverA => verifying_keys.deriver_a.verifying_key_bytes,
        Ed25519YaoDeriverRoleV1::DeriverB => verifying_keys.deriver_b.verifying_key_bytes,
    };
    let verifying_key = VerifyingKey::from_bytes(&verifying_key_bytes)
        .map_err(|_| invalid_readiness("readiness receipt verifying key is malformed"))?;
    let signature = Signature::from_slice(receipt.signature().bytes())
        .map_err(|_| invalid_readiness("readiness receipt signature is malformed"))?;
    verifying_key
        .verify_strict(receipt.signed_message_digest().as_bytes(), &signature)
        .map_err(|_| invalid_readiness("readiness receipt signature is invalid"))
}

/// Checks the readiness receipt's validity window at `now_unix_ms`.
pub fn validate_cloudflare_role_readiness_receipt_v1(
    receipt: &Ed25519YaoRoleReadinessReceiptV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<()> {
    receipt.validate_at_with_max_future_skew(now_unix_ms, YAO_READINESS_RECEIPT_MAX_FUTURE_SKEW_MS)
}

/// Everything the Router requires of one Deriver's readiness before it lets
/// the pair execute: the expected role, the exact pair, freshness, and the
/// role's signature.
pub fn validate_router_ed25519_yao_readiness_v1(
    receipt: &Ed25519YaoRoleReadinessReceiptV1,
    pair_binding: &Ed25519YaoInputPairBindingV1,
    now_ms: u64,
    role: Ed25519YaoDeriverRoleV1,
    verifying_keys: &CloudflareSignerPeerVerifyingKeySetV1,
) -> RouterAbProtocolResult<()> {
    if receipt.role() != role {
        return Err(invalid_check("readiness receipt role mismatch"));
    }
    receipt.validate_for_pair(pair_binding)?;
    validate_cloudflare_role_readiness_receipt_v1(receipt, now_ms)?;
    verify_role_readiness_receipt_v1(receipt, verifying_keys)
}

/// Checks that one role's execution belongs to the admitted ceremony session
/// and, when given, carries the other role's transcript.
pub fn validate_router_ed25519_yao_role_execution_v1(
    execution: &Ed25519YaoRoleExecutionV1,
    role: Ed25519YaoDeriverRoleV1,
    binding: &Ed25519YaoCeremonyBindingV1,
    transcript: Option<[u8; 32]>,
) -> RouterAbProtocolResult<()> {
    execution.validate()?;
    let binding_matches = match execution {
        Ed25519YaoRoleExecutionV1::Activation(value) => &value.binding == binding,
        Ed25519YaoRoleExecutionV1::Export(value) => &value.binding == binding,
        Ed25519YaoRoleExecutionV1::Lane(value) => {
            value.job.yao_request_kind.operation() == binding.operation
                && value.session == binding.session_id.into_bytes()
                && value
                    .job
                    .stable_context_binding_v1()
                    .is_ok_and(|stable| stable == binding.stable_key_context_binding.into_bytes())
                && value.job.source.material_activation == *binding.material_activation()
        }
    };
    if execution.deriver() != role
        || execution.session() != binding.session_id.into_bytes()
        || !binding_matches
    {
        return Err(invalid_check("role execution binding mismatch"));
    }
    if let Some(transcript) = transcript {
        if ed25519_yao_role_execution_transcript_v1(execution) != transcript {
            return Err(invalid_check("role execution transcript mismatch"));
        }
    }
    Ok(())
}

pub fn ed25519_yao_role_execution_transcript_v1(execution: &Ed25519YaoRoleExecutionV1) -> [u8; 32] {
    match execution {
        Ed25519YaoRoleExecutionV1::Activation(value) => value.transcript,
        Ed25519YaoRoleExecutionV1::Export(value) => value.transcript,
        Ed25519YaoRoleExecutionV1::Lane(value) => value.transcript,
    }
}

pub fn ed25519_yao_activation_role_execution_v1(
    execution: &Ed25519YaoRoleExecutionV1,
) -> RouterAbProtocolResult<&Ed25519YaoActivationRoleExecutionV1> {
    match execution {
        Ed25519YaoRoleExecutionV1::Activation(value) => Ok(value),
        Ed25519YaoRoleExecutionV1::Export(_) => Err(invalid_check(
            "activation operation returned an export role execution",
        )),
        Ed25519YaoRoleExecutionV1::Lane(_) => Err(invalid_check(
            "activation operation returned a lane role execution",
        )),
    }
}

pub fn ed25519_yao_export_role_execution_v1(
    execution: &Ed25519YaoRoleExecutionV1,
) -> RouterAbProtocolResult<&Ed25519YaoExportRoleExecutionV1> {
    match execution {
        Ed25519YaoRoleExecutionV1::Export(value) => Ok(value),
        Ed25519YaoRoleExecutionV1::Activation(_) => Err(invalid_check(
            "export operation returned an activation role execution",
        )),
        Ed25519YaoRoleExecutionV1::Lane(_) => Err(invalid_check(
            "export operation returned a lane role execution",
        )),
    }
}

pub fn ed25519_yao_lane_role_execution_v1(
    execution: &Ed25519YaoRoleExecutionV1,
) -> RouterAbProtocolResult<&Ed25519YaoLaneRoleExecutionV1> {
    match execution {
        Ed25519YaoRoleExecutionV1::Lane(value) => Ok(value),
        Ed25519YaoRoleExecutionV1::Activation(_) => Err(invalid_check(
            "lane operation returned an activation role execution",
        )),
        Ed25519YaoRoleExecutionV1::Export(_) => Err(invalid_check(
            "lane operation returned an export role execution",
        )),
    }
}

fn invalid_readiness(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}

fn invalid_check(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MalformedWirePayload, message)
}

/// Source-preserving target execution request. The target remains the normal
/// Gateway request shape; the source binding is carried beside it so Router
/// can preserve the exact active public identity without persisting a link
/// ceremony or invoking lifecycle activation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterEd25519YaoSourcePreservingExecuteRequestV1 {
    pub source_binding: Ed25519YaoCeremonyBindingV1,
    pub target: CloudflareRouterEd25519YaoExecuteRequestV2,
}

impl CloudflareRouterEd25519YaoSourcePreservingExecuteRequestV1 {
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.source_binding.validate()?;
        self.target.validate()?;
        if self.source_binding.operation != Ed25519YaoOperationV1::Registration {
            return Err(invalid_source_preserving(
                "source-preserving Router execution requires a registration source binding",
            ));
        }
        if self.target.target.operation() != Ed25519YaoOperationV1::Registration {
            return Err(invalid_source_preserving(
                "source-preserving Router execution requires a registration target request",
            ));
        }
        validate_source_target_identity_v1(
            &self.source_binding,
            self.target.target.ceremony_binding(),
        )
    }
}

pub(crate) fn validate_source_target_identity_v1(
    source: &Ed25519YaoCeremonyBindingV1,
    target: &Ed25519YaoCeremonyBindingV1,
) -> RouterAbProtocolResult<()> {
    source.validate()?;
    target.validate()?;
    if source.operation != Ed25519YaoOperationV1::Registration
        || target.operation != Ed25519YaoOperationV1::Registration
        || source.material_activation == target.material_activation
        || source.material_activation.kind != target.material_activation.kind
        || source.material_activation.capability != target.material_activation.capability
        || source.material_activation.material_owner != target.material_activation.material_owner
        || source.material_activation.key_binding != target.material_activation.key_binding
        || source.material_activation.lifecycle_binding
            != target.material_activation.lifecycle_binding
        || source.material_activation.signing_worker != target.material_activation.signing_worker
        || source.stable_key_context_binding != target.stable_key_context_binding
        || source.lifecycle.root_share_epoch != target.lifecycle.root_share_epoch
        || source.lifecycle.account_id != target.lifecycle.account_id
        || source.lifecycle.signer_set_id != target.lifecycle.signer_set_id
        || source.lifecycle.selected_server_id != target.lifecycle.selected_server_id
    {
        return Err(invalid_source_preserving(
            "source-preserving Router execution changed the stable signing identity",
        ));
    }
    Ok(())
}

#[cfg(feature = "workers-rs")]
pub(crate) fn validate_source_preserving_participant_ids_v1(
    participant_ids: [u16; 2],
) -> RouterAbProtocolResult<()> {
    if participant_ids[0] == 0
        || participant_ids[1] == 0
        || participant_ids[0] >= participant_ids[1]
    {
        return Err(invalid_source_preserving(
            "source-preserving Router participant ids must be distinct, nonzero, ascending values",
        ));
    }
    Ok(())
}

/// Checks a SigningWorker's linked-device reservation against the target
/// the Router executed: every host's Router accepts the same answers.
pub fn validate_source_preserving_reservation_response_v1(
    response: &CloudflareEd25519YaoInactiveReservationResponseV1,
    target_binding: &Ed25519YaoCeremonyBindingV1,
    participant_ids: [u16; 2],
    deriver_a_client_package: &router_ab_core::Ed25519YaoEncryptedPackageV1,
    deriver_b_client_package: &router_ab_core::Ed25519YaoEncryptedPackageV1,
) -> RouterAbProtocolResult<()> {
    if response.state != "inactive"
        || response.reservation_id.is_empty()
        || response
            .reservation_id
            .chars()
            .any(|character| character.is_ascii_control())
        || response.participant_ids != participant_ids
        || response.deriver_a_client_package != *deriver_a_client_package
        || response.deriver_b_client_package != *deriver_b_client_package
        || response.activation_receipt.material_activation() != target_binding.material_activation()
        || response.activation_receipt.transcript() != deriver_a_client_package.transcript()
        || response.activation_receipt.transcript() != deriver_b_client_package.transcript()
    {
        return Err(invalid_source_preserving(
            "source-preserving SigningWorker reservation response does not match the target",
        ));
    }
    validate_activation_client_package_v1(
        deriver_a_client_package,
        target_binding,
        Ed25519YaoDeriverRoleV1::DeriverA,
    )?;
    validate_activation_client_package_v1(
        deriver_b_client_package,
        target_binding,
        Ed25519YaoDeriverRoleV1::DeriverB,
    )
}

fn validate_activation_client_package_v1(
    package: &router_ab_core::Ed25519YaoEncryptedPackageV1,
    target_binding: &Ed25519YaoCeremonyBindingV1,
    deriver: Ed25519YaoDeriverRoleV1,
) -> RouterAbProtocolResult<()> {
    package.validate()?;
    if package.kind() != Ed25519YaoPackageKindV1::ActivationClient
        || package.deriver() != deriver
        || package.session() != target_binding.session_id.into_bytes()
        || package.transcript() == [0; 32]
    {
        return Err(invalid_source_preserving(
            "source-preserving client package does not match the target binding",
        ));
    }
    Ok(())
}

fn invalid_source_preserving(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MalformedWirePayload, message)
}
