//! The creation store trait and its refresh persistence.

use super::*;

/// One tenant root's creation state as a host sees it inside a transaction:
/// the Router-owned creation Durable Object on Cloudflare, or one row set of
/// the VM Router's SQLite store. The operations below are the same on both
/// hosts; each host runs them inside its own storage transaction.
#[allow(async_fn_in_trait)]
pub trait TenantRootCreationStoreV1 {
    /// The creation authority id this store is authoritative for.
    fn authority_id(&self) -> TenantRootControlPlaneAuthorityIdV1;
    /// Rejects a request for a tenant root this store is not authoritative for.
    fn require_scope(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<()>;
    async fn get_json<T: DeserializeOwned>(&self, key: &str) -> RouterAbProtocolResult<Option<T>>;
    async fn put_json<T: Serialize>(&self, key: &str, value: &T) -> RouterAbProtocolResult<()>;
    /// Removes one key; a key that is absent is left absent.
    async fn delete(&self, key: &str) -> RouterAbProtocolResult<()>;
}

/// Loads and validates the authoritative active public state. `missing` is
/// the refusal when none exists yet.
pub(super) async fn load_refresh_active_state_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    missing: &'static str,
) -> RouterAbProtocolResult<ValidatedTenantRootRefreshActiveStateV1> {
    let record = store
        .get_json::<CloudflareTenantRootRefreshActiveStateRecordV1>(
            TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLocalServiceConfig, missing)
        })?;
    validate_refresh_active_state_record(record, store.authority_id(), issuer_keys)
        .map_err(stored_refresh_record_error)
}

/// Projects the phase of the refresh attempt the fence holds, validating
/// every stored checkpoint against it. Role keys are loaded only when a
/// checkpoint exists.
pub(super) async fn read_refresh_job_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: impl FnOnce() -> RouterAbProtocolResult<TenantRootCreationRoleVerifyingKeysV1>,
    active: &ValidatedTenantRootRefreshActiveStateV1,
) -> RouterAbProtocolResult<Option<CloudflareTenantRootRefreshJobReadV1>> {
    let (attempt, executed) = match &active.record.fence {
        CloudflareTenantRootRefreshFenceV1::Open => (None, false),
        CloudflareTenantRootRefreshFenceV1::Reserved { attempt } => (Some(attempt), false),
        CloudflareTenantRootRefreshFenceV1::Executed { attempt } => (Some(attempt), true),
        CloudflareTenantRootRefreshFenceV1::Terminal { .. }
        | CloudflareTenantRootRefreshFenceV1::Abandoned { .. } => (None, false),
    };
    let commitment_encoded = store
        .get_json::<String>(TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1)
        .await?;
    let installation_record = store
        .get_json::<CloudflareTenantRootRefreshInstallationCheckpointRecordV1>(
            TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1,
        )
        .await?;
    let contribution_record = store
        .get_json::<CloudflareTenantRootRefreshContributionRendezvousRecordV1>(
            TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_STORAGE_KEY_V1,
        )
        .await?;

    let Some(attempt) = attempt else {
        if commitment_encoded.is_some()
            || installation_record.is_some()
            || contribution_record.is_some()
        {
            return Err(stored_refresh_record_error(malformed_input(
                "stored tenant-root refresh checkpoints do not match an active operation",
            )));
        }
        return Ok(None);
    };
    let context =
        decode_refresh_attempt_context_v1(attempt).map_err(stored_refresh_record_error)?;
    let expected_authority_id = store.authority_id();
    let command_a = validate_refresh_role_command(
        &attempt.deriver_a_refresh_command_b64u,
        active,
        &context,
        TwoPartyDeriverRole::DeriverA,
        expected_authority_id,
        issuer_keys,
    )
    .map_err(stored_refresh_record_error)?;
    let command_b = validate_refresh_role_command(
        &attempt.deriver_b_refresh_command_b64u,
        active,
        &context,
        TwoPartyDeriverRole::DeriverB,
        expected_authority_id,
        issuer_keys,
    )
    .map_err(stored_refresh_record_error)?;
    let expected_scope =
        refresh_checkpoint_scope(&command_a, active, &context, expected_authority_id)
            .map_err(stored_refresh_record_error)?;
    let has_checkpoint = commitment_encoded.is_some()
        || installation_record.is_some()
        || contribution_record.is_some();
    let role_keys = has_checkpoint.then(role_keys).transpose()?;

    let commitment_pair = match commitment_encoded {
        None => None,
        Some(encoded) => {
            let checkpoint = decode_refresh_commitment_checkpoint(&encoded)
                .map_err(stored_refresh_record_error)?;
            validate_refresh_commitment_checkpoint_scope(checkpoint.scope(), &expected_scope)
                .map_err(stored_refresh_record_error)?;
            let role_keys = role_keys.as_ref().ok_or_else(|| {
                stored_refresh_record_error(malformed_input(
                    "stored tenant-root refresh commitment checkpoint has no role-key set",
                ))
            })?;
            match checkpoint.state() {
                TenantRootRefreshCommitmentCheckpointStateV1::OneRoleCommitted {
                    role,
                    command_digest,
                    signed_commitment,
                } => {
                    validate_refresh_checkpoint_command_digest_v1(
                        *command_digest,
                        *role,
                        &command_a,
                        &command_b,
                    )
                    .map_err(stored_refresh_record_error)?;
                    let commitment =
                        verify_refresh_commitment_wire(signed_commitment, &context, role_keys)
                            .map_err(stored_refresh_record_error)?;
                    if commitment.role() != *role {
                        return Err(stored_refresh_record_error(malformed_input(
                            "stored tenant-root refresh commitment role does not match its wire",
                        )));
                    }
                    None
                }
                TenantRootRefreshCommitmentCheckpointStateV1::BothRolesCommitted {
                    deriver_a_command_digest,
                    deriver_b_command_digest,
                    ..
                } => {
                    validate_refresh_checkpoint_command_digest_v1(
                        *deriver_a_command_digest,
                        TwoPartyDeriverRole::DeriverA,
                        &command_a,
                        &command_b,
                    )
                    .and_then(|_| {
                        validate_refresh_checkpoint_command_digest_v1(
                            *deriver_b_command_digest,
                            TwoPartyDeriverRole::DeriverB,
                            &command_a,
                            &command_b,
                        )
                    })
                    .map_err(stored_refresh_record_error)?;
                    Some(
                        require_complete_refresh_commitment_checkpoint(
                            &checkpoint,
                            &context,
                            role_keys,
                        )
                        .map_err(stored_refresh_record_error)?,
                    )
                }
            }
        }
    };

    if let Some(record) = contribution_record.as_ref() {
        let commitments = commitment_pair.as_ref().ok_or_else(|| {
            stored_refresh_record_error(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "tenant-root refresh contribution has no complete commitment checkpoint",
            ))
        })?;
        let role_keys = role_keys.as_ref().ok_or_else(|| {
            stored_refresh_record_error(malformed_input(
                "stored tenant-root refresh contribution has no role-key set",
            ))
        })?;
        let contribution = validate_refresh_contribution_rendezvous(
            record.clone(),
            &expected_scope,
            &context,
            commitments,
            role_keys,
        )
        .map_err(stored_refresh_record_error)?;
        match contribution {
            ValidatedTenantRootRefreshContributionRendezvousStateV1::OneRole {
                role,
                command_digest,
                ..
            } => validate_refresh_checkpoint_command_digest_v1(
                command_digest,
                role,
                &command_a,
                &command_b,
            ),
            ValidatedTenantRootRefreshContributionRendezvousStateV1::BothRoles {
                deriver_a_command_digest,
                deriver_b_command_digest,
                ..
            } => validate_refresh_checkpoint_command_digest_v1(
                deriver_a_command_digest,
                TwoPartyDeriverRole::DeriverA,
                &command_a,
                &command_b,
            )
            .and_then(|_| {
                validate_refresh_checkpoint_command_digest_v1(
                    deriver_b_command_digest,
                    TwoPartyDeriverRole::DeriverB,
                    &command_a,
                    &command_b,
                )
            }),
        }
        .map_err(stored_refresh_record_error)?;
    }

    let phase = if executed {
        let commitments = commitment_pair.as_ref().ok_or_else(|| {
            stored_refresh_record_error(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "tenant-root refresh installation has no complete commitment checkpoint",
            ))
        })?;
        let installation_record = installation_record.ok_or_else(|| {
            stored_refresh_record_error(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "tenant-root executed refresh has no installation checkpoint",
            ))
        })?;
        let role_keys = role_keys.as_ref().ok_or_else(|| {
            stored_refresh_record_error(malformed_input(
                "stored tenant-root refresh installation checkpoint has no role-key set",
            ))
        })?;
        let installation = validate_refresh_installation_checkpoint(
            installation_record,
            &expected_scope,
            &context,
            role_keys,
            commitments,
            &active.commitments,
        )
        .map_err(stored_refresh_record_error)?;
        match &installation {
            ValidatedTenantRootRefreshInstallationStateV1::OneRole {
                role,
                command_digest,
                ..
            } => {
                validate_refresh_checkpoint_command_digest_v1(
                    *command_digest,
                    *role,
                    &command_a,
                    &command_b,
                )
                .map_err(stored_refresh_record_error)?;
                CloudflareTenantRootRefreshJobPhaseV1::Installing
            }
            ValidatedTenantRootRefreshInstallationStateV1::BothRoles {
                deriver_a_command_digest,
                deriver_b_command_digest,
                ..
            } => {
                validate_refresh_checkpoint_command_digest_v1(
                    *deriver_a_command_digest,
                    TwoPartyDeriverRole::DeriverA,
                    &command_a,
                    &command_b,
                )
                .and_then(|_| {
                    validate_refresh_checkpoint_command_digest_v1(
                        *deriver_b_command_digest,
                        TwoPartyDeriverRole::DeriverB,
                        &command_a,
                        &command_b,
                    )
                })
                .map_err(stored_refresh_record_error)?;
                CloudflareTenantRootRefreshJobPhaseV1::Verifying
            }
        }
    } else {
        if installation_record.is_some() {
            return Err(stored_refresh_record_error(malformed_input(
                "stored tenant-root installation checkpoint requires an executed refresh",
            )));
        }
        if !has_checkpoint {
            return Ok(None);
        }
        CloudflareTenantRootRefreshJobPhaseV1::Preparing
    };
    refresh_job_read_from_phase_v1(
        phase,
        attempt.manual_operation_id.clone(),
        context.issued_at_ms(),
    )
    .map_err(stored_refresh_record_error)
}

