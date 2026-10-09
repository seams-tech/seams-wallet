use crate::authenticate_local_ed25519_yao_deriver_b_peer_http_v1;
use crate::local_ed25519_yao_refresh::LocalEd25519YaoEffectiveIdentityV1;
use crate::local_ed25519_yao_signing_worker::now_unix_ms;
use crate::local_ed25519_yao_signing_worker::LocalEd25519YaoSigningWorkerDurableStateV1;
use crate::local_ed25519_yao_stream::{
    authenticate_local_ed25519_yao_deriver_b_peer_http_with_pair_v2,
    connect_local_deriver_a_pair_http_v2, open_local_deriver_b_target_proof_v2,
    run_local_activation_deriver_a_pair_connected_v2,
    run_local_activation_deriver_b_authenticated_http_open_v2,
    run_local_export_deriver_a_pair_connected_v2,
    run_local_export_deriver_b_authenticated_http_open_v2, seal_local_deriver_a_target_proof_v2,
    seal_local_deriver_b_target_proof_v2, LocalEd25519YaoPairCompletionDeliveryV1,
    LocalEd25519YaoPairConnectErrorV1, LocalEd25519YaoPairPeerContextV1,
};
use crate::{
    build_local_activation_deriver_a_with_server_v1,
    build_local_activation_deriver_b_with_server_v1, build_local_export_deriver_a_with_server_v1,
    build_local_export_deriver_b_with_server_v1, build_local_refresh_deriver_a_v1,
    build_local_refresh_deriver_b_v1, complete_local_deriver_a_target_v2,
    complete_local_deriver_b_target_v2, derive_local_ed25519_yao_joint_refresh_delta_v1,
    generate_local_ed25519_yao_deriver_a_refresh_delta_v1,
    generate_local_ed25519_yao_deriver_b_refresh_delta_v1, local_dev_http_error_body_v1,
    local_ed25519_yao_refresh_binding_digest_v1,
    open_local_ed25519_yao_activation_deriver_a_input_v1,
    open_local_ed25519_yao_activation_deriver_b_input_v1,
    open_local_ed25519_yao_export_deriver_a_input_v1,
    open_local_ed25519_yao_export_deriver_b_input_v1,
    open_local_ed25519_yao_refresh_deriver_a_input_v1,
    open_local_ed25519_yao_refresh_deriver_b_input_v1, prepare_local_deriver_a_target_v2,
    prepare_local_deriver_b_target_v2, read_local_dev_http_request_v1,
    require_local_dev_internal_service_auth_v1, run_local_activation_deriver_a_http_v1,
    run_local_activation_deriver_b_authenticated_http_v1, seal_local_ed25519_yao_package_v1,
    write_local_dev_http_response_v1, Ed25519YaoDeriverRoleV1, Ed25519YaoEncryptedInputV1,
    Ed25519YaoEncryptedPackageV1, Ed25519YaoPackageKindV1,
    LocalEd25519YaoActivationDeriverARequestV1, LocalEd25519YaoActivationDeriverBRequestV1,
    LocalEd25519YaoActivationRecipientsV1, LocalEd25519YaoDeriverAEffectiveStateV1,
    LocalEd25519YaoDeriverAPreparedRefreshV1, LocalEd25519YaoDeriverARefreshDeltaWireV1,
    LocalEd25519YaoDeriverBEffectiveStateV1, LocalEd25519YaoDeriverBPreparedRefreshV1,
    LocalEd25519YaoDeriverBRefreshDeltaWireV1, LocalEd25519YaoEncryptedRefreshInputV1,
    LocalEd25519YaoExportRecipientV1, LocalEd25519YaoRecipientPrivateKeyV1,
    LocalEd25519YaoRefreshDeriverBRequestV1, LocalEd25519YaoSigningWorkerPackagePairDeliveryV1,
    LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1,
    LocalEd25519YaoSigningWorkerRefreshPackageDeliveryV1, LocalEd25519YaoSigningWorkerStateV1,
    LocalWorkerRoleConfigV1, LOCAL_DERIVER_A_ED25519_YAO_BURN_PAIR_PATH,
    LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
    LOCAL_DERIVER_A_ED25519_YAO_READ_PAIR_STATUS_PATH,
    LOCAL_DERIVER_A_ED25519_YAO_REFRESH_CLIENT_PACKAGE_PATH,
    LOCAL_DERIVER_A_ED25519_YAO_REFRESH_PROMOTE_PATH,
    LOCAL_DERIVER_A_ED25519_YAO_REFRESH_SIGNING_WORKER_PACKAGE_PATH,
    LOCAL_DERIVER_A_ED25519_YAO_REFRESH_START_PATH, LOCAL_DERIVER_B_ED25519_YAO_BURN_PAIR_PATH,
    LOCAL_DERIVER_B_ED25519_YAO_PEER_PATH, LOCAL_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
    LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_OUTCOME_PATH,
    LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_STATUS_PATH,
    LOCAL_DERIVER_B_ED25519_YAO_REFRESH_CLIENT_PACKAGE_PATH,
    LOCAL_DERIVER_B_ED25519_YAO_REFRESH_DELTA_PATH,
    LOCAL_DERIVER_B_ED25519_YAO_REFRESH_PROMOTE_PATH,
    LOCAL_DERIVER_B_ED25519_YAO_REFRESH_RESULT_PATH,
    LOCAL_DERIVER_B_ED25519_YAO_REFRESH_SIGNING_WORKER_PACKAGE_PATH,
    LOCAL_DERIVER_B_ED25519_YAO_REFRESH_STAGE_PATH, LOCAL_HTTP_SERVICE_BINDING_TIMEOUT_MS_V1,
    LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
    LOCAL_SIGNING_WORKER_ED25519_YAO_ACTIVATION_PACKAGES_PATH,
    LOCAL_SIGNING_WORKER_ED25519_YAO_INITIAL_REGISTRATION_FINALIZATION_PATH,
    LOCAL_SIGNING_WORKER_ED25519_YAO_RECOVERY_PROMOTE_PATH,
    LOCAL_SIGNING_WORKER_ED25519_YAO_REFRESH_DERIVER_A_PATH,
    LOCAL_SIGNING_WORKER_ED25519_YAO_REFRESH_DERIVER_B_PATH,
    LOCAL_SIGNING_WORKER_NORMAL_SIGNING_PATH, LOCAL_SIGNING_WORKER_NORMAL_SIGNING_PREPARE_PATH,
};
use crate::{
    LocalDeriverAPairPayloadV1, LocalDeriverAPairRecordV1, LocalDeriverAPairScopeV1,
    LocalEd25519YaoSqliteHostV1,
};
use router_ab_core::{
    ed25519_yao_encrypted_input_digest_v1, Ed25519YaoCeremonyBindingV1, Ed25519YaoExecutionIdV1,
    Ed25519YaoOperationV1, Ed25519YaoOuterBindingV2, Ed25519YaoPairExecutorV1,
    Ed25519YaoPairRecordV1, Ed25519YaoPairStoreResultV1, Ed25519YaoRefreshBindingV1,
    Ed25519YaoStateEpochV1, LocalServiceRoleV1, RouterAbProtocolError,
    RouterAbProtocolErrorCode, RouterAbProtocolResult,
};
use router_ab_ed25519_yao::relay::{ActivationDeriverACompletion, ActivationDeriverBCompletion};
use router_ab_ed25519_yao::{
    ActivationDeriverA, ActivationDeriverB, Ed25519YaoActivationRoleExecutionV1,
    Ed25519YaoExportRoleExecutionV1, Ed25519YaoRoleExecutionV1,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::Digest;
use signer_core::ed25519_yao_derivation::{
    Ed25519YaoDeriverAServerContributionV1, Ed25519YaoDeriverBServerContributionV1,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{self, Read, Write},
    net::{Shutdown, TcpStream},
    thread,
    time::Duration,
};
use zeroize::{Zeroize, Zeroizing};

use router_ab_cloudflare::{
    CloudflareEd25519YaoPairExecuteRequestV1, CloudflareEd25519YaoPairExecuteResponseV1,
    CloudflareEd25519YaoPairLookupRequestV1, CloudflareEd25519YaoPairPreparationV1,
    CloudflareEd25519YaoPairPrepareRequestV1, CloudflareEd25519YaoPairStartRefusalReasonV1,
    CloudflareEd25519YaoPairStatusResponseV1,
    CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2,
    CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2,
};

enum PendingDeriverBRoleV1 {
    Refresh {
        binding: Ed25519YaoRefreshBindingV1,
        binding_digest: [u8; 32],
        recipients: LocalEd25519YaoActivationRecipientsV1,
        prepared: LocalEd25519YaoDeriverBPreparedRefreshV1,
        role: ActivationDeriverB,
    },
}

impl PendingDeriverBRoleV1 {
    fn session(&self) -> [u8; 32] {
        match self {
            Self::Refresh { binding, .. } => binding.ceremony().session_id.into_bytes(),
        }
    }
}

enum CompletedDeriverBRoleV1 {
    Refresh {
        binding: Ed25519YaoRefreshBindingV1,
        binding_digest: [u8; 32],
        packages: EncryptedActivationPackagesV1,
        promotion: DeriverBRefreshPromotionStateV1,
        completion: Box<ActivationDeriverBCompletion>,
    },
}

enum CompletedDeriverARoleV1 {
    Refresh {
        binding: Ed25519YaoRefreshBindingV1,
        binding_digest: [u8; 32],
        packages: EncryptedActivationPackagesV1,
        promotion: DeriverARefreshPromotionStateV1,
    },
}

struct EncryptedActivationPackagesV1 {
    client: Ed25519YaoEncryptedPackageV1,
    signing_worker: Ed25519YaoEncryptedPackageV1,
}

enum DeriverARefreshPromotionStateV1 {
    Prepared(LocalEd25519YaoDeriverAPreparedRefreshV1),
    Promoted(LocalEd25519YaoRefreshPromotionReceiptV1),
}

enum DeriverBRefreshPromotionStateV1 {
    Prepared(LocalEd25519YaoDeriverBPreparedRefreshV1),
    Promoted(LocalEd25519YaoRefreshPromotionReceiptV1),
}

struct StagedDeriverBRefreshV1 {
    request: LocalEd25519YaoRefreshDeriverBRequestV1,
    binding_digest: [u8; 32],
    delta: LocalEd25519YaoDeriverBRefreshDeltaWireV1,
}

/// Persisted admission state for one role-owned pair lifecycle.
///
/// The encrypted input remains opaque at this boundary. Decryption and role
/// execution stay in the role worker that owns the corresponding private key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum LocalEd25519YaoPairRoleRecordV1 {
    Prepared {
        session: [u8; 32],
        pair_digest: [u8; 32],
        pair_binding: Box<router_ab_core::Ed25519YaoInputPairBindingV1>,
        tenant_root: Box<router_ab_cloudflare::CloudflareEd25519YaoTenantRootContextV2>,
        input_digest: [u8; 32],
        root_metadata_digest: [u8; 32],
        expires_at_ms: u64,
        input: Box<Ed25519YaoEncryptedInputV1>,
    },
    Running {
        session: [u8; 32],
        pair_digest: [u8; 32],
        pair_binding: Box<router_ab_core::Ed25519YaoInputPairBindingV1>,
        tenant_root: Box<router_ab_cloudflare::CloudflareEd25519YaoTenantRootContextV2>,
        input_digest: [u8; 32],
        root_metadata_digest: [u8; 32],
        expires_at_ms: u64,
        execution_id: [u8; 32],
        input: Box<Ed25519YaoEncryptedInputV1>,
    },
    Completed {
        session: [u8; 32],
        pair_digest: [u8; 32],
        pair_binding: Box<router_ab_core::Ed25519YaoInputPairBindingV1>,
        root_metadata_digest: [u8; 32],
        execution_id: [u8; 32],
        execution: Box<Ed25519YaoRoleExecutionV1>,
    },
    Expired {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
    Burned {
        session: [u8; 32],
        pair_digest: [u8; 32],
    },
}

impl LocalEd25519YaoPairRoleRecordV1 {
    pub(crate) fn session(&self) -> [u8; 32] {
        match self {
            Self::Prepared { session, .. }
            | Self::Running { session, .. }
            | Self::Completed { session, .. }
            | Self::Expired { session, .. }
            | Self::Burned { session, .. } => *session,
        }
    }

    pub(crate) fn pair_digest(&self) -> [u8; 32] {
        match self {
            Self::Prepared { pair_digest, .. }
            | Self::Running { pair_digest, .. }
            | Self::Completed { pair_digest, .. }
            | Self::Expired { pair_digest, .. }
            | Self::Burned { pair_digest, .. } => *pair_digest,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalDeriverBPairOutcomeLookupV1 {
    pair_binding: router_ab_core::Ed25519YaoInputPairBindingV1,
    root_metadata_digest: [u8; 32],
    execution_id: Ed25519YaoExecutionIdV1,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalEd25519YaoRefreshDeltaExchangeRequestV1 {
    deriver_a_delta: LocalEd25519YaoDeriverARefreshDeltaWireV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalEd25519YaoRefreshPromotionRequestV1 {
    pub binding_digest: [u8; 32],
    pub session: [u8; 32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalEd25519YaoRefreshPromotionReceiptV1 {
    pub state_epoch: Ed25519YaoStateEpochV1,
}

#[derive(Default)]
pub struct LocalEd25519YaoWorkerStateV1 {
    pending_deriver_b: Option<PendingDeriverBRoleV1>,
    staged_deriver_b_refresh: Option<StagedDeriverBRefreshV1>,
    completed_deriver_a: Option<CompletedDeriverARoleV1>,
    completed_deriver_b: Option<CompletedDeriverBRoleV1>,
    deriver_a_effective:
        BTreeMap<LocalEd25519YaoEffectiveIdentityV1, LocalEd25519YaoDeriverAEffectiveStateV1>,
    deriver_b_effective:
        BTreeMap<LocalEd25519YaoEffectiveIdentityV1, LocalEd25519YaoDeriverBEffectiveStateV1>,
    consumed_deriver_a_sessions: BTreeSet<[u8; 32]>,
    consumed_deriver_b_sessions: BTreeSet<[u8; 32]>,
    pair_roles: BTreeMap<[u8; 32], LocalEd25519YaoPairRoleRecordV1>,
    signing_worker: LocalEd25519YaoSigningWorkerStateV1,
}

const LOCAL_ED25519_YAO_DURABLE_STATE_VERSION_V2: &str =
    "local_ed25519_yao_worker_durable_state_v2";

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct LocalEd25519YaoDurableStateEnvelopeRefV1<'state> {
    version: &'static str,
    state: LocalEd25519YaoDurableRoleStateRefV1<'state>,
}

#[derive(Serialize)]
#[serde(tag = "role", rename_all = "snake_case", deny_unknown_fields)]
enum LocalEd25519YaoDurableRoleStateRefV1<'state> {
    DeriverA {
        effective: Vec<&'state LocalEd25519YaoDeriverAEffectiveStateV1>,
    },
    DeriverB {
        effective: Vec<&'state LocalEd25519YaoDeriverBEffectiveStateV1>,
    },
    SigningWorker {
        active: LocalEd25519YaoSigningWorkerDurableStateV1,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalEd25519YaoDurableStateEnvelopeV1 {
    version: String,
    state: LocalEd25519YaoDurableRoleStateV1,
}

#[derive(Deserialize)]
#[serde(tag = "role", rename_all = "snake_case", deny_unknown_fields)]
enum LocalEd25519YaoDurableRoleStateV1 {
    DeriverA {
        effective: Vec<LocalEd25519YaoDeriverAEffectiveStateV1>,
    },
    DeriverB {
        effective: Vec<LocalEd25519YaoDeriverBEffectiveStateV1>,
    },
    SigningWorker {
        active: LocalEd25519YaoSigningWorkerDurableStateV1,
    },
}

impl LocalEd25519YaoWorkerStateV1 {
    pub fn encode_durable_state_for_role_v1(
        &self,
        role: LocalServiceRoleV1,
    ) -> RouterAbProtocolResult<Vec<u8>> {
        let state = match role {
            LocalServiceRoleV1::DeriverA => LocalEd25519YaoDurableRoleStateRefV1::DeriverA {
                effective: self.deriver_a_effective.values().collect(),
            },
            LocalServiceRoleV1::DeriverB => LocalEd25519YaoDurableRoleStateRefV1::DeriverB {
                effective: self.deriver_b_effective.values().collect(),
            },
            LocalServiceRoleV1::SigningWorker => {
                LocalEd25519YaoDurableRoleStateRefV1::SigningWorker {
                    active: self.signing_worker.durable_state_v1()?,
                }
            }
            LocalServiceRoleV1::Router => {
                return Err(invalid_worker_state(
                    "Router does not own local Ed25519 Yao secret state",
                ));
            }
        };
        serde_json::to_vec(&LocalEd25519YaoDurableStateEnvelopeRefV1 {
            version: LOCAL_ED25519_YAO_DURABLE_STATE_VERSION_V2,
            state,
        })
        .map_err(|_| invalid_worker_state("local Ed25519 Yao durable state encoding failed"))
    }

    pub fn decode_durable_state_for_role_v1(
        role: LocalServiceRoleV1,
        bytes: &[u8],
    ) -> RouterAbProtocolResult<Self> {
        let decoded = serde_json::from_slice::<LocalEd25519YaoDurableStateEnvelopeV1>(bytes)
            .map_err(|_| invalid_worker_state("local Ed25519 Yao durable state is malformed"))?;
        if decoded.version != LOCAL_ED25519_YAO_DURABLE_STATE_VERSION_V2 {
            return Err(invalid_worker_state(
                "local Ed25519 Yao durable state version is unsupported",
            ));
        }
        let mut restored = Self::default();
        match (role, decoded.state) {
            (
                LocalServiceRoleV1::DeriverA,
                LocalEd25519YaoDurableRoleStateV1::DeriverA { effective },
            ) => {
                for state in effective {
                    state.identity().validate_persisted_v1()?;
                    let identity = state.identity().clone();
                    if restored
                        .deriver_a_effective
                        .insert(identity, state)
                        .is_some()
                    {
                        return Err(invalid_worker_state(
                            "persisted Deriver A state contains a duplicate Yao identity",
                        ));
                    }
                }
            }
            (
                LocalServiceRoleV1::DeriverB,
                LocalEd25519YaoDurableRoleStateV1::DeriverB { effective },
            ) => {
                for state in effective {
                    state.identity().validate_persisted_v1()?;
                    let identity = state.identity().clone();
                    if restored
                        .deriver_b_effective
                        .insert(identity, state)
                        .is_some()
                    {
                        return Err(invalid_worker_state(
                            "persisted Deriver B state contains a duplicate Yao identity",
                        ));
                    }
                }
            }
            (
                LocalServiceRoleV1::SigningWorker,
                LocalEd25519YaoDurableRoleStateV1::SigningWorker { active },
            ) => {
                restored.signing_worker =
                    LocalEd25519YaoSigningWorkerStateV1::from_durable_state_v1(active)?;
            }
            (LocalServiceRoleV1::Router, _) => {
                return Err(invalid_worker_state(
                    "Router does not own local Ed25519 Yao secret state",
                ));
            }
            _ => {
                return Err(invalid_worker_state(
                    "local Ed25519 Yao durable state belongs to a different worker role",
                ));
            }
        }
        Ok(restored)
    }

    pub(crate) fn apply_deriver_b_effective_delta(
        &mut self,
        delta: Option<LocalEd25519YaoDeriverBEffectiveStateV1>,
    ) -> RouterAbProtocolResult<()> {
        if let Some(delta) = delta {
            let identity = delta.identity().clone();
            if self.deriver_b_effective.contains_key(&identity) {
                return Err(invalid_worker_state(
                    "Deriver B effective identity was concurrently registered",
                ));
            }
            self.deriver_b_effective.insert(identity, delta);
        }
        Ok(())
    }
}

pub(crate) fn validate_pair_role_record(
    role: LocalServiceRoleV1,
    record: &LocalEd25519YaoPairRoleRecordV1,
) -> RouterAbProtocolResult<()> {
    match record {
        LocalEd25519YaoPairRoleRecordV1::Prepared {
            session,
            pair_digest,
            pair_binding,
            tenant_root,
            input_digest,
            root_metadata_digest,
            expires_at_ms,
            input,
        } => {
            if session.iter().all(|byte| *byte == 0)
                || pair_digest.iter().all(|byte| *byte == 0)
                || input_digest.iter().all(|byte| *byte == 0)
                || root_metadata_digest.iter().all(|byte| *byte == 0)
                || *expires_at_ms == 0
            {
                return Err(invalid_worker_state(
                    "persisted pair preparation has an empty identity or time",
                ));
            }
            input.validate()?;
            pair_binding.validate()?;
            tenant_root.validate_for_pair(pair_binding)?;
            if input.session() != *session
                || pair_binding.session() != *session
                || pair_binding.pair_digest().bytes != *pair_digest
                || local_pair_tenant_root_metadata_digest_v1(tenant_root)? != *root_metadata_digest
                || !pair_role_input_matches_v1(role, pair_binding, input, input_digest)?
            {
                return Err(invalid_worker_state(
                    "persisted pair preparation identity does not match its pair",
                ));
            }
        }
        LocalEd25519YaoPairRoleRecordV1::Running {
            session,
            pair_digest,
            pair_binding,
            tenant_root,
            input_digest,
            root_metadata_digest,
            expires_at_ms,
            execution_id,
            input,
        } => {
            if session.iter().all(|byte| *byte == 0)
                || pair_digest.iter().all(|byte| *byte == 0)
                || input_digest.iter().all(|byte| *byte == 0)
                || root_metadata_digest.iter().all(|byte| *byte == 0)
                || expires_at_ms == &0
                || execution_id.iter().all(|byte| *byte == 0)
            {
                return Err(invalid_worker_state(
                    "persisted running pair has an empty identity or time",
                ));
            }
            input.validate()?;
            pair_binding.validate()?;
            tenant_root.validate_for_pair(pair_binding)?;
            if input.session() != *session
                || pair_binding.session() != *session
                || pair_binding.pair_digest().bytes != *pair_digest
                || local_pair_tenant_root_metadata_digest_v1(tenant_root)? != *root_metadata_digest
                || !pair_role_input_matches_v1(role, pair_binding, input, input_digest)?
            {
                return Err(invalid_worker_state(
                    "persisted running pair identity does not match its pair",
                ));
            }
        }
        LocalEd25519YaoPairRoleRecordV1::Completed {
            session,
            pair_digest,
            pair_binding,
            root_metadata_digest,
            execution_id,
            execution,
        } => {
            if session.iter().all(|byte| *byte == 0)
                || pair_digest.iter().all(|byte| *byte == 0)
                || root_metadata_digest.iter().all(|byte| *byte == 0)
                || execution_id.iter().all(|byte| *byte == 0)
            {
                return Err(invalid_worker_state(
                    "persisted completed pair has an empty identity",
                ));
            }
            execution.validate()?;
            pair_binding.validate()?;
            if execution.session() != *session
                || pair_binding.session() != *session
                || pair_binding.pair_digest().bytes != *pair_digest
                || !completed_execution_matches_pair_v1(execution, pair_binding)
                || execution.deriver()
                    != match role {
                        LocalServiceRoleV1::DeriverA => Ed25519YaoDeriverRoleV1::DeriverA,
                        LocalServiceRoleV1::DeriverB => Ed25519YaoDeriverRoleV1::DeriverB,
                        _ => {
                            return Err(invalid_worker_state(
                                "pair completion cannot belong to this worker role",
                            ))
                        }
                    }
            {
                return Err(invalid_worker_state(
                    "persisted completed pair identity does not match its role",
                ));
            }
        }
        LocalEd25519YaoPairRoleRecordV1::Expired {
            session,
            pair_digest,
        }
        | LocalEd25519YaoPairRoleRecordV1::Burned {
            session,
            pair_digest,
        } if session.iter().all(|byte| *byte == 0) || pair_digest.iter().all(|byte| *byte == 0) => {
            return Err(invalid_worker_state(
                "persisted pair terminal state has an empty identity",
            ));
        }
        _ => {}
    }
    Ok(())
}

/// Whether a persisted role input is the one its pair names for `role`.
fn pair_role_input_matches_v1(
    role: LocalServiceRoleV1,
    pair_binding: &router_ab_core::Ed25519YaoInputPairBindingV1,
    input: &Ed25519YaoEncryptedInputV1,
    input_digest: &[u8; 32],
) -> RouterAbProtocolResult<bool> {
    let (deriver, expected_digest) = match role {
        LocalServiceRoleV1::DeriverA => (
            Ed25519YaoDeriverRoleV1::DeriverA,
            pair_binding.deriver_a_input_digest(),
        ),
        LocalServiceRoleV1::DeriverB => (
            Ed25519YaoDeriverRoleV1::DeriverB,
            pair_binding.deriver_b_input_digest(),
        ),
        _ => {
            return Err(invalid_worker_state(
                "pair preparation cannot belong to this worker role",
            ))
        }
    };
    Ok(input.deriver() == deriver
        && *input_digest == expected_digest.bytes
        && ed25519_yao_encrypted_input_digest_v1(input)?.bytes == *input_digest)
}

fn completed_execution_matches_pair_v1(
    execution: &Ed25519YaoRoleExecutionV1,
    pair_binding: &router_ab_core::Ed25519YaoInputPairBindingV1,
) -> bool {
    match execution {
        Ed25519YaoRoleExecutionV1::Activation(execution) => {
            &execution.binding == pair_binding.binding()
        }
        Ed25519YaoRoleExecutionV1::Export(execution) => {
            &execution.binding == pair_binding.binding()
        }
        Ed25519YaoRoleExecutionV1::Lane(execution) => {
            execution.session == pair_binding.session()
                && execution.job.yao_request_kind.operation() == pair_binding.binding().operation
        }
    }
}

fn build_deriver_a_activation_from_effective_state(
    state: &LocalEd25519YaoWorkerStateV1,
    request: LocalEd25519YaoActivationDeriverARequestV1,
    server: Ed25519YaoDeriverAServerContributionV1,
) -> RouterAbProtocolResult<(
    Ed25519YaoCeremonyBindingV1,
    ActivationDeriverA,
    Option<LocalEd25519YaoDeriverAEffectiveStateV1>,
)> {
    match request.binding.operation {
        Ed25519YaoOperationV1::Registration => {
            let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&request.binding);
            // A device linked to a wallet registers a fresh activation of the
            // wallet's own identity. The tenant root derives the same
            // contribution for it, as on Workers, and the identity's effective
            // state stays as it is; the SigningWorker refuses a second
            // registration activation.
            if state.deriver_a_effective.contains_key(&identity) {
                let (binding, role) =
                    build_local_activation_deriver_a_with_server_v1(request, server)?;
                return Ok((binding, role, None));
            }
            let epoch = Ed25519YaoStateEpochV1::new(1)?;
            let (server_y, server_tau) = server.into_parts();
            let server_y = server_y.into_bytes();
            let server_tau = server_tau.into_bytes();
            let role_contribution =
                Ed25519YaoDeriverAServerContributionV1::from_secret_bytes(server_y, server_tau);
            let state_contribution =
                Ed25519YaoDeriverAServerContributionV1::from_secret_bytes(server_y, server_tau);
            let initial = LocalEd25519YaoDeriverAEffectiveStateV1::from_initial(
                &request.binding,
                epoch,
                state_contribution,
            )?;
            let (binding, role) =
                build_local_activation_deriver_a_with_server_v1(request, role_contribution)?;
            Ok((binding, role, Some(initial)))
        }
        Ed25519YaoOperationV1::Recovery => {
            let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&request.binding);
            if !state.deriver_a_effective.contains_key(&identity) {
                return Err(invalid_worker_state(
                    "Deriver A recovery requires active Yao state for this identity",
                ));
            }
            let (binding, role) = build_local_activation_deriver_a_with_server_v1(request, server)?;
            Ok((binding, role, None))
        }
        Ed25519YaoOperationV1::Refresh
        | Ed25519YaoOperationV1::Export
        | Ed25519YaoOperationV1::LaneProvisioning
        | Ed25519YaoOperationV1::LaneRefresh => Err(invalid_worker_state(
            "Deriver A activation request selected an invalid operation",
        )),
    }
}

fn build_deriver_b_activation_from_effective_state(
    state: &LocalEd25519YaoWorkerStateV1,
    request: LocalEd25519YaoActivationDeriverBRequestV1,
    server: Ed25519YaoDeriverBServerContributionV1,
) -> RouterAbProtocolResult<(
    Ed25519YaoCeremonyBindingV1,
    ActivationDeriverB,
    Option<LocalEd25519YaoDeriverBEffectiveStateV1>,
)> {
    match request.binding.operation {
        Ed25519YaoOperationV1::Registration => {
            let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&request.binding);
            // A device linked to a wallet registers a fresh activation of the
            // wallet's own identity. The tenant root derives the same
            // contribution for it, as on Workers, and the identity's effective
            // state stays as it is; the SigningWorker refuses a second
            // registration activation.
            if state.deriver_b_effective.contains_key(&identity) {
                let (binding, role) =
                    build_local_activation_deriver_b_with_server_v1(request, server)?;
                return Ok((binding, role, None));
            }
            let epoch = Ed25519YaoStateEpochV1::new(1)?;
            let (server_y, server_tau) = server.into_parts();
            let server_y = server_y.into_bytes();
            let server_tau = server_tau.into_bytes();
            let role_contribution =
                Ed25519YaoDeriverBServerContributionV1::from_secret_bytes(server_y, server_tau);
            let state_contribution =
                Ed25519YaoDeriverBServerContributionV1::from_secret_bytes(server_y, server_tau);
            let initial = LocalEd25519YaoDeriverBEffectiveStateV1::from_initial(
                &request.binding,
                epoch,
                state_contribution,
            )?;
            let (binding, role) =
                build_local_activation_deriver_b_with_server_v1(request, role_contribution)?;
            Ok((binding, role, Some(initial)))
        }
        Ed25519YaoOperationV1::Recovery => {
            let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&request.binding);
            if !state.deriver_b_effective.contains_key(&identity) {
                return Err(invalid_worker_state(
                    "Deriver B recovery requires active Yao state for this identity",
                ));
            }
            let (binding, role) = build_local_activation_deriver_b_with_server_v1(request, server)?;
            Ok((binding, role, None))
        }
        Ed25519YaoOperationV1::Refresh
        | Ed25519YaoOperationV1::Export
        | Ed25519YaoOperationV1::LaneProvisioning
        | Ed25519YaoOperationV1::LaneRefresh => Err(invalid_worker_state(
            "Deriver B activation request selected an invalid operation",
        )),
    }
}

pub enum LocalEd25519YaoConnectionDispatchV1 {
    Handled,
    NoSnapshotWrite,
    /// A pair connection from Deriver A that waits for this role's
    /// preparation. The caller takes it up again with
    /// [`resume_local_ed25519_yao_parked_peer_v1`] after each later
    /// connection.
    Parked(LocalEd25519YaoParkedPeerV1),
    Unhandled(TcpStream),
}

/// A pair connection from Deriver A that arrived before this role's
/// preparation of the same Router run. The worker serves one connection at a
/// time, so it sets this one aside until the preparation lands, fails, or
/// the wait ends.
pub struct LocalEd25519YaoParkedPeerV1 {
    authenticated: crate::LocalEd25519YaoAuthenticatedDeriverBPeerV1,
    wait_until_ms: u64,
}

pub type LocalEd25519YaoPersistBeforeNetworkV1<'a> =
    &'a mut dyn FnMut(&LocalEd25519YaoWorkerStateV1) -> Result<(), Box<dyn std::error::Error>>;

enum LocalEd25519YaoRequestClassV1 {
    Peer,
    Control,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "family", rename_all = "snake_case", deny_unknown_fields)]
pub enum LocalEd25519YaoRoleCompletionV1 {
    Activation {
        session_hex: String,
        transcript_hex: String,
        client_commitment_hex: String,
        signing_worker_commitment_hex: String,
        frame_count: u32,
        deriver_a_to_b_transport_bytes: u64,
        deriver_b_to_a_transport_bytes: u64,
        total_ab_transport_bytes: u64,
    },
}

pub fn dispatch_local_ed25519_yao_connection_with_persistence_v1(
    mut stream: TcpStream,
    config: &LocalWorkerRoleConfigV1,
    state: &mut LocalEd25519YaoWorkerStateV1,
    host: &LocalEd25519YaoSqliteHostV1,
    persist_before_network: LocalEd25519YaoPersistBeforeNetworkV1<'_>,
) -> Result<LocalEd25519YaoConnectionDispatchV1, Box<dyn std::error::Error>> {
    match classify_request(&stream)? {
        LocalEd25519YaoRequestClassV1::Peer if config.role() == LocalServiceRoleV1::DeriverB => {
            if state.pending_deriver_b.is_none() {
                return Ok(
                    match accept_local_pair_deriver_b_peer_v1(stream, config, state, host)? {
                        Some(parked) => LocalEd25519YaoConnectionDispatchV1::Parked(parked),
                        None => LocalEd25519YaoConnectionDispatchV1::NoSnapshotWrite,
                    },
                );
            }
            let result = handle_deriver_b_peer_stream(stream, config, state);
            if result.is_err() {
                persist_before_network(state)?;
            }
            result?;
            return Ok(LocalEd25519YaoConnectionDispatchV1::Handled);
        }
        LocalEd25519YaoRequestClassV1::Control => {}
        LocalEd25519YaoRequestClassV1::Peer | LocalEd25519YaoRequestClassV1::Other => {
            return Ok(LocalEd25519YaoConnectionDispatchV1::Unhandled(stream));
        }
    }

    let mut request = read_local_dev_http_request_v1(&mut stream)?;
    let deriver_a_pair_route = config.role() == LocalServiceRoleV1::DeriverA
        && matches!(
            request.path.as_str(),
            LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH
                | LOCAL_DERIVER_A_ED25519_YAO_READ_PAIR_STATUS_PATH
                | LOCAL_DERIVER_A_ED25519_YAO_BURN_PAIR_PATH
        );
    let deriver_b_pair_route = config.role() == LocalServiceRoleV1::DeriverB
        && matches!(
            request.path.as_str(),
            LOCAL_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH
                | LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_OUTCOME_PATH
                | LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_STATUS_PATH
                | LOCAL_DERIVER_B_ED25519_YAO_BURN_PAIR_PATH
        );
    let signing_worker_state_route = config.role() == LocalServiceRoleV1::SigningWorker;
    let result = handle_yao_control_request(&mut stream, config, state, host, &request);
    request.body.fill(0);
    if let Err(error) = result {
        if deriver_a_pair_route {
            *state = LocalEd25519YaoWorkerStateV1::default();
            *state = host.load_state(LocalServiceRoleV1::DeriverA)?;
        } else if signing_worker_state_route {
            *state = LocalEd25519YaoWorkerStateV1::default();
            *state = host.load_state(LocalServiceRoleV1::SigningWorker)?;
        }
        let (status, body) =
            local_dev_http_error_body_v1(config.role(), &request.path, 400, &error.to_string())?;
        write_local_dev_http_response_v1(&mut stream, status, &body)?;
    }
    if deriver_a_pair_route || deriver_b_pair_route || signing_worker_state_route {
        Ok(LocalEd25519YaoConnectionDispatchV1::NoSnapshotWrite)
    } else {
        Ok(LocalEd25519YaoConnectionDispatchV1::Handled)
    }
}

fn handle_yao_control_request(
    stream: &mut TcpStream,
    config: &LocalWorkerRoleConfigV1,
    state: &mut LocalEd25519YaoWorkerStateV1,
    host: &LocalEd25519YaoSqliteHostV1,
    request: &crate::LocalDevHttpRequestPartsV1,
) -> Result<(), Box<dyn std::error::Error>> {
    require_local_dev_internal_service_auth_v1(request, config.internal_service_auth())
        .map_err(io::Error::other)?;
    match (config, request.path.as_str()) {
        (
            LocalWorkerRoleConfigV1::DeriverB(config),
            LOCAL_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
        ) => {
            let pair_request =
                serde_json::from_slice::<CloudflareEd25519YaoPairPrepareRequestV1>(&request.body)?;
            let prepared = prepare_local_deriver_b_pair_v1(config, host, &pair_request);
            // A connection from Deriver A may be waiting for this preparation.
            host.record_b_preparation(
                pair_request.pair_binding.session(),
                pair_request.tenant_root.outer_binding,
                prepared.is_ok(),
            );
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&prepared?)?)
        }
        (
            LocalWorkerRoleConfigV1::DeriverA(config),
            LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
        ) => {
            let pair_request =
                serde_json::from_slice::<CloudflareEd25519YaoPairExecuteRequestV1>(&request.body)?;
            let execution = execute_local_pair_deriver_a_v1(state, config, pair_request, host)?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&execution)?)
        }
        (
            LocalWorkerRoleConfigV1::DeriverA(_),
            LOCAL_DERIVER_A_ED25519_YAO_READ_PAIR_STATUS_PATH,
        ) => {
            let lookup =
                serde_json::from_slice::<CloudflareEd25519YaoPairLookupRequestV1>(&request.body)?;
            let status = read_local_a_pair_status_from_sqlite_v1(host, lookup)?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&status)?)
        }
        (
            LocalWorkerRoleConfigV1::DeriverB(_),
            LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_OUTCOME_PATH,
        ) => {
            let lookup = serde_json::from_slice::<LocalDeriverBPairOutcomeLookupV1>(&request.body)?;
            lookup.pair_binding.validate()?;
            let session = lookup.pair_binding.session();
            let pair_digest = lookup.pair_binding.pair_digest().bytes;
            let record = host.read_b_pair(session, pair_digest)?;
            let Some(LocalEd25519YaoPairRoleRecordV1::Completed {
                pair_binding,
                root_metadata_digest,
                execution_id,
                execution,
                ..
            }) = record
            else {
                return Err(pair_conflict("Deriver B exact outcome is not completed").into());
            };
            if *pair_binding != lookup.pair_binding
                || root_metadata_digest != lookup.root_metadata_digest
                || execution_id != lookup.execution_id.into_bytes()
            {
                return Err(pair_conflict("Deriver B exact outcome scope changed").into());
            }
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&execution)?)
        }
        (
            LocalWorkerRoleConfigV1::DeriverB(_),
            LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_STATUS_PATH,
        ) => {
            let lookup =
                serde_json::from_slice::<CloudflareEd25519YaoPairLookupRequestV1>(&request.body)?;
            let status = host.transition_b_pair(lookup.session, lookup.pair_digest, |current| {
                let mut selected = LocalEd25519YaoWorkerStateV1::default();
                if let Some(current) = current {
                    selected
                        .pair_roles
                        .insert(lookup.pair_digest, current.clone());
                }
                let status = read_local_pair_role_status_v1(&mut selected, lookup)?;
                Ok((selected.pair_roles.remove(&lookup.pair_digest), status))
            })?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&status)?)
        }
        (LocalWorkerRoleConfigV1::DeriverA(_), LOCAL_DERIVER_A_ED25519_YAO_BURN_PAIR_PATH) => {
            let lookup =
                serde_json::from_slice::<CloudflareEd25519YaoPairLookupRequestV1>(&request.body)?;
            let status = burn_local_a_pair_in_sqlite_v1(host, lookup)?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&status)?)
        }
        (LocalWorkerRoleConfigV1::DeriverB(_), LOCAL_DERIVER_B_ED25519_YAO_BURN_PAIR_PATH) => {
            let lookup =
                serde_json::from_slice::<CloudflareEd25519YaoPairLookupRequestV1>(&request.body)?;
            let status = host.transition_b_pair(lookup.session, lookup.pair_digest, |current| {
                let mut selected = LocalEd25519YaoWorkerStateV1::default();
                if let Some(current) = current {
                    selected
                        .pair_roles
                        .insert(lookup.pair_digest, current.clone());
                }
                let status = burn_local_pair_role_v1(&mut selected, lookup)?;
                Ok((selected.pair_roles.remove(&lookup.pair_digest), status))
            })?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&status)?)
        }
        (
            LocalWorkerRoleConfigV1::DeriverB(config),
            LOCAL_DERIVER_B_ED25519_YAO_REFRESH_STAGE_PATH,
        ) => {
            let envelope =
                serde_json::from_slice::<LocalEd25519YaoEncryptedRefreshInputV1>(&request.body)?;
            let private_key = deriver_input_private_key(&config.envelope_hpke_private_key)?;
            let role_request =
                open_local_ed25519_yao_refresh_deriver_b_input_v1(&envelope, &private_key)?;
            require_empty_pending_b(state)?;
            require_no_unpromoted_refresh_b(state)?;
            if state.staged_deriver_b_refresh.is_some() {
                return Err(io::Error::other("a Deriver B refresh is already staged").into());
            }
            let identity =
                LocalEd25519YaoEffectiveIdentityV1::from_binding(role_request.binding.ceremony());
            state
                .deriver_b_effective
                .get(&identity)
                .ok_or_else(|| {
                    io::Error::other(
                        "Deriver B refresh requires active Yao state for this identity",
                    )
                })?
                .validate_refresh_binding(&role_request.binding)?;
            consume_deriver_b_session(
                state,
                role_request.binding.ceremony().session_id.into_bytes(),
            )?;
            state.completed_deriver_b = None;
            let binding_digest = local_ed25519_yao_refresh_binding_digest_v1(&role_request.binding);
            let delta = generate_local_ed25519_yao_deriver_b_refresh_delta_v1(
                &role_request.binding,
                binding_digest,
            );
            state.staged_deriver_b_refresh = Some(StagedDeriverBRefreshV1 {
                request: role_request,
                binding_digest,
                delta,
            });
            write_local_dev_http_response_v1(stream, 200, "{\"status\":\"staged\"}")
        }
        (LocalWorkerRoleConfigV1::DeriverB(_), LOCAL_DERIVER_B_ED25519_YAO_REFRESH_DELTA_PATH) => {
            let exchange = serde_json::from_slice::<LocalEd25519YaoRefreshDeltaExchangeRequestV1>(
                &request.body,
            )?;
            let staged = state
                .staged_deriver_b_refresh
                .take()
                .ok_or_else(|| io::Error::other("no staged Deriver B refresh"))?;
            require_empty_pending_b(state)?;
            let joint = derive_local_ed25519_yao_joint_refresh_delta_v1(
                &staged.request.binding,
                staged.binding_digest,
                &exchange.deriver_a_delta,
                &staged.delta,
            )?;
            let identity =
                LocalEd25519YaoEffectiveIdentityV1::from_binding(staged.request.binding.ceremony());
            let prepared = state
                .deriver_b_effective
                .get(&identity)
                .ok_or_else(|| {
                    io::Error::other(
                        "Deriver B refresh requires active Yao state for this identity",
                    )
                })?
                .prepare_refresh(&staged.request.binding, &joint)?;
            let recipients = staged.request.recipients;
            let (binding, role) = build_local_refresh_deriver_b_v1(
                staged.request,
                prepared.candidate_contribution(),
            )?;
            let response = Zeroizing::new(serde_json::to_vec(&staged.delta)?);
            state.pending_deriver_b = Some(PendingDeriverBRoleV1::Refresh {
                binding,
                binding_digest: staged.binding_digest,
                recipients,
                prepared,
                role,
            });
            write_local_dev_http_response_v1(stream, 200, std::str::from_utf8(&response)?)
        }
        (
            LocalWorkerRoleConfigV1::DeriverA(config),
            LOCAL_DERIVER_A_ED25519_YAO_REFRESH_START_PATH,
        ) => {
            let envelope =
                serde_json::from_slice::<LocalEd25519YaoEncryptedRefreshInputV1>(&request.body)?;
            let private_key = deriver_input_private_key(&config.envelope_hpke_private_key)?;
            let role_request =
                open_local_ed25519_yao_refresh_deriver_a_input_v1(&envelope, &private_key)?;
            require_no_unpromoted_refresh_a(state)?;
            let identity =
                LocalEd25519YaoEffectiveIdentityV1::from_binding(role_request.binding.ceremony());
            state
                .deriver_a_effective
                .get(&identity)
                .ok_or_else(|| {
                    io::Error::other(
                        "Deriver A refresh requires active Yao state for this identity",
                    )
                })?
                .validate_refresh_binding(&role_request.binding)?;
            let session = role_request.binding.ceremony().session_id.into_bytes();
            consume_deriver_a_session(state, session)?;
            state.completed_deriver_a = None;
            let binding_digest = local_ed25519_yao_refresh_binding_digest_v1(&role_request.binding);
            let delta_a = generate_local_ed25519_yao_deriver_a_refresh_delta_v1(
                &role_request.binding,
                binding_digest,
            );
            let exchange = LocalEd25519YaoRefreshDeltaExchangeRequestV1 {
                deriver_a_delta: delta_a,
            };
            let delta_b = post_internal_json_v1::<_, LocalEd25519YaoDeriverBRefreshDeltaWireV1>(
                &config.deriver_b_url,
                LOCAL_DERIVER_B_ED25519_YAO_REFRESH_DELTA_PATH,
                &config.internal_service_auth,
                &exchange,
            )?;
            let joint = derive_local_ed25519_yao_joint_refresh_delta_v1(
                &role_request.binding,
                binding_digest,
                &exchange.deriver_a_delta,
                &delta_b,
            )?;
            let prepared = state
                .deriver_a_effective
                .get(&identity)
                .ok_or_else(|| {
                    io::Error::other(
                        "Deriver A refresh requires active Yao state for this identity",
                    )
                })?
                .prepare_refresh(&role_request.binding, &joint)?;
            let recipients = role_request.recipients;
            let (binding, role) =
                build_local_refresh_deriver_a_v1(role_request, prepared.candidate_contribution())?;
            let session = binding.ceremony().session_id.into_bytes();
            let completion = run_local_activation_deriver_a_http_v1(
                http_authority(&config.deriver_b_url)?,
                session,
                &config.internal_service_auth,
                role,
            )?;
            let packages = seal_activation_output_v1(
                Ed25519YaoDeriverRoleV1::DeriverA,
                session,
                recipients,
                completion.final_transcript(),
                completion.client_package().as_bytes(),
                completion.signing_worker_package().as_bytes(),
            )?;
            let receipt = public_refresh_a_completion(session, &completion);
            state.completed_deriver_a = Some(CompletedDeriverARoleV1::Refresh {
                binding,
                binding_digest,
                packages,
                promotion: DeriverARefreshPromotionStateV1::Prepared(prepared),
            });
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&receipt)?)
        }
        (
            LocalWorkerRoleConfigV1::DeriverA(_),
            LOCAL_DERIVER_A_ED25519_YAO_REFRESH_PROMOTE_PATH,
        ) => {
            let promotion =
                serde_json::from_slice::<LocalEd25519YaoRefreshPromotionRequestV1>(&request.body)?;
            let receipt = promote_deriver_a_refresh(state, promotion)?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&receipt)?)
        }
        (
            LocalWorkerRoleConfigV1::DeriverB(_),
            LOCAL_DERIVER_B_ED25519_YAO_REFRESH_PROMOTE_PATH,
        ) => {
            let promotion =
                serde_json::from_slice::<LocalEd25519YaoRefreshPromotionRequestV1>(&request.body)?;
            let receipt = promote_deriver_b_refresh(state, promotion)?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&receipt)?)
        }
        (LocalWorkerRoleConfigV1::DeriverB(_), LOCAL_DERIVER_B_ED25519_YAO_REFRESH_RESULT_PATH) => {
            let receipt = state
                .completed_deriver_b
                .as_ref()
                .map(public_deriver_b_completion)
                .transpose()?
                .ok_or_else(|| io::Error::other("no completed Deriver B refresh"))?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&receipt)?)
        }
        (
            LocalWorkerRoleConfigV1::DeriverA(_),
            path @ (LOCAL_DERIVER_A_ED25519_YAO_REFRESH_CLIENT_PACKAGE_PATH
            | LOCAL_DERIVER_A_ED25519_YAO_REFRESH_SIGNING_WORKER_PACKAGE_PATH),
        ) => {
            let envelope = encrypted_deriver_a_package(state, path)?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&envelope)?)
        }
        (
            LocalWorkerRoleConfigV1::DeriverB(_),
            path @ (LOCAL_DERIVER_B_ED25519_YAO_REFRESH_CLIENT_PACKAGE_PATH
            | LOCAL_DERIVER_B_ED25519_YAO_REFRESH_SIGNING_WORKER_PACKAGE_PATH),
        ) => {
            let envelope = encrypted_deriver_b_package(state, path)?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&envelope)?)
        }
        (
            LocalWorkerRoleConfigV1::SigningWorker(config),
            LOCAL_SIGNING_WORKER_ED25519_YAO_ACTIVATION_PACKAGES_PATH,
        ) => {
            let delivery = serde_json::from_slice::<
                LocalEd25519YaoSigningWorkerPackagePairDeliveryV1,
            >(&request.body)?;
            let scope = delivery.scope.clone();
            host.require_wallet_unfenced(&scope)?;
            let initial = delivery.deriver_a.binding.operation == router_ab_core::Ed25519YaoOperationV1::Registration;
            let receipt = state.signing_worker.accept_package_pair(config, delivery)?;
            if initial {
                host.persist_initial_ed25519_registration(state, scope)?;
            } else {
                host.persist_wallet_mutation(state, scope)?;
            }
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&receipt)?)
        }
        (
            LocalWorkerRoleConfigV1::SigningWorker(_),
            LOCAL_SIGNING_WORKER_ED25519_YAO_INITIAL_REGISTRATION_FINALIZATION_PATH,
        ) => {
            let lookup = serde_json::from_slice::<LocalEd25519YaoSigningWorkerPackagePairDeliveryV1>(
                &request.body,
            )?;
            let persisted = host.load_state(LocalServiceRoleV1::SigningWorker)?;
            let outcome = persisted
                .signing_worker
                .read_initial_registration_finalization(&lookup)?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&outcome)?)
        }
        (
            LocalWorkerRoleConfigV1::SigningWorker(_),
            LOCAL_SIGNING_WORKER_ED25519_YAO_RECOVERY_PROMOTE_PATH,
        ) => {
            let promotion = serde_json::from_slice::<
                LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1,
            >(&request.body)?;
            let scope = state.signing_worker.registered_wallet_scope(&promotion.binding)?;
            host.require_wallet_unfenced(&scope)?;
            let receipt = state.signing_worker.promote_recovery_candidate(promotion)?;
            // Persisted before the reply: the Gateway records the promotion on it.
            host.persist_wallet_mutation(state, scope)?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&receipt)?)
        }
        (
            LocalWorkerRoleConfigV1::SigningWorker(config),
            LOCAL_SIGNING_WORKER_ED25519_YAO_REFRESH_DERIVER_A_PATH,
        ) => {
            let delivery = serde_json::from_slice::<
                LocalEd25519YaoSigningWorkerRefreshPackageDeliveryV1,
            >(&request.body)?;
            let scope = state.signing_worker.registered_wallet_scope(delivery.binding.ceremony())?;
            host.require_wallet_unfenced(&scope)?;
            let receipt = state
                .signing_worker
                .accept_refresh_deriver_a(config, delivery)?;
            host.persist_wallet_mutation(state, scope)?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&receipt)?)
        }
        (
            LocalWorkerRoleConfigV1::SigningWorker(config),
            LOCAL_SIGNING_WORKER_ED25519_YAO_REFRESH_DERIVER_B_PATH,
        ) => {
            let delivery = serde_json::from_slice::<
                LocalEd25519YaoSigningWorkerRefreshPackageDeliveryV1,
            >(&request.body)?;
            let scope = state.signing_worker.registered_wallet_scope(delivery.binding.ceremony())?;
            host.require_wallet_unfenced(&scope)?;
            let receipt = state
                .signing_worker
                .accept_refresh_deriver_b(config, delivery)?;
            host.persist_wallet_mutation(state, scope)?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&receipt)?)
        }
        (
            LocalWorkerRoleConfigV1::SigningWorker(config),
            LOCAL_SIGNING_WORKER_NORMAL_SIGNING_PREPARE_PATH,
        ) => {
            let admitted: CloudflareSigningWorkerAdmittedNormalSigningPrepareRequestV2 =
                serde_json::from_slice(&request.body)?;
            let now_ms = now_unix_ms()?;
            let (active, material) = state.signing_worker.normal_signing_material(
                config,
                &admitted.scope,
                &admitted.wallet_scope,
                &admitted.trusted_admission.metadata,
            )?;
            let response = host.prepare_near(admitted, active, material, now_ms)?;
            write_local_dev_http_response_v1(stream, 200, &response)
        }
        (
            LocalWorkerRoleConfigV1::SigningWorker(config),
            LOCAL_SIGNING_WORKER_NORMAL_SIGNING_PATH,
        ) => {
            let admitted: CloudflareSigningWorkerAdmittedNormalSigningFinalizeRequestV2 =
                serde_json::from_slice(&request.body)?;
            if let Some(response) = host.read_near_terminal(&admitted)? {
                return write_local_dev_http_response_v1(stream, 200, &response);
            }
            let now_ms = now_unix_ms()?;
            let (active, material) = state.signing_worker.normal_signing_material(
                config,
                &admitted.request.scope,
                &admitted.wallet_scope,
                &admitted.trusted_admission.metadata,
            )?;
            let response = host.finalize_near(admitted, active, material, now_ms)?;
            write_local_dev_http_response_v1(stream, 200, &response)
        }
        // A linked device's Ed25519 reservation, kept beside the wallet's
        // share and persisted with it before the reply.
        (
            LocalWorkerRoleConfigV1::SigningWorker(config),
            router_ab_cloudflare::CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RESERVE_INACTIVE_SOURCE_PRESERVING_PATH,
        ) => {
            let reservation = serde_json::from_slice::<
                router_ab_cloudflare::CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1,
            >(&request.body)?;
            host.require_wallet_unfenced(&reservation.scope)?;
            let response = state.signing_worker.reserve_linked(config, &reservation)?;
            host.persist_wallet_mutation(state, reservation.scope.clone())?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&response)?)
        }
        (
            LocalWorkerRoleConfigV1::SigningWorker(_),
            router_ab_cloudflare::CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_ACTIVATE_RESERVATION_PATH,
        ) => {
            let activation = serde_json::from_slice::<
                router_ab_cloudflare::CloudflareEd25519YaoActivateReservationRequestV1,
            >(&request.body)?;
            host.require_wallet_unfenced(&activation.scope)?;
            let response = state
                .signing_worker
                .activate_linked(&activation, now_unix_ms()?)?;
            host.persist_wallet_mutation(state, activation.scope.clone())?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&response)?)
        }
        (
            LocalWorkerRoleConfigV1::SigningWorker(_),
            router_ab_cloudflare::CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_DEACTIVATE_RESERVATION_PATH,
        ) => {
            let deactivation = serde_json::from_slice::<
                router_ab_cloudflare::CloudflareEd25519YaoDeactivateReservationRequestV1,
            >(&request.body)?;
            host.require_wallet_unfenced(&deactivation.scope)?;
            let response = state
                .signing_worker
                .deactivate_linked(&deactivation, now_unix_ms()?)?;
            host.persist_wallet_mutation(state, deactivation.scope.clone())?;
            write_local_dev_http_response_v1(stream, 200, &serde_json::to_string(&response)?)
        }
        _ => Err(io::Error::other("Yao control path is not owned by this worker").into()),
    }
}

