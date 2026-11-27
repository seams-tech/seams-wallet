//! Refresh jobs, admission, active state and the refresh fence.

use super::*;

pub(crate) fn validate_refresh_operation_id_v1(operation_id: &str) -> RouterAbProtocolResult<()> {
    if operation_id.is_empty()
        || operation_id.len() > TENANT_ROOT_MANUAL_REFRESH_OPERATION_MAX_BYTES_V1
        || operation_id.trim() != operation_id
        || operation_id.chars().any(char::is_control)
    {
        return Err(malformed_input(
            "tenant-root manual refresh operation_id must be non-empty, at most 256 UTF-8 bytes, and free of outer whitespace and control characters",
        ));
    }
    Ok(())
}

pub(super) fn validate_refresh_job_read_v1(
    job: Option<&CloudflareTenantRootRefreshJobReadV1>,
) -> RouterAbProtocolResult<()> {
    let Some(job) = job else {
        return Ok(());
    };
    let (job_id, requested_at_ms) = match job {
        CloudflareTenantRootRefreshJobReadV1::Preparing {
            job_id,
            requested_at_ms,
        }
        | CloudflareTenantRootRefreshJobReadV1::Installing {
            job_id,
            requested_at_ms,
        }
        | CloudflareTenantRootRefreshJobReadV1::Verifying {
            job_id,
            requested_at_ms,
        } => (job_id, *requested_at_ms),
    };
    validate_refresh_operation_id_v1(job_id)?;
    if requested_at_ms == 0 {
        return Err(malformed_input(
            "tenant-root refresh job requested_at_ms must be positive",
        ));
    }
    Ok(())
}

pub(super) fn refresh_job_read_from_phase_v1(
    phase: CloudflareTenantRootRefreshJobPhaseV1,
    job_id: Option<String>,
    requested_at_ms: u64,
) -> RouterAbProtocolResult<Option<CloudflareTenantRootRefreshJobReadV1>> {
    let Some(job_id) = job_id else {
        return Ok(None);
    };
    let job = match phase {
        CloudflareTenantRootRefreshJobPhaseV1::Preparing => {
            CloudflareTenantRootRefreshJobReadV1::Preparing {
                job_id,
                requested_at_ms,
            }
        }
        CloudflareTenantRootRefreshJobPhaseV1::Installing => {
            CloudflareTenantRootRefreshJobReadV1::Installing {
                job_id,
                requested_at_ms,
            }
        }
        CloudflareTenantRootRefreshJobPhaseV1::Verifying => {
            CloudflareTenantRootRefreshJobReadV1::Verifying {
                job_id,
                requested_at_ms,
            }
        }
    };
    validate_refresh_job_read_v1(Some(&job))?;
    Ok(Some(job))
}

pub(super) fn manual_refresh_completion_storage_key_v1(operation_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"tenant-root-manual-refresh-completion-v1");
    hasher.update((operation_id.len() as u32).to_be_bytes());
    hasher.update(operation_id.as_bytes());
    format!(
        "{TENANT_ROOT_MANUAL_REFRESH_COMPLETION_STORAGE_PREFIX_V1}{}",
        encode_base64url_bytes_v1(&hasher.finalize())
    )
}

pub(super) fn managed_restore_completion_storage_key_v1(capability_b64u: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"tenant-root-managed-restore-completion-v1");
    hasher.update((capability_b64u.len() as u32).to_be_bytes());
    hasher.update(capability_b64u.as_bytes());
    format!(
        "{TENANT_ROOT_MANAGED_RESTORE_COMPLETION_STORAGE_PREFIX_V1}{}",
        encode_base64url_bytes_v1(&hasher.finalize())
    )
}

pub(super) fn refresh_abandonment_storage_key_v1(operation_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"tenant-root-refresh-abandonment-v1");
    hasher.update((operation_id.len() as u32).to_be_bytes());
    hasher.update(operation_id.as_bytes());
    format!(
        "{TENANT_ROOT_REFRESH_ABANDONMENT_STORAGE_PREFIX_V1}{}",
        encode_base64url_bytes_v1(&hasher.finalize())
    )
}

pub(super) fn manual_refresh_in_progress_error() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::ConflictingPair,
        TENANT_ROOT_MANUAL_REFRESH_IN_PROGRESS_ERROR_V1,
    )
}

pub(super) fn validate_refresh_pending_v1(
    pending: &CloudflareTenantRootRefreshPendingV1,
) -> RouterAbProtocolResult<()> {
    validate_refresh_operation_id_v1(&pending.operation_id)?;
    if pending.lifecycle_revision == 0 {
        return Err(malformed_input(
            "tenant-root manual refresh pending lifecycle revision must be positive",
        ));
    }
    if pending.expires_at_ms == 0 {
        return Err(malformed_input(
            "tenant-root refresh pending authorization expiry must be positive",
        ));
    }
    Ok(())
}

pub(super) fn validate_refresh_abandonment_v1(
    abandonment: &CloudflareTenantRootRefreshAbandonmentV1,
) -> RouterAbProtocolResult<()> {
    validate_refresh_operation_id_v1(&abandonment.operation_id)?;
    if abandonment.abandoned_at_ms == 0 {
        return Err(malformed_input(
            "tenant-root refresh abandonment time must be positive",
        ));
    }
    Ok(())
}

