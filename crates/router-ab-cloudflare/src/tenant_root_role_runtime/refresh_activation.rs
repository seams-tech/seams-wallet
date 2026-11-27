//! Refresh activation, and the commitment and contribution waits.

use super::*;

/// Verifies and applies one control-plane refresh-swap receipt at its owning
/// Deriver. Only the exact active and pending rows named by the receipt may
/// participate in the atomic role-local epoch swap.
pub async fn tenant_root_deriver_refresh_activation_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootRefreshActivationRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshActivationResponseV1> {
    let worker_role = host.worker_role();
    let role = tenant_root_creation_protocol_role_v1(worker_role)?;
    let receipt_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root refresh activation receipt",
        &request.activation_receipt_b64u,
    )?;
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .map_err(candidate_derivation_error)?;
    if receipt.transition() != TenantRootActivationReceiptTransitionV1::RefreshSwap {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root role activation requires a refresh-swap receipt",
        ));
    }
    let reader = host.env();
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(reader)?;
    let role_keys =
        crate::env::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(reader)?;
    let issuer_key = issuer_keys
        .for_issuer_key_id(receipt.issuer_key_id())
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root refresh activation issuer is not trusted by this Worker",
            )
        })?;
    let verified = receipt
        .verify_issuer_signature(issuer_key)
        .map_err(candidate_derivation_error)?;
    let authority_id =
        host.creation_authority_id(verified.identity_digest(), verified.custody_lineage())?;
    if verified.binding().authority_id() != authority_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation receipt names a foreign control-plane authority",
        ));
    }
    // The Router commits one refresh decision before any Deriver swaps. A
    // Deriver swaps only on that exact receipt, which is judged at its own
    // activation time, so a committed decision is still delivered after its
    // window closes. A signed receipt the Router did not commit is refused.
    require_router_committed_activation_v1(host, issuer_keys.keys(), &verified).await?;

    let store = host
        .role_store()
        .map_err(|error| tenant_root_store_error_v1("tenant-root role store lookup", error))?;
    let active = store
        .load_epoch_by_identity_digest(
            verified.identity_digest(),
            verified.custody_lineage(),
            refresh_activation_current_epoch_v1(&verified)?,
        )
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root active share lookup", error))?;
    let stored_successor = store
        .load_epoch_by_identity_digest(
            verified.identity_digest(),
            verified.custody_lineage(),
            refresh_activation_next_epoch_v1(&verified)?,
        )
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root pending share lookup", error))?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root refresh activation pending share does not exist",
            )
        })?;
    let source_deleted = active.is_none();
    let active_successor_revision = stored_successor.revision();
    let activation_already_applied = match active.as_ref() {
        None => {
            if !matches!(
                stored_successor.record().lifecycle(),
                CloudflareTenantRootRoleShareLifecycleV1::Active(_)
            ) {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "tenant-root managed-restore source is absent without an active successor",
                ));
            }
            if stored_successor
                .active_activation_receipt_bytes()
                .map_err(|error| {
                    tenant_root_store_error_v1(
                        "tenant-root managed-restore activation retry receipt",
                        error,
                    )
                })?
                != receipt_bytes
            {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                    "tenant-root managed-restore activation retry does not match the active successor",
                ));
            }
            true
        }
        Some(active) => match (
            active.record().lifecycle(),
            stored_successor.record().lifecycle(),
        ) {
            (
                CloudflareTenantRootRoleShareLifecycleV1::Retired(_),
                CloudflareTenantRootRoleShareLifecycleV1::Active(_),
            ) => {
                if stored_successor
                    .active_activation_receipt_bytes()
                    .map_err(|error| {
                        tenant_root_store_error_v1(
                            "tenant-root refresh activation retry receipt",
                            error,
                        )
                    })?
                    != receipt_bytes
                {
                    return Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                        "tenant-root refresh activation retry does not match the active successor",
                    ));
                }
                true
            }
            (
                CloudflareTenantRootRoleShareLifecycleV1::Active(_)
                | CloudflareTenantRootRoleShareLifecycleV1::Pending(_),
                CloudflareTenantRootRoleShareLifecycleV1::Pending(_),
            ) => false,
            _ => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "tenant-root refresh activation rows cannot enter or replay the swap",
                ));
            }
        },
    };
    let pending = if activation_already_applied {
        stored_successor
            .refresh_activation_retry_pending()
            .map_err(|error| {
                tenant_root_store_error_v1(
                    "tenant-root refresh activation retry pending row",
                    error,
                )
            })?
    } else {
        stored_successor
    };
    let refresh_artifact_checkpoint = store
        .load_refresh_artifact_checkpoint(&pending)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root refresh artifact checkpoint lookup", error)
        })?;
    let scope = tenant_root_refresh_activation_scope_v1(&verified, &pending, role)?;
    let replay_after_swap = if activation_already_applied && !source_deleted {
        Some(
            store
                .reconcile_activation_after_swap(&scope)
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1(
                        "tenant-root refresh activation replay lookup",
                        error,
                    )
                })?,
        )
    } else {
        None
    };
    let managed_restore_provenance = match active.as_ref() {
        None => None,
        Some(active) => match active.record().lifecycle() {
            CloudflareTenantRootRoleShareLifecycleV1::Pending(_) => Some(
                store
                    .managed_restore_forward_refresh_provenance(active)
                    .map_err(|error| {
                        tenant_root_store_error_v1(
                            "tenant-root managed-restore forward-refresh provenance",
                            error,
                        )
                    })?,
            ),
            CloudflareTenantRootRoleShareLifecycleV1::Active(_) => None,
            CloudflareTenantRootRoleShareLifecycleV1::Retired(_) if activation_already_applied => {
                None
            }
            CloudflareTenantRootRoleShareLifecycleV1::Retired(_) => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "tenant-root refresh activation current row is retired",
                ));
            }
        },
    };
    if managed_restore_provenance.is_none() && !source_deleted {
        validate_tenant_root_refresh_activation_rows_v1(
            &verified,
            active.as_ref().ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "tenant-root refresh activation active share does not exist",
                )
            })?,
            &pending,
            role,
            activation_already_applied,
        )?;
    }

    let (_, role_signer) =
        crate::env::load_tenant_root_creation_role_signing_key_v1(worker_role, host.env())?;
    let managed_backup = verify_refresh_activation_artifact_checkpoint_v1(
        host,
        role,
        &verified,
        &pending,
        &refresh_artifact_checkpoint,
        &issuer_keys,
        &role_keys,
    )
    .await?;
    let identity_digest = verified.identity_digest();
    let custody_lineage = verified.custody_lineage();
    let retired_epoch = refresh_activation_current_epoch_v1(&verified)?;
    let active_epoch = refresh_activation_next_epoch_v1(&verified)?;
    let activation = CloudflareTenantRootActivationV1::with_current_role_backup(
        pending.record(),
        &managed_backup,
        verified,
    )
    .map_err(|error| {
        tenant_root_store_error_v1("tenant-root refresh activation evidence", error)
    })?;
    let activation_receipt_bytes = activation.activation_receipt_bytes().to_vec();
    let activation_for_completion = activation.clone();
    let activated_at_ms = activation.activated_at_ms();
    let updated_at_ms = now_ms.max(activated_at_ms);
    if source_deleted {
        let replay = store
            .reconcile_activation_after_swap(&scope)
            .await
            .map_err(|error| {
                tenant_root_store_error_v1(
                    "tenant-root managed-restore activation replay lookup",
                    error,
                )
            })?;
        let terminal_bytes = match replay {
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => {
                let terminal_receipt = role_signer
                    .sign_verified_success_terminal_receipt(
                        &executed,
                        &activation_receipt_bytes,
                        updated_at_ms,
                    )
                    .map_err(candidate_derivation_error)?;
                match store
                    .complete_managed_restore_forward_refresh(
                        executed,
                        &activation_for_completion,
                        terminal_receipt,
                    )
                    .await
                    .map_err(|error| {
                        tenant_root_store_error_v1(
                            "tenant-root managed-restore activation retry completion",
                            error,
                        )
                    })? {
                    CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes }
                    | CloudflareTenantRootCommandTerminalCommitV1::Replay { receipt_bytes } => {
                        receipt_bytes
                    }
                }
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => {
                receipt_bytes
            }
            CloudflareTenantRootCommandReplayDecisionV1::Execute { .. }
            | CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { .. }
            | CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "tenant-root managed-restore activation replay has no consumed-source checkpoint",
                ));
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed { .. } => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ReplayedLocalRequest,
                    "tenant-root managed-restore activation previously failed",
                ));
            }
        };
        return Ok(CloudflareDeriverTenantRootRefreshActivationResponseV1 {
            role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
            activation_terminal_receipt_b64u: crate::encode_base64url_bytes_v1(&terminal_bytes),
            // Both the staged source and its independently inserted refresh row
            // start at revision one; the source is consumed before a retry can
            // observe this successor.
            retired_epoch: retired_epoch.get().get(),
            retired_revision: pending.revision(),
            active_epoch: active_epoch.get().get(),
            active_revision: active_successor_revision,
        });
    }
    if let Some(replay) = replay_after_swap {
        let terminal_bytes = match replay {
            CloudflareTenantRootCommandReplayDecisionV1::ResumeCompletion { executed } => {
                let terminal_receipt = role_signer
                    .sign_verified_success_terminal_receipt(
                        &executed,
                        &activation_receipt_bytes,
                        updated_at_ms,
                    )
                    .map_err(candidate_derivation_error)?;
                match store
                    .complete_activation(executed, &activation_for_completion, terminal_receipt)
                    .await
                    .map_err(|error| {
                        tenant_root_store_error_v1(
                            "tenant-root refresh activation retry completion",
                            error,
                        )
                    })? {
                    CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes }
                    | CloudflareTenantRootCommandTerminalCommitV1::Replay { receipt_bytes } => {
                        receipt_bytes
                    }
                }
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayCompleted { receipt_bytes } => {
                receipt_bytes
            }
            CloudflareTenantRootCommandReplayDecisionV1::Execute { .. }
            | CloudflareTenantRootCommandReplayDecisionV1::ResumeExecution { .. }
            | CloudflareTenantRootCommandReplayDecisionV1::InProgress => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "tenant-root refresh activation replay has no executed lifecycle checkpoint",
                ));
            }
            CloudflareTenantRootCommandReplayDecisionV1::ReplayFailed { .. } => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ReplayedLocalRequest,
                    "tenant-root refresh activation previously failed",
                ));
            }
        };
        return load_cloudflare_deriver_tenant_root_refresh_activation_response_v1(
            &store,
            role,
            identity_digest,
            custody_lineage,
            retired_epoch,
            active_epoch,
            &receipt_bytes,
            terminal_bytes,
        )
        .await;
    }
    let active = active.ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root refresh activation active share does not exist",
        )
    })?;
    if let Some(provenance) = managed_restore_provenance {
        return complete_managed_restore_forward_refresh_activation_v1(
            &store,
            scope,
            active,
            pending,
            activation,
            provenance,
            &role_signer,
            updated_at_ms,
            now_ms,
        )
        .await;
    }
    let retirement = CloudflareTenantRootRetirementV1::new(
        activation.activation_receipt_digest(),
        updated_at_ms,
    )
    .map_err(|error| tenant_root_store_error_v1("tenant-root refresh retirement", error))?;
    let decision = store
        .reserve_swap_active_epoch(
            scope,
            active,
            pending,
            activation,
            retirement,
            updated_at_ms,
            now_ms,
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root refresh swap reservation", error)
        })?;
    let terminal_bytes = match decision {
        crate::tenant_root_role_d1::CloudflareTenantRootSwapActiveEpochDecisionV1::Execute {
            command,
        }
        | crate::tenant_root_role_d1::CloudflareTenantRootSwapActiveEpochDecisionV1::ResumeExecution {
            command,
        } => {
            let (_, executed) = store
                .swap_active_epoch(command, now_ms)
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1("tenant-root refresh swap execution", error)
                })?;
            let terminal_receipt = role_signer
                .sign_verified_success_terminal_receipt(
                    &executed,
                    &activation_receipt_bytes,
                    updated_at_ms,
                )
                .map_err(candidate_derivation_error)?;
            let terminal = store
                .complete_activation(executed, &activation_for_completion, terminal_receipt)
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1(
                        "tenant-root refresh activation completion",
                        error,
                    )
                })?;
            match terminal {
                crate::tenant_root_role_d1::CloudflareTenantRootCommandTerminalCommitV1::Committed {
                    receipt_bytes,
                }
                | crate::tenant_root_role_d1::CloudflareTenantRootCommandTerminalCommitV1::Replay {
                    receipt_bytes,
                } => receipt_bytes,
            }
        }
        crate::tenant_root_role_d1::CloudflareTenantRootSwapActiveEpochDecisionV1::ResumeCompletion {
            executed,
        } => {
            let terminal_receipt = role_signer
                .sign_verified_success_terminal_receipt(
                    &executed,
                    &activation_receipt_bytes,
                    updated_at_ms,
                )
                .map_err(candidate_derivation_error)?;
            let terminal = store
                .complete_activation(executed, &activation_for_completion, terminal_receipt)
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1(
                        "tenant-root refresh activation completion",
                        error,
                    )
                })?;
            match terminal {
                crate::tenant_root_role_d1::CloudflareTenantRootCommandTerminalCommitV1::Committed {
                    receipt_bytes,
                }
                | crate::tenant_root_role_d1::CloudflareTenantRootCommandTerminalCommitV1::Replay {
                    receipt_bytes,
                } => receipt_bytes,
            }
        }
        crate::tenant_root_role_d1::CloudflareTenantRootSwapActiveEpochDecisionV1::ReplayCompleted {
            receipt_bytes,
        } => receipt_bytes,
        crate::tenant_root_role_d1::CloudflareTenantRootSwapActiveEpochDecisionV1::InProgress => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root refresh activation is already in progress",
            ));
        }
        crate::tenant_root_role_d1::CloudflareTenantRootSwapActiveEpochDecisionV1::ReplayFailed {
            ..
        } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root refresh activation previously failed",
            ));
        }
    };
    load_cloudflare_deriver_tenant_root_refresh_activation_response_v1(
        &store,
        role,
        identity_digest,
        custody_lineage,
        retired_epoch,
        active_epoch,
        &receipt_bytes,
        terminal_bytes,
    )
    .await
}

