//! Atomic pair admission and its authenticated WebSocket upgrade.
use super::*;

impl DeriverBYaoSessionD1V1 {
    pub(super) async fn handle_begin_pair(
        &self,
        session: [u8; 32],
        pair_digest: [u8; 32],
        execution_id: Ed25519YaoExecutionIdV1,
        outer_binding: Ed25519YaoOuterBindingV2,
    ) -> worker::Result<Response> {
        let now_unix_ms = cloudflare_yao_now_unix_ms()?;
        let storage = self.storage(session)?;
        storage
            .transaction(move |transaction| async move {
                let record = match transaction
                    .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
                    .await
                {
                    Ok(record) => record,
                    Err(worker::Error::JsError(message))
                        if message == "No such value in storage." =>
                    {
                        return Response::from_json(&DeriverBYaoSessionResponseV1::PairMissing {
                            session,
                            pair_digest,
                        });
                    }
                    Err(error) => return Err(error),
                };
                if record.pair_digest() != pair_digest {
                    return Response::error("Deriver B pair identity mismatch", 409);
                }
                let (
                    input_digest,
                    root_metadata_digest,
                    expires_at_ms,
                    pair_binding,
                    tenant_root,
                    input,
                    work,
                ) = match record {
                    PairYaoSessionRecordV1::Prepared {
                        input_digest,
                        root_metadata_digest,
                        expires_at_ms,
                        pair_binding,
                        tenant_root,
                        input,
                        work,
                        ..
                    } => (
                        input_digest,
                        root_metadata_digest,
                        expires_at_ms,
                        pair_binding,
                        tenant_root,
                        input,
                        work,
                    ),
                    PairYaoSessionRecordV1::Running { .. } => {
                        return Response::from_json(&DeriverBYaoSessionResponseV1::PairRunning {
                            session,
                            pair_digest,
                        })
                    }
                    PairYaoSessionRecordV1::Completed { .. } => {
                        return Response::from_json(&DeriverBYaoSessionResponseV1::PairCompleted {
                            session,
                            pair_digest,
                        })
                    }
                    PairYaoSessionRecordV1::Burned { .. } => {
                        return Response::from_json(&DeriverBYaoSessionResponseV1::PairBurned {
                            session,
                            pair_digest,
                        })
                    }
                    PairYaoSessionRecordV1::Expired { .. } => {
                        return Response::from_json(&DeriverBYaoSessionResponseV1::PairExpired {
                            session,
                            pair_digest,
                        })
                    }
                };
                if input.session() != session {
                    return Response::error("Deriver B pair identity mismatch", 409);
                }
                // Another Router run prepared this pair. Its tenant-root window
                // differs from Deriver A's, so the two roles could not agree
                // on the target proof: this run's preparation has not arrived.
                if tenant_root.outer_binding != outer_binding {
                    return Response::from_json(&DeriverBYaoSessionResponseV1::PairMissing {
                        session,
                        pair_digest,
                    });
                }
                if now_unix_ms >= expires_at_ms {
                    transaction
                        .put(
                            PAIR_SESSION_RECORD_STORAGE_KEY,
                            PairYaoSessionRecordV1::Expired {
                                pair_digest,
                                input_digest,
                            },
                        )
                        .await?;
                    return Response::from_json(&DeriverBYaoSessionResponseV1::PairExpired {
                        session,
                        pair_digest,
                    });
                }
                transaction
                    .put(
                        PAIR_SESSION_RECORD_STORAGE_KEY,
                        PairYaoSessionRecordV1::Running {
                            pair_digest,
                            input_digest,
                            root_metadata_digest,
                            execution_id: execution_id.into_bytes(),
                            started_at_ms: now_unix_ms,
                            pair_binding: pair_binding.clone(),
                            tenant_root: tenant_root.clone(),
                            input: input.clone(),
                            work: work.clone(),
                        },
                    )
                    .await?;
                Response::from_json(&DeriverBYaoSessionResponseV1::PairStarted {
                    session,
                    pair_digest,
                    execution_id,
                    input,
                    work,
                    root_metadata_digest,
                    pair_binding,
                    tenant_root,
                })
            })
            .await
    }
}

