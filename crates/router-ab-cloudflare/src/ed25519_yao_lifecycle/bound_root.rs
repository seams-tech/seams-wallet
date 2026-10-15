use super::*;

pub(crate) struct PreparedDeriverATarget {
    pub(super) preface: Ed25519YaoDeriverAPrefaceInFlightV2,
    pub(super) outbound: Ed25519YaoDeriverAToBTargetProofPayloadV2,
    pub(super) stable_context: Ed25519YaoStableKeyDerivationContextV1,
}

/// A fresh admission can supply its target once in the same request. A
/// persisted preparation must reload its admitted root before it can execute.
pub(crate) enum DeriverATargetSource {
    AdmittedNow(PreparedDeriverATarget),
    StoredAdmission,
}

/// Deriver A's admitted root for one pair: its own root metadata digest and
/// how long the preparation lasts.
#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
pub(crate) struct DeriverAPairPreparationV1 {
    pub(crate) root_metadata_digest: [u8; 32],
    pub(crate) prepared_at_ms: u64,
    pub(crate) expires_at_ms: u64,
}

/// Validates Deriver A's input for the pair and admits its root use. The
/// target built from that root is used once, in the same request.
#[cfg(feature = "strict-worker-deriver-a-entrypoint")]
pub(crate) async fn prepare_deriver_a_pair_for_wallet_do_v1(
    env: &Env,
    request: &CloudflareEd25519YaoPairPrepareRequestV1,
    pair_object: String,
    access: RootUseAccess,
) -> RouterAbProtocolResult<
    Result<(DeriverAPairPreparationV1, DeriverATargetSource), crate::tenant_root_role_runtime::AttemptConflictV1>,
> {
    let expected_kind = input_kind_for_circuit(request.pair_binding.binding().circuit_family());
    request.validate_for_role(Ed25519YaoDeriverRoleV1::DeriverA, expected_kind)?;
    let (custody_binding, role_share, stable_context, root_metadata_digest) =
        match load_ed25519_yao_tenant_root_role_share_v2(
            env,
            CloudflareWorkerRoleV1::DeriverA,
            &request.tenant_root,
            &request.pair_binding,
            Some(pair_object),
            access,
        )
        .await?
        {
            Ok(loaded) => loaded,
            Err(conflict) => return Ok(Err(conflict)),
        };
    let prepared_at_ms =
        cloudflare_yao_now_unix_ms().map_err(|error| invalid_lifecycle(error.to_string()))?;
    let expires_at_ms = prepared_at_ms
        .checked_add(YAO_PREPARED_INPUT_LIFETIME_MS)
        .ok_or_else(|| invalid_lifecycle("Yao pair expiry overflowed"))?;
    let target = prepare_target_from_bound_share(
        env,
        &request.tenant_root,
        custody_binding,
        role_share,
        stable_context,
        None,
    )?;
    Ok(Ok((
        DeriverAPairPreparationV1 {
            root_metadata_digest,
            prepared_at_ms,
            expires_at_ms,
        },
        DeriverATargetSource::AdmittedNow(target),
    )))
}

/// Prepares A's proof while B opens its connection. The caller sends it only
/// after B claimed this execution and A durably claimed it too.
pub(super) async fn prepare_deriver_a_target(
    env: &Env,
    execution: &DeriverAPairExecutionContextV1<'_>,
    source: DeriverATargetSource,
    trace_id: RoleTraceContextV1,
) -> RouterAbProtocolResult<PreparedDeriverATarget> {
    match source {
        DeriverATargetSource::AdmittedNow(target) => return Ok(target),
        DeriverATargetSource::StoredAdmission => {}
    }
    let (custody_binding, role_share, stable_context, root_metadata_digest) =
        load_ed25519_yao_tenant_root_role_share_v2(
            env,
            CloudflareWorkerRoleV1::DeriverA,
            execution.tenant_root,
            execution.pair_binding,
            Some(execution.pair_object.clone()),
            RootUseAccess::ReadAdmitted,
        )
        .await?
        .map_err(crate::tenant_root_role_runtime::AttemptConflictV1::into_error)?;
    validate_expected_root_metadata_digest(
        execution.expected_root_metadata_digest,
        root_metadata_digest,
    )?;
    prepare_target_from_bound_share(
        env,
        execution.tenant_root,
        custody_binding,
        role_share,
        stable_context,
        trace_id,
    )
}

fn prepare_target_from_bound_share(
    env: &Env,
    tenant_root: &crate::CloudflareEd25519YaoTenantRootContextV2,
    custody_binding: TenantRootCustodyBindingV1,
    role_share: VerifiedTenantRootOnlineRoleShareV1,
    stable_context: Ed25519YaoStableKeyDerivationContextV1,
    trace_id: RoleTraceContextV1,
) -> RouterAbProtocolResult<PreparedDeriverATarget> {
    let started_at_ms = role_span_started_at_ms();
    let preface = prepare_cloudflare_ed25519_yao_deriver_a_target_v2(
        role_share,
        &custody_binding,
        tenant_root.outer_binding.clone(),
        &stable_context,
    )?;
    let outbound = seal_deriver_a_target_proof_v2(
        env,
        &tenant_root.outer_binding,
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
) -> RouterAbProtocolResult<
    Result<
        (
            TenantRootCustodyBindingV1,
            VerifiedTenantRootOnlineRoleShareV1,
            Ed25519YaoStableKeyDerivationContextV1,
            [u8; 32],
        ),
        crate::tenant_root_role_runtime::AttemptConflictV1,
    >,
> {
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
    let role_share = match role_share {
        Ok(role_share) => role_share,
        Err(conflict) => return Ok(Err(conflict)),
    };
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
    Ok(Ok((
        custody_binding,
        role_share,
        stable_context,
        root_metadata_digest,
    )))
}
