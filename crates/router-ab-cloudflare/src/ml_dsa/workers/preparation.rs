//! Durable alarms dispatch fresh paired preparation outside signing requests.
mod producer;
use super::*;
use ed25519_yao::ml_dsa_signing::{prepared_signing::gmw::prepare_gmw_reservation, SigningRole};
pub(crate) use producer::handle_start;
pub use producer::RouterAbMlDsaProducerDurableObject;
use worker::{Context, WebSocket, WebSocketPair};
pub(crate) const START_PATH: &str = "/router-ab/ml-dsa/prepare";
pub(crate) const PREPARE_PATH: &str = "/router-ab/ml-dsa/prepare-connect";
const QUEUE: &str = "preprocessing-queue";

pub(super) fn refill_key(command: &RoleCommand) -> Option<&KeyScope> {
    match command {
        RoleCommand::Install { key } | RoleCommand::Inventory { key, .. } => Some(key),
        RoleCommand::Take { permit, .. } => Some(&permit.request.key),
        RoleCommand::Release { request, .. } => Some(&request.key),
        _ => None,
    }
}
pub(super) async fn enqueue(store: &impl Store, key: &KeyScope) -> Result<()> {
    let mut queue: Vec<KeyScope> = store.get(QUEUE).await?.unwrap_or_default();
    queue.retain(|current| current.key_id != key.key_id || current == key);
    if !queue.contains(key) {
        queue.push(key.clone());
    }
    store.put(QUEUE, &queue).await
}
pub(super) async fn check_job(env: &Env, job: &refill::Job) -> Result<()> {
    let current: bool = service_call(
        env,
        CallAuthority::Internal,
        &AdmissionCommand::CheckRefill { job: job.clone() },
    )
    .await?;
    if !current {
        return Err(invalid("ML-DSA preprocessing lease is inactive"));
    }
    Ok(())
}
pub(super) async fn alarm(env: &Env, state: &State) -> worker::Result<Response> {
    if configured_role(env)? != Participant::A {
        return Response::from_json(&false);
    }
    let queue: Vec<KeyScope> = state.storage().get(QUEUE).await?.unwrap_or_default();
    let Some(key) = queue.first().cloned() else {
        return Response::from_json(&true);
    };
    // Arm recovery before network work. A crash never loses the refill request.
    schedule_refill_alarm(state, 30_000).await?;
    let active: Option<admission::KeyActivation> = service_call(
        env,
        CallAuthority::Internal,
        &AdmissionCommand::ActiveKey { key: key.clone() },
    )
    .await
    .map_err(protocol_error)?;
    if active.map(|value| value.key).as_ref() != Some(&key) {
        remove_queued(state, &key).await?;
        schedule_refill_alarm(state, 1_000).await?;
        return Response::from_json(&false);
    }
    let now = crate::cloudflare_now_unix_ms_v1().map_err(protocol_error)?;
    let policy = policy(env).map_err(protocol_error)?;
    let command = RoleCommand::Inventory {
        key: key.clone(),
        target: policy.refill_target_batches(),
        ready_until_ms: policy.deadline(now).map_err(protocol_error)?,
    };
    let a: pool::Inventory = serde_json::from_value(
        role_transaction(
            state,
            Participant::A,
            RoleCommand::Inventory {
                key: key.clone(),
                target: policy.refill_target_batches(),
                ready_until_ms: policy.deadline(now).map_err(protocol_error)?,
            },
        )
        .await?,
    )
    .map_err(|_| protocol_error(invalid("Invalid ML-DSA local inventory")))?;
    let b: pool::Inventory = coordinator::role_call(env, "DERIVER_B", &command)
        .await
        .map_err(protocol_error)?;
    log_inventory(&key, &a, &b);
    let stock_a = a.stock_batches();
    let stock_b = b.stock_batches();
    let paired = stock_a
        .iter()
        .filter(|batch| stock_b.contains(batch))
        .count();
    if paired >= policy.refill_target_batches() {
        // Keep a durable timer so idle wallets replace expiring preparation.
        rotate_queued(state, &key).await?;
        schedule_refill_alarm(state, 30_000).await?;
        return Response::from_json(&true);
    }
    let claim: refill::Claim = service_call(
        env,
        CallAuthority::Internal,
        &AdmissionCommand::ClaimRefill { key: key.clone() },
    )
    .await
    .map_err(protocol_error)?;
    let refill::Claim::Acquired { job } = claim else {
        schedule_refill_alarm(state, 5_000).await?;
        return Response::from_json(&false);
    };
    // This alarm owns A's producer. Retire halves left by its earlier interrupted runs.
    let only_a = a
        .ready
        .iter()
        .filter(|batch| !b.ready.contains(batch))
        .copied()
        .collect();
    let only_b = b
        .ready
        .into_iter()
        .filter(|batch| !a.ready.contains(batch))
        .collect();
    let result = before_deadline(
        job.expires_at_ms,
        reconcile_and_produce(env, state, &job, only_a, only_b),
    )
    .await;
    // A lost queue reply can still mean the job started. Keep its lease until
    // the independent producer finishes or the existing deadline expires.
    schedule_refill_alarm(state, if result.is_ok() { 1_000 } else { 5_000 }).await?;
    result.map_err(protocol_error)?;
    Response::from_json(&true)
}
async fn remove_queued(state: &State, key: &KeyScope) -> worker::Result<()> {
    let key = key.clone();
    state
        .storage()
        .transaction(move |transaction| async move {
            let store = TransactionStore(transaction);
            let mut queue: Vec<KeyScope> = store
                .get(QUEUE)
                .await
                .map_err(protocol_error)?
                .unwrap_or_default();
            queue.retain(|current| current != &key);
            store.put(QUEUE, &queue).await.map_err(protocol_error)
        })
        .await
}
async fn rotate_queued(state: &State, key: &KeyScope) -> worker::Result<()> {
    let key = key.clone();
    state
        .storage()
        .transaction(move |transaction| async move {
            let store = TransactionStore(transaction);
            let mut queue: Vec<KeyScope> = store
                .get(QUEUE)
                .await
                .map_err(protocol_error)?
                .unwrap_or_default();
            if let Some(index) = queue.iter().position(|current| current == &key) {
                let current = queue.remove(index);
                queue.push(current);
                store.put(QUEUE, &queue).await.map_err(protocol_error)?;
            }
            Ok(())
        })
        .await
}
async fn prepare(
    env: &Env,
    job: &refill::Job,
    transport: &mut transport::Duplex<'_>,
) -> Result<(Binding, Sealed)> {
    let participant = configured_role(env).map_err(storage_error)?;
    let role = match participant {
        Participant::A => SigningRole::A,
        Participant::B => SigningRole::B,
    };
    let schedules = schedules::load()?;
    if execution::schedule_digest(&schedules) != job.key.schedule_digest {
        return Err(invalid("ML-DSA preprocessing schedule changed"));
    }
    let prepared = prepare_gmw_reservation(
        role,
        job.batch,
        executor::CANDIDATES,
        &schedules,
        &mut Default::default(),
        transport,
    )
    .await
    .map_err(|_| invalid("ML-DSA preprocessing protocol failed"))?;
    check_job(env, job).await?;
    let (version, seed) = executor::wrapping_key(env)?;
    let binding = Binding {
        key: job.key.clone(),
        role: participant,
        batch: job.batch,
        expires_at_ms: job.material_expires_at_ms,
        wrapping_key_version: version,
    };
    let sealed = sealing::seal(prepared.into_storage(), &binding, &seed)?;
    Ok((binding, sealed))
}
async fn produce_a(env: &Env, job: &refill::Job) -> Result<()> {
    check_job(env, job).await?;
    let response = local_call(env, &RoleCommand::StartRefill { job: job.clone() }).await?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA preparation was already claimed"));
    }
    let request = socket_request(env, PREPARE_PATH, job)?;
    let response = env
        .service("DERIVER_B")
        .map_err(storage_error)?
        .fetch_request(request)
        .await
        .map_err(storage_error)?;
    if response.status_code() != 101 {
        return Err(invalid("ML-DSA peer preparation refused"));
    }
    let socket = response
        .websocket()
        .ok_or_else(|| invalid("ML-DSA preparation socket is absent"))?;
    let result = produce_a_connected(env, job, &socket).await;
    let _ = socket.close(
        Some(if result.is_ok() { 1000 } else { 1011 }),
        Some("ML-DSA preparation ended"),
    );
    result
}
async fn produce_a_connected(env: &Env, job: &refill::Job, socket: &WebSocket) -> Result<()> {
    let mut transport =
        transport::Duplex::for_preparation(socket, job.expires_at_ms).map_err(storage_error)?;
    let (binding, sealed) = prepare(env, job, &mut transport).await?;
    if transport
        .receive(1)
        .await
        .map_err(|_| invalid("ML-DSA peer preparation was not stored"))?
        != [1]
    {
        return Err(invalid("Invalid ML-DSA preparation acknowledgement"));
    }
    check_job(env, job).await?;
    let response = local_call(
        env,
        &RoleCommand::Put {
            job: job.clone(),
            binding,
            sealed,
        },
    )
    .await?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA preparation storage failed"));
    }
    transport
        .send(&[2])
        .await
        .map_err(|_| invalid("ML-DSA paired preparation acknowledgement failed"))?;
    transport
        .flush()
        .await
        .map_err(|_| invalid("ML-DSA preparation delivery was not acknowledged"))?;
    transport
        .peer_closed()
        .await
        .map_err(|_| invalid("ML-DSA preparation peer did not close normally"))?;
    Ok(())
}
pub(crate) async fn handle_prepare(
    request: worker::Request,
    env: Env,
    context: Context,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_internal_service_auth_request_v1(&request, &env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if configured_role(&env)? != Participant::B {
        return Response::error("ML-DSA preparation requires participant B", 400);
    }
    let job: refill::Job = socket_input(&request).map_err(protocol_error)?;
    check_job(&env, &job).await.map_err(protocol_error)?;
    let response = local_call(&env, &RoleCommand::StartRefill { job: job.clone() })
        .await
        .map_err(protocol_error)?;
    if response.status_code() != 200 {
        return Response::error("ML-DSA preparation was already claimed", 409);
    }
    let pair = WebSocketPair::new()?;
    context.wait_until(async move {
        let result = before_deadline(job.expires_at_ms, produce_b(&env, &job, &pair.server)).await;
        let code = if result.is_ok() { 1000 } else { 1011 };
        let closed = pair
            .server
            .close(Some(code), Some("ML-DSA preparation ended"));
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "ml_dsa_socket_completion_v1",
                "kind": "preparation",
                "id": hex(&job.batch),
                "protocol_completed": result.is_ok(),
                "close_code": code,
                "close_requested": closed.is_ok(),
            })
        );
    });
    Response::from_websocket(pair.client)
}
async fn produce_b(env: &Env, job: &refill::Job, socket: &WebSocket) -> Result<()> {
    let mut transport =
        transport::Duplex::for_preparation(socket, job.expires_at_ms).map_err(storage_error)?;
    let (binding, sealed) = prepare(env, job, &mut transport).await?;
    let response = local_call(
        env,
        &RoleCommand::Put {
            job: job.clone(),
            binding,
            sealed,
        },
    )
    .await?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA peer preparation storage failed"));
    }
    transport
        .send(&[1])
        .await
        .map_err(|_| invalid("ML-DSA preparation acknowledgement failed"))?;
    if transport
        .receive(1)
        .await
        .map_err(|_| invalid("ML-DSA paired preparation was not stored"))?
        != [2]
    {
        return Err(invalid("Invalid ML-DSA paired preparation acknowledgement"));
    }
    transport
        .flush()
        .await
        .map_err(|_| invalid("ML-DSA final preparation acknowledgement failed"))?;
    Ok(())
}

