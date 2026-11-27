//! Refresh execution, resume, completion and replay on the Deriver.

use super::*;

/// Executes one role's complete refresh while all request-local secrets remain
/// inside this Deriver invocation.
pub async fn tenant_root_deriver_refresh_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootRefreshRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    let worker_role = host.worker_role();
    let role = tenant_root_creation_protocol_role_v1(worker_role)?;
    let command_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root role refresh command",
        &request.role_refresh_command_b64u,
    )?;
    let raw_command = TenantRootRoleRefreshCommandV1::decode_canonical_bytes(&command_bytes)
        .map_err(candidate_derivation_error)?;
    let context_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root refresh context",
        &request.refresh_context_b64u,
    )?;
    let context = TenantRootCeremonyContextV1::decode_canonical_bytes(&context_bytes)
        .map_err(candidate_derivation_error)?;
    validate_raw_refresh_context_binding_v1(&raw_command, &context, role)?;
    let store = host
        .role_store()
        .map_err(|error| tenant_root_store_error_v1("tenant-root role store lookup", error))?;
    let command = raw_command.clone();
    let authority_id =
        host.creation_authority_id(command.identity_digest(), command.custody_lineage())?;
    if command.authority_id() != authority_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh command names a foreign control-plane authority",
        ));
    }

    let reader = host.env();
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(reader)?;
    let role_keys =
        crate::env::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(reader)?;
    let (_, role_signer) =
        crate::env::load_tenant_root_creation_role_signing_key_v1(worker_role, reader)?;
    if context.signing_key_id(role) != role_signer.signing_key_id() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh context does not name this Deriver's active role signer",
        ));
    }
    let active = store
        .load_epoch_by_identity_digest(
            command.identity_digest(),
            command.custody_lineage(),
            command.current_epoch(),
        )
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root active share lookup", error))?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root refresh active share does not exist",
            )
        })?;
    let active_binding = active
        .active_binding()
        .map_err(|error| tenant_root_store_error_v1("tenant-root active binding", error))?;
    let activation_receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(
        active
            .active_activation_receipt_bytes()
            .map_err(|error| tenant_root_store_error_v1("tenant-root active receipt", error))?,
    )
    .map_err(candidate_derivation_error)?;
    let activation_issuer_key = issuer_keys
        .for_issuer_key_id(activation_receipt.issuer_key_id())
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root active receipt issuer is not trusted by this Deriver",
            )
        })?;
    let verified_activation = activation_receipt
        .verify_issuer_signature(activation_issuer_key)
        .map_err(candidate_derivation_error)?;
    let active_pair =
        TenantRootActiveRootPairV1::from_verified_activation_receipt(&verified_activation)
            .map_err(candidate_derivation_error)?;
    let expected_binding = match role {
        TwoPartyDeriverRole::DeriverA => active_pair.deriver_a(),
        TwoPartyDeriverRole::DeriverB => active_pair.deriver_b(),
    };
    if &active_binding != expected_binding {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root active D1 row does not match the signed active pair",
        ));
    }
    let command_issuer_key = issuer_keys
        .for_issuer_key_id(command.issuer_key_id())
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root refresh command issuer is not trusted by this Deriver",
            )
        })?;
    let command = command
        .verify(
            &active_pair,
            &context,
            role,
            verified_activation.result_control_plane_revision(),
            authority_id,
            command.issuer_key_id(),
            command_issuer_key,
        )
        .map_err(candidate_derivation_error)?;
    let admission_decision = store
        .admit_refresh(&command, now_ms)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root refresh durable admission", error)
        })?;
    let (admission, replay_seed) = match admission_decision {
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
                "tenant-root refresh previously failed",
            ));
        }
    };
    let identity = active.record().identity().clone();
    let sealed = active
        .into_online_role_share_artifact()
        .map_err(|error| tenant_root_store_error_v1("tenant-root active share artifact", error))?;
    execute_tenant_root_refresh_from_source_v1(
        host,
        role,
        command,
        context,
        active_pair,
        verified_activation.result_control_plane_revision(),
        command_issuer_key,
        active_binding,
        identity,
        sealed,
        admission,
        replay_seed,
        &role_keys,
        &role_signer,
        &store,
    )
    .await
}

pub(crate) struct RefreshHpkeReplayRng<'a>(pub(crate) &'a mut rand_chacha::ChaCha20Rng);

impl rand_core::RngCore for RefreshHpkeReplayRng<'_> {
    fn next_u32(&mut self) -> u32 {
        rand_core_06::RngCore::next_u32(self.0)
    }
    fn next_u64(&mut self) -> u64 {
        rand_core_06::RngCore::next_u64(self.0)
    }
    fn fill_bytes(&mut self, dest: &mut [u8]) {
        rand_core_06::RngCore::fill_bytes(self.0, dest);
    }
}

