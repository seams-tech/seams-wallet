use router_ab_core::{
    burn_ed25519_yao_pair_v1, claim_ed25519_yao_pair_v1, complete_ed25519_yao_pair_v1,
    expire_ed25519_yao_pair_v1, prepare_ed25519_yao_pair_v1, reserve_ed25519_yao_pair_v1,
    Ed25519YaoEncryptedInputV1, Ed25519YaoExecutionIdV1, Ed25519YaoInputPairBindingV1,
    Ed25519YaoPairRecordV1, Ed25519YaoPairRejectionV1, Ed25519YaoPairReservationV1,
    Ed25519YaoPairStartClaimV1, Ed25519YaoPairStoreResultV1, Ed25519YaoPairTransitionV1,
    Ed25519YaoRoleReadinessReceiptV1, Ed25519YaoRoleStartAcceptanceV1, TenantRootIdentityV1,
    TenantRootSignedActivationReceiptV1,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worker::{DurableObject, Env, Request, Response, SqlStorage, SqlStorageValue, State};

use crate::{
    ed25519_yao_lifecycle::role_d1::{
        encode_hex, encode_hex_slice, RolePairCipherV1, RolePairRecordScopeV1,
    },
    ed25519_yao_lifecycle::verify_role_start_acceptance_v1,
    ed25519_yao_router_checks::verify_role_readiness_receipt_v1,
    CloudflareDeriverAWorkerRuntimeV1, CloudflareEd25519YaoPairExecuteResponseV1,
    CloudflareEd25519YaoPairWorkV1, CloudflareEd25519YaoTenantRootContextV2,
};
#[cfg(feature = "wallet-do-harness")]
use crate::tenant_root_role_d1::{
    TenantRootWalletPairReconcileRequestV1, TenantRootWalletPairReconciliationV1,
};
#[cfg(feature = "wallet-do-harness")]
use crate::{
    ed25519_yao_lifecycle::{
        execute_deriver_a_role, fail_deriver_b_pair_after_a_error_v1,
        prepare_deriver_a_pair_readiness_for_wallet_do_v1, DeriverAPairExecutionContextV1,
    },
    CloudflareDeriverAWalletPairBurnRequestV1, CloudflareDeriverAWalletPairOutcomeResponseV1,
    CloudflareDeriverAWalletPairStatusRequestV1, CloudflareEd25519YaoPairExecuteRequestV1,
    CloudflareEd25519YaoPairPrepareRequestV1, CloudflareEd25519YaoPairStatusResponseV1,
};

const PAIR_DO_PATH: &str = "/router-ab/internal/deriver-a/wallet-pair";
#[cfg(feature = "wallet-do-harness")]
const PREPARE_WORK_PATH: &str = "/router-ab/internal/deriver-a/wallet-pair/prepare-work";
#[cfg(feature = "wallet-do-harness")]
const EXECUTE_WORK_PATH: &str = "/router-ab/internal/deriver-a/wallet-pair/execute-work";
#[cfg(feature = "wallet-do-harness")]
const STATUS_WORK_PATH: &str = "/router-ab/internal/deriver-a/wallet-pair/status-work";
#[cfg(feature = "wallet-do-harness")]
const BURN_WORK_PATH: &str = "/router-ab/internal/deriver-a/wallet-pair/burn-work";
#[cfg(feature = "wallet-do-harness")]
const RECONCILE_PATH: &str = "/router-ab/internal/deriver-a/wallet-pair/reconcile";
const PAIR_DO_BINDING: &str = "DERIVER_A_WALLET_DO";
const OWNER_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS wallet_owner (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner_json TEXT NOT NULL
    )
";
/// Each pair row keeps its sealed record, its lifecycle and whether its
/// executor ever claimed it, so the object can answer its admission's owner
/// without opening the record.
const PAIR_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS yao_pair_sessions (
        session_hex TEXT PRIMARY KEY,
        revision_text TEXT NOT NULL,
        root_identity_digest_hex TEXT NOT NULL,
        ciphertext_json TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        claimed INTEGER NOT NULL CHECK (claimed IN (0, 1))
    )
";
/// Pair sessions whose admission the role store is cancelling. A fenced pair
/// can neither be claimed nor completed here.
const FENCE_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS yao_pair_admission_fences (
        session_hex TEXT PRIMARY KEY,
        fenced_at_ms INTEGER NOT NULL
    )
";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeriverAWalletOwnerV1 {
    org_id: String,
    project_id: String,
    env_id: String,
    wallet_id: String,
}

impl DeriverAWalletOwnerV1 {
    pub(crate) fn from_root_identity(
        root: &TenantRootIdentityV1,
        wallet_id: &str,
    ) -> worker::Result<Self> {
        if wallet_id.trim().is_empty() {
            return Err(pair_error("Deriver A wallet identity is empty"));
        }
        Ok(Self {
            org_id: root.org_id().to_owned(),
            project_id: root.project_id().to_owned(),
            env_id: root.env_id().to_owned(),
            wallet_id: wallet_id.to_owned(),
        })
    }

    #[cfg(feature = "wallet-do-harness")]
    pub(crate) fn from_context(
        env: &Env,
        tenant_root: &CloudflareEd25519YaoTenantRootContextV2,
        pair: &Ed25519YaoInputPairBindingV1,
    ) -> worker::Result<Self> {
        tenant_root
            .validate_for_pair(pair)
            .map_err(|error| pair_error(error.to_string()))?;
        let issuer_keys =
            crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(
                &crate::CloudflareWorkerEnvReaderV1::new(env),
            )
            .map_err(|error| pair_error(error.to_string()))?;
        let receipt = tenant_root
            .custody_binding
            .verify_activation_receipt(&issuer_keys)
            .map_err(|error| pair_error(error.to_string()))?;
        if tenant_root
            .identity
            .digest()
            .map_err(|error| pair_error(error.to_string()))?
            != receipt.identity_digest()
        {
            return Err(pair_error(
                "Deriver A root identity differs from activation receipt",
            ));
        }
        Self::from_root_identity(&tenant_root.identity, &pair.binding().lifecycle.account_id)
    }

    fn object_name(&self) -> worker::Result<String> {
        let bytes = serde_json::to_vec(self).map_err(|error| pair_error(error.to_string()))?;
        let mut hasher = Sha256::new();
        hasher.update(b"seams/deriver-a/wallet-do/v1");
        hasher.update(bytes);
        Ok(format!(
            "deriver-a-wallet-{}",
            encode_hex_slice(&hasher.finalize())
        ))
    }

