//! Creation progress, role-share creation, abandonment, creation evidence and cleanup.

use super::*;

pub(super) async fn require_fresh_tenant_root_creation_v1<S: RoleSqlSessionV1>(
    store: &TenantRootRoleShareStoreV1<S>,
    package_bytes: &[u8],
    role: TwoPartyDeriverRole,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_keys: &CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
    now_ms: u64,
) -> RouterAbProtocolResult<()> {
    let verified = verify_tenant_root_role_creation_package_v1(
        package_bytes,
        role,
        authority_id,
        trusted_issuer_keys,
        role_signer,
    )?;
    match store
        .preflight_initial_creation(verified.command(), now_ms)
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root creation preflight", error))?
    {
        CloudflareTenantRootInitialCreationPreflightV1::Fresh => Ok(()),
        CloudflareTenantRootInitialCreationPreflightV1::InProgress => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root creation is already in progress and requires cleanup",
            ))
        }
        CloudflareTenantRootInitialCreationPreflightV1::ReplayCompleted { .. } => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root creation already completed for this role",
            ))
        }
        CloudflareTenantRootInitialCreationPreflightV1::ReplayFailed { .. } => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root creation already failed for this role",
            ))
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn persist_tenant_root_creation_progress_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    role: TwoPartyDeriverRole,
    package_bytes: &[u8],
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_keys: &CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
    store: &TenantRootRoleShareStoreV1<Host::Sql>,
    progress: TenantRootRoleCreationProgressV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootCreateRoleShareResponseV1> {
    let TenantRootRoleCreationProgressV1::Sealed {
        signed_commitment,
        signed_installation_evidence,
        input,
        managed_backup,
        completion,
    } = progress
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root creation did not complete its commitment pair",
        ));
    };
    let signed_managed_backup = managed_backup.canonical_bytes().to_vec();
    let backup_coordinates =
        crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1::from_binding(
            managed_backup.binding(),
        );
    let binding = managed_backup.binding();
    // This role's writes for the ceremony: its backup, then its canary, the
    // one activation artifact nothing else keeps (stored beside the backup
    // before the installation checkpoint, so a creation the Router reads as
    // ready can always be resumed from durable evidence), then its row.
    let written: RouterAbProtocolResult<CloudflareTenantRootInitialCreationPersistenceOutcomeV1> =
        async {
            host.put_managed_backup(&managed_backup, &[]).await?;
            let (TenantRootRoleCreationCompletionV1::RoleOnly {
                provider_canary_receipt,
            }
            | TenantRootRoleCreationCompletionV1::Initiator {
                provider_canary_receipt,
                ..
            }) = &completion;
            host.put_provider_canary(
                backup_coordinates,
                provider_canary_receipt,
                &role_signer.verifying_key_bytes(),
                &[],
            )
            .await?;
            store
                .persist_initial_creation(*input, role_signer, now_ms, now_ms, now_ms)
                .await
                .map_err(|error| tenant_root_store_error_v1("tenant-root role persistence", error))
        }
        .await;
    let committed = written.and_then(|outcome| match outcome {
        CloudflareTenantRootInitialCreationPersistenceOutcomeV1::Committed { receipt_bytes } => {
            Ok(receipt_bytes)
        }
        CloudflareTenantRootInitialCreationPersistenceOutcomeV1::InProgress => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root role persistence is already in progress",
            ))
        }
        CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayCompleted { .. } => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root role persistence completed before this live attempt",
            ))
        }
        CloudflareTenantRootInitialCreationPersistenceOutcomeV1::ReplayFailed { .. } => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ReplayedLocalRequest,
                "tenant-root role persistence previously failed",
            ))
        }
    });
    let receipt_bytes = match committed {
        Ok(receipt_bytes) => receipt_bytes,
        Err(error) => {
            // An attempt that did not commit its own row may have written
            // after the abandonment cleaned this role: an attempt admitted
            // before the window closed, refused by the tombstone, or a
            // concurrent duplicate that found another attempt's record. The
            // tombstone says the lineage is abandoned, so this role's initial
            // backup and canary go, whoever wrote them. Written before the
            // tombstone, they are removed by the cleanup's own delete, which
            // follows it.
            if store
                .creation_tombstoned(binding.identity_digest(), binding.custody_lineage())
                .await
                .map_err(|error| tenant_root_store_error_v1("tenant-root tombstone lookup", error))?
            {
                host.delete_managed_backup(backup_coordinates).await?;
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "tenant-root creation was abandoned while this role was writing; its backup and canary were removed",
                ));
            }
            return Err(error);
        }
    };
    let verified_package = verify_tenant_root_role_creation_package_v1(
        package_bytes,
        role,
        authority_id,
        trusted_issuer_keys,
        role_signer,
    )?;
    let command = verified_package.command();
    let context = verified_package.creation_context();
    let commitment =
        decode_verified_creation_commitment_v1(&signed_commitment, context, role, role_keys)?;
    let evidence_key = role_keys
        .for_role_and_key_id(role, context.signing_key_id(role))
        .map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root creation evidence names an unpublished role signing key",
            )
        })?;
    let evidence = TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        &signed_installation_evidence,
        evidence_key,
    )
    .map_err(candidate_derivation_error)?;
    tenant_root_creation_commitment_call_v1(host, role_keys, command, &commitment).await?;
    tenant_root_creation_installation_call_v1(host, command, &evidence).await?;
    let local_role = CloudflareTenantRootCreateRoleV1::from_protocol(role);
    Ok(match completion {
        TenantRootRoleCreationCompletionV1::RoleOnly {
            provider_canary_receipt,
        } => CloudflareDeriverTenantRootCreateRoleShareResponseV1::PeerCompleted {
            role: local_role,
            signed_commitment_b64u: crate::encode_base64url_bytes_v1(&signed_commitment),
            signed_installation_evidence_b64u: crate::encode_base64url_bytes_v1(
                &signed_installation_evidence,
            ),
            signed_managed_backup_b64u: crate::encode_base64url_bytes_v1(&signed_managed_backup),
            terminal_receipt_b64u: crate::encode_base64url_bytes_v1(&receipt_bytes),
            provider_canary_receipt_b64u: crate::encode_base64url_bytes_v1(
                &provider_canary_receipt,
            ),
        },
        TenantRootRoleCreationCompletionV1::Initiator {
            provider_canary_receipt,
            peer,
        } => {
            let (
                deriver_a_signed_commitment,
                deriver_b_signed_commitment,
                deriver_a_signed_installation_evidence,
                deriver_b_signed_installation_evidence,
                deriver_a_signed_managed_backup,
                deriver_b_signed_managed_backup,
                deriver_a_terminal_receipt,
                deriver_b_terminal_receipt,
                ecdsa_provider_canary_receipt,
                ed25519_provider_canary_receipt,
            ) = match role {
                TwoPartyDeriverRole::DeriverA => (
                    signed_commitment,
                    peer.signed_commitment,
                    signed_installation_evidence,
                    peer.signed_installation_evidence,
                    signed_managed_backup,
                    peer.signed_managed_backup,
                    receipt_bytes,
                    peer.terminal_receipt,
                    provider_canary_receipt,
                    peer.provider_canary_receipt,
                ),
                TwoPartyDeriverRole::DeriverB => (
                    peer.signed_commitment,
                    signed_commitment,
                    peer.signed_installation_evidence,
                    signed_installation_evidence,
                    peer.signed_managed_backup,
                    signed_managed_backup,
                    peer.terminal_receipt,
                    receipt_bytes,
                    peer.provider_canary_receipt,
                    provider_canary_receipt,
                ),
            };
            CloudflareDeriverTenantRootCreateRoleShareResponseV1::Completed {
                role: local_role,
                deriver_a_signed_commitment_b64u: crate::encode_base64url_bytes_v1(
                    &deriver_a_signed_commitment,
                ),
                deriver_b_signed_commitment_b64u: crate::encode_base64url_bytes_v1(
                    &deriver_b_signed_commitment,
                ),
                deriver_a_signed_installation_evidence_b64u: crate::encode_base64url_bytes_v1(
                    &deriver_a_signed_installation_evidence,
                ),
                deriver_b_signed_installation_evidence_b64u: crate::encode_base64url_bytes_v1(
                    &deriver_b_signed_installation_evidence,
                ),
                deriver_a_signed_managed_backup_b64u: crate::encode_base64url_bytes_v1(
                    &deriver_a_signed_managed_backup,
                ),
                deriver_b_signed_managed_backup_b64u: crate::encode_base64url_bytes_v1(
                    &deriver_b_signed_managed_backup,
                ),
                deriver_a_terminal_receipt_b64u: crate::encode_base64url_bytes_v1(
                    &deriver_a_terminal_receipt,
                ),
                deriver_b_terminal_receipt_b64u: crate::encode_base64url_bytes_v1(
                    &deriver_b_terminal_receipt,
                ),
                ecdsa_provider_canary_receipt_b64u: crate::encode_base64url_bytes_v1(
                    &ecdsa_provider_canary_receipt,
                ),
                ed25519_provider_canary_receipt_b64u: crate::encode_base64url_bytes_v1(
                    &ed25519_provider_canary_receipt,
                ),
            }
        }
    })
}