fn is_signing_worker_linking_path(path: &str) -> bool {
    matches!(
        path,
        router_ab_cloudflare::CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RESERVE_INACTIVE_SOURCE_PRESERVING_PATH
            | router_ab_cloudflare::CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_ACTIVATE_RESERVATION_PATH
            | router_ab_cloudflare::CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_DEACTIVATE_RESERVATION_PATH
    )
}

/// Checks that one role's encrypted input is the one its pair names, and
/// answers the input's digest.
fn validate_local_pair_role_input_v1(
    role: Ed25519YaoDeriverRoleV1,
    pair_binding: &router_ab_core::Ed25519YaoInputPairBindingV1,
    tenant_root: &router_ab_cloudflare::CloudflareEd25519YaoTenantRootContextV2,
    input: &Ed25519YaoEncryptedInputV1,
) -> RouterAbProtocolResult<[u8; 32]> {
    pair_binding.validate()?;
    tenant_root.validate_for_pair(pair_binding)?;
    input.validate()?;
    let expected_kind = match pair_binding.binding().operation.circuit_family() {
        router_ab_core::Ed25519YaoCircuitFamilyV1::Activation => {
            router_ab_core::Ed25519YaoInputKindV1::Activation
        }
        router_ab_core::Ed25519YaoCircuitFamilyV1::Export => {
            router_ab_core::Ed25519YaoInputKindV1::Export
        }
        router_ab_core::Ed25519YaoCircuitFamilyV1::LaneMaterialization => {
            router_ab_core::Ed25519YaoInputKindV1::LaneMaterialization
        }
    };
    if input.kind() != expected_kind
        || input.deriver() != role
        || input.session() != pair_binding.session()
    {
        return Err(invalid_worker_state(
            "pair role input does not match its binding",
        ));
    }
    let input_digest = ed25519_yao_encrypted_input_digest_v1(input)?.bytes;
    let expected_digest = match role {
        Ed25519YaoDeriverRoleV1::DeriverA => pair_binding.deriver_a_input_digest(),
        Ed25519YaoDeriverRoleV1::DeriverB => pair_binding.deriver_b_input_digest(),
    };
    if input_digest != expected_digest.bytes {
        return Err(invalid_worker_state(
            "pair role input does not match its canonical digest",
        ));
    }
    Ok(input_digest)
}

