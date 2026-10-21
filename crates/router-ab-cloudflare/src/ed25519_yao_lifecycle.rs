mod bound_root;
#[cfg(any(feature = "strict-worker-deriver-a-entrypoint", test))]
mod deriver_a_execute;
#[cfg(any(feature = "strict-worker-deriver-a-entrypoint", test))]
pub(crate) use deriver_a_execute::execute_deriver_a_role;
mod deriver_b_start;
mod deriver_b_state;
#[cfg(feature = "strict-worker-deriver-b-entrypoint")]
mod registration_peer;
use crate::tenant_root_role_d1::RootUseAccess;
#[cfg(any(feature = "strict-worker-deriver-a-entrypoint", test))]
pub(crate) use bound_root::DeriverATargetSource;
use bound_root::load_ed25519_yao_tenant_root_role_share_v2;
#[cfg(any(feature = "strict-worker-deriver-a-entrypoint", test))]
use bound_root::{prepare_deriver_a_target, PreparedDeriverATarget};
#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
pub(crate) use bound_root::{prepare_deriver_a_pair_for_wallet_do_v1, DeriverAPairPreparationV1};
use core::{fmt, future::Future};
use deriver_b_start::handle_pair_bound_deriver_b_websocket;
#[cfg(feature = "strict-worker-deriver-b-entrypoint")]
pub(crate) use registration_peer::accept_prepared_peer;
use std::time::Duration;

#[path = "ed25519_yao_role_d1.rs"]
pub(crate) mod role_d1;

use futures::future::{select, Either};
use hpke_ng::Kem;
use router_ab_core::{
    ed25519_yao_encrypted_input_digest_v1, Ed25519YaoCircuitFamilyV1,
    Ed25519YaoDeriverAPrefaceInFlightV2, Ed25519YaoDeriverAToBTargetProofPayloadV2,
    Ed25519YaoDeriverBPrefaceInFlightV2, Ed25519YaoDeriverBToATargetProofPayloadV2,
    Ed25519YaoDeriverRoleV1, Ed25519YaoEncryptedInputV1, Ed25519YaoExecutionIdV1,
    Ed25519YaoInputKindV1, Ed25519YaoInputPairBindingV1, Ed25519YaoOuterBindingV2, PublicDigest32,
    RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult,
    TenantRootCustodyBindingV1, TwoPartyDeriverRole, VerifiedTenantRootOnlineRoleShareV1,
};
use router_ab_ed25519_yao::{
    build_product_activation_deriver_b_with_server_v1,
    build_product_export_deriver_b_with_server_v1,
    build_product_lane_deriver_b_with_server_v1,
    duplex::{
        run_activation_deriver_b_open, run_export_deriver_b_open, run_lane_materialization_deriver_b_open,
    },
    open_ed25519_yao_activation_deriver_b_input_v1,
    open_ed25519_yao_export_deriver_b_input_v1,
    open_ed25519_yao_lane_deriver_b_input_v1,
    seal_ed25519_yao_activation_deriver_b_execution_v1,
    seal_ed25519_yao_export_deriver_b_execution_v1,
    seal_ed25519_yao_lane_deriver_b_execution_v1,
    stable_key_derivation_context_v1, AdapterError, Ed25519YaoRecipientPrivateKeyV1,
    Ed25519YaoRoleExecutionV1,
};

#[cfg(any(feature = "strict-worker-deriver-a-entrypoint", test))]
use router_ab_ed25519_yao::{
    build_product_activation_deriver_a_with_server_v1,
    build_product_export_deriver_a_with_server_v1,
    build_product_lane_deriver_a_with_server_v1,
    open_ed25519_yao_activation_deriver_a_input_v1,
    open_ed25519_yao_export_deriver_a_input_v1,
    open_ed25519_yao_lane_deriver_a_input_v1,
    seal_ed25519_yao_activation_deriver_a_execution_v1,
    seal_ed25519_yao_export_deriver_a_execution_v1,
    seal_ed25519_yao_lane_deriver_a_execution_v1,
    duplex::{run_activation_deriver_a, run_export_deriver_a, run_lane_materialization_deriver_a},
};
use serde::{Deserialize, Serialize};

use signer_core::ed25519_yao_derivation::{
    derive_ed25519_yao_deriver_a_server_contribution_v1,
    derive_ed25519_yao_deriver_b_server_contribution_v1, Ed25519YaoDeriverADerivationRootV1,
    Ed25519YaoDeriverAServerContributionV1, Ed25519YaoDeriverBDerivationRootV1,
    Ed25519YaoDeriverBServerContributionV1, Ed25519YaoStableKeyDerivationContextV1,
};
use threshold_prf::{
    prepare_ed25519_deriver_a_target_v1, prepare_ed25519_deriver_b_target_v1,
    SigningRootShareCommitment,
};
use worker::{Context, Delay, Env, Request, Response, WebSocketPair};
use zeroize::{Zeroize, Zeroizing};

use crate::ed25519_yao_websocket::{
    CloudflareDeriverBPairStartScopeV1, EXECUTION_ID_HEADER, PAIR_START_REFUSAL_STATUS,
    WALLET_PAIR_SCOPE_HEADER,
};
use crate::{
    decode_cloudflare_signer_envelope_hpke_private_key_secret_v1,
    parse_cloudflare_signer_envelope_hpke_public_key_set_v1,
    parse_cloudflare_trace_id_from_request_v1, CloudflareDeriverBWalletPairScopeV1, CloudflareDeriverBWorkerRuntimeV1,
    CloudflareEd25519YaoCircuitV1, CloudflareEd25519YaoPairPreparationV1,
    CloudflareEd25519YaoPairPrepareRequestV1, CloudflareEd25519YaoPairStartRefusalReasonV1, CloudflareEd25519YaoPairStartRefusalV1,
    CloudflareEd25519YaoPairStatusResponseV1, CloudflareEd25519YaoWebSocketBindingV1,
    CloudflareEd25519YaoWebSocketTransportV1, CloudflareHpkeGetrandomRngV1, CloudflareTraceIdV1,
    CloudflareWorkerEnvReaderV1, CloudflareWorkerRoleV1,
};

#[cfg(any(feature = "strict-worker-deriver-a-entrypoint", test))]
use crate::{CloudflareDeriverAWorkerRuntimeV1, CloudflareEd25519YaoPairStartErrorV1};

use crate::hpke::{
    parse_cloudflare_hpke_x25519_public_key_v1, CloudflareHpkeKemV1, CloudflareHpkeSuiteV1,
};

pub const CLOUDFLARE_DERIVER_B_ED25519_YAO_DUPLEX_PATH: &str =
    "/router-ab/deriver-b/ed25519-yao/duplex";
pub const CLOUDFLARE_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH: &str =
    "/router-ab/deriver-a/ed25519-yao/execute-pair";
pub const CLOUDFLARE_DERIVER_A_ED25519_YAO_READ_PAIR_STATUS_PATH: &str =
    "/router-ab/deriver-a/ed25519-yao/read-pair-status";
pub const CLOUDFLARE_DERIVER_A_ED25519_YAO_BURN_PAIR_PATH: &str =
    "/router-ab/deriver-a/ed25519-yao/burn-pair";
pub const CLOUDFLARE_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH: &str =
    "/router-ab/deriver-b/ed25519-yao/prepare-pair";
pub const CLOUDFLARE_DERIVER_B_ED25519_YAO_READ_PAIR_STATUS_PATH: &str =
    "/router-ab/deriver-b/ed25519-yao/read-pair-status";
pub const CLOUDFLARE_DERIVER_B_ED25519_YAO_BURN_PAIR_PATH: &str =
    "/router-ab/deriver-b/ed25519-yao/burn-pair";

const PAIR_SESSION_RECORD_STORAGE_KEY: &str = "pair-session-record-v1";
/// How long one pair may take. It bounds each role's protocol execution,
/// Deriver A's wait for B's answer to its connection, and a Router run that
/// has no shorter registration lease.
pub(crate) const YAO_CEREMONY_TIMEOUT: Duration = Duration::from_secs(15);
const YAO_PREPARED_INPUT_LIFETIME_MS: u64 = 60_000;
const YAO_RUNNING_LIFETIME_MS: u64 = 20_000;
/// How often Deriver B looks for its own preparation while a connection from
/// Deriver A waits for it.
const YAO_PREPARATION_POLL: Duration = Duration::from_millis(5);
const ROLE_SPAN_EVENT_V1: &str = "router_ab_yao_role_span_v1";
const ED25519_YAO_TARGET_PROOF_HPKE_INFO_V2: &[u8] = b"seams/ed25519-yao/target-proof/hpke/v2";

pub(crate) type RoleTraceContextV1 = Option<CloudflareTraceIdV1>;