pub(super) async fn load_cloudflare_deriver_tenant_root_refresh_activation_response_v1<S: RoleSqlSessionV1>(
    store: &TenantRootRoleShareStoreV1<S>,
    role: TwoPartyDeriverRole,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    retired_epoch: TenantRootShareEpoch,
    active_epoch: TenantRootShareEpoch,
    activation_receipt_bytes: &[u8],
    terminal_bytes: Vec<u8>,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshActivationResponseV1> {
    let retired = store
        .load_epoch_by_identity_digest(identity_digest, custody_lineage, retired_epoch)
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root retired share reload", error))?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root refresh swap did not retain its retired row",
            )
        })?;
    let active = store
        .load_epoch_by_identity_digest(identity_digest, custody_lineage, active_epoch)
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root active share reload", error))?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root refresh swap did not retain its active successor",
            )
        })?;
    if active.active_activation_receipt_bytes().map_err(|error| {
        tenant_root_store_error_v1("tenant-root active successor receipt", error)
    })? != activation_receipt_bytes
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root active successor does not retain the refresh activation receipt",
        ));
    }
    Ok(CloudflareDeriverTenantRootRefreshActivationResponseV1 {
        role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
        activation_terminal_receipt_b64u: crate::encode_base64url_bytes_v1(&terminal_bytes),
        retired_epoch: retired_epoch.get().get(),
        retired_revision: retired.revision(),
        active_epoch: active_epoch.get().get(),
        active_revision: active.revision(),
    })
}

