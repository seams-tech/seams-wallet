//! Managed restore and the managed-restore forward refresh.

use super::*;

/// Verifies and stages one managed restore at its owning Deriver.
///
/// The public state and capability are independently issuer-authenticated. The
/// local role derives the only permitted backup coordinates, opens the backup,
/// and reseals the share into a pending D1 row. This path never calls an
/// activation transition; forward refresh is the only later activation input.
pub async fn tenant_root_deriver_managed_restore_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootManagedRestoreRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootManagedRestoreResponseV1> {
    let worker_role = host.worker_role();
    let role = tenant_root_creation_protocol_role_v1(worker_role)?;
    let managed_role = tenant_root_managed_restore_role_v1(role);
    let public_state_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root managed-restore public state",
        &request.public_state_b64u,
    )?;
    let signed_public_state =
        TenantRootSignedManagedRestoreRoleUnavailableV1::decode_canonical_bytes(
            &public_state_bytes,
        )
        .map_err(candidate_derivation_error)?;
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(host.env())?;
    let issuer_key_id = signed_public_state.issuer_key_id().to_owned();
    let issuer_key = issuer_keys
        .for_issuer_key_id(&issuer_key_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root managed-restore public-state issuer is not trusted by this Deriver",
            )
        })?;
    let verified_public_state = signed_public_state
        .verify(&issuer_key_id, issuer_key)
        .map_err(candidate_derivation_error)?;

    let capability_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root managed-restore capability",
        &request.restore_capability_b64u,
    )?;
    let signed_capability =
        TenantRootSignedManagedRestoreCapabilityV1::decode_canonical_bytes(&capability_bytes)
            .map_err(candidate_derivation_error)?;
    if signed_capability.issuer_key_id() != verified_public_state.issuer_key_id() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore capability and public state use different issuers",
        ));
    }
    let terminal_receipt_payload = signed_capability
        .canonical_bytes()
        .map_err(candidate_derivation_error)?;
    let capability = signed_capability
        .verify(
            verified_public_state.state(),
            verified_public_state.issuer_key_id(),
            issuer_key,
        )
        .map_err(candidate_derivation_error)?;
    if verified_public_state.unavailable_role() != managed_role || capability.role() != managed_role
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore authorization does not belong to this Deriver",
        ));
    }
    let capability_digest = capability.capability_digest();

    let identity = verified_public_state.state().active().identity().clone();
    let expected_commitment = match managed_role {
        TenantRootManagedRestoreRoleV1::DeriverA => verified_public_state
            .state()
            .active()
            .current()
            .verified()
            .commitments()
            .deriver_a(),
        TenantRootManagedRestoreRoleV1::DeriverB => verified_public_state
            .state()
            .active()
            .current()
            .verified()
            .commitments()
            .deriver_b(),
    };
    let (_, role_signer) =
        crate::env::load_tenant_root_creation_role_signing_key_v1(worker_role, host.env())?;
    if role_signer.role() != role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore signer does not belong to this Deriver",
        ));
    }
    let provider_config = tenant_root_role_runtime_provider_config_v1(worker_role, host.env())?;
    let backup_coordinates =
        crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1::new(
            capability.identity_digest(),
            capability.custody_lineage(),
            managed_role,
            capability.epoch(),
        );
    let role_verifying_key = role_signer.verifying_key_bytes();
    let managed_backup = host
        .get_managed_backup(backup_coordinates, &role_verifying_key)
        .await?;
    let mut provider =
        crate::env::load_tenant_root_operational_rotation_provider_v1(worker_role, host.env())?;
    let restored_share = open_tenant_root_managed_backup_v1(managed_backup, &mut provider)
        .await
        .map_err(candidate_derivation_error)?;
    if restored_share.share_commitment() != expected_commitment {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed backup does not reproduce the active role commitment",
        ));
    }

    let share_wire = SigningRootShareWire::decode_slice(restored_share.share().as_bytes())
        .map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "tenant-root managed backup share wire is invalid",
            )
        })?;
    let online_binding = TenantRootOnlineRoleShareBindingV1::from_persisted(
        capability.identity_digest(),
        capability.custody_lineage(),
        role,
        capability.epoch(),
        restored_share.share_commitment().clone(),
        provider_config.online_epoch_wrapping_key_ref.clone(),
        restored_share.installation_receipt_digest(),
    )
    .map_err(candidate_derivation_error)?;
    let online_request = TenantRootOnlineRoleShareSealRequestV1::new(online_binding, share_wire)
        .map_err(candidate_derivation_error)?;
    let online_ciphertext = provider
        .seal_online_role_share(&online_request)
        .map_err(candidate_derivation_error)?;
    let sealed_online_share = online_request
        .complete(online_ciphertext)
        .map_err(candidate_derivation_error)?;
    let opened_online =
        open_tenant_root_online_role_share_v1(sealed_online_share.clone(), &mut provider)
            .map_err(candidate_derivation_error)?;
    if opened_online.identity_digest() != capability.identity_digest()
        || opened_online.custody_lineage() != capability.custody_lineage()
        || opened_online.role() != role
        || opened_online.epoch() != capability.epoch()
        || opened_online.share_commitment() != sealed_online_share.binding().share_commitment()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore online provider returned the wrong binding",
        ));
    }
    drop(opened_online);

    let scope = tenant_root_managed_restore_staging_scope_v1(&verified_public_state, &capability)?;
    let staging = CloudflareTenantRootManagedRestoreStagingInputV1::from_verified_material(
        capability,
        restored_share,
        identity,
        sealed_online_share,
        scope,
        now_ms,
    )
    .map_err(|error| {
        tenant_root_store_error_v1("tenant-root managed-restore staging input", error)
    })?;
    let store = host
        .role_store()
        .map_err(|error| tenant_root_store_error_v1("tenant-root role store lookup", error))?;
    let decision = store
        .reserve_managed_restore_staging(staging, now_ms)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root managed-restore staging reservation", error)
        })?;
    let terminal_receipt = match decision {
        CloudflareTenantRootManagedRestoreStagingDecisionV1::Execute { command }
        | CloudflareTenantRootManagedRestoreStagingDecisionV1::ResumeExecution { command } => {
            let (_, executed) = store
                .insert_managed_restore_pending(command, now_ms)
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1("tenant-root managed-restore staging", error)
                })?;
            let receipt = role_signer
                .sign_verified_success_terminal_receipt(
                    &executed,
                    &terminal_receipt_payload,
                    now_ms,
                )
                .map_err(candidate_derivation_error)?;
            store
                .complete_managed_restore_staging(executed, receipt)
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1(
                        "tenant-root managed-restore staging terminalization",
                        error,
                    )
                })?
        }
        CloudflareTenantRootManagedRestoreStagingDecisionV1::ResumeCompletion { executed } => {
            let receipt = role_signer
                .sign_verified_success_terminal_receipt(
                    &executed,
                    &terminal_receipt_payload,
                    now_ms,
                )
                .map_err(candidate_derivation_error)?;
            store
                .complete_managed_restore_staging(executed, receipt)
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1(
                        "tenant-root managed-restore staging terminalization",
                        error,
                    )
                })?
        }
        CloudflareTenantRootManagedRestoreStagingDecisionV1::ReplayCompleted { receipt_bytes } => {
            crate::tenant_root_role_d1::CloudflareTenantRootCommandTerminalCommitV1::Replay {
                receipt_bytes,
            }
        }
        CloudflareTenantRootManagedRestoreStagingDecisionV1::InProgress => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root managed-restore staging is already in progress",
            ));
        }
        CloudflareTenantRootManagedRestoreStagingDecisionV1::ReplayFailed { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root managed-restore staging previously failed",
            ));
        }
    };
    let terminal_receipt_bytes = match terminal_receipt {
        crate::tenant_root_role_d1::CloudflareTenantRootCommandTerminalCommitV1::Committed {
            receipt_bytes,
        }
        | crate::tenant_root_role_d1::CloudflareTenantRootCommandTerminalCommitV1::Replay {
            receipt_bytes,
        } => receipt_bytes,
    };
    Ok(CloudflareDeriverTenantRootManagedRestoreResponseV1 {
        role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
        status: CloudflareDeriverTenantRootManagedRestoreStatusV1::StagedForForwardRefresh,
        capability_digest_b64u: crate::encode_base64url_bytes_v1(capability_digest.as_bytes()),
        staging_terminal_receipt_b64u: crate::encode_base64url_bytes_v1(&terminal_receipt_bytes),
    })
}

