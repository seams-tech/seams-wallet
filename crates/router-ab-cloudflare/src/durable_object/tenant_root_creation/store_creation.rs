//! Creation and destination-bootstrap persistence.

use super::*;

/// Checkpoints one role's cleanup of an abandoned creation: an issuer-signed
/// cleanup command and that role's successful terminal receipt. A role the
/// abandonment recorded as installed is cleaned by its installation evidence;
/// any other role by the abandoned ceremony. An exact replay returns the
/// recorded response.
pub(crate) async fn tenant_root_creation_persist_cleanup_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    request: CloudflareTenantRootCreationCleanupRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationCleanupResponseV1> {
    let authority_id = store.authority_id();
    let journal_record = store
        .get_json::<CloudflareTenantRootCreationJournalRecordV1>(
            TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root creation cleanup has no Started journal",
            )
        })?;
    let journal = validate_creation_record(journal_record, authority_id, issuer_keys)
        .map_err(stored_record_error)?;
    store.require_scope(journal.identity_digest, journal.custody_lineage)?;
    let installation = match store
        .get_json::<CloudflareTenantRootCreationInstallationCheckpointV1>(
            TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1,
        )
        .await?
    {
        None => None,
        Some(installation_record) => {
            let commitment_record = store
                .get_json::<CloudflareTenantRootCreationCommitmentRendezvousRecordV1>(
                    TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_STORAGE_KEY_V1,
                )
                .await?;
            let commitments = require_complete_creation_commitment_rendezvous(
                commitment_record,
                &journal,
                role_keys,
            )?;
            Some(
                validate_installation_checkpoint(
                    installation_record,
                    &journal,
                    role_keys,
                    &commitments,
                )
                .map_err(stored_record_error)?,
            )
        }
    };
    // Cleanup only executes an abandonment: the fence must already exist, and
    // it decides which material each role's cleanup targets.
    let abandonment = store
        .get_json::<CloudflareTenantRootCreationAbandonmentV1>(
            TENANT_ROOT_CREATION_ABANDONMENT_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root creation cleanup requires the creation to be abandoned first",
            )
        })?;
    validate_creation_abandonment_scope_v1(&abandonment, &journal)?;
    let command_bytes = decode_canonical_base64url(
        "tenant-root creation cleanup command",
        &request.cleanup_command_b64u,
        TENANT_ROOT_ROLE_CLEANUP_COMMAND_MAX_BYTES_V1,
        TENANT_ROOT_ROLE_CLEANUP_COMMAND_MAX_BASE64URL_BYTES_V1,
    )?;
    let role = CloudflareTenantRootCreationInstallationRoleV1::from_protocol(
        TenantRootRoleCleanupCommandV1::decode_canonical_bytes(&command_bytes)
            .map_err(candidate_derivation_error)?
            .claimed_target()
            .role(),
    );
    let candidate_record = creation_cleanup_checkpoint_record(request, &journal, role)?;
    let candidate = validate_creation_cleanup_checkpoint(
        candidate_record,
        &journal,
        &abandonment,
        installation.as_ref(),
        authority_id,
        issuer_keys,
        role_keys,
    )?;
    // The command executes this fence: it must have been issued at it, and its
    // freshness is judged there, so a cleanup interrupted by an outage can
    // still be checkpointed when it finishes.
    if candidate.authorization.issued_at_ms() != abandonment.abandoned_at_ms {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root creation cleanup command was not issued for this abandonment",
        ));
    }
    let checkpoint_key = tenant_root_creation_cleanup_checkpoint_storage_key_v1(role);
    let existing = store
        .get_json::<CloudflareTenantRootCreationCleanupCheckpointV1>(checkpoint_key)
        .await?;
    match evaluate_creation_cleanup_checkpoint(
        existing,
        candidate,
        &journal,
        &abandonment,
        installation.as_ref(),
        authority_id,
        issuer_keys,
        role_keys,
        tenant_root_abandonment_decided_at_ms_v1(abandonment.abandoned_at_ms),
    )? {
        TenantRootCreationCleanupEvaluationV1::Commit {
            checkpoint,
            response,
        } => {
            store.put_json(checkpoint_key, &checkpoint).await?;
            Ok(response)
        }
        TenantRootCreationCleanupEvaluationV1::Replay(response) => Ok(response),
    }
}