/// Reads the authoritative active state, or reserves a refresh admission, a
/// refresh attempt or a managed-restore authorization against it.
pub(crate) async fn tenant_root_creation_active_state_read_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: impl FnOnce() -> RouterAbProtocolResult<TenantRootCreationRoleVerifyingKeysV1>,
    request: CloudflareTenantRootCreationActiveStateReadRequestV1,
    now_ms: u64,
    schedule: TenantRootRefreshScheduleV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationActiveStateReadResponseV1> {
    let (identity_digest_b64u, custody_lineage_b64u) = match &request {
        CloudflareTenantRootCreationActiveStateReadRequestV1::Read {
            identity_digest_b64u,
            custody_lineage_b64u,
        }
        | CloudflareTenantRootCreationActiveStateReadRequestV1::ReserveRefresh {
            identity_digest_b64u,
            custody_lineage_b64u,
            ..
        }
        | CloudflareTenantRootCreationActiveStateReadRequestV1::ReserveRefreshAdmission {
            identity_digest_b64u,
            custody_lineage_b64u,
            ..
        }
        | CloudflareTenantRootCreationActiveStateReadRequestV1::ReserveManagedRestore {
            identity_digest_b64u,
            custody_lineage_b64u,
            ..
        }
        | CloudflareTenantRootCreationActiveStateReadRequestV1::CheckpointManagedRestore {
            identity_digest_b64u,
            custody_lineage_b64u,
            ..
        }
        | CloudflareTenantRootCreationActiveStateReadRequestV1::RecordDelivery {
            identity_digest_b64u,
            custody_lineage_b64u,
            ..
        }
        | CloudflareTenantRootCreationActiveStateReadRequestV1::RecordRetirement {
            identity_digest_b64u,
            custody_lineage_b64u,
            ..
        }
        | CloudflareTenantRootCreationActiveStateReadRequestV1::ReadManagedRestoreCompletion {
            identity_digest_b64u,
            custody_lineage_b64u,
            ..
        } => (identity_digest_b64u, custody_lineage_b64u),
    };
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(decode_fixed_base64url_32(
        "tenant-root active-state read identity digest",
        identity_digest_b64u,
    )?);
    let custody_lineage = decode_lineage_b64u(
        "tenant-root active-state read custody lineage",
        custody_lineage_b64u,
    )?;
    store.require_scope(identity_digest, custody_lineage)?;
    let active = load_refresh_active_state_v1(
        store,
        issuer_keys,
        "tenant-root refresh has no authoritative active public state",
    )
    .await?;
    if active.identity_digest != identity_digest || active.custody_lineage != custody_lineage {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root active state does not match the requested identity and custody lineage",
        ));
    }
    match request {
        CloudflareTenantRootCreationActiveStateReadRequestV1::Read { .. } => {
            let job = read_refresh_job_v1(store, issuer_keys, role_keys, &active).await?;
            let mut response = active_state_read_response_from_record(active.record);
            response.job = job;
            Ok(response)
        }
        CloudflareTenantRootCreationActiveStateReadRequestV1::ReserveRefreshAdmission {
            operation_id,
            expected_lifecycle_revision,
            expires_at_ms,
            trigger,
            ..
        } => {
            let admission = reserve_refresh_admission_v1(
                store,
                issuer_keys,
                &active,
                identity_digest,
                custody_lineage,
                operation_id,
                expected_lifecycle_revision,
                expires_at_ms,
                trigger,
                now_ms,
                schedule,
            )
            .await?;
            let mut response = active_state_read_response_from_record(active.record);
            response.refresh_admission = Some(admission);
            Ok(response)
        }
        CloudflareTenantRootCreationActiveStateReadRequestV1::ReserveRefresh {
            refresh_context_b64u,
            deriver_a_refresh_command_b64u,
            deriver_b_refresh_command_b64u,
            manual_operation_id,
            ..
        } => {
            reserve_refresh_attempt_v1(
                store,
                issuer_keys,
                active,
                identity_digest,
                custody_lineage,
                refresh_context_b64u,
                deriver_a_refresh_command_b64u,
                deriver_b_refresh_command_b64u,
                manual_operation_id,
                now_ms,
            )
            .await
        }
        CloudflareTenantRootCreationActiveStateReadRequestV1::ReserveManagedRestore {
            authorization,
            ..
        } => {
            reserve_managed_restore_authorization_v1(
                store,
                issuer_keys,
                active,
                identity_digest,
                custody_lineage,
                authorization,
                now_ms,
            )
            .await
        }
        CloudflareTenantRootCreationActiveStateReadRequestV1::ReadManagedRestoreCompletion {
            public_state_b64u,
            capability_b64u,
            ..
        } => {
            let completion = store
                .get_json::<CloudflareTenantRootManagedRestoreCompletionV1>(
                    &managed_restore_completion_storage_key_v1(&capability_b64u),
                )
                .await?;
            let completed = match completion {
                Some(completion)
                    if completion.public_state_b64u == public_state_b64u
                        && completion.capability_b64u == capability_b64u =>
                {
                    Some(completion.response)
                }
                Some(_) => {
                    return Err(managed_restore_conflict(
                        "tenant-root managed-restore completion does not match the restore it names",
                    ))
                }
                None => None,
            };
            let mut response = active_state_read_response_from_record(active.record);
            response.managed_restore_completion = completed;
            Ok(response)
        }
        CloudflareTenantRootCreationActiveStateReadRequestV1::CheckpointManagedRestore {
            checkpoint,
            ..
        } => {
            checkpoint_managed_restore_authorization_v1(
                store,
                issuer_keys,
                active,
                identity_digest,
                custody_lineage,
                checkpoint,
                now_ms,
            )
            .await
        }
        CloudflareTenantRootCreationActiveStateReadRequestV1::RecordDelivery {
            activation_receipt_digest_b64u,
            role,
            swap,
            ..
        } => {
            let active_epoch = active.active_epoch;
            let initial_creation = active.activation_receipt.transition()
                == TenantRootActivationReceiptTransitionV1::InitialCreation;
            let mut record = active.record;
            if initial_creation
                && record.delivery.is_none()
                && record.activation_receipt_digest_b64u == activation_receipt_digest_b64u
            {
                record.delivery = Some(CloudflareTenantRootDeliveryV1::pending(
                    activation_receipt_digest_b64u.clone(),
                ));
            }
            match record.delivery.as_mut() {
                // An acknowledgement for a receipt that is no longer the
                // committed one changes nothing.
                Some(delivery)
                    if delivery.activation_receipt_digest_b64u
                        == activation_receipt_digest_b64u
                        && record.activation_receipt_digest_b64u
                            == activation_receipt_digest_b64u =>
                {
                    let (slot, retirement_slot) = match role {
                        CloudflareTenantRootCreationInstallationRoleV1::DeriverA => (
                            &mut delivery.deriver_a,
                            delivery.retirement.as_mut().map(|retirement| {
                                (retirement.retired_epoch, &mut retirement.deriver_a)
                            }),
                        ),
                        CloudflareTenantRootCreationInstallationRoleV1::DeriverB => (
                            &mut delivery.deriver_b,
                            delivery.retirement.as_mut().map(|retirement| {
                                (retirement.retired_epoch, &mut retirement.deriver_b)
                            }),
                        ),
                    };
                    if *slot == CloudflareTenantRootRoleDeliveryV1::Pending {
                        match (retirement_slot, swap) {
                            (None, None) => {}
                            (Some((retired_epoch, retirement)), Some(swap))
                                if swap.retired_epoch == retired_epoch
                                    && swap.active_epoch == active_epoch.get().get()
                                    && swap.retired_revision > 0
                                    && swap.active_revision > 0 =>
                            {
                                *retirement = Some(CloudflareTenantRootRoleRetirementV1 {
                                    retired_revision: swap.retired_revision,
                                    active_revision: swap.active_revision,
                                    swapped_at_ms: now_ms,
                                    erasure: None,
                                });
                            }
                            _ => {
                                return Err(RouterAbProtocolError::new(
                                    RouterAbProtocolErrorCode::MalformedWirePayload,
                                    "tenant-root delivery acknowledgement does not match the committed transition",
                                ));
                            }
                        }
                        *slot = CloudflareTenantRootRoleDeliveryV1::Delivered;
                        store
                            .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &record)
                            .await?;
                    }
                }
                _ => {}
            }
            Ok(active_state_read_response_from_record(record))
        }
        CloudflareTenantRootCreationActiveStateReadRequestV1::RecordRetirement {
            activation_receipt_digest_b64u,
            role,
            retired_epoch,
            erasure,
            ..
        } => {
            if erasure.cleanup_receipt_b64u.is_empty() {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    "tenant-root retirement record requires the role's cleanup receipt",
                ));
            }
            let mut record = active.record;
            // Only a retirement the committed swap's record holds is
            // recorded, once; a later report of the same erasure changes
            // nothing.
            if record.activation_receipt_digest_b64u == activation_receipt_digest_b64u {
                if let Some(retirement) = record
                    .delivery
                    .as_mut()
                    .filter(|delivery| {
                        delivery.activation_receipt_digest_b64u == activation_receipt_digest_b64u
                    })
                    .and_then(|delivery| delivery.retirement_of_mut(retired_epoch))
                    .and_then(|retirement| match role {
                        CloudflareTenantRootCreationInstallationRoleV1::DeriverA => {
                            retirement.deriver_a.as_mut()
                        }
                        CloudflareTenantRootCreationInstallationRoleV1::DeriverB => {
                            retirement.deriver_b.as_mut()
                        }
                    })
                    .filter(|retirement| retirement.erasure.is_none())
                {
                    retirement.erasure = Some(erasure);
                    store
                        .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &record)
                        .await?;
                }
            }
            Ok(active_state_read_response_from_record(record))
        }
    }
}

