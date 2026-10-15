//! Private Worker signing. Only each role can read its material and prepared pool.
use super::super::execution::{self, Host, Request, RoleSecrets};
use super::*;
use worker::{Context, WebSocket, WebSocketPair};
use zeroize::Zeroizing;
pub(crate) const EXECUTE_PATH: &str = "/router-ab/ml-dsa/execute";
const SOCKET_PATH: &str = "/router-ab/ml-dsa/connect";
const CANDIDATES: u16 = 4;

struct WorkerHost<'a>(&'a Env);
impl Host for WorkerHost<'_> {
    fn now_ms(&self) -> Result<u64> {
        crate::cloudflare_now_unix_ms_v1()
    }
    async fn take(&self, permit: &Permit, batch: [u8; 32]) -> Result<(Binding, Sealed)> {
        let mut response = local_call(
            self.0,
            &RoleCommand::Take {
                permit: permit.clone(),
                batch,
            },
        )
        .await?;
        if response.status_code() != 200 {
            return Err(invalid("ML-DSA material consumption failed"));
        }
        response.json().await.map_err(storage_error)
    }
}

pub(super) fn holder_key(env: &Env) -> Result<(Identifier, Zeroizing<[u8; 32]>)> {
    let version = Identifier::try_from(
        env.var("DERIVER_ROLE_PRIVATE_D1_KEK_VERSION")
            .map_err(storage_error)?
            .to_string(),
    )?;
    let binding = env
        .var("DERIVER_ROLE_PRIVATE_D1_KEK_BINDING")
        .map_err(storage_error)?
        .to_string();
    let encoded = Zeroizing::new(env.secret(&binding).map_err(storage_error)?.to_string());
    let private = Zeroizing::new(
        crate::ed25519_yao_lifecycle::role_d1::decode_role_private_d1_private_key(&encoded)
            .map_err(storage_error)?,
    );
    Ok((version, private))
}
pub(super) fn wrapping_key(env: &Env) -> Result<(Identifier, Zeroizing<[u8; 32]>)> {
    let (version, private) = holder_key(env)?;
    let mut hash = Sha256::new();
    hash.update(b"seams/ml-dsa/role-wrapping-seed/v1");
    hash.update(private.as_ref());
    Ok((version, Zeroizing::new(hash.finalize().into())))
}
async fn require_permit(env: &Env, input: &Request) -> Result<()> {
    input.validate(crate::cloudflare_now_unix_ms_v1()?)?;
    let status: Option<Status> = service_call(
        env,
        CallAuthority::Internal,
        &AdmissionCommand::Lookup {
            request: input.permit.request.clone(),
        },
    )
    .await?;
    if status
        != Some(Status::Running {
            permit: input.permit.clone(),
        })
    {
        return Err(invalid("ML-DSA signing permit is absent or stale"));
    }
    Ok(())
}
async fn execute(
    env: &Env,
    input: &Request,
    socket: &WebSocket,
) -> Result<(Vec<u8>, execution::Outcome)> {
    require_permit(env, input).await?;
    let mut response = local_call(
        env,
        &RoleCommand::LoadMaterial {
            permit: input.permit.clone(),
        },
    )
    .await?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA key material is unavailable"));
    }
    let record: material::Record = response.json().await.map_err(storage_error)?;
    if record.activation.key != input.permit.request.key {
        return Err(invalid("ML-DSA role key changed"));
    }
    let role = configured_role(env).map_err(storage_error)?;
    let (version, wrapping_seed) = wrapping_key(env)?;
    let material = record.open(role, &version, &wrapping_seed)?;
    let public_key = record
        .public_key
        .as_slice()
        .try_into()
        .map_err(|_| invalid("Invalid ML-DSA public key"))?;
    let schedules = schedules::load()?;
    let mut transport =
        transport::Duplex::new(socket, input.permit.expires_at_ms).map_err(storage_error)?;
    let outcome = execution::run(
        input,
        public_key,
        RoleSecrets {
            role,
            material,
            wrapping_seed,
            wrapping_key_version: version,
        },
        CANDIDATES,
        &schedules,
        &WorkerHost(env),
        &mut transport,
    )
    .await?;
    // Both roles acknowledge the complete public result before A reports success.
    let digest = digest(b"seams/ml-dsa/execution-result/v1", &outcome)?;
    let peer = match role {
        Participant::A => {
            transport
                .send(&digest)
                .await
                .map_err(|_| invalid("ML-DSA result delivery failed"))?;
            transport
                .receive(32)
                .await
                .map_err(|_| invalid("ML-DSA result acknowledgement failed"))?
        }
        Participant::B => {
            let peer = transport
                .receive(32)
                .await
                .map_err(|_| invalid("ML-DSA result delivery failed"))?;
            transport
                .send(&digest)
                .await
                .map_err(|_| invalid("ML-DSA result acknowledgement failed"))?;
            peer
        }
    };
    if peer != digest {
        return Err(invalid("ML-DSA participants returned different results"));
    }
    Ok((record.public_key, outcome))
}

pub(crate) async fn handle_execute(
    mut request: worker::Request,
    env: Env,
    context: Context,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_internal_service_auth_request_v1(&request, &env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    let path = request.path();
    let input: Request = if path == SOCKET_PATH {
        socket_input(&request).map_err(protocol_error)?
    } else {
        if request.method() != Method::Post {
            return Response::error("ML-DSA execution requires POST", 405);
        }
        decode_bounded_json_request(&mut request, 131_072)
            .await
            .map_err(protocol_error)?
    };
    require_permit(&env, &input).await.map_err(protocol_error)?;
    match (configured_role(&env)?, path.as_str()) {
        (Participant::A, EXECUTE_PATH) => {
            let (public_key, outcome) =
                before_deadline(input.permit.expires_at_ms, execute_a(&env, &input))
                    .await
                    .map_err(protocol_error)?;
            Response::from_json(&(public_key, outcome))
        }
        (Participant::B, SOCKET_PATH) => {
            if request.headers().get("upgrade")?.as_deref() != Some("websocket") {
                return Response::error("ML-DSA execution requires a WebSocket", 400);
            }
            let pair = WebSocketPair::new()?;
            context.wait_until(async move {
                let result = before_deadline(
                    input.permit.expires_at_ms,
                    execute(&env, &input, &pair.server),
                )
                .await;
                if result.is_err() {
                    let _ = pair
                        .server
                        .close(Some(1011), Some("ML-DSA execution failed"));
                }
            });
            Response::from_websocket(pair.client)
        }
        _ => Response::error("ML-DSA execution role or route is incorrect", 404),
    }
}
pub(crate) fn is_execution_path(path: &str) -> bool {
    path == EXECUTE_PATH || path == SOCKET_PATH
}

async fn execute_a(env: &Env, input: &Request) -> Result<(Vec<u8>, execution::Outcome)> {
    let forwarded = socket_request(env, SOCKET_PATH, input)?;
    let response = env
        .service("DERIVER_B")
        .map_err(storage_error)?
        .fetch_request(forwarded)
        .await
        .map_err(storage_error)?;
    if response.status_code() != 101 {
        return Err(invalid("ML-DSA peer execution refused"));
    }
    let socket = response
        .websocket()
        .ok_or_else(|| invalid("ML-DSA peer socket is absent"))?;
    let result = execute(env, input, &socket).await;
    let _ = socket.close(
        Some(if result.is_ok() { 1000 } else { 1011 }),
        Some("ML-DSA execution ended"),
    );
    result
}