/// Expires a managed-restore reservation that was never authorized.
///
/// A reserved challenge can be authorized only inside its own window. Once
/// this clock has passed that window, the fence records the reservation as
/// expired: it stops holding refresh and a new reservation back, and its late
/// checkpoint is refused rather than accepted. An authorized (terminal)
/// restore is never expired here; it stays recoverable through its own
/// forward refresh.
///
/// Returns whether the fence changed.
pub(super) fn expire_managed_restore_reservation_v1(
    record: &mut CloudflareTenantRootRefreshActiveStateRecordV1,
    now_ms: u64,
) -> bool {
    let CloudflareTenantRootManagedRestoreFenceV1::Reserved { challenge, attempt } =
        &record.managed_restore_fence
    else {
        return false;
    };
    if now_ms <= challenge.expires_at_ms {
        return false;
    }
    record.managed_restore_fence = CloudflareTenantRootManagedRestoreFenceV1::Expired {
        challenge: challenge.clone(),
        attempt: attempt.clone(),
        expired_at_ms: now_ms,
    };
    true
}

/// Persists [`expire_managed_restore_reservation_v1`] before a restore
/// operation is evaluated, so the expiry holds even when that operation is
/// then refused.
pub(super) async fn persist_managed_restore_reservation_expiry_v1<Store: TenantRootCreationStoreV1>(
    store: &Store,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
    active: ValidatedTenantRootRefreshActiveStateV1,
    now_ms: u64,
) -> RouterAbProtocolResult<ValidatedTenantRootRefreshActiveStateV1> {
    let mut record = active.record.clone();
    if !expire_managed_restore_reservation_v1(&mut record, now_ms) {
        return Ok(active);
    }
    let expired =
        validate_refresh_active_state_record(record.clone(), store.authority_id(), issuer_keys)?;
    store
        .put_json(TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1, &record)
        .await?;
    Ok(expired)
}

/// A late step of an authorized restore that a completed refresh overtook.
pub(crate) fn managed_restore_superseded_error() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLifecycleState,
        "tenant-root managed restore was superseded by a completed refresh before it ran; reserve a new challenge if a role is still unavailable",
    )
}

pub(super) fn managed_restore_reservation_expired_error() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::ExpiredLocalRequest,
        "tenant-root managed-restore reservation expired before it was authorized",
    )
}

/// Abandons refresh work that can no longer finish, so it stops blocking the
/// next refresh.
///
/// - An attempt the Router has not committed is abandoned once its ceremony
///   window has closed by this clock. No receipt can be issued for it any
///   more, and from here on the fence refuses its commit, rendezvous and
///   installation checkpoints, whichever arrives first.
/// - The admitted operation that owns it is abandoned with it.
/// - An admitted operation holding no live attempt is abandoned once its
///   authorization has expired.
///
/// Returns the operations abandoned. A managed restore in progress owns the
/// fence, so nothing is abandoned while one is reserved.
pub(super) fn abandon_expired_refresh_v1(
    record: &mut CloudflareTenantRootRefreshActiveStateRecordV1,
    now_ms: u64,
) -> RouterAbProtocolResult<Vec<String>> {
    if matches!(
        &record.managed_restore_fence,
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { .. }
    ) {
        return Ok(Vec::new());
    }
    let mut abandoned = Vec::new();
    if let CloudflareTenantRootRefreshFenceV1::Reserved { attempt }
    | CloudflareTenantRootRefreshFenceV1::Executed { attempt } = &record.fence
    {
        let context = decode_refresh_attempt_context_v1(attempt)?;
        if now_ms < context.expires_at_ms() {
            return Ok(abandoned);
        }
        let attempt = attempt.clone();
        if let (Some(operation_id), Some(pending)) =
            (&attempt.manual_operation_id, &record.manual_refresh_pending)
        {
            if &pending.operation_id == operation_id {
                abandoned.push(operation_id.clone());
                record.manual_refresh_pending = None;
            }
        }
        record.fence = CloudflareTenantRootRefreshFenceV1::Abandoned {
            attempt,
            abandoned_at_ms: now_ms,
        };
    }
    if let Some(pending) = &record.manual_refresh_pending {
        if now_ms >= pending.expires_at_ms {
            abandoned.push(pending.operation_id.clone());
            record.manual_refresh_pending = None;
        }
    }
    Ok(abandoned)
}

