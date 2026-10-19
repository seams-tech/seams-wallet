use super::*;

/// Runs Deriver A's role over one connection to Deriver B. `confirm_start`
/// records A's own claim once B has claimed: the last durable step before A
/// sends protocol material.
pub(crate) async fn execute_deriver_a_role<ConfirmStart, Confirmation>(
    env: &Env,
    runtime: &CloudflareDeriverAWorkerRuntimeV1,
    input: Ed25519YaoEncryptedInputV1,
    trace_id: RoleTraceContextV1,
    pair_execution: DeriverAPairExecutionContextV1<'_>,
    target_source: DeriverATargetSource,
    prepared_peer: Option<crate::registration_pair_connection::PreparedConnection>,
    confirm_start: ConfirmStart,
) -> Result<DeriverAPairRoleExecutionV1, DeriverAPairRoleFailureV1>
where
    ConfirmStart: FnOnce() -> Confirmation,
    Confirmation: Future<Output = RouterAbProtocolResult<()>>,
{
    let circuit = circuit_for_input(&input);
    let private_key =
        load_deriver_input_private_key(env, &runtime.envelope_decrypt_key().current.binding_name)?;
    let session = input.session();
    let websocket_binding = CloudflareEd25519YaoWebSocketBindingV1::with_pair_digest(
        circuit,
        session,
        pair_execution.pair_digest,
    )
    .map_err(map_websocket_error)?;
    let start = CloudflareDeriverBPairStartScopeV1 {
        scope: CloudflareDeriverBWalletPairScopeV1 {
            wallet_route: pair_execution.tenant_root.wallet_route,
            ownership_generation: pair_execution.tenant_root.ownership_generation,
            root_identity: pair_execution.tenant_root.identity.clone(),
            pair_binding: pair_execution.pair_binding.clone(),
        },
        outer_binding: pair_execution.tenant_root.outer_binding.clone(),
        deadline_ms: pair_execution.deadline_ms,
    };
    // Both operations must finish, including when the root read fails. The
    // connection owns socket cleanup until protocol execution ends.
    let peer_started_at_ms = role_span_started_at_ms();
    let was_prepared = prepared_peer.is_some();
    let connect = async {
        match prepared_peer {
            Some(peer) => Ok(peer.connection),
            None => {
                connect_deriver_b(
                    env,
                    websocket_binding,
                    trace_id,
                    pair_execution.execution_id,
                    &start,
                )
                .await
            }
        }
    };
    let (target_result, connection_result) = futures::join!(
        prepare_deriver_a_target(env, &pair_execution, target_source, trace_id),
        connect,
    );
    // B's answer comes first: when B holds no claim, the reservation is
    // released whatever became of A's own target.
    let connection = match connection_result {
        Ok(connection) => connection,
        Err(CloudflareEd25519YaoPairStartErrorV1::Refused(refusal)) => {
            return Err(DeriverAPairRoleFailureV1::PeerHoldsNoClaim(refusal.reason));
        }
        Err(CloudflareEd25519YaoPairStartErrorV1::Failed(error)) => {
            return Err(map_websocket_error(error).into());
        }
    };
    let PreparedDeriverATarget {
        preface,
        outbound,
        stable_context,
    } = target_result?;
    let mut transport =
        CloudflareEd25519YaoWebSocketTransportV1::deriver_a(&connection.socket, session)
            .map_err(map_websocket_error)?;
    if was_prepared {
        match transport
            .start_prepared_registration(pair_execution.execution_id, &start)
            .await
        {
            Ok(()) => {}
            Err(CloudflareEd25519YaoPairStartErrorV1::Refused(refusal)) => {
                return Err(DeriverAPairRoleFailureV1::PeerHoldsNoClaim(refusal.reason))
            }
            Err(CloudflareEd25519YaoPairStartErrorV1::Failed(error)) => {
                return Err(map_websocket_error(error).into())
            }
        }
    }
    emit_role_span_v1(
        trace_id,
        "deriver_a.peer_ready",
        "deriver_a",
        "yao",
        peer_started_at_ms,
        "success",
    );
    // The outgoing proof waits for the storage output gate. That wait belongs
    // to preface_exchange; claim_record measures only the local mutation.
    let claim_started_at_ms = role_span_started_at_ms();
    let claimed = confirm_start().await;
    emit_role_span_v1(
        trace_id,
        "deriver_a.claim_record",
        "deriver_a",
        "yao",
        claim_started_at_ms,
        if claimed.is_ok() {
            "success"
        } else {
            "failure"
        },
    );
    claimed?;
    let preface_started_at_ms = role_span_started_at_ms();
    let incoming = transport
        .exchange_deriver_a_target_proof_preface_v2(&outbound)
        .await;
    emit_role_span_v1(
        trace_id,
        "deriver_a.preface_exchange",
        "deriver_a",
        "yao",
        preface_started_at_ms,
        if incoming.is_ok() {
            "success"
        } else {
            "failure"
        },
    );
    let incoming = incoming.map_err(map_websocket_error)?;
    let incoming_plaintext = open_deriver_a_target_proof_v2(
        env,
        &runtime.envelope_decrypt_key().current.binding_name,
        &incoming,
    )?;
    let server_contribution = complete_cloudflare_ed25519_yao_deriver_a_target_v2(
        preface,
        &incoming,
        &incoming_plaintext,
        &pair_execution.tenant_root.outer_binding,
        &stable_context,
    )?;
    let (execution, peer_sealed_completion) = match input.kind() {
        Ed25519YaoInputKindV1::Activation => {
            let role_request =
                open_ed25519_yao_activation_deriver_a_input_v1(&input, &private_key)?;
            let recipients = role_request.recipients;
            let (binding, role) = build_product_activation_deriver_a_with_server_v1(
                role_request,
                server_contribution,
            )
            .map_err(map_adapter)?;
            let protocol_started_at_ms =
                begin_role_protocol_v1(trace_id, "deriver_a", "activation");
            let completion_result =
                with_yao_ceremony_timeout(run_activation_deriver_a(role, transport)).await;
            emit_role_span_v1(
                trace_id,
                "deriver_a.yao_protocol",
                "deriver_a",
                "activation",
                protocol_started_at_ms,
                if completion_result.is_ok() {
                    "success"
                } else {
                    "failure"
                },
            );
            let completion = completion_result?;
            let seal_started_at_ms = role_span_started_at_ms();
            let sealed = seal_ed25519_yao_activation_deriver_a_execution_v1(
                &mut CloudflareHpkeGetrandomRngV1,
                binding,
                recipients,
                &completion.role,
            );
            emit_role_span_v1(
                trace_id,
                "deriver_a.output_seal",
                "deriver_a",
                "activation",
                seal_started_at_ms,
                if sealed.is_ok() { "success" } else { "failure" },
            );
            (sealed?, completion.transport.peer_sealed_completion)
        }
        Ed25519YaoInputKindV1::Export => {
            let role_request = open_ed25519_yao_export_deriver_a_input_v1(&input, &private_key)?;
            let recipient = role_request.recipients;
            let (binding, role) =
                build_product_export_deriver_a_with_server_v1(role_request, server_contribution)
                    .map_err(map_adapter)?;
            let protocol_started_at_ms = begin_role_protocol_v1(trace_id, "deriver_a", "export");
            let completion_result =
                with_yao_ceremony_timeout(run_export_deriver_a(role, transport)).await;
            emit_role_span_v1(
                trace_id,
                "deriver_a.yao_protocol",
                "deriver_a",
                "export",
                protocol_started_at_ms,
                if completion_result.is_ok() {
                    "success"
                } else {
                    "failure"
                },
            );
            let completion = completion_result?;
            (
                seal_ed25519_yao_export_deriver_a_execution_v1(
                    &mut CloudflareHpkeGetrandomRngV1,
                    binding,
                    recipient,
                    &completion.role,
                )?,
                completion.transport.peer_sealed_completion,
            )
        }
        Ed25519YaoInputKindV1::LaneMaterialization => {
            let crate::CloudflareEd25519YaoPairWorkV1::Lane { job: expected_job } =
                &pair_execution.work
            else {
                return Err(
                    invalid_lifecycle("Deriver A lane input is missing its admitted job").into(),
                );
            };
            let role_request =
                open_ed25519_yao_lane_deriver_a_input_v1(&input, expected_job, &private_key)?;
            let (binding, job, role) = build_product_lane_deriver_a_with_server_v1(
                role_request,
                server_contribution,
                &mut CloudflareHpkeGetrandomRngV1,
            )
            .map_err(map_adapter)?;
            if &binding != pair_execution.pair_binding.binding()
                || router_ab_core::PublicDigest32::new(job.transcript_digest_v1()?)
                    != pair_execution.pair_binding.authorization_digest()
            {
                return Err(invalid_lifecycle(
                    "Deriver A lane input does not match the Router pair binding",
                )
                .into());
            }
            let protocol_started_at_ms =
                begin_role_protocol_v1(trace_id, "deriver_a", "lane_materialization");
            let completion_result =
                with_yao_ceremony_timeout(run_lane_materialization_deriver_a(role, transport))
                    .await;
            emit_role_span_v1(
                trace_id,
                "deriver_a.yao_protocol",
                "deriver_a",
                "lane_materialization",
                protocol_started_at_ms,
                if completion_result.is_ok() {
                    "success"
                } else {
                    "failure"
                },
            );
            let completion = completion_result?;
            (
                Ed25519YaoRoleExecutionV1::Lane(seal_ed25519_yao_lane_deriver_a_execution_v1(
                    &mut CloudflareHpkeGetrandomRngV1,
                    job,
                    &completion.role,
                )?),
                completion.transport.peer_sealed_completion,
            )
        }
    };
    let peer_sealed_completion = peer_sealed_completion.ok_or_else(|| {
        invalid_lifecycle("Deriver B did not return its sealed execution over the pair channel")
    })?;
    let deriver_b_sealed_execution_json = String::from_utf8(peer_sealed_completion)
        .map_err(|_| invalid_lifecycle("Deriver B sealed execution is not UTF-8 JSON"))?;
    Ok(DeriverAPairRoleExecutionV1 {
        deriver_a_execution: execution,
        deriver_b_sealed_execution_json,
    })
}

