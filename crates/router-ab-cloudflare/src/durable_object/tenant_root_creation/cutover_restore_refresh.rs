//! Cutover-write evaluation and the restore-refresh checkpoint, with journal reads and schedule parsing.

use super::*;

#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
pub(super) fn evaluate_cutover_write(
    current: Option<&TenantRootCutoverRecordV1>,
    request: CloudflareTenantRootCutoverWriteRequestV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCutoverWriteResponseV1> {
    match request {
        CloudflareTenantRootCutoverWriteRequestV1::Initialize { record } => match current {
            None if record.revision() == 0 => Ok(CloudflareTenantRootCutoverWriteResponseV1 {
                outcome: CloudflareTenantRootCutoverWriteOutcomeV1::Initialized,
                record,
            }),
            None => Err(cutover_conflict(
                "R120 cutover initialization must persist revision 0",
            )),
            Some(stored) if stored == &record => Ok(CloudflareTenantRootCutoverWriteResponseV1 {
                outcome: CloudflareTenantRootCutoverWriteOutcomeV1::ExactReplay,
                record,
            }),
            Some(_) => Err(cutover_conflict(
                "R120 cutover initialization conflicts with durable state",
            )),
        },
        CloudflareTenantRootCutoverWriteRequestV1::Update {
            expected_revision,
            record,
        } => {
            let stored = current.ok_or_else(|| {
                cutover_conflict("R120 cutover update has no durable initial state")
            })?;
            if stored.revision() != expected_revision {
                return Err(cutover_conflict(
                    "R120 cutover update expected another durable revision",
                ));
            }
            let outcome = match record.classify_update_after(stored)? {
                TenantRootCutoverRecordUpdateV1::ExactReplay => {
                    CloudflareTenantRootCutoverWriteOutcomeV1::ExactReplay
                }
                TenantRootCutoverRecordUpdateV1::Advanced => {
                    CloudflareTenantRootCutoverWriteOutcomeV1::Advanced
                }
            };
            Ok(CloudflareTenantRootCutoverWriteResponseV1 { outcome, record })
        }
    }
}

#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
pub(super) fn cutover_conflict(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ConflictingPair, message)
}

pub(super) fn restore_refresh_conflict(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ConflictingPair, message)
}

pub(super) fn restore_refresh_lifecycle_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}

pub(super) fn restore_refresh_expired_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ExpiredLocalRequest, message)
}

pub(super) fn restore_refresh_checkpoint_grant_b64u_v1(
    request: &CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
) -> &str {
    match request {
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::Admit {
            restore_refresh_grant_b64u,
            ..
        }
        | CloudflareTenantRootRestoreRefreshCheckpointRequestV1::PersistCommands {
            restore_refresh_grant_b64u,
            ..
        }
        | CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitPrepared {
            restore_refresh_grant_b64u,
            ..
        }
        | CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitContributed {
            restore_refresh_grant_b64u,
            ..
        }
        | CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitCompleted {
            restore_refresh_grant_b64u,
            ..
        } => restore_refresh_grant_b64u,
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitPromoted {
            restore_refresh_grant_b64u,
            ..
        } => restore_refresh_grant_b64u,
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::ReadCompleted {
            restore_refresh_grant_b64u,
            ..
        } => restore_refresh_grant_b64u,
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::ReadPromoted {
            restore_refresh_grant_b64u,
            ..
        } => restore_refresh_grant_b64u,
    }
}

pub(super) fn restore_refresh_checkpoint_scope_from_grant_v1(
    grant_b64u: &str,
) -> RouterAbProtocolResult<(
    String,
    TenantRootRestoreRefreshGrantV1,
    CloudflareTenantRootRestoreRefreshCheckpointScopeV1,
)> {
    let grant_bytes = decode_canonical_base64url(
        "tenant-root restore-refresh grant",
        grant_b64u,
        TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_RESTORE_REFRESH_GRANT_MAX_BYTES_V1),
    )?;
    let canonical_grant_b64u = encode_base64url_bytes_v1(&grant_bytes);
    if canonical_grant_b64u != grant_b64u {
        return Err(malformed_input(
            "tenant-root restore-refresh grant must use canonical base64url",
        ));
    }
    let grant = TenantRootRestoreRefreshGrantV1::decode_canonical_bytes(&grant_bytes)
        .map_err(candidate_derivation_error)?;
    let grant_digest = grant.digest().map_err(candidate_derivation_error)?;
    let scope = CloudflareTenantRootRestoreRefreshCheckpointScopeV1 {
        grant_digest_b64u: encode_base64url_bytes_v1(grant_digest.as_bytes()),
        operation_digest_b64u: encode_base64url_bytes_v1(grant.operation_digest().as_bytes()),
        identity_digest_b64u: encode_base64url_bytes_v1(
            grant.destination_identity_digest().as_bytes(),
        ),
        custody_lineage_b64u: grant.destination_lineage().to_base64url(),
        destination_fingerprint_b64u: encode_base64url_bytes_v1(
            grant.destination_fingerprint().as_bytes(),
        ),
        restore_session_id_b64u: encode_base64url_bytes_v1(grant.restore_session_id().as_bytes()),
        manifest_digest_b64u: encode_base64url_bytes_v1(grant.manifest_digest()),
        deriver_a_acceptance_receipt_digest_b64u: encode_base64url_bytes_v1(
            grant.deriver_a_acceptance_receipt_digest().as_bytes(),
        ),
        deriver_b_acceptance_receipt_digest_b64u: encode_base64url_bytes_v1(
            grant.deriver_b_acceptance_receipt_digest().as_bytes(),
        ),
        issued_at_ms: grant.issued_at_ms(),
        expires_at_ms: grant.expires_at_ms(),
    };
    Ok((canonical_grant_b64u, grant, scope))
}

pub(super) fn require_restore_refresh_manifest_matches_grant_v1(
    manifest_b64u: &str,
    grant: &TenantRootRestoreRefreshGrantV1,
) -> RouterAbProtocolResult<()> {
    let manifest_bytes = decode_canonical_base64url(
        "tenant-root restore-refresh recovery manifest",
        manifest_b64u,
        TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES,
        base64url_len_for_bytes(TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES),
    )?;
    let manifest = TenantRootRecoveryManifestV1::from_canonical_json(&manifest_bytes)
        .map_err(candidate_derivation_error)?;
    let manifest_digest = manifest.digest().map_err(candidate_derivation_error)?;
    if &manifest_digest != grant.manifest_digest() {
        return Err(restore_refresh_conflict(
            "tenant-root restore-refresh manifest does not match its grant",
        ));
    }
    Ok(())
}

pub(super) fn restore_refresh_scope_matches_grant_v1(
    scope: &CloudflareTenantRootRestoreRefreshCheckpointScopeV1,
    grant_scope: &CloudflareTenantRootRestoreRefreshCheckpointScopeV1,
) -> bool {
    scope == grant_scope
}

pub(super) fn validate_restore_refresh_wire_v1(
    field: &'static str,
    encoded: &str,
    max_bytes: usize,
) -> RouterAbProtocolResult<()> {
    decode_canonical_base64url(
        field,
        encoded,
        max_bytes,
        base64url_len_for_bytes(max_bytes),
    )?;
    Ok(())
}

