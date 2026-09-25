//! Host-neutral Router checks for one Yao pair execution.
//!
//! The Cloudflare Router coordinator and the VM Router process both validate
//! Deriver readiness receipts and role executions with these functions, so a
//! receipt or execution accepted by one host is accepted by the other.

use ed25519_dalek::{Signature, VerifyingKey};
use router_ab_core::{
    Ed25519YaoCeremonyBindingV1, Ed25519YaoDeriverRoleV1, Ed25519YaoInputPairBindingV1,
    Ed25519YaoRoleReadinessReceiptV1, RouterAbProtocolError, RouterAbProtocolErrorCode,
    RouterAbProtocolResult,
};
use router_ab_ed25519_yao::{
    Ed25519YaoActivationRoleExecutionV1, Ed25519YaoExportRoleExecutionV1,
    Ed25519YaoLaneRoleExecutionV1, Ed25519YaoRoleExecutionV1,
};

use crate::CloudflareSignerPeerVerifyingKeySetV1;

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
