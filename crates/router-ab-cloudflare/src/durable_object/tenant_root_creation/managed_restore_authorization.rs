//! Managed-restore authorization challenges and grants.

use super::*;

/// Builds the managed-restore challenge from the validated Started journal and
/// active activation receipt. The operator request contains only incident
/// coordinates and freshness data.
pub(super) fn managed_restore_authorization_challenge_from_active_state_v1(
    active: &ValidatedTenantRootRefreshActiveStateV1,
    started_journal: &ValidatedTenantRootCreationJournalV1,
    request: CloudflareTenantRootManagedRestoreAuthorizationRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootManagedRestoreAuthorizationChallengeV1> {
    validate_managed_restore_authorization_request_v1(&request)?;
    let identity = managed_restore_identity_from_started_journal_v1(active, started_journal)?;
    let identity_bytes = identity
        .canonical_bytes()
        .map_err(candidate_derivation_error)?;
    let activation_receipt_bytes = active.activation_receipt.canonical_bytes();
    let challenge = CloudflareTenantRootManagedRestoreAuthorizationChallengeV1 {
        identity_b64u: encode_base64url_bytes_v1(&identity_bytes),
        identity_digest_b64u: encode_base64url_bytes_v1(active.identity_digest.as_bytes()),
        custody_lineage_b64u: active.custody_lineage.to_base64url(),
        active_epoch: active.active_epoch.get().get(),
        active_lifecycle_revision: active.record.lifecycle_revision,
        activation_receipt_b64u: encode_base64url_bytes_v1(&activation_receipt_bytes),
        activation_receipt_digest_b64u: encode_base64url_bytes_v1(
            active.activation_receipt_digest.as_bytes(),
        ),
        incident_id: request.incident_id,
        outage_observation_digest_b64u: request.outage_observation_digest_b64u,
        issued_at_ms: request.issued_at_ms,
        expires_at_ms: request.expires_at_ms,
        nonce_b64u: request.nonce_b64u,
        unavailable_role: request.unavailable_role,
        challenge_digest_b64u: String::new(),
    };
    let challenge_digest = managed_restore_authorization_challenge_digest_v1(&challenge)?;
    Ok(CloudflareTenantRootManagedRestoreAuthorizationChallengeV1 {
        challenge_digest_b64u: encode_base64url_bytes_v1(challenge_digest.as_bytes()),
        ..challenge
    })
}

/// Reserves one managed-restore challenge/attempt or replays its exact fence.
/// A fresh request is required while the fence is open or its last
/// reservation has expired. An exact retry replays while the reservation
/// stands and after it is authorized; once it has expired unauthorized, the
/// retry is refused.
pub(super) fn reserve_managed_restore_authorization_fence_v1(
    active: &ValidatedTenantRootRefreshActiveStateV1,
    started_journal: &ValidatedTenantRootCreationJournalV1,
    request: CloudflareTenantRootManagedRestoreAuthorizationRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootManagedRestoreFenceEvaluationV1> {
    if active.record.manual_refresh_pending.is_some() {
        return Err(managed_restore_conflict(
            "tenant-root managed-restore authorization conflicts with a pending manual refresh",
        ));
    }
    validate_managed_restore_fence_against_active_v1(active)?;
    if let CloudflareTenantRootManagedRestoreFenceV1::Superseded { challenge, .. } =
        &active.record.managed_restore_fence
    {
        // A retry of the overtaken restore's own request is refused, not
        // reserved again against the state that replaced it.
        validate_managed_restore_authorization_request_v1(&request)?;
        if managed_restore_request_names_challenge_v1(&request, challenge) {
            return Err(managed_restore_superseded_error());
        }
    }
    match &active.record.managed_restore_fence {
        CloudflareTenantRootManagedRestoreFenceV1::Open
        | CloudflareTenantRootManagedRestoreFenceV1::Expired { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Superseded { .. } => {
            let challenge = managed_restore_authorization_challenge_from_active_state_v1(
                active,
                started_journal,
                request,
            )?;
            let attempt = managed_restore_authorization_attempt_from_challenge_v1(&challenge)?;
            if matches!(
                &active.record.managed_restore_fence,
                CloudflareTenantRootManagedRestoreFenceV1::Expired { challenge: expired, .. }
                    if expired == &challenge
            ) {
                return Err(managed_restore_reservation_expired_error());
            }
            if matches!(
                active.record.fence,
                CloudflareTenantRootRefreshFenceV1::Reserved { .. }
                    | CloudflareTenantRootRefreshFenceV1::Executed { .. }
            ) {
                return Err(managed_restore_conflict(
                    "tenant-root managed-restore authorization conflicts with an active refresh",
                ));
            }
            require_managed_restore_challenge_fresh_v1(&challenge, now_ms)?;
            Ok(
                CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit {
                    fence: CloudflareTenantRootManagedRestoreFenceV1::Reserved {
                        challenge,
                        attempt,
                    },
                },
            )
        }
        CloudflareTenantRootManagedRestoreFenceV1::Reserved {
            challenge: stored_challenge,
            attempt: stored_attempt,
        } => {
            let challenge = managed_restore_authorization_challenge_from_active_state_v1(
                active,
                started_journal,
                request,
            )?;
            let attempt = managed_restore_authorization_attempt_from_challenge_v1(&challenge)?;
            if stored_challenge == &challenge && stored_attempt == &attempt {
                return Ok(
                    CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay {
                        fence: active.record.managed_restore_fence.clone(),
                    },
                );
            }
            Err(managed_restore_conflict(
                "tenant-root managed-restore authorization attempt conflicts with the accepted fence",
            ))
        }
        CloudflareTenantRootManagedRestoreFenceV1::Terminal {
            challenge: stored_challenge,
            ..
        } => {
            require_managed_restore_request_matches_terminal_challenge_v1(
                &request,
                stored_challenge,
            )?;
            Ok(
                CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay {
                    fence: active.record.managed_restore_fence.clone(),
                },
            )
        }
    }
}

/// A terminal fence is the authoritative replay record after activation has
/// advanced the active receipt and epoch. Match only the operator inputs; the
/// persisted challenge retains the prior active state that was authorized.
pub(super) fn require_managed_restore_request_matches_terminal_challenge_v1(
    request: &CloudflareTenantRootManagedRestoreAuthorizationRequestV1,
    challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
) -> RouterAbProtocolResult<()> {
    validate_managed_restore_authorization_request_v1(request)?;
    if !managed_restore_request_names_challenge_v1(request, challenge) {
        return Err(managed_restore_conflict(
            "tenant-root managed-restore authorization attempt conflicts with the accepted fence",
        ));
    }
    Ok(())
}

/// Whether the operator inputs of a request are those a stored challenge was
/// built from.
pub(super) fn managed_restore_request_names_challenge_v1(
    request: &CloudflareTenantRootManagedRestoreAuthorizationRequestV1,
    challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
) -> bool {
    request.incident_id == challenge.incident_id
        && request.outage_observation_digest_b64u == challenge.outage_observation_digest_b64u
        && request.issued_at_ms == challenge.issued_at_ms
        && request.expires_at_ms == challenge.expires_at_ms
        && request.nonce_b64u == challenge.nonce_b64u
        && request.unavailable_role == challenge.unavailable_role
}

/// Checkpoints exact signed public-state, capability, and incident-authorization
/// wires and terminalizes the reserved managed-restore fence. The wires remain
/// opaque to the DO.
pub(super) fn checkpoint_managed_restore_authorization_fence_v1(
    active: &ValidatedTenantRootRefreshActiveStateV1,
    checkpoint: CloudflareTenantRootManagedRestoreAuthorizationCheckpointV1,
) -> RouterAbProtocolResult<CloudflareTenantRootManagedRestoreFenceEvaluationV1> {
    validate_managed_restore_fence_against_active_v1(active)?;
    validate_managed_restore_challenge_shape_v1(&checkpoint.challenge)?;
    validate_managed_restore_attempt_shape_v1(&checkpoint.attempt)?;
    validate_managed_restore_artifacts_v1(
        &checkpoint.public_state_b64u,
        &checkpoint.capability_b64u,
        &checkpoint.incident_authorization_b64u,
    )?;
    require_managed_restore_attempt_matches_challenge_v1(
        &checkpoint.challenge,
        &checkpoint.attempt,
    )?;

    match &active.record.managed_restore_fence {
        CloudflareTenantRootManagedRestoreFenceV1::Open => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingPairPreparation,
            "tenant-root managed-restore authorization requires a persisted reservation",
        )),
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { challenge, attempt }
            if challenge == &checkpoint.challenge && attempt == &checkpoint.attempt =>
        {
            require_managed_restore_challenge_matches_active_v1(active, &checkpoint.challenge)?;
            Ok(
                CloudflareTenantRootManagedRestoreFenceEvaluationV1::Commit {
                    fence: CloudflareTenantRootManagedRestoreFenceV1::Terminal {
                        challenge: checkpoint.challenge,
                        attempt: checkpoint.attempt,
                        public_state_b64u: checkpoint.public_state_b64u,
                        capability_b64u: checkpoint.capability_b64u,
                        incident_authorization_b64u: checkpoint.incident_authorization_b64u,
                    },
                },
            )
        }
        CloudflareTenantRootManagedRestoreFenceV1::Terminal {
            challenge,
            attempt,
            public_state_b64u,
            capability_b64u,
            incident_authorization_b64u,
        } if challenge == &checkpoint.challenge
            && attempt == &checkpoint.attempt
            && public_state_b64u == &checkpoint.public_state_b64u
            && capability_b64u == &checkpoint.capability_b64u
            && incident_authorization_b64u == &checkpoint.incident_authorization_b64u =>
        {
            Ok(
                CloudflareTenantRootManagedRestoreFenceEvaluationV1::Replay {
                    fence: active.record.managed_restore_fence.clone(),
                },
            )
        }
        // The authorization arrived after its reservation expired.
        CloudflareTenantRootManagedRestoreFenceV1::Expired { challenge, attempt, .. }
            if challenge == &checkpoint.challenge && attempt == &checkpoint.attempt =>
        {
            Err(managed_restore_reservation_expired_error())
        }
        CloudflareTenantRootManagedRestoreFenceV1::Superseded { challenge, attempt, .. }
            if challenge == &checkpoint.challenge && attempt == &checkpoint.attempt =>
        {
            Err(managed_restore_superseded_error())
        }
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Terminal { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Expired { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Superseded { .. } => {
            Err(managed_restore_conflict(
                "tenant-root managed-restore checkpoint conflicts with the accepted fence",
            ))
        }
    }
}

pub(super) fn managed_restore_identity_from_started_journal_v1(
    active: &ValidatedTenantRootRefreshActiveStateV1,
    started_journal: &ValidatedTenantRootCreationJournalV1,
) -> RouterAbProtocolResult<TenantRootIdentityV1> {
    if started_journal.identity_digest != active.identity_digest
        || started_journal.custody_lineage != active.custody_lineage
        || started_journal.journal.identity_digest() != active.identity_digest
        || started_journal.journal.custody_lineage() != active.custody_lineage
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore Started journal does not match active state",
        ));
    }
    let identity = tenant_root_creation_identity_v1(&started_journal.journal)?;
    if identity.digest().map_err(candidate_derivation_error)? != active.identity_digest {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore identity does not match active state",
        ));
    }
    Ok(identity)
}