    fn check_pair(&self, pair: &Ed25519YaoInputPairBindingV1) -> worker::Result<()> {
        pair.validate()
            .map_err(|error| pair_error(error.to_string()))?;
        if pair.binding().lifecycle.account_id != self.wallet_id {
            return Err(pair_error(
                "Deriver A pair wallet differs from object owner",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeriverAPairPayloadV1 {
    pub(crate) tenant_root: CloudflareEd25519YaoTenantRootContextV2,
    pub(crate) work: CloudflareEd25519YaoPairWorkV1,
    pub(crate) input: Ed25519YaoEncryptedInputV1,
}

type PairRecord =
    Ed25519YaoPairRecordV1<DeriverAPairPayloadV1, CloudflareEd25519YaoPairExecuteResponseV1>;
type PairResult =
    Ed25519YaoPairStoreResultV1<DeriverAPairPayloadV1, CloudflareEd25519YaoPairExecuteResponseV1>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum DeriverAPairDoCommandV1 {
    Prepare {
        owner: DeriverAWalletOwnerV1,
        root_identity: TenantRootIdentityV1,
        record: PairRecord,
        now_ms: u64,
    },
    Reserve {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
        local_receipt: Ed25519YaoRoleReadinessReceiptV1,
        peer_receipt: Ed25519YaoRoleReadinessReceiptV1,
        execution_id: Ed25519YaoExecutionIdV1,
        now_ms: u64,
    },
    Claim {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
        local_receipt: Ed25519YaoRoleReadinessReceiptV1,
        peer_receipt: Ed25519YaoRoleReadinessReceiptV1,
        acceptance: Ed25519YaoRoleStartAcceptanceV1,
        execution_id: Ed25519YaoExecutionIdV1,
        now_ms: u64,
    },
    Complete {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
        outcome: CloudflareEd25519YaoPairExecuteResponseV1,
        now_ms: u64,
        running_lifetime_ms: u64,
    },
    Expire {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
        now_ms: u64,
    },
    Burn {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
    },
    Read {
        owner: DeriverAWalletOwnerV1,
        pair_binding: Ed25519YaoInputPairBindingV1,
    },
}

impl DeriverAPairDoCommandV1 {
    fn owner(&self) -> &DeriverAWalletOwnerV1 {
        match self {
            Self::Prepare { owner, .. }
            | Self::Reserve { owner, .. }
            | Self::Claim { owner, .. }
            | Self::Complete { owner, .. }
            | Self::Expire { owner, .. }
            | Self::Burn { owner, .. }
            | Self::Read { owner, .. } => owner,
        }
    }
}

pub(crate) async fn call_deriver_a_pair_do_v1(
    env: &Env,
    command: &DeriverAPairDoCommandV1,
) -> worker::Result<DeriverAPairDoResponseV1> {
    let namespace = env.durable_object(PAIR_DO_BINDING)?;
    let stub = namespace.get_by_name(&command.owner().object_name()?)?;
    let body = serde_json::to_string(command).map_err(|error| pair_error(error.to_string()))?;
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let request = worker::Request::new_with_init(
        &format!("https://router-ab-do.internal{PAIR_DO_PATH}"),
        &init,
    )?;
    let mut response = stub.fetch_with_request(request).await?;
    if response.status_code() != 200 {
        return Err(pair_error(format!(
            "Deriver A wallet object returned HTTP {}",
            response.status_code()
        )));
    }
    response.json::<DeriverAPairDoResponseV1>().await
}

#[cfg(feature = "wallet-do-harness")]
pub(crate) async fn call_deriver_a_wallet_do_work_v1<T: Serialize>(
    env: &Env,
    path: &str,
    pair: &Ed25519YaoInputPairBindingV1,
    tenant_root: &CloudflareEd25519YaoTenantRootContextV2,
    body: &T,
) -> worker::Result<Response> {
    let owner = DeriverAWalletOwnerV1::from_context(env, tenant_root, pair)?;
    let namespace = env.durable_object(PAIR_DO_BINDING)?;
    let stub = namespace.get_by_name(&owner.object_name()?)?;
    let body = serde_json::to_string(body).map_err(|error| pair_error(error.to_string()))?;
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let request = Request::new_with_init(&format!("https://router-ab-do.internal{path}"), &init)?;
    stub.fetch_with_request(request).await
}

#[cfg(feature = "wallet-do-harness")]
pub(crate) async fn call_deriver_a_wallet_do_lookup_v1<T: Serialize>(
    env: &Env,
    path: &str,
    root_identity: &TenantRootIdentityV1,
    pair: &Ed25519YaoInputPairBindingV1,
    body: &T,
) -> worker::Result<Response> {
    let owner = DeriverAWalletOwnerV1::from_root_identity(
        root_identity,
        &pair.binding().lifecycle.account_id,
    )?;
    let namespace = env.durable_object(PAIR_DO_BINDING)?;
    let stub = namespace.get_by_name(&owner.object_name()?)?;
    let body = serde_json::to_string(body).map_err(|error| pair_error(error.to_string()))?;
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let request = Request::new_with_init(&format!("https://router-ab-do.internal{path}"), &init)?;
    stub.fetch_with_request(request).await
}

#[cfg(feature = "wallet-do-harness")]
pub(crate) const fn deriver_a_wallet_do_prepare_work_path_v1() -> &'static str {
    PREPARE_WORK_PATH
}

#[cfg(feature = "wallet-do-harness")]
pub(crate) const fn deriver_a_wallet_do_execute_work_path_v1() -> &'static str {
    EXECUTE_WORK_PATH
}

#[cfg(feature = "wallet-do-harness")]
pub(crate) const fn deriver_a_wallet_do_status_work_path_v1() -> &'static str {
    STATUS_WORK_PATH
}

#[cfg(feature = "wallet-do-harness")]
pub(crate) const fn deriver_a_wallet_do_burn_work_path_v1() -> &'static str {
    BURN_WORK_PATH
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum DeriverAPairDoResponseV1 {
    Mutation { result: PairResult },
    Read { revision: u64, record: PairRecord },
    Missing,
}

#[derive(Deserialize)]
struct PairRowV1 {
    revision_text: String,
    root_identity_digest_hex: String,
    ciphertext_json: String,
}

#[derive(Deserialize)]
struct OwnerRowV1 {
    owner_json: String,
}

#[derive(Deserialize)]
struct RevisionRowV1 {
    revision_text: String,
}

#[derive(Deserialize)]
struct PairProgressRowV1 {
    lifecycle: String,
    claimed: i64,
}

#[derive(Deserialize)]
struct FencedSessionRowV1 {
    #[serde(rename = "session_hex")]
    _session_hex: String,
}

struct SelectedPairV1 {
    revision: u64,
    root_identity_digest_hex: String,
    record: PairRecord,
    scope: RolePairRecordScopeV1,
}

/// All pair mutations run synchronously inside this wallet's object. Every
/// conditional SQL statement is atomic; no network call occurs between read
/// and CAS.
#[worker::durable_object]
pub struct RouterAbDeriverAWalletDurableObject {
    sql: SqlStorage,
    env: Env,
}

impl DurableObject for RouterAbDeriverAWalletDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self {
            sql: state.storage().sql(),
            env,
        }
    }

