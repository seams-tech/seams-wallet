use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use serde::{Deserialize, Serialize};
use worker::{Env, Method, Request, Response};

use crate::router_wallet::RouterWalletOwnerV1;

pub(crate) const PATH: &str = "/router-ab/internal/wallet/start";
pub(crate) const ALLOCATE_PATH: &str = "/router-ab/internal/wallet/allocate";

/// The Gateway's admitted owner addresses each role's independent wallet object.
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WalletStartup {
    pub owner: RouterWalletOwnerV1,
    pub ownership_generation: u64,
}

impl WalletStartup {
    pub(super) fn validate(&self) -> RouterAbProtocolResult<()> {
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
    wallet_route: crate::WalletObjectRoute,
    wallet: WalletStartup,
}

fn invalid_startup(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MalformedWirePayload, message)
}

async fn start_object<T: Serialize>(
    env: &Env,
    route: crate::WalletObjectRoute,
    binding: &str,
    name: &str,
    role: &'static str,
    body: &T,
) -> worker::Result<Response> {
    let namespace = env.durable_object(binding)?;
    let stub = route.wallet_stub(&namespace, name, role)?;
    let request = Request::new_with_init(
        &format!("https://router-ab-do.internal{PATH}"),
        worker::RequestInit::new()
            .with_method(Method::Post)
            .with_body(Some(serde_json::to_string(body)?.into())),
    )?;
    stub.fetch_with_request(request).await
}

#[cfg(feature = "strict-worker-router-entrypoint")]
pub(crate) async fn start_registration_wallets(
    env: &Env,
    route: crate::WalletObjectRoute,
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
        wallet_route: route,
        wallet,
    };
    // Await every startup even when one role fails. No startup grants authority.
    let results = futures::join!(
        start_object(
            env,
            route,
            "ROUTER_WALLET_DO",
            &name,
            "router",
            &request.wallet,
        ),
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
    start_object(env, request.wallet_route, binding, &name, label, &()).await
}

const ADDRESS_BATCH_SIZE: usize = 8;

#[cfg(feature = "strict-worker-router-entrypoint")]
std::thread_local! {
    // Namespace IDs are public metadata. Unused IDs can be discarded on eviction.
    // The environment identity prevents a binding change from reusing old addresses.
    static UNUSED_ADDRESSES: std::cell::RefCell<Option<(Env, Vec<crate::WalletObjectAddresses>)>> =
        const { std::cell::RefCell::new(None) };
}

/// Allocation creates addresses only. The Gateway persists the winning set
/// before starting objects or dispatching custody work.
#[cfg(feature = "strict-worker-router-entrypoint")]
pub(crate) async fn allocate_wallet_addresses(env: &Env) -> worker::Result<Response> {
    if let Some(addresses) = take_unused_addresses(env) {
        return Response::from_json(&addresses);
    }
    // Each concurrent miss owns its own batch. No request awaits another
    // request's I/O, and no address can be returned twice.
    let (a, b, signing) = futures::join!(
        allocate_peer(env, "DERIVER_A"),
        allocate_peer(env, "DERIVER_B"),
        allocate_peer(env, "SIGNING_WORKER"),
    );
    let mut batch = Vec::with_capacity(ADDRESS_BATCH_SIZE);
    for ((deriver_a, deriver_b), signing_worker) in a?.into_iter().zip(b?).zip(signing?) {
        batch.push(crate::WalletObjectAddresses {
            router: allocate_address(env, "ROUTER_WALLET_DO")?,
            deriver_a,
            deriver_b,
            signing_worker,
        });
    }
    let addresses = batch.pop().expect("nonempty fixed-size address batch");
    UNUSED_ADDRESSES.with(|pool| *pool.borrow_mut() = Some((env.clone(), batch)));
    Response::from_json(&addresses)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn take_unused_addresses(env: &Env) -> Option<crate::WalletObjectAddresses> {
    UNUSED_ADDRESSES.with(|pool| {
        let mut held = pool.borrow_mut();
        match held.as_mut() {
            Some((owner, addresses)) if worker::js_sys::Object::is(owner.as_ref(), env.as_ref()) => {
                addresses.pop()
            }
            _ => {
                *held = None;
                None
            }
        }
    })
}

fn allocate_address(env: &Env, binding: &str) -> worker::Result<crate::WalletObjectId> {
    let raw = env.durable_object(binding)?.unique_id()?.to_string();
    crate::WalletObjectId::parse(&raw).map_err(|error| worker::Error::RustError(error.into()))
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn allocate_peer(
    env: &Env,
    binding: &str,
) -> worker::Result<[crate::WalletObjectId; ADDRESS_BATCH_SIZE]> {
    let mut response = crate::router_coordinator::post_role_request(
        env,
        binding,
        "https://router-ab-startup.internal",
        ALLOCATE_PATH,
        "Wallet address allocation",
        &(),
        None,
    )
    .await
    .map_err(|error| worker::Error::RustError(error.to_string()))?;
    if response.status_code() != 200 {
        return Err(worker::Error::RustError(
            "Wallet address allocation failed".into(),
        ));
    }
    response.json().await
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    feature = "strict-worker-signing-worker-entrypoint"
))]
pub(crate) fn allocate_role_address(
    request: &Request,
    env: &Env,
    role: crate::CloudflareWorkerRoleV1,
) -> worker::Result<Response> {
    if request.method() != Method::Post {
        return Response::error("Wallet address allocation requires POST", 405);
    }
    let binding = match role {
        crate::CloudflareWorkerRoleV1::DeriverA => "DERIVER_A_WALLET_DO",
        crate::CloudflareWorkerRoleV1::DeriverB => "DERIVER_B_WALLET_DO",
        crate::CloudflareWorkerRoleV1::SigningWorker => "SIGNING_WORKER_WALLET_DO",
        _ => return Response::error("Wallet address role is unavailable", 400),
    };
    let mut addresses = Vec::with_capacity(ADDRESS_BATCH_SIZE);
    for _ in 0..ADDRESS_BATCH_SIZE {
        addresses.push(allocate_address(env, binding)?);
    }
    Response::from_json(&addresses)
}