pub(super) fn require_managed_restore_challenge_matches_started_journal_v1(
    active: &ValidatedTenantRootRefreshActiveStateV1,
    started_journal: &ValidatedTenantRootCreationJournalV1,
    challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
) -> RouterAbProtocolResult<()> {
    let identity = managed_restore_identity_from_started_journal_v1(active, started_journal)?;
    let identity_bytes = identity
        .canonical_bytes()
        .map_err(candidate_derivation_error)?;
    if challenge.identity_b64u != encode_base64url_bytes_v1(&identity_bytes) {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-restore challenge identity is not the Started journal identity",
        ));
    }
    Ok(())
}

pub(super) fn validate_managed_restore_authorization_request_v1(
    request: &CloudflareTenantRootManagedRestoreAuthorizationRequestV1,
) -> RouterAbProtocolResult<[u8; 32]> {
    validate_managed_restore_identifier_v1(
        "tenant-root managed-restore incident id",
        &request.incident_id,
    )?;
    let outage_observation_digest = decode_fixed_base64url_32(
        "tenant-root managed-restore outage observation digest",
        &request.outage_observation_digest_b64u,
    )?;
    TenantRootLifecycleReceiptDigestV1::from_bytes(outage_observation_digest)
        .map_err(candidate_derivation_error)?;
    validate_managed_restore_time_window_v1(
        "tenant-root managed-restore authorization",
        request.issued_at_ms,
        request.expires_at_ms,
    )?;
    let nonce = decode_canonical_base64url(
        "tenant-root managed-restore authorization nonce",
        &request.nonce_b64u,
        TENANT_ROOT_MANAGED_RESTORE_NONCE_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_MANAGED_RESTORE_NONCE_BYTES_V1),
    )?;
    if nonce.iter().all(|byte| *byte == 0) {
        return Err(malformed_input(
            "tenant-root managed-restore authorization nonce must be non-zero",
        ));
    }
    Ok(outage_observation_digest)
}