#[derive(Serialize)]
struct RoleSpanEventV1 {
    event: &'static str,
    span: &'static str,
    role: &'static str,
    operation: &'static str,
    outcome: &'static str,
    duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<RouterAbProtocolErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    adapter_code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

pub(crate) fn emit_role_span_v1(
    trace_id: RoleTraceContextV1,
    span: &'static str,
    role: &'static str,
    operation: &'static str,
    started_at_ms: u64,
    outcome: &'static str,
) {
    emit_role_span_with_error_code_v1(
        trace_id,
        span,
        role,
        operation,
        started_at_ms,
        outcome,
        None,
        None,
    );
}

fn emit_role_span_error_v1(
    trace_id: RoleTraceContextV1,
    span: &'static str,
    role: &'static str,
    operation: &'static str,
    started_at_ms: u64,
    error: &RouterAbProtocolError,
) {
    emit_role_span_with_error_code_v1(
        trace_id,
        span,
        role,
        operation,
        started_at_ms,
        "failure",
        Some(error.code()),
        None,
    );
}

fn emit_role_adapter_error_v1(
    trace_id: RoleTraceContextV1,
    span: &'static str,
    operation: &'static str,
    started_at_ms: u64,
    error: AdapterError,
) {
    emit_role_span_with_error_code_v1(
        trace_id,
        span,
        "deriver_b",
        operation,
        started_at_ms,
        "failure",
        Some(RouterAbProtocolErrorCode::InvalidLifecycleState),
        Some(adapter_error_code_v1(error)),
    );
}

fn emit_role_stage_result_v1<T>(
    trace_id: RoleTraceContextV1,
    span: &'static str,
    operation: &'static str,
    started_at_ms: u64,
    result: &RouterAbProtocolResult<T>,
) {
    match result {
        Ok(_) => emit_role_span_v1(
            trace_id,
            span,
            "deriver_b",
            operation,
            started_at_ms,
            "success",
        ),
        Err(error) => {
            emit_role_span_error_v1(trace_id, span, "deriver_b", operation, started_at_ms, error)
        }
    }
}

fn emit_role_span_with_error_code_v1(
    trace_id: RoleTraceContextV1,
    span: &'static str,
    role: &'static str,
    operation: &'static str,
    started_at_ms: u64,
    outcome: &'static str,
    error_code: Option<RouterAbProtocolErrorCode>,
    adapter_code: Option<&'static str>,
) {
    let ended_at_ms = cloudflare_yao_now_unix_ms().unwrap_or(started_at_ms);
    let event = RoleSpanEventV1 {
        event: ROLE_SPAN_EVENT_V1,
        span,
        role,
        operation,
        outcome,
        duration_ms: ended_at_ms.saturating_sub(started_at_ms),
        error_code,
        adapter_code,
        trace_id: trace_id.map(CloudflareTraceIdV1::as_hex),
    };
    if let Ok(serialized) = serde_json::to_string(&event) {
        worker::console_log!("{serialized}");
    }
}

fn role_span_started_at_ms() -> u64 {
    cloudflare_yao_now_unix_ms().unwrap_or_default()
}

/// Protocol runs this isolate has started. A module-level value lives as long
/// as the isolate, so the first run of a new isolate reports zero.
static ROLE_ISOLATE_PROTOCOL_RUNS: core::sync::atomic::AtomicU32 =
    core::sync::atomic::AtomicU32::new(0);

#[derive(Serialize)]
struct RoleIsolateCounterEventV1 {
    event: &'static str,
    role: &'static str,
    operation: &'static str,
    execution_index: u32,
    /// What became of this isolate's prewarm ceremony before this run.
    prewarm: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

/// Starts a protocol span and records how many runs this isolate has served.
/// The Worker clock does not advance while the isolate computes, so spans
/// exclude a role's own CPU. The platform's CPU time per invocation, read
/// beside this index, shows what a first run in a new isolate costs.
fn begin_role_protocol_v1(
    trace_id: RoleTraceContextV1,
    role: &'static str,
    operation: &'static str,
) -> u64 {
    crate::ed25519_yao_prewarm::note_pair_work_arrived_v1();
    let event = RoleIsolateCounterEventV1 {
        event: "router_ab_yao_role_isolate_counter_v1",
        role,
        operation,
        execution_index: ROLE_ISOLATE_PROTOCOL_RUNS
            .fetch_add(1, core::sync::atomic::Ordering::Relaxed),
        prewarm: crate::ed25519_yao_prewarm::prewarm_state_label_v1(),
        trace_id: trace_id.map(CloudflareTraceIdV1::as_hex),
    };
    if let Ok(serialized) = serde_json::to_string(&event) {
        worker::console_log!("{serialized}");
    }
    role_span_started_at_ms()
}

/// Pair-bound role state used by the Router-owned lifecycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum PairYaoSessionRecordV1 {
    Prepared {
        pair_digest: [u8; 32],
        input_digest: [u8; 32],
        root_metadata_digest: [u8; 32],
        expires_at_ms: u64,
        pair_binding: Box<Ed25519YaoInputPairBindingV1>,
        tenant_root: Box<crate::CloudflareEd25519YaoTenantRootContextV2>,
        input: Box<Ed25519YaoEncryptedInputV1>,
        work: crate::CloudflareEd25519YaoPairWorkV1,
    },
    Running {
        pair_digest: [u8; 32],
        input_digest: [u8; 32],
        root_metadata_digest: [u8; 32],
        execution_id: [u8; 32],
        started_at_ms: u64,
        pair_binding: Box<Ed25519YaoInputPairBindingV1>,
        tenant_root: Box<crate::CloudflareEd25519YaoTenantRootContextV2>,
        input: Box<Ed25519YaoEncryptedInputV1>,
        work: crate::CloudflareEd25519YaoPairWorkV1,
    },
    Completed {
        pair_digest: [u8; 32],
        input_digest: [u8; 32],
        root_metadata_digest: [u8; 32],
        execution: Box<Ed25519YaoRoleExecutionV1>,
    },
    Burned {
        pair_digest: [u8; 32],
        input_digest: [u8; 32],
        execution_id: [u8; 32],
    },
    Expired {
        pair_digest: [u8; 32],
        input_digest: [u8; 32],
    },
}

impl PairYaoSessionRecordV1 {
    fn pair_digest(&self) -> [u8; 32] {
        match self {
            Self::Prepared { pair_digest, .. }
            | Self::Running { pair_digest, .. }
            | Self::Completed { pair_digest, .. }
            | Self::Burned { pair_digest, .. }
            | Self::Expired { pair_digest, .. } => *pair_digest,
        }
    }