/// What Deriver B's pair session holds for a preparation request.
enum StoredDeriverBPreparationV1 {
    /// The session answers the request from its record.
    Answer(CloudflareEd25519YaoPairPreparationV1),
    /// This run's own preparation outlived its lifetime.
    Expired,
    /// Nothing serves this run: no record, or only an earlier Router run's
    /// preparation, which no connection claimed and this run's replaces.
    Absent,
}

fn stored_local_deriver_b_preparation_v1(
    current: Option<&LocalEd25519YaoPairRoleRecordV1>,
    request: &CloudflareEd25519YaoPairPrepareRequestV1,
    input_digest: [u8; 32],
    now_ms: u64,
) -> RouterAbProtocolResult<StoredDeriverBPreparationV1> {
    Ok(match current {
        None => StoredDeriverBPreparationV1::Absent,
        Some(LocalEd25519YaoPairRoleRecordV1::Prepared {
            pair_binding,
            tenant_root,
            input_digest: stored_input,
            expires_at_ms,
            ..
        }) => {
            if **pair_binding != request.pair_binding || *stored_input != input_digest {
                return Err(pair_conflict(
                    "Deriver B pair preparation conflicts with its session",
                ));
            }
            // A Router run stamps a new window into the tenant-root context
            // it sends both roles, so an earlier run's preparation cannot
            // serve this one.
            if **tenant_root != request.tenant_root {
                StoredDeriverBPreparationV1::Absent
            } else if now_ms < *expires_at_ms {
                StoredDeriverBPreparationV1::Answer(CloudflareEd25519YaoPairPreparationV1::Prepared)
            } else {
                StoredDeriverBPreparationV1::Expired
            }
        }
        Some(LocalEd25519YaoPairRoleRecordV1::Running { .. }) => {
            StoredDeriverBPreparationV1::Answer(CloudflareEd25519YaoPairPreparationV1::Running)
        }
        Some(LocalEd25519YaoPairRoleRecordV1::Completed { .. }) => {
            StoredDeriverBPreparationV1::Answer(CloudflareEd25519YaoPairPreparationV1::Completed)
        }
        Some(LocalEd25519YaoPairRoleRecordV1::Expired { .. }) => {
            return Err(pair_preparation_expired())
        }
        Some(LocalEd25519YaoPairRoleRecordV1::Burned { .. }) => {
            return Err(invalid_worker_state("pair role lifecycle is terminal"))
        }
    })
}