#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_managed_restore_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootManagedRestoreRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootManagedRestoreResponseV1> {
    tenant_root_deriver_managed_restore_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await
}

/// Executes the mandatory forward refresh for one staged managed restore.
///
/// The previous active pair is reconstructed from the independently verified
/// public state, while the current role's sealed source and all restore
/// provenance are loaded from the authenticated pending D1 row. The source is
/// opened only for this refresh and cannot enter a normal signing path.
pub async fn tenant_root_deriver_managed_restore_forward_refresh_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    let worker_role = host.worker_role();
    let role = tenant_root_creation_protocol_role_v1(worker_role)?;
    let managed_role = tenant_root_managed_restore_role_v1(role);
    let public_state_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root managed-restore forward-refresh public state",
        &request.public_state_b64u,
    )?;
    let signed_public_state =
        TenantRootSignedManagedRestoreRoleUnavailableV1::decode_canonical_bytes(
            &public_state_bytes,
        )
        .map_err(candidate_derivation_error)?;
    let reader = host.env();
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(reader)?;
    let issuer_key_id = signed_public_state.issuer_key_id().to_owned();
    let issuer_key = issuer_keys
        .for_issuer_key_id(&issuer_key_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root managed-restore forward-refresh public-state issuer is not trusted by this Deriver",
            )
        })?;
    let verified_public_state = signed_public_state
        .verify(&issuer_key_id, issuer_key)
        .map_err(candidate_derivation_error)?;

    let capability_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root managed-restore forward-refresh capability",
        &request.restore_capability_b64u,
    )?;
    let signed_capability =
        TenantRootSignedManagedRestoreCapabilityV1::decode_canonical_bytes(&capability_bytes)
            .map_err(candidate_derivation_error)?;
    if signed_capability.issuer_key_id() != verified_public_state.issuer_key_id() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore forward-refresh capability and public state use different issuers",
        ));
    }
    let capability = signed_capability
        .verify(
            verified_public_state.state(),
            verified_public_state.issuer_key_id(),
            issuer_key,
        )
        .map_err(candidate_derivation_error)?;
    if verified_public_state.unavailable_role() != managed_role || capability.role() != managed_role
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore forward-refresh authorization does not belong to this Deriver",
        ));
    }

    let active_receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(
        verified_public_state
            .state()
            .active()
            .activation_receipt_bytes(),
    )
    .map_err(candidate_derivation_error)?;
    let verified_active_receipt = active_receipt
        .verify_issuer_signature(issuer_key)
        .map_err(candidate_derivation_error)?;
    if verified_active_receipt.digest() != capability.activation_receipt_digest() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore capability does not match the public state's active receipt",
        ));
    }
    let active_control_plane_revision = verified_active_receipt.result_control_plane_revision();
    let active_pair =
        TenantRootActiveRootPairV1::from_verified_activation_receipt(&verified_active_receipt)
            .map_err(candidate_derivation_error)?;

    let command_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root managed-restore forward-refresh command",
        &request.role_refresh_command_b64u,
    )?;
    let raw_command = TenantRootRoleRefreshCommandV1::decode_canonical_bytes(&command_bytes)
        .map_err(candidate_derivation_error)?;
    let context_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root managed-restore forward-refresh context",
        &request.refresh_context_b64u,
    )?;
    let context = TenantRootCeremonyContextV1::decode_canonical_bytes(&context_bytes)
        .map_err(candidate_derivation_error)?;
    validate_raw_refresh_context_binding_v1(&raw_command, &context, role)?;
    let authority_id =
        host.creation_authority_id(raw_command.identity_digest(), raw_command.custody_lineage())?;
    if raw_command.authority_id() != authority_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore forward-refresh command names a foreign control-plane authority",
        ));
    }

    let role_keys =
        crate::env::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(reader)?;
    let (_, role_signer) =
        crate::env::load_tenant_root_creation_role_signing_key_v1(worker_role, reader)?;
    if context.signing_key_id(role) != role_signer.signing_key_id() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore forward-refresh context does not name this Deriver's active role signer",
        ));
    }
    let command_issuer_key = issuer_keys
        .for_issuer_key_id(raw_command.issuer_key_id())
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root managed-restore forward-refresh command issuer is not trusted by this Deriver",
            )
        })?;
    let command = raw_command
        .verify(
            &active_pair,
            &context,
            role,
            active_control_plane_revision,
            authority_id,
            raw_command.issuer_key_id(),
            command_issuer_key,
        )
        .map_err(candidate_derivation_error)?;

    let store = host
        .role_store()
        .map_err(|error| tenant_root_store_error_v1("tenant-root role store lookup", error))?;
    let (admission, replay_seed) =
        match store
            .admit_refresh(&command, now_ms)
            .await
            .map_err(|error| {
                tenant_root_store_error_v1(
                    "tenant-root managed-restore forward-refresh admission",
                    error,
                )
            })? {
            CloudflareTenantRootRefreshAdmissionDecisionV1::Execute {
                admission,
                durable_state,
            } => {
                context
                    .validate_at(now_ms)
                    .map_err(candidate_derivation_error)?;
                command
                    .require_fresh(now_ms)
                    .map_err(candidate_derivation_error)?;
                let seed = store
                    .open_refresh_seed(&command, &durable_state)
                    .map_err(|error| tenant_root_store_error_v1("refresh replay seed", error))?;
                (admission, seed)
            }
            CloudflareTenantRootRefreshAdmissionDecisionV1::ResumeExecution {
                admission,
                durable_state,
            } => {
                validate_refresh_admitted_state_v1(&command, &durable_state)?;
                let seed = store
                    .open_refresh_seed(&command, &durable_state)
                    .map_err(|error| tenant_root_store_error_v1("refresh replay seed", error))?;
                (admission, seed)
            }
            CloudflareTenantRootRefreshAdmissionDecisionV1::ResumeCompletion {
                admission,
                durable_state,
            } => {
                return resume_tenant_root_refresh_completion_v1(
                    host,
                    role,
                    &command,
                    admission,
                    durable_state,
                    &role_keys,
                    &role_signer,
                    &store,
                    now_ms,
                )
                .await;
            }
            CloudflareTenantRootRefreshAdmissionDecisionV1::ReplayCompleted {
                receipt_bytes,
                durable_state,
            } => {
                return replay_completed_tenant_root_refresh_v1(
                    host,
                    role,
                    &command,
                    receipt_bytes,
                    durable_state,
                )
                .await;
            }
            CloudflareTenantRootRefreshAdmissionDecisionV1::ReplayFailed { .. } => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ReplayedLocalRequest,
                    "tenant-root managed-restore forward refresh previously failed",
                ));
            }
        };
    let restored_pending = store
        .load_epoch_by_identity_digest(
            capability.identity_digest(),
            capability.custody_lineage(),
            capability.epoch(),
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1(
                "tenant-root managed-restore forward-refresh source lookup",
                error,
            )
        })?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root managed-restore forward-refresh source pending row does not exist",
            )
        })?;
    let source_provenance = store
        .managed_restore_forward_refresh_provenance(&restored_pending)
        .map_err(|error| {
            tenant_root_store_error_v1(
                "tenant-root managed-restore forward-refresh source provenance",
                error,
            )
        })?;
    if source_provenance.capability_digest() != capability.capability_digest() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore forward-refresh capability does not match its pending source",
        ));
    }
    let expected_binding = match role {
        TwoPartyDeriverRole::DeriverA => active_pair.deriver_a(),
        TwoPartyDeriverRole::DeriverB => active_pair.deriver_b(),
    };
    if restored_pending.record().share_commitment() != expected_binding.share_commitment()
        || restored_pending
            .record()
            .identity()
            .digest()
            .map_err(candidate_derivation_error)?
            != capability.identity_digest()
        || restored_pending.record().custody_lineage() != capability.custody_lineage()
        || restored_pending.record().epoch() != capability.epoch()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore forward-refresh source does not match the verified active pair",
        ));
    }

    let managed_backup = host
        .get_managed_backup(
            crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1::new(
                capability.identity_digest(),
                capability.custody_lineage(),
                managed_role,
                capability.epoch(),
            ),
            &role_signer.verifying_key_bytes(),
        )
        .await?;
    let backup_binding = managed_backup.binding();
    if backup_binding.identity_digest() != capability.identity_digest()
        || backup_binding.custody_lineage() != capability.custody_lineage()
        || backup_binding.role() != managed_role
        || backup_binding.epoch() != capability.epoch()
        || backup_binding.share_commitment() != expected_binding.share_commitment()
        || backup_binding.installation_receipt_digest()
            != source_provenance.installation_receipt_digest()
        || managed_backup.receipt_digest() != source_provenance.backup_receipt_digest()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore forward-refresh backup provenance does not match its source",
        ));
    }
    let source = store
        .load_managed_restore_forward_refresh_source(
            capability.identity_digest(),
            capability.custody_lineage(),
            capability.epoch(),
            source_provenance.capability_digest(),
            managed_backup.receipt_digest(),
            source_provenance.installation_receipt_digest(),
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1(
                "tenant-root managed-restore forward-refresh source verification",
                error,
            )
        })?;
    if source.capability_digest() != capability.capability_digest()
        || source.backup_receipt_digest() != managed_backup.receipt_digest()
        || source.installation_receipt_digest() != backup_binding.installation_receipt_digest()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore forward-refresh source provenance changed during verification",
        ));
    }

    let active_binding = expected_binding.clone();
    let identity = verified_public_state.state().active().identity().clone();
    execute_tenant_root_refresh_from_source_v1(
        host,
        role,
        command,
        context,
        active_pair,
        active_control_plane_revision,
        command_issuer_key,
        active_binding,
        identity,
        source.into_online_role_share_artifact(),
        admission,
        replay_seed,
        &role_keys,
        &role_signer,
        &store,
    )
    .await
}

#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_managed_restore_forward_refresh_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootManagedRestoreForwardRefreshRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    tenant_root_deriver_managed_restore_forward_refresh_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await
}