/// Reads the validated creation progress. Every stored record is re-validated
/// against the started journal; a corrupt record fails the read.
pub(crate) async fn tenant_root_creation_read_journal_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: impl FnOnce() -> RouterAbProtocolResult<TenantRootCreationRoleVerifyingKeysV1>,
    request: CloudflareTenantRootCreationJournalReadRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationJournalReadResponseV1> {
    Ok(read_creation_journal_state_v1(store, issuer_keys, role_keys, request)
        .await?
        .0)
}

/// Reads and validates the persisted creation state, returning its public
/// projection and the validated installation checkpoint behind it.
pub(super) async fn read_creation_journal_state_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: impl FnOnce() -> RouterAbProtocolResult<TenantRootCreationRoleVerifyingKeysV1>,
    request: CloudflareTenantRootCreationJournalReadRequestV1,
) -> RouterAbProtocolResult<(
    CloudflareTenantRootCreationJournalReadResponseV1,
    Option<ValidatedTenantRootCreationInstallationCheckpointV1>,
)> {
    let journal_record = store
        .get_json::<CloudflareTenantRootCreationJournalRecordV1>(
            TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root creation read has no Started journal",
            )
        })?;
    let journal = validate_creation_record(journal_record, store.authority_id(), issuer_keys)
        .map_err(stored_record_error)?;
    store.require_scope(journal.identity_digest, journal.custody_lineage)?;
    let rendezvous = store
        .get_json::<CloudflareTenantRootCreationCommitmentRendezvousRecordV1>(
            TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_STORAGE_KEY_V1,
        )
        .await?;
    let installation_record = store
        .get_json::<CloudflareTenantRootCreationInstallationCheckpointV1>(
            TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1,
        )
        .await?;
    let abandonment_record = store
        .get_json::<CloudflareTenantRootCreationAbandonmentV1>(
            TENANT_ROOT_CREATION_ABANDONMENT_STORAGE_KEY_V1,
        )
        .await?;
    let mut cleanup_checkpoints = Vec::new();
    if abandonment_record.is_some() {
        for role in [
            CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
            CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
        ] {
            if let Some(checkpoint) = store
                .get_json::<CloudflareTenantRootCreationCleanupCheckpointV1>(
                    tenant_root_creation_cleanup_checkpoint_storage_key_v1(role),
                )
                .await?
            {
                cleanup_checkpoints.push((role, checkpoint));
            }
        }
    }
    // Role keys are needed only to validate progress records.
    let role_keys = if rendezvous.is_some()
        || installation_record.is_some()
        || !cleanup_checkpoints.is_empty()
    {
        Some(role_keys()?)
    } else {
        None
    };
    // Progress is only reported from records that validate against the
    // Started journal and retained role keys. A corrupt record fails the
    // read rather than producing a misleading lifecycle projection.
    if let (Some(record), Some(role_keys)) = (&rendezvous, role_keys.as_ref()) {
        validate_creation_commitment_rendezvous(record.clone(), &journal, role_keys)
            .map_err(stored_record_error)?;
    }
    let installation_checkpoint = match installation_record {
        None => None,
        Some(record) => {
            let role_keys = role_keys.as_ref().ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    "tenant-root installation checkpoint has no role-key set",
                )
            })?;
            let commitments =
                require_complete_creation_commitment_rendezvous(rendezvous.clone(), &journal, role_keys)?;
            Some(
                validate_installation_checkpoint(record, &journal, role_keys, &commitments)
                    .map_err(stored_record_error)?,
            )
        }
    };
    let abandonment = read_creation_abandonment_v1(
        store.authority_id(),
        abandonment_record,
        cleanup_checkpoints,
        &journal,
        installation_checkpoint.as_ref(),
        issuer_keys,
        role_keys.as_ref(),
    )?;
    let response = build_creation_journal_read_response(
        &request,
        &journal,
        rendezvous.as_ref(),
        installation_checkpoint.as_ref(),
        abandonment,
    )?;
    Ok((response, installation_checkpoint))
}

