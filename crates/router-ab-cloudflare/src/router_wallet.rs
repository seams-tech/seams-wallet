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

const OWNER_KEY: &str = "owner";
const REGISTRATION_KEY_PREFIX: &str = "yao-registration/";

/// The wallet one Router wallet object belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouterWalletOwnerV1 {
    pub org_id: String,
    pub project_id: String,
    pub env_id: String,
    pub wallet_id: String,
}

impl RouterWalletOwnerV1 {
    /// The object's name: the same wallet always names the same object, and
    /// no other wallet can.
    pub fn object_name(&self) -> RouterAbProtocolResult<String> {
        let encoded = serde_json::to_vec(self).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("Router wallet owner is not encodable: {error}"),
            )
        })?;
        let mut hash = Sha256::new();
        hash.update(b"seams/router/wallet-do/v1");
        hash.update(encoded);
        Ok(format!("router-wallet-{}", lower_hex(&hash.finalize())))
    }
}

/// One registration execute request as the wallet object records it: its
/// wallet, its lifecycle, the digest that makes a retry exact, and the
/// request itself, which consumption returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouterWalletRegistrationV1 {
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
        let RouterEd25519YaoGatewayExecuteTargetV2::Registration { binding, .. } = &request.target
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
        let mut hash = Sha256::new();
        hash.update(b"seams/router/yao-registration-request/v1");
        hash.update(request_json.as_bytes());
        Ok(Some(Self {
            owner,
            lifecycle_id: lifecycle.lifecycle_id.clone(),
            request_digest_hex: lower_hex(&hash.finalize()),
            request_json,
        }))
    }

    /// The claim command for this request, at `now_ms`, holding it for
    /// `lease_ms`.
    pub fn claim(&self, now_ms: u64, lease_ms: u64) -> RouterWalletRequestV1 {
        RouterWalletRequestV1 {
            owner: self.owner.clone(),
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
    pub owner: RouterWalletOwnerV1,
    pub command: RouterWalletCommandV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RouterWalletCommandV1 {
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
}

/// Runs one command against one wallet object's storage. The first command
/// pins the object's owner; a command for another wallet is refused.
pub async fn router_wallet_serve_v1<Store: RouterWalletStoreV1>(
    store: &Store,
    request: RouterWalletRequestV1,
) -> RouterAbProtocolResult<RouterWalletResponseV1> {
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
            generation: held_generation,
            lease_until_ms: held_until_ms,
            ..
        }) => {
            // Another request waits for the run that holds the claim, as the
            // same request does until the lease lapses.
            if claimed_digest != request_digest_hex || held_until_ms > now_ms {
                return Ok(RouterWalletResponseV1::InProgress {
                    retry_after_ms: held_until_ms.saturating_sub(now_ms).max(1),
                });
            }
            let generation = held_generation
                .checked_add(1)
                .ok_or_else(|| stored_record_error("its claim generation overflowed".to_owned()))?;
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
                response_json,
                ..
            }
            | RouterWalletRegistrationRecordV1::Failed {
                request_digest_hex: recorded_digest,
                response_json,
                ..
            },
        ) => Ok(if recorded_digest == request_digest_hex {
            RouterWalletResponseV1::Answered { response_json }
        } else {
            RouterWalletResponseV1::Mismatch
        }),
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
    let request = serde_json::from_str::<CloudflareRouterEd25519YaoExecuteRequestV2>(&request_json)
        .map_err(|error| stored_record_error(format!("its request is unreadable: {error}")))?;
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

fn lower_hex(bytes: &[u8]) -> String {
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
