//! Restore-refresh and initial-activation persistence, and the object's request dispatch.

use super::*;

/// Admits, advances or reads the destination's restore-refresh checkpoint.
pub(crate) async fn tenant_root_restore_refresh_checkpoint_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    request: CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootRestoreRefreshCheckpointResponseV1> {
    let read = match &request {
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::ReadCompleted {
            restore_refresh_grant_b64u,
            manifest_b64u,
        } => Some((restore_refresh_grant_b64u, manifest_b64u, false)),
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::ReadPromoted {
            restore_refresh_grant_b64u,
            manifest_b64u,
        } => Some((restore_refresh_grant_b64u, manifest_b64u, true)),
        _ => None,
    };
    if let Some((grant_b64u, manifest_b64u, promoted)) = read {
        let (canonical_grant_b64u, grant, scope) =
            restore_refresh_checkpoint_scope_from_grant_v1(grant_b64u)?;
        if &canonical_grant_b64u != grant_b64u {
            return Err(malformed_input(
                "tenant-root restore-refresh grant must use canonical bytes",
            ));
        }
        require_restore_refresh_manifest_matches_grant_v1(manifest_b64u, &grant)?;
        store.require_scope(grant.destination_identity_digest(), grant.destination_lineage())?;
        let checkpoint = store
            .get_json::<CloudflareTenantRootRestoreRefreshCheckpointV1>(
                TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_STORAGE_KEY_V1,
            )
            .await?
            .ok_or_else(|| {
                restore_refresh_lifecycle_error(if promoted {
                    "tenant-root restore-refresh promoted checkpoint is not present"
                } else {
                    "tenant-root restore-refresh completed checkpoint is not present"
                })
            })?;
        return if promoted {
            evaluate_restore_refresh_promoted_read_v1(
                &checkpoint,
                grant_b64u,
                &scope,
                store.authority_id(),
                now_ms,
            )
        } else {
            evaluate_restore_refresh_completed_read_v1(
                &checkpoint,
                grant_b64u,
                &scope,
                store.authority_id(),
                now_ms,
            )
        };
    }
    let grant_b64u = restore_refresh_checkpoint_grant_b64u_v1(&request);
    let (_, grant, _) = restore_refresh_checkpoint_scope_from_grant_v1(grant_b64u)?;
    store.require_scope(grant.destination_identity_digest(), grant.destination_lineage())?;
    let current = store
        .get_json::<CloudflareTenantRootRestoreRefreshCheckpointV1>(
            TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_STORAGE_KEY_V1,
        )
        .await?;
    let evaluation =
        evaluate_tenant_root_restore_refresh_checkpoint_v1(current.as_ref(), request, now_ms)?;
    if let CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Commit { checkpoint } =
        &evaluation
    {
        let encoded = serde_json::to_vec(checkpoint).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                format!("tenant-root restore-refresh checkpoint JSON encoding failed: {error}"),
            )
        })?;
        if encoded.len() > TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_RESPONSE_MAX_BYTES_V1 {
            return Err(malformed_input(
                "tenant-root restore-refresh checkpoint exceeds its maximum size",
            ));
        }
        store
            .put_json(TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_STORAGE_KEY_V1, checkpoint)
            .await?;
    }
    Ok(restore_refresh_checkpoint_phase_response_v1(evaluation))
}

