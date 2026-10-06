//! The Router's wallet object: the Router's own record of each Yao
//! registration it executes for one wallet, independent of its host.
//!
//! The Gateway admits a registration and checks its caller's credential, then
//! asks the Router to execute it. The Router claims the execution here before
//! it runs the ceremony, and records the terminal answer here before it
//! replies, so the answer outlives a lost reply:
//! - an exact retry is answered with the recorded answer, byte for byte;
//! - while a claim's lease is live, a retry is told the run is in progress;
//! - once the lease lapses, an exact retry takes the claim over and replays
//!   the run. Each claim has a generation, and only the run holding the
//!   current one records an answer: a run that resumes after losing its claim
//!   is told the execution is in progress, and its answer is not recorded;
//! - another request for the same lifecycle, including one naming another
//!   tenant root, is refused.
//!
//! Finalization then consumes the activation here: the first consumer binding
//! wins, and the same binding replays. A recoverable answer is not terminal:
//! the claim stays until its lease lapses.
//!
//! Workers keep these records in a Router wallet Durable Object; the VM keeps
//! them in the Router's SQLite. Each host runs one command inside one storage
//! transaction through [`router_wallet_serve_v1`].

use router_ab_core::{
    Ed25519YaoSessionIdV1, RouterAbProtocolError, RouterAbProtocolErrorCode,
    RouterAbProtocolResult, RouterEd25519YaoExecuteResultV1,
    RouterEd25519YaoGatewayExecuteTargetV2,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::CloudflareRouterEd25519YaoExecuteRequestV2;

/// How long a claim holds a registration's execution before a retry may take
/// it over and replay the run, unless `ROUTER_YAO_REGISTRATION_LEASE_MS` sets
/// it.
pub const ROUTER_WALLET_REGISTRATION_LEASE_MS_V1: u64 = 10_000;
const ROUTER_YAO_REGISTRATION_LEASE_MS_ENV_V1: &str = "ROUTER_YAO_REGISTRATION_LEASE_MS";

/// The Router's registration lease: `ROUTER_YAO_REGISTRATION_LEASE_MS`, ten
/// seconds by default and at least one second. A run normally finishes well
/// within it; it bounds how long a run cut short keeps a retry waiting.
pub fn parse_router_yao_registration_lease_ms_v1(
    reader: &impl crate::CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<u64> {
    match reader.get_text(ROUTER_YAO_REGISTRATION_LEASE_MS_ENV_V1)? {
        Some(value) => value
            .parse::<u64>()
            .ok()
            .filter(|value| *value >= 1_000)
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    format!("{ROUTER_YAO_REGISTRATION_LEASE_MS_ENV_V1} must be at least 1000 milliseconds"),
                )
            }),
        None => Ok(ROUTER_WALLET_REGISTRATION_LEASE_MS_V1),
    }
}

/// Private Router endpoint: consume one completed registration's activation
/// for one finalization.
pub const CLOUDFLARE_ROUTER_ED25519_YAO_REGISTRATION_CONSUME_PRIVATE_REQUEST_PATH: &str =
    "/router-ab/router/ed25519-yao/registration/consume";

pub(crate) const OWNER_KEY: &str = "owner";
pub(crate) const REGISTRATION_KEY_PREFIX: &str = "yao-registration/";

/// The wallet one Router wallet object belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouterWalletOwnerV1 {
    pub org_id: String,
    pub project_id: String,
    pub env_id: String,
    pub wallet_id: String,
}

pub(crate) fn validate_wallet_ownership_generation(generation: u64) -> RouterAbProtocolResult<()> {
    if generation == 0 || generation > 9_007_199_254_740_991 {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "Router wallet ownership generation is invalid",
        ));
    }
    Ok(())
}