/// Reserves one managed-restore authorization on the active state's fence.
pub(super) async fn reserve_managed_restore_authorization_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    loaded_active: ValidatedTenantRootRefreshActiveStateV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    authorization: CloudflareTenantRootManagedRestoreAuthorizationRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationActiveStateReadResponseV1> {
    if loaded_active.identity_digest != identity_digest
        || loaded_active.custody_lineage != custody_lineage
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore reservation identity changed",
        ));
    }
    let authority_id = store.authority_id();
    let active = load_refresh_active_state_v1(
        store,
        issuer_keys,
        "tenant-root managed-restore reservation has no authoritative active public state",
    )
    .await?;
    if active.identity_digest != identity_digest || active.custody_lineage != custody_lineage {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore reservation identity changed",
        ));
    }
    let active =
        persist_managed_restore_reservation_expiry_v1(store, issuer_keys, active, now_ms).await?;
    let journal_record = store
        .get_json::<CloudflareTenantRootCreationJournalRecordV1>(
            TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root managed-restore reservation has no Started journal",
            )
        })?;
    let journal = validate_creation_record(journal_record, authority_id, issuer_keys)
        .map_err(stored_record_error)?;
    let evaluation =
        reserve_managed_restore_authorization_fence_v1(&active, &journal, authorization, now_ms)?;
    let response_record = match evaluation {
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit { fence } => {
            let mut candidate = active.record.clone();
            candidate.managed_restore_fence = fence;
            validate_refresh_active_state_record(candidate.clone(), authority_id, issuer_keys)?;
            store
                .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &candidate)
                .await?;
            candidate
        }
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { .. } => active.record,
    };
    Ok(active_state_read_response_from_record(response_record))
}