pub(super) struct LoadedTenantRootRoleCreationCommandV1 {
    pub(super) journal: ValidatedTenantRootCreationJournalV1,
    pub(super) command: VerifiedTenantRootRoleCreationCommandV1,
}

pub(super) async fn load_tenant_root_role_creation_command_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    command_b64u: &str,
) -> RouterAbProtocolResult<LoadedTenantRootRoleCreationCommandV1> {
    let authority_id = store.authority_id();
    let journal_record = store
        .get_json::<CloudflareTenantRootCreationJournalRecordV1>(
            TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root role creation request has no Started journal",
            )
        })?;
    let journal = validate_creation_record(journal_record, authority_id, issuer_keys)
        .map_err(stored_record_error)?;
    store.require_scope(journal.identity_digest, journal.custody_lineage)?;
    let command = validate_role_creation_command(command_b64u, &journal, authority_id, issuer_keys)?;
    Ok(LoadedTenantRootRoleCreationCommandV1 { journal, command })
}

/// Records one role's signed creation commitment in the rendezvous once.
pub(crate) async fn tenant_root_creation_persist_commitment_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    request: CloudflareTenantRootCreationCommitmentRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationCommitmentResponseV1> {
    let loaded =
        load_tenant_root_role_creation_command_v1(store, issuer_keys, &request.role_creation_command_b64u)
            .await?;
    let commitment_bytes = decode_canonical_base64url(
        "tenant-root signed creation commitment",
        &request.signed_commitment_b64u,
        TENANT_ROOT_SIGNED_CREATION_COMMITMENT_MAX_BYTES_V1,
        TENANT_ROOT_CREATION_COMMITMENT_MAX_BASE64URL_BYTES_V1,
    )?;
    let response_scope = creation_response_scope(&loaded.command, &loaded.journal)?;
    require_creation_not_abandoned_v1(store, "tenant-root creation commitment").await?;
    let existing = store
        .get_json::<CloudflareTenantRootCreationCommitmentRendezvousRecordV1>(
            TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_STORAGE_KEY_V1,
        )
        .await?;
    let outcome = match evaluate_creation_commitment_rendezvous(
        existing,
        &commitment_bytes,
        &loaded.command,
        &loaded.journal,
        role_keys,
        now_ms,
    )? {
        TenantRootCreationCommitmentRendezvousEvaluationV1::Commit { rendezvous, outcome } => {
            store
                .put_json(TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_STORAGE_KEY_V1, &rendezvous)
                .await?;
            outcome
        }
        TenantRootCreationCommitmentRendezvousEvaluationV1::Replay(outcome) => outcome,
    };
    commitment_response(response_scope, &commitment_bytes, outcome)
}

/// Checkpoints one role's verified installation evidence once.
pub(crate) async fn tenant_root_creation_persist_installation_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    request: CloudflareTenantRootCreationInstallationRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationInstallationResponseV1> {
    let loaded =
        load_tenant_root_role_creation_command_v1(store, issuer_keys, &request.role_creation_command_b64u)
            .await?;
    let evidence = validate_installation_evidence_wire(
        &request.signed_evidence_b64u,
        &loaded.journal.ceremony_context,
        role_keys,
    )?;
    let response_scope = creation_response_scope(&loaded.command, &loaded.journal)?;
    let commitment_record = store
        .get_json::<CloudflareTenantRootCreationCommitmentRendezvousRecordV1>(
            TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_STORAGE_KEY_V1,
        )
        .await?;
    let commitments = require_complete_creation_commitment_rendezvous(
        commitment_record,
        &loaded.journal,
        role_keys,
    )?;
    let existing = store
        .get_json::<CloudflareTenantRootCreationInstallationCheckpointV1>(
            TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1,
        )
        .await?;
    require_creation_not_abandoned_v1(store, "tenant-root installation").await?;
    let outcome = match evaluate_installation_checkpoint(
        existing,
        evidence,
        &loaded.command,
        &loaded.journal,
        role_keys,
        &commitments,
        now_ms,
    )? {
        TenantRootCreationInstallationEvaluationV1::Commit { checkpoint, outcome } => {
            store
                .put_json(TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1, &checkpoint)
                .await?;
            outcome
        }
        TenantRootCreationInstallationEvaluationV1::Replay(outcome) => outcome,
    };
    installation_response(response_scope, outcome)
}