    fn input_digest(&self) -> [u8; 32] {
        match self {
            Self::Prepared { input_digest, .. }
            | Self::Running { input_digest, .. }
            | Self::Completed { input_digest, .. }
            | Self::Burned { input_digest, .. }
            | Self::Expired { input_digest, .. } => *input_digest,
        }
    }
}

/// Computes the only valid completion transition for Deriver B's pair.
///
/// The caller supplies the pair and input digests it observed in the running
/// record before entering the storage transaction.
fn completed_pair_record_if_running(
    current: &PairYaoSessionRecordV1,
    pair_digest: [u8; 32],
    expected_input_digest: [u8; 32],
    execution: &Ed25519YaoRoleExecutionV1,
    now_ms: u64,
) -> Option<PairYaoSessionRecordV1> {
    let PairYaoSessionRecordV1::Running {
        pair_digest: stored_pair,
        input_digest,
        root_metadata_digest,
        execution_id,
        started_at_ms,
        input,
        ..
    } = current
    else {
        return None;
    };
    if *stored_pair != pair_digest
        || *input_digest != expected_input_digest
        || execution.session() != input.session()
    {
        return None;
    }
    if now_ms.saturating_sub(*started_at_ms) >= YAO_RUNNING_LIFETIME_MS {
        return Some(PairYaoSessionRecordV1::Burned {
            pair_digest,
            input_digest: *input_digest,
            execution_id: *execution_id,
        });
    }
    Some(PairYaoSessionRecordV1::Completed {
        pair_digest: *stored_pair,
        input_digest: *input_digest,
        root_metadata_digest: *root_metadata_digest,
        execution: Box::new(execution.clone()),
    })
}

async fn expire_prepared_pair_if_current(
    storage: &role_d1::RolePairD1StorageV1,
    pair_digest: [u8; 32],
    input_digest: [u8; 32],
    now_ms: u64,
) -> worker::Result<bool> {
    storage
        .transaction(move |transaction| async move {
            let current = match transaction
                .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
                .await
            {
                Ok(record) => record,
                Err(worker::Error::JsError(message)) if message == "No such value in storage." => {
                    return Ok(());
                }
                Err(error) => return Err(error),
            };
            match current {
                PairYaoSessionRecordV1::Prepared {
                    pair_digest: stored_pair,
                    input_digest: stored_input,
                    expires_at_ms,
                    ..
                } if stored_pair == pair_digest
                    && stored_input == input_digest
                    && now_ms >= expires_at_ms =>
                {
                    transaction
                        .put(
                            PAIR_SESSION_RECORD_STORAGE_KEY,
                            PairYaoSessionRecordV1::Expired {
                                pair_digest,
                                input_digest,
                            },
                        )
                        .await?;
                    Ok(())
                }
                PairYaoSessionRecordV1::Expired {
                    pair_digest: stored_pair,
                    input_digest: stored_input,
                } if stored_pair == pair_digest && stored_input == input_digest => Ok(()),
                _ => Ok(()),
            }
        })
        .await?;
    Ok(matches!(
        storage
            .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
            .await?,
        Some(PairYaoSessionRecordV1::Expired {
            pair_digest: stored_pair,
            input_digest: stored_input,
        }) if stored_pair == pair_digest && stored_input == input_digest
    ))
}

async fn burn_running_pair_if_expired(
    storage: &role_d1::RolePairD1StorageV1,
    pair_digest: [u8; 32],
    input_digest: [u8; 32],
    execution_id: [u8; 32],
    started_at_ms: u64,
    now_ms: u64,
) -> worker::Result<bool> {
    if now_ms.saturating_sub(started_at_ms) < YAO_RUNNING_LIFETIME_MS {
        return Ok(false);
    }
    storage
        .transaction(move |transaction| async move {
            let current = match transaction
                .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
                .await
            {
                Ok(record) => record,
                Err(worker::Error::JsError(message)) if message == "No such value in storage." => {
                    return Ok(())
                }
                Err(error) => return Err(error),
            };
            if matches!(
                current,
                PairYaoSessionRecordV1::Running {
                    pair_digest: stored_pair,
                    input_digest: stored_input,
                    execution_id: stored_execution_id,
                    started_at_ms: stored_started_at,
                    ..
                } if stored_pair == pair_digest
                    && stored_input == input_digest
                    && stored_execution_id == execution_id
                    && stored_started_at == started_at_ms
            ) {
                transaction
                    .put(
                        PAIR_SESSION_RECORD_STORAGE_KEY,
                        PairYaoSessionRecordV1::Burned {
                            pair_digest,
                            input_digest,
                            execution_id,
                        },
                    )
                    .await?;
            }
            Ok(())
        })
        .await?;
    Ok(matches!(
        storage
            .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
            .await?,
        Some(PairYaoSessionRecordV1::Burned {
            pair_digest: stored_pair,
            input_digest: stored_input,
            execution_id: stored_execution_id,
        }) if stored_pair == pair_digest
            && stored_input == input_digest
            && stored_execution_id == execution_id
    ))
}

impl CloudflareEd25519YaoPairPrepareRequestV1 {
    pub(crate) fn validate_for_role(
        &self,
        role: Ed25519YaoDeriverRoleV1,
        expected_kind: Ed25519YaoInputKindV1,
    ) -> RouterAbProtocolResult<([u8; 32], [u8; 32])> {
        self.pair_binding.validate()?;
        self.tenant_root.validate_for_pair(&self.pair_binding)?;
        validate_pair_work_v1(&self.work, &self.pair_binding, &self.input)?;
        validate_deriver_input(&self.input, role, expected_kind)?;
        let input_digest = ed25519_yao_encrypted_input_digest_v1(&self.input)?.bytes;
        let expected_digest = match role {
            Ed25519YaoDeriverRoleV1::DeriverA => self.pair_binding.deriver_a_input_digest(),
            Ed25519YaoDeriverRoleV1::DeriverB => self.pair_binding.deriver_b_input_digest(),
        };
        if input_digest != expected_digest.bytes {
            return Err(invalid_lifecycle(
                "pair preparation input does not match its canonical pair digest",
            ));
        }
        if self.input.session() != self.pair_binding.session() {
            return Err(invalid_lifecycle(
                "pair preparation input does not match its ceremony session",
            ));
        }
        Ok((self.pair_binding.pair_digest().bytes, input_digest))
    }
}

fn validate_pair_work_v1(
    work: &crate::CloudflareEd25519YaoPairWorkV1,
    pair_binding: &Ed25519YaoInputPairBindingV1,
    input: &Ed25519YaoEncryptedInputV1,
) -> RouterAbProtocolResult<()> {
    match work {
        crate::CloudflareEd25519YaoPairWorkV1::Ceremony => {
            if input.kind() == Ed25519YaoInputKindV1::LaneMaterialization {
                return Err(invalid_lifecycle(
                    "lane-materialization input requires an admitted lane job",
                ));
            }
        }
        crate::CloudflareEd25519YaoPairWorkV1::Lane { job } => {
            job.validate()?;
            if input.kind() != Ed25519YaoInputKindV1::LaneMaterialization
                || input.operation() != job.yao_request_kind.operation()
                || input.session() != job.session_v1()?
                || input.stable_context_binding() != job.stable_context_binding_v1()?
                || pair_binding.binding().operation != job.yao_request_kind.operation()
                || pair_binding.binding().session_id.into_bytes() != job.session_v1()?
                || pair_binding
                    .binding()
                    .stable_key_context_binding
                    .into_bytes()
                    != job.stable_context_binding_v1()?
                || pair_binding.binding().material_activation() != &job.source.material_activation
                || pair_binding.authorization_digest()
                    != PublicDigest32::new(job.transcript_digest_v1()?)
            {
                return Err(invalid_lifecycle(
                    "lane pair context does not match its admitted job",
                ));
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub(crate) enum DeriverBYaoSessionCommandV1 {
    PreparePair {
        pair_binding: Box<Ed25519YaoInputPairBindingV1>,
        tenant_root: Box<crate::CloudflareEd25519YaoTenantRootContextV2>,
        work: crate::CloudflareEd25519YaoPairWorkV1,
        input: Box<Ed25519YaoEncryptedInputV1>,
    },
    /// Claims the pair for the one execution Deriver A reserved, when this
    /// role prepared it for the same Router run.
    BeginPair {
        session: [u8; 32],
        pair_digest: [u8; 32],
        execution_id: Ed25519YaoExecutionIdV1,
        outer_binding: Box<Ed25519YaoOuterBindingV2>,
    },
    CompletePair {
        pair_digest: [u8; 32],
        execution: Box<Ed25519YaoRoleExecutionV1>,
    },
    /// Burns the pair. A pair this role never prepared is recorded burned
    /// too, so a preparation that arrives afterwards is refused.
    FailPair {
        pair_binding: Box<Ed25519YaoInputPairBindingV1>,
    },
    ReadPairStatus {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
}

impl DeriverBYaoSessionCommandV1 {
    fn operation(&self) -> &'static str {
        match self {
            Self::PreparePair { .. } => "prepare_pair",
            Self::BeginPair { .. } => "begin_pair",
            Self::CompletePair { .. } => "complete_pair",
            Self::FailPair { .. } => "fail_pair",
            Self::ReadPairStatus { .. } => "read_pair_status",
        }
    }

    pub(crate) fn session(&self) -> [u8; 32] {
        match self {
            Self::PreparePair { input, .. } => input.session(),
            Self::BeginPair { session, .. } | Self::ReadPairStatus { session, .. } => *session,
            Self::FailPair { pair_binding } => pair_binding.session(),
            Self::CompletePair { execution, .. } => execution.session(),
        }
    }

    pub(crate) fn pair_digest(&self) -> [u8; 32] {
        match self {
            Self::PreparePair { pair_binding, .. } | Self::FailPair { pair_binding } => {
                pair_binding.pair_digest().bytes
            }
            Self::BeginPair { pair_digest, .. }
            | Self::CompletePair { pair_digest, .. }
            | Self::ReadPairStatus { pair_digest, .. } => *pair_digest,
        }
    }

    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        let session = self.session();
        if session.iter().all(|byte| *byte == 0) {
            return Err(invalid_lifecycle("Ed25519 Yao session must be nonzero"));
        }
        match self {
            Self::PreparePair {
                pair_binding,
                tenant_root,
                work,
                input,
            } => {
                let expected_kind = input_kind_for_circuit(pair_binding.binding().circuit_family());
                CloudflareEd25519YaoPairPrepareRequestV1 {
                    pair_binding: *pair_binding.clone(),
                    tenant_root: *tenant_root.clone(),
                    work: work.clone(),
                    input: *input.clone(),
                }
                .validate_for_role(Ed25519YaoDeriverRoleV1::DeriverB, expected_kind)?;
            }
            Self::CompletePair {
                pair_digest,
                execution,
            } => {
                if pair_digest.iter().all(|byte| *byte == 0) {
                    return Err(invalid_lifecycle("pair digest must be nonzero"));
                }
                execution.validate()?;
                if execution.deriver() != Ed25519YaoDeriverRoleV1::DeriverB {
                    return Err(invalid_lifecycle(
                        "Deriver B pair storage accepts only Deriver B execution",
                    ));
                }
            }
            Self::FailPair { pair_binding } => pair_binding.validate()?,
            Self::BeginPair {
                pair_digest,
                outer_binding,
                ..
            } => {
                if pair_digest.iter().all(|byte| *byte == 0) {
                    return Err(invalid_lifecycle("pair digest must be nonzero"));
                }
                outer_binding.validate()?;
            }
            Self::ReadPairStatus { pair_digest, .. } => {
                if pair_digest.iter().all(|byte| *byte == 0) {
                    return Err(invalid_lifecycle("pair digest must be nonzero"));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
enum DeriverBYaoSessionResponseV1 {
    PairPrepared {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    PairRunning {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    PairStarted {
        session: [u8; 32],
        pair_digest: [u8; 32],
        execution_id: Ed25519YaoExecutionIdV1,
        input: Box<Ed25519YaoEncryptedInputV1>,
        work: crate::CloudflareEd25519YaoPairWorkV1,
        root_metadata_digest: [u8; 32],
        pair_binding: Box<Ed25519YaoInputPairBindingV1>,
        tenant_root: Box<crate::CloudflareEd25519YaoTenantRootContextV2>,
    },
    PairCompleted {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    /// No preparation of the run that asked: none at all, or only an earlier
    /// Router run's.
    PairMissing {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    PairRoleExecution {
        execution: Box<Ed25519YaoRoleExecutionV1>,
    },
    PairBurned {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    PairExpired {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    /// The session already holds another pair or another input.
    PairConflict {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
}

pub(crate) struct DeriverBYaoSessionD1V1 {
    env: Env,
    #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
    wallet_do: Option<DeriverBWalletDoStorageV1>,
}

#[cfg(feature = "strict-worker-deriver-b-entrypoint")]
struct DeriverBWalletDoStorageV1 {
    inputs: std::rc::Rc<std::cell::RefCell<role_d1::PreparedPairInputs>>,
    sql: worker::SqlStorage,
    object_name: String,
    object_id: String,
    root_identity_digest_hex: String,
}

impl DeriverBYaoSessionD1V1 {
    /// Loads B's role share for this preparation, binding to the wallet
    /// object's registration preparation when it holds one.
    async fn load_role_share_for_preparation(
        &self,
        request: &CloudflareEd25519YaoPairPrepareRequestV1,
    ) -> worker::Result<
        RouterAbProtocolResult<(
            TenantRootCustodyBindingV1,
            VerifiedTenantRootOnlineRoleShareV1,
            Ed25519YaoStableKeyDerivationContextV1,
            [u8; 32],
        )>,
    > {
        let load = |access| {
            load_ed25519_yao_tenant_root_role_share_v2(
                &self.env,
                CloudflareWorkerRoleV1::DeriverB,
                &request.tenant_root,
                &request.pair_binding,
                self.pair_object_id(),
                access,
            )
        };
        #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
        if let Some(wallet) = &self.wallet_do {
            return crate::durable_object::registration_preparation::load_for_execution(
                &wallet.object_id,
                &wallet.sql,
                &self.env,
                &request.tenant_root,
                &request.pair_binding,
                load,
            )
            .await;
        }
        Ok(load(RootUseAccess::Admit).await.and_then(|loaded| {
            loaded.map_err(crate::tenant_root_role_runtime::AttemptConflictV1::into_error)
        }))
    }
    #[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
    fn new(env: Env) -> Self {
        Self {
            env,
            #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
            wallet_do: None,
        }
    }

    #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
    pub(crate) fn for_wallet_do(
        env: Env,
        sql: worker::SqlStorage,
        object_name: String,
        object_id: String,
        root_identity_digest_hex: String,
        inputs: std::rc::Rc<std::cell::RefCell<role_d1::PreparedPairInputs>>,
    ) -> Self {
        Self {
            env,
            wallet_do: Some(DeriverBWalletDoStorageV1 {
                inputs,
                sql,
                object_name,
                object_id,
                root_identity_digest_hex,
            }),
        }
    }

    /// The wallet object that holds this role's pair records, if any.
    fn pair_object_id(&self) -> Option<String> {
        #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
        if let Some(wallet_do) = &self.wallet_do {
            return Some(wallet_do.object_id.clone());
        }
        None
    }

    fn storage(&self, session: [u8; 32]) -> worker::Result<role_d1::RolePairD1StorageV1> {
        #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
        if let Some(wallet_do) = &self.wallet_do {
            return role_d1::RolePairD1StorageV1::from_deriver_b_wallet_do(
                &self.env,
                wallet_do.sql.clone(),
                session,
                &wallet_do.object_name,
                &wallet_do.root_identity_digest_hex,
                wallet_do.inputs.clone(),
            );
        }
        role_d1::RolePairD1StorageV1::from_env(&self.env, session)
    }

    pub(crate) async fn execute(
        &self,
        command: DeriverBYaoSessionCommandV1,
    ) -> worker::Result<Response> {
        command
            .validate()
            .map_err(|error| worker::Error::RustError(error.message().to_owned()))?;
        self.handle_pair_command(command).await
    }
}

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
pub(crate) async fn fail_deriver_b_pair_after_a_error_v1(
    env: &Env,
    scope: &CloudflareDeriverBWalletPairScopeV1,
) {
    let _ = crate::router_coordinator::post_role_request(
        env,
        "DERIVER_B",
        "https://router-ab-deriver-b.internal",
        CLOUDFLARE_DERIVER_B_ED25519_YAO_BURN_PAIR_PATH,
        "Deriver B pair burn after A failure",
        scope,
        None,
    )
    .await;
}

pub(crate) struct DeriverAPairExecutionContextV1<'a> {
    /// The wallet object that holds A's pair record.
    pub(crate) pair_object: String,
    pub(crate) expected_root_metadata_digest: [u8; 32],
    pub(crate) pair_binding: &'a Ed25519YaoInputPairBindingV1,
    pub(crate) tenant_root: &'a crate::CloudflareEd25519YaoTenantRootContextV2,
    pub(crate) work: crate::CloudflareEd25519YaoPairWorkV1,
    pub(crate) pair_digest: [u8; 32],
    pub(crate) execution_id: Ed25519YaoExecutionIdV1,
    /// When the Router's run ends: Deriver B waits for its own preparation
    /// until then.
    pub(crate) deadline_ms: u64,
}

pub(crate) struct DeriverAPairRoleExecutionV1 {
    pub(crate) deriver_a_execution: Ed25519YaoRoleExecutionV1,
    pub(crate) deriver_b_sealed_execution_json: String,
}

/// Why Deriver A's role did not finish.
pub(crate) enum DeriverAPairRoleFailureV1 {
    /// Deriver B answered that it holds no claim for the execution. Nothing
    /// was exchanged, so Deriver A's reservation can be released.
    PeerHoldsNoClaim(CloudflareEd25519YaoPairStartRefusalReasonV1),
    /// The execution failed, and Deriver B may have claimed it.
    Failed(RouterAbProtocolError),
}

impl From<RouterAbProtocolError> for DeriverAPairRoleFailureV1 {
    fn from(error: RouterAbProtocolError) -> Self {
        Self::Failed(error)
    }
}

pub async fn handle_cloudflare_ed25519_yao_deriver_b_prepare_pair_v1(
    mut request: Request,
    env: &Env,
) -> RouterAbProtocolResult<Response> {
    let trace_id = parse_cloudflare_trace_id_from_request_v1(&request)?;
    let request = parse_request::<CloudflareEd25519YaoPairPrepareRequestV1>(&mut request).await?;
    let expected_kind = input_kind_for_circuit(request.pair_binding.binding().circuit_family());
    request.validate_for_role(Ed25519YaoDeriverRoleV1::DeriverB, expected_kind)?;
    let scope = CloudflareDeriverBWalletPairScopeV1 {
        wallet_route: request.tenant_root.wallet_route,
        ownership_generation: request.tenant_root.ownership_generation,
        root_identity: request.tenant_root.identity.clone(),
        pair_binding: request.pair_binding.clone(),
    };
    let response = execute_deriver_b_role_session_command(
        env,
        &scope,
        DeriverBYaoSessionCommandV1::PreparePair {
            pair_binding: Box::new(request.pair_binding),
            tenant_root: Box::new(request.tenant_root),
            work: request.work,
            input: Box::new(request.input),
        },
        trace_id,
    )
    .await
    .map_err(preparation_command_error_v1)?;
    // The record decides a terminal answer. A burned pair can never run, a
    // session holding another pair conflicts, and an expired preparation
    // ends the ceremony's lifetime.
    json_response(&match response {
        DeriverBYaoSessionResponseV1::PairPrepared { .. } => {
            CloudflareEd25519YaoPairPreparationV1::Prepared
        }
        DeriverBYaoSessionResponseV1::PairRunning { .. } => {
            CloudflareEd25519YaoPairPreparationV1::Running
        }
        DeriverBYaoSessionResponseV1::PairCompleted { .. } => {
            CloudflareEd25519YaoPairPreparationV1::Completed
        }
        DeriverBYaoSessionResponseV1::PairExpired { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::PairPreparationExpired,
                "Deriver B pair preparation expired",
            ))
        }
        DeriverBYaoSessionResponseV1::PairConflict { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ConflictingPair,
                "Deriver B session holds another pair",
            ))
        }
        DeriverBYaoSessionResponseV1::PairBurned { .. } => {
            return Err(invalid_lifecycle("Deriver B pair is burned"))
        }
        _ => {
            return Err(invalid_lifecycle(
                "Deriver B pair preparation returned the wrong response",
            ))
        }
    })
}

/// A preparation that failed inside Deriver B's pair store is a service
/// failure, retryable like a failed Deriver A execution: nothing was claimed,
/// and the pair's stored state, not this error, ends a ceremony.
fn preparation_command_error_v1(error: RouterAbProtocolError) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        super::router_ab_peer_error_code_v1(error.message()),
        error.message(),
    )
}

pub async fn handle_cloudflare_ed25519_yao_deriver_b_read_pair_status_v1(
    mut request: Request,
    env: &Env,
) -> RouterAbProtocolResult<Response> {
    let trace_id = parse_cloudflare_trace_id_from_request_v1(&request)?;
    let scope = parse_request::<CloudflareDeriverBWalletPairScopeV1>(&mut request).await?;
    scope.validate()?;
    let response = execute_deriver_b_role_session_command(
        env,
        &scope,
        DeriverBYaoSessionCommandV1::ReadPairStatus {
            session: scope.pair_binding.session(),
            pair_digest: scope.pair_binding.pair_digest().bytes,
        },
        trace_id,
    )
    .await?;
    let status = match response {
        DeriverBYaoSessionResponseV1::PairPrepared {
            session,
            pair_digest,
        } => CloudflareEd25519YaoPairStatusResponseV1::Prepared {
            session,
            pair_digest,
        },
        DeriverBYaoSessionResponseV1::PairRunning {
            session,
            pair_digest,
        } => CloudflareEd25519YaoPairStatusResponseV1::Running {
            session,
            pair_digest,
        },
        DeriverBYaoSessionResponseV1::PairRoleExecution { execution } => {
            CloudflareEd25519YaoPairStatusResponseV1::Completed { execution }
        }
        DeriverBYaoSessionResponseV1::PairBurned {
            session,
            pair_digest,
        } => CloudflareEd25519YaoPairStatusResponseV1::Burned {
            session,
            pair_digest,
        },
        DeriverBYaoSessionResponseV1::PairExpired {
            session,
            pair_digest,
        } => CloudflareEd25519YaoPairStatusResponseV1::Expired {
            session,
            pair_digest,
        },
        DeriverBYaoSessionResponseV1::PairMissing {
            session,
            pair_digest,
        } => CloudflareEd25519YaoPairStatusResponseV1::Missing {
            session,
            pair_digest,
        },
        _ => {
            return Err(invalid_lifecycle(
                "Deriver B pair status response is malformed",
            ))
        }
    };
    json_response(&status)
}

pub async fn handle_cloudflare_ed25519_yao_deriver_b_burn_pair_v1(
    mut request: Request,
    env: &Env,
) -> RouterAbProtocolResult<Response> {
    let trace_id = parse_cloudflare_trace_id_from_request_v1(&request)?;
    let scope = parse_request::<CloudflareDeriverBWalletPairScopeV1>(&mut request).await?;
    scope.validate()?;
    let _ = execute_deriver_b_role_session_command(
        env,
        &scope,
        DeriverBYaoSessionCommandV1::FailPair {
            pair_binding: Box::new(scope.pair_binding.clone()),
        },
        trace_id,
    )
    .await?;
    let response = execute_deriver_b_role_session_command(
        env,
        &scope,
        DeriverBYaoSessionCommandV1::ReadPairStatus {
            session: scope.pair_binding.session(),
            pair_digest: scope.pair_binding.pair_digest().bytes,
        },
        trace_id,
    )
    .await?;
    let status = match response {
        DeriverBYaoSessionResponseV1::PairPrepared {
            session,
            pair_digest,
        } => CloudflareEd25519YaoPairStatusResponseV1::Prepared {
            session,
            pair_digest,
        },
        DeriverBYaoSessionResponseV1::PairRunning {
            session,
            pair_digest,
        } => CloudflareEd25519YaoPairStatusResponseV1::Running {
            session,
            pair_digest,
        },
        DeriverBYaoSessionResponseV1::PairRoleExecution { execution } => {
            CloudflareEd25519YaoPairStatusResponseV1::Completed { execution }
        }
        DeriverBYaoSessionResponseV1::PairBurned {
            session,
            pair_digest,
        } => CloudflareEd25519YaoPairStatusResponseV1::Burned {
            session,
            pair_digest,
        },
        DeriverBYaoSessionResponseV1::PairExpired {
            session,
            pair_digest,
        } => CloudflareEd25519YaoPairStatusResponseV1::Expired {
            session,
            pair_digest,
        },
        DeriverBYaoSessionResponseV1::PairMissing {
            session,
            pair_digest,
        } => CloudflareEd25519YaoPairStatusResponseV1::Missing {
            session,
            pair_digest,
        },
        _ => {
            return Err(invalid_lifecycle(
                "Deriver B pair burn response is malformed",
            ))
        }
    };
    json_response(&status)
}

fn validate_deriver_input(
    input: &Ed25519YaoEncryptedInputV1,
    expected_deriver: Ed25519YaoDeriverRoleV1,
    expected_kind: Ed25519YaoInputKindV1,
) -> RouterAbProtocolResult<()> {
    input.validate()?;
    if input.deriver() != expected_deriver {
        return Err(invalid_lifecycle(
            "Ed25519 Yao input was delivered to the wrong Deriver",
        ));
    }
    if input.kind() != expected_kind {
        return Err(invalid_lifecycle(
            "Ed25519 Yao input family does not match the route",
        ));
    }
    Ok(())
}

pub async fn handle_cloudflare_ed25519_yao_deriver_b_websocket_v1(
    request: Request,
    env: Env,
    runtime: CloudflareDeriverBWorkerRuntimeV1,
    context: Context,
) -> RouterAbProtocolResult<Response> {
    #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
    {
        let _ = (runtime, context);
        crate::durable_object::RouterAbDeriverBWalletDurableObject::forward_websocket(request, &env)
            .await
            .map_err(|error| invalid_lifecycle(error.to_string()))
    }
    #[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
    {
        execute_deriver_b_websocket(
            request,
            env,
            runtime,
            DeriverBExecutionHostV1::Worker(std::rc::Rc::new(context)),
        )
        .await
    }
}

mod deriver_b_host;
pub(crate) use deriver_b_host::DeriverBExecutionHostV1;

/// What Deriver A sent with its pair connection: where this role's pair
/// lives, the Router run A executes, and when that run ends.
pub(crate) fn deriver_b_pair_start_scope(
    request: &Request,
) -> RouterAbProtocolResult<CloudflareDeriverBPairStartScopeV1> {
    let serialized = request
        .headers()
        .get(WALLET_PAIR_SCOPE_HEADER)
        .map_err(|_| invalid_lifecycle("pair-bound WebSocket wallet scope could not be read"))?
        .ok_or_else(|| invalid_lifecycle("pair-bound WebSocket wallet scope is missing"))?;
    let start: CloudflareDeriverBPairStartScopeV1 = serde_json::from_str(&serialized)
        .map_err(|_| invalid_lifecycle("pair-bound WebSocket wallet scope is malformed"))?;
    start.scope.validate()?;
    start.outer_binding.validate()?;
    Ok(start)
}

pub(crate) async fn execute_deriver_b_websocket(
    request: Request,
    env: Env,
    runtime: CloudflareDeriverBWorkerRuntimeV1,
    execution_host: DeriverBExecutionHostV1,
) -> RouterAbProtocolResult<Response> {
    let trace_id = parse_cloudflare_trace_id_from_request_v1(&request)?;
    let protocol = request
        .headers()
        .get("Sec-WebSocket-Protocol")
        .map_err(|_| invalid_lifecycle("WebSocket protocol header could not be read"))?
        .ok_or_else(|| invalid_lifecycle("WebSocket protocol header is missing"))?;
    let binding = CloudflareEd25519YaoWebSocketBindingV1::parse_protocol(&protocol)
        .map_err(map_websocket_error)?;
    if binding.pair_digest.iter().all(|byte| *byte == 0) {
        return Err(invalid_lifecycle(
            "Deriver B WebSocket requires a pair-bound protocol",
        ));
    }
    handle_pair_bound_deriver_b_websocket(
        request,
        env,
        runtime,
        execution_host,
        trace_id,
        protocol,
        binding,
    )
    .await
}

async fn execute_deriver_b_role(
    env: &Env,
    runtime: &CloudflareDeriverBWorkerRuntimeV1,
    execution_host: &DeriverBExecutionHostV1,
    input: Ed25519YaoEncryptedInputV1,
    socket: worker::WebSocket,
    trace_id: RoleTraceContextV1,
    expected_root_metadata_digest: [u8; 32],
    pair_digest: [u8; 32],
    pair_binding: Ed25519YaoInputPairBindingV1,
    tenant_root: crate::CloudflareEd25519YaoTenantRootContextV2,
    work: crate::CloudflareEd25519YaoPairWorkV1,
    prepared_start: Option<crate::registration_pair_connection::Start>,
) -> RouterAbProtocolResult<()> {
    let scope = CloudflareDeriverBWalletPairScopeV1 {
        wallet_route: tenant_root.wallet_route,
        ownership_generation: tenant_root.ownership_generation,
        root_identity: tenant_root.identity.clone(),
        pair_binding: pair_binding.clone(),
    };
    let private_key_started_at_ms = role_span_started_at_ms();
    let private_key_result =
        load_deriver_input_private_key(env, &runtime.envelope_decrypt_key().current.binding_name);
    emit_role_stage_result_v1(
        trace_id,
        "deriver_b.input_private_key",
        "yao",
        private_key_started_at_ms,
        &private_key_result,
    );
    let private_key = private_key_result?;
    let session = input.session();
    let transport_started_at_ms = role_span_started_at_ms();
    let transport_result = CloudflareEd25519YaoWebSocketTransportV1::deriver_b(&socket, session)
        .map_err(map_websocket_error);
    emit_role_stage_result_v1(
        trace_id,
        "deriver_b.transport",
        "yao",
        transport_started_at_ms,
        &transport_result,
    );
    let mut transport = transport_result?;
    #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
    let pair_object = Some(scope.wallet_route.addresses.deriver_b.as_str().to_owned());
    #[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
    let pair_object = None;
    let (custody_binding, role_share, stable_context, root_metadata_digest) =
        load_ed25519_yao_tenant_root_role_share_v2(
            env,
            CloudflareWorkerRoleV1::DeriverB,
            &tenant_root,
            &pair_binding,
            pair_object,
            execution_host.root_use_access(&tenant_root, &pair_binding)?,
        )
        .await?
        .map_err(crate::tenant_root_role_runtime::AttemptConflictV1::into_error)?;
    execution_host.require_unfenced(&pair_binding.session())?;
    validate_expected_root_metadata_digest(expected_root_metadata_digest, root_metadata_digest)?;
    if let Some(start) = prepared_start {
        let acknowledgement = crate::registration_pair_connection::Reply::Started {
            session: start.scope.scope.pair_binding.session(),
            pair_digest: start.scope.scope.pair_binding.pair_digest().bytes,
            execution_id: start.execution_id,
        };
        socket
            .send_with_str(
                &serde_json::to_string(&acknowledgement)
                    .map_err(|_| invalid_lifecycle("Peer start could not be encoded"))?,
            )
            .map_err(|_| invalid_lifecycle("Peer start could not be acknowledged"))?;
    }

    let preface = prepare_cloudflare_ed25519_yao_deriver_b_target_v2(
        role_share,
        &custody_binding,
        tenant_root.outer_binding.clone(),
        &stable_context,
    )?;
    let outbound = seal_deriver_b_target_proof_v2(
        env,
        &tenant_root.outer_binding,
        preface.outbound_plaintext(),
    )?;
    let incoming = transport
        .exchange_deriver_b_target_proof_preface_v2(&outbound)
        .await
        .map_err(map_websocket_error)?;
    let incoming_plaintext = open_deriver_b_target_proof_v2(
        env,
        &runtime.envelope_decrypt_key().current.binding_name,
        &incoming,
    )?;
    let server_contribution = complete_cloudflare_ed25519_yao_deriver_b_target_v2(
        preface,
        &incoming,
        &incoming_plaintext,
        &tenant_root.outer_binding,
        &stable_context,
    )?;
    let (execution, transport) = match input.kind() {
        Ed25519YaoInputKindV1::Activation => {
            let role_request =
                open_ed25519_yao_activation_deriver_b_input_v1(&input, &private_key)?;
            let recipients = role_request.recipients;
            let (binding, role) = build_product_activation_deriver_b_with_server_v1(
                role_request,
                server_contribution,
            )
            .map_err(map_adapter)?;
            let protocol_started_at_ms =
                begin_role_protocol_v1(trace_id, "deriver_b", "activation");
            let completion_result =
                with_yao_ceremony_timeout(run_activation_deriver_b_open(role, transport)).await;
            emit_role_span_v1(
                trace_id,
                "deriver_b.yao_protocol",
                "deriver_b",
                "activation",
                protocol_started_at_ms,
                if completion_result.is_ok() {
                    "success"
                } else {
                    "failure"
                },
            );
            let completion = completion_result?;
            (
                seal_ed25519_yao_activation_deriver_b_execution_v1(
                    &mut CloudflareHpkeGetrandomRngV1,
                    binding,
                    recipients,
                    &completion.role,
                )?,
                completion.transport,
            )
        }
        Ed25519YaoInputKindV1::Export => {
            let role_request = open_ed25519_yao_export_deriver_b_input_v1(&input, &private_key)?;
            let recipient = role_request.recipients;
            let (binding, role) =
                build_product_export_deriver_b_with_server_v1(role_request, server_contribution)
                    .map_err(map_adapter)?;
            let protocol_started_at_ms = begin_role_protocol_v1(trace_id, "deriver_b", "export");
            let completion_result =
                with_yao_ceremony_timeout(run_export_deriver_b_open(role, transport)).await;
            emit_role_span_v1(
                trace_id,
                "deriver_b.yao_protocol",
                "deriver_b",
                "export",
                protocol_started_at_ms,
                if completion_result.is_ok() {
                    "success"
                } else {
                    "failure"
                },
            );
            let completion = completion_result?;
            (
                seal_ed25519_yao_export_deriver_b_execution_v1(
                    &mut CloudflareHpkeGetrandomRngV1,
                    binding,
                    recipient,
                    &completion.role,
                )?,
                completion.transport,
            )
        }
        Ed25519YaoInputKindV1::LaneMaterialization => {
            let crate::CloudflareEd25519YaoPairWorkV1::Lane { job: expected_job } = &work else {
                return Err(invalid_lifecycle(
                    "Deriver B lane input is missing its admitted job",
                ));
            };
            let input_open_started_at_ms = role_span_started_at_ms();
            let role_request_result =
                open_ed25519_yao_lane_deriver_b_input_v1(&input, expected_job, &private_key);
            emit_role_stage_result_v1(
                trace_id,
                "deriver_b.input_open",
                "lane_materialization",
                input_open_started_at_ms,
                &role_request_result,
            );
            let role_request = role_request_result?;
            let role_build_started_at_ms = role_span_started_at_ms();
            let role_build_result = build_product_lane_deriver_b_with_server_v1(
                role_request,
                server_contribution,
                &mut CloudflareHpkeGetrandomRngV1,
            );
            match &role_build_result {
                Ok(_) => emit_role_span_v1(
                    trace_id,
                    "deriver_b.role_build",
                    "deriver_b",
                    "lane_materialization",
                    role_build_started_at_ms,
                    "success",
                ),
                Err(error) => emit_role_adapter_error_v1(
                    trace_id,
                    "deriver_b.role_build",
                    "lane_materialization",
                    role_build_started_at_ms,
                    *error,
                ),
            }
            let role_build_result = role_build_result.map_err(map_adapter);
            let (binding, job, role) = role_build_result?;
            let session_check_result = if binding.session_id.into_bytes() == session {
                Ok(())
            } else {
                Err(invalid_lifecycle(
                    "Deriver B lane input does not match the pair session",
                ))
            };
            emit_role_stage_result_v1(
                trace_id,
                "deriver_b.session_check",
                "lane_materialization",
                role_build_started_at_ms,
                &session_check_result,
            );
            session_check_result?;
            let protocol_started_at_ms =
                begin_role_protocol_v1(trace_id, "deriver_b", "lane_materialization");
            let completion_result =
                with_yao_ceremony_timeout(run_lane_materialization_deriver_b_open(role, transport))
                    .await;
            emit_role_span_v1(
                trace_id,
                "deriver_b.yao_protocol",
                "deriver_b",
                "lane_materialization",
                protocol_started_at_ms,
                if completion_result.is_ok() {
                    "success"
                } else {
                    "failure"
                },
            );
            let completion = completion_result?;
            let seal_started_at_ms = role_span_started_at_ms();
            let sealed_result = seal_ed25519_yao_lane_deriver_b_execution_v1(
                &mut CloudflareHpkeGetrandomRngV1,
                job,
                &completion.role,
            );
            emit_role_stage_result_v1(
                trace_id,
                "deriver_b.output_seal",
                "lane_materialization",
                seal_started_at_ms,
                &sealed_result,
            );
            (
                Ed25519YaoRoleExecutionV1::Lane(sealed_result?),
                completion.transport,
            )
        }
    };
    let serialization_started_at_ms = role_span_started_at_ms();
    let serialized_execution = serde_json::to_vec(&execution)
        .map_err(|_| invalid_lifecycle("Deriver B sealed execution could not be serialized"))?;
    emit_role_span_v1(
        trace_id,
        "deriver_b.output_serialization",
        "deriver_b",
        "yao",
        serialization_started_at_ms,
        "success",
    );
    #[cfg(feature = "wallet-do-b-completion-harness")]
    if let Ok(flag) = env.var("R150_TEST_B_BURN_BEFORE_COMPLETE") {
        if flag.to_string() == "enabled" {
            let burn_status = execution_host
                .command(
                    env,
                    &scope,
                    DeriverBYaoSessionCommandV1::FailPair {
                        pair_binding: Box::new(scope.pair_binding.clone()),
                    },
                    trace_id,
                )
                .await?;
            if !matches!(
                burn_status,
                DeriverBYaoSessionResponseV1::PairBurned {
                    session: stored_session,
                    pair_digest: stored_pair,
                } if stored_session == session && stored_pair == pair_digest
            ) {
                return Err(invalid_lifecycle(
                    "Deriver B race harness did not burn pair",
                ));
            }
        }
    }
    let completion_status = execution_host
        .command(
            env,
            &scope,
            DeriverBYaoSessionCommandV1::CompletePair {
                pair_digest,
                execution: Box::new(execution),
            },
            trace_id,
        )
        .await?;
    if !matches!(
        completion_status,
        DeriverBYaoSessionResponseV1::PairCompleted {
            session: stored_session,
            pair_digest: stored_pair,
        } if stored_session == session && stored_pair == pair_digest
    ) {
        return Err(invalid_lifecycle(
            "Deriver B pair completion was not persisted",
        ));
    }
    transport
        .finish_with_local_sealed_completion(&serialized_execution)
        .await
        .map_err(map_websocket_error)?;
    Ok(())
}

#[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
async fn execute_deriver_b_session_command(
    env: &Env,
    command: DeriverBYaoSessionCommandV1,
    trace_id: RoleTraceContextV1,
) -> RouterAbProtocolResult<DeriverBYaoSessionResponseV1> {
    command.validate()?;
    let operation = command.operation();
    let started_at_ms = role_span_started_at_ms();
    let response_result = DeriverBYaoSessionD1V1::new(env.clone())
        .execute(command)
        .await
        .map_err(|error| pair_command_error_v1("Deriver B Yao session D1 command failed", error));
    let mut response = match response_result {
        Ok(response) => response,
        Err(error) => {
            emit_role_span_v1(
                trace_id,
                "deriver_b.session_d1",
                "deriver_b",
                operation,
                started_at_ms,
                "failure",
            );
            return Err(error);
        }
    };
    if !(200..=299).contains(&response.status_code()) {
        let status = response.status_code();
        emit_role_span_v1(
            trace_id,
            "deriver_b.session_d1",
            "deriver_b",
            operation,
            started_at_ms,
            "failure",
        );
        let message = response
            .text()
            .await
            .unwrap_or_else(|_| "response body unavailable".to_owned());
        return Err(invalid_lifecycle(format!(
            "Deriver B Yao session D1 command was rejected with HTTP {status}: {message}"
        )));
    }
    let result = response
        .json::<DeriverBYaoSessionResponseV1>()
        .await
        .map_err(|_| invalid_lifecycle("Deriver B Yao session response is malformed"));
    emit_role_span_v1(
        trace_id,
        "deriver_b.session_d1",
        "deriver_b",
        operation,
        started_at_ms,
        if result.is_ok() { "success" } else { "failure" },
    );
    result
}

async fn execute_deriver_b_role_session_command(
    env: &Env,
    scope: &CloudflareDeriverBWalletPairScopeV1,
    command: DeriverBYaoSessionCommandV1,
    trace_id: RoleTraceContextV1,
) -> RouterAbProtocolResult<DeriverBYaoSessionResponseV1> {
    #[cfg(not(feature = "strict-worker-deriver-b-entrypoint"))]
    {
        let _ = scope;
        execute_deriver_b_session_command(env, command, trace_id).await
    }
    #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
    {
        command.validate()?;
        scope.validate()?;
        let operation = command.operation();
        let started_at_ms = role_span_started_at_ms();
        let mut response = crate::durable_object::call_deriver_b_wallet_do_v1(
            env,
            crate::durable_object::DeriverBWalletDoRequestV1 {
                scope: scope.clone(),
                command,
            },
        )
        .await
        .map_err(|error| pair_command_error_v1("Deriver B wallet pair command failed", error))?;
        if !(200..=299).contains(&response.status_code()) {
            let status = response.status_code();
            emit_role_span_v1(
                trace_id,
                "deriver_b.session_do",
                "deriver_b",
                operation,
                started_at_ms,
                "failure",
            );
            let message = response.text().await.unwrap_or_default();
            return Err(invalid_lifecycle(format!(
                "Deriver B wallet pair command rejected with HTTP {status}: {message}"
            )));
        }
        let result = response
            .json::<DeriverBYaoSessionResponseV1>()
            .await
            .map_err(|_| invalid_lifecycle("Deriver B wallet pair response is malformed"));
        emit_role_span_v1(
            trace_id,
            "deriver_b.session_do",
            "deriver_b",
            operation,
            started_at_ms,
            if result.is_ok() { "success" } else { "failure" },
        );
        if matches!(
            result,
            Ok(DeriverBYaoSessionResponseV1::PairCompleted { .. })
        ) {
            settle_deriver_b_wallet_admission(env, scope).await;
        }
        result
    }
}

#[cfg(feature = "strict-worker-deriver-b-entrypoint")]
async fn settle_deriver_b_wallet_admission(env: &Env, scope: &CloudflareDeriverBWalletPairScopeV1) {
    // A failed acknowledgement leaves admission unsettled for retirement reconciliation.
    let settled = role_d1::settle_wallet_object_admission_v1(
        env,
        "deriver_b",
        &role_d1::encode_hex_slice(&scope.pair_binding.session()),
        scope.wallet_route.addresses.deriver_b.as_str(),
    )
    .await;
    if let Err(error) = settled {
        worker::console_error!(
            "Deriver B pair completed, but its admission settlement was not acknowledged: {error}"
        );
    }
}

/// A pair command's failure. A tenant-root lifecycle transition keeps its
/// retryable code across the pair store's error boundary; any other failure
/// is the pair's lifecycle failure.
fn pair_command_error_v1(label: &str, error: impl std::fmt::Display) -> RouterAbProtocolError {
    let detail = error.to_string();
    if super::router_ab_peer_error_code_v1(&detail)
        == RouterAbProtocolErrorCode::LifecycleTransitionInProgress
    {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
            format!("{label}: {detail}"),
        )
    } else {
        invalid_lifecycle(format!("{label}: {detail}"))
    }
}

/// Prepares the V2 role-target preface from the authenticated Deriver A share.
///
/// The returned state owns only A's local threshold-PRF partial. Its outbound
/// plaintext is the fixed B-target proof exposed by
/// [`Ed25519YaoDeriverAPrefaceInFlightV2::outbound_plaintext`].
pub(crate) fn prepare_cloudflare_ed25519_yao_deriver_a_target_v2(
    role_share: VerifiedTenantRootOnlineRoleShareV1,
    custody_binding: &TenantRootCustodyBindingV1,
    outer_binding: Ed25519YaoOuterBindingV2,
    stable_context: &Ed25519YaoStableKeyDerivationContextV1,
) -> RouterAbProtocolResult<Ed25519YaoDeriverAPrefaceInFlightV2> {
    validate_cloudflare_ed25519_yao_v2_binding(&outer_binding, custody_binding, stable_context)?;
    let (role_binding, share_wire) = role_share.into_parts();
    validate_cloudflare_ed25519_yao_v2_role_share(
        &role_binding,
        custody_binding,
        TwoPartyDeriverRole::DeriverA,
    )?;
    let share = share_wire
        .to_share()
        .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    let expected_peer_commitment = SigningRootShareCommitment::from_slice(
        custody_binding.commitments().deriver_b().as_bytes(),
    )
    .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    let stable_context_bytes = stable_context.encode();
    let mut rng = crate::CloudflareSignerProofGetrandomRngV1;
    let (prepared, outbound) = prepare_ed25519_deriver_a_target_v1(
        &share,
        expected_peer_commitment,
        &stable_context_bytes,
        &mut rng,
    )
    .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    Ed25519YaoDeriverAPrefaceInFlightV2::new(outer_binding, prepared, outbound)
}

/// Completes the V2 Deriver A preface and feeds its target root into the
/// unchanged role-local contribution KDF.
pub(crate) fn complete_cloudflare_ed25519_yao_deriver_a_target_v2(
    preface: Ed25519YaoDeriverAPrefaceInFlightV2,
    incoming: &Ed25519YaoDeriverBToATargetProofPayloadV2,
    incoming_plaintext: &[u8],
    expected_outer_binding: &Ed25519YaoOuterBindingV2,
    stable_context: &Ed25519YaoStableKeyDerivationContextV1,
) -> RouterAbProtocolResult<Ed25519YaoDeriverAServerContributionV1> {
    let ready = preface
        .complete(incoming, incoming_plaintext)
        .map_err(|error| invalid_lifecycle(error.message()))?;
    if ready.binding() != expected_outer_binding
        || stable_context.binding_digest() != ready.binding().stable_context_binding().into_bytes()
    {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 Deriver A completion binding does not match the stable context",
        ));
    }
    let target_root = ready.into_threshold_prf_root().into_secret_bytes();
    derive_ed25519_yao_deriver_a_server_contribution_v1(
        &Ed25519YaoDeriverADerivationRootV1::from_secret_bytes(*target_root),
        stable_context,
    )
    .map_err(|error| {
        invalid_lifecycle(format!(
            "Ed25519 Yao Deriver A contribution failed: {error}"
        ))
    })
}

/// Prepares the V2 role-target preface from the authenticated Deriver B share.
///
/// The returned state owns only B's local threshold-PRF partial. Its outbound
/// plaintext is the fixed A-target proof exposed by
/// [`Ed25519YaoDeriverBPrefaceInFlightV2::outbound_plaintext`].
pub(crate) fn prepare_cloudflare_ed25519_yao_deriver_b_target_v2(
    role_share: VerifiedTenantRootOnlineRoleShareV1,
    custody_binding: &TenantRootCustodyBindingV1,
    outer_binding: Ed25519YaoOuterBindingV2,
    stable_context: &Ed25519YaoStableKeyDerivationContextV1,
) -> RouterAbProtocolResult<Ed25519YaoDeriverBPrefaceInFlightV2> {
    validate_cloudflare_ed25519_yao_v2_binding(&outer_binding, custody_binding, stable_context)?;
    let (role_binding, share_wire) = role_share.into_parts();
    validate_cloudflare_ed25519_yao_v2_role_share(
        &role_binding,
        custody_binding,
        TwoPartyDeriverRole::DeriverB,
    )?;
    let share = share_wire
        .to_share()
        .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    let expected_peer_commitment = SigningRootShareCommitment::from_slice(
        custody_binding.commitments().deriver_a().as_bytes(),
    )
    .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    let stable_context_bytes = stable_context.encode();
    let mut rng = crate::CloudflareSignerProofGetrandomRngV1;
    let (prepared, outbound) = prepare_ed25519_deriver_b_target_v1(
        &share,
        expected_peer_commitment,
        &stable_context_bytes,
        &mut rng,
    )
    .map_err(map_cloudflare_ed25519_yao_v2_threshold_error)?;
    Ed25519YaoDeriverBPrefaceInFlightV2::new(outer_binding, prepared, outbound)
}

/// Completes the V2 Deriver B preface and feeds its target root into the
/// unchanged role-local contribution KDF.
pub(crate) fn complete_cloudflare_ed25519_yao_deriver_b_target_v2(
    preface: Ed25519YaoDeriverBPrefaceInFlightV2,
    incoming: &Ed25519YaoDeriverAToBTargetProofPayloadV2,
    incoming_plaintext: &[u8],
    expected_outer_binding: &Ed25519YaoOuterBindingV2,
    stable_context: &Ed25519YaoStableKeyDerivationContextV1,
) -> RouterAbProtocolResult<Ed25519YaoDeriverBServerContributionV1> {
    let ready = preface
        .complete(incoming, incoming_plaintext)
        .map_err(|error| invalid_lifecycle(error.message()))?;
    if ready.binding() != expected_outer_binding
        || stable_context.binding_digest() != ready.binding().stable_context_binding().into_bytes()
    {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 Deriver B completion binding does not match the stable context",
        ));
    }
    let target_root = ready.into_threshold_prf_root().into_secret_bytes();
    derive_ed25519_yao_deriver_b_server_contribution_v1(
        &Ed25519YaoDeriverBDerivationRootV1::from_secret_bytes(*target_root),
        stable_context,
    )
    .map_err(|error| {
        invalid_lifecycle(format!(
            "Ed25519 Yao Deriver B contribution failed: {error}"
        ))
    })
}

fn validate_cloudflare_ed25519_yao_v2_binding(
    outer_binding: &Ed25519YaoOuterBindingV2,
    custody_binding: &TenantRootCustodyBindingV1,
    stable_context: &Ed25519YaoStableKeyDerivationContextV1,
) -> RouterAbProtocolResult<()> {
    outer_binding
        .validate_at(
            cloudflare_yao_now_unix_ms().map_err(|_| {
                invalid_lifecycle("Ed25519 Yao V2 outer binding clock is unavailable")
            })?,
        )
        .map_err(|error| invalid_lifecycle(error.message()))?;
    custody_binding
        .validate()
        .map_err(|error| invalid_lifecycle(error.message()))?;
    if stable_context.binding_digest() != outer_binding.stable_context_binding().into_bytes() {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 outer binding does not match the stable context",
        ));
    }
    let custody_digest = custody_binding
        .digest()
        .map_err(|error| invalid_lifecycle(error.message()))?;
    if outer_binding.custody_binding_digest() != PublicDigest32::new(custody_digest.into_bytes()) {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 outer binding does not match the custody binding",
        ));
    }
    Ok(())
}