pub(super) fn validate_managed_restore_challenge_shape_v1(
    challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
) -> RouterAbProtocolResult<()> {
    let identity_bytes = decode_canonical_base64url(
        "tenant-root managed-restore challenge identity",
        &challenge.identity_b64u,
        TENANT_ROOT_MANAGED_RESTORE_IDENTITY_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_MANAGED_RESTORE_IDENTITY_MAX_BYTES_V1),
    )?;
    let identity = TenantRootIdentityV1::decode_canonical_bytes(&identity_bytes)
        .map_err(candidate_derivation_error)?;
    let identity_digest = TenantRootIdentityDigestV1::from_bytes(decode_fixed_base64url_32(
        "tenant-root managed-restore challenge identity digest",
        &challenge.identity_digest_b64u,
    )?);
    if identity.digest().map_err(candidate_derivation_error)? != identity_digest {
        return Err(malformed_input(
            "tenant-root managed-restore challenge identity does not match its digest",
        ));
    }
    let custody_lineage = decode_lineage_b64u(
        "tenant-root managed-restore challenge custody lineage",
        &challenge.custody_lineage_b64u,
    )?;
    let active_epoch =
        TenantRootShareEpoch::new(challenge.active_epoch).map_err(candidate_derivation_error)?;
    if challenge.active_lifecycle_revision == 0 {
        return Err(malformed_input(
            "tenant-root managed-restore challenge lifecycle revision must be positive",
        ));
    }
    let receipt_bytes = decode_canonical_base64url(
        "tenant-root managed-restore challenge activation receipt",
        &challenge.activation_receipt_b64u,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BYTES_V1,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BASE64URL_BYTES_V1,
    )?;
    let activation_receipt =
        TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&receipt_bytes)
            .map_err(candidate_derivation_error)?;
    let activation_receipt_digest = decode_lifecycle_receipt_digest(
        "tenant-root managed-restore challenge activation receipt digest",
        &challenge.activation_receipt_digest_b64u,
    )?;
    if activation_receipt
        .digest()
        .map_err(candidate_derivation_error)?
        != activation_receipt_digest
        || activation_receipt.identity_digest() != identity_digest
        || activation_receipt.custody_lineage() != custody_lineage
    {
        return Err(malformed_input(
            "tenant-root managed-restore challenge activation receipt does not match its binding",
        ));
    }
    let activation_receipt_epoch = match activation_receipt.binding() {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => binding.epoch(),
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => binding.next_epoch(),
    };
    if activation_receipt_epoch != active_epoch {
        return Err(malformed_input(
            "tenant-root managed-restore challenge activation receipt epoch does not match its active epoch",
        ));
    }
    validate_managed_restore_identifier_v1(
        "tenant-root managed-restore challenge incident id",
        &challenge.incident_id,
    )?;
    TenantRootLifecycleReceiptDigestV1::from_bytes(decode_fixed_base64url_32(
        "tenant-root managed-restore challenge outage observation digest",
        &challenge.outage_observation_digest_b64u,
    )?)
    .map_err(candidate_derivation_error)?;
    validate_managed_restore_time_window_v1(
        "tenant-root managed-restore challenge",
        challenge.issued_at_ms,
        challenge.expires_at_ms,
    )?;
    let nonce = decode_canonical_base64url(
        "tenant-root managed-restore challenge nonce",
        &challenge.nonce_b64u,
        TENANT_ROOT_MANAGED_RESTORE_NONCE_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_MANAGED_RESTORE_NONCE_BYTES_V1),
    )?;
    if nonce.iter().all(|byte| *byte == 0) {
        return Err(malformed_input(
            "tenant-root managed-restore challenge nonce must be non-zero",
        ));
    }
    let expected_digest = managed_restore_authorization_challenge_digest_v1(challenge)?;
    if challenge.challenge_digest_b64u != encode_base64url_bytes_v1(expected_digest.as_bytes()) {
        return Err(malformed_input(
            "tenant-root managed-restore challenge digest does not match its fields",
        ));
    }
    Ok(())
}