/// Accepts the issuer's initial activation receipt against the completed
/// creation state and installs the authoritative active state once.
pub(crate) async fn tenant_root_creation_persist_initial_activation_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    request: CloudflareTenantRootCreationInitialActivationRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationInitialActivationResponseV1> {
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
            "tenant-root initial activation receipt authority does not match its creation store",
        ));
    }
    let receipt_digest = activation_receipt.digest();
    let lifecycle_revision = activation_receipt.result_control_plane_revision();
    let journal_record = store
        .get_json::<CloudflareTenantRootCreationJournalRecordV1>(
            TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root initial activation has no Started journal",
            )
        })?;
    let journal = validate_creation_record(journal_record, authority_id, issuer_keys)
        .map_err(stored_record_error)?;
    let commitment_record = store
        .get_json::<CloudflareTenantRootCreationCommitmentRendezvousRecordV1>(
            TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_STORAGE_KEY_V1,
        )
        .await?;
    let commitments =
        require_complete_creation_commitment_rendezvous(commitment_record, &journal, role_keys)?;
    let installation_record = store
        .get_json::<CloudflareTenantRootCreationInstallationCheckpointV1>(
            TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root initial activation has no installation checkpoint",
            )
        })?;
    let installation =
        validate_installation_checkpoint(installation_record, &journal, role_keys, &commitments)
            .map_err(stored_record_error)?;
    validate_initial_activation_receipt_against_creation_state(
        &activation_receipt,
        &journal,
        &installation,
    )?;
    let candidate =
        refresh_active_state_record_from_verified_receipt(activation_receipt, lifecycle_revision)?;
    tenant_root_creation_persist_active_state_v1(store, candidate, issuer_keys).await?;
    Ok(CloudflareTenantRootCreationInitialActivationResponseV1 {
        activation_receipt_digest_b64u: encode_base64url_bytes_v1(receipt_digest.as_bytes()),
        lifecycle_revision,
    })
}

/// Installs the authoritative active state, or accepts an exact replay.
/// Writes the authoritative active state once. Every first activation of a
/// creation object, initial creation and managed restore alike, passes
/// through here, so this is where the abandonment fence is enforced.
pub(super) async fn tenant_root_creation_persist_active_state_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    candidate: CloudflareTenantRootRefreshActiveStateRecordV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
) -> RouterAbProtocolResult<()> {
    require_creation_not_abandoned_v1(store, "tenant-root activation").await?;
    let existing = store
        .get_json::<CloudflareTenantRootRefreshActiveStateRecordV1>(
            TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1,
        )
        .await?;
    let Some(existing) = existing else {
        return store
            .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &candidate)
            .await;
    };
    let existing_validated =
        validate_refresh_active_state_record(existing, store.authority_id(), issuer_keys)
            .map_err(stored_refresh_record_error)?;
    if refresh_active_state_projection(&existing_validated.record)
        == refresh_active_state_projection(&candidate)
    {
        Ok(())
    } else {
        Err(refresh_replay_conflict(
            "tenant-root refresh active state conflicts with the accepted activation receipt",
        ))
    }
}