/// Creates, or completes, this Deriver's tenant-root role share.
///
/// The initiator commits, drives its peer and finalizes within one call; the
/// peer completes against the initiator's signed commitment. Each role then
/// seals its share, stores its managed backup, persists its pending row and
/// checkpoints its commitment and installation at the creation state.
pub async fn tenant_root_deriver_create_role_share_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootCreateRoleShareRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootCreateRoleShareResponseV1> {
    let worker_role = host.worker_role();
    let role = tenant_root_creation_protocol_role_v1(worker_role)?;
    let reader = host.env();
    let trusted_issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(reader)?;
    let role_keys =
        crate::env::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(reader)?;
    let (_, role_signer) =
        crate::env::load_tenant_root_creation_role_signing_key_v1(worker_role, reader)?;
    let provider_config = tenant_root_role_runtime_provider_config_v1(worker_role, reader)?;
    let store = host
        .role_store()
        .map_err(|error| tenant_root_store_error_v1("tenant-root role store lookup", error))?;
    let mut online_provider =
        crate::env::load_tenant_root_operational_rotation_provider_v1(worker_role, reader)?;
    let mut backup_provider =
        crate::env::load_tenant_root_operational_rotation_provider_v1(worker_role, reader)?;
    let mut rng = crate::CloudflareSignerProofGetrandomRngV1;

    let (progress, package_bytes, authority_id) = match request {
        CloudflareDeriverTenantRootCreateRoleShareRequestV1::Initiator {
            role_creation_command_package_b64u,
            peer_role_creation_command_package_b64u,
        } => {
            let package_bytes = crate::decode_base64url_bytes_v1(
                "tenant-root role creation package",
                &role_creation_command_package_b64u,
            )?;
            let peer_package_bytes = crate::decode_base64url_bytes_v1(
                "tenant-root peer role creation package",
                &peer_role_creation_command_package_b64u,
            )?;
            let authority_id = tenant_root_creation_package_authority_v1(host, &package_bytes)?;
            require_fresh_tenant_root_creation_v1(
                &store,
                &package_bytes,
                role,
                authority_id,
                &trusted_issuer_keys,
                &role_signer,
                now_ms,
            )
            .await?;
            let initiator_package = verify_tenant_root_role_creation_package_v1(
                &package_bytes,
                role,
                authority_id,
                &trusted_issuer_keys,
                &role_signer,
            )?;
            let initiator_context = initiator_package.creation_context().clone();
            let mut peer = TenantRootCreationPeerV1 {
                host,
                expected_role: role.peer(),
                initiator_command: initiator_package.into_command(),
                initiator_context,
                role_keys: &role_keys,
            };
            let progress = drive_tenant_root_role_creation_as_initiator_v1(
                &package_bytes,
                &peer_package_bytes,
                role,
                authority_id,
                &trusted_issuer_keys,
                &role_keys,
                &role_signer,
                &provider_config,
                &mut online_provider,
                &mut backup_provider,
                &mut peer,
                now_ms,
                &mut rng,
            )
            .await?;
            (progress, package_bytes, authority_id)
        }
        CloudflareDeriverTenantRootCreateRoleShareRequestV1::PeerCompletion {
            role_creation_command_package_b64u,
            initiator_signed_commitment_b64u,
        } => {
            let package_bytes = crate::decode_base64url_bytes_v1(
                "tenant-root role creation package",
                &role_creation_command_package_b64u,
            )?;
            let initiator_signed_commitment = crate::decode_base64url_bytes_v1(
                "tenant-root initiator signed commitment",
                &initiator_signed_commitment_b64u,
            )?;
            let authority_id = tenant_root_creation_package_authority_v1(host, &package_bytes)?;
            require_fresh_tenant_root_creation_v1(
                &store,
                &package_bytes,
                role,
                authority_id,
                &trusted_issuer_keys,
                &role_signer,
                now_ms,
            )
            .await?;
            let progress = execute_tenant_root_role_creation_v1(
                &package_bytes,
                Some(&initiator_signed_commitment),
                role,
                authority_id,
                &trusted_issuer_keys,
                &role_keys,
                &role_signer,
                &provider_config,
                &mut online_provider,
                &mut backup_provider,
                now_ms,
                &mut rng,
            )
            .await?;
            (progress, package_bytes, authority_id)
        }
    };
    persist_tenant_root_creation_progress_v1(
        host,
        role,
        &package_bytes,
        authority_id,
        &trusted_issuer_keys,
        &role_keys,
        &role_signer,
        &store,
        progress,
        now_ms,
    )
    .await
}

