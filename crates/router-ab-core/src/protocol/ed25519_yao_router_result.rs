//! Router results of one Ed25519 Yao execution: success, failure and burn.

use serde::{de::Error as _, Deserialize, Deserializer, Serialize};

use crate::protocol::ed25519_yao::Ed25519YaoOperationV1;
use crate::protocol::ed25519_yao_router::Ed25519YaoExecutionIdV1;
use crate::protocol::error::{
    RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult,
};

fn invalid_router_yao(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MalformedWirePayload, message)
}

/// Operation-specific successful Router result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum RouterEd25519YaoExecuteSuccessV1 {
    /// Registration activation result.
    Registration {
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoActivationResultV1,
    },
    /// Recovery staged activation result.
    Recovery {
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoActivationResultV1,
    },
    /// Client-recipient export result.
    Export {
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoExportResultV1,
    },
    /// New lane output commitment.
    LaneProvisioning {
        result: crate::protocol::ed25519_yao_lane::RouterAbEd25519YaoLaneResultV1,
    },
    /// Replacement lane-epoch output commitment.
    LaneRefresh {
        result: crate::protocol::ed25519_yao_lane::RouterAbEd25519YaoLaneResultV1,
    },
    /// Reissued Client packages with the active epoch's public receipt.
    Reissue {
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoActivationResultV1,
    },
}

impl RouterEd25519YaoExecuteSuccessV1 {
    /// Wraps a registration result after checking its operation binding.
    pub fn registration(
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoActivationResultV1,
    ) -> RouterAbProtocolResult<Self> {
        if result.binding().operation != Ed25519YaoOperationV1::Registration {
            return Err(invalid_router_yao(
                "Ed25519 Yao registration result has the wrong operation",
            ));
        }
        Ok(Self::Registration { result })
    }

    /// Wraps a recovery result after checking its operation binding.
    pub fn recovery(
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoActivationResultV1,
    ) -> RouterAbProtocolResult<Self> {
        if result.binding().operation != Ed25519YaoOperationV1::Recovery {
            return Err(invalid_router_yao(
                "Ed25519 Yao recovery result has the wrong operation",
            ));
        }
        Ok(Self::Recovery { result })
    }

    /// Wraps a reissue result after checking its operation binding.
    pub fn reissue(
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoActivationResultV1,
    ) -> RouterAbProtocolResult<Self> {
        if result.binding().operation != Ed25519YaoOperationV1::Reissue {
            return Err(invalid_router_yao(
                "Ed25519 Yao reissue result has the wrong operation",
            ));
        }
        Ok(Self::Reissue { result })
    }

    /// Wraps an export result after checking its operation binding.
    pub fn export(
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoExportResultV1,
    ) -> RouterAbProtocolResult<Self> {
        if result.binding().ceremony().operation != Ed25519YaoOperationV1::Export {
            return Err(invalid_router_yao(
                "Ed25519 Yao export result has the wrong operation",
            ));
        }
        Ok(Self::Export { result })
    }

    /// Wraps a lane-provisioning result after checking its job branch.
    pub fn lane_provisioning(
        result: crate::protocol::ed25519_yao_lane::RouterAbEd25519YaoLaneResultV1,
    ) -> RouterAbProtocolResult<Self> {
        result.validate()?;
        if result.job.yao_request_kind
            != crate::protocol::ed25519_yao_lane::Ed25519YaoLaneRequestKindV1::LaneProvisioning
        {
            return Err(invalid_router_yao(
                "Ed25519 Yao lane-provisioning result has the wrong operation",
            ));
        }
        Ok(Self::LaneProvisioning { result })
    }

    /// Wraps a lane-refresh result after checking its job branch.
    pub fn lane_refresh(
        result: crate::protocol::ed25519_yao_lane::RouterAbEd25519YaoLaneResultV1,
    ) -> RouterAbProtocolResult<Self> {
        result.validate()?;
        if result.job.yao_request_kind
            != crate::protocol::ed25519_yao_lane::Ed25519YaoLaneRequestKindV1::LaneRefresh
        {
            return Err(invalid_router_yao(
                "Ed25519 Yao lane-refresh result has the wrong operation",
            ));
        }
        Ok(Self::LaneRefresh { result })
    }