fn validate_cloudflare_ed25519_yao_v2_role_share(
    role_binding: &router_ab_core::TenantRootOnlineRoleShareBindingV1,
    custody_binding: &TenantRootCustodyBindingV1,
    role: TwoPartyDeriverRole,
) -> RouterAbProtocolResult<()> {
    if role_binding.role() != role
        || role_binding.identity_digest() != custody_binding.identity_digest()
        || role_binding.custody_lineage() != custody_binding.custody_lineage()
        || role_binding.epoch() != custody_binding.epoch()
    {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 role share does not match the custody binding",
        ));
    }
    let expected_commitment = match role {
        TwoPartyDeriverRole::DeriverA => custody_binding.commitments().deriver_a(),
        TwoPartyDeriverRole::DeriverB => custody_binding.commitments().deriver_b(),
    };
    if role_binding.share_commitment() != expected_commitment {
        return Err(invalid_lifecycle(
            "Ed25519 Yao V2 role share commitment does not match the custody binding",
        ));
    }
    Ok(())
}

fn map_cloudflare_ed25519_yao_v2_threshold_error(
    error: threshold_prf::ThresholdPrfError,
) -> RouterAbProtocolError {
    invalid_lifecycle(format!("Ed25519 Yao V2 target proof failed: {error}"))
}