pub(super) fn validate_managed_restore_attempt_shape_v1(
    attempt: &CloudflareTenantRootManagedRestoreAuthorizationAttemptV1,
) -> RouterAbProtocolResult<()> {
    decode_protocol_digest_b64u(
        "tenant-root managed-restore attempt id",
        &attempt.attempt_id_b64u,
    )?;
    decode_protocol_digest_b64u(
        "tenant-root managed-restore attempt challenge digest",
        &attempt.challenge_digest_b64u,
    )?;
    Ok(())
}

pub(super) fn validate_managed_restore_fence_shape(
    fence: &CloudflareTenantRootManagedRestoreFenceV1,
) -> RouterAbProtocolResult<()> {
    match fence {
        CloudflareTenantRootManagedRestoreFenceV1::Open => Ok(()),
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { challenge, attempt } => {
            validate_managed_restore_challenge_shape_v1(challenge)?;
            validate_managed_restore_attempt_shape_v1(attempt)?;
            require_managed_restore_attempt_matches_challenge_v1(challenge, attempt)
        }
        CloudflareTenantRootManagedRestoreFenceV1::Terminal {
            challenge,
            attempt,
            public_state_b64u,
            capability_b64u,
            incident_authorization_b64u,
        } => {
            validate_managed_restore_challenge_shape_v1(challenge)?;
            validate_managed_restore_attempt_shape_v1(attempt)?;
            require_managed_restore_attempt_matches_challenge_v1(challenge, attempt)?;
            validate_managed_restore_artifacts_v1(
                public_state_b64u,
                capability_b64u,
                incident_authorization_b64u,
            )
        }
        CloudflareTenantRootManagedRestoreFenceV1::Expired {
            challenge,
            attempt,
            expired_at_ms,
        } => {
            validate_managed_restore_challenge_shape_v1(challenge)?;
            validate_managed_restore_attempt_shape_v1(attempt)?;
            require_managed_restore_attempt_matches_challenge_v1(challenge, attempt)?;
            if *expired_at_ms <= challenge.expires_at_ms {
                return Err(malformed_input(
                    "tenant-root managed-restore reservation expired inside its own window",
                ));
            }
            Ok(())
        }
        CloudflareTenantRootManagedRestoreFenceV1::Superseded {
            challenge,
            attempt,
            superseded_at_revision,
        } => {
            validate_managed_restore_challenge_shape_v1(challenge)?;
            validate_managed_restore_attempt_shape_v1(attempt)?;
            require_managed_restore_attempt_matches_challenge_v1(challenge, attempt)?;
            if *superseded_at_revision <= challenge.active_lifecycle_revision {
                return Err(malformed_input(
                    "tenant-root managed restore was superseded before the state it authorized",
                ));
            }
            Ok(())
        }
    }
}

pub(super) fn validate_managed_restore_fence_against_active_v1(
    active: &ValidatedTenantRootRefreshActiveStateV1,
) -> RouterAbProtocolResult<()> {
    validate_managed_restore_fence_shape(&active.record.managed_restore_fence)?;
    require_managed_restore_fence_matches_active_fields_v1(
        &active.record.fence,
        &active.record.managed_restore_fence,
        active.identity_digest,
        active.custody_lineage,
        active.active_epoch,
        active.record.lifecycle_revision,
        &active.record.activation_receipt_b64u,
        active.activation_receipt_digest,
    )
}

pub(super) fn require_managed_restore_fence_matches_active_fields_v1(
    refresh_fence: &CloudflareTenantRootRefreshFenceV1,
    fence: &CloudflareTenantRootManagedRestoreFenceV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    active_epoch: TenantRootShareEpoch,
    active_lifecycle_revision: u64,
    activation_receipt_b64u: &str,
    activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
) -> RouterAbProtocolResult<()> {
    let (challenge, _) = match fence {
        // An expired or superseded restore names the state it was reserved
        // against, which later refreshes have moved past.
        CloudflareTenantRootManagedRestoreFenceV1::Open
        | CloudflareTenantRootManagedRestoreFenceV1::Expired { .. }
        | CloudflareTenantRootManagedRestoreFenceV1::Superseded { .. } => return Ok(()),
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { challenge, attempt }
        | CloudflareTenantRootManagedRestoreFenceV1::Terminal {
            challenge, attempt, ..
        } => (challenge, attempt),
    };
    if require_managed_restore_challenge_matches_active_fields_v1(
        challenge,
        identity_digest,
        custody_lineage,
        active_epoch,
        active_lifecycle_revision,
        activation_receipt_b64u,
        activation_receipt_digest,
    )
    .is_ok()
    {
        return Ok(());
    }
    if matches!(
        fence,
        CloudflareTenantRootManagedRestoreFenceV1::Reserved { .. }
    ) {
        return Err(managed_restore_conflict(
            "tenant-root managed-restore reserved challenge does not match active state",
        ));
    }
    require_managed_restore_terminal_fence_matches_refresh_transition_v1(
        refresh_fence,
        challenge,
        identity_digest,
        custody_lineage,
        active_epoch,
        active_lifecycle_revision,
    )
}

