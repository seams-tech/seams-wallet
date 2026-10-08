use super::*;

pub(super) struct PreparedDeriverATarget {
    pub(super) preface: Ed25519YaoDeriverAPrefaceInFlightV2,
    pub(super) outbound: Ed25519YaoDeriverAToBTargetProofPayloadV2,
    pub(super) stable_context: Ed25519YaoStableKeyDerivationContextV1,
}

/// Prepares A's proof while B opens its connection. The caller sends it only
/// after verifying B's acceptance and durably claiming this execution.
pub(super) async fn prepare_deriver_a_target(
    env: &Env,
    execution: &DeriverAPairExecutionContextV1<'_>,
    trace_id: RoleTraceContextV1,
) -> RouterAbProtocolResult<PreparedDeriverATarget> {
    let (custody_binding, role_share, stable_context, root_metadata_digest) =
        load_ed25519_yao_tenant_root_role_share_v2(
            env,
            CloudflareWorkerRoleV1::DeriverA,
            execution.tenant_root,
            execution.pair_binding,
            execution.pair_object.clone(),
            RootUseAccess::ReadAdmitted,
        )
        .await?;
    validate_expected_root_metadata_digest(
        execution.expected_root_metadata_digest,
        root_metadata_digest,
    )?;
    let started_at_ms = role_span_started_at_ms();
    let preface = prepare_cloudflare_ed25519_yao_deriver_a_target_v2(
        role_share,
        &custody_binding,
        execution.tenant_root.outer_binding.clone(),
        &stable_context,
    )?;
    let outbound = seal_deriver_a_target_proof_v2(
        env,
        &execution.tenant_root.outer_binding,
        preface.outbound_plaintext(),
    )?;
    emit_role_span_v1(
        trace_id,
        "deriver_a.target_prepared",
        "deriver_a",
        "yao",
        started_at_ms,
        "success",
    );
    Ok(PreparedDeriverATarget {
        preface,
        outbound,
        stable_context,
    })
}

/// Loads the pair's role share with a new or previously prepared admission.
/// The admission also binds the wallet object that holds the pair record.
pub(super) async fn load_ed25519_yao_tenant_root_role_share_v2(
    env: &Env,
    worker_role: CloudflareWorkerRoleV1,
    tenant_root: &crate::CloudflareEd25519YaoTenantRootContextV2,
    pair_binding: &Ed25519YaoInputPairBindingV1,
    pair_object: Option<String>,
    access: RootUseAccess,
) -> RouterAbProtocolResult<(
    TenantRootCustodyBindingV1,
    VerifiedTenantRootOnlineRoleShareV1,
    Ed25519YaoStableKeyDerivationContextV1,
    [u8; 32],
)> {
    tenant_root.validate_for_pair(pair_binding)?;
    let now_unix_ms =
        cloudflare_yao_now_unix_ms().map_err(|_| invalid_lifecycle("Yao clock is unavailable"))?;
    let custody_binding = tenant_root
        .custody_binding
        .authenticate_for_ed25519_yao_v1(
            &CloudflareWorkerEnvReaderV1::new(env),
            pair_binding,
            &tenant_root.application,
            tenant_root.participant_ids,
            now_unix_ms,
        )?;
    if tenant_root
        .identity
        .digest()
        .map_err(crate::map_root_share_to_protocol)?
        != custody_binding.identity_digest()
    {
        return Err(invalid_lifecycle(
            "Yao root identity differs from authenticated custody",
        ));
    }
    let role_share = crate::tenant_root_role_runtime::load_role_share_with_access(
        &crate::tenant_root_role_runtime::CloudflareTenantRootDeriverHostV1::new(
            env,
            worker_role,
            None,
        ),
        &custody_binding,
        &crate::tenant_root_role_d1::TenantRootRootUseAttemptV1::Ed25519YaoPairSession {
            session: pair_binding.session(),
            pair_object,
        },
        now_unix_ms,
        access,
    )
    .await?;
    let root_metadata_digest = *role_share
        .binding()
        .digest()
        .map_err(crate::map_root_share_to_protocol)?
        .as_bytes();
    let stable_context =
        stable_key_derivation_context_v1(&tenant_root.application, tenant_root.participant_ids)
            .map_err(|error| {
                invalid_lifecycle(format!(
                    "Ed25519 Yao stable context construction failed: {error}"
                ))
            })?;
    Ok((
        custody_binding,
        role_share,
        stable_context,
        root_metadata_digest,
    ))
}
