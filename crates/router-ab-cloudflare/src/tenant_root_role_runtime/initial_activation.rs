//! Initial activation and restore-session cleanup on the Deriver.

use super::*;

pub(super) fn tenant_root_initial_activation_scope_v1(
    activation_receipt: &VerifiedTenantRootSignedActivationReceiptV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
) -> RouterAbProtocolResult<TenantRootCommandScopeV1> {
    if !matches!(
        activation_receipt.binding(),
        router_ab_core::TenantRootActivationReceiptBindingV1::InitialCreation(_)
    ) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root initial activation requires an initial-creation receipt",
        ));
    }
    let record = pending.record();
    let identity_digest = record
        .identity()
        .digest()
        .map_err(candidate_derivation_error)?;
    if activation_receipt.identity_digest() != identity_digest
        || activation_receipt.custody_lineage() != record.custody_lineage()
        || record.epoch() != TenantRootShareEpoch::INITIAL
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root initial activation receipt does not match its pending role share",
        ));
    }

    let role_tag = match record.role() {
        CloudflareTenantRootDeriverRoleV1::DeriverA => 1_u8,
        CloudflareTenantRootDeriverRoleV1::DeriverB => 2_u8,
    };
    let mut scope_material = Vec::with_capacity(32 + 32 + 16 + 8 + 8 + 1);
    scope_material.extend_from_slice(b"seams/tenant-root/initial-activation-scope/v1");
    scope_material.extend_from_slice(activation_receipt.digest().as_bytes());
    scope_material.extend_from_slice(identity_digest.as_bytes());
    scope_material.extend_from_slice(record.custody_lineage().as_bytes());
    scope_material.extend_from_slice(&record.epoch().get().get().to_be_bytes());
    scope_material.extend_from_slice(&pending.revision().to_be_bytes());
    scope_material.push(role_tag);

    let mut session_material = scope_material.clone();
    session_material.extend_from_slice(b"/session");
    let session_digest = Sha256::digest(&session_material);
    let mut session_bytes = [0_u8; 16];
    session_bytes.copy_from_slice(&session_digest[..16]);
    let session_id = TenantRootCeremonySessionIdV1::from_bytes(session_bytes)
        .map_err(candidate_derivation_error)?;

    scope_material.extend_from_slice(b"/nonce");
    let nonce_digest = Sha256::digest(&scope_material);
    let mut nonce_bytes = [0_u8; 32];
    nonce_bytes.copy_from_slice(&nonce_digest);
    let nonce =
        TenantRootCeremonyNonceV1::from_bytes(nonce_bytes).map_err(candidate_derivation_error)?;

    let key = match record.role() {
        CloudflareTenantRootDeriverRoleV1::DeriverA => TenantRootCommandReplayKeyV1::deriver_a(
            identity_digest,
            record.custody_lineage(),
            session_id,
            nonce,
        ),
        CloudflareTenantRootDeriverRoleV1::DeriverB => TenantRootCommandReplayKeyV1::deriver_b(
            identity_digest,
            record.custody_lineage(),
            session_id,
            nonce,
        ),
    };
    TenantRootCommandScopeV1::new(
        key,
        record.epoch(),
        activation_receipt.expected_control_plane_revision(),
    )
    .map_err(candidate_derivation_error)
}