fn validate_expected_root_metadata_digest(
    expected: [u8; 32],
    actual: [u8; 32],
) -> RouterAbProtocolResult<()> {
    if expected != actual {
        return Err(invalid_lifecycle(
            "root-share metadata changed after pair preparation",
        ));
    }
    Ok(())
}

fn seal_ed25519_yao_target_proof_v2(
    env: &Env,
    recipient: Ed25519YaoDeriverRoleV1,
    aad: &[u8],
    plaintext: &[u8],
) -> RouterAbProtocolResult<([u8; 32], Vec<u8>)> {
    let public_keys = parse_cloudflare_signer_envelope_hpke_public_key_set_v1(
        &CloudflareWorkerEnvReaderV1::new(env),
    )?;
    let public_key = match recipient {
        Ed25519YaoDeriverRoleV1::DeriverA => &public_keys.deriver_a.public_key,
        Ed25519YaoDeriverRoleV1::DeriverB => &public_keys.deriver_b.public_key,
    };
    let public_key = parse_cloudflare_hpke_x25519_public_key_v1(public_key)?;
    let (encapsulated_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
        &mut CloudflareHpkeGetrandomRngV1,
        &public_key,
        ED25519_YAO_TARGET_PROOF_HPKE_INFO_V2,
        aad,
        plaintext,
    )
    .map_err(|_| invalid_lifecycle("Ed25519 Yao target proof encryption failed"))?;
    let encapsulated_key = encapsulated_key
        .as_ref()
        .try_into()
        .map_err(|_| invalid_lifecycle("Ed25519 Yao target proof key has invalid length"))?;
    Ok((encapsulated_key, ciphertext))
}