/// Requires the stored abandonment fence to name this journal's creation.
pub(super) fn validate_creation_abandonment_scope_v1(
    record: &CloudflareTenantRootCreationAbandonmentV1,
    journal: &ValidatedTenantRootCreationJournalV1,
) -> RouterAbProtocolResult<()> {
    let context_digest = journal
        .ceremony_context
        .digest()
        .map_err(candidate_derivation_error)?;
    if record.journal_digest_b64u != encode_base64url_bytes_v1(journal.journal_digest.as_bytes())
        || record.identity_digest_b64u
            != encode_base64url_bytes_v1(journal.identity_digest.as_bytes())
        || record.custody_lineage_b64u != journal.custody_lineage.to_base64url()
        || record.ceremony_context_digest_b64u
            != encode_base64url_bytes_v1(context_digest.as_bytes())
    {
        return Err(malformed_input(
            "tenant-root creation abandonment scope is invalid",
        ));
    }
    Ok(())
}

/// Refuses an operation that would advance a creation once it is abandoned.
/// The fence and every such operation live in one creation object and each
/// runs in one storage transaction, so abandonment and activation exclude
/// each other.
pub(super) async fn require_creation_not_abandoned_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    operation: &str,
) -> RouterAbProtocolResult<()> {
    if store
        .get_json::<CloudflareTenantRootCreationAbandonmentV1>(
            TENANT_ROOT_CREATION_ABANDONMENT_STORAGE_KEY_V1,
        )
        .await?
        .is_some()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            format!("{operation} cannot follow abandonment of the creation"),
        ));
    }
    Ok(())
}

/// Projects the abandonment fence and the roles whose cleanup is checkpointed.
/// Both roles are cleaned, whether or not the fence recorded them installed.
pub(super) fn read_creation_abandonment_v1(
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    record: Option<CloudflareTenantRootCreationAbandonmentV1>,
    cleanup_checkpoints: Vec<(
        CloudflareTenantRootCreationInstallationRoleV1,
        CloudflareTenantRootCreationCleanupCheckpointV1,
    )>,
    journal: &ValidatedTenantRootCreationJournalV1,
    installation: Option<&ValidatedTenantRootCreationInstallationCheckpointV1>,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: Option<&TenantRootCreationRoleVerifyingKeysV1>,
) -> RouterAbProtocolResult<Option<CloudflareTenantRootCreationAbandonmentReadV1>> {
    let Some(record) = record else {
        return Ok(None);
    };
    validate_creation_abandonment_scope_v1(&record, journal).map_err(stored_record_error)?;
    let mut cleaned_roles = Vec::new();
    for (role, checkpoint) in cleanup_checkpoints {
        if checkpoint.role != role {
            return Err(stored_record_error(malformed_input(
                "tenant-root creation cleanup checkpoint is stored under another role",
            )));
        }
        let role_keys = role_keys.ok_or_else(|| {
            stored_record_error(malformed_input(
                "tenant-root creation cleanup checkpoint has no role-key set",
            ))
        })?;
        validate_creation_cleanup_checkpoint(
            checkpoint,
            journal,
            &record,
            installation,
            authority_id,
            issuer_keys,
            role_keys,
        )
        .map_err(stored_record_error)?;
        cleaned_roles.push(role);
    }
    Ok(Some(CloudflareTenantRootCreationAbandonmentReadV1 {
        abandoned_at_ms: record.abandoned_at_ms,
        installed_roles: record.installed_roles,
        cleaned_roles,
    }))
}