/// Activates one exact role-local epoch-one pending share from verified
/// control-plane evidence and the role's managed backup.
pub(super) fn initial_activation_pending_v1(
    stored: CloudflareStoredTenantRootRoleShareV1,
    activation_receipt: &VerifiedTenantRootSignedActivationReceiptV1,
    now_ms: u64,
) -> RouterAbProtocolResult<(bool, CloudflareStoredTenantRootRoleShareV1, u64)> {
    let active_retry = matches!(
        stored.record().lifecycle(),
        CloudflareTenantRootRoleShareLifecycleV1::Active(_)
    );
    let (pending, updated_at_ms) = match stored.record().lifecycle() {
        CloudflareTenantRootRoleShareLifecycleV1::Pending(_) => (stored, now_ms),
        CloudflareTenantRootRoleShareLifecycleV1::Active(_) => {
            if stored.active_activation_receipt_bytes().map_err(|error| {
                tenant_root_store_error_v1("tenant-root activation retry", error)
            })? != activation_receipt.canonical_bytes()
            {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                    "tenant-root activation retry does not match the stored activation receipt",
                ));
            }
            let updated_at_ms = stored.record().updated_at_ms();
            let pending = stored.initial_activation_retry_pending().map_err(|error| {
                tenant_root_store_error_v1("tenant-root activation retry", error)
            })?;
            (pending, updated_at_ms)
        }
        CloudflareTenantRootRoleShareLifecycleV1::Retired(_) => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root initial activation cannot retry a retired role share",
            ));
        }
    };
    Ok((active_retry, pending, updated_at_ms))
}

pub(super) async fn prepare_initial_activation_v1<S: RoleSqlSessionV1>(
    store: &TenantRootRoleShareStoreV1<S>,
    activation_receipt: &VerifiedTenantRootSignedActivationReceiptV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
    active_retry: bool,
    now_ms: u64,
) -> RouterAbProtocolResult<TenantRootCommandScopeV1> {
    let scope = tenant_root_initial_activation_scope_v1(activation_receipt, pending)?;
    let replay_exists = store
        .activation_replay_exists(&scope)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root activation replay lookup", error)
        })?;
    if active_retry && !replay_exists {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root active role share has no matching activation replay record",
        ));
    }
    if !replay_exists {
        activation_receipt
            .require_fresh(now_ms)
            .map_err(candidate_derivation_error)?;
    }
    Ok(scope)
}

/// Activates the role's pending initial share. `decided_at_ms` is the time at
/// which the receipt's freshness is judged: the Router's committed decision.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn persist_tenant_root_initial_activation_v1<S: RoleSqlSessionV1>(
    store: &TenantRootRoleShareStoreV1<S>,
    stored: CloudflareStoredTenantRootRoleShareV1,
    managed_backup: &VerifiedTenantRootManagedBackupV1,
    activation_receipt: VerifiedTenantRootSignedActivationReceiptV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
    decided_at_ms: u64,
    now_ms: u64,
) -> RouterAbProtocolResult<Vec<u8>> {
    let (active_retry, pending, updated_at_ms) =
        initial_activation_pending_v1(stored, &activation_receipt, now_ms)?;
    let scope = prepare_initial_activation_v1(
        store,
        &activation_receipt,
        &pending,
        active_retry,
        decided_at_ms,
    )
    .await?;
    let activation = CloudflareTenantRootActivationV1::with_current_role_backup(
        pending.record(),
        managed_backup,
        activation_receipt,
    )
    .map_err(|error| tenant_root_store_error_v1("tenant-root activation evidence", error))?;
    persist_tenant_root_initial_activation_after_validation_v1(
        store,
        pending,
        updated_at_ms,
        scope,
        activation,
        role_signer,
        now_ms,
    )
    .await
}