pub(super) fn validate_refresh_completion_v1(
    completion: &CloudflareTenantRootRefreshCompletionV1,
) -> RouterAbProtocolResult<()> {
    validate_refresh_operation_id_v1(&completion.operation_id)?;
    if completion.completed_at_ms == 0 || completion.response.lifecycle_revision == 0 {
        return Err(malformed_input(
            "tenant-root manual refresh completion has invalid time or lifecycle revision",
        ));
    }
    decode_lifecycle_receipt_digest(
        "tenant-root manual refresh completion receipt digest",
        &completion.response.activation_receipt_digest_b64u,
    )?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum CloudflareTenantRootRefreshAdmissionEvaluationV1 {
    Commit {
        pending: CloudflareTenantRootRefreshPendingV1,
    },
    RetirementPending,
    Replay {
        response: CloudflareTenantRootRefreshActivationResponseV1,
    },
    Abandoned {
        abandoned_at_ms: u64,
    },
    Throttled {
        retry_at_ms: u64,
    },
    InProgress,
    RevisionMoved,
    AuthorizationExpired,
    NotDue {
        next_run_at_ms: u64,
    },
}

pub(super) fn evaluate_refresh_admission_v1(
    record: &CloudflareTenantRootRefreshActiveStateRecordV1,
    completion: Option<CloudflareTenantRootRefreshCompletionV1>,
    abandonment: Option<CloudflareTenantRootRefreshAbandonmentV1>,
    operation_id: &str,
    trigger: CloudflareTenantRootRefreshTriggerV1,
    identity_digest: TenantRootIdentityDigestV1,
    activation_at_ms: u64,
    expected_lifecycle_revision: u64,
    expires_at_ms: u64,
    now_ms: u64,
    schedule: TenantRootRefreshScheduleV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshAdmissionEvaluationV1> {
    validate_refresh_operation_id_v1(operation_id)?;
    if let Some(completion) = completion {
        validate_refresh_completion_v1(&completion).map_err(stored_refresh_record_error)?;
        if completion.operation_id != operation_id {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root manual refresh completion key collision",
            ));
        }
        return Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::Replay {
            response: completion.response,
        });
    }
    if let Some(abandonment) = abandonment {
        validate_refresh_abandonment_v1(&abandonment).map_err(stored_refresh_record_error)?;
        if abandonment.operation_id != operation_id {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root refresh abandonment key collision",
            ));
        }
        return Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::Abandoned {
            abandoned_at_ms: abandonment.abandoned_at_ms,
        });
    }
    let already_admitted = record
        .manual_refresh_pending
        .as_ref()
        .is_some_and(|pending| pending.operation_id == operation_id && pending.trigger == trigger);
    if let Some(pending) = &record.manual_refresh_pending {
        if pending.operation_id == operation_id && pending.trigger != trigger {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ConflictingPair,
                "tenant-root refresh operation trigger changed during replay",
            ));
        }
    }
    if !already_admitted {
        if expected_lifecycle_revision != record.lifecycle_revision {
            return Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::RevisionMoved);
        }
        if now_ms >= expires_at_ms {
            return Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::AuthorizationExpired);
        }
    }
    if matches!(
        &record.managed_restore_fence,
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { .. }
    ) {
        return Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::InProgress);
    }
    if let Some(pending) = &record.manual_refresh_pending {
        validate_refresh_pending_v1(pending).map_err(stored_refresh_record_error)?;
        return Ok(
            if pending.operation_id == operation_id
                && pending.lifecycle_revision == record.lifecycle_revision
            {
                CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit {
                    pending: pending.clone(),
                }
            } else {
                CloudflareTenantRootRefreshAdmissionEvaluationV1::InProgress
            },
        );
    }
    if matches!(
        &record.fence,
        CloudflareTenantRootRefreshFenceV1::Reserved { .. }
            | CloudflareTenantRootRefreshFenceV1::Executed { .. }
    ) {
        return Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::InProgress);
    }
    match trigger {
        CloudflareTenantRootRefreshTriggerV1::Manual => {
            if let Some(completed_at_ms) = record.last_manual_refresh_completed_at_ms {
                let retry_at_ms = completed_at_ms
                    .checked_add(schedule.manual_interval_ms)
                    .ok_or_else(|| {
                        RouterAbProtocolError::new(
                            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                            "tenant-root manual refresh cooldown timestamp overflow",
                        )
                    })?;
                if now_ms < retry_at_ms {
                    return Ok(
                        CloudflareTenantRootRefreshAdmissionEvaluationV1::Throttled { retry_at_ms },
                    );
                }
            }
        }
        CloudflareTenantRootRefreshTriggerV1::Scheduled => {
            let next_run_at_ms = tenant_root_scheduled_refresh_next_at_ms_v1(
                identity_digest,
                activation_at_ms,
                record.last_refresh_completed_at_ms,
                schedule.scheduled_interval_ms,
            );
            if now_ms < next_run_at_ms {
                return Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::NotDue {
                    next_run_at_ms,
                });
            }
        }
    }
    // A new refresh first waits for both roles to erase every epoch the
    // record retires: the latest swap's, and any a managed restore carried.
    if record
        .delivery
        .as_ref()
        .is_some_and(|delivery| !delivery.retirements_erased())
    {
        return Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::RetirementPending);
    }
    Ok(CloudflareTenantRootRefreshAdmissionEvaluationV1::Commit {
        pending: CloudflareTenantRootRefreshPendingV1 {
            operation_id: operation_id.to_owned(),
            lifecycle_revision: record.lifecycle_revision,
            trigger,
            expires_at_ms,
        },
    })
}