fn open_ed25519_yao_target_proof_v2(
    env: &Env,
    private_key_binding: &str,
    encapsulated_key: &[u8; 32],
    ciphertext: &[u8],
    aad: &[u8],
) -> RouterAbProtocolResult<Zeroizing<Vec<u8>>> {
    let secret = env
        .secret(private_key_binding)
        .map_err(|_| invalid_lifecycle("Deriver target-proof HPKE secret binding is missing"))?;
    let mut encoded = secret.to_string();
    let mut private_key_bytes =
        decode_cloudflare_signer_envelope_hpke_private_key_secret_v1(&encoded)?;
    encoded.zeroize();
    let private_key = CloudflareHpkeKemV1::sk_from_bytes(&private_key_bytes)
        .map_err(|_| invalid_lifecycle("Deriver target-proof HPKE private key is invalid"))?;
    private_key_bytes.zeroize();
    let encapsulated_key = CloudflareHpkeKemV1::enc_from_bytes(encapsulated_key)
        .map_err(|_| invalid_lifecycle("Ed25519 Yao target proof key is invalid"))?;
    CloudflareHpkeSuiteV1::open_base(
        &encapsulated_key,
        &private_key,
        ED25519_YAO_TARGET_PROOF_HPKE_INFO_V2,
        aad,
        ciphertext,
    )
    .map(Zeroizing::new)
    .map_err(|_| invalid_lifecycle("Ed25519 Yao target proof decryption failed"))
}