/// Checkpoints one issued managed-restore authorization on the fence the
/// reservation opened.
pub(super) async fn checkpoint_managed_restore_authorization_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    loaded_active: ValidatedTenantRootRefreshActiveStateV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    checkpoint: CloudflareTenantRootManagedRestoreAuthorizationCheckpointV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationActiveStateReadResponseV1> {
    if loaded_active.identity_digest != identity_digest
        || loaded_active.custody_lineage != custody_lineage
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore checkpoint identity changed",
        ));
    }
    let authority_id = store.authority_id();
    let active = load_refresh_active_state_v1(
        store,
        issuer_keys,
        "tenant-root managed-restore checkpoint has no authoritative active public state",
    )
    .await?;
    if active.identity_digest != identity_digest || active.custody_lineage != custody_lineage {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore checkpoint identity changed",
        ));
    }
    let active =
        persist_managed_restore_reservation_expiry_v1(store, issuer_keys, active, now_ms).await?;
    let journal_record = store
        .get_json::<CloudflareTenantRootCreationJournalRecordV1>(
            TENANT_ROOT_CREATION_JOURNAL_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root managed-restore checkpoint has no Started journal",
            )
        })?;
    let journal = validate_creation_record(journal_record, authority_id, issuer_keys)
        .map_err(stored_record_error)?;
    require_managed_restore_challenge_matches_started_journal_v1(
        &active,
        &journal,
        &checkpoint.challenge,
    )?;
    let evaluation = checkpoint_managed_restore_authorization_fence_v1(&active, checkpoint)?;
    let response_record = match evaluation {
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit { fence } => {
            let mut candidate = active.record.clone();
            candidate.managed_restore_fence = fence;
            validate_refresh_active_state_record(candidate.clone(), authority_id, issuer_keys)?;
            store
                .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &candidate)
                .await?;
            candidate
        }
        CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay { .. } => active.record,
    };
    Ok(active_state_read_response_from_record(response_record))
}

/// Admits one manual or scheduled refresh operation against the active state.
#[allow(clippy::too_many_arguments)]
pub(super) async fn reserve_refresh_admission_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    loaded_active: &ValidatedTenantRootRefreshActiveStateV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    operation_id: String,
    expected_lifecycle_revision: u64,
    expires_at_ms: u64,
    trigger: CloudflareTenantRootRefreshTriggerV1,
    now_ms: u64,
    schedule: TenantRootRefreshScheduleV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshAdmissionOutcomeV1> {
    validate_refresh_operation_id_v1(&operation_id)?;
    let authority_id = store.authority_id();
    let completion_key = manual_refresh_completion_storage_key_v1(&operation_id);
    let active = load_refresh_active_state_v1(
        store,
        issuer_keys,
        "tenant-root manual refresh admission has no authoritative active public state",
    )
    .await?;
    if active.identity_digest != loaded_active.identity_digest
        || active.custody_lineage != loaded_active.custody_lineage
        || active.identity_digest != identity_digest
        || active.custody_lineage != custody_lineage
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root manual refresh admission identity changed",
        ));
    }
    let completion = store
        .get_json::<CloudflareTenantRootRefreshCompletionV1>(&completion_key)
        .await?;
    let mut record = active.record.clone();
    // An expired restore reservation no longer holds the fence, so refresh
    // work it held back can be abandoned or admitted in the same step.
    expire_managed_restore_reservation_v1(&mut record, now_ms);
    let abandoned_operations = abandon_expired_refresh_v1(&mut record, now_ms)?;
    if record.fence != active.record.fence
        || record.manual_refresh_pending != active.record.manual_refresh_pending
        || record.managed_restore_fence != active.record.managed_restore_fence
    {
        validate_refresh_active_state_record(record.clone(), authority_id, issuer_keys)?;
        if record.fence != active.record.fence {
            // The abandoned attempt can never use its checkpoints again.
            store
                .delete(TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1)
                .await?;
            store
                .delete(TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1)
                .await?;
            store
                .delete(TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_STORAGE_KEY_V1)
                .await?;
        }
        for abandoned_operation_id in abandoned_operations {
            store
                .put_json(
                    &refresh_abandonment_storage_key_v1(&abandoned_operation_id),
                    &CloudflareTenantRootRefreshAbandonmentV1 {
                        operation_id: abandoned_operation_id.clone(),
                        abandoned_at_ms: now_ms,
                    },
                )
                .await?;
        }
        store
            .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &record)
            .await?;
    }
    let abandonment = store
        .get_json::<CloudflareTenantRootRefreshAbandonmentV1>(
            &refresh_abandonment_storage_key_v1(&operation_id),
        )
        .await?;
    let evaluation = evaluate_refresh_admission_v1(
        &record,
        completion,
        abandonment,
        &operation_id,
        trigger,
        active.identity_digest,
        active.activation_receipt.activated_at_ms(),
        expected_lifecycle_revision,
        expires_at_ms,
        now_ms,
        schedule,
    )
    .map_err(stored_refresh_record_error)?;
    Ok(match evaluation {
        CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit { pending } => {
            let mut candidate = record;
            candidate.manual_refresh_pending = Some(pending);
            validate_refresh_active_state_record(candidate.clone(), authority_id, issuer_keys)?;
            store
                .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &candidate)
                .await?;
            CloudflareTenantRootRefreshAdmissionOutcomeV1::Admitted {
                lifecycle_revision: candidate.lifecycle_revision,
            }
        }
        CloudflareTenantRootRefreshAdmissionEvaluationV1::Replay { response } => {
            CloudflareTenantRootRefreshAdmissionOutcomeV1::Replayed { response }
        }
        CloudflareTenantRootRefreshAdmissionEvaluationV1::Abandoned { abandoned_at_ms } => {
            CloudflareTenantRootRefreshAdmissionOutcomeV1::Abandoned { abandoned_at_ms }
        }
        CloudflareTenantRootRefreshAdmissionEvaluationV1::Throttled { retry_at_ms } => {
            CloudflareTenantRootRefreshAdmissionOutcomeV1::Throttled { retry_at_ms }
        }
        CloudflareTenantRootRefreshAdmissionEvaluationV1::RevisionMoved => {
            CloudflareTenantRootRefreshAdmissionOutcomeV1::RevisionMoved
        }
        CloudflareTenantRootRefreshAdmissionEvaluationV1::AuthorizationExpired => {
            CloudflareTenantRootRefreshAdmissionOutcomeV1::AuthorizationExpired
        }
        CloudflareTenantRootRefreshAdmissionEvaluationV1::NotDue { next_run_at_ms } => {
            CloudflareTenantRootRefreshAdmissionOutcomeV1::NotDue { next_run_at_ms }
        }
        CloudflareTenantRootRefreshAdmissionEvaluationV1::InProgress => {
            CloudflareTenantRootRefreshAdmissionOutcomeV1::InProgress
        }
        CloudflareTenantRootRefreshAdmissionEvaluationV1::RetirementPending => {
            CloudflareTenantRootRefreshAdmissionOutcomeV1::RetirementPending
        }
    })
}