impl RouterWalletOwnerV1 {
    /// Each ownership generation has a separate physical object, including return moves.
    pub fn object_name(&self, ownership_generation: u64) -> RouterAbProtocolResult<String> {
        validate_wallet_ownership_generation(ownership_generation)?;
        let encoded = serde_json::to_vec(&(self, ownership_generation)).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("Router wallet owner is not encodable: {error}"),
            )
        })?;
        let mut hash = Sha256::new();
        hash.update(b"seams/router/wallet-do/v2");
        hash.update(encoded);
        Ok(format!("router-wallet-{}", lower_hex(&hash.finalize())))
    }
}

/// One registration execute request as the wallet object records it: its
/// wallet, its lifecycle, the digest that makes a retry exact, and the
/// request itself, which consumption returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouterWalletRegistrationV1 {
    pub ownership_generation: u64,
    pub owner: RouterWalletOwnerV1,
    pub lifecycle_id: String,
    pub request_digest_hex: String,
    pub request_json: String,
}

impl RouterWalletRegistrationV1 {
    /// The registration a Gateway execute request names, or `None` for
    /// another operation. The digest covers the whole request, tenant root
    /// included.
    pub fn from_request(
        request: &CloudflareRouterEd25519YaoExecuteRequestV2,
    ) -> RouterAbProtocolResult<Option<Self>> {
        let RouterEd25519YaoGatewayExecuteTargetV2::Registration {
            ownership_generation,
            binding,
            ..
        } = &request.target
        else {
            return Ok(None);
        };
        let lifecycle = &binding.lifecycle;
        let owner = RouterWalletOwnerV1 {
            org_id: request.tenant_root.identity.org_id().to_owned(),
            project_id: request.tenant_root.identity.project_id().to_owned(),
            env_id: request.tenant_root.identity.env_id().to_owned(),
            wallet_id: lifecycle.account_id.clone(),
        };
        let request_json = serde_json::to_string(request).map_err(encoding_error)?;
        Ok(Some(Self {
            ownership_generation: *ownership_generation,
            owner,
            lifecycle_id: lifecycle.lifecycle_id.clone(),
            request_digest_hex: registration_request_digest(&request_json),
            request_json,
        }))
    }

    /// The claim command for this request, at `now_ms`, holding it for
    /// `lease_ms`.
    pub fn claim(&self, now_ms: u64, lease_ms: u64) -> RouterWalletRequestV1 {
        RouterWalletRequestV1 {
            owner: self.owner.clone(),
            ownership_generation: self.ownership_generation,
            command: RouterWalletCommandV1::ClaimRegistration {
                lifecycle_id: self.lifecycle_id.clone(),
                request_digest_hex: self.request_digest_hex.clone(),
                request_json: self.request_json.clone(),
                now_ms,
                lease_ms,
            },
        }
    }

    /// The finish command recording the answer of the run holding claim
    /// `generation`, at `now_ms`, or `None` for an answer that is not
    /// terminal: a recoverable failure leaves the claim to lapse, and a retry
    /// then replays the run.
    pub fn finish(
        &self,
        result: &RouterEd25519YaoExecuteResultV1,
        generation: u64,
        now_ms: u64,
    ) -> RouterAbProtocolResult<Option<RouterWalletRequestV1>> {
        let outcome = match result {
            RouterEd25519YaoExecuteResultV1::Succeeded { .. } => {
                RouterWalletRegistrationOutcomeV1::Completed
            }
            RouterEd25519YaoExecuteResultV1::Rejected { .. }
            | RouterEd25519YaoExecuteResultV1::Burned { .. } => {
                RouterWalletRegistrationOutcomeV1::Failed
            }
            RouterEd25519YaoExecuteResultV1::RecoverableFailure { .. } => return Ok(None),
        };
        Ok(Some(RouterWalletRequestV1 {
            owner: self.owner.clone(),
            ownership_generation: self.ownership_generation,
            command: RouterWalletCommandV1::FinishRegistration {
                lifecycle_id: self.lifecycle_id.clone(),
                request_digest_hex: self.request_digest_hex.clone(),
                generation,
                now_ms,
                outcome,
                response_json: serde_json::to_string(result).map_err(encoding_error)?,
            },
        }))
    }
}