pub(super) fn require_managed_restore_terminal_fence_matches_refresh_transition_v1(
    refresh_fence: &CloudflareTenantRootRefreshFenceV1,
    challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    active_epoch: TenantRootShareEpoch,
    active_lifecycle_revision: u64,
) -> RouterAbProtocolResult<()> {
    let CloudflareTenantRootRefreshFenceV1::Terminal {
        attempt: refresh_attempt_for_state,
        outcome: CloudflareTenantRootRefreshTerminalOutcomeV1::Completed,
        ..
    } = refresh_fence
    else {
        return Err(managed_restore_conflict(
            "tenant-root managed-restore terminal challenge does not match active state",
        ));
    };
    if refresh_attempt_for_state.identity_digest_b64u
        != encode_base64url_bytes_v1(identity_digest.as_bytes())
        || refresh_attempt_for_state.custody_lineage_b64u != custody_lineage.to_base64url()
        || refresh_attempt_for_state.identity_digest_b64u != challenge.identity_digest_b64u
        || refresh_attempt_for_state.custody_lineage_b64u != challenge.custody_lineage_b64u
        || refresh_attempt_for_state.current_epoch != challenge.active_epoch
        || refresh_attempt_for_state.next_epoch != active_epoch.get().get()
        || refresh_attempt_for_state.expected_control_plane_revision
            != challenge.active_lifecycle_revision
        || challenge.active_lifecycle_revision.checked_add(1) != Some(active_lifecycle_revision)
    {
        return Err(managed_restore_conflict(
            "tenant-root managed-restore terminal challenge does not match the completed refresh transition",
        ));
    }
    Ok(())
}

pub(super) fn require_managed_restore_challenge_matches_active_v1(
    active: &ValidatedTenantRootRefreshActiveStateV1,
    challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
) -> RouterAbProtocolResult<()> {
    require_managed_restore_challenge_matches_active_fields_v1(
        challenge,
        active.identity_digest,
        active.custody_lineage,
        active.active_epoch,
        active.record.lifecycle_revision,
        &active.record.activation_receipt_b64u,
        active.activation_receipt_digest,
    )
}

pub(super) fn require_managed_restore_challenge_matches_active_fields_v1(
    challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    active_epoch: TenantRootShareEpoch,
    active_lifecycle_revision: u64,
    activation_receipt_b64u: &str,
    activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
) -> RouterAbProtocolResult<()> {
    if challenge.identity_digest_b64u != encode_base64url_bytes_v1(identity_digest.as_bytes())
        || challenge.custody_lineage_b64u != custody_lineage.to_base64url()
        || challenge.active_epoch != active_epoch.get().get()
        || challenge.active_lifecycle_revision != active_lifecycle_revision
        || challenge.activation_receipt_b64u != activation_receipt_b64u
        || challenge.activation_receipt_digest_b64u
            != encode_base64url_bytes_v1(activation_receipt_digest.as_bytes())
    {
        return Err(managed_restore_conflict(
            "tenant-root managed-restore challenge does not match active state",
        ));
    }
    Ok(())
}

pub(super) fn require_managed_restore_attempt_matches_challenge_v1(
    challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
    attempt: &CloudflareTenantRootManagedRestoreAuthorizationAttemptV1,
) -> RouterAbProtocolResult<()> {
    let expected = managed_restore_authorization_attempt_from_challenge_v1(challenge)?;
    if &expected != attempt {
        return Err(managed_restore_conflict(
            "tenant-root managed-restore attempt does not match its challenge",
        ));
    }
    Ok(())
}

pub(crate) fn managed_restore_authorization_attempt_from_challenge_v1(
    challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
) -> RouterAbProtocolResult<CloudflareTenantRootManagedRestoreAuthorizationAttemptV1> {
    let challenge_digest = decode_protocol_digest_b64u(
        "tenant-root managed-restore challenge digest",
        &challenge.challenge_digest_b64u,
    )?;
    let mut hasher = Sha256::new();
    hasher.update(TENANT_ROOT_MANAGED_RESTORE_ATTEMPT_DOMAIN_V1);
    update_managed_restore_hash_field(&mut hasher, challenge_digest.as_bytes())?;
    let attempt_id = TenantRootProtocolDigestV1::from_bytes(hasher.finalize().into())
        .map_err(candidate_derivation_error)?;
    Ok(CloudflareTenantRootManagedRestoreAuthorizationAttemptV1 {
        attempt_id_b64u: encode_base64url_bytes_v1(attempt_id.as_bytes()),
        challenge_digest_b64u: challenge.challenge_digest_b64u.clone(),
    })
}