#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_create_role_share_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    peer_binding: &crate::CloudflarePeerBindingV1,
    request: CloudflareDeriverTenantRootCreateRoleShareRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootCreateRoleShareResponseV1> {
    tenant_root_deriver_create_role_share_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, Some(peer_binding)),
        request,
        now_ms,
    )
    .await
}

/// Requires the Router's creation state to hold an abandonment fence written at
/// `issued_at_ms` for the ceremony `target` names, listing the role as
/// installed exactly when the target is bound to installation evidence, and
/// returns the instant at which the fence's cleanup commands are judged. The
/// ceremony is read from the Router's issuer-signed journal.
pub(super) async fn require_router_abandonment_of_role_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    target: &TenantRootRoleCleanupTargetV1,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_keys: &std::collections::BTreeMap<String, [u8; 32]>,
    issued_at_ms: u64,
) -> RouterAbProtocolResult<u64> {
    let (recorded, session_id, ceremony_nonce) = match target {
        TenantRootRoleCleanupTargetV1::Pending {
            session_id,
            ceremony_nonce,
            ..
        } => (true, *session_id, *ceremony_nonce),
        TenantRootRoleCleanupTargetV1::AbandonedCeremony {
            session_id,
            ceremony_nonce,
            ..
        } => (false, *session_id, *ceremony_nonce),
        TenantRootRoleCleanupTargetV1::Retired { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "a retired-share cleanup does not execute a creation abandonment",
            ))
        }
    };
    let role = target.role();
    let progress = crate::durable_object::tenant_root_creation::tenant_root_creation_progress_read_call_v1(
        host,
        target.identity_digest(),
        target.custody_lineage(),
    )
    .await?;
    let crate::durable_object::tenant_root_creation::CloudflareTenantRootCreationProgressV1::Started {
        state,
        ..
    } = progress
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root pending cleanup names a creation the Router never started",
        ));
    };
    let journal = crate::durable_object::tenant_root_creation::validate_creation_record(
        crate::durable_object::tenant_root_creation::CloudflareTenantRootCreationJournalRecordV1 {
            journal_b64u: state.journal_b64u.clone(),
            creation_capability_b64u: state.creation_capability_b64u.clone(),
        },
        authority_id,
        trusted_issuer_keys,
    )?;
    if journal.ceremony_context.session_id() != session_id
        || journal.ceremony_context.nonce() != ceremony_nonce
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root pending cleanup names another ceremony than the Router's",
        ));
    }
    match state.abandonment {
        Some(abandonment)
            if abandonment.abandoned_at_ms == issued_at_ms
                && abandonment
                    .installed_roles
                    .iter()
                    .any(|installed| installed.to_protocol() == role)
                    == recorded =>
        {
            Ok(
                crate::durable_object::tenant_root_creation::tenant_root_abandonment_decided_at_ms_v1(
                    abandonment.abandoned_at_ms,
                ),
            )
        }
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root pending cleanup is not the Router's abandonment of this role",
        )),
    }
}