/// Abandons one creation that the Router has not committed, writing the fence
/// that stops it from advancing. Only once its ceremony window has closed:
/// inside the window it may still finish or resume, and an ordinary retry
/// must not cancel it. A committed creation is never abandoned.
pub(crate) async fn tenant_root_creation_persist_abandonment_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: impl FnOnce() -> RouterAbProtocolResult<TenantRootCreationRoleVerifyingKeysV1>,
    request: CloudflareTenantRootCreationJournalReadRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationAbandonmentResponseV1> {
    let (state, _) = read_creation_journal_state_v1(store, issuer_keys, role_keys, request).await?;
    let journal = validate_creation_record(
        CloudflareTenantRootCreationJournalRecordV1 {
            journal_b64u: state.journal_b64u.clone(),
            creation_capability_b64u: state.creation_capability_b64u.clone(),
        },
        store.authority_id(),
        issuer_keys,
    )?;
    if store
        .get_json::<CloudflareTenantRootRefreshActiveStateRecordV1>(
            TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1,
        )
        .await?
        .is_some()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "a committed tenant-root creation cannot be abandoned",
        ));
    }
    if let Some(existing) = state.abandonment {
        return Ok(CloudflareTenantRootCreationAbandonmentResponseV1 {
            installed_roles: existing.installed_roles,
            abandoned_at_ms: existing.abandoned_at_ms,
            replayed: true,
        });
    }
    let installed_roles = match &state.installation_checkpoint {
        CloudflareTenantRootCreationInstallationCheckpointReadStateV1::None => Vec::new(),
        CloudflareTenantRootCreationInstallationCheckpointReadStateV1::OneRoleReady {
            role, ..
        } => vec![*role],
        CloudflareTenantRootCreationInstallationCheckpointReadStateV1::BothRolesReady { .. } => {
            vec![
                CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
                CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
            ]
        }
    };
    if now_ms <= journal.ceremony_context.expires_at_ms() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root creation ceremony is still open; it resumes instead of being abandoned",
        ));
    }
    let record = CloudflareTenantRootCreationAbandonmentV1 {
        journal_digest_b64u: encode_base64url_bytes_v1(journal.journal_digest.as_bytes()),
        identity_digest_b64u: encode_base64url_bytes_v1(journal.identity_digest.as_bytes()),
        custody_lineage_b64u: journal.custody_lineage.to_base64url(),
        ceremony_context_digest_b64u: encode_base64url_bytes_v1(
            journal
                .ceremony_context
                .digest()
                .map_err(candidate_derivation_error)?
                .as_bytes(),
        ),
        installed_roles: installed_roles.clone(),
        abandoned_at_ms: now_ms,
    };
    store
        .put_json(TENANT_ROOT_CREATION_ABANDONMENT_STORAGE_KEY_V1, &record)
        .await?;
    Ok(CloudflareTenantRootCreationAbandonmentResponseV1 {
        installed_roles,
        abandoned_at_ms: now_ms,
        replayed: false,
    })
}

/// Reads one creation's progress for the Router coordinator: whether it has
/// started, its persisted state, and the committed activation receipt.
pub(crate) async fn tenant_root_creation_read_progress_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: impl FnOnce() -> RouterAbProtocolResult<TenantRootCreationRoleVerifyingKeysV1>,
    request: CloudflareTenantRootCreationJournalReadRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationProgressV1> {
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(decode_fixed_base64url_32(
        "tenant-root creation progress identity digest",
        &request.identity_digest_b64u,
    )?);
    let custody_lineage = decode_lineage_b64u(
        "tenant-root creation progress custody lineage",
        &request.custody_lineage_b64u,
    )?;
    store.require_scope(identity_digest, custody_lineage)?;
    if store
        .get_json::<CloudflareTenantRootCreationJournalRecordV1>(
            TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1,
        )
        .await?
        .is_none()
    {
        return Ok(CloudflareTenantRootCreationProgressV1::NotStarted);
    }
    let (state, _) = read_creation_journal_state_v1(store, issuer_keys, role_keys, request).await?;
    let ceremony_open = validate_creation_record(
        CloudflareTenantRootCreationJournalRecordV1 {
            journal_b64u: state.journal_b64u.clone(),
            creation_capability_b64u: state.creation_capability_b64u.clone(),
        },
        store.authority_id(),
        issuer_keys,
    )?
    .ceremony_context
    .expires_at_ms()
        >= now_ms;
    let committed_activation_receipt_b64u = match store
        .get_json::<CloudflareTenantRootRefreshActiveStateRecordV1>(
            TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1,
        )
        .await?
    {
        None => None,
        Some(record) => Some(
            validate_refresh_active_state_record(record, store.authority_id(), issuer_keys)
                .map_err(stored_refresh_record_error)?
                .record
                .activation_receipt_b64u,
        ),
    };
    Ok(CloudflareTenantRootCreationProgressV1::Started {
        state,
        committed_activation_receipt_b64u,
        ceremony_open,
    })
}