/// Reserves one refresh attempt on the fence: both issuer-signed role
/// commands under one context. A different attempt replaces a terminal one
/// only together with its stale checkpoints.
#[allow(clippy::too_many_arguments)]
pub(super) async fn reserve_refresh_attempt_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    loaded_active: ValidatedTenantRootRefreshActiveStateV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    refresh_context_b64u: String,
    deriver_a_refresh_command_b64u: String,
    deriver_b_refresh_command_b64u: String,
    manual_operation_id: Option<String>,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationActiveStateReadResponseV1> {
    if let Some(operation_id) = &manual_operation_id {
        validate_refresh_operation_id_v1(operation_id)?;
    }
    let context_bytes = decode_canonical_base64url(
        "tenant-root refresh reservation context",
        &refresh_context_b64u,
        8 * 1024,
        base64url_len_for_bytes(8 * 1024),
    )?;
    let context = TenantRootCeremonyContextV1::decode_canonical_bytes(&context_bytes)
        .map_err(candidate_derivation_error)?;
    let expected_authority_id = store.authority_id();
    let active = load_refresh_active_state_v1(
        store,
        issuer_keys,
        "tenant-root refresh has no authoritative active public state",
    )
    .await?;
    if active.identity_digest != loaded_active.identity_digest
        || active.custody_lineage != loaded_active.custody_lineage
        || active.identity_digest != identity_digest
        || active.custody_lineage != custody_lineage
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh reservation identity changed",
        ));
    }
    let command_a = validate_refresh_role_command(
        &deriver_a_refresh_command_b64u,
        &active,
        &context,
        TwoPartyDeriverRole::DeriverA,
        expected_authority_id,
        issuer_keys,
    )?;
    let command_b = validate_refresh_role_command(
        &deriver_b_refresh_command_b64u,
        &active,
        &context,
        TwoPartyDeriverRole::DeriverB,
        expected_authority_id,
        issuer_keys,
    )?;
    let mut attempt = refresh_attempt_from_commands(&context, &command_a, &command_b)?;
    attempt.manual_operation_id = manual_operation_id.clone();
    if let Some(operation_id) = &manual_operation_id {
        match &active.record.manual_refresh_pending {
            Some(pending)
                if pending.operation_id == *operation_id
                    && pending.lifecycle_revision == active.record.lifecycle_revision => {}
            _ => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ConflictingPair,
                    "tenant-root manual refresh reservation is not admitted",
                ));
            }
        }
        if matches!(
            &active.record.managed_restore_fence,
            CloudflareTenantRootManagedRestoreFenceV1::Reserved { .. }
        ) {
            return Err(manual_refresh_in_progress_error());
        }
    } else if active.record.manual_refresh_pending.is_some() {
        return Err(manual_refresh_in_progress_error());
    }
    require_fresh_refresh_command(&command_a, &context, now_ms)
        .and_then(|_| require_fresh_refresh_command(&command_b, &context, now_ms))?;
    let response_record = match &active.record.fence {
        CloudflareTenantRootRefreshFenceV1::Open => {
            let mut record = active.record.clone();
            record.fence = CloudflareTenantRootRefreshFenceV1::Reserved { attempt };
            // Never persist a state its next read would refuse.
            validate_refresh_active_state_record(record.clone(), expected_authority_id, issuer_keys)?;
            store
                .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &record)
                .await?;
            record
        }
        CloudflareTenantRootRefreshFenceV1::Reserved { attempt: stored }
        | CloudflareTenantRootRefreshFenceV1::Executed { attempt: stored } => {
            validate_refresh_attempt_packages(stored)?;
            if stored.manual_operation_id != manual_operation_id {
                return Err(manual_refresh_in_progress_error());
            }
            active.record.clone()
        }
        CloudflareTenantRootRefreshFenceV1::Abandoned {
            attempt: stored, ..
        } if stored == &attempt => {
            return Err(refresh_attempt_abandoned_error());
        }
        CloudflareTenantRootRefreshFenceV1::Abandoned { .. } => {
            let mut record = active.record.clone();
            record.fence = CloudflareTenantRootRefreshFenceV1::Reserved { attempt };
            // Never persist a state its next read would refuse.
            validate_refresh_active_state_record(record.clone(), expected_authority_id, issuer_keys)?;
            store
                .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &record)
                .await?;
            record
        }
        CloudflareTenantRootRefreshFenceV1::Terminal {
            attempt: stored, ..
        } => {
            if stored == &attempt {
                active.record.clone()
            } else {
                let mut record = active.record.clone();
                record.fence = CloudflareTenantRootRefreshFenceV1::Reserved { attempt };
                validate_refresh_active_state_record(
                    record.clone(),
                    expected_authority_id,
                    issuer_keys,
                )?;
                store
                    .delete(TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1)
                    .await?;
                store
                    .delete(TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1)
                    .await?;
                store
                    .delete(TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_STORAGE_KEY_V1)
                    .await?;
                store
                    .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &record)
                    .await?;
                record
            }
        }
    };
    let CloudflareTenantRootRefreshActiveStateRecordV1 {
        activation_receipt_b64u,
        activation_receipt_digest_b64u,
        identity_digest_b64u,
        custody_lineage_b64u,
        lifecycle_revision,
        fence,
        managed_restore_fence,
        last_manual_refresh_completed_at_ms,
        last_refresh_completed_at_ms,
        delivery,
        manual_refresh_pending,
        ..
    } = response_record;
    Ok(CloudflareTenantRootCreationActiveStateReadResponseV1 {
        last_manual_refresh_completed_at_ms,
        last_refresh_completed_at_ms,
        activation_receipt_b64u,
        activation_receipt_digest_b64u,
        identity_digest_b64u,
        custody_lineage_b64u,
        lifecycle_revision,
        fence,
        managed_restore_fence,
        job: None,
        refresh_admission: None,
        refresh_pending: manual_refresh_pending,
        managed_restore_completion: None,
        delivery,
    })
}

/// Makes an issuer-signed refresh-swap receipt the authoritative active
/// state, once both roles' installations are checkpointed, and clears the
/// attempt's checkpoints. An exact replay changes nothing.
pub(crate) async fn tenant_root_refresh_persist_activation_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    request: CloudflareTenantRootRefreshActivationRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshActivationResponseV1> {
    let activation_receipt = decode_and_verify_refresh_activation_receipt(
        &request.activation_receipt_b64u,
        issuer_keys,
    )?;
    let authority_id = store.authority_id();
    store.require_scope(
        activation_receipt.identity_digest(),
        activation_receipt.custody_lineage(),
    )?;
    if activation_receipt.binding().authority_id() != authority_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation receipt authority does not match its Durable Object",
        ));
    }
    let receipt_digest = activation_receipt.digest();
    let lifecycle_revision = activation_receipt.result_control_plane_revision();
    if activation_receipt.transition() != TenantRootActivationReceiptTransitionV1::RefreshSwap {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh active state requires a refresh-swap receipt",
        ));
    }
    let candidate =
        refresh_active_state_record_from_verified_receipt(activation_receipt, lifecycle_revision)?;
    persist_refresh_active_state_v1(store, candidate, issuer_keys, role_keys, now_ms).await?;
    Ok(CloudflareTenantRootRefreshActivationResponseV1 {
        activation_receipt_digest_b64u: encode_base64url_bytes_v1(receipt_digest.as_bytes()),
        lifecycle_revision,
    })
}