pub(super) async fn complete_managed_restore_forward_refresh_activation_v1<S: RoleSqlSessionV1>(
    store: &TenantRootRoleShareStoreV1<S>,
    scope: TenantRootCommandScopeV1,
    restored_pending: CloudflareStoredTenantRootRoleShareV1,
    refresh_pending: CloudflareStoredTenantRootRoleShareV1,
    activation: CloudflareTenantRootActivationV1,
    provenance: CloudflareTenantRootManagedRestoreForwardRefreshProvenanceV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
    updated_at_ms: u64,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshActivationResponseV1> {
    let identity_digest = restored_pending
        .record()
        .identity()
        .digest()
        .map_err(candidate_derivation_error)?;
    let custody_lineage = restored_pending.record().custody_lineage();
    let restored_epoch = restored_pending.record().epoch();
    let restored_revision = restored_pending.revision();
    let active_epoch = refresh_pending.record().epoch();
    let activation_receipt_bytes = activation.activation_receipt_bytes().to_vec();
    let activation_for_completion = activation.clone();
    let decision = store
        .reserve_managed_restore_forward_refresh(
            scope,
            restored_pending,
            refresh_pending,
            activation,
            provenance.capability_digest(),
            provenance.backup_receipt_digest(),
            provenance.installation_receipt_digest(),
            updated_at_ms,
            now_ms,
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1(
                "tenant-root managed-restore forward-refresh activation reservation",
                error,
            )
        })?;
    let terminal_bytes = match decision {
        CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::Execute { command }
        | CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ResumeExecution { command } =>
        {
            let (_, executed) = store
                .execute_managed_restore_forward_refresh(command, now_ms)
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1(
                        "tenant-root managed-restore forward-refresh activation execution",
                        error,
                    )
                })?;
            let terminal_receipt = role_signer
                .sign_verified_success_terminal_receipt(
                    &executed,
                    &activation_receipt_bytes,
                    updated_at_ms,
                )
                .map_err(candidate_derivation_error)?;
            match store
                .complete_managed_restore_forward_refresh(
                    executed,
                    &activation_for_completion,
                    terminal_receipt,
                )
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1(
                        "tenant-root managed-restore forward-refresh activation completion",
                        error,
                    )
                })? {
                CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes }
                | CloudflareTenantRootCommandTerminalCommitV1::Replay { receipt_bytes } => {
                    receipt_bytes
                }
            }
        }
        CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ResumeCompletion {
            executed,
        } => {
            let terminal_receipt = role_signer
                .sign_verified_success_terminal_receipt(
                    &executed,
                    &activation_receipt_bytes,
                    updated_at_ms,
                )
                .map_err(candidate_derivation_error)?;
            match store
                .complete_managed_restore_forward_refresh(
                    executed,
                    &activation_for_completion,
                    terminal_receipt,
                )
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1(
                        "tenant-root managed-restore forward-refresh activation completion",
                        error,
                    )
                })? {
                CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes }
                | CloudflareTenantRootCommandTerminalCommitV1::Replay { receipt_bytes } => {
                    receipt_bytes
                }
            }
        }
        CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ReplayCompleted {
            receipt_bytes,
        } => receipt_bytes,
        CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::InProgress => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root managed-restore forward refresh activation is already in progress",
            ));
        }
        CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::ReplayFailed { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root managed-restore forward refresh activation previously failed",
            ));
        }
    };
    if store
        .load_epoch_by_identity_digest(identity_digest, custody_lineage, restored_epoch)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1(
                "tenant-root managed-restore forward-refresh source reload",
                error,
            )
        })?
        .is_some()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root managed-restore forward-refresh source was not deleted",
        ));
    }
    let active = store
        .load_epoch_by_identity_digest(identity_digest, custody_lineage, active_epoch)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1(
                "tenant-root managed-restore forward-refresh active reload",
                error,
            )
        })?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root managed-restore forward refresh did not retain its active successor",
            )
        })?;
    if active.active_activation_receipt_bytes().map_err(|error| {
        tenant_root_store_error_v1(
            "tenant-root managed-restore forward-refresh active receipt",
            error,
        )
    })? != activation_for_completion.activation_receipt_bytes()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore forward-refresh active successor receipt changed",
        ));
    }
    Ok(CloudflareDeriverTenantRootRefreshActivationResponseV1 {
        role: CloudflareTenantRootCreateRoleV1::from_protocol(role_signer.role()),
        activation_terminal_receipt_b64u: crate::encode_base64url_bytes_v1(&terminal_bytes),
        retired_epoch: restored_epoch.get().get(),
        retired_revision: restored_revision,
        active_epoch: active_epoch.get().get(),
        active_revision: active.revision(),
    })
}