pub(super) fn managed_restore_authorization_challenge_digest_v1(
    challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
) -> RouterAbProtocolResult<TenantRootProtocolDigestV1> {
    let identity_bytes = decode_canonical_base64url(
        "tenant-root managed-restore challenge identity",
        &challenge.identity_b64u,
        TENANT_ROOT_MANAGED_RESTORE_IDENTITY_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_MANAGED_RESTORE_IDENTITY_MAX_BYTES_V1),
    )?;
    let identity_digest = decode_fixed_base64url_32(
        "tenant-root managed-restore challenge identity digest",
        &challenge.identity_digest_b64u,
    )?;
    let custody_lineage = decode_canonical_base64url(
        "tenant-root managed-restore challenge custody lineage",
        &challenge.custody_lineage_b64u,
        16,
        base64url_len_for_bytes(16),
    )?;
    let receipt_bytes = decode_canonical_base64url(
        "tenant-root managed-restore challenge activation receipt",
        &challenge.activation_receipt_b64u,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BYTES_V1,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BASE64URL_BYTES_V1,
    )?;
    let receipt_digest = decode_fixed_base64url_32(
        "tenant-root managed-restore challenge activation receipt digest",
        &challenge.activation_receipt_digest_b64u,
    )?;
    let outage_observation_digest = decode_fixed_base64url_32(
        "tenant-root managed-restore challenge outage observation digest",
        &challenge.outage_observation_digest_b64u,
    )?;
    let nonce = decode_canonical_base64url(
        "tenant-root managed-restore challenge nonce",
        &challenge.nonce_b64u,
        TENANT_ROOT_MANAGED_RESTORE_NONCE_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_MANAGED_RESTORE_NONCE_BYTES_V1),
    )?;
    let mut hasher = Sha256::new();
    hasher.update(TENANT_ROOT_MANAGED_RESTORE_CHALLENGE_DOMAIN_V1);
    update_managed_restore_hash_field(&mut hasher, &identity_bytes)?;
    update_managed_restore_hash_field(&mut hasher, &identity_digest)?;
    update_managed_restore_hash_field(&mut hasher, &custody_lineage)?;
    update_managed_restore_hash_field(&mut hasher, &challenge.active_epoch.to_be_bytes())?;
    update_managed_restore_hash_field(
        &mut hasher,
        &challenge.active_lifecycle_revision.to_be_bytes(),
    )?;
    update_managed_restore_hash_field(&mut hasher, &receipt_bytes)?;
    update_managed_restore_hash_field(&mut hasher, &receipt_digest)?;
    update_managed_restore_hash_field(&mut hasher, challenge.incident_id.as_bytes())?;
    update_managed_restore_hash_field(&mut hasher, &outage_observation_digest)?;
    update_managed_restore_hash_field(&mut hasher, &challenge.issued_at_ms.to_be_bytes())?;
    update_managed_restore_hash_field(&mut hasher, &challenge.expires_at_ms.to_be_bytes())?;
    update_managed_restore_hash_field(&mut hasher, &nonce)?;
    let (role_label, role_id) = match challenge.unavailable_role {
        TenantRootManagedRestoreRoleV1::DeriverA => (b"deriver_a".as_slice(), 1_u16),
        TenantRootManagedRestoreRoleV1::DeriverB => (b"deriver_b".as_slice(), 2_u16),
    };
    update_managed_restore_hash_field(&mut hasher, role_label)?;
    update_managed_restore_hash_field(&mut hasher, &role_id.to_be_bytes())?;
    TenantRootProtocolDigestV1::from_bytes(hasher.finalize().into())
        .map_err(candidate_derivation_error)
}

pub(super) fn update_managed_restore_hash_field(
    hasher: &mut Sha256,
    value: &[u8],
) -> RouterAbProtocolResult<()> {
    let length = u32::try_from(value.len())
        .map_err(|_| malformed_input("tenant-root managed-restore challenge field is too long"))?;
    hasher.update(length.to_be_bytes());
    hasher.update(value);
    Ok(())
}

pub(super) fn require_managed_restore_challenge_fresh_v1(
    challenge: &CloudflareTenantRootManagedRestoreAuthorizationChallengeV1,
    now_ms: u64,
) -> RouterAbProtocolResult<()> {
    if now_ms < challenge.issued_at_ms || now_ms > challenge.expires_at_ms {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            "tenant-root managed-restore authorization is outside its freshness window",
        ));
    }
    Ok(())
}

pub(super) fn validate_managed_restore_time_window_v1(
    field: &'static str,
    issued_at_ms: u64,
    expires_at_ms: u64,
) -> RouterAbProtocolResult<()> {
    if issued_at_ms == 0 || expires_at_ms <= issued_at_ms {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidTimeRange,
            format!("{field} time window is invalid"),
        ));
    }
    if expires_at_ms - issued_at_ms > TENANT_ROOT_MAX_LIFETIME_MS_V1 {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidTimeRange,
            format!("{field} lifetime exceeds the frozen maximum window"),
        ));
    }
    Ok(())
}

pub(super) fn validate_managed_restore_identifier_v1(
    field: &'static str,
    value: &str,
) -> RouterAbProtocolResult<()> {
    if value.is_empty() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::EmptyField,
            format!("{field} is required"),
        ));
    }
    if value.len() > TENANT_ROOT_MANAGED_RESTORE_INCIDENT_MAX_BYTES_V1 {
        return Err(malformed_input(format!("{field} is too long")));
    }
    if value.trim() != value || value.chars().any(char::is_control) {
        return Err(malformed_input(format!(
            "{field} is not a valid identifier"
        )));
    }
    Ok(())
}

pub(super) fn validate_managed_restore_artifacts_v1(
    public_state_b64u: &str,
    capability_b64u: &str,
    incident_authorization_b64u: &str,
) -> RouterAbProtocolResult<()> {
    // The DO records exact canonical wires. Signature verification belongs to
    // the control-plane and role boundaries that consume these artifacts.
    decode_canonical_base64url(
        "tenant-root managed-restore public state",
        public_state_b64u,
        TENANT_ROOT_MANAGED_RESTORE_PUBLIC_STATE_MAX_BYTES,
        TENANT_ROOT_MANAGED_RESTORE_PUBLIC_STATE_MAX_BASE64URL_BYTES_V1,
    )?;
    decode_canonical_base64url(
        "tenant-root managed-restore capability",
        capability_b64u,
        TENANT_ROOT_MANAGED_RESTORE_CAPABILITY_MAX_BYTES_V1,
        TENANT_ROOT_MANAGED_RESTORE_CAPABILITY_MAX_BASE64URL_BYTES_V1,
    )?;
    decode_canonical_base64url(
        "tenant-root managed-restore incident authorization",
        incident_authorization_b64u,
        TENANT_ROOT_MANAGED_RESTORE_INCIDENT_AUTHORIZATION_MAX_BYTES_V1,
        TENANT_ROOT_MANAGED_RESTORE_INCIDENT_AUTHORIZATION_MAX_BASE64URL_BYTES_V1,
    )?;
    Ok(())
}

