//! Promotion of a restore refresh on the Deriver.

use super::*;

pub(super) fn decode_restore_refresh_authority_id_v1(
    encoded: &str,
) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
    let bytes = crate::decode_base64url_bytes_v1(
        "tenant-root restore refresh control-plane authority id",
        encoded,
    )?;
    if crate::encode_base64url_bytes_v1(&bytes) != encoded {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore refresh control-plane authority id must use canonical unpadded base64url",
        ));
    }
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore refresh control-plane authority id must contain exactly 32 bytes",
        )
    })?;
    if bytes.iter().all(|byte| *byte == 0) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore refresh control-plane authority id must be non-zero",
        ));
    }
    Ok(TenantRootControlPlaneAuthorityIdV1::from_bytes(bytes))
}

pub(super) fn restore_refresh_promotion_response_v1(
    role: CloudflareTenantRootCreateRoleV1,
    command_b64u: &str,
    command_digest_b64u: &str,
    evidence_bytes: &[u8],
    provider_canary_receipt_bytes: &[u8],
    completed_at_ms: u64,
) -> CloudflareDeriverTenantRootRestoreRefreshPromotionResponseV1 {
    let installation_evidence_digest_b64u =
        crate::encode_base64url_bytes_v1(&Sha256::digest(evidence_bytes));
    let provider_canary_receipt_digest_b64u =
        crate::encode_base64url_bytes_v1(&Sha256::digest(provider_canary_receipt_bytes));
    CloudflareDeriverTenantRootRestoreRefreshPromotionResponseV1 {
        role,
        restore_refresh_role_command_b64u: command_b64u.to_owned(),
        command_digest_b64u: command_digest_b64u.to_owned(),
        signed_installation_evidence_b64u: crate::encode_base64url_bytes_v1(evidence_bytes),
        installation_evidence_digest_b64u,
        provider_canary_receipt_b64u: crate::encode_base64url_bytes_v1(
            provider_canary_receipt_bytes,
        ),
        provider_canary_receipt_digest_b64u,
        completed_at_ms,
    }
}

