use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use serde::{Deserialize, Serialize};
use worker::{Env, Method, Request, Response};

use crate::{router_wallet::RouterWalletOwnerV1, WalletHomeRegion};

pub(crate) const PATH: &str = "/router-ab/internal/wallet/start";

/// The Gateway's admitted owner addresses each role's independent wallet object.
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WalletStartup {
    pub owner: RouterWalletOwnerV1,
    pub ownership_generation: u64,
}

impl WalletStartup {
    fn validate(&self) -> RouterAbProtocolResult<()> {
        for value in [
            &self.owner.org_id,
            &self.owner.project_id,
            &self.owner.env_id,
            &self.owner.wallet_id,
        ] {
            if value.is_empty() || value.len() > 256 || value.trim() != value {
                return Err(invalid_startup("Wallet startup identity is invalid"));
            }
        }
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct HomeWalletStartup {
    wallet_home: WalletHomeRegion,
    wallet: WalletStartup,
}

fn invalid_startup(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MalformedWirePayload, message)
}

async fn start_object(
    env: &Env,
    home: WalletHomeRegion,
    binding: &str,
    name: &str,
    role: &'static str,
) -> worker::Result<Response> {
    let namespace = env.durable_object(binding)?;
    let stub = home.wallet_stub(&namespace, name, role)?;
    let request = Request::new_with_init(
        &format!("https://router-ab-do.internal{PATH}"),
        worker::RequestInit::new().with_method(Method::Post),
    )?;
    stub.fetch_with_request(request).await
}

#[cfg(feature = "strict-worker-router-entrypoint")]
pub(crate) async fn start_registration_wallets(
    env: &Env,
    home: WalletHomeRegion,
    wallet: WalletStartup,
) -> worker::Result<Response> {
    if let Err(error) = wallet.validate() {
        return crate::router_coordinator::protocol_error_response(error);
    }
    let name = wallet
        .owner
        .object_name(wallet.ownership_generation)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    let runtime = crate::CloudflareRouterWorkerRuntimeV1::from_worker_env(env)
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    let request = HomeWalletStartup {
        wallet_home: home,
        wallet,
    };
    // Await every startup even when one role fails. No startup grants authority.
    let results = futures::join!(
        start_object(env, home, "ROUTER_WALLET_DO", &name, "router"),
        start_peer(env, &runtime.deriver_a_peer().binding_name, &request),
        start_peer(env, &runtime.deriver_b_peer().binding_name, &request),
        start_peer(env, &runtime.signing_worker_peer().binding_name, &request),
    );
    for response in [results.0, results.1, results.2, results.3] {
        let mut response = response?;
        if response.status_code() != 200 || !response.json::<bool>().await? {
            return Response::error("Wallet startup failed", 502);
        }
    }
    Response::from_json(&true)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn start_peer(
    env: &Env,
    binding: &str,
    request: &HomeWalletStartup,
) -> worker::Result<Response> {
    crate::router_coordinator::post_role_request(
        env,
        binding,
        "https://router-ab-startup.internal",
        PATH,
        "Wallet startup",
        request,
        None,
    )
    .await
    .map_err(|error| worker::Error::RustError(error.to_string()))
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    feature = "strict-worker-signing-worker-entrypoint"
))]
pub(crate) async fn handle_role_request(
    mut request: Request,
    env: &Env,
    role: crate::CloudflareWorkerRoleV1,
) -> worker::Result<Response> {
    if request.method() != Method::Post {
        return Response::error("Wallet startup requires POST", 405);
    }
    let request =
        match super::tenant_root_creation::decode_bounded_json_request::<HomeWalletStartup>(
            &mut request,
            3072,
        )
        .await
        {
            Ok(request) => request,
            Err(error) => return crate::router_coordinator::protocol_error_response(error),
        };
    if let Err(error) = request.wallet.validate() {
        return crate::router_coordinator::protocol_error_response(error);
    }
    let (binding, name, label) = match role {
        #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
        crate::CloudflareWorkerRoleV1::DeriverA => (
            "DERIVER_A_WALLET_DO",
            super::deriver_a_pair::startup_object_name(&request.wallet)?,
            "deriver_a",
        ),
        #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
        crate::CloudflareWorkerRoleV1::DeriverB => (
            "DERIVER_B_WALLET_DO",
            super::deriver_b_pair::startup_object_name(&request.wallet)?,
            "deriver_b",
        ),
        #[cfg(feature = "strict-worker-signing-worker-entrypoint")]
        crate::CloudflareWorkerRoleV1::SigningWorker => {
            let owner = &request.wallet.owner;
            let scope = crate::CloudflareSigningWorkerWalletScopeV1::new(
                &owner.org_id,
                &owner.project_id,
                &owner.env_id,
                &owner.wallet_id,
            )
            .map_err(|error| worker::Error::RustError(error.to_string()))?;
            let name = crate::signing_worker_wallet_object_name_v1(&scope)
                .and_then(|name| {
                    crate::wallet_object::physical_wallet_object_name(
                        &name,
                        request.wallet.ownership_generation,
                    )
                })
                .map_err(|error| worker::Error::RustError(error.to_string()))?;
            ("SIGNING_WORKER_WALLET_DO", name, "signing_worker")
        }
        _ => return Response::error("Wallet startup role is unavailable", 400),
    };
    start_object(env, request.wallet_home, binding, &name, label).await
}