fn seal_deriver_a_target_proof_v2(
    env: &Env,
    binding: &Ed25519YaoOuterBindingV2,
    plaintext: &[u8],
) -> RouterAbProtocolResult<Ed25519YaoDeriverAToBTargetProofPayloadV2> {
    let aad = Ed25519YaoDeriverAToBTargetProofPayloadV2::aad_for_binding(binding)?;
    let (encapsulated_key, ciphertext) =
        seal_ed25519_yao_target_proof_v2(env, Ed25519YaoDeriverRoleV1::DeriverB, &aad, plaintext)?;
    Ed25519YaoDeriverAToBTargetProofPayloadV2::new(binding.clone(), encapsulated_key, ciphertext)
}

fn open_deriver_a_target_proof_v2(
    env: &Env,
    private_key_binding: &str,
    payload: &Ed25519YaoDeriverBToATargetProofPayloadV2,
) -> RouterAbProtocolResult<Zeroizing<Vec<u8>>> {
    let aad = Ed25519YaoDeriverBToATargetProofPayloadV2::aad_for_binding(payload.binding())?;
    open_ed25519_yao_target_proof_v2(
        env,
        private_key_binding,
        payload.encapsulated_key(),
        payload.ciphertext(),
        &aad,
    )
}

fn seal_deriver_b_target_proof_v2(
    env: &Env,
    binding: &Ed25519YaoOuterBindingV2,
    plaintext: &[u8],
) -> RouterAbProtocolResult<Ed25519YaoDeriverBToATargetProofPayloadV2> {
    let aad = Ed25519YaoDeriverBToATargetProofPayloadV2::aad_for_binding(binding)?;
    let (encapsulated_key, ciphertext) =
        seal_ed25519_yao_target_proof_v2(env, Ed25519YaoDeriverRoleV1::DeriverA, &aad, plaintext)?;
    Ed25519YaoDeriverBToATargetProofPayloadV2::new(binding.clone(), encapsulated_key, ciphertext)
}

fn open_deriver_b_target_proof_v2(
    env: &Env,
    private_key_binding: &str,
    payload: &Ed25519YaoDeriverAToBTargetProofPayloadV2,
) -> RouterAbProtocolResult<Zeroizing<Vec<u8>>> {
    let aad = Ed25519YaoDeriverAToBTargetProofPayloadV2::aad_for_binding(payload.binding())?;
    open_ed25519_yao_target_proof_v2(
        env,
        private_key_binding,
        payload.encapsulated_key(),
        payload.ciphertext(),
        &aad,
    )
}

fn load_deriver_input_private_key(
    env: &Env,
    binding_name: &str,
) -> RouterAbProtocolResult<Ed25519YaoRecipientPrivateKeyV1> {
    let secret = env
        .secret(binding_name)
        .map_err(|_| invalid_lifecycle("Deriver input HPKE secret binding is missing"))?;
    let mut encoded = secret.to_string();
    let result = decode_cloudflare_signer_envelope_hpke_private_key_secret_v1(&encoded)
        .map(Ed25519YaoRecipientPrivateKeyV1::from_bytes);
    encoded.zeroize();
    result
}

fn circuit_for_input(input: &Ed25519YaoEncryptedInputV1) -> CloudflareEd25519YaoCircuitV1 {
    match input.kind() {
        Ed25519YaoInputKindV1::Activation => CloudflareEd25519YaoCircuitV1::Activation,
        Ed25519YaoInputKindV1::Export => CloudflareEd25519YaoCircuitV1::Export,
        Ed25519YaoInputKindV1::LaneMaterialization => {
            CloudflareEd25519YaoCircuitV1::LaneMaterialization
        }
    }
}

pub(crate) fn input_kind_for_circuit(family: Ed25519YaoCircuitFamilyV1) -> Ed25519YaoInputKindV1 {
    match family {
        Ed25519YaoCircuitFamilyV1::Activation => Ed25519YaoInputKindV1::Activation,
        Ed25519YaoCircuitFamilyV1::Export => Ed25519YaoInputKindV1::Export,
        Ed25519YaoCircuitFamilyV1::LaneMaterialization => {
            Ed25519YaoInputKindV1::LaneMaterialization
        }
    }
}

async fn parse_request<T>(request: &mut Request) -> RouterAbProtocolResult<T>
where
    T: serde::de::DeserializeOwned,
{
    request
        .json::<T>()
        .await
        .map_err(|_| invalid_lifecycle("Ed25519 Yao request JSON is malformed"))
}

fn json_response<T>(value: &T) -> RouterAbProtocolResult<Response>
where
    T: Serialize,
{
    Response::from_json(value)
        .map_err(|_| invalid_lifecycle("Ed25519 Yao response JSON could not be encoded"))
}

fn map_adapter(error: router_ab_ed25519_yao::AdapterError) -> RouterAbProtocolError {
    invalid_lifecycle(format!("Ed25519 Yao role construction failed: {error}"))
}

fn adapter_error_code_v1(error: AdapterError) -> &'static str {
    match error {
        AdapterError::InvalidDerivationContext => "invalid_derivation_context",
        AdapterError::CircuitFamilyMismatch => "circuit_family_mismatch",
        AdapterError::RoleProtocol => "role_protocol",
        AdapterError::LifecycleContributionMismatch => "lifecycle_contribution_mismatch",
        AdapterError::ServerContributionDerivation => "server_contribution_derivation",
    }
}

async fn with_yao_ceremony_timeout<T, E, F>(future: F) -> RouterAbProtocolResult<T>
where
    E: fmt::Display,
    F: Future<Output = Result<T, E>>,
{
    let execution = Box::pin(future);
    let timeout = Box::pin(Delay::from(YAO_CEREMONY_TIMEOUT));
    match select(execution, timeout).await {
        Either::Left((result, _)) => result.map_err(|error| {
            invalid_lifecycle(format!("Ed25519 Yao role execution failed: {error}"))
        }),
        Either::Right(_) => Err(invalid_lifecycle("Ed25519 Yao ceremony timed out")),
    }
}

fn map_websocket_error(_: crate::CloudflareEd25519YaoWebSocketErrorV1) -> RouterAbProtocolError {
    invalid_lifecycle("Ed25519 Yao Service Binding WebSocket failed")
}

pub(crate) fn invalid_lifecycle(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLifecycleState,
        message.into(),
    )
}

fn cloudflare_yao_now_unix_ms() -> worker::Result<u64> {
    crate::cloudflare_now_unix_ms_v1()
        .map_err(|error| worker::Error::RustError(error.message().to_owned()))
}

fn yao_expiry_from_now(now_unix_ms: u64, lifetime_ms: u64) -> worker::Result<u64> {
    now_unix_ms
        .checked_add(lifetime_ms)
        .ok_or_else(|| worker::Error::RustError("Yao session expiry overflowed".into()))
}

fn decode_hex_32(value: &str) -> RouterAbProtocolResult<[u8; 32]> {
    if value.len() != 64 {
        return Err(invalid_lifecycle("execution id header must be 32-byte hex"));
    }
    let mut bytes = [0_u8; 32];
    for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = decode_hex_nibble(chunk[0])?;
        let low = decode_hex_nibble(chunk[1])?;
        bytes[index] = (high << 4) | low;
    }
    Ok(bytes)
}