pub(super) async fn persist_tenant_root_initial_activation_after_validation_v1<S: RoleSqlSessionV1>(
    store: &TenantRootRoleShareStoreV1<S>,
    pending: CloudflareStoredTenantRootRoleShareV1,
    updated_at_ms: u64,
    scope: TenantRootCommandScopeV1,
    activation: CloudflareTenantRootActivationV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
    now_ms: u64,
) -> RouterAbProtocolResult<Vec<u8>> {
    let activation_for_completion = activation.clone();
    let decision = store
        .reserve_activate_initial_pending(scope, pending, activation, updated_at_ms, now_ms)
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root activation reservation", error))?;
    let executed = match decision {
        CloudflareTenantRootActivateInitialPendingDecisionV1::Execute { command }
        | CloudflareTenantRootActivateInitialPendingDecisionV1::ResumeExecution { command } => {
            store
                .activate_initial_pending(command, now_ms)
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1("tenant-root activation execution", error)
                })?
                .1
        }
        CloudflareTenantRootActivateInitialPendingDecisionV1::ResumeCompletion { executed } => {
            executed
        }
        CloudflareTenantRootActivateInitialPendingDecisionV1::ReplayCompleted { receipt_bytes } => {
            return Ok(receipt_bytes);
        }
        CloudflareTenantRootActivateInitialPendingDecisionV1::InProgress => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root activation is already in progress",
            ));
        }
        CloudflareTenantRootActivateInitialPendingDecisionV1::ReplayFailed { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root activation previously failed",
            ));
        }
    };
    let receipt = role_signer
        .sign_verified_success_terminal_receipt(
            &executed,
            activation_for_completion.activation_receipt_bytes(),
            now_ms,
        )
        .map_err(candidate_derivation_error)?;
    let terminal = store
        .complete_activation(executed, &activation_for_completion, receipt)
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root activation completion", error))?;
    match terminal {
        crate::tenant_root_role_d1::CloudflareTenantRootCommandTerminalCommitV1::Committed {
            receipt_bytes,
        }
        | crate::tenant_root_role_d1::CloudflareTenantRootCommandTerminalCommitV1::Replay {
            receipt_bytes,
        } => Ok(receipt_bytes),
    }
}

/// Verifies and applies one control-plane initial-activation receipt at its
/// owning Deriver. The request contains no caller-selected storage selector.
pub async fn tenant_root_deriver_initial_activation_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootInitialActivationRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootInitialActivationResponseV1> {
    let worker_role = host.worker_role();
    let role = tenant_root_creation_protocol_role_v1(worker_role)?;
    let receipt_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root initial activation receipt",
        &request.activation_receipt_b64u,
    )?;
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .map_err(candidate_derivation_error)?;
    if receipt.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root role activation requires an initial-creation receipt",
        ));
    }
    let reader = host.env();
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(reader)?;
    let issuer_key = issuer_keys
        .for_issuer_key_id(receipt.issuer_key_id())
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root activation receipt issuer is not trusted by this Worker",
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
            "tenant-root activation receipt names a foreign control-plane authority",
        ));
    }

    let store = host
        .role_store()
        .map_err(|error| tenant_root_store_error_v1("tenant-root role store lookup", error))?;
    let pending = store
        .load_initial_pending_for_activation(verified.identity_digest(), verified.custody_lineage())
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root pending share lookup", error))?;
    let pending_role = match pending.record().role() {
        CloudflareTenantRootDeriverRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        CloudflareTenantRootDeriverRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    };
    if pending_role != role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root pending share belongs to the other Deriver",
        ));
    }

    let (_, role_signer) =
        crate::env::load_tenant_root_creation_role_signing_key_v1(worker_role, reader)?;
    if verified
        .availability()
        .tenant_held_external_provenance()
        .is_some()
    {
        let (active_retry, pending, updated_at_ms) =
            initial_activation_pending_v1(pending, &verified, now_ms)?;
        // Restore promotion is already durable. Resume the signed activation decision
        // at its issuance time even when delivery outlives the original grant.
        let scope = prepare_initial_activation_v1(
            &store,
            &verified,
            &pending,
            active_retry,
            verified.activated_at_ms(),
        )
        .await?;
        let activation = CloudflareTenantRootActivationV1::with_tenant_held_external(
            pending.record(),
            &verified,
        )
        .map_err(|error| tenant_root_store_error_v1("tenant-root activation evidence", error))?;
        let terminal_receipt = persist_tenant_root_initial_activation_after_validation_v1(
            &store,
            pending,
            updated_at_ms,
            scope,
            activation,
            &role_signer,
            now_ms,
        )
        .await?;
        let cleanup_receipt = store
            .close_restore_import_session(&verified, role, now_ms)
            .await
            .map_err(|error| {
                tenant_root_store_error_v1("tenant-root restore-session cleanup", error)
            })?;
        return Ok(CloudflareDeriverTenantRootInitialActivationResponseV1 {
            role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
            activation_terminal_receipt_b64u: crate::encode_base64url_bytes_v1(&terminal_receipt),
            restore_cleanup_receipt_b64u: Some(crate::encode_base64url_bytes_v1(
                cleanup_receipt.bytes(),
            )),
        });
    }

    // The Router's persisted receipt is this creation's commit point. The
    // Deriver activates only on that exact receipt and judges its freshness at
    // the decision's own activation time, so a committed decision is still
    // delivered after its window closes. A signed receipt the Router did not
    // commit is refused at any time.
    require_router_committed_activation_v1(host, issuer_keys.keys(), &verified).await?;
    let decided_at_ms = verified.activated_at_ms();
    let managed_backup = host
        .get_managed_backup(
            crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1::new(
                verified.identity_digest(),
                verified.custody_lineage(),
                tenant_root_managed_restore_role_v1(role),
                TenantRootShareEpoch::INITIAL,
            ),
            &role_signer.verifying_key_bytes(),
        )
        .await?;
    let terminal_receipt = persist_tenant_root_initial_activation_v1(
        &store,
        pending,
        &managed_backup,
        verified,
        &role_signer,
        decided_at_ms,
        now_ms,
    )
    .await?;
    Ok(CloudflareDeriverTenantRootInitialActivationResponseV1 {
        role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
        activation_terminal_receipt_b64u: crate::encode_base64url_bytes_v1(&terminal_receipt),
        restore_cleanup_receipt_b64u: None,
    })
}