    async fn fetch(&self, mut request: Request) -> worker::Result<Response> {
        if request.method() != worker::Method::Post {
            return Response::error("Unknown Deriver A wallet object request", 404);
        }
        let path = request.path();
        self.sql.exec(OWNER_SCHEMA, None)?;
        self.sql.exec(PAIR_SCHEMA, None)?;
        self.sql.exec(FENCE_SCHEMA, None)?;
        match path.as_str() {
            PAIR_DO_PATH => {
                let command: DeriverAPairDoCommandV1 = request.json().await?;
                let response = self.execute(command)?;
                Response::from_json(&response)
            }
            #[cfg(feature = "wallet-do-harness")]
            PREPARE_WORK_PATH => {
                let work: CloudflareEd25519YaoPairPrepareRequestV1 = request.json().await?;
                let receipt = self.prepare_work(work).await?;
                Response::from_json(&receipt)
            }
            #[cfg(feature = "wallet-do-harness")]
            EXECUTE_WORK_PATH => {
                let work: CloudflareEd25519YaoPairExecuteRequestV1 = request.json().await?;
                let outcome = self.execute_work(work).await?;
                Response::from_json(&outcome)
            }
            #[cfg(feature = "wallet-do-harness")]
            STATUS_WORK_PATH => {
                let lookup: CloudflareDeriverAWalletPairStatusRequestV1 = request.json().await?;
                Response::from_json(&self.status_work(lookup)?)
            }
            #[cfg(feature = "wallet-do-harness")]
            BURN_WORK_PATH => {
                let lookup: CloudflareDeriverAWalletPairBurnRequestV1 = request.json().await?;
                Response::from_json(&self.burn_work(lookup)?)
            }
            #[cfg(feature = "wallet-do-harness")]
            RECONCILE_PATH => {
                let reconcile: TenantRootWalletPairReconcileRequestV1 = request.json().await?;
                Response::from_json(&self.reconcile(&reconcile)?)
            }
            _ => Response::error("Unknown Deriver A wallet object request", 404),
        }
    }
}

impl RouterAbDeriverAWalletDurableObject {
    /// Answers the role store that owns a pair session's admission. When
    /// asked, it first fences the pair unless its executor claimed it or it
    /// completed. Both checks and the fence run in one statement. A fence
    /// also covers a session this object never prepared.
    #[cfg(feature = "wallet-do-harness")]
    fn reconcile(
        &self,
        request: &TenantRootWalletPairReconcileRequestV1,
    ) -> worker::Result<TenantRootWalletPairReconciliationV1> {
        validate_session_hex(&request.session_hex)?;
        if request.fence {
            self.sql.exec(
                "INSERT INTO yao_pair_admission_fences (session_hex, fenced_at_ms) \
                 SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM yao_pair_sessions \
                 WHERE session_hex = ? AND (claimed = 1 OR lifecycle = 'completed')) \
                 ON CONFLICT DO NOTHING",
                vec![
                    SqlStorageValue::String(request.session_hex.clone()),
                    SqlStorageValue::Integer(i64::try_from(request.now_ms).map_err(pair_error_of)?),
                    SqlStorageValue::String(request.session_hex.clone()),
                ],
            )?;
        }
        let pair = self
            .sql
            .exec(
                "SELECT lifecycle, claimed FROM yao_pair_sessions WHERE session_hex = ?",
                vec![SqlStorageValue::String(request.session_hex.clone())],
            )?
            .to_array::<PairProgressRowV1>()?
            .into_iter()
            .next();
        Ok(match pair {
            Some(pair) if pair.lifecycle == "completed" => {
                TenantRootWalletPairReconciliationV1::Completed
            }
            _ if self.pair_fenced(&request.session_hex)? => TenantRootWalletPairReconciliationV1::Fenced,
            Some(pair) if pair.claimed == 1 => TenantRootWalletPairReconciliationV1::Claimed,
            _ => TenantRootWalletPairReconciliationV1::Open,
        })
    }

    fn pair_fenced(&self, session_hex: &str) -> worker::Result<bool> {
        Ok(!self
            .sql
            .exec(
                "SELECT session_hex FROM yao_pair_admission_fences WHERE session_hex = ?",
                vec![SqlStorageValue::String(session_hex.to_owned())],
            )?
            .to_array::<FencedSessionRowV1>()?
            .is_empty())
    }

    #[cfg(feature = "wallet-do-harness")]
    fn status_work(
        &self,
        request: CloudflareDeriverAWalletPairStatusRequestV1,
    ) -> worker::Result<CloudflareDeriverAWalletPairOutcomeResponseV1> {
        let owner = DeriverAWalletOwnerV1::from_root_identity(
            &request.root_identity,
            &request.pair_binding.binding().lifecycle.account_id,
        )?;
        let cipher = RolePairCipherV1::from_env_for_wallet_do(&self.env)?;
        let selected = self.read_scoped(
            &owner,
            &cipher,
            &request.pair_binding,
            &request.root_identity,
        )?;
        Ok(match selected {
            Some(row) => pair_outcome_status(&row.record),
            None => CloudflareDeriverAWalletPairOutcomeResponseV1::Missing {
                session: request.pair_binding.session(),
                pair_digest: request.pair_binding.pair_digest().bytes,
            },
        })
    }