pub(super) fn apply_refresh_completion_transition_v1(
    existing: &CloudflareTenantRootRefreshActiveStateRecordV1,
    candidate: &mut CloudflareTenantRootRefreshActiveStateRecordV1,
    operation_id: Option<&str>,
    now_ms: u64,
) -> RouterAbProtocolResult<()> {
    candidate.manual_refresh_pending = existing.manual_refresh_pending.clone();
    candidate.last_manual_refresh_completed_at_ms = existing.last_manual_refresh_completed_at_ms;
    candidate.last_refresh_completed_at_ms = existing.last_refresh_completed_at_ms;
    if operation_id.is_none() && existing.manual_refresh_pending.is_some() {
        return Err(manual_refresh_in_progress_error());
    }
    if let Some(operation_id) = operation_id {
        validate_refresh_operation_id_v1(operation_id)?;
        let Some(pending) = existing.manual_refresh_pending.as_ref() else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ConflictingPair,
                "tenant-root refresh activation has no pending admission",
            ));
        };
        if pending.operation_id != operation_id
            || pending.lifecycle_revision != existing.lifecycle_revision
        {
            return Err(manual_refresh_in_progress_error());
        }
        candidate.last_refresh_completed_at_ms = Some(now_ms);
        if pending.trigger == CloudflareTenantRootRefreshTriggerV1::Manual {
            candidate.last_manual_refresh_completed_at_ms = Some(now_ms);
        }
        candidate.manual_refresh_pending = None;
    }
    Ok(())
}

pub(super) struct ValidatedTenantRootRefreshActiveStateV1 {
    pub(super) record: CloudflareTenantRootRefreshActiveStateRecordV1,
    pub(super) identity_digest: TenantRootIdentityDigestV1,
    pub(super) custody_lineage: TenantRootCustodyLineageId,
    pub(super) active_epoch: TenantRootShareEpoch,
    pub(super) commitments: TenantRootEpochCommitmentsV1,
    pub(super) activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    pub(super) activation_receipt: router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
    pub(super) active_pair: router_ab_core::TenantRootActiveRootPairV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TenantRootRefreshActiveStateProjectionV1 {
    pub(super) activation_receipt_b64u: String,
    pub(super) activation_receipt_digest_b64u: String,
    pub(super) identity_digest_b64u: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) active_epoch: u64,
    pub(super) deriver_a_commitment_b64u: String,
    pub(super) deriver_b_commitment_b64u: String,
    pub(super) active_root_commitment_b64u: String,
    pub(super) lifecycle_revision: u64,
}

pub(super) fn refresh_active_state_projection(
    record: &CloudflareTenantRootRefreshActiveStateRecordV1,
) -> TenantRootRefreshActiveStateProjectionV1 {
    TenantRootRefreshActiveStateProjectionV1 {
        activation_receipt_b64u: record.activation_receipt_b64u.clone(),
        activation_receipt_digest_b64u: record.activation_receipt_digest_b64u.clone(),
        identity_digest_b64u: record.identity_digest_b64u.clone(),
        custody_lineage_b64u: record.custody_lineage_b64u.clone(),
        active_epoch: record.active_epoch,
        deriver_a_commitment_b64u: record.deriver_a_commitment_b64u.clone(),
        deriver_b_commitment_b64u: record.deriver_b_commitment_b64u.clone(),
        active_root_commitment_b64u: record.active_root_commitment_b64u.clone(),
        lifecycle_revision: record.lifecycle_revision,
    }
}

pub(super) fn refresh_terminal_response_from_record(
    record: &CloudflareTenantRootRefreshActiveStateRecordV1,
) -> CloudflareTenantRootRefreshActivationResponseV1 {
    CloudflareTenantRootRefreshActivationResponseV1 {
        activation_receipt_digest_b64u: record.activation_receipt_digest_b64u.clone(),
        lifecycle_revision: record.lifecycle_revision,
    }
}

pub(super) fn validate_refresh_terminal_response(
    record: &CloudflareTenantRootRefreshActiveStateRecordV1,
    activation_receipt: &router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
    attempt: &CloudflareTenantRootRefreshAttemptV1,
    response: &CloudflareTenantRootRefreshActivationResponseV1,
) -> RouterAbProtocolResult<()> {
    let response_digest = decode_lifecycle_receipt_digest(
        "tenant-root terminal refresh response receipt digest",
        &response.activation_receipt_digest_b64u,
    )?;
    if response_digest != activation_receipt.digest()
        || response.activation_receipt_digest_b64u != record.activation_receipt_digest_b64u
        || response.lifecycle_revision != record.lifecycle_revision
        || response.lifecycle_revision != activation_receipt.result_control_plane_revision()
    {
        return Err(malformed_input(
            "tenant-root terminal refresh response does not match its activation state",
        ));
    }
    let TenantRootActivationReceiptBindingV1::RefreshSwap(binding) = activation_receipt.binding()
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root terminal refresh response requires a refresh-swap receipt",
        ));
    };
    let attempt_context_digest = decode_protocol_digest_b64u(
        "tenant-root terminal refresh attempt context digest",
        &attempt.ceremony_context_digest_b64u,
    )?;
    if attempt.identity_digest_b64u != record.identity_digest_b64u
        || attempt.custody_lineage_b64u != record.custody_lineage_b64u
        || binding.identity_digest() != activation_receipt.identity_digest()
        || binding.custody_lineage() != activation_receipt.custody_lineage()
        || binding.context_digest() != attempt_context_digest
        || binding.current_epoch().get().get() != attempt.current_epoch
        || binding.next_epoch().get().get() != attempt.next_epoch
        || binding.expected_control_plane_revision() != attempt.expected_control_plane_revision
        || binding.result_control_plane_revision() != response.lifecycle_revision
    {
        return Err(malformed_input(
            "tenant-root terminal refresh response does not match its persisted attempt",
        ));
    }
    Ok(())
}