pub(super) async fn persist_refresh_active_state_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    mut candidate: CloudflareTenantRootRefreshActiveStateRecordV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    now_ms: u64,
) -> RouterAbProtocolResult<()> {
    let authority_id = store.authority_id();
    let existing_record = store
        .get_json::<CloudflareTenantRootRefreshActiveStateRecordV1>(
            TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root refresh activation has no authoritative active public state",
            )
        })?;
    let existing = validate_refresh_active_state_record(existing_record, authority_id, issuer_keys)
        .map_err(stored_refresh_record_error)?;
    if refresh_active_state_projection(&existing.record)
        == refresh_active_state_projection(&candidate)
    {
        return Ok(());
    }

    let attempt = match &existing.record.fence {
        CloudflareTenantRootRefreshFenceV1::Executed { attempt } => attempt.clone(),
        CloudflareTenantRootRefreshFenceV1::Open
        | CloudflareTenantRootRefreshFenceV1::Reserved { .. } => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "tenant-root refresh activation requires an executed refresh attempt",
            ));
        }
        CloudflareTenantRootRefreshFenceV1::Terminal { .. } => {
            return Err(refresh_replay_conflict(
                "tenant-root refresh activation conflicts with the terminal refresh state",
            ));
        }
        CloudflareTenantRootRefreshFenceV1::Abandoned { .. } => {
            return Err(refresh_attempt_abandoned_error());
        }
    };
    let manual_operation_id = attempt.manual_operation_id.clone();
    // A managed restore is complete once its own forward refresh commits.
    let completes_managed_restore = matches!(
        &existing.record.managed_restore_fence,
        CloudflareTenantRootManagedRestoreFenceV1::Terminal { challenge, .. }
            if attempt.manual_operation_id.is_none()
                && attempt.current_epoch == challenge.active_epoch
                && attempt.expected_control_plane_revision == challenge.active_lifecycle_revision
    );
    apply_refresh_completion_transition_v1(
        &existing.record,
        &mut candidate,
        manual_operation_id.as_deref(),
        now_ms,
    )?;
    candidate.fence = CloudflareTenantRootRefreshFenceV1::Terminal {
        attempt,
        outcome: CloudflareTenantRootRefreshTerminalOutcomeV1::Completed,
        response: refresh_terminal_response_from_record(&candidate),
    };
    // Its fence is retired then, so later refreshes and a later restore
    // validate against the state they change; its outcome moves to a
    // completion record, which an exact retry of the restore reads.
    let mut managed_restore_completion = None;
    candidate.managed_restore_fence = match &existing.record.managed_restore_fence {
        CloudflareTenantRootManagedRestoreFenceV1::Open => {
            CloudflareTenantRootManagedRestoreFenceV1::Open
        }
        CloudflareTenantRootManagedRestoreFenceV1::Terminal {
            public_state_b64u,
            capability_b64u,
            ..
        } if completes_managed_restore => {
            managed_restore_completion = Some(CloudflareTenantRootManagedRestoreCompletionV1 {
                public_state_b64u: public_state_b64u.clone(),
                capability_b64u: capability_b64u.clone(),
                response: refresh_terminal_response_from_record(&candidate),
            });
            CloudflareTenantRootManagedRestoreFenceV1::Open
        }
        // Another refresh completed before the authorized restore ran: that
        // refresh needed both roles, and the restore's capability names the
        // state it replaced. The restore is recorded as superseded.
        CloudflareTenantRootManagedRestoreFenceV1::Terminal { challenge, attempt, .. } => {
            CloudflareTenantRootManagedRestoreFenceV1::Superseded {
                challenge: challenge.clone(),
                attempt: attempt.clone(),
                superseded_at_revision: candidate.lifecycle_revision,
            }
        }
        // An expired or superseded restore stays on record until a new
        // reservation replaces it.
        CloudflareTenantRootManagedRestoreFenceV1::Expired { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Superseded { .. } => {
            existing.record.managed_restore_fence.clone()
        }
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { .. } => {
            return Err(managed_restore_conflict(
                "tenant-root refresh activation conflicts with a reserved managed-restore authorization",
            ));
        }
    };

    let candidate_state =
        validate_refresh_active_state_record(candidate.clone(), authority_id, issuer_keys)?;
    validate_refresh_active_state_transition_v1(&existing, &candidate_state)?;

    let expected_scope =
        refresh_activation_checkpoint_scope_v1(&existing, &candidate_state.activation_receipt)?;
    let commitment_encoded = store
        .get_json::<String>(TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1)
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "tenant-root refresh activation has no commitment checkpoint",
            )
        })?;
    let commitment_checkpoint = decode_refresh_commitment_checkpoint(&commitment_encoded)
        .map_err(stored_refresh_record_error)?;
    validate_refresh_commitment_checkpoint_scope(commitment_checkpoint.scope(), &expected_scope)
        .map_err(stored_refresh_record_error)?;
    let deriver_a_commitment = commitment_checkpoint
        .state()
        .deriver_a_signed_commitment()
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "tenant-root refresh activation requires both commitments",
            )
        })?;
    let commitment = TenantRootSignedRefreshCommitmentV1::decode_canonical_bytes(deriver_a_commitment)
        .map_err(candidate_derivation_error)?;
    let context = commitment.transcript().context().clone();
    let commitments =
        require_complete_refresh_commitment_checkpoint(&commitment_checkpoint, &context, role_keys)
            .map_err(stored_refresh_record_error)?;
    let installation_record = store
        .get_json::<CloudflareTenantRootRefreshInstallationCheckpointRecordV1>(
            TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1,
        )
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "tenant-root refresh activation has no installation checkpoint",
            )
        })?;
    let installation = validate_refresh_installation_checkpoint(
        installation_record,
        &expected_scope,
        &context,
        role_keys,
        &commitments,
        &existing.commitments,
    )
    .map_err(stored_refresh_record_error)?;
    let ValidatedTenantRootRefreshInstallationStateV1::BothRoles {
        deriver_a,
        deriver_b,
        root_commitment,
        ..
    } = installation
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingPairPreparation,
            "tenant-root refresh activation requires both roles ready",
        ));
    };
    let next_commitments = verify_tenant_root_refresh_installation_transition_v1(
        &existing.commitments,
        &commitments,
        &deriver_a,
        &deriver_b,
    )
    .map_err(candidate_derivation_error)
    .map_err(stored_refresh_record_error)?;
    let TenantRootActivationReceiptBindingV1::RefreshSwap(binding) =
        candidate_state.activation_receipt.binding()
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation requires a refresh-swap receipt",
        ));
    };
    if &next_commitments != binding.next_commitments()
        || root_commitment != *binding.next_commitments().root_commitment()
        || deriver_a
            .lifecycle_receipt_digest()
            .map_err(candidate_derivation_error)?
            != binding.installation_receipts().deriver_a()
        || deriver_b
            .lifecycle_receipt_digest()
            .map_err(candidate_derivation_error)?
            != binding.installation_receipts().deriver_b()
    {
        return Err(refresh_replay_conflict(
            "tenant-root refresh activation receipt does not match the installation checkpoint",
        ));
    }
    // Nothing is delivered yet: each Deriver's acknowledged activation marks
    // its role delivered, with the revisions its retirement of the replaced
    // epoch names.
    candidate.delivery = Some(CloudflareTenantRootDeliveryV1::pending_swap(
        candidate.activation_receipt_digest_b64u.clone(),
        binding.current_epoch().get().get(),
        existing.record.delivery.as_ref(),
    ));
    // A manual refresh's completion is validated before anything is written.
    let completion = match manual_operation_id {
        Some(operation_id) => {
            let completion = CloudflareTenantRootRefreshCompletionV1 {
                operation_id,
                completed_at_ms: now_ms,
                response: refresh_terminal_response_from_record(&candidate),
            };
            validate_refresh_completion_v1(&completion)?;
            Some(completion)
        }
        None => None,
    };

    store
        .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &candidate)
        .await?;
    if let Some(completion) = completion {
        store
            .put_json(
                &manual_refresh_completion_storage_key_v1(&completion.operation_id),
                &completion,
            )
            .await?;
    }
    if let Some(completion) = managed_restore_completion {
        store
            .put_json(
                &managed_restore_completion_storage_key_v1(&completion.capability_b64u),
                &completion,
            )
            .await?;
    }
    store
        .delete(TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1)
        .await?;
    store
        .delete(TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1)
        .await?;
    store
        .delete(TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_STORAGE_KEY_V1)
        .await?;
    Ok(())
}