/// Requires `receipt` to be byte-identical to the activation the Router has
/// committed for its creation.
pub(super) async fn require_router_committed_activation_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    issuer_keys: &std::collections::BTreeMap<String, [u8; 32]>,
    receipt: &VerifiedTenantRootSignedActivationReceiptV1,
) -> RouterAbProtocolResult<()> {
    let committed = crate::durable_object::tenant_root_creation::tenant_root_creation_active_state_with_revision_read_call_v1(
        host,
        issuer_keys,
        receipt.identity_digest(),
        receipt.custody_lineage(),
    )
    .await?;
    if committed.activation_receipt.canonical_bytes() != receipt.canonical_bytes() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root activation receipt is not the activation the Router committed",
        ));
    }
    Ok(())
}

/// Requires that this refresh is the Router's current attempt for its root.
///
/// The Router keeps one live attempt per root and abandons an attempt before
/// it reserves the next, so while this holds, every older attempt of the same
/// transition is abandoned for good.
pub(super) async fn require_router_current_refresh_attempt_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    issuer_keys: &std::collections::BTreeMap<String, [u8; 32]>,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
) -> RouterAbProtocolResult<()> {
    let active = crate::durable_object::tenant_root_creation::tenant_root_creation_active_state_with_revision_read_call_v1(
        host,
        issuer_keys,
        command.identity_digest(),
        command.custody_lineage(),
    )
    .await?;
    let key = *command.scope().key();
    let current = match &active.refresh_fence {
        crate::durable_object::tenant_root_creation::CloudflareTenantRootRefreshFenceV1::Reserved {
            attempt,
        }
        | crate::durable_object::tenant_root_creation::CloudflareTenantRootRefreshFenceV1::Executed {
            attempt,
        } => {
            attempt.session_id_b64u == crate::encode_base64url_bytes_v1(key.session_id().as_bytes())
                && attempt.nonce_b64u == crate::encode_base64url_bytes_v1(key.nonce().as_bytes())
        }
        _ => false,
    };
    if !current {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "tenant-root refresh attempt is no longer the Router's current attempt",
        ));
    }
    Ok(())
}

