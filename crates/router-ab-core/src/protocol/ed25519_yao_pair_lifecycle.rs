use super::{Ed25519YaoExecutionIdV1, Ed25519YaoInputPairBindingV1};
use serde::{Deserialize, Serialize};

/// The complete role-owned pair record. `P` contains the role's encrypted input
/// and private execution context; `O` contains the durable terminal response.
///
/// `root_metadata_digest` names the role's own root share. Each role checks it
/// against its own root; the two roles' digests differ and are never compared.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Ed25519YaoPairRecordV1<P, O> {
    Prepared {
        pair_binding: Ed25519YaoInputPairBindingV1,
        root_metadata_digest: [u8; 32],
        expires_at_ms: u64,
        payload: P,
    },
    /// One executor reserved the pair and is connecting to its peer. Until
    /// the peer claims the execution, the reservation can be released.
    Starting {
        pair_binding: Ed25519YaoInputPairBindingV1,
        root_metadata_digest: [u8; 32],
        expires_at_ms: u64,
        execution_id: Ed25519YaoExecutionIdV1,
        started_at_ms: u64,
        payload: P,
    },
    /// The peer claimed the execution and this role claimed it after: the
    /// last durable step before this role's first protocol message.
    Running {
        pair_binding: Ed25519YaoInputPairBindingV1,
        root_metadata_digest: [u8; 32],
        execution_id: Ed25519YaoExecutionIdV1,
        started_at_ms: u64,
        payload: P,
    },
    Completed {
        pair_binding: Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
        payload: P,
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
            | Self::Starting { pair_binding, .. }
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
    Expired,
    ConflictingExecution,
    Terminal,
}

/// A duplicate never creates a new revision. `Persist` must be committed before
/// the caller emits a peer effect or terminal response.
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

/// The one executor of a pair: the exact binding it runs, the execution
/// identity it allocated, and its clock.
#[derive(Clone, Copy)]
pub struct Ed25519YaoPairExecutorV1<'a> {
    pub pair_binding: &'a Ed25519YaoInputPairBindingV1,
    pub execution_id: Ed25519YaoExecutionIdV1,
    pub now_ms: u64,
}

/// Stores a preparation. A later preparation of the same pair replaces one
/// that no executor reserved: each Router run prepares the pair again, with
/// that run's context in the payload.
pub fn prepare_ed25519_yao_pair_v1<P: PartialEq, O>(
    current: Option<&Ed25519YaoPairRecordV1<P, O>>,
    proposed: Ed25519YaoPairRecordV1<P, O>,
    now_ms: u64,
) -> Ed25519YaoPairTransitionV1<P, O> {
    let Ed25519YaoPairRecordV1::Prepared {
        pair_binding,
        root_metadata_digest,
        expires_at_ms,
        payload,
    } = proposed
    else {
        return Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal);
    };
    if root_metadata_digest.iter().all(|byte| *byte == 0) {
        return Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch);
    }
    if now_ms >= expires_at_ms {
        return Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Expired);
    }
    match current {
        None => Ed25519YaoPairTransitionV1::Persist(Ed25519YaoPairRecordV1::Prepared {
            pair_binding,
            root_metadata_digest,
            expires_at_ms,
            payload,
        }),
        Some(Ed25519YaoPairRecordV1::Prepared {
            pair_binding: stored_binding,
            root_metadata_digest: stored_root,
            expires_at_ms: stored_expiry,
            payload: stored_payload,
        }) => {
            if stored_binding != &pair_binding {
                Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
            } else if stored_root == &root_metadata_digest
                && stored_expiry == &expires_at_ms
                && stored_payload == &payload
            {
                Ed25519YaoPairTransitionV1::Duplicate
            } else {
                Ed25519YaoPairTransitionV1::Persist(Ed25519YaoPairRecordV1::Prepared {
                    pair_binding,
                    root_metadata_digest,
                    expires_at_ms,
                    payload,
                })
            }
        }
        Some(Ed25519YaoPairRecordV1::Starting { .. })
        | Some(Ed25519YaoPairRecordV1::Running { .. }) => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        }
        Some(_) => Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal),
    }
}