/// Promotes one finalized restore-refresh attempt into the role's epoch-one
/// online provider and durably checkpoints the result before replying.
pub async fn tenant_root_deriver_restore_refresh_promotion_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    identity: TenantRootIdentityV1,
    role_refresh_command_b64u: String,
    authority_id_b64u: String,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRefreshPromotionResponseV1> {
    let worker_role = host.worker_role();
    let role = tenant_root_creation_protocol_role_v1(worker_role)?;
    let command_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root restore refresh role command",
        &role_refresh_command_b64u,
    )?;
    if crate::encode_base64url_bytes_v1(&command_bytes) != role_refresh_command_b64u {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore refresh role command must use canonical unpadded base64url",
        ));
    }
    let raw_command = TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&command_bytes)
        .map_err(candidate_derivation_error)?;
    let authority_id = decode_restore_refresh_authority_id_v1(&authority_id_b64u)?;
    let reader = host.env();
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(reader)?;
    let issuer_key = issuer_keys
        .for_issuer_key_id(raw_command.issuer_key_id())
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root restore refresh issuer is not trusted by this Worker",
            )
        })?;
    let command = raw_command
        .verify(raw_command.issuer_key_id(), issuer_key)
        .map_err(candidate_derivation_error)?;
    if command.role() != role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore refresh command belongs to the other Deriver",
        ));
    }
    if identity.digest().map_err(candidate_derivation_error)? != command.identity_digest() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "restore promotion identity does not match the signed command",
        ));
    }
    let response_role = CloudflareTenantRootCreateRoleV1::from_protocol(role);
    let command_b64u = crate::encode_base64url_bytes_v1(command.canonical_bytes());
    let command_digest_b64u = crate::encode_base64url_bytes_v1(command.digest().as_bytes());
    let (_, role_signer) =
        crate::env::load_tenant_root_creation_role_signing_key_v1(worker_role, host.env())?;
    if command.context().signing_key_id(role) != role_signer.signing_key_id() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore refresh context does not name this Deriver's active role signer",
        ));
    }
    let store = host.role_store()
        .map_err(|error| tenant_root_store_error_v1("tenant-root role store lookup", error))?;
    if store
        .restore_import_session_is_closed(
            command.identity_digest(),
            command.custody_lineage(),
            command.restore_session_id(),
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore-session tombstone lookup", error)
        })?
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore refresh session is closed",
        ));
    }
    let reservation = store
        .reserve_restore_refresh_promotion(&command, now_ms)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore refresh promotion reservation", error)
        })?;
    let source = match reservation {
        CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1::Execute { source }
        | CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1::Resume { source } => {
            source
        }
        CloudflareTenantRootRestoreRefreshPromotionReservationDecisionV1::Replay { artifacts } => {
            let source = store
                .load_restore_refresh_promotion_source(&command)
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1(
                        "tenant-root restore refresh promotion replay source",
                        error,
                    )
                })?;
            let (_, evidence_bytes, _) = source.into_parts();
            return Ok(restore_refresh_promotion_response_v1(
                response_role,
                &command_b64u,
                &command_digest_b64u,
                &evidence_bytes,
                artifacts.provider_canary_receipt_bytes(),
                artifacts.completed_at_ms(),
            ));
        }
    };
    let (share_wire, evidence_bytes, _) = source.into_parts();
    let evidence = TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        &evidence_bytes,
        &role_signer.verifying_key_bytes(),
    )
    .map_err(candidate_derivation_error)?;
    let provider_config = tenant_root_role_runtime_provider_config_v1(worker_role, host.env())?;
    let mut online_provider =
        crate::env::load_tenant_root_operational_rotation_provider_v1(worker_role, host.env())?;
    let artifacts = compose_restore_refresh_promotion_with_completion_time_v1(
        &command,
        share_wire,
        evidence,
        &role_signer,
        &provider_config,
        authority_id,
        &mut online_provider,
        || {
            host.now_ms().map_err(|error| {
                RouterAbDerivationError::new(
                    RouterAbDerivationErrorCode::MalformedInput,
                    format!("tenant-root restore refresh provider clock failed: {error}"),
                )
            })
        },
    )
    .map_err(candidate_derivation_error)?;
    let (sealed, provider_canary_receipt_bytes) = artifacts.into_parts();
    let canary = TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(
        &provider_canary_receipt_bytes,
    )
    .map_err(candidate_derivation_error)?;
    let completed_at_ms = canary.binding().completed_at_ms();
    let completion = store
        .complete_restore_refresh_promotion(
            &command,
            identity,
            &sealed,
            &provider_canary_receipt_bytes,
            completed_at_ms,
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore refresh promotion completion", error)
        })?;
    let stored_artifacts = match completion {
        CloudflareTenantRootRestoreRefreshPromotionCompletionV1::Committed { artifacts }
        | CloudflareTenantRootRestoreRefreshPromotionCompletionV1::Replay { artifacts } => {
            artifacts
        }
    };
    Ok(restore_refresh_promotion_response_v1(
        response_role,
        &command_b64u,
        &command_digest_b64u,
        &evidence_bytes,
        stored_artifacts.provider_canary_receipt_bytes(),
        stored_artifacts.completed_at_ms(),
    ))
}