/// Claims Deriver B's pair for one connection from Deriver A.
///
/// The Router sends B its preparation and A its execution at the same time,
/// so the connection can arrive first. B then waits for its own preparation
/// of the same run, until the run ends or that preparation fails here. The
/// answer is the started pair, or why B refuses while holding no claim.
async fn claim_prepared_pair(
    env: &Env,
    execution_host: &DeriverBExecutionHostV1,
    start: &CloudflareDeriverBPairStartScopeV1,
    execution_id: Ed25519YaoExecutionIdV1,
    trace_id: RoleTraceContextV1,
) -> RouterAbProtocolResult<
    Result<DeriverBYaoSessionResponseV1, CloudflareEd25519YaoPairStartRefusalReasonV1>,
> {
    let scope = &start.scope;
    let session = scope.pair_binding.session();
    let wait_started_at_ms = role_span_started_at_ms();
    let ceremony_ms = u64::try_from(YAO_CEREMONY_TIMEOUT.as_millis()).unwrap_or(u64::MAX);
    let wait_until_ms = start
        .deadline_ms
        .min(wait_started_at_ms.saturating_add(ceremony_ms));
    // The revision of the pair record the last claim found unprepared. The
    // claim is tried again only once the record changes.
    let mut unprepared_revision = None;
    let emit_wait = |outcome: &'static str| {
        emit_role_span_v1(
            trace_id,
            "deriver_b.await_preparation",
            "deriver_b",
            "yao",
            wait_started_at_ms,
            outcome,
        );
    };
    loop {
        let revision = execution_host.pair_revision(scope)?;
        if unprepared_revision != Some(revision) {
            let response = execution_host
                .command(
                    env,
                    scope,
                    DeriverBYaoSessionCommandV1::BeginPair {
                        session,
                        pair_digest: scope.pair_binding.pair_digest().bytes,
                        execution_id,
                        outer_binding: Box::new(start.outer_binding.clone()),
                    },
                    trace_id,
                )
                .await?;
            match response {
                DeriverBYaoSessionResponseV1::PairStarted { .. } => {
                    if unprepared_revision.is_some() {
                        emit_wait("success");
                    }
                    return Ok(Ok(response));
                }
                DeriverBYaoSessionResponseV1::PairMissing { .. } => {
                    unprepared_revision = Some(revision);
                }
                DeriverBYaoSessionResponseV1::PairExpired { .. } => {
                    return Ok(Err(CloudflareEd25519YaoPairStartRefusalReasonV1::Expired));
                }
                // Running, completed or burned: this role claimed the pair
                // before, so it does not say that it holds no claim.
                _ => {
                    return Err(invalid_lifecycle(
                        "Deriver B pair did not enter its running state",
                    ));
                }
            }
        }
        let now_ms = cloudflare_yao_now_unix_ms()
            .map_err(|_| invalid_lifecycle("Yao clock is unavailable"))?;
        if now_ms >= wait_until_ms
            || execution_host.preparation_failed(session, &start.outer_binding)
        {
            emit_wait("failure");
            return Ok(Err(
                CloudflareEd25519YaoPairStartRefusalReasonV1::NotPrepared,
            ));
        }
        Delay::from(YAO_PREPARATION_POLL).await;
    }
}

