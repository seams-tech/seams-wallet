use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worker::{DurableObject, Env, Request, Response, SqlStorage, SqlStorageValue, State};

use crate::{
    ed25519_yao_lifecycle::{
        role_d1::encode_hex_slice, DeriverBYaoSessionCommandV1, DeriverBYaoSessionD1V1,
    },
    CloudflareDeriverBWalletPairScopeV1,
};

const BINDING: &str = "DERIVER_B_WALLET_DO";
const COMMAND_PATH: &str = "/router-ab/internal/deriver-b/wallet-pair";
const OWNER_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_owner (
    id INTEGER PRIMARY KEY CHECK (id = 1), owner_json TEXT NOT NULL)";
const PAIR_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS yao_pair_sessions (
    session_hex TEXT PRIMARY KEY,
    pair_digest_hex TEXT NOT NULL,
    lifecycle TEXT NOT NULL,
    ciphertext_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    expires_at_ms TEXT NOT NULL,
    updated_at_ms TEXT NOT NULL,
    root_identity_digest_hex TEXT NOT NULL)";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DeriverBWalletOwnerV1 {
    org_id: String,
    project_id: String,
    env_id: String,
    wallet_id: String,
}

impl DeriverBWalletOwnerV1 {
    fn from_scope(scope: &CloudflareDeriverBWalletPairScopeV1) -> worker::Result<Self> {
        scope.validate().map_err(pair_error)?;
        Ok(Self {
            org_id: scope.root_identity.org_id().to_owned(),
            project_id: scope.root_identity.project_id().to_owned(),
            env_id: scope.root_identity.env_id().to_owned(),
            wallet_id: scope.pair_binding.binding().lifecycle.account_id.clone(),
        })
    }