pub(super) fn validate_restore_refresh_role_promotion_v1(
    promotion: &CloudflareTenantRootRestoreRefreshRolePromotionV1,
    commands: &CloudflareTenantRootRestoreRefreshCommandsV1,
    scope: &CloudflareTenantRootRestoreRefreshCheckpointScopeV1,
) -> RouterAbProtocolResult<()> {
    let expected_command = match promotion.role {
        CloudflareTenantRootCreationInstallationRoleV1::DeriverA => {
            &commands.deriver_a_refresh_command_b64u
        }
        CloudflareTenantRootCreationInstallationRoleV1::DeriverB => {
            &commands.deriver_b_refresh_command_b64u
        }
    };
    if expected_command != &promotion.restore_refresh_role_command_b64u {
        return Err(restore_refresh_conflict(
            "tenant-root restore-refresh promotion command is not the persisted role command",
        ));
    }
    let command_bytes = decode_canonical_base64url(
        "tenant-root restore-refresh promoted role command",
        &promotion.restore_refresh_role_command_b64u,
        TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1),
    )?;
    if encode_base64url_bytes_v1(&command_bytes) != promotion.restore_refresh_role_command_b64u
        || encode_base64url_bytes_v1(&Sha256::digest(&command_bytes))
            != promotion.command_digest_b64u
    {
        return Err(restore_refresh_conflict(
            "tenant-root restore-refresh promotion command digest changed",
        ));
    }
    for (field, encoded, max_bytes, digest) in [
        (
            "tenant-root restore-refresh promoted installation evidence",
            &promotion.signed_installation_evidence_b64u,
            TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1,
            &promotion.installation_evidence_digest_b64u,
        ),
        (
            "tenant-root restore-refresh promoted provider canary",
            &promotion.provider_canary_receipt_b64u,
            TENANT_ROOT_PROVIDER_CANARY_RECEIPT_MAX_BYTES_V1,
            &promotion.provider_canary_receipt_digest_b64u,
        ),
    ] {
        let bytes = decode_canonical_base64url(
            field,
            encoded,
            max_bytes,
            base64url_len_for_bytes(max_bytes),
        )?;
        if encode_base64url_bytes_v1(&Sha256::digest(&bytes)) != *digest {
            return Err(restore_refresh_conflict(
                "tenant-root restore-refresh promotion artifact digest changed",
            ));
        }
    }
    decode_fixed_base64url_32(
        "tenant-root restore-refresh installation evidence digest",
        &promotion.installation_evidence_digest_b64u,
    )?;
    decode_fixed_base64url_32(
        "tenant-root restore-refresh provider canary digest",
        &promotion.provider_canary_receipt_digest_b64u,
    )?;
    if promotion.completed_at_ms < scope.issued_at_ms
        || promotion.completed_at_ms > scope.expires_at_ms
    {
        return Err(restore_refresh_conflict(
            "tenant-root restore-refresh promotion completion is outside authorization",
        ));
    }
    Ok(())
}

pub(super) fn validate_restore_refresh_commands_v1(
    commands: &CloudflareTenantRootRestoreRefreshCommandsV1,
    scope: &CloudflareTenantRootRestoreRefreshCheckpointScopeV1,
) -> RouterAbProtocolResult<()> {
    let context_bytes = decode_canonical_base64url(
        "stored tenant-root restore-refresh context",
        &commands.refresh_context_b64u,
        16 * 1024,
        base64url_len_for_bytes(16 * 1024),
    )?;
    let context = TenantRootCeremonyContextV1::decode_canonical_bytes(&context_bytes)
        .map_err(candidate_derivation_error)?;
    let command_a_bytes = decode_canonical_base64url(
        "stored tenant-root Deriver A restore-refresh command",
        &commands.deriver_a_refresh_command_b64u,
        TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1),
    )?;
    let command_b_bytes = decode_canonical_base64url(
        "stored tenant-root Deriver B restore-refresh command",
        &commands.deriver_b_refresh_command_b64u,
        TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1),
    )?;
    let command_a = TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&command_a_bytes)
        .map_err(candidate_derivation_error)?;
    let command_b = TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&command_b_bytes)
        .map_err(candidate_derivation_error)?;
    let context_digest = context.digest().map_err(candidate_derivation_error)?;
    if encode_base64url_bytes_v1(&context_bytes) != commands.refresh_context_b64u
        || command_a.context() != &context
        || command_b.context() != &context
        || command_a.role() != TwoPartyDeriverRole::DeriverA
        || command_b.role() != TwoPartyDeriverRole::DeriverB
        || command_a.issuer_key_id() != commands.issuer_key_id
        || command_b.issuer_key_id() != commands.issuer_key_id
        || encode_base64url_bytes_v1(context_digest.as_bytes())
            != encode_base64url_bytes_v1(
                TenantRootProtocolDigestV1::from_bytes(Sha256::digest(&context_bytes).into())
                    .map_err(candidate_derivation_error)?
                    .as_bytes(),
            )
        || encode_base64url_bytes_v1(
            command_a
                .canonical_bytes()
                .map_err(candidate_derivation_error)?
                .as_slice(),
        ) != commands.deriver_a_refresh_command_b64u
        || encode_base64url_bytes_v1(
            command_b
                .canonical_bytes()
                .map_err(candidate_derivation_error)?
                .as_slice(),
        ) != commands.deriver_b_refresh_command_b64u
    {
        return Err(restore_refresh_conflict(
            "stored tenant-root restore-refresh commands are not canonical",
        ));
    }
    let command_a_digest = command_a.digest().map_err(candidate_derivation_error)?;
    let command_b_digest = command_b.digest().map_err(candidate_derivation_error)?;
    if command_a_digest == command_b_digest {
        return Err(restore_refresh_conflict(
            "tenant-root restore-refresh commands must have distinct digests",
        ));
    }
    if context.identity_digest().as_bytes()
        != &decode_fixed_base64url_32(
            "restore-refresh identity digest",
            &scope.identity_digest_b64u,
        )?
        || context.custody_lineage()
            != decode_lineage_b64u(
                "restore-refresh custody lineage",
                &scope.custody_lineage_b64u,
            )?
        || context.issued_at_ms() != scope.issued_at_ms
        || context.expires_at_ms() != scope.expires_at_ms
        || command_a.destination_fingerprint().as_bytes()
            != &decode_fixed_base64url_32(
                "restore-refresh destination fingerprint",
                &scope.destination_fingerprint_b64u,
            )?
        || command_b.destination_fingerprint() != command_a.destination_fingerprint()
        || command_a.restore_session_id().as_bytes()
            != &decode_fixed_base64url_16(
                "restore-refresh restore session",
                &scope.restore_session_id_b64u,
            )?
        || command_b.restore_session_id() != command_a.restore_session_id()
        || command_a.manifest_digest()
            != &decode_fixed_base64url_32(
                "restore-refresh manifest digest",
                &scope.manifest_digest_b64u,
            )?
        || command_b.manifest_digest() != command_a.manifest_digest()
        || command_a
            .acceptance_receipt(TwoPartyDeriverRole::DeriverA)
            .as_bytes()
            != &decode_fixed_base64url_32(
                "restore-refresh Deriver A acceptance receipt",
                &scope.deriver_a_acceptance_receipt_digest_b64u,
            )?
        || command_a
            .acceptance_receipt(TwoPartyDeriverRole::DeriverB)
            .as_bytes()
            != &decode_fixed_base64url_32(
                "restore-refresh Deriver B acceptance receipt",
                &scope.deriver_b_acceptance_receipt_digest_b64u,
            )?
        || command_b.acceptance_receipt(TwoPartyDeriverRole::DeriverA)
            != command_a.acceptance_receipt(TwoPartyDeriverRole::DeriverA)
        || command_b.acceptance_receipt(TwoPartyDeriverRole::DeriverB)
            != command_a.acceptance_receipt(TwoPartyDeriverRole::DeriverB)
    {
        return Err(restore_refresh_conflict(
            "tenant-root restore-refresh commands do not match their immutable grant scope",
        ));
    }
    if commands.issuer_key_id.is_empty() {
        return Err(malformed_input(
            "tenant-root restore-refresh issuer key id must be non-empty",
        ));
    }
    if command_a.digest().map_err(candidate_derivation_error)? != command_a_digest
        || command_b.digest().map_err(candidate_derivation_error)? != command_b_digest
    {
        return Err(restore_refresh_conflict(
            "tenant-root restore-refresh command digest computation changed",
        ));
    }
    Ok(())
}

pub(super) fn decode_fixed_base64url_16(field: &str, encoded: &str) -> RouterAbProtocolResult<[u8; 16]> {
    let bytes = decode_canonical_base64url(field, encoded, 16, base64url_len_for_bytes(16))?;
    bytes
        .try_into()
        .map_err(|_| malformed_input(format!("{field} must contain exactly 16 bytes")))
}