pub(super) async fn handle_pair_bound_deriver_b_websocket(
    request: Request,
    env: Env,
    runtime: CloudflareDeriverBWorkerRuntimeV1,
    execution_host: DeriverBExecutionHostV1,
    trace_id: RoleTraceContextV1,
    protocol: String,
    binding: CloudflareEd25519YaoWebSocketBindingV1,
) -> RouterAbProtocolResult<Response> {
    let serialized_execution_id = request
        .headers()
        .get(EXECUTION_ID_HEADER)
        .map_err(|_| invalid_lifecycle("execution id header could not be read"))?
        .ok_or_else(|| invalid_lifecycle("pair-bound WebSocket execution id is missing"))?;
    let execution_id = Ed25519YaoExecutionIdV1::new(decode_hex_32(&serialized_execution_id)?)?;
    let start = deriver_b_pair_start_scope(&request)?;
    let scope = &start.scope;
    if scope.pair_binding.session() != binding.session
        || scope.pair_binding.pair_digest().bytes != binding.pair_digest
    {
        return Err(invalid_lifecycle(
            "pair-bound WebSocket scope differs from binding",
        ));
    }
    let begin_started_at_ms = role_span_started_at_ms();
    let claimed = claim_prepared_pair(&env, &execution_host, &start, execution_id, trace_id).await?;
    let running = match claimed {
        Ok(running) => running,
        Err(reason) => {
            emit_role_span_v1(
                trace_id,
                "deriver_b.begin_pair",
                "deriver_b",
                "yao",
                begin_started_at_ms,
                "failure",
            );
            // Deriver B holds no claim for this execution. Saying so lets
            // Deriver A release its reservation instead of burning it.
            return Response::from_json(&CloudflareEd25519YaoPairStartRefusalV1 {
                session: binding.session,
                pair_digest: binding.pair_digest,
                execution_id,
                reason,
            })
            .map(|response| response.with_status(PAIR_START_REFUSAL_STATUS))
            .map_err(|_| invalid_lifecycle("pair start refusal could not be encoded"));
        }
    };
    emit_role_span_v1(
        trace_id,
        "deriver_b.begin_pair",
        "deriver_b",
        "yao",
        begin_started_at_ms,
        "success",
    );
    let upgrade_started_at_ms = role_span_started_at_ms();
    let DeriverBYaoSessionResponseV1::PairStarted {
        input,
        work,
        root_metadata_digest,
        pair_binding,
        tenant_root,
        ..
    } = running
    else {
        return Err(invalid_lifecycle(
            "Deriver B pair did not enter its running state",
        ));
    };
    if pair_binding.as_ref() != &scope.pair_binding || tenant_root.identity != scope.root_identity {
        return Err(invalid_lifecycle(
            "Deriver B prepared scope changed after claim",
        ));
    }
    if circuit_for_input(&input) != binding.circuit {
        return Err(invalid_lifecycle(
            "Deriver B prepared circuit does not match WebSocket binding",
        ));
    }
    let headers = worker::Headers::new();
    headers
        .set("Sec-WebSocket-Protocol", &protocol)
        .map_err(|_| invalid_lifecycle("WebSocket response protocol could not be set"))?;
    let pair = WebSocketPair::new()
        .map_err(|_| invalid_lifecycle("Deriver B WebSocket pair could not be created"))?;
    let response = Response::from_websocket(pair.client)
        .map(|response| response.with_headers(headers))
        .map_err(|_| invalid_lifecycle("WebSocket upgrade response could not be created"))?;
    let server = pair.server;
    let server_for_error = server.clone();
    let pair_digest = binding.pair_digest;
    let continuation_host = execution_host.clone();
    continuation_host.wait_until(async move {
        let role_started_at_ms = role_span_started_at_ms();
        let running_scope = CloudflareDeriverBWalletPairScopeV1 {
            wallet_route: tenant_root.wallet_route,
            ownership_generation: tenant_root.ownership_generation,
            root_identity: tenant_root.identity.clone(),
            pair_binding: (*pair_binding).clone(),
        };
        let result = execute_deriver_b_role(
            &env,
            &runtime,
            &execution_host,
            *input,
            server,
            trace_id,
            root_metadata_digest,
            pair_digest,
            *pair_binding,
            *tenant_root,
            work,
        )
        .await;
        match &result {
            Ok(_) => emit_role_span_v1(
                trace_id,
                "deriver_b.role_execution",
                "deriver_b",
                "yao",
                role_started_at_ms,
                "success",
            ),
            Err(error) => emit_role_span_error_v1(
                trace_id,
                "deriver_b.role_execution",
                "deriver_b",
                "yao",
                role_started_at_ms,
                error,
            ),
        }
        if result.is_err() {
            let _ignored = execution_host
                .command(
                    &env,
                    &running_scope,
                    DeriverBYaoSessionCommandV1::FailPair {
                        pair_binding: Box::new(running_scope.pair_binding.clone()),
                    },
                    trace_id,
                )
                .await;
            let _ignored = server_for_error.close(Some(1011), Some("yao-pair-lifecycle-failed"));
        }
    });
    emit_role_span_v1(
        trace_id,
        "deriver_b.upgrade_response",
        "deriver_b",
        "yao",
        upgrade_started_at_ms,
        "success",
    );
    Ok(response)
}