/// Checkpoints one role's refresh commitment. The first commitment reserves
/// the fence for its attempt; an exact replay returns the recorded outcome.
pub(crate) async fn tenant_root_refresh_persist_commitment_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    request: CloudflareTenantRootRefreshCommitmentRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshCommitmentResponseV1> {
    let expected_authority_id = store.authority_id();
    let loaded = {
        let active = load_refresh_active_state_v1(
            store,
            issuer_keys,
            "tenant-root refresh has no authoritative active public state",
        )
        .await?;
        let candidate_bytes = decode_canonical_base64url(
            "tenant-root signed refresh commitment",
            &request.signed_commitment_b64u,
            TENANT_ROOT_REFRESH_COMMITMENT_MAX_BYTES_V1,
            TENANT_ROOT_REFRESH_COMMITMENT_MAX_BASE64URL_BYTES_V1,
        )?;
        let signed = TenantRootSignedRefreshCommitmentV1::decode_canonical_bytes(&candidate_bytes)
            .map_err(candidate_derivation_error)?;
        let context = signed.transcript().context().clone();
        let candidate = verify_refresh_commitment_wire(&candidate_bytes, &context, role_keys)?;
        let command = validate_refresh_role_command(
            &request.role_refresh_command_b64u,
            &active,
            &context,
            candidate.role(),
            expected_authority_id,
            issuer_keys,
        )?;
        if command.role() != candidate.role() {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root refresh commitment role does not match its command",
            ));
        }
        LoadedTenantRootRefreshRequestV1 {
            active,
            context,
            command,
            candidate_bytes,
        }
    };
    let response_scope = refresh_response_scope(&loaded.command, &loaded.active, &loaded.context)?;
    let command_bytes = loaded.command.canonical_bytes().to_vec();
    let candidate_bytes = loaded.candidate_bytes;
    let context = loaded.context;

    let active = load_refresh_active_state_v1(
        store,
        issuer_keys,
        "tenant-root refresh has no authoritative active public state",
    )
    .await?;
    let command = decode_and_verify_refresh_role_command(
        &command_bytes,
        &active,
        &context,
        issuer_keys,
        expected_authority_id,
    )?;
    let existing = match store
        .get_json::<String>(TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1)
        .await?
    {
        Some(encoded) => Some(
            decode_refresh_commitment_checkpoint(&encoded).map_err(stored_refresh_record_error)?,
        ),
        None => None,
    };
    let candidate = verify_refresh_commitment_wire(&candidate_bytes, &context, role_keys)?;
    let candidate_role = candidate.role();
    require_refresh_fence_matches_command(&active.record.fence, &command)?;
    require_fresh_refresh_commitment_command(
        existing.as_ref(),
        candidate_role,
        &command,
        &context,
        now_ms,
    )?;
    let active_binding =
        TenantRootRefreshCommitmentCheckpointActiveBindingV1::from_verified_activation_receipt(
            active.activation_receipt,
            &active.active_pair,
            active.record.lifecycle_revision,
        )
        .map_err(|error| stored_refresh_record_error(candidate_derivation_error(error)))?;
    let deriver_a_verifying_key = role_keys.for_role_and_key_id(
        TwoPartyDeriverRole::DeriverA,
        context.signing_key_id(TwoPartyDeriverRole::DeriverA),
    )?;
    let deriver_b_verifying_key = role_keys.for_role_and_key_id(
        TwoPartyDeriverRole::DeriverB,
        context.signing_key_id(TwoPartyDeriverRole::DeriverB),
    )?;
    let has_existing_checkpoint = existing.is_some();
    let evaluation = evaluate_tenant_root_refresh_commitment_checkpoint_v1(
        existing,
        candidate,
        &command,
        &active_binding,
        &context,
        expected_authority_id,
        deriver_a_verifying_key,
        deriver_b_verifying_key,
        now_ms,
    )
    .map_err(|error| refresh_commitment_evaluation_error(error, has_existing_checkpoint))?;
    let response_outcome = match evaluation {
        TenantRootRefreshCommitmentCheckpointEvaluationV1::Commit {
            checkpoint,
            outcome,
        } => {
            let checkpoint_b64u = encode_refresh_commitment_checkpoint(&checkpoint)?;
            let response_outcome = refresh_commitment_response_outcome(outcome, &candidate_bytes)?;
            let fence = refresh_reserved_fence(&active.record.fence, &command)?;
            let mut active_record = active.record.clone();
            active_record.fence = fence;
            store
                .put_json(
                    TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1,
                    &checkpoint_b64u,
                )
                .await?;
            store
                .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &active_record)
                .await?;
            response_outcome
        }
        TenantRootRefreshCommitmentCheckpointEvaluationV1::Replay(outcome) => {
            refresh_commitment_response_outcome(outcome, &candidate_bytes)?
        }
    };
    refresh_commitment_response(response_scope, response_outcome)
}