fn decode_hex_nibble(byte: u8) -> RouterAbProtocolResult<u8> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(invalid_lifecycle("execution id header must be hex")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CloudflareEd25519YaoRoleFailureResponseV1;
    use router_ab_core::{
        Ed25519YaoCeremonyBindingV1, Ed25519YaoEncryptedPackageV1, Ed25519YaoInputPairBindingV1,
        Ed25519YaoOperationV1, Ed25519YaoPackageKindV1, Ed25519YaoSessionIdV1,
        Ed25519YaoStableKeyContextBindingV1, ExpensiveWorkKindV1, LifecycleScopeV1,
        MpcMaterialActivationRefV1, PublicDigest32, RootShareEpoch,
        RouterEd25519YaoExecuteFailureCodeV1,
    };
    use router_ab_ed25519_yao::Ed25519YaoActivationRoleExecutionV1;

    fn encrypted_input(ciphertext_byte: u8) -> Ed25519YaoEncryptedInputV1 {
        Ed25519YaoEncryptedInputV1::new(
            Ed25519YaoInputKindV1::Activation,
            Ed25519YaoDeriverRoleV1::DeriverB,
            Ed25519YaoOperationV1::Registration,
            [1; 32],
            [2; 32],
            [3; 32],
            vec![ciphertext_byte; 16],
        )
        .expect("test input is valid")
    }

    fn pair_for_completion() -> (Ed25519YaoInputPairBindingV1, Ed25519YaoEncryptedInputV1) {
        let input_b = encrypted_input(4);
        let input_a = Ed25519YaoEncryptedInputV1::new(
            Ed25519YaoInputKindV1::Activation,
            Ed25519YaoDeriverRoleV1::DeriverA,
            Ed25519YaoOperationV1::Registration,
            [1; 32],
            [2; 32],
            [3; 32],
            vec![5; 16],
        )
        .expect("Deriver A input");
        let lifecycle = LifecycleScopeV1::new(
            "completion-test",
            ExpensiveWorkKindV1::RegistrationPrepare,
            RootShareEpoch::new("epoch").expect("epoch"),
            "account",
            "session",
            "signer-set",
            "server",
        )
        .expect("lifecycle");
        let binding = Ed25519YaoCeremonyBindingV1::new(
            lifecycle,
            Ed25519YaoOperationV1::Registration,
            Ed25519YaoSessionIdV1::new([1; 32]).expect("session"),
            Ed25519YaoStableKeyContextBindingV1::new([2; 32]),
            MpcMaterialActivationRefV1::new(
                "activation",
                "near-ed25519-yao",
                "account",
                "key-binding",
                "lifecycle-binding",
                "server",
            )
            .expect("material activation"),
        )
        .expect("binding");
        let pair = Ed25519YaoInputPairBindingV1::from_ceremony_binding(
            binding,
            &input_a,
            &input_b,
            PublicDigest32::new([13; 32]),
            PublicDigest32::new([14; 32]),
        )
        .expect("pair");
        (pair, input_a)
    }

    fn role_execution_for_pair(pair: &Ed25519YaoInputPairBindingV1) -> Ed25519YaoRoleExecutionV1 {
        let session = pair.session();
        let client_package = Ed25519YaoEncryptedPackageV1::new(
            Ed25519YaoPackageKindV1::ActivationClient,
            Ed25519YaoDeriverRoleV1::DeriverA,
            session,
            [4; 32],
            [5; 32],
            vec![6; 16],
        )
        .expect("client package");
        let signing_worker_package = Ed25519YaoEncryptedPackageV1::new(
            Ed25519YaoPackageKindV1::ActivationSigningWorker,
            Ed25519YaoDeriverRoleV1::DeriverA,
            session,
            [4; 32],
            [7; 32],
            vec![8; 16],
        )
        .expect("SigningWorker package");
        Ed25519YaoRoleExecutionV1::Activation(Ed25519YaoActivationRoleExecutionV1 {
            binding: pair.binding().clone(),
            deriver: Ed25519YaoDeriverRoleV1::DeriverA,
            transcript: [4; 32],
            client_commitment: [5; 32],
            signing_worker_commitment: [6; 32],
            client_package,
            signing_worker_package,
        })
    }

    fn tenant_root_context_for_pair(
        pair: &Ed25519YaoInputPairBindingV1,
    ) -> crate::CloudflareEd25519YaoTenantRootContextV2 {
        crate::CloudflareEd25519YaoTenantRootContextV2 {
            wallet_route: serde_json::from_value(serde_json::json!({
                "home": "US",
                "addresses": {
                    "router": "11".repeat(32),
                    "deriver_a": "22".repeat(32),
                    "deriver_b": "33".repeat(32),
                    "signing_worker": "44".repeat(32),
                },
            }))
            .expect("wallet route"),
            ownership_generation: 1,
            identity: router_ab_core::TenantRootIdentityV1::new(
                "org", "project", "env", "root", "v1",
            )
            .expect("root identity"),
            custody_binding: crate::CloudflareTenantRootCustodyBindingWireV1 {
                activation_receipt_b64u: "AQ".to_owned(),
                operation_id: router_ab_core::TenantRootDerivationOperationIdV1::from_bytes(
                    [21; 16],
                )
                .expect("operation"),
                session_id: router_ab_core::TenantRootDerivationSessionIdV1::from_bytes([22; 16])
                    .expect("session"),
                nonce: router_ab_core::TenantRootDerivationNonceV1::from_bytes([23; 32])
                    .expect("nonce"),
                issued_at_ms: 1,
                expires_at_ms: 2,
            },
            outer_binding: Ed25519YaoOuterBindingV2::new(
                router_ab_core::Ed25519YaoPairSessionIdV2::from_yao_session(
                    Ed25519YaoSessionIdV1::new(pair.session()).expect("pair session"),
                ),
                pair.binding().stable_key_context_binding,
                PublicDigest32::new([24; 32]),
                [25; 16],
                1,
                2,
            )
            .expect("outer binding"),
            application: router_ab_core::RouterAbEd25519YaoApplicationBindingFactsV1::new(
                "account", "near-key", "root", 1,
            )
            .expect("application"),
            participant_ids: [1, 2],
        }
    }

    #[test]
    fn session_expiry_uses_checked_arithmetic() {
        assert_eq!(yao_expiry_from_now(10, 20).expect("expiry fits"), 30);
        assert!(yao_expiry_from_now(u64::MAX, 1).is_err());
    }

    #[test]
    fn role_failure_mapping_preserves_only_sanitized_retry_class() {
        let expired = CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(
            &RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::PairPreparationExpired,
                "diagnostic text is not part of the classification contract",
            ),
        );
        assert_eq!(
            expired,
            CloudflareEd25519YaoRoleFailureResponseV1::RecoverableFailure {
                code: RouterEd25519YaoExecuteFailureCodeV1::CeremonyExpired,
                retry_after_ms: 1_000,
            }
        );

        let missing = CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(
            &RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "diagnostic text is not part of the classification contract",
            ),
        );
        assert_eq!(
            missing,
            CloudflareEd25519YaoRoleFailureResponseV1::Rejected {
                code: RouterEd25519YaoExecuteFailureCodeV1::MissingPreparation,
            }
        );

        let conflicting = CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(
            &RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ConflictingPair,
                "the diagnostic is not part of the classification contract",
            ),
        );
        assert_eq!(
            conflicting,
            CloudflareEd25519YaoRoleFailureResponseV1::Rejected {
                code: RouterEd25519YaoExecuteFailureCodeV1::ConflictingPair,
            }
        );

        let untyped_conflict = CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(
            &RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "Deriver B pair is already running",
            ),
        );
        assert_eq!(
            untyped_conflict,
            CloudflareEd25519YaoRoleFailureResponseV1::Rejected {
                code: RouterEd25519YaoExecuteFailureCodeV1::TerminalRoleFailure,
            }
        );
    }

    #[test]
    fn preparation_store_failure_is_retryable_and_keeps_typed_refusals() {
        let transient = preparation_command_error_v1(invalid_lifecycle(
            "Deriver B wallet pair command failed: D1Error: Network connection lost",
        ));
        assert_eq!(
            CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(&transient),
            CloudflareEd25519YaoRoleFailureResponseV1::RecoverableFailure {
                code: RouterEd25519YaoExecuteFailureCodeV1::ServiceUnavailable,
                retry_after_ms: 1_000,
            }
        );
        let superseded = preparation_command_error_v1(invalid_lifecycle(
            "Deriver B wallet pair command failed: SupersededAttempt: a later attempt took its place",
        ));
        assert_eq!(
            CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(&superseded),
            CloudflareEd25519YaoRoleFailureResponseV1::Rejected {
                code: RouterEd25519YaoExecuteFailureCodeV1::AttemptSuperseded,
            }
        );
    }

    #[test]
    fn pair_completion_transition_is_forward_only() {
        let (pair, input) = pair_for_completion();
        let input_digest = [12; 32];
        let pair_digest = [9; 32];
        let execution_id = [10; 32];
        let execution = role_execution_for_pair(&pair);
        let tenant_root = tenant_root_context_for_pair(&pair);
        let running = PairYaoSessionRecordV1::Running {
            pair_digest,
            input_digest,
            root_metadata_digest: [15; 32],
            execution_id,
            started_at_ms: 100,
            pair_binding: Box::new(pair.clone()),
            tenant_root: Box::new(tenant_root),
            input: Box::new(input),
            work: crate::CloudflareEd25519YaoPairWorkV1::Ceremony,
        };
        let completed =
            completed_pair_record_if_running(&running, pair_digest, input_digest, &execution, 101)
                .expect("running pair completes before its deadline");
        assert!(matches!(
            completed,
            PairYaoSessionRecordV1::Completed { .. }
        ));
        assert!(
            completed_pair_record_if_running(
                &completed,
                pair_digest,
                input_digest,
                &execution,
                102
            )
            .is_none(),
            "an exact completion replay cannot rewrite a terminal record"
        );
        assert!(matches!(
            completed_pair_record_if_running(
                &running,
                pair_digest,
                input_digest,
                &execution,
                100 + YAO_RUNNING_LIFETIME_MS,
            ),
            Some(PairYaoSessionRecordV1::Burned { .. })
        ));
        let burned = PairYaoSessionRecordV1::Burned {
            pair_digest,
            input_digest,
            execution_id,
        };
        assert!(completed_pair_record_if_running(
            &burned,
            pair_digest,
            input_digest,
            &execution,
            101
        )
        .is_none());
        assert!(completed_pair_record_if_running(
            &running,
            [16; 32],
            input_digest,
            &execution,
            101
        )
        .is_none());
        assert!(
            completed_pair_record_if_running(&running, pair_digest, [17; 32], &execution, 101)
                .is_none()
        );
    }

    #[test]
    fn pair_start_refusal_answers_only_its_exact_execution() {
        let (pair, _) = pair_for_completion();
        let execution_id = Ed25519YaoExecutionIdV1::new(pair.pair_digest().bytes).expect("id");
        let refusal = CloudflareEd25519YaoPairStartRefusalV1 {
            session: pair.session(),
            pair_digest: pair.pair_digest().bytes,
            execution_id,
            reason: CloudflareEd25519YaoPairStartRefusalReasonV1::NotPrepared,
        };
        assert!(refusal.answers(&pair, execution_id));
        assert!(!refusal.answers(
            &pair,
            Ed25519YaoExecutionIdV1::new([9; 32]).expect("other id")
        ));
        let other_pair = CloudflareEd25519YaoPairStartRefusalV1 {
            pair_digest: [9; 32],
            ..refusal.clone()
        };
        assert!(!other_pair.answers(&pair, execution_id));
        let other_session = CloudflareEd25519YaoPairStartRefusalV1 {
            session: [9; 32],
            ..refusal
        };
        assert!(!other_session.answers(&pair, execution_id));
    }
}