    fn object_name(&self) -> worker::Result<String> {
        let encoded = serde_json::to_vec(self).map_err(pair_error)?;
        let mut hash = Sha256::new();
        hash.update(b"seams/deriver-b/wallet-do/v1");
        hash.update(encoded);
        Ok(format!(
            "deriver-b-wallet-{}",
            encode_hex_slice(&hash.finalize())
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeriverBWalletDoRequestV1 {
    pub(crate) scope: CloudflareDeriverBWalletPairScopeV1,
    pub(crate) command: DeriverBYaoSessionCommandV1,
}

#[derive(Deserialize)]
struct OwnerRowV1 {
    owner_json: String,
}

#[derive(Deserialize)]
struct PairScopeRowV1 {
    pair_digest_hex: String,
    root_identity_digest_hex: String,
}

pub(crate) async fn call_deriver_b_wallet_do_v1(
    env: &Env,
    request: DeriverBWalletDoRequestV1,
) -> worker::Result<Response> {
    let owner = DeriverBWalletOwnerV1::from_scope(&request.scope)?;
    let namespace = env.durable_object(BINDING)?;
    let stub = namespace.get_by_name(&owner.object_name()?)?;
    let body = serde_json::to_string(&request).map_err(pair_error)?;
    let mut init = worker::RequestInit::new();
    init.with_method(worker::Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    let request = Request::new_with_init(
        &format!("https://router-ab-do.internal{COMMAND_PATH}"),
        &init,
    )?;
    stub.fetch_with_request(request).await
}

#[worker::durable_object]
pub struct RouterAbDeriverBWalletDurableObject {
    sql: SqlStorage,
    env: Env,
}

impl DurableObject for RouterAbDeriverBWalletDurableObject {
    fn new(state: State, env: Env) -> Self {
        Self {
            sql: state.storage().sql(),
            env,
        }
    }

    async fn fetch(&self, mut request: Request) -> worker::Result<Response> {
        if request.method() != worker::Method::Post || request.path() != COMMAND_PATH {
            return Response::error("Unknown Deriver B wallet object request", 404);
        }
        self.sql.exec(OWNER_SCHEMA, None)?;
        self.sql.exec(PAIR_SCHEMA, None)?;
        let request: DeriverBWalletDoRequestV1 = request.json().await?;
        self.execute(request).await
    }
}

impl RouterAbDeriverBWalletDurableObject {
    async fn execute(&self, request: DeriverBWalletDoRequestV1) -> worker::Result<Response> {
        request.scope.validate().map_err(pair_error)?;
        request.command.validate().map_err(pair_error)?;
        if let DeriverBYaoSessionCommandV1::PreparePair {
            pair_binding,
            tenant_root,
            ..
        } = &request.command
        {
            tenant_root
                .validate_for_pair(pair_binding)
                .map_err(pair_error)?;
            let issuer_keys =
                crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(
                    &crate::CloudflareWorkerEnvReaderV1::new(&self.env),
                )
                .map_err(pair_error)?;
            let receipt = tenant_root
                .custody_binding
                .verify_activation_receipt(&issuer_keys)
                .map_err(pair_error)?;
            if receipt.identity_digest() != tenant_root.identity.digest().map_err(pair_error)? {
                return Err(pair_error(
                    "Deriver B root identity differs from activation receipt",
                ));
            }
        }
        let owner = DeriverBWalletOwnerV1::from_scope(&request.scope)?;
        let may_initialize = matches!(
            request.command,
            DeriverBYaoSessionCommandV1::PreparePair { .. }
        );
        self.check_owner(&owner, may_initialize)?;
        self.check_pair(&request.scope, &request.command)?;
        let root_digest = request.scope.root_identity.digest().map_err(pair_error)?;
        let engine = DeriverBYaoSessionD1V1::for_wallet_do(
            self.env.clone(),
            self.sql.clone(),
            owner.object_name()?,
            encode_hex_slice(root_digest.as_bytes()),
        );
        engine.execute(request.command).await
    }

    fn check_owner(
        &self,
        owner: &DeriverBWalletOwnerV1,
        may_initialize: bool,
    ) -> worker::Result<()> {
        let owner_json = serde_json::to_string(owner).map_err(pair_error)?;
        if may_initialize {
            self.sql.exec(
                "INSERT INTO wallet_owner (id, owner_json) VALUES (1, ?) ON CONFLICT DO NOTHING",
                vec![SqlStorageValue::String(owner_json.clone())],
            )?;
        }
        let rows = self
            .sql
            .exec("SELECT owner_json FROM wallet_owner WHERE id = 1", None)?
            .to_array::<OwnerRowV1>()?;
        match rows.as_slice() {
            [row] if row.owner_json == owner_json => Ok(()),
            [] if !may_initialize => Ok(()),
            [] => Err(pair_error("Deriver B wallet object is uninitialized")),
            _ => Err(pair_error("Deriver B wallet object owner conflict")),
        }
    }

    fn check_pair(
        &self,
        scope: &CloudflareDeriverBWalletPairScopeV1,
        command: &DeriverBYaoSessionCommandV1,
    ) -> worker::Result<()> {
        let pair = &scope.pair_binding;
        if command.session() != pair.session() || command.pair_digest() != pair.pair_digest().bytes
        {
            return Err(pair_error("Deriver B command differs from routed pair"));
        }
        if let DeriverBYaoSessionCommandV1::PreparePair {
            pair_binding,
            tenant_root,
            ..
        } = command
        {
            if **pair_binding != *pair || tenant_root.identity != scope.root_identity {
                return Err(pair_error(
                    "Deriver B preparation differs from routed scope",
                ));
            }
            return Ok(());
        }
        let rows = self.sql.exec(
            "SELECT pair_digest_hex, root_identity_digest_hex FROM yao_pair_sessions WHERE session_hex = ?",
            vec![SqlStorageValue::String(encode_hex_slice(&pair.session()))],
        )?.to_array::<PairScopeRowV1>()?;
        let root_digest = scope.root_identity.digest().map_err(pair_error)?;
        match rows.as_slice() {
            [row]
                if row.pair_digest_hex == encode_hex_slice(&pair.pair_digest().bytes)
                    && row.root_identity_digest_hex == encode_hex_slice(root_digest.as_bytes()) =>
            {
                Ok(())
            }
            [] if matches!(
                command,
                DeriverBYaoSessionCommandV1::ReadPairStatus { .. }
                    | DeriverBYaoSessionCommandV1::FailPair { .. }
            ) =>
            {
                Ok(())
            }
            [] => Err(pair_error("Deriver B wallet pair is missing")),
            _ => Err(pair_error("Deriver B wallet pair scope conflict")),
        }
    }
}

fn pair_error(error: impl ToString) -> worker::Error {
    worker::Error::RustError(error.to_string())
}