    #[cfg(feature = "wallet-do-harness")]
    fn burn_work(
        &self,
        request: CloudflareDeriverAWalletPairBurnRequestV1,
    ) -> worker::Result<CloudflareEd25519YaoPairStatusResponseV1> {
        let expected_execution =
            Ed25519YaoExecutionIdV1::new(request.pair_binding.pair_digest().bytes)
                .map_err(|error| pair_error(error.to_string()))?;
        if request.execution_id != expected_execution {
            return Err(pair_error(
                "Deriver A cancellation execution identity differs from pair",
            ));
        }
        let owner = DeriverAWalletOwnerV1::from_root_identity(
            &request.root_identity,
            &request.pair_binding.binding().lifecycle.account_id,
        )?;
        let cipher = RolePairCipherV1::from_env_for_wallet_do(&self.env)?;
        let selected = self.read_scoped(
            &owner,
            &cipher,
            &request.pair_binding,
            &request.root_identity,
        )?;
        let Some(selected) = selected else {
            return Ok(CloudflareEd25519YaoPairStatusResponseV1::Missing {
                session: request.pair_binding.session(),
                pair_digest: request.pair_binding.pair_digest().bytes,
            });
        };
        if !matches!(
            selected.record,
            PairRecord::Starting { .. } | PairRecord::Running { .. } | PairRecord::Burned { .. }
        ) {
            return Err(pair_error(
                "Deriver A pair cannot be cancelled in its current state",
            ));
        }
        let result = self.execute(DeriverAPairDoCommandV1::Burn {
            owner,
            pair_binding: request.pair_binding,
            execution_id: request.execution_id,
        })?;
        match result {
            DeriverAPairDoResponseV1::Mutation {
                result: PairResult::Applied { record, .. } | PairResult::Duplicate { record, .. },
            } if matches!(record, PairRecord::Burned { .. }) => Ok(pair_status(&record)),
            _ => Err(pair_error("Deriver A pair cancellation was not committed")),
        }
    }

    #[cfg(feature = "wallet-do-harness")]
    async fn prepare_work(
        &self,
        request: CloudflareEd25519YaoPairPrepareRequestV1,
    ) -> worker::Result<Ed25519YaoRoleReadinessReceiptV1> {
        if !matches!(request.work, CloudflareEd25519YaoPairWorkV1::Ceremony) {
            return Err(pair_error(
                "Deriver A wallet DO lane execution is unavailable",
            ));
        }
        let pair = &request.pair_binding;
        let owner = DeriverAWalletOwnerV1::from_context(&self.env, &request.tenant_root, pair)?;
        let cipher = RolePairCipherV1::from_env_for_wallet_do(&self.env)?;
        if let Some(existing) =
            self.read_scoped(&owner, &cipher, pair, &request.tenant_root.identity)?
        {
            self.check_owner(&owner, false)?;
            return match existing.record {
                PairRecord::Prepared {
                    receipt,
                    payload,
                    expires_at_ms,
                    ..
                } if payload.tenant_root == request.tenant_root
                    && payload.work == request.work
                    && payload.input == request.input
                    && crate::cloudflare_now_unix_ms_v1()
                        .map_err(|error| pair_error(error.to_string()))?
                        < expires_at_ms =>
                {
                    Ok(receipt)
                }
                _ => Err(pair_error("Deriver A pair is conflicting or terminal")),
            };
        }
        let receipt =
            prepare_deriver_a_pair_readiness_for_wallet_do_v1(&self.env, &request, owner.object_name()?)
            .await
            .map_err(|error| pair_error(error.to_string()))?;
        self.check_owner(&owner, true)?;
        let record = PairRecord::Prepared {
            pair_binding: pair.clone(),
            root_metadata_digest: receipt.root_metadata_digest().bytes,
            expires_at_ms: receipt.expires_at_ms(),
            receipt: receipt.clone(),
            payload: DeriverAPairPayloadV1 {
                tenant_root: request.tenant_root,
                work: request.work,
                input: request.input,
            },
        };
        let result = self.mutate(&owner, &cipher, pair, |current| {
            prepare_ed25519_yao_pair_v1(current, record, receipt.prepared_at_ms())
        })?;
        match result {
            PairResult::Applied { .. } | PairResult::Duplicate { .. } => Ok(receipt),
            _ => Err(pair_error("Deriver A pair preparation was not committed")),
        }
    }

