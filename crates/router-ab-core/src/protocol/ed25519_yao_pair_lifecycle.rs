use super::{
    Ed25519YaoDeriverRoleV1, Ed25519YaoExecutionIdV1, Ed25519YaoInputPairBindingV1,
    Ed25519YaoRoleReadinessReceiptV1, Ed25519YaoRoleStartAcceptanceV1,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ed25519YaoPairClaimIdentityV1 {
    pub local_receipt: Ed25519YaoRoleReadinessReceiptV1,
    pub peer_receipt: Ed25519YaoRoleReadinessReceiptV1,
    pub acceptance: Ed25519YaoRoleStartAcceptanceV1,
}

/// The complete role-owned pair record. `P` contains the role's encrypted input
/// and private execution context; `O` contains the durable terminal response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Ed25519YaoPairRecordV1<P, O> {
    Prepared {
        pair_binding: Ed25519YaoInputPairBindingV1,
        root_metadata_digest: [u8; 32],
        expires_at_ms: u64,
        receipt: Ed25519YaoRoleReadinessReceiptV1,
        payload: P,
    },
    Running {
        pair_binding: Ed25519YaoInputPairBindingV1,
        root_metadata_digest: [u8; 32],
        execution_id: Ed25519YaoExecutionIdV1,
        started_at_ms: u64,
        claim_identity: Ed25519YaoPairClaimIdentityV1,
        payload: P,
    },
    Completed {
        pair_binding: Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
        claim_identity: Ed25519YaoPairClaimIdentityV1,
        outcome: O,
    },
    Burned {
        pair_binding: Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
    },
    Expired {
        pair_binding: Ed25519YaoInputPairBindingV1,
    },
}

impl<P, O> Ed25519YaoPairRecordV1<P, O> {
    pub fn pair_binding(&self) -> &Ed25519YaoInputPairBindingV1 {
        match self {
            Self::Prepared { pair_binding, .. }
            | Self::Running { pair_binding, .. }
            | Self::Completed { pair_binding, .. }
            | Self::Burned { pair_binding, .. }
            | Self::Expired { pair_binding } => pair_binding,
        }
    }

    pub fn outcome(&self) -> Option<&O> {
        match self {
            Self::Completed { outcome, .. } => Some(outcome),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Ed25519YaoPairRejectionV1 {
    IdentityMismatch,
    ReadinessMismatch,
    Expired,
    ConflictingExecution,
    Terminal,
}

/// A duplicate never creates a new revision. `Persist` must be committed before
/// the caller emits a readiness receipt, peer effect, or terminal response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ed25519YaoPairTransitionV1<P, O> {
    Persist(Ed25519YaoPairRecordV1<P, O>),
    Duplicate,
    Reject(Ed25519YaoPairRejectionV1),
}

/// A scoped store result after the transition and its conditional write.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Ed25519YaoPairStoreResultV1<P, O> {
    Applied {
        revision: u64,
        record: Ed25519YaoPairRecordV1<P, O>,
    },
    Duplicate {
        revision: u64,
        record: Ed25519YaoPairRecordV1<P, O>,
    },
    Rejected(Ed25519YaoPairRejectionV1),
    StaleVersion,
    UncertainWrite,
}

pub fn prepare_ed25519_yao_pair_v1<P: PartialEq, O>(
    current: Option<&Ed25519YaoPairRecordV1<P, O>>,
    proposed: Ed25519YaoPairRecordV1<P, O>,
    now_ms: u64,
) -> Ed25519YaoPairTransitionV1<P, O> {
    let Ed25519YaoPairRecordV1::Prepared {
        pair_binding,
        root_metadata_digest,
        expires_at_ms,
        receipt,
        payload,
    } = proposed
    else {
        return Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal);
    };
    if now_ms >= expires_at_ms {
        return Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Expired);
    }
    if receipt.role() != Ed25519YaoDeriverRoleV1::DeriverA
        || receipt.root_metadata_digest().bytes != root_metadata_digest
        || receipt.validate_for_pair(&pair_binding).is_err()
        || receipt.validate_at(now_ms).is_err()
    {
        return Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ReadinessMismatch);
    }
    match current {
        None => Ed25519YaoPairTransitionV1::Persist(Ed25519YaoPairRecordV1::Prepared {
            pair_binding,
            root_metadata_digest,
            expires_at_ms,
            receipt,
            payload,
        }),
        Some(Ed25519YaoPairRecordV1::Prepared {
            pair_binding: stored_binding,
            root_metadata_digest: stored_root,
            expires_at_ms: stored_expiry,
            receipt: stored_receipt,
            payload: stored_payload,
        }) if stored_binding == &pair_binding
            && stored_root == &root_metadata_digest
            && stored_expiry == &expires_at_ms
            && stored_receipt == &receipt
            && stored_payload == &payload =>
        {
            Ed25519YaoPairTransitionV1::Duplicate
        }
        Some(Ed25519YaoPairRecordV1::Prepared { .. }) => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
        }
        Some(Ed25519YaoPairRecordV1::Running { .. }) => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        }
        Some(_) => Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal),
    }
}

