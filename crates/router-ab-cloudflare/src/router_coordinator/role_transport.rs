//! Service-bound requests and bounded transfer diagnostics.
use super::*;

pub(super) async fn post_role_json<TRequest, TResponse>(
    env: &Env,
    binding_name: &str,
    service_origin: &str,
    path: &str,
    label: &str,
    body: &TRequest,
    trace_id: Option<crate::CloudflareTraceIdV1>,
) -> RouterAbProtocolResult<TResponse>
where
    TRequest: Serialize,
    TResponse: DeserializeOwned,
{
    let mut response = post_role_request(
        env,
        binding_name,
        service_origin,
        path,
        label,
        body,
        trace_id,
    )
    .await?;
    read_role_json_response(&mut response, label, trace_id).await
}

/// As `post_role_json`, for a role handler that opens a wallet object from
/// the request's route headers.
#[allow(clippy::too_many_arguments)]
pub(super) async fn post_wallet_routed_role_json<TRequest, TResponse>(
    env: &Env,
    wallet_route: crate::WalletObjectRoute,
    binding_name: &str,
    service_origin: &str,
    path: &str,
    label: &str,
    body: &TRequest,
    trace_id: Option<crate::CloudflareTraceIdV1>,
) -> RouterAbProtocolResult<TResponse>
where
    TRequest: Serialize,
    TResponse: DeserializeOwned,
{
    let mut response = send_role_request(
        env,
        Some(wallet_route),
        binding_name,
        service_origin,
        path,
        label,
        body,
        trace_id,
    )
    .await?;
    read_role_json_response(&mut response, label, trace_id).await
}

pub(super) async fn read_role_json_response<TResponse: DeserializeOwned>(
    response: &mut Response,
    label: &str,
    trace_id: Option<crate::CloudflareTraceIdV1>,
) -> RouterAbProtocolResult<TResponse> {
    if !(200..=299).contains(&response.status_code()) {
        let status = response.status_code();
        let body = response.text().await.unwrap_or_default();
        // A peer's refusal of a superseded attempt is final; the caller
        // answers it as such rather than as a service failure.
        if crate::router_ab_peer_error_code_v1(&body)
            == RouterAbProtocolErrorCode::SupersededAttempt
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::SupersededAttempt,
                format!("{label} refused a superseded attempt: {}", body.trim()),
            ));
        }
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} service returned HTTP {status}"),
        ));
    }
    read_role_response(response, label, trace_id)
        .await
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} response JSON parse failed: {error}"),
            )
        })
}

async fn post_role_json_for_ceremony<TRequest, TResponse>(
    env: &Env,
    binding_name: &str,
    service_origin: &str,
    path: &str,
    label: &str,
    body: &TRequest,
    trace_id: Option<crate::CloudflareTraceIdV1>,
) -> Result<TResponse, RouterRoleCallError>
where
    TRequest: Serialize,
    TResponse: DeserializeOwned,
{
    let mut response = post_role_request(
        env,
        binding_name,
        service_origin,
        path,
        label,
        body,
        trace_id,
    )
    .await
    .map_err(RouterRoleCallError::Protocol)?;
    if !(200..=299).contains(&response.status_code()) {
        let status = response.status_code();
        let response_body = response.text().await.map_err(|error| {
            RouterRoleCallError::Protocol(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} error response body read failed: {error}"),
            ))
        })?;
        if let Ok(failure) =
            serde_json::from_str::<CloudflareEd25519YaoRoleFailureResponseV1>(&response_body)
        {
            return Err(RouterRoleCallError::Failure(failure));
        }
        return Err(RouterRoleCallError::Protocol(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} service returned HTTP {status}"),
        )));
    }
    read_role_response(&mut response, label, trace_id)
        .await
        .map_err(|error| {
            RouterRoleCallError::Protocol(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("{label} response JSON parse failed: {error}"),
            ))
        })
}