    #[cfg(feature = "wallet-do-harness")]
    async fn execute_work(
        &self,
        request: CloudflareEd25519YaoPairExecuteRequestV1,
    ) -> worker::Result<CloudflareEd25519YaoPairExecuteResponseV1> {
        if !matches!(request.work, CloudflareEd25519YaoPairWorkV1::Ceremony) {
            return Err(pair_error(
                "Deriver A wallet DO lane execution is unavailable",
            ));
        }
        request
            .validate()
            .map_err(|error| pair_error(error.to_string()))?;
        let pair = &request.pair_binding;
        let owner = DeriverAWalletOwnerV1::from_context(&self.env, &request.tenant_root, pair)?;
        self.check_owner(&owner, false)?;
        let cipher = RolePairCipherV1::from_env_for_wallet_do(&self.env)?;
        let selected = self
            .read_scoped(&owner, &cipher, pair, &request.tenant_root.identity)?
            .ok_or_else(|| pair_error("Deriver A pair is not prepared"))?;
        match selected.record {
            PairRecord::Completed {
                claim_identity,
                payload,
                outcome,
                ..
            } if payload.tenant_root == request.tenant_root
                && payload.work == request.work
                && payload.input == request.input
                && claim_identity.local_receipt == request.local_receipt
                && claim_identity.peer_receipt == request.peer_receipt =>
            {
                return Ok(outcome)
            }
            PairRecord::Prepared {
                payload,
                receipt,
                root_metadata_digest,
                ..
            } if payload.tenant_root == request.tenant_root
                && payload.work == request.work
                && payload.input == request.input
                && receipt == request.local_receipt
                && root_metadata_digest == request.local_receipt.root_metadata_digest().bytes => {}
            _ => return Err(pair_error("Deriver A pair is conflicting or unavailable")),
        }
        let runtime = CloudflareDeriverAWorkerRuntimeV1::from_worker_env(&self.env)
            .map_err(|error| pair_error(error.to_string()))?;
        for receipt in [&request.local_receipt, &request.peer_receipt] {
            verify_role_readiness_receipt_v1(receipt, runtime.peer_verifying_keys())
                .map_err(|error| pair_error(error.to_string()))?;
        }
        let execution_id = Ed25519YaoExecutionIdV1::new(pair.pair_digest().bytes)
            .map_err(|error| pair_error(error.to_string()))?;
        let now_ms =
            crate::cloudflare_now_unix_ms_v1().map_err(|error| pair_error(error.to_string()))?;
        let reserved = self.execute(DeriverAPairDoCommandV1::Reserve {
            owner: owner.clone(),
            pair_binding: pair.clone(),
            local_receipt: request.local_receipt.clone(),
            peer_receipt: request.peer_receipt.clone(),
            execution_id,
            now_ms,
        })?;
        if !matches!(
            reserved,
            DeriverAPairDoResponseV1::Mutation {
                result: PairResult::Applied { .. }
            }
        ) {
            return Err(pair_error("Deriver A pair reservation did not win"));
        }
        let pair_execution = DeriverAPairExecutionContextV1 {
            pair_object: Some(owner.object_name()?),
            expected_root_metadata_digest: request.local_receipt.root_metadata_digest().bytes,
            pair_binding: pair,
            tenant_root: &request.tenant_root,
            work: request.work.clone(),
            pair_digest: pair.pair_digest().bytes,
            execution_id,
            peer_receipt: &request.peer_receipt,
            local_receipt: &request.local_receipt,
        };
        let role_result = execute_deriver_a_role(
            &self.env,
            &runtime,
            request.input.clone(),
            None,
            pair_execution,
            |acceptance| async {
                let claimed = self
                    .execute(DeriverAPairDoCommandV1::Claim {
                        owner: owner.clone(),
                        pair_binding: pair.clone(),
                        local_receipt: request.local_receipt.clone(),
                        peer_receipt: request.peer_receipt.clone(),
                        acceptance,
                        execution_id,
                        now_ms: crate::cloudflare_now_unix_ms_v1()?,
                    })
                    .map_err(|error| {
                        crate::ed25519_yao_lifecycle::invalid_lifecycle(error.to_string())
                    })?;
                if matches!(
                    claimed,
                    DeriverAPairDoResponseV1::Mutation {
                        result: PairResult::Applied { .. }
                    }
                ) {
                    Ok(())
                } else {
                    Err(crate::ed25519_yao_lifecycle::invalid_lifecycle(
                        "Deriver A pair claim did not commit",
                    ))
                }
            },
        )
        .await;
        let role_result = match role_result {
            Ok(result) => result,
            Err(error) => {
                let _ = self.execute(DeriverAPairDoCommandV1::Burn {
                    owner,
                    pair_binding: pair.clone(),
                    execution_id,
                });
                fail_deriver_b_pair_after_a_error_v1(
                    &self.env,
                    &crate::CloudflareDeriverBWalletPairScopeV1 {
                        root_identity: request.tenant_root.identity.clone(),
                        pair_binding: pair.clone(),
                    },
                )
                .await;
                return Err(pair_error(error.to_string()));
            }
        };
        let outcome = CloudflareEd25519YaoPairExecuteResponseV1 {
            deriver_a_execution: role_result.deriver_a_execution,
            deriver_b_sealed_execution_json: role_result.deriver_b_sealed_execution_json,
        };
        let object_name = owner.object_name()?;
        let completed = self.execute(DeriverAPairDoCommandV1::Complete {
            owner,
            pair_binding: pair.clone(),
            execution_id,
            outcome: outcome.clone(),
            now_ms: crate::cloudflare_now_unix_ms_v1()
                .map_err(|error| pair_error(error.to_string()))?,
            running_lifetime_ms: 60_000,
        })?;
        // Only a committed completion releases the outcome: one that came
        // after the running lifetime is recorded as burned, a failure.
        match completed {
            DeriverAPairDoResponseV1::Mutation {
                result:
                    PairResult::Applied {
                        record: PairRecord::Completed { .. },
                        ..
                    },
            } => {
                // The admission's owner settles it now. If this is lost, the
                // admission stays unsettled until the owner reconciles it
                // with this object, which reports the same completion.
                if let Err(error) = crate::ed25519_yao_lifecycle::role_d1::settle_wallet_object_admission_v1(
                    &self.env,
                    "deriver_a",
                    &encode_hex(pair.session()),
                    &object_name,
                )
                .await
                {
                    worker::console_error!(
                        "Deriver A pair completed, but its admission settlement was not acknowledged: {error}"
                    );
                }
                Ok(outcome)
            }
            _ => Err(pair_error("Deriver A pair completion did not commit")),
        }
    }

    fn execute(
        &self,
        command: DeriverAPairDoCommandV1,
    ) -> worker::Result<DeriverAPairDoResponseV1> {
        let owner = command.owner().clone();
        if let DeriverAPairDoCommandV1::Prepare {
            root_identity,
            record,
            ..
        } = &command
        {
            self.validate_preparation(&owner, root_identity, record)?;
            if let PairRecord::Prepared { receipt, .. } = record {
                let runtime = CloudflareDeriverAWorkerRuntimeV1::from_worker_env(&self.env)
                    .map_err(|error| pair_error(error.to_string()))?;
                verify_role_readiness_receipt_v1(receipt, runtime.peer_verifying_keys())
                    .map_err(|error| pair_error(error.to_string()))?;
            }
        }
        let may_initialize = matches!(command, DeriverAPairDoCommandV1::Prepare { .. });
        self.check_owner(&owner, may_initialize)?;
        let cipher = RolePairCipherV1::from_env_for_wallet_do(&self.env)?;
        let result = match command {
            DeriverAPairDoCommandV1::Prepare { record, now_ms, .. } => {
                let pair = record.pair_binding().clone();
                self.mutate(&owner, &cipher, &pair, |current| {
                    prepare_ed25519_yao_pair_v1(current, record, now_ms)
                })?
            }
            DeriverAPairDoCommandV1::Reserve {
                pair_binding,
                local_receipt,
                peer_receipt,
                execution_id,
                now_ms,
                ..
            } => {
                let runtime = CloudflareDeriverAWorkerRuntimeV1::from_worker_env(&self.env)
                    .map_err(|error| pair_error(error.to_string()))?;
                for receipt in [&local_receipt, &peer_receipt] {
                    verify_role_readiness_receipt_v1(receipt, runtime.peer_verifying_keys())
                        .map_err(|error| pair_error(error.to_string()))?;
                }
                self.mutate(&owner, &cipher, &pair_binding, |current| match current {
                    Some(record) => reserve_ed25519_yao_pair_v1(
                        record,
                        Ed25519YaoPairReservationV1 {
                            pair_binding: &pair_binding,
                            local_receipt: &local_receipt,
                            peer_receipt: &peer_receipt,
                            execution_id,
                            now_ms,
                        },
                    ),
                    None => Ed25519YaoPairTransitionV1::Reject(
                        Ed25519YaoPairRejectionV1::IdentityMismatch,
                    ),
                })?
            }
            DeriverAPairDoCommandV1::Claim {
                pair_binding,
                local_receipt,
                peer_receipt,
                acceptance,
                execution_id,
                now_ms,
                ..
            } => {
                let runtime = CloudflareDeriverAWorkerRuntimeV1::from_worker_env(&self.env)
                    .map_err(|error| pair_error(error.to_string()))?;
                for receipt in [&local_receipt, &peer_receipt] {
                    verify_role_readiness_receipt_v1(receipt, runtime.peer_verifying_keys())
                        .map_err(|error| pair_error(error.to_string()))?;
                }
                verify_role_start_acceptance_v1(&acceptance, runtime.peer_verifying_keys())
                    .map_err(|error| pair_error(error.to_string()))?;
                self.mutate(&owner, &cipher, &pair_binding, |current| match current {
                    Some(record) => claim_ed25519_yao_pair_v1(
                        record,
                        Ed25519YaoPairStartClaimV1 {
                            pair_binding: &pair_binding,
                            local_receipt: &local_receipt,
                            peer_receipt: &peer_receipt,
                            acceptance: &acceptance,
                            execution_id,
                            now_ms,
                        },
                    ),
                    None => Ed25519YaoPairTransitionV1::Reject(
                        Ed25519YaoPairRejectionV1::IdentityMismatch,
                    ),
                })?
            }
            DeriverAPairDoCommandV1::Complete {
                pair_binding,
                execution_id,
                outcome,
                now_ms,
                running_lifetime_ms,
                ..
            } => {
                if outcome.deriver_a_execution.session() != pair_binding.session() {
                    return Err(pair_error("Deriver A outcome session differs from pair"));
                }
                self.mutate(&owner, &cipher, &pair_binding, |current| match current {
                    Some(record) => complete_ed25519_yao_pair_v1(
                        record,
                        execution_id,
                        outcome,
                        now_ms,
                        running_lifetime_ms,
                    ),
                    None => Ed25519YaoPairTransitionV1::Reject(
                        Ed25519YaoPairRejectionV1::IdentityMismatch,
                    ),
                })?
            }
            DeriverAPairDoCommandV1::Expire {
                pair_binding,
                now_ms,
                ..
            } => self.mutate(&owner, &cipher, &pair_binding, |current| match current {
                Some(record) => expire_ed25519_yao_pair_v1(record, now_ms),
                None => {
                    Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
                }
            })?,
            DeriverAPairDoCommandV1::Burn {
                pair_binding,
                execution_id,
                ..
            } => self.mutate(&owner, &cipher, &pair_binding, |current| match current {
                Some(record) => burn_ed25519_yao_pair_v1(record, execution_id),
                None => {
                    Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
                }
            })?,
            DeriverAPairDoCommandV1::Read { pair_binding, .. } => {
                let row = self.read(&owner, &cipher, &pair_binding)?;
                return Ok(match row {
                    Some(row) => DeriverAPairDoResponseV1::Read {
                        revision: row.revision,
                        record: row.record,
                    },
                    None => DeriverAPairDoResponseV1::Missing,
                });
            }
        };
        Ok(DeriverAPairDoResponseV1::Mutation { result })
    }