pub(super) fn validate_restore_refresh_checkpoint_state_v1(
    state: &CloudflareTenantRootRestoreRefreshCheckpointStateV1,
    scope: &CloudflareTenantRootRestoreRefreshCheckpointScopeV1,
) -> RouterAbProtocolResult<()> {
    let commands = match state {
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted => return Ok(()),
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted { commands }
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Prepared { commands, .. }
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Contributed { commands, .. }
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed { commands, .. }
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted { commands, .. } => {
            commands
        }
    };
    validate_restore_refresh_commands_v1(commands, scope)?;
    match state {
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted { .. } => {}
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Prepared {
            deriver_a_commitment_b64u,
            deriver_b_commitment_b64u,
            ..
        }
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Contributed {
            deriver_a_commitment_b64u,
            deriver_b_commitment_b64u,
            ..
        }
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
            deriver_a_commitment_b64u,
            deriver_b_commitment_b64u,
            ..
        } => {
            validate_restore_refresh_wire_v1(
                "tenant-root restore-refresh Deriver A commitment",
                deriver_a_commitment_b64u,
                TENANT_ROOT_REFRESH_COMMITMENT_MAX_BYTES_V1,
            )?;
            validate_restore_refresh_wire_v1(
                "tenant-root restore-refresh Deriver B commitment",
                deriver_b_commitment_b64u,
                TENANT_ROOT_REFRESH_COMMITMENT_MAX_BYTES_V1,
            )?;
        }
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
            deriver_a_commitment_b64u,
            deriver_b_commitment_b64u,
            ..
        } => {
            validate_restore_refresh_wire_v1(
                "tenant-root restore-refresh Deriver A commitment",
                deriver_a_commitment_b64u,
                TENANT_ROOT_REFRESH_COMMITMENT_MAX_BYTES_V1,
            )?;
            validate_restore_refresh_wire_v1(
                "tenant-root restore-refresh Deriver B commitment",
                deriver_b_commitment_b64u,
                TENANT_ROOT_REFRESH_COMMITMENT_MAX_BYTES_V1,
            )?;
        }
    }
    match state {
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Contributed {
            deriver_a_contribution_b64u,
            deriver_b_contribution_b64u,
            ..
        }
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
            deriver_a_contribution_b64u,
            deriver_b_contribution_b64u,
            ..
        } => {
            validate_restore_refresh_wire_v1(
                "tenant-root restore-refresh Deriver A contribution",
                deriver_a_contribution_b64u,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1,
            )?;
            validate_restore_refresh_wire_v1(
                "tenant-root restore-refresh Deriver B contribution",
                deriver_b_contribution_b64u,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1,
            )?;
        }
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
            deriver_a_contribution_b64u,
            deriver_b_contribution_b64u,
            ..
        } => {
            validate_restore_refresh_wire_v1(
                "tenant-root restore-refresh Deriver A contribution",
                deriver_a_contribution_b64u,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1,
            )?;
            validate_restore_refresh_wire_v1(
                "tenant-root restore-refresh Deriver B contribution",
                deriver_b_contribution_b64u,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1,
            )?;
        }
        _ => {}
    }
    if let CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
        deriver_a_evidence_b64u,
        deriver_b_evidence_b64u,
        deriver_a_evidence_digest_b64u,
        deriver_b_evidence_digest_b64u,
        ..
    } = state
    {
        validate_restore_refresh_wire_v1(
            "tenant-root restore-refresh Deriver A evidence",
            deriver_a_evidence_b64u,
            TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1,
        )?;
        validate_restore_refresh_wire_v1(
            "tenant-root restore-refresh Deriver B evidence",
            deriver_b_evidence_b64u,
            TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1,
        )?;
        decode_fixed_base64url_32(
            "tenant-root restore-refresh Deriver A evidence digest",
            deriver_a_evidence_digest_b64u,
        )?;
        decode_fixed_base64url_32(
            "tenant-root restore-refresh Deriver B evidence digest",
            deriver_b_evidence_digest_b64u,
        )?;
    }
    if let CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
        deriver_a_evidence_b64u,
        deriver_b_evidence_b64u,
        deriver_a_evidence_digest_b64u,
        deriver_b_evidence_digest_b64u,
        deriver_a_promotion,
        deriver_b_promotion,
        commands,
        ..
    } = state
    {
        validate_restore_refresh_wire_v1(
            "tenant-root restore-refresh Deriver A evidence",
            deriver_a_evidence_b64u,
            TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1,
        )?;
        validate_restore_refresh_wire_v1(
            "tenant-root restore-refresh Deriver B evidence",
            deriver_b_evidence_b64u,
            TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1,
        )?;
        decode_fixed_base64url_32(
            "tenant-root restore-refresh Deriver A evidence digest",
            deriver_a_evidence_digest_b64u,
        )?;
        decode_fixed_base64url_32(
            "tenant-root restore-refresh Deriver B evidence digest",
            deriver_b_evidence_digest_b64u,
        )?;
        validate_restore_refresh_role_promotion_v1(deriver_a_promotion, commands, scope)?;
        validate_restore_refresh_role_promotion_v1(deriver_b_promotion, commands, scope)?;
        if deriver_a_promotion.role != CloudflareTenantRootCreationInstallationRoleV1::DeriverA
            || deriver_b_promotion.role != CloudflareTenantRootCreationInstallationRoleV1::DeriverB
            || deriver_a_promotion.signed_installation_evidence_b64u != *deriver_a_evidence_b64u
            || deriver_b_promotion.signed_installation_evidence_b64u != *deriver_b_evidence_b64u
            || deriver_a_promotion.installation_evidence_digest_b64u
                != *deriver_a_evidence_digest_b64u
            || deriver_b_promotion.installation_evidence_digest_b64u
                != *deriver_b_evidence_digest_b64u
        {
            return Err(restore_refresh_conflict(
                "tenant-root restore-refresh promotion evidence does not match completed evidence",
            ));
        }
    }
    Ok(())
}

pub(super) fn validate_restore_refresh_checkpoint_record_v1(
    checkpoint: &CloudflareTenantRootRestoreRefreshCheckpointV1,
) -> RouterAbProtocolResult<()> {
    let (canonical_grant_b64u, _grant, scope) =
        restore_refresh_checkpoint_scope_from_grant_v1(&checkpoint.grant_b64u)?;
    if canonical_grant_b64u != checkpoint.grant_b64u
        || !restore_refresh_scope_matches_grant_v1(&checkpoint.scope, &scope)
    {
        return Err(restore_refresh_conflict(
            "stored tenant-root restore-refresh grant scope changed",
        ));
    }
    if checkpoint.expected_initial_activation_revision
        != TENANT_ROOT_RESTORE_REFRESH_INITIAL_ACTIVATION_EXPECTED_REVISION_V1
        || checkpoint.result_initial_activation_revision
            != TENANT_ROOT_RESTORE_REFRESH_INITIAL_ACTIVATION_RESULT_REVISION_V1
    {
        return Err(restore_refresh_conflict(
            "stored tenant-root restore-refresh activation revisions changed",
        ));
    }
    validate_restore_refresh_checkpoint_state_v1(&checkpoint.state, &checkpoint.scope)
}

pub(super) fn restore_refresh_checkpoint_commands_v1(
    state: &CloudflareTenantRootRestoreRefreshCheckpointStateV1,
) -> Option<&CloudflareTenantRootRestoreRefreshCommandsV1> {
    match state {
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted => None,
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted { commands }
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Prepared { commands, .. }
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Contributed { commands, .. }
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed { commands, .. }
        | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted { commands, .. } => {
            Some(commands)
        }
    }
}

pub(super) fn restore_refresh_checkpoint_admitted_v1(
    grant_b64u: String,
    scope: CloudflareTenantRootRestoreRefreshCheckpointScopeV1,
) -> CloudflareTenantRootRestoreRefreshCheckpointV1 {
    CloudflareTenantRootRestoreRefreshCheckpointV1 {
        grant_b64u,
        scope,
        expected_initial_activation_revision:
            TENANT_ROOT_RESTORE_REFRESH_INITIAL_ACTIVATION_EXPECTED_REVISION_V1,
        result_initial_activation_revision:
            TENANT_ROOT_RESTORE_REFRESH_INITIAL_ACTIVATION_RESULT_REVISION_V1,
        state: CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted,
    }
}