impl rand_core::CryptoRng for RefreshHpkeReplayRng<'_> {}

/// Continues a refresh from a verified role-share source.
///
/// Normal refreshes and managed-restore forward refreshes share the provider
/// protocol after source selection. Keeping that selection outside this
/// helper prevents a restored pending record from entering the normal active
/// share path.
#[allow(clippy::too_many_arguments)]
pub(super) async fn execute_tenant_root_refresh_from_source_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    role: TwoPartyDeriverRole,
    command: VerifiedTenantRootRoleRefreshCommandV1,
    context: TenantRootCeremonyContextV1,
    active_pair: TenantRootActiveRootPairV1,
    active_control_plane_revision: u64,
    command_issuer_key: &[u8; 32],
    active_binding: TenantRootActiveRoleBindingV1,
    identity: TenantRootIdentityV1,
    sealed: TenantRootSealedOnlineRoleShareV1,
    admission: crate::tenant_root_role_d1::CloudflareTenantRootRefreshAdmissionV1,
    replay_seed: zeroize::Zeroizing<[u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
    store: &TenantRootRoleShareStoreV1<Host::Sql>,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    let worker_role = host.worker_role();
    let checkpoint_command =
        TenantRootRoleRefreshCommandV1::decode_canonical_bytes(command.canonical_bytes())
            .map_err(candidate_derivation_error)?;
    let checkpoint_command_issuer_key_id = checkpoint_command.issuer_key_id().to_owned();
    let checkpoint_command = checkpoint_command
        .verify(
            &active_pair,
            &context,
            role,
            active_control_plane_revision,
            command.authority_id(),
            &checkpoint_command_issuer_key_id,
            command_issuer_key,
        )
        .map_err(candidate_derivation_error)?;

    let mut online_provider =
        crate::env::load_tenant_root_operational_rotation_provider_v1(worker_role, host.env())?;
    let opened = open_tenant_root_online_role_share_v1(sealed, &mut online_provider)
        .map_err(candidate_derivation_error)?;
    let (_, share_wire) = opened.into_parts();
    let current_share = share_wire.to_share().map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root refresh source role share wire is invalid",
        )
    })?;
    let mut rng = rand_chacha::ChaCha20Rng::from_seed(*replay_seed);
    drop(replay_seed);
    let now_ms = admission.reserved_at_ms();
    let mut hpke_ikm = zeroize::Zeroizing::new([0_u8; 32]);
    rand_core_06::RngCore::fill_bytes(&mut rng, hpke_ikm.as_mut());
    if hpke_ikm.iter().all(|byte| *byte == 0) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root refresh HPKE entropy was all zero",
        ));
    }
    let recipient = TenantRootRefreshHpkeKeypairV1::derive_from_ikm(*hpke_ikm)
        .map_err(candidate_derivation_error)?;
    let recipient_key_digest = Sha256::digest(recipient.public_key().as_bytes());
    let recipient_key_id = format!(
        "refresh-hpke-{}",
        crate::encode_base64url_bytes_v1(&recipient_key_digest[..16])
    );
    let pending = role_signer
        .begin_refresh_role_attempt(
            command,
            context.clone(),
            active_binding,
            current_share,
            recipient_key_id,
            recipient.public_key(),
            now_ms,
            &mut rng,
        )
        .map_err(candidate_derivation_error)?;
    let pair =
        await_refresh_commitment_pair_v1(host, pending.command(), &pending, &context, role_keys)
            .await?;
    let local_aad = match role {
        TwoPartyDeriverRole::DeriverA => TenantRootRefreshContributionAadV1::deriver_a_to_b(&pair),
        TwoPartyDeriverRole::DeriverB => TenantRootRefreshContributionAadV1::deriver_b_to_a(&pair),
    }
    .map_err(candidate_derivation_error)?;
    let mut hpke_rng = RefreshHpkeReplayRng(&mut rng);
    let envelope = router_ab_core::seal_tenant_root_refresh_contribution_v1(
        &local_aad,
        &pending.contribution_for_peer(),
        &mut hpke_rng,
    )
    .map_err(candidate_derivation_error)?;
    let signed = role_signer
        .sign_refresh_contribution(&local_aad, envelope)
        .map_err(candidate_derivation_error)?;
    let signed = signed
        .verify_signature(&local_aad, &role_signer.verifying_key_bytes())
        .map_err(candidate_derivation_error)?;
    let peer_contribution = await_peer_refresh_contribution_v1(
        host,
        pending.command(),
        &signed,
        role,
        &pair,
        role_keys,
        &recipient,
    )
    .await?;
    let finalized = pending
        .finalize(pair, peer_contribution, &mut rng)
        .map_err(candidate_derivation_error)?;
    let provider_config = tenant_root_role_runtime_provider_config_v1(worker_role, host.env())?;
    let mut backup_provider =
        crate::env::load_tenant_root_operational_rotation_provider_v1(worker_role, host.env())?;
    let (refresh, managed_backup, provider_canary_receipt) = seal_refresh_role_for_persistence_v1(
        finalized,
        role_signer,
        identity,
        &provider_config,
        &mut online_provider,
        &mut backup_provider,
        now_ms,
    )
    .await?;
    let evidence_bytes = refresh.installation_evidence_bytes().to_vec();
    let evidence = TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        &evidence_bytes,
        &role_signer.verifying_key_bytes(),
    )
    .map_err(candidate_derivation_error)?;
    let evidence_context = evidence.evidence().transcript().context();
    let expected_provider_canary_binding = TenantRootProviderCanaryReceiptBindingV1::new(
        checkpoint_command.identity_digest(),
        checkpoint_command.custody_lineage(),
        TenantRootActivationReceiptTransitionV1::RefreshSwap,
        checkpoint_command.next_epoch(),
        tenant_root_epoch_commitments_v1(&evidence).map_err(candidate_derivation_error)?,
        tenant_root_provider_canary_curve_family_v1(role),
        provider_config.online_epoch_wrapping_key_ref.clone(),
        now_ms,
        checkpoint_command.authority_id(),
        role_signer.signing_key_id().to_owned(),
        evidence_context.issued_at_ms(),
        evidence_context.expires_at_ms(),
    )
    .map_err(candidate_derivation_error)?;
    let provider_canary =
        TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(&provider_canary_receipt)
            .map_err(candidate_derivation_error)?;
    provider_canary
        .verify(
            &expected_provider_canary_binding,
            &role_signer.verifying_key_bytes(),
        )
        .map_err(candidate_derivation_error)?;
    let prepared_artifacts =
        CloudflareTenantRootRefreshPreparedArtifactsV1::new(&managed_backup, &provider_canary)
            .map_err(|error| {
                tenant_root_store_error_v1("tenant-root refresh prepared artifacts", error)
            })?;
    // An older attempt of this transition that the Router abandoned may have
    // left its pending row here. It is replaced only once the Router confirms,
    // after the older attempts were loaded, that this attempt is its current one.
    let supersession = store
        .refresh_supersession(&checkpoint_command)
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root refresh supersession", error))?;
    if supersession.is_some() {
        let issuer_keys =
            crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(
                host.env(),
            )?;
        require_router_current_refresh_attempt_v1(host, issuer_keys.keys(), &checkpoint_command)
            .await?;
    }
    let (_, executed) = store
        .persist_refresh_pending(
            admission,
            refresh,
            prepared_artifacts,
            now_ms,
            supersession.as_ref(),
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root refresh pending checkpoint", error)
        })?;
    complete_live_tenant_root_refresh_v1(
        host,
        role,
        &checkpoint_command,
        &evidence,
        &managed_backup,
        &provider_canary_receipt,
        &expected_provider_canary_binding,
        store,
        role_signer,
        executed,
        now_ms,
        None,
    )
    .await
}

