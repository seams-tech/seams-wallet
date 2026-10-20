mod snapshot;
use router_ab_core::{
    burn_ed25519_yao_pair_v1, complete_ed25519_yao_pair_v1, expire_ed25519_yao_pair_v1,
    prepare_ed25519_yao_pair_v1, Ed25519YaoEncryptedInputV1, Ed25519YaoExecutionIdV1,
    Ed25519YaoInputPairBindingV1, Ed25519YaoPairRecordV1, Ed25519YaoPairRejectionV1,
    Ed25519YaoPairStoreResultV1, Ed25519YaoPairTransitionV1, TenantRootIdentityV1,
    TenantRootSignedActivationReceiptV1,
};
#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
use router_ab_core::{
    claim_ed25519_yao_pair_v1, release_ed25519_yao_pair_v1, reserve_ed25519_yao_pair_v1,
    Ed25519YaoDeriverRoleV1, Ed25519YaoPairExecutorV1,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worker::{DurableObject, Env, Request, Response, SqlStorage, SqlStorageValue, State};

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
use crate::tenant_root_role_d1::{
    TenantRootWalletPairReconcileRequestV1, TenantRootWalletPairReconciliationV1,
};
use crate::{
    ed25519_yao_lifecycle::role_d1::{
        encode_hex, encode_hex_slice, RolePairCipherV1, RolePairRecordScopeV1,
    },
    CloudflareEd25519YaoPairExecuteResponseV1, CloudflareEd25519YaoPairWorkV1,
    CloudflareEd25519YaoTenantRootContextV2,
};
#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
use crate::{
    ed25519_yao_lifecycle::{
        execute_deriver_a_role, fail_deriver_b_pair_after_a_error_v1,
        prepare_deriver_a_pair_for_wallet_do_v1, DeriverAPairExecutionContextV1,
        DeriverAPairPreparationV1, DeriverAPairRoleFailureV1, DeriverATargetSource,
    },
    CloudflareDeriverAWalletPairBurnRequestV1, CloudflareDeriverAWalletPairOutcomeResponseV1,
    CloudflareDeriverAWalletPairStatusRequestV1, CloudflareDeriverAWorkerRuntimeV1,
    CloudflareEd25519YaoPairExecuteRequestV1, CloudflareEd25519YaoPairPrepareRequestV1,
    CloudflareEd25519YaoPairStatusResponseV1,
};

use super::deriver_relocation as relocation;


pub(crate) const CONTEXT_PATH: &str = "/router-ab/internal/deriver-a/wallet/relocation-context";

pub(crate) const SNAPSHOT_PATH: &str = "/router-ab/internal/deriver-a/wallet/snapshot";

pub(crate) const SOURCE_FENCE_PATH: &str = "/router-ab/internal/deriver-a/wallet/fence-relocation";

pub(crate) const PREPARATION_PATH: &str = "/router-ab/internal/deriver-a/wallet/prepare-relocation";

const PAIR_DO_PATH: &str = "/router-ab/internal/deriver-a/wallet-pair";
#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
const EXECUTE_WORK_PATH: &str = "/router-ab/internal/deriver-a/wallet-pair/execute-work";
#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
const STATUS_WORK_PATH: &str = "/router-ab/internal/deriver-a/wallet-pair/status-work";
#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
const BURN_WORK_PATH: &str = "/router-ab/internal/deriver-a/wallet-pair/burn-work";
#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
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

pub(super) fn startup_object_name(
    request: &super::wallet_startup::WalletStartup,
) -> worker::Result<String> {
    let owner = DeriverAWalletOwnerV1 {
        org_id: request.owner.org_id.clone(),
        project_id: request.owner.project_id.clone(),
        env_id: request.owner.env_id.clone(),
        wallet_id: request.owner.wallet_id.clone(),
    };
    relocation::WalletOwner::physical_object_name(&owner, request.ownership_generation)
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

    #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
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
            | Self::Complete { owner, .. }
            | Self::Expire { owner, .. }
            | Self::Burn { owner, .. }
            | Self::Read { owner, .. } => owner,
        }
    }
}

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
pub(crate) async fn call_deriver_a_wallet_do_work_v1<T: Serialize>(
    env: &Env,
    path: &str,
    pair: &Ed25519YaoInputPairBindingV1,
    tenant_root: &CloudflareEd25519YaoTenantRootContextV2,
    body: &T,
) -> worker::Result<Response> {
    let owner = DeriverAWalletOwnerV1::from_context(env, tenant_root, pair)?;
    let namespace = env.durable_object(PAIR_DO_BINDING)?;
    let physical_name = relocation::WalletOwner::physical_object_name(
        &owner,
        tenant_root.ownership_generation,
    )?;
    let stub = tenant_root
        .wallet_route
        .wallet_stub(&namespace, &physical_name, "deriver_a")?;
    let body = serde_json::to_string(body).map_err(|error| pair_error(error.to_string()))?;
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let request = Request::new_with_init(&format!("https://router-ab-do.internal{path}"), &init)?;
    stub.fetch_with_request(request).await
}

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
pub(crate) async fn call_deriver_a_wallet_do_lookup_v1<T: Serialize>(
    env: &Env,
    path: &str,
    ownership_generation: u64,
    wallet_route: crate::WalletObjectRoute,
    root_identity: &TenantRootIdentityV1,
    pair: &Ed25519YaoInputPairBindingV1,
    body: &T,
) -> worker::Result<Response> {
    let owner = DeriverAWalletOwnerV1::from_root_identity(
        root_identity,
        &pair.binding().lifecycle.account_id,
    )?;
    let namespace = env.durable_object(PAIR_DO_BINDING)?;
    let physical_name = relocation::WalletOwner::physical_object_name(&owner, ownership_generation)?;
    let stub = wallet_route.wallet_stub(&namespace, &physical_name, "deriver_a")?;
    let body = serde_json::to_string(body).map_err(|error| pair_error(error.to_string()))?;
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let request = Request::new_with_init(&format!("https://router-ab-do.internal{path}"), &init)?;
    stub.fetch_with_request(request).await
}

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
pub(crate) const fn deriver_a_wallet_do_execute_work_path_v1() -> &'static str {
    EXECUTE_WORK_PATH
}

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
pub(crate) const fn deriver_a_wallet_do_status_work_path_v1() -> &'static str {
    STATUS_WORK_PATH
}

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
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
    state: State,
    sql: SqlStorage,
    storage: worker::Storage,
    env: Env,
    timing: super::command_timing::WalletCommandTiming,
    prepared_peer:
        std::cell::RefCell<Option<crate::registration_pair_connection::PreparedConnection>>,
    connecting_peer: std::cell::Cell<bool>,
}

impl DurableObject for RouterAbDeriverAWalletDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self {
            timing: super::command_timing::WalletCommandTiming::new(state.id().to_string()),
            sql: state.storage().sql(),
            storage: state.storage(),
            state,
            env,
            prepared_peer: std::cell::RefCell::new(None),
            connecting_peer: std::cell::Cell::new(false),
        }
    }

    async fn fetch(&self, request: Request) -> worker::Result<Response> {
        if request.path() == super::custody_target::OBSERVE_PATH {
            return super::custody_target::observe_location().await;
        }
        let path = request.path();
        let observation = self
            .timing
            .begin(&self.state, "deriver_a", path.clone());
        let result = self.fetch_wallet_request(request).await;
        #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
        let result = match result {
            Err(error) if path == EXECUTE_WORK_PATH => {
                let message = error.to_string();
                crate::strict_worker::cloudflare_role_failure_response_v1(
                    router_ab_core::RouterAbProtocolError::new(
                        crate::router_ab_peer_error_code_v1(&message),
                        message,
                    ),
                )
            }
            result => result,
        };
        observation.finish(result)
    }

    async fn alarm(&self) -> worker::Result<Response> {
        self.prepared_peer.borrow_mut().take();
        super::registration_preparation::expire(&self.state, &self.sql, &self.env).await
    }
}