/// Reads back this role's stored activation evidence for its pending initial
/// share: the signed managed backup and provider canary receipt it wrote
/// before its installation checkpoint. It writes nothing and refuses a share
/// that is already active.
pub async fn tenant_root_deriver_creation_evidence_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootCreationEvidenceRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootCreationEvidenceResponseV1> {
    let worker_role = host.worker_role();
    let role = tenant_root_creation_protocol_role_v1(worker_role)?;
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(
        crate::decode_base64url_bytes_v1(
            "tenant-root creation evidence identity digest",
            &request.identity_digest_b64u,
        )?
        .try_into()
        .map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "tenant-root creation evidence identity digest must contain 32 bytes",
            )
        })?,
    );
    let custody_lineage = TenantRootCustodyLineageId::from_base64url(&request.custody_lineage_b64u)
        .map_err(candidate_derivation_error)?;
    let store = host
        .role_store()
        .map_err(|error| tenant_root_store_error_v1("tenant-root role store lookup", error))?;
    let stored = store
        .load_initial_pending_for_activation(identity_digest, custody_lineage)
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root pending share lookup", error))?;
    if !matches!(
        stored.record().lifecycle(),
        CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
    ) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root role share is already active; there is no creation to resume",
        ));
    }
    let (_, role_signer) =
        crate::env::load_tenant_root_creation_role_signing_key_v1(worker_role, host.env())?;
    let trusted_role_key = role_signer.verifying_key_bytes();
    let coordinates = crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1::new(
        identity_digest,
        custody_lineage,
        tenant_root_managed_restore_role_v1(role),
        TenantRootShareEpoch::INITIAL,
    );
    let managed_backup = host.get_managed_backup(coordinates, &trusted_role_key).await?;
    let provider_canary = host.get_provider_canary(coordinates, &trusted_role_key).await?;
    Ok(CloudflareDeriverTenantRootCreationEvidenceResponseV1 {
        role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
        signed_managed_backup_b64u: crate::encode_base64url_bytes_v1(
            managed_backup.canonical_bytes(),
        ),
        provider_canary_receipt_b64u: crate::encode_base64url_bytes_v1(&provider_canary),
    })
}

