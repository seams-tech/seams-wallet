use super::{
    Ed25519YaoExecutionIdV1, Ed25519YaoInputPairBindingV1, Ed25519YaoRoleReadinessReceiptV1,
    Ed25519YaoRoleStartAcceptanceV1,
};

pub struct Ed25519YaoPreparedPairStartV1<'a> {
    pub pair_digest: [u8; 32],
    pub input_digest: [u8; 32],
    pub root_metadata_digest: [u8; 32],
    pub expires_at_ms: u64,
    pub pair_binding: &'a Ed25519YaoInputPairBindingV1,
    pub readiness_receipt: &'a Ed25519YaoRoleReadinessReceiptV1,
}

pub struct Ed25519YaoPairStartClaimV1<'a> {
    pub pair_binding: &'a Ed25519YaoInputPairBindingV1,
    pub local_receipt: &'a Ed25519YaoRoleReadinessReceiptV1,
    pub peer_receipt: &'a Ed25519YaoRoleReadinessReceiptV1,
    pub acceptance: &'a Ed25519YaoRoleStartAcceptanceV1,
    pub execution_id: Ed25519YaoExecutionIdV1,
    pub now_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ed25519YaoPairStartDecisionV1 {
    Start {
        pair_digest: [u8; 32],
        input_digest: [u8; 32],
        root_metadata_digest: [u8; 32],
        execution_id: Ed25519YaoExecutionIdV1,
        started_at_ms: u64,
    },
    IdentityMismatch,
    Expired,
    ReadinessMismatch,
}

/// Admits the exact prepared pair after the adapter verifies signed receipts.
/// Call this again against the record selected by the storage CAS.
pub fn admit_ed25519_yao_pair_start_v1(
    prepared: Ed25519YaoPreparedPairStartV1<'_>,
    claim: Ed25519YaoPairStartClaimV1<'_>,
) -> Ed25519YaoPairStartDecisionV1 {
    let pair_digest = claim.pair_binding.pair_digest().bytes;
    let input_digest = claim.pair_binding.deriver_a_input_digest().bytes;
    if prepared.pair_digest != pair_digest
        || prepared.input_digest != input_digest
        || prepared.pair_binding != claim.pair_binding
    {
        return Ed25519YaoPairStartDecisionV1::IdentityMismatch;
    }
    if claim.now_ms >= prepared.expires_at_ms {
        return Ed25519YaoPairStartDecisionV1::Expired;
    }
    if prepared.readiness_receipt != claim.local_receipt
        || claim.local_receipt.root_metadata_digest().bytes != prepared.root_metadata_digest
        || claim.peer_receipt.root_metadata_digest().bytes
            != claim.acceptance.root_metadata_digest().bytes
    {
        return Ed25519YaoPairStartDecisionV1::ReadinessMismatch;
    }
    Ed25519YaoPairStartDecisionV1::Start {
        pair_digest,
        input_digest,
        root_metadata_digest: prepared.root_metadata_digest,
        execution_id: claim.execution_id,
        started_at_ms: claim.now_ms,
    }
}
