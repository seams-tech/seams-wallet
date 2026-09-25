use crate::CloudflareRouterEd25519JwkV1;
#[cfg(feature = "workers-rs")]
use crate::{
    cloudflare_router_error_status, require_non_empty, worker_binding_error,
    worker_binding_error_code, ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET_BINDING,
    ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET_BINDING,
    ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET_BINDING,
    ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET_BINDING_ENV,
};
use ed25519_dalek::{Signature as Ed25519Signature, VerifyingKey as Ed25519VerifyingKey};
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use sha2::{Digest as Sha2Digest, Sha256};
#[cfg(feature = "workers-rs")]
use zeroize::Zeroize;

#[cfg(feature = "workers-rs")]
fn load_cloudflare_internal_service_auth_secret_v1(
    env: &worker::Env,
) -> RouterAbProtocolResult<String> {
    let binding_name = env
        .var(ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET_BINDING_ENV)
        .map_err(|err| {
            worker_binding_error(
                worker_binding_error_code(&err, ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET_BINDING_ENV),
                ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET_BINDING_ENV,
                "text Env",
                err,
            )
        })?
        .to_string();
    let binding_name = binding_name.trim().to_owned();
    require_non_empty(
        ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET_BINDING_ENV,
        &binding_name,
    )?;
    load_cloudflare_service_auth_secret_v1(env, &binding_name)
}

#[cfg(feature = "workers-rs")]
fn load_cloudflare_service_auth_secret_v1(
    env: &worker::Env,
    binding_name: &str,
) -> RouterAbProtocolResult<String> {
    let secret = env.secret(binding_name).map_err(|err| {
        worker_binding_error(
            worker_binding_error_code(&err, binding_name),
            binding_name,
            "secret",
            err,
        )
    })?;
    let mut secret_value = secret.to_string();
    let secret = secret_value.trim().to_owned();
    secret_value.zeroize();
    require_non_empty(binding_name, &secret)?;
    Ok(secret)
}

#[cfg(feature = "workers-rs")]
pub fn set_cloudflare_internal_service_auth_header_v1(
    env: &worker::Env,
    headers: &worker::Headers,
    request_kind: &str,
) -> RouterAbProtocolResult<()> {
    require_non_empty("Cloudflare service-auth request kind", request_kind)?;
    let mut secret = load_cloudflare_internal_service_auth_secret_v1(env)?;
    let result = headers
        .set(ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, &secret)
        .map_err(|err| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{request_kind} service-auth header construction failed: {err}"),
            )
        });
    secret.zeroize();
    result
}

#[cfg(feature = "workers-rs")]
pub fn set_cloudflare_router_to_signing_worker_ecdsa_auth_header_v1(
    env: &worker::Env,
    headers: &worker::Headers,
    request_kind: &str,
) -> RouterAbProtocolResult<()> {
    require_non_empty("Cloudflare service-auth request kind", request_kind)?;
    let mut secret = load_cloudflare_service_auth_secret_v1(
        env,
        ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET_BINDING,
    )?;
    let result = headers
        .set(ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, &secret)
        .map_err(|err| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("{request_kind} service-auth header construction failed: {err}"),
            )
        });
    secret.zeroize();
    result
}

#[cfg(feature = "workers-rs")]
pub fn require_cloudflare_internal_service_auth_request_v1(
    request: &worker::Request,
    env: &worker::Env,
) -> RouterAbProtocolResult<()> {
    require_cloudflare_service_auth_request_v1(
        request,
        load_cloudflare_internal_service_auth_secret_v1(env)?,
    )
}

#[cfg(feature = "workers-rs")]
pub fn require_cloudflare_gateway_to_router_auth_request_v1(
    request: &worker::Request,
    env: &worker::Env,
) -> RouterAbProtocolResult<()> {
    let mut shared = load_cloudflare_internal_service_auth_secret_v1(env)?;
    let mut gateway = match load_cloudflare_service_auth_secret_v1(
        env,
        ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET_BINDING,
    ) {
        Ok(secret) => secret,
        Err(error) => {
            shared.zeroize();
            return Err(error);
        }
    };
    let same_credential = router_ab_service_credential_matches_v1(&shared, &gateway);
    shared.zeroize();
    if same_credential {
        gateway.zeroize();
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Gateway-to-Router auth secret must differ from role-shared service auth",
        ));
    }
    require_cloudflare_service_auth_request_v1(request, gateway)
}

#[cfg(feature = "workers-rs")]
pub fn require_cloudflare_gateway_to_signing_worker_presign_auth_request_v1(
    request: &worker::Request,
    env: &worker::Env,
) -> RouterAbProtocolResult<()> {
    let mut shared = load_cloudflare_internal_service_auth_secret_v1(env)?;
    let mut gateway = match load_cloudflare_service_auth_secret_v1(
        env,
        ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET_BINDING,
    ) {
        Ok(secret) => secret,
        Err(error) => {
            shared.zeroize();
            return Err(error);
        }
    };
    let same_credential = router_ab_service_credential_matches_v1(&shared, &gateway);
    shared.zeroize();
    if same_credential {
        gateway.zeroize();
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Gateway-to-SigningWorker presign auth secret must differ from role-shared service auth",
        ));
    }
    require_cloudflare_service_auth_request_v1(request, gateway)
}