/// The Router's destination-bootstrap call to its creation state. The bearer
/// credential its caller presented travels inside the call, so every host
/// carries it the same way.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootDestinationBootstrapCallV1 {
    pub(crate) request: CloudflareTenantRootDestinationBootstrapRequestV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) token_b64u: Option<String>,
}

/// Decodes a presented bootstrap credential. A malformed one counts as
/// absent, so authentication is refused rather than the request rejected.
pub(crate) fn decode_destination_bootstrap_token_v1(
    value: &str,
) -> Option<DestinationBootstrapTokenV1> {
    let bytes = decode_canonical_base64url(
        "tenant-root destination bootstrap credential",
        value,
        32,
        base64url_len_for_bytes(32),
    )
    .ok()?;
    let bytes = <[u8; 32]>::try_from(bytes).ok()?;
    DestinationBootstrapTokenV1::from_bytes(bytes).ok()
}

/// Answers one Read or Authenticate request against the destination's
/// bootstrap authority. `configured_record_json` is the operator's
/// provisioned record; the first read of an empty authority persists it.
pub(crate) async fn tenant_root_destination_bootstrap_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: impl FnOnce() -> RouterAbProtocolResult<TenantRootCreationRoleVerifyingKeysV1>,
    configured_record_json: Option<&str>,
    call: CloudflareTenantRootDestinationBootstrapCallV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootDestinationBootstrapResponseV1> {
    let request = validate_tenant_root_destination_bootstrap_request_v1(call.request)?;
    let token = match &request {
        ValidatedTenantRootDestinationBootstrapRequestV1::Read { .. } => None,
        ValidatedTenantRootDestinationBootstrapRequestV1::Authenticate { .. } => call
            .token_b64u
            .as_deref()
            .and_then(decode_destination_bootstrap_token_v1),
    };
    let state = read_destination_bootstrap_state_v1(
        store,
        issuer_keys,
        role_keys,
        configured_record_json,
        &request,
    )
    .await?;
    let authenticated_at_ms = if matches!(
        (&state, &request),
        (
            TenantRootDestinationBootstrapStateV1::Ready(_),
            ValidatedTenantRootDestinationBootstrapRequestV1::Authenticate { .. }
        )
    ) {
        now_ms
    } else {
        0
    };
    Ok(evaluate_tenant_root_destination_bootstrap_request_v1(
        &state,
        &request,
        token.as_ref(),
        authenticated_at_ms,
    ))
}

