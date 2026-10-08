//! Atomic pair admission and its authenticated WebSocket upgrade.
use super::*;

impl DeriverBYaoSessionD1V1 {
    pub(super) async fn handle_begin_pair(
        &self,
        session: [u8; 32],
        pair_digest: [u8; 32],
        execution_id: Ed25519YaoExecutionIdV1,
        peer_receipt: Ed25519YaoRoleReadinessReceiptV1,
    ) -> worker::Result<Response> {
        let runtime = CloudflareDeriverBWorkerRuntimeV1::from_worker_env(&self.env)
            .map_err(|error| worker::Error::RustError(error.message().to_owned()))?;
        let now_unix_ms = cloudflare_yao_now_unix_ms()?;
        validate_cloudflare_role_readiness_receipt_v1(&peer_receipt, now_unix_ms)
            .map_err(|error| worker::Error::RustError(error.message().to_owned()))?;
        verify_role_readiness_receipt_v1(&peer_receipt, runtime.peer_verifying_keys())
            .map_err(|error| worker::Error::RustError(error.message().to_owned()))?;
        if peer_receipt.role() != Ed25519YaoDeriverRoleV1::DeriverA
            || peer_receipt.pair_digest().bytes != pair_digest
            || peer_receipt.session_bytes() != session
        {
            return Response::error("Deriver A readiness receipt does not match pair", 409);
        }
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
                let PairYaoSessionRecordV1::Prepared {
                    pair_digest: stored_pair,
                    input_digest,
                    root_metadata_digest,
                    expires_at_ms,
                    pair_binding,
                    tenant_root,
                    input,
                    work,
                    receipt,
                } = record
                else {
                    return Response::error("Deriver B pair is not prepared", 409);
                };
                if stored_pair != pair_digest || input.session() != session {
                    return Response::error("Deriver B pair identity mismatch", 409);
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
                    return Response::error("Deriver B pair preparation expired", 409);
                }
                validate_cloudflare_role_readiness_receipt_v1(&receipt, now_unix_ms)
                    .map_err(|error| worker::Error::RustError(error.message().to_owned()))?;
                verify_role_readiness_receipt_v1(&receipt, runtime.peer_verifying_keys())
                    .map_err(|error| worker::Error::RustError(error.message().to_owned()))?;
                if receipt.role() != Ed25519YaoDeriverRoleV1::DeriverB
                    || receipt.pair_digest().bytes != pair_digest
                    || receipt.session_bytes() != session
                    || receipt.root_metadata_digest().bytes != root_metadata_digest
                {
                    return Response::error(
                        "Deriver B readiness root does not match prepared state",
                        409,
                    );
                }
                let started_at_ms = now_unix_ms;
                let response_input = input.clone();
                let response_work = work.clone();
                let response_receipt = receipt.clone();
                let response_tenant_root = tenant_root.clone();
                let running_record = PairYaoSessionRecordV1::Running {
                    pair_digest,
                    input_digest,
                    root_metadata_digest,
                    execution_id: execution_id.into_bytes(),
                    started_at_ms,
                    pair_binding: pair_binding.clone(),
                    tenant_root,
                    input,
                    work,
                };
                transaction
                    .put(PAIR_SESSION_RECORD_STORAGE_KEY, running_record)
                    .await?;
                Response::from_json(&DeriverBYaoSessionResponseV1::PairStarted {
                    session,
                    pair_digest,
                    execution_id,
                    input: response_input,
                    work: response_work,
                    receipt: response_receipt,
                    root_metadata_digest,
                    pair_binding,
                    tenant_root: response_tenant_root,
                })
            })
            .await
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
    let serialized_receipt = request
        .headers()
        .get("x-seams-yao-readiness-receipt")
        .map_err(|_| invalid_lifecycle("readiness receipt header could not be read"))?
        .ok_or_else(|| invalid_lifecycle("pair-bound WebSocket readiness receipt is missing"))?;
    let peer_receipt = serde_json::from_str::<Ed25519YaoRoleReadinessReceiptV1>(
        &serialized_receipt,
    )
    .map_err(|_| invalid_lifecycle("pair-bound WebSocket readiness receipt is malformed"))?;
    let serialized_execution_id = request
        .headers()
        .get(EXECUTION_ID_HEADER)
        .map_err(|_| invalid_lifecycle("execution id header could not be read"))?
        .ok_or_else(|| invalid_lifecycle("pair-bound WebSocket execution id is missing"))?;
    let execution_id = Ed25519YaoExecutionIdV1::new(decode_hex_32(&serialized_execution_id)?)?;
    let scope = deriver_b_websocket_scope(&request)?;
    if scope.pair_binding.session() != binding.session
        || scope.pair_binding.pair_digest().bytes != binding.pair_digest
    {
        return Err(invalid_lifecycle(
            "pair-bound WebSocket scope differs from binding",
        ));
    }
    let begin_started_at_ms = role_span_started_at_ms();
    let running = execution_host
        .command(
            &env,
            &scope,
            DeriverBYaoSessionCommandV1::BeginPair {
                session: binding.session,
                pair_digest: binding.pair_digest,
                execution_id,
                peer_receipt: Box::new(peer_receipt),
            },
            trace_id,
        )
        .await?;
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
        execution_id,
        input,
        work,
        receipt,
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
    if receipt.role() != Ed25519YaoDeriverRoleV1::DeriverB
        || receipt.pair_digest().bytes != binding.pair_digest
        || receipt.session_bytes() != binding.session
        || receipt.root_metadata_digest().bytes != root_metadata_digest
    {
        return Err(invalid_lifecycle(
            "Deriver B readiness root does not match prepared state",
        ));
    }
    validate_cloudflare_role_readiness_receipt_v1(
        &receipt,
        cloudflare_yao_now_unix_ms().map_err(|_| invalid_lifecycle("Yao clock is unavailable"))?,
    )
    .map_err(|error| invalid_lifecycle(error.message()))?;
    if circuit_for_input(&input) != binding.circuit {
        return Err(invalid_lifecycle(
            "Deriver B prepared circuit does not match WebSocket binding",
        ));
    }
    let accepted_at_ms =
        cloudflare_yao_now_unix_ms().map_err(|_| invalid_lifecycle("Yao clock is unavailable"))?;
    let expires_at_ms = yao_expiry_from_now(accepted_at_ms, YAO_RUNNING_LIFETIME_MS)
        .map_err(|_| invalid_lifecycle("Yao acceptance expiry is invalid"))?;
    let acceptance = sign_role_start_acceptance_v1(
        &env,
        CloudflareWorkerRoleV1::DeriverB,
        runtime.peer_signing_key(),
        binding.session,
        binding.pair_digest,
        execution_id,
        root_metadata_digest,
        accepted_at_ms,
        expires_at_ms,
    )?;
    let headers = worker::Headers::new();
    headers
        .set("Sec-WebSocket-Protocol", &protocol)
        .map_err(|_| invalid_lifecycle("WebSocket response protocol could not be set"))?;
    let serialized_acceptance = serde_json::to_string(&acceptance)
        .map_err(|_| invalid_lifecycle("start acceptance could not be serialized"))?;
    headers
        .set(START_ACCEPTANCE_HEADER, &serialized_acceptance)
        .map_err(|_| invalid_lifecycle("start acceptance header could not be set"))?;
    let pair = WebSocketPair::new()
        .map_err(|_| invalid_lifecycle("Deriver B WebSocket pair could not be created"))?;
    let response = Response::from_websocket(pair.client)
        .map(|response| response.with_headers(headers))
        .map_err(|_| invalid_lifecycle("WebSocket upgrade response could not be created"))?;
    let server = pair.server;
    let server_for_error = server.clone();
    let session = binding.session;
    let pair_digest = binding.pair_digest;
    let continuation_host = execution_host.clone();
    continuation_host.wait_until(async move {
        let role_started_at_ms = role_span_started_at_ms();
        let running_scope = CloudflareDeriverBWalletPairScopeV1 {
            wallet_home: tenant_root.wallet_home,
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
                        session,
                        pair_digest,
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
