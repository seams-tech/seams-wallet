//! Preparation and execution for each supported role host.
use super::*;

#[cfg(not(feature = "strict-worker-router-entrypoint"))]
pub(super) async fn prepare_and_execute(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    operation: Ed25519YaoOperationV1,
    pair_binding: Ed25519YaoInputPairBindingV1,
    tenant_root: CloudflareEd25519YaoTenantRootContextV2,
    work: crate::CloudflareEd25519YaoPairWorkV1,
    input_a: router_ab_core::Ed25519YaoEncryptedInputV1,
    input_b: router_ab_core::Ed25519YaoEncryptedInputV1,
    verifying_keys: &crate::CloudflareSignerPeerVerifyingKeySetV1,
    trace_id: Option<crate::CloudflareTraceIdV1>,
    timing: &mut RouterExecutionTimingV1,
) -> Result<CloudflareEd25519YaoPairExecuteResponseV1, RouterRoleCallError> {
    let binding = pair_binding.binding().clone();
    let prepare_started_at_ms = cloudflare_now_unix_ms_v1()?;
    let prepare_request_a = CloudflareEd25519YaoPairPrepareRequestV1 {
        pair_binding: pair_binding.clone(),
        tenant_root: tenant_root.clone(),
        work: work.clone(),
        input: input_a.clone(),
    };
    let prepare_request_b = CloudflareEd25519YaoPairPrepareRequestV1 {
        pair_binding: pair_binding.clone(),
        tenant_root: tenant_root.clone(),
        work: work.clone(),
        input: input_b,
    };
    let prepare_a = post_role_json_for_ceremony_with_span::<_, Ed25519YaoRoleReadinessReceiptV1>(
        env,
        runtime.deriver_a_peer().binding_name.as_str(),
        DERIVER_A_SERVICE_URL,
        CLOUDFLARE_DERIVER_A_ED25519_YAO_PREPARE_PAIR_PATH,
        "Deriver A pair preparation",
        &prepare_request_a,
        trace_id,
        "router.prepare_pair.deriver_a",
        operation_label(operation),
    );
    let prepare_b = post_role_json_for_ceremony_with_span::<_, Ed25519YaoRoleReadinessReceiptV1>(
        env,
        runtime.deriver_b_peer().binding_name.as_str(),
        DERIVER_B_SERVICE_URL,
        CLOUDFLARE_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
        "Deriver B pair preparation",
        &prepare_request_b,
        trace_id,
        "router.prepare_pair.deriver_b",
        operation_label(operation),
    );
    let (receipt_a, receipt_b) = match futures::try_join!(prepare_a, prepare_b) {
        Ok(receipts) => receipts,
        Err(error) => {
            emit_span(
                trace_id,
                "router.prepare_pair",
                operation_label(operation),
                prepare_started_at_ms,
                "failure",
            );
            return Err(error);
        }
    };
    emit_span(
        trace_id,
        "router.prepare_pair",
        operation_label(operation),
        prepare_started_at_ms,
        "success",
    );
    timing.prepare_pair_ms = cloudflare_now_unix_ms_v1()?.saturating_sub(prepare_started_at_ms);
    let readiness_now_ms = cloudflare_now_unix_ms_v1()?;
    let readiness_started_at_ms = cloudflare_now_unix_ms_v1()?;
    let readiness_result = crate::validate_router_ed25519_yao_readiness_v1(
        &receipt_a,
        &pair_binding,
        readiness_now_ms,
        Ed25519YaoDeriverRoleV1::DeriverA,
        &verifying_keys,
    )
    .and_then(|()| {
        crate::validate_router_ed25519_yao_readiness_v1(
            &receipt_b,
            &pair_binding,
            readiness_now_ms,
            Ed25519YaoDeriverRoleV1::DeriverB,
            &verifying_keys,
        )
    });
    emit_span(
        trace_id,
        "router.verify_readiness_receipts",
        operation_label(operation),
        readiness_started_at_ms,
        if readiness_result.is_ok() {
            "success"
        } else {
            "failure"
        },
    );
    timing.verify_readiness_ms =
        cloudflare_now_unix_ms_v1()?.saturating_sub(readiness_started_at_ms);
    readiness_result?;
    let execute_started_at_ms = cloudflare_now_unix_ms_v1()?;
    let execution = match post_role_json_for_ceremony_with_span::<
        _,
        CloudflareEd25519YaoPairExecuteResponseV1,
    >(
        env,
        runtime.deriver_a_peer().binding_name.as_str(),
        DERIVER_A_SERVICE_URL,
        CLOUDFLARE_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
        "Deriver A pair execution",
        &CloudflareEd25519YaoPairExecuteRequestV1 {
            pair_binding: pair_binding.clone(),
            tenant_root,
            work,
            input: input_a,
            local_receipt: receipt_a,
            peer_receipt: receipt_b,
        },
        trace_id,
        "router.deriver_a_execute.http",
        operation_label(operation),
    )
    .await
    {
        Ok(execution) => execution,
        Err(error) => {
            emit_span(
                trace_id,
                "router.deriver_a_execute",
                operation_label(operation),
                execute_started_at_ms,
                "failure",
            );
            return Err(error);
        }
    };
    let execution_validation = match execution.deriver_a_execution.validate() {
        Ok(()) => crate::validate_router_ed25519_yao_role_execution_v1(
            &execution.deriver_a_execution,
            Ed25519YaoDeriverRoleV1::DeriverA,
            &binding,
            None,
        ),
        Err(error) => Err(error),
    };
    emit_span(
        trace_id,
        "router.deriver_a_execute",
        operation_label(operation),
        execute_started_at_ms,
        if execution_validation.is_ok() {
            "success"
        } else {
            "failure"
        },
    );
    timing.role_execution_ms = cloudflare_now_unix_ms_v1()?.saturating_sub(execute_started_at_ms);
    execution_validation?;
    Ok(execution)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
use crate::ed25519_yao_ceremony_connection as connection;
#[cfg(feature = "strict-worker-router-entrypoint")]
use worker::{EventStream, WebSocket};

#[cfg(feature = "strict-worker-router-entrypoint")]
struct PreparedConnection {
    socket: WebSocket,
    receipt: Ed25519YaoRoleReadinessReceiptV1,
}

#[cfg(feature = "strict-worker-router-entrypoint")]
impl Drop for PreparedConnection {
    fn drop(&mut self) {
        let _ = self
            .socket
            .close(Some(1000), Some("Router ceremony finished"));
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
pub(super) async fn prepare_and_execute(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    operation: Ed25519YaoOperationV1,
    pair_binding: Ed25519YaoInputPairBindingV1,
    tenant_root: CloudflareEd25519YaoTenantRootContextV2,
    work: crate::CloudflareEd25519YaoPairWorkV1,
    input_a: router_ab_core::Ed25519YaoEncryptedInputV1,
    input_b: router_ab_core::Ed25519YaoEncryptedInputV1,
    verifying_keys: &crate::CloudflareSignerPeerVerifyingKeySetV1,
    trace_id: Option<crate::CloudflareTraceIdV1>,
    timing: &mut RouterExecutionTimingV1,
) -> Result<CloudflareEd25519YaoPairExecuteResponseV1, RouterRoleCallError> {
    let prepare_started = cloudflare_now_unix_ms_v1()?;
    let request_a = CloudflareEd25519YaoPairPrepareRequestV1 {
        pair_binding: pair_binding.clone(),
        tenant_root: tenant_root.clone(),
        work: work.clone(),
        input: input_a,
    };
    let request_b = CloudflareEd25519YaoPairPrepareRequestV1 {
        pair_binding: pair_binding.clone(),
        tenant_root,
        work,
        input: input_b,
    };
    let prepare_a = open_connection(env, runtime, &request_a, trace_id, operation);
    let prepare_b = post_role_json_for_ceremony_with_span::<_, Ed25519YaoRoleReadinessReceiptV1>(
        env,
        runtime.deriver_b_peer().binding_name.as_str(),
        DERIVER_B_SERVICE_URL,
        CLOUDFLARE_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
        "Deriver B pair preparation",
        &request_b,
        trace_id,
        "router.prepare_pair.deriver_b",
        operation_label(operation),
    );
    // B dispatch starts independently of A's Worker and object dispatch.
    let (prepared, receipt_b) = futures::try_join!(prepare_a, prepare_b)?;
    timing.prepare_pair_ms = cloudflare_now_unix_ms_v1()?.saturating_sub(prepare_started);
    emit_span(
        trace_id,
        "router.prepare_pair",
        operation_label(operation),
        prepare_started,
        "success",
    );
    let readiness_started = cloudflare_now_unix_ms_v1()?;
    crate::validate_router_ed25519_yao_readiness_v1(
        &prepared.receipt,
        &pair_binding,
        readiness_started,
        Ed25519YaoDeriverRoleV1::DeriverA,
        verifying_keys,
    )?;
    crate::validate_router_ed25519_yao_readiness_v1(
        &receipt_b,
        &pair_binding,
        readiness_started,
        Ed25519YaoDeriverRoleV1::DeriverB,
        verifying_keys,
    )?;
    timing.verify_readiness_ms = cloudflare_now_unix_ms_v1()?.saturating_sub(readiness_started);
    let execution_started = cloudflare_now_unix_ms_v1()?;
    let mut events: EventStream<'_> = prepared.socket.events().map_err(connection_error)?;
    connection::send(
        &prepared.socket,
        &connection::Start {
            local_receipt: prepared.receipt.clone(),
            peer_receipt: receipt_b,
        },
    )
    .map_err(connection_error)?;
    let outcome: connection::Outcome = connection::receive(&mut events)
        .await
        .map_err(connection_error)?;
    let execution = match outcome {
        connection::Outcome::Completed { execution } => execution,
        connection::Outcome::Failed { failure } => {
            return Err(RouterRoleCallError::Failure(failure))
        }
    };
    execution.deriver_a_execution.validate()?;
    crate::validate_router_ed25519_yao_role_execution_v1(
        &execution.deriver_a_execution,
        Ed25519YaoDeriverRoleV1::DeriverA,
        pair_binding.binding(),
        None,
    )?;
    timing.role_execution_ms = cloudflare_now_unix_ms_v1()?.saturating_sub(execution_started);
    emit_span(
        trace_id,
        "router.deriver_a_execute",
        operation_label(operation),
        execution_started,
        "success",
    );
    Ok(execution)
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn open_connection(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: &CloudflareEd25519YaoPairPrepareRequestV1,
    trace_id: Option<crate::CloudflareTraceIdV1>,
    operation: Ed25519YaoOperationV1,
) -> Result<PreparedConnection, RouterRoleCallError> {
    let started = cloudflare_now_unix_ms_v1()?;
    let headers = worker::Headers::new();
    headers
        .set("Upgrade", "websocket")
        .map_err(connection_error)?;
    connection::write_header(&headers, connection::PREPARATION_HEADER, request)
        .map_err(connection_error)?;
    set_cloudflare_internal_service_auth_header_v1(env, &headers, "Deriver A ceremony connection")?;
    if let Some(trace_id) = trace_id {
        set_cloudflare_trace_id_header_v1(&headers, trace_id)?;
    }
    let mut init = RequestInit::new();
    init.with_method(Method::Get).with_headers(headers);
    let request = Request::new_with_init(
        &format!("{DERIVER_A_SERVICE_URL}{}", connection::PATH),
        &init,
    )
    .map_err(connection_error)?;
    let mut response = env
        .service(&runtime.deriver_a_peer().binding_name)
        .map_err(connection_error)?
        .fetch_request(request)
        .await
        .map_err(connection_error)?;
    if response.status_code() != 101 {
        let body = response.text().await.map_err(connection_error)?;
        if let Ok(failure) =
            serde_json::from_str::<CloudflareEd25519YaoRoleFailureResponseV1>(&body)
        {
            return Err(RouterRoleCallError::Failure(failure));
        }
        return Err(connection_error(format!(
            "Deriver A ceremony upgrade failed: HTTP {}",
            response.status_code()
        )));
    }
    let receipt = connection::read_header(response.headers(), connection::READINESS_HEADER)
        .map_err(connection_error);
    let socket = response
        .websocket()
        .ok_or_else(|| connection_error("Deriver A ceremony socket is missing"))?;
    socket.accept().map_err(connection_error)?;
    let receipt = match receipt {
        Ok(receipt) => receipt,
        Err(error) => {
            let _ = socket.close(Some(1000), Some("Invalid readiness"));
            return Err(error);
        }
    };
    emit_span(
        trace_id,
        "router.prepare_pair.deriver_a",
        operation_label(operation),
        started,
        "success",
    );
    Ok(PreparedConnection { socket, receipt })
}

#[cfg(feature = "strict-worker-router-entrypoint")]
fn connection_error(error: impl std::fmt::Display) -> RouterRoleCallError {
    RouterRoleCallError::Protocol(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!("Deriver A ceremony connection failed: {error}"),
    ))
}