/// Prepares Deriver B's side of the pair for one Router run: admits its root
/// use and stores the preparation. A claimed or terminal pair answers from
/// its record and admits nothing. A repeated preparation is admitted again
/// before it is answered, so one whose admission was cancelled is refused.
fn prepare_local_deriver_b_pair_v1(
    config: &crate::LocalDeriverBWorkerConfigV1,
    host: &LocalEd25519YaoSqliteHostV1,
    request: &CloudflareEd25519YaoPairPrepareRequestV1,
) -> RouterAbProtocolResult<CloudflareEd25519YaoPairPreparationV1> {
    let input_digest = validate_local_pair_role_input_v1(
        Ed25519YaoDeriverRoleV1::DeriverB,
        &request.pair_binding,
        &request.tenant_root,
        &request.input,
    )?;
    let session = request.pair_binding.session();
    let pair_digest = request.pair_binding.pair_digest().bytes;
    let now_ms = crate::local_now_unix_ms_v1()?;
    let stored = host.transition_b_pair(session, pair_digest, |current| {
        let stored =
            stored_local_deriver_b_preparation_v1(current, request, input_digest, now_ms)?;
        let expired = matches!(stored, StoredDeriverBPreparationV1::Expired).then_some(
            LocalEd25519YaoPairRoleRecordV1::Expired {
                session,
                pair_digest,
            },
        );
        Ok((expired, stored))
    })?;
    match stored {
        StoredDeriverBPreparationV1::Answer(CloudflareEd25519YaoPairPreparationV1::Prepared)
        | StoredDeriverBPreparationV1::Absent => {}
        StoredDeriverBPreparationV1::Answer(answer) => return Ok(answer),
        StoredDeriverBPreparationV1::Expired => return Err(pair_preparation_expired()),
    }
    crate::local_tenant_root::admit_local_deriver_tenant_root_work_v1(
        &config.tenant_root,
        &request.tenant_root,
        &request.pair_binding,
    )?;
    let prepared = LocalEd25519YaoPairRoleRecordV1::Prepared {
        session,
        pair_digest,
        pair_binding: Box::new(request.pair_binding.clone()),
        tenant_root: Box::new(request.tenant_root.clone()),
        input_digest,
        root_metadata_digest: local_pair_tenant_root_metadata_digest_v1(&request.tenant_root)?,
        expires_at_ms: now_ms
            .checked_add(60_000)
            .ok_or_else(|| invalid_worker_state("pair role preparation expiry overflow"))?,
        input: Box::new(request.input.clone()),
    };
    host.transition_b_pair(session, pair_digest, |current| {
        match stored_local_deriver_b_preparation_v1(current, request, input_digest, now_ms)? {
            StoredDeriverBPreparationV1::Absent => Ok((
                Some(prepared),
                CloudflareEd25519YaoPairPreparationV1::Prepared,
            )),
            StoredDeriverBPreparationV1::Answer(answer) => Ok((None, answer)),
            StoredDeriverBPreparationV1::Expired => Err(pair_preparation_expired()),
        }
    })
}

/// Prepares Deriver A's side of the pair for this Router run: admits its
/// root use and stores the preparation. Answers the root metadata digest the
/// preparation is bound to.
///
/// A Router run stamps a new window into the tenant-root context. A
/// preparation an earlier run stored cannot serve this one, and nothing has
/// reserved it, so this run's replaces it.
fn prepare_local_deriver_a_pair_v1(
    config: &crate::LocalDeriverAWorkerConfigV1,
    host: &LocalEd25519YaoSqliteHostV1,
    scope: &LocalDeriverAPairScopeV1,
    request: &CloudflareEd25519YaoPairExecuteRequestV1,
) -> RouterAbProtocolResult<[u8; 32]> {
    validate_local_pair_role_input_v1(
        Ed25519YaoDeriverRoleV1::DeriverA,
        &request.pair_binding,
        &request.tenant_root,
        &request.input,
    )?;
    let now_ms = crate::local_now_unix_ms_v1()?;
    match host.read_a_pair(scope, &request.pair_binding)? {
        None => {}
        Some((
            _,
            LocalDeriverAPairRecordV1::Prepared {
                root_metadata_digest,
                expires_at_ms,
                payload,
                ..
            },
        )) if payload.work == request.work && payload.input == request.input => {
            if payload.tenant_root == request.tenant_root {
                if now_ms < expires_at_ms {
                    return Ok(root_metadata_digest);
                }
                return Err(pair_preparation_expired());
            }
        }
        Some(_) => return Err(pair_conflict("Deriver A pair is conflicting or terminal")),
    }
    crate::local_tenant_root::admit_local_deriver_tenant_root_work_v1(
        &config.tenant_root,
        &request.tenant_root,
        &request.pair_binding,
    )?;
    let root_metadata_digest = local_pair_tenant_root_metadata_digest_v1(&request.tenant_root)?;
    let proposed = LocalDeriverAPairRecordV1::Prepared {
        pair_binding: request.pair_binding.clone(),
        root_metadata_digest,
        expires_at_ms: now_ms
            .checked_add(60_000)
            .ok_or_else(|| invalid_worker_state("pair role preparation expiry overflow"))?,
        payload: LocalDeriverAPairPayloadV1 {
            tenant_root: request.tenant_root.clone(),
            work: request.work.clone(),
            input: request.input.clone(),
        },
    };
    match host.prepare_a_pair(scope, proposed, now_ms)? {
        Ed25519YaoPairStoreResultV1::Applied { .. }
        | Ed25519YaoPairStoreResultV1::Duplicate { .. } => Ok(root_metadata_digest),
        _ => Err(pair_conflict(
            "Deriver A pair preparation was not committed",
        )),
    }
}

/// Why Deriver A's role did not finish.
enum LocalDeriverAPairRoleFailureV1 {
    /// Deriver B answered that it holds no claim for the execution. Nothing
    /// of the protocol ran, so Deriver A's reservation can be released.
    PeerHoldsNoClaim(CloudflareEd25519YaoPairStartRefusalReasonV1),
    /// The execution failed, and Deriver B may have claimed it.
    Failed(RouterAbProtocolError),
}

impl From<RouterAbProtocolError> for LocalDeriverAPairRoleFailureV1 {
    fn from(error: RouterAbProtocolError) -> Self {
        Self::Failed(error)
    }
}

/// Runs one pair at Deriver A: prepares its own side, reserves the pair,
/// and executes it over a connection to Deriver B. The Router sends Deriver
/// B its preparation at the same time, so this connection may reach B first.
fn execute_local_pair_deriver_a_v1(
    state: &mut LocalEd25519YaoWorkerStateV1,
    config: &crate::LocalDeriverAWorkerConfigV1,
    request: CloudflareEd25519YaoPairExecuteRequestV1,
    host: &LocalEd25519YaoSqliteHostV1,
) -> RouterAbProtocolResult<CloudflareEd25519YaoPairExecuteResponseV1> {
    let pair_binding = &request.pair_binding;
    let scope = LocalDeriverAPairScopeV1::from_context(&request.tenant_root, pair_binding)?;
    let execution_id = Ed25519YaoExecutionIdV1::new(pair_binding.pair_digest().bytes)?;
    if let Some((
        _,
        LocalDeriverAPairRecordV1::Completed {
            payload, outcome, ..
        },
    )) = host.read_a_pair(&scope, pair_binding)?
    {
        if payload.tenant_root == request.tenant_root
            && payload.work == request.work
            && payload.input == request.input
        {
            return Ok(outcome);
        }
        return Err(pair_conflict(
            "Deriver A pair is conflicting or unavailable",
        ));
    }
    let root_metadata_digest = prepare_local_deriver_a_pair_v1(config, host, &scope, &request)?;
    let executor = Ed25519YaoPairExecutorV1 {
        pair_binding,
        execution_id,
        now_ms: crate::local_now_unix_ms_v1()?,
    };
    // Only the request whose reservation is applied connects to Deriver B.
    match host.reserve_a_pair(&scope, executor)? {
        Ed25519YaoPairStoreResultV1::Applied { .. } => {}
        _ => return Err(pair_conflict("Deriver A pair reservation did not win")),
    }
    let failure = match execute_local_pair_deriver_a_role_v1(
        state,
        config,
        &request,
        host,
        &scope,
        executor,
        root_metadata_digest,
    ) {
        // Only a committed completion releases the outcome. A completion
        // that arrived after the running lifetime is recorded as burned
        // instead, and that is a failure.
        Ok(outcome) => {
            return match host.complete_a_pair(
                &scope,
                pair_binding,
                execution_id,
                outcome.clone(),
                crate::local_now_unix_ms_v1()?,
                state,
            )? {
                Ed25519YaoPairStoreResultV1::Applied {
                    record: Ed25519YaoPairRecordV1::Completed { .. },
                    ..
                }
                | Ed25519YaoPairStoreResultV1::Duplicate {
                    record: Ed25519YaoPairRecordV1::Completed { .. },
                    ..
                } => Ok(outcome),
                _ => Err(pair_conflict(
                    "Deriver A pair terminal outcome was not committed",
                )),
            };
        }
        // Deriver B holds no claim and nothing of the protocol ran. The
        // reservation returns to a preparation, so a later Router run can
        // execute this pair: nothing burns.
        Err(LocalDeriverAPairRoleFailureV1::PeerHoldsNoClaim(reason)) => {
            match host.release_a_pair(&scope, executor)? {
                Ed25519YaoPairStoreResultV1::Applied { .. }
                | Ed25519YaoPairStoreResultV1::Duplicate { .. } => {
                    return Err(pair_conflict(match reason {
                        CloudflareEd25519YaoPairStartRefusalReasonV1::NotPrepared => {
                            "Deriver B holds no claim for this pair (not prepared); Deriver A released its reservation"
                        }
                        CloudflareEd25519YaoPairStartRefusalReasonV1::Expired => {
                            "Deriver B holds no claim for this pair (expired); Deriver A released its reservation"
                        }
                    }))
                }
                _ => pair_conflict("Deriver A pair reservation could not be released"),
            }
        }
        Err(LocalDeriverAPairRoleFailureV1::Failed(error)) => error,
    };
    // Deriver B may have claimed the execution, or it ran and failed: the
    // execution identity is spent here.
    match host.burn_a_pair(&scope, pair_binding, execution_id)? {
        Ed25519YaoPairStoreResultV1::Applied { .. }
        | Ed25519YaoPairStoreResultV1::Duplicate { .. } => Err(failure),
        _ => Err(pair_conflict("Deriver A failed pair was not burned")),
    }
}