impl RouterAbDeriverAWalletDurableObject {
    async fn fetch_wallet_request(&self, mut request: Request) -> worker::Result<Response> {
        if request.method() != worker::Method::Post {
            return Response::error("Unknown Deriver A wallet object request", 404);
        }
        let path = request.path();
        self.sql.exec(OWNER_SCHEMA, None)?;
        self.sql.exec(PAIR_SCHEMA, None)?;
        self.sql.exec(FENCE_SCHEMA, None)?;
        self.sql.exec(relocation::SCHEMA, None)?;
        self.sql.exec(relocation::SOURCE_SCHEMA, None)?;
        self.sql
            .exec(super::registration_preparation::SCHEMA, None)?;
        #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
        if path == crate::registration_pair_preparation::ROLE_PATH {
            relocation::require_open::<DeriverAWalletOwnerV1>(&self.sql)?;
            let preparation: crate::registration_pair_preparation::RegistrationPreparation =
                request.json().await?;
            let owner = DeriverAWalletOwnerV1::from_root_identity(
                &preparation.request.tenant_root.identity,
                &preparation.request.binding.lifecycle.account_id,
            )?;
            if preparation.wallet_route.addresses.deriver_a.as_str() != self.state.id().to_string()
            {
                return Response::error(
                    "Registration preparation addresses another wallet object",
                    409,
                );
            }
            self.check_owner(&owner, true)?;
            let preparation = super::registration_preparation::admit(
                &self.state,
                &self.sql,
                &self.env,
                preparation,
            )
            .await?;
            if self.prepared_peer.borrow().is_none() && !self.connecting_peer.replace(true) {
                let _attempt = RegistrationConnectionAttempt(&self.connecting_peer);
                let connection =
                    crate::registration_pair_connection::connect(&self.env, preparation).await;
                if let Ok(connection) = connection {
                    super::registration_preparation::require_unfenced(
                        &self.sql,
                        &connection.preparation,
                    )?;
                    if connection.preparation.custody_binding.expires_at_ms
                        > worker::Date::now().as_millis()
                    {
                        *self.prepared_peer.borrow_mut() = Some(connection);
                    }
                }
            }
            return Response::from_json(&true);
        }
        if path == super::wallet_startup::PATH {
            #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
            {
                self.load_deriver_b_worker();
                // A first protocol run in an isolate costs several times a
                // later one. Run one in-memory ceremony during the prompt.
                self.state
                    .wait_until(crate::ed25519_yao_prewarm::prewarm_role_isolate_v1("deriver_a"));
            }
            return Response::from_json(&true);
        }
        // Any other request is real work: a running prewarm stops for it.
        crate::ed25519_yao_prewarm::note_pair_work_arrived_v1();
        if path == SNAPSHOT_PATH {
            let command: relocation::snapshot::Command<DeriverAWalletOwnerV1> = request.json().await?;
            command.source().validate()?;
            if !command.source().context_matches(&self.env)? {
                return Response::error("Deriver encryption context differs from source", 409);
            }
            self.check_owner(&command.source().owner, false)?;
            return relocation::snapshot::execute(&self.storage, self.sql.clone(), self.env.clone(), command).await;
        }
        if path != PREPARATION_PATH && path != SOURCE_FENCE_PATH && path != SNAPSHOT_PATH && path != PAIR_DO_PATH {
            relocation::require_open::<DeriverAWalletOwnerV1>(&self.sql)?;
        }
        match path.as_str() {
            PREPARATION_PATH | SOURCE_FENCE_PATH => {
                let command: relocation::Preparation<DeriverAWalletOwnerV1> = request.json().await?;
                command.validate()?;
                if !command.context_matches(&self.env)? {
                    return Response::error("Deriver encryption context differs from source", 409);
                }
                self.check_owner(&command.owner, true)?;
                if path == SOURCE_FENCE_PATH {
                    relocation::fence_settled_source(&self.sql, command, 0)
                } else {
                    relocation::reserve(&self.storage, self.sql.clone(), command).await
                }
            }
            PAIR_DO_PATH => {
                let command: DeriverAPairDoCommandV1 = request.json().await?;
                if !matches!(command, DeriverAPairDoCommandV1::Read { .. }) {
                    relocation::require_open::<DeriverAWalletOwnerV1>(&self.sql)?;
                }
                let response = self.execute(command)?;
                Response::from_json(&response)
            }
            #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
            EXECUTE_WORK_PATH => {
                let work: CloudflareEd25519YaoPairExecuteRequestV1 = request.json().await?;
                let outcome = self.execute_work(work).await?;
                Response::from_json(&outcome)
            }
            #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
            STATUS_WORK_PATH => {
                let lookup: CloudflareDeriverAWalletPairStatusRequestV1 = request.json().await?;
                Response::from_json(&self.status_work(lookup)?)
            }
            #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
            BURN_WORK_PATH => {
                let lookup: CloudflareDeriverAWalletPairBurnRequestV1 = request.json().await?;
                Response::from_json(&self.burn_work(lookup)?)
            }
            #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
            RECONCILE_PATH => {
                let reconcile: TenantRootWalletPairReconcileRequestV1 = request.json().await?;
                Response::from_json(&self.reconcile(&reconcile)?)
            }
            _ => Response::error("Unknown Deriver A wallet object request", 404),
        }
    }