pub(super) fn restore_refresh_checkpoint_request_matches_record_v1(
    checkpoint: &CloudflareTenantRootRestoreRefreshCheckpointV1,
    grant_b64u: &str,
    scope: &CloudflareTenantRootRestoreRefreshCheckpointScopeV1,
) -> bool {
    checkpoint.grant_b64u == grant_b64u && checkpoint.scope == *scope
}

pub(super) fn restore_refresh_checkpoint_phase_response_v1(
    evaluation: CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1,
) -> CloudflareTenantRootRestoreRefreshCheckpointResponseV1 {
    match evaluation {
        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Commit { checkpoint }
        | CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay { checkpoint } => {
            CloudflareTenantRootRestoreRefreshCheckpointResponseV1::Checkpoint { checkpoint }
        }
        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::AuthorizationExpiredBeforeCommands {
            grant_digest_b64u,
            operation_digest_b64u,
        } => CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforeCommands {
            grant_digest_b64u,
            operation_digest_b64u,
            deriver_dispatch: CloudflareTenantRootRestoreRefreshDeriverDispatchV1::NoneBeforeCommands,
        },
    }
}

pub(super) fn evaluate_tenant_root_restore_refresh_checkpoint_v1(
    current: Option<&CloudflareTenantRootRestoreRefreshCheckpointV1>,
    request: CloudflareTenantRootRestoreRefreshCheckpointRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1> {
    let grant_b64u = restore_refresh_checkpoint_grant_b64u_v1(&request).to_owned();
    let (canonical_grant_b64u, grant, scope) =
        restore_refresh_checkpoint_scope_from_grant_v1(&grant_b64u)?;
    if canonical_grant_b64u != grant_b64u {
        return Err(malformed_input(
            "tenant-root restore-refresh grant canonical bytes changed",
        ));
    }
    if let CloudflareTenantRootRestoreRefreshCheckpointRequestV1::Admit { manifest_b64u, .. }
    | CloudflareTenantRootRestoreRefreshCheckpointRequestV1::PersistCommands {
        manifest_b64u,
        ..
    } = &request
    {
        require_restore_refresh_manifest_matches_grant_v1(manifest_b64u, &grant)?;
    }

    if let Some(stored) = current {
        validate_restore_refresh_checkpoint_record_v1(stored)?;
    }
    let exact_operation = current.is_some_and(|stored| {
        restore_refresh_checkpoint_request_matches_record_v1(stored, &grant_b64u, &scope)
    });

    if let (Some(stored), true) = (current, exact_operation) {
        if matches!(
            (&request, &stored.state),
            (
                CloudflareTenantRootRestoreRefreshCheckpointRequestV1::Admit { .. },
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted
            )
        ) && now_ms >= stored.scope.expires_at_ms
        {
            return Ok(
                CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::AuthorizationExpiredBeforeCommands {
                    grant_digest_b64u: stored.scope.grant_digest_b64u.clone(),
                    operation_digest_b64u: stored.scope.operation_digest_b64u.clone(),
                },
            );
        }
    }

    match request {
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::Admit { .. } => {
            if exact_operation {
                return Ok(
                    CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay {
                        checkpoint: current
                            .expect("exact restore-refresh operation has a checkpoint")
                            .clone(),
                    },
                );
            }
            if now_ms < grant.issued_at_ms() || now_ms >= grant.expires_at_ms() {
                return Err(restore_refresh_expired_error(
                    "tenant-root restore-refresh authorization is outside its freshness window",
                ));
            }
            let checkpoint = restore_refresh_checkpoint_admitted_v1(grant_b64u, scope);
            match current {
                None => Ok(
                    CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Commit { checkpoint },
                ),
                Some(stored)
                    if matches!(
                        stored.state,
                        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted
                    ) && now_ms >= stored.scope.expires_at_ms =>
                {
                    Ok(
                        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Commit {
                            checkpoint,
                        },
                    )
                }
                Some(_) => Err(restore_refresh_conflict(
                    "tenant-root restore-refresh checkpoint belongs to another operation",
                )),
            }
        }
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::PersistCommands {
            commands, ..
        } => {
            validate_restore_refresh_commands_v1(&commands, &scope)?;
            let stored = current.ok_or_else(|| {
                restore_refresh_lifecycle_error(
                    "tenant-root restore-refresh commands have no admitted checkpoint",
                )
            })?;
            if !exact_operation {
                return Err(restore_refresh_conflict(
                    "tenant-root restore-refresh command persistence has a different operation scope",
                ));
            }
            let candidate =
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted { commands };
            match &stored.state {
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted => {
                    let mut checkpoint = stored.clone();
                    checkpoint.state = candidate;
                    Ok(CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Commit {
                        checkpoint,
                    })
                }
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted {
                    commands: persisted,
                } if persisted
                    == match &candidate {
                        CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted {
                            commands,
                        } => commands,
                        _ => unreachable!(),
                    } => Ok(CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay {
                    checkpoint: stored.clone(),
                }),
                _ if restore_refresh_checkpoint_commands_v1(&stored.state)
                    == match &candidate {
                        CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted {
                            commands,
                        } => Some(commands),
                        _ => None,
                    } => Ok(CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay {
                    checkpoint: stored.clone(),
                }),
                _ => Err(restore_refresh_conflict(
                    "tenant-root restore-refresh command response changed after persistence",
                )),
            }
        }
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitPrepared {
            deriver_a_commitment_b64u,
            deriver_b_commitment_b64u,
            ..
        } => {
            let stored = current.ok_or_else(|| {
                restore_refresh_lifecycle_error(
                    "tenant-root restore-refresh prepare has no persisted command response",
                )
            })?;
            if !exact_operation {
                return Err(restore_refresh_conflict(
                    "tenant-root restore-refresh prepare has a different operation scope",
                ));
            }
            let candidate_commitments = (deriver_a_commitment_b64u, deriver_b_commitment_b64u);
            match &stored.state {
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted {
                    commands,
                } => {
                    let mut checkpoint = stored.clone();
                    checkpoint.state =
                        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Prepared {
                            commands: commands.clone(),
                            deriver_a_commitment_b64u: candidate_commitments.0,
                            deriver_b_commitment_b64u: candidate_commitments.1,
                        };
                    validate_restore_refresh_checkpoint_record_v1(&checkpoint)?;
                    Ok(
                        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Commit {
                            checkpoint,
                        },
                    )
                }
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Prepared {
                    deriver_a_commitment_b64u: a,
                    deriver_b_commitment_b64u: b,
                    ..
                }
                | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Contributed {
                    deriver_a_commitment_b64u: a,
                    deriver_b_commitment_b64u: b,
                    ..
                }
                | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
                    deriver_a_commitment_b64u: a,
                    deriver_b_commitment_b64u: b,
                    ..
                }
                | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
                    deriver_a_commitment_b64u: a,
                    deriver_b_commitment_b64u: b,
                    ..
                } if a == &candidate_commitments.0 && b == &candidate_commitments.1 => Ok(
                    CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay {
                        checkpoint: stored.clone(),
                    },
                ),
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted => {
                    Err(restore_refresh_lifecycle_error(
                        "tenant-root restore-refresh prepare cannot run before command persistence",
                    ))
                }
                _ => Err(restore_refresh_conflict(
                    "tenant-root restore-refresh commitment bytes changed",
                )),
            }
        }
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitContributed {
            deriver_a_commitment_b64u,
            deriver_b_commitment_b64u,
            deriver_a_contribution_b64u,
            deriver_b_contribution_b64u,
            ..
        } => {
            let stored = current.ok_or_else(|| {
                restore_refresh_lifecycle_error(
                    "tenant-root restore-refresh contribute has no prepared checkpoint",
                )
            })?;
            if !exact_operation {
                return Err(restore_refresh_conflict(
                    "tenant-root restore-refresh contribution has a different operation scope",
                ));
            }
            match &stored.state {
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Prepared {
                    commands,
                    deriver_a_commitment_b64u: persisted_a,
                    deriver_b_commitment_b64u: persisted_b,
                } if persisted_a == &deriver_a_commitment_b64u
                    && persisted_b == &deriver_b_commitment_b64u =>
                {
                    let mut checkpoint = stored.clone();
                    checkpoint.state =
                        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Contributed {
                            commands: commands.clone(),
                            deriver_a_commitment_b64u,
                            deriver_b_commitment_b64u,
                            deriver_a_contribution_b64u,
                            deriver_b_contribution_b64u,
                        };
                    validate_restore_refresh_checkpoint_record_v1(&checkpoint)?;
                    Ok(
                        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Commit {
                            checkpoint,
                        },
                    )
                }
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Contributed {
                    deriver_a_commitment_b64u: persisted_a,
                    deriver_b_commitment_b64u: persisted_b,
                    deriver_a_contribution_b64u: persisted_a_contribution,
                    deriver_b_contribution_b64u: persisted_b_contribution,
                    ..
                }
                | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
                    deriver_a_commitment_b64u: persisted_a,
                    deriver_b_commitment_b64u: persisted_b,
                    deriver_a_contribution_b64u: persisted_a_contribution,
                    deriver_b_contribution_b64u: persisted_b_contribution,
                    ..
                }
                | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
                    deriver_a_commitment_b64u: persisted_a,
                    deriver_b_commitment_b64u: persisted_b,
                    deriver_a_contribution_b64u: persisted_a_contribution,
                    deriver_b_contribution_b64u: persisted_b_contribution,
                    ..
                } if persisted_a == &deriver_a_commitment_b64u
                    && persisted_b == &deriver_b_commitment_b64u
                    && persisted_a_contribution == &deriver_a_contribution_b64u
                    && persisted_b_contribution == &deriver_b_contribution_b64u =>
                {
                    Ok(
                        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay {
                            checkpoint: stored.clone(),
                        },
                    )
                }
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted
                | CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted {
                    ..
                } => Err(restore_refresh_lifecycle_error(
                    "tenant-root restore-refresh contribute requires prepared commitments",
                )),
                _ => Err(restore_refresh_conflict(
                    "tenant-root restore-refresh contribution bytes changed",
                )),
            }
        }
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitCompleted {
            deriver_a_commitment_b64u,
            deriver_b_commitment_b64u,
            deriver_a_contribution_b64u,
            deriver_b_contribution_b64u,
            deriver_a_evidence_b64u,
            deriver_b_evidence_b64u,
            deriver_a_evidence_digest_b64u,
            deriver_b_evidence_digest_b64u,
            ..
        } => {
            let stored = current.ok_or_else(|| {
                restore_refresh_lifecycle_error(
                    "tenant-root restore-refresh finalize has no contributed checkpoint",
                )
            })?;
            if !exact_operation {
                return Err(restore_refresh_conflict(
                    "tenant-root restore-refresh finalization has a different operation scope",
                ));
            }
            match &stored.state {
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Contributed {
                    commands,
                    deriver_a_commitment_b64u: persisted_a,
                    deriver_b_commitment_b64u: persisted_b,
                    deriver_a_contribution_b64u: persisted_a_contribution,
                    deriver_b_contribution_b64u: persisted_b_contribution,
                } if persisted_a == &deriver_a_commitment_b64u
                    && persisted_b == &deriver_b_commitment_b64u
                    && persisted_a_contribution == &deriver_a_contribution_b64u
                    && persisted_b_contribution == &deriver_b_contribution_b64u =>
                {
                    let mut checkpoint = stored.clone();
                    checkpoint.state =
                        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
                            commands: commands.clone(),
                            deriver_a_commitment_b64u,
                            deriver_b_commitment_b64u,
                            deriver_a_contribution_b64u,
                            deriver_b_contribution_b64u,
                            deriver_a_evidence_b64u,
                            deriver_b_evidence_b64u,
                            deriver_a_evidence_digest_b64u,
                            deriver_b_evidence_digest_b64u,
                        };
                    validate_restore_refresh_checkpoint_record_v1(&checkpoint)?;
                    Ok(
                        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Commit {
                            checkpoint,
                        },
                    )
                }
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
                    deriver_a_commitment_b64u: persisted_a,
                    deriver_b_commitment_b64u: persisted_b,
                    deriver_a_contribution_b64u: persisted_a_contribution,
                    deriver_b_contribution_b64u: persisted_b_contribution,
                    deriver_a_evidence_b64u: persisted_a_evidence,
                    deriver_b_evidence_b64u: persisted_b_evidence,
                    deriver_a_evidence_digest_b64u: persisted_a_digest,
                    deriver_b_evidence_digest_b64u: persisted_b_digest,
                    ..
                } if persisted_a == &deriver_a_commitment_b64u
                    && persisted_b == &deriver_b_commitment_b64u
                    && persisted_a_contribution == &deriver_a_contribution_b64u
                    && persisted_b_contribution == &deriver_b_contribution_b64u
                    && persisted_a_evidence == &deriver_a_evidence_b64u
                    && persisted_b_evidence == &deriver_b_evidence_b64u
                    && persisted_a_digest == &deriver_a_evidence_digest_b64u
                    && persisted_b_digest == &deriver_b_evidence_digest_b64u =>
                {
                    Ok(
                        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay {
                            checkpoint: stored.clone(),
                        },
                    )
                }
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
                    deriver_a_commitment_b64u: persisted_a,
                    deriver_b_commitment_b64u: persisted_b,
                    deriver_a_contribution_b64u: persisted_a_contribution,
                    deriver_b_contribution_b64u: persisted_b_contribution,
                    deriver_a_evidence_b64u: persisted_a_evidence,
                    deriver_b_evidence_b64u: persisted_b_evidence,
                    deriver_a_evidence_digest_b64u: persisted_a_digest,
                    deriver_b_evidence_digest_b64u: persisted_b_digest,
                    ..
                } if persisted_a == &deriver_a_commitment_b64u
                    && persisted_b == &deriver_b_commitment_b64u
                    && persisted_a_contribution == &deriver_a_contribution_b64u
                    && persisted_b_contribution == &deriver_b_contribution_b64u
                    && persisted_a_evidence == &deriver_a_evidence_b64u
                    && persisted_b_evidence == &deriver_b_evidence_b64u
                    && persisted_a_digest == &deriver_a_evidence_digest_b64u
                    && persisted_b_digest == &deriver_b_evidence_digest_b64u =>
                {
                    Ok(
                        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay {
                            checkpoint: stored.clone(),
                        },
                    )
                }
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Admitted
                | CloudflareTenantRootRestoreRefreshCheckpointStateV1::CommandsPersisted {
                    ..
                }
                | CloudflareTenantRootRestoreRefreshCheckpointStateV1::Prepared { .. } => {
                    Err(restore_refresh_lifecycle_error(
                        "tenant-root restore-refresh finalize requires contributed responses",
                    ))
                }
                _ => Err(restore_refresh_conflict(
                    "tenant-root restore-refresh evidence bytes changed",
                )),
            }
        }
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::CommitPromoted {
            deriver_a_promotion,
            deriver_b_promotion,
            ..
        } => {
            let stored = current.ok_or_else(|| {
                restore_refresh_lifecycle_error(
                    "tenant-root restore-refresh promotion has no completed checkpoint",
                )
            })?;
            if !exact_operation {
                return Err(restore_refresh_conflict(
                    "tenant-root restore-refresh promotion has a different operation scope",
                ));
            }
            match &stored.state {
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed {
                    commands,
                    deriver_a_commitment_b64u,
                    deriver_b_commitment_b64u,
                    deriver_a_contribution_b64u,
                    deriver_b_contribution_b64u,
                    deriver_a_evidence_b64u,
                    deriver_b_evidence_b64u,
                    deriver_a_evidence_digest_b64u,
                    deriver_b_evidence_digest_b64u,
                } => {
                    validate_restore_refresh_role_promotion_v1(
                        &deriver_a_promotion,
                        commands,
                        &scope,
                    )?;
                    validate_restore_refresh_role_promotion_v1(
                        &deriver_b_promotion,
                        commands,
                        &scope,
                    )?;
                    let checkpoint = CloudflareTenantRootRestoreRefreshCheckpointV1 {
                        grant_b64u,
                        scope,
                        expected_initial_activation_revision: stored
                            .expected_initial_activation_revision,
                        result_initial_activation_revision: stored
                            .result_initial_activation_revision,
                        state: CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
                            commands: commands.clone(),
                            deriver_a_commitment_b64u: deriver_a_commitment_b64u.clone(),
                            deriver_b_commitment_b64u: deriver_b_commitment_b64u.clone(),
                            deriver_a_contribution_b64u: deriver_a_contribution_b64u.clone(),
                            deriver_b_contribution_b64u: deriver_b_contribution_b64u.clone(),
                            deriver_a_evidence_b64u: deriver_a_evidence_b64u.clone(),
                            deriver_b_evidence_b64u: deriver_b_evidence_b64u.clone(),
                            deriver_a_evidence_digest_b64u: deriver_a_evidence_digest_b64u.clone(),
                            deriver_b_evidence_digest_b64u: deriver_b_evidence_digest_b64u.clone(),
                            deriver_a_promotion,
                            deriver_b_promotion,
                        },
                    };
                    validate_restore_refresh_checkpoint_record_v1(&checkpoint)?;
                    Ok(
                        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Commit {
                            checkpoint,
                        },
                    )
                }
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
                    deriver_a_promotion: persisted_a,
                    deriver_b_promotion: persisted_b,
                    ..
                } if persisted_a == &deriver_a_promotion && persisted_b == &deriver_b_promotion => {
                    Ok(
                        CloudflareTenantRootRestoreRefreshCheckpointEvaluationV1::Replay {
                            checkpoint: stored.clone(),
                        },
                    )
                }
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted { .. } => {
                    Err(restore_refresh_conflict(
                        "tenant-root restore-refresh promotion artifacts changed",
                    ))
                }
                _ => Err(restore_refresh_lifecycle_error(
                    "tenant-root restore-refresh promotion requires completed evidence",
                )),
            }
        }
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::ReadCompleted { .. } => {
            Err(restore_refresh_lifecycle_error(
                "tenant-root restore-refresh completed reads are handled by the read path",
            ))
        }
        CloudflareTenantRootRestoreRefreshCheckpointRequestV1::ReadPromoted { .. } => {
            Err(restore_refresh_lifecycle_error(
                "tenant-root restore-refresh promoted reads are handled by the read path",
            ))
        }
    }
}