pub fn claim_ed25519_yao_pair_v1<P: Clone, O>(
    current: &Ed25519YaoPairRecordV1<P, O>,
    claim: Ed25519YaoPairStartClaimV1<'_>,
) -> Ed25519YaoPairTransitionV1<P, O> {
    match current {
        Ed25519YaoPairRecordV1::Prepared {
            pair_binding,
            root_metadata_digest,
            expires_at_ms,
            receipt,
            payload,
        } => {
            let decision = admit_ed25519_yao_pair_start_v1(
                Ed25519YaoPreparedPairStartV1 {
                    pair_digest: pair_binding.pair_digest().bytes,
                    input_digest: pair_binding.deriver_a_input_digest().bytes,
                    root_metadata_digest: *root_metadata_digest,
                    expires_at_ms: *expires_at_ms,
                    pair_binding,
                    readiness_receipt: receipt,
                },
                claim,
            );
            match decision {
                Ed25519YaoPairStartDecisionV1::Start {
                    execution_id,
                    started_at_ms,
                    ..
                } => Ed25519YaoPairTransitionV1::Persist(Ed25519YaoPairRecordV1::Running {
                    pair_binding: pair_binding.clone(),
                    root_metadata_digest: *root_metadata_digest,
                    execution_id,
                    started_at_ms,
                    claim_identity: Ed25519YaoPairClaimIdentityV1 {
                        local_receipt: claim.local_receipt.clone(),
                        peer_receipt: claim.peer_receipt.clone(),
                        acceptance: claim.acceptance.clone(),
                    },
                    payload: payload.clone(),
                }),
                Ed25519YaoPairStartDecisionV1::IdentityMismatch => {
                    Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
                }
                Ed25519YaoPairStartDecisionV1::Expired => {
                    Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Expired)
                }
                Ed25519YaoPairStartDecisionV1::ReadinessMismatch => {
                    Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ReadinessMismatch)
                }
            }
        }
        Ed25519YaoPairRecordV1::Running {
            pair_binding,
            execution_id,
            claim_identity,
            ..
        }
        | Ed25519YaoPairRecordV1::Completed {
            pair_binding,
            execution_id,
            claim_identity,
            ..
        } if pair_binding == claim.pair_binding
            && *execution_id == claim.execution_id
            && claim_identity.local_receipt == *claim.local_receipt
            && claim_identity.peer_receipt == *claim.peer_receipt
            && claim_identity.acceptance == *claim.acceptance =>
        {
            Ed25519YaoPairTransitionV1::Duplicate
        }
        Ed25519YaoPairRecordV1::Running { .. } | Ed25519YaoPairRecordV1::Completed { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        }
        Ed25519YaoPairRecordV1::Burned { .. } | Ed25519YaoPairRecordV1::Expired { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        }
    }
}