pub(super) fn refresh_activation_current_epoch_v1(
    activation: &router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
) -> RouterAbProtocolResult<TenantRootShareEpoch> {
    let router_ab_core::TenantRootActivationReceiptBindingV1::RefreshSwap(binding) =
        activation.binding()
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation requires a refresh-swap receipt",
        ));
    };
    Ok(binding.current_epoch())
}

pub(super) fn refresh_activation_next_epoch_v1(
    activation: &router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
) -> RouterAbProtocolResult<TenantRootShareEpoch> {
    let router_ab_core::TenantRootActivationReceiptBindingV1::RefreshSwap(binding) =
        activation.binding()
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation requires a refresh-swap receipt",
        ));
    };
    Ok(binding.next_epoch())
}

pub(super) fn decode_refresh_commitment_pair_v1(
    outcome: &CloudflareTenantRootRefreshCommitmentResponseOutcomeV1,
    context: &TenantRootCeremonyContextV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<Option<VerifiedTenantRootRefreshCommitmentPairV1>> {
    let CloudflareTenantRootRefreshCommitmentResponseOutcomeV1::BothRolesCommitted {
        deriver_a_signed_commitment_b64u,
        deriver_b_signed_commitment_b64u,
        ..
    } = outcome
    else {
        return Ok(None);
    };
    let decode =
        |field: &str, encoded: &str, role: TwoPartyDeriverRole| -> RouterAbProtocolResult<_> {
            let bytes = crate::decode_base64url_bytes_v1(field, encoded)?;
            let key = role_keys.for_role_and_key_id(role, context.signing_key_id(role))?;
            TenantRootSignedRefreshCommitmentV1::decode_and_verify_canonical_bytes(
                &bytes,
                context,
                role,
                context.signing_key_id(role),
                key,
            )
            .map_err(candidate_derivation_error)
        };
    VerifiedTenantRootRefreshCommitmentPairV1::new(
        decode(
            "tenant-root Deriver A refresh commitment",
            deriver_a_signed_commitment_b64u,
            TwoPartyDeriverRole::DeriverA,
        )?,
        decode(
            "tenant-root Deriver B refresh commitment",
            deriver_b_signed_commitment_b64u,
            TwoPartyDeriverRole::DeriverB,
        )?,
    )
    .map(Some)
    .map_err(candidate_derivation_error)
}

pub(super) async fn await_refresh_commitment_pair_v1(
    state: &impl TenantRootCreationStateTransportV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    pending: &PendingTenantRootRefreshRoleAttemptV1,
    context: &TenantRootCeremonyContextV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootRefreshCommitmentPairV1> {
    for _ in 0..32 {
        let response = tenant_root_refresh_commitment_call_v1(
            state,
            command,
            pending.commitment(),
        )
        .await?;
        if let Some(pair) =
            decode_refresh_commitment_pair_v1(&response.outcome, context, role_keys)?
        {
            return Ok(pair);
        }
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLifecycleState,
        "tenant-root refresh commitment rendezvous did not receive both roles",
    ))
}

pub(super) fn peer_refresh_contribution_v1(
    outcome: &CloudflareTenantRootRefreshContributionResponseOutcomeV1,
    role: TwoPartyDeriverRole,
    pair: &VerifiedTenantRootRefreshCommitmentPairV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    recipient: &TenantRootRefreshHpkeKeypairV1,
) -> RouterAbProtocolResult<Option<RootShareRefreshContributionWire>> {
    let CloudflareTenantRootRefreshContributionResponseOutcomeV1::BothRolesContributed {
        deriver_a_signed_contribution_b64u,
        deriver_b_signed_contribution_b64u,
    } = outcome
    else {
        return Ok(None);
    };
    let (encoded, peer_role, aad) = match role {
        TwoPartyDeriverRole::DeriverA => (
            deriver_b_signed_contribution_b64u,
            TwoPartyDeriverRole::DeriverB,
            TenantRootRefreshContributionAadV1::deriver_b_to_a(pair),
        ),
        TwoPartyDeriverRole::DeriverB => (
            deriver_a_signed_contribution_b64u,
            TwoPartyDeriverRole::DeriverA,
            TenantRootRefreshContributionAadV1::deriver_a_to_b(pair),
        ),
    };
    let aad = aad.map_err(candidate_derivation_error)?;
    let bytes =
        crate::decode_base64url_bytes_v1("tenant-root peer signed refresh contribution", encoded)?;
    let signed = TenantRootSignedRefreshContributionV1::decode_canonical_bytes(&bytes)
        .map_err(candidate_derivation_error)?;
    let peer_key =
        role_keys.for_role_and_key_id(peer_role, pair.context().signing_key_id(peer_role))?;
    signed
        .verify_and_open(&aad, peer_key, recipient)
        .map(Some)
        .map_err(candidate_derivation_error)
}

pub(super) async fn await_peer_refresh_contribution_v1(
    state: &impl TenantRootCreationStateTransportV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    signed: &router_ab_core::VerifiedTenantRootSignedRefreshContributionV1,
    role: TwoPartyDeriverRole,
    pair: &VerifiedTenantRootRefreshCommitmentPairV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    recipient: &TenantRootRefreshHpkeKeypairV1,
) -> RouterAbProtocolResult<RootShareRefreshContributionWire> {
    for _ in 0..32 {
        let response = tenant_root_refresh_contribution_call_v1(
            state, role_keys, command, pair, signed,
        )
        .await?;
        if let Some(contribution) =
            peer_refresh_contribution_v1(&response.outcome, role, pair, role_keys, recipient)?
        {
            return Ok(contribution);
        }
    }
    Err(RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLifecycleState,
        "tenant-root refresh contribution rendezvous did not receive both roles",
    ))
}