pub(super) fn evaluate_restore_refresh_completed_read_v1(
    checkpoint: &CloudflareTenantRootRestoreRefreshCheckpointV1,
    grant_b64u: &str,
    scope: &CloudflareTenantRootRestoreRefreshCheckpointScopeV1,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootRestoreRefreshCheckpointResponseV1> {
    validate_restore_refresh_checkpoint_record_v1(checkpoint)?;
    if !restore_refresh_checkpoint_request_matches_record_v1(checkpoint, grant_b64u, scope) {
        return Err(restore_refresh_conflict(
            "tenant-root restore-refresh completed checkpoint belongs to another operation",
        ));
    }
    if !matches!(
        checkpoint.state,
        CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed { .. }
    ) {
        return Err(restore_refresh_lifecycle_error(
            "tenant-root restore-refresh initial activation requires completed evidence",
        ));
    }
    if now_ms < checkpoint.scope.issued_at_ms {
        return Err(restore_refresh_expired_error(
            "tenant-root restore-refresh promotion was requested before authorization issuance",
        ));
    }
    if now_ms >= checkpoint.scope.expires_at_ms {
        return Ok(
            CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforePromotion {
                grant_digest_b64u: checkpoint.scope.grant_digest_b64u.clone(),
                operation_digest_b64u: checkpoint.scope.operation_digest_b64u.clone(),
            },
        );
    }
    Ok(
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::CompletedRead {
            authority_id_b64u: encode_base64url_bytes_v1(authority_id.as_bytes()),
            expected_initial_activation_revision: checkpoint.expected_initial_activation_revision,
            result_initial_activation_revision: checkpoint.result_initial_activation_revision,
        },
    )
}

pub(super) fn evaluate_restore_refresh_promoted_read_v1(
    checkpoint: &CloudflareTenantRootRestoreRefreshCheckpointV1,
    grant_b64u: &str,
    scope: &CloudflareTenantRootRestoreRefreshCheckpointScopeV1,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootRestoreRefreshCheckpointResponseV1> {
    validate_restore_refresh_checkpoint_record_v1(checkpoint)?;
    if !restore_refresh_checkpoint_request_matches_record_v1(checkpoint, grant_b64u, scope) {
        return Err(restore_refresh_conflict(
            "tenant-root restore-refresh promoted checkpoint belongs to another operation",
        ));
    }
    if now_ms < checkpoint.scope.issued_at_ms {
        return Err(restore_refresh_expired_error(
            "tenant-root restore-refresh promotion was requested before authorization issuance",
        ));
    }
    let CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
        deriver_a_promotion,
        deriver_b_promotion,
        ..
    } = &checkpoint.state
    else {
        if now_ms >= checkpoint.scope.expires_at_ms
            && matches!(
                &checkpoint.state,
                CloudflareTenantRootRestoreRefreshCheckpointStateV1::Completed { .. }
            )
        {
            return Ok(
                CloudflareTenantRootRestoreRefreshCheckpointResponseV1::AuthorizationExpiredBeforePromotion {
                    grant_digest_b64u: checkpoint.scope.grant_digest_b64u.clone(),
                    operation_digest_b64u: checkpoint.scope.operation_digest_b64u.clone(),
                },
            );
        }
        return Err(restore_refresh_lifecycle_error(
            "tenant-root restore-refresh promotion has not been durably persisted",
        ));
    };
    Ok(
        CloudflareTenantRootRestoreRefreshCheckpointResponseV1::PromotedRead {
            authority_id_b64u: encode_base64url_bytes_v1(authority_id.as_bytes()),
            expected_initial_activation_revision: checkpoint.expected_initial_activation_revision,
            result_initial_activation_revision: checkpoint.result_initial_activation_revision,
            deriver_a_promotion: deriver_a_promotion.clone(),
            deriver_b_promotion: deriver_b_promotion.clone(),
        },
    )
}

pub(super) fn validate_restore_initial_activation_receipt_against_checkpoint_v1(
    activation_receipt: &router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
    checkpoint: &CloudflareTenantRootRestoreRefreshCheckpointV1,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
) -> RouterAbProtocolResult<(
    TenantRootRestoreDestinationFingerprintV1,
    router_ab_core::TenantRootRestoreSessionIdV1,
)> {
    validate_restore_refresh_checkpoint_record_v1(checkpoint)?;
    let CloudflareTenantRootRestoreRefreshCheckpointStateV1::Promoted {
        commands,
        deriver_a_promotion,
        deriver_b_promotion,
        ..
    } = &checkpoint.state
    else {
        return Err(restore_refresh_lifecycle_error(
            "tenant-root restore initial activation requires a promoted checkpoint",
        ));
    };
    let command_a_bytes = decode_canonical_base64url(
        "tenant-root restore-refresh Deriver A role command",
        &deriver_a_promotion.restore_refresh_role_command_b64u,
        TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1),
    )?;
    let command_b_bytes = decode_canonical_base64url(
        "tenant-root restore-refresh Deriver B role command",
        &deriver_b_promotion.restore_refresh_role_command_b64u,
        TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1,
        base64url_len_for_bytes(TENANT_ROOT_RESTORE_REFRESH_ROLE_COMMAND_MAX_BYTES_V1),
    )?;
    let command_a = TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&command_a_bytes)
        .map_err(candidate_derivation_error)?;
    let command_b = TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&command_b_bytes)
        .map_err(candidate_derivation_error)?;
    if command_a.role() != TwoPartyDeriverRole::DeriverA
        || command_b.role() != TwoPartyDeriverRole::DeriverB
        || command_a
            .canonical_bytes()
            .map_err(candidate_derivation_error)?
            != command_a_bytes
        || command_b
            .canonical_bytes()
            .map_err(candidate_derivation_error)?
            != command_b_bytes
        || commands.deriver_a_refresh_command_b64u
            != deriver_a_promotion.restore_refresh_role_command_b64u
        || commands.deriver_b_refresh_command_b64u
            != deriver_b_promotion.restore_refresh_role_command_b64u
    {
        return Err(restore_refresh_conflict(
            "tenant-root restore-refresh promoted commands do not match the checkpoint",
        ));
    }

    let TenantRootActivationReceiptBindingV1::InitialCreation(binding) =
        activation_receipt.binding()
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore activation requires an initial-creation receipt",
        ));
    };
    if binding.authority_id() != authority_id
        || binding.expected_control_plane_revision()
            != TENANT_ROOT_RESTORE_REFRESH_INITIAL_ACTIVATION_EXPECTED_REVISION_V1
        || binding.result_control_plane_revision()
            != TENANT_ROOT_RESTORE_REFRESH_INITIAL_ACTIVATION_RESULT_REVISION_V1
        || binding.epoch() != TenantRootShareEpoch::INITIAL
        || binding.context_digest()
            != command_a
                .context()
                .digest()
                .map_err(candidate_derivation_error)?
        || binding.issued_at_ms() != checkpoint.scope.issued_at_ms
        || binding.expires_at_ms() != checkpoint.scope.expires_at_ms
        || binding.activated_at_ms()
            != deriver_a_promotion
                .completed_at_ms
                .max(deriver_b_promotion.completed_at_ms)
    {
        return Err(restore_refresh_conflict(
            "tenant-root restore activation receipt does not match promoted checkpoint timing",
        ));
    }
    let Some(provenance) = binding.availability().tenant_held_external_provenance() else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore activation requires tenant-held external provenance",
        ));
    };
    let scope_identity = decode_fixed_base64url_32(
        "tenant-root restore-refresh identity digest",
        &checkpoint.scope.identity_digest_b64u,
    )?;
    let scope_destination = decode_fixed_base64url_32(
        "tenant-root restore-refresh destination fingerprint",
        &checkpoint.scope.destination_fingerprint_b64u,
    )?;
    let scope_manifest = decode_fixed_base64url_32(
        "tenant-root restore-refresh manifest digest",
        &checkpoint.scope.manifest_digest_b64u,
    )?;
    let scope_session = decode_fixed_base64url_16(
        "tenant-root restore-refresh restore session",
        &checkpoint.scope.restore_session_id_b64u,
    )?;
    let scope_lineage = decode_lineage_b64u(
        "tenant-root restore-refresh custody lineage",
        &checkpoint.scope.custody_lineage_b64u,
    )?;
    let command_context_digest = command_a
        .context()
        .digest()
        .map_err(candidate_derivation_error)?;
    let command_a_digest = command_a.digest().map_err(candidate_derivation_error)?;
    let command_b_digest = command_b.digest().map_err(candidate_derivation_error)?;
    let scope_command_a_digest = decode_fixed_base64url_32(
        "tenant-root restore-refresh Deriver A command digest",
        &deriver_a_promotion.command_digest_b64u,
    )?;
    let scope_command_b_digest = decode_fixed_base64url_32(
        "tenant-root restore-refresh Deriver B command digest",
        &deriver_b_promotion.command_digest_b64u,
    )?;
    if command_a.context().identity_digest().as_bytes() != &scope_identity
        || command_a.context().custody_lineage() != scope_lineage
        || command_a.context().issued_at_ms() != checkpoint.scope.issued_at_ms
        || command_a.context().expires_at_ms() != checkpoint.scope.expires_at_ms
        || command_a.destination_fingerprint().as_bytes() != &scope_destination
        || command_b.destination_fingerprint() != command_a.destination_fingerprint()
        || command_a.restore_session_id().as_bytes() != &scope_session
        || command_b.restore_session_id() != command_a.restore_session_id()
        || command_a.manifest_digest() != &scope_manifest
        || command_b.manifest_digest() != command_a.manifest_digest()
        || command_a
            .context()
            .digest()
            .map_err(candidate_derivation_error)?
            != command_context_digest
        || command_a_digest.as_bytes() != &scope_command_a_digest
        || command_b_digest.as_bytes() != &scope_command_b_digest
        || provenance.identity_digest() != activation_receipt.identity_digest()
        || provenance.custody_lineage() != activation_receipt.custody_lineage()
        || provenance.identity_digest().as_bytes() != &scope_identity
        || provenance.custody_lineage() != scope_lineage
        || provenance.destination_fingerprint().as_bytes() != &scope_destination
        || provenance.restore_session_id().as_bytes() != &scope_session
        || provenance.manifest_digest() != &scope_manifest
        || provenance.restore_context_digest() != command_context_digest
        || provenance.restore_refresh_command_digest().as_bytes() != &scope_command_a_digest
        || provenance.deriver_a_acceptance_receipt_digest().as_bytes()
            != &decode_fixed_base64url_32(
                "tenant-root restore-refresh Deriver A acceptance receipt",
                &checkpoint.scope.deriver_a_acceptance_receipt_digest_b64u,
            )?
        || provenance.deriver_b_acceptance_receipt_digest().as_bytes()
            != &decode_fixed_base64url_32(
                "tenant-root restore-refresh Deriver B acceptance receipt",
                &checkpoint.scope.deriver_b_acceptance_receipt_digest_b64u,
            )?
        || provenance.deriver_a_acceptance_receipt_digest()
            != command_a.acceptance_receipt(TwoPartyDeriverRole::DeriverA)
        || provenance.deriver_b_acceptance_receipt_digest()
            != command_a.acceptance_receipt(TwoPartyDeriverRole::DeriverB)
        || provenance.deriver_a_imported_commitment()
            != command_a.imported_commitment(TwoPartyDeriverRole::DeriverA)
        || provenance.deriver_b_imported_commitment()
            != command_a.imported_commitment(TwoPartyDeriverRole::DeriverB)
        || provenance.stable_root_commitment() != command_a.stable_root_commitment()
        || binding.commitments().root_commitment() != provenance.stable_root_commitment()
    {
        return Err(restore_refresh_conflict(
            "tenant-root restore activation receipt does not match promoted restore scope",
        ));
    }
    let installation_a_digest = decode_lifecycle_receipt_digest(
        "tenant-root restore-refresh Deriver A installation evidence digest",
        &deriver_a_promotion.installation_evidence_digest_b64u,
    )?;
    let installation_b_digest = decode_lifecycle_receipt_digest(
        "tenant-root restore-refresh Deriver B installation evidence digest",
        &deriver_b_promotion.installation_evidence_digest_b64u,
    )?;
    let canary_a_digest = decode_lifecycle_receipt_digest(
        "tenant-root restore-refresh Deriver A provider canary digest",
        &deriver_a_promotion.provider_canary_receipt_digest_b64u,
    )?;
    let canary_b_digest = decode_lifecycle_receipt_digest(
        "tenant-root restore-refresh Deriver B provider canary digest",
        &deriver_b_promotion.provider_canary_receipt_digest_b64u,
    )?;
    let installation_receipts = binding.installation_receipts();
    let canary_receipts = binding.canary_receipts();
    if installation_receipts.deriver_a() != installation_a_digest
        || installation_receipts.deriver_b() != installation_b_digest
        || canary_receipts.ecdsa() != canary_a_digest
        || canary_receipts.ed25519() != canary_b_digest
    {
        return Err(restore_refresh_conflict(
            "tenant-root restore activation receipt does not match promoted role artifacts",
        ));
    }
    Ok((
        provenance.destination_fingerprint(),
        provenance.restore_session_id(),
    ))
}