pub(super) fn refresh_active_state_record_from_verified_receipt(
    activation_receipt: router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
    lifecycle_revision: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshActiveStateRecordV1> {
    if lifecycle_revision == 0 {
        return Err(malformed_input(
            "tenant-root refresh active lifecycle revision must be positive",
        ));
    }
    if lifecycle_revision < activation_receipt.result_control_plane_revision() {
        return Err(malformed_input(
            "tenant-root refresh active lifecycle revision predates activation",
        ));
    }
    let receipt_bytes = activation_receipt.canonical_bytes().to_vec();
    let receipt_digest = activation_receipt.digest();
    let (active_epoch, commitments) = match activation_receipt.binding() {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => {
            (binding.epoch(), binding.commitments())
        }
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => {
            (binding.next_epoch(), binding.next_commitments())
        }
    };
    Ok(CloudflareTenantRootRefreshActiveStateRecordV1 {
        activation_receipt_b64u: encode_base64url_bytes_v1(&receipt_bytes),
        activation_receipt_digest_b64u: encode_base64url_bytes_v1(receipt_digest.as_bytes()),
        identity_digest_b64u: encode_base64url_bytes_v1(
            activation_receipt.identity_digest().as_bytes(),
        ),
        custody_lineage_b64u: activation_receipt.custody_lineage().to_base64url(),
        active_epoch: active_epoch.get().get(),
        deriver_a_commitment_b64u: encode_base64url_bytes_v1(commitments.deriver_a().as_bytes()),
        deriver_b_commitment_b64u: encode_base64url_bytes_v1(commitments.deriver_b().as_bytes()),
        active_root_commitment_b64u: encode_base64url_bytes_v1(commitments.root_commitment()),
        lifecycle_revision,
        fence: CloudflareTenantRootRefreshFenceV1::Open,
        managed_restore_fence: CloudflareTenantRootManagedRestoreFenceV1::Open,
        manual_refresh_pending: None,
        last_manual_refresh_completed_at_ms: None,
        last_refresh_completed_at_ms: None,
        delivery: match activation_receipt.transition() {
            TenantRootActivationReceiptTransitionV1::InitialCreation => {
                Some(CloudflareTenantRootDeliveryV1::pending(
                    encode_base64url_bytes_v1(receipt_digest.as_bytes()),
                ))
            }
            TenantRootActivationReceiptTransitionV1::RefreshSwap => None,
        },
    })
}

pub(super) fn validate_refresh_active_state_transition_v1(
    existing: &ValidatedTenantRootRefreshActiveStateV1,
    candidate: &ValidatedTenantRootRefreshActiveStateV1,
) -> RouterAbProtocolResult<()> {
    let TenantRootActivationReceiptBindingV1::RefreshSwap(binding) =
        candidate.activation_receipt.binding()
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation requires a refresh-swap receipt",
        ));
    };
    let expected_result_revision = existing
        .record
        .lifecycle_revision
        .checked_add(1)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root refresh lifecycle revision cannot advance",
            )
        })?;
    if binding.identity_digest() != existing.identity_digest
        || binding.custody_lineage() != existing.custody_lineage
        || binding.current_epoch() != existing.active_epoch
        || binding.current_commitments() != &existing.commitments
        || binding.expected_control_plane_revision() != existing.record.lifecycle_revision
        || binding.result_control_plane_revision() != expected_result_revision
        || candidate.record.lifecycle_revision != expected_result_revision
    {
        return Err(refresh_replay_conflict(
            "tenant-root refresh activation receipt does not advance the authoritative active state",
        ));
    }
    if binding.next_epoch()
        != existing
            .active_epoch
            .next()
            .map_err(candidate_derivation_error)?
    {
        return Err(refresh_replay_conflict(
            "tenant-root refresh activation receipt epoch does not advance the authoritative active state",
        ));
    }
    Ok(())
}

pub(super) fn refresh_activation_checkpoint_scope_v1(
    active: &ValidatedTenantRootRefreshActiveStateV1,
    activation_receipt: &router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshCheckpointScopeV1> {
    let TenantRootActivationReceiptBindingV1::RefreshSwap(binding) = activation_receipt.binding()
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation requires a refresh-swap receipt",
        ));
    };
    Ok(CloudflareTenantRootRefreshCheckpointScopeV1 {
        identity_digest_b64u: encode_base64url_bytes_v1(active.identity_digest.as_bytes()),
        custody_lineage_b64u: active.custody_lineage.to_base64url(),
        authority_id_b64u: encode_base64url_bytes_v1(binding.authority_id().as_bytes()),
        ceremony_context_digest_b64u: encode_base64url_bytes_v1(
            binding.context_digest().as_bytes(),
        ),
        current_epoch: binding.current_epoch().get().get(),
        next_epoch: binding.next_epoch().get().get(),
        expected_control_plane_revision: binding.expected_control_plane_revision(),
        active_root_commitment_b64u: encode_base64url_bytes_v1(
            active.commitments.root_commitment(),
        ),
        active_activation_receipt_digest_b64u: encode_base64url_bytes_v1(
            active.activation_receipt_digest.as_bytes(),
        ),
        deriver_a_commitment_b64u: encode_base64url_bytes_v1(
            active.commitments.deriver_a().as_bytes(),
        ),
        deriver_b_commitment_b64u: encode_base64url_bytes_v1(
            active.commitments.deriver_b().as_bytes(),
        ),
    })
}