/// Gateway -> Router: consume one completed registration's activation for
/// one finalization, named by the consumer binding the Gateway derives from
/// the exact finalization request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareRouterEd25519YaoRegistrationConsumeRequestV1 {
    pub ownership_generation: u64,
    pub tenant_root: crate::CloudflareRouterEd25519YaoTenantRootV1,
    pub wallet_id: String,
    pub lifecycle_id: String,
    pub session_id: Ed25519YaoSessionIdV1,
    pub consumer_binding: String,
}

impl CloudflareRouterEd25519YaoRegistrationConsumeRequestV1 {
    /// The wallet object command, for the wallet the registration's own
    /// claim named.
    pub fn into_wallet_request(self) -> RouterWalletRequestV1 {
        RouterWalletRequestV1 {
            owner: RouterWalletOwnerV1 {
                org_id: self.tenant_root.identity.org_id().to_owned(),
                project_id: self.tenant_root.identity.project_id().to_owned(),
                env_id: self.tenant_root.identity.env_id().to_owned(),
                wallet_id: self.wallet_id,
            },
            ownership_generation: self.ownership_generation,
            command: RouterWalletCommandV1::ConsumeRegistration {
                lifecycle_id: self.lifecycle_id,
                session_id: self.session_id,
                consumer_binding: self.consumer_binding,
            },
        }
    }
}

/// The Router's record of one registration execution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RouterWalletRegistrationRecordV1 {
    /// The run holding claim `generation` holds the execution until
    /// `lease_until_ms`. A takeover starts the next generation.
    Claimed {
        lifecycle_id: String,
        request_digest_hex: String,
        request_json: String,
        generation: u64,
        claimed_at_ms: u64,
        lease_until_ms: u64,
    },
    /// The activation succeeded; `consumer_binding` is the finalization that
    /// consumed it, once one has.
    Completed {
        lifecycle_id: String,
        request_digest_hex: String,
        request_json: String,
        response_json: String,
        consumer_binding: Option<String>,
    },
    /// The execution ended in a terminal failure.
    Failed {
        lifecycle_id: String,
        request_digest_hex: String,
        request_json: String,
        response_json: String,
    },
}

/// A terminal answer's kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouterWalletRegistrationOutcomeV1 {
    Completed,
    Failed,
}

/// One command to a Router wallet object, for the wallet it names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouterWalletRequestV1 {
    pub ownership_generation: u64,
    pub owner: RouterWalletOwnerV1,
    pub command: RouterWalletCommandV1,
}