/// Connects Deriver A to Deriver B for one reserved execution and runs the
/// protocol once B claimed it.
fn execute_local_pair_deriver_a_role_v1(
    state: &mut LocalEd25519YaoWorkerStateV1,
    config: &crate::LocalDeriverAWorkerConfigV1,
    request: &CloudflareEd25519YaoPairExecuteRequestV1,
    host: &LocalEd25519YaoSqliteHostV1,
    scope: &LocalDeriverAPairScopeV1,
    executor: Ed25519YaoPairExecutorV1<'_>,
    root_metadata_digest: [u8; 32],
) -> Result<CloudflareEd25519YaoPairExecuteResponseV1, LocalDeriverAPairRoleFailureV1> {
    let pair_binding = &request.pair_binding;
    let tenant_root = &request.tenant_root;
    let session = pair_binding.session();
    let private_key = deriver_input_private_key(&config.envelope_hpke_private_key)
        .map_err(|_| invalid_worker_state("Deriver A pair input key is malformed"))?;
    let role_share = crate::local_tenant_root::load_local_deriver_tenant_root_role_share_v1(
        &config.tenant_root,
        tenant_root,
        pair_binding,
    )?;
    let preface = prepare_local_deriver_a_target_v2(tenant_root, pair_binding, &role_share)?;
    let target_proof_peer_public_key =
        local_target_proof_public_key_v1(&config.target_proof_peer_public_key)?;
    let outbound_target_proof = seal_local_deriver_a_target_proof_v2(
        &tenant_root.outer_binding,
        preface.outbound_plaintext(),
        &target_proof_peer_public_key,
    )
    .map_err(|_| pair_execution_error("Deriver A target-proof encryption failed"))?;
    let pair_context = crate::local_ed25519_yao_stream::LocalEd25519YaoPairPeerContextV1 {
        pair_digest: pair_binding.pair_digest().bytes,
        execution_id: executor.execution_id,
        deadline_ms: request.deadline_ms,
    };
    let (connection, incoming_target_proof, incoming_plaintext) =
        match connect_local_deriver_a_pair_http_v2(
            http_authority(&config.deriver_b_url)
                .map_err(|_| pair_execution_error("Deriver B URL is malformed"))?,
            session,
            &config.internal_service_auth,
            &pair_context,
            &outbound_target_proof,
            private_key.as_bytes(),
        ) {
            Ok(connected) => connected,
            Err(LocalEd25519YaoPairConnectErrorV1::Refused(reason)) => {
                return Err(LocalDeriverAPairRoleFailureV1::PeerHoldsNoClaim(reason));
            }
            Err(LocalEd25519YaoPairConnectErrorV1::Failed) => {
                return Err(
                    pair_execution_error("Deriver A target-proof preface failed").into(),
                );
            }
        };
    // Deriver B claimed the execution. Deriver A's own claim is its last
    // durable step before the protocol.
    match host.claim_a_pair(
        scope,
        Ed25519YaoPairExecutorV1 {
            now_ms: crate::local_now_unix_ms_v1()?,
            ..executor
        },
    )? {
        Ed25519YaoPairStoreResultV1::Applied { .. } => {}
        _ => return Err(pair_conflict("Deriver A pair claim was not committed").into()),
    }
    let server_contribution = complete_local_deriver_a_target_v2(
        preface,
        &incoming_target_proof,
        &incoming_plaintext,
        tenant_root,
    )?;
    Ok(run_local_pair_deriver_a_protocol_v1(
        state,
        config,
        request,
        executor.execution_id,
        root_metadata_digest,
        &private_key,
        server_contribution,
        connection,
    )?)
}

/// Runs Deriver A's side of the protocol over a connection Deriver B
/// claimed, and resolves B's sealed completion.
#[allow(clippy::too_many_arguments)]
fn run_local_pair_deriver_a_protocol_v1(
    state: &mut LocalEd25519YaoWorkerStateV1,
    config: &crate::LocalDeriverAWorkerConfigV1,
    request: &CloudflareEd25519YaoPairExecuteRequestV1,
    execution_id: Ed25519YaoExecutionIdV1,
    root_metadata_digest: [u8; 32],
    private_key: &LocalEd25519YaoRecipientPrivateKeyV1,
    server_contribution: Ed25519YaoDeriverAServerContributionV1,
    connection: crate::local_ed25519_yao_stream::LocalEd25519YaoDeriverAPairConnectionV2,
) -> RouterAbProtocolResult<CloudflareEd25519YaoPairExecuteResponseV1> {
    let pair_binding = &request.pair_binding;
    let input = &request.input;
    let session = pair_binding.session();
    let (execution, deriver_b_completion) = match input.kind() {
        router_ab_core::Ed25519YaoInputKindV1::Activation => {
            let role_request =
                open_local_ed25519_yao_activation_deriver_a_input_v1(&input, &private_key)?;
            if role_request.binding != pair_binding.binding().clone() {
                return Err(pair_execution_error(
                    "Deriver A pair activation binding mismatch",
                ));
            }
            let recipients = role_request.recipients;
            let (binding, role, initial_effective) =
                build_deriver_a_activation_from_effective_state(
                    state,
                    role_request,
                    server_contribution,
                )?;
            let (completion, deriver_b_completion) =
                run_local_activation_deriver_a_pair_connected_v2(connection, role)
                    .map_err(|_| pair_execution_error("Deriver A pair activation stream failed"))?;
            let packages = seal_activation_output_v1(
                Ed25519YaoDeriverRoleV1::DeriverA,
                session,
                recipients,
                completion.final_transcript(),
                completion.client_package().as_bytes(),
                completion.signing_worker_package().as_bytes(),
            )?;
            if let Some(initial_effective) = initial_effective {
                let identity = initial_effective.identity().clone();
                if state
                    .deriver_a_effective
                    .insert(identity, initial_effective)
                    .is_some()
                {
                    return Err(invalid_worker_state(
                        "Deriver A effective identity was concurrently registered",
                    ));
                }
            }
            (
                Ed25519YaoRoleExecutionV1::Activation(Ed25519YaoActivationRoleExecutionV1::new(
                    binding,
                    Ed25519YaoDeriverRoleV1::DeriverA,
                    completion.final_transcript(),
                    completion.client_commitment(),
                    completion.signing_worker_commitment(),
                    packages.client,
                    packages.signing_worker,
                )?),
                deriver_b_completion,
            )
        }
        router_ab_core::Ed25519YaoInputKindV1::Export => {
            let role_request =
                open_local_ed25519_yao_export_deriver_a_input_v1(&input, &private_key)?;
            if role_request.binding != pair_binding.binding().clone() {
                return Err(pair_execution_error(
                    "Deriver A pair export binding mismatch",
                ));
            }
            let recipient = role_request.recipients;
            let (binding, role) =
                build_local_export_deriver_a_with_server_v1(role_request, server_contribution)?;
            let (completion, deriver_b_completion) =
                run_local_export_deriver_a_pair_connected_v2(connection, role)
                    .map_err(|_| pair_execution_error("Deriver A pair export stream failed"))?;
            let client_package = seal_export_output_v1(
                Ed25519YaoDeriverRoleV1::DeriverA,
                session,
                recipient,
                completion.final_transcript(),
                completion.export_package().as_bytes(),
            )?;
            (
                Ed25519YaoRoleExecutionV1::Export(Ed25519YaoExportRoleExecutionV1::new(
                    binding,
                    Ed25519YaoDeriverRoleV1::DeriverA,
                    completion.final_transcript(),
                    client_package,
                )?),
                deriver_b_completion,
            )
        }
        router_ab_core::Ed25519YaoInputKindV1::LaneMaterialization => {
            return Err(pair_execution_error(
                "legacy local Deriver HTTP does not support authenticated lane dispatch",
            ));
        }
    };
    let deriver_b_sealed_execution_json = resolve_local_deriver_b_completion_v1(
        config,
        &pair_binding,
        execution_id,
        root_metadata_digest,
        &execution,
        deriver_b_completion,
    )?;
    Ok(CloudflareEd25519YaoPairExecuteResponseV1 {
        deriver_a_execution: execution,
        deriver_b_sealed_execution_json,
    })
}

fn resolve_local_deriver_b_completion_v1(
    config: &crate::LocalDeriverAWorkerConfigV1,
    pair_binding: &router_ab_core::Ed25519YaoInputPairBindingV1,
    execution_id: Ed25519YaoExecutionIdV1,
    root_metadata_digest: [u8; 32],
    deriver_a_execution: &Ed25519YaoRoleExecutionV1,
    delivery: LocalEd25519YaoPairCompletionDeliveryV1,
) -> RouterAbProtocolResult<String> {
    let deriver_b_execution = match delivery {
        LocalEd25519YaoPairCompletionDeliveryV1::Received(bytes) => {
            serde_json::from_slice::<Ed25519YaoRoleExecutionV1>(&bytes)
                .map_err(|_| pair_execution_error("Deriver B sealed execution is malformed"))?
        }
        LocalEd25519YaoPairCompletionDeliveryV1::MissingAfterCleanEof => {
            let lookup = LocalDeriverBPairOutcomeLookupV1 {
                pair_binding: pair_binding.clone(),
                root_metadata_digest,
                execution_id,
            };
            post_internal_json_v1(
                &config.deriver_b_url,
                LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_OUTCOME_PATH,
                &config.internal_service_auth,
                &lookup,
            )
            .map_err(|_| pair_execution_error("Deriver B terminal outcome is unavailable"))?
        }
    };
    validate_local_deriver_b_execution_v1(pair_binding, deriver_a_execution, &deriver_b_execution)?;
    serde_json::to_string(&deriver_b_execution)
        .map_err(|_| pair_execution_error("Deriver B terminal outcome cannot be encoded"))
}

fn validate_local_deriver_b_execution_v1(
    pair_binding: &router_ab_core::Ed25519YaoInputPairBindingV1,
    deriver_a_execution: &Ed25519YaoRoleExecutionV1,
    deriver_b_execution: &Ed25519YaoRoleExecutionV1,
) -> RouterAbProtocolResult<()> {
    deriver_b_execution.validate()?;
    if deriver_b_execution.deriver() != Ed25519YaoDeriverRoleV1::DeriverB
        || deriver_b_execution.session() != pair_binding.session()
    {
        return Err(pair_execution_error(
            "Deriver B terminal execution identity changed",
        ));
    }
    match (deriver_a_execution, deriver_b_execution) {
        (Ed25519YaoRoleExecutionV1::Activation(a), Ed25519YaoRoleExecutionV1::Activation(b))
            if a.binding == *pair_binding.binding()
                && b.binding == a.binding
                && b.transcript == a.transcript =>
        {
            Ok(())
        }
        (Ed25519YaoRoleExecutionV1::Export(a), Ed25519YaoRoleExecutionV1::Export(b))
            if a.binding == *pair_binding.binding()
                && b.binding == a.binding
                && b.transcript == a.transcript =>
        {
            Ok(())
        }
        _ => Err(pair_execution_error(
            "Deriver B terminal execution differs from verified A completion",
        )),
    }
}

fn pair_execution_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}

fn local_target_proof_public_key_v1(material: &str) -> RouterAbProtocolResult<[u8; 32]> {
    let encoded = material.strip_prefix("x25519:").ok_or_else(|| {
        invalid_worker_state("local target-proof public key must use x25519:<hex>")
    })?;
    let key: [u8; 32] = hex::decode(encoded)
        .map_err(|_| invalid_worker_state("local target-proof public key is malformed"))?
        .try_into()
        .map_err(|_| invalid_worker_state("local target-proof public key must contain 32 bytes"))?;
    if key.iter().all(|byte| *byte == 0) {
        return Err(invalid_worker_state(
            "local target-proof public key must be nonzero",
        ));
    }
    Ok(key)
}

