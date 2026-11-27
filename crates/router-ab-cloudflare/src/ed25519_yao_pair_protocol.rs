//! Feature-independent wire types shared by the Cloudflare and native local adapters.

use router_ab_core::{
    Ed25519YaoEncryptedInputV1, Ed25519YaoExecutionIdV1, Ed25519YaoInputPairBindingV1,
    Ed25519YaoLaneJobV1, Ed25519YaoOuterBindingV2,
    RouterAbEd25519YaoApplicationBindingFactsV1, RouterAbProtocolError, RouterAbProtocolErrorCode,
    RouterAbProtocolResult, RouterEd25519YaoBurnReasonV1, RouterEd25519YaoExecuteFailureCodeV1,
    RouterEd25519YaoGatewayExecuteTargetV2, TenantRootIdentityV1,
};
use router_ab_ed25519_yao::{stable_key_derivation_context_v1, Ed25519YaoRoleExecutionV1};
use serde::{Deserialize, Serialize};

use crate::{
    encode_base64url_bytes_v1, CloudflareTenantRootCoordinatesV1,
    CloudflareTenantRootCustodyBindingWireV1,
};

/// Authenticated Gateway scope for Yao routing. The root version authorizes
/// the operation; wallet placement uses only the stable tenant fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareRouterEd25519YaoTenantRootV1 {
    pub identity: TenantRootIdentityV1,
    pub custody_lineage_b64u: String,
}

impl CloudflareRouterEd25519YaoTenantRootV1 {
    pub fn coordinates(&self) -> RouterAbProtocolResult<CloudflareTenantRootCoordinatesV1> {
        let identity_digest = self.identity.digest().map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("Yao tenant-root identity is invalid: {error}"),
            )
        })?;
        let coordinates = CloudflareTenantRootCoordinatesV1 {
            identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
            custody_lineage_b64u: self.custody_lineage_b64u.clone(),
        };
        coordinates.resolve()?;
        Ok(coordinates)
    }

    pub fn resolve(
        &self,
    ) -> RouterAbProtocolResult<(
        router_ab_core::TenantRootIdentityDigestV1,
        router_ab_core::TenantRootCustodyLineageId,
    )> {
        self.coordinates()?.resolve()
    }
}

/// Server-admitted execution envelope. Tenant-root selectors and stable-context
/// facts are supplied by the authenticated wallet server, never by the browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareRouterEd25519YaoExecuteRequestV2 {
    pub tenant_root: CloudflareRouterEd25519YaoTenantRootV1,
    pub application: RouterAbEd25519YaoApplicationBindingFactsV1,
    pub participant_ids: [u16; 2],
    pub target: RouterEd25519YaoGatewayExecuteTargetV2,
}

impl CloudflareRouterEd25519YaoExecuteRequestV2 {
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.tenant_root.resolve()?;
        validate_participant_ids(self.participant_ids)?;
        if self.tenant_root.identity.signing_root_id() != self.application.signing_root_id() {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "server-resolved Yao signing root does not match the application",
            ));
        }
        if self.application.wallet_id() != self.target.ceremony_binding().lifecycle.account_id {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "server-resolved Ed25519 application wallet does not match the ceremony",
            ));
        }
        let stable_context =
            stable_key_derivation_context_v1(&self.application, self.participant_ids).map_err(
                |_| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidLifecycleState,
                        "server-resolved Ed25519 stable context is invalid",
                    )
                },
            )?;
        if stable_context.binding_digest()
            != self
                .target
                .ceremony_binding()
                .stable_key_context_binding
                .into_bytes()
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "server-resolved Ed25519 facts do not match the ceremony stable context",
            ));
        }
        Ok(())
    }
}

fn validate_participant_ids(participant_ids: [u16; 2]) -> RouterAbProtocolResult<()> {
    if participant_ids[0] == 0
        || participant_ids[1] == 0
        || participant_ids[0] >= participant_ids[1]
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "Ed25519 Yao participant ids must be distinct, nonzero, ascending values",
        ));
    }
    Ok(())
}

/// Exact public tenant-root context admitted by Router for both roles.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoTenantRootContextV2 {
    pub wallet_route: crate::WalletObjectRoute,
    pub ownership_generation: u64,
    pub identity: TenantRootIdentityV1,
    pub custody_binding: CloudflareTenantRootCustodyBindingWireV1,
    pub outer_binding: Ed25519YaoOuterBindingV2,
    pub application: RouterAbEd25519YaoApplicationBindingFactsV1,
    pub participant_ids: [u16; 2],
}