pub(super) async fn resume_tenant_root_refresh_completion_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    role: TwoPartyDeriverRole,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    admission: crate::tenant_root_role_d1::CloudflareTenantRootRefreshAdmissionV1,
    durable_state: CloudflareTenantRootRefreshDurableStateV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
    store: &TenantRootRoleShareStoreV1<Host::Sql>,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    let evidence_bytes = durable_state.evidence_bytes().map_err(|error| {
        tenant_root_store_error_v1("tenant-root refresh recovery evidence", error)
    })?;
    let signed_evidence =
        TenantRootSignedShareInstallationEvidenceV1::decode_canonical_bytes(&evidence_bytes)
            .map_err(candidate_derivation_error)?;
    if signed_evidence.role() != role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh recovery evidence belongs to the other role",
        ));
    }
    let retained_signing_key_id = signed_evidence.signing_key_id().to_owned();
    let trusted_role_key = role_keys.for_role_and_key_id(role, &retained_signing_key_id)?;
    let evidence = TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        &evidence_bytes,
        trusted_role_key,
    )
    .map_err(candidate_derivation_error)?;
    validate_replayed_refresh_evidence_v1(command, role, &evidence)?;
    if role_signer.signing_key_id() != retained_signing_key_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh recovery requires an unavailable role signing key",
        ));
    }
    let pending = store
        .load_epoch_by_identity_digest(
            command.identity_digest(),
            command.custody_lineage(),
            command.next_epoch(),
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root refresh recovery pending lookup", error)
        })?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root refresh recovery pending share does not exist",
            )
        })?;
    if !matches!(
        pending.record().lifecycle(),
        CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
    ) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root refresh recovery requires a pending role share",
        ));
    }
    let expected_online_epoch_wrapping_key_ref =
        pending.record().epoch_wrapping_key_ref().to_owned();
    let executed = store
        .recover_refresh_executed(
            command,
            admission,
            &durable_state,
            pending,
            trusted_role_key,
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root refresh execution recovery", error)
        })?;
    let (managed_backup, provider_canary, _signed_managed_backup, provider_canary_receipt) =
        decode_prepared_refresh_artifacts_v1(&durable_state, trusted_role_key)?;
    validate_replayed_refresh_artifacts_v1(
        command,
        role,
        &evidence,
        &managed_backup,
        &provider_canary,
        &expected_online_epoch_wrapping_key_ref,
        &retained_signing_key_id,
    )?;
    let existing_artifacts = match &durable_state {
        CloudflareTenantRootRefreshDurableStateV1::Artifacts { .. } => {
            Some(durable_state.artifacts().map_err(|error| {
                tenant_root_store_error_v1("tenant-root refresh recovery artifact metadata", error)
            })?)
        }
        CloudflareTenantRootRefreshDurableStateV1::Executed { .. } => None,
        CloudflareTenantRootRefreshDurableStateV1::Admitted { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root refresh completion recovery requires an executed state",
            ));
        }
    };
    complete_live_tenant_root_refresh_v1(
        host,
        role,
        command,
        &evidence,
        &managed_backup,
        &provider_canary_receipt,
        provider_canary.binding(),
        store,
        role_signer,
        executed,
        now_ms,
        existing_artifacts,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn complete_live_tenant_root_refresh_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    role: TwoPartyDeriverRole,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    managed_backup: &VerifiedTenantRootManagedBackupV1,
    provider_canary_receipt: &[u8],
    expected_canary_binding: &TenantRootProviderCanaryReceiptBindingV1,
    store: &TenantRootRoleShareStoreV1<Host::Sql>,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
    executed: CloudflareTenantRootRefreshExecutedCommandV1,
    terminal_at_ms: u64,
    existing_artifacts: Option<&CloudflareTenantRootRefreshArtifactMetadataV1>,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    let signed_managed_backup = managed_backup.canonical_bytes().to_vec();
    // An older attempt of this transition that the Router abandoned may have
    // written its backup and canary at these coordinates; those exact objects,
    // and nothing else, may be replaced.
    let (replaceable_backups, replaceable_canaries) = store
        .superseded_refresh_artifact_digests(command)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root refresh superseded artifacts", error)
        })?;
    let backup_metadata = host
        .put_managed_backup(managed_backup, &replaceable_backups)
        .await?;
    let backup_coordinates =
        crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1::from_binding(
            managed_backup.binding(),
        );
    // The host stores the canary under the binding it carries, so the refresh's
    // exact expected binding is checked first.
    TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(provider_canary_receipt)
        .map_err(candidate_derivation_error)?
        .verify(expected_canary_binding, &role_signer.verifying_key_bytes())
        .map_err(candidate_derivation_error)?;
    let canary_metadata = host
        .put_provider_canary(
            backup_coordinates,
            provider_canary_receipt,
            &role_signer.verifying_key_bytes(),
            &replaceable_canaries,
        )
        .await?;
    let artifacts = CloudflareTenantRootRefreshArtifactMetadataV1::new(
        &backup_metadata,
        &canary_metadata,
        expected_canary_binding
            .provider_key_version_ref()
            .to_owned(),
        role_signer.signing_key_id().to_owned(),
    )
    .map_err(|error| tenant_root_store_error_v1("tenant-root refresh artifact metadata", error))?;
    if let Some(expected_artifacts) = existing_artifacts {
        if expected_artifacts.online_epoch_wrapping_key_ref()
            != artifacts.online_epoch_wrapping_key_ref()
            || expected_artifacts.role_signing_key_id() != artifacts.role_signing_key_id()
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root refresh durable provider metadata changed",
            ));
        }
        validate_refresh_artifact_metadata_v1(
            expected_artifacts,
            &backup_metadata,
            &canary_metadata,
        )?;
    } else {
        store
            .attach_refresh_artifacts(command, &executed, artifacts.clone())
            .await
            .map_err(|error| {
                tenant_root_store_error_v1("tenant-root refresh artifact checkpoint", error)
            })?;
    }
    let receipt = role_signer
        .sign_verified_success_terminal_receipt(
            executed.executed(),
            executed.evidence_bytes(),
            terminal_at_ms,
        )
        .map_err(candidate_derivation_error)?;
    let terminal_commit = store
        .complete_refresh_with_artifacts(command, executed, &artifacts, receipt)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root refresh terminal checkpoint", error)
        })?;
    let terminal_receipt_bytes = match terminal_commit {
        CloudflareTenantRootCommandTerminalCommitV1::Committed { receipt_bytes }
        | CloudflareTenantRootCommandTerminalCommitV1::Replay { receipt_bytes } => receipt_bytes,
    };
    tenant_root_refresh_installation_call_v1(
        host,
        command,
        evidence,
        &terminal_receipt_bytes,
    )
    .await?;
    Ok(CloudflareDeriverTenantRootRefreshResponseV1 {
        role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
        signed_installation_evidence_b64u: crate::encode_base64url_bytes_v1(
            evidence.canonical_bytes(),
        ),
        signed_managed_backup_b64u: crate::encode_base64url_bytes_v1(&signed_managed_backup),
        provider_canary_receipt_b64u: crate::encode_base64url_bytes_v1(provider_canary_receipt),
        terminal_receipt_b64u: crate::encode_base64url_bytes_v1(&terminal_receipt_bytes),
    })
}