fn read_local_pair_role_status_v1(
    state: &mut LocalEd25519YaoWorkerStateV1,
    lookup: CloudflareEd25519YaoPairLookupRequestV1,
) -> RouterAbProtocolResult<CloudflareEd25519YaoPairStatusResponseV1> {
    let Some(record) = state.pair_roles.get_mut(&lookup.pair_digest) else {
        return Ok(CloudflareEd25519YaoPairStatusResponseV1::Missing {
            session: lookup.session,
            pair_digest: lookup.pair_digest,
        });
    };
    match record {
        LocalEd25519YaoPairRoleRecordV1::Prepared {
            session,
            pair_digest,
            expires_at_ms,
            ..
        } if *session == lookup.session && *pair_digest == lookup.pair_digest => {
            if crate::local_now_unix_ms_v1()? >= *expires_at_ms {
                *record = LocalEd25519YaoPairRoleRecordV1::Expired {
                    session: *session,
                    pair_digest: *pair_digest,
                };
                Ok(CloudflareEd25519YaoPairStatusResponseV1::Expired {
                    session: lookup.session,
                    pair_digest: lookup.pair_digest,
                })
            } else {
                Ok(CloudflareEd25519YaoPairStatusResponseV1::Prepared {
                    session: lookup.session,
                    pair_digest: lookup.pair_digest,
                })
            }
        }
        LocalEd25519YaoPairRoleRecordV1::Running {
            session,
            pair_digest,
            expires_at_ms,
            execution_id: _,
            ..
        } if *session == lookup.session && *pair_digest == lookup.pair_digest => {
            if crate::local_now_unix_ms_v1()? >= *expires_at_ms {
                *record = LocalEd25519YaoPairRoleRecordV1::Burned {
                    session: *session,
                    pair_digest: *pair_digest,
                };
                Ok(CloudflareEd25519YaoPairStatusResponseV1::Burned {
                    session: lookup.session,
                    pair_digest: lookup.pair_digest,
                })
            } else {
                Ok(CloudflareEd25519YaoPairStatusResponseV1::Running {
                    session: lookup.session,
                    pair_digest: lookup.pair_digest,
                })
            }
        }
        LocalEd25519YaoPairRoleRecordV1::Completed {
            session,
            pair_digest,
            execution,
            ..
        } if *session == lookup.session && *pair_digest == lookup.pair_digest => {
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Completed {
                execution: execution.clone(),
            })
        }
        LocalEd25519YaoPairRoleRecordV1::Expired {
            session,
            pair_digest,
        } if *session == lookup.session && *pair_digest == lookup.pair_digest => {
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Expired {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
        LocalEd25519YaoPairRoleRecordV1::Burned {
            session,
            pair_digest,
        } if *session == lookup.session && *pair_digest == lookup.pair_digest => {
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Burned {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
        _ => Err(invalid_worker_state("pair role lookup identity mismatch")),
    }
}

fn read_local_a_pair_status_from_sqlite_v1(
    host: &LocalEd25519YaoSqliteHostV1,
    lookup: CloudflareEd25519YaoPairLookupRequestV1,
) -> RouterAbProtocolResult<CloudflareEd25519YaoPairStatusResponseV1> {
    let Some((scope, record)) = host.read_a_pair_by_lookup(lookup.session, lookup.pair_digest)?
    else {
        return Ok(CloudflareEd25519YaoPairStatusResponseV1::Missing {
            session: lookup.session,
            pair_digest: lookup.pair_digest,
        });
    };
    match record {
        LocalDeriverAPairRecordV1::Prepared {
            pair_binding,
            expires_at_ms,
            ..
        } if crate::local_now_unix_ms_v1()? >= expires_at_ms => {
            match host.expire_a_pair(&scope, &pair_binding, crate::local_now_unix_ms_v1()?)? {
                Ed25519YaoPairStoreResultV1::Applied { .. }
                | Ed25519YaoPairStoreResultV1::Duplicate { .. } => {}
                _ => return Err(pair_conflict("Deriver A pair expiry was not committed")),
            }
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Expired {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
        LocalDeriverAPairRecordV1::Prepared { .. } => {
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Prepared {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
        LocalDeriverAPairRecordV1::Starting { .. } | LocalDeriverAPairRecordV1::Running { .. } => {
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Running {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
        LocalDeriverAPairRecordV1::Completed { outcome, .. } => {
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Completed {
                execution: Box::new(outcome.deriver_a_execution),
            })
        }
        LocalDeriverAPairRecordV1::Burned { .. } => {
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Burned {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
        LocalDeriverAPairRecordV1::Expired { .. } => {
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Expired {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
    }
}

fn burn_local_a_pair_in_sqlite_v1(
    host: &LocalEd25519YaoSqliteHostV1,
    lookup: CloudflareEd25519YaoPairLookupRequestV1,
) -> RouterAbProtocolResult<CloudflareEd25519YaoPairStatusResponseV1> {
    let Some((scope, record)) = host.read_a_pair_by_lookup(lookup.session, lookup.pair_digest)?
    else {
        return Ok(CloudflareEd25519YaoPairStatusResponseV1::Missing {
            session: lookup.session,
            pair_digest: lookup.pair_digest,
        });
    };
    match record {
        LocalDeriverAPairRecordV1::Starting {
            pair_binding,
            execution_id,
            ..
        }
        | LocalDeriverAPairRecordV1::Running {
            pair_binding,
            execution_id,
            ..
        } => {
            match host.burn_a_pair(&scope, &pair_binding, execution_id)? {
                Ed25519YaoPairStoreResultV1::Applied { .. }
                | Ed25519YaoPairStoreResultV1::Duplicate { .. } => {}
                _ => return Err(pair_conflict("Deriver A pair burn was not committed")),
            }
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Burned {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
        LocalDeriverAPairRecordV1::Burned { .. } => {
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Burned {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
        _ => Err(invalid_worker_state(
            "Deriver A pair cannot be burned in this state",
        )),
    }
}

/// Burns Deriver B's side of a pair the Router ended. A session this role
/// holds no record for is burned too: the Router sends this role its
/// preparation while Deriver A executes, so a preparation can still arrive
/// after the pair ended, and the burned record refuses it before it admits
/// anything.
fn burn_local_pair_role_v1(
    state: &mut LocalEd25519YaoWorkerStateV1,
    lookup: CloudflareEd25519YaoPairLookupRequestV1,
) -> RouterAbProtocolResult<CloudflareEd25519YaoPairStatusResponseV1> {
    let Some(record) = state.pair_roles.get_mut(&lookup.pair_digest) else {
        state.pair_roles.insert(
            lookup.pair_digest,
            LocalEd25519YaoPairRoleRecordV1::Burned {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            },
        );
        return Ok(CloudflareEd25519YaoPairStatusResponseV1::Burned {
            session: lookup.session,
            pair_digest: lookup.pair_digest,
        });
    };
    match record {
        LocalEd25519YaoPairRoleRecordV1::Burned {
            session,
            pair_digest,
        } if *session == lookup.session && *pair_digest == lookup.pair_digest => {
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Burned {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
        LocalEd25519YaoPairRoleRecordV1::Expired {
            session,
            pair_digest,
        } if *session == lookup.session && *pair_digest == lookup.pair_digest => {
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Expired {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
        LocalEd25519YaoPairRoleRecordV1::Running {
            session,
            pair_digest,
            ..
        } if *session == lookup.session && *pair_digest == lookup.pair_digest => {
            *record = LocalEd25519YaoPairRoleRecordV1::Burned {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            };
            Ok(CloudflareEd25519YaoPairStatusResponseV1::Burned {
                session: lookup.session,
                pair_digest: lookup.pair_digest,
            })
        }
        LocalEd25519YaoPairRoleRecordV1::Prepared { .. } => Err(invalid_worker_state(
            "prepared pair role cannot be burned before execution",
        )),
        _ => Err(invalid_worker_state("pair role lookup identity mismatch")),
    }
}

fn local_pair_tenant_root_metadata_digest_v1(
    tenant_root: &router_ab_cloudflare::CloudflareEd25519YaoTenantRootContextV2,
) -> RouterAbProtocolResult<[u8; 32]> {
    let receipt = tenant_root.custody_binding.activation_receipt_bytes()?;
    let digest: [u8; 32] = sha2::Sha256::digest(receipt).into();
    if digest.iter().all(|byte| *byte == 0) {
        return Err(invalid_worker_state(
            "tenant-root activation receipt digest is empty",
        ));
    }
    Ok(digest)
}

fn require_empty_pending_b(
    state: &LocalEd25519YaoWorkerStateV1,
) -> Result<(), Box<dyn std::error::Error>> {
    if state.pending_deriver_b.is_some() {
        return Err(io::Error::other("a Deriver B Yao ceremony is already staged").into());
    }
    Ok(())
}

fn consume_deriver_a_session(
    state: &mut LocalEd25519YaoWorkerStateV1,
    session: [u8; 32],
) -> Result<(), Box<dyn std::error::Error>> {
    if !state.consumed_deriver_a_sessions.insert(session) {
        return Err(io::Error::other("Deriver A Yao session has already been consumed").into());
    }
    Ok(())
}

fn consume_deriver_b_session(
    state: &mut LocalEd25519YaoWorkerStateV1,
    session: [u8; 32],
) -> Result<(), Box<dyn std::error::Error>> {
    if !state.consumed_deriver_b_sessions.insert(session) {
        return Err(io::Error::other("Deriver B Yao session has already been consumed").into());
    }
    Ok(())
}

fn require_no_unpromoted_refresh_a(
    state: &LocalEd25519YaoWorkerStateV1,
) -> Result<(), Box<dyn std::error::Error>> {
    if matches!(
        state.completed_deriver_a,
        Some(CompletedDeriverARoleV1::Refresh {
            promotion: DeriverARefreshPromotionStateV1::Prepared(_),
            ..
        })
    ) {
        return Err(io::Error::other("Deriver A has an unpromoted refresh").into());
    }
    Ok(())
}

fn require_no_unpromoted_refresh_b(
    state: &LocalEd25519YaoWorkerStateV1,
) -> Result<(), Box<dyn std::error::Error>> {
    if matches!(
        state.completed_deriver_b,
        Some(CompletedDeriverBRoleV1::Refresh {
            promotion: DeriverBRefreshPromotionStateV1::Prepared(_),
            ..
        })
    ) {
        return Err(io::Error::other("Deriver B has an unpromoted refresh").into());
    }
    Ok(())
}

fn promote_deriver_a_refresh(
    state: &mut LocalEd25519YaoWorkerStateV1,
    request: LocalEd25519YaoRefreshPromotionRequestV1,
) -> RouterAbProtocolResult<LocalEd25519YaoRefreshPromotionReceiptV1> {
    let completed = state
        .completed_deriver_a
        .as_mut()
        .ok_or_else(|| invalid_worker_state("Deriver A has no completed refresh"))?;
    let CompletedDeriverARoleV1::Refresh {
        binding,
        binding_digest,
        promotion,
        ..
    } = completed;
    if request.binding_digest != *binding_digest
        || request.session != binding.ceremony().session_id.into_bytes()
    {
        return Err(invalid_worker_state(
            "Deriver A refresh promotion binding does not match",
        ));
    }
    if let DeriverARefreshPromotionStateV1::Promoted(receipt) = promotion {
        return Ok(*receipt);
    }
    let receipt = match promotion {
        DeriverARefreshPromotionStateV1::Prepared(prepared) => {
            LocalEd25519YaoRefreshPromotionReceiptV1 {
                state_epoch: prepared.next_epoch(),
            }
        }
        DeriverARefreshPromotionStateV1::Promoted(_) => unreachable!(),
    };
    let DeriverARefreshPromotionStateV1::Prepared(prepared) = core::mem::replace(
        promotion,
        DeriverARefreshPromotionStateV1::Promoted(receipt),
    ) else {
        unreachable!();
    };
    let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(binding.ceremony());
    state
        .deriver_a_effective
        .get_mut(&identity)
        .ok_or_else(|| {
            invalid_worker_state("Deriver A refresh requires active Yao state for this identity")
        })?
        .promote(prepared)?;
    Ok(receipt)
}

fn promote_deriver_b_refresh(
    state: &mut LocalEd25519YaoWorkerStateV1,
    request: LocalEd25519YaoRefreshPromotionRequestV1,
) -> RouterAbProtocolResult<LocalEd25519YaoRefreshPromotionReceiptV1> {
    let completed = state
        .completed_deriver_b
        .as_mut()
        .ok_or_else(|| invalid_worker_state("Deriver B has no completed refresh"))?;
    let CompletedDeriverBRoleV1::Refresh {
        binding,
        binding_digest,
        promotion,
        ..
    } = completed;
    if request.binding_digest != *binding_digest
        || request.session != binding.ceremony().session_id.into_bytes()
    {
        return Err(invalid_worker_state(
            "Deriver B refresh promotion binding does not match",
        ));
    }
    if let DeriverBRefreshPromotionStateV1::Promoted(receipt) = promotion {
        return Ok(*receipt);
    }
    let receipt = match promotion {
        DeriverBRefreshPromotionStateV1::Prepared(prepared) => {
            LocalEd25519YaoRefreshPromotionReceiptV1 {
                state_epoch: prepared.next_epoch(),
            }
        }
        DeriverBRefreshPromotionStateV1::Promoted(_) => unreachable!(),
    };
    let DeriverBRefreshPromotionStateV1::Prepared(prepared) = core::mem::replace(
        promotion,
        DeriverBRefreshPromotionStateV1::Promoted(receipt),
    ) else {
        unreachable!();
    };
    let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(binding.ceremony());
    state
        .deriver_b_effective
        .get_mut(&identity)
        .ok_or_else(|| {
            invalid_worker_state("Deriver B refresh requires active Yao state for this identity")
        })?
        .promote(prepared)?;
    Ok(receipt)
}

fn post_internal_json_v1<Request, Response>(
    base_url: &str,
    path: &str,
    auth: &str,
    request: &Request,
) -> Result<Response, Box<dyn std::error::Error>>
where
    Request: Serialize,
    Response: DeserializeOwned,
{
    let authority = http_authority(base_url)?;
    let mut request_body = Zeroizing::new(serde_json::to_vec(request)?);
    let mut stream = TcpStream::connect(authority)?;
    let timeout = Duration::from_millis(LOCAL_HTTP_SERVICE_BINDING_TIMEOUT_MS_V1);
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    write!(
        stream,
        "POST {path} HTTP/1.1\r\nhost: {authority}\r\ncontent-type: application/json\r\n{LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1}: {auth}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        request_body.len()
    )?;
    stream.write_all(&request_body)?;
    stream.flush()?;
    stream.shutdown(Shutdown::Write)?;
    request_body.zeroize();
    let mut response = Zeroizing::new(Vec::new());
    stream.read_to_end(&mut response)?;
    let (status, mut response_body) = crate::split_local_http_response_v1(&response)?;
    response.zeroize();
    if !(200..=299).contains(&status) {
        response_body.zeroize();
        return Err(io::Error::other(format!(
            "internal refresh delta exchange failed with status {status}"
        ))
        .into());
    }
    let parsed = serde_json::from_slice(&response_body)?;
    response_body.zeroize();
    Ok(parsed)
}

fn seal_activation_output_v1(
    deriver: Ed25519YaoDeriverRoleV1,
    session: [u8; 32],
    recipients: LocalEd25519YaoActivationRecipientsV1,
    transcript: [u8; 32],
    client_plaintext: &[u8],
    signing_worker_plaintext: &[u8],
) -> RouterAbProtocolResult<EncryptedActivationPackagesV1> {
    Ok(EncryptedActivationPackagesV1 {
        client: seal_local_ed25519_yao_package_v1(
            Ed25519YaoPackageKindV1::ActivationClient,
            deriver,
            session,
            transcript,
            recipients.client_public_key,
            client_plaintext,
        )?,
        signing_worker: seal_local_ed25519_yao_package_v1(
            Ed25519YaoPackageKindV1::ActivationSigningWorker,
            deriver,
            session,
            transcript,
            recipients.signing_worker_public_key,
            signing_worker_plaintext,
        )?,
    })
}

fn seal_export_output_v1(
    deriver: Ed25519YaoDeriverRoleV1,
    session: [u8; 32],
    recipient: LocalEd25519YaoExportRecipientV1,
    transcript: [u8; 32],
    plaintext: &[u8],
) -> RouterAbProtocolResult<Ed25519YaoEncryptedPackageV1> {
    seal_local_ed25519_yao_package_v1(
        Ed25519YaoPackageKindV1::ExportClient,
        deriver,
        session,
        transcript,
        recipient.client_public_key,
        plaintext,
    )
}

fn encrypted_deriver_a_package(
    state: &LocalEd25519YaoWorkerStateV1,
    path: &str,
) -> Result<Ed25519YaoEncryptedPackageV1, Box<dyn std::error::Error>> {
    match (&state.completed_deriver_a, path) {
        (
            Some(CompletedDeriverARoleV1::Refresh { packages, .. }),
            LOCAL_DERIVER_A_ED25519_YAO_REFRESH_CLIENT_PACKAGE_PATH,
        ) => Ok(packages.client.clone()),
        (
            Some(CompletedDeriverARoleV1::Refresh { packages, .. }),
            LOCAL_DERIVER_A_ED25519_YAO_REFRESH_SIGNING_WORKER_PACKAGE_PATH,
        ) => Ok(packages.signing_worker.clone()),
        _ => Err(io::Error::other("requested Deriver A package is unavailable").into()),
    }
}

fn encrypted_deriver_b_package(
    state: &LocalEd25519YaoWorkerStateV1,
    path: &str,
) -> Result<Ed25519YaoEncryptedPackageV1, Box<dyn std::error::Error>> {
    match (&state.completed_deriver_b, path) {
        (
            Some(CompletedDeriverBRoleV1::Refresh { packages, .. }),
            LOCAL_DERIVER_B_ED25519_YAO_REFRESH_CLIENT_PACKAGE_PATH,
        ) => Ok(packages.client.clone()),
        (
            Some(CompletedDeriverBRoleV1::Refresh { packages, .. }),
            LOCAL_DERIVER_B_ED25519_YAO_REFRESH_SIGNING_WORKER_PACKAGE_PATH,
        ) => Ok(packages.signing_worker.clone()),
        _ => Err(io::Error::other("requested Deriver B package is unavailable").into()),
    }
}

fn handle_deriver_b_peer_stream(
    stream: TcpStream,
    config: &LocalWorkerRoleConfigV1,
    state: &mut LocalEd25519YaoWorkerStateV1,
) -> Result<(), Box<dyn std::error::Error>> {
    let auth = config.internal_service_auth().to_owned();
    let expected_session = state
        .pending_deriver_b
        .as_ref()
        .ok_or_else(|| io::Error::other("no staged Deriver B Yao role"))?
        .session();
    let authenticated =
        authenticate_local_ed25519_yao_deriver_b_peer_http_v1(stream, expected_session, &auth)?;
    let pending = state
        .pending_deriver_b
        .take()
        .ok_or_else(|| io::Error::other("authenticated Deriver B role disappeared"))?;
    let completed = match pending {
        PendingDeriverBRoleV1::Refresh {
            binding,
            binding_digest,
            recipients,
            prepared,
            role,
        } => {
            let session = binding.ceremony().session_id.into_bytes();
            let completion =
                run_local_activation_deriver_b_authenticated_http_v1(authenticated, role)?;
            let packages = seal_activation_output_v1(
                Ed25519YaoDeriverRoleV1::DeriverB,
                session,
                recipients,
                completion.final_transcript(),
                completion.client_package().as_bytes(),
                completion.signing_worker_package().as_bytes(),
            )?;
            CompletedDeriverBRoleV1::Refresh {
                binding,
                binding_digest,
                packages,
                promotion: DeriverBRefreshPromotionStateV1::Prepared(prepared),
                completion: Box::new(completion),
            }
        }
    };
    state.completed_deriver_b = Some(completed);
    Ok(())
}

fn peek_local_peer_session_v1(stream: &TcpStream) -> Result<[u8; 32], Box<dyn std::error::Error>> {
    let mut buffer = [0_u8; 8 * 1024];
    for _ in 0..250 {
        let bytes = stream.peek(&mut buffer)?;
        let head = std::str::from_utf8(&buffer[..bytes])?;
        if head.contains("\r\n\r\n") {
            let session_line = head
                .split("\r\n")
                .find(|line| {
                    line.to_ascii_lowercase()
                        .starts_with("x-seams-ed25519-yao-session:")
                })
                .ok_or_else(|| io::Error::other("pair stream session header is missing"))?;
            let value = session_line
                .split_once(':')
                .map(|(_, value)| value.trim())
                .ok_or_else(|| io::Error::other("pair stream session header is malformed"))?;
            return hex::decode(value)?.try_into().map_err(|_| {
                io::Error::other("pair stream session header must contain 32 bytes").into()
            });
        }
        thread::sleep(Duration::from_millis(1));
    }
    Err(io::Error::other("pair stream request head timed out").into())
}

/// Authenticates a pair connection from Deriver A and takes it up.
fn accept_local_pair_deriver_b_peer_v1(
    stream: TcpStream,
    config: &LocalWorkerRoleConfigV1,
    state: &mut LocalEd25519YaoWorkerStateV1,
    host: &LocalEd25519YaoSqliteHostV1,
) -> Result<Option<LocalEd25519YaoParkedPeerV1>, Box<dyn std::error::Error>> {
    let expected_session = peek_local_peer_session_v1(&stream)?;
    let authenticated = authenticate_local_ed25519_yao_deriver_b_peer_http_with_pair_v2(
        stream,
        expected_session,
        config.internal_service_auth(),
    )?;
    let pair = authenticated
        .pair_context()
        .copied()
        .ok_or_else(|| io::Error::other("no staged Deriver B Yao role"))?;
    // The connection waits for this role's preparation until the Router's
    // run ends, and no longer than one call to this role may take.
    let wait_until_ms = pair.deadline_ms.min(
        crate::local_now_unix_ms_v1()?.saturating_add(LOCAL_HTTP_SERVICE_BINDING_TIMEOUT_MS_V1),
    );
    resume_local_ed25519_yao_parked_peer_v1(
        LocalEd25519YaoParkedPeerV1 {
            authenticated,
            wait_until_ms,
        },
        config,
        state,
        host,
    )
}

/// Takes up a pair connection from Deriver A: runs the pair once this role
/// claimed it, refuses the connection while this role holds no claim, or
/// hands it back while this role's preparation of the same Router run may
/// still arrive.
pub fn resume_local_ed25519_yao_parked_peer_v1(
    parked: LocalEd25519YaoParkedPeerV1,
    config: &LocalWorkerRoleConfigV1,
    state: &mut LocalEd25519YaoWorkerStateV1,
    host: &LocalEd25519YaoSqliteHostV1,
) -> Result<Option<LocalEd25519YaoParkedPeerV1>, Box<dyn std::error::Error>> {
    let LocalEd25519YaoParkedPeerV1 {
        authenticated,
        wait_until_ms,
    } = parked;
    let pair = authenticated
        .pair_context()
        .copied()
        .ok_or_else(|| io::Error::other("parked Deriver B peer is not pair-bound"))?;
    // The target proof Deriver A sent names the Router run it belongs to.
    let outer_binding = *authenticated
        .target_proof_a_to_b()
        .ok_or_else(|| io::Error::other("Deriver B target-proof preface is missing"))?
        .binding();
    let session = authenticated.session();
    let now_ms = crate::local_now_unix_ms_v1()?;
    match claim_local_deriver_b_pair_v1(host, session, &pair, &outer_binding, now_ms)? {
        LocalDeriverBPairClaimV1::Started(running) => {
            *state = host.load_state(LocalServiceRoleV1::DeriverB)?;
            execute_local_pair_deriver_b_v1(config, state, authenticated, *running, host)?;
            Ok(None)
        }
        LocalDeriverBPairClaimV1::Refused(reason) => {
            authenticated.refuse_pair_start(reason)?;
            Ok(None)
        }
        LocalDeriverBPairClaimV1::Unprepared
            if now_ms >= wait_until_ms || host.b_preparation_failed(session, &outer_binding) =>
        {
            authenticated
                .refuse_pair_start(CloudflareEd25519YaoPairStartRefusalReasonV1::NotPrepared)?;
            Ok(None)
        }
        LocalDeriverBPairClaimV1::Unprepared => Ok(Some(LocalEd25519YaoParkedPeerV1 {
            authenticated,
            wait_until_ms,
        })),
    }
}

/// What Deriver B's pair record answers to a connection from Deriver A.
enum LocalDeriverBPairClaimV1 {
    /// This role claimed the execution: the record is running.
    Started(Box<LocalEd25519YaoPairRoleRecordV1>),
    /// This run's preparation is not here: none is, or only an earlier
    /// Router run's.
    Unprepared,
    /// This role holds no claim and will hold none.
    Refused(CloudflareEd25519YaoPairStartRefusalReasonV1),
}

/// Claims Deriver B's prepared pair for the execution Deriver A reserved.
/// The preparation must belong to the same Router run as the connection.
fn claim_local_deriver_b_pair_v1(
    host: &LocalEd25519YaoSqliteHostV1,
    session: [u8; 32],
    pair: &LocalEd25519YaoPairPeerContextV1,
    outer_binding: &Ed25519YaoOuterBindingV2,
    now_ms: u64,
) -> RouterAbProtocolResult<LocalDeriverBPairClaimV1> {
    let pair_digest = pair.pair_digest;
    host.transition_b_pair(session, pair_digest, |current| match current {
        None => Ok((None, LocalDeriverBPairClaimV1::Unprepared)),
        Some(LocalEd25519YaoPairRoleRecordV1::Prepared {
            pair_binding,
            tenant_root,
            input_digest,
            root_metadata_digest,
            expires_at_ms,
            input,
            ..
        }) => {
            if tenant_root.outer_binding != *outer_binding {
                return Ok((None, LocalDeriverBPairClaimV1::Unprepared));
            }
            pair_binding.validate()?;
            tenant_root.validate_for_pair(pair_binding)?;
            if local_pair_tenant_root_metadata_digest_v1(tenant_root)? != *root_metadata_digest {
                return Err(pair_conflict(
                    "Deriver B pair tenant-root context mismatch",
                ));
            }
            if now_ms >= *expires_at_ms {
                return Ok((
                    Some(LocalEd25519YaoPairRoleRecordV1::Expired {
                        session,
                        pair_digest,
                    }),
                    LocalDeriverBPairClaimV1::Refused(
                        CloudflareEd25519YaoPairStartRefusalReasonV1::Expired,
                    ),
                ));
            }
            let running = LocalEd25519YaoPairRoleRecordV1::Running {
                session,
                pair_digest,
                pair_binding: pair_binding.clone(),
                tenant_root: tenant_root.clone(),
                input_digest: *input_digest,
                root_metadata_digest: *root_metadata_digest,
                expires_at_ms: now_ms.checked_add(60_000).ok_or_else(|| {
                    invalid_worker_state("Deriver B pair running expiry overflow")
                })?,
                execution_id: pair.execution_id.into_bytes(),
                input: input.clone(),
            };
            Ok((
                Some(running.clone()),
                LocalDeriverBPairClaimV1::Started(Box::new(running)),
            ))
        }
        Some(LocalEd25519YaoPairRoleRecordV1::Expired { .. }) => Ok((
            None,
            LocalDeriverBPairClaimV1::Refused(
                CloudflareEd25519YaoPairStartRefusalReasonV1::Expired,
            ),
        )),
        // Running, completed or burned: this role claimed the pair before,
        // so it does not say that it holds no claim.
        Some(_) => Err(pair_conflict(
            "Deriver B pair did not enter its running state",
        )),
    })
}

/// Runs Deriver B's side of a pair it claimed, over the connection whose
/// claim it is.
fn execute_local_pair_deriver_b_v1(
    topology_config: &LocalWorkerRoleConfigV1,
    state: &mut LocalEd25519YaoWorkerStateV1,
    authenticated: crate::LocalEd25519YaoAuthenticatedDeriverBPeerV1,
    running: LocalEd25519YaoPairRoleRecordV1,
    host: &LocalEd25519YaoSqliteHostV1,
) -> Result<(), Box<dyn std::error::Error>> {
    let LocalWorkerRoleConfigV1::DeriverB(config) = topology_config else {
        return Err(io::Error::other("pair B execution requires Deriver B config").into());
    };
    let LocalEd25519YaoPairRoleRecordV1::Running {
        session,
        pair_digest,
        pair_binding,
        tenant_root,
        root_metadata_digest,
        execution_id,
        input,
        ..
    } = running.clone()
    else {
        return Err(io::Error::other("Deriver B pair is not running").into());
    };
    let private_key = deriver_input_private_key(&config.envelope_hpke_private_key)?;
    let role_share = crate::local_tenant_root::load_local_deriver_tenant_root_role_share_v1(
        &config.tenant_root,
        &tenant_root,
        &pair_binding,
    )?;
    let preface = prepare_local_deriver_b_target_v2(&tenant_root, &pair_binding, &role_share)?;
    let incoming_target_proof = authenticated
        .target_proof_a_to_b()
        .cloned()
        .ok_or_else(|| io::Error::other("Deriver B target-proof preface is missing"))?;
    let incoming_plaintext =
        open_local_deriver_b_target_proof_v2(&incoming_target_proof, private_key.as_bytes())?;
    let target_proof_peer_public_key =
        local_target_proof_public_key_v1(&config.target_proof_peer_public_key)?;
    let outbound_target_proof = seal_local_deriver_b_target_proof_v2(
        &tenant_root.outer_binding,
        preface.outbound_plaintext(),
        &target_proof_peer_public_key,
    )?;
    let server_contribution = complete_local_deriver_b_target_v2(
        preface,
        &incoming_target_proof,
        &incoming_plaintext,
        &tenant_root,
    )?;
    let (execution_result, completed_response, effective_delta) = match input.kind() {
        router_ab_core::Ed25519YaoInputKindV1::Activation => {
            let role_request =
                open_local_ed25519_yao_activation_deriver_b_input_v1(&input, &private_key)?;
            if role_request.binding != pair_binding.binding().clone() {
                return Err(io::Error::other("Deriver B pair activation binding mismatch").into());
            }
            let recipients = role_request.recipients;
            let (binding, role, initial_effective) =
                build_deriver_b_activation_from_effective_state(
                    state,
                    role_request,
                    server_contribution,
                )?;
            let (completion, completed_response) =
                match run_local_activation_deriver_b_authenticated_http_open_v2(
                    authenticated,
                    role,
                    outbound_target_proof,
                ) {
                    Ok(completion) => completion,
                    Err(error) => return Err(Box::new(error)),
                };
            let packages = seal_activation_output_v1(
                Ed25519YaoDeriverRoleV1::DeriverB,
                session,
                recipients,
                completion.final_transcript(),
                completion.client_package().as_bytes(),
                completion.signing_worker_package().as_bytes(),
            )?;
            (
                Ed25519YaoRoleExecutionV1::Activation(Ed25519YaoActivationRoleExecutionV1::new(
                    binding,
                    Ed25519YaoDeriverRoleV1::DeriverB,
                    completion.final_transcript(),
                    completion.client_commitment(),
                    completion.signing_worker_commitment(),
                    packages.client,
                    packages.signing_worker,
                )?),
                completed_response,
                initial_effective,
            )
        }
        router_ab_core::Ed25519YaoInputKindV1::Export => {
            let role_request =
                open_local_ed25519_yao_export_deriver_b_input_v1(&input, &private_key)?;
            if role_request.binding != pair_binding.binding().clone() {
                return Err(io::Error::other("Deriver B pair export binding mismatch").into());
            }
            let recipient = role_request.recipients;
            let (binding, role) =
                build_local_export_deriver_b_with_server_v1(role_request, server_contribution)?;
            let (completion, completed_response) =
                match run_local_export_deriver_b_authenticated_http_open_v2(
                    authenticated,
                    role,
                    outbound_target_proof,
                ) {
                    Ok(completion) => completion,
                    Err(error) => return Err(Box::new(error)),
                };
            let client_package = seal_export_output_v1(
                Ed25519YaoDeriverRoleV1::DeriverB,
                session,
                recipient,
                completion.final_transcript(),
                completion.export_package().as_bytes(),
            )?;
            (
                Ed25519YaoRoleExecutionV1::Export(Ed25519YaoExportRoleExecutionV1::new(
                    binding,
                    Ed25519YaoDeriverRoleV1::DeriverB,
                    completion.final_transcript(),
                    client_package,
                )?),
                completed_response,
                None,
            )
        }
        router_ab_core::Ed25519YaoInputKindV1::LaneMaterialization => {
            return Err(io::Error::other(
                "legacy local Deriver HTTP does not support authenticated lane dispatch",
            )
            .into());
        }
    };
    let serialized_execution = serde_json::to_vec(&execution_result)?;
    let completed = LocalEd25519YaoPairRoleRecordV1::Completed {
        session,
        pair_digest,
        pair_binding,
        root_metadata_digest,
        execution_id,
        execution: Box::new(execution_result),
    };
    host.complete_b_pair(session, pair_digest, &running, &completed, effective_delta)?;
    *state = host.load_state(LocalServiceRoleV1::DeriverB)?;
    completed_response.send_sealed_completion(&serialized_execution)?;
    Ok(())
}

fn classify_request(stream: &TcpStream) -> io::Result<LocalEd25519YaoRequestClassV1> {
    let mut buffer = [0_u8; 512];
    for _ in 0..250 {
        let bytes = stream.peek(&mut buffer)?;
        if let Some(line_end) = buffer[..bytes]
            .windows(2)
            .position(|window| window == b"\r\n")
        {
            let Ok(line) = std::str::from_utf8(&buffer[..line_end]) else {
                return Ok(LocalEd25519YaoRequestClassV1::Other);
            };
            let mut parts = line.split_whitespace();
            let method = parts.next().unwrap_or_default();
            let path = parts.next().unwrap_or_default();
            if method == "POST" && path == LOCAL_DERIVER_B_ED25519_YAO_PEER_PATH {
                return Ok(LocalEd25519YaoRequestClassV1::Peer);
            }
            return Ok(if is_yao_control_path(path) {
                LocalEd25519YaoRequestClassV1::Control
            } else {
                LocalEd25519YaoRequestClassV1::Other
            });
        }
        thread::sleep(Duration::from_millis(1));
    }
    Ok(LocalEd25519YaoRequestClassV1::Other)
}

fn is_yao_control_path(path: &str) -> bool {
    matches!(
        path,
        LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH
            | LOCAL_DERIVER_A_ED25519_YAO_READ_PAIR_STATUS_PATH
            | LOCAL_DERIVER_A_ED25519_YAO_BURN_PAIR_PATH
            | LOCAL_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH
            | LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_OUTCOME_PATH
            | LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_STATUS_PATH
            | LOCAL_DERIVER_B_ED25519_YAO_BURN_PAIR_PATH
            | LOCAL_DERIVER_B_ED25519_YAO_REFRESH_STAGE_PATH
            | LOCAL_DERIVER_B_ED25519_YAO_REFRESH_DELTA_PATH
            | LOCAL_DERIVER_B_ED25519_YAO_REFRESH_PROMOTE_PATH
            | LOCAL_DERIVER_B_ED25519_YAO_REFRESH_RESULT_PATH
            | LOCAL_DERIVER_A_ED25519_YAO_REFRESH_START_PATH
            | LOCAL_DERIVER_A_ED25519_YAO_REFRESH_PROMOTE_PATH
            | LOCAL_DERIVER_A_ED25519_YAO_REFRESH_CLIENT_PACKAGE_PATH
            | LOCAL_DERIVER_A_ED25519_YAO_REFRESH_SIGNING_WORKER_PACKAGE_PATH
            | LOCAL_DERIVER_B_ED25519_YAO_REFRESH_CLIENT_PACKAGE_PATH
            | LOCAL_DERIVER_B_ED25519_YAO_REFRESH_SIGNING_WORKER_PACKAGE_PATH
            | LOCAL_SIGNING_WORKER_ED25519_YAO_ACTIVATION_PACKAGES_PATH
            | LOCAL_SIGNING_WORKER_ED25519_YAO_INITIAL_REGISTRATION_FINALIZATION_PATH
            | LOCAL_SIGNING_WORKER_ED25519_YAO_RECOVERY_PROMOTE_PATH
            | LOCAL_SIGNING_WORKER_ED25519_YAO_REFRESH_DERIVER_A_PATH
            | LOCAL_SIGNING_WORKER_ED25519_YAO_REFRESH_DERIVER_B_PATH
            | LOCAL_SIGNING_WORKER_NORMAL_SIGNING_PREPARE_PATH
            | LOCAL_SIGNING_WORKER_NORMAL_SIGNING_PATH
    ) || is_signing_worker_linking_path(path)
}

fn http_authority(url: &str) -> Result<&str, Box<dyn std::error::Error>> {
    let authority = url
        .strip_prefix("http://")
        .ok_or_else(|| io::Error::other("local Deriver URL must use http://"))?;
    if authority.is_empty() || authority.contains('/') {
        return Err(io::Error::other("local Deriver URL must contain only an authority").into());
    }
    Ok(authority)
}

fn deriver_input_private_key(
    value: &str,
) -> Result<LocalEd25519YaoRecipientPrivateKeyV1, Box<dyn std::error::Error>> {
    let bytes: [u8; 32] = hex::decode(value)?
        .try_into()
        .map_err(|_| io::Error::other("Deriver input HPKE private key must contain 32 bytes"))?;
    Ok(LocalEd25519YaoRecipientPrivateKeyV1::from_bytes(bytes))
}

fn public_refresh_a_completion(
    session: [u8; 32],
    completion: &ActivationDeriverACompletion,
) -> LocalEd25519YaoRoleCompletionV1 {
    let wire = completion.wire_byte_ledger();
    LocalEd25519YaoRoleCompletionV1::Activation {
        session_hex: hex::encode(session),
        transcript_hex: hex::encode(completion.final_transcript()),
        client_commitment_hex: hex::encode(completion.client_commitment()),
        signing_worker_commitment_hex: hex::encode(completion.signing_worker_commitment()),
        frame_count: completion.stream_metrics().frame_count(),
        deriver_a_to_b_transport_bytes: wire.deriver_a_to_b_transport_bytes(),
        deriver_b_to_a_transport_bytes: wire.deriver_b_to_a_transport_bytes(),
        total_ab_transport_bytes: wire.total_ab_transport_bytes(),
    }
}

fn public_deriver_b_completion(
    completion: &CompletedDeriverBRoleV1,
) -> Result<LocalEd25519YaoRoleCompletionV1, Box<dyn std::error::Error>> {
    match completion {
        CompletedDeriverBRoleV1::Refresh {
            binding,
            completion,
            ..
        } => Ok(LocalEd25519YaoRoleCompletionV1::Activation {
            deriver_a_to_b_transport_bytes: completion
                .wire_byte_ledger()
                .deriver_a_to_b_transport_bytes(),
            deriver_b_to_a_transport_bytes: completion
                .wire_byte_ledger()
                .deriver_b_to_a_transport_bytes(),
            total_ab_transport_bytes: completion.wire_byte_ledger().total_ab_transport_bytes(),
            session_hex: hex::encode(binding.ceremony().session_id.into_bytes()),
            transcript_hex: hex::encode(completion.final_transcript()),
            client_commitment_hex: hex::encode(completion.client_commitment()),
            signing_worker_commitment_hex: hex::encode(completion.signing_worker_commitment()),
            frame_count: completion.stream_metrics().frame_count(),
        }),
    }
}

fn invalid_worker_state(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}

fn pair_conflict(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ConflictingPair, message)
}

fn pair_preparation_expired() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::PairPreparationExpired,
        "pair role preparation expired",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use curve25519_dalek::scalar::Scalar;
    use router_ab_core::{
        Ed25519YaoCeremonyIdentityV1, Ed25519YaoEpochTransitionV1, Ed25519YaoInputKindV1,
        Ed25519YaoInputPairBindingV1, Ed25519YaoRefreshEpochsV1, Ed25519YaoSessionIdV1,
        Ed25519YaoStableKeyContextBindingV1, ExpensiveWorkKindV1, LifecycleScopeV1,
        MpcMaterialActivationRefV1, PublicDigest32, RootShareEpoch,
    };
    use signer_core::ed25519_yao_derivation::{
        derive_ed25519_yao_joint_refresh_delta_v1, Ed25519YaoDeriverARefreshDeltaContributionV1,
        Ed25519YaoDeriverAServerContributionV1, Ed25519YaoDeriverBRefreshDeltaContributionV1,
        Ed25519YaoDeriverBServerContributionV1,
    };

    #[test]
    fn burning_a_session_without_a_record_refuses_its_late_preparation() {
        let mut worker = LocalEd25519YaoWorkerStateV1::default();
        let lookup = CloudflareEd25519YaoPairLookupRequestV1 {
            session: [1; 32],
            pair_digest: [2; 32],
        };
        assert!(matches!(
            read_local_pair_role_status_v1(&mut worker, lookup).expect("missing status"),
            CloudflareEd25519YaoPairStatusResponseV1::Missing { .. }
        ));
        for _ in 0..2 {
            assert!(matches!(
                burn_local_pair_role_v1(&mut worker, lookup).expect("burn"),
                CloudflareEd25519YaoPairStatusResponseV1::Burned { .. }
            ));
        }
        assert!(matches!(
            read_local_pair_role_status_v1(&mut worker, lookup).expect("burned status"),
            CloudflareEd25519YaoPairStatusResponseV1::Burned { .. }
        ));
    }

    #[test]
    fn pair_execute_route_is_classified_as_a_yao_control_request() {
        assert!(is_yao_control_path(
            LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH
        ));
    }

    #[test]
    fn running_pair_burn_transitions_to_burned_for_exact_identity() {
        let binding = ceremony(
            7,
            Ed25519YaoOperationV1::Registration,
            ExpensiveWorkKindV1::RegistrationPrepare,
            8,
        );
        let session = binding.session_id.into_bytes();
        let input_a = Ed25519YaoEncryptedInputV1::new(
            Ed25519YaoInputKindV1::Activation,
            Ed25519YaoDeriverRoleV1::DeriverA,
            Ed25519YaoOperationV1::Registration,
            session,
            [7; 32],
            [0x51; 32],
            vec![0x61; 16],
        )
        .expect("A input");
        let input_b = Ed25519YaoEncryptedInputV1::new(
            Ed25519YaoInputKindV1::Activation,
            Ed25519YaoDeriverRoleV1::DeriverB,
            Ed25519YaoOperationV1::Registration,
            session,
            [7; 32],
            [0x52; 32],
            vec![0x62; 16],
        )
        .expect("B input");
        let pair_binding = Ed25519YaoInputPairBindingV1::from_inputs(
            Ed25519YaoCeremonyIdentityV1::from_binding(binding).expect("pair identity"),
            &input_a,
            &input_b,
            PublicDigest32::new([0x71; 32]),
            PublicDigest32::new([0x72; 32]),
        )
        .expect("pair binding");
        let pair_digest = pair_binding.pair_digest().bytes;
        let mut state = LocalEd25519YaoWorkerStateV1::default();
        let root_metadata_digest = [0x81; 32];
        let input_digest = router_ab_core::ed25519_yao_encrypted_input_digest_v1(&input_b)
            .expect("input digest")
            .bytes;
        state.pair_roles.insert(
            pair_digest,
            LocalEd25519YaoPairRoleRecordV1::Running {
                session: pair_binding.session(),
                pair_digest,
                pair_binding: Box::new(pair_binding.clone()),
                tenant_root: Box::new(test_tenant_root_context(&pair_binding)),
                input_digest,
                root_metadata_digest,
                expires_at_ms: 100,
                execution_id: [0x91; 32],
                input: Box::new(input_b),
            },
        );
        let lookup = CloudflareEd25519YaoPairLookupRequestV1 {
            session: pair_binding.session(),
            pair_digest,
        };
        assert!(matches!(
            burn_local_pair_role_v1(&mut state, lookup).expect("running burn"),
            CloudflareEd25519YaoPairStatusResponseV1::Burned { .. }
        ));
        assert!(matches!(
            state.pair_roles.get(&pair_digest),
            Some(LocalEd25519YaoPairRoleRecordV1::Burned { .. })
        ));
    }

    fn test_tenant_root_context(
        pair_binding: &Ed25519YaoInputPairBindingV1,
    ) -> router_ab_cloudflare::CloudflareEd25519YaoTenantRootContextV2 {
        let pair_session = router_ab_core::Ed25519YaoPairSessionIdV2::new(pair_binding.session())
            .expect("pair session");
        let outer_binding = router_ab_core::Ed25519YaoOuterBindingV2::new(
            pair_session,
            pair_binding.binding().stable_key_context_binding,
            PublicDigest32::new([0x41; 32]),
            [0x42; 16],
            1,
            100,
        )
        .expect("outer binding");
        router_ab_cloudflare::CloudflareEd25519YaoTenantRootContextV2 {
            wallet_home: router_ab_cloudflare::WalletHomeRegion::US,
            ownership_generation: 1,
            identity: router_ab_core::TenantRootIdentityV1::new(
                "org",
                "project",
                "env",
                "local-root",
                "v1",
            )
            .expect("root identity"),
            custody_binding: router_ab_cloudflare::CloudflareTenantRootCustodyBindingWireV1 {
                activation_receipt_b64u: "AQ".to_owned(),
                operation_id: router_ab_core::TenantRootDerivationOperationIdV1::from_bytes(
                    [0x43; 16],
                )
                .expect("operation id"),
                session_id: router_ab_core::TenantRootDerivationSessionIdV1::from_bytes([0x44; 16])
                    .expect("session id"),
                nonce: router_ab_core::TenantRootDerivationNonceV1::from_bytes([0x45; 32])
                    .expect("nonce"),
                issued_at_ms: 1,
                expires_at_ms: 100,
            },
            outer_binding,
            application: router_ab_core::RouterAbEd25519YaoApplicationBindingFactsV1::new(
                pair_binding.binding().lifecycle.account_id.clone(),
                "local-key",
                "local-root",
                1,
            )
            .expect("application"),
            participant_ids: [1, 2],
        }
    }

    #[test]
    fn two_registration_identities_select_exact_recovery_refresh_export_and_promotion_state() {
        let epoch_one = Ed25519YaoStateEpochV1::new(1).expect("epoch one");
        let epoch_two = Ed25519YaoStateEpochV1::new(2).expect("epoch two");
        let mut worker = LocalEd25519YaoWorkerStateV1::default();
        for identity_tag in [1_u8, 2_u8] {
            let registration = ceremony(
                identity_tag,
                Ed25519YaoOperationV1::Registration,
                ExpensiveWorkKindV1::RegistrationPrepare,
                identity_tag,
            );
            let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&registration);
            worker.deriver_a_effective.insert(
                identity.clone(),
                LocalEd25519YaoDeriverAEffectiveStateV1::from_initial(
                    &registration,
                    epoch_one,
                    server_a(identity_tag, u64::from(identity_tag) * 100),
                )
                .expect("Deriver A registration"),
            );
            worker.deriver_b_effective.insert(
                identity,
                LocalEd25519YaoDeriverBEffectiveStateV1::from_initial(
                    &registration,
                    epoch_one,
                    server_b(identity_tag + 10, u64::from(identity_tag) * 200),
                )
                .expect("Deriver B registration"),
            );
        }
        assert_eq!(worker.deriver_a_effective.len(), 2);
        assert_eq!(worker.deriver_b_effective.len(), 2);

        for (operation, work_kind, session_tag) in [
            (
                Ed25519YaoOperationV1::Recovery,
                ExpensiveWorkKindV1::Recovery,
                3,
            ),
            (
                Ed25519YaoOperationV1::Export,
                ExpensiveWorkKindV1::KeyExport,
                4,
            ),
        ] {
            let binding = ceremony(1, operation, work_kind, session_tag);
            let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&binding);
            assert_eq!(
                contribution_a_y(worker.deriver_a_effective[&identity].active_contribution())[0],
                1
            );
            assert_eq!(
                contribution_b_y(worker.deriver_b_effective[&identity].active_contribution())[0],
                11
            );
        }

        let transition =
            Ed25519YaoEpochTransitionV1::new(epoch_one, epoch_two).expect("transition");
        let registration_material_activation = ceremony(
            1,
            Ed25519YaoOperationV1::Registration,
            ExpensiveWorkKindV1::RegistrationPrepare,
            1,
        )
        .material_activation;
        let mut refresh_ceremony = ceremony(
            1,
            Ed25519YaoOperationV1::Refresh,
            ExpensiveWorkKindV1::ServerShareRefresh,
            5,
        );
        refresh_ceremony.material_activation = registration_material_activation;
        let refresh = Ed25519YaoRefreshBindingV1::new(
            refresh_ceremony,
            [0x71; 32],
            Ed25519YaoRefreshEpochsV1 {
                deriver_a: transition,
                deriver_b: transition,
                signing_worker: transition,
            },
        )
        .expect("refresh binding");
        let refresh_identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(refresh.ceremony());
        let delta = derive_ed25519_yao_joint_refresh_delta_v1(
            Ed25519YaoDeriverARefreshDeltaContributionV1::from_secret_bytes(
                little_endian_u8(1),
                Scalar::from(5_u64).to_bytes(),
            )
            .expect("A delta"),
            Ed25519YaoDeriverBRefreshDeltaContributionV1::from_secret_bytes(
                little_endian_u8(2),
                Scalar::from(7_u64).to_bytes(),
            )
            .expect("B delta"),
        )
        .expect("joint delta");
        let prepared_a = worker.deriver_a_effective[&refresh_identity]
            .prepare_refresh(&refresh, &delta)
            .expect("prepare A");
        let prepared_b = worker.deriver_b_effective[&refresh_identity]
            .prepare_refresh(&refresh, &delta)
            .expect("prepare B");
        worker
            .deriver_a_effective
            .get_mut(&refresh_identity)
            .expect("first A identity")
            .promote(prepared_a)
            .expect("promote A");
        worker
            .deriver_b_effective
            .get_mut(&refresh_identity)
            .expect("first B identity")
            .promote(prepared_b)
            .expect("promote B");
        assert_eq!(
            worker.deriver_a_effective[&refresh_identity].active_epoch(),
            epoch_two
        );
        assert_eq!(
            worker.deriver_b_effective[&refresh_identity].active_epoch(),
            epoch_two
        );

        let second = LocalEd25519YaoEffectiveIdentityV1::from_binding(&ceremony(
            2,
            Ed25519YaoOperationV1::Export,
            ExpensiveWorkKindV1::KeyExport,
            6,
        ));
        assert_eq!(
            worker.deriver_a_effective[&second].active_epoch(),
            epoch_one
        );
        assert_eq!(
            worker.deriver_b_effective[&second].active_epoch(),
            epoch_one
        );
        assert_eq!(
            contribution_a_y(worker.deriver_a_effective[&second].active_contribution())[0],
            2
        );
        assert_eq!(
            contribution_b_y(worker.deriver_b_effective[&second].active_contribution())[0],
            12
        );
    }

    #[test]
    fn deriver_durable_state_round_trip_is_role_bound() {
        let binding = ceremony(
            7,
            Ed25519YaoOperationV1::Registration,
            ExpensiveWorkKindV1::RegistrationPrepare,
            8,
        );
        let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&binding);
        let mut worker = LocalEd25519YaoWorkerStateV1::default();
        worker.deriver_a_effective.insert(
            identity.clone(),
            LocalEd25519YaoDeriverAEffectiveStateV1::from_initial(
                &binding,
                Ed25519YaoStateEpochV1::new(3).expect("state epoch"),
                server_a(9, 10),
            )
            .expect("Deriver A state"),
        );

        let encoded = worker
            .encode_durable_state_for_role_v1(LocalServiceRoleV1::DeriverA)
            .expect("encode Deriver A state");
        let restored = LocalEd25519YaoWorkerStateV1::decode_durable_state_for_role_v1(
            LocalServiceRoleV1::DeriverA,
            &encoded,
        )
        .expect("restore Deriver A state");
        assert_eq!(restored.deriver_a_effective.len(), 1);
        assert_eq!(
            restored.deriver_a_effective[&identity].active_epoch().get(),
            3
        );
        assert_eq!(
            contribution_a_y(restored.deriver_a_effective[&identity].active_contribution()),
            little_endian_u8(9),
        );
        assert!(
            LocalEd25519YaoWorkerStateV1::decode_durable_state_for_role_v1(
                LocalServiceRoleV1::DeriverB,
                &encoded,
            )
            .is_err()
        );
    }

    fn ceremony(
        identity_tag: u8,
        operation: Ed25519YaoOperationV1,
        work_kind: ExpensiveWorkKindV1,
        session_tag: u8,
    ) -> Ed25519YaoCeremonyBindingV1 {
        Ed25519YaoCeremonyBindingV1::new(
            LifecycleScopeV1::new(
                format!("lifecycle-{identity_tag}-{session_tag}"),
                work_kind,
                RootShareEpoch::new(format!("root-epoch-{identity_tag}")).expect("root epoch"),
                format!("account-{identity_tag}"),
                format!("wallet-session-{identity_tag}"),
                format!("signer-set-{identity_tag}"),
                "signing-worker-1",
            )
            .expect("lifecycle"),
            operation,
            Ed25519YaoSessionIdV1::new([session_tag; 32]).expect("session"),
            Ed25519YaoStableKeyContextBindingV1::new([identity_tag; 32]),
            MpcMaterialActivationRefV1::new(
                format!("activation-{identity_tag}-{session_tag}"),
                format!("capability-{identity_tag}"),
                format!("account-{identity_tag}"),
                format!("key-{identity_tag}"),
                format!("lifecycle-{identity_tag}-{session_tag}"),
                "signing-worker-1",
            )
            .expect("material activation"),
        )
        .expect("ceremony")
    }

    fn little_endian_u8(value: u8) -> [u8; 32] {
        let mut bytes = [0_u8; 32];
        bytes[0] = value;
        bytes
    }

    fn server_a(y: u8, tau: u64) -> Ed25519YaoDeriverAServerContributionV1 {
        Ed25519YaoDeriverAServerContributionV1::from_secret_bytes(
            little_endian_u8(y),
            Scalar::from(tau).to_bytes(),
        )
    }

    fn server_b(y: u8, tau: u64) -> Ed25519YaoDeriverBServerContributionV1 {
        Ed25519YaoDeriverBServerContributionV1::from_secret_bytes(
            little_endian_u8(y),
            Scalar::from(tau).to_bytes(),
        )
    }

    fn contribution_a_y(contribution: Ed25519YaoDeriverAServerContributionV1) -> [u8; 32] {
        contribution.into_parts().0.into_bytes()
    }

    fn contribution_b_y(contribution: Ed25519YaoDeriverBServerContributionV1) -> [u8; 32] {
        contribution.into_parts().0.into_bytes()
    }
}