pub(super) async fn read_destination_bootstrap_state_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: impl FnOnce() -> RouterAbProtocolResult<TenantRootCreationRoleVerifyingKeysV1>,
    configured_record_json: Option<&str>,
    request: &ValidatedTenantRootDestinationBootstrapRequestV1,
) -> RouterAbProtocolResult<TenantRootDestinationBootstrapStateV1> {
    let (identity_digest, custody_lineage) = destination_bootstrap_request_scope_v1(request);
    if let Err(error) = store.require_scope(identity_digest, custody_lineage) {
        if error.code() == RouterAbProtocolErrorCode::ForbiddenLocalBinding {
            return Ok(TenantRootDestinationBootstrapStateV1::ScopeMismatch);
        }
        return Err(error);
    }
    if let Some(destroyed_record) = store
        .get_json::<CloudflareTenantRootDestinationBootstrapDestroyedRecordV1>(
            TENANT_ROOT_DESTINATION_BOOTSTRAP_DESTROYED_STORAGE_KEY_V1,
        )
        .await?
    {
        let destroyed_record =
            validate_tenant_root_destination_bootstrap_destroyed_record_v1(destroyed_record)
                .map_err(stored_record_error)?;
        if !destroyed_record.matches_request_scope(request) {
            return Ok(TenantRootDestinationBootstrapStateV1::ScopeMismatch);
        }
        store
            .require_scope(
                destroyed_record.identity_digest,
                destroyed_record.custody_lineage,
            )
            .map_err(stored_record_error)?;
        return Ok(TenantRootDestinationBootstrapStateV1::Destroyed(
            destroyed_record,
        ));
    }
    let record = store
        .get_json::<CloudflareTenantRootDestinationBootstrapRecordV1>(
            TENANT_ROOT_DESTINATION_BOOTSTRAP_STORAGE_KEY_V1,
        )
        .await?;
    let needs_provisioning = record.is_none();
    let record = match record {
        Some(record) => record,
        None => {
            let Some(config) = configured_record_json else {
                return Ok(TenantRootDestinationBootstrapStateV1::Uninitialized);
            };
            if config.len() > TENANT_ROOT_DESTINATION_BOOTSTRAP_RECORD_MAX_BYTES_V1 {
                return Err(malformed_input(
                    "destination bootstrap configuration is too large",
                ));
            }
            serde_json::from_str(config)
                .map_err(|_| malformed_input("destination bootstrap configuration is invalid"))?
        }
    };
    let record = validate_tenant_root_destination_bootstrap_record_v1(record)
        .map_err(stored_record_error)?;
    if !record.matches_request_scope(request) {
        return Ok(TenantRootDestinationBootstrapStateV1::ScopeMismatch);
    }
    store
        .require_scope(record.identity_digest, record.custody_lineage)
        .map_err(stored_record_error)?;

    if store
        .get_json::<CloudflareTenantRootRefreshActiveStateRecordV1>(
            TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1,
        )
        .await?
        .is_some()
    {
        let active = load_refresh_active_state_v1(
            store,
            issuer_keys,
            "tenant-root destination bootstrap has no authoritative active public state",
        )
        .await
        .map_err(stored_refresh_record_error)?;
        if active.identity_digest != record.identity_digest
            || active.custody_lineage != record.custody_lineage
        {
            return Ok(TenantRootDestinationBootstrapStateV1::ScopeMismatch);
        }
        return Ok(TenantRootDestinationBootstrapStateV1::ActiveRootPresent(
            record,
        ));
    }
    let creation_journal = store
        .get_json::<CloudflareTenantRootCreationJournalRecordV1>(
            TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1,
        )
        .await?;
    let has_creation_progress = creation_journal.is_some()
        || store
            .get_json::<CloudflareTenantRootCreationCommitmentRendezvousRecordV1>(
                TENANT_ROOT_CREATION_COMMITMENT_RENDEZVOUS_STORAGE_KEY_V1,
            )
            .await?
            .is_some()
        || store
            .get_json::<CloudflareTenantRootCreationInstallationCheckpointV1>(
                TENANT_ROOT_CREATION_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1,
            )
            .await?
            .is_some()
        || store
            .get_json::<CloudflareTenantRootCreationAbandonmentV1>(
                TENANT_ROOT_CREATION_ABANDONMENT_STORAGE_KEY_V1,
            )
            .await?
            .is_some()
        || store
            .get_json::<String>(TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1)
            .await?
            .is_some()
        || store
            .get_json::<CloudflareTenantRootRefreshInstallationCheckpointRecordV1>(
                TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1,
            )
            .await?
            .is_some()
        || store
            .get_json::<CloudflareTenantRootRefreshContributionRendezvousRecordV1>(
                TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_STORAGE_KEY_V1,
            )
            .await?
            .is_some();
    if !has_creation_progress {
        if needs_provisioning {
            // Operator configuration may initialize an empty authority once.
            // The destroyed marker above prevents reissuing consumed
            // credentials.
            store
                .put_json(TENANT_ROOT_DESTINATION_BOOTSTRAP_STORAGE_KEY_V1, &record.record)
                .await?;
        }
        return Ok(TenantRootDestinationBootstrapStateV1::Ready(record));
    }
    if creation_journal.is_some() {
        tenant_root_creation_read_journal_v1(
            store,
            issuer_keys,
            role_keys,
            CloudflareTenantRootCreationJournalReadRequestV1 {
                identity_digest_b64u: encode_base64url_bytes_v1(identity_digest.as_bytes()),
                custody_lineage_b64u: custody_lineage.to_base64url(),
            },
        )
        .await
        .map_err(stored_record_error)?;
    }
    Ok(TenantRootDestinationBootstrapStateV1::CreationInProgress(
        record,
    ))
}