/// Checkpoints one role's refresh installation with its successful terminal
/// receipt. Both roles' installations mark the attempt executed.
pub(crate) async fn tenant_root_refresh_persist_installation_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    request: CloudflareTenantRootRefreshInstallationRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshInstallationResponseV1> {
    let expected_authority_id = store.authority_id();
    let loaded = {
        let active = load_refresh_active_state_v1(
            store,
            issuer_keys,
            "tenant-root refresh has no authoritative active public state",
        )
        .await?;
        let candidate_bytes = decode_canonical_base64url(
            "tenant-root signed refresh installation evidence",
            &request.signed_evidence_b64u,
            TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1,
            TENANT_ROOT_CREATION_INSTALLATION_EVIDENCE_MAX_BASE64URL_BYTES_V1,
        )?;
        let candidate = decode_and_verify_refresh_installation_evidence(&candidate_bytes, role_keys)?;
        let context = candidate.evidence().transcript().context().clone();
        let command = validate_refresh_role_command(
            &request.role_refresh_command_b64u,
            &active,
            &context,
            candidate.evidence().transcript().role(),
            expected_authority_id,
            issuer_keys,
        )?;
        if command.role() != candidate.evidence().transcript().role() {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root refresh installation role does not match its command",
            ));
        }
        let terminal_receipt_bytes = decode_canonical_base64url(
            "tenant-root refresh terminal receipt",
            &request.terminal_receipt_b64u,
            TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BYTES_V1,
            TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BASE64URL_BYTES_V1,
        )?;
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
                "tenant-root refresh terminal receipt is not canonical",
            ));
        }
        let success = match terminal_receipt {
            TenantRootCommandTerminalReceiptV1::Success(receipt) => receipt,
            TenantRootCommandTerminalReceiptV1::Failure(_) => {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ReplayedLocalRequest,
                    "tenant-root refresh installation requires a successful terminal receipt",
                ));
            }
        };
        let terminal_receipt = VerifiedTenantRootRefreshInstallationReceiptV1::new(
            success,
            &candidate_bytes,
            &command,
            &context,
            role_keys,
        )?;
        LoadedTenantRootRefreshInstallationRequestV1 {
            active,
            context,
            command,
            candidate_bytes,
            terminal_receipt,
        }
    };
    let response_scope = refresh_response_scope(&loaded.command, &loaded.active, &loaded.context)?;
    let command_bytes = loaded.command.canonical_bytes().to_vec();
    let candidate_bytes = loaded.candidate_bytes;
    let context = loaded.context;
    let terminal_receipt = loaded.terminal_receipt;

    let active = load_refresh_active_state_v1(
        store,
        issuer_keys,
        "tenant-root refresh has no authoritative active public state",
    )
    .await?;
    let command = decode_and_verify_refresh_role_command(
        &command_bytes,
        &active,
        &context,
        issuer_keys,
        expected_authority_id,
    )?;
    let commitment_record = store
        .get_json::<String>(TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1)
        .await?;
    let scope = refresh_checkpoint_scope(&command, &active, &context, expected_authority_id)?;
    let commitment_state = match commitment_record {
        Some(encoded) => {
            let checkpoint =
                decode_refresh_commitment_checkpoint(&encoded).map_err(stored_refresh_record_error)?;
            validate_refresh_commitment_checkpoint_scope(checkpoint.scope(), &scope)
                .map_err(stored_refresh_record_error)?;
            require_complete_refresh_commitment_checkpoint(&checkpoint, &context, role_keys)
                .map_err(stored_refresh_record_error)?
        }
        None => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "tenant-root refresh installation has no commitment checkpoint",
            ));
        }
    };
    let existing = store
        .get_json::<CloudflareTenantRootRefreshInstallationCheckpointRecordV1>(
            TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1,
        )
        .await?;
    let outcome = match evaluate_refresh_installation_checkpoint(
        existing,
        &candidate_bytes,
        &command,
        &active,
        &context,
        role_keys,
        &commitment_state,
        expected_authority_id,
        &terminal_receipt,
        now_ms,
    )? {
        TenantRootRefreshInstallationCheckpointEvaluationV1::Commit {
            checkpoint,
            fence,
            outcome,
        } => {
            let mut active_record = active.record.clone();
            active_record.fence = fence;
            store
                .put_json(
                    TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_STORAGE_KEY_V1,
                    &checkpoint,
                )
                .await?;
            store
                .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &active_record)
                .await?;
            outcome
        }
        TenantRootRefreshInstallationCheckpointEvaluationV1::Replay(outcome) => outcome,
    };
    refresh_installation_response(response_scope, outcome)
}

/// Checkpoints one role's refresh contribution against the complete
/// commitment pair.
pub(crate) async fn tenant_root_refresh_persist_contribution_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    request: CloudflareTenantRootRefreshContributionRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshContributionResponseV1> {
    let expected_authority_id = store.authority_id();
    let loaded = {
        let active = load_refresh_active_state_v1(
            store,
            issuer_keys,
            "tenant-root refresh has no authoritative active public state",
        )
        .await?;
        let candidate_bytes = decode_canonical_base64url(
            "tenant-root signed refresh contribution",
            &request.signed_contribution_b64u,
            TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1,
            TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BASE64URL_BYTES_V1,
        )?;
        let signed =
            TenantRootSignedRefreshContributionV1::decode_canonical_bytes(&candidate_bytes)
                .map_err(candidate_derivation_error)?;
        let candidate_role = signed.envelope().source();
        let checkpoint_encoded = store
            .get_json::<String>(TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1)
            .await?
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MissingPairPreparation,
                    "tenant-root refresh contribution has no commitment checkpoint",
                )
            })?;
        let checkpoint = decode_refresh_commitment_checkpoint(&checkpoint_encoded)
            .map_err(stored_refresh_record_error)?;
        let commitment_bytes = checkpoint
            .state()
            .deriver_a_signed_commitment()
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MissingPairPreparation,
                    "tenant-root refresh contribution requires both commitments",
                )
            })?;
        let commitment =
            TenantRootSignedRefreshCommitmentV1::decode_canonical_bytes(commitment_bytes)
                .map_err(candidate_derivation_error)?;
        let context = commitment.transcript().context().clone();
        let commitments =
            require_complete_refresh_commitment_checkpoint(&checkpoint, &context, role_keys)
                .map_err(stored_refresh_record_error)?;
        let command = validate_refresh_role_command(
            &request.role_refresh_command_b64u,
            &active,
            &context,
            candidate_role,
            expected_authority_id,
            issuer_keys,
        )?;
        let expected_scope =
            refresh_checkpoint_scope(&command, &active, &context, expected_authority_id)?;
        validate_refresh_commitment_checkpoint_scope(checkpoint.scope(), &expected_scope)
            .map_err(stored_refresh_record_error)?;
        verify_refresh_contribution_wire(&candidate_bytes, &context, &commitments, role_keys)?;
        LoadedTenantRootRefreshRequestV1 {
            active,
            context,
            command,
            candidate_bytes,
        }
    };
    let response_scope = refresh_response_scope(&loaded.command, &loaded.active, &loaded.context)?;
    let command_bytes = loaded.command.canonical_bytes().to_vec();
    let candidate_bytes = loaded.candidate_bytes;
    let context = loaded.context;

    let active = load_refresh_active_state_v1(
        store,
        issuer_keys,
        "tenant-root refresh has no authoritative active public state",
    )
    .await?;
    let command = decode_and_verify_refresh_role_command(
        &command_bytes,
        &active,
        &context,
        issuer_keys,
        expected_authority_id,
    )?;
    let checkpoint_encoded = store
        .get_json::<String>(TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_STORAGE_KEY_V1)
        .await?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "tenant-root refresh contribution has no commitment checkpoint",
            )
        })?;
    let checkpoint = decode_refresh_commitment_checkpoint(&checkpoint_encoded)
        .map_err(stored_refresh_record_error)?;
    let scope = refresh_checkpoint_scope(&command, &active, &context, expected_authority_id)?;
    validate_refresh_commitment_checkpoint_scope(checkpoint.scope(), &scope)
        .map_err(stored_refresh_record_error)?;
    let commitments = require_complete_refresh_commitment_checkpoint(&checkpoint, &context, role_keys)
        .map_err(stored_refresh_record_error)?;
    let candidate =
        verify_refresh_contribution_wire(&candidate_bytes, &context, &commitments, role_keys)?;
    let existing = store
        .get_json::<CloudflareTenantRootRefreshContributionRendezvousRecordV1>(
            TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_STORAGE_KEY_V1,
        )
        .await?;
    let outcome = match evaluate_refresh_contribution_rendezvous(
        existing,
        candidate,
        &command,
        &active,
        &context,
        &commitments,
        role_keys,
        expected_authority_id,
        now_ms,
    )? {
        TenantRootRefreshContributionRendezvousEvaluationV1::Commit { record, outcome } => {
            store
                .put_json(TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_STORAGE_KEY_V1, &record)
                .await?;
            outcome
        }
        TenantRootRefreshContributionRendezvousEvaluationV1::Replay(outcome) => outcome,
    };
    refresh_contribution_response(response_scope, outcome)
}