/// Verifies and applies one control-plane initial-activation receipt at its
/// owning Deriver.
#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_initial_activation_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootInitialActivationRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootInitialActivationResponseV1> {
    tenant_root_deriver_initial_activation_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await
}

/// Closes one tenant-held restore import session after its initial activation.
/// Tombstoning and secret nulling are performed by the role-private D1 store.
#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_restore_session_cleanup_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreSessionCleanupResponseV1> {
    tenant_root_deriver_restore_session_cleanup_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await
}

/// Closes one tenant-held restore import session after its initial
/// activation, activating the pending share first if its delivery was lost.
pub async fn tenant_root_deriver_restore_session_cleanup_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreSessionCleanupResponseV1> {
    let worker_role = host.worker_role();
    let role = tenant_root_creation_protocol_role_v1(worker_role)?;
    let receipt_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root restore-session activation receipt",
        &request.activation_receipt_b64u,
    )?;
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .map_err(candidate_derivation_error)?;
    if receipt.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-session cleanup requires an initial-creation receipt",
        ));
    }
    if receipt
        .availability()
        .tenant_held_external_provenance()
        .is_none()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-session cleanup requires tenant-held external activation",
        ));
    }
    let reader = host.env();
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(reader)?;
    let issuer_key = issuer_keys
        .for_issuer_key_id(receipt.issuer_key_id())
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root restore-session activation issuer is not trusted by this Worker",
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
            "tenant-root restore-session activation names a foreign control-plane authority",
        ));
    }
    let store = host.role_store()
        .map_err(|error| tenant_root_store_error_v1("tenant-root role store lookup", error))?;
    let mut active = store
        .load_epoch_by_identity_digest(
            verified.identity_digest(),
            verified.custody_lineage(),
            TenantRootShareEpoch::INITIAL,
        )
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root active share lookup", error))?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore-session cleanup requires durable activation",
            )
        })?;
    if matches!(
        active.record().lifecycle(),
        CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
    ) {
        tenant_root_deriver_initial_activation_v1(
            host,
            CloudflareDeriverTenantRootInitialActivationRequestV1 {
                activation_receipt_b64u: request.activation_receipt_b64u,
            },
            now_ms,
        )
        .await?;
        active = store
            .load_epoch_by_identity_digest(
                verified.identity_digest(),
                verified.custody_lineage(),
                TenantRootShareEpoch::INITIAL,
            )
            .await
            .map_err(|error| {
                tenant_root_store_error_v1("tenant-root resumed active share lookup", error)
            })?
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "tenant-root resumed activation has no role share",
                )
            })?;
    }
    let expected_role = match role {
        TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
        TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
    };
    if active.record().role() != expected_role
        || !matches!(
            active.record().lifecycle(),
            CloudflareTenantRootRoleShareLifecycleV1::Active(_)
                | CloudflareTenantRootRoleShareLifecycleV1::Retired(_)
        )
        || active
            .retained_activation_receipt_bytes()
            .map_err(|error| tenant_root_store_error_v1("tenant-root active share", error))?
            != verified.canonical_bytes()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore-session cleanup activation does not match the active role share",
        ));
    }
    let cleanup_receipt = store
        .close_restore_import_session(&verified, role, now_ms)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore-session cleanup", error)
        })?;
    Ok(CloudflareDeriverTenantRootRestoreSessionCleanupResponseV1 {
        role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
        activation_operation: verified.transition().operation().to_owned(),
        activation_receipt_digest_b64u: crate::encode_base64url_bytes_v1(
            verified.digest().as_bytes(),
        ),
        cleanup_receipt_b64u: crate::encode_base64url_bytes_v1(cleanup_receipt.bytes()),
        cleanup_receipt_digest_b64u: crate::encode_base64url_bytes_v1(
            cleanup_receipt.digest().as_bytes(),
        ),
        closed_at_ms: cleanup_receipt.closed_at_ms(),
    })
}