pub(super) fn managed_restore_conflict(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ConflictingPair, message)
}

pub(super) fn decode_lifecycle_receipt_digest(
    field: &str,
    encoded: &str,
) -> RouterAbProtocolResult<TenantRootLifecycleReceiptDigestV1> {
    TenantRootLifecycleReceiptDigestV1::from_bytes(decode_fixed_base64url_32(field, encoded)?)
        .map_err(candidate_derivation_error)
}

pub(super) fn decode_lineage_b64u(
    field: &str,
    encoded: &str,
) -> RouterAbProtocolResult<TenantRootCustodyLineageId> {
    let bytes = decode_canonical_base64url(field, encoded, 16, base64url_len_for_bytes(16))?;
    TenantRootCustodyLineageId::from_bytes(
        bytes
            .try_into()
            .map_err(|_| malformed_input(format!("{field} must contain exactly 16 bytes")))?,
    )
    .map_err(candidate_derivation_error)
}

pub(super) fn decode_share_commitment_b64u(
    field: &str,
    encoded: &str,
) -> RouterAbProtocolResult<MpcPrfShareCommitmentWireV1> {
    let bytes = decode_canonical_base64url(field, encoded, 128, base64url_len_for_bytes(128))?;
    MpcPrfShareCommitmentWireV1::new(bytes).map_err(candidate_derivation_error)
}

pub(super) fn refresh_attempt_from_commands(
    context: &TenantRootCeremonyContextV1,
    deriver_a: &VerifiedTenantRootRoleRefreshCommandV1,
    deriver_b: &VerifiedTenantRootRoleRefreshCommandV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshAttemptV1> {
    if deriver_a.role() != TwoPartyDeriverRole::DeriverA
        || deriver_b.role() != TwoPartyDeriverRole::DeriverB
        || deriver_a.identity_digest() != deriver_b.identity_digest()
        || deriver_a.custody_lineage() != deriver_b.custody_lineage()
        || deriver_a.current_epoch() != deriver_b.current_epoch()
        || deriver_a.next_epoch() != deriver_b.next_epoch()
        || deriver_a.expected_control_plane_revision()
            != deriver_b.expected_control_plane_revision()
        || deriver_a.authority_id() != deriver_b.authority_id()
        || deriver_a.refresh_context_digest() != deriver_b.refresh_context_digest()
        || deriver_a.session_id() != deriver_b.session_id()
        || deriver_a.nonce() != deriver_b.nonce()
        || deriver_a.refresh_context_digest()
            != context.digest().map_err(candidate_derivation_error)?
        || context.identity_digest() != deriver_a.identity_digest()
        || context.custody_lineage() != deriver_a.custody_lineage()
        || context.session_id() != deriver_a.session_id()
        || context.nonce() != deriver_a.nonce()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "tenant-root refresh attempt commands do not share one exact context",
        ));
    }
    Ok(CloudflareTenantRootRefreshAttemptV1 {
        manual_operation_id: None,
        attempt_id_b64u: encode_base64url_bytes_v1(deriver_a.session_id().as_bytes()),
        identity_digest_b64u: encode_base64url_bytes_v1(deriver_a.identity_digest().as_bytes()),
        custody_lineage_b64u: deriver_a.custody_lineage().to_base64url(),
        command_digest_b64u: encode_base64url_bytes_v1(deriver_a.digest().as_bytes()),
        deriver_b_command_digest_b64u: encode_base64url_bytes_v1(deriver_b.digest().as_bytes()),
        ceremony_context_digest_b64u: encode_base64url_bytes_v1(
            deriver_a.refresh_context_digest().as_bytes(),
        ),
        refresh_context_b64u: encode_base64url_bytes_v1(
            &context
                .canonical_bytes()
                .map_err(candidate_derivation_error)?,
        ),
        deriver_a_refresh_command_b64u: encode_base64url_bytes_v1(deriver_a.canonical_bytes()),
        deriver_b_refresh_command_b64u: encode_base64url_bytes_v1(deriver_b.canonical_bytes()),
        session_id_b64u: encode_base64url_bytes_v1(deriver_a.session_id().as_bytes()),
        nonce_b64u: encode_base64url_bytes_v1(deriver_a.nonce().as_bytes()),
        current_epoch: deriver_a.current_epoch().get().get(),
        next_epoch: deriver_a.next_epoch().get().get(),
        expected_control_plane_revision: deriver_a.expected_control_plane_revision(),
    })
}

pub(super) fn require_refresh_attempt_matches_command(
    attempt: &CloudflareTenantRootRefreshAttemptV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
) -> RouterAbProtocolResult<()> {
    let command_digest_b64u = encode_base64url_bytes_v1(command.digest().as_bytes());
    let expected_command_digest_b64u = match command.role() {
        TwoPartyDeriverRole::DeriverA => &attempt.command_digest_b64u,
        TwoPartyDeriverRole::DeriverB => &attempt.deriver_b_command_digest_b64u,
    };
    if command_digest_b64u != *expected_command_digest_b64u
        || encode_base64url_bytes_v1(command.identity_digest().as_bytes())
            != attempt.identity_digest_b64u
        || command.custody_lineage().to_base64url() != attempt.custody_lineage_b64u
        || encode_base64url_bytes_v1(command.refresh_context_digest().as_bytes())
            != attempt.ceremony_context_digest_b64u
        || encode_base64url_bytes_v1(command.session_id().as_bytes()) != attempt.session_id_b64u
        || encode_base64url_bytes_v1(command.nonce().as_bytes()) != attempt.nonce_b64u
        || command.current_epoch().get().get() != attempt.current_epoch
        || command.next_epoch().get().get() != attempt.next_epoch
        || command.expected_control_plane_revision() != attempt.expected_control_plane_revision
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "tenant-root refresh operation fence does not match the authenticated command",
        ));
    }
    Ok(())
}