pub(crate) async fn post_role_request<TRequest>(
    env: &Env,
    binding_name: &str,
    service_origin: &str,
    path: &str,
    label: &str,
    body: &TRequest,
    trace_id: Option<crate::CloudflareTraceIdV1>,
) -> RouterAbProtocolResult<Response>
where
    TRequest: Serialize,
{
    send_role_request(
        env,
        None,
        binding_name,
        service_origin,
        path,
        label,
        body,
        trace_id,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn send_role_request<TRequest>(
    env: &Env,
    wallet_route: Option<crate::WalletObjectRoute>,
    binding_name: &str,
    service_origin: &str,
    path: &str,
    label: &str,
    body: &TRequest,
    trace_id: Option<crate::CloudflareTraceIdV1>,
) -> RouterAbProtocolResult<Response>
where
    TRequest: Serialize,
{
    let fetcher = env.service(binding_name).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} service binding lookup failed: {error}"),
        )
    })?;
    let serialized = cloudflare_service_json_request_body_v1(label, body)?;
    let headers = worker::Headers::new();
    headers
        .set("content-type", "application/json")
        .map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{label} content-type header failed: {error}"),
            )
        })?;
    set_cloudflare_internal_service_auth_header_v1(env, &headers, label)?;
    if let Some(wallet_route) = wallet_route {
        wallet_route.set_headers(&headers)?;
    }
    if let Some(trace_id) = trace_id {
        set_cloudflare_trace_id_header_v1(&headers, trace_id)?;
    }
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&serialized)));
    let request =
        Request::new_with_init(&format!("{service_origin}{path}"), &init).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{label} request construction failed: {error}"),
            )
        })?;
    let started_at_ms = cloudflare_now_unix_ms_v1().unwrap_or_default();
    let response = fetcher.fetch_request(request).await.map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{label} service request failed: {error}"),
        )
    })?;
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "router_ab_yao_transport_v1",
            "trace_id": trace_id.map(crate::CloudflareTraceIdV1::as_hex),
            "service": label,
            "stage": "fetch_headers",
            "request_bytes": serialized.len(),
            "duration_ms": cloudflare_now_unix_ms_v1().unwrap_or_default().saturating_sub(started_at_ms),
            "status": response.status_code(),
        })
    );
    Ok(response)
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn post_role_json_for_ceremony_with_span<TRequest, TResponse>(
    env: &Env,
    binding_name: &str,
    service_origin: &str,
    path: &str,
    label: &str,
    body: &TRequest,
    trace_id: Option<crate::CloudflareTraceIdV1>,
    span: &str,
    operation: &str,
) -> Result<TResponse, RouterRoleCallError>
where
    TRequest: Serialize,
    TResponse: DeserializeOwned,
{
    let started_at_ms = cloudflare_now_unix_ms_v1().unwrap_or_default();
    let result = post_role_json_for_ceremony(
        env,
        binding_name,
        service_origin,
        path,
        label,
        body,
        trace_id,
    )
    .await;
    emit_span(
        trace_id,
        span,
        operation,
        started_at_ms,
        if result.is_ok() { "success" } else { "failure" },
    );
    result
}

async fn read_role_response<T: DeserializeOwned>(
    response: &mut Response,
    label: &str,
    trace_id: Option<crate::CloudflareTraceIdV1>,
) -> worker::Result<T> {
    let started_at_ms = cloudflare_now_unix_ms_v1().unwrap_or_default();
    let body = response.text().await?;
    let read_at_ms = cloudflare_now_unix_ms_v1().unwrap_or_default();
    let result = serde_json::from_str(&body).map_err(worker::Error::from);
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "router_ab_yao_transport_v1",
            "trace_id": trace_id.map(crate::CloudflareTraceIdV1::as_hex),
            "service": label,
            "stage": "read_response",
            "response_bytes": body.len(),
            "body_read_ms": read_at_ms.saturating_sub(started_at_ms),
            "decode_ms": cloudflare_now_unix_ms_v1().unwrap_or_default().saturating_sub(read_at_ms),
        })
    );
    result
}