pub(super) fn validate_refresh_active_state_record(
    record: CloudflareTenantRootRefreshActiveStateRecordV1,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
) -> RouterAbProtocolResult<ValidatedTenantRootRefreshActiveStateV1> {
    let mut record = record;
    // Old records only have the manual completion timestamp; use it as the
    // schedule anchor until a scheduled completion writes the generic field.
    if record.last_refresh_completed_at_ms.is_none() {
        record.last_refresh_completed_at_ms = record.last_manual_refresh_completed_at_ms;
    }
    let receipt_bytes = decode_canonical_base64url(
        "tenant-root refresh active activation receipt",
        &record.activation_receipt_b64u,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BYTES_V1,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BASE64URL_BYTES_V1,
    )?;
    let activation_receipt =
        TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
            .map_err(candidate_derivation_error)?;
    let issuer_key_id = activation_receipt.issuer_key_id();
    let issuer_verifying_key = issuer_keys.get(issuer_key_id).ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "stored tenant-root refresh activation receipt issuer is not trusted",
        )
    })?;
    let activation_receipt = activation_receipt
        .verify_issuer_signature(issuer_verifying_key)
        .map_err(candidate_authorization_error)?;
    let activation_receipt_digest = activation_receipt.digest();
    let stored_receipt_digest = decode_lifecycle_receipt_digest(
        "tenant-root refresh active activation receipt digest",
        &record.activation_receipt_digest_b64u,
    )?;
    if stored_receipt_digest != activation_receipt_digest {
        return Err(malformed_input(
            "tenant-root refresh active activation receipt digest does not match its bytes",
        ));
    }
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(decode_fixed_base64url_32(
        "tenant-root refresh active identity digest",
        &record.identity_digest_b64u,
    )?);
    let custody_lineage = decode_lineage_b64u(
        "tenant-root refresh active custody lineage",
        &record.custody_lineage_b64u,
    )?;
    let active_epoch = TenantRootShareEpoch::new(record.active_epoch).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!(
                "stored tenant-root refresh active epoch is invalid: {:?}",
                error.code()
            ),
        )
    })?;
    if record.lifecycle_revision == 0 {
        return Err(malformed_input(
            "stored tenant-root refresh lifecycle revision must be positive",
        ));
    }
    let commitments = TenantRootEpochCommitmentsV1::new(
        decode_share_commitment_b64u(
            "tenant-root refresh active Deriver A commitment",
            &record.deriver_a_commitment_b64u,
        )?,
        decode_share_commitment_b64u(
            "tenant-root refresh active Deriver B commitment",
            &record.deriver_b_commitment_b64u,
        )?,
    )
    .map_err(candidate_derivation_error)?;
    let active_root_commitment = decode_fixed_base64url_32(
        "tenant-root refresh active root commitment",
        &record.active_root_commitment_b64u,
    )?;
    if commitments.root_commitment() != &active_root_commitment {
        return Err(malformed_input(
            "tenant-root refresh active root commitment does not match its role commitments",
        ));
    }
    if activation_receipt.identity_digest() != identity_digest
        || activation_receipt.custody_lineage() != custody_lineage
        || activation_receipt.binding().authority_id() != expected_authority_id
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh active state does not match its Durable Object authority",
        ));
    }
    let (receipt_epoch, receipt_commitments) = match activation_receipt.binding() {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => {
            (binding.epoch(), binding.commitments())
        }
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => {
            (binding.next_epoch(), binding.next_commitments())
        }
    };
    if active_epoch != receipt_epoch || &commitments != receipt_commitments {
        return Err(malformed_input(
            "tenant-root refresh active state does not match its activation receipt",
        ));
    }
    if record.lifecycle_revision < activation_receipt.result_control_plane_revision() {
        return Err(malformed_input(
            "tenant-root refresh active lifecycle revision predates activation receipt result",
        ));
    }
    let deriver_a = TenantRootActiveRoleBindingV1::new(
        TenantRootActiveRoleRowKeyV1::new(
            identity_digest,
            custody_lineage,
            active_epoch,
            TenantRootManagedRestoreRoleV1::DeriverA,
        ),
        commitments.deriver_a().clone(),
        activation_receipt_digest,
    )
    .map_err(candidate_derivation_error)?;
    let deriver_b = TenantRootActiveRoleBindingV1::new(
        TenantRootActiveRoleRowKeyV1::new(
            identity_digest,
            custody_lineage,
            active_epoch,
            TenantRootManagedRestoreRoleV1::DeriverB,
        ),
        commitments.deriver_b().clone(),
        activation_receipt_digest,
    )
    .map_err(candidate_derivation_error)?;
    let deriver_a = TenantRootActiveRoleResolutionV1::Active(deriver_a);
    let deriver_b = TenantRootActiveRoleResolutionV1::Active(deriver_b);
    let active_pair =
        resolve_active_tenant_root_pair_binding_v1(identity_digest, &deriver_a, &deriver_b)
            .map_err(candidate_derivation_error)?
            .require_active()
            .map_err(candidate_derivation_error)?
            .clone();
    if active_pair.root_commitment() != &active_root_commitment
        || active_pair.activation_receipt_digest() != activation_receipt_digest
    {
        return Err(malformed_input(
            "tenant-root refresh active pair does not match its persisted public state",
        ));
    }
    if let CloudflareTenantRootRefreshFenceV1::Terminal {
        attempt, response, ..
    } = &record.fence
    {
        validate_refresh_terminal_response(&record, &activation_receipt, attempt, response)?;
    }
    if let Some(pending) = &record.manual_refresh_pending {
        validate_refresh_pending_v1(pending)?;
        if !matches!(
            &record.fence,
            CloudflareTenantRootRefreshFenceV1::Reserved { attempt }
                | CloudflareTenantRootRefreshFenceV1::Executed { attempt }
                if attempt.manual_operation_id.as_deref() == Some(pending.operation_id.as_str())
        ) && !matches!(
            &record.fence,
            CloudflareTenantRootRefreshFenceV1::Open
                | CloudflareTenantRootRefreshFenceV1::Terminal { .. }
                | CloudflareTenantRootRefreshFenceV1::Abandoned { .. }
        ) {
            return Err(manual_refresh_in_progress_error());
        }
    }
    if let Some(completed_at_ms) = record.last_manual_refresh_completed_at_ms {
        if completed_at_ms == 0 {
            return Err(malformed_input(
                "stored tenant-root manual refresh completion timestamp must be positive",
            ));
        }
    }
    if let Some(completed_at_ms) = record.last_refresh_completed_at_ms {
        if completed_at_ms == 0 {
            return Err(malformed_input(
                "stored tenant-root refresh completion timestamp must be positive",
            ));
        }
    }
    validate_refresh_fence(&record.fence)?;
    validate_managed_restore_fence_shape(&record.managed_restore_fence)?;
    require_managed_restore_fence_matches_active_fields_v1(
        &record.fence,
        &record.managed_restore_fence,
        identity_digest,
        custody_lineage,
        active_epoch,
        record.lifecycle_revision,
        &record.activation_receipt_b64u,
        activation_receipt_digest,
    )?;
    Ok(ValidatedTenantRootRefreshActiveStateV1 {
        record,
        identity_digest,
        custody_lineage,
        active_epoch,
        commitments,
        activation_receipt_digest,
        activation_receipt,
        active_pair,
    })
}