/// Activates a restored root from its promoted restore-refresh checkpoint.
/// The activation writes the authoritative active state and consumes the
/// destination's bootstrap authority, leaving only its destroyed marker; an
/// exact retry returns the same outcome.
pub(crate) async fn tenant_root_restore_initial_activation_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    request: CloudflareTenantRootRestoreInitialActivationRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRestoreInitialActivationResponseV1> {
    let authority_id = store.authority_id();
    let activation_receipt =
        decode_and_verify_initial_activation_receipt(&request.activation_receipt_b64u, issuer_keys)?;
    store.require_scope(
        activation_receipt.identity_digest(),
        activation_receipt.custody_lineage(),
    )?;
    if activation_receipt.binding().authority_id() != authority_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore initial activation receipt authority does not match its creation state",
        ));
    }
    let receipt_digest = activation_receipt.digest();
    let lifecycle_revision = activation_receipt.result_control_plane_revision();
    let checkpoint = store
        .get_json::<CloudflareTenantRootRestoreRefreshCheckpointV1>(
            TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            restore_refresh_lifecycle_error(
                "tenant-root restore initial activation has no refresh checkpoint",
            )
        })?;
    let (destination_fingerprint, restore_session_id) =
        validate_restore_initial_activation_receipt_against_checkpoint_v1(
            &activation_receipt,
            &checkpoint,
            authority_id,
        )?;
    let existing_destroyed = store
        .get_json::<CloudflareTenantRootDestinationBootstrapDestroyedRecordV1>(
            TENANT_ROOT_DESTINATION_BOOTSTRAP_DESTROYED_STORAGE_KEY_V1,
        )
        .await?;
    let had_destroyed_record = existing_destroyed.is_some();
    let destroyed_record = if let Some(record) = existing_destroyed {
        let record = validate_tenant_root_destination_bootstrap_destroyed_record_v1(record)
            .map_err(stored_record_error)?;
        let (destruction_receipt_b64u, destruction_receipt_digest_b64u) =
            restore_bootstrap_destruction_receipt_v1(
                activation_receipt.identity_digest(),
                activation_receipt.custody_lineage(),
                destination_fingerprint,
                restore_session_id,
                &checkpoint.scope.grant_digest_b64u,
                receipt_digest,
            )?;
        if record.identity_digest != activation_receipt.identity_digest()
            || record.custody_lineage != activation_receipt.custody_lineage()
            || record.deployment_fingerprint != destination_fingerprint
            || record.record.activation_receipt_digest_b64u
                != encode_base64url_bytes_v1(receipt_digest.as_bytes())
            || record.record.destruction_receipt_b64u != destruction_receipt_b64u
            || record.record.destruction_receipt_digest_b64u != destruction_receipt_digest_b64u
        {
            return Err(refresh_replay_conflict(
                "tenant-root restore bootstrap destruction conflicts with the accepted activation receipt",
            ));
        }
        record.record
    } else {
        let bootstrap = store
            .get_json::<CloudflareTenantRootDestinationBootstrapRecordV1>(
                TENANT_ROOT_DESTINATION_BOOTSTRAP_STORAGE_KEY_V1,
            )
            .await?
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLifecycleState,
                    "tenant-root restore initial activation has no usable bootstrap authority",
                )
            })?;
        let bootstrap = validate_tenant_root_destination_bootstrap_record_v1(bootstrap)
            .map_err(stored_record_error)?;
        if bootstrap.identity_digest != activation_receipt.identity_digest()
            || bootstrap.custody_lineage != activation_receipt.custody_lineage()
            || bootstrap.deployment_fingerprint != destination_fingerprint
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root restore bootstrap authority does not match the promoted activation",
            ));
        }
        let (destruction_receipt_b64u, destruction_receipt_digest_b64u) =
            restore_bootstrap_destruction_receipt_v1(
                bootstrap.identity_digest,
                bootstrap.custody_lineage,
                bootstrap.deployment_fingerprint,
                restore_session_id,
                &checkpoint.scope.grant_digest_b64u,
                receipt_digest,
            )?;
        CloudflareTenantRootDestinationBootstrapDestroyedRecordV1 {
            identity_b64u: bootstrap.record.identity_b64u,
            deployment_fingerprint_b64u: bootstrap.record.deployment_fingerprint_b64u,
            custody_lineage_b64u: bootstrap.record.custody_lineage_b64u,
            activation_receipt_digest_b64u: encode_base64url_bytes_v1(receipt_digest.as_bytes()),
            destruction_receipt_b64u,
            destruction_receipt_digest_b64u,
        }
    };
    let encoded_destroyed_record = serde_json::to_vec(&destroyed_record).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("tenant-root restore bootstrap destruction record encoding failed: {error}"),
        )
    })?;
    if encoded_destroyed_record.len()
        > TENANT_ROOT_DESTINATION_BOOTSTRAP_DESTROYED_RECORD_MAX_BYTES_V1
    {
        return Err(malformed_input(
            "tenant-root restore bootstrap destruction record exceeds its maximum size",
        ));
    }
    let candidate =
        refresh_active_state_record_from_verified_receipt(activation_receipt, lifecycle_revision)?;
    if !had_destroyed_record {
        tenant_root_creation_persist_active_state_v1(store, candidate, issuer_keys).await?;
        store
            .put_json(
                TENANT_ROOT_DESTINATION_BOOTSTRAP_DESTROYED_STORAGE_KEY_V1,
                &destroyed_record,
            )
            .await?;
    }
    store
        .delete(TENANT_ROOT_DESTINATION_BOOTSTRAP_STORAGE_KEY_V1)
        .await?;
    Ok(CloudflareTenantRootRestoreInitialActivationResponseV1 {
        activation_receipt_digest_b64u: encode_base64url_bytes_v1(receipt_digest.as_bytes()),
        lifecycle_revision,
        destruction_receipt_b64u: destroyed_record.destruction_receipt_b64u,
        destruction_receipt_digest_b64u: destroyed_record.destruction_receipt_digest_b64u,
    })
}

