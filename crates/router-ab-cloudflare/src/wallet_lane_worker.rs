use crate::{
    admit_wallet_lane_internal_request_authority_v1, authenticate_wallet_lane_internal_request_v1,
    load_cloudflare_deriver_active_wallet_lane_authority_v1,
    load_cloudflare_signing_worker_active_wallet_lane_authority_v1,
    AuthenticatedWalletLaneInternalRequestV1, VerifiedWalletLaneInternalRequestV1,
    WalletLaneInternalRequestExpectationV1, WalletLaneInternalRequestSignerV1,
    WalletLaneInternalRequestVerifierV1, WalletLaneInternalServiceRoleV1,
    WALLET_LANE_INTERNAL_REQUEST_HEADER_V1,
};
use base64::Engine;
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use sha2::{Digest, Sha256};
use worker::{Env, Request};
use zeroize::Zeroize;

pub const WALLET_LANE_REQUEST_ISSUER_ENV_V1: &str = "WALLET_LANE_REQUEST_ISSUER";
pub const WALLET_LANE_REQUEST_AUDIENCE_ENV_V1: &str = "WALLET_LANE_REQUEST_AUDIENCE";
pub const WALLET_LANE_REQUEST_JWKS_JSON_ENV_V1: &str = "WALLET_LANE_REQUEST_JWKS_JSON";
pub const WALLET_LANE_REQUEST_SIGNING_KEY_ID_ENV_V1: &str = "WALLET_LANE_REQUEST_SIGNING_KEY_ID";
pub const WALLET_LANE_REQUEST_SIGNING_KEY_BINDING_ENV_V1: &str =
    "WALLET_LANE_REQUEST_SIGNING_KEY_BINDING";

/// Parses the shared Gateway and Router verification trust bundle.
pub fn parse_cloudflare_wallet_lane_request_verifier_v1(
    env: &Env,
) -> RouterAbProtocolResult<WalletLaneInternalRequestVerifierV1> {
    let issuer = read_wallet_lane_env_var_v1(env, WALLET_LANE_REQUEST_ISSUER_ENV_V1)?;
    let audience = read_wallet_lane_env_var_v1(env, WALLET_LANE_REQUEST_AUDIENCE_ENV_V1)?;
    let jwks = read_wallet_lane_env_var_v1(env, WALLET_LANE_REQUEST_JWKS_JSON_ENV_V1)?;
    WalletLaneInternalRequestVerifierV1::new(issuer, audience, &jwks)
        .map_err(map_wallet_lane_config_error_v1)
}

/// Loads the Router's zeroizing signing Secret and checks it against the trust bundle.
pub fn parse_cloudflare_wallet_lane_request_signer_v1(
    env: &Env,
) -> RouterAbProtocolResult<WalletLaneInternalRequestSignerV1> {
    let issuer = read_wallet_lane_env_var_v1(env, WALLET_LANE_REQUEST_ISSUER_ENV_V1)?;
    let audience = read_wallet_lane_env_var_v1(env, WALLET_LANE_REQUEST_AUDIENCE_ENV_V1)?;
    let key_id = read_wallet_lane_env_var_v1(env, WALLET_LANE_REQUEST_SIGNING_KEY_ID_ENV_V1)?;
    let binding = read_wallet_lane_env_var_v1(env, WALLET_LANE_REQUEST_SIGNING_KEY_BINDING_ENV_V1)?;
    let mut encoded_seed = env
        .secret(&binding)
        .map_err(|error| {
            wallet_lane_config_error_v1(format!(
                "wallet lane request signing Secret {binding} is missing: {error}"
            ))
        })?
        .to_string();
    let seed = decode_wallet_lane_signing_seed_v1(&encoded_seed);
    encoded_seed.zeroize();
    let signer = WalletLaneInternalRequestSignerV1::new(issuer, audience, key_id, seed?)
        .map_err(map_wallet_lane_config_error_v1)?;
    let verifier = parse_cloudflare_wallet_lane_request_verifier_v1(env)?;
    signer
        .validate_against_verifier(&verifier)
        .map_err(map_wallet_lane_config_error_v1)?;
    Ok(signer)
}