impl RouterWalletRequestV1 {
    /// Checks admitted recovery or export against this wallet's local generation and fence.
    pub fn settlement_admission(
        request: &CloudflareRouterEd25519YaoExecuteRequestV2,
    ) -> Option<Self> {
        let (ownership_generation, binding) = match &request.target {
            RouterEd25519YaoGatewayExecuteTargetV2::Registration { .. } => return None,
            RouterEd25519YaoGatewayExecuteTargetV2::Recovery {
                ownership_generation,
                binding,
                ..
            } => (ownership_generation, binding),
            RouterEd25519YaoGatewayExecuteTargetV2::Export {
                ownership_generation,
                binding,
                ..
            } => (ownership_generation, binding.ceremony()),
        };
        Some(Self {
            owner: RouterWalletOwnerV1 {
                org_id: request.tenant_root.identity.org_id().to_owned(),
                project_id: request.tenant_root.identity.project_id().to_owned(),
                env_id: request.tenant_root.identity.env_id().to_owned(),
                wallet_id: binding.lifecycle.account_id.clone(),
            },
            ownership_generation: *ownership_generation,
            command: RouterWalletCommandV1::AdmitSettlement,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RouterWalletCommandV1 {
    /// Reads one expired registration claim while the source is draining.
    PendingRegistration { now_ms: u64 },
    /// Allows admitted recovery and export work to settle until the source snapshot is sealed.
    AdmitSettlement,
    /// Claims a registration's execution before the Router runs it.
    ClaimRegistration {
        lifecycle_id: String,
        request_digest_hex: String,
        request_json: String,
        now_ms: u64,
        lease_ms: u64,
    },
    /// Records the terminal answer of the run holding claim `generation`.
    FinishRegistration {
        lifecycle_id: String,
        request_digest_hex: String,
        generation: u64,
        now_ms: u64,
        outcome: RouterWalletRegistrationOutcomeV1,
        response_json: String,
    },
    /// Consumes a completed registration's activation for one finalization.
    ConsumeRegistration {
        lifecycle_id: String,
        session_id: Ed25519YaoSessionIdV1,
        consumer_binding: String,
    },
}

/// A Router wallet object's answer to one command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RouterWalletResponseV1 {
    PendingRegistration {
        request_json: String,
    },
    NoPendingRegistration,
    /// Settlement execution passed the local ownership and source-fence checks.
    SettlementAdmitted,
    /// Claim `generation` is this run's: run the request, replaying when
    /// the run takes over a lapsed claim.
    Run {
        request_json: String,
        replay: bool,
        generation: u64,
    },
    /// Another run holds the claim until its lease lapses.
    InProgress { retry_after_ms: u64 },
    /// The execution's recorded answer, exactly as the Router first gave it.
    Answered { response_json: String },
    /// Another request already owns this lifecycle's execution.
    Mismatch,
    /// The activation and the request that produced it, for the consumer the
    /// record names.
    Consumed {
        request_json: String,
        response_json: String,
    },
    /// Consumption was refused.
    Refused {
        code: RouterWalletRefusalCodeV1,
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouterWalletRefusalCodeV1 {
    UnknownRegistration,
    RegistrationNotActivated,
    ActivationReferenceMismatch,
    ActivationConsumed,
}

/// A host's storage for one Router wallet object, used inside one
/// transaction.
#[allow(async_fn_in_trait)]
pub trait RouterWalletStoreV1 {
    async fn get_json<T: DeserializeOwned>(&self, key: &str) -> RouterAbProtocolResult<Option<T>>;
    async fn put_json<T: Serialize>(&self, key: &str, value: &T) -> RouterAbProtocolResult<()>;
    async fn delete_key(&self, key: &str) -> RouterAbProtocolResult<()>;
    async fn list_keys(&self, prefix: &str, limit: u32) -> RouterAbProtocolResult<Vec<String>>;
    async fn list_registrations(
        &self,
    ) -> RouterAbProtocolResult<Vec<(String, RouterWalletRegistrationRecordV1)>>;
}

/// Runs one command against one wallet object's storage. The first command
/// pins the object's owner; a command for another wallet is refused.
pub async fn router_wallet_serve_v1<Store: RouterWalletStoreV1>(
    store: &Store,
    request: RouterWalletRequestV1,
) -> RouterAbProtocolResult<RouterWalletResponseV1> {
    crate::router_wallet_relocation::require_ownership_generation(
        store,
        request.ownership_generation,
    )
    .await?;
    crate::router_wallet_relocation::admit_ordinary_command(store).await?;
    match store.get_json::<RouterWalletOwnerV1>(OWNER_KEY).await? {
        Some(owner) if owner != request.owner => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "Router wallet object belongs to another wallet",
            ))
        }
        Some(_) => {}
        None => store.put_json(OWNER_KEY, &request.owner).await?,
    }
    match request.command {
        RouterWalletCommandV1::PendingRegistration { now_ms } => {
            crate::router_wallet_relocation::pending_registration(store, &request.owner, now_ms)
                .await
        }
        RouterWalletCommandV1::AdmitSettlement => {
            crate::router_wallet_relocation::admit_settlement(store).await?;
            Ok(RouterWalletResponseV1::SettlementAdmitted)
        }
        RouterWalletCommandV1::ClaimRegistration {
            lifecycle_id,
            request_digest_hex,
            request_json,
            now_ms,
            lease_ms,
        } => {
            claim_registration(
                store,
                lifecycle_id,
                request_digest_hex,
                request_json,
                now_ms,
                lease_ms,
            )
            .await
        }
        RouterWalletCommandV1::FinishRegistration {
            lifecycle_id,
            request_digest_hex,
            generation,
            now_ms,
            outcome,
            response_json,
        } => {
            finish_registration(
                store,
                lifecycle_id,
                request_digest_hex,
                generation,
                now_ms,
                outcome,
                response_json,
            )
            .await
        }
        RouterWalletCommandV1::ConsumeRegistration {
            lifecycle_id,
            session_id,
            consumer_binding,
        } => consume_registration(store, lifecycle_id, session_id, consumer_binding).await,
    }
}

pub(crate) fn decode_stored_registration_request(
    request_json: &str,
) -> RouterAbProtocolResult<CloudflareRouterEd25519YaoExecuteRequestV2> {
    let mut value: serde_json::Value = serde_json::from_str(request_json)
        .map_err(|error| stored_record_error(format!("its request is unreadable: {error}")))?;
    if let Some(target) = value
        .get_mut("target")
        .and_then(serde_json::Value::as_object_mut)
    {
        if target.get("operation").and_then(serde_json::Value::as_str) == Some("registration")
            && !target.contains_key("ownership_generation")
        {
            // Fixed-home persisted requests predate explicit ownership generations.
            target.insert("ownership_generation".to_owned(), serde_json::json!(1));
        }
    }
    serde_json::from_value(value)
        .map_err(|error| stored_record_error(format!("its request is unreadable: {error}")))
}

pub(crate) fn registration_request_digest(request_json: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(b"seams/router/yao-registration-request/v1");
    hash.update(request_json.as_bytes());
    lower_hex(&hash.finalize())
}

fn matches_stored_registration_request(
    request_json: &str,
    stored_digest: &str,
    requested_digest: &str,
) -> RouterAbProtocolResult<bool> {
    if registration_request_digest(request_json) != stored_digest {
        return Err(stored_record_error(
            "its request digest differs from its bytes".to_owned(),
        ));
    }
    if stored_digest == requested_digest {
        return Ok(true);
    }
    let normalized = decode_stored_registration_request(request_json)?;
    let encoded = serde_json::to_string(&normalized).map_err(encoding_error)?;
    Ok(registration_request_digest(&encoded) == requested_digest)
}

fn registration_key(lifecycle_id: &str) -> RouterAbProtocolResult<String> {
    if lifecycle_id.is_empty() || lifecycle_id.len() > 256 {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "Router wallet registration lifecycle id is invalid",
        ));
    }
    Ok(format!("{REGISTRATION_KEY_PREFIX}{lifecycle_id}"))
}