pub(super) fn restore_bootstrap_destruction_receipt_v1(
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    destination_fingerprint: TenantRootRestoreDestinationFingerprintV1,
    restore_session_id: router_ab_core::TenantRootRestoreSessionIdV1,
    grant_digest_b64u: &str,
    activation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
) -> RouterAbProtocolResult<(String, String)> {
    let grant_digest = decode_fixed_base64url_32(
        "tenant-root restore-refresh grant digest",
        grant_digest_b64u,
    )?;
    let mut receipt_hasher = Sha256::new();
    receipt_hasher.update(TENANT_ROOT_DESTINATION_BOOTSTRAP_DESTRUCTION_RECEIPT_DOMAIN_V1);
    receipt_hasher.update(identity_digest.as_bytes());
    receipt_hasher.update(custody_lineage.as_bytes());
    receipt_hasher.update(destination_fingerprint.as_bytes());
    receipt_hasher.update(restore_session_id.as_bytes());
    receipt_hasher.update(grant_digest);
    receipt_hasher.update(activation_receipt_digest.as_bytes());
    let receipt_bytes: [u8; 32] = receipt_hasher.finalize().into();
    let receipt_digest: [u8; 32] = Sha256::digest(receipt_bytes).into();
    Ok((
        encode_base64url_bytes_v1(&receipt_bytes),
        encode_base64url_bytes_v1(&receipt_digest),
    ))
}

