//! Private Worker signing. Only each role can read its material and prepared pool.
use super::super::execution::{self, Host, Request, RoleSecrets};
use super::super::failure::SigningFailure;
use super::*;
type SigningResult<T> = core::result::Result<T, SigningFailure>;
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

impl Host for WorkerHost<'_> {
    fn now_ms(&self) -> Result<u64> {
        crate::cloudflare_now_unix_ms_v1()
    }
    fn note_stage(&self, stage: execution::ExecutionStage) {
        self.trace.batch(stage);
    }
    fn public_topologies(
        &self,
    ) -> ml_dsa_threshold::runtime::boolean_mpc::prepared::PublicTopologies {
        schedules::public_topologies()
    }
    fn retain_public_topologies(
        &self,
        topologies: &ml_dsa_threshold::runtime::boolean_mpc::prepared::PublicTopologies,
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
        let result = material_delivery::take(&mut response).await?;
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
) -> SigningResult<(Vec<u8>, execution::Outcome)> {
    let role = configured_role(env).map_err(|_| SigningFailure::ConfigurationInvalid)?;
    let mut trace = signing_trace::SigningTrace::new(input.permit.request.operation, role);
    // Both entrypoints authenticated the permit before opening this socket.
    // Accept before fallible initialization so failures can close the peer.
    let mut transport = transport::Duplex::new(socket, input.permit.expires_at_ms)
        .map_err(|_| SigningFailure::TransportInterrupted)?;
    require_permit(env, input)
        .await
        .map_err(|_| SigningFailure::AdmissionRejected)?;
    trace.mark("permit_checked");
    let mut response = local_call(
        env,
        &RoleCommand::LoadSigningInputs {
            permit: input.permit.clone(),
        },
        None,
    )
    .await
    .map_err(|_| SigningFailure::MaterialUnavailable)?;
    if response.status_code() != 200 {
        return Err(SigningFailure::MaterialUnavailable);
    }
    let inputs = material_delivery::signing_inputs(&mut response)
        .await
        .map_err(|_| SigningFailure::InvalidMaterial)?;
    let record = inputs.metadata.material;
    trace.mark("material_loaded");
    if record.activation.key != input.permit.request.key {
        return Err(SigningFailure::KeyChanged);
    }
    let (version, wrapping_seed) =
        wrapping_key(env).map_err(|_| SigningFailure::ConfigurationInvalid)?;
    let material = record
        .open(role, &version, &wrapping_seed)
        .map_err(|_| SigningFailure::InvalidMaterial)?;
    trace.mark("material_opened");
    let public_key = record
        .public_key
        .as_slice()
        .try_into()
        .map_err(|_| SigningFailure::InvalidMaterial)?;
    let schedules = schedules::load().map_err(|_| SigningFailure::ConfigurationInvalid)?;
    trace.mark("schedules_loaded");
    let outcome = execution::run(
        input,
        public_key,
        RoleSecrets {
            role,
            material,
            wrapping_seed,
            wrapping_key_version: version,
        },
        policy(env)
            .map_err(|_| SigningFailure::ConfigurationInvalid)?
            .candidate_group_size(),
        &schedules,
        &WorkerHost {
            env,
            trace: &trace,
            first_pair: RefCell::new(Some((
                inputs.metadata.batch,
                inputs.metadata.binding,
                inputs.sealed,
            ))),
        },
        &mut transport,
    )
    .await;
    trace.transport(transport.metrics());
    let outcome = outcome.map_err(|_| transport.failure(SigningFailure::ProtocolFailed))?;
    trace.mark("protocol_completed");
    // Both roles acknowledge the complete public result before A reports success.
    let digest = digest(b"seams/ml-dsa/execution-result/v1", &outcome)
        .map_err(|_| SigningFailure::ProtocolFailed)?;
    let peer = match role {
        Participant::A => {
            transport
                .send(&digest)
                .await
                .map_err(|_| transport.failure(SigningFailure::TransportInterrupted))?;
            transport
                .receive(32)
                .await
                .map_err(|_| transport.failure(SigningFailure::TransportInterrupted))?
        }
        Participant::B => {
            let peer = transport
                .receive(32)
                .await
                .map_err(|_| transport.failure(SigningFailure::TransportInterrupted))?;
            transport
                .send(&digest)
                .await
                .map_err(|_| transport.failure(SigningFailure::TransportInterrupted))?;
            peer
        }
    };
    if peer != digest {
        return Err(SigningFailure::InvalidParticipantResponse);
    }
    if role == Participant::B {
        transport
            .flush()
            .await
            .map_err(|_| transport.failure(SigningFailure::TransportInterrupted))?;
    } else {
        let was_clean = transport
            .peer_closed()
            .await
            .map_err(|_| transport.failure(SigningFailure::TransportInterrupted))?;
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
    match (configured_role(&env)?, path.as_str()) {
        (Participant::A, EXECUTE_PATH) => {
            match before_deadline(input.permit.expires_at_ms, execute_a(&env, &input)).await {
                Ok(result) => Response::from_json(&result),
                Err(failure) => Ok(Response::from_json(&failure)?.with_status(503)),
            }
        }
        (Participant::B, SOCKET_PATH) => {
            require_permit(&env, &input).await.map_err(protocol_error)?;
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
                let reason = signing_close_reason(&result);
                let closed = pair.server.close(Some(code), Some(&reason));
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

async fn execute_a(env: &Env, input: &Request) -> SigningResult<(Vec<u8>, execution::Outcome)> {
    require_permit(env, input)
        .await
        .map_err(|_| SigningFailure::AdmissionRejected)?;
    let forwarded = socket_request(env, SOCKET_PATH, input)
        .map_err(|_| SigningFailure::ConfigurationInvalid)?;
    let response = env
        .service("DERIVER_B")
        .map_err(|_| SigningFailure::TransportInterrupted)?
        .fetch_request(forwarded)
        .await
        .map_err(|_| SigningFailure::TransportInterrupted)?;
    if response.status_code() != 101 {
        return Err(SigningFailure::from_http_status(response.status_code()));
    }
    let socket = response
        .websocket()
        .ok_or(SigningFailure::InvalidParticipantResponse)?;
    let result = execute(env, input, &socket).await;
    let reason = signing_close_reason(&result);
    let _ = socket.close(
        Some(if result.is_ok() { 1000 } else { 1011 }),
        Some(&reason),
    );
    result
}

fn signing_close_reason<T>(result: &SigningResult<T>) -> String {
    match result {
        Ok(_) => "ML-DSA execution ended".into(),
        Err(failure) => {
            serde_json::to_string(failure).unwrap_or_else(|_| "ML-DSA execution failed".into())
        }
    }
}