/// Authenticates one exact request at a regional Worker boundary.
pub async fn authenticate_cloudflare_wallet_lane_request_v1(
    request: &Request,
    env: &Env,
    service_role: WalletLaneInternalServiceRoleV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<AuthenticatedWalletLaneInternalRequestV1> {
    let token = request
        .headers()
        .get(WALLET_LANE_INTERNAL_REQUEST_HEADER_V1)
        .map_err(|error| {
            wallet_lane_request_error_v1(format!("wallet lane request header read failed: {error}"))
        })?
        .ok_or_else(|| wallet_lane_request_error_v1("wallet lane request header is missing"))?;
    let url = request.url().map_err(|error| {
        wallet_lane_request_error_v1(format!("wallet lane request URL is invalid: {error}"))
    })?;
    let mut request_target = url.path().to_owned();
    if let Some(query) = url.query() {
        request_target.push('?');
        request_target.push_str(query);
    }
    let mut body_request = request.clone().map_err(|error| {
        wallet_lane_request_error_v1(format!("wallet lane request clone failed: {error}"))
    })?;
    let body = body_request.bytes().await.map_err(|error| {
        wallet_lane_request_error_v1(format!("wallet lane request body read failed: {error}"))
    })?;
    let expectation = WalletLaneInternalRequestExpectationV1::new(
        service_role,
        request.method().to_string(),
        request_target,
        Sha256::digest(&body).into(),
    )?;
    authenticate_wallet_lane_internal_request_v1(
        &token,
        &parse_cloudflare_wallet_lane_request_verifier_v1(env)?,
        &expectation,
        now_unix_ms,
    )
}

/// Authenticates and admits one Deriver request against its primary D1 authority.
pub async fn admit_cloudflare_deriver_wallet_lane_request_v1(
    request: &Request,
    env: &Env,
    service_role: WalletLaneInternalServiceRoleV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<VerifiedWalletLaneInternalRequestV1> {
    if !matches!(
        service_role,
        WalletLaneInternalServiceRoleV1::DeriverA | WalletLaneInternalServiceRoleV1::DeriverB
    ) {
        return Err(wallet_lane_config_error_v1(
            "Deriver lane admission requires a Deriver role",
        ));
    }
    let authenticated =
        authenticate_cloudflare_wallet_lane_request_v1(request, env, service_role, now_unix_ms)
            .await?;
    let authority =
        load_cloudflare_deriver_active_wallet_lane_authority_v1(env, authenticated.wallet_id())
            .await?;
    admit_wallet_lane_internal_request_authority_v1(authenticated, &authority)
}

/// Authenticates and admits one SigningWorker request against its primary D1 authority.
pub async fn admit_cloudflare_signing_worker_wallet_lane_request_v1(
    request: &Request,
    env: &Env,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<VerifiedWalletLaneInternalRequestV1> {
    let authenticated = authenticate_cloudflare_wallet_lane_request_v1(
        request,
        env,
        WalletLaneInternalServiceRoleV1::SigningWorker,
        now_unix_ms,
    )
    .await?;
    let authority = load_cloudflare_signing_worker_active_wallet_lane_authority_v1(
        env,
        authenticated.wallet_id(),
    )
    .await?;
    admit_wallet_lane_internal_request_authority_v1(authenticated, &authority)
}

fn read_wallet_lane_env_var_v1(env: &Env, name: &str) -> RouterAbProtocolResult<String> {
    let value = env
        .var(name)
        .map_err(|error| {
            wallet_lane_config_error_v1(format!(
                "wallet lane request config {name} is missing: {error}"
            ))
        })?
        .to_string();
    if value.is_empty() || value.trim() != value {
        return Err(wallet_lane_config_error_v1(format!(
            "wallet lane request config {name} is invalid"
        )));
    }
    Ok(value)
}

fn decode_wallet_lane_signing_seed_v1(value: &str) -> RouterAbProtocolResult<[u8; 32]> {
    let mut decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| {
            wallet_lane_config_error_v1(
                "wallet lane request signing Secret must be unpadded base64url",
            )
        })?;
    if decoded.len() != 32 {
        decoded.zeroize();
        return Err(wallet_lane_config_error_v1(
            "wallet lane request signing Secret must decode to 32 bytes",
        ));
    }
    let mut seed = [0_u8; 32];
    seed.copy_from_slice(&decoded);
    decoded.zeroize();
    Ok(seed)
}

fn map_wallet_lane_config_error_v1(error: RouterAbProtocolError) -> RouterAbProtocolError {
    wallet_lane_config_error_v1(error.message())
}

fn wallet_lane_request_error_v1(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLocalHttpRequest, message)
}

fn wallet_lane_config_error_v1(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        message,
    )
}