pub(super) fn decode_prepared_refresh_artifacts_v1(
    durable_state: &CloudflareTenantRootRefreshDurableStateV1,
    trusted_role_key: &[u8; 32],
) -> RouterAbProtocolResult<(
    VerifiedTenantRootManagedBackupV1,
    TenantRootSignedProviderCanaryReceiptV1,
    Vec<u8>,
    Vec<u8>,
)> {
    let prepared = durable_state.prepared_artifacts().map_err(|error| {
        tenant_root_store_error_v1("tenant-root refresh prepared artifacts", error)
    })?;
    decode_prepared_refresh_artifact_bundle_v1(prepared, trusted_role_key)
}

pub(super) fn decode_prepared_refresh_artifact_bundle_v1(
    prepared: &CloudflareTenantRootRefreshPreparedArtifactsV1,
    trusted_role_key: &[u8; 32],
) -> RouterAbProtocolResult<(
    VerifiedTenantRootManagedBackupV1,
    TenantRootSignedProviderCanaryReceiptV1,
    Vec<u8>,
    Vec<u8>,
)> {
    let signed_managed_backup = prepared.managed_backup_bytes().map_err(|error| {
        tenant_root_store_error_v1("tenant-root refresh managed-backup artifact", error)
    })?;
    let signed_managed_backup_artifact =
        TenantRootSignedManagedBackupV1::decode_canonical_bytes(&signed_managed_backup)
            .map_err(candidate_derivation_error)?;
    let managed_backup = signed_managed_backup_artifact
        .verify(signed_managed_backup_artifact.binding(), trusted_role_key)
        .map_err(candidate_derivation_error)?;
    let provider_canary_receipt = prepared.provider_canary_receipt_bytes().map_err(|error| {
        tenant_root_store_error_v1("tenant-root refresh provider-canary artifact", error)
    })?;
    let provider_canary =
        TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(&provider_canary_receipt)
            .map_err(candidate_derivation_error)?;
    provider_canary
        .verify(provider_canary.binding(), trusted_role_key)
        .map_err(candidate_derivation_error)?;
    Ok((
        managed_backup,
        provider_canary,
        signed_managed_backup,
        provider_canary_receipt,
    ))
}