/// Serves one creation-state operation, addressed by its route path: initial
/// creation and its recovery, the authoritative active-state read with its
/// refresh and managed-restore reservations, the refresh checkpoints and
/// activation, and restore into a new deployment. Cutover is not served.
///
/// `destination_bootstrap_config` is the operator's provisioned bootstrap
/// record for a destination, when this Router has one.
///
/// The caller runs this inside one storage transaction over `store`, so each
/// operation's read, evaluation and write stay atomic.
#[allow(clippy::too_many_arguments)]
pub async fn tenant_root_creation_serve_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: impl Fn() -> RouterAbProtocolResult<TenantRootCreationRoleVerifyingKeysV1>,
    destination_bootstrap_config: Option<&str>,
    path: &str,
    request_body: &[u8],
    now_ms: u64,
    schedule: TenantRootRefreshScheduleV1,
) -> RouterAbProtocolResult<Vec<u8>> {
    fn decode<T: DeserializeOwned>(
        label: &str,
        body: &[u8],
        max_bytes: usize,
    ) -> RouterAbProtocolResult<T> {
        if body.len() > max_bytes {
            return Err(malformed_input(format!("{label} exceeds its maximum size")));
        }
        serde_json::from_slice(body)
            .map_err(|error| malformed_input(format!("{label} JSON is invalid: {error}")))
    }
    fn encode<T: Serialize>(value: &T) -> RouterAbProtocolResult<Vec<u8>> {
        serde_json::to_vec(value).map_err(|error| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                format!("tenant-root creation-state response encoding failed: {error}"),
            )
        })
    }
    match path {
        CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_PATH => encode(
            &tenant_root_creation_persist_journal_v1(
                store,
                issuer_keys,
                decode(
                    "tenant-root creation journal request",
                    request_body,
                    TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_CREATION_JOURNAL_READ_PATH => encode(
            &tenant_root_creation_read_journal_v1(
                store,
                issuer_keys,
                &role_keys,
                decode(
                    "tenant-root creation read request",
                    request_body,
                    TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
                )?,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_CREATION_PROGRESS_READ_PATH => encode(
            &tenant_root_creation_read_progress_v1(
                store,
                issuer_keys,
                &role_keys,
                decode(
                    "tenant-root creation progress request",
                    request_body,
                    TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_CREATION_ABANDONMENT_PATH => encode(
            &tenant_root_creation_persist_abandonment_v1(
                store,
                issuer_keys,
                &role_keys,
                decode(
                    "tenant-root creation abandonment request",
                    request_body,
                    TENANT_ROOT_CREATION_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_PATH => encode(
            &tenant_root_creation_persist_commitment_v1(
                store,
                issuer_keys,
                &role_keys()?,
                decode(
                    "tenant-root creation commitment request",
                    request_body,
                    TENANT_ROOT_CREATION_COMMITMENT_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_PATH => encode(
            &tenant_root_creation_persist_installation_v1(
                store,
                issuer_keys,
                &role_keys()?,
                decode(
                    "tenant-root installation request",
                    request_body,
                    TENANT_ROOT_CREATION_INSTALLATION_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_CREATION_CLEANUP_CHECKPOINT_PATH => encode(
            &tenant_root_creation_persist_cleanup_v1(
                store,
                issuer_keys,
                &role_keys()?,
                decode(
                    "tenant-root creation cleanup request",
                    request_body,
                    TENANT_ROOT_CREATION_CLEANUP_REQUEST_MAX_BYTES_V1,
                )?,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_CREATION_INITIAL_ACTIVATION_PATH => encode(
            &tenant_root_creation_persist_initial_activation_v1(
                store,
                issuer_keys,
                &role_keys()?,
                decode(
                    "tenant-root initial activation request",
                    request_body,
                    TENANT_ROOT_CREATION_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
                )?,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_CREATION_ACTIVE_STATE_READ_PATH => encode(
            &tenant_root_creation_active_state_read_v1(
                store,
                issuer_keys,
                &role_keys,
                decode(
                    "tenant-root active-state read request",
                    request_body,
                    TENANT_ROOT_CREATION_ACTIVE_STATE_READ_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
                schedule,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_REFRESH_ACTIVATION_PATH => encode(
            &tenant_root_refresh_persist_activation_v1(
                store,
                issuer_keys,
                &role_keys()?,
                decode(
                    "tenant-root refresh activation request",
                    request_body,
                    TENANT_ROOT_CREATION_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_PATH => encode(
            &tenant_root_refresh_persist_commitment_v1(
                store,
                issuer_keys,
                &role_keys()?,
                decode(
                    "tenant-root refresh commitment request",
                    request_body,
                    TENANT_ROOT_REFRESH_COMMITMENT_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_PATH => encode(
            &tenant_root_refresh_persist_installation_v1(
                store,
                issuer_keys,
                &role_keys()?,
                decode(
                    "tenant-root refresh installation request",
                    request_body,
                    TENANT_ROOT_REFRESH_INSTALLATION_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
            )
            .await?,
        ),
        CLOUDFLARE_TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_PATH => encode(
            &tenant_root_refresh_persist_contribution_v1(
                store,
                issuer_keys,
                &role_keys()?,
                decode(
                    "tenant-root refresh contribution request",
                    request_body,
                    TENANT_ROOT_REFRESH_CONTRIBUTION_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
            )
            .await?,
        ),
        crate::CLOUDFLARE_ROUTER_TENANT_ROOT_DESTINATION_BOOTSTRAP_PRIVATE_REQUEST_PATH => encode(
            &tenant_root_destination_bootstrap_v1(
                store,
                issuer_keys,
                &role_keys,
                destination_bootstrap_config,
                decode(
                    "tenant-root destination bootstrap request",
                    request_body,
                    TENANT_ROOT_DESTINATION_BOOTSTRAP_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
            )
            .await?,
        ),
        crate::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_REFRESH_PRIVATE_REQUEST_PATH => encode(
            &tenant_root_restore_refresh_checkpoint_v1(
                store,
                decode(
                    "tenant-root restore-refresh checkpoint request",
                    request_body,
                    TENANT_ROOT_RESTORE_REFRESH_CHECKPOINT_REQUEST_MAX_BYTES_V1,
                )?,
                now_ms,
            )
            .await?,
        ),
        crate::CLOUDFLARE_ROUTER_TENANT_ROOT_RESTORE_ACTIVATION_PRIVATE_REQUEST_PATH => encode(
            &tenant_root_restore_initial_activation_v1(
                store,
                issuer_keys,
                decode(
                    "tenant-root restore activation request",
                    request_body,
                    TENANT_ROOT_RESTORE_INITIAL_ACTIVATION_REQUEST_MAX_BYTES_V1,
                )?,
            )
            .await?,
        ),
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "this host does not serve the requested tenant-root creation-state operation",
        )),
    }
}