/// Projects validated creation state into the public read response.
///
/// Pure so the projection is testable without a Durable Object: the caller's
/// identity and lineage must match the persisted journal, and only bytes that
/// are already public evidence are returned.
pub(super) fn creation_installation_checkpoint_read_state_v1(
    checkpoint: Option<&ValidatedTenantRootCreationInstallationCheckpointV1>,
) -> CloudflareTenantRootCreationInstallationCheckpointReadStateV1 {
    let Some(checkpoint) = checkpoint else {
        return CloudflareTenantRootCreationInstallationCheckpointReadStateV1::None;
    };
    match &checkpoint.state {
        ValidatedTenantRootCreationInstallationStateV1::OneRoleReady { role, evidence } => {
            CloudflareTenantRootCreationInstallationCheckpointReadStateV1::OneRoleReady {
                role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(*role),
                signed_evidence_b64u: encode_base64url_bytes_v1(evidence.canonical_bytes()),
            }
        }
        ValidatedTenantRootCreationInstallationStateV1::BothRolesReady {
            deriver_a,
            deriver_b,
            root_commitment,
        } => CloudflareTenantRootCreationInstallationCheckpointReadStateV1::BothRolesReady {
            deriver_a_signed_evidence_b64u: encode_base64url_bytes_v1(deriver_a.canonical_bytes()),
            deriver_b_signed_evidence_b64u: encode_base64url_bytes_v1(deriver_b.canonical_bytes()),
            root_commitment_b64u: encode_base64url_bytes_v1(root_commitment),
        },
    }
}