    fn check_owner(
        &self,
        owner: &DeriverAWalletOwnerV1,
        may_initialize: bool,
    ) -> worker::Result<()> {
        let rows = self
            .sql
            .exec("SELECT owner_json FROM wallet_owner WHERE id = 1", None)?
            .to_array::<OwnerRowV1>()?;
        let owner_json =
            serde_json::to_string(owner).map_err(|error| pair_error(error.to_string()))?;
        match rows.as_slice() {
            [] if may_initialize => {
                self.sql.exec(
                    "INSERT INTO wallet_owner (id, owner_json) VALUES (1, ?) ON CONFLICT DO NOTHING",
                    vec![SqlStorageValue::String(owner_json.clone())],
                )?;
                let pinned = self
                    .sql
                    .exec("SELECT owner_json FROM wallet_owner WHERE id = 1", None)?
                    .one::<OwnerRowV1>()?;
                if pinned.owner_json != owner_json {
                    return Err(pair_error("Deriver A wallet object owner conflict"));
                }
            }
            [row] if row.owner_json == owner_json => {}
            [] => return Err(pair_error("Deriver A wallet object is uninitialized")),
            _ => return Err(pair_error("Deriver A wallet object owner conflict")),
        }
        Ok(())
    }

    fn validate_preparation(
        &self,
        owner: &DeriverAWalletOwnerV1,
        root_identity: &TenantRootIdentityV1,
        record: &PairRecord,
    ) -> worker::Result<()> {
        let PairRecord::Prepared {
            pair_binding,
            payload,
            ..
        } = record
        else {
            return Err(pair_error("Deriver A prepare requires a Prepared record"));
        };
        owner.check_pair(pair_binding)?;
        if owner != &DeriverAWalletOwnerV1::from_root_identity(root_identity, &owner.wallet_id)? {
            return Err(pair_error(
                "Deriver A root identity differs from wallet owner",
            ));
        }
        payload
            .tenant_root
            .validate_for_pair(pair_binding)
            .map_err(|error| pair_error(error.to_string()))?;
        if payload.tenant_root.identity != *root_identity {
            return Err(pair_error(
                "Deriver A pair root identity differs from preparation",
            ));
        }
        let receipt_bytes = payload
            .tenant_root
            .custody_binding
            .activation_receipt_bytes()
            .map_err(|error| pair_error(error.to_string()))?;
        let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
            .map_err(|error| pair_error(error.to_string()))?;
        let expected_digest = root_identity
            .digest()
            .map_err(|error| pair_error(error.to_string()))?;
        if receipt.identity_digest() != expected_digest
            || DeriverAWalletOwnerV1::from_root_identity(root_identity, &owner.wallet_id)? != *owner
        {
            return Err(pair_error(
                "Deriver A root receipt differs from trusted tenant scope",
            ));
        }
        Ok(())
    }

    fn read(
        &self,
        owner: &DeriverAWalletOwnerV1,
        cipher: &RolePairCipherV1,
        pair: &Ed25519YaoInputPairBindingV1,
    ) -> worker::Result<Option<SelectedPairV1>> {
        owner.check_pair(pair)?;
        let session_hex = encode_hex(pair.session());
        let rows = self
            .sql
            .exec(
                "SELECT revision_text, root_identity_digest_hex, ciphertext_json \
             FROM yao_pair_sessions WHERE session_hex = ?",
                vec![SqlStorageValue::String(session_hex.clone())],
            )?
            .to_array::<PairRowV1>()?;
        let Some(row) = rows.into_iter().next() else {
            return Ok(None);
        };
        let revision = row
            .revision_text
            .parse::<u64>()
            .ok()
            .filter(|revision| *revision > 0)
            .ok_or_else(|| pair_error("Deriver A pair revision is invalid"))?;
        let identity = format!("{}:{session_hex}", owner.object_name()?);
        let opened = cipher.open(&identity, &row.ciphertext_json)?;
        let record: PairRecord = serde_json::from_str(&opened.record_json)
            .map_err(|error| pair_error(format!("Deriver A pair record is malformed: {error}")))?;
        if record.pair_binding() != pair
            || opened.scope.signer_set_id != pair.binding().lifecycle.signer_set_id
            || opened.scope.root_share_epoch != pair.binding().lifecycle.root_share_epoch.as_str()
            || record_root_digest(&record)
                .is_some_and(|digest| encode_hex(digest) != opened.scope.root_metadata_digest_hex)
        {
            return Err(pair_error("Deriver A pair record scope changed"));
        }
        Ok(Some(SelectedPairV1 {
            revision,
            root_identity_digest_hex: row.root_identity_digest_hex,
            record,
            scope: opened.scope,
        }))
    }

