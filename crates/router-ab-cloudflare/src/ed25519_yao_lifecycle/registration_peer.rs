use super::*;
use crate::registration_pair_connection::{Reply, Start};
use crate::registration_pair_preparation::RegistrationPreparation;
use std::{cell::Cell, rc::Rc};

struct PeerLease(Rc<Cell<bool>>);

impl Drop for PeerLease {
    fn drop(&mut self) {
        self.0.set(false);
    }
}

pub(crate) async fn accept_prepared_peer(
    env: Env,
    host: DeriverBExecutionHostV1,
    sql: worker::SqlStorage,
    preparation: RegistrationPreparation,
    occupied: Rc<Cell<bool>>,
) -> RouterAbProtocolResult<Response> {
    let deadline = preparation.custody_binding.expires_at_ms;
    loop {
        let stored = crate::durable_object::registration_preparation::read(&sql)
            .map_err(|_| invalid_lifecycle("Prepared pair could not be read"))?;
        if let Some(stored) = stored {
            if stored.request != preparation.request
                || stored.wallet_route != preparation.wallet_route
            {
                return Err(invalid_lifecycle(
                    "Prepared peer scope differs from this wallet",
                ));
            }
            if crate::durable_object::registration_preparation::is_admitted(&sql)
                .map_err(|_| invalid_lifecycle("Prepared peer admission could not be read"))?
            {
                break;
            }
        }
        if cloudflare_yao_now_unix_ms().map_err(|_| invalid_lifecycle("Clock is unavailable"))?
            >= deadline
        {
            return Err(invalid_lifecycle("Prepared peer admission expired"));
        }
        Delay::from(YAO_PREPARATION_POLL).await;
    }
    crate::durable_object::registration_preparation::require_unfenced(&sql, &preparation)
        .map_err(|_| invalid_lifecycle("Prepared peer is fenced"))?;
    if occupied.replace(true) {
        return Err(invalid_lifecycle("This wallet already has a prepared peer"));
    }
    let lease = PeerLease(occupied);
    let sockets = WebSocketPair::new()
        .map_err(|_| invalid_lifecycle("Prepared peer socket creation failed"))?;
    let response = Response::from_websocket(sockets.client)
        .map_err(|_| invalid_lifecycle("Prepared peer upgrade failed"))?;
    let continuation = host.clone();
    continuation.wait_until(async move {
        let _lease = lease;
        let socket = sockets.server;
        let result = run_prepared_peer(&env, &host, &sql, &preparation, &socket).await;
        let code = if result.is_err() { 1011 } else { 1000 };
        let _ = socket.close(Some(code), Some("prepared-peer-ended"));
    });
    Ok(response)
}

async fn run_prepared_peer(
    env: &Env,
    host: &DeriverBExecutionHostV1,
    sql: &worker::SqlStorage,
    preparation: &RegistrationPreparation,
    socket: &worker::WebSocket,
) -> RouterAbProtocolResult<()> {
    let mut events = socket.events().map_err(map_peer_error)?;
    socket.accept().map_err(map_peer_error)?;
    let start: Start = crate::registration_pair_connection::read_control(
        &mut events,
        preparation.custody_binding.expires_at_ms,
    )
    .await
    .map_err(map_peer_error)?;
    drop(events);
    let pair = &start.scope.scope.pair_binding;
    if pair.binding() != &preparation.request.binding
        || start.scope.scope.wallet_route != preparation.wallet_route
        || start.scope.scope.root_identity != preparation.request.tenant_root.identity
        || start.scope.scope.ownership_generation != preparation.request.ownership_generation
        || start.scope.outer_binding.pair_session().as_bytes() != &preparation.session()
    {
        return Err(invalid_lifecycle(
            "Prepared peer execution has another scope",
        ));
    }
    crate::durable_object::registration_preparation::require_unfenced(sql, preparation)
        .map_err(map_peer_error)?;
    let runtime = CloudflareDeriverBWorkerRuntimeV1::from_worker_env(env)?;
    let running = super::deriver_b_start::claim_prepared_pair(
        env,
        host,
        &start.scope,
        start.execution_id,
        None,
    )
    .await?;
    let running = match running {
        Ok(running) => running,
        Err(reason) => {
            let reply = Reply::Refused {
                refusal: CloudflareEd25519YaoPairStartRefusalV1 {
                    session: pair.session(),
                    pair_digest: pair.pair_digest().bytes,
                    execution_id: start.execution_id,
                    reason,
                },
            };
            socket
                .send_with_str(
                    &serde_json::to_string(&reply)
                        .map_err(|_| invalid_lifecycle("Peer refusal encoding failed"))?,
                )
                .map_err(map_peer_error)?;
            return Ok(());
        }
    };
    let DeriverBYaoSessionResponseV1::PairStarted {
        input,
        work,
        root_metadata_digest,
        pair_binding,
        tenant_root,
        ..
    } = running
    else {
        return Err(invalid_lifecycle("Prepared peer failed to claim"));
    };
    let scope = start.scope.scope.clone();
    let result = if pair_binding.as_ref() != pair
        || !preparation.matches_execution(&tenant_root, &pair_binding)
    {
        Err(invalid_lifecycle("Prepared peer changed scope after claim"))
    } else {
        execute_deriver_b_role(
            env,
            &runtime,
            host,
            *input,
            socket.clone(),
            None,
            root_metadata_digest,
            pair.pair_digest().bytes,
            *pair_binding,
            *tenant_root,
            work,
            Some(start),
        )
        .await
    };
    if result.is_err() {
        let _ = host
            .command(
                env,
                &scope,
                DeriverBYaoSessionCommandV1::FailPair {
                    pair_binding: Box::new(scope.pair_binding.clone()),
                },
                None,
            )
            .await;
    }
    result
}

fn map_peer_error(error: worker::Error) -> RouterAbProtocolError {
    invalid_lifecycle(format!("Prepared peer failed: {error}"))
}