async fn claim_registration<Store: RouterWalletStoreV1>(
    store: &Store,
    lifecycle_id: String,
    request_digest_hex: String,
    request_json: String,
    now_ms: u64,
    lease_ms: u64,
) -> RouterAbProtocolResult<RouterWalletResponseV1> {
    let key = registration_key(&lifecycle_id)?;
    if lease_ms < 1_000 {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "Router wallet registration lease must be at least one second",
        ));
    }
    let lease_until_ms = now_ms.saturating_add(lease_ms);
    match store
        .get_json::<RouterWalletRegistrationRecordV1>(&key)
        .await?
    {
        None => {
            crate::router_wallet_relocation::admit_new_registration(store).await?;
            store
                .put_json(
                    &key,
                    &RouterWalletRegistrationRecordV1::Claimed {
                        lifecycle_id,
                        request_digest_hex,
                        request_json: request_json.clone(),
                        generation: 1,
                        claimed_at_ms: now_ms,
                        lease_until_ms,
                    },
                )
                .await?;
            Ok(RouterWalletResponseV1::Run {
                request_json,
                replay: false,
                generation: 1,
            })
        }
        Some(RouterWalletRegistrationRecordV1::Claimed {
            request_digest_hex: claimed_digest,
            request_json: stored_request_json,
            generation: held_generation,
            lease_until_ms: held_until_ms,
            ..
        }) => {
            // Another request waits for the run that holds the claim, as the
            // same request does until the lease lapses.
            if !matches_stored_registration_request(
                &stored_request_json,
                &claimed_digest,
                &request_digest_hex,
            )? || held_until_ms > now_ms
            {
                return Ok(RouterWalletResponseV1::InProgress {
                    retry_after_ms: held_until_ms.saturating_sub(now_ms).max(1),
                });
            }
            let generation = held_generation
                .checked_add(1)
                .ok_or_else(|| stored_record_error("its claim generation overflowed".to_owned()))?;
            crate::router_wallet_relocation::admit_settlement(store).await?;
            store
                .put_json(
                    &key,
                    &RouterWalletRegistrationRecordV1::Claimed {
                        lifecycle_id,
                        request_digest_hex,
                        request_json: request_json.clone(),
                        generation,
                        claimed_at_ms: now_ms,
                        lease_until_ms,
                    },
                )
                .await?;
            Ok(RouterWalletResponseV1::Run {
                request_json,
                replay: true,
                generation,
            })
        }
        Some(
            RouterWalletRegistrationRecordV1::Completed {
                request_digest_hex: recorded_digest,
                request_json: stored_request_json,
                response_json,
                ..
            }
            | RouterWalletRegistrationRecordV1::Failed {
                request_digest_hex: recorded_digest,
                request_json: stored_request_json,
                response_json,
                ..
            },
        ) => Ok(
            if matches_stored_registration_request(
                &stored_request_json,
                &recorded_digest,
                &request_digest_hex,
            )? {
                RouterWalletResponseV1::Answered { response_json }
            } else {
                RouterWalletResponseV1::Mismatch
            },
        ),
    }
}