#[cfg(feature = "workers-rs")]
pub fn require_cloudflare_router_to_signing_worker_ecdsa_auth_request_v1(
    request: &worker::Request,
    env: &worker::Env,
) -> RouterAbProtocolResult<()> {
    let mut shared = load_cloudflare_internal_service_auth_secret_v1(env)?;
    let mut gateway_presign = match load_cloudflare_service_auth_secret_v1(
        env,
        ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET_BINDING,
    ) {
        Ok(secret) => secret,
        Err(error) => {
            shared.zeroize();
            return Err(error);
        }
    };
    let mut router = match load_cloudflare_service_auth_secret_v1(
        env,
        ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET_BINDING,
    ) {
        Ok(secret) => secret,
        Err(error) => {
            shared.zeroize();
            gateway_presign.zeroize();
            return Err(error);
        }
    };
    let reused = router_ab_service_credential_matches_v1(&shared, &router)
        || router_ab_service_credential_matches_v1(&gateway_presign, &router);
    shared.zeroize();
    gateway_presign.zeroize();
    if reused {
        router.zeroize();
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Router-to-SigningWorker ECDSA auth secret must be distinct",
        ));
    }
    require_cloudflare_service_auth_request_v1(request, router)
}

#[cfg(feature = "workers-rs")]
fn require_cloudflare_service_auth_request_v1(
    request: &worker::Request,
    mut expected: String,
) -> RouterAbProtocolResult<()> {
    let presented = request
        .headers()
        .get(ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1)
        .map_err(|err| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
                format!("Router A/B internal service-auth header read failed: {err}"),
            )
        })?
        .unwrap_or_default();
    let authorized = router_ab_service_credential_matches_v1(&expected, &presented);
    expected.zeroize();
    if authorized {
        return Ok(());
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
        "Router A/B private Worker request is missing valid service auth",
    ))
}

#[cfg(feature = "workers-rs")]
pub fn cloudflare_private_service_auth_error_response_v1(
    err: RouterAbProtocolError,
) -> worker::Result<worker::Response> {
    let status = match err.code() {
        RouterAbProtocolErrorCode::InvalidLocalHttpRequest => 403,
        code => cloudflare_router_error_status(code),
    };
    worker::Response::error(format!("{:?}: {}", err.code(), err.message()), status)
}

/// Constant-time comparison of a presented service credential against the
/// expected one. Both the Cloudflare adapter and the VM role processes use it.
pub fn router_ab_service_credential_matches_v1(expected: &str, presented: &str) -> bool {
    let a = expected.as_bytes();
    let b = presented.as_bytes();
    let mut diff = a.len() ^ b.len();
    let max_len = core::cmp::max(a.len(), b.len());
    for index in 0..max_len {
        let left = a.get(index).copied().unwrap_or_default();
        let right = b.get(index).copied().unwrap_or_default();
        diff |= (left ^ right) as usize;
    }
    diff == 0 && !a.is_empty()
}

/// Rejects a deployment that reuses one credential for two service boundaries.
pub fn require_distinct_router_ab_service_credentials_v1(
    boundary: &str,
    dedicated: &str,
    shared: &str,
) -> RouterAbProtocolResult<()> {
    if dedicated.trim().is_empty() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{boundary} auth secret is required"),
        ));
    }
    if router_ab_service_credential_matches_v1(dedicated, shared) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("{boundary} auth secret must differ from role-shared service auth"),
        ));
    }
    Ok(())
}

pub(crate) fn verify_router_ed25519_jwt_signature_v1(
    signing_input: &str,
    signature: &[u8; 64],
    key: &CloudflareRouterEd25519JwkV1,
) -> RouterAbProtocolResult<()> {
    key.validate()?;
    let verifying_key = Ed25519VerifyingKey::from_bytes(&key.public_key).map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Router JWT Ed25519 JWK public key bytes are invalid",
        )
    })?;
    let signature = Ed25519Signature::from_bytes(signature);
    verifying_key
        .verify_strict(signing_input.as_bytes(), &signature)
        .map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "Router JWT Ed25519 signature verification failed",
            )
        })
}

pub(crate) fn unix_seconds_to_millis_v1(field: &str, seconds: u64) -> RouterAbProtocolResult<u64> {
    seconds.checked_mul(1_000).ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidTimeRange,
            format!("{field} seconds overflow milliseconds"),
        )
    })
}

pub(crate) fn router_jwt_segment_error() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        "Router JWT must use compact three-segment serialization",
    )
}

pub(crate) fn hash_optional_header_v1(hasher: &mut Sha256, name: &[u8], value: Option<&str>) {
    hasher.update((name.len() as u64).to_be_bytes());
    hasher.update(name);
    match value {
        Some(value) => {
            let bytes = value.as_bytes();
            hasher.update((bytes.len() as u64).to_be_bytes());
            hasher.update(bytes);
        }
        None => hasher.update(0u64.to_be_bytes()),
    }
}