/// Connects to Deriver B and waits for its answer: B waits for its own
/// preparation until the Router's run ends, then claims or refuses. Without
/// an answer within the ceremony's time, B may have claimed.
async fn connect_deriver_b(
    env: &Env,
    binding: CloudflareEd25519YaoWebSocketBindingV1,
    trace_id: RoleTraceContextV1,
    execution_id: Ed25519YaoExecutionIdV1,
    start: &CloudflareDeriverBPairStartScopeV1,
) -> Result<crate::CloudflareEd25519YaoPairStartConnectionV1, CloudflareEd25519YaoPairStartErrorV1>
{
    let started_at_ms = role_span_started_at_ms();
    let connect = Box::pin(crate::connect_cloudflare_ed25519_yao_deriver_b_v1(
        env,
        binding,
        trace_id,
        execution_id,
        start,
    ));
    let timeout = Box::pin(Delay::from(YAO_CEREMONY_TIMEOUT));
    let result = match select(connect, timeout).await {
        Either::Left((result, _)) => result,
        Either::Right(_) => Err(CloudflareEd25519YaoPairStartErrorV1::Failed(
            crate::CloudflareEd25519YaoWebSocketErrorV1::ServiceBinding,
        )),
    };
    emit_role_span_v1(
        trace_id,
        "deriver_a.websocket_connect",
        "deriver_a",
        "websocket",
        started_at_ms,
        if result.is_ok() { "success" } else { "failure" },
    );
    result
}