pub(super) fn validate_refresh_attempt_packages(
    attempt: &CloudflareTenantRootRefreshAttemptV1,
) -> RouterAbProtocolResult<()> {
    let context = decode_refresh_attempt_context_v1(attempt)?;
    let context_digest = context.digest().map_err(candidate_derivation_error)?;
    let command_a_bytes = decode_canonical_base64url(
        "tenant-root refresh attempt Deriver A command",
        &attempt.deriver_a_refresh_command_b64u,
        TENANT_ROOT_REFRESH_ATTEMPT_COMMAND_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_REFRESH_ATTEMPT_COMMAND_MAX_BYTES_V1),
    )?;
    let command_b_bytes = decode_canonical_base64url(
        "tenant-root refresh attempt Deriver B command",
        &attempt.deriver_b_refresh_command_b64u,
        TENANT_ROOT_REFRESH_ATTEMPT_COMMAND_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_REFRESH_ATTEMPT_COMMAND_MAX_BYTES_V1),
    )?;
    let command_a = TenantRootRoleRefreshCommandV1::decode_canonical_bytes(&command_a_bytes)
        .map_err(candidate_derivation_error)?;
    let command_b = TenantRootRoleRefreshCommandV1::decode_canonical_bytes(&command_b_bytes)
        .map_err(candidate_derivation_error)?;
    if command_a
        .canonical_bytes()
        .map_err(candidate_derivation_error)?
        != command_a_bytes
        || command_b
            .canonical_bytes()
            .map_err(candidate_derivation_error)?
            != command_b_bytes
    {
        return Err(malformed_input(
            "tenant-root refresh attempt command package is not canonical",
        ));
    }
    let command_a_digest = command_a.digest().map_err(candidate_derivation_error)?;
    let command_b_digest = command_b.digest().map_err(candidate_derivation_error)?;
    if command_a.role() != TwoPartyDeriverRole::DeriverA
        || command_b.role() != TwoPartyDeriverRole::DeriverB
        || command_a.identity_digest() != command_b.identity_digest()
        || command_a.custody_lineage() != command_b.custody_lineage()
        || command_a.current_epoch() != command_b.current_epoch()
        || command_a.next_epoch() != command_b.next_epoch()
        || command_a.expected_control_plane_revision()
            != command_b.expected_control_plane_revision()
        || command_a.authority_id() != command_b.authority_id()
        || command_a.refresh_context_digest() != command_b.refresh_context_digest()
        || command_a.session_id() != command_b.session_id()
        || command_a.nonce() != command_b.nonce()
        || command_a.refresh_context_digest() != context_digest
        || context.identity_digest() != command_a.identity_digest()
        || context.custody_lineage() != command_a.custody_lineage()
        || context.session_id() != command_a.session_id()
        || context.nonce() != command_a.nonce()
        || command_a.current_epoch().get().get() != attempt.current_epoch
        || command_a.next_epoch().get().get() != attempt.next_epoch
        || command_a.expected_control_plane_revision() != attempt.expected_control_plane_revision
        || encode_base64url_bytes_v1(command_a_digest.as_bytes()) != attempt.command_digest_b64u
        || encode_base64url_bytes_v1(command_b_digest.as_bytes())
            != attempt.deriver_b_command_digest_b64u
        || encode_base64url_bytes_v1(context_digest.as_bytes())
            != attempt.ceremony_context_digest_b64u
        || encode_base64url_bytes_v1(command_a.session_id().as_bytes()) != attempt.attempt_id_b64u
        || attempt.attempt_id_b64u != attempt.session_id_b64u
        || encode_base64url_bytes_v1(command_a.nonce().as_bytes()) != attempt.nonce_b64u
    {
        return Err(malformed_input(
            "tenant-root refresh attempt command packages do not match their metadata",
        ));
    }
    Ok(())
}