impl CloudflareEd25519YaoTenantRootContextV2 {
    pub(crate) fn validate_for_pair(
        &self,
        pair_binding: &Ed25519YaoInputPairBindingV1,
    ) -> RouterAbProtocolResult<()> {
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)?;
        self.custody_binding.validate()?;
        self.outer_binding.validate()?;
        pair_binding.validate()?;
        if self.participant_ids[0] == 0
            || self.participant_ids[0] >= self.participant_ids[1]
            || self.identity.signing_root_id() != self.application.signing_root_id()
            || self.outer_binding.pair_session().as_bytes() != &pair_binding.session()
            || self.outer_binding.stable_context_binding()
                != pair_binding.binding().stable_key_context_binding
            || self.application.wallet_id() != pair_binding.binding().lifecycle.account_id
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Ed25519 Yao tenant-root context does not match the admitted pair",
            ));
        }
        let stable_context =
            stable_key_derivation_context_v1(&self.application, self.participant_ids).map_err(
                |error| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        format!("Ed25519 Yao tenant-root stable context is invalid: {error}"),
                    )
                },
            )?;
        if stable_context.binding_digest()
            != pair_binding
                .binding()
                .stable_key_context_binding
                .into_bytes()
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Ed25519 Yao tenant-root stable context does not match the pair",
            ));
        }
        Ok(())
    }
}

/// Family-specific public context retained by each role for exact input opening.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "family", rename_all = "snake_case", deny_unknown_fields)]
pub enum CloudflareEd25519YaoPairWorkV1 {
    /// Registration, recovery, or export uses the ceremony binding directly.
    Ceremony,
    /// Lane inputs additionally authenticate the complete admitted job in HPKE AAD.
    Lane { job: Ed25519YaoLaneJobV1 },
}

/// Exact pair and role envelope sent to one private prepare-pair route.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareEd25519YaoPairPrepareRequestV1 {
    pub pair_binding: Ed25519YaoInputPairBindingV1,
    pub tenant_root: CloudflareEd25519YaoTenantRootContextV2,
    pub work: CloudflareEd25519YaoPairWorkV1,
    pub input: Ed25519YaoEncryptedInputV1,
}

/// Exact pair and encrypted A input sent to the A execute-pair route. Deriver
/// A prepares, reserves and executes the pair in this one request.
///
/// The Router sends Deriver B its preparation at the same time, so A may
/// reach B first. `deadline_ms` is when the Router's run ends: B waits for
/// its own preparation until then. The tenant-root context is stamped once
/// per run, so its outer binding names the run to both roles.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoPairExecuteRequestV1 {
    pub pair_binding: Ed25519YaoInputPairBindingV1,
    pub tenant_root: CloudflareEd25519YaoTenantRootContextV2,
    pub work: CloudflareEd25519YaoPairWorkV1,
    pub input: Ed25519YaoEncryptedInputV1,
    pub(crate) deadline_ms: u64,
}

/// Deriver B has queued the encrypted input, or execution already claimed it.
/// Queued input can disappear when the wallet object restarts. An exact retry
/// supplies it again. Running and completed execution claims are durable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareEd25519YaoPairPreparationV1 {
    Prepared,
    Running,
    Completed,
}

/// Why Deriver B refused a pair connection while holding no claim for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloudflareEd25519YaoPairStartRefusalReasonV1 {
    /// B's own preparation did not arrive, or failed, before the run ended.
    NotPrepared,
    /// B's preparation outlived its lifetime before A connected.
    Expired,
}

/// Deriver B's answer to a pair connection it refuses before claiming. It
/// names the exact execution and says B holds no claim for it, so Deriver A
/// may release its reservation: no protocol message was exchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareEd25519YaoPairStartRefusalV1 {
    pub session: [u8; 32],
    pub pair_digest: [u8; 32],
    pub execution_id: Ed25519YaoExecutionIdV1,
    pub reason: CloudflareEd25519YaoPairStartRefusalReasonV1,
}

impl CloudflareEd25519YaoPairStartRefusalV1 {
    /// Whether this refusal answers the exact execution Deriver A reserved.
    pub fn answers(
        &self,
        pair_binding: &Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
    ) -> bool {
        self.session == pair_binding.session()
            && self.pair_digest == pair_binding.pair_digest().bytes
            && self.execution_id == execution_id
    }
}

/// A's sealed execution plus B's opaque, already-persisted sealed execution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareEd25519YaoPairExecuteResponseV1 {
    pub(crate) deriver_a_execution: Ed25519YaoRoleExecutionV1,
    pub(crate) deriver_b_sealed_execution_json: String,
}