pub(super) fn validate_replayed_refresh_artifacts_v1(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    role: TwoPartyDeriverRole,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    managed_backup: &VerifiedTenantRootManagedBackupV1,
    provider_canary: &TenantRootSignedProviderCanaryReceiptV1,
    expected_online_epoch_wrapping_key_ref: &str,
    expected_role_signing_key_id: &str,
) -> RouterAbProtocolResult<()> {
    let expected_installation_receipt = evidence
        .lifecycle_receipt_digest()
        .map_err(candidate_derivation_error)?;
    let evidence_commitment = evidence.evidence().transcript().commitment().to_bytes();
    let managed_binding = managed_backup.binding();
    if managed_binding.identity_digest() != command.identity_digest()
        || managed_binding.custody_lineage() != command.custody_lineage()
        || managed_binding.role() != tenant_root_managed_restore_role_v1(role)
        || managed_binding.epoch() != command.next_epoch()
        || managed_binding.share_commitment().as_bytes() != evidence_commitment.as_ref()
        || managed_binding.installation_receipt_digest() != expected_installation_receipt
        || managed_binding.role_signing_key_id() != expected_role_signing_key_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh replay managed backup does not match its exact evidence",
        ));
    }
    let context = evidence.evidence().transcript().context();
    let commitments =
        tenant_root_epoch_commitments_v1(evidence).map_err(candidate_derivation_error)?;
    let canary_binding = provider_canary.binding();
    if canary_binding.identity_digest() != command.identity_digest()
        || canary_binding.custody_lineage() != command.custody_lineage()
        || canary_binding.transition() != TenantRootActivationReceiptTransitionV1::RefreshSwap
        || canary_binding.target_epoch() != command.next_epoch()
        || canary_binding.commitments() != &commitments
        || canary_binding.curve_family() != tenant_root_provider_canary_curve_family_v1(role)
        || canary_binding.provider_key_version_ref() != expected_online_epoch_wrapping_key_ref
        || canary_binding.authority_id() != command.authority_id()
        || canary_binding.signing_key_id() != expected_role_signing_key_id
        || canary_binding.issued_at_ms() != context.issued_at_ms()
        || canary_binding.expires_at_ms() != context.expires_at_ms()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh provider canary does not match its exact evidence",
        ));
    }
    Ok(())
}