pub(super) fn tenant_root_refresh_activation_scope_v1(
    activation: &router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
    role: TwoPartyDeriverRole,
) -> RouterAbProtocolResult<TenantRootCommandScopeV1> {
    let router_ab_core::TenantRootActivationReceiptBindingV1::RefreshSwap(binding) =
        activation.binding()
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation requires a refresh-swap receipt",
        ));
    };
    if pending.record().epoch() != binding.next_epoch()
        || pending.record().custody_lineage() != binding.custody_lineage()
        || pending
            .record()
            .identity()
            .digest()
            .map_err(candidate_derivation_error)?
            != binding.identity_digest()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation scope does not match its pending role share",
        ));
    }
    let role_tag = match role {
        TwoPartyDeriverRole::DeriverA => 1_u8,
        TwoPartyDeriverRole::DeriverB => 2_u8,
    };
    let mut scope_material = Vec::with_capacity(32 + 32 + 16 + 8 + 8 + 1);
    scope_material.extend_from_slice(b"seams/tenant-root/refresh-activation-scope/v1");
    scope_material.extend_from_slice(activation.digest().as_bytes());
    scope_material.extend_from_slice(binding.identity_digest().as_bytes());
    scope_material.extend_from_slice(binding.custody_lineage().as_bytes());
    scope_material.extend_from_slice(&binding.current_epoch().get().get().to_be_bytes());
    scope_material.extend_from_slice(&binding.next_epoch().get().get().to_be_bytes());
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
    let key = match role {
        TwoPartyDeriverRole::DeriverA => TenantRootCommandReplayKeyV1::deriver_a(
            binding.identity_digest(),
            binding.custody_lineage(),
            session_id,
            nonce,
        ),
        TwoPartyDeriverRole::DeriverB => TenantRootCommandReplayKeyV1::deriver_b(
            binding.identity_digest(),
            binding.custody_lineage(),
            session_id,
            nonce,
        ),
    };
    TenantRootCommandScopeV1::new(
        key,
        binding.next_epoch(),
        binding.expected_control_plane_revision(),
    )
    .map_err(candidate_derivation_error)
}

pub(super) fn validate_tenant_root_refresh_activation_rows_v1(
    activation: &router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
    active: &CloudflareStoredTenantRootRoleShareV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
    role: TwoPartyDeriverRole,
    activation_already_applied: bool,
) -> RouterAbProtocolResult<()> {
    let router_ab_core::TenantRootActivationReceiptBindingV1::RefreshSwap(binding) =
        activation.binding()
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation requires a refresh-swap receipt",
        ));
    };
    let active_identity = active
        .record()
        .identity()
        .digest()
        .map_err(candidate_derivation_error)?;
    let pending_identity = pending
        .record()
        .identity()
        .digest()
        .map_err(candidate_derivation_error)?;
    let current_lifecycle_matches = if activation_already_applied {
        matches!(
            active.record().lifecycle(),
            CloudflareTenantRootRoleShareLifecycleV1::Retired(_)
        )
    } else {
        matches!(
            active.record().lifecycle(),
            CloudflareTenantRootRoleShareLifecycleV1::Active(_)
        )
    };
    if !current_lifecycle_matches
        || !matches!(
            pending.record().lifecycle(),
            CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
        )
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root refresh activation rows do not match their expected lifecycle",
        ));
    }
    if active_identity != pending_identity
        || active_identity != binding.identity_digest()
        || active.record().custody_lineage() != binding.custody_lineage()
        || pending.record().custody_lineage() != binding.custody_lineage()
        || active.record().epoch() != binding.current_epoch()
        || pending.record().epoch() != binding.next_epoch()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation receipt does not match local role-share rows",
        ));
    }
    let active_commitment = match role {
        TwoPartyDeriverRole::DeriverA => binding.current_commitments().deriver_a(),
        TwoPartyDeriverRole::DeriverB => binding.current_commitments().deriver_b(),
    };
    let pending_commitment = match role {
        TwoPartyDeriverRole::DeriverA => binding.next_commitments().deriver_a(),
        TwoPartyDeriverRole::DeriverB => binding.next_commitments().deriver_b(),
    };
    if active.record().share_commitment() != active_commitment
        || pending.record().share_commitment() != pending_commitment
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation commitments do not match local role-share rows",
        ));
    }
    let installation_receipt = match role {
        TwoPartyDeriverRole::DeriverA => binding.installation_receipts().deriver_a(),
        TwoPartyDeriverRole::DeriverB => binding.installation_receipts().deriver_b(),
    };
    let pending_evidence = match pending.record().lifecycle() {
        CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) => {
            pending.installation_evidence_digest()
        }
        CloudflareTenantRootRoleShareLifecycleV1::Active(_)
        | CloudflareTenantRootRoleShareLifecycleV1::Retired(_) => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root refresh activation pending row changed lifecycle",
            ));
        }
    };
    if installation_receipt != pending_evidence {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation evidence does not match the pending role-share row",
        ));
    }
    Ok(())
}