/// Exact pair lookup sent to a role status or burn route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareEd25519YaoPairLookupRequestV1 {
    pub session: [u8; 32],
    pub pair_digest: [u8; 32],
}

/// Stable wallet placement plus the original root and pair authorization for B.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareDeriverBWalletPairScopeV1 {
    pub wallet_route: crate::WalletObjectRoute,
    pub ownership_generation: u64,
    pub root_identity: TenantRootIdentityV1,
    pub pair_binding: Ed25519YaoInputPairBindingV1,
}

impl CloudflareDeriverBWalletPairScopeV1 {
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)?;
        self.root_identity.digest().map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                format!("Deriver B wallet root identity is invalid: {error}"),
            )
        })?;
        self.pair_binding.validate()?;
        Ok(())
    }
}

/// Router-authenticated lookup for one Deriver A wallet-owned pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareDeriverAWalletPairStatusRequestV1 {
    pub wallet_route: crate::WalletObjectRoute,
    pub ownership_generation: u64,
    pub root_identity: TenantRootIdentityV1,
    pub pair_binding: Ed25519YaoInputPairBindingV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareDeriverAWalletPairBurnRequestV1 {
    pub wallet_route: crate::WalletObjectRoute,
    pub ownership_generation: u64,
    pub root_identity: TenantRootIdentityV1,
    pub pair_binding: Ed25519YaoInputPairBindingV1,
    pub execution_id: Ed25519YaoExecutionIdV1,
}

/// Sanitized role-local state returned only to the MPC Router for exact replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareEd25519YaoPairStatusResponseV1 {
    Missing {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    Prepared {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    Running {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    Completed {
        execution: Box<Ed25519YaoRoleExecutionV1>,
    },
    Burned {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    Expired {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
}

/// A's scoped, durable execution outcome for Router replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareDeriverAWalletPairOutcomeResponseV1 {
    Missing {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    Prepared {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    Running {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    Completed {
        outcome: Box<CloudflareEd25519YaoPairExecuteResponseV1>,
        tenant_root: Box<CloudflareEd25519YaoTenantRootContextV2>,
    },
    Burned {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    Expired {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
}

/// Sanitized role failure returned by a private pair route.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareEd25519YaoRoleFailureResponseV1 {
    RecoverableFailure {
        code: RouterEd25519YaoExecuteFailureCodeV1,
        retry_after_ms: u64,
    },
    Rejected {
        code: RouterEd25519YaoExecuteFailureCodeV1,
    },
    Burned {
        reason: RouterEd25519YaoBurnReasonV1,
    },
}

impl CloudflareEd25519YaoRoleFailureResponseV1 {
    /// Converts a role-local protocol error into a sanitized result class.
    pub(crate) fn from_protocol_error(
        error: &RouterAbProtocolError,
    ) -> CloudflareEd25519YaoRoleFailureResponseV1 {
        if matches!(
            error.code(),
            RouterAbProtocolErrorCode::ExpiredLocalRequest
                | RouterAbProtocolErrorCode::PairPreparationExpired
        ) {
            return Self::RecoverableFailure {
                code: RouterEd25519YaoExecuteFailureCodeV1::CeremonyExpired,
                retry_after_ms: 1_000,
            };
        }
        if error.code() == RouterAbProtocolErrorCode::ConflictingPair {
            return Self::Rejected {
                code: RouterEd25519YaoExecuteFailureCodeV1::ConflictingPair,
            };
        }
        if error.code() == RouterAbProtocolErrorCode::MissingPairPreparation {
            return Self::Rejected {
                code: RouterEd25519YaoExecuteFailureCodeV1::MissingPreparation,
            };
        }
        if error.code() == RouterAbProtocolErrorCode::SupersededAttempt {
            return Self::Rejected {
                code: RouterEd25519YaoExecuteFailureCodeV1::AttemptSuperseded,
            };
        }
        if matches!(
            error.code(),
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig
                | RouterAbProtocolErrorCode::MissingLocalBinding
                | RouterAbProtocolErrorCode::ForbiddenLocalBinding
                | RouterAbProtocolErrorCode::LifecycleTransitionInProgress
        ) {
            return Self::RecoverableFailure {
                code: RouterEd25519YaoExecuteFailureCodeV1::ServiceUnavailable,
                retry_after_ms: 1_000,
            };
        }
        Self::Rejected {
            code: RouterEd25519YaoExecuteFailureCodeV1::TerminalRoleFailure,
        }
    }
}
