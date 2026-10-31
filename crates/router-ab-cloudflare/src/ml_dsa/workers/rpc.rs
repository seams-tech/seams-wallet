//! Typed internal clients and authenticated HTTP forwarding.
use super::*;

pub(super) enum Failure {
    Transport(RouterAbProtocolError),
    Refused { status: u16 },
    Decode(RouterAbProtocolError),
}
impl From<Failure> for RouterAbProtocolError {
    fn from(value: Failure) -> Self {
        match value {
            Failure::Transport(error) | Failure::Decode(error) => error,
            Failure::Refused { status } => {
                invalid(&format!("ML-DSA role request refused with status {status}"))
            }
        }
    }
}
impl From<Failure> for worker::Error {
    fn from(value: Failure) -> Self {
        protocol_error(RouterAbProtocolError::from(value))
    }
}
pub(super) async fn local_call<R, C: Codec<R>>(
    env: &Env,
    command: &Request<RoleCommand, R, C>,
    call: Option<crate::CloudflareTraceIdV1>,
) -> core::result::Result<R, Failure> {
    let response = forward_local(env, command.wire(), call)
        .await
        .map_err(Failure::Transport)?;
    if response.status_code() != C::STATUS {
        return Err(Failure::Refused {
            status: response.status_code(),
        });
    }
    C::read(response).await.map_err(Failure::Decode)
}

/// Existing Deriver entrypoints authenticate before dispatch, and this route checks again.
pub(crate) async fn handle_role(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if request.method() != Method::Post {
        return Response::error("ML-DSA requires POST", 405);
    }
    if let Err(error) = crate::require_cloudflare_internal_service_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    let command: RoleCommand = decode_bounded_json_request(&mut request, 24 * 1024 * 1024)
        .await
        .map_err(protocol_error)?;
    let call = crate::parse_cloudflare_trace_id_from_request_v1(&request)
        .ok()
        .flatten();
    forward_local(env, &command, call)
        .await
        .map_err(protocol_error)
}
async fn forward_local(
    env: &Env,
    command: &RoleCommand,
    call: Option<crate::CloudflareTraceIdV1>,
) -> Result<Response> {
    let name = format!("ml-dsa-pool-{}", hex(&digest(b"wallet", command.wallet())?));
    let namespace = env.durable_object(POOL_BINDING).map_err(storage_error)?;
    let stub = namespace
        .id_from_name(&name)
        .map_err(storage_error)?
        .get_stub()
        .map_err(storage_error)?;
    let call = call.or_else(wait_trace::call_id);
    let trace = durable_trace::DurableTrace::role(env, command, call)?;
    let mut forwarded = object_request(env, CallAuthority::Internal, ROLE_PATH, command)?;
    if let Some(call) = call {
        crate::set_cloudflare_trace_id_header_v1(
            forwarded.headers_mut().map_err(storage_error)?,
            call,
        )?;
    }
    durable_trace::observe(
        trace.as_ref(),
        "pool_dispatch",
        stub.fetch_with_request(forwarded),
    )
    .await
    .map_err(storage_error)
}
#[derive(Clone, Copy)]
pub(super) enum CallAuthority<'a> {
    Gateway(&'a worker::Headers),
    Internal,
}
pub(super) fn object_request(
    env: &Env,
    authority: CallAuthority<'_>,
    path: &str,
    body: &impl Serialize,
) -> Result<worker::Request> {
    let headers = worker::Headers::new();
    if let CallAuthority::Gateway(gateway) = authority {
        let credential = zeroize::Zeroizing::new(
            gateway
                .get(crate::ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1)
                .map_err(storage_error)?
                .ok_or_else(|| invalid("Missing Gateway credential"))?,
        );
        headers
            .set(
                crate::ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                &credential,
            )
            .map_err(storage_error)?;
    } else {
        crate::set_cloudflare_internal_service_auth_header_v1(
            env,
            &headers,
            "ML-DSA durable command",
        )?;
    }
    headers
        .set("content-type", "application/json")
        .map_err(storage_error)?;
    let encoded =
        serde_json::to_string(body).map_err(|_| invalid("Cannot encode ML-DSA command"))?;
    let mut init = worker::RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&encoded)));
    worker::Request::new_with_init(&format!("https://ml-dsa.internal{path}"), &init)
        .map_err(storage_error)
}
pub(super) async fn service_call<R: serde::de::DeserializeOwned>(
    env: &Env,
    authority: CallAuthority<'_>,
    request: &Request<AdmissionCommand, R>,
) -> Result<R> {
    let command = request.wire();
    let namespace = env.durable_object(SERVICE_BINDING).map_err(storage_error)?;
    let stub = namespace
        .id_from_name(&routing::destination(env, command).await?.admission_name())
        .map_err(storage_error)?
        .get_stub()
        .map_err(storage_error)?;
    let path = if matches!(authority, CallAuthority::Gateway(_)) {
        CONTROL_PATH
    } else {
        CHECK_PATH
    };
    let call = wait_trace::call_id();
    let trace = durable_trace::DurableTrace::admission(env, command, call)?;
    let mut request = object_request(env, authority, path, command)?;
    if let Some(call) = call {
        crate::set_cloudflare_trace_id_header_v1(
            request.headers_mut().map_err(storage_error)?,
            call,
        )?;
    }
    let response = durable_trace::observe(
        trace.as_ref(),
        "admission_dispatch",
        stub.fetch_with_request(request),
    )
    .await
    .map_err(storage_error)?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA admission service refused the request"));
    }
    Json::read(response).await
}

pub(super) async fn role_call<R, C: Codec<R>>(
    env: &Env,
    binding: &str,
    request: &Request<RoleCommand, R, C>,
) -> Result<R> {
    let command = request.wire();
    let operation = match command {
        RoleCommand::InitializeRegistrationStorage { .. } => {
            "ML-DSA registration storage initialization"
        }
        RoleCommand::Inventory { .. } => "ML-DSA inventory",
        RoleCommand::Reserve { .. } => "ML-DSA reservation",
        RoleCommand::Fence { .. } => "ML-DSA settlement fence",
        RoleCommand::Release { .. } => "ML-DSA settlement release",
        _ => "ML-DSA role storage",
    };
    let call = wait_trace::call_id();
    let trace = durable_trace::DurableTrace::role(env, command, call)?;
    let response = durable_trace::observe(
        trace.as_ref(),
        "role_dispatch",
        crate::router_coordinator::post_role_request(
            env,
            binding,
            "https://ml-dsa-role.internal",
            ROLE_PATH,
            operation,
            command,
            call,
        ),
    )
    .await?;
    if response.status_code() != C::STATUS {
        return Err(invalid("ML-DSA role storage refused the request"));
    }
    C::read(response).await
}