    /// Answers the role store that owns a pair session's admission. When
    /// asked, it first fences the pair unless its executor claimed it or it
    /// completed. Both checks and the fence run in one statement. A fence
    /// also covers a session this object never prepared. Once Deriver B has
    /// answered that it completed the pair or can no longer complete it, a
    /// claimed pair can be fenced too: this executor cannot complete without
    /// B.
    #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
    fn reconcile(
        &self,
        request: &TenantRootWalletPairReconcileRequestV1,
    ) -> worker::Result<TenantRootWalletPairReconciliationV1> {
        validate_session_hex(&request.session_hex)?;
        if request.fence {
            self.sql.exec(
                "INSERT INTO yao_pair_admission_fences (session_hex, fenced_at_ms) \
                 SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM yao_pair_sessions \
                 WHERE session_hex = ? AND ((claimed = 1 AND ? = 0) OR lifecycle = 'completed')) \
                 ON CONFLICT DO NOTHING",
                vec![
                    SqlStorageValue::String(request.session_hex.clone()),
                    SqlStorageValue::Integer(i64::try_from(request.now_ms).map_err(pair_error_of)?),
                    SqlStorageValue::String(request.session_hex.clone()),
                    SqlStorageValue::Integer(i64::from(request.peer_settled)),
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
            _ if self.pair_fenced(&request.session_hex)? => {
                TenantRootWalletPairReconciliationV1::Fenced
            }
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

    #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
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

    #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
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

    /// Prepares this role's side of the pair: admits its root use and stores
    /// the preparation. Answers the root metadata digest the preparation is
    /// bound to, and where the executor gets its target proof.
    ///
    /// A Router run stamps a new window into the tenant-root context. A
    /// preparation an earlier run stored cannot serve this one, and nothing
    /// has reserved it, so this run's replaces it.
    #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
    async fn prepare_work(
        &self,
        request: CloudflareEd25519YaoPairPrepareRequestV1,
    ) -> worker::Result<([u8; 32], DeriverATargetSource)> {
        if !matches!(request.work, CloudflareEd25519YaoPairWorkV1::Ceremony) {
            return Err(pair_error(
                "Deriver A wallet DO lane execution is unavailable",
            ));
        }
        let expected_kind = crate::ed25519_yao_lifecycle::input_kind_for_circuit(
            request.pair_binding.binding().circuit_family(),
        );
        request.validate_for_role(Ed25519YaoDeriverRoleV1::DeriverA, expected_kind)
            .map_err(pair_error)?;
        let pair = &request.pair_binding;
        let owner = DeriverAWalletOwnerV1::from_context(&self.env, &request.tenant_root, pair)?;
        let cipher = RolePairCipherV1::from_env_for_wallet_do(&self.env)?;
        if let Some(existing) =
            self.read_scoped(&owner, &cipher, pair, &request.tenant_root.identity)?
        {
            self.check_owner(&owner, false)?;
            match existing.record {
                PairRecord::Prepared {
                    root_metadata_digest,
                    payload,
                    expires_at_ms,
                    ..
                } if payload.work == request.work && payload.input == request.input => {
                    if payload.tenant_root == request.tenant_root {
                        if crate::cloudflare_now_unix_ms_v1()
                            .map_err(|error| pair_error(error.to_string()))?
                            < expires_at_ms
                        {
                            let access = super::registration_preparation::read_admitted_access(
                                &self.state.id().to_string(), &self.sql, &self.env,
                                &request.tenant_root, pair,
                            )?;
                            return Ok((root_metadata_digest, DeriverATargetSource::StoredAdmission(access)));
                        }
                        return Err(pair_error("Deriver A pair preparation expired"));
                    }
                }
                _ => return Err(pair_error("Deriver A pair is conflicting or terminal")),
            }
        }
        // The admission names this object. Refuse another wallet's request
        // before it is written.
        self.check_owner(&owner, true)?;
        let state_id = self.state.id().to_string();
        let (preparation, target) = super::registration_preparation::load_for_execution(
            &state_id,
            &self.sql,
            &self.env,
            &request.tenant_root,
            pair,
            |access| {
                prepare_deriver_a_pair_for_wallet_do_v1(&self.env, &request, state_id.clone(), access)
            },
        )
        .await?
        .map_err(|error| pair_error(error.to_string()))?;
        let DeriverAPairPreparationV1 {
            root_metadata_digest,
            prepared_at_ms,
            expires_at_ms,
        } = preparation;
        // Admission can yield while relocation closes this object.
        // Check before persisting preparation or starting an executor.
        relocation::require_open::<DeriverAWalletOwnerV1>(&self.sql)?;
        self.check_owner(&owner, true)?;
        let record = PairRecord::Prepared {
            pair_binding: pair.clone(),
            root_metadata_digest,
            expires_at_ms,
            payload: DeriverAPairPayloadV1 {
                tenant_root: request.tenant_root,
                work: request.work,
                input: request.input,
            },
        };
        let result = self.mutate(&owner, &cipher, pair, |current| {
            prepare_ed25519_yao_pair_v1(current, record, prepared_at_ms)
        })?;
        match result {
            PairResult::Applied { .. } | PairResult::Duplicate { .. } => {
                Ok((root_metadata_digest, target))
            }
            _ => Err(pair_error("Deriver A pair preparation was not committed")),
        }
    }

    /// Asks Deriver B's Worker for its prewarm answer. The pair connection is
    /// the only other request that reaches that Worker from where this object
    /// runs, so without this the connection waits while the Worker loads
    /// there. The answer is not used: a failure leaves the connection as
    /// slow as it was.
    #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
    fn load_deriver_b_worker(&self) {
        let env = self.env.clone();
        self.state.wait_until(async move {
            let _ = crate::strict_worker::prewarm_service_binding_v1(
                &env,
                crate::DERIVER_B_BINDING,
            )
            .await;
        });
    }

    #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
    async fn execute_work(
        &self,
        request: CloudflareEd25519YaoPairExecuteRequestV1,
    ) -> worker::Result<CloudflareEd25519YaoPairExecuteResponseV1> {
        let pair = &request.pair_binding;
        let owner = DeriverAWalletOwnerV1::from_context(&self.env, &request.tenant_root, pair)?;
        let cipher = RolePairCipherV1::from_env_for_wallet_do(&self.env)?;
        if let Some(selected) =
            self.read_scoped(&owner, &cipher, pair, &request.tenant_root.identity)?
        {
            if let PairRecord::Completed {
                payload, outcome, ..
            } = selected.record
            {
                if payload.tenant_root == request.tenant_root
                    && payload.work == request.work
                    && payload.input == request.input
                {
                    return Ok(outcome);
                }
                return Err(pair_error("Deriver A pair is conflicting or unavailable"));
            }
        }
        let runtime = CloudflareDeriverAWorkerRuntimeV1::from_worker_env(&self.env)
            .map_err(|error| pair_error(error.to_string()))?;
        // A wallet whose start is long past may find Deriver B's Worker
        // unloaded again. Load it beside the admission.
        self.load_deriver_b_worker();
        let preparation = CloudflareEd25519YaoPairPrepareRequestV1 {
            pair_binding: request.pair_binding.clone(),
            tenant_root: request.tenant_root.clone(),
            work: request.work.clone(),
            input: request.input.clone(),
        };
        let prepare_started_at_ms =
            crate::cloudflare_now_unix_ms_v1().map_err(|error| pair_error(error.to_string()))?;
        let prepared = self.prepare_work(preparation).await;
        crate::ed25519_yao_lifecycle::emit_role_span_v1(
            None,
            "deriver_a.prepare_in_execute",
            "deriver_a",
            crate::router_coordinator::operation_label(pair.binding().operation),
            prepare_started_at_ms,
            if prepared.is_ok() {
                "success"
            } else {
                "failure"
            },
        );
        let (root_metadata_digest, target_source) = prepared?;
        let execution_id = Ed25519YaoExecutionIdV1::new(pair.pair_digest().bytes)
            .map_err(|error| pair_error(error.to_string()))?;
        let executor = Ed25519YaoPairExecutorV1 {
            pair_binding: pair,
            execution_id,
            now_ms: crate::cloudflare_now_unix_ms_v1()
                .map_err(|error| pair_error(error.to_string()))?,
        };
        // Only the request whose reservation is applied connects to Deriver B.
        let reserved = self.mutate(&owner, &cipher, pair, |current| match current {
            Some(record) => reserve_ed25519_yao_pair_v1(record, executor),
            None => Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch),
        })?;
        if !matches!(reserved, PairResult::Applied { .. }) {
            return Err(pair_error("Deriver A pair reservation did not win"));
        }
        let pair_execution = DeriverAPairExecutionContextV1 {
            pair_object: self.state.id().to_string(),
            expected_root_metadata_digest: root_metadata_digest,
            pair_binding: pair,
            tenant_root: &request.tenant_root,
            work: CloudflareEd25519YaoPairWorkV1::Ceremony,
            pair_digest: pair.pair_digest().bytes,
            execution_id,
            deadline_ms: request.deadline_ms,
        };
        let prepared_peer = self.prepared_peer.borrow_mut().take().filter(|peer| {
            peer.preparation
                .matches_execution(&request.tenant_root, pair)
                && peer.preparation.custody_binding.expires_at_ms > worker::Date::now().as_millis()
        });
        let role_result = execute_deriver_a_role(
            &self.env,
            &runtime,
            request.input.clone(),
            None,
            pair_execution,
            target_source,
            prepared_peer,
            || self.claim_work(&owner, &cipher, pair, execution_id),
        )
        .await;
        let failure = match role_result {
            Ok(role_result) => {
                return self.complete_work(
                    owner,
                    pair,
                    request.tenant_root.ownership_generation,
                    execution_id,
                    CloudflareEd25519YaoPairExecuteResponseV1 {
                        deriver_a_execution: role_result.deriver_a_execution,
                        deriver_b_sealed_execution_json: role_result
                            .deriver_b_sealed_execution_json,
                    },
                );
            }
            Err(DeriverAPairRoleFailureV1::PeerHoldsNoClaim(reason)) => {
                // Deriver B holds no claim and nothing was exchanged. The
                // reservation returns to a preparation, so a later Router run
                // can execute this pair: nothing burns.
                let released = self.mutate(&owner, &cipher, pair, |current| match current {
                    Some(record) => release_ed25519_yao_pair_v1(record, executor),
                    None => Ed25519YaoPairTransitionV1::Reject(
                        Ed25519YaoPairRejectionV1::IdentityMismatch,
                    ),
                })?;
                if matches!(
                    released,
                    PairResult::Applied { .. } | PairResult::Duplicate { .. }
                ) {
                    return Err(pair_error(format!(
                        "Deriver B holds no claim for this pair ({reason:?}); Deriver A released its reservation"
                    )));
                }
                "Deriver A pair reservation could not be released".to_owned()
            }
            Err(DeriverAPairRoleFailureV1::Failed(error)) => error.to_string(),
        };
        // Deriver B may have claimed the execution, or it ran and failed: the
        // execution identity is spent at both roles.
        let _ = self.execute(DeriverAPairDoCommandV1::Burn {
            owner,
            pair_binding: pair.clone(),
            execution_id,
        });
        fail_deriver_b_pair_after_a_error_v1(
            &self.env,
            &crate::CloudflareDeriverBWalletPairScopeV1 {
                wallet_route: request.tenant_root.wallet_route,
                ownership_generation: request.tenant_root.ownership_generation,
                root_identity: request.tenant_root.identity.clone(),
                pair_binding: pair.clone(),
            },
        )
        .await;
        Err(pair_error(failure))
    }

    /// Commits the pair's outcome. Only a committed completion releases it:
    /// one that came after the running lifetime is recorded as burned, a
    /// failure.
    #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
    fn complete_work(
        &self,
        owner: DeriverAWalletOwnerV1,
        pair: &Ed25519YaoInputPairBindingV1,
        ownership_generation: u64,
        execution_id: Ed25519YaoExecutionIdV1,
        outcome: CloudflareEd25519YaoPairExecuteResponseV1,
    ) -> worker::Result<CloudflareEd25519YaoPairExecuteResponseV1> {
        let object_id = self.state.id().to_string();
        let operation = crate::router_coordinator::operation_label(pair.binding().operation);
        let commit_started_at_ms = worker::Date::now().as_millis();
        let completed = self.execute(DeriverAPairDoCommandV1::Complete {
            owner,
            pair_binding: pair.clone(),
            execution_id,
            outcome: outcome.clone(),
            now_ms: crate::cloudflare_now_unix_ms_v1()
                .map_err(|error| pair_error(error.to_string()))?,
            running_lifetime_ms: 60_000,
        });
        crate::ed25519_yao_lifecycle::emit_role_span_v1(
            None,
            "deriver_a.outcome_record",
            "deriver_a",
            operation,
            commit_started_at_ms,
            if completed.is_ok() { "success" } else { "failure" },
        );
        match completed? {
            DeriverAPairDoResponseV1::Mutation {
                result:
                    PairResult::Applied {
                        record: PairRecord::Completed { .. },
                        ..
                    },
            } => {
                // The durable outcome is authoritative. A lost acknowledgement is
                // reconciled from this exact physical object during retirement.
                let env = self.env.clone();
                let session_hex = encode_hex(pair.session());
                self.state.wait_until(async move {
                    let settle_started_at_ms = worker::Date::now().as_millis();
                    let settled = crate::ed25519_yao_lifecycle::role_d1::settle_wallet_object_admission_v1(
                        &env,
                        "deriver_a",
                        &session_hex,
                        &object_id,
                    )
                    .await;
                    crate::ed25519_yao_lifecycle::emit_role_span_v1(
                        None,
                        "deriver_a.admission_settle_background",
                        "deriver_a",
                        operation,
                        settle_started_at_ms,
                        if settled.is_ok() { "success" } else { "failure" },
                    );
                    if let Err(error) = settled {
                        worker::console_error!(
                            "Deriver A pair completed, but its admission settlement was not acknowledged: {error}"
                        );
                    }
                });
                Ok(outcome)
            }
            _ => Err(pair_error("Deriver A pair completion did not commit")),
        }
    }

    /// Records this role's claim once Deriver B claimed the execution: the
    /// last durable step before this role sends protocol material.
    #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
    async fn claim_work(
        &self,
        owner: &DeriverAWalletOwnerV1,
        cipher: &RolePairCipherV1,
        pair: &Ed25519YaoInputPairBindingV1,
        execution_id: Ed25519YaoExecutionIdV1,
    ) -> router_ab_core::RouterAbProtocolResult<()> {
        let executor = Ed25519YaoPairExecutorV1 {
            pair_binding: pair,
            execution_id,
            now_ms: crate::cloudflare_now_unix_ms_v1()?,
        };
        let result = self
            .mutate(owner, cipher, pair, |current| match current {
                Some(record) => claim_ed25519_yao_pair_v1(record, executor),
                None => {
                    Ed25519YaoPairTransitionV1::Reject(Ed25519YaoPairRejectionV1::IdentityMismatch)
                }
            })
            .map_err(|error| crate::ed25519_yao_lifecycle::invalid_lifecycle(error.to_string()))?;
        if matches!(result, PairResult::Applied { .. }) {
            Ok(())
        } else {
            Err(crate::ed25519_yao_lifecycle::invalid_lifecycle(
                "Deriver A pair claim did not commit",
            ))
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
        let selected = snapshot::decode_pair(owner, cipher, &session_hex, row)?;
        if selected.record.pair_binding() != pair {
            return Err(pair_error("Deriver A pair record scope changed"));
        }
        Ok(Some(selected))
    }

    #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
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

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
fn validate_session_hex(session_hex: &str) -> worker::Result<()> {
    if session_hex.len() != 64 || !session_hex.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')) {
        return Err(pair_error("Deriver A pair session must be 64 lowercase hex characters"));
    }
    Ok(())
}

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
fn pair_error_of(error: impl ToString) -> worker::Error {
    pair_error(error.to_string())
}

/// Asks the wallet object that holds one of this role's pair sessions to
/// report it, and to fence it when asked
/// ([`RouterAbDeriverAWalletDurableObject::reconcile`]).
#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
pub(crate) async fn reconcile_deriver_a_wallet_pair_v1(
    env: &Env,
    object_id: &str,
    request: &TenantRootWalletPairReconcileRequestV1,
) -> worker::Result<TenantRootWalletPairReconciliationV1> {
    let namespace = env.durable_object(PAIR_DO_BINDING)?;
    let stub = namespace.id_from_string(object_id)?.get_stub()?;
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

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
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

#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
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
        PairRecord::Completed { .. } | PairRecord::Burned { .. } | PairRecord::Expired { .. } => {
            None
        }
    }
}

fn pair_error(message: impl ToString) -> worker::Error {
    worker::Error::RustError(message.to_string())
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

impl relocation::WalletOwner for DeriverAWalletOwnerV1 {
    fn object_id(route: crate::WalletObjectRoute) -> crate::WalletObjectId { route.addresses.deriver_a }

    type Pair = snapshot::PairRow;
    fn cipher(env: &Env) -> worker::Result<crate::ed25519_yao_lifecycle::role_d1::RolePairCipherV1> {
        crate::ed25519_yao_lifecycle::role_d1::RolePairCipherV1::from_env_for_wallet_do(env)
    }

    const LABEL: &'static str = "Deriver A";
    const PAIR_SNAPSHOT_JSON: &'static str = "json_object('kind', 'pair', 'session_hex', session_hex, 'revision_text', revision_text, 'root_identity_digest_hex', root_identity_digest_hex, 'ciphertext_json', ciphertext_json, 'lifecycle', lifecycle, 'claimed', CAST(claimed AS TEXT))";

    fn parts(&self) -> [&str; 4] {
        [&self.org_id, &self.project_id, &self.env_id, &self.wallet_id]
    }

    fn object_name(&self) -> worker::Result<String> {
        DeriverAWalletOwnerV1::object_name(self)
    }
}

pub(crate) async fn call_preparation(request: Request, env: &Env) -> worker::Result<Response> {
    relocation::call_preparation::<DeriverAWalletOwnerV1>(
        request,
        env,
        PAIR_DO_BINDING,
        PREPARATION_PATH,
    )
    .await
}

pub(crate) async fn read_relocation_context(
    request: Request,
    env: &Env,
) -> worker::Result<Response> {
    relocation::read_context::<DeriverAWalletOwnerV1>(request, env).await
}

pub(crate) async fn call_source_fence(request: Request, env: &Env) -> worker::Result<Response> {
    relocation::call_preparation::<DeriverAWalletOwnerV1>(
        request,
        env,
        PAIR_DO_BINDING,
        SOURCE_FENCE_PATH,
    )
    .await
}

pub(crate) async fn call_snapshot(request: Request, env: &Env) -> worker::Result<Response> {
    relocation::snapshot::forward::<DeriverAWalletOwnerV1>(
        request,
        env,
        PAIR_DO_BINDING,
        SNAPSHOT_PATH,
    )
    .await
}

struct RegistrationConnectionAttempt<'a>(&'a std::cell::Cell<bool>);

impl Drop for RegistrationConnectionAttempt<'_> {
    fn drop(&mut self) {
        self.0.set(false);
    }
}