pub fn complete_ed25519_yao_pair_v1<P, O: PartialEq>(
    current: &Ed25519YaoPairRecordV1<P, O>,
    execution_id: Ed25519YaoExecutionIdV1,
    outcome: O,
    now_ms: u64,
    running_lifetime_ms: u64,
) -> Ed25519YaoPairTransitionV1<P, O> {
    match current {
        Ed25519YaoPairRecordV1::Running {
            pair_binding,
            execution_id: stored_execution,
            started_at_ms,
            claim_identity,
            ..
        } if *stored_execution == execution_id => {
            if now_ms.saturating_sub(*started_at_ms) >= running_lifetime_ms {
                return Ed25519YaoPairTransitionV1::Persist(Ed25519YaoPairRecordV1::Burned {
                    pair_binding: pair_binding.clone(),
                    execution_id,
                });
            }
            Ed25519YaoPairTransitionV1::Persist(Ed25519YaoPairRecordV1::Completed {
                pair_binding: pair_binding.clone(),
                execution_id,
                claim_identity: claim_identity.clone(),
                outcome,
            })
        }
        Ed25519YaoPairRecordV1::Completed {
            execution_id: stored_execution,
            outcome: stored_outcome,
            ..
        } if *stored_execution == execution_id && *stored_outcome == outcome => {
            Ed25519YaoPairTransitionV1::Duplicate
        }
        Ed25519YaoPairRecordV1::Running { .. } | Ed25519YaoPairRecordV1::Completed { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        }
        _ => Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal),
    }
}

pub fn expire_ed25519_yao_pair_v1<P, O>(
    current: &Ed25519YaoPairRecordV1<P, O>,
    now_ms: u64,
) -> Ed25519YaoPairTransitionV1<P, O> {
    match current {
        Ed25519YaoPairRecordV1::Prepared {
            pair_binding,
            expires_at_ms,
            ..
        } if now_ms >= *expires_at_ms => {
            Ed25519YaoPairTransitionV1::Persist(Ed25519YaoPairRecordV1::Expired {
                pair_binding: pair_binding.clone(),
            })
        }
        Ed25519YaoPairRecordV1::Expired { .. } => Ed25519YaoPairTransitionV1::Duplicate,
        _ => Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal),
    }
}

pub fn burn_ed25519_yao_pair_v1<P, O>(
    current: &Ed25519YaoPairRecordV1<P, O>,
    execution_id: Ed25519YaoExecutionIdV1,
) -> Ed25519YaoPairTransitionV1<P, O> {
    match current {
        Ed25519YaoPairRecordV1::Running {
            pair_binding,
            execution_id: stored_execution,
            ..
        } if *stored_execution == execution_id => {
            Ed25519YaoPairTransitionV1::Persist(Ed25519YaoPairRecordV1::Burned {
                pair_binding: pair_binding.clone(),
                execution_id,
            })
        }
        Ed25519YaoPairRecordV1::Burned {
            execution_id: stored_execution,
            ..
        } if *stored_execution == execution_id => Ed25519YaoPairTransitionV1::Duplicate,
        Ed25519YaoPairRecordV1::Running { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        }
        _ => Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal),
    }
}

pub struct Ed25519YaoPreparedPairStartV1<'a> {
    pub pair_digest: [u8; 32],
    pub input_digest: [u8; 32],
    pub root_metadata_digest: [u8; 32],
    pub expires_at_ms: u64,
    pub pair_binding: &'a Ed25519YaoInputPairBindingV1,
    pub readiness_receipt: &'a Ed25519YaoRoleReadinessReceiptV1,
}

