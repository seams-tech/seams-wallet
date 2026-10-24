//! Private Worker signing. Only each role can read its material and prepared pool.
use super::super::execution::{self, Host, Request, RoleSecrets};
use super::*;
use std::cell::RefCell;
use worker::{Context, WebSocket, WebSocketPair};
use zeroize::Zeroizing;
pub(crate) const EXECUTE_PATH: &str = "/router-ab/ml-dsa/execute";
const SOCKET_PATH: &str = "/router-ab/ml-dsa/connect";

struct WorkerHost<'a> {
    env: &'a Env,
    trace: &'a signing_trace::SigningTrace,
    first_pair: RefCell<Option<([u8; 32], Binding, Sealed)>>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SigningInputs {
    pub material: material::Record,
    pub batch: [u8; 32],
    pub binding: Binding,
    pub sealed: Sealed,
}
impl Host for WorkerHost<'_> {
    fn now_ms(&self) -> Result<u64> {
        crate::cloudflare_now_unix_ms_v1()
    }
    fn note_stage(&self, stage: execution::ExecutionStage) {
        self.trace.batch(stage);
    }
    fn public_topologies(
        &self,
    ) -> ed25519_yao::ml_dsa_runtime::boolean_comparison::prepared::PublicTopologies {
        schedules::public_topologies()
    }
    fn retain_public_topologies(
        &self,
        topologies: &ed25519_yao::ml_dsa_runtime::boolean_comparison::prepared::PublicTopologies,
    ) {
        schedules::retain_public_topologies(topologies);
    }
    async fn take(&self, permit: &Permit, batch: [u8; 32]) -> Result<(Binding, Sealed)> {
        if let Some((expected, binding, sealed)) = self.first_pair.borrow_mut().take() {
            if expected != batch {
                return Err(invalid("ML-DSA first prepared pair changed"));
            }
            return Ok((binding, sealed));
        }
        let trace = stage_trace::StageTrace::new(
            permit.request.operation,
            configured_role(self.env).map_err(storage_error)?,
            stage_trace::Context::TakeCaller { material: batch },
        );
        let mut response = local_call(
            self.env,
            &RoleCommand::Take {
                permit: permit.clone(),
                batch,
            },
            None,
        )
        .await?;
        trace.mark("response_headers");
        if response.status_code() != 200 {
            return Err(invalid("ML-DSA material consumption failed"));
        }
        let result = response.json().await.map_err(storage_error)?;
        trace.finish();
        Ok(result)
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
    check_signing_scope(env, &input.permit.request.key)?;
    if input.permit.batches.len() > policy(env)?.refill_target_batches() {
        return Err(invalid(
            "ML-DSA permit exceeds configured candidate capacity",
        ));
    }
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
    let role = configured_role(env).map_err(storage_error)?;
    let mut trace = signing_trace::SigningTrace::new(input.permit.request.operation, role);
    require_permit(env, input).await?;
    trace.mark("permit_checked");
    let mut response = local_call(
        env,
        &RoleCommand::LoadSigningInputs {
            permit: input.permit.clone(),
        },
        None,
    )
    .await?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA key material is unavailable"));
    }
    let inputs: SigningInputs = response.json().await.map_err(storage_error)?;
    let record = inputs.material;
    trace.mark("material_loaded");
    if record.activation.key != input.permit.request.key {
        return Err(invalid("ML-DSA role key changed"));
    }
    let (version, wrapping_seed) = wrapping_key(env)?;
    let material = record.open(role, &version, &wrapping_seed)?;
    trace.mark("material_opened");
    let public_key = record
        .public_key
        .as_slice()
        .try_into()
        .map_err(|_| invalid("Invalid ML-DSA public key"))?;
    let schedules = schedules::load()?;
    trace.mark("schedules_loaded");
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
        policy(env)?.candidate_group_size(),
        &schedules,
        &WorkerHost {
            env,
            trace: &trace,
            first_pair: RefCell::new(Some((inputs.batch, inputs.binding, inputs.sealed))),
        },
        &mut transport,
    )
    .await;
    trace.transport(transport.metrics());
    let outcome = outcome?;
    trace.mark("protocol_completed");
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
    if role == Participant::B {
        transport
            .flush()
            .await
            .map_err(|_| invalid("ML-DSA final delivery acknowledgement failed"))?;
    } else {
        let was_clean = transport
            .peer_closed()
            .await
            .map_err(|_| invalid("ML-DSA peer did not close normally"))?;
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_peer_close_v1",
                "operation": hex(&input.permit.request.operation),
                "close_code": 1000,
                "was_clean": was_clean,
            })
        );
    }
    trace.finish(transport.metrics());
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
                let code = if result.is_ok() { 1000 } else { 1011 };
                let closed = pair
                    .server
                    .close(Some(code), Some("ML-DSA execution ended"));
                worker::console_log!(
                    "{}",
                    serde_json::json!({
                        "event": "ml_dsa_socket_completion_v1",
                        "kind": "signing",
                        "id": hex(&input.permit.request.operation),
                        "protocol_completed": result.is_ok(),
                        "close_code": code,
                        "close_requested": closed.is_ok(),
                    })
                );
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