async fn finish_registration<Store: RouterWalletStoreV1>(
    store: &Store,
    lifecycle_id: String,
    request_digest_hex: String,
    generation: u64,
    now_ms: u64,
    outcome: RouterWalletRegistrationOutcomeV1,
    response_json: String,
) -> RouterAbProtocolResult<RouterWalletResponseV1> {
    let key = registration_key(&lifecycle_id)?;
    match store
        .get_json::<RouterWalletRegistrationRecordV1>(&key)
        .await?
    {
        // Only the run holding the current claim records its answer. A run
        // that resumes after another took its lapsed claim over is told the
        // execution is in progress; the current holder records the answer.
        Some(RouterWalletRegistrationRecordV1::Claimed {
            request_digest_hex: claimed_digest,
            generation: held_generation,
            lease_until_ms: held_until_ms,
            ..
        }) if claimed_digest == request_digest_hex && held_generation != generation => {
            Ok(RouterWalletResponseV1::InProgress {
                retry_after_ms: held_until_ms.saturating_sub(now_ms).max(1),
            })
        }
        Some(RouterWalletRegistrationRecordV1::Claimed {
            request_digest_hex: claimed_digest,
            request_json,
            ..
        }) if claimed_digest == request_digest_hex => {
            crate::router_wallet_relocation::admit_settlement(store).await?;
            let record = match outcome {
                RouterWalletRegistrationOutcomeV1::Completed => {
                    RouterWalletRegistrationRecordV1::Completed {
                        lifecycle_id,
                        request_digest_hex,
                        request_json,
                        response_json: response_json.clone(),
                        consumer_binding: None,
                    }
                }
                RouterWalletRegistrationOutcomeV1::Failed => {
                    RouterWalletRegistrationRecordV1::Failed {
                        lifecycle_id,
                        request_digest_hex,
                        request_json,
                        response_json: response_json.clone(),
                    }
                }
            };
            store.put_json(&key, &record).await?;
            Ok(RouterWalletResponseV1::Answered { response_json })
        }
        // The run holding the claim finished first: its answer stands, and
        // every later run gives it.
        Some(
            RouterWalletRegistrationRecordV1::Completed {
                request_digest_hex: recorded_digest,
                response_json: recorded,
                ..
            }
            | RouterWalletRegistrationRecordV1::Failed {
                request_digest_hex: recorded_digest,
                response_json: recorded,
                ..
            },
        ) if recorded_digest == request_digest_hex => Ok(RouterWalletResponseV1::Answered {
            response_json: recorded,
        }),
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
            "Router wallet registration claim is not held by this request; retry",
        )),
    }
}