    #[cfg(feature = "wallet-do-harness")]
    fn read_scoped(
        &self,
        owner: &DeriverAWalletOwnerV1,
        cipher: &RolePairCipherV1,
        pair: &Ed25519YaoInputPairBindingV1,
        root_identity: &TenantRootIdentityV1,
    ) -> worker::Result<Option<SelectedPairV1>> {
        let expected_owner = DeriverAWalletOwnerV1::from_root_identity(
            root_identity,
            &pair.binding().lifecycle.account_id,
        )?;
        if &expected_owner != owner {
            return Err(pair_error(
                "Deriver A wallet lookup owner differs from root identity",
            ));
        }
        let selected = self.read(owner, cipher, pair)?;
        if let Some(row) = &selected {
            self.check_owner(owner, false)?;
            let digest = root_identity
                .digest()
                .map_err(|error| pair_error(error.to_string()))?;
            if row.root_identity_digest_hex != encode_hex(*digest.as_bytes()) {
                return Err(pair_error(
                    "Deriver A pair root identity differs from stored scope",
                ));
            }
        }
        Ok(selected)
    }

    fn mutate(
        &self,
        owner: &DeriverAWalletOwnerV1,
        cipher: &RolePairCipherV1,
        pair: &Ed25519YaoInputPairBindingV1,
        decide: impl FnOnce(
            Option<&PairRecord>,
        ) -> Ed25519YaoPairTransitionV1<
            DeriverAPairPayloadV1,
            CloudflareEd25519YaoPairExecuteResponseV1,
        >,
    ) -> worker::Result<PairResult> {
        let selected = self.read(owner, cipher, pair)?;
        match decide(selected.as_ref().map(|row| &row.record)) {
            Ed25519YaoPairTransitionV1::Reject(reason) => Ok(PairResult::Rejected(reason)),
            Ed25519YaoPairTransitionV1::Duplicate => {
                let row = selected.ok_or_else(|| pair_error("Duplicate pair has no row"))?;
                Ok(PairResult::Duplicate {
                    revision: row.revision,
                    record: row.record,
                })
            }
            Ed25519YaoPairTransitionV1::Persist(record) => {
                // Claiming or completing a fenced pair is refused: its
                // admission is being cancelled.
                let session_hex = encode_hex(pair.session());
                if matches!(record, PairRecord::Running { .. } | PairRecord::Completed { .. })
                    && self.pair_fenced(&session_hex)?
                {
                    return Err(pair_error(
                        "LifecycleTransitionInProgress: this tenant-root operation's admission was cancelled here; start it again",
                    ));
                }
                let lifecycle = pair_record_lifecycle(&record);
                let claims = i64::from(matches!(record, PairRecord::Running { .. }));
                let (scope, root_identity_digest_hex) = match &selected {
                    Some(row) => (row.scope.clone(), row.root_identity_digest_hex.clone()),
                    None => (
                        initial_scope(&record)?,
                        initial_root_identity_digest(&record)?,
                    ),
                };
                let identity = format!("{}:{session_hex}", owner.object_name()?);
                let record_json = serde_json::to_string(&record)
                    .map_err(|error| pair_error(error.to_string()))?;
                let ciphertext_json = cipher.seal(&identity, &scope, &record_json)?;
                let next_revision = selected
                    .as_ref()
                    .map_or(1, |row| row.revision.saturating_add(1));
                if next_revision == 0 || next_revision > 9_007_199_254_740_991 {
                    return Err(pair_error("Deriver A pair revision overflow"));
                }
                let rows = if let Some(row) = selected {
                    self.sql.exec(
                        "UPDATE yao_pair_sessions SET revision_text = ?, ciphertext_json = ?, \
                         lifecycle = ?, claimed = MAX(claimed, ?) \
                         WHERE session_hex = ? AND revision_text = ? RETURNING revision_text",
                        vec![
                            SqlStorageValue::String(next_revision.to_string()),
                            SqlStorageValue::String(ciphertext_json),
                            SqlStorageValue::String(lifecycle.to_owned()),
                            SqlStorageValue::Integer(claims),
                            SqlStorageValue::String(session_hex),
                            SqlStorageValue::String(row.revision.to_string()),
                        ],
                    )
                } else {
                    self.sql.exec(
                        "INSERT INTO yao_pair_sessions \
                         (session_hex, revision_text, root_identity_digest_hex, ciphertext_json, \
                         lifecycle, claimed) VALUES (?, '1', ?, ?, ?, ?) \
                         ON CONFLICT DO NOTHING RETURNING revision_text",
                        vec![
                            SqlStorageValue::String(session_hex),
                            SqlStorageValue::String(root_identity_digest_hex),
                            SqlStorageValue::String(ciphertext_json),
                            SqlStorageValue::String(lifecycle.to_owned()),
                            SqlStorageValue::Integer(claims),
                        ],
                    )
                };
                let rows = match rows {
                    Ok(cursor) => cursor.to_array::<RevisionRowV1>(),
                    Err(_) => return Ok(PairResult::UncertainWrite),
                };
                let rows = match rows {
                    Ok(rows) => rows,
                    Err(_) => return Ok(PairResult::UncertainWrite),
                };
                if rows.is_empty() {
                    return Ok(PairResult::StaleVersion);
                }
                if rows.len() != 1 || rows[0].revision_text != next_revision.to_string() {
                    return Ok(PairResult::UncertainWrite);
                }
                Ok(PairResult::Applied {
                    revision: next_revision,
                    record,
                })
            }
        }
    }
}

fn pair_record_lifecycle(record: &PairRecord) -> &'static str {
    match record {
        PairRecord::Prepared { .. } => "prepared",
        PairRecord::Starting { .. } => "starting",
        PairRecord::Running { .. } => "running",
        PairRecord::Completed { .. } => "completed",
        PairRecord::Burned { .. } => "burned",
        PairRecord::Expired { .. } => "expired",
    }
}

#[cfg(feature = "wallet-do-harness")]
fn validate_session_hex(session_hex: &str) -> worker::Result<()> {
    if session_hex.len() != 64 || !session_hex.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')) {
        return Err(pair_error("Deriver A pair session must be 64 lowercase hex characters"));
    }
    Ok(())
}

