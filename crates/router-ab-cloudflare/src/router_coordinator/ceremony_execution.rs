use super::*;

/// Runs one pair: dispatches Deriver B's preparation and Deriver A's execution
/// together, awaits both answers, and finalizes Deriver A's result.
///
/// Neither request waits for the other. Deriver A connects to Deriver B's
/// wallet object, which admits the connection once its own preparation has
/// landed, or refuses it at `deadline_ms`.
pub(super) async fn prepare_execute_and_finalize(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: RouterEd25519YaoExecuteRequestV1,
    tenant_root: CloudflareEd25519YaoTenantRootContextV2,
    deadline_ms: u64,
    trace_id: Option<crate::CloudflareTraceIdV1>,
    finalization: &RouterCeremonyFinalizationV1,
    timing: &mut RouterExecutionTimingV1,
    package_delivery: package_delivery::Delivery,
) -> RouterAbProtocolResult<RouterCeremonyOutcomeV1> {
    let (binding, input_a, input_b) = request_parts(&request);
    let operation = operation_label(request.operation());
    let pair_binding = request.pair_binding().clone();
    let work = pair_work(&request);
    let ownership_generation = tenant_root.ownership_generation;
    let wallet_home = tenant_root.wallet_home;
    let root_identity = tenant_root.identity.clone();

    let started_at_ms = cloudflare_now_unix_ms_v1()?;
    let prepare_request_b = CloudflareEd25519YaoPairPrepareRequestV1 {
        pair_binding: pair_binding.clone(),
        tenant_root: tenant_root.clone(),
        work: work.clone(),
        input: input_b,
    };
    let execute_request_a = CloudflareEd25519YaoPairExecuteRequestV1 {
        pair_binding: pair_binding.clone(),
        tenant_root,
        work,
        input: input_a,
        deadline_ms,
    };
    let prepare_b = async {
        let prepared =
            post_role_json_for_ceremony_with_span::<_, CloudflareEd25519YaoPairPreparationV1>(
                env,
                runtime.deriver_b_peer().binding_name.as_str(),
                DERIVER_B_SERVICE_URL,
                CLOUDFLARE_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
                "Deriver B pair preparation",
                &prepare_request_b,
                trace_id,
                "router.prepare_pair.deriver_b",
                operation,
            )
            .await;
        emit_span(
            trace_id,
            "router.prepare_pair",
            operation,
            started_at_ms,
            if prepared.is_ok() {
                "success"
            } else {
                "failure"
            },
        );
        let finished_at_ms = cloudflare_now_unix_ms_v1().unwrap_or(started_at_ms);
        (prepared, finished_at_ms.saturating_sub(started_at_ms))
    };
    let execute_a =
        post_role_json_for_ceremony_with_span::<_, CloudflareEd25519YaoPairExecuteResponseV1>(
            env,
            runtime.deriver_a_peer().binding_name.as_str(),
            DERIVER_A_SERVICE_URL,
            CLOUDFLARE_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH,
            "Deriver A pair execution",
            &execute_request_a,
            trace_id,
            "router.deriver_a_execute.http",
            operation,
        );
    let ((prepared_b, prepare_pair_ms), execution) = futures::join!(prepare_b, execute_a);
    timing.prepare_pair_ms = prepare_pair_ms;
    // Deriver A's answer decides the run. A completed execution carries
    // Deriver B's sealed completion, so it stands whatever became of the
    // preparation's reply.
    let execution = match execution {
        Ok(execution) => execution,
        Err(error) => {
            emit_span(
                trace_id,
                "router.deriver_a_execute",
                operation,
                started_at_ms,
                "failure",
            );
            return resolve_role_call_error(
                execution_failure(error, prepared_b.err()),
                &pair_binding,
            )
            .map(RouterCeremonyOutcomeV1::Standard);
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
        operation,
        started_at_ms,
        if execution_validation.is_ok() {
            "success"
        } else {
            "failure"
        },
    );
    timing.role_execution_ms = cloudflare_now_unix_ms_v1()?.saturating_sub(started_at_ms);
    execution_validation?;

    let transcript =
        crate::ed25519_yao_role_execution_transcript_v1(&execution.deriver_a_execution);
    let completed_b = serde_json::from_str::<Ed25519YaoRoleExecutionV1>(
        &execution.deriver_b_sealed_execution_json,
    )
    .map_err(|_| invalid_coordinator("Deriver B sealed execution is malformed"))?;
    crate::validate_router_ed25519_yao_role_execution_v1(
        &completed_b,
        Ed25519YaoDeriverRoleV1::DeriverB,
        &binding,
        Some(transcript),
    )?;

    finalize_router_result_v1(
        env,
        wallet_home,
        ownership_generation,
        runtime,
        &request,
        &binding,
        &root_identity,
        execution.deriver_a_execution,
        completed_b,
        trace_id,
        finalization,
        timing,
        package_delivery,
    )
    .await
}
