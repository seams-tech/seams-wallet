//! Authenticated discovery of the keys used to open private ceremony inputs.
use super::*;
use curve25519_dalek::montgomery::MontgomeryPoint;

pub(crate) const PATH: &str = "/router-ab/ml-dsa/registration/recipient-keys";
pub(super) const ROLE_PATH: &str = "/router-ab/ml-dsa/registration/recipient-key";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RecipientKey {
    role: Participant,
    key_version: Identifier,
    public_key: [u8; 32],
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct DiscoveryRequest {}

pub(super) async fn handle_role(
    mut request: worker::Request,
    env: &Env,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_internal_service_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("Recipient discovery requires POST", 405);
    }
    let _: DiscoveryRequest = decode_bounded_json_request(&mut request, 1024)
        .await
        .map_err(protocol_error)?;
    let (key_version, private) = executor::holder_key(env).map_err(protocol_error)?;
    let result = RecipientKey {
        role: configured_role(env)?,
        key_version,
        public_key: MontgomeryPoint::mul_base_clamped(*private).to_bytes(),
    };
    no_store(Response::from_json(&result)?)
}

fn no_store(mut response: Response) -> worker::Result<Response> {
    response.headers_mut().set("cache-control", "no-store")?;
    Ok(response)
}

async fn discover(env: &Env, binding: &str, expected: Participant) -> Result<RecipientKey> {
    let mut response = crate::router_coordinator::post_role_request(
        env,
        binding,
        "https://ml-dsa.internal",
        ROLE_PATH,
        "ML-DSA recipient discovery",
        &DiscoveryRequest {},
        None,
    )
    .await?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA recipient discovery failed"));
    }
    let key: RecipientKey = response.json().await.map_err(storage_error)?;
    if key.role != expected || key.public_key == [0; 32] {
        return Err(invalid("ML-DSA recipient role or key is invalid"));
    }
    Ok(key)
}

pub(crate) async fn handle(mut request: worker::Request, env: &Env) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("Recipient discovery requires POST", 405);
    }
    let _: DiscoveryRequest = decode_bounded_json_request(&mut request, 1024)
        .await
        .map_err(protocol_error)?;
    let (a, b) = futures::join!(
        discover(env, "DERIVER_A", Participant::A),
        discover(env, "DERIVER_B", Participant::B)
    );
    let a = a.map_err(protocol_error)?;
    let b = b.map_err(protocol_error)?;
    if a.public_key == b.public_key {
        return Response::error("ML-DSA recipients must use separate keys", 409);
    }
    no_store(Response::from_json(&serde_json::json!({"a":a,"b":b}))?)
}