#[derive(Clone, Copy)]
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
        || claim.local_receipt.role() != Ed25519YaoDeriverRoleV1::DeriverA
        || claim.peer_receipt.role() != Ed25519YaoDeriverRoleV1::DeriverB
        || claim.acceptance.role() != Ed25519YaoDeriverRoleV1::DeriverB
        || claim.acceptance.execution_id() != claim.execution_id
        || claim
            .local_receipt
            .validate_for_pair(claim.pair_binding)
            .is_err()
        || claim
            .peer_receipt
            .validate_for_pair(claim.pair_binding)
            .is_err()
        || claim
            .acceptance
            .validate_for_pair(claim.pair_binding)
            .is_err()
        || claim.local_receipt.validate_at(claim.now_ms).is_err()
        || claim.peer_receipt.validate_at(claim.now_ms).is_err()
        || claim.acceptance.validate_at(claim.now_ms).is_err()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::derivation::{PublicDigest32, RootShareEpoch};
    use crate::protocol::{
        Ed25519YaoCeremonyBindingV1, Ed25519YaoCeremonyIdentityV1, Ed25519YaoOperationV1,
        Ed25519YaoRoleSignatureSchemeV1, Ed25519YaoRoleSignatureV1, Ed25519YaoSessionIdV1,
        Ed25519YaoStableKeyContextBindingV1, ExpensiveWorkKindV1, LifecycleScopeV1,
        MpcMaterialActivationRefV1,
    };

    fn pair_binding() -> Ed25519YaoInputPairBindingV1 {
        let lifecycle = LifecycleScopeV1::new(
            "lifecycle-1",
            ExpensiveWorkKindV1::RegistrationPrepare,
            RootShareEpoch::new("epoch-1").expect("epoch"),
            "wallet-1",
            "session-1",
            "signer-set-1",
            "server-1",
        )
        .expect("lifecycle");
        let ceremony = Ed25519YaoCeremonyBindingV1::new(
            lifecycle,
            Ed25519YaoOperationV1::Registration,
            Ed25519YaoSessionIdV1::new([1; 32]).expect("session"),
            Ed25519YaoStableKeyContextBindingV1::new([2; 32]),
            MpcMaterialActivationRefV1::new(
                "activation-1",
                "capability-1",
                "wallet-1",
                "key-1",
                "lifecycle-1",
                "server-1",
            )
            .expect("activation"),
        )
        .expect("ceremony");
        Ed25519YaoInputPairBindingV1::new(
            Ed25519YaoCeremonyIdentityV1::from_binding(ceremony).expect("identity"),
            PublicDigest32::new([3; 32]),
            PublicDigest32::new([4; 32]),
            PublicDigest32::new([5; 32]),
            PublicDigest32::new([6; 32]),
        )
        .expect("pair")
    }

    fn receipt(
        pair: &Ed25519YaoInputPairBindingV1,
        role: Ed25519YaoDeriverRoleV1,
    ) -> Ed25519YaoRoleReadinessReceiptV1 {
        let (input_digest, root_digest) = match role {
            Ed25519YaoDeriverRoleV1::DeriverA => (pair.deriver_a_input_digest(), [7; 32]),
            Ed25519YaoDeriverRoleV1::DeriverB => (pair.deriver_b_input_digest(), [8; 32]),
        };
        Ed25519YaoRoleReadinessReceiptV1::new(
            role,
            pair.ceremony().binding().session_id,
            pair.pair_digest(),
            input_digest,
            PublicDigest32::new(root_digest),
            100,
            200,
            Ed25519YaoRoleSignatureV1::new(Ed25519YaoRoleSignatureSchemeV1::Ed25519V1, [9; 64])
                .expect("signature"),
        )
        .expect("receipt")
    }

    fn acceptance(
        pair: &Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
    ) -> Ed25519YaoRoleStartAcceptanceV1 {
        Ed25519YaoRoleStartAcceptanceV1::new(
            Ed25519YaoDeriverRoleV1::DeriverB,
            pair.ceremony().binding().session_id,
            pair.pair_digest(),
            execution_id,
            PublicDigest32::new([8; 32]),
            100,
            200,
            Ed25519YaoRoleSignatureV1::new(Ed25519YaoRoleSignatureSchemeV1::Ed25519V1, [9; 64])
                .expect("signature"),
        )
        .expect("acceptance")
    }

    #[test]
    fn pair_claim_completion_and_replay_keep_one_execution() {
        let pair = pair_binding();
        let local = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverA);
        let peer = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverB);
        let first_id = Ed25519YaoExecutionIdV1::new([10; 32]).expect("first id");
        let second_id = Ed25519YaoExecutionIdV1::new([11; 32]).expect("second id");
        let first_acceptance = acceptance(&pair, first_id);
        let second_acceptance = acceptance(&pair, second_id);
        let prepared = Ed25519YaoPairRecordV1::<u8, String>::Prepared {
            pair_binding: pair.clone(),
            root_metadata_digest: [7; 32],
            expires_at_ms: 150,
            receipt: local.clone(),
            payload: 42,
        };
        assert_eq!(
            prepare_ed25519_yao_pair_v1(None, prepared.clone(), 110),
            Ed25519YaoPairTransitionV1::Persist(prepared.clone())
        );
        assert_eq!(
            prepare_ed25519_yao_pair_v1(Some(&prepared), prepared.clone(), 110),
            Ed25519YaoPairTransitionV1::Duplicate
        );
        let first_claim = Ed25519YaoPairStartClaimV1 {
            pair_binding: &pair,
            local_receipt: &local,
            peer_receipt: &peer,
            acceptance: &first_acceptance,
            execution_id: first_id,
            now_ms: 120,
        };
        let running = match claim_ed25519_yao_pair_v1(&prepared, first_claim) {
            Ed25519YaoPairTransitionV1::Persist(record) => record,
            other => panic!("expected running record: {other:?}"),
        };
        assert_eq!(
            claim_ed25519_yao_pair_v1(&running, first_claim),
            Ed25519YaoPairTransitionV1::Duplicate
        );
        let changed_acceptance = Ed25519YaoRoleStartAcceptanceV1::new(
            Ed25519YaoDeriverRoleV1::DeriverB,
            pair.ceremony().binding().session_id,
            pair.pair_digest(),
            first_id,
            PublicDigest32::new([8; 32]),
            101,
            200,
            Ed25519YaoRoleSignatureV1::new(Ed25519YaoRoleSignatureSchemeV1::Ed25519V1, [9; 64])
                .expect("signature"),
        )
        .expect("changed acceptance");
        assert_eq!(
            claim_ed25519_yao_pair_v1(
                &running,
                Ed25519YaoPairStartClaimV1 {
                    acceptance: &changed_acceptance,
                    ..first_claim
                }
            ),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        );
        assert_eq!(
            claim_ed25519_yao_pair_v1(
                &running,
                Ed25519YaoPairStartClaimV1 {
                    execution_id: second_id,
                    acceptance: &second_acceptance,
                    ..first_claim
                }
            ),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        );
        let completed = match complete_ed25519_yao_pair_v1(
            &running,
            first_id,
            "sealed outcome".to_owned(),
            125,
            60_000,
        ) {
            Ed25519YaoPairTransitionV1::Persist(record) => record,
            other => panic!("expected completion: {other:?}"),
        };
        assert_eq!(
            completed.outcome().map(String::as_str),
            Some("sealed outcome")
        );
        assert_eq!(
            complete_ed25519_yao_pair_v1(
                &completed,
                first_id,
                "sealed outcome".to_owned(),
                126,
                60_000,
            ),
            Ed25519YaoPairTransitionV1::Duplicate
        );
        assert_eq!(
            claim_ed25519_yao_pair_v1(&completed, first_claim),
            Ed25519YaoPairTransitionV1::Duplicate
        );
        assert_eq!(
            burn_ed25519_yao_pair_v1(&completed, first_id),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        );
    }

    #[test]
    fn expired_and_burned_pairs_never_return_to_prepared() {
        let pair = pair_binding();
        let local = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverA);
        let peer = receipt(&pair, Ed25519YaoDeriverRoleV1::DeriverB);
        let execution_id = Ed25519YaoExecutionIdV1::new([10; 32]).expect("id");
        let acceptance = acceptance(&pair, execution_id);
        let prepared = Ed25519YaoPairRecordV1::<u8, String>::Prepared {
            pair_binding: pair.clone(),
            root_metadata_digest: [7; 32],
            expires_at_ms: 150,
            receipt: local.clone(),
            payload: 42,
        };
        let expired = match expire_ed25519_yao_pair_v1(&prepared, 150) {
            Ed25519YaoPairTransitionV1::Persist(record) => record,
            other => panic!("expected expiry: {other:?}"),
        };
        assert_eq!(
            prepare_ed25519_yao_pair_v1(Some(&expired), prepared.clone(), 120),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        );
        let claim = Ed25519YaoPairStartClaimV1 {
            pair_binding: &pair,
            local_receipt: &local,
            peer_receipt: &peer,
            acceptance: &acceptance,
            execution_id,
            now_ms: 120,
        };
        let running = match claim_ed25519_yao_pair_v1(&prepared, claim) {
            Ed25519YaoPairTransitionV1::Persist(record) => record,
            other => panic!("expected claim: {other:?}"),
        };
        let burned = match burn_ed25519_yao_pair_v1(&running, execution_id) {
            Ed25519YaoPairTransitionV1::Persist(record) => record,
            other => panic!("expected burn: {other:?}"),
        };
        assert_eq!(
            claim_ed25519_yao_pair_v1(&burned, claim),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        );
        assert_eq!(
            prepare_ed25519_yao_pair_v1(Some(&burned), prepared, 120),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        );
    }
}