async fn consume_registration<Store: RouterWalletStoreV1>(
    store: &Store,
    lifecycle_id: String,
    session_id: Ed25519YaoSessionIdV1,
    consumer_binding: String,
) -> RouterAbProtocolResult<RouterWalletResponseV1> {
    if consumer_binding.is_empty() || consumer_binding.len() > 256 {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "Router wallet consumer binding is invalid",
        ));
    }
    let key = registration_key(&lifecycle_id)?;
    let refused = |code, message: &str| {
        Ok(RouterWalletResponseV1::Refused {
            code,
            message: message.to_owned(),
        })
    };
    let Some(record) = store
        .get_json::<RouterWalletRegistrationRecordV1>(&key)
        .await?
    else {
        return refused(
            RouterWalletRefusalCodeV1::UnknownRegistration,
            "the Router has no execution for this registration",
        );
    };
    let RouterWalletRegistrationRecordV1::Completed {
        lifecycle_id,
        request_digest_hex,
        request_json,
        response_json,
        consumer_binding: consumed_by,
    } = record
    else {
        return refused(
            RouterWalletRefusalCodeV1::RegistrationNotActivated,
            "the registration has no completed Yao activation",
        );
    };
    let request = decode_stored_registration_request(&request_json)?;
    let RouterEd25519YaoGatewayExecuteTargetV2::Registration { binding, .. } = &request.target
    else {
        return Err(stored_record_error(
            "its request is not a registration".to_owned(),
        ));
    };
    if binding.session_id != session_id {
        return refused(
            RouterWalletRefusalCodeV1::ActivationReferenceMismatch,
            "the activation reference does not match the executed registration",
        );
    }
    match consumed_by {
        Some(bound) if bound != consumer_binding => refused(
            RouterWalletRefusalCodeV1::ActivationConsumed,
            "the activation was already consumed by another finalization",
        ),
        Some(_) => Ok(RouterWalletResponseV1::Consumed {
            request_json,
            response_json,
        }),
        None => {
            crate::router_wallet_relocation::admit_settlement(store).await?;
            store
                .put_json(
                    &key,
                    &RouterWalletRegistrationRecordV1::Completed {
                        lifecycle_id,
                        request_digest_hex,
                        request_json: request_json.clone(),
                        response_json: response_json.clone(),
                        consumer_binding: Some(consumer_binding),
                    },
                )
                .await?;
            Ok(RouterWalletResponseV1::Consumed {
                request_json,
                response_json,
            })
        }
    }
}

/// The refusal of a registration execute that carries the Gateway's replay
/// marker: the Router decides a registration's replay from its own claim.
pub fn router_wallet_registration_replay_refused_v1() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
        "a registration's replay is decided by the Router's claim; the replay marker is refused",
    )
}

pub(crate) fn lower_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn encoding_error(error: impl std::fmt::Display) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!("Router wallet registration request is not encodable: {error}"),
    )
}

fn stored_record_error(message: String) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!("Router wallet registration record is invalid: {message}"),
    )
}