    /// Returns the operation branch.
    pub const fn operation(&self) -> Ed25519YaoOperationV1 {
        match self {
            Self::Registration { .. } => Ed25519YaoOperationV1::Registration,
            Self::Recovery { .. } => Ed25519YaoOperationV1::Recovery,
            Self::Export { .. } => Ed25519YaoOperationV1::Export,
            Self::LaneProvisioning { .. } => Ed25519YaoOperationV1::LaneProvisioning,
            Self::LaneRefresh { .. } => Ed25519YaoOperationV1::LaneRefresh,
            Self::Reissue { .. } => Ed25519YaoOperationV1::Reissue,
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum RawRouterEd25519YaoExecuteSuccessV1 {
    Registration {
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoActivationResultV1,
    },
    Recovery {
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoActivationResultV1,
    },
    Export {
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoExportResultV1,
    },
    LaneProvisioning {
        result: crate::protocol::ed25519_yao_lane::RouterAbEd25519YaoLaneResultV1,
    },
    LaneRefresh {
        result: crate::protocol::ed25519_yao_lane::RouterAbEd25519YaoLaneResultV1,
    },
    Reissue {
        result: crate::protocol::ed25519_yao::RouterAbEd25519YaoActivationResultV1,
    },
}

impl<'de> Deserialize<'de> for RouterEd25519YaoExecuteSuccessV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawRouterEd25519YaoExecuteSuccessV1::deserialize(deserializer)?;
        match raw {
            RawRouterEd25519YaoExecuteSuccessV1::Registration { result } => {
                Self::registration(result)
            }
            RawRouterEd25519YaoExecuteSuccessV1::Recovery { result } => Self::recovery(result),
            RawRouterEd25519YaoExecuteSuccessV1::Reissue { result } => Self::reissue(result),
            RawRouterEd25519YaoExecuteSuccessV1::Export { result } => Self::export(result),
            RawRouterEd25519YaoExecuteSuccessV1::LaneProvisioning { result } => {
                Self::lane_provisioning(result)
            }
            RawRouterEd25519YaoExecuteSuccessV1::LaneRefresh { result } => {
                Self::lane_refresh(result)
            }
        }
        .map_err(D::Error::custom)
    }
}

/// Recoverable or terminal failure class for one Router execution attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouterEd25519YaoExecuteFailureCodeV1 {
    /// Internal service transport was unavailable before activation.
    ServiceUnavailable,
    /// The exact pair is already owned by another live execution.
    ConflictingPair,
    /// A prepared record or receipt was missing or mismatched.
    MissingPreparation,
    /// The nonterminal ceremony lifetime elapsed.
    CeremonyExpired,
    /// SigningWorker delivery remains uncertain and may be retried exactly.
    SigningWorkerUncertain,
    /// The role recorded a sanitized terminal failure.
    TerminalRoleFailure,
    /// The admitted authority was rejected at the Router boundary.
    AuthorizationRejected,
    /// Another run holds this registration's execution until its lease
    /// lapses; an exact retry after it replays the run.
    ExecutionInProgress,
    /// Another request already owns this registration's execution.
    ExecutionMismatch,
    /// A later attempt of the same recovery took this attempt's place at the
    /// SigningWorker, so this attempt can never activate.
    AttemptSuperseded,
}

/// Reason an activated execution identity is permanently burned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouterEd25519YaoBurnReasonV1 {
    /// Caller disconnected after activation began.
    CallerDisconnected,
    /// Peer acceptance or transcript state became ambiguous.
    PeerUncertain,
    /// Protocol execution failed after one-use activation.
    ProtocolFailure,
}

/// Result-style Router execution response with explicit retry semantics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum RouterEd25519YaoExecuteResultV1 {
    /// Operation-specific successful result.
    Succeeded {
        result: Box<RouterEd25519YaoExecuteSuccessV1>,
    },
    /// Failure safe for an exact request retry.
    RecoverableFailure {
        code: RouterEd25519YaoExecuteFailureCodeV1,
        retry_after_ms: u64,
    },
    /// Request rejected before one-use activation.
    Rejected {
        code: RouterEd25519YaoExecuteFailureCodeV1,
    },
    /// Execution identity burned after activation uncertainty.
    Burned {
        execution_id: Ed25519YaoExecutionIdV1,
        reason: RouterEd25519YaoBurnReasonV1,
    },
}

impl RouterEd25519YaoExecuteResultV1 {
    /// Creates a successful operation-specific result.
    pub fn succeeded(result: RouterEd25519YaoExecuteSuccessV1) -> Self {
        Self::Succeeded {
            result: Box::new(result),
        }
    }

    /// Creates a retryable failure with a positive retry hint.
    pub fn recoverable(
        code: RouterEd25519YaoExecuteFailureCodeV1,
        retry_after_ms: u64,
    ) -> RouterAbProtocolResult<Self> {
        if retry_after_ms == 0 {
            return Err(invalid_router_yao(
                "Ed25519 Yao recoverable failure retry hint must be positive",
            ));
        }
        Ok(Self::RecoverableFailure {
            code,
            retry_after_ms,
        })
    }

    /// Creates a pre-activation rejection.
    pub const fn rejected(code: RouterEd25519YaoExecuteFailureCodeV1) -> Self {
        Self::Rejected { code }
    }

    /// Creates an irreversible burned execution result.
    pub fn burned(
        execution_id: Ed25519YaoExecutionIdV1,
        reason: RouterEd25519YaoBurnReasonV1,
    ) -> Self {
        Self::Burned {
            execution_id,
            reason,
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
enum RawRouterEd25519YaoExecuteResultV1 {
    Succeeded {
        result: Box<RouterEd25519YaoExecuteSuccessV1>,
    },
    RecoverableFailure {
        code: RouterEd25519YaoExecuteFailureCodeV1,
        retry_after_ms: u64,
    },
    Rejected {
        code: RouterEd25519YaoExecuteFailureCodeV1,
    },
    Burned {
        execution_id: Ed25519YaoExecutionIdV1,
        reason: RouterEd25519YaoBurnReasonV1,
    },
}

impl<'de> Deserialize<'de> for RouterEd25519YaoExecuteResultV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawRouterEd25519YaoExecuteResultV1::deserialize(deserializer)?;
        match raw {
            RawRouterEd25519YaoExecuteResultV1::Succeeded { result } => {
                Ok(Self::succeeded(*result))
            }
            RawRouterEd25519YaoExecuteResultV1::RecoverableFailure {
                code,
                retry_after_ms,
            } => Self::recoverable(code, retry_after_ms).map_err(D::Error::custom),
            RawRouterEd25519YaoExecuteResultV1::Rejected { code } => Ok(Self::rejected(code)),
            RawRouterEd25519YaoExecuteResultV1::Burned {
                execution_id,
                reason,
            } => Ok(Self::burned(execution_id, reason)),
        }
    }
}