/// Reserves a prepared pair for one executor. Only the caller whose
/// reservation is applied may connect to the peer.
pub fn reserve_ed25519_yao_pair_v1<P: Clone, O>(
    current: &Ed25519YaoPairRecordV1<P, O>,
    executor: Ed25519YaoPairExecutorV1<'_>,
) -> Ed25519YaoPairTransitionV1<P, O> {
    match current {
        Ed25519YaoPairRecordV1::Prepared {
            pair_binding,
            root_metadata_digest,
            expires_at_ms,
            payload,
        } => {
            if pair_binding != executor.pair_binding {
                return Ed25519YaoPairTransitionV1::Reject(
                    Ed25519YaoPairRejectionV1::IdentityMismatch,
                );
            }
            if executor.now_ms >= *expires_at_ms {
                return Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Expired);
            }
            Ed25519YaoPairTransitionV1::Persist(Ed25519YaoPairRecordV1::Starting {
                pair_binding: pair_binding.clone(),
                root_metadata_digest: *root_metadata_digest,
                expires_at_ms: *expires_at_ms,
                execution_id: executor.execution_id,
                started_at_ms: executor.now_ms,
                payload: payload.clone(),
            })
        }
        Ed25519YaoPairRecordV1::Starting {
            pair_binding,
            execution_id,
            ..
        } if pair_binding == executor.pair_binding && *execution_id == executor.execution_id => {
            Ed25519YaoPairTransitionV1::Duplicate
        }
        Ed25519YaoPairRecordV1::Starting { .. }
        | Ed25519YaoPairRecordV1::Running { .. }
        | Ed25519YaoPairRecordV1::Completed { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        }
        Ed25519YaoPairRecordV1::Burned { .. } | Ed25519YaoPairRecordV1::Expired { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        }
    }
}

/// Returns a reservation to `Prepared` after the peer answered that it holds
/// no claim for this execution. No protocol message has been sent, so the
/// execution identity is unused and another executor may reserve the pair.
pub fn release_ed25519_yao_pair_v1<P: Clone, O>(
    current: &Ed25519YaoPairRecordV1<P, O>,
    executor: Ed25519YaoPairExecutorV1<'_>,
) -> Ed25519YaoPairTransitionV1<P, O> {
    match current {
        Ed25519YaoPairRecordV1::Starting {
            pair_binding,
            root_metadata_digest,
            expires_at_ms,
            execution_id,
            payload,
            ..
        } if pair_binding == executor.pair_binding && *execution_id == executor.execution_id => {
            Ed25519YaoPairTransitionV1::Persist(Ed25519YaoPairRecordV1::Prepared {
                pair_binding: pair_binding.clone(),
                root_metadata_digest: *root_metadata_digest,
                expires_at_ms: *expires_at_ms,
                payload: payload.clone(),
            })
        }
        Ed25519YaoPairRecordV1::Prepared { pair_binding, .. }
            if pair_binding == executor.pair_binding =>
        {
            Ed25519YaoPairTransitionV1::Duplicate
        }
        Ed25519YaoPairRecordV1::Prepared { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
        }
        Ed25519YaoPairRecordV1::Starting { .. }
        | Ed25519YaoPairRecordV1::Running { .. }
        | Ed25519YaoPairRecordV1::Completed { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        }
        Ed25519YaoPairRecordV1::Burned { .. } | Ed25519YaoPairRecordV1::Expired { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        }
    }
}

/// Claims a reserved pair after the peer claimed the same execution.
pub fn claim_ed25519_yao_pair_v1<P: Clone, O>(
    current: &Ed25519YaoPairRecordV1<P, O>,
    executor: Ed25519YaoPairExecutorV1<'_>,
) -> Ed25519YaoPairTransitionV1<P, O> {
    match current {
        Ed25519YaoPairRecordV1::Starting {
            pair_binding,
            root_metadata_digest,
            expires_at_ms,
            execution_id,
            payload,
            ..
        } => {
            if *execution_id != executor.execution_id {
                return Ed25519YaoPairTransitionV1::Reject(
                    Ed25519YaoPairRejectionV1::ConflictingExecution,
                );
            }
            if pair_binding != executor.pair_binding {
                return Ed25519YaoPairTransitionV1::Reject(
                    Ed25519YaoPairRejectionV1::IdentityMismatch,
                );
            }
            if executor.now_ms >= *expires_at_ms {
                return Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Expired);
            }
            Ed25519YaoPairTransitionV1::Persist(Ed25519YaoPairRecordV1::Running {
                pair_binding: pair_binding.clone(),
                root_metadata_digest: *root_metadata_digest,
                execution_id: executor.execution_id,
                started_at_ms: executor.now_ms,
                payload: payload.clone(),
            })
        }
        Ed25519YaoPairRecordV1::Running {
            pair_binding,
            execution_id,
            ..
        }
        | Ed25519YaoPairRecordV1::Completed {
            pair_binding,
            execution_id,
            ..
        } if pair_binding == executor.pair_binding && *execution_id == executor.execution_id => {
            Ed25519YaoPairTransitionV1::Duplicate
        }
        Ed25519YaoPairRecordV1::Running { .. } | Ed25519YaoPairRecordV1::Completed { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        }
        Ed25519YaoPairRecordV1::Prepared { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        }
        Ed25519YaoPairRecordV1::Burned { .. } | Ed25519YaoPairRecordV1::Expired { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        }
    }
}