async fn reconcile_and_produce(
    env: &Env,
    state: &State,
    job: &refill::Job,
    only_a: Vec<[u8; 32]>,
    only_b: Vec<[u8; 32]>,
) -> Result<()> {
    // Inspect B directly, then retire A locally. Calling this actor through its own
    // service binding would add a recursive Durable Object request.
    if !only_a.is_empty() {
        let states: Vec<pool::BatchAvailability> = coordinator::role_call(
            env,
            "DERIVER_B",
            &RoleCommand::Inspect {
                key: job.key.clone(),
                batches: only_a.clone(),
            },
        )
        .await?;
        if states.len() != only_a.len() {
            return Err(invalid("Invalid peer inventory"));
        }
        let mut retired = Vec::new();
        for (id, state) in only_a.into_iter().zip(states) {
            if matches!(
                state,
                pool::BatchAvailability::Missing | pool::BatchAvailability::Retired
            ) {
                retired.push(id);
            }
        }
        role_transaction(
            state,
            Participant::A,
            RoleCommand::RetireUnpaired {
                key: job.key.clone(),
                batches: retired,
            },
        )
        .await
        .map_err(storage_error)?;
    }
    if !only_b.is_empty() {
        // A has no active producer. Missing local records cannot become publishable.
        let states: Vec<pool::BatchAvailability> = serde_json::from_value(
            role_transaction(
                state,
                Participant::A,
                RoleCommand::Inspect {
                    key: job.key.clone(),
                    batches: only_b.clone(),
                },
            )
            .await
            .map_err(storage_error)?,
        )
        .map_err(|_| invalid("Invalid local inventory"))?;
        let mut retired = Vec::new();
        for (id, availability) in only_b.into_iter().zip(states) {
            if matches!(
                availability,
                pool::BatchAvailability::Missing | pool::BatchAvailability::Retired
            ) {
                retired.push(id);
            }
        }
        let _: bool = coordinator::role_call(
            env,
            "DERIVER_B",
            &RoleCommand::RetireUnpaired {
                key: job.key.clone(),
                batches: retired,
            },
        )
        .await?;
    }
    let request = object_request(env, CallAuthority::Internal, START_PATH, job)?;
    let mut response = env
        .service("ML_DSA_PREPARER")
        .map_err(storage_error)?
        .fetch_request(request)
        .await
        .map_err(storage_error)?;
    if response.status_code() != 202 {
        return Err(invalid(
            "ML-DSA dedicated preparation queue refused the job",
        ));
    }
    if !response.json::<bool>().await.map_err(storage_error)? {
        return Err(invalid("ML-DSA producer queue was not acknowledged"));
    }
    Ok(())
}

/// Public stock identities let throughput evidence account for initial and final reserves.
pub(super) fn log_inventory(key: &KeyScope, a: &pool::Inventory, b: &pool::Inventory) {
    worker::console_log!(
        "{}",
        serde_json::json!({
            "event": "ml_dsa_inventory_v1",
            "key": hex(&key.public_key_digest),
            "epoch": key.epoch,
            "ready_a": a.ready.iter().map(|id| hex(id)).collect::<Vec<_>>(),
            "ready_b": b.ready.iter().map(|id| hex(id)).collect::<Vec<_>>(),
            "reserved_a": a.reserved.iter().map(|id| hex(id)).collect::<Vec<_>>(),
            "reserved_b": b.reserved.iter().map(|id| hex(id)).collect::<Vec<_>>(),
        })
    );
}