pub(super) async fn verify_refresh_activation_artifact_checkpoint_v1(
    host: &impl TenantRootDeriverHostV1,
    role: TwoPartyDeriverRole,
    activation: &VerifiedTenantRootSignedActivationReceiptV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
    checkpoint: &CloudflareTenantRootRefreshArtifactCheckpointV1,
    issuer_keys: &CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootManagedBackupV1> {
    let TenantRootActivationReceiptBindingV1::RefreshSwap(activation_binding) =
        activation.binding()
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh artifact checkpoint requires a refresh-swap receipt",
        ));
    };
    let raw_command =
        TenantRootRoleRefreshCommandV1::decode_canonical_bytes(checkpoint.command_bytes())
            .map_err(candidate_derivation_error)?;
    let expected_role_signing_key_id = checkpoint.artifacts().role_signing_key_id();
    let trusted_role_key = role_keys.for_role_and_key_id(role, expected_role_signing_key_id)?;
    let evidence = TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        checkpoint.evidence_bytes(),
        trusted_role_key,
    )
    .map_err(candidate_derivation_error)?;
    let context = evidence.evidence().transcript().context().clone();
    validate_raw_refresh_context_binding_v1(&raw_command, &context, role)?;
    if raw_command.identity_digest() != activation_binding.identity_digest()
        || raw_command.custody_lineage() != activation_binding.custody_lineage()
        || raw_command.current_epoch() != activation_binding.current_epoch()
        || raw_command.next_epoch() != activation_binding.next_epoch()
        || raw_command.expected_control_plane_revision()
            != activation_binding.expected_control_plane_revision()
        || raw_command.refresh_context_digest() != activation_binding.context_digest()
        || raw_command.authority_id() != activation_binding.authority_id()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh checkpoint command does not match its activation receipt",
        ));
    }
    let command = verify_refresh_command_from_persisted_raw_v1(
        &raw_command,
        &context,
        role,
        activation_binding.authority_id(),
        issuer_keys,
    )?;
    if context.signing_key_id(role) != expected_role_signing_key_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh checkpoint signing key does not match its evidence context",
        ));
    }
    validate_replayed_refresh_evidence_v1(&command, role, &evidence)?;
    let (managed_backup, provider_canary, signed_backup, provider_canary_receipt) =
        decode_prepared_refresh_artifact_bundle_v1(
            checkpoint.prepared_artifacts(),
            trusted_role_key,
        )?;
    validate_replayed_refresh_artifacts_v1(
        &command,
        role,
        &evidence,
        &managed_backup,
        &provider_canary,
        checkpoint.artifacts().online_epoch_wrapping_key_ref(),
        expected_role_signing_key_id,
    )?;
    if checkpoint.artifacts().online_epoch_wrapping_key_ref()
        != provider_canary.provider_key_version_ref()
        || checkpoint.artifacts().role_signing_key_id()
            != managed_backup.binding().role_signing_key_id()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh checkpoint metadata does not match its signed artifacts",
        ));
    }
    let pending_evidence = match pending.record().lifecycle() {
        CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) => {
            pending.installation_evidence_digest()
        }
        CloudflareTenantRootRoleShareLifecycleV1::Active(_)
        | CloudflareTenantRootRoleShareLifecycleV1::Retired(_) => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root refresh artifact checkpoint pending row changed lifecycle",
            ));
        }
    };
    let pending_commitment = match role {
        TwoPartyDeriverRole::DeriverA => activation_binding.next_commitments().deriver_a(),
        TwoPartyDeriverRole::DeriverB => activation_binding.next_commitments().deriver_b(),
    };
    let pending_installation_receipt = match role {
        TwoPartyDeriverRole::DeriverA => activation_binding.installation_receipts().deriver_a(),
        TwoPartyDeriverRole::DeriverB => activation_binding.installation_receipts().deriver_b(),
    };
    if pending.record().share_commitment() != pending_commitment
        || pending_evidence != pending_installation_receipt
        || pending_evidence
            != evidence
                .lifecycle_receipt_digest()
                .map_err(candidate_derivation_error)?
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh checkpoint evidence does not match its pending row",
        ));
    }
    let coordinates =
        crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1::new(
            activation_binding.identity_digest(),
            activation_binding.custody_lineage(),
            tenant_root_managed_restore_role_v1(role),
            activation_binding.next_epoch(),
        );
    let (stored_managed_backup, backup_metadata) = host
        .get_managed_backup_with_metadata(coordinates, trusted_role_key)
        .await?;
    if stored_managed_backup.canonical_bytes() != signed_backup.as_slice() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh checkpoint managed backup bytes changed",
        ));
    }
    let (stored_provider_canary, canary_metadata) = host
        .get_provider_canary_with_metadata(coordinates, provider_canary.binding(), trusted_role_key)
        .await?;
    if stored_provider_canary.canonical_bytes() != provider_canary_receipt.as_slice() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh checkpoint provider canary bytes changed",
        ));
    }
    validate_refresh_artifact_metadata_v1(
        checkpoint.artifacts(),
        &backup_metadata,
        &canary_metadata,
    )?;
    Ok(managed_backup)
}