pub(super) fn require_refresh_fence_matches_command(
    fence: &CloudflareTenantRootRefreshFenceV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
) -> RouterAbProtocolResult<()> {
    match fence {
        CloudflareTenantRootRefreshFenceV1::Open => Ok(()),
        CloudflareTenantRootRefreshFenceV1::Reserved { attempt }
        | CloudflareTenantRootRefreshFenceV1::Executed { attempt } => {
            require_refresh_attempt_matches_command(attempt, command)
        }
        CloudflareTenantRootRefreshFenceV1::Terminal { .. } => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "tenant-root refresh operation is terminal",
        )),
        CloudflareTenantRootRefreshFenceV1::Abandoned { .. } => {
            Err(refresh_attempt_abandoned_error())
        }
    }
}

/// The attempt missed its ceremony window before the Router committed it.
pub(crate) fn refresh_attempt_abandoned_error() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::ConflictingPair,
        "tenant-root refresh attempt expired before its commit and was abandoned",
    )
}

pub(super) fn refresh_reserved_fence(
    fence: &CloudflareTenantRootRefreshFenceV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshFenceV1> {
    match fence {
        CloudflareTenantRootRefreshFenceV1::Reserved { attempt } => {
            require_refresh_attempt_matches_command(attempt, command)?;
            Ok(CloudflareTenantRootRefreshFenceV1::Reserved {
                attempt: attempt.clone(),
            })
        }
        CloudflareTenantRootRefreshFenceV1::Open => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingPairPreparation,
            "tenant-root refresh commitment requires a persisted Router attempt",
        )),
        CloudflareTenantRootRefreshFenceV1::Executed { .. }
        | CloudflareTenantRootRefreshFenceV1::Terminal { .. } => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "tenant-root refresh operation has passed its commitment checkpoint",
        )),
        CloudflareTenantRootRefreshFenceV1::Abandoned { .. } => {
            Err(refresh_attempt_abandoned_error())
        }
    }
}

pub(super) fn refresh_executed_fence(
    fence: &CloudflareTenantRootRefreshFenceV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshFenceV1> {
    match fence {
        CloudflareTenantRootRefreshFenceV1::Reserved { attempt }
        | CloudflareTenantRootRefreshFenceV1::Executed { attempt } => {
            require_refresh_attempt_matches_command(attempt, command)?;
            Ok(CloudflareTenantRootRefreshFenceV1::Executed {
                attempt: attempt.clone(),
            })
        }
        CloudflareTenantRootRefreshFenceV1::Open => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingPairPreparation,
            "tenant-root refresh installation requires a reserved operation",
        )),
        CloudflareTenantRootRefreshFenceV1::Terminal { .. } => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "tenant-root refresh operation is terminal",
        )),
        CloudflareTenantRootRefreshFenceV1::Abandoned { .. } => {
            Err(refresh_attempt_abandoned_error())
        }
    }
}

pub(super) fn refresh_checkpoint_scope(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    active: &ValidatedTenantRootRefreshActiveStateV1,
    context: &TenantRootCeremonyContextV1,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshCheckpointScopeV1> {
    context.validate().map_err(candidate_derivation_error)?;
    let TenantRootCeremonyEpochsV1::Refresh { current, next } = context.epochs() else {
        return Err(malformed_input(
            "tenant-root refresh checkpoint requires a refresh ceremony context",
        ));
    };
    let context_digest = context.digest().map_err(candidate_derivation_error)?;
    if command.authority_id() != expected_authority_id
        || command.identity_digest() != active.identity_digest
        || command.custody_lineage() != active.custody_lineage
        || command.current_epoch() != active.active_epoch
        || command.expected_control_plane_revision() != active.record.lifecycle_revision
        || command.deriver_a_share_commitment() != active.commitments.deriver_a()
        || command.deriver_b_share_commitment() != active.commitments.deriver_b()
        || command.active_root_commitment() != active.commitments.root_commitment()
        || command.active_activation_receipt_digest() != active.activation_receipt_digest
        || command.refresh_context_digest() != context_digest
        || context.identity_digest() != active.identity_digest
        || context.custody_lineage() != active.custody_lineage
        || current != active.active_epoch
        || command.next_epoch() != next
        || command.session_id() != context.session_id()
        || command.nonce() != context.nonce()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh command does not match the authoritative active state",
        ));
    }
    Ok(CloudflareTenantRootRefreshCheckpointScopeV1 {
        identity_digest_b64u: encode_base64url_bytes_v1(active.identity_digest.as_bytes()),
        custody_lineage_b64u: active.custody_lineage.to_base64url(),
        authority_id_b64u: encode_base64url_bytes_v1(expected_authority_id.as_bytes()),
        ceremony_context_digest_b64u: encode_base64url_bytes_v1(context_digest.as_bytes()),
        current_epoch: current.get().get(),
        next_epoch: next.get().get(),
        expected_control_plane_revision: active.record.lifecycle_revision,
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