#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_creation_evidence_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootCreationEvidenceRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootCreationEvidenceResponseV1> {
    tenant_root_deriver_creation_evidence_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
    )
    .await
}

/// Removes the exact role-share row an issuer-signed cleanup command
/// authorizes, and that row's managed backup.
pub async fn tenant_root_deriver_cleanup_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootCleanupRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootCleanupResponseV1> {
    let worker_role = host.worker_role();
    let role = tenant_root_creation_protocol_role_v1(worker_role)?;
    let command_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root cleanup command",
        &request.cleanup_command_b64u,
    )?;
    let command = TenantRootRoleCleanupCommandV1::decode_canonical_bytes(&command_bytes)
        .map_err(candidate_derivation_error)?;
    let claimed_target = command.claimed_target();
    let (claimed_identity_digest, claimed_custody_lineage, claimed_epoch, is_retired) =
        match &claimed_target {
            TenantRootRoleCleanupTargetV1::Pending {
                identity_digest,
                custody_lineage,
                epoch,
                ..
            } => (*identity_digest, *custody_lineage, *epoch, false),
            TenantRootRoleCleanupTargetV1::AbandonedCeremony {
                identity_digest,
                custody_lineage,
                ..
            } => (
                *identity_digest,
                *custody_lineage,
                TenantRootShareEpoch::INITIAL,
                false,
            ),
            TenantRootRoleCleanupTargetV1::Retired {
                identity_digest,
                custody_lineage,
                retired_epoch,
                ..
            } => (*identity_digest, *custody_lineage, *retired_epoch, true),
        };
    let authority_id =
        host.creation_authority_id(claimed_identity_digest, claimed_custody_lineage)?;
    let reader = host.env();
    let trusted_issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(reader)?;
    let issuer_key_id = command.issuer_key_id().to_owned();
    let trusted_issuer_key = trusted_issuer_keys
        .for_issuer_key_id(&issuer_key_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root cleanup command issuer is not trusted by this Worker",
            )
        })?;
    let authorization = command
        .verify(
            &claimed_target,
            role,
            authority_id,
            &issuer_key_id,
            trusted_issuer_key,
        )
        .map_err(candidate_derivation_error)?;
    // A pending creation's cleanup executes the Router's abandonment. The
    // Deriver confirms the Router's fence names this role and that the command
    // was issued for that fence, then judges the command's freshness at the
    // fence, so an interrupted abandonment finishes however late it is
    // retried. A command for any other decision is refused.
    let reserved_at_ms = if is_retired {
        now_ms
    } else {
        // An installed role is cleaned by evidence; a role the fence does not
        // list, by its ceremony.
        require_router_abandonment_of_role_v1(
            host,
            authorization.target(),
            authority_id,
            trusted_issuer_keys.keys(),
            authorization.issued_at_ms(),
        )
        .await?
    };
    let (_, role_signer) =
        crate::env::load_tenant_root_creation_role_signing_key_v1(worker_role, reader)?;
    let store = host
        .role_store()
        .map_err(|error| tenant_root_store_error_v1("tenant-root role store lookup", error))?;
    if is_retired {
        let admitted_at_or_before_ms =
            now_ms.saturating_sub(host.admission_recovery_window_ms()?);
        // An admission whose pair a wallet object holds is settled or
        // cancelled only on that object's word. The object reports a
        // completed pair at any age, which recovers a settlement whose
        // acknowledgement was lost. Past W it also fences a pair that is not
        // claimed, and the admission is then cancelled.
        let wallet_object_admissions = store
            .unsettled_wallet_object_admissions(
                claimed_identity_digest,
                claimed_custody_lineage,
                claimed_epoch,
            )
            .await
            .map_err(|error| tenant_root_store_error_v1("tenant-root wallet-object admissions", error))?;
        for admission in &wallet_object_admissions {
            let fence = u64::try_from(admission.admitted_at_ms)
                .is_ok_and(|admitted_at_ms| admitted_at_ms <= admitted_at_or_before_ms);
            let reconciliation = host
                .reconcile_wallet_object_pair(
                    &admission.pair_object_id,
                    &crate::tenant_root_role_d1::TenantRootWalletPairReconcileRequestV1 {
                        session_hex: admission.attempt_key_hex.clone(),
                        fence,
                        peer_settled: false,
                        now_ms,
                    },
                )
                .await?;
            // Deriver A's executor claimed the pair: its messages may still
            // reach Deriver B. Past W, B is fenced first, or found completed,
            // and only then may A's object fence the claimed pair.
            let reconciliation = if fence
                && reconciliation
                    == crate::tenant_root_role_d1::TenantRootWalletPairReconciliationV1::Claimed
            {
                fence_peer_pair_v1(
                    host,
                    claimed_identity_digest,
                    claimed_custody_lineage,
                    claimed_epoch,
                    &admission.attempt_key_hex,
                )
                .await?;
                host.reconcile_wallet_object_pair(
                    &admission.pair_object_id,
                    &crate::tenant_root_role_d1::TenantRootWalletPairReconcileRequestV1 {
                        session_hex: admission.attempt_key_hex.clone(),
                        fence: true,
                        peer_settled: true,
                        now_ms,
                    },
                )
                .await?
            } else {
                reconciliation
            };
            store
                .record_wallet_object_reconciliation(
                    &admission.attempt_key_hex,
                    &admission.pair_object_id,
                    reconciliation,
                )
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1("tenant-root wallet-object reconciliation", error)
                })?;
        }
        // Deriver A's claimed attempts whose pairs are in this store: past W,
        // Deriver B is fenced first, or found completed. A cannot complete
        // without B, so its delayed messages can then cause nothing more.
        // Cancelling the admission refuses A's own completion here. Until B
        // answers, the attempt stays pending.
        let claimed_attempts = store
            .claimed_yao_admissions(
                claimed_identity_digest,
                claimed_custody_lineage,
                claimed_epoch,
                admitted_at_or_before_ms,
            )
            .await
            .map_err(|error| tenant_root_store_error_v1("tenant-root claimed admissions", error))?;
        for session_hex in &claimed_attempts {
            fence_peer_pair_v1(
                host,
                claimed_identity_digest,
                claimed_custody_lineage,
                claimed_epoch,
                session_hex,
            )
            .await?;
            store
                .cancel_yao_admission(
                    claimed_identity_digest,
                    claimed_custody_lineage,
                    session_hex,
                    true,
                )
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1("tenant-root claimed admission cancellation", error)
                })?;
        }
        // Work admitted on the retired epoch may still need its share. The
        // role store refuses the erasure until every such admission is
        // settled or cancelled; this says so before the command is reserved.
        let mut remaining = unsettled_root_use_admissions_v1(
            &store,
            claimed_identity_digest,
            claimed_custody_lineage,
            claimed_epoch,
        )
        .await?;
        if remaining > 0 {
            // Recovery, W after admission: cancel only what this store can
            // fence. That is an admission not yet claimed whose pair, if any,
            // is here. Deriver A's claim and each role's completion then
            // refuse it, and an ECDSA read is used only if its settlement
            // won. A claimed admission was recovered above once its peer
            // answered, and stays pending until it does. One whose pair is in
            // a wallet object was reconciled above, on that object's word. An
            // operator-issued cleanup obeys the same rule.
            store
                .cancel_unclaimed_root_use_admissions(
                    claimed_identity_digest,
                    claimed_custody_lineage,
                    claimed_epoch,
                    admitted_at_or_before_ms,
                )
                .await
                .map_err(|error| {
                    tenant_root_store_error_v1("tenant-root unclaimed admission cancellation", error)
                })?;
            remaining = unsettled_root_use_admissions_v1(
                &store,
                claimed_identity_digest,
                claimed_custody_lineage,
                claimed_epoch,
            )
            .await?;
        }
        if remaining > 0 {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
                format!(
                    "retirement of epoch {} is pending here: {remaining} admitted operation(s) are not settled",
                    claimed_epoch.get().get()
                ),
            ));
        }
    }
    let receipt_bytes = store
        .persist_authorized_cleanup(authorization, &role_signer, reserved_at_ms, now_ms, now_ms)
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root pending cleanup", error))?;
    let r2_deletion = host
        .delete_managed_backup(
            crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1::new(
                claimed_identity_digest,
                claimed_custody_lineage,
                tenant_root_managed_restore_role_v1(role),
                claimed_epoch,
            ),
        )
        .await?;
    let role = CloudflareTenantRootCreateRoleV1::from_protocol(role);
    let cleanup_receipt_b64u = crate::encode_base64url_bytes_v1(&receipt_bytes);
    if is_retired {
        // Read from the admission rows, which outlive the erasure, so a replay
        // of this command reports the same count.
        let cancelled_admissions = cancelled_root_use_admissions_v1(
            &store,
            claimed_identity_digest,
            claimed_custody_lineage,
            claimed_epoch,
        )
        .await?;
        Ok(
            CloudflareDeriverTenantRootCleanupResponseV1::RetiredDeleted {
                role,
                cleanup_receipt_b64u,
                r2_deletion,
                cryptographic_erasure:
                    CloudflareTenantRootCryptographicErasureStatusV1::CryptographicErasureUnverified,
                cancelled_admissions,
            },
        )
    } else {
        Ok(
            CloudflareDeriverTenantRootCleanupResponseV1::PendingDeleted {
                role,
                cleanup_receipt_b64u,
            },
        )
    }
}

/// Removes the exact pending row authorized by the control-plane issuer.
#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_cleanup_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    peer_binding: &crate::CloudflarePeerBindingV1,
    request: CloudflareDeriverTenantRootCleanupRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootCleanupResponseV1> {
    tenant_root_deriver_cleanup_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, Some(peer_binding)),
        request,
        now_ms,
    )
    .await
}

/// Deriver B's side of Deriver A's retirement recovery on Cloudflare.
#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_peer_pair_fence_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootPeerPairFenceRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootPeerPairFenceResponseV1> {
    tenant_root_deriver_fence_peer_pair_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await
}