#[cfg(feature = "wallet-do-harness")]
fn pair_error_of(error: impl ToString) -> worker::Error {
    pair_error(error.to_string())
}

/// Asks the wallet object that holds one of this role's pair sessions to
/// report it, and to fence it when asked
/// ([`RouterAbDeriverAWalletDurableObject::reconcile`]).
#[cfg(feature = "wallet-do-harness")]
pub(crate) async fn reconcile_deriver_a_wallet_pair_v1(
    env: &Env,
    object_name: &str,
    request: &TenantRootWalletPairReconcileRequestV1,
) -> worker::Result<TenantRootWalletPairReconciliationV1> {
    let namespace = env.durable_object(PAIR_DO_BINDING)?;
    let stub = namespace.get_by_name(object_name)?;
    let body = serde_json::to_string(request).map_err(pair_error_of)?;
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let request = worker::Request::new_with_init(
        &format!("https://router-ab-do.internal{RECONCILE_PATH}"),
        &init,
    )?;
    let mut response = stub.fetch_with_request(request).await?;
    if response.status_code() != 200 {
        return Err(pair_error(format!(
            "Deriver A wallet object reconciliation returned HTTP {}",
            response.status_code()
        )));
    }
    response.json::<TenantRootWalletPairReconciliationV1>().await
}

fn initial_scope(record: &PairRecord) -> worker::Result<RolePairRecordScopeV1> {
    let PairRecord::Prepared {
        pair_binding,
        root_metadata_digest,
        ..
    } = record
    else {
        return Err(pair_error("Initial Deriver A pair state must be Prepared"));
    };
    Ok(RolePairRecordScopeV1 {
        signer_set_id: pair_binding.binding().lifecycle.signer_set_id.clone(),
        root_share_epoch: pair_binding
            .binding()
            .lifecycle
            .root_share_epoch
            .as_str()
            .to_owned(),
        root_metadata_digest_hex: encode_hex(*root_metadata_digest),
    })
}

fn initial_root_identity_digest(record: &PairRecord) -> worker::Result<String> {
    let PairRecord::Prepared { payload, .. } = record else {
        return Err(pair_error("Initial Deriver A pair state must be Prepared"));
    };
    let digest = payload
        .tenant_root
        .identity
        .digest()
        .map_err(|error| pair_error(error.to_string()))?;
    Ok(encode_hex(*digest.as_bytes()))
}

#[cfg(feature = "wallet-do-harness")]
fn pair_status(record: &PairRecord) -> CloudflareEd25519YaoPairStatusResponseV1 {
    let session = record.pair_binding().session();
    let pair_digest = record.pair_binding().pair_digest().bytes;
    match record {
        PairRecord::Prepared { .. } => CloudflareEd25519YaoPairStatusResponseV1::Prepared {
            session,
            pair_digest,
        },
        PairRecord::Starting { .. } | PairRecord::Running { .. } => {
            CloudflareEd25519YaoPairStatusResponseV1::Running {
                session,
                pair_digest,
            }
        }
        PairRecord::Completed { outcome, .. } => {
            CloudflareEd25519YaoPairStatusResponseV1::Completed {
                execution: Box::new(outcome.deriver_a_execution.clone()),
            }
        }
        PairRecord::Burned { .. } => CloudflareEd25519YaoPairStatusResponseV1::Burned {
            session,
            pair_digest,
        },
        PairRecord::Expired { .. } => CloudflareEd25519YaoPairStatusResponseV1::Expired {
            session,
            pair_digest,
        },
    }
}

#[cfg(feature = "wallet-do-harness")]
fn pair_outcome_status(record: &PairRecord) -> CloudflareDeriverAWalletPairOutcomeResponseV1 {
    let session = record.pair_binding().session();
    let pair_digest = record.pair_binding().pair_digest().bytes;
    match record {
        PairRecord::Prepared { .. } => CloudflareDeriverAWalletPairOutcomeResponseV1::Prepared {
            session,
            pair_digest,
        },
        PairRecord::Starting { .. } | PairRecord::Running { .. } => {
            CloudflareDeriverAWalletPairOutcomeResponseV1::Running {
                session,
                pair_digest,
            }
        }
        PairRecord::Completed {
            outcome, payload, ..
        } => CloudflareDeriverAWalletPairOutcomeResponseV1::Completed {
            outcome: Box::new(outcome.clone()),
            tenant_root: Box::new(payload.tenant_root.clone()),
        },
        PairRecord::Burned { .. } => CloudflareDeriverAWalletPairOutcomeResponseV1::Burned {
            session,
            pair_digest,
        },
        PairRecord::Expired { .. } => CloudflareDeriverAWalletPairOutcomeResponseV1::Expired {
            session,
            pair_digest,
        },
    }
}

fn record_root_digest(record: &PairRecord) -> Option<[u8; 32]> {
    match record {
        PairRecord::Prepared {
            root_metadata_digest,
            ..
        }
        | PairRecord::Starting {
            root_metadata_digest,
            ..
        }
        | PairRecord::Running {
            root_metadata_digest,
            ..
        } => Some(*root_metadata_digest),
        PairRecord::Completed { claim_identity, .. } => {
            Some(claim_identity.local_receipt.root_metadata_digest().bytes)
        }
        PairRecord::Burned { .. } | PairRecord::Expired { .. } => None,
    }
}

fn pair_error(message: impl Into<String>) -> worker::Error {
    worker::Error::RustError(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(org: &str, version: &str) -> TenantRootIdentityV1 {
        TenantRootIdentityV1::new(org, "project-1", "env-1", "root-1", version)
            .expect("root identity")
    }

    #[test]
    fn wallet_object_name_is_stable_across_root_versions_and_isolates_tenants() {
        let first = DeriverAWalletOwnerV1::from_root_identity(&root("org-1", "v1"), "wallet-1")
            .expect("owner");
        let rotated = DeriverAWalletOwnerV1::from_root_identity(&root("org-1", "v2"), "wallet-1")
            .expect("rotated owner");
        let other_tenant =
            DeriverAWalletOwnerV1::from_root_identity(&root("org-2", "v1"), "wallet-1")
                .expect("other tenant");
        let other_wallet =
            DeriverAWalletOwnerV1::from_root_identity(&root("org-1", "v1"), "wallet-2")
                .expect("other wallet");
        assert_eq!(
            first.object_name().expect("name"),
            rotated.object_name().expect("name")
        );
        assert_ne!(
            first.object_name().expect("name"),
            other_tenant.object_name().expect("name")
        );
        assert_ne!(
            first.object_name().expect("name"),
            other_wallet.object_name().expect("name")
        );
    }
}