pub(super) fn active_state_read_response_from_record(
    record: CloudflareTenantRootRefreshActiveStateRecordV1,
) -> CloudflareTenantRootCreationActiveStateReadResponseV1 {
    CloudflareTenantRootCreationActiveStateReadResponseV1 {
        last_manual_refresh_completed_at_ms: record.last_manual_refresh_completed_at_ms,
        last_refresh_completed_at_ms: record.last_refresh_completed_at_ms,
        activation_receipt_b64u: record.activation_receipt_b64u,
        activation_receipt_digest_b64u: record.activation_receipt_digest_b64u,
        identity_digest_b64u: record.identity_digest_b64u,
        custody_lineage_b64u: record.custody_lineage_b64u,
        lifecycle_revision: record.lifecycle_revision,
        fence: record.fence,
        managed_restore_fence: record.managed_restore_fence,
        job: None,
        refresh_admission: None,
        delivery: record.delivery,
        refresh_pending: record.manual_refresh_pending,
        managed_restore_completion: None,
    }
}

pub(crate) fn build_creation_journal_read_response(
    request: &CloudflareTenantRootCreationJournalReadRequestV1,
    journal: &ValidatedTenantRootCreationJournalV1,
    rendezvous: Option<&CloudflareTenantRootCreationCommitmentRendezvousRecordV1>,
    installation_checkpoint: Option<&ValidatedTenantRootCreationInstallationCheckpointV1>,
    abandonment: Option<CloudflareTenantRootCreationAbandonmentReadV1>,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationJournalReadResponseV1> {
    require_base64url_matches(
        "tenant-root creation read identity digest",
        &request.identity_digest_b64u,
        journal.identity_digest.as_bytes(),
    )?;
    require_base64url_matches(
        "tenant-root creation read custody lineage",
        &request.custody_lineage_b64u,
        journal.custody_lineage.as_bytes(),
    )?;
    let committed_roles = match rendezvous.map(|record| &record.state) {
        None => Vec::new(),
        Some(CloudflareTenantRootCreationCommitmentRendezvousStateV1::OneRoleCommitted {
            role,
            ..
        }) => vec![*role],
        Some(CloudflareTenantRootCreationCommitmentRendezvousStateV1::BothRolesCommitted {
            ..
        }) => vec![
            CloudflareTenantRootCreationInstallationRoleV1::DeriverA,
            CloudflareTenantRootCreationInstallationRoleV1::DeriverB,
        ],
    };
    Ok(CloudflareTenantRootCreationJournalReadResponseV1 {
        journal_b64u: journal.record.journal_b64u.clone(),
        creation_capability_b64u: journal.record.creation_capability_b64u.clone(),
        revision: journal.journal.revision(),
        committed_roles,
        installation_checkpoint: creation_installation_checkpoint_read_state_v1(
            installation_checkpoint,
        ),
        abandonment,
    })
}

/// The manual-refresh interval this Worker is configured with, or the
/// protocol default.
#[cfg(feature = "workers-rs")]
#[cfg(feature = "workers-rs")]
#[cfg(any(feature = "strict-worker-router-entrypoint", test))]
pub(crate) fn refresh_schedule_v1(env: &worker::Env) -> RouterAbProtocolResult<TenantRootRefreshScheduleV1> {
    parse_tenant_root_refresh_schedule_v1(&crate::CloudflareWorkerEnvReaderV1::new(env))
}

/// The deployment's refresh schedule. `TENANT_ROOT_MANUAL_REFRESH_INTERVAL_MS`
/// sets the least time between manual refreshes of one root, ten minutes by
/// default; `TENANT_ROOT_SCHEDULED_REFRESH_INTERVAL_MS` sets the interval of
/// scheduled refreshes, thirty days by default. Each is at least one minute.
pub fn parse_tenant_root_refresh_schedule_v1(
    reader: &impl crate::CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<TenantRootRefreshScheduleV1> {
    let interval = |name: &str, default: u64| -> RouterAbProtocolResult<u64> {
        match reader.get_text(name)? {
            Some(value) => value
                .parse::<u64>()
                .ok()
                .filter(|value| *value >= 60_000)
                .ok_or_else(|| {
                    RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                        format!("{name} must be at least 60000 milliseconds"),
                    )
                }),
            None => Ok(default),
        }
    };
    Ok(TenantRootRefreshScheduleV1 {
        manual_interval_ms: interval(
            "TENANT_ROOT_MANUAL_REFRESH_INTERVAL_MS",
            TENANT_ROOT_MANUAL_REFRESH_INTERVAL_MS_V1,
        )?,
        scheduled_interval_ms: interval(
            "TENANT_ROOT_SCHEDULED_REFRESH_INTERVAL_MS",
            TENANT_ROOT_SCHEDULED_REFRESH_INTERVAL_MS_V1,
        )?,
    })
}

pub(super) const TENANT_ROOT_RETIREMENT_GRACE_MS_ENV_V1: &str = "TENANT_ROOT_RETIREMENT_GRACE_MS";

pub(super) const TENANT_ROOT_RETIREMENT_GRACE_MS_DEFAULT_V1: u64 = 5 * 60 * 1000;

/// How long the Router keeps a refresh's retired epoch after the swap before
/// it asks each role to erase it. `TENANT_ROOT_RETIREMENT_GRACE_MS` sets it,
/// five minutes by default and at least one second. It is policy only: a role
/// erases the epoch only once every admission on it is settled or cancelled.
pub fn parse_tenant_root_retirement_grace_ms_v1(
    reader: &impl crate::CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<u64> {
    match reader.get_text(TENANT_ROOT_RETIREMENT_GRACE_MS_ENV_V1)? {
        Some(value) => value
            .parse::<u64>()
            .ok()
            .filter(|value| *value >= 1_000)
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    format!("{TENANT_ROOT_RETIREMENT_GRACE_MS_ENV_V1} must be at least 1000 milliseconds"),
                )
            }),
        None => Ok(TENANT_ROOT_RETIREMENT_GRACE_MS_DEFAULT_V1),
    }
}
