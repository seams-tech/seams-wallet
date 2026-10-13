//! Placement inspection runs only during relocation preparation. The trace page that it
//! reads also names the host of a wallet object for the command timing log.
use serde::{Deserialize, Serialize};
use worker::{Env, Method, Request, Response};

pub(crate) const PATH: &str = "/router-ab/internal/custody-target";
pub(super) const OBSERVE_PATH: &str = "/router-ab/internal/custody-target/location";

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Role {
    Router,
    DeriverA,
    DeriverB,
    SigningWorker,
    PresignSessions,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Placement {
    Existing,
    Destination { location_hint: LocationHint },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum LocationHint {
    Enam,
    Weur,
    Apac,
    Oc,
}

impl LocationHint {
    fn value(&self) -> &'static str {
        match self {
            Self::Enam => "enam",
            Self::Weur => "weur",
            Self::Apac => "apac",
            Self::Oc => "oc",
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Target {
    role: Role,
    object_name: String,
    placement: Placement,
}

pub(crate) async fn inspect(mut request: Request, env: &Env) -> worker::Result<Response> {
    let auth = if cfg!(feature = "strict-worker-router-entrypoint") {
        crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env)
    } else if cfg!(feature = "strict-worker-signing-worker-entrypoint") {
        crate::require_cloudflare_router_to_signing_worker_ecdsa_auth_request_v1(&request, env)
    } else {
        crate::require_cloudflare_internal_service_auth_request_v1(&request, env)
    };
    if let Err(error) = auth {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("Custody target inspection requires POST", 405);
    }
    let target: Target =
        match super::tenant_root_creation::decode_bounded_json_request(&mut request, 4096).await {
            Ok(target) => target,
            Err(error) => return crate::router_coordinator::protocol_error_response(error),
        };
    if target.object_name.is_empty()
        || target.object_name.len() > 512
        || !target
            .object_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_/".contains(&byte))
    {
        return Response::error("Custody object name is invalid", 400);
    }
    let wallet_route = if target.role == Role::PresignSessions {
        None
    } else {
        Some(crate::WalletObjectRoute::from_gateway_request(&request)
            .map_err(|error| worker::Error::RustError(error.to_string()))?)
    };
    if cfg!(feature = "strict-worker-router-entrypoint") && target.role != Role::Router {
        let service = match target.role {
            Role::DeriverA => "DERIVER_A",
            Role::DeriverB => "DERIVER_B",
            Role::SigningWorker | Role::PresignSessions => "SIGNING_WORKER",
            Role::Router => unreachable!(),
        };
        let mut forwarded = json_request(PATH, &target)?;
        let headers = forwarded.headers_mut()?;
        if let Some(route) = wallet_route { route.set_headers(headers).map_err(|error| worker::Error::RustError(error.to_string()))?; }
        let authorization = if matches!(target.role, Role::SigningWorker | Role::PresignSessions) {
            crate::set_cloudflare_router_to_signing_worker_ecdsa_auth_header_v1(
                env,
                headers,
                "Custody target",
            )
        } else {
            crate::set_cloudflare_internal_service_auth_header_v1(env, headers, "Custody target")
        };
        if let Err(error) = authorization {
            return crate::router_coordinator::protocol_error_response(error);
        }
        return env.service(service)?.fetch_request(forwarded).await;
    }
    let binding = match target.role {
        Role::Router if cfg!(feature = "strict-worker-router-entrypoint") => "ROUTER_WALLET_DO",
        Role::DeriverA if cfg!(feature = "strict-worker-deriver-a-entrypoint") => {
            "DERIVER_A_WALLET_DO"
        }
        Role::DeriverB if cfg!(feature = "strict-worker-deriver-b-entrypoint") => {
            "DERIVER_B_WALLET_DO"
        }
        Role::SigningWorker if cfg!(feature = "strict-worker-signing-worker-entrypoint") => {
            "SIGNING_WORKER_WALLET_DO"
        }
        Role::PresignSessions if cfg!(feature = "strict-worker-signing-worker-entrypoint") => {
            "SIGNING_WORKER_PRESIGN_SESSION_DO"
        }
        _ => return Response::error("Custody target role differs from worker", 400),
    };
    let namespace = env.durable_object(binding)?;
    let id = match wallet_route {
        Some(route) => {
            let address = match target.role {
                Role::Router => route.addresses.router,
                Role::DeriverA => route.addresses.deriver_a,
                Role::DeriverB => route.addresses.deriver_b,
                Role::SigningWorker => route.addresses.signing_worker,
                Role::PresignSessions => unreachable!(),
            };
            namespace.id_from_string(address.as_str())?
        }
        None => namespace.id_from_name(&target.object_name)?,
    };
    let stub = match &target.placement {
        Placement::Existing => id.get_stub()?,
        Placement::Destination { location_hint } => {
            id.get_stub_with_location_hint(location_hint.value())?
        }
    };
    let mut response = stub
        .fetch_with_request(json_request(OBSERVE_PATH, &())?)
        .await?;
    if response.status_code() != 200 {
        return Ok(response);
    }
    let location: serde_json::Value = response.json().await?;
    Response::from_json(&serde_json::json!({
        "object_id": id.to_string(), "object_name": target.object_name, "location": location,
    }))
}

fn json_request<T: Serialize>(path: &str, value: &T) -> worker::Result<Request> {
    let body = serde_json::to_string(value)?;
    let mut init = worker::RequestInit::new();
    init.with_method(Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&body)));
    Request::new_with_init(&format!("https://custody.internal{path}"), &init)
}

/// The platform's trace page as the calling object sees it, or nothing when it is unavailable.
async fn trace() -> worker::Result<Option<String>> {
    let url = worker::Url::parse("https://cloudflare.com/cdn-cgi/trace")?;
    let mut response = worker::Fetch::Url(url).send().await?;
    if response.status_code() != 200 {
        return Ok(None);
    }
    response.text().await.map(Some)
}

fn trace_field<'a>(trace: &'a str, name: &str) -> Option<&'a str> {
    trace
        .lines()
        .find_map(|line| line.strip_prefix(name)?.strip_prefix('='))
}

pub(super) async fn observe_location() -> worker::Result<Response> {
    let Some(trace) = trace().await? else {
        return Response::error("Custody placement observation unavailable", 503);
    };
    match (trace_field(&trace, "colo"), trace_field(&trace, "loc")) {
        (Some(colo), Some(country)) if colo.len() == 3 && country.len() == 2 => {
            Response::from_json(&serde_json::json!({"colo": colo, "country": country}))
        }
        _ => Response::error("Custody placement observation is invalid", 503),
    }
}

/// The colo and the host that run the calling object, or nothing when the trace page gives no
/// valid pair. The host is the page's `fl` value.
pub(super) async fn observe_host() -> Option<(String, String)> {
    let trace = trace().await.ok()??;
    let colo = trace_field(&trace, "colo")?;
    let host = trace_field(&trace, "fl")?;
    let valid = colo.len() == 3
        && (1..=16).contains(&host.len())
        && host.bytes().all(|byte| byte.is_ascii_alphanumeric());
    valid.then(|| (colo.to_owned(), host.to_owned()))
}