pub(super) fn decode_refresh_attempt_context_v1(
    attempt: &CloudflareTenantRootRefreshAttemptV1,
) -> RouterAbProtocolResult<TenantRootCeremonyContextV1> {
    let context_bytes = decode_canonical_base64url(
        "tenant-root refresh attempt context",
        &attempt.refresh_context_b64u,
        TENANT_ROOT_REFRESH_ATTEMPT_CONTEXT_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_REFRESH_ATTEMPT_CONTEXT_MAX_BYTES_V1),
    )?;
    let context = TenantRootCeremonyContextV1::decode_canonical_bytes(&context_bytes)
        .map_err(candidate_derivation_error)?;
    let context_digest = context.digest().map_err(candidate_derivation_error)?;
    if *context_digest.as_bytes()
        != decode_fixed_base64url_32(
            "tenant-root refresh attempt context digest",
            &attempt.ceremony_context_digest_b64u,
        )?
        || context.identity_digest()
            != TenantRootIdentityDigestV1::from_bytes(decode_fixed_base64url_32(
                "tenant-root refresh attempt identity digest",
                &attempt.identity_digest_b64u,
            )?)
    {
        return Err(malformed_input(
            "tenant-root refresh attempt context does not match its metadata",
        ));
    }
    Ok(context)
}

pub(super) fn validate_refresh_checkpoint_command_digest_v1(
    stored: TenantRootProtocolDigestV1,
    role: TwoPartyDeriverRole,
    deriver_a: &VerifiedTenantRootRoleRefreshCommandV1,
    deriver_b: &VerifiedTenantRootRoleRefreshCommandV1,
) -> RouterAbProtocolResult<()> {
    let expected = match role {
        TwoPartyDeriverRole::DeriverA => deriver_a.digest(),
        TwoPartyDeriverRole::DeriverB => deriver_b.digest(),
    };
    if stored != expected {
        return Err(malformed_input(
            "stored tenant-root refresh checkpoint command digest does not match its attempt",
        ));
    }
    Ok(())
}

pub(super) fn validate_refresh_fence(
    fence: &CloudflareTenantRootRefreshFenceV1,
) -> RouterAbProtocolResult<()> {
    let attempt = match fence {
        CloudflareTenantRootRefreshFenceV1::Open => return Ok(()),
        CloudflareTenantRootRefreshFenceV1::Reserved { attempt }
        | CloudflareTenantRootRefreshFenceV1::Executed { attempt }
        | CloudflareTenantRootRefreshFenceV1::Terminal { attempt, .. } => attempt,
        CloudflareTenantRootRefreshFenceV1::Abandoned {
            attempt,
            abandoned_at_ms,
        } => {
            if *abandoned_at_ms < decode_refresh_attempt_context_v1(attempt)?.expires_at_ms() {
                return Err(malformed_input(
                    "tenant-root refresh attempt was abandoned inside its ceremony window",
                ));
            }
            attempt
        }
    };
    validate_refresh_attempt_packages(attempt)?;
    let attempt_id = decode_canonical_base64url(
        "tenant-root refresh attempt id",
        &attempt.attempt_id_b64u,
        16,
        base64url_len_for_bytes(16),
    )?;
    let session_id = decode_canonical_base64url(
        "tenant-root refresh attempt session id",
        &attempt.session_id_b64u,
        16,
        base64url_len_for_bytes(16),
    )?;
    if attempt_id != session_id {
        return Err(malformed_input(
            "tenant-root refresh attempt id must equal its session id",
        ));
    }
    let _ = decode_canonical_base64url(
        "tenant-root refresh attempt nonce",
        &attempt.nonce_b64u,
        32,
        base64url_len_for_bytes(32),
    )?;
    let _ = decode_protocol_digest_b64u(
        "tenant-root refresh attempt command digest",
        &attempt.command_digest_b64u,
    )?;
    let _ = decode_protocol_digest_b64u(
        "tenant-root refresh attempt context digest",
        &attempt.ceremony_context_digest_b64u,
    )?;
    let current_epoch =
        TenantRootShareEpoch::new(attempt.current_epoch).map_err(candidate_derivation_error)?;
    let next_epoch =
        TenantRootShareEpoch::new(attempt.next_epoch).map_err(candidate_derivation_error)?;
    if current_epoch.next().map_err(candidate_derivation_error)? != next_epoch {
        return Err(malformed_input(
            "tenant-root refresh attempt epochs must advance exactly one",
        ));
    }
    if attempt.expected_control_plane_revision == 0 {
        return Err(malformed_input(
            "tenant-root refresh attempt revision must be positive",
        ));
    }
    Ok(())
}
