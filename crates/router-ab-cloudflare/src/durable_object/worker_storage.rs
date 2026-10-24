use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    encode_base64url_bytes_v1, require_non_empty, CloudflareSigningWorkerPresignSessionBindingV1,
    CloudflareSigningWorkerWalletScopeV1, MpcMaterialActivationRefV1,
    RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult,
};

/// Owner preprocessing reuses its exact material host. Linked signing is request-bound.
pub(crate) enum PresignHost<'a> {
    Owner {
        ownership_generation: u64,
        wallet: &'a CloudflareSigningWorkerWalletScopeV1,
        material: &'a MpcMaterialActivationRefV1,
    },
    LinkedSession { session_id: &'a str, ownership_generation: u64 },
}

/// Activation has committed before this task starts. Warming creates no session or authority.
pub(crate) async fn warm_owner_presign_host(
    env: worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    binding: CloudflareSigningWorkerPresignSessionBindingV1,
    wallet: CloudflareSigningWorkerWalletScopeV1,
    ownership_generation: u64,
    material: MpcMaterialActivationRefV1,
) {
    let started_at = worker::Date::now().as_millis();
    let result: RouterAbProtocolResult<bool> =
        execute_cloudflare_durable_object_custom_json_call_v1(
            &env,
            wallet_objects,
            &binding,
            crate::CLOUDFLARE_INTERNAL_PREWARM_PATH,
            PresignHost::Owner {
                ownership_generation,
                wallet: &wallet,
                material: &material,
            },
            &(),
        )
        .await;
    worker::console_log!(
        "presign_host_warm success={} duration_ms={}",
        matches!(result, Ok(true)),
        worker::Date::now().as_millis().saturating_sub(started_at),
    );
}

pub(crate) struct CloudflareDurableObjectJsonResponseV1<TResponse> {
    pub(crate) value: TResponse,
    pub(crate) server_timing: Option<String>,
}

pub(crate) async fn execute_cloudflare_durable_object_custom_json_call_v1<TRequest, TResponse>(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    binding: &CloudflareSigningWorkerPresignSessionBindingV1,
    path: &str,
    host: PresignHost<'_>,
    request: &TRequest,
) -> RouterAbProtocolResult<TResponse>
where
    TRequest: Serialize,
    TResponse: DeserializeOwned,
{
    Ok(
        execute_cloudflare_durable_object_custom_json_call_with_timing_v1(
            env, wallet_objects, binding, path, host, request,
        )
        .await?
        .value,
    )
}

pub(crate) async fn execute_cloudflare_durable_object_custom_json_call_with_timing_v1<
    TRequest,
    TResponse,
>(
    env: &worker::Env,
    wallet_objects: crate::WalletObjectRoute,
    binding: &CloudflareSigningWorkerPresignSessionBindingV1,
    path: &str,
    host: PresignHost<'_>,
    request: &TRequest,
) -> RouterAbProtocolResult<CloudflareDurableObjectJsonResponseV1<TResponse>>
where
    TRequest: Serialize,
    TResponse: DeserializeOwned,
{
    binding.validate()?;
    require_non_empty("Durable Object custom path", path)?;
    let object_name = presign_object_name(binding, host)?;
    let namespace = env.durable_object(&binding.binding_name).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingLocalBinding,
            format!("Durable Object namespace lookup failed: {error}"),
        )
    })?;
    let stub = wallet_objects.home.presign_stub(&namespace, &object_name).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("Durable Object stub lookup failed: {error}"),
        )
    })?;
    let request_body = serde_json::to_string(request).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Durable Object custom request encoding failed: {error}"),
        )
    })?;
    let headers = worker::Headers::new();
    wallet_objects.set_headers(&headers)?;
    let mut init = worker::RequestInit::new();
    init.with_headers(headers).with_method(worker::Method::Post)
        .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&request_body)));
    let url = format!("https://router-ab-do.internal{path}");
    let request = worker::Request::new_with_init(&url, &init).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("Durable Object custom request construction failed: {error}"),
        )
    })?;
    let mut io_timing = crate::CloudflareEcdsaBoundaryTimingV1::new();
    let headers_started_at_ms = crate::CloudflareEcdsaBoundaryTimingV1::now_ms();
    let mut response = stub.fetch_with_request(request).await.map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("Durable Object custom request failed: {error}"),
        )
    })?;
    io_timing.mark("do_response_headers", headers_started_at_ms);
    let status = response.status_code();
    if !(200..=299).contains(&status) {
        let body = response.text().await.unwrap_or_default();
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("Durable Object custom request returned HTTP {status}: {body}"),
        ));
    }
    io_timing.merge_role(
        "do_handler",
        response.headers().get("Server-Timing").ok().flatten(),
    );
    let body_started_at_ms = crate::CloudflareEcdsaBoundaryTimingV1::now_ms();
    let value = response.json::<TResponse>().await.map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("Durable Object custom response JSON is invalid: {error}"),
        )
    })?;
    io_timing.mark("do_response_body", body_started_at_ms);
    Ok(CloudflareDurableObjectJsonResponseV1 {
        value,
        server_timing: Some(io_timing.server_timing()),
    })
}

fn presign_object_name(
    binding: &CloudflareSigningWorkerPresignSessionBindingV1,
    host: PresignHost<'_>,
) -> RouterAbProtocolResult<String> {
    let ownership_generation = match &host {
        PresignHost::Owner { ownership_generation, .. }
        | PresignHost::LinkedSession { ownership_generation, .. } => *ownership_generation,
    };
    let digest = match host {
        PresignHost::Owner { wallet, material, .. } => {
            wallet.validate()?;
            material.validate()?;
            if wallet.wallet_id != material.material_owner {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidGateDecision,
                    "Presign host wallet differs from material owner",
                ));
            }
            let identity = serde_json::to_vec(&("owner-presign-host/v1", wallet, material))
                .map_err(|error| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::MalformedWirePayload,
                        format!("Presign host identity encoding failed: {error}"),
                    )
                })?;
            Sha256::digest(identity)
        }
        PresignHost::LinkedSession { session_id, .. } => {
            require_non_empty("Linked presign session routing key", session_id)?;
            Sha256::digest(session_id.as_bytes())
        }
    };
    crate::wallet_object::physical_wallet_object_name(
        &format!("{}-{}", binding.object_name, encode_base64url_bytes_v1(&digest)),
        ownership_generation,
    )
}
