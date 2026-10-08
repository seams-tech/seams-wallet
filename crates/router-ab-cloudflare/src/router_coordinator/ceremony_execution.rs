use super::*;

pub(super) async fn prepare_execute_and_finalize(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    request: RouterEd25519YaoExecuteRequestV1,
    tenant_root: CloudflareEd25519YaoTenantRootContextV2,
    trace_id: Option<crate::CloudflareTraceIdV1>,
    finalization: &RouterCeremonyFinalizationV1,
    timing: &mut RouterExecutionTimingV1,
    package_delivery: package_delivery::Delivery,
) -> RouterAbProtocolResult<RouterCeremonyOutcomeV1> {
    let (binding, input_a, input_b) = request_parts(&request);
    let verifying_keys =
        parse_cloudflare_deriver_peer_verifying_key_set_v1(&CloudflareWorkerEnvReaderV1::new(env))?;
    let operation = request.operation();
    let pair_binding = request.pair_binding().clone();
    let work = pair_work(&request);
    let ownership_generation = tenant_root.ownership_generation;
    let wallet_home = tenant_root.wallet_home;
    let root_identity = tenant_root.identity.clone();

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
            return resolve_role_call_error(error, &pair_binding)
                .map(RouterCeremonyOutcomeV1::Standard);
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
            return resolve_role_call_error(error, &pair_binding)
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