pub(super) fn validate_refresh_artifact_metadata_v1(
    expected: &CloudflareTenantRootRefreshArtifactMetadataV1,
    backup: &crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectMetadataV1,
    canary: &crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectMetadataV1,
) -> RouterAbProtocolResult<()> {
    let expected_backup_digest = expected.backup_artifact_digest().map_err(|error| {
        tenant_root_store_error_v1("tenant-root refresh backup artifact digest", error)
    })?;
    let expected_canary_digest = expected.canary_artifact_digest().map_err(|error| {
        tenant_root_store_error_v1("tenant-root refresh canary artifact digest", error)
    })?;
    if expected.backup_object_key() != backup.object_key()
        || expected_backup_digest.as_ref() != backup.canonical_digest()
        || expected.backup_object_generation() != backup.object_generation()
        || expected.backup_key_generation_ref() != backup.wrapping_key_generation_ref()
        || expected.canary_object_key() != canary.object_key()
        || expected_canary_digest.as_ref() != canary.canonical_digest()
        || expected.canary_object_generation() != canary.object_generation()
        || expected.canary_key_generation_ref() != canary.wrapping_key_generation_ref()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh R2 metadata does not match its durable artifact checkpoint",
        ));
    }
    Ok(())
}

pub(super) async fn replay_completed_tenant_root_refresh_v1(
    host: &impl TenantRootDeriverHostV1,
    role: TwoPartyDeriverRole,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    terminal_receipt_bytes: Vec<u8>,
    durable_state: CloudflareTenantRootRefreshDurableStateV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    let terminal_receipt =
        TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&terminal_receipt_bytes)
            .map_err(candidate_derivation_error)?;
    if terminal_receipt
        .canonical_bytes()
        .map_err(candidate_derivation_error)?
        != terminal_receipt_bytes
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh replay terminal receipt is not canonical",
        ));
    }
    let success = match &terminal_receipt {
        TenantRootCommandTerminalReceiptV1::Success(receipt) => receipt,
        TenantRootCommandTerminalReceiptV1::Failure(_) => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root refresh replay has a failure terminal receipt",
            ));
        }
    };
    let retained_signing_key_id = success.role_signing_key_id().to_owned();
    let role_keys =
        crate::env::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(host.env())?;
    let trusted_role_key = role_keys.for_role_and_key_id(role, &retained_signing_key_id)?;
    let durable_command_bytes = durable_state.command_bytes().map_err(|error| {
        tenant_root_store_error_v1("tenant-root refresh replay durable command", error)
    })?;
    if durable_command_bytes != command.canonical_bytes() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh replay durable command does not match the request",
        ));
    }
    let durable_evidence_bytes = durable_state.evidence_bytes().map_err(|error| {
        tenant_root_store_error_v1("tenant-root refresh replay durable evidence", error)
    })?;
    if durable_evidence_bytes != success.payload_bytes() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh replay durable evidence does not match its terminal receipt",
        ));
    }
    let evidence = TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        &durable_evidence_bytes,
        trusted_role_key,
    )
    .map_err(candidate_derivation_error)?;
    validate_replayed_refresh_evidence_v1(command, role, &evidence)?;
    let replay_key = TenantRootCommandReplayKeyV1::new(
        command.identity_digest(),
        command.custody_lineage(),
        command.session_id(),
        command.nonce(),
        role,
    );
    success
        .verify_remote_public(
            &replay_key,
            evidence.canonical_bytes(),
            command.issued_at_ms(),
            &retained_signing_key_id,
            trusted_role_key,
        )
        .map_err(candidate_derivation_error)?;

    let (managed_backup, provider_canary, signed_managed_backup, provider_canary_receipt) =
        decode_prepared_refresh_artifacts_v1(&durable_state, trusted_role_key)?;
    let expected_artifacts = durable_state.artifacts().map_err(|error| {
        tenant_root_store_error_v1("tenant-root refresh replay artifact metadata", error)
    })?;
    validate_replayed_refresh_artifacts_v1(
        command,
        role,
        &evidence,
        &managed_backup,
        &provider_canary,
        expected_artifacts.online_epoch_wrapping_key_ref(),
        &retained_signing_key_id,
    )?;
    if expected_artifacts.online_epoch_wrapping_key_ref()
        != provider_canary.provider_key_version_ref()
        || expected_artifacts.role_signing_key_id() != retained_signing_key_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh replay artifact metadata does not match its signed artifacts",
        ));
    }
    let expected_canary_binding = provider_canary.binding().clone();
    let backup_coordinates =
        crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1::new(
            command.identity_digest(),
            command.custody_lineage(),
            tenant_root_managed_restore_role_v1(role),
            command.next_epoch(),
        );
    let (stored_managed_backup, backup_metadata) = host
        .get_managed_backup_with_metadata(backup_coordinates, trusted_role_key)
        .await?;
    if stored_managed_backup.canonical_bytes() != signed_managed_backup.as_slice() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh replay managed backup bytes changed",
        ));
    }
    let (stored_provider_canary, canary_metadata) = host
        .get_provider_canary_with_metadata(
            backup_coordinates,
            &expected_canary_binding,
            trusted_role_key,
        )
        .await?;
    if stored_provider_canary.canonical_bytes() != provider_canary_receipt.as_slice() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh replay provider canary bytes changed",
        ));
    }
    validate_refresh_artifact_metadata_v1(expected_artifacts, &backup_metadata, &canary_metadata)?;

    tenant_root_refresh_installation_call_v1(
        host,
        command,
        &evidence,
        &terminal_receipt_bytes,
    )
    .await?;

    Ok(CloudflareDeriverTenantRootRefreshResponseV1 {
        role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
        signed_installation_evidence_b64u: crate::encode_base64url_bytes_v1(
            evidence.canonical_bytes(),
        ),
        signed_managed_backup_b64u: crate::encode_base64url_bytes_v1(&signed_managed_backup),
        provider_canary_receipt_b64u: crate::encode_base64url_bytes_v1(&provider_canary_receipt),
        terminal_receipt_b64u: crate::encode_base64url_bytes_v1(&terminal_receipt_bytes),
    })
}

pub(super) fn validate_replayed_refresh_evidence_v1(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    role: TwoPartyDeriverRole,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
) -> RouterAbProtocolResult<()> {
    let transcript = evidence.evidence().transcript();
    let context = transcript.context();
    let epochs_match = matches!(
        context.epochs(),
        TenantRootCeremonyEpochsV1::Refresh { current, next }
            if current == command.current_epoch() && next == command.next_epoch()
    );
    if command.role() != role
        || transcript.role() != role
        || context.identity_digest() != command.identity_digest()
        || context.custody_lineage() != command.custody_lineage()
        || context.session_id() != command.session_id()
        || context.nonce() != command.nonce()
        || !epochs_match
        || context.digest().map_err(candidate_derivation_error)? != command.refresh_context_digest()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh replay evidence does not match its exact command",
        ));
    }
    Ok(())
}

/// The Workers entrypoint for a Deriver's refresh-swap activation.
#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_refresh_activation_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootRefreshActivationRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshActivationResponseV1> {
    tenant_root_deriver_refresh_activation_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await
}

/// The Workers entrypoint for one role's refresh.
#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_refresh_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootRefreshRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRefreshResponseV1> {
    tenant_root_deriver_refresh_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await
}