pub fn complete_ed25519_yao_pair_v1<P: Clone, O: PartialEq>(
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
            payload,
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
                payload: payload.clone(),
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
        Ed25519YaoPairRecordV1::Starting {
            pair_binding,
            execution_id: stored_execution,
            ..
        }
        | Ed25519YaoPairRecordV1::Running {
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
        Ed25519YaoPairRecordV1::Starting { .. } | Ed25519YaoPairRecordV1::Running { .. } => {
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        }
        _ => Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::derivation::{PublicDigest32, RootShareEpoch};
    use crate::protocol::{
        Ed25519YaoCeremonyBindingV1, Ed25519YaoCeremonyIdentityV1, Ed25519YaoOperationV1,
        Ed25519YaoSessionIdV1, Ed25519YaoStableKeyContextBindingV1, ExpensiveWorkKindV1,
        LifecycleScopeV1, MpcMaterialActivationRefV1,
    };

    type Record = Ed25519YaoPairRecordV1<u8, String>;

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

    fn prepared(pair: &Ed25519YaoInputPairBindingV1) -> Record {
        Ed25519YaoPairRecordV1::Prepared {
            pair_binding: pair.clone(),
            root_metadata_digest: [7; 32],
            expires_at_ms: 150,
            payload: 42,
        }
    }

    fn persisted(transition: Ed25519YaoPairTransitionV1<u8, String>) -> Record {
        match transition {
            Ed25519YaoPairTransitionV1::Persist(record) => record,
            other => panic!("expected a persisted record: {other:?}"),
        }
    }

    #[test]
    fn pair_claim_completion_and_replay_keep_one_execution() {
        let pair = pair_binding();
        let first_id = Ed25519YaoExecutionIdV1::new([10; 32]).expect("first id");
        let second_id = Ed25519YaoExecutionIdV1::new([11; 32]).expect("second id");
        let prepared = prepared(&pair);
        assert_eq!(
            prepare_ed25519_yao_pair_v1(None, prepared.clone(), 110),
            Ed25519YaoPairTransitionV1::Persist(prepared.clone())
        );
        assert_eq!(
            prepare_ed25519_yao_pair_v1(Some(&prepared), prepared.clone(), 110),
            Ed25519YaoPairTransitionV1::Duplicate
        );
        let first = Ed25519YaoPairExecutorV1 {
            pair_binding: &pair,
            execution_id: first_id,
            now_ms: 119,
        };
        let second = Ed25519YaoPairExecutorV1 {
            execution_id: second_id,
            ..first
        };
        let starting = persisted(reserve_ed25519_yao_pair_v1(&prepared, first));
        assert_eq!(
            reserve_ed25519_yao_pair_v1(&starting, first),
            Ed25519YaoPairTransitionV1::Duplicate
        );
        assert_eq!(
            reserve_ed25519_yao_pair_v1(&starting, second),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        );
        assert_eq!(
            claim_ed25519_yao_pair_v1(&prepared, first),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        );
        let running = persisted(claim_ed25519_yao_pair_v1(&starting, first));
        assert_eq!(
            claim_ed25519_yao_pair_v1(&running, first),
            Ed25519YaoPairTransitionV1::Duplicate
        );
        assert_eq!(
            claim_ed25519_yao_pair_v1(&running, second),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        );
        let completed = persisted(complete_ed25519_yao_pair_v1(
            &running,
            first_id,
            "sealed outcome".to_owned(),
            125,
            60_000,
        ));
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
            claim_ed25519_yao_pair_v1(&completed, first),
            Ed25519YaoPairTransitionV1::Duplicate
        );
        assert_eq!(
            burn_ed25519_yao_pair_v1(&completed, first_id),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        );
    }

    #[test]
    fn released_reservation_returns_to_prepared_for_another_executor() {
        let pair = pair_binding();
        let execution_id = Ed25519YaoExecutionIdV1::new([10; 32]).expect("id");
        let other_id = Ed25519YaoExecutionIdV1::new([11; 32]).expect("other id");
        let prepared = prepared(&pair);
        let executor = Ed25519YaoPairExecutorV1 {
            pair_binding: &pair,
            execution_id,
            now_ms: 119,
        };
        let starting = persisted(reserve_ed25519_yao_pair_v1(&prepared, executor));
        assert_eq!(
            release_ed25519_yao_pair_v1(
                &starting,
                Ed25519YaoPairExecutorV1 {
                    execution_id: other_id,
                    ..executor
                }
            ),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        );
        let released = persisted(release_ed25519_yao_pair_v1(&starting, executor));
        assert_eq!(released, prepared);
        assert_eq!(
            release_ed25519_yao_pair_v1(&released, executor),
            Ed25519YaoPairTransitionV1::Duplicate
        );
        let again = persisted(reserve_ed25519_yao_pair_v1(&released, executor));
        let running = persisted(claim_ed25519_yao_pair_v1(&again, executor));
        // A claimed execution may have sent protocol material: it is never released.
        assert_eq!(
            release_ed25519_yao_pair_v1(&running, executor),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        );
        let burned = persisted(burn_ed25519_yao_pair_v1(&running, execution_id));
        assert_eq!(
            release_ed25519_yao_pair_v1(&burned, executor),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        );
    }

    #[test]
    fn expired_and_burned_pairs_never_return_to_prepared() {
        let pair = pair_binding();
        let execution_id = Ed25519YaoExecutionIdV1::new([10; 32]).expect("id");
        let prepared = prepared(&pair);
        let expired = persisted(expire_ed25519_yao_pair_v1(&prepared, 150));
        assert_eq!(
            prepare_ed25519_yao_pair_v1(Some(&expired), prepared.clone(), 120),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        );
        let executor = Ed25519YaoPairExecutorV1 {
            pair_binding: &pair,
            execution_id,
            now_ms: 119,
        };
        let starting = persisted(reserve_ed25519_yao_pair_v1(&prepared, executor));
        let running = persisted(claim_ed25519_yao_pair_v1(&starting, executor));
        let burned = persisted(burn_ed25519_yao_pair_v1(&running, execution_id));
        assert_eq!(
            claim_ed25519_yao_pair_v1(&burned, executor),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        );
        assert_eq!(
            prepare_ed25519_yao_pair_v1(Some(&burned), prepared, 120),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Terminal)
        );
    }

    #[test]
    fn expired_preparation_cannot_be_stored_reserved_or_claimed() {
        let pair = pair_binding();
        let execution_id = Ed25519YaoExecutionIdV1::new([10; 32]).expect("id");
        let prepared = prepared(&pair);
        assert_eq!(
            prepare_ed25519_yao_pair_v1(None, prepared.clone(), 150),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Expired)
        );
        let late = Ed25519YaoPairExecutorV1 {
            pair_binding: &pair,
            execution_id,
            now_ms: 150,
        };
        assert_eq!(
            reserve_ed25519_yao_pair_v1(&prepared, late),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Expired)
        );
        let starting = persisted(reserve_ed25519_yao_pair_v1(
            &prepared,
            Ed25519YaoPairExecutorV1 {
                now_ms: 119,
                ..late
            },
        ));
        assert_eq!(
            claim_ed25519_yao_pair_v1(&starting, late),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::Expired)
        );
    }

    #[test]
    fn later_preparation_replaces_one_nothing_reserved() {
        let pair = pair_binding();
        let execution_id = Ed25519YaoExecutionIdV1::new([10; 32]).expect("id");
        let first = prepared(&pair);
        let later = Record::Prepared {
            pair_binding: pair.clone(),
            root_metadata_digest: [7; 32],
            expires_at_ms: 180,
            payload: 43,
        };
        assert_eq!(
            prepare_ed25519_yao_pair_v1(Some(&first), later.clone(), 130),
            Ed25519YaoPairTransitionV1::Persist(later.clone())
        );
        let starting = persisted(reserve_ed25519_yao_pair_v1(
            &first,
            Ed25519YaoPairExecutorV1 {
                pair_binding: &pair,
                execution_id,
                now_ms: 119,
            },
        ));
        assert_eq!(
            prepare_ed25519_yao_pair_v1(Some(&starting), later.clone(), 130),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::ConflictingExecution)
        );
        let mut other_pair = pair.clone();
        other_pair = Ed25519YaoInputPairBindingV1::new(
            other_pair.ceremony().clone(),
            PublicDigest32::new([13; 32]),
            PublicDigest32::new([4; 32]),
            PublicDigest32::new([5; 32]),
            PublicDigest32::new([6; 32]),
        )
        .expect("other pair");
        let other = Record::Prepared {
            pair_binding: other_pair,
            root_metadata_digest: [7; 32],
            expires_at_ms: 180,
            payload: 43,
        };
        assert_eq!(
            prepare_ed25519_yao_pair_v1(Some(&first), other, 130),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
        );
    }

    #[test]
    fn preparation_requires_a_root_metadata_digest() {
        let pair = pair_binding();
        let proposed = Record::Prepared {
            pair_binding: pair,
            root_metadata_digest: [0; 32],
            expires_at_ms: 150,
            payload: 42,
        };
        assert_eq!(
            prepare_ed25519_yao_pair_v1(None, proposed, 110),
            Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
        );
    }
}