pub(super) fn validate_raw_refresh_context_binding_v1(
    command: &TenantRootRoleRefreshCommandV1,
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
) -> RouterAbProtocolResult<()> {
    context.validate().map_err(candidate_derivation_error)?;
    let epochs_match = matches!(
        context.epochs(),
        TenantRootCeremonyEpochsV1::Refresh { current, next }
            if current == command.current_epoch() && next == command.next_epoch()
    );
    if command.role() != role
        || context.identity_digest() != command.identity_digest()
        || context.custody_lineage() != command.custody_lineage()
        || context.session_id() != command.session_id()
        || context.nonce() != command.nonce()
        || !epochs_match
        || context.digest().map_err(candidate_derivation_error)? != command.refresh_context_digest()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh command does not belong to its exact context",
        ));
    }
    Ok(())
}

pub(super) fn verify_refresh_command_from_persisted_raw_v1(
    raw_command: &TenantRootRoleRefreshCommandV1,
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    issuer_keys: &CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootRoleRefreshCommandV1> {
    let identity_digest = raw_command.identity_digest();
    let custody_lineage = raw_command.custody_lineage();
    let current_epoch = raw_command.current_epoch();
    let activation_receipt_digest = raw_command.active_activation_receipt_digest();
    let deriver_a = TenantRootActiveRoleBindingV1::new(
        TenantRootActiveRoleRowKeyV1::new(
            identity_digest,
            custody_lineage,
            current_epoch,
            TenantRootManagedRestoreRoleV1::DeriverA,
        ),
        raw_command.deriver_a_share_commitment().clone(),
        activation_receipt_digest,
    )
    .map_err(candidate_derivation_error)?;
    let deriver_b = TenantRootActiveRoleBindingV1::new(
        TenantRootActiveRoleRowKeyV1::new(
            identity_digest,
            custody_lineage,
            current_epoch,
            TenantRootManagedRestoreRoleV1::DeriverB,
        ),
        raw_command.deriver_b_share_commitment().clone(),
        activation_receipt_digest,
    )
    .map_err(candidate_derivation_error)?;
    let active_pair = resolve_active_tenant_root_pair_binding_v1(
        identity_digest,
        &TenantRootActiveRoleResolutionV1::Active(deriver_a),
        &TenantRootActiveRoleResolutionV1::Active(deriver_b),
    )
    .map_err(candidate_derivation_error)?
    .require_active()
    .map_err(candidate_derivation_error)?
    .clone();
    let issuer_verifying_key = issuer_keys
        .for_issuer_key_id(raw_command.issuer_key_id())
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root refresh command issuer is not trusted",
            )
        })?;
    raw_command
        .verify(
            &active_pair,
            context,
            role,
            raw_command.expected_control_plane_revision(),
            authority_id,
            raw_command.issuer_key_id(),
            issuer_verifying_key,
        )
        .map_err(candidate_derivation_error)
}

pub(super) fn validate_refresh_admitted_state_v1(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    durable_state: &CloudflareTenantRootRefreshDurableStateV1,
) -> RouterAbProtocolResult<()> {
    if !matches!(
        durable_state,
        CloudflareTenantRootRefreshDurableStateV1::Admitted { .. }
    ) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root refresh reservation has an unexpected durable state",
        ));
    }
    let command_bytes = durable_state.command_bytes().map_err(|error| {
        tenant_root_store_error_v1("tenant-root refresh durable command", error)
    })?;
    if command_bytes != command.canonical_bytes() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh reservation command bytes changed",
        ));
    }
    Ok(())
}
